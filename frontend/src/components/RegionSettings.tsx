import React, { useState } from 'react';
import type { CommonModalProps } from './CommonModal';
import { CommonModal, InputModal } from './CommonModal';

import type { MapElement, ElementType, GeometryType } from '../config/mapElement'
import { ElementTypeName, GeometryTypeName } from '../config/mapElement'

import '../App.module.css';

const SIDES: { 
	id: 'red' | 'blue'; 
	name: string; 
	active: string; 
	outline: string 
}[] = [
	{ id: 'red', name: 'REDFOR', active: 'btn-danger', outline: 'btn-outline-danger' },
	{ id: 'blue', name: 'BLUFOR', active: 'btn-info', outline: 'btn-outline-info' }
];

const COMMON_ELEMENTS: { type: ElementType; geometry: GeometryType; btnClass: string }[] = [
	{ type: 'operation', geometry: 'polygon', btnClass: 'btn-light' },
	{ type: 'fortification', geometry: 'polygon', btnClass: 'btn-light' },
	{ type: 'obstacle', geometry: 'polygon', btnClass: 'btn-light' }
];

const GEOMETRY_TYPES = Object.keys(GeometryTypeName) as GeometryType[];

export const RegionSettings = ({ 
	isOpen, 
	onClose, 
	elements, 
	setElements, 
	onStartDrawing,
	drawingType,
	drawingGeometry,
}: { 
	isOpen: boolean; 
	onClose: () => void; 
	elements: MapElement[]; 
	setElements: React.Dispatch<React.SetStateAction<MapElement[]>>;
	onStartDrawing: (el: Partial<MapElement>) => void;
	drawingType: ElementType | null;
	drawingGeometry: GeometryType | null;
}) => {
	if (!isOpen) return null;

	const hasOperationArea = elements.some((el) => el.type === 'operation');
	const [modal, setModal] = useState<CommonModalProps>({ 
		show: false, 
		title: '', 
		message: '', 
		onConfirm: () => {}, 
		onCancel: undefined,
		confirmText: 'OK'
	});
	const [inputModal, setInputModal] = useState<{show: boolean, type: ElementType | null, geometry: GeometryType | null}>({ show: false, type: null, geometry: null });

	const isActive = (type: ElementType, geometry: GeometryType) => 
		drawingType === type && drawingGeometry === geometry;

	const addElement = (type: ElementType, geometry: GeometryType, requiresName: boolean) => {
		if (type !== 'operation' && !hasOperationArea) {
			setModal({ 
				title: 'エラー', 
				message: '作戦地域を先に配置してください。', 
				show: true, 
				onConfirm: () => setModal(prev => ({...prev, show: false})),
				onCancel: undefined
			});
			return;
		}

		if (requiresName) {
			setInputModal({ show: true, type, geometry });
		} else {
			executeAddElement(type, geometry, ElementTypeName[type]);
		}
	};

	const executeAddElement = (type: ElementType, geometry: GeometryType, name: string) => {
		onStartDrawing({ id: Date.now().toString(), type, geometry, name });
		setInputModal({ show: false, type: null, geometry: null });
	};

	const removeElement = (id: string, isOperation: boolean) => {
		if (isOperation) {
			setModal({
				title: '削除の確認',
				message: '作戦地域を削除すると、すべての要素が削除されます。本当によろしいですか？',
				show: true,
				confirmText: '削除する',
				onConfirm: () => {
					elements.forEach((el) => el.layer?.remove());
					setElements([]);
					setModal(prev => ({ ...prev, show: false }));
				},
				onCancel: () => setModal(prev => ({ ...prev, show: false }))
			});
		} else {
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
		<div className="offcanvas offcanvas-start show">
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title">地域設定</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>
			<div className="offcanvas-body p-2" style={{ fontSize: '0.85rem' }}>
				
				{/* 共通要素エリア */}
				<div className="d-grid gap-1 mb-2">
					<div className="btn-group w-100 mb-2">
						{COMMON_ELEMENTS.map(({ type, geometry, btnClass }) => (
							<button
								key={type}
								className={`btn btn-sm ${isActive(type, geometry) ? btnClass : `btn-outline-${btnClass.replace('btn-', '')}`}`}
								onClick={() => addElement(type, geometry, false)}
								disabled={!!drawingType}
							>
								{ElementTypeName[type]}
							</button>
						))}
					</div>
				</div>

				{/* サイド別エリア */}
				{SIDES.map((side) => (
					<React.Fragment key={side.id}>
						<h6 className="small">{side.name}</h6>
						<div className="btn-group w-100 mb-2">
							{GEOMETRY_TYPES.map((geo) => (
								<button
									key={geo}
									className={`btn btn-sm ${isActive(side.id, geo) ? side.active : side.outline}`}
									onClick={() => addElement(side.id, geo, true)}
									disabled={!!drawingType}
								>
									{GeometryTypeName[geo]}
								</button>
							))}
						</div>
					</React.Fragment>
				))}

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