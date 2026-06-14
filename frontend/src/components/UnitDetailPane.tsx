import { useEffect, useRef } from 'react';
import ms from 'milsymbol';
import type { PlacedUnit } from '../config/unitTypes';
import { getTotalPersonnel, getTotalEquipments } from '../config/unitTypes';

interface Props {
	unit: PlacedUnit | null;
	onClose: () => void;
	onDelete: (unit: PlacedUnit) => void;
}

export const UnitDetailPane = ({ unit, onClose, onDelete }: Props) => {
	const symbolRef = useRef<HTMLDivElement>(null);
	const tableStyle = { fontSize: '0.75rem', fontFamily: 'monospace' };

	useEffect(() => {
		if (unit && symbolRef.current) {
			const symbol = new ms.Symbol(unit.sidc, { size: 40 });
			symbolRef.current.innerHTML = '';
			symbolRef.current.appendChild(symbol.asDOM());
		}
	}, [unit]);

	if (!unit) return null;

	const fullTotalPersonnel = getTotalPersonnel(unit, 'full_personnel');
	const currentTotalPersonnel = getTotalPersonnel(unit, 'current_personnel');
	const fullTotalEquipments = getTotalEquipments(unit, 'full_equipments');
	const currentTotalEquipments = getTotalEquipments(unit, 'current_equipments');

	const resourceKeys = Array.from(new Set([
		'Personnel',
		...Object.keys(unit.full_equipments),
		...Object.keys(fullTotalEquipments)
	]));

	return (
		<div className="offcanvas offcanvas-end show bg-dark text-white" style={{ width: '300px', visibility: 'visible' }}>
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title text-uppercase">部隊詳細</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>

			<div className="offcanvas-body p-3">
				<div className="d-flex flex-column gap-3">
					<div className="d-flex justify-content-center p-2 bg-white rounded" ref={symbolRef} />

					<div className="pt-2">
						<div className="mb-3">
							<strong className="fs-6">{unit.name}</strong>
							<span className="text-muted ms-2">[{unit.templateId}]</span>
							<div className="text-info">{unit.type}</div>
						</div>

						{/* 隷下部隊 */}
						<div className="mb-3">
							<div className="d-flex align-items-center mb-1">
								<div className="bg-info" style={{ width: '3px', height: '0.8rem', marginRight: '6px' }}></div>
								<small className="text-uppercase fw-bold">隷下部隊</small>
							</div>
							{unit.lower_units.length > 0 ? (
								<div className="table-responsive border border-secondary rounded">
									<table className="table table-sm table-dark table-hover mb-0" style={tableStyle}>
										<tbody>
											{unit.lower_units.map((child) => (
												<tr key={child.id}>
													<td className="ps-2">{child.name}</td>
													<td className="text-muted text-end pe-2">{child.templateId}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<small className="text-muted fst-italic">隷下部隊なし</small>
							)}
						</div>
						
						{/* 統計 */}
						<div className="mt-3">
							<div className="d-flex align-items-center mb-1">
								<div className="bg-primary" style={{ width: '3px', height: '0.8rem', marginRight: '6px' }}></div>
								<small className="text-uppercase fw-bold">人員・装備品現況</small>
							</div>
							<div className="table-responsive border border-secondary rounded">
								<table className="table table-sm table-dark table-hover mb-0 align-middle" style={tableStyle}>
									<thead className="border-bottom border-secondary">
										<tr className="text-muted">
											<th className="ps-2">Item</th>
											<th className="text-center">Single</th>
											<th className="text-center">Total</th>
										</tr>
									</thead>
									<tbody>
										{resourceKeys.map((key) => {
											const isP = key === 'Personnel';
											const cSelf = isP ? unit.current_personnel : (unit.current_equipments[key] || 0);
											const fSelf = isP ? unit.full_personnel : (unit.full_equipments[key] || 0);
											const cTot = isP ? currentTotalPersonnel : (currentTotalEquipments[key] || 0);
											const fTot = isP ? fullTotalPersonnel : (fullTotalEquipments[key] || 0);
											
											const ratio = fSelf > 0 ? (cSelf / fSelf) : 1;
											const color = ratio < 0.5 ? 'text-danger' : ratio < 1 ? 'text-warning' : 'text-success';

											return (
												<tr key={key}>
													<td className="ps-2">{isP ? '人員' : key}</td>
													<td className={`text-center ${color}`}>{cSelf}/{fSelf}</td>
													<td className="text-center text-white">{cTot}/{fTot}</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						</div>

						<div className="mt-3 text-muted" style={{ fontSize: '0.7rem' }}>
							LAT: {unit.position.lat.toFixed(4)} / LON: {unit.position.lon.toFixed(4)}
						</div>
					</div>

					<button className="btn btn-sm btn-outline-danger w-100 mt-2" onClick={() => onDelete(unit)}>
						部隊を削除
					</button>
				</div>
			</div>
		</div>
	);
};