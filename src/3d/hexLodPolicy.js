/**
 * A solid armor plane is only correct while the body still represents the
 * complete source sprite. Split bodies keep source-space UVs so their hexes
 * look sharp, but a full-sprite impostor would turn every fragment back into
 * an intact ship.
 */
export function allowsSolidArmorLod(entity) {
  // Kadłub na belkach (hullBodies.js) niesie te same flagi co siatka heksów.
  const grid = entity?.hexGrid || entity?.beamHull;
  if (!grid) return false;
  if (entity?.isWreck === true) return false;
  if (grid.isFragment === true) return false;
  if (grid.disableSolidArmorLod === true) return false;
  return true;
}
