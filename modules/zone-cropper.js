/**
 * ZoneCropper - Decoupe les zones d'une image selon config normalisee
 */
class ZoneCropper {
  constructor(config) {
    this.slots = config.slots;
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
   * Crop une zone specifique d'une image
   * @param {HTMLImageElement} img - Image source
   * @param {Object} zone - {x, y, w, h} en coordonnees normalisees (0-1)
   * @returns {string} Data URL de la zone croppee
   */
  cropZone(img, zone) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // Convertir coordonnees normalisees en pixels
    const px = Math.floor(zone.x * img.naturalWidth);
    const py = Math.floor(zone.y * img.naturalHeight);
    const pw = Math.floor(zone.w * img.naturalWidth);
    const ph = Math.floor(zone.h * img.naturalHeight);

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
