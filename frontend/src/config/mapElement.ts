
export type ElementType = 'operation' | 'fortification' | 'obstacle' | 'red' | 'blue';
export type GeometryType = 'polygon' | 'polyline' | 'point';

export interface MapElement {
	id: string;
	type: ElementType;
	geometry: GeometryType;
	name: string;
	layer?: L.Layer;
}

export const getTypeColor = (type: string): string => {
	switch (type) {
		case 'red': return 'red';
		case 'blue': return 'blue';
		case 'operation': return 'gray';
		case 'fortification': return 'green';
		case 'obstacle': return 'brown';
		default: return 'black';
	}
};

export const ElementTypeName: Record<ElementType, string> = {
	'operation': "作戦地域",
	'fortification': "陣地",
	'obstacle': "障害",
	'red': "REDFOR",
	'blue': "BLUFOR",
};

export const GeometryTypeName: Record<GeometryType, string> = {
	'polygon': "エリア",
	'polyline': "線",
	'point': "点",
};


