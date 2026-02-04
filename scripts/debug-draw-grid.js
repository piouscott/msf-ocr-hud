#!/usr/bin/env node
/**
 * Script de debug qui dessine les rectangles d'extraction sur la capture
 * pour visualiser les positions des portraits
 */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const DEBUG_DIR = path.join(__dirname, "..", "debug");

/**
 * Même fonction de positions que extract-test-portraits.js
 */
function getPortraitPositions(screenWidth, screenHeight) {
  const teams = [];

  const baseTeamX = [365, 650, 885, 1170];
  const teamWidth = 280;
  const portraitSize = 42;
  const row1Y = 218;
  const row2Y = 270;
  const row1Offsets = [115, 195];
  const row2Offsets = [55, 125, 195];

  const scaleX = screenWidth / 1920;
  const scaleY = screenHeight / 1032;

  for (let t = 0; t < 4; t++) {
    const team = [];
    const teamX = baseTeamX[t] * scaleX;
    const y1 = row1Y * scaleY;
    const y2 = row2Y * scaleY;
    const ps = portraitSize * Math.min(scaleX, scaleY);

    for (const offset of row1Offsets) {
      team.push({ x: teamX + offset * scaleX, y: y1, w: ps, h: ps });
    }
    for (const offset of row2Offsets) {
      team.push({ x: teamX + offset * scaleX, y: y2, w: ps, h: ps });
    }
    teams.push(team);
  }
  return teams;
}

async function main() {
  const screenshotPath = path.join(DEBUG_DIR, "war-screen (11).png");

  if (!fs.existsSync(screenshotPath)) {
    console.error("Screenshot non trouvé:", screenshotPath);
    process.exit(1);
  }

  const img = await loadImage(screenshotPath);
  console.log(`Image: ${img.width}x${img.height}`);

  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");

  // Dessiner l'image originale
  ctx.drawImage(img, 0, 0);

  // Obtenir les positions des portraits
  const teams = getPortraitPositions(img.width, img.height);

  // Couleurs pour chaque équipe
  const colors = ["#00ff00", "#ff0000", "#0000ff", "#ffff00"];

  // Dessiner les rectangles
  for (let t = 0; t < teams.length; t++) {
    ctx.strokeStyle = colors[t];
    ctx.lineWidth = 2;

    for (let p = 0; p < teams[t].length; p++) {
      const pos = teams[t][p];
      ctx.strokeRect(pos.x, pos.y, pos.w, pos.h);

      // Numéro du portrait
      ctx.fillStyle = colors[t];
      ctx.font = "bold 14px Arial";
      ctx.fillText(`${t+1}.${p+1}`, pos.x + 2, pos.y + 14);
    }
  }

  // Sauvegarder
  const outputPath = path.join(DEBUG_DIR, "grid-debug.png");
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  console.log("Debug image saved:", outputPath);
}

main().catch(console.error);
