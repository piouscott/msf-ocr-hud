/**
 * War Analyzer Module
 * Detecte les equipes ennemies via OCR des noms de personnages
 * et suggere les counters appropries
 */

class WarAnalyzer {
  constructor() {
    this.ocrWorker = null;
    this.knownNames = [];
    this.nameToId = {};
    this.idToName = {}; // Reverse mapping charId -> name
    this.teamsData = [];
    this.countersData = {};
    this.warMetaTeams = [];
    this.portraitsDb = {}; // Hash -> charId mapping
    this.initialized = false;

    // Personnages "modificateurs" qui changent les counters d'une equipe
    // Format: charId (majuscules) -> suffixe pour l'ID de variante
    this.teamModifiers = {
      "ODIN": "odin",
      "SUPERSKRULL": "superskrull",
      "MEPHISTO": "mephisto",
      "DORMAMMU": "dormammu",
      "COSMICGHOSTRIDER": "cosmicghostrider",
      "PROFESSORX": "xavier",
      "PROFESSORXAVIER": "xavier",
      "TIGRA": "tigra",
      "MOCKINGBIRD": "tigra",
      "RONIN": "tigra",
      "FRANKLINRICHARDS": "franklin",
      "KNULL": "knull",
      "ARES": "ares",
      "BLACKKNIGHT": "blackknight",
      "DOOM": "doom",
      "KANG": "kang",
      "KANGTHECONQUEROR": "kang",
      "CAPTAINBRITAIN": "captainbritain",
      "APOCALYPSE": "apocalypse",
      "PHOENIXFORCE": "phoenixforce",
      "PHOENIX": "phoenixforce",
      "JEANGREY": "phoenixforce",
      "JEANGREY_PHOENIX": "phoenixforce"
    };
  }

  /**
   * Initialise le module (charge les donnees + OCR worker)
   */
  async init() {
    if (this.initialized) return;

    // Charger les noms connus pour OCR
    try {
      const namesUrl = typeof ext !== "undefined"
        ? ext.runtime.getURL("data/ocr-names.json")
        : "../data/ocr-names.json";
      const namesRes = await fetch(namesUrl);
      const namesData = await namesRes.json();
      this.knownNames = namesData.names || [];
      this.nameToId = namesData.nameToId || {};
      // Creer le reverse mapping
      for (const [name, charId] of Object.entries(this.nameToId)) {
        this.idToName[charId] = name;
      }
      console.log(`[WarAnalyzer] ${this.knownNames.length} noms charges`);
    } catch (e) {
      console.error("[WarAnalyzer] Erreur chargement noms:", e);
    }

    // Charger la base de portraits (hash -> nom/charId)
    try {
      const portraitsUrl = typeof ext !== "undefined"
        ? ext.runtime.getURL("data/portraits.json")
        : "../data/portraits.json";
      const portraitsRes = await fetch(portraitsUrl);
      const portraitsJson = await portraitsRes.json();
      this.portraitsDb = portraitsJson.portraits || {};
      console.log(`[WarAnalyzer] ${Object.keys(this.portraitsDb).length} portraits charges`);

      // Charger aussi les portraits depuis le storage local (ajouts utilisateur)
      if (typeof ext !== "undefined") {
        try {
          const stored = await ext.storage.local.get("msfPortraits");
          if (stored.msfPortraits) {
            Object.assign(this.portraitsDb, stored.msfPortraits);
            console.log(`[WarAnalyzer] +${Object.keys(stored.msfPortraits).length} portraits depuis storage`);
          }
        } catch (e) {
          console.log("[WarAnalyzer] Pas de portraits en storage");
        }
      }
    } catch (e) {
      console.error("[WarAnalyzer] Erreur chargement portraits:", e);
    }

    // Charger les equipes
    try {
      const teamsUrl = typeof ext !== "undefined"
        ? ext.runtime.getURL("data/teams.json")
        : "../data/teams.json";
      const teamsRes = await fetch(teamsUrl);
      const teamsJson = await teamsRes.json();
      this.teamsData = teamsJson.teams || [];
      console.log(`[WarAnalyzer] ${this.teamsData.length} equipes chargees`);
    } catch (e) {
      console.error("[WarAnalyzer] Erreur chargement equipes:", e);
    }

    // Charger les counters
    try {
      const countersUrl = typeof ext !== "undefined"
        ? ext.runtime.getURL("data/counters.json")
        : "../data/counters.json";
      const countersRes = await fetch(countersUrl);
      const countersJson = await countersRes.json();
      this.countersData = countersJson.counters || {};
      console.log(`[WarAnalyzer] ${Object.keys(this.countersData).length} counters charges`);
    } catch (e) {
      console.error("[WarAnalyzer] Erreur chargement counters:", e);
    }

    // Charger les equipes meta de guerre
    try {
      const warMetaUrl = typeof ext !== "undefined"
        ? ext.runtime.getURL("data/war-meta.json")
        : "../data/war-meta.json";
      const warMetaRes = await fetch(warMetaUrl);
      const warMetaJson = await warMetaRes.json();
      this.warMetaTeams = warMetaJson.teams || [];
      console.log(`[WarAnalyzer] ${this.warMetaTeams.length} equipes meta war chargees`);
    } catch (e) {
      console.error("[WarAnalyzer] Erreur chargement war-meta:", e);
    }

    // Initialiser Tesseract (optionnel - seulement pour analyse par noms)
    if (typeof Tesseract !== "undefined") {
      try {
        this.ocrWorker = await Tesseract.createWorker("eng+fra", 1, {
          workerBlobURL: false,
          corePath: typeof ext !== "undefined"
            ? ext.runtime.getURL("lib/tesseract/tesseract-core-simd.wasm.js")
            : "../lib/tesseract/tesseract-core-simd.wasm.js"
        });
        console.log("[WarAnalyzer] OCR worker initialise");
      } catch (e) {
        console.log("[WarAnalyzer] Tesseract non disponible (CSP ou autre), analyse par portraits uniquement");
        this.ocrWorker = null;
      }
    }

    this.initialized = true;
  }

