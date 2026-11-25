import { HERO_STATS } from '../data/stats/hugo.js';
export { HERO_STATS };
export const heroId = 'hugo';

function addEnergy(game, hero, amount) {
  if (amount <= 0) return;
  hero.energy += amount;
  const threshold = hero.stats.resourceThreshold || 50;
  while (hero.energy >= threshold) {
    hero.energy -= threshold;
    const patch = game.board.grassPatches.find((active) => active.owner === hero);
    if (patch) {
      patch.x = hero.x;
      patch.y = hero.y;
      patch.remainingTurns = 10;
    } else {
      game.board.grassPatches.push({ owner: hero, team: hero.team, x: hero.x, y: hero.y, radius: 68, remainingTurns: 10 });
    }
    game.addEvent(`${game.teamName(hero.team)} ${hero.stats.name} triggers Change of Turf and creates a grass patch.`, hero.team);
  }
}

function wallSegment(hero, wall) {
  const centerX = hero.x + Math.cos(wall.angle) * (wall.frontOffset || 22);
  const centerY = hero.y + Math.sin(wall.angle) * (wall.frontOffset || 22);
  const perpendicular = wall.angle + Math.PI / 2;
  const halfLength = wall.length / 2;
  return {
    start: { x: centerX - Math.cos(perpendicular) * halfLength, y: centerY - Math.sin(perpendicular) * halfLength },
    end: { x: centerX + Math.cos(perpendicular) * halfLength, y: centerY + Math.sin(perpendicular) * halfLength },
  };
}

export function onDamaged(game, hero, healthDamage) {
  if (healthDamage > 0) addEnergy(game, hero, (healthDamage / hero.maxHp) * 100);
}

export function onBasicAttack(game, hero) { addEnergy(game, hero, 10); }

export function modifyIncomingDamage(game, hero, target, amount, source, context) {
  if (!target || !source || source.team === target.team || hero.hp <= 0 || hero.team !== target.team) return null;
  const wall = hero.effects.find((effect) => effect.type === 'line-barrier' && effect.remainingTurns > 0);
  if (!wall) return null;
  if (target !== hero) {
    if (!context.ranged || !target.stats) return null;
    const segment = wallSegment(hero, wall);
    if (!game.segmentIntersects(source, target, segment.start, segment.end)) return null;
  }
  const reductionMultiplier = game.isArenaTower(source)
    ? (wall.towerDamageReductionForce ?? 0.2)
    : (wall.damageReductionForce ?? 0.4);
  const reduction = hero.stats.force * reductionMultiplier;
  return { handled: true, target: hero, amount: Math.max(0, amount - reduction), owner: hero };
}

export function onDamageMitigated(game, hero, damage, source) {
  if (!source || damage <= 0 || damage >= hero.maxHp * 0.02) return;
  addEnergy(game, hero, 5);
  const wall = hero.effects.find((effect) => effect.type === 'line-barrier');
  let recipient = wall?.selectedAlly;
  if (!recipient || recipient.hp <= 0 || !game.board.troops.includes(recipient)) {
    recipient = game.board.troops
      .filter((ally) => ally.team === hero.team && ally !== hero && ally.hp > 0 && !ally.burrowed)
      .sort((a, b) => hero.distanceTo(a) - hero.distanceTo(b))[0];
  }
  if (recipient) {
    const minionAttack = Boolean(source.isMinion || source.stats?.isMinion);
    recipient.ac += (minionAttack ? 1 : 5) * game.allyBonusMultiplier(recipient);
  }
}

export function validateAbility(game, hero, data) {
  if (data.requiresStructureInAttackRange) {
    const inRange = [...game.board.turrets, ...game.board.towers,
      ...game.board.troops.filter((unit) => unit.stats.isBuilding)]
      .some((building) => building.hp > 0 && hero.attackDistanceTo(building) <= hero.attackRange);
    if (!inRange) return { valid: false, message: `${data.name} requires a building in ${hero.stats.name}'s attack range` };
  }
  return null;
}

export function activateAbility(game, hero, data, target) {
  if (data.energyGain) addEnergy(game, hero, data.energyGain);
  if (!data.hugoWall) return false;
  const angle = hero.facing ?? (hero.team === 0 ? 0 : Math.PI);
  hero.addEffect({
    id: `${data.id}-wall`, type: 'line-barrier', displayLabel: 'Guard Wall', selectedAlly: target, angle,
    length: data.wallWidth, frontOffset: 22,
    damageReductionForce: data.wallDamageReductionForce,
    towerDamageReductionForce: data.wallTowerDamageReductionForce,
    remainingTurns: data.duration,
  });
  hero.addEffect({ id: `${data.id}-slow`, type: 'move-speed', multiplier: data.selfMoveSpeedMultiplier, remainingTurns: data.duration });
  return true;
}

export default function createHeroBehavior() {
  return { heroId, onDamaged, onBasicAttack, modifyIncomingDamage, onDamageMitigated, validateAbility, activateAbility };
}
