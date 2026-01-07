# uvicorn main:app --reload
import time
from pathlib import Path
from fastapi import FastAPI, Request, Query
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import numpy as np
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
# Set the backend to 'Agg' before importing pyplot

import os
import pandas as pd
from typing import Optional

# --- IAPWS LIBRARY IMPORT ---
try:
    from iapws import IAPWS97

    IAPWS_AVAILABLE = True
    print("✅ IAPWS library loaded successfully.")
except ImportError:
    IAPWS_AVAILABLE = False
    print("⚠️ IAPWS library not available. Falling back to CSV interpolation.")

# --- WATER DATA SETUP ---
# Load CSV (Ensure static/saturated_water.csv exists)
water_csv_path = Path("static/saturated_water.csv")
try:
    water_df = pd.read_csv(water_csv_path)
    # Ensure numeric
    for col in water_df.columns:
        water_df[col] = pd.to_numeric(water_df[col], errors='coerce')
    print("✅ Water properties CSV loaded successfully.")
except FileNotFoundError:
    print("❌ ERROR: 'static/saturated_water.csv' not found. Water simulation will fail.")
    water_df = pd.DataFrame()


# --- INTERPOLATION HELPERS (Confirmed to be correct) ---
def interpolate_water_property_by_T(T_C, prop_name):
    """
    Interpolates a water property from the CSV by saturation temperature (T_sat in °C).
    If T_C is outside the table, returns the nearest boundary value.
    """
    df = water_df
    if df.empty: return None

    T_min, T_max = df["T_sat"].min(), df["T_sat"].max()

    # Clamp T_C to CSV bounds
    if T_C < T_min:
        T_C = T_min
    elif T_C > T_max:
        T_C = T_max

    # Find closest lower and upper rows
    lower = df[df["T_sat"] <= T_C].iloc[-1]
    upper = df[df["T_sat"] >= T_C].iloc[0]

    if lower["T_sat"] == upper["T_sat"]:
        return lower[prop_name]

    # Linear interpolation
    T1, T2 = lower["T_sat"], upper["T_sat"]
    val1, val2 = lower[prop_name], upper[prop_name]
    return val1 + (val2 - val1) * (T_C - T1) / (T2 - T1)


def get_tsat(P: float):
    """
    Returns saturation temperature in °C for a given P (bar) using linear interpolation.
    Clamps P to CSV range if outside bounds.
    """
    if water_df.empty: return None, False

    df_sorted = water_df.sort_values("P_bar")
    P_min, P_max = df_sorted["P_bar"].min(), df_sorted["P_bar"].max()
    clamped = False

    # Clamp P to CSV range
    if P < P_min:
        P = P_min
        clamped = True
    elif P > P_max:
        P = P_max
        clamped = True

    lower = df_sorted[df_sorted["P_bar"] <= P].iloc[-1]
    upper = df_sorted[df_sorted["P_bar"] >= P].iloc[0]

    if lower["P_bar"] == upper["P_bar"]:
        Tsat = lower["T_sat"]
    else:
        P1, P2 = lower["P_bar"], upper["P_bar"]
        T1, T2 = lower["T_sat"], upper["T_sat"]
        Tsat = T1 + (T2 - T1) * (P - P1) / (P2 - P1)

    return round(Tsat, 5), clamped


def get_psat(T_C: float):
    """
    Returns saturation pressure in bar for a given T (°C) using linear interpolation.
    Clamps T to CSV range if outside bounds.
    """
    if water_df.empty:
        return None, False

    df_sorted = water_df.sort_values("T_sat")
    T_min, T_max = df_sorted["T_sat"].min(), df_sorted["T_sat"].max()
    clamped = False

    # Clamp T to CSV range
    if T_C < T_min:
        T_C = T_min
        clamped = True
    elif T_C > T_max:
        T_C = T_max
        clamped = True

    lower = df_sorted[df_sorted["T_sat"] <= T_C].iloc[-1]
    upper = df_sorted[df_sorted["T_sat"] >= T_C].iloc[0]

    if lower["T_sat"] == upper["T_sat"]:
        Psat = lower["P_bar"]
    else:
        T1, T2 = lower["T_sat"], upper["T_sat"]
        P1, P2 = lower["P_bar"], upper["P_bar"]
        Psat = P1 + (P2 - P1) * (T_C - T1) / (T2 - T1)

    return round(Psat, 5), clamped


# --- IAPWS CALCULATION FUNCTION ---
def calculate_water_properties_iapws(T_C, P_bar, x):
    """
    Calculate water properties using IAPWS-IF97 (Industrial Formulation 1997).
    Handles superheated, subcooled, and saturated states with high accuracy.
    """
    if not IAPWS_AVAILABLE:
        return None

    try:
        # IAPWS uses MPa for pressure and Kelvin for temperature
        P_MPa = P_bar * 0.1  # Convert bar to MPa
        T_K = T_C + 273.15  # Convert °C to K

        # Determine if we should use temperature-pressure or temperature-quality
        # For superheated/subcooled, use T and P
        # For two-phase, use T and x

        if 0 < x < 1:
            # Two-phase region - use quality
            water = IAPWS97(T=T_K, x=x)
        else:
            # Single phase - use pressure and temperature
            water = IAPWS97(T=T_K, P=P_MPa)

        # Get saturation properties at this temperature for reference
        try:
            sat_liquid = IAPWS97(T=T_K, x=0.0)
            sat_vapor = IAPWS97(T=T_K, x=1.0)

            vf = sat_liquid.v
            vg = sat_vapor.v
            uf = sat_liquid.u
            ug = sat_vapor.u
            hf = sat_liquid.h
            hg = sat_vapor.h
            sf = sat_liquid.s
            sg = sat_vapor.s
            hfg = hg - hf
            # Get saturation pressure at this temperature
            P_sat_at_T = sat_liquid.P * 10  # Convert MPa to bar
        except:
            # Fallback if saturation properties fail
            vf = vg = uf = ug = hf = hg = sf = sg = hfg = 0
            P_sat_at_T = P_bar

        # Get calculated properties
        v = water.v
        u = water.u
        h = water.h
        s = water.s

        # For two-phase, use user-specified quality
        # For single-phase, determine quality based on position
        if 0 < x < 1:
            actual_x = x
        elif vf and vg and vg != vf:
            # Calculate quality from specific volume
            actual_x = (v - vf) / (vg - vf)
            # Clamp to 0-1 range
            actual_x = max(0.0, min(1.0, actual_x))
        else:
            actual_x = x

        return {
            "T": T_C,
            "P": P_bar,
            "P_sat": P_sat_at_T,
            "x": round(actual_x, 4),
            "v": v,
            "u": u,
            "h": h,
            "s": s,
            "vf": vf,
            "vg": vg,
            "uf": uf,
            "ug": ug,
            "hf": hf,
            "hfg": hfg,
            "sf": sf,
            "sg": sg,
            "source": "IAPWS-IF97"
        }

    except Exception as e:
        print(f"❌ IAPWS calculation failed for T={T_C}°C, P={P_bar}bar, x={x}: {str(e)}")
        return None


