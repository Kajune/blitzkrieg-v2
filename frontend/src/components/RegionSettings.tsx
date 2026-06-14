import React, { useState } from 'react';
import type { CommonModalProps } from './CommonModal';
import { CommonModal, InputModal } from './CommonModal';
import { useAppStore } from '../contexts/AppContext';
import type { Force } from '../config/unitTypes';
import { FORCE_STYLES } from '../config/unitTypes';
import type { MapElement, ElementType, GeometryType } from '../config/mapElement'
import { ElementTypeName, GeometryTypeName } from '../config/mapElement'

import '../App.module.css';


const COMMON_ELEMENTS: { type: ElementType; geometry: GeometryType; btnClass: string }[] = [
	{ type: 'operation', geometry: 'polygon', btnClass: 'btn-light' },
	{ type: 'fortification', geometry: 'polygon', btnClass: 'btn-light' },
	{ type: 'obstacle', geometry: 'polygon', btnClass: 'btn-light' }
];

const GEOMETRY_TYPES = Object.keys(GeometryTypeName) as GeometryType[];

export const RegionSettings = ({ 
	isOpen, 
	onClose, 
	onStartDrawing,
	drawingElement,
}: { 
	isOpen: boolean; 
	onClose: () => void; 
	onStartDrawing: (el: MapElement) => void;
	drawingElement: MapElement | null;
}) => {
	const { mapElements, setMapElements } = useAppStore();
	const [modal, setModal] = useState<CommonModalProps>({ 
		show: false, 
		title: '', 
		message: '', 
		onConfirm: () => {}, 
		onCancel: undefined,
		confirmText: 'OK'
	});
	const [inputModal, setInputModal] = useState<{show: boolean, type: ElementType | null, geometry: GeometryType | null, force: Force | null}>({ show: false, type: null, geometry: null, force: null });

	if (!isOpen) return null;

	const hasOperationArea = mapElements.some((el) => el.type === 'operation');

	const isActive = (type: ElementType, geometry: GeometryType, force: Force | null) => {
		if (!drawingElement) {
			return false;
		}
		return drawingElement.type === type && drawingElement.geometry === geometry && drawingElement.force === force;
	}

	const addElement = (type: ElementType, geometry: GeometryType, force: Force | null, requiresName: boolean) => {
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
			setInputModal({ show: true, type, geometry, force });
		} else {
			executeAddElement(type, geometry, force, ElementTypeName[type]);
		}
	};

	const executeAddElement = (type: ElementType, geometry: GeometryType, force: Force | null, name: string) => {
		onStartDrawing({ id: Date.now().toString(), type, force, geometry, name });
		setInputModal({ show: false, type: null, geometry: null, force: null });
	};

	const removeElement = (id: string, isOperation: boolean) => {
		if (isOperation) {
			setModal({
				title: '削除の確認',
				message: '作戦地域を削除すると、すべての要素が削除されます。本当によろしいですか？',
				show: true,
				confirmText: '削除する',
				onConfirm: () => {
					mapElements.forEach((el) => el.layer?.remove());
					setMapElements([]);
					setModal(prev => ({ ...prev, show: false }));
				},
				onCancel: () => setModal(prev => ({ ...prev, show: false }))
			});
		} else {
			setMapElements((prev) => {
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
								className={`btn btn-sm ${isActive(type, geometry, null) ? btnClass : `btn-outline-${btnClass.replace('btn-', '')}`}`}
								onClick={() => addElement(type, geometry, null, false)}
								disabled={!!drawingElement}
							>
								{ElementTypeName[type]}
							</button>
						))}
					</div>
				</div>

				{/* サイド別エリア */}
				{Object.entries(FORCE_STYLES).map(([force, style]) => (
					<React.Fragment key={force}>
						<h6 className="small">{force}</h6>
						<div className="btn-group w-100 mb-2">
							{GEOMETRY_TYPES.map((geo) => (
								<button
									key={geo}
									className={`btn btn-sm btn-${isActive("coa", geo, force as Force) ? "" : "outline-"}${style.class}`}
									onClick={() => addElement("coa", geo, force as Force, true)}
									disabled={!!drawingElement}
								>
									{GeometryTypeName[geo]}
								</button>
							))}
						</div>
					</React.Fragment>
				))}

				<h6 className="small border-top pt-2 mt-2">配置済み</h6>
				<ul className="list-group list-group-flush">
					{mapElements.map((el) => (
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
				onConfirm={(name) => name && executeAddElement(inputModal.type!, inputModal.geometry!, inputModal.force!, name)} 
				onCancel={() => setInputModal({ show: false, type: null, force: null, geometry: null })} 
			/>
		</div>
	);
};