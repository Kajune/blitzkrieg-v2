import type { GeoLocation, UnitAction, DetectLog, AttackLog } from './unitTypes';

export interface SimConfig {
	startDateTime: Date;
	endDateTime: Date;
	tickInterval: number;
}

export interface UnitRecord {
	trajectory: GeoLocation[];
	actions: UnitAction[];
	detectedUnits: DetectLog[];
	attackingUnits: AttackLog[];
}

export interface SimRecord {
	startDateTime: Date;
	endDateTime: Date;
	unitRecords: Record<string, UnitRecord>;
}
