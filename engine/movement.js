import { RADIUS_PER_SIZE } from '../units/stats.js';
import { solveCrowdDisplacements } from './crowd_solver.js';

const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();
export function findPath(game, unit, target, stopWithinAttackRange = false, deadline = Infinity, gridStep = 20) {

    if (!target) return [];
    const startedAt = monotonicNow();
    const fineStep = Math.max(8, Math.min(12, Math.round(unit.collisionRadius * 0.35)));
    const adaptiveStep = Math.max(12, Math.min(20, Math.round(unit.collisionRadius * 0.6)));
    const step = gridStep === 20 ? adaptiveStep : gridStep,
      cols = Math.ceil(game.board.width / step),
      rows = Math.ceil(game.board.height / step);
    const stageDeadline = deadline === Infinity || step <= fineStep
      ? deadline
      : startedAt + (deadline - startedAt) * 0.45;
    const timedOut = () => stageDeadline !== Infinity && monotonicNow() >= stageDeadline;
    let passableCount = 0;
    let expandedCount = 0;
    const targetName = target.stats?.name || target.name || target.type || (target.layer ? `${target.layer} turret` : 'arena structure');
    const nearbyObstacles = () => [
      ...game.board.turrets,
      ...game.board.towers,
      ...game.board.troops.filter((troop) => troop.stats?.isBuilding && troop.hp > 0),
    ].map((obstacle) => ({
      name: obstacle.stats?.name || obstacle.name || obstacle.type || (obstacle.layer ? `${obstacle.layer} turret` : 'building'),
      distance: Math.round(Math.hypot(unit.x - obstacle.x, unit.y - obstacle.y)),
      clearance: Math.round(Math.hypot(unit.x - obstacle.x, unit.y - obstacle.y) - unit.collisionRadius - (obstacle.radius || obstacle.collisionRadius || 0)),
    })).sort((a, b) => a.clearance - b.clearance).slice(0, 6);
    const recordStage = (reason) => game.recordMovementDiagnostic?.('pathfinding-detail', unit, {
      reason,
      target: targetName,
      targetX: Math.round(target.x),
      targetY: Math.round(target.y),
      positionX: Math.round(unit.x),
      positionY: Math.round(unit.y),
      unitRadius: Math.round(unit.collisionRadius),
      gridStep: step,
      passableCells: passableCount,
      exploredCells: expandedCount,
      elapsedMs: Math.round(monotonicNow() - startedAt),
      nearestObstacles: nearbyObstacles(),
    });
    const retryAtFineResolution = (reason = 'stage-timeout') => {
      recordStage(reason);
      return step > fineStep ? findPath(game, unit, target, stopWithinAttackRange, deadline, fineStep) : [];
    };
    if (timedOut()) return retryAtFineResolution();
    const structureRadius = target.type === 'base' || target.layer ? target.radius : 0;
    const approachDistance = structureRadius > 0
      ? stopWithinAttackRange
        ? structureRadius + unit.collisionRadius + Math.max(2, unit.attackRange - 4)
        : Math.max(structureRadius + unit.collisionRadius + 2, structureRadius + unit.collisionRadius + unit.sightRange - 4)
      : stopWithinAttackRange
        ? unit.attackRange + unit.collisionRadius + (target.collisionRadius || RADIUS_PER_SIZE) - 1
        : Math.max(2, unit.sightRange + unit.collisionRadius + (target.collisionRadius || RADIUS_PER_SIZE) - 4);
    const targetDx = unit.x - target.x;
    const targetDy = unit.y - target.y;
    const targetDistance = Math.hypot(targetDx, targetDy);
    if (targetDistance <= approachDistance) return [];
    const goalDistance = Math.max(0, approachDistance - 1);
    const directGoal = {
      x: target.x + targetDx / targetDistance * goalDistance,
      y: target.y + targetDy / targetDistance * goalDistance,
    };
    if (
      directGoal.x >= unit.collisionRadius && directGoal.x <= game.board.width - unit.collisionRadius &&
      directGoal.y >= unit.collisionRadius && directGoal.y <= game.board.height - unit.collisionRadius &&
      game.isPathSegmentClear({ x: unit.x, y: unit.y }, directGoal, unit, game.board.troops)
    ) return [{ x: unit.x, y: unit.y }, directGoal];
    const key = (x, y) => `${x},${y}`;
    // Dynamic units are pushed during physical movement. They must never turn
    // a valid terrain route into a false no-path result during planning.
    const ignoredTroops = game.board.troops;
    const roundedStart = {
      x: Math.max(0, Math.min(cols - 1, Math.round(unit.x / step))),
      y: Math.max(0, Math.min(rows - 1, Math.round(unit.y / step))),
    };
    const cellIndex = (x, y) => y * cols + x;
    const passable = new Uint8Array(cols * rows);
    const movementType = unit.stats.movementType || 'ground';
    for (let y = 0; y < rows; y++) {
      if (timedOut()) return retryAtFineResolution();
      for (let x = 0; x < cols; x++) {
        const worldX = x * step;
        const worldY = y * step;
        if (
          worldX >= unit.collisionRadius && worldX <= game.board.width - unit.collisionRadius &&
          worldY >= unit.collisionRadius && worldY <= game.board.height - unit.collisionRadius &&
          !game.isBlockedByTerrain(worldX, worldY, unit.collisionRadius, movementType)
        ) {
          const index = cellIndex(x, y);
          passable[index] = 1;
          passableCount += 1;
        }
      }
    }
    const segmentCache = new Map();
    const segmentClear = (from, to) => {
      const fromIndex = cellIndex(from.x / step, from.y / step);
      const toIndex = cellIndex(to.x / step, to.y / step);
      const cacheKey = fromIndex < toIndex ? `${fromIndex}:${toIndex}` : `${toIndex}:${fromIndex}`;
      if (!segmentCache.has(cacheKey))
        segmentCache.set(cacheKey, game.isPathSegmentClear(from, to, unit, ignoredTroops));
      return segmentCache.get(cacheKey);
    };
    // Rounding a legal position can put the grid start inside a tower/building
    // clearance radius. Never force that blocked cell open; attach the search
    // to the closest reachable passable cell instead.
    let start = null;
    const startCandidates = [];
    const maxStartRadius = Math.max(cols, rows);
    for (let radius = 0; radius <= maxStartRadius && !start; radius++) {
      startCandidates.length = 0;
      for (let y = Math.max(0, roundedStart.y - radius); y <= Math.min(rows - 1, roundedStart.y + radius); y++) {
        for (let x = Math.max(0, roundedStart.x - radius); x <= Math.min(cols - 1, roundedStart.x + radius); x++) {
          if (Math.max(Math.abs(x - roundedStart.x), Math.abs(y - roundedStart.y)) !== radius) continue;
          if (!passable[cellIndex(x, y)]) continue;
          const distance = Math.hypot(unit.x - x * step, unit.y - y * step);
          startCandidates.push({ x, y, distance });
        }
      }
      startCandidates.sort((a, b) => a.distance - b.distance);
      for (const candidate of startCandidates) {
        if (game.isPathSegmentClear(
          { x: unit.x, y: unit.y },
          { x: candidate.x * step, y: candidate.y * step },
          unit,
          ignoredTroops,
        )) {
          start = { x: candidate.x, y: candidate.y };
          break;
        }
      }
    }
    if (!start) {
      if (step > fineStep) {
        recordStage('no-reachable-grid-start-coarse');
        return findPath(game, unit, target, stopWithinAttackRange, deadline, fineStep);
      }
      recordStage('no-reachable-grid-start');
      return [];
    }
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
      if (timedOut()) return retryAtFineResolution();
      const current = pop();
      expandedCount += 1;
      if (current.g !== gScore.get(current.key)) continue;
      const reachedGoal =
        Math.hypot(target.x - current.x * step, target.y - current.y * step) <= approachDistance;
      if (reachedGoal) {
        found = current;
        break;
      }
      for (const [dx, dy] of directions) {
        if (timedOut()) return retryAtFineResolution();
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
    if (!found) {
      if (step > fineStep) {
        recordStage('search-exhausted-coarse');
        return findPath(game, unit, target, stopWithinAttackRange, deadline, fineStep);
      }
      recordStage('search-exhausted');
      return [];
    }
    const gridPath = [];
    let cursor = found;
    while (cursor) {
      gridPath.push({ x: cursor.x * step, y: cursor.y * step });
      cursor = cameFrom.get(cursor.key);
    }
    gridPath.reverse();
    if (Math.hypot(gridPath[0].x - unit.x, gridPath[0].y - unit.y) > 0.5)
      gridPath.unshift({ x: unit.x, y: unit.y });
    else gridPath[0] = { x: unit.x, y: unit.y };

    const smoothed = [gridPath[0]];
    let anchor = 0;
    while (anchor < gridPath.length - 1) {
      if (timedOut()) return retryAtFineResolution();
      let next = gridPath.length - 1;
      while (next > anchor && !game.isPathSegmentClear(gridPath[anchor], gridPath[next], unit, ignoredTroops)) {
        if (timedOut()) return retryAtFineResolution();
        next -= 1;
      }
      if (next === anchor)
        return step > fineStep ? findPath(game, unit, target, stopWithinAttackRange, deadline, fineStep) : [];
      smoothed.push(gridPath[next]);
      anchor = next;
    }
    return smoothed;
  
}

export function isPathSegmentClear(game, from, to, unit, ignoredTroops = [unit]) {

    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / 5));
    const movementType = unit.stats.movementType || 'ground';
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      if (game.isBlockedByTerrain(x, y, unit.collisionRadius, movementType)) return false;
    }
    return true;
  
}

