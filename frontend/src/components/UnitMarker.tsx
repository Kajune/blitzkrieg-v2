import { useEffect, useRef } from 'react';
import { useAppStore } from '../contexts/AppContext';
import L from 'leaflet';
import { generateUnitIcon } from '../utils/unitIcon';
import type { PlacedUnit } from '../types/unitTypes';

interface Props {
	unit: PlacedUnit;
	map: L.Map;
	isDraggable: boolean;
	isVisible: boolean;
	onDragEnd: (id: string, latlng: L.LatLng) => void;
	onClick: (id: string) => void;
}

export const UnitMarker = ({ unit, map, isDraggable, isVisible, onDragEnd, onClick }: Props) => {
	const markerRef = useRef<L.Marker | null>(null);
	const { unitLayerMap } = useAppStore();

	useEffect(() => {
		if (isVisible) {
			const marker = L.marker([unit.position.lat, unit.position.lon], {
				icon: generateUnitIcon(unit),
				draggable: isDraggable
			}).addTo(map);
			
			markerRef.current = marker;
			unitLayerMap.current.set(unit.id, marker);

			markerRef.current.on('dragend', (e) => onDragEnd(unit.id, e.target.getLatLng()));
			markerRef.current.on('click', () => onClick(unit.id));
			markerRef.current.bindTooltip(unit.templateId);
		}

		return () => { 
			if (unit.id) {
				unitLayerMap.current.delete(unit.id);
			}
			markerRef.current?.remove(); 
			markerRef.current = null;
		};
	}, [isVisible, map, unit.id]);

	useEffect(() => {
		if (!markerRef.current) return;
		markerRef.current.setIcon(generateUnitIcon(unit));
		markerRef.current.dragging?.[isDraggable ? 'enable' : 'disable']();
	}, [unit, isDraggable]);

	return null;
};