  /**
   * Calcule la distance de Levenshtein
   */
  levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Trouve le meilleur match pour un nom OCR
   */
  findBestMatch(ocrName, threshold = 0.6) {
    if (!ocrName || this.knownNames.length === 0) return null;

    const normalized = ocrName.toUpperCase().trim();

    // Match exact
    if (this.knownNames.includes(normalized)) {
      return {
        name: normalized,
        charId: this.nameToId[normalized] || null,
        similarity: 100
      };
    }

    // Fuzzy matching
    let bestMatch = null;
    let bestScore = 0;

    for (const known of this.knownNames) {
      const distance = this.levenshtein(normalized, known);
      const maxLen = Math.max(normalized.length, known.length);
      const similarity = (maxLen - distance) / maxLen;

      if (similarity > bestScore && similarity >= threshold) {
        bestScore = similarity;
        bestMatch = {
          name: known,
          charId: this.nameToId[known] || null,
          similarity: Math.round(similarity * 100)
        };
      }
    }

    return bestMatch;
  }

  /**
   * Nettoie le texte OCR
   */
  cleanOCRText(text) {
    if (!text) return "";

    let clean = text.trim()
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[_|\\\/\[\]{}«»""]/g, "")
      .replace(/\s*[.,;:!?]+\s*$/g, "")
      .trim();

    // Corrections OCR courantes
    clean = clean
      .replace(/\bME\s*U\b/gi, "MCU")
      .replace(/\b0\b/g, "O")
      .replace(/\b1\b/g, "I")
      .replace(/\bll\b/gi, "II")
      .trim();

    clean = clean
      .replace(/^[^a-zA-Z(]+/, "")
      .replace(/[^a-zA-Z)]+$/, "")
      .trim();

    const letters = clean.replace(/[^a-zA-Z]/g, "");
    if (letters.length < 3) return "";

