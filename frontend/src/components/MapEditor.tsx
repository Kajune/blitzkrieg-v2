import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import type { Feature } from 'geojson';
import type { MapElement, GeometryType } from '../types/mapElement'
import type { Unit, PlacedUnit, Force } from '../types/unitTypes';
import { getMapElementColor } from '../types/mapElement';
import { useAppStore } from '../contexts/AppContext';
import { useMapStore } from '../contexts/MapContext';
import { ElementLayer } from './ElementLayer';
import { UnitMarker } from './UnitMarker';
import { ImageLayer } from './ImageLayer';
import { ActionLayer } from './ActionLayer';
import { DetectionLayer } from './DetectionLayer';
import '../App.module.css';

L.Marker.prototype.options.icon = L.icon({
	iconUrl: icon,
	shadowUrl: iconShadow,
	iconSize: [25, 41],
	iconAnchor: [12, 41],
});


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


export const useMapEditor = (
) => {
	const { 
		setMapElements, 
		placedUnits, setPlacedUnits,
		displayForce,
		simUuid,
	} = useAppStore();

	const {
		pendingElement, setPendingElement,
		setPoints,
		selectedUnitId, setSelectedUnitId,
	} = useMapStore();

	const removeUnitFromMap = (unitId: string) => {
		setPlacedUnits((prev) => prev.filter(u => u.id !== unitId));

		if (selectedUnitId === unitId) {
			setSelectedUnitId(null);
		}
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
				console.log(result.deployedUnits);
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

	const startDrawing = (el: MapElement) => {
		setPoints([]);
		setPendingElement(el);
	};

	const completeDrawing = (finalPoints: L.LatLng[]) => {
		if (!pendingElement) {
			return;
		}
		const newGeoJson = convertPointsToGeoJson(pendingElement.geometry, finalPoints);
		setMapElements((prev) => [
			...prev, 
			{ ...pendingElement!, geoJson: newGeoJson }
		]);
		setPoints([]);
		setPendingElement(null);
	};

	const placeUnit = (e: DragEvent, map: L.Map) => {
		const data = e.dataTransfer?.getData('application/json');
		if (!data) return;
		const unitData: Unit = JSON.parse(data);
		
		const isAlreadyPlaced = placedUnits.some((u) => u.id === unitData.id);
		if (isAlreadyPlaced) {
			console.warn("この部隊は既に配置済みです:", unitData.templateId);
			return;
		}

		if (!unitData) return;

		const isUnitControllable = displayForce === 'GOD' || unitData.force === displayForce;
		if (!isUnitControllable) return;

		const latLng = map.mouseEventToLatLng(e as MouseEvent);
		
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

	return {
		startDrawing,
		completeDrawing,
		placeUnit,
		removeUnitFromMap,
		deployChildren,
	};
};

export const ElementLayers = ({ showLabels }: { showLabels: boolean }) => {
	const { mapElements, displayForce } = useAppStore();

	return (
		<>
			{mapElements.map(el => {
				const isVisible = displayForce === 'GOD' || el.force === displayForce || el.type !== 'coa';
				
				if (!isVisible) return null;

				return (
					<ElementLayer 
						key={el.id} 
						element={el} 
						showLabels={showLabels} 
					/>
				);
			})}
		</>
	);
};

export const UnitMarkers = ({ isUnitPlacementOpen }: { isUnitPlacementOpen: boolean }) => {
	const { placedUnits, setPlacedUnits, displayForce, simDatalink } = useAppStore();
	const { setSelectedUnitId } = useMapStore();

	return (
		<>
			{placedUnits.map(unit => {
				const isVisible = (() => {
					if (displayForce === 'GOD') return true;
					const currentForce = displayForce as Force;
					return unit.force === currentForce || (simDatalink[currentForce]?.includes(unit.id) ?? false);
				})();

				if (!isVisible) return null;

				return (
					<UnitMarker
						key={unit.id}
						unit={unit}
						isDraggable={isUnitPlacementOpen}
						onDragEnd={(id, latlng) => {
							setPlacedUnits(prev => prev.map(u => u.id === id ? { ...u, position: { lat: latlng.lat, lon: latlng.lng } } : u));
						}}
						onClick={setSelectedUnitId}
					/>
				);
			})}
		</>
	);
};

const DrawingElement = ({ pendingElement, points, setPoints, completeDrawing }: any) => {
	const [mousePos, setMousePos] = useState<L.LatLng | null>(null);
	const pendingRef = useRef(pendingElement);
	const pointsRef = useRef(points);

	useEffect(() => {
		pendingRef.current = pendingElement;
		pointsRef.current = points;
	}, [pendingElement, points]);

	useMapEvents({
		mousemove(e) {
			if (pointsRef.current.length > 0) setMousePos(e.latlng);
		},
		click(e) {
			if (!pendingRef.current) return;
			if (pendingRef.current.geometry === 'point') {
				completeDrawing([e.latlng]);
			} else {
				setPoints((prev: any) => [...prev, e.latlng]);
			}
		},
		dblclick(e) {
			if (pendingRef.current) {
				completeDrawing([...pointsRef.current, e.latlng]);
			}
		},
	});

	if (pointsRef.current.length === 0 || !mousePos) return null;

	return (
		<Polyline 
			positions={[...pointsRef.current, mousePos]} 
			pathOptions={{ color: getMapElementColor(pendingRef.current), dashArray: '5, 5' }} 
		/>
	);
};

const MapDropHandler = ({ 
	placeUnit 
}: { 
	placeUnit: (e: DragEvent, map: L.Map) => void 
}) => {
	const map = useMap();

	useEffect(() => {
		const container = map.getContainer();

		const handleDragOver = (e: DragEvent) => {
			e.preventDefault();
			e.dataTransfer!.dropEffect = 'copy';
		};

		const handleDrop = (e: DragEvent) => {
			e.preventDefault();
			placeUnit(e, map);
		};

		container.addEventListener('dragover', handleDragOver);
		container.addEventListener('drop', handleDrop);

		return () => {
			container.removeEventListener('dragover', handleDragOver);
			container.removeEventListener('drop', handleDrop);
		};
	}, [map, placeUnit]);

	return null;
};

const ActionLayers = () => {
	const { placedUnits, setPlacedUnits, displayForce, simDatalink } = useAppStore();
	const { selectedUnitId } = useMapStore();
	const map = useMap();

	useMapEvents({
		contextmenu(e) {
			e.originalEvent.preventDefault();

			if (!selectedUnitId) return;

			const sourceUnit = placedUnits.find((u) => u.id === selectedUnitId);
			if (!sourceUnit) return;

			const isUnitControllable = displayForce === 'GOD' || sourceUnit.force === displayForce;
			if (!isUnitControllable) return;

			const clickPoint = e.containerPoint;
			const PIXEL_THRESHOLD = 20;
			
			const targetUnit = placedUnits.find((u) => {
				const unitPoint = map.latLngToContainerPoint([u.position.lat, u.position.lon]);
				const distance = clickPoint.distanceTo(unitPoint);
				const isVisible = displayForce === 'GOD' || 
								  u.force === displayForce || 
								  (simDatalink[displayForce as Force]?.includes(u.id) ?? false);
				
				return u.id !== selectedUnitId && distance < PIXEL_THRESHOLD && isVisible;
			});

			const targetUnitId = targetUnit?.id ?? null;

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
					if (u.id !== selectedUnitId) return u;
					const nextActions = isShiftPressed ? [...u.actions, newAction] : [newAction];
					return { ...u, actions: nextActions };
				})
			);
		}
	});

	return (
		<>
			{placedUnits.map(unit => {
				const isVisible = (() => {
					if (displayForce === 'GOD') return true;
					const currentForce = displayForce as Force;
					return unit.force === currentForce;
				})();

				if (!isVisible) return null;

				return (
					<ActionLayer
						key={`action-${unit.id}`}
						unit={unit}
						placedUnits={placedUnits}
					/>
				);
			})}
		</>
	);
};

