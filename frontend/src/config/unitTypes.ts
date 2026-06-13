export interface UnitTemplate {
	id: string;
	name: string;
	sidc: { [key in 'BLUFOR' | 'REDFOR']: string };
	type: string;
	personnel: number;
	equipments: { [key: string]: number };
	lower_units: { [key: string]: number };
}

export interface Unit {
	id: string;
	templateId: string;
	name: string;
	sidc: string;
	type: string;
	personnel: number;
	equipments: { [key: string]: number };
	children: Unit[];
}

export interface PlacedUnit extends Unit {
	position: { x: number, y: number };
}

export const fetchUnitTemplates = async (): Promise<UnitTemplate[]> => {
	try {
		const response = await fetch('/data/unitTemplates.json');
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		const data = await response.json();
		return data as UnitTemplate[];
	} catch (error) {
		console.error("テンプレートの読み込みに失敗しました:", error);
		return [];
	}
};

export const getAllUnitIds = (unit: Unit): string[] => {
    return [unit.id, ...unit.children.flatMap(child => getAllUnitIds(child))];
};

export const getTotalPersonnel = (unit: Unit): number => {
	const childrenTotal = unit.children.reduce((acc, child) => acc + getTotalPersonnel(child), 0);
	return unit.personnel + childrenTotal;
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
	const size = minSize + (maxSize - minSize) * t;
	
	return Math.round(size);
};

export const UNIT_TEMPLATES: UnitTemplate[] = await fetchUnitTemplates();
