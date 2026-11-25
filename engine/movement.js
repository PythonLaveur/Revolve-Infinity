import { RADIUS_PER_SIZE } from '../units/stats.js';
import { solveCrowdDisplacements } from './crowd_solver.js';

const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();
export function findPath(game, unit, target, stopWithinAttackRange = false, deadline = Infinity) {

    if (!target) return [];
    const timedOut = () => deadline !== Infinity && monotonicNow() >= deadline;
    if (timedOut()) return [];
    const step = 20,
      cols = Math.ceil(game.board.width / step),
      rows = Math.ceil(game.board.height / step);
    const key = (x, y) => `${x},${y}`;
    // Dynamic units are pushed during physical movement. They must never turn
    // a valid terrain route into a false no-path result during planning.
    const ignoredTroops = game.board.troops;
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
          worldX >= unit.collisionRadius && worldX <= game.board.width - unit.collisionRadius &&
          worldY >= unit.collisionRadius && worldY <= game.board.height - unit.collisionRadius &&
          !game.isBlockedByTerrain(worldX, worldY, unit.collisionRadius, movementType)
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
        segmentCache.set(cacheKey, game.isPathSegmentClear(from, to, unit, ignoredTroops));
      return segmentCache.get(cacheKey);
    };
    const structureRadius = target.type === 'base' || target.layer ? target.radius : 0;
    const approachDistance =
      structureRadius > 0
        ? stopWithinAttackRange
          ? structureRadius + unit.collisionRadius + Math.max(2, unit.attackRange - 4)
          : Math.max(
              structureRadius + unit.collisionRadius + 2,
              structureRadius + unit.collisionRadius + unit.sightRange - 4,
            )
        : stopWithinAttackRange
          ? unit.attackRange + unit.collisionRadius + (target.collisionRadius || RADIUS_PER_SIZE) - 1
          : Math.max(2, unit.sightRange + unit.collisionRadius + (target.collisionRadius || RADIUS_PER_SIZE) - 4);
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
        !game.isPathSegmentClear(gridPath[anchor], gridPath[next], unit, ignoredTroops)
      ) {
        if (timedOut()) return [];
        next -= 1;
      }
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
  const deployedSet = new Set(deployed);
  const displaced = new Set(deployed);
  const canMove = (unit) => !unit.stats.isBuilding;
  const legalPosition = (unit, x, y) =>
    x >= unit.collisionRadius &&
    x <= game.board.width - unit.collisionRadius &&
    y >= unit.collisionRadius &&
    y <= game.board.height - unit.collisionRadius &&
    !game.isBlockedByTerrain(x, y, unit.collisionRadius, unit.stats.movementType || 'ground');
  const separatedPoint = (unit, other, preferredAngle) => {
    const minDistance = unit.collisionRadius + other.collisionRadius + 0.5;
    for (let step = 0; step < 24; step++) {
      const turn = step === 0 ? 0 : Math.ceil(step / 2) * (step % 2 ? 1 : -1);
      const angle = preferredAngle + turn * (Math.PI / 12);
      const x = other.x + Math.cos(angle) * minDistance;
      const y = other.y + Math.sin(angle) * minDistance;
      if (legalPosition(unit, x, y)) return { x, y };
    }
    return null;
  };
  for (let pass = 0; pass < 14; pass++) {
    let changed = false;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        if ((a.stats.movementType || 'ground') !== (b.stats.movementType || 'ground')) continue;
        if (!displaced.has(a) && !displaced.has(b)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const minDistance = a.collisionRadius + b.collisionRadius;
        if (distance >= minDistance) continue;
        const angle = distance > 0.01
          ? Math.atan2(dy, dx)
          : (((a.team + b.team + i * 13 + j * 7) % 360) * Math.PI) / 180;
        const aIsNew = deployedSet.has(a);
        const bIsNew = deployedSet.has(b);
        let first = a;
        let firstAngle = angle + Math.PI;
        let second = b;
        let secondAngle = angle;
        if (aIsNew && !bIsNew) {
          first = b;
          firstAngle = angle;
          second = a;
          secondAngle = angle + Math.PI;
        } else if (bIsNew && !aIsNew) {
          first = a;
          firstAngle = angle + Math.PI;
          second = b;
          secondAngle = angle;
        } else if (!displaced.has(a) && displaced.has(b)) {
          first = a;
          firstAngle = angle + Math.PI;
          second = b;
          secondAngle = angle;
        } else if (displaced.has(a) && !displaced.has(b)) {
          first = b;
          firstAngle = angle;
          second = a;
          secondAngle = angle + Math.PI;
        }
        const push = (unit, other, direction) => {
          if (!canMove(unit)) return false;
          const point = separatedPoint(unit, other, direction);
          if (!point) return false;
          unit.x = point.x;
          unit.y = point.y;
          displaced.add(unit);
          return true;
        };
        if (push(first, second, firstAngle) || push(second, first, secondAngle)) changed = true;
      }
    }
    if (!changed) break;
  }
  // If a crowd or terrain edge prevents the normal push chain, move the
  // colliding troop to the nearest legal open position instead of leaving it
  // intersecting another unit or structure.
  const findOpenPosition = (unit) => {
    if (!canMove(unit)) return null;
    const step = Math.max(6, unit.collisionRadius * 0.75);
    for (let distance = step; distance <= Math.max(game.board.width, game.board.height); distance += step) {
      for (let i = 0; i < 32; i++) {
        const angle = (Math.PI * 2 * i) / 32;
        const x = unit.x + Math.cos(angle) * distance;
        const y = unit.y + Math.sin(angle) * distance;
        if (!legalPosition(unit, x, y)) continue;
        if (units.some((other) => other !== unit &&
          (other.stats.movementType || 'ground') === (unit.stats.movementType || 'ground') &&
          Math.hypot(other.x - x, other.y - y) < unit.collisionRadius + other.collisionRadius)) continue;
        return { x, y };
      }
    }
    return null;
  };
  for (let pass = 0; pass < units.length; pass++) {
    let overlap = null;
    for (let i = 0; i < units.length && !overlap; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        if ((a.stats.movementType || 'ground') !== (b.stats.movementType || 'ground')) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.collisionRadius + b.collisionRadius) {
          overlap = [a, b];
          break;
        }
      }
    }
    if (!overlap) break;
    const [a, b] = overlap;
    const candidates = [a, b].sort((left, right) =>
      Number(deployedSet.has(left)) - Number(deployedSet.has(right)) ||
      Number(Boolean(left.stats.isBuilding)) - Number(Boolean(right.stats.isBuilding)));
    let moved = false;
    for (const unit of candidates) {
      const point = findOpenPosition(unit);
      if (!point) continue;
      unit.x = point.x;
      unit.y = point.y;
      moved = true;
      break;
    }
    if (!moved) break;
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
