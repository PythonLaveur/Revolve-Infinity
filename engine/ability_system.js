import { applyResistance, scaleDamage } from '../units/damage.js';
import { collisionRadiusOf, edgeDistanceBetween, edgeDistanceToPoint } from '../units/stats.js';

const hasDirectAbilityDamage = (data) => Boolean(data.damage || data.damageFraction || data.targetMaxHpFraction || (data.scaling && data.damageType));

export function cast(game, card, caster, x, y, target = null) {

    if (game.phase !== 'battle') return false;
    if (game.winner !== null) return false;
    const player = game.activePlayer();
    const data = game.abilities[card.abilityId];
    if (caster.burrowed) {
      game.message = 'Troop is underground';
      return false;
    }
    if (caster.isClone) {
      game.message = 'Clones cannot use abilities';
      return false;
    }
    if (caster.stunned) {
      game.message = 'Troop is stunned';
      return false;
    }
    if (caster.effects.some((effect) => effect.type === 'silence')) {
      game.message = 'Troop is silenced and cannot use abilities';
      return false;
    }
    if (caster.team !== player.team) {
      game.message = 'Only your own troops can cast abilities';
      return false;
    }
    if (data.troop !== caster.stats.id) {
      game.message = `${caster.stats.name} can only cast its own abilities`;
      return false;
    }
    const heroValidation = game.applyHeroHook(caster, 'validateAbility', data, target, card);
    if (heroValidation?.valid === false) {
      game.message = heroValidation.message || `${card.name} cannot be used now`;
      return false;
    }
    const targeting = data.targeting || (data.heal ? 'self' : 'area');
    if (targeting === 'unit') {
      const isAlly = target?.team === caster.team && target !== caster;
      const isEnemy = target?.team !== caster.team;
      const isArenaStructure = [...game.board.turrets, ...game.board.towers].includes(target);
      const teamAllowed =
        data.targetTeam === 'ally'
          ? isAlly
          : data.targetTeam === 'enemy'
            ? isEnemy
            : isAlly || isEnemy;
      const targetAllowed = game.board.troops.includes(target)
        ? !target.burrowed
        : isArenaStructure && hasDirectAbilityDamage(data) && data.targetTeam !== 'ally';
      const valid =
        target &&
        !target.isUntargetable &&
        targetAllowed &&
        target.hp > 0 &&
        teamAllowed &&
        edgeDistanceBetween(caster, target) <= (data.targetRange ?? Infinity);
      if (!valid) {
        game.message =
          data.targetTeam === 'ally'
            ? `Select a valid ally within ${data.targetRange} units before casting ${card.name}`
            : `Select a valid target before casting ${card.name}`;
        return false;
      }
    }
    let teleportDestination = null;
    let dashPath = null;
    if (data.teleportToTarget) {
      teleportDestination = game.teleportDestination(caster, target);
      if (!teleportDestination) {
        game.message = 'No free air space near that ally';
        return false;
      }
    }
    if (data.dashToTarget) {
      dashPath = game.findPath(caster, target);
      const destination = dashPath[dashPath.length - 1];
      if (
        !destination ||
        Math.max(0, Math.hypot(destination.x - target.x, destination.y - target.y) - caster.collisionRadius - collisionRadiusOf(target)) > caster.attackRange
      ) {
        game.message = 'No path into attack range';
        return false;
      }
    }
    if (
      targeting === 'area' &&
      data.castRange &&
      edgeDistanceToPoint(caster, x, y) > data.castRange
    ) {
      game.message = `Choose an area within ${data.castRange} units`;
      return false;
    }
    if (targeting === 'area' && data.summonBuilding) {
      const placement = game.findPlacementPosition(caster.team, x, y, { isBuilding: true });
      if (!placement || (data.castRange && edgeDistanceBetween(caster, placement) > data.castRange)) {
        game.message = 'Invalid building placement: arena edge, obstacle, or enemy deployment zone';
        return false;
      }
      x = placement.x;
      y = placement.y;
    }
    if (targeting === 'direction' && Math.hypot(x - caster.x, y - caster.y) < 1) {
      game.message = 'Choose a direction before casting';
      return false;
    }
    const directionalTargets =
      targeting === 'direction' ? game.directionalAbilityTargets(data, caster, x, y) : null;
    if (player.ap < data.darkCost) {
      game.message = 'Not enough AP';
      return false;
    }
    if (caster.ac < data.apCost) {
      game.message = 'Not enough AC';
      return false;
    }
    player.ap -= data.darkCost;
    game.spendAC(caster, data.apCost);
    if (caster.hp <= 0) {
      game.message = 'Troop was defeated by its bleed before casting';
      return false;
    }
    const customCast = game.applyHeroHook(caster, 'castAbility', data, { x, y, target, teleportDestination, dashPath });
    if (customCast?.handled) {
      // Hero module handled this ability's unique targeting behavior.
    } else if (targeting === 'self') {
      game.applyAbilityToTarget(data, caster, caster);
    } else if (targeting === 'area' && data.delayedStrike) {
      game.board.strikes.push({
        abilityId: data.id,
        caster,
        team: caster.team,
        x,
        y,
        remainingTurns: data.delayTurns,
      });
    } else if (targeting === 'unit' && data.projectile) {
      game.board.projectiles.push({
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
      } else game.applyAbilityToTarget(data, caster, target, teleportDestination);
    } else if (targeting === 'area' && data.projectile) {
      game.board.projectiles.push({
        abilityId: data.id,
        caster,
        from: { x: caster.x, y: caster.y },
        targetPoint: { x, y },
        progress: 0,
      });
    } else if (targeting === 'area' && data.createsZone) {
      game.board.zones.push({
        abilityId: data.id,
        caster,
        team: caster.team,
        x,
        y,
        radius: data.radius,
        remainingTurns: data.duration,
      });
    } else if (targeting === 'area') {
      game.applyAbilityArea(data, caster, x, y);
    } else if (targeting === 'direction') {
      game.applyDirectionalAbility(data, caster, directionalTargets, x, y);
    }
    player.abilityHand.play(card);
    game.board.removeDefeated();
    game.resolveStructureOutcomes();
    game.addEvent(`${game.teamName(caster.team)} ${card.name} cast.`, caster.team);
    return true;
  
}

export function applyAbilityArea(game, data, caster, x, y) {

    if (
      data.damage ||
      data.damageFraction ||
      data.targetMaxHpFraction ||
      data.damagePerTurn ||
      data.damagePerTurnScaling ||
      data.scaling
    )
      game.showDamageArea({ x, y, radius: data.radius || 0, team: caster.team });
    const targets = game.board.troops.filter(
      (troop) =>
        !troop.burrowed &&
        troop.team !== caster.team &&
        Math.hypot(troop.x - x, troop.y - y) <= data.radius + collisionRadiusOf(troop),
    );
    // Delayed Skyfall Bomb remains troop-only until its turret interaction is designed.
    if (hasDirectAbilityDamage(data) && !data.delayedStrike) {
      targets.push(
        ...[...game.board.turrets, ...game.board.towers].filter(
          (structure) =>
            structure.hp > 0 &&
            structure.team !== caster.team &&
            Math.hypot(structure.x - x, structure.y - y) <= data.radius + collisionRadiusOf(structure),
        ),
      );
    }
    for (const target of targets) game.applyAbilityToTarget(data, caster, target);
  
}

export function applyAbilityToTarget(game, data, caster, target, teleportDestination = null) {
    if (game.applyHeroHook(caster, 'activateAbility', data, target, teleportDestination)) return;
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
      const members = game.board.troops.filter(
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
      caster.validateFocus(game.board.enemyTargets(caster.team));
      for (const troop of [caster, target]) {
        const speedMultiplier =
          1 + (data.moveSpeedMultiplier - 1) * game.allyBonusMultiplier(troop);
        troop.addEffect({
          id: `${data.id}-move-speed`,
          type: 'move-speed',
          multiplier: speedMultiplier,
          remainingSeconds: data.durationSeconds,
        });
      }
    }
    const buffMultiplier = target.team === caster.team ? game.allyBonusMultiplier(target) : 1;
    const healing =
      ((data.heal || 0) + scaleDamage(caster.stats, data.healScaling || {})) * buffMultiplier;
    if (healing > 0) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + healing);
      game.history.healing(caster, target, target.hp - before);
    }
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
      target.updateFocus(game.board.enemyTargets(target.team));
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
        sourceUnit: data.momentumShield ? caster : null,
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
    const knockbackForce = (data.knockbackForce || 0) + scaleDamage(caster.stats, data.knockbackScaling || {});
    if (knockbackForce > 0 && target.stats) game.knockbackTarget(caster, target, knockbackForce);
    if (data.damage || data.damageFraction || data.targetMaxHpFraction || data.scaling)
      return game.damageWithAbility(data, caster, target);
  
}

