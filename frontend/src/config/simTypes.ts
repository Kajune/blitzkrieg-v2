export interface SimConfig {
	startDateTime: Date;
	endDateTime: Date;
}

export interface UnitRecord {
	position: { lat: number, lon: number };
}

export interface SimRecord {
	startDateTime: Date;
	endDateTime: Date;
	units: Record<string, UnitRecord>;
}
