from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any
import numpy as np
import ray
from shapely.geometry import GeometryCollection
import scipy.optimize
from models import *
from geometry import *
from gis import *
from map import *
from utils import *
from functools import lru_cache
import json, msgspec, copy, glob



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

		self._load_equipments()

		self.distance_scales = {sensor.name: 
			np.array([
				self.coeffs.intelligence.discovery_distance_scale_by_vehicle_type[sensor.type][vehicle_type] 
				for vehicle_type in VehicleType
			]) * sensor.sensor_range for sensor in list(self.sensors.values()) + [self.coeffs.intelligence.personnel_sensor]
		}

		self.vehicle_type_one_hot = {}
		for vi, vt in enumerate(VehicleType):
			self.vehicle_type_one_hot[vt] = np.eye(len(VehicleType))[vi]

		# Unit
		for unit in remove_duplicated_units(self._sim_setting.placedUnits):
			for eq_name in get_current_equipments(unit):
				assert eq_name in self.equipments, f"Unknown equipment: {eq_name}"

		# Map
		self.map = Map(self._sim_setting, self.vehicles, self.coeffs, debug=debug)


	def _load_equipments(self):
		self.weapons = []
		self.sensors = []
		self.vehicles = []

		try:
			eq_files = sorted(glob.glob("data/equipments/*.json"))
			for eq_file in eq_files:
				with open(eq_file) as f:
					equipments = json.load(f)
					for weapon in equipments["weapons"]:
						self.weapons.append(msgspec.convert(weapon, Weapon))
					for sensor in equipments["sensors"]:
						self.sensors.append(msgspec.convert(sensor, Sensor))
					for vehicle in equipments["vehicles"]:
						self.vehicles.append(msgspec.convert(vehicle, Vehicle))
		except Exception as e:
			print(e)

		self.weapons = {w.name: w for w in self.weapons}
		self.sensors = {s.name: s for s in self.sensors}
		self.vehicles = {v.name: v for v in self.vehicles}
		self.equipments = {**self.weapons, **self.sensors, **self.vehicles}

		for v_name, vehicle in self.vehicles.items():
			for weapon_item in vehicle.weapons:
				weapon_name = weapon_item if isinstance(weapon_item, str) else weapon_item.name
				if weapon_name not in self.weapons:
					raise ValueError(f"Vehicle '{v_name}' references undefined weapon: {weapon_name}")

			for sensor_item in vehicle.sensors:
				sensor_name = sensor_item if isinstance(sensor_item, str) else sensor_item.name
				if sensor_name not in self.sensors:
					raise ValueError(f"Vehicle '{v_name}' references undefined sensor: {sensor_name}")


	@lru_cache(maxsize=None)
	def _filter_equipments(self, equipments : Tuple[str], filter_class):
		return filter_equipments([self.equipments[eq_name] for eq_name in equipments], filter_class, self.equipments)


	def compute_deployment_distribution(self, placed_units : Dict[str, PlacedUnit], updated_units : Dict[str, UnitRecord]) -> Dict[str, Dict]:
		deployment_area = {}
		for unit_id, record in updated_units.items():
			last_action = get_last_action(record)
			deployment_area[unit_id] = get_deployment_area(
				placed_units[unit_id], 
				last_action.moveMode, 
				self.coeffs.unit_deployment
			)

		deployment_distribution = {}
		n_sigma = 2
		for unit_id, record in updated_units.items():
			unit = placed_units[unit_id]
			upos = self.map.geo_transformer.to_utm(unit.position)
			sigma = np.sqrt(deployment_area[unit_id] / np.pi) / n_sigma
			deployment_distribution[unit_id] = {
				"area": deployment_area[unit_id],
				"mean": np.array([upos.easting, upos.northing]),
				"sigma": np.array([sigma, sigma]),
			}

		return deployment_distribution


	def maneuver_evaluation(self, 
		placed_units : Dict[str, PlacedUnit], 
		updated_units : Dict[str, UnitRecord], 
		deployment_distribution : Dict[str, Dict]
	) -> Dict[str, UnitRecord]:
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

				if target_pos == unit.currentTargetPos \
					and action.moveSpeed == unit.currentMoveSpeed \
					and action.moveMode == unit.currentMoveMode \
					and unit.currentPath is not None:
					path = unit.currentPath
				else:
					path = None

				trajectories, finished, path = self.map.compute_maneuver(unit, action, record.trajectory[-1], target_pos, deployment_distribution, path=path)
				record.trajectory += trajectories
				record.actions[ai].finished = finished
				record.currentTargetPos = target_pos
				record.currentPath = path
				break

			last_action = get_last_action(record)
			record.currentMoveSpeed = last_action.moveSpeed
			record.currentMoveMode = last_action.moveMode
			record.currentFireMode = last_action.fireMode

		return updated_units


	def _get_visibility_ratio(self, dist1, dist2, n_samples=10):
		xy1 = np.random.normal(dist1["mean"], dist1["sigma"], (n_samples, 2))
		xy2 = np.random.normal(dist2["mean"], dist2["sigma"], (n_samples, 2))
		
		z1 = self.map.get_elevation(xy1) 
		z2 = self.map.get_elevation(xy2)
		
		pts1 = np.hstack([xy1, z1.reshape(-1, 1)])
		pts2 = np.hstack([xy2, z2.reshape(-1, 1)])
		
		visible_results = self.map.compute_visibility(pts1, pts2)
		return np.mean(visible_results)


	def _process_single_unit_ingelligence(
		self,
		unit_id1 : str,
		placed_units : Dict[str, PlacedUnit], 
		updated_units : Dict[str, UnitRecord],
		unit_distances : np.ndarray,
		R_eff_list : np.ndarray,
		last_action_dict : Dict[str, UnitAction],
		deployment_distribution : Dict[str, Dict],
		discovery_distribution : Dict[str, np.ndarray],
		exposure_distribution : Dict[str, np.ndarray],
		sensors_dict : Dict[str, Sensor],
	) -> List[DetectLog]:
		unit1 = placed_units[unit_id1]
		sensors = sensors_dict[unit_id1]
		last_action1 = last_action_dict[unit_id1]
		detect_logs = []
		is_artillery_mode = last_action1.moveMode in [MoveMode.DEFENSE, MoveMode.ARTILLERY]

		for uj, unit_id2 in enumerate(updated_units):
			unit2 = placed_units[unit_id2]
			last_action2 = last_action_dict[unit_id2]

			if unit1.force == unit2.force:
				continue

			if exposure_distribution[unit_id2].shape[-1] == 0:
				continue

