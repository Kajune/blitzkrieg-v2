import { useState } from 'react';
import type { Force, Unit } from '../types/unitTypes';
import { FORCES, FORCE_STYLES } from '../types/unitTypes';
import { UnitTree } from './UnitTree';
import { useAppStore } from '../contexts/AppContext';
import '../App.module.css';


export const UnitPlacement = ({ 
	isOpen, 
	onClose,
}: { 
	isOpen: boolean; 
	onClose: () => void;
}) => {
	const { units, placedUnits } = useAppStore();
	const [activeTab, setActiveTab] = useState<Force>(FORCES[0]);
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

	const currentUnits = units.filter(u => u.force === activeTab);

	return (
		<div className="offcanvas offcanvas-start show" style={{ width: '300px' }}>
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title">部隊配置</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>

			<div className="nav nav-tabs">
				{Object.entries(FORCE_STYLES).map(([force, style]) => (
					<button 
						key={force}
						className={`nav-link ${activeTab === force ? 'active' : 'text-secondary'} ${activeTab === force ? 'text-' + style.class : ''}`} 
						onClick={() => setActiveTab(force as Force)}
					>
						{force}
					</button>
				))}
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