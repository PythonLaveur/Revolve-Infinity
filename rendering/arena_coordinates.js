// The arena illustration includes scenery outside the playable field. Keep
// the whole image visible, but map logical board coordinates onto its inner
// stone field. These are visual asset coordinates; gameplay dimensions remain
// defined by data/game_parameters.js.
export const ARENA_FIELD_IN_IMAGE = Object.freeze({
  x: 56,
  y: 64,
  width: 1400,
  height: 410,
});

export function arenaTransformScale(width, height) {
  return {
    x: ARENA_FIELD_IN_IMAGE.width / width,
    y: ARENA_FIELD_IN_IMAGE.height / height,
  };
}

export function applyArenaTransform(context, width, height) {
  const scale = arenaTransformScale(width, height);
  context.translate(ARENA_FIELD_IN_IMAGE.x, ARENA_FIELD_IN_IMAGE.y);
  context.scale(scale.x, scale.y);
  return scale;
}

export function screenToArena(point, width, height) {
  const scale = arenaTransformScale(width, height);
  return {
    x: (point.x - ARENA_FIELD_IN_IMAGE.x) / scale.x,
    y: (point.y - ARENA_FIELD_IN_IMAGE.y) / scale.y,
  };
}
