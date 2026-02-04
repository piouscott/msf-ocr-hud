#!/usr/bin/env node
/**
 * Script de debug pour tester la comparaison par histogramme de couleurs
 * Plus robuste aux différences de cadrage que pHash
 *
 * Usage: node scripts/debug-histogram.js <image1> <image2>
 */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const OUTPUT_DIR = path.join(__dirname, "..", "debug");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Calcule l'histogramme de couleurs d'une image
 * Retourne un histogramme normalisé pour chaque canal (R, G, B)
 */
async function computeColorHistogram(imageBuffer, cropTop = 0, cropBottom = 1) {
  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");

  const srcY = img.height * cropTop;
  const srcHeight = img.height * (cropBottom - cropTop);

  ctx.drawImage(img, 0, srcY, img.width, srcHeight, 0, 0, 64, 64);

  const imageData = ctx.getImageData(0, 0, 64, 64);
  const pixels = imageData.data;

  // Histogrammes avec 16 bins par canal (réduit pour plus de robustesse)
  const bins = 16;
  const histR = new Array(bins).fill(0);
  const histG = new Array(bins).fill(0);
  const histB = new Array(bins).fill(0);

  const totalPixels = 64 * 64;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = Math.floor(pixels[i] / (256 / bins));
    const g = Math.floor(pixels[i + 1] / (256 / bins));
    const b = Math.floor(pixels[i + 2] / (256 / bins));

    histR[r]++;
    histG[g]++;
    histB[b]++;
  }

  // Normaliser
  for (let i = 0; i < bins; i++) {
    histR[i] /= totalPixels;
    histG[i] /= totalPixels;
    histB[i] /= totalPixels;
  }

  return { histR, histG, histB, canvas };
}

/**
 * Calcule l'histogramme HSV (Hue, Saturation, Value)
 * Plus robuste aux variations de luminosité
 */
async function computeHSVHistogram(imageBuffer, cropTop = 0, cropBottom = 1) {
  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");

  const srcY = img.height * cropTop;
  const srcHeight = img.height * (cropBottom - cropTop);

  ctx.drawImage(img, 0, srcY, img.width, srcHeight, 0, 0, 64, 64);

  const imageData = ctx.getImageData(0, 0, 64, 64);
  const pixels = imageData.data;

  // Histogramme Hue avec 18 bins (20° chacun)
  const hueBins = 18;
  const histHue = new Array(hueBins).fill(0);

  // Histogramme Saturation avec 8 bins
  const satBins = 8;
  const histSat = new Array(satBins).fill(0);

  let validPixels = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;

    // Saturation
    const sat = max === 0 ? 0 : diff / max;

    // Ignorer les pixels trop gris (faible saturation)
    if (sat > 0.15) {
      // Hue
      let hue = 0;
      if (diff !== 0) {
        if (max === r) {
          hue = 60 * (((g - b) / diff) % 6);
        } else if (max === g) {
          hue = 60 * ((b - r) / diff + 2);
        } else {
          hue = 60 * ((r - g) / diff + 4);
        }
      }
      if (hue < 0) hue += 360;

      const hueIdx = Math.min(Math.floor(hue / 20), hueBins - 1);
      const satIdx = Math.min(Math.floor(sat * satBins), satBins - 1);

      histHue[hueIdx]++;
      histSat[satIdx]++;
      validPixels++;
    }
  }

  // Normaliser
  if (validPixels > 0) {
    for (let i = 0; i < hueBins; i++) {
      histHue[i] /= validPixels;
    }
    for (let i = 0; i < satBins; i++) {
      histSat[i] /= validPixels;
    }
  }

  return { histHue, histSat, validPixels };
}

/**
 * Calcule la similarité entre deux histogrammes (Bhattacharyya coefficient)
 */
function histogramSimilarity(hist1, hist2) {
  let sum = 0;
  for (let i = 0; i < hist1.length; i++) {
    sum += Math.sqrt(hist1[i] * hist2[i]);
  }
  return sum; // 1 = identique, 0 = complètement différent
}

/**
 * Calcule la distance chi-carré entre deux histogrammes
 */
