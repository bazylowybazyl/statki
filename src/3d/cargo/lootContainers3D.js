// src/3d/cargo/lootContainers3D.js
//
// KONTENERY-ŁUP — obraz (K2, docs/PROPOZYCJA-kontenery-lup.md § 3.3). Paczki dryfujące po zniszczeniu statku ruchu:
// moduły kontenerów E12 (te same rodziny i farby — containerLookLinear, materiał containers.tsl.js) wg masy paczki,
// lampka-boja HDR (mruga co 1,5 s, na końcu życia szybciej) i wiązka ściągająca jako strumień świecących punktów
// płynących od paczki do statku. Partie: `CargoContainers` (kontenery) i `CargoLights` (lampki i wiązka) — dwa
// rysunki na wszystkie paczki.
//
// Wejście: ramka bloku `loot` (src/render/blocks/lootBlock.js — w workerze `applyLootBlock`, w trybie off ta sama
// ramka z gry). Mgłę wojny i soczewkę skoku liczy gra (ramka niesie tylko paczki do narysowania).
// PRECYZJA: względem początku przy kamerze (sceneOriginNearCamera; mesh.position = początek).
// Szew: bez `window`, DOM i stanu gry.
import { Core3D as CoreRef } from '../core3d.js';
import { WARIANT_INSTANCJI } from '../rozgrzewka.js';
import { sceneOriginNearCamera } from '../sceneOrigin.js';
import { cameraRoll, rolledHalfExtents } from '../viewRoll.js';
import { CargoContainers, containerLookLinear } from './containers.tsl.js';
import { CARGO_LIGHT, setCargoSun } from './cargoLight.tsl.js';
import { CARGO_LIGHT_VIEW, CargoLights } from './drones.tsl.js';
import { CARGO_CONTAINER, cargoModuleContainer, cargoModuleSize } from '../../data/cargoBays.js';
import { RESOURCE_KEYS } from '../../data/resources.js';

export const LOOT_3D_TUNE = {
  /** Instancje kontenerów (paczka do 8 kontenerów — moduł 2 × 2 × 2) i świateł (lampka + wiązka). */
  containers: 2304,
  lights: 1024,
  /** Masa paczki [t] → moduł: do `single` jeden kontener, do `quad` 2 × 2, wyżej 2 × 2 × 2. */
  single: 16,
  quad: 64,
  /** Podstawa paczki nad płaszczyzną gry [j.] (nad poszyciem wraku, pod statkami w locie nic nie zakrywa). */
  baseZ: 2,
  /** Lampka-boja: okres błysku [s] (końcówka życia — `fadePeriod`), długość błysku (ułamek okresu), moc HDR. */
  blinkPeriod: 1.5,
  fadePeriod: 0.3,
  blinkOn: 0.22,
  lampPower: 5.0,
  lampRadius: 5,
  /** Wiązka: punkty na odcinek, promień, moc, tempo przepływu [okresy / s]. */
  beamPoints: 14,
  beamRadius: 4.5,
  beamPower: 2.6,
  beamFlow: 1.6,
  /** Zapas kadru [j.] przy obcinaniu paczek (wiązka sięga statku poza kadrem). */
  cullPad: 600
};

const LAMP = [1.0, 0.55, 0.12];
const BEAM = [0.42, 0.86, 1.0];
const C = CARGO_CONTAINER;
const MOD_SINGLE = cargoModuleSize({ nx: 1, ny: 1, nz: 1 });
const MOD_QUAD = cargoModuleSize({ nx: 2, ny: 2, nz: 1 });
const MOD_CUBE = cargoModuleSize({ nx: 2, ny: 2, nz: 2 });

