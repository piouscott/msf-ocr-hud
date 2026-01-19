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

  async extractPower(imageDataUrl) {
    const text = await this.recognize(imageDataUrl);
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

  // 4. Initialiser OCR
  const ocr = new OCREngine();
  await ocr.init();

  // 5. Extraire les puissances pour chaque slot
  const results = [];
  for (const slot of slotData) {
    console.log("[MSF] OCR slot", slot.slotNumber);
    let power = null;
    if (slot.team_power) {
      power = await ocr.extractPower(slot.team_power);
    }
    results.push({
      slotNumber: slot.slotNumber,
      power: power,
      portraits: slot.portraits
    });
  }

  // 6. Cleanup
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

console.log("[MSF] Calibrateur pret - Tapez: startCropCalibrator()");