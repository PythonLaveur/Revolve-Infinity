export function effectiveResistance(resistance, flatPenetration = 0, percentPenetration = 0) {
  const effective =
    Math.max(0, resistance - flatPenetration) *
    (1 - Math.max(0, Math.min(100, percentPenetration)) / 100);
  return effective;
}
export function applyResistance(
  rawDamage,
  resistance,
  damageType = 'physical',
  flatPenetration = 0,
  percentPenetration = 0,
) {
  const effective = effectiveResistance(resistance, flatPenetration, percentPenetration);
  return (rawDamage * 100) / (100 + effective);
}
export function scaleDamage(source, scales = {}) {
  return Math.round(
    (source.force || 0) * (scales.force || 0) +
      (source.atk || 0) * (scales.atk || 0) +
      (source.apt || 0) * (scales.apt || 0) +
      (source.hp || 0) * (scales.hp || 0),
  );
}
