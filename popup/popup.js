const ext = typeof browser !== "undefined" ? browser : chrome;

// Elements DOM
const btnAnalyze = document.getElementById("btn-analyze");
const btnCalibrate = document.getElementById("btn-calibrate");
const btnExport = document.getElementById("btn-export");
const btnImport = document.getElementById("btn-import");
const btnManage = document.getElementById("btn-manage");
const btnSettings = document.getElementById("btn-settings");
const importFile = document.getElementById("import-file");
const spinner = document.getElementById("spinner");
const statusText = document.getElementById("status-text");
const resultsSection = document.getElementById("results");

// Sync panel elements
const syncPanel = document.getElementById("sync-panel");
const btnCloseSync = document.getElementById("btn-close-sync");
const syncUrl = document.getElementById("sync-url");
const btnSync = document.getElementById("btn-sync");
const syncStatus = document.getElementById("sync-status");
const syncInfo = document.getElementById("sync-info");

// Donnees globales
let teamsData = [];
let countersData = {};
let currentSlots = []; // Resultats du dernier scan

// ============================================
// Chargement des donnees (equipes + counters)
// ============================================

async function loadTeamsAndCounters() {
  try {
    const teamsUrl = ext.runtime.getURL("data/teams.json");
    const countersUrl = ext.runtime.getURL("data/counters.json");

    const [teamsRes, countersRes] = await Promise.all([
      fetch(teamsUrl),
      fetch(countersUrl)
    ]);

    const teamsJson = await teamsRes.json();
    const countersJson = await countersRes.json();

    teamsData = teamsJson.teams || [];
    countersData = countersJson.counters || {};

    // Charger les counters remote/custom depuis storage
    const stored = await ext.storage.local.get(["msfRemoteCounters", "msfCustomCounters"]);

    if (stored.msfRemoteCounters && stored.msfRemoteCounters.counters) {
      Object.assign(countersData, stored.msfRemoteCounters.counters);
    }
    if (stored.msfCustomCounters) {
      Object.assign(countersData, stored.msfCustomCounters);
    }

    console.log("[Popup] Teams:", teamsData.length, "Counters:", Object.keys(countersData).length);
  } catch (e) {
    console.error("[Popup] Erreur chargement teams/counters:", e);
  }
}

// Charger au demarrage
loadTeamsAndCounters();

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

    currentSlots = response.slots;
    displayResults(currentSlots);
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
// Bouton Exporter
// ============================================

