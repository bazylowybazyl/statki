// Pomocnicze celowania gracza. Dawne tryby celownika (SINGLE / MULTI / SUB / SELECT i ich koło pod ŚPM)
// usunięte 2026-10-03 — jeden celownik broni (src/ui/weaponReticle.js), ŚPM = koło trybów okrętu
// (src/game/shipModes.js).

export function targetingVisualScale(zoom, minScale = 0.22, maxScale = 1.8) {
  const min = Math.max(0.01, Number(minScale) || 0.22);
  const max = Math.max(min, Number(maxScale) || 1.8);
  const value = Number(zoom);
  return Math.max(min, Math.min(max, Number.isFinite(value) && value > 0 ? value : 1));
}

export function reconcileLockedTargets(targets, canLock) {
  const valid = [];
  const seen = new Set();
  if (Array.isArray(targets) && typeof canLock === 'function') {
    for (const target of targets) {
      if (!target || seen.has(target) || !canLock(target)) continue;
      seen.add(target);
      valid.push(target);
    }
  }
  return { targets: valid, primary: valid[0] || null };
}
