import React, { useState } from 'react';
import type { CommonModalProps } from './CommonModal';
import { CommonModal, InputModal } from './CommonModal';
import { useAppStore } from '../contexts/AppContext';
import type { Force } from '../types/unitTypes';
import { FORCES, FORCE_STYLES } from '../types/unitTypes';
import type { MapElement, ElementType, GeometryType } from '../types/mapElement'
import { ElementTypeName, GeometryTypeName } from '../types/mapElement'

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
	onVisibilityChange,
}: { 
	isOpen: boolean; 
	onClose: () => void; 
	onStartDrawing: (el: MapElement) => void;
	drawingElement: MapElement | null;
	onVisibilityChange: (el: MapElement, visible: boolean) => void;
}) => {
	const { mapElements, setMapElements } = useAppStore();
	const [activeTab, setActiveTab] = useState<Force>(FORCES[0]);
	const [visible, setVisible] = useState<Record<Force, boolean>>(() => {
		const initialVisible = {} as Record<Force, boolean>;
		FORCES.forEach((f) => { initialVisible[f] = true; });
		return initialVisible;
	});
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

	const hasOperationArea = mapElements.some((el) => (el.type === 'operation') && (el.force === activeTab));

	const isActive = (type: ElementType, geometry: GeometryType, force: Force) => {
		if (!drawingElement) {
			return false;
		}
		return drawingElement.type === type && drawingElement.geometry === geometry && drawingElement.force === force;
	}

	const addElement = (type: ElementType, geometry: GeometryType, force: Force, requiresName: boolean) => {
		toggleAllByForce(force, true);

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

	const executeAddElement = (type: ElementType, geometry: GeometryType, force: Force, name: string) => {
		onStartDrawing({ id: crypto.randomUUID(), type, force, geometry, name });
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

	const toggleAllByForce = (force: Force, isChecked: boolean) => {
		setVisible(prev => ({ ...prev, [force]: isChecked }));

		mapElements.forEach((el) => {
			if (el.force === force) {
				onVisibilityChange(el, isChecked);
			}
		});
	};

	return (
		<div className="offcanvas offcanvas-start show">
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title">地域設定</h6>
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
				<React.Fragment key={activeTab}>
					<div className="form-check mb-2 text-start">
						<input
							className="form-check-input"
							type="checkbox"
							id={`toggle-${activeTab}`}
							checked={visible[activeTab]}
							onChange={(e) => toggleAllByForce(activeTab, e.target.checked)}
						/>
						<label className="form-check-label" htmlFor={`toggle-${activeTab}`}>
							{activeTab}の全要素を表示
						</label>
					</div>

					{/* 共通要素エリア */}
					<div className="d-grid gap-1 mb-2">
						<h6 className="small">一般</h6>
						<div className="btn-group w-100 mb-2">
							{COMMON_ELEMENTS.map(({ type, geometry, btnClass }) => (
								<button
									key={type}
									className={`btn btn-sm ${isActive(type, geometry, activeTab) ? btnClass : `btn-outline-${btnClass.replace('btn-', '')}`}`}
									onClick={() => addElement(type, geometry, activeTab, false)}
									disabled={!!drawingElement || (type === 'operation' && hasOperationArea) || (type !== 'operation' && !hasOperationArea)}
								>
									{ElementTypeName[type]}
								</button>
							))}
						</div>
					</div>

					{/* サイド別エリア */}
					<h6 className="small">COA</h6>
					<div className="btn-group w-100 mb-2">
						{GEOMETRY_TYPES.map((geo) => (
							<button
								key={geo}
								className={`btn btn-sm btn-${isActive("coa", geo, activeTab) ? "" : "outline-"}${FORCE_STYLES[activeTab].class}`}
								onClick={() => addElement("coa", geo, activeTab, true)}
								disabled={!!drawingElement || !hasOperationArea}
							>
								{GeometryTypeName[geo]}
							</button>
						))}
					</div>

					<h6 className="small border-top pt-2 mt-2">配置済み</h6>
					<ul className="list-group list-group-flush">
						{mapElements
							.filter((el) => el.force === activeTab)
							.map((el) => (
							<li key={el.id} className="list-group-item bg-dark text-white p-1 d-flex justify-content-between align-items-center">
								<span>{el.name}</span>
								<button className="btn btn-link text-danger p-0" onClick={() => removeElement(el.id, el.type === 'operation')}>削除</button>
							</li>
						))}
					</ul>

				</React.Fragment>
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