/**
 * Inverse Counters Module
 * Permet de trouver ce qu'une équipe peut battre (au lieu de ce qui la bat)
 */

class InverseCounters {
  constructor() {
    this.counters = {};        // Original: defense -> [attackers]
    this.inverseCounters = {}; // Inverse: attacker -> [defenses it beats]
    this.teams = [];
    this.loaded = false;
  }

  async init() {
    if (this.loaded) return;

    const ext = typeof browser !== "undefined" ? browser : chrome;

    try {
      // Charger teams.json et counters.json
      const [teamsRes, countersRes] = await Promise.all([
        fetch(ext.runtime.getURL("data/teams.json")),
        fetch(ext.runtime.getURL("data/counters.json"))
      ]);

      const teamsData = await teamsRes.json();
      const countersData = await countersRes.json();

      this.teams = teamsData.teams || [];
      this.counters = countersData.counters || {};

      // Charger les counters custom/remote depuis storage
      const stored = await new Promise(resolve => {
        ext.storage.local.get(["msfRemoteCounters", "msfCustomCounters"], resolve);
      });

      if (stored.msfRemoteCounters?.counters) {
        Object.assign(this.counters, stored.msfRemoteCounters.counters);
      }
      if (stored.msfCustomCounters) {
        Object.assign(this.counters, stored.msfCustomCounters);
      }

      // Construire l'index inverse
      this._buildInverseIndex();

      this.loaded = true;
      console.log("[InverseCounters] Chargé:", Object.keys(this.inverseCounters).length, "équipes offensives");

    } catch (e) {
      console.error("[InverseCounters] Erreur init:", e);
    }
  }

  /**
   * Construit l'index inverse: attacker -> [defenses it beats]
   */
  _buildInverseIndex() {
    this.inverseCounters = {};

    for (const [defenseTeamId, attackers] of Object.entries(this.counters)) {
      for (const counter of attackers) {
        const attackerTeamId = counter.team;

        if (!this.inverseCounters[attackerTeamId]) {
          this.inverseCounters[attackerTeamId] = [];
        }

        this.inverseCounters[attackerTeamId].push({
          defense: defenseTeamId,
          confidence: counter.confidence,
          notes: counter.notes || null
        });
      }
    }

    // Trier par confiance décroissante
    for (const teamId of Object.keys(this.inverseCounters)) {
      this.inverseCounters[teamId].sort((a, b) => b.confidence - a.confidence);
    }
  }

  /**
   * Trouve le nom d'une équipe par son ID
   */
  getTeamName(teamId) {
    const team = this.teams.find(t => t.id === teamId);
    return team ? team.name : teamId;
  }

  /**
   * Trouve l'ID d'une équipe par son nom
   */
  getTeamId(teamName) {
    const normalizedName = teamName.toUpperCase().trim();
    const team = this.teams.find(t =>
      t.name.toUpperCase() === normalizedName ||
      t.id.toUpperCase() === normalizedName
    );
    return team ? team.id : null;
  }

  /**
   * Retourne la liste des équipes qui peuvent counter une défense donnée
   * (fonction existante - qui peut battre cette défense?)
   */
  getCountersFor(defenseTeamId) {
    const counters = this.counters[defenseTeamId] || [];
    return counters.map(c => ({
      teamId: c.team,
      teamName: this.getTeamName(c.team),
      confidence: c.confidence,
      notes: c.notes || null
    }));
  }

  /**
   * Retourne la liste des défenses qu'une équipe peut battre
   * (nouvelle fonction inverse - qu'est-ce que cette équipe peut battre?)
   */
  getWhatCanBeat(attackerTeamId) {
    const targets = this.inverseCounters[attackerTeamId] || [];
    return targets.map(t => ({
      defenseId: t.defense,
      defenseName: this.getTeamName(t.defense),
      confidence: t.confidence,
      notes: t.notes || null
    }));
  }

  /**
   * Retourne toutes les équipes avec leurs cibles potentielles
   * Utile pour l'affichage dans le panneau Events/War
   */
  getAllOffensiveTeams() {
    const result = [];

    for (const [teamId, targets] of Object.entries(this.inverseCounters)) {
      const teamName = this.getTeamName(teamId);
      result.push({
        teamId,
        teamName,
        targets: targets.map(t => ({
          defenseId: t.defense,
          defenseName: this.getTeamName(t.defense),
          confidence: t.confidence,
          notes: t.notes
        })),
        targetCount: targets.length
      });
    }

    // Trier par nombre de cibles (les plus polyvalentes en premier)
    result.sort((a, b) => b.targetCount - a.targetCount);

    return result;
  }

  /**
   * Retourne toutes les équipes de défense
   */
  getAllDefenseTeams() {
    return Object.keys(this.counters).map(teamId => ({
      teamId,
      teamName: this.getTeamName(teamId),
      counterCount: this.counters[teamId].length
    })).sort((a, b) => a.teamName.localeCompare(b.teamName));
  }
}

// Export pour utilisation dans popup.js
if (typeof window !== "undefined") {
  window.InverseCounters = InverseCounters;
}
