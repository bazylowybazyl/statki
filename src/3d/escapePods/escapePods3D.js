// src/3d/escapePods/escapePods3D.js
//
// KAPSUŁY RATUNKOWE — obraz (E22, reguła `kapsuly-ratunkowe`). Kadłubki kapsuł (partia `EscapePodBodies`, jeden
// rysunek), migająca lampa (czerwony błysk ratunkowy, HDR — bloom) i płomień silnika (obłoki na billboardach
// `CargoLights`, drugi rysunek) — dwa rysunki na wszystkie kapsuły.
//
// Wejście: ramka bloku `pods` (src/render/blocks/escapePodBlock.js — w workerze `applyEscapePodBlock`, w trybie off
// ta sama ramka z gry). Mgłę wojny, maskowanie i soczewkę skoku liczy gra (ramka niesie tylko kapsuły do narysowania).
// PRECYZJA: względem początku przy kamerze (sceneOriginNearCamera; mesh.position = początek).
// Szew: bez `window`, DOM i stanu gry. Migotanie płomienia — `fxRandom` (nie Math.random).
import { Core3D as CoreRef } from '../core3d.js';
import { WARIANT_INSTANCJI } from '../rozgrzewka.js';
import { sceneOriginNearCamera } from '../sceneOrigin.js';
import { cameraRoll, rolledHalfExtents } from '../viewRoll.js';
import { setCargoSun } from '../cargo/cargoLight.tsl.js';
import { CARGO_LIGHT_VIEW, CargoLights } from '../cargo/drones.tsl.js';
import { fxRandom } from '../fx/fxRandom.js';
import { EscapePodBodies } from './escapePods.tsl.js';

export const POD_3D_TUNE = {
  /** Instancje bryły (kapsuły w kadrze) i świateł (lampa + 3 obłoki płomienia na kapsułę). */
  bodies: 192,
  lights: 1024,
  /** Wymiary kapsuły [j.] (= POD_TUNE.length / width w src/game/escapePods.js) i podstawa nad płaszczyzną gry. */
  length: 20,
  width: 8,
  height: 7,
  baseZ: 8,
  /** Lampa: okres błysku [s], długość błysku (ułamek okresu), moc HDR, promień [j.] i najmniejszy promień [px]. */
  blinkPeriod: 1.1,
  blinkOn: 0.2,
  lampPower: 6.0,
  lampRadius: 2.6,
  lampMinPx: 3.2,
  /** Płomień: moc HDR (× 0,35 + 0,65 · ciąg), obłoki za dyszą (odległość w szerokościach, promień, waga). */
  flamePower: 2.4,
  flameMinPx: 1.6,
  /** Zapas kadru [j.] przy obcinaniu kapsuł. */
  cullPad: 400
};

const LAMP = [1.0, 0.18, 0.06];
const FLAME = [1.0, 0.62, 0.26];
const FLAME_CORE = [1.0, 0.9, 0.7];
// [odległość za rufą (× szerokość), promień (× szerokość), waga mocy, barwa: 0 płomień / 1 jądro]
const FLAME_PUFFS = [[0.15, 0.42, 1.0, 1], [0.75, 0.55, 0.7, 0], [1.5, 0.48, 0.38, 0]];

