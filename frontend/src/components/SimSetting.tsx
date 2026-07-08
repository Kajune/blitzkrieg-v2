import { useState } from 'react';
import { useAppStore } from '../contexts/AppContext';
import { mapElementToJSON } from '../types/mapElement';
import '../App.module.css';


export const SimSetting = ({ 
	isOpen, 
	onClose,
}: { 
	isOpen: boolean; 
	onClose: () => void;
}) => {
	const { 
		simConfig, setSimConfig, 
		simUuid, setSimUuid,
		units, placedUnits, mapElements,
		setMobilityMap,
	} = useAppStore();
	const [isSending, setIsSending] = useState(false);
	const [isCopied, setIsCopied] = useState(false);

	if (!isOpen) return null;

	const formatDateForInput = (date: Date | string) => {
		// 文字列ならDateに変換する
		const d = typeof date === 'string' ? new Date(date) : date;
		
		if (!(d instanceof Date) || isNaN(d.getTime())) {
			return ''; 
		}
		
		const offset = d.getTimezoneOffset() * 60000;
		const localISOTime = new Date(d.getTime() - offset).toISOString().slice(0, 16);
		return localISOTime;
	};

	const start = new Date(simConfig.startDateTime);
	const end = new Date(simConfig.endDateTime);

	const durationHours = !isNaN(start.getTime()) && !isNaN(end.getTime())
		? Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60))
		: 0;

	const handleChange = (key: 'startDateTime' | 'endDateTime', value: string) => {
		setSimConfig(prev => ({
			...prev,
			[key]: new Date(value),
		}));
	};

	const handleSendToServer = async () => {
		setIsSending(true);

		try {
			const payload = {
				simConfig,
				units,
				placedUnits,
				mapElements: mapElements.map(mapElementToJSON),
			};

			const response = await fetch('/api/register_simulation', {
				method: 'POST',
				body: JSON.stringify(payload),
				headers: {
					'Content-Type': 'application/json',
				},
			});
			const data = await response.json();
			if (data.success) {
				setSimUuid(data.uuid);

				const mobilityResponse = await fetch(`/api/mobility_map?sim_id=${encodeURIComponent(data.uuid)}`, {
					method: 'GET',
					headers: {
						'Content-Type': 'application/json',
					},
				});
				
				const mobilityData = await mobilityResponse.json();
				setMobilityMap(mobilityData.mobility_map);
			} else {
				console.log(data.errors);
			}
		} catch (error) {
			console.error('送信失敗:', error);
		} finally {
			setIsSending(false);
		}
	};

	const handleCopy = () => {
		if (simUuid) {
			navigator.clipboard.writeText(simUuid);
			setIsCopied(true);
			setTimeout(() => setIsCopied(false), 2000);
		}
	};

	return (
		<div className="offcanvas offcanvas-start show" style={{ width: '300px' }}>
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title">シミュレーション設定</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>
			<div className="p-3">
				<div className="mb-2">
					<label className="form-label small mb-1">開始日時</label>
					<input
						type="datetime-local"
						className="form-control form-control-sm"
						value={formatDateForInput(simConfig.startDateTime)}
						onChange={(e) => handleChange('startDateTime', e.target.value)}
					/>
				</div>
				<div className="mb-2">
					<label className="form-label small mb-1">終了日時</label>
					<input
						type="datetime-local"
						className="form-control form-control-sm"
						value={formatDateForInput(simConfig.endDateTime)}
						onChange={(e) => handleChange('endDateTime', e.target.value)}
					/>
				</div>
				<div className="alert alert-info p-2 small my-3">
					期間: <strong>{durationHours} 時間</strong>
				</div>

				<div className="mb-2">
					<label className="form-label small mb-1">ステップ間隔 (s)</label>
					<input
						type="number"
						className="form-control form-control-sm"
						value={simConfig.tickInterval}
						onChange={(e) => {
							const val = parseInt(e.target.value, 10);
							setSimConfig(prev => ({ ...prev, tickInterval: val }));
						}}
					/>
				</div>

				<button 
					className="btn btn-primary btn-sm w-100 mb-3" 
					onClick={handleSendToServer}
					disabled={isSending}
				>
					{isSending ? '送信中...' : 'サーバに送信'}
				</button>

				{simUuid && (
					<div className="alert alert-success p-2">
						<div className="d-flex justify-content-between align-items-center mb-1">
							<small>ID:</small>
							<button 
								className="btn btn-sm p-0 border-0 bg-transparent" 
								onClick={handleCopy}
								title="コピーする"
							>
								{isCopied ? (
									<span className="badge bg-success">Copied!</span>
								) : (
									<i className="bi bi-clipboard"></i>
								)}
							</button>
						</div>
						<div className="small text-break"><strong>{simUuid}</strong></div>
					</div>
				)}
			</div>
		</div>
	);
};