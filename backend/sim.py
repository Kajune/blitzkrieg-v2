from dataclasses import dataclass
from enum import Enum
from datetime import datetime
from typing import Dict, List, Tuple, Optional
import math
from pyproj import Transformer
from models import *


def flatten_structured_units(structured_units: List[Unit]) -> Tuple[List[Unit], Dict[str, str]]:
	flattened_units = []
	order_dict = {}

	def _traverse(units: List[Unit], parent_id: Optional[str] = None):
		for unit in units:
			if parent_id:
				order_dict[unit.id] = parent_id
			
			flattened_units.append(unit)
			
			if unit.lower_units:
				_traverse(unit.lower_units, unit.id)
				unit.lower_units = []

	_traverse(structured_units)
	return flattened_units, order_dict


def structure_flattened_units(flattened_units: List[Unit], order_dict: Dict[str, str]) -> List[Unit]:
	unit_map = {unit.id: unit for unit in flattened_units}
	root_units = []

	for unit in flattened_units:
		unit.lower_units = []
		parent_id = order_dict.get(unit.id)
		
		if parent_id:
			parent = unit_map.get(parent_id)
			if parent:
				parent.lower_units.append(unit)
		else:
			root_units.append(unit)
			
	return root_units


class Simulation:
	def __init__(self, sim_setting: SimSetting):
		self._sim_setting = sim_setting
		
		# シミュレーション全体の中心点などで基準ゾーンを決定（ここでは最初のユニットの場所を基準にする例）
		if sim_setting.placedUnits:
			base_unit = sim_setting.placedUnits[0]
			self._zone = int((base_unit.position.lon + 180) / 6) + 1
			self._is_north = base_unit.position.lat >= 0
		else:
			# デフォルトは日本付近（Zone 54N）
			self._zone = 54
			self._is_north = True
			
		epsg = 32600 + self._zone if self._is_north else 32700 + self._zone
		self._to_utm_transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
		self._to_geo_transformer = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

	def _to_utm(self, pos: GeoLocation):
		return self._to_utm_transformer.transform(pos.lon, pos.lat)

	def _to_geo(self, x, y):
		lon, lat = self._to_geo_transformer.transform(x, y)
		return GeoLocation(lat=lat, lon=lon)

	def _get_move_speed_mps(self, speed: MoveSpeed, mode: MoveMode) -> float:
		kmh = 5.0 if speed == MoveSpeed.LOW else (20.0 if speed == MoveSpeed.MEDIUM else 50.0)
		return (kmh * 1000 / 3600) * (0.5 if mode == MoveMode.COMBAT else 1.0)

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
			for unit_id, record in updated_units.items():
				if not record.actions:
					continue

				for ai, action in enumerate(record.actions):
					if action.finished:
						continue

					target_pos = action.targetPosition or (unit_map[action.targetUnitId].position if action.targetUnitId in unit_map else None)
					
					if not target_pos:
						continue

					# 一貫したゾーンで変換
					ux, uy = self._to_utm(record.position)
					tx, ty = self._to_utm(target_pos)

					dist = math.sqrt((tx - ux)**2 + (ty - uy)**2)
					move_dist_per_tick = self._get_move_speed_mps(action.moveSpeed, action.moveMode) * self._sim_setting.simConfig.tickInterval

					if dist <= move_dist_per_tick:
						record.position = target_pos
						record.actions[ai].finished = True
					else:
						angle = math.atan2(ty - uy, tx - ux)
						nx = ux + math.cos(angle) * move_dist_per_tick
						ny = uy + math.sin(angle) * move_dist_per_tick
						
						record.position = self._to_geo(nx, ny)

					break

		return SimResponse(
			success=True,
			sim_id=sim_request.sim_id,
			startDateTime=sim_request.current_time,
			endDateTime=sim_request.current_time + sim_request.delta_time,
			unitRecords=updated_units,
		)