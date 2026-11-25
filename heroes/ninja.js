import { HERO_STATS } from '../data/stats/ninja.js';
export { HERO_STATS };
import { Troop } from '../units/troop.js';

export const heroId = 'ninja';

export function onBasicAttack(game, troop, target) {
  if (target?.stats && target.hp > 0) {
    const marking = troop.effects.find((effect) => effect.type === 'mark-on-hit');
    if (marking) {
      const marksId = `ninja-marks-${troop.squadId || troop.team}`;
      let marks = target.effects.find((effect) => effect.id === marksId);
      if (!marks) {
        target.addEffect({ id: marksId, type: 'stacking-mark', displayLabel: 'Control marks', maxStacks: 10, stacks: 0, remainingTurns: marking.remainingTurns });
        marks = target.effects.find((effect) => effect.id === marksId);
      }
      marks.stacks += 1;
      marks.remainingTurns = marking.remainingTurns;
      if (marks.stacks >= 10) {
        target.stun();
        target.addEffect({ id: `ninja-stun-${troop.squadId || troop.team}`, type: 'stun', remainingTurns: marking.stunDuration || 2 });
        target.effects = target.effects.filter((effect) => effect.id !== marksId);
      }
    }
  }
  if (!troop.isClone && troop.effects.some((effect) => effect.type === 'clone-on-hit'))
    spawnClone(game, troop);
}

export function activateAbility(game, ninja, data) {
  if (!data.magicPenBuff) return false;
  const members = ninja.squadId
    ? game.board.troops.filter((unit) => unit.squadId === ninja.squadId && unit.hp > 0)
    : [ninja];
  for (const member of members) {
    member.addEffect({ id: `${data.id}-active`, type: 'magic-penetration', amount: data.magicPenBuff, remainingTurns: data.duration });
  }
  return true;
}

export function spawnClone(game, summoner) {
  const cloneSize = summoner.stats.cloneSize;
  const cloneRadius = 14 * cloneSize;
  const clones = game.board.troops.filter(
    (troop) => troop.isClone && troop.summonedBy === summoner && troop.hp > 0,
  );
  if (clones.length >= 2) return null;
  const positions = [];
  for (const distance of [36, 48, 62, 78, 96, 116]) {
    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI * 2 * i) / 16;
      positions.push({
        x: summoner.x + Math.cos(angle) * distance,
        y: summoner.y + Math.sin(angle) * distance,
      });
    }
  }
  const position = positions.find(
    (candidate) =>
      candidate.x >= cloneRadius && candidate.x <= game.board.width - cloneRadius &&
      candidate.y >= cloneRadius && candidate.y <= game.board.height - cloneRadius &&
      !game.isBlockedByTerrain(candidate.x, candidate.y, cloneRadius, 'ground'),
  ) || { x: summoner.x, y: summoner.y };
  const clone = new Troop(summoner.stats, summoner.team, position.x, position.y);
  clone.squadId = summoner.squadId;
  clone.isClone = true;
  clone.size = cloneSize;
  clone.summonedBy = summoner;
  clone.stunned = false;
  clone.ac = clone.initialAC;
  clone.movementRemaining = 0;
  for (const effect of summoner.effects.filter((active) => active.type === 'mark-on-hit'))
    clone.addEffect({ ...effect });
  game.addTroop(clone);
  game.addEvent(`${game.teamName(clone.team)} Ninja created a shadow clone.`, clone.team);
  return clone;
}

export default function createHeroBehavior() {
  return { heroId, onBasicAttack, activateAbility };
}
