// src/game/asteroidBeltGiants.js
//
// Olbrzymie asteroidy w PASIE gry (zadanie 21): gdzie stoją, kiedy się budują, kolizje.
// Moduł bez three i DOM-u (testy: tests/asteroidBeltGiants.test.mjs). Render:
// src/3d/asteroids/giants.js (GiantView), klej: src/3d/asteroids/asteroidBelt.js.
//
// MIEJSCA (deterministyczne, niezależne od losowych kątów planet): rdzenie gęstych pól
// pasa głównego — skan jak `findSpot(37,5, 45,5, 'core')` dema (dema/asteroidy-webgpu/
// world.js, 6000 kątów × 6 promieni, najwyższa gęstość). Olbrzym stoi na OBRZEŻU pola:
// tak jak „Labirynt” sceny 4 dema — 38 tys. j. od rdzenia w stronę słońca i 26 tys. j.
// w bok (linia przelotu dema: start 90 tys. j. przed rdzeniem + 52 tys. + 26 tys. w bok).
// Pierwszy rdzeń = rdzeń dema (ten sam pas, ziarno i skala), więc Labirynt gry stoi
// dokładnie tam, gdzie w demie (ziarno 2 — jak olbrzym pola dema); kolejne presety
// (Pustka, Szczelina, Wrzeciono, Łuk, ziarno 1 — jak galeria dema) przy kolejnych
// rdzeniach, co najmniej `minSepRad` kąta od siebie. Pole nie stawia skał gry w obrysie
// olbrzymów (`field.setExclusions`) — jak w demie.
//
// BUDOWA: siatka SDF w workerach (GiantBuilder), dopiero gdy kamera / statek gracza
// podejdzie bliżej niż `buildRange` (2,6–5,8 s CPU na olbrzyma w jednym wątku, ~10 MB).
// Do gotowości olbrzym nie koliduje (jak ring przed `ready`).
//
// KOLIZJE (jak `collideShipWithGiants` dema): przekrój z = 0 siatki SDF, statek jako
// pięć kół wzdłuż osi kadłuba (promień 0,46 szerokości). Wypchnięcie o głębokość wbicia
// wzdłuż normalnej SDF, składowa prędkości w głąb skały odbita ze współczynnikiem 0,3
// (v −= 1,3 · vn · n) — bez obrażeń (demo ich nie ma; decyzja do oceny użytkownika).
// Ruch encji: gracz / P2 przez pos / vel, NPC przez widok kinematyki
// (npcCollisionBody.js) — kadłub belkowy dostaje pozycję w HullBodies.step.

import { GIANT_PRESETS, buildGiantPlan } from './asteroidGiants.js';

export const BELT_GIANTS_CONFIG = Object.freeze({
  // Skan rdzeni pasa głównego [AU] — jak findSpot(37,5, 45,5, 'core') dema.
  scanRAu: Object.freeze([37.5, 45.5]),
  scanAngles: 6000,
  scanRadii: 6,
  // Kolejne rdzenie co najmniej tyle kąta od wybranych [rad] (~1,2 mln j. na pasie).
  minSepRad: 0.7,
  // Położenie olbrzyma względem rdzenia: w stronę słońca i w bok [j.] (scena 4 dema).
  sunward: 38000,
  sideways: 26000,
  // Presety w kolejności rdzeni (pierwszy = olbrzym pola dema) i ich ziarna.
  presets: Object.freeze([
    Object.freeze({ id: 'warren', seed: 2 }),
    Object.freeze({ id: 'hollow', seed: 1 }),
    Object.freeze({ id: 'crevasse', seed: 1 }),
    Object.freeze({ id: 'spindle', seed: 1 }),
    Object.freeze({ id: 'arch', seed: 1 })
  ]),
  // Budowa siatki SDF, gdy punkt uwagi jest bliżej niż tyle od obrysu [j.].
  buildRange: 420000,
  // Zapas wykluczenia skał gry wokół połowy wymiarów bryły [j.] (demo: 600).
  exclusionPad: 600,
  // Kolizje statku: koła wzdłuż osi, promień × szerokość kadłuba, odbicie.
  hullCircleRadius: 0.46,
  bounce: 1.3
});

/**
 * Rdzenie gęstych pól pasa: skan kątów × promieni jak `findSpot(..., 'core')` dema
 * (ta sama kolejność i ostre `>` — pierwszy wynik = rdzeń dema), potem kolejne
 * najgęstsze kąty poza ±minSepRad od już wybranych.
 * @returns {Array<{x:number, y:number, score:number, angle:number}>}
 */
