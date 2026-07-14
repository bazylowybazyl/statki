import { HULL_RENDER_PROFILES, resolveEntityHullProfileId } from '../data/ships.js';

const REFERENCE_HULL_LENGTH = Math.max(1, Number(HULL_RENDER_PROFILES.atlas?.length) || 3000);
const MIN_CLASS_SCALE = 0.30;
const MAX_CLASS_SCALE = 1.25;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getEngineVfxScaleForHullId(hullId) {
  const profile = HULL_RENDER_PROFILES[hullId] || HULL_RENDER_PROFILES.atlas;
  const hullLength = Math.max(1, Number(profile?.length) || REFERENCE_HULL_LENGTH);
  return clamp(Math.sqrt(hullLength / REFERENCE_HULL_LENGTH), MIN_CLASS_SCALE, MAX_CLASS_SCALE);
}

export function getEngineVfxClassScale(entity) {
  const override = Number(entity?.visual?.engineVfxClassScale);
  if (Number.isFinite(override) && override > 0) {
    return clamp(override, MIN_CLASS_SCALE, MAX_CLASS_SCALE);
  }
  return getEngineVfxScaleForHullId(resolveEntityHullProfileId(entity));
}
