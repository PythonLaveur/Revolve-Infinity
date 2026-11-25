import { HERO_STATS } from '../data/stats/reby.js';
export { HERO_STATS };
import { Troop, aggroAdjustedDistance } from '../units/troop.js';
import { applyResistance, scaleDamage } from '../units/damage.js';

export const heroId = 'reby';

export function spawnRebyDrone(game, reby, target) {
    const droneData = reby.stats.droneStats;
    const { hpFraction, damageMultiplier, splashRadius, waveSize, ...droneStats } = droneData;
    const stats = {
      ...droneStats,
      hp: Math.round(reby.stats.hp * hpFraction),
      atk: reby.stats.atk,
    };
    const dx = target.x - reby.x;
    const dy = target.y - reby.y;
    const distance = Math.hypot(dx, dy) || 1;
    const droneRadius = game.collisionRadiusForStats(stats);
    const forward = { x: dx / distance, y: dy / distance };
    const side = { x: -forward.y, y: forward.x };
    const index = reby.droneWaveIndex || 0;
    const lane = (index % 3) - 1;
    const spawn = {
      x: Math.max(
        droneRadius,
        Math.min(game.board.width - droneRadius, reby.x + forward.x * 48 + side.x * lane * 30),
      ),
      y: Math.max(
        droneRadius,
        Math.min(game.board.height - droneRadius, reby.y + forward.y * 48 + side.y * lane * 30),
      ),
    };
    reby.droneWaveIndex = index + 1;
    const drone = new Troop(stats, reby.team, spawn.x, spawn.y);
    drone.summonedBy = reby;
    drone.isDrone = true;
    drone.isMinion = true;
    drone.stunned = false;
    drone.ac = 0;
    drone.droneTarget = target;
    drone.droneDamage = Math.round(reby.stats.atk * damageMultiplier);
    drone.droneDamageType = 'magic';
    drone.droneSplashRadius = splashRadius;
    drone.facing = Math.atan2(forward.y, forward.x);
    game.addTroop(drone);
    return drone;
  
}

export function droneTarget(game, drone) {

    const enemies = [
      ...game.board.troops.filter((unit) => unit.team !== drone.team && unit.hp > 0 && !unit.burrowed),
      ...game.board.turrets.filter((unit) => unit.team !== drone.team && unit.hp > 0),
      ...game.board.towers.filter((unit) => unit.team !== drone.team && unit.hp > 0),
    ];
    if (!drone.droneTarget || drone.droneTarget.hp <= 0 || !enemies.includes(drone.droneTarget)) {
      drone.droneTarget =
        enemies
          .filter((enemy) => enemy.hp > 0)
          .sort((a, b) => aggroAdjustedDistance(drone, a) - aggroAdjustedDistance(drone, b))[0] || null;
    }
    if (drone.droneTarget !== drone.rushTarget) {
      drone.rushTarget = null;
      drone.isUntargetable = false;
    }
    return drone.droneTarget;
  
}

export function finishDroneMovement(game, drone) {

    const target = drone.rushTarget || droneTarget(game, drone);
    if (!target) {
      drone.hp = 0;
      drone.detonateOnArrival = false;
      return;
    }
    if (drone.distanceToEdge(target) > 2) {
      drone.detonateOnArrival = false;
      return;
    }
    const enemies = game.board.enemyTargets(drone.team);
    const blastTargets = enemies.filter(
      (enemy) => enemy.hp > 0 && drone.distanceTo(enemy) <= drone.droneSplashRadius + (enemy.radius || enemy.collisionRadius || 0),
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
      game.applyDamage(blastTarget, damage, drone, {
        damageType: drone.droneDamageType,
        mitigationRatio: drone.droneDamage > 0 ? Math.max(0, Math.min(1, damage / drone.droneDamage)) : 1,
      });
    }
    game.board.impacts.push({
      x: drone.x,
      y: drone.y,
      radius: drone.droneSplashRadius,
      duration: 0.45,
      remainingSeconds: 0.45,
      kind: 'drone-explosion',
      team: drone.team,
    });
    game.addEvent(
      `${game.teamName(drone.team)} kamikaze drone explodes for ${blastTargets.length} magic hit${blastTargets.length === 1 ? '' : 's'}.`,
      drone.team,
    );
    drone.hp = 0;
    drone.isUntargetable = false;
    drone.detonateOnArrival = false;
    game.resolveStructureOutcomes();
  
}

export function planDroneMovement(game, drone) {

    const target = droneTarget(game, drone);
    if (!target) {
      drone.hp = 0;
      return null;
    }
    const dx = target.x - drone.x;
    const dy = target.y - drone.y;
    if (!drone.rushTarget && drone.distanceToEdge(target) <= drone.attackRange) {
      drone.rushTarget = target;
      drone.isUntargetable = true;
    }
    const committedTarget = drone.rushTarget || target;
    const rushDx = committedTarget.x - drone.x;
    const rushDy = committedTarget.y - drone.y;
    const rushDistance = Math.hypot(rushDx, rushDy);
    if (drone.distanceToEdge(committedTarget) <= 2) {
      finishDroneMovement(game, drone);
      return null;
    }
    const targetRadius = committedTarget.radius || committedTarget.collisionRadius || 0;
    const detonationDistance = targetRadius + drone.collisionRadius + 2;
    const moved = Math.min(drone.movementRemaining, Math.max(0, rushDistance - detonationDistance));
    const startX = drone.x;
    const startY = drone.y;
    drone.facing = Math.atan2(rushDy, rushDx);
    drone.x += (rushDx / rushDistance) * moved;
    drone.y += (rushDy / rushDistance) * moved;
    drone.movementRemaining -= moved;
    drone.detonateOnArrival = rushDistance - moved <= detonationDistance;
    return { startX, startY, waypoints: [{ x: drone.x, y: drone.y }] };
  
}

