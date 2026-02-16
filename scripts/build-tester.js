/**
 * Script pour generer la version Tester de l'extension
 * Usage: node scripts/build-tester.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(ROOT, "releases", "tester");

// Fichiers et dossiers a copier (version tester = fonctionnalites stables uniquement)
// PAS de: lib/tesseract, modules OCR (zone-cropper, ocr-engine, phash, war-analyzer)
// On garde: inverse-counters.js (necessaire pour Defense panel)
const FILES_TO_COPY = [
  "manifest.json",
  "bg.js",
  "content.js",
  "msf-zones-config.json",
  "RELEASE-NOTES.html"
];

// Modules a copier dans popup/ pour le tester (evite les chemins relatifs ../)
const MODULES_TO_INLINE = [
  "modules/inverse-counters.js"
];

const DIRS_TO_COPY = [
  "data",
  "popup"
];

// CSS a injecter dans popup.html pour le mode tester
const TESTER_CSS = `
  <style>
    /* Mode Tester: cacher les fonctionnalites en developpement */
    #actions { display: none !important; }
    #btn-war-ocr { display: none !important; }
    #btn-export-learned-global { display: none !important; }
    #btn-import-learned-global { display: none !important; }
    #btn-export { display: none !important; }
    #btn-import { display: none !important; }
    #btn-settings { display: none !important; }
    #import-file { display: none !important; }
    #status { display: none !important; }
    #results { display: none !important; }

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

  // Copier les modules directement dans popup/ (evite les chemins ../)
  for (const mod of MODULES_TO_INLINE) {
    const src = path.join(ROOT, mod);
    const filename = path.basename(mod);
    const dest = path.join(OUTPUT, "popup", filename);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`  Copie: ${mod} -> popup/${filename}`);
    } else {
      console.warn(`  ATTENTION: ${mod} introuvable`);
    }
  }

  // Modifier manifest.json pour retirer les refs à lib/tesseract et modules OCR (non inclus dans le tester)
  const manifestPath = path.join(OUTPUT, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    // MV3 Chrome/Vivaldi : retirer background.scripts (Firefox only), garder service_worker
    if (manifest.background && manifest.background.scripts) {
      delete manifest.background.scripts;
    }

    // Retirer lib/tesseract/tesseract.min.js des content_scripts
    if (manifest.content_scripts) {
      manifest.content_scripts.forEach(cs => {
        if (cs.js) {
          cs.js = cs.js.filter(f => !f.includes("lib/tesseract"));
        }
      });
    }

    // Retirer lib/tesseract/* et modules/* des web_accessible_resources
    if (manifest.web_accessible_resources) {
      manifest.web_accessible_resources.forEach(war => {
        if (war.resources) {
          war.resources = war.resources.filter(r =>
            !r.includes("lib/tesseract") && !r.includes("modules/")
          );
        }
      });
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log("  Modifie: manifest.json (MV3 clean + retire tesseract/modules OCR)");
  }

  // Modifier popup.html pour le mode tester
  const popupHtmlPath = path.join(OUTPUT, "popup", "popup.html");
  if (fs.existsSync(popupHtmlPath)) {
    let html = fs.readFileSync(popupHtmlPath, "utf-8");

    // Retirer TOUS les scripts ../modules/* et ../lib/*
    html = html.replace(/\s*<script src="\.\.\/(?:lib|modules)\/[^"]+"><\/script>/g, '');
    console.log("  Modifie: popup/popup.html (retire scripts externes)");

    // Ajouter les modules inlines juste avant popup.js
    const inlineScripts = MODULES_TO_INLINE.map(m => {
      const filename = path.basename(m);
      return `  <script src="${filename}"></script>`;
    }).join('\n');
    html = html.replace(
      '<script src="popup.js"></script>',
      inlineScripts + '\n  <script src="popup.js"></script>'
    );
    console.log("  Modifie: popup/popup.html (ajout scripts locaux)");

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
