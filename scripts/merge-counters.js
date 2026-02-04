/**
 * Fusionne les counters Marvel Church avec counters.json existant
 * Usage: node scripts/merge-counters.js
 */

const fs = require("fs");
const path = require("path");

const EXISTING_FILE = path.join(__dirname, "..", "data", "counters.json");
const MARVEL_CHURCH_FILE = path.join(__dirname, "..", "data", "counters-marvel-church.json");
const OUTPUT_FILE = path.join(__dirname, "..", "data", "counters.json");

// Charge les fichiers
const existing = JSON.parse(fs.readFileSync(EXISTING_FILE, "utf-8"));
const marvelChurch = JSON.parse(fs.readFileSync(MARVEL_CHURCH_FILE, "utf-8"));

const existingCounters = existing.counters || {};
const newCounters = marvelChurch.counters || {};

// Fusionne les counters
const merged = { ...existingCounters };

let addedTeams = 0;
let addedCounters = 0;
let updatedCounters = 0;

for (const [teamId, counters] of Object.entries(newCounters)) {
  if (!merged[teamId]) {
    // Nouvelle equipe de defense
    merged[teamId] = counters;
    addedTeams++;
    addedCounters += counters.length;
  } else {
    // Equipe existante - fusionner les counters
    const existingSet = new Set(
      merged[teamId].map(c => `${c.team}|${c.confidence}`)
    );

    for (const counter of counters) {
      const key = `${counter.team}|${counter.confidence}`;
      if (!existingSet.has(key)) {
        merged[teamId].push(counter);
        addedCounters++;
      } else {
        // Counter existe deja - mettre a jour les notes si manquantes
        const existing = merged[teamId].find(
          c => c.team === counter.team && c.confidence === counter.confidence
        );
        if (existing && !existing.notes && counter.notes) {
          existing.notes = counter.notes;
          updatedCounters++;
        }
      }
    }

    // Trier par confiance decroissante
    merged[teamId].sort((a, b) => b.confidence - a.confidence);
  }
}

// Stats
let totalTeams = Object.keys(merged).length;
let totalCounters = 0;
for (const counters of Object.values(merged)) {
  totalCounters += counters.length;
}

console.log("=== Fusion terminee ===");
console.log(`Nouvelles equipes de defense: ${addedTeams}`);
console.log(`Nouveaux counters ajoutes: ${addedCounters}`);
console.log(`Counters mis a jour (notes): ${updatedCounters}`);
console.log(`Total equipes: ${totalTeams}`);
console.log(`Total counters: ${totalCounters}`);

// Sauvegarde
const output = {
  description: "MSF War Counter suggestions - Merged with Marvel Church data",
  version: 4,
  lastUpdate: new Date().toISOString().split("T")[0],
  source: "https://marvelstrikeforce.church/alliance-war-counters/",
  counters: merged
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
console.log(`\nSauvegarde dans: ${OUTPUT_FILE}`);
