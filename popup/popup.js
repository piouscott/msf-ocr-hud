const ext = typeof browser !== "undefined" ? browser : chrome;

// Détecter si on est en mode fenêtré (pas dans le popup natif de l'extension)
(async function detectWindowMode() {
  try {
    const currentWindow = await ext.windows.getCurrent();
    // Si la fenêtre est de type "popup" créée par windows.create, on est en mode fenêtré
    // Le popup natif de l'extension n'a pas de type "popup" accessible
    if (currentWindow && currentWindow.type === "popup") {
      document.body.classList.add("windowed");
      // Cacher le bouton Fenêtre puisqu'on est déjà en fenêtre
      const btnDetach = document.getElementById("btn-detach");
      if (btnDetach) btnDetach.style.display = "none";
    }
  } catch (e) {
    // Si on ne peut pas accéder à windows.getCurrent, on est probablement dans le popup natif
    console.log("[Popup] Mode popup natif détecté");
  }
})();

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

// Battleworld panel elements
const battleworldPanel = document.getElementById("battleworld-panel");
const btnBattleworld = document.getElementById("btn-battleworld");
const btnCloseBattleworld = document.getElementById("btn-close-battleworld");

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

// Toggle affichage token
const btnToggleToken = document.getElementById("btn-toggle-token");
if (btnToggleToken) {
  btnToggleToken.addEventListener("click", () => {
    const isHidden = apiToken.type === "password";
    apiToken.type = isHidden ? "text" : "password";
    btnToggleToken.textContent = isHidden ? "\u{1F648}" : "\u{1F441}";
  });
}

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

// Set des personnages actuellement en defense (pour filtrer les counters)
let defenseCharIds = new Set();

/**
 * Charge les personnages en defense depuis le storage
 * A appeler au demarrage et apres chaque tag/untag
 */
async function loadDefenseCharIds() {
  try {
    const stored = await storageGet(["msfWarSquads", "msfDefenseTagged"]);
    const squads = stored.msfWarSquads || [];
    const tagged = stored.msfDefenseTagged || [];
    defenseCharIds = new Set();
    for (const idx of tagged) {
      const squad = squads[idx];
      if (squad) {
        squad.forEach(id => { if (id) defenseCharIds.add(id); });
      }
    }
    console.log(`[Defense] ${defenseCharIds.size} personnages en defense`);
  } catch (e) {
    console.warn("[Defense] Erreur chargement defense:", e);
  }
}

// Defense panel elements
const defensePanel = document.getElementById("defense-panel");
const btnDefense = document.getElementById("btn-defense");
const btnCloseDefense = document.getElementById("btn-close-defense");
const defenseTeamSelect = document.getElementById("defense-team-select");
const defenseCounters = document.getElementById("defense-counters");
const defenseWarSquads = document.getElementById("defense-war-squads");
const defenseWarList = document.getElementById("defense-war-list");

// War event section elements
const warEventSection = document.getElementById("war-event-section");
const warTeamsList = document.getElementById("war-teams-list");

// Wizard elements
const welcomeBanner = document.getElementById("welcome-banner");
const wizardNext = document.getElementById("wizard-next");
const wizardSkip = document.getElementById("wizard-skip");
const wizardConnectBtn = document.getElementById("wizard-connect");
let wizardCurrentStep = 1;

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

// Verifier la connexion API au demarrage et afficher la banniere si necessaire
(async function checkConnectionStatus() {
  try {
    const stored = await storageGet(["msfApiToken", "msfWelcomeDismissed"]);
    if (!stored.msfApiToken && !stored.msfWelcomeDismissed) {
      welcomeBanner.classList.remove("hidden");
      btnApi.classList.add("needs-setup");
    }
  } catch (e) {
    console.log("[Popup] Erreur check connexion:", e);
  }
})();

// Wizard : navigation entre les etapes
function wizardGoToStep(step) {
  wizardCurrentStep = step;
  const steps = welcomeBanner.querySelectorAll(".wizard-step");
  const dots = welcomeBanner.querySelectorAll(".wizard-dot");

  steps.forEach(s => {
    const sStep = parseInt(s.dataset.step);
    s.classList.toggle("hidden", sStep !== step);
  });

  dots.forEach(d => {
    const dStep = parseInt(d.dataset.step);
    d.classList.toggle("active", dStep === step);
    d.classList.toggle("done", dStep < step);
  });

  // Dernier step : bouton "Suivant" → "C'est parti !"
  if (step === 3) {
    wizardNext.textContent = "C'est parti !";
  } else {
    wizardNext.textContent = "Suivant";
  }
}

// Wizard : bouton "Suivant"
wizardNext.addEventListener("click", async () => {
  if (wizardCurrentStep < 3) {
    wizardGoToStep(wizardCurrentStep + 1);
  } else {
    // Dernier step : fermer le wizard
    welcomeBanner.classList.add("hidden");
    btnApi.classList.remove("needs-setup");
    await storageSet({ msfWelcomeDismissed: true });
  }
});

// Wizard : bouton "Passer"
wizardSkip.addEventListener("click", async () => {
  welcomeBanner.classList.add("hidden");
  btnApi.classList.remove("needs-setup");
  await storageSet({ msfWelcomeDismissed: true });
});

// Wizard : bouton "Se connecter avec MSF" (step 2)
wizardConnectBtn.addEventListener("click", () => {
  welcomeBanner.classList.add("hidden");
  apiPanel.classList.remove("hidden");
  btnApi.classList.remove("needs-setup");
});

// Bouton "?" : réafficher le wizard
document.getElementById("btn-help").addEventListener("click", () => {
  wizardGoToStep(1);
  welcomeBanner.classList.remove("hidden");
});

