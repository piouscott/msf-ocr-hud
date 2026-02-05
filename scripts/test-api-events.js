#!/usr/bin/env node
/**
 * Script pour explorer les endpoints API MSF relatifs aux événements
 * Usage: node scripts/test-api-events.js <BEARER_TOKEN>
 */

const https = require("https");

const MSF_API_KEY = "17wMKJLRxy3pYDCKG5ciP7VSU45OVumB2biCzzgw";
const BASE_URL = "api.marvelstrikeforce.com";

// Endpoints à tester
const ENDPOINTS = [
  "/game/v1/events",
  "/game/v1/events/active",
  "/game/v1/event",
  "/game/v1/campaigns",
  "/game/v1/campaign",
  "/game/v1/milestones",
  "/game/v1/milestone",
  "/game/v1/raids",
  "/game/v1/blitz",
  "/game/v1/war",
  "/game/v1/characters",
  "/game/v1/teams",
  "/game/v1/analysis/teamOrder/war",
  "/player/v1/card",
  "/player/v1/roster",
  "/player/v1/events",
];

function testEndpoint(path, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: BASE_URL,
      path: path,
      method: "GET",
      headers: {
        "x-api-key": MSF_API_KEY,
        "Authorization": token.startsWith("Bearer ") ? token : `Bearer ${token}`,
        "Accept": "application/json"
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        resolve({
          path,
          status: res.statusCode,
          success: res.statusCode === 200,
          preview: data.substring(0, 200)
        });
      });
    });

    req.on("error", (e) => {
      resolve({ path, status: "ERROR", success: false, error: e.message });
    });

    req.end();
  });
}

async function main() {
  const token = process.argv[2];

  if (!token) {
    console.log("Usage: node scripts/test-api-events.js <BEARER_TOKEN>");
    console.log("\nPour obtenir le token:");
    console.log("1. Ouvrez MSF dans le navigateur (marvelstrikeforce.com)");
    console.log("2. F12 > Onglet Network");
    console.log("3. Faites une action dans le jeu");
    console.log("4. Copiez le header 'Authorization' d'une requête");
    process.exit(1);
  }

  console.log("=== Test des endpoints API MSF ===\n");

  for (const endpoint of ENDPOINTS) {
    const result = await testEndpoint(endpoint, token);
    const icon = result.success ? "✓" : "✗";
    const color = result.success ? "\x1b[32m" : "\x1b[31m";
    console.log(`${color}${icon}\x1b[0m ${result.status} ${endpoint}`);

    if (result.success) {
      console.log(`   Preview: ${result.preview}...\n`);
    }
  }
}

main();
