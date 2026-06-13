import type { Unit } from '../config/unitTypes';
import ms from 'milsymbol';

export type UnitColumn = 'type' | 'personnel' | 'equipments';

interface UnitTreeProps {
	unit: Unit;
	depth?: number;
	isLasts?: boolean[];
	onSelect?: (id: string) => void;
	selectedId?: string | null;
	visibleColumns?: UnitColumn[];
	expandedIds: Set<string>;
	onToggle: (id: string) => void;
	onDragStart?: (e: React.DragEvent, unit: Unit) => void;
	placedIds?: string[];
}

export const UnitTree = ({ 
	unit, 
	depth = 0, 
	isLasts = [], 
	onSelect = undefined, 
	selectedId = null, 
	expandedIds, 
	onToggle,
	onDragStart = undefined,
	visibleColumns = [],
	placedIds = [],
}: UnitTreeProps) => {
	const isExpanded = expandedIds.has(unit.id);
	const isLast = isLasts.length > 0 ? isLasts[isLasts.length - 1] : false;
	const indentWidth = 40;
	const hasChildren = unit.children.length > 0;
	const isSelected = selectedId === unit.id;
	const isAlreadyPlaced = placedIds.includes(unit.id);

	return (
		<>
			<tr 
				onClick={(e) => { if (!onSelect) return; e.stopPropagation(); onSelect(unit.id); }}
				style={{
					fontSize: '0.8rem', 
					height: '40px',
					backgroundColor: isSelected ? 'rgba(255,255,255,0.1)' : 'transparent',
					borderLeft: isSelected ? '4px solid #0d6efd' : '4px solid transparent',
					opacity: isAlreadyPlaced ? 0.1 : 1,
					cursor: isAlreadyPlaced ? 'not-allowed' : 'pointer'
				}}
				draggable={!isAlreadyPlaced}
				onDragStart={(e) => !isAlreadyPlaced && onDragStart?.(e, unit)}
			>
				<td style={{ width: '40%', paddingLeft: `${depth * indentWidth + 10}px`, verticalAlign: 'middle', position: 'relative' }}>
					{isLasts.slice(0, -1).map((pLast, i) => (!pLast && <div key={i} style={{ position: 'absolute', left: `${i * indentWidth + 15}px`, top: 0, width: '1px', height: '100%', backgroundColor: '#444' }} />))}
					{depth > 0 && (
						<>
							<div style={{ position: 'absolute', left: `${(depth - 1) * indentWidth + 15}px`, top: 0, width: '1px', height: isLast ? '20px' : '100%', backgroundColor: '#444' }} />
							<div style={{ position: 'absolute', left: `${(depth - 1) * indentWidth + 15}px`, top: '20px', width: `${indentWidth - 10}px`, height: '1px', backgroundColor: '#444' }} />
						</>
					)}
					{hasChildren && (
						<span onClick={(e) => { e.stopPropagation(); onToggle(unit.id); }} style={{ 
							position: 'absolute', left: `${(depth === 0 ? 0 : depth - 1) * indentWidth + (depth === 0 ? 5 : 10)}px`, top: '12px', 
							width: '10px', height: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
							backgroundColor: '#333', border: '1px solid #666', fontSize: '10px', color: '#fff', zIndex: 1, cursor: 'pointer' 
						}}>
							{isExpanded ? '-' : '+'}
						</span>
					)}
					<img src={new ms.Symbol(unit.sidc, { size: 18 }).asCanvas().toDataURL()} className="me-2" alt="icon" style={{ verticalAlign: 'middle' }} />
					{unit.templateId}
				</td>

				{visibleColumns.includes('type') && <td style={{ width: '10%', verticalAlign: 'middle' }}>{unit.type}</td>}
				{visibleColumns.includes('personnel') && <td style={{ width: '10%', verticalAlign: 'middle' }}>{unit.personnel}</td>}
				{visibleColumns.includes('equipments') && (
					<td style={{ width: '40%', verticalAlign: 'middle', overflow: 'hidden' }}>
						<div style={{ display: 'flex', flexWrap: 'wrap' }}>
							{Object.entries(unit.equipments).map(([k, v]) => <span key={k} className="badge bg-secondary me-1" style={{ fontSize: '0.7rem' }}>{k}:{v}</span>)}
						</div>
					</td>
				)}
			</tr>
			
			{isExpanded && unit.children.map((child, idx) => (
				<UnitTree 
					key={child.id}
					unit={child}
					depth={depth + 1} 
					isLasts={[...isLasts, idx === unit.children.length - 1]} 
					onSelect={onSelect}
					selectedId={selectedId}
					expandedIds={expandedIds}
					onToggle={onToggle}
					onDragStart={onDragStart}
					visibleColumns={visibleColumns}
					placedIds={placedIds}
				/>
			))}
		</>
	);
};