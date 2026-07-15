import type { Force } from './unitTypes';
import { FORCE_STYLES } from './unitTypes';
import type { GeoJsonObject } from 'geojson';

export type ElementType = 'operation' | 'fortification' | 'obstacle' | 'coa';
export type GeometryType = 'polygon' | 'polyline' | 'point';

export interface MapElement {
	id: string;
	type: ElementType;
	force: Force;
	geometry: GeometryType;
	name: string;
	geoJson: GeoJsonObject;
}

export const getMapElementColor = (element: MapElement): string => {
	switch (element.type) {
		case 'operation': return 'gray';
		case 'fortification': return 'green';
		case 'obstacle': return 'brown';
		case 'coa': return element.force ? FORCE_STYLES[element.force].color : 'black';
		default: return 'black';
	}
};

export const ElementTypeName: Record<ElementType, string> = {
	'operation': "作戦地域",
	'fortification': "陣地",
	'obstacle': "障害",
	'coa': "COA",
};

export const GeometryTypeName: Record<GeometryType, string> = {
	'polygon': "エリア",
	'polyline': "線",
	'point': "点",
};
