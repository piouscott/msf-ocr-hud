const ext = typeof browser !== "undefined" ? browser : chrome;

// Détecter si on est en mode fenêtré
(async function detectWindowMode() {
  try {
    const currentWindow = await ext.windows.getCurrent();
    if (currentWindow && currentWindow.type === "popup") {
      document.body.classList.add("windowed");
    }
  } catch (e) {}
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

// ============================================
// Internationalisation (i18n)
// ============================================

let currentLang = "fr";

const i18n = {
  fr: {
    title: "Gestion Contres",
    back: "Retour",
    language: "Langue:",
    counters: "contres",
    addCounter: "+ Ajouter contre",
    reset: "Réinitialiser",
    save: "Sauvegarder",
    saved: "Sauvegardé!",
    resetDone: "Réinitialisé!",
    error: "Erreur!",
    confirmReset: "Réinitialiser les contres de cette équipe aux valeurs par défaut ?",
    default: "Défaut",
    sync: "Sync",
    custom: "Perso",
    notes: "Notes",
    bestOffensive: "Meilleures équipes offensives"
  },
  en: {
    title: "Manage Counters",
    back: "Back",
    language: "Language:",
    counters: "counters",
    addCounter: "+ Add counter",
    reset: "Reset",
    save: "Save",
    saved: "Saved!",
    resetDone: "Reset!",
    error: "Error!",
    confirmReset: "Reset this team's counters to default values?",
    default: "Default",
    sync: "Sync",
    custom: "Custom",
    notes: "Notes",
    bestOffensive: "Best offensive teams"
  }
};

function t(key) {
  return i18n[currentLang][key] || i18n.en[key] || key;
}

function getTeamName(team) {
  if (currentLang === "fr" && team.nameFr) {
    return team.nameFr;
  }
  return team.name;
}

let teamsData = [];
let defaultCounters = {};
let remoteCounters = {};
let customCounters = {};
let mergedCounters = {};
let charactersData = {}; // Pour les portraits
let playerRoster = new Set(); // Personnages possédés par le joueur (via API)
let hasRosterData = false; // Indique si on a des données de roster

// Source des counters pour chaque equipe
let counterSources = {};

/**
 * Convertit le niveau de confiance en symboles visuels (triangles)
 */
function confidenceToSymbols(confidence) {
  if (confidence >= 95) return '<span style="color:#51cf66">▲▲▲</span>';
  if (confidence >= 80) return '<span style="color:#51cf66">▲▲</span>';
  if (confidence >= 65) return '<span style="color:#51cf66">▲</span>';
  if (confidence >= 50) return '<span style="color:#fcc419">⊜</span>';
  return '<span style="color:#ff6b6b">▼</span>';
}

/**
 * Vérifie si un personnage est une invocation (summon)
 * Les invocations ne comptent pas pour la possession d'équipe
 */
function isSummon(memberId) {
  const char = charactersData[memberId];
  if (!char) return false;
  return char.status === 'summon' || (char.traits && char.traits.includes('Summon'));
}

/**
 * Vérifie si le joueur possède tous les personnages d'une équipe
 * @param {string} teamId - ID de l'équipe counter
 * @returns {boolean} true si tous les membres (non-invocations) sont dans le roster
 */
function isTeamOwned(teamId) {
  if (!hasRosterData || playerRoster.size === 0) return false;

  const team = teamsData.find(t => t.id === teamId);
  if (!team || !team.memberIds) return false;

  // Filtrer les invocations - elles ne comptent pas pour la possession
  const playableMembers = team.memberIds.filter(id => !isSummon(id));
  if (playableMembers.length === 0) return false;

  return playableMembers.every(memberId => playerRoster.has(memberId));
}

/**
 * Compte combien de personnages d'une équipe le joueur possède
 * @returns {number} nombre de membres possédés sur le total (hors invocations)
 */
function countOwnedMembers(teamId) {
  if (!hasRosterData || playerRoster.size === 0) return { owned: 0, total: 0 };

  const team = teamsData.find(t => t.id === teamId);
  if (!team || !team.memberIds) return { owned: 0, total: 0 };

  // Filtrer les invocations
  const playableMembers = team.memberIds.filter(id => !isSummon(id));
  const owned = playableMembers.filter(id => playerRoster.has(id)).length;
  return { owned, total: playableMembers.length };
}

/**
 * Vérifie si le joueur possède au moins un counter complet pour cette équipe ennemie
 * @param {string} teamId - ID de l'équipe ennemie
 * @returns {boolean} true si au moins un counter est possédé
 */
function hasOwnedCounter(teamId) {
  if (!hasRosterData || playerRoster.size === 0) return false;

  const counters = mergedCounters[teamId] || [];
  return counters.some(counter => isTeamOwned(counter.team));
}

// Charger les donnees avec les 3 niveaux
async function loadData() {
  try {
    const teamsUrl = ext.runtime.getURL("data/teams.json");
    const countersUrl = ext.runtime.getURL("data/counters.json");
    const charactersUrl = ext.runtime.getURL("data/characters-full.json");

    const [teamsRes, countersRes, charactersRes] = await Promise.all([
      fetch(teamsUrl),
      fetch(countersUrl),
      fetch(charactersUrl)
    ]);

    const teamsJson = await teamsRes.json();
    const countersJson = await countersRes.json();
    const charactersJson = await charactersRes.json();

    teamsData = teamsJson.teams || [];
    // Trier les equipes par ordre alphabetique
    teamsData.sort((a, b) => a.name.localeCompare(b.name));
    defaultCounters = countersJson.counters || {};
    charactersData = charactersJson.characters || {};

    // Charger les counters remote depuis storage
    const storedRemote = await storageGet("msfRemoteCounters");
    if (storedRemote.msfRemoteCounters && storedRemote.msfRemoteCounters.counters) {
      remoteCounters = storedRemote.msfRemoteCounters.counters;
    }

    // Charger les counters custom depuis storage
    const storedCustom = await storageGet("msfCustomCounters");
    if (storedCustom.msfCustomCounters) {
      customCounters = storedCustom.msfCustomCounters;
    }

    // Charger le roster du joueur (si disponible via API)
    const storedRoster = await storageGet(["msfPlayerRoster", "msfSquadsUpdatedAt"]);
    if (storedRoster.msfPlayerRoster && storedRoster.msfPlayerRoster.length > 0) {
      playerRoster = new Set(storedRoster.msfPlayerRoster);
      hasRosterData = true;
      console.log("[Manage] Roster chargé:", playerRoster.size, "personnages");
    }

    // Fusionner les counters et determiner les sources
    mergeCounters();

    renderTeams();
    renderOffensiveTeams();
    renderSourceLegend();
  } catch (e) {
    console.error("Erreur chargement:", e);
  }
}

/**
 * Fusionne les 3 niveaux de counters et determine la source de chaque
 * Priorite: Custom > Remote > Default
 */
function mergeCounters() {
  mergedCounters = {};
  counterSources = {};

  // Collecter tous les teamIds
  const allTeamIds = new Set([
    ...Object.keys(defaultCounters),
    ...Object.keys(remoteCounters),
    ...Object.keys(customCounters)
  ]);

  for (const teamId of allTeamIds) {
    if (customCounters[teamId] && customCounters[teamId].length > 0) {
      mergedCounters[teamId] = customCounters[teamId];
      counterSources[teamId] = "custom";
    } else if (remoteCounters[teamId] && remoteCounters[teamId].length > 0) {
      mergedCounters[teamId] = remoteCounters[teamId];
      counterSources[teamId] = "remote";
    } else if (defaultCounters[teamId]) {
      mergedCounters[teamId] = defaultCounters[teamId];
      counterSources[teamId] = "default";
    }
  }
}

/**
 * Construit l'index inverse (attacker -> defenses) et affiche les meilleures équipes offensives
 */
function renderOffensiveTeams() {
  const container = document.getElementById("offensive-content");
  const accordion = document.getElementById("offensive-accordion");
  const toggle = document.getElementById("offensive-toggle");
  if (!container || !accordion || !toggle) return;

  // Construire l'index inverse depuis mergedCounters
  const inverse = {};
  for (const [defenseId, attackers] of Object.entries(mergedCounters)) {
    for (const counter of attackers) {
      const attackerId = counter.team;
      if (!inverse[attackerId]) inverse[attackerId] = [];
      inverse[attackerId].push({
        defenseId,
        defenseName: getTeamName(teamsData.find(t => t.id === defenseId) || { name: defenseId }),
        confidence: counter.confidence
      });
    }
  }

  // Trier chaque attaquant par confiance, puis trier par nombre de cibles
  const offensiveTeams = Object.entries(inverse)
    .map(([teamId, targets]) => {
      targets.sort((a, b) => b.confidence - a.confidence);
      const team = teamsData.find(t => t.id === teamId);
      return {
        teamId,
        teamName: team ? getTeamName(team) : teamId,
        targets,
        targetCount: targets.length
      };
    })
    .sort((a, b) => b.targetCount - a.targetCount)
    .slice(0, 20);

  if (offensiveTeams.length === 0) {
    accordion.style.display = "none";
    return;
  }

  let html = "";
  offensiveTeams.forEach((team, idx) => {
    html += `
      <div class="offensive-team-card">
        <div class="offensive-team-header">
          <span class="offensive-team-name">${team.teamName}</span>
          <span class="offensive-team-count">${t("counters") === "contres" ? "Bat" : "Beats"} ${team.targetCount} ${t("counters") === "contres" ? "équipes" : "teams"}</span>
        </div>
        <button class="offensive-toggle-btn" data-idx="${idx}">${t("counters") === "contres" ? "Voir cibles ▼" : "Show targets ▼"}</button>
        <div class="offensive-targets" id="off-targets-${idx}">
          ${team.targets.slice(0, 12).map(tgt => `
            <div class="offensive-target">
              <span>${tgt.defenseName}</span>
              ${confidenceToSymbols(tgt.confidence)}
            </div>
          `).join("")}
          ${team.targets.length > 12 ? `<div class="offensive-target" style="color:#888">+${team.targets.length - 12}</div>` : ""}
        </div>
      </div>`;
  });

  container.innerHTML = html;

  // Toggle accordéon principal
  toggle.addEventListener("click", () => {
    accordion.classList.toggle("expanded");
  });

  // Toggles pour chaque équipe
  container.querySelectorAll(".offensive-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targets = document.getElementById(`off-targets-${btn.dataset.idx}`);
      if (targets) {
        targets.classList.toggle("show");
        const isOpen = targets.classList.contains("show");
        const showLabel = t("counters") === "contres" ? "Voir cibles" : "Show targets";
        const hideLabel = t("counters") === "contres" ? "Masquer" : "Hide";
        btn.textContent = isOpen ? `${hideLabel} ▲` : `${showLabel} ▼`;
      }
    });
  });
}

