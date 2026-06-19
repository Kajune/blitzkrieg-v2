from dataclasses import dataclass
from enum import Enum
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any
import math
from models import *
from geometry import *



class Simulation:
	def __init__(self, sim_setting: SimSetting):
		self._sim_setting = sim_setting

		self.ao = None

		for map_element in self._sim_setting.mapElements:
			if map_element.type == ElementType.OPERATION:
				self.ao = map_element
				break

		if self.ao is None:
			raise ValueError("Operation area is not defined.")

		self.geo_transformer = GeoTransformer(self.ao)


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