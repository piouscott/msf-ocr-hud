/**
 * Script pour generer la version Tester de l'extension
 * Usage: node scripts/build-tester.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(ROOT, "releases", "tester");

// Fichiers et dossiers a copier (version tester = fonctionnalites stables + OCR/Scan Salle)
const FILES_TO_COPY = [
  "manifest.json",
  "bg.js",
  "content.js",
  "msf-zones-config.json",
  "RELEASE-NOTES.html"
];

const DIRS_TO_COPY = [
  "data",
  "popup",
  "lib",
  "modules"
];

// CSS a injecter dans popup.html pour le mode tester
const TESTER_CSS = `
  <style>
    /* Mode Tester: cacher les fonctionnalites encore en developpement */
    #actions { display: none !important; }
    #btn-export { display: none !important; }
    #btn-import { display: none !important; }
    #btn-settings { display: none !important; }
    #import-file { display: none !important; }

    /* Barre de navigation : 2 lignes de 4 boutons */
    #tools {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
      padding: 8px 4px;
    }
    #tools .btn-small {
      padding: 8px 2px 5px 2px;
      min-width: 0;
    }
    #tools .btn-small span {
      font-size: 9px;
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

  // manifest.json est copie tel quel (toutes les permissions et refs sont necessaires)

  // Retirer toutes les credentials MSF du build tester
  // Le user configurera ses propres cles via le panneau API de l'extension
  // Seul le client secret OAuth est prive — l'API key et le client ID sont publics MSF
  const CREDENTIALS_TO_STRIP = [
    { find: /zJ~2rov\.SnpRkGnDWhFUqFM-u0/g, replace: "" },
  ];

  function stripCredentials(filePath) {
    if (!fs.existsSync(filePath)) return false;
    let content = fs.readFileSync(filePath, "utf-8");
    let changed = false;
    for (const { find, replace } of CREDENTIALS_TO_STRIP) {
      if (find.test(content)) {
        content = content.replace(find, replace);
        changed = true;
      }
      find.lastIndex = 0;
    }
    if (changed) {
      fs.writeFileSync(filePath, content);
      return true;
    }
    return false;
  }

  // Nettoyer tous les fichiers JS/HTML du build
  function stripDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "lib") continue; // Skip libs tierces
        stripDir(full);
      } else if (/\.(js|html|json)$/i.test(entry.name)) {
        if (stripCredentials(full)) {
          console.log(`  Nettoyage: ${path.relative(OUTPUT, full)} (credentials retirees)`);
        }
      }
    }
  }

  stripDir(OUTPUT);

  // Modifier popup.html pour le mode tester (label + CSS pour cacher les boutons non inclus)
  const popupHtmlPath = path.join(OUTPUT, "popup", "popup.html");
  if (fs.existsSync(popupHtmlPath)) {
    let html = fs.readFileSync(popupHtmlPath, "utf-8");

    // Ajouter le label "Version Tester"
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
