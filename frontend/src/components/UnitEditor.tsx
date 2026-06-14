import React, { useState } from 'react';
import { UNIT_TEMPLATES, FORCE_STYLES, FORCES } from '../config/unitTypes';
import type { Unit, Force } from '../config/unitTypes';
import { getAllUnitIds } from '../config/unitTypes';
import { UnitTree } from './UnitTree';
import { useAppStore } from '../contexts/AppContext';

const createUnitStructure = (templateId: string, force: Force): Unit => {
	const template = UNIT_TEMPLATES.find(t => t.id === templateId);
	if (!template) {
		return { 
			id: '', 
			templateId: '不明', 
			name: '不明', 
			force: FORCES[0], 
			sidc: '', 
			type: '不明', 
			full_personnel: 0, 
			current_personnel: 0,
			full_equipments: {}, 
			current_equipments: {},
			lower_units: []
		};
	}

	return {
		id: Date.now().toString() + Math.random(),
		templateId: template.id,
		name: template.name,
		force: force,
		sidc: template.sidc[force],
		type: template.type,
		full_personnel: template.personnel,
		current_personnel: template.personnel,
		full_equipments: template.equipments,
		current_equipments: template.equipments,
		lower_units: Object.entries(template.lower_units).flatMap(([childId, count]) => 
			Array.from({ length: count as number }).map(() => createUnitStructure(childId, force))
		)
	};
};

