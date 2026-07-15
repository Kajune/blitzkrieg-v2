import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { getMapElementColor } from '../types/mapElement';
import type { MapElement } from '../types/mapElement';

interface Props {
	map: L.Map;
	element: MapElement;
	isVisible: boolean;
	showLabels: boolean;
}

export const ElementLayer = ({ map, element, isVisible, showLabels }: Props) => {
	const layerRef = useRef<L.Layer | null>(null);

	useEffect(() => {
		if (isVisible) {
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

			layer.bindTooltip(element.name ?? '', { 
				permanent: true, 
				direction: 'center', 
				className: 'my-custom-tooltip' 
			});

			layerRef.current = layer;
		}

		return () => {
			if (layerRef.current) {
				layerRef.current.remove();
				layerRef.current = null;
			}
		};
	}, [isVisible, element, map]);

	useEffect(() => {
		const layer = layerRef.current;
		if (!layer) return;

		if (showLabels) {
			(layer as any).openTooltip();
		} else {
			(layer as any).closeTooltip();
		}
	}, [showLabels, isVisible]);

	return null;
};