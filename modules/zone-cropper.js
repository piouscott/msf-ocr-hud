/**
 * ZoneCropper - Decoupe les zones d'une image selon config normalisee
 * Adapte automatiquement les zones au ratio d'ecran (letterboxing)
 */
class ZoneCropper {
  constructor(config) {
    this.slots = config.slots;
    this.referenceAspect = config.reference?.aspectRatio || (16 / 9);
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
   * Calcule la zone de jeu dans le screenshot en fonction du ratio
   * Le jeu MSF maintient un ratio 16:9 ; si la fenetre a un ratio different,
   * le contenu est centre avec du letterboxing
   * @param {number} imgWidth - Largeur du screenshot
   * @param {number} imgHeight - Hauteur du screenshot
   * @returns {Object} {x, y, w, h} zone de jeu en pixels
   */
  getGameArea(imgWidth, imgHeight) {
    const actualAspect = imgWidth / imgHeight;
    const tolerance = 0.02;

    if (Math.abs(actualAspect - this.referenceAspect) < tolerance) {
      return { x: 0, y: 0, w: imgWidth, h: imgHeight };
    }

    if (actualAspect > this.referenceAspect) {
      // Plus large que 16:9 → bandes noires gauche/droite
      const gameHeight = imgHeight;
      const gameWidth = Math.round(gameHeight * this.referenceAspect);
      const offsetX = Math.round((imgWidth - gameWidth) / 2);
      console.log(`[ZoneCropper] Ratio ${actualAspect.toFixed(3)} > ref ${this.referenceAspect.toFixed(3)} → bandes laterales, offsetX=${offsetX}px`);
      return { x: offsetX, y: 0, w: gameWidth, h: gameHeight };
    } else {
      // Plus etroit que 16:9 → bandes noires haut/bas
      const gameWidth = imgWidth;
      const gameHeight = Math.round(gameWidth / this.referenceAspect);
      const offsetY = Math.round((imgHeight - gameHeight) / 2);
      console.log(`[ZoneCropper] Ratio ${actualAspect.toFixed(3)} < ref ${this.referenceAspect.toFixed(3)} → bandes haut/bas, offsetY=${offsetY}px`);
      return { x: 0, y: offsetY, w: gameWidth, h: gameHeight };
    }
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
