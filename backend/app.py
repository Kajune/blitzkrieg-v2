from flask import Flask, send_from_directory, jsonify, request
import uuid, json

app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')


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
	
	print(f"受け取った設定: {json.dumps(data, indent=2)}")
	return jsonify({"uuid": new_id})


if __name__ == '__main__':
	app.run(port=5000, debug=True)