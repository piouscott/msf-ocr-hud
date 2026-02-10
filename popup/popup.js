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
let playerRoster = new Set(); // Roster du joueur
let showOnlyAvailable = false; // Filtre pour afficher seulement les counters disponibles
let eventBonusCharacters = []; // Personnages avec bonus d'event War actif

/**
 * Charge le roster du joueur depuis le storage
 */
async function loadPlayerRoster() {
  try {
    const stored = await storageGet("msfPlayerRoster");
    if (stored.msfPlayerRoster && Array.isArray(stored.msfPlayerRoster)) {
      playerRoster = new Set(stored.msfPlayerRoster);
      console.log("[Popup] Roster chargé:", playerRoster.size, "personnages");
    }
  } catch (e) {
    console.error("[Popup] Erreur chargement roster:", e);
    playerRoster = new Set();
  }
}

/**
 * Extrait les personnages avec bonus War depuis les events actifs
 * Cherche les descriptions comme "Battle in War with Ursa Major"
 * NOTE: WAR (Guerre) != BLITZ (Choc) != RAID - modes distincts
 * Si event dit "War or Blitz", on affiche dans War ET dans Blitz (séparément)
 */
async function extractEventBonusCharacters() {
  eventBonusCharacters = [];

  try {
    // Récupérer les events depuis le cache
    const cached = await storageGet("msfEventsCache");
    if (!cached.msfEventsCache) return;

    const now = Date.now() / 1000;
    const activeEvents = cached.msfEventsCache.filter(e => e.endTime > now && e.startTime < now);

    // Charger characters-full.json pour le mapping nom -> id
    const charsUrl = ext.runtime.getURL("data/characters-full.json");
    const charsRes = await fetch(charsUrl);
    const charsData = await charsRes.json();

    // Créer un map des noms de personnages (en majuscules) vers leurs IDs
    const nameToId = {};
    Object.entries(charsData).forEach(([id, char]) => {
      if (char.name) {
        nameToId[char.name.toUpperCase()] = id;
      }
    });

    // Regex pour extraire les noms de personnages des descriptions d'events WAR uniquement
    // Ex: "Battle in War with Ursa Major at 5 Yellow Stars"
    // NOTE IMPORTANTE: WAR (Guerre) != BLITZ (Choc) != RAID
    // On capture les events qui mentionnent "War" (inclut "War or Blitz" car donne des points en War)
    // Mais on EXCLUT les events "Blitz" seul (sans War)
    const warOnlyPattern = /battle in war(?:\s+or\s+blitz)?\s+with\s+([a-z\s\-']+?)(?:\s+at\s+\d+|\s*$)/gi;

    activeEvents.forEach(event => {
      if (event.type !== "milestone" || !event.milestone?.scoring) return;

      const scoring = event.milestone.scoring;
      const allMethods = [
        ...(scoring.methods || []),
        ...(scoring.cappedScorings || []).flatMap(cs => cs.methods || [])
      ];

      allMethods.forEach(method => {
        if (!method.description) return;

        // Vérifier si c'est une condition War (exclut Blitz seul)
        let match;
        warOnlyPattern.lastIndex = 0;
        while ((match = warOnlyPattern.exec(method.description)) !== null) {
          const charName = match[1].trim().toUpperCase();
          const charId = nameToId[charName];

          if (charId && !eventBonusCharacters.find(c => c.charId === charId)) {
            eventBonusCharacters.push({
              charId: charId,
              charName: match[1].trim(),
              eventName: event.name,
              points: method.points,
              description: method.description
            });
          }
        }
      });
    });

    if (eventBonusCharacters.length > 0) {
      console.log("[Events] Personnages avec bonus War:", eventBonusCharacters.map(c => c.charName));
    }
  } catch (e) {
    console.error("[Events] Erreur extraction bonus characters:", e);
  }
}

/**
 * Vérifie si une équipe contient des personnages avec bonus d'event
 */
function getTeamEventBonus(teamId) {
  if (eventBonusCharacters.length === 0) return [];

  const team = teamsData.find(t => t.id === teamId);
  if (!team || !team.memberIds) return [];

  return eventBonusCharacters.filter(bonus =>
    team.memberIds.includes(bonus.charId)
  );
}

/**
 * Vérifie si le joueur possède tous les membres d'une équipe
 */
function canMakeTeam(teamId) {
  if (playerRoster.size === 0) return null; // Roster non chargé

  const team = teamsData.find(t => t.id === teamId);
  if (!team || !team.memberIds) return null;

  const hasAll = team.memberIds.every(charId => playerRoster.has(charId));
  const hasCount = team.memberIds.filter(charId => playerRoster.has(charId)).length;

  return {
    available: hasAll,
    hasCount: hasCount,
    totalCount: team.memberIds.length,
    missing: team.memberIds.filter(charId => !playerRoster.has(charId))
  };
}

/**
 * Génère le badge de disponibilité pour un counter
 */
function renderAvailabilityBadge(teamId) {
  const status = canMakeTeam(teamId);
  if (status === null) return "";

  if (status.available) {
    return `<span class="counter-available" title="Vous avez cette équipe">✓</span>`;
  } else if (status.hasCount >= status.totalCount - 1) {
    // Il manque 1 personnage
    return `<span class="counter-almost" title="Il manque: ${status.missing.join(', ')}">${status.hasCount}/${status.totalCount}</span>`;
  } else {
    return `<span class="counter-missing" title="Il manque: ${status.missing.join(', ')}">${status.hasCount}/${status.totalCount}</span>`;
  }
}

/**
 * Toggle le filtre roster et rafraîchit l'affichage
 */
function toggleRosterFilter() {
  showOnlyAvailable = !showOnlyAvailable;
  // Rafraîchir l'affichage des counters
  if (currentSlots.length > 0) {
    displayResults(currentSlots);
  }
}

// Exposer pour le onclick dans le HTML
window.toggleRosterFilter = toggleRosterFilter;

/**
 * Vérifie si un personnage est farmable (pas un summon, existe, a un lieu de farm)
 */
function isCharacterFarmable(charId) {
  // Vérifier le statut dans charactersData (doit être "playable")
  const charInfo = charactersData?.characters?.[charId];
  if (!charInfo) return false;
  if (charInfo.status && charInfo.status !== "playable") return false;

  // Vérifier s'il a un lieu de farm défini
  const farmInfo = farmingData?.characters?.[charId];
  if (!farmInfo || !farmInfo.locations || farmInfo.locations.length === 0) return false;

  return true;
}

/**
 * Analyse les personnages à farmer en priorité
 * Calcule l'impact de chaque personnage manquant (combien de counters il débloque)
 * Exclut: summons, personnages inconnus, personnages sans lieu de farm
 */
function analyzeFarmingPriorities() {
  if (playerRoster.size === 0) {
    return { error: "Roster non chargé. Récupérez votre roster via l'API." };
  }

  const charImpact = {}; // charId -> { unlocks: [], almostTeams: [] }

  // Parcourir toutes les équipes de counters
  Object.keys(countersData).forEach(defenseTeamId => {
    const counterList = countersData[defenseTeamId] || [];

    counterList.forEach(counter => {
      const counterTeamId = counter.team;
      const team = teamsData.find(t => t.id === counterTeamId);
      if (!team || !team.memberIds) return;

      // Calculer combien de membres manquent (seulement les farmables)
      const missing = team.memberIds.filter(charId =>
        !playerRoster.has(charId) && isCharacterFarmable(charId)
      );

      if (missing.length === 0) {
        // Équipe déjà complète ou membres manquants non farmables
        return;
      }

      if (missing.length <= 2) {
        // Équipe presque complète - chaque personnage manquant contribue
        missing.forEach(charId => {
          if (!charImpact[charId]) {
            charImpact[charId] = { unlocks: [], almostTeams: [] };
          }

          // Si c'est le seul manquant, il débloque ce counter
          if (missing.length === 1) {
            charImpact[charId].unlocks.push({
              counterTeam: team.name,
              defenseTeam: defenseTeamId,
              confidence: counter.confidence
            });
          } else {
            // Il contribue mais ne débloque pas seul
            charImpact[charId].almostTeams.push({
              counterTeam: team.name,
              missingWith: missing.filter(c => c !== charId)
            });
          }
        });
      }
    });
  });

  // Trier par impact (unlocks d'abord, puis almostTeams)
  const ranked = Object.entries(charImpact)
    .map(([charId, data]) => ({
      charId,
      unlockCount: data.unlocks.length,
      almostCount: data.almostTeams.length,
      unlocks: data.unlocks,
      almostTeams: data.almostTeams,
      score: data.unlocks.length * 3 + data.almostTeams.length // Score pondéré
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    priorities: ranked.slice(0, 15),
    totalAnalyzed: Object.keys(charImpact).length
  };
}

/**
 * Formate les counters pour Discord (markdown)
 */
function formatCountersForDiscord(teamName, counters, power = null) {
  let text = `**🎯 ${teamName}**`;
  if (power) {
    text += ` (${formatPower(power)})`;
  }
  text += `\n`;

  if (!counters || counters.length === 0) {
    text += `_Aucun counter défini_\n`;
    return text;
  }

  counters.slice(0, 5).forEach((c, idx) => {
    const conf = c.confidence >= 95 ? "▲▲▲" :
                 c.confidence >= 80 ? "▲▲" :
                 c.confidence >= 65 ? "▲" :
                 c.confidence >= 50 ? "⊜" : "▼";
    const status = canMakeTeam(c.teamId);
    const check = status?.available ? "✅" : "";
    text += `${idx + 1}. **${c.teamName}** ${conf} ${check}`;
    if (c.minPower) {
      text += ` _(${formatPower(c.minPower)}+)_`;
    }
    text += `\n`;
    if (c.notes) {
      text += `   _${c.notes}_\n`;
    }
  });

  return text;
}

/**
 * Copie le texte dans le presse-papier
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.error("[Clipboard] Erreur:", e);
    return false;
  }
}

/**
 * Exporte le résultat War vers Discord
 */
async function exportWarToDiscord() {
  if (!window.lastWarResult) {
    setStatus("Aucun résultat à exporter", "error");
    return;
  }

  const result = window.lastWarResult;
  let text = "";

  if (result.identified && result.team) {
    const teamName = result.team.variantName || result.team.name;
    text = formatCountersForDiscord(teamName, result.counters);
  } else {
    text = `**❓ Équipe non identifiée**\n`;
    if (result.characters) {
      text += `Personnages: ${result.characters.filter(n => n && n !== "?").join(", ")}\n`;
    }
  }

  text += `\n_Via MSF Counter Extension_`;

  const success = await copyToClipboard(text);
  if (success) {
    setStatus("📋 Copié pour Discord !", "success");
  } else {
    setStatus("Erreur copie", "error");
  }
}

/**
 * Exporte les counters d'un slot vers Discord
 */
async function exportSlotToDiscord(slotIndex) {
  if (slotIndex < 0 || slotIndex >= currentSlots.length) return;

  const slot = currentSlots[slotIndex];
  if (!slot.team?.name) {
    setStatus("Sélectionnez d'abord une équipe", "error");
    return;
  }

  const text = formatCountersForDiscord(slot.team.name, slot.counters, slot.power) +
               `\n_Via MSF Counter Extension_`;

  const success = await copyToClipboard(text);
  if (success) {
    setStatus("📋 Copié pour Discord !", "success");
  }
}

// Exposer pour les onclick
window.exportWarToDiscord = exportWarToDiscord;
window.exportSlotToDiscord = exportSlotToDiscord;

// ============================================
// War Stats Tracking
// ============================================

let warStats = {}; // { counterTeamId: { wins: 0, losses: 0, usages: [] } }

/**
 * Charge les stats de War depuis le storage
 */
async function loadWarStats() {
  try {
    const stored = await storageGet("msfWarStats");
    warStats = stored.msfWarStats || {};
    console.log("[WarStats] Chargé:", Object.keys(warStats).length, "équipes trackées");
  } catch (e) {
    console.error("[WarStats] Erreur chargement:", e);
    warStats = {};
  }
}

/**
 * Enregistre une utilisation de counter
 */
async function recordCounterUsage(counterTeamId, counterTeamName, defenseTeamName, won) {
  if (!warStats[counterTeamId]) {
    warStats[counterTeamId] = {
      teamName: counterTeamName,
      wins: 0,
      losses: 0,
      usages: []
    };
  }

  if (won) {
    warStats[counterTeamId].wins++;
  } else {
    warStats[counterTeamId].losses++;
  }

  // Garder les 10 dernières utilisations
  warStats[counterTeamId].usages.unshift({
    defense: defenseTeamName,
    won: won,
    date: Date.now()
  });
  if (warStats[counterTeamId].usages.length > 10) {
    warStats[counterTeamId].usages.pop();
  }

  await storageSet({ msfWarStats: warStats });
  console.log("[WarStats] Enregistré:", counterTeamName, won ? "WIN" : "LOSS");
}

/**
 * Obtient le taux de victoire pour un counter
 */
function getCounterWinRate(counterTeamId) {
  const stats = warStats[counterTeamId];
  if (!stats || (stats.wins + stats.losses) === 0) return null;

  const total = stats.wins + stats.losses;
  const rate = Math.round((stats.wins / total) * 100);

  return {
    wins: stats.wins,
    losses: stats.losses,
    total: total,
    rate: rate
  };
}

/**
 * Génère le badge de stats pour un counter
 */
function renderStatsBadge(counterTeamId) {
  const stats = getCounterWinRate(counterTeamId);
  if (!stats) return "";

  const color = stats.rate >= 70 ? "#51cf66" :
                stats.rate >= 50 ? "#ffd43b" : "#ff6b6b";

  return `<span class="counter-stats" style="color:${color}" title="${stats.wins}W/${stats.losses}L">${stats.rate}%</span>`;
}

/**
 * Affiche le panel de stats War
 */
function displayWarStats() {
  const sortedStats = Object.entries(warStats)
    .map(([teamId, data]) => ({
      teamId,
      ...data,
      rate: data.wins + data.losses > 0 ? (data.wins / (data.wins + data.losses)) * 100 : 0
    }))
    .filter(s => s.wins + s.losses > 0)
    .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));

  if (sortedStats.length === 0) {
    return `<div class="war-stats-empty">Aucune stat enregistrée. Marquez vos combats !</div>`;
  }

  let html = `<div class="war-stats-list">`;

  sortedStats.slice(0, 10).forEach(s => {
    const color = s.rate >= 70 ? "#51cf66" : s.rate >= 50 ? "#ffd43b" : "#ff6b6b";
    html += `
      <div class="war-stats-item">
        <span class="war-stats-name">${s.teamName}</span>
        <span class="war-stats-record">${s.wins}W / ${s.losses}L</span>
        <span class="war-stats-rate" style="color:${color}">${Math.round(s.rate)}%</span>
      </div>
    `;
  });

  html += `</div>`;
  return html;
}

// Charger les stats au démarrage
loadWarStats();

/**
 * Enregistre une utilisation et rafraîchit l'affichage
 */
async function recordAndRefresh(teamId, teamName, defenseName, won) {
  await recordCounterUsage(teamId, teamName, defenseName, won);
  setStatus(won ? "✓ Victoire enregistrée !" : "✗ Défaite enregistrée", won ? "success" : "");

  // Rafraîchir l'affichage
  if (window.lastWarResult) {
    displayWarResult(window.lastWarResult);
  }
}

// Exposer pour les onclick
window.recordCounterUsage = recordCounterUsage;
window.recordAndRefresh = recordAndRefresh;

/**
 * Affiche les recommandations de farming
 */
function displayFarmingAdvisor() {
  const result = analyzeFarmingPriorities();

  if (result.error) {
    return `<div class="farm-advisor-error">${result.error}</div>`;
  }

  if (result.priorities.length === 0) {
    return `<div class="farm-advisor-complete">Vous avez toutes les équipes de counter !</div>`;
  }

  let html = `<div class="farm-advisor">
    <div class="farm-advisor-header">🎯 Personnages à farmer en priorité</div>
    <div class="farm-advisor-subtitle">${result.priorities.length} personnages analysés</div>
    <div class="farm-advisor-list">
  `;

  result.priorities.forEach((char, idx) => {
    // Chercher le nom du personnage dans charactersData
    const charInfo = charactersData?.characters?.[char.charId] || { name: char.charId };

    html += `
      <div class="farm-priority-item">
        <div class="farm-priority-rank">#${idx + 1}</div>
        <div class="farm-priority-info">
          ${charInfo.portrait ? `<img src="${charInfo.portrait}" class="farm-priority-portrait" alt="">` : ''}
          <div class="farm-priority-details">
            <span class="farm-priority-name">${charInfo.name || char.charId}</span>
            <span class="farm-priority-impact">
              ${char.unlockCount > 0 ? `<span class="unlock-count">🔓 ${char.unlockCount} counters</span>` : ''}
              ${char.almostCount > 0 ? `<span class="almost-count">+${char.almostCount} partiels</span>` : ''}
            </span>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div></div>`;
  return html;
}

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
loadPlayerRoster();

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
// Bouton Raids - Milestones liés aux raids
// ============================================

const raidsPanel = document.getElementById("raids-panel");
const btnRaids = document.getElementById("btn-raids");
const btnCloseRaids = document.getElementById("btn-close-raids");
const raidsLoading = document.getElementById("raids-loading");
const raidsError = document.getElementById("raids-error");
const raidsList = document.getElementById("raids-list");

btnRaids.addEventListener("click", async () => {
  raidsPanel.classList.toggle("hidden");
  if (!raidsPanel.classList.contains("hidden")) {
    await loadRaids();
  }
});

btnCloseRaids.addEventListener("click", () => {
  raidsPanel.classList.add("hidden");
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

// ============================================
// Bouton Farm - Où farmer les personnages
// ============================================

const farmPanel = document.getElementById("farm-panel");
const btnFarm = document.getElementById("btn-farm");
const btnCloseFarm = document.getElementById("btn-close-farm");
const farmSearchInput = document.getElementById("farm-search-input");
const farmResults = document.getElementById("farm-results");

let farmingData = null;
let charactersData = null;
let currentFarmFilter = "all";

btnFarm.addEventListener("click", async () => {
  farmPanel.classList.toggle("hidden");

  if (!farmPanel.classList.contains("hidden")) {
    await loadFarmingData();
  }
});

btnCloseFarm.addEventListener("click", () => {
  farmPanel.classList.add("hidden");
});

async function loadFarmingData() {
  try {
    if (!farmingData) {
      const response = await fetch(ext.runtime.getURL("data/farming-locations.json"));
      farmingData = await response.json();
    }
    if (!charactersData) {
      const response = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await response.json();
    }
    renderFarmResults();
  } catch (e) {
    console.error("[Farm] Erreur chargement:", e);
    farmResults.innerHTML = '<div class="farm-no-results">Erreur de chargement des données</div>';
  }
}

function renderFarmResults() {
  const searchTerm = farmSearchInput.value.toLowerCase().trim();
  const filter = currentFarmFilter;

  let results = [];

  for (const [charId, charData] of Object.entries(farmingData.characters)) {
    // Get character info from characters-full.json
    const charInfo = charactersData.characters[charId] || { name: charId, portrait: null };

    // Filter by search term
    if (searchTerm && !charInfo.name.toLowerCase().includes(searchTerm)) {
      continue;
    }

    // Filter by location type
    let locations = charData.locations || [];
    if (filter !== "all") {
      locations = locations.filter(loc => loc.type === filter);
    }

    if (locations.length === 0 && filter !== "all") {
      continue;
    }

    results.push({
      id: charId,
      name: charInfo.name,
      portrait: charInfo.portrait,
      locations: charData.locations || []
    });
  }

  // Sort by name
  results.sort((a, b) => a.name.localeCompare(b.name));

  if (results.length === 0) {
    farmResults.innerHTML = '<div class="farm-no-results">Aucun personnage trouvé</div>';
    return;
  }

  // Si filtre campagne, regrouper par type de campagne
  if (filter === "campaign") {
    renderFarmByCampaign(results, searchTerm);
    return;
  }

  // Limit results pour les autres filtres
  if (!searchTerm) {
    results = results.slice(0, 50);
  }

  const html = results.map(char => `
    <div class="farm-char-item">
      <div class="farm-char-header">
        ${char.portrait ? `<img src="${char.portrait}" class="farm-char-portrait" alt="">` : '<div class="farm-char-portrait"></div>'}
        <span class="farm-char-name">${char.name}</span>
      </div>
      <div class="farm-locations">
        ${char.locations.map(loc => renderFarmLocation(loc)).join("")}
      </div>
    </div>
  `).join("");

  farmResults.innerHTML = html;
}

/**
 * Affiche les personnages groupés par campagne avec sections pliables
 */
function renderFarmByCampaign(results, searchTerm) {
  // Définir l'ordre des campagnes
  const campaignOrder = ["Heroes", "Villains", "Nexus", "Cosmic", "Mystic", "Doom"];
  const campaignNames = {
    "Heroes": "Heroes",
    "Villains": "Villains",
    "Nexus": "Nexus",
    "Cosmic": "Cosmic",
    "Mystic": "Mystic",
    "Doom": "Doom"
  };

  // Grouper par campagne
  const groups = {};
  for (const char of results) {
    const campaignLocs = char.locations.filter(loc => loc.type === "campaign" && loc.node);
    for (const loc of campaignLocs) {
      // Extraire le type de campagne du node (ex: "Heroes 6-9" -> "Heroes")
      const match = loc.node.match(/^(Heroes|Villains|Nexus|Cosmic|Mystic|Doom)/i);
      if (match) {
        const campaign = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        const normalizedCampaign = campaignOrder.find(c => c.toLowerCase() === campaign.toLowerCase()) || campaign;

        if (!groups[normalizedCampaign]) {
          groups[normalizedCampaign] = [];
        }
        groups[normalizedCampaign].push({
          ...char,
          node: loc.node
        });
      }
    }
  }

  // Générer le HTML avec sections pliables
  let html = "";
  for (const campaign of campaignOrder) {
    const chars = groups[campaign];
    if (!chars || chars.length === 0) continue;

    // Trier par node
    chars.sort((a, b) => {
      const nodeA = a.node.match(/(\d+)-(\d+)/);
      const nodeB = b.node.match(/(\d+)-(\d+)/);
      if (nodeA && nodeB) {
        const chapterA = parseInt(nodeA[1]);
        const chapterB = parseInt(nodeB[1]);
        if (chapterA !== chapterB) return chapterA - chapterB;
        return parseInt(nodeA[2]) - parseInt(nodeB[2]);
      }
      return a.node.localeCompare(b.node);
    });

    const isExpanded = searchTerm ? true : false; // Déplié si recherche active

    html += `
      <div class="farm-campaign-group">
        <div class="farm-campaign-header" data-campaign="${campaign}">
          <span class="farm-campaign-toggle">${isExpanded ? "▼" : "▶"}</span>
          <span class="farm-campaign-name">${campaignNames[campaign] || campaign}</span>
          <span class="farm-campaign-count">${chars.length} persos</span>
        </div>
        <div class="farm-campaign-chars ${isExpanded ? "show" : ""}">
          ${chars.map(char => `
            <div class="farm-char-compact">
              ${char.portrait ? `<img src="${char.portrait}" class="farm-char-portrait-sm" alt="">` : '<div class="farm-char-portrait-sm"></div>'}
              <span class="farm-char-name-sm">${char.name}</span>
              <span class="farm-char-node">${char.node}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (!html) {
    html = '<div class="farm-no-results">Aucun personnage en campagne trouvé</div>';
  }

  farmResults.innerHTML = html;

  // Ajouter les event listeners pour les headers de campagne
  farmResults.querySelectorAll(".farm-campaign-header").forEach(header => {
    header.addEventListener("click", () => {
      const chars = header.nextElementSibling;
      const toggle = header.querySelector(".farm-campaign-toggle");
      if (chars && chars.classList.contains("farm-campaign-chars")) {
        chars.classList.toggle("show");
        toggle.textContent = chars.classList.contains("show") ? "▼" : "▶";
      }
    });
  });
}

function renderFarmLocation(loc) {
  const icons = {
    campaign: "📍",
    blitz: "⚔️",
    arena: "🏟️",
    raid: "💀",
    war: "⚔️",
    milestone: "🎯",
    legendary: "⭐",
    crucible: "🔥",
    event: "📅",
    orb: "🔮",
    supplies: "🛒"
  };

  const typeNames = {
    campaign: "Campagne",
    blitz: "Blitz",
    arena: "Arène",
    raid: "Raid",
    war: "War",
    milestone: "Milestone",
    legendary: "Légendaire",
    crucible: "Crucible",
    event: "Event",
    orb: "Orbe",
    supplies: "Fournitures"
  };

  let detail = "";
  if (loc.node) detail = loc.node;
  else if (loc.orb) detail = loc.orb;
  else if (loc.event) detail = loc.event;
  else if (loc.note) detail = loc.note;
  else if (loc.requires) detail = `Requis: ${loc.requires.join(", ")}`;

  const cost = loc.cost ? `${loc.cost} 🪙` : "";

  return `
    <div class="farm-location ${loc.type}">
      <span class="farm-location-icon">${icons[loc.type] || "📦"}</span>
      <span class="farm-location-type">${typeNames[loc.type] || loc.type}</span>
      <span class="farm-location-detail">${detail}</span>
      ${cost ? `<span class="farm-location-cost">${cost}</span>` : ""}
    </div>
  `;
}

// Search input handler
farmSearchInput.addEventListener("input", () => {
  renderFarmResults();
});

// Filter buttons handler
document.querySelectorAll(".farm-filter").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".farm-filter").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFarmFilter = btn.dataset.filter;
    renderFarmResults();
  });
});

// Farm tabs handler
const farmTabSearch = document.getElementById("farm-tab-search");
const farmTabAdvisor = document.getElementById("farm-tab-advisor");
const farmSearchMode = document.getElementById("farm-search-mode");
const farmAdvisorMode = document.getElementById("farm-advisor-mode");
const farmAdvisorResults = document.getElementById("farm-advisor-results");

if (farmTabSearch && farmTabAdvisor) {
  farmTabSearch.addEventListener("click", () => {
    farmTabSearch.classList.add("active");
    farmTabAdvisor.classList.remove("active");
    farmSearchMode.classList.remove("hidden");
    farmAdvisorMode.classList.add("hidden");
  });

  farmTabAdvisor.addEventListener("click", async () => {
    farmTabAdvisor.classList.add("active");
    farmTabSearch.classList.remove("active");
    farmAdvisorMode.classList.remove("hidden");
    farmSearchMode.classList.add("hidden");

    // Afficher l'analyse
    farmAdvisorResults.innerHTML = '<div class="farm-advisor-loading">Analyse en cours...</div>';

    // S'assurer que les données sont chargées (teams, counters, roster, farming, characters)
    await loadTeamsAndCounters();
    await loadPlayerRoster();
    await loadFarmingData();

    farmAdvisorResults.innerHTML = displayFarmingAdvisor();
  });
}

async function loadEvents() {
  eventsLoading.classList.remove("hidden");
  eventsError.classList.add("hidden");
  eventsList.classList.add("hidden");
  warEventSection.classList.add("hidden");

  // Charger les alertes sauvegardées
  await loadEventAlerts();

  let isOffline = false;
  let events = [];

  try {
    // Utiliser le background script pour l'appel API (gestion du refresh token)
    const response = await ext.runtime.sendMessage({ type: "MSF_GET_EVENTS" });

    if (response.error) {
      throw new Error(response.error);
    }

    events = response.events || [];

    // Sauvegarder en cache pour le mode offline
    await storageSet({
      msfEventsCache: events,
      msfEventsCacheTime: Date.now()
    });

    // Extraire les personnages avec bonus War/Blitz
    await extractEventBonusCharacters();

  } catch (err) {
    console.log("[Events] Erreur API, tentative cache:", err.message);

    // Essayer de charger depuis le cache
    const cached = await storageGet(["msfEventsCache", "msfEventsCacheTime"]);

    if (cached.msfEventsCache && cached.msfEventsCache.length > 0) {
      events = cached.msfEventsCache;
      isOffline = true;
      console.log("[Events] Utilisation du cache (", events.length, "events)");
      // Extraire les personnages avec bonus War/Blitz depuis le cache
      await extractEventBonusCharacters();
    } else {
      eventsLoading.classList.add("hidden");
      eventsError.textContent = "Pas de connexion et aucun cache disponible";
      eventsError.classList.remove("hidden");
      return;
    }
  }

  const now = Date.now() / 1000;

  // Filtrer les événements actifs
  const activeEvents = events.filter(e => e.endTime > now && e.startTime < now);

  // Séparer par type
  const blitzEvents = activeEvents.filter(e => e.type === "blitz");
  // Milestones uniquement (les raids sont dans le panel Raids séparé)
  const milestoneEvents = activeEvents.filter(e =>
    e.type === "milestone" && e.milestone?.scoring
  );

  renderAllEvents({ blitz: blitzEvents, milestone: milestoneEvents });
  eventsLoading.classList.add("hidden");
  eventsList.classList.remove("hidden");

  // Afficher l'indicateur offline si nécessaire
  if (isOffline) {
    showOfflineIndicator();
  }

  // Toujours afficher les équipes War offensives (utiles pour la guerre)
  await loadWarTeamsForEvent();
}

/**
 * Affiche l'indicateur de mode hors ligne
 */
function showOfflineIndicator() {
  const indicator = document.getElementById("offline-indicator");
  if (indicator) {
    indicator.classList.remove("hidden");

    // Afficher le temps depuis le cache
    storageGet("msfEventsCacheTime").then(cached => {
      if (cached.msfEventsCacheTime) {
        const cacheTime = new Date(cached.msfEventsCacheTime);
        const ago = getTimeAgo(cacheTime);
        indicator.querySelector(".offline-time").textContent = `Cache: ${ago}`;
      }
    });
  }
}

/**
 * Charge les milestones liés aux raids
 */
async function loadRaids() {
  raidsLoading.classList.remove("hidden");
  raidsError.classList.add("hidden");
  raidsList.classList.add("hidden");

  let events = [];

  try {
    const response = await ext.runtime.sendMessage({ type: "MSF_GET_EVENTS" });

    if (response.error) {
      throw new Error(response.error);
    }

    events = response.events || [];

  } catch (err) {
    // Essayer le cache
    const cached = await storageGet("msfEventsCache");
    if (cached.msfEventsCache) {
      events = cached.msfEventsCache;
    } else {
      raidsLoading.classList.add("hidden");
      raidsError.textContent = err.message;
      raidsError.classList.remove("hidden");
      return;
    }
  }

  const now = Date.now() / 1000;
  const raidEvents = events.filter(e => e.type === "raid" && e.endTime > now && e.startTime < now);

  renderRaids(raidEvents);
  raidsLoading.classList.add("hidden");
  raidsList.classList.remove("hidden");
}

/**
 * Affiche les milestones raids avec traductions
 */
function renderRaids(raids) {
  if (raids.length === 0) {
    raidsList.innerHTML = '<div class="no-counters">Aucun milestone raid en cours</div>';
    return;
  }

  let html = '';

  raids.forEach(raid => {
    const timeLeft = formatTimeRemaining(raid.endTime);
    const translatedName = translateEventName(raid.name);
    const translatedSub = raid.subName ? translateEventDescription(raid.subName) : '';

    html += `
      <div class="raid-card">
        <div class="raid-header">
          <span class="raid-name">${translatedName}</span>
          <span class="raid-time">⏱ ${timeLeft}</span>
        </div>
        ${translatedSub ? `<div class="raid-subname">${translatedSub}</div>` : ''}
      </div>
    `;
  });

  raidsList.innerHTML = html;
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
 * Formate le temps restant en jours/heures/minutes
 */
function formatTimeRemaining(endTime) {
  const now = Date.now() / 1000;
  const remaining = endTime - now;

  if (remaining <= 0) return "Terminé";

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  if (days > 0) {
    return `${days}j ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

// Stockage des alertes d'événements
let eventAlerts = {};

/**
 * Charge les alertes sauvegardées
 */
async function loadEventAlerts() {
  try {
    const stored = await storageGet("msfEventAlerts");
    eventAlerts = stored.msfEventAlerts || {};
    // Nettoyer les alertes expirées
    const now = Date.now() / 1000;
    Object.keys(eventAlerts).forEach(eventId => {
      if (eventAlerts[eventId].endTime < now) {
        delete eventAlerts[eventId];
      }
    });
    await storageSet({ msfEventAlerts: eventAlerts });
  } catch (e) {
    console.error("[Alerts] Erreur chargement:", e);
    eventAlerts = {};
  }
}

/**
 * Toggle l'alerte pour un événement
 */
async function toggleEventAlert(eventId, eventName, endTime) {
  if (eventAlerts[eventId]) {
    delete eventAlerts[eventId];
  } else {
    eventAlerts[eventId] = {
      name: eventName,
      endTime: endTime,
      alertAt: endTime - 3600 // Alerter 1h avant la fin
    };
  }
  await storageSet({ msfEventAlerts: eventAlerts });
  updateAlertButtons();
}

/**
 * Met à jour l'affichage des boutons d'alerte
 */
function updateAlertButtons() {
  document.querySelectorAll(".event-alert-btn").forEach(btn => {
    const eventId = btn.dataset.eventId;
    const hasAlert = eventAlerts[eventId];
    btn.classList.toggle("active", !!hasAlert);
    btn.title = hasAlert ? "Alerte activée - Cliquer pour désactiver" : "Activer l'alerte (1h avant la fin)";
    btn.textContent = hasAlert ? "🔔" : "🔕";
  });
}

/**
 * Vérifie si des événements sont sur le point de se terminer
 */
function checkExpiringEvents() {
  const now = Date.now() / 1000;
  const expiring = [];

  Object.entries(eventAlerts).forEach(([eventId, alert]) => {
    const remaining = alert.endTime - now;
    // Alerter si moins d'1h restante
    if (remaining > 0 && remaining <= 3600) {
      expiring.push({
        id: eventId,
        name: alert.name,
        remaining: remaining
      });
    }
  });

  return expiring;
}

/**
 * Affiche les événements qui expirent bientôt
 */
function showExpiringEventsNotice(expiring) {
  if (expiring.length === 0) return;

  const notice = document.getElementById("expiring-notice");
  if (!notice) return;

  const html = expiring.map(e => {
    const mins = Math.floor(e.remaining / 60);
    return `<div class="expiring-event">⚠️ ${e.name} termine dans ${mins} min</div>`;
  }).join("");

  notice.innerHTML = html;
  notice.classList.remove("hidden");
}

/**
 * Génère le HTML des infos d'événement (temps restant, type, sous-titre)
 */
function renderEventInfo(event) {
  const timeLeft = formatTimeRemaining(event.endTime);
  const remaining = event.endTime - (Date.now() / 1000);
  const isUrgent = remaining > 0 && remaining <= 3600; // Moins d'1h

  // Détecter le type Solo/Series depuis milestone.typeName ou milestone.type
  let eventMode = "Solo";
  let isSeries = false;
  if (event.milestone) {
    const typeName = event.milestone.typeName || event.milestone.type || "";
    isSeries = typeName.toLowerCase().includes("series") || typeName.toLowerCase().includes("série");
    eventMode = typeName || "Solo";
  }

  // Sous-titre (ex: "Spend Campaign Energy")
  const subName = event.subName ? `<span class="event-subname">${event.subName}</span>` : "";

  // Bouton d'alerte
  const hasAlert = eventAlerts[event.id];
  const alertBtn = `<button class="event-alert-btn ${hasAlert ? 'active' : ''}"
    data-event-id="${event.id}"
    data-event-name="${event.name}"
    data-end-time="${event.endTime}"
    title="${hasAlert ? 'Alerte activée' : 'Activer l\'alerte'}">
    ${hasAlert ? '🔔' : '🔕'}
  </button>`;

  return `
    <div class="event-info">
      <span class="event-time ${isUrgent ? 'urgent' : ''}">⏱ ${timeLeft}</span>
      <span class="event-mode ${isSeries ? 'series' : 'solo'}">${eventMode}</span>
      ${alertBtn}
    </div>
    ${subName}
  `;
}

// Stockage des events milestones pour le calculateur
let currentMilestoneEvents = [];

/**
 * Affiche tous les types d'événements avec accordéons
 */
function renderAllEvents({ blitz, milestone }) {
  currentMilestoneEvents = milestone; // Sauvegarder pour le calculateur
  let html = "";

  // Blitz avec requirements (pour les counters inverses!)
  if (blitz.length > 0) {
    html += `
      <div class="events-accordion">
        <div class="events-accordion-header" data-section="blitz">
          <span class="events-accordion-toggle">▼</span>
          <span class="events-accordion-title">⚔️ Blitz</span>
          <span class="events-accordion-count">${blitz.length}</span>
        </div>
        <div class="events-accordion-content show" id="events-section-blitz">
    `;
    blitz.forEach(event => {
      const requirements = event.blitz?.requirements;
      const filters = requirements?.anyCharacterFilters || [];

      html += `
        <div class="event-card blitz">
          <div class="event-header">
            <span class="event-name">${translateEventName(event.name)}</span>
            <span class="event-type">Blitz</span>
          </div>
          ${renderEventInfo(event)}
          ${filters.length > 0 ? `
            <div class="event-filters">
              ${filters.map(f => `<span class="filter-tag">${f.filterName || f.filterType}</span>`).join("")}
            </div>
          ` : ""}
        </div>
      `;
    });
    html += `</div></div>`;
  }

  // Milestones avec scoring (inclut aussi les events de type "raid" qui sont des milestones)
  if (milestone.length > 0) {
    html += `
      <div class="events-accordion">
        <div class="events-accordion-header" data-section="milestone">
          <span class="events-accordion-toggle">▼</span>
          <span class="events-accordion-title">🎯 Milestones</span>
          <span class="events-accordion-count">${milestone.length}</span>
        </div>
        <div class="events-accordion-content show" id="events-section-milestone">
    `;
    milestone.forEach((event, idx) => {
      const scoring = event.milestone?.scoring;
      const rows = [];

      if (scoring?.methods) {
        scoring.methods.forEach(m => {
          rows.push({ desc: translateEventDescription(m.description), points: m.points, cap: null });
        });
      }
      if (scoring?.cappedScorings) {
        scoring.cappedScorings.forEach(cs => {
          cs.methods.forEach(m => {
            rows.push({ desc: translateEventDescription(m.description), points: m.points, cap: cs.cap });
          });
        });
      }

      // Générer les récompenses de paliers et le calculateur
      const tierRewardsHtml = renderMilestoneTiers(event);
      const calcHtml = renderPointsCalculator(event, idx);
      const hasTiers = event.milestone?.tiers && event.milestone.tiers.length > 0;
      const tierCount = event.milestone?.tiers?.length || 0;
      const hasCalc = rows.length > 0;

      // Déterminer le type à afficher
      const typeLabel = event.milestone?.typeName || "Milestone";

      html += `
        <div class="event-card milestone" data-event-idx="${idx}">
          <div class="event-header">
            <span class="event-name">${translateEventName(event.name)}</span>
            <span class="event-type">${typeLabel}</span>
          </div>
          ${event.subName ? `<div class="event-subname">${translateEventName(event.subName)}</div>` : ''}
          ${renderEventInfo(event)}
          <div class="event-actions">
            ${rows.length > 0 ? `
              <button class="event-toggle" data-event-idx="${idx}">
                ${rows.length} conditions ▼
              </button>
            ` : ""}
            ${hasCalc ? `
              <button class="calc-toggle" data-calc-idx="${idx}">
                🧮 Calculer ▼
              </button>
            ` : ""}
            ${hasTiers ? `
              <button class="tier-toggle" data-tier-idx="${idx}">
                🎁 Paliers ▼
              </button>
            ` : ""}
          </div>
          ${rows.length > 0 ? `
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
          ${hasCalc ? `
            <div class="points-calc-section" id="points-calc-${idx}">
              ${calcHtml}
            </div>
          ` : ""}
          ${hasTiers ? `
            <div class="tier-rewards-section" id="tier-rewards-${idx}">
              <div class="tier-header">Récompenses (${tierCount} paliers)</div>
              ${tierRewardsHtml}
            </div>
          ` : ""}
        </div>
      `;
    });
    html += `</div></div>`;
  }

  if (!html) {
    html = '<div class="no-counters">Aucun événement actif</div>';
  }

  eventsList.innerHTML = html;

  // Event delegation pour les accordéons de section
  eventsList.querySelectorAll(".events-accordion-header").forEach(header => {
    header.addEventListener("click", () => {
      const section = header.dataset.section;
      const content = document.getElementById(`events-section-${section}`);
      const toggle = header.querySelector(".events-accordion-toggle");
      if (content) {
        content.classList.toggle("show");
        toggle.textContent = content.classList.contains("show") ? "▼" : "▶";
      }
    });
  });

  // Ajouter les event listeners pour les boutons toggle des milestones (CSP-compliant)
  eventsList.querySelectorAll(".event-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.eventIdx;
      toggleEventDetails(idx);
    });
  });

  // Ajouter les event listeners pour les boutons toggle des paliers
  eventsList.querySelectorAll(".tier-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.tierIdx;
      toggleTierRewards(idx);
    });
  });

  // Ajouter les event listeners pour les boutons toggle du calculateur
  eventsList.querySelectorAll(".calc-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.calcIdx;
      togglePointsCalc(idx);
    });
  });

  // Ajouter les event listeners pour les inputs du calculateur
  eventsList.querySelectorAll(".calc-qty").forEach(input => {
    input.addEventListener("input", () => {
      // Trouver l'index de l'event
      const calcSection = input.closest(".points-calc-section");
      if (calcSection) {
        const idx = calcSection.id.replace("points-calc-", "");
        const event = currentMilestoneEvents[parseInt(idx)];
        if (event) {
          updatePointsCalculation(idx, event);
        }
      }
    });
  });

  // Ajouter les event listeners pour les boutons d'alerte
  eventsList.querySelectorAll(".event-alert-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const eventId = btn.dataset.eventId;
      const eventName = btn.dataset.eventName;
      const endTime = parseFloat(btn.dataset.endTime);
      await toggleEventAlert(eventId, eventName, endTime);
    });
  });

  // Vérifier les événements qui expirent bientôt
  const expiring = checkExpiringEvents();
  if (expiring.length > 0) {
    showExpiringEventsNotice(expiring);
  }
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

