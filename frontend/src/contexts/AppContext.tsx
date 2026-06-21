import { createContext, useContext, useState, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Unit, PlacedUnit } from '../types/unitTypes';
import type { MapElement } from '../types/mapElement';
import type { SimConfig, SimRecord } from '../types/simTypes';
import type L from 'leaflet';

type AppState = {
	units: Unit[];
	setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
	placedUnits: PlacedUnit[];
	setPlacedUnits: React.Dispatch<React.SetStateAction<PlacedUnit[]>>;
	mapElements: MapElement[];
	setMapElements: React.Dispatch<React.SetStateAction<MapElement[]>>;
	simConfig: SimConfig;
	setSimConfig: React.Dispatch<React.SetStateAction<SimConfig>>;
	simUuid: string | null;
	setSimUuid: React.Dispatch<React.SetStateAction<string | null>>;
	simRecord: SimRecord[];
	setSimRecord: React.Dispatch<React.SetStateAction<SimRecord[]>>;
	unitLayerMap: MutableRefObject<Map<string, L.Marker>>;
	actionLayerMap: MutableRefObject<Map<string, L.Polyline[]>>;
	detectionLayerMap: MutableRefObject<Map<string, L.Polygon[]>>;
};

const AppContext = createContext<AppState | undefined>(undefined);

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
	const [units, setUnits] = useState<Unit[]>([]);
	const [placedUnits, setPlacedUnits] = useState<PlacedUnit[]>([]);
	const [mapElements, setMapElements] = useState<MapElement[]>([]);

	const getInitialSimConfig = (): SimConfig => {
		const now = new Date();
		const end = new Date(now.getTime() + 72 * 60 * 60 * 1000);
		return {
			startDateTime: now,
			endDateTime: end,
			tickInterval: 60,
		};
	};
	const [simConfig, setSimConfig] = useState<SimConfig>(getInitialSimConfig);
	const [simUuid, setSimUuid] = useState<string | null>(null);
	const [simRecord, setSimRecord] = useState<SimRecord[]>([]);
	const unitLayerMap = useRef<Map<string, L.Marker>>(new Map());
	const actionLayerMap = useRef<Map<string, L.Polyline[]>>(new Map());
	const detectionLayerMap = useRef<Map<string, L.Polygon[]>>(new Map());

	return (
		<AppContext.Provider value={{ 
			units, setUnits, 
			placedUnits, setPlacedUnits, 
			mapElements, setMapElements,
			simConfig, setSimConfig,
			simUuid, setSimUuid,
			simRecord, setSimRecord,
			unitLayerMap, actionLayerMap, detectionLayerMap,
		 }}>
			{children}
		</AppContext.Provider>
	);
};

export const useAppStore = () => {
    const context = useContext(AppContext);
    if (!context) throw new Error('useAppStore must be used within AppProvider');
    return context;
};