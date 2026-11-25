import { HERO_STATS } from '../data/stats/rookie.js';
export { HERO_STATS };
import { applyResistance } from '../units/damage.js';
export const heroId = 'rookie';
export function onBasicAttack(game, troop, target) {
  if (troop.stats.basicAttack.applyRookieMark) applyRookieMark(game, troop, target);
}
export function onMarkHit(game, troop, target) { applyRookieMark(game, troop, target); }
export function onAbilityHit(game, troop, data, target) {
  if (data.applyRookieMark) applyRookieMark(game, troop, target);
}
export function onEffectDepleted(game, owner, target, effect) {
  if (effect.type === 'momentum-shield') detonateMomentumShield(game, effect.sourceUnit || owner, target, effect);
}
export function onEffectExpired(game, owner, target, effect) {
  if (effect.type === 'momentum-shield') detonateMomentumShield(game, effect.sourceUnit || owner, target, effect);
}
function detonateMomentumShield(game, owner, recipient, shield) {
  if (shield.detonated) return;
  shield.detonated = true;
  const momentum = Math.hypot(shield.momentumX || 0, shield.momentumY || 0);
  const radius = shield.momentumRadius || 54.4;
  const rawDamage = Math.round(momentum * (shield.momentumDamagePerUnit ?? 0.5));
  if (rawDamage <= 0) return;
  game.showDamageArea({ x: recipient.x, y: recipient.y, radius, team: owner.team });
  for (const enemy of game.board.enemyTargets(owner.team)) {
    if (enemy.hp <= 0 || Math.hypot(enemy.x - recipient.x, enemy.y - recipient.y) > radius + (enemy.radius || enemy.collisionRadius || 0)) continue;
    const armor = enemy.armor ?? enemy.stats?.armor ?? 0;
    const structureMultiplier = enemy.stats ? 1 : (owner.stats.structureDamageMultiplier ?? 1);
    const damage = applyResistance(rawDamage, armor, 'physical') * structureMultiplier;
    game.applyDamage(enemy, damage, owner, {
      ignoreRanged: true, skipFragile: true, skipDamageMitigationHooks: true,
      damageType: 'physical',
      mitigationRatio: rawDamage > 0 ? Math.max(0, Math.min(1, applyResistance(rawDamage, armor, 'physical') / rawDamage)) : 1,
    });
  }
  game.board.impacts.push({ x: recipient.x, y: recipient.y, radius, duration: 0.45,
    remainingSeconds: 0.45, kind: 'momentum-burst', team: owner.team });
  game.addEvent(`${game.teamName(owner.team)} ${owner.stats.name}'s Momentum Shield releases ${Math.round(momentum)} momentum for ${rawDamage} physical area damage.`, owner.team);
  game.resolveStructureOutcomes();
}
function applyRookieMark(game, rookie, target) {
  if (rookie?.stats.id !== 'rookie' || !target?.stats || target.hp <= 0) return;
  const fragile = target.effects.find((effect) => effect.type === 'fragile');
  if (fragile) {
    fragile.remainingTurns = 6;
    fragile.sourceTeam = rookie.team;
    return;
  }
  const markId = `rookie-mark-${rookie.team}`;
  let marks = target.effects.find((effect) => effect.id === markId);
  if (!marks) {
    target.addEffect({ id: markId, type: 'stacking-mark', displayLabel: 'Marks', maxStacks: 3, stacks: 0 });
    marks = target.effects.find((effect) => effect.id === markId);
  }
  marks.stacks += 1;
  if (marks.stacks < 3) return;
  target.effects = target.effects.filter((effect) => effect.id !== markId);
  target.addEffect({ id: 'rookie-fragile', type: 'fragile', sourceTeam: rookie.team, remainingTurns: 6 });
  game.addEvent(`${game.teamName(rookie.team)} Rookie made ${target.stats.name} fragile for 6 turns.`, rookie.team);
}
export default function createHeroBehavior() { return { heroId, onBasicAttack, onMarkHit, onAbilityHit, onEffectDepleted, onEffectExpired }; }
