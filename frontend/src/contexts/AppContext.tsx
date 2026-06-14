import { createContext, useContext, useState } from 'react';
import type { Unit, PlacedUnit } from '../config/unitTypes';
import type { MapElement } from '../config/mapElement';
import type { SimConfig } from '../config/simTypes';

type AppState = {
	units: Unit[];
	setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
	placedUnits: Unit[];
	setPlacedUnits: React.Dispatch<React.SetStateAction<PlacedUnit[]>>;
	mapElements: MapElement[];
	setMapElements: React.Dispatch<React.SetStateAction<MapElement[]>>;
	simConfig: SimConfig;
	setSimConfig: React.Dispatch<React.SetStateAction<SimConfig>>;
	simUuid: string | null;
	setSimUuid: React.Dispatch<React.SetStateAction<string | null>>;
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
		};
	};
	const [simConfig, setSimConfig] = useState<SimConfig>(getInitialSimConfig);
	const [simUuid, setSimUuid] = useState<string | null>(null);

	return (
		<AppContext.Provider value={{ 
			units, setUnits, 
			placedUnits, setPlacedUnits, 
			mapElements, setMapElements,
			simConfig, setSimConfig,
			simUuid, setSimUuid,
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