# --- PROPERTY CALCULATION FOR WATER (Updated Version with IAPWS) ---
def calculate_water_properties(T_C, P_bar, x):
    """
    Calculates water properties based on temperature, pressure, and quality.
    Uses IAPWS for accurate superheated/subcooled calculations when available.
    """
    # Get saturation temperature at this pressure
    T_sat_at_P, _ = get_tsat(P_bar)
    # Get saturation pressure at this temperature
    P_sat_at_T, _ = get_psat(T_C)

    # Determine phase
    is_superheated = T_sat_at_P and T_C > T_sat_at_P
    is_subcooled = T_sat_at_P and T_C < T_sat_at_P

    # Use IAPWS for superheated or subcooled states when available
    if IAPWS_AVAILABLE and (is_superheated or is_subcooled):
        iapws_result = calculate_water_properties_iapws(T_C, P_bar, x)
        if iapws_result:
            # Convert quality for display
            if is_superheated:
                iapws_result["x"] = 1.0
            elif is_subcooled:
                iapws_result["x"] = 0.0

            # Ensure P_sat is included
            if "P_sat" not in iapws_result:
                iapws_result["P_sat"] = P_sat_at_T if P_sat_at_T else P_bar

            return iapws_result

    # Fallback to CSV interpolation for saturated states or if IAPWS fails
    # Get saturation properties at the given temperature
    vf = interpolate_water_property_by_T(T_C, "vf")
    vg = interpolate_water_property_by_T(T_C, "vg")
    uf = interpolate_water_property_by_T(T_C, "uf")
    ug = interpolate_water_property_by_T(T_C, "ug")
    hf = interpolate_water_property_by_T(T_C, "hf")
    hfg = interpolate_water_property_by_T(T_C, "hfg")
    sf = interpolate_water_property_by_T(T_C, "sf")
    sg = interpolate_water_property_by_T(T_C, "sg")
    P_sat_at_T_csv = interpolate_water_property_by_T(T_C, "P_bar")

    if None in [vf, vg, uf, ug, hf, hfg, sf, sg, P_sat_at_T_csv]:
        raise ValueError("Required water property data could not be interpolated.")

    # Calculate actual specific properties
    v = vf + x * (vg - vf)
    u = uf + x * (ug - uf)
    h = hf + x * hfg
    s = sf + x * (sg - sf)

    # For saturated states, use P_sat for consistency
    # For superheated/subcooled, use user's P
    if 0 <= x <= 1:
        # Saturated or two-phase region
        display_P = P_sat_at_T_csv
    else:
        # Superheated or subcooled (though x should be 0 or 1 in those cases)
        display_P = P_bar

    return {
        "T": T_C,  # °C
        "P": display_P,  # bar
        "P_sat": P_sat_at_T_csv,  # Saturation pressure at T
        "x": x,
        "v": v,  # m³/kg
        "u": u,  # kJ/kg
        "h": h,  # kJ/kg
        "s": s,  # kJ/(kg·K)
        "vf": vf,
        "vg": vg,
        "uf": uf,
        "ug": ug,
        "hf": hf,
        "hfg": hfg,
        "sf": sf,
        "sg": sg,
        "source": "CSV Interpolation"
    }


# ------------------------------


app = FastAPI()

# ---- STATIC FILES ----
static_path = Path("static")
images_path = static_path / "images"
os.makedirs(images_path, exist_ok=True)  # Make sure images folder exists
if static_path.exists():
    app.mount("/static", StaticFiles(directory="static"), name="static")
else:
    print("⚠️ Warning: 'static' folder not found")

# ---- TEMPLATES ----
templates = Jinja2Templates(directory="templates")

# ---- IN-MEMORY STORAGE ----
gas_data_store = {}

# ---- PREDEFINED GASES ----
predefined_gases = {
    "air": {"R": 0.287, "k": 1.4},
    "nitrogen": {"R": 0.2968, "k": 1.4},
    "methane": {"R": 0.518, "k": 1.299},
    "oxygen": {"R": 0.2598, "k": 1.395}
}


# -------------------------
#   ROUTES
# -------------------------
@app.get("/")
def root():
    return RedirectResponse("/home.html")


@app.get("/home.html")
def home(request: Request):
    return templates.TemplateResponse("home.html", {"request": request})


@app.get("/simulation1.html")
def sim1(request: Request):
    return templates.TemplateResponse("simulation1.html", {"request": request})


