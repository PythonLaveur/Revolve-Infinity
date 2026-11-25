// Simultaneous crowd movement with refreshed nonlinear contact normals.
// Movement intentions are advanced in short substeps; each contact iteration
// computes all corrections from the same positions and applies them together.
const EPSILON = 1e-7;
const SUBSTEPS = 5;
const CONTACT_ITERATIONS = 28;
const RELAXATION = 0.8;
const CONTACT_SLOP = 0.25;

const effectiveMass = (unit) => {
  const mass = Math.max(0.1, Number(unit.stats.mass) || 1);
  const force = Math.max(0, Number(unit.stats.force) || 0);
  return mass / (1 + force / 100);
};

function directionForCoincident(aIndex, bIndex, team = 0) {
  const angle = ((aIndex * 37 + bIndex * 71 + team * 19) % 360) * Math.PI / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function staticRectangles(game) {
  return game.board.terrains.filter((terrain) => terrain.type !== 'rock');
}

function riverCenterObstacles(game, radius) {
  const result = [];
  const river = game.board.river;
  const left = river.x - radius;
  const right = river.x + river.w + radius;
  const top = river.y - radius;
  const bottom = river.y + river.h + radius;
  let cursorY = river.y;
  for (const bridge of [...game.board.bridges].sort((a, b) => a.y - b.y)) {
    if (bridge.y > cursorY)
      result.push({ x: left, y: Math.max(top, cursorY), w: right - left, h: bridge.y - cursorY, preExpanded: true });
    const bridgeTop = Math.max(top, bridge.y);
    const bridgeBottom = Math.min(bottom, bridge.y + bridge.h);
    if (bridgeBottom > bridgeTop) {
      if (bridge.x > left)
        result.push({ x: left, y: bridgeTop, w: bridge.x - left, h: bridgeBottom - bridgeTop, preExpanded: true });
      if (bridge.x + bridge.w < right)
        result.push({ x: bridge.x + bridge.w, y: bridgeTop, w: right - bridge.x - bridge.w, h: bridgeBottom - bridgeTop, preExpanded: true });
    }
    cursorY = Math.max(cursorY, bridge.y + bridge.h);
  }
  if (river.y + river.h > cursorY)
    result.push({ x: left, y: Math.max(top, cursorY), w: right - left, h: bottom - Math.max(top, cursorY), preExpanded: true });
  return result;
}

export function solveCrowdDisplacements(game, units, startPositions, movingUnits) {
  const movable = units.filter((unit) => !unit.stats.isBuilding && unit.hp > 0 && !unit.burrowed);
  if (!movable.length) return;

  const intents = new Map();
  for (const unit of movable) {
    const start = startPositions?.get(unit) || { x: unit.x, y: unit.y };
    const intended = movingUnits?.has(unit) ? { x: unit.x, y: unit.y } : start;
    intents.set(unit, { x: intended.x - start.x, y: intended.y - start.y });
    unit.x = start.x;
    unit.y = start.y;
  }

  const obstacles = [
    ...game.board.turrets.filter((obstacle) => obstacle.hp > 0),
    ...game.board.towers.filter((obstacle) => obstacle.hp > 0),
    ...units.filter((obstacle) => obstacle.stats.isBuilding && obstacle.hp > 0),
    ...game.board.terrains.filter((obstacle) => obstacle.type === 'rock')
      .map((obstacle) => ({ ...obstacle, radius: obstacle.r })),
  ];
  const rectangles = staticRectangles(game);
  const inverseMass = new Map(movable.map((unit) => [unit, 1 / effectiveMass(unit)]));

  for (let substep = 0; substep < SUBSTEPS; substep++) {
    for (const unit of movable) {
      const intent = intents.get(unit);
      unit.x += intent.x / SUBSTEPS;
      unit.y += intent.y / SUBSTEPS;
    }

    for (let iteration = 0; iteration < CONTACT_ITERATIONS; iteration++) {
      const corrections = new Map(movable.map((unit) => [unit, { x: 0, y: 0, count: 0 }]));
      let maximumPenetration = 0;
      const addCorrection = (unit, dx, dy) => {
        const correction = corrections.get(unit);
        if (!correction) return;
        correction.x += dx;
        correction.y += dy;
        correction.count += 1;
      };

      // Unit-unit contacts: exact circle distance and a freshly computed
      // normal on every iteration lets a chain slide around curved contacts.
      for (let i = 0; i < movable.length; i++) {
        const a = movable[i];
        for (let j = i + 1; j < movable.length; j++) {
          const b = movable[j];
          if ((a.stats.movementType || 'ground') !== (b.stats.movementType || 'ground')) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distance = Math.hypot(dx, dy);
          const overlap = a.collisionRadius + b.collisionRadius - distance;
          if (overlap <= CONTACT_SLOP) continue;
          maximumPenetration = Math.max(maximumPenetration, overlap);
          const normal = distance > EPSILON ? { x: dx / distance, y: dy / distance } : directionForCoincident(i, j, a.team);
          const invA = inverseMass.get(a);
          const invB = inverseMass.get(b);
          const sum = invA + invB;
          const amount = (overlap - CONTACT_SLOP) * RELAXATION;
          addCorrection(a, -normal.x * amount * invA / sum, -normal.y * amount * invA / sum);
          addCorrection(b, normal.x * amount * invB / sum, normal.y * amount * invB / sum);
        }
      }

      // Fixed circular obstacles never move. Contact normals are recomputed
      // from the current positions instead of freezing the frame-start angle.
      for (let i = 0; i < movable.length; i++) {
        const unit = movable[i];
        for (let oi = 0; oi < obstacles.length; oi++) {
          const obstacle = obstacles[oi];
          if ((obstacle.stats?.movementType || 'ground') !== (unit.stats.movementType || 'ground')) continue;
          let dx = unit.x - obstacle.x;
          let dy = unit.y - obstacle.y;
          let distance = Math.hypot(dx, dy);
          const radius = unit.collisionRadius + (obstacle.radius || obstacle.collisionRadius || 0);
          const overlap = radius - distance;
          if (overlap <= CONTACT_SLOP) continue;
          maximumPenetration = Math.max(maximumPenetration, overlap);
          const normal = distance > EPSILON ? { x: dx / distance, y: dy / distance } : directionForCoincident(i, oi, unit.team);
          const amount = (overlap - CONTACT_SLOP) * RELAXATION;
          addCorrection(unit, normal.x * amount, normal.y * amount);
        }

        // Rectangular fixed terrain (including river banks) uses its closest
        // point; if a center is inside, choose the least-penetrating exit.
        const blockers = unit.stats.movementType === 'air'
          ? rectangles
          : [...rectangles, ...riverCenterObstacles(game, unit.collisionRadius)];
        for (const rect of blockers) {
          const padding = rect.preExpanded ? 0 : unit.collisionRadius;
          const left = rect.x - padding;
          const right = rect.x + rect.w + padding;
          const top = rect.y - padding;
          const bottom = rect.y + rect.h + padding;
          const closestX = Math.max(left, Math.min(right, unit.x));
          const closestY = Math.max(top, Math.min(bottom, unit.y));
          let dx = unit.x - closestX;
          let dy = unit.y - closestY;
          let distance = Math.hypot(dx, dy);
          let normal;
          let overlap;
          if (distance > EPSILON) {
            normal = { x: dx / distance, y: dy / distance };
            overlap = -distance;
          } else {
            const exits = [
              { distance: unit.x - left, x: -1, y: 0 },
              { distance: right - unit.x, x: 1, y: 0 },
              { distance: unit.y - top, x: 0, y: -1 },
              { distance: bottom - unit.y, x: 0, y: 1 },
            ].sort((a, b) => a.distance - b.distance);
            normal = { x: exits[0].x, y: exits[0].y };
            overlap = exits[0].distance;
          }
          if (overlap <= CONTACT_SLOP) continue;
          maximumPenetration = Math.max(maximumPenetration, overlap);
          const amount = (overlap - CONTACT_SLOP) * RELAXATION;
          addCorrection(unit, normal.x * amount, normal.y * amount);
        }

        const radius = unit.collisionRadius;
        const wallCorrections = [
          { x: Math.max(0, radius - unit.x), y: 0 },
          { x: -Math.max(0, unit.x - (game.board.width - radius)), y: 0 },
          { x: 0, y: Math.max(0, radius - unit.y) },
          { x: 0, y: -Math.max(0, unit.y - (game.board.height - radius)) },
        ];
        for (const correction of wallCorrections) {
          if (!correction.x && !correction.y) continue;
          maximumPenetration = Math.max(maximumPenetration, Math.hypot(correction.x, correction.y));
          addCorrection(unit, correction.x, correction.y);
        }
      }

      if (maximumPenetration <= CONTACT_SLOP) break;
      for (const unit of movable) {
        const correction = corrections.get(unit);
        if (!correction?.count) continue;
        // Averaging simultaneous contacts prevents a crowded unit from being
        // over-corrected by several neighbors in one iteration.
        unit.x += correction.x / Math.max(1, Math.sqrt(correction.count));
        unit.y += correction.y / Math.max(1, Math.sqrt(correction.count));
      }
    }
  }

  // Report unresolved initial overlaps or an unusually dense jam without
  // reverting the whole frame to its previous position.
  let maximumRemainingOverlap = 0;
  for (let i = 0; i < movable.length; i++) {
    const a = movable[i];
    for (let j = i + 1; j < movable.length; j++) {
      const b = movable[j];
      if ((a.stats.movementType || 'ground') !== (b.stats.movementType || 'ground')) continue;
      maximumRemainingOverlap = Math.max(
        maximumRemainingOverlap,
        a.collisionRadius + b.collisionRadius - Math.hypot(a.x - b.x, a.y - b.y),
      );
    }
  }
  if (maximumRemainingOverlap > 1)
    game.recordMovementDiagnostic?.('crowd-contact-iteration-limit', null, {
      maxOverlap: Number(maximumRemainingOverlap.toFixed(2)),
    });
}
