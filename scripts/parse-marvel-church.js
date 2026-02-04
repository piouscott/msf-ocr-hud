/**
 * Parse le fichier HTML de Marvel Church et extrait les counters
 * Usage: node scripts/parse-marvel-church.js
 */

const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.join(__dirname, "..", "debug", "code_marvel_church.txt");
const OUTPUT_FILE = path.join(__dirname, "..", "data", "counters-marvel-church.json");

// Mapping des noms d'équipes vers nos IDs
const TEAM_NAME_TO_ID = {
  "absolute a-force": "absoluteaforce",
  "absolute aforce": "absoluteaforce",
  "a-force": "aforce",
  "accursed": "accursed",
  "alpha flight": "alphaflight",
  "annihilator": "annihilator",
  "astral": "astral",
  "black order": "blackorder",
  "brimstone": "brimstone",
  "cabal": "cabal",
  "eternal": "eternals",
  "eternals": "eternals",
  "fantastic four": "fantasticfourmcu",
  "fantastic four (mcu)": "fantasticfourmcu",
  "gamma": "gamma",
  "hellfire club": "hellfireclub",
  "hive-mind": "hivemind",
  "hivemind": "hivemind",
  "illuminati": "illuminati",
  "immortal weapon": "immortalweapon",
  "immortal x-men": "immortalxmen",
  "immortal xmen": "immortalxmen",
  "infestation": "infestation",
  "insidious six": "insidioussix",
  "knowhere": "knowhere",
  "liberty": "liberty",
  "mercs for money": "mercsformoney",
  "mighty avengers": "mightyavenger",
  "mighty avenger": "mightyavenger",
  "new mutants": "newmutant",
  "new avengers": "newavenger",
  "nightstalker": "nightstalker",
  "orchis": "orchis",
  "out of time": "outoftime",
  "secret warrior": "secretwarrior",
  "secret warriors": "secretwarrior",
  "spider-society": "spidersociety",
  "spidersociety": "spidersociety",
  "starjammer": "starjammer",
  "secret defenders": "secretdefender",
  "superior six": "superiorsix",
  "sinister six": "sinistersix",
  "tangled web": "tangledweb",
  "tangled": "tangled",
  "thunderbolt": "thunderbolt",
  "underworld": "underworld",
  "undying": "undying",
  "vigilante": "vigilante",
  "weapon x": "weaponx",
  "x-treme x-men": "xtreme",
  "xtreme xmen": "xtreme",
};

// Convertit les triangles en niveau de confiance
function trianglesToConfidence(text) {
  // Compte les triangles verts (▲)
  const greenTriangles = (text.match(/▲/g) || []).length;
  // Compte les triangles rouges (▼)
  const redTriangles = (text.match(/▼/g) || []).length;
  // Symbole égal
  const hasEqual = text.includes("⊜");

  if (redTriangles > 0) return null; // Punch down, on ignore
  if (hasEqual) return 50;
  if (greenTriangles >= 3) return 95;
  if (greenTriangles === 2) return 80;
  if (greenTriangles === 1) return 65;
  return null;
}

