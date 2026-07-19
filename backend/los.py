import cupy as cp
import numpy as np
import time
import cv2

# GPU側で実行されるCUDA C++の処理
# 💡 出力(out_params)を float32 の mva_maps (Minimum Visible Altitude) に変更
multi_mva_kernel = cp.ElementwiseKernel(
	in_params='''
		raw float32 dem, 
		int32 width, int32 height, 
		float32 res_x, float32 res_y,
		raw float32 view_x, raw float32 view_y, raw float32 view_z,
		raw float32 max_dist
	''',
	out_params='float32 mva_maps',
	operation='''
		int pixels_per_map = width * height;
		int v_idx = i / pixels_per_map;
		int pixel_idx = i % pixels_per_map;
		
		int c = pixel_idx % width;
		int r = pixel_idx / width;

		float v_x = view_x[v_idx];
		float v_y = view_y[v_idx];
		float v_z = view_z[v_idx];
		float m_dist = max_dist[v_idx];

		float target_x = c * res_x;
		float target_y = r * res_y;
		float dx = target_x - v_x;
		float dy = target_y - v_y;
		float dist_2d = sqrtf(dx * dx + dy * dy);

		if (dist_2d > m_dist) {
			mva_maps = -1.0f;
			return;
		}

		float target_z = dem[pixel_idx];
		if (c == (int)(v_x / res_x) && r == (int)(v_y / res_y)) {
			mva_maps = target_z;
			return;
		}

		float steps_f = ceilf(dist_2d / (res_x < res_y ? res_x : res_y));
		int steps = (int)steps_f;
		if (steps < 1) steps = 1;

		float step_x = dx / steps_f;
		float step_y = dy / steps_f;

		float max_required_slope = -1e10f;
		bool blocked = false;

		for (int s = 1; s < steps; ++s) {
			float curr_x = v_x + step_x * s;
			float curr_y = v_y + step_y * s;

			int curr_c = (int)roundf(curr_x / res_x);
			int curr_r = (int)roundf(curr_y / res_y);

			if (curr_c >= 0 && curr_c < width && curr_r >= 0 && curr_r < height) {
				int idx = curr_r * width + curr_c;
				float obs_z = dem[idx];

				float t = (float)s / steps_f;
				
				float req_step_z = (obs_z - v_z) / s;
				if (req_step_z > max_required_slope) {
					max_required_slope = req_step_z;
				}
			}
		}

		float min_visible_z = v_z + max_required_slope * steps_f;

		if (min_visible_z < target_z) {
			mva_maps = target_z;
		} else {
			mva_maps = min_visible_z;
		}
	''',
	name='multi_mva_analysis_kernel'
)


pair_los_kernel = cp.ElementwiseKernel(
	in_params='''
		raw float32 dem,
		int32 width, int32 height,
		float32 res_x, float32 res_y,
		raw float32 p1, raw float32 p2
	''',
	out_params='uint8 pair_results',
	operation='''
		int p_idx = i;

		float x1 = p1[p_idx * 3 + 0];
		float y1 = p1[p_idx * 3 + 1];
		float z1 = p1[p_idx * 3 + 2];

		float x2 = p2[p_idx * 3 + 0];
		float y2 = p2[p_idx * 3 + 1];
		float z2 = p2[p_idx * 3 + 2];

		if ((int)(x1 / res_x) == (int)(x2 / res_x) && (int)(y1 / res_y) == (int)(y2 / res_y)) {
			pair_results = 1;
			return;
		}

		float dx = x2 - x1;
		float dy = y2 - y1;
		float dist_2d = sqrtf(dx * dx + dy * dy);

		float steps_f = ceilf(dist_2d / (res_x < res_y ? res_x : res_y));
		int steps = (int)steps_f;
		if (steps < 1) steps = 1;

		float step_x = dx / steps_f;
		float step_y = dy / steps_f;
		float step_z = (z2 - z1) / steps_f;

		bool visible = true;
		for (int s = 1; s < steps; ++s) {
			float curr_x = x1 + step_x * s;
			float curr_y = y1 + step_y * s;
			float curr_z = z1 + step_z * s;

			int curr_c = (int)roundf(curr_x / res_x);
			int curr_r = (int)roundf(curr_y / res_y);

			if (curr_c >= 0 && curr_c < width && curr_r >= 0 && curr_r < height) {
				int idx = curr_r * width + curr_c;
				if (curr_z < dem[idx]) {
					visible = false;
					break;
				}
			}
		}

		pair_results = visible ? 1 : 0;
	''',
	name='pair_los_analysis_kernel'
)


