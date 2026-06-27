from flask import Flask, send_from_directory, jsonify, request
from typing import Dict, List, Optional
from dataclasses import asdict
import msgspec
import uuid, json
from models import SimSetting, SimRequest
from sim import Simulation


app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')

sim_instances : Dict[str, Simulation] = {}


@app.route('/')
def index():
	return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def static_proxy(path):
	return send_from_directory(app.static_folder, path)


@app.route('/api/register_simulation', methods=['POST'])
def register_simulation():
	try:
		config = msgspec.convert(request.json, SimSetting)
		sim_instance = Simulation(config)
		new_id = str(uuid.uuid4())
		sim_instances[new_id] = sim_instance
		return jsonify({"success": True, "uuid": new_id})
	except msgspec.ValidationError as e:
		return jsonify({"success": False, "errors": str(e)}), 400


@app.route('/api/simulate', methods=['POST'])
def simulate():
	try:
		sim_request = msgspec.convert(request.json, SimRequest)
	except msgspec.ValidationError as e:
		return jsonify({"success": False, "errors": str(e)}), 400

	if sim_request.sim_id is None or sim_request.sim_id not in sim_instances:
		return jsonify({"success": False, "errors": "Invalid Sim ID"}), 400

	sim_response = sim_instances[sim_request.sim_id].step(sim_request)

	return msgspec.json.encode(sim_response)


if __name__ == '__main__':
	app.run(port=5000, debug=False)