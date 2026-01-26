const ext = typeof browser !== "undefined" ? browser : chrome;

// Elements DOM
const btnAnalyze = document.getElementById("btn-analyze");
const btnDetach = document.getElementById("btn-detach");
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

// API panel elements
const apiPanel = document.getElementById("api-panel");
const btnApi = document.getElementById("btn-api");
const btnCloseApi = document.getElementById("btn-close-api");
const apiToken = document.getElementById("api-token");
const btnSaveApi = document.getElementById("btn-save-api");
const btnTestApi = document.getElementById("btn-test-api");
const apiStatus = document.getElementById("api-status");

// War panel elements
const warPanel = document.getElementById("war-panel");
const btnWarOcr = document.getElementById("btn-war-ocr");
const btnCloseWar = document.getElementById("btn-close-war");
const warNames = document.getElementById("war-names");
const warPower = document.getElementById("war-power");
const btnWarAnalyze = document.getElementById("btn-war-analyze");
const warResult = document.getElementById("war-result");

// War portrait mode elements
const tabPortrait = document.getElementById("tab-portrait");
const tabManual = document.getElementById("tab-manual");
const warPortraitMode = document.getElementById("war-portrait-mode");
const warManualMode = document.getElementById("war-manual-mode");
const warPortraits = document.getElementById("war-portraits");
const btnWarCapture = document.getElementById("btn-war-capture");
const btnWarAnalyzePortraits = document.getElementById("btn-war-analyze-portraits");

// War Analyzer instance
let warAnalyzer = null;

// Portraits captures pour le mode War
let capturedWarPortraits = [null, null, null, null, null];

// Recuperer les portraits depuis le content script au demarrage
(async function loadSavedPortraits() {
  try {
    const result = await ext.storage.local.get("msf_war_portraits");
    if (result.msf_war_portraits && result.msf_war_portraits.length > 0) {
      capturedWarPortraits = result.msf_war_portraits;
      console.log("[Popup] Portraits recuperes depuis storage:", capturedWarPortraits.length);
      setTimeout(() => updateWarPortraitsDisplay(), 100);
      if (warPanel.classList.contains("hidden")) {
        warPanel.classList.remove("hidden");
      }
    }
  } catch (e) {
    console.log("[Popup] Pas de portraits sauvegardes:", e);
  }
})();

// API Key constante (ne change pas)
const MSF_API_KEY = "17wMKJLRxy3pYDCKG5ciP7VSU45OVumB2biCzzgw";

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
// Bouton Fenêtre Détachée
// ============================================