export function findBeltCores(field, { sunX, sunY, au, count = 5, cfg = BELT_GIANTS_CONFIG } = {}) {
  const [r0, r1] = cfg.scanRAu;
  const nA = cfg.scanAngles;
  const nR = cfg.scanRadii;
  const bestScore = new Float64Array(nA).fill(-Infinity);
  const bestX = new Float64Array(nA);
  const bestY = new Float64Array(nA);
  let first = null;
  for (let i = 0; i < nA; i++) {
    const a = (i / nA) * Math.PI * 2;
    for (let k = 0; k < nR; k++) {
      const rAu = r0 + (r1 - r0) * (k + 0.5) / nR;
      const x = sunX + Math.cos(a) * rAu * au;
      const y = sunY + Math.sin(a) * rAu * au;
      const score = field.sampleMacro(x, y).density;
      if (score > bestScore[i]) { bestScore[i] = score; bestX[i] = x; bestY[i] = y; }
      if (!first || score > first.score) first = { x, y, score, angle: a, i };
    }
  }
  const cores = [];
  if (!first) return cores;
  cores.push({ x: first.x, y: first.y, score: first.score, angle: first.angle });
  const taken = [first.angle];
  while (cores.length < count) {
    let pick = -1;
    for (let i = 0; i < nA; i++) {
      if (!(bestScore[i] > 0)) continue;
      const a = (i / nA) * Math.PI * 2;
      let ok = true;
      for (let t = 0; t < taken.length; t++) {
        let d = Math.abs(a - taken[t]) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < cfg.minSepRad) { ok = false; break; }
      }
      if (!ok) continue;
      if (pick < 0 || bestScore[i] > bestScore[pick]) pick = i;
    }
    if (pick < 0) break;
    const a = (pick / nA) * Math.PI * 2;
    cores.push({ x: bestX[pick], y: bestY[pick], score: bestScore[pick], angle: a });
    taken.push(a);
  }
  return cores;
}

/**
 * Miejsca olbrzymów pasa: na obrzeżu rdzeni (w stronę słońca i w bok — scena 4 dema).
 * @returns {Array<{id:string, seed:number, x:number, y:number, core:{x:number,y:number}, preset:object}>}
 */
export function planBeltGiantSites(field, { sunX, sunY, au, cfg = BELT_GIANTS_CONFIG } = {}) {
  const cores = findBeltCores(field, { sunX, sunY, au, count: cfg.presets.length, cfg });
  const sites = [];
  for (let i = 0; i < cores.length && i < cfg.presets.length; i++) {
    const c = cores[i];
    const dx = c.x - sunX;
    const dy = c.y - sunY;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Linia przelotu dema: ux, uy od słońca; w bok = (−uy, ux).
    const p = cfg.presets[i];
    sites.push({
      id: p.id,
      seed: p.seed,
      preset: GIANT_PRESETS[p.id],
      x: c.x - ux * cfg.sunward + (-uy) * cfg.sideways,
      y: c.y - uy * cfg.sunward + ux * cfg.sideways,
      core: { x: c.x, y: c.y }
    });
  }
  return sites;
}

export class BeltGiants {
  /**
   * @param {object} o
   * @param {import('./asteroidBeltField.js').AsteroidBeltField} o.field
   * @param {number} o.sunX @param {number} o.sunY @param {number} o.au
   * @param {Array} [o.sites] gotowe miejsca (testy); domyślnie planBeltGiantSites
   * @param {() => object} [o.createBuilder] fabryka GiantBuilder (leniwie — workery dopiero przy budowie)
   * @param {object} [o.config]
   */
  constructor(o) {
    this.cfg = { ...BELT_GIANTS_CONFIG, ...(o.config || {}) };
    this.field = o.field;
    this.createBuilder = o.createBuilder || null;
    this.builder = null;
    const sites = o.sites || planBeltGiantSites(o.field, { sunX: o.sunX, sunY: o.sunY, au: o.au, cfg: this.cfg });
    this.entries = sites.map((s) => {
      const plan = buildGiantPlan(s.id, s.seed);
      const [hx, hy] = plan.half;
      return {
        site: s, id: s.id, seed: s.seed, x: s.x, y: s.y, plan,
        halfX: hx, halfY: hy,
        radius: Math.hypot(hx, hy),
        giant: null, promise: null, progress: 0, error: null,
        // Widok GPU (asteroidBelt.js) i inne dane renderu.
        view: null
      };
    });
    this._hit = { depth: 0, nx: 0, ny: 0 };
    this.stats = { built: 0, building: 0, collisions: 0 };
  }

  /** Obszary bez skał gry (elipsy) — AsteroidBeltField.setExclusions (czyści cache komórek). */
  exclusions() {
    const pad = this.cfg.exclusionPad;
    return this.entries.map((e) => ({ x: e.x, y: e.y, rx: e.halfX + pad, ry: e.halfY + pad }));
  }

  applyExclusions(field = this.field) {
    field.setExclusions(this.exclusions());
  }

