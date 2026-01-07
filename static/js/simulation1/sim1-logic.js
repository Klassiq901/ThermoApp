document.addEventListener('DOMContentLoaded', () => {
    // ------------------------------
    // Elements
    // ------------------------------
    const gasSelector = document.getElementById('gas-selector');
    const customGasFields = document.getElementById('custom-gas-fields');

    const tempInput = document.getElementById('temp-input');
    const pressureInput = document.getElementById('pressure-input');
    const volumeInput = document.getElementById('volume-input');
    const cpInput = document.getElementById('cp-input');
    const cvInput = document.getElementById('cv-input');
    const rInput = document.getElementById('r-input');
    const kInput = document.getElementById('k-input');
    const nextButton = document.getElementById('next-button');

    // Water-specific
    const qualityField = document.getElementById('quality-field');
    const qualityInput = document.getElementById('quality-input');
    const volumeLabel = document.getElementById('volume-label');
    const volumeParent = volumeLabel.parentNode;
    const volumeNextSibling = volumeLabel.nextSibling;

    // NEW: Element to display the phase state
    const phaseOutput = document.createElement('p');
    phaseOutput.id = 'phase-output';
    phaseOutput.className = 'text-sm mt-2 font-semibold';
    // Place it below the pressure input
    pressureInput.parentElement.after(phaseOutput);

    // ------------------------------
    // Restore previous data if available
    // ------------------------------
    const savedData = sessionStorage.getItem('backToSim1Data');
    if (savedData) {
        const data = JSON.parse(savedData);
        gasSelector.value = data.gas_name;

        if (data.gas_name === 'custom') {
            customGasFields.classList.remove('hidden');
            customGasFields.classList.add('flex');
            cpInput.value = data.cp;
            cvInput.value = data.cv;
            rInput.value = data.R;
            kInput.value = data.k;
        } else {
            customGasFields.classList.add('hidden');
            customGasFields.classList.remove('flex');
            currentR = data.R;
        }

        tempInput.value = data.T;
        pressureInput.value = data.P;
        if (data.v) volumeInput.value = data.v;

        // Ensure proper state update if water was selected
        if (gasSelector.value === 'water') {
             showWaterFields();
        } else {
             updateValues('T');
             updateValues('P');
             updateValues('v');
        }

        sessionStorage.removeItem('backToSim1Data');
    }

    // ------------------------------
    // Error elements
    // ------------------------------
    const createErrorEl = (input) => {
        const el = document.createElement('p');
        el.className = 'text-red-500 text-sm mt-1 hidden';
        input.parentElement.appendChild(el);
        return el;
    };
    const tempError = createErrorEl(tempInput);
    const pressureError = createErrorEl(pressureInput);
    const volumeError = createErrorEl(volumeInput);
    const cpError = createErrorEl(cpInput);
    const cvError = createErrorEl(cvInput);

    // ------------------------------
    // Predefined gases
    // ------------------------------
    const gases = {
        air: { R: 0.287, k: 1.4 },
        nitrogen: { R: 0.2968, k: 1.4 },
        Methane: { R: 0.518, k: 1.31 },
        oxygen: { R: 0.2598, k: 1.4 }
    };
    let currentR = gases.air.R;

    // ------------------------------
    // Ideal gas calculations
    // ------------------------------
    const calculateVolume = (T, P, R) => (T && P) ? (T * R / P).toFixed(5) : '';
    const calculatePressure = (T, v, R) => (T && v) ? (T * R / v).toFixed(5) : '';
    const calculateTemperature = (P, v, R) => (P && v) ? (P * v / R).toFixed(5) : '';

    // ------------------------------
    // Water functions
    // ------------------------------
    const getTsat = async (P_bar) => {
        try {
            const resp = await fetch(`/get-tsat?P=${P_bar}`);
            const data = await resp.json();
            return data.Tsat;
        } catch (err) {
            console.error('Error fetching Tsat:', err);
            return null;
        }
    };

    const updateWaterState = async () => {
        const T = parseFloat(tempInput.value);
        const P_bar = parseFloat(pressureInput.value);

        phaseOutput.textContent = ''; // Clear previous message
        phaseOutput.style.color = 'black'; // Reset color

        if (isNaN(T) || isNaN(P_bar)) {
            qualityInput.value = '';
            qualityInput.readOnly = true;
            validateForm();
            return;
        }

        const Tsat = await getTsat(P_bar);
        if (Tsat === null) {
            phaseOutput.textContent = 'Error: Saturation data unavailable.';
            phaseOutput.style.color = 'red';
            return;
        }

        // ±1°C tolerance for enabling quality input (The requested generous range)
        const T_min = Tsat - 1;
        const T_max = Tsat + 1;

        let phase = '';

        if (T >= T_min && T <= T_max) {
            // Saturated Mixture (within tolerance)
            phase = `Saturated Mixture (Tsat ≈ ${Tsat.toFixed(2)} °C)`;
            phaseOutput.style.color = 'blue';

            qualityInput.readOnly = false;
            // Retain existing value if valid, otherwise clear
            let currentX = parseFloat(qualityInput.value);
            if (isNaN(currentX) || currentX < 0 || currentX > 1) {
                qualityInput.value = '';
            }
            qualityInput.min = 0;
            qualityInput.max = 1;
        } else if (T < T_min) {
            // Subcooled Liquid
            phase = `Subcooled Liquid (T < Tsat=${Tsat.toFixed(2)} °C)`;
            phaseOutput.style.color = 'green';
            qualityInput.readOnly = true;
            qualityInput.value = 0; // x=0 for subcooled liquid
        } else { // T > T_max
            // Superheated Vapor
            phase = `Superheated Vapor (T > Tsat=${Tsat.toFixed(2)} °C)`;
            phaseOutput.style.color = 'red';
            qualityInput.readOnly = true;
            qualityInput.value = 1; // x=1 for superheated vapor (or dry steam)
        }

        phaseOutput.textContent = `Phase: ${phase}`;
        validateForm(); // ensure Next button state
    };

    // Add dynamic quality input validation only once
    qualityInput.addEventListener('input', () => {
        let val = parseFloat(qualityInput.value);
        if (!isNaN(val)) {
            if (val < 0) qualityInput.value = 0;
            if (val > 1) qualityInput.value = 1;
        }
        validateForm();
    });


    const showWaterFields = () => {
        tempInput.placeholder = 'Temperature (°C)';
        pressureInput.placeholder = 'Pressure (bar)';
        if (volumeLabel.parentNode) volumeLabel.remove();
        volumeInput.classList.add('hidden'); // Hide volume input for water initially

        // Show water-specific fields
        qualityField.style.display = 'flex';
        phaseOutput.style.display = 'block';

        updateWaterState();
    };

    const hideWaterFields = () => {
        tempInput.placeholder = 'in Kelvin (K)';
        pressureInput.placeholder = 'in kPa';

        // Hide water-specific fields
        qualityField.style.display = 'none';
        phaseOutput.style.display = 'none';
        phaseOutput.textContent = ''; // Clear phase status

        // Restore volume input for ideal gas
        volumeInput.classList.remove('hidden');
        if (!document.getElementById('volume-label')) {
            if (volumeNextSibling) volumeParent.insertBefore(volumeLabel, volumeNextSibling);
            else volumeParent.appendChild(volumeLabel);
        }
    };

    // ------------------------------
    // Gas selector listener
    // ------------------------------
    gasSelector.addEventListener('change', () => {
        if (gasSelector.value === 'water') {
            showWaterFields();
        } else {
            hideWaterFields();
            if (gases[gasSelector.value]) {
                currentR = gases[gasSelector.value].R;
                if (!isNaN(tempInput.value) && !isNaN(pressureInput.value)) {
                    volumeInput.value = calculateVolume(parseFloat(tempInput.value), parseFloat(pressureInput.value), currentR);
                }
            }
        }
        validateForm();
    });

    // ------------------------------
    // Input listeners
    // ------------------------------
    tempInput.addEventListener('input', () => {
        if (gasSelector.value === 'water') updateWaterState();
        else updateValues('T');
    });
    pressureInput.addEventListener('input', () => {
        if (gasSelector.value === 'water') updateWaterState();
        else updateValues('P');
    });
    volumeInput.addEventListener('input', () => {
        if (gasSelector.value !== 'water') updateValues('v');
    });

    // ------------------------------
    // Custom gas
    // ------------------------------
    const updateCustomGas = () => {
        const cp = parseFloat(cpInput.value);
        const cv = parseFloat(cvInput.value);
        if (!isNaN(cp) && !isNaN(cv) && cp > cv) {
            currentR = cp - cv;
            rInput.value = currentR.toFixed(5);
            kInput.value = (cp / cv).toFixed(5);
            if (!isNaN(tempInput.value) && !isNaN(pressureInput.value)) {
                volumeInput.value = calculateVolume(parseFloat(tempInput.value), parseFloat(pressureInput.value), currentR);
            }
        } else {
            rInput.value = '';
            kInput.value = '';
        }
        validateForm();
    };
    cpInput.addEventListener('input', updateCustomGas);
    cvInput.addEventListener('input', updateCustomGas);

    // ------------------------------
    // Validation
    // ------------------------------
    const validateForm = () => {
        let isValid = true;

        const T = parseFloat(tempInput.value);
        const P = parseFloat(pressureInput.value);
        const v = parseFloat(volumeInput.value);
        const cp = parseFloat(cpInput.value);
        const cv = parseFloat(cvInput.value);
        const x = parseFloat(qualityInput.value);

        [tempError, pressureError, volumeError, cpError, cvError].forEach(e => e.classList.add('hidden'));

        if (gasSelector.value === 'water') {
            if (isNaN(T)) { tempError.textContent = 'Temperature is required'; tempError.classList.remove('hidden'); isValid = false; }
            if (isNaN(P)) { pressureError.textContent = 'Pressure is required'; pressureError.classList.remove('hidden'); isValid = false; }
            // Only validate quality if the field is enabled (i.e., saturated mixture)
            if (qualityInput.readOnly === false && (isNaN(x) || x < 0 || x > 1)) {
                // Don't show an explicit error, just block next button
                isValid = false;
            }
        } else {
            if (isNaN(T)) { tempError.textContent = 'Temperature is required'; tempError.classList.remove('hidden'); isValid = false; }
            if (isNaN(P)) { pressureError.textContent = 'Pressure is required'; pressureError.classList.remove('hidden'); isValid = false; }
            // The original validation checks if v is NaN, which is a good failsafe.
            if (gasSelector.value !== 'water' && isNaN(v)) { volumeError.textContent = 'Volume is required'; volumeError.classList.remove('hidden'); isValid = false; }

            if (gasSelector.value === 'custom') {
                if (isNaN(cp)) { cpError.textContent = 'cp is required'; cpError.classList.remove('hidden'); isValid = false; }
                if (isNaN(cv)) { cvError.textContent = 'cv is required'; cvError.classList.remove('hidden'); isValid = false; }
                if (!isNaN(cp) && !isNaN(cv) && cp <= cv) { cpError.textContent = 'cp must be greater than cv'; cpError.classList.remove('hidden'); isValid = false; }
            }
        }

        nextButton.disabled = !isValid;
        return isValid;
    };
    validateForm();

    // Initial call to set fields correctly on load
    if (gasSelector.value === 'water') showWaterFields();
    else hideWaterFields();


    // ------------------------------
    // Next button click
    // ------------------------------
    nextButton.addEventListener('click', async (e) => {
        if (!validateForm()) {
            alert('Please fill all required fields correctly.');
            return;
        }

        if (gasSelector.value === 'water') {
            e.preventDefault();
            // Get the final quality value, which will be 0 or 1 for non-saturated states
            const x_final = parseFloat(qualityInput.value);

            const payload = {
                gas_name: 'water',
                T: parseFloat(tempInput.value),
                P: parseFloat(pressureInput.value),
                x: isNaN(x_final) ? 0 : x_final // Default to 0 if quality is still empty in saturated region
            };

            try {
                const response = await fetch('/submit-gas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();

                if (result.status === 'success') {
                    window.location.href = '/simulation3.html';
                } else {
                    alert('Submission failed: ' + result.message);
                }
            } catch (err) {
                console.error(err);
                alert('Error connecting to backend.');
            }
            return;
        }

        const payload = {
            gas_name: gasSelector.value,
            T: parseFloat(tempInput.value),
            P: parseFloat(pressureInput.value),
            v: parseFloat(volumeInput.value),
            cp: cpInput.value ? parseFloat(cpInput.value) : null,
            cv: cvInput.value ? parseFloat(cvInput.value) : null,
            R: parseFloat(rInput.value),
            k: parseFloat(kInput.value)
        };

        try {
            nextButton.disabled = true;
            const response = await fetch("/submit-gas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.status === "success") {
                window.location.href = "/simulation2.html";
            } else {
                localStorage.setItem('gasData', JSON.stringify(payload));
                alert("Backend failed, data saved locally. Navigating to next page.");
                window.location.href = "/simulation2.html";
            }
        } catch (error) {
            console.error(error);
            localStorage.setItem('gasData', JSON.stringify(payload));
            alert("Error connecting to backend. Data saved locally.");
            window.location.href = "/simulation2.html";
        }
    });

    // ------------------------------
    // Dynamic updates for ideal gases
    // ------------------------------
    const updateValues = (changed) => {
        const T = parseFloat(tempInput.value);
        const P = parseFloat(pressureInput.value);
        const v = parseFloat(volumeInput.value);

        if (changed === 'T') {
            if (!isNaN(P)) volumeInput.value = calculateVolume(T, P, currentR);
            else if (!isNaN(v)) pressureInput.value = calculatePressure(T, v, currentR);
        } else if (changed === 'P') {
            if (!isNaN(T)) volumeInput.value = calculateVolume(T, P, currentR);
            else if (!isNaN(v)) tempInput.value = calculateTemperature(P, v, currentR);
        } else if (changed === 'v') {
            if (!isNaN(T)) pressureInput.value = calculatePressure(T, v, currentR);
            else if (!isNaN(P)) tempInput.value = calculateTemperature(P, v, currentR);
        }
        validateForm();
    };
});