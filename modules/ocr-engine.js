/**
 * OCREngine - Wrapper Tesseract.js reutilisable
 */
class OCREngine {
  constructor(options = {}) {
    this.worker = null;
    this.initialized = false;
    this.options = {
      workerPath: options.workerPath || "lib/tesseract/worker.min.js",
      langPath: options.langPath || "lib/tesseract/lang/",
      corePath: options.corePath || "lib/tesseract/core/tesseract-core-simd-lstm.wasm.js",
      lang: options.lang || "eng"
    };
  }

  /**
   * Initialise le worker Tesseract (auto-detect v2/v4 + fallback core)
   */
  async init() {
    if (this.initialized) return;

    const ext = typeof browser !== "undefined" ? browser : chrome;

    const workerUrl = ext.runtime.getURL(this.options.workerPath);
    const langUrl = ext.runtime.getURL(this.options.langPath);
    const lang = this.options.lang;

    // Cores a essayer dans l'ordre (SIMD-LSTM, LSTM, SIMD, basique)
    const coreCandidates = [
      "lib/tesseract/core/tesseract-core-simd-lstm.wasm.js",
      "lib/tesseract/core/tesseract-core-lstm.wasm.js",
      "lib/tesseract/core/tesseract-core-simd.wasm.js",
      "lib/tesseract/core/tesseract-core.wasm.js"
    ];

    const workerOpts = (coreUrl) => ({
      workerPath: workerUrl,
      langPath: langUrl,
      corePath: coreUrl,
      workerBlobURL: false,
      logger: (m) => {
        console.log(`[OCR] ${m.status || "?"}: ${Math.round((m.progress || 0) * 100)}%`);
      }
    });

    console.log("[OCR] Tesseract keys:", Object.keys(Tesseract).join(", "));
    console.log("[OCR] Paths:", { workerUrl, langUrl, lang });

    for (const corePath of coreCandidates) {
      const coreUrl = ext.runtime.getURL(corePath);
      const coreShort = corePath.split("/").pop();

      // Essai 1 : API v4 — createWorker(lang, oem, options)
      try {
        console.log(`[OCR] Essai v4 + ${coreShort}...`);
        this.worker = await Tesseract.createWorker(lang, 1, workerOpts(coreUrl));
        this.initialized = true;
        console.log(`[OCR] Worker pret (v4, ${coreShort})`);
        return;
      } catch (e1) {
        console.warn(`[OCR] v4 + ${coreShort} echoue:`, String(e1));
      }

      // Essai 2 : API v2 — createWorker(options), puis loadLanguage + initialize
      try {
        console.log(`[OCR] Essai v2 + ${coreShort}...`);
        this.worker = await Tesseract.createWorker(workerOpts(coreUrl));
        await this.worker.loadLanguage(lang);
        await this.worker.initialize(lang);
        this.initialized = true;
        console.log(`[OCR] Worker pret (v2, ${coreShort})`);
        return;
      } catch (e2) {
        console.warn(`[OCR] v2 + ${coreShort} echoue:`, String(e2));
        if (this.worker) {
          try { await this.worker.terminate(); } catch (_) {}
          this.worker = null;
        }
      }
    }

    throw new Error("OCR init: aucune combinaison API/core n'a fonctionne");
  }

  /**
   * Reconnait le texte d'une image
   * @param {string|HTMLCanvasElement|HTMLImageElement} image
   * @returns {Promise<string>} Texte reconnu
   */
  async recognize(image) {
    if (!this.initialized) {
      await this.init();
    }

    const { data: { text } } = await this.worker.recognize(image);
    return text.trim();
  }

  /**
   * Pretraitement : agrandir 4x + inverser (texte clair sur fond sombre → noir sur blanc)
   * Tesseract fonctionne mieux avec texte noir sur fond clair
   * @param {string} imageDataUrl - Data URL source
   * @returns {Promise<string>} Data URL preprocessee
   */
  preprocessImage(imageDataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = 4;
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
          d[i] = d[i+1] = d[i+2] = 255 - gray;
        }
        ctx.putImageData(imageData, 0, 0);

        resolve(canvas.toDataURL("image/png"));
      };
      img.src = imageDataUrl;
    });
  }

  /**
   * Extrait un nombre de puissance avec preprocessing et debug info
   * @param {string} imageDataUrl - Data URL de la zone puissance
   * @returns {Promise<{power: number|null, rawText: string}>}
   */
  async extractPowerWithDebug(imageDataUrl) {
    const processedImage = await this.preprocessImage(imageDataUrl);
    const rawText = await this.recognize(processedImage);
    console.log("[OCR] Texte brut:", JSON.stringify(rawText));

    const matches = rawText.match(/[\d,.\s]+/g);

    if (matches) {
      const candidates = matches
        .map(m => m.replace(/[,.\s]/g, ""))
        .filter(m => /^\d+$/.test(m) && m.length >= 5)
        .map(m => parseInt(m, 10));

      if (candidates.length > 0) {
        candidates.sort((a, b) => b - a);
        const power = candidates[0];
        console.log("[OCR] Puissance extraite:", power, "(candidates:", candidates.join(", ") + ")");
        return { power, rawText };
      }
    }

    console.log("[OCR] Aucune puissance trouvee");
    return { power: null, rawText };
  }

  /**
   * Extrait un nombre de puissance (format X,XXX,XXX)
   * @param {string} imageDataUrl - Data URL de la zone puissance
   * @returns {Promise<number|null>} Puissance en nombre ou null si echec
   */
  async extractPower(imageDataUrl) {
    const result = await this.extractPowerWithDebug(imageDataUrl);
    return result.power;
  }

  /**
   * Libere les ressources
   */
  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      console.log("[OCR] Worker termine");
    }
  }
}

// Export global
window.OCREngine = OCREngine;