def _compute_multi_mva_maps(dem_gpu, res_x, res_y, viewers_list):
	height, width = dem_gpu.shape
	num_viewers = len(viewers_list)
	
	viewers_arr = np.array(viewers_list, dtype=np.float32)
	vx_np = viewers_arr[:, 0]
	vy_np = viewers_arr[:, 1]
	vz_np = viewers_arr[:, 2]
	md_np = viewers_arr[:, 3]
	
	vx_gpu = cp.asarray(vx_np, dtype=cp.float32)
	vy_gpu = cp.asarray(vy_np, dtype=cp.float32)
	vz_gpu = cp.asarray(vz_np, dtype=cp.float32)
	md_gpu = cp.asarray(md_np, dtype=cp.float32)
	
	# 出力配列の型を float32 に変更
	mva_maps_gpu = cp.zeros((num_viewers, height, width), dtype=cp.float32)
	
	multi_mva_kernel(
		dem_gpu, 
		width, height, 
		res_x, res_y, 
		vx_gpu, vy_gpu, vz_gpu, md_gpu,
		mva_maps_gpu
	)
	
	return cp.asnumpy(mva_maps_gpu)


# 初期コンパイル
_compute_multi_mva_maps(cp.asarray(np.zeros((10, 10), dtype=np.float32)), 1, 1, [[0,0,0,1]])


def _compute_pairs_los(dem_gpu, res_x, res_y, pairs_p1, pairs_p2):
	"""
	pairs_p1, pairs_p2: それぞれ形状が (N, 3) の配列。 [[x, y, z], ...]
	"""
	height, width = dem_gpu.shape
	num_pairs = len(pairs_p1)

	p1_gpu = cp.asarray(pairs_p1, dtype=cp.float32)
	p2_gpu = cp.asarray(pairs_p2, dtype=cp.float32)
	
	height, width = dem_gpu.shape
	results_gpu = cp.zeros(len(pairs_p1), dtype=np.uint8)

	pair_los_kernel(
		dem_gpu,
		width, height,
		res_x, res_y,
		p1_gpu, p2_gpu,
		results_gpu
	)

	return cp.asnumpy(results_gpu)


# 初期コンパイル
_compute_pairs_los(cp.asarray(np.zeros((10, 10), dtype=np.float32)), 1, 1, [[0,0,0]], [[1,1,1]])


class LOSCalculator:
	def __init__(self, dem_np, res_x, res_y):
		self.dem_gpu = cp.asarray(dem_np)
		self.res_x = res_x
		self.res_y = res_y


	def compute_pairs_los(self, pairs_p1, pairs_p2):
		return _compute_pairs_los(self.dem_gpu, self.res_x, self.res_y, pairs_p1, pairs_p2)


	def compute_multi_mva_maps(self, viewers_list):
		return _compute_multi_mva_maps(self.dem_gpu, self.res_x, self.res_y, viewers_list)



def generate_simple_bumps_dem(height, width, max_height=50.0):
	x = np.linspace(0, 3 * np.pi, width)
	y = np.linspace(0, 2 * np.pi, height)
	X, Y = np.meshgrid(x, y)
	dem = (np.sin(X) * np.cos(Y))
	dem = np.clip(dem, 0, None) * max_height
	return dem.astype(np.float32)

