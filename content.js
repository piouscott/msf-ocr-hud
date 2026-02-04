console.log("[MSF] content.js charge");

const ext = typeof browser !== "undefined" ? browser : chrome;

// ============================================
// ZoneCropper - Decoupe les zones d'une image
// ============================================

class ZoneCropper {
  constructor(config) {
    this.slots = config.slots;
  }

  static async loadConfig(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Impossible de charger la config: ${response.status}`);
    }
    const config = await response.json();
    return new ZoneCropper(config);
  }

  cropZone(img, zone) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const px = Math.floor(zone.x * img.naturalWidth);
    const py = Math.floor(zone.y * img.naturalHeight);
    const pw = Math.floor(zone.w * img.naturalWidth);
    const ph = Math.floor(zone.h * img.naturalHeight);

    canvas.width = pw;
    canvas.height = ph;

    ctx.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);

    return canvas.toDataURL("image/png");
  }

  extractSlot(img, slotNumber) {
    const slot = this.slots.find(s => s.slotNumber === slotNumber);
    if (!slot) {
      throw new Error(`Slot ${slotNumber} non trouve dans la config`);
    }

    const zones = slot.zones;

    // Fonction helper pour cropper si la zone existe
    const safeCrop = (zone) => {
      if (zone && zone.x !== undefined) {
        return this.cropZone(img, zone);
      }
      return null;
    };

    return {
      slotNumber,
      team_power: safeCrop(zones.team_power),
      team_full: safeCrop(zones.team_full),
      portraits: [
        safeCrop(zones.portrait_1),
        safeCrop(zones.portrait_2),
        safeCrop(zones.portrait_3),
        safeCrop(zones.portrait_4),
        safeCrop(zones.portrait_5)
      ].filter(p => p !== null)
    };
  }

  extractAllSlots(img) {
    return this.slots.map(slot => this.extractSlot(img, slot.slotNumber));
  }
}

// ============================================
// OCREngine - Wrapper Tesseract.js
// ============================================

class OCREngine {
  constructor(options = {}) {
    this.worker = null;
    this.initialized = false;
    this.options = {
      workerPath: options.workerPath || "lib/tesseract/worker.min.js",
      langPath: options.langPath || "lib/tesseract/lang/",
      corePath: options.corePath || "lib/tesseract/core/tesseract-core-simd.wasm.js",
      lang: options.lang || "eng"
    };
  }

  async init() {
    if (this.initialized) return;

    console.log("[OCR] Initialisation du worker...");

    // Tesseract est charge via manifest.json content_scripts
    if (typeof Tesseract === "undefined") {
      throw new Error("Tesseract.js non charge - verifier manifest.json");
    }

    this.worker = await Tesseract.createWorker({
      workerPath: ext.runtime.getURL(this.options.workerPath),
      langPath: ext.runtime.getURL(this.options.langPath),
      corePath: ext.runtime.getURL(this.options.corePath),
      workerBlobURL: false,
      logger: (m) => {
        if (m.status === "recognizing text") {
          console.log(`[OCR] ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    await this.worker.loadLanguage(this.options.lang);
    await this.worker.initialize(this.options.lang);

    // Configurer pour reconnaitre uniquement les chiffres
    await this.worker.setParameters({
      tessedit_char_whitelist: "0123456789 ",
      tessedit_pageseg_mode: "7" // Single line mode
    });

    this.initialized = true;
    console.log("[OCR] Worker pret");
  }

  async recognize(image) {
    if (!this.initialized) {
      await this.init();
    }

    const { data: { text } } = await this.worker.recognize(image);
    return text.trim();
  }

  // Pretraitement simple : agrandir l'image pour meilleure precision
  preprocessImage(imageDataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Agrandir l'image 3x pour meilleure precision OCR
        const scale = 3;
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        // Dessiner avec lissage pour de meilleurs contours
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL("image/png"));
      };
      img.src = imageDataUrl;
    });
  }

  async extractPower(imageDataUrl) {
    // Pretraiter l'image avant OCR (agrandissement)
    const processedImage = await this.preprocessImage(imageDataUrl);
    const text = await this.recognize(processedImage);
    console.log("[OCR] Texte brut:", text);

    const matches = text.match(/[\d,.\s]+/g);

    if (matches) {
      const candidates = matches
        .map(m => m.replace(/[,.\s]/g, ""))
        .filter(m => /^\d+$/.test(m) && m.length >= 5);

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.length - a.length);
        const power = parseInt(candidates[0], 10);
        console.log("[OCR] Puissance extraite:", power);
        return power;
      }
    }

    console.log("[OCR] Aucune puissance trouvee");
    return null;
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      console.log("[OCR] Worker termine");
    }
  }
}

// ============================================
// PerceptualHash - Hash perceptuel pour portraits
// ============================================

class PerceptualHash {
  constructor() {
    this.hashSize = 8;
    this.sampleSize = 32;
  }

  async compute(imageDataUrl) {
    const imageData = await this.getImageData(imageDataUrl);
    const grayscale = this.toGrayscale(imageData);
    const resized = this.resize(grayscale, this.sampleSize, this.sampleSize);
    const hash = this.computeHash(resized);
    return hash;
  }

  getImageData(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = this.sampleSize;
        canvas.height = this.sampleSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, this.sampleSize, this.sampleSize);
        const data = ctx.getImageData(0, 0, this.sampleSize, this.sampleSize);
        resolve(data);
      };
      img.onerror = () => reject(new Error("Echec chargement image"));
      img.src = dataUrl;
    });
  }

  toGrayscale(imageData) {
    const pixels = imageData.data;
    const gray = new Float32Array(this.sampleSize * this.sampleSize);
    for (let i = 0; i < gray.length; i++) {
      const offset = i * 4;
      gray[i] = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    }
    return gray;
  }

  resize(gray, srcWidth, srcHeight) {
    const result = new Float32Array(this.hashSize * this.hashSize);
    const blockW = srcWidth / this.hashSize;
    const blockH = srcHeight / this.hashSize;

    for (let y = 0; y < this.hashSize; y++) {
      for (let x = 0; x < this.hashSize; x++) {
        let sum = 0;
        let count = 0;
        const startY = Math.floor(y * blockH);
        const endY = Math.floor((y + 1) * blockH);
        const startX = Math.floor(x * blockW);
        const endX = Math.floor((x + 1) * blockW);

        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            sum += gray[py * srcWidth + px];
            count++;
          }
        }
        result[y * this.hashSize + x] = count > 0 ? sum / count : 0;
      }
    }
    return result;
  }

  computeHash(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    let hash = "";
    for (let i = 0; i < values.length; i++) {
      hash += values[i] > median ? "1" : "0";
    }
    return this.binaryToHex(hash);
  }

  binaryToHex(binary) {
    let hex = "";
    for (let i = 0; i < binary.length; i += 4) {
      hex += parseInt(binary.substr(i, 4), 2).toString(16);
    }
    return hex;
  }

  distance(hash1, hash2) {
    if (hash1.length !== hash2.length) return Infinity;
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      const n1 = parseInt(hash1[i], 16);
      const n2 = parseInt(hash2[i], 16);
      let xor = n1 ^ n2;
      while (xor) {
        distance += xor & 1;
        xor >>= 1;
      }
    }
    return distance;
  }

  similarity(hash1, hash2) {
    const maxBits = hash1.length * 4;
    const dist = this.distance(hash1, hash2);
    return Math.round((1 - dist / maxBits) * 100);
  }

  findMatch(hash, database, threshold = 70) {
    let bestMatch = null;
    let bestSimilarity = 0;
    for (const [dbHash, name] of Object.entries(database)) {
      const sim = this.similarity(hash, dbHash);
      if (sim > bestSimilarity && sim >= threshold) {
        bestSimilarity = sim;
        bestMatch = { name, similarity: sim };
      }
    }
    return bestMatch;
  }
}

