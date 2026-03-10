const d = require("../data/characters-full.json");
const ex = new Set(["unplayable", "operator", "nue", "war"]);
const filtered = Object.entries(d.characters).filter(([id, c]) =>
  !ex.has(c.status) && !id.startsWith("PVE_") && !id.startsWith("NUE")
);
console.log("Affiches:", filtered.length);
console.log("Total fichier:", Object.keys(d.characters).length);

// Lister les playable pour vérifier
const playable = filtered.filter(([,c]) => c.status === "playable").map(([,c]) => c.name).sort();
console.log("\nPlayable (" + playable.length + "):");
playable.forEach(n => process.stdout.write(n + ", "));
console.log("");