export function summonBuilding(game, team, x, y, role, caster, ability) {
    const template = caster.stats.foundryBuildings[role];
    const stats = {
      ...template,
      hp: scaleDamage(caster.stats, ability.buildingHealthScaling || {}),
      buildingLifetimeTurns: ability.buildingLifetimeTurns,
      spawnRole: role,
      spawnIntervalTurns: ability.spawnIntervalTurns || 4,
      spawnedHp: scaleDamage(caster.stats, ability.spawnedHpScaling || {}),
      spawnedAtk: scaleDamage(caster.stats, ability.spawnedAtkScaling || {}),
      spawnedUnitStats: caster.stats.foundryUnits,
    };
    const position = game.findPlacementPosition(team, x, y, stats);
    if (!position) return null;
    const building = new Troop(stats, team, position.x, position.y);
    building.summonedBy = caster;
    building.stunned = false;
    building.isSummon = true;
    building.spawnTurns = ability.spawnIntervalTurns || 4;
    game.addTroop(building);
    return building;
  
}
export function placeSummonedBuilding(game, caster, ability, x, y) {
  return summonBuilding(game, caster.team, x, y, ability.summonBuilding, caster, ability);
}
export function castAbility(game, caster, ability, context) {
  if (!ability.summonBuilding) return null;
  placeSummonedBuilding(game, caster, ability, context.x, context.y);
  return { handled: true };
}

export function spawnFoundryTroop(game, building) {
    const ranged = building.stats.spawnRole === 'ranged';
    const template = building.stats.spawnedUnitStats[ranged ? 'ranged' : 'melee'];
    const stats = {
      ...template,
      hp: building.stats.spawnedHp,
      atk: building.stats.spawnedAtk,
      color: building.team === 0 ? '#55e1dd' : '#ff6978',
    };
    const enemy = game.board
      .enemyTargets(building.team)
      .filter((target) => target.hp > 0)
      .sort((a, b) => aggroAdjustedDistance(building, a) - aggroAdjustedDistance(building, b))[0];
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
        const collisionRadius = game.collisionRadiusForStats(stats);
        if (
          candidate.x < collisionRadius ||
          candidate.x > game.board.width - collisionRadius ||
          candidate.y < collisionRadius ||
          candidate.y > game.board.height - collisionRadius
        )
          continue;
        if (
          game.isBlockedByTerrain(candidate.x, candidate.y, collisionRadius, 'ground')
        )
          continue;
        position = candidate;
        break;
      }
      if (position) break;
    }
    if (!position) return false;
    const troop = new Troop(stats, building.team, position.x, position.y);
    troop.summonedBy = building.summonedBy;
    troop.stunned = false;
    troop.facing = angleToEnemy;
    game.addTroop(troop);
    return true;
  
}

export function onBuildingTurn(game, building) {
  if (building.stats.spawnRole) {
    building.spawnTurns -= 1;
    if (building.spawnTurns <= 0) {
      building.spawnTurns = spawnFoundryTroop(game, building)
        ? building.stats.spawnIntervalTurns
        : 1;
    }
    return true;
  }
  if (building.stats.id !== heroId) return false;
  building.spawnTurns -= 1;
  if (building.spawnTurns <= 0) {
    const target = game.board
      .enemyTargets(building.team)
      .filter((enemy) => enemy.hp > 0)
      .sort((a, b) => aggroAdjustedDistance(building, a) - aggroAdjustedDistance(building, b))[0];
    if (target) {
      const waveSize = building.stats.droneStats.waveSize;
      for (let i = 0; i < waveSize; i++) spawnRebyDrone(game, building, target);
      game.addEvent(`${game.teamName(building.team)} Reby launches ${waveSize} kamikaze drones.`, building.team);
    }
    building.spawnTurns = building.stats.spawnIntervalTurns;
  }
  return true;
}

export function spawnBuildingUnit(game, building) { return spawnFoundryTroop(game, building); }
export function planTurnMovement(game, unit, deadline) {
  if (!unit.isDrone) return null;
  const movement = planDroneMovement(game, unit, deadline);
  return { handled: true, waypoints: movement?.waypoints || [] };
}
export function onFrameUpdate(game, drone, moveStep) {
  if (!drone.isDrone) return false;
  if (drone.hp > 0 && drone.isMoving()) {
    drone.updateMovement(moveStep);
    if (!drone.isMoving() && drone.detonateOnArrival) finishDroneMovement(game, drone);
  }
  return true;
}

export default function createHeroBehavior() {
  return {
    heroId,
    castAbility,
    onBuildingTurn,
    spawnBuildingUnit,
    planTurnMovement,
    onFrameUpdate,
  };
}
