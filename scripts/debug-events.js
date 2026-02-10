/**
 * Script pour afficher les détails d'un event spécifique
 * Usage: node scripts/debug-events.js [nom-event]
 *
 * Nécessite un token OAuth valide dans l'env ou en argument
 */

const MSF_API_KEY = "17wMKJLRxy3pYDCKG5ciP7VSU45OVumB2biCzzgw";

async function fetchEvents(token) {
  const headers = {
    "x-api-key": MSF_API_KEY,
    "Accept": "application/json"
  };

  if (token) {
    headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }

  // Essayer /player/v1/events d'abord
  let response = await fetch("https://api.marvelstrikeforce.com/player/v1/events", { headers });

  if (!response.ok) {
    console.log("Fallback sur /game/v1/events...");
    response = await fetch("https://api.marvelstrikeforce.com/game/v1/events", { headers });
  }

  if (!response.ok) {
    throw new Error(`Erreur API: ${response.status}`);
  }

  const data = await response.json();
  return data.data || data;
}

async function main() {
  const searchTerm = process.argv[2] || "110";
  const token = process.argv[3] || process.env.MSF_TOKEN;

  console.log(`Recherche d'events contenant "${searchTerm}"...\n`);

  try {
    const events = await fetchEvents(token);
    const now = Date.now() / 1000;

    // Filtrer les events actifs qui matchent
    const matches = events.filter(e => {
      const isActive = e.startTime < now && e.endTime > now;
      const nameMatch = e.name.toLowerCase().includes(searchTerm.toLowerCase());
      return isActive && nameMatch;
    });

    if (matches.length === 0) {
      console.log(`Aucun event actif trouvé pour "${searchTerm}"`);
      console.log("\nEvents actifs disponibles:");
      events
        .filter(e => e.startTime < now && e.endTime > now)
        .forEach(e => console.log(`  - ${e.name} (type: ${e.type})`));
      return;
    }

    matches.forEach(event => {
      console.log("=".repeat(60));
      console.log(`Nom: ${event.name}`);
      console.log(`ID: ${event.id}`);
      console.log(`Type: ${event.type}`);
      console.log(`Début: ${new Date(event.startTime * 1000).toLocaleString()}`);
      console.log(`Fin: ${new Date(event.endTime * 1000).toLocaleString()}`);
      console.log("");

      // Afficher les données spécifiques selon le type
      if (event.type === "milestone" && event.milestone) {
        console.log("--- MILESTONE DATA ---");
        console.log(`TypeName: ${event.milestone.typeName || "N/A"}`);

        if (event.milestone.scoring) {
          const s = event.milestone.scoring;
          console.log(`Description: ${s.description || "N/A"}`);

          if (s.methods && s.methods.length > 0) {
            console.log("\nMéthodes de scoring:");
            s.methods.forEach(m => {
              console.log(`  - ${m.description}: ${m.points} pts`);
            });
          }

          if (s.cappedScorings && s.cappedScorings.length > 0) {
            console.log("\nScorings plafonnés:");
            s.cappedScorings.forEach(cs => {
              console.log(`  Cap: ${cs.cap} pts`);
              cs.methods?.forEach(m => {
                console.log(`    - ${m.description}: ${m.points} pts`);
              });
            });
          }
        }
      }

      if (event.type === "episodic" && event.episodic) {
        console.log("--- EPISODIC DATA ---");
        console.log(`Type: ${event.episodic.type}`);
        console.log(`TypeName: ${event.episodic.typeName || "N/A"}`);
        console.log(JSON.stringify(event.episodic, null, 2));
      }

      // Afficher tout le JSON brut
      console.log("\n--- RAW JSON ---");
      console.log(JSON.stringify(event, null, 2));
    });

  } catch (err) {
    console.error("Erreur:", err.message);
  }
}

main();
