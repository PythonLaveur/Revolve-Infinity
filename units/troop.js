import { EffectSystem } from '../engine/effect_system.js';
import { edgeDistanceBetween, RADIUS_PER_SIZE } from './stats.js';

let nextUnitId = 1;

export function aggroAdjustedDistance(source, target) {
  const distance = typeof source.distanceTo === 'function'
    ? source.distanceTo(target)
    : Math.hypot(source.x - target.x, source.y - target.y);
  const aggro = Number(target?.aggro ?? target?.stats?.aggro ?? 1);
  return distance / Math.max(0.01, Number.isFinite(aggro) ? aggro : 1);
}

export class Troop {
  constructor(stats, team, x, y) {
    this.id = `unit-${nextUnitId++}`;
    this.stats = stats;
    if (this.stats.aggro === undefined || this.stats.aggro === null) this.stats.aggro = 1;
    if (this.stats.size === undefined || this.stats.size === null)
      this.stats.size = this.stats.isMinion || this.stats.isDrone || this.stats.isSummon ? 0.5 : 1;
    this.size = this.stats.size;
    this.aggro = this.stats.aggro;
    this.team = team;
    this.x = x;
    this.y = y;
    this.hp = stats.hp;
    this.maxHp = stats.hp;
    this.ac = stats.initialAC;
    this.initialAC = stats.initialAC;
    this.spawnTurns = stats.spawnIntervalTurns ?? null;
    this.energy = 0;
    this.energyIdleTurns = 0;
    this.energyGeneratedThisTurn = false;
    this.movementRemaining = stats.movement;
    this.focus = null;
    this.effects = [];
    this.stunned = true;
    this.waypoints = [];
    this.facing = team === 0 ? Math.PI : 0;
  }
  isMoving() {
    return Boolean(
      (this.waypoints && this.waypoints.length > 0) ||
      (this.knockbackWaypoints && this.knockbackWaypoints.length > 0),
    );
  }
  get attackRange() {
    return this.effects
      .filter((effect) => effect.type === 'attack-range')
      .reduce((range, effect) => range * effect.multiplier, this.stats.range);
  }
  get sightRange() {
    return this.effects
      .filter((effect) => effect.type === 'sight-range')
      .reduce((range, effect) => range * effect.multiplier, this.stats.sight);
  }
  get magicPenPercent() {
    const bonus = this.effects
      .filter((effect) => effect.type === 'magic-penetration')
      .reduce((total, effect) => total + effect.amount, 0);
    return Math.max(0, Math.min(100, (this.stats.magicPenPercent || 0) + bonus));
  }
  get armor() {
    const armor = this.stats.armor + this.effects
      .filter((effect) => effect.type === 'defense')
      .reduce((bonus, effect) => bonus + effect.armor, 0);
    return armor * (1 + this.energy * (this.stats.energyDefenseMultiplier || 0));
  }
  get magicResist() {
    const resist = this.stats.magicResist + this.effects
      .filter((effect) => effect.type === 'defense')
      .reduce((bonus, effect) => bonus + effect.magicResist, 0);
    return resist * (1 + this.energy * (this.stats.energyDefenseMultiplier || 0));
  }
  get acGenerationMultiplier() {
    return this.effects
      .filter((effect) => effect.type === 'ac-generation')
      .reduce((multiplier, effect) => multiplier * effect.multiplier, 1);
  }
  get movementSpeedMultiplier() {
    const speedEffects = this.effects
      .filter((effect) => effect.type === 'move-speed')
      .reduce((multiplier, effect) => multiplier * effect.multiplier, 1);
    const momentumBonus = this.effects
      .filter((effect) => effect.type === 'momentum-shield')
      .reduce((bonus, effect) => {
        const distance = Math.hypot(effect.momentumX || 0, effect.momentumY || 0);
        const maxBonus = effect.maxSpeedBonus || 0.5;
        const maxDistance = effect.maxSpeedMomentum || 272;
        return Math.max(bonus, Math.min(maxBonus, (distance / maxDistance) * maxBonus));
      }, 0);
    return speedEffects * (1 + momentumBonus);
  }
  get availableMovement() {
    return this.movementRemaining * this.movementSpeedMultiplier;
  }
  get collisionRadius() {
    return RADIUS_PER_SIZE * this.size;
  }
  canTarget(target) {
    if (!target?.stats) return true;
    const targetType = target.stats.movementType || 'ground';
    return (this.stats.attackTypes || ['ground']).includes(targetType);
  }
  eligibleTargets(enemies) {
    if (this.stats.targetPreference === 'allies') {
      const allies = enemies.filter((unit) => unit.team === this.team && unit !== this && unit.hp > 0 && !unit.stats?.isBuilding);
      return allies.filter((unit) => unit.hp < unit.maxHp);
    }
    const attackable = enemies.filter((enemy) => this.canTarget(enemy));
    if (this.stats.targetPreference !== 'structures') return attackable;
    const structures = attackable.filter((enemy) => !enemy.stats && enemy.hp > 0);
    return structures.some((structure) => this.distanceToEdge(structure) <= this.sightRange)
      ? structures
      : attackable.filter((enemy) => enemy.stats && enemy.hp > 0);
  }
  addEffect(effect) {
    return EffectSystem.apply(this, effect);
  }
  tickEffects() {
    EffectSystem.tickTurns(this);
  }
  tickTimedEffects(seconds) {
    EffectSystem.tickTime(this, seconds);
  }
  takeDamage(amount) {
    let remaining = amount;
    for (const shield of this.effects.filter((effect) => effect.type === 'shield' || effect.type === 'momentum-shield')) {
      const absorbed = Math.min(shield.remainingAmount, remaining);
      shield.remainingAmount -= absorbed;
      remaining -= absorbed;
      if (remaining <= 0) break;
    }
    this.effects = this.effects.filter(
      (effect) =>
        (effect.type !== 'shield' && effect.type !== 'momentum-shield') || effect.remainingAmount > 0,
    );
    this.hp -= remaining;
    return remaining;
  }
  updateMovement(maxDistance) {
    const waypoints = this.knockbackWaypoints?.length ? this.knockbackWaypoints : this.waypoints;
    if (!waypoints || !waypoints.length) return false;
    let remaining = maxDistance;
    while (remaining > 0 && waypoints.length > 0) {
      const target = waypoints[0];
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) this.facing = Math.atan2(dy, dx);
      if (dist <= remaining) {
        const movedX = target.x - this.x;
        const movedY = target.y - this.y;
        this.x = target.x;
        this.y = target.y;
        this.recordMovement(movedX, movedY);
        waypoints.shift();
        remaining -= dist;
      } else {
        const movedX = (dx / dist) * remaining;
        const movedY = (dy / dist) * remaining;
        this.x += movedX;
        this.y += movedY;
        this.recordMovement(movedX, movedY);
        remaining = 0;
      }
    }
    if (waypoints === this.knockbackWaypoints && !waypoints.length) this.knockbackWaypoints = null;
    return true;
  }
  recordMovement(dx, dy) {
    for (const shield of this.effects.filter((effect) => effect.type === 'momentum-shield')) {
      shield.momentumX = (shield.momentumX || 0) + dx;
      shield.momentumY = (shield.momentumY || 0) + dy;
    }
  }
  resetMomentumShield() {
    for (const shield of this.effects.filter((effect) => effect.type === 'momentum-shield')) {
      shield.momentumX = 0;
      shield.momentumY = 0;
    }
  }
  reset(enemies = null) {
    this.waypoints = [];
    if (enemies) this.validateFocus(enemies);
    if (this.stats.isBuilding) {
      this.stunned = this.effects.some((effect) => effect.type === 'airborne' || effect.type === 'stun');
      this.ac += this.stats.acPerTurn || 0;
      return;
    }
    if (this.effects.some((effect) => effect.type === 'airborne' || effect.type === 'stun')) {
      this.stunned = true;
      this.ac = this.initialAC;
    } else if (this.stunned) {
      this.stunned = false;
      this.ac = this.initialAC;
    } else {
      this.ac = this.focus
        ? Math.round(15 * this.acGenerationMultiplier) + Math.min(this.ac, this.stats.attackCost)
        : this.initialAC;
    }
    this.movementRemaining = this.stats.movement;
  }
  stun() {
    this.resetMomentumShield();
    this.stunned = true;
    this.focus = null;
    this.waypoints = [];
    this.dashingTo = null;
  }
  validateFocus(enemies) {
    if (
      this.focus &&
      (!enemies.includes(this.focus) ||
        this.focus.hp <= 0 ||
        this.attackDistanceTo(this.focus) > this.attackRange ||
        !this.eligibleTargets(enemies).includes(this.focus))
    )
      this.focus = null;
  }
  prepareEndTurn(enemies) {
    this.waypoints = [];
    if (this.stats.isBuilding) return;
    this.validateFocus(enemies);
    if (!this.focus) this.ac = this.initialAC;
    else if (this.ac > this.stats.attackCost) this.ac = this.stats.attackCost;
  }
  updateFocus(enemies) {
    this.validateFocus(enemies);
    if (!this.focus) {
      const valid = this.eligibleTargets(enemies)
        .filter((e) => e.hp > 0 && this.attackDistanceTo(e) <= this.attackRange)
        .sort((a, b) => aggroAdjustedDistance(this, a) - aggroAdjustedDistance(this, b));
      this.focus = valid[0] || null;
    }
  }
  distanceTo(other) {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
  distanceToEdge(other) {
    return edgeDistanceBetween(this, other);
  }
  attackDistanceTo(other) {
    return edgeDistanceBetween(this, other);
  }
}
