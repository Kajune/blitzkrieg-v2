import { useEffect, useRef, useState } from 'react';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import ms from 'milsymbol';

import type { MapElement } from '../config/mapElement'
import { getTypeColor } from '../config/mapElement'
import type { Unit, PlacedUnit } from '../config/unitTypes';
import { getTotalPersonnel, getSymbolSize } from '../config/unitTypes';

L.Marker.prototype.options.icon = L.icon({
	iconUrl: icon,
	shadowUrl: iconShadow,
	iconSize: [25, 41],
	iconAnchor: [12, 41],
});

export const useMapEditor = (showLabels: boolean) => {
	const mapInstance = useRef<L.Map | null>(null);
	const mapRef = useRef<HTMLDivElement | null>(null);
	const [elements, setElements] = useState<MapElement[]>([]);
	const [pendingElement, setPendingElement] = useState<Partial<MapElement> | null>(null);
	const [points, setPoints] = useState<L.LatLng[]>([]);
	const [placedUnits, setPlacedUnits] = useState<PlacedUnit[]>([]);

	const pendingRef = useRef(pendingElement);
	const pointsRef = useRef(points);
	const showLabelsRef = useRef(showLabels);
	const unitLayerMap = useRef<Map<string, L.Layer>>(new Map());

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
	};

	const removeUnitFromMap = (unitId: string) => {
		const layer = unitLayerMap.current.get(unitId);
		if (layer && mapInstance.current) {
			mapInstance.current.removeLayer(layer);
			unitLayerMap.current.delete(unitId);
		}
	};

	useEffect(() => {
		pendingRef.current = pendingElement;
		pointsRef.current = points;
		showLabelsRef.current = showLabels;
	}, [pendingElement, points, showLabels]);

	const startDrawing = (el: Partial<MapElement>) => {
		setPendingElement(el);
		setPoints([]);
	};

	const completeDrawing = (finalPoints: L.LatLng[]) => {
		if (!pendingRef.current || !mapInstance.current) return;

		if (tempLayerRef.current) {
			mapInstance.current.removeLayer(tempLayerRef.current);
			tempLayerRef.current = null;
		}
		let layer: L.Layer | null = null;
		const color = getTypeColor(pendingRef.current.type || '');

		if (pendingRef.current.geometry === 'polygon' && finalPoints.length >= 3) {
			layer = L.polygon(finalPoints, { color }).addTo(mapInstance.current);
		} else if (pendingRef.current.geometry === 'polyline' && finalPoints.length >= 2) {
			layer = L.polyline(finalPoints, { color }).addTo(mapInstance.current);
		} else if (pendingRef.current.geometry === 'point') {
			const isRed = pendingRef.current.type === 'red';
			const color = isRed ? 'red' : 'blue';

			const icon = L.divIcon({
				className: '',
				html: `<div style="
					color: ${color}; 
					font-size: 28px; 
					display: flex; 
					justify-content: center; 
					align-items: center;
					width: 100%;
					height: 100%;
				">+</div>`,
				iconSize: [30, 30],
				iconAnchor: [15, 15]
			});
			layer = L.marker(finalPoints[0], { icon }).addTo(mapInstance.current);
		}

		if (layer) {
			layer.bindTooltip(pendingRef.current.name ?? '', { 
				permanent: true, 
				direction: 'center',
				className: 'my-custom-tooltip'
			});
			
			if (!showLabels) {
				layer.closeTooltip();
			}
			
			setElements((prev) => [...prev, { ...pendingRef.current as MapElement, layer }]);
		}

		setPendingElement(null);
		setPoints([]);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		const unitData: Unit = JSON.parse(e.dataTransfer.getData('application/json'));
		
		const isAlreadyPlaced = placedUnits.some((u) => u.id === unitData.id);
		if (isAlreadyPlaced) {
			console.warn("この部隊は既に配置済みです:", unitData.templateId);
			return;
		}

		if (!unitData || !mapInstance.current) return;

		const rect = mapRef.current?.getBoundingClientRect();
		if (!rect) return;
		
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const latLng = mapInstance.current.containerPointToLatLng([x, y]);

		const totalPersonnel = getTotalPersonnel(unitData);
		const symbolSize = getSymbolSize(totalPersonnel);

		const symbol = new ms.Symbol(unitData.sidc, { size: symbolSize });
		const icon = L.divIcon({
			className: '',
			html: symbol.asSVG(),
			iconSize: [symbolSize, symbolSize],
			iconAnchor: [symbolSize / 2, symbolSize / 2]
		});

		const layer = L.marker(latLng, {
			icon,
			draggable: true
		}).addTo(mapInstance.current);

		layer.on('dragend', (e) => {
			const marker = e.target as L.Marker;
			const newPos = marker.getLatLng();
			
			setPlacedUnits((prev) => 
				prev.map(u => u.id === unitData.id 
					? { ...u, position: { x: newPos.lat, y: newPos.lng } } 
					: u
				)
			);
		});

		layer.on('contextmenu', () => {
			removeUnitFromMap(unitData.id);
			setPlacedUnits((prev) => prev.filter(u => u.id !== unitData.id));
		});

		layer.bindTooltip(unitData.templateId);
		unitLayerMap.current.set(unitData.id, layer);

		const newPlacedUnit: PlacedUnit = {
			...unitData,
			position: { x: latLng.lat, y: latLng.lng }
		};

		setPlacedUnits((prev) => [...prev, newPlacedUnit]);
	};

	const tempLayerRef = useRef<L.Polyline | null>(null);

	useEffect(() => {
		if (!mapInstance.current || !pendingElement) return;

		const handleMouseMove = (e: L.LeafletMouseEvent) => {
			if (points.length === 0 || !mapInstance.current) return;

			const color = getTypeColor(pendingElement.type || '');
			const currentPoints = [...points, e.latlng];

			if (tempLayerRef.current) {
				mapInstance.current.removeLayer(tempLayerRef.current);
			}
			
			tempLayerRef.current = L.polyline(currentPoints, { 
				color, 
				dashArray: '5, 5',
				interactive: false 
			}).addTo(mapInstance.current);
		};

		mapInstance.current.on('mousemove', handleMouseMove);
		return () => { mapInstance.current?.off('mousemove', handleMouseMove); };
	}, [pendingElement, points]);


	useEffect(() => {
		if (!mapRef.current) return;
		const map = L.map(mapRef.current, { doubleClickZoom: false }).setView([35.6812, 139.7671], 13);
		L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png').addTo(map);
		mapInstance.current = map;

		const handleClick = (e: L.LeafletMouseEvent) => {
			const pending = pendingRef.current;
			if (!pending) return;

			if (pending.geometry === 'point') {
				// 点の場合はクリック一回で確定
				completeDrawing([e.latlng]);
			} else {
				// ポリゴンやラインは座標リストに追加
				setPoints((prev) => [...prev, e.latlng]);
			}
		};

		const handleDblClick = (e: L.LeafletMouseEvent) => {
			if (pendingRef.current) {
				completeDrawing([...pointsRef.current, e.latlng]);
			}
		};

		map.on('click', handleClick);
		map.on('dblclick', handleDblClick);

		return () => {
			map.off('click', handleClick);
			map.off('dblclick', handleDblClick);
			map.remove();
		};
	}, []);

	useEffect(() => {
		elements.forEach((el) => {
			if (!el.layer) return;
			if (showLabels) {
				el.layer.openTooltip();
			} else {
				el.layer.closeTooltip();
			}
		});
	}, [showLabels, elements]);

	return {
		mapRef,
		elements,
		setElements,
		placedUnits,
		pendingElement,
		startDrawing,
		handleDragOver,
		handleDrop,
		removeUnitFromMap,
	};
};

