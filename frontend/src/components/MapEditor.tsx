import { useEffect, useRef, useState } from 'react';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import ms from 'milsymbol';
import type { GeoJsonObject } from 'geojson';

import { useAppStore } from '../contexts/AppContext';
import type { MapElement } from '../config/mapElement'
import { getMapElementColor } from '../config/mapElement'
import type { Unit, PlacedUnit } from '../config/unitTypes';
import { getTotalPersonnel, getSymbolSize } from '../config/unitTypes';
import '../App.module.css';

L.Marker.prototype.options.icon = L.icon({
	iconUrl: icon,
	shadowUrl: iconShadow,
	iconSize: [25, 41],
	iconAnchor: [12, 41],
});

export const useMapEditor = (
	showLabels: boolean,
	isUnitPlacementOpen: boolean
) => {
	const mapInstance = useRef<L.Map | null>(null);
	const mapRef = useRef<HTMLDivElement | null>(null);
	const { 
		mapElements, setMapElements, 
		placedUnits, setPlacedUnits,
	} = useAppStore();
	const [pendingElement, setPendingElement] = useState<MapElement | null>(null);
	const [points, setPoints] = useState<L.LatLng[]>([]);
	const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
	const selectedUnitIdRef = useRef(selectedUnitId);
	useEffect(() => {
		selectedUnitIdRef.current = selectedUnitId;
	}, [selectedUnitId]);

	const pendingRef = useRef(pendingElement);
	const pointsRef = useRef(points);
	const showLabelsRef = useRef(showLabels);
	const { unitLayerMap, actionLayerMap } = useAppStore();

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
	};

	const removeUnitFromMap = (unitId: string) => {
		const layer = unitLayerMap.current.get(unitId);
		if (layer && mapInstance.current) {
			mapInstance.current.removeLayer(layer);
			unitLayerMap.current.delete(unitId);
		}

		setPlacedUnits((prev) => prev.filter(u => u.id !== unitId));

		if (selectedUnitId === unitId) {
			setSelectedUnitId(null);
		}
	};

	const createLayerFromElement = (el: MapElement, geoJsonData : GeoJsonObject): L.Layer => {
		const style = { color: getMapElementColor(el) };

		const layer = L.geoJSON(geoJsonData, {
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
		}).addTo(mapInstance.current!);

		if (layer) {
			layer.bindTooltip(el.name ?? '', { 
				permanent: true, 
				direction: 'center',
				className: 'my-custom-tooltip'
			});
			
			if (!showLabels) {
				layer.closeTooltip();
			}
		}

		el.layer = layer;
		
		return layer;
	};

	const createLayerFromUnit = (unit: PlacedUnit): L.Marker => {
		const totalPersonnel = getTotalPersonnel(unit, 'full_personnel');
		const symbolSize = getSymbolSize(totalPersonnel);
		const symbol = new ms.Symbol(unit.sidc, { size: symbolSize });
		
		const sSize = symbol.getSize();

		const layer = L.marker([unit.position.lat, unit.position.lon], {
			icon: L.divIcon({
				className: 'milsymbol-icon',
				html: symbol.asSVG(),
				iconSize: [sSize.width, sSize.height],
				iconAnchor: [sSize.width / 2, sSize.height / 2]
			}),
			draggable: isUnitPlacementOpen
		}).addTo(mapInstance.current!);

		layer.on('dragend', (e) => {
			const marker = e.target as L.Marker;
			const newPos = marker.getLatLng();
			
			setPlacedUnits((prev) => 
				prev.map(u => u.id === unit.id 
					? { ...u, position: { lat: newPos.lat, lon: newPos.lng } } 
					: u
				)
			);
		});
		layer.on('click', () => setSelectedUnitId(unit.id));
		layer.bindTooltip(unit.templateId);
		unitLayerMap.current.set(unit.id, layer);
		return layer;
	};

	useEffect(() => {
		pendingRef.current = pendingElement;
		pointsRef.current = points;
		showLabelsRef.current = showLabels;
	}, [pendingElement, points, showLabels]);

	useEffect(() => {
		if (!mapInstance.current) return;

		unitLayerMap.current.forEach((layer) => {
			if (layer instanceof L.Marker) {
				if (isUnitPlacementOpen) {
					layer.dragging?.enable();
				} else {
					layer.dragging?.disable();
				}
			}
		});
	}, [isUnitPlacementOpen]);

	const startDrawing = (el: MapElement) => {
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
		const color = getMapElementColor(pendingRef.current);

		if (pendingRef.current.geometry === 'polygon' && finalPoints.length >= 3) {
			layer = L.polygon(finalPoints, { color }).addTo(mapInstance.current);
		} else if (pendingRef.current.geometry === 'polyline' && finalPoints.length >= 2) {
			layer = L.polyline(finalPoints, { color }).addTo(mapInstance.current);
		} else if (pendingRef.current.geometry === 'point') {
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
			
			setMapElements((prev) => [...prev, { ...pendingRef.current as MapElement, layer }]);
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

		const totalPersonnel = getTotalPersonnel(unitData, 'full_personnel');
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
			draggable: isUnitPlacementOpen
		}).addTo(mapInstance.current);

		layer.on('dragend', (e) => {
			const marker = e.target as L.Marker;
			const newPos = marker.getLatLng();
			
			setPlacedUnits((prev) => 
				prev.map(u => u.id === unitData.id 
					? { ...u, position: { lat: newPos.lat, lon: newPos.lng } } 
					: u
				)
			);
		});

		const newPlacedUnit: PlacedUnit = {
			...unitData,
			current_personnel: unitData.full_personnel,
			current_equipments: unitData.full_equipments,
			position: { lat: latLng.lat, lon: latLng.lng },
			actions: [],
		};

		setPlacedUnits((prev) => [...prev, newPlacedUnit]);

		layer.on('click', () => {
			setSelectedUnitId(newPlacedUnit.id);
		});

		layer.bindTooltip(newPlacedUnit.templateId);
		unitLayerMap.current.set(newPlacedUnit.id, layer);
	};

	const clearMap = () => {
		if (!mapInstance.current) return;
		
		mapInstance.current.eachLayer((layer) => {
			if (layer instanceof L.Marker || layer instanceof L.Path) {
				mapInstance.current!.removeLayer(layer);
			}
		});
		
		unitLayerMap.current.clear();
	};

	const focusAll = () => {
		const map = mapInstance.current;
		if (!map) return;

		const layers: L.Layer[] = [];
		
		map.eachLayer((layer) => {
			if (layer instanceof L.Marker || layer instanceof L.Path) {
				layers.push(layer);
			}
		});

		if (layers.length === 0) return;

		const bounds = L.latLngBounds(layers.map(l => 
			'getBounds' in l ? (l as any).getBounds() : (l as any).getLatLng()
		));

		map.fitBounds(bounds);
	};

	const tempLayerRef = useRef<L.Polyline | null>(null);

	useEffect(() => {
		if (!mapInstance.current || !pendingElement) return;

		const handleMouseMove = (e: L.LeafletMouseEvent) => {
			if (points.length === 0 || !mapInstance.current) return;

			const color = getMapElementColor(pendingElement);
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
			
			if (pending) {
				if (pending.geometry === 'point') {
					completeDrawing([e.latlng]);
				} else {
					setPoints((prev) => [...prev, e.latlng]);
				}
				return;
			}

			const target = e.originalEvent.target as HTMLElement;
			if (!target.closest('.leaflet-marker-icon')) {
				setSelectedUnitId(null);
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
		const map = mapInstance.current;
		if (!map) return;

		const handleContextMenu = (e: L.LeafletMouseEvent) => {
			e.originalEvent.preventDefault();
			
			const currentId = selectedUnitIdRef.current;
			if (!currentId) return;

			let targetUnitId: string | null = null;
			unitLayerMap.current.forEach((layer, unitId) => {
				if (unitId !== currentId && layer.getLatLng().equals(e.latlng, 0.001)) {
					targetUnitId = unitId;
				}
			});

			const newAction = {
				moveSpeed: 'MEDIUM' as const,
				moveMode: 'COMBAT' as const,
				fire: true,
				targetPosition: targetUnitId ? null : { lat: e.latlng.lat, lon: e.latlng.lng },
				targetUnitId: targetUnitId,
			};

			const isShiftPressed = e.originalEvent.shiftKey;

			setPlacedUnits((prev) =>
				prev.map((u) => {
					if (u.id !== currentId) return u;
					const nextActions = isShiftPressed ? [...u.actions, newAction] : [newAction];
					return { ...u, actions: nextActions };
				})
			);
		};

		map.on('contextmenu', handleContextMenu);
		return () => { map.off('contextmenu', handleContextMenu); };
	}, []);

	useEffect(() => {
		const map = mapInstance.current;
		if (!map) return;

		actionLayerMap.current.forEach((layers) => {
			layers.forEach(layer => map.removeLayer(layer));
		});
		actionLayerMap.current.clear();

		placedUnits.forEach((unit) => {
			if (unit.actions.length === 0) return;

			const lines: L.Polyline[] = [];
			let currentPos: L.LatLng = L.latLng(unit.position.lat, unit.position.lon);

			unit.actions.forEach((action, index) => {
				let targetPos: L.LatLng | null = null;
				
				if (action.targetPosition) {
					targetPos = L.latLng(action.targetPosition.lat, action.targetPosition.lon);
				} else if (action.targetUnitId) {
					const targetUnit = placedUnits.find(u => u.id === action.targetUnitId);
					if (targetUnit) {
						targetPos = L.latLng(targetUnit.position.lat, targetUnit.position.lon);
					}
				}

				if (targetPos) {
					const isFirstAction = index === 0;
					const isAttack = !!action.targetUnitId;

					const line = L.polyline([currentPos, targetPos], {
						color: isAttack ? 'red' : 'yellow',
						weight: 2,
						dashArray: isFirstAction ? '' : '5, 10',
						interactive: false
					}).addTo(map);
					
					lines.push(line);
					currentPos = targetPos;
				}
			});
			actionLayerMap.current.set(unit.id, lines);
		});
	}, [placedUnits]);

	useEffect(() => {
		mapElements.forEach((el) => {
			if (!el.layer) return;
			if (showLabels) {
				el.layer.openTooltip();
			} else {
				el.layer.closeTooltip();
			}
		});
	}, [showLabels, mapElements]);

	return {
		map: mapInstance.current,
		clearMap,
		focusAll,
		createLayerFromElement,
		createLayerFromUnit,
		mapRef,
		pendingElement,
		selectedUnitId,
		setSelectedUnitId,
		startDrawing,
		handleDragOver,
		handleDrop,
		removeUnitFromMap,
	};
};