/**
 * Génère le HTML pour afficher les portraits miniatures d'une équipe
 */
function renderTeamPortraits(team) {
  const memberIds = team.memberIds || [];
  if (memberIds.length === 0) return '';

  const portraits = memberIds.map(memberId => {
    const char = charactersData[memberId];
    if (char && char.portrait) {
      return `<img src="${char.portrait}" alt="${char.name}" title="${char.name}" class="team-portrait-thumb" loading="lazy">`;
    }
    return `<span class="team-portrait-placeholder" title="${memberId}">?</span>`;
  });

  return `<div class="team-portraits">${portraits.join('')}</div>`;
}

function renderSourceLegend() {
  const legend = document.getElementById("source-legend");
  if (!legend) return;

  const hasRemote = Object.keys(remoteCounters).length > 0;
  const hasCustom = Object.keys(customCounters).length > 0;

  legend.innerHTML = `
    <span class="legend-item"><span class="source-badge default"></span> ${t("default")}</span>
    ${hasRemote ? `<span class="legend-item"><span class="source-badge remote"></span> ${t("sync")}</span>` : ''}
    ${hasCustom ? `<span class="legend-item"><span class="source-badge custom"></span> ${t("custom")}</span>` : ''}
    ${hasRosterData ? `<span class="legend-item"><span class="owned-badge" style="width:14px;height:14px;font-size:9px">✓</span> Possédé</span>` : ''}
  `;
}

