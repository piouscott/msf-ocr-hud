const ext = typeof browser !== "undefined" ? browser : chrome;

// Wrapper pour storage.local.get compatible Chrome/Firefox
function storageGet(keys) {
  return new Promise((resolve) => {
    ext.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

// Wrapper pour storage.local.set compatible Chrome/Firefox
function storageSet(data) {
  return new Promise((resolve) => {
    ext.storage.local.set(data, () => resolve());
  });
}

// Elements DOM
const btnAnalyze = document.getElementById("btn-analyze");
const btnDetach = document.getElementById("btn-detach");
const btnNotes = document.getElementById("btn-notes");
const btnEvents = document.getElementById("btn-events");
const btnExport = document.getElementById("btn-export");
const btnImport = document.getElementById("btn-import");
const btnManage = document.getElementById("btn-manage");
const btnSettings = document.getElementById("btn-settings");
const importFile = document.getElementById("import-file");
const spinner = document.getElementById("spinner");
const statusText = document.getElementById("status-text");
const resultsSection = document.getElementById("results");

// Events panel elements
const eventsPanel = document.getElementById("events-panel");
const btnCloseEvents = document.getElementById("btn-close-events");
const eventsLoading = document.getElementById("events-loading");
const eventsError = document.getElementById("events-error");
const eventsList = document.getElementById("events-list");

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
const apiAutoCapture = document.getElementById("api-auto-capture");
const apiCaptureTime = document.getElementById("api-capture-time");

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

// Inverse Counters instance
let inverseCounters = null;

// Defense panel elements
const defensePanel = document.getElementById("defense-panel");
const btnDefense = document.getElementById("btn-defense");
const btnCloseDefense = document.getElementById("btn-close-defense");
const defenseTeamSelect = document.getElementById("defense-team-select");
const defenseCounters = document.getElementById("defense-counters");

// War event section elements
const warEventSection = document.getElementById("war-event-section");
const warTeamsList = document.getElementById("war-teams-list");

// Portraits captures pour le mode War
let capturedWarPortraits = [null, null, null, null, null];

// Recuperer les portraits depuis le content script au demarrage
(async function loadSavedPortraits() {
  try {
    const result = await storageGet("msf_war_portraits");
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

/**
 * Convertit le niveau de confiance en symboles visuels (triangles)
 * 95% = ▲▲▲ (20% punch up)
 * 80% = ▲▲ (10% punch up)
 * 65% = ▲ (5% punch up)
 * 50% = ⊜ (even match)
 */
function confidenceToSymbols(confidence) {
  if (confidence >= 95) return '<span style="color:#51cf66">▲▲▲</span>';
  if (confidence >= 80) return '<span style="color:#51cf66">▲▲</span>';
  if (confidence >= 65) return '<span style="color:#51cf66">▲</span>';
  if (confidence >= 50) return '<span style="color:#fcc419">⊜</span>';
  return '<span style="color:#ff6b6b">▼</span>';
}

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
    const stored = await storageGet(["msfRemoteCounters", "msfCustomCounters"]);

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
// Bouton Notes de Version
// ============================================

btnNotes.addEventListener("click", () => {
  const notesUrl = ext.runtime.getURL("RELEASE-NOTES.html");
  ext.tabs.create({ url: notesUrl });
});

// ============================================
// Bouton Events - Événements en cours
// ============================================

btnEvents.addEventListener("click", async () => {
  eventsPanel.classList.toggle("hidden");
  if (!eventsPanel.classList.contains("hidden")) {
    await loadEvents();
  }
});

btnCloseEvents.addEventListener("click", () => {
  eventsPanel.classList.add("hidden");
});

// ============================================
// Bouton Défense - Tester ma défense
// ============================================

btnDefense.addEventListener("click", async () => {
  defensePanel.classList.toggle("hidden");

  if (!defensePanel.classList.contains("hidden")) {
    await loadDefensePanel();
  }
});

btnCloseDefense.addEventListener("click", () => {
  defensePanel.classList.add("hidden");
});

async function loadDefensePanel() {
  try {
    if (!inverseCounters) {
      inverseCounters = new InverseCounters();
      await inverseCounters.init();
    }

    // Remplir le select avec les équipes de défense
    const defenseTeams = inverseCounters.getAllDefenseTeams();

    defenseTeamSelect.innerHTML = '<option value="">-- Sélectionner une équipe --</option>';
    defenseTeams.forEach(team => {
      const option = document.createElement("option");
      option.value = team.teamId;
      option.textContent = `${team.teamName} (${team.counterCount} counters)`;
      defenseTeamSelect.appendChild(option);
    });

    defenseCounters.classList.add("hidden");
    defenseCounters.innerHTML = "";

  } catch (e) {
    console.error("[Defense] Erreur chargement:", e);
  }
}

defenseTeamSelect.addEventListener("change", () => {
  const teamId = defenseTeamSelect.value;

  if (!teamId) {
    defenseCounters.classList.add("hidden");
    return;
  }

  const counters = inverseCounters.getCountersFor(teamId);

  if (counters.length === 0) {
    defenseCounters.innerHTML = '<div class="no-counters">Aucun counter connu pour cette équipe</div>';
  } else {
    defenseCounters.innerHTML = counters.map(c => `
      <div class="defense-counter-item">
        <span class="defense-counter-name">${c.teamName}</span>
        <span class="defense-counter-confidence">${confidenceToSymbols(c.confidence)}</span>
      </div>
      ${c.notes ? `<div style="font-size:10px;color:#888;padding:0 8px 8px;margin-top:-4px;">${c.notes}</div>` : ""}
    `).join("");
  }

  defenseCounters.classList.remove("hidden");
});

async function loadEvents() {
  eventsLoading.classList.remove("hidden");
  eventsError.classList.add("hidden");
  eventsList.classList.add("hidden");
  warEventSection.classList.add("hidden");

  try {
    // Utiliser le background script pour l'appel API (gestion du refresh token)
    const response = await ext.runtime.sendMessage({ type: "MSF_GET_EVENTS" });

    if (response.error) {
      throw new Error(response.error);
    }

    const events = response.events || [];
    const now = Date.now() / 1000;

    // Filtrer les événements actifs
    const activeEvents = events
      .filter(e => e.endTime > now && e.startTime < now);

    // Séparer par type
    const blitzEvents = activeEvents.filter(e => e.type === "blitz");
    const milestoneEvents = activeEvents.filter(e => e.type === "milestone" && e.milestone?.scoring);
    const raidEvents = activeEvents.filter(e => e.type === "raid");

    // Afficher tous les types
    renderAllEvents({ blitz: blitzEvents, milestone: milestoneEvents, raid: raidEvents });
    eventsLoading.classList.add("hidden");
    eventsList.classList.remove("hidden");

    // Vérifier si "Battle in War" est actif dans les milestones
    const hasWarEvent = milestoneEvents.some(e => {
      const scoring = e.milestone?.scoring;
      if (!scoring) return false;
      const allMethods = [
        ...(scoring.methods || []),
        ...(scoring.cappedScorings || []).flatMap(cs => cs.methods || [])
      ];
      return allMethods.some(m =>
        m.description?.toLowerCase().includes("war") ||
        m.description?.toLowerCase().includes("guerre")
      );
    });

    if (hasWarEvent) {
      await loadWarTeamsForEvent();
    }

  } catch (err) {
    eventsLoading.classList.add("hidden");
    eventsError.textContent = err.message;
    eventsError.classList.remove("hidden");
  }
}

/**
 * Charge et affiche les équipes offensives pour les events War
 */
async function loadWarTeamsForEvent() {
  try {
    if (!inverseCounters) {
      inverseCounters = new InverseCounters();
      await inverseCounters.init();
    }

    const offensiveTeams = inverseCounters.getAllOffensiveTeams().slice(0, 15); // Top 15

    if (offensiveTeams.length === 0) {
      return;
    }

    let html = "";
    offensiveTeams.forEach((team, idx) => {
      html += `
        <div class="war-team-card">
          <div class="war-team-header">
            <span class="war-team-name">${team.teamName}</span>
            <span class="war-team-count">Bat ${team.targetCount} équipes</span>
          </div>
          <button class="war-team-toggle" data-team-idx="${idx}">Voir cibles ▼</button>
          <div class="war-team-targets" id="war-targets-${idx}">
            ${team.targets.slice(0, 10).map(t => `
              <div class="war-target-item">
                <span class="war-target-name">${t.defenseName}</span>
                <span class="war-target-confidence">${confidenceToSymbols(t.confidence)}</span>
              </div>
            `).join("")}
            ${team.targets.length > 10 ? `<div class="war-target-item" style="color:#888">... et ${team.targets.length - 10} autres</div>` : ""}
          </div>
        </div>
      `;
    });

    warTeamsList.innerHTML = html;
    warEventSection.classList.remove("hidden");

    // Event listeners pour les toggles
    warTeamsList.querySelectorAll(".war-team-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = btn.dataset.teamIdx;
        const targets = document.getElementById(`war-targets-${idx}`);
        if (targets) {
          targets.classList.toggle("show");
          btn.textContent = targets.classList.contains("show") ? "Masquer ▲" : "Voir cibles ▼";
        }
      });
    });

  } catch (e) {
    console.error("[Events] Erreur chargement équipes War:", e);
  }
}

/**
 * Affiche tous les types d'événements
 */
function renderAllEvents({ blitz, milestone, raid }) {
  let html = "";

  // Blitz avec requirements (pour les counters inverses!)
  if (blitz.length > 0) {
    html += `<div class="events-section"><div class="events-section-title">Blitz</div>`;
    blitz.forEach(event => {
      const requirements = event.blitz?.requirements;
      const filters = requirements?.anyCharacterFilters || [];

      html += `
        <div class="event-card blitz">
          <div class="event-header">
            <span class="event-name">${event.name}</span>
            <span class="event-type">Blitz</span>
          </div>
          ${filters.length > 0 ? `
            <div class="event-filters">
              ${filters.map(f => `<span class="filter-tag">${f.filterName || f.filterType}</span>`).join("")}
            </div>
          ` : ""}
        </div>
      `;
    });
    html += `</div>`;
  }

  // Raids
  if (raid.length > 0) {
    html += `<div class="events-section"><div class="events-section-title">Raids</div>`;
    raid.forEach(event => {
      html += `
        <div class="event-card raid">
          <div class="event-header">
            <span class="event-name">${event.name}</span>
            <span class="event-type">Raid</span>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  // Milestones avec scoring
  if (milestone.length > 0) {
    html += `<div class="events-section"><div class="events-section-title">Milestones</div>`;
    milestone.forEach((event, idx) => {
      const scoring = event.milestone.scoring;
      const rows = [];

      if (scoring.methods) {
        scoring.methods.forEach(m => {
          rows.push({ desc: m.description, points: m.points, cap: null });
        });
      }
      if (scoring.cappedScorings) {
        scoring.cappedScorings.forEach(cs => {
          cs.methods.forEach(m => {
            rows.push({ desc: m.description, points: m.points, cap: cs.cap });
          });
        });
      }

      html += `
        <div class="event-card milestone">
          <div class="event-header">
            <span class="event-name">${event.name}</span>
            <span class="event-type">${event.milestone.typeName || "Milestone"}</span>
          </div>
          ${rows.length > 0 ? `
            <button class="event-toggle" data-event-idx="${idx}">
              ${rows.length} conditions ▼
            </button>
            <div class="event-details" id="event-details-${idx}">
              <table class="scoring-table">
                <thead><tr><th>Action</th><th>Pts</th><th>Cap</th></tr></thead>
                <tbody>
                  ${rows.map(r => `
                    <tr>
                      <td class="scoring-action">${r.desc}</td>
                      <td class="scoring-points">${formatNumber(r.points)}</td>
                      <td class="scoring-cap ${r.cap === null ? "unlimited" : ""}">${r.cap === null ? "∞" : formatNumber(r.cap)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : ""}
        </div>
      `;
    });
    html += `</div>`;
  }

  if (!html) {
    html = '<div class="no-counters">Aucun événement actif</div>';
  }

  eventsList.innerHTML = html;

  // Ajouter les event listeners pour les boutons toggle (CSP-compliant)
  eventsList.querySelectorAll(".event-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.eventIdx;
      toggleEventDetails(idx);
    });
  });
}


function toggleEventDetails(idx) {
  const details = document.getElementById(`event-details-${idx}`);
  if (details) {
    details.classList.toggle("show");
    const btn = details.previousElementSibling;
    if (btn && btn.classList.contains("event-toggle")) {
      const isOpen = details.classList.contains("show");
      btn.innerHTML = isOpen ? `Masquer ▲` : `Voir conditions ▼`;
    }
  }
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return n.toString();
}

// ============================================
// Bouton Exporter
// ============================================

btnExport.addEventListener("click", async () => {
  try {
    const stored = await storageGet(["msfZonesConfig", "msfPortraits"]);

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
      await storageSet({ msfZonesConfig: data.zones });
    }

    if (data.portraits) {
      // Fusionner avec les portraits existants
      const stored = await storageGet("msfPortraits");
      const merged = { ...(stored.msfPortraits || {}), ...data.portraits };
      await storageSet({ msfPortraits: merged });
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
    const stored = await storageGet(["msfSyncUrl", "msfRemoteCounters"]);

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
  await storageSet({ msfSyncUrl: url });

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
          <span class="counter-confidence">${confidenceToSymbols(c.confidence)}</span>
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
    const stored = await storageGet("msfPortraits");
    const portraits = stored.msfPortraits || {};
    portraits[hash] = name;
    await storageSet({ msfPortraits: portraits });
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

function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return "à l'instant";
  if (diffMins < 60) return `il y a ${diffMins} min`;
  if (diffHours < 24) return `il y a ${diffHours}h`;
  return date.toLocaleDateString("fr-FR");
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
    // Charger le token sauvegarde et les infos de capture
    const stored = await storageGet(["msfApiToken", "msfTokenCapturedAt", "msfTokenAutoCapture", "msfTokenType", "msfRefreshToken"]);
    if (stored.msfApiToken) {
      apiToken.value = stored.msfApiToken;
    }

    // Afficher l'indicateur de capture automatique si applicable
    if (stored.msfTokenAutoCapture && stored.msfTokenCapturedAt) {
      apiAutoCapture.classList.remove("hidden");
      apiAutoCapture.classList.add("captured");
      const captureDate = new Date(stored.msfTokenCapturedAt);
      const timeAgo = getTimeAgo(captureDate);
      apiCaptureTime.textContent = timeAgo;
    } else {
      apiAutoCapture.classList.add("hidden");
    }

    // Afficher le statut OAuth
    updateOAuthStatus(stored);
    setApiStatus("", "");
  }
});

// OAuth Login Button
const btnOAuthLogin = document.getElementById("btn-oauth-login");
const oauthStatus = document.getElementById("oauth-status");

function updateOAuthStatus(stored) {
  if (stored.msfTokenType === "oauth" && stored.msfRefreshToken) {
    oauthStatus.textContent = "✓ Connecté via OAuth";
    oauthStatus.className = "oauth-status success";
    btnOAuthLogin.textContent = "🔄 Reconnecter OAuth";
  } else {
    oauthStatus.textContent = "";
    oauthStatus.className = "oauth-status";
    btnOAuthLogin.textContent = "🔐 Connexion OAuth MSF";
  }
}

btnOAuthLogin.addEventListener("click", async () => {
  btnOAuthLogin.disabled = true;
  oauthStatus.textContent = "Ouverture de la page de connexion...";
  oauthStatus.className = "oauth-status info";

  try {
    // Récupérer la config OAuth depuis le background
    const config = await ext.runtime.sendMessage({ type: "MSF_GET_OAUTH_CONFIG" });

    // Générer un state aléatoire
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    // Construire l'URL d'autorisation
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", config.redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("state", state);

    // Ouvrir dans un nouvel onglet
    ext.tabs.create({ url: authUrl.toString() });

    oauthStatus.textContent = "Autorisez l'application puis collez le refresh token";
    oauthStatus.className = "oauth-status info";

  } catch (e) {
    oauthStatus.textContent = "Erreur: " + e.message;
    oauthStatus.className = "oauth-status error";
  } finally {
    btnOAuthLogin.disabled = false;
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

  await storageSet({ msfApiToken: finalToken });
  setApiStatus("Token sauvegarde", "success");
});

btnTestApi.addEventListener("click", async () => {
  btnTestApi.disabled = true;
  setApiStatus("Test en cours...", "");

  try {
    // Récupérer le token stocké et son type
    const stored = await storageGet(["msfApiToken", "msfTokenType"]);

    if (!stored.msfApiToken) {
      setApiStatus("Aucun token capturé", "error");
      return;
    }

    let url, headers;

    if (stored.msfTokenType === "titan") {
      // API web (api-prod) avec x-titan-token
      url = "https://api-prod.marvelstrikeforce.com/services/api/player";
      headers = {
        "x-titan-token": stored.msfApiToken,
        "x-app-version": "9.6.0-hp2",
        "Accept": "application/json"
      };
    } else {
      // API publique avec Bearer token
      const finalToken = stored.msfApiToken.startsWith("Bearer ")
        ? stored.msfApiToken
        : `Bearer ${stored.msfApiToken}`;
      url = "https://api.marvelstrikeforce.com/player/v1/card";
      headers = {
        "x-api-key": MSF_API_KEY,
        "Authorization": finalToken
      };
    }

    const response = await fetch(url, { headers });

    if (response.ok) {
      const data = await response.json();
      // Format différent selon l'API
      const playerName = stored.msfTokenType === "titan"
        ? (data.name || data.player?.name || "Joueur")
        : (data.data?.name || "Inconnu");
      setApiStatus(`Connecté: ${playerName}`, "success");
    } else if (response.status === 401 || response.status === 403) {
      setApiStatus("Token invalide ou expiré", "error");
    } else {
      setApiStatus(`Erreur ${response.status}`, "error");
    }
  } catch (e) {
    setApiStatus("Erreur réseau: " + e.message, "error");
  } finally {
    btnTestApi.disabled = false;
  }
});

function setApiStatus(text, type) {
  apiStatus.textContent = text;
  apiStatus.className = "sync-status " + (type || "");
}

// Bouton Debug Token
const btnCheckToken = document.getElementById("btn-check-token");
if (btnCheckToken) {
  btnCheckToken.addEventListener("click", async () => {
    setApiStatus("Vérification...", "");
    try {
      const result = await ext.runtime.sendMessage({ type: "MSF_CHECK_TOKEN" });
      if (result.hasToken) {
        const typeLabel = result.tokenType === "titan" ? "x-titan-token" : "Bearer";
        setApiStatus(`Token ${typeLabel} présent`, "success");
        console.log("[Debug] Token type:", result.tokenType);
        console.log("[Debug] Token preview:", result.tokenPreview);
        console.log("[Debug] Capturé:", result.capturedAt);
      } else {
        setApiStatus("Aucun token capturé. Jouez sur la version web.", "error");
      }
    } catch (e) {
      setApiStatus("Erreur: " + e.message, "error");
    }
  });
}

// Bouton Effacer Token
const btnClearToken = document.getElementById("btn-clear-token");
if (btnClearToken) {
  btnClearToken.addEventListener("click", async () => {
    if (!confirm("Effacer le token stocké ? Vous devrez rejouer sur la version web pour le recapturer.")) {
      return;
    }
    try {
      await storageSet({
        msfApiToken: null,
        msfTokenType: null,
        msfTokenCapturedAt: null,
        msfTokenAutoCapture: false
      });
      apiToken.value = "";
      apiAutoCapture.classList.add("hidden");
      setApiStatus("Token effacé. Jouez sur la version web pour recapturer.", "success");
    } catch (e) {
      setApiStatus("Erreur: " + e.message, "error");
    }
  });
}

// Bouton Get Squads (+ Roster complet)
const btnGetSquads = document.getElementById("btn-get-squads");
const squadsResult = document.getElementById("squads-result");
if (btnGetSquads) {
  btnGetSquads.addEventListener("click", async () => {
    setApiStatus("Récupération des données...", "");
    squadsResult.textContent = "";
    btnGetSquads.disabled = true;

    try {
      // Appeler les deux APIs en parallèle
      const [squadsResult2, rosterResult] = await Promise.all([
        ext.runtime.sendMessage({ type: "MSF_GET_SQUADS" }),
        ext.runtime.sendMessage({ type: "MSF_GET_ROSTER" }).catch(e => ({ error: e.message }))
      ]);

      console.log("[Debug] Squads result:", squadsResult2);
      console.log("[Debug] Roster result:", rosterResult);

      if (squadsResult2.error) {
        throw new Error(squadsResult2.error);
      }

      const squads = squadsResult2.squads || {};

      // L'API retourne tabs: { roster, blitz, tower, arena, raids, war, crucible }
      const actualTabs = squads.tabs || squads;

      const tabs = {
        raids: actualTabs.raids || [],
        arena: actualTabs.arena || [],
        war: actualTabs.war || [],
        blitz: actualTabs.blitz || [],
        tower: actualTabs.tower || [],
        crucible: actualTabs.crucible || [],
        roster: actualTabs.roster || []
      };

      // Afficher les squads par catégorie
      let output = [];

      // RAIDS (priorité)
      if (tabs.raids.length > 0) {
        output.push("=== RAIDS ===");
        tabs.raids.forEach((squad, i) => {
          const names = squad.filter(n => n).join(", ");
          output.push(`${i + 1}. ${names}`);
        });
      }

      // ARENA
      if (tabs.arena.length > 0) {
        output.push("\n=== ARENA ===");
        tabs.arena.forEach((squad, i) => {
          const names = squad.filter(n => n).join(", ");
          output.push(`${i + 1}. ${names}`);
        });
      }

      // WAR
      if (tabs.war.length > 0) {
        output.push(`\n=== WAR (${tabs.war.length}) ===`);
        output.push("(voir console pour détails)");
      }

      // Utiliser le roster complet si disponible, sinon fallback sur les squads
      let playerRosterIds;
      if (rosterResult.roster && rosterResult.roster.length > 0) {
        playerRosterIds = rosterResult.roster;
        output.push(`\n=== ROSTER COMPLET ===`);
        output.push(`${rosterResult.count} personnages possédés`);
      } else {
        // Fallback: extraire des squads
        const allRosterChars = new Set();
        const allTabs = [tabs.roster, tabs.blitz, tabs.war, tabs.arena, tabs.raids, tabs.tower, tabs.crucible];
        allTabs.forEach(tabSquads => {
          (tabSquads || []).forEach(squad => {
            (squad || []).forEach(charId => {
              if (charId) allRosterChars.add(charId);
            });
          });
        });
        playerRosterIds = Array.from(allRosterChars);
        output.push(`\n=== ROSTER (depuis squads) ===`);
        output.push(`${playerRosterIds.length} personnages (partiel)`);
      }

      // Sauvegarder les données pour manage.js
      await storageSet({
        msfPlayerRoster: playerRosterIds,
        msfWarSquads: tabs.war,
        msfSquadsUpdatedAt: new Date().toISOString()
      });

      setApiStatus(`${tabs.raids.length} RAID, ${tabs.arena.length} Arena, ${playerRosterIds.length} personnages`, "success");
      console.log("[Debug] Roster sauvegardé:", playerRosterIds.length, "personnages");

      squadsResult.textContent = output.join("\n");
    } catch (e) {
      setApiStatus("Erreur: " + e.message, "error");
    } finally {
      btnGetSquads.disabled = false;
    }
  });
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
                <span class="war-counter-confidence">${confidenceToSymbols(c.confidence)}</span>
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
      // Preparer l'affichage du nom avec alternatives si ambigu
      let nameDisplay = "";
      if (portrait.name) {
        nameDisplay = `<div class="portrait-name">${portrait.name}</div>`;
        if (portrait.ambiguous && portrait.alternatives && portrait.alternatives.length > 0) {
          const alts = portrait.alternatives.map(a => `${a.name} (${a.similarity}%)`).join(", ");
          nameDisplay = `<div class="portrait-name" title="Ambigu: ${alts}">${portrait.name}?</div>`;
        }
      }

      // Determiner le badge
      let badge = "";
      if (portrait.similarity) {
        if (portrait.ambiguous) {
          badge = `<div class="portrait-badge ambiguous" title="Match ambigu">?!</div>`;
        } else if (portrait.similarity >= 70) {
          badge = `<div class="portrait-badge good">\u2713</div>`;
        } else {
          badge = `<div class="portrait-badge unknown">?</div>`;
        }
      }

      slot.innerHTML = `
        <img src="${portrait.dataUrl}" alt="Portrait ${i + 1}">
        ${nameDisplay}
        ${badge}
      `;
      slot.classList.add("has-portrait");
      slot.classList.toggle("identified", portrait.name && portrait.similarity >= 70 && !portrait.ambiguous);
      slot.classList.toggle("ambiguous", portrait.ambiguous || false);
    } else {
      slot.innerHTML = `<div class="portrait-placeholder">${i + 1}</div>`;
      slot.classList.remove("has-portrait", "identified", "ambiguous");
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
        const stored = await storageGet("msfPortraits");
        const portraits = stored.msfPortraits || {};
        portraits[hash] = {
          name: portrait.name,
          charId: charId
        };
        await storageSet({ msfPortraits: portraits });
        console.log(`[Popup] Portrait sauvegardé: ${portrait.name} = ${hash}`);
      } catch (e) {
        console.error("[Popup] Erreur sauvegarde portrait:", e);
      }

      // Mettre à jour l'affichage
      updateWarPortraitsDisplay();

      // Sauvegarder les portraits mis à jour
      await storageSet({ msf_war_portraits: capturedWarPortraits });
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
          capturedWarPortraits[i].ambiguous = p.ambiguous || false;
          capturedWarPortraits[i].alternatives = p.alternatives || [];
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
            <span class="counter-conf">${confidenceToSymbols(c.confidence)}</span>
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
    const result = await storageGet("msf_barracks_calibration");
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