@app.get("/simulation2.html")
def sim2(request: Request):
    stored = gas_data_store.get("latest_submission", {})
    return templates.TemplateResponse("simulation2.html", {"request": request, "data": stored})


@app.get("/simulation3.html")
def sim3(request: Request):
    stored = gas_data_store.get("latest_submission", {})
    return templates.TemplateResponse("simulation3.html", {"request": request, "data": stored})


@app.get("/results.html")
def results(request: Request):
    return templates.TemplateResponse("results.html", {"request": request})


@app.get("/about.html")
def about(request: Request):
    return templates.TemplateResponse("about.html", {"request": request})


@app.get("/help.html")
def help_page(request: Request):
    return templates.TemplateResponse("help.html", {"request": request})


# -------------------------
# RECEIVE GAS/WATER DATA (State 1)
# -------------------------
@app.post("/submit-gas")
async def submit_gas(request: Request):
    """
    Handles submission for State 1 (Ideal Gas and Water/Steam).
    """
    try:
        data_json = await request.json()
        gas_name = data_json["gas_name"].lower()

        # ---------------- Water ----------------
        if gas_name == "water":
            T_input = float(data_json["T"])  # USER'S EXACT TEMPERATURE INPUT
            P_input = float(data_json["P"])  # USER'S EXACT PRESSURE INPUT
            x = float(data_json.get("x", 0))

            # Calculate interpolated saturation values
            T_sat_at_P, _ = get_tsat(P_input)
            P_sat_at_T, _ = get_psat(T_input)

            # Calculate properties using IAPWS or interpolation
            water_props = calculate_water_properties(T_input, P_input, x)

            # Determine phase
            if x == 0 or (T_sat_at_P and T_input < T_sat_at_P):
                phase = "subcooled_liquid"
            elif x == 1 or (T_sat_at_P and T_input > T_sat_at_P):
                phase = "superheated_vapor"
            elif 0 < x < 1:
                phase = "two_phase"
            else:
                phase = "saturated"

            gas_data_store["latest_submission"] = {
                "gas_name": "water",
                # Store original inputs AND interpolated values
                "T_original": T_input,  # EXACT user input
                "P_original": P_input,  # EXACT user input
                "T_sat_at_P": T_sat_at_P,  # Interpolated T_sat at P_input
                "P_sat_at_T": P_sat_at_T,  # Interpolated P_sat at T_input
                # Display values
                "T": T_input,
                "P": water_props["P"],  # Use consistent P from calculation
                "x": water_props["x"],
                "phase": phase,
                "v": round(water_props["v"], 6),
                "u": round(water_props["u"], 2),
                "h": round(water_props["h"], 2),
                "s": round(water_props["s"], 4),
                # Saturation properties for reference
                "vf": round(water_props.get("vf", 0), 6),
                "vg": round(water_props.get("vg", 0), 4),
                "uf": round(water_props.get("uf", 0), 2),
                "ug": round(water_props.get("ug", 0), 2),
                "hf": round(water_props.get("hf", 0), 2),
                "hfg": round(water_props.get("hfg", 0), 2),
                "sf": round(water_props.get("sf", 0), 4),
                "sg": round(water_props.get("sg", 0), 4),
                "source": water_props.get("source", "CSV")
            }

        # ---------------- Ideal Gas ----------------
        else:
            P = float(data_json["P"])
            v = float(data_json["v"])
            cp = data_json.get("cp")
            cv = data_json.get("cv")
            R = data_json.get("R")
            k = data_json.get("k")
            T = float(data_json.get("T", 300))  # Placeholder default T

            if gas_name != "custom":
                R = predefined_gases[gas_name]["R"]
                k = predefined_gases[gas_name]["k"]
                cv = R / (k - 1)
                cp = k * cv
            else:
                if cp is None or cv is None or cp <= cv:
                    return JSONResponse(
                        {"status": "error", "message": "Invalid cp/cv for custom gas"},
                        status_code=400
                    )
                R = cp - cv
                k = cp / cv

            # Recalculate T using P and v
            T = P * v / R

            # Calculate Ideal Gas u and h
            u = cv * T
            h = cp * T
            s = 0  # Placeholder for initial entropy

            gas_data_store["latest_submission"] = {
                "gas_name": gas_name,
                "T": round(T, 5),  # K
                "P": P,  # kPa
                "v": v,  # m³/kg
                "cp": round(cp, 5),
                "cv": round(cv, 5),
                "R": round(R, 5),
                "k": round(k, 5),
                "u": round(u, 2),
                "h": round(h, 2),
                "s": round(s, 4)
            }

        return JSONResponse({"status": "success"})

    except Exception as e:
        return JSONResponse({"status": "error", "message": f"Submission failed: {str(e)}"}, status_code=400)


# -------------------------
# GET SATURATION TEMPERATURE/PRESSURE (for frontend)
# -------------------------
@app.get("/get-tsat")
def get_tsat_api(P: float = Query(...)):
    """
    Returns saturation temperature in °C for a given P (bar) using linear interpolation.
    """
    Tsat, clamped = get_tsat(P)
    if Tsat is None:
        return JSONResponse({"error": "Water table not loaded."}, status_code=500)
    return {"Tsat": Tsat, "clamped": clamped}


@app.get("/get-psat")
def get_psat_api(T: float = Query(...)):
    """
    Returns saturation pressure in bar for a given T (°C) using linear interpolation.
    """
    Psat, clamped = get_psat(T)
    if Psat is None:
        return JSONResponse({"error": "Water table not loaded."}, status_code=500)
    return {"Psat": Psat, "clamped": clamped}


# -------------------------
#   CHECK LAST SUBMISSION
# -------------------------
@app.get("/api/k")
def get_k():
    data = gas_data_store.get("latest_submission")
    if data and "k" in data:
        return {"k": data["k"]}
    return {"error": "No ideal gas data stored yet"}