function renderTeams() {
  const container = document.getElementById("teams-container");
  container.innerHTML = "";

  // Trier selon la langue actuelle
  const sortedTeams = [...teamsData].sort((a, b) =>
    getTeamName(a).localeCompare(getTeamName(b))
  );

  sortedTeams.forEach(team => {
    const section = document.createElement("div");
    section.className = "team-section";
    section.dataset.teamId = team.id;

    // Trier les counters: possédés d'abord, puis par confiance (du plus haut au plus bas)
    const counters = (mergedCounters[team.id] || []).slice().sort((a, b) => {
      const aOwned = isTeamOwned(a.team) ? 1 : 0;
      const bOwned = isTeamOwned(b.team) ? 1 : 0;
      // Si un est possédé et pas l'autre, le possédé en premier
      if (aOwned !== bOwned) return bOwned - aOwned;
      // Sinon, trier par confiance
      return b.confidence - a.confidence;
    });
    const source = counterSources[team.id] || "default";

    // Vérifier si on a au moins un counter possédé pour cette équipe
    const hasCounter = hasOwnedCounter(team.id);
    const counterBadge = hasCounter
      ? '<span class="has-counter-badge" title="Vous avez un contre complet">✓</span>'
      : '';

    section.innerHTML = `
      <div class="team-header">
        <div class="team-info">
          <span class="team-name-title">${getTeamName(team)} ${counterBadge}</span>
          ${renderTeamPortraits(team)}
        </div>
        <span class="team-meta">
          <span class="source-badge ${source}" title="Source: ${source}"></span>
          <span class="team-toggle">${counters.length} ${t("counters")}</span>
        </span>
      </div>
      <div class="counter-list">
        ${counters.map((c, i) => renderCounterRow(c, i)).join("")}
        <button class="btn-add-counter" data-team="${team.id}">${t("addCounter")}</button>
        ${source !== "default" ? `<button class="btn-reset" data-team="${team.id}">${t("reset")}</button>` : ""}
      </div>
    `;

    container.appendChild(section);
  });

  // Event listeners
  document.querySelectorAll(".team-header").forEach(header => {
    header.addEventListener("click", () => {
      const list = header.nextElementSibling;
      list.classList.toggle("expanded");
    });
  });

  document.querySelectorAll(".btn-add-counter").forEach(btn => {
    btn.addEventListener("click", () => addCounter(btn.dataset.team));
  });

  document.querySelectorAll(".btn-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".counter-row");
      row.remove();
    });
  });

  document.querySelectorAll(".btn-reset").forEach(btn => {
    btn.addEventListener("click", () => resetTeamCounters(btn.dataset.team));
  });

  // Mettre a jour le symbole quand la confiance change
  document.querySelectorAll(".counter-confidence").forEach(input => {
    input.addEventListener("input", () => {
      const symbol = input.previousElementSibling;
      if (symbol && symbol.classList.contains("confidence-symbol")) {
        symbol.innerHTML = confidenceToSymbols(parseInt(input.value) || 0);
      }
    });
  });

  // Mettre a jour les portraits quand on change l'equipe counter
  document.querySelectorAll(".counter-team").forEach(select => {
    select.addEventListener("change", () => {
      const wrapper = select.closest(".counter-team-wrapper");
      if (wrapper) {
        const existingPortraits = wrapper.querySelector(".counter-portraits");
        if (existingPortraits) {
          existingPortraits.remove();
        }
        const newPortraitsHtml = renderCounterPortraits(select.value);
        if (newPortraitsHtml) {
          select.insertAdjacentHTML("afterend", newPortraitsHtml);
        }
      }
    });
  });
}

