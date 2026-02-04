#!/usr/bin/env node
/**
 * Script de debug pour trouver le meilleur match dans la base de portraits
 *
 * Usage: node scripts/debug-find-match.js <image>
 */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const DATA_FILE = path.join(__dirname, "..", "data", "portraits.json");

/**
 * Calcule l'histogramme RGB normalise
 */
async function computeRGBHistogram(imageBuffer) {
  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");

  const cropTopPercent = 0.70;
  const srcHeight = img.height * cropTopPercent;

  ctx.drawImage(img, 0, 0, img.width, srcHeight, 0, 0, 64, 64);

  const imageData = ctx.getImageData(0, 0, 64, 64);
  const pixels = imageData.data;

  const bins = 16;
  const histR = new Array(bins).fill(0);
  const histG = new Array(bins).fill(0);
  const histB = new Array(bins).fill(0);

  const totalPixels = 64 * 64;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = Math.floor(pixels[i] / (256 / bins));
    const g = Math.floor(pixels[i + 1] / (256 / bins));
    const b = Math.floor(pixels[i + 2] / (256 / bins));

    histR[Math.min(r, bins - 1)]++;
    histG[Math.min(g, bins - 1)]++;
    histB[Math.min(b, bins - 1)]++;
  }

  for (let i = 0; i < bins; i++) {
    histR[i] = histR[i] / totalPixels;
    histG[i] = histG[i] / totalPixels;
    histB[i] = histB[i] / totalPixels;
  }

  return { r: histR, g: histG, b: histB };
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
 * Calcule l'histogramme Hue pondere par saturation
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
 * Similarite Bhattacharyya pour histogramme Hue
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
 * Calcule le hash pHash
 */
async function computePortraitHash(imageBuffer) {
  const hashSize = 8;
  const sampleSize = 32;

  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(sampleSize, sampleSize);
  const ctx = canvas.getContext("2d");

  const cropTopPercent = 0.70;
  const srcHeight = img.height * cropTopPercent;

  ctx.drawImage(img, 0, 0, img.width, srcHeight, 0, 0, sampleSize, sampleSize);

  const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
  const pixels = imageData.data;

  const gray = new Float32Array(sampleSize * sampleSize);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
  }

  const resized = new Float32Array(hashSize * hashSize);
  const blockW = sampleSize / hashSize;
  const blockH = sampleSize / hashSize;

  for (let y = 0; y < hashSize; y++) {
    for (let x = 0; x < hashSize; x++) {
      let sum = 0;
      let count = 0;
      const startY = Math.floor(y * blockH);
      const endY = Math.floor((y + 1) * blockH);
      const startX = Math.floor(x * blockW);
      const endX = Math.floor((x + 1) * blockW);

      for (let py = startY; py < endY; py++) {
        for (let px = startX; px < endX; px++) {
          sum += gray[py * sampleSize + px];
          count++;
        }
      }
      resized[y * hashSize + x] = count > 0 ? sum / count : 0;
    }
  }

  const sorted = [...resized].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let binary = "";
  for (let i = 0; i < resized.length; i++) {
    binary += resized[i] > median ? "1" : "0";
  }

  let hex = "";
  for (let i = 0; i < binary.length; i += 4) {
    hex += parseInt(binary.substr(i, 4), 2).toString(16);
  }

  return hex;
}

/**
 * Similarite pHash (distance de Hamming)
 */
function hashSimilarity(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 0;
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    let xor = n1 ^ n2;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  const maxBits = hash1.length * 4;
  return Math.round((1 - distance / maxBits) * 100);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log("Usage: node scripts/debug-find-match.js <image>");
    console.log("Exemple: node scripts/debug-find-match.js debug/hellverine-ingame.png");
    process.exit(1);
  }

  const imagePath = path.resolve(args[0]);

  if (!fs.existsSync(imagePath)) {
    console.error(`Fichier introuvable: ${imagePath}`);
    process.exit(1);
  }

  // Charger la base de portraits
  const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  console.log(`Base de portraits: ${db.count} personnages (v${db.version})`);

  // Calculer l'histogramme Hue de l'image de test
  console.log(`\nAnalyse de: ${path.basename(imagePath)}`);
  const buf = fs.readFileSync(imagePath);
  const testHue = await computeHueHistogram(buf);

  // Comparaison par histogramme Hue
  const candidates = [];
  const HUE_THRESHOLD = 90;

  for (const [charId, data] of Object.entries(db.portraits)) {
    if (!data.hue) continue;

    const sim = hueHistogramSimilarity(testHue, data.hue) * 100;

    if (sim >= HUE_THRESHOLD) {
      candidates.push({
        charId,
        name: data.name,
        similarity: sim
      });
    }
  }

  // Trier par similarite
  candidates.sort((a, b) => b.similarity - a.similarity);

  // Afficher les top 10
  console.log("\n=== Top 10 matches (Histogramme Hue) ===\n");
  console.log("┌────┬──────────────────────────────┬───────────┐");
  console.log("│ #  │ Personnage                   │ Similarité│");
  console.log("├────┼──────────────────────────────┼───────────┤");

  for (let i = 0; i < Math.min(10, candidates.length); i++) {
    const c = candidates[i];
    const rank = String(i + 1).padStart(2);
    const name = c.name.padEnd(28).substring(0, 28);
    const sim = `${c.similarity.toFixed(1)}%`.padStart(9);
    console.log(`│ ${rank} │ ${name} │ ${sim} │`);
  }

  console.log("└────┴──────────────────────────────┴───────────┘");

  // Verdict
  if (candidates.length === 0) {
    console.log("\n✗ Aucun candidat (Hue < 90%)");
    return;
  }

  const best = candidates[0];
  const gap = candidates.length > 1 ? best.similarity - candidates[1].similarity : 100;

  console.log("\n=== Verdict ===");
  if (best.similarity >= 90 && gap >= 1.5) {
    console.log(`✓ MATCH: ${best.name} (${best.similarity.toFixed(1)}%)`);
    console.log(`  Ecart avec 2eme: ${gap.toFixed(1)}%`);
  } else if (best.similarity >= 90) {
    console.log(`⚠ MATCH AMBIGU: ${best.name} (${best.similarity.toFixed(1)}%)`);
    console.log(`  Ecart faible avec ${candidates[1].name}: ${gap.toFixed(1)}%`);
  } else {
    console.log(`✗ PAS DE MATCH (meilleur: ${best.name} a ${best.similarity.toFixed(1)}%)`);
  }
}

main().catch(console.error);