// ============================================
// TeamIdentifier - Identification des equipes
// ============================================

class TeamIdentifier {
  constructor(teamsDb, portraitsDb) {
    this.teams = teamsDb.teams || [];
    this.portraits = portraitsDb.portraits || {};
    this.phash = new PerceptualHash();
  }

  static async load() {
    const teamsUrl = ext.runtime.getURL("data/teams.json");
    const portraitsUrl = ext.runtime.getURL("data/portraits.json");

    const [teamsRes, portraitsRes] = await Promise.all([
      fetch(teamsUrl),
      fetch(portraitsUrl)
    ]);

    const teamsDb = await teamsRes.json();
    const portraitsDb = await portraitsRes.json();

    // Charger aussi les portraits depuis storage si disponibles
    try {
      const stored = await ext.storage.local.get("msfPortraits");
      if (stored.msfPortraits) {
        Object.assign(portraitsDb.portraits, stored.msfPortraits);
      }
    } catch (e) {
      console.log("[MSF] Pas de portraits en storage");
    }

    return new TeamIdentifier(teamsDb, portraitsDb);
  }

  async identifyPortraits(portraitDataUrls) {
    const identified = [];

    for (const dataUrl of portraitDataUrls) {
      const hash = await this.phash.compute(dataUrl);
      const match = this.phash.findMatch(hash, this.portraits);

      if (match) {
        identified.push({
          name: match.name,
          similarity: match.similarity,
          hash
        });
      } else {
        identified.push({
          name: null,
          hash
        });
      }
    }

    return identified;
  }

  identifyTeam(memberNames) {
    // Filtrer les noms null
    const knownNames = memberNames.filter(n => n !== null);

    // On doit avoir exactement 5 personnages identifies
    if (knownNames.length !== 5) {
      return { team: null, confidence: 0, matchedCount: knownNames.length };
    }

    for (const team of this.teams) {
      const matchCount = knownNames.filter(name =>
        team.members.some(member =>
          member.toLowerCase() === name.toLowerCase()
        )
      ).length;

      // Match exact 5/5 requis
      if (matchCount === 5) {
        return {
          team: team,
          matchedCount: 5,
          confidence: 100
        };
      }
    }

    // Pas de match exact - retourner les noms identifies pour info
    return { team: null, confidence: 0, matchedCount: knownNames.length, members: knownNames };
  }
}

// ============================================
// CounterSuggester - Suggestions de counters
// Architecture 3 niveaux: Default < Remote < Custom
// ============================================

class CounterSuggester {
  constructor(countersDb, teamsDb) {
    this.counters = countersDb.counters || {};
    this.teams = teamsDb.teams || [];
  }

  /**
   * Charge les counters avec fusion 3 niveaux:
   * 1. Default (data/counters.json) - base incluse dans l'extension
   * 2. Remote (URL configurable) - sync depuis serveur externe
   * 3. Custom (storage.local) - modifications utilisateur
   *
   * Priorite: Custom > Remote > Default
   */
  static async load() {
    const countersUrl = ext.runtime.getURL("data/counters.json");
    const teamsUrl = ext.runtime.getURL("data/teams.json");

    const [countersRes, teamsRes] = await Promise.all([
      fetch(countersUrl),
      fetch(teamsUrl)
    ]);

    const defaultCounters = await countersRes.json();
    const teamsDb = await teamsRes.json();

    // Commencer avec les counters par defaut
    const mergedCounters = { counters: { ...defaultCounters.counters } };

    // Charger les counters remote depuis storage (synces precedemment)
    try {
      const stored = await ext.storage.local.get("msfRemoteCounters");
      if (stored.msfRemoteCounters && stored.msfRemoteCounters.counters) {
        // Remote ecrase default (par equipe)
        for (const [teamId, counters] of Object.entries(stored.msfRemoteCounters.counters)) {
          mergedCounters.counters[teamId] = counters;
        }
        console.log("[MSF] Counters remote charges");
      }
    } catch (e) {
      console.log("[MSF] Pas de counters remote en storage");
    }

    // Charger les counters custom (priorite maximale)
    try {
      const stored = await ext.storage.local.get("msfCustomCounters");
      if (stored.msfCustomCounters) {
        // Custom ecrase tout (par equipe)
        for (const [teamId, counters] of Object.entries(stored.msfCustomCounters)) {
          mergedCounters.counters[teamId] = counters;
        }
        console.log("[MSF] Counters custom charges");
      }
    } catch (e) {
      console.log("[MSF] Pas de counters custom en storage");
    }

    return new CounterSuggester(mergedCounters, teamsDb);
  }

  /**
   * Synchronise les counters depuis une URL distante
   * @param {string} url - URL du fichier JSON des counters
   * @returns {Promise<{success: boolean, message: string, count: number}>}
   */
  static async syncFromRemote(url) {
    try {
      const response = await fetch(url, {
        cache: "no-cache",
        headers: { "Accept": "application/json" }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Valider le format
      if (!data.counters || typeof data.counters !== "object") {
        throw new Error("Format invalide: 'counters' manquant");
      }

      // Sauvegarder avec metadata
      const remoteData = {
        counters: data.counters,
        version: data.version || 1,
        syncedAt: new Date().toISOString(),
        sourceUrl: url
      };

      await ext.storage.local.set({ msfRemoteCounters: remoteData });

      const teamCount = Object.keys(data.counters).length;
      console.log(`[MSF] Sync remote: ${teamCount} equipes depuis ${url}`);

      return {
        success: true,
        message: `${teamCount} equipes synchronisees`,
        count: teamCount
      };
    } catch (e) {
      console.error("[MSF] Erreur sync remote:", e);
      return {
        success: false,
        message: e.message,
        count: 0
      };
    }
  }

  getTeamName(teamId) {
    const team = this.teams.find(t => t.id === teamId);
    return team ? team.name : teamId;
  }

  suggestCounters(teamId, enemyPower) {
    const counters = this.counters[teamId];
    if (!counters || counters.length === 0) {
      return [];
    }

    return counters.map(counter => {
      const minPower = enemyPower ? Math.round(enemyPower * counter.minPowerRatio) : null;
      return {
        teamId: counter.team,
        teamName: this.getTeamName(counter.team),
        confidence: counter.confidence,
        minPowerRatio: counter.minPowerRatio,
        minPower: minPower,
        notes: counter.notes || null
      };
    }).sort((a, b) => b.confidence - a.confidence);
  }
}

// ============================================
// Handler pour l'extraction complete
// ============================================

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "MSF_EXTRACT") {
    handleExtraction(msg.dataUrl)
      .then(result => sendResponse(result))
      .catch(e => {
        console.error("[MSF] Erreur extraction:", e);
        sendResponse({ error: e.message });
      });
    return true; // Reponse asynchrone
  }