btnExport.addEventListener("click", async () => {
  try {
    const stored = await ext.storage.local.get(["msfZonesConfig", "msfPortraits"]);

    const exportData = {
      version: 1,
      exportDate: new Date().toISOString(),
      zones: stored.msfZonesConfig || null,
      portraits: stored.msfPortraits || {}
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `msf-config-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
    setStatus("Config exportee", "success");
  } catch (e) {
    setStatus("Erreur export: " + e.message, "error");
  }
});

// ============================================
// Bouton Importer
// ============================================

btnImport.addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.zones) {
      await ext.storage.local.set({ msfZonesConfig: data.zones });
    }

    if (data.portraits) {
      // Fusionner avec les portraits existants
      const stored = await ext.storage.local.get("msfPortraits");
      const merged = { ...(stored.msfPortraits || {}), ...data.portraits };
      await ext.storage.local.set({ msfPortraits: merged });
    }

    const zoneCount = data.zones ? data.zones.slots.length : 0;
    const portraitCount = data.portraits ? Object.keys(data.portraits).length : 0;
    setStatus(`Importe: ${zoneCount} slots, ${portraitCount} portraits`, "success");

    // Reset le file input
    importFile.value = "";
  } catch (e) {
    setStatus("Erreur import: " + e.message, "error");
  }
});

// ============================================
// Bouton Gerer Counters
// ============================================

btnManage.addEventListener("click", () => {
  window.location.href = "manage.html";
});

// ============================================
// Panneau Synchronisation
// ============================================

btnSettings.addEventListener("click", async () => {
  syncPanel.classList.toggle("hidden");

  if (!syncPanel.classList.contains("hidden")) {
    // Charger l'URL sauvegardee et les infos de sync
    const stored = await ext.storage.local.get(["msfSyncUrl", "msfRemoteCounters"]);

    if (stored.msfSyncUrl) {
      syncUrl.value = stored.msfSyncUrl;
    }

    if (stored.msfRemoteCounters) {
      const info = stored.msfRemoteCounters;
      const date = info.syncedAt ? new Date(info.syncedAt).toLocaleString("fr-FR") : "?";
      const count = info.counters ? Object.keys(info.counters).length : 0;
      syncInfo.textContent = `Derniere sync: ${date} (${count} equipes)`;
    } else {
      syncInfo.textContent = "Aucune synchronisation effectuee";
    }
  }
});

btnCloseSync.addEventListener("click", () => {
  syncPanel.classList.add("hidden");
});

btnSync.addEventListener("click", async () => {
  const url = syncUrl.value.trim();

  if (!url) {
    setSyncStatus("URL requise", "error");
    return;
  }

  // Valider l'URL
  try {
    new URL(url);
  } catch {
    setSyncStatus("URL invalide", "error");
    return;
  }

  // Sauvegarder l'URL
  await ext.storage.local.set({ msfSyncUrl: url });

  btnSync.disabled = true;
  setSyncStatus("Synchronisation...", "");

  try {
    // Envoyer la requete au content script via background
    const response = await ext.runtime.sendMessage({
      type: "MSF_SYNC_COUNTERS",
      url: url
    });

    if (response.success) {
      setSyncStatus(response.message, "success");
      syncInfo.textContent = `Sync: ${new Date().toLocaleString("fr-FR")} (${response.count} equipes)`;
    } else {
      setSyncStatus("Erreur: " + response.message, "error");
    }
  } catch (e) {
    setSyncStatus("Erreur: " + e.message, "error");
  } finally {
    btnSync.disabled = false;
  }
});

function setSyncStatus(text, type) {
  syncStatus.textContent = text;
  syncStatus.className = "sync-status " + (type || "");
}

// ============================================
// Affichage des resultats
// ============================================

function displayResults(slots) {
  resultsSection.innerHTML = "";

  slots.forEach((slot, slotIndex) => {
    const slotDiv = document.createElement("div");
    slotDiv.className = "slot-result";
    slotDiv.dataset.slotIndex = slotIndex;

    const powerValue = slot.power || 0;

    // Nom de l'equipe identifiee ou selecteur
    const isIdentified = slot.team && slot.team.id;
    const teamName = isIdentified ? slot.team.name : "Equipe inconnue";
    const teamId = isIdentified ? slot.team.id : "";

    // Titres des portraits avec noms identifies
    const portraitTitles = slot.identifiedPortraits || [];

    // Counters suggeres
    const counters = slot.counters || [];

    // Generer le HTML des counters
    const countersHtml = generateCountersHtml(counters);

    // Selecteur d'equipe (toujours present, mais pre-selectionne si identifie)
    const teamOptions = teamsData.map(t =>
      `<option value="${t.id}" ${t.id === teamId ? "selected" : ""}>${t.name}</option>`
    ).join("");

    slotDiv.innerHTML = `
      <div class="slot-header">
        <div class="slot-info">
          <span class="slot-title">Slot ${slot.slotNumber}</span>
          <select class="team-selector" data-slot-index="${slotIndex}">
            <option value="">-- Selectionner equipe --</option>
            ${teamOptions}
          </select>
        </div>
        <div class="slot-power-edit">
          <input type="text"
                 class="power-input"
                 value="${formatPower(powerValue)}"
                 data-slot="${slot.slotNumber}"
                 data-slot-index="${slotIndex}"
                 data-raw="${powerValue}"
                 title="Cliquer pour modifier">
        </div>
      </div>
      <div class="portraits">
        ${slot.portraits.map((p, i) => {
          const identified = portraitTitles[i];
          const name = identified && identified.name ? identified.name : `Inconnu`;
          const sim = identified && identified.similarity ? ` (${identified.similarity}%)` : "";
          const hash = identified && identified.hash ? identified.hash : "";
          return `<img src="${p}" alt="${name}" class="portrait-thumb" title="${name}${sim}" data-hash="${hash}" data-name="${name}">`;
        }).join("")}
      </div>
      ${countersHtml}
    `;

    resultsSection.appendChild(slotDiv);
  });

  // Ajouter les event listeners pour les inputs de puissance
  resultsSection.querySelectorAll(".power-input").forEach(input => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("blur", () => {
      const rawValue = parseFormattedNumber(input.value);
      input.dataset.raw = rawValue;
      input.value = formatPower(rawValue);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
  });

  // Ajouter les event listeners pour nommer les portraits
  resultsSection.querySelectorAll(".portrait-thumb").forEach(img => {
    img.style.cursor = "pointer";
    img.addEventListener("click", async () => {
      const currentName = img.dataset.name;
      const hash = img.dataset.hash;

      if (!hash) {
        alert("Hash non disponible pour ce portrait");
        return;
      }

      const name = prompt("Nom du personnage :", currentName === "Inconnu" ? "" : currentName);

      if (name && name.trim()) {
        await savePortraitHash(hash, name.trim());
        img.dataset.name = name.trim();
        img.title = name.trim();
        img.style.borderColor = "#51cf66";
        setTimeout(() => img.style.borderColor = "", 1000);
      }
    });
  });

  // Event listeners pour selecteur d'equipe
  resultsSection.querySelectorAll(".team-selector").forEach(select => {
    select.addEventListener("change", (e) => {
      const slotIndex = parseInt(e.target.dataset.slotIndex);
      const teamId = e.target.value;
      updateSlotCounters(slotIndex, teamId);
    });
  });

  resultsSection.classList.remove("hidden");
}

/**
 * Genere le HTML pour afficher les counters
 */
function generateCountersHtml(counters) {
  if (!counters || counters.length === 0) {
    return '<div class="counters no-counters"><span class="no-counters-text">Selectionnez une equipe pour voir les counters</span></div>';
  }

  return `
    <div class="counters">
      <div class="counters-title">Counters:</div>
      ${counters.slice(0, 3).map(c => `
        <div class="counter-item">
          <span class="counter-name">${c.teamName}</span>
          <span class="counter-confidence">${c.confidence}%</span>
          ${c.minPower ? `<span class="counter-power">${formatPower(c.minPower)}+</span>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

/**
 * Met a jour les counters d'un slot apres selection manuelle d'equipe
 */
function updateSlotCounters(slotIndex, teamId) {
  if (slotIndex < 0 || slotIndex >= currentSlots.length) return;

  const slot = currentSlots[slotIndex];
  const slotDiv = resultsSection.querySelector(`.slot-result[data-slot-index="${slotIndex}"]`);
  if (!slotDiv) return;

  // Calculer les nouveaux counters
  let counters = [];

  if (teamId && countersData[teamId]) {
    const powerValue = slot.power || 0;

    counters = countersData[teamId].map(counter => {
      const minPower = powerValue ? Math.round(powerValue * counter.minPowerRatio) : null;
      const counterTeam = teamsData.find(t => t.id === counter.team);
      return {
        teamId: counter.team,
        teamName: counterTeam ? counterTeam.name : counter.team,
        confidence: counter.confidence,
        minPowerRatio: counter.minPowerRatio,
        minPower: minPower,
        notes: counter.notes || null
      };
    }).sort((a, b) => b.confidence - a.confidence);
  }

  // Mettre a jour le slot dans currentSlots
  currentSlots[slotIndex].team = teamId ? { id: teamId, name: teamsData.find(t => t.id === teamId)?.name || teamId } : null;
  currentSlots[slotIndex].counters = counters;

  // Remplacer le HTML des counters
  const existingCounters = slotDiv.querySelector(".counters");
  if (existingCounters) {
    existingCounters.outerHTML = generateCountersHtml(counters);
  } else {
    slotDiv.insertAdjacentHTML("beforeend", generateCountersHtml(counters));
  }
}

/**
 * Sauvegarde le hash d'un portrait dans le storage
 */
async function savePortraitHash(hash, name) {
  try {
    const stored = await ext.storage.local.get("msfPortraits");
    const portraits = stored.msfPortraits || {};
    portraits[hash] = name;
    await ext.storage.local.set({ msfPortraits: portraits });
    console.log(`[Popup] Portrait enregistre: ${name} = ${hash}`);
  } catch (e) {
    console.error("[Popup] Erreur sauvegarde portrait:", e);
  }
}

/**
 * Parse un nombre formaté (ex: "3 986 869" ou "3,986,869") en nombre
 */
function parseFormattedNumber(str) {
  if (!str) return 0;
  // Supprimer tous les separateurs (espaces, virgules, points)
  const cleaned = str.replace(/[\s,.\u00A0]/g, "");
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
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
