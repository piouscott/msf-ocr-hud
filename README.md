# MSF Counter

A browser extension for **Marvel Strike Force** players. Counters, events, raids, defense, farming, alliance, Crucible meta and more — all in one popup.

Compatible with **Chrome**, **Vivaldi**, **Edge** and **Firefox** (Manifest V3).

---

Une extension navigateur pour les joueurs de **Marvel Strike Force**. Counters, events, raids, defense, farming, alliance, meta Crucible et plus — tout en un clic.

Compatible **Chrome**, **Vivaldi**, **Edge** et **Firefox** (Manifest V3).

---

## Features / Fonctionnalites

| Icon | Button | Description (EN) | Description (FR) |
|---|---|---|---|
| 📅 | **Events** | Live events with progress, pace tracker, action calculator | Events en cours avec progression, tracker de rythme |
| 💀 | **Raids** | Raid milestones + Thunderstrike team guide per node | Milestones Raids + guide equipes par node |
| 🛡️ | **Defense** | Test your War defense, inverse counters, 10-team tracker | Tester sa defense War, counters inverses, compteur 0/10 |
| 🌱 | **Farm** | Where to farm characters, counter advisor, roster tracker | Ou farmer les persos, conseiller counters, suivi roster |
| ⚔️ | **Counters** | Full counter list with search, portraits, confidence | Liste counters avec recherche, portraits, confiance |
| 🎯 | **War OCR** | Auto-scan war room portraits with learning system | Scan automatique salle avec systeme d'apprentissage |
| 🌐 | **BW** | Battleworld teams | Equipes Battleworld |
| 🏆 | **Crucible** | Defense & attack meta with win rates, search, filters | Meta defense/attaque avec taux victoire, recherche, filtres |
| 🛡️ | **Alliance** | Alliance info, members with TCP/STP sorting | Infos alliance, membres avec tri TCP/STP |
| 👥 | **Characters** | Full character catalog with traits and API sync | Catalogue personnages avec traits et sync API |
| 🎨 | **Background** | 19 MSF wallpapers to customize the popup | 19 fonds d'ecran MSF personnalisables |
| 🔑 | **API** | OAuth login and token management | Connexion OAuth et gestion des tokens |
| 🔄 | **Sync** | Remote counter synchronization | Synchronisation des counters |

---

## Installation

### Chrome / Vivaldi / Edge

