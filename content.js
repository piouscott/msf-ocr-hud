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

  if (msg.action === "startCalibrator") {
    startCropCalibrator({
      label: msg.label || "CROP",
      showGrid: msg.showGrid || false
    });
    sendResponse({ success: true });
    return true;
  }

  if (msg.action === "startPortraitCapture") {
    startPortraitCapture({
      dataUrl: msg.dataUrl,
      count: msg.count || 5
    });
    sendResponse({ success: true });
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
// Calibrateur de zones avec sauvegarde
// ============================================

const ZONE_STEPS = [
  { slot: 1, zone: "team_power", label: "SLOT 1 - Zone PUISSANCE (texte chiffres)" },
  { slot: 1, zone: "portrait_1", label: "SLOT 1 - Portrait 1 (gauche)" },
  { slot: 1, zone: "portrait_2", label: "SLOT 1 - Portrait 2" },
  { slot: 1, zone: "portrait_3", label: "SLOT 1 - Portrait 3 (centre)" },
  { slot: 1, zone: "portrait_4", label: "SLOT 1 - Portrait 4" },
  { slot: 1, zone: "portrait_5", label: "SLOT 1 - Portrait 5 (droite)" },
  { slot: 2, zone: "team_power", label: "SLOT 2 - Zone PUISSANCE" },
  { slot: 2, zone: "portrait_1", label: "SLOT 2 - Portrait 1" },
  { slot: 2, zone: "portrait_2", label: "SLOT 2 - Portrait 2" },
  { slot: 2, zone: "portrait_3", label: "SLOT 2 - Portrait 3" },
  { slot: 2, zone: "portrait_4", label: "SLOT 2 - Portrait 4" },
  { slot: 2, zone: "portrait_5", label: "SLOT 2 - Portrait 5" },
  { slot: 3, zone: "team_power", label: "SLOT 3 - Zone PUISSANCE" },
  { slot: 3, zone: "portrait_1", label: "SLOT 3 - Portrait 1" },
  { slot: 3, zone: "portrait_2", label: "SLOT 3 - Portrait 2" },
  { slot: 3, zone: "portrait_3", label: "SLOT 3 - Portrait 3" },
  { slot: 3, zone: "portrait_4", label: "SLOT 3 - Portrait 4" },
  { slot: 3, zone: "portrait_5", label: "SLOT 3 - Portrait 5" },
  { slot: 4, zone: "team_power", label: "SLOT 4 - Zone PUISSANCE" },
  { slot: 4, zone: "portrait_1", label: "SLOT 4 - Portrait 1" },
  { slot: 4, zone: "portrait_2", label: "SLOT 4 - Portrait 2" },
  { slot: 4, zone: "portrait_3", label: "SLOT 4 - Portrait 3" },
  { slot: 4, zone: "portrait_4", label: "SLOT 4 - Portrait 4" },
  { slot: 4, zone: "portrait_5", label: "SLOT 4 - Portrait 5" }
];

function startCropCalibrator(options) {
  options = options || {};
  const showGrid = options.showGrid !== false;
  const stepIndex = options.stepIndex || 0;
  const calibrationData = options.calibrationData || { slots: [
    { slotNumber: 1, zones: {} },
    { slotNumber: 2, zones: {} },
    { slotNumber: 3, zones: {} },
    { slotNumber: 4, zones: {} }
  ]};

  const currentStep = ZONE_STEPS[stepIndex];
  if (!currentStep) {
    // Calibration terminee - sauvegarder
    saveCalibration(calibrationData);
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "msf-calib";
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.3)";
  document.body.appendChild(overlay);

  if (showGrid) {
    const grid = document.createElement("div");
    grid.style.cssText = "position:absolute;inset:0;background-image:repeating-linear-gradient(0deg,transparent,transparent 49px,rgba(0,229,255,0.1) 49px,rgba(0,229,255,0.1) 50px),repeating-linear-gradient(90deg,transparent,transparent 49px,rgba(0,229,255,0.1) 49px,rgba(0,229,255,0.1) 50px);pointer-events:none";
    overlay.appendChild(grid);
  }

  const box = document.createElement("div");
  box.style.cssText = "position:absolute;border:2px solid #0ff;background:rgba(0,255,255,0.15);box-sizing:border-box";
  overlay.appendChild(box);

  const info = document.createElement("div");
  info.style.cssText = "position:fixed;left:50%;top:20px;transform:translateX(-50%);background:rgba(0,0,0,0.95);color:#fff;padding:16px 24px;border-radius:12px;font:14px sans-serif;text-align:center;max-width:500px";
  info.innerHTML = `
    <div style="color:#0ff;font-weight:bold;font-size:16px;margin-bottom:8px">
      Etape ${stepIndex + 1}/${ZONE_STEPS.length}
    </div>
    <div style="margin-bottom:12px">${currentStep.label}</div>
    <div style="font-size:12px;color:#888">
      Dessine un rectangle autour de la zone<br>
      <b>ENTREE</b> = Valider | <b>ESC</b> = Quitter | <b>S</b> = Passer
    </div>
  `;
  overlay.appendChild(info);

  const coords = document.createElement("pre");
  coords.style.cssText = "position:fixed;right:16px;bottom:16px;background:rgba(0,0,0,0.9);color:#0ff;padding:12px;border-radius:8px;font:12px monospace;margin:0";
  coords.textContent = "Selectionnez une zone...";
  overlay.appendChild(coords);

  let startX = 0, startY = 0, endX = 0, endY = 0;
  let dragging = false;
  let hasSelection = false;
  const W = window.innerWidth;
  const H = window.innerHeight;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function updateBox() {
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);
    box.style.left = x + "px";
    box.style.top = y + "px";
    box.style.width = w + "px";
    box.style.height = h + "px";

    const rx = (x / W).toFixed(4);
    const ry = (y / H).toFixed(4);
    const rw = (w / W).toFixed(4);
    const rh = (h / H).toFixed(4);
    coords.textContent = `x: ${rx}, y: ${ry}\nw: ${rw}, h: ${rh}`;
  }

  function getZoneData() {
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);
    return {
      x: x / W,
      y: y / H,
      w: w / W,
      h: h / H
    };
  }

  function saveAndNext() {
    if (hasSelection) {
      const slotIdx = currentStep.slot - 1;
      calibrationData.slots[slotIdx].zones[currentStep.zone] = getZoneData();
    }
    overlay.remove();
    startCropCalibrator({
      showGrid,
      stepIndex: stepIndex + 1,
      calibrationData
    });
  }

  function skip() {
    overlay.remove();
    startCropCalibrator({
      showGrid,
      stepIndex: stepIndex + 1,
      calibrationData
    });
  }

  overlay.addEventListener("mousedown", function(e) {
    if (e.target === info || e.target === coords) return;
    dragging = true;
    hasSelection = false;
    startX = clamp(e.clientX, 0, W);
    startY = clamp(e.clientY, 0, H);
    endX = startX;
    endY = startY;
    updateBox();
  });

  overlay.addEventListener("mousemove", function(e) {
    if (!dragging) return;
    endX = clamp(e.clientX, 0, W);
    endY = clamp(e.clientY, 0, H);
    updateBox();
  });

  overlay.addEventListener("mouseup", function() {
    if (dragging && Math.abs(endX - startX) > 5 && Math.abs(endY - startY) > 5) {
      hasSelection = true;
    }
    dragging = false;
  });

  window.addEventListener("keydown", function handler(e) {
    if (e.key === "Escape") {
      overlay.remove();
      window.removeEventListener("keydown", handler);
      alert("Calibration annulee");
    } else if (e.key === "Enter" && hasSelection) {
      window.removeEventListener("keydown", handler);
      saveAndNext();
    } else if (e.key === "s" || e.key === "S") {
      window.removeEventListener("keydown", handler);
      skip();
    }
  });
}

