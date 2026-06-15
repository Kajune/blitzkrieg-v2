from flask import Flask, send_from_directory, jsonify, request
import uuid, json

app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')

simulation_settings = {
}


@app.route('/')
def index():
	return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def static_proxy(path):
	return send_from_directory(app.static_folder, path)


@app.route('/api/register_simulation', methods=['POST'])
def register_simulation():
	data = request.json
	new_id = str(uuid.uuid4())
	simulation_settings[new_id] = data	
	return jsonify({"success": True, "uuid": new_id})


@app.route('/api/simulate', methods=['POST'])
def simulate():
	data = request.json

	sim_id = data.get("simUuid")
	current_time = data.get("time")
	delta_time = data.get("deltaTime")
	placed_units = data.get("placedUnits", [])

	print(current_time, delta_time)

	if sim_id is None:
		return jsonify({"success": False, "message": "Invalid Sim ID"}), 400

	updated_units = {}
	for unit in placed_units:
		unit_id = unit.get("id")
		pos = unit.get("position", {"lat": 35.0, "lon": 135.0})
		
		new_lon = pos["lon"] + 0.0001 * delta_time / 1000
		new_lat = pos["lat"]
		
		updated_units[unit_id] = {
			"position": {"lat": new_lat, "lon": new_lon}
		}

	return jsonify({
		"success": True,
		"startDateTime": current_time,
		"endDateTime": current_time + delta_time,
		"units": updated_units
	})

if __name__ == '__main__':
	app.run(port=5000, debug=True)