/**
 * Génère le HTML pour afficher les portraits miniatures d'une équipe counter
 */
function renderCounterPortraits(teamId) {
  const team = teamsData.find(t => t.id === teamId);
  if (!team) return '';

  const memberIds = team.memberIds || [];
  if (memberIds.length === 0) return '';

  const portraits = memberIds.map(memberId => {
    const char = charactersData[memberId];
    if (char && char.portrait) {
      return `<img src="${char.portrait}" alt="${char.name}" title="${char.name}" class="counter-portrait-thumb" loading="lazy">`;
    }
    return `<span class="counter-portrait-placeholder" title="${memberId}">?</span>`;
  });

  return `<div class="counter-portraits">${portraits.join('')}</div>`;
}

function renderCounterRow(counter, index) {
  // Trier les options selon la langue
  const sortedTeams = [...teamsData].sort((a, b) =>
    getTeamName(a).localeCompare(getTeamName(b))
  );

  const teamOptions = sortedTeams.map(team =>
    `<option value="${team.id}" ${team.id === counter.team ? "selected" : ""}>${getTeamName(team)}</option>`
  ).join("");

  // Vérifier si le joueur possède cette équipe
  const owned = isTeamOwned(counter.team);
  const ownedBadge = owned
    ? '<span class="owned-badge" title="Vous possédez cette équipe">✓</span>'
    : '';
  const ownedClass = owned ? 'counter-owned' : '';

  return `
    <div class="counter-row ${ownedClass}" data-index="${index}" data-owned="${owned}">
      <div class="counter-team-wrapper">
        <select class="counter-team">${teamOptions}</select>
        ${renderCounterPortraits(counter.team)}
      </div>
      ${ownedBadge}
      <span class="confidence-symbol">${confidenceToSymbols(counter.confidence || 0)}</span>
      <input type="number" class="counter-confidence" value="${counter.confidence || 0}" min="0" max="100" title="Confiance %" style="display:none">
      <input type="number" class="counter-ratio" value="${counter.minPowerRatio || 1}" min="0.5" max="2" step="0.1" title="Ratio puissance" style="display:none">
      <button class="btn-remove">X</button>
      <input type="text" class="counter-notes" value="${counter.notes || ""}" placeholder="${t("notes")}">
    </div>
  `;
}