// Extrait le nom de l'équipe counter et les notes
function parseCounterLine(line) {
  // Nettoie le HTML
  let text = line
    .replace(/<[^>]+>/g, "") // Supprime les tags HTML
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

  // Extrait le niveau de confiance
  const confidence = trianglesToConfidence(text);
  if (confidence === null) return null;

  // Supprime les triangles et symboles
  text = text.replace(/[▲▼⊜]/g, "").trim();

  // Sépare le nom et les notes (format: "Team Name – notes" ou "Team Name - notes")
  let teamPart = text;
  let notes = "";

  // Cherche les notes après un tiret ou un numéro
  const dashMatch = text.match(/^(.+?)\s*[–-]\s*(\d+)?\s*$/);
  if (dashMatch) {
    teamPart = dashMatch[1].trim();
  }

  // Cherche les notes entre parenthèses
  const notesMatch = teamPart.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (notesMatch) {
    teamPart = notesMatch[1].trim();
    notes = notesMatch[2].trim();
  }

  // Cherche les "+1" après le nom de l'équipe
  const plusMatch = teamPart.match(/^(.+?)\s*\+\s*(.+)$/);
  if (plusMatch) {
    const baseTeam = plusMatch[1].trim().toLowerCase();
    const additions = plusMatch[2].trim();

    // Vérifie si c'est une équipe connue
    const teamId = TEAM_NAME_TO_ID[baseTeam];
    if (teamId) {
      notes = notes ? `+ ${additions}, ${notes}` : `+ ${additions}`;
      return { team: teamId, confidence, notes: notes || undefined };
    }
  }

  // Cherche l'équipe de base
  const teamName = teamPart.toLowerCase().replace(/\s+/g, " ").trim();
  const teamId = TEAM_NAME_TO_ID[teamName];

  if (!teamId) {
    // console.log(`Équipe inconnue: "${teamPart}"`);
    return null;
  }

  return { team: teamId, confidence, notes: notes || undefined };
}

// Parse le fichier
function parseMarvelChurch() {
  const content = fs.readFileSync(INPUT_FILE, "utf-8");
  const lines = content.split("\n");

  const counters = {};
  let currentDefenseTeam = null;
  let unknownTeams = new Set();
  let unknownCounters = new Set();

  for (const line of lines) {
    // Cherche les headers d'équipes de défense
    const h2Match = line.match(/<h2[^>]*>([^<]+)<\/h2>/i);
    if (h2Match) {
      const teamName = h2Match[1]
        .replace(/\+.*$/, "") // Supprime les "+X" à la fin
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

      const teamId = TEAM_NAME_TO_ID[teamName];
      if (teamId) {
        currentDefenseTeam = teamId;
        if (!counters[currentDefenseTeam]) {
          counters[currentDefenseTeam] = [];
        }
      } else if (!teamName.includes("intro") && !teamName.includes("explanation") && !teamName.includes("conclusion")) {
        unknownTeams.add(teamName);
        currentDefenseTeam = null;
      }
      continue;
    }

    // Cherche les counters dans les listes
    if (currentDefenseTeam && line.includes("<li>")) {
      const counter = parseCounterLine(line);
      if (counter) {
        // Évite les doublons
        const exists = counters[currentDefenseTeam].some(
          c => c.team === counter.team && c.confidence === counter.confidence
        );
        if (!exists) {
          counters[currentDefenseTeam].push(counter);
        }
      } else if (line.includes("▲")) {
        // Counter valide mais équipe inconnue
        const cleanLine = line.replace(/<[^>]+>/g, "").replace(/[▲▼⊜]/g, "").trim();
        if (cleanLine) unknownCounters.add(cleanLine);
      }
    }
  }

  // Trie les counters par confiance décroissante
  for (const teamId in counters) {
    counters[teamId].sort((a, b) => b.confidence - a.confidence);
  }

  console.log("\n=== Équipes de défense inconnues ===");
  for (const team of unknownTeams) {
    console.log(`  - "${team}"`);
  }

  console.log("\n=== Counters avec équipes inconnues ===");
  for (const counter of [...unknownCounters].slice(0, 20)) {
    console.log(`  - "${counter}"`);
  }
  if (unknownCounters.size > 20) {
    console.log(`  ... et ${unknownCounters.size - 20} autres`);
  }

  // Stats
  let totalCounters = 0;
  for (const teamId in counters) {
    totalCounters += counters[teamId].length;
  }

  console.log(`\n=== Résumé ===`);
  console.log(`Équipes de défense: ${Object.keys(counters).length}`);
  console.log(`Counters totaux: ${totalCounters}`);

  // Sauvegarde
  const output = {
    description: "Counters extraits de Marvel Church",
    source: "https://marvelstrikeforce.church/alliance-war-counters/",
    extractedAt: new Date().toISOString(),
    counters
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nSauvegardé dans: ${OUTPUT_FILE}`);

  return counters;
}

parseMarvelChurch();
