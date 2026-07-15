import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { generateUnitIcon } from '../utils/unitIcon';
import type { PlacedUnit } from '../types/unitTypes';

interface Props {
	unit: PlacedUnit;
	map: L.Map;
	isDraggable: boolean;
	onDragEnd: (id: string, latlng: L.LatLng) => void;
	onClick: (id: string) => void;
}

export const UnitMarker = ({ unit, map, isDraggable, onDragEnd, onClick }: Props) => {
	const markerRef = useRef<L.Marker | null>(null);

	useEffect(() => {
		markerRef.current = L.marker([unit.position.lat, unit.position.lon], {
			icon: generateUnitIcon(unit),
			draggable: isDraggable
		}).addTo(map);

		markerRef.current.on('dragend', (e) => onDragEnd(unit.id, e.target.getLatLng()));
		markerRef.current.on('click', () => onClick(unit.id));
		markerRef.current.bindTooltip(unit.templateId);

		return () => { 
			markerRef.current?.remove(); 
		};
	}, []);

	useEffect(() => {
		markerRef.current?.setIcon(generateUnitIcon(unit));
		markerRef.current?.dragging?.[isDraggable ? 'enable' : 'disable']();
	}, [unit, isDraggable]);

	return null;
};