const DetectionLayers = () => {
	const { placedUnits } = useAppStore();

	return (
		<>
			{placedUnits.map(unit => {
				return (
					<DetectionLayer
						key={`detection-${unit.id}`}
						unit={unit}
						placedUnits={placedUnits}
					/>
				);
			})}
		</>
	);
};

const MapController = ({ 
	shouldFocus, 
	setShouldFocus, 
	mapElements, 
	placedUnits 
}: {
	shouldFocus: boolean,
	setShouldFocus: React.Dispatch<React.SetStateAction<boolean>>,
	mapElements: MapElement[],
	placedUnits: PlacedUnit[],
}) => {
	const map = useMap();

	useEffect(() => {
		if (shouldFocus) {
			const timer = setTimeout(() => {
				const layers: L.Layer[] = [];
				map.eachLayer((layer: L.Layer) => {
					if (layer instanceof L.Marker || layer instanceof L.Path) {
						layers.push(layer);
					}
				});

				if (layers.length > 0) {
					const bounds = L.latLngBounds(layers.map(l => 
						'getBounds' in l ? (l as any).getBounds() : (l as any).getLatLng()
					));
					map.fitBounds(bounds, { padding: [20, 20] });
				}
				setShouldFocus(false);
			}, 0);

			return () => clearTimeout(timer);
		}
	}, [shouldFocus, mapElements, placedUnits, map, setShouldFocus]);

	return null;
};

