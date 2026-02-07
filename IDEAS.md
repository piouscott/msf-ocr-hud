# MSF Counter - Idees de fonctionnalites

## Donnees disponibles

### API prod-api
- `getPlayerRoster` - tous les personnages du joueur (351 chars)
- `squads` - equipes sauvegardees du joueur
- `getCharacterList` - liste de tous les personnages du jeu

### /game/v1/events (x-api-key seul, pas besoin de Bearer token)
- Evenements en cours avec conditions de scoring
- Teams requises pour certains events
- Points par action (raids, war, blitz, etc.)

Structure EventInfo:
- `id`, `name`, `startTime`, `endTime`
- `type`: blitz, milestone, episodic, warSeason, raidSeason, tower, etc.

Pour blitz/tower events:
- `requirements.anyCharacterFilters.allTraits` - Traits requis (ex: "Mutant", "X-Men")
- `requirements.anyCharacterFilters.anyTraits` - Au moins un de ces traits
- `requirements.anyCharacterFilters.anyCharacters` - Personnages specifiques

Pour milestone events:
- `scoring.methods[].description` - "Win War battles", "Complete Raid nodes"
- `scoring.methods[].points` - Points par action

### /player/v1/events (x-api-key + Bearer token)
- Events avec progression du joueur
- Necessite le token capture

### Donnees locales
- `teams.json` - definitions des equipes
- `counters.json` - counters par equipe
- `characters-full.json` - portraits et traits

---

## Idees de fonctionnalites

### 1. Event -> Counters inverses (PRIORITAIRE)
Event dit "Utilisez X-Men en guerre" -> Bouton "Voir cibles" -> Liste les equipes que X-Men peuvent counter efficacement.
- Inverser la logique des counters: "Cette equipe counter quoi ?"
- Afficher avec niveau de confiance

### 2. Equipes a farmer en priorite
- Analyser les counters ou il manque 1-2 persos
- "Farmez Ikaris -> debloque 3 counters (Eternals, Eternals+Kestrel, ...)"
- Classement par impact (nombre de counters debloques)

### 3. Score Event Estimator
- Event blitz/raid avec bonus sur certaines teams
- Calculer le score max possible avec le roster du joueur
- "Teams eligibles que vous avez: 12/15 -> potentiel ~2.5M points"

### 4. War Defense Advisor
- Inverser les counters: "Cette equipe est difficile a counter"
- Suggerer les defenses ou peu de joueurs ont le counter complet
- Base sur la rarete des persos requis dans les counters

### 5. Power Gap Warning
- Si le joueur a un counter mais sous-power
- "Tes Eternals (450k) sont trop faibles pour counter War Dogs SCP (650k+)"
- Suggerer le ratio minimum requis

### 6. Event Team Checklist
- Event demande "Mutants en raid"
- Afficher les equipes mutantes du joueur avec leur puissance
- Highlight celles qui sont viables vs celles a farmer

### 7. Mode "Combat" rapide en War
- Selectionner l'equipe ennemie vue
- Filtrer les counters que le joueur possede ET qui sont assez forts
- Interface simplifiee pour decision rapide

---

## Implementation suggeree

### Phase 1 - Counters inverses
1. Appeler `/game/v1/events` avec x-api-key (deja disponible dans popup.js)
2. Extraire les requirements (traits) des events blitz/tower
3. Mapper traits -> equipes via teams.json
4. Inverser counters.json: "Cette equipe counter quoi ?"
5. Dans panel Events, ajouter bouton "Voir cibles" par team

### Phase 2 - Farming advisor
1. Analyser tous les counters
2. Pour chaque counter incomplet, calculer les persos manquants
3. Classer par nombre de counters debloques si complete

### Phase 3 - Integration Events
1. Parser les events pour extraire les teams requises
2. Croiser avec roster du joueur
3. Afficher checklist avec statut (complet/incomplet/puissance)

---

## Notes techniques

- Les invocations (summons) ne comptent pas pour la possession d'equipe
- Le roster est stocke dans `msfPlayerRoster` (storage local)
- `/game/v1/events` utilise seulement x-api-key (pas besoin du Bearer token joueur)
- `/player/v1/events` necessite x-api-key + Bearer token (pour progression joueur)
- x-api-key deja disponible: `MSF_API_KEY` dans popup.js

---

Derniere mise a jour: 2026-02-07