btnDetach.addEventListener("click", async () => {
  try {
    // Créer une fenêtre popup permanente
    const popupUrl = ext.runtime.getURL("popup/popup.html");

    await ext.windows.create({
      url: popupUrl,
      type: "popup",
      width: 450,
      height: 700,
      focused: true
    });

    // Fermer le popup actuel (optionnel)
    setTimeout(() => window.close(), 100);
  } catch (e) {
    console.error("[Popup] Erreur création fenêtre:", e);
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
  apiPanel.classList.add("hidden"); // Fermer l'autre panneau

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

// ============================================
// Panneau API
// ============================================

btnApi.addEventListener("click", async () => {
  apiPanel.classList.toggle("hidden");
  syncPanel.classList.add("hidden"); // Fermer l'autre panneau

  if (!apiPanel.classList.contains("hidden")) {
    // Charger le token sauvegarde
    const stored = await ext.storage.local.get(["msfApiToken"]);
    if (stored.msfApiToken) {
      apiToken.value = stored.msfApiToken;
    }
    setApiStatus("", "");
  }
});

btnCloseApi.addEventListener("click", () => {
  apiPanel.classList.add("hidden");
});

btnSaveApi.addEventListener("click", async () => {
  const token = apiToken.value.trim();

  if (!token) {
    setApiStatus("Token requis", "error");
    return;
  }

  // S'assurer que le token commence par "Bearer "
  const finalToken = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  await ext.storage.local.set({ msfApiToken: finalToken });
  setApiStatus("Token sauvegarde", "success");
});

btnTestApi.addEventListener("click", async () => {
  const token = apiToken.value.trim();

  if (!token) {
    setApiStatus("Token requis", "error");
    return;
  }

  const finalToken = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  btnTestApi.disabled = true;
  setApiStatus("Test en cours...", "");

  try {
    const response = await fetch("https://api.marvelstrikeforce.com/player/v1/card", {
      headers: {
        "x-api-key": MSF_API_KEY,
        "Authorization": finalToken
      }
    });

    if (response.ok) {
      const data = await response.json();
      const playerName = data.data?.name || "Inconnu";
      setApiStatus(`Connecte: ${playerName}`, "success");
      // Sauvegarder automatiquement si le test reussit
      await ext.storage.local.set({ msfApiToken: finalToken });
    } else if (response.status === 401) {
      setApiStatus("Token invalide ou expire", "error");
    } else {
      setApiStatus(`Erreur ${response.status}`, "error");
    }
  } catch (e) {
    setApiStatus("Erreur reseau: " + e.message, "error");
  } finally {
    btnTestApi.disabled = false;
  }
});

function setApiStatus(text, type) {
  apiStatus.textContent = text;
  apiStatus.className = "sync-status " + (type || "");
}

// ============================================
// Panneau War OCR
// ============================================

btnWarOcr.addEventListener("click", () => {
  warPanel.classList.toggle("hidden");
  syncPanel.classList.add("hidden");
  apiPanel.classList.add("hidden");

  if (!warPanel.classList.contains("hidden")) {
    warResult.classList.add("hidden");
  }
});

btnCloseWar.addEventListener("click", () => {
  warPanel.classList.add("hidden");
});

btnWarAnalyze.addEventListener("click", async () => {
  const namesText = warNames.value.trim();

  if (!namesText) {
    showWarResult("Entrez au moins un nom de personnage", "error");
    return;
  }

  // Parser les noms (1 par ligne)
  const names = namesText
    .split(/[\n\r]+/)
    .map(n => n.trim().toUpperCase())
    .filter(n => n.length > 0);

  if (names.length === 0) {
    showWarResult("Aucun nom valide detecte", "error");
    return;
  }

  // Parser la puissance
  const powerValue = parseFormattedNumber(warPower.value);

  btnWarAnalyze.disabled = true;
  showWarResult("Analyse en cours...", "");

  try {
    // Initialiser le WarAnalyzer si necessaire
    if (!warAnalyzer) {
      warAnalyzer = new WarAnalyzer();
      await warAnalyzer.init();
    }

    // Analyser l'equipe
    const result = warAnalyzer.analyzeEnemyTeam(names, powerValue || null);

    // Afficher les resultats
    displayWarResult(result);

  } catch (e) {
    console.error("[War] Erreur:", e);
    showWarResult("Erreur: " + e.message, "error");
  } finally {
    btnWarAnalyze.disabled = false;
  }
});

function showWarResult(message, type) {
  warResult.innerHTML = `<div class="${type === 'error' ? 'war-team-unknown' : ''}">${message}</div>`;
  warResult.classList.remove("hidden");
}

function displayWarResult(result) {
  let html = "";

  if (result.identified && result.team) {
    // Utiliser variantName si disponible, sinon name
    const teamDisplayName = result.team.variantName || result.team.name;
    html += `<div class="war-team-identified">Equipe: ${teamDisplayName}</div>`;

    if (result.matchConfidence) {
      html += `<div style="font-size:11px;color:#888;margin-bottom:8px;">Confiance: ${result.matchConfidence}%</div>`;
    }

    if (result.counters && result.counters.length > 0) {
      html += `<div class="counters-title">Counters recommandes:</div>`;
      html += `<div class="war-counters-list">`;

      result.counters.slice(0, 5).forEach(c => {
        html += `
          <div class="war-counter-item">
            <div class="war-counter-header">
              <span class="war-counter-name">${c.teamName}</span>
              <div class="war-counter-meta">
                <span class="war-counter-confidence">${c.confidence}%</span>
                ${c.minPower ? `<span class="war-counter-power">${formatPower(c.minPower)}+</span>` : ""}
              </div>
            </div>
            ${c.notes ? `<div class="war-counter-notes">${c.notes}</div>` : ""}
          </div>
        `;
      });

      html += `</div>`;
    } else {
      html += `<div class="war-team-unknown">Aucun counter defini pour cette equipe</div>`;
    }
  } else {
    html += `<div class="war-team-unknown">Equipe non identifiee</div>`;

    if (result.characters && result.characters.length > 0) {
      html += `<div style="font-size:11px;color:#888;margin-top:6px;">Personnages detectes: ${result.characters.join(", ")}</div>`;
    }
  }

  warResult.innerHTML = html;
  warResult.classList.remove("hidden");
}

// ============================================
// War Mode - Onglets
// ============================================

tabPortrait.addEventListener("click", () => {
  tabPortrait.classList.add("active");
  tabManual.classList.remove("active");
  warPortraitMode.classList.remove("hidden");
  warManualMode.classList.add("hidden");
});

tabManual.addEventListener("click", () => {
  tabManual.classList.add("active");
  tabPortrait.classList.remove("active");
  warManualMode.classList.remove("hidden");
  warPortraitMode.classList.add("hidden");
});

// ============================================
// War Mode - Capture Portraits
// ============================================

btnWarCapture.addEventListener("click", async () => {
  try {
    // Lancer le calibrateur en mode portrait
    await ext.runtime.sendMessage({
      type: "MSF_START_PORTRAIT_CAPTURE",
      count: 5
    });
    setStatus("Sélectionnez les 5 portraits (VALIDEZ quand terminé)");
    // Ne pas fermer le popup - il se mettra à jour automatiquement
  } catch (e) {
    showWarResult("Erreur: " + e.message, "error");
  }
});

// Ecouter les portraits captures depuis le content script
ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "MSF_PORTRAITS_CAPTURED") {
    console.log("[Popup] Portraits reçus:", msg.portraits.length);
    capturedWarPortraits = msg.portraits;
    updateWarPortraitsDisplay();
    setStatus(`✅ ${msg.portraits.length} portraits capturés !`, "success");

    // Ouvrir automatiquement le panneau War si pas déjà ouvert
    if (warPanel.classList.contains("hidden")) {
      warPanel.classList.remove("hidden");
    }

    // S'assurer que l'onglet Portrait est actif
    if (!tabPortrait.classList.contains("active")) {
      tabPortrait.click();
    }

    sendResponse({ received: true });
  }

  // Mode multi-equipes
  if (msg.type === "MSF_MULTI_TEAMS_CAPTURED") {
    console.log("[Popup] Multi-equipes reçues:", msg.teams.length);
    handleMultiTeamsCapture(msg.teams);
    sendResponse({ received: true });
  }
});

