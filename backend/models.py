from dataclasses import dataclass
from collections import Counter
from enum import Enum
from datetime import datetime
from typing import TypeVar, Generic, Union, List, Dict, Type, Optional, cast
import msgspec
from shapely import get_coordinates, set_coordinates
from shapely.ops import transform
from shapely.geometry.base import BaseGeometry
from shapely.geometry import Point
import numpy as np
import cv2
import math
import base64
import json

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

	def to_shapely(self) -> Point:
		return Point(self.easting, self.northing)

	@classmethod
	def from_shapely(cls, point: Point) -> "UTMLocation":
		return cls(easting=point.x, northing=point.y)


T = TypeVar("T", GeoLocation, UTMLocation)

@dataclass
class BaseMesh(Generic[T]):
	data: np.ndarray
	left_bottom: T
	right_top: T
	epsg: int
	cls_t: Type[T]

	@property
	def size(self):
		raise NotImplementedError


	@property
	def resolution(self):
		width, height = self.size
		return width / self.data.shape[1], height / self.data.shape[0]


	@property
	def _deltas(self):
		raise NotImplementedError


	def clip_to_image_size(self, pt):
		if isinstance(pt, List):
			return [self.clip_to_image_size(p) for p in pt]
		return np.stack([np.clip(pt[...,0], 0, self.data.shape[0] - 1), np.clip(pt[...,1], 0, self.data.shape[1] - 1)], axis=-1)


	def resize(self, target_width: int, target_height: int) -> 'BaseMesh':
		resized_data = cv2.resize(self.data, (target_width, target_height), interpolation=cv2.INTER_AREA)

		return self.__class__(
			data=resized_data,
			left_bottom=self.left_bottom,
			right_top=self.right_top,
			epsg=self.epsg
		)


	def resize_by_resolution(self, resolution_x: float, resolution_y: float) -> 'BaseMesh':
		geo_width, geo_height = self.size

		target_width = int(abs(geo_width / resolution_x))
		target_height = int(abs(geo_height / resolution_y))

		return self.resize(target_width, target_height)


	def to_image_coord(self, pos: Union[T, List[T]]) -> np.ndarray:
		dx, dy, sx, sy = self._deltas
		height = self.data.shape[0]
		
		def _convert(p):
			x = p.lon if hasattr(p, 'lon') else p.easting
			y = p.lat if hasattr(p, 'lat') else p.northing
			return [height - (y - sy) / dy, (x - sx) / dx]

		if isinstance(pos, list):
			return np.array([_convert(p) for p in pos])
		return np.array(_convert(pos))


	def from_image_coord(self, pos: np.ndarray) -> Union[T, List[T]]:
		dx, dy, sx, sy = self._deltas
		height = self.data.shape[0]
		
		def _revert(p):
			x = sx + (p[1] * dx)
			y = sy + (height - p[0]) * dy
			return self.cls_t(x, y)

		if pos.ndim == 2:
			return [_revert(p) for p in pos]
		return _revert(pos)


	def to_image_geom(self, geom: BaseGeometry) -> BaseGeometry:
		dx, dy, sx, sy = self._deltas
		height = self.data.shape[0]
		
		coords = get_coordinates(geom)
		
		coords[:, 0] = (coords[:, 0] - sx) / dx
		coords[:, 1] = height - (coords[:, 1] - sy) / dy
		
		return set_coordinates(geom, coords)


	def from_image_geom(self, geom: BaseGeometry) -> BaseGeometry:
		dx, dy, sx, sy = self._deltas
		height = self.data.shape[0]
		
		coords = get_coordinates(geom)
		
		coords[:, 0] = sx + coords[:, 0] * dx
		coords[:, 1] = sy + (height - coords[:, 1]) * dy
		
		return set_coordinates(geom, coords)


	def _get_base_polygon(self) -> dict:
		x1 = getattr(self.left_bottom, 'lon', getattr(self.left_bottom, 'easting', 0))
		y1 = getattr(self.left_bottom, 'lat', getattr(self.left_bottom, 'northing', 0))
		x2 = getattr(self.right_top, 'lon', getattr(self.right_top, 'easting', 0))
		y2 = getattr(self.right_top, 'lat', getattr(self.right_top, 'northing', 0))

		return {
			"type": "Feature",
			"geometry": {
				"type": "Polygon",
				"coordinates": [[
					[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]
				]]
			},
			"properties": {"epsg": self.epsg}
		}


	def get_geojson(self) -> dict:
		geojson = self._get_base_polygon()
		
		if self.data is None or self.data.size == 0:
			return geojson

		data_to_encode = self.data
		if self.data.dtype != np.uint8:
			data_to_encode = (self.data * 255).clip(0, 255).astype(np.uint8)

		_, buffer = cv2.imencode('.png', data_to_encode)
		img_str = base64.b64encode(buffer).decode('utf-8')
		
		geojson["properties"].update({
			"mesh_data": img_str,
			"encoding": "base64",
			"mime_type": "image/png",
			"shape": self.data.shape
		})
		
		return geojson


