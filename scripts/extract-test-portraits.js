#!/usr/bin/env node
/**
 * Script pour extraire des portraits depuis des captures d'écran de guerre
 * et les tester contre la base de données
 */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const DATA_FILE = path.join(__dirname, "..", "data", "portraits.json");
const OUTPUT_DIR = path.join(__dirname, "..", "debug", "extracted");

// Créer le dossier de sortie
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Convertit RGB en HSV
 */
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  let h = 0;
  if (diff !== 0) {
    if (max === r) h = 60 * (((g - b) / diff) % 6);
    else if (max === g) h = 60 * ((b - r) / diff + 2);
    else h = 60 * ((r - g) / diff + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : diff / max;
  const v = max;

  return { h, s, v };
}

/**
 * Calcule l'histogramme Hue
 */
function computeHueHistogramFromImageData(imageData) {
  const pixels = imageData.data;
  const hueBins = 36;
  const hist = new Array(hueBins).fill(0);
  let totalWeight = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const { h, s, v } = rgbToHsv(pixels[i], pixels[i + 1], pixels[i + 2]);

    if (s > 0.2 && v > 0.2) {
      const hueIdx = Math.min(Math.floor(h / 10), hueBins - 1);
      const weight = s * v;
      hist[hueIdx] += weight;
      totalWeight += weight;
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < hueBins; i++) {
      hist[i] = hist[i] / totalWeight;
    }
  }

  return hist;
}

/**
 * Similarité Bhattacharyya
 */
function hueHistogramSimilarity(hist1, hist2) {
  if (!hist1 || !hist2 || hist1.length !== hist2.length) return 0;
  let sum = 0;
  for (let i = 0; i < hist1.length; i++) {
    sum += Math.sqrt(hist1[i] * hist2[i]);
  }
  return sum;
}

/**
 * Trouve le meilleur match dans la base
 */
function findBestMatch(testHue, db, threshold = 90) {
  const candidates = [];

  for (const [charId, data] of Object.entries(db.portraits)) {
    if (!data.hue) continue;

    const sim = hueHistogramSimilarity(testHue, data.hue) * 100;
    if (sim >= threshold) {
      candidates.push({
        charId,
        name: data.name,
        similarity: sim
      });
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, 5);
}

/**
 * Positions des portraits dans une capture d'écran de guerre (4 équipes de 5)
 * Coordonnées calibrées pour une résolution 1920x1032
 * Layout: 2 portraits en haut, 3 portraits en bas par équipe
 */
function getPortraitPositions(screenWidth, screenHeight) {
  const teams = [];

  // Positions X de départ pour chaque équipe (bord gauche de la carte)
  // Note: GreenArrow section (joueur) est à gauche, puis les 4 cartes d'équipe
  // Teams 1-2 décalés davantage pour éviter la bordure avec la section joueur
  const baseTeamX = [365, 650, 885, 1170];
  const teamWidth = 280;

  // Taille des portraits (cercles) - réduite pour éviter l'UI environnante
  const portraitSize = 42;

  // Positions Y des rangées de portraits - recalibrées pour Flight Deck
  // Row 2 fonctionne à 270, row1 doit être ~52px plus haut
  const row1Y = 218;  // Rangée du haut (2 portraits)
  const row2Y = 270;  // Rangée du bas (3 portraits)

  // Offsets X des portraits dans chaque équipe (relatifs au bord gauche de l'équipe)
  // Row 1: 2 portraits centrés dans la carte (~270px large)
  // Décalés vers la droite pour éviter le bord gauche de la carte
  const row1Offsets = [115, 195];
  // Row 2: 3 portraits répartis
  const row2Offsets = [55, 125, 195];

  // Appliquer un facteur de scale si résolution différente
  const scaleX = screenWidth / 1920;
  const scaleY = screenHeight / 1032;

  for (let t = 0; t < 4; t++) {
    const team = [];
    const teamX = baseTeamX[t] * scaleX;
    const y1 = row1Y * scaleY;
    const y2 = row2Y * scaleY;
    const ps = portraitSize * Math.min(scaleX, scaleY);

    // Row 1: 2 portraits
    for (const offset of row1Offsets) {
      team.push({ x: teamX + offset * scaleX, y: y1, w: ps, h: ps });
    }

    // Row 2: 3 portraits
    for (const offset of row2Offsets) {
      team.push({ x: teamX + offset * scaleX, y: y2, w: ps, h: ps });
    }

    teams.push(team);
  }

  return teams;
}

async function processScreenshot(screenshotPath, db) {
  const img = await loadImage(screenshotPath);
  const filename = path.basename(screenshotPath, path.extname(screenshotPath));

  console.log(`\n=== ${filename} (${img.width}x${img.height}) ===\n`);

  // Obtenir les positions des portraits
  const teams = getPortraitPositions(img.width, img.height);

  const results = [];

  for (let teamIdx = 0; teamIdx < teams.length; teamIdx++) {
    const team = teams[teamIdx];
    const teamResults = [];

    for (let portIdx = 0; portIdx < team.length; portIdx++) {
      const pos = team[portIdx];

      // Extraire le portrait
      const canvas = createCanvas(64, 64);
      const ctx = canvas.getContext("2d");

      // Dessiner avec crop 70% du haut
      const srcHeight = pos.h * 0.70;
      ctx.drawImage(img, pos.x, pos.y, pos.w, srcHeight, 0, 0, 64, 64);

      // Calculer l'histogramme Hue
      const imageData = ctx.getImageData(0, 0, 64, 64);
      const hue = computeHueHistogramFromImageData(imageData);

      // Trouver le match
      const matches = findBestMatch(hue, db, 85);

      // Sauvegarder le portrait extrait
      const outputPath = path.join(OUTPUT_DIR, `${filename}_team${teamIdx + 1}_port${portIdx + 1}.png`);
      fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));

      teamResults.push({
        position: portIdx + 1,
        matches: matches
      });
    }

    // Afficher les résultats de l'équipe
    console.log(`Équipe ${teamIdx + 1}:`);
    for (const result of teamResults) {
      if (result.matches.length > 0) {
        const best = result.matches[0];
        const gap = result.matches.length > 1 ? (best.similarity - result.matches[1].similarity).toFixed(1) : "N/A";
        const ambiguous = result.matches.length > 1 && (best.similarity - result.matches[1].similarity) < 1.5;
        console.log(`  ${result.position}. ${best.name.padEnd(25)} ${best.similarity.toFixed(1)}% ${ambiguous ? "(AMBIGU - gap:" + gap + "%)" : ""}`);
      } else {
        console.log(`  ${result.position}. ??? (pas de match)`);
      }
    }

    results.push(teamResults);
  }

  return results;
}

async function main() {
  // Charger la base de données
  const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  console.log(`Base de portraits: ${db.count} personnages (v${db.version})`);

  // Trouver les captures d'écran dans debug/
  const debugDir = path.join(__dirname, "..", "debug");
  const screenshots = fs.readdirSync(debugDir)
    .filter(f => f.endsWith(".png") && !f.includes("cropped") && !f.includes("compare"))
    .map(f => path.join(debugDir, f));

  if (screenshots.length === 0) {
    console.log("Aucune capture d'écran trouvée dans debug/");
    console.log("Placez les captures PNG dans le dossier debug/");
    return;
  }

  console.log(`${screenshots.length} captures trouvées`);

  for (const screenshot of screenshots) {
    await processScreenshot(screenshot, db);
  }

  console.log(`\nPortraits extraits dans: ${OUTPUT_DIR}`);
}

main().catch(console.error);