  if (msg.action === "startPortraitCapture") {
    startPortraitCapture({
      dataUrl: msg.dataUrl,
      count: msg.count || 5
    });
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "MSF_GET_SAVED_PORTRAITS") {
    ext.storage.local.get("msf_war_portraits").then(result => {
      if (result.msf_war_portraits && result.msf_war_portraits.length > 0) {
        console.log("[MSF] Portraits récupérés du storage:", result.msf_war_portraits.length);
        sendResponse({ portraits: result.msf_war_portraits });
      } else {
        console.log("[MSF] Aucun portrait dans le storage");
        sendResponse({ portraits: [] });
      }
    }).catch(e => {
      console.error("[MSF] Erreur lecture storage:", e);
      sendResponse({ portraits: [] });
    });
    return true; // Réponse asynchrone
  }

  if (msg.type === "MSF_CALIBRATE_BARRACKS") {
    startBarracksCalibration();
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "MSF_SHOW_BARRACKS_SCAN") {
    showBarracksScanButtons();
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "MSF_START_CLICK_SCAN") {
    startClickToScan();
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "MSF_GET_BARRACKS_CALIBRATION") {
    ext.storage.local.get("msf_barracks_calibration").then(result => {
      sendResponse({ calibration: result.msf_barracks_calibration || null });
    });
    return true;
  }
});

async function handleExtraction(dataUrl) {
  console.log("[MSF] Debut extraction...");

  // 1. Charger l'image
  const img = await loadImage(dataUrl);
  console.log("[MSF] Image chargee:", img.naturalWidth, "x", img.naturalHeight);

  // 2. Charger la config des zones (storage local ou fichier par defaut)
  let config;
  try {
    const stored = await ext.storage.local.get("msfZonesConfig");
    if (stored.msfZonesConfig && stored.msfZonesConfig.slots) {
      config = stored.msfZonesConfig;
      console.log("[MSF] Config chargee depuis storage local:", JSON.stringify(config, null, 2));
    }
  } catch (e) {
    console.log("[MSF] Erreur lecture storage:", e);
  }

  if (!config || !config.slots || config.slots.length === 0) {
    const configUrl = ext.runtime.getURL("msf-zones-config.json");
    const response = await fetch(configUrl);
    config = await response.json();
    console.log("[MSF] Config chargee depuis fichier JSON");
  }

  // Valider que chaque slot a des zones definies
  for (const slot of config.slots) {
    if (!slot.zones) {
      slot.zones = {};
    }
    console.log(`[MSF] Slot ${slot.slotNumber} zones:`, Object.keys(slot.zones));
  }

  const cropper = new ZoneCropper(config);
  console.log("[MSF] Config zones chargee");

  // 3. Extraire toutes les zones
  const slotData = cropper.extractAllSlots(img);
  console.log("[MSF] Zones extraites:", slotData.length, "slots");

  // 4. Initialiser OCR et TeamIdentifier
  const ocr = new OCREngine();
  await ocr.init();

  let identifier = null;
  try {
    identifier = await TeamIdentifier.load();
    console.log("[MSF] TeamIdentifier charge");
  } catch (e) {
    console.log("[MSF] TeamIdentifier non disponible:", e.message);
  }

  // 5. Charger les counters
  let suggester = null;
  try {
    suggester = await CounterSuggester.load();
    console.log("[MSF] CounterSuggester charge");
  } catch (e) {
    console.log("[MSF] CounterSuggester non disponible:", e.message);
  }

  // 6. Extraire les puissances et identifier les equipes
  const results = [];
  for (const slot of slotData) {
    console.log("[MSF] Traitement slot", slot.slotNumber);

    // OCR puissance
    let power = null;
    if (slot.team_power) {
      power = await ocr.extractPower(slot.team_power);
    }

    // Identification des personnages et equipe
    let identifiedPortraits = [];
    let teamInfo = null;

    if (identifier && slot.portraits.length > 0) {
      identifiedPortraits = await identifier.identifyPortraits(slot.portraits);
      const memberNames = identifiedPortraits.map(p => p.name);
      const teamResult = identifier.identifyTeam(memberNames);

      if (teamResult.team) {
        teamInfo = {
          id: teamResult.team.id,
          name: teamResult.team.name,
          confidence: teamResult.confidence,
          matchedCount: teamResult.matchedCount
        };
        console.log(`[MSF] Equipe identifiee: ${teamInfo.name} (${teamInfo.confidence}%)`);
      }
    }

    // Suggestions de counters
    let counters = [];
    if (suggester && teamInfo && teamInfo.id) {
      counters = suggester.suggestCounters(teamInfo.id, power);
      console.log(`[MSF] Counters pour ${teamInfo.name}:`, counters.length);
    }

    results.push({
      slotNumber: slot.slotNumber,
      power: power,
      portraits: slot.portraits,
      identifiedPortraits: identifiedPortraits,
      team: teamInfo,
      counters: counters
    });
  }

  // 7. Cleanup
  await ocr.terminate();

  console.log("[MSF] Extraction terminee");
  return { slots: results };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Echec chargement image"));
    img.src = dataUrl;
  });
}

// ============================================
// Capture de portraits pour le mode War (MODE CLIC DIRECT)
// ============================================

