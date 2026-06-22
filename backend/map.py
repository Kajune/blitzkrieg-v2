from typing import Dict, List, Tuple, Optional, Any
import numpy as np
from shapely.geometry import GeometryCollection, Point, LineString
from shapely.ops import unary_union
from models import *
from geometry import *
from gis import *
from utils import *
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
		self.alt_mesh, self.map_geometries = self._prepare_map(debug=debug)
		self.slope_mesh = compute_slope_mesh(self.alt_mesh)


	def compute_maneuver(self, 
		unit: PlacedUnit, 
		action: UnitAction, 
		upos: GeoLocation, 
		tpos: GeoLocation, 
		deplyment_distribution: Dict[str, Dict],
	) -> Tuple[List[UTMLocation], bool]:
		upos = self.geo_transformer.to_utm(upos)
		tpos = self.geo_transformer.to_utm(tpos)

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
		speed = self._compute_speed(unit)

		upos_px, tpos_px = mobility_map.to_image_coord([upos, tpos])
		upos_px, tpos_px = mobility_map.clip_to_image_size([upos_px, tpos_px])

		cost_map = mobility_map.data.astype(np.float32) * self.coeffs.mobility.cost_scale[action.moveSpeed] + 1
		path_px = pyastar2d.astar_path(cost_map, 
			(int(round(upos_px[0])), int(round(upos_px[1]))), 
			(int(round(tpos_px[0])), int(round(tpos_px[1]))), 
			allow_diagonal=True
		)

		if len(path_px) <= 1:
			return self.geo_transformer.to_geo([tpos]), True

		trajectories = []
		finished = False

		path = mobility_map.from_image_coord(path_px)
		path[0] = upos
		path[-1] = tpos
		base_speed = speed * 1000 / 3600 * self.coeffs.mobility.speed_scale_by_move_mode[action.moveMode]

		# 渋滞ペナルティ
		overlap_ratio = 0
		lam_overlap = 1.0
		for unit_id, dist in deplyment_distribution.items():
			if unit_id == unit.id:
				continue
			overlap_ratio += calculate_distribution_overlap(deplyment_distribution[unit.id], dist)
		base_speed *= np.exp(-overlap_ratio * lam_overlap)

		# TODO: 火制されているときの機動速度低下もいつか入れる
		speed_cap = self.coeffs.mobility.move_speed_cap[action.moveSpeed] * 1000 / 3600
		actual_speed = np.clip(np.clip(1 - mobility_map.data, 0, 1) * base_speed, 0.5, speed_cap)

		total_t = 0
		new_position = path[0]
		for i in range(len(path) - 1):
			d = path[i].distance(path[i+1])
			s = actual_speed[path_px[i][0], path_px[i][1]]
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
		return trajectories, finished


	def _prepare_map(self, map_resolution=10.0, debug=False):
		start_time = time.time()

		if self.gis is not None:
			terrain = self.gis.load_dem(self.common_ao_geom)
			terrain = self.geo_transformer.convert_to_utm_mesh(terrain)
			terrain = terrain.resize_by_resolution(map_resolution, map_resolution)
			print(f"Terrain preparation: {time.time() - start_time:.4f} seconds")

			osm_start = time.time()
			road_condition = "\"highway\" IS NOT NULL"
			road = self.gis.load_osm_data("planet_osm_line", self.common_ao_geom, condition=road_condition)

			building_condition = "\"building\" IS NOT NULL AND building != 'no'"
			building = self.gis.load_osm_data("planet_osm_polygon", self.common_ao_geom, condition=building_condition)

			waterway_condition = "\"waterway\" IS NOT NULL"
			waterway = self.gis.load_osm_data("planet_osm_line", self.common_ao_geom, condition=waterway_condition)

			water_condition = "\"water\" IS NOT NULL"
			water = self.gis.load_osm_data("planet_osm_polygon", self.common_ao_geom, condition=water_condition)

			veg_condition = "\"natural\" IN ('wood', 'scrub', 'grassland') OR \"landuse\" IN ('forest', 'grass', 'orchard')"
			vegetation = self.gis.load_osm_data("planet_osm_polygon", self.common_ao_geom, condition=veg_condition)
			print(f"OSM data loading: {time.time() - osm_start:.4f} seconds")

		else:
			min_x, min_y, max_x, max_y = self.geo_transformer.convert_to_utm_geom(self.common_ao_geom).bounds
			width = int((max_x - min_x) / map_resolution)
			height = int((max_y - min_y) / map_resolution)
			
			terrain = UTMMesh(
				data=np.zeros((height, width)),
				left_bottom=UTMLocation(easting=min_x, northing=min_y),
				right_top=UTMLocation(easting=max_x, northing=max_y),
				epsg=self.geo_transformer.epsg
			)
			road = building = waterway = water = vegetation = None

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

			for k in ["vegetation", "fortification", "water", "waterway", "building", "road"]:
				cached_geometries[k] = geometries[force][k]

		print(f"Total loop time: {time.time() - loop_start:.4f} seconds")

		if debug:
			self._debug_plot_units_on_terrain(terrain, "debug.png", 
				geometries=geometries,
				to_utm=True
			)

			for force in geometries:
				for geom_name in geometries[force]:
					if geometries[force][geom_name]["mesh"] is not None:
						cv2.imwrite(f"{force}_{geom_name}.png", geometries[force][geom_name]["mesh"].data * 255)

		return terrain, geometries


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

		# water, waterway, buildingは大きい方で上書き
		for k in ["water", "waterway", "building"]:
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
		mobility_map.data[self.map_geometries[force]["ao"]["mesh"].data == 0] = 1

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