function addCounter(teamId) {
  const section = document.querySelector(`.team-section[data-team-id="${teamId}"]`);
  const list = section.querySelector(".counter-list");
  const addBtn = list.querySelector(".btn-add-counter");

  const template = document.createElement("div");
  template.innerHTML = renderCounterRow({ team: teamsData[0]?.id || "", confidence: 80, minPowerRatio: 1.0 }, -1);
  const row = template.firstElementChild;

  row.querySelector(".btn-remove").addEventListener("click", () => row.remove());

  // Mettre a jour le symbole quand la confiance change
  const confidenceInput = row.querySelector(".counter-confidence");
  confidenceInput.addEventListener("input", () => {
    const symbol = confidenceInput.previousElementSibling;
    if (symbol && symbol.classList.contains("confidence-symbol")) {
      symbol.innerHTML = confidenceToSymbols(parseInt(confidenceInput.value) || 0);
    }
  });

  // Mettre a jour les portraits quand on change l'equipe counter
  const selectTeam = row.querySelector(".counter-team");
  selectTeam.addEventListener("change", () => {
    const wrapper = selectTeam.closest(".counter-team-wrapper");
    if (wrapper) {
      const existingPortraits = wrapper.querySelector(".counter-portraits");
      if (existingPortraits) {
        existingPortraits.remove();
      }
      const newPortraitsHtml = renderCounterPortraits(selectTeam.value);
      if (newPortraitsHtml) {
        selectTeam.insertAdjacentHTML("afterend", newPortraitsHtml);
      }
    }
  });

  list.insertBefore(row, addBtn);
}

/**
 * Reinitialise les counters d'une equipe aux valeurs par defaut
 */
async function resetTeamCounters(teamId) {
  if (!confirm(t("confirmReset"))) {
    return;
  }

  // Supprimer du custom
  delete customCounters[teamId];
  await storageSet({ msfCustomCounters: customCounters });

  // Recalculer la fusion
  mergeCounters();
  renderTeams();

  document.getElementById("save-status").textContent = t("resetDone");
  document.getElementById("save-status").style.color = "#51cf66";
  setTimeout(() => {
    document.getElementById("save-status").textContent = "";
  }, 2000);
}

