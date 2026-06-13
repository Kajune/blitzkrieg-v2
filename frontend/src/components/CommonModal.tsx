import React, { useState } from 'react';

interface CommonModalProps {
	show: boolean;
	title: string;
	message: string;
	onConfirm: () => void;
	onCancel?: () => void;
	confirmText?: string;
}

export const CommonModal = ({ show, title, message, onConfirm, onCancel, confirmText = 'OK' }: CommonModalProps) => {
	if (!show) return null;

	return (
		<div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
			<div className="modal-dialog modal-dialog-centered">
				<div className="modal-content bg-dark text-white border-secondary">
					<div className="modal-header border-secondary">
						<h5 className="modal-title">{title}</h5>
					</div>
					<div className="modal-body">
						<p>{message}</p>
					</div>
					<div className="modal-footer border-secondary">
						{onCancel && <button className="btn btn-outline-secondary btn-sm" onClick={onCancel}>キャンセル</button>}
						<button className="btn btn-primary btn-sm" onClick={onConfirm}>{confirmText}</button>
					</div>
				</div>
			</div>
		</div>
	);
};

export const InputModal = ({ show, title, onConfirm, onCancel }: { show: boolean, title: string, onConfirm: (val: string) => void, onCancel: () => void }) => {
	const [value, setValue] = useState('');
	if (!show) return null;

	return (
		<div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
			<div className="modal-dialog modal-dialog-centered">
				<div className="modal-content bg-dark text-white border-secondary">
					<div className="modal-header border-secondary"><h5>{title}</h5></div>
					<div className="modal-body">
						<input className="form-control bg-dark text-white" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
					</div>
					<div className="modal-footer border-secondary">
						<button className="btn btn-outline-secondary btn-sm" onClick={onCancel}>キャンセル</button>
						<button className="btn btn-primary btn-sm" onClick={() => { onConfirm(value); setValue(''); }}>決定</button>
					</div>
				</div>
			</div>
		</div>
	);
};