    return clean.toUpperCase();
  }

  /**
   * Preprocesse une image pour l'OCR (seuil adaptatif Otsu)
   */
  preprocessForOCR(canvas) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Histogramme
    const histogram = new Array(256).fill(0);
    const brightnesses = [];

    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      histogram[gray]++;
      brightnesses.push(gray);
    }

    const avgBrightness = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length;

    // Methode d'Otsu
    const total = brightnesses.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];

    let sumB = 0, wB = 0, maxVariance = 0, threshold = 128;

    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;

      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);

      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }

    if (avgBrightness < 80) {
      threshold = Math.max(60, threshold - 30);
    }

    const invert = avgBrightness < 100;

    for (let i = 0; i < data.length; i += 4) {
      let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (invert) gray = 255 - gray;
      gray = gray < threshold ? 0 : 255;
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Extrait le texte d'une zone d'image
   */
  async extractTextFromZone(imageDataUrl, zone) {
    if (!this.ocrWorker) {
      throw new Error("OCR worker non initialise");
    }

    // Creer un canvas pour la zone
    const img = await this.loadImage(imageDataUrl);
    const x = Math.floor(zone.x * img.width);
    const y = Math.floor(zone.y * img.height);
    const w = Math.floor(zone.w * img.width);
    const h = Math.floor(zone.h * img.height);

    // Agrandir 3x pour meilleur OCR
    const scale = 3;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, x, y, w, h, 0, 0, w * scale, h * scale);

    // Preprocesser
    this.preprocessForOCR(canvas);

    // OCR
    const { data: { text } } = await this.ocrWorker.recognize(canvas);
    return this.cleanOCRText(text);
  }

  /**
   * Charge une image depuis dataUrl
   */
  loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Analyse une liste de noms de personnages et identifie l'equipe
   */
  identifyTeamFromNames(characterNames) {
    if (!characterNames || characterNames.length === 0) {
      return null;
    }

    // Convertir les noms en IDs (via nameToId)
    const charIds = characterNames
      .map(name => this.nameToId[name.toUpperCase()])
      .filter(id => id);

    if (charIds.length < 3) {
      return { team: null, matchedMembers: characterNames, confidence: 0 };
    }

    // 1. Chercher d'abord dans les equipes definies (teams.json)
    let bestTeam = null;
    let bestMatchCount = 0;

    for (const team of this.teamsData) {
      if (!team.memberIds) continue;

      const matchCount = charIds.filter(id => team.memberIds.includes(id)).length;

      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestTeam = team;
      }
    }

    // 2. Si pas de match dans teams.json, chercher dans war-meta
    if (!bestTeam || bestMatchCount < 3) {
      let bestMetaTeam = null;
      let bestMetaMatchCount = 0;

      for (const metaTeam of this.warMetaTeams) {
        if (!metaTeam.squad) continue;

        const matchCount = charIds.filter(id => metaTeam.squad.includes(id)).length;

        if (matchCount > bestMetaMatchCount) {
          bestMetaMatchCount = matchCount;
          bestMetaTeam = metaTeam;
        }
      }

      // Utiliser le meta team si meilleur match
      if (bestMetaTeam && bestMetaMatchCount > bestMatchCount) {
        // Creer un objet team temporaire
        bestTeam = {
          id: "meta_" + bestMetaTeam.squad.join("_").substring(0, 30),
          name: bestMetaTeam.squad.slice(0, 3).join(" + ") + "...",
          memberIds: bestMetaTeam.squad,
          isMetaTeam: true,
          popularity: bestMetaTeam.popularity
        };
        bestMatchCount = bestMetaMatchCount;
      }
    }

    // Calculer la confiance
    const confidence = bestTeam
      ? Math.round((bestMatchCount / Math.min(5, charIds.length)) * 100)
      : 0;

    return {
      team: bestTeam,
      matchedMembers: characterNames,
      matchCount: bestMatchCount,
      confidence: confidence
    };
  }

  /**
   * Recupere les counters pour une equipe
   */
  getCountersForTeam(teamId, enemyPower = null) {
    if (!teamId || !this.countersData[teamId]) {
      return [];
    }

    const counters = this.countersData[teamId].map(counter => {
      const counterTeam = this.teamsData.find(t => t.id === counter.team);
      const minPower = enemyPower ? Math.round(enemyPower * (counter.minPowerRatio || 1)) : null;

      return {
        teamId: counter.team,
        teamName: counterTeam ? counterTeam.name : counter.team,
        confidence: counter.confidence,
        minPowerRatio: counter.minPowerRatio,
        minPower: minPower,
        notes: counter.notes || null
      };
    });

    return counters.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Recupere les counters en tenant compte des variantes d'equipe
   * @param {string} baseTeamId - ID de l'equipe de base
   * @param {string[]} charIds - CharIds detectes (pour detecter les modificateurs)
   * @param {number} enemyPower - Puissance ennemie (optionnel)
   * @returns {object} - { counters: [], variantUsed: string }
   */
  getCountersWithVariants(baseTeamId, charIds, enemyPower = null) {
    // Detecter toutes les variantes possibles
    const variants = this._detectTeamVariants(baseTeamId, charIds);

    // Chercher la premiere variante qui a des counters definis
    for (const variantId of variants) {
      if (this.countersData[variantId] && this.countersData[variantId].length > 0) {
        console.log(`[WarAnalyzer] Counters trouves pour variante: ${variantId}`);
        return {
          counters: this.getCountersForTeam(variantId, enemyPower),
          variantUsed: variantId,
          isVariant: variantId !== baseTeamId
        };
      }
    }

    // Aucun counter trouve
    console.log(`[WarAnalyzer] Aucun counter trouve pour ${baseTeamId} ni ses variantes`);
    return {
      counters: [],
      variantUsed: baseTeamId,
      isVariant: false
    };
  }

  /**
   * Analyse complete d'une equipe ennemie depuis des noms OCR
   */
  analyzeEnemyTeam(characterNames, enemyPower = null) {
    const teamResult = this.identifyTeamFromNames(characterNames);

    if (!teamResult.team) {
      return {
        identified: false,
        characters: characterNames,
        team: null,
        counters: [],
        message: "Equipe non identifiee"
      };
    }

    const counters = this.getCountersForTeam(teamResult.team.id, enemyPower);

    return {
      identified: true,
      characters: characterNames,
      team: {
        id: teamResult.team.id,
        name: teamResult.team.name,
        nameFr: teamResult.team.nameFr
      },
      matchConfidence: teamResult.confidence,
      counters: counters,
      message: `${teamResult.team.name} identifie (${teamResult.confidence}%)`
    };
  }

  /**
   * Analyse un screenshot de guerre avec zones configurees
   */
  async analyzeWarScreenshot(imageDataUrl, zones, onProgress = null) {
    await this.init();

    const results = [];

    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      if (onProgress) onProgress(`Analyse zone ${i + 1}/${zones.length}...`);

      try {
        // Extraire les noms de la zone (suppose 5 sous-zones pour les noms)
        const names = [];

        if (zone.nameZones) {
          // Si des sous-zones sont definies pour chaque nom
          for (const nameZone of zone.nameZones) {
            const text = await this.extractTextFromZone(imageDataUrl, nameZone);
            if (text) {
              const match = this.findBestMatch(text);
              if (match) {
                names.push(match.name);
              } else {
                names.push(text);
              }
            }
          }
        } else if (zone.fullTextZone) {
          // Zone de texte complete a parser
          const fullText = await this.extractTextFromZone(imageDataUrl, zone.fullTextZone);
          // Parser le texte pour extraire les noms (separes par newline ou autre)
          const lines = fullText.split(/[\n\r]+/).filter(l => l.trim());
          for (const line of lines) {
            const match = this.findBestMatch(line);
            if (match) {
              names.push(match.name);
            }
          }
        }

        // Analyser l'equipe
        const analysis = this.analyzeEnemyTeam(names, zone.power || null);
        results.push({
          zoneIndex: i,
          zoneName: zone.name || `Zone ${i + 1}`,
          ...analysis
        });

      } catch (e) {
        console.error(`[WarAnalyzer] Erreur zone ${i}:`, e);
        results.push({
          zoneIndex: i,
          zoneName: zone.name || `Zone ${i + 1}`,
          error: e.message
        });
      }
    }

    return results;
  }

  /**
   * Libere les ressources
   */
  async terminate() {
    if (this.ocrWorker) {
      await this.ocrWorker.terminate();
      this.ocrWorker = null;
    }
    this.initialized = false;
  }

  // ============================================
  // Identification par portraits (hash pHash)
  // ============================================

  /**
   * Calcule le hash perceptuel d'une image
   */
  async computePortraitHash(imageDataUrl) {
    const hashSize = 8;
    const sampleSize = 32;

    // Charger l'image dans un canvas
    const imageData = await this._getImageData(imageDataUrl, sampleSize);

    // Convertir en niveaux de gris
    const pixels = imageData.data;
    const gray = new Float32Array(sampleSize * sampleSize);
    for (let i = 0; i < gray.length; i++) {
      const offset = i * 4;
      gray[i] = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    }

    // Redimensionner en hashSize x hashSize
    const resized = new Float32Array(hashSize * hashSize);
    const blockW = sampleSize / hashSize;
    const blockH = sampleSize / hashSize;

    for (let y = 0; y < hashSize; y++) {
      for (let x = 0; x < hashSize; x++) {
        let sum = 0;
        let count = 0;
        const startY = Math.floor(y * blockH);
        const endY = Math.floor((y + 1) * blockH);
        const startX = Math.floor(x * blockW);
        const endX = Math.floor((x + 1) * blockW);

        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            sum += gray[py * sampleSize + px];
            count++;
          }
        }
        resized[y * hashSize + x] = count > 0 ? sum / count : 0;
      }
    }

    // Calculer le hash binaire base sur la mediane
    const sorted = [...resized].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    let binary = "";
    for (let i = 0; i < resized.length; i++) {
      binary += resized[i] > median ? "1" : "0";
    }

    // Convertir en hexadecimal
    let hex = "";
    for (let i = 0; i < binary.length; i += 4) {
      hex += parseInt(binary.substr(i, 4), 2).toString(16);
    }

    return hex;
  }

  /**
   * Helper: charge une image et retourne ses pixels
   * Applique un crop central de 60% pour ignorer les bordures UI du jeu
   */
  _getImageData(dataUrl, size) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      const timeout = setTimeout(() => {
        reject(new Error("Timeout chargement image (10s)"));
      }, 10000);

      img.onload = () => {
        clearTimeout(timeout);
        console.log("[WarAnalyzer] Image chargee:", img.width + "x" + img.height);

        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        // Crop central de 60% pour ignorer les bordures circulaires et UI
        const cropRatio = 0.6;
        const srcSize = Math.min(img.width, img.height);
        const cropSize = srcSize * cropRatio;
        const offsetX = (img.width - cropSize) / 2;
        const offsetY = (img.height - cropSize) / 2;

        ctx.drawImage(img, offsetX, offsetY, cropSize, cropSize, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size);
        resolve(data);
      };

      img.onerror = (e) => {
        clearTimeout(timeout);
        console.error("[WarAnalyzer] Erreur chargement image:", e);
        reject(new Error("Echec chargement image"));
      };

      console.log("[WarAnalyzer] Debut chargement image");
      img.src = dataUrl;
    });
  }

  /**
   * Calcule la distance de Hamming entre deux hash
   */
  hashDistance(hash1, hash2) {
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

  /**
   * Calcule la similarite entre deux hash (0-100%)
   */
  hashSimilarity(hash1, hash2) {
    const maxBits = hash1.length * 4; // 4 bits par caractere hex
    const dist = this.hashDistance(hash1, hash2);
    return Math.round((1 - dist / maxBits) * 100);
  }

  /**
   * Trouve le meilleur match pour un hash dans la base de portraits
   */
  findPortraitMatch(hash, threshold = 80) {
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const [dbHash, nameOrData] of Object.entries(this.portraitsDb)) {
      const sim = this.hashSimilarity(hash, dbHash);

      if (sim > bestSimilarity && sim >= threshold) {
        bestSimilarity = sim;

        // Le format peut etre soit une string (nom) soit un objet {name, charId}
        if (typeof nameOrData === "string") {
          bestMatch = {
            name: nameOrData,
            charId: this.nameToId[nameOrData.toUpperCase()] || null,
            similarity: sim,
            hash: dbHash
          };
        } else {
          bestMatch = {
            name: nameOrData.name || "Inconnu",
            charId: nameOrData.charId || null,
            similarity: sim,
            hash: dbHash
          };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Identifie une liste de portraits et retourne les personnages
   */
  async identifyPortraits(portraitDataUrls) {
    const identified = [];

    console.log(`[WarAnalyzer] Debut identification de ${portraitDataUrls.length} portraits`);

    for (let i = 0; i < portraitDataUrls.length; i++) {
      const dataUrl = portraitDataUrls[i];
      try {
        console.log(`[WarAnalyzer] Traitement portrait ${i + 1}/${portraitDataUrls.length}`);
        const hash = await this.computePortraitHash(dataUrl);
        console.log(`[WarAnalyzer] Hash calcule pour portrait ${i + 1}: ${hash}`);

        const match = this.findPortraitMatch(hash);

        if (match) {
          console.log(`[WarAnalyzer] Match trouve: ${match.name} (${match.similarity}%)`);
          identified.push({
            name: match.name,
            charId: match.charId,
            similarity: match.similarity,
            hash: hash
          });
        } else {
          console.log(`[WarAnalyzer] Aucun match pour portrait ${i + 1}`);
          identified.push({
            name: null,
            charId: null,
            similarity: 0,
            hash: hash
          });
        }
      } catch (e) {
        console.error(`[WarAnalyzer] Erreur hash portrait ${i + 1}:`, e);
        identified.push({
          name: null,
          charId: null,
          similarity: 0,
          hash: null,
          error: e.message
        });
      }
    }

    return identified;
  }

  /**
   * Identifie une equipe a partir de portraits (dataUrls)
   * et suggere les counters
   */
  async analyzeEnemyTeamFromPortraits(portraitDataUrls, enemyPower = null) {
    await this.init();

    // 1. Identifier les portraits
    const identifiedPortraits = await this.identifyPortraits(portraitDataUrls);

    // 2. Extraire les charIds identifies
    const charIds = identifiedPortraits
      .filter(p => p.charId)
      .map(p => p.charId);

    console.log("[WarAnalyzer] Portraits identifies:", identifiedPortraits.map(p => `${p.name} (charId: ${p.charId})`));
    console.log("[WarAnalyzer] CharIds pour recherche equipe:", charIds);

    // 3. Extraire les noms pour affichage
    const characterNames = identifiedPortraits.map(p => p.name || "?");

    if (charIds.length < 3) {
      return {
        identified: false,
        portraits: identifiedPortraits,
        characters: characterNames,
        team: null,
        counters: [],
        message: `Seulement ${charIds.length} personnages identifies (min 3 requis)`
      };
    }

    // 4. Identifier l'equipe via les charIds
    const teamResult = this._identifyTeamFromCharIds(charIds);

    if (!teamResult.team) {
      return {
        identified: false,
        portraits: identifiedPortraits,
        characters: characterNames,
        team: null,
        counters: [],
        message: "Equipe non identifiee"
      };
    }

    // 5. Recuperer les counters (avec detection des variantes)
    const countersResult = this.getCountersWithVariants(teamResult.team.id, charIds, enemyPower);

    // Construire le nom de la variante si applicable
    let variantName = teamResult.team.name;
    if (countersResult.isVariant) {
      // Extraire les modificateurs du nom de variante
      const mods = countersResult.variantUsed.replace(teamResult.team.id + "_", "").split("_");
      const modNames = mods.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(" + ");
      variantName = `${teamResult.team.name} + ${modNames}`;
    }

    return {
      identified: true,
      portraits: identifiedPortraits,
      characters: characterNames,
      team: {
        id: teamResult.team.id,
        name: teamResult.team.name,
        nameFr: teamResult.team.nameFr,
        variantId: countersResult.variantUsed,
        variantName: variantName
      },
      matchConfidence: teamResult.confidence,
      matchCount: teamResult.matchCount,
      counters: countersResult.counters,
      message: `${variantName} identifie (${teamResult.confidence}%)`
    };
  }

  /**
   * Identifie une equipe a partir de charIds (interne)
   */
  _identifyTeamFromCharIds(charIds) {
    if (charIds.length < 3) {
      return { team: null, matchCount: 0, confidence: 0 };
    }

    // Normaliser les charIds en majuscules pour comparaison
    const normalizedCharIds = charIds.map(id => id.toUpperCase());

    // 1. Chercher dans teams.json
    let bestTeam = null;
    let bestMatchCount = 0;

    for (const team of this.teamsData) {
      if (!team.memberIds) continue;

      // Normaliser les memberIds de l'équipe
      const normalizedMemberIds = team.memberIds.map(id => id.toUpperCase());
      const matchCount = normalizedCharIds.filter(id => normalizedMemberIds.includes(id)).length;

      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestTeam = team;
      }
    }

    // 2. Chercher dans war-meta si pas de bon match
    if (!bestTeam || bestMatchCount < 3) {
      let bestMetaTeam = null;
      let bestMetaMatchCount = 0;

      for (const metaTeam of this.warMetaTeams) {
        if (!metaTeam.squad) continue;

        // Normaliser les IDs du squad
        const normalizedSquad = metaTeam.squad.map(id => id.toUpperCase());
        const matchCount = normalizedCharIds.filter(id => normalizedSquad.includes(id)).length;

        if (matchCount > bestMetaMatchCount) {
          bestMetaMatchCount = matchCount;
          bestMetaTeam = metaTeam;
        }
      }

      if (bestMetaTeam && bestMetaMatchCount > bestMatchCount) {
        bestTeam = {
          id: "meta_" + bestMetaTeam.squad.join("_").substring(0, 30),
          name: bestMetaTeam.squad.slice(0, 3).map(id => this.idToName[id] || id).join(" + ") + "...",
          memberIds: bestMetaTeam.squad,
          isMetaTeam: true,
          popularity: bestMetaTeam.popularity
        };
        bestMatchCount = bestMetaMatchCount;
      }
    }

    const confidence = bestTeam
      ? Math.round((bestMatchCount / Math.min(5, charIds.length)) * 100)
      : 0;

    // Rejeter si moins de 3 matches (60% minimum pour 5 persos)
    if (bestMatchCount < 3) {
      console.log(`[WarAnalyzer] Match insuffisant: ${bestMatchCount}/5 (${confidence}%) pour ${bestTeam?.name || 'aucune'}`);
      return {
        team: null,
        matchCount: bestMatchCount,
        confidence: 0
      };
    }

    return {
      team: bestTeam,
      matchCount: bestMatchCount,
      confidence: confidence
    };
  }

  /**
   * Detecte la variante d'une equipe en fonction des modificateurs presents
   * @param {string} baseTeamId - ID de l'equipe de base (ex: "absoluteaforce")
   * @param {string[]} charIds - Liste des charIds detectes
   * @returns {string[]} - Liste des IDs de variantes possibles (du plus specifique au plus general)
   */
  _detectTeamVariants(baseTeamId, charIds) {
    const normalizedIds = charIds.map(id => id.toUpperCase());
    const modifiersFound = new Set();

    // Detecter les modificateurs presents
    for (const [charId, suffix] of Object.entries(this.teamModifiers)) {
      if (normalizedIds.includes(charId)) {
        modifiersFound.add(suffix);
      }
    }

    const modifiersArray = Array.from(modifiersFound).sort();
    const variants = [];

    // Generer toutes les combinaisons de variantes (du plus specifique au moins specifique)
    if (modifiersArray.length > 0) {
      // Variante complete (tous les modificateurs)
      variants.push(baseTeamId + "_" + modifiersArray.join("_"));

      // Variantes partielles (combinaisons de 2 modificateurs)
      if (modifiersArray.length >= 2) {
        for (let i = 0; i < modifiersArray.length; i++) {
          for (let j = i + 1; j < modifiersArray.length; j++) {
            variants.push(baseTeamId + "_" + modifiersArray[i] + "_" + modifiersArray[j]);
          }
        }
      }

      // Variantes avec un seul modificateur
      for (const mod of modifiersArray) {
        variants.push(baseTeamId + "_" + mod);
      }
    }

    // Toujours ajouter l'equipe de base en dernier (fallback)
    variants.push(baseTeamId);

    console.log(`[WarAnalyzer] Variantes detectees pour ${baseTeamId}:`, variants);
    return variants;
  }

  /**
   * Sauvegarde un nouveau portrait dans le storage
   */
  async savePortrait(hash, name, charId = null) {
    if (typeof ext === "undefined") return false;

    try {
      const stored = await ext.storage.local.get("msfPortraits");
      const portraits = stored.msfPortraits || {};

      portraits[hash] = charId ? { name, charId } : name;

      await ext.storage.local.set({ msfPortraits: portraits });

      // Mettre a jour la base locale
      this.portraitsDb[hash] = portraits[hash];

      console.log(`[WarAnalyzer] Portrait sauvegarde: ${name} (${hash})`);
      return true;
    } catch (e) {
      console.error("[WarAnalyzer] Erreur sauvegarde portrait:", e);
      return false;
    }
  }
}

// Export global
if (typeof window !== "undefined") {
  window.WarAnalyzer = WarAnalyzer;
}
