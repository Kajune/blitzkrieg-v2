import { useState } from 'react';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';

import { useMapEditor } from './components/MapEditor';
import { UnitEditor } from './components/UnitEditor';
import { RegionSettings } from './components/RegionSettings';

import './App.module.css';

function App() {
	const [showMenu, setShowMenu] = useState(false);
	const [isEditorOpen, setIsEditorOpen] = useState(false);
	const [isRegionOpen, setIsRegionOpen] = useState(false);
	const [showLabels, setShowLabels] = useState(true);
    
	const { 
		mapRef,
		elements, 
		setElements, 
		pendingElement, 
		startDrawing 
	} = useMapEditor(showLabels);

	return (
		<div data-bs-theme="dark" style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', backgroundColor: '#212529', color: '#fff' }}>
			<div ref={mapRef} style={{ width: '100%', height: '100%', zIndex: 1 }} />

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
					bottom: 20, 
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
						<button className="btn btn-outline-light text-start" onClick={() => { setIsEditorOpen(true); setShowMenu(false); }}>部隊編成</button>
						<button className="btn btn-outline-light text-start" onClick={() => { setIsRegionOpen(true); setShowMenu(false); }}>地域設定</button>
						<button className="btn btn-outline-light text-start">シミュレーション設定</button>
						<button className="btn btn-outline-light text-start">インポート</button>
						<button className="btn btn-outline-light text-start">エクスポート</button>
					</div>
				</div>
			</div>

			{showMenu && <div className="offcanvas-backdrop fade show" onClick={() => setShowMenu(false)} style={{ zIndex: 1040 }} />}

			<UnitEditor isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} />
			<RegionSettings 
				isOpen={isRegionOpen} 
				onClose={() => setIsRegionOpen(false)}
				elements={elements}
				setElements={setElements}
				onStartDrawing={startDrawing}
				drawingType={pendingElement?.type || null}
				drawingGeometry={pendingElement?.geometry || null}
			/>
		</div>
	);
}

export default App;