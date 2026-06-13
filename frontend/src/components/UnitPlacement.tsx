import { useState } from 'react';
import type { Unit, PlacedUnit } from '../config/unitTypes';
import { UnitTree } from './UnitTree';

import '../App.module.css';


export const UnitPlacement = ({ 
	isOpen, 
	onClose,
	redUnits,
	blueUnits,
	placedUnits,
}: { 
	isOpen: boolean; 
	onClose: () => void;
	redUnits: Unit[];
	blueUnits: Unit[];
	placedUnits: PlacedUnit[];
}) => {
	const [activeTab, setActiveTab] = useState<'red' | 'blue'>('red');
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

	const handleDragStart = (e: React.DragEvent, unit: Unit) => {
		e.dataTransfer.setData('application/json', JSON.stringify(unit));
		e.stopPropagation();
	};

	const toggleExpand = (id: string) => {
		const next = new Set(expandedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setExpandedIds(next);
	};

	if (!isOpen) return null;

	const currentUnits = activeTab === 'red' ? redUnits : blueUnits;

	return (
		<div className="offcanvas offcanvas-start show" style={{ width: '300px' }}>
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title">部隊配置</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>

			<div className="nav nav-tabs">
				<button 
					className={`nav-link ${activeTab === 'red' ? 'active text-danger' : 'text-secondary'}`} 
					onClick={() => setActiveTab('red')}
				>
					REDFOR
				</button>
				<button 
					className={`nav-link ${activeTab === 'blue' ? 'active text-primary' : 'text-secondary'}`} 
					onClick={() => setActiveTab('blue')}
				>
					BLUFOR
				</button>
			</div>

			<div className="offcanvas-body p-2" style={{ fontSize: '0.85rem' }}>
				<table className="table table-dark table-sm">
					<tbody>
						{currentUnits && currentUnits.map(unit => (
							<UnitTree 
								key={unit.id} 
								unit={unit} 
								onDragStart={handleDragStart} 
								expandedIds={expandedIds}
								onToggle={(id) => toggleExpand(id)}
								placedIds={placedUnits.map((unit) => unit.id)}
							/>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
};