#			R_eff = discovery_distribution[unit_id1] @ exposure_distribution[unit_id2]
			R_eff = R_eff_list[uj]

			# 対砲迫レーダーを考慮 (RADAR_COUNTER_BATTERYについては、自部隊のmoveModeがARTILLERYまたはDEFENSEかつ、目標のmoveModeがARTILLERYかつ射撃実績があれば、R_effは諸元上の最大距離となる)
			if is_artillery_mode and last_action2.moveMode == MoveMode.ARTILLERY and len(unit2.attackingUnits) > 0:
				for si, sensor in enumerate(sensors):
					if sensor.type == SensorType.RADAR_COUNTER_BATTERY:
						R_eff[si,:] = sensor.sensor_range

			max_range = R_eff.max()
			if max_range >= unit_distances[uj]:
				discovery_prob = (R_eff / (unit_distances[uj] + 1e-3)) ** 2
				discovery_prob = np.clip(discovery_prob, 0, 1)

				# 前の時刻で発見済みならプラス
				if unit_id2 in [det_log.unitId for det_log in unit1.detectedUnits]:
					discovery_prob *= self.coeffs.intelligence.temporal_discovery_advantage

				visibility_ratio = self._get_visibility_ratio(
					deployment_distribution[unit_id1], deployment_distribution[unit_id2]
				)
				discovery_prob *= visibility_ratio

				unit_discovery_prob = np.mean(np.max(discovery_prob, axis=1))
				unit_awareness_ratio = np.mean(np.max(discovery_prob, axis=0))

				# Step5: 発見できたのか、できたとしたらその割合はいくらなのか記録
				if np.random.rand() <= unit_discovery_prob:
					detect_logs.append(
						DetectLog(unitId=unit_id2, awareness=float(unit_awareness_ratio))
					)

		return detect_logs


	def intelligence_evaluation(self, 
		placed_units : Dict[str, PlacedUnit], 
		updated_units : Dict[str, UnitRecord], 
		deployment_distribution : Dict[str, Dict]
	) -> Dict[str, UnitRecord]:

		# Step1: 発見部隊の装備品を集約し、発見部隊の特性・行動の係数を踏まえ、発見距離分布を作成
		# Step2: 被発見部隊の装備品を集約し、被発見部隊の特性・行動の係数を踏まえ、被発見距離分布を作成

		discovery_distribution = {}
		exposure_distribution = {}
		max_discovery_dim1 = 0
		max_discovery_dim2 = 0
		max_exposure_dim1 = 0
		max_exposure_dim2 = 0
		sensors_dict = {}
		last_action_dict = {}

		for unit_id, record in updated_units.items():
			unit = placed_units[unit_id]

			equipments = []
			for eq_name, eq_num in get_current_equipments(unit).items():
				equipments += [eq_name] * eq_num

			last_action = get_last_action(record)
			last_action_dict[unit_id] = last_action
			sensors = self._filter_equipments(tuple(equipments), Sensor)
			vehicles = self._filter_equipments(tuple(equipments), Vehicle)
			vehicles += [self.coeffs.intelligence.personnel_vehicle] #* get_current_personnel(unit)
			vehicles = list(set(vehicles))
			sensors += [self.coeffs.intelligence.personnel_sensor] #* get_current_personnel(unit)
			sensors = list(set(sensors))
			sensors_dict[unit_id] = sensors

			discovery_ranges = [self.distance_scales[sensor.name] for sensor in sensors]

			discovery_distribution[unit_id] = np.sqrt((np.array(discovery_ranges) ** 2)
				* self.coeffs.intelligence.discovery_distance_scale_by_move_mode[last_action.moveMode]
				* self.coeffs.intelligence.discovery_distance_scale_by_move_speed[last_action.moveSpeed]
				* (1 - unit.suppressionRate))
			max_discovery_dim1 = max(max_discovery_dim1, discovery_distribution[unit_id].shape[0])
			max_discovery_dim2 = max(max_discovery_dim2, discovery_distribution[unit_id].shape[1])

			vehicle_types = []
			for vehicle in vehicles:
				vehicle_types.append(self.vehicle_type_one_hot[vehicle.type])
			if len(vehicle_types) == 0:
				continue

			if len(unit.attackingUnits) > 0:
				exposure_distribution[unit_id] = np.array(vehicle_types).T
			else:
				exposure_distribution[unit_id] = (np.array(vehicle_types).T \
					* self.coeffs.intelligence.exposure_distance_scale_by_move_mode[last_action.moveMode]
					* self.coeffs.intelligence.exposure_distance_scale_by_move_speed[last_action.moveSpeed])
			max_exposure_dim1 = max(max_exposure_dim1, exposure_distribution[unit_id].shape[0])
			max_exposure_dim2 = max(max_exposure_dim2, exposure_distribution[unit_id].shape[1])

		unit_positions = [placed_units[unit_id].position for unit_id in updated_units]
		unit_positions_utm = np.array([[p.easting, p.northing] for p in self.map.geo_transformer.to_utm(unit_positions)])
		unit_distances = np.linalg.norm(unit_positions_utm[:,np.newaxis,:] - unit_positions_utm[np.newaxis,:,:], axis=-1)

		discovery_matrix = np.zeros((len(updated_units), max_discovery_dim1, max_discovery_dim2))
		exposure_matrix = np.zeros((len(updated_units), max_exposure_dim1, max_exposure_dim2))
		assert max_discovery_dim2 == max_exposure_dim1

		for ui, unit_id in enumerate(updated_units):
			if unit_id in discovery_distribution:
				m = discovery_distribution[unit_id]
				discovery_matrix[ui][:m.shape[0], :m.shape[1]] = m

			if unit_id in exposure_distribution:
				m = exposure_distribution[unit_id]
				exposure_matrix[ui][:m.shape[0], :m.shape[1]] = m

		R_eff_full = np.einsum('ikm,jmn->ijkn', discovery_matrix, exposure_matrix)

		for ui, unit_id1 in enumerate(updated_units):
			if len(discovery_distribution[unit_id1]) == 0:
				continue

			detect_logs = self._process_single_unit_ingelligence(
				unit_id1,
				placed_units, 
				updated_units,
				unit_distances[ui],
				R_eff_full[ui],
				last_action_dict,
				deployment_distribution,
				discovery_distribution,
				exposure_distribution,
				sensors_dict,
			)
			updated_units[unit_id1].detectedUnits += detect_logs

		return updated_units


	def combat_evaluation(self, 
		placed_units : Dict[str, PlacedUnit], 
		updated_units : Dict[str, UnitRecord], 
		deployment_distribution : Dict[str, Dict]
	) -> Dict[str, UnitRecord]:
		attack_logs_per_target = {}

		# 火力の計算
		for unit_id, record in updated_units.items():
			unit = placed_units[unit_id]
			last_action = get_last_action(record)

			if not record.detectedUnits or record.suppressionRate >= 1.0 or last_action.fireMode == FireMode.OFF:
				continue

			equipments = []
			for eq_name, eq_num in get_current_equipments(unit).items():
				equipments += [eq_name] * eq_num

			weapons = self._filter_equipments(tuple(equipments), Weapon)
			if last_action.moveMode != MoveMode.ARTILLERY:
				weapons = [w for w in weapons if w.type not in [WeaponType.HOWITZER]]
			
			if not weapons:
				continue

			efficiency = (get_current_personnel(unit) / get_full_personnel(unit)) / (len(record.detectedUnits) ** self.coeffs.combat.fire_power_efficiency)

			for detect_log in record.detectedUnits:
				target_unit = placed_units[detect_log.unitId]
				pos1 = deployment_distribution[unit_id]["mean"]
				pos2 = deployment_distribution[detect_log.unitId]["mean"]
				dist = np.linalg.norm(pos1 - pos2)

				attack_logs = {}

				for weapon in weapons:
					effective_range = (weapon.fire_range 
						* self.coeffs.combat.range_scale_by_move_mode[last_action.moveMode]
						* self.coeffs.combat.range_scale_by_move_speed[last_action.moveSpeed]
						* (1 - record.suppressionRate))
					
					hit_prob = np.clip(1 - 0.5 * (dist / effective_range) ** 2, 0, 1)
					total_fire_power = hit_prob * weapon.fire_power * detect_log.awareness * efficiency

					if total_fire_power > 0:
						if weapon.type not in attack_logs:
							attack_logs[weapon.type] = 0
						attack_logs[weapon.type] += total_fire_power

				for weapon_type, fire_power in attack_logs.items():
					updated_units[unit_id].attackingUnits.append(
						AttackLog(unitId=detect_log.unitId, firePower=float(fire_power), weaponType=weapon_type)
					)

					if detect_log.unitId not in attack_logs_per_target:
						attack_logs_per_target[detect_log.unitId] = {}
					if weapon_type not in attack_logs_per_target[detect_log.unitId]:
						attack_logs_per_target[detect_log.unitId][weapon_type] = 0
					attack_logs_per_target[detect_log.unitId][weapon_type] += float(fire_power)

		# 損耗の付与
		for target_id, logs in attack_logs_per_target.items():
			record = updated_units[target_id]
			last_action = get_last_action(record)
			all_current_equipments = record.personnelEquipments.all_current_equipments()
			total_vehicles_count = 0
			for eq_name, eq_count in all_current_equipments.items():
				if eq_name not in self.vehicles:
					continue
				total_vehicles_count += eq_count