/**
 * Met a jour l'affichage des portraits captures
 */
function updateWarPortraitsDisplay() {
  const slots = warPortraits.querySelectorAll(".war-portrait-slot");

  slots.forEach((slot, i) => {
    const portrait = capturedWarPortraits[i];

    if (portrait && portrait.dataUrl) {
      slot.innerHTML = `
        <img src="${portrait.dataUrl}" alt="Portrait ${i + 1}">
        ${portrait.name ? `<div class="portrait-name">${portrait.name}</div>` : ""}
        ${portrait.similarity ? `<div class="portrait-badge ${portrait.similarity >= 70 ? 'good' : 'unknown'}">${portrait.similarity >= 70 ? '✓' : '?'}</div>` : ""}
      `;
      slot.classList.add("has-portrait");
      if (portrait.name && portrait.similarity >= 70) {
        slot.classList.add("identified");
      }
    } else {
      slot.innerHTML = `<div class="portrait-placeholder">${i + 1}</div>`;
      slot.classList.remove("has-portrait", "identified");
    }
  });
}

// Permettre de coller des images depuis le clipboard
document.addEventListener("paste", async (e) => {
  if (warPanel.classList.contains("hidden")) return;
  if (!tabPortrait.classList.contains("active")) return;

  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const blob = item.getAsFile();
      const dataUrl = await blobToDataUrl(blob);

      // Trouver le premier slot vide
      const emptyIndex = capturedWarPortraits.findIndex(p => !p);
      if (emptyIndex !== -1) {
        capturedWarPortraits[emptyIndex] = { dataUrl };
        updateWarPortraitsDisplay();
      }
      break;
    }
  }
});

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Click sur un slot pour le modifier ou le supprimer
warPortraits.addEventListener("click", async (e) => {
  const slot = e.target.closest(".war-portrait-slot");
  if (!slot) return;

  const index = parseInt(slot.dataset.index);
  const portrait = capturedWarPortraits[index];

  if (!portrait) return;

  // Proposer les options
  const action = confirm(
    `Portrait: ${portrait.name || "Non identifié"}\n\n` +
    `Cliquez OK pour CORRIGER le nom\n` +
    `Cliquez Annuler pour SUPPRIMER ce portrait`
  );

  if (action) {
    // Corriger le nom
    const newName = prompt(
      "Entrez le nom correct du personnage:",
      portrait.name || ""
    );

    if (newName && newName.trim()) {
      // Calculer le hash du portrait
      if (!warAnalyzer) {
        warAnalyzer = new WarAnalyzer();
        await warAnalyzer.init();
      }

      const hash = await warAnalyzer.computePortraitHash(portrait.dataUrl);

      // Chercher le charId dans la base
      let charId = null;
      if (warAnalyzer.nameToId) {
        const normalizedName = newName.trim().toUpperCase();
        charId = warAnalyzer.nameToId[normalizedName] || null;
      }

      // Mettre à jour le portrait
      portrait.name = newName.trim();
      portrait.charId = charId;
      portrait.hash = hash;

      // Sauvegarder dans la base locale
      try {
        const stored = await ext.storage.local.get("msfPortraits");
        const portraits = stored.msfPortraits || {};
        portraits[hash] = {
          name: portrait.name,
          charId: charId
        };
        await ext.storage.local.set({ msfPortraits: portraits });
        console.log(`[Popup] Portrait sauvegardé: ${portrait.name} = ${hash}`);
      } catch (e) {
        console.error("[Popup] Erreur sauvegarde portrait:", e);
      }

      // Mettre à jour l'affichage
      updateWarPortraitsDisplay();

      // Sauvegarder les portraits mis à jour
      await ext.storage.local.set({ msf_war_portraits: capturedWarPortraits });
    }
  } else {
    // Supprimer le portrait
    capturedWarPortraits[index] = null;
    updateWarPortraitsDisplay();
  }
});

