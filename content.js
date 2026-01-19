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

    return {
      slotNumber,
      team_power: this.cropZone(img, zones.team_power),
      team_full: this.cropZone(img, zones.team_full),
      portraits: [
        this.cropZone(img, zones.portrait_1),
        this.cropZone(img, zones.portrait_2),
        this.cropZone(img, zones.portrait_3),
        this.cropZone(img, zones.portrait_4),
        this.cropZone(img, zones.portrait_5)
      ]
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

    // Injecter Tesseract.js dans la page si pas deja present
    if (!window.Tesseract) {
      await this.injectTesseract();
    }

    this.worker = await window.Tesseract.createWorker({
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

  async injectTesseract() {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = ext.runtime.getURL("lib/tesseract/tesseract.min.js");
      script.onload = () => {
        console.log("[OCR] Tesseract.js injecte");
        resolve();
      };
      script.onerror = () => reject(new Error("Echec injection Tesseract.js"));
      document.head.appendChild(script);
    });
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

  // 2. Charger la config des zones
  const configUrl = ext.runtime.getURL("msf-zones-config.json");
  const cropper = await ZoneCropper.loadConfig(configUrl);
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
    const power = await ocr.extractPower(slot.team_power);
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
// Calibrateur de zones
// ============================================

function startCropCalibrator(options) {
  options = options || {};
  const label = options.label || "CROP";
  const showGrid = options.showGrid || false;

  const overlay = document.createElement("div");
  overlay.id = "msf-calib";
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.05)";
  document.body.appendChild(overlay);

  if (showGrid) {
    const grid = document.createElement("div");
    grid.style.cssText = "position:absolute;inset:0;background-image:repeating-linear-gradient(0deg,transparent,transparent 49px,rgba(0,229,255,0.15) 49px,rgba(0,229,255,0.15) 50px),repeating-linear-gradient(90deg,transparent,transparent 49px,rgba(0,229,255,0.15) 49px,rgba(0,229,255,0.15) 50px);pointer-events:none";
    overlay.appendChild(grid);
  }

  const box = document.createElement("div");
  box.style.cssText = "position:absolute;border:2px solid #0ff;background:rgba(0,255,255,0.1);box-sizing:border-box;box-shadow:0 0 0 9999px rgba(0,0,0,0.3)";
  overlay.appendChild(box);

  const info = document.createElement("pre");
  info.style.cssText = "position:fixed;right:16px;bottom:16px;background:rgba(0,0,0,0.9);color:#fff;padding:12px;border-radius:8px;font:12px monospace;margin:0;cursor:pointer;user-select:none";
  info.textContent = "Drag to select. ESC to quit.";
  overlay.appendChild(info);

  let startX = 0;
  let startY = 0;
  let dragging = false;
  const W = window.innerWidth;
  const H = window.innerHeight;

  function clamp(v, min, max) {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function updateInfo(x, y, w, h) {
    const rx = x / W;
    const ry = y / H;
    const rw = w / W;
    const rh = h / H;
    info.textContent = label + "\nPixels: " + x + "," + y + " " + w + "x" + h + "\n{ x: " + rx.toFixed(4) + ", y: " + ry.toFixed(4) + ", w: " + rw.toFixed(4) + ", h: " + rh.toFixed(4) + " }";
  }

  overlay.addEventListener("mousedown", function(e) {
    if (e.target === info) return;
    dragging = true;
    startX = clamp(e.clientX, 0, W);
    startY = clamp(e.clientY, 0, H);
    box.style.left = startX + "px";
    box.style.top = startY + "px";
    box.style.width = "0px";
    box.style.height = "0px";
    updateInfo(startX, startY, 0, 0);
  });

  overlay.addEventListener("mousemove", function(e) {
    if (!dragging) return;
    const curX = clamp(e.clientX, 0, W);
    const curY = clamp(e.clientY, 0, H);
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    box.style.left = x + "px";
    box.style.top = y + "px";
    box.style.width = w + "px";
    box.style.height = h + "px";
    updateInfo(x, y, w, h);
  });

  overlay.addEventListener("mouseup", function() {
    dragging = false;
  });

  window.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      overlay.remove();
    }
  });

  updateInfo(0, 0, 0, 0);
}

window.startCropCalibrator = startCropCalibrator;

console.log("[MSF] Calibrateur pret - Tapez: startCropCalibrator({showGrid:true})");