import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getMapElementColor } from '../types/mapElement';
import type { MapElement } from '../types/mapElement';
import '../App.module.css';

interface Props {
	element: MapElement;
	showLabels: boolean;
}

export const ElementLayer = ({ element, showLabels }: Props) => {
	const map = useMap();
	const layerRef = useRef<L.GeoJSON | null>(null);

	useEffect(() => {
		const style = { color: getMapElementColor(element) };
		const layer = L.geoJSON(element.geoJson as any, {
			style: () => style,
			pointToLayer: (_feature, latlng) => {
				const icon = L.divIcon({ 
					className: '', 
					html: `<div style="color: ${style.color}; font-size: 28px;">+</div>`, 
					iconSize: [30, 30], 
					iconAnchor: [15, 15] 
				});
				return L.marker(latlng, { icon });
			}
		}).addTo(map);

		if (showLabels) {
			layer.bindTooltip(element.name ?? '', { 
				permanent: true, 
				direction: 'center', 
				className: 'my-custom-tooltip' 
			});
		}

		layerRef.current = layer;
		return () => { layer.remove(); };
	}, [element, showLabels]);

	return null;
};