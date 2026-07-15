import { useEffect, useRef, useState } from 'react';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

import { useAppStore } from '../contexts/AppContext';
import type { MapElement } from '../types/mapElement'
import { getMapElementColor } from '../types/mapElement'
import type { Unit, PlacedUnit, Force, DetectLog, AttackLog } from '../types/unitTypes';
import { UnitMarker } from './UnitMarker';
import { ElementLayer } from './ElementLayer';
import { generateUnitIcon } from '../utils/unitIcon';
import type { GeometryType } from '../types/mapElement';
import type { Feature } from 'geojson';
import '../App.module.css';

L.Marker.prototype.options.icon = L.icon({
	iconUrl: icon,
	shadowUrl: iconShadow,
	iconSize: [25, 41],
	iconAnchor: [12, 41],
});

export const useMapEditor = (
	showLabels: boolean,
	showDetectionPolygons: boolean,
	showMobilityMap: boolean,
	isUnitPlacementOpen: boolean,
) => {
	const mapInstance = useRef<L.Map | null>(null);
	const mapRef = useRef<HTMLDivElement | null>(null);
	const { 
		mapElements, setMapElements, 
		placedUnits, setPlacedUnits,
		simDatalink, displayForce,
		mobilityMap,
		simUuid,
	} = useAppStore();
	const [pendingElement, setPendingElement] = useState<MapElement | null>(null);
	const [points, setPoints] = useState<L.LatLng[]>([]);
	const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
	const selectedUnitIdRef = useRef(selectedUnitId);
	useEffect(() => {
		selectedUnitIdRef.current = selectedUnitId;
	}, [selectedUnitId]);
	const [shouldFocusAfterLoad, setShouldFocusAfterLoad] = useState(false);

	const pendingRef = useRef(pendingElement);
	const pointsRef = useRef(points);
	const showLabelsRef = useRef(showLabels);
	const showDetectionPolygonsRef = useRef(showDetectionPolygons);
	const showMobilityMapRef = useRef(showMobilityMap);
	const mobilityLayerRef = useRef<L.Layer | null>(null);
	const { unitLayerMap, actionLayerMap, detectionLayerMap } = useAppStore();

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
	};

	const removeUnitFromMap = (unitId: string) => {
		const layer = unitLayerMap.current.get(unitId);
		if (layer && mapInstance.current) {
			mapInstance.current.removeLayer(layer);
			unitLayerMap.current.delete(unitId);
		}

		const layers = detectionLayerMap.current.get(unitId);
		if (layers) {
			layers.forEach(layer => layer.remove());
			detectionLayerMap.current.delete(unitId);
		}

		setPlacedUnits((prev) => prev.filter(u => u.id !== unitId));

		if (selectedUnitId === unitId) {
			setSelectedUnitId(null);
		}
	};

	const updateDetectionAttackPolygons = (unitId: string, detectedUnits: DetectLog[], attackingUnits: AttackLog[]) => {
		const existingLayers = detectionLayerMap.current.get(unitId) || [];
		existingLayers.forEach(layer => layer.remove());

		if (!showDetectionPolygonsRef.current) {
			return;
		}

		const sourceMarker = unitLayerMap.current.get(unitId);
		if (!sourceMarker) return;
		const sourcePos = sourceMarker.getLatLng();

		const sourceUnit = placedUnits.find(u => u.id === unitId);
		if (!sourceUnit) return;

		const isUnitVisible = displayForce === 'GOD' || sourceUnit.force === displayForce;

		if (!isUnitVisible) {
			detectionLayerMap.current.set(unitId, []);
			return;
		}

		// 攻撃対象となっているユニットIDのセットを作成
		const attackingTargetIds = new Set(attackingUnits.map(a => a.unitId));

		const newPolygons: L.Polygon[] = detectedUnits.map((log) => {
			const targetMarker = unitLayerMap.current.get(log.unitId);
			if (!targetMarker) return null;
			const targetPos = targetMarker.getLatLng();

			const latDiff = targetPos.lat - sourcePos.lat;
			const lngDiff = targetPos.lng - sourcePos.lng;
			
			const dist = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
			if (dist === 0) return null;

			const unitLat = latDiff / dist;
			const unitLng = lngDiff / dist;

			const halfWidth = 0.05;

			const p1 = [
				sourcePos.lat + dist * (unitLat * Math.cos(halfWidth) - unitLng * Math.sin(halfWidth)),
				sourcePos.lng + dist * (unitLng * Math.cos(halfWidth) + unitLat * Math.sin(halfWidth))
			] as [number, number];
			
			const p2 = [
				sourcePos.lat + dist * (unitLat * Math.cos(-halfWidth) - unitLng * Math.sin(-halfWidth)),
				sourcePos.lng + dist * (unitLng * Math.cos(-halfWidth) + unitLat * Math.sin(-halfWidth))
			] as [number, number];

			const opacity = Math.min(0.5, log.awareness * 0.5);
			
			// 攻撃中なら赤、そうでなければ黄色
			const color = attackingTargetIds.has(log.unitId) ? 'red' : 'yellow';

			return L.polygon([
				[sourcePos.lat, sourcePos.lng],
				p1,
				p2
			], {
				color: color,
				fillColor: color,
				fillOpacity: opacity,
				weight: 0,
				interactive: false
			}).addTo(mapInstance.current!);
		}).filter((p): p is L.Polygon => p !== null);

		detectionLayerMap.current.set(unitId, newPolygons);
	};

	const deployChildren = async (unit: PlacedUnit) => {
		if (simUuid === null) {
			return;
		}

		try {
			const response = await fetch('/api/deploy_child_units', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sim_id: simUuid,
					placed_units: placedUnits,
					deploy_unit_id: unit.id,
				})
			});
			const result = await response.json();

			if (result.success && result.deployedUnits) {
				removeUnitFromMap(unit.id);
				const newUnits: PlacedUnit[] = result.deployedUnits;
				setPlacedUnits((prev) => [...prev, ...newUnits]);
				setSelectedUnitId(null);
			} else {
				console.log(result.errors);
			}
		} catch (err) {
			console.error('部隊の展開に失敗しました', err);
		}

	};

	useEffect(() => {
		pendingRef.current = pendingElement;
		pointsRef.current = points;
		showLabelsRef.current = showLabels;
		showDetectionPolygonsRef.current = showDetectionPolygons;
		showMobilityMapRef.current = showMobilityMap;
	}, [pendingElement, points, showLabels, showDetectionPolygons, showMobilityMap]);

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

	const convertPointsToGeoJson = (geometry: GeometryType, points: L.LatLng[]): Feature => {
		if (points.length === 0) {
			return { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} };
		}

		switch (geometry) {
			case 'point':
				return {
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: [points[0].lng, points[0].lat]
					},
					properties: {}
				};

			case 'polyline':
				return {
					type: 'Feature',
					geometry: {
						type: 'LineString',
						coordinates: points.map(p => [p.lng, p.lat])
					},
					properties: {}
				};

			case 'polygon':
				// ポリゴンは始点と終点が同じである必要があるため、必要に応じて閉じる
				let coords = points.map(p => [p.lng, p.lat]);
				if (points.length > 0 && (points[0].lat !== points[points.length - 1].lat || points[0].lng !== points[points.length - 1].lng)) {
					coords.push([points[0].lng, points[0].lat]);
				}
				return {
					type: 'Feature',
					geometry: {
						type: 'Polygon',
						coordinates: [coords]
					},
					properties: {}
				};
				
			default:
				throw new Error(`Unsupported geometry type: ${geometry}`);
		}
	};

	const completeDrawing = (finalPoints: L.LatLng[]) => {
		if (!pendingRef.current || !mapInstance.current) return;

		if (tempLayerRef.current) {
			mapInstance.current.removeLayer(tempLayerRef.current);
			tempLayerRef.current = null;
		}

		const newGeoJson = convertPointsToGeoJson(pendingRef.current.geometry, finalPoints);

		setMapElements((prev) => [
			...prev, 
			{ 
				...pendingRef.current!, 
				geoJson: newGeoJson
			}
		]);

		setPendingElement(null);
		setPoints([]);
	};

	useEffect(() => {
		// placedUnitsが更新されるたびに、該当するマーカーのアイコンを再設定する
		placedUnits.forEach((unit) => {
			const marker = unitLayerMap.current.get(unit.id);
			if (marker) {
				const currentIcon = marker.getIcon();
				const newIcon = generateUnitIcon(unit);
				
				// アイコンのHTMLを比較して、変更がある場合のみ更新する
				// (無駄な再描画を防ぐため)
				if ((currentIcon as any).options.html !== (newIcon as any).options.html) {
					marker.setIcon(newIcon);
				}
			}
		});
	}, [placedUnits]);

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

		const isUnitControllable = displayForce === 'GOD' || unitData.force === displayForce;
		if (!isUnitControllable) return;

		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const latLng = mapInstance.current.containerPointToLatLng([x, y]);
		
		const newPlacedUnit: PlacedUnit = {
			...unitData,
			currentMoveMode: null,
			currentMoveSpeed: null,
			currentFireMode: null,
			currentTargetPos: null,
			currentPath: null,
			current_personnel: unitData.full_personnel,
			current_equipments: unitData.full_equipments,
			position: { lat: latLng.lat, lon: latLng.lng },
			actions: [],
			detectedUnits: [],
			attackingUnits: [],
			suppressionRate: 0,
		};

		setPlacedUnits((prev) => [...prev, newPlacedUnit]);
	};

	const clearMap = () => {
		if (!mapInstance.current) return;
		
		mapInstance.current.eachLayer((layer) => {
			if (layer instanceof L.Marker || layer instanceof L.Path) {
				mapInstance.current!.removeLayer(layer);
			}
		});
		
		unitLayerMap.current.clear();
		detectionLayerMap.current.forEach(layers => {
			layers.forEach(layer => layer.remove());
		});
		detectionLayerMap.current.clear();
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

	useEffect(() => {
		if (shouldFocusAfterLoad) {
			requestAnimationFrame(() => {
				focusAll();
				setShouldFocusAfterLoad(false);
			});
		}
	}, [shouldFocusAfterLoad, mapElements, placedUnits]);

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

			const sourceUnit = placedUnits.find((u) => u.id === currentId);
			if (!sourceUnit) return;

			const isUnitControllable = displayForce === 'GOD' || sourceUnit.force === displayForce;
			if (!isUnitControllable) return;

			let targetUnitId: string | null = null;
			unitLayerMap.current.forEach((layer, unitId) => {
				if (unitId !== currentId && layer.getLatLng().equals(e.latlng, 0.001)) {
					targetUnitId = unitId;
				}
			});

			const newAction = {
				id: crypto.randomUUID(),
				moveSpeed: 'MEDIUM' as const,
				moveMode: 'COMBAT' as const,
				fireMode: 'ON' as const,
				targetPosition: targetUnitId ? null : { lat: e.latlng.lat, lon: e.latlng.lng },
				targetUnitId: targetUnitId,
				finished: false,
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
	}, [placedUnits, displayForce]);

	useEffect(() => {
		const map = mapInstance.current;
		if (!map) return;

		actionLayerMap.current.forEach((layers) => {
			layers.forEach(layer => map.removeLayer(layer));
		});
		actionLayerMap.current.clear();

		placedUnits.forEach((unit) => {
			const activeActions = unit.actions.filter(a => !a.finished);
			if (activeActions.length === 0) return;

			const lines: L.Polyline[] = [];
			let currentPos: L.LatLng = L.latLng(unit.position.lat, unit.position.lon);

			activeActions.forEach((action, index) => {
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
					const isApproach = !!action.targetUnitId;
					let isEnemy = false;
					if (isApproach) {
						const targetUnit = placedUnits.find(u => u.id === action.targetUnitId);
						if (targetUnit && targetUnit.force !== unit.force) {
							isEnemy = true;
						}
					}

					const line = L.polyline([currentPos, targetPos], {
						color: isApproach ? (isEnemy ? 'red' : 'green') : 'yellow',
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
		const map = mapInstance.current;
		if (!map) return;

		placedUnits.forEach((unit) => {
			const unitMarker = unitLayerMap.current.get(unit.id);
			const actionLines = actionLayerMap.current.get(unit.id);
			const detectionPolygons = detectionLayerMap.current.get(unit.id);

			const isVisible = (() => {
				if (displayForce === 'GOD') return true;
				const currentForce = displayForce as Force;
				return unit.force === currentForce || (simDatalink[currentForce]?.includes(unit.id) ?? false);
			})();
			const isVisibleCOA = displayForce === 'GOD' || unit.force === displayForce;

			if (unitMarker) {
				if (isVisible && !map.hasLayer(unitMarker)) {
					unitMarker.addTo(map);
				} else if (!isVisible && map.hasLayer(unitMarker)) {
					map.removeLayer(unitMarker);
				}
			}

			if (actionLines) {
				actionLines.forEach(line => {
					if (isVisibleCOA && !map.hasLayer(line)) line.addTo(map);
					else if (!isVisibleCOA && map.hasLayer(line)) map.removeLayer(line);
				});
			}

			if (detectionPolygons) {
				detectionPolygons.forEach(poly => {
					if ((isVisibleCOA && showDetectionPolygons) && !map.hasLayer(poly)) poly.addTo(map);
					else if (!(isVisibleCOA && showDetectionPolygons) && map.hasLayer(poly)) map.removeLayer(poly);
				});
			}
		});
	}, [displayForce, placedUnits, mapElements, showDetectionPolygons]);

	useEffect(() => {
		const map = mapInstance.current;
		if (!map) return;

		if (mobilityLayerRef.current) {
			map.removeLayer(mobilityLayerRef.current);
			mobilityLayerRef.current = null;
		}

		if (showMobilityMap && mobilityMap) {
			const feature = ('features' in mobilityMap) 
				? (mobilityMap.features as any[])[0] 
				: mobilityMap;

			if (feature && feature.geometry && feature.properties?.mesh_data) {
				const coords = feature.geometry.coordinates[0];
				const lngs = coords.map((c: number[]) => c[0]);
				const lats = coords.map((c: number[]) => c[1]);
				
				const bounds = L.latLngBounds(
					L.latLng(Math.min(...lats), Math.min(...lngs)),
					L.latLng(Math.max(...lats), Math.max(...lngs))
				);

				const imageUrl = `data:${feature.properties.mime_type};base64,${feature.properties.mesh_data}`;

				const overlay = L.imageOverlay(imageUrl, bounds, {
					opacity: 0.7,
					interactive: false
				}).addTo(map);

				mobilityLayerRef.current = overlay;
			}
		}
	}, [mobilityMap, showMobilityMap]);

	const renderMarkers = () => {
		if (!mapInstance.current) return null;
		return placedUnits.map(unit => (
			<UnitMarker
				key={unit.id}
				unit={unit}
				map={mapInstance.current!}
				isDraggable={isUnitPlacementOpen}
				onDragEnd={(id, latlng) => {
					setPlacedUnits(prev => prev.map(u => u.id === id ? { ...u, position: { lat: latlng.lat, lon: latlng.lng } } : u));
				}}
				onClick={setSelectedUnitId}
			/>
		));
	};

	const renderElements = () => {
		if (!mapInstance.current) return null;
		
		return mapElements.map(el => {
			const isForceVisible = displayForce === 'GOD' || el.force === displayForce || el.type !== 'coa';
			const isVisible = isForceVisible;

			return (
				<ElementLayer 
					key={el.id} 
					map={mapInstance.current!} 
					element={el} 
					isVisible={isVisible}
					showLabels={showLabels} 
				/>
			);
		});
	};

	return {
		clearMap,
		setShouldFocusAfterLoad,
		mapRef,
		pendingElement,
		selectedUnitId,
		setSelectedUnitId,
		startDrawing,
		handleDragOver,
		handleDrop,
		removeUnitFromMap,
		updateDetectionAttackPolygons,
		deployChildren,
		renderMarkers,
		renderElements,
	};
};

