from flask import Flask, send_from_directory, jsonify, request
from typing import Dict, List, Optional
from dataclasses import asdict
import msgspec
import uuid, json
from models import SimSetting, SimRequest, SimResponse, UnitDeploymentRequest, UpdateUnitActionRequest, PlacedUnit
from sim import Simulation


app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')

sim_instances : Dict[str, Simulation] = {}
sim_records : Dict[str, SimResponse] = {}
sim_update_actions : Dict[str, List[UpdateUnitActionRequest]] = {}


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


@app.route('/api/fetch_simulation', methods=['GET'])
def fetch_simulation():
	try:
		sim_uuid = request.args.get("sim_uuid")

		if sim_uuid is None or sim_uuid not in sim_instances:
			return jsonify({"success": False, "errors": "Invalid Sim ID"}), 400

		sim_instance = sim_instances[sim_uuid]
		config_data = msgspec.to_builtins(sim_instance._sim_setting)
		
		return jsonify({
			"success": True,
			**config_data
		})
	except Exception as e:
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


def update_unit_actions_impl(sim_id, placed_units):
	for update_unit_action_request in sim_update_actions[sim_id]:
		for unit_id, actions in update_unit_action_request.unit_actions.items():
			for unit in placed_units:
				if unit.id != unit_id:
					continue
				unit.actions = actions
	return placed_units


def update_unit_records_impl(sim_id, unit_records):
	for update_unit_action_request in sim_update_actions[sim_id]:
		for unit_id, actions in update_unit_action_request.unit_actions.items():
			if unit_id in unit_records:
				unit_records[unit_id].actions = actions
				unit_records[unit_id].dirty = True

	return unit_records


@app.route('/api/simulate', methods=['POST'])
def simulate():
	try:
		sim_request = msgspec.convert(request.json, SimRequest)
	except msgspec.ValidationError as e:
		return jsonify({"success": False, "errors": str(e)}), 400

	sim_id = sim_request.sim_id

	if sim_id is None or sim_id not in sim_instances:
		return jsonify({"success": False, "errors": "Invalid Sim ID"}), 400

	if sim_id in sim_update_actions:
		sim_request.placed_units = update_unit_actions_impl(sim_id, sim_request.placed_units)

	sim_response = sim_instances[sim_id].step(sim_request)

	if sim_id in sim_update_actions:
		sim_response.unitRecords = update_unit_records_impl(sim_id, sim_response.unitRecords)
		sim_update_actions[sim_id] = []

	sim_records[sim_id] = sim_response

	return msgspec.json.encode(sim_response)


@app.route('/api/update_simulation_state', methods=['POST'])
def update_simulation_state():
	try:
		sim_response = msgspec.convert(request.json, SimResponse)
	except msgspec.ValidationError as e:
		return jsonify({"success": False, "errors": str(e)}), 400

	if sim_response.sim_id is None or sim_response.sim_id not in sim_instances:
		return jsonify({"success": False, "errors": "Invalid Sim ID"}), 400

	sim_records[sim_response.sim_id] = sim_response

	return jsonify({"success": True})


@app.route('/api/fetch_simulation_state', methods=['GET'])
def fetch_simulation_state():
	try:
		sim_id = request.args.get("sim_id")

		if sim_id is None or sim_id not in sim_instances:
			return jsonify({"success": False, "errors": "Invalid Sim ID"}), 400

		if sim_id not in sim_records:
			return jsonify({"success": False, "errors": "Simulation state not yet set"}), 200

		sim_response = sim_records[sim_id]
		sim_response.unitRecords = update_unit_records_impl(sim_id, sim_response.unitRecords)

		return msgspec.json.encode(sim_response)
	except Exception as e:
		return jsonify({"success": False, "errors": str(e)}), 400


@app.route('/api/update_unit_actions', methods=['POST'])
def update_unit_actions():
	try:
		update_unit_action_request = msgspec.convert(request.json, UpdateUnitActionRequest)
	except msgspec.ValidationError as e:
		return jsonify({"success": False, "errors": str(e)}), 400

	sim_id = update_unit_action_request.sim_id

	if sim_id is None or sim_id not in sim_instances:
		return jsonify({"success": False, "errors": "Invalid Sim ID"}), 400

	if sim_id not in sim_update_actions:
		sim_update_actions[sim_id] = []
	sim_update_actions[sim_id].append(update_unit_action_request)

	return jsonify({"success": True})


if __name__ == '__main__':
	app.run(port=5000, host="0.0.0.0", debug=False)