function startPortraitCapture(options) {
  const { dataUrl, count } = options;
  const PORTRAIT_SIZE = 100; // Taille de capture en pixels ecran (augmente pour meilleure precision)

  // Charger l'image de fond
  const bgImage = new Image();
  bgImage.onload = () => {
    createClickCaptureOverlay();
  };
  bgImage.src = dataUrl;

  function createClickCaptureOverlay() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const scaleX = bgImage.naturalWidth / W;
    const scaleY = bgImage.naturalHeight / H;

    const portraits = [];
    let currentIndex = 0;
    let keyHandler = null;

    const overlay = document.createElement("div");
    overlay.id = "msf-portrait-capture";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair";

    // Image de fond
    const bgImg = document.createElement("img");
    bgImg.src = dataUrl;
    bgImg.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;user-select:none`;
    overlay.appendChild(bgImg);

    // Overlay semi-transparent
    const dimmer = document.createElement("div");
    dimmer.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0.3);pointer-events:none";
    overlay.appendChild(dimmer);

    // Curseur visuel (carre de preview)
    const cursor = document.createElement("div");
    cursor.style.cssText = `position:absolute;width:${PORTRAIT_SIZE}px;height:${PORTRAIT_SIZE}px;border:3px solid #ff922b;background:rgba(255,146,43,0.2);box-sizing:border-box;pointer-events:none;display:none;transform:translate(-50%,-50%)`;
    overlay.appendChild(cursor);

    // Instructions
    const info = document.createElement("div");
    info.id = "msf-portrait-info";
    info.style.cssText = "position:fixed;left:50%;top:20px;transform:translateX(-50%);background:rgba(0,0,0,0.95);color:#fff;padding:16px 24px;border-radius:12px;font:14px sans-serif;text-align:center;max-width:500px;z-index:2147483648";
    overlay.appendChild(info);

    function updateInfo() {
      const remaining = count - currentIndex;
      if (remaining > 0) {
        info.innerHTML = `
          <div style="color:#ff922b;font-weight:bold;font-size:16px;margin-bottom:8px">
            Cliquez sur le portrait ${currentIndex + 1}/${count}
          </div>
          <div style="margin-bottom:8px">Cliquez directement sur le visage du personnage</div>
          <div style="font-size:12px;color:#888">
            <b>ESC</b> = Annuler | <b>Retour arriere</b> = Annuler dernier clic
          </div>
        `;
      } else {
        info.innerHTML = `
          <div style="color:#51cf66;font-weight:bold;font-size:16px;margin-bottom:8px">
            ${count} portraits captures !
          </div>
          <div style="font-size:12px;color:#888">
            Cliquez <b>Valider</b> ou appuyez sur <b>ENTREE</b>
          </div>
        `;
      }
    }
    updateInfo();

    // Mini previews
    const previewsContainer = document.createElement("div");
    previewsContainer.id = "msf-portrait-previews";
    previewsContainer.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:flex;gap:8px;background:rgba(0,0,0,0.9);padding:12px;border-radius:8px;z-index:2147483648";
    for (let i = 0; i < count; i++) {
      const preview = document.createElement("div");
      preview.style.cssText = "width:48px;height:48px;border:2px dashed #555;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#555;font-size:14px;font-weight:bold;overflow:hidden";
      preview.textContent = i + 1;
      preview.id = `portrait-preview-${i}`;
      previewsContainer.appendChild(preview);
    }
    overlay.appendChild(previewsContainer);

    // Boutons
    const btnContainer = document.createElement("div");
    btnContainer.id = "msf-portrait-buttons";
    btnContainer.style.cssText = "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);display:flex;gap:12px;z-index:2147483648";

    const btnValidate = document.createElement("button");
    btnValidate.textContent = "Valider";
    btnValidate.style.cssText = "padding:10px 24px;background:#555;color:#888;border:none;border-radius:6px;font-weight:bold;cursor:not-allowed;font-size:14px;pointer-events:auto";
    btnValidate.disabled = true;

    const btnReset = document.createElement("button");
    btnReset.textContent = "Reset";
    btnReset.style.cssText = "padding:10px 24px;background:#ff922b;color:#1a1a2e;border:none;border-radius:6px;font-weight:bold;cursor:pointer;font-size:14px;pointer-events:auto";

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "Annuler";
    btnCancel.style.cssText = "padding:10px 24px;background:#ff6b6b;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;font-size:14px;pointer-events:auto";

    btnContainer.appendChild(btnValidate);
    btnContainer.appendChild(btnReset);
    btnContainer.appendChild(btnCancel);
    overlay.appendChild(btnContainer);

    document.body.appendChild(overlay);

    function updatePreview(index, dataUrlImg) {
      const preview = document.getElementById(`portrait-preview-${index}`);
      if (preview && dataUrlImg) {
        preview.innerHTML = `<img src="${dataUrlImg}" style="width:100%;height:100%;object-fit:cover">`;
        preview.style.borderStyle = "solid";
        preview.style.borderColor = index === currentIndex - 1 ? "#ff922b" : "#51cf66";
      }
    }

    function resetPreview(index) {
      const preview = document.getElementById(`portrait-preview-${index}`);
      if (preview) {
        preview.innerHTML = "";
        preview.textContent = index + 1;
        preview.style.borderStyle = "dashed";
        preview.style.borderColor = "#555";
      }
    }

    function captureAtPoint(clientX, clientY) {
      // Position dans l'image source
      const srcX = clientX * scaleX;
      const srcY = clientY * scaleY;
      const srcSize = PORTRAIT_SIZE * Math.max(scaleX, scaleY);

      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");

      // Capturer carre centre sur le clic
      ctx.drawImage(
        bgImage,
        srcX - srcSize / 2,
        srcY - srcSize / 2,
        srcSize,
        srcSize,
        0, 0, 64, 64
      );

      return canvas.toDataURL("image/png");
    }

    function updateButtonState() {
      if (currentIndex >= count) {
        btnValidate.disabled = false;
        btnValidate.style.background = "#51cf66";
        btnValidate.style.color = "#1a1a2e";
        btnValidate.style.cursor = "pointer";
      } else {
        btnValidate.disabled = true;
        btnValidate.style.background = "#555";
        btnValidate.style.color = "#888";
        btnValidate.style.cursor = "not-allowed";
      }
    }

    function cleanup() {
      if (keyHandler) {
        window.removeEventListener("keydown", keyHandler, true);
        document.removeEventListener("keydown", keyHandler, true);
      }
      ["msf-portrait-capture", "msf-portrait-info", "msf-portrait-previews", "msf-portrait-buttons"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      document.querySelectorAll("[id^='msf-portrait'], [id*='portrait-preview']").forEach(el => el.remove());
    }

    function finishCapture() {
      cleanup();
      if (portraits.length > 0) {
        const portraitData = portraits.map(p => ({ dataUrl: p }));
        ext.storage.local.set({ msf_war_portraits: portraitData }).then(() => {
          console.log(`[MSF] ${portraits.length} portraits sauvegardes`);
          ext.runtime.sendMessage({
            type: "MSF_PORTRAITS_CAPTURED",
            portraits: portraitData
          }).catch(() => {});
        });
      }
    }

    // Mousemove pour montrer le curseur
    overlay.addEventListener("mousemove", function(e) {
      if (currentIndex < count) {
        cursor.style.display = "block";
        cursor.style.left = e.clientX + "px";
        cursor.style.top = e.clientY + "px";
      } else {
        cursor.style.display = "none";
      }
    });

    // Clic pour capturer
    overlay.addEventListener("click", function(e) {
      // Ignorer clics sur UI
      if (e.target.tagName === "BUTTON" || e.target.closest("button") ||
          info.contains(e.target) || previewsContainer.contains(e.target) ||
          btnContainer.contains(e.target)) {
        return;
      }

      if (currentIndex >= count) return;

      const dataUrlImg = captureAtPoint(e.clientX, e.clientY);
      portraits.push(dataUrlImg);
      updatePreview(currentIndex, dataUrlImg);
      currentIndex++;
      updateInfo();
      updateButtonState();

      // Highlight le preview actuel
      if (currentIndex < count) {
        const nextPreview = document.getElementById(`portrait-preview-${currentIndex}`);
        if (nextPreview) {
          nextPreview.style.borderColor = "#ff922b";
        }
      }
    });

    // Bouton Valider
    btnValidate.addEventListener("click", function(e) {
      e.stopPropagation();
      if (currentIndex >= count) {
        finishCapture();
      }
    });

    // Bouton Reset
    btnReset.addEventListener("click", function(e) {
      e.stopPropagation();
      portraits.length = 0;
      currentIndex = 0;
      for (let i = 0; i < count; i++) {
        resetPreview(i);
      }
      updateInfo();
      updateButtonState();
    });

    // Bouton Annuler
    btnCancel.addEventListener("click", function(e) {
      e.stopPropagation();
      cleanup();
    });

    // Raccourcis clavier
    keyHandler = function(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
      } else if (e.key === "Enter" && currentIndex >= count) {
        e.preventDefault();
        e.stopPropagation();
        finishCapture();
      } else if (e.key === "Backspace" && currentIndex > 0) {
        e.preventDefault();
        e.stopPropagation();
        currentIndex--;
        portraits.pop();
        resetPreview(currentIndex);
        updateInfo();
        updateButtonState();
      }
    };

    window.addEventListener("keydown", keyHandler, true);
    document.addEventListener("keydown", keyHandler, true);
  }
}

