// src/game/asteroidStorms.js
//
// Burze energetyczne w gęstych polach asteroid (logika; bez three i DOM-u).
//
// Komórki burz to wolny szum wewnątrz GĘSTYCH pól: w pełnej burzy ~30% skał
// to skały energetyczne (typ `energy`, asteroidRockKinds). Naładowane skały
// rozładowują się piorunami:
//   • łuk skała ↔ skała (zasięg rośnie z rozmiarem skał),
//   • wyładowanie skała → pył pod płaszczyzną (w chmurę),
//   • błyski w chmurach głęboko pod płaszczyzną (rozświetlają mgłę od środka).
// Przebieg pioruna jak w atmosferze: lider (piorun „rośnie” od skały),
// udar główny, 1–3 udary powrotne po tej samej ścieżce, poświata.
//
// Render i światło: src/3d/asteroids/storm.js (wstęgi HDR, błyski jako światła
// siatki, rozbłysk żył skały przy uderzeniu). Testy: tests/asteroidStorms.test.mjs.

export const STORM_CONFIG = Object.freeze({
  // Komórki burz: szum o okresie `scale` [j.], próg z miękkim brzegiem, tylko
  // w gęstych polach (od minCluster, pełna burza od fullCluster).
  scale: 170000,
  threshold: 0.58,
  softness: 0.09,
  minCluster: 0.3,
  fullCluster: 0.65,
  // Skały energetyczne: udział w pełnej burzy (warstwa gry), od tej średnicy
  // [j.]; w tle (paralaksa) × energyBackdropShare — przy równym udziale
  // fioletowe sieci pęknięć tła zalewały kadr (190 w tle na 13 w grze).
  energyShare: 0.2,
  energyMinDiameter: 120,
  energyBackdropShare: 0.3,
  // Łuk skała–skała: zasięg [j.] = arcBase + arcPerRadius × (r1 + r2), ≤ arcMax.
  arcBase: 900,
  arcPerRadius: 2.2,
  arcMax: 3400,
  // Częstość wyładowań [1/s] w pełnej burzy przy kilku skałach w kadrze.
  strikeRate: 2.4,
  cloudShare: 0.3,          // część wyładowań skała → pył
  cloudDepth: [1400, 4200], // głębokość końca wyładowania w pył [j.]
  sheetRate: 1.5,           // błyski w chmurach [1/s]
  sheetDepth: [2500, 11000],
  maxStrikes: 8,
  maxSheets: 4,
  rockCooldown: 0.7         // [s] — rozładowana skała chwilę odpoczywa
});