function chiSquareDistance(hist1, hist2) {
  let sum = 0;
  for (let i = 0; i < hist1.length; i++) {
    if (hist1[i] + hist2[i] > 0) {
      sum += Math.pow(hist1[i] - hist2[i], 2) / (hist1[i] + hist2[i]);
    }
  }
  return sum; // 0 = identique, plus grand = différent
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: node scripts/debug-histogram.js <image1> <image2>");
    process.exit(1);
  }

  const [file1, file2] = args.map(f => path.resolve(f));

  for (const file of [file1, file2]) {
    if (!fs.existsSync(file)) {
      console.error(`Fichier introuvable: ${file}`);
      process.exit(1);
    }
  }

  const buf1 = fs.readFileSync(file1);
  const buf2 = fs.readFileSync(file2);

  console.log("=== Comparaison par Histogramme ===\n");

  // Test différents crops
  const cropConfigs = [
    { crop1: [0, 0.70], crop2: [0, 0.70], label: "70% top" },
    { crop1: [0, 0.50], crop2: [0, 0.50], label: "50% top" },
    { crop1: [0, 0.35], crop2: [0, 0.50], label: "API 35%, ingame 50%" },
    { crop1: [0, 1], crop2: [0, 1], label: "Image complète" },
  ];

  console.log("=== Histogramme RGB ===\n");

  for (const config of cropConfigs) {
    const hist1 = await computeColorHistogram(buf1, config.crop1[0], config.crop1[1]);
    const hist2 = await computeColorHistogram(buf2, config.crop2[0], config.crop2[1]);

    const simR = histogramSimilarity(hist1.histR, hist2.histR);
    const simG = histogramSimilarity(hist1.histG, hist2.histG);
    const simB = histogramSimilarity(hist1.histB, hist2.histB);
    const avgSim = (simR + simG + simB) / 3;

    console.log(`${config.label}:`);
    console.log(`  Similarité R: ${(simR * 100).toFixed(1)}%`);
    console.log(`  Similarité G: ${(simG * 100).toFixed(1)}%`);
    console.log(`  Similarité B: ${(simB * 100).toFixed(1)}%`);
    console.log(`  Moyenne RGB: ${(avgSim * 100).toFixed(1)}%\n`);
  }

  console.log("=== Histogramme HSV (Hue) ===\n");

  for (const config of cropConfigs) {
    const hsv1 = await computeHSVHistogram(buf1, config.crop1[0], config.crop1[1]);
    const hsv2 = await computeHSVHistogram(buf2, config.crop2[0], config.crop2[1]);

    const hueSim = histogramSimilarity(hsv1.histHue, hsv2.histHue);
    const satSim = histogramSimilarity(hsv1.histSat, hsv2.histSat);

    console.log(`${config.label}:`);
    console.log(`  Similarité Hue: ${(hueSim * 100).toFixed(1)}%`);
    console.log(`  Similarité Sat: ${(satSim * 100).toFixed(1)}%`);
    console.log(`  Pixels colorés img1: ${hsv1.validPixels}, img2: ${hsv2.validPixels}\n`);
  }

  // Analyser la distribution de couleurs dominante
  console.log("=== Analyse des couleurs dominantes ===\n");

  const fullHist1 = await computeColorHistogram(buf1, 0, 0.7);
  const fullHist2 = await computeColorHistogram(buf2, 0, 0.7);

  // Trouver les pics dans les histogrammes
  function findPeaks(hist, label) {
    const peaks = hist.map((v, i) => ({ idx: i, val: v }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 3);
    return peaks;
  }

  console.log("Image 1 - Pics Rouge:", findPeaks(fullHist1.histR).map(p => `bin${p.idx}:${(p.val*100).toFixed(1)}%`).join(", "));
  console.log("Image 2 - Pics Rouge:", findPeaks(fullHist2.histR).map(p => `bin${p.idx}:${(p.val*100).toFixed(1)}%`).join(", "));
  console.log("Image 1 - Pics Vert:", findPeaks(fullHist1.histG).map(p => `bin${p.idx}:${(p.val*100).toFixed(1)}%`).join(", "));
  console.log("Image 2 - Pics Vert:", findPeaks(fullHist2.histG).map(p => `bin${p.idx}:${(p.val*100).toFixed(1)}%`).join(", "));
  console.log("Image 1 - Pics Bleu:", findPeaks(fullHist1.histB).map(p => `bin${p.idx}:${(p.val*100).toFixed(1)}%`).join(", "));
  console.log("Image 2 - Pics Bleu:", findPeaks(fullHist2.histB).map(p => `bin${p.idx}:${(p.val*100).toFixed(1)}%`).join(", "));
}

main().catch(console.error);
