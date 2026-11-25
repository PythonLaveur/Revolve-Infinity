import { GAME_PARAMS } from '../data/game_parameters.js';

export const ARENA_TILE_SIZE = GAME_PARAMS.arena.tileSize;
export const RADIUS_PER_SIZE = ARENA_TILE_SIZE / 2;

export function collisionRadiusOf(target) {
  return target?.radius ?? target?.collisionRadius ?? (target?.stats ? RADIUS_PER_SIZE : 0);
}

export function edgeDistanceBetween(source, target) {
  return Math.max(
    0,
    Math.hypot(source.x - target.x, source.y - target.y) - collisionRadiusOf(source) - collisionRadiusOf(target),
  );
}

export function edgeDistanceToPoint(source, x, y) {
  return Math.max(0, Math.hypot(source.x - x, source.y - y) - collisionRadiusOf(source));
}

export class TroopStats {
  constructor(data) {
    Object.assign(this, data);
    this.aggro ??= 1;
    this.size ??= 1;
  }
}
