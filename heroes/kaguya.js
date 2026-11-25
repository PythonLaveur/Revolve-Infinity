import { HERO_STATS } from '../data/stats/kaguya.js';
export { HERO_STATS };
import { scaleDamage } from '../units/damage.js';

export const heroId = 'kaguya';
export function healAllies(game, kaguya, resolvedTarget, allies, profile) {
  const recipients = [
    resolvedTarget,
    ...allies
      .filter(
        (ally) =>
          ally !== resolvedTarget &&
          ally.hp < ally.maxHp &&
          kaguya.distanceToEdge(ally) <= kaguya.attackRange,
      )
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp),
  ].slice(0, (profile.healTargets || 0) + 1);
  const healAmount = Math.round(
    (profile.healFlat || 0) + scaleDamage(kaguya.stats, profile.healScaling || {}),
  );
  let totalHealed = 0;
  for (const ally of recipients) {
    const before = ally.hp;
    ally.hp = Math.min(
      ally.maxHp,
      ally.hp + Math.round(healAmount * game.allyBonusMultiplier(ally)),
    );
    const healed = ally.hp - before;
    totalHealed += healed;
    game.history.healing(kaguya, ally, healed);
  }
  kaguya.focus = resolvedTarget;
  return totalHealed;
}
export function onHealthDamage(game, kaguya, target, source, healthDamage, flags) {
  if (
    kaguya.hp <= 0 ||
    kaguya.team !== target?.team ||
    !source ||
    source.team === target.team ||
    flags.skipReflection
  ) return;
  const field = kaguya.effects.find(
    (effect) => effect.type === 'damage-reflect' && effect.remainingTurns > 0,
  );
  if (!field || kaguya.distanceToEdge(target) > field.radius) return;
  game.applyDamage(source, Math.round(healthDamage * field.multiplier), target, {
    skipReflection: true,
    damageType: flags.damageType || 'physical',
    mitigationRatio: flags.mitigationRatio,
  });
}
export function attackLog(game, kaguya, _targetName, healed) {
  if (kaguya.stats.targetPreference !== 'allies' || healed <= 0) return null;
  return `${game.teamName(kaguya.team)} ${kaguya.stats.name} restored ${healed} HP to allies`;
}
export default function createHeroBehavior() { return { heroId, healAllies, onHealthDamage, attackLog }; }
