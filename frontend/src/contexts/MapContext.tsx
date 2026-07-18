import { createContext, useContext, useState, useRef } from 'react';
import type { FeatureCollection } from 'geojson';
import type { MapElement } from '../types/mapElement';

type MapState = {
	pendingElement: MapElement | null;
	setPendingElement: React.Dispatch<React.SetStateAction<MapElement | null>>;
	points: L.LatLng[];
	setPoints: React.Dispatch<React.SetStateAction<L.LatLng[]>>;
	selectedUnitId: string | null;
	setSelectedUnitId: React.Dispatch<React.SetStateAction<string | null>>;
	shouldFocusAfterLoad: boolean;
	setShouldFocusAfterLoad: React.Dispatch<React.SetStateAction<boolean>>;
	mobilityMap: FeatureCollection | null;
	setMobilityMap: React.Dispatch<React.SetStateAction<FeatureCollection | null>>;
	unitLayerMap: React.MutableRefObject<Map<string, L.Marker>>;
	actionLayerMap: React.MutableRefObject<Map<string, L.Polyline[]>>;
	detectionLayerMap: React.MutableRefObject<Map<string, L.Polygon[]>>;
};

const MapContext = createContext<MapState | undefined>(undefined);

export const MapProvider = ({ children }: { children: React.ReactNode }) => {
	const [pendingElement, setPendingElement] = useState<MapElement | null>(null);
	const [points, setPoints] = useState<L.LatLng[]>([]);
	const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
	const [shouldFocusAfterLoad, setShouldFocusAfterLoad] = useState(false);
	const [mobilityMap, setMobilityMap] = useState<FeatureCollection | null>(null);
	
	const unitLayerMap = useRef<Map<string, L.Marker>>(new Map());
	const actionLayerMap = useRef<Map<string, L.Polyline[]>>(new Map());
	const detectionLayerMap = useRef<Map<string, L.Polygon[]>>(new Map());

	return (
		<MapContext.Provider value={{ 
			pendingElement, setPendingElement,
			points, setPoints,
			selectedUnitId, setSelectedUnitId,
			shouldFocusAfterLoad, setShouldFocusAfterLoad,
			mobilityMap, setMobilityMap,
			unitLayerMap, actionLayerMap, detectionLayerMap,
		}}>
			{children}
		</MapContext.Provider>
	);
};

export const useMapStore = () => {
	const context = useContext(MapContext);
	if (!context) throw new Error('useMapStore must be used within MapProvider');
	return context;
};