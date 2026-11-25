import { edgeDistanceBetween } from '../units/stats.js';

const labelOf = (unit) => unit?.stats?.name || unit?.name || 'Arena structure';

export class CombatHistory {
  constructor() {
    this.events = [];
    this.totals = new Map();
    this.sequence = 1;
  }
  ensure(unit) {
    if (!unit) return null;
    let stats = this.totals.get(unit);
    if (!stats) {
      stats = {
        unit,
        heroId: unit.stats?.id || null,
        name: labelOf(unit),
        team: unit.team ?? null,
        isClone: Boolean(unit.isClone),
        isSummon: Boolean(unit.isSummon || unit.isMinion || unit.isDrone || unit.stats?.isSummon || unit.stats?.isMinion),
        damageDealt: 0,
        damageTaken: 0,
        damageReduced: 0,
        healingDone: 0,
        healingReceived: 0,
        deployments: 0,
        kills: 0,
      };
      this.totals.set(unit, stats);
    }
    return stats;
  }
  record(type, fields = {}) {
    const event = { id: this.sequence++, type, timestamp: Date.now(), ...fields };
    this.events.push(event);
    return event;
  }
  damage(source, target, amount, reduced = 0, healthBefore = target?.hp ?? 0) {
    const dealt = Math.max(0, Math.round(amount || 0));
    const prevent = Math.max(0, Math.round(reduced || 0));
    if (source && source !== target) this.ensure(source).damageDealt += dealt;
    if (target) {
      this.ensure(target).damageTaken += dealt;
      this.ensure(target).damageReduced += prevent;
    }
    this.record('damage', {
      source,
      target,
      amount: dealt,
      reduced: prevent,
      sourceX: source?.x ?? null,
      sourceY: source?.y ?? null,
      targetX: target?.x ?? null,
      targetY: target?.y ?? null,
      team: source?.team ?? null,
    });
    if (healthBefore > 0 && target?.hp <= 0 && source && source !== target) {
      this.ensure(source).kills += 1;
      this.record('kill', { source, target, team: source.team ?? null });
    }
  }
  healing(source, target, amount) {
    const healed = Math.max(0, Math.round(amount || 0));
    if (!healed) return;
    if (source) this.ensure(source).healingDone += healed;
    if (target) this.ensure(target).healingReceived += healed;
    this.record('healing', { source, target, amount: healed, team: source?.team ?? null });
  }
  reduction(source, target, amount, reason = 'resistance') {
    const reduced = Math.max(0, Math.round(amount || 0));
    if (!reduced) return;
    this.ensure(target).damageReduced += reduced;
    this.record('damage-reduced', { source, target, amount: reduced, reason, team: target?.team ?? null });
  }
  deployment(unit) {
    this.ensure(unit).deployments += 1;
    this.record('deployment', { unit, team: unit.team ?? null });
  }
  effectApplied(target, effect) {
    this.record('effect-applied', {
      target,
      effectId: effect.id || effect.type || 'effect',
      effectType: effect.type || 'unknown',
      sourceTeam: effect.sourceTeam ?? null,
      team: target?.team ?? null,
    });
  }
  mostDamageDealer(target) {
    const totals = new Map();
    for (const event of this.events) {
      if (
        event.type !== 'damage' ||
        event.target !== target ||
        !event.source ||
        event.source.team === target?.team ||
        event.amount <= 0
      ) continue;
      totals.set(event.source, (totals.get(event.source) || 0) + event.amount);
    }
    return [...totals].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  allyAttackedWithin(unit, radius, sinceEventId = 0) {
    return this.events.filter((event) =>
      event.id > sinceEventId && event.type === 'damage' && event.target?.team === unit.team &&
      event.source?.team !== unit.team &&
      (event.target
        ? edgeDistanceBetween(unit, event.target)
        : Math.hypot(event.targetX - unit.x, event.targetY - unit.y) - (unit.collisionRadius || 0)) <= radius,
    );
  }
  summary(team = null) {
    return [...this.totals.values()]
      .filter((entry) => team === null || entry.team === team)
      .map(({ unit, ...entry }) => ({ ...entry, unitId: unit.id || null }));
  }
}
