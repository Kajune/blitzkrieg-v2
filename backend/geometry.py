from typing import Dict, List, Tuple, Optional, Any
from pyproj import Transformer, CRS
from shapely.geometry.base import BaseGeometry
from shapely.geometry import shape, GeometryCollection
from shapely.ops import transform
from models import *
import numpy as np
import rasterio
from rasterio.warp import reproject, calculate_default_transform, Resampling
from rasterio.transform import from_bounds


def to_shapely_geom(geojson_data: Dict[str, Any]) -> Union[GeometryCollection, shape]:
	"""
	GeoJSON(dict)をShapelyのGeometryオブジェクトに変換する関数。
	FeatureCollectionの場合は全GeometryをまとめたGeometryCollectionを返す。
	"""
	if geojson_data.get("type") == "FeatureCollection":
		# 各Featureのgeometryを取り出し、それぞれをshapely化してリストにまとめる
		geoms = [shape(f["geometry"]) for f in geojson_data.get("features", []) if "geometry" in f]
		return GeometryCollection(geoms)
	
	elif geojson_data.get("type") == "Feature":
		# Feature単体の場合はgeometryを取り出す
		return shape(geojson_data.get("geometry"))
	
	else:
		# すでに Geometry オブジェクトの場合
		return shape(geojson_data)


def get_geometry_coords(geom: BaseGeometry) -> List[np.ndarray]:
	"""
	ジオメトリを再帰的に走査し、描画可能な (N, 2) の座標配列のリストを返す
	"""
	coords_list = []

	if geom.is_empty:
		return coords_list

	# マルチパートジオメトリの場合は分解
	if geom.geom_type in ['GeometryCollection', 'MultiPolygon', 'MultiLineString', 'MultiPoint']:
		for part in geom.geoms:
			coords_list.extend(get_geometry_coords(part))
			
	# Polygonの場合は外周を取得 (必要に応じて内周も追加可能)
	elif geom.geom_type == 'Polygon':
		coords_list.append(np.array(geom.exterior.coords).astype(np.int32))
		
	# LineStringやPointの場合
	elif geom.geom_type in ['LineString', 'LinearRing', 'Point', 'MultiPoint']:
		coords_list.append(np.array(geom.coords).astype(np.int32))

	return coords_list


class GeoTransformer:
	def __init__(self, ao, base_epsg=4326):
		self.base_epsg = base_epsg

		if ao:
			geom = to_shapely_geom(ao.geoJson)
			center_lon, center_lat = geom.centroid.x, geom.centroid.y
			self._zone = int((center_lon + 180) / 6) + 1
			self._is_north = center_lat >= 0
		else:
			self._zone = 54
			self._is_north = True
			
		self.epsg = 32600 + self._zone if self._is_north else 32700 + self._zone
		self._to_utm_transformer = Transformer.from_crs(f"EPSG:{base_epsg}", f"EPSG:{self.epsg}", always_xy=True)
		self._to_geo_transformer = Transformer.from_crs(f"EPSG:{self.epsg}", f"EPSG:{base_epsg}", always_xy=True)


	def to_utm(self, pos: Union[GeoLocation, List[GeoLocation]]) -> Union[UTMLocation, List[UTMLocation]]:
		if isinstance(pos, list):
			lons = [p.lon for p in pos]
			lats = [p.lat for p in pos]
			xs, ys = self._to_utm_transformer.transform(lons, lats)
			return [UTMLocation(easting=x, northing=y) for x, y in zip(xs, ys)]
		
		x, y = self._to_utm_transformer.transform(pos.lon, pos.lat)
		return UTMLocation(easting=x, northing=y)


	def to_geo(self, pos: Union[UTMLocation, List[UTMLocation]]) -> Union[GeoLocation, List[GeoLocation]]:
		if isinstance(pos, list):
			eastings = [p.easting for p in pos]
			northings = [p.northing for p in pos]
			lons, lats = self._to_geo_transformer.transform(eastings, northings)
			return [GeoLocation(lat=lat, lon=lon) for lat, lon in zip(lats, lons)]
		
		lon, lat = self._to_geo_transformer.transform(pos.easting, pos.northing)
		return GeoLocation(lat=lat, lon=lon)


	def convrt_to_utm_geom(self, geom: Union[GeometryCollection, BaseGeometry]) -> Union[GeometryCollection, BaseGeometry]:
		def project(lon, lat, z=None):
			return self._to_utm_transformer.transform(lon, lat)
		
		return transform(project, geom)


	def convrt_to_geo_geom(self, geom: Union[GeometryCollection, BaseGeometry]) -> Union[GeometryCollection, BaseGeometry]:
		def project(easting, northing, z=None):
			return self._to_geo_transformer.transform(easting, northing)
		
		return transform(project, geom)


	def _reproject_mesh(self, data, src_crs_code, dst_crs_code, bounds, shape):
		"""投影変換の共通化ロジック"""
		src_crs = CRS.from_epsg(src_crs_code)
		dst_crs = CRS.from_epsg(dst_crs_code)
		
		# 出力先の定義計算
		dst_transform, dst_width, dst_height = calculate_default_transform(
			src_crs, dst_crs, shape[1], shape[0], *bounds
		)
		
		src_transform = from_bounds(*bounds, width=shape[1], height=shape[0])
		dst_array = np.full((dst_height, dst_width), -32768, dtype=np.float32)
		
		reproject(
			source=data,
			destination=dst_array,
			src_transform=src_transform,
			src_crs=src_crs,
			dst_transform=dst_transform,
			dst_crs=dst_crs,
			resampling=Resampling.cubic
		)
		
		# 変換後の範囲を計算
		lb_x, lb_y = dst_transform * (0, dst_height)
		rt_x, rt_y = dst_transform * (dst_width, 0)
		
		return dst_array, (lb_x, lb_y), (rt_x, rt_y)


	def convert_to_utm_mesh(self, mesh: GeoMesh) -> UTMMesh:
		bounds = (mesh.left_bottom.lon, mesh.left_bottom.lat, mesh.right_top.lon, mesh.right_top.lat)
		data, lb, rt = self._reproject_mesh(mesh.data, mesh.epsg, self.epsg, bounds, mesh.data.shape)
		
		return UTMMesh(
			data=data,
			left_bottom=UTMLocation(easting=lb[0], northing=lb[1]),
			right_top=UTMLocation(easting=rt[0], northing=rt[1]),
			epsg=self.epsg
		)


	def convert_to_geo_mesh(self, mesh: UTMMesh) -> GeoMesh:
		bounds = (mesh.left_bottom.easting, mesh.left_bottom.northing, mesh.right_top.easting, mesh.right_top.northing)
		data, lb, rt = self._reproject_mesh(mesh.data, mesh.epsg, self.base_epsg, bounds, mesh.data.shape)
		
		return GeoMesh(
			data=data,
			left_bottom=GeoLocation(lat=lb[1], lon=lb[0]),
			right_top=GeoLocation(lat=rt[1], lon=rt[0]),
			epsg=self.base_epsg
		)
