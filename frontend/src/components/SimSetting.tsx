import { useState } from 'react';
import { useAppStore } from '../contexts/AppContext';
import '../App.module.css';


export const SimSetting = ({ 
	isOpen, 
	onClose,
}: { 
	isOpen: boolean; 
	onClose: () => void;
}) => {
	if (!isOpen) return null;

	return (
		<div className="offcanvas offcanvas-start show" style={{ width: '300px' }}>
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title">シミュレーション設定</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>

		</div>
	);
};
