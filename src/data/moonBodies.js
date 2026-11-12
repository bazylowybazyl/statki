// src/data/moonBodies.js — KSIĘŻYCE Z BRYŁĄ (Luna, księżyce Jowisza): strojenie, MIEJSCE i PROMIEŃ bryły. Czyste dane
// i funkcje (bez three, DOM i `window`) — jedno źródło dla obrazu (src/3d/moonOrbit.js re-eksportuje je dla
// planet3d.assets.js: DirectMoon) i gry (index.html: zwolnienie skoku gracza przy mijanym księżycu — recenzja obrazu W4,
// BRIEF-studnie: odlot z K-7 mijał Lunę w pełnej prędkości ponad P4 soczewki; symulator scripts/webgpu/warp-soczewka-sym.mjs).
//
// Księżyce z bryłą stoją w MIEJSCACH WĘZŁÓW GRY (`mapId` → SYSTEM_MAP_MOONS w src/data/systemMap.js: kąt i promień
// orbity względem planety — ten sam punkt, do którego latają statki ruchu v2), bez Math.random (zasada żelazna 9) — ten
// sam obraz w trybie off i w workerze renderu (etap W nowego warpa, 2026-10-25; dawniej Luna: losowa faza i obieg
// 220 s na 3 × promieniu Ziemi z ringiem, 113 tys. j. — węzeł gry 96 tys. j., kąt 0,42). Promień orbity = max(węzeł gry,
// `orbitRadius` strojenia) — Io z mapy (60 tys.) leży pod ringiem Jowisza, więc zostaje 86 tys. (jedyny wyjątek od
// węzła). A/B `?ksiezyce=orbita` (src/3d/moonOrbit.js): dawny obieg (`orbitPeriodSec`) od kąta węzła.

import { SYSTEM_MAP_MOON_BY_ID } from './systemMap.js';

/** Luna (rodzic: Ziemia). Mapy (dzień, noc, normalne) — MOON_MAPS w planetMaps.js po `id` (Luna: 'moon'). */
export const MOON_TUNE = Object.freeze({
    mapId: 'luna',
    orbitRadiusMul: 3.0,
    orbitRadiusMin: 30000,
    orbitPeriodSec: 220,
    spinPeriodSec: 72,
    sizeRatioToParent: 0.24,
    z: -50020
});
// Dekoracyjne księżyce Jowisza. Od Z6 (2026-09-26) Jowisz ma ring „Halo”
// (promień 48 000, ring do ~54 750, port z redą do ~70 tys.): dawne orbity
// 20–48 tys. leżały w planecie i ringu. Orbity = promienie księżyców mapy
// (systemMap.js: Io 60 tys. — pod ringiem, więc 86 tys.; Europa 105,
// Ganimedes 165, Kallisto 250 tys.), okresy wydłużone proporcjonalnie
// (prędkość liniowa jak dawniej). Rozmiar: ułamek promienia planety przy ringu.
export const JUPITER_MOONS_TUNE = Object.freeze([
    Object.freeze({ id: 'io', mapId: 'io', orbitRadius: 86000, orbitPeriodSec: 352, spinPeriodSec: 48, sizeRatioToParent: 0.05, phase: 0.0, haloColor: 0xffb16f }),
    Object.freeze({ id: 'europa', mapId: 'europa', orbitRadius: 105000, orbitPeriodSec: 412, spinPeriodSec: 58, sizeRatioToParent: 0.042, phase: 1.4, haloColor: 0x9fc8ff }),
    Object.freeze({ id: 'ganymede', mapId: 'ganimedes', orbitRadius: 165000, orbitPeriodSec: 669, spinPeriodSec: 74, sizeRatioToParent: 0.06, phase: 2.2, haloColor: 0xb6c3d6 }),
    Object.freeze({ id: 'callisto', mapId: 'kallisto', orbitRadius: 250000, orbitPeriodSec: 1016, spinPeriodSec: 92, sizeRatioToParent: 0.055, phase: 3.1, haloColor: 0x91a7c4 })
]);

/** Księżyce z bryłą planety po id (planet3d.assets.js: DirectMoon — Luna przy Ziemi, cztery przy Jowiszu). */
export const MOON_BODY_TUNES = Object.freeze({
    earth: Object.freeze([MOON_TUNE]),
    jupiter: JUPITER_MOONS_TUNE
});

/** Najmniejszy promień bryły księżyca [j.] i mnożnik planety tła (= PLANET_SIZE_MULTIPLIER w planet3d.assets.js). */
export const MOON_BODY_MIN_R = 900;
export const MOON_BACKDROP_MUL = 4.5;

/** Węzeł gry księżyca (wpis SYSTEM_MAP_MOONS po `tune.mapId`) albo null. */
export function moonGameNode(tune) {
    return SYSTEM_MAP_MOON_BY_ID[String(tune?.mapId || '')] || null;
}

/** Kąt startowy orbity: kąt węzła gry; bez węzła — faza strojenia albo 0 (deterministycznie, bez Math.random). */
export function moonStartAngle(tune, node = moonGameNode(tune)) {
    const a = node ? Number(node.angle) : Number(tune?.phase);
    return Number.isFinite(a) ? a : 0;
}

/**
 * Promień orbity obrazu [j.] względem środka planety: z węzłem gry — max(węzeł, `orbitRadius` strojenia) (strojenie tylko
 * odsuwa — Io spod ringu Jowisza); bez węzła — max(`orbitRadius`, `orbitRadiusMin`, promień planety × `orbitRadiusMul`).
 */
export function moonOrbitRadius(tune, node, parentR) {
    const abs = Math.max(0, Number(tune?.orbitRadius) || 0);
    if (node) return Math.max(Number(node.orbitRadius) || 0, abs);
    const min = Math.max(0, Number(tune?.orbitRadiusMin) || 0);
    const mul = Math.max(0, Number(tune?.orbitRadiusMul) || 0);
    return Math.max(abs, min, (Number(parentR) || 0) * mul);
}

/**
 * Promień bryły księżyca [j.] (DirectMoon): ułamek promienia planety (`sizeRatioToParent`; planeta z ringiem — promień
 * świata planety, planeta tła × MOON_BACKDROP_MUL), nie mniej niż MOON_BODY_MIN_R.
 */
export function moonBodyRadius(tune, parentR, ringAnchored) {
    const ratio = Math.max(0.01, Number(tune?.sizeRatioToParent) || MOON_TUNE.sizeRatioToParent);
    return Math.max(MOON_BODY_MIN_R, (Number(parentR) || 0) * ratio * (ringAnchored ? 1 : MOON_BACKDROP_MUL));
}
