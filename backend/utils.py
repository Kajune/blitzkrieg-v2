from typing import Dict, List, Tuple, Optional, Any
from models import *
from scipy.stats import multivariate_normal


def get_last_action(unit_record: UnitRecord) -> UnitAction:
	if unit_record.actions:
		for ai, action in enumerate(unit_record.actions):
			if action.finished:
				continue
			return action

		return UnitAction(
			id=None,
			moveSpeed=action.moveSpeed,
			moveMode=action.moveMode,
			fire=action.fire,
			targetPosition=None,
			targetUnitId=None,
			finished=False
		)
	else:
		return UnitAction(
			id=None,
			moveSpeed=MoveSpeed.MEDIUM,
			moveMode=MoveMode.DEFENSE,
			fire=False,
			targetPosition=None,
			targetUnitId=None,
			finished=False
		)


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


def aggregate_unit_property(unit: Unit, fetch_fn, aggr_dict: Dict[str, int] = None) -> Dict[str, int]:
	if aggr_dict is None:
		aggr_dict = {}

	for k, v in fetch_fn(unit).items():
		if k not in aggr_dict and v > 0:
			aggr_dict[k] = 0
		aggr_dict[k] += v

	for lower_unit in unit.lower_units:
		aggregate_unit_property(lower_unit, fetch_fn, aggr_dict)

	return aggr_dict


def get_current_personnel(unit: Unit) -> int:
	return aggregate_unit_property(unit, lambda unit: {"personnel": unit.current_personnel})["personnel"]


def get_current_equipments(unit: Unit) -> Dict[str, int]:
	return aggregate_unit_property(unit, lambda unit: unit.current_equipments)


def get_deployment_area(unit: Unit, move_mode: MoveMode, coeff: UnitDeploymentCoeff) -> float:
	return aggregate_unit_property(unit, 
		lambda unit: {
			"area": (unit.current_personnel ** coeff.scale_factor) * coeff.scaling_table[unit.type][move_mode] * coeff.base_area
		}
	)["area"]


def filter_eqipments(equipments: List[Equipment], filter_class) -> List[Equipment]:
	eq_list = []

	for equipment in equipments:
		if isinstance(equipment, filter_class):
			eq_list.append(equipment)

		if hasattr(equipment, "weapons"):
			eq_list += filter_eqipments(equipment.weapons, filter_class)

		if hasattr(equipment, "sensors"):
			eq_list += filter_eqipments(equipment.sensors, filter_class)

	return eq_list


def calculate_distribution_overlap(dist1: Dict, dist2: Dict) -> float:
	mu1, mu2 = dist1["mean"], dist2["mean"]
	s1, s2 = dist1["sigma"], dist2["sigma"]
	
	v1 = s1**2
	v2 = s2**2
	
	v_avg = (v1 + v2) / 2
	
	diff = mu1 - mu2
	dist_sq = np.sum((diff**2) / v_avg)
	
	log_det_avg = np.sum(np.log(v_avg))
	log_det1 = np.sum(np.log(v1))
	log_det2 = np.sum(np.log(v2))
	
	log_coeff = 0.5 * (log_det_avg - 0.5 * (log_det1 + log_det2))
	
	return np.exp(log_coeff - 0.125 * dist_sq)