interface MapEditorProps {
	isUnitPlacementOpen: boolean;
}

export const MapEditor = ({
	isUnitPlacementOpen,
}: MapEditorProps) => {
	const {
		mapElements, placedUnits
	} = useAppStore();
	const {
		points, setPoints, 
		shouldFocusAfterLoad, setShouldFocusAfterLoad,
		pendingElement, 
		mobilityMap,
	} = useMapStore();
	const {
		completeDrawing,
		placeUnit,
	} = useMapEditor();

	const [showLabels, setShowLabels] = useState(true);
	const [showDetectionPolygons, setShowDetectionPolygons] = useState(true);
	const [showMobilityMap, setShowMobilityMap] = useState(false);

	return (
		<div
			style={{ width: '100%', height: '100%', position: 'relative' }}
			onDragOver={(e) => e.preventDefault()}
		>
			<MapContainer 
				style={{ width: '100%', height: '100%', zIndex: 1 }} 
				center={[35.6812, 139.7671]} 
				zoom={13} 
				doubleClickZoom={false}
			>
				<TileLayer url="https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png" />
				<MapDropHandler placeUnit={placeUnit} />
				<MapController 
					shouldFocus={shouldFocusAfterLoad} 
					setShouldFocus={setShouldFocusAfterLoad}
					mapElements={mapElements}
					placedUnits={placedUnits}
				/>
				{showMobilityMap && (
					<ImageLayer data={mobilityMap} />
				)}
				<ElementLayers showLabels={showLabels} />
				<DrawingElement 
					pendingElement={pendingElement} 
					points={points} 
					setPoints={setPoints} 
					completeDrawing={completeDrawing} 
				/>
				{showDetectionPolygons && (
					<DetectionLayers />
				)}
				<ActionLayers />
				<UnitMarkers
					isUnitPlacementOpen={isUnitPlacementOpen}
				/>

				<button 
					className="btn btn-secondary btn-sm position-absolute"
					style={{ 
						bottom: 80, 
						left: 10, 
						zIndex: 1000,
						borderRadius: '20px',
						padding: '5px 10px',
						fontSize: '0.8rem'
					}}
					onClick={() => setShowLabels(!showLabels)}
				>
					{showLabels ? 'ラベル非表示' : 'ラベル表示'}
				</button>

				<button 
					className="btn btn-secondary btn-sm position-absolute"
					style={{ 
						bottom: 80, 
						left: 120, 
						zIndex: 1000,
						borderRadius: '20px',
						padding: '5px 10px',
						fontSize: '0.8rem'
					}}
					onClick={() => setShowDetectionPolygons(!showDetectionPolygons)}
				>
					{showDetectionPolygons ? '探知非表示' : '探知表示'}
				</button>

				<button 
					className="btn btn-secondary btn-sm position-absolute"
					style={{ 
						bottom: 80, 
						left: 220, 
						zIndex: 1000,
						borderRadius: '20px',
						padding: '5px 10px',
						fontSize: '0.8rem'
					}}
					onClick={() => setShowMobilityMap(!showMobilityMap)}
				>
					{showMobilityMap ? '機動障害図非表示' : '機動障害図表示'}
				</button>
			</MapContainer>
		</div>
	);
};