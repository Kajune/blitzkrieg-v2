import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../contexts/AppContext';
import type { UnitRecord } from '../config/simTypes';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';

type SimMode = 'playing' | 'recording' | null;

const TICK_INTERVAL = 1000;

export const SimControl = ({ showMenu }: { showMenu: boolean }) => {
	const {
		simUuid,
		simConfig,
		placedUnits, 
		setPlacedUnits, 
		simRecord, 
		setSimRecord,
		unitLayerMap,
	} = useAppStore();

	const [mode, setMode] = useState<SimMode>(null);
	const [speed, setSpeed] = useState<number>(1);
	const [currentTime, setCurrentTime] = useState(new Date(simConfig.startDateTime).getTime());

	const startTime = new Date(simConfig.startDateTime).getTime();
	const endTime = new Date(simConfig.endDateTime).getTime();

	const isFetchingRef = useRef<boolean>(false);
	const simRecordRef = useRef(simRecord);
	const placedUnitsRef = useRef(placedUnits);

	useEffect(() => { simRecordRef.current = simRecord; }, [simRecord]);
	useEffect(() => { placedUnitsRef.current = placedUnits; }, [placedUnits]);

	useEffect(() => {
		if (showMenu) {
			setMode(null);
		}
	}, [showMenu]);

	const toggleMode = (targetMode: SimMode) => {
		if (mode === targetMode) {
			setMode(null);
		} else {
			setMode(targetMode);
		}
	};

	useEffect(() => {
		const newStart = new Date(simConfig.startDateTime).getTime();
		setCurrentTime(newStart);
		setMode(null);
	}, [simConfig.startDateTime, simConfig.endDateTime]);

	useEffect(() => {
		if (!mode) return;

		let active = true;

		const loop = (_timestamp: number) => {
			if (!active) return;

			const delta = TICK_INTERVAL;

			setCurrentTime((prevTime) => {
				const nextTime = prevTime + (delta * speed);
				
				if (nextTime >= endTime) {
					setMode(null);
					return prevTime;
				}

				if (mode === 'playing') {
					updateUnitsByTime(nextTime, true);
				} else if (mode === 'recording' && !isFetchingRef.current) {
					isFetchingRef.current = true;
					fetchAndRecord(prevTime, nextTime - prevTime).finally(() => {
						isFetchingRef.current = false;
					});
				}

				return nextTime;
			});

			setTimeout(() => requestAnimationFrame(loop), TICK_INTERVAL);
		};

		requestAnimationFrame(loop);
		return () => { 
			active = false; 
		};
	}, [mode, speed, endTime]);

	const applyUnitPositions = (
		unitRecords: Record<string, UnitRecord>,
		animate: boolean = false
	) => {
		Object.entries(unitRecords).forEach(([unitId, unitRecord]) => {
			const marker = unitLayerMap.current.get(unitId);
			if (marker) {
				const icon = (marker as any)._icon;
				if (icon) {
					icon.style.transition = animate 
						? `transform ${TICK_INTERVAL * 2.0 / 1000}s linear` 
						: 'none';
				}
				marker.setLatLng([unitRecord.position.lat, unitRecord.position.lon]);
			}
		});

		setPlacedUnits((prev) =>
			prev.map((unit) => {
				const pos = unitRecords[unit.id].position;
				return pos ? { ...unit, position: pos } : unit;
			})
		);
	};

	const updateUnitsByTime = (time: number, animate: boolean) => {
		const record = simRecordRef.current.find((r) => 
			new Date(r.startDateTime).getTime() <= time && 
			time <= new Date(r.endDateTime).getTime()
		);
		
		if (record) {
			applyUnitPositions(record.units, animate);
		}
	};

	const fetchAndRecord = async (time: number, deltaTime: number) => {
		try {
			const response = await fetch('/api/simulate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					simUuid,
					time,
					deltaTime,
					placedUnits: placedUnitsRef.current,
				})
			});
			const result = await response.json();

			if (result.success && result.units) {
				setSimRecord((prev) => [...prev, result]);
				// 共通関数を利用
				applyUnitPositions(result.units, true);
			}
		} catch (err) {
			console.error('シミュレーションの取得に失敗しました', err);
		}
	};

	return (
		<div 
			className="position-absolute bg-dark border-top border-start border-secondary p-2"
			style={{ 
				bottom: 0, 
				right: 0, 
				width: '380px', 
				zIndex: 1000,
				fontSize: '0.8rem',
				borderTopLeftRadius: '8px'
			}}
		>
			<div className="text-center mb-2 fw-bold text-light">
				{new Date(currentTime).toLocaleString()}
			</div>

			<div className="d-flex align-items-center gap-2">
				{/* 再生ボタン */}
				<button 
					className={`btn btn-sm ${mode === 'recording' ? 'btn-outline-secondary' : 'btn-outline-primary'}`}
					onClick={() => toggleMode('playing')}
					disabled={mode === 'recording'}
				>
					{mode === 'playing' ? <i className="bi bi-stop-fill"></i> : <i className="bi bi-play-fill"></i>}
				</button>

				{/* 録画ボタン */}
				<button 
					className={`btn btn-sm ${mode === 'playing' ? 'btn-outline-secondary' : 'btn-outline-danger'}`}
					onClick={() => toggleMode('recording')}
					disabled={mode === 'playing' || simUuid === null}
					// ツールチップを表示
					title={simUuid === null ? "シミュレーション設定からサーバに送信すると録画可能になります" : ""}
				>
					{mode === 'recording' ? <i className="bi bi-stop-fill"></i> : <i className="bi bi-record-fill"></i>}
				</button>

				<div className="w-100" style={{ padding: '0 10px' }}>
					<Slider
						min={startTime}
						max={endTime}
						value={currentTime}
						onChange={(val) => {
							const time = val as number;
							setCurrentTime(time);
							updateUnitsByTime(time, false); // ここは即時反映（false）
						}}
						disabled={mode !== null}
						handleStyle={{
							height: 12,
							width: 12,
							marginTop: -4,
							backgroundColor: '#fff',
							border: '2px solid #0d6efd',
							zIndex: 2, // レールより上に表示
						}}
					/>
				</div>

				{/* 倍速切り替え：いつでも操作可能 */}
				<select 
					className="form-select form-select-sm" 
					style={{ width: '70px' }}
					value={speed}
					onChange={(e) => setSpeed(Number(e.target.value))}
				>
					<option value="1">x1</option>
					<option value="2">x2</option>
					<option value="4">x4</option>
					<option value="8">x8</option>
					<option value="16">x16</option>
				</select>
			</div>
		</div>
	);
};