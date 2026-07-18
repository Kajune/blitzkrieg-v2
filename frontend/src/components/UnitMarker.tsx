import { useEffect, useRef } from 'react';
import { useMapStore } from '../contexts/MapContext';
import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { generateUnitIcon } from '../utils/unitIcon';
import type { PlacedUnit } from '../types/unitTypes';

interface Props {
	unit: PlacedUnit;
	isDraggable: boolean;
	onDragEnd: (id: string, latlng: L.LatLng) => void;
	onClick: (id: string) => void;
}

export const UnitMarker = ({ unit, isDraggable, onDragEnd, onClick }: Props) => {
	const markerRef = useRef<L.Marker | null>(null);
	const { unitLayerMap } = useMapStore();

	useEffect(() => {
		const marker = markerRef.current;
		if (marker) {
			unitLayerMap.current.set(unit.id, marker);
		}

		return () => {
			unitLayerMap.current.delete(unit.id);
		};
	}, [unit.id, unitLayerMap]);

	return (
		<Marker
			ref={markerRef}
			position={[unit.position.lat, unit.position.lon]}
			icon={generateUnitIcon(unit)}
			draggable={isDraggable}
			eventHandlers={{
				dragend: (e) => onDragEnd(unit.id, e.target.getLatLng()),
				click: () => onClick(unit.id),
			}}
		>
		<Tooltip>{unit.templateId}</Tooltip>
		</Marker>
	);
};