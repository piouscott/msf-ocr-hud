#!/usr/bin/env node
/**
 * Script de debug pour tester différents pourcentages de crop
 * et trouver la meilleure correspondance entre API et in-game
 *
 * Usage: node scripts/debug-crop-test.js <api-image> <ingame-image>
 */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const OUTPUT_DIR = path.join(__dirname, "..", "debug");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Calcule le hash avec un crop configurable
 */
async function computeHashWithCrop(imageBuffer, cropTop, cropBottom) {
  const hashSize = 8;
  const sampleSize = 32;

  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(sampleSize, sampleSize);
  const ctx = canvas.getContext("2d");

  // Crop: garder seulement la zone entre cropTop et cropBottom
  const srcY = img.height * cropTop;
  const srcHeight = img.height * (cropBottom - cropTop);

  ctx.drawImage(img, 0, srcY, img.width, srcHeight, 0, 0, sampleSize, sampleSize);

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

  // Calculer le hash binaire
  const sorted = [...resized].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let binary = "";
  for (let i = 0; i < resized.length; i++) {
    binary += resized[i] > median ? "1" : "0";
  }

  return { binary, canvas };
}

function hammingDistance(bin1, bin2) {
  let distance = 0;
  for (let i = 0; i < bin1.length; i++) {
    if (bin1[i] !== bin2[i]) distance++;
  }
  return distance;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: node scripts/debug-crop-test.js <api-image> <ingame-image>");
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

  const img1 = await loadImage(buf1);
  const img2 = await loadImage(buf2);

  console.log("=== Test de différents crops ===\n");
  console.log(`Image API: ${path.basename(file1)} (${img1.width}x${img1.height})`);
  console.log(`Image in-game: ${path.basename(file2)} (${img2.width}x${img2.height})`);

  // Test différentes configurations de crop
  const cropConfigs = [
    // Crop identique pour les deux (baseline)
    { api: [0, 0.70], ingame: [0, 0.70], label: "70% top (actuel)" },
    { api: [0, 0.50], ingame: [0, 0.50], label: "50% top" },
    { api: [0, 0.40], ingame: [0, 0.40], label: "40% top" },
    { api: [0, 0.60], ingame: [0, 0.60], label: "60% top" },
    // Crop différent pour chaque image
    { api: [0, 0.50], ingame: [0, 0.70], label: "API 50%, ingame 70%" },
    { api: [0, 0.40], ingame: [0, 0.60], label: "API 40%, ingame 60%" },
    { api: [0, 0.35], ingame: [0, 0.50], label: "API 35%, ingame 50%" },
    // Essayer de sauter le haut aussi
    { api: [0.05, 0.55], ingame: [0.05, 0.65], label: "Skip 5% top, API 55%, ingame 65%" },
    { api: [0.10, 0.60], ingame: [0.10, 0.70], label: "Skip 10% top" },
    // Focus sur le visage uniquement
    { api: [0, 0.30], ingame: [0, 0.35], label: "Visage seul (30-35%)" },
  ];

  console.log("\n┌──────────────────────────────────────────┬───────────┬──────────┐");
  console.log("│ Configuration                            │ Distance  │ Similarité│");
  console.log("├──────────────────────────────────────────┼───────────┼──────────┤");

  let bestConfig = null;
  let bestSimilarity = 0;

  for (const config of cropConfigs) {
    const hash1 = await computeHashWithCrop(buf1, config.api[0], config.api[1]);
    const hash2 = await computeHashWithCrop(buf2, config.ingame[0], config.ingame[1]);

    const distance = hammingDistance(hash1.binary, hash2.binary);
    const similarity = ((64 - distance) / 64) * 100;

    const label = config.label.padEnd(40);
    const distStr = `${distance}/64`.padStart(9);
    const simStr = `${similarity.toFixed(1)}%`.padStart(8);

    const mark = similarity >= 85 ? " ✓" : similarity >= 75 ? " ~" : "";
    console.log(`│ ${label} │ ${distStr} │ ${simStr}${mark} │`);

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestConfig = { ...config, hash1, hash2, distance };
    }
  }

  console.log("└──────────────────────────────────────────┴───────────┴──────────┘");

  console.log(`\n=== Meilleur résultat ===`);
  console.log(`Configuration: ${bestConfig.label}`);
  console.log(`Similarité: ${bestSimilarity.toFixed(1)}%`);
  console.log(`Distance: ${bestConfig.distance}/64`);

  // Sauvegarder les images de la meilleure config
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "best_api_crop.png"),
    bestConfig.hash1.canvas.toBuffer("image/png")
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "best_ingame_crop.png"),
    bestConfig.hash2.canvas.toBuffer("image/png")
  );

  console.log(`\nImages sauvegardées dans debug/`);

  if (bestSimilarity < 75) {
    console.log("\n⚠ Aucune configuration ne donne une bonne correspondance.");
    console.log("Le problème est probablement un cadrage fondamentalement différent.");
  }
}

main().catch(console.error);
