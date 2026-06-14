import { useEffect, useRef } from 'react';
import ms from 'milsymbol';
import type { PlacedUnit } from '../config/unitTypes';
import { getTotalPersonnel, getTotalEquipments } from '../config/unitTypes';
import { EquipmentBadges } from './UnitTree';

interface Props {
	unit: PlacedUnit | null;
	onClose: () => void;
	onDelete: (unit: PlacedUnit) => void;
}

export const UnitDetailPane = ({ unit, onClose, onDelete }: Props) => {
	const symbolRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (unit && symbolRef.current) {
			const symbol = new ms.Symbol(unit.sidc, { size: 40 });
			symbolRef.current.innerHTML = '';
			symbolRef.current.appendChild(symbol.asDOM());
		}
	}, [unit]);

	if (!unit) return null;

	const totalEquipments = getTotalEquipments(unit);

	return (
		<div className="offcanvas offcanvas-end show" style={{ width: '300px', visibility: 'visible' }}>
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title">部隊詳細</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>

			<div className="offcanvas-body p-3">
				<div className="d-flex flex-column gap-3">
					<div className="d-flex justify-content-center" ref={symbolRef} />

					<div className="border-top pt-3">
						<div className="mb-2">
							<small className="text-secondary d-block">部隊名</small>
							<strong>{unit.name} ({unit.templateId})</strong>
						</div>
						<div className="mb-2">
							<small className="text-secondary d-block">部隊種</small>
							<span>{unit.type}</span>
						</div>
						
						<div className="mb-2">
							<small className="text-secondary d-block">人員数</small>
							<div className="d-flex justify-content-between">
								<span className="small">この部隊:</span>
								<strong>{unit.personnel} 名</strong>
							</div>
							<div className="d-flex justify-content-between">
								<span className="small">合計:</span>
								<strong>{getTotalPersonnel(unit)} 名</strong>
							</div>
						</div>

						<div className="mb-3">
							<small className="text-secondary d-block">装備品（この部隊）</small>
							<EquipmentBadges equipments={unit.equipments || {}} />
						</div>

						<div className="mb-3">
							<small className="text-secondary d-block">装備品（合計）</small>
							<EquipmentBadges equipments={totalEquipments} variant="primary" />
						</div>
					</div>

					<button className="btn btn-outline-danger mt-2" onClick={() => onDelete(unit)}>
						削除
					</button>
				</div>
			</div>
		</div>
	);
};