@dataclass
class GeoMesh(BaseMesh[GeoLocation]):
	def __init__(self, data, left_bottom, right_top, epsg):
		super().__init__(data, left_bottom, right_top, epsg, GeoLocation)


	@property
	def size(self):
		geo_width = self.right_top.lon - self.left_bottom.lon
		geo_height = self.right_top.lat - self.left_bottom.lat
		return geo_width, geo_height


	@property
	def _deltas(self):
		height, width = self.data.shape[:2]
		d_x = (self.right_top.lon - self.left_bottom.lon) / width
		d_y = (self.right_top.lat - self.left_bottom.lat) / height
		start_x, start_y = self.left_bottom.lon, self.left_bottom.lat
		return d_x, d_y, start_x, start_y


@dataclass
class UTMMesh(BaseMesh[UTMLocation]):
	def __init__(self, data, left_bottom, right_top, epsg):
		super().__init__(data, left_bottom, right_top, epsg, UTMLocation)


	@property
	def size(self):
		geo_width = self.right_top.easting - self.left_bottom.easting
		geo_height = self.right_top.northing - self.left_bottom.northing
		return geo_width, geo_height


	@property
	def _deltas(self):
		height, width = self.data.shape[:2]
		d_x = (self.right_top.easting - self.left_bottom.easting) / width
		d_y = (self.right_top.northing - self.left_bottom.northing) / height
		start_x, start_y = self.left_bottom.easting, self.left_bottom.northing
		return d_x, d_y, start_x, start_y

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


class FireMode(Enum):
	ON = 'ON'
	OFF = 'OFF'


class UnitType(Enum):
	COMBINED = 'combined'
	INFANTRY = 'infantry'
	TANK = 'tank'
	ARTILLERY = 'artillery'
	ANTIAIR = 'anti_air'
	AIR = 'air'


class SensorType(Enum):
	OPTICAL_VISUAL = 'OpticalVisual'
	OPTICAL_THERMAL = 'OpticalThermal'
	RADAR_GROUND = 'RadarGround'
	RADAR_COUNTER_BATTERY = 'RadarCounterBattery'
	RADAR_ANTI_AIR = 'RadarAntiAir'


class WeaponType(Enum):
	SMALL_ARM = 'SmallArm'
	CANNON = 'Cannon'
	HOWITZER = 'Howitzer'
	AA_GUN = 'AAGun'
	AT_MISSILE = 'ATMissile'
	AA_MISSILE = 'AAMissile'


class VehicleType(Enum):
	FOOT = 'Foot'
	GROUND_SOFT = 'GroundSoft'
	GROUND_HARD_WHEELED = 'GroundHardWheeled'
	GROUND_HARD_TRACKED = 'GroundHardTracked'
	AIRCRAFT = 'Aircraft'


class FireType(Enum):
	DIRECT = 'Direct'
	INDIRECT = 'Indirect'


class Equipment(msgspec.Struct, frozen=True, cache_hash=True):
	name: str


class Sensor(Equipment):
	sensor_range: float
	type: SensorType


class Weapon(Equipment):
	fire_range: float
	type: WeaponType
	fire_type: FireType
	fire_power: float


class Vehicle(Equipment):
	type: VehicleType
	max_speed: float
	weapons: List[Weapon | str]
	sensors: List[Sensor | str]
	required_personnel: int
	personnel_capacity: int


class DetectLog(msgspec.Struct, frozen=True, cache_hash=True):
	unitId: str
	awareness: float


class AttackLog(msgspec.Struct, frozen=True, cache_hash=True):
	unitId: str
	firePower: float
	weaponType: WeaponType


class Unit(msgspec.Struct):
	id: str
	templateId: str
	force: Force
	name: str
	sidc: str
	type: UnitType
	full_personnel: int
	current_personnel: int
	full_equipments: Dict[str, int]
	current_equipments: Dict[str, int]
	lower_units: List['Unit']


class UnitAction(msgspec.Struct):
	id: str
	moveSpeed: MoveSpeed
	moveMode: MoveMode
	fireMode: FireMode
	targetPosition: Optional[GeoLocation]
	targetUnitId: Optional[str]
	finished: bool


