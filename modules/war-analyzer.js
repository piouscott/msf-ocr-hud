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
    this.portraitsDb = {}; // charId -> { name, hash, hist } mapping
    this.hashIndex = {}; // hash -> charId for quick lookups
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

    // Charger la base de portraits (charId -> { name, hash, hist })
    try {
      const portraitsUrl = typeof ext !== "undefined"
        ? ext.runtime.getURL("data/portraits.json")
        : "../data/portraits.json";
      const portraitsRes = await fetch(portraitsUrl);
      const portraitsJson = await portraitsRes.json();
      this.portraitsDb = portraitsJson.portraits || {};
      this.hashIndex = portraitsJson.hashIndex || {};
      console.log(`[WarAnalyzer] ${Object.keys(this.portraitsDb).length} portraits charges (v${portraitsJson.version || 1})`);

      // Charger aussi les portraits depuis le storage local (ajouts utilisateur)
      if (typeof ext !== "undefined") {
        try {
          const stored = await ext.storage.local.get("msfPortraits");
          if (stored.msfPortraits) {
            // Fusionner avec la base (ancien format: hash -> {name, charId})
            for (const [hash, data] of Object.entries(stored.msfPortraits)) {
              const charId = data.charId || data;
              if (charId && !this.portraitsDb[charId]) {
                this.portraitsDb[charId] = { name: data.name || charId, hash: hash };
                this.hashIndex[hash] = charId;
              }
            }
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

    // Dedupliquer : garder la meilleure confidence par equipe, fusionner les notes
    const deduped = new Map();
    for (const c of counters) {
      const existing = deduped.get(c.teamId);
      if (!existing) {
        deduped.set(c.teamId, { ...c, altNotes: [] });
      } else {
        // Garder la meilleure confidence
        if (c.confidence > existing.confidence) {
          if (existing.notes) existing.altNotes.push(`(${existing.confidence}%) ${existing.notes}`);
          existing.confidence = c.confidence;
          if (c.notes) {
            existing.altNotes.push(existing.notes);
            existing.notes = c.notes;
          }
        } else if (c.notes && c.notes !== existing.notes) {
          existing.altNotes.push(`(${c.confidence}%) ${c.notes}`);
        }
      }
    }
    const result = [...deduped.values()].map(c => {
      // Fusionner les notes alternatives si elles existent
      if (c.altNotes && c.altNotes.length > 0) {
        const allNotes = [c.notes, ...c.altNotes].filter(Boolean);
        if (allNotes.length > 1) {
          c.notes = allNotes.join(' | ');
        }
      }
      delete c.altNotes;
      return c;
    });

    return result.sort((a, b) => b.confidence - a.confidence);
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

        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        // Crop: garder seulement les 70% du haut pour eviter le texte de puissance
        // Pour les petites images (< 100px, ex: scan salle), pas de crop car deja croppes
        const isSmall = img.height < 100;
        const cropTopPercent = isSmall ? 1.0 : 0.70;
        const srcHeight = img.height * cropTopPercent;

        ctx.drawImage(img, 0, 0, img.width, srcHeight, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size);
        resolve(data);
      };

      img.onerror = (e) => {
        clearTimeout(timeout);
        console.error("[WarAnalyzer] Erreur chargement image:", e);
        reject(new Error("Echec chargement image"));
      };

      img.src = dataUrl;
    });
  }

  /**
   * Convertit RGB en HSV
   */
  rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;

    let h = 0;
    if (diff !== 0) {
      if (max === r) h = 60 * (((g - b) / diff) % 6);
      else if (max === g) h = 60 * ((b - r) / diff + 2);
      else h = 60 * ((r - g) / diff + 4);
    }
    if (h < 0) h += 360;

    const s = max === 0 ? 0 : diff / max;
    const v = max;

    return { h, s, v };
  }

  /**
   * Calcule l'histogramme Hue pondere par saturation
   * Plus discriminant que RGB pour les personnages avec des couleurs distinctives
   */
  async computeHueHistogram(imageDataUrl) {
    const img = await this.loadImage(imageDataUrl);

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    // Pour les petites images (scan salle ~93x76px), pas de crop vertical
    const isSmall = img.height < 100;
    const cropTopPercent = isSmall ? 1.0 : 0.70;
    const srcHeight = img.height * cropTopPercent;

    ctx.drawImage(img, 0, 0, img.width, srcHeight, 0, 0, 64, 64);

    const imageData = ctx.getImageData(0, 0, 64, 64);
    const pixels = imageData.data;

    const hueBins = 36;
    const hist = new Array(hueBins).fill(0);
    let totalWeight = 0;

    // Pour les petites images (scan salle), appliquer un masque circulaire centre
    // Le portrait du perso est dans un cercle au centre, les overlays UI sont aux bords
    // (gear badge en haut-droite, power text en bas, etoiles en bas)
    const useCircularMask = isSmall;
    // Centre legerement au-dessus du milieu (le portrait est dans la moitie haute du crop)
    const cx = 32, cy = isSmall ? 26 : 32;
    const maxRadius = isSmall ? 22 : 32; // ~34% de l'image pour petit, 50% pour grand

    for (let i = 0; i < pixels.length; i += 4) {
      // Masque circulaire : ignorer les pixels hors du cercle central
      if (useCircularMask) {
        const pixIdx = i / 4;
        const px = pixIdx % 64;
        const py = Math.floor(pixIdx / 64);
        const dx = px - cx, dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxRadius) continue;
      }

      const { h, s, v } = this.rgbToHsv(pixels[i], pixels[i + 1], pixels[i + 2]);

      // Seuil plus bas pour petites images (plus de pixels utiles dans le cercle)
      const minSat = isSmall ? 0.15 : 0.2;
      const minVal = isSmall ? 0.15 : 0.2;

      if (s > minSat && v > minVal) {
        const hueIdx = Math.min(Math.floor(h / 10), hueBins - 1);
        const weight = s * v;
        hist[hueIdx] += weight;
        totalWeight += weight;
      }
    }

    if (totalWeight > 0) {
      for (let i = 0; i < hueBins; i++) {
        hist[i] = hist[i] / totalWeight;
      }
    }

    if (isSmall && totalWeight === 0) {
      console.warn(`[WarAnalyzer] Hue histogram vide (circular mask)`);
    }

    return hist;
  }

  /**
   * Detecte si une image de zone team_full a un filtre rouge ("under attack")
   * Analyse la dominance rouge dans l'histogramme hue de la zone entiere (pas de masque circulaire)
   * @param {string} imageDataUrl - Data URL de la zone team_full
   * @returns {Promise<boolean>} true si filtre rouge detecte
   */
  async detectRedFilter(imageDataUrl) {
    const img = await this.loadImage(imageDataUrl);

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 64, 64);

    const imageData = ctx.getImageData(0, 0, 64, 64);
    const pixels = imageData.data;

    let redPixels = 0;
    let totalPixels = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const { h, s, v } = this.rgbToHsv(r, g, b);

      // Ignorer les pixels tres sombres ou desatures
      if (s < 0.15 || v < 0.15) continue;
      totalPixels++;

      // Rouge = hue 0-20° ou 340-360° (bins 0-1 et 34-35 sur 36 bins)
      if (h < 20 || h > 340) {
        redPixels++;
      }
    }

    if (totalPixels === 0) return false;

    const redRatio = redPixels / totalPixels;
    // Fond normal des cartes war = ~47-65% rouge, filtre "under attack" = ~75-85%
    const isUnderAttack = redRatio > 0.70;

    console.log(`[WarAnalyzer] Red ratio: ${(redRatio * 100).toFixed(0)}%${isUnderAttack ? ' → UNDER ATTACK' : ''}`);

    return isUnderAttack;
  }

  /**
   * Calcule la similarite entre deux histogrammes Hue (Bhattacharyya)
   */
  hueHistogramSimilarity(hist1, hist2) {
    if (!hist1 || !hist2 || hist1.length !== hist2.length) return 0;

    let sum = 0;
    for (let i = 0; i < hist1.length; i++) {
      sum += Math.sqrt(hist1[i] * hist2[i]);
    }

    return sum;
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
   * Trouve le meilleur match via histogramme Hue
   * Plus discriminant que RGB pour les personnages avec des couleurs distinctives
   * threshold: similarite minimale en % (defaut 90%)
   * minGap: ecart minimum avec le 2eme match (defaut 1.5%)
   */
  findPortraitMatchByHue(captureHue, threshold = 90, minGap = 1.5, useCircular = false) {
    const candidates = [];

    for (const [charId, data] of Object.entries(this.portraitsDb)) {
      // Utiliser hueCircular si disponible et demande (petites images scan salle)
      const refHue = (useCircular && data.hueCircular) ? data.hueCircular : data.hue;
      if (!refHue) continue;

      const sim = this.hueHistogramSimilarity(captureHue, refHue);
      const simPercent = sim * 100;

      if (simPercent >= threshold) {
        candidates.push({
          name: data.name || charId,
          charId: charId,
          similarity: Math.round(simPercent * 10) / 10,
          hash: data.hash
        });
      }
    }

    candidates.sort((a, b) => b.similarity - a.similarity);

    if (candidates.length >= 2) {
      const gap = candidates[0].similarity - candidates[1].similarity;
      if (gap < minGap) {
        console.log(`[WarAnalyzer] Hue ambigu: ${candidates[0].name} ${candidates[0].similarity}% vs ${candidates[1].name} ${candidates[1].similarity}%`);
        const match = candidates[0];
        match.ambiguous = true;
        match.alternatives = candidates.slice(1, 3);
        return match;
      }
    }

    if (candidates.length > 0 && candidates[0].similarity >= threshold) {
      console.log(`[WarAnalyzer] Hue: ${candidates[0].name} ${candidates[0].similarity}%`);
      return candidates[0];
    }

    return null;
  }

  /**
   * Scoring combine Hue + pHash pour les petites images (scan salle)
   * Le Hue seul n'est pas assez discriminant car beaucoup de persos MSF
   * partagent les memes couleurs dominantes (rouge, bleu, violet)
   * Le pHash capture la structure spatiale du visage pour les departager
   */
  findCombinedMatch(captureHue, captureHash, threshold = 70, minGap = 2.0) {
    const candidates = [];
    const hueWeight = 0.4;
    const phashWeight = 0.6;

    for (const [charId, data] of Object.entries(this.portraitsDb)) {
      const refHue = data.hueCircular || data.hue;
      if (!refHue) continue;

      // Utiliser hashNoCrop si disponible (meme traitement que le runtime pour petites images)
      const refHash = data.hashNoCrop || data.hash;
      if (!refHash) continue;

      const hueSim = this.hueHistogramSimilarity(captureHue, refHue) * 100;
      const pHashSim = this.hashSimilarity(captureHash, refHash);
      const combined = hueWeight * hueSim + phashWeight * pHashSim;

      if (combined >= threshold) {
        candidates.push({
          name: data.name || charId,
          charId: charId,
          similarity: Math.round(combined * 10) / 10,
          hueSim: Math.round(hueSim * 10) / 10,
          pHashSim: pHashSim,
          hash: data.hash
        });
      }
    }

    candidates.sort((a, b) => b.similarity - a.similarity);

    if (candidates.length >= 2) {
      const gap = candidates[0].similarity - candidates[1].similarity;
      if (gap < minGap) {
        console.log(`[WarAnalyzer] Combined ambigu: ${candidates[0].name} ${candidates[0].similarity}% vs ${candidates[1].name} ${candidates[1].similarity}%`);
        const match = candidates[0];
        match.ambiguous = true;
        match.alternatives = candidates.slice(1, 3);
        return match;
      }
    }

    if (candidates.length > 0 && candidates[0].similarity >= threshold) {
      const best = candidates[0];
      console.log(`[WarAnalyzer] Combined: ${best.name} ${best.similarity}% (hue:${best.hueSim}% phash:${best.pHashSim}%)`);
      return best;
    }

    return null;
  }

  /**
   * Charge les portraits appris : bundled (data/learned-portraits.json) + user local (chrome.storage)
   * Les corrections user overrident les bundled pour le meme charId
   */
  async loadLearnedPortraits() {
    const ext = typeof browser !== "undefined" ? browser : chrome;

    // 1. Charger les portraits bundled (partages avec tous les utilisateurs)
    let bundled = {};
    try {
      const url = ext.runtime.getURL("data/learned-portraits.json");
      const resp = await fetch(url);
      const data = await resp.json();
      bundled = data.portraits || {};
    } catch (e) { /* fichier absent ou vide = OK */ }

    // 2. Charger les portraits perso (corrections locales de l'utilisateur)
    let userLocal = {};
    try {
      const result = await ext.storage.local.get("learnedPortraits");
      userLocal = result.learnedPortraits || {};
    } catch (e) {}

    // 3. Merger : user local overrides bundled
    this.learnedDb = { ...bundled, ...userLocal };
    const bundledCount = Object.keys(bundled).length;
    const userCount = Object.keys(userLocal).length;
    console.log(`[WarAnalyzer] Portraits appris: ${bundledCount} bundled + ${userCount} perso = ${Object.keys(this.learnedDb).length} total`);
  }

  /**
   * Sauvegarde un portrait appris (correction utilisateur)
   * Multi-sample : garde jusqu'a 5 captures differentes par perso pour robustesse
   */
  async saveLearnedPortrait(charId, name, hueHist, hash) {
    if (!this.learnedDb) this.learnedDb = {};

    // Refuser si pas de features
    if (!hueHist || !hash) {
      console.warn(`[WarAnalyzer] Impossible de sauver ${name} (${charId}): features manquantes`);
      return;
    }

    let entry = this.learnedDb[charId];

    // Migration ancien format (single sample) vers multi-sample
    if (entry && !entry.samples) {
      const oldSamples = (entry.hue && entry.hash) ? [{ hue: entry.hue, hash: entry.hash }] : [];
      entry = {
        name: name,
        samples: oldSamples,
        count: entry.count || 1,
        lastSeen: Date.now()
      };
      this.learnedDb[charId] = entry;
    }

    if (!entry) {
      this.learnedDb[charId] = {
        name: name,
        samples: [{ hue: hueHist, hash: hash }],
        count: 1,
        lastSeen: Date.now()
      };
    } else {
      entry.name = name;
      entry.lastSeen = Date.now();
      entry.count = (entry.count || 0) + 1;

      // Verifier si ce sample est suffisamment different des existants
      const isDuplicate = (entry.samples || []).some(s => {
        if (!s.hue || !s.hash) return false;
        const hueSim = this.hueHistogramSimilarity(hueHist, s.hue) * 100;
        const pSim = this.hashSimilarity(hash, s.hash);
        return (0.4 * hueSim + 0.6 * pSim) > 95;
      });

      if (!isDuplicate) {
        if (!entry.samples) entry.samples = [];
        entry.samples.push({ hue: hueHist, hash: hash });
        if (entry.samples.length > 5) entry.samples.shift();
        console.log(`[WarAnalyzer] Nouveau sample pour ${name}: ${entry.samples.length} samples`);
      }
    }

    try {
      const ext = typeof browser !== "undefined" ? browser : chrome;
      await ext.storage.local.set({ learnedPortraits: this.learnedDb });
      console.log(`[WarAnalyzer] Portrait appris sauvegarde: ${name} (${charId}) — ${this.learnedDb[charId].samples.length} sample(s)`);
    } catch (e) {
      console.error("[WarAnalyzer] Erreur sauvegarde portrait appris:", e);
    }
  }

  /**
   * Cherche un match dans la DB apprise (multi-sample : meilleur score parmi tous les samples)
   */
  /**
   * @param {Array} captureHue - Histogramme hue du portrait capture
   * @param {string} captureHash - pHash du portrait capture
   * @param {Object} [opts] - Options
   * @param {string[]} [opts.filterCharIds] - Si fourni, ne cherche que dans ces charIds
   * @param {number} [opts.threshold] - Seuil de similarite (defaut: 80)
   * @returns {Object|null} { name, charId, similarity, method }
   */
  findLearnedMatch(captureHue, captureHash, opts = {}) {
    if (!this.learnedDb || Object.keys(this.learnedDb).length === 0) return null;

    const filterSet = opts.filterCharIds ? new Set(opts.filterCharIds.map(id => id.toUpperCase())) : null;
    const threshold = opts.threshold || 80;

    const candidates = [];
    const allScores = []; // Debug: tous les scores pour diagnostic

    for (const [charId, data] of Object.entries(this.learnedDb)) {
      // Filtrer par charIds si specifie
      if (filterSet && !filterSet.has(charId.toUpperCase())) continue;
      // Support multi-sample et ancien format
      const samples = data.samples || (data.hue ? [{ hue: data.hue, hash: data.hash }] : []);
      if (samples.length === 0) continue;

      // Prendre le meilleur score parmi tous les samples
      let bestCombined = 0;
      let bestHue = 0, bestPHash = 0;
      for (const sample of samples) {
        if (!sample.hue) continue;
        const hueSim = this.hueHistogramSimilarity(captureHue, sample.hue) * 100;
        const pHashSim = sample.hash ? this.hashSimilarity(captureHash, sample.hash) : 0;
        const combined = 0.4 * hueSim + 0.6 * pHashSim;
        if (combined > bestCombined) {
          bestCombined = combined;
          bestHue = hueSim;
          bestPHash = pHashSim;
        }
      }

      if (bestCombined >= threshold) {
        candidates.push({
          name: data.name,
          charId: charId,
          similarity: Math.round(bestCombined * 10) / 10,
          hueSim: Math.round(bestHue),
          pHashSim: Math.round(bestPHash),
          method: "learned"
        });
      }
    }

    candidates.sort((a, b) => b.similarity - a.similarity);

    if (candidates.length > 0 && candidates[0].similarity >= threshold) {
      const best = candidates[0];
      const gap = candidates.length >= 2 ? best.similarity - candidates[1].similarity : 100;
      // Gap requis : 2.0% en general, mais reduit a 0.5% si score >= 93% (haute confiance)
      const requiredGap = best.similarity >= 93 ? 0.5 : 2.0;
      if (gap >= requiredGap) {
        console.log(`[WarAnalyzer] Learned: ${best.name} ${best.similarity}% (hue:${best.hueSim}% phash:${best.pHashSim}%) gap:${gap.toFixed(1)}%`);
        return best;
      } else {
        const second = candidates[1];
        console.log(`[WarAnalyzer] Learned ambigu: ${best.name} ${best.similarity}% (hue:${best.hueSim}% phash:${best.pHashSim}%) vs ${second.name} ${second.similarity}% (hue:${second.hueSim}% phash:${second.pHashSim}%) gap:${gap.toFixed(1)}% (requis:${requiredGap}%)`);
        // Score eleve mais ambigu → retourner comme guess plutot que tomber sur CDN a ~74%
        // Un learned a 90%+ est bien plus fiable qu'un CDN a 74%
        if (best.similarity >= 88) {
          best.ambiguous = true;
          best.method = "learned-ambiguous";
          return best;
        }
      }
    }

    return null;
  }

  /**
   * Trouve le meilleur match pour un hash dans la base de portraits (legacy pHash)
   * threshold: similarite minimale (defaut 75%)
   * minGap: ecart minimum avec le 2eme match pour accepter (defaut 3%)
   */
  findPortraitMatch(hash, threshold = 75, minGap = 3) {
    const candidates = [];

    // D'abord verifier si le hash exact existe dans l'index
    if (this.hashIndex && this.hashIndex[hash]) {
      const charId = this.hashIndex[hash];
      const data = this.portraitsDb[charId];
      if (data) {
        return {
          name: data.name || charId,
          charId: charId,
          similarity: 100,
          hash: hash
        };
      }
    }

    // Sinon comparer avec tous les portraits (ancien format ou fallback)
    for (const [key, value] of Object.entries(this.portraitsDb)) {
      let dbHash, name, charId;

      // Nouveau format: key = charId, value = { name, hash, hist }
      if (typeof value === "object" && value.hash) {
        dbHash = value.hash;
        name = value.name;
        charId = key;
      }
      // Ancien format: key = hash, value = { name, charId } ou string
      else if (typeof value === "object") {
        dbHash = key;
        name = value.name || "Inconnu";
        charId = value.charId || null;
      } else {
        dbHash = key;
        name = value;
        charId = this.nameToId[value.toUpperCase()] || null;
      }

      const sim = this.hashSimilarity(hash, dbHash);

      if (sim >= threshold) {
        candidates.push({ name, charId, similarity: sim, hash: dbHash });
      }
    }

    candidates.sort((a, b) => b.similarity - a.similarity);

    if (candidates.length >= 2) {
      const gap = candidates[0].similarity - candidates[1].similarity;
      if (gap < minGap) {
        console.log(`[WarAnalyzer] pHash ambigu: ${candidates[0].name} ${candidates[0].similarity}% vs ${candidates[1].name} ${candidates[1].similarity}%`);
        const match = candidates[0];
        match.ambiguous = true;
        match.alternatives = candidates.slice(1, 3);
        return match;
      }
    }

    if (candidates.length > 0) {
      console.log(`[WarAnalyzer] pHash: ${candidates[0].name} ${candidates[0].similarity}%`);
    }

    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * Identifie une liste de portraits et retourne les personnages
   * Utilise l'histogramme Hue (plus discriminant que RGB)
   * avec fallback sur pHash si pas d'histogramme Hue dans la base
   */
  async identifyPortraits(portraitDataUrls) {
    const identified = [];
    const hasHueHistograms = Object.values(this.portraitsDb).some(p => p && p.hue);

    for (let i = 0; i < portraitDataUrls.length; i++) {
      const dataUrl = portraitDataUrls[i];
      try {

        let match = null;

        // Detecter si c'est une petite image (scan salle) pour adapter le matching
        const tempImg = await this.loadImage(dataUrl);
        const isSmallPortrait = tempImg.height < 100;

        if (isSmallPortrait && hasHueHistograms) {
          // Petites images (scan salle): scoring combine Hue + pHash
          // Le Hue seul n'est pas assez discriminant (beaucoup de persos MSF ont les memes couleurs)
          const hueHist = await this.computeHueHistogram(dataUrl);
          const hash = await this.computePortraitHash(dataUrl);
          match = this.findCombinedMatch(hueHist, hash, 70, 2.0);
          if (match) {
            match.method = "combined";
          }
        } else if (hasHueHistograms) {
          // Grandes images (barracks): Hue seul suffit
          const hueHist = await this.computeHueHistogram(dataUrl);
          match = this.findPortraitMatchByHue(hueHist, 90, 1.5, false);
          if (match) {
            match.method = "hue";
          }
        }

        // Fallback: pHash seul si base sans histogrammes Hue ou pas de match
        if (!match) {
          const hash = await this.computePortraitHash(dataUrl);
          match = this.findPortraitMatch(hash, 75, 3);
          if (match) {
            match.method = "pHash";
          }
        }

        if (match) {
          identified.push({
            name: match.name,
            charId: match.charId,
            similarity: match.similarity,
            hash: match.hash,
            method: match.method,
            ambiguous: match.ambiguous || false,
            alternatives: match.alternatives || []
          });
        } else {
          identified.push({
            name: null,
            charId: null,
            similarity: 0,
            hash: null
          });
        }
      } catch (e) {
        console.error(`[WarAnalyzer] Erreur identification portrait ${i + 1}:`, e);
        identified.push({
          name: null,
          charId: null,
          similarity: 0,
          hash: null,
          error: e.message
        });
      }
    }

    // Deduplication: un meme personnage ne peut pas apparaitre 2 fois dans la meme equipe
    // Si doublon, garder celui avec le meilleur score et marquer l'autre comme inconnu
    const seen = new Map(); // charId -> index du meilleur match
    for (let i = 0; i < identified.length; i++) {
      const id = identified[i].charId;
      if (!id) continue;
      if (seen.has(id)) {
        const prevIdx = seen.get(id);
        // Garder le meilleur score, invalider l'autre
        if (identified[i].similarity > identified[prevIdx].similarity) {
          console.log(`[WarAnalyzer] Dedup: ${identified[prevIdx].name} en position ${prevIdx + 1} remplace par inconnu (doublon, score inferieur)`);
          identified[prevIdx] = { name: null, charId: null, similarity: 0, hash: null, dedup: true };
          seen.set(id, i);
        } else {
          console.log(`[WarAnalyzer] Dedup: ${identified[i].name} en position ${i + 1} remplace par inconnu (doublon, score inferieur)`);
          identified[i] = { name: null, charId: null, similarity: 0, hash: null, dedup: true };
        }
      } else {
        seen.set(id, i);
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
