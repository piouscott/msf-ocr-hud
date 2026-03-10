/**
 * Deploiement GitHub Release — extension complete
 * Usage: node scripts/deploy-release.js [--dry-run]
 *
 * 1. Copie l'extension dans releases/build/ (sans fichiers dev/git)
 * 2. Strip le client secret OAuth (seule donnee privee)
 * 3. Scan de securite
 * 4. ZIP + release GitHub
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BUILD_DIR = path.join(ROOT, "releases", "build");
const ZIP_PATH = path.join(ROOT, "releases", "msf-counter.zip");
const DRY_RUN = process.argv.includes("--dry-run");

// Fichiers/dossiers a inclure dans la release
const INCLUDE = [
  "manifest.json",
  "bg.js",
  "content.js",
  "callback.html",
  "msf-zones-config.json",
  "RELEASE-NOTES.html",
  "data",
  "popup",
  "lib",
  "modules"
];

// Fichiers a exclure meme s'ils sont dans un dossier inclus
const EXCLUDE_PATTERNS = [
  /\.git/,
  /node_modules/,
  /releases/,
  /scripts/,
  /docs/,
  /\.claude/,
  /CLAUDE\.md/i,
  /\.md$/,         // Pas de docs markdown dans la release
];

// Patterns sensibles (le client secret est la seule donnee privee)
const FORBIDDEN_PATTERNS = [
  { pattern: /uniki/gi, label: "Chemin utilisateur Windows" },
  { pattern: /Nextcloud/gi, label: "Reference Nextcloud perso" },
  { pattern: /zJ~2rov\.SnpRkGnDWhFUqFM/g, label: "OAuth Client Secret MSF" },
  { pattern: /password\s*[:=]\s*["'][^"']+["']/gi, label: "Mot de passe hardcode" },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, label: "Cle API OpenAI/Anthropic" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, label: "Token GitHub" },
];

const SCAN_IGNORE = [".png", ".jpg", ".gif", ".wasm", ".woff", ".woff2", ".map", ".jar"];

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = path.relative(ROOT, srcPath);

    // Verifier exclusions
    if (EXCLUDE_PATTERNS.some(p => p.test(relPath))) continue;

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function stripSecrets(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "lib") continue;
      count += stripSecrets(full);
    } else if (/\.(js|html)$/i.test(entry.name)) {
      let content = fs.readFileSync(full, "utf-8");
      // Strip uniquement le client secret OAuth
      const original = content;
      content = content.replace(/zJ~2rov\.SnpRkGnDWhFUqFM-u0/g, "YOUR_CLIENT_SECRET");
      if (content !== original) {
        fs.writeFileSync(full, content);
        console.log(`  Strip: ${path.relative(BUILD_DIR, full)}`);
        count++;
      }
    }
  }
  return count;
}

function scanForSensitiveData(dir) {
  const issues = [];

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "lib") continue;
        walk(fullPath);
      } else {
        if (SCAN_IGNORE.includes(path.extname(entry.name).toLowerCase())) continue;
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const relPath = path.relative(BUILD_DIR, fullPath);
          for (const { pattern, label } of FORBIDDEN_PATTERNS) {
            pattern.lastIndex = 0;
            const match = pattern.exec(content);
            if (match) {
              issues.push({ file: relPath, label, match: match[0].substring(0, 40) });
            }
          }
        } catch (e) { /* binaire */ }
      }
    }
  }

  walk(dir);
  return issues;
}

