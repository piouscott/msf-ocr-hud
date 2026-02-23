# Exploration du CDN MSF - Résultats

## Tests effectués

Script: `scripts/test-msf-assets.js`
Date: 2026-02-21

## Résultats

### ✅ Disponible : Portraits de personnages

```
https://assets.marvelstrikeforce.com/imgs/Portrait_CharacterName_hash.png
```

**Exemples:**
- `https://assets.marvelstrikeforce.com/imgs/Portrait_Abomination_d466494d.png`
- `https://assets.marvelstrikeforce.com/imgs/Portrait_AdamWarlock_68514641.png`
- `https://assets.marvelstrikeforce.com/imgs/Portrait_AgathaHarkness_ead1f20a.png`

✅ **Déjà utilisé dans l'extension** via `data/characters-full.json`

### ❌ Non disponible : Icônes UI

Tous les patterns testés retournent **404 Not Found** :

```
/imgs/icons/war.png
/imgs/icons/raid.png
/imgs/icons/calendar.png
/imgs/icons/shield.png
/imgs/icons/star.png
/imgs/icons/power.png
/imgs/ui/header_bg.png
/imgs/ui/panel_bg.png
/imgs/teams/xmen.png
```

## Conclusion

Le CDN public MSF (`assets.marvelstrikeforce.com`) ne sert **QUE** les portraits de personnages.

Les icônes UI ne sont pas accessibles publiquement. Elles sont probablement :
- Embarquées dans les bundles du jeu mobile/web
- Sur un CDN privé
- Compilées en sprites/atlas non accessibles individuellement

## Options pour l'extension

### Option 1 : Garder les emojis actuels ✅
**Avantages:**
- Déjà implémenté et fonctionnel
- Pas de dépendance externe
- Compatibilité universelle
- Léger

**Inconvénients:**
- Moins "MSF-authentique"

### Option 2 : Utiliser une bibliothèque d'icônes tierce
**Bibliothèques recommandées:**
- **Lucide Icons** (https://lucide.dev) - SVG légers, MIT license
- **Heroicons** (https://heroicons.com) - Par Tailwind, MIT license
- **Phosphor Icons** (https://phosphoricons.com) - Style game-friendly

**Exemple avec Lucide:**
```html
<script src="https://unpkg.com/lucide@latest"></script>
<script>
  lucide.createIcons({
    attrs: { class: 'msf-icon' }
  });
</script>

<!-- Dans le HTML -->
<button>
  <i data-lucide="shield"></i> Defense
</button>
```

### Option 3 : Créer nos propres icônes SVG
**Avantages:**
- Total contrôle du design
- Peut matcher le style MSF
- Pas de dépendance

**Inconvénients:**
- Demande du travail de design
- Maintenance

### Option 4 : Extraire du jeu (⚠️ Légalité incertaine)
**Méthode:** Inspecter le bundle du jeu web avec DevTools
**Risques:**
- Possibles problèmes de copyright
- Assets peut-être encodés/protégés
- Non recommandé sans permission explicite

## Recommandation

Pour rester 100% légal et professionnel :

1. **Court terme:** Garder les emojis actuels (fonctionnels, universels)
2. **Moyen terme:** Intégrer Lucide Icons pour un look plus pro
3. **Long terme:** Si l'extension devient populaire, contacter Scopely pour permissions

## Alternative : Thème couleurs MSF uniquement

Au lieu d'utiliser les icônes MSF, on peut juste adopter leur palette de couleurs pour donner le "look MSF" :

```json
{
  "colors": {
    "primary": "#0a1628",
    "secondary": "#1a2942",
    "accent": "#d4af37",
    "accent_bright": "#ffd700",
    "text_primary": "#e8eaed",
    "text_secondary": "#9aa0a6",
    "border": "#2d3e56",
    "success": "#51cf66",
    "warning": "#fcc419",
    "danger": "#ff6b6b"
  }
}
```

Ceci + des emojis stylisés = look cohérent MSF sans assets officiels.
