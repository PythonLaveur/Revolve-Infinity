import { GAME_PARAMS } from '../game_parameters.js';

// Balance source of truth for arena structure combat stats.
export const BASE_STATS = {
  aggro: 1,
  size: 3,
  hp: 2838,
  armor: 70,
  magicResist: 70,
  range: 224,
  inhibitionRangeMultiplier: 1.1,
  damage: 123,
};
export const TURRET_STATS = {
  aggro: 1,
  size: 2,
  hp: 2289,
  armor: 60,
  magicResist: 60,
  range: 210,
  inhibitionRangeMultiplier: 1.2,
  damage: 153,
};
const {
  width,
  height,
  kingTowerDepthFromEdge,
  innerTurretDepthFromEdge,
  outerTurretDepthFromEdge,
  turretLaneOffsetY,
} = GAME_PARAMS.arena;
const laneYs = [height / 2 - turretLaneOffsetY, height / 2 + turretLaneOffsetY];
const positionsForDepth = (depth, layer) =>
  [0, 1].flatMap((team) =>
    laneYs.map((y) => ({
      team,
      x: team === 0 ? depth : width - depth,
      y,
      ...(layer ? { layer } : {}),
    })),
  );

export const STRUCTURE_LAYOUT = {
  base: [0, 1].map((team) => ({
    team,
    x: team === 0 ? kingTowerDepthFromEdge : width - kingTowerDepthFromEdge,
    y: height / 2,
  })),
  turrets: [
    ...positionsForDepth(innerTurretDepthFromEdge, 'inner'),
    ...positionsForDepth(outerTurretDepthFromEdge, 'outer'),
  ],
};
