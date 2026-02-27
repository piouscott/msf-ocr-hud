# MSF Counter

Extension navigateur pour **Marvel Strike Force** — counters de guerre, scan OCR des salles, gestion de la defense, events, raids et farming.

Compatible **Chrome**, **Vivaldi**, **Firefox** (Manifest V3).

## Fonctionnalites

- **Counters de guerre** — Base de donnees de counters offensifs et defensifs, recherche par equipe
- **Scan de salle (War OCR)** — Capture d'ecran de la salle ennemie, identification automatique des equipes par OCR + reconnaissance de portraits, suggestion de counters avec indicateur de punch up/down
- **Defense** — Gestion des equipes en defense, detection des conflits (perso en defense suggere en counter)
- **Events** — Suivi des events actifs avec scoring et progression
- **Raids** — Equipes recommandees par noeud avec conditions colorees
- **Farm** — Recherche de personnages, filtres, advisor counters, suivi du roster
- **API MSF** — Recuperation automatique du roster, des squads et des events via l'API officielle
- **Apprentissage** — Systeme semi-automatique : les corrections de portraits sont memorisees pour les scans suivants

## Installation

### Depuis les sources (developpeurs)

1. Cloner le repo :
   ```bash
   git clone https://github.com/piouscott/msf-ocr-hud.git
   ```

2. Charger dans le navigateur :
   - **Chrome/Vivaldi** : `chrome://extensions` > Mode developpeur > Charger l'extension non empaquetee > selectionner le dossier
   - **Firefox** : `about:debugging#/runtime/this-firefox` > Charger un module temporaire > selectionner `manifest.json`

### Depuis le ZIP (testeurs)

Voir le [guide d'installation complet](docs/INSTALLATION-TESTER.md).

## Guides d'utilisation

- [Guide War OCR (scan de salle)](docs/WAR-OCR-GUIDE.md) — Comment scanner une salle, corriger les portraits, calibrer les zones
- [Guide d'installation](docs/INSTALLATION-TESTER.md) — Installation pas a pas pour Chrome, Firefox, Vivaldi

## Architecture

```
popup/          Interface principale (popup.html/js/css) + page counters (manage.html/js)
modules/        Moteur OCR, analyse de guerre, hash perceptuel, zones de decoupe
data/           Donnees JSON (equipes, counters, personnages, farming)
lib/            Tesseract.js (OCR WASM), Lucide Icons
bg.js           Background service worker (capture token API, appels API)
content.js      Content script (detection langue, injection)
scripts/        Outils de build, debug et generation de donnees
docs/           Documentation utilisateur
```

## Donnees

Les donnees de counters sont basees sur les infographies de la communaute MSF (Marvel Church, etc.) et mises a jour manuellement. Les personnages sont synchronises dynamiquement depuis l'API MSF lorsque le roster du joueur est recupere.

## Contribuer

Les issues et pull requests sont bienvenues ! Voir les [issues ouvertes](https://github.com/piouscott/msf-ocr-hud/issues).

## Licence

[MIT](LICENSE)