// ============================================
// War Mode - Analyse Portraits
// ============================================

btnWarAnalyzePortraits.addEventListener("click", async () => {
  const portraits = capturedWarPortraits.filter(p => p && p.dataUrl);

  if (portraits.length < 3) {
    showWarResult("Capturez au moins 3 portraits", "error");
    return;
  }

  const powerValue = parseFormattedNumber(warPower.value);

  btnWarAnalyzePortraits.disabled = true;
  showWarResult("Analyse des portraits...", "");

  try {
    // Initialiser le WarAnalyzer si necessaire
    if (!warAnalyzer) {
      warAnalyzer = new WarAnalyzer();
      await warAnalyzer.init();
    }

    // Analyser les portraits
    const portraitDataUrls = portraits.map(p => p.dataUrl);
    const result = await warAnalyzer.analyzeEnemyTeamFromPortraits(portraitDataUrls, powerValue || null);

    // Mettre a jour l'affichage des portraits avec les noms identifies
    if (result.portraits) {
      result.portraits.forEach((p, i) => {
        if (capturedWarPortraits[i]) {
          capturedWarPortraits[i].name = p.name;
          capturedWarPortraits[i].similarity = p.similarity;
          capturedWarPortraits[i].charId = p.charId;
          capturedWarPortraits[i].hash = p.hash;
        }
      });
      updateWarPortraitsDisplay();
    }

    // Afficher les resultats
    displayWarResult(result);

  } catch (e) {
    console.error("[War] Erreur analyse portraits:", e);
    showWarResult("Erreur: " + (e?.message || "Erreur inconnue"), "error");
  } finally {
    btnWarAnalyzePortraits.disabled = false;
  }
});

// Note: btnCloseWar listener est defini plus haut

// ============================================
// War Mode - Multi-Teams Analysis
// ============================================

/**
 * Gere la capture et l'analyse de plusieurs equipes
 */
