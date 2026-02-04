#!/usr/bin/env node
/**
 * Test de matching par histogramme Hue (teinte HSV)
 * Les teintes sont plus robustes aux variations de luminosité
 */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const DATA_FILE = path.join(__dirname, "..", "data", "portraits.json");
const CACHE_DIR = path.join(__dirname, "..", "cache", "portraits");

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
 * Calcule l'histogramme Hue pondéré par saturation
 * Les pixels saturés comptent plus (couleurs vives)
 */
async function computeHueHistogram(imageBuffer) {
  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");

  const cropTopPercent = 0.70;
  const srcHeight = img.height * cropTopPercent;

  ctx.drawImage(img, 0, 0, img.width, srcHeight, 0, 0, 64, 64);

  const imageData = ctx.getImageData(0, 0, 64, 64);
  const pixels = imageData.data;

  // Histogramme Hue avec 36 bins (10° chacun)
  const hueBins = 36;
  const hist = new Array(hueBins).fill(0);
  let totalWeight = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const { h, s, v } = rgbToHsv(pixels[i], pixels[i + 1], pixels[i + 2]);

    // Ignorer les pixels trop sombres ou trop peu saturés
    if (s > 0.2 && v > 0.2) {
      const hueIdx = Math.min(Math.floor(h / 10), hueBins - 1);
      // Pondérer par saturation (couleurs vives comptent plus)
      const weight = s * v;
      hist[hueIdx] += weight;
      totalWeight += weight;
    }
  }

  // Normaliser
  if (totalWeight > 0) {
    for (let i = 0; i < hueBins; i++) {
      hist[i] /= totalWeight;
    }
  }

  return hist;
}

/**
 * Similarité entre deux histogrammes
 */
function histogramSimilarity(hist1, hist2) {
  let sum = 0;
  for (let i = 0; i < hist1.length; i++) {
    sum += Math.sqrt(hist1[i] * hist2[i]);
  }
  return sum;
}

/**
 * Affiche un histogramme de manière visuelle
 */
function printHueHistogram(hist, label) {
  console.log(`\n${label}:`);
  const hueLabels = ["R", "RO", "O", "OJ", "J", "JV", "V", "VB", "B", "BP", "P", "PR"];
  const step = 3; // 36 bins / 12 labels

  for (let i = 0; i < hist.length; i += step) {
    const labelIdx = Math.floor(i / step);
    const val = hist[i] + hist[i + 1] + hist[i + 2];
    const bar = "█".repeat(Math.round(val * 50));
    const lbl = (hueLabels[labelIdx] || "?").padEnd(2);
    console.log(`  ${lbl} ${bar} ${(val * 100).toFixed(1)}%`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log("Usage: node scripts/debug-hue-match.js <image>");
    process.exit(1);
  }

  const imagePath = path.resolve(args[0]);

  if (!fs.existsSync(imagePath)) {
    console.error(`Fichier introuvable: ${imagePath}`);
    process.exit(1);
  }

  console.log("=== Analyse par histogramme Hue ===\n");

  // Calculer l'histogramme de l'image de test
  const testBuf = fs.readFileSync(imagePath);
  const testHist = await computeHueHistogram(testBuf);
  printHueHistogram(testHist, `Image test: ${path.basename(imagePath)}`);

  // Comparer avec quelques portraits spécifiques
  const testChars = ["Hellverine", "CosmicGhostRider", "Ghost Rider", "HumanTorch", "Sunfire"];

  console.log("\n=== Comparaison avec personnages de feu ===\n");

  for (const charName of testChars) {
    const cacheFile = path.join(CACHE_DIR, `${charName}.png`);
    if (fs.existsSync(cacheFile)) {
      const charBuf = fs.readFileSync(cacheFile);
      const charHist = await computeHueHistogram(charBuf);
      const sim = histogramSimilarity(testHist, charHist);
      console.log(`${charName.padEnd(20)}: ${(sim * 100).toFixed(1)}%`);
    }
  }

  // Comparer avec toute la base
  console.log("\n=== Top 15 matches (Hue) ===\n");

  const candidates = [];

  for (const file of fs.readdirSync(CACHE_DIR)) {
    if (!file.endsWith(".png")) continue;
    const charId = file.replace(".png", "");
    const charBuf = fs.readFileSync(path.join(CACHE_DIR, file));
    const charHist = await computeHueHistogram(charBuf);
    const sim = histogramSimilarity(testHist, charHist);
    candidates.push({ charId, similarity: sim });
  }

  candidates.sort((a, b) => b.similarity - a.similarity);

  for (let i = 0; i < 15; i++) {
    const c = candidates[i];
    console.log(`${(i + 1).toString().padStart(2)}. ${c.charId.padEnd(30)} ${(c.similarity * 100).toFixed(1)}%`);
  }

  // Trouver la position de Hellverine
  const hellverineIdx = candidates.findIndex(c => c.charId === "Hellverine");
  if (hellverineIdx >= 0) {
    console.log(`\nHellverine: position ${hellverineIdx + 1} avec ${(candidates[hellverineIdx].similarity * 100).toFixed(1)}%`);
  }
}

main().catch(console.error);
