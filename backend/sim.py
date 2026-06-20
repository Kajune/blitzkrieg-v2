from dataclasses import dataclass
from enum import Enum
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any
import numpy as np
from shapely.geometry import GeometryCollection
from models import *
from geometry import *
from gis import *
import json, msgspec, copy
import pyastar2d
import cv2, time


def remove_duplicated_units(units: List[Unit], existing_unit_ids: List[str] = None) -> List[Unit]:
	if existing_unit_ids is None:
		existing_unit_ids = []

	for unit in units:
		existing_unit_ids.append(unit.id)

	for unit in units:
		current_existing_ids = list(existing_unit_ids)
		
		unit.lower_units = [
			u for u in unit.lower_units 
			if u.id not in current_existing_ids
		]
		
		remove_duplicated_units(unit.lower_units, list(current_existing_ids))
		
	return units


def aggregate_objects(unit: Unit, fetch_fn, aggr_dict: Dict[str, int] = None) -> Dict[str, int]:
	if aggr_dict is None:
		aggr_dict = {}

	for k, v in fetch_fn(unit).items():
		if k not in aggr_dict and v > 0:
			aggr_dict[k] = 0
		aggr_dict[k] += v

	for lower_unit in unit.lower_units:
		aggregate_objects(lower_unit, fetch_fn, aggr_dict)

	return aggr_dict


def get_current_personnel(unit: Unit) -> int:
	return aggregate_objects(unit, lambda unit: {"personnel": unit.current_personnel})["personnel"]


def get_current_equipments(unit: Unit) -> Dict[str, int]:
	return aggregate_objects(unit, lambda unit: unit.current_equipments)



