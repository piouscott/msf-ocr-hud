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
      corePath: options.corePath || "lib/tesseract/core/tesseract-core-simd.wasm.js",
      lang: options.lang || "eng"
    };
  }

  /**
   * Initialise le worker Tesseract (appeler une fois)
   */
  async init() {
    if (this.initialized) return;

    const ext = typeof browser !== "undefined" ? browser : chrome;

    console.log("[OCR] Initialisation du worker...");

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
   * Extrait un nombre de puissance (format X,XXX,XXX)
   * @param {string} imageDataUrl - Data URL de la zone puissance
   * @returns {Promise<number|null>} Puissance en nombre ou null si echec
   */
  async extractPower(imageDataUrl) {
    const text = await this.recognize(imageDataUrl);
    console.log("[OCR] Texte brut:", text);

    // Pattern: cherche des nombres avec virgules, points ou espaces
    // Ex: "3,986,869" ou "3.986.869" ou "3 986 869" ou "+10 PTS 3,986,869"
    const matches = text.match(/[\d,.\s]+/g);

    if (matches) {
      // Nettoyer et filtrer les candidats
      const candidates = matches
        .map(m => m.replace(/[,.\s]/g, "")) // Supprimer separateurs
        .filter(m => /^\d+$/.test(m) && m.length >= 5); // Au moins 100K

      if (candidates.length > 0) {
        // Trier par longueur decroissante (le plus grand nombre)
        candidates.sort((a, b) => b.length - a.length);
        const power = parseInt(candidates[0], 10);
        console.log("[OCR] Puissance extraite:", power);
        return power;
      }
    }

    console.log("[OCR] Aucune puissance trouvee");
    return null;
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
