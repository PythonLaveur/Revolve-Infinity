// Balance source of truth for arena structures.
export const BASE_STATS = {
  aggro: 1,
  size: 3,
  hp: 2838,
  armor: 70,
  magicResist: 70,
  range: 240,
  damage: 123,
};
export const TURRET_STATS = {
  aggro: 1,
  size: 2,
  hp: 2289,
  armor: 60,
  magicResist: 60,
  range: 210,
  damage: 153,
};
export const STRUCTURE_LAYOUT = {
  base: [
    { team: 0, x: 135, y: 285 },
    { team: 1, x: 1425, y: 285 },
  ],
  turrets: [
    { team: 0, x: 245, y: 143, layer: 'inner' },
    { team: 0, x: 245, y: 427, layer: 'inner' },
    { team: 0, x: 500, y: 143, layer: 'outer' },
    { team: 0, x: 500, y: 427, layer: 'outer' },
    { team: 1, x: 1315, y: 143, layer: 'inner' },
    { team: 1, x: 1315, y: 427, layer: 'inner' },
    { team: 1, x: 1060, y: 143, layer: 'outer' },
    { team: 1, x: 1060, y: 427, layer: 'outer' },
  ],
};
