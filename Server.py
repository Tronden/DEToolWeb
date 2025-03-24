from flask import Flask, request, Response, jsonify
from datetime import datetime, timezone
import random
import json

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False  # Disable key sorting in JSON responses

dummy_tags = [
    {"Tag": "Hybrid.Battery.MinBatteryTemp_3", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Transformer.PhaseVoltage2", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Genset1.Generator.CurrentL3", "Unit": "A", "RegisterDataType": "UInt16"},
    {"Tag": "Hybrid.Transformer.TotalRealPower", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Transformer.PhaseVoltage3", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Genset2.Generator.CurrentL2", "Unit": "Aac", "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.MaxDischargeSetpoint", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.NumberOfModulesInString", "Unit": None, "RegisterDataType": "UInt32"},
    {"Tag": "Hybrid.Transformer.SupplyPhaseSystem", "Unit": None, "RegisterDataType": "Boolean"},
    {"Tag": "Hybrid.Battery.AvgBatteryTemp_3", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Internal.OPCUAClient.ConnectionStatus", "Unit": "", "RegisterDataType": "Boolean"},
    {"Tag": "Hybrid.Transformer.SystemCapacitance", "Unit": None, "RegisterDataType": "Boolean"},
    {"Tag": "Genset1.Generator.OperationalMode", "Unit": "", "RegisterDataType": "Boolean"},
    {"Tag": "Hybrid.Battery.MaxChargeSetpoint", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Genset1.Generator.VoltageL2L3", "Unit": "V", "RegisterDataType": "UInt16"},
    {"Tag": "Hybrid.Battery.MaxBatteryVoltage", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.PMS.Freq_Gen", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Genset2.Generator.ActivePowerL2", "Unit": "kW", "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.MinStateOfHealth", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.MaxBatteryTemp_3", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Genset1.Generator.VoltageL1L3", "Unit": "V", "RegisterDataType": "UInt16"},
    {"Tag": "Hybrid.Battery.MinBatteryTemp_1", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.AvgBatteryTemp_1", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Genset1.Generator.GensetContactor", "Unit": "", "RegisterDataType": "Boolean"},
    {"Tag": "Container.DoorSwitch2.IsClosed", "Unit": None, "RegisterDataType": "Boolean"},
    {"Tag": "Hybrid.Battery.StateOfCharge", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Container.RoomSensor.Temperature", "Unit": "deg. C", "RegisterDataType": "Single"},
    {"Tag": "Genset2.Generator.ActivePowerL3", "Unit": "kW", "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.MinBatteryTemp_4", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Transformer.PhaseCurrentFiltered1", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.MaxBatteryCurrent", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Transformer.ApparentPower3", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Genset.Generator.TotalApparentPower", "Unit": "", "RegisterDataType": "Single"},
    {"Tag": "Genset2.Mains.VoltageL1L3", "Unit": "Vac", "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.MaxBatteryTemp_1", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.AvgBatteryTemp_4", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Genset2.Generator.ReactivePowerL1", "Unit": "kVAr", "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Transformer.PowerFactor1", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Transformer.NeutralCurrent", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Battery.MaxBatteryTemp", "Unit": None, "RegisterDataType": "Single"},
    {"Tag": "Hybrid.Transformer.CapPhase2", "Unit": None, "RegisterDataType": "Boolean"},
    {"Tag": "Genset2.Generator.VoltageL1L2", "Unit": "Vac", "RegisterDataType": "Single"},
    {"Tag": "Genset1.Engine.Status", "Unit": "", "RegisterDataType": "Boolean"},
    {"Tag": "Genset2.Generator.ReactivePowerL2", "Unit": "kVAr", "RegisterDataType": "Single"},
    {"Tag": "Genset1.Generator.TestMode", "Unit": "", "RegisterDataType": "Boolean"},
    {"Tag": "Genset1.Engine.AuxTemperature", "Unit": "deg. C", "RegisterDataType": "UInt16"},
    {"Tag": "Hybrid.Generator.TotalApparentPower", "Unit": None, "RegisterDataType": "Single"},
]

@app.route('/taglist', methods=['GET'])
def taglist():
    """
    Returns a JSON list of dummy tags with keys in the defined order.
    """
    json_data = json.dumps(dummy_tags, sort_keys=False)
    return Response(json_data, mimetype='application/json')

@app.route('/values', methods=['GET'])
def values():
    """
    Returns random test data for the requested tag.
    """
    tag = request.args.get("tag")
    
    # Default timestamps (UTC)
    default_start = int(datetime(2025, 2, 19, 0, 0, 0, tzinfo=timezone.utc).timestamp())
    default_end = int(datetime(2025, 2, 25, 0, 0, 0, tzinfo=timezone.utc).timestamp())
    
    try:
        start_ts = int(request.args.get("startDateUnixSeconds", default_start))
        end_ts = int(request.args.get("endDateUnixSeconds", default_end))
    except ValueError:
        return jsonify({"error": "Invalid timestamp parameters."}), 400

    # Check for a query parameter to decide the date format.
    # If dateFormat=unix then return "dd:mm:yyyy:hh:mm:ss"; otherwise use ISO format.
    date_format_param = request.args.get("dateFormat", "iso").lower()
    
    data = []
    step = 45  # one-minute step
    current_ts = start_ts

    while current_ts <= end_ts:
        dt = datetime.fromtimestamp(current_ts, tz=timezone.utc)
        dt = dt.replace(microsecond=random.randint(0, 999) * 1000)
        
        if date_format_param == "unix":
            dt_str = dt.strftime("%d:%m:%Y:%H:%M:%S")
        else:
            dt_str = dt.isoformat(timespec='milliseconds')
        
        # Generate a dummy value based on the tag requested.
        if tag == "Hybrid.ESS.MaxCellVoltage":
            value = random.randint(3330, 3340)
        elif tag == "Hybrid.ESS.MinCellVoltage":
            value = random.randint(3300, 3320)
        elif tag == "Hybrid.ESS.AverageCellVoltage":
            value = random.randint(3320, 3330)
        elif tag == "Sensor.Temperature":
            value = round(20 + random.uniform(-5, 5), 2)
        elif tag == "Sensor.Pressure":
            value = round(1000 + random.uniform(-20, 20), 2)
        elif tag == "Sensor.Humidity":
            value = round(50 + random.uniform(-10, 10), 2)
        elif tag == "Machine.Speed":
            value = round(1500 + random.uniform(-100, 100), 2)
        elif tag == "Machine.Temperature":
            value = round(80 + random.uniform(-10, 10), 2)
        elif tag == "Generator.PowerOutput":
            value = round(random.uniform(50, 150), 2)
        elif tag == "Generator.FuelConsumption":
            value = round(random.uniform(0.5, 5.0), 2)
        elif tag == "EXT.SignalStrength":
            value = random.randint(1, 100)
        elif tag == "EXT.SystemVoltage":
            value = random.randint(210, 240)
        else:
            value = random.randint(0, 100)
        
        record = {
            "Date": dt_str,
            "Value": value
        }
        data.append(record)
        current_ts += step

    return jsonify(data)

if __name__ == '__main__':
    app.run(port=61185)