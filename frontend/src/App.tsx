import { useState } from 'react';

import { AppProvider, useAppStore } from './contexts/AppContext';
import { useMapEditor } from './components/MapEditor';
import { UnitEditor } from './components/UnitEditor';
import { RegionSettings } from './components/RegionSettings';
import { UnitPlacement } from './components/UnitPlacement';
import { SimSetting } from './components/SimSetting';
import { UnitDetailPane } from './components/UnitDetailPane';
import { SimControl } from './components/SimControl';

import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './App.module.css';


function AppContent() {
	const [showMenu, setShowMenu] = useState(false);
	const [isUnitEditorOpen, setIsUnitEditorOpen] = useState(false);
	const [isRegionEditorOpen, setIsRegionEditorOpen] = useState(false);
	const [isUnitPlacementOpen, setIsUnitPlacementOpen] = useState(false);
	const [isSimSettingOpen, setIsSimSettingOpen] = useState(false);
	const [showLabels, setShowLabels] = useState(true);
	const [showDetectionPolygons, setShowDetectionPolygons] = useState(true);
	const [showMobilityMap, setShowMobilityMap] = useState(false);

	const { 
		simConfig, setSimConfig, 
		units, setUnits,
		placedUnits, setPlacedUnits,
		mapElements, setMapElements,
		simRecord, setSimRecord,
		setSimUuid,
	} = useAppStore();

	const { 
		clearMap,
		setShouldFocusAfterLoad,
		mapRef,
		pendingElement,
		selectedUnitId,
		setSelectedUnitId,
		startDrawing,
		handleDragOver,
		handleDrop,
		removeUnitFromMap,
		updateDetectionAttackPolygons,
		deployChildren,
		renderMarkers,
		renderElements,
		renderMobilityLayer,
	} = useMapEditor(showLabels, showDetectionPolygons, showMobilityMap, isUnitPlacementOpen);

	const exportData = () => {
		const payload = {
			simConfig,
			units,
			placedUnits,
			mapElements,
			simRecord,
		};

		const dataStr = JSON.stringify(payload, null, 2);
		const blob = new Blob([dataStr], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const a = document.createElement('a');
		a.href = url;
		a.download = `blitzkrieg-data-${timestamp}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (e: ProgressEvent<FileReader>) => {
			const content = e.target?.result;
			if (typeof content !== 'string') return;

			try {
				const data = JSON.parse(content);

				clearMap();

				if (data.simConfig) setSimConfig(data.simConfig);
				if (data.units) setUnits(data.units);
				if (data.placedUnits) setPlacedUnits(data.placedUnits);
				if (data.mapElements) setMapElements(data.mapElements);
				if (data.simRecord) setSimRecord(data.simRecord);
				setSimUuid(null);

				setShowMenu(false);
				setShouldFocusAfterLoad(true);
			} catch (error) {
				console.error(error);
				alert('ファイルの形式が正しくないか、読み込みに失敗しました。');
			}
		};
		reader.readAsText(file);
		event.target.value = '';
	};

	return (
		<div data-bs-theme="dark" style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', backgroundColor: '#212529', color: '#fff' }}>
			<div ref={mapRef} 
				style={{ width: '100%', height: '100%', zIndex: 1 }} 
				onDragOver={handleDragOver} 
				onDrop={handleDrop}
			>
				{renderMobilityLayer()}
				{renderElements()}
				{renderMarkers()}
			</div>

			<button 
				className="btn btn-secondary position-absolute"
				style={{ 
					top: 100,
					left: 0, 
					zIndex: 1000,
					borderRadius: '0 20px 20px 0',
					padding: '10px 15px',
					fontWeight: 'bold'
				}}
				onClick={() => setShowMenu(true)}
			>
				&#9654;
			</button>

			<button 
				className="btn btn-secondary btn-sm position-absolute"
				style={{ 
					bottom: 80, 
					left: 10, 
					zIndex: 1000,
					borderRadius: '20px',
					padding: '5px 10px',
					fontSize: '0.8rem'
				}}
				onClick={() => setShowLabels(!showLabels)}
			>
				{showLabels ? 'ラベル非表示' : 'ラベル表示'}
			</button>

			<button 
				className="btn btn-secondary btn-sm position-absolute"
				style={{ 
					bottom: 80, 
					left: 120, 
					zIndex: 1000,
					borderRadius: '20px',
					padding: '5px 10px',
					fontSize: '0.8rem'
				}}
				onClick={() => setShowDetectionPolygons(!showDetectionPolygons)}
			>
				{showDetectionPolygons ? '探知非表示' : '探知表示'}
			</button>

			<button 
				className="btn btn-secondary btn-sm position-absolute"
				style={{ 
					bottom: 80, 
					left: 220, 
					zIndex: 1000,
					borderRadius: '20px',
					padding: '5px 10px',
					fontSize: '0.8rem'
				}}
				onClick={() => setShowMobilityMap(!showMobilityMap)}
			>
				{showMobilityMap ? '機動障害図非表示' : '機動障害図表示'}
			</button>

			<div 
				className={`offcanvas offcanvas-start ${showMenu ? 'show' : ''}`} 
				style={{ visibility: showMenu ? 'visible' : 'hidden', zIndex: 1050, backgroundColor: '#212529' }}
			>
				<div className="offcanvas-header">
					<h5 className="offcanvas-title">メニュー</h5>
					<button className="btn-close" onClick={() => setShowMenu(false)}></button>
				</div>
				<div className="offcanvas-body">
					<h4 className="mb-4">blitzkrieg-v2</h4>
					<hr />
					<div className="d-grid gap-2">
						<button className="btn btn-outline-light text-start" onClick={() => { setIsUnitEditorOpen(true); setShowMenu(false); }}>部隊編成</button>
						<button className="btn btn-outline-light text-start" onClick={() => { setIsRegionEditorOpen(true); setShowMenu(false); }}>地域設定</button>
						<button className="btn btn-outline-light text-start" onClick={() => { setIsUnitPlacementOpen(true); setShowMenu(false); }}>部隊配置</button>
						<button className="btn btn-outline-light text-start" onClick={() => { setIsSimSettingOpen(true); setShowMenu(false); }}>シミュレーション設定</button>
						<button className="btn btn-outline-light text-start" onClick={exportData}>
							エクスポート
						</button>
						<label className="btn btn-outline-light text-start">
							インポート
							<input type="file" accept=".json" onChange={importData} style={{ display: 'none' }} />
						</label>
					</div>
				</div>
			</div>

			<UnitDetailPane 
				unitId={selectedUnitId} 
				onClose={() => setSelectedUnitId(null)} 
				onDelete={(unit) => {
					removeUnitFromMap(unit.id);
					setSelectedUnitId(null);
				}}
				onDeployChildren={(unit) => {
					return deployChildren(unit);
				}}
			/>

			{showMenu && <div className="offcanvas-backdrop fade show" onClick={() => setShowMenu(false)} style={{ zIndex: 1040 }} />}

			<UnitEditor 
				isOpen={isUnitEditorOpen} 
				onClose={() => setIsUnitEditorOpen(false)}
				removeUnitFromMap={removeUnitFromMap}
			/>
			<RegionSettings 
				isOpen={isRegionEditorOpen} 
				onClose={() => setIsRegionEditorOpen(false)}
				onStartDrawing={startDrawing}
				drawingElement={pendingElement}
			/>
			<UnitPlacement 
				isOpen={isUnitPlacementOpen} 
				onClose={() => setIsUnitPlacementOpen(false)}
			/>
			<SimSetting 
				isOpen={isSimSettingOpen} 
				onClose={() => setIsSimSettingOpen(false)}
			/>

			<SimControl
				showMenu={showMenu}
				updateDetectionAttackPolygons={updateDetectionAttackPolygons}
			/>
		</div>
	);
}

function App() {
	return (
		<AppProvider>
			<AppContent />
		</AppProvider>
	);
}

export default App;