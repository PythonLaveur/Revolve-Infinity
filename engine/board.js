import { BASE_STATS, TURRET_STATS, STRUCTURE_LAYOUT } from '../data/stats/turrets.js';
import { RADIUS_PER_SIZE } from '../units/stats.js';
import { GAME_PARAMS } from '../data/game_parameters.js';

export class Board {
  constructor() {
    const { width, height, riverWidth, bridgeWidth, bridgeHeight, bridgeLaneOffsetY } = GAME_PARAMS.arena;
    this.width = width;
    this.height = height;
    this.troops = [];
    this.projectiles = [];
    this.attackAnimations = [];
    this.zones = [];
    this.strikes = [];
    this.impacts = [];
    this.areaEffects = [];
    this.grassPatches = [];
    this.river = { x: (width - riverWidth) / 2, y: 0, w: riverWidth, h: height };
    this.bridges = [
      { x: (width - bridgeWidth) / 2, y: height / 2 - bridgeLaneOffsetY - bridgeHeight / 2, w: bridgeWidth, h: bridgeHeight },
      { x: (width - bridgeWidth) / 2, y: height / 2 + bridgeLaneOffsetY - bridgeHeight / 2, w: bridgeWidth, h: bridgeHeight },
    ];
    this.terrains = [];
    this.towers = STRUCTURE_LAYOUT.base.map((position) => ({
      ...BASE_STATS, ...position, radius: BASE_STATS.size * RADIUS_PER_SIZE,
      maxHp: BASE_STATS.hp, focus: null, targetable: true, type: 'base',
    }));
    this.turrets = STRUCTURE_LAYOUT.turrets.map((position) => ({
      ...TURRET_STATS, ...position, radius: TURRET_STATS.size * RADIUS_PER_SIZE,
      maxHp: TURRET_STATS.hp, focus: null, targetable: true,
    }));
  }
  addTroop(troop) {
    troop.game = this.game || null;
    this.troops.push(troop);
  }
  troopsFor(team) {
    return this.troops.filter((t) => t.team === team && t.hp > 0 && !t.burrowed);
  }
  enemyTargets(team) {
    return [
      ...this.troops.filter((t) => t.team !== team && t.hp > 0 && !t.burrowed && !t.isUntargetable),
      ...this.turrets.filter((t) => t.team !== team && t.hp > 0),
      ...this.towers.filter((t) => t.team !== team && t.hp > 0),
    ];
  }
  removeDefeated() {
    this.troops = this.troops.filter((t) => t.hp > 0);
  }
}
