import { useState } from 'react';
import { UNIT_TEMPLATES } from '../config/unitTypes';
import type { Unit } from '../config/unitTypes';
import { UnitTree } from './UnitTree';
import './UnitEditor.css';

const createUnitStructure = (templateId: string, color: 'red' | 'blue'): Unit => {
	const template = UNIT_TEMPLATES.find(t => t.id === templateId);
	if (!template) return { id: '', templateId: '不明', name: '不明', sidc: '', type: '不明', personnel: 0, equipments: {}, children: [] };

	return {
		id: Date.now().toString() + Math.random(),
		templateId: template.id,
		name: template.name,
		sidc: color === 'red' ? template.sidc['REDFOR'] : template.sidc['BLUFOR'],
		type: template.type,
		personnel: template.personnel,
		equipments: template.equipments,
		children: Object.entries(template.lower_units).flatMap(([childId, count]) => 
			Array.from({ length: count as number }).map(() => createUnitStructure(childId, color))
		)
	};
};

const UnitTable = ({ 
	units, 
	setUnits, 
	color, 
	visibleColumns = ['type', 'personnel', 'equipments'] // デフォルト値を指定
}: { 
	units: Unit[], 
	setUnits: React.Dispatch<React.SetStateAction<Unit[]>>, 
	color: 'red' | 'blue',
	visibleColumns?: ('type' | 'personnel' | 'equipments')[] // 型定義を追加
}) => {
	const [searchText, setSearchText] = useState('');
	const [selectedTemplateId, setSelectedTemplateId] = useState(UNIT_TEMPLATES[0]?.id || '');
	const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

	const filteredTemplates = UNIT_TEMPLATES.filter(
		t => t.id.includes(searchText) || t.name.includes(searchText)
	);

	const exportUnitData = () => {
		const data = JSON.stringify(units, null, 2);
		const blob = new Blob([data], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${color}_units_${Date.now()}.json`;
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
				return { ...u, children: [...u.children, newUnit] };
			}
			return { ...u, children: addUnitToTree(u.children, parentId, newUnit) };
		});
	};

	const addUnit = () => {
		// 現在表示されている選択肢の中から、現在のIDが存在するか確認
		const isVisible = filteredTemplates.some(t => t.id === selectedTemplateId);
		
		// 表示されていない場合は、リストの先頭を強制的に使用（リストが空なら何もしない）
		const targetId = isVisible ? selectedTemplateId : (filteredTemplates[0]?.id);

		if (!targetId) return; // 候補がない場合は終了

		const newUnit = createUnitStructure(targetId, color);
		setUnits(prev => addUnitToTree(prev, selectedUnitId, newUnit));
	};

	const deleteUnitFromTree = (tree: Unit[], idToDelete: string): Unit[] => {
		return tree
			.filter(u => u.id !== idToDelete) // 自分自身を消す
			.map(u => ({
				...u,
				children: deleteUnitFromTree(u.children, idToDelete) // 子供の中からさらに探して消す
			}));
	};

	const deleteUnit = () => {
		if (!selectedUnitId) return;
		setUnits(prev => deleteUnitFromTree(prev, selectedUnitId));
		setSelectedUnitId(null); // 選択解除
	};

	return (
		<div style={{ flex: '1 1 50%', overflowY: 'auto', padding: '0 10px' }}>
			<div className="d-flex justify-content-between align-items-center mb-2">
				<h4 className={color === 'red' ? 'text-danger' : 'text-primary'}>{color === 'red' ? 'REDFOR' : 'BLUFOR'}</h4>
				<div className="d-flex gap-1">
					<input type="file" id={`import-${color}`} style={{ display: 'none' }} onChange={importUnitData} accept=".json" />
					<label className="btn btn-xs btn-outline-secondary" htmlFor={`import-${color}`} style={{ fontSize: '0.7rem' }}>インポート</label>
					<button className="btn btn-xs btn-outline-secondary" onClick={exportUnitData} style={{ fontSize: '0.7rem' }}>エクスポート</button>
				</div>
			</div>
			<div className="bg-secondary p-2 mb-3 rounded d-flex align-items-center gap-2">
				<input type="text" className="form-control form-control-sm" style={{ width: '200px' }} placeholder="検索..." value={searchText} onChange={(e) => setSearchText(e.target.value)} />
				<select className="form-select form-select-sm" style={{ flexGrow: 1 }} value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}>
					{UNIT_TEMPLATES.filter(t => t.id.includes(searchText) || t.name.includes(searchText)).map(t => <option key={t.id} value={t.id}>[{t.id}] {t.name}</option>)}
				</select>
				<button className={`btn btn-sm ${color === 'red' ? 'btn-danger' : 'btn-primary'}`} style={{ width: '120px' }} onClick={addUnit}>追加</button>
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
							/>
						))}
					</tbody>
				</table>
		</div>
	);
};

export const UnitEditor = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
	const [redUnits, setRedUnits] = useState<Unit[]>([]);
	const [blueUnits, setBlueUnits] = useState<Unit[]>([]);
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
						<UnitTable units={redUnits} setUnits={setRedUnits} color="red" />
						<div className="vr bg-secondary" style={{ width: '2px' }}></div>
						<UnitTable units={blueUnits} setUnits={setBlueUnits} color="blue" />
					</div>
				</div>
			</div>
		</div>
	);
};