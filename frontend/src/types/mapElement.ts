import type { Force } from './unitTypes';
import { FORCE_STYLES } from './unitTypes';

export type ElementType = 'operation' | 'fortification' | 'obstacle' | 'coa';
export type GeometryType = 'polygon' | 'polyline' | 'point';

export interface MapElement {
	id: string;
	type: ElementType;
	force: Force;
	geometry: GeometryType;
	name: string;
	layer?: L.Layer;
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

export const mapElementToJSON = (element: MapElement) => {
	const geometry = element.layer && 'toGeoJSON' in element.layer 
		? (element.layer as any).toGeoJSON() 
		: null;

	return {
		id: element.id,
		type: element.type,
		force: element.force,
		geometry: element.geometry,
		name: element.name,
		geoJson: geometry,
	};
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
