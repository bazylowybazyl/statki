// src/game/cometField.js
//
// KOMETY W GRZE — miejsca, budowa jąder (worker), obrót jądra, kolizje i zapytania (bez three i DOM; testy:
// tests/comets.test.mjs). Logika orbit i gazu: comets.js, kształt jądra: cometNucleus.js, obraz: src/3d/comets/.
//
// JĄDRO = PRZESZKODA w płaszczyźnie gry jak olbrzymy pasa (asteroidBeltGiants.collideShip): statek jako koła
// wzdłuż osi kadłuba, wypchnięcie o głębokość wbicia, składowa prędkości w głąb odbita (× 1,3) — BEZ obrażeń
// (jak olbrzymy; decyzja do oceny użytkownika). Kształt kolizji = OBRYS Z GÓRY bryły (największy promień rzutu
// w koszykach kąta, obracany z jądrem) — kadłub nigdy nie wjeżdża w widoczną bryłę. Pociski gasną w obrysie
// (`pointBlocked`). Do zbudowania jądra (worker, ~0,3 s) kometa nie koliduje — jak olbrzym przed `ready`.
//
// OBRÓT: kąt jądra w układzie SCENY (x, −y gry; obrót wokół osi z sceny) = 2π · t / okres z czasu gry
// (SimClock.sim — w pauzie stoi). Punkt gry (dx, dy) względem jądra leży w układzie bryły pod kątem
// atan2(−dy, dx) − spin.
//
// API na później (komety pasa głównego — aktywne asteroidy jako znacznik lodu dla skanera): `addSite(def, x, y)`
// przyjmuje kometę spoza tabeli (orbita może być pusta), `iceSources(x, y, r, out)` zwraca miejsca z lodem
// w promieniu (dziś: wszystkie jądra komet — lód wody pod pyłem).

import { COMETS, COMET_TUNE, realAuToMapAu } from '../data/comets.js';
import { cometOrbitState, cometGasGeometry, placeComets } from './comets.js';
import { buildNucleusAssets, outlineRadiusAt } from './cometNucleus.js';

const TAU = Math.PI * 2;

export class CometField {
  /**
   * @param {object} o
   * @param {{x:number,y:number}} o.sun Słońce gry
   * @param {number} o.au j. gry na AU mapy
   * @param {Array<{x:number,y:number,r:number}>} [o.keepOut] strefy zakazane (planety, księżyce, L4/L5)
   * @param {(x:number, y:number, need:number) => boolean} [o.avoid] miejsce zajęte (gęste pola pasa w ich kształcie)
   * @param {Array} [o.defs] komety (domyślnie COMETS)
   * @param {boolean} [o.useWorkers] budowa jąder w workerze (domyślnie, gdy jest Worker)
   */
  constructor({ sun, au, keepOut = [], avoid = null, defs = COMETS, useWorkers = true, tune = COMET_TUNE } = {}) {
    this.sun = { x: Number(sun?.x) || 0, y: Number(sun?.y) || 0 };
    this.au = Number(au) || 42253.52;
    this.tune = tune;
    this.sites = [];
    this.readyCount = 0;
    this.time = 0;
    this.useWorkers = useWorkers && typeof Worker !== 'undefined';
    this._workers = new Set();
    this._hit = { depth: 0, nx: 0, ny: 0 };
    this.stats = { collisions: 0, buildMs: 0, blocked: [] };
    this.onSiteReady = null;   // (site) => void — obraz podpina bryłę
    const placed = placeComets(defs, { sunX: this.sun.x, sunY: this.sun.y, au: this.au, keepOut, avoid, tune });
    for (const p of placed) {
      if (p.blocked) this.stats.blocked.push(p.def.id);
      this._addPlaced(p);
    }
  }

  _addPlaced(p) {
    const def = p.def;
    const site = {
      id: def.id,
      index: this.sites.length,
      def,
      label: def.label,
      x: p.x, y: p.y,
      state: p.state,
      geo: p.geo,
      offset: p.offset,
      R: def.nucleus.radius,
      spin: 0,
      omega: TAU / Math.max(1, Number(def.nucleus.rotPeriod) || 300),
      outline: null,
      surface: null,
      grid: null,
      ready: false,
      // zasięg obrysu (koło ograniczające) — do szybkich testów; do gotowości promień jądra
      reach: def.nucleus.radius * 1.4
    };
    this.sites.push(site);
    return site;
  }

  /** Kometa spoza tabeli (np. aktywna asteroida pasa głównego) w zadanym miejscu świata gry. */
  addSite(def, x, y) {
    const st = def.orbit ? cometOrbitState(def, 0, this.tune) : {
      rAu: 3, rMap: 40, theta: 0, ux: 1, uy: 0, vx: 0, vy: 1, nu: 0, vKm: 18, vPerpKm: 18, omega: 4e-8, activity: 0
    };
    if (!def.orbit) {
      const dx = x - this.sun.x, dy = y - this.sun.y, d = Math.hypot(dx, dy) || 1;
      st.ux = dx / d; st.uy = dy / d; st.vx = -st.uy; st.vy = st.ux; st.rMap = d / this.au;
    }
    const geo = cometGasGeometry(def, st, this.au, this.tune);
    const site = this._addPlaced({ def, offset: 0, state: st, geo, x, y });
    if (this._building) this._buildSite(site);
    return site;
  }