export function teleportDestination(game, caster, target) {

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
          position.x <= game.board.width &&
          position.y >= 0 &&
          position.y <= game.board.height &&
          !game.isBlockedByTroop(
            position.x,
            position.y,
            20,
            caster,
            caster.stats.movementType || 'ground',
          ),
      ) || null
    );
  
}

export function damageWithAbility(game, data, caster, target) {

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
      ? (caster.stats.structureDamageMultiplier ?? 1) * (data.structureDamageMultiplier ?? 0.5)
      : 1;
    const mitigatedDamage =
      applyResistance(raw, resistance, type, armorPen, percentPen) * damageMultiplier;
    game.history.reduction(caster, target, raw - mitigatedDamage);
    const dealt = game.applyDamage(target, mitigatedDamage, caster, {
      ranged: ['area', 'direction', 'unit'].includes(data.targeting),
      damageType: type,
      mitigationRatio: raw > 0 ? Math.max(0, Math.min(1, applyResistance(raw, resistance, type, armorPen, percentPen) / raw)) : 1,
    });
    game.applyHeroHook(caster, 'onAbilityHit', data, target, dealt);
    return dealt;
  
}

export function directionalAbilityTargets(game, data, caster, x, y) {

    let dx = x - caster.x;
    let dy = y - caster.y;
    const aimDistance = Math.hypot(dx, dy);
    const maxAimDistance = data.range + collisionRadiusOf(caster);
    if (data.range && aimDistance > maxAimDistance) {
      dx = (dx / aimDistance) * maxAimDistance;
      dy = (dy / aimDistance) * maxAimDistance;
    }
    const lengthSquared = dx * dx + dy * dy;
    const candidates =
      data.targetTeam === 'ally'
        ? game.board.troops
        : hasDirectAbilityDamage(data)
          ? [...game.board.troops, ...game.board.turrets, ...game.board.towers]
          : game.board.troops;
    const hits = candidates
      .filter((target) => {
        if (target.hp <= 0 || target.burrowed || target.isUntargetable) return false;
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
          radius: collisionRadiusOf(target),
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
            targetDistance <= data.range + collisionRadiusOf(caster) + hit.radius && Math.abs(difference) <= (data.arcAngle * Math.PI) / 360 + Math.asin(Math.min(1, hit.radius / Math.max(1, targetDistance)))
          );
        }
        const padding = hit.radius / Math.max(1, Math.sqrt(lengthSquared));
        return hit.projection >= -padding && hit.projection <= 1 + padding && hit.distance <= (data.lineWidth || 24) + hit.radius;
      })
      .sort((a, b) => a.projection - b.projection);
    const targets = data.hitMode === 'first' ? hits.slice(0, 1) : hits;
    return targets.map((hit) => hit.target);
  
}

