import type { GeoLocation, MoveSpeed, MoveMode, FireMode, UnitAction, DetectLog, AttackLog } from './unitTypes';

export interface SimConfig {
	startDateTime: Date;
	endDateTime: Date;
	tickInterval: number;
}

export interface PersonnelEquipmentsRecord {
	current_personnel: number;
	current_equipments: { [key: string]: number };
	lower_units: Record<string, PersonnelEquipmentsRecord>;
}

export interface UnitRecord {
	trajectory: GeoLocation[];
	actions: UnitAction[];
	detectedUnits: DetectLog[];
	attackingUnits: AttackLog[];
	suppressionRate: number;
	personnelEquipments: PersonnelEquipmentsRecord;
	currentMoveSpeed: MoveSpeed | null;
	currentMoveMode: MoveMode | null;
	currentFireMode: FireMode | null;
	currentTargetPos: GeoLocation | null;
	currentPath: GeoLocation[] | null;
	dirty: boolean | null;
}

export interface SimRecord {
	startDateTime: Date;
	endDateTime: Date;
	unitRecords: Record<string, UnitRecord>;
}