// Event delegation pour les boutons "Connecter mon compte" dans les etats vides
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("btn-open-api")) {
    apiPanel.classList.remove("hidden");
  }
});

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
    const charsMap = charsData.characters || charsData;
    Object.entries(charsMap).forEach(([id, char]) => {
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
 * Extrait les personnages/équipes requis pour les raids depuis les scoring des events milestones
 * Retourne un tableau de { charName, requiredStars, eventName, points, description, mode }
 */
async function extractRaidTeamsFromEvents(eventsData) {
  try {
    let allEvents = eventsData;
    if (!allEvents) {
      const cached = await storageGet("msfEventsCache");
      if (!cached.msfEventsCache) return [];
      allEvents = cached.msfEventsCache;
    }

    const now = Date.now() / 1000;
    const activeEvents = allEvents.filter(e => e.endTime > now && e.startTime < now);

    // Pattern 1 : "Play Raids with [Name]" / "Raid with [Name]" (+ optionnel "at N Yellow Stars" ou "at Gear Tier N")
    const raidWithPattern = /(?:play\s+)?raids?\s+with\s+(.+?)(?:\s+at\s+(?:(\d+)\s+yellow\s+stars?|gear[- ]tier\s+\d+))?$/i;
    // Pattern 2 : "Use [Trait] characters in Raid"
    const raidUsePattern = /use\s+(.+?)\s+characters?\s+in\s+raid/i;
    // Pattern 3 : "Battle in Raid with [Name]" (au cas où)
    const raidBattlePattern = /battle\s+in\s+(?:[\w\s]+?\s+or\s+)?raid(?:\s+or\s+[\w]+)?\s+with\s+(.+?)(?:\s+at\s+(\d+)\s+yellow\s+stars?)?$/i;

    const raidTeams = [];

    activeEvents.forEach(event => {
      if (event.type !== "milestone" || !event.milestone?.scoring) return;

      const scoring = event.milestone.scoring;

      // Construire les méthodes avec leur cap parent et progression (soFar)
      const allMethods = [];
      (scoring.methods || []).forEach(m => {
        allMethods.push({ ...m, _cap: null, _capSoFar: null });
      });
      (scoring.cappedScorings || []).forEach(cs => {
        (cs.methods || []).forEach(m => {
          allMethods.push({
            ...m,
            _cap: cs.cap || null,
            _capSoFar: cs.soFar ?? null
          });
        });
      });

      allMethods.forEach(method => {
        if (!method.description) return;
        const desc = method.description;

        // Vérifier que c'est raid-related
        if (!/raid/i.test(desc)) return;

        let charName = null;
        let requiredStars = 0;

        // Essayer pattern 1 : "Play Raids with X"
        let match = raidWithPattern.exec(desc);
        if (!match) match = raidBattlePattern.exec(desc);

        if (match) {
          charName = match[1].trim();
          requiredStars = match[2] ? parseInt(match[2]) : 0;
        }

        // Essayer pattern 2 : "Use X characters in Raid"
        if (!charName) {
          const useMatch = raidUsePattern.exec(desc);
          if (useMatch) {
            charName = useMatch[1].trim();
          }
        }

        if (!charName) return;

        // Détecter condition Gear Tier
        let gearTier = 0;
        const gearMatch = desc.match(/gear[- ]tier\s+(\d+)/i);
        if (gearMatch) gearTier = parseInt(gearMatch[1]);

        // Éviter les doublons (même perso, même event) - garder uniquement le plus accessible
        // (sans condition > avec étoiles > avec gear tier)
        const existing = raidTeams.find(r =>
          r.charName.toUpperCase() === charName.toUpperCase() && r.eventName === event.name
        );
        if (existing) {
          // Ajouter les points si condition différente
          if (requiredStars > 0 || gearTier > 0) return; // ignorer les variantes plus restrictives
        }

        raidTeams.push({
          charName,
          requiredStars,
          gearTier,
          eventName: event.name,
          points: method.points,
          description: desc,
          cap: method._cap,
          soFar: method._capSoFar
        });
      });
    });

    return raidTeams;
  } catch (e) {
    console.error("[Raids] Erreur extraction teams raid:", e);
    return [];
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
  const inDefense = team.memberIds.filter(charId => defenseCharIds.has(charId));

  return {
    available: hasAll,
    hasCount: hasCount,
    totalCount: team.memberIds.length,
    missing: team.memberIds.filter(charId => !playerRoster.has(charId)),
    inDefense: inDefense,
    blockedByDefense: hasAll && inDefense.length > 0
  };
}

/**
 * Génère le badge de disponibilité pour un counter
 */
function renderAvailabilityBadge(teamId) {
  const status = canMakeTeam(teamId);
  if (status === null) return "";

  if (status.available && status.inDefense.length > 0) {
    // Equipe dispo mais des membres sont en defense
    const names = status.inDefense.map(id => {
      const c = charactersData?.characters?.[id];
      return c ? c.name : id;
    }).join(', ');
    return `<span class="counter-in-defense" title="En défense: ${names}">⚠️ ${status.inDefense.length}🛡</span>`;
  } else if (status.available) {
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
 * Affiche les personnages du roster < 7★ avec leurs lieux de farm
 */
async function displayRosterFarming() {
  // Charger le roster complet depuis le storage
  const stored = await storageGet(["msfPlayerRosterFull", "msfTokenType"]);
  const rosterFull = stored.msfPlayerRosterFull;
  const tokenType = stored.msfTokenType;

  if (!rosterFull || rosterFull.length === 0) {
    // Diagnostic pour aider l'utilisateur
    let hint = '';
    let showFetchBtn = false;
    if (tokenType === 'oauth') {
      hint = `<br><small style="color:#ffd43b;">⚠️ Token OAuth détecté. Le roster complet nécessite le token web (x-titan-token).<br>Jouez sur la version web MSF pour capturer automatiquement ce token.</small>`;
    } else if (!tokenType) {
      hint = `<br><small>Aucun token détecté. Jouez sur la version web MSF.</small>`;
    } else {
      hint = `<br><small>Token détecté — tentez de récupérer vos données.</small>`;
      showFetchBtn = true;
    }

    const fetchBtnHtml = showFetchBtn
      ? `<button class="btn-fetch-roster" style="background:#00d4ff;color:#1a1a2e;border:none;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer;margin-top:6px;">Recuperer mes equipes</button>`
      : `<button class="btn-open-api">Connecter mon compte</button>`;

    return `<div class="empty-state-cta" data-has-fetch="${showFetchBtn}">
      <p>Roster non disponible.${hint}</p>
      ${fetchBtnHtml}
    </div>`;
  }

  // Filtrer les personnages < 7 étoiles jaunes
  const under7Stars = rosterFull.filter(c => {
    const yellowStars = c.yellow || c.activeYellow || c.stars || 0;
    return yellowStars < 7;
  });

  if (under7Stars.length === 0) {
    return `<div class="farm-advisor-complete">Tous vos personnages sont à 7★ jaunes ! 🎉</div>`;
  }

  // Filtrer ceux qui ont un lieu de farm
  const farmableChars = under7Stars.filter(c => {
    const farmInfo = farmingData?.characters?.[c.id];
    return farmInfo && farmInfo.locations && farmInfo.locations.length > 0;
  });

  // Trier par nombre d'étoiles (les plus proches de 7 en premier)
  farmableChars.sort((a, b) => {
    const starsA = a.yellow || a.activeYellow || a.stars || 0;
    const starsB = b.yellow || b.activeYellow || b.stars || 0;
    return starsB - starsA; // Plus d'étoiles = plus haut
  });

  let html = `<div class="farm-advisor">
    <div class="farm-advisor-header">⭐ Personnages à farmer</div>
    <div class="farm-advisor-subtitle">${farmableChars.length} personnages < 7★ avec lieu de farm</div>
    <div class="farm-advisor-list">
  `;

  // Afficher les 20 premiers
  farmableChars.slice(0, 20).forEach((char, idx) => {
    const charInfo = charactersData?.characters?.[char.id] || { name: char.id };
    const farmInfo = farmingData?.characters?.[char.id];
    const yellowStars = char.yellow || char.activeYellow || char.stars || 0;

    // Formater les lieux de farm
    const locationsHtml = farmInfo.locations.map(loc => {
      const icon = getFarmLocationIcon(loc.type);
      let detail = '';
      if (loc.node) detail = loc.node;
      else if (loc.cost) detail = `${loc.cost} crédits`;
      else if (loc.orb) detail = loc.orb;
      else if (loc.event) detail = loc.event;
      return `<span class="farm-loc-tag ${loc.type}">${icon} ${detail}</span>`;
    }).join(' ');

    html += `
      <div class="farm-priority-item">
        <div class="farm-priority-rank">${yellowStars}★</div>
        <div class="farm-priority-info">
          ${charInfo.portrait ? `<img src="${charInfo.portrait}" class="farm-priority-portrait" alt="">` : ''}
          <div class="farm-priority-details">
            <span class="farm-priority-name">${charInfo.name || char.id}</span>
            <div class="farm-locations-mini">${locationsHtml}</div>
          </div>
        </div>
      </div>
    `;
  });

  if (farmableChars.length > 20) {
    html += `<div class="farm-advisor-subtitle" style="margin-top:10px;">... et ${farmableChars.length - 20} autres</div>`;
  }

  html += `</div></div>`;
  return html;
}

/**
 * Retourne l'icône pour un type de lieu de farm
 */
function getFarmLocationIcon(type) {
  const icons = {
    campaign: '📍',
    blitz: '⚡',
    arena: '🏟️',
    raid: '💀',
    war: '⚔️',
    milestone: '🏆',
    legendary: '👑',
    crucible: '🔥',
    event: '📅'
  };
  return icons[type] || '📦';
}

/**
 * Convertit le niveau de confiance en symboles visuels (etoiles)
 * 95% = ★★★ (excellent counter)
 * 80% = ★★ (bon counter)
 * 65% = ★ (counter correct)
 * 50% = ☆ (counter moyen)
 * <50% = ☆ (faible)
 */
function confidenceToSymbols(confidence) {
  if (confidence >= 95) return '<span style="color:#51cf66" title="Punch up +20%">★★★</span>';
  if (confidence >= 80) return '<span style="color:#51cf66" title="Punch up +10%">★★</span>';
  if (confidence >= 65) return '<span style="color:#69db7c" title="Punch up +5%">★</span>';
  if (confidence >= 50) return '<span style="color:#fcc419" title="Even match">☆</span>';
  return '<span style="color:#ff6b6b;opacity:0.6" title="Punch down">☆</span>';
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
loadDefenseCharIds();

// ============================================
// Bouton Analyser
// ============================================

if (btnAnalyze) btnAnalyze.addEventListener("click", async () => {
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
      width: 550,
      height: 750,
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
  const wasHidden = eventsPanel.classList.contains("hidden");
  eventsPanel.classList.remove("hidden");
  eventsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (wasHidden) {
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
const raidTeamsSection = document.getElementById("raid-teams-section");
const raidTeamsList = document.getElementById("raid-teams-list");

btnRaids.addEventListener("click", async () => {
  const wasHidden = raidsPanel.classList.contains("hidden");
  raidsPanel.classList.remove("hidden");
  raidsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (wasHidden) {
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
  const wasHidden = defensePanel.classList.contains("hidden");
  defensePanel.classList.remove("hidden");
  defensePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (wasHidden) {
    await loadDefensePanel();
  }
});

btnCloseDefense.addEventListener("click", () => {
  defensePanel.classList.add("hidden");
});

/**
 * Matche un squad (array de charIds) avec la meilleure equipe connue
 */
function matchSquadToTeam(charIds, teams) {
  if (!charIds || charIds.length < 3) return null;

  const normalized = charIds.filter(id => id).map(id => id.toUpperCase());
  let bestTeam = null;
  let bestCount = 0;

  for (const team of teams) {
    if (!team.memberIds) continue;
    const memberUpper = team.memberIds.map(id => id.toUpperCase());
    const matchCount = normalized.filter(id => memberUpper.includes(id)).length;
    if (matchCount > bestCount) {
      bestCount = matchCount;
      bestTeam = team;
    }
  }

  if (bestCount < 3) return null;

  return {
    team: bestTeam,
    matchCount: bestCount,
    confidence: Math.round((bestCount / Math.min(5, normalized.length)) * 100)
  };
}

/**
 * Affiche les counters pour un teamId donne (reutilise par cards et dropdown)
 */
function showDefenseCounters(teamId) {
  if (!teamId || !inverseCounters) {
    defenseCounters.classList.add("hidden");
    return;
  }

  const counters = inverseCounters.getCountersFor(teamId);

  if (counters.length === 0) {
    defenseCounters.innerHTML = '<div class="no-counters">Aucun counter connu pour cette equipe</div>';
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
}

async function loadDefensePanel() {
  try {
    if (!inverseCounters) {
      inverseCounters = new InverseCounters();
      await inverseCounters.init();
    }

    // Charger les portraits si pas encore fait
    if (!charactersData) {
      try {
        const response = await fetch(ext.runtime.getURL("data/characters-full.json"));
        charactersData = await response.json();
      } catch (e) { /* ignore */ }
    }

    // Remplir le select avec les equipes de defense
    const defenseTeams = inverseCounters.getAllDefenseTeams();

    defenseTeamSelect.innerHTML = '<option value="">-- Selectionner une equipe --</option>';
    defenseTeams.forEach(team => {
      const option = document.createElement("option");
      option.value = team.teamId;
      option.textContent = `${team.teamName} (${team.counterCount} counters)`;
      defenseTeamSelect.appendChild(option);
    });

    defenseCounters.classList.add("hidden");
    defenseCounters.innerHTML = "";

    // Charger les War squads du joueur + tags defense
    const stored = await storageGet(["msfWarSquads", "msfPlayerRosterFull", "msfDefenseTagged"]);
    defenseWarSquads.classList.remove("hidden");

    if (stored.msfWarSquads && stored.msfWarSquads.length > 0) {
      renderWarSquadCards(stored.msfWarSquads, stored.msfPlayerRosterFull, stored.msfDefenseTagged || []);
    } else {
      // Pas de squads : afficher bouton pour recuperer
      defenseWarList.innerHTML = `
        <div class="empty-state-cta" style="text-align:center;padding:12px;">
          <p style="font-size:12px;color:#888;margin-bottom:8px;">Aucune equipe War chargee</p>
          <button class="btn-fetch-squads" style="background:#00d4ff;color:#1a1a2e;border:none;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer;">Recuperer mes equipes</button>
        </div>`;
      defenseWarList.querySelector(".btn-fetch-squads").addEventListener("click", () => refreshDefenseSquads());
    }

    // Bouton refresh toujours disponible dans le titre
    const btnRefresh = document.getElementById("btn-refresh-squads");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", () => refreshDefenseSquads());
    }

  } catch (e) {
    console.error("[Defense] Erreur chargement:", e);
  }
}

/**
 * Rafraichit les War squads depuis l'API
 */
async function refreshDefenseSquads() {
  const btnRefresh = document.getElementById("btn-refresh-squads");
  if (btnRefresh) btnRefresh.classList.add("loading");

  try {
    const result = await fetchSquadsAndRoster();
    // Recharger les tags existants
    const tagStored = await storageGet(["msfDefenseTagged"]);

    if (result.tabs.war.length > 0) {
      renderWarSquadCards(result.tabs.war, result.playerRosterFull, tagStored.msfDefenseTagged || []);
    } else {
      defenseWarList.innerHTML = '<div style="text-align:center;padding:12px;font-size:12px;color:#888;">Aucune equipe War sauvegardee dans le jeu</div>';
    }
  } catch (err) {
    console.error("[Defense] Refresh error:", err);
    // Afficher erreur temporaire
    const existing = defenseWarList.innerHTML;
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = "text-align:center;padding:6px;font-size:11px;color:#ff6b6b;";
    errorDiv.textContent = "Erreur de connexion — verifiez votre token";
    defenseWarList.prepend(errorDiv);
    setTimeout(() => errorDiv.remove(), 4000);
  } finally {
    if (btnRefresh) btnRefresh.classList.remove("loading");
  }
}

/**
 * Affiche les cartes des War squads du joueur
 */
let currentDefenseTagged = [];

function renderWarSquadCards(warSquads, rosterFull, defenseTagged) {
  const teams = inverseCounters.teams || [];
  const chars = charactersData?.characters || {};
  currentDefenseTagged = defenseTagged || [];

  // Index roster par ID pour lookup rapide de la puissance
  const rosterMap = {};
  if (rosterFull) {
    rosterFull.forEach(c => {
      rosterMap[c.id?.toUpperCase() || ""] = c;
    });
  }

  let html = "";

  warSquads.forEach((squad, idx) => {
    if (!squad || squad.length === 0) return;

    const validMembers = squad.filter(id => id);
    const match = matchSquadToTeam(validMembers, teams);

    const teamName = match ? match.team.name : validMembers.slice(0, 3).map(id => {
      const c = chars[id];
      return c ? c.name : id;
    }).join(", ") + "...";

    const teamId = match ? match.team.id : null;
    const matchLabel = match ? `${match.matchCount}/5` : "";
    const isDefense = currentDefenseTagged.includes(idx);

    // Calculer puissance totale
    let totalPower = 0;
    validMembers.forEach(id => {
      const r = rosterMap[id?.toUpperCase() || ""];
      if (r && r.power) totalPower += r.power;
    });

    // Portraits des membres
    let membersHtml = "";
    validMembers.forEach(id => {
      const charData = chars[id];
      const portrait = charData?.portrait || "";
      if (portrait) {
        membersHtml += `<div class="defense-war-card-member" style="background-image:url('${portrait}')"></div>`;
      } else {
        membersHtml += `<div class="defense-war-card-member"></div>`;
      }
    });

    const counterCount = teamId ? (inverseCounters.getCountersFor(teamId)?.length || 0) : 0;

    html += `
      <div class="defense-war-card${isDefense ? " tagged-defense" : ""}" data-team-id="${teamId || ""}" data-index="${idx}">
        <div class="defense-war-card-header">
          <span class="defense-war-card-name">${teamName}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="defense-war-card-power">${totalPower > 0 ? Math.round(totalPower / 1000) + "k" : ""}</span>
            <button class="defense-tag-btn${isDefense ? " tagged" : ""}" data-index="${idx}" title="Marquer en defense">&#x1F6E1;</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div class="defense-war-card-members">${membersHtml}</div>
          <span class="defense-war-card-confidence">${isDefense ? "EN DEFENSE" : (counterCount > 0 ? counterCount + " counters" : matchLabel)}</span>
        </div>
      </div>`;
  });

  defenseWarList.innerHTML = html;

  // Click handlers sur les cartes (pour voir les counters)
  defenseWarList.querySelectorAll(".defense-war-card").forEach(card => {
    card.addEventListener("click", (e) => {
      // Ignorer si on clique sur le bouton tag
      if (e.target.closest(".defense-tag-btn")) return;

      const teamId = card.dataset.teamId;
      if (!teamId) return;

      // Activer la carte, desactiver les autres
      defenseWarList.querySelectorAll(".defense-war-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");

      // Synchroniser le dropdown
      defenseTeamSelect.value = teamId;

      // Afficher les counters
      showDefenseCounters(teamId);
    });
  });

  // Click handlers sur les boutons tag defense
  defenseWarList.querySelectorAll(".defense-tag-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const tagIndex = currentDefenseTagged.indexOf(idx);

      if (tagIndex >= 0) {
        currentDefenseTagged.splice(tagIndex, 1);
      } else {
        currentDefenseTagged.push(idx);
      }

      // Sauvegarder
      await storageSet({ msfDefenseTagged: currentDefenseTagged });

      // Mettre a jour le Set des persos en defense
      await loadDefenseCharIds();

      // Mettre a jour visuellement la carte
      const card = btn.closest(".defense-war-card");
      const confSpan = card.querySelector(".defense-war-card-confidence");

      if (currentDefenseTagged.includes(idx)) {
        card.classList.add("tagged-defense");
        btn.classList.add("tagged");
        confSpan.textContent = "EN DEFENSE";
      } else {
        card.classList.remove("tagged-defense");
        btn.classList.remove("tagged");
        const teamId = card.dataset.teamId;
        const count = teamId ? (inverseCounters.getCountersFor(teamId)?.length || 0) : 0;
        confSpan.textContent = count > 0 ? count + " counters" : "";
      }
    });
  });
}

defenseTeamSelect.addEventListener("change", () => {
  const teamId = defenseTeamSelect.value;

  // Desactiver les cartes actives
  defenseWarList.querySelectorAll(".defense-war-card.active").forEach(c => c.classList.remove("active"));

  // Activer la carte correspondante si elle existe
  if (teamId) {
    const matchingCard = defenseWarList.querySelector(`.defense-war-card[data-team-id="${teamId}"]`);
    if (matchingCard) matchingCard.classList.add("active");
  }

  showDefenseCounters(teamId);
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
  const wasHidden = farmPanel.classList.contains("hidden");
  farmPanel.classList.remove("hidden");
  farmPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (wasHidden) {
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
    // Get character info from characters-full.json (fallback: clé sans tirets pour matcher PascalCase)
    const charInfo = charactersData.characters[charId]
      || charactersData.characters[charId.replace(/-/g, '')]
      || { name: charId, portrait: null };

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
const farmTabRoster = document.getElementById("farm-tab-roster");
const farmSearchMode = document.getElementById("farm-search-mode");
const farmAdvisorMode = document.getElementById("farm-advisor-mode");
const farmRosterMode = document.getElementById("farm-roster-mode");
const farmAdvisorResults = document.getElementById("farm-advisor-results");
const farmRosterResults = document.getElementById("farm-roster-results");

if (farmTabSearch && farmTabAdvisor) {
  farmTabSearch.addEventListener("click", () => {
    farmTabSearch.classList.add("active");
    farmTabAdvisor.classList.remove("active");
    farmTabRoster?.classList.remove("active");
    farmSearchMode.classList.remove("hidden");
    farmAdvisorMode.classList.add("hidden");
    farmRosterMode?.classList.add("hidden");
  });

  farmTabAdvisor.addEventListener("click", async () => {
    farmTabAdvisor.classList.add("active");
    farmTabSearch.classList.remove("active");
    farmTabRoster?.classList.remove("active");
    farmAdvisorMode.classList.remove("hidden");
    farmSearchMode.classList.add("hidden");
    farmRosterMode?.classList.add("hidden");

    // Afficher l'analyse
    farmAdvisorResults.innerHTML = '<div class="farm-advisor-loading">Analyse en cours...</div>';

    // S'assurer que les données sont chargées (teams, counters, roster, farming, characters)
    await loadTeamsAndCounters();
    await loadPlayerRoster();
    await loadFarmingData();

    farmAdvisorResults.innerHTML = displayFarmingAdvisor();
  });

  if (farmTabRoster) {
    farmTabRoster.addEventListener("click", async () => {
      farmTabRoster.classList.add("active");
      farmTabSearch.classList.remove("active");
      farmTabAdvisor.classList.remove("active");
      farmRosterMode.classList.remove("hidden");
      farmSearchMode.classList.add("hidden");
      farmAdvisorMode.classList.add("hidden");

      // Afficher l'analyse
      farmRosterResults.innerHTML = '<div class="farm-advisor-loading">Analyse du roster...</div>';

      // Charger les données nécessaires
      await loadFarmingData();

      farmRosterResults.innerHTML = await displayRosterFarming();

      // Attacher le handler du bouton "Recuperer mes equipes" si present
      const fetchRosterBtn = farmRosterResults.querySelector(".btn-fetch-roster");
      if (fetchRosterBtn) {
        fetchRosterBtn.addEventListener("click", async (e) => {
          const btn = e.target;
          btn.textContent = "Chargement...";
          btn.disabled = true;
          try {
            await fetchSquadsAndRoster();
            // Recharger l'affichage du roster
            farmRosterResults.innerHTML = await displayRosterFarming();
            // Rattacher le handler si toujours en etat vide
            const newFetchBtn = farmRosterResults.querySelector(".btn-fetch-roster");
            if (newFetchBtn) {
              newFetchBtn.textContent = "Aucune donnee - Reessayer";
            }
          } catch (err) {
            btn.textContent = "Erreur - Reessayer";
            btn.disabled = false;
            console.error("[Roster] Fetch error:", err);
          }
        });
      }
    });
  }
}

async function loadEvents() {
  eventsLoading.classList.remove("hidden");
  eventsError.classList.add("hidden");
  eventsList.classList.add("hidden");

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
      eventsError.innerHTML = '<div class="empty-state-cta"><p>Pas de donnees disponibles.</p><button class="btn-open-api">Connecter mon compte</button></div>';
      eventsError.classList.remove("hidden");
      return;
    }
  }

  const now = Date.now() / 1000;

  // Filtrer les événements actifs
  const activeEvents = events.filter(e => e.endTime > now && e.startTime < now);

  // Debug: log tous les types d'events actifs pour identifier les catégories inconnues
  console.log("[Events] Types actifs:", [...new Set(activeEvents.map(e => e.type))]);
  console.log("[Events] typeName actifs:", [...new Set(activeEvents.map(e => e.milestone?.typeName).filter(Boolean))]);
  activeEvents.forEach(e => {
    if (e.type === "milestone" && e.milestone?.typeName) {
      console.log(`[Events] "${e.name}" → typeName: "${e.milestone.typeName}", category: "${e.milestone.category || ""}"`);
    }
  });

  // Séparer par type
  const blitzEvents = activeEvents.filter(e => e.type === "blitz");
  // Milestones : exclure Echo Orb, Poste de commandement (commandPost/redStar), et phases déjà complètes à 100%
  const milestoneEvents = activeEvents.filter(e => {
    if (e.type !== "milestone" || !e.milestone?.scoring) return false;
    if (/echo\s*orb|orb\s*echo/i.test(e.name)) return false;
    // Exclure Poste de commandement (Red Stars, commandPost)
    const typeName = (e.milestone?.typeName || "").toLowerCase();
    const category = (e.milestone?.category || "").toLowerCase();
    if (typeName.includes("commandpost") || typeName.includes("redstar") ||
        category.includes("commandpost") || category.includes("redstar")) return false;
    return true;
  });

  // Dédupliquer les milestones par nom : si même nom, garder seulement la phase en cours (pas à 100%)
  const seenNames = new Map();
  const dedupedMilestones = [];
  for (const e of milestoneEvents) {
    const progress = e.milestone?.progress;
    const tiers = e.milestone?.tiers;
    const isComplete = progress && tiers && tiers.length > 0 &&
      progress.completedTier >= tiers.length;

    if (!seenNames.has(e.name)) {
      seenNames.set(e.name, dedupedMilestones.length);
      dedupedMilestones.push(e);
    } else if (!isComplete) {
      // Remplacer l'entrée précédente par celle en cours (pas complète)
      const idx = seenNames.get(e.name);
      dedupedMilestones[idx] = e;
    }
  }

  renderAllEvents({ blitz: blitzEvents, milestone: dedupedMilestones });
  eventsLoading.classList.add("hidden");
  eventsList.classList.remove("hidden");

  // Afficher l'indicateur offline si nécessaire
  if (isOffline) {
    showOfflineIndicator();
  }

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
      raidsError.innerHTML = '<div class="empty-state-cta"><p>Pas de donnees disponibles.</p><button class="btn-open-api">Connecter mon compte</button></div>';
      raidsError.classList.remove("hidden");
      return;
    }
  }

  const now = Date.now() / 1000;
  const raidEvents = events.filter(e => e.type === "raid" && e.endTime > now && e.startTime < now);

  renderRaids(raidEvents);
  raidsLoading.classList.add("hidden");
  raidsList.classList.remove("hidden");

  // Extraire les équipes raid depuis les milestones
  const raidTeams = await extractRaidTeamsFromEvents(events);
  if (raidTeams.length > 0) {
    renderRaidTeams(raidTeams);
    raidTeamsSection.classList.remove("hidden");
  } else {
    raidTeamsSection.classList.add("hidden");
  }
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
 * Affiche les personnages/équipes recommandées pour les raids (depuis les events milestones)
 * Groupé par personnage/équipe avec les différentes conditions en sous-lignes
 */
function renderRaidTeams(raidTeams) {
  // Grouper par nom de personnage/équipe
  const byChar = {};
  raidTeams.forEach(rt => {
    const key = rt.charName.toUpperCase();
    if (!byChar[key]) byChar[key] = { charName: rt.charName, entries: [] };
    byChar[key].entries.push(rt);
  });

  let html = '';

  Object.values(byChar).forEach(group => {
    // Trier : sans condition d'abord, puis étoiles croissantes, puis gear
    group.entries.sort((a, b) => {
      if (a.requiredStars === 0 && a.gearTier === 0) return -1;
      if (b.requiredStars === 0 && b.gearTier === 0) return 1;
      if (a.requiredStars !== b.requiredStars) return a.requiredStars - b.requiredStars;
      return a.gearTier - b.gearTier;
    });

    // Nom traduit de l'event source (prendre le premier)
    const eventSource = translateEventName(group.entries[0].eventName);

    html += `
      <div class="raid-team-card" style="background:linear-gradient(135deg,#1e1e3a,#2a2040);border-radius:8px;padding:10px 12px;border-left:3px solid #845ef7;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:700;font-size:13px;color:#fff;">${group.charName}</span>
          <span style="font-size:10px;color:#888;font-style:italic;max-width:140px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${eventSource}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">`;

    group.entries.forEach(entry => {
      let conditionLabel = '';
      let conditionColor = '#69db7c'; // base = vert

      if (entry.requiredStars > 0) {
        conditionLabel = `${entry.requiredStars}★`;
        conditionColor = '#ffd43b';
      } else if (entry.gearTier > 0) {
        conditionLabel = `G${entry.gearTier}`;
        conditionColor = '#cc5de8';
      } else {
        conditionLabel = 'Base';
      }

      // Calculer la progression (actions faites / max)
      let progressHtml = '';
      if (entry.cap && entry.points > 0) {
        const maxActions = Math.round(entry.cap / entry.points);
        if (entry.soFar !== null && entry.soFar !== undefined) {
          const doneActions = Math.min(Math.round(entry.soFar / entry.points), maxActions);
          const isComplete = doneActions >= maxActions;
          const progColor = isComplete ? '#51cf66' : '#fcc419';
          progressHtml = `<span style="font-size:10px;font-weight:700;color:${progColor};margin-left:2px;">${doneActions}/${maxActions}</span>`;
        } else {
          // Pas de soFar = 0 actions faites
          progressHtml = `<span style="font-size:10px;font-weight:700;color:#ff6b6b;margin-left:2px;">0/${maxActions}</span>`;
        }
      }

      html += `
          <div style="display:flex;align-items:center;gap:4px;background:#16162a;border-radius:4px;padding:3px 8px;">
            <span style="font-size:11px;font-weight:700;color:${conditionColor};min-width:32px;text-align:center;">${conditionLabel}</span>
            <span style="font-size:10px;color:#51cf66;font-weight:600;">+${formatNumber(entry.points)} pts</span>
            ${progressHtml}
          </div>`;
    });

    html += `
        </div>
      </div>`;
  });

  raidTeamsList.innerHTML = html;
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

  // Progression joueur (si disponible via /player/v1/events)
  let progressHtml = "";
  const progress = event.milestone?.progress;
  const tiers = event.milestone?.tiers;
  if (progress && tiers && tiers.length > 0) {
    const totalTiers = tiers.length;
    const completedTier = progress.completedTier || 0;
    const currentPoints = progress.points || 0;
    const nextGoal = progress.goal || (tiers[completedTier] ? tiers[completedTier].endScore : 0);
    const pct = nextGoal > 0 ? Math.min(100, Math.round((currentPoints / nextGoal) * 100)) : 0;

    progressHtml = `
      <div class="event-progress">
        <div class="event-progress-info">
          <span class="event-progress-pts">${formatNumber(currentPoints)} pts</span>
          <span class="event-progress-tier">Phase ${completedTier + (progress.completionOffset || 0)} / ${totalTiers + (progress.completionOffset || 0)}</span>
        </div>
        <div class="event-progress-bar-bg">
          <div class="event-progress-bar" style="width: ${pct}%"></div>
        </div>
        <div class="event-progress-label">${formatNumber(currentPoints)} / ${formatNumber(nextGoal)} (${pct}%)</div>
      </div>
    `;
  }

  return `
    <div class="event-info">
      <span class="event-time ${isUrgent ? 'urgent' : ''}">⏱ ${timeLeft}</span>
      <span class="event-mode ${isSeries ? 'series' : 'solo'}">${eventMode}</span>
      ${alertBtn}
    </div>
    ${subName}
    ${progressHtml}
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
          rows.push({ desc: translateEventDescription(m.description), points: m.points, cap: null, soFar: null });
        });
      }
      if (scoring?.cappedScorings) {
        scoring.cappedScorings.forEach(cs => {
          cs.methods.forEach(m => {
            rows.push({ desc: translateEventDescription(m.description), points: m.points, cap: cs.cap, soFar: cs.soFar ?? null });
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
                <thead><tr><th>Action</th><th>Pts</th><th>Cap</th><th>Fait</th></tr></thead>
                <tbody>
                  ${rows.map(r => {
                    let progressCell = '-';
                    if (r.cap !== null && r.points > 0) {
                      const max = Math.round(r.cap / r.points);
                      const done = r.soFar !== null ? Math.min(Math.round(r.soFar / r.points), max) : 0;
                      const isComplete = done >= max;
                      progressCell = `<span style="color:${isComplete ? '#51cf66' : done > 0 ? '#fcc419' : '#ff6b6b'};font-weight:700;">${done}/${max}</span>`;
                    }
                    return `
                    <tr>
                      <td class="scoring-action">${r.desc}</td>
                      <td class="scoring-points">${formatNumber(r.points)}</td>
                      <td class="scoring-cap ${r.cap === null ? "unlimited" : ""}">${r.cap === null ? "∞" : formatNumber(r.cap)}</td>
                      <td class="scoring-progress">${progressCell}</td>
                    </tr>`;
                  }).join("")}
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

  // Ajouter les event listeners pour le calculateur inversé
  // Sélecteur de palier
  eventsList.querySelectorAll(".calc-tier-select").forEach(select => {
    select.addEventListener("change", () => {
      const calcSection = select.closest(".points-calc-section");
      if (calcSection) {
        const idx = calcSection.id.replace("points-calc-", "");
        // Vider le champ personnalisé quand on sélectionne un palier
        const targetInput = document.getElementById(`calc-target-${idx}`);
        if (targetInput && select.value !== "0") {
          targetInput.value = "";
        }
        updatePointsCalculation(idx);
      }
    });
  });

  // Champ de points personnalisé
  eventsList.querySelectorAll(".calc-target-pts").forEach(input => {
    input.addEventListener("input", () => {
      const calcSection = input.closest(".points-calc-section");
      if (calcSection) {
        const idx = calcSection.id.replace("points-calc-", "");
        // Réinitialiser le sélecteur de palier quand on tape un nombre
        const tierSelect = document.getElementById(`calc-tier-select-${idx}`);
        if (tierSelect && input.value) {
          tierSelect.value = "0";
        }
        updatePointsCalculation(idx);
      }
    });
  });

  // Bouton "Max" pour remplir avec le score du palier max
  eventsList.querySelectorAll(".calc-max-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const maxScore = btn.dataset.max;
      const idx = btn.dataset.idx;
      const targetInput = document.getElementById(`calc-target-${idx}`);
      const tierSelect = document.getElementById(`calc-tier-select-${idx}`);
      if (targetInput) {
        targetInput.value = maxScore;
        if (tierSelect) {
          tierSelect.value = "0"; // Reset le select
        }
        updatePointsCalculation(idx);
      }
    });
  });

  // Checkbox d'exclusion de méthodes de scoring
  eventsList.querySelectorAll(".calc-method-checkbox").forEach(cb => {
    cb.addEventListener("change", () => {
      const idx = cb.dataset.calcIdx;
      updatePointsCalculation(idx);
    });
  });

  // Auto-exclure les méthodes impossibles basées sur le roster, puis calcul initial
  autoExcludeUnavailableMethods().then(() => {
    eventsList.querySelectorAll(".calc-tier-select").forEach(select => {
      if (select.value && select.value !== "0") {
        const calcSection = select.closest(".points-calc-section");
        if (calcSection) {
          const idx = calcSection.id.replace("points-calc-", "");
          updatePointsCalculation(idx);
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
 * Parse une description de scoring pour extraire le personnage requis et ses étoiles
 * Ex: "Battle in Crucible or Blitz with Magneto (Phoenix Force) at 5 Yellow Stars"
 * → { charName: "Magneto (Phoenix Force)", requiredStars: 5 }
 */
function parseScoringRequirement(rawDesc) {
  if (!rawDesc) return null;

  // Pattern: "... with <CharName> at <N> Yellow Stars"
  const withStarsMatch = rawDesc.match(/with\s+(.+?)\s+at\s+(\d+)\s+yellow\s+stars?/i);
  if (withStarsMatch) {
    return { charName: withStarsMatch[1].trim(), requiredStars: parseInt(withStarsMatch[2]) };
  }

  // Pattern: "... with <CharName>" (sans étoiles requises)
  const withMatch = rawDesc.match(/with\s+(.+?)(?:\s*$)/i);
  if (withMatch) {
    // Nettoyer les trailing words qui ne font pas partie du nom
    const name = withMatch[1].replace(/\s+at\s+.*$/i, "").trim();
    if (name.length > 2) {
      return { charName: name, requiredStars: 0 };
    }
  }

  return null;
}

/**
 * Auto-exclut les méthodes de scoring impossibles basées sur le roster du joueur
 * Compare les personnages requis avec le roster full (étoiles jaunes)
 */
async function autoExcludeUnavailableMethods() {
  try {
    const stored = await storageGet("msfPlayerRosterFull");
    const rosterFull = stored.msfPlayerRosterFull;
    console.log("[AutoExclude] Roster full:", rosterFull ? rosterFull.length + " persos" : "ABSENT");
    if (!rosterFull || rosterFull.length === 0) {
      console.log("[AutoExclude] Pas de roster, abandon");
      return;
    }

    // Log quelques IDs du roster pour debug
    console.log("[AutoExclude] Premiers IDs roster:", rosterFull.slice(0, 10).map(c => c.id));
    // Chercher les IDs contenant "magneto" ou "phoenix" dans le roster
    const magnetoIds = rosterFull.filter(c => (c.id || "").toLowerCase().includes("magneto") || (c.id || "").toLowerCase().includes("phoenix"));
    console.log("[AutoExclude] IDs roster avec magneto/phoenix:", magnetoIds.map(c => ({ id: c.id, yellow: c.yellow || c.activeYellow || c.stars })));

    // Charger le mapping nom → id
    const charsUrl = ext.runtime.getURL("data/characters-full.json");
    const charsRes = await fetch(charsUrl);
    const charsData = await charsRes.json();

    // Map nom (majuscules) → id et id → char data
    const nameToId = {};
    const idToChar = {};
    const allTraits = new Set();
    const charsMap = charsData.characters || charsData;
    Object.entries(charsMap).forEach(([id, char]) => {
      idToChar[id] = char;
      if (char.name) {
        nameToId[char.name.toUpperCase()] = id;
      }
      if (char.traits) {
        char.traits.forEach(t => allTraits.add(t.toUpperCase()));
      }
    });
    console.log("[AutoExclude] Base personnages chargée:", Object.keys(nameToId).length, "noms,", allTraits.size, "traits");

    const rosterById = {};
    rosterFull.forEach(c => {
      rosterById[c.id] = c;
    });

    /**
     * Vérifie si un nom correspond à un trait/tag d'équipe (pas un personnage)
     * Ex: "Winter Guard" → trait "WinterGuard" → true
     */
    function isTeamTrait(name) {
      const normalized = name.replace(/[\s\-']/g, "").toUpperCase();
      return allTraits.has(normalized);
    }

    /**
     * Résout un nom de personnage depuis une description d'event vers un ID
     */
    function resolveCharId(charName) {
      const upper = charName.toUpperCase();

      // 1. Match exact
      if (nameToId[upper]) {
        console.log(`[AutoExclude]   resolveCharId("${charName}") → match exact: ${nameToId[upper]}`);
        return nameToId[upper];
      }

      // 2. Nom avec parenthèses
      const parenMatch = charName.match(/^(.+?)\s*\((.+?)\)$/);
      if (parenMatch) {
        const baseName = parenMatch[1].trim();
        const variant = parenMatch[2].trim().replace(/\s+/g, "");
        console.log(`[AutoExclude]   resolveCharId("${charName}") → paren: base="${baseName}", variant="${variant}"`);

        const candidates = [
          baseName.replace(/[\s\-']/g, "") + variant,
          baseName.replace(/[\s\-']/g, "") + "_" + variant,
          baseName.replace(/[\s\-']/g, "") + variant.replace(/Force$/i, ""),
        ];
        console.log(`[AutoExclude]   Candidats ID:`, candidates);

        for (const candidateId of candidates) {
          if (idToChar[candidateId]) {
            console.log(`[AutoExclude]   → trouvé dans base: ${candidateId}`);
            return candidateId;
          }
          const found = Object.keys(idToChar).find(id => id.toUpperCase() === candidateId.toUpperCase());
          if (found) {
            console.log(`[AutoExclude]   → trouvé case-insensitive: ${found}`);
            return found;
          }
        }

        // 3. Trait search
        const baseUpper = baseName.toUpperCase();
        const traitName = variant;
        for (const [id, char] of Object.entries(charsMap)) {
          if (char.name && char.name.toUpperCase().includes(baseUpper) && char.traits) {
            if (char.traits.some(t => t.toUpperCase() === traitName.toUpperCase())) {
              console.log(`[AutoExclude]   → trouvé par trait "${traitName}": ${id}`);
              return id;
            }
          }
        }
      }

      console.log(`[AutoExclude]   resolveCharId("${charName}") → NON TROUVÉ dans base`);
      return null;
    }

    // Pour chaque méthode dans le calculateur, vérifier le roster
    const allRows = document.querySelectorAll(".calc-method-row[data-raw-desc]");
    console.log("[AutoExclude] Nombre de méthodes à vérifier:", allRows.length);

    let excludedCount = 0;
    allRows.forEach(row => {
      const rawDesc = row.dataset.rawDesc;
      const req = parseScoringRequirement(rawDesc);
      console.log(`[AutoExclude] rawDesc="${rawDesc}" → parsed:`, req);
      if (!req) return;

      // Si c'est un tag d'équipe (ex: "Winter Guard"), vérifier si le joueur a au moins un membre
      if (isTeamTrait(req.charName)) {
        const traitNorm = req.charName.replace(/[\s\-']/g, "").toUpperCase();
        const teamCharIds = [];
        for (const [id, char] of Object.entries(charsMap)) {
          if (char.traits && char.traits.some(t => t.toUpperCase() === traitNorm)) {
            teamCharIds.push(id);
          }
        }
        const checkbox = row.querySelector(".calc-method-checkbox");
        if (!checkbox) return;
        const ownedMembers = teamCharIds.filter(id => {
          const rc = rosterById[id];
          if (!rc) return false;
          if (req.requiredStars > 0) {
            const ys = rc.yellow || rc.activeYellow || rc.stars || 0;
            return ys >= req.requiredStars;
          }
          return true;
        });
        console.log(`[AutoExclude] Tag équipe "${req.charName}": ${teamCharIds.length} membres connus, ${ownedMembers.length} éligibles${req.requiredStars > 0 ? ` à ${req.requiredStars}★+` : ""}`);
        if (ownedMembers.length === 0) {
          console.log(`[AutoExclude] ❌ "${req.charName}" → aucun membre éligible, on décoche`);
          checkbox.checked = false;
          row.title = req.requiredStars > 0
            ? `Aucun ${req.charName} a ${req.requiredStars}★+`
            : `Aucun membre ${req.charName} recrute`;
          excludedCount++;
        } else {
          console.log(`[AutoExclude] ✅ "${req.charName}" → ${ownedMembers.length} membre(s) éligible(s)`);
        }
        return;
      }

      const charId = resolveCharId(req.charName);
      const checkbox = row.querySelector(".calc-method-checkbox");
      if (!checkbox) return;

      let rosterChar = charId ? rosterById[charId] : null;
      console.log(`[AutoExclude] charId=${charId}, trouvé dans roster par ID: ${!!rosterChar}`);

      // Si le perso n'est pas dans la base de noms, chercher directement dans le roster par ID
      if (!rosterChar) {
        const searchName = req.charName.replace(/[\s\-'()]/g, "").toUpperCase();
        console.log(`[AutoExclude] Recherche roster directe: "${searchName}"`);

        // D'abord match exact (le plus fiable)
        for (const c of rosterFull) {
          const rosterId = (c.id || "").replace(/[\s\-_]/g, "").toUpperCase();
          if (rosterId === searchName) {
            rosterChar = c;
            console.log(`[AutoExclude]   → match exact roster: id="${c.id}", yellow=${c.yellow || c.activeYellow || c.stars}`);
            break;
          }
        }

        // Si pas de match exact, chercher l'ID roster qui COMMENCE par le searchName ou vice-versa
        // mais seulement si la différence est petite (éviter "MAGNETO" ⊂ "MAGNETOPHOENIXFORCE")
        if (!rosterChar) {
          for (const c of rosterFull) {
            const rosterId = (c.id || "").replace(/[\s\-_]/g, "").toUpperCase();
            // Le roster ID contient le searchName complet (ex: roster "XMAGNETOPHOENIXFORCE" contient "MAGNETOPHOENIXFORCE")
            if (rosterId.includes(searchName) && searchName.length >= rosterId.length * 0.7) {
              rosterChar = c;
              console.log(`[AutoExclude]   → match partiel roster: id="${c.id}", yellow=${c.yellow || c.activeYellow || c.stars}`);
              break;
            }
          }
        }

        if (!rosterChar) {
          // Log tous les IDs proches pour debug
          const close = rosterFull.filter(c => {
            const rid = (c.id || "").toUpperCase();
            return rid.includes(searchName.substring(0, 6)) || searchName.includes(rid.substring(0, 6));
          });
          console.log(`[AutoExclude]   → PAS trouvé. IDs proches:`, close.map(c => ({ id: c.id, yellow: c.yellow || c.activeYellow || c.stars })));
        }
      }

      if (!rosterChar) {
        // Joueur n'a pas ce personnage du tout
        console.log(`[AutoExclude] ❌ "${req.charName}" → NON RECRUTÉ, on décoche`);
        checkbox.checked = false;
        row.title = `${req.charName} non recruté`;
        excludedCount++;
        return;
      }

      const yellowStars = rosterChar.yellow || rosterChar.activeYellow || rosterChar.stars || 0;
      console.log(`[AutoExclude] "${req.charName}" trouvé: id=${rosterChar.id}, yellow=${yellowStars}, requis=${req.requiredStars}`);

      if (req.requiredStars > 0 && yellowStars < req.requiredStars) {
        console.log(`[AutoExclude] ❌ "${req.charName}" → ${yellowStars}★ < ${req.requiredStars}★ requis, on décoche`);
        checkbox.checked = false;
        row.title = `${req.charName}: ${yellowStars}★ (${req.requiredStars}★ requises)`;
        excludedCount++;
      } else {
        console.log(`[AutoExclude] ✅ "${req.charName}" → OK (${yellowStars}★ >= ${req.requiredStars}★)`);
      }
    });

    if (excludedCount > 0) {
      console.log(`[Events] Auto-exclusion: ${excludedCount} méthodes impossibles basées sur le roster`);
      // Re-déclencher le calcul pour chaque calculateur
      document.querySelectorAll(".calc-tier-select").forEach(select => {
        if (select.value && select.value !== "0") {
          const calcSection = select.closest(".points-calc-section");
          if (calcSection) {
            const idx = calcSection.id.replace("points-calc-", "");
            updatePointsCalculation(idx);
          }
        }
      });
    }
  } catch (e) {
    console.error("[Events] Erreur auto-exclusion roster:", e);
  }
}

/**
 * Génère le HTML du calculateur de points INVERSÉ pour un milestone event
 * L'utilisateur choisit un objectif (palier ou points) et voit combien d'actions sont nécessaires
 * + tracker de rythme (pts/h actuel vs requis)
 */
function renderPointsCalculator(event, idx) {
  if (!event.milestone?.scoring) return "";

  const scoring = event.milestone.scoring;
  const rows = [];

  if (scoring.methods) {
    scoring.methods.forEach((m, i) => {
      rows.push({ desc: translateEventDescription(m.description), rawDesc: m.description || "", points: m.points, cap: null, id: `calc-${idx}-${i}` });
    });
  }
  if (scoring.cappedScorings) {
    scoring.cappedScorings.forEach((cs, ci) => {
      cs.methods.forEach((m, mi) => {
        rows.push({ desc: translateEventDescription(m.description), rawDesc: m.description || "", points: m.points, cap: cs.cap, id: `calc-${idx}-cap-${ci}-${mi}` });
      });
    });
  }

  if (rows.length === 0) return "";

  // Générer les options de paliers si disponible
  const tiers = event.milestone?.tiers || [];
  const hasTiers = tiers.length > 0;
  const maxTierScore = hasTiers ? tiers[tiers.length - 1].endScore : 0;
  const progress = event.milestone?.progress;
  const currentPoints = progress?.points || 0;
  const completedTier = progress?.completedTier || 0;
  const offset = progress?.completionOffset || 0;

  // Pré-sélectionner le prochain palier non complété
  const nextTierIdx = completedTier; // index dans le tableau (tier 10 complété → index 10 = tier 11)
  let tierOptions = '<option value="0">-- Choisir un palier --</option>';
  if (hasTiers) {
    tiers.forEach((tier, i) => {
      const label = `Phase ${tier.tierNum + offset} (${formatNumber(tier.endScore)} pts)`;
      const selected = i === nextTierIdx ? ' selected' : '';
      const completed = i < completedTier ? ' disabled' : '';
      tierOptions += `<option value="${tier.endScore}"${selected}${completed}>${label}</option>`;
    });
  }

  // Stocker données pour le calcul JS (méthodes + timing + progression)
  const methodsData = JSON.stringify(rows.map(r => ({ points: r.points, cap: r.cap, desc: r.desc })));
  const eventData = JSON.stringify({
    startTime: event.startTime,
    endTime: event.endTime,
    currentPoints,
    completedTier,
    offset,
    totalTiers: tiers.length
  });

  let html = `
    <div class="points-calc inverse-calc" data-methods='${methodsData}' data-event='${eventData}'>
      <div class="calc-header">🎯 Planificateur d'objectif</div>

      <div class="calc-objective">
        ${hasTiers ? `
        <div class="calc-objective-row">
          <label>Objectif:</label>
          <select class="calc-tier-select" id="calc-tier-select-${idx}">
            ${tierOptions}
          </select>
        </div>
        <div class="calc-objective-row">
          <label>ou points:</label>
          <input type="number" class="calc-target-pts" id="calc-target-${idx}" min="0" value="" placeholder="Ex: 100000">
          <button class="calc-max-btn" data-max="${maxTierScore}" data-idx="${idx}" title="Palier max: ${formatNumber(maxTierScore)} pts">Max</button>
        </div>
        <div class="calc-max-info">Palier max: ${tiers.length + offset} (${formatNumber(maxTierScore)} pts)</div>
        ` : `
        <div class="calc-objective-row">
          <label>Points cible:</label>
          <input type="number" class="calc-target-pts" id="calc-target-${idx}" min="0" value="" placeholder="Ex: 100000">
        </div>
        <div class="calc-no-tiers">Pas de paliers définis pour cet event</div>
        `}
      </div>

      <div class="pace-tracker-section" id="pace-tracker-${idx}"></div>

      <div class="calc-results-section" id="calc-results-${idx}">
        <div class="calc-results-header">Actions nécessaires:</div>
        <div class="calc-methods-list">
          ${rows.map((r, i) => `
            <div class="calc-method-row" data-points="${r.points}" data-cap="${r.cap || ''}" data-idx="${i}" data-raw-desc="${r.rawDesc.replace(/"/g, '&quot;')}">
              <label class="calc-method-toggle" title="Exclure cette methode si vous ne pouvez pas la realiser">
                <input type="checkbox" class="calc-method-checkbox" data-calc-idx="${idx}" checked>
                <span class="calc-method-check-icon"></span>
              </label>
              <span class="calc-method-name">${r.desc}</span>
              <span class="calc-method-pts">${formatNumber(r.points)} pts/action</span>
              <div class="calc-method-result">
                <span class="calc-method-needed" id="calc-needed-${idx}-${i}">—</span>
                ${r.cap ? `<span class="calc-method-cap">(cap: ${formatNumber(r.cap)} pts)</span>` : '<span class="calc-method-unlimited">∞</span>'}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  return html;
}

/**
 * Met à jour le calcul INVERSÉ des points pour un event
 * Calcule combien d'actions sont nécessaires pour atteindre l'objectif
 */
function updatePointsCalculation(idx) {
  const calcSection = document.querySelector(`#points-calc-${idx}`);
  if (!calcSection) return;

  const calcDiv = calcSection.querySelector(".points-calc");
  const eventData = calcDiv ? JSON.parse(calcDiv.dataset.event || "{}") : {};
  const currentPoints = eventData.currentPoints || 0;

  // Récupérer l'objectif (soit du sélecteur de palier, soit du champ personnalisé)
  const tierSelect = document.getElementById(`calc-tier-select-${idx}`);
  const targetInput = document.getElementById(`calc-target-${idx}`);

  let targetPoints = 0;

  // Priorité au champ personnalisé s'il est rempli
  if (targetInput && targetInput.value && parseInt(targetInput.value) > 0) {
    targetPoints = parseInt(targetInput.value);
  } else if (tierSelect && tierSelect.value && parseInt(tierSelect.value) > 0) {
    targetPoints = parseInt(tierSelect.value);
  }

  // Points restants (cible - points actuels)
  const remainingPoints = Math.max(0, targetPoints - currentPoints);

  // Mettre à jour le tracker de rythme
  updatePaceTracker(idx, targetPoints);

  // Mettre à jour chaque méthode
  const methodRows = calcSection.querySelectorAll(".calc-method-row");
  methodRows.forEach((row, i) => {
    const points = parseInt(row.dataset.points) || 0;
    const cap = row.dataset.cap ? parseInt(row.dataset.cap) : null;
    const neededEl = document.getElementById(`calc-needed-${idx}-${i}`);
    const checkbox = row.querySelector(".calc-method-checkbox");
    const isExcluded = checkbox && !checkbox.checked;

    if (!neededEl) return;

    // Méthode exclue par le joueur
    if (isExcluded) {
      row.classList.add("excluded");
      row.classList.remove("capped", "possible");
      neededEl.textContent = "Exclu";
      neededEl.className = "calc-method-needed excluded";
      return;
    }
    row.classList.remove("excluded");

    if (targetPoints === 0 || points === 0) {
      neededEl.textContent = "—";
      neededEl.className = "calc-method-needed";
      row.classList.remove("capped", "possible");
      return;
    }

    if (remainingPoints <= 0) {
      neededEl.textContent = "Atteint !";
      neededEl.className = "calc-method-needed possible";
      row.classList.add("possible");
      row.classList.remove("capped");
      return;
    }

    // Calculer le nombre d'actions nécessaires pour les points RESTANTS
    const actionsNeeded = Math.ceil(remainingPoints / points);

    // Vérifier si le cap permet d'atteindre l'objectif
    if (cap !== null && cap < remainingPoints) {
      // Le cap est insuffisant pour atteindre l'objectif seul
      const maxActions = Math.ceil(cap / points);
      neededEl.innerHTML = `<span class="capped-warning">⚠️ ${formatNumber(maxActions)} max</span> <span class="cap-note">(${formatNumber(cap)} pts max)</span>`;
      neededEl.className = "calc-method-needed capped";
      row.classList.add("capped");
      row.classList.remove("possible");
    } else {
      // L'objectif est atteignable avec cette méthode seule
      neededEl.textContent = `${formatNumber(actionsNeeded)} actions`;
      neededEl.className = "calc-method-needed possible";
      row.classList.add("possible");
      row.classList.remove("capped");
    }
  });
}

/**
 * Met à jour le tracker de rythme pour un event milestone
 * Affiche pts/h actuel vs requis et estimation de complétion
 */
function updatePaceTracker(idx, targetPoints) {
  const trackerEl = document.getElementById(`pace-tracker-${idx}`);
  if (!trackerEl) return;

  const calcSection = document.querySelector(`#points-calc-${idx}`);
  const calcDiv = calcSection?.querySelector(".points-calc");
  const eventData = calcDiv ? JSON.parse(calcDiv.dataset.event || "{}") : {};

  const { startTime, endTime, currentPoints, completedTier, offset, totalTiers } = eventData;

  // Pas de données de progression → masquer le tracker
  if (!currentPoints && !startTime) {
    trackerEl.innerHTML = "";
    return;
  }

  if (!targetPoints || targetPoints <= 0) {
    trackerEl.innerHTML = "";
    return;
  }

  const now = Date.now() / 1000;
  const hoursElapsed = Math.max(0.1, (now - startTime) / 3600);
  const hoursRemaining = Math.max(0, (endTime - now) / 3600);
  const remainingPoints = Math.max(0, targetPoints - currentPoints);

  // Calculs de rythme
  const currentPace = currentPoints / hoursElapsed;
  const requiredPace = hoursRemaining > 0 ? remainingPoints / hoursRemaining : Infinity;
  const paceRatio = requiredPace > 0 ? currentPace / requiredPace : Infinity;
  const estimatedHours = currentPace > 0 ? remainingPoints / currentPace : Infinity;

  // Progression vers la cible
  const pct = targetPoints > 0 ? Math.min(100, Math.round((currentPoints / targetPoints) * 100)) : 0;

  // Status
  let statusClass, statusIcon, statusText;
  if (remainingPoints <= 0) {
    statusClass = "pace-achieved";
    statusIcon = "✅";
    statusText = "Objectif atteint !";
  } else if (paceRatio >= 1.0) {
    statusClass = "pace-ahead";
    statusIcon = "✅";
    statusText = `En avance (x${paceRatio.toFixed(1)})`;
  } else if (paceRatio >= 0.7) {
    statusClass = "pace-warning";
    statusIcon = "⚠️";
    statusText = `Attention (x${paceRatio.toFixed(1)})`;
  } else {
    statusClass = "pace-behind";
    statusIcon = "🔴";
    statusText = `En retard (x${paceRatio.toFixed(1)})`;
  }

  // Estimation temps restant
  let estimateText = "";
  if (remainingPoints <= 0) {
    estimateText = "Objectif deja atteint";
  } else if (estimatedHours === Infinity) {
    estimateText = "Impossible a estimer";
  } else if (estimatedHours > hoursRemaining) {
    const deficit = Math.round(estimatedHours - hoursRemaining);
    estimateText = `${deficit}h de retard sur le temps restant`;
  } else {
    estimateText = `Estime dans ~${formatDuration(estimatedHours * 3600)}`;
  }

  trackerEl.innerHTML = `
    <div class="pace-tracker ${statusClass}">
      <div class="pace-progress-row">
        <span class="pace-points">${formatNumber(currentPoints)} / ${formatNumber(targetPoints)} pts</span>
        <span class="pace-pct">${pct}%</span>
      </div>
      <div class="pace-bar-bg">
        <div class="pace-bar" style="width: ${pct}%"></div>
      </div>
      <div class="pace-stats">
        <div class="pace-stat">
          <span class="pace-label">Rythme actuel</span>
          <span class="pace-value">${formatNumber(Math.round(currentPace))} pts/h</span>
        </div>
        <div class="pace-stat">
          <span class="pace-label">Rythme requis</span>
          <span class="pace-value">${requiredPace === Infinity ? "—" : formatNumber(Math.round(requiredPace)) + " pts/h"}</span>
        </div>
      </div>
      <div class="pace-status ${statusClass}">
        <span>${statusIcon} ${statusText}</span>
      </div>
      <div class="pace-estimate">${estimateText}</div>
    </div>
  `;
}

/**
 * Formate une durée en secondes en texte lisible (ex: "4h 20min")
 */
function formatDuration(seconds) {
  if (seconds <= 0) return "0min";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}j ${rh}h`;
  }
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
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
// Panneau Battleworld
// ============================================

// Battleworld teams data — portraits CDN
const BW_CDN = "https://assets.marvelstrikeforce.com/imgs/";
const BW_TEAMS = [
  {
    name: "Astral + Mephisto",
    damage: "~220M",
    members: [
      { name: "Ancient One", img: "Portrait_AncientOne_32dc42bc.png" },
      { name: "Emma Frost X", img: "Portrait_EmmaFrostXMen_ba2875f4.png" },
      { name: "Shadow King", img: "Portrait_ShadowKing_f2c0a430.png" },
      { name: "Mephisto", img: "Portrait_Mephisto_9c8a7c7e.png" }
    ],
    pickOne: [
      { name: "Strange", img: "Portrait_DoctorStrange_28cf96fd.png" },
      { name: "Moondragon", img: "Portrait_Moondragon_e96c50ea.png" }
    ]
  },
  {
    name: "Odin + Vieux Logan + Quasar + Songbird + Black Knight",
    damage: "~190M",
    members: [
      { name: "Odin", img: "Portrait_Odin_c27c7498.png" },
      { name: "Old Man Logan", img: "Portrait_OldManLogan_d9559148.png" },
      { name: "Quasar", img: "Portrait_Quasar_d362039d.png" },
      { name: "Songbird", img: "Portrait_Songbird_8dc4738d.png" },
      { name: "Black Knight", img: "Portrait_BlackKnight_59cd0b2f.png" }
    ]
  },
  {
    name: "Brimstone + Knull + Professor X",
    damage: "~130M",
    members: [
      { name: "Daimon", img: "Portrait_DaimonHellstrom_d20f82b9.png" },
      { name: "Elsa", img: "Portrait_ElsaBloodstone_a0480728.png" },
      { name: "Strange Supreme", img: "Portrait_StrangeSupreme_514d1e83.png" },
      { name: "Knull", img: "Portrait_PVE_Boss_Knull_312e5190.png" },
      { name: "Professor X", img: "Portrait_Xavier_5621f4f9.png" }
    ],
    excluded: [
      { name: "Hellcat", img: "Portrait_Hellcat_78fa897b.png" },
      { name: "Living Mummy", img: "Portrait_LivingMummy_bc04839b.png" }
    ]
  },
  {
    name: "Insidious Six + Green Goblin Classic",
    damage: "~80M",
    members: [
      { name: "Hobgoblin", img: "Portrait_Hobgoblin_87dc6735.png" },
      { name: "Sup. Spider-Man", img: "Portrait_SuperiorSpiderMan_1d666ce8.png" },
      { name: "Green Goblin", img: "Portrait_GreenGoblinGlider_d34c3dcd.png" }
    ],
    excluded: [
      { name: "Scorpion", img: "Portrait_Scorpion_5848a3e7.png" }
    ]
  },
  {
    name: "Fantastic Four MCU",
    damage: "~80M",
    members: [
      { name: "Mr. Fantastic", img: "Portrait_MrFantasticMCU_457897f0.png" },
      { name: "Invisible W.", img: "Portrait_InvisibleWomanMCU_07da6224.png" },
      { name: "Human Torch", img: "Portrait_HumanTorch_c034d13c.png" },
      { name: "The Thing", img: "Portrait_Thing_d513b000.png" },
      { name: "Franklin", img: "Portrait_FranklinRichards_658b845f.png" }
    ]
  },
  {
    name: "Brimstone",
    members: [
      { name: "Daimon", img: "Portrait_DaimonHellstrom_d20f82b9.png" },
      { name: "Elsa", img: "Portrait_ElsaBloodstone_a0480728.png" },
      { name: "Hellcat", img: "Portrait_Hellcat_78fa897b.png" },
      { name: "Living Mummy", img: "Portrait_LivingMummy_bc04839b.png" },
      { name: "Strange Supreme", img: "Portrait_StrangeSupreme_514d1e83.png" }
    ]
  },
  {
    name: "Astral",
    members: [
      { name: "Ancient One", img: "Portrait_AncientOne_32dc42bc.png" },
      { name: "Dr. Strange", img: "Portrait_DoctorStrange_28cf96fd.png" },
      { name: "Emma Frost X", img: "Portrait_EmmaFrostXMen_ba2875f4.png" },
      { name: "Moondragon", img: "Portrait_Moondragon_e96c50ea.png" },
      { name: "Shadow King", img: "Portrait_ShadowKing_f2c0a430.png" }
    ]
  },
  {
    name: "FF MCU + Odin + Mephisto",
    members: [
      { name: "Mr. Fantastic", img: "Portrait_MrFantasticMCU_457897f0.png" },
      { name: "Invisible W.", img: "Portrait_InvisibleWomanMCU_07da6224.png" },
      { name: "Human Torch", img: "Portrait_HumanTorch_c034d13c.png" },
      { name: "The Thing", img: "Portrait_Thing_d513b000.png" },
      { name: "Franklin", img: "Portrait_FranklinRichards_658b845f.png" },
      { name: "Odin", img: "Portrait_Odin_c27c7498.png" },
      { name: "Mephisto", img: "Portrait_Mephisto_9c8a7c7e.png" }
    ]
  },
  {
    name: "Blue Marvel + O.M. Logan + Red Guardian + Iron Fist + Havok",
    members: [
      { name: "Blue Marvel", img: "Portrait_BlueMarvel_9330e29f.png" },
      { name: "Old Man Logan", img: "Portrait_OldManLogan_d9559148.png" },
      { name: "Red Guardian", img: "Portrait_RedGuardian_b4df6ba1.png" },
      { name: "Iron Fist", img: "Portrait_IronFist_723e9bed.png" },
      { name: "Havok", img: "Portrait_Havok_7475eb82.png" }
    ]
  },
  {
    name: "Black Knight + Knull + Omega Red + Emma Frost + Kang",
    members: [
      { name: "Black Knight", img: "Portrait_BlackKnight_59cd0b2f.png" },
      { name: "Knull", img: "Portrait_PVE_Boss_Knull_312e5190.png" },
      { name: "Omega Red", img: "Portrait_OmegaRed_9907edc5.png" },
      { name: "Emma Frost", img: "Portrait_EmmaFrost_0d4c0489.png" },
      { name: "Kang", img: "Portrait_KangTheConqueror_411ede1a.png" }
    ]
  }
];

function renderBattleworldPanel() {
  const container = document.getElementById("bw-teams-container");
  if (!container) return;
  let html = "";
  BW_TEAMS.forEach((team, i) => {
    html += `<div class="bw-team">`;
    html += `<div class="bw-team-header">`;
    html += `<span class="bw-team-name">${team.name}</span>`;
    if (team.damage) html += `<span class="bw-team-dmg">${team.damage}</span>`;
    html += `</div>`;
    html += `<div class="bw-team-portraits">`;
    for (const m of team.members) {
      html += `<div class="bw-portrait"><img src="${BW_CDN}${m.img}" loading="lazy" alt="${m.name}"><span class="bw-portrait-name">${m.name}</span></div>`;
    }
    if (team.pickOne) {
      html += `<span class="bw-pick-separator">+</span>`;
      team.pickOne.forEach((m, j) => {
        if (j > 0) html += `<span class="bw-pick-separator">ou</span>`;
        html += `<div class="bw-portrait"><img src="${BW_CDN}${m.img}" loading="lazy" alt="${m.name}"><span class="bw-portrait-name">${m.name}</span></div>`;
      });
    }
    if (team.excluded) {
      for (const m of team.excluded) {
        html += `<div class="bw-portrait excluded"><img src="${BW_CDN}${m.img}" loading="lazy" alt="${m.name}"><span class="bw-portrait-name">${m.name}</span></div>`;
      }
    }
    html += `</div>`;
    html += `<div class="bw-rank">#${i + 1}</div>`;
    html += `</div>`;
  });
  container.innerHTML = html;
}

btnBattleworld.addEventListener("click", () => {
  battleworldPanel.classList.remove("hidden");
  renderBattleworldPanel();
  battleworldPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

btnCloseBattleworld.addEventListener("click", () => {
  battleworldPanel.classList.add("hidden");
});

// ============================================
// Panneau Synchronisation
// ============================================

btnSettings.addEventListener("click", async () => {
  const wasHidden = syncPanel.classList.contains("hidden");
  syncPanel.classList.remove("hidden");
  apiPanel.classList.add("hidden"); // Fermer l'autre panneau
  syncPanel.scrollIntoView({ behavior: "smooth", block: "start" });

  if (wasHidden) {
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
    if (btnAnalyze) btnAnalyze.disabled = true;
  } else {
    spinner.classList.add("hidden");
    if (btnAnalyze) btnAnalyze.disabled = false;
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
  const wasHidden = apiPanel.classList.contains("hidden");
  apiPanel.classList.remove("hidden");
  syncPanel.classList.add("hidden"); // Fermer l'autre panneau
  apiPanel.scrollIntoView({ behavior: "smooth", block: "start" });

  if (wasHidden) {
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
    // Retirer le highlight setup et masquer la banniere
    btnApi.classList.remove("needs-setup");
    welcomeBanner.classList.add("hidden");
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

/**
 * Convertit un ID API en nom lisible
 * "IRON-MAN" → "Iron Man", "CaptainMarvel" → "Captain Marvel"
 */
function idToDisplayName(id) {
  let name = id.replace(/-/g, " ");
  name = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  name = name.split(" ").map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(" ");
  return name;
}

/**
 * Detecte les personnages du roster absents de characters-full.json
 * et les ajoute dynamiquement dans charactersData + chrome.storage
 */
async function syncNewCharactersFromRoster(rosterFull) {
  if (!rosterFull || rosterFull.length === 0) return;

  if (!charactersData) {
    try {
      const response = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await response.json();
    } catch (e) { return; }
  }

  const chars = charactersData.characters || {};
  const existingIds = new Set(Object.keys(chars).map(k => k.toUpperCase()));

  const stored = await storageGet("msfDynamicCharacters");
  const dynamic = stored.msfDynamicCharacters || {};

  let newCount = 0;
  for (const entry of rosterFull) {
    const rawId = entry.id;
    if (!rawId) continue;
    const normalizedId = rawId.replace(/-/g, "");

    if (existingIds.has(rawId.toUpperCase()) || existingIds.has(normalizedId.toUpperCase())) continue;
    if (dynamic[normalizedId]) continue;

    const displayName = idToDisplayName(rawId);
    dynamic[normalizedId] = {
      name: displayName,
      portrait: null,
      traits: [],
      status: "playable"
    };
    newCount++;
  }

  if (newCount > 0) {
    await storageSet({ msfDynamicCharacters: dynamic });
    Object.assign(chars, dynamic);
    scanRoomCharList = null;
    console.log(`[Sync] ${newCount} nouveaux personnages decouverts depuis le roster`);
  }
}

// Bouton Get Squads (+ Roster complet)
/**
 * Recupere squads + roster depuis l'API et sauvegarde dans le storage.
 * Reutilisable depuis n'importe quel panel.
 * Retourne { success, tabs, playerRosterIds, playerRosterFull, error }
 */
async function fetchSquadsAndRoster() {
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

  let playerRosterIds;
  let playerRosterFull = null;

  if (rosterResult.roster && rosterResult.roster.length > 0) {
    playerRosterIds = rosterResult.roster;
    playerRosterFull = rosterResult.rosterFull;
  } else {
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
  }

  await storageSet({
    msfPlayerRoster: playerRosterIds,
    msfPlayerRosterFull: playerRosterFull,
    msfWarSquads: tabs.war,
    msfSquadsUpdatedAt: new Date().toISOString()
  });

  // Detecter nouveaux personnages non connus dans characters-full.json
  await syncNewCharactersFromRoster(playerRosterFull);

  return { tabs, playerRosterIds, playerRosterFull, rosterError: rosterResult.error };
}

const btnGetSquads = document.getElementById("btn-get-squads");
const squadsResult = document.getElementById("squads-result");
if (btnGetSquads) {
  btnGetSquads.addEventListener("click", async () => {
    setApiStatus("Récupération des données...", "");
    squadsResult.textContent = "";
    btnGetSquads.disabled = true;

    try {
      const result = await fetchSquadsAndRoster();
      const tabs = result.tabs;

      let output = [];

      if (tabs.raids.length > 0) {
        output.push("=== RAIDS ===");
        tabs.raids.forEach((squad, i) => {
          output.push(`${i + 1}. ${squad.filter(n => n).join(", ")}`);
        });
      }
      if (tabs.arena.length > 0) {
        output.push("\n=== ARENA ===");
        tabs.arena.forEach((squad, i) => {
          output.push(`${i + 1}. ${squad.filter(n => n).join(", ")}`);
        });
      }
      if (tabs.war.length > 0) {
        output.push(`\n=== WAR (${tabs.war.length}) ===`);
      }

      if (result.rosterError) {
        output.push(`\n⚠️ Roster complet: ${result.rosterError}`);
      }

      if (result.playerRosterFull) {
        output.push(`\n=== ROSTER COMPLET ===`);
        output.push(`${result.playerRosterIds.length} personnages possédés`);
        const under7 = result.playerRosterFull.filter(c => (c.yellow || c.stars || 0) < 7).length;
        output.push(`${under7} personnages < 7★ jaunes`);
      } else {
        output.push(`\n=== ROSTER (depuis squads) ===`);
        output.push(`${result.playerRosterIds.length} personnages (partiel)`);
      }

      setApiStatus(`${tabs.raids.length} RAID, ${tabs.arena.length} Arena, ${result.playerRosterIds.length} personnages`, "success");
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
  const wasHidden = warPanel.classList.contains("hidden");
  warPanel.classList.remove("hidden");
  syncPanel.classList.add("hidden");
  apiPanel.classList.add("hidden");
  warPanel.scrollIntoView({ behavior: "smooth", block: "start" });

  if (wasHidden) {
    warResult.classList.add("hidden");
  }
});

btnCloseWar.addEventListener("click", () => {
  warPanel.classList.add("hidden");
  // Restaurer les panneaux caches par le scan salle
  if (typeof restoreWarPanelUI === "function") restoreWarPanelUI();
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

// Verifier si une calibration zones custom existe
(async function checkZoneCalibrationStatus() {
  try {
    const result = await storageGet("msfCustomZoneCalibration");
    const calib = result.msfCustomZoneCalibration;
    const statusEl = document.getElementById("zone-calib-status");
    const resetBtn = document.getElementById("btn-reset-calibration");
    const langSelect = document.getElementById("scan-lang-override");

    if (calib && calib.slots && calib.slots.custom) {
      const date = calib.savedAt ? new Date(calib.savedAt).toLocaleDateString() : "?";
      const res = calib.reference?.calibratedAt || "?";
      if (statusEl) {
        statusEl.textContent = `Calibration perso active (${date}, ${res})`;
        statusEl.style.color = "#51cf66";
      }
      if (langSelect && !langSelect.querySelector('option[value="custom"]')) {
        const opt = document.createElement("option");
        opt.value = "custom";
        opt.textContent = "Custom";
        langSelect.appendChild(opt);
      }
      if (resetBtn) resetBtn.style.display = "";
    }
  } catch (e) {
    console.log("[Popup] Pas de calibration zones:", e);
  }
})();

// Reset calibration zones personnalisees
document.getElementById("btn-reset-calibration")?.addEventListener("click", async () => {
  if (!confirm("Supprimer la calibration personnalisee et revenir aux zones par defaut ?")) return;
  try {
    await ext.storage.local.remove("msfCustomZoneCalibration");
    const langSelect = document.getElementById("scan-lang-override");
    const customOpt = langSelect?.querySelector('option[value="custom"]');
    if (customOpt) {
      if (langSelect.value === "custom") langSelect.value = "auto";
      customOpt.remove();
    }
    const statusEl = document.getElementById("zone-calib-status");
    if (statusEl) {
      statusEl.textContent = "Calibration supprimee — zones par defaut";
      statusEl.style.color = "#888";
    }
    document.getElementById("btn-reset-calibration").style.display = "none";
    console.log("[Calibration] Custom zones supprimees");
  } catch (e) {
    console.error("[Calibration] Erreur reset:", e);
  }
});

// ============================================
// War Mode - Scan Salle (4 equipes)
// ============================================

/**
 * Charge une image depuis un dataUrl
 */
function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Supprime les accents d'une chaine (e, e, a, u, c → e, e, a, u, c)
function stripAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// --- Scan Salle : etat global ---
let scanRoomState = null; // { teams: [{slotNumber, portraits: [{dataUrl, hue, hash, charId, name, learned}]}] }
const scanCountersData = {}; // Cache pour re-tri: { [teamIdx]: { enriched, hasRoster, enemyPower } }
let scanRoomCharList = null; // [{charId, name}] pour autocomplete
let scanRoomTeamList = null; // [{id, name, nameFr, memberIds, searchText}] pour recherche par equipe

async function getScanCharacterList() {
  if (scanRoomCharList) return scanRoomCharList;
  if (!charactersData) {
    try {
      const response = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await response.json();
    } catch (e) { /* ignore */ }
  }

  // Merger les persos dynamiques decouverts depuis le roster
  try {
    const dynStored = await storageGet("msfDynamicCharacters");
    if (dynStored.msfDynamicCharacters) {
      const chars = charactersData?.characters || {};
      Object.assign(chars, dynStored.msfDynamicCharacters);
    }
  } catch (e) { /* ignore */ }

  const chars = charactersData?.characters || charactersData || {};

  // Charger les noms FR depuis ocr-names.json (nameToId contient les mappings FR -> charId)
  let frNames = {}; // charId -> nom FR
  try {
    const ocrRes = await fetch(ext.runtime.getURL("data/ocr-names.json"));
    const ocrData = await ocrRes.json();
    if (ocrData.nameToId) {
      // Inverser: pour chaque nom FR, trouver le charId et garder le plus court (le plus naturel)
      for (const [name, charId] of Object.entries(ocrData.nameToId)) {
        const upperCharId = charId.toUpperCase();
        // Trouver le vrai charId (case-insensitive)
        const realCharId = Object.keys(chars).find(k => k.toUpperCase() === upperCharId);
        if (realCharId) {
          const enName = chars[realCharId]?.name?.toUpperCase();
          // Ne garder que si c'est different du nom anglais (c'est un alias FR)
          if (enName && name !== enName) {
            // Garder le nom FR le plus court pour ce charId (plus naturel)
            if (!frNames[realCharId] || name.length < frNames[realCharId].length) {
              // Mettre en title case
              frNames[realCharId] = name.split(" ").map(w =>
                w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
              ).join(" ");
            }
          }
        }
      }
    }
  } catch (e) { /* ignore */ }

  scanRoomCharList = Object.entries(chars)
    .filter(([id, data]) => data.status === "playable")
    .map(([id, data]) => ({
      charId: id,
      name: data.name,
      portrait: data.portrait || null,
      nameFr: frNames[id] || null,
      searchText: stripAccents(((data.name || "") + " " + (frNames[id] || "")).toLowerCase())
    })).sort((a, b) => a.name.localeCompare(b.name));

  // Charger les equipes pour recherche par nom d'equipe
  try {
    const teamsRes = await fetch(ext.runtime.getURL("data/teams.json"));
    const teamsData = await teamsRes.json();
    scanRoomTeamList = (teamsData.teams || []).map(t => ({
      id: t.id,
      name: t.name,
      nameFr: t.nameFr || null,
      memberIds: t.memberIds || [],
      searchText: stripAccents(((t.name || "") + " " + (t.nameFr || "")).toLowerCase())
    }));
  } catch (e) { scanRoomTeamList = []; }

  console.log(`[ScanSalle] ${scanRoomCharList.length} persos, ${scanRoomTeamList.length} equipes, ${Object.keys(frNames).length} noms FR`);
  return scanRoomCharList;
}

/**
 * Capture l'onglet cible directement depuis le popup (evite les problemes de permissions bg.js)
 */
async function captureTargetTab() {
  // Chercher l'onglet MSF ou debug
  let tabs = await ext.tabs.query({ url: ["*://*.marvelstrikeforce.com/*", "*://*.scopelypv.com/*", "*://*.scopely.io/*"] });
  if (tabs.length === 0) {
    tabs = await ext.tabs.query({ url: ["http://localhost:*/*", "file:///*msf-ocr-hud/debug/*"] });
  }
  if (tabs.length === 0) {
    // Fallback : onglet actif de la derniere fenetre non-extension
    const allWindows = await ext.windows.getAll({ windowTypes: ["normal"] });
    for (const win of allWindows) {
      const winTabs = await ext.tabs.query({ active: true, windowId: win.id });
      if (winTabs.length > 0 && !winTabs[0].url?.startsWith("moz-extension://") && !winTabs[0].url?.startsWith("chrome-extension://")) {
        tabs = winTabs;
        break;
      }
    }
  }
  if (tabs.length === 0) throw new Error("Aucun onglet cible");
  const dataUrl = await ext.tabs.captureVisibleTab(tabs[0].windowId, { format: "png" });
  return dataUrl;
}

/**
 * File picker fallback quand captureVisibleTab echoue (Firefox mode fenetre)
 */
function pickScreenshotFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Retourne la derniere position de zones utilisee, ou "position1" par defaut.
 * @returns {Promise<string>} "position1" ou "position2"
 */
async function detectZonePosition() {
  try {
    const stored = await ext.storage.local.get("msfZonePosition");
    if (stored.msfZonePosition) {
      console.log(`[ScanSalle] Position depuis storage: ${stored.msfZonePosition}`);
      return stored.msfZonePosition;
    }
  } catch(e) {}

  console.log("[ScanSalle] Fallback position1");
  return "position1";
}

/**
 * Scan de la salle War : capture, decoupe 4 equipes, identifie via DB apprise puis CDN
 */
async function handleScanSalle(debugMode = false) {
  showWarResult("Capture de la salle en cours...", "");

  let screenshotDataUrl;
  try {
    // Essayer capture directe depuis le popup (meilleur contexte permissions)
    screenshotDataUrl = await captureTargetTab();
  } catch (e1) {
    try {
      // Fallback via background script
      const response = await ext.runtime.sendMessage({ type: "MSF_CAPTURE_TAB" });
      if (!response || response.error || !response.dataUrl) throw new Error(response?.error);
      screenshotDataUrl = response.dataUrl;
    } catch (e2) {
      // Dernier recours : file picker
      showWarResult("Capture impossible — selectionner un screenshot...", "");
      screenshotDataUrl = await pickScreenshotFile();
      if (!screenshotDataUrl) throw new Error("Aucun fichier selectionne");
    }
  }

  showWarResult("Decoupe des 4 equipes...", "");

  const img = await loadImageFromDataUrl(screenshotDataUrl);
  const configUrl = ext.runtime.getURL("msf-zones-config.json") + "?t=" + Date.now();
  const cropper = await ZoneCropper.loadConfigWithStorage(configUrl, storageGet);

  // Selectionner la position de zones
  const posOverride = document.getElementById("scan-lang-override")?.value;
  let zonePos;
  if (posOverride === "custom") {
    zonePos = "custom";
  } else if (posOverride && posOverride !== "auto") {
    zonePos = posOverride;
  } else {
    zonePos = await detectZonePosition();
    // Si pas de preset pour cette position mais calibration custom dispo → utiliser custom
    if (!cropper.slotsByLang[zonePos] && cropper.slotsByLang["custom"]) {
      zonePos = "custom";
    }
  }
  cropper.setLanguage(zonePos);
  // Sauvegarder la position choisie pour les prochains scans
  if (zonePos !== "custom") {
    try { ext.storage.local.set({ msfZonePosition: zonePos }); } catch(e) {}
  }
  console.log(`[ScanSalle] Screenshot: ${img.naturalWidth}x${img.naturalHeight} (ratio ${(img.naturalWidth/img.naturalHeight).toFixed(3)}, ref ${cropper.referenceAspect.toFixed(3)}, pos ${zonePos})`);

  const slots = cropper.extractAllSlots(img);

  if (debugMode) { displayScanDebug(screenshotDataUrl, slots, cropper); return; }

  if (!warAnalyzer) { warAnalyzer = new WarAnalyzer(); await warAnalyzer.init(); }
  if (!warAnalyzer.learnedDb) await warAnalyzer.loadLearnedPortraits();

  // Preparer la liste de persos pour autocomplete
  await getScanCharacterList();

  showWarResult("Identification des portraits...", "");

  // OCR direct dans le popup (Tesseract + OCREngine charges dans popup.html)
  let ocrEngine = null;
  try {
    ocrEngine = new OCREngine();
    await ocrEngine.init();
    console.log("[ScanSalle] OCR engine pret (popup direct)");
  } catch (e) {
    console.error("[ScanSalle] OCR engine init echoue:", String(e), e);
    ocrEngine = null;
  }

  scanRoomState = { teams: [] };

  for (const slot of slots) {
    const team = { slotNumber: slot.slotNumber, portraits: [], underAttack: false, enemyPower: null };

    // Detecter le filtre rouge "under attack" sur la zone team_full
    const isUnderAttack = await warAnalyzer.detectRedFilter(slot.team_full);
    if (isUnderAttack) {
      team.underAttack = true;
      console.log(`[ScanSalle] Equipe ${slot.slotNumber}: UNDER ATTACK — skip identification`);
      // Garder les portraits bruts mais sans identification
      for (let i = 0; i < slot.portraits.length; i++) {
        team.portraits.push({
          dataUrl: slot.portraits[i],
          hue: null, hash: null,
          charId: null, name: null,
          similarity: 0, learned: false
        });
      }
      scanRoomState.teams.push(team);
      continue;
    }

    // OCR du power ennemi directement dans le popup
    if (ocrEngine && (slot.team_power || slot.team_full)) {
      try {
        const powerStrip = slot.team_power;
        const powerImage = await cropRightHalf(powerStrip);
        console.log(`[ScanSalle] E${slot.slotNumber} OCR direct (image ${powerImage.length} chars)...`);
        const ocrResult = await ocrEngine.extractPowerWithDebug(powerImage);
        team.enemyPower = ocrResult?.power || null;
        console.log(`[ScanSalle] E${slot.slotNumber} power OCR: ${team.enemyPower || 'non lu'}${ocrResult?.rawText ? ' (raw: "' + ocrResult.rawText + '")' : ''}`);
      } catch (e) {
        console.log(`[ScanSalle] E${slot.slotNumber} OCR echoue:`, String(e));
      }
    } else {
      console.log(`[ScanSalle] E${slot.slotNumber} OCR skip: ocrEngine=${!!ocrEngine}, team_power=${!!slot.team_power}`);
    }

    for (let i = 0; i < slot.portraits.length; i++) {
      const dataUrl = slot.portraits[i];

      // Detecter portrait elimine (croix rouge X)
      const isDefeated = await warAnalyzer.detectDefeatedPortrait(dataUrl);
      if (isDefeated) {
        team.portraits.push({
          dataUrl,
          hue: null, hash: null,
          charId: null, name: null,
          similarity: 0, learned: false,
          defeated: true
        });
        continue;
      }

      const hueHist = await warAnalyzer.computeHueHistogram(dataUrl);
      const hash = await warAnalyzer.computePortraitHash(dataUrl);

      // DB apprise d'abord (meme rendu = fiable), puis CDN (best effort)
      let match = warAnalyzer.findLearnedMatch(hueHist, hash);
      if (!match) {
        match = warAnalyzer.findCombinedMatch(hueHist, hash, 70, 2.0);
      }

      team.portraits.push({
        dataUrl,
        hue: hueHist,
        hash: hash,
        charId: match?.charId || null,
        name: match?.name || null,
        similarity: match?.similarity || 0,
        learned: match?.method === "learned"
      });
    }

    scanRoomState.teams.push(team);
  }

  // --- Etape team-aware : re-matcher les inconnus + les faux positifs ---
  for (const team of scanRoomState.teams) {
    if (team.underAttack) continue; // Skip equipes under attack
    const knownIds = team.portraits.filter(p => p.charId).map(p => p.charId);
    if (knownIds.length < 2) continue; // Pas assez pour deviner l'equipe

    const teamResult = warAnalyzer._identifyTeamFromCharIds(knownIds);
    if (!teamResult.team || !teamResult.team.memberIds) continue;

    const memberSet = new Set(teamResult.team.memberIds.map(id => id.toUpperCase()));
    // Portraits deja identifies comme membres de l'equipe
    const confirmedIds = new Set(
      team.portraits.filter(p => p.charId && memberSet.has(p.charId.toUpperCase())).map(p => p.charId.toUpperCase())
    );
    // Membres de l'equipe pas encore confirmes
    const remainingMembers = teamResult.team.memberIds.filter(id => !confirmedIds.has(id.toUpperCase()));
    if (remainingMembers.length === 0) continue;

    // Portraits a re-matcher : inconnus OU identifies comme non-membres de l'equipe
    // SAUF si le match learned est tres fiable (>= 90%) — on ne remplace pas un 100%
    const toRematch = team.portraits.filter(p =>
      (!p.charId || !memberSet.has(p.charId.toUpperCase())) && !(p.learned && p.similarity >= 90)
    );
    if (toRematch.length === 0) continue;

    const unknownCount = toRematch.filter(p => !p.charId).length;
    const wrongCount = toRematch.length - unknownCount;
    console.log(`[ScanSalle] Equipe ${team.slotNumber}: ${teamResult.team.name} (${teamResult.matchCount}/5) — re-match ${unknownCount} inconnu(s) + ${wrongCount} non-membre(s) contre ${remainingMembers.length} membre(s) restant(s)`);

    for (const portrait of toRematch) {
      const match = warAnalyzer.findLearnedMatch(portrait.hue, portrait.hash, {
        filterCharIds: remainingMembers,
        threshold: 65
      });
      if (match) {
        const oldName = portrait.name || "?";
        portrait.charId = match.charId;
        portrait.name = match.name;
        portrait.similarity = match.similarity;
        portrait.learned = false; // marquer comme guess (orange)
        // Retirer ce membre des candidats restants pour eviter les doublons
        const idx = remainingMembers.findIndex(id => id.toUpperCase() === match.charId.toUpperCase());
        if (idx >= 0) remainingMembers.splice(idx, 1);
        console.log(`[ScanSalle] Team-aware: ${oldName} → ${match.name} (${match.similarity}%)`);
      }
    }
  }

  // Liberer le worker OCR
  if (ocrEngine) {
    ocrEngine.terminate().catch(() => {});
  }

  renderScanRoomResults();
}

/**
 * Affiche les resultats du scan salle avec portraits editables
 */
// Retourne le nom FR d'un charId si disponible, sinon le nom EN
function getDisplayName(charId, fallbackName) {
  if (!charId) return fallbackName || "?";
  const c = scanRoomCharList?.find(ch => ch.charId === charId);
  return c?.nameFr || c?.name || fallbackName || charId;
}

function renderScanRoomResults() {
  if (!scanRoomState) return;

  // Cacher les controles du war panel pour nettoyer l'ecran
  const warTabs = document.querySelector(".war-tabs");
  const warPortrait = document.getElementById("war-portrait-mode");
  const warManual = document.getElementById("war-manual-mode");
  const warPower = document.getElementById("war-power-section");
  const warStats = document.getElementById("war-stats-mode");
  if (warTabs) warTabs.classList.add("hidden");
  if (warPortrait) warPortrait.classList.add("hidden");
  if (warManual) warManual.classList.add("hidden");
  if (warPower) warPower.classList.add("hidden");
  if (warStats) warStats.classList.add("hidden");

  const learnedCount = warAnalyzer?.learnedDb ? Object.keys(warAnalyzer.learnedDb).length : 0;

  let html = `<div class="scan-room-results">`;
  html += `<div class="scan-room-header">`;
  html += `<div class="scan-room-summary">${learnedCount} perso${learnedCount > 1 ? 's' : ''} appris — cliquer les portraits pour corriger</div>`;
  if (learnedCount > 0) {
    html += `<button class="scan-room-btn-export" id="btn-export-learned" title="Copier les portraits appris dans le presse-papier">Exporter</button>`;
  }
  html += `</div>`;

  for (let t = 0; t < scanRoomState.teams.length; t++) {
    const team = scanRoomState.teams[t];

    // Equipe sous attaque : affichage simplifie sans identification
    if (team.underAttack) {
      html += `<div class="scan-room-card scan-room-card-attack" data-team="${t}">`;
      html += `<div class="scan-room-card-title">Equipe ${team.slotNumber} — <span style="color:#ff4444">UNDER ATTACK</span></div>`;
      html += `<div class="scan-room-portraits-row">`;
      for (let p = 0; p < team.portraits.length; p++) {
        html += `<div class="scan-room-portrait-slot" data-team="${t}" data-portrait="${p}">`;
        html += `<img src="${team.portraits[p].dataUrl}" class="scan-room-portrait-img attack">`;
        html += `<div class="scan-room-portrait-name empty">-</div>`;
        html += `</div>`;
      }
      html += `</div>`;
      html += `<div class="scan-room-team-actions"><span class="scan-room-hint" style="color:#ff6666">Equipe en cours d'attaque — identification ignoree</span></div>`;
      html += `</div>`;
      continue;
    }

    const identifiedNames = team.portraits.filter(p => p.name).map(p => p.name);

    html += `<div class="scan-room-card" data-team="${t}">`;
    html += `<div class="scan-room-card-title">Equipe ${team.slotNumber}</div>`;

    // 5 portraits en ligne
    html += `<div class="scan-room-portraits-row">`;
    for (let p = 0; p < team.portraits.length; p++) {
      const portrait = team.portraits[p];
      const isDefeated = portrait.defeated;
      const isLearned = portrait.learned;
      const isGuessed = portrait.charId && !portrait.learned;
      const stateClass = isDefeated ? "defeated" : (isLearned ? "learned" : (isGuessed ? "guessed" : ""));

      html += `<div class="scan-room-portrait-slot" data-team="${t}" data-portrait="${p}">`;
      html += `<img src="${portrait.dataUrl}" class="scan-room-portrait-img ${stateClass}">`;
      const fullName = isDefeated ? "Elimine" : getDisplayName(portrait.charId, portrait.name);
      html += `<div class="scan-room-portrait-name ${portrait.name || isDefeated ? '' : 'empty'}" title="${fullName}">${fullName}</div>`;
      html += `</div>`;
    }
    html += `</div>`;

    // Zone de recherche (cachee, apparait au clic sur un portrait)
    html += `<div class="scan-room-search hidden" id="search-${t}">`;
    html += `<div class="scan-room-search-bar">`;
    html += `<input type="text" class="scan-room-search-input" id="search-input-${t}" placeholder="Rechercher un personnage..." autocomplete="off">`;
    html += `<button class="scan-room-search-close" data-team="${t}">X</button>`;
    html += `</div>`;
    html += `<div class="scan-room-search-results" id="search-results-${t}"></div>`;
    html += `</div>`;

    // Actions : bouton counters + input power (pre-rempli par OCR, editable)
    html += `<div class="scan-room-team-actions">`;
    if (identifiedNames.length >= 3) {
      const ocrPower = team.enemyPower ? team.enemyPower.toLocaleString() : "";
      html += `<input type="text" class="scan-room-power-input" id="power-input-${t}" data-team="${t}" value="${ocrPower}" placeholder="Power ennemi" title="Power ennemi (OCR auto, editable)">`;
      html += `<button class="scan-room-btn-counters" data-team="${t}">Chercher counters</button>`;
    } else {
      html += `<span class="scan-room-hint">${identifiedNames.length}/5 identifie${identifiedNames.length > 1 ? 's' : ''}</span>`;
    }
    html += `</div>`;

    // Zone counters (remplie apres lookup)
    html += `<div class="scan-room-counters-zone hidden" id="counters-${t}"></div>`;

    html += `</div>`; // fin card
  }

  html += `</div>`;

  warResult.innerHTML = html;
  warResult.classList.remove("hidden");

  // --- Event listeners ---
  setupScanRoomListeners();
}

function setupScanRoomListeners() {
  // Clic sur portrait : ouvrir recherche (ou confirmer si guessed + double-clic)
  document.querySelectorAll(".scan-room-portrait-slot").forEach(slot => {
    slot.addEventListener("dblclick", async (e) => {
      e.stopPropagation();
      const t = parseInt(slot.dataset.team);
      const p = parseInt(slot.dataset.portrait);
      const portrait = scanRoomState?.teams[t]?.portraits[p];
      // Double-clic sur un portrait orange (guessed) = confirmer et apprendre
      if (portrait && portrait.charId && !portrait.learned) {
        await selectCharacterForPortrait(t, p, portrait.charId, portrait.name);
      }
    });
    slot.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = parseInt(slot.dataset.team);
      const p = parseInt(slot.dataset.portrait);
      openPortraitSearch(t, p);
    });
  });

  // Fermer recherche
  document.querySelectorAll(".scan-room-search-close").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = parseInt(btn.dataset.team);
      closePortraitSearch(t);
    });
  });

  // Input recherche
  document.querySelectorAll(".scan-room-search-input").forEach(input => {
    input.addEventListener("input", (e) => {
      const t = parseInt(input.dataset?.team || input.id.replace("search-input-", ""));
      filterCharacterSearch(t, input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const t = parseInt(input.dataset?.team || input.id.replace("search-input-", ""));
        const resultsDiv = document.getElementById(`search-results-${t}`);
        const items = resultsDiv?.querySelectorAll(".scan-room-search-item");
        if (items && items.length === 1) {
          items[0].click();
        }
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const nextPort = findNextUnidentifiedPortrait(activeSearchTeam, activeSearchPortrait);
        if (nextPort) {
          openPortraitSearch(nextPort.teamIdx, nextPort.portraitIdx);
        }
      }
    });
  });

  // Bouton counters
  document.querySelectorAll(".scan-room-btn-counters").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = parseInt(btn.dataset.team);
      lookupTeamCounters(t);
    });
  });

  // Bouton export portraits appris (dans scan room results)
  const btnExport = document.getElementById("btn-export-learned");
  if (btnExport) {
    btnExport.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const result = await ext.storage.local.get("learnedPortraits");
        const userPortraits = result.learnedPortraits || {};
        const count = Object.keys(userPortraits).length;
        const exportData = {
          description: "Portraits appris partages - generes depuis les corrections utilisateur",
          version: 1,
          generatedAt: new Date().toISOString(),
          count,
          portraits: userPortraits
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `msf-portraits-${count}p-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        btnExport.textContent = `${count} exportes !`;
        setTimeout(() => { btnExport.textContent = "Exporter"; }, 2000);
      } catch (err) {
        btnExport.textContent = "Erreur";
        setTimeout(() => { btnExport.textContent = "Exporter"; }, 2000);
      }
    });
  }
}

let activeSearchTeam = -1;
let activeSearchPortrait = -1;

function openPortraitSearch(teamIdx, portraitIdx) {
  // Fermer toute recherche ouverte
  document.querySelectorAll(".scan-room-search").forEach(s => s.classList.add("hidden"));

  activeSearchTeam = teamIdx;
  activeSearchPortrait = portraitIdx;

  const searchDiv = document.getElementById(`search-${teamIdx}`);
  const input = document.getElementById(`search-input-${teamIdx}`);
  if (searchDiv && input) {
    searchDiv.classList.remove("hidden");
    input.value = "";
    input.focus();
    filterCharacterSearch(teamIdx, "");
  }
}

function closePortraitSearch(teamIdx) {
  const searchDiv = document.getElementById(`search-${teamIdx}`);
  if (searchDiv) searchDiv.classList.add("hidden");
  activeSearchTeam = -1;
  activeSearchPortrait = -1;
}

/**
 * Trouve le prochain portrait non identifie : d'abord dans la meme equipe, puis les suivantes
 */
function findNextUnidentifiedPortrait(teamIdx, portraitIdx) {
  if (!scanRoomState) return null;
  // Meme equipe, portraits suivants
  const team = scanRoomState.teams[teamIdx];
  if (team) {
    for (let i = portraitIdx + 1; i < team.portraits.length; i++) {
      if (!team.portraits[i].charId) return { teamIdx, portraitIdx: i };
    }
  }
  // Equipes suivantes
  for (let t = teamIdx + 1; t < scanRoomState.teams.length; t++) {
    const nextTeam = scanRoomState.teams[t];
    for (let i = 0; i < nextTeam.portraits.length; i++) {
      if (!nextTeam.portraits[i].charId) return { teamIdx: t, portraitIdx: i };
    }
  }
  return null;
}

function filterCharacterSearch(teamIdx, query) {
  const resultsDiv = document.getElementById(`search-results-${teamIdx}`);
  if (!resultsDiv || !scanRoomCharList) return;

  const q = stripAccents(query.trim().toLowerCase());
  let html = "";

  // Recherche par equipe si query non vide
  if (q.length > 0 && scanRoomTeamList) {
    const matchedTeams = scanRoomTeamList.filter(t => t.searchText.includes(q));
    for (const team of matchedTeams) {
      html += `<div class="scan-room-search-team-header">${team.name}${team.nameFr && team.nameFr !== team.name ? ` <span class="scan-room-search-fr">${team.nameFr}</span>` : ""}</div>`;
      for (const memberId of team.memberIds) {
        const c = scanRoomCharList.find(ch => ch.charId === memberId);
        if (c) {
          const memberDisplayName = c.nameFr || c.name;
          const portraitImg = c.portrait ? `<img class="scan-room-search-portrait" src="${c.portrait}" loading="lazy" alt="">` : `<div class="scan-room-search-portrait scan-room-search-portrait-empty"></div>`;
          html += `<div class="scan-room-search-item scan-room-search-team-member" data-char-id="${c.charId}" data-char-name="${memberDisplayName}">${portraitImg}<span class="scan-room-search-name">${memberDisplayName}</span></div>`;
        }
      }
    }
    if (matchedTeams.length > 0) {
      html += `<div class="scan-room-search-separator"></div>`;
    }
  }

  // Personnages individuels
  const filtered = q.length === 0
    ? scanRoomCharList
    : scanRoomCharList.filter(c => c.searchText.includes(q));

  for (const c of filtered) {
    const isLearned = warAnalyzer?.learnedDb?.[c.charId] ? " *" : "";
    const displayName = c.nameFr || c.name;
    const altName = c.nameFr ? `<span class="scan-room-search-fr">${c.name}</span>` : "";
    const portraitImg = c.portrait ? `<img class="scan-room-search-portrait" src="${c.portrait}" loading="lazy" alt="">` : `<div class="scan-room-search-portrait scan-room-search-portrait-empty"></div>`;
    html += `<div class="scan-room-search-item" data-char-id="${c.charId}" data-char-name="${displayName}">${portraitImg}<span class="scan-room-search-name">${displayName}${altName}${isLearned}</span></div>`;
  }
  if (filtered.length === 0 && html === "") {
    html = `<div class="scan-room-search-empty">Aucun resultat</div>`;
  }

  resultsDiv.innerHTML = html;

  // Clic sur un resultat
  resultsDiv.querySelectorAll(".scan-room-search-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const charId = item.dataset.charId;
      const name = item.dataset.charName;
      selectCharacterForPortrait(activeSearchTeam, activeSearchPortrait, charId, name);
    });
  });
}

async function selectCharacterForPortrait(teamIdx, portraitIdx, charId, name) {
  if (!scanRoomState || teamIdx < 0 || portraitIdx < 0) return;

  const portrait = scanRoomState.teams[teamIdx].portraits[portraitIdx];
  portrait.charId = charId;
  portrait.name = name;
  portrait.learned = true;

  // Sauvegarder dans la DB apprise pour les prochains scans
  if (warAnalyzer) {
    if (!portrait.hue || !portrait.hash) {
      console.warn(`[ScanSalle] ATTENTION: portrait ${charId} sans features! hue=${!!portrait.hue} hash=${!!portrait.hash}`);
    }
    await warAnalyzer.saveLearnedPortrait(charId, name, portrait.hue, portrait.hash);
  }

  closePortraitSearch(teamIdx);

  // Re-render complet (met a jour noms, indicateurs, bouton counters)
  renderScanRoomResults();
}

// Cache roster pour eviter de relire le storage a chaque counter
let _rosterMapCache = null;

async function getTeamPowerFromRoster(teamId) {
  if (!_rosterMapCache) {
    const stored = await storageGet("msfPlayerRosterFull");
    const roster = stored.msfPlayerRosterFull;
    if (!roster || roster.length === 0) return null;
    _rosterMapCache = {};
    roster.forEach(c => { _rosterMapCache[(c.id || "").toUpperCase()] = c; });
  }

  const team = (warAnalyzer?.teamsData || []).find(t => t.id === teamId);
  if (!team || !team.memberIds) return null;

  let total = 0, found = 0;
  for (const mid of team.memberIds) {
    const r = _rosterMapCache[mid.toUpperCase()];
    if (r && r.power) { total += r.power; found++; }
  }
  const result = found >= 3 ? total : null;
  console.log(`[Punch] ${teamId}: ${found}/${team.memberIds.length} persos, power total = ${result || 'N/A'}`);
  return result;
}

/**
 * Crop la bande du haut d'une image (zone power au-dessus des portraits)
 * @param {string} dataUrl - Data URL de l'image source (team_full)
 * @param {number} [topPct=0.15] - Pourcentage du haut a garder (0-1)
 * @returns {Promise<string>} Data URL de la zone croppee
 */
function cropTopStrip(dataUrl, topPct = 0.15) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const cropH = Math.floor(img.height * topPct);
      canvas.width = img.width;
      canvas.height = cropH;
      ctx.drawImage(img, 0, 0, img.width, cropH, 0, 0, img.width, cropH);
      resolve(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  });
}

/**
 * Crop la moitie droite d'une image (zone power sans le numero de slot ni les points)
 * Le strip power contient : [N° slot] [+XX points] [PUISSANCE]
 * La puissance est toujours dans la moitie droite
 */
function cropRightHalf(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const startX = Math.floor(img.width * 0.45);
      const cropW = img.width - startX;
      canvas.width = cropW;
      canvas.height = img.height;
      ctx.drawImage(img, startX, 0, cropW, img.height, 0, 0, cropW, img.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  });
}

/**
 * Retourne le facteur de punch up selon la confiance du counter
 * ★★★ (95%+) = peut punch up 20% → facteur 1.20
 * ★★ (80%+)  = peut punch up 10% → facteur 1.10
 * ★ (65%+)   = peut punch up 5%  → facteur 1.05
 * ☆ (50%+)   = even match        → facteur 1.00
 * ☆ (<50%)   = punch down        → facteur 0.90
 */
function confidenceToPunchFactor(confidence) {
  if (confidence >= 95) return 1.20;
  if (confidence >= 80) return 1.10;
  if (confidence >= 65) return 1.05;
  if (confidence >= 50) return 1.00;
  return 0.90;
}

/**
 * Calcule l'indicateur punch effectif (power joueur * facteur punch vs ennemi)
 * @param {number} playerPower - Power brut du joueur (roster)
 * @param {number} enemyPower - Power ennemi (OCR)
 * @param {number} punchFactor - Facteur punch du counter (ex: 1.20 pour +20%)
 * @returns {Object|null} {label, color, effectivePct}
 */
function getPunchIndicator(playerPower, enemyPower, punchFactor) {
  if (!playerPower || !enemyPower) return null;
  const factor = punchFactor || 1.0;
  const effectivePower = playerPower * factor;
  const pct = (effectivePower - enemyPower) / enemyPower * 100;
  const rounded = Math.round(pct);
  const sign = rounded >= 0 ? "+" : "";
  const label = `${sign}${rounded}%`;
  let color;
  if (pct <= -10)     color = "#ff6b6b";
  else if (pct < 5)   color = "#ffd43b";
  else if (pct < 10)  color = "#69db7c";
  else if (pct < 20)  color = "#51cf66";
  else                 color = "#40c057";
  return { label, color, effectivePct: rounded };
}

async function lookupTeamCounters(teamIdx) {
  if (!scanRoomState || !warAnalyzer) return;

  const team = scanRoomState.teams[teamIdx];
  const charIds = team.portraits.filter(p => p.charId).map(p => p.charId);

  if (charIds.length < 3) return;

  const btn = document.querySelector(`.scan-room-btn-counters[data-team="${teamIdx}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Recherche..."; }

  try {
    const teamResult = warAnalyzer._identifyTeamFromCharIds(charIds);
    if (!teamResult || !teamResult.team) {
      await renderTeamCountersResult(teamIdx, null, null, "Equipe non reconnue");
      return;
    }

    // Lire le power depuis l'input (peut avoir ete corrige par l'utilisateur)
    const powerInput = document.getElementById(`power-input-${teamIdx}`);
    const powerRaw = powerInput?.value?.trim().replace(/[\s,.]/g, "") || "";
    const enemyPower = /^\d{5,}$/.test(powerRaw) ? parseInt(powerRaw, 10) : (team.enemyPower || null);
    const countersResult = warAnalyzer.getCountersWithVariants(teamResult.team.id, charIds, enemyPower);

    await renderTeamCountersResult(teamIdx, teamResult, countersResult?.counters || [], null, enemyPower);
  } catch (e) {
    console.error(`[ScanSalle] Erreur counters equipe ${teamIdx}:`, e);
    await renderTeamCountersResult(teamIdx, null, null, e.message);
  }
}

function renderCounterItems(enriched, hasRoster, enemyPower) {
  let html = "";
  for (const c of enriched) {
    const status = typeof canMakeTeam === "function" ? canMakeTeam(c.teamId) : null;
    const isAvailable = status?.available;

    let powerPunchHtml = "";
    if (enemyPower && c.playerPower) {
      const punchFactor = confidenceToPunchFactor(c.confidence);
      const punch = getPunchIndicator(c.playerPower, enemyPower, punchFactor);
      const fmtPlayer = typeof formatPower === "function" ? formatPower(c.playerPower) : c.playerPower.toLocaleString();
      const fmtEnemy = typeof formatPower === "function" ? formatPower(enemyPower) : enemyPower.toLocaleString();
      const punchLabel = punchFactor > 1 ? `Punch x${punchFactor.toFixed(2)}` : "Even";
      if (punch) {
        powerPunchHtml = `<span class="war-counter-power" title="${fmtPlayer} × ${punchFactor.toFixed(2)} vs ${fmtEnemy} (${punchLabel})">${fmtPlayer} <span class="war-counter-punch" style="color:${punch.color}">(${punch.label})</span></span>`;
      } else {
        powerPunchHtml = `<span class="war-counter-power">${fmtPlayer}</span>`;
      }
    }
    if (!powerPunchHtml && c.minPower) {
      powerPunchHtml = `<span class="war-counter-power">${typeof formatPower === "function" ? formatPower(c.minPower) : c.minPower}+</span>`;
    }

    html += `<div class="war-counter-item ${isAvailable ? 'available' : ''}">
      <div class="war-counter-header">
        <span class="war-counter-name">${c.teamName}</span>
        <div class="war-counter-meta">
          ${hasRoster && typeof renderAvailabilityBadge === "function" ? renderAvailabilityBadge(c.teamId) : ''}
          <span class="war-counter-confidence">${confidenceToSymbols(c.confidence)}</span>
          ${typeof renderStatsBadge === "function" ? renderStatsBadge(c.teamId) : ''}
          ${powerPunchHtml}
        </div>
      </div>
      ${c.notes ? `<div class="war-counter-actions"><span class="war-counter-notes">${c.notes}</span></div>` : ''}
    </div>`;
  }
  return html;
}

function sortCounters(enriched, sortKey) {
  if (sortKey === "stars") {
    enriched.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const pa = a.punchPct ?? -9999;
      const pb = b.punchPct ?? -9999;
      return pb - pa;
    });
  } else if (sortKey === "power") {
    enriched.sort((a, b) => {
      const pa = a.playerPower ?? 0;
      const pb = b.playerPower ?? 0;
      if (pb !== pa) return pb - pa;
      return b.confidence - a.confidence;
    });
  } else { // "punch" (defaut)
    enriched.sort((a, b) => {
      const pa = a.punchPct ?? -9999;
      const pb = b.punchPct ?? -9999;
      if (pa !== pb) return pb - pa;
      return b.confidence - a.confidence;
    });
  }
}

function reSortCounters(teamIdx, sortKey) {
  const data = scanCountersData[teamIdx];
  if (!data) return;

  sortCounters(data.enriched, sortKey);

  const zone = document.getElementById(`counters-${teamIdx}`);
  const itemsContainer = zone?.querySelector(".counter-items");
  if (itemsContainer) {
    itemsContainer.innerHTML = renderCounterItems(data.enriched, data.hasRoster, data.enemyPower);
  }

  zone?.querySelectorAll(".counter-sort-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sort === sortKey);
  });
}

async function renderTeamCountersResult(teamIdx, teamResult, counters, error, enemyPower) {
  const zone = document.getElementById(`counters-${teamIdx}`);
  if (!zone) return;

  zone.classList.remove("hidden");

  if (error) {
    zone.innerHTML = `<div class="scan-room-counters-error">${error}</div>`;
    return;
  }

  let html = "";

  if (teamResult?.team) {
    const teamName = teamResult.team.nameFr || teamResult.team.variantName || teamResult.team.name;
    const totalMembers = teamResult.team?.memberIds?.length || 5;
    html += `<div class="scan-room-team-identified">${teamName} (${teamResult.matchCount}/${totalMembers})`;
    if (enemyPower) {
      html += ` <span style="color:#aaa;font-size:11px;font-weight:normal;">— ${typeof formatPower === "function" ? formatPower(enemyPower) : enemyPower.toLocaleString()}</span>`;
    }
    html += `</div>`;
  }

  if (counters && counters.length > 0) {
    const hasRoster = typeof playerRoster !== "undefined" && playerRoster.size > 0;

    // Pre-calculer power/punch pour chaque counter (pour le tri)
    const enriched = [];
    for (const c of counters) {
      let playerPower = null;
      let punchPct = null;
      if (enemyPower) {
        playerPower = await getTeamPowerFromRoster(c.teamId);
        if (playerPower) {
          const punchFactor = confidenceToPunchFactor(c.confidence);
          const effectivePower = playerPower * punchFactor;
          punchPct = (effectivePower - enemyPower) / enemyPower * 100;
        }
      }
      enriched.push({ ...c, playerPower, punchPct });
    }

    // Tri par defaut : % punch desc (meilleur matchup en haut)
    sortCounters(enriched, "punch");

    // Stocker pour re-tri ulterieur
    scanCountersData[teamIdx] = { enriched, hasRoster, enemyPower };

    // Barre de tri
    html += `<div class="counter-sort-bar">Trier : <button class="counter-sort-btn active" data-sort="punch" data-team="${teamIdx}">% Punch</button><button class="counter-sort-btn" data-sort="stars" data-team="${teamIdx}">Etoiles</button><button class="counter-sort-btn" data-sort="power" data-team="${teamIdx}">Power</button></div>`;

    // Items dans un conteneur dedie pour re-tri
    html += `<div class="counter-items">${renderCounterItems(enriched, hasRoster, enemyPower)}</div>`;
  } else {
    html += `<div class="scan-room-counters-error">Pas de counters trouves</div>`;
  }

  zone.innerHTML = html;

  // Event delegation pour boutons de tri
  zone.querySelectorAll(".counter-sort-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      reSortCounters(parseInt(btn.dataset.team), btn.dataset.sort);
    });
  });

  // Re-enable button
  const btn = document.querySelector(`.scan-room-btn-counters[data-team="${teamIdx}"]`);
  if (btn) { btn.disabled = false; btn.textContent = "Chercher counters"; }
}

/**
 * Mode debug : affiche le screenshot avec overlay des zones + portraits extraits
 */
async function displayScanDebug(screenshotDataUrl, slots, cropper) {
  const img = await loadImageFromDataUrl(screenshotDataUrl);
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;

  let html = `<div class="scan-debug">`;
  html += `<div style="font-size:12px;color:#845ef7;font-weight:600;margin-bottom:8px;">Mode Debug — Calibration des zones</div>`;
  const gameArea = cropper.getGameArea(imgW, imgH);
  const ratioInfo = `ratio ${(imgW/imgH).toFixed(3)}, ref ${cropper.referenceAspect.toFixed(3)}`;
  const corrInfo = (gameArea.x > 0 || gameArea.y > 0) ? ` — correction: offset(${gameArea.x},${gameArea.y}) game(${gameArea.w}x${gameArea.h})` : ` — pas de correction`;
  const langInfo = `lang: ${cropper.currentLang} (langues dispo: ${Object.keys(cropper.slotsByLang).join(", ")})`;
  html += `<div style="font-size:11px;color:#888;margin-bottom:4px;">Screenshot: ${imgW}x${imgH}px (${ratioInfo}${corrInfo})</div>`;
  html += `<div style="font-size:11px;color:#888;margin-bottom:8px;">${langInfo}</div>`;

  // Instructions calibration
  html += `<div style="font-size:11px;color:#00d4ff;margin-bottom:8px;padding:6px;background:#1a1a2e;border-radius:4px;">Clique sur le <b>centre</b> de chaque portrait pour calibrer. <b>Clic droit</b> = annuler le dernier point.<br>Ordre : Equipe 1 (P1-haut-gauche, P2-haut-droite, P3-bas-gauche, P4-bas-centre, P5-bas-droite), puis Equipe 2, etc.</div>`;
  html += `<div id="debug-click-log" style="font-size:10px;color:#aaa;margin-bottom:8px;font-family:monospace;max-height:120px;overflow-y:auto;"></div>`;

  // Loupe de zoom pour precision
  html += `<div id="debug-magnifier" style="display:none;position:fixed;width:140px;height:140px;border:2px solid #00d4ff;border-radius:50%;overflow:hidden;pointer-events:none;z-index:9999;box-shadow:0 0 12px rgba(0,212,255,0.4);">`;
  html += `<div id="debug-mag-inner" style="width:100%;height:100%;background-repeat:no-repeat;"></div>`;
  // Grille d'alignement (lignes a 25% et 75%)
  html += `<div style="position:absolute;top:25%;left:0;right:0;height:1px;background:rgba(255,255,255,0.15);"></div>`;
  html += `<div style="position:absolute;top:75%;left:0;right:0;height:1px;background:rgba(255,255,255,0.15);"></div>`;
  html += `<div style="position:absolute;left:25%;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.15);"></div>`;
  html += `<div style="position:absolute;left:75%;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.15);"></div>`;
  // Reticule central (rouge pour bien voir)
  html += `<div style="position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(255,70,70,0.7);"></div>`;
  html += `<div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,70,70,0.7);"></div>`;
  html += `</div>`;

  // Screenshot avec overlay des zones de portrait
  html += `<div id="debug-img-container" style="position:relative;margin-bottom:12px;cursor:crosshair;">`;
  html += `<img id="debug-screenshot" src="${screenshotDataUrl}" style="width:100%;border-radius:4px;border:1px solid #333;display:block;">`;

  // Overlay des zones actuelles (converties via gameArea)
  const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44'];
  for (const slot of cropper.slots) {
    const color = colors[(slot.slotNumber - 1) % 4];
    // Rectangles portraits
    for (let p = 1; p <= 5; p++) {
      const zone = slot.zones[`portrait_${p}`];
      const left = (zone.x * gameArea.w + gameArea.x) / imgW * 100;
      const top = (zone.y * gameArea.h + gameArea.y) / imgH * 100;
      const width = zone.w * gameArea.w / imgW * 100;
      const height = zone.h * gameArea.h / imgH * 100;
      html += `<div class="debug-zone-rect" style="position:absolute;left:${left}%;top:${top}%;width:${width}%;height:${height}%;border:2px solid ${color};border-radius:4px;pointer-events:none;box-sizing:border-box;opacity:0.7;"></div>`;
    }
    // Rectangle team_power (cyan pointille)
    if (slot.zones.team_power) {
      const pz = slot.zones.team_power;
      const pl = (pz.x * gameArea.w + gameArea.x) / imgW * 100;
      const pt = (pz.y * gameArea.h + gameArea.y) / imgH * 100;
      const pw = pz.w * gameArea.w / imgW * 100;
      const ph = pz.h * gameArea.h / imgH * 100;
      html += `<div style="position:absolute;left:${pl}%;top:${pt}%;width:${pw}%;height:${ph}%;border:2px dashed #00ffff;pointer-events:none;box-sizing:border-box;opacity:0.9;font-size:8px;color:#00ffff;display:flex;align-items:center;justify-content:center;">PWR</div>`;
    }
  }
  html += `</div>`;

  // Portraits extraits par slot
  for (const slot of slots) {
    html += `<div style="margin-bottom:10px;">`;
    html += `<div style="font-size:11px;color:#00d4ff;margin-bottom:4px;">Slot ${slot.slotNumber} <span style="color:#666;">(${colors[(slot.slotNumber - 1) % 4]})</span></div>`;
    html += `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:flex-end;">`;
    slot.portraits.forEach((p, i) => {
      html += `<div style="text-align:center;">`;
      html += `<img src="${p}" style="width:48px;height:48px;border-radius:4px;border:2px solid ${colors[(slot.slotNumber - 1) % 4]};">`;
      html += `<div style="font-size:9px;color:#888;">P${i + 1}</div>`;
      html += `</div>`;
    });
    if (slot.team_power) {
      html += `<div style="text-align:center;">`;
      html += `<img src="${slot.team_power}" style="height:28px;border-radius:2px;border:2px solid #00ffff;">`;
      html += `<div style="font-size:9px;color:#00ffff;">Power</div>`;
      html += `</div>`;
      // Afficher le crop droit + champ OCR resultat
      const croppedPower = await cropRightHalf(slot.team_power);
      html += `<div style="text-align:center;">`;
      html += `<img src="${croppedPower}" style="height:28px;border-radius:2px;border:2px solid #ff00ff;">`;
      html += `<div style="font-size:9px;color:#ff00ff;">OCR crop</div>`;
      html += `</div>`;
      html += `<div style="text-align:center;display:flex;flex-direction:column;justify-content:center;">`;
      html += `<input type="text" id="debug-ocr-${slot.slotNumber}" readonly style="width:90px;font-size:11px;background:#1a1a2e;color:#00ff88;border:1px solid #333;border-radius:3px;padding:2px 4px;text-align:center;" value="..." placeholder="OCR...">`;
      html += `<div style="font-size:9px;color:#00ff88;">OCR</div>`;
      html += `</div>`;
    }
    html += `<div style="text-align:center;">`;
    html += `<img src="${slot.team_full}" style="height:48px;border-radius:4px;border:1px solid #555;">`;
    html += `<div style="font-size:9px;color:#888;">Full</div>`;
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;
  }

  // Boutons copier + sauvegarder calibration
  html += `<div style="display:flex;gap:8px;margin-top:8px;">`;
  html += `<button id="debug-copy-coords" style="padding:4px 12px;background:#845ef7;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Copier les coordonnees</button>`;
  html += `<button id="debug-save-calib" style="padding:4px 12px;background:#51cf66;color:#0a0a14;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">Sauvegarder la calibration</button>`;
  html += `</div>`;
  html += `<div id="debug-save-status" style="font-size:10px;color:#666;margin-top:4px;"></div>`;
  html += `<div style="font-size:10px;color:#666;margin-top:8px;">Clique sur le screenshot pour marquer les centres des portraits. Les rectangles colores montrent les zones actuelles.</div>`;

  html += `</div>`;

  warResult.innerHTML = html;
  warResult.classList.remove("hidden");

  // --- OCR debug : lire le power de chaque slot (direct dans le popup) ---
  (async () => {
    let debugOcr = null;
    try {
      debugOcr = new OCREngine();
      await debugOcr.init();
    } catch (e) {
      console.error("[OCR Debug] Init echoue:", String(e), e);
      slots.forEach(s => {
        const el = document.getElementById(`debug-ocr-${s.slotNumber}`);
        if (el) { el.value = String(e).substring(0, 20); el.style.color = "#ff6b6b"; }
      });
      return;
    }

    for (const slot of slots) {
      const el = document.getElementById(`debug-ocr-${slot.slotNumber}`);
      if (!el || !slot.team_power) continue;
      try {
        el.value = "OCR...";
        const cropped = await cropRightHalf(slot.team_power);
        const result = await debugOcr.extractPowerWithDebug(cropped);
        el.value = result?.power ? result.power.toLocaleString() : `raw: ${(result?.rawText || "").substring(0, 15)}`;
        el.style.color = result?.power ? "#00ff88" : "#ff6b6b";
      } catch (e) {
        el.value = String(e).substring(0, 20);
        el.style.color = "#ff6b6b";
      }
    }

    debugOcr.terminate().catch(() => {});
  })();

  // --- Click-to-calibrate handler ---
  const container = document.getElementById("debug-img-container");
  const debugImg = document.getElementById("debug-screenshot");
  const clickLog = document.getElementById("debug-click-log");
  const magnifier = document.getElementById("debug-magnifier");
  const magInner = document.getElementById("debug-mag-inner");
  const calibPoints = [];
  const portraitLabels = ["E1-P1", "E1-P2", "E1-P3", "E1-P4", "E1-P5",
                          "E2-P1", "E2-P2", "E2-P3", "E2-P4", "E2-P5",
                          "E3-P1", "E3-P2", "E3-P3", "E3-P4", "E3-P5",
                          "E4-P1", "E4-P2", "E4-P3", "E4-P4", "E4-P5"];
  let clickIndex = 0;
  const ZOOM = 4;
  const MAG_SIZE = 140;

  // Loupe zoom : suit le curseur sur le screenshot
  container.addEventListener("mousemove", (e) => {
    const rect = debugImg.getBoundingClientRect();
    // Position du curseur relative a l'image affichee
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) {
      magnifier.style.display = "none";
      return;
    }
    magnifier.style.display = "block";
    // Positionner la loupe a cote du curseur (decalee pour ne pas cacher le point)
    magnifier.style.left = (e.clientX + 20) + "px";
    magnifier.style.top = (e.clientY - MAG_SIZE / 2) + "px";
    // Background = screenshot zoome, centre sur le curseur
    const bgW = rect.width * ZOOM;
    const bgH = rect.height * ZOOM;
    const bgX = -(relX * ZOOM - MAG_SIZE / 2);
    const bgY = -(relY * ZOOM - MAG_SIZE / 2);
    magInner.style.backgroundImage = `url(${screenshotDataUrl})`;
    magInner.style.backgroundSize = `${bgW}px ${bgH}px`;
    magInner.style.backgroundPosition = `${bgX}px ${bgY}px`;
  });

  container.addEventListener("mouseleave", () => {
    magnifier.style.display = "none";
  });

  const calibMarkers = [];

  container.addEventListener("click", (e) => {
    if (clickIndex >= 20) return;
    const rect = debugImg.getBoundingClientRect();
    const scaleX = imgW / rect.width;
    const scaleY = imgH / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const nx = (px - gameArea.x) / gameArea.w;
    const ny = (py - gameArea.y) / gameArea.h;

    const label = portraitLabels[clickIndex];
    calibPoints.push({ label, px: Math.round(px), py: Math.round(py), nx: +nx.toFixed(4), ny: +ny.toFixed(4) });

    // Marqueur visuel sur le screenshot
    const marker = document.createElement("div");
    marker.style.cssText = `position:absolute;left:${(px/imgW*100)}%;top:${(py/imgH*100)}%;width:8px;height:8px;background:#fff;border:2px solid #000;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:10;`;
    container.appendChild(marker);
    calibMarkers.push(marker);

    // Log
    clickLog.innerHTML += `<div id="calib-log-${clickIndex}"><span style="color:#00d4ff;">${label}</span>: x=${nx.toFixed(4)}, y=${ny.toFixed(4)} (${Math.round(px)}, ${Math.round(py)}px)</div>`;
    clickLog.scrollTop = clickLog.scrollHeight;

    clickIndex++;
    if (clickIndex >= 20) {
      clickLog.innerHTML += `<div style="color:#44ff44;font-weight:bold;">Calibration complete ! Sauvegarde ou copie les coordonnees.</div>`;
    }
  });

  // Clic droit = annuler le dernier point
  container.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (clickIndex <= 0) return;
    clickIndex--;
    calibPoints.pop();
    // Retirer le marqueur visuel
    const lastMarker = calibMarkers.pop();
    if (lastMarker) lastMarker.remove();
    // Retirer la derniere ligne de log
    const lastLog = document.getElementById(`calib-log-${clickIndex}`);
    if (lastLog) lastLog.remove();
    clickLog.innerHTML += `<div style="color:#ff6b6b;">← Annule ${portraitLabels[clickIndex]}</div>`;
    clickLog.scrollTop = clickLog.scrollHeight;
  });

  // Helper : generer les slots config depuis les points cliques
  function generateSlotsFromPoints(points) {
    const zoneW = 0.05, zoneH = 0.08;
    const slotsConfig = [];
    for (let s = 0; s < 4; s++) {
      const slotPoints = points.slice(s * 5, s * 5 + 5);
      if (slotPoints.length === 0) continue;
      const zones = {};
      const allX = slotPoints.map(p => p.nx);
      const allY = slotPoints.map(p => p.ny);
      const minX = Math.min(...allX) - zoneW / 2 - 0.005;
      const maxX = Math.max(...allX) + zoneW / 2 + 0.005;
      const minY = Math.min(...allY) - zoneH / 2 - 0.005;
      const maxY = Math.max(...allY) + zoneH / 2 + 0.005;
      // Power: AU-DESSUS des portraits, pleine largeur de la carte
      const powerH = 0.045;
      const powerY = minY - powerH; // juste au-dessus de la zone portraits
      const extendedMinY = powerY;
      zones.team_full = { x: +minX.toFixed(4), y: +extendedMinY.toFixed(4), w: +(maxX - minX).toFixed(4), h: +(maxY - extendedMinY).toFixed(4) };
      zones.team_power = { x: +minX.toFixed(4), y: +powerY.toFixed(4), w: +(maxX - minX).toFixed(4), h: powerH };
      slotPoints.forEach((p, i) => {
        zones[`portrait_${i + 1}`] = { x: +(p.nx - zoneW / 2).toFixed(4), y: +(p.ny - zoneH / 2).toFixed(4), w: zoneW, h: zoneH };
      });
      slotsConfig.push({ slotNumber: s + 1, zones });
    }
    return slotsConfig;
  }

  // Bouton copier
  document.getElementById("debug-copy-coords").addEventListener("click", () => {
    if (calibPoints.length === 0) { alert("Clique d'abord sur les portraits !"); return; }
    const slotsConfig = generateSlotsFromPoints(calibPoints);
    const configText = JSON.stringify(slotsConfig, null, 2);
    navigator.clipboard.writeText(configText).then(() => {
      alert("Coordonnees copiees ! Colle-les dans la console ou envoie-les moi.");
    });
    console.log("[Calibration] Nouvelles zones:", configText);
  });

  // Bouton sauvegarder calibration
  document.getElementById("debug-save-calib").addEventListener("click", async () => {
    const saveStatus = document.getElementById("debug-save-status");
    if (calibPoints.length < 20) {
      saveStatus.textContent = `${calibPoints.length}/20 points — clique d'abord sur les 20 portraits !`;
      saveStatus.style.color = "#ff6b6b";
      return;
    }

    const slotsConfig = generateSlotsFromPoints(calibPoints);
    const calibData = {
      reference: { aspectRatio: cropper.referenceAspect, calibratedAt: `${imgW}x${imgH}` },
      slots: { custom: slotsConfig },
      savedAt: new Date().toISOString(),
      savedForLang: cropper.currentLang
    };

    try {
      await storageSet({ msfCustomZoneCalibration: calibData });
      saveStatus.textContent = "Calibration sauvegardee ! Elle sera utilisee au prochain scan.";
      saveStatus.style.color = "#51cf66";
      console.log("[Calibration] Sauvegardee dans storage:", calibData);

      // Ajouter l'option "Custom" au select langue si pas deja presente
      const langSelect = document.getElementById("scan-lang-override");
      if (langSelect && !langSelect.querySelector('option[value="custom"]')) {
        const opt = document.createElement("option");
        opt.value = "custom";
        opt.textContent = "Custom";
        langSelect.appendChild(opt);
      }
      if (langSelect) langSelect.value = "custom";
    } catch (e) {
      saveStatus.textContent = "Erreur sauvegarde: " + e.message;
      saveStatus.style.color = "#ff6b6b";
    }
  });
}

