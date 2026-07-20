import { createContext, useContext, useState } from 'react';
import type { Unit, PlacedUnit, Force, DisplayForce } from '../types/unitTypes';
import type { MapElement } from '../types/mapElement';
import type { SimConfig, SimRecord } from '../types/simTypes';
import { FORCES } from '../types/unitTypes';

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
	simDatalink: Record<Force, string[]>;
	setSimDatalink: React.Dispatch<React.SetStateAction<Record<Force, string[]>>>;
	displayForce: DisplayForce;
	setDisplayForce: React.Dispatch<React.SetStateAction<DisplayForce>>;
	clientUuid: string | null;
	setClientUuid: React.Dispatch<React.SetStateAction<string | null>>;
	clientForce: Force | null;
	setClientForce: React.Dispatch<React.SetStateAction<Force | null>>;
	dirtyUnitIds: Set<string>;
	markUnitDirty: (unitId: string) => void;
	clearDirtyUnits: () => void;
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

	const initialDatalink = FORCES.reduce((acc, force) => {
		acc[force] = [];
		return acc;
	}, {} as Record<Force, string[]>);
	const [simDatalink, setSimDatalink] = useState<Record<Force, string[]>>(initialDatalink);

	const [displayForce, setDisplayForce] = useState<DisplayForce>('GOD');
	const [clientUuid, setClientUuid] = useState<string | null>(null);
	const [clientForce, setClientForce] = useState<Force | null>(null);
	const [dirtyUnitIds, setDirtyUnitIds] = useState<Set<string>>(new Set());

	const markUnitDirty = (unitId: string) => {
		setDirtyUnitIds((prev) => {
			const next = new Set(prev);
			next.add(unitId);
			return next;
		});
	};

	const clearDirtyUnits = () => {
		setDirtyUnitIds(new Set());
	};

	return (
		<AppContext.Provider value={{ 
			units, setUnits, 
			placedUnits, setPlacedUnits, 
			mapElements, setMapElements,
			simConfig, setSimConfig,
			simUuid, setSimUuid,
			simRecord, setSimRecord,
			simDatalink, setSimDatalink,
			displayForce, setDisplayForce,
			clientUuid, setClientUuid,
			clientForce, setClientForce,
			dirtyUnitIds, markUnitDirty, clearDirtyUnits,
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