  /**
   * Budowa siatek olbrzymów bliskich punktom uwagi (kamera, statek gracza). Zwraca
   * liczbę rozpoczętych budów w tym wywołaniu.
   */
  requestNear(x, y, range = this.cfg.buildRange) {
    let started = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.promise || e.error) continue;
      const dx = Math.max(0, Math.abs(x - e.x) - e.halfX);
      const dy = Math.max(0, Math.abs(y - e.y) - e.halfY);
      if (dx * dx + dy * dy > range * range) continue;
      this._build(e);
      started++;
    }
    return started;
  }

  /** Buduje wszystkie (narzędzia, testy). */
  requestAll() {
    for (const e of this.entries) if (!e.promise && !e.error) this._build(e);
    return Promise.all(this.entries.map((e) => e.promise).filter(Boolean));
  }

  _build(e) {
    if (!this.builder) {
      if (!this.createBuilder) throw new Error('BeltGiants: brak fabryki GiantBuilder');
      this.builder = this.createBuilder();
    }
    const { giant, promise } = this.builder.build(e.id, e.seed, e.x, e.y, { onProgress: (p) => { e.progress = p; } });
    e.giant = giant;
    this.stats.building++;
    e.promise = promise.then(() => {
      e.progress = 1;
      this.stats.building--;
      this.stats.built++;
      return giant;
    }).catch((err) => {
      e.error = err;
      this.stats.building--;
      if (typeof console !== 'undefined') console.error(`[AsteroidBelt] olbrzym ${e.id}: ${err?.stack || err}`);
      return null;
    });
    return e.promise;
  }

  /** Olbrzym z gotową siatką SDF (kolizje, przekrój) albo null. */
  readyGiant(e) {
    return e.giant && e.giant.ready ? e.giant : null;
  }

  get readyCount() {
    let n = 0;
    for (const e of this.entries) if (e.giant && e.giant.ready) n++;
    return n;
  }

  /**
   * Kolizja statku z przekrojem z = 0 olbrzymów. body = { pos, vel, angle, w, h, radius }
   * (gracz / P2 wprost, NPC — widok kinematyki). Zwraca największą głębokość wbicia
   * (0 = bez kolizji); wypchnięcie i odbicie zapisuje w body.
   */
  collideShip(body) {
    if (!body || !body.pos) return 0;
    const px0 = body.pos.x;
    const py0 = body.pos.y;
    const rad = Number(body.radius) || 0;
    const w = Number(body.w) > 0 ? Number(body.w) : Math.max(60, rad * 2);
    const h = Number(body.h) > 0 ? Number(body.h) : Math.max(60, rad * 2);
    const L = Math.max(w, 1);
    const R = Math.max(10, h * this.cfg.hullCircleRadius);
    let maxDepth = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const giant = e.giant;
      if (!giant || !giant.ready) continue;
      if (!giant.containsWorld(px0, py0, L + giant.band)) continue;
      const a = Number(body.angle) || 0;
      const fx = Math.cos(a);
      const fy = Math.sin(a);
      for (let k = -2; k <= 2; k++) {
        const off = k * Math.max(0, L * 0.5 - R) / 2;
        const hit = giant.collideCircle(body.pos.x + fx * off, body.pos.y + fy * off, R, this._hit);
        if (!hit) continue;
        body.pos.x += hit.nx * hit.depth;
        body.pos.y += hit.ny * hit.depth;
        if (hit.depth > maxDepth) maxDepth = hit.depth;
        const vel = body.vel;
        if (vel) {
          const vn = vel.x * hit.nx + vel.y * hit.ny;
          if (vn < 0) {
            vel.x -= vn * hit.nx * this.cfg.bounce;
            vel.y -= vn * hit.ny * this.cfg.bounce;
          }
        }
      }
    }
    if (maxDepth > 0) this.stats.collisions++;
    return maxDepth;
  }

  /** Czy punkt płaszczyzny gry (z = 0) leży w skale olbrzyma (pociski). */
  pointBlocked(x, y) {
    for (let i = 0; i < this.entries.length; i++) {
      const giant = this.entries[i].giant;
      if (!giant || !giant.ready || !giant.containsWorld(x, y, 0)) continue;
      if (giant.sampleWorld(x, y, 0) < 0) return true;
    }
    return false;
  }

  /** Czy nad punktem jest strop olbrzyma (tunel / jaskinia — profil świateł CAVE). */
  roofAbove(x, y, zFrom = 300) {
    for (let i = 0; i < this.entries.length; i++) {
      const giant = this.entries[i].giant;
      if (!giant || !giant.ready || !giant.containsWorld(x, y, giant.band)) continue;
      if (giant.solidAbove(x, y, zFrom)) return true;
    }
    return false;
  }

  dispose() {
    this.builder?.dispose?.();
    this.builder = null;
  }
}