async function saveCalibration(data) {
  try {
    await ext.storage.local.set({ msfZonesConfig: data });
    alert("Calibration sauvegardee avec succes!\n\nLes nouvelles zones seront utilisees pour l'analyse.");
    console.log("[MSF] Calibration sauvegardee:", data);
  } catch (e) {
    console.error("[MSF] Erreur sauvegarde:", e);
    alert("Erreur lors de la sauvegarde: " + e.message);
  }
}

window.startCropCalibrator = startCropCalibrator;

// ============================================
// Capture de portraits pour le mode War
// ============================================

function startPortraitCapture(options) {
  const { dataUrl, count } = options;

  // Charger l'image de fond
  const bgImage = new Image();
  bgImage.onload = () => {
    createCaptureOverlay();
  };
  bgImage.src = dataUrl;

  function createCaptureOverlay() {
    const W = window.innerWidth;
    const H = window.innerHeight;

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

    // Box de selection principale
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;border:3px solid #ff922b;background:rgba(255,146,43,0.1);box-sizing:border-box;pointer-events:none";
    overlay.appendChild(box);

    // Lignes de separation (pour montrer les 5 colonnes)
    const separators = [];
    for (let i = 1; i < count; i++) {
      const sep = document.createElement("div");
      sep.style.cssText = "position:absolute;width:2px;background:#ff922b;opacity:0.7;pointer-events:none;display:none";
      box.appendChild(sep);
      separators.push(sep);
    }

    // Instructions
    const info = document.createElement("div");
    info.style.cssText = "position:fixed;left:50%;top:20px;transform:translateX(-50%);background:rgba(0,0,0,0.95);color:#fff;padding:16px 24px;border-radius:12px;font:14px sans-serif;text-align:center;max-width:500px;z-index:10";
    info.innerHTML = `
      <div style="color:#ff922b;font-weight:bold;font-size:16px;margin-bottom:8px">
        Capture des ${count} portraits
      </div>
      <div style="margin-bottom:12px">Selectionnez la zone contenant les ${count} portraits alignes horizontalement</div>
      <div style="font-size:12px;color:#888">
        La zone sera decoupee automatiquement en ${count} colonnes<br>
        <b>ENTREE</b> = Valider | <b>ESC</b> = Annuler
      </div>
    `;
    overlay.appendChild(info);

    // Mini previews
    const previewsContainer = document.createElement("div");
    previewsContainer.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:flex;gap:8px;background:rgba(0,0,0,0.9);padding:12px;border-radius:8px;z-index:10";
    for (let i = 0; i < count; i++) {
      const preview = document.createElement("div");
      preview.style.cssText = "width:48px;height:48px;border:2px dashed #555;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#555;font-size:14px;font-weight:bold;overflow:hidden";
      preview.textContent = i + 1;
      preview.id = `portrait-preview-${i}`;
      previewsContainer.appendChild(preview);
    }
    overlay.appendChild(previewsContainer);

    document.body.appendChild(overlay);

    let startX = 0, startY = 0, endX = 0, endY = 0;
    let dragging = false;
    let hasSelection = false;

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    function updateBox() {
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const w = Math.abs(endX - startX);
      const h = Math.abs(endY - startY);

      box.style.left = x + "px";
      box.style.top = y + "px";
      box.style.width = w + "px";
      box.style.height = h + "px";

      // Mettre a jour les separateurs
      const colW = w / count;
      separators.forEach((sep, i) => {
        sep.style.display = w > 50 ? "block" : "none";
        sep.style.left = (colW * (i + 1)) + "px";
        sep.style.top = "0";
        sep.style.height = h + "px";
      });
    }

    function captureAllPortraits() {
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const w = Math.abs(endX - startX);
      const h = Math.abs(endY - startY);

      if (w < 50 || h < 20) return null;

      // Calculer les coordonnees dans l'image originale
      const scaleX = bgImage.naturalWidth / W;
      const scaleY = bgImage.naturalHeight / H;

      const srcX = x * scaleX;
      const srcY = y * scaleY;
      const srcW = w * scaleX;
      const srcH = h * scaleY;

      const colW = srcW / count;
      const portraits = [];

      // Decoupe en colonnes carrees (prendre la hauteur comme cote du carre)
      const squareSize = Math.min(colW, srcH);
      const outSize = Math.max(64, Math.round(squareSize));

      for (let i = 0; i < count; i++) {
        const portraitCanvas = document.createElement("canvas");
        portraitCanvas.width = outSize;
        portraitCanvas.height = outSize;
        const pCtx = portraitCanvas.getContext("2d");

        // Centrer le carre dans chaque colonne
        const colX = srcX + i * colW + (colW - squareSize) / 2;
        const colY = srcY + (srcH - squareSize) / 2;

        pCtx.drawImage(bgImage, colX, colY, squareSize, squareSize, 0, 0, outSize, outSize);

        portraits.push({ dataUrl: portraitCanvas.toDataURL("image/png") });
      }

      return portraits;
    }

    function updatePreviews(portraits) {
      portraits.forEach((p, i) => {
        const preview = document.getElementById(`portrait-preview-${i}`);
        if (preview && p.dataUrl) {
          preview.innerHTML = `<img src="${p.dataUrl}" style="width:100%;height:100%;object-fit:cover">`;
          preview.style.borderStyle = "solid";
          preview.style.borderColor = "#51cf66";
        }
      });
    }

    function finishCapture(portraits) {
      overlay.remove();

      if (portraits && portraits.length > 0) {
        ext.runtime.sendMessage({
          type: "MSF_PORTRAITS_CAPTURED",
          portraits: portraits
        });
        console.log(`[MSF] ${portraits.length} portraits captures`);
      } else {
        alert("Aucun portrait capture");
      }
    }

    overlay.addEventListener("mousedown", function(e) {
      if (e.target === info || e.target === previewsContainer) return;
      dragging = true;
      hasSelection = false;
      startX = clamp(e.clientX, 0, W);
      startY = clamp(e.clientY, 0, H);
      endX = startX;
      endY = startY;
      updateBox();
    });

    overlay.addEventListener("mousemove", function(e) {
      if (!dragging) return;
      endX = clamp(e.clientX, 0, W);
      endY = clamp(e.clientY, 0, H);
      updateBox();

      // Preview en temps reel
      if (Math.abs(endX - startX) > 50 && Math.abs(endY - startY) > 20) {
        const portraits = captureAllPortraits();
        if (portraits) {
          updatePreviews(portraits);
        }
      }
    });

    overlay.addEventListener("mouseup", function() {
      if (dragging && Math.abs(endX - startX) > 50 && Math.abs(endY - startY) > 20) {
        hasSelection = true;
      }
      dragging = false;
    });

    window.addEventListener("keydown", function handler(e) {
      if (e.key === "Escape") {
        window.removeEventListener("keydown", handler);
        overlay.remove();
      } else if (e.key === "Enter" && hasSelection) {
        window.removeEventListener("keydown", handler);
        const portraits = captureAllPortraits();
        finishCapture(portraits);
      }
    });
  }
}

window.startPortraitCapture = startPortraitCapture;

console.log("[MSF] Calibrateur pret - Tapez: startCropCalibrator()");