window.startPortraitCapture = startPortraitCapture;

// ============================================
// Barracks Calibration & Scan
// ============================================

/**
 * Lance la calibration des zones barracks
 * L'utilisateur clique sur 2 points pour definir une carte d'equipe
 */
function startBarracksCalibration() {
  // Ne s'execute que dans la frame principale pour eviter les doublons
  if (window.self !== window.top) {
    console.log("[MSF] Calibration ignoree (pas top frame)");
    return;
  }

  // Verifier si l'overlay existe deja
  if (document.getElementById("msf-barracks-calibration")) {
    console.log("[MSF] Calibration deja en cours");
    return;
  }

  console.log("[MSF] Debut calibration barracks");

  // Creer l'overlay de calibration
  const overlay = document.createElement("div");
  overlay.id = "msf-barracks-calibration";
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 999999;
    cursor: crosshair;
  `;

  // Instructions
  const instructions = document.createElement("div");
  instructions.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a2e;
    color: white;
    padding: 15px 25px;
    border-radius: 8px;
    font-family: sans-serif;
    font-size: 16px;
    z-index: 1000000;
    text-align: center;
    border: 2px solid #00d4ff;
  `;
  instructions.innerHTML = `
    <strong>Calibration Barracks</strong><br>
    <span id="calibration-step">Etape 1/2: Cliquez sur le coin HAUT-GAUCHE de la carte equipe 1</span>
  `;
  overlay.appendChild(instructions);

  // Marqueur visuel
  const marker = document.createElement("div");
  marker.style.cssText = `
    position: fixed;
    width: 10px;
    height: 10px;
    background: #00ff00;
    border: 2px solid white;
    border-radius: 50%;
    display: none;
    z-index: 1000001;
    pointer-events: none;
  `;
  overlay.appendChild(marker);

  let clickCount = 0;
  let point1 = null;
  let point2 = null;

  overlay.addEventListener("click", (e) => {
    clickCount++;
    const x = e.clientX;
    const y = e.clientY;

    if (clickCount === 1) {
      point1 = { x, y };
      // Afficher le marqueur
      marker.style.left = (x - 5) + "px";
      marker.style.top = (y - 5) + "px";
      marker.style.display = "block";
      document.getElementById("calibration-step").textContent =
        "Etape 2/2: Cliquez sur le coin BAS-DROIT de la carte equipe 1";
    } else if (clickCount === 2) {
      point2 = { x, y };

      // Calculer les dimensions
      const cardWidth = point2.x - point1.x;
      const cardHeight = point2.y - point1.y;

      if (cardWidth < 50 || cardHeight < 50) {
        alert("Zone trop petite. Recommencez.");
        clickCount = 0;
        point1 = null;
        marker.style.display = "none";
        document.getElementById("calibration-step").textContent =
          "Etape 1/2: Cliquez sur le coin HAUT-GAUCHE de la carte equipe 1";
        return;
      }

      // Sauvegarder la calibration
      const calibration = {
        card1: { x: point1.x, y: point1.y, width: cardWidth, height: cardHeight },
        cardSpacing: cardWidth + 20, // Espacement estime entre cartes
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        timestamp: Date.now()
      };

      ext.storage.local.set({ msf_barracks_calibration: calibration }).then(() => {
        console.log("[MSF] Calibration sauvegardee:", calibration);

        // Afficher confirmation
        instructions.innerHTML = `
          <strong style="color:#00ff00;">Calibration reussie !</strong><br>
          Carte: ${cardWidth}x${cardHeight}px<br>
          Vous pouvez maintenant utiliser "Scan Barracks"
        `;

        setTimeout(() => {
          overlay.remove();
        }, 2000);
      });
    }
  });

  // Bouton annuler
  const btnCancel = document.createElement("button");
  btnCancel.textContent = "Annuler";
  btnCancel.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 30px;
    background: #ff4444;
    color: white;
    border: none;
    border-radius: 5px;
    font-size: 14px;
    cursor: pointer;
    z-index: 1000000;
  `;
  btnCancel.addEventListener("click", () => overlay.remove());
  overlay.appendChild(btnCancel);

  document.body.appendChild(overlay);
}

/**
 * Affiche les boutons de scan sur les cartes d'equipe
 */
async function showBarracksScanButtons() {
  // Ne s'execute que dans la frame principale
  if (window.self !== window.top) {
    return;
  }

  console.log("[MSF] Affichage boutons scan barracks");

  // Charger la calibration
  const result = await ext.storage.local.get("msf_barracks_calibration");
  const calibration = result.msf_barracks_calibration;

  if (!calibration) {
    alert("Calibration requise. Cliquez d'abord sur 'Calibrer'.");
    return;
  }

  // Verifier si la taille d'ecran a change
  if (Math.abs(calibration.screenWidth - window.innerWidth) > 50 ||
      Math.abs(calibration.screenHeight - window.innerHeight) > 50) {
    alert("La taille de fenetre a change. Veuillez recalibrer.");
    return;
  }

  // Supprimer les anciens boutons
  document.querySelectorAll(".msf-barracks-scan-btn").forEach(el => el.remove());

  // Creer les 5 boutons de scan
  for (let i = 0; i < 5; i++) {
    const btn = document.createElement("button");
    btn.className = "msf-barracks-scan-btn";
    btn.textContent = "📷 " + (i + 1);
    btn.dataset.teamIndex = i;

    const xPos = calibration.card1.x + (i * calibration.cardSpacing) + calibration.card1.width / 2 - 30;
    const yPos = calibration.card1.y - 40;

    btn.style.cssText = `
      position: fixed;
      left: ${xPos}px;
      top: ${yPos}px;
      padding: 8px 15px;
      background: #00d4ff;
      color: #000;
      border: none;
      border-radius: 5px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      z-index: 999999;
      box-shadow: 0 2px 10px rgba(0,212,255,0.5);
      transition: transform 0.1s;
    `;

    btn.addEventListener("mouseenter", () => btn.style.transform = "scale(1.1)");
    btn.addEventListener("mouseleave", () => btn.style.transform = "scale(1)");

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const teamIndex = parseInt(btn.dataset.teamIndex);
      const debugMode = e.shiftKey; // Shift+clic = mode debug
      console.log("[MSF] Scan equipe", teamIndex + 1, debugMode ? "(DEBUG)" : "");
      await captureTeamPortraits(calibration, teamIndex, debugMode);
    });

    document.body.appendChild(btn);
  }

  // Bouton Debug
  const debugBtn = document.createElement("button");
  debugBtn.className = "msf-barracks-scan-btn";
  debugBtn.textContent = "🔍 Debug";
  debugBtn.title = "Afficher les zones de capture";
  debugBtn.style.cssText = `
    position: fixed;
    right: 120px;
    top: 20px;
    padding: 10px 20px;
    background: #ff9900;
    color: black;
    border: none;
    border-radius: 5px;
    font-size: 14px;
    cursor: pointer;
    z-index: 999999;
  `;
  debugBtn.addEventListener("click", async () => {
    await captureTeamPortraits(calibration, 0, true); // Debug sur equipe 1
  });
  document.body.appendChild(debugBtn);

  // Bouton pour fermer
  const closeBtn = document.createElement("button");
  closeBtn.className = "msf-barracks-scan-btn";
  closeBtn.textContent = "✖ Fermer";
  closeBtn.style.cssText = `
    position: fixed;
    right: 20px;
    top: 20px;
    padding: 10px 20px;
    background: #ff4444;
    color: white;
    border: none;
    border-radius: 5px;
    font-size: 14px;
    cursor: pointer;
    z-index: 999999;
  `;
  closeBtn.addEventListener("click", () => {
    document.querySelectorAll(".msf-barracks-scan-btn").forEach(el => el.remove());
    document.querySelectorAll(".msf-debug-overlay").forEach(el => el.remove());
  });
  document.body.appendChild(closeBtn);
}

/**
 * Capture les 5 portraits d'une equipe
 */
async function captureTeamPortraits(calibration, teamIndex, debugMode = false) {
  console.log("[MSF] Capture portraits equipe", teamIndex + 1);

  // Calculer la position de la carte
  const cardX = calibration.card1.x + (teamIndex * calibration.cardSpacing);
  const cardY = calibration.card1.y;
  const cardW = calibration.card1.width;
  const cardH = calibration.card1.height;

  // Capture de l'ecran
  const screenshot = await captureVisibleTab();
  if (!screenshot) {
    alert("Erreur capture ecran");
    return;
  }

  // Charger l'image
  const img = await loadImage(screenshot);

  // Calculer les positions relatives des 5 portraits dans la carte
  // Structure: header (12%), row1 portraits (28%), row2 portraits (28%), edit btn
  // Les portraits sont organises: 2 en haut, 3 en bas
  // On capture uniquement les VISAGES, pas les chiffres de puissance en dessous

  const portraitWidth = cardW * 0.25;   // Largeur du portrait (~25% de la carte)
  const portraitHeight = cardW * 0.25;  // Hauteur = largeur (carre)

  // Positions calibrees depuis BARRACKS.png (2026-01-30)
  const portraitPositions = [
    // Ligne du haut (2 portraits)
    { x: cardX + cardW * 0.12, y: cardY + cardH * 0.13 },
    { x: cardX + cardW * 0.44, y: cardY + cardH * 0.13 },
    // Ligne du bas (3 portraits)
    { x: cardX + cardW * 0.03, y: cardY + cardH * 0.45 },
    { x: cardX + cardW * 0.29, y: cardY + cardH * 0.45 },
    { x: cardX + cardW * 0.55, y: cardY + cardH * 0.45 },
  ];

  // Mode debug: afficher les zones de capture
  if (debugMode) {
    showDebugOverlay(cardX, cardY, cardW, cardH, portraitPositions, portraitWidth, portraitHeight);
    return;
  }

  const portraits = [];

  for (let i = 0; i < 5; i++) {
    const pos = portraitPositions[i];

    // Creer un canvas pour extraire le portrait
    const canvas = document.createElement("canvas");
    canvas.width = portraitWidth;
    canvas.height = portraitHeight;
    const ctx = canvas.getContext("2d");

    // Ratio entre l'image et l'ecran
    const scaleX = img.naturalWidth / window.innerWidth;
    const scaleY = img.naturalHeight / window.innerHeight;

    ctx.drawImage(
      img,
      pos.x * scaleX,
      pos.y * scaleY,
      portraitWidth * scaleX,
      portraitHeight * scaleY,
      0,
      0,
      portraitWidth,
      portraitHeight
    );

    portraits.push({
      index: i,
      dataUrl: canvas.toDataURL("image/png")
    });
  }

  console.log("[MSF] Portraits captures:", portraits.length);

  // Sauvegarder et notifier
  await ext.storage.local.set({ msf_war_portraits: portraits });
  ext.runtime.sendMessage({
    type: "MSF_PORTRAITS_CAPTURED",
    portraits: portraits
  });

  // Feedback visuel
  const feedback = document.createElement("div");
  feedback.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 212, 255, 0.9);
    color: black;
    padding: 20px 40px;
    border-radius: 10px;
    font-size: 18px;
    font-weight: bold;
    z-index: 1000000;
  `;
  feedback.textContent = "✓ Equipe " + (teamIndex + 1) + " capturee !";
  document.body.appendChild(feedback);
  setTimeout(() => feedback.remove(), 1500);
}