1. Download `msf-counter.zip` from the [latest release](https://github.com/piouscott/msf-ocr-hud/releases/latest)
2. Extract the ZIP into a folder on your computer
3. Open your browser:
   - Chrome: `chrome://extensions/`
   - Vivaldi: `vivaldi://extensions/`
   - Edge: `edge://extensions/`
4. Enable **Developer mode** (toggle in the top-right corner)
5. Click **"Load unpacked"**
6. Select the extracted folder
7. The MSF Counter icon appears in your toolbar — click it to open!

### Firefox

1. Download `msf-counter.zip` from the [latest release](https://github.com/piouscott/msf-ocr-hud/releases/latest)
2. Extract the ZIP into a folder
3. Go to `about:debugging#/runtime/this-firefox`
4. Click **"Load Temporary Add-on..."**
5. Select the `manifest.json` file inside the extracted folder
6. The extension is loaded

> **Note:** Temporary add-ons are removed when Firefox restarts. For permanent installation, the extension needs to be signed by Mozilla.

---

## Installation (Francais)

### Chrome / Vivaldi / Edge

1. Telecharger `msf-counter.zip` depuis la [derniere release](https://github.com/piouscott/msf-ocr-hud/releases/latest)
2. Extraire le ZIP dans un dossier
3. Ouvrir le navigateur :
   - Chrome : `chrome://extensions/`
   - Vivaldi : `vivaldi://extensions/`
   - Edge : `edge://extensions/`
4. Activer le **Mode developpeur** (bouton en haut a droite)
5. Cliquer **"Charger l'extension non empaquetee"**
6. Selectionner le dossier extrait
7. L'icone MSF Counter apparait dans la barre d'outils — cliquer pour ouvrir !

### Firefox

1. Telecharger `msf-counter.zip` depuis la [derniere release](https://github.com/piouscott/msf-ocr-hud/releases/latest)
2. Extraire le ZIP dans un dossier
3. Aller sur `about:debugging#/runtime/this-firefox`
4. Cliquer **"Charger un module temporaire..."**
5. Selectionner le fichier `manifest.json` dans le dossier extrait
6. L'extension est chargee

> **Note :** Les modules temporaires sont supprimes au redemarrage de Firefox. Pour une installation permanente, l'extension doit etre signee par Mozilla.

---

## API Connection

The extension connects to the official MSF API to fetch your player data. Two methods are available:

### Method 1: OAuth (recommended)

1. Click the **API** button (🔑) in the extension
2. Click **"Connexion OAuth MSF"**
3. Log in with your **Scopely** account on the official MSF page
4. **Check all permissions**, then click **"Autoriser"**:

| Permission | What it unlocks |
|---|---|
| **Voir le profil** | Player name, level, total power |
| **Voir l'effectif** | Characters, saved squads, favorites |
| **Voir l'inventaire** | Gear and resources |
| **Voir l'activite de jeu** | Campaign progress, milestones |
| **Voir le profil d'alliance** | Alliance data, members |
| **Acces persistant** | Prevents auto token expiration |

5. You are redirected back to the extension — done!

> The token refreshes automatically. If your session expires, just click "Connexion OAuth MSF" again.

### Method 2: Web Token (for complete roster data)

The OAuth method doesn't return star levels. For full roster data:

1. Open [marvelstrikeforce.com/web-playable](https://marvelstrikeforce.com/fr/web-playable) in a tab
2. Press **F5** to reload the page
3. Play for a few seconds — the extension captures the token automatically
4. Go back to the extension and click **"Recuperer Squads"** in the Defense panel

> You can use both methods together. OAuth for events/alliance, web token for full roster.

---

## Connexion API (Francais)

L'extension se connecte a l'API officielle MSF pour recuperer vos donnees joueur. Deux methodes :

### Methode 1 : OAuth (recommande)

1. Cliquer sur le bouton **API** (🔑) dans l'extension
2. Cliquer **"Connexion OAuth MSF"**
3. Se connecter avec son compte **Scopely** sur la page officielle MSF
4. **Cocher toutes les permissions**, puis cliquer **"Autoriser"** :

| Permission | Ce que ca debloque |
|---|---|
| **Voir le profil** | Pseudo, niveau, puissance totale |
| **Voir l'effectif** | Personnages, equipes, favoris |
| **Voir l'inventaire** | Equipement, ressources |
| **Voir l'activite de jeu** | Avancee campagne, milestones |
| **Voir le profil d'alliance** | Donnees alliance, membres |
| **Acces persistant** | Empeche l'expiration auto du token |

5. Vous etes redirige vers l'extension — c'est fait !

> Le token se renouvelle automatiquement. Si la session expire, recliquez sur "Connexion OAuth MSF".

### Methode 2 : Token web (pour le roster complet)

La methode OAuth ne retourne pas les niveaux d'etoiles. Pour le roster complet :

1. Ouvrir [marvelstrikeforce.com/web-playable](https://marvelstrikeforce.com/fr/web-playable) dans un onglet
2. Appuyer sur **F5** pour recharger la page
3. Jouer quelques secondes — l'extension capture le token automatiquement
4. Revenir dans l'extension et cliquer **"Recuperer Squads"** dans le panneau Defense

> Les deux methodes sont complementaires. OAuth pour events/alliance, token web pour le roster complet.

---

## Privacy / Confidentialite

- All data is stored locally in your browser (`chrome.storage.local`)
- No external server, no tracking, no analytics
- Only connects to the official MSF API (`api.marvelstrikeforce.com`)
- OAuth tokens are stored locally and refresh automatically
- The OAuth client secret is removed from release builds

---

- Toutes les donnees sont stockees localement dans votre navigateur
- Pas de serveur externe, pas de tracking, pas d'analytics
- Connexion uniquement a l'API officielle MSF
- Les tokens OAuth sont stockes localement et se renouvellent automatiquement
- Le secret OAuth est retire des builds de release

---

## Architecture

```
popup/          Main UI (popup.html/js/css) + counter manager (manage.html/js)
modules/        OCR engine, war analyzer, perceptual hash, zone config
data/           JSON data (teams, counters, characters, farming, raids, backgrounds)
lib/            Tesseract.js (OCR WASM), Lucide Icons
bg.js           Background service worker (API calls, token management)
content.js      Content script (language detection, token capture)
scripts/        Build, deploy and debug tools
```

## License

This project is not affiliated with Scopely or Marvel. Marvel Strike Force is a trademark of Marvel/Scopely.

[MIT](LICENSE)
