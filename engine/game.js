import { cast, applyAbilityArea, applyAbilityToTarget, teleportDestination, damageWithAbility, directionalAbilityTargets, applyDirectionalAbility, knockbackTarget } from './ability_system.js';
import { findPath, isPathSegmentClear, resolveDeploymentPushes, resolveMovementCollisions, canMoveSegment, moveAutomatically } from './movement.js';
import { TROOPS } from '../data/troops.js';
import { ABILITIES } from '../data/abilities.js';
import { collisionRadiusOf, edgeDistanceBetween, RADIUS_PER_SIZE, TroopStats } from '../units/stats.js';
import { Troop, aggroAdjustedDistance } from '../units/troop.js';
import { TroopCard } from '../cards/troop_card.js';
import { AbilityCard } from '../cards/ability_card.js';
import { Deck } from '../cards/deck.js';
import { Hand } from '../cards/hand.js';
import { Board } from './board.js';
import { TurnManager } from './turn_manager.js';
import { Draft } from './draft.js';
import { CombatHistory } from './combat_history.js';
import { loadHeroBehavior } from '../heroes/registry.js';
import { applyResistance, scaleDamage } from '../units/damage.js';
import { GAME_PARAMS } from '../data/game_parameters.js';


export class Player {
  constructor(team) {
    this.team = team;
    this.elixir = GAME_PARAMS.economy.startingElixir;
    this.ap = GAME_PARAMS.economy.startingAP;
    this.heroDeck = new Deck([]);
    this.abilityDeck = new Deck([]);
    this.heroHand = new Hand(this.heroDeck, GAME_PARAMS.hands.heroCards);
    this.abilityHand = new Hand(this.abilityDeck, GAME_PARAMS.hands.abilityCards);
    this.units = [];
  }
  generate() {
    this.elixir = Math.min(GAME_PARAMS.economy.maxElixir, this.elixir + GAME_PARAMS.economy.elixirPerTurn);
    this.ap = Math.min(GAME_PARAMS.economy.maxAP, this.ap + GAME_PARAMS.economy.APPerTurn);
  }
}

