/**
 * ZoneCropper - Decoupe les zones d'une image selon config normalisee
 * Adapte automatiquement les zones au ratio d'ecran (letterboxing)
 * Supporte des jeux de coordonnees par position (Position 1/Position 2/Custom)
 */
class ZoneCropper {
  constructor(config) {
    this.referenceAspect = config.reference?.aspectRatio || (16 / 9);

    // slots peut etre un objet {position1: [...], position2: [...]} ou un tableau (ancien format)
    if (Array.isArray(config.slots)) {
      // Ancien format : tableau unique
      this.slotsByLang = { "default": config.slots };
      this.currentLang = "default";
      this.defaultLang = "default";
    } else {
      // Nouveau format : objet keyed par position
      this.slotsByLang = config.slots;
      // Position par defaut = premiere cle disponible
      this.defaultLang = Object.keys(config.slots)[0] || "position1";
      this.currentLang = this.defaultLang;
    }

    this.slots = this.slotsByLang[this.currentLang];
  }

  /**
   * Definit la position pour selectionner le bon jeu de coordonnees
   * @param {string} position - Cle de position ("position1", "position2", "custom")
   */
  setLanguage(position) {
    if (position && this.slotsByLang[position]) {
      this.currentLang = position;
    } else {
      this.currentLang = this.defaultLang;
    }
    this.slots = this.slotsByLang[this.currentLang];
    console.log(`[ZoneCropper] Position "${this.currentLang}" → ${this.slots.length} slots charges`);
  }

  /**
   * Charge la config depuis une URL
   * @param {string} url - URL du fichier JSON
   * @returns {Promise<ZoneCropper>}
   */
  static async loadConfig(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Impossible de charger la config: ${response.status}`);
    }
    const config = await response.json();
    return new ZoneCropper(config);
  }

  /**
   * Charge la config avec support calibration utilisateur (storage > JSON bundle)
   * @param {string} url - URL du fichier JSON bundled
   * @param {Function} storageGetFn - Function(key) => Promise<Object>
   * @returns {Promise<ZoneCropper>}
   */
  static async loadConfigWithStorage(url, storageGetFn) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Impossible de charger la config: ${response.status}`);
    const config = await response.json();

    try {
      const result = await storageGetFn("msfCustomZoneCalibration");
      const custom = result.msfCustomZoneCalibration;
      if (custom && custom.slots && custom.slots.custom) {
        if (!Array.isArray(config.slots)) {
          config.slots.custom = custom.slots.custom;
        }
        console.log("[ZoneCropper] Calibration utilisateur chargee depuis storage");
      }
    } catch (e) {
      // Pas de calibration custom — fallback sur JSON bundle
    }

    return new ZoneCropper(config);
  }

  /**
   * Calcule la zone de jeu dans le screenshot
   * MSF web remplit toute la fenetre (pas de letterboxing), donc on utilise
   * toujours les dimensions completes du screenshot
   * @param {number} imgWidth - Largeur du screenshot
   * @param {number} imgHeight - Hauteur du screenshot
   * @returns {Object} {x, y, w, h} zone de jeu en pixels
   */
  getGameArea(imgWidth, imgHeight) {
    const actualAspect = imgWidth / imgHeight;
    console.log(`[ZoneCropper] Screenshot ${imgWidth}x${imgHeight} (ratio ${actualAspect.toFixed(3)}, ref ${this.referenceAspect.toFixed(3)})`);
    return { x: 0, y: 0, w: imgWidth, h: imgHeight };
  }

  /**
   * Crop une zone specifique d'une image
   * Les coordonnees normalisees sont relatives a la zone de jeu (pas au screenshot entier)
   * @param {HTMLImageElement} img - Image source
   * @param {Object} zone - {x, y, w, h} en coordonnees normalisees (0-1)
   * @param {Object} [gameArea] - Zone de jeu pre-calculee (optionnel, pour eviter de recalculer)
   * @returns {string} Data URL de la zone croppee
   */
  cropZone(img, zone, gameArea) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const game = gameArea || this.getGameArea(img.naturalWidth, img.naturalHeight);

    // Coordonnees en pixels relatives a la zone de jeu
    const px = Math.floor(zone.x * game.w + game.x);
    const py = Math.floor(zone.y * game.h + game.y);
    const pw = Math.floor(zone.w * game.w);
    const ph = Math.floor(zone.h * game.h);

    canvas.width = pw;
    canvas.height = ph;

    ctx.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);

    return canvas.toDataURL("image/png");
  }

  /**
   * Extrait toutes les zones pour un slot
   * @param {HTMLImageElement} img - Image source
   * @param {number} slotNumber - Numero du slot (1-4)
   * @returns {Object} {slotNumber, team_power, portraits: [...]}
   */
  extractSlot(img, slotNumber) {
    const slot = this.slots.find(s => s.slotNumber === slotNumber);
    if (!slot) {
      throw new Error(`Slot ${slotNumber} non trouve dans la config`);
    }

    const zones = slot.zones;
    // Calculer la game area une seule fois pour tout le slot
    const gameArea = this.getGameArea(img.naturalWidth, img.naturalHeight);

    return {
      slotNumber,
      team_power: this.cropZone(img, zones.team_power, gameArea),
      team_full: this.cropZone(img, zones.team_full, gameArea),
      portraits: [
        this.cropZone(img, zones.portrait_1, gameArea),
        this.cropZone(img, zones.portrait_2, gameArea),
        this.cropZone(img, zones.portrait_3, gameArea),
        this.cropZone(img, zones.portrait_4, gameArea),
        this.cropZone(img, zones.portrait_5, gameArea)
      ]
    };
  }

  /**
   * Extrait tous les slots
   * @param {HTMLImageElement} img - Image source
   * @returns {Array} Liste des slots extraits
   */
  extractAllSlots(img) {
    return this.slots.map(slot => this.extractSlot(img, slot.slotNumber));
  }
}

// Export global
window.ZoneCropper = ZoneCropper;