// Sauvegarder
document.getElementById("btn-save").addEventListener("click", async () => {
  const newCustomCounters = {};

  document.querySelectorAll(".team-section").forEach(section => {
    const teamId = section.dataset.teamId;
    const rows = section.querySelectorAll(".counter-row");

    if (rows.length > 0) {
      const counters = [];

      rows.forEach(row => {
        const team = row.querySelector(".counter-team").value;
        const confidence = parseInt(row.querySelector(".counter-confidence").value) || 80;
        const minPowerRatio = parseFloat(row.querySelector(".counter-ratio").value) || 1.0;
        const notes = row.querySelector(".counter-notes").value.trim();

        counters.push({
          team,
          confidence,
          minPowerRatio,
          notes: notes || undefined
        });
      });

      // Verifier si les counters ont change par rapport au default/remote
      const originalCounters = remoteCounters[teamId] || defaultCounters[teamId] || [];
      const hasChanged = JSON.stringify(counters) !== JSON.stringify(originalCounters);

      if (hasChanged) {
        newCustomCounters[teamId] = counters;
      }
    }
  });

  try {
    customCounters = newCustomCounters;
    await storageSet({ msfCustomCounters: customCounters });

    // Recalculer la fusion et re-render
    mergeCounters();
    renderTeams();

    document.getElementById("save-status").textContent = t("saved");
    document.getElementById("save-status").style.color = "#51cf66";
    setTimeout(() => {
      document.getElementById("save-status").textContent = "";
    }, 2000);
  } catch (e) {
    document.getElementById("save-status").textContent = t("error");
    document.getElementById("save-status").style.color = "#ff6b6b";
  }
});

// Retour
document.getElementById("back").addEventListener("click", () => {
  window.location.href = "popup.html";
});

// ============================================
// Language selector
// ============================================

function updateUILanguage() {
  // Update static elements with data-i18n
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if (i18n[currentLang][key]) {
      el.textContent = i18n[currentLang][key];
    }
  });

  // Update save button
  const saveBtn = document.getElementById("btn-save");
  if (saveBtn) saveBtn.textContent = t("save");

  // Update language buttons
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === currentLang);
  });
}

async function setLanguage(lang) {
  currentLang = lang;
  await storageSet({ msfLanguage: lang });
  updateUILanguage();
  renderSourceLegend();
  renderTeams();
  renderOffensiveTeams();
}

// Language button event listeners
document.querySelectorAll(".lang-btn").forEach(btn => {
  btn.addEventListener("click", () => setLanguage(btn.dataset.lang));
});

// ============================================
// Search / Filter
// ============================================

const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");

/**
 * Filtre les équipes selon la recherche
 * Cherche dans: nom équipe, nom FR, noms des membres, IDs des membres
 */
function filterTeams(query) {
  const normalizedQuery = query.toLowerCase().trim();

  document.querySelectorAll(".team-section").forEach(section => {
    const teamId = section.dataset.teamId;
    const team = teamsData.find(t => t.id === teamId);

    if (!team) {
      section.classList.add("hidden");
      return;
    }

    if (!normalizedQuery) {
      section.classList.remove("hidden");
      section.classList.remove("search-match");
      return;
    }

    // Chercher dans le nom de l'équipe
    const teamName = (team.name || "").toLowerCase();
    const teamNameFr = (team.nameFr || "").toLowerCase();

    // Chercher dans les membres
    const members = (team.members || []).map(m => m.toLowerCase());
    const memberIds = (team.memberIds || []).map(m => m.toLowerCase());

    // Chercher aussi dans les noms des personnages depuis charactersData
    const memberNames = (team.memberIds || []).map(id => {
      const char = charactersData[id];
      return char ? char.name.toLowerCase() : "";
    });

    const allSearchable = [
      teamName,
      teamNameFr,
      ...members,
      ...memberIds,
      ...memberNames
    ];

    const matches = allSearchable.some(text => text.includes(normalizedQuery));

    if (matches) {
      section.classList.remove("hidden");
      section.classList.add("search-match");
    } else {
      section.classList.add("hidden");
      section.classList.remove("search-match");
    }
  });
}

// Event listeners pour la recherche
searchInput.addEventListener("input", (e) => {
  filterTeams(e.target.value);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  filterTeams("");
  searchInput.focus();
});

// Raccourci clavier: Escape pour effacer
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    searchInput.value = "";
    filterTeams("");
  }
});

// Init
(async function init() {
  // Load saved language preference
  const stored = await storageGet("msfLanguage");
  if (stored.msfLanguage) {
    currentLang = stored.msfLanguage;
  }
  updateUILanguage();

  // Load data
  await loadData();

  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
    console.log('[Manage] Lucide Icons initialized');
  }
})();
