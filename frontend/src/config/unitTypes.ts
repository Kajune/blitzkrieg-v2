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

export const UNIT_TEMPLATES: UnitTemplate[] = await fetchUnitTemplates();
