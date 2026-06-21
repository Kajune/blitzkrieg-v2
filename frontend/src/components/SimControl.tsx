import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../contexts/AppContext';
import type { UnitRecord } from '../types/simTypes';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';

type SimMode = 'playing' | 'recording' | null;

export const SimControl = ({ 
	showMenu,
	updateDetectionPolygons,
}: { 
	showMenu: boolean,
	updateDetectionPolygons: (unitId: string, detectedUnits: Record<string, number>) => void,
}) => {
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

	const [actualSpeed, setActualSpeed] = useState<string>("1.0");
	const lastTickTimeRef = useRef<number>(performance.now());
	const rollingSpeedRef = useRef<number>(1);

	const startTime = new Date(simConfig.startDateTime).getTime();
	const endTime = new Date(simConfig.endDateTime).getTime();

	const animationRef = useRef<number | null>(null);
	const isFetchingRef = useRef<boolean>(false);
	const simRecordRef = useRef(simRecord);
	const placedUnitsRef = useRef(placedUnits);

	useEffect(() => { simRecordRef.current = simRecord; }, [simRecord]);
	useEffect(() => { placedUnitsRef.current = placedUnits; }, [placedUnits]);
	const currentTimeRef = useRef(currentTime);
	useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

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
		const targetInterval = simConfig.tickInterval * 1000 / speed;
		let drift = 0;

		const loop = async (_timestamp: number) => {
			if (!active) return;

			const now = performance.now();
			const elapsed = now - lastTickTimeRef.current;
			lastTickTimeRef.current = now;

			const currentRealSpeed = simConfig.tickInterval * 1000 / Math.max(elapsed, targetInterval / 2);
			rollingSpeedRef.current = rollingSpeedRef.current * 0.5 + currentRealSpeed * 0.5;
			setActualSpeed(rollingSpeedRef.current.toFixed(1));

			drift += targetInterval - elapsed;
			const adjustment = drift * 0.5;
			drift -= adjustment;
			const nextDelay = Math.max(0, targetInterval + adjustment);

			const prevTime = currentTimeRef.current;
			const nextTime = prevTime + simConfig.tickInterval * 1000;

			if (nextTime >= endTime) {
				setMode(null);
				return;
			}

			try {
				if (mode === 'playing') {
					updateUnitsByTime(nextTime, true, nextDelay);
				} else if (mode === 'recording') {
					isFetchingRef.current = true;
					await fetchAndRecord(prevTime, simConfig.tickInterval * 1000, nextDelay);
					isFetchingRef.current = false;
				}

				setCurrentTime(nextTime);
				currentTimeRef.current = nextTime;

			} catch (err) {
				console.error("Simulation loop error:", err);
			}

			if (active) {
				setTimeout(() => requestAnimationFrame(loop), nextDelay);
			}
		};

		lastTickTimeRef.current = performance.now();
		requestAnimationFrame(loop);
		
		return () => { active = false; };
	}, [mode, speed, endTime]);

	const applyUnitStatus = (
		unitRecords: Record<string, UnitRecord>,
		animate: boolean = false,
		nextDelay: number
	) => {
		updatePlacedUnits(unitRecords);

		if (animationRef.current !== null) {
			cancelAnimationFrame(animationRef.current);
		}

		if (!animate) {
			Object.entries(unitRecords).forEach(([unitId, unitRecord]) => {
				const marker = unitLayerMap.current.get(unitId);
				if (marker) {
					const last_position = unitRecord.trajectory[unitRecord.trajectory.length - 1];
					marker.setLatLng([last_position.lat, last_position.lon]);
					updateDetectionPolygons(unitId, unitRecord.detectedUnits);
				}
			});
			return;
		}

		const startTime = performance.now();
		const duration = nextDelay;

		const startPositions = new Map<string, [number, number]>();
		Object.entries(unitRecords).forEach(([unitId, _unitRecord]) => {
			const marker = unitLayerMap.current.get(unitId);
			if (marker) {
				startPositions.set(unitId, [marker.getLatLng().lat, marker.getLatLng().lng]);
			}
		});

		const animateFrame = (now: number) => {
			const elapsed = now - startTime;
			const progress = Math.min(elapsed / duration, 1);

			Object.entries(unitRecords).forEach(([unitId, unitRecord]) => {
				const marker = unitLayerMap.current.get(unitId);
				const startPos = startPositions.get(unitId);
				
				if (marker && startPos) {
					const currentIndex = Math.round((unitRecord.trajectory.length - 1) * progress);
					const targetPos = unitRecord.trajectory[currentIndex];
					marker.setLatLng([targetPos.lat, targetPos.lon]);
					updateDetectionPolygons(unitId, unitRecord.detectedUnits);
				}
			});

			if (progress < 1) {
				animationRef.current = requestAnimationFrame(animateFrame);
			} else {
				animationRef.current = null;
			}
		};

		animationRef.current = requestAnimationFrame(animateFrame);
	};

	const updatePlacedUnits = (unitRecords: Record<string, UnitRecord>) => {
		setPlacedUnits((prev) =>
			prev.map((unit) => {
				const record = unitRecords[unit.id];
				if (!record) return unit;

				if (mode === 'recording') {
					const finishedIds = new Set(record.actions.filter(a => a.finished).map(a => a.id));

					return {
						...unit,
						position: record.trajectory[record.trajectory.length - 1],
						actions: unit.actions.map(a => ({
							...a,
							finished: finishedIds.has(a.id) ? true : a.finished
						}))
					};

				} else {
					return {
						...unit,
						position: record.trajectory[record.trajectory.length - 1],
						actions: record.actions,
					};
				}
			})
		);
	};

	const updateUnitsByTime = (time: number, animate: boolean, nextDelay: number) => {
		const record = simRecordRef.current.find((r) => 
			new Date(r.startDateTime).getTime() <= time && 
			time <= new Date(r.endDateTime).getTime()
		);

		if (record) {
			applyUnitStatus(record.unitRecords, animate, nextDelay);
		}
	};

	const fetchAndRecord = async (time: number, deltaTime: number, nextDelay: number) => {
		try {
			const response = await fetch('/api/simulate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sim_id: simUuid,
					current_time: time,
					delta_time: deltaTime,
					placed_units: placedUnitsRef.current,
				})
			});
			const result = await response.json();

			if (result.success && result.unitRecords) {
				setSimRecord((prev) => [...prev, result]);
				applyUnitStatus(result.unitRecords, true, nextDelay);
			} else {
				console.log(result.errors);
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
				left: 0, 
				width: '600px', 
				zIndex: 1000,
				fontSize: '0.8rem',
				borderTopRightRadius: '8px'
			}}
		>
			<div className="d-flex align-items-center gap-2">
				<div className="text-center mb-1 fw-bold text-light">
					{new Date(currentTime).toLocaleString()}
				</div>

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

				<div className="w-100" style={{ padding: '0 0px' }}>
					<Slider
						min={startTime}
						max={endTime}
						value={currentTime}
						onChange={(val) => {
							const time = val as number;
							setCurrentTime(time);
							updateUnitsByTime(time, false, 0);
						}}
						disabled={mode !== null}
						handleStyle={{
							height: 12,
							width: 12,
							marginTop: -4,
							backgroundColor: '#fff',
							border: '2px solid #0d6efd',
							zIndex: 2,
						}}
					/>
				</div>

				<div className="text-muted" style={{ minWidth: '50px', fontSize: '0.7rem' }}>
					{actualSpeed}x
				</div>

				{/* 倍速切り替え：いつでも操作可能 */}
				<select 
					className="form-select form-select-sm" 
					style={{ width: '100px' }}
					value={speed}
					onChange={(e) => setSpeed(Number(e.target.value))}
				>
					<option value="1">x1</option>
					<option value="2">x2</option>
					<option value="4">x4</option>
					<option value="8">x8</option>
					<option value="16">x16</option>
					<option value="32">x32</option>
					<option value="64">x64</option>
				</select>
			</div>
		</div>
	);
};