import { HERO_STATS } from '../data/stats/rayka.js';
export { HERO_STATS };
export const heroId = 'rayka';

export function createRaykaThunderstorm(game, rayka, x, y, overrides = {}) {
  const empowerment = rayka.effects.find(
    (effect) => effect.type === 'rayka-storm-empower' && effect.remainingTurns > 0,
  );
  const multiplier = overrides.damageMultiplier ?? empowerment?.stormMultiplier ?? 1;
  const radius = overrides.radius ?? rayka.stats.basicAttack.thunderstormRadius * multiplier;
  const duration = overrides.duration ?? (empowerment ? 4 : rayka.stats.basicAttack.thunderstormDuration);
  const zone = {
    id: `rayka-storm-${game.squadCounter++}`,
    abilityId: 'rayka_storm',
    caster: rayka,
    team: rayka.team,
    x,
    y,
    radius,
    remainingTurns: duration,
    damagePerTurnScaling: rayka.stats.basicAttack.scaling,
    damageMultiplier: multiplier,
    affectsStructures: true,
    structureDamageMultiplier: 0.5,
    chainOnStructures: overrides.chainOnBuildings ?? true,
    chainedStructures: new Set(),
    visualizeDamage: false,
    visual: {
      fill: 'rgba(41, 153, 223, 0.17)',
      stroke: '#ffe27a',
      lineWidth: 4,
      dash: [14, 7],
      innerRadiusMultiplier: 0.72,
      label: 'THUNDERSTORM',
    },
  };
  game.board.zones.push(zone);
  return zone;
}
export function beforeBasicAttack(game, rayka, target, profile) {
  if (!profile.thunderstorm) return null;
  createRaykaThunderstorm(game, rayka, target.x, target.y);
  rayka.focus = target;
  return { handled: true, result: 0 };
}

export function onTurnStart(_game, rayka) { rayka.energyGeneratedThisTurn = false; }
export function onTurnEnd(_game, rayka) {
  if (rayka.energyGeneratedThisTurn) rayka.energyIdleTurns = 0;
  else {
    rayka.energyIdleTurns += 1;
    if (rayka.energyIdleTurns > (rayka.stats.resourceDecayGraceTurns ?? 2))
      rayka.energy *= rayka.stats.resourceDecayMultiplier ?? 0.9;
  }
}
export function validateAbility(game, rayka, data) {
  if (data.requireNoFocus) {
    rayka.validateFocus(game.targetsFor(rayka));
    if (rayka.focus) return { valid: false, message: `${data.name} can only be used while ${rayka.stats.name} has no focus` };
  }
  if (data.requiresEnergy && rayka.energy <= 0)
    return { valid: false, message: `${data.name} requires ${rayka.stats.name} to have energy` };
  return null;
}
export function activateAbility(_game, rayka, data) {
  if (data.raykaAegis) {
    rayka.addEffect({ id: `${data.id}-active`, type: 'rayka-aegis', healMultiplier: data.aegisHealMultiplier, energyPerHit: data.energyPerStormHit, remainingTurns: data.duration });
    return true;
  }
  if (data.raykaStormEmpower) {
    const consumed = rayka.energy;
    rayka.energy = 0;
    rayka.energyIdleTurns = 0;
    rayka.energyGeneratedThisTurn = false;
    rayka.addEffect({
      id: `${data.id}-active`, type: 'rayka-storm-empower', energyConsumed: consumed,
      stormMultiplier: 1 + consumed * data.energyDamageAndRadiusPerStack, remainingTurns: data.duration,
    });
    _game.addEvent(`${_game.teamName(rayka.team)} ${rayka.stats.name} consumed ${consumed.toFixed(1)} energy to empower her storms.`, rayka.team);
    return true;
  }
  return false;
}
export function onHealthDamage(_game, rayka, target, _source, healthDamage) {
  if (rayka.hp <= 0 || rayka.burrowed || rayka.team === target?.team || !target?.stats) return;
  for (const effect of rayka.effects.filter((active) => active.type === 'damage-to-shield')) {
    if (rayka.distanceToEdge(target) > effect.triggerRadius) continue;
    const shieldId = `${effect.id}-generated`;
    let shield = rayka.effects.find((active) => active.id === shieldId);
    if (!shield) {
      rayka.addEffect({ id: shieldId, type: 'shield', remainingAmount: 0, remainingTurns: effect.remainingTurns });
      shield = rayka.effects.find((active) => active.id === shieldId);
    }
    shield.remainingAmount += healthDamage * effect.multiplier;
  }
}
export function onZoneHit(game, rayka, zone, target, healthDamage) {
  if (!zone.affectsStructures) return;
  const skillThreeActive = rayka.effects.some(
    (effect) => effect.type === 'rayka-storm-empower' && effect.remainingTurns > 0,
  );
  if (skillThreeActive && target.stats && !target.stats.isBuilding) {
    target.addEffect({ id: `rayka-confused-${zone.id}`, type: 'confused', remainingTurns: 2 });
  }
  if (!target.stats || target.stats.isBuilding || healthDamage <= 0) return;
  const aegis = rayka.effects.find(
    (effect) => effect.type === 'rayka-aegis' && effect.remainingTurns > 0,
  );
  if (!aegis) return;
  const before = rayka.hp;
  rayka.hp = Math.min(rayka.maxHp, rayka.hp + healthDamage * aegis.healMultiplier);
  game.history.healing(rayka, rayka, rayka.hp - before);
  rayka.energy += aegis.energyPerHit;
  rayka.energyGeneratedThisTurn = true;
}
export function chainZone(game, rayka, zone, target) {
  return createRaykaThunderstorm(game, rayka, target.x, target.y, {
    duration: zone.remainingTurns,
    radius: zone.radius,
    damageMultiplier: zone.damageMultiplier,
    chainOnBuildings: false,
  });
}
export function attackLog(game, rayka, targetName) {
  return `${game.teamName(rayka.team)} ${rayka.stats.name} summoned a thunderstorm at ${targetName}`;
}
export default function createHeroBehavior() {
  return { heroId, createRaykaThunderstorm, beforeBasicAttack, onTurnStart, onTurnEnd, onHealthDamage, onZoneHit, chainZone, attackLog, validateAbility, activateAbility };
}
