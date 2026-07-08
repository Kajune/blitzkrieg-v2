import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../contexts/AppContext';
import type { UnitRecord, PersonnelEquipmentsRecord } from '../types/simTypes';
import type { Unit, PlacedUnit, Force, DisplayForce, DetectLog, AttackLog } from '../types/unitTypes';
import { FORCES, DISPLAY_FORCES } from '../types/unitTypes';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';

type SimMode = 'playing' | 'recording' | null;

export const SimControl = ({ 
	showMenu,
	updateDetectionAttackPolygons,
}: { 
	showMenu: boolean,
	updateDetectionAttackPolygons: (unitId: string, detectedUnits: DetectLog[], attackingUnits: AttackLog[]) => void,
}) => {
	const {
		simUuid,
		simConfig,
		placedUnits, 
		setPlacedUnits, 
		simRecord, 
		setSimRecord,
		unitLayerMap,
		setSimDatalink,
		displayForce,
		setDisplayForce,
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
			const resetDatalink = FORCES.reduce((acc, force) => {
				acc[force] = [];
				return acc;
			}, {} as Record<Force, string[]>);
			setSimDatalink(resetDatalink);

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
		const newDatalink = FORCES.reduce((acc, force) => {
			acc[force] = [];
			return acc;
		}, {} as Record<Force, string[]>);

		Object.entries(unitRecords).forEach(([unitId, record]) => {
			const unit = placedUnitsRef.current.find(u => u.id === unitId);
			if (unit) {
				record.detectedUnits.forEach(log => {
					if (!newDatalink[unit.force].includes(log.unitId)) {
						newDatalink[unit.force].push(log.unitId);
					}
				});
			}
		});
		setSimDatalink(newDatalink);

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
					updateDetectionAttackPolygons(unitId, unitRecord.detectedUnits, unitRecord.attackingUnits);
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
			const progress = Math.max(Math.min(elapsed / duration, 1), 0);

			Object.entries(unitRecords).forEach(([unitId, unitRecord]) => {
				const marker = unitLayerMap.current.get(unitId);
				const startPos = startPositions.get(unitId);
				
				if (marker && startPos) {
					const trajectory = unitRecord.trajectory;
					// 全体の中での現在の位置を浮動小数点数で取得
					const totalSteps = trajectory.length - 1;
					const floatIndex = totalSteps * progress;
					
					// 前後のインデックスを特定
					const index1 = Math.floor(floatIndex);
					const index2 = Math.min(index1 + 1, totalSteps);
					
					// 2点間の進行度 (0.0 ～ 1.0)
					const lerpProgress = floatIndex - index1;
					
					const pos1 = trajectory[index1];
					const pos2 = trajectory[index2];

					// 線形補間計算
					const lat = pos1.lat + (pos2.lat - pos1.lat) * lerpProgress;
					const lon = pos1.lon + (pos2.lon - pos1.lon) * lerpProgress;
					
					marker.setLatLng([lat, lon]);
					updateDetectionAttackPolygons(unitId, unitRecord.detectedUnits, unitRecord.attackingUnits);
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
		// 再帰的にUnitオブジェクトを更新する関数
		const updateUnitRecursive = (unit: Unit, record: PersonnelEquipmentsRecord): Unit => {
			return {
				...unit,
				current_personnel: record.current_personnel,
				current_equipments: { ...record.current_equipments },
				lower_units: unit.lower_units.map(subUnit => {
					const subRecord = record.lower_units[subUnit.id];
					// lower_unitsが存在しない場合はそのまま返すか、適宜ハンドリング
					return subRecord ? updateUnitRecursive(subUnit, subRecord) : subUnit;
				})
			};
		};

		setPlacedUnits((prev) =>
			prev.map((unit) => {
				const record = unitRecords[unit.id];
				if (!record) return unit;

				// ベースの更新
				let updatedUnit = {
					...unit,
					position: record.trajectory[record.trajectory.length - 1],
					currentMoveSpeed: record.currentMoveSpeed,
					currentMoveMode: record.currentMoveMode,
					currentFireMode: record.currentFireMode,
					currentTargetPos: record.currentTargetPos,
					currentPath: record.currentPath,
					detectedUnits: record.detectedUnits,
					attackingUnits: record.attackingUnits,
					suppressionRate: record.suppressionRate,
				};

				// 人員・装備を再帰的に反映
				updatedUnit = updateUnitRecursive(updatedUnit, record.personnelEquipments) as PlacedUnit;

				// actionsの処理
				if (mode === 'recording') {
					const finishedIds = new Set(record.actions.filter(a => a.finished).map(a => a.id));
					return {
						...updatedUnit,
						actions: unit.actions.map(a => ({
							...a,
							finished: finishedIds.has(a.id) ? true : a.finished
						})),
					};
				} else {
					return {
						...updatedUnit,
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
				width: '720px', 
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

				<select 
					className="form-select form-select-sm" 
					style={{ width: '120px' }}
					value={displayForce}
					onChange={(e) => setDisplayForce(e.target.value as DisplayForce)}
				>
					{DISPLAY_FORCES.map((force) => (
						<option key={force} value={force}>
							{force}
						</option>
					))}
				</select>
			</div>
		</div>
	);
};