import { useEffect, useRef } from 'react';
import ms from 'milsymbol';
import type { PlacedUnit, MoveSpeed, MoveMode, FireMode } from '../types/unitTypes';
import { getTotalPersonnel, getTotalEquipments, MOVE_SPEEDS, MOVE_MODES, FIRE_MODES } from '../types/unitTypes';
import { useAppStore } from '../contexts/AppContext';

interface Props {
	unitId: string | null;
	onClose: () => void;
	onDelete: (unit: PlacedUnit) => void;
}

export const UnitDetailPane = ({ unitId, onClose, onDelete }: Props) => {
	const symbolRef = useRef<HTMLDivElement>(null);
	const tableStyle = { fontSize: '0.65rem', fontFamily: 'monospace' };
	const textStyle = { fontSize: '0.65rem' };
	const { placedUnits, setPlacedUnits } = useAppStore();

	const unit = placedUnits.find(u => u.id === unitId);

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

	const handleActionChange = (index: number, field: string, value: any) => {
		const newActions = [...unit.actions];
		newActions[index] = { ...newActions[index], [field]: value };
		const updatedUnit = { ...unit, actions: newActions };
		setPlacedUnits(placedUnits.map(u => u.id === unit.id ? updatedUnit : u));
	};

	const deleteAction = (index: number) => {
		const newActions = unit.actions.filter((_, i) => i !== index);
		const updatedUnit = { ...unit, actions: newActions };
		setPlacedUnits(placedUnits.map(u => u.id === unit.id ? updatedUnit : u));
	};

	return (
		<div className="offcanvas offcanvas-end show bg-dark text-white" style={{ width: '400px', visibility: 'visible' }}>
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title text-uppercase">部隊詳細</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>

			<div className="offcanvas-body p-3">
				<div className="d-flex flex-column gap-3">
					<div className="pt-2">
						<div className="d-flex align-items-center gap-3 mb-3">
							<div className="d-flex justify-content-center align-items-center p-2 bg-white rounded align-self-start" 
								ref={symbolRef} 
								style={{ width: '60px', height: '60px' }} 
							/>
							<div>
								<div className="d-flex align-items-baseline gap-2">
									<strong className="fs-6">{unit.name} [{unit.templateId}]</strong>
									<span className="text-info" style={{ fontSize: '0.8rem' }}>{unit.type}</span>
								</div>
								<div className="text-muted mt-1" style={{ fontSize: '0.7rem' }}>
									LOC: {unit.position.lat.toFixed(4)}, {unit.position.lon.toFixed(4)}<br/>
									MoveMode: {unit.currentMoveMode}, MoveSpeed: {unit.currentMoveSpeed}, FireMode: {unit.currentFireMode}
								</div>
							</div>
						</div>

						{/* 隷下部隊 */}
						<div className="mb-3">
							<div className="d-flex align-items-center mb-2">
								<div className="bg-info" style={{ width: '3px', height: '0.8rem', marginRight: '6px' }}></div>
								<small className="text-uppercase fw-bold">隷下部隊</small>
							</div>
							<div className="d-flex flex-wrap gap-1">
								{unit.lower_units.length > 0 ? (
									unit.lower_units.map((child) => (
										<span key={child.id} className="badge bg-secondary border border-secondary text-light" style={textStyle}>
											{child.name} [{child.templateId}]
										</span>
									))
								) : (
									<small className="text-muted fst-italic">隷下部隊なし</small>
								)}
							</div>
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
											
											const selfRatio = fSelf > 0 ? (cSelf / fSelf) : 1;
											const selfColor = selfRatio < 0.5 ? 'text-danger' : selfRatio < 0.75 ? 'text-warning' : 'text-success';
											const totRatio = fTot > 0 ? (cTot / fTot) : 1;
											const totColor = totRatio < 0.5 ? 'text-danger' : totRatio < 0.75 ? 'text-warning' : 'text-success';

											return (
												<tr key={key}>
													<td className="ps-2">{isP ? '人員' : key}</td>
													<td className={`text-center ${selfColor}`}>{cSelf}/{fSelf}</td>
													<td className={`text-center ${totColor}`}>{cTot}/{fTot}</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						</div>

						<div className="mt-4">
							<div className="d-flex align-items-center mb-2">
								<div className="bg-warning" style={{ width: '3px', height: '0.8rem', marginRight: '6px' }}></div>
								<small className="text-uppercase fw-bold">命令リスト</small>
							</div>

							<div className="table-responsive border border-secondary rounded">
								<table className="table table-sm table-dark table-hover mb-0" style={tableStyle}>
									<thead>
										<tr className="text-muted border-secondary">
											<th className="ps-2">速度</th>
											<th>要領</th>
											<th>射撃</th>
											<th>目標</th>
											<th className="text-center">削除</th>
										</tr>
									</thead>
									<tbody>
										{unit.actions
											.filter((action) => !action.finished)
											.map((action, idx) => (
											<tr key={idx} className="align-middle">
												<td className="ps-1">
													<select className="form-select form-select-sm bg-dark text-white border-0 p-0" 
														style={textStyle}
														value={action.moveSpeed} 
														onChange={(e) => handleActionChange(idx, 'moveSpeed', e.target.value as MoveSpeed)}>
														{MOVE_SPEEDS.map(s => <option key={s} value={s}>{s}</option>)}
													</select>
												</td>
												<td>
													<select className="form-select form-select-sm bg-dark text-white border-0 p-0" 
														style={textStyle}
														value={action.moveMode} 
														onChange={(e) => handleActionChange(idx, 'moveMode', e.target.value as MoveMode)}>
														{MOVE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
													</select>
												</td>
												<td>
													<select className="form-select form-select-sm bg-dark text-white border-0 p-0" 
														style={textStyle}
														value={action.fireMode} 
														onChange={(e) => handleActionChange(idx, 'fireMode', e.target.value as FireMode)}>
														{FIRE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
													</select>
												</td>
												<td className="text-muted">
													{action.targetUnitId ? (
														<span className="fw-bold">
															{placedUnits.find(u => u.id === action.targetUnitId)?.name || '不明'}
														</span>
													) : action.targetPosition ? (
														`${action.targetPosition.lat.toFixed(2)}/${action.targetPosition.lon.toFixed(2)}`
													) : (
														'-'
													)}
												</td>
												<td className="text-center">
													<button className="btn btn-link btn-sm text-danger p-0" 
														style={textStyle}
														onClick={() => deleteAction(idx)}>✕</button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
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