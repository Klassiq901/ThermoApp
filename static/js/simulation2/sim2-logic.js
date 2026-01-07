// sim2-logic.js
document.addEventListener("DOMContentLoaded", () => {
    const volInput = document.getElementById("volRatio");
    const presInput = document.getElementById("presRatio");
    const procRadios = document.querySelectorAll("input[name='thermodynamic_process']");
    const polyNInput = document.getElementById("polyN");
    const polytropicContainer = document.getElementById("polytropic_input_container");
    const simulateBtn = document.getElementById("simulateBtn"); // your button

    let currentProcess = "Isothermal";
    let k; // no default

    // Tooltip for k
    const kTooltip = document.createElement("span");
    kTooltip.style.position = "absolute";
    kTooltip.style.background = "#333";
    kTooltip.style.color = "#fff";
    kTooltip.style.padding = "4px 8px";
    kTooltip.style.borderRadius = "4px";
    kTooltip.style.fontSize = "12px";
    kTooltip.style.display = "none";
    kTooltip.style.zIndex = "1000";
    document.body.appendChild(kTooltip);

    function showTooltip(text, target) {
        kTooltip.textContent = text;
        const rect = target.getBoundingClientRect();
        kTooltip.style.top = `${rect.top + 26}px`;
        kTooltip.style.left = `${rect.left - 50}px`;
        kTooltip.style.display = "block";
        setTimeout(() => { kTooltip.style.display = "none"; }, 2000);
    }

    function setReadonly(input, readonly) {
        input.readOnly = readonly;
        input.classList.toggle("bg-gray-200", readonly);
        input.classList.toggle("dark:bg-gray-700", readonly);
    }

    function preventInvalidInput(e) {
        if (parseFloat(e.target.value) <= 0) e.target.value = "";
    }

    volInput.addEventListener("input", preventInvalidInput);
    presInput.addEventListener("input", preventInvalidInput);

    async function fetchK() {
        try {
            const response = await fetch("/api/k");
            const data = await response.json();
            if (data.k) {
                k = parseFloat(data.k);
                showTooltip(`Fetched k = ${k}`, document.getElementById("proc_adiabatic"));
            } else {
                console.error("No k value available:", data);
                k = undefined;
            }
        } catch (err) {
            console.error("Error fetching k:", err);
            k = undefined;
        }
    }

    function updateReadonlyState() {
        polytropicContainer.classList.toggle("hidden", currentProcess !== "Polytropic");

        switch (currentProcess) {
            case "Constant Volume":
                volInput.value = 1;
                setReadonly(volInput, true);
                setReadonly(presInput, false);
                break;
            case "Constant Pressure":
                presInput.value = 1;
                setReadonly(presInput, true);
                setReadonly(volInput, false);
                break;
            default:
                setReadonly(volInput, false);
                setReadonly(presInput, false);
                break;
        }
    }

    function updateRatios(changedInput) {
        let v = parseFloat(volInput.value);
        let p = parseFloat(presInput.value);
        let n = parseFloat(polyNInput.value) || 1;

        if (v <= 0 || p <= 0) return; // skip invalid

        switch (currentProcess) {
            case "Isothermal":
                if (changedInput === "vol" && v) presInput.value = (1 / v).toFixed(4);
                else if (changedInput === "pres" && p) volInput.value = (1 / p).toFixed(4);
                break;
            case "Adiabatic (n=k)":
                if (!k) return; // wait for k
                if (changedInput === "vol" && v) presInput.value = (1 / Math.pow(v, k)).toFixed(4);
                else if (changedInput === "pres" && p) volInput.value = Math.pow(1 / p, 1 / k).toFixed(4);
                break;
            case "Polytropic":
                if ((changedInput === "vol" || changedInput === "n") && v && n) {
                    presInput.value = (1 / Math.pow(v, n)).toFixed(4);
                } else if (changedInput === "pres" && p && n) {
                    volInput.value = Math.pow(1 / p, 1 / n).toFixed(4);
                }
                break;
        }
    }

    procRadios.forEach(radio => {
        radio.addEventListener("change", async () => {
            currentProcess = radio.value;
            if (currentProcess === "Adiabatic (n=k)") {
                await fetchK();
            }
            updateReadonlyState();
            updateRatios("vol");
        });
    });

    volInput.addEventListener("input", () => updateRatios("vol"));
    presInput.addEventListener("input", () => updateRatios("pres"));
    polyNInput.addEventListener("input", () => updateRatios("n"));

    updateReadonlyState();
    updateRatios("vol");

    // -------------------------
    // SIMULATE BUTTON FUNCTIONALITY WITH BACKEND
    // -------------------------
    simulateBtn.addEventListener("click", async () => {
        const selectedProcess = Array.from(procRadios).find(r => r.checked);
        if (!selectedProcess) {
            alert("⚠️ Please select a thermodynamic process.");
            return;
        }

        const v = parseFloat(volInput.value);
        if (isNaN(v) || v <= 0) {
            alert("⚠️ Please enter a valid volume ratio greater than 0.");
            return;
        }

        const p = parseFloat(presInput.value);
        if (isNaN(p) || p <= 0) {
            alert("⚠️ Please enter a valid pressure ratio greater than 0.");
            return;
        }

        let nValue = null;
        if (currentProcess === "Polytropic") {
            nValue = parseFloat(polyNInput.value);
            if (isNaN(nValue) || nValue <= 0) {
                alert("⚠️ Please enter a valid polytropic index 'n' greater than 0.");
                return;
            }
        }

        const payload = {
            process: selectedProcess.value,
            v_ratio: v,
            p_ratio: p,
            n_value: nValue
        };

        try {
            const response = await fetch("/submit-process", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (result.status === "success") {
                console.log("Process sent to backend successfully.");
                window.location.href = "results.html";
            } else {
                alert("❌ Failed to submit process: " + (result.message || "Unknown error"));
            }
        } catch (err) {
            alert("❌ Error sending data: " + err.message);
        }
    });

});
