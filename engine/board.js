export class Board {
  constructor() {
    this.width = 1560;
    this.height = 570;
    this.troops = [];
    this.projectiles = [];
    this.zones = [];
    this.strikes = [];
    this.impacts = [];
    this.areaEffects = [];
    this.grassPatches = [];
    this.river = { x: 740, y: 0, w: 80, h: 570 };
    this.bridges = [
      { x: 700, y: 101, w: 160, h: 84 },
      { x: 700, y: 385, w: 160, h: 84 },
    ];
    this.terrains = [];
    this.towers = [
      {
        team: 0,
        x: 135,
        y: 285,
        hp: 2838,
        maxHp: 2838,
        armor: 70,
        magicResist: 70,
        range: 247.5,
        damage: 123,
        focus: null,
        targetable: true,
        type: 'base',
      },
      {
        team: 1,
        x: 1425,
        y: 285,
        hp: 2838,
        maxHp: 2838,
        armor: 70,
        magicResist: 70,
        range: 247.5,
        damage: 123,
        focus: null,
        targetable: true,
        type: 'base',
      },
    ];
    this.turrets = [
      {
        team: 0,
        x: 245,
        y: 143,
        hp: 2289,
        maxHp: 2289,
        armor: 60,
        magicResist: 60,
        range: 204,
        damage: 153,
        focus: null,
        targetable: true,
        layer: 'inner',
        radius: 27,
      },
      {
        team: 0,
        x: 245,
        y: 427,
        hp: 2289,
        maxHp: 2289,
        armor: 60,
        magicResist: 60,
        range: 204,
        damage: 153,
        focus: null,
        targetable: true,
        layer: 'inner',
        radius: 27,
      },
      {
        team: 0,
        x: 500,
        y: 143,
        hp: 2289,
        maxHp: 2289,
        armor: 60,
        magicResist: 60,
        range: 204,
        damage: 153,
        focus: null,
        targetable: true,
        layer: 'outer',
        radius: 27,
      },
      {
        team: 0,
        x: 500,
        y: 427,
        hp: 2289,
        maxHp: 2289,
        armor: 60,
        magicResist: 60,
        range: 204,
        damage: 153,
        focus: null,
        targetable: true,
        layer: 'outer',
        radius: 27,
      },
      {
        team: 1,
        x: 1315,
        y: 143,
        hp: 2289,
        maxHp: 2289,
        armor: 60,
        magicResist: 60,
        range: 204,
        damage: 153,
        focus: null,
        targetable: true,
        layer: 'inner',
        radius: 27,
      },
      {
        team: 1,
        x: 1315,
        y: 427,
        hp: 2289,
        maxHp: 2289,
        armor: 60,
        magicResist: 60,
        range: 204,
        damage: 153,
        focus: null,
        targetable: true,
        layer: 'inner',
        radius: 27,
      },
      {
        team: 1,
        x: 1060,
        y: 143,
        hp: 2289,
        maxHp: 2289,
        armor: 60,
        magicResist: 60,
        range: 204,
        damage: 153,
        focus: null,
        targetable: true,
        layer: 'outer',
        radius: 27,
      },
      {
        team: 1,
        x: 1060,
        y: 427,
        hp: 2289,
        maxHp: 2289,
        armor: 60,
        magicResist: 60,
        range: 204,
        damage: 153,
        focus: null,
        targetable: true,
        layer: 'outer',
        radius: 27,
      },
    ];
  }
  addTroop(troop) {
    this.troops.push(troop);
  }
  troopsFor(team) {
    return this.troops.filter((t) => t.team === team && t.hp > 0 && !t.burrowed);
  }
  enemyTargets(team) {
    return [
      ...this.troops.filter((t) => t.team !== team && t.hp > 0 && !t.burrowed),
      ...this.turrets.filter((t) => t.team !== team && t.hp > 0),
      ...this.towers.filter((t) => t.team !== team && t.hp > 0),
    ];
  }
  removeDefeated() {
    this.troops = this.troops.filter((t) => t.hp > 0);
  }
}