  /** Budowa jąder (worker albo od razu). Zwraca Promise wszystkich. */
  build() {
    this._building = true;
    return Promise.all(this.sites.map((s) => this._buildSite(s)));
  }

  _buildSite(site) {
    if (site._promise) return site._promise;
    const opts = { N: site.R > 5000 ? 52 : 44, bins: 256, gridN: 48 };
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const finish = (surface, grid) => {
      site.surface = surface;
      site.grid = grid;
      site.outline = surface.outline;
      let m = 0;
      for (let i = 0; i < surface.outline.length; i++) m = Math.max(m, surface.outline[i]);
      site.reach = m * site.R;
      site.ready = true;
      this.readyCount++;
      // najdłuższa budowa (workery liczą równolegle)
      this.stats.buildMs = Math.max(this.stats.buildMs, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      if (this.onSiteReady) this.onSiteReady(site);
      return site;
    };
    if (!this.useWorkers) {
      const { surface, grid } = buildNucleusAssets(site.def.nucleus, opts);
      site._promise = Promise.resolve(finish(surface, grid));
      return site._promise;
    }
    // osobny worker na kometę (równolegle, ~0,3–0,6 s każdy), zamykany po wyniku
    site._promise = new Promise((resolve, reject) => {
      const w = new Worker(new URL('./cometNucleusWorker.js', import.meta.url), { type: 'module', name: `comet-nucleus-${site.id}` });
      this._workers.add(w);
      const done = () => { w.terminate(); this._workers.delete(w); };
      w.onmessage = (e) => { done(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data); };
      w.onerror = (e) => { done(); reject(new Error(e.message || 'cometNucleusWorker')); };
      w.postMessage({ job: site.index, nucleus: site.def.nucleus, opts });
    }).then((d) => finish(d.surface, d.grid)).catch((err) => {
      console.error('[Komety] budowa jądra', site.id, err);
      return site;
    });
    return site._promise;
  }

  /** Czas gry [s] (SimClock.sim) — obrót jąder. */
  update(simTime) {
    const t = Number(simTime) || 0;
    this.time = t;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      s.spin = ((s.omega * t) % TAU + TAU) % TAU;
    }
  }

  /** Promień obrysu jądra (j. gry) w kierunku punktu (dx, dy) gry względem jądra. */
  outlineRadius(site, dx, dy) {
    if (!site.outline) return 0;
    return outlineRadiusAt(site.outline, Math.atan2(-dy, dx) - site.spin) * site.R;
  }

  /** Koło (x, y, r) gry kontra obrys jądra: { depth, nx, ny } (normalna w świecie gry) albo null. */
  collideCircle(site, x, y, r, out = this._hit) {
    const dx = x - site.x, dy = y - site.y;
    const d = Math.hypot(dx, dy);
    if (d > site.reach + r || !site.outline) return null;
    const a = Math.atan2(-dy, dx) - site.spin;
    const R0 = outlineRadiusAt(site.outline, a) * site.R;
    const depth = R0 + r - d;
    if (depth <= 0) return null;
    // normalna: promień + nachylenie obrysu (dR/dθ) — w układzie sceny, potem gra (y odbite)
    const da = 0.02;
    const dR = (outlineRadiusAt(site.outline, a + da) - outlineRadiusAt(site.outline, a - da)) * site.R / (2 * da);
    const th = Math.atan2(-dy, dx);
    const rx = Math.cos(th), ry = Math.sin(th);          // promień (scena)
    const tx = -ry, ty = rx;                              // styczna (scena)
    let nx = rx - tx * dR / Math.max(1, R0);
    let ny = ry - ty * dR / Math.max(1, R0);
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    out.depth = depth;
    out.nx = nx;
    out.ny = -ny;
    if (d < 1e-6) { out.nx = 1; out.ny = 0; }
    return out;
  }

