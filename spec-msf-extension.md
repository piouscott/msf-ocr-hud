# Spécification Fonctionnelle - Extension Counter MSF

## 1. Vue d'ensemble

**Objectif** : Extension navigateur (Firefox/Chrome) pour analyser les équipes adverses dans Marvel Strike Force et suggérer les meilleurs counters depuis une base de données pré-établie.

**Contexte** : Le jeu affiche 4 équipes ennemies avec leurs compositions et puissances. Le joueur doit choisir ses équipes pour les attaquer efficacement.

---

## 2. Fonctionnalités principales

### 2.1 Capture d'écran et extraction
**Déclencheur** : Clic sur l'icône de l'extension (ou bouton popup)

**Processus** :
1. Capture une screenshot de l'onglet actif
2. Identifie les 4 zones d'équipes ennemies à l'écran
3. Pour chaque zone :
   - Extrait les portraits des personnages (reconnaissance visuelle)
   - Extrait la puissance totale (OCR sur le texte "+10 PTS X,XXX,XXX")
   - Détecte le slot (couleur du bandeau : jaune=3, vert=4, bleu=5, vert foncé=7)

**Données extraites** :
```javascript
{
  slot: 3,
  power: 3986869,
  team: ["Feaver", "Character2", "Character3", "Character4", "Character5"]
}
```

### 2.2 Identification des équipes
**Méthode** : Comparaison avec une base de données de compositions connues

**Base de données** (JSON) :
```javascript
{
  "Villain Mystic": {
    composition: ["Feaver", "Loki", "Hela", "Mordo", "Wong"],
    tags: ["mystic", "villain", "control"]
  },
  "Darkhold": {
    composition: ["Scarlet Witch", "Wong", "Agatha", "Morgan", "Dormammu"],
    tags: ["darkhold", "raid", "meta"]
  }
}
```

**Logique** :
- Si ≥3 personnages matchent → identification confirmée
- Si <3 → "Custom team" + liste des personnages

### 2.3 Suggestion de counters
**Base de données counters** :
```javascript
{
  "Villain Mystic": {
    counters: [
      { team: "Hero Asgardians", confidence: 95, minPower: 1.1 },
      { team: "Gamma", confidence: 85, minPower: 1.2 },
      { team: "Unlimited X-Men", confidence: 80, minPower: 1.0 }
    ]
  }
}
```

**Calcul** :
- Filtre les counters selon `minPower` (ratio puissance requise/ennemi)
- Classe par `confidence` décroissant
- Retourne les 3-4 meilleurs

**Affichage** :
```
🎯 SLOT 3 - Villain Mystic (3.9M)

✅ Counters recommandés :
1. Hero Asgardians (95%) - Min: 4.3M
2. Gamma (85%) - Min: 4.7M
3. Unlimited X-Men (80%) - Min: 3.9M
```

---

## 3. Architecture technique

### 3.1 Structure des fichiers
```
extension/
├── manifest.json          # Config extension
├── bg.js                  # Background script
├── content.js             # Injection page + extraction
├── popup/
│   ├── popup.html         # Interface utilisateur
│   └── popup.js           # Logique UI
├── data/
│   ├── teams.json         # Base compositions
│   ├── counters.json      # Base counters
│   └── portraits.json     # Hash des portraits
└── utils/
    ├── ocr.js             # Extraction texte
    └── vision.js          # Reconnaissance portraits
```

### 3.2 Flux de données

**1. Utilisateur clique sur l'icône**
```
popup.js → bg.js (captureVisibleTab)
       ↓
    content.js (reçoit screenshot)
       ↓
  Extraction des zones
       ↓
  Identification équipes
       ↓
    popup.js (affiche résultats)
```

**2. Communication entre scripts**
- `popup → bg` : `browser.runtime.sendMessage()`
- `bg → content` : `browser.tabs.sendMessage()`
- `content → popup` : Réponse via callback

### 3.3 Calibration des zones (IMPORTANT)

**Problème** : Les positions des équipes varient selon la résolution d'écran

**Solution** : Outil de calibration intégré
```javascript
// Active le mode calibration
startCropCalibrator({ label: "TEAM SLOT 3" })

// Retourne les coordonnées normalisées (0-1)
{ x: 0.1458, y: 0.4583, w: 0.1823, h: 0.2604 }
```

**Configuration stockée** :
```javascript
{
  zones: {
    slot3: { x: 0.1458, y: 0.4583, w: 0.1823, h: 0.2604 },
    slot4: { x: 0.3542, y: 0.4583, w: 0.1823, h: 0.2604 },
    // etc.
  }
}
```

---

## 4. Reconnaissance visuelle

