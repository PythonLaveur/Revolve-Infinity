import { BaseAbility } from './base_ability.js';
export class Fireball extends BaseAbility {
  cast(game, caster, x, y) {
    for (const troop of game.board.troops) {
      if (troop.team !== caster.team && Math.hypot(troop.x - x, troop.y - y) <= this.data.radius) {
        troop.hp -= Math.round(troop.maxHp * this.data.damageFraction);
      }
    }
    game.board.removeDefeated();
    return true;
  }
}
