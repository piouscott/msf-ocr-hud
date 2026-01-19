/**
 * pHash - Hash perceptuel pour identification des portraits
 * Permet de comparer des images meme avec des variations mineures
 */
class PerceptualHash {
  constructor() {
    this.hashSize = 8; // 8x8 = 64 bits
    this.sampleSize = 32; // Redimensionnement intermediaire
  }

  /**
   * Calcule le hash perceptuel d'une image
   * @param {string} imageDataUrl - Data URL de l'image
   * @returns {Promise<string>} Hash hexadecimal (16 caracteres)
   */
  async compute(imageDataUrl) {
    const imageData = await this.getImageData(imageDataUrl);
    const grayscale = this.toGrayscale(imageData);
    const resized = this.resize(grayscale, imageData.width, imageData.height);
    const dct = this.computeDCT(resized);
    const hash = this.computeHash(dct);
    return hash;
  }

  /**
   * Charge une image et retourne ses donnees pixel
   */
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

  /**
   * Convertit en niveaux de gris
   */
  toGrayscale(imageData) {
    const pixels = imageData.data;
    const gray = new Float32Array(this.sampleSize * this.sampleSize);

    for (let i = 0; i < gray.length; i++) {
      const offset = i * 4;
      // Luminance (formule standard)
      gray[i] = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    }

    return gray;
  }

  /**
   * Redimensionne a la taille du hash (moyenne par bloc)
   */
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

  /**
   * Calcule DCT simplifiee (moyenne seulement, pas de vraie DCT)
   * Pour une implementation plus robuste, on utilise juste la moyenne
   */
  computeDCT(pixels) {
    // Simplification : on retourne directement les pixels normalises
    // Une vraie implementation utiliserait la DCT-II
    return pixels;
  }

  /**
   * Calcule le hash binaire base sur la mediane
   */
  computeHash(values) {
    // Calculer la mediane
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // Construire le hash : 1 si > mediane, 0 sinon
    let hash = "";
    for (let i = 0; i < values.length; i++) {
      hash += values[i] > median ? "1" : "0";
    }

    // Convertir en hexadecimal
    return this.binaryToHex(hash);
  }

  /**
   * Convertit une chaine binaire en hexadecimal
   */
  binaryToHex(binary) {
    let hex = "";
    for (let i = 0; i < binary.length; i += 4) {
      const nibble = binary.substr(i, 4);
      hex += parseInt(nibble, 2).toString(16);
    }
    return hex;
  }

  /**
   * Calcule la distance de Hamming entre deux hash
   * @returns {number} Nombre de bits differents (0 = identique)
   */
  distance(hash1, hash2) {
    if (hash1.length !== hash2.length) {
      return Infinity;
    }

    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      const n1 = parseInt(hash1[i], 16);
      const n2 = parseInt(hash2[i], 16);
      // Compter les bits differents
      let xor = n1 ^ n2;
      while (xor) {
        distance += xor & 1;
        xor >>= 1;
      }
    }

    return distance;
  }

  /**
   * Calcule la similarite entre deux hash (0-100%)
   */
  similarity(hash1, hash2) {
    const maxBits = hash1.length * 4; // 4 bits par caractere hex
    const dist = this.distance(hash1, hash2);
    return Math.round((1 - dist / maxBits) * 100);
  }

  /**
   * Trouve le meilleur match dans une base de donnees
   * @param {string} hash - Hash a chercher
   * @param {Object} database - {hash: name, ...}
   * @param {number} threshold - Seuil de similarite minimum (defaut 75%)
   * @returns {{name: string, similarity: number} | null}
   */
  findMatch(hash, database, threshold = 75) {
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const [dbHash, name] of Object.entries(database)) {
      const sim = this.similarity(hash, dbHash);
      if (sim > bestSimilarity && sim >= threshold) {
        bestSimilarity = sim;
        bestMatch = { name, similarity: sim, hash: dbHash };
      }
    }

    return bestMatch;
  }
}

// Export global
window.PerceptualHash = PerceptualHash;
