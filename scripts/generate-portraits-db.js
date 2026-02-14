#!/usr/bin/env node
/**
 * Script pour générer la base de données des portraits MSF
 * Télécharge les images depuis l'API et calcule les hashes pHash + histogrammes RGB
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
 * Calcule le hash perceptuel d'une image
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

  return hex;
}

/**
 * Calcule le hash perceptuel SANS crop (pour matcher les petites images scan salle)
 * Le runtime ne croppe pas les petites images, donc la DB doit avoir un hash comparable
 */
async function computePortraitHashNoCrop(imageBuffer) {
  const hashSize = 8;
  const sampleSize = 32;

  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(sampleSize, sampleSize);
  const ctx = canvas.getContext("2d");

  // Pas de crop: image complete (comme le runtime pour les petites images)
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, sampleSize, sampleSize);

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
 * Plus discriminant que RGB pour les personnages avec des couleurs distinctives
 * 36 bins (10° chacun) pour capturer les nuances de teinte
 */
async function computeHueHistogram(imageBuffer) {
  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");

  // Crop 70% haut pour les grandes images (comme le runtime pour grandes images)
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
      hist[i] = Math.round((hist[i] / totalWeight) * 10000) / 10000;
    }
  }

  return hist;
}

/**
 * Calcule l'histogramme Hue avec masque circulaire centre
 * Pour matcher les portraits captures dans la vue salle War
 * Meme traitement que le runtime war-analyzer.js pour les petites images
 */
async function computeHueHistogramCircular(imageBuffer) {
  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");

  // Pas de crop vertical (comme le runtime pour petites images)
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 64, 64);

  const imageData = ctx.getImageData(0, 0, 64, 64);
  const pixels = imageData.data;

  const hueBins = 36;
  const hist = new Array(hueBins).fill(0);
  let totalWeight = 0;

  // Masque circulaire centre (memes params que war-analyzer.js)
  const cx = 32, cy = 26;
  const maxRadius = 22;

  for (let i = 0; i < pixels.length; i += 4) {
    const pixIdx = i / 4;
    const px = pixIdx % 64;
    const py = Math.floor(pixIdx / 64);
    const dx = px - cx, dy = py - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxRadius) continue;

    const { h, s, v } = rgbToHsv(pixels[i], pixels[i + 1], pixels[i + 2]);

    if (s > 0.15 && v > 0.15) {
      const hueIdx = Math.min(Math.floor(h / 10), hueBins - 1);
      const weight = s * v;
      hist[hueIdx] += weight;
      totalWeight += weight;
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < hueBins; i++) {
      hist[i] = Math.round((hist[i] / totalWeight) * 10000) / 10000;
    }
  }

  return hist;
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
  const hashIndex = {}; // Index par hash pour lookup rapide
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

    // Calculer le hash et les histogrammes Hue (standard + circulaire)
    try {
      const hash = await computePortraitHash(imageBuffer);
      const hashNC = await computePortraitHashNoCrop(imageBuffer);
      const hueHist = await computeHueHistogram(imageBuffer);
      const hueCircular = await computeHueHistogramCircular(imageBuffer);

      portraits[charId] = {
        name: name,
        hash: hash,
        hashNoCrop: hashNC,
        hue: hueHist,
        hueCircular: hueCircular
      };

      // Index par hash pour lookup rapide
      hashIndex[hash] = charId;

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
    description: "Hash perceptuels et histogrammes Hue des portraits MSF",
    version: 4,
    generatedAt: new Date().toISOString(),
    count: Object.keys(portraits).length,
    portraits: portraits,
    hashIndex: hashIndex
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log("\n=== Résumé ===");
  console.log(`  Succès: ${success}`);
  console.log(`  Depuis cache: ${cached}`);
  console.log(`  Échecs: ${failed}`);
  console.log(`\nFichier généré: ${OUTPUT_FILE}`);
}

main().catch(console.error);
