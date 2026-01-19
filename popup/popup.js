const ext = typeof browser !== "undefined" ? browser : chrome;

// Elements DOM
const btnAnalyze = document.getElementById("btn-analyze");
const btnCalibrate = document.getElementById("btn-calibrate");
const spinner = document.getElementById("spinner");
const statusText = document.getElementById("status-text");
const resultsSection = document.getElementById("results");

// ============================================
// Bouton Analyser
// ============================================

btnAnalyze.addEventListener("click", async () => {
  setLoading(true);
  setStatus("Capture en cours...");
  resultsSection.classList.add("hidden");

  try {
    const response = await ext.runtime.sendMessage({ type: "MSF_ANALYZE_REQUEST" });

    if (response.error) {
      throw new Error(response.error);
    }

    if (!response.slots || response.slots.length === 0) {
      throw new Error("Aucun slot extrait");
    }

    displayResults(response.slots);
    setStatus("Analyse terminee", "success");

  } catch (e) {
    console.error("[Popup] Erreur:", e);
    setStatus("Erreur: " + e.message, "error");
  } finally {
    setLoading(false);
  }
});

// ============================================
// Bouton Calibrer
// ============================================

btnCalibrate.addEventListener("click", async () => {
  try {
    await ext.runtime.sendMessage({
      type: "MSF_START_CALIBRATOR",
      label: "CALIBRATION",
      showGrid: true
    });
    setStatus("Calibrateur lance (ESC pour quitter)");
    // Fermer le popup apres un delai
    setTimeout(() => window.close(), 500);
  } catch (e) {
    setStatus("Erreur: " + e.message, "error");
  }
});

// ============================================
// Affichage des resultats
// ============================================

function displayResults(slots) {
  resultsSection.innerHTML = "";

  slots.forEach(slot => {
    const slotDiv = document.createElement("div");
    slotDiv.className = "slot-result";

    const powerText = slot.power ? formatPower(slot.power) : "N/A";

    slotDiv.innerHTML = `
      <div class="slot-header">
        <span class="slot-title">Slot ${slot.slotNumber}</span>
        <span class="slot-power">${powerText}</span>
      </div>
      <div class="portraits">
        ${slot.portraits.map((p, i) =>
          `<img src="${p}" alt="Portrait ${i + 1}" class="portrait-thumb" title="Portrait ${i + 1}">`
        ).join("")}
      </div>
    `;

    resultsSection.appendChild(slotDiv);
  });

  resultsSection.classList.remove("hidden");
}

// ============================================
// Utilitaires
// ============================================

function formatPower(num) {
  if (!num) return "N/A";
  return num.toLocaleString("fr-FR");
}

function setLoading(loading) {
  if (loading) {
    spinner.classList.remove("hidden");
    btnAnalyze.disabled = true;
  } else {
    spinner.classList.add("hidden");
    btnAnalyze.disabled = false;
  }
}

function setStatus(text, type = "") {
  statusText.textContent = text;
  statusText.className = type; // "", "error", ou "success"
}
