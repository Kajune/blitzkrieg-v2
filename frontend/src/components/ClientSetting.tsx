import { useState } from 'react';
import { useAppStore } from '../contexts/AppContext';
import { useMapStore } from '../contexts/MapContext';
import type { Force } from '../types/unitTypes';
import { FORCES } from '../types/unitTypes';
import '../App.module.css';


export const ClientSetting = ({ 
	isOpen, 
	onClose,
}: { 
	isOpen: boolean; 
	onClose: () => void;
}) => {
	const { 
		setDisplayForce,
		clientUuid, setClientUuid,
		clientForce, setClientForce,
		setSimConfig,
		setUnits,
		setPlacedUnits,
		setMapElements,
		setSimRecord,
		setSimUuid,
	} = useAppStore();
	const { 
		setMobilityMap,
		setShouldFocusAfterLoad,
	} = useMapStore();

	const [inputUuid, setInputUuid] = useState('');
	const [selectedForce, setSelectedForce] = useState<Force>(FORCES[0]);
	const [isSending, setIsSending] = useState(false);

	if (!isOpen) return null;

	const handleJoin = async () => {
		const trimmedUuid = inputUuid.trim();
		if (!trimmedUuid) return;

		setIsSending(true);
		try {
			const response = await fetch(`/api/fetch_simulation?sim_uuid=${encodeURIComponent(trimmedUuid)}`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			});
			const data = await response.json();

			if (data.success || response.ok) {
				if (data.simConfig) setSimConfig(data.simConfig);
				if (data.units) setUnits(data.units);
				if (data.placedUnits) setPlacedUnits(data.placedUnits);
				if (data.mapElements) setMapElements(data.mapElements);
				if (data.simRecord) setSimRecord(data.simRecord);
				setSimUuid(trimmedUuid);

				const mobilityResponse = await fetch(`/api/mobility_map?sim_id=${encodeURIComponent(trimmedUuid)}`, {
					method: 'GET',
					headers: {
						'Content-Type': 'application/json',
					},
				});
				const mobilityData = await mobilityResponse.json();
				if (mobilityData.mobility_map) {
					setMobilityMap(mobilityData.mobility_map);
				}

				setClientUuid(trimmedUuid);
				setClientForce(selectedForce);
				setDisplayForce(selectedForce);
				setShouldFocusAfterLoad(true);
			} else {
				console.error('シミュレーションの取得に失敗しました:', data.errors);
				alert('シミュレーションの取得に失敗しました。UUIDを確認してください。');
			}
		} catch (error) {
			console.error('通信エラー:', error);
			alert('サーバとの通信に失敗しました。');
		} finally {
			setIsSending(false);
		}
	};

	const handleLeave = () => {
		setClientUuid(null);
		setClientForce(null);
	};

	return (
		<div className="offcanvas offcanvas-start show" style={{ width: '300px' }}>
			<div className="offcanvas-header p-2 border-bottom border-secondary">
				<h6 className="offcanvas-title">クライアント設定</h6>
				<button className="btn-close btn-close-white btn-sm" onClick={onClose}></button>
			</div>
			<div className="p-3">
				<div className="mb-2">
					<label className="form-label small mb-1">シミュレーション UUID</label>
					<input
						type="text"
						className="form-control form-control-sm"
						placeholder="UUIDを入力"
						value={inputUuid}
						onChange={(e) => setInputUuid(e.target.value)}
						disabled={clientUuid !== null || isSending}
					/>
				</div>

				<div className="mb-2">
					<label className="form-label small mb-1">参加勢力</label>
					<select
						className="form-select form-select-sm"
						value={selectedForce}
						onChange={(e) => setSelectedForce(e.target.value as Force)}
						disabled={clientUuid !== null || isSending}
					>
						{FORCES.map((force) => (
							<option key={force} value={force}>
								{force}
							</option>
						))}
					</select>
				</div>

				{clientUuid === null ? (
					<button 
						className="btn btn-primary btn-sm w-100 mb-2" 
						onClick={handleJoin}
						disabled={!inputUuid.trim() || isSending}
					>
						{isSending ? '参加中...' : '参加'}
					</button>
				) : (
					<button 
						className="btn btn-danger btn-sm w-100 mb-2" 
						onClick={handleLeave}
					>
						離脱
					</button>
				)}

				{clientUuid && (
					<div className="alert alert-success p-2 small mt-3">
						<div><strong>参加中</strong></div>
						<div className="text-break">ID: {clientUuid}</div>
						<div>勢力: {clientForce}</div>
					</div>
				)}
			</div>
		</div>
	);
};