### 4.1 Extraction des portraits
**Méthode** : Hash perceptuel (pHash)
1. Extrait chaque portrait (crop de la zone)
2. Redimensionne en 32x32px
3. Convertit en niveaux de gris
4. Calcule le hash
5. Compare avec `portraits.json`

**Format portraits.json** :
```javascript
{
  "a4f2e9c8b3d1": "Feaver",
  "b7e3f1a9c2d4": "Loki",
  // ~200 personnages
}
```

### 4.2 Extraction de la puissance
**Méthode** : OCR (Tesseract.js ou API)
1. Crop la zone "+10 PTS X,XXX,XXX"
2. Prétraitement (contraste, binarisation)
3. OCR → "3,986,869"
4. Parse en nombre : `3986869`

---

## 5. Interface utilisateur

### 5.1 Popup principal
```
┌─────────────────────────────┐
│  MSF Counter Finder         │
├─────────────────────────────┤
│  [📸 Analyser l'écran]      │
│  [⚙️ Calibrer les zones]    │
│  [📊 Gérer les counters]    │
└─────────────────────────────┘
```

### 5.2 Affichage des résultats
```
┌─────────────────────────────┐
│  🎯 RÉSULTATS (4 équipes)   │
├─────────────────────────────┤
│  SLOT 3 - Villain Mystic    │
│  💪 3.9M                     │
│  ├─ Hero Asgardians (95%)   │
│  ├─ Gamma (85%)             │
│  └─ Unlimited X-Men (80%)   │
├─────────────────────────────┤
│  SLOT 4 - Darkhold          │
│  💪 4.9M                     │
│  ├─ Orchis (90%)            │
│  └─ Rebirth (75%)           │
└─────────────────────────────┘
```

### 5.3 Gestion des counters
Interface pour ajouter/modifier les counters :
```
Équipe : [Villain Mystic ▼]
Counter : [Hero Asgardians]
Confidence : [95]% 
Min Power : [1.1]x
[Ajouter]
```

---

## 6. Stockage des données

### 6.1 Configuration utilisateur
**Storage API** : `browser.storage.local`
```javascript
{
  zones: {...},           // Calibration écran
  customCounters: {...},  // Counters persos
  preferences: {
    autoAnalyze: false,
    showPowerRatio: true
  }
}
```

### 6.2 Bases de données
**Fichiers statiques** (inclus dans l'extension)
- `teams.json` : ~50 équipes connues
- `counters.json` : ~150 relations counter
- `portraits.json` : ~200 hash de personnages

**Mise à jour** : 
- Manuellement via mise à jour de l'extension
- Ou fetch depuis un JSON hébergé (optionnel)

---

## 7. Étapes de développement

### Phase 1 : Calibrateur (ACTUEL) ✅
- [x] Créer l'outil de sélection de zones
- [x] Sauvegarder les coordonnées
- [ ] Tester sur différentes résolutions

### Phase 2 : Extraction
- [ ] Capturer screenshot
- [ ] Cropper les 4 zones d'équipes
- [ ] Extraire portraits (pHash)
- [ ] Extraire puissance (OCR)

### Phase 3 : Identification
- [ ] Créer `teams.json` (10 équipes test)
- [ ] Algorithme de matching
- [ ] Afficher résultats dans popup

### Phase 4 : Counters
- [ ] Créer `counters.json`
- [ ] Logique de suggestion
- [ ] Interface de résultats

### Phase 5 : Gestion
- [ ] Interface d'ajout de counters
- [ ] Export/Import de config
- [ ] Compatibilité Chrome

---

## 8. Contraintes techniques

### 8.1 Permissions requises
```json
{
  "permissions": [
    "activeTab",           // Capture screenshot
    "tabs",                // Accès onglet actif
    "storage",             // Sauvegarder config
    "webNavigation"        // Détecter frames
  ]
}
```

### 8.2 Performance
- Analyse complète : <3 secondes
- Hash portrait : <100ms par image
- OCR puissance : <500ms

### 8.3 Limitations
- Nécessite calibration initiale par utilisateur
- Sensible aux changements d'UI du jeu
- Reconnaissance limitée aux personnages en base

---

## 9. Évolutions futures

### V1.1
- Import de liste d'équipes depuis clipboard
- Historique des analyses
- Export PDF des résultats

### V2.0
- Mode "War" avec tracking des défenses
- Statistiques de win rate
- Base cloud collaborative

---

**Prochaine étape** : Intégrer le calibrateur dans l'extension actuelle et tester l'extraction des zones sur ton écran.

Des questions sur cette spec ? Quelle partie veux-tu qu'on attaque en premier ?