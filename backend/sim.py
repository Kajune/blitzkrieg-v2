from dataclasses import dataclass
from enum import Enum
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any
import numpy as np
from models import *
from geometry import *
from gis import *
import cv2


class Simulation:
	def __init__(self, sim_setting: SimSetting, debug=False):
		self._sim_setting = sim_setting

		self.ao = None

		for map_element in self._sim_setting.mapElements:
			if map_element.type == ElementType.OPERATION:
				self.ao = map_element
				break

		if self.ao is None:
			raise ValueError("Operation area is not defined.")

		self.geo_transformer = GeoTransformer(self.ao, base_epsg=os.getenv("DEM_EPSG"))
		self.gis = PostGIS()

		ao_geom = to_shapely_geom(self.ao.geoJson)
		terrain = self.gis.load_dem(ao_geom)
		road_data = self.gis.load_osm_data(
			"planet_osm_roads", 
			ao_geom, 
			condition="highway IN ('motorway', 'primary', 'secondary')"
		)

		if debug:
			max_alt = np.max(terrain.data)
			terrain = self.geo_transformer.convert_to_utm_mesh(terrain)
			terrain = terrain.resize_by_resolution(10.0, 10.0)
			self._debug_plot_units_on_terrain(terrain, "debug.png", max_alt, ao=ao_geom, road=road_data, to_utm=True)


	def _debug_plot_units_on_terrain(self, terrain: Union[GeoMesh, UTMMesh], filename: str, max_alt, ao, road, to_utm=False):
		norm_data = terrain.data / max_alt
		img = (norm_data * 255).astype(np.uint8)
		plot_img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

		unit_positions = [u.position for u in self._sim_setting.placedUnits]
		work_ao = ao
		work_road = road

		if to_utm:
			unit_positions = self.geo_transformer.to_utm(unit_positions)
			work_ao = self.geo_transformer.convrt_to_utm_geom(ao)
			work_road = self.geo_transformer.convrt_to_utm_geom(road)

		ao_pixel = terrain.to_image_geom(work_ao)
		ao_coords_list = get_geometry_coords(ao_pixel)
		for coords in ao_coords_list:
			is_closed = len(coords) > 2 
			cv2.polylines(plot_img, [coords], isClosed=is_closed, color=(0, 255, 0), thickness=2)

		road_pixel = terrain.to_image_geom(work_road)
		road_coords_list = get_geometry_coords(road_pixel)
		for coords in road_coords_list:
			cv2.polylines(plot_img, [coords], isClosed=False, color=(0, 255, 255), thickness=1)

		img_coords = terrain.to_image_coord(unit_positions)
		for pos in img_coords:
			y, x = int(pos[0]), int(pos[1])
			if 0 <= x < plot_img.shape[1] and 0 <= y < plot_img.shape[0]:
				cv2.circle(plot_img, (x, y), radius=3, color=(0, 0, 255), thickness=-1)
		
		cv2.imwrite(filename, plot_img)


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