export function createLootContainers3D(Core3D) {
  const T = LOOT_3D_TUNE;
  let ready = false;
  let containers = null;
  let lights = null;
  const origin = { x: 0, y: 0 };
  const stats = { packages: 0, containers: 0, lights: 0, beams: 0, ms: 0 };
  const _mc = {};
  const _rollHalf = { hw: 0, hh: 0 };
  // Wygląd: surowiec → 16 wariantów (farby jak przeładunek E12; bez kluczy-napisów na klatkę).
  const _looks = new Map();
  function lookOf(resIndex, v) {
    let looks = _looks.get(resIndex);
    if (!looks) { looks = []; _looks.set(resIndex, looks); }
    return looks[v] || (looks[v] = containerLookLinear(RESOURCE_KEYS[resIndex] || 'steel', 4243, v));
  }

  function ensure() {
    if (ready || !Core3D.scene) return ready;
    containers = new CargoContainers(Core3D.scene, T.containers);
    containers.mesh.name = 'Łup:kontenery';
    lights = new CargoLights(Core3D.scene, T.lights);
    lights.mesh.name = 'Łup:światła';
    ready = true;
    return ready;
  }

  // Rozgrzewka (faza 'after' — paczki pojawiają się dopiero po zestrzeleniu); rysunek dopiero po jej wpisie.
  function idle() {
    if (!ready) return;
    containers.begin(); containers.commit();
    lights.begin(); lights.commit(null, NaN);
  }

  const api = {
    stats,
    /** Rozgrzane (wpis rejestru gotowy) — wolno rysować. Bez rejestru (testy) — od razu. */
    warm: !CoreRef.warmup,
    /**
     * Klatka: `frame` — ramka bloku `loot` (createLootFrame), `cam` — kamera gry ({ x, y, zoom }), `sun` — Słońce
     * w układzie gry (azymut światła kontenerów) albo null, `time` — zegar efektów [s], `viewW` / `viewH` [px].
     */
    update(frame, cam, sun, time, viewW, viewH) {
      const t0 = performance.now();
      const n = frame ? frame.count | 0 : 0;
      stats.packages = 0; stats.containers = 0; stats.lights = 0; stats.beams = 0;
      if (!n || !api.warm) { idle(); stats.ms = performance.now() - t0; return; }
      if (!ensure()) return;
      sceneOriginNearCamera(origin, Core3D.activeCam1);
      const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
      const rh = rolledHalfExtents((viewW || 1920) * 0.5 / zoom + T.cullPad, (viewH || 1080) * 0.5 / zoom + T.cullPad, cameraRoll(cam), _rollHalf);
      const camX = Number(cam?.x) || 0;
      const camY = Number(cam?.y) || 0;
      // Światło kontenerów (wspólne z przeładunkiem E12 — te same wartości tej klatki).
      CARGO_LIGHT.time.value = time || 0;
      if (sun) setCargoSun(Math.atan2(-(sun.y - camY), sun.x - camX));
      CARGO_LIGHT_VIEW.right.value.set(1, 0, 0);
      CARGO_LIGHT_VIEW.up.value.set(0, 1, 0);
      const pxPerUnit = Core3D.viewZoom ? Core3D.viewZoom(Core3D.activeCam1) : zoom;
      containers.begin();
      lights.begin();
      const ox = origin.x;
      const oy = origin.y;
      const tm = time || 0;
      for (let i = 0; i < n; i++) {
        const gx = frame.x[i];
        const gy = frame.y[i];
        const inView = Math.abs(gx - camX) < rh.hw && Math.abs(gy - camY) < rh.hh;
        const tractor = (frame.flags[i] & 1) !== 0;
        if (!inView && !tractor) continue;
        const sx = gx - ox;
        const sy = -gy - oy;
        if (inView) {
          stats.packages++;
          const mass = frame.mass[i];
          const mod = mass <= T.single ? MOD_SINGLE : (mass <= T.quad ? MOD_QUAD : MOD_CUBE);
          const yaw = -frame.ang[i];
          const c = Math.cos(yaw);
          const s = Math.sin(yaw);
          const v0 = ((frame.seed[i] * 7 + frame.unit[i] * 3) & 15);
          for (let q = 0; q < mod.count; q++) {
            cargoModuleContainer(mod, q, _mc);
            const look = lookOf(frame.res[i], (v0 + q) & 15);
            if (containers.push(sx + _mc.a * c - _mc.b * s, sy + _mc.a * s + _mc.b * c, T.baseZ + _mc.z, yaw, C.L, C.W, C.H, -1, look)) stats.containers++;
          }
          // Lampka-boja na szczycie paczki: błysk co okres (faza z numeru paczki), końcówka życia — szybciej.
          const fade = (frame.flags[i] & 2) !== 0;
          const period = fade ? T.fadePeriod : T.blinkPeriod;
          const ph = ((frame.age[i] + (frame.uid[i] % 7) * 0.21) % period) / period;
          if (ph < T.blinkOn) {
            const k = T.lampPower * (1 - ph / T.blinkOn * 0.5);
            if (lights.push(sx, sy, T.baseZ + mod.H + 3, T.lampRadius, LAMP[0] * k, LAMP[1] * k, LAMP[2] * k, 0)) stats.lights++;
          }
        }
        // Wiązka: punkty płynące od paczki do statku (jaśniejsze w środku odcinka).
        if (tractor && frame.hasShip) {
          stats.beams++;
          const ex = frame.shipX - ox;
          const ey = -frame.shipY - oy;
          const np = T.beamPoints;
          const flow = (tm * T.beamFlow + (frame.uid[i] % 5) * 0.137) % 1;
          for (let k = 0; k < np; k++) {
            const u = (k + flow) / np;
            const w = Math.sin(Math.PI * u);
            const p = T.beamPower * (0.35 + 0.65 * w);
            if (lights.push(sx + (ex - sx) * u, sy + (ey - sy) * u, T.baseZ + 6, T.beamRadius, BEAM[0] * p, BEAM[1] * p, BEAM[2] * p, 1)) stats.lights++;
          }
        }
      }
      containers.commit();
      containers.mesh.position.set(ox, oy, 0);
      lights.commit(null, pxPerUnit);
      lights.mesh.position.set(ox, oy, 0);
      stats.ms = performance.now() - t0;
    },

    /** Rozgrzewka (Core3D.warmup): partie kontenerów i świateł łupu. */
    warmupMeshes() {
      if (!ensure()) return [];
      return [containers.mesh, lights.mesh];
    }
  };
  return api;
}

// Jeden obraz łupu na Core3D (strona w trybie off albo worker renderu) + rozgrzewka przy imporcie (wzór portCargo3D).
let _shared = null;
export function sharedLootContainers3D() {
  return _shared || (_shared = createLootContainers3D(CoreRef));
}
if (CoreRef.warmup && typeof CoreRef.warmup.add === 'function') {
  const reg = CoreRef.warmup;
  const w = reg.add({ name: 'kontenery-łup', objects: () => sharedLootContainers3D().warmupMeshes(), phase: 'after', variant: WARIANT_INSTANCJI });
  if (w && w.promise) w.promise.then(() => { sharedLootContainers3D().warm = true; }); else sharedLootContainers3D().warm = true;
  // Kamery 3D (lot free3d, widok kamer): pierwszy widok paczek bez kompilacji w klatce.
  reg.add({ name: 'kontenery-łup (kamery 3D)', objects: () => sharedLootContainers3D().warmupMeshes(), phase: 'after', ortho: false, variant: WARIANT_INSTANCJI });
}