// ---------------------------------------------------------------------------
// Szum i hasze (deterministyczne, bez stanu)

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hash2i(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2i(ix, iy, seed);
  const b = hash2i(ix + 1, iy, seed);
  const c = hash2i(ix, iy + 1, seed);
  const d = hash2i(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function valueFbm(x, y, seed, octaves) {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    s += amp * valueNoise(x * f + o * 17.31, y * f - o * 9.73, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}

/** Liczba z [0, 1) z pozycji w świecie (decyzja „czy energetyczna” bez losowań rng komórki). */
export function stormHash01(x, y, seed) {
  return hash2i(Math.floor(x * 8), Math.floor(y * 8), (seed ^ 0x3E1E) | 0);
}

/**
 * Intensywność burzy (0..1) w punkcie: szum komórek burz × głębokość w polu.
 * cluster = sampleMacro(x, y).cluster (poza gęstym polem burzy nie ma).
 */
export function stormIntensity(seed, x, y, cluster, c = STORM_CONFIG) {
  if (!(cluster > c.minCluster)) return 0;
  const n = valueFbm(x / c.scale, y / c.scale, (seed ^ 0x57A2) | 0, 3);
  return smooth(c.threshold - c.softness, c.threshold + c.softness, n) * smooth(c.minCluster, c.fullCluster, cluster);
}

export function mulberry32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Przebieg pioruna w czasie

/**
 * Obwiednia pioruna w wieku `age` [s]: `reveal` (0..1, lider rośnie od A do B)
 * i `intensity` (udar ~1, udary powrotne, poświata). Udary po tej samej ścieżce.
 */
export function strikeEnvelope(strike, age, out = { reveal: 0, intensity: 0, stroke: -1 }) {
  const L = strike.leader;
  if (age < 0) { out.reveal = 0; out.intensity = 0; out.stroke = -1; return out; }
  if (age < L) {
    out.reveal = age / L;
    out.intensity = 0.22 + 0.1 * (age / L);
    out.stroke = -1;
    return out;
  }
  out.reveal = 1;
  let best = 0;
  let stroke = -1;
  for (let k = 0; k < strike.strokes.length; k++) {
    const s = strike.strokes[k];
    const t = age - s.at;
    if (t < 0) continue;
    // Udar: skok w ~8 ms, zanik ~45 ms.
    const e = s.amp * Math.min(1, t / 0.008) * Math.exp(-t / 0.045);
    if (e > best) { best = e; stroke = k; }
  }
  // Poświata kanału gaśnie szybko (przy τ 0,32 s kilka piorunów naraz wisiało
  // w kadrze jak neonowe rurki).
  const glow = 0.1 * Math.exp(-(age - L) / 0.12);
  out.intensity = Math.max(best, glow);
  out.stroke = stroke;
  return out;
}

/** Wiek, po którym piorun zgasł. */
export function strikeDuration(strike) {
  const last = strike.strokes.length ? strike.strokes[strike.strokes.length - 1].at : strike.leader;
  return Math.max(last + 0.25, strike.leader + 0.45);
}

// ---------------------------------------------------------------------------
// Kształt błyskawicy (ścieżka główna + rozgałęzienia)

/**
 * Błyskawica A → B: przemieszczenie środków (poziomy `levels`, amplituda
 * maleje ×0,55 na poziom) w płaszczyźnie ⟂ odcinka + trochę w z, do tego
 * rozgałęzienia w bok. Każdy łańcuch: punkty (x, y, z) i `t` — położenie
 * wzdłuż ścieżki głównej (lider odsłania łańcuch od t0), `w` — szerokość
 * i jasność (główny 1, gałęzie mniej).
 * @returns {{points: Float64Array, t: Float32Array, count: number, w: number}[]}
 */
export function buildBoltChains(ax, ay, az, bx, by, bz, seed, opts = {}) {
  const rng = mulberry32(seed);
  const levels = opts.levels ?? 6;
  const jag = opts.jag ?? 0.28;
  const branches = opts.branches ?? 3;
  const main = midpointChain(ax, ay, az, bx, by, bz, levels, jag, rng);
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const chains = [{ points: main.points, t: main.t, count: main.count, w: 1 }];
  const n = main.count;
  for (let b = 0; b < branches; b++) {
    // Korzeń gałęzi w środkowej części ścieżki, odchylenie 20–55°, długość 15–45%.
    const i = Math.min(n - 2, Math.max(1, Math.floor(n * (0.15 + rng() * 0.6))));
    const px = main.points[i * 3];
    const py = main.points[i * 3 + 1];
    const pz = main.points[i * 3 + 2];
    const dx = main.points[(i + 1) * 3] - px;
    const dy = main.points[(i + 1) * 3 + 1] - py;
    const dl = Math.hypot(dx, dy) || 1;
    const ang = (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.6);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const bl = len * (0.15 + rng() * 0.3);
    const ex = px + (dx / dl * ca - dy / dl * sa) * bl;
    const ey = py + (dx / dl * sa + dy / dl * ca) * bl;
    const ez = pz - bl * (0.1 + rng() * 0.3);
    const br = midpointChain(px, py, pz, ex, ey, ez, Math.max(3, levels - 2), jag * 1.1, rng);
    const t0 = main.t[i];
    const span = bl / Math.max(1, len);
    for (let k = 0; k < br.count; k++) br.t[k] = t0 + br.t[k] * span;
    chains.push({ points: br.points, t: br.t, count: br.count, w: 0.45 + rng() * 0.2 });
  }
  return chains;
}

function midpointChain(ax, ay, az, bx, by, bz, levels, jag, rng) {
  let pts = [ax, ay, az, bx, by, bz];
  let amp = jag;
  for (let l = 0; l < levels; l++) {
    const next = [];
    const segs = pts.length / 3 - 1;
    for (let s = 0; s < segs; s++) {
      const x0 = pts[s * 3]; const y0 = pts[s * 3 + 1]; const z0 = pts[s * 3 + 2];
      const x1 = pts[s * 3 + 3]; const y1 = pts[s * 3 + 4]; const z1 = pts[s * 3 + 5];
      const dx = x1 - x0; const dy = y1 - y0;
      const seg = Math.hypot(dx, dy, z1 - z0);
      const pl = Math.hypot(dx, dy) || 1;
      // Odchylenie w płaszczyźnie gry ⟂ odcinka (z góry widać zygzak) + trochę w z.
      const off = (rng() * 2 - 1) * amp * seg;
      next.push(x0, y0, z0, (x0 + x1) * 0.5 - dy / pl * off, (y0 + y1) * 0.5 + dx / pl * off, (z0 + z1) * 0.5 + (rng() * 2 - 1) * amp * seg * 0.4);
    }
    next.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
    pts = next;
    amp *= 0.55;
  }
  const count = pts.length / 3;
  const points = Float64Array.from(pts);
  const t = new Float32Array(count);
  let acc = 0;
  for (let k = 1; k < count; k++) {
    acc += Math.hypot(points[k * 3] - points[k * 3 - 3], points[k * 3 + 1] - points[k * 3 - 2], points[k * 3 + 2] - points[k * 3 - 1]);
    t[k] = acc;
  }
  for (let k = 1; k < count; k++) t[k] /= acc || 1;
  t[count - 1] = 1;
  return { points, t, count };
}

// ---------------------------------------------------------------------------
// Symulacja: kiedy i gdzie uderza

let _strikeId = 1;

export class StormSimulator {
  /**
   * @param {object} [config] nadpisania STORM_CONFIG
   * @param {number} [seed]
   */
  constructor(config = {}, seed = 0x5707) {
    this.config = { ...STORM_CONFIG, ...config };
    this.rng = mulberry32(seed);
    this.time = 0;
    this.strikes = [];
    this.sheets = [];
    this.cooldown = new Map();   // id skały → czas końca odpoczynku
    this.enabled = true;
    this.rateScale = 1;
    this.stats = { strikes: 0, sheets: 0, candidates: 0 };
    this._ready = [];
  }

  /**
   * @param {number} dt [s]
   * @param {{id:number,x:number,y:number,z:number,r:number}[]} rocks skały energetyczne przy kadrze
   * @param {number} storm intensywność burzy w kadrze (0..1)
   * @param {{x:number,y:number,halfW:number,halfH:number}} view kadr [j. świata] z zapasem
   */
  update(dt, rocks, storm, view) {
    const c = this.config;
    this.time += dt;
    const now = this.time;
    // Zgasłe pioruny i błyski (w miejscu, bez nowych tablic co klatkę).
    dropExpired(this.strikes, now);
    dropExpired(this.sheets, now);
    for (const [id, until] of this.cooldown) if (until < now) this.cooldown.delete(id);
    if (!this.enabled || !(storm > 0.02) || !(dt > 0)) return;
    const k = this.rateScale * storm;
    // Wyładowania skał (Poisson; częstość rośnie z liczbą naładowanych skał, do nasycenia).
    const ready = this._ready;
    ready.length = 0;
    for (let i = 0; i < rocks.length; i++) if (!this.cooldown.has(rocks[i].id)) ready.push(rocks[i]);
    this.stats.candidates = ready.length;
    const rockRate = c.strikeRate * k * Math.min(1, ready.length / 4);
    let n = poissonSmall(rockRate * dt, this.rng);
    while (n-- > 0 && this.strikes.length < c.maxStrikes && ready.length) {
      const s = this._spawnStrike(ready, now);
      if (s) this.strikes.push(s);
    }
    // Błyski w chmurach w kadrze (niezależnie od skał w pobliżu).
    let m = poissonSmall(c.sheetRate * k * dt, this.rng);
    while (m-- > 0 && this.sheets.length < c.maxSheets && view) {
      this.sheets.push(this._spawnSheet(view, now));
    }
  }

  _spawnStrike(ready, now) {
    const c = this.config;
    const rng = this.rng;
    const a = ready[Math.floor(rng() * ready.length)];
    if (!a) return null;
    // Partner w zasięgu łuku (najbliższy z kilku losowych), inaczej w pył.
    let b = null;
    if (rng() >= c.cloudShare) {
      let bestD = Infinity;
      for (let tries = 0; tries < Math.min(12, ready.length * 2); tries++) {
        const o = ready[Math.floor(rng() * ready.length)];
        if (!o || o === a) continue;
        const d = Math.hypot(o.x - a.x, o.y - a.y);
        const reach = Math.min(c.arcMax, c.arcBase + c.arcPerRadius * (a.r + o.r));
        if (d < reach && d < bestD) { bestD = d; b = o; }
      }
    }
    const seed = (rng() * 4294967296) >>> 0;
    let ax = a.x; let ay = a.y; let az = a.z;
    let bx; let by; let bz;
    let kind;
    if (b) {
      kind = 'arc';
      // Końce na powierzchniach skał zwróconych do siebie.
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / d;
      const uy = (b.y - a.y) / d;
      ax += ux * a.r * 0.85; ay += uy * a.r * 0.85;
      bx = b.x - ux * b.r * 0.85; by = b.y - uy * b.r * 0.85; bz = b.z;
      this.cooldown.set(b.id, now + c.rockCooldown * (0.6 + rng() * 0.8));
    } else {
      kind = 'cloud';
      const ang = rng() * Math.PI * 2;
      const reach = (a.r * 1.5 + 700 + rng() * 1400);
      ax += Math.cos(ang) * a.r * 0.85; ay += Math.sin(ang) * a.r * 0.85;
      bx = a.x + Math.cos(ang) * reach;
      by = a.y + Math.sin(ang) * reach;
      bz = a.z - (c.cloudDepth[0] + rng() * (c.cloudDepth[1] - c.cloudDepth[0]));
    }
    this.cooldown.set(a.id, now + c.rockCooldown * (0.6 + rng() * 0.8));
    // Lider 35–70 ms, udar główny, 0–3 udary powrotne w ciągu ~0,4 s.
    const leader = 0.035 + rng() * 0.035;
    const strokes = [{ at: leader, amp: 1 }];
    const extra = Math.floor(rng() * 3.2);
    let at = leader;
    for (let i = 0; i < extra; i++) {
      at += 0.06 + rng() * 0.14;
      strokes.push({ at, amp: 0.55 + rng() * 0.45, seed: (rng() * 4294967296) >>> 0 });
    }
    const strike = {
      id: _strikeId++, kind, t0: now, seed, leader, strokes,
      ax, ay, az, bx, by, bz,
      length: Math.hypot(bx - ax, by - ay, bz - az),
      rockA: a.id, rockB: b ? b.id : -1,
      // Środki i promienie skał końców (iskry w miejscu uderzenia lecą od środka skały).
      acx: a.x, acy: a.y, ar: a.r,
      bcx: b ? b.x : bx, bcy: b ? b.y : by, br: b ? b.r : 0,
      duration: 0
    };
    strike.duration = strikeDuration(strike);
    this.stats.strikes++;
    return strike;
  }

  _spawnSheet(view, now) {
    const c = this.config;
    const rng = this.rng;
    const pulses = [];
    let at = 0;
    const count = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      pulses.push({ at, amp: 0.5 + rng() * 0.5 });
      at += 0.04 + rng() * 0.12;
    }
    const depth = c.sheetDepth[0] + rng() * (c.sheetDepth[1] - c.sheetDepth[0]);
    this.stats.sheets++;
    return {
      id: _strikeId++, t0: now, pulses, duration: at + 0.35,
      x: view.x + (rng() * 2 - 1) * view.halfW,
      y: view.y + (rng() * 2 - 1) * view.halfH,
      z: -depth,
      range: depth * (0.8 + rng() * 0.5) + 3000
    };
  }
}

/** Jasność błysku w chmurze w wieku age (kilka szybkich pulsów + poświata). */
export function sheetEnvelope(sheet, age) {
  let e = 0;
  for (const p of sheet.pulses) {
    const t = age - p.at;
    if (t < 0) continue;
    e = Math.max(e, p.amp * Math.min(1, t / 0.012) * Math.exp(-t / 0.07));
  }
  return e;
}

function dropExpired(list, now) {
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (now - s.t0 < s.duration) list[w++] = s;
  }
  list.length = w;
}

function poissonSmall(lambda, rng) {
  if (!(lambda > 0)) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= rng(); } while (p > L && k < 20);
  return k - 1;
}
