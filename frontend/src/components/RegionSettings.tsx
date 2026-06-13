import { useState } from 'react';
import { CommonModal, InputModal } from './CommonModal';

type ElementType = 'operation' | 'fortification' | 'obstacle' | 'red' | 'blue';
type GeometryType = 'polygon' | 'polyline' | 'point';

interface MapElement {
	id: string;
	type: ElementType;
	geometry: GeometryType;
	name: string;
}

export const RegionSettings = ({ 
	isOpen, 
	onClose, 
	elements, 
	setElements, 
	onStartDrawing,
	drawingType, // 追加
	drawingGeometry // 追加
}: { 
	isOpen: boolean; 
	onClose: () => void; 
	elements: MapElement[]; 
	setElements: React.Dispatch<React.SetStateAction<MapElement[]>>;
	onStartDrawing: (el: Partial<MapElement>) => void;
	drawingType: ElementType | null; // 追加
	drawingGeometry: GeometryType | null; // 追加
}) => {
	if (!isOpen) return null;

	const hasOperationArea = elements.some((el) => el.type === 'operation');
	const [modal, setModal] = useState({ show: false, title: '', message: '', onConfirm: () => {}, onCancel: undefined as (() => void) | undefined });
	const [inputModal, setInputModal] = useState<{show: boolean, type: ElementType | null, geometry: GeometryType | null}>({ show: false, type: null, geometry: null });

	const isActive = (type: ElementType, geometry: GeometryType) => 
		drawingType === type && drawingGeometry === geometry;

	const addElement = (type: ElementType, geometry: GeometryType, requiresName: boolean) => {
		if (type !== 'operation' && !hasOperationArea) {
			setModal({ title: 'エラー', message: '作戦地域を先に配置してください。', show: true, onConfirm: () => setModal(prev => ({...prev, show: false})) });
			return;
		}

		if (requiresName) {
			// 名前が必要ならモーダルを開く
			setInputModal({ show: true, type, geometry });
		} else {
			// 不要ならそのまま実行
			executeAddElement(type, geometry, type === 'operation' ? '作戦地域' : '陣地');
		}
	};

	const executeAddElement = (type: ElementType, geometry: GeometryType, name: string) => {
		onStartDrawing({ id: Date.now().toString(), type, geometry, name });
		setInputModal({ show: false, type: null, geometry: null });
	};

	const removeElement = (id: string, isOperation: boolean) => {
		if (isOperation) {
			// 削除確認モーダルを表示
			setModal({
				title: '削除の確認',
				message: '作戦地域を削除すると、すべての要素が削除されます。本当によろしいですか？',
				show: true,
				confirmText: '削除する',
				onConfirm: () => {
					elements.forEach((el) => el.layer?.remove());
					setElements([]);
					setModal(prev => ({ ...prev, show: false })); // モーダルを閉じる
				},
				onCancel: () => setModal(prev => ({ ...prev, show: false }))
			});
		} else {
			// 通常の要素削除（確認なし、または別の確認モーダルで）
			setElements((prev) => {
				const target = prev.find((el) => el.id === id);
				if (target && target.layer) {
					target.layer.remove();
				}
				return prev.filter((el) => el.id !== id);
			});
		}
	};

	return (
		<div className="offcanvas offcanvas-start show" style={{ visibility: 'visible', zIndex: 2000, backgroundColor: '#212529', color: '#fff', width: '280px' }}>
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title">地域設定</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>
			<div className="offcanvas-body p-2" style={{ fontSize: '0.85rem' }}>
				
				<h6 className="small">共通要素</h6>
				<div className="d-grid gap-1 mb-2">
					<button 
						className={`btn btn-sm ${isActive('operation', 'polygon') ? 'btn-light' : 'btn-outline-light'}`}
						onClick={() => addElement('operation', 'polygon', false)}
						disabled={!!drawingType}
					>
						作戦地域
					</button>
					<div className="btn-group">
						<button 
							className={`btn btn-sm ${isActive('fortification', 'polygon') ? 'btn-secondary' : 'btn-outline-secondary'}`}
							onClick={() => addElement('fortification', 'polygon', false)}
							disabled={!!drawingType}
						>
							陣地
						</button>
						<button 
							className={`btn btn-sm ${isActive('obstacle', 'polygon') ? 'btn-secondary' : 'btn-outline-secondary'}`}
							onClick={() => addElement('obstacle', 'polygon', false)}
							disabled={!!drawingType}
						>
							障害
						</button>
					</div>
				</div>

				<h6 className="small">REDFOR</h6>
				<div className="btn-group w-100 mb-2">
					<button 
						className={`btn btn-sm ${isActive('red', 'polygon') ? 'btn-danger' : 'btn-outline-danger'}`}
						onClick={() => addElement('red', 'polygon', true)}
						disabled={!!drawingType}
					>
						エリア
					</button>
					<button 
						className={`btn btn-sm ${isActive('red', 'polyline') ? 'btn-danger' : 'btn-outline-danger'}`}
						onClick={() => addElement('red', 'polyline', true)}
						disabled={!!drawingType}
					>
						線
					</button>
					<button 
						className={`btn btn-sm ${isActive('red', 'point') ? 'btn-danger' : 'btn-outline-danger'}`}
						onClick={() => addElement('red', 'point', true)}
						disabled={!!drawingType}
					>
						点
					</button>
				</div>

				<h6 className="small">BLUFOR</h6>
				<div className="btn-group w-100 mb-2">
					<button 
						className={`btn btn-sm ${isActive('blue', 'polygon') ? 'btn-info' : 'btn-outline-info'}`}
						onClick={() => addElement('blue', 'polygon', true)}
						disabled={!!drawingType}
					>
						エリア
					</button>
					<button 
						className={`btn btn-sm ${isActive('blue', 'polyline') ? 'btn-info' : 'btn-outline-info'}`}
						onClick={() => addElement('blue', 'polyline', true)}
						disabled={!!drawingType}
					>
						線
					</button>
					<button 
						className={`btn btn-sm ${isActive('blue', 'point') ? 'btn-info' : 'btn-outline-info'}`}
						onClick={() => addElement('blue', 'point', true)}
						disabled={!!drawingType}
					>
						点
					</button>
				</div>

				<h6 className="small border-top pt-2 mt-2">配置済み</h6>
				<ul className="list-group list-group-flush">
					{elements.map((el) => (
						<li key={el.id} className="list-group-item bg-dark text-white p-1 d-flex justify-content-between align-items-center">
							<span>{el.name}</span>
							<button className="btn btn-link text-danger p-0" onClick={() => removeElement(el.id, el.type === 'operation')}>削除</button>
						</li>
					))}
				</ul>
			</div>
			<CommonModal {...modal} />
			<InputModal 
				show={inputModal.show} 
				title="名前を入力" 
				onConfirm={(name) => name && executeAddElement(inputModal.type!, inputModal.geometry!, name)} 
				onCancel={() => setInputModal({ show: false, type: null, geometry: null })} 
			/>
		</div>
	);
};