export class Game {
  constructor() {
    this.stats = Object.fromEntries(TROOPS.map((t) => [t.id, new TroopStats(t)]));
    this.abilities = Object.fromEntries(ABILITIES.map((a) => [a.id, a]));
    this.players = [new Player(0), new Player(1)];
    this.phase = 'menu';
    this.draft = new Draft(TROOPS.map((hero) => hero.id), {
      onPick: (team, heroId) => this.addDraftedHero(team, heroId),
      onComplete: () => this.finishHeroSetup('Draft complete. Blue takes the first turn.'),
    });
    this.board = new Board();
    this.board.game = this;
    this.turns = new TurnManager();
    this.score = [0, 0];
    this.winner = null;
    this.scoredTurrets = new Set();
    this.squadCounter = 1;
    this.shakeTimer = 0;
    this.events = [];
    this.message = 'Blue: deploy or act';
    this.beginningMovementQueue = null;
    this.history = new CombatHistory();
    this.damageNumbers = [];
    this.movementDiagnostics = [];
    this.meleeAttackAnimationIndex = 0;
    this.heroBehaviors = new Map();
    this.heroLoads = new Map();
    this.loadingProgress = { loaded: 0, total: 0 };
  }
  teamName(team) {
    return team === 0 ? 'Blue' : 'Red';
  }
  startDraft() {
    if (this.phase !== 'menu') return false;
    this.phase = 'draft';
    return true;
  }
  startRandomMatch(random = Math.random) {
    if (this.phase !== 'menu') return false;
    const pool = TROOPS.map((hero) => hero.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const teamSize = GAME_PARAMS.teamSize;
    const selected = pool.slice(0, teamSize * 2);
    for (let team = 0; team < 2; team++)
      for (const heroId of selected.slice(team * teamSize, (team + 1) * teamSize))
        this.addDraftedHero(team, heroId);
    this.phase = 'loading';
    this.finishHeroSetup('All Random match ready. Blue takes the first turn.');
    return true;
  }
  finishHeroSetup(message) {
    this.phase = 'loading';
    const loadingStartedAt = Date.now();
    const loads = [...this.heroLoads.values()];
    this.loadingProgress = { loaded: 0, total: loads.length };
    const trackedLoads = loads.map((load) => load.then(
      (value) => { this.loadingProgress.loaded += 1; return value; },
      (error) => { this.loadingProgress.loaded += 1; throw error; },
    ));
    Promise.allSettled(trackedLoads).then(async (results) => {
      const minimumLoadingMs = 450;
      const remainingLoadingMs = minimumLoadingMs - (Date.now() - loadingStartedAt);
      if (remainingLoadingMs > 0)
        await new Promise((resolve) => setTimeout(resolve, remainingLoadingMs));
      const failures = results.filter((result) => result.status === 'rejected');
      for (const player of this.players) {
        player.heroDeck.shuffle();
        player.abilityDeck.shuffle();
        player.heroHand.fill();
        player.abilityHand.fill();
      }
      this.phase = 'battle';
      this.turns.currentTeam = 0;
      if (failures.length) {
        console.error('Failed to load selected hero behavior modules:', failures.map((result) => result.reason));
        this.addEvent(`${failures.length} hero behavior module(s) failed to load; the match will continue with generic behavior.`, null);
      } else this.addEvent(message, 0);
    });
  }
  surrender(team = this.turns.currentTeam) {
    if (this.phase !== 'battle' || this.winner !== null) return false;
    this.winner = 1 - team;
    this.addEvent(`${this.teamName(team)} surrendered. ${this.teamName(this.winner)} wins.`, team);
    return true;
  }
  addEvent(message, team = null) {
    this.message = message;
    this.events.push({ message, team });
  }
  addTroop(troop, { resolve = true } = {}) {
    this.board.addTroop(troop);
    const player = this.players[troop.team];
    if (player && !player.units.includes(troop)) player.units.push(troop);
    if (resolve) this.resolveDeploymentPushes([troop]);
    return troop;
  }
  addDraftedHero(team, heroId) {
    const player = this.players[team];
    const stats = this.stats[heroId];
    if (!player || !stats) return;
    player.heroDeck.cards.push(new TroopCard(stats));
    for (const ability of Object.values(this.abilities).filter((item) => item.troop === heroId))
      player.abilityDeck.cards.push(new AbilityCard(ability));
    this.loadDraftedHeroBehavior(heroId);
    this.addEvent(`${this.teamName(team)} drafted ${stats.name}.`, team);
  }
  loadDraftedHeroBehavior(heroId) {
    if (this.heroLoads.has(heroId)) return this.heroLoads.get(heroId);
    const loading = loadHeroBehavior(heroId).then((behavior) => {
      this.heroBehaviors.set(heroId, behavior);
      return behavior;
    });
    this.heroLoads.set(heroId, loading);
    return loading;
  }
  applyHeroHook(troop, hook, ...args) {
    let owner = troop;
    while (owner && !this.heroBehaviors.has(owner.stats?.id) && !this.heroLoads.has(owner.stats?.id))
      owner = owner.summonedBy;
    const heroId = owner?.stats?.id || troop?.stats?.id;
    const behavior = this.heroBehaviors.get(heroId);
    if (behavior) return behavior[hook]?.(this, troop, ...args);
    return this.heroLoads.get(heroId)?.then((loaded) => loaded[hook]?.(this, troop, ...args));
  }
  recordDamageNumber(target, amount, damageType, shield, intensity = 1) {
    const displayedDamage = Math.round(amount);
    if (displayedDamage <= 0 || !Number.isFinite(target?.x) || !Number.isFinite(target?.y)) return;
    this.damageNumbers.push({
      x: target.x,
      y: target.y - (target.radius || target.collisionRadius || RADIUS_PER_SIZE),
      amount: displayedDamage,
      damageType,
      shield,
      intensity: Number.isFinite(intensity) ? Math.max(0.12, Math.min(1, intensity)) : 1,
      createdAt: Date.now(),
      direction: Math.random() < 0.5 ? -1 : 1,
    });
    if (this.damageNumbers.length > 80) this.damageNumbers.splice(0, this.damageNumbers.length - 80);
  }
  notifyHeroHooks(hook, ...args) {
    return this.board.troops
      .filter((troop) => this.stats[troop.stats?.id])
      .map((troop) => this.applyHeroHook(troop, hook, ...args));
  }
  activeHeroes() {
    return this.board.troops.filter((troop) => this.stats[troop.stats?.id]);
  }
  chooseDraftHero(heroId) {
    return this.phase === 'draft' && this.draft.choose(heroId);
  }
  historyOf(unit) { return this.history.ensure(unit); }
  mostDamageDealer(unit) { return this.history.mostDamageDealer(unit); }
  alliesAttackedNear(unit, radius, sinceEventId = 0) {
    return this.history.allyAttackedWithin(unit, radius, sinceEventId);
  }
  matchSummary(team = null) { return this.history.summary(team); }
  recordMovementDiagnostic(type, unit = null, details = {}) {
    this.movementDiagnostics.push({
      type,
      unit: unit?.stats?.name || unit?.stats?.id || 'unknown',
      team: unit?.team ?? null,
      turn: this.turns?.number ?? null,
      timestamp: new Date().toISOString(),
      ...details,
    });
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
        Math.hypot(building.x - x, building.y - y) <
          (building.radius || building.collisionRadius || RADIUS_PER_SIZE) + troop.collisionRadius,
    );
    return (
      !onBuilding &&
      this.board.grassPatches.some(
        (patch) =>
          patch.team === troop.team &&
          patch.remainingTurns > 0 &&
          Math.hypot(patch.x - x, patch.y - y) <= patch.radius + troop.collisionRadius,
      )
    );
  }
  allyBonusMultiplier(troop) {
    return this.isOnGrass(troop) ? 1.4 : 1;
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
  modifyIncomingDamage(target, amount, source, context) {
    const state = { target, amount, modifiers: [] };
    for (const hero of this.activeHeroes()) {
      const result = this.applyHeroHook(hero, 'modifyIncomingDamage', state.target, state.amount, source, context);
      if (!result?.handled) continue;
      state.target = result.target;
      state.amount = result.amount;
      state.modifiers.push(result.owner || hero);
    }
    return state;
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
    const incomingAmount = Math.max(0, amount || 0);
    const ranged = !flags.ignoreRanged && Boolean(flags.ranged);
    const damageResult = this.modifyIncomingDamage(target, amount, source, { ranged, flags });
    target = damageResult.target;
    amount = damageResult.amount;
    if (!flags.skipDamageMitigationHooks && ranged) {
      for (const hero of damageResult.modifiers)
        this.applyHeroHook(hero, 'onDamageMitigated', amount, source);
    }
    let externalShieldAbsorbed = 0;
    if (source && target?.stats) {
      for (const domeOwner of this.board.troops) {
        if (domeOwner.hp <= 0 || domeOwner.team !== target.team) continue;
        const dome = domeOwner.effects.find(
          (effect) => effect.type === 'protective-dome' && effect.remainingAmount > 0,
        );
        if (!dome || edgeDistanceBetween(domeOwner, target) > dome.radius)
          continue;
        const sourceRange = flags.ranged ? Infinity : (source.stats?.range ?? source.range ?? 0);
        if (
          source.team === target.team ||
          sourceRange < 80 ||
          edgeDistanceBetween(domeOwner, source) <= dome.radius
        )
          continue;
        const absorbed = Math.min(amount, dome.remainingAmount);
        dome.remainingAmount -= absorbed;
        amount -= absorbed;
        externalShieldAbsorbed += absorbed;
        if (amount <= 0) {
          const damageType = flags.damageType || source?.stats?.basicAttack?.damageType || 'physical';
          this.recordDamageNumber(target, externalShieldAbsorbed, damageType, true, flags.mitigationRatio);
          this.history.damage(source, target, 0, incomingAmount, target.hp);
          return 0;
        }
      }
    }
    const healthBefore = Math.max(0, target.hp);
    const barHpBefore = Math.max(target.damageBarHp ?? healthBefore, healthBefore);
    const effectsBeforeDamage = [...(target.effects || [])];
    const healthDamageTaken = target.takeDamage ? target.takeDamage(amount) : amount;
    if (!target.takeDamage) target.hp -= amount;
    for (const effect of effectsBeforeDamage) {
      if (target.effects?.includes(effect)) continue;
      this.applyHeroHook(effect.sourceUnit || target, 'onEffectDepleted', target, effect);
    }
    const healthDamage = Math.min(healthBefore, Math.max(0, healthBefore - target.hp));
    const shieldDamage = externalShieldAbsorbed + Math.max(0, amount - healthDamageTaken);
    if (healthDamage > 0) {
      target.damageBarHp = barHpBefore;
      target.damageBarUntil = Date.now() + 2200;
    }
    const attackType = flags.damageType || source?.stats?.basicAttack?.damageType || 'physical';
    this.recordDamageNumber(target, healthDamage + shieldDamage, attackType, shieldDamage > 0, flags.mitigationRatio);
    if (healthDamage > 0) this.applyHeroHook(target, 'onDamaged', healthDamage);
    if (healthDamage > 0)
      this.notifyHeroHooks('onHealthDamage', target, source, healthDamage, flags);
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
        skipDamageMitigationHooks: true,
        ignoreRanged: true,
        damageType: 'magic',
        mitigationRatio: raw > 0 ? Math.max(0, Math.min(1, fragileDamage / raw)) : 1,
      });
    }
    this.history.damage(source, target, healthDamage, Math.max(0, incomingAmount - healthDamage), healthBefore);
    return healthDamage;
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
    if (this.phase === 'menu' || this.phase === 'loading') return;
    if (this.phase === 'draft') {
      this.draft.tick(dt);
      return;
    }
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    for (const animation of this.board.attackAnimations) animation.elapsed += dt;
    this.board.attackAnimations = this.board.attackAnimations.filter(
      (animation) => animation.elapsed < animation.duration,
    );
    this.board.impacts = this.board.impacts
      .map((impact) => ({ ...impact, remainingSeconds: impact.remainingSeconds - dt }))
      .filter((impact) => impact.remainingSeconds > 0);
    this.board.areaEffects = this.board.areaEffects
      .map((effect) => ({ ...effect, remainingSeconds: effect.remainingSeconds - dt }))
      .filter((effect) => effect.remainingSeconds > 0);
    const moveStep = 280 * dt;
    const movedThisFrame = new Set();
    const movementStartPositions = new Map(
      this.board.troops.map((troop) => [troop, { x: troop.x, y: troop.y }]),
    );
    for (const troop of this.board.troops) {
      troop.tickTimedEffects(dt);
      if (this.applyHeroHook(troop, 'onFrameUpdate', moveStep) === true) {
        if (troop.isMoving() || troop.detonateOnArrival) movedThisFrame.add(troop);
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
    try {
      this.resolveMovementCollisions(movedThisFrame, movementStartPositions);
    } catch (error) {
      this.recordMovementDiagnostic('movement-collision-exception', null, { error: String(error?.stack || error) });
      console.error('Movement collision resolution failed:', error);
    }
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
              damageType: 'mixed',
              mitigationRatio: raw > 0 ? Math.max(0, Math.min(1, (physicalDamage + magicDamage) / (2 * raw))) : 1,
            });
          } else {
            projectile.to.hp -= physicalDamage + magicDamage;
          }
        } else if (projectile.abilityId) {
          const ability = this.abilities[projectile.abilityId];
          if (projectile.targetUnit) {
            if (projectile.targetUnit.hp > 0 && !projectile.targetUnit.burrowed)
              this.applyAbilityToTarget(ability, projectile.caster, projectile.targetUnit);
          } else if (ability?.fieldEffects?.length) {
            this.board.zones.push({
              abilityId: ability.id,
              caster: projectile.caster,
              team: projectile.caster.team,
              x: projectile.targetPoint.x,
              y: projectile.targetPoint.y,
              radius: ability.radius,
              remainingTurns: ability.duration,
              effects: ability.fieldEffects,
              visual: ability.fieldVisual,
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
  discardAbilities(resource, cards = null) {
    if (this.winner !== null) return false;
    const player = this.activePlayer();
    const enough = resource === 'elixir'
      ? player.elixir >= GAME_PARAMS.economy.redrawCost
      : player.ap >= GAME_PARAMS.economy.redrawCost;
    if (!enough) {
      this.message = 'Not enough resource';
      return false;
    }
    const count = cards
      ? player.abilityHand.discardSelected(cards, GAME_PARAMS.hands.redrawMax)
      : player.abilityHand.discardSelected(player.abilityHand.cards.slice(0, GAME_PARAMS.hands.redrawMax), GAME_PARAMS.hands.redrawMax);
    if (!count) {
      this.message = 'No skill cards selected';
      return false;
    }
    if (resource === 'elixir') player.elixir -= GAME_PARAMS.economy.redrawCost;
    else player.ap -= GAME_PARAMS.economy.redrawCost;
    const resourceName = resource === 'elixir' ? 'Elixir' : 'AP';
    this.message = `Discarded ${count} skill card${count === 1 ? '' : 's'} (-${GAME_PARAMS.economy.redrawCost} ${resourceName})`;
    return true;
  }
  deploy(card, x, y) {
    if (this.phase !== 'battle') return false;
    if (this.winner !== null) return false;
    const player = this.activePlayer();
    if (player.elixir < card.elixirCost) {
      this.message = 'Not enough Elixir';
      return false;
    }
    const stats = this.stats[card.troopId];
    const plan = this.getDeploymentPlan(card, x, y, player.team);
    if (!plan.valid) {
      this.message = plan.message;
      return false;
    }
    const positions = plan.positions;
    const squadSize = positions.length;
    const squadId = squadSize > 1 ? `${player.team}-${this.squadCounter++}` : null;
    const troops = positions.map((position) => {
      const troop = new Troop(stats, player.team, position.x, position.y);
      if (squadId) troop.squadId = squadId;
      return troop;
    });
    // A card deployment is one event even when it creates a multi-unit squad.
    this.history.deployment(troops[0]);
    player.elixir -= card.elixirCost;
    player.heroHand.play(card);
    for (const troop of troops) this.addTroop(troop, { resolve: false });
    this.resolveDeploymentPushes(troops);
    this.message =
      squadSize > 1
        ? `${stats.name} deployed (${squadSize} units)`
        : `${troops[0].stats.name} deployed`;
    return true;
  }
  collisionRadiusForStats(stats) {
    const size = stats.size ?? (stats.isDrone || stats.isMinion || stats.isSummon ? 0.5 : 1);
    return RADIUS_PER_SIZE * size;
  }
  findPlacementPosition(team, x, y, stats, occupied = [], respectInhibition = true) {
    const radius = this.collisionRadiusForStats(stats);
    const movementType = stats.movementType || 'ground';
    if (
      x < radius || x > this.board.width - radius ||
      y < radius || y > this.board.height - radius
    ) return null;
    const fixedTroops = this.board.troops
      .filter((troop) => troop.hp > 0 && !troop.burrowed && troop.stats.isBuilding &&
        (troop.stats.movementType || 'ground') === movementType)
      .map((troop) => ({ x: troop.x, y: troop.y, radius: troop.collisionRadius }));
    const blockers = [...occupied, ...fixedTroops];
    if (
      this.isBlockedByTerrain(x, y, radius, movementType) ||
      (respectInhibition && this.isInsideEnemyInhibitionRange(team, x, y, radius)) ||
      blockers.some((other) => Math.hypot(x - other.x, y - other.y) < radius + other.radius)
    ) return null;
    return { x, y, radius };
  }
  getDeploymentPlan(card, x, y, team = this.turns.currentTeam) {
    const stats = this.stats[card?.troopId];
    if (!stats) return { valid: false, positions: [], message: 'Unknown hero card' };
    const squadSize = stats.squadSize || 1;
    const radius = this.collisionRadiusForStats(stats);
    const formationRadius = Math.max(20, radius * 2.25);
    const points = Array.from({ length: squadSize }, (_, index) => {
      if (index === 0) return { x, y };
      const angle = (Math.PI * 2 * (index - 1)) / (squadSize - 1);
      return { x: x + Math.cos(angle) * formationRadius, y: y + Math.sin(angle) * formationRadius };
    });
    const positions = [];
    for (const point of points) {
      const placement = this.findPlacementPosition(team, point.x, point.y, stats, positions);
      if (!placement)
        return {
          valid: false,
          positions: [...positions, { x: point.x, y: point.y, radius }],
          message: 'Invalid deployment: arena edge, obstacle, or enemy deployment zone',
        };
      positions.push(placement);
    }
    return { valid: true, positions, message: '' };
  }
  findFreeSpawnPosition(team, x, y, stats, occupied = []) {
    return this.findPlacementPosition(team, x, y, stats, occupied, false);
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
      // A troop may use the bridge as soon as its center is on it. Requiring
      // the full collision circle to fit blocked the approach from either bank.
      const onBridge = this.isOnBridge(x, y);
      if (!onBridge) return true;
    }
    for (const turret of this.board.turrets) {
      const structureRadius = turret.radius ?? RADIUS_PER_SIZE * turret.size;
      if (turret.hp > 0 && Math.hypot(turret.x - x, turret.y - y) < structureRadius + radius + 0.5) {
        return true;
      }
    }
    for (const tower of this.board.towers) {
      const structureRadius = tower.radius ?? RADIUS_PER_SIZE * tower.size;
      if (tower.hp > 0 && Math.hypot(tower.x - x, tower.y - y) < structureRadius + radius + 0.5) {
        return true;
      }
    }
    // Summoned buildings are fixed terrain for path planning and movement.
    // Ordinary troops remain pushable and are deliberately excluded here.
    for (const building of this.board.troops) {
      if (!building.stats?.isBuilding || building.hp <= 0) continue;
      const buildingRadius = building.collisionRadius || RADIUS_PER_SIZE;
      if (Math.hypot(building.x - x, building.y - y) < buildingRadius + radius + 0.5)
        return true;
    }
    for (const terrain of this.board.terrains) {
      if (terrain.type === 'rock') {
        if (Math.hypot(terrain.x - x, terrain.y - y) < terrain.r + radius) return true;
        continue;
      }
      const nearestX = Math.max(terrain.x, Math.min(x, terrain.x + terrain.w));
      const nearestY = Math.max(terrain.y, Math.min(y, terrain.y + terrain.h));
      if (Math.hypot(x - nearestX, y - nearestY) < radius) return true;
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
  resolveDeploymentPushes(...args) {
    try {
      return resolveDeploymentPushes(this, ...args);
    } catch (error) {
      this.recordMovementDiagnostic('deployment-push-exception', args[0]?.[0] || null, { error: String(error?.stack || error) });
      console.error('Deployment push resolution failed:', error);
      return false;
    }
  }
  resolveMovementCollisions(movedThisFrame, startPositions) {
    return resolveMovementCollisions(this, movedThisFrame, startPositions);
  }
  canMoveSegment(...args) { return canMoveSegment(this, ...args); }
  move(unit, x, y) {
    if (this.winner !== null || this.phase !== 'battle') return false;
    if (unit.burrowed || unit.isClone || unit.isDrone || unit.stats.isBuilding) return false;
    if (unit.team !== this.turns.currentTeam) return false;
    if (unit.isMoving()) return false;
    if (unit.effects.some((effect) => effect.type === 'confused')) {
      this.message =
        'Confused: this troop cannot receive manual movement commands';
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
          (unit.focus.type === 'base' || unit.focus.layer
            ? unit.focus.radius
              : unit.focus.collisionRadius || RADIUS_PER_SIZE),
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
          edgeDistanceBetween(turret, turret.focus) > turret.range)
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
            edgeDistanceBetween(turret, t) <= turret.range,
          )
          .sort(
            (a, b) =>
              aggroAdjustedDistance(turret, a) - aggroAdjustedDistance(turret, b),
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
    if (this.winner !== null || this.phase !== 'battle') return false;
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
      !enemies.some((ally) => ally.hp < ally.maxHp && troop.distanceToEdge(ally) <= troop.attackRange)
    )
      return false;
    if (troop.ac < troop.stats.attackCost) return false;

    const profile = troop.stats.basicAttack;
    this.spendAC(troop, troop.stats.attackCost);
    if (troop.hp <= 0) return false;
    const overriddenAttack = this.applyHeroHook(troop, 'beforeBasicAttack', resolvedTarget, profile);
    if (overriddenAttack?.handled) {
      this.board.removeDefeated();
      return overriddenAttack.result;
    }
    this.startBasicAttackAnimation(troop, resolvedTarget, profile, allyHeal);
    if (allyHeal) {
      return this.applyHeroHook(troop, 'healAllies', resolvedTarget, enemies, profile);
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
    this.history.reduction(troop, resolvedTarget, raw * damageMultiplier - damage);
    const totalDamage = this.applyDamage(resolvedTarget, damage, troop, {
      ranged: troop.stats.range > 80,
      damageType: profile.damageType,
      mitigationRatio: raw > 0 ? Math.max(0, Math.min(1, applyResistance(raw, resistance, profile.damageType, armorPen, percentPen) / raw)) : 1,
    });
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
        this.history.reduction(troop, splashTarget, raw - splashDamage);
        this.applyDamage(splashTarget, splashDamage, troop, {
          ranged: troop.stats.range > 80,
          damageType: profile.damageType,
          mitigationRatio: raw > 0 ? Math.max(0, Math.min(1, applyResistance(raw, splashResistance, profile.damageType, profile.damageType === 'physical' ? troop.stats.flatArmorPen || 0 : 0, profile.damageType === 'magic' ? troop.magicPenPercent : troop.stats.percentPen || 0) / raw)) : 1,
        });
      }
    }
    this.applyHeroHook(troop, 'onBasicAttack', resolvedTarget, totalDamage);
    troop.focus = resolvedTarget;
    this.board.removeDefeated();
    this.resolveStructureOutcomes();
    for (const player of this.players) {
      player.units = player.units.filter((u) => u.hp > 0);
    }
    return totalDamage;
  }
  startBasicAttackAnimation(attacker, target, profile, healing = false) {
    const ranged = attacker.stats.range > 80;
    const distance = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    const styles = ['swing', 'punch', 'hook', 'shove', 'stab'];
    const style = ranged ? null : styles[this.meleeAttackAnimationIndex++ % styles.length];
    this.board.attackAnimations.push({
      kind: ranged ? 'projectile' : 'melee',
      style,
      attacker,
      target,
      from: { x: attacker.x, y: attacker.y },
      damageType: healing ? 'heal' : profile.damageType,
      elapsed: 0,
      duration: ranged ? Math.max(0.18, Math.min(0.8, distance / 780)) : 0.42,
    });
  }
  tickBuildings() {
    for (const building of this.board.troops) {
      if (!building.stats.isBuilding || building.hp <= 0) continue;
      const lifetimeTurns = Number(building.stats.buildingLifetimeTurns);
      if (Number.isFinite(lifetimeTurns) && lifetimeTurns > 0)
        building.hp = Math.max(0, building.hp - building.maxHp / lifetimeTurns);
      if (building.hp <= 0) continue;
      if (this.applyHeroHook(building, 'onBuildingTurn') === true) continue;
      if (!building.stats.spawnRole) continue;
      building.spawnTurns -= 1;
      if (building.spawnTurns <= 0) {
        building.spawnTurns = this.applyHeroHook(building, 'spawnBuildingUnit')
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
        const heroMessage = this.applyHeroHook(troop, 'attackLog', targetName, result);
        if (heroMessage) {
          attacks.push(heroMessage);
        } else if (troop.stats.targetPreference === 'allies') {
          if (result <= 0) break;
          attacks.push(`${this.teamName(player.team)} ${troop.stats.name} restored ${result} HP to allies`);
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
    if (this.winner !== null || this.phase !== 'battle') return;
    const ending = this.activePlayer();
    for (const troop of this.board.troops) this.applyHeroHook(troop, 'onTurnStart');
    const autoAttacks = this.autoAttack(ending);
    if (this.winner !== null) return;
    ending.units.forEach((t) => t.prepareEndTurn(this.targetsFor(t)));
    this.fireTurrets();
    this.tickZones();
    for (const troop of this.board.troops) this.applyHeroHook(troop, 'onTurnEnd');
    this.tickStrikes();
    for (const troop of this.board.troops) {
      const effectsBeforeTick = [...troop.effects];
      troop.tickEffects();
      for (const effect of effectsBeforeTick)
        if (!troop.effects.includes(effect))
          this.applyHeroHook(effect.sourceUnit || troop, 'onEffectExpired', troop, effect);
    }
    this.tickGrassPatches();
    for (const troop of this.board.troops) this.applyHeroHook(troop, 'onAfterTurnResolution');
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
      if (zone.effects?.length) {
        for (const target of this.board.troops) {
          if (
            target.hp <= 0 ||
            target.burrowed ||
            target.distanceTo(zone) > zone.radius + collisionRadiusOf(target)
          )
            continue;
          for (const fieldEffect of zone.effects) {
            if (fieldEffect.target === 'enemy-troops' && (target.team === zone.team || target.stats.isBuilding)) continue;
            if (fieldEffect.target === 'ally-troops' && (target.team !== zone.team || target.stats.isBuilding)) continue;
            target.addEffect({
              ...fieldEffect,
              id: `${zone.abilityId}-${zone.team}-${zone.x}-${zone.y}-${fieldEffect.type}`,
              remainingTurns: 2,
            });
          }
          target.validateFocus(this.targetsFor(target));
        }
        zone.remainingTurns -= 1;
        continue;
      }
      const targets = zone.affectsStructures
        ? [...this.board.troops, ...this.board.turrets, ...this.board.towers]
        : this.board.troops;
      for (const target of targets) {
        if (
          target.hp <= 0 ||
          target.burrowed ||
          target.team === zone.team ||
          Math.hypot(target.x - zone.x, target.y - zone.y) > zone.radius + collisionRadiusOf(target)
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
            raw * (zone.damageMultiplier || 1) *
              (!target.stats ? (zone.structureDamageMultiplier ?? 0.5) : 1),
            target.magicResist,
            'magic',
            0,
            zone.caster.magicPenPercent,
          ),
        );
        const healthDamage = this.applyDamage(target, damage, zone.caster, {
          ranged: true,
          damageType: 'magic',
          mitigationRatio: raw > 0 ? Math.max(0, Math.min(1, applyResistance(raw, target.magicResist, 'magic', 0, zone.caster.magicPenPercent) / raw)) : 1,
        });
        this.applyHeroHook(zone.caster, 'onZoneHit', zone, target, healthDamage);
        const isBuilding = target.stats?.isBuilding || target.layer || target.type === 'base';
        const chainedStructures = zone.chainedStructures || (zone.chainedStructures = new Set());
        if (zone.chainOnStructures && isBuilding && !chainedStructures.has(target)) {
          chainedStructures.add(target);
          this.applyHeroHook(zone.caster, 'chainZone', zone, target);
        }
      }
      if (zone.visualizeDamage ?? Boolean(ability.damagePerTurn > 0 || ability.damagePerTurnScaling))
        this.showDamageArea({ x: zone.x, y: zone.y, radius: zone.radius, team: zone.team });
      zone.remainingTurns -= 1;
    }
    this.board.zones = this.board.zones.filter((zone) => zone.remainingTurns > 0);
    this.board.removeDefeated();
    this.resolveStructureOutcomes();
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
        if (distance > data.radius + collisionRadiusOf(target)) continue;
        const atCenter = distance <= data.centerRadius;
        const raw = Math.round(
          ((data.damage || 0) + scaleDamage(strike.caster.stats, data.scaling || {})) *
            (atCenter ? data.centerDamageMultiplier : 1),
        );
        const damage = Math.round(
          applyResistance(raw, target.magicResist, 'magic') *
            (!target.stats ? (data.structureDamageMultiplier ?? 0.5) : 1),
        );
        this.applyDamage(target, damage, strike.caster, {
          ranged: true,
          damageType: 'magic',
          mitigationRatio: raw > 0 ? Math.max(0, Math.min(1, applyResistance(raw, target.magicResist, 'magic') / raw)) : 1,
        });
        if (target.stats && !target.stats.isBuilding) {
          const pushForce = (data.knockbackForce || 0) + scaleDamage(strike.caster.stats, data.knockbackScaling || {});
          const push = pushForce * (atCenter ? data.centerKnockbackMultiplier : 1);
          this.knockbackTarget({ x: strike.x, y: strike.y }, target, push);
        }
      }
      this.board.impacts.push({
        kind: data.impactEffect?.kind || 'strike',
        x: strike.x,
        y: strike.y,
        radius: data.radius,
        innerRadius: data.centerRadius,
        duration: data.impactEffect?.duration || 2,
        remainingSeconds: data.impactEffect?.duration || 2,
      });
      this.shakeTimer = Math.max(this.shakeTimer, data.impactEffect?.shakeSeconds || 0);
      this.addEvent(`${this.teamName(strike.team)} ${data.impactEffect?.message || `${data.name} impacts!`}`, strike.team);
      this.resolveStructureOutcomes();
    }
    this.board.strikes = this.board.strikes.filter((strike) => strike.remainingTurns > 0);
    this.board.removeDefeated();
  }
  cast(...args) { return cast(this, ...args); }
  applyAbilityArea(...args) { return applyAbilityArea(this, ...args); }
  applyAbilityToTarget(...args) { return applyAbilityToTarget(this, ...args); }
  teleportDestination(...args) { return teleportDestination(this, ...args); }
  damageWithAbility(...args) { return damageWithAbility(this, ...args); }
  directionalAbilityTargets(...args) { return directionalAbilityTargets(this, ...args); }
  applyDirectionalAbility(...args) { return applyDirectionalAbility(this, ...args); }
  knockbackTarget(...args) { return knockbackTarget(this, ...args); }
  findPath(...args) { return findPath(this, ...args); }
  isPathSegmentClear(...args) { return isPathSegmentClear(this, ...args); }
  moveAutomatically(...args) { return moveAutomatically(this, ...args); }
  executeBeginningMovement(player) {
    this.beginningMovementQueue = player.units.map((unit) => ({ unit }));
    this.startNextBeginningMovement();
  }
  startNextBeginningMovement() {
    if (!this.beginningMovementQueue || this.board.troops.some((troop) => troop.isMoving())) return;
    while (this.beginningMovementQueue.length) {
      const entry = this.beginningMovementQueue.shift();
      const unit = entry.unit;
      if (!unit || unit.hp <= 0 || unit.burrowed || unit.stats.isBuilding || unit.isMoving()) continue;
      const isHero = Boolean(this.stats[unit.stats?.id]);
      const budgetMs = isHero
        ? GAME_PARAMS.movement.heroPathfindingBudgetMs
        : GAME_PARAMS.movement.minionPathfindingBudgetMs;
      const deadline = (globalThis.performance?.now?.() ?? Date.now()) + budgetMs;
      const startX = unit.x;
      const startY = unit.y;
      const startMovementRemaining = unit.movementRemaining;
      const startFocus = unit.focus;
      const startFacing = unit.facing;
      const startDetonateOnArrival = unit.detonateOnArrival;
      let waypoints = [];
      let customMovement;
      try {
        customMovement = this.applyHeroHook(unit, 'planTurnMovement', deadline);
      } catch (error) {
        this.recordMovementDiagnostic('movement-planning-exception', unit, { error: String(error?.stack || error) });
        console.error('Hero movement planning failed:', error);
        continue;
      }
      if (customMovement?.handled) {
        waypoints = customMovement.waypoints || [];
      } else if (!unit.stunned && unit.stats.targetPreference === 'allies') {
        const allies = this.targetsFor(unit);
        unit.validateFocus(allies);
        if (!unit.focus) unit.updateFocus(allies);
        if (!unit.focus) {
          const visibleAllies = unit.eligibleTargets(allies)
            .filter((ally) => ally.hp > 0 && unit.distanceToEdge(ally) <= unit.sightRange)
            .sort((a, b) => aggroAdjustedDistance(unit, a) - aggroAdjustedDistance(unit, b));
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
            .filter((enemy) => enemy.hp > 0 && unit.distanceToEdge(enemy) <= unit.sightRange)
            .sort((a, b) => aggroAdjustedDistance(unit, a) - aggroAdjustedDistance(unit, b));
          if (!visible.length) {
            const enemyTurrets = this.board.turrets
              .filter((turret) => turret.team !== unit.team && turret.hp > 0)
              .sort((a, b) => unit.distanceTo(a) - unit.distanceTo(b));
            const target = enemyTurrets[0] || this.board.towers.find(
              (tower) => tower.team !== unit.team && tower.hp > 0,
            );
            waypoints = waypoints.concat(this.moveAutomatically(unit, target, false, enemies, deadline));
            visible = unit.eligibleTargets(enemies)
              .filter((enemy) => enemy.hp > 0 && unit.distanceToEdge(enemy) <= unit.sightRange)
              .sort((a, b) => aggroAdjustedDistance(unit, a) - aggroAdjustedDistance(unit, b));
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
      if (waypoints.length) {
        unit.waypoints = waypoints;
        return;
      }
      unit.movementRemaining = startMovementRemaining;
      unit.focus = startFocus;
      unit.facing = startFacing;
      unit.detonateOnArrival = startDetonateOnArrival;
    }
    this.beginningMovementQueue = null;
  }
  isOnBridge(x, y) {
    return this.board.bridges.some(
      (bridge) =>
        x >= bridge.x && x <= bridge.x + bridge.w && y >= bridge.y && y <= bridge.y + bridge.h,
    );
  }
  isInsideEnemyInhibitionRange(team, x, y, unitRadius = 0) {
    const structures = [...this.board.turrets, ...this.board.towers];
    return structures.some(
      (structure) =>
        structure.team !== team &&
        structure.hp > 0 &&
        Math.hypot(structure.x - x, structure.y - y) <=
          structure.range * 1.3 + structure.radius + unitRadius,
    );
  }
}
