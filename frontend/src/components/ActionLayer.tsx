import { useMemo } from 'react';
import { Polyline } from 'react-leaflet';
import type { PlacedUnit } from '../types/unitTypes';

export const ActionLayer = ({ unit, placedUnits }: { 
	unit: PlacedUnit, 
	placedUnits: PlacedUnit[]
}) => {
	const actionLines = useMemo(() => {
		const activeActions = unit.actions.filter(a => !a.finished);
		if (activeActions.length === 0) return [];

		const lines: { positions: [number, number][]; color: string; dashArray: string }[] = [];
		let currentPos: { lat: number; lon: number } = unit.position;

		activeActions.forEach((action, index) => {
			let targetPos: { lat: number; lon: number } | null = null;
			
			if (action.targetPosition) {
				targetPos = action.targetPosition;
			} else if (action.targetUnitId) {
				const targetUnit = placedUnits.find(u => u.id === action.targetUnitId);
				if (targetUnit) {
					targetPos = targetUnit.position;
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

				lines.push({
					positions: [[currentPos.lat, currentPos.lon], [targetPos.lat, targetPos.lon]],
					color: isApproach ? (isEnemy ? 'red' : 'green') : 'yellow',
					dashArray: isFirstAction ? '' : '5, 10'
				});
				
				currentPos = targetPos;
			}
		});

		return lines;
	}, [unit, placedUnits]);

	return (
		<>
			{actionLines.map((line, i) => (
				<Polyline
					key={i}
					positions={line.positions}
					pathOptions={{
						color: line.color,
						weight: 2,
						dashArray: line.dashArray
					}}
					interactive={false}
				/>
			))}
		</>
	);
};