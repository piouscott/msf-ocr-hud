#!/usr/bin/env node
/**
 * Script pour générer la base de données des portraits MSF
 * Télécharge les images depuis l'API et calcule les hashes pHash
 *
 * Usage: node scripts/generate-portraits-db.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

// Chemins
const DATA_DIR = path.join(__dirname, "..", "data");
const CHARACTERS_FILE = path.join(DATA_DIR, "characters-full.json");
const OUTPUT_FILE = path.join(DATA_DIR, "portraits.json");
const CACHE_DIR = path.join(__dirname, "..", "cache", "portraits");

// Créer le dossier cache si nécessaire
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Télécharge une image depuis une URL
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Suivre la redirection
        return downloadImage(response.headers.location).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Calcule le hash perceptuel d'une image (identique à war-analyzer.js)
 */
async function computePortraitHash(imageBuffer) {
  const hashSize = 8;
  const sampleSize = 32;

  // Charger l'image avec canvas
  const img = await loadImage(imageBuffer);

  // Créer un canvas de sampleSize x sampleSize
  const canvas = createCanvas(sampleSize, sampleSize);
  const ctx = canvas.getContext("2d");

  // Crop central de 60% pour matcher le traitement in-game
  const cropRatio = 0.6;
  const srcSize = Math.min(img.width, img.height);
  const cropSize = srcSize * cropRatio;
  const offsetX = (img.width - cropSize) / 2;
  const offsetY = (img.height - cropSize) / 2;

  ctx.drawImage(img, offsetX, offsetY, cropSize, cropSize, 0, 0, sampleSize, sampleSize);

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

  return hex;
}

/**
 * Programme principal
 */
async function main() {
  console.log("=== Génération de la base de portraits MSF ===\n");

  // Charger les données des personnages
  if (!fs.existsSync(CHARACTERS_FILE)) {
    console.error(`Erreur: ${CHARACTERS_FILE} introuvable`);
    console.error("Lancez d'abord: node scripts/fetch-msf-data.js");
    process.exit(1);
  }

  const fileData = JSON.parse(fs.readFileSync(CHARACTERS_FILE, "utf8"));
  const charactersData = fileData.characters || fileData;
  const characters = Object.entries(charactersData);

  console.log(`${characters.length} personnages trouvés\n`);

  const portraits = {};
  let success = 0;
  let failed = 0;
  let cached = 0;

  for (const [charId, data] of characters) {
    const name = data.name;
    const portraitUrl = data.portrait;

    if (!portraitUrl) {
      console.log(`  [SKIP] ${name} - pas d'URL portrait`);
      failed++;
      continue;
    }

    // Vérifier le cache
    const cacheFile = path.join(CACHE_DIR, `${charId}.png`);
    let imageBuffer;

    if (fs.existsSync(cacheFile)) {
      imageBuffer = fs.readFileSync(cacheFile);
      cached++;
    } else {
      // Télécharger l'image
      try {
        process.stdout.write(`  Téléchargement ${name}...`);
        imageBuffer = await downloadImage(portraitUrl);

        // Sauvegarder en cache
        fs.writeFileSync(cacheFile, imageBuffer);
        console.log(" OK");
      } catch (e) {
        console.log(` ERREUR: ${e.message}`);
        failed++;
        continue;
      }
    }

    // Calculer le hash
    try {
      const hash = await computePortraitHash(imageBuffer);

      portraits[hash] = {
        name: name,
        charId: charId
      };

      success++;

      if (cached > 0 && success % 50 === 0) {
        console.log(`  Progression: ${success}/${characters.length}`);
      }
    } catch (e) {
      console.log(`  [ERREUR] ${name}: ${e.message}`);
      failed++;
    }
  }

  // Sauvegarder le fichier
  const output = {
    description: "Hash perceptuels des portraits de personnages MSF",
    version: 2,
    generatedAt: new Date().toISOString(),
    count: Object.keys(portraits).length,
    portraits: portraits
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log("\n=== Résumé ===");
  console.log(`  Succès: ${success}`);
  console.log(`  Depuis cache: ${cached}`);
  console.log(`  Échecs: ${failed}`);
  console.log(`\nFichier généré: ${OUTPUT_FILE}`);
}

main().catch(console.error);
