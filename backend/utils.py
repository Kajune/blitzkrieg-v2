from typing import Dict, List, Tuple, Optional, Any
from models import *


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
