# Intégration des Assets MSF

Guide pour améliorer visuellement l'extension avec les assets de l'API publique MSF.

## Vue d'ensemble

Le module `UIAssetsLoader` permet de charger les icônes et assets MSF depuis leur API publique, avec fallback automatique sur les emojis si les assets ne sont pas disponibles.

## Fichiers créés

- `data/ui-assets.json` - Configuration des URLs d'assets
- `modules/ui-assets-loader.js` - Module de chargement

## Intégration dans popup.html

Ajouter le script avant `popup.js` :

```html
<script src="../modules/ui-assets-loader.js"></script>
<script src="popup.js"></script>
```

## Utilisation dans popup.js

### 1. Initialisation

```javascript
// Au début de popup.js
const uiAssets = new UIAssetsLoader();

// Charger la config au démarrage
uiAssets.load().then(() => {
  console.log("[Popup] UI Assets chargés");
  enhanceToolbarIcons();
  uiAssets.applyTheme();
});
```

### 2. Améliorer les icônes de toolbar

```javascript
function enhanceToolbarIcons() {
  // Mapping bouton → icône MSF + emoji fallback
  const iconMap = {
    "btn-events": { icon: "events", emoji: "📅" },
    "btn-raids": { icon: "raid", emoji: "💀" },
    "btn-defense": { icon: "defense", emoji: "🛡️" },
    "btn-farm": { icon: "farm", emoji: "🌾" },
    "btn-manage": { icon: "counters", emoji: "⚔️" },
    "btn-war-ocr": { icon: "war", emoji: "🎯" },
    "btn-battleworld": { icon: "battleworld", emoji: "🌍" }
  };

  Object.entries(iconMap).forEach(([btnId, { icon, emoji }]) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      uiAssets.setButtonIcon(btn, icon, emoji);
    }
  });
}
```

### 3. Utiliser les couleurs du thème

```javascript
// Les couleurs sont disponibles en variables CSS
// --msf-primary, --msf-accent, --msf-success, etc.

// Ou en JS
const accentColor = uiAssets.getColor("accent");
element.style.borderColor = accentColor;
```

## Trouver les URLs des assets MSF

### Méthode 1 : Inspecter le jeu web

1. Ouvrir https://marvelstrikeforce.com/fr/web-playable
2. Ouvrir DevTools (F12) → Onglet Network
3. Filtrer par "Img"
4. Jouer et observer les assets chargés
5. Copier les URLs des icônes intéressantes

### Méthode 2 : API MSF

Les assets sont généralement sur :
```
https://assets.marvelstrikeforce.com/imgs/
```

Structures courantes :
- `/imgs/icons/` - Icônes UI
- `/imgs/portraits/` - Portraits personnages (déjà utilisé)
- `/imgs/teams/` - Icônes d'équipes
- `/imgs/ui/` - Éléments UI (backgrounds, boutons)

### Méthode 3 : Reverse engineering du CDN

```bash
# Tester des URL patterns
https://assets.marvelstrikeforce.com/imgs/icons/war.png
https://assets.marvelstrikeforce.com/imgs/icons/raid.png
https://assets.marvelstrikeforce.com/imgs/icons/calendar.png
```

## Mise à jour du fichier ui-assets.json

Une fois les URLs trouvées, mettre à jour `data/ui-assets.json` :

```json
{
  "baseUrl": "https://assets.marvelstrikeforce.com",
  "icons": {
    "war": "/imgs/icons/war_icon.png",
    "raid": "/imgs/icons/raid_icon.png",
    "events": "/imgs/icons/event_icon.png"
  }
}
```

## Exemple complet

```javascript
// Dans popup.js, après le chargement du DOM
document.addEventListener("DOMContentLoaded", async () => {
  // Charger les assets MSF
  await uiAssets.load();

  // Appliquer le thème CSS
  uiAssets.applyTheme();

  // Améliorer les icônes toolbar
  enhanceToolbarIcons();

  // Reste de l'initialisation...
  initApp();
});
```

## Avantages

✅ **Fallback automatique** - Si une icône échoue, garde l'emoji
✅ **Cache intégré** - Les icônes ne sont chargées qu'une fois
✅ **Cross-origin safe** - Gère le CORS automatiquement
✅ **Thème unifié** - Variables CSS pour cohérence visuelle
✅ **Pas de bundling** - Assets chargés depuis le CDN MSF

## Notes importantes

- Les URLs d'assets MSF peuvent changer avec les mises à jour du jeu
- Toujours avoir un fallback emoji fonctionnel
- Tester sur plusieurs navigateurs (Chrome, Firefox, Vivaldi)
- Les assets sont automatiquement cachés par le navigateur

## Prochaines étapes

1. Trouver les URLs réelles des icônes MSF
2. Mettre à jour `data/ui-assets.json`
3. Intégrer `UIAssetsLoader` dans `popup.js`
4. Tester le fallback en cas d'échec de chargement
5. (Optionnel) Ajouter des backgrounds MSF pour les panels