if __name__ == "__main__":
	h, w = 1000, 1000
	resolution_x = 5.0
	resolution_y = 5.0
	
	test_dem = generate_simple_bumps_dem(h, w, max_height=40.0)

	# 視点をランダムに10個生成
	num_random_viewers = 10
	np.random.seed(42)
	
	random_viewers = []
	for _ in range(num_random_viewers):
		rx = np.random.uniform(0, w * resolution_x)
		ry = np.random.uniform(0, h * resolution_y)
		
		c_idx = max(0, min(w - 1, int(rx / resolution_x)))
		r_idx = max(0, min(h - 1, int(ry / resolution_y)))
		ground_z = test_dem[r_idx, c_idx]
		
		rz = ground_z + 2.0  # 地上高2m
		rmax = np.random.uniform(500.0, 2000.0)
		random_viewers.append((rx, ry, rz, rmax))

	# GPUでのMVA計算
	print(f"GPUでの複数MVA（最小可視高度）一括計算を開始...")
	start_time = time.time()
	for i in range(10):
		result_maps = _compute_multi_mva_maps(test_dem, resolution_x, resolution_y, random_viewers)
	print(f"計算完了！ 処理時間: {(time.time() - start_time) / 10:.4f} 秒")

	# 💡 可視化処理（今回は「地面からの必要高度」を色分けしてみる）
	combined_image = np.zeros((h, w, 3), dtype=np.float32)
	
	for idx in range(num_random_viewers):
		color = np.random.uniform(0.5, 1.0, size=3)
		
		# 視界内で、かつ計算された必要な高さ(MVA)を取得
		mva_map = result_maps[idx]
		valid_mask = mva_map >= 0.0
		
		# 地面から追加で何メートル必要か（比高）を計算
		required_clearance = np.zeros_like(mva_map)
		required_clearance[valid_mask] = mva_map[valid_mask] - test_dem[valid_mask]
		
		# 💡 すでに地面で見えている場所（追加高度 0m）だけを光らせるマスク
		mask = (valid_mask) & (required_clearance <= 0.1)
		
		color_mask = np.zeros_like(combined_image)
		color_mask[mask] = color
		combined_image = cv2.add(combined_image, color_mask)
		
		v_c = int(random_viewers[idx][0] / resolution_x)
		v_r = int(random_viewers[idx][1] / resolution_y)
		if 0 <= v_c < w and 0 <= v_r < h:
			cv2.circle(combined_image, (v_c, v_r), 3, (1, 1, 1), -1)

	output_filename = "combined_complex_mva.png"
	cv2.imwrite(output_filename, combined_image / np.max(combined_image) * 255)
	print(f"可視マップのシミュレーション画像を {output_filename} に保存したよ！")
	
	# 💡 特定の遮蔽点（山の裏など）のデータ数値を確認してみる
	print(f"\n--- データサンプル（視点0） ---")
	print(f"範囲外マスの値（期待値 -1.0）: {result_maps[0, 0, 0]}")
	print(f"遮蔽されておらず、地面のまま見えているマスの絶対標高: {result_maps[0, 500, 500]:.2f} m")


	# --- 💡 新機能：大量のランダムペアの生成と見通し計算 ---
	num_pairs = 200  # 200個のペアを一括計算させてみる
	np.random.seed(123)

	pairs_p1 = []
	pairs_p2 = []

	for _ in range(num_pairs):
		# 点1
		x1 = np.random.uniform(0, w * resolution_x)
		y1 = np.random.uniform(0, h * resolution_y)
		z1 = test_dem[max(0, min(h-1, int(y1/resolution_y))), max(0, min(w-1, int(x1/resolution_x)))] + 2.0 # 地上2m
		# 点2
		x2 = np.random.uniform(0, w * resolution_x)
		y2 = np.random.uniform(0, h * resolution_y)
		z2 = test_dem[max(0, min(h-1, int(y2/resolution_y))), max(0, min(w-1, int(x2/resolution_x)))] + 2.0 # 地上2m

		pairs_p1.append([x1, y1, z1])
		pairs_p2.append([x2, y2, z2])

	print(f"GPUでの {num_pairs} 組の2点間LOS一括判定を開始...")
	start_time = time.time()
	# 100回ループして速度ベンチマーク
	for _ in range(100):
		pair_results = _compute_pairs_los(test_dem, resolution_x, resolution_y, pairs_p1, pairs_p2)
	print(f"ペア判定計算完了！ 1回あたりの平均処理時間: {(time.time() - start_time) / 100:.5f} 秒")

	# --- 💡 新機能：新たな可視化処理（線の描画） ---
	# ベースとして白黒の地形背景画像を作る
	dem_normalized = cv2.normalize(test_dem, None, 0, 150, cv2.NORM_MINMAX).astype(np.uint8) # 線が見やすいように少し暗めにする
	vis_image = cv2.cvtColor(dem_normalized, cv2.COLOR_GRAY2BGR)

	for idx in range(num_pairs):
		# ピクセル座標に変換
		c1 = int(pairs_p1[idx][0] / resolution_x)
		r1 = int(pairs_p1[idx][1] / resolution_y)
		c2 = int(pairs_p2[idx][0] / resolution_x)
		r2 = int(pairs_p2[idx][1] / resolution_y)

		# 見えているなら緑 (0, 255, 0)、遮られているなら赤 (0, 0, 255)
		if pair_results[idx] == 1:
			color = (0, 255, 0) # 緑
			thickness = 1
		else:
			color = (0, 0, 255) # 赤
			thickness = 1

		# 2点間を結ぶ線を描画
		cv2.line(vis_image, (c1, r1), (c2, r2), color, thickness)
		# 端点に小さなドットを打つ
		cv2.circle(vis_image, (c1, r1), 2, (255, 255, 255), -1)
		cv2.circle(vis_image, (c2, r2), 2, (255, 255, 255), -1)

	output_filename = "pairs_los_visualization.png"
	cv2.imwrite(output_filename, vis_image)
	print(f"2点間見通しを線で描画した新しい画像を {output_filename} に保存したよ！")