export function resolveDeploymentPushes(game, deployed = []) {
  const units = game.board.troops.filter((troop) => troop.hp > 0 && !troop.burrowed);
  const contactChain = new Set(deployed);
  const legalPosition = (unit, x, y) =>
    x >= unit.collisionRadius &&
    x <= game.board.width - unit.collisionRadius &&
    y >= unit.collisionRadius &&
    y <= game.board.height - unit.collisionRadius &&
    !game.isBlockedByTerrain(x, y, unit.collisionRadius, unit.stats.movementType || 'ground');
  const canDisplaceTo = (unit, x, y) => legalPosition(unit, x, y) &&
    game.isPathSegmentClear(
      { x: unit.x, y: unit.y },
      { x, y },
      unit,
      units,
    );
  const trySeparatePair = (a, b, normal, overlap) => {
    const massA = Math.max(0.1, Number(a.stats.mass) || 1);
    const massB = Math.max(0.1, Number(b.stats.mass) || 1);
    const shareA = massB / (massA + massB);
    const shareB = massA / (massA + massB);
    const distance = overlap + 0.5;
    const directions = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6].map((turn) => {
      const angle = Math.atan2(normal.y, normal.x) + turn * Math.PI / 12;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    });
    for (const direction of directions) {
      const aFull = { x: a.x - direction.x * distance, y: a.y - direction.y * distance };
      const bFull = { x: b.x + direction.x * distance, y: b.y + direction.y * distance };
      const aCanMove = !a.stats.isBuilding && canDisplaceTo(a, aFull.x, aFull.y);
      const bCanMove = !b.stats.isBuilding && canDisplaceTo(b, bFull.x, bFull.y);
      if (!aCanMove && !bCanMove) continue;

      let nextA;
      let nextB;
      if (aCanMove && bCanMove) {
        const weightedA = { x: a.x - direction.x * distance * shareA, y: a.y - direction.y * distance * shareA };
        const weightedB = { x: b.x + direction.x * distance * shareB, y: b.y + direction.y * distance * shareB };
        const weightedACanMove = canDisplaceTo(a, weightedA.x, weightedA.y);
        const weightedBCanMove = canDisplaceTo(b, weightedB.x, weightedB.y);
        if (weightedACanMove && weightedBCanMove) {
          nextA = weightedA;
          nextB = weightedB;
        } else if (weightedACanMove) {
          nextA = aFull;
          nextB = { x: b.x, y: b.y };
          if (!canDisplaceTo(a, nextA.x, nextA.y)) continue;
        } else if (weightedBCanMove) {
          nextA = { x: a.x, y: a.y };
          nextB = bFull;
          if (!canDisplaceTo(b, nextB.x, nextB.y)) continue;
        } else {
          continue;
        }
      } else if (aCanMove) {
        nextA = aFull;
        nextB = { x: b.x, y: b.y };
      } else {
        nextA = { x: a.x, y: a.y };
        nextB = bFull;
      }
      const changedA = Math.hypot(nextA.x - a.x, nextA.y - a.y) > 0.01;
      const changedB = Math.hypot(nextB.x - b.x, nextB.y - b.y) > 0.01;
      if (!changedA && !changedB) continue;
      a.x = nextA.x;
      a.y = nextA.y;
      b.x = nextB.x;
      b.y = nextB.y;
      if (changedA) contactChain.add(a);
      if (changedB) contactChain.add(b);
      return true;
    }
    return false;
  };

  // Propagate only through pairs that physically overlap after the prior
  // correction. Units outside this contact graph are never moved.
  for (let pass = 0; pass < Math.max(8, units.length * 2); pass++) {
    let changed = false;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        if ((a.stats.movementType || 'ground') !== (b.stats.movementType || 'ground')) continue;
        if (!contactChain.has(a) && !contactChain.has(b)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const minimum = a.collisionRadius + b.collisionRadius;
        const overlap = minimum - distance;
        if (overlap <= 0.01) continue;
        const normal = distance > 0.01
          ? { x: dx / distance, y: dy / distance }
          : (() => {
              const angle = ((a.team * 97 + i * 31 + j * 17) % 360) * Math.PI / 180;
              return { x: Math.cos(angle), y: Math.sin(angle) };
            })();
        if (trySeparatePair(a, b, normal, overlap)) changed = true;
      }
    }
    if (!changed) break;
  }
}