async function handleMultiTeamsCapture(teams) {
  setStatus(`Analyse de ${teams.length} equipes...`, "");

  // Ouvrir le panneau War
  if (warPanel.classList.contains("hidden")) {
    warPanel.classList.remove("hidden");
  }

  // Initialiser le WarAnalyzer
  if (!warAnalyzer) {
    warAnalyzer = new WarAnalyzer();
    await warAnalyzer.init();
  }

  const results = [];

  for (const team of teams) {
    try {
      const portraitDataUrls = team.portraits.map(p => p.dataUrl);
      const result = await warAnalyzer.analyzeEnemyTeamFromPortraits(portraitDataUrls, null);
      results.push({
        teamIndex: team.teamIndex,
        ...result
      });
    } catch (e) {
      console.error(`[Popup] Erreur analyse equipe ${team.teamIndex}:`, e);
      results.push({
        teamIndex: team.teamIndex,
        identified: false,
        error: e.message
      });
    }
  }

  // Afficher les resultats
  displayMultiTeamResults(results);
  setStatus(`✅ ${results.length} equipes analysees`, "success");
}

/**
 * Affiche les resultats pour plusieurs equipes
 */
function displayMultiTeamResults(results) {
  let html = `<div class="multi-team-results">`;

  for (const result of results) {
    html += `<div class="team-result-card">`;
    html += `<div class="team-result-header">Equipe ${result.teamIndex}</div>`;

    if (result.identified && result.team) {
      const teamDisplayName = result.team.variantName || result.team.name;
      html += `<div class="team-result-name">${teamDisplayName}</div>`;

      if (result.counters && result.counters.length > 0) {
        html += `<div class="team-result-counters">`;
        result.counters.slice(0, 3).forEach(c => {
          html += `<div class="mini-counter">
            <span class="counter-team">${c.teamName}</span>
            <span class="counter-conf">${c.confidence}%</span>
          </div>`;
        });
        html += `</div>`;
      } else {
        html += `<div class="no-counters">Pas de counters</div>`;
      }
    } else {
      html += `<div class="team-unknown">Non identifiee</div>`;
      if (result.characters) {
        const names = result.characters.filter(n => n && n !== "?").join(", ");
        if (names) {
          html += `<div class="team-chars">${names}</div>`;
        }
      }
    }

    html += `</div>`;
  }

  html += `</div>`;

  warResult.innerHTML = html;
  warResult.classList.remove("hidden");
}

// ============================================
// War Mode - Barracks Scan
// ============================================

const btnWarBarracks = document.getElementById("btn-war-barracks");
const btnWarCalibrate = document.getElementById("btn-war-calibrate");
const calibrationStatus = document.getElementById("calibration-status");

btnWarCalibrate.addEventListener("click", async () => {
  try {
    await ext.runtime.sendMessage({ type: "MSF_CALIBRATE_BARRACKS" });
    calibrationStatus.textContent = "Calibration lancee - suivez les instructions a l'ecran";
    calibrationStatus.style.color = "#00d4ff";
    // Fermer le popup pour voir la calibration
    setTimeout(() => window.close(), 500);
  } catch (e) {
    console.error("[Popup] Erreur calibration:", e);
    calibrationStatus.textContent = "Erreur: " + e.message;
    calibrationStatus.style.color = "#ff4444";
  }
});

btnWarBarracks.addEventListener("click", async () => {
  try {
    // Mode scan par clic - pas besoin de calibration obligatoire
    await ext.runtime.sendMessage({ type: "MSF_START_CLICK_SCAN" });
    calibrationStatus.textContent = "Cliquez sur une equipe a scanner";
    calibrationStatus.style.color = "#00d4ff";
    // Fermer le popup pour voir l'overlay
    setTimeout(() => window.close(), 500);
  } catch (e) {
    console.error("[Popup] Erreur scan:", e);
    calibrationStatus.textContent = "Erreur: " + e.message;
    calibrationStatus.style.color = "#ff4444";
  }
});

// Afficher le statut de calibration au chargement
(async function checkCalibrationStatus() {
  try {
    const result = await ext.storage.local.get("msf_barracks_calibration");
    if (result.msf_barracks_calibration) {
      const cal = result.msf_barracks_calibration;
      calibrationStatus.textContent = `Taille carte: ${Math.round(cal.card1.width)}x${Math.round(cal.card1.height)}px`;
      calibrationStatus.style.color = "#888";
    } else {
      calibrationStatus.textContent = "Taille par defaut (290x320px avec EDIT)";
      calibrationStatus.style.color = "#666";
    }
  } catch (e) {
    console.log("[Popup] Pas de calibration:", e);
  }
})();
