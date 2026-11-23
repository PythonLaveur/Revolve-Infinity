const iconFiles = {
  ninja: 'Icon 7 ninjas.png',
  burrower: 'Icon Burrower.png',
  hugo: 'Icon hugo.png',
  kaguya: 'Icon Kaguya.png',
  rayka: 'Icon Rayka.png',
  reby: 'Icon Reby.png',
  rookie: 'Icon Rookie.png',
};

export const UNIT_ICON_URLS = Object.fromEntries(
  Object.entries(iconFiles).map(([unitId, file]) => [unitId, new URL(`./unit-icons/${file}`, import.meta.url).href]),
);

export const UNIT_ICON_IMAGES = Object.fromEntries(
  Object.entries(UNIT_ICON_URLS).map(([unitId, src]) => {
    const image = new Image();
    image.src = src;
    return [unitId, image];
  }),
);