// Restaure les panneaux war caches par le scan salle
function restoreWarPanelUI() {
  // Les anciens modes (tabs, portrait, manual, power) restent masques
  // On nettoie juste l'etat du scan salle
  scanRoomState = null;
  _rosterMapCache = null; // Reset cache roster
}

// Event listener Scan Salle
document.getElementById("btn-war-scan-room").addEventListener("click", async (e) => {
  const btn = document.getElementById("btn-war-scan-room");
  const debugMode = e.ctrlKey || e.metaKey;

  btn.disabled = true;
  btn.textContent = debugMode ? "Debug..." : "Scan en cours...";

  try {
    await handleScanSalle(debugMode);
  } catch (err) {
    console.error("[ScanSalle] Erreur:", err);
    restoreWarPanelUI();
    showWarResult("Erreur: " + (err?.message || "Erreur inconnue"), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "\u{1F3F0} Scan Salle";
  }
});

// Export portraits appris (bouton toolbar — genere un fichier JSON)
document.getElementById("btn-export-learned-global").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const originalHTML = btn.innerHTML;
  try {
    const result = await ext.storage.local.get("learnedPortraits");
    const userPortraits = result.learnedPortraits || {};
    const count = Object.keys(userPortraits).length;
    if (count === 0) {
      btn.innerHTML = "⚠️<span>0 portrait</span>";
      setTimeout(() => { btn.innerHTML = originalHTML; }, 2000);
      return;
    }
    const exportData = {
      description: "Portraits appris partages - generes depuis les corrections utilisateur",
      version: 1,
      generatedAt: new Date().toISOString(),
      count,
      portraits: userPortraits
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `msf-portraits-${count}p-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    btn.innerHTML = `✅<span>${count} exportes</span>`;
    setTimeout(() => { btn.innerHTML = originalHTML; }, 2000);
  } catch (err) {
    btn.innerHTML = "❌<span>Erreur</span>";
    setTimeout(() => { btn.innerHTML = originalHTML; }, 2000);
  }
});

// Import portraits appris (bouton toolbar — label déclenche le file picker directement)
document.getElementById("import-learned-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ""; // reset pour pouvoir reimporter le meme fichier

  const btn = document.getElementById("btn-import-learned-global");
  const originalHTML = btn.innerHTML;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);

    if (!imported.portraits || typeof imported.portraits !== "object") {
      btn.innerHTML = "❌<span>Format invalide</span>";
      setTimeout(() => { btn.innerHTML = originalHTML; }, 2000);
      return;
    }

    const result = await ext.storage.local.get("learnedPortraits");
    const existing = result.learnedPortraits || {};
    let added = 0, merged = 0, skipped = 0;

    for (const [charId, importEntry] of Object.entries(imported.portraits)) {
      const importSamples = importEntry.samples || (importEntry.hue && importEntry.hash ? [{ hue: importEntry.hue, hash: importEntry.hash }] : []);
      if (importSamples.length === 0) { skipped++; continue; }

      if (!existing[charId]) {
        // Nouveau perso : ajouter tel quel
        existing[charId] = {
          name: importEntry.name,
          samples: importSamples.slice(0, 5),
          count: importEntry.count || 1,
          lastSeen: Date.now()
        };
        added++;
      } else {
        // Perso existant : merger les samples non-dupliques
        const entry = existing[charId];
        if (!entry.samples) {
          entry.samples = (entry.hue && entry.hash) ? [{ hue: entry.hue, hash: entry.hash }] : [];
        }
        let mergedCount = 0;
        for (const sample of importSamples) {
          if (!sample.hue || !sample.hash) continue;
          if (entry.samples.length >= 5) break;
          // Verifier si ce sample est un doublon
          const isDup = entry.samples.some(s => {
            if (!s.hue || !s.hash) return false;
            let hueSim = 0;
            for (let i = 0; i < Math.min(s.hue.length, sample.hue.length); i++) {
              hueSim += Math.sqrt(s.hue[i] * sample.hue[i]);
            }
            hueSim *= 100;
            // pHash : compter bits identiques
            let matching = 0;
            const len = Math.min(s.hash.length, sample.hash.length);
            for (let i = 0; i < len; i++) { if (s.hash[i] === sample.hash[i]) matching++; }
            const pSim = len > 0 ? (matching / len) * 100 : 0;
            return (0.4 * hueSim + 0.6 * pSim) > 95;
          });
          if (!isDup) {
            entry.samples.push(sample);
            mergedCount++;
          }
        }
        if (mergedCount > 0) merged++;
        else skipped++;
      }
    }

    await ext.storage.local.set({ learnedPortraits: existing });

    // Recharger la DB dans warAnalyzer si disponible
    if (warAnalyzer) await warAnalyzer.loadLearnedPortraits();

    const total = Object.keys(existing).length;
    if (added === 0 && merged === 0) {
      btn.innerHTML = `⚠️<span>${skipped} ignorés (déjà présents ou mauvais format)</span>`;
    } else {
      btn.innerHTML = `✅<span>${added} ajout${added > 1 ? 's' : ''}, ${merged} merge${merged > 1 ? 's' : ''}</span>`;
    }
    console.log(`[Import] ${added} nouveaux, ${merged} merges, ${skipped} ignores — total: ${total} persos`);
    setTimeout(() => { btn.innerHTML = originalHTML; }, 3000);
  } catch (err) {
    console.error("[Import portraits] Erreur:", err);
    btn.innerHTML = "❌<span>Erreur</span>";
    setTimeout(() => { btn.innerHTML = originalHTML; }, 2000);
  }
});

// ===== LUCIDE ICONS INITIALIZATION =====
// Initialise les icônes Lucide après le chargement du DOM
if (typeof lucide !== 'undefined') {
  lucide.createIcons();
  console.log('[Popup] Lucide Icons initialized');
} else {
  console.warn('[Popup] Lucide library not loaded');
}

