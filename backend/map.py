from typing import Dict, List, Tuple, Optional, Any
import numpy as np
from shapely.geometry import GeometryCollection, Point, LineString
from shapely.ops import unary_union
from models import *
from geometry import *
from gis import *
from utils import *
from los import compute_multi_mva_maps, compute_pairs_los
from functools import lru_cache
import pyastar2d
import cv2, time, copy


class Map:
	def __init__(self, sim_setting: SimSetting, vehicles, coeffs: Coefficients, debug: bool = False):
		self._sim_setting = sim_setting
		self.vehicles = vehicles
		self.coeffs = coeffs

		self.ao = {force: None for force in Force}
		self.common_ao_geom = None
		self.fortifications = {force: [] for force in Force}
		self.obstacles = {force: [] for force in Force}

		for map_element in self._sim_setting.mapElements:
			if map_element.type == ElementType.OPERATION:
				self.ao[map_element.force] = map_element
			elif map_element.type == ElementType.FORTIFICATION:
				self.fortifications[map_element.force].append(map_element)
			elif map_element.type == ElementType.OBSTACLE:
				self.obstacles[map_element.force].append(map_element)

		ao_geoms = [to_shapely_geom(element.geoJson) for element in self.ao.values() if element is not None]
		if ao_geoms:
			self.common_ao_geom = unary_union(ao_geoms)

		if self.common_ao_geom is None:
			raise ValueError("Operation area is not defined.")

		self.geo_transformer = GeoTransformer(self.common_ao_geom, base_epsg=os.getenv("DEM_EPSG"))
		try:
			self.gis = PostGIS()
		except Exception as e:
			self.gis = None
		self.alt_mesh, self.map_geometries, self.cached_map_geometries = self._prepare_map(debug=debug)
		self.slope_mesh = compute_slope_mesh(self.alt_mesh)


	def get_elevation(self, pts: np.ndarray) -> np.ndarray:
		"""
		pts: (N, 2) の numpy 配列 (easting, northing)
		戻り値: (N,) の numpy 配列 (各点の標高)
		"""
		# UTMLocationのリストに変換してから to_image_coord を利用
		# pts は np.array なので、各行を UTMLocation に変換する
		utm_locations = [UTMLocation(easting=p[0], northing=p[1]) for p in pts]
		
		# 画像座標 (pixel_x, pixel_y) に変換
		px_coords = self.alt_mesh.to_image_coord(utm_locations)
		
		# 整数化して範囲内にクリップ（画像外参照を防ぐ）
		px_x = np.clip(np.round(px_coords[:, 0]).astype(int), 0, self.alt_mesh.data.shape[0] - 1)
		px_y = np.clip(np.round(px_coords[:, 1]).astype(int), 0, self.alt_mesh.data.shape[1] - 1)
		
		# 標高を取得
		elevations = self.alt_mesh.data[px_x, px_y]
		
		return elevations


	def compute_visibility(self, pts1 : np.ndarray, pts2 : np.ndarray) -> List[bool]:
		pair_results = compute_pairs_los(self.alt_mesh.data, *self.alt_mesh.resolution, pts1, pts2)
		return [r > 0 for r in pair_results]


	def compute_maneuver(self, 
		unit: PlacedUnit, 
		action: UnitAction, 
		upos: GeoLocation, 
		tpos: GeoLocation, 
		deplyment_distribution: Dict[str, Dict],
		path: Optional[List[GeoLocation]],
	) -> Tuple[List[GeoLocation], bool, List[GeoLocation]]:
		upos = self.geo_transformer.to_utm(upos)
		tpos = self.geo_transformer.to_utm(tpos)
		if path is not None:
			path = self.geo_transformer.to_utm(path)

		# tposがAOをはみ出しているときは、はみ出さないぎりぎりの場所でクリップ
		ao_geom = self.map_geometries[unit.force]["ao"]["geom"]
		if not ao_geom.contains(tpos.to_shapely()):
			line = LineString([upos.to_shapely(), tpos.to_shapely()])
			intersection = line.intersection(ao_geom.boundary)
			
			if intersection is not None and not intersection.is_empty:
				if intersection.geom_type == 'MultiPoint':
					tpos_utm_shapely = min(intersection.geoms, key=lambda p: p.distance(tpos.to_shapely()))
				else:
					tpos_utm_shapely = intersection
				tpos = UTMLocation.from_shapely(tpos_utm_shapely)

		mobility_map = self._compute_mobility_map(unit, deplyment_distribution[unit.id])
		upos_px, tpos_px = mobility_map.to_image_coord([upos, tpos])

		speed = self._compute_speed(unit) * 1000 / 3600
		max_dist_px = (speed * self._sim_setting.simConfig.tickInterval) / mobility_map.resolution[0]

		if path is None or len(path) <= 2:
			dist_px = np.sqrt((tpos_px[0] - upos_px[0])**2 + (tpos_px[1] - upos_px[1])**2)
			
			target_px = tpos_px
			if dist_px > max_dist_px:
				scale = dist_px / max_dist_px
				new_shape = (int(mobility_map.data.shape[1] / scale), int(mobility_map.data.shape[0] / scale))
				low_res_map = cv2.resize(mobility_map.data, new_shape, interpolation=cv2.INTER_LINEAR)
				cost_map = low_res_map * self.coeffs.mobility.cost_scale[action.moveSpeed] + 1			

				low_res_path = pyastar2d.astar_path(
					cost_map,
					(int(upos_px[0] / scale), int(upos_px[1] / scale)),
					(int(tpos_px[0] / scale), int(tpos_px[1] / scale)),
					allow_diagonal=True
				)
				
				for p in low_res_path:
					p_orig = (p[0] * scale, p[1] * scale)
					if np.sqrt((p_orig[0] - upos_px[0])**2 + (p_orig[1] - upos_px[1])**2) > max_dist_px:
						target_px = (int(p_orig[0]), int(p_orig[1]))
						break

			cost_map = mobility_map.data * self.coeffs.mobility.cost_scale[action.moveSpeed] + 1
			path_px = pyastar2d.astar_path(
				cost_map,
				(int(round(upos_px[0])), int(round(upos_px[1]))),
				(int(round(target_px[0])), int(round(target_px[1]))),
				allow_diagonal=True
			)

			if len(path_px) <= 1:
				return self.geo_transformer.to_geo([tpos]), True, self.geo_transformer.to_geo([tpos])

			path = mobility_map.from_image_coord(path_px)
			path[0] = upos
			path[-1] = tpos
		else:
			path[0] = upos
			path[-1] = tpos
			path_px = mobility_map.to_image_coord(path)

		finished = False
		base_speed = speed * self.coeffs.mobility.speed_scale_by_move_mode[action.moveMode]

		# 渋滞ペナルティ
		overlap_ratio = 0
		lam_overlap = 1.0
		for unit_id, dist in deplyment_distribution.items():
			if unit_id == unit.id:
				continue
			overlap_ratio += calculate_distribution_overlap(deplyment_distribution[unit.id], dist)
		base_speed *= np.exp(-overlap_ratio * lam_overlap)

		speed_cap = self.coeffs.mobility.move_speed_cap[action.moveSpeed] * 1000 / 3600
		actual_speed = (1 - mobility_map.data)
		np.clip(actual_speed, 0, 1, out=actual_speed)
		actual_speed *= base_speed * (1 - unit.suppressionRate)
		np.clip(actual_speed, 0.5, speed_cap, out=actual_speed)

		total_t = 0
		new_position = path[0]
		i = 0
		trajectories = []

		for i in range(len(path) - 1):
			d = path[i].distance(path[i+1])
			s = actual_speed[int(path_px[i][0]), int(path_px[i][1])]
			t = d / s

			if total_t + t > self._sim_setting.simConfig.tickInterval:
				new_position = path[i].move(
					path[i].direction(path[i+1]),
					(self._sim_setting.simConfig.tickInterval - total_t) * s
				)
				trajectories.append(new_position)
				break
			else:
				total_t += t
				new_position = path[i+1]
				trajectories.append(new_position)
				if i == len(path) - 2:
					finished = True

		if len(trajectories) >= 3:
			trajectories_np = np.array([[p.easting, p.northing] for p in trajectories])
			trajectories_np = smooth_linestring(trajectories_np, max_dist=mobility_map.resolution[0])
			trajectories = [UTMLocation(easting=p[0], northing=p[1]) for p in trajectories_np]

		trajectories = self.geo_transformer.to_geo(trajectories)
		return trajectories, finished, self.geo_transformer.to_geo(path[i:]) if len(path) > i else []


	def _prepare_map(self, map_resolution=20.0, debug=False):
		start_time = time.time()

		if self.gis is not None:
			terrain = self.gis.load_dem(self.common_ao_geom)
			terrain.data = terrain.data.astype(np.float32)
			terrain = self.geo_transformer.convert_to_utm_mesh(terrain)
			terrain = terrain.resize_by_resolution(map_resolution, map_resolution)

			print(f"Terrain preparation: {time.time() - start_time:.4f} seconds")

			osm_start = time.time()
			
			# 道路
			road_condition = "\"highway\" IS NOT NULL"
			road, road_fclass = self.gis.load_osm_data("planet_osm_line", self.common_ao_geom, condition=road_condition, extra_fields=["highway"])

			# 建物
			building_condition = "\"building\" IS NOT NULL AND building != 'no'"
			building, building_fclass = self.gis.load_osm_data("planet_osm_polygon", self.common_ao_geom, condition=building_condition)

			# 内陸の河川・水路
			waterway_condition = "\"waterway\" IS NOT NULL"
			waterway, waterway_fclass = self.gis.load_osm_data("planet_osm_line", self.common_ao_geom, condition=waterway_condition)

			# 内陸の水域 (湖など)
			water_condition = "\"water\" IS NOT NULL"
			water, water_fclass = self.gis.load_osm_data("planet_osm_polygon", self.common_ao_geom, condition=water_condition)

			# 海
			sea, sea_fclass = self.gis.load_osm_data("osm_water_polygons", self.common_ao_geom, condition="", geom_col="geom")

			# 植生
			veg_condition = "\"natural\" IN ('wood', 'scrub', 'grassland') OR \"landuse\" IN ('forest', 'grass', 'orchard')"
			vegetation, vegetation_fclass = self.gis.load_osm_data("planet_osm_polygon", self.common_ao_geom, condition=veg_condition)

			print(f"OSM data loading: {time.time() - osm_start:.4f} seconds")

		else:
			min_x, min_y, max_x, max_y = self.geo_transformer.convert_to_utm_geom(self.common_ao_geom).bounds
			width = int((max_x - min_x) / map_resolution)
			height = int((max_y - min_y) / map_resolution)
			
			terrain = UTMMesh(
				data=np.zeros((height, width), dtype=np.float32),
				left_bottom=UTMLocation(easting=min_x, northing=min_y),
				right_top=UTMLocation(easting=max_x, northing=max_y),
				epsg=self.geo_transformer.epsg
			)
			road = building = waterway = water = sea = vegetation = None
			road_fclass = building_fclass = waterway_fclass = water_fclass = sea_fclass = vegetation_fclass = None

		loop_start = time.time()
		geometries = {}
		cached_geometries = {}
		for force in Force:
			fortification_geoms = []
			for f in Force:
				for fortification in self.fortifications[f]:
					fortification_geoms.append(to_shapely_geom(fortification.geoJson))
			fortification_geoms = GeometryCollection(fortification_geoms)
			obstacle_geoms = GeometryCollection([to_shapely_geom(obstacle.geoJson) for obstacle in self.obstacles[force]])
			ao_geom = to_shapely_geom(self.ao[force].geoJson) if self.ao[force] is not None else self.common_ao_geom

			geometries[force] = {
				"vegetation": {"geom": vegetation, "type": "polygon", "color": [100, 255, 100]},
				"fortification": {"geom": fortification_geoms, "type": "polygon", "color": [255, 255, 100]},
				"water": {"geom": water, "type": "polygon", "color": [255, 100, 100]},
				"waterway": {"geom": waterway, "type": "polyline", "color": [255, 100, 100], "width": 10},
				"sea": {"geom": sea, "type": "polygon", "color": [255, 100, 100]},
				"building": {"geom": building, "type": "polygon", "color": [100, 100, 100]},
				"road": {"geom": road, "type": "polyline", "color": [255, 255, 255], "width": 10},
				"obstacle": {"geom": obstacle_geoms, "type": "polygon", "color": [100, 255, 255]},
				"ao": {"geom": ao_geom, "type": "polygon", "color": [0, 0, 255]}
			}

			for k in cached_geometries:
				geometries[force][k] = cached_geometries[k]

			for geom_name, val in geometries[force].items():
				if "mesh" in val:
					continue
				if val["geom"] is None:
					# データがない場合は、地形と同じサイズのゼロメッシュを代入しておく
					val["mesh"] = UTMMesh(
						data=np.zeros_like(terrain.data),
						left_bottom=terrain.left_bottom,
						right_top=terrain.right_top,
						epsg=terrain.epsg
					)
					continue

				item_start = time.time()
				
				geometries[force][geom_name]["geom"] = self.geo_transformer.convert_to_utm_geom(geometries[force][geom_name]["geom"])
				geom_pixel = terrain.to_image_geom(geometries[force][geom_name]["geom"])
				geom_coords_list = get_geometry_coords(geom_pixel)

				img = np.zeros_like(terrain.data)

				if geometries[force][geom_name]["type"] == "polyline":
					if geom_name == "road":
						road_costs = {
							'motorway': 0.0,
							'primary': 0.0,
							'secondary': 0.1,
							'tertiary': 0.2,
							'residential': 0.3,
							'default': 1.0
						}

						road_groups = {}
						for i, geom in enumerate(geometries[force][geom_name]["geom"].geoms):
							fclass = road_fclass[i] if i < len(road_fclass) else 'default'
							if fclass not in road_groups:
								road_groups[fclass] = []
							road_groups[fclass].append(geom)

						for fclass, geoms in road_groups.items():
							cost = road_costs.get(fclass, road_costs['default'])
							
							for g in geoms:
								geom_pixel = terrain.to_image_geom(g)
								geom_coords = get_geometry_coords(geom_pixel)
								cv2.polylines(img, geom_coords, isClosed=False, color=cost, 
									thickness=max(1, int(geometries[force][geom_name]["width"] / map_resolution)))
					else:
						cv2.polylines(img, geom_coords_list, isClosed=False, color=1, 
							thickness=max(1, int(geometries[force][geom_name]["width"] / map_resolution)))
				elif geometries[force][geom_name]["type"] == "polygon":
					cv2.fillPoly(img, geom_coords_list, color=1)
				else:
					raise ValueError

				geometries[force][geom_name]["mesh"] = UTMMesh(data=img, 
					left_bottom=terrain.left_bottom, 
					right_top=terrain.right_top, 
					epsg=terrain.epsg)
				
				print(f"Processing {geom_name} ({force}): {time.time() - item_start:.4f} seconds")

			for k in ["vegetation", "fortification", "water", "waterway", "sea", "building", "road"]:
				cached_geometries[k] = geometries[force][k]

		print(f"Total loop time: {time.time() - loop_start:.4f} seconds")

		if debug:
			self._debug_plot_units_on_terrain(terrain, "debug.png", 
				geometries=cached_geometries,
				to_utm=True
			)

			for force in geometries:
				for geom_name in geometries[force]:
					if geometries[force][geom_name]["mesh"] is not None:
						cv2.imwrite(f"{force}_{geom_name}.png", geometries[force][geom_name]["mesh"].data * 255)

		return terrain, geometries, cached_geometries


	def _get_unit_mobility_composition(self, unit: PlacedUnit) -> dict:
		current_eqs = get_current_equipments(unit)
		current_personnel = get_current_personnel(unit)
		
		if current_personnel <= 0:
			return {VehicleType.FOOT: 0}
			
		composition = {k: 0 for k in VehicleType}
		total_capacity = 0
		
		for eq_name, eq_num in current_eqs.items():
			if eq_name in self.vehicles:
				v = self.vehicles[eq_name]
				total_capacity += v.personnel_capacity * eq_num
				composition[v.type] = composition.get(v.type, 0) + eq_num
				
		if total_capacity < current_personnel:
			composition[VehicleType.FOOT] = current_personnel - total_capacity
			
		return composition


	def _compute_speed(self, unit: PlacedUnit, foot_speed: float = 4.0) -> float:
		comp = self._get_unit_mobility_composition(unit)
		
		speeds = []
		total_personnel = get_current_personnel(unit)
		
		for eq_name, eq_num in get_current_equipments(unit).items():
			if eq_name in self.vehicles:
				speeds += [self.vehicles[eq_name].max_speed] * eq_num
		
		personnel_in_vehicles = sum(self.vehicles[e].personnel_capacity * n 
									for e, n in get_current_equipments(unit).items() 
									if e in self.vehicles)
		if total_personnel > personnel_in_vehicles:
			speeds += [foot_speed] * (total_personnel - personnel_in_vehicles)

		return np.mean(speeds) if speeds else foot_speed


	@lru_cache(maxsize=None)
	def _compute_mobility_map_impl(self, coeffs : Dict, force : Force, climb_power: float = 30.0) -> UTMMesh:
		coeffs = dict(coeffs)

		# 基本は斜度
		mobility_map = copy.deepcopy(self.slope_mesh)
		mobility_map.data /= climb_power

		# vegetation, fortificationは加算
		for k in ["vegetation", "fortification"]:
			mobility_map.data += self.map_geometries[force][k]["mesh"].data * coeffs[k]

		# water, waterway, sea, buildingは大きい方で上書き
		for k in ["water", "waterway", "sea", "building"]:
			mobility_map.data = np.maximum(mobility_map.data, self.map_geometries[force][k]["mesh"].data * coeffs[k])

		# roadは小さい方で上書き
		for k in ["road"]:
			mobility_map.data = np.minimum(mobility_map.data, (1 - self.map_geometries[force][k]["mesh"].data))

		# obstacleは加算
		for k in ["obstacle"]:
			for f in Force:
				if f == force:
					continue
				mobility_map.data += self.map_geometries[f][k]["mesh"].data * coeffs[k]

		# aoは絶対
		mobility_map.data[self.map_geometries[force]["ao"]["mesh"].data == 0] = 1.0

		mobility_map.data = mobility_map.data.astype(np.float32)
		return mobility_map


	def get_natural_mobility_map(self, return_geo_mesh : bool = False, climb_power: float = 30.0) -> Union[UTMMesh, GeoMesh]:
		# 基本は斜度
		mobility_map = copy.deepcopy(self.slope_mesh)
		mobility_map.data /= climb_power

		# vegetation, fortificationは加算
		for k in ["vegetation", "fortification"]:
			mobility_map.data += self.cached_map_geometries[k]["mesh"].data

		# water, waterway, sea, buildingは大きい方で上書き
		for k in ["water", "waterway", "sea", "building"]:
			mobility_map.data = np.maximum(mobility_map.data, self.cached_map_geometries[k]["mesh"].data)

		# roadは小さい方で上書き
		for k in ["road"]:
			mobility_map.data = np.minimum(mobility_map.data, (1 - self.cached_map_geometries[k]["mesh"].data))

		mobility_map.data = mobility_map.data.astype(np.float32)

		if return_geo_mesh:
			mobility_map = self.geo_transformer.convert_to_geo_mesh(mobility_map)

		return mobility_map


	def _compute_mobility_map(self, unit: PlacedUnit, deplyment_distribution: Dict) -> UTMMesh:
		vehicle_types = self._get_unit_mobility_composition(unit)
		
		coeffs = {geom_type: [] for geom_type in self.map_geometries[unit.force]}
		for v_type, num in vehicle_types.items():
			mobility_cost = self.coeffs.mobility.cost.get(v_type, {})
			for geom_type in self.map_geometries[unit.force]:
				coeffs[geom_type] += [mobility_cost.get(geom_type, 0)] * num

		coeffs = {k: np.mean(v) if v else 0 for k, v in coeffs.items()}

		mobility_map = self._compute_mobility_map_impl(frozenset(coeffs.items()), unit.force)

		"""
		sigma_meters = np.mean(deplyment_distribution["sigma"])
		res_x, res_y = mobility_map.resolution
		avg_res = (res_x + res_y) / 2.0
		sigma_pixels = sigma_meters / avg_res

		if sigma_pixels > 0.1:
			kernel_size = int(round(sigma_pixels * 3) * 2 + 1)
			mobility_map.data = cv2.GaussianBlur(
				mobility_map.data, 
				(kernel_size, kernel_size), 
				sigmaX=sigma_pixels, 
				sigmaY=sigma_pixels
			)
		"""

		return mobility_map


	def _debug_plot_units_on_terrain(self, terrain: Union[GeoMesh, UTMMesh], filename: str, geometries, to_utm=False):
		valid_terrain = terrain.data[terrain.data > 0]
		min_alt = np.min(valid_terrain)
		max_alt = np.max(valid_terrain)
		norm_data = (terrain.data - min_alt) / (max_alt - min_alt)
		img = (norm_data * 255).astype(np.uint8)
		plot_img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
		plot_img[terrain.data < 0] = [0, 0, 255]

		unit_positions = [u.position for u in self._sim_setting.placedUnits]

		if to_utm:
			unit_positions = self.geo_transformer.to_utm(unit_positions)

		for geom_name, geometry in geometries.items():
			if geometry["geom"] is None:
				continue
			geom_pixel = terrain.to_image_geom(geometry["geom"])
			geom_coords_list = get_geometry_coords(geom_pixel)

			if geom_name == "ao":
				cv2.polylines(plot_img, geom_coords_list, isClosed=True, color=geometry["color"], thickness=1)
			else:
				if geometry["type"] == "polyline":
					cv2.polylines(plot_img, geom_coords_list, isClosed=False, color=geometry["color"], thickness=1)
				elif geometry["type"] == "polygon":
					cv2.fillPoly(plot_img, geom_coords_list, color=geometry["color"])

		img_coords = terrain.to_image_coord(unit_positions)
		for pos in img_coords:
			y, x = int(pos[0]), int(pos[1])
			if 0 <= x < plot_img.shape[1] and 0 <= y < plot_img.shape[0]:
				cv2.circle(plot_img, (x, y), radius=3, color=(0, 0, 255), thickness=-1)
		
		cv2.imwrite(filename, plot_img)
