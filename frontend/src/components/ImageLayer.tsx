import { useEffect } from 'react';
import L from 'leaflet';

interface ImageLayerProps {
	map: L.Map;
	isVisible: boolean;
	data: any;
}

export const ImageLayer = ({ map, isVisible, data }: ImageLayerProps) => {
	useEffect(() => {
		let overlay: L.ImageOverlay | null = null;

		if (isVisible && data) {
			const feature = ('features' in data) 
				? (data.features as any[])[0] 
				: data;

			if (feature && feature.geometry && feature.properties?.mesh_data) {
				const coords = feature.geometry.coordinates[0];
				const lngs = coords.map((c: number[]) => c[0]);
				const lats = coords.map((c: number[]) => c[1]);
				
				const bounds = L.latLngBounds(
					L.latLng(Math.min(...lats), Math.min(...lngs)),
					L.latLng(Math.max(...lats), Math.max(...lngs))
				);

				const imageUrl = `data:${feature.properties.mime_type};base64,${feature.properties.mesh_data}`;

				overlay = L.imageOverlay(imageUrl, bounds, {
					opacity: 0.7,
					interactive: false
				}).addTo(map);
			}
		}

		return () => {
			if (overlay) {
				map.removeLayer(overlay);
			}
		};
	}, [map, isVisible, data]);

	return null;
};