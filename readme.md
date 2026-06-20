# blitzkrieg-v2

## 概要
戦術レベルの陸上戦闘のシミュレーション

## 構築手順
1. PostGISサーバの構築
下記からDEMとosm.pbfをダウンロードし、それぞれ`geo-server/dem`と`geo-server/osm`以下に配置
ALOSはzipを解凍して、`geo-server/dem/N020E120_N025E125/ALPSMLC30_N020E121_DSM.tif`のようになっていることを期待
- ALOS (https://www.eorc.jaxa.jp/ALOS/jp/index_j.htm)
- OSM (https://download.geofabrik.de/asia.html)

その後、以下を実行
```
cd geo-server
cp .env-sample .env 	# .envを編集
docker compose up -d
chmod +x *.sh
./import_dem.sh 		# 数時間かかる
./import_osm.sh 		# 丸一日かかる
```

2. フロントエンドのビルド (省略可)
```
cd frontend
npm run build
cd ..
```

3. サーバの立ち上げ
```
cd backend
python3 app.py
```
