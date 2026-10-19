/**
 * Czy kadłub może zostać pełną skórą z dala (zamiast smugi z batcha smug). Wrak i odłam — nie: odłam
 * próbkuje sprite rodzica, a pełna skóra „całego sprite'a” zamieniałaby każdy fragment z powrotem w cały
 * okręt. Dawniej (kadłuby heksowe) decydowało to o płycie pancerza LOD — stąd nazwa modułu i funkcji.
 */
export function allowsSolidArmorLod(entity) {
  const grid = entity?.beamHull;
  if (!grid) return false;
  if (entity?.isWreck === true) return false;
  if (grid.isFragment === true) return false;
  if (grid.disableSolidArmorLod === true) return false;
  return true;
}
