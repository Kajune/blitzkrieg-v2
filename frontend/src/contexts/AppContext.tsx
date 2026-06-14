import { createContext, useContext, useState } from 'react';
import type { Unit, PlacedUnit } from '../config/unitTypes';
import type { MapElement } from '../config/mapElement';

type AppState = {
	units: Unit[];
	setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
	placedUnits: Unit[];
	setPlacedUnits: React.Dispatch<React.SetStateAction<PlacedUnit[]>>;
	mapElements: MapElement[];
	setMapElements: React.Dispatch<React.SetStateAction<MapElement[]>>;
	// 将来的にここへ simSettings: ... などを追加
};

const AppContext = createContext<AppState | undefined>(undefined);

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
	const [units, setUnits] = useState<Unit[]>([]);
	const [placedUnits, setPlacedUnits] = useState<PlacedUnit[]>([]);
	const [mapElements, setMapElements] = useState<MapElement[]>([]);

	return (
		<AppContext.Provider value={{ units, setUnits, placedUnits, setPlacedUnits, mapElements, setMapElements }}>
			{children}
		</AppContext.Provider>
	);
};

export const useAppStore = () => {
    const context = useContext(AppContext);
    if (!context) throw new Error('useAppStore must be used within AppProvider');
    return context;
};