#			flank_bonus = self._calculate_flank_bonus(target_id, updated_units)
			
			damage_coeff = (self.coeffs.combat.damage_speed
				* self.coeffs.combat.damage_scale_by_move_mode[last_action.moveMode]
				* self.coeffs.combat.damage_scale_by_move_speed[last_action.moveSpeed])
#				* flank_bonus)

			total_suppression = 0
			
			for weapon_type, fire_power in logs.items():
				damage = fire_power * damage_coeff
				
				# 人員損耗計算
				p_damage = int(damage * self.coeffs.combat.damage_scale_by_target_type[weapon_type][VehicleType.FOOT])
				record.personnelEquipments.add_personnel_damage(p_damage)
				
				# 装備損耗計算
				if total_vehicles_count > 0:
					for eq_name, eq_count in all_current_equipments.items():
						if eq_name not in self.vehicles:
							continue
						vehicle = self.vehicles[eq_name]

						e_damage = int(damage * self.coeffs.combat.damage_scale_by_target_type[weapon_type][vehicle.type] * eq_count / total_vehicles_count)
						record.personnelEquipments.add_equipment_damage(eq_name, e_damage)

				total_suppression += (damage * self.coeffs.combat.suppression_factor)
				
			# 抑制率の更新
			record.suppressionRate = float(np.clip(total_suppression, 0, 1.0))

		return updated_units


	def step(self, sim_request: SimRequest) -> SimResponse:
		placed_units = remove_duplicated_units(sim_request.placed_units)
		updated_units = {}
		
		for unit in placed_units:
			updated_units[unit.id] = UnitRecord(
				currentMoveSpeed=unit.currentMoveSpeed,
				currentMoveMode=unit.currentMoveMode,
				currentFireMode=unit.currentFireMode,
				currentTargetPos=unit.currentTargetPos,
				currentPath=unit.currentPath,
				trajectory=[unit.position],
				actions=list(unit.actions),
				detectedUnits=[],
				attackingUnits=[],
				suppressionRate=0,
				personnelEquipments=get_personnel_equipments(unit),
			)

		placed_units = {u.id: u for u in placed_units}

		num_loops = int(sim_request.delta_time / self._sim_setting.simConfig.tickInterval / 1000)

		for _ in range(num_loops):
			deploy_dist = self.compute_deployment_distribution(placed_units, updated_units)
			updated_units = self.maneuver_evaluation(placed_units, updated_units, deploy_dist)
			updated_units = self.intelligence_evaluation(placed_units, updated_units, deploy_dist)
			updated_units = self.combat_evaluation(placed_units, updated_units, deploy_dist)

		return SimResponse(
			success=True,
			sim_id=sim_request.sim_id,
			startDateTime=sim_request.current_time,
			endDateTime=sim_request.current_time + sim_request.delta_time,
			unitRecords=updated_units,
		)


	def deploy_child_units(self, deploy_request: UnitDeploymentRequest) -> List[PlacedUnit]:
		self._sim_setting.placedUnits = deploy_request.placed_units

		existing_unit_ids = {u.id: u for u in self._sim_setting.placedUnits}
		if deploy_request.deploy_unit_id not in existing_unit_ids:
			return []

		unit = existing_unit_ids[deploy_request.deploy_unit_id]

		children = [c for c in unit.lower_units if c.id not in existing_unit_ids]
		if not children:
			return []

		n = len(children)
		
		# 1. 展開範囲を計算し、ランダムな初期座標を生成
		dummy_record = UnitRecord(
			trajectory=[unit.position], actions=unit.actions, detectedUnits=unit.detectedUnits,
			attackingUnits=unit.attackingUnits, suppressionRate=unit.suppressionRate,
			personnelEquipments=get_personnel_equipments(unit)
		)
		last_action = get_last_action(dummy_record)
		dist_info = self.compute_deployment_distribution({unit.id: unit}, {unit.id: dummy_record})[unit.id]
		mean, sigma = dist_info["mean"], dist_info["sigma"][0]
		
		# 敵ユニット位置（UTM）
		enemies = [self.map.geo_transformer.to_utm(e.position) for e in self._sim_setting.placedUnits if e.force != unit.force]
		enemy_coords = np.array([[e.easting, e.northing] for e in enemies]) if enemies else None

		# Typeによる優先順位
		type_order = [UnitType.INFANTRY, UnitType.COMBINED, UnitType.TANK, UnitType.ARTILLERY, UnitType.ANTIAIR, UnitType.AIR]
		children_sorted = sorted(children, key=lambda c: type_order.index(c.type) if c.type in type_order else 99)

		# 機動障害図
		mobility_map = self.map.get_natural_mobility_map()

		def objective(coords_flat):
			coords = coords_flat.reshape((n, 2))
			
			# 2. 敵部隊との距離計算
			if enemy_coords is not None:
				# 各座標から敵までの最小距離を計算
				dists = np.array([np.min(np.linalg.norm(c - enemy_coords, axis=1)) for c in coords])
				# 3. 敵に近い順に部隊の割り当てインデックスを決定
				assignment_indices = np.argsort(dists)
			else:
				assignment_indices = np.arange(n)
			
			# 4. 割り当てに基づきコスト計算
			cost = 0
			
			for i in range(n):
				# 割り当てられたユニット
				child = children_sorted[assignment_indices[i]]
				coord = coords[i]
				
				# そのユニットの展開範囲（compute_deployment_distributionの計算ロジックを流用）
				# 簡略化のため、UnitTypeごとの展開範囲倍率をsigmaにかける
				unit_range = sigma * self.coeffs.unit_deployment.scaling_table[child.type][last_action.moveMode]

				# 重なり具合のコスト（他のユニットの展開範囲との重複）
				for j in range(i + 1, n):
					other_child = children_sorted[assignment_indices[j]]
					other_range = sigma * self.coeffs.unit_deployment.scaling_table[other_child.type][last_action.moveMode]
					dist = np.linalg.norm(coord - coords[j])
					if dist < (unit_range + other_range):
						cost += (unit_range + other_range - dist)
				
				# 機動障害との重なりコスト
				sample_pts = np.random.normal(coord, unit_range / 2, (5, 2))
				sample_locs = [UTMLocation(easting=p[0], northing=p[1]) for p in sample_pts]
				pxs = mobility_map.to_image_coord(sample_locs)

				sample_costs = []
				for px in pxs:
					if 0 <= px[0] < mobility_map.data.shape[0] and 0 <= px[1] < mobility_map.data.shape[1]:
						sample_costs.append(mobility_map.data[int(px[0]), int(px[1])])
				if sample_costs:
					cost += np.mean(sample_costs)

			return cost

		# GAによる最適化
		bounds = [(mean[0]-sigma*3, mean[0]+sigma*3), (mean[1]-sigma*3, mean[1]+sigma*3)] * n
		result = scipy.optimize.differential_evolution(objective, bounds, maxiter=10, disp=True)
		
		# 最終的な割り当ての確定
		final_coords_np = result.x.reshape((n, 2))
		
		# 1. 座標を「敵に近い順」に並べ替える
		if enemy_coords is not None:
			dists = np.array([np.min(np.linalg.norm(c - enemy_coords, axis=1)) for c in final_coords_np])
			sorted_coords_np = final_coords_np[np.argsort(dists)]
		else:
			sorted_coords_np = final_coords_np

		# 2. 座標をUTMLocationに変換してからgeoに変換
		final_coords_utm = [UTMLocation(easting=c[0], northing=c[1]) for c in sorted_coords_np]
		final_coords_geo = self.map.geo_transformer.to_geo(final_coords_utm)

		deployed_units = []
		for i in range(n):
			child = children_sorted[i]

			deployed_units.append(PlacedUnit(
				id=child.id, 
				templateId=child.templateId, 
				force=unit.force, 
				name=child.name, 
				sidc=child.sidc,
				type=child.type, 
				full_personnel=child.full_personnel, 
				current_personnel=child.current_personnel,
				full_equipments=child.full_equipments, 
				current_equipments=child.current_equipments,
				lower_units=child.lower_units, 
				position=final_coords_geo[i],
				actions=[], 
				detectedUnits=[],
				attackingUnits=[], 
				suppressionRate=0.0
			))
		
		return deployed_units