@app.get("/check-gas")
def check_gas():
    """Returns State 1 data."""
    return gas_data_store.get("latest_submission", {"message": "No data stored"})


# -------------------------
#   NEW: RECEIVE NEXT STAGE (State 2 for simulation3.js)
# -------------------------
# Updated submit-next-stage endpoint for water simulation
@app.post("/submit-next-stage")
async def submit_next_stage(request: Request):
    """
    Calculates State 2 properties dynamically based on user input and process constraint.
    This handles the live updates for the water simulation (simulation3.js).
    """
    try:
        data = await request.json()
        state1 = gas_data_store.get("latest_submission", {})

        # Check for valid State 1 data
        if not state1 or state1.get("gas_name") != "water":
            return JSONResponse({"status": "error", "message": "State 1 data not found or is not water."},
                                status_code=400)

        # Get BOTH original and interpolated values from State 1
        T_original = state1.get("T_original")  # User's EXACT temperature input
        P_original = state1.get("P_original")  # User's EXACT pressure input

        # Get interpolated saturation values
        T_sat_at_P, _ = get_tsat(P_original)
        P_sat_at_T, _ = get_psat(T_original)

        # State 2 User Input Values
        process = data.get("process", "Isobaric")
        P_input = data.get("P")
        T_input = data.get("T")
        v_input = data.get("v")
        x_input = data.get("x")

        # Convert to float if not None
        if P_input is not None: P_input = float(P_input)
        if T_input is not None: T_input = float(T_input)
        if v_input is not None: v_input = float(v_input)
        if x_input is not None: x_input = float(x_input)

        # Initialize display and calculation values
        display_T = None
        display_P = None
        calc_T = None
        calc_P = None
        calc_x = x_input if x_input is not None else 0.5

        # Apply process constraints with CORRECT values
        if process == "Isothermal":
            # For Isothermal: Show EXACT T_original, use P_sat_at_T for display
            display_T = T_original  # EXACT temperature for display
            display_P = P_sat_at_T  # Interpolated pressure for display
            calc_T = T_original  # Fixed temperature for calculation
            # User can input a different pressure for calculation
            calc_P = P_input if P_input is not None else P_sat_at_T

        elif process == "Isobaric":
            # For Isobaric: Show EXACT P_original, use T_sat_at_P for display
            display_P = P_original  # EXACT pressure for display
            display_T = T_sat_at_P  # Interpolated temperature for display
            calc_P = P_original  # Fixed pressure for calculation
            # User can input a different temperature for calculation
            calc_T = T_input if T_input is not None else T_sat_at_P

        elif process == "Isochoric":
            v_fixed = state1["v"]  # Use calculated v from State 1
            # For isochoric, we need to handle it differently
            calc_T = T_input if T_input is not None else T_original
            calc_P = P_input if P_input is not None else P_original
            display_T = calc_T
            display_P = calc_P

        # Determine phase and adjust quality based on process
        if process == "Isobaric" and calc_T is not None:
            # Get saturation temperature at the fixed pressure
            T_sat_at_fixed_P, _ = get_tsat(calc_P)
            if T_sat_at_fixed_P:
                if calc_T > T_sat_at_fixed_P:
                    # Superheated vapor
                    calc_x = 1.0
                elif calc_T < T_sat_at_fixed_P:
                    # Subcooled liquid
                    calc_x = 0.0
                else:
                    # At saturation, keep user's quality if provided
                    calc_x = x_input if x_input is not None else 0.5

        elif process == "Isothermal" and calc_P is not None:
            # Get saturation pressure at the fixed temperature
            P_sat_at_fixed_T, _ = get_psat(calc_T)
            if P_sat_at_fixed_T:
                if calc_P < P_sat_at_fixed_T:
                    # Superheated vapor
                    calc_x = 1.0
                elif calc_P > P_sat_at_fixed_T:
                    # Subcooled liquid
                    calc_x = 0.0
                else:
                    # At saturation, keep user's quality if provided
                    calc_x = x_input if x_input is not None else 0.5

        # Ensure quality is within bounds
        if calc_x is not None:
            calc_x = max(0.0, min(1.0, calc_x))

        # Calculate properties using the enhanced function with IAPWS
        try:
            # Use calculation values for property calculation
            state2_props = calculate_water_properties(
                calc_T if calc_T is not None else T_original,
                calc_P if calc_P is not None else P_original,
                calc_x
            )
        except ValueError as e:
            return JSONResponse({"status": "error", "message": f"Could not calculate properties: {str(e)}"},
                                status_code=400)

        # Override display values with the correct ones
        if process == "Isothermal":
            state2_props["T"] = display_T  # Show exact T
            state2_props["P"] = display_P  # Show interpolated P
        elif process == "Isobaric":
            state2_props["P"] = display_P  # Show exact P
            state2_props["T"] = display_T  # Show interpolated T

        # Determine phase for display
        if state2_props["x"] == 0:
            phase = "subcooled_liquid"
        elif state2_props["x"] == 1:
            phase = "superheated_vapor"
        else:
            phase = "two_phase"

        gas_data_store["state2_submission"] = state2_props

        return JSONResponse({
            "status": "success",
            "T": round(state2_props["T"], 2),
            "P": round(state2_props["P"], 3),
            "v": round(state2_props["v"], 6),
            "x": round(state2_props["x"], 4),
            "u": round(state2_props["u"], 2),
            "h": round(state2_props["h"], 2),
            "s": round(state2_props["s"], 4),
            "phase": phase,
            "T_sat_at_P": T_sat_at_P,
            "P_sat_at_T": P_sat_at_T,
            "source": state2_props.get("source", "CSV")
        })

    except Exception as e:
        return JSONResponse({"status": "error", "message": f"Dynamic update failed: {str(e)}"}, status_code=400)


