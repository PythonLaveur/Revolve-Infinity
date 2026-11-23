import { TROOPS } from '../data/troops.js';
import { ABILITIES } from '../data/abilities.js';
import { TroopStats } from '../units/stats.js';
import { Troop } from '../units/troop.js';
import { TroopCard } from '../cards/troop_card.js';
import { AbilityCard } from '../cards/ability_card.js';
import { Deck } from '../cards/deck.js';
import { Hand } from '../cards/hand.js';
import { Board } from './board.js';
import { TurnManager } from './turn_manager.js';
import { applyResistance, scaleDamage } from '../units/damage.js';

const hasDirectAbilityDamage = (data) =>
  Boolean(
    data.damage ||
    data.damageFraction ||
    data.targetMaxHpFraction ||
    (data.scaling && data.damageType),
  );
const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();
const PATHFINDING_BUDGET_MS = 200;

export class Player {
  constructor(team, deck) {
    this.team = team;
    this.elixir = 1200;
    this.ap = 0;
    this.deck = deck;
    this.hand = new Hand(deck);
    this.units = [];
  }
  generate() {
    this.elixir = Math.min(2000, this.elixir + 100);
    this.ap = Math.min(2000, this.ap + 100);
  }
}

export class Game {
  constructor() {
    this.stats = Object.fromEntries(TROOPS.map((t) => [t.id, new TroopStats(t)]));
    this.abilities = Object.fromEntries(ABILITIES.map((a) => [a.id, a]));
    this.makeDeck = () => {
      const cards = [];
      TROOPS.forEach((stats) => {
        cards.push(new TroopCard(stats));
        ABILITIES.filter((a) => a.troop === stats.id).forEach((data) =>
          cards.push(new AbilityCard(data)),
        );
      });
      return new Deck(cards);
    };
    this.players = [new Player(0, this.makeDeck()), new Player(1, this.makeDeck())];
    this.board = new Board();
    this.turns = new TurnManager();
    this.score = [0, 0];
    this.winner = null;
    this.scoredTurrets = new Set();
    this.squadCounter = 1;
    this.shakeTimer = 0;
    this.events = [];
    this.message = 'Blue: deploy or act';
    this.beginningMovementQueue = null;
  }
  teamName(team) {
    return team === 0 ? 'Blue' : 'Red';
  }
  addEvent(message, team = null) {
    this.message = message;
    this.events.push({ message, team });
  }
  showDamageArea(area) {
    this.board.areaEffects.push({ ...area, duration: 2, remainingSeconds: 2 });
  }
  isOnGrass(troop) {
    if (!troop || troop.stats?.isBuilding) return false;
    const { x, y } = troop;
    const river = this.board.river;
    const insideRiver =
      x >= river.x && x <= river.x + river.w && y >= river.y && y <= river.y + river.h;
    const onWater = insideRiver && !this.isOnBridge(x, y);
    if (onWater) return false;
    const onBuilding = [...this.board.turrets, ...this.board.towers, ...this.board.troops].some(
      (building) =>
        building !== troop &&
        building.hp > 0 &&
        (building.stats?.isBuilding || building.layer || building.type === 'base') &&
        Math.hypot(building.x - x, building.y - y) < (building.type === 'base' ? 46 : 37),
    );
    return (
      !onBuilding &&
      this.board.grassPatches.some(
        (patch) =>
          patch.team === troop.team &&
          patch.remainingTurns > 0 &&
          Math.hypot(patch.x - x, patch.y - y) <= patch.radius,
      )
    );
  }
  allyBonusMultiplier(troop) {
    return this.isOnGrass(troop) ? 1.4 : 1;
  }
  addHugoEnergy(hugo, amount) {
    if (hugo?.stats.id !== 'hugo' || amount <= 0) return;
    hugo.energy += amount;
    while (hugo.energy >= 50) {
      hugo.energy -= 50;
      const patch = this.board.grassPatches.find((active) => active.owner === hugo);
      if (patch) {
        patch.x = hugo.x;
        patch.y = hugo.y;
        patch.remainingTurns = 10;
      } else {
        this.board.grassPatches.push({
          owner: hugo,
          team: hugo.team,
          x: hugo.x,
          y: hugo.y,
          radius: 68,
          remainingTurns: 10,
        });
      }
      this.addEvent(
        `${this.teamName(hugo.team)} Hugo triggers Change of Turf and creates a 10-turn grass patch.`,
        hugo.team,
      );
    }
  }
  tickGrassPatches() {
    for (const patch of this.board.grassPatches) patch.remainingTurns -= 1;
    this.board.grassPatches = this.board.grassPatches.filter((patch) => patch.remainingTurns > 0);
  }
  segmentIntersects(a, b, c, d) {
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const abC = cross(a, b, c),
      abD = cross(a, b, d);
    const cdA = cross(c, d, a),
      cdB = cross(c, d, b);
    return abC * abD <= 0 && cdA * cdB <= 0;
  }
  isArenaTower(source) {
    return Boolean(source && (source.type === 'base' || source.layer));
  }
  hugoWallSegment(hugo, wall) {
    const centerX = hugo.x + Math.cos(wall.angle) * (wall.frontOffset || 22);
    const centerY = hugo.y + Math.sin(wall.angle) * (wall.frontOffset || 22);
    const perpendicular = wall.angle + Math.PI / 2;
    const halfLength = wall.length / 2;
    return {
      start: {
        x: centerX - Math.cos(perpendicular) * halfLength,
        y: centerY - Math.sin(perpendicular) * halfLength,
      },
      end: {
        x: centerX + Math.cos(perpendicular) * halfLength,
        y: centerY + Math.sin(perpendicular) * halfLength,
      },
    };
  }
  applyHugoWall(target, amount, source, ranged) {
    if (!target || !source || source.team === target.team) return { target, amount, hugo: null };
    for (const hugo of this.board.troops) {
      if (hugo.stats.id !== 'hugo' || hugo.hp <= 0 || hugo.team !== target.team) continue;
      const wall = hugo.effects.find(
        (effect) => effect.type === 'hugo-wall' && effect.remainingTurns > 0,
      );
      if (!wall) continue;
      const reductionMultiplier = this.isArenaTower(source)
        ? (wall.towerDamageReductionForce ?? 0.2)
        : (wall.damageReductionForce ?? 0.4);
      const reduction = hugo.stats.force * reductionMultiplier;
      if (target === hugo) {
        return { target: hugo, amount: Math.max(0, amount - reduction), hugo };
      }
      if (!ranged) continue;
      if (!target.stats) continue;
      const { start, end } = this.hugoWallSegment(hugo, wall);
      if (this.segmentIntersects(source, target, start, end)) {
        return { target: hugo, amount: Math.max(0, amount - reduction), hugo, intercepted: true };
      }
    }
    return { target, amount, hugo: null };
  }
  triggerHugoChip(hugo, damage, source) {
    if (!hugo || damage <= 0 || damage >= hugo.maxHp * 0.02) return;
    this.addHugoEnergy(hugo, 5);
    const effect = hugo.effects.find((active) => active.type === 'hugo-wall');
    let recipient = effect?.selectedAlly;
    if (!recipient || recipient.hp <= 0 || !this.board.troops.includes(recipient)) {
      recipient = this.board.troops
        .filter((ally) => ally.team === hugo.team && ally !== hugo && ally.hp > 0 && !ally.burrowed)
        .sort((a, b) => hugo.distanceTo(a) - hugo.distanceTo(b))[0];
    }
    if (recipient) {
      const minionAttack = Boolean(source.isMinion || source.stats?.isMinion);
      recipient.ac += (minionAttack ? 1 : 5) * this.allyBonusMultiplier(recipient);
    }
  }
  resolveStructureOutcomes() {
    for (const turret of this.board.turrets) {
      if (turret.hp > 0 || this.scoredTurrets.has(turret)) continue;
      this.scoredTurrets.add(turret);
      const scoringTeam = 1 - turret.team;
      this.score[scoringTeam] += 1;
      this.addEvent(
        `${this.teamName(scoringTeam)} destroyed a ${this.teamName(turret.team)} ${turret.layer} turret (+1 point).`,
        scoringTeam,
      );
    }
    for (const base of this.board.towers) {
      if (base.hp <= 0 && this.winner === null) {
        this.winner = 1 - base.team;
        this.addEvent(
          `${this.teamName(this.winner)} destroyed the ${this.teamName(base.team)} base and wins the game!`,
          this.winner,
        );
      }
    }
  }
  applyDamage(target, amount, source = null, flags = {}) {
    const ranged = !flags.ignoreRanged && Boolean(flags.ranged);
    const wallResult = this.applyHugoWall(target, amount, source, ranged);
    target = wallResult.target;
    amount = wallResult.amount;
    if (!flags.skipHugoChip && wallResult.hugo && ranged)
      this.triggerHugoChip(wallResult.hugo, amount, source);
    if (source && target?.stats) {
      for (const domeOwner of this.board.troops) {
        if (domeOwner.hp <= 0 || domeOwner.team !== target.team) continue;
        const dome = domeOwner.effects.find(
          (effect) => effect.type === 'protective-dome' && effect.remainingAmount > 0,
        );
        if (!dome || Math.hypot(target.x - domeOwner.x, target.y - domeOwner.y) > dome.radius)
          continue;
        const sourceRange = flags.ranged ? Infinity : (source.stats?.range ?? source.range ?? 0);
        if (
          source.team === target.team ||
          sourceRange < 80 ||
          Math.hypot(source.x - domeOwner.x, source.y - domeOwner.y) <= dome.radius
        )
          continue;
        const absorbed = Math.min(amount, dome.remainingAmount);
        dome.remainingAmount -= absorbed;
        amount -= absorbed;
        if (amount <= 0) return 0;
      }
    }
    const healthBefore = Math.max(0, target.hp);
    const momentumShields =
      target.effects?.filter((effect) => effect.type === 'momentum-shield') || [];
    if (target.takeDamage) target.takeDamage(amount);
    else target.hp -= amount;
    const healthDamage = Math.min(healthBefore, Math.max(0, healthBefore - target.hp));
    for (const shield of momentumShields) {
      if (shield.remainingAmount <= 0 && !target.effects.includes(shield))
        this.detonateMomentumShield(target, shield);
    }
    if (target.stats?.id === 'hugo' && healthDamage > 0) {
      this.addHugoEnergy(target, (healthDamage / target.maxHp) * 100);
    }
    if (healthDamage > 0 && target.stats) {
      for (const rayka of this.board.troops) {
        if (rayka.hp <= 0 || rayka.burrowed || rayka.team === target.team) continue;
        for (const effect of rayka.effects.filter((active) => active.type === 'damage-to-shield')) {
          if (rayka.distanceTo(target) > effect.triggerRadius) continue;
          const shieldId = `${effect.id}-generated`;
          let shield = rayka.effects.find((active) => active.id === shieldId);
          if (!shield) {
            rayka.addEffect({
              id: shieldId,
              type: 'shield',
              remainingAmount: 0,
              remainingTurns: effect.remainingTurns,
            });
            shield = rayka.effects.find((active) => active.id === shieldId);
          }
          shield.remainingAmount += healthDamage * effect.multiplier;
        }
      }
    }
    if (healthDamage > 0 && source && !flags.skipReflection && source.team !== target.team) {
      for (const kaguya of this.board.troops) {
        if (kaguya.hp <= 0 || kaguya.team !== target.team) continue;
        const field = kaguya.effects.find(
          (effect) => effect.type === 'damage-reflect' && effect.remainingTurns > 0,
        );
        if (!field || kaguya.distanceTo(target) > field.radius) continue;
        this.applyDamage(source, Math.round(healthDamage * field.multiplier), target, {
          skipReflection: true,
        });
      }
    }
    const minionAttack = Boolean(
      source?.isMinion ||
      source?.isClone ||
      source?.isSummon ||
      source?.stats?.isMinion ||
      source?.stats?.isSummon,
    );
    if (
      (ranged || minionAttack) &&
      amount > 0 &&
      !flags.skipFragile &&
      target.hp > 0 &&
      target.effects?.some((effect) => effect.type === 'fragile')
    ) {
      const raw = target.hp * (minionAttack ? 0.01 : 0.05);
      const resistance = Math.max(0, target.magicResist ?? target.stats?.magicResist ?? 0);
      const penetration = source?.magicPenPercent ?? source?.stats?.magicPenPercent ?? 0;
      const fragileDamage = applyResistance(raw, resistance, 'magic', 0, penetration);
      this.applyDamage(target, fragileDamage, source, {
        skipFragile: true,
        skipHugoChip: true,
        ignoreRanged: true,
      });
    }
    return healthDamage;
  }
  detonateMomentumShield(owner, shield) {
    if (shield.detonated) return;
    shield.detonated = true;
    const momentum = Math.hypot(shield.momentumX || 0, shield.momentumY || 0);
    const radius = shield.momentumRadius || 54.4;
    const rawDamage = Math.round(momentum * (shield.momentumDamagePerUnit ?? 0.5));
    if (rawDamage <= 0) return;
    this.showDamageArea({ x: owner.x, y: owner.y, radius, team: owner.team });
    for (const target of this.board.enemyTargets(owner.team)) {
      if (target.hp <= 0 || Math.hypot(target.x - owner.x, target.y - owner.y) > radius) continue;
      const armor = target.armor ?? target.stats?.armor ?? 0;
      const structureMultiplier = target.stats ? 1 : (owner.stats.structureDamageMultiplier ?? 1);
      const damage = applyResistance(rawDamage, armor, 'physical') * structureMultiplier;
      this.applyDamage(target, damage, owner, {
        ignoreRanged: true,
        skipFragile: true,
        skipHugoChip: true,
      });
    }
    this.board.impacts.push({
      x: owner.x,
      y: owner.y,
      radius,
      duration: 0.45,
      remainingSeconds: 0.45,
      kind: 'momentum-burst',
      team: owner.team,
    });
    this.addEvent(
      `${this.teamName(owner.team)} ${owner.stats.name}'s Momentum Shield releases ${Math.round(momentum)} momentum for ${rawDamage} physical area damage.`,
      owner.team,
    );
    this.resolveStructureOutcomes();
  }
  applyRookieMark(rookie, target) {
    if (rookie?.stats.id !== 'rookie' || !target?.stats || target.hp <= 0) return;
    const suffix = rookie.team;
    const fragile = target.effects.find((effect) => effect.type === 'fragile');
    if (fragile) {
      fragile.remainingTurns = 6;
      fragile.sourceTeam = rookie.team;
      return;
    }
    const markId = `rookie-mark-${suffix}`;
    let marks = target.effects.find((effect) => effect.id === markId);
    if (!marks) {
      target.addEffect({ id: markId, type: 'rookie-mark', stacks: 0, remainingTurns: undefined });
      marks = target.effects.find((effect) => effect.id === markId);
    }
    marks.stacks += 1;
    if (marks.stacks < 3) return;
    target.effects = target.effects.filter((effect) => effect.id !== markId);
    target.addEffect({
      id: 'rookie-fragile',
      type: 'fragile',
      sourceTeam: rookie.team,
      remainingTurns: 6,
    });
    this.addEvent(
      `${this.teamName(rookie.team)} Rookie made ${target.stats.name} fragile for 6 turns.`,
      rookie.team,
    );
  }
  activePlayer() {
    return this.players[this.turns.currentTeam];
  }
  targetsFor(troop) {
    if (troop.stats.targetPreference === 'allies')
      return this.board.troops.filter(
        (unit) =>
          unit.team === troop.team &&
          unit !== troop &&
          unit.hp > 0 &&
          !unit.burrowed &&
          !unit.stats.isBuilding,
      );
    return this.board.enemyTargets(troop.team);
  }
  spendAC(troop, amount) {
    if (amount <= 0) return;
    troop.ac -= amount;
    for (const effect of [...troop.effects].filter((active) => active.type === 'bleed')) {
      this.applyDamage(troop, effect.intensity);
      if (troop.hp <= 0) break;
    }
  }
  isMoving() {
    return Boolean(this.beginningMovementQueue?.length) || this.board.troops.some((t) => t.isMoving());
  }
  update(dt) {
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    this.board.impacts = this.board.impacts
      .map((impact) => ({ ...impact, remainingSeconds: impact.remainingSeconds - dt }))
      .filter((impact) => impact.remainingSeconds > 0);
    this.board.areaEffects = this.board.areaEffects
      .map((effect) => ({ ...effect, remainingSeconds: effect.remainingSeconds - dt }))
      .filter((effect) => effect.remainingSeconds > 0);
    const moveStep = 280 * dt;
    const movedThisFrame = new Set();
    for (const troop of this.board.troops) {
      troop.tickTimedEffects(dt);
      if (troop.isDrone) {
        if (troop.hp > 0 && troop.isMoving()) {
          troop.updateMovement(moveStep);
          movedThisFrame.add(troop);
          if (!troop.isMoving() && troop.detonateOnArrival) this.finishDroneMovement(troop);
        }
        continue;
      }
      if (!troop.burrowed && troop.isMoving()) {
        troop.updateMovement(moveStep * troop.movementSpeedMultiplier);
        movedThisFrame.add(troop);
        if (troop.dashingTo) {
          if (!troop.isMoving()) {
            const target = troop.dashingTo;
            const enemies = this.targetsFor(troop);
            troop.focus =
              enemies.includes(target) && troop.attackDistanceTo(target) <= troop.attackRange
                ? target
                : null;
            troop.dashingTo = null;
            if (!troop.focus) troop.updateFocus(enemies);
          }
        } else troop.updateFocus(this.targetsFor(troop));
      }
    }
    this.resolveMovementCollisions(movedThisFrame);
    this.startNextBeginningMovement();
    for (let i = this.board.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.board.projectiles[i];
      projectile.progress += 0.72 * dt;
      if (projectile.progress >= 1) {
        if (projectile.to && projectile.to.hp > 0 && !projectile.to.burrowed) {
          const raw = projectile.damage / 2;
          const armor = projectile.to.armor ?? projectile.to.stats?.armor ?? 0;
          const magicResist = projectile.to.magicResist ?? projectile.to.stats?.magicResist ?? 0;
          const physicalDamage = Math.round(applyResistance(raw, armor, 'physical'));
          const magicDamage = Math.round(applyResistance(raw, magicResist, 'magic'));
          if (projectile.to.takeDamage) {
            this.applyDamage(projectile.to, physicalDamage + magicDamage, projectile.source, {
              ranged: true,
            });
          } else {
            projectile.to.hp -= physicalDamage + magicDamage;
          }
        } else if (projectile.abilityId) {
          const ability = this.abilities[projectile.abilityId];
          if (projectile.targetUnit) {
            if (projectile.targetUnit.hp > 0 && !projectile.targetUnit.burrowed)
              this.applyAbilityToTarget(ability, projectile.caster, projectile.targetUnit);
          } else if (ability?.smokeField) {
            this.board.zones.push({
              abilityId: ability.id,
              caster: projectile.caster,
              team: projectile.caster.team,
              x: projectile.targetPoint.x,
              y: projectile.targetPoint.y,
              radius: ability.radius,
              remainingTurns: ability.duration,
              isSmokeField: true,
            });
            this.applyAbilityArea(
              ability,
              projectile.caster,
              projectile.targetPoint.x,
              projectile.targetPoint.y,
            );
          } else {
            this.applyAbilityArea(
              ability,
              projectile.caster,
              projectile.targetPoint.x,
              projectile.targetPoint.y,
            );
          }
        }
        this.board.projectiles.splice(i, 1);
      }
    }
    this.board.removeDefeated();
    this.resolveStructureOutcomes();
  }
  ensureTroop(player) {
    for (let i = 0; i < 3 && !player.hand.hasTroop(); i++) {
      const abilities = player.hand.abilityCards().slice(0, 3);
      if (!abilities.length) return;
      if (player.elixir >= 100) {
        player.elixir -= 100;
        player.hand.discardAbilities(player.deck, abilities.length);
        this.message = 'No troop found: discarded ability cards and redrew';
      }
    }
  }
  discardAbilities(resource, cards = null) {
    if (this.winner !== null) return false;
    const player = this.activePlayer();
    const enough = resource === 'elixir' ? player.elixir >= 100 : player.ap >= 100;
    if (!enough) {
      this.message = 'Not enough resource';
      return false;
    }
    const count = cards
      ? player.hand.discardSelected(player.deck, cards)
      : player.hand.discardAbilities(player.deck, 3);
    if (!count) {
      this.message = 'No ability cards selected';
      return false;
    }
    if (resource === 'elixir') player.elixir -= 100;
    else player.ap -= 100;
    this.ensureTroop(player);
    const resourceName = resource === 'elixir' ? 'Elixir' : 'AP';
    this.message = `Discarded ${count} ability card${count === 1 ? '' : 's'} (-100 ${resourceName})`;
    return true;
  }
  deploy(card, x, y) {
    if (this.winner !== null) return false;
    const player = this.activePlayer();
    if (player.elixir < card.elixirCost) {
      this.message = 'Not enough Elixir';
      return false;
    }
    const movementType = this.stats[card.troopId].movementType || 'ground';
    const stats = this.stats[card.troopId];
    const squadSize = stats.squadSize || 1;
    const positions =
      squadSize === 1
        ? [{ x, y }]
        : [
            { x, y },
            ...Array.from({ length: squadSize - 1 }, (_, i) => {
              const angle = (Math.PI * 2 * i) / (squadSize - 1);
              return { x: x + Math.cos(angle) * 16, y: y + Math.sin(angle) * 16 };
            }),
          ];
    for (const position of positions) {
      if (
        position.x < 20 ||
        position.x > this.board.width - 20 ||
        position.y < 20 ||
        position.y > this.board.height - 20
      ) {
        this.message = 'Cannot deploy outside the arena';
        return false;
      }
      if (this.isBlockedByTerrain(position.x, position.y, 20, movementType)) {
        this.message = 'Cannot deploy on terrain';
        return false;
      }
      if (this.isInsideEnemyInhibitionRange(player.team, position.x, position.y)) {
        this.message = 'Cannot deploy inside an enemy structure inhibition range';
        return false;
      }
    }
    const squadId = squadSize > 1 ? `${player.team}-${this.squadCounter++}` : null;
    const troops = positions.map((position) => {
      const troop = new Troop(stats, player.team, position.x, position.y);
      if (squadId) troop.squadId = squadId;
      return troop;
    });
    player.elixir -= card.elixirCost;
    player.hand.play(card, player.deck);
    player.units.push(...troops);
    for (const troop of troops) this.board.addTroop(troop);
    this.resolveDeploymentPushes(troops);
    this.ensureTroop(player);
    this.message =
      squadSize > 1
        ? `${stats.name} deployed (${squadSize} units)`
        : `${troops[0].stats.name} deployed`;
    return true;
  }
  isBlockedByTerrain(x, y, radius = 20, movementType = 'ground') {
    if (movementType === 'air') return false;
    const river = this.board.river;
    const inRiver =
      x + radius > river.x &&
      x - radius < river.x + river.w &&
      y + radius > river.y &&
      y - radius < river.y + river.h;
    if (inRiver) {
      const onBridge = this.board.bridges.some(
        (bridge) =>
          x + radius > bridge.x &&
          x - radius < bridge.x + bridge.w &&
          y + radius > bridge.y &&
          y - radius < bridge.y + bridge.h,
      );
      if (!onBridge) return true;
    }
    for (const turret of this.board.turrets) {
      if (turret.hp > 0 && Math.hypot(turret.x - x, turret.y - y) < 37) {
        return true;
      }
    }
    for (const tower of this.board.towers) {
      if (tower.hp > 0 && Math.hypot(tower.x - x, tower.y - y) < 46) {
        return true;
      }
    }
    return false;
  }
  isBlockedByTroop(x, y, radius = 20, ignored = null, movementType = 'ground') {
    const isIgnored = (t) => {
      if (!ignored) return false;
      if (Array.isArray(ignored)) return ignored.includes(t);
      return t === ignored;
    };
    return this.board.troops.some(
      (t) =>
        !isIgnored(t) &&
        !t.burrowed &&
        t.hp > 0 &&
        (t.stats.movementType || 'ground') === movementType &&
        Math.hypot(t.x - x, t.y - y) < radius + t.collisionRadius,
    );
  }
  resolveDeploymentPushes(deployed) {
    const all = this.board.troops.filter((troop) => troop.hp > 0 && !troop.burrowed);
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i],
            b = all[j];
          if ((a.stats.movementType || 'ground') !== (b.stats.movementType || 'ground')) continue;
          if (!deployed.includes(a) && !deployed.includes(b)) continue;
          let dx = b.x - a.x,
            dy = b.y - a.y;
          let distance = Math.hypot(dx, dy);
          const minDistance = a.collisionRadius + b.collisionRadius;
          if (distance >= minDistance) continue;
          if (distance < 0.01) {
            const angle = (((a.team + b.team + i * 13 + j * 7) % 360) * Math.PI) / 180;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distance = 1;
          }
          const overlap = minDistance - distance;
          const massA = Math.max(0.1, a.stats.mass || 1),
            massB = Math.max(0.1, b.stats.mass || 1);
          const immovableA = a.stats.isBuilding,
            immovableB = b.stats.isBuilding;
          const shareA = immovableA ? 0 : immovableB ? 1 : massB / (massA + massB);
          const shareB = immovableB ? 0 : immovableA ? 1 : massA / (massA + massB);
          const nx = dx / distance,
            ny = dy / distance;
          a.x = Math.max(20, Math.min(this.board.width - 20, a.x - nx * overlap * shareA));
          a.y = Math.max(20, Math.min(this.board.height - 20, a.y - ny * overlap * shareA));
          b.x = Math.max(20, Math.min(this.board.width - 20, b.x + nx * overlap * shareB));
          b.y = Math.max(20, Math.min(this.board.height - 20, b.y + ny * overlap * shareB));
        }
      }
    }
  }
  resolveMovementCollisions(movedThisFrame = null) {
    const units = this.board.troops.filter((troop) => troop.hp > 0 && !troop.burrowed);
    const legalPosition = (unit, x, y) =>
      x >= unit.collisionRadius &&
      x <= this.board.width - unit.collisionRadius &&
      y >= unit.collisionRadius &&
      y <= this.board.height - unit.collisionRadius &&
      !this.isBlockedByTerrain(x, y, unit.collisionRadius, unit.stats.movementType || 'ground');
    for (let pass = 0; pass < 5; pass++) {
      for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
          const a = units[i],
            b = units[j];
          if ((a.stats.movementType || 'ground') !== (b.stats.movementType || 'ground')) continue;
          if (movedThisFrame && !movedThisFrame.has(a) && !movedThisFrame.has(b)) continue;
          let dx = b.x - a.x,
            dy = b.y - a.y;
          let distance = Math.hypot(dx, dy);
          const minimum = a.collisionRadius + b.collisionRadius;
          if (distance >= minimum) continue;
          if (distance < 0.01) {
            const angle = (((i * 31 + j * 17 + a.team * 53) % 360) * Math.PI) / 180;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distance = 1;
          }
          const nx = dx / distance,
            ny = dy / distance;
          const overlap = minimum - distance + 0.5;
          const massA = Math.max(0.1, a.stats.mass || 1),
            massB = Math.max(0.1, b.stats.mass || 1);
          const immovableA = a.stats.isBuilding,
            immovableB = b.stats.isBuilding;
          const shareA = immovableA ? 0 : immovableB ? 1 : massB / (massA + massB);
          const shareB = immovableB ? 0 : immovableA ? 1 : massA / (massA + massB);
          const placements = [
            [
              a.x - nx * overlap * shareA,
              a.y - ny * overlap * shareA,
              b.x + nx * overlap * shareB,
              b.y + ny * overlap * shareB,
            ],
            [a.x - nx * overlap, a.y - ny * overlap, b.x, b.y],
            [a.x, a.y, b.x + nx * overlap, b.y + ny * overlap],
            [
              a.x + ny * overlap * shareA,
              a.y - nx * overlap * shareA,
              b.x - ny * overlap * shareB,
              b.y + nx * overlap * shareB,
            ],
            [
              a.x - ny * overlap * shareA,
              a.y + nx * overlap * shareA,
              b.x + ny * overlap * shareB,
              b.y - nx * overlap * shareB,
            ],
          ];
          for (const [ax, ay, bx, by] of placements) {
            const aMoves = ax !== a.x || ay !== a.y;
            const bMoves = bx !== b.x || by !== b.y;
            if ((a.stats.isBuilding && aMoves) || (b.stats.isBuilding && bMoves)) continue;
            if ((!aMoves || legalPosition(a, ax, ay)) && (!bMoves || legalPosition(b, bx, by))) {
              a.x = ax;
              a.y = ay;
              b.x = bx;
              b.y = by;
              movedThisFrame?.add(a);
              movedThisFrame?.add(b);
              break;
            }
          }
        }
      }
    }
  }
  canMoveSegment(from, to, unit) {
    const dx = to.x - from.x,
      dy = to.y - from.y,
      distance = Math.hypot(dx, dy);
    const steps = Math.ceil(distance / 6);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        x = from.x + dx * t,
        y = from.y + dy * t;
      if (this.isBlockedByTerrain(x, y, unit.collisionRadius, unit.stats.movementType || 'ground'))
        return false;
    }
    return true;
  }
  move(unit, x, y) {
    if (this.winner !== null) return false;
    if (unit.burrowed || unit.isClone || unit.isDrone || unit.stats.isBuilding) return false;
    if (unit.team !== this.turns.currentTeam) return false;
    if (unit.isMoving()) return false;
    if (
      this.board.zones.some(
        (zone) =>
          zone.isRaykaStorm &&
          zone.caster.effects.some(
            (effect) => effect.type === 'rayka-storm-empower' && effect.remainingTurns > 0,
          ) &&
          zone.team !== unit.team &&
          Math.hypot(unit.x - zone.x, unit.y - zone.y) <= zone.radius,
      )
    ) {
      this.message =
        'Confused: this troop cannot receive manual movement commands while in a thunderstorm';
      return false;
    }
    unit.validateFocus(this.targetsFor(unit));
    const dx = x - unit.x,
      dy = y - unit.y,
      distance = Math.hypot(dx, dy);
    if (distance < 1) return true;
    const direction = { x: dx / distance, y: dy / distance };
    const maxDistance = Math.min(distance, unit.availableMovement);
    let low = 0,
      high = maxDistance,
      furthest = { x: unit.x, y: unit.y };
    for (let i = 0; i < 14; i++) {
      const test = (low + high) / 2;
      const candidate = { x: unit.x + direction.x * test, y: unit.y + direction.y * test };
      if (this.canMoveSegment(unit, candidate, unit)) {
        low = test;
        furthest = candidate;
      } else high = test;
    }
    if (
      unit.focus &&
      Math.max(
        0,
        Math.hypot(furthest.x - unit.focus.x, furthest.y - unit.focus.y) -
          (unit.focus.type === 'base'
            ? 46
            : unit.focus.layer
              ? 37
              : unit.focus.collisionRadius || 14),
      ) > unit.attackRange
    ) {
      this.message = 'Movement would move the focus outside attack range';
      return false;
    }
    if (low < 1) {
      this.message = 'Movement blocked';
      return false;
    }
    unit.movementRemaining -= low / unit.movementSpeedMultiplier;
    unit.waypoints = [{ x: furthest.x, y: furthest.y }];
    this.message = `Moved ${Math.round(low)}; ${Math.round(unit.movementRemaining)} movement left`;
    return true;
  }
  fireTurrets() {
    const structures = [...this.board.turrets, ...this.board.towers];
    for (const turret of structures) {
      if (turret.hp <= 0) continue;
      if (
        turret.focus &&
        (!this.board.troops.includes(turret.focus) ||
          turret.focus.burrowed ||
          turret.focus.hp <= 0 ||
          Math.hypot(turret.focus.x - turret.x, turret.focus.y - turret.y) > turret.range)
      )
        turret.focus = null;
      if (!turret.focus) {
        const targets = this.board.troops
          .filter(
            (t) =>
              t.team !== turret.team &&
              t.hp > 0 &&
              !t.burrowed &&
              !this.isOnBridge(t.x, t.y) &&
              Math.hypot(t.x - turret.x, t.y - turret.y) <= turret.range,
          )
          .sort(
            (a, b) =>
              Math.hypot(a.x - turret.x, a.y - turret.y) -
              Math.hypot(b.x - turret.x, b.y - turret.y),
          );
        turret.focus = targets[0] || null;
      }
      if (turret.focus)
        this.board.projectiles.push({
          from: { x: turret.x, y: turret.y },
          to: turret.focus,
          source: turret,
          damage: turret.damage,
          damageType: 'mixed',
          team: turret.team,
          progress: 0,
        });
    }
  }
  attack(troop, target = null) {
    if (this.winner !== null) return false;
    if (troop.stats.isBuilding || troop.isDrone) return false;
    if (troop.stunned || troop.burrowed) return false;
    const enemies = this.targetsFor(troop);
    troop.validateFocus(enemies);
    if (!troop.focus && !target) troop.updateFocus(enemies);
    const resolvedTarget = target || troop.focus;
    const allyHeal =
      troop.stats.targetPreference === 'allies' &&
      (troop.stats.basicAttack.healFlat || troop.stats.basicAttack.healScaling);
    if (
      !resolvedTarget ||
      (resolvedTarget.team === troop.team && !allyHeal) ||
      resolvedTarget.hp <= 0
    )
      return false;
    if (!troop.eligibleTargets(enemies).includes(resolvedTarget)) return false;
    if (troop.attackDistanceTo(resolvedTarget) > troop.attackRange) return false;
    if (
      allyHeal &&
      !enemies.some((ally) => ally.hp < ally.maxHp && troop.distanceTo(ally) <= troop.attackRange)
    )
      return false;
    if (troop.ac < troop.stats.attackCost) return false;

    const profile = troop.stats.basicAttack;
    this.spendAC(troop, troop.stats.attackCost);
    if (troop.hp <= 0) return false;
    if (profile.thunderstorm) {
      this.createRaykaThunderstorm(troop, resolvedTarget.x, resolvedTarget.y);
      troop.focus = resolvedTarget;
      return 0;
    }
    if (allyHeal) {
      const recipients = [
        resolvedTarget,
        ...enemies
          .filter(
            (ally) =>
              ally !== resolvedTarget &&
              ally.hp < ally.maxHp &&
              troop.distanceTo(ally) <= troop.attackRange,
          )
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp),
      ].slice(0, (profile.healTargets || 0) + 1);
      const healAmount = Math.round(
        (profile.healFlat || 0) + scaleDamage(troop.stats, profile.healScaling || {}),
      );
      let totalHealed = 0;
      for (const ally of recipients) {
        const before = ally.hp;
        ally.hp = Math.min(
          ally.maxHp,
          ally.hp + Math.round(healAmount * this.allyBonusMultiplier(ally)),
        );
        totalHealed += ally.hp - before;
      }
      troop.focus = resolvedTarget;
      return totalHealed;
    }
    const targetHpBonus = resolvedTarget.stats
      ? Math.round((resolvedTarget.maxHp || 0) * (profile.targetMaxHpFraction || 0))
      : 0;
    const raw = scaleDamage(troop.stats, profile.scaling) + targetHpBonus;
    const resistance = resolvedTarget.stats
      ? profile.damageType === 'magic'
        ? resolvedTarget.magicResist
        : resolvedTarget.armor
      : profile.damageType === 'magic'
        ? resolvedTarget.magicResist || 0
        : resolvedTarget.armor || 0;
    const damageMultiplier = !resolvedTarget.stats
      ? (troop.stats.structureDamageMultiplier ?? 1)
      : 1;
    const armorPen = profile.damageType === 'physical' ? troop.stats.flatArmorPen || 0 : 0;
    const percentPen =
      profile.damageType === 'magic' ? troop.magicPenPercent : troop.stats.percentPen || 0;
    const damage = Math.round(
      applyResistance(raw, resistance, profile.damageType, armorPen, percentPen) * damageMultiplier,
    );
    const totalDamage = this.applyDamage(resolvedTarget, damage, troop, {
      ranged: troop.stats.range > 80,
    });
    if (troop.stats.id === 'hugo') this.addHugoEnergy(troop, 10);
    const splashRadius = troop.stats.basicAttack.aoeRadius || 0;
    if (splashRadius > 0) {
      this.showDamageArea({
        x: resolvedTarget.x,
        y: resolvedTarget.y,
        radius: splashRadius,
        team: troop.team,
      });
      for (const splashTarget of enemies) {
        if (
          splashTarget === resolvedTarget ||
          !splashTarget.stats ||
          splashTarget.hp <= 0 ||
          !troop.canTarget(splashTarget) ||
          Math.hypot(splashTarget.x - resolvedTarget.x, splashTarget.y - resolvedTarget.y) >
            splashRadius
        )
          continue;
        const splashResistance =
          profile.damageType === 'magic' ? splashTarget.magicResist : splashTarget.armor;
        const splashDamage = Math.round(
          applyResistance(
            raw,
            splashResistance,
            profile.damageType,
            profile.damageType === 'physical' ? troop.stats.flatArmorPen || 0 : 0,
            profile.damageType === 'magic' ? troop.magicPenPercent : troop.stats.percentPen || 0,
          ),
        );
        this.applyDamage(splashTarget, splashDamage, troop, { ranged: troop.stats.range > 80 });
      }
    }
    if (profile.applyRookieMark) this.applyRookieMark(troop, resolvedTarget);
    if (resolvedTarget.stats && resolvedTarget.hp > 0) {
      const marking = troop.effects.find((effect) => effect.type === 'mark-on-hit');
      if (marking) {
        const marksId = `ninja-marks-${troop.squadId || troop.team}`;
        let marks = resolvedTarget.effects.find((effect) => effect.id === marksId);
        if (!marks) {
          resolvedTarget.addEffect({
            id: marksId,
            type: 'ninja-marks',
            stacks: 0,
            remainingTurns: marking.remainingTurns,
          });
          marks = resolvedTarget.effects.find((effect) => effect.id === marksId);
        }
        marks.stacks += 1;
        marks.remainingTurns = marking.remainingTurns;
        if (marks.stacks >= 10) {
          resolvedTarget.stun();
          resolvedTarget.addEffect({
            id: `ninja-stun-${troop.squadId || troop.team}`,
            type: 'stun',
            remainingTurns: marking.stunDuration || 2,
          });
          resolvedTarget.effects = resolvedTarget.effects.filter((effect) => effect.id !== marksId);
        }
      }
    }
    if (
      resolvedTarget.stats &&
      resolvedTarget.hp > 0 &&
      troop.effects.some((effect) => effect.type === 'launch-next-hit')
    ) {
      resolvedTarget.stun();
      resolvedTarget.addEffect({
        id: 'burrower-airborne',
        type: 'airborne',
        remainingTurns: 2,
      });
      troop.effects = troop.effects.filter((effect) => effect.type !== 'launch-next-hit');
    }
    if (!troop.isClone && troop.effects.some((effect) => effect.type === 'clone-on-hit'))
      this.spawnNinjaClone(troop);
    troop.focus = resolvedTarget;
    this.board.removeDefeated();
    this.resolveStructureOutcomes();
    for (const player of this.players) {
      player.units = player.units.filter((u) => u.hp > 0);
    }
    return totalDamage;
  }
  spawnNinjaClone(summoner) {
    const clones = this.board.troops.filter(
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
        candidate.x >= 14 &&
        candidate.x <= this.board.width - 14 &&
        candidate.y >= 14 &&
        candidate.y <= this.board.height - 14 &&
        !this.isBlockedByTerrain(candidate.x, candidate.y, 9, 'ground'),
    ) || { x: summoner.x, y: summoner.y };
    const clone = new Troop(summoner.stats, summoner.team, position.x, position.y);
    clone.squadId = summoner.squadId;
    clone.isClone = true;
    clone.summonedBy = summoner;
    clone.stunned = false;
    clone.ac = clone.initialAC;
    clone.movementRemaining = 0;
    for (const effect of summoner.effects.filter((active) => active.type === 'mark-on-hit')) {
      clone.addEffect({ ...effect });
    }
    this.board.addTroop(clone);
    this.players[clone.team].units.push(clone);
    this.resolveMovementCollisions(new Set([clone]));
    this.addEvent(`${this.teamName(clone.team)} Ninja created a shadow clone.`, clone.team);
    return clone;
  }
  spawnRebyDrone(reby, target) {
    const stats = {
      id: 'reby_drone',
      name: 'Kamikaze Drone',
      icon: 'd',
      hp: Math.round(reby.stats.hp * 0.16),
      force: 0,
      atk: reby.stats.atk,
      apt: 0,
      armor: 10,
      magicResist: 10,
      range: 18,
      sight: Infinity,
      attackTypes: ['ground', 'air'],
      basicAttack: { damageType: 'magic', scaling: { atk: 3.5 } },
      attackCost: 0,
      initialAC: 0,
      movement: 81.6,
      movementType: 'air',
      isDrone: true,
      isMinion: true,
      mass: 0.2,
    };
    const dx = target.x - reby.x;
    const dy = target.y - reby.y;
    const distance = Math.hypot(dx, dy) || 1;
    const forward = { x: dx / distance, y: dy / distance };
    const side = { x: -forward.y, y: forward.x };
    const index = reby.droneWaveIndex || 0;
    const lane = (index % 3) - 1;
    const spawn = {
      x: Math.max(
        14,
        Math.min(this.board.width - 14, reby.x + forward.x * 48 + side.x * lane * 30),
      ),
      y: Math.max(
        14,
        Math.min(this.board.height - 14, reby.y + forward.y * 48 + side.y * lane * 30),
      ),
    };
    reby.droneWaveIndex = index + 1;
    const drone = new Troop(stats, reby.team, spawn.x, spawn.y);
    drone.isDrone = true;
    drone.isMinion = true;
    drone.stunned = false;
    drone.ac = 0;
    drone.droneTarget = target;
    drone.droneDamage = Math.round(reby.stats.atk * 3.5);
    drone.droneDamageType = 'magic';
    drone.droneSplashRadius = 40.8;
    drone.facing = Math.atan2(forward.y, forward.x);
    this.board.addTroop(drone);
    this.players[reby.team].units.push(drone);
    return drone;
  }
  droneTarget(drone) {
    const enemies = this.board.enemyTargets(drone.team);
    if (!drone.droneTarget || drone.droneTarget.hp <= 0 || !enemies.includes(drone.droneTarget)) {
      drone.droneTarget =
        enemies
          .filter((enemy) => enemy.hp > 0)
          .sort((a, b) => drone.distanceTo(a) - drone.distanceTo(b))[0] || null;
    }
    return drone.droneTarget;
  }
  finishDroneMovement(drone) {
    const target = this.droneTarget(drone);
    if (!target) {
      drone.hp = 0;
      drone.detonateOnArrival = false;
      return;
    }
    const impactRadius = target.type === 'base' ? 46 : target.layer ? 27 : 18;
    if (drone.distanceTo(target) > impactRadius + 2) {
      drone.detonateOnArrival = false;
      return;
    }
    const enemies = this.board.enemyTargets(drone.team);
    const blastTargets = enemies.filter(
      (enemy) => enemy.hp > 0 && drone.distanceTo(enemy) <= drone.droneSplashRadius,
    );
    for (const blastTarget of blastTargets) {
      const resistance = blastTarget.stats
        ? drone.droneDamageType === 'magic'
          ? blastTarget.stats.magicResist
          : blastTarget.stats.armor
        : drone.droneDamageType === 'magic'
          ? blastTarget.magicResist
          : blastTarget.armor;
      const damage = applyResistance(drone.droneDamage, resistance || 0, drone.droneDamageType);
      this.applyDamage(blastTarget, damage, drone);
    }
    this.board.impacts.push({
      x: drone.x,
      y: drone.y,
      radius: drone.droneSplashRadius,
      duration: 0.45,
      remainingSeconds: 0.45,
      kind: 'drone-explosion',
      team: drone.team,
    });
    this.addEvent(
      `${this.teamName(drone.team)} kamikaze drone explodes for ${blastTargets.length} magic hit${blastTargets.length === 1 ? '' : 's'}.`,
      drone.team,
    );
    drone.hp = 0;
    drone.detonateOnArrival = false;
    this.resolveStructureOutcomes();
  }
  planDroneMovement(drone) {
    const target = this.droneTarget(drone);
    if (!target) {
      drone.hp = 0;
      return null;
    }
    const dx = target.x - drone.x;
    const dy = target.y - drone.y;
    const distance = Math.hypot(dx, dy);
    const impactRadius = target.type === 'base' ? 46 : target.layer ? 27 : 18;
    if (distance <= impactRadius + 2) {
      this.finishDroneMovement(drone);
      return null;
    }
    const moved = Math.min(drone.movementRemaining, distance - impactRadius);
    const startX = drone.x;
    const startY = drone.y;
    drone.facing = Math.atan2(dy, dx);
    drone.x += (dx / distance) * moved;
    drone.y += (dy / distance) * moved;
    drone.movementRemaining -= moved;
    drone.detonateOnArrival = distance - moved <= impactRadius + 2;
    return { startX, startY, waypoints: [{ x: drone.x, y: drone.y }] };
  }
  summonBuilding(team, x, y, role, caster, ability) {
    const isRanged = role === 'ranged';
    const stats = {
      id: isRanged ? 'reby_ranged_foundry' : 'reby_melee_foundry',
      name: isRanged ? 'Drone Foundry' : 'Guard Foundry',
      icon: isRanged ? 'f' : 'g',
      hp: scaleDamage(caster.stats, ability.buildingHealthScaling || {}),
      force: 0,
      atk: 0,
      apt: 0,
      armor: 70,
      magicResist: 70,
      range: 0,
      sight: 0,
      attackTypes: ['ground', 'air'],
      basicAttack: { damageType: 'physical', scaling: {} },
      attackCost: 70,
      initialAC: 50,
      acPerTurn: 15,
      movement: 0,
      isBuilding: true,
      mass: 3,
      buildingDecay: scaleDamage(caster.stats, ability.buildingDecayScaling || {}),
      spawnRole: role,
      spawnIntervalTurns: ability.spawnIntervalTurns || 4,
      spawnedHp: scaleDamage(caster.stats, ability.spawnedHpScaling || {}),
      spawnedAtk: scaleDamage(caster.stats, ability.spawnedAtkScaling || {}),
    };
    const building = new Troop(stats, team, x, y);
    building.stunned = false;
    building.isSummon = true;
    building.spawnTurns = ability.spawnIntervalTurns || 4;
    this.board.addTroop(building);
    this.players[team].units.push(building);
    return building;
  }
  spawnFoundryTroop(building) {
    const ranged = building.stats.spawnRole === 'ranged';
    const stats = {
      id: ranged ? 'reby_scout' : 'reby_guard',
      name: ranged ? 'Foundry Scout' : 'Foundry Guard',
      icon: ranged ? 's' : 'g',
      hp: building.stats.spawnedHp,
      force: 0,
      atk: building.stats.spawnedAtk,
      apt: 30,
      armor: 50,
      magicResist: 50,
      range: ranged ? 149.6 : 24,
      sight: ranged ? 149.6 : 143,
      attackTypes: ranged ? ['ground', 'air'] : ['ground'],
      basicAttack: { damageType: 'physical', scaling: { atk: 0.8 } },
      attackCost: 8,
      initialAC: 8,
      movement: ranged ? 81.6 : 61.2,
      color: building.team === 0 ? '#55e1dd' : '#ff6978',
      isMinion: true,
      mass: ranged ? 0.6 : 1.2,
    };
    const enemy = this.board
      .enemyTargets(building.team)
      .filter((target) => target.hp > 0)
      .sort((a, b) => building.distanceTo(a) - building.distanceTo(b))[0];
    const angleToEnemy = enemy
      ? Math.atan2(enemy.y - building.y, enemy.x - building.x)
      : building.team === 0
        ? 0
        : Math.PI;
    let position = null;
    for (const distance of [48, 68, 88]) {
      for (const lateral of [0, -26, 26, -52, 52]) {
        const angle = angleToEnemy;
        const candidate = {
          x: building.x + Math.cos(angle) * distance - Math.sin(angle) * lateral,
          y: building.y + Math.sin(angle) * distance + Math.cos(angle) * lateral,
        };
        if (
          candidate.x < 20 ||
          candidate.x > this.board.width - 20 ||
          candidate.y < 20 ||
          candidate.y > this.board.height - 20
        )
          continue;
        if (
          this.isBlockedByTerrain(candidate.x, candidate.y, 20, 'ground') ||
          this.isBlockedByTroop(candidate.x, candidate.y, 20, null, 'ground')
        )
          continue;
        position = candidate;
        break;
      }
      if (position) break;
    }
    if (!position) return false;
    const troop = new Troop(stats, building.team, position.x, position.y);
    troop.stunned = false;
    troop.facing = angleToEnemy;
    this.board.addTroop(troop);
    this.players[building.team].units.push(troop);
    return true;
  }
  tickBuildings() {
    for (const building of this.board.troops) {
      if (!building.stats.isBuilding || building.hp <= 0) continue;
      const momentumShields = building.effects.filter(
        (effect) => effect.type === 'momentum-shield',
      );
      building.takeDamage(building.stats.buildingDecay || 8);
      for (const shield of momentumShields) {
        if (shield.remainingAmount <= 0 && !building.effects.includes(shield))
          this.detonateMomentumShield(building, shield);
      }
      if (building.hp <= 0) continue;
      if (building.stats.id === 'reby') {
        building.spawnTurns -= 1;
        if (building.spawnTurns <= 0) {
          const target = this.board
            .enemyTargets(building.team)
            .filter((enemy) => enemy.hp > 0)
            .sort((a, b) => building.distanceTo(a) - building.distanceTo(b))[0];
          if (target) {
            this.spawnRebyDrone(building, target);
            this.spawnRebyDrone(building, target);
            this.addEvent(
              `${this.teamName(building.team)} Reby launches 2 kamikaze drones.`,
              building.team,
            );
          }
          building.spawnTurns = building.stats.spawnIntervalTurns;
        }
        continue;
      }
      if (!building.stats.spawnRole) continue;
      building.spawnTurns -= 1;
      if (building.spawnTurns <= 0) {
        building.spawnTurns = this.spawnFoundryTroop(building)
          ? building.stats.spawnIntervalTurns
          : 1;
      }
    }
  }
  autoAttack(player) {
    const attacks = [];
    for (const troop of player.units) {
      if (troop.hp <= 0 || troop.stunned || troop.burrowed) continue;
      if (troop.stats.isBuilding) continue;
      if (troop.isDrone) continue;
      const enemies = this.targetsFor(troop);
      troop.validateFocus(enemies);
      if (!troop.focus) troop.updateFocus(enemies);
      while (
        troop.focus &&
        troop.focus.hp > 0 &&
        troop.attackDistanceTo(troop.focus) <= troop.attackRange &&
        troop.ac >= troop.stats.attackCost
      ) {
        const targetName = troop.focus.stats
          ? troop.focus.stats.name
          : troop.focus.layer
            ? `${troop.focus.layer} turret`
            : 'base';
        const result = this.attack(troop, troop.focus);
        if (result === false) break;
        if (troop.stats.targetPreference === 'allies') {
          if (result <= 0) break;
          attacks.push(
            `${this.teamName(player.team)} Kaguya healed ${result} HP across her allies`,
          );
        } else if (troop.stats.id === 'rayka') {
          attacks.push(
            `${this.teamName(player.team)} Rayka summoned a thunderstorm at ${targetName}`,
          );
        } else {
          attacks.push(
            `${this.teamName(player.team)} ${troop.stats.name} dealt ${result} ${troop.stats.basicAttack.damageType} damage to ${targetName}`,
          );
        }
        const currentEnemies = this.targetsFor(troop);
        troop.validateFocus(currentEnemies);
      }
    }
    return attacks;
  }
  endTurn() {
    if (this.winner !== null) return;
    const ending = this.activePlayer();
    const raykas = this.board.troops.filter((troop) => troop.stats.id === 'rayka' && troop.hp > 0);
    for (const rayka of raykas) rayka.energyGeneratedThisTurn = false;
    const autoAttacks = this.autoAttack(ending);
    if (this.winner !== null) return;
    ending.units.forEach((t) => t.prepareEndTurn(this.targetsFor(t)));
    this.ensureTroop(ending);
    this.fireTurrets();
    this.tickZones();
    for (const rayka of raykas) {
      if (rayka.energyGeneratedThisTurn) rayka.energyIdleTurns = 0;
      else {
        rayka.energyIdleTurns += 1;
        if (rayka.energyIdleTurns > 2) rayka.energy *= 0.9;
      }
    }
    this.tickStrikes();
    for (const troop of this.board.troops) {
      const expiringMomentumShields = troop.effects.filter(
        (effect) => effect.type === 'momentum-shield' && effect.remainingTurns <= 1,
      );
      troop.tickEffects();
      for (const shield of expiringMomentumShields) this.detonateMomentumShield(troop, shield);
    }
    this.tickGrassPatches();
    this.tickBurrows();
    this.tickBuildings();
    this.board.removeDefeated();
    for (const player of this.players) {
      player.units = player.units.filter((u) => u.hp > 0);
    }
    this.turns.end();
    const next = this.activePlayer();
    next.generate();
    next.units.forEach((t) => t.reset(this.targetsFor(t)));
    this.executeBeginningMovement(next);
    const turnMsg = `${this.teamName(next.team)}'s turn; ${next.elixir} Elixir and ${next.ap} AP available`;
    this.message = autoAttacks.length > 0 ? `${autoAttacks.join('; ')}. ${turnMsg}` : turnMsg;
    for (const event of autoAttacks) this.events.push({ message: event, team: ending.team });
    this.events.push({ message: turnMsg, team: next.team });
  }
  tickZones() {
    for (const zone of [...this.board.zones]) {
      const ability = this.abilities[zone.abilityId];
      if (zone.isSmokeField) {
        for (const target of this.board.troops) {
          if (
            target.hp <= 0 ||
            target.burrowed ||
            target.team === zone.team ||
            target.stats.isBuilding ||
            target.distanceTo(zone) > zone.radius
          )
            continue;
          target.addEffect({
            id: `smoke-${zone.team}-${zone.x}-${zone.y}-range`,
            type: 'attack-range',
            multiplier: ability.rangeMultiplier,
            remainingTurns: 2,
          });
          target.addEffect({
            id: `smoke-${zone.team}-${zone.x}-${zone.y}-sight`,
            type: 'sight-range',
            multiplier: ability.sightMultiplier,
            remainingTurns: 2,
          });
          target.validateFocus(this.targetsFor(target));
        }
        zone.remainingTurns -= 1;
        continue;
      }
      const targets = zone.isRaykaStorm
        ? [...this.board.troops, ...this.board.turrets, ...this.board.towers]
        : this.board.troops;
      for (const target of targets) {
        if (
          target.hp <= 0 ||
          target.burrowed ||
          target.team === zone.team ||
          Math.hypot(target.x - zone.x, target.y - zone.y) > zone.radius
        )
          continue;
        const raw =
          (ability.damagePerTurn || 0) +
          scaleDamage(
            zone.caster.stats,
            zone.damagePerTurnScaling || ability.damagePerTurnScaling || {},
          );
        const damage = Math.round(
          applyResistance(
            raw * (zone.damageMultiplier || 1) * (!target.stats ? 0.5 : 1),
            target.magicResist,
            'magic',
            0,
            zone.caster.magicPenPercent,
          ),
        );
        const healthDamage = this.applyDamage(target, damage, zone.caster, { ranged: true });
        const skillThreeActive = zone.caster.effects.some(
          (effect) => effect.type === 'rayka-storm-empower' && effect.remainingTurns > 0,
        );
        if (zone.isRaykaStorm && skillThreeActive && target.stats && !target.stats.isBuilding) {
          const confusionId = `rayka-confused-${zone.id}`;
          target.addEffect({ id: confusionId, type: 'confused', remainingTurns: 2 });
        }
        if (zone.isRaykaStorm && target.stats && !target.stats.isBuilding && healthDamage > 0) {
          const aegis = zone.caster.effects.find(
            (effect) => effect.type === 'rayka-aegis' && effect.remainingTurns > 0,
          );
          if (aegis) {
            zone.caster.hp = Math.min(
              zone.caster.maxHp,
              zone.caster.hp + healthDamage * aegis.healMultiplier,
            );
            zone.caster.energy += aegis.energyPerHit;
            zone.caster.energyGeneratedThisTurn = true;
          }
        }
        const isBuilding = target.stats?.isBuilding || target.layer || target.type === 'base';
        if (
          zone.isRaykaStorm &&
          isBuilding &&
          zone.canChainToBuildings &&
          !zone.chainedBuildings.has(target)
        ) {
          zone.chainedBuildings.add(target);
          this.createRaykaThunderstorm(zone.caster, target.x, target.y, {
            duration: zone.remainingTurns,
            radius: zone.radius,
            damageMultiplier: zone.damageMultiplier,
            canChainToBuildings: false,
          });
        }
      }
      if (!zone.isRaykaStorm && (ability.damagePerTurn > 0 || ability.damagePerTurnScaling))
        this.showDamageArea({ x: zone.x, y: zone.y, radius: zone.radius, team: zone.team });
      zone.remainingTurns -= 1;
    }
    this.board.zones = this.board.zones.filter((zone) => zone.remainingTurns > 0);
    this.board.removeDefeated();
    this.resolveStructureOutcomes();
  }
  createRaykaThunderstorm(rayka, x, y, overrides = {}) {
    const empowerment = rayka.effects.find(
      (effect) => effect.type === 'rayka-storm-empower' && effect.remainingTurns > 0,
    );
    const multiplier = overrides.damageMultiplier ?? empowerment?.stormMultiplier ?? 1;
    const radius = overrides.radius ?? rayka.stats.basicAttack.thunderstormRadius * multiplier;
    const duration =
      overrides.duration ?? (empowerment ? 4 : rayka.stats.basicAttack.thunderstormDuration);
    const zone = {
      id: `rayka-storm-${this.squadCounter++}`,
      abilityId: 'rayka_storm',
      caster: rayka,
      team: rayka.team,
      x,
      y,
      radius,
      remainingTurns: duration,
      damagePerTurnScaling: rayka.stats.basicAttack.scaling,
      damageMultiplier: multiplier,
      isRaykaStorm: true,
      isEmpoweredStorm: Boolean(empowerment),
      canChainToBuildings: overrides.canChainToBuildings ?? true,
      chainedBuildings: new Set(),
    };
    this.board.zones.push(zone);
    return zone;
  }
  tickStrikes() {
    for (const strike of this.board.strikes) {
      strike.remainingTurns -= 1;
      if (strike.remainingTurns > 0) continue;
      const data = this.abilities[strike.abilityId];
      const targets = [...this.board.troops, ...this.board.turrets, ...this.board.towers];
      for (const target of targets) {
        if (target.hp <= 0 || target.burrowed || target.team === strike.team) continue;
        const distance = Math.hypot(target.x - strike.x, target.y - strike.y);
        if (distance > data.radius) continue;
        const atCenter = distance <= data.centerRadius;
        const raw = Math.round(
          ((data.damage || 0) + scaleDamage(strike.caster.stats, data.scaling || {})) *
            (atCenter ? data.centerDamageMultiplier : 1),
        );
        const damage = Math.round(
          applyResistance(raw, target.magicResist, 'magic') * (!target.stats ? 0.35 : 1),
        );
        this.applyDamage(target, damage, strike.caster, { ranged: true });
        if (target.stats && !target.stats.isBuilding) {
          const push = data.knockback * (atCenter ? data.centerKnockbackMultiplier : 1);
          this.knockbackTarget({ x: strike.x, y: strike.y }, target, push);
        }
      }
      this.board.impacts.push({
        kind: 'skyfall',
        x: strike.x,
        y: strike.y,
        radius: data.radius,
        innerRadius: data.centerRadius,
        duration: 2,
        remainingSeconds: 2,
      });
      this.shakeTimer = Math.max(this.shakeTimer, 2);
      this.addEvent(`${this.teamName(strike.team)} Kaguya’s Skyfall Bomb impacts!`, strike.team);
      this.resolveStructureOutcomes();
    }
    this.board.strikes = this.board.strikes.filter((strike) => strike.remainingTurns > 0);
    this.board.removeDefeated();
  }
  tickBurrows() {
    for (const troop of this.board.troops) {
      if (!troop.burrowed) continue;
      troop.burrowTurns -= 1;
      if (troop.burrowTurns > 0) continue;
      const destination = this.findBurrowEmergence(troop, troop.burrowDestination);
      if (!destination) continue;
      troop.x = destination.x;
      troop.y = destination.y;
      troop.burrowed = false;
      troop.burrowDestination = null;
      troop.burrowTurns = 0;
      troop.addEffect({
        id: 'burrower-launch-next-hit',
        type: 'launch-next-hit',
        remainingTurns: troop.nextAttackDuration || 4,
      });
      troop.nextAttackDuration = 0;
      this.addEvent(`${this.teamName(troop.team)} Burrower emerged from its tunnel.`, troop.team);
    }
  }
  findBurrowEmergence(troop, destination) {
    const positions = [destination];
    for (const distance of [42, 56, 70, 84, 98]) {
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12;
        positions.push({
          x: destination.x + Math.cos(angle) * distance,
          y: destination.y + Math.sin(angle) * distance,
        });
      }
    }
    return (
      positions.find(
        (position) =>
          position.x >= 20 &&
          position.x <= this.board.width - 20 &&
          position.y >= 20 &&
          position.y <= this.board.height - 20 &&
          !this.isBlockedByTerrain(position.x, position.y, 14, 'ground') &&
          !this.isBlockedByTroop(position.x, position.y, 20, troop, 'ground'),
      ) || null
    );
  }
  cast(card, caster, x, y, target = null) {
    if (this.winner !== null) return false;
    const player = this.activePlayer();
    const data = this.abilities[card.abilityId];
    if (caster.burrowed) {
      this.message = 'Troop is underground';
      return false;
    }
    if (caster.isClone) {
      this.message = 'Clones cannot use abilities';
      return false;
    }
    if (caster.stunned) {
      this.message = 'Troop is stunned';
      return false;
    }
    if (caster.effects.some((effect) => effect.type === 'silence')) {
      this.message = 'Troop is silenced and cannot use abilities';
      return false;
    }
    if (caster.team !== player.team) {
      this.message = 'Only your own troops can cast abilities';
      return false;
    }
    if (data.troop !== caster.stats.id) {
      this.message = `${caster.stats.name} can only cast its own abilities`;
      return false;
    }
    if (data.requireNoFocus) {
      caster.validateFocus(this.targetsFor(caster));
      if (caster.focus) {
        this.message = `${card.name} can only be used while Rayka has no focus`;
        return false;
      }
    }
    if (data.requiresEnergy && caster.energy <= 0) {
      this.message = `${card.name} requires Rayka to have energy`;
      return false;
    }
    const targeting = data.targeting || (data.heal ? 'self' : 'area');
    if (targeting === 'unit') {
      const isAlly = target?.team === caster.team && target !== caster;
      const isEnemy = target?.team !== caster.team;
      const isArenaStructure = [...this.board.turrets, ...this.board.towers].includes(target);
      const teamAllowed =
        data.targetTeam === 'ally'
          ? isAlly
          : data.targetTeam === 'enemy'
            ? isEnemy
            : isAlly || isEnemy;
      const targetAllowed = this.board.troops.includes(target)
        ? !target.burrowed
        : isArenaStructure && hasDirectAbilityDamage(data) && data.targetTeam !== 'ally';
      const valid =
        target &&
        targetAllowed &&
        target.hp > 0 &&
        teamAllowed &&
        caster.distanceTo(target) <= (data.targetRange ?? Infinity);
      if (!valid) {
        this.message =
          data.targetTeam === 'ally'
            ? `Select a valid ally within ${data.targetRange} units before casting ${card.name}`
            : `Select a valid target before casting ${card.name}`;
        return false;
      }
    }
    if (data.requiresStructureInAttackRange) {
      const buildingInRange = [
        ...this.board.turrets,
        ...this.board.towers,
        ...this.board.troops.filter((unit) => unit.stats.isBuilding),
      ].some(
        (building) => building.hp > 0 && caster.attackDistanceTo(building) <= caster.attackRange,
      );
      if (!buildingInRange) {
        this.message = 'Dab requires a building in Hugo’s attack range';
        return false;
      }
    }
    let teleportDestination = null;
    let dashPath = null;
    if (data.teleportToTarget) {
      teleportDestination = this.teleportDestination(caster, target);
      if (!teleportDestination) {
        this.message = 'No free air space near that ally';
        return false;
      }
    }
    if (data.dashToTarget) {
      dashPath = this.findPath(caster, target);
      const destination = dashPath[dashPath.length - 1];
      if (
        !destination ||
        Math.hypot(destination.x - target.x, destination.y - target.y) > caster.attackRange
      ) {
        this.message = 'No path into attack range';
        return false;
      }
    }
    if (
      targeting === 'area' &&
      data.castRange &&
      Math.hypot(x - caster.x, y - caster.y) > data.castRange
    ) {
      this.message = `Choose an area within ${data.castRange} units`;
      return false;
    }
    if (targeting === 'direction' && Math.hypot(x - caster.x, y - caster.y) < 1) {
      this.message = 'Choose a direction before casting';
      return false;
    }
    const directionalTargets =
      targeting === 'direction' ? this.directionalAbilityTargets(data, caster, x, y) : null;
    if (player.ap < data.darkCost) {
      this.message = 'Not enough AP';
      return false;
    }
    if (caster.ac < data.apCost) {
      this.message = 'Not enough AC';
      return false;
    }
    player.ap -= data.darkCost;
    this.spendAC(caster, data.apCost);
    if (caster.hp <= 0) {
      this.message = 'Troop was defeated by its bleed before casting';
      return false;
    }
    if (targeting === 'self') {
      this.applyAbilityToTarget(data, caster, caster);
    } else if (targeting === 'area' && data.summonBuilding) {
      this.summonBuilding(caster.team, x, y, data.summonBuilding, caster, data);
    } else if (targeting === 'area' && data.delayedStrike) {
      this.board.strikes.push({
        abilityId: data.id,
        caster,
        team: caster.team,
        x,
        y,
        remainingTurns: data.delayTurns,
      });
    } else if (targeting === 'unit' && data.projectile) {
      this.board.projectiles.push({
        abilityId: data.id,
        caster,
        targetUnit: target,
        from: { x: caster.x, y: caster.y },
        progress: 0,
      });
    } else if (targeting === 'unit') {
      if (data.selfDefenseArmor || data.selfDefenseMagicResist) {
        caster.addEffect({
          id: `${data.id}-self-defense`,
          type: 'defense',
          armor: data.selfDefenseArmor || 0,
          magicResist: data.selfDefenseMagicResist || 0,
          remainingTurns: data.duration,
        });
      }
      if (data.dashToTarget) {
        caster.focus = target;
        caster.waypoints = dashPath.slice(1);
        caster.dashingTo = caster.waypoints.length ? target : null;
        if (caster.waypoints.length) {
          const first = caster.waypoints[0];
          caster.facing = Math.atan2(first.y - caster.y, first.x - caster.x);
        }
      } else this.applyAbilityToTarget(data, caster, target, teleportDestination);
    } else if (targeting === 'area' && data.projectile) {
      this.board.projectiles.push({
        abilityId: data.id,
        caster,
        from: { x: caster.x, y: caster.y },
        targetPoint: { x, y },
        progress: 0,
      });
    } else if (targeting === 'area' && data.burrowTurns) {
      caster.burrowed = true;
      caster.burrowDestination = { x, y };
      caster.burrowTurns = data.burrowTurns;
      caster.nextAttackDuration = data.nextAttackDuration;
      caster.focus = null;
      caster.waypoints = [];
      caster.dashingTo = null;
    } else if (targeting === 'area' && data.createsZone) {
      this.board.zones.push({
        abilityId: data.id,
        caster,
        team: caster.team,
        x,
        y,
        radius: data.radius,
        remainingTurns: data.duration,
      });
    } else if (targeting === 'area') {
      this.applyAbilityArea(data, caster, x, y);
    } else if (targeting === 'direction') {
      this.applyDirectionalAbility(data, caster, directionalTargets, x, y);
    }
    player.hand.play(card, player.deck);
    this.board.removeDefeated();
    this.resolveStructureOutcomes();
    this.ensureTroop(player);
    this.addEvent(`${this.teamName(caster.team)} ${card.name} cast.`, caster.team);
    return true;
  }
  applyAbilityArea(data, caster, x, y) {
    if (
      data.damage ||
      data.damageFraction ||
      data.targetMaxHpFraction ||
      data.damagePerTurn ||
      data.damagePerTurnScaling ||
      data.scaling
    )
      this.showDamageArea({ x, y, radius: data.radius || 0, team: caster.team });
    const targets = this.board.troops.filter(
      (troop) =>
        !troop.burrowed &&
        troop.team !== caster.team &&
        Math.hypot(troop.x - x, troop.y - y) <= data.radius,
    );
    // Delayed Skyfall Bomb remains troop-only until its turret interaction is designed.
    if (hasDirectAbilityDamage(data) && !data.delayedStrike) {
      targets.push(
        ...[...this.board.turrets, ...this.board.towers].filter(
          (structure) =>
            structure.hp > 0 &&
            structure.team !== caster.team &&
            Math.hypot(structure.x - x, structure.y - y) <= data.radius,
        ),
      );
    }
    for (const target of targets) this.applyAbilityToTarget(data, caster, target);
  }
  applyAbilityToTarget(data, caster, target, teleportDestination = null) {
    if (data.energyGain) this.addHugoEnergy(caster, data.energyGain);
    if (data.magicPenBuff) {
      const members = caster.squadId
        ? this.board.troops.filter((unit) => unit.squadId === caster.squadId && unit.hp > 0)
        : [caster];
      for (const member of members) {
        member.addEffect({
          id: `${data.id}-active`,
          type: 'magic-penetration',
          amount: data.magicPenBuff,
          remainingTurns: data.duration,
        });
      }
      return;
    }
    if (data.raykaAegis) {
      caster.addEffect({
        id: `${data.id}-active`,
        type: 'rayka-aegis',
        healMultiplier: data.aegisHealMultiplier,
        energyPerHit: data.energyPerStormHit,
        remainingTurns: data.duration,
      });
      return;
    }
    if (data.raykaStormEmpower) {
      const consumed = caster.energy;
      caster.energy = 0;
      caster.energyIdleTurns = 0;
      caster.energyGeneratedThisTurn = false;
      caster.addEffect({
        id: `${data.id}-active`,
        type: 'rayka-storm-empower',
        energyConsumed: consumed,
        stormMultiplier: 1 + consumed * data.energyDamageAndRadiusPerStack,
        remainingTurns: data.duration,
      });
      this.addEvent(
        `${this.teamName(caster.team)} Rayka consumed ${consumed.toFixed(1)} energy to empower her thunderstorms.`,
        caster.team,
      );
      return;
    }
    if (data.smokeField) {
      if (data.damage || data.damageFraction || data.targetMaxHpFraction || data.scaling)
        return this.damageWithAbility(data, caster, target);
      return;
    }
    if (data.hugoWall) {
      const angle = caster.facing ?? (caster.team === 0 ? 0 : Math.PI);
      caster.addEffect({
        id: `${data.id}-wall`,
        type: 'hugo-wall',
        selectedAlly: target,
        angle,
        length: data.wallWidth,
        frontOffset: 22,
        damageReductionForce: data.wallDamageReductionForce,
        towerDamageReductionForce: data.wallTowerDamageReductionForce,
        remainingTurns: data.duration,
      });
      caster.addEffect({
        id: `${data.id}-slow`,
        type: 'move-speed',
        multiplier: data.selfMoveSpeedMultiplier,
        remainingTurns: data.duration,
      });
      return;
    }
    if (data.domeHealth || data.domeHealthScaling) {
      caster.addEffect({
        id: `${data.id}-dome`,
        type: 'protective-dome',
        radius: data.domeRadius,
        remainingAmount: data.domeHealth || scaleDamage(caster.stats, data.domeHealthScaling || {}),
        remainingTurns: data.duration,
      });
      return;
    }
    if (data.groupEffect) {
      const members = this.board.troops.filter(
        (troop) => troop.squadId === caster.squadId && troop.hp > 0,
      );
      for (const member of members) {
        member.addEffect({
          id: `${data.id}-${data.groupEffect}`,
          type: data.groupEffect,
          stunDuration: data.stunDuration,
          remainingTurns: data.duration,
        });
      }
      return;
    }
    if (data.teleportToTarget && teleportDestination) {
      const dx = teleportDestination.x - caster.x;
      const dy = teleportDestination.y - caster.y;
      if (Math.hypot(dx, dy) > 0) caster.facing = Math.atan2(dy, dx);
      caster.x = teleportDestination.x;
      caster.y = teleportDestination.y;
      caster.waypoints = [];
      caster.validateFocus(this.board.enemyTargets(caster.team));
      for (const troop of [caster, target]) {
        const speedMultiplier =
          1 + (data.moveSpeedMultiplier - 1) * this.allyBonusMultiplier(troop);
        troop.addEffect({
          id: `${data.id}-move-speed`,
          type: 'move-speed',
          multiplier: speedMultiplier,
          remainingSeconds: data.durationSeconds,
        });
      }
    }
    const buffMultiplier = target.team === caster.team ? this.allyBonusMultiplier(target) : 1;
    const healing =
      ((data.heal || 0) + scaleDamage(caster.stats, data.healScaling || {})) * buffMultiplier;
    if (healing > 0) target.hp = Math.min(target.maxHp, target.hp + healing);
    if (data.acGenerationMultiplier) {
      const multiplier = 1 + (data.acGenerationMultiplier - 1) * buffMultiplier;
      target.addEffect({
        id: `${data.id}-ac-generation`,
        type: 'ac-generation',
        multiplier,
        remainingTurns: data.duration,
      });
    }
    if (data.rangeMultiplier) {
      target.addEffect({
        id: `${data.id}-range`,
        type: 'attack-range',
        multiplier: data.rangeMultiplier,
        remainingTurns: data.duration,
      });
      target.updateFocus(this.board.enemyTargets(target.team));
    }
    if (data.defenseArmor || data.defenseMagicResist) {
      target.addEffect({
        id: `${data.id}-defense`,
        type: 'defense',
        armor: (data.defenseArmor || 0) * buffMultiplier,
        magicResist: (data.defenseMagicResist || 0) * buffMultiplier,
        remainingTurns: data.duration,
      });
    }
    const shieldAmount =
      (data.shieldAmount || scaleDamage(caster.stats, data.shieldScaling || {})) * buffMultiplier;
    if (shieldAmount > 0) {
      target.addEffect({
        id: `${data.id}-shield`,
        type: data.momentumShield ? 'momentum-shield' : 'shield',
        remainingAmount: shieldAmount,
        remainingTurns: data.duration,
        momentumX: 0,
        momentumY: 0,
        momentumRadius: data.momentumRadius,
        momentumDamagePerUnit: data.momentumDamagePerUnit,
        maxSpeedBonus: data.maxMomentumSpeedBonus,
        maxSpeedMomentum: data.maxMomentumSpeedDistance,
      });
    }
    if (data.damageTakenToShield) {
      target.addEffect({
        id: `${data.id}-damage-to-shield`,
        type: 'damage-to-shield',
        multiplier: data.damageTakenToShield * buffMultiplier,
        triggerRadius: data.shieldTriggerRadius,
        remainingTurns: data.duration,
      });
    }
    if (data.reflectMultiplier) {
      target.addEffect({
        id: `${data.id}-reflection`,
        type: 'damage-reflect',
        multiplier: data.reflectMultiplier * buffMultiplier,
        radius: data.reflectRadius,
        remainingTurns: data.duration,
      });
    }
    if (data.silence && target.stats) {
      target.addEffect({
        id: `${data.id}-silence`,
        type: 'silence',
        remainingTurns: data.duration,
      });
    }
    if (data.knockback && target.stats) this.knockbackTarget(caster, target, data.knockback);
    if (data.damage || data.damageFraction || data.targetMaxHpFraction || data.scaling)
      return this.damageWithAbility(data, caster, target);
  }
  teleportDestination(caster, target) {
    const positions = [{ x: target.x, y: target.y }];
    for (const distance of [42, 56, 70]) {
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8;
        positions.push({
          x: target.x + Math.cos(angle) * distance,
          y: target.y + Math.sin(angle) * distance,
        });
      }
    }
    return (
      positions.find(
        (position) =>
          position.x >= 0 &&
          position.x <= this.board.width &&
          position.y >= 0 &&
          position.y <= this.board.height &&
          !this.isBlockedByTroop(
            position.x,
            position.y,
            20,
            caster,
            caster.stats.movementType || 'ground',
          ),
      ) || null
    );
  }
  damageWithAbility(data, caster, target) {
    const type = data.damageType || 'physical';
    const hpFractionDamage = Math.round(
      (target.maxHp || 0) * ((data.damageFraction || 0) + (data.targetMaxHpFraction || 0)),
    );
    const raw = Math.round(
      (data.damage || 0) + scaleDamage(caster.stats, data.scaling || {}) + hpFractionDamage,
    );
    const resistance =
      type === 'magic'
        ? (target.magicResist ?? target.stats?.magicResist ?? 0)
        : (target.armor ?? target.stats?.armor ?? 0);
    const armorPen = type === 'physical' ? caster.stats.flatArmorPen || 0 : 0;
    const percentPen = type === 'magic' ? caster.magicPenPercent : caster.stats.percentPen || 0;
    const damageMultiplier = !target.stats
      ? (caster.stats.structureDamageMultiplier ?? 1) *
        (data.id === 'kaguya_sky_bomb' ? 0.35 : data.id === 'kaguya_shield_ricochet' ? 0.4 : 0.5)
      : 1;
    const mitigatedDamage =
      applyResistance(raw, resistance, type, armorPen, percentPen) * damageMultiplier;
    const dealt = this.applyDamage(target, mitigatedDamage, caster, {
      ranged: ['area', 'direction', 'unit'].includes(data.targeting),
    });
    if (data.applyRookieMark) this.applyRookieMark(caster, target);
    return dealt;
  }
  directionalAbilityTargets(data, caster, x, y) {
    let dx = x - caster.x;
    let dy = y - caster.y;
    const aimDistance = Math.hypot(dx, dy);
    if (data.range && aimDistance > data.range) {
      dx = (dx / aimDistance) * data.range;
      dy = (dy / aimDistance) * data.range;
    }
    const lengthSquared = dx * dx + dy * dy;
    const candidates =
      data.targetTeam === 'ally'
        ? this.board.troops
        : hasDirectAbilityDamage(data)
          ? [...this.board.troops, ...this.board.turrets, ...this.board.towers]
          : this.board.troops;
    const hits = candidates
      .filter((target) => {
        if (target.hp <= 0 || target.burrowed) return false;
        if (data.targetTeam === 'ally') return target.team === caster.team && target !== caster;
        if (data.targetTeam === 'enemy') return target.team !== caster.team;
        return target.team !== caster.team;
      })
      .map((target) => {
        const projection =
          ((target.x - caster.x) * dx + (target.y - caster.y) * dy) / lengthSquared;
        const nearestX = caster.x + projection * dx;
        const nearestY = caster.y + projection * dy;
        return {
          target,
          projection,
          distance: Math.hypot(target.x - nearestX, target.y - nearestY),
        };
      })
      .filter((hit) => {
        if (data.arcAngle) {
          const targetDistance = Math.hypot(hit.target.x - caster.x, hit.target.y - caster.y);
          const centerAngle = Math.atan2(dy, dx);
          const targetAngle = Math.atan2(hit.target.y - caster.y, hit.target.x - caster.x);
          const difference = Math.atan2(
            Math.sin(targetAngle - centerAngle),
            Math.cos(targetAngle - centerAngle),
          );
          return (
            targetDistance <= data.range && Math.abs(difference) <= (data.arcAngle * Math.PI) / 360
          );
        }
        return hit.projection >= 0 && hit.projection <= 1 && hit.distance <= (data.lineWidth || 24);
      })
      .sort((a, b) => a.projection - b.projection);
    const targets = data.hitMode === 'first' ? hits.slice(0, 1) : hits;
    return targets.map((hit) => hit.target);
  }
  applyDirectionalAbility(data, caster, targets, x, y) {
    if (!targets.length && data.id !== 'kaguya_shield_ricochet') return;
    if (
      (data.damage || data.damageFraction || data.targetMaxHpFraction || data.scaling) &&
      data.arcAngle
    ) {
      this.showDamageArea({
        kind: 'arc',
        x: caster.x,
        y: caster.y,
        angle: Math.atan2(y - caster.y, x - caster.x),
        range: data.range,
        arcAngle: data.arcAngle,
        team: caster.team,
      });
    }
    const chain = targets.length ? [targets[0]] : [];
    while (chain.length && chain.length < (data.ricochetCount || 0) + 1) {
      const previous = chain[chain.length - 1];
      const next = this.board
        .enemyTargets(caster.team)
        .filter(
          (enemy) =>
            !enemy.burrowed &&
            enemy.hp > 0 &&
            !chain.includes(enemy) &&
            Math.hypot(previous.x - enemy.x, previous.y - enemy.y) <= data.ricochetRange,
        )
        .sort(
          (a, b) =>
            Math.hypot(previous.x - a.x, previous.y - a.y) -
            Math.hypot(previous.x - b.x, previous.y - b.y),
        )[0];
      if (!next) break;
      chain.push(next);
    }
    if (data.id === 'kaguya_shield_ricochet') {
      const points = [{ x: caster.x, y: caster.y }, ...chain.map(({ x, y }) => ({ x, y }))];
      if (!chain.length) {
        let dx = x - caster.x;
        let dy = y - caster.y;
        const length = Math.hypot(dx, dy) || 1;
        const scale = Math.min(length, data.range) / length;
        points.push({ x: caster.x + dx * scale, y: caster.y + dy * scale });
      }
      this.board.areaEffects.push({
        kind: 'ricochet-path',
        points,
        team: caster.team,
        duration: 0.85,
        remainingSeconds: 0.85,
      });
    }
    for (const target of chain) {
      const damage = this.applyAbilityToTarget(data, caster, target) || 0;
      if (
        data.bleedFraction &&
        target.stats &&
        !this.board.turrets.includes(target) &&
        !this.board.towers.includes(target)
      ) {
        target.addEffect({
          id: `${data.id}-bleed-${caster.team}`,
          type: 'bleed',
          intensity: Math.max(1, Math.round(damage * data.bleedFraction)),
          remainingTurns: data.duration,
        });
      }
    }
  }
  knockbackTarget(caster, target, distance) {
    const dx = target.x - caster.x;
    const dy = target.y - caster.y;
    const length = Math.hypot(dx, dy) || 1;
    const direction =
      length === 1 && dx === 0 && dy === 0
        ? { x: Math.cos(caster.facing), y: Math.sin(caster.facing) }
        : { x: dx / length, y: dy / length };
    let low = 0;
    let high = distance;
    let destination = { x: target.x, y: target.y };
    for (let i = 0; i < 14; i++) {
      const mid = (low + high) / 2;
      const candidate = {
        x: Math.max(0, Math.min(this.board.width, target.x + direction.x * mid)),
        y: Math.max(0, Math.min(this.board.height, target.y + direction.y * mid)),
      };
      if (this.canMoveSegment(target, candidate, target)) {
        low = mid;
        destination = candidate;
      } else high = mid;
    }
    if (low > 1) {
      target.waypoints = [];
      target.knockbackWaypoints = [destination];
      target.facing = Math.atan2(direction.y, direction.x);
    }
  }
  findPath(unit, target, stopWithinAttackRange = false, deadline = monotonicNow() + PATHFINDING_BUDGET_MS) {
    if (!target) return [];
    const timedOut = () => deadline !== Infinity && monotonicNow() >= deadline;
    if (timedOut()) return [];
    const step = 20,
      cols = Math.ceil(this.board.width / step),
      rows = Math.ceil(this.board.height / step);
    const key = (x, y) => `${x},${y}`;
    const ignoredTroops = [unit];
    if (this.board.troops.includes(target)) ignoredTroops.push(target);
    const start = {
      x: Math.max(0, Math.min(cols - 1, Math.round(unit.x / step))),
      y: Math.max(0, Math.min(rows - 1, Math.round(unit.y / step))),
    };
    const cellIndex = (x, y) => y * cols + x;
    const passable = new Uint8Array(cols * rows);
    const movementType = unit.stats.movementType || 'ground';
    for (let y = 0; y < rows; y++) {
      if (timedOut()) return [];
      for (let x = 0; x < cols; x++) {
        const worldX = x * step;
        const worldY = y * step;
        if (
          worldX >= unit.collisionRadius && worldX <= this.board.width - unit.collisionRadius &&
          worldY >= unit.collisionRadius && worldY <= this.board.height - unit.collisionRadius &&
          !this.isBlockedByTerrain(worldX, worldY, unit.collisionRadius, movementType)
        ) passable[cellIndex(x, y)] = 1;
      }
    }
    passable[cellIndex(start.x, start.y)] = 1;
    const segmentCache = new Map();
    const segmentClear = (from, to) => {
      const fromIndex = cellIndex(from.x / step, from.y / step);
      const toIndex = cellIndex(to.x / step, to.y / step);
      const cacheKey = fromIndex < toIndex ? `${fromIndex}:${toIndex}` : `${toIndex}:${fromIndex}`;
      if (!segmentCache.has(cacheKey))
        segmentCache.set(cacheKey, this.isPathSegmentClear(from, to, unit, ignoredTroops));
      return segmentCache.get(cacheKey);
    };
    const structureRadius = target.type === 'base' ? 46 : target.layer ? 37 : 0;
    const approachDistance =
      structureRadius > 0
        ? stopWithinAttackRange
          ? structureRadius + Math.max(2, unit.attackRange - 4)
          : Math.max(structureRadius + 2, unit.sightRange - 4)
        : stopWithinAttackRange
          ? unit.attackRange + (target.collisionRadius || 14) - 1
          : Math.max(2, unit.sightRange - 4);
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    const startKey = key(start.x, start.y);
    const cameFrom = new Map([[startKey, null]]);
    const gScore = new Map([[startKey, 0]]);
    const open = [];
    const push = (entry) => {
      open.push(entry);
      let index = open.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (open[parent].f <= entry.f) break;
        open[index] = open[parent];
        index = parent;
      }
      open[index] = entry;
    };
    const pop = () => {
      const first = open[0];
      const last = open.pop();
      if (open.length) {
        let index = 0;
        while (true) {
          const left = index * 2 + 1;
          const right = left + 1;
          if (left >= open.length) break;
          const child = right < open.length && open[right].f < open[left].f ? right : left;
          if (open[child].f >= last.f) break;
          open[index] = open[child];
          index = child;
        }
        open[index] = last;
      }
      return first;
    };
    const heuristic = (x, y) => {
      const distance = Math.hypot(target.x - x * step, target.y - y * step);
      return Math.max(0, distance - approachDistance) / step;
    };
    push({ ...start, key: startKey, g: 0, f: heuristic(start.x, start.y) });
    let found = null;
    while (open.length) {
      if (timedOut()) return [];
      const current = pop();
      if (current.g !== gScore.get(current.key)) continue;
      const reachedGoal =
        Math.hypot(target.x - current.x * step, target.y - current.y * step) <= approachDistance;
      if (reachedGoal) {
        found = current;
        break;
      }
      for (const [dx, dy] of directions) {
        if (timedOut()) return [];
        const nx = current.x + dx,
          ny = current.y + dy,
          nextKey = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!passable[cellIndex(nx, ny)]) continue;
        if (dx && dy &&
          (!passable[cellIndex(current.x + dx, current.y)] ||
            !passable[cellIndex(current.x, current.y + dy)])) continue;
        const wx = nx * step,
          wy = ny * step,
          currentPoint = { x: current.x * step, y: current.y * step },
          nextPoint = { x: wx, y: wy };
        if (!segmentClear(currentPoint, nextPoint)) continue;
        const nextG = current.g + Math.hypot(dx, dy);
        if (nextG >= (gScore.get(nextKey) ?? Infinity)) continue;
        gScore.set(nextKey, nextG);
        cameFrom.set(nextKey, current);
        push({ x: nx, y: ny, key: nextKey, g: nextG, f: nextG + heuristic(nx, ny) });
      }
    }
    if (!found) return [];
    const gridPath = [];
    let cursor = found;
    while (cursor) {
      gridPath.push({ x: cursor.x * step, y: cursor.y * step });
      cursor = cameFrom.get(cursor.key);
    }
    gridPath.reverse();
    gridPath[0] = { x: unit.x, y: unit.y };

    const smoothed = [gridPath[0]];
    let anchor = 0;
    while (anchor < gridPath.length - 1) {
      if (timedOut()) return [];
      let next = gridPath.length - 1;
      while (
        next > anchor + 1 &&
        !this.isPathSegmentClear(gridPath[anchor], gridPath[next], unit, ignoredTroops)
      ) {
        if (timedOut()) return [];
        next -= 1;
      }
      smoothed.push(gridPath[next]);
      anchor = next;
    }
    return smoothed;
  }
  isPathSegmentClear(from, to, unit, ignoredTroops = [unit]) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / 5));
    const movementType = unit.stats.movementType || 'ground';
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      if (this.isBlockedByTerrain(x, y, unit.collisionRadius, movementType)) return false;
    }
    return true;
  }
  moveAutomatically(unit, target, stopWhenInAttackRange, enemies, deadline = monotonicNow() + PATHFINDING_BUDGET_MS) {
    if (!target || target.hp <= 0 || unit.stunned) return [];
    const path = this.findPath(unit, target, stopWhenInAttackRange, deadline);
    const waypoints = [];
    for (let i = 1; i < path.length && unit.availableMovement > 0.5; i++) {
      let candidate = path[i];
      const dx = candidate.x - unit.x,
        dy = candidate.y - unit.y,
        distance = Math.hypot(dx, dy);
      if (distance > unit.availableMovement)
        candidate = {
          x: unit.x + (dx / distance) * unit.availableMovement,
          y: unit.y + (dy / distance) * unit.availableMovement,
        };
      const ignoredOnPath = this.board.troops.includes(target) ? [unit, target] : [unit];
      if (
        !this.isPathSegmentClear({ x: unit.x, y: unit.y }, candidate, unit, ignoredOnPath) ||
        this.isBlockedByTerrain(
          candidate.x,
          candidate.y,
          unit.collisionRadius,
          unit.stats.movementType || 'ground',
        )
      )
        break;
      unit.validateFocus(enemies);
      if (unit.focus) {
        const structureRadius = unit.focus.type === 'base' ? 46 : unit.focus.layer ? 37 : 0;
        const oldDistance = unit.attackDistanceTo(unit.focus);
        const targetRadius = structureRadius || unit.focus.collisionRadius || 14;
        const newDistance = Math.max(
          0,
          Math.hypot(candidate.x - unit.focus.x, candidate.y - unit.focus.y) - targetRadius,
        );
        if (
          newDistance > unit.sightRange ||
          (newDistance > unit.attackRange && newDistance > oldDistance)
        )
          break;
      }
      const moved = Math.hypot(candidate.x - unit.x, candidate.y - unit.y);
      unit.x = candidate.x;
      unit.y = candidate.y;
      unit.movementRemaining -= moved / unit.movementSpeedMultiplier;
      waypoints.push({ x: candidate.x, y: candidate.y });
      unit.updateFocus(enemies);
      const isArenaStructure = target.type === 'base' || Boolean(target.layer);
      if (!isArenaStructure && !unit.eligibleTargets(enemies).includes(target)) break;
      if (stopWhenInAttackRange && unit.attackDistanceTo(target) <= unit.attackRange) break;
      if (!stopWhenInAttackRange) {
        const visibleEnemy = unit
          .eligibleTargets(enemies)
          .some((enemy) => enemy.hp > 0 && unit.distanceTo(enemy) <= unit.sightRange);
        if (visibleEnemy) break;
      }
    }

    if (
      stopWhenInAttackRange &&
      unit.attackDistanceTo(target) > unit.attackRange &&
      unit.availableMovement > 0.5
    ) {
      const dx = target.x - unit.x;
      const dy = target.y - unit.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1) {
        const structureRadius = target.type === 'base' ? 46 : target.layer ? 37 : 0;
        const desiredDist =
          structureRadius > 0
            ? structureRadius + Math.max(2, unit.attackRange - 4)
            : Math.max(2, unit.attackRange + (target.collisionRadius || 14) - 1);
        if (dist > desiredDist) {
          const maxMove = Math.min(dist - desiredDist, unit.availableMovement);
          const dir = { x: dx / dist, y: dy / dist };
          let low = 0;
          let high = maxMove;
          let best = null;
          for (let s = 0; s < 12; s++) {
            const mid = (low + high) / 2;
            const testPt = { x: unit.x + dir.x * mid, y: unit.y + dir.y * mid };
            if (this.canMoveSegment(unit, testPt, unit)) {
              low = mid;
              best = testPt;
            } else {
              high = mid;
            }
          }
          if (best && low > 0.5) {
            unit.movementRemaining -= low / unit.movementSpeedMultiplier;
            unit.x = best.x;
            unit.y = best.y;
            waypoints.push({ x: best.x, y: best.y });
          }
        }
      }
    }

    return waypoints;
  }
  executeBeginningMovement(player) {
    this.beginningMovementQueue = player.units.map((unit) => ({ unit, attempts: 0 }));
    this.startNextBeginningMovement();
  }
  startNextBeginningMovement() {
    if (!this.beginningMovementQueue || this.board.troops.some((troop) => troop.isMoving())) return;
    while (this.beginningMovementQueue.length) {
      const entry = this.beginningMovementQueue.shift();
      const unit = entry.unit;
      if (!unit || unit.hp <= 0 || unit.burrowed || unit.stats.isBuilding || unit.isMoving()) continue;
      entry.attempts += 1;
      const deadline = monotonicNow() + PATHFINDING_BUDGET_MS;
      const startX = unit.x;
      const startY = unit.y;
      const startMovementRemaining = unit.movementRemaining;
      const startFocus = unit.focus;
      const startFacing = unit.facing;
      const startDetonateOnArrival = unit.detonateOnArrival;
      let waypoints = [];
      if (unit.isDrone) {
        const droneMove = this.planDroneMovement(unit);
        if (droneMove) waypoints = droneMove.waypoints;
      } else if (!unit.stunned && unit.stats.targetPreference === 'allies') {
        const allies = this.targetsFor(unit);
        unit.validateFocus(allies);
        if (!unit.focus) unit.updateFocus(allies);
        if (!unit.focus) {
          const visibleAllies = unit.eligibleTargets(allies)
            .filter((ally) => ally.hp > 0 && unit.distanceTo(ally) <= unit.sightRange)
            .sort((a, b) => unit.distanceTo(a) - unit.distanceTo(b));
          if (visibleAllies.length) {
            waypoints = this.moveAutomatically(unit, visibleAllies[0], true, allies, deadline);
          } else {
            const enemyTurrets = this.board.turrets
              .filter((turret) => turret.team !== unit.team && turret.hp > 0)
              .sort((a, b) => unit.distanceTo(a) - unit.distanceTo(b));
            const target = enemyTurrets[0] || this.board.towers
              .filter((tower) => tower.team !== unit.team && tower.hp > 0)
              .sort((a, b) => unit.distanceTo(a) - unit.distanceTo(b))[0];
            waypoints = this.moveAutomatically(unit, target, false, allies, deadline);
          }
        }
      } else if (!unit.stunned) {
        const enemies = this.board.enemyTargets(unit.team);
        unit.validateFocus(enemies);
        if (!unit.focus) {
          let visible = unit.eligibleTargets(enemies)
            .filter((enemy) => enemy.hp > 0 && unit.distanceTo(enemy) <= unit.sightRange)
            .sort((a, b) => unit.distanceTo(a) - unit.distanceTo(b));
          if (!visible.length) {
            const enemyTurrets = this.board.turrets
              .filter((turret) => turret.team !== unit.team && turret.hp > 0)
              .sort((a, b) => unit.distanceTo(a) - unit.distanceTo(b));
            const target = enemyTurrets[0] || this.board.towers.find(
              (tower) => tower.team !== unit.team && tower.hp > 0,
            );
            waypoints = waypoints.concat(this.moveAutomatically(unit, target, false, enemies, deadline));
            visible = unit.eligibleTargets(enemies)
              .filter((enemy) => enemy.hp > 0 && unit.distanceTo(enemy) <= unit.sightRange)
              .sort((a, b) => unit.distanceTo(a) - unit.distanceTo(b));
          }
          const hasAttackTarget = unit.eligibleTargets(enemies).some(
            (enemy) => enemy.hp > 0 && unit.attackDistanceTo(enemy) <= unit.attackRange,
          );
          if (!unit.focus && visible.length && !hasAttackTarget)
            waypoints = waypoints.concat(this.moveAutomatically(unit, visible[0], true, enemies, deadline));
          unit.updateFocus(enemies);
        }
        if (unit.focus && unit.attackDistanceTo(unit.focus) > unit.attackRange)
          waypoints = waypoints.concat(this.moveAutomatically(unit, unit.focus, true, enemies, deadline));
      }
      unit.x = startX;
      unit.y = startY;
      if (monotonicNow() > deadline) {
        unit.movementRemaining = startMovementRemaining;
        unit.focus = startFocus;
        unit.facing = startFacing;
        unit.detonateOnArrival = startDetonateOnArrival;
        if (entry.attempts < 3) this.beginningMovementQueue.push(entry);
        if (!this.beginningMovementQueue.length) this.beginningMovementQueue = null;
        return;
      }
      if (waypoints.length) {
        unit.waypoints = waypoints;
        return;
      }
      if (entry.attempts < 3) this.beginningMovementQueue.push(entry);
      if (!this.beginningMovementQueue.length) this.beginningMovementQueue = null;
      return;
    }
    this.beginningMovementQueue = null;
  }
  isOnBridge(x, y) {
    return this.board.bridges.some(
      (bridge) =>
        x >= bridge.x && x <= bridge.x + bridge.w && y >= bridge.y && y <= bridge.y + bridge.h,
    );
  }
  isInsideEnemyInhibitionRange(team, x, y) {
    const structures = [...this.board.turrets, ...this.board.towers];
    return structures.some(
      (structure) =>
        structure.team !== team &&
        structure.hp > 0 &&
        Math.hypot(structure.x - x, structure.y - y) <= structure.range * 1.3,
    );
  }
}
