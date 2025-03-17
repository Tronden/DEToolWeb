#!/usr/bin/env python3
import os, json, requests, socket
from flask import Flask, send_from_directory, request, jsonify
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Alignment
from openpyxl.utils import get_column_letter

# ---------------- Global Settings ----------------
global_settings = {
    "offset": 1,  # hours offset
    "bargeName": "UnknownBarge",
    "bargeNumber": "0000",
    "tag_settings": {
        "scale_factors": {},
        "error_values": {},
        "max_decimal": {}
    }
}

# ---------------- Global Variables and Cache ----------------
UI_PORT = 8080
EXTERNAL_TAGLIST_URL = "http://localhost:61185/taglist"
EXTERNAL_VALUES_URL = "http://localhost:61185/values"
DATA_DIR = "data"  # Folder for index.html, logo, etc.
cached_raw_data = {}      # key = (start, end, tuple(sorted(tags)))
global_raw_data = {}      # raw data per tag (accumulated from external fetches)
global_filled_data = {}   # filled (carry-forward) data per tag

app = Flask(__name__, static_folder=DATA_DIR, template_folder=DATA_DIR)

# ---------------- Prevent Duplicate Instance ----------------
def check_if_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return False
        except OSError:
            return True

if check_if_port_in_use(UI_PORT):
    print(f"Error: Port {UI_PORT} is already in use. Exiting.")
    exit(1)

# ---------------- Helper Functions ----------------
def get_documents_folder():
    return os.path.join(os.path.expanduser("~"), "Documents", "DETool")

def get_cache_folder():
    folder = os.path.join(get_documents_folder(), "Cache")
    os.makedirs(folder, exist_ok=True)
    return folder

def format_timestamp(ts):
    return datetime.fromtimestamp(ts / 1000).strftime("%d/%m/%Y %H:%M:%S")

def process_raw_data(raw_data, tag):
    """
    Process raw data for a tag.
    For each record, if the "Value" is missing (empty, None, or "None"),
    then carry forward the last valid value.
    """
    offset = global_settings["offset"]
    try:
        scale = float(global_settings["tag_settings"]["scale_factors"].get(tag, 1.0))
    except Exception as e:
        print("Error reading scale factor for", tag, e)
        scale = 1.0
    try:
        max_dec = int(global_settings["tag_settings"]["max_decimal"].get(tag, 2))
    except Exception as e:
        print("Error reading max decimal for", tag, e)
        max_dec = 2

    processed = []
    for point in raw_data:
        try:
            dt = datetime.fromisoformat(point["Date"])
            ts = int(dt.timestamp() * 1000)
            ts += -offset * 3600 * 1000
            # Check for missing value (None, empty string, or "None")
            val_str = point.get("Value", "")
            if val_str in [None, "", "None"]:
                value = None
            else:
                value = float(val_str) * scale
                value = round(value, max_dec)
            processed.append([ts, value])
        except Exception as e:
            print(f"Error processing point for tag {tag}: {point}", e)
    processed.sort(key=lambda x: x[0])
    filled = []
    last_val = None
    for pt in processed:
        if pt[1] is not None:
            last_val = pt[1]
        filled.append([pt[0], last_val])
    global_filled_data[tag] = filled
    return filled

def get_value_at(series, ts):
    last_val = ""
    for pt in series:
        if pt[0] <= ts:
            last_val = pt[1]
        else:
            break
    return last_val

def cache_key(start, end, tags):
    return (start, end, tuple(sorted(tags)))

# ---------------- Endpoints ----------------

@app.route("/reprocess")
def reprocess():
    tag_param = request.args.get("tags")
    tags = [t.strip() for t in tag_param.split(",")] if tag_param else list(global_raw_data.keys())
    processed_values = []
    for tag in tags:
        raw_data = global_raw_data.get(tag, [])
        try:
            series = process_raw_data(raw_data, tag)
        except Exception as e:
            print(f"Error reprocessing tag {tag}:", e)
            series = []
        processed_values.append({"name": tag, "data": series})
    return jsonify({"processed_values": processed_values})

@app.route("/")
def root():
    return send_from_directory(DATA_DIR, "index.html")

@app.route("/<path:filename>")
def serve_file(filename):
    return send_from_directory(DATA_DIR, filename)

@app.route("/taglist")
def taglist_endpoint():
    cache_path = os.path.join(get_cache_folder(), "Taglist.json")
    refresh = request.args.get("refresh", "false").lower() in ["true", "1"]
    if not refresh and os.path.exists(cache_path):
        try:
            with open(cache_path, "r") as f:
                data = json.load(f)
            print("Loaded tag list from cache.")
            return jsonify(data)
        except Exception as e:
            print("Error reading cached tag list:", e)
    try:
        resp = requests.get(EXTERNAL_TAGLIST_URL, timeout=3)
        resp.raise_for_status()
        data = resp.json()
        with open(cache_path, "w") as f:
            json.dump(data, f)
        print("Fetched tag list and cached it.")
        return jsonify(data)
    except Exception as e:
        print("Error fetching tag list:", e)
        return jsonify([])