const UnitTable = ({ 
	units, 
	setUnits, 
	force, 
	onUnitDeleted,
	visibleColumns = ['type', 'personnel', 'equipments'] // デフォルト値を指定
}: { 
	units: Unit[], 
	setUnits: React.Dispatch<React.SetStateAction<Unit[]>>, 
	force: Force,
	onUnitDeleted: (unitId: string) => void,
	visibleColumns?: ('type' | 'personnel' | 'equipments')[] // 型定義を追加
}) => {
	const [searchText, setSearchText] = useState('');
	const [selectedTemplateId, setSelectedTemplateId] = useState(UNIT_TEMPLATES[0]?.id || '');
	const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

	const filteredTemplates = UNIT_TEMPLATES.filter(
		t => t.id.includes(searchText) || t.name.includes(searchText)
	);

	const exportUnitData = () => {
		const data = JSON.stringify(units, null, 2);
		const blob = new Blob([data], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${force}_units_${Date.now()}.json`;
		a.click();
	};

	const importUnitData = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (event) => {
			try {
				const json = JSON.parse(event.target?.result as string);
				// json が配列であることを確認してからセット
				if (Array.isArray(json)) {
					setUnits(json);
				} else {
					alert("データの形式が不正です。正しいJSONファイルを選択してください。");
				}
			} catch (err) {
				alert("ファイルの読み込みに失敗しました。");
			}
		};
		reader.readAsText(file);

		e.target.value = '';
	};

	const addUnitToTree = (tree: Unit[], parentId: string | null, newUnit: Unit): Unit[] => {
		if (parentId === null) return [...tree, newUnit];
		
		return tree.map(u => {
			if (u.id === parentId) {
				return { ...u, lower_units: [...u.lower_units, newUnit] };
			}
			return { ...u, lower_units: addUnitToTree(u.lower_units, parentId, newUnit) };
		});
	};

	const addUnit = () => {
		const isVisible = filteredTemplates.some(t => t.id === selectedTemplateId);
		const targetId = isVisible ? selectedTemplateId : (filteredTemplates[0]?.id);

		if (!targetId) return;

		const newUnit = createUnitStructure(targetId, force);
		setUnits(prev => addUnitToTree(prev, selectedUnitId, newUnit));
	};

	const deleteUnitFromTree = (tree: Unit[], idToDelete: string): Unit[] => {
		return tree
			.filter(u => u.id !== idToDelete)
			.map(u => ({
				...u,
				lower_units: deleteUnitFromTree(u.lower_units, idToDelete)
			}));
	};

	const deleteUnit = () => {
		if (!selectedUnitId) return;

		const findUnit = (tree: Unit[], id: string): Unit | null => {
			for (const u of tree) {
				if (u.id === id) return u;
				const found = findUnit(u.lower_units, id);
				if (found) return found;
			}
			return null;
		};

		const unitToDelete = findUnit(units, selectedUnitId);
		if (!unitToDelete) return;

		const idsToDelete = getAllUnitIds(unitToDelete);

		setUnits(prev => deleteUnitFromTree(prev, selectedUnitId));

		idsToDelete.forEach(id => onUnitDeleted(id));

		setSelectedUnitId(null);
	};

	const toggleExpand = (id: string) => {
		const next = new Set(expandedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setExpandedIds(next);
	};

	return (
		<div style={{ flex: '1 1 50%', overflowY: 'auto', padding: '0 10px' }}>
			<div className="d-flex justify-content-between align-items-center mb-2">
				<h4 className={'text-' + FORCE_STYLES[force].class}>{force}</h4>
				<div className="d-flex gap-1">
					<input type="file" id={`import-${force}`} style={{ display: 'none' }} onChange={importUnitData} accept=".json" />
					<label className="btn btn-xs btn-outline-secondary" htmlFor={`import-${force}`} style={{ fontSize: '0.7rem' }}>インポート</label>
					<button className="btn btn-xs btn-outline-secondary" onClick={exportUnitData} style={{ fontSize: '0.7rem' }}>エクスポート</button>
				</div>
			</div>
			<div className="bg-secondary p-2 mb-3 rounded d-flex align-items-center gap-2">
				<input type="text" className="form-control form-control-sm" style={{ width: '200px' }} placeholder="検索..." value={searchText} onChange={(e) => setSearchText(e.target.value)} />
				<select className="form-select form-select-sm" style={{ flexGrow: 1 }} value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}>
					{UNIT_TEMPLATES.filter(t => t.id.includes(searchText) || t.name.includes(searchText)).map(t => <option key={t.id} value={t.id}>[{t.id}] {t.name}</option>)}
				</select>
				<button className={`btn btn-sm ${'btn-' + FORCE_STYLES[force].class}`} style={{ width: '120px' }} onClick={addUnit}>追加</button>
				<button 
					className="btn btn-sm btn-outline-light" 
					onClick={deleteUnit}
					style={{ width: '120px' }}
					disabled={!selectedUnitId}
				>
					削除
				</button>
			</div>
				<table className="table table-dark table-striped table-sm" style={{ tableLayout: 'fixed', width: '100%' }}>
					<thead>
						<tr>
							<th>部隊</th>
							{visibleColumns.includes('type') && <th>部隊種</th>}
							{visibleColumns.includes('personnel') && <th>人員</th>}
							{visibleColumns.includes('equipments') && <th>装備</th>}
						</tr>
					</thead>
					<tbody>
						{units.map(u => (
							<UnitTree 
								key={u.id} unit={u} 
								onSelect={(id) => setSelectedUnitId(id === selectedUnitId ? null : id)} 
								selectedId={selectedUnitId} 
								visibleColumns={visibleColumns} 
								expandedIds={expandedIds}
								onToggle={(id) => toggleExpand(id)}
							/>
						))}
					</tbody>
				</table>
		</div>
	);
};

export const UnitEditor = ({ 
	isOpen, 
	onClose,
	removeUnitFromMap,
}: { 
	isOpen: boolean; 
	onClose: () => void;
	removeUnitFromMap: (unitId: string) => void;
}) => {
	const { units, setUnits } = useAppStore();

	const getForceSpecificSetUnits = (force: Force) => (
		updater: React.SetStateAction<Unit[]>
	) => {
		setUnits((prevUnits) => {
			const otherUnits = prevUnits.filter(u => u.force !== force);
			const currentForceUnits = prevUnits.filter(u => u.force === force);
			const updatedForceUnits = typeof updater === 'function' 
				? updater(currentForceUnits) 
				: updater;
			
			return [...otherUnits, ...updatedForceUnits];
		});
	};

	if (!isOpen) return null;
	return (
		<div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 2000 }}>
			<div className="modal-dialog modal-fullscreen">
				<div className="modal-content bg-dark text-white">
					<div className="modal-header border-secondary">
						<h5 className="modal-title">部隊編成</h5>
						<button className="btn-close btn-close-white" onClick={onClose}></button>
					</div>
					<div className="modal-body d-flex" style={{ height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
						{FORCES.map((force, index) => (
							<React.Fragment key={force}>
								<UnitTable 
									units={units.filter(u => u.force === force)} 
									setUnits={getForceSpecificSetUnits(force)} 
									force={force} 
									onUnitDeleted={removeUnitFromMap} 
								/>

								{index < FORCES.length - 1 && (
									<div className="vr bg-secondary" style={{ width: '2px' }}></div>
								)}
							</React.Fragment>
						))}
					</div>
				</div>
			</div>
		</div>
	);
};