# -------------------------
#   RECEIVE PROCESS DATA (from sim2/sim3 final submit)
# -------------------------
@app.post("/submit-process")
async def submit_process(request: Request):
    """
    Stores the final State 2 data before redirecting to results.
    This route is called when the user hits the final 'Simulate' button.
    Handles BOTH Ideal Gas and Water/Steam.
    """
    try:
        data = await request.json()
        state1 = gas_data_store.get("latest_submission", {})
        gas_name = state1.get("gas_name", "unknown")

        print(f"📥 Received process submission for {gas_name}: {data.get('process')}")

        if gas_name == "water":
            # For water: we need to ensure state2 data exists
            state2_data = gas_data_store.get("state2_submission", {})
            
            # If state2_data is empty, try to get from the request
            if not state2_data and "state2" in data:
                state2_data = data["state2"]
            
            if not state2_data:
                # Last resort: calculate from current inputs
                try:
                    T_input = data.get("T", state1.get("T_original"))
                    P_input = data.get("P", state1.get("P_original"))
                    x_input = data.get("x", 0.5)
                    
                    if T_input is not None and P_input is not None:
                        state2_data = calculate_water_properties(
                            float(T_input), 
                            float(P_input), 
                            float(x_input)
                        )
                except:
                    pass
            
            if not state2_data:
                return JSONResponse({
                    "status": "error", 
                    "message": "State 2 data not available. Please input values and recalculate."
                }, status_code=400)

            # Ensure all required properties exist
            required_props = ["T", "P", "v", "u", "h", "s", "x"]
            for prop in required_props:
                if prop not in state2_data:
                    state2_data[prop] = 0.0

            # Store complete process information
            gas_data_store["process_info"] = {
                "process": data.get("process", "Unknown"),
                "gas_name": "water",
                "state1": {
                    "T": state1.get("T"),
                    "P": state1.get("P"),
                    "v": state1.get("v"),
                    "u": state1.get("u"),
                    "h": state1.get("h"),
                    "s": state1.get("s"),
                    "x": state1.get("x", 0)
                },
                "state2": {
                    "T": float(state2_data.get("T", 0)),
                    "P": float(state2_data.get("P", 0)),
                    "v": float(state2_data.get("v", 0)),
                    "u": float(state2_data.get("u", 0)),
                    "h": float(state2_data.get("h", 0)),
                    "s": float(state2_data.get("s", 0)),
                    "x": float(state2_data.get("x", 0))
                }
            }
            
            print(f"✅ Stored water process info:")
            print(f"   Process: {data.get('process')}")
            print(f"   State 1: T={state1.get('T')}°C, P={state1.get('P')}bar, v={state1.get('v')}m³/kg")
            print(f"   State 2: T={state2_data.get('T')}°C, P={state2_data.get('P')}bar, v={state2_data.get('v')}m³/kg")
            
        else:
            # Ideal Gas logic
            gas_data_store["process_info"] = {
                "process": data.get("process", "Unknown"),
                "gas_name": gas_name,
                "v_ratio": data.get("v_ratio"),
                "p_ratio": data.get("p_ratio"),
                "n_value": data.get("n_value")
            }
            print(f"✅ Stored ideal gas process info for {gas_name}")

        return JSONResponse({"status": "success"})

    except Exception as e:
        print(f"❌ Error in submit-process: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse({"status": "error", "message": str(e)}, status_code=400)



# -------------------------
#   GET SIMULATION RESULTS
# -------------------------
@app.get("/get-simulate-results")
def get_simulate_results():
    return gas_data_store.get("process_info", {"message": "No process data available"})


# -------------------------
#   CALCULATE RESULTS AND SAVE PLOTS
# -------------------------
PROCESS_MAP = {
    "Constant Volume": "isochoric",
    "Constant Pressure": "isobaric",
    "Isothermal": "isothermal",
    "Adiabatic (n=k)": "adiabatic",
    "Polytropic": "polytropic"
}


@app.get("/get-results")
def get_results():
    """
    Returns results for both Ideal Gas and Water/Steam processes.
    Automatically detects which type and returns appropriate data.
    """
    try:
        process_info = gas_data_store.get("process_info", {})
        
        if not process_info:
            return JSONResponse({"error": "No simulation data found. Please run a simulation first."}, 
                              status_code=400)
        
        gas_name = process_info.get("gas_name", "").lower()
        
        print(f"📤 Fetching results for {gas_name}, process: {process_info.get('process')}")
        
        if gas_name == "water":
            return get_water_results()
        else:
            # IDEAL GAS CALCULATIONS
            gas = gas_data_store.get("latest_submission", {})
            
            if not gas:
                return JSONResponse({"error": "No gas data found."}, status_code=400)
            
            raw_process = process_info.get("process", "")
            process_type = PROCESS_MAP.get(raw_process)
            
            if not process_type:
                return JSONResponse({"error": f"Unknown process type: {raw_process}"}, 
                                  status_code=400)
            
            # Get gas properties
            cp, cv, R, k = gas["cp"], gas["cv"], gas["R"], gas["k"]
            T1, P1, v1 = gas.get("T"), gas.get("P"), gas.get("v")
            gas_name_display = gas["gas_name"]
            
            # Get process ratios
            v_ratio = process_info.get("v_ratio", 1.0)
            p_ratio = process_info.get("p_ratio", 1.0)
            n = process_info.get("n_value")
            
            # State 2 calculations
            v2 = v1 * v_ratio
            
            if process_type == "isothermal":
                P2 = P1 * (v1 / v2)
                T2 = T1
                exponent = 1.0
            elif process_type == "polytropic":
                exponent = n if n is not None else 1.0
                P2 = P1 * (v1 / v2) ** exponent
                T2 = T1 * (v1 / v2) ** (exponent - 1)
            elif process_type == "adiabatic":
                exponent = k
                P2 = P1 * (v1 / v2) ** k
                T2 = T1 * (v1 / v2) ** (k - 1)
            elif process_type == "isochoric":
                P2 = P1 * p_ratio
                T2 = T1 * p_ratio
                v2 = v1
                exponent = np.inf
            elif process_type == "isobaric":
                T2 = T1 * v_ratio
                P2 = P1
                exponent = 0.0
            else:
                return JSONResponse({"error": "Unhandled process type."}, status_code=400)
            
            # Energy calculations
            u1, u2 = cv * T1, cv * T2
            h1, h2 = cp * T1, cp * T2
            delta_u, delta_h = u2 - u1, h2 - h1
            
            # Work calculation
            if process_type == "isochoric":
                W = 0
            elif process_type == "isobaric":
                W = P1 * (v2 - v1)
            elif process_type == "isothermal":
                W = R * T1 * np.log(v2 / v1)
            elif process_type in ("polytropic", "adiabatic"):
                if np.isclose(exponent, 1.0):
                    W = R * T1 * np.log(v2 / v1)
                else:
                    W = (P2 * v2 - P1 * v1) / (1 - exponent)
            
            # Heat and entropy
            Q = delta_u + W
            delta_s = cp * np.log(T2 / T1) - R * np.log(P2 / P1)
            s1 = cp * np.log(T1) - R * np.log(P1)
            s2 = s1 + delta_s
            
            # Generate P-v plot
            if v1 == v2:
                v_vals = np.full(100, v1)
            else:
                v_vals = np.linspace(min(v1, v2), max(v1, v2), 100)
            
            if process_type == "isochoric":
                v_vals = np.full(100, v1)
                P_vals = np.linspace(P1, P2, 100)
            elif process_type == "isobaric":
                P_vals = np.full(100, P1)
            elif process_type == "isothermal":
                P_vals = P1 * v1 / v_vals
            elif process_type == "adiabatic":
                P_vals = P1 * (v1 / v_vals) ** k
            elif process_type == "polytropic":
                P_vals = P1 * (v1 / v_vals) ** n
            
            if v1 > v2 and v1 != v2:
                v_vals = v_vals[::-1]
                P_vals = P_vals[::-1]
            
            pv_plot_file = images_path / "pv_diagram.png"
            plt.figure()
            plt.plot(v_vals, P_vals, linewidth=2)
            plt.scatter([v1, v2], [P1, P2], color='red')
            plt.xlabel("v (m³/kg)")
            plt.ylabel("P (kPa)")
            plt.title("P–v Diagram")
            plt.grid(True)
            plt.savefig(pv_plot_file)
            plt.close()
            
            # Generate T-s plot
            if process_type == "isothermal":
                T_vals = np.full(100, T1)
                s_vals = np.linspace(s1, s2, 100)
            elif process_type == "adiabatic":
                s_vals = np.full(100, s1)
                T_vals = np.linspace(T1, T2, 100)
            else:
                T_vals = np.linspace(T1, T2, 100)
                s_vals = np.linspace(s1, s2, 100)
            
            if T1 > T2 and T1 != T2:
                T_vals = T_vals[::-1]
                s_vals = s_vals[::-1]
            
            ts_plot_file = images_path / "ts_diagram.png"
            plt.figure()
            plt.plot(s_vals, T_vals, linewidth=2)
            plt.scatter([s1, s2], [T1, T2], color='red')
            plt.xlabel("s (kJ/kg·K)")
            plt.ylabel("T (K)")
            plt.title("T–s Diagram")
            plt.grid(True)
            plt.savefig(ts_plot_file)
            plt.close()
            
            return {
                "gas_name": gas_name_display,
                "process_type": process_type,
                "state1": {
                    "T": round(T1, 5),
                    "P": round(P1, 5),
                    "v": round(v1, 5),
                    "u": round(u1, 5),
                    "h": round(h1, 5),
                    "s": round(s1, 5)
                },
                "state2": {
                    "T": round(T2, 5),
                    "P": round(P2, 5),
                    "v": round(v2, 5),
                    "u": round(u2, 5),
                    "h": round(h2, 5),
                    "s": round(s2, 5)
                },
                "processed": {
                    "W": round(W, 5),
                    "Q": round(Q, 5),
                    "delta_u": round(delta_u, 5),
                    "delta_h": round(delta_h, 5),
                    "delta_s": round(delta_s, 5)
                },
                "pv_img": f"/static/images/pv_diagram.png",
                "ts_img": f"/static/images/ts_diagram.png"
            }
            
    except Exception as e:
        print(f"❌ Error in get-results: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": f"Failed to get results: {str(e)}"}, status_code=500)

