/**
 * Script pour generer la version Tester de l'extension
 * Usage: node scripts/build-tester.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(ROOT, "releases", "tester");

// Fichiers et dossiers a copier
const FILES_TO_COPY = [
  "manifest.json",
  "bg.js",
  "content.js",
  "msf-zones-config.json"
];

const DIRS_TO_COPY = [
  "data",
  "lib",
  "modules",
  "popup"
];

// CSS a injecter dans popup.html pour le mode tester
const TESTER_CSS = `
  <style>
    /* Mode Tester: cacher les fonctionnalites en developpement */
    #actions { display: none !important; }
    #btn-detach { display: none !important; }
    #btn-export { display: none !important; }
    #btn-import { display: none !important; }
    #btn-settings { display: none !important; }
    #btn-api { display: none !important; }
    #import-file { display: none !important; }
    #status { display: none !important; }
    #results { display: none !important; }

    /* Centrer le bouton Counters */
    #tools {
      display: flex;
      justify-content: center;
      padding: 20px;
    }
    #btn-manage {
      font-size: 16px;
      padding: 12px 32px;
    }
  </style>
`;

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  console.log("Generation de la version Tester...\n");

  // Creer le dossier de sortie
  if (fs.existsSync(OUTPUT)) {
    fs.rmSync(OUTPUT, { recursive: true });
  }
  fs.mkdirSync(OUTPUT, { recursive: true });

  // Copier les fichiers
  for (const file of FILES_TO_COPY) {
    const src = path.join(ROOT, file);
    const dest = path.join(OUTPUT, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`  Copie: ${file}`);
    } else {
      console.warn(`  ATTENTION: ${file} introuvable`);
    }
  }

  // Copier les dossiers
  for (const dir of DIRS_TO_COPY) {
    const src = path.join(ROOT, dir);
    const dest = path.join(OUTPUT, dir);
    if (fs.existsSync(src)) {
      copyDir(src, dest);
      console.log(`  Copie: ${dir}/`);
    } else {
      console.warn(`  ATTENTION: ${dir}/ introuvable`);
    }
  }

  // Modifier popup.html pour le mode tester
  const popupHtmlPath = path.join(OUTPUT, "popup", "popup.html");
  if (fs.existsSync(popupHtmlPath)) {
    let html = fs.readFileSync(popupHtmlPath, "utf-8");

    // Ajouter le label "Version Tester" et le CSS
    html = html.replace(
      "<h1>MSF Counter</h1>",
      `<h1>MSF Counter</h1>\n      <p style="font-size: 11px; color: #888; margin-top: 4px;">Version Tester</p>`
    );

    // Injecter le CSS juste avant </head>
    html = html.replace("</head>", TESTER_CSS + "</head>");

    fs.writeFileSync(popupHtmlPath, html);
    console.log("  Modifie: popup/popup.html (mode tester)");
  }

  console.log("\n✓ Version Tester generee dans: releases/tester/");

  // Creer le ZIP
  const zipPath = path.join(ROOT, "releases", "msf-counter-tester.zip");
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  try {
    // Detecter l'OS et utiliser la bonne commande
    const isWindows = process.platform === "win32";

    if (isWindows) {
      // Windows: PowerShell
      const cmd = `powershell -Command "Compress-Archive -Path '${OUTPUT}\\*' -DestinationPath '${zipPath}' -Force"`;
      execSync(cmd, { stdio: "inherit" });
    } else {
      // Linux/Mac: zip
      execSync(`cd "${OUTPUT}" && zip -r "${zipPath}" .`, { stdio: "inherit" });
    }
    console.log(`\n✓ ZIP cree: releases/msf-counter-tester.zip`);
  } catch (e) {
    console.error("\nErreur creation ZIP:", e.message);
    console.log("Vous pouvez creer le ZIP manuellement depuis releases/tester/");
  }
}

main();
