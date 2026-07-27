import json
import argparse
import glob
import msgspec

def load_data(args):
	"""各種JSONファイルを読み込む"""
	with open(args.units, 'r', encoding='utf-8') as f:
		units_data = json.load(f)
		
	vehicle_capacities = {}
	small_arms = set()
	
	# 可変長の装備ファイル群を読み込む
	for eq_path in args.equipments:
		with open(eq_path, 'r', encoding='utf-8') as f:
			eq_data = json.load(f)
			# 車両の乗車定員データを抽出
			for v in eq_data.get('vehicles', []):
				vehicle_capacities[v['name']] = v['personnel_capacity']
			# 小銃（SmallArm）の装備名リストを抽出
			for w in eq_data.get('weapons', []):
				if w.get('type') == 'SmallArm':
					small_arms.add(w['name'])
				
	return units_data, vehicle_capacities, small_arms

def check_and_fix_units():
	parser = argparse.ArgumentParser(description="部隊の乗車定員および小銃数チェック・修正プログラム")
	parser.add_argument('--units', type=str, default="../frontend/public/data/unitTemplates.json")
	parser.add_argument('--equipments', type=str, nargs='+', default=["data/equipments/equipments_jp.json", "data/equipments/equipments_ru.json"])
	args = parser.parse_args()

	units_data, vehicle_capacities, small_arms = load_data(args)
	
	# 全勢力（REDFOR, BLUFORなど）を走査
	for faction, units in units_data.items():
		print(f"\n--- 勢力: {faction} ---")
		for unit in units:
			personnel = unit.get('personnel', 0)
			equipments = unit.get('equipments', {})
			
			# 車両の総乗車定員を計算
			total_capacity = 0
			# 小銃の総数を計算
			total_small_arms = 0
			primary_small_arm = None # 調整用にメインで使用されている小銃を保持する候補
			max_arm_count = -1

			for eq_name, count in equipments.items():
				if eq_name in vehicle_capacities:
					total_capacity += vehicle_capacities[eq_name] * count
				if eq_name in small_arms:
					total_small_arms += count
					if count > max_arm_count:
						max_arm_count = count
						primary_small_arm = eq_name

			# 1. 乗車定員オーバーのチェック
			is_capacity_over = personnel > total_capacity
			# 2. 人員と小銃数の不一致チェック
			is_arms_mismatch = total_small_arms != personnel

			if is_capacity_over or is_arms_mismatch:
				print(f"\n[要確認] 部隊ID: {unit['id']} ({unit['name']})")
				if is_capacity_over:
					print(f"  - [定員オーバー] 部隊人員: {personnel} 人 / 車両総乗車定員: {total_capacity} 人 (不足: {personnel - total_capacity} 人)")
				if is_arms_mismatch:
					print(f"  - [小銃数不一致] 部隊人員: {personnel} 人 / 小銃総数: {total_small_arms} 丁 (差分: {abs(personnel - total_small_arms)})")
				
				choice = input("修正しますか？ 個別修正: [Y], 一括修正(定員を人員に合わせ、小銃数も人員に同期): [A], スキップ: [その他キー]: ").strip()
				
				if choice == 'Y':
					try:
						# 人員の修正
						if is_capacity_over:
							new_personnel = int(input(f"新しい人員数を入力してください (現在 {personnel}): "))
							unit['personnel'] = new_personnel
							personnel = new_personnel
						
						# 小銃数の修正（人員数に合わせる）
						if personnel != total_small_arms:
							sync_arms = input(f"小銃の総数({total_small_arms}丁)を現在の人员({personnel}人)に一致させますか？ [Y/N]: ").strip()
							if sync_arms.lower() == 'y':
								if primary_small_arm:
									# 最も多く持っている小銃に差分を反映、または単一の小銃に全数設定
									unit['equipments'][primary_small_arm] = personnel
									print(f"-> 主力小銃 '{primary_small_arm}' の数を {personnel} に設定しました。")
								else:
									# 小銃をまだ持っていない場合は、代表的な小銃名を聞くか新規追加
									new_arm = input("部隊に設定する小銃名を入力してください: ").strip()
									if new_arm:
										unit['equipments'][new_arm] = personnel
										print(f"-> '{new_arm}' を {personnel} 丁追加しました。")
						print(f"-> 部隊 {unit['id']} の個別修正を完了しました。")
					except ValueError:
						print("無効な入力です。スキップします。")
						
				elif choice == 'A':
					# 一括修正処理
					if is_capacity_over:
						unit['personnel'] = total_capacity
						personnel = total_capacity
						print(f"-> 【一括修正】部隊 {unit['id']} の人員を乗車定員上限の {total_capacity} に合わせました。")
					
					# 小銃数を人員数に一致させる
					if personnel != total_small_arms:
						if primary_small_arm:
							unit['equipments'][primary_small_arm] = personnel
						elif small_arms:
							# 該当リストから最初の小銃をデフォルトとして使う
							default_arm = list(small_arms)[0]
							unit['equipments'][default_arm] = personnel
							primary_small_arm = default_arm
						print(f"-> 【一括修正】小銃の総数を人員数 ({personnel}) に同期しました。")
				else:
					print("-> 修正をスキップしました。")

	# 修正後のデータを保存
	with open('units_fixed.json', 'w', encoding='utf-8') as f:
		json.dump(units_data, f, ensure_ascii=False, indent=2)
	print("\nすべてのチェックが完了しました。修正後のデータは 'units_fixed.json' に保存されました。")

if __name__ == '__main__':
	check_and_fix_units()