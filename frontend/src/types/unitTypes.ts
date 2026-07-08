export interface GeoLocation {
	lat: number;
	lon: number;
}

export const FORCES = ['REDFOR', 'BLUFOR'] as const;
export type Force = typeof FORCES[number];
export const DISPLAY_FORCES = ['GOD', ...FORCES] as const;
export type DisplayForce = typeof DISPLAY_FORCES[number];

export type ForceStyle = {
	color: string;
	class: string;
};

export const FORCE_STYLES: Record<Force, ForceStyle> = {
	REDFOR: {
		color: 'red',
		class: 'danger',
	},
	BLUFOR: {
		color: 'blue',
		class: 'primary',
	},
};

export interface UnitTemplate {
	id: string;
	name: string;
	sidc: string;
	type: string;
	personnel: number;
	equipments: { [key: string]: number };
	lower_units: { [key: string]: number };
}

export interface Unit {
	id: string;
	templateId: string;
	force: Force;
	name: string;
	sidc: string;
	type: string;
	full_personnel: number;
	current_personnel: number;
	full_equipments: { [key: string]: number };
	current_equipments: { [key: string]: number };
	lower_units: Unit[];
}


export const MOVE_SPEEDS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type MoveSpeed = typeof MOVE_SPEEDS[number];

export const MOVE_MODES = ['MARCH', 'COMBAT', 'DEFENSE', 'ARTIRELLY'] as const;
export type MoveMode = typeof MOVE_MODES[number];

export const FIRE_MODES = ['ON', 'OFF'] as const;
export type FireMode = typeof FIRE_MODES[number];

export interface DetectLog {
	unitId: string;
	awareness: number;
}

export interface AttackLog {
	unitId: string;
	firePower: number;
	weaponType: string;
}

export interface UnitAction {
	id: string;
	moveSpeed: MoveSpeed;
	moveMode: MoveMode;
	fireMode: FireMode;
	targetPosition: GeoLocation | null;
	targetUnitId: string | null;
	finished: boolean;
}

export interface PlacedUnit extends Unit {
	position: GeoLocation;
	actions: UnitAction[];
	detectedUnits: DetectLog[];
	attackingUnits: AttackLog[];
	suppressionRate: number;
	currentMoveSpeed: MoveSpeed | null;
	currentMoveMode: MoveMode | null;
	currentFireMode: FireMode | null;
	currentTargetPos: GeoLocation | null;
	currentPath: GeoLocation[] | null;
}

export const fetchUnitTemplates = async (): Promise<Record<Force,UnitTemplate[]>> => {
	try {
		const response = await fetch('/data/unitTemplates.json');
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		const data = await response.json();
		return data as Record<Force,UnitTemplate[]>;
	} catch (error) {
		console.error("テンプレートの読み込みに失敗しました:", error);

		const initialUnits = {} as Record<Force, UnitTemplate[]>;
		FORCES.forEach((force) => {
			initialUnits[force] = [];
		});

		return initialUnits;
	}
};

export const UNIT_TEMPLATES: Record<Force,UnitTemplate[]> = await fetchUnitTemplates();


export const reduceUnitTree = <T>(
	unit: Unit,
	selector: (u: Unit) => T,
	reducer: (acc: T, val: T) => T,
	initialValue: T
): T => {
	const current = selector(unit);
	const childrenTotal = unit.lower_units.reduce(
		(acc, child) => reducer(acc, reduceUnitTree(child, selector, reducer, initialValue)),
		initialValue
	);
	return reducer(current, childrenTotal);
};

export const getAllUnitIds = (unit: Unit): string[] => {
	return [unit.id, ...unit.lower_units.flatMap(child => getAllUnitIds(child))];
};

export const getTotalPersonnel = (unit: Unit, key: 'full_personnel' | 'current_personnel'): number => 
	reduceUnitTree(unit, (u) => (u as any)[key] || 0, (a, b) => a + b, 0);

export const getTotalEquipments = (unit: Unit, key: 'full_equipments' | 'current_equipments'): Record<string, number> => {
	return reduceUnitTree(
		unit,
		(u) => (u as any)[key] || {},
		(acc, val) => {
			const result = { ...acc };
			Object.entries(val).forEach(([k, v]) => {
				result[k] = (result[k] || 0) + (v as number);
			});
			return result;
		},
		{}
	);
};

export const getSymbolSize = (
	totalPersonnel: number,
	minPersonnel: number = 100,
	maxPersonnel: number = 10000,
	minSize: number = 20,
	maxSize: number = 60
): number => {
	const clampedPersonnel = Math.min(Math.max(totalPersonnel, minPersonnel), maxPersonnel);
	
	const t = (clampedPersonnel - minPersonnel) / (maxPersonnel - minPersonnel);
	const size = minSize + (maxSize - minSize) * Math.sqrt(t);

	return Math.round(size);
};