class Simulation:
	def __init__(self, sim_setting: SimSetting, debug=False):
		self._sim_setting = sim_setting

		#
		# Unit
		#
		self.weapons = []
		self.vehicles = []

		try:
			with open("data/equipments.json") as f:
				equipments = json.load(f)
				for weapon in equipments["weapons"]:
					self.weapons.append(msgspec.convert(weapon, Weapon))
				for vehicle in equipments["vehicles"]:
					self.vehicles.append(msgspec.convert(vehicle, Vehicle))
		except Exception as e:
			print(e)

		self.weapons = {w.name: w for w in self.weapons}
		self.vehicles = {v.name: v for v in self.vehicles}
		self.equipments = {**self.weapons, **self.vehicles}

		try:
			with open("data/mobility_cost.json") as f:
				mobility_cost = json.load(f)

				self.mobility_cost = {}
				for vt, mc in mobility_cost.items():
					self.mobility_cost[VehicleType(vt)] = mc

		except Exception as e:
			print(e)

		self.mobility_cost_scale = {
			MoveSpeed.LOW: 1,
			MoveSpeed.MEDIUM: 10,
			MoveSpeed.HIGH: 100,
		}

		self.move_speed_cap = {
			MoveSpeed.LOW: 4.0,
			MoveSpeed.MEDIUM: 20,
			MoveSpeed.HIGH: np.inf,
		}

		self.speed_scale_by_move_mode = {
			MoveMode.MARCH: 1.0,
			MoveMode.COMBAT: 0.5,
			MoveMode.DEFENSE: 0.0,
			MoveMode.ARTILLERY: 0.1,
		}

		for unit in remove_duplicated_units(self._sim_setting.placedUnits):
			for eq_name in get_current_equipments(unit):
				assert eq_name in self.equipments, f"Unknown equipment: {eq_name}"

		#
		# Map
		#
		self.ao = None
		self.fortifications = []
		self.obstacles = []

		for map_element in self._sim_setting.mapElements:
			if map_element.type == ElementType.OPERATION:
				self.ao = map_element
			elif map_element.type == ElementType.FORTIFICATION:
				self.fortifications.append(map_element)
			elif map_element.type == ElementType.OBSTACLE:
				self.obstacles.append(map_element)

		if self.ao is None:
			raise ValueError("Operation area is not defined.")

		self.geo_transformer = GeoTransformer(self.ao, base_epsg=os.getenv("DEM_EPSG"))
		self.gis = PostGIS()
		self.alt_mesh, self.map_geometries = self._prepare_map(debug=debug)
		self.slope_mesh = compute_slope_mesh(self.alt_mesh)


	def _prepare_map(self, map_resolution=10.0, debug=False):
		start_time = time.time()

		ao_geom = to_shapely_geom(self.ao.geoJson)
		terrain = self.gis.load_dem(ao_geom)
		terrain = self.geo_transformer.convert_to_utm_mesh(terrain)
		terrain = terrain.resize_by_resolution(map_resolution, map_resolution)
		print(f"Terrain preparation: {time.time() - start_time:.4f} seconds")

		osm_start = time.time()
		road_condition = "\"highway\" IS NOT NULL"
		road = self.gis.load_osm_data("planet_osm_line", ao_geom, condition=road_condition)

		building_condition = "\"building\" IS NOT NULL AND building != 'no'"
		building = self.gis.load_osm_data("planet_osm_polygon", ao_geom, condition=building_condition)

		waterway_condition = "\"waterway\" IS NOT NULL"
		waterway = self.gis.load_osm_data("planet_osm_line", ao_geom, condition=waterway_condition)

		water_condition = "\"water\" IS NOT NULL"
		water = self.gis.load_osm_data("planet_osm_polygon", ao_geom, condition=water_condition)

		veg_condition = "\"natural\" IN ('wood', 'scrub', 'grassland') OR \"landuse\" IN ('forest', 'grass', 'orchard')"
		vegetation = self.gis.load_osm_data("planet_osm_polygon", ao_geom, condition=veg_condition)
		print(f"OSM data loading: {time.time() - osm_start:.4f} seconds")

		fortification_geoms = GeometryCollection([to_shapely_geom(fortification.geoJson) for fortification in self.fortifications])
		obstacle_geoms = GeometryCollection([to_shapely_geom(obstacle.geoJson) for obstacle in self.obstacles])

		geometries = {
			"vegetation": {"geom": vegetation, "type": "polygon", "color": [100, 255, 100]},
			"fortification": {"geom": fortification_geoms, "type": "polygon", "color": [255, 255, 100]},
			"water": {"geom": water, "type": "polygon", "color": [255, 100, 100]},
			"waterway": {"geom": waterway, "type": "polyline", "color": [255, 100, 100], "width": 10},
			"building": {"geom": building, "type": "polygon", "color": [100, 100, 100]},
			"road": {"geom": road, "type": "polyline", "color": [255, 255, 255], "width": 10},
			"obstacle": {"geom": obstacle_geoms, "type": "polygon", "color": [100, 255, 255]},
			"ao": {"geom": ao_geom, "type": "polygon", "color": [0, 0, 255]}
		}

		loop_start = time.time()
		for geom_name in geometries:
			item_start = time.time()
			
			geometries[geom_name]["geom"] = self.geo_transformer.convrt_to_utm_geom(geometries[geom_name]["geom"])
			geom_pixel = terrain.to_image_geom(geometries[geom_name]["geom"])
			geom_coords_list = get_geometry_coords(geom_pixel)

			img = np.zeros_like(terrain.data)

			if geometries[geom_name]["type"] == "polyline":
				cv2.polylines(img, geom_coords_list, isClosed=False, color=1, 
					thickness=max(1, int(geometries[geom_name]["width"] / map_resolution)))
			elif geometries[geom_name]["type"] == "polygon":
				cv2.fillPoly(img, geom_coords_list, color=1)
			else:
				raise ValueError

			geometries[geom_name]["mesh"] = UTMMesh(data=img, 
				left_bottom=terrain.left_bottom, 
				right_top=terrain.right_top, 
				epsg=terrain.epsg)
			
			print(f"Processing {geom_name}: {time.time() - item_start:.4f} seconds")
		
		print(f"Total loop time: {time.time() - loop_start:.4f} seconds")

		if debug:
			self._debug_plot_units_on_terrain(terrain, "debug.png", 
				geometries=geometries,
				to_utm=True
			)

			for geom_name in geometries:
				cv2.imwrite(f"{geom_name}.png", geometries[geom_name]["mesh"].data * 255)

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


	def _compute_mobility_map(self, unit: PlacedUnit, climb_power: float = 30.0) -> UTMMesh:
		vehicle_types = self._get_unit_mobility_composition(unit)
		
		coeffs = {geom_type: [] for geom_type in self.map_geometries}
		for v_type, num in vehicle_types.items():
			mobility_cost = self.mobility_cost.get(v_type, {})
			for geom_type in self.map_geometries:
				coeffs[geom_type] += [mobility_cost.get(geom_type, 0)] * num

		coeffs = {k: np.mean(v) if v else 0 for k, v in coeffs.items()}

		# 基本は斜度
		mobility_map = copy.deepcopy(self.slope_mesh)
		mobility_map.data /= climb_power

		# vegetation, fortificationは加算
		for k in ["vegetation", "fortification"]:
			mobility_map.data += self.map_geometries[k]["mesh"].data * coeffs[k]

		# water, waterway, buildingは大きい方で上書き
		for k in ["water", "waterway", "building"]:
			mobility_map.data = np.maximum(mobility_map.data, self.map_geometries[k]["mesh"].data * coeffs[k])

		# roadは小さい方で上書き
		for k in ["road"]:
			mobility_map.data = np.minimum(mobility_map.data, (1 - self.map_geometries[k]["mesh"].data))

		# obstacleは加算
		for k in ["obstacle"]:
			mobility_map.data += self.map_geometries[k]["mesh"].data * coeffs[k]

		# aoは絶対
		mobility_map.data[self.map_geometries["ao"]["mesh"].data == 0] = 1

		return mobility_map


	def maneuver_evaluation(self, placed_units : Dict[str, PlacedUnit], updated_units : Dict[str, UnitRecord]) -> Dict[str, UnitRecord]:
		for unit_id, record in updated_units.items():
			if not record.actions:
				continue

			for ai, action in enumerate(record.actions):
				if action.finished:
					continue

				target_pos = action.targetPosition or (placed_units[action.targetUnitId].position if action.targetUnitId in placed_units else None)
				
				if not target_pos:
					continue

				unit = placed_units[unit_id]
				mobility_map = self._compute_mobility_map(unit)
				speed = self._compute_speed(unit)

				upos = self.geo_transformer.to_utm(record.position)
				tpos = self.geo_transformer.to_utm(target_pos)

				upos_px, tpos_px = mobility_map.to_image_coord([upos, tpos])

				cost_map = mobility_map.data.astype(np.float32) * self.mobility_cost_scale[action.moveSpeed] + 1
				path_px = pyastar2d.astar_path(cost_map, 
					(int(round(upos_px[0])), int(round(upos_px[1]))), 
					(int(round(tpos_px[0])), int(round(tpos_px[1]))), 
					allow_diagonal=True
				)

				if len(path_px) > 1:
					path = mobility_map.from_image_coord(path_px)
					path[0] = upos
					path[-1] = tpos
					base_speed = speed * 1000 / 3600 * self.speed_scale_by_move_mode[action.moveMode]
					speed_cap = self.move_speed_cap[action.moveSpeed] * 1000 / 3600
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
							break
						else:
							total_t += t
							new_position = path[i+1]
							if i == len(path) - 2:
								record.actions[ai].finished = True

				else:
					new_position = tpos
					record.actions[ai].finished = True

				record.position = self.geo_transformer.to_geo(new_position)

				break

		return updated_units


	def intelligence_evaluation(self, placed_units : Dict[str, PlacedUnit], updated_units : Dict[str, UnitRecord]) -> Dict[str, UnitRecord]:
		return updated_units


	def combat_evaluation(self, placed_units : Dict[str, PlacedUnit], updated_units : Dict[str, UnitRecord]) -> Dict[str, UnitRecord]:
		return updated_units


	def step(self, sim_request: SimRequest) -> SimResponse:
		placed_units = remove_duplicated_units(sim_request.placed_units)
		updated_units = {}
		
		for unit in placed_units:
			updated_units[unit.id] = UnitRecord(
				position=unit.position,
				actions=list(unit.actions)
			)

		placed_units = {u.id: u for u in placed_units}

		num_loops = int(sim_request.delta_time / self._sim_setting.simConfig.tickInterval / 1000)

		for _ in range(num_loops):
			updated_units = self.maneuver_evaluation(placed_units, updated_units)
			updated_units = self.intelligence_evaluation(placed_units, updated_units)
			updated_units = self.combat_evaluation(placed_units, updated_units)

		return SimResponse(
			success=True,
			sim_id=sim_request.sim_id,
			startDateTime=sim_request.current_time,
			endDateTime=sim_request.current_time + sim_request.delta_time,
			unitRecords=updated_units,
		)


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
