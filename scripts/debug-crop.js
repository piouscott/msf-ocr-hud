#!/usr/bin/env node
/**
 * Script de debug pour visualiser le crop de 70%
 * Prend un portrait en cache et génère 2 images:
 * - original.png : l'image complète
 * - cropped.png : les 70% du haut (ce qui est utilisé pour le hash)
 *
 * Usage: node scripts/debug-crop.js [charId]
 * Exemple: node scripts/debug-crop.js Hellverine
 */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const CACHE_DIR = path.join(__dirname, "..", "cache", "portraits");
const OUTPUT_DIR = path.join(__dirname, "..", "debug");

// Créer le dossier debug si nécessaire
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function debugCrop(charId) {
  const cacheFile = path.join(CACHE_DIR, `${charId}.png`);

  if (!fs.existsSync(cacheFile)) {
    console.error(`Portrait non trouvé: ${cacheFile}`);
    console.log("\nPortraits disponibles:");
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith(".png")).slice(0, 20);
    files.forEach(f => console.log("  -", f.replace(".png", "")));
    if (fs.readdirSync(CACHE_DIR).length > 20) {
      console.log("  ... et plus");
    }
    return;
  }

  const imageBuffer = fs.readFileSync(cacheFile);
  const img = await loadImage(imageBuffer);

  console.log(`\nImage originale: ${img.width}x${img.height} pixels`);

  // 1. Sauvegarder l'original
  const canvasOriginal = createCanvas(img.width, img.height);
  const ctxOriginal = canvasOriginal.getContext("2d");
  ctxOriginal.drawImage(img, 0, 0);

  // Dessiner une ligne rouge à 70%
  const cropLine = Math.floor(img.height * 0.70);
  ctxOriginal.strokeStyle = "#ff0000";
  ctxOriginal.lineWidth = 2;
  ctxOriginal.beginPath();
  ctxOriginal.moveTo(0, cropLine);
  ctxOriginal.lineTo(img.width, cropLine);
  ctxOriginal.stroke();

  // Ajouter une zone semi-transparente sur la partie ignorée
  ctxOriginal.fillStyle = "rgba(255, 0, 0, 0.3)";
  ctxOriginal.fillRect(0, cropLine, img.width, img.height - cropLine);

  const originalPath = path.join(OUTPUT_DIR, `${charId}_original.png`);
  fs.writeFileSync(originalPath, canvasOriginal.toBuffer("image/png"));
  console.log(`Original avec ligne de crop: ${originalPath}`);

  // 2. Sauvegarder la version croppée (70% du haut, redimensionnée en 32x32)
  const sampleSize = 32;
  const cropTopPercent = 0.70;
  const srcHeight = img.height * cropTopPercent;

  const canvasCropped = createCanvas(sampleSize, sampleSize);
  const ctxCropped = canvasCropped.getContext("2d");
  ctxCropped.drawImage(img, 0, 0, img.width, srcHeight, 0, 0, sampleSize, sampleSize);

  const croppedPath = path.join(OUTPUT_DIR, `${charId}_cropped_32x32.png`);
  fs.writeFileSync(croppedPath, canvasCropped.toBuffer("image/png"));
  console.log(`Croppé 70% redimensionné 32x32: ${croppedPath}`);

  // 3. Sauvegarder une version croppée taille réelle
  const canvasCroppedFull = createCanvas(img.width, Math.floor(srcHeight));
  const ctxCroppedFull = canvasCroppedFull.getContext("2d");
  ctxCroppedFull.drawImage(img, 0, 0, img.width, srcHeight, 0, 0, img.width, Math.floor(srcHeight));

  const croppedFullPath = path.join(OUTPUT_DIR, `${charId}_cropped_full.png`);
  fs.writeFileSync(croppedFullPath, canvasCroppedFull.toBuffer("image/png"));
  console.log(`Croppé 70% taille réelle: ${croppedFullPath}`);

  console.log(`\n=== Résumé ===`);
  console.log(`  Hauteur originale: ${img.height}px`);
  console.log(`  Ligne de crop (70%): ${cropLine}px`);
  console.log(`  Hauteur croppée: ${Math.floor(srcHeight)}px`);
  console.log(`  Zone ignorée (bas): ${img.height - cropLine}px (${Math.round((1 - cropTopPercent) * 100)}%)`);
  console.log(`\nFichiers générés dans: ${OUTPUT_DIR}`);
}

// Récupérer le charId depuis les arguments
const charId = process.argv[2] || "Hellverine";
debugCrop(charId).catch(console.error);
