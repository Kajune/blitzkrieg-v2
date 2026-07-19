from flask import Flask, send_from_directory, jsonify, request
from typing import Dict, List, Optional
from dataclasses import asdict
import msgspec
import uuid, json
from models import SimSetting, SimRequest, UnitDeploymentRequest, PlacedUnit
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


@app.route('/api/mobility_map', methods=['GET'])
def get_mobility_map():
	try:
		sim_id = request.args.get("sim_id")

		if sim_id is None or sim_id not in sim_instances:
			return jsonify({"success": False, "errors": "Invalid Sim ID"}), 400

		sim_instance = sim_instances[sim_id]
		mobility_map = sim_instance.map.get_natural_mobility_map(return_geo_mesh=True)
		return jsonify({"success": True, "mobility_map": mobility_map.get_geojson()})
	except Exception as e:
		return jsonify({"success": False, "errors": str(e)}), 400


@app.route('/api/deploy_child_units', methods=['POST'])
def deploy_child_units():
	try:
		deploy_request = msgspec.convert(request.json, UnitDeploymentRequest)
	except msgspec.ValidationError as e:
		return jsonify({"success": False, "errors": str(e)}), 400

	if deploy_request.sim_id is None or deploy_request.sim_id not in sim_instances:
		return jsonify({"success": False, "errors": "Invalid Sim ID"}), 400

	try:
		sim_instance = sim_instances[deploy_request.sim_id]
		deployed_units = sim_instance.deploy_child_units(deploy_request)
		deployed_units = [msgspec.to_builtins(unit) for unit in deployed_units]

		return jsonify({"success": True, "deployedUnits": deployed_units})
	except Exception as e:
		return jsonify({"success": False, "errors": str(e)}), 400


@app.route('/api/simulate', methods=['POST'])
@profile
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
	app.run(port=5000, host="0.0.0.0", debug=False)