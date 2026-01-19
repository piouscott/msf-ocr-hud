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
- **Match exact 5/5 requis** pour identifier une équipe (un personnage différent = counter différent)
- Sinon → "Equipe custom" + liste des personnages identifiés

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
│   ├── popup.js           # Logique UI
│   ├── popup.css          # Styles popup
│   ├── manage.html        # Gestion des counters
│   └── manage.js          # Logique gestion counters
├── data/
│   ├── teams.json         # Base compositions (~50 équipes)
│   ├── counters.json      # Base counters par défaut
│   └── portraits.json     # Hash des portraits
├── modules/
│   ├── zone-cropper.js    # Extraction zones calibrées
│   └── ocr-engine.js      # Wrapper Tesseract.js
├── lib/
│   └── tesseract/         # Tesseract.js pour OCR
└── tools/
    └── portrait-extractor.html  # Outil extraction portraits avec OCR
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
  msfZonesConfig: {...},      // Calibration écran
  msfPortraits: {...},        // Hash portraits enregistrés
  msfCustomCounters: {...},   // Counters modifiés par l'utilisateur
  msfRemoteCounters: {...},   // Counters synchronisés depuis URL
  msfSyncUrl: "https://..."   // URL de synchronisation
}
```

### 6.2 Système de counters à 3 niveaux
**Priorité** : Custom > Remote > Default

| Niveau | Source | Description |
|--------|--------|-------------|
| Default | `data/counters.json` | Base incluse dans l'extension (repo) |
| Remote | URL configurable | Synchronisation depuis serveur externe |
| Custom | `storage.local` | Modifications manuelles de l'utilisateur |

**Fusion** : Pour chaque équipe, on utilise les counters du niveau le plus prioritaire disponible.

**Format counters.json** :
```javascript
{
  "description": "Base de donnees des counters MSF",
  "version": 1,
  "counters": {
    "darkhold": [
      { "team": "orchis", "confidence": 95, "minPowerRatio": 0.8, "notes": "..." }
    ]
  }
}
```

### 6.3 Bases de données
**Fichiers statiques** (inclus dans l'extension)
- `teams.json` : ~50 équipes connues
- `counters.json` : Base de counters par défaut
- `portraits.json` : ~200 hash de personnages

**Mise à jour** :
- Default : via mise à jour de l'extension
- Remote : sync manuelle depuis URL configurable dans le popup

---

## 7. Étapes de développement

### Phase 1 : Calibrateur ✅
- [x] Créer l'outil de sélection de zones
- [x] Sauvegarder les coordonnées dans `browser.storage.local`
- [x] Calibrateur pas-à-pas (24 zones : 4 slots × 6 zones)
- [x] Contrôles : ENTREE=valider, S=passer, ESC=quitter

### Phase 2 : Extraction ✅
- [x] Capturer screenshot via `captureVisibleTab()`
- [x] Cropper les 4 zones d'équipes (ZoneCropper)
- [x] Extraire puissance (OCR Tesseract.js avec prétraitement 3x)
- [x] Puissance éditable manuellement (correction erreurs OCR)

### Phase 3 : Identification ✅
- [x] Créer `data/teams.json` (10 équipes)
- [x] Créer `data/portraits.json` (structure hash → nom)
- [x] Hash perceptuel (pHash 8x8) pour portraits
- [x] Algorithme de matching **5/5 exact requis**
- [x] Clic sur portrait pour l'enregistrer dans la base
- [x] Afficher nom d'équipe dans popup

### Phase 4 : Counters ✅
- [x] Créer `data/counters.json` (10 équipes avec 3 counters chacune)
- [x] Logique de suggestion (CounterSuggester avec minPowerRatio)
- [x] Afficher top 3 counters dans popup avec % confiance et puissance min

### Phase 5 : Gestion ✅
- [x] Export config (zones + portraits) en JSON
- [x] Import config avec fusion des portraits
- [x] Interface de gestion des counters (manage.html)
- [x] Counters custom stockes dans storage.local
- [x] Compatibilité Chrome (couche abstraction `ext` dans tous les fichiers)

### Phase 6 : Synchronisation Counters ✅
- [x] Système 3 niveaux (Default < Remote < Custom)
- [x] Panneau sync dans popup avec URL configurable
- [x] Fonction sync depuis URL distante (fetch JSON)
- [x] Badges de source dans manage.html (Défaut/Sync/Perso)
- [x] Bouton réinitialiser pour revenir aux valeurs par défaut

### Phase 7 : Outils ✅
- [x] Outil d'extraction de portraits (`tools/portrait-extractor.html`)
- [x] Grille configurable (colonnes, lignes, offsets, taille)
- [x] Mode manuel pour sélection individuelle
- [x] OCR automatique des noms de personnages (Tesseract.js)
- [x] Export JSON compatible avec `data/portraits.json`

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

**Statut** : Extension V1.0 complète et fonctionnelle!

**Pour tester** :
1. Firefox : `about:debugging` → Charger un module complémentaire temporaire → sélectionner `manifest.json`
2. Chrome : `chrome://extensions` → Mode développeur → Charger l'extension non empaquetée