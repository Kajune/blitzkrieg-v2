import ms from 'milsymbol';
import L from 'leaflet';
import type { PlacedUnit } from '../types/unitTypes';
import { getTotalPersonnel, getSymbolSize } from '../types/unitTypes';
import styles from '../App.module.css';

export const generateUnitIcon = (unit: PlacedUnit): L.DivIcon => {
	const totalPersonnel = getTotalPersonnel(unit, 'full_personnel');
	const symbolSize = getSymbolSize(totalPersonnel);
	const symbol = new ms.Symbol(unit.sidc, { size: symbolSize });
	const sSize = symbol.getSize();
	const isSuppressed = unit.suppressionRate >= 0.5;

	const html = `
		<div class="${styles.milsymbolIcon}" style="width: ${sSize.width}px; height: ${sSize.height}px;">
			${symbol.asSVG()}
			${isSuppressed ? `<div class="${styles.suppressionBadge}">!</div>` : ''}
		</div>
	`;

	return L.divIcon({
		className: 'milsymbol-icon',
		html: html,
		iconSize: [sSize.width, sSize.height],
		iconAnchor: [sSize.width / 2, sSize.height / 2]
	});
};