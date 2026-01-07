// static/js/simulation3-logic.js - With IAPWS Integration (Now with Isochoric and Adiabatic)
document.addEventListener("DOMContentLoaded", () => {
    // --- Elements ---
    const processRadios = document.querySelectorAll("input[name='thermodynamic_process']");
    const pressureInput = document.getElementById("pressure-input");
    const tempInput = document.getElementById("temp-input");
    const volumeInput = document.getElementById("volume-input");
    const qualityInput = document.getElementById("quality-input");
    const uOutput = document.getElementById("u-output");
    const hOutput = document.getElementById("h-output");
    const sOutput = document.getElementById("s-output");
    const simulateBtn = document.getElementById("simulate-btn");

    // --- Constants ---
    const T_SAT_MARGIN = 0.5;
    const P_SAT_MARGIN = 0.1;
    
    // Process state
    let currentProcess = "Isobaric";
    
    // Control flags
    let isUserTypingQuality = false;
    let qualityInputTimeout = null;
    let isUserTypingVolume = false;
    let volumeInputTimeout = null;
    let isUserTypingPressure = false;
    let pressureInputTimeout = null;
    let isUserTypingTemperature = false;
    let temperatureInputTimeout = null;
    
    // Store user's original input to prevent overwriting
    let lastUserTemperatureInput = null;
    let lastUserPressureInput = null;
    
    // Thermodynamic data
    let state1 = {};
    let gasName = "";
    let exactPressure = null;          // For isobaric: P1 = P2
    let exactTemperature = null;       // For isothermal: T1 = T2
    let fixedVolume = null;            // For isochoric: v1 = v2
    let fixedEntropy = null;           // For adiabatic: s1 = s2
    let T_sat_at_P = null;
    let P_sat_at_T = null;
    
    // Saturation properties at current pressure
    let sat_vf = null;
    let sat_vg = null;
    let sat_uf = null;
    let sat_ug = null;
    let sat_hf = null;
    let sat_hfg = null;
    let sat_sf = null;
    let sat_sg = null;

    // --- Helper Functions ---
    function setReadonlyField(field, readonly) {
        field.readOnly = readonly;
        field.classList.toggle("bg-gray-200", readonly);
        field.classList.toggle("dark:bg-gray-700", readonly);
        field.classList.toggle("cursor-not-allowed", readonly);
    }

    // === CHECK PHASE FOR ISOCHORIC ===
    function getCurrentPhaseIsochoric() {
        const currentT = parseFloat(tempInput.value);
        const currentP = parseFloat(pressureInput.value);
        
        if (isNaN(currentT) || isNaN(currentP)) return 'unknown';
        
        // For isochoric, we need to check if current (P,T) corresponds to saturation
        // We'll use backend for accurate phase detection, but for UI responsiveness:
        
        // Get saturation temperature at current pressure (if we have it)
        if (T_sat_at_P !== null) {
            if (Math.abs(currentT - T_sat_at_P) <= T_SAT_MARGIN) {
                return 'saturated';
            } else if (currentT > T_sat_at_P) {
                return 'superheated';  // T > T_sat → superheated
            } else {
                return 'subcooled';    // T < T_sat → subcooled
            }
        }
        
        // Get saturation pressure at current temperature (if we have it)
        if (P_sat_at_T !== null) {
            if (Math.abs(currentP - P_sat_at_T) <= P_SAT_MARGIN) {
                return 'saturated';
            } else if (currentP < P_sat_at_T) {
                return 'superheated';  // P < P_sat → superheated
            } else {
                return 'subcooled';    // P > P_sat → subcooled
            }
        }
        
        return 'unknown';
    }

    // === CHECK PHASE FOR ADIABATIC ===
    function getCurrentPhaseAdiabatic() {
        const currentT = parseFloat(tempInput.value);
        const currentP = parseFloat(pressureInput.value);
        
        if (isNaN(currentT) || isNaN(currentP)) return 'unknown';
        
        // Similar logic to isochoric for phase detection
        if (T_sat_at_P !== null) {
            if (Math.abs(currentT - T_sat_at_P) <= T_SAT_MARGIN) {
                return 'saturated';
            } else if (currentT > T_sat_at_P) {
                return 'superheated';
            } else {
                return 'subcooled';
            }
        }
        
        if (P_sat_at_T !== null) {
            if (Math.abs(currentP - P_sat_at_T) <= P_SAT_MARGIN) {
                return 'saturated';
            } else if (currentP < P_sat_at_T) {
                return 'superheated';
            } else {
                return 'subcooled';
            }
        }
        
        return 'unknown';
    }

    // === CHECK PHASE (ISOBARIC) ===
    function getCurrentPhaseIsobaric() {
        const currentT = parseFloat(tempInput.value);
        if (!T_sat_at_P || isNaN(currentT)) return 'unknown';
        
        if (Math.abs(currentT - T_sat_at_P) <= T_SAT_MARGIN) {
            return 'saturated';
        } else if (currentT > T_sat_at_P) {
            return 'superheated';
        } else {
            return 'subcooled';
        }
    }

    // === CHECK PHASE (ISOTHERMAL) ===
    function getCurrentPhaseIsothermal() {
        const currentP = parseFloat(pressureInput.value);
        if (!P_sat_at_T || isNaN(currentP)) return 'unknown';
        
        if (Math.abs(currentP - P_sat_at_T) <= P_SAT_MARGIN) {
            return 'saturated';
        } else if (currentP < P_sat_at_T) {
            return 'superheated';
        } else {
            return 'subcooled';
        }
    }

    // === GET CURRENT PHASE ===
    function getCurrentPhase() {
        if (currentProcess === "Isobaric") {
            return getCurrentPhaseIsobaric();
        } else if (currentProcess === "Isothermal") {
            return getCurrentPhaseIsothermal();
        } else if (currentProcess === "Isochoric") {
            return getCurrentPhaseIsochoric();
        } else if (currentProcess === "Adiabatic") {
            return getCurrentPhaseAdiabatic();
        }
        return 'unknown';
    }

    // === FETCH PROPERTIES FROM BACKEND (IAPWS) ===
    async function fetchPropertiesFromBackend(skipQualityUpdate = false, skipPropertyUpdate = false) {
        const currentT = parseFloat(tempInput.value);
        const currentP = parseFloat(pressureInput.value);
        const currentQuality = parseFloat(qualityInput.value);
        const currentV = parseFloat(volumeInput.value);
        
        let payload = {
            process: currentProcess,
            gas_name: gasName,
            P: isNaN(currentP) ? null : currentP,
            T: isNaN(currentT) ? null : currentT,
            v: isNaN(currentV) ? null : currentV,
            x: isNaN(currentQuality) ? null : currentQuality
        };
        
        // Add process-specific fixed values
        if (currentProcess === "Isobaric") {
            payload.P = exactPressure; // Fixed pressure for isobaric (P1 = P2)
            // Use temperature from input or saturation temp
            payload.T = isNaN(currentT) ? T_sat_at_P : currentT;
        } else if (currentProcess === "Isothermal") {
            payload.T = exactTemperature; // Fixed temperature for isothermal (T1 = T2)
            // Use pressure from input or saturation pressure
            payload.P = isNaN(currentP) ? P_sat_at_T : currentP;
        } else if (currentProcess === "Isochoric") {
            // FOR ISOCHORIC: v1 = v2 is the primary constraint
            // We send the fixed volume and either T or P (or x) to calculate the other properties
            payload.v = fixedVolume; // Fixed volume for isochoric (v1 = v2)
            
            // If user is typing in temperature, use that to calculate P
            if (isUserTypingTemperature && !isNaN(currentT)) {
                payload.T = currentT;
                payload.P = null; // Let backend calculate P from v and T
                payload.x = null; // Clear quality since we're using T
            }
            // If user is typing in pressure, use that to calculate T
            else if (isUserTypingPressure && !isNaN(currentP)) {
                payload.P = currentP;
                payload.T = null; // Let backend calculate T from v and P
                payload.x = null; // Clear quality since we're using P
            }
            // If user is typing in quality, use that to calculate both T and P (saturated region only)
            else if (isUserTypingQuality && !isNaN(currentQuality)) {
                payload.x = currentQuality;
                payload.P = null; // Let backend calculate P from v and x
                payload.T = null; // Let backend calculate T from v and x
            }
            // Default: send both T and P for backend to verify/calculate
        } else if (currentProcess === "Adiabatic") {
            // FOR ADIABATIC: s1 = s2 is the primary constraint
            // We send the fixed entropy and either T or P to calculate the other properties
            payload.s = fixedEntropy; // Fixed entropy for adiabatic (s1 = s2)
            
            // If user is typing in temperature, use that to calculate P
            if (isUserTypingTemperature && !isNaN(currentT)) {
                payload.T = currentT;
                payload.P = null; // Let backend calculate P from s and T
                payload.x = null; // Clear quality since we're using T
            }
            // If user is typing in pressure, use that to calculate T
            else if (isUserTypingPressure && !isNaN(currentP)) {
                payload.P = currentP;
                payload.T = null; // Let backend calculate T from s and P
                payload.x = null; // Clear quality since we're using P
            }
            // If user is typing in quality, use that to calculate both T and P (saturated region only)
            else if (isUserTypingQuality && !isNaN(currentQuality)) {
                payload.x = currentQuality;
                payload.P = null; // Let backend calculate P from s and x
                payload.T = null; // Let backend calculate T from s and x
            }
            // Default: send both T and P for backend to verify/calculate
        }
        
        console.log("Fetching properties from backend (IAPWS):", payload);
        
        try {
            const response = await fetch("/submit-next-stage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();
            if (result && result.status === "success") {
                console.log("Backend IAPWS result:", result);
                // Add flag to indicate if we should skip quality update
                result.skipQualityUpdate = skipQualityUpdate;
                result.skipPropertyUpdate = skipPropertyUpdate;
                return result;
            }
        } catch (error) {
            console.error("Error fetching from backend:", error);
        }
        
        return null;
    }

    // === UPDATE SATURATED PROPERTIES INSTANTLY (LOCAL) ===
    function updateSaturatedPropertiesInstantly() {
        if (isUserTypingQuality || isUserTypingVolume) return; // Don't update while user is typing
        
        const currentQuality = parseFloat(qualityInput.value);
        
        if (isNaN(currentQuality) || currentQuality < 0 || currentQuality > 1) {
            return;
        }
        
        console.log("Updating SATURATED properties with x =", currentQuality);
        
        // Check if we have all required data
        if (!sat_vf || !sat_vg || !sat_uf || !sat_ug || 
            !sat_hf || !sat_hfg || !sat_sf || !sat_sg) {
            console.warn("Missing saturation property data!");
            return;
        }
        
        // Calculate SATURATED properties (two-phase region)
        // v = vf + x*(vg - vf)
        const calculatedV = sat_vf + currentQuality * (sat_vg - sat_vf);
        // Only update volume if not isochoric (where v is fixed)
        if (!isUserTypingVolume && currentProcess !== "Isochoric") {
            volumeInput.value = calculatedV.toFixed(6);
        }
        
        // u = uf + x*(ug - uf)
        const calculatedU = sat_uf + currentQuality * (sat_ug - sat_uf);
        uOutput.textContent = calculatedU.toFixed(2);
        
        // h = hf + x*hfg
        const calculatedH = sat_hf + currentQuality * sat_hfg;
        hOutput.textContent = calculatedH.toFixed(2);
        
        // s = sf + x*(sg - sf)
        const calculatedS = sat_sf + currentQuality * (sat_sg - sat_sf);
        sOutput.textContent = calculatedS.toFixed(4);
        
        console.log("SATURATED results (local):", {
            v: calculatedV.toFixed(6),
            u: calculatedU.toFixed(2),
            h: calculatedH.toFixed(2),
            s: calculatedS.toFixed(4)
        });
    }

    // === UPDATE SATURATED PROPERTIES FROM BACKEND ===
    async function updateSaturatedPropertiesFromBackend(skipQualityUpdate = false, skipPropertyUpdate = false) {
        console.log("Updating SATURATED properties from backend");
        
        // Store user's current input before fetching
        const userTempBeforeFetch = tempInput.value;
        const userPressureBeforeFetch = pressureInput.value;
        
        // Fetch accurate saturated properties from backend (IAPWS)
        const result = await fetchPropertiesFromBackend(skipQualityUpdate, skipPropertyUpdate);
        
        if (result) {
            // Only update properties if we're not skipping them
            if (!skipPropertyUpdate) {
                // Update volume only if user isn't typing in volume field AND not isochoric
                if (!isUserTypingVolume && result.v !== undefined && currentProcess !== "Isochoric") {
                    volumeInput.value = Number(result.v).toFixed(6);
                }
                
                // CRITICAL FIX: Don't overwrite user's temperature input for isobaric
                if (currentProcess === "Isobaric") {
                    // Temperature is editable by user - RESTORE user's input
                    if (userTempBeforeFetch && !isUserTypingTemperature) {
                        tempInput.value = userTempBeforeFetch;
                    }
                    
                    // Update other properties only
                    if (result.u !== undefined) uOutput.textContent = Number(result.u).toFixed(2);
                    if (result.h !== undefined) hOutput.textContent = Number(result.h).toFixed(2);
                    if (result.s !== undefined) sOutput.textContent = Number(result.s).toFixed(4);
                }
                // CRITICAL FIX: Don't overwrite user's pressure input for isothermal
                else if (currentProcess === "Isothermal") {
                    // Pressure is editable by user - RESTORE user's input
                    if (userPressureBeforeFetch && !isUserTypingPressure) {
                        pressureInput.value = userPressureBeforeFetch;
                    }
                    
                    // Update other properties only
                    if (result.u !== undefined) uOutput.textContent = Number(result.u).toFixed(2);
                    if (result.h !== undefined) hOutput.textContent = Number(result.h).toFixed(2);
                    if (result.s !== undefined) sOutput.textContent = Number(result.s).toFixed(4);
                }
                // For isochoric/adiabatic: update T and P only if user isn't typing
                else if (currentProcess === "Isochoric" || currentProcess === "Adiabatic") {
                    // Update pressure only if user isn't currently typing
                    if (!isUserTypingPressure && result.P !== undefined) {
                        pressureInput.value = Number(result.P).toFixed(3);
                    }
                    
                    // Update temperature only if user isn't currently typing
                    if (!isUserTypingTemperature && result.T !== undefined) {
                        tempInput.value = Number(result.T).toFixed(2);
                    }
                    
                    // Update other properties
                    if (result.u !== undefined) uOutput.textContent = Number(result.u).toFixed(2);
                    if (result.h !== undefined) hOutput.textContent = Number(result.h).toFixed(2);
                    if (result.s !== undefined) sOutput.textContent = Number(result.s).toFixed(4);
                } else {
                    // For other processes (shouldn't happen), update normally
                    if (result.u !== undefined) uOutput.textContent = Number(result.u).toFixed(2);
                    if (result.h !== undefined) hOutput.textContent = Number(result.h).toFixed(2);
                    if (result.s !== undefined) sOutput.textContent = Number(result.s).toFixed(4);
                }
            }
            
            // Only update quality if we're not skipping it AND user isn't typing
            if (!skipQualityUpdate && !isUserTypingQuality && result.x !== undefined) {
                qualityInput.value = Number(result.x).toFixed(4);
            }
            
            // Update saturation properties if provided
            if (result.T_sat !== undefined) T_sat_at_P = result.T_sat;
            if (result.P_sat !== undefined) P_sat_at_T = result.P_sat;
            
            console.log("SATURATED results from IAPWS:", {
                T: result.T,
                P: result.P,
                v: result.v,
                u: result.u,
                h: result.h,
                s: result.s,
                x: result.x
            });
        } else {
            console.error("Failed to fetch saturated properties from IAPWS, using local calculation");
            if (!isUserTypingQuality && !skipPropertyUpdate) {
                updateSaturatedPropertiesInstantly();
            }
        }
    }

    // === UPDATE SUPERHEATED PROPERTIES ===
    async function updateSuperheatedProperties() {
        console.log("Updating SUPERHEATED properties - fetching from IAPWS");
        
        // Store user's current input before fetching
        const userTempBeforeFetch = tempInput.value;
        const userPressureBeforeFetch = pressureInput.value;
        
        // Fetch accurate superheated properties from backend (IAPWS)
        const result = await fetchPropertiesFromBackend();
        
        if (result) {
            // CRITICAL FIX: Handle each process type separately to preserve user input
            if (currentProcess === "Isobaric") {
                // For isobaric: temperature is editable, pressure is fixed (P1 = P2)
                // RESTORE user's temperature input
                if (userTempBeforeFetch && !isUserTypingTemperature) {
                    tempInput.value = userTempBeforeFetch;
                }
                
                // Pressure is fixed/readonly (P1 = P2), so update it
                if (result.P !== undefined && !isUserTypingPressure) {
                    pressureInput.value = Number(result.P).toFixed(3);
                }
                
            } else if (currentProcess === "Isothermal") {
                // For isothermal: pressure is editable, temperature is fixed (T1 = T2)
                // RESTORE user's pressure input
                if (userPressureBeforeFetch && !isUserTypingPressure) {
                    pressureInput.value = userPressureBeforeFetch;
                }
                
                // Temperature is fixed/readonly (T1 = T2), so update it
                if (result.T !== undefined && !isUserTypingTemperature) {
                    tempInput.value = Number(result.T).toFixed(2);
                }
                
            } else if (currentProcess === "Isochoric" || currentProcess === "Adiabatic") {
                // For isochoric/adiabatic: both T and P can be editable
                // Only update if user isn't currently typing
                if (!isUserTypingPressure && result.P !== undefined) {
                    pressureInput.value = Number(result.P).toFixed(3);
                }
                if (!isUserTypingTemperature && result.T !== undefined) {
                    tempInput.value = Number(result.T).toFixed(2);
                }
            }
            
            // Update volume only if user isn't typing in volume field AND not isochoric
            if (!isUserTypingVolume && result.v !== undefined && currentProcess !== "Isochoric") {
                volumeInput.value = Number(result.v).toFixed(6);
            }
            
            // Update other properties (these are calculated, not user inputs)
            if (result.u !== undefined) uOutput.textContent = Number(result.u).toFixed(2);
            if (result.h !== undefined) hOutput.textContent = Number(result.h).toFixed(2);
            if (result.s !== undefined) sOutput.textContent = Number(result.s).toFixed(4);
            
            // Quality is always 1 for superheated, but only set if user isn't typing
            if (!isUserTypingQuality && (result.force_quality_update || result.x !== undefined)) {
                qualityInput.value = "1.0000";
                setReadonlyField(qualityInput, true);
            }
            
            console.log("SUPERHEATED results from IAPWS:", {
                T: result.T,
                P: result.P,
                v: result.v,
                u: result.u,
                h: result.h,
                s: result.s
            });
        } else {
            console.error("Failed to fetch superheated properties from IAPWS");
        }
    }

    // === UPDATE SUBCOOLED PROPERTIES ===
    async function updateSubcooledProperties() {
        console.log("Updating SUBCOOLED properties - fetching from IAPWS");
        
        // Store user's current input before fetching
        const userTempBeforeFetch = tempInput.value;
        const userPressureBeforeFetch = pressureInput.value;
        
        // Fetch accurate subcooled properties from backend (IAPWS)
        const result = await fetchPropertiesFromBackend();
        
        if (result) {
            // CRITICAL FIX: Handle each process type separately to preserve user input
            if (currentProcess === "Isobaric") {
                // For isobaric: temperature is editable, pressure is fixed (P1 = P2)
                // RESTORE user's temperature input
                if (userTempBeforeFetch && !isUserTypingTemperature) {
                    tempInput.value = userTempBeforeFetch;
                }
                
                // Pressure is fixed/readonly (P1 = P2), so update it
                if (result.P !== undefined && !isUserTypingPressure) {
                    pressureInput.value = Number(result.P).toFixed(3);
                }
                
            } else if (currentProcess === "Isothermal") {
                // For isothermal: pressure is editable, temperature is fixed (T1 = T2)
                // RESTORE user's pressure input
                if (userPressureBeforeFetch && !isUserTypingPressure) {
                    pressureInput.value = userPressureBeforeFetch;
                }
                
                // Temperature is fixed/readonly (T1 = T2), so update it
                if (result.T !== undefined && !isUserTypingTemperature) {
                    tempInput.value = Number(result.T).toFixed(2);
                }
                
            } else if (currentProcess === "Isochoric" || currentProcess === "Adiabatic") {
                // For isochoric/adiabatic: both T and P can be editable
                // Only update if user isn't currently typing
                if (!isUserTypingPressure && result.P !== undefined) {
                    pressureInput.value = Number(result.P).toFixed(3);
                }
                if (!isUserTypingTemperature && result.T !== undefined) {
                    tempInput.value = Number(result.T).toFixed(2);
                }
            }
            
            // Update volume only if user isn't typing in volume field AND not isochoric
            if (!isUserTypingVolume && result.v !== undefined && currentProcess !== "Isochoric") {
                volumeInput.value = Number(result.v).toFixed(6);
            }
            
            // Update other properties (these are calculated, not user inputs)
            if (result.u !== undefined) uOutput.textContent = Number(result.u).toFixed(2);
            if (result.h !== undefined) hOutput.textContent = Number(result.h).toFixed(2);
            if (result.s !== undefined) sOutput.textContent = Number(result.s).toFixed(4);
            
            // Quality is always 0 for subcooled, but only set if user isn't typing
            if (!isUserTypingQuality && (result.force_quality_update || result.x !== undefined)) {
                qualityInput.value = "0.0000";
                setReadonlyField(qualityInput, true);
            }
            
            console.log("SUBCOOLED results from IAPWS:", {
                T: result.T,
                P: result.P,
                v: result.v,
                u: result.u,
                h: result.h,
                s: result.s
            });
        } else {
            console.error("Failed to fetch subcooled properties from IAPWS");
        }
    }

    // === HANDLE TEMPERATURE CHANGE (ISOBARIC) ===
    async function handleTemperatureChangeIsobaric() {
        const phase = getCurrentPhase();
        const currentT = parseFloat(tempInput.value);
        
        console.log("Temperature changed to:", currentT, "°C, Phase:", phase);
        
        // Store user's temperature value
        lastUserTemperatureInput = currentT;
        
        if (phase === 'saturated') {
            // At saturation - quality editable
            setReadonlyField(qualityInput, false);
            
            // If quality is 0 or 1 from previous state and user isn't typing, reset to 0.5
            const currentQuality = parseFloat(qualityInput.value);
            if (!isUserTypingQuality && (currentQuality === 0 || currentQuality === 1 || isNaN(currentQuality))) {
                qualityInput.value = "0.5000";
            }
            
            // Update saturated properties from backend for accuracy
            await updateSaturatedPropertiesFromBackend();
            
        } else if (phase === 'superheated') {
            // Superheated - quality fixed at 1
            setReadonlyField(qualityInput, true);
            
            // Fetch and update superheated properties from IAPWS
            await updateSuperheatedProperties();
            
        } else if (phase === 'subcooled') {
            // Subcooled - quality fixed at 0
            setReadonlyField(qualityInput, true);
            
            // Fetch and update subcooled properties from IAPWS
            await updateSubcooledProperties();
        }
        
        // CRITICAL: Ensure temperature field keeps user's input
        if (!isNaN(lastUserTemperatureInput)) {
            tempInput.value = lastUserTemperatureInput.toFixed(2);
        }
        
        // Send to backend for verification (non-blocking)
        sendToBackendForVerification();
    }

    // === HANDLE PRESSURE CHANGE (ISOTHERMAL) ===
    async function handlePressureChangeIsothermal() {
        const phase = getCurrentPhase();
        const currentP = parseFloat(pressureInput.value);
        
        console.log("Pressure changed to:", currentP, "bar, Phase:", phase);
        
        // Store user's pressure value
        lastUserPressureInput = currentP;
        
        if (phase === 'saturated') {
            // At saturation - quality editable
            setReadonlyField(qualityInput, false);
            
            // If quality is 0 or 1 from previous state and user isn't typing, reset to 0.5
            const currentQuality = parseFloat(qualityInput.value);
            if (!isUserTypingQuality && (currentQuality === 0 || currentQuality === 1 || isNaN(currentQuality))) {
                qualityInput.value = "0.5000";
            }
            
            // Update saturated properties from backend for accuracy
            await updateSaturatedPropertiesFromBackend();
            
        } else if (phase === 'superheated') {
            // Superheated - quality fixed at 1
            setReadonlyField(qualityInput, true);
            
            // Fetch and update superheated properties from IAPWS
            await updateSuperheatedProperties();
            
        } else if (phase === 'subcooled') {
            // Subcooled - quality fixed at 0
            setReadonlyField(qualityInput, true);
            
            // Fetch and update subcooled properties from IAPWS
            await updateSubcooledProperties();
        }
        
        // CRITICAL: Ensure pressure field keeps user's input
        if (!isNaN(lastUserPressureInput)) {
            pressureInput.value = lastUserPressureInput.toFixed(3);
        }
        
        // Send to backend for verification (non-blocking)
        sendToBackendForVerification();
    }

    // === HANDLE TEMPERATURE CHANGE (ISOCHORIC) ===
    async function handleTemperatureChangeIsochoric() {
        const currentT = parseFloat(tempInput.value);
        
        console.log("Isochoric: Temperature changed to:", currentT, "°C");
        
        // Store user's temperature value
        lastUserTemperatureInput = currentT;
        
        // For isochoric, we need to calculate pressure and other properties
        // based on fixed volume (v1 = v2) and new temperature
        await updateIsochoricProperties('temperature');
        
        // Get updated phase after change
        const phase = getCurrentPhase();
        console.log("Phase after temperature change:", phase);
        
        // Update quality based on new phase
        if (phase === 'superheated') {
            qualityInput.value = "1.0000";
            setReadonlyField(qualityInput, true);
        } else if (phase === 'subcooled') {
            qualityInput.value = "0.0000";
            setReadonlyField(qualityInput, true);
        }
    }

    // === HANDLE PRESSURE CHANGE (ISOCHORIC) ===
    async function handlePressureChangeIsochoric() {
        const currentP = parseFloat(pressureInput.value);
        
        console.log("Isochoric: Pressure changed to:", currentP, "bar");
        
        // Store user's pressure value
        lastUserPressureInput = currentP;
        
        // For isochoric, we need to calculate temperature and other properties
        // based on fixed volume (v1 = v2) and new pressure
        await updateIsochoricProperties('pressure');
        
        // Get updated phase after change
        const phase = getCurrentPhase();
        console.log("Phase after pressure change:", phase);
        
        // Update quality based on new phase
        if (phase === 'superheated') {
            qualityInput.value = "1.0000";
            setReadonlyField(qualityInput, true);
        } else if (phase === 'subcooled') {
            qualityInput.value = "0.0000";
            setReadonlyField(qualityInput, true);
        }
    }

    // === HANDLE TEMPERATURE CHANGE (ADIABATIC) ===
    async function handleTemperatureChangeAdiabatic() {
        const currentT = parseFloat(tempInput.value);
        
        console.log("Adiabatic: Temperature changed to:", currentT, "°C");
        
        // Store user's temperature value
        lastUserTemperatureInput = currentT;
        
        // For adiabatic, we calculate pressure and other properties
        // based on fixed entropy (s1 = s2) and new temperature
        await updateAdiabaticProperties('temperature');
        
        // Get updated phase after change
        const phase = getCurrentPhase();
        console.log("Phase after temperature change:", phase);
        
        // Update quality based on new phase
        if (phase === 'superheated') {
            qualityInput.value = "1.0000";
            setReadonlyField(qualityInput, true);
        } else if (phase === 'subcooled') {
            qualityInput.value = "0.0000";
            setReadonlyField(qualityInput, true);
        }
    }

    // === HANDLE PRESSURE CHANGE (ADIABATIC) ===
    async function handlePressureChangeAdiabatic() {
        const currentP = parseFloat(pressureInput.value);
        
        console.log("Adiabatic: Pressure changed to:", currentP, "bar");
        
        // Store user's pressure value
        lastUserPressureInput = currentP;
        
        // For adiabatic, we calculate temperature and other properties
        // based on fixed entropy (s1 = s2) and new pressure
        await updateAdiabaticProperties('pressure');
        
        // Get updated phase after change
        const phase = getCurrentPhase();
        console.log("Phase after pressure change:", phase);
        
        // Update quality based on new phase
        if (phase === 'superheated') {
            qualityInput.value = "1.0000";
            setReadonlyField(qualityInput, true);
        } else if (phase === 'subcooled') {
            qualityInput.value = "0.0000";
            setReadonlyField(qualityInput, true);
        }
    }

    // === UPDATE ISOCHORIC PROPERTIES ===
    async function updateIsochoricProperties(changedField) {
        console.log("Updating ISOCHORIC properties, changed field:", changedField);
        
        // Store user's current input before fetching
        const userTempBeforeFetch = tempInput.value;
        const userPressureBeforeFetch = pressureInput.value;
        
        // Fetch properties from backend with fixed volume (v1 = v2)
        const result = await fetchPropertiesFromBackend();
        
        if (result) {
            // Update the field that wasn't changed by user
            if (changedField === 'temperature' && !isUserTypingPressure && result.P !== undefined) {
                pressureInput.value = Number(result.P).toFixed(3);
            } else if (changedField === 'pressure' && !isUserTypingTemperature && result.T !== undefined) {
                tempInput.value = Number(result.T).toFixed(2);
            } else if (changedField === 'quality' && !isUserTypingTemperature && result.T !== undefined && !isUserTypingPressure && result.P !== undefined) {
                // When quality changes, update both T and P
                tempInput.value = Number(result.T).toFixed(2);
                pressureInput.value = Number(result.P).toFixed(3);
            }
            
            // CRITICAL: Restore user's input for the field they changed
            if (changedField === 'temperature' && userTempBeforeFetch && !isUserTypingTemperature) {
                tempInput.value = userTempBeforeFetch;
            } else if (changedField === 'pressure' && userPressureBeforeFetch && !isUserTypingPressure) {
                pressureInput.value = userPressureBeforeFetch;
            }
            
            // Update other properties
            if (result.u !== undefined) uOutput.textContent = Number(result.u).toFixed(2);
            if (result.h !== undefined) hOutput.textContent = Number(result.h).toFixed(2);
            if (result.s !== undefined) sOutput.textContent = Number(result.s).toFixed(4);
            
            // Handle quality based on phase
            const phase = result.phase || getCurrentPhase();
            const currentT = parseFloat(tempInput.value);
            const currentP = parseFloat(pressureInput.value);
            
            if (phase === 'saturated') {
                // At saturation - quality editable
                setReadonlyField(qualityInput, false); // QUALITY IS EDITABLE!
                
                // Calculate quality from fixed volume: x = (v - vf)/(vg - vf)
                let calculatedQuality = null;
                if (sat_vf !== null && sat_vg !== null && fixedVolume !== null) {
                    calculatedQuality = (fixedVolume - sat_vf) / (sat_vg - sat_vf);
                }
                
                // Use backend quality if available, otherwise use calculated
                if (!isUserTypingQuality && result.x !== undefined && !isNaN(result.x)) {
                    qualityInput.value = Number(result.x).toFixed(4);
                } else if (calculatedQuality !== null && calculatedQuality >= 0 && calculatedQuality <= 1 && !isUserTypingQuality) {
                    qualityInput.value = calculatedQuality.toFixed(4);
                }
                
            } else if (phase === 'superheated') {
                // Superheated - quality fixed at 1 (T > T_sat OR P < P_sat)
                setReadonlyField(qualityInput, true);
                if (!isUserTypingQuality) {
                    qualityInput.value = "1.0000";
                }
                
            } else if (phase === 'subcooled') {
                // Subcooled - quality fixed at 0 (T < T_sat OR P > P_sat)
                setReadonlyField(qualityInput, true);
                if (!isUserTypingQuality) {
                    qualityInput.value = "0.0000";
                }
            }
            
            console.log("ISOCHORIC results from IAPWS:", {
                T: result.T,
                P: result.P,
                v: result.v,
                u: result.u,
                h: result.h,
                s: result.s,
                x: result.x,
                phase: phase
            });
        } else {
            console.error("Failed to fetch isochoric properties from IAPWS");
        }
        
        // Send to backend for verification (non-blocking)
        sendToBackendForVerification();
    }

    // === UPDATE ADIABATIC PROPERTIES ===
    async function updateAdiabaticProperties(changedField) {
        console.log("Updating ADIABATIC properties, changed field:", changedField);
        
        // Store user's current input before fetching
        const userTempBeforeFetch = tempInput.value;
        const userPressureBeforeFetch = pressureInput.value;
        
        // Fetch properties from backend with fixed entropy (s1 = s2)
        const result = await fetchPropertiesFromBackend();
        
        if (result) {
            // For adiabatic: T and P are the dominant variables that cause changes
            // Update the complementary variable based on which one user changed
            if (changedField === 'temperature' && !isUserTypingPressure && result.P !== undefined) {
                // User changed T → update P
                pressureInput.value = Number(result.P).toFixed(3);
            } else if (changedField === 'pressure' && !isUserTypingTemperature && result.T !== undefined) {
                // User changed P → update T
                tempInput.value = Number(result.T).toFixed(2);
            } else if (changedField === 'quality' && !isUserTypingTemperature && result.T !== undefined && !isUserTypingPressure && result.P !== undefined) {
                // When quality changes in saturated region, update both T and P
                tempInput.value = Number(result.T).toFixed(2);
                pressureInput.value = Number(result.P).toFixed(3);
            }
            
            // CRITICAL: Restore user's input for the field they changed
            if (changedField === 'temperature' && userTempBeforeFetch && !isUserTypingTemperature) {
                tempInput.value = userTempBeforeFetch;
            } else if (changedField === 'pressure' && userPressureBeforeFetch && !isUserTypingPressure) {
                pressureInput.value = userPressureBeforeFetch;
            }
            
            // Update volume if available
            if (!isUserTypingVolume && result.v !== undefined) {
                volumeInput.value = Number(result.v).toFixed(6);
            }
            
            // Update other properties
            if (result.u !== undefined) uOutput.textContent = Number(result.u).toFixed(2);
            if (result.h !== undefined) hOutput.textContent = Number(result.h).toFixed(2);
            if (result.s !== undefined) sOutput.textContent = Number(result.s).toFixed(4);
            
            // Handle quality based on phase
            const phase = result.phase || getCurrentPhase();
            
            if (phase === 'saturated') {
                // At saturation - quality editable
                setReadonlyField(qualityInput, false);
                
                // Use backend quality if available
                if (!isUserTypingQuality && result.x !== undefined && !isNaN(result.x)) {
                    qualityInput.value = Number(result.x).toFixed(4);
                }
                
            } else if (phase === 'superheated') {
                // Superheated - quality fixed at 1
                setReadonlyField(qualityInput, true);
                if (!isUserTypingQuality) {
                    qualityInput.value = "1.0000";
                }
                
            } else if (phase === 'subcooled') {
                // Subcooled - quality fixed at 0
                setReadonlyField(qualityInput, true);
                if (!isUserTypingQuality) {
                    qualityInput.value = "0.0000";
                }
            }
            
            console.log("ADIABATIC results from IAPWS:", {
                T: result.T,
                P: result.P,
                v: result.v,
                u: result.u,
                h: result.h,
                s: result.s,
                x: result.x,
                phase: phase
            });
        } else {
            console.error("Failed to fetch adiabatic properties from IAPWS");
        }
        
        // Send to backend for verification (non-blocking)
        sendToBackendForVerification();
    }

    // === HANDLE QUALITY INPUT START ===
    function handleQualityInputStart() {
        isUserTypingQuality = true;
        console.log("User started typing in quality field");
        
        // Clear any existing timeout
        if (qualityInputTimeout) {
            clearTimeout(qualityInputTimeout);
        }
    }

    // === HANDLE QUALITY INPUT END ===
    function handleQualityInputEnd() {
        // Set a timeout to clear the typing flag after user stops typing
        if (qualityInputTimeout) {
            clearTimeout(qualityInputTimeout);
        }
        
        qualityInputTimeout = setTimeout(async () => {
            isUserTypingQuality = false;
            console.log("User stopped typing in quality field");
            
            // Now process the quality change
            await processQualityChange();
        }, 1000); // 1 second delay after user stops typing
    }

    // === HANDLE VOLUME INPUT START ===
    function handleVolumeInputStart() {
        isUserTypingVolume = true;
        console.log("User started typing in volume field");
        
        // Clear any existing timeout
        if (volumeInputTimeout) {
            clearTimeout(volumeInputTimeout);
        }
    }

    // === HANDLE VOLUME INPUT END ===
    function handleVolumeInputEnd() {
        // Set a timeout to clear the typing flag after user stops typing
        if (volumeInputTimeout) {
            clearTimeout(volumeInputTimeout);
        }
        
        volumeInputTimeout = setTimeout(async () => {
            isUserTypingVolume = false;
            console.log("User stopped typing in volume field");
            
            // Now process the volume change
            await handleVolumeChange();
        }, 1000); // 1 second delay after user stops typing
    }

    // === HANDLE PRESSURE INPUT START ===
    function handlePressureInputStart() {
        isUserTypingPressure = true;
        console.log("User started typing in pressure field");
        
        // Clear any existing timeout
        if (pressureInputTimeout) {
            clearTimeout(pressureInputTimeout);
        }
    }

    // === HANDLE PRESSURE INPUT END ===
    function handlePressureInputEnd() {
        // Set a timeout to clear the typing flag after user stops typing
        if (pressureInputTimeout) {
            clearTimeout(pressureInputTimeout);
        }
        
        pressureInputTimeout = setTimeout(async () => {
            isUserTypingPressure = false;
            console.log("User stopped typing in pressure field");
            
            // Process pressure change based on current process
            if (currentProcess === "Isothermal") {
                await handlePressureChangeIsothermal();
            } else if (currentProcess === "Isochoric") {
                await handlePressureChangeIsochoric();
            } else if (currentProcess === "Adiabatic") {
                await handlePressureChangeAdiabatic();
            }
        }, 1000);
    }

    // === HANDLE TEMPERATURE INPUT START ===
    function handleTemperatureInputStart() {
        isUserTypingTemperature = true;
        console.log("User started typing in temperature field");
        
        // Clear any existing timeout
        if (temperatureInputTimeout) {
            clearTimeout(temperatureInputTimeout);
        }
    }

    // === HANDLE TEMPERATURE INPUT END ===
    function handleTemperatureInputEnd() {
        // Set a timeout to clear the typing flag after user stops typing
        if (temperatureInputTimeout) {
            clearTimeout(temperatureInputTimeout);
        }
        
        temperatureInputTimeout = setTimeout(async () => {
            isUserTypingTemperature = false;
            console.log("User stopped typing in temperature field");
            
            // Process temperature change based on current process
            if (currentProcess === "Isobaric") {
                await handleTemperatureChangeIsobaric();
            } else if (currentProcess === "Isochoric") {
                await handleTemperatureChangeIsochoric();
            } else if (currentProcess === "Adiabatic") {
                await handleTemperatureChangeAdiabatic();
            }
        }, 1000);
    }

    // === PROCESS QUALITY CHANGE (AFTER USER STOPS TYPING) ===
    async function processQualityChange() {
        const phase = getCurrentPhase();
        const currentQuality = parseFloat(qualityInput.value);
        
        if (isNaN(currentQuality) || currentQuality < 0 || currentQuality > 1) {
            console.warn("Invalid quality value:", currentQuality);
            // Only reset if user entered invalid value
            if (currentQuality < 0) qualityInput.value = "0.0000";
            else if (currentQuality > 1) qualityInput.value = "1.0000";
            return;
        }
        
        console.log("Processing quality change to:", currentQuality, "Phase:", phase);
        
        if (phase === 'saturated') {
            if (currentProcess === "Isochoric") {
                // For isochoric at saturation, quality changes T and P
                await updateIsochoricProperties('quality');
            } else if (currentProcess === "Adiabatic") {
                // For adiabatic at saturation, quality changes T and P
                await updateAdiabaticProperties('quality');
            } else {
                // For isobaric/isothermal, quality is editable at saturation
                updateSaturatedPropertiesInstantly();
                await updateSaturatedPropertiesFromBackend(true, true);
            }
        } else if (phase === 'superheated' || phase === 'subcooled') {
            // Don't change the user's input in superheated/subcooled states
            const result = await fetchPropertiesFromBackend(true, true);
            if (result && result.phase) {
                console.log("Backend phase detection:", result.phase);
            }
        }
        
        await sendToBackendForVerificationWithNoOverwrite();
    }

    // === HANDLE VOLUME CHANGE ===
    async function handleVolumeChange() {
        const phase = getCurrentPhase();
        const currentV = parseFloat(volumeInput.value);
        
        if (isNaN(currentV)) {
            return;
        }
        
        console.log("Volume changed to:", currentV, "Phase:", phase);
        
        if (phase === 'saturated') {
            // Recalculate quality from volume: x = (v - vf) / (vg - vf)
            if (!isNaN(currentV) && sat_vf !== null && sat_vg !== null) {
                const newQuality = (currentV - sat_vf) / (sat_vg - sat_vf);
                if (newQuality >= 0 && newQuality <= 1) {
                    qualityInput.value = newQuality.toFixed(4);
                    // Now update properties with the new quality
                    updateSaturatedPropertiesInstantly(); // Immediate local update
                    // Verify with backend but don't let it overwrite
                    await updateSaturatedPropertiesFromBackend(true, true);
                } else {
                    console.warn("Calculated quality out of range:", newQuality);
                }
            }
        }
        // For superheated/subcooled, volume updates should trigger property updates
        else if (phase === 'superheated' || phase === 'subcooled') {
            // If user manually edits volume in superheated/subcooled state,
            // we need to recalculate from backend
            if (phase === 'superheated') {
                await updateSuperheatedProperties();
            } else {
                await updateSubcooledProperties();
            }
        }
    }

    // === SEND TO BACKEND FOR VERIFICATION WITH NO OVERWRITE ===
    async function sendToBackendForVerificationWithNoOverwrite() {
        if (isUserTypingQuality) {
            console.log("Skipping verification while user is typing quality");
            return;
        }
        
        const currentT = parseFloat(tempInput.value);
        const currentP = parseFloat(pressureInput.value);
        const currentQuality = parseFloat(qualityInput.value);
        const currentV = parseFloat(volumeInput.value);
        
        const payload = {
            process: currentProcess,
            gas_name: gasName,
            P: isNaN(currentP) ? null : currentP,
            T: isNaN(currentT) ? null : currentT,
            v: isNaN(currentV) ? null : currentV,
            x: isNaN(currentQuality) ? null : currentQuality,
            // Add flag to tell backend not to return property values that would overwrite
            no_overwrite: true
        };
        
        console.log("Sending to backend for verification (no overwrite):", payload);
        
        try {
            const response = await fetch("/submit-next-stage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();
            if (result && result.status === "success") {
                console.log("Backend verified successfully (no overwrite)");
                // Don't update UI - just log the result
                if (result.phase) {
                    console.log("Phase from backend:", result.phase);
                }
            }
        } catch (error) {
            console.error("Backend error (non-critical):", error);
        }
    }

    // === SEND TO BACKEND FOR VERIFICATION ===
    async function sendToBackendForVerification() {
        if (isUserTypingQuality || isUserTypingPressure || isUserTypingTemperature) {
            console.log("Skipping verification while user is typing");
            return;
        }
        
        const currentT = parseFloat(tempInput.value);
        const currentP = parseFloat(pressureInput.value);
        const currentQuality = parseFloat(qualityInput.value);
        const currentV = parseFloat(volumeInput.value);
        
        const payload = {
            process: currentProcess,
            gas_name: gasName,
            P: isNaN(currentP) ? null : currentP,
            T: isNaN(currentT) ? null : currentT,
            v: isNaN(currentV) ? null : currentV,
            x: isNaN(currentQuality) ? null : currentQuality
        };
        
        console.log("Sending to backend for verification:", payload);
        
        try {
            const response = await fetch("/submit-next-stage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();
            if (result && result.status === "success") {
                console.log("Backend verified successfully");
                // Update UI with any corrections from backend, but skip if user is typing
                updateUIWithBackendResults(result);
            }
        } catch (error) {
            console.error("Backend error (non-critical):", error);
        }
    }

    // === UPDATE UI WITH BACKEND RESULTS ===
    function updateUIWithBackendResults(result) {
        // Only update if we're not in a manual editing session
        if (isUserTypingQuality || isUserTypingPressure || isUserTypingTemperature) {
            console.log("Skipping UI update while user is typing");
            return;
        }
        
        // Update volume only if user isn't typing in volume field AND not isochoric
        if (!isUserTypingVolume && result.v !== undefined && !isNaN(result.v) && currentProcess !== "Isochoric") {
            volumeInput.value = Number(result.v).toFixed(6);
        }
        
        // CRITICAL FIX: For Isobaric process, NEVER update temperature field
        // CRITICAL FIX: For Isothermal process, NEVER update pressure field
        // Only update T/P for isochoric/adiabatic if not typing
        
        if (currentProcess === "Isochoric" || currentProcess === "Adiabatic") {
            if (!isUserTypingPressure && result.P !== undefined && !isNaN(result.P)) {
                pressureInput.value = Number(result.P).toFixed(3);
            }
            if (!isUserTypingTemperature && result.T !== undefined && !isNaN(result.T)) {
                tempInput.value = Number(result.T).toFixed(2);
            }
        }
        
        // Update other properties
        if (result.u !== undefined && !isNaN(result.u)) {
            uOutput.textContent = Number(result.u).toFixed(2);
        }
        if (result.h !== undefined && !isNaN(result.h)) {
            hOutput.textContent = Number(result.h).toFixed(2);
        }
        if (result.s !== undefined && !isNaN(result.s)) {
            sOutput.textContent = Number(result.s).toFixed(4);
        }
        
        // Only update quality if user isn't currently typing AND backend explicitly requests it
        if (!isUserTypingQuality && result.force_quality_update && result.x !== undefined && !isNaN(result.x)) {
            qualityInput.value = Number(result.x).toFixed(4);
        }
        
        // Update phase display if needed
        if (result.phase) {
            console.log("Phase from backend:", result.phase);
        }
    }

    // === SETUP ISOBARIC PROCESS ===
    function setupIsobaricProcess() {
        console.log("=== SETTING UP ISOBARIC PROCESS (P1 = P2) ===");
        currentProcess = "Isobaric";
        
        // Make temperature editable, pressure readonly (P1 = P2)
        setReadonlyField(tempInput, false);
        setReadonlyField(pressureInput, true);
        setReadonlyField(volumeInput, false);
        setReadonlyField(qualityInput, false);
        
        // Fix pressure (P1 = P2)
        if (exactPressure !== null) {
            pressureInput.value = exactPressure.toFixed(3);
            console.log("Pressure fixed (P1 = P2):", exactPressure, "bar");
        }
        
        // Set initial temperature to T_sat
        if (T_sat_at_P !== null) {
            tempInput.value = T_sat_at_P.toFixed(2);
            console.log("Initial temperature set to T_sat:", T_sat_at_P, "°C");
        }
        
        // Load saturation properties
        loadSaturationProperties();
        
        // Initial update
        setTimeout(async () => {
            await handleTemperatureChangeIsobaric();
        }, 100);
    }

    // === SETUP ISOTHERMAL PROCESS ===
    function setupIsothermalProcess() {
        console.log("=== SETTING UP ISOTHERMAL PROCESS (T1 = T2) ===");
        currentProcess = "Isothermal";
        
        // Make pressure editable, temperature readonly (T1 = T2)
        setReadonlyField(tempInput, true);
        setReadonlyField(pressureInput, false);
        setReadonlyField(volumeInput, false);
        setReadonlyField(qualityInput, false);
        
        // Fix temperature (T1 = T2)
        if (exactTemperature !== null) {
            tempInput.value = exactTemperature.toFixed(2);
            console.log("Temperature fixed (T1 = T2):", exactTemperature, "°C");
        }
        
        // Set initial pressure to P_sat
        if (P_sat_at_T !== null) {
            pressureInput.value = P_sat_at_T.toFixed(3);
            console.log("Initial pressure set to P_sat:", P_sat_at_T, "bar");
        }
        
        // Load saturation properties
        loadSaturationProperties();
        
        // Initial update
        setTimeout(async () => {
            await handlePressureChangeIsothermal();
        }, 100);
    }

    // === SETUP ISOCHORIC PROCESS ===
    function setupIsochoricProcess() {
        console.log("=== SETTING UP ISOCHORIC PROCESS (v1 = v2) ===");
        currentProcess = "Isochoric";
        
        // Make pressure, temperature, and quality editable, volume readonly (v1 = v2)
        setReadonlyField(tempInput, false);
        setReadonlyField(pressureInput, false);
        setReadonlyField(volumeInput, true); // Volume is fixed! (v1 = v2)
        setReadonlyField(qualityInput, false); // QUALITY IS EDITABLE FOR ISOCHORIC!
        
        // Fix volume (v1 = v2)
        if (fixedVolume !== null) {
            volumeInput.value = fixedVolume.toFixed(6);
            console.log("Volume fixed (v1 = v2):", fixedVolume, "m³/kg");
        }
        
        // Set initial values to saturation if available
        if (T_sat_at_P !== null) {
            tempInput.value = T_sat_at_P.toFixed(2);
        }
        if (P_sat_at_T !== null) {
            pressureInput.value = P_sat_at_T.toFixed(3);
        }
        
        // Load saturation properties
        loadSaturationProperties();
        
        // Initial update - start at saturation point
        setTimeout(async () => {
            await updateIsochoricProperties('initial');
        }, 100);
    }

    // === SETUP ADIABATIC PROCESS ===
    function setupAdiabaticProcess() {
        console.log("=== SETTING UP ADIABATIC PROCESS (s1 = s2) ===");
        currentProcess = "Adiabatic";
        
        // Make temperature, pressure, volume, and quality editable, entropy is fixed (s1 = s2)
        // T and P are the dominant variables that cause changes
        setReadonlyField(tempInput, false); // T is editable and dominant
        setReadonlyField(pressureInput, false); // P is editable and dominant
        setReadonlyField(volumeInput, false); // v is calculated from T,P,s
        setReadonlyField(qualityInput, false); // x is editable in saturation
        
        // Fix entropy (s1 = s2)
        if (fixedEntropy !== null) {
            sOutput.textContent = fixedEntropy.toFixed(4);
            console.log("Entropy fixed (s1 = s2):", fixedEntropy, "kJ/kg·K");
        }
        
        // Set initial values to saturation if available
        if (T_sat_at_P !== null) {
            tempInput.value = T_sat_at_P.toFixed(2);
        }
        if (P_sat_at_T !== null) {
            pressureInput.value = P_sat_at_T.toFixed(3);
        }
        
        // Load saturation properties
        loadSaturationProperties();
        
        // Initial update - start at saturation point
        setTimeout(async () => {
            await updateAdiabaticProperties('initial');
        }, 100);
    }

    // === LOAD SATURATION PROPERTIES ===
    function loadSaturationProperties() {
        sat_vf = parseFloat(state1.vf);
        sat_vg = parseFloat(state1.vg);
        sat_uf = parseFloat(state1.uf);
        sat_ug = parseFloat(state1.ug);
        sat_hf = parseFloat(state1.hf);
        sat_hfg = parseFloat(state1.hfg);
        sat_sf = parseFloat(state1.sf);
        sat_sg = parseFloat(state1.sg);
        
        console.log("SATURATION PROPERTIES:", {
            T_sat: T_sat_at_P,
            P_sat: P_sat_at_T,
            vf: sat_vf,
            vg: sat_vg,
            uf: sat_uf,
            ug: sat_ug,
            hf: sat_hf,
            hfg: sat_hfg,
            sf: sat_sf,
            sg: sat_sg
        });
    }

    // === LOAD STATE 1 DATA ===
    async function loadState1() {
        try {
            const res = await fetch("/check-gas");
            const data = await res.json();

            if (!data || !data.gas_name) {
                console.error("No State 1 data");
                return;
            }

            state1 = data;
            gasName = data.gas_name;

            console.log("LOADED STATE 1:", data);

            // Get values for constant properties
            exactPressure = parseFloat(data.P_original);     // For isobaric: P1 = P2
            exactTemperature = parseFloat(data.T_original);  // For isothermal: T1 = T2
            fixedVolume = parseFloat(data.v);                // For isochoric: v1 = v2
            fixedEntropy = parseFloat(data.s);               // For adiabatic: s1 = s2
            
            T_sat_at_P = data.T_sat_at_P;
            P_sat_at_T = data.P_sat_at_T;

            // Populate initial values
            pressureInput.value = exactPressure.toFixed(3);
            tempInput.value = exactTemperature.toFixed(2);
            
            if (data.v) volumeInput.value = parseFloat(data.v).toFixed(6);
            if (data.x) qualityInput.value = parseFloat(data.x).toFixed(4);
            if (data.u) uOutput.textContent = Number(data.u).toFixed(2);
            if (data.h) hOutput.textContent = Number(data.h).toFixed(2);
            if (data.s) sOutput.textContent = Number(data.s).toFixed(4);

            // Set default to Isobaric
            const isobaricRadio = document.querySelector("input[value='Isobaric']");
            if (isobaricRadio) {
                isobaricRadio.checked = true;
                setupIsobaricProcess();
            }

        } catch (err) {
            console.error("Error loading state1:", err);
        }
    }

    // === ATTACH EVENT HANDLERS ===
    function attachEventHandlers() {
        // TEMPERATURE - Triggers changes for Isobaric, Isochoric, and Adiabatic
        tempInput.addEventListener("focus", () => {
            handleTemperatureInputStart();
        });
        
        tempInput.addEventListener("blur", () => {
            handleTemperatureInputEnd();
        });
        
        tempInput.addEventListener("input", () => {
            // Restart the typing detection on each input
            handleTemperatureInputStart();
            
            // Clear any existing timeout and start new one
            if (temperatureInputTimeout) {
                clearTimeout(temperatureInputTimeout);
            }
            
            // Set new timeout
            temperatureInputTimeout = setTimeout(async () => {
                isUserTypingTemperature = false;
                console.log("User stopped typing in temperature field");
                
                if (currentProcess === "Isobaric") {
                    await handleTemperatureChangeIsobaric();
                } else if (currentProcess === "Isochoric") {
                    await handleTemperatureChangeIsochoric();
                } else if (currentProcess === "Adiabatic") {
                    await handleTemperatureChangeAdiabatic();
                }
            }, 1000);
        });

        // PRESSURE - Triggers changes for Isothermal, Isochoric, and Adiabatic
        pressureInput.addEventListener("focus", () => {
            handlePressureInputStart();
        });
        
        pressureInput.addEventListener("blur", () => {
            handlePressureInputEnd();
        });
        
        pressureInput.addEventListener("input", () => {
            // Restart the typing detection on each input
            handlePressureInputStart();
            
            // Clear any existing timeout and start new one
            if (pressureInputTimeout) {
                clearTimeout(pressureInputTimeout);
            }
            
            // Set new timeout
            pressureInputTimeout = setTimeout(async () => {
                isUserTypingPressure = false;
                console.log("User stopped typing in pressure field");
                
                if (currentProcess === "Isothermal") {
                    await handlePressureChangeIsothermal();
                } else if (currentProcess === "Isochoric") {
                    await handlePressureChangeIsochoric();
                } else if (currentProcess === "Adiabatic") {
                    await handlePressureChangeAdiabatic();
                }
            }, 1000);
        });

        // QUALITY - Use focus/blur and input with debouncing
        qualityInput.addEventListener("focus", () => {
            handleQualityInputStart();
        });
        
        qualityInput.addEventListener("blur", () => {
            handleQualityInputEnd();
        });
        
        qualityInput.addEventListener("input", () => {
            // Restart the typing detection on each input
            handleQualityInputStart();
            
            // Clear any existing timeout and start new one
            if (qualityInputTimeout) {
                clearTimeout(qualityInputTimeout);
            }
            
            // Show immediate local calculation while typing (except for isochoric/adiabatic)
            const phase = getCurrentPhase();
            if (phase === 'saturated' && currentProcess !== "Isochoric" && currentProcess !== "Adiabatic") {
                updateSaturatedPropertiesInstantly();
            }
            
            // Set new timeout
            qualityInputTimeout = setTimeout(async () => {
                isUserTypingQuality = false;
                console.log("User stopped typing in quality field");
                await processQualityChange();
            }, 1000);
        });

        // VOLUME - Use focus/blur and input with debouncing
        volumeInput.addEventListener("focus", () => {
            handleVolumeInputStart();
        });
        
        volumeInput.addEventListener("blur", () => {
            handleVolumeInputEnd();
        });
        
        volumeInput.addEventListener("input", () => {
            // Restart the typing detection on each input
            handleVolumeInputStart();
            
            // Clear any existing timeout and start new one
            if (volumeInputTimeout) {
                clearTimeout(volumeInputTimeout);
            }
            
            // Set new timeout
            volumeInputTimeout = setTimeout(async () => {
                isUserTypingVolume = false;
                console.log("User stopped typing in volume field");
                await handleVolumeChange();
            }, 1000);
        });

        // PROCESS SELECTION
        processRadios.forEach(radio => {
            radio.addEventListener("change", (e) => {
                const selectedProcess = e.target.value;
                if (selectedProcess === "Isobaric") {
                    setupIsobaricProcess();
                } else if (selectedProcess === "Isothermal") {
                    setupIsothermalProcess();
                } else if (selectedProcess === "Isochoric") {
                    setupIsochoricProcess();
                } else if (selectedProcess === "Adiabatic") {
                    setupAdiabaticProcess();
                } else {
                    alert("Only Isobaric, Isothermal, Isochoric, and Adiabatic are implemented");
                    e.target.checked = false;
                    document.querySelector("input[value='Isobaric']").checked = true;
                    setupIsobaricProcess();
                }
            });
        });

        // SIMULATE BUTTON HANDLER (updated)
simulateBtn.addEventListener("click", async () => {
    // Clear typing flags
    isUserTypingQuality = false;
    isUserTypingVolume = false;
    isUserTypingPressure = false;
    isUserTypingTemperature = false;
    
    // Clear any pending timeouts
    if (qualityInputTimeout) clearTimeout(qualityInputTimeout);
    if (volumeInputTimeout) clearTimeout(volumeInputTimeout);
    if (pressureInputTimeout) clearTimeout(pressureInputTimeout);
    if (temperatureInputTimeout) clearTimeout(temperatureInputTimeout);
    
    // Get current state values
    const currentT = parseFloat(tempInput.value);
    const currentP = parseFloat(pressureInput.value);
    const currentQuality = parseFloat(qualityInput.value);
    const currentV = parseFloat(volumeInput.value);
    const currentU = parseFloat(uOutput.textContent);
    const currentH = parseFloat(hOutput.textContent);
    const currentS = parseFloat(sOutput.textContent);
    
    // Validate inputs
    if (isNaN(currentT) || isNaN(currentP) || isNaN(currentQuality) || 
        isNaN(currentV) || isNaN(currentU) || isNaN(currentH) || isNaN(currentS)) {
        alert("Please ensure all values are calculated before simulating.");
        return;
    }
    
    // Map process names for backend
    let backendProcessName;
    if (currentProcess === "Isobaric") {
        backendProcessName = "Constant Pressure";
    } else if (currentProcess === "Isothermal") {
        backendProcessName = "Isothermal";
    } else if (currentProcess === "Isochoric") {
        backendProcessName = "Constant Volume";
    } else if (currentProcess === "Adiabatic") {
        backendProcessName = "Adiabatic";
    } else {
        alert("Invalid process selected.");
        return;
    }
    
    // Prepare complete State 2 payload
    const state2Payload = {
        T: currentT,
        P: currentP,
        v: currentV,
        x: currentQuality,
        u: currentU,
        h: currentH,
        s: currentS
    };
    
    // Prepare process payload
    const processPayload = { 
        process: backendProcessName,
        gas_name: gasName,
        state2: state2Payload
    };
    
    console.log("Submitting State 2 data:", state2Payload);
    console.log("Submitting process data:", processPayload);
    
    try {
        // Submit State 2 data first
        const state2Res = await fetch("/submit-process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(processPayload)
        });
        
        const result = await state2Res.json();
        
        if (result.status === "success") {
            console.log("Simulation successful, navigating to results...");
            // Navigate to results page
            window.location.href = "results.html";
        } else {
            alert("Error: " + (result.message || "Simulation failed"));
        }
    } catch (err) {
        console.error("Simulation error:", err);
        alert("Error: " + err.message);
    }
});
    }

    // === INITIALIZE ===
    console.log("Initializing thermodynamic simulation with IAPWS integration...");
    attachEventHandlers();
    loadState1();
});