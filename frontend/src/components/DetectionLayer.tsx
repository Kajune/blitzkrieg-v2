import { useMemo } from 'react';
import { Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useAppStore } from '../contexts/AppContext';
import type { PlacedUnit } from '../types/unitTypes';

export const DetectionLayer = ({ unit, placedUnits }: { 
	unit: PlacedUnit, 
	placedUnits: PlacedUnit[] 
}) => {
	const map = useMap();
	const { displayForce } = useAppStore();

	const polygons = useMemo(() => {
		const attackingTargetIds = new Set(unit.attackingUnits.map(a => a.unitId));
		const sourcePoint = map.latLngToContainerPoint([unit.position.lat, unit.position.lon]);

		return unit.detectedUnits
			.map((log) => {
				const isGod = displayForce === 'GOD';
				const isSameForce = displayForce === unit.force;
				const isAttacking = attackingTargetIds.has(log.unitId);

				if (!(isGod || isSameForce || isAttacking)) {
					return null;
				}

				const targetUnit = placedUnits.find(u => u.id === log.unitId);
				if (!targetUnit) return null;

				const targetPoint = map.latLngToContainerPoint([targetUnit.position.lat, targetUnit.position.lon]);
				
				const dx = targetPoint.x - sourcePoint.x;
				const dy = targetPoint.y - sourcePoint.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (dist === 0) return null;

				const ux = dx / dist;
				const uy = dy / dist;
				const nx = -uy;
				const ny = ux;
				const symbolWidth = 20; 

				const p1 = L.point(targetPoint.x + nx * symbolWidth, targetPoint.y + ny * symbolWidth);
				const p2 = L.point(targetPoint.x - nx * symbolWidth, targetPoint.y - ny * symbolWidth);

				return {
					positions: [
						[unit.position.lat, unit.position.lon],
						[map.containerPointToLatLng(p1).lat, map.containerPointToLatLng(p1).lng],
						[map.containerPointToLatLng(p2).lat, map.containerPointToLatLng(p2).lng]
					] as [number, number][], 
					color: isAttacking ? 'red' : 'yellow',
					opacity: Math.min(0.5, log.awareness * 0.5)
				};
			})
			.filter((p): p is NonNullable<typeof p> => p !== null);
	}, [unit, placedUnits, map, displayForce]);

	return (
		<>
			{polygons.map((poly, i) => (
				<Polygon
					key={i}
					positions={poly.positions}
					pathOptions={{
						color: poly.color,
						fillColor: poly.color,
						fillOpacity: poly.opacity,
						weight: 0
					}}
					interactive={false}
				/>
			))}
		</>
	);
};