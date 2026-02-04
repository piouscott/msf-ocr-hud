#!/usr/bin/env node
/**
 * Script de debug pour comparer deux images et voir leur similarité
 * Calcule le hash pHash de chaque image et affiche la distance de Hamming
 *
 * Usage: node scripts/debug-compare.js <image1> <image2>
 * Exemple: node scripts/debug-compare.js cache/portraits/Hellverine.png debug/ingame-capture.png
 */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const OUTPUT_DIR = path.join(__dirname, "..", "debug");

// Créer le dossier debug si nécessaire
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Calcule le hash perceptuel d'une image (identique à war-analyzer.js)
 */
async function computePortraitHash(imageBuffer) {
  const hashSize = 8;
  const sampleSize = 32;

  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(sampleSize, sampleSize);
  const ctx = canvas.getContext("2d");

  // Crop: garder seulement les 70% du haut
  const cropTopPercent = 0.70;
  const srcHeight = img.height * cropTopPercent;

  ctx.drawImage(img, 0, 0, img.width, srcHeight, 0, 0, sampleSize, sampleSize);

  const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
  const pixels = imageData.data;

  // Convertir en niveaux de gris
  const gray = new Float32Array(sampleSize * sampleSize);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
  }

  // Redimensionner en hashSize x hashSize
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

  // Calculer le hash binaire basé sur la médiane
  const sorted = [...resized].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let binary = "";
  for (let i = 0; i < resized.length; i++) {
    binary += resized[i] > median ? "1" : "0";
  }

  // Convertir en hexadécimal
  let hex = "";
  for (let i = 0; i < binary.length; i += 4) {
    hex += parseInt(binary.substr(i, 4), 2).toString(16);
  }

  return { hex, binary, canvas };
}

/**
 * Calcule la distance de Hamming entre deux hashes binaires
 */
function hammingDistance(bin1, bin2) {
  let distance = 0;
  for (let i = 0; i < bin1.length; i++) {
    if (bin1[i] !== bin2[i]) distance++;
  }
  return distance;
}

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
 * Similarite Bhattacharyya entre deux histogrammes
 */
function histogramSimilarity(hist1, hist2) {
  let simR = 0, simG = 0, simB = 0;

  for (let i = 0; i < hist1.r.length; i++) {
    simR += Math.sqrt(hist1.r[i] * hist2.r[i]);
    simG += Math.sqrt(hist1.g[i] * hist2.g[i]);
    simB += Math.sqrt(hist1.b[i] * hist2.b[i]);
  }

  return (simR + simG + simB) / 3;
}

/**
 * Affiche le hash en grille 8x8 pour visualisation
 */
function printHashGrid(binary, label) {
  console.log(`\n${label} (grille 8x8):`);
  for (let y = 0; y < 8; y++) {
    let row = "  ";
    for (let x = 0; x < 8; x++) {
      row += binary[y * 8 + x] === "1" ? "█" : "░";
    }
    console.log(row);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: node scripts/debug-compare.js <image1> <image2>");
    console.log("Exemple: node scripts/debug-compare.js cache/portraits/Hellverine.png debug/capture.png");
    process.exit(1);
  }

  const [file1, file2] = args.map(f => path.resolve(f));

  // Vérifier que les fichiers existent
  for (const file of [file1, file2]) {
    if (!fs.existsSync(file)) {
      console.error(`Fichier introuvable: ${file}`);
      process.exit(1);
    }
  }

  console.log("=== Comparaison de deux images ===\n");

  // Charger et analyser les images
  const buf1 = fs.readFileSync(file1);
  const buf2 = fs.readFileSync(file2);

  const img1 = await loadImage(buf1);
  const img2 = await loadImage(buf2);

  console.log(`Image 1: ${path.basename(file1)}`);
  console.log(`  Dimensions: ${img1.width}x${img1.height}`);
  console.log(`  Crop 70%: ${img1.width}x${Math.floor(img1.height * 0.7)}`);

  console.log(`\nImage 2: ${path.basename(file2)}`);
  console.log(`  Dimensions: ${img2.width}x${img2.height}`);
  console.log(`  Crop 70%: ${img2.width}x${Math.floor(img2.height * 0.7)}`);

  // Calculer les hashes
  const result1 = await computePortraitHash(buf1);
  const result2 = await computePortraitHash(buf2);

  console.log("\n=== Hashes calculés ===");
  console.log(`Image 1: ${result1.hex}`);
  console.log(`Image 2: ${result2.hex}`);

  // Calculer la similarité
  const distance = hammingDistance(result1.binary, result2.binary);
  const similarity = ((64 - distance) / 64) * 100;

  console.log("\n=== Comparaison ===");
  console.log(`Distance de Hamming: ${distance}/64 bits différents`);
  console.log(`Similarité: ${similarity.toFixed(1)}%`);

  // Afficher les grilles
  printHashGrid(result1.binary, "Image 1");
  printHashGrid(result2.binary, "Image 2");

  // Afficher la différence
  console.log("\nDifférences (X = bit différent):");
  for (let y = 0; y < 8; y++) {
    let row = "  ";
    for (let x = 0; x < 8; x++) {
      const idx = y * 8 + x;
      row += result1.binary[idx] !== result2.binary[idx] ? "X" : "·";
    }
    console.log(row);
  }

  // Sauvegarder les images croppées 32x32 pour comparaison visuelle
  const crop1Path = path.join(OUTPUT_DIR, "compare_1_cropped.png");
  const crop2Path = path.join(OUTPUT_DIR, "compare_2_cropped.png");

  fs.writeFileSync(crop1Path, result1.canvas.toBuffer("image/png"));
  fs.writeFileSync(crop2Path, result2.canvas.toBuffer("image/png"));

  console.log(`\n=== Fichiers générés ===`);
  console.log(`  ${crop1Path}`);
  console.log(`  ${crop2Path}`);

  // Comparaison par histogramme RGB
  console.log("\n=== Histogramme RGB ===");
  const hist1 = await computeRGBHistogram(buf1);
  const hist2 = await computeRGBHistogram(buf2);
  const histSim = histogramSimilarity(hist1, hist2);
  const histSimPercent = (histSim * 100).toFixed(1);

  console.log(`Similarité RGB: ${histSimPercent}%`);

  // Verdict
  console.log("\n=== Verdict ===");
  console.log(`pHash: ${similarity >= 85 ? "✓" : "✗"} ${similarity.toFixed(1)}% (seuil: 85%)`);
  console.log(`Histogramme: ${histSim >= 0.85 ? "✓" : "✗"} ${histSimPercent}% (seuil: 85%)`);

  if (histSim >= 0.85) {
    console.log("\n✓ MATCH via histogramme RGB");
  } else if (similarity >= 85) {
    console.log("\n✓ MATCH via pHash");
  } else {
    console.log("\n✗ PAS DE MATCH");
  }
}

main().catch(console.error);