@app.route("/values")
def values_endpoint():
    tag = request.args.get("tag")
    start = request.args.get("startDateUnixSeconds", type=int)
    end = request.args.get("endDateUnixSeconds", type=int)
    if not tag or start is None or end is None:
        return jsonify({"error": "Invalid parameters"}), 400
    try:
        params = {"tag": tag, "startDateUnixSeconds": start, "endDateUnixSeconds": end}
        resp = requests.get(EXTERNAL_VALUES_URL, params=params, timeout=3)
        resp.raise_for_status()
        data = resp.json()
        print(f"Fetched raw values for tag {tag}.")
        return jsonify(data)
    except Exception as e:
        print(f"Error fetching values for tag {tag}:", e)
        return jsonify({"error": "Failed to fetch values"}), 500

@app.route("/complete_data")
def complete_data_endpoint():
    try:
        resp = requests.get(EXTERNAL_TAGLIST_URL, timeout=3)
        resp.raise_for_status()
        taglist = resp.json()
    except Exception as e:
        print("Error fetching tag list:", e)
        taglist = []
    tag_param = request.args.get("tags")
    tags = ([t.strip() for t in tag_param.split(",")] if tag_param
            else ([item["Tag"] for item in taglist] if taglist and isinstance(taglist[0], dict) else taglist))
    start = request.args.get("startDateUnixSeconds", type=int)
    end = request.args.get("endDateUnixSeconds", type=int)
    processed_values = []
    if start is not None and end is not None:
        key = cache_key(start, end, tags)
        cached = {}
        for tag in tags:
            try:
                params = {"tag": tag, "startDateUnixSeconds": start, "endDateUnixSeconds": end}
                resp = requests.get(EXTERNAL_VALUES_URL, params=params, timeout=3)
                resp.raise_for_status()
                raw_data = resp.json()
                cached[tag] = raw_data
                global_raw_data[tag] = raw_data
                # Process raw data once (fill missing values)
                process_raw_data(raw_data, tag)
            except Exception as e:
                print(f"Error fetching raw data for tag {tag}:", e)
                cached[tag] = []
                global_raw_data[tag] = []
            try:
                filled = global_filled_data.get(tag, [])
                processed_values.append({"name": tag, "data": filled})
            except Exception as e:
                print(f"Error processing data for tag {tag}:", e)
                processed_values.append({"name": tag, "data": []})
        cached_raw_data[key] = cached
    return jsonify({"taglist": taglist, "processed_values": processed_values})

@app.route("/incremental_data", methods=["POST"])
def incremental_data_endpoint():
    data = request.get_json()
    tags = data.get("tags", [])
    end = data.get("endDateUnixSeconds", None)
    if end is None:
        return jsonify({"error": "Missing endDateUnixSeconds"}), 400
    updated_series = []
    for tag in tags:
        last_ts = 0
        if tag in global_raw_data and global_raw_data[tag]:
            try:
                last_point = global_raw_data[tag][-1]
                last_dt = datetime.fromisoformat(last_point["Date"])
                last_ts = int(last_dt.timestamp())
            except Exception as e:
                print("Error parsing last timestamp for tag", tag, e)
        start_param = last_ts + 1
        try:
            params = {"tag": tag, "startDateUnixSeconds": start_param, "endDateUnixSeconds": end}
            resp = requests.get(EXTERNAL_VALUES_URL, params=params, timeout=3)
            resp.raise_for_status()
            new_data = resp.json()
            if tag in global_raw_data:
                global_raw_data[tag].extend(new_data)
                global_raw_data[tag].sort(key=lambda x: datetime.fromisoformat(x["Date"]))
            else:
                global_raw_data[tag] = new_data
            process_raw_data(global_raw_data[tag], tag)
            filled = global_filled_data.get(tag, [])
            updated_series.append({"name": tag, "data": filled})
        except Exception as e:
            print(f"Error fetching incremental data for tag {tag}:", e)
            updated_series.append({"name": tag, "data": []})
    try:
        resp = requests.get(EXTERNAL_TAGLIST_URL, timeout=3)
        resp.raise_for_status()
        taglist = resp.json()
    except Exception as e:
        print("Error fetching tag list incrementally:", e)
        taglist = []
    return jsonify({"taglist": taglist, "processed_values": updated_series})

@app.route("/update_settings", methods=["POST"])
def update_settings_endpoint():
    global global_settings
    try:
        new_settings = request.get_json()
        print("Received new settings:", new_settings)
        if "offset" in new_settings:
            global_settings["offset"] = int(new_settings["offset"])
        if "bargeName" in new_settings:
            global_settings["bargeName"] = new_settings["bargeName"]
        if "bargeNumber" in new_settings:
            global_settings["bargeNumber"] = new_settings["bargeNumber"]
        if "tag_settings" in new_settings:
            ts = new_settings["tag_settings"]
            global_settings["tag_settings"]["scale_factors"] = ts.get("scale_factors", {})
            global_settings["tag_settings"]["error_values"] = ts.get("error_values", {})
            global_settings["tag_settings"]["max_decimal"] = ts.get("max_decimal", {})
        print("Updated global settings:", global_settings)
        return jsonify(global_settings)
    except Exception as e:
        print("Error updating settings:", e)
        return jsonify({"error": "Failed to update settings"}), 400

