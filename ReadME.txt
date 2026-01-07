THERMOSIM INSTRUCTION MANUAL
================================

STARTING THE APPLICATION:
1. Double-click "run_server.bat" file
2. Wait 3 seconds for browser to open automatically
3. Application loads at: http://127.0.0.1:8000

⚠️ IMPORTANT: After making code changes, press F5 to refresh browser

SIMULATION WORKFLOW:
-------------------
STEP 1: SELECT GAS & INITIAL STATE (simulation1.html)
• Choose gas type: Ideal Gas (Air, Nitrogen, etc.) or Water/Steam
• Enter initial conditions (P, T, v, or quality)
• Click "Submit" button

STEP 2: SELECT PROCESS TYPE
• For Ideal Gas: Go to simulation2.html
• For Water/Steam: Go to simulation3.html

FOR IDEAL GAS (simulation2.html):
• Select process: Isobaric, Isothermal, Isochoric, Adiabatic, Polytropic
• Enter volume ratio (v_ratio) or pressure ratio (p_ratio)
• For polytropic: Enter n-value
• Click "Simulate" button

FOR WATER/STEAM (simulation3.html):
• Select process: Isobaric, Isothermal, Isochoric, Adiabatic
• Adjust temperature or pressure using input fields
• For saturated states: Adjust quality (x) between 0-1
• System auto-calculates properties as you type
• Click "Simulate" button when ready

STEP 3: VIEW RESULTS (results.html)
• Shows State 1 and State 2 properties
• Displays Work (W) and Heat (Q) calculations
• Shows P-v and T-s diagrams
• Download PDF report using "Download Data (PDF)" button

KEY CONTROLS:
• Temperature/Pressure: Use number inputs
• Quality (x): Only for water in saturated region (0 to 1)
• Process selection: Radio buttons
• Navigation: Top menu or "Back to Inputs" button

UNIT SYSTEMS:
IDEAL GAS:
• Temperature: Kelvin (K)
• Pressure: kilopascals (kPa)
• Specific Volume: m³/kg

WATER/STEAM:
• Temperature: Celsius (°C)
• Pressure: bar
• Specific Volume: m³/kg
• Quality: dimensionless (0-1)

TROUBLESHOOTING:
1. If browser doesn't open: Go to http://127.0.0.1:8000 manually
2. If changes don't appear: Press F5 to refresh browser
3. If water properties fail: Check temperature is between 0.01°C and 374°C
4. If server doesn't start: Ensure Python 3.8+ is installed

QUICK EXAMPLES:
1. Air Isobaric: Select Air → P=100kPa, v=0.5m³/kg → Isobaric → v_ratio=2
2. Water Isobaric: Select Water → T=150°C, x=0.5 → Isobaric → Increase T
3. Adiabatic Compression: Any gas → Adiabatic → v_ratio=0.5 (compression)

KEY FEATURES:
• Real-time calculations for water/steam
• Interactive diagrams
• PDF report generation
• Mobile-friendly interface
• Dark/light mode support