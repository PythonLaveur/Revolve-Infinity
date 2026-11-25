// Global match and arena parameters. Gameplay modules should import from here
// instead of duplicating match-wide values.
export const GAME_PARAMS = {
  draft: {
    secondsPerChoice: 15,
    order: [
      { team: 1, kind: 'ban', count: 1 },
      { team: 0, kind: 'ban', count: 2 },
      { team: 1, kind: 'ban', count: 1 },
      { team: 0, kind: 'pick', count: 1 },
      { team: 1, kind: 'pick', count: 2 },
      { team: 0, kind: 'pick', count: 2 },
      { team: 1, kind: 'pick', count: 2 },
      { team: 0, kind: 'pick', count: 2 },
      { team: 1, kind: 'pick', count: 2 },
      { team: 0, kind: 'pick', count: 2 },
      { team: 1, kind: 'pick', count: 1 },
    ],
  },
  teamSize: 7,
  hands: {
    heroCards: 3,
    abilityCards: 9,
    redrawMax: 3,
  },
  movement: {
    heroPathfindingBudgetMs: 5000,
    minionPathfindingBudgetMs: 1000,
  },
  economy: {
    startingElixir: 1200,
    elixirPerTurn: 100,
    maxElixir: 2000,
    startingAP: 200,
    APPerTurn: 50,
    maxAP: 2000,
    redrawCost: 100,
  },
  arena: {
    width: 1512,
    height: 560,
    tileSize: 28,
    riverWidth: 60,
    bridgeWidth: 112,
    bridgeHeight: 88,
    bridgeLaneOffsetY: 154,
    kingTowerDepthFromEdge: 112,
    innerTurretDepthFromEdge: 154,
    outerTurretDepthFromEdge: 490,
    turretLaneOffsetY: 154,
  },
};

export default GAME_PARAMS;
