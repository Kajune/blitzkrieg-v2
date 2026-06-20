from dataclasses import dataclass
from enum import Enum
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any
import numpy as np
from shapely.geometry import GeometryCollection
from models import *
from geometry import *
from gis import *
import cv2, time


class Simulation:
	def __init__(self, sim_setting: SimSetting, debug=False):
		self._sim_setting = sim_setting

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
				cv2.polylines(img, geom_coords_list, isClosed=False, color=255, 
					thickness=max(1, int(geometries[geom_name]["width"] / map_resolution)))
			elif geometries[geom_name]["type"] == "polygon":
				cv2.fillPoly(img, geom_coords_list, color=255)
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
				cv2.imwrite(f"{geom_name}.png", geometries[geom_name]["mesh"].data)

		return terrain, geometries


	def _get_move_speed_mps(self, speed: MoveSpeed, mode: MoveMode) -> float:
		kmh = 5.0 if speed == MoveSpeed.LOW else (20.0 if speed == MoveSpeed.MEDIUM else 50.0)
		return (kmh * 1000 / 3600) * (0.5 if mode == MoveMode.COMBAT else 1.0)


	def maneuver_evaluation(self, placed_units : List[PlacedUnit], updated_units : Dict[str, UnitRecord]) -> Dict[str, UnitRecord]:
		for unit_id, record in updated_units.items():
			if not record.actions:
				continue

			for ai, action in enumerate(record.actions):
				if action.finished:
					continue

				target_pos = action.targetPosition or (unit_map[action.targetUnitId].position if action.targetUnitId in unit_map else None)
				
				if not target_pos:
					continue

				upos = self.geo_transformer.to_utm(record.position)
				tpos = self.geo_transformer.to_utm(target_pos)

				dist = tpos.distance(upos)
				move_dist_per_tick = self._get_move_speed_mps(action.moveSpeed, action.moveMode) * self._sim_setting.simConfig.tickInterval

				if dist <= move_dist_per_tick:
					record.position = target_pos
					record.actions[ai].finished = True
				else:
					record.position = self.geo_transformer.to_geo(
						upos.move(
							angle=tpos.direction(upos), 
							distance=move_dist_per_tick)
						)

				break

		return updated_units


	def intelligence_evaluation(self, placed_units : List[PlacedUnit], updated_units : Dict[str, UnitRecord]) -> Dict[str, UnitRecord]:
		return updated_units


	def combat_evaluation(self, placed_units : List[PlacedUnit], updated_units : Dict[str, UnitRecord]) -> Dict[str, UnitRecord]:
		return updated_units


	def step(self, sim_request: SimRequest) -> SimResponse:
		unit_map = {u.id: u for u in sim_request.placed_units}
		updated_units = {}
		
		for unit in sim_request.placed_units:
			updated_units[unit.id] = UnitRecord(
				position=unit.position,
				actions=list(unit.actions)
			)

		num_loops = int(sim_request.delta_time / self._sim_setting.simConfig.tickInterval / 1000)

		for _ in range(num_loops):
			updated_units = self.maneuver_evaluation(sim_request.placed_units, updated_units)
			updated_units = self.intelligence_evaluation(sim_request.placed_units, updated_units)
			updated_units = self.combat_evaluation(sim_request.placed_units, updated_units)

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
