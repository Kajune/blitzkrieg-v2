import type { GeoLocation, UnitAction } from './unitTypes';

export interface SimConfig {
	startDateTime: Date;
	endDateTime: Date;
	tickInterval: number;
}

export interface UnitRecord {
	position: GeoLocation;
	actions: UnitAction[];
}

export interface SimRecord {
	startDateTime: Date;
	endDateTime: Date;
	unitRecords: Record<string, UnitRecord>;
}
