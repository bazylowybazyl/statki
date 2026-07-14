export const RING_PLANET_WORLD_RADII = Object.freeze({
    earth: 37800,
    mars: 30000
});

export const RING_INFRASTRUCTURE_SIZE = Object.freeze({
    // The visual city occupies the planet-facing side of an 8 x 152 ribbon.
    residentialDepth: 608,
    industrialDepth: 608,
    parkingDepth: 880,
    defenseDepth: 454
});

export function normalizeRingPlanetKey(source) {
    if (typeof source === 'string') return source.trim().toLowerCase();
    const candidates = [source?.id, source?.name, source?.label, source?.type];
    for (const candidate of candidates) {
        const key = String(candidate || '').trim().toLowerCase();
        if (key.includes('earth')) return 'earth';
        if (key.includes('mars')) return 'mars';
    }
    return '';
}

export function resolveRingPlanetWorldRadius(source, fallback = 2800) {
    if (typeof source === 'number') {
        return Math.max(2000, Number(source) || fallback);
    }
    const explicit = Number(source?.ringWorldRadius);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const key = normalizeRingPlanetKey(source);
    if (RING_PLANET_WORLD_RADII[key]) return RING_PLANET_WORLD_RADII[key];
    return Math.max(2000, Number(source?.r) || fallback);
}

export function computeRingAtmosphereGap(worldRadius) {
    return Math.max(2600, Math.min(4200, worldRadius * 0.09));
}
