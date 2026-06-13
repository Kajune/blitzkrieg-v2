export interface UnitTemplate {
	id: string;
	name: string;
	sidc: { [key in 'BLUFOR' | 'REDFOR']: string };
	personnel: number;
	equipments: { [key: string]: number };
	lower_units: { [key: string]: number };
}

export const UNIT_TEMPLATES: UnitTemplate[] = [
	{
		id: 'MB',
		name: '機械化旅団',
		sidc: {
			'BLUFOR': '10031000001211020000',
			'REDFOR': '10061000001211020000',
		},
		type: 'infantry',
		personnel: 50,
		equipments: { },
		lower_units: { 'MBn': 3 }
	},
	{
		id: 'MBn',
		name: '機械化大隊',
		sidc: {
			'BLUFOR': '10031000001211020000',
			'REDFOR': '10061000001211020000',
		},
		type: 'infantry',
		personnel: 20,
		equipments: { '拳銃': 20 },
		lower_units: { 'MCo': 3 }
	},
	{
		id: 'MCo',
		name: '機械化中隊',
		sidc: {
			'BLUFOR': '10031000001211020000',
			'REDFOR': '10061000001211020000',
		},
		type: 'infantry',
		personnel: 200,
		equipments: { '装甲戦闘車': 20, '自動銃': 180 },
		lower_units: {}
	},
];