# -------------------------
#   NEW WATER RESULTS ROUTE
# -------------------------
@app.get("/get-water-results")
def get_water_results():
    """
    Returns Water/Steam process results with plots in same format as ideal gas.
    """
    try:
        process_info = gas_data_store.get("process_info", {})
        
        if not process_info:
            return JSONResponse({"error": "No water process data available. Run simulation first."}, 
                              status_code=400)
        
        # Get State 1 and State 2 data
        state1 = process_info.get("state1", {})
        state2 = process_info.get("state2", {})
        
        if not state1 or not state2:
            return JSONResponse({"error": "Incomplete state data."}, status_code=400)
        
        # Extract all properties
        T1 = float(state1.get("T", 0))
        P1 = float(state1.get("P", 0))
        v1 = float(state1.get("v", 0))
        u1 = float(state1.get("u", 0))
        h1 = float(state1.get("h", 0))
        s1 = float(state1.get("s", 0))
        x1 = float(state1.get("x", 0))
        
        T2 = float(state2.get("T", 0))
        P2 = float(state2.get("P", 0))
        v2 = float(state2.get("v", 0))
        u2 = float(state2.get("u", 0))
        h2 = float(state2.get("h", 0))
        s2 = float(state2.get("s", 0))
        x2 = float(state2.get("x", 0))
        
        process_type = process_info.get("process", "Unknown")
        
        print(f"📊 Water Results Calculation:")
        print(f"   Process: {process_type}")
        print(f"   State 1: T={T1}°C, P={P1}bar, v={v1}m³/kg, u={u1}, h={h1}, s={s1}, x={x1}")
        print(f"   State 2: T={T2}°C, P={P2}bar, v={v2}m³/kg, u={u2}, h={h2}, s={s2}, x={x2}")
        
        # --- PROCESS CALCULATIONS ---
        delta_u = u2 - u1
        delta_h = h2 - h1
        delta_s = s2 - s1
        
        # Work calculation based on process type
        W = 0.0
        if process_type == "Constant Pressure":  # Isobaric
            # W = P * (v2 - v1) * 100 (convert bar to kPa)
            W = P1 * 100 * (v2 - v1)
        elif process_type == "Constant Volume":  # Isochoric
            W = 0.0
        elif process_type == "Isothermal":
            # Approximate work using average pressure
            avg_P = (P1 + P2) / 2
            W = avg_P * 100 * (v2 - v1)
        elif process_type == "Adiabatic":
            # For adiabatic: W = -ΔU (since Q=0)
            W = -delta_u
        
        # Heat calculation using First Law
        Q = delta_u + W
        
        print(f"   Calculated: Δu={delta_u:.2f}, Δh={delta_h:.2f}, Δs={delta_s:.4f}")
        print(f"   Work (W) = {W:.2f} kJ/kg, Heat (Q) = {Q:.2f} kJ/kg")
        
        # --- SMART SCALING ANALYSIS ---
        print(f"   Scaling analysis:")
        print(f"     v1={v1:.6f}, v2={v2:.6f}, ratio={max(v1, v2)/min(v1, v2):.6f}")
        print(f"     P1={P1:.3f}, P2={P2:.3f}, ratio={max(P1, P2)/min(P1, P2):.6f}")
        print(f"     Δv={abs(v2-v1):.8f}, % change={abs(v2-v1)/v1*100:.6f}%")
        
        # --- CREATE P-v DIAGRAM (640x480) ---
        water_pv_plot_file = images_path / "water_pv_diagram.png"
        
        # Set figure size to 640x480 pixels at 100 DPI
        plt.figure(figsize=(6.4, 4.8), dpi=100)
        
        # Determine if we need saturation dome (if temperatures are in reasonable range)
        show_saturation = (T1 < 374 and T2 < 374) and (min(T1, T2) < 374)
        
        if show_saturation:
            # Plot saturation dome (if within range)
            T_min = min(T1, T2)
            T_max = max(T1, T2)
            T_range = np.linspace(max(0.01, T_min-5), min(374, T_max+5), 50)
            P_sat_vals = []
            vf_vals = []
            vg_vals = []
            
            for T in T_range:
                Psat, _ = get_psat(T)
                if Psat:
                    P_sat_vals.append(Psat)
                    vf = interpolate_water_property_by_T(T, "vf")
                    vg = interpolate_water_property_by_T(T, "vg")
                    vf_vals.append(vf)
                    vg_vals.append(vg)
            
            # Only plot if we have valid data
            if P_sat_vals and vf_vals and vg_vals:
                plt.plot(vf_vals, P_sat_vals, 'b-', alpha=0.5, linewidth=1, label='Saturated Liquid')
                plt.plot(vg_vals, P_sat_vals, 'r-', alpha=0.5, linewidth=1, label='Saturated Vapor')
        
        # Plot process line (like ideal gas plots)
        # For constant pressure process, make line thicker and more visible
        linewidth = 3 if process_type == "Constant Pressure" else 2
        plt.plot([v1, v2], [P1, P2], 'k-', linewidth=linewidth, label=f'{process_type} Process')
        plt.scatter([v1, v2], [P1, P2], color='red', s=80, zorder=5)
        
        # Add labels for states with offset to avoid overlap
        offset_x1 = (v2 - v1) * 0.3 if v2 != v1 else v1 * 0.01
        offset_x2 = (v1 - v2) * 0.3 if v1 != v2 else v2 * 0.01
        
        # plt.text(v1 + offset_x1, P1, ' State 1', verticalalignment='bottom', 
        #         fontsize=9, bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8))
        # plt.text(v2 + offset_x2, P2, ' State 2', verticalalignment='bottom', 
        #         fontsize=9, bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8))
        
        plt.xlabel("v (m³/kg)", fontsize=11)
        plt.ylabel("P (bar)", fontsize=11)
        plt.title(f"P–v Diagram: {process_type}", fontsize=12)
        plt.grid(True, alpha=0.3)
        
        # SMART SCALING for P-v diagram based on your specific data
        v_min, v_max = min(v1, v2), max(v1, v2)
        P_min, P_max = min(P1, P2), max(P1, P2)
        
        # For your specific case (tiny volume change at constant pressure)
        if abs(v2 - v1) / v1 < 0.01:  # Less than 1% volume change
            # Expand x-axis around the values
            v_range = abs(v_max - v_min)
            if v_range < 1e-9:  # Nearly identical volumes
                v_padding = v1 * 0.1  # 10% padding
            else:
                v_padding = v_range * 5  # 5x the range as padding
            
            plt.xlim([v_min - v_padding, v_max + v_padding])
            print(f"   P-v: Applied expanded linear scaling (tiny volume change)")
            
            # For constant pressure, add small vertical range for visibility
            if P1 == P2:
                P_padding = P1 * 0.05  # 5% padding
                plt.ylim([P_min - P_padding, P_max + P_padding])
        else:
            # For larger changes, use log scale if needed
            if v_max / v_min > 10:
                plt.xscale('log')
                print(f"   P-v: Applied log scale on x-axis")
            if P_max / P_min > 10:
                plt.yscale('log')
                print(f"   P-v: Applied log scale on y-axis")
        
        # Legend always in top-right (like ideal gas plots)
        if show_saturation and P_sat_vals and vf_vals and vg_vals:
            plt.legend(loc='upper right')
        else:
            plt.legend(loc='upper right')
        
        plt.tight_layout()
        plt.savefig(water_pv_plot_file, bbox_inches='tight')
        plt.close()
        
        # --- CREATE T-s DIAGRAM (640x480) ---
        water_ts_plot_file = images_path / "water_ts_diagram.png"
        
        # Set figure size to 640x480 pixels at 100 DPI
        plt.figure(figsize=(6.4, 4.8), dpi=100)
        
        # Plot saturation dome if relevant
        if show_saturation and P_sat_vals:
            sf_vals = [interpolate_water_property_by_T(T, "sf") for T in T_range]
            sg_vals = [interpolate_water_property_by_T(T, "sg") for T in T_range]
            
            valid_indices = [i for i, (sf, sg) in enumerate(zip(sf_vals, sg_vals)) 
                           if sf is not None and sg is not None]
            
            if valid_indices:
                T_range_valid = [T_range[i] for i in valid_indices]
                sf_valid = [sf_vals[i] for i in valid_indices]
                sg_valid = [sg_vals[i] for i in valid_indices]
                
                plt.plot(sf_valid, T_range_valid, 'b-', alpha=0.5, linewidth=1, label='Saturated Liquid')
                plt.plot(sg_valid, T_range_valid, 'r-', alpha=0.5, linewidth=1, label='Saturated Vapor')
        
        # Plot process line (like ideal gas plots)
        linewidth = 3 if process_type == "Constant Pressure" else 2
        plt.plot([s1, s2], [T1, T2], 'k-', linewidth=linewidth, label=f'{process_type} Process')
        plt.scatter([s1, s2], [T1, T2], color='red', s=80, zorder=5)
        
        # Add labels for states
        offset_s1 = (s2 - s1) * 0.3 if s2 != s1 else 0.01
        offset_s2 = (s1 - s2) * 0.3 if s1 != s2 else 0.01
        
        # plt.text(s1 + offset_s1, T1, ' State 1', verticalalignment='bottom', 
        #         fontsize=9, bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8))
        # plt.text(s2 + offset_s2, T2, ' State 2', verticalalignment='bottom', 
        #         fontsize=9, bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8))
        
        plt.xlabel("s (kJ/kg·K)", fontsize=11)
        plt.ylabel("T (°C)", fontsize=11)
        plt.title(f"T–s Diagram: {process_type}", fontsize=12)
        plt.grid(True, alpha=0.3)
        
        # SMART SCALING for T-s diagram
        # For your data (0.03 to 0.31 kJ/kg·K entropy change)
        s_min, s_max = min(s1, s2), max(s1, s2)
        T_min, T_max = min(T1, T2), max(T1, T2)
        
        # Add padding for better visibility
        s_padding = (s_max - s_min) * 0.2
        T_padding = (T_max - T_min) * 0.2
        
        # Ensure minimum padding for very small ranges
        s_padding = max(s_padding, 0.01)
        T_padding = max(T_padding, 5)
        
        plt.xlim([s_min - s_padding, s_max + s_padding])
        plt.ylim([T_min - T_padding, T_max + T_padding])
        
        print(f"   T-s: Applied linear scaling with padding (s range: {s_min:.3f} to {s_max:.3f})")
        
        # Legend always in top-right (like ideal gas plots)
        if show_saturation and valid_indices:
            plt.legend(loc='upper right')
        else:
            plt.legend(loc='upper right')
        
        plt.tight_layout()
        plt.savefig(water_ts_plot_file, bbox_inches='tight')
        plt.close()
        
        print(f"✅ Generated plots: {water_pv_plot_file}, {water_ts_plot_file}")
        
        return {
            "gas_name": "water",
            "process_type": process_type,
            "state1": {
                "T": round(T1, 3),
                "P": round(P1, 3),
                "v": round(v1, 6),
                "u": round(u1, 3),
                "h": round(h1, 3),
                "s": round(s1, 5),
                "x": round(x1, 4)
            },
            "state2": {
                "T": round(T2, 3),
                "P": round(P2, 3),
                "v": round(v2, 6),
                "u": round(u2, 3),
                "h": round(h2, 3),
                "s": round(s2, 5),
                "x": round(x2, 4)
            },
            "processed": {
                "W": round(W, 3),
                "Q": round(Q, 3),
                "delta_u": round(delta_u, 3),
                "delta_h": round(delta_h, 3),
                "delta_s": round(delta_s, 5)
            },
            "pv_img": f"/static/images/water_pv_diagram.png?t={int(time.time())}",
            "ts_img": f"/static/images/water_ts_diagram.png?t={int(time.time())}"
        }
        
    except Exception as e:
        print(f"❌ Error in get-water-results: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": f"Failed to get water results: {str(e)}"}, status_code=500)


@app.get("/debug-state1")
def debug_state1():
    """Check what's in State 1 storage"""
    state1 = gas_data_store.get("latest_submission", {})
    return {
        "has_data": bool(state1),
        "gas_name": state1.get("gas_name"),
        "P_original": state1.get("P_original"),
        "P": state1.get("P"),
        "T_original": state1.get("T_original"),
        "T": state1.get("T"),
        "all_data": state1
    }