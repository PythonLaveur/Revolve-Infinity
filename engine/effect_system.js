import { Effect } from '../units/effects.js';

/** Shared lifecycle for temporary effects applied to units. */
export class EffectSystem {
  static apply(unit, data) {
    if (['stun', 'airborne', 'knock-up', 'knockup'].includes(data.type))
      unit.resetMomentumShield?.();
    const existing = unit.effects.find((effect) => effect.id === data.id);
    if (existing) Object.assign(existing, data);
    else unit.effects.push(new Effect(data));
    unit.game?.history?.effectApplied(unit, data);
    return unit.effects.find((effect) => effect.id === data.id);
  }

  static tickTurns(unit) {
    unit.effects = unit.effects.filter((effect) => effect.tick());
  }

  static tickTime(unit, seconds) {
    unit.effects = unit.effects.filter((effect) => {
      if (effect.remainingSeconds === undefined) return true;
      effect.remainingSeconds -= seconds;
      return effect.remainingSeconds > 0;
    });
  }
}
