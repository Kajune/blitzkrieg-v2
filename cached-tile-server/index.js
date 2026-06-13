const express = require('express');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const app = express();
const CACHE_DIR = path.join(__dirname, 'tile_cache');
const UPSTREAM = 'https://tiles.stadiamaps.com/tiles';
const OFFLINE_MODE = false;

fs.ensureDirSync(CACHE_DIR);

app.get('/:style/:z/:x/:y.png', async (req, res) => {
	const { style, z, x, y } = req.params;
	const tilePath = path.join(CACHE_DIR, `${style}_${z}_${x}_${y}.png`);
	const tileUrl = `${UPSTREAM}/${style}/${z}/${x}/${y}.png`;

	try {
		if (OFFLINE_MODE) {
			throw new Error("");
		}
		await axios.get('https://8.8.8.8', { timeout: 2000 });

		const response = await axios.get(tileUrl, {
			responseType: 'arraybuffer',
			headers: {
				'Referer': 'https://tiles.stadiamaps.com/', 
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.0.0 Safari/537.36'
			}
		});
		const newBuffer = Buffer.from(response.data);
		const newHash = crypto.createHash('md5').update(newBuffer).digest('hex');

		let cacheHash = '';
		if (await fs.pathExists(tilePath)) {
			const cacheBuffer = await fs.readFile(tilePath);
			cacheHash = crypto.createHash('md5').update(cacheBuffer).digest('hex');
		}

		if (newHash !== cacheHash) {
			await fs.writeFile(tilePath, newBuffer);
			console.log(`Updated cache: ${tilePath}`);
		}

		res.set('Content-Type', 'image/png');
		res.send(newBuffer);

	} catch (err) {
		if (await fs.pathExists(tilePath)) {
			res.set('Content-Type', 'image/png');
			res.sendFile(tilePath);
		} else {
			res.status(404).send('Tile not found in cache');
		}
	}
});

app.listen(3000, () => console.log('Proxy server running on http://localhost:3000'));