export function resolveMovementCollisions(game, movedThisFrame = null, startPositions = null) {
  const units = game.board.troops.filter((troop) => troop.hp > 0 && !troop.burrowed);
  solveCrowdDisplacements(game, units, startPositions, movedThisFrame);
}

export function canMoveSegment(game, from, to, unit ) {

    const dx = to.x - from.x,
      dy = to.y - from.y,
      distance = Math.hypot(dx, dy);
    const steps = Math.ceil(distance / 6);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        x = from.x + dx * t,
        y = from.y + dy * t;
      if (game.isBlockedByTerrain(x, y, unit.collisionRadius, unit.stats.movementType || 'ground'))
        return false;
    }
    return true;
  
}

export function moveAutomatically(game, unit, target, stopWhenInAttackRange, enemies, deadline = Infinity) {

    if (!target || target.hp <= 0 || unit.stunned) return [];
    let path;
    try {
      path = game.findPath(unit, target, stopWhenInAttackRange, deadline);
    } catch (error) {
      game.recordMovementDiagnostic?.('pathfinding-exception', unit, { error: String(error?.stack || error) });
      console.error('Automatic pathfinding failed:', error);
      return [];
    }
    if (!path.length) {
      game.recordMovementDiagnostic?.(
        monotonicNow() >= deadline ? 'path-timeout' : 'no-path',
        unit,
        {
          target: target.stats?.name || target.name || target.type ||
            (target.layer ? `${target.layer} turret` : target.radius ? 'arena structure' : `unit at ${Math.round(target.x)},${Math.round(target.y)}`),
          targetX: target.x,
          targetY: target.y,
        },
      );
      return [];
    }
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
      const ignoredOnPath = game.board.troops.includes(target) ? [unit, target] : [unit];
      if (
        !game.isPathSegmentClear({ x: unit.x, y: unit.y }, candidate, unit, ignoredOnPath) ||
        game.isBlockedByTerrain(
          candidate.x,
          candidate.y,
          unit.collisionRadius,
          unit.stats.movementType || 'ground',
        )
      )
        break;
      unit.validateFocus(enemies);
      if (unit.focus) {
        const structureRadius = unit.focus.type === 'base' || unit.focus.layer ? unit.focus.radius : 0;
        const oldDistance = unit.attackDistanceTo(unit.focus);
        const targetRadius = structureRadius || unit.focus.collisionRadius || RADIUS_PER_SIZE;
        const newDistance = Math.max(
          0,
          Math.hypot(candidate.x - unit.focus.x, candidate.y - unit.focus.y) - targetRadius - unit.collisionRadius,
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
          .some((enemy) => enemy.hp > 0 && unit.distanceToEdge(enemy) <= unit.sightRange);
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
        const structureRadius = target.type === 'base' || target.layer ? target.radius : 0;
        const desiredDist =
          structureRadius > 0
            ? structureRadius + unit.collisionRadius + Math.max(2, unit.attackRange - 4)
            : Math.max(2, unit.attackRange + unit.collisionRadius + (target.collisionRadius || RADIUS_PER_SIZE) - 1);
        if (dist > desiredDist) {
          const maxMove = Math.min(dist - desiredDist, unit.availableMovement);
          const dir = { x: dx / dist, y: dy / dist };
          let low = 0;
          let high = maxMove;
          let best = null;
          for (let s = 0; s < 12; s++) {
            const mid = (low + high) / 2;
            const testPt = { x: unit.x + dir.x * mid, y: unit.y + dir.y * mid };
            if (game.canMoveSegment(unit, testPt, unit)) {
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