@app.route("/export_excel")
def export_excel_endpoint():
    start = request.args.get("startDateUnixSeconds", type=int)
    end = request.args.get("endDateUnixSeconds", type=int)
    if start is None or end is None:
        return jsonify({"error": "Invalid date parameters"}), 400
    tag_param = request.args.get("tags")
    try:
        resp = requests.get(EXTERNAL_TAGLIST_URL, timeout=3)
        resp.raise_for_status()
        taglist = resp.json()
    except Exception as e:
        print("Error fetching tag list for export:", e)
        taglist = []
    if tag_param:
        tags = [t.strip() for t in tag_param.split(",")]
    else:
        tags = [item["Tag"] for item in taglist] if taglist and isinstance(taglist[0], dict) else taglist
    processed_series = {}
    for tag in tags:
        raw_data = global_raw_data.get(tag, [])
        try:
            filled = process_raw_data(raw_data, tag)
            processed_series[tag] = filled
        except Exception as e:
            print(f"Error processing data for tag {tag} during export:", e)
            processed_series[tag] = []
    all_timestamps = set()
    for series in processed_series.values():
        for pt in series:
            all_timestamps.add(pt[0])
    all_timestamps = sorted(list(all_timestamps))
    visibleMin = request.args.get("visibleMin", type=int)
    visibleMax = request.args.get("visibleMax", type=int)
    if visibleMin is not None and visibleMax is not None:
        visibleMin_ms = visibleMin * 1000
        visibleMax_ms = visibleMax * 1000
        all_timestamps = [ts for ts in all_timestamps if ts >= visibleMin_ms and ts <= visibleMax_ms]
    headers = []
    for tag in tags:
        parts = tag.split(".")
        while len(parts) < 3:
            parts.append("")
        headers.append(parts)
    header_row1 = ["Timestamp"] + [p[0] for p in headers]
    header_row2 = [""] + [p[1] for p in headers]
    header_row3 = [""] + [p[2] for p in headers]
    data_rows = []
    for ts in all_timestamps:
        row = [datetime.fromtimestamp(ts/1000)]
        for tag in tags:
            series = processed_series.get(tag, [])
            val = get_value_at(series, ts)
            row.append(val)
        data_rows.append(row)
    wb = Workbook()
    ws = wb.active
    ws.title = "Dashboard Data"
    ws.append(header_row1)
    ws.append(header_row2)
    ws.append(header_row3)
    ws.merge_cells(start_row=1, start_column=1, end_row=3, end_column=1)
    def merge_adjacent_identical(row_num, start_col, end_col):
        col = start_col
        while col <= end_col:
            start = col
            current_value = ws.cell(row=row_num, column=col).value
            while col + 1 <= end_col and ws.cell(row=row_num, column=col + 1).value == current_value and current_value != "":
                col += 1
            if col > start:
                ws.merge_cells(start_row=row_num, start_column=start, end_row=row_num, end_column=col)
            col += 1
    merge_adjacent_identical(1, 2, ws.max_column)
    merge_adjacent_identical(2, 2, ws.max_column)
    for row in data_rows:
        ws.append(row)
    center_align = Alignment(horizontal="center", vertical="center")
    for row in ws.iter_rows():
        for cell in row:
            cell.alignment = center_align
    for row in ws.iter_rows(min_row=4, min_col=1, max_col=1):
        for cell in row:
            cell.number_format = "yyyy-mm-dd hh:mm:ss"
    for col in ws.columns:
        max_length = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            try:
                if cell.value:
                    max_length = max(max_length, len(str(cell.value)))
            except Exception:
                pass
        ws.column_dimensions[col_letter].width = max_length + 2
    dashboard_folder = os.path.join(os.getcwd(), "dashboard")
    os.makedirs(dashboard_folder, exist_ok=True)
    file_date = datetime.now().strftime("%Y%m%d")
    filename = f"FH {global_settings['bargeNumber']} {global_settings['bargeName']} {file_date}.xlsx"
    filepath = os.path.join(dashboard_folder, filename)
    wb.save(filepath)
    print("Excel exported to", filepath)
    return jsonify({"status": "Excel exported", "filepath": filepath})

@app.route("/export_pdf")
def export_pdf_endpoint():
    return jsonify({"error": "Use client-side report generation"}), 400

@app.route("/shutdown", methods=["POST"])
def shutdown_endpoint():
    shutdown_server = request.environ.get("werkzeug.server.shutdown")
    if shutdown_server:
        shutdown_server()
    return jsonify({"status": "Shutting down"}), 200

@app.route("/clear_cache", methods=["POST"])
def clear_cache_endpoint():
    cache_path = os.path.join(get_cache_folder(), "Taglist.json")
    if os.path.exists(cache_path):
        os.remove(cache_path)
    return jsonify({"status": "Cache cleared"}), 200

# ------------------ WSGI Entry Point ------------------
if __name__ == "__main__":
    # Use Waitress to serve the app only on localhost.
    from waitress import serve
    serve(app, host="127.0.0.1", port=UI_PORT)