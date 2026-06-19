from dataclasses import dataclass
from enum import Enum
from datetime import datetime
from typing import Dict, List, Optional
import msgspec
import math

#
# 共通
#

class GeoLocation(msgspec.Struct):
	lat: float
	lon: float


class UTMLocation(msgspec.Struct):
	easting: float
	northing: float

	def distance(self, rhs : "UTMLocation") -> float:
		return math.sqrt((rhs.easting - self.easting) ** 2 + (rhs.northing - self.northing) ** 2)

	def direction(self, rhs : "UTMLocation") -> float:
		return math.atan2(rhs.northing - self.northing, rhs.easting - self.easting)

	def move(self, angle : float, distance : float) -> "UTMLocation":
		return UTMLocation(easting=self.easting + math.cos(angle) * distance, northing=self.northing + math.sin(angle) * distance)

#
# Unit関係
#

class Force(Enum):
	REDFOR = 'REDFOR'
	BLUFOR = 'BLUFOR'


class MoveSpeed(Enum):
	LOW = 'LOW'
	MEDIUM = 'MEDIUM'
	HIGH = 'HIGH'


class MoveMode(Enum):
	MARCH = 'MARCH'
	COMBAT = 'COMBAT'
	DEFENSE = 'DEFENSE'
	ARTILLERY = 'ARTILLERY'


class Unit(msgspec.Struct):
	id: str
	templateId: str
	force: Force
	name: str
	sidc: str
	type: str
	full_personnel: int
	current_personnel: int
	full_equipments: Dict[str, int]
	current_equipments: Dict[str, int]
	lower_units: List['Unit']


class UnitAction(msgspec.Struct):
	id: str
	moveSpeed: MoveSpeed
	moveMode: MoveMode
	fire: bool
	targetPosition: Optional[GeoLocation]
	targetUnitId: Optional[str]
	finished: bool


class PlacedUnit(Unit):
	position: GeoLocation
	actions: List[UnitAction]

#
# 地物関係
#

class ElementType(Enum):
	OPERATION = 'operation'
	FORTIFICATION = 'fortification'
	OBSTACLE = 'obstacle'
	COA = 'coa'


class GeometryType(Enum):
	POLYGON = 'polygon'
	POLYLINE = 'polyline'
	POINT = 'point'


class MapElement(msgspec.Struct):
	id: str
	type: ElementType
	force: Optional[Force]
	geometry: GeometryType
	name: str
	geoJson: Dict

#
# シミュレーション関係
#

class SimConfig(msgspec.Struct):
	startDateTime: datetime
	endDateTime: datetime
	tickInterval: float


class SimSetting(msgspec.Struct):
	simConfig: SimConfig
	units: List[Unit]
	placedUnits: List[PlacedUnit]
	mapElements: List[MapElement]


class UnitRecord(msgspec.Struct):
	position: GeoLocation
	actions: List[UnitAction]


class SimRequest(msgspec.Struct):
	sim_id: str
	current_time: int
	delta_time: int
	placed_units: List[PlacedUnit]


class SimResponse(msgspec.Struct):
	success: bool
	sim_id: str
	startDateTime: int
	endDateTime: int
	unitRecords: Dict[str, UnitRecord]
