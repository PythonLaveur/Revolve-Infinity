import { HERO_STATS } from '../data/stats/burrower.js';
export { HERO_STATS };
export const heroId = 'burrower';
export function onBasicAttack(_game, burrower, target) {
  if (!target?.stats || target.hp <= 0 || !burrower.effects.some((effect) => effect.type === 'launch-next-hit')) return;
  target.stun();
  target.addEffect({ id: 'burrower-airborne', type: 'airborne', remainingTurns: 2 });
  burrower.effects = burrower.effects.filter((effect) => effect.type !== 'launch-next-hit');
}
export function castAbility(_game, burrower, data, context) {
  if (!data.burrowTurns) return null;
  burrower.burrowed = true;
  burrower.burrowDestination = { x: context.x, y: context.y };
  burrower.burrowTurns = data.burrowTurns;
  burrower.nextAttackDuration = data.nextAttackDuration;
  burrower.burrowAbilityId = data.id;
  burrower.focus = null;
  burrower.waypoints = [];
  burrower.dashingTo = null;
  return { handled: true };
}
function findEmergence(game, burrower, destination) {
  const positions = [destination];
  for (const distance of [42, 56, 70, 84, 98]) {
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12;
      positions.push({ x: destination.x + Math.cos(angle) * distance, y: destination.y + Math.sin(angle) * distance });
    }
  }
  return positions.find((position) =>
    position.x >= burrower.collisionRadius && position.x <= game.board.width - burrower.collisionRadius &&
    position.y >= burrower.collisionRadius && position.y <= game.board.height - burrower.collisionRadius &&
    !game.isBlockedByTerrain(position.x, position.y, burrower.collisionRadius, 'ground') &&
    !game.isBlockedByTroop(position.x, position.y, burrower.collisionRadius, burrower, 'ground')) || null;
}
export function onAfterTurnResolution(game, burrower) {
  if (!burrower.burrowed) return;
  burrower.burrowTurns -= 1;
  if (burrower.burrowTurns > 0) return;
  const destination = findEmergence(game, burrower, burrower.burrowDestination);
  if (!destination) return;
  burrower.x = destination.x;
  burrower.y = destination.y;
  burrower.burrowed = false;
  burrower.burrowDestination = null;
  burrower.burrowTurns = 0;
  const duration = burrower.nextAttackDuration || 4;
  burrower.addEffect({ id: `${burrower.burrowAbilityId || heroId}-launch`, type: 'launch-next-hit', remainingTurns: duration });
  burrower.nextAttackDuration = 0;
  game.addEvent(`${game.teamName(burrower.team)} ${burrower.stats.name} emerges from its tunnel.`, burrower.team);
}
export default function createHeroBehavior() { return { heroId, onBasicAttack, castAbility, onAfterTurnResolution }; }