/**
 * Affiche/masque les récompenses des paliers
 */
function toggleTierRewards(idx) {
  const rewards = document.getElementById(`tier-rewards-${idx}`);
  if (rewards) {
    rewards.classList.toggle("show");
    const btn = document.querySelector(`.tier-toggle[data-tier-idx="${idx}"]`);
    if (btn) {
      const isOpen = rewards.classList.contains("show");
      btn.innerHTML = isOpen ? `🎁 Masquer ▲` : `🎁 Paliers ▼`;
    }
  }
}

/**
 * Affiche/masque le calculateur de points
 */
function togglePointsCalc(idx) {
  const calc = document.getElementById(`points-calc-${idx}`);
  if (calc) {
    calc.classList.toggle("show");
    const btn = document.querySelector(`.calc-toggle[data-calc-idx="${idx}"]`);
    if (btn) {
      const isOpen = calc.classList.contains("show");
      btn.innerHTML = isOpen ? `🧮 Masquer ▲` : `🧮 Calculer ▼`;
    }
  }
}

/**
 * Génère le HTML du calculateur de points pour un milestone event
 */
function renderPointsCalculator(event, idx) {
  if (!event.milestone?.scoring) return "";

  const scoring = event.milestone.scoring;
  const rows = [];

  if (scoring.methods) {
    scoring.methods.forEach((m, i) => {
      rows.push({ desc: translateEventDescription(m.description), points: m.points, cap: null, id: `calc-${idx}-${i}` });
    });
  }
  if (scoring.cappedScorings) {
    scoring.cappedScorings.forEach((cs, ci) => {
      cs.methods.forEach((m, mi) => {
        rows.push({ desc: translateEventDescription(m.description), points: m.points, cap: cs.cap, id: `calc-${idx}-cap-${ci}-${mi}` });
      });
    });
  }

  if (rows.length === 0) return "";

  // Générer la liste des paliers si disponible
  const tiers = event.milestone?.tiers || [];
  let tiersHtml = "";
  if (tiers.length > 0) {
    // Afficher les 5 premiers paliers + dernier palier si plus de 6
    const displayTiers = tiers.length <= 6 ? tiers : [...tiers.slice(0, 5), tiers[tiers.length - 1]];
    tiersHtml = `
      <div class="calc-tiers-breakdown" id="calc-tiers-${idx}">
        <div class="calc-tiers-header">Objectifs par palier</div>
        ${displayTiers.map((tier, i) => {
          const tierNum = tiers.length <= 6 ? i + 1 : (i < 5 ? i + 1 : tiers.length);
          const showDots = tiers.length > 6 && i === 5;
          return `
            ${showDots ? '<div class="calc-tier-dots">...</div>' : ''}
            <div class="calc-tier-row" data-tier="${tierNum}" data-score="${tier.endScore}">
              <span class="calc-tier-num">Palier ${tierNum}</span>
              <span class="calc-tier-target">${formatNumber(tier.endScore)} pts</span>
              <span class="calc-tier-status" id="calc-tier-status-${idx}-${tierNum}">—</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  let html = `
    <div class="points-calc">
      <div class="calc-header">Calculateur de points</div>
      <div class="calc-rows">
  `;

  rows.forEach(r => {
    html += `
      <div class="calc-row" data-points="${r.points}" data-cap="${r.cap || ''}">
        <span class="calc-action">${r.desc}</span>
        <div class="calc-inputs">
          <input type="number" class="calc-qty" id="${r.id}" min="0" value="0" placeholder="Qté">
          <span class="calc-pts-per">× ${formatNumber(r.points)}</span>
          ${r.cap ? `<span class="calc-cap-info">(max ${formatNumber(r.cap)})</span>` : ""}
        </div>
      </div>
    `;
  });

  html += `
      </div>
      <div class="calc-result">
        <span class="calc-total-label">Total estimé:</span>
        <span class="calc-total-pts" id="calc-total-${idx}">0</span>
        <span class="calc-tier-result" id="calc-tier-${idx}"></span>
      </div>
      ${tiersHtml}
    </div>
  `;

  return html;
}

/**
 * Met à jour le calcul des points pour un event
 */
function updatePointsCalculation(idx, event) {
  const calcSection = document.querySelector(`#points-calc-${idx}`);
  if (!calcSection) return;

  const inputs = calcSection.querySelectorAll(".calc-qty");
  let total = 0;

  inputs.forEach(input => {
    const row = input.closest(".calc-row");
    const points = parseInt(row.dataset.points) || 0;
    const cap = row.dataset.cap ? parseInt(row.dataset.cap) : null;
    const qty = parseInt(input.value) || 0;

    let earned = qty * points;
    if (cap !== null && earned > cap) {
      earned = cap;
    }
    total += earned;
  });

  const totalEl = document.getElementById(`calc-total-${idx}`);
  const tierEl = document.getElementById(`calc-tier-${idx}`);

  if (totalEl) {
    totalEl.textContent = formatNumber(total);
    totalEl.classList.toggle("has-points", total > 0);
  }

  // Calculer le palier atteint et mettre à jour l'affichage
  if (event.milestone?.tiers) {
    const tiers = event.milestone.tiers;
    let reachedTier = 0;
    let nextTierIdx = 0;

    for (let i = 0; i < tiers.length; i++) {
      if (total >= tiers[i].endScore) {
        reachedTier = i + 1;
        nextTierIdx = i + 1;
      }
    }

    // Mise à jour du résumé
    if (tierEl) {
      if (reachedTier > 0) {
        if (reachedTier === tiers.length) {
          tierEl.textContent = `✓ Tous les paliers atteints !`;
          tierEl.className = "calc-tier-result reached";
        } else {
          const nextTier = tiers[nextTierIdx];
          const remaining = nextTier.endScore - total;
          tierEl.textContent = `Palier ${reachedTier} ✓ | ${formatNumber(remaining)} pts → Palier ${reachedTier + 1}`;
          tierEl.className = "calc-tier-result reached";
        }
      } else if (tiers.length > 0) {
        const nextTier = tiers[0].endScore;
        tierEl.textContent = `${formatNumber(nextTier - total)} pts → Palier 1`;
        tierEl.className = "calc-tier-result pending";
      } else {
        tierEl.textContent = "";
      }
    }

    // Mise à jour de chaque ligne de palier
    const displayTierNums = tiers.length <= 6
      ? tiers.map((_, i) => i + 1)
      : [1, 2, 3, 4, 5, tiers.length];

    displayTierNums.forEach(tierNum => {
      const statusEl = document.getElementById(`calc-tier-status-${idx}-${tierNum}`);
      if (!statusEl) return;

      const tier = tiers[tierNum - 1];
      if (!tier) return;

      if (total >= tier.endScore) {
        statusEl.textContent = "✓";
        statusEl.className = "calc-tier-status reached";
      } else {
        const remaining = tier.endScore - total;
        statusEl.textContent = `-${formatNumber(remaining)}`;
        statusEl.className = "calc-tier-status pending";
      }
    });
  }
}

/**
 * Génère le HTML des récompenses de paliers pour un milestone event
 */
function renderMilestoneTiers(event) {
  if (!event.milestone?.tiers || event.milestone.tiers.length === 0) {
    return "";
  }

  const tiers = event.milestone.tiers;

  // Mapper les itemId vers des noms/icônes lisibles
  const itemNames = {
    // Ressources communes
    "core": "Cores",
    "gold": "Or",
    "trainingModules": "Modules",
    "catalyst_orange": "Catalyseurs Orange",
    "catalyst_purple": "Catalyseurs Violet",
    "ability_purple": "T3 Ability",
    "ability_orange": "T4 Ability",
    "ability_teal": "T5 Ability",
    "gear_teal": "Gear Teal",
    "gear_orange": "Gear Orange",
    "ionPiece": "Ions",
    "blitz_credits": "Crédits Blitz",
    "arena_credits": "Crédits Arena",
    "raid_credits": "Crédits Raid",
    "war_credits": "Crédits War",
    // Orbes
    "premiumOrb": "Orbe Premium",
    "basicOrb": "Orbe Basic",
    "blitzOrb": "Orbe Blitz",
    "goldOrb": "Orbe Or",
    "trainingOrb": "Orbe Training"
  };

  const itemIcons = {
    "core": "💎",
    "gold": "🪙",
    "trainingModules": "📦",
    "catalyst_orange": "🟠",
    "catalyst_purple": "🟣",
    "ability_purple": "📗",
    "ability_orange": "📙",
    "ability_teal": "📘",
    "gear_teal": "⚙️",
    "gear_orange": "⚙️",
    "ionPiece": "⚡",
    "blitz_credits": "🎫",
    "arena_credits": "🏟️",
    "raid_credits": "💀",
    "war_credits": "⚔️",
    "premiumOrb": "🔮",
    "basicOrb": "🔵",
    "blitzOrb": "🟠",
    "goldOrb": "🟡",
    "trainingOrb": "📦"
  };

  // Afficher seulement quelques paliers clés (premier, milieu, dernier)
  const keyTiers = [];
  if (tiers.length <= 5) {
    keyTiers.push(...tiers.map((t, i) => ({ ...t, tierNum: i + 1 })));
  } else {
    // Premier, 25%, 50%, 75%, dernier
    keyTiers.push({ ...tiers[0], tierNum: 1 });
    keyTiers.push({ ...tiers[Math.floor(tiers.length * 0.25)], tierNum: Math.floor(tiers.length * 0.25) + 1 });
    keyTiers.push({ ...tiers[Math.floor(tiers.length * 0.5)], tierNum: Math.floor(tiers.length * 0.5) + 1 });
    keyTiers.push({ ...tiers[Math.floor(tiers.length * 0.75)], tierNum: Math.floor(tiers.length * 0.75) + 1 });
    keyTiers.push({ ...tiers[tiers.length - 1], tierNum: tiers.length });
  }

  let html = `<div class="tier-rewards-list">`;

  keyTiers.forEach(tier => {
    const rewards = tier.rewards || [];
    const rewardItems = rewards.map(r => {
      const name = itemNames[r.itemId] || r.itemId;
      const icon = itemIcons[r.itemId] || "📦";
      const qty = r.quantity + (r.bonusQuantity || 0);
      return `<span class="tier-reward-item" title="${name}">${icon} ${formatNumber(qty)}</span>`;
    }).join("");

    html += `
      <div class="tier-row">
        <span class="tier-num">Palier ${tier.tierNum}</span>
        <span class="tier-score">${formatNumber(tier.endScore)} pts</span>
        <div class="tier-rewards">${rewardItems}</div>
      </div>
    `;
  });

  html += `</div>`;
  return html;
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return n.toString();
}

/**
 * Traductions des noms d'événements confus
 */
const EVENT_NAME_TRANSLATIONS = {
  // Orbes
  "Echo Orb": "Orbe Echo (récompenses spéciales)",
  "Premium Orb": "Orbe Premium",
  "Basic Orb": "Orbe Basique",
  "Blitz Orb": "Orbe Blitz",
  "Gold Orb": "Orbe Or",
  "Training Orb": "Orbe Entrainement",
  "Mega Orb": "Méga Orbe",
  "Ultimus Orb": "Orbe Ultimus",
  "Red Star Orb": "Orbe Étoile Rouge",

  // Raids - Ces milestones donnent des points quand vous jouez en Raid
  "Greek Raids": "🏛️ Raids Grecs",
  "Annihilation Raids": "☠️ Raids Annihilation",
  "Ultimus Raids": "⚡ Raids Ultimus",
  "Doom Raids": "💀 Raids Doom",
  "Incursion Raids": "🔥 Raids Incursion",
  "Cosmic Crucible": "Creuset Cosmique",

  // Événements
  "Battle in War": "Combat en Guerre",
  "War Season": "Saison de Guerre",
  "Raid Season": "Saison de Raid"
};

/**
 * Traductions des descriptions d'événements
 */
const EVENT_DESC_TRANSLATIONS = {
  "Win War battles": "Victoires en Guerre",
  "Win Alliance War attacks": "Victoires attaque en Guerre",
  "Complete Raid nodes": "Noeuds de Raid complétés",
  "Complete raid nodes": "Noeuds de Raid complétés",
  "Earn Ability Materials": "Gagner des Matériaux de Capacité",
  "Earn Gear up to Tier 20": "Gagner du Gear (jusqu'au Tier 20)",
  "Earn Crimson Gear": "Gagner du Gear Crimson",
  "Earn Gold": "Gagner de l'Or",
  "Earn Training Modules": "Gagner des Modules d'Entrainement",
  "Complete Blitz battles": "Combats Blitz complétés",
  "Collect character shards": "Collecter des fragments de personnage",
  "Open Orbs": "Ouvrir des Orbes"
};

/**
 * Traduit un nom d'événement
 */
function translateEventName(name) {
  if (!name) return "";
  // Chercher une traduction exacte
  if (EVENT_NAME_TRANSLATIONS[name]) {
    return EVENT_NAME_TRANSLATIONS[name];
  }
  // Chercher une traduction partielle (contient le mot)
  for (const [eng, fr] of Object.entries(EVENT_NAME_TRANSLATIONS)) {
    if (name.toLowerCase().includes(eng.toLowerCase())) {
      return name.replace(new RegExp(eng, 'i'), fr);
    }
  }
  return name;
}

/**
 * Traduit une description d'événement
 */
function translateEventDescription(desc) {
  if (!desc) return "";
  // Chercher une traduction exacte
  if (EVENT_DESC_TRANSLATIONS[desc]) {
    return EVENT_DESC_TRANSLATIONS[desc];
  }
  // Chercher une traduction partielle
  for (const [eng, fr] of Object.entries(EVENT_DESC_TRANSLATIONS)) {
    if (desc.toLowerCase().includes(eng.toLowerCase())) {
      return desc.replace(new RegExp(eng, 'i'), fr);
    }
  }
  return desc;
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

  // Filtrer si nécessaire
  let displayCounters = counters;
  if (showOnlyAvailable && playerRoster.size > 0) {
    displayCounters = counters.filter(c => {
      const status = canMakeTeam(c.teamId);
      return status && status.available;
    });
  }

  // Trier par disponibilité (disponibles en premier)
  displayCounters = [...displayCounters].sort((a, b) => {
    const statusA = canMakeTeam(a.teamId);
    const statusB = canMakeTeam(b.teamId);
    const availA = statusA?.available ? 1 : 0;
    const availB = statusB?.available ? 1 : 0;
    if (availA !== availB) return availB - availA;
    return b.confidence - a.confidence;
  });

  if (displayCounters.length === 0) {
    return '<div class="counters no-counters"><span class="no-counters-text">Aucun counter disponible avec votre roster</span></div>';
  }

  const hasRoster = playerRoster.size > 0;

  return `
    <div class="counters">
      <div class="counters-header">
        <span class="counters-title">Counters:</span>
        ${hasRoster ? `
          <button class="roster-filter-btn ${showOnlyAvailable ? 'active' : ''}" onclick="toggleRosterFilter()">
            ${showOnlyAvailable ? '✓ Je peux' : 'Tous'}
          </button>
        ` : ''}
      </div>
      ${displayCounters.slice(0, 5).map(c => {
        const status = canMakeTeam(c.teamId);
        const isAvailable = status?.available;
        return `
          <div class="counter-item ${isAvailable ? 'available' : ''}">
            <span class="counter-name">${c.teamName}</span>
            ${hasRoster ? renderAvailabilityBadge(c.teamId) : ''}
            <span class="counter-confidence">${confidenceToSymbols(c.confidence)}</span>
            ${c.minPower ? `<span class="counter-power">${formatPower(c.minPower)}+</span>` : ""}
          </div>
        `;
      }).join("")}
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
  window.lastWarResult = result; // Sauvegarder pour le toggle filter
  let html = "";

  if (result.identified && result.team) {
    // Utiliser variantName si disponible, sinon name
    const teamDisplayName = result.team.variantName || result.team.name;
    html += `<div class="war-result-header">
      <div class="war-team-identified">Equipe: ${teamDisplayName}</div>
      <button class="discord-export-btn" onclick="exportWarToDiscord()" title="Copier pour Discord">📋 Discord</button>
    </div>`;

    if (result.matchConfidence) {
      html += `<div style="font-size:11px;color:#888;margin-bottom:8px;">Confiance: ${result.matchConfidence}%</div>`;
    }

    if (result.counters && result.counters.length > 0) {
      // Filtrer et trier par disponibilité
      let displayCounters = result.counters;
      if (showOnlyAvailable && playerRoster.size > 0) {
        displayCounters = displayCounters.filter(c => {
          const status = canMakeTeam(c.teamId);
          return status && status.available;
        });
      }

      // Trier par disponibilité (disponibles en premier)
      displayCounters = [...displayCounters].sort((a, b) => {
        const statusA = canMakeTeam(a.teamId);
        const statusB = canMakeTeam(b.teamId);
        const availA = statusA?.available ? 1 : 0;
        const availB = statusB?.available ? 1 : 0;
        if (availA !== availB) return availB - availA;
        return b.confidence - a.confidence;
      });

      const hasRoster = playerRoster.size > 0;

      html += `<div class="counters-header">
        <span class="counters-title">Counters recommandes:</span>
        ${hasRoster ? `
          <button class="roster-filter-btn ${showOnlyAvailable ? 'active' : ''}" onclick="toggleRosterFilter(); displayWarResult(window.lastWarResult);">
            ${showOnlyAvailable ? '✓ Je peux' : 'Tous'}
          </button>
        ` : ''}
      </div>`;
      html += `<div class="war-counters-list">`;

      if (displayCounters.length === 0) {
        html += `<div class="no-counters">Aucun counter disponible avec votre roster</div>`;
      } else {
        const defenseName = result.team?.variantName || result.team?.name || "Équipe";
        displayCounters.slice(0, 5).forEach(c => {
          const status = canMakeTeam(c.teamId);
          const isAvailable = status?.available;
          const eventBonuses = getTeamEventBonus(c.teamId);
          const hasEventBonus = eventBonuses.length > 0;

          // Générer le badge event bonus
          let eventBonusHtml = '';
          if (hasEventBonus) {
            const bonusChars = eventBonuses.map(b => b.charName).join(', ');
            const bonusPoints = eventBonuses.reduce((sum, b) => sum + (b.points || 0), 0);
            eventBonusHtml = `<span class="event-bonus-badge" title="Event actif: ${bonusChars} (+${formatNumber(bonusPoints)} pts)">🎯 Event</span>`;
          }

          html += `
            <div class="war-counter-item ${isAvailable ? 'available' : ''} ${hasEventBonus ? 'has-event-bonus' : ''}">
              <div class="war-counter-header">
                <span class="war-counter-name">${c.teamName}</span>
                <div class="war-counter-meta">
                  ${eventBonusHtml}
                  ${renderStatsBadge(c.teamId)}
                  ${hasRoster ? renderAvailabilityBadge(c.teamId) : ''}
                  <span class="war-counter-confidence">${confidenceToSymbols(c.confidence)}</span>
                  ${c.minPower ? `<span class="war-counter-power">${formatPower(c.minPower)}+</span>` : ""}
                </div>
              </div>
              ${hasEventBonus ? `<div class="event-bonus-detail">🎯 Bonus: ${eventBonuses.map(b => `${b.charName} (+${formatNumber(b.points)} pts)`).join(', ')}</div>` : ''}
              <div class="war-counter-actions">
                ${c.notes ? `<span class="war-counter-notes">${c.notes}</span>` : '<span></span>'}
                <div class="war-record-btns">
                  <button class="war-record-btn win" onclick="recordAndRefresh('${c.teamId}', '${c.teamName.replace(/'/g, "\\'")}', '${defenseName.replace(/'/g, "\\'")}', true)" title="Victoire">✓</button>
                  <button class="war-record-btn loss" onclick="recordAndRefresh('${c.teamId}', '${c.teamName.replace(/'/g, "\\'")}', '${defenseName.replace(/'/g, "\\'")}', false)" title="Défaite">✗</button>
                </div>
              </div>
            </div>
          `;
        });
      }

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

const tabStats = document.getElementById("tab-stats");
const warStatsMode = document.getElementById("war-stats-mode");
const warStatsContent = document.getElementById("war-stats-content");
const warPowerSection = document.getElementById("war-power-section");
const btnClearStats = document.getElementById("btn-clear-stats");

tabPortrait.addEventListener("click", () => {
  tabPortrait.classList.add("active");
  tabManual.classList.remove("active");
  tabStats.classList.remove("active");
  warPortraitMode.classList.remove("hidden");
  warManualMode.classList.add("hidden");
  warStatsMode.classList.add("hidden");
  warPowerSection.classList.remove("hidden");
  warResult.classList.remove("hidden");
});

tabManual.addEventListener("click", () => {
  tabManual.classList.add("active");
  tabPortrait.classList.remove("active");
  tabStats.classList.remove("active");
  warManualMode.classList.remove("hidden");
  warPortraitMode.classList.add("hidden");
  warStatsMode.classList.add("hidden");
  warPowerSection.classList.remove("hidden");
  warResult.classList.remove("hidden");
});

tabStats.addEventListener("click", async () => {
  tabStats.classList.add("active");
  tabPortrait.classList.remove("active");
  tabManual.classList.remove("active");
  warStatsMode.classList.remove("hidden");
  warPortraitMode.classList.add("hidden");
  warManualMode.classList.add("hidden");
  warPowerSection.classList.add("hidden");
  warResult.classList.add("hidden");

  // Afficher les stats
  await loadWarStats();
  warStatsContent.innerHTML = displayWarStats();
});

btnClearStats.addEventListener("click", async () => {
  if (!confirm("Effacer toutes les statistiques de War ?")) return;

  warStats = {};
  await storageSet({ msfWarStats: {} });
  warStatsContent.innerHTML = displayWarStats();
  setStatus("Statistiques effacées", "success");
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
