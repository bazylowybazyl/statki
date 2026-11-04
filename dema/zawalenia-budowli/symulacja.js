// SYMULACJA SCENY dema D20 bez obrazu: gospodarze zawalenia (src/game/structureCollapse.js) na prawdziwym HullBodies,
// sterownik salw i ładunków ze scenariusze.js, stały krok (tick — licznik całkowity). Ten sam kod liczy demo (pętla
// stałego kroku obrazu), narzędzie Node (scripts/zawalenia-sym.mjs) i test (tests/structureCollapse.test.mjs) — liczby
// z Node = to, co widzi użytkownik. Bez three i DOM; HullBodies przychodzi z wywołania (Node ustawia globalThis.window).
import { buildHighriseArchetype } from '../../src/game/structureGraph.js';
import {
  createCollapseHost, collapsePreStep, collapseStep, collapseWeaponHit, collapseCharge, collapseLocalToWorld,
  collapseGroundTerrain, collapseGroundZ, collapseReleaseAnchor, collapseDispose
} from '../../src/game/structureCollapse.js';
import { createScenaDriver, scenaUstaw, STRONY } from './scenariusze.js';

// Archetyp RAZ na (ziarno, g) — każdy wariant g to osobny archetyp (kalibracja skaluje limity i falę z g).
const ARCH = new Map();
export function archetypWiezy(ziarno, g) {
  const k = `${ziarno}:${g}`;
  let A = ARCH.get(k);
  if (!A) { A = buildHighriseArchetype({ seed: ziarno, g }); ARCH.set(k, A); }
  return A;
}

/**
 * Scena `nr` na HullBodies `HB`. opts: hz (60), g (prawa wieża sceny 1 / jedyna w 2–3), strona, kappa, bron, ziarno (salwy),
 * tlumienie (0 — klastry bez tłumienia obrotu, 1 / brak — silnik 0,2/s), tune (COLLAPSE_TUNE gospodarza).
 * Teren sceny dokłada do silnika (stare tereny zdejmuje — jedna scena na silnik). Zwraca { cfg, hosts, dt, tick, t,
 * step(), entities, pomost(strona), dispose() }.
 */
export function createScenaSym(HB, nr, opts = {}) {
  // nr — numer sceny albo gotowa konfiguracja (testy: kształt jak scenaUstaw)
  const cfg = typeof nr === 'object' ? nr : scenaUstaw(nr, opts);
  HB.init();
  const D = HB.engine;
  D.terrains.length = 0;
  const terrain = D.addTerrain(collapseGroundTerrain(cfg.podloze));
  const hz = Number(opts.hz) > 0 ? Number(opts.hz) : 60;
  const dt = 1 / hz;
  const angularDamping = opts.tlumienie === 0 || opts.tlumienie === '0' ? 0 : null;
  const hosts = cfg.wieze.map((w, i) => {
    const A = archetypWiezy(w.ziarno, w.g);
    // pokład wieży na gruncie (albo nadPodlozem j. wyżej — pomost nad pustką jak w misji)
    const gz = collapseGroundZ(cfg.podloze, w.x, w.y) + (Number(w.nadPodlozem) || 0);
    return createCollapseHost(A, {
      // ta sama faza grafu we wszystkich wieżach (id → (id + tick) mod okres): A/B tempa ma identyczną historię zerwań
      bodies: HB, id: w.faza ?? 1, name: w.id, origin: { x: w.x, y: w.y, z: gz - A.groundZ }, yaw: w.yaw || 0,
      ground: cfg.podloze, kappa: Number.isFinite(cfg.kappa) ? cfg.kappa : undefined, angularDamping, tune: opts.tune
    });
  });
  const driver = createScenaDriver(cfg);
  const P = { x: 0, y: 0, z: 0 };
  const act = {
    hit(lx, ly, lz, dx, dy, dz, bron) {
      for (const h of hosts) {
        collapseLocalToWorld(h, lx, ly, lz, P);
        const c = h.pose[3], s = h.pose[4];
        collapseWeaponHit(h, P.x, P.y, P.z, c * dx - s * dy, s * dx + c * dy, dz, bron);
      }
    },
    charge(k, ile) { for (const h of hosts) collapseCharge(h, k, ile); }
  };
  const entities = [];
  const sym = {
    cfg, hosts, dt, hz, tick: 0, t: 0, entities, terrain,
    // kroki osobno (narzędzie mierzy fizykę i gospodarza oddzielnie)
    drive() { driver.krok(sym.tick * dt, dt, act); },
    pre() { for (const h of hosts) collapsePreStep(h, dt); },
    physics() {
      entities.length = 0;
      for (const h of hosts) for (let i = 0; i < h.entities.length; i++) entities.push(h.entities[i]);
      HB.step(dt, entities);
    },
    post() {
      for (const h of hosts) collapseStep(h, dt, sym.tick);
      sym.tick++;
      sym.t = sym.tick * dt;
    },
    step() { sym.drive(); sym.pre(); sym.physics(); sym.post(); },
    /** D13: pomost zniszczony od strony `strona` ('+x', '-y', …) — kotwice SECTION puszczają we wszystkich wieżach. */
    pomost(strona) {
      const st = STRONY[strona];
      let c = 0;
      for (const h of hosts) c += collapseReleaseAnchor(h, { x: st[0], y: st[1] });
      return c;
    },
    strzaly() { return driver.strzaly(); },
    dispose() {
      for (const h of hosts) collapseDispose(h);
      const i = D.terrains.indexOf(terrain);
      if (i >= 0) D.terrains.splice(i, 1);
    }
  };
  return sym;
}