  /**
   * Kolizja statku z jądrami (body = { pos, vel, angle, w, h, radius } — jak olbrzymy pasa). Zwraca największą
   * głębokość wbicia (0 = bez kolizji); wypchnięcie i odbicie zapisuje w body.
   */
  collideShip(body) {
    if (!body || !body.pos || this.readyCount === 0) return 0;
    const px0 = body.pos.x;
    const py0 = body.pos.y;
    const rad = Number(body.radius) || 0;
    const w = Number(body.w) > 0 ? Number(body.w) : Math.max(60, rad * 2);
    const h = Number(body.h) > 0 ? Number(body.h) : Math.max(60, rad * 2);
    const L = Math.max(w, 1);
    const R = Math.max(10, h * this.tune.hullCircle);
    const span = Math.max(0, L * 0.5 - R);
    let maxDepth = 0;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      if (!s.ready) continue;
      const dx0 = px0 - s.x, dy0 = py0 - s.y;
      const lim = s.reach + L;
      if (dx0 * dx0 + dy0 * dy0 > lim * lim) continue;
      const a = Number(body.angle) || 0;
      const fx = Math.cos(a), fy = Math.sin(a);
      const nA = Math.min(16, Math.max(5, Math.ceil((2 * span) / (0.75 * R)) + 1));
      for (let k = 0; k < nA; k++) {
        const off = -span + (2 * span * k) / (nA - 1);
        const hit = this.collideCircle(s, body.pos.x + fx * off, body.pos.y + fy * off, R, this._hit);
        if (!hit) continue;
        body.pos.x += hit.nx * hit.depth;
        body.pos.y += hit.ny * hit.depth;
        if (hit.depth > maxDepth) maxDepth = hit.depth;
        const vel = body.vel;
        if (vel) {
          const vn = vel.x * hit.nx + vel.y * hit.ny;
          if (vn < 0) {
            vel.x -= vn * hit.nx * this.tune.bounce;
            vel.y -= vn * hit.ny * this.tune.bounce;
          }
        }
      }
    }
    if (maxDepth > 0) this.stats.collisions++;
    return maxDepth;
  }

  /** Czy punkt płaszczyzny gry leży w obrysie jądra (pociski). */
  pointBlocked(x, y) {
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      if (!s.ready) continue;
      const dx = x - s.x, dy = y - s.y;
      if (dx * dx + dy * dy > s.reach * s.reach) continue;
      if (Math.hypot(dx, dy) < this.outlineRadius(s, dx, dy)) return true;
    }
    return false;
  }

  /** Najbliższa kometa (odległość od jądra). */
  nearest(x, y) {
    let best = null, bd = Infinity;
    for (const s of this.sites) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { site: best, distance: bd } : null;
  }

  /** Źródła lodu w promieniu (skaner — na później): wpisuje { site, distance } do out. */
  iceSources(x, y, r, out = []) {
    out.length = 0;
    for (const s of this.sites) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d <= r + s.reach) out.push({ site: s, distance: d });
    }
    return out;
  }

  /**
   * Tor orbity w świecie gry (mapa CIC): Float64Array [x, y, …] — ν od −ν_max do ν_max, gdzie r ≤ min(aphelium,
   * 45 AU) (dalej mapa się kończy). Raz na kometę (pamięć w site).
   */
  orbitPath(site, n = 160) {
    if (site._orbitPath) return site._orbitPath;
    const o = site.def.orbit;
    if (!o) return (site._orbitPath = new Float64Array(0));
    const p = o.q * (1 + o.e);
    const Q = o.e < 1 ? p / (1 - o.e) : Infinity;
    const rMax = Math.min(Q * 0.999, 45);
    const nuMax = Math.acos(Math.max(-1, Math.min(1, (p / rMax - 1) / o.e)));
    const dir = o.dir < 0 ? -1 : 1;
    const w = (Number(o.perihelionDeg) || 0) * Math.PI / 180 + (site.offset || 0);
    const out = new Float64Array(2 * (n + 1));
    for (let i = 0; i <= n; i++) {
      const nu = -nuMax + 2 * nuMax * i / n;
      const r = p / (1 + o.e * Math.cos(nu));
      const rm = realAuToMapAu(r) * this.au;
      const th = w + dir * nu;
      out[2 * i] = this.sun.x + Math.cos(th) * rm;
      out[2 * i + 1] = this.sun.y + Math.sin(th) * rm;
    }
    site._orbitPath = out;
    return out;
  }

  /**
   * Punkty orientacyjne (radar, mapa CIC): jądro, kierunek i długość warkoczy w świecie gry.
   * Warkocz jonowy: od jądra wzdłuż (ionX, ionY); pyłowy: łuk od osi antysłonecznej do najstarszej synchrony.
   */
  landmarks(out = []) {
    out.length = 0;
    for (const s of this.sites) {
      const g = s.geo;
      const yx = -g.ay * g.lagSign, yy = g.ax * g.lagSign;      // oś „za ruchem” w świecie gry
      const ci = Math.cos(g.ionAngle), si = Math.sin(g.ionAngle);
      const cd = Math.cos(g.dustAngle * 0.5), sd = Math.sin(g.dustAngle * 0.5);
      out.push({
        id: s.id, label: s.label, radarName: s.def.radarName || s.id.toUpperCase(), designation: s.def.designation, family: s.def.familyLabel,
        x: s.x, y: s.y, radius: s.reach, active: g.active, activity: g.activity, rAu: s.state.rAu,
        comaR: g.comaR,
        ionX: g.ax * ci + yx * si, ionY: g.ay * ci + yy * si, ionLen: g.ionLen,
        dustX: g.ax * cd + yx * sd, dustY: g.ay * cd + yy * sd, dustLen: g.dustLen, dustAngle: g.dustAngle,
        axisX: g.ax, axisY: g.ay, lagX: yx, lagY: yy, site: s,
        orbit: this.orbitPath(s)
      });
    }
    return out;
  }

  dispose() {
    for (const w of this._workers) w.terminate();
    this._workers.clear();
  }
}