function main() {
  console.log("=== MSF Counter - Deploy Release ===\n");

  // 1. Lire la version
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf-8"));
  const version = manifest.version;
  console.log(`Version: ${version}\n`);

  // 2. Build : copier les fichiers
  console.log("1. Preparation du build...");
  if (fs.existsSync(BUILD_DIR)) fs.rmSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  for (const item of INCLUDE) {
    const src = path.join(ROOT, item);
    const dest = path.join(BUILD_DIR, item);
    if (!fs.existsSync(src)) {
      console.warn(`   ATTENTION: ${item} introuvable`);
      continue;
    }
    if (fs.statSync(src).isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
    console.log(`   + ${item}`);
  }

  // 3. Strip le client secret
  console.log("\n2. Nettoyage credentials...");
  const stripped = stripSecrets(BUILD_DIR);
  if (stripped === 0) console.log("   Rien a nettoyer.");

  // 4. Scan securite
  console.log("\n3. Scan securite...");
  const issues = scanForSensitiveData(BUILD_DIR);

  if (issues.length > 0) {
    console.error("\n   PROBLEMES DETECTES:");
    issues.forEach(i => console.error(`   - [${i.label}] ${i.file}: "${i.match}"`));
    process.exit(1);
  }
  console.log("   OK — aucun probleme.");

  // 5. ZIP
  console.log("\n4. Creation ZIP...");
  if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

  try {
    if (process.platform === "win32") {
      execSync(`powershell -Command "Compress-Archive -Path '${BUILD_DIR}\\*' -DestinationPath '${ZIP_PATH}' -Force"`, { stdio: "inherit" });
    } else {
      execSync(`cd "${BUILD_DIR}" && zip -r "${ZIP_PATH}" .`, { stdio: "inherit" });
    }
    const zipSize = (fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(2);
    console.log(`   msf-counter.zip (${zipSize} MB)`);
  } catch (e) {
    console.error("Erreur ZIP:", e.message);
    process.exit(1);
  }

  // 6. Release GitHub
  let tagExists = false;
  try {
    tagExists = execSync(`git tag -l "v${version}"`, { cwd: ROOT }).toString().trim().length > 0;
  } catch (e) { /* ignore */ }
  const tag = tagExists ? `v${version}.${Math.floor(Date.now() / 1000)}` : `v${version}`;

  if (DRY_RUN) {
    console.log(`\n   --dry-run: tag=${tag}, pas de deploiement.`);
    return;
  }

  console.log(`\n5. Release GitHub (tag: ${tag})...`);

  const releaseBody = `## MSF Counter v${version}

Browser extension for **Marvel Strike Force** — counters, events, raids, defense, farming, alliance, Crucible meta and more.

Extension navigateur pour **Marvel Strike Force** — counters, events, raids, defense, farming, alliance, meta Crucible et plus.

---

### Installation

#### Chrome / Vivaldi / Edge
1. Download \`msf-counter.zip\` below
2. Extract the ZIP into a folder
3. Go to \`chrome://extensions/\` (or \`vivaldi://extensions/\`)
4. Enable **Developer mode** (top-right toggle)
5. Click **"Load unpacked"** and select the folder
6. Click the MSF Counter icon in your toolbar!

#### Firefox
1. Download \`msf-counter.zip\` below
2. Extract the ZIP into a folder
3. Go to \`about:debugging#/runtime/this-firefox\`
4. Click **"Load Temporary Add-on..."**
5. Select \`manifest.json\` in the extracted folder

---

### Installation (Francais)

#### Chrome / Vivaldi / Edge
1. Telecharger \`msf-counter.zip\` ci-dessous
2. Extraire le ZIP dans un dossier
3. Aller sur \`chrome://extensions/\` (ou \`vivaldi://extensions/\`)
4. Activer le **Mode developpeur** (bouton en haut a droite)
5. Cliquer **"Charger l'extension non empaquetee"** et selectionner le dossier
6. Cliquer sur l'icone MSF Counter dans la barre d'outils !

#### Firefox
1. Telecharger \`msf-counter.zip\` ci-dessous
2. Extraire le ZIP dans un dossier
3. Aller sur \`about:debugging#/runtime/this-firefox\`
4. Cliquer **"Charger un module temporaire..."**
5. Selectionner \`manifest.json\` dans le dossier extrait

---

### API Connection / Connexion API

1. Click **API** button in the extension / Cliquer le bouton **API**
2. Click **"Connexion OAuth MSF"**
3. Log in with Scopely / Se connecter avec Scopely
4. **Check ALL permissions** / **Cocher TOUTES les permissions** :
   - Voir le profil, Voir l'effectif, Voir l'inventaire, Voir l'activite, Voir le profil d'alliance, Acces persistant
5. Click **"Autoriser"** — done! / C'est fait !

> Full documentation: [README](https://github.com/piouscott/msf-ocr-hud#readme)
`;

  try {
    // Write body to temp file to avoid shell escaping issues
    const bodyPath = path.join(ROOT, "releases", ".release-body.md");
    fs.writeFileSync(bodyPath, releaseBody);
    const cmd = `gh release create "${tag}" "${ZIP_PATH}" --title "MSF Counter ${version}" --notes-file "${bodyPath}"`;
    execSync(cmd, { cwd: ROOT, stdio: "inherit" });
    fs.unlinkSync(bodyPath);
    console.log(`\n✓ https://github.com/piouscott/msf-ocr-hud/releases/tag/${tag}`);
  } catch (e) {
    console.error("Erreur release:", e.message);
    process.exit(1);
  }
}

main();