class PlacedUnit(Unit):
	position: GeoLocation
	actions: List[UnitAction]
	detectedUnits: List[DetectLog]
	attackingUnits: List[AttackLog]
	suppressionRate: float
	currentMoveSpeed: Optional[MoveSpeed] = None
	currentMoveMode: Optional[MoveMode] = None
	currentFireMode: Optional[FireMode] = None
	currentTargetPos: Optional[GeoLocation] = None
	currentPath: Optional[List[GeoLocation]] = None


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


class MapElement(msgspec.Struct, frozen=True, cache_hash=True):
	id: str
	type: ElementType
	force: Optional[Force]
	geometry: GeometryType
	name: str
	geoJson: Dict

#
# シミュレーション関係
#

class SimConfig(msgspec.Struct, frozen=True, cache_hash=True):
	startDateTime: datetime
	endDateTime: datetime
	tickInterval: float


class SimSetting(msgspec.Struct, frozen=True, cache_hash=True):
	simConfig: SimConfig
	units: List[Unit]
	placedUnits: List[PlacedUnit]
	mapElements: List[MapElement]


class PersonnelEquipmentsRecord(msgspec.Struct):
	current_personnel: int
	current_equipments: Dict[str, int]
	lower_units: Dict[str, 'PersonnelEquipmentsRecord']

	def all_current_equipments(self) -> Dict[str, int]:
		total_equipments = Counter(self.current_equipments)
		
		for record in self.lower_units.values():
			total_equipments.update(record.all_current_equipments())
			
		return dict(total_equipments)

	def add_personnel_damage(self, personnel_damage : int) -> int:
		for record in self.lower_units.values():
			personnel_damage = record.add_personnel_damage(personnel_damage)

		remaining_personnel_damage = max(personnel_damage - self.current_personnel, 0)
		self.current_personnel = max(self.current_personnel - personnel_damage, 0)

		return remaining_personnel_damage

	def add_equipment_damage(self, equipment_name: str, equipment_damage: int) -> int:
		for record in self.lower_units.values():
			equipment_damage = record.add_equipment_damage(equipment_name, equipment_damage)

		if equipment_name in self.current_equipments:
			current_amount = self.current_equipments[equipment_name]
			apply_damage = min(current_amount, equipment_damage)
			
			self.current_equipments[equipment_name] -= apply_damage
			equipment_damage -= apply_damage

		return equipment_damage


class UnitRecord(msgspec.Struct):
	trajectory: List[GeoLocation]
	actions: List[UnitAction]
	detectedUnits: List[DetectLog]
	attackingUnits: List[AttackLog]
	suppressionRate: float
	personnelEquipments: PersonnelEquipmentsRecord
	currentMoveSpeed: Optional[MoveSpeed] = None
	currentMoveMode: Optional[MoveMode] = None
	currentFireMode: Optional[FireMode] = None
	currentTargetPos: Optional[GeoLocation] = None
	currentPath: Optional[List[GeoLocation]] = None


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


class UnitDeploymentCoeff(msgspec.Struct, frozen=True, cache_hash=True):
	base_area: float
	scale_factor: float
	scaling_table: Dict[UnitType, Dict[MoveMode, float]]


class MobilityCoeff(msgspec.Struct, frozen=True, cache_hash=True):
	cost: Dict[VehicleType, Dict[str, float]]
	cost_scale: Dict[MoveSpeed, float]
	move_speed_cap: Dict[MoveSpeed, float]
	speed_scale_by_move_mode: Dict[MoveMode, float]


class IntelligenceCoeff(msgspec.Struct, frozen=True, cache_hash=True):
	personnel_sensor: Sensor
	temporal_discovery_advantage: float

	discovery_distance_scale_by_move_speed: Dict[MoveSpeed, float]
	discovery_distance_scale_by_move_mode: Dict[MoveMode, float]
	discovery_distance_scale_by_vehicle_type: Dict[SensorType, Dict[VehicleType, float]]

	exposure_distance_scale_by_move_speed: Dict[MoveSpeed, float]
	exposure_distance_scale_by_move_mode: Dict[MoveMode, float]


class CombatCoeff(msgspec.Struct, frozen=True, cache_hash=True):
	fire_power_efficiency: float
	damage_speed: float
	suppression_factor: float

	range_scale_by_move_speed: Dict[MoveSpeed, float]
	range_scale_by_move_mode: Dict[MoveMode, float]

	damage_scale_by_move_speed: Dict[MoveSpeed, float]
	damage_scale_by_move_mode: Dict[MoveMode, float]
	damage_scale_by_target_type: Dict[WeaponType, Dict[VehicleType, float]]


class Coefficients(msgspec.Struct, frozen=True, cache_hash=True):
	unit_deployment: UnitDeploymentCoeff
	mobility: MobilityCoeff
	intelligence: IntelligenceCoeff
	combat: CombatCoeff

