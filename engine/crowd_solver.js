// Global weighted projection of all frame intents onto collision constraints.
// Hildreth's dual coordinate method solves the convex quadratic projection
// without introducing a runtime solver dependency.
const EPSILON = 1e-8;
const MAX_SWEEPS = 96;

export function solveCrowdDisplacements(game, units, startPositions, movingUnits) {
  const active = units.filter((unit) => !unit.stats.isBuilding && unit.hp > 0 && !unit.burrowed);
  if (!active.length) return;

  const dimensions = active.length * 2;
  const preferred = new Float64Array(dimensions);
  const weights = new Float64Array(dimensions);
  for (let i = 0; i < active.length; i++) {
    const unit = active[i];
    const start = startPositions?.get(unit) || { x: unit.x, y: unit.y };
    preferred[2 * i] = movingUnits?.has(unit) ? unit.x - start.x : 0;
    preferred[2 * i + 1] = movingUnits?.has(unit) ? unit.y - start.y : 0;
    const mass = Math.max(0.1, Number(unit.stats.mass) || 1);
    const force = Math.max(0, Number(unit.stats.force) || 0);
    const effectiveMass = mass / (1 + force / 100);
    weights[2 * i] = effectiveMass;
    weights[2 * i + 1] = effectiveMass;
  }
  const constraints = [];
  const add = (terms, lowerBound) => {
    let norm = 0;
    for (const [index, coefficient] of terms) norm += coefficient * coefficient / weights[index];
    if (norm > EPSILON) constraints.push({ terms, lowerBound, norm, multiplier: 0 });
  };

  // Arena walls are hard constraints on final centers.
  for (let i = 0; i < active.length; i++) {
    const unit = active[i];
    const start = startPositions?.get(unit) || { x: unit.x, y: unit.y };
    const radius = unit.collisionRadius;
    add([[2 * i, 1]], radius - start.x);
    add([[2 * i, -1]], start.x - (game.board.width - radius));
    add([[2 * i + 1, 1]], radius - start.y);
    add([[2 * i + 1, -1]], start.y - (game.board.height - radius));
  }

  // Preserve pair separation along the normal at the start of this frame.
  // This is a conservative swept-contact constraint and propagates pushes
  // through the whole crowd in one simultaneous solve.
  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    const pA = startPositions?.get(a) || { x: a.x, y: a.y };
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j];
      if ((a.stats.movementType || 'ground') !== (b.stats.movementType || 'ground')) continue;
      const pB = startPositions?.get(b) || { x: b.x, y: b.y };
      let dx = pB.x - pA.x;
      let dy = pB.y - pA.y;
      let distance = Math.hypot(dx, dy);
      if (distance < EPSILON) {
        const angle = ((i * 37 + j * 71) % 360) * Math.PI / 180;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 0;
      }
      const nx = distance ? dx / distance : dx;
      const ny = distance ? dy / distance : dy;
      const gap = a.collisionRadius + b.collisionRadius - distance;
      add([
        [2 * i, -nx], [2 * i + 1, -ny],
        [2 * j, nx], [2 * j + 1, ny],
      ], gap);
    }
  }

  // Fixed circles include arena towers and immovable summoned buildings.
  const obstacles = [
    ...game.board.turrets.filter((item) => item.hp > 0),
    ...game.board.towers.filter((item) => item.hp > 0),
    ...units.filter((item) => item.stats.isBuilding && item.hp > 0),
    ...game.board.terrains.filter((item) => item.type === 'rock').map((item) => ({ ...item, radius: item.r })),
  ];
  for (let i = 0; i < active.length; i++) {
    const unit = active[i];
    const p = startPositions?.get(unit) || { x: unit.x, y: unit.y };
    const hasClearIntent = movingUnits?.has(unit) && game.isPathSegmentClear(
      p,
      { x: unit.x, y: unit.y },
      unit,
      units,
    );
    // A tangent half-space around a circle is conservative. It can forbid a
    // perfectly clear curved route around a tower, so trust a clear pathfinder
    // segment here and validate the final crowd-adjusted position below.
    if (hasClearIntent) continue;
    for (let oi = 0; oi < obstacles.length; oi++) {
      const obstacle = obstacles[oi];
      if ((obstacle.stats?.movementType || 'ground') !== (unit.stats.movementType || 'ground')) continue;
      let dx = p.x - obstacle.x;
      let dy = p.y - obstacle.y;
      let distance = Math.hypot(dx, dy);
      if (distance < EPSILON) {
        const angle = ((i * 53 + oi * 29) % 360) * Math.PI / 180;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 0;
      }
      const nx = distance ? dx / distance : dx;
      const ny = distance ? dy / distance : dy;
      const radius = obstacle.radius || obstacle.collisionRadius || 0;
      add([[2 * i, nx], [2 * i + 1, ny]], unit.collisionRadius + radius - distance);
    }
    const forbiddenRiver = [];
    const river = game.board.river;
    let y = river.y;
    for (const bridge of [...game.board.bridges].sort((a, b) => a.y - b.y)) {
      if (bridge.y > y) forbiddenRiver.push({ x: river.x, y, w: river.w, h: bridge.y - y });
      y = Math.max(y, bridge.y + bridge.h);
    }
    if (river.y + river.h > y)
      forbiddenRiver.push({ x: river.x, y, w: river.w, h: river.y + river.h - y });
    const rectangles = [
      ...forbiddenRiver,
      ...game.board.terrains.filter((terrain) => terrain.type !== 'rock'),
    ];
    for (const rect of rectangles) {
      const left = rect.x - unit.collisionRadius;
      const right = rect.x + rect.w + unit.collisionRadius;
      const top = rect.y - unit.collisionRadius;
      const bottom = rect.y + rect.h + unit.collisionRadius;
      if (p.x > left && p.x < right && p.y > top && p.y < bottom) continue;
      const qx = Math.max(left, Math.min(right, p.x));
      const qy = Math.max(top, Math.min(bottom, p.y));
      let dx = p.x - qx;
      let dy = p.y - qy;
      let distance = Math.hypot(dx, dy);
      if (distance < EPSILON) continue;
      dx /= distance;
      dy /= distance;
      add([[2 * i, dx], [2 * i + 1, dy]], -distance);
    }
  }

  // Minimize weighted deviation from the pathfinder's frame intentions.
  // Each dual update is an exact coordinate minimization for one half-space.
  let converged = false;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let maxViolation = 0;
    for (const constraint of constraints) {
      let projection = 0;
      for (const [index, coefficient] of constraint.terms)
        projection += coefficient * preferred[index];
      const violation = constraint.lowerBound - projection;
      const nextMultiplier = Math.max(0, constraint.multiplier + violation / constraint.norm);
      const change = nextMultiplier - constraint.multiplier;
      if (change) {
        for (const [index, coefficient] of constraint.terms)
          preferred[index] += change * coefficient / weights[index];
        constraint.multiplier = nextMultiplier;
      }
      maxViolation = Math.max(maxViolation, Math.max(0, constraint.lowerBound - projection));
    }
    if (maxViolation < 0.05) {
      converged = true;
      break;
    }
  }

  let maxFinalViolation = 0;
  for (const constraint of constraints) {
    let projection = 0;
    for (const [index, coefficient] of constraint.terms) projection += coefficient * preferred[index];
    maxFinalViolation = Math.max(maxFinalViolation, constraint.lowerBound - projection);
  }
  if (maxFinalViolation > 0.1) {
    game.recordMovementDiagnostic?.('crowd-solver-infeasible', null, {
      maxViolation: Number(maxFinalViolation.toFixed(3)),
      constraints: constraints.length,
    });
    for (const unit of active) {
      const start = startPositions?.get(unit);
      if (start) { unit.x = start.x; unit.y = start.y; }
    }
    return false;
  }
  for (let i = 0; i < active.length; i++) {
    const unit = active[i];
    const start = startPositions?.get(unit) || { x: unit.x, y: unit.y };
    const candidate = { x: start.x + preferred[2 * i], y: start.y + preferred[2 * i + 1] };
    if (
      game.isPathSegmentClear(start, candidate, unit, units) &&
      !game.isBlockedByTerrain(candidate.x, candidate.y, unit.collisionRadius, unit.stats.movementType || 'ground')
    ) {
      unit.x = candidate.x;
      unit.y = candidate.y;
    } else {
      unit.x = start.x;
      unit.y = start.y;
      if (movingUnits?.has(unit))
        game.recordMovementDiagnostic?.('crowd-solver-terrain-block', unit);
    }
  }
  if (!converged && constraints.length)
    game.recordMovementDiagnostic?.('crowd-solver-iteration-limit', null, { constraints: constraints.length });
  return true;
}
