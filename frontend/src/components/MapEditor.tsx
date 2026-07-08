import { useEffect, useRef, useState } from 'react';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import ms from 'milsymbol';
import type { GeoJsonObject } from 'geojson';

import { useAppStore } from '../contexts/AppContext';
import type { MapElement } from '../types/mapElement'
import { getMapElementColor } from '../types/mapElement'
import type { Unit, PlacedUnit, Force, DetectLog, AttackLog } from '../types/unitTypes';
import { getTotalPersonnel, getSymbolSize } from '../types/unitTypes';
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
		const layer = L.marker([unit.position.lat, unit.position.lon], {
			icon: createUnitIcon(unit),
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

	const setVisibility = (el: MapElement, visible: boolean) => {
		if (!mapInstance.current) return;
		if (!el.layer) return;
		const isOnMap = mapInstance.current.hasLayer(el.layer);
		if (visible && !isOnMap) {
			el.layer.addTo(mapInstance.current);
		} else if (!visible && isOnMap) {
			el.layer.remove();
		}
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
			
			if (!showLabelsRef.current) {
				layer.closeTooltip();
			}
			
			setMapElements((prev) => [...prev, { ...pendingRef.current as MapElement, layer }]);
		}

		setPendingElement(null);
		setPoints([]);
	};

	const createUnitIcon = (unit: PlacedUnit): L.DivIcon => {
		const totalPersonnel = getTotalPersonnel(unit, 'full_personnel');
		const symbolSize = getSymbolSize(totalPersonnel);
		const symbol = new ms.Symbol(unit.sidc, { size: symbolSize });
		const sSize = symbol.getSize();

		// 抑制率が0.5以上なら警告マークを表示するHTMLを作成
		const isSuppressed = unit.suppressionRate >= 0.5;
		const html = `
			<div style="position: relative; width: ${sSize.width}px; height: ${sSize.height}px;">
				${symbol.asSVG()}
				${isSuppressed ? `
					<div style="
						position: absolute; 
						top: -10px; 
						right: -10px; 
						background: yellow; 
						color: black; 
						border-radius: 50%; 
						width: 20px; 
						height: 20px; 
						display: flex; 
						align-items: center; 
						justify-content: center; 
						font-weight: bold; 
						font-size: 12px;
					">!</div>
				` : ''}
			</div>
		`;

		return L.divIcon({
			className: 'milsymbol-icon',
			html: html,
			iconSize: [sSize.width, sSize.height],
			iconAnchor: [sSize.width / 2, sSize.height / 2]
		});
	};

	useEffect(() => {
		// placedUnitsが更新されるたびに、該当するマーカーのアイコンを再設定する
		placedUnits.forEach((unit) => {
			const marker = unitLayerMap.current.get(unit.id);
			if (marker) {
				const currentIcon = marker.getIcon();
				const newIcon = createUnitIcon(unit);
				
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

		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const latLng = mapInstance.current.containerPointToLatLng([x, y]);
		
		const newPlacedUnit: PlacedUnit = {
			...unitData,
			current_personnel: unitData.full_personnel,
			current_equipments: unitData.full_equipments,
			position: { lat: latLng.lat, lon: latLng.lng },
			actions: [],
			detectedUnits: [],
			attackingUnits: [],
			suppressionRate: 0,
		};

		setPlacedUnits((prev) => [...prev, newPlacedUnit]);

		const layer = L.marker(latLng, {
			icon: createUnitIcon(newPlacedUnit),
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
	}, []);

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

		mapElements.forEach((el) => {
			if (!el.layer) return;
			
			const isVisible = displayForce === 'GOD' || el.force === displayForce || el.type !== 'coa';
			
			const isOnMap = map.hasLayer(el.layer);
			if (isVisible && !isOnMap) {
				el.layer.addTo(map);
			} else if (!isVisible && isOnMap) {
				el.layer.remove();
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
			// データ構造を判定して、単一のFeatureとして扱う
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

	useEffect(() => {
		mapElements.forEach((el) => {
			if (!el.layer) return;
			if (showLabels) {
				el.layer.openTooltip();
			} else {
				el.layer.closeTooltip();
			}
		});
	}, [showLabels, displayForce, mapElements]);

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
		setVisibility,
		handleDragOver,
		handleDrop,
		removeUnitFromMap,
		updateDetectionAttackPolygons,
	};
};

