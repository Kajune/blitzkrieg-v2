from dataclasses import dataclass
from enum import Enum
from datetime import datetime
from typing import TypeVar, Generic, Union, List, Dict, Type, Optional, cast
import msgspec
from shapely import get_coordinates, set_coordinates
from shapely.ops import transform
from shapely.geometry.base import BaseGeometry
import numpy as np
import cv2
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
		
		if isinstance(pos, list):
			coords = []
			for p in pos:
				x = p.lon if hasattr(p, 'lon') else p.easting
				y = p.lat if hasattr(p, 'lat') else p.northing
				coords.append([height - (y - sy) / dy, (x - sx) / dx])
			return np.array(coords)
		
		x = pos.lon if hasattr(pos, 'lon') else pos.easting
		y = pos.lat if hasattr(pos, 'lat') else pos.northing
		return np.array([height - (y - sy) / dy, (x - sx) / dx])


	def from_image_coord(self, pos: np.ndarray) -> Union[T, List[T]]:
		dx, dy, sx, sy = self._deltas
		height = self.data.shape[0]
		
		if pos.ndim == 2:
			results = []
			for p in pos:
				results.append(self.cls_t(sx + (height - p[1]) * dx, sy + p[0] * dy))
			return results
		
		return self.cls_t(sx + (height - pos[1]) * dx, sy + pos[0] * dy)


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
