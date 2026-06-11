import os
from flask import Flask, jsonify
from flask_cors import CORS

# Point static folder to frontend
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend'))
app = Flask(__name__, static_folder=frontend_dir, static_url_path='')
CORS(app)

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/api/wind-data')
def wind_data():
    # Placeholder for future CFD data
    return jsonify({"status": "ok", "speed": 10})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
