const ext = typeof browser !== "undefined" ? browser : chrome;

let teamsData = [];
let defaultCounters = {};
let remoteCounters = {};
let customCounters = {};
let mergedCounters = {};

// Source des counters pour chaque equipe
let counterSources = {};

// Charger les donnees avec les 3 niveaux
async function loadData() {
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
    defaultCounters = countersJson.counters || {};

    // Charger les counters remote depuis storage
    const storedRemote = await ext.storage.local.get("msfRemoteCounters");
    if (storedRemote.msfRemoteCounters && storedRemote.msfRemoteCounters.counters) {
      remoteCounters = storedRemote.msfRemoteCounters.counters;
    }

    // Charger les counters custom depuis storage
    const storedCustom = await ext.storage.local.get("msfCustomCounters");
    if (storedCustom.msfCustomCounters) {
      customCounters = storedCustom.msfCustomCounters;
    }

    // Fusionner les counters et determiner les sources
    mergeCounters();

    renderTeams();
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

function renderSourceLegend() {
  const legend = document.getElementById("source-legend");
  if (!legend) return;

  const hasRemote = Object.keys(remoteCounters).length > 0;
  const hasCustom = Object.keys(customCounters).length > 0;

  legend.innerHTML = `
    <span class="legend-item"><span class="source-badge default"></span> Defaut</span>
    ${hasRemote ? '<span class="legend-item"><span class="source-badge remote"></span> Sync</span>' : ''}
    ${hasCustom ? '<span class="legend-item"><span class="source-badge custom"></span> Perso</span>' : ''}
  `;
}

function renderTeams() {
  const container = document.getElementById("teams-container");
  container.innerHTML = "";

  teamsData.forEach(team => {
    const section = document.createElement("div");
    section.className = "team-section";
    section.dataset.teamId = team.id;

    const counters = mergedCounters[team.id] || [];
    const source = counterSources[team.id] || "default";

    section.innerHTML = `
      <div class="team-header">
        <span class="team-name-title">${team.name}</span>
        <span class="team-meta">
          <span class="source-badge ${source}" title="Source: ${source}"></span>
          <span class="team-toggle">${counters.length} counters</span>
        </span>
      </div>
      <div class="counter-list">
        ${counters.map((c, i) => renderCounterRow(c, i)).join("")}
        <button class="btn-add-counter" data-team="${team.id}">+ Ajouter counter</button>
        ${source !== "default" ? `<button class="btn-reset" data-team="${team.id}">Reinitialiser</button>` : ""}
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
}

function renderCounterRow(counter, index) {
  const teamOptions = teamsData.map(t =>
    `<option value="${t.id}" ${t.id === counter.team ? "selected" : ""}>${t.name}</option>`
  ).join("");

  return `
    <div class="counter-row" data-index="${index}">
      <select class="counter-team">${teamOptions}</select>
      <input type="number" class="counter-confidence" value="${counter.confidence}" min="0" max="100" title="Confiance %">
      <input type="number" class="counter-ratio" value="${counter.minPowerRatio}" min="0.5" max="2" step="0.1" title="Ratio puissance">
      <input type="text" class="counter-notes" value="${counter.notes || ""}" placeholder="Notes">
      <button class="btn-remove">X</button>
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

  list.insertBefore(row, addBtn);
}

/**
 * Reinitialise les counters d'une equipe aux valeurs par defaut
 */
async function resetTeamCounters(teamId) {
  if (!confirm(`Reinitialiser les counters de cette equipe aux valeurs par defaut ?`)) {
    return;
  }

  // Supprimer du custom
  delete customCounters[teamId];
  await ext.storage.local.set({ msfCustomCounters: customCounters });

  // Recalculer la fusion
  mergeCounters();
  renderTeams();

  document.getElementById("save-status").textContent = "Reinitialise!";
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
    await ext.storage.local.set({ msfCustomCounters: customCounters });

    // Recalculer la fusion et re-render
    mergeCounters();
    renderTeams();

    document.getElementById("save-status").textContent = "Sauvegarde!";
    document.getElementById("save-status").style.color = "#51cf66";
    setTimeout(() => {
      document.getElementById("save-status").textContent = "";
    }, 2000);
  } catch (e) {
    document.getElementById("save-status").textContent = "Erreur!";
    document.getElementById("save-status").style.color = "#ff6b6b";
  }
});

// Retour
document.getElementById("back").addEventListener("click", () => {
  window.location.href = "popup.html";
});

// Init
loadData();
