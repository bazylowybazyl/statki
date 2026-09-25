// Warp lens: soczewka grawitacyjna wokół statku gracza podczas skoku.
// Rysuje ją Core3D — pass na samym tle (src/3d/warpLens3D.js), statek
// i reszta sceny kładą się na wierzchu, bloom liczy się z gotowego obrazu.
// Tu zostaje tylko strona gry: kiedy soczewka jest, gdzie stoi i jak mocna.
//
// Stan gry (ship, warp, zoneState) czytamy z GameState w momencie
// wywolania — modul startuje zanim te obiekty powstana.
import { Core3D } from '../3d/core3d.js';
import { GameState } from '../game/gameState.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep01 = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

// Wymiary w DŁUGOŚCIACH KADŁUBA (świat): soczewka rośnie i maleje razem ze
// statkiem przy każdym zoomie i na każdym kadłubie.
const WARP_LENS_DEFAULTS = Object.freeze({
  radius: 1.3,         // promień wzdłuż osi lotu przy pełnym skoku
  radiusStart: 0.6,    // ułamek promienia na początku wejścia w skok
  stretch: 1.3,        // wydłużenie wzdłuż lotu (promień wzdłuż / w poprzek)
  swallow: 0.55,       // połknięta tarcza tła jako ułamek promienia (max 0,65)
  centerOffset: -0.15, // środek od środka kadłuba wzdłuż osi (ujemny = ku rufie)
  fadeOut: 0.45        // sekundy wygaszania po wyjściu ze skoku
});

const DevVFX = window.DevVFX = window.DevVFX || {};
DevVFX.warpLens = Object.assign({}, WARP_LENS_DEFAULTS, DevVFX.warpLens || {});
window.__WARP_LENS_DEFAULTS = WARP_LENS_DEFAULTS;

function warpLensParam(key) {
  const defaults = WARP_LENS_DEFAULTS;
  const bag = DevVFX?.warpLens || defaults;
  const raw = bag[key];
  return Number.isFinite(raw) ? raw : defaults[key];
}

// Siła soczewki 0..1: rośnie z wejściem w skok, po wyjściu (albo wlocie
// w strefę bez efektu) gaśnie przez fadeOut zamiast znikać w jednej klatce.
let lensLevel = 0;

/**
 * Wołane co klatkę PRZED renderem 3D (drawHexShips3D → Core3D.render).
 * interpPos/interpAngle — poza, z którą rysuje się kadłub (Core3D mapuje
 * soczewkę tą samą kamerą co scenę); frameDt w sekundach (wygaszanie).
 */
export function updateWarpLens3D(interpPos, interpAngle, frameDt) {
  const { ship, warp, zoneState } = GameState;
  if (!ship || ship.dead || !interpPos) {
    lensLevel = 0;
    Core3D.clearWarpLens();
    return;
  }
  const zoneAllowsWarpLens = zoneState?.current?.wormholeVfx ?? false;
  const isWarpActive = !!(warp && warp.state === 'active' && zoneAllowsWarpLens);
  const targetLevel = isWarpActive ? smoothstep01(Number(warp.entryProgress) || 0) : 0;
  if (targetLevel >= lensLevel) {
    lensLevel = targetLevel;
  } else {
    const fadeOut = Math.max(0.05, warpLensParam('fadeOut'));
    const dt = clamp(Number(frameDt) || 0, 0, 0.1);
    lensLevel = Math.max(targetLevel, lensLevel - dt / fadeOut);
  }

  if (!(lensLevel > 0.001)) {
    Core3D.clearWarpLens();
    return;
  }

  // ship.w leży wzdłuż osi lotu (lokalne +x), ship.h w poprzek.
  const spriteScale = Number(ship.visual?.spriteScale) || 1;
  const fallback = (Number(ship.radius) || 20) * 2;
  const length = Math.max(24, (Number(ship.w) || fallback) * spriteScale);
  const angle = Number.isFinite(interpAngle) ? interpAngle : (Number(ship.angle) || 0);

  const offset = warpLensParam('centerOffset') * length;
  const centerX = interpPos.x + Math.cos(angle) * offset;
  const centerY = interpPos.y + Math.sin(angle) * offset;

  const radiusStart = clamp(warpLensParam('radiusStart'), 0, 1);
  const radiusAlong = Math.max(0, warpLensParam('radius')) * length * (radiusStart + (1 - radiusStart) * lensLevel);
  const stretch = Math.max(0.2, warpLensParam('stretch'));
  const swallow = Math.max(0, warpLensParam('swallow')) * lensLevel;

  Core3D.setWarpLensWorld(centerX, centerY, angle, radiusAlong, radiusAlong / stretch, swallow);
}
