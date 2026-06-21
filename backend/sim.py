from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any
import numpy as np
from shapely.geometry import GeometryCollection
from models import *
from geometry import *
from gis import *
from map import *
from utils import *
import json, msgspec, copy


class Simulation:
	def __init__(self, sim_setting: SimSetting, debug=False):
		self._sim_setting = sim_setting

		#
		# Setting
		#
		try:
			with open("data/coefficients.json") as f:
				coeffs = json.load(f)
				self.coeffs = msgspec.convert(coeffs, Coefficients)
		except Exception as e:
			print(e)

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

		# Unit
		for unit in remove_duplicated_units(self._sim_setting.placedUnits):
			for eq_name in get_current_equipments(unit):
				assert eq_name in self.equipments, f"Unknown equipment: {eq_name}"

		# Map
		self.map = Map(self._sim_setting, self.vehicles, self.coeffs, debug=debug)


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
				trajectories, finished = self.map.compute_maneuver(unit, action, record.trajectory[-1], target_pos)
				record.trajectory += trajectories
				record.actions[ai].finished = finished
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
				trajectory=[unit.position],
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
