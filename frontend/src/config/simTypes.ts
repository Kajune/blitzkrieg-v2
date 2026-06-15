export interface SimConfig {
	startDateTime: Date;
	endDateTime: Date;
	tickInterval: number;
}

export interface UnitRecord {
	position: { lat: number, lon: number };
}

export interface SimRecord {
	startDateTime: Date;
	endDateTime: Date;
	units: Record<string, UnitRecord>;
}
