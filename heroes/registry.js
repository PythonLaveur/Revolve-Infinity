/** Each hero is a separate lazy-loaded module named after its catalog id. */
export async function loadHeroBehavior(heroId) {
  const module = await import(`./${heroId}.js`);
  if (module.heroId !== heroId || typeof module.default !== 'function')
    throw new Error(`Hero module "${heroId}" must export its id and behavior factory`);
  return module.default();
}