/**
 * Capture l'onglet visible via le background script
 */
async function captureVisibleTab() {
  return new Promise((resolve) => {
    ext.runtime.sendMessage({ type: "MSF_CAPTURE_TAB" }, (response) => {
      if (response && response.dataUrl) {
        resolve(response.dataUrl);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Affiche un overlay de debug pour visualiser les zones de capture
 */
function showDebugOverlay(cardX, cardY, cardW, cardH, positions, portW, portH) {
  // Supprimer l'ancien overlay
  document.querySelectorAll(".msf-debug-overlay").forEach(el => el.remove());

  // Rectangle de la carte
  const cardOverlay = document.createElement("div");
  cardOverlay.className = "msf-debug-overlay";
  cardOverlay.style.cssText = `
    position: fixed;
    left: ${cardX}px;
    top: ${cardY}px;
    width: ${cardW}px;
    height: ${cardH}px;
    border: 3px solid #00ff00;
    background: rgba(0, 255, 0, 0.1);
    z-index: 999998;
    pointer-events: none;
  `;
  document.body.appendChild(cardOverlay);

  // Rectangles des portraits
  positions.forEach((pos, i) => {
    const portOverlay = document.createElement("div");
    portOverlay.className = "msf-debug-overlay";
    portOverlay.style.cssText = `
      position: fixed;
      left: ${pos.x}px;
      top: ${pos.y}px;
      width: ${portW}px;
      height: ${portH}px;
      border: 2px solid #ff00ff;
      background: rgba(255, 0, 255, 0.2);
      z-index: 999999;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 20px;
      text-shadow: 0 0 3px black;
    `;
    portOverlay.textContent = (i + 1);
    document.body.appendChild(portOverlay);
  });

  // Bouton pour fermer
  const closeBtn = document.createElement("button");
  closeBtn.className = "msf-debug-overlay";
  closeBtn.textContent = "Fermer Debug";
  closeBtn.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    padding: 10px 20px;
    background: #ff4444;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    z-index: 1000000;
  `;
  closeBtn.addEventListener("click", () => {
    document.querySelectorAll(".msf-debug-overlay").forEach(el => el.remove());
  });
  document.body.appendChild(closeBtn);

  // Info
  const info = document.createElement("div");
  info.className = "msf-debug-overlay";
  info.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    background: rgba(0,0,0,0.8);
    color: white;
    border-radius: 5px;
    z-index: 1000000;
    font-family: monospace;
  `;
  info.innerHTML = `Carte: ${Math.round(cardW)}x${Math.round(cardH)}px | Portrait: ${Math.round(portW)}x${Math.round(portH)}px`;
  document.body.appendChild(info);
}

window.startBarracksCalibration = startBarracksCalibration;
window.showBarracksScanButtons = showBarracksScanButtons;

// ============================================
// Mode Scan par Clic (Option 2 - plus flexible)
// ============================================

/**
 * Lance le mode scan par clic
 * L'utilisateur clique sur une equipe et les portraits sont extraits autour du clic
 */
async function startClickToScan() {
  // Ne s'execute que dans la frame principale
  if (window.self !== window.top) {
    return;
  }

  // Supprimer tout overlay existant
  document.querySelectorAll(".msf-click-scan-overlay").forEach(el => el.remove());

  console.log("[MSF] Mode scan par clic active");

  // Charger la calibration pour avoir les dimensions de carte
  const result = await ext.storage.local.get("msf_barracks_calibration");
  const calibration = result.msf_barracks_calibration;

  // Dimensions par defaut incluant le bouton EDIT pour une reference fixe
  const cardWidth = calibration ? calibration.card1.width : 290;
  const cardHeight = calibration ? calibration.card1.height : 320;

  // Creer l'overlay
  const overlay = document.createElement("div");
  overlay.className = "msf-click-scan-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.3);
    z-index: 999999;
    cursor: crosshair;
  `;

  // Instructions
  const instructions = document.createElement("div");
  instructions.className = "msf-click-scan-overlay";
  instructions.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a2e;
    color: white;
    padding: 15px 25px;
    border-radius: 8px;
    font-family: sans-serif;
    font-size: 16px;
    z-index: 1000000;
    text-align: center;
    border: 2px solid #00d4ff;
  `;
  instructions.innerHTML = `
    <strong>Mode Scan</strong><br>
    Cliquez au CENTRE d'une carte<br>
    <span style="color:#00d4ff;font-size:13px;">SHIFT+Clic = Scanner TOUTES les equipes visibles</span>
  `;
  overlay.appendChild(instructions);

  // Indicateur de zone (suit la souris)
  const zoneIndicator = document.createElement("div");
  zoneIndicator.className = "msf-click-scan-overlay";
  zoneIndicator.style.cssText = `
    position: fixed;
    width: ${cardWidth}px;
    height: ${cardHeight}px;
    border: 3px solid #00d4ff;
    background: rgba(0, 212, 255, 0.1);
    pointer-events: none;
    z-index: 999998;
    display: none;
  `;
  document.body.appendChild(zoneIndicator);

  // Suivre la souris pour afficher la zone
  const mouseMoveHandler = (e) => {
    zoneIndicator.style.display = "block";
    zoneIndicator.style.left = (e.clientX - cardWidth / 2) + "px";
    zoneIndicator.style.top = (e.clientY - cardHeight / 2) + "px";
  };
  overlay.addEventListener("mousemove", mouseMoveHandler);

  // Clic pour capturer
  overlay.addEventListener("click", async (e) => {
    const clickX = e.clientX;
    const clickY = e.clientY;
    const multiMode = e.shiftKey; // SHIFT = scanner toutes les equipes

    console.log("[MSF] Clic detecte a:", clickX, clickY, multiMode ? "(multi-equipes)" : "(equipe unique)");

    // Retirer l'overlay AVANT de capturer pour avoir un ecran propre
    document.querySelectorAll(".msf-click-scan-overlay").forEach(el => el.remove());

    // Attendre un frame pour que le DOM soit mis a jour
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Capturer le screenshot MAINTENANT (ecran propre, sans overlay)
    const screenshot = await captureVisibleTab();

    // Afficher un feedback de chargement APRES la capture
    const loadingFeedback = document.createElement("div");
    loadingFeedback.id = "msf-loading-feedback";
    loadingFeedback.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px 40px;
      border-radius: 10px;
      font-size: 18px;
      z-index: 1000000;
    `;
    loadingFeedback.textContent = multiMode ? "Analyse des equipes..." : "Analyse en cours...";
    document.body.appendChild(loadingFeedback);

    if (multiMode) {
      // Mode multi-equipes: capturer toutes les equipes a partir de ce clic
      await captureMultipleTeams(clickX, clickY, cardWidth, cardHeight, screenshot, 5);
    } else {
      // Mode equipe unique
      await capturePortraitsAroundClick(clickX, clickY, cardWidth, cardHeight, screenshot);
    }

    // Retirer le feedback
    loadingFeedback.remove();
  });

  // Bouton annuler
  const btnCancel = document.createElement("button");
  btnCancel.className = "msf-click-scan-overlay";
  btnCancel.textContent = "Annuler (ESC)";
  btnCancel.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 30px;
    background: #ff4444;
    color: white;
    border: none;
    border-radius: 5px;
    font-size: 14px;
    cursor: pointer;
    z-index: 1000000;
  `;
  btnCancel.addEventListener("click", () => {
    document.querySelectorAll(".msf-click-scan-overlay").forEach(el => el.remove());
  });
  overlay.appendChild(btnCancel);

  // ESC pour annuler
  const escHandler = (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".msf-click-scan-overlay").forEach(el => el.remove());
      window.removeEventListener("keydown", escHandler);
    }
  };
  window.addEventListener("keydown", escHandler);

  document.body.appendChild(overlay);
}

/**
 * Capture les 5 portraits autour d'un point de clic
 * @param {string} screenshot - Screenshot deja capture (pour eviter d'inclure le feedback)
 */
async function capturePortraitsAroundClick(clickX, clickY, cardWidth, cardHeight, screenshot) {
  console.log("[MSF] Capture portraits autour de:", clickX, clickY);

  // Le clic est au centre de la carte
  const cardX = clickX - cardWidth / 2;
  const cardY = clickY - cardHeight / 2;

  // Utiliser le screenshot passe en parametre
  if (!screenshot) {
    alert("Erreur: pas de screenshot");
    return;
  }

  // Charger l'image
  const img = await loadImage(screenshot);

  // Calculer les positions des portraits (meme logique que captureTeamPortraits)
  const portraitWidth = cardWidth * 0.25;
  const portraitHeight = cardWidth * 0.25;

  // Positions recalculees pour carte incluant bouton EDIT (hauteur 320 au lieu de 260)
  const portraitPositions = [
    // Ligne du haut (2 portraits) - environ 15% depuis le haut
    { x: cardX + cardWidth * 0.19, y: cardY + cardHeight * 0.15 },
    { x: cardX + cardWidth * 0.56, y: cardY + cardHeight * 0.15 },
    // Ligne du bas (3 portraits) - environ 42% depuis le haut
    { x: cardX + cardWidth * 0.07, y: cardY + cardHeight * 0.42 },
    { x: cardX + cardWidth * 0.38, y: cardY + cardHeight * 0.42 },
    { x: cardX + cardWidth * 0.69, y: cardY + cardHeight * 0.42 },
  ];

  const portraits = [];

  // Ratio entre l'image et l'ecran
  const scaleX = img.naturalWidth / window.innerWidth;
  const scaleY = img.naturalHeight / window.innerHeight;

  for (let i = 0; i < 5; i++) {
    const pos = portraitPositions[i];

    const canvas = document.createElement("canvas");
    canvas.width = portraitWidth;
    canvas.height = portraitHeight;
    const ctx = canvas.getContext("2d");

    ctx.drawImage(
      img,
      pos.x * scaleX,
      pos.y * scaleY,
      portraitWidth * scaleX,
      portraitHeight * scaleY,
      0,
      0,
      portraitWidth,
      portraitHeight
    );

    portraits.push({
      index: i,
      dataUrl: canvas.toDataURL("image/png")
    });
  }

  console.log("[MSF] Portraits captures:", portraits.length);

  // Sauvegarder et notifier
  await ext.storage.local.set({ msf_war_portraits: portraits });
  ext.runtime.sendMessage({
    type: "MSF_PORTRAITS_CAPTURED",
    portraits: portraits
  });

  // Feedback visuel
  const feedback = document.createElement("div");
  feedback.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 212, 255, 0.9);
    color: black;
    padding: 20px 40px;
    border-radius: 10px;
    font-size: 18px;
    font-weight: bold;
    z-index: 1000000;
  `;
  feedback.textContent = "✓ Equipe capturee !";
  document.body.appendChild(feedback);
  setTimeout(() => feedback.remove(), 1500);
}

/**
 * Capture plusieurs equipes a partir du clic sur la premiere carte
 * @param {number} firstCardX - Position X du centre de la premiere carte
 * @param {number} firstCardY - Position Y du centre de la premiere carte
 * @param {number} cardWidth - Largeur d'une carte
 * @param {number} cardHeight - Hauteur d'une carte
 * @param {string} screenshot - Screenshot deja capture
 * @param {number} teamCount - Nombre d'equipes a capturer (defaut: 5)
 */
async function captureMultipleTeams(firstCardX, firstCardY, cardWidth, cardHeight, screenshot, teamCount = 5) {
  console.log("[MSF] Capture de", teamCount, "equipes");

  if (!screenshot) {
    alert("Erreur: pas de screenshot");
    return;
  }

  const img = await loadImage(screenshot);
  const scaleX = img.naturalWidth / window.innerWidth;
  const scaleY = img.naturalHeight / window.innerHeight;

  // Espacement entre les cartes (environ 8px)
  const cardSpacing = 8;
  const totalCardWidth = cardWidth + cardSpacing;

  const allTeams = [];
  const portraitWidth = cardWidth * 0.25;
  const portraitHeight = cardWidth * 0.25;

  for (let teamIdx = 0; teamIdx < teamCount; teamIdx++) {
    // Position du centre de cette carte
    const cardCenterX = firstCardX + (teamIdx * totalCardWidth);
    const cardX = cardCenterX - cardWidth / 2;
    const cardY = firstCardY - cardHeight / 2;

    // Verifier que la carte est dans l'ecran
    if (cardX + cardWidth > window.innerWidth) {
      console.log(`[MSF] Carte ${teamIdx + 1} hors ecran, arret`);
      break;
    }

    // Positions des portraits pour cette carte
    const portraitPositions = [
      { x: cardX + cardWidth * 0.19, y: cardY + cardHeight * 0.15 },
      { x: cardX + cardWidth * 0.56, y: cardY + cardHeight * 0.15 },
      { x: cardX + cardWidth * 0.07, y: cardY + cardHeight * 0.42 },
      { x: cardX + cardWidth * 0.38, y: cardY + cardHeight * 0.42 },
      { x: cardX + cardWidth * 0.69, y: cardY + cardHeight * 0.42 },
    ];

    const portraits = [];

    for (let i = 0; i < 5; i++) {
      const pos = portraitPositions[i];
      const canvas = document.createElement("canvas");
      canvas.width = portraitWidth;
      canvas.height = portraitHeight;
      const ctx = canvas.getContext("2d");

      ctx.drawImage(
        img,
        pos.x * scaleX,
        pos.y * scaleY,
        portraitWidth * scaleX,
        portraitHeight * scaleY,
        0,
        0,
        portraitWidth,
        portraitHeight
      );

      portraits.push({
        index: i,
        dataUrl: canvas.toDataURL("image/png")
      });
    }

    allTeams.push({
      teamIndex: teamIdx + 1,
      portraits: portraits
    });

    console.log(`[MSF] Equipe ${teamIdx + 1} capturee`);
  }

  console.log("[MSF] Total equipes capturees:", allTeams.length);

  // Sauvegarder et notifier
  await ext.storage.local.set({ msf_multi_teams: allTeams });
  ext.runtime.sendMessage({
    type: "MSF_MULTI_TEAMS_CAPTURED",
    teams: allTeams
  });

  // Feedback visuel
  const feedback = document.createElement("div");
  feedback.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 212, 255, 0.9);
    color: black;
    padding: 20px 40px;
    border-radius: 10px;
    font-size: 18px;
    font-weight: bold;
    z-index: 1000000;
  `;
  feedback.textContent = `✓ ${allTeams.length} equipes capturees !`;
  document.body.appendChild(feedback);
  setTimeout(() => feedback.remove(), 2000);
}

window.startClickToScan = startClickToScan;

console.log("[MSF] Calibrateur pret - Tapez: startCropCalibrator()");