import os, atexit
from dotenv import load_dotenv
import psycopg2
from psycopg2 import pool
from shapely import wkb
from shapely.geometry import shape, GeometryCollection
from models import *
from contextlib import contextmanager



load_dotenv(os.path.join(os.path.dirname(__file__), '..', 'geo-server', '.env'))


class PostGIS:
	def __init__(self):
		try:
			self._pool = psycopg2.pool.SimpleConnectionPool(
				minconn=1,
				maxconn=10,
				dbname=os.getenv("POSTGRES_DB"),
				user=os.getenv("POSTGRES_USER"),
				password=os.getenv("POSTGRES_PASSWORD"),
				host=os.getenv("POSTGRES_HOST", "localhost")
			)
		except Exception as e:
			print(f"データベース接続プールの作成に失敗しました: {e}")
			raise

		atexit.register(self.close_all)


	@contextmanager
	def get_cursor(self):
		conn = self._pool.getconn()
		try:
			with conn.cursor() as cur:
				yield cur
			conn.commit()
		except Exception as e:
			conn.rollback()
			raise e
		finally:
			self._pool.putconn(conn)


	def close_all(self):
		print("コネクションプールを解放しています...")
		if hasattr(self, '_pool') and self._pool:
			self._pool.closeall()
			print("すべての接続を閉じました。")


	def load_dem(self, geom : shape) -> GeoMesh:
		wkt = geom.wkt
		dem_table = os.getenv("DEM_TABLE")
		epsg = os.getenv("DEM_EPSG")

		query = f"""
		WITH env AS (
			SELECT ST_Envelope(ST_GeomFromText('{wkt}', {epsg})) AS geom_env
		)
		SELECT 
			(ST_DumpValues(ST_Clip(rast, env.geom_env))).valarray,
			ST_XMin(env.geom_env) as min_lon,
			ST_YMin(env.geom_env) as min_lat,
			ST_XMax(env.geom_env) as max_lon,
			ST_YMax(env.geom_env) as max_lat
		FROM {dem_table}, env
		WHERE ST_Intersects(rast, env.geom_env);
		"""

		with self.get_cursor() as cur:
			cur.execute(query)
			result = cur.fetchone()
			
			if not result:
				return None

			return GeoMesh(
				data=np.array(result[0]), 
				left_bottom=GeoLocation(lon=result[1], lat=result[2]),
				right_top=GeoLocation(lon=result[3], lat=result[4]),
				epsg=epsg
			)


	def load_osm_data(self, table_name: str, geom: shape, condition: str = "") -> GeometryCollection:
		wkt = geom.wkt
		epsg = os.getenv("DEM_EPSG")
		
		query = f"""
		SELECT ST_AsBinary(ST_Transform(way, {epsg})) 
			FROM {table_name} 
			WHERE way && ST_Transform(ST_GeomFromText('{wkt}', {epsg}), 3857)
			AND (ST_Intersects(way, ST_Transform(ST_GeomFromText('{wkt}', {epsg}), 3857)))
		"""

		if condition:
			query += f" AND ({condition})"

		geometries = []
		with self.get_cursor() as cur:
			cur.execute(query)
			rows = cur.fetchall()

			for row in rows:
				if row[0]:
					data = row[0].tobytes() if isinstance(row[0], memoryview) else row[0]
					geometries.append(wkb.loads(data))
		
		return GeometryCollection(geometries)