export function applyDirectionalAbility(game, data, caster, targets, x, y) {

    if (!targets.length && !data.allowEmptyTarget) return;
    if (
      (data.damage || data.damageFraction || data.targetMaxHpFraction || data.scaling) &&
      data.arcAngle
    ) {
      game.showDamageArea({
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
      const next = game.board
        .enemyTargets(caster.team)
        .filter(
          (enemy) =>
            !enemy.burrowed &&
            enemy.hp > 0 &&
            !chain.includes(enemy) &&
            edgeDistanceBetween(previous, enemy) <= data.ricochetRange,
        )
        .sort(
          (a, b) =>
            edgeDistanceBetween(previous, a) - edgeDistanceBetween(previous, b),
        )[0];
      if (!next) break;
      chain.push(next);
    }
    if (data.showRicochetPath) {
      const points = [{ x: caster.x, y: caster.y }, ...chain.map(({ x, y }) => ({ x, y }))];
      if (!chain.length) {
        let dx = x - caster.x;
        let dy = y - caster.y;
        const length = Math.hypot(dx, dy) || 1;
        const scale = Math.min(length, data.range + collisionRadiusOf(caster)) / length;
        points.push({ x: caster.x + dx * scale, y: caster.y + dy * scale });
      }
      game.board.areaEffects.push({
        kind: 'ricochet-path',
        points,
        team: caster.team,
        duration: 0.85,
        remainingSeconds: 0.85,
      });
    }
    for (const target of chain) {
      const damage = game.applyAbilityToTarget(data, caster, target) || 0;
      if (
        data.bleedFraction &&
        target.stats &&
        !game.board.turrets.includes(target) &&
        !game.board.towers.includes(target)
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

export function knockbackTarget(game, caster, target, distance) {

    // Explicit knockback is a forced displacement: target force does not
    // resist it. Mass alone determines travel distance.
    target.resetMomentumShield?.();
    distance /= Math.max(0.1, target.stats?.mass || 1);

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
        x: Math.max(0, Math.min(game.board.width, target.x + direction.x * mid)),
        y: Math.max(0, Math.min(game.board.height, target.y + direction.y * mid)),
      };
      if (game.canMoveSegment(target, candidate, target)) {
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