export function createEscapePods3D(Core3D) {
  const T = POD_3D_TUNE;
  let ready = false;
  let bodies = null;
  let lights = null;
  const origin = { x: 0, y: 0 };
  const stats = { pods: 0, lights: 0, ms: 0 };
  const _rollHalf = { hw: 0, hh: 0 };

  function ensure() {
    if (ready || !Core3D.scene) return ready;
    bodies = new EscapePodBodies(Core3D.scene, T.bodies);
    lights = new CargoLights(Core3D.scene, T.lights);
    lights.mesh.name = 'Kapsuly:swiatla';
    ready = true;
    return ready;
  }

  // Rozgrzewka (faza 'after' — kapsuły pojawiają się dopiero po zniszczeniu statku); rysunek dopiero po jej wpisie.
  function idle() {
    if (!ready) return;
    bodies.begin(); bodies.commit();
    lights.begin(); lights.commit(null, NaN);
  }

  const api = {
    stats,
    /** Rozgrzane (wpis rejestru gotowy) — wolno rysować. Bez rejestru (testy) — od razu. */
    warm: !CoreRef.warmup,
    /**
     * Klatka: `frame` — ramka bloku `pods` (createEscapePodFrame), `cam` — kamera gry ({ x, y, zoom }), `sun` — Słońce
     * w układzie gry (azymut światła) albo null, `time` — zegar efektów [s], `viewW` / `viewH` [px].
     */
    update(frame, cam, sun, time, viewW, viewH) {
      const t0 = performance.now();
      const n = frame ? frame.count | 0 : 0;
      stats.pods = 0; stats.lights = 0;
      if (!n || !api.warm) { idle(); stats.ms = performance.now() - t0; return; }
      if (!ensure()) return;
      sceneOriginNearCamera(origin, Core3D.activeCam1);
      const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
      const rh = rolledHalfExtents((viewW || 1920) * 0.5 / zoom + T.cullPad, (viewH || 1080) * 0.5 / zoom + T.cullPad, cameraRoll(cam), _rollHalf);
      const camX = Number(cam?.x) || 0;
      const camY = Number(cam?.y) || 0;
      // Słońce kadłubów (wspólne z kontenerami i dronami przeładunku — te same wartości tej klatki).
      if (sun) setCargoSun(Math.atan2(-(sun.y - camY), sun.x - camX));
      CARGO_LIGHT_VIEW.right.value.set(1, 0, 0);
      CARGO_LIGHT_VIEW.up.value.set(0, 1, 0);
      const pxPerUnit = Core3D.viewZoom ? Core3D.viewZoom(Core3D.activeCam1) : zoom;
      const ppu = Math.max(1e-4, pxPerUnit);
      const lampR = Math.max(T.lampRadius, T.lampMinPx / ppu);
      const flameMin = T.flameMinPx / ppu;
      bodies.begin();
      lights.begin();
      const ox = origin.x;
      const oy = origin.y;
      const zc = T.baseZ + T.height * 0.5;
      for (let i = 0; i < n; i++) {
        const gx = frame.x[i];
        const gy = frame.y[i];
        if (Math.abs(gx - camX) >= rh.hw || Math.abs(gy - camY) >= rh.hh) continue;
        stats.pods++;
        const sx = gx - ox;
        const sy = -gy - oy;
        const yaw = -frame.ang[i];
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const engine = (frame.flags[i] & 1) !== 0;
        const thrust = engine ? 0.35 + 0.65 * Math.min(1, Math.max(0, frame.thrust[i])) : 0;
        bodies.push(sx, sy, zc, yaw, T.length, T.width, T.height, frame.seed[i] & 1023, thrust);
        // Lampa ratunkowa na grzbiecie: błysk co okres (faza z numeru kapsuły).
        const ph = ((frame.age[i] + (frame.uid[i] % 9) * 0.13) % T.blinkPeriod) / T.blinkPeriod;
        if (ph < T.blinkOn) {
          const k = T.lampPower * (1 - ph / T.blinkOn * 0.5);
          if (lights.push(sx - c * T.length * 0.08, sy - s * T.length * 0.08, zc + T.height * 0.5 + 0.6, lampR, LAMP[0] * k, LAMP[1] * k, LAMP[2] * k, 0)) stats.lights++;
        }
        // Płomień za dyszą (obłoki wzdłuż −osi), migotanie z fxRandom.
        if (engine) {
          const flick = 0.82 + 0.36 * fxRandom.next();
          const rx = sx - c * T.length * 0.5;
          const ry = sy - s * T.length * 0.5;
          for (let k = 0; k < FLAME_PUFFS.length; k++) {
            const p = FLAME_PUFFS[k];
            const d = p[0] * T.width * (0.7 + 0.6 * thrust);
            const r = Math.max(flameMin, p[1] * T.width * (0.8 + 0.4 * thrust));
            const e = T.flamePower * thrust * p[2] * flick;
            const col = p[3] ? FLAME_CORE : FLAME;
            if (lights.push(rx - c * d, ry - s * d, zc, r, col[0] * e, col[1] * e, col[2] * e, 1)) stats.lights++;
          }
        }
      }
      bodies.commit();
      bodies.mesh.position.set(ox, oy, 0);
      lights.commit(null, pxPerUnit);
      lights.mesh.position.set(ox, oy, 0);
      stats.ms = performance.now() - t0;
    },

    /** Rozgrzewka (Core3D.warmup): partia kapsuł i jej światła. */
    warmupMeshes() {
      if (!ensure()) return [];
      return [bodies.mesh, lights.mesh];
    }
  };
  return api;
}

// Jeden obraz kapsuł na Core3D (strona w trybie off albo worker renderu) + rozgrzewka przy imporcie (wzór łupu).
let _shared = null;
export function sharedEscapePods3D() {
  return _shared || (_shared = createEscapePods3D(CoreRef));
}
if (CoreRef.warmup && typeof CoreRef.warmup.add === 'function') {
  const reg = CoreRef.warmup;
  const w = reg.add({ name: 'kapsuły ratunkowe', objects: () => sharedEscapePods3D().warmupMeshes(), phase: 'after', variant: WARIANT_INSTANCJI });
  if (w && w.promise) w.promise.then(() => { sharedEscapePods3D().warm = true; }); else sharedEscapePods3D().warm = true;
  // Kamery 3D (lot free3d, widok kamer): pierwszy widok kapsuł bez kompilacji w klatce.
  reg.add({ name: 'kapsuły ratunkowe (kamery 3D)', objects: () => sharedEscapePods3D().warmupMeshes(), phase: 'after', ortho: false, variant: WARIANT_INSTANCJI });
}
