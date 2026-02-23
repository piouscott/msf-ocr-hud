# War OCR - Guide d'utilisation complet

## Table des matieres

1. [Scan de salle](#1-scan-de-salle)
2. [Resultats du scan](#2-resultats-du-scan)
3. [Corriger les portraits](#3-corriger-les-portraits)
4. [Chercher des counters](#4-chercher-des-counters)
5. [Export / Import de portraits](#5-export--import-de-portraits)
6. [Selecteur de position (zones)](#6-selecteur-de-position-zones)
7. [Mode debug et calibration](#7-mode-debug-et-calibration)
8. [Parametres techniques](#8-parametres-techniques)

---

## 1. Scan de salle

### Lancer un scan

1. Ouvrir le jeu MSF dans un onglet du navigateur et naviguer vers une salle de War
2. Cliquer sur le bouton **War OCR** dans la toolbar de l'extension
3. Cliquer sur **Scan Salle**

L'extension va :
- Capturer l'ecran de l'onglet MSF actif
- Decouper les 4 equipes ennemies (5 portraits par equipe)
- Lancer l'OCR pour lire la puissance de chaque equipe
- Identifier les personnages via la base de portraits appris puis le CDN

> **Fallback fichier** : si la capture d'ecran echoue (pas d'onglet MSF, permissions manquantes),
> un selecteur de fichier s'ouvre pour charger un screenshot PNG/JPEG manuellement.

### Detection "Under Attack"

Si une equipe est en cours d'attaque (filtre rouge visible), elle est automatiquement ignoree
pour ne pas corrompre la base de portraits. Les portraits apparaissent en grise avec un indicateur rouge.

---

## 2. Resultats du scan

Apres le scan, chaque equipe est affichee dans une carte avec :

| Element | Description |
|---------|-------------|
| **Portraits** | 5 cercles cliquables par equipe |
| **Noms** | Nom du personnage identifie sous chaque portrait |
| **Puissance** | Champ editable pre-rempli par l'OCR |
| **Bouton Counters** | Actif des que 3+ personnages sont identifies |

### Code couleur des portraits

| Couleur | Signification |
|---------|---------------|
| **Vert** | Portrait appris (confirme par l'utilisateur) |
| **Orange** | Deduction automatique (pas encore confirmee) |
| **Gris** | Inconnu (non identifie) |
| **Rouge** | Equipe en cours d'attaque (ignoree) |

### Re-matching intelligent

Apres l'identification initiale, si 3+ membres d'une equipe sont reconnus, le systeme :
1. Identifie l'equipe (ex: "Absolute Aforce")
2. Re-matche les portraits inconnus ou mal assignes en se limitant aux membres restants de cette equipe
3. Protege les portraits appris avec un score >= 90%

---

## 3. Corriger les portraits

### Clic simple sur un portrait

Ouvre une barre de recherche sous l'equipe avec autocompletion :
- Taper le nom du personnage (EN ou FR, insensible aux accents)
- Taper un nom d'equipe pour voir tous ses membres
- Cliquer sur le bon personnage pour le selectionner

**Raccourcis dans la recherche :**
- **Entree** : selectionne automatiquement s'il n'y a qu'un seul resultat
- **Tab** : passe au portrait non-identifie suivant

### Double-clic sur un portrait orange

Confirme la deduction automatique et l'enregistre dans la base de portraits appris.
Le portrait passe de orange a vert.

### Apprentissage

Chaque correction est sauvegardee dans `chrome.storage.local` (cle `learnedPortraits`).
Les prochains scans reconnaitront ce personnage automatiquement.
Jusqu'a 5 echantillons par personnage sont conserves pour ameliorer la robustesse.

---

## 4. Chercher des counters

1. S'assurer qu'au moins 3 portraits sont identifies (vert ou orange)
2. Verifier/ajuster la puissance dans le champ (pre-remplie par OCR)
3. Cliquer sur **Chercher counters**

Le systeme :
- Identifie l'equipe ennemie parmi les equipes connues
- Detecte les variantes (avec Odin, Knull, Mephisto, etc.)
- Affiche les counters avec etoiles de confiance et indicateur punch up/down

### Indicateur Punch

| Etoiles | Confiance | Facteur punch |
|---------|-----------|---------------|
| 3 etoiles | 95%+ | Punch up 20% |
| 2 etoiles | 80%+ | Punch up 10% |
| 1 etoile | 65%+ | Punch up 5% |
| 0 etoile | 50%+ | Match egal |
| - | <50% | Punch down |

---

## 5. Export / Import de portraits

### Exporter

Bouton **Export Portraits** dans la toolbar du War panel.
Genere un fichier JSON contenant tous les portraits appris par l'utilisateur.

### Importer

Bouton **Import Portraits** dans la toolbar du War panel.
Charge un fichier JSON de portraits. Les portraits sont fusionnes intelligemment :
- Pas de doublons
- Les corrections existantes sont conservees
- Permet le partage entre utilisateurs pour enrichir la base commune

---

## 6. Selecteur de position (zones)

Le menu deroulant a cote du bouton "Scan Salle" permet de choisir le jeu de coordonnees
utilise pour decouper le screenshot :

| Option | Description |
|--------|-------------|
| **Zones: auto** | Utilise la derniere position selectionnee (ou Position 1 par defaut) |
| **Position 1** | Premier jeu de coordonnees predefini |
| **Position 2** | Second jeu de coordonnees predefini |
| **Custom** | Calibration personnalisee (visible uniquement si une calibration a ete sauvegardee) |

> **Pourquoi plusieurs positions ?** La disposition des equipes a l'ecran peut varier selon
> la resolution, le navigateur ou la version du jeu. Si les portraits sont mal decoupes,
> essayer une autre position ou faire une calibration custom.

La position choisie est sauvegardee automatiquement pour les prochains scans.

---

## 7. Mode debug et calibration

### Entrer en mode debug

**Ctrl + Clic** (ou **Cmd + Clic** sur Mac) sur le bouton **Scan Salle**.

### Ce que le mode debug affiche

- Le screenshot complet avec les zones de decoupe superposees en couleur :
  - **Cyan pointille** : zones `team_power` (bande de puissance)
  - **Jaune** : zones `team_full` (carte complete de l'equipe)
  - **Vert** : zones `portrait_1` a `portrait_5`
- Les portraits extraits pour chaque equipe (miniatures)
- La zone power croppee + le resultat OCR
- Un bouton "Relancer OCR" pour retester la lecture de puissance

### Calibration personnalisee

Si les zones predefinis ne correspondent pas a votre ecran :

#### Etape 1 : Cliquer les 20 centres de portraits

Dans le mode debug, cliquez sur le screenshot dans cet ordre :

```
Equipe 1 : P1 P2 (ligne du haut), P3 P4 P5 (ligne du bas)
Equipe 2 : P1 P2 (ligne du haut), P3 P4 P5 (ligne du bas)
Equipe 3 : P1 P2 (ligne du haut), P3 P4 P5 (ligne du bas)
Equipe 4 : P1 P2 (ligne du haut), P3 P4 P5 (ligne du bas)
```

**Aide au positionnement :**
- Une **loupe 4x** suit le curseur pour viser precisement le centre de chaque portrait
- Un compteur indique le point en cours (ex: "E1P1", "E2P3")
- **Clic droit** pour annuler le dernier point en cas d'erreur

#### Etape 2 : Sauvegarder

Cliquer sur **Sauvegarder la calibration** (necessite les 20 points).

Le systeme :
- Calcule les coordonnees normalisees (0-1) a partir des points cliques
- Genere les zones `team_full`, `team_power`, et `portrait_1` a `portrait_5` pour chaque equipe
- Sauvegarde dans `chrome.storage.local` (cle `msfCustomZoneCalibration`)
- Ajoute automatiquement l'option **Custom** dans le selecteur de position

#### Etape 3 : Utiliser

L'option **Custom** est automatiquement selectionnee apres sauvegarde.
Les prochains scans utiliseront cette calibration.

### Reset de la calibration

Le bouton **Reset zones** (visible uniquement quand une calibration custom existe) :
- Supprime la calibration personnalisee du storage
- Retire l'option "Custom" du selecteur
- Revient aux zones predefinis (Position 1 ou 2)

---

## 8. Parametres techniques

### OCR (lecture de puissance)

| Parametre | Valeur | Description |
|-----------|--------|-------------|
| Scale | 4x | Agrandissement avant OCR |
| Preprocessing | Grayscale + inversion | Texte blanc sur fond sombre -> noir sur blanc |
| Crop | 45% droite | Seule la moitie droite du bandeau est lue (le chiffre est a droite) |
| Minimum digits | 5 | Ignore les nombres < 5 chiffres (bruit) |
| Moteur | Tesseract.js v4 | WASM, execute dans le popup |
| Cores | SIMD-LSTM > LSTM > SIMD > basique | Fallback automatique |

### Matching de portraits

| Parametre | Valeur | Description |
|-----------|--------|-------------|
| Poids Hue | 40% | Histogramme de teinte HSV (discrimination couleur) |
| Poids pHash | 60% | Hash perceptuel 8x8 (forme structurelle) |
| Seuil appris | 80% | Score minimum pour un match dans la base apprise |
| Seuil CDN | 70% | Score minimum pour un match CDN (portraits officiels) |
| Gap haut (>= 93%) | 0.5% | Ecart minimum entre les 2 meilleurs candidats |
| Gap normal (< 93%) | 2.0% | Ecart minimum en confiance moyenne |
| Ambigue (>= 88%) | guess | Retourne en orange plutot que de tomber sur le CDN |
| Echantillons max | 5 | Nombre max de samples par personnage appris |

### Detection equipe

| Parametre | Valeur | Description |
|-----------|--------|-------------|
| Membres minimum | 3 | Minimum pour identifier une equipe |
| Confiance minimum | 60% | Pourcentage de membres reconnus |
| Re-match seuil | 65% | Seuil pour le re-matching des inconnus apres detection equipe |
| Protection appris | 90% | Les portraits appris >= 90% ne sont pas re-matches |

### Detection under attack

| Parametre | Valeur | Description |
|-----------|--------|-------------|
| Seuil rouge | 70% | Pourcentage de pixels rouges pour considerer l'equipe attaquee |
| Zone analysee | 64x64px | Redimensionnement pour analyse rapide |
| Teinte rouge | 0-20 ou 340-360 | Plage HSV consideree comme rouge |

### Zones de decoupe (msf-zones-config.json)

Toutes les coordonnees sont normalisees entre 0 et 1 (relatives a la taille du screenshot).

```
Position 1 — Slot 1 exemple :
  team_full   : x=0.165  y=0.39  w=0.155  h=0.33
  team_power  : x=0.165  y=0.39  w=0.155  h=0.045  (bandeau haut)
  portrait_1  : x=0.185  y=0.44  w=0.05   h=0.08   (haut-gauche)
  portrait_2  : x=0.245  y=0.44  w=0.05   h=0.08   (haut-droite)
  portrait_3  : x=0.164  y=0.55  w=0.05   h=0.08   (bas-gauche)
  portrait_4  : x=0.219  y=0.55  w=0.05   h=0.08   (bas-centre)
  portrait_5  : x=0.272  y=0.55  w=0.05   h=0.08   (bas-droite)
```

Les 4 equipes sont disposees horizontalement de gauche a droite (slots 1 a 4).
Chaque equipe a 5 portraits : 2 en haut, 3 en bas.

### Storage utilise

| Cle | Contenu |
|-----|---------|
| `learnedPortraits` | Base de portraits appris par l'utilisateur |
| `msfCustomZoneCalibration` | Calibration personnalisee des zones |
| `msfZonePosition` | Derniere position utilisee (position1, position2) |
