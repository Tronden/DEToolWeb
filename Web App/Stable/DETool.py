import threading
import webbrowser
import os
import time
import json
import logging
import requests
from flask import Flask, send_from_directory, request, jsonify
import pystray
from PIL import Image, ImageDraw

# ---------- Helper Functions for %APPDATA% storage ----------
def get_appdata_folder():
    return os.path.join(os.environ.get("APPDATA", "."), "DETool")

def get_cache_folder():
    folder = os.path.join(get_appdata_folder(), "Bin", "Cache")
    os.makedirs(folder, exist_ok=True)
    return folder

def get_taglist_cache_path():
    return os.path.join(get_cache_folder(), "Taglist.json")

def get_log_folder():
    folder = os.path.join(get_appdata_folder(), "Logs")
    os.makedirs(folder, exist_ok=True)
    return folder

# ---------- Logging Setup ----------
log_dir = get_log_folder()
log_file = os.path.join(log_dir, "DETool.log")
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(log_file), logging.StreamHandler()]
)
logging.info("Starting DETool backend proxy server.")

# ---------- Configuration ----------
UI_PORT = 8080
EXTERNAL_TAGLIST_URL = "http://localhost:61185/taglist"
EXTERNAL_VALUES_URL = "http://localhost:61185/values"
DATA_DIR = "data"  # Contains static files (html, js, css, icon, logo, etc.)

# Create a persistent session for outbound API calls
session = requests.Session()

app = Flask(__name__, static_folder=f"{DATA_DIR}/static", template_folder=f"{DATA_DIR}/static")

# ---------- UI Endpoints (serving the web app) ----------
@app.route("/")
def root():
    return send_from_directory(f"{DATA_DIR}/static", "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(f"{DATA_DIR}/static", filename)

# ---------- Proxy Data Endpoints ----------
@app.route("/taglist")
def proxy_tag_list():
    cache_path = get_taglist_cache_path()
    refresh = request.args.get("refresh", default="false").lower() in ["true", "1"]
    if not refresh and os.path.exists(cache_path):
        try:
            with open(cache_path, "r") as f:
                data = json.load(f)
            logging.info("Loaded tag list from cache: %s", cache_path)
            return jsonify(data)
        except Exception as e:
            logging.error("Error reading cached tag list: %s", e)
    try:
        resp = session.get(EXTERNAL_TAGLIST_URL, timeout=3)
        resp.raise_for_status()
        data = resp.json()
        with open(cache_path, "w") as f:
            json.dump(data, f)
        logging.info("Fetched tag list from external API and cached it.")
        return jsonify(data)
    except Exception as e:
        logging.error("Error fetching tag list from external API: %s", e)
        return jsonify([])

@app.route("/values")
def proxy_values():
    tag = request.args.get("tag", type=str)
    start = request.args.get("startDateUnixSeconds", type=int)
    end = request.args.get("endDateUnixSeconds", type=int)
    if not tag or start is None or end is None:
        logging.error("Invalid parameters for /values: tag=%s, start=%s, end=%s", tag, start, end)
        return jsonify({"error": "Invalid parameters"}), 400
    try:
        params = {"tag": tag, "startDateUnixSeconds": start, "endDateUnixSeconds": end}
        resp = session.get(EXTERNAL_VALUES_URL, params=params, timeout=3)
        resp.raise_for_status()
        data = resp.json()
        logging.info("Fetched values for tag %s from external API.", tag)
        return jsonify(data)
    except Exception as e:
        logging.error("Error fetching values from external API: %s", e)
        return jsonify({"error": "Failed to fetch values"}), 500

@app.route("/clear_cache", methods=["POST"])
def clear_cache():
    cache_path = get_taglist_cache_path()
    try:
        if os.path.exists(cache_path):
            os.remove(cache_path)
            logging.info("Cleared tag list cache via /clear_cache")
    except Exception as e:
        logging.error("Error clearing cache: %s", e)
    return jsonify({"status": "Cache cleared"}), 200

@app.route("/shutdown", methods=["POST"])
def shutdown():
    cache_path = get_taglist_cache_path()
    try:
        if os.path.exists(cache_path):
            os.remove(cache_path)
            logging.info("Cleared tag list cache on shutdown.")
    except Exception as e:
        logging.error("Error clearing cache on shutdown: %s", e)
    shutdown_server = request.environ.get("werkzeug.server.shutdown")
    if shutdown_server:
        logging.info("Shutting down DETool backend server gracefully.")
        shutdown_server()
    else:
        logging.warning("Shutdown function not available; terminating process.")
    return jsonify({"status": "Shutting down"}), 200

def run_flask():
    app.run(port=UI_PORT, threaded=True)

def start_flask_server():
    threading.Thread(target=run_flask, daemon=True).start()

# ---------- System Tray Integration ----------
def create_image():
    icon_path = os.path.join(os.path.dirname(__file__), "data", "icon.png")
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
        session.post(f"http://localhost:{UI_PORT}/shutdown")
    except Exception as e:
        logging.error("Error during shutdown: %s", e)
    icon.stop()
    # Use sys.exit() for a graceful termination instead of os._exit(0)
    import sys
    sys.exit(0)

def on_restart(icon, item):
    try:
        session.post(f"http://localhost:{UI_PORT}/shutdown")
    except Exception as e:
        logging.error("Error during shutdown (for restart): %s", e)
    time.sleep(2)
    start_flask_server()
    logging.info("Server restarted.")
    icon.notify("Server restarted", "Restart Server")

def start_tray():
    menu = pystray.Menu(
        pystray.MenuItem("Open DETool", on_open),
        pystray.MenuItem("Restart Server", on_restart),
        pystray.MenuItem("Shutdown Server", on_shutdown)
    )
    icon = pystray.Icon("DETool", create_image(), f"DETool (http://localhost:{UI_PORT})", menu)
    icon.run()

if __name__ == "__main__":
    try:
        response = session.get(f"http://localhost:{UI_PORT}")
        if response.status_code == 200:
            logging.info("Server already running at port %s. Not starting a new instance.", UI_PORT)
        else:
            start_flask_server()
    except Exception as e:
        start_flask_server()
    webbrowser.open(f"http://localhost:{UI_PORT}")
    start_tray()
