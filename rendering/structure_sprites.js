const spriteFiles = {
  '0:outer': '../data/game-icons/structures/blue_outer_turret.svg',
  '1:outer': '../data/game-icons/structures/red_outer_turret.svg',
  '0:inner': '../data/game-icons/structures/blue_inner_turret.svg',
  '1:inner': '../data/game-icons/structures/red_inner_turret.svg',
  '0:base': '../data/game-icons/structures/blue_king_tower.svg',
  '1:base': '../data/game-icons/structures/red_king_tower.svg',
};

const images = Object.fromEntries(Object.entries(spriteFiles).map(([key, path]) => {
  const image = new Image();
  image.src = new URL(path, import.meta.url).href;
  return [key, image];
}));

export function structureSprite(structure) {
  const kind = structure.type === 'base' ? 'base' : structure.layer || 'outer';
  return images[`${structure.team}:${kind}`] || null;
}

export function drawStructureSprite(context, structure, radius) {
  const sprite = structureSprite(structure);
  if (!sprite?.complete || sprite.naturalWidth === 0) return false;
  const spriteSize = radius * (
    structure.type === 'base' ? 2.4 : structure.layer === 'inner' ? 2.5 : 2.25
  );
  context.drawImage(sprite, -spriteSize / 2, -spriteSize / 2, spriteSize, spriteSize);
  return true;
}
