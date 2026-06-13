import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';

import { UnitEditor } from './components/UnitEditor';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

L.Marker.prototype.options.icon = L.icon({
	iconUrl: icon,
	shadowUrl: iconShadow,
	iconSize: [25, 41],
	iconAnchor: [12, 41],
});

function App() {
	const mapRef = useRef<HTMLDivElement>(null);
	const [data, setData] = useState('');
	const [showMenu, setShowMenu] = useState(false);
	const [isEditorOpen, setIsEditorOpen] = useState(false);

	useEffect(() => {
		fetch('/api/data')
			.then((res) => res.json())
			.then((json) => setData(json.message));
	}, []);

	useEffect(() => {
		if (!mapRef.current) return;
		const map = L.map(mapRef.current).setView([35.6812, 139.7671], 13);
//		L.tileLayer('http://localhost:3000/stamen_terrain/{z}/{x}/{y}.png').addTo(map);
		L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png').addTo(map);
		return () => { map.remove(); };
	}, []);

	const toggleTheme = () => {
		document.documentElement.classList.toggle('dark');
	};

	return (
		<div data-bs-theme="dark" style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', backgroundColor: '#212529', color: '#fff' }}>
			<div ref={mapRef} style={{ width: '100%', height: '100%', zIndex: 1 }} />

			<button 
				className="btn btn-primary position-absolute"
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
						<button 
							className="btn btn-outline-light text-start" 
							onClick={() => {
								setIsEditorOpen(true);
								setShowMenu(false);
							}}
						>
							部隊編成
						</button>
						<button className="btn btn-outline-light text-start">地域設定</button>
						<button className="btn btn-outline-light text-start">シミュレーション設定</button>
						<button className="btn btn-outline-light text-start">インポート</button>
						<button className="btn btn-outline-light text-start">エクスポート</button>
					</div>
				</div>
			</div>

			{showMenu && (
				<div className="offcanvas-backdrop fade show" onClick={() => setShowMenu(false)} style={{ zIndex: 1040 }} />
			)}

			<UnitEditor isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} />
			
			<button onClick={() => setIsEditorOpen(true)}>部隊編成</button>
		</div>
	);
}

export default App;