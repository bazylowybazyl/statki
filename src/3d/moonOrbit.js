// src/3d/moonOrbit.js — strojenie i MIEJSCE księżyców z bryłą (DirectMoon w planet3d.assets.js; dane — src/data/moonBodies.js).
// Czysty moduł (bez three, DOM i `window`) — test porównuje miejsce obrazu z węzłem gry (`moonWorldPosition`,
// tests/warpWorkerMirror.test.mjs).
//
// Księżyce z bryłą stoją w MIEJSCACH WĘZŁÓW GRY (`mapId` → SYSTEM_MAP_MOONS w src/data/systemMap.js: kąt i promień
// orbity względem planety — ten sam punkt, do którego latają statki ruchu v2), bez Math.random (zasada żelazna 9) — ten
// sam obraz w trybie off i w workerze renderu (etap W nowego warpa, 2026-10-25; dawniej Luna: losowa faza i obieg
// 220 s na 3 × promieniu Ziemi z ringiem, 113 tys. j. — węzeł gry 96 tys. j., kąt 0,42). Promień orbity = max(węzeł gry,
// `orbitRadius` strojenia) — Io z mapy (60 tys.) leży pod ringiem Jowisza, więc zostaje 86 tys. (jedyny wyjątek od
// węzła). A/B `?ksiezyce=orbita`: dawny obieg (`orbitPeriodSec`) od kąta węzła (całkowany z dt klatki).

// Strojenie, miejsce i promień bryły — dane w src/data/moonBodies.js (jedno źródło obrazu i gry: zwolnienie skoku gracza
// przy mijanym księżycu, index.html), tu re-eksport dla planet3d.assets.js.
import { MOON_TUNE } from '../data/moonBodies.js';
export { MOON_TUNE, JUPITER_MOONS_TUNE, MOON_BODY_TUNES, moonGameNode, moonStartAngle, moonOrbitRadius, moonBodyRadius } from '../data/moonBodies.js';

/** Czy księżyc obiega planetę (kąt całkowany z dt): tylko bez węzła gry albo w A/B `?ksiezyce=orbita`. */
export function moonOrbits(node, search) {
    return !node || /[?&]ksiezyce=orbita(?:&|$)/.test(String(search || ''));
}

/** Prędkość kątowa obiegu [rad/s] (A/B `?ksiezyce=orbita`, księżyc bez węzła gry). */
export function moonOrbitSpeed(tune) {
    return (Math.PI * 2) / Math.max(1, Number(tune?.orbitPeriodSec) || MOON_TUNE.orbitPeriodSec);
}

/** Miejsce obrazu księżyca w układzie gry (x, y) do `out` — bez alokacji. */
export function moonPlaceInto(out, parentX, parentY, angle, radius) {
    out.x = parentX + Math.cos(angle) * radius;
    out.y = parentY + Math.sin(angle) * radius;
    return out;
}
