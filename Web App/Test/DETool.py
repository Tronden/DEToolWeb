import threading
import webbrowser
import os
import time
import json
import requests
from flask import Flask, send_from_directory, request, jsonify
import pystray
from PIL import Image, ImageDraw

def get_documents_folder():
    return os.path.join(os.path.expanduser("~"), "Documents", "DETool")

def get_cache_folder():
    folder = os.path.join(get_documents_folder(), "Cache")
    os.makedirs(folder, exist_ok=True)
    return folder

def get_taglist_cache_path():
    return os.path.join(get_cache_folder(), "Taglist.json")

def get_log_folder():
    folder = os.path.join(get_documents_folder(), "Logs")
    os.makedirs(folder, exist_ok=True)
    return folder

UI_PORT = 8080
EXTERNAL_TAGLIST_URL = "http://localhost:61185/taglist"
EXTERNAL_VALUES_URL = "http://localhost:61185/values"
DATA_DIR = "data"

app = Flask(__name__, static_folder=DATA_DIR, template_folder=DATA_DIR)

@app.route("/")
def root():
    return send_from_directory(DATA_DIR, "index.html")

@app.route("/<path:filename>")
def serve_file(filename):
    return send_from_directory(DATA_DIR, filename)

@app.route("/taglist")
def proxy_tag_list():
    cache_path = get_taglist_cache_path()
    refresh = request.args.get("refresh", default="false").lower() in ["true", "1"]
    if not refresh and os.path.exists(cache_path):
        try:
            with open(cache_path, "r") as f:
                data = json.load(f)
            print("Loaded tag list from cache:", cache_path)
            return jsonify(data)
        except Exception as e:
            print("Error reading cached tag list:", e)
    try:
        resp = requests.get(EXTERNAL_TAGLIST_URL, timeout=3)
        resp.raise_for_status()
        data = resp.json()
        with open(cache_path, "w") as f:
            json.dump(data, f)
        print("Fetched tag list from external API and cached it.")
        return jsonify(data)
    except Exception as e:
        print("Error fetching tag list from external API:", e)
        return jsonify([])

@app.route("/values")
def proxy_values():
    tag = request.args.get("tag", type=str)
    start = request.args.get("startDateUnixSeconds", type=int)
    end = request.args.get("endDateUnixSeconds", type=int)
    if not tag or start is None or end is None:
        print("Invalid parameters for /values: tag=%s, start=%s, end=%s", tag, start, end)
        return jsonify({"error": "Invalid parameters"}), 400
    try:
        params = {"tag": tag, "startDateUnixSeconds": start, "endDateUnixSeconds": end}
        resp = requests.get(EXTERNAL_VALUES_URL, params=params, timeout=3)
        resp.raise_for_status()
        data = resp.json()
        print("Fetched values for tag", tag, "from external API.")
        return jsonify(data)
    except Exception as e:
        print("Error fetching values from external API:", e)
        return jsonify({"error": "Failed to fetch values"}), 500

@app.route("/clear_cache", methods=["POST"])
def clear_cache():
    cache_path = get_taglist_cache_path()
    try:
        if os.path.exists(cache_path):
            os.remove(cache_path)
            print("Cleared tag list cache via /clear_cache")
    except Exception as e:
        print("Error clearing cache:", e)
    return jsonify({"status": "Cache cleared"}), 200

@app.route("/shutdown", methods=["POST"])
def shutdown():
    try:
        cache_path = get_taglist_cache_path()
        if os.path.exists(cache_path):
            os.remove(cache_path)
            print("Cleared tag list cache on shutdown.")
    except Exception as e:
        print("Error clearing cache on shutdown:", e)
    shutdown_server = request.environ.get("werkzeug.server.shutdown")
    if shutdown_server:
        print("Shutting down DETool backend server.")
        shutdown_server()
    return jsonify({"status": "Shutting down"}), 200

def run_flask():
    app.run(port=UI_PORT, threaded=True)

def start_flask_server():
    threading.Thread(target=run_flask, daemon=True).start()

def create_image():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    icon_path = os.path.join(base_dir, DATA_DIR, "icon.png")
    if os.path.exists(icon_path):
        return Image.open(icon_path)
    else:
        width, height = 64, 64
        image = Image.new("RGB", (width, height), "black")
        dc = ImageDraw.Draw(image)
        dc.text((10, 20), "DE", fill="white")
        return image

def on_open(icon, item):
    webbrowser.open(f"http://localhost:{UI_PORT}")

def on_shutdown(icon, item):
    try:
        requests.post(f"http://localhost:{UI_PORT}/shutdown")
    except Exception as e:
        print("Error during shutdown:", e)
    icon.stop()
    os._exit(0)

def on_restart(icon, item):
    try:
        requests.post(f"http://localhost:{UI_PORT}/shutdown")
    except Exception as e:
        print("Error during shutdown (for restart):", e)
    time.sleep(2)
    start_flask_server()
    print("Server restarted.")
    icon.notify("Server restarted", "Restart Server")

def start_tray():
    menu = pystray.Menu(
        pystray.MenuItem("Open DETool", on_open),
        pystray.MenuItem("Restart Tool", on_restart),
        pystray.MenuItem("Shutdown Tool", on_shutdown)
    )
    icon = pystray.Icon("DETool", create_image(), f"DETool (http://localhost:{UI_PORT})", menu)
    icon.run()

if __name__ == "__main__":
    start_flask_server()
    webbrowser.open(f"http://localhost:{UI_PORT}")
    start_tray()