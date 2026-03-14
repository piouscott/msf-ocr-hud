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

// ═══════════════════════════════════════════════════════════
// WAR HISTORY — save scan sessions for pattern analysis
// ═══════════════════════════════════════════════════════════

async function saveWarScanSession() {
  if (!scanRoomState) return;

  const teams = [];
  for (const team of scanRoomState.teams) {
    if (team.underAttack) {
      teams.push({ slot: team.slotNumber, underAttack: true });
      continue;
    }
    const charIds = team.portraits.filter(p => p.charId).map(p => p.charId);
    const names = team.portraits.filter(p => p.name).map(p => p.name);
    if (charIds.length < 3) continue;

    // Resolve team name
    let teamName = "";
    if (warAnalyzer) {
      const result = warAnalyzer._identifyTeamFromCharIds(charIds);
      teamName = result?.team ? (result.team.nameFr || result.team.name) : "";
    }

    teams.push({
      slot: team.slotNumber,
      teamName,
      charIds,
      names,
      power: team.enemyPower || null
    });
  }

  if (teams.length === 0) return;

  const session = {
    date: new Date().toISOString(),
    teams
  };

  const stored = await storageGet("msfWarHistory");
  const history = stored.msfWarHistory || [];
  history.unshift(session);

  // Keep last 50 sessions
  if (history.length > 50) history.length = 50;

  await storageSet({ msfWarHistory: history });
}

function displayWarHistory() {
  let html = "";

  const stored = storageGetSync("msfWarHistory");
  // We'll use async version — this function is called async anyway
  return ""; // placeholder, real render is async
}

async function renderWarHistoryAsync() {
  const stored = await storageGet("msfWarHistory");
  const history = stored.msfWarHistory || [];

  if (history.length === 0) return "";

  // Count team frequency
  const teamFreq = {};
  for (const session of history) {
    for (const team of session.teams) {
      if (!team.teamName || team.underAttack) continue;
      if (!teamFreq[team.teamName]) teamFreq[team.teamName] = 0;
      teamFreq[team.teamName]++;
    }
  }

  const sortedTeams = Object.entries(teamFreq).sort((a, b) => b[1] - a[1]);

  let html = `<div class="war-history-section">
    <div style="font-size:12px;font-weight:700;color:#845ef7;margin:8px 0 6px;">Historique scans (${history.length} sessions)</div>`;

  // Most seen teams
  if (sortedTeams.length > 0) {
    html += `<div style="font-size:10px;color:#888;margin-bottom:4px;">Equipes les plus vues :</div>`;
    html += `<div class="war-history-freq">`;
    sortedTeams.slice(0, 10).forEach(([name, count]) => {
      html += `<div class="war-history-freq-item"><span class="war-history-freq-name">${name}</span><span class="war-history-freq-count">${count}x</span></div>`;
    });
    html += `</div>`;
  }

  // Last 5 sessions
  html += `<div style="font-size:10px;color:#888;margin:8px 0 4px;">Derniers scans :</div>`;
  history.slice(0, 5).forEach(session => {
    const date = new Date(session.date);
    const dateStr = `${date.toLocaleDateString("fr")} ${date.toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" })}`;
    const teamNames = session.teams.filter(t => t.teamName && !t.underAttack).map(t => t.teamName).join(", ") || "?";
    html += `<div class="war-history-session"><span class="war-history-date">${dateStr}</span><span class="war-history-teams">${teamNames}</span></div>`;
  });

  html += `</div>`;
  return html;
}

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
        // Limite a 10 defenses max
        if (currentDefenseTagged.length >= 10) return;
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

      updateDefenseCounter();
    });
  });

  // Afficher le compteur initial
  updateDefenseCounter();
}

function updateDefenseCounter() {
  const el = document.getElementById("defense-counter");
  if (!el) return;
  const count = currentDefenseTagged.length;
  el.textContent = `${count}/10 en defense`;
  el.classList.toggle("full", count >= 10);
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

  // Charger les Time Heists en parallèle
  loadTimeHeists();

  // Verifier les events qui expirent bientot (< 2h) et pas completes
  checkExpiringEvents(dedupedMilestones);
}

/**
 * Alerte pour les events qui expirent dans moins de 2h et ne sont pas termines
 */
function checkExpiringEvents(milestones) {
  const now = Date.now() / 1000;
  const twoHours = 2 * 3600;
  const expiring = milestones.filter(e => {
    const remaining = e.endTime - now;
    if (remaining <= 0 || remaining > twoHours) return false;
    // Verifier si pas complete
    const progress = e.milestone?.progress;
    const tiers = e.milestone?.tiers;
    if (progress && tiers && tiers.length > 0) {
      const maxComp = e.milestone?.maxCompletions || 1;
      const total = tiers.length * maxComp;
      if (progress.completedTier >= total) return false; // complete
    }
    return true;
  });

  const notice = document.getElementById("expiring-notice");
  if (!notice || expiring.length === 0) return;

  const items = expiring.map(e => {
    const remaining = e.endTime - now;
    const mins = Math.round(remaining / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const timeStr = h > 0 ? `${h}h${m}m` : `${m}m`;
    return `<span class="expiring-item">⚠️ <strong>${e.name}</strong> expire dans ${timeStr}</span>`;
  }).join("");

  notice.innerHTML = items;
  notice.classList.remove("hidden");
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
      loadRaidGuide();
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

  // Charger le guide raid (données statiques)
  loadRaidGuide();

  // Raid lane advisor
  renderRaidAdvisor();
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

// ═══════════════════════════════════════════════════════════
// RAID GUIDE — équipes recommandées par node (données statiques)
// ═══════════════════════════════════════════════════════════

let raidGuideData = null;

async function loadRaidGuide() {
  try {
    if (!raidGuideData) {
      const response = await fetch(ext.runtime.getURL("data/raids.json"));
      raidGuideData = await response.json();
    }
    if (!charactersData) {
      const resp = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await resp.json();
    }

    const select = document.getElementById("raid-guide-select");
    const list = document.getElementById("raid-guide-list");
    if (!select || !list) return;

    // Remplir le select avec les raids disponibles
    select.innerHTML = "";
    const raidKeys = Object.keys(raidGuideData.raids);
    raidKeys.forEach(key => {
      const raid = raidGuideData.raids[key];
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = raid.name + (raid.difficulty ? ` (${raid.difficulty})` : "");
      select.appendChild(opt);
    });

    select.addEventListener("change", () => renderRaidGuide(select.value));

    if (raidKeys.length > 0) {
      renderRaidGuide(raidKeys[0]);
    }
  } catch (e) {
    console.error("[RaidGuide] Erreur chargement:", e);
  }
}

function renderRaidGuide(raidKey) {
  const list = document.getElementById("raid-guide-list");
  if (!list || !raidGuideData?.raids?.[raidKey]) return;

  const raid = raidGuideData.raids[raidKey];
  const chars = charactersData?.characters || {};

  let html = "";

  raid.nodes.forEach(node => {
    const teamLabel = node.teamNameFr || node.teamName;
    const notes = node.notesFr || node.notes || "";

    // Portraits des membres
    let portraitsHtml = "";
    node.memberIds.forEach((id, i) => {
      const c = chars[id];
      const name = node.members[i] || id;
      const portrait = c?.portrait || "";
      if (portrait) {
        portraitsHtml += `<div class="rg-member" title="${name}">
          <img src="${portrait}" alt="${name}" class="rg-portrait">
          <span class="rg-name">${name}</span>
        </div>`;
      } else {
        portraitsHtml += `<div class="rg-member" title="${name}">
          <div class="rg-portrait rg-no-img">${name.charAt(0)}</div>
          <span class="rg-name">${name}</span>
        </div>`;
      }
    });

    html += `
      <div class="rg-node-card">
        <div class="rg-node-header">
          <span class="rg-node-label">${node.node}</span>
          <span class="rg-team-label">${teamLabel}</span>
        </div>
        ${notes ? `<div class="rg-notes">${notes}</div>` : ""}
        <div class="rg-members">${portraitsHtml}</div>
      </div>`;
  });

  list.innerHTML = html;
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

  // Detecter le type Solo/Series depuis milestone.typeName ou milestone.type
  let eventMode = "Solo";
  let isSeries = false;
  if (event.milestone) {
    const typeName = event.milestone.typeName || event.milestone.type || "";
    isSeries = typeName.toLowerCase().includes("series") || typeName.toLowerCase().includes("série");
    eventMode = isSeries ? "Serie" : "Solo";
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
    const maxCompletions = event.milestone?.maxCompletions || 1;
    const completedTier = progress.completedTier || 0;
    const goalTier = progress.goalTier || 0;

    // Calculer le total de phases en essayant plusieurs sources
    // 1. Champs explicites sur le milestone
    // 2. goalTier si > tiers.length (indique le vrai total)
    // 3. tiers.length * maxCompletions (milestones répétitifs)
    // 4. Fallback : tiers.length seul
    let totalTiers = event.milestone?.totalTiers || event.milestone?.numTiers
      || event.milestone?.tierCount || event.milestone?.totalPhases || 0;

    if (!totalTiers) {
      // goalTier souvent = vrai total pour les milestones multi-phases
      if (goalTier > tiers.length) {
        totalTiers = goalTier;
      } else if (maxCompletions > 1) {
        totalTiers = tiers.length * maxCompletions;
      } else {
        totalTiers = tiers.length;
      }
    }

    // Si notre calcul est inferieur au tier complété, le total est faux — fallback
    if (completedTier >= totalTiers) {
      totalTiers = goalTier > completedTier ? goalTier : (completedTier + 1);
    }
    const knownTotal = completedTier < totalTiers;
    const currentPoints = progress.points || 0;
    const nextGoal = progress.goal || (tiers[completedTier % tiers.length] ? tiers[completedTier % tiers.length].endScore : 0);
    const pct = nextGoal > 0 ? Math.min(100, Math.round((currentPoints / nextGoal) * 100)) : 0;
    const offset = progress.completionOffset || 0;
    // Log debug
    console.log(`[Events] "${event.name}" tiers=${tiers.length} maxComp=${maxCompletions} goalTier=${goalTier} total=${totalTiers} completed=${completedTier} offset=${offset}`);

    const phaseDisplay = knownTotal
      ? `Phase ${completedTier + offset} / ${totalTiers + offset}`
      : `Phase ${completedTier + offset}`;

    progressHtml = `
      <div class="event-progress">
        <div class="event-progress-info">
          <span class="event-progress-pts">${formatNumber(currentPoints)} pts</span>
          <span class="event-progress-tier">${phaseDisplay}</span>
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
          <span class="events-accordion-title">⚔️ Chocs (Blitz)</span>
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
            <span class="event-type">Choc</span>
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
          <span class="events-accordion-title">🎯 Jalons</span>
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

      // Determiner le type a afficher
      const rawType = event.milestone?.typeName || "Milestone";
      const typeLabel = rawType === "Milestone" ? "Jalon" : (rawType.toLowerCase().includes("series") ? "Serie" : rawType);

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

  // Evenements
  "Battle in War": "Combat en Guerre",
  "War Season": "Saison de Guerre",
  "Raid Season": "Saison de Raid",
  "Blitz Season": "Saison de Blitz",
  "Arena Season": "Saison d'Arene",
  "Crucible Season": "Saison du Creuset",

  // Noms generiques
  "Father of Realms": "Pere des Royaumes",
  "Spending Spree": "Frenesie de Depenses",
  "Power Climb": "Ascension de Puissance",
  "Gear Up": "Equipement",
  "Level Up": "Montee de Niveau",
  "Earn": "Gagner"
};

/**
 * Traductions des descriptions d'événements
 */
const EVENT_DESC_TRANSLATIONS = {
  "Win War battles": "Victoires en Guerre",
  "Win Alliance War attacks": "Victoires attaque en Guerre",
  "Complete Raid nodes": "Noeuds de Raid completés",
  "Complete raid nodes": "Noeuds de Raid completés",
  "Earn Ability Materials": "Gagner des Materiaux de Capacite",
  "Earn Gear up to Tier 20": "Gagner du Gear (jusqu'au Tier 20)",
  "Earn Crimson Gear": "Gagner du Gear Crimson",
  "Earn Gold": "Gagner de l'Or",
  "Earn Training Modules": "Gagner des Modules d'Entrainement",
  "Complete Blitz battles": "Combats Blitz completés",
  "Collect character shards": "Collecter des fragments de personnage",
  "Open Orbs": "Ouvrir des Orbes",
  "Spend Campaign Energy": "Depenser de l'Energie de Campagne",
  "Spend Arena credits": "Depenser des credits d'Arene",
  "Spend Blitz credits": "Depenser des credits de Blitz",
  "Spend Raid credits": "Depenser des credits de Raid",
  "Spend War credits": "Depenser des credits de Guerre",
  "Win Arena battles": "Victoires en Arene",
  "Win Blitz battles": "Victoires en Blitz",
  "Win Crucible battles": "Victoires en Creuset",
  "Level Up characters": "Monter des personnages de niveau",
  "Rank Up characters": "Monter des personnages en rang",
  "Upgrade character abilities": "Ameliorer les capacites de personnages",
  "Equip Gear to characters": "Equiper du Gear sur des personnages",
  "Earn XP": "Gagner de l'XP",
  "Battle in War with": "Combat en Guerre avec",
  "Battle in War or Blitz with": "Combat en Guerre ou Blitz avec",
  "at 5 Yellow Stars": "a 5 Etoiles Jaunes",
  "at 6 Yellow Stars": "a 6 Etoiles Jaunes",
  "at 7 Yellow Stars": "a 7 Etoiles Jaunes",
  "Earn 5-Diamond": "Gagner 5 Diamants"
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
// Panneau Personnages - Tous les persos du jeu
// ============================================

const charsPanel = document.getElementById("chars-panel");
const btnChars = document.getElementById("btn-chars");
const btnCloseChars = document.getElementById("btn-close-chars");
const charsSearch = document.getElementById("chars-search");
const charsFilterTrait = document.getElementById("chars-filter-trait");
const charsGrid = document.getElementById("chars-grid");
const charsCount = document.getElementById("chars-count");
const btnCharsApi = document.getElementById("btn-chars-api");
const charsStatus = document.getElementById("chars-status");

let allCharsLoaded = [];

btnChars.addEventListener("click", async () => {
  charsPanel.classList.remove("hidden");
  charsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (allCharsLoaded.length === 0) {
    await loadAllCharacters();
  }
});

btnCloseChars.addEventListener("click", () => {
  charsPanel.classList.add("hidden");
});

charsSearch.addEventListener("input", renderCharsGrid);
charsFilterTrait.addEventListener("change", renderCharsGrid);

btnCharsApi.addEventListener("click", async () => {
  btnCharsApi.disabled = true;
  setCharsStatus("Chargement depuis l'API...", "");
  try {
    // Demander au bg de fetcher et stocker dans msfApiCharacters
    const result = await ext.runtime.sendMessage({ type: "MSF_GET_CHARACTERS" });
    console.log("[Chars] API result:", JSON.stringify(result).substring(0, 500));

    if (result && result.error) {
      setCharsStatus("Erreur: " + result.error, "error");
      btnCharsApi.disabled = false;
      return;
    }

    // Lire les persos depuis le storage (le bg les y a stockés)
    const stored = await storageGet("msfApiCharacters");
    const apiChars = stored.msfApiCharacters || [];
    console.log("[Chars] Lus depuis storage:", apiChars.length);

    const endpointsInfo = `${result?.pages || 0} pages chargées`;

    if (apiChars.length > 0) {
      // Merger avec les données locales
      const chars = charactersData?.characters || {};
      let newCount = 0;
      for (const c of apiChars) {
        const normalizedId = (c.id || "").replace(/-/g, "");
        const existing = chars[c.id] || chars[normalizedId];
        if (!existing) {
          chars[normalizedId] = {
            name: c.name || normalizedId,
            portrait: c.portrait || null,
            traits: Array.isArray(c.traits) ? c.traits : [],
            status: c.status || "playable"
          };
          newCount++;
        } else {
          if (!existing.portrait && c.portrait) existing.portrait = c.portrait;
          if ((!existing.traits || existing.traits.length === 0) && c.traits && c.traits.length > 0) existing.traits = c.traits;
          if (!existing.name && c.name) existing.name = c.name;
        }
      }

      // Sauvegarder les nouveaux dans le storage dynamique
      const dynStored = await storageGet("msfDynamicCharacters");
      const dynamic = dynStored.msfDynamicCharacters || {};
      for (const c of apiChars) {
        const normalizedId = (c.id || "").replace(/-/g, "");
        if (!charactersData?.characters?.[c.id] && !charactersData?.characters?.[normalizedId]) {
          dynamic[normalizedId] = {
            name: c.name || normalizedId,
            portrait: c.portrait || null,
            traits: Array.isArray(c.traits) ? c.traits : [],
            status: c.status || "playable"
          };
        }
      }
      await storageSet({ msfDynamicCharacters: dynamic });

      // Recharger la grille
      allCharsLoaded = [];
      await loadAllCharacters();
      setCharsStatus(`${apiChars.length} persos depuis l'API (${newCount} nouveaux)\n${endpointsInfo}`, "success");
    } else {
      setCharsStatus("Aucun personnage dans le storage après appel API.\n" + endpointsInfo, "error");
    }
  } catch (e) {
    setCharsStatus("Erreur: " + e.message, "error");
  }
  btnCharsApi.disabled = false;
});

function setCharsStatus(msg, cls) {
  charsStatus.textContent = msg;
  charsStatus.className = "chars-status" + (cls ? " " + cls : "");
  charsStatus.classList.remove("hidden");
}

// IDs du fichier local original (jamais muté, sert de référence pour "isNew")
let charsLocalFileIds = null;

async function loadAllCharacters() {
  try {
    // Charger le fichier local une seule fois pour référence
    if (!charactersData) {
      const response = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await response.json();
    }
    if (!charsLocalFileIds) {
      charsLocalFileIds = new Set(Object.keys(charactersData.characters || {}).map(k => k.toUpperCase()));
    }

    // Copier les persos locaux dans un objet de travail (ne pas muter l'original)
    const chars = Object.assign({}, charactersData.characters || {});

    // Merger les persos dynamiques (sauvés par le sync roster)
    try {
      const dynStored = await storageGet("msfDynamicCharacters");
      if (dynStored.msfDynamicCharacters) {
        Object.assign(chars, dynStored.msfDynamicCharacters);
      }
    } catch (e) { /* ignore */ }

    // Merger les persos API (sauvés par le bouton API)
    try {
      const apiStored = await storageGet("msfApiCharacters");
      if (apiStored.msfApiCharacters) {
        for (const c of apiStored.msfApiCharacters) {
          const normalizedId = (c.id || "").replace(/-/g, "");
          const existing = chars[c.id] || chars[normalizedId];
          if (!existing) {
            chars[normalizedId] = {
              name: c.name || normalizedId,
              portrait: c.portrait || null,
              traits: Array.isArray(c.traits) ? c.traits : [],
              status: c.status || "playable"
            };
          } else {
            if (!existing.portrait && c.portrait) existing.portrait = c.portrait;
            if ((!existing.traits || existing.traits.length === 0) && c.traits && c.traits.length > 0) existing.traits = c.traits;
            if (!existing.name && c.name) existing.name = c.name;
          }
        }
      }
    } catch (e) { /* ignore */ }

    // Convertir en tableau (exclure NPC/PVE/operators/NUE/war)
    const excludeStatus = new Set(["unplayable", "operator", "nue", "war"]);
    allCharsLoaded = Object.entries(chars)
      .filter(([id, c]) => !excludeStatus.has(c.status) && !id.startsWith("PVE_") && !id.startsWith("NUE"))
      .map(([id, c]) => ({
        id,
        name: c.name || id,
        portrait: c.portrait || null,
        traits: c.traits || [],
        status: c.status || "unknown",
        isNew: !charsLocalFileIds.has(id.toUpperCase())
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Remplir le select de traits avec option "Nouveaux" en premier
    const allTraits = new Set();
    allCharsLoaded.forEach(c => c.traits.forEach(t => allTraits.add(t)));
    const sortedTraits = [...allTraits].sort();
    const newCount = allCharsLoaded.filter(c => c.isNew).length;
    const currentFilter = charsFilterTrait.value;
    charsFilterTrait.innerHTML = '<option value="">Tous les traits</option>' +
      (newCount > 0 ? `<option value="__new__">Nouveaux (${newCount})</option>` : "") +
      sortedTraits.map(t => `<option value="${t}">${t}</option>`).join("");
    charsFilterTrait.value = currentFilter; // préserver le filtre actif

    renderCharsGrid();
  } catch (e) {
    console.error("[Chars] Erreur chargement:", e);
    charsGrid.innerHTML = '<div class="farm-no-results">Erreur de chargement</div>';
  }
}

function renderCharsGrid() {
  const search = charsSearch.value.toLowerCase().trim();
  const trait = charsFilterTrait.value;

  let filtered = allCharsLoaded;
  if (search) {
    const norm = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    filtered = filtered.filter(c => {
      const n = c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return n.includes(norm) || c.id.toLowerCase().includes(norm) ||
        c.traits.some(t => t.toLowerCase().includes(norm));
    });
  }
  if (trait === "__new__") {
    filtered = filtered.filter(c => c.isNew);
  } else if (trait) {
    filtered = filtered.filter(c => c.traits.includes(trait));
  }

  const newTotal = allCharsLoaded.filter(c => c.isNew).length;
  charsCount.textContent = `${filtered.length} / ${allCharsLoaded.length}` + (newTotal > 0 ? ` (${newTotal} nouveaux)` : "");

  charsGrid.innerHTML = filtered.map(c => {
    const portraitHtml = c.portrait
      ? `<img src="${c.portrait}" alt="${c.name}" loading="lazy">`
      : `<div class="chars-no-portrait">?</div>`;
    const traitsHtml = c.traits.slice(0, 6).map(t => `<span class="chars-trait">${t}</span>`).join("");
    const newBadge = c.isNew ? '<span class="chars-new-badge">NEW</span>' : "";
    return `<div class="chars-card${c.isNew ? ' new' : ''}">
      ${newBadge}
      ${portraitHtml}
      <div class="chars-name">${c.name}</div>
      <div class="chars-traits">${traitsHtml}</div>
    </div>`;
  }).join("");
}

// ═══════════════════════════════════════════════════════════
// CRUCIBLE DEFENSE PANEL
// ═══════════════════════════════════════════════════════════

const cruciblePanel = document.getElementById("crucible-panel");
const btnCrucible = document.getElementById("btn-crucible");
const btnCloseCrucible = document.getElementById("btn-close-crucible");
const crucibleLoading = document.getElementById("crucible-loading");
const crucibleError = document.getElementById("crucible-error");
const crucibleDefenseDiv = document.getElementById("crucible-defense");
const crucibleAttackDiv = document.getElementById("crucible-attack");
const crucibleList = document.getElementById("crucible-list");
const crucibleAttackList = document.getElementById("crucible-attack-list");
let crucibleCurrentTab = "defense";
let crucibleAttackLoaded = false;
let crucibleFavorites = new Set();

// Load crucible favorites from storage
(async function loadCrucibleFavorites() {
  const stored = await storageGet("msfCrucibleFavorites");
  if (stored.msfCrucibleFavorites && Array.isArray(stored.msfCrucibleFavorites)) {
    crucibleFavorites = new Set(stored.msfCrucibleFavorites);
  }
})();

function getCrucibleSquadKey(squad) {
  return (Array.isArray(squad) ? squad : []).sort().join(",");
}

async function toggleCrucibleFavorite(squadKey) {
  if (crucibleFavorites.has(squadKey)) {
    crucibleFavorites.delete(squadKey);
  } else {
    crucibleFavorites.add(squadKey);
  }
  await storageSet({ msfCrucibleFavorites: [...crucibleFavorites] });
}

if (btnCrucible) {
  btnCrucible.addEventListener("click", () => {
    cruciblePanel.classList.remove("hidden");
    cruciblePanel.scrollIntoView({ behavior: "smooth", block: "start" });
    if (crucibleCurrentTab === "defense") {
      loadCrucibleDefense();
    } else {
      loadCrucibleAttack();
    }
  });
}
if (btnCloseCrucible) {
  btnCloseCrucible.addEventListener("click", () => cruciblePanel.classList.add("hidden"));
}

// Onglets Crucible
const crucibleGuideDiv = document.getElementById("crucible-guide");

document.querySelectorAll(".crucible-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".crucible-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    crucibleCurrentTab = tab.dataset.tab;

    crucibleDefenseDiv.classList.add("hidden");
    crucibleAttackDiv.classList.add("hidden");
    if (crucibleGuideDiv) crucibleGuideDiv.classList.add("hidden");
    const s21Div = document.getElementById("crucible-season21");
    if (s21Div) s21Div.classList.add("hidden");

    if (crucibleCurrentTab === "defense") {
      crucibleDefenseDiv.classList.remove("hidden");
      loadCrucibleDefense();
    } else if (crucibleCurrentTab === "attack") {
      crucibleAttackDiv.classList.remove("hidden");
      loadCrucibleAttack();
    } else if (crucibleCurrentTab === "guide") {
      if (crucibleGuideDiv) crucibleGuideDiv.classList.remove("hidden");
      renderCrucibleGuide();
    } else if (crucibleCurrentTab === "season21") {
      if (s21Div) s21Div.classList.remove("hidden");
      renderSeason21Guide();
    }
  });
});

// ═══════════════════════════════════════════════════════════
// CRUCIBLE GUIDE — Marvel Church recommended setups
// ═══════════════════════════════════════════════════════════

const CRUCIBLE_GUIDE_DATA = {
  source: "Marvel Church",
  season: "Season 20",
  setups: [
    {
      name: "Defense Heavy",
      stages: [
        { stage: 1, team: "Starjammer", members: null },
        { stage: 2, team: "New Mutant", members: null },
        { stage: 3, team: null, members: ["Fantastic Four (MCU)", "Professor Xavier", "Blue Marvel or Apocalypse"], note: "FF MCU + Prof X + Blue Marvel ou Apocalypse" },
        { stage: 4, team: "Accursed", members: ["Accursed", "Superior Spider-Man", "Vulture"], note: "Sans Mordo, Juggernaut et Azazel" },
        { stage: 5, team: "Phoenix Force", members: ["Phoenix Force", "Old Man Logan", "Nightcrawler"], note: "Phoenix Force + Old Man Logan + Nightcrawler" },
        { stage: 6, team: null, members: ["Knull", "Gladiator", "Gorr", "Thanos Endgame", "The Leader"], note: "Equipe custom endgame" }
      ]
    },
    {
      name: "Offense Heavy",
      stages: [
        { stage: 1, team: "Vigilante", members: null },
        { stage: 2, team: "Undying", members: null },
        { stage: 3, team: null, members: ["Mephisto", "Super Skrull", "Quasar", "Adam Warlock", "Star-Lord"], note: "Equipe Mystic/Cosmic custom" },
        { stage: 4, team: "Accursed", members: ["Accursed", "Superior Spider-Man", "Vulture"], note: "Sans Mordo, Juggernaut et Azazel" },
        { stage: 5, team: "Phoenix Force", members: ["Phoenix Force", "Old Man Logan", "Nightcrawler"], note: "Phoenix Force + Old Man Logan + Nightcrawler" },
        { stage: 6, team: "Immortal Weapon", members: ["Immortal Weapon", "Blue Marvel or Odin"], note: "Immortal Weapon + Blue Marvel ou Odin" }
      ]
    }
  ]
};

function renderCrucibleGuide() {
  const container = document.getElementById("crucible-guide-content");
  if (!container) return;

  let html = `<div class="crucible-guide-header">
    <span class="crucible-guide-source">Source : ${CRUCIBLE_GUIDE_DATA.source} — ${CRUCIBLE_GUIDE_DATA.season}</span>
  </div>`;

  for (const setup of CRUCIBLE_GUIDE_DATA.setups) {
    html += `<div class="crucible-guide-setup">
      <div class="crucible-guide-setup-title">${setup.name}</div>`;

    for (const stage of setup.stages) {
      const teamLabel = stage.team || (stage.members ? stage.members.join(" + ") : "?");
      const stageColor = getStageColor(stage.stage);

      // Check player availability
      let availHtml = "";
      if (stage.team && typeof canMakeTeam === "function") {
        const status = canMakeTeam(stage.team);
        if (status) {
          if (status.available) {
            availHtml = `<span class="crucible-guide-avail ok">✓</span>`;
          } else {
            availHtml = `<span class="crucible-guide-avail miss">${status.hasCount}/${status.totalCount}</span>`;
          }
        }
      }

      html += `<div class="crucible-guide-stage">
        <div class="crucible-guide-stage-num" style="background:${stageColor};">${stage.stage}</div>
        <div class="crucible-guide-stage-info">
          <div class="crucible-guide-team-name">${teamLabel} ${availHtml}</div>
          ${stage.note ? `<div class="crucible-guide-note">${stage.note}</div>` : ""}
        </div>
      </div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html;
}

function getStageColor(stage) {
  const colors = { 1: "#51cf66", 2: "#339af0", 3: "#845ef7", 4: "#fcc419", 5: "#ff6b6b", 6: "#ff922b" };
  return colors[stage] || "#888";
}

async function loadCrucibleDefense() {
  crucibleLoading.classList.remove("hidden");
  crucibleError.classList.add("hidden");
  crucibleDefenseDiv.classList.add("hidden");

  try {
    // Charger les donnees personnages pour portraits et noms
    if (!charactersData) {
      const resp = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await resp.json();
    }

    const res = await new Promise((resolve) => {
      ext.runtime.sendMessage({ type: "MSF_GET_CRUCIBLE_DEFENSE" }, resolve);
    });

    crucibleLoading.classList.add("hidden");

    if (res.error) throw new Error(res.error);

    renderCrucibleDefense(res.data);

  } catch (e) {
    crucibleLoading.classList.add("hidden");
    crucibleError.innerHTML = `<div class="empty-state-cta"><p>${e.message}</p></div>`;
    crucibleError.classList.remove("hidden");
  }
}

let crucibleRawData = [];

function renderCrucibleDefense(data) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    crucibleList.innerHTML = '<div class="no-counters">Aucune donnee Crucible disponible</div>';
    crucibleDefenseDiv.classList.remove("hidden");
    return;
  }

  crucibleRawData = data;

  // Build character index from charactersData (id -> {name, portrait})
  const charIndex = {};
  const chars = charactersData?.characters || {};
  for (const [id, c] of Object.entries(chars)) {
    charIndex[id.toLowerCase()] = c;
  }

  // Resolve team names: squad is string[] like ["BlueMarvel", "FranklinRichards", ...]
  const teams = inverseCounters?.teams || [];
  data.forEach(entry => {
    const memberIds = Array.isArray(entry.squad) ? entry.squad : [];
    if (typeof matchSquadToTeam === "function" && teams.length > 0) {
      const match = matchSquadToTeam(memberIds, teams);
      entry._teamName = match ? match.team.name : "";
    } else {
      entry._teamName = "";
    }
    // Build searchable names
    entry._memberNames = memberIds.map(id => {
      const c = charIndex[id.toLowerCase()];
      return c ? c.name : id;
    });
  });

  // Sort by win rate descending
  const sorted = [...data].sort((a, b) => {
    const tA = (a.defends || 0) + (a.defeats || 0);
    const tB = (b.defends || 0) + (b.defeats || 0);
    return (tB > 0 ? b.defends / tB : 0) - (tA > 0 ? a.defends / tA : 0);
  });

  renderCrucibleList(sorted, charIndex);
}

function renderCrucibleList(entries, charIndex) {
  let html = `
    <div class="crucible-toolbar">
      <input type="text" id="crucible-search" class="crucible-search" placeholder="Rechercher une equipe ou un perso...">
      <select id="crucible-sort" class="crucible-sort">
        <option value="winrate">Taux victoire (%)</option>
        <option value="defends">Nb victoires (W)</option>
        <option value="defeats">Nb defaites (L)</option>
        <option value="total">Total combats</option>
      </select>
      <select id="crucible-min-fights" class="crucible-sort">
        <option value="0">Tous</option>
        <option value="50">50+ combats</option>
        <option value="100" selected>100+ combats</option>
        <option value="500">500+ combats</option>
        <option value="1000">1000+ combats</option>
      </select>
      <button id="crucible-fav-filter" class="crucible-fav-btn" title="Afficher les favoris">★</button>
    </div>
    <div class="crucible-count">${entries.length} equipes</div>`;

  html += renderCrucibleCards(entries, charIndex);

  crucibleList.innerHTML = html;
  crucibleDefenseDiv.classList.remove("hidden");

  const searchInput = document.getElementById("crucible-search");
  const sortSelect = document.getElementById("crucible-sort");
  const minFightsSelect = document.getElementById("crucible-min-fights");
  const favFilterBtn = document.getElementById("crucible-fav-filter");
  let showFavsOnly = false;

  const refresh = () => {
    const query = searchInput.value.toLowerCase().trim();
    const sortBy = sortSelect.value;
    const minFights = parseInt(minFightsSelect.value) || 0;

    let filtered = crucibleRawData;

    // Filtre favoris
    if (showFavsOnly) {
      filtered = filtered.filter(entry => {
        const key = getCrucibleSquadKey(Array.isArray(entry.squad) ? entry.squad : []);
        return crucibleFavorites.has(key);
      });
    }

    // Filtre minimum de combats
    if (minFights > 0) {
      filtered = filtered.filter(entry => ((entry.defends || 0) + (entry.defeats || 0)) >= minFights);
    }

    if (query) {
      filtered = filtered.filter(entry => {
        if ((entry._teamName || "").toLowerCase().includes(query)) return true;
        return (entry._memberNames || []).some(n => n.toLowerCase().includes(query));
      });
    }

    filtered = [...filtered].sort((a, b) => {
      const tA = (a.defends || 0) + (a.defeats || 0);
      const tB = (b.defends || 0) + (b.defeats || 0);
      switch (sortBy) {
        case "winrate": return (tB > 0 ? b.defends / tB : 0) - (tA > 0 ? a.defends / tA : 0);
        case "defends": return (b.defends || 0) - (a.defends || 0);
        case "defeats": return (b.defeats || 0) - (a.defeats || 0);
        case "total": return tB - tA;
        default: return 0;
      }
    });

    const cardsContainer = crucibleList.querySelector(".crucible-cards");
    const countEl = crucibleList.querySelector(".crucible-count");
    if (cardsContainer) cardsContainer.innerHTML = renderCrucibleCards(filtered, charIndex);
    if (countEl) countEl.textContent = `${filtered.length} equipes`;
  };

  searchInput.addEventListener("input", refresh);
  sortSelect.addEventListener("change", refresh);
  minFightsSelect.addEventListener("change", refresh);

  // Toggle fav filter
  if (favFilterBtn) {
    favFilterBtn.addEventListener("click", () => {
      showFavsOnly = !showFavsOnly;
      favFilterBtn.classList.toggle("active", showFavsOnly);
      refresh();
    });
  }

  // Star click delegation (defense)
  crucibleList.addEventListener("click", async (e) => {
    const star = e.target.closest(".crucible-fav-star");
    if (!star) return;
    const key = star.dataset.squadKey;
    if (!key) return;
    await toggleCrucibleFavorite(key);
    star.classList.toggle("active", crucibleFavorites.has(key));
  });

  // Appliquer le filtre initial (100+ combats par defaut)
  refresh();
}

function renderCrucibleCards(entries, charIndex) {
  let html = '<div class="crucible-cards">';

  entries.forEach((entry, idx) => {
    const memberIds = Array.isArray(entry.squad) ? entry.squad : [];
    const defends = entry.defends || 0;
    const defeats = entry.defeats || 0;
    const total = defends + defeats;
    const winRate = total > 0 ? ((defends / total) * 100).toFixed(1) : "0.0";
    const teamName = entry._teamName || "";

    // Portraits
    let membersHtml = '<div class="crucible-members">';
    memberIds.forEach(id => {
      const char = charIndex[id.toLowerCase()];
      const charName = char ? char.name : id.replace(/([A-Z])/g, " $1").trim();
      const portrait = char?.portrait || "";
      if (portrait) {
        membersHtml += `<img src="${portrait}" class="crucible-member-portrait" title="${charName}" alt="${charName}">`;
      } else {
        membersHtml += `<div class="crucible-member-placeholder" title="${charName}">${charName.substring(0, 2)}</div>`;
      }
    });
    membersHtml += "</div>";

    // Win rate color
    const rateNum = parseFloat(winRate);
    const rateColor = rateNum >= 60 ? "#51cf66" : rateNum >= 40 ? "#fcc419" : "#ff6b6b";

    const squadKey = getCrucibleSquadKey(memberIds);
    const isFav = crucibleFavorites.has(squadKey);

    html += `
      <div class="crucible-team-card">
        <div class="crucible-team-header">
          <span class="crucible-team-rank">${idx + 1}</span>
          <div class="crucible-team-title">
            ${teamName ? `<span class="crucible-team-name">${teamName}</span>` : `<span class="crucible-team-name-auto">${(entry._memberNames || memberIds).join(", ")}</span>`}
          </div>
          <button class="crucible-fav-star ${isFav ? 'active' : ''}" data-squad-key="${squadKey}" title="Favori">★</button>
          <span class="crucible-team-winrate" style="color:${rateColor};">${winRate}%</span>
        </div>
        ${membersHtml}
        <div class="crucible-team-stats">
          <span class="crucible-stat-win">${defends} W</span>
          <span class="crucible-stat-loss">${defeats} L</span>
          <span class="crucible-stat-total">${total} combats</span>
        </div>
      </div>`;
  });

  html += "</div>";
  return html;
}

// --- Crucible Attack ---
let crucibleAttackRawData = [];

async function loadCrucibleAttack() {
  if (crucibleAttackLoaded && crucibleAttackRawData.length > 0) return; // deja charge

  crucibleLoading.classList.remove("hidden");
  crucibleError.classList.add("hidden");

  try {
    if (!charactersData) {
      const resp = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await resp.json();
    }

    const res = await new Promise((resolve) => {
      ext.runtime.sendMessage({ type: "MSF_GET_CRUCIBLE_ATTACK" }, resolve);
    });

    crucibleLoading.classList.add("hidden");

    if (res.error) throw new Error(res.error);

    crucibleAttackRawData = Array.isArray(res.data) ? res.data : [];
    crucibleAttackLoaded = true;
    renderCrucibleAttack(crucibleAttackRawData);

  } catch (e) {
    crucibleLoading.classList.add("hidden");
    crucibleError.innerHTML = `<div class="empty-state-cta"><p>${e.message}</p></div>`;
    crucibleError.classList.remove("hidden");
  }
}

function renderCrucibleAttack(data) {
  const charIndex = {};
  const chars = charactersData?.characters || {};
  for (const [id, c] of Object.entries(chars)) {
    charIndex[id.toLowerCase()] = c;
  }

  if (!data || data.length === 0) {
    crucibleAttackList.innerHTML = '<div class="no-counters">Aucune donnee d\'attaque Crucible</div>';
    return;
  }

  // Resolve team names
  const teams = inverseCounters?.teams || [];
  data.forEach(entry => {
    const memberIds = Array.isArray(entry.squad) ? entry.squad : (entry.characters || entry.tpiIds || []);
    entry._squad = memberIds;
    if (!entry._teamName && typeof matchSquadToTeam === "function" && teams.length > 0) {
      const match = matchSquadToTeam(memberIds.map(m => typeof m === "string" ? m : (m.id || "")), teams);
      entry._teamName = match ? match.team.name : "";
    }
    entry._memberNames = memberIds.map(id => {
      const cid = typeof id === "string" ? id : (id.id || "");
      const c = charIndex[cid.toLowerCase()];
      return c ? c.name : cid.replace(/([A-Z])/g, " $1").trim();
    });
  });

  // Sort by win rate by default
  const sorted = [...data].sort((a, b) => {
    const wA = (a.defends || a.wins || 0), lA = (a.defeats || a.losses || 0), tA = wA + lA;
    const wB = (b.defends || b.wins || 0), lB = (b.defeats || b.losses || 0), tB = wB + lB;
    return (tB > 0 ? wB / tB : 0) - (tA > 0 ? wA / tA : 0);
  });

  // Build toolbar + cards
  let html = `
    <div class="crucible-toolbar">
      <input type="text" id="crucible-attack-search" class="crucible-search" placeholder="Rechercher...">
      <select id="crucible-attack-sort" class="crucible-sort">
        <option value="winrate">Taux victoire (%)</option>
        <option value="wins">Nb victoires (W)</option>
        <option value="losses">Nb defaites (L)</option>
        <option value="total">Total combats</option>
      </select>
      <select id="crucible-attack-min" class="crucible-sort">
        <option value="0">Tous</option>
        <option value="50">50+</option>
        <option value="100" selected>100+</option>
        <option value="500">500+</option>
      </select>
    </div>
    <div class="crucible-count crucible-attack-count">${sorted.length} equipes</div>
    <div class="crucible-cards crucible-attack-cards">`;

  sorted.forEach((entry, idx) => {
    html += renderCrucibleAttackCard(entry, idx, charIndex);
  });
  html += "</div>";

  crucibleAttackList.innerHTML = html;

  // Wire search, sort, and min fights filter
  const searchInput = document.getElementById("crucible-attack-search");
  const sortSelect = document.getElementById("crucible-attack-sort");
  const minSelect = document.getElementById("crucible-attack-min");

  const refreshAttack = () => {
    const query = (searchInput?.value || "").toLowerCase().trim();
    const sortBy = sortSelect?.value || "winrate";
    const minFights = parseInt(minSelect?.value) || 0;

    let filtered = crucibleAttackRawData;

    if (minFights > 0) {
      filtered = filtered.filter(e => {
        const w = e.defends || e.wins || 0, l = e.defeats || e.losses || 0;
        return (w + l) >= minFights;
      });
    }

    if (query) {
      filtered = filtered.filter(entry =>
        (entry._teamName || "").toLowerCase().includes(query) ||
        (entry._memberNames || []).some(n => n.toLowerCase().includes(query))
      );
    }

    filtered = [...filtered].sort((a, b) => {
      const wA = a.defends || a.wins || 0, lA = a.defeats || a.losses || 0, tA = wA + lA;
      const wB = b.defends || b.wins || 0, lB = b.defeats || b.losses || 0, tB = wB + lB;
      switch (sortBy) {
        case "winrate": return (tB > 0 ? wB / tB : 0) - (tA > 0 ? wA / tA : 0);
        case "wins": return wB - wA;
        case "losses": return lB - lA;
        case "total": return tB - tA;
        default: return 0;
      }
    });

    const container = crucibleAttackList.querySelector(".crucible-attack-cards");
    const countEl = crucibleAttackList.querySelector(".crucible-attack-count");
    if (container) container.innerHTML = filtered.map((e, i) => renderCrucibleAttackCard(e, i, charIndex)).join("");
    if (countEl) countEl.textContent = `${filtered.length} equipes`;
  };

  if (searchInput) searchInput.addEventListener("input", refreshAttack);
  if (sortSelect) sortSelect.addEventListener("change", refreshAttack);
  if (minSelect) minSelect.addEventListener("change", refreshAttack);

  // Star click delegation (attack)
  crucibleAttackList.addEventListener("click", async (e) => {
    const star = e.target.closest(".crucible-fav-star");
    if (!star) return;
    const key = star.dataset.squadKey;
    if (!key) return;
    await toggleCrucibleFavorite(key);
    star.classList.toggle("active", crucibleFavorites.has(key));
  });

  // Apply initial filter (100+)
  refreshAttack();
}

function renderCrucibleAttackCard(entry, idx, charIndex) {
  const memberIds = entry._squad || entry.squad || [];
  const teamName = entry._teamName || "";

  // Detect fields — format might differ from defense
  const defends = entry.defends || entry.wins || 0;
  const defeats = entry.defeats || entry.losses || 0;
  const total = defends + defeats;
  const winRate = total > 0 ? ((defends / total) * 100).toFixed(1) : null;
  const score = entry.score || entry.rank || null;

  let membersHtml = '<div class="crucible-members">';
  memberIds.forEach(id => {
    const cid = typeof id === "string" ? id : (id.id || id.characterId || "");
    const char = charIndex[cid.toLowerCase()];
    const charName = char ? char.name : cid.replace(/([A-Z])/g, " $1").trim();
    const portrait = char?.portrait || "";
    if (portrait) {
      membersHtml += `<img src="${portrait}" class="crucible-member-portrait" title="${charName}">`;
    } else {
      membersHtml += `<div class="crucible-member-placeholder" title="${charName}">${charName.substring(0, 2)}</div>`;
    }
  });
  membersHtml += "</div>";

  const rateColor = winRate ? (parseFloat(winRate) >= 60 ? "#51cf66" : parseFloat(winRate) >= 40 ? "#fcc419" : "#ff6b6b") : "#888";

  let statsHtml = "";
  if (winRate) {
    statsHtml = `<div class="crucible-team-stats">
      <span class="crucible-stat-win">${defends} W</span>
      <span class="crucible-stat-loss">${defeats} L</span>
      <span class="crucible-stat-total">${total} combats</span>
    </div>`;
  } else if (score != null) {
    statsHtml = `<div class="crucible-team-stats"><span>Score: ${score}</span></div>`;
  }

  const squadKey = getCrucibleSquadKey(memberIds);
  const isFav = crucibleFavorites.has(squadKey);

  return `
    <div class="crucible-team-card" style="border-left-color:#00d4ff;">
      <div class="crucible-team-header">
        <span class="crucible-team-rank" style="background:#00d4ff;">${idx + 1}</span>
        <div class="crucible-team-title">
          ${teamName ? `<span class="crucible-team-name">${teamName}</span>` : `<span class="crucible-team-name-auto">${(entry._memberNames || []).join(", ")}</span>`}
        </div>
        <button class="crucible-fav-star ${isFav ? 'active' : ''}" data-squad-key="${squadKey}" title="Favori">★</button>
        ${winRate ? `<span class="crucible-team-winrate" style="color:${rateColor};">${winRate}%</span>` : ""}
      </div>
      ${membersHtml}
      ${statsHtml}
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// CRUCIBLE SEASON 21 GUIDE
// ═══════════════════════════════════════════════════════════

let season21Rendered = false;

function renderSeason21Guide() {
  const container = document.getElementById("crucible-season21-content");
  if (!container || season21Rendered) return;
  season21Rendered = true;

  // Season 21 data based on official patch notes
  const season = {
    name: "Saison 21 — The Moon Cycle",
    global: {
      title: "Regle globale — The Moon Cycle",
      desc: "Les persos Daring Warrior avec des allies Eclipse gagnent des bonus selon la phase lunaire (dmg/heal/focus). En defense: +20% PV max, +10% degats, +1 Exhausted apres chaque attaque completee.",
      tip: "La regle defense rend chaque equipe plus tanky. Privilegiez des equipes offensives capables de finir vite pour limiter l'Exhausted."
    },
    stages: [
      {
        num: 1, name: "Standard",
        rule: "Aucune regle speciale (globale uniquement).",
        tip: "Placez vos meilleures equipes meta ici sans contrainte.",
        defTeams: ["Annihilator", "Undying", "Accursed", "Bifrost"],
        atkTeams: ["Hivemind", "Orchis", "Cabal", "Out of Time"],
        reason: "Pas de regle de stage — les equipes les plus fortes dominent naturellement."
      },
      {
        num: 2, name: "Standard",
        rule: "Aucune regle speciale (globale uniquement).",
        tip: "Deuxieme room standard. Continuez avec vos equipes meta restantes.",
        defTeams: ["Nightstalker", "Pegasus", "Secret Warrior", "Darkhunter"],
        atkTeams: ["Tangled", "Astral", "Vigilante", "Brimstone"],
        reason: "Room standard — placez vos equipes meta #2."
      },
      {
        num: 3, name: "Combat Support",
        rule: "Fortifier/Healer: +1 Vulnerable par hit. Raider/Skirmisher: +2. Striker: +3. Tous: +100% degats par Vulnerable sur l'attaquant. Clear Vulnerable en fin de tour.",
        tip: "Les Strikers empilent le plus de Vulnerable (+3/hit) et beneficient du +100% dmg. Privilegiez des equipes avec beaucoup de Strikers et des attaques multi-hit.",
        defTeams: ["Hivemind", "Accursed", "Undying"],
        atkTeams: ["Orchis", "Annihilator", "Bifrost", "Cabal"],
        reason: "Strikers = +3 Vuln/hit + 100% dmg bonus. Les equipes avec multi-hit Strikers explosent les degats. En defense, misez sur la survie car les attaquants frapperont tres fort."
      },
      {
        num: 4, name: "R&R",
        rule: "Soin → Offense Up. Tour de n'importe quel perso: ceux avec Offense Up gagnent Defense Up. Ceux avec Offense Down gagnent 15% PV max en barriere.",
        tip: "Les equipes avec beaucoup de soins generent Offense Up + Defense Up en boucle. En attaque, evitez d'appliquer Offense Down car ca donne des barrieres a l'adversaire.",
        defTeams: ["Undying", "Bifrost", "Pegasus", "Secret Defender"],
        atkTeams: ["Nightstalker", "Darkhunter", "Brimstone", "Vigilante"],
        reason: "Undying/Bifrost ont d'excellents soins → Offense Up + Defense Up permanent. Evitez Offense Down en attaque (barrieres gratuites pour l'ennemi)."
      },
      {
        num: 5, name: "Best Buddies",
        rule: "Les persos Retcon, X-Men, Avengers et Spider-Verse gagnent TOUS les traits Retcon + X-Men + Avenger + Spider-Verse.",
        tip: "Enorme pour les equipes de ces factions! Les synergies cross-trait explosent. Retcon en particulier gagne tous les autres traits.",
        defTeams: ["Retcon", "Astonishing X-Men", "Xtreme", "Spider Society"],
        atkTeams: ["Retcon", "Unlimited X-Men", "Xtreme", "New Warrior"],
        reason: "Retcon gagne les traits X-Men + Avenger + Spider-Verse en plus des siens — synergies demultipliees. Toute equipe X-Men/Avenger/Spider-Verse beneficie des traits croises."
      },
      {
        num: 6, name: "Raids Up!",
        rule: "Vigilante, Thunderbolts, Immortal Weapons, Hellfire Club, Insidious 6, Champions gagnent TOUS les traits de ces 6 factions + 100% stats primaires.",
        tip: "Ces equipes deviennent extremement puissantes avec +100% stats. Priorite absolue aux Vigilante et Thunderbolts qui sont les plus meta de cette liste.",
        defTeams: ["Vigilante", "Thunderbolt", "Hellfire Club", "Immortal Weapon"],
        atkTeams: ["Vigilante", "Thunderbolt", "Insidious Six", "Champions"],
        reason: "+100% stats primaires est enorme. Vigilante et Thunderbolts sont deja meta — avec ce boost ils deviennent quasi imbattables dans ce stage."
      }
    ]
  };

  let html = `<div class="s21-header">
    <div class="s21-title">${season.name}</div>
    <div class="s21-global">
      <div class="s21-rule-title">${season.global.title}</div>
      <div class="s21-rule-desc">${season.global.desc}</div>
      <div class="s21-tip">${season.global.tip}</div>
    </div>
  </div>`;

  for (const stage of season.stages) {
    html += `<div class="s21-stage">
      <div class="s21-stage-header">
        <div class="s21-stage-num">${stage.num}</div>
        <div class="s21-stage-name">${stage.name}</div>
      </div>
      <div class="s21-rule-desc">${stage.rule}</div>
      <div class="s21-tip">${stage.tip}</div>
      <div class="s21-teams-row">
        <div class="s21-teams-col">
          <div class="s21-teams-label def-label">Defense</div>
          ${stage.defTeams.map(t => `<div class="s21-team-pill s21-def">${t}</div>`).join("")}
        </div>
        <div class="s21-teams-col">
          <div class="s21-teams-label atk-label">Attaque</div>
          ${stage.atkTeams.map(t => `<div class="s21-team-pill s21-atk">${t}</div>`).join("")}
        </div>
      </div>
      <div class="s21-reason">${stage.reason}</div>
    </div>`;
  }

  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// ALLIANCE PANEL
// ═══════════════════════════════════════════════════════════

const alliancePanel = document.getElementById("alliance-panel");
const btnAlliance = document.getElementById("btn-alliance");
const btnCloseAlliance = document.getElementById("btn-close-alliance");
const allianceLoading = document.getElementById("alliance-loading");
const allianceError = document.getElementById("alliance-error");
const allianceCardDiv = document.getElementById("alliance-card");
const allianceMembersDiv = document.getElementById("alliance-members");
const allianceMembersList = document.getElementById("alliance-members-list");
const allianceSortSelect = document.getElementById("alliance-sort");

let allianceData = { card: null, members: [] };

btnAlliance.addEventListener("click", async () => {
  alliancePanel.classList.remove("hidden");
  alliancePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!allianceData.card) {
    await loadAlliance();
  }
});

btnCloseAlliance.addEventListener("click", () => {
  alliancePanel.classList.add("hidden");
});

allianceSortSelect.addEventListener("change", () => {
  renderAllianceMembers(allianceData.members);
});

async function loadAlliance() {
  allianceLoading.classList.remove("hidden");
  allianceError.classList.add("hidden");
  allianceCardDiv.classList.add("hidden");
  allianceMembersDiv.classList.add("hidden");

  try {
    // Charger card + members en parallele
    const [cardRes, membersRes] = await Promise.all([
      ext.runtime.sendMessage({ type: "MSF_GET_ALLIANCE_CARD" }),
      ext.runtime.sendMessage({ type: "MSF_GET_ALLIANCE_MEMBERS" })
    ]);

    allianceLoading.classList.add("hidden");

    if (cardRes.error) throw new Error(cardRes.error);
    if (membersRes.error) throw new Error(membersRes.error);

    allianceData.card = cardRes.data;
    allianceData.members = Array.isArray(membersRes.data) ? membersRes.data : [];


    renderAllianceCard(allianceData.card);
    renderAllianceMembers(allianceData.members);

  } catch (e) {
    allianceLoading.classList.add("hidden");
    allianceError.innerHTML = `<div class="empty-state-cta"><p>${e.message}</p><button class="btn-open-api">Connecter mon compte</button></div>`;
    allianceError.classList.remove("hidden");
    // Wire le bouton API
    allianceError.querySelector(".btn-open-api")?.addEventListener("click", () => {
      alliancePanel.classList.add("hidden");
      document.getElementById("api-panel")?.classList.remove("hidden");
      document.getElementById("api-panel")?.scrollIntoView({ behavior: "smooth" });
    });
  }
}

function renderAllianceCard(card) {
  if (!card) return;

  const level = (typeof card.level === "object") ? (card.level.completedTier || card.level.current || "?") : (card.level || "?");
  const league = card.warLeague?.name || "?";
  const trophies = card.warTrophies ?? "?";
  const zone = card.warZone || "?";
  const zoneLabel = { 1: "1h GMT", 2: "7h GMT", 3: "13h GMT", 4: "19h GMT" }[zone] || zone;

  let html = `
    <div class="alliance-card-info">
      ${card.icon ? `<img src="${card.icon}" class="alliance-icon" alt="">` : ""}
      <div class="alliance-card-details">
        <div class="alliance-name">${card.name || "Alliance"}</div>
        <div class="alliance-meta">Niveau ${level} · ${card.type === "private" ? "Privee" : "Publique"}</div>
        ${card.description ? `<div class="alliance-desc">${card.description}</div>` : ""}
      </div>
    </div>
    <div class="alliance-stats">
      <div class="alliance-stat"><span class="alliance-stat-value">${league}</span><span class="alliance-stat-label">Ligue War</span></div>
      <div class="alliance-stat"><span class="alliance-stat-value">${formatNumber(trophies)}</span><span class="alliance-stat-label">Trophees</span></div>
      <div class="alliance-stat"><span class="alliance-stat-value">Zone ${zone}</span><span class="alliance-stat-label">${zoneLabel}</span></div>
    </div>`;

  allianceCardDiv.innerHTML = html;
  allianceCardDiv.classList.remove("hidden");
}

function getMemberLevel(card) {
  if (!card) return 0;
  if (typeof card.level === "number") return card.level;
  if (card.level?.current) return card.level.current;
  if (card.level?.completedTier) return card.level.completedTier;
  if (card.completedTier) return card.completedTier;
  return 0;
}

function renderAllianceMembers(members) {
  if (!members || members.length === 0) {
    allianceMembersList.innerHTML = '<div class="no-counters">Aucun membre trouve</div>';
    allianceMembersDiv.classList.remove("hidden");
    return;
  }

  const sortBy = allianceSortSelect.value;

  const sorted = [...members].sort((a, b) => {
    const ca = a.card || {};
    const cb = b.card || {};
    switch (sortBy) {
      case "tcp": return (cb.tcp || 0) - (ca.tcp || 0);
      case "stp": return (cb.stp || 0) - (ca.stp || 0);
      case "level": return (getMemberLevel(cb) - getMemberLevel(ca));
      case "name": return (ca.name || "").localeCompare(cb.name || "");
      case "collected": return (cb.charactersCollected || 0) - (ca.charactersCollected || 0);
      case "mvp": return (cb.warMvp || 0) - (ca.warMvp || 0);
      default: return (cb.tcp || 0) - (ca.tcp || 0);
    }
  });

  const rankColors = { leader: "#fcc419", captain: "#845ef7", member: "#8b949e" };
  const rankLabels = { leader: "Leader", captain: "Capitaine", member: "Membre" };

  // Calculate averages for comparison
  const tcpValues = sorted.map(m => m.card?.tcp || 0).filter(v => v > 0);
  const stpValues = sorted.map(m => m.card?.stp || 0).filter(v => v > 0);
  const avgTcp = tcpValues.length > 0 ? tcpValues.reduce((a, b) => a + b, 0) / tcpValues.length : 0;
  const avgStp = stpValues.length > 0 ? stpValues.reduce((a, b) => a + b, 0) / stpValues.length : 0;

  let html = `<div class="alliance-member-count">${sorted.length} membres · Moy: ${formatNumber(Math.round(avgTcp))} TCP / ${formatNumber(Math.round(avgStp))} STP</div>`;

  sorted.forEach((m, i) => {
    const c = m.card || {};
    const rank = m.rank || "member";
    const rankColor = rankColors[rank] || "#8b949e";
    const level = c.level?.current || c.level?.completedTier || c.level || c.completedTier || "?";
    const tcp = c.tcp || 0;
    const stp = c.stp || 0;
    const belowAvg = tcp > 0 && tcp < avgTcp * 0.85; // 15% below average

    html += `
      <div class="alliance-member-row ${belowAvg ? 'below-avg' : ''}">
        <div class="alliance-member-rank" style="color:${rankColor};">${i + 1}</div>
        <div class="alliance-member-info">
          <div class="alliance-member-name">
            ${c.name || "???"}
            <span class="alliance-member-badge" style="background:${rankColor}22;color:${rankColor};">${rankLabels[rank] || rank}</span>
            ${belowAvg ? '<span class="alliance-below-badge">▼</span>' : ''}
          </div>
          <div class="alliance-member-meta">Nv.${level} · ${formatNumber(tcp)} TCP · ${formatNumber(stp)} STP</div>
        </div>
        <div class="alliance-member-extra">
          <span title="Personnages collectes">${c.charactersCollected || 0} persos</span>
          ${c.warMvp ? `<span title="War MVP">MVP x${c.warMvp}</span>` : ""}
        </div>
      </div>`;
  });

  allianceMembersList.innerHTML = html;
  allianceMembersDiv.classList.remove("hidden");
}

// ============================================
// Bouton Exporter
// ============================================

btnExport.addEventListener("click", async () => {
  try {
    const stored = await storageGet(["msfZonesConfig", "msfPortraits"]);

    const defStored = await storageGet(["msfDefenseTagged", "msfBackground"]);

    const exportData = {
      version: 2,
      exportDate: new Date().toISOString(),
      zones: stored.msfZonesConfig || null,
      portraits: stored.msfPortraits || {},
      defenseTagged: defStored.msfDefenseTagged || [],
      background: defStored.msfBackground || ""
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

    if (data.defenseTagged && Array.isArray(data.defenseTagged)) {
      await storageSet({ msfDefenseTagged: data.defenseTagged });
    }

    if (data.background) {
      await storageSet({ msfBackground: data.background });
      applyBackground(data.background);
    }

    const zoneCount = data.zones ? data.zones.slots.length : 0;
    const portraitCount = data.portraits ? Object.keys(data.portraits).length : 0;
    const defCount = data.defenseTagged ? data.defenseTagged.length : 0;
    setStatus(`Importe: ${zoneCount} slots, ${portraitCount} portraits${defCount ? ", " + defCount + " defenses" : ""}`, "success");

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

  // Afficher les stats + historique
  await loadWarStats();
  const historyHtml = await renderWarHistoryAsync();
  warStatsContent.innerHTML = displayWarStats() + historyHtml;
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

  // Save scan session to war history
  saveWarScanSession();
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
  html += `<button class="scan-room-btn-export" id="btn-war-planner" style="background:#51cf66;color:#000;" title="Generer un plan d'attaque optimal">Plan d'attaque</button>`;
  html += `<button class="scan-room-btn-export" id="btn-war-export" style="background:#845ef7;color:#fff;" title="Copier le plan dans le presse-papier (Discord)">Copier</button>`;
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

    // Zone plan d'attaque (remplie par generateWarPlan)
    html += `<div class="war-planner-zone hidden" id="war-plan-${t}"></div>`;

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

  // War Planner button
  const btnPlan = document.getElementById("btn-war-planner");
  if (btnPlan) {
    btnPlan.addEventListener("click", async (e) => {
      e.stopPropagation();
      btnPlan.disabled = true;
      btnPlan.textContent = "Calcul...";
      try {
        await generateWarPlan();
      } catch (err) {
        console.error("[WarPlanner] Erreur:", err);
      }
      btnPlan.disabled = false;
      btnPlan.textContent = "Plan d'attaque";
    });
  }

  // War Export (clipboard, Discord format)
  const btnExportPlan = document.getElementById("btn-war-export");
  if (btnExportPlan) {
    btnExportPlan.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const text = exportWarPlanToText();
        await navigator.clipboard.writeText(text);
        btnExportPlan.textContent = "Copie !";
        setTimeout(() => { btnExportPlan.textContent = "Copier"; }, 2000);
      } catch (err) {
        btnExportPlan.textContent = "Erreur";
        setTimeout(() => { btnExportPlan.textContent = "Copier"; }, 2000);
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

  // Pre-load crucible attack winrates for cross-reference badges
  if (!crucibleAttackWinrateCache) loadCrucibleAttackWinrates();

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
          ${getCrucibleXrefBadge(c.teamId)}
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

// ═══════════════════════════════════════════════════════════
// WAR PLANNER — auto-assign best counters per team card
// Uses: war squads, roster, defense tags
// ═══════════════════════════════════════════════════════════

/**
 * Check if a counter team can be formed from the player's war squads
 * (registered squads from the API, not just general roster).
 * Returns { found: bool, squadMembers: [], inDefense: [] }
 */
function checkWarSquadAvailability(counterTeamId, warSquads, defCharIds) {
  if (!warSquads || warSquads.length === 0) return null;

  const team = teamsData.find(t => t.id === counterTeamId);
  if (!team || !team.memberIds) return null;

  // Check if any war squad contains all team members
  for (const squad of warSquads) {
    if (!Array.isArray(squad)) continue;
    const squadSet = new Set(squad.filter(Boolean));
    const allPresent = team.memberIds.every(id => squadSet.has(id));
    if (allPresent) {
      const inDef = team.memberIds.filter(id => defCharIds.has(id));
      return { found: true, squadMembers: team.memberIds, inDefense: inDef, isWarSquad: true };
    }
  }

  return { found: false, squadMembers: [], inDefense: [], isWarSquad: false };
}

async function generateWarPlan() {
  if (!scanRoomState || !warAnalyzer) return;

  const hasRoster = typeof playerRoster !== "undefined" && playerRoster.size > 0;

  // Load war squads and defense info
  const stored = await storageGet(["msfWarSquads", "msfDefenseTagged"]);
  const warSquads = stored.msfWarSquads || [];
  const tagged = stored.msfDefenseTagged || [];

  // Build set of all chars currently in defense
  const defCharIds = new Set();
  for (const idx of tagged) {
    const squad = warSquads[idx];
    if (squad) squad.forEach(id => { if (id) defCharIds.add(id); });
  }

  // Track used attack team IDs across all assignments (greedy no-overlap)
  const usedTeamIds = new Set();

  // Phase 1: collect all targets with their counters
  const targets = [];
  for (let t = 0; t < scanRoomState.teams.length; t++) {
    const team = scanRoomState.teams[t];
    if (team.underAttack) continue;
    const charIds = team.portraits.filter(p => p.charId).map(p => p.charId);
    if (charIds.length < 3) continue;

    const teamResult = warAnalyzer._identifyTeamFromCharIds(charIds);
    if (!teamResult || !teamResult.team) continue;

    const powerInput = document.getElementById(`power-input-${t}`);
    const powerRaw = powerInput?.value?.trim().replace(/[\s,.]/g, "") || "";
    const enemyPower = /^\d{5,}$/.test(powerRaw) ? parseInt(powerRaw, 10) : (team.enemyPower || null);

    const countersResult = warAnalyzer.getCountersWithVariants(teamResult.team.id, charIds, enemyPower);
    const counters = countersResult?.counters || [];

    // Enrich each counter with war squad + roster + defense info
    const enriched = [];
    for (const c of counters) {
      const rosterStatus = typeof canMakeTeam === "function" ? canMakeTeam(c.teamId) : null;
      const warStatus = checkWarSquadAvailability(c.teamId, warSquads, defCharIds);
      let playerPower = null;
      if (enemyPower) {
        playerPower = await getTeamPowerFromRoster(c.teamId);
      }

      // Priority: war squad registered > roster available > roster partial > nothing
      const inWarSquad = warStatus?.found || false;
      const rosterAvail = rosterStatus?.available || false;
      const inDefense = warStatus?.found ? warStatus.inDefense : (rosterStatus?.inDefense || []);
      const blockedByDef = inDefense.length > 0;

      enriched.push({
        ...c,
        _rosterStatus: rosterStatus,
        _warStatus: warStatus,
        playerPower,
        inWarSquad,
        rosterAvail,
        inDefense,
        blockedByDef
      });
    }

    targets.push({
      teamIdx: t,
      slotNumber: team.slotNumber,
      teamName: teamResult.team.nameFr || teamResult.team.variantName || teamResult.team.name,
      enemyPower,
      counters: enriched
    });
  }

  if (targets.length === 0) return;

  // Phase 2: Greedy assignment (hardest targets first = fewest usable counters)
  const sortedTargets = [...targets].sort((a, b) => {
    const aUsable = a.counters.filter(c => (c.inWarSquad || c.rosterAvail) && !c.blockedByDef).length;
    const bUsable = b.counters.filter(c => (c.inWarSquad || c.rosterAvail) && !c.blockedByDef).length;
    return aUsable - bUsable;
  });

  const assignments = {}; // teamIdx -> { bestCounter, alternates }

  for (const target of sortedTargets) {
    let bestCounter = null;
    let bestScore = -Infinity;
    const alternates = [];

    for (const c of target.counters) {
      let score = c.confidence * 10;

      // Bonus: in war squad and not in defense
      if (c.inWarSquad && !c.blockedByDef) score += 200;
      // Bonus: in war squad but some in defense
      else if (c.inWarSquad) score += 100;
      // Bonus: in roster, not in defense
      else if (c.rosterAvail && !c.blockedByDef) score += 80;
      // Bonus: in roster, some in defense
      else if (c.rosterAvail) score += 40;

      // Punch advantage
      if (c.playerPower && target.enemyPower) {
        const punchFactor = confidenceToPunchFactor(c.confidence);
        const punchPct = ((c.playerPower * punchFactor) - target.enemyPower) / target.enemyPower * 100;
        score += Math.min(punchPct, 50);
      }

      // Penalty if already used by another target
      if (usedTeamIds.has(c.teamId)) {
        score -= 500;
      }

      if (score > bestScore) {
        // Push previous best as alternate
        if (bestCounter) alternates.push(bestCounter);
        bestScore = score;
        bestCounter = c;
      } else {
        alternates.push(c);
      }
    }

    assignments[target.teamIdx] = { bestCounter, alternates: alternates.slice(0, 2) };

    if (bestCounter && !usedTeamIds.has(bestCounter.teamId)) {
      usedTeamIds.add(bestCounter.teamId);
    }
  }

  // Phase 3: Render into each team's war-plan-{t} zone
  for (const target of targets) {
    const zone = document.getElementById(`war-plan-${target.teamIdx}`);
    if (!zone) continue;

    const { bestCounter, alternates } = assignments[target.teamIdx] || {};

    let html = '<div class="war-planner-title">Suggestion d\'attaque</div>';

    if (!bestCounter) {
      html += `<div class="war-planner-empty">Pas de counter disponible</div>`;
    } else {
      html += renderWarPlanCard(bestCounter, target, hasRoster, warSquads.length > 0);

      // Show up to 2 alternatives
      if (alternates && alternates.length > 0) {
        html += `<div style="font-size:10px;color:#666;margin:4px 0 2px;">Alternatives :</div>`;
        for (const alt of alternates) {
          html += renderWarPlanCard(alt, target, hasRoster, warSquads.length > 0);
        }
      }
    }

    zone.innerHTML = html;
    zone.classList.remove("hidden");
  }
}

function renderWarPlanCard(counter, target, hasRoster, hasWarSquads) {
  const isWarSquad = counter.inWarSquad && !counter.blockedByDef;
  const isRosterOk = counter.rosterAvail && !counter.blockedByDef;
  const cardClass = isWarSquad ? "" : (isRosterOk ? "" : "partial");

  let availHtml = "";
  if (isWarSquad) {
    availHtml = `<span class="war-planner-available">Equipe de guerre enregistree</span>`;
  } else if (counter.inWarSquad && counter.blockedByDef) {
    const defNames = counter.inDefense.map(id => {
      const c = charactersData?.characters?.[id];
      return c ? c.name : id;
    }).join(", ");
    availHtml = `<span class="war-planner-unavailable">Equipe de guerre — en defense: ${defNames}</span>`;
  } else if (isRosterOk) {
    availHtml = `<span class="war-planner-available">Disponible dans le roster</span>`;
  } else if (counter.rosterAvail && counter.blockedByDef) {
    const defNames = counter.inDefense.map(id => {
      const c = charactersData?.characters?.[id];
      return c ? c.name : id;
    }).join(", ");
    availHtml = `<span class="war-planner-unavailable">En defense: ${defNames}</span>`;
  } else if (counter._rosterStatus) {
    availHtml = `<span class="war-planner-unavailable">${counter._rosterStatus.hasCount}/${counter._rosterStatus.totalCount} persos dans le roster</span>`;
  }

  const confStars = confidenceToSymbols(counter.confidence);
  let powerHtml = "";
  if (counter.playerPower && target.enemyPower) {
    const fmtP = typeof formatPower === "function" ? formatPower(counter.playerPower) : counter.playerPower.toLocaleString();
    const fmtE = typeof formatPower === "function" ? formatPower(target.enemyPower) : target.enemyPower.toLocaleString();
    const punchFactor = confidenceToPunchFactor(counter.confidence);
    const punch = getPunchIndicator(counter.playerPower, target.enemyPower, punchFactor);
    powerHtml = ` <span style="font-size:10px;color:#888;">(${fmtP} vs ${fmtE}${punch ? ` <span style="color:${punch.color}">${punch.label}</span>` : ""})</span>`;
  }

  return `<div class="war-planner-card ${cardClass}">
    <div class="war-planner-counter-name">${counter.teamName} ${confStars}${powerHtml}</div>
    ${counter.notes ? `<div style="font-size:10px;color:#888;margin-top:2px;">${counter.notes}</div>` : ""}
    <div class="war-planner-availability">${availHtml}</div>
  </div>`;
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

// ===== BACKGROUND PICKER =====
const BG_IMAGES = [
  "AdamWarlock-mobile.jpg",
  "AgentVenom-mobile.jpg",
  "Annihilus-mobile.jpg",
  "AnnihilusV2-mobile.jpg",
  "BlackBolt-mobile.jpg",
  "Blade-mobile.jpg",
  "Blastaar-mobile.jpg",
  "CaptainAmericaWW2-mobile.jpg",
  "CaptainMarvel-mobile.jpg",
  "Cyclops-mobile.jpg",
  "Darkstar-mobile.jpg",
  "Deadpool-PoolParty-mobile.jpg",
  "JeffTheLandShark-mobile.jpg",
  "Odin-mobile.jpg",
  "Pandapool-mobile.jpg",
  "RedSkull-mobile.jpg",
  "SpiderManNoir-mobile.jpg",
  "SquirrelGirl-mobile.jpg",
  "ZombieScarletWitch-mobile.jpg"
];

function bgImageUrl(filename) {
  return ext.runtime.getURL(`data/backgrounds/${filename}`);
}

function bgLabelFromFilename(name) {
  return name.replace("-mobile.jpg", "").replace(/([A-Z])/g, " $1").replace(/- /g, " ").trim();
}

function applyBackground(filename) {
  if (!filename) {
    document.body.classList.remove("has-bg-image");
    document.body.style.removeProperty("--bg-image");
    return;
  }
  const url = bgImageUrl(filename);
  document.body.classList.add("has-bg-image");
  document.body.style.setProperty("--bg-image", `url('${url}')`);
}

// Load saved background on startup
(async function initBackground() {
  const { msfBackground } = await storageGet("msfBackground");
  if (msfBackground) applyBackground(msfBackground);
})();

// Info overlay
(function initInfoOverlay() {
  const btn = document.getElementById("btn-info");
  const overlay = document.getElementById("info-overlay");
  const btnClose = document.getElementById("btn-info-close");
  if (!btn || !overlay) return;

  btn.addEventListener("click", () => overlay.classList.remove("hidden"));
  if (btnClose) btnClose.addEventListener("click", () => overlay.classList.add("hidden"));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.add("hidden");
  });
})();

// Background picker UI
(function initBgPicker() {
  const btnOpen = document.getElementById("btn-bg-picker");
  const overlay = document.getElementById("bg-picker-overlay");
  const btnClose = document.getElementById("btn-bg-picker-close");
  const grid = document.getElementById("bg-picker-grid");
  if (!btnOpen || !overlay || !grid) return;

  btnOpen.addEventListener("click", async () => {
    const { msfBackground } = await storageGet("msfBackground");
    grid.innerHTML = "";

    // "None" option
    const noneItem = document.createElement("div");
    noneItem.className = "bg-picker-item bg-none" + (!msfBackground ? " active" : "");
    noneItem.innerHTML = `<i data-lucide="x"></i><span>Aucun</span>`;
    noneItem.addEventListener("click", async () => {
      await storageSet({ msfBackground: "" });
      applyBackground(null);
      overlay.classList.add("hidden");
    });
    grid.appendChild(noneItem);

    // Image options
    for (const file of BG_IMAGES) {
      const item = document.createElement("div");
      item.className = "bg-picker-item" + (msfBackground === file ? " active" : "");
      item.innerHTML = `<img src="${bgImageUrl(file)}" loading="lazy" alt="${bgLabelFromFilename(file)}"><div class="bg-picker-label">${bgLabelFromFilename(file)}</div>`;
      item.addEventListener("click", async () => {
        await storageSet({ msfBackground: file });
        applyBackground(file);
        overlay.classList.add("hidden");
      });
      grid.appendChild(item);
    }

    overlay.classList.remove("hidden");
    // Re-init Lucide for the X icon in "none" tile
    if (typeof lucide !== "undefined") lucide.createIcons({ attrs: { class: "" } });
  });

  btnClose.addEventListener("click", () => overlay.classList.add("hidden"));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.add("hidden");
  });
})();

// ═══════════════════════════════════════════════════════════
// DASHBOARD PANEL (Player Card + Roster Analytics + Upgrade Tokens + Inventory)
// ═══════════════════════════════════════════════════════════

const dashboardPanel = document.getElementById("dashboard-panel");
const btnDashboard = document.getElementById("btn-dashboard");
const btnCloseDashboard = document.getElementById("btn-close-dashboard");
const dashboardLoading = document.getElementById("dashboard-loading");
const dashboardError = document.getElementById("dashboard-error");
const dashboardPlayerCard = document.getElementById("dashboard-player-card");
const dashboardRosterStats = document.getElementById("dashboard-roster-stats");
const dashboardUpgradeTokens = document.getElementById("dashboard-upgrade-tokens");
const dashboardInventory = document.getElementById("dashboard-inventory");
let dashboardLoaded = false;

if (btnDashboard) {
  btnDashboard.addEventListener("click", () => {
    dashboardPanel.classList.remove("hidden");
    dashboardPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!dashboardLoaded) loadDashboard();
  });
}
if (btnCloseDashboard) {
  btnCloseDashboard.addEventListener("click", () => dashboardPanel.classList.add("hidden"));
}

async function loadDashboard() {
  dashboardLoading.classList.remove("hidden");
  dashboardError.classList.add("hidden");
  dashboardPlayerCard.classList.add("hidden");
  dashboardRosterStats.classList.add("hidden");
  dashboardUpgradeTokens.classList.add("hidden");
  dashboardInventory.classList.add("hidden");

  try {
    if (!charactersData) {
      const resp = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await resp.json();
    }

    // Parallel API calls
    const [cardRes, inventoryRes] = await Promise.all([
      new Promise(r => ext.runtime.sendMessage({ type: "MSF_GET_PLAYER_CARD" }, r)),
      new Promise(r => ext.runtime.sendMessage({ type: "MSF_GET_INVENTORY" }, r))
    ]);

    dashboardLoading.classList.add("hidden");
    dashboardLoaded = true;

    console.log("[Dashboard] Player Card:", JSON.stringify(cardRes, null, 2).substring(0, 1000));
    console.log("[Dashboard] Inventory:", JSON.stringify(inventoryRes, null, 2).substring(0, 1000));

    // Player Card
    if (cardRes && !cardRes.error) {
      renderPlayerCard(cardRes.data);
      // Save TCP/STP snapshot for history
      await saveTcpSnapshot(cardRes.data);
    } else {
      console.warn("[Dashboard] Player Card error:", cardRes?.error);
    }

    // Roster Analytics (from local storage — no API call needed)
    await renderRosterAnalytics();

    // TCP History Chart
    await renderTcpHistoryChart();

    // Roster Gap Analysis (vs Crucible top teams)
    await renderRosterGapAnalysis();

    // "Who to level" recommendations
    await renderRecommendations();

    // Gear bottleneck analysis
    if (inventoryRes && !inventoryRes.error && inventoryRes.data) {
      await renderGearBottleneck(inventoryRes.data);
    }

    // Inventory
    if (inventoryRes && !inventoryRes.error && inventoryRes.data) {
      renderInventory(inventoryRes.data);
    } else {
      console.warn("[Dashboard] Inventory error:", inventoryRes?.error);
    }

  } catch (e) {
    dashboardLoading.classList.add("hidden");
    dashboardError.innerHTML = `<div class="empty-state-cta"><p>${e.message}</p></div>`;
    dashboardError.classList.remove("hidden");
  }
}

function renderPlayerCard(data) {
  if (!data) return;
  const name = data.name || "Joueur";
  const lvlObj = typeof data.level === "object" ? data.level : null;
  const level = lvlObj ? (lvlObj.completedTier || "?") : (data.level || "?");
  const tcp = data.tcp || 0;
  const stp = data.stp || 0;
  const collected = data.charactersCollected || 0;
  const maxStars = data.charactersAtMaxStarRank || 0;
  const arena = data.latestArena || "";
  const warMvp = data.warMvp || 0;
  const blitzRank = data.latestBlitz || "";
  // Find avatar: could be nested in icon/portrait/avatar objects or direct URL
  const findUrl = (...keys) => {
    for (const k of keys) {
      const v = data[k];
      if (!v) continue;
      if (typeof v === "string" && v.startsWith("http")) return v;
      if (typeof v === "object" && v.url) return v.url;
      if (typeof v === "object" && v.image) return v.image;
    }
    return "";
  };
  const icon = findUrl("icon", "portrait", "avatar", "avatarUrl", "profilePic", "image", "thumbnailUrl");
  const frame = findUrl("frame", "frameUrl", "profileFrame", "border");
  console.log("[Dashboard] Player card full data:", JSON.stringify(data, null, 2).substring(0, 2000));

  let xpHtml = "";
  if (lvlObj && lvlObj.goal > 0) {
    const xpPct = Math.round((lvlObj.points / lvlObj.goal) * 100);
    xpHtml = `<div class="dash-xp"><div class="dash-xp-bar" style="width:${xpPct}%"></div><span class="dash-xp-label">XP ${formatNumber(lvlObj.points)} / ${formatNumber(lvlObj.goal)} (${xpPct}%)</span></div>`;
  }

  dashboardPlayerCard.innerHTML = `
    <div class="dash-card">
      <div class="dash-card-header">
        ${icon ? `<div class="dash-avatar">${frame ? `<img src="${frame}" class="dash-frame">` : ""}<img src="${icon}" class="dash-icon"></div>` : ""}
        <div>
          <div class="dash-card-name">${name}</div>
          <div class="dash-card-level">Niveau ${level}</div>
          ${xpHtml}
        </div>
      </div>
      <div class="dash-card-stats">
        <div class="dash-stat"><span class="dash-stat-value">${formatNumber(tcp)}</span><span class="dash-stat-label">TCP</span></div>
        <div class="dash-stat"><span class="dash-stat-value">${formatNumber(stp)}</span><span class="dash-stat-label">STP</span></div>
        <div class="dash-stat"><span class="dash-stat-value">${collected}</span><span class="dash-stat-label">Persos</span></div>
        <div class="dash-stat"><span class="dash-stat-value" style="color:#fcc419;">${maxStars}</span><span class="dash-stat-label">7 etoiles</span></div>
        ${arena ? `<div class="dash-stat"><span class="dash-stat-value" style="color:#51cf66;">#${arena}</span><span class="dash-stat-label">Arena</span></div>` : ""}
        ${warMvp ? `<div class="dash-stat"><span class="dash-stat-value" style="color:#ff6b6b;">${warMvp}</span><span class="dash-stat-label">War MVP</span></div>` : ""}
        ${blitzRank ? `<div class="dash-stat"><span class="dash-stat-value">#${formatNumber(blitzRank)}</span><span class="dash-stat-label">Blitz</span></div>` : ""}
      </div>
    </div>`;
  dashboardPlayerCard.classList.remove("hidden");
}

async function renderRosterAnalytics() {
  const stored = await storageGet(["msfPlayerRosterFull"]);
  const roster = stored.msfPlayerRosterFull;
  if (!roster || !Array.isArray(roster) || roster.length === 0) {
    dashboardRosterStats.innerHTML = '<div class="dash-section-title">Roster Analytics</div><div class="no-counters">Pas de roster. Utilisez "Récupérer Squads" dans le panneau API.</div>';
    dashboardRosterStats.classList.remove("hidden");
    return;
  }

  const total = roster.length;
  const star7 = roster.filter(c => (c.stars || c.activeYellow || 0) >= 7).length;
  const star6 = roster.filter(c => (c.stars || c.activeYellow || 0) >= 6).length;
  const gearTier = roster.map(c => c.gearTier || c.tier || 0);
  const avgGear = gearTier.length > 0 ? (gearTier.reduce((a, b) => a + b, 0) / gearTier.length).toFixed(1) : "?";
  const maxGear = Math.max(...gearTier, 0);
  const powers = roster.map(c => c.power || 0).filter(p => p > 0);
  const avgPower = powers.length > 0 ? Math.round(powers.reduce((a, b) => a + b, 0) / powers.length) : 0;
  const maxPower = Math.max(...powers, 0);
  const g19Plus = roster.filter(c => (c.gearTier || c.tier || 0) >= 19).length;
  const g17Plus = roster.filter(c => (c.gearTier || c.tier || 0) >= 17).length;

  dashboardRosterStats.innerHTML = `
    <div class="dash-section-title">Roster Analytics</div>
    <div class="dash-roster-grid">
      <div class="dash-roster-stat"><span class="dash-roster-value">${total}</span><span class="dash-roster-label">Total</span></div>
      <div class="dash-roster-stat"><span class="dash-roster-value" style="color:#fcc419;">${star7}</span><span class="dash-roster-label">7 etoiles</span></div>
      <div class="dash-roster-stat"><span class="dash-roster-value" style="color:#fcc419;">${star6}</span><span class="dash-roster-label">6+ etoiles</span></div>
      <div class="dash-roster-stat"><span class="dash-roster-value" style="color:#00d4ff;">${avgGear}</span><span class="dash-roster-label">Gear moyen</span></div>
      <div class="dash-roster-stat"><span class="dash-roster-value" style="color:#51cf66;">${g19Plus}</span><span class="dash-roster-label">G19+</span></div>
      <div class="dash-roster-stat"><span class="dash-roster-value" style="color:#51cf66;">${g17Plus}</span><span class="dash-roster-label">G17+</span></div>
      <div class="dash-roster-stat"><span class="dash-roster-value">${formatNumber(avgPower)}</span><span class="dash-roster-label">Power moyen</span></div>
      <div class="dash-roster-stat"><span class="dash-roster-value">${formatNumber(maxPower)}</span><span class="dash-roster-label">Power max</span></div>
    </div>`;
  dashboardRosterStats.classList.remove("hidden");
}

function renderUpgradeTokens(data) {
  const tokens = Array.isArray(data) ? data : (data.data || []);
  if (tokens.length === 0) return;

  let html = '<div class="dash-section-title">Upgrade Tokens</div><div class="dash-tokens-list">';
  tokens.forEach(t => {
    const name = t.name || t.templateId || t.id || "Token";
    const quantity = t.quantity || t.amount || 0;
    html += `<div class="dash-token"><span class="dash-token-name">${name}</span><span class="dash-token-qty">${formatNumber(quantity)}</span></div>`;
  });
  html += '</div>';
  dashboardUpgradeTokens.innerHTML = html;
  dashboardUpgradeTokens.classList.remove("hidden");
}

// Parse inventory item ID into readable name and category
function parseInventoryItem(itemId) {
  const id = itemId || "";
  // Determine category from prefix
  let cat = "Autre";
  if (id.startsWith("GEAR_")) cat = "Gear";
  else if (id.startsWith("ABILITY_MATERIAL")) cat = "Ability";
  else if (id.startsWith("CONSUMABLE_")) cat = "Consommable";
  else if (id.startsWith("CURRENCY_")) cat = "Monnaie";
  else if (id.startsWith("SHARD_")) cat = "Fragments";
  else if (id.startsWith("ORB_")) cat = "Orbes";
  else if (id.startsWith("CATALYST_")) cat = "Catalyseur";
  else if (id.startsWith("ISO_") || id.includes("ISO")) cat = "ISO-8";
  else if (id.startsWith("TEAL_") || id.includes("TEAL")) cat = "Teal Gear";
  else if (id.startsWith("T4_") || id.includes("T4")) cat = "T4 Ability";

  // Humanize the name: remove prefix, replace _ with space, title case
  let name = id
    .replace(/^(GEAR_|ABILITY_MATERIAL_|CONSUMABLE_|CURRENCY_|SHARD_|ORB_|CATALYST_|ISO_)/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bMat\b/g, "Material")
    .replace(/\bXp\b/g, "XP");

  return { name, cat };
}

function renderInventory(data) {
  const items = Array.isArray(data) ? data : (data.items || data.data || []);
  if (items.length === 0) return;

  // Parse and group items
  const grouped = {};
  items.forEach(raw => {
    const { name, cat } = parseInventoryItem(raw.item || raw.itemId || raw.id);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ name, quantity: raw.quantity || 0 });
  });

  // Sort categories by total quantity, show top items per category
  const sortedCats = Object.entries(grouped).sort((a, b) => {
    const totalA = a[1].reduce((s, i) => s + i.quantity, 0);
    const totalB = b[1].reduce((s, i) => s + i.quantity, 0);
    return totalB - totalA;
  });

  let html = `<div class="dash-section-title">Inventaire (${items.length} items)</div><div class="dash-inventory">`;
  for (const [cat, catItems] of sortedCats) {
    const sorted = catItems.sort((a, b) => b.quantity - a.quantity).slice(0, 8);
    const totalQty = catItems.reduce((s, i) => s + i.quantity, 0);
    html += `<div class="dash-inv-category"><span class="dash-inv-cat-name">${cat} <span style="color:#888;font-weight:400;">(${catItems.length} items, ${formatNumber(totalQty)} total)</span></span>`;
    sorted.forEach(item => {
      html += `<div class="dash-inv-item"><span>${item.name}</span><span>${formatNumber(item.quantity)}</span></div>`;
    });
    if (catItems.length > 8) {
      html += `<div class="dash-inv-item" style="color:#666;font-style:italic;"><span>+${catItems.length - 8} autres</span><span></span></div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  dashboardInventory.innerHTML = html;
  dashboardInventory.classList.remove("hidden");
}

// ═══════════════════════════════════════════════════════════
// TCP HISTORY — save daily snapshots and render SVG chart
// ═══════════════════════════════════════════════════════════

async function saveTcpSnapshot(cardData) {
  if (!cardData) return;
  const tcp = cardData.tcp || 0;
  const stp = cardData.stp || 0;
  if (tcp === 0) return;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const stored = await storageGet("msfTcpHistory");
  const history = stored.msfTcpHistory || [];

  // Only one snapshot per day
  const existing = history.find(h => h.date === today);
  if (existing) {
    existing.tcp = tcp;
    existing.stp = stp;
  } else {
    history.push({ date: today, tcp, stp });
  }

  // Keep last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const trimmed = history.filter(h => h.date >= cutoffStr);

  await storageSet({ msfTcpHistory: trimmed });
}

async function renderTcpHistoryChart() {
  const container = document.getElementById("dashboard-tcp-history");
  if (!container) return;

  const stored = await storageGet("msfTcpHistory");
  const history = (stored.msfTcpHistory || []).sort((a, b) => a.date.localeCompare(b.date));

  if (history.length < 2) {
    container.innerHTML = `
      <div class="tcp-history-title">Progression TCP/STP</div>
      <div class="tcp-chart-container"><div class="tcp-no-data">Pas assez de donnees (revenez demain)</div></div>`;
    container.classList.remove("hidden");
    return;
  }

  const W = 340, H = 100, PX = 30, PY = 10;
  const plotW = W - PX * 2, plotH = H - PY * 2;

  const allTcp = history.map(h => h.tcp);
  const allStp = history.map(h => h.stp);
  const minVal = Math.min(...allTcp, ...allStp) * 0.98;
  const maxVal = Math.max(...allTcp, ...allStp) * 1.02;
  const range = maxVal - minVal || 1;

  const xScale = (i) => PX + (i / (history.length - 1)) * plotW;
  const yScale = (v) => PY + plotH - ((v - minVal) / range) * plotH;

  function buildPath(values) {
    return values.map((v, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(" ");
  }

  function buildArea(values) {
    const line = values.map((v, i) => `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(" L");
    return `M${xScale(0).toFixed(1)},${yScale(minVal).toFixed(1)} L${line} L${xScale(values.length - 1).toFixed(1)},${yScale(minVal).toFixed(1)} Z`;
  }

  // X-axis labels (first, middle, last)
  const labelIndices = [0, Math.floor(history.length / 2), history.length - 1];
  const labelsHtml = labelIndices.map(i => {
    const d = history[i].date.slice(5); // MM-DD
    return `<text x="${xScale(i)}" y="${H}" class="tcp-chart-label" text-anchor="middle">${d}</text>`;
  }).join("");

  // Y-axis labels
  const yLabels = [
    `<text x="${PX - 4}" y="${PY + 4}" class="tcp-chart-label" text-anchor="end">${formatNumber(Math.round(maxVal))}</text>`,
    `<text x="${PX - 4}" y="${PY + plotH + 4}" class="tcp-chart-label" text-anchor="end">${formatNumber(Math.round(minVal))}</text>`
  ].join("");

  // Dots (last point only for cleanliness)
  const lastI = history.length - 1;
  const dotsHtml = `
    <circle cx="${xScale(lastI)}" cy="${yScale(allTcp[lastI])}" class="tcp-chart-dot tcp-chart-dot-tcp"/>
    <circle cx="${xScale(lastI)}" cy="${yScale(allStp[lastI])}" class="tcp-chart-dot tcp-chart-dot-stp"/>`;

  // Variation text
  const tcpDiff = allTcp[lastI] - allTcp[0];
  const stpDiff = allStp[lastI] - allStp[0];
  const tcpPct = allTcp[0] > 0 ? ((tcpDiff / allTcp[0]) * 100).toFixed(1) : "0";
  const stpPct = allStp[0] > 0 ? ((stpDiff / allStp[0]) * 100).toFixed(1) : "0";
  const tcpSign = tcpDiff >= 0 ? "+" : "";
  const stpSign = stpDiff >= 0 ? "+" : "";

  container.innerHTML = `
    <div class="tcp-history-title">Progression TCP/STP (${history.length} jours)</div>
    <div class="tcp-chart-container">
      <svg class="tcp-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <path d="${buildArea(allTcp)}" class="tcp-chart-area-tcp"/>
        <path d="${buildArea(allStp)}" class="tcp-chart-area-stp"/>
        <path d="${buildPath(allTcp)}" class="tcp-chart-line tcp-chart-line-tcp"/>
        <path d="${buildPath(allStp)}" class="tcp-chart-line tcp-chart-line-stp"/>
        ${dotsHtml}
        ${labelsHtml}
        ${yLabels}
      </svg>
    </div>
    <div class="tcp-chart-legend">
      <span><span class="tcp-legend-dot" style="background:#51cf66;"></span>TCP ${tcpSign}${formatNumber(tcpDiff)} (${tcpSign}${tcpPct}%)</span>
      <span><span class="tcp-legend-dot" style="background:#339af0;"></span>STP ${stpSign}${formatNumber(stpDiff)} (${stpSign}${stpPct}%)</span>
    </div>`;
  container.classList.remove("hidden");
}

// ═══════════════════════════════════════════════════════════
// ROSTER GAP ANALYSIS — compare roster vs top Crucible teams
// ═══════════════════════════════════════════════════════════

async function renderRosterGapAnalysis() {
  const container = document.getElementById("dashboard-roster-gap");
  if (!container) return;

  if (playerRoster.size === 0) {
    container.innerHTML = `<div class="roster-gap-title">Analyse Roster vs Crucible</div><div class="no-counters">Pas de roster charge.</div>`;
    container.classList.remove("hidden");
    return;
  }

  // Load crucible defense data
  let crucibleData;
  try {
    const res = await new Promise(r => ext.runtime.sendMessage({ type: "MSF_GET_CRUCIBLE_DEFENSE" }, r));
    if (res.error || !res.data || !Array.isArray(res.data)) {
      container.innerHTML = `<div class="roster-gap-title">Analyse Roster vs Crucible</div><div class="no-counters">Donnees Crucible non disponibles.</div>`;
      container.classList.remove("hidden");
      return;
    }
    crucibleData = res.data;
  } catch (e) {
    return;
  }

  if (!charactersData) {
    try {
      const resp = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await resp.json();
    } catch (e) { return; }
  }
  const charIndex = {};
  for (const [id, c] of Object.entries(charactersData?.characters || {})) {
    charIndex[id.toLowerCase()] = c;
  }

  // Load farming locations
  let farmingData = null;
  try {
    const resp = await fetch(ext.runtime.getURL("data/farming-locations.json"));
    farmingData = await resp.json();
  } catch (e) { /* ignore */ }

  // Sort crucible teams by win rate, take top 20
  const sorted = [...crucibleData]
    .map(e => {
      const t = (e.defends || 0) + (e.defeats || 0);
      return { ...e, _total: t, _winrate: t > 0 ? e.defends / t : 0 };
    })
    .filter(e => e._total >= 100)
    .sort((a, b) => b._winrate - a._winrate)
    .slice(0, 20);

  // Analyze gaps
  const gaps = [];
  for (const entry of sorted) {
    const squad = Array.isArray(entry.squad) ? entry.squad : [];
    const members = squad.map(id => {
      const char = charIndex[id.toLowerCase()];
      const name = char ? char.name : id.replace(/([A-Z])/g, " $1").trim();
      const owned = playerRoster.has(id);
      const portrait = char?.portrait || "";

      // Find farm location
      let farmHint = "";
      if (!owned && farmingData?.characters) {
        const farmChar = farmingData.characters[id];
        if (farmChar?.locations?.length > 0) {
          farmHint = farmChar.locations.slice(0, 2).map(l => l.name || l).join(", ");
        }
      }

      return { id, name, owned, portrait, farmHint };
    });

    const missing = members.filter(m => !m.owned);
    if (missing.length === 0) continue; // full team, no gap

    // Resolve team name
    const teams = inverseCounters?.teams || [];
    let teamName = "";
    if (typeof matchSquadToTeam === "function" && teams.length > 0) {
      const match = matchSquadToTeam(squad, teams);
      teamName = match ? match.team.name : "";
    }
    if (!teamName) teamName = members.map(m => m.name).join(", ");

    gaps.push({
      teamName,
      winrate: (entry._winrate * 100).toFixed(1),
      members,
      missing,
      total: entry._total
    });
  }

  if (gaps.length === 0) {
    container.innerHTML = `<div class="roster-gap-title">Analyse Roster vs Crucible</div><div class="no-counters">Vous avez toutes les equipes du top 20 Crucible !</div>`;
    container.classList.remove("hidden");
    return;
  }

  // Sort by fewest missing (closest to complete)
  gaps.sort((a, b) => a.missing.length - b.missing.length);

  let html = `<div class="roster-gap-title">Analyse Roster vs Top Crucible (${gaps.length} equipes incompletes)</div>`;

  for (const gap of gaps.slice(0, 10)) {
    html += `<div class="roster-gap-card">
      <div class="roster-gap-team-name">${gap.teamName} <span style="color:#888;font-size:10px;">(${gap.winrate}% WR, ${gap.total} combats)</span></div>
      <div class="roster-gap-members">`;

    for (const m of gap.members) {
      const cls = m.owned ? "owned" : "missing";
      const icon = m.owned ? "✓" : "✗";
      html += `<div class="roster-gap-member ${cls}">
        ${m.portrait ? `<img src="${m.portrait}" class="roster-gap-member-portrait">` : ""}
        ${icon} ${m.name}
      </div>`;
    }

    html += `</div>`;

    // Show farm hints for missing
    const farmHints = gap.missing.filter(m => m.farmHint);
    if (farmHints.length > 0) {
      html += `<div class="roster-gap-summary">Farm: ${farmHints.map(m => `${m.name} → ${m.farmHint}`).join(" · ")}</div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html;
  container.classList.remove("hidden");
}

// ═══════════════════════════════════════════════════════════
// TIER LIST PANEL (Team Order rankings by mode)
// ═══════════════════════════════════════════════════════════

const tierlistPanel = document.getElementById("tierlist-panel");
const btnTierlist = document.getElementById("btn-tierlist");
const btnCloseTierlist = document.getElementById("btn-close-tierlist");
const tierlistLoading = document.getElementById("tierlist-loading");
const tierlistError = document.getElementById("tierlist-error");
const tierlistList = document.getElementById("tierlist-list");
let tierlistCurrentMode = "war";
let tierlistCache = {};

if (btnTierlist) {
  btnTierlist.addEventListener("click", () => {
    tierlistPanel.classList.remove("hidden");
    tierlistPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    loadTierList(tierlistCurrentMode);
  });
}
if (btnCloseTierlist) {
  btnCloseTierlist.addEventListener("click", () => tierlistPanel.classList.add("hidden"));
}

// Tab switching
document.querySelectorAll(".tierlist-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tierlist-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    tierlistCurrentMode = tab.dataset.mode;
    loadTierList(tierlistCurrentMode);
  });
});

async function loadTierList(mode) {
  // Use cache if available
  if (tierlistCache[mode]) {
    renderTierList(tierlistCache[mode], mode);
    return;
  }

  tierlistLoading.classList.remove("hidden");
  tierlistError.classList.add("hidden");
  tierlistList.innerHTML = "";

  try {
    if (!charactersData) {
      const resp = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await resp.json();
    }

    const res = await new Promise(r => {
      ext.runtime.sendMessage({ type: "MSF_GET_TEAM_ORDER", tabId: mode }, r);
    });

    tierlistLoading.classList.add("hidden");

    if (res.error) throw new Error(res.error);

    tierlistCache[mode] = res.data;
    renderTierList(res.data, mode);

  } catch (e) {
    tierlistLoading.classList.add("hidden");
    tierlistError.innerHTML = `<div class="empty-state-cta"><p>${e.message}</p></div>`;
    tierlistError.classList.remove("hidden");
  }
}

function renderTierList(data, mode) {
  const entries = Array.isArray(data) ? data : (data.data || []);
  if (entries.length === 0) {
    tierlistList.innerHTML = '<div class="no-counters">Aucune donnee disponible pour ce mode</div>';
    return;
  }

  const charIndex = {};
  const chars = charactersData?.characters || {};
  for (const [id, c] of Object.entries(chars)) {
    charIndex[id.toLowerCase()] = c;
  }

  const teams = inverseCounters?.teams || [];
  const modeLabels = { war: "War", crucible: "Crucible", raids: "Raids", arena: "Arena", blitz: "Blitz" };

  let html = `<div class="tierlist-header-info">${modeLabels[mode] || mode} — ${entries.length} equipes classees</div><div class="tierlist-cards">`;

  entries.forEach((entry, idx) => {
    const memberIds = Array.isArray(entry.squad) ? entry.squad :
                      Array.isArray(entry.characters) ? entry.characters :
                      Array.isArray(entry.members) ? entry.members : [];

    // Team name matching
    let teamName = entry.name || entry.teamName || "";
    if (!teamName && typeof matchSquadToTeam === "function" && teams.length > 0) {
      const match = matchSquadToTeam(memberIds, teams);
      teamName = match ? match.team.name : "";
    }
    const memberNames = memberIds.map(id => {
      const c = charIndex[id.toLowerCase()];
      return c ? c.name : id.replace(/([A-Z])/g, " $1").trim();
    });

    // Score/rank
    const score = entry.score || entry.rank || entry.rating || "";
    const wins = entry.wins || entry.defends || 0;
    const losses = entry.losses || entry.defeats || 0;
    const total = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "";

    // Tier badge color
    let tierColor = "#d4af37";
    if (idx < 5) tierColor = "#ff6b6b";
    else if (idx < 15) tierColor = "#fcc419";
    else if (idx < 30) tierColor = "#51cf66";
    else tierColor = "#00d4ff";

    // Portraits
    let membersHtml = '<div class="crucible-members">';
    memberIds.forEach(id => {
      const char = charIndex[id.toLowerCase()];
      const charName = char ? char.name : id.replace(/([A-Z])/g, " $1").trim();
      const portrait = char?.portrait || "";
      if (portrait) {
        membersHtml += `<img src="${portrait}" class="crucible-member-portrait" title="${charName}" alt="${charName}">`;
      } else {
        membersHtml += `<div class="crucible-member-placeholder" title="${charName}">${charName.substring(0, 2)}</div>`;
      }
    });
    membersHtml += "</div>";

    html += `
      <div class="tierlist-card">
        <div class="crucible-team-header">
          <span class="crucible-team-rank" style="background:${tierColor};">${idx + 1}</span>
          <div class="crucible-team-title">
            ${teamName ? `<span class="crucible-team-name">${teamName}</span>` : `<span class="crucible-team-name-auto">${memberNames.join(", ")}</span>`}
          </div>
          ${winRate ? `<span class="crucible-team-winrate" style="color:${parseFloat(winRate) >= 50 ? "#51cf66" : "#ff6b6b"};">${winRate}%</span>` : ""}
          ${score && !winRate ? `<span class="crucible-team-winrate" style="color:#d4af37;">Score: ${score}</span>` : ""}
        </div>
        ${membersHtml}
        ${total > 0 ? `<div class="crucible-team-stats"><span class="crucible-stat-win">${wins} W</span><span class="crucible-stat-loss">${losses} L</span><span class="crucible-stat-total">${total} combats</span></div>` : ""}
      </div>`;
  });

  html += '</div>';
  tierlistList.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// OFFERS PANEL
// ═══════════════════════════════════════════════════════════

const offersPanel = document.getElementById("offers-panel");
const btnOffers = document.getElementById("btn-offers");
const btnCloseOffers = document.getElementById("btn-close-offers");
const offersLoading = document.getElementById("offers-loading");
const offersError = document.getElementById("offers-error");
const offersList = document.getElementById("offers-list");
let offersLoaded = false;

if (btnOffers) {
  btnOffers.addEventListener("click", () => {
    offersPanel.classList.remove("hidden");
    offersPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!offersLoaded) loadOffers();
  });
}
if (btnCloseOffers) {
  btnCloseOffers.addEventListener("click", () => offersPanel.classList.add("hidden"));
}

async function loadOffers() {
  offersLoading.classList.remove("hidden");
  offersError.classList.add("hidden");
  offersList.innerHTML = "";

  try {
    const res = await new Promise(r => {
      ext.runtime.sendMessage({ type: "MSF_GET_OFFERS" }, r);
    });

    offersLoading.classList.add("hidden");
    offersLoaded = true;

    if (res.error) throw new Error(res.error);

    renderOffers(res.data);

  } catch (e) {
    offersLoading.classList.add("hidden");
    offersError.innerHTML = `<div class="empty-state-cta"><p>${e.message}</p></div>`;
    offersError.classList.remove("hidden");
  }
}

function renderOffers(data) {
  const offers = Array.isArray(data) ? data : (data.offers || data.data || []);
  if (offers.length === 0) {
    offersList.innerHTML = '<div class="no-counters">Aucune offre active</div>';
    return;
  }

  const now = Date.now() / 1000;

  let html = `<div class="offers-count">${offers.length} offres</div><div class="offers-cards">`;

  offers.forEach(offer => {
    const name = offer.name || offer.title || offer.offerId || "Offre";
    const desc = offer.description || "";
    const endTime = offer.endTime || offer.expiresAt || 0;
    const remaining = endTime > now ? formatTimeRemaining(endTime - now) : "Expiree";
    const price = offer.price || offer.cost || "";
    const currency = offer.currency || offer.costCurrency || "";
    const quantity = offer.quantity || offer.purchasesRemaining || "";
    const maxPurchases = offer.maxPurchases || offer.purchaseLimit || "";

    // Rewards
    let rewardsHtml = "";
    const rewards = offer.rewards || offer.items || [];
    if (Array.isArray(rewards) && rewards.length > 0) {
      rewardsHtml = '<div class="offer-rewards">';
      rewards.slice(0, 5).forEach(r => {
        const rName = r.name || r.itemName || r.itemId || "?";
        const rQty = r.quantity || r.amount || 1;
        rewardsHtml += `<span class="offer-reward">${rQty}x ${rName}</span>`;
      });
      if (rewards.length > 5) rewardsHtml += `<span class="offer-reward">+${rewards.length - 5} autres</span>`;
      rewardsHtml += '</div>';
    }

    html += `
      <div class="offer-card">
        <div class="offer-header">
          <span class="offer-name">${name}</span>
          <span class="offer-timer">${remaining}</span>
        </div>
        ${desc ? `<div class="offer-desc">${desc}</div>` : ""}
        ${rewardsHtml}
        <div class="offer-footer">
          ${price ? `<span class="offer-price">${price} ${currency}</span>` : ""}
          ${quantity && maxPurchases ? `<span class="offer-qty">${quantity}/${maxPurchases}</span>` : ""}
        </div>
      </div>`;
  });

  html += '</div>';
  offersList.innerHTML = html;
}

function formatTimeRemaining(seconds) {
  if (seconds <= 0) return "Expiree";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ═══════════════════════════════════════════════════════════
// TIME HEISTS (added to Events panel)
// ═══════════════════════════════════════════════════════════

async function loadTimeHeists() {
  const section = document.getElementById("time-heists-section");
  const list = document.getElementById("time-heists-list");
  if (!section || !list) return;

  try {
    const res = await new Promise(r => {
      ext.runtime.sendMessage({ type: "MSF_GET_TIME_HEISTS" }, r);
    });

    if (res.error || !res.data) return;

    const heists = Array.isArray(res.data) ? res.data : (res.data.data || []);
    if (heists.length === 0) return;

    let html = '';
    for (const heist of heists) {
      const name = heist.name || heist.id || "Time Heist";
      const status = heist.status || "";
      const endTime = heist.endTime || 0;
      const now = Date.now() / 1000;
      const remaining = endTime > now ? formatTimeRemaining(endTime - now) : "";

      // Try to get TCP projection
      let tcpHtml = "";
      if (heist.id) {
        try {
          const tcpRes = await new Promise(r => {
            ext.runtime.sendMessage({ type: "MSF_GET_TIME_HEIST_TCP", itemId: heist.id }, r);
          });
          if (tcpRes && !tcpRes.error && tcpRes.data) {
            const tcp = tcpRes.data.tcp || tcpRes.data.projectedTcp || tcpRes.data;
            if (typeof tcp === "number") {
              tcpHtml = `<span class="heist-tcp">TCP projet: ${formatNumber(tcp)}</span>`;
            }
          }
        } catch (_) { /* ignore */ }
      }

      html += `
        <div class="heist-card">
          <div class="heist-header">
            <span class="heist-name">${name}</span>
            ${remaining ? `<span class="heist-timer">${remaining}</span>` : ""}
          </div>
          ${status ? `<div class="heist-status">${status}</div>` : ""}
          ${tcpHtml}
        </div>`;
    }

    list.innerHTML = html;
    section.classList.remove("hidden");

  } catch (e) {
    console.log("[TimeHeists] Erreur:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// GEAR BOTTLENECK ANALYZER
// ═══════════════════════════════════════════════════════════

async function renderGearBottleneck(inventoryData) {
  const container = document.getElementById("dashboard-gear-bottleneck");
  if (!container) return;
  if (playerRoster.size === 0) return;

  const items = Array.isArray(inventoryData) ? inventoryData : (inventoryData.items || inventoryData.data || []);
  if (items.length === 0) return;

  // Build inventory map: itemId -> quantity
  const invMap = {};
  items.forEach(raw => {
    const id = raw.item || raw.itemId || raw.id || "";
    invMap[id.toLowerCase()] = raw.quantity || 0;
  });

  const stored = await storageGet("msfPlayerRosterFull");
  const roster = stored.msfPlayerRosterFull || [];
  if (roster.length === 0) return;

  // Find characters at high gear tiers (16+) that could benefit from tier-up
  // Group by gear tier, show what's most commonly needed
  const gearGroups = {};
  const nearTierUp = roster.filter(c => {
    const tier = c.gearTier || c.tier || 0;
    return tier >= 16 && tier < 19; // characters close to endgame but not maxed
  });

  if (nearTierUp.length === 0) {
    container.innerHTML = `<div class="dash-section-title">Gear Bottleneck</div><div class="no-counters">Pas de personnages entre G16 et G18.</div>`;
    container.classList.remove("hidden");
    return;
  }

  // Group by gear tier
  nearTierUp.forEach(c => {
    const tier = c.gearTier || c.tier || 0;
    const tierKey = `G${tier}→G${tier + 1}`;
    if (!gearGroups[tierKey]) gearGroups[tierKey] = [];
    const charName = c.name || c.id || "?";
    gearGroups[tierKey].push(charName);
  });

  // Check inventory for common endgame gear items
  const criticalGear = [
    { pattern: "TEAL", label: "Teal Gear" },
    { pattern: "GEAR_ORANGE", label: "Orange Gear" },
    { pattern: "GEAR_PURPLE", label: "Purple Gear" },
    { pattern: "CATALYST", label: "Catalyseurs" },
    { pattern: "G4_UNSTABLE_MOLECULE", label: "Molecules instables" },
    { pattern: "UNIQUE", label: "Gear Unique" }
  ];

  let html = `<div class="dash-section-title">Gear Bottleneck (${nearTierUp.length} persos G16-G18)</div>`;

  // Show tier groups
  for (const [tierKey, chars] of Object.entries(gearGroups)) {
    html += `<div class="gear-bottleneck-card has-stock">
      <div class="gear-bottleneck-name">${tierKey} (${chars.length} persos)</div>
      <div class="gear-bottleneck-chars">${chars.slice(0, 8).map(n => `<span class="gear-bottleneck-char">${n}</span>`).join("")}${chars.length > 8 ? `<span class="gear-bottleneck-char">+${chars.length - 8}</span>` : ""}</div>
    </div>`;
  }

  // Show low-stock critical gear
  const lowStock = [];
  for (const [id, qty] of Object.entries(invMap)) {
    for (const cg of criticalGear) {
      if (id.toUpperCase().includes(cg.pattern) && qty < 50) {
        const { name } = parseInventoryItem(id);
        lowStock.push({ name, qty, cat: cg.label });
      }
    }
  }

  if (lowStock.length > 0) {
    lowStock.sort((a, b) => a.qty - b.qty);
    html += `<div style="font-size:10px;color:#ff6b6b;margin-top:6px;font-weight:600;">Stock faible :</div>`;
    lowStock.slice(0, 6).forEach(item => {
      html += `<div class="gear-bottleneck-card">
        <div class="gear-bottleneck-name">${item.name} <span style="color:#ff6b6b;font-weight:700;">x${item.qty}</span></div>
        <div class="gear-bottleneck-meta">${item.cat}</div>
      </div>`;
    });
  }

  container.innerHTML = html;
  container.classList.remove("hidden");
}

// ═══════════════════════════════════════════════════════════
// WHO TO LEVEL — ROI-based character recommendations
// ═══════════════════════════════════════════════════════════

async function renderRecommendations() {
  const container = document.getElementById("dashboard-recommendations");
  if (!container) return;
  if (playerRoster.size === 0) return;

  const stored = await storageGet("msfPlayerRosterFull");
  const roster = stored.msfPlayerRosterFull || [];
  if (roster.length === 0) return;

  if (!charactersData) {
    try {
      const resp = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await resp.json();
    } catch (e) { return; }
  }
  const charIndex = {};
  for (const [id, c] of Object.entries(charactersData?.characters || {})) {
    charIndex[id.toLowerCase()] = { ...c, _id: id };
  }

  // Build roster lookup: charId -> { tier, stars, power }
  const rosterIndex = {};
  roster.forEach(c => {
    const id = c.id || c.characterId || "";
    rosterIndex[id] = {
      tier: c.gearTier || c.tier || 0,
      stars: c.activeYellow || c.stars || 0,
      power: c.power || 0
    };
  });

  // Team meta data: modes and era
  const teamMeta = {
    aforce:{modes:["war","crucible"],era:"legacy"},absoluteaforce:{modes:["crucible","war"],era:"mid"},
    alphaflight:{modes:["war","crucible"],era:"mid"},astonishing:{modes:["war","crucible","raid"],era:"mid"},
    bifrost:{modes:["crucible","war","raid"],era:"meta"},brimstone:{modes:["crucible","war","raid"],era:"meta"},
    darkhunter:{modes:["crucible","war","raid"],era:"meta"},defender:{modes:["war"],era:"legacy"},
    fantasticfourmcu:{modes:["crucible","war","battleworld"],era:"mid"},hellfireclub:{modes:["crucible","war"],era:"mid"},
    heroesforhire:{modes:["war"],era:"legacy"},hivemind:{modes:["crucible","war","raid"],era:"meta"},
    immortalweapon:{modes:["war","crucible"],era:"legacy"},infinitywatch:{modes:["war","crucible"],era:"legacy"},
    knowhere:{modes:["crucible","war"],era:"mid"},liberty:{modes:["crucible","war","battleworld"],era:"mid"},
    newavenger:{modes:["war"],era:"legacy"},newmutant:{modes:["crucible","war"],era:"mid"},
    newwarrior:{modes:["war","crucible"],era:"legacy"},nightstalker:{modes:["crucible","war","raid"],era:"meta"},
    pegasus:{modes:["crucible","war","raid","battleworld"],era:"meta"},retcon:{modes:["crucible","war"],era:"mid"},
    secretdefender:{modes:["crucible","war"],era:"mid"},secretwarrior:{modes:["crucible","war","raid"],era:"meta"},
    shadowland:{modes:["war"],era:"legacy"},spidersociety:{modes:["crucible","war","battleworld"],era:"mid"},
    starjammer:{modes:["crucible","war"],era:"mid"},supernatural:{modes:["war"],era:"legacy"},
    unlimited:{modes:["crucible","war","raid"],era:"mid"},vigilante:{modes:["crucible","war","raid"],era:"meta"},
    wardog:{modes:["war","crucible"],era:"mid"},webwarrior:{modes:["war","raid"],era:"legacy"},
    winterguard:{modes:["war"],era:"legacy"},xfactor:{modes:["crucible","war"],era:"mid"},
    xtreme:{modes:["crucible","war","raid"],era:"mid"},xforce:{modes:["war","crucible"],era:"legacy"},
    accursed:{modes:["crucible","war","raid"],era:"meta"},annihilator:{modes:["crucible","war","raid","battleworld"],era:"meta"},
    cabal:{modes:["crucible","war","raid"],era:"meta"},darkhold:{modes:["war","crucible"],era:"legacy"},
    deathseed:{modes:["crucible","war"],era:"mid"},horseman:{modes:["crucible","war"],era:"mid"},
    marauders:{modes:["war","crucible"],era:"legacy"},mercsformoney:{modes:["war"],era:"legacy"},
    mightyavenger:{modes:["crucible","war"],era:"mid"},outoftime:{modes:["crucible","war","raid"],era:"meta"},
    powerarmor:{modes:["war"],era:"legacy"},pymtech:{modes:["war"],era:"legacy"},
    superiorsix:{modes:["crucible","war"],era:"mid"},thunderbolt:{modes:["crucible","war","battleworld"],era:"mid"},
    uncannyavenger:{modes:["crucible","war"],era:"mid"},undying:{modes:["crucible","war","raid"],era:"meta"},
    weaponx:{modes:["war","crucible","raid"],era:"legacy"},youngavenger:{modes:["war"],era:"legacy"},
    gamma:{modes:["crucible","war","raid"],era:"mid"},astral:{modes:["crucible","war","raid"],era:"meta"},
    orchis:{modes:["crucible","war","raid"],era:"meta"},illuminati:{modes:["crucible","war"],era:"mid"},
    eternals:{modes:["war","crucible"],era:"legacy"},blackorder:{modes:["war","crucible"],era:"legacy"},
    underworld:{modes:["war","crucible"],era:"legacy"},sinistersix:{modes:["war"],era:"legacy"},
    tangled:{modes:["crucible","war","raid"],era:"meta"},infestation:{modes:["crucible","war"],era:"mid"},
    immortalxmen:{modes:["crucible","war"],era:"mid"},insidioussix:{modes:["war"],era:"legacy"},
    spiderweaver:{modes:["crucible","war"],era:"mid"}
  };
  const eraMultiplier = { meta: 3, mid: 1.5, legacy: 0.3 };
  const eraLabel = { meta: "META", mid: "", legacy: "ancien" };
  const eraColor = { meta: "#51cf66", mid: "", legacy: "#868e96" };

  // Analyze teams per mode
  // candidates[mode][charId] = { score, reasons[], name, portrait, tier, stars, power, teamEra }
  const modes = ["crucible", "war", "raid", "battleworld"];
  const candidatesByMode = {};
  modes.forEach(m => { candidatesByMode[m] = new Map(); });

  const teams = teamsData || [];
  for (const team of teams) {
    const memberIds = team.memberIds || [];
    if (memberIds.length === 0) continue;
    // Skip variant teams (with underscore) — use base team meta
    const baseId = team.id.includes("_") ? team.id.split("_")[0] : team.id;
    const meta = teamMeta[baseId];
    if (!meta) continue;

    const era = meta.era;
    const mult = eraMultiplier[era] || 1;

    // Check team completeness
    const owned = [];
    const missing = [];
    let teamPower = 0;
    for (const mid of memberIds) {
      const r = rosterIndex[mid];
      if (r && r.power > 0) {
        owned.push({ id: mid, ...r });
        teamPower += r.power;
      } else {
        missing.push(mid);
      }
    }

    const addCandidate = (charId, baseScore, reason, mode) => {
      const char = charIndex[charId.toLowerCase()];
      if (!char || char.status === "summon") return;
      const map = candidatesByMode[mode];
      if (!map) return;
      const r = rosterIndex[charId] || {};
      const prev = map.get(charId) || { score: 0, reasons: [], name: char.name || charId, portrait: char.portrait || "", tier: r.tier || 0, stars: r.stars || 0, power: r.power || 0, bestEra: era };
      prev.score += Math.round(baseScore * mult);
      prev.reasons.push(reason);
      if (eraMultiplier[era] > eraMultiplier[prev.bestEra || "legacy"]) prev.bestEra = era;
      map.set(charId, prev);
    };

    // Case 1: 1 member missing — HIGH priority
    if (missing.length === 1 && owned.length >= 4) {
      for (const mode of meta.modes) {
        addCandidate(missing[0], 50, `manque dans ${team.name}`, mode);
      }
    }

    // Case 2: 2 members missing — moderate priority
    if (missing.length === 2 && owned.length >= 3) {
      for (const mid of missing) {
        for (const mode of meta.modes) {
          addCandidate(mid, 20, `manque dans ${team.name}`, mode);
        }
      }
    }

    // Case 3: all owned but weakest member is bottleneck
    if (missing.length === 0 && owned.length >= 4) {
      const avgPower = teamPower / owned.length;
      const weakest = owned.reduce((a, b) => a.power < b.power ? a : b);
      if (weakest.power < avgPower * 0.6 && weakest.tier < 19) {
        for (const mode of meta.modes) {
          addCandidate(weakest.id, 30, `faible dans ${team.name}`, mode);
        }
      }
    }
  }

  // Render by mode
  const modeLabels = { crucible: "Crucible", war: "War", raid: "Raids", battleworld: "Battleworld" };
  const modeIcons = { crucible: "⚔", war: "🛡", raid: "👥", battleworld: "🌐" };
  let html = `<div class="dash-section-title">Qui monter en priorite</div>`;
  let hasAny = false;

  for (const mode of modes) {
    const map = candidatesByMode[mode];
    const sorted = [...map.entries()]
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (sorted.length === 0) continue;
    hasAny = true;

    html += `<div class="rec-mode-section">
      <div class="rec-mode-title">${modeIcons[mode]} ${modeLabels[mode]}</div>`;

    sorted.forEach(c => {
      const uniqueReasons = [...new Set(c.reasons)].slice(0, 2);
      const details = [];
      if (c.tier > 0) details.push(`G${c.tier}`);
      if (c.stars > 0 && c.stars < 7) details.push(`${c.stars}★`);
      if (c.power > 0) details.push(formatNumber(c.power));

      const era = c.bestEra || "mid";
      const badge = eraLabel[era];
      const badgeHtml = badge ? `<span class="rec-era" style="color:${eraColor[era]}">${badge}</span>` : "";

      html += `<div class="rec-card">
        ${c.portrait ? `<img src="${c.portrait}" class="rec-portrait">` : ""}
        <div class="rec-info">
          <div class="rec-name">${c.name} ${badgeHtml}</div>
          <div class="rec-reason">${uniqueReasons.join(" · ")}</div>
          ${details.length ? `<div class="rec-reason" style="opacity:0.5">${details.join(" · ")}</div>` : ""}
        </div>
      </div>`;
    });

    html += `</div>`;
  }

  if (!hasAny) return;
  container.innerHTML = html;
  container.classList.remove("hidden");
}

// ═══════════════════════════════════════════════════════════
// GLOBAL SEARCH
// ═══════════════════════════════════════════════════════════

(function initGlobalSearch() {
  const input = document.getElementById("global-search");
  const resultsDiv = document.getElementById("global-search-results");
  if (!input || !resultsDiv) return;

  let debounceTimer;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      resultsDiv.classList.add("hidden");
      return;
    }
    debounceTimer = setTimeout(() => performGlobalSearch(query, resultsDiv), 200);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 2) {
      resultsDiv.classList.remove("hidden");
    }
  });

  // Close on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".global-search-wrapper")) {
      resultsDiv.classList.add("hidden");
    }
  });
})();

async function performGlobalSearch(query, resultsDiv) {
  // Normalize for accent-insensitive search
  const normalize = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const nQuery = normalize(query);

  const results = [];

  // Search characters
  if (charactersData?.characters) {
    for (const [id, c] of Object.entries(charactersData.characters)) {
      const name = c.name || id;
      if (normalize(name).includes(nQuery) || normalize(id).includes(nQuery)) {
        results.push({ type: "character", id, name, portrait: c.portrait || "", data: c });
        if (results.length >= 30) break;
      }
    }
  }

  // Search teams
  if (teamsData && teamsData.length > 0) {
    teamsData.forEach(team => {
      const name = team.name || "";
      const nameFr = team.nameFr || "";
      if (normalize(name).includes(nQuery) || normalize(nameFr).includes(nQuery)) {
        results.push({ type: "team", id: team.id, name: nameFr || name, data: team });
      }
    });
  }

  // Search farming locations
  try {
    if (!window._globalSearchFarmData) {
      const resp = await fetch(ext.runtime.getURL("data/farming-locations.json"));
      window._globalSearchFarmData = await resp.json();
    }
    const farmData = window._globalSearchFarmData;
    if (Array.isArray(farmData)) {
      farmData.forEach(f => {
        const name = f.name || "";
        if (normalize(name).includes(nQuery)) {
          const existing = results.find(r => r.type === "character" && normalize(r.name).includes(normalize(name.replace(/-/g, ""))));
          if (!existing) {
            results.push({ type: "farm", id: name, name, data: f });
          } else {
            existing._farmData = f;
          }
        }
      });
    }
  } catch (e) { /* ignore */ }

  // Render results
  if (results.length === 0) {
    resultsDiv.innerHTML = `<div class="gs-no-results">Aucun resultat pour "${query}"</div>`;
    resultsDiv.classList.remove("hidden");
    return;
  }

  // Group by type
  const characters = results.filter(r => r.type === "character").slice(0, 8);
  const teams = results.filter(r => r.type === "team").slice(0, 5);
  const farms = results.filter(r => r.type === "farm").slice(0, 3);

  let html = "";

  if (characters.length > 0) {
    html += `<div class="gs-category">Personnages</div>`;
    characters.forEach(r => {
      const inRoster = playerRoster.has(r.id);
      const rosterBadge = inRoster ? `<span style="color:#51cf66;font-size:10px;">✓</span>` : "";
      const farmInfo = r._farmData ? ` · ${r._farmData.locations?.slice(0, 2).map(l => l.name || l).join(", ") || ""}` : "";
      html += `<div class="gs-item" data-type="character" data-id="${r.id}">
        ${r.portrait ? `<img src="${r.portrait}" class="gs-item-portrait">` : ""}
        <span class="gs-item-name">${r.name} ${rosterBadge}</span>
        <span class="gs-item-meta">${farmInfo}</span>
      </div>`;
    });
  }

  if (teams.length > 0) {
    html += `<div class="gs-category">Equipes</div>`;
    teams.forEach(r => {
      const memberCount = r.data?.memberIds?.length || 0;
      html += `<div class="gs-item" data-type="team" data-id="${r.id}">
        <span class="gs-item-name">${r.name}</span>
        <span class="gs-item-meta">${memberCount} membres</span>
      </div>`;
    });
  }

  if (farms.length > 0) {
    html += `<div class="gs-category">Farm</div>`;
    farms.forEach(r => {
      const locs = r.data?.locations?.slice(0, 3).map(l => l.name || l).join(", ") || "";
      html += `<div class="gs-item" data-type="farm" data-id="${r.id}">
        <span class="gs-item-name">${r.name}</span>
        <span class="gs-item-meta">${locs}</span>
      </div>`;
    });
  }

  resultsDiv.innerHTML = html;
  resultsDiv.classList.remove("hidden");

  // Click handlers
  resultsDiv.querySelectorAll(".gs-item").forEach(item => {
    item.addEventListener("click", () => {
      const type = item.dataset.type;
      const id = item.dataset.id;
      resultsDiv.classList.add("hidden");
      document.getElementById("global-search").value = "";

      if (type === "team") {
        // Open counters for this team
        const manage = document.getElementById("btn-manage");
        if (manage) manage.click();
      } else if (type === "farm" || type === "character") {
        // Open farm panel and search
        const farmBtn = document.getElementById("btn-farm");
        if (farmBtn) {
          farmBtn.click();
          setTimeout(() => {
            const farmSearch = document.querySelector("#farm-panel .sync-input, #farm-panel input[type='text']");
            if (farmSearch) {
              farmSearch.value = item.querySelector(".gs-item-name").textContent.trim().replace(/✓/g, "").trim();
              farmSearch.dispatchEvent(new Event("input"));
            }
          }, 300);
        }
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════
// COMPACT MODE
// ═══════════════════════════════════════════════════════════

(function initCompactMode() {
  const btn = document.getElementById("btn-compact");
  if (!btn) return;

  // Restore saved state
  storageGet("msfCompactMode").then(stored => {
    if (stored.msfCompactMode) {
      document.body.classList.add("compact-mode");
      btn.classList.add("active");
    }
  });

  btn.addEventListener("click", () => {
    const isCompact = document.body.classList.toggle("compact-mode");
    btn.classList.toggle("active", isCompact);
    storageSet({ msfCompactMode: isCompact });
  });
})();

// ═══════════════════════════════════════════════════════════
// WAR PLAN EXPORT (Discord format)
// ═══════════════════════════════════════════════════════════

function exportWarPlanToText() {
  if (!scanRoomState) return "Pas de scan en cours.";

  let lines = ["**Plan d'attaque — MSF Counter**", ""];

  for (let t = 0; t < scanRoomState.teams.length; t++) {
    const team = scanRoomState.teams[t];
    if (team.underAttack) {
      lines.push(`🔴 **Eq ${team.slotNumber}** — UNDER ATTACK`);
      continue;
    }

    const charIds = team.portraits.filter(p => p.charId).map(p => p.charId);
    if (charIds.length < 3) continue;

    let teamName = "?";
    if (warAnalyzer) {
      const result = warAnalyzer._identifyTeamFromCharIds(charIds);
      teamName = result?.team ? (result.team.nameFr || result.team.name) : "Inconnue";
    }
    const names = team.portraits.filter(p => p.name).map(p => p.name).join(", ");
    const power = team.enemyPower ? ` (${formatPower(team.enemyPower)})` : "";

    lines.push(`🛡️ **Eq ${team.slotNumber} — ${teamName}**${power}`);
    if (names) lines.push(`   ${names}`);

    // Check if war plan zone has a suggestion
    const planZone = document.getElementById(`war-plan-${t}`);
    if (planZone && !planZone.classList.contains("hidden")) {
      const counterName = planZone.querySelector(".war-planner-counter-name");
      if (counterName) {
        lines.push(`   ⚔️ → ${counterName.textContent.trim()}`);
      }
    }

    lines.push("");
  }

  lines.push(`_Genere le ${new Date().toLocaleDateString("fr")} a ${new Date().toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" })}_`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════
// CRUCIBLE CROSS-REFERENCE (counter vs actual winrates)
// ═══════════════════════════════════════════════════════════

let crucibleAttackWinrateCache = null;

async function loadCrucibleAttackWinrates() {
  if (crucibleAttackWinrateCache) return crucibleAttackWinrateCache;

  try {
    const res = await new Promise(r => ext.runtime.sendMessage({ type: "MSF_GET_CRUCIBLE_ATTACK" }, r));
    if (res.error || !res.data) return null;

    const data = Array.isArray(res.data) ? res.data : [];
    const map = {}; // teamId or squad key -> winrate

    data.forEach(entry => {
      const squad = Array.isArray(entry.squad) ? entry.squad : [];
      const w = entry.defends || entry.wins || 0;
      const l = entry.defeats || entry.losses || 0;
      const total = w + l;
      if (total < 50) return;

      const key = squad.sort().join(",").toLowerCase();
      map[key] = { winrate: total > 0 ? Math.round((w / total) * 100) : 0, total };

      // Also try to match to team name
      if (typeof matchSquadToTeam === "function" && inverseCounters?.teams) {
        const match = matchSquadToTeam(squad, inverseCounters.teams);
        if (match?.team?.id) {
          map[match.team.id.toLowerCase()] = map[key];
        }
      }
    });

    crucibleAttackWinrateCache = map;
    return map;
  } catch (e) {
    return null;
  }
}

function getCrucibleXrefBadge(teamId) {
  if (!crucibleAttackWinrateCache) return "";
  const data = crucibleAttackWinrateCache[teamId?.toLowerCase()];
  if (!data) return "";

  const cls = data.winrate >= 60 ? "good" : data.winrate >= 40 ? "mid" : "bad";
  return `<span class="crucible-xref-badge ${cls}" title="Crucible attaque: ${data.winrate}% WR (${data.total} combats)">${data.winrate}%</span>`;
}

// ═══════════════════════════════════════════════════════════
// RAID LANE ADVISOR
// ═══════════════════════════════════════════════════════════

async function renderRaidAdvisor() {
  const section = document.getElementById("raid-advisor-section");
  if (!section) return;

  if (playerRoster.size === 0) return;

  const stored = await storageGet("msfPlayerRosterFull");
  const roster = stored.msfPlayerRosterFull || [];
  if (roster.length === 0) return;

  // Build roster power map: charId -> power
  const rosterPowerMap = {};
  roster.forEach(c => {
    const id = c.id || c.characterId || "";
    rosterPowerMap[id] = c.power || 0;
  });

  if (!charactersData) {
    try {
      const resp = await fetch(ext.runtime.getURL("data/characters-full.json"));
      charactersData = await resp.json();
    } catch (e) { return; }
  }

  // Get raid teams from teams data (traits: "Raid" or specific raid teams)
  const raidTeams = teamsData.filter(team => {
    const name = (team.name || "").toLowerCase();
    const tags = (team.tags || []).map(t => t.toLowerCase());
    return name.includes("raid") || tags.includes("raid") || tags.includes("incursion") || tags.includes("doom");
  });

  if (raidTeams.length === 0) return;

  // Score each raid team by player's available power
  const teamScores = [];
  raidTeams.forEach(team => {
    const memberIds = team.memberIds || [];
    let totalPower = 0;
    let available = 0;
    const missing = [];

    memberIds.forEach(id => {
      if (rosterPowerMap[id]) {
        totalPower += rosterPowerMap[id];
        available++;
      } else {
        missing.push(id);
      }
    });

    if (available === 0) return;

    const strength = available === memberIds.length ? "strong" : (available >= memberIds.length - 1 ? "medium" : "weak");
    const teamName = team.nameFr || team.name;

    teamScores.push({
      teamName,
      totalPower,
      available,
      total: memberIds.length,
      missing,
      strength
    });
  });

  teamScores.sort((a, b) => {
    // Sort: strong first, then by power
    const strOrder = { strong: 0, medium: 1, weak: 2 };
    if (strOrder[a.strength] !== strOrder[b.strength]) return strOrder[a.strength] - strOrder[b.strength];
    return b.totalPower - a.totalPower;
  });

  if (teamScores.length === 0) return;

  let html = `<div class="raid-advisor-title">Equipes Raid disponibles</div>`;

  teamScores.slice(0, 10).forEach(team => {
    const missingNames = team.missing.map(id => {
      const c = charactersData?.characters?.[id];
      return c ? c.name : id;
    }).join(", ");

    html += `<div class="raid-advisor-card">
      <div class="raid-advisor-team-name">${team.teamName} <span class="raid-advisor-strength ${team.strength}">${team.available}/${team.total}</span></div>
      <div class="raid-advisor-power">Power: ${formatNumber(team.totalPower)}</div>
      ${team.missing.length > 0 ? `<div class="raid-advisor-missing">Manque: ${missingNames}</div>` : ""}
    </div>`;
  });

  section.innerHTML = html;
  section.classList.remove("hidden");
}

// ===== LUCIDE ICONS INITIALIZATION =====
// Initialise les icônes Lucide après le chargement du DOM
if (typeof lucide !== 'undefined') {
  lucide.createIcons();
  console.log('[Popup] Lucide Icons initialized');
} else {
  console.warn('[Popup] Lucide library not loaded');
}

