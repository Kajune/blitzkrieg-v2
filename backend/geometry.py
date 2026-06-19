from typing import Dict, List, Tuple, Optional, Any
from pyproj import Transformer
from shapely.geometry import shape, GeometryCollection
from models import *


def to_shapely_geom(geojson_data: Dict[str, Any]):
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



class GeoTransformer:
	def __init__(self, ao):
		if ao:
			geom = to_shapely_geom(ao.geoJson)
			center_lon, center_lat = geom.centroid.x, geom.centroid.y
			self._zone = int((center_lon + 180) / 6) + 1
			self._is_north = center_lat >= 0
		else:
			self._zone = 54
			self._is_north = True
			
		epsg = 32600 + self._zone if self._is_north else 32700 + self._zone
		self._to_utm_transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
		self._to_geo_transformer = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)


	def to_utm(self, pos: GeoLocation) -> UTMLocation:
		x, y = self._to_utm_transformer.transform(pos.lon, pos.lat)
		return UTMLocation(easting=x, northing=y)


	def to_geo(self, pos: UTMLocation) -> GeoLocation:
		lon, lat = self._to_geo_transformer.transform(pos.easting, pos.northing)
		return GeoLocation(lat=lat, lon=lon)
