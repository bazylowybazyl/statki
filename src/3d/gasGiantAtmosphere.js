// src/3d/gasGiantAtmosphere.js
//
// Żywa atmosfera gazowego olbrzyma — silnik wspólny dla Jowisza (jupiterAtmosphere.js) i Saturna
// (saturnAtmosphere.js), strona CPU. Shader: gasGiantAtmosphere.tsl.js (barwa dnia w grafie powierzchni planety).
// Planeta podaje MODEL (profil wiatru, granice pasów, wiry, opcjonalnie czapy polarne, strojenie, klucze uniformów,
// nazwy buforów) — reszta jest wspólna. Opis ruchu (ruch sztywny pasów i wirów w double + reszta z dwiema fazami
// w shaderze): jupiterAtmosphere.js.
//
// CZAPY POLARNE (Saturn): za szerokością `cap` ruch po okręgach wokół bieguna liczy shader we współrzędnych
// azymutalnych (siatka równoodległa przy biegunie: cos φ → 0, pasy w u nie działają). Jądro wiru polarnego (ρ < core)
// obraca się sztywnie bez końca (kąt w double tutaj, jak jądro GRS), reszta czapy płynie fazami po LINIACH PRĄDU:
// okręgach albo (biegun N Saturna) sześciokącie — dżet sześciokątny stoi w Systemie III, a chmury płyną wzdłuż
// jego boków. Pas-segment nad czapą ma prędkość sztywną 0 (czapa nie jedzie), więc szew czapy z pasami nie narasta.
import * as THREE from 'three/webgpu';
import { uniformArray } from 'three/tsl';
import { SimClock } from '../game/simClock.js';

const D2R = Math.PI / 180;

// Okno zegara faz: s = t / T mod GAS_PHASE_WRAP (float32 w shaderze). Ziarno turbulencji = floor(s) mod
// GAS_SEED_WRAP — dzielnik okna, więc zawinięcie s nie zmienia ziarna w środku fazy.
export const GAS_PHASE_WRAP = 1024;
export const GAS_SEED_WRAP = 64;
// Rekord wiru w tablicy uniformów: 3 × vec4 (vortexRecords).
export const GAS_VORTEX_VEC4 = 3;
// Maska wiru: jądro obracane sztywnie do ρ = coreIn…coreOut, cały wir (z kołnierzem) do ρ = edgeIn…edgeOut.
export const GAS_VORTEX_MASK = Object.freeze({ coreIn: 0.45, coreOut: 0.8, edgeIn: 0.98, edgeOut: 1.25 });

/** Wagi dwóch faz dla zegara s (lustro shadera): { f0, f1, w0, w1 } — w0 + w1 = 1, waga fazy = 0 przy jej zerowaniu. */
export function phaseWeights(s) {
  const f0 = s - Math.floor(s);
  const f1 = (s + 0.5) - Math.floor(s + 0.5);
  const w0 = 1 - Math.abs(2 * f0 - 1);
  return { f0, f1, w0, w1: 1 - w0 };
}

/**
 * Prędkość kątowa wiru na promieniu eliptycznym ρ (obrzeże owalu ρ = 1; lustro shadera): wnętrze `core` × obrzeże,
 * najszybciej w kołnierzu (ρ ≥ 0,8), za brzegiem gaśnie do zera przy ρ = 1,4.
 */
export function vortexOmega(rho, omegaEdge, core) {
  const t = Math.min(1, Math.max(0, rho / 0.8));
  const ramp = t * t * (3 - 2 * t);
  const o = Math.min(1, Math.max(0, (rho - 0.95) / 0.45));
  return omegaEdge * (core + (1 - core) * ramp) * (1 - o * o * (3 - 2 * o));
}
/**
 * Obrót sztywny JĄDRA wiru (ułamek prędkości obrzeża) = prędkość wnętrza `core`; bez obrotu sztywnego 0. Jądro
 * (ρ < 0,45…0,8) obraca się spójnie bez końca, kołnierz płynie resztą z dwiema fazami (szybciej, w miejscu).
 */
export const vortexRigid = (core, rigid = true) => (rigid ? core : 0);

/** Prędkość kątowa wiatru `w` [m/s] w u mapy [obwody na sekundę RZECZYWISTĄ] na szerokości φc [°]. */
export function zonalOmegaU(w, radius, latDeg) {
  return w / (2 * Math.PI * radius * Math.max(Math.cos(latDeg * D2R), 0.05));
}

/** Wiatr z tabeli co `step` stopni od −90° (interpolacja liniowa). */
export function tableWind(table, step, latDeg) {
  const x = (Math.min(90, Math.max(-90, latDeg)) + 90) / step;
  const i = Math.min(table.length - 2, Math.floor(x));
  const t = x - i;
  return table[i] + (table[i + 1] - table[i]) * t;
}

/**
 * Lokalne minima profilu (granice pasów-segmentów) z progiem: minimum liczy się, gdy najbliższe szczyty po obu
 * stronach są wyżej o co najmniej `depth` m/s (płytkie dołki w środku dżetu nie tną pasa).
 */
export function profileMinima(windAt, from = -89.5, to = 89.5, step = 0.25, depth = 12) {
  const xs = [];
  for (let x = from; x <= to + 1e-9; x += step) xs.push(x);
  const w = xs.map(windAt);
  const out = [];
  for (let i = 1; i < xs.length - 1; i++) {
    if (!(w[i] < w[i - 1] && w[i] <= w[i + 1])) continue;
    let left = w[i];
    for (let k = i - 1; k >= 0 && w[k] >= w[k + 1] - 1e-9; k--) left = Math.max(left, w[k]);
    let right = w[i];
    for (let k = i + 1; k < xs.length && w[k] >= w[k - 1] - 1e-9; k++) right = Math.max(right, w[k]);
    if (left - w[i] >= depth && right - w[i] >= depth) out.push(xs[i]);
  }
  return out;
}

/**
 * Pasy-segmenty ruchu sztywnego: [{ lo, hi (φc °), omega (u na s rzeczywistą), plateau, polar }] rosnąco, pokrywają
 * [−90°, 90°]. `cuts` — granice (z ±90), w przedziale między granicami dodatkowe cięcia, gdy wiatr w segmencie
 * rozjeżdża się o więcej niż `maxSpread` m/s (szeroki dżet równikowy Saturna — reszta prędkości w fazach zostaje
 * mała). Wiry: plateau [φ − b·zasięg − zapas, φ + …] ze stałą prędkością dryfu (nakładające się plateau łączą się —
 * prędkość = średnia), resztki węższe niż minDeg dołączone do sąsiada. Czapy polarne (`polar` = { north, south } —
 * szerokości granic): segment za granicą ma prędkość 0.
 */
export function bandSegments({ windAt, cuts, radius, vortices, cfg, maxSpread = Infinity, polar = null }) {
  const omegaAt = (lat) => zonalOmegaU(windAt(lat), radius, lat);
  const meanOmega = (lo, hi) => {
    const n = 96;
    let s = 0;
    for (let k = 0; k < n; k++) s += omegaAt(lo + (hi - lo) * (k + 0.5) / n);
    return s / n;
  };
  let allCuts = [...cuts];
  if (polar) allCuts.push(polar.south, polar.north);
  allCuts = [...new Set(allCuts)].sort((a, b) => a - b);
  // dodatkowe cięcia w przedziałach z dużym rozrzutem wiatru (poza czapami)
  if (Number.isFinite(maxSpread)) {
    const extra = [];
    for (let i = 0; i < allCuts.length - 1; i++) {
      const lo = allCuts[i];
      const hi = allCuts[i + 1];
      if (polar && (hi <= polar.south || lo >= polar.north)) continue;
      let wMin = Infinity;
      let wMax = -Infinity;
      let start = lo;
      for (let x = lo; x < hi; x += 0.1) {
        const w = windAt(x);
        wMin = Math.min(wMin, w);
        wMax = Math.max(wMax, w);
        if (wMax - wMin > maxSpread && x - start > cfg.minDeg && hi - x > cfg.minDeg) {
          extra.push(x);
          start = x;
          wMin = wMax = w;
        }
      }
    }
    allCuts = [...allCuts, ...extra].sort((a, b) => a - b);
  }
  const isPolar = (lo, hi) => !!polar && (hi <= polar.south + 1e-9 || lo >= polar.north - 1e-9);
  // plateau wirów (połączone, gdy się nakładają)
  const plats = [];
  for (const v of [...vortices].sort((a, b) => a.lat - b.lat)) {
    const half = v.b * cfg.vortexReach + cfg.blendDeg + cfg.vortexPad;
    const om = v.drift == null ? omegaAt(v.lat) : v.drift / (2 * Math.PI * radius * Math.cos(v.lat * D2R));
    const last = plats[plats.length - 1];
    if (last && v.lat - half <= last.hi) {
      last.hi = Math.max(last.hi, v.lat + half);
      last.sum += om; last.n++;
    } else plats.push({ lo: v.lat - half, hi: v.lat + half, sum: om, n: 1 });
  }
  // segmenty: przedziały między granicami, przycięte plateau
  let segs = [];
  for (let i = 0; i < allCuts.length - 1; i++) {
    let parts = [[allCuts[i], allCuts[i + 1]]];
    for (const p of plats) {
      const next = [];
      for (const [lo, hi] of parts) {
        if (hi <= p.lo || lo >= p.hi) { next.push([lo, hi]); continue; }
        if (lo < p.lo) next.push([lo, p.lo]);
        if (hi > p.hi) next.push([p.hi, hi]);
      }
      parts = next;
    }
    for (const [lo, hi] of parts) if (hi - lo > 1e-6) segs.push({ lo, hi, plateau: false, polar: isPolar(lo, hi) });
  }
  for (const p of plats) segs.push({ lo: p.lo, hi: p.hi, plateau: true, polar: false, omega: p.sum / p.n });
  segs.sort((a, b) => a.lo - b.lo);
  // resztki węższe niż minDeg — do sąsiada o najbliższej prędkości (najpierw zwykłego, plateau i czapa tylko
  // w ostateczności)
  for (let guard = 0; guard < 96; guard++) {
    const k = segs.findIndex((s) => !s.plateau && !s.polar && s.hi - s.lo < cfg.minDeg);
    if (k < 0) break;
    const s = segs[k];
    const own = meanOmega(s.lo, s.hi);
    const near = [segs[k - 1], segs[k + 1]].filter(Boolean);
    const plain = near.filter((n) => !n.plateau && !n.polar);
    const pool = plain.length ? plain : near;
    if (!pool.length) break;
    const speed = (n) => (n.polar ? 0 : (n.plateau ? n.omega : meanOmega(n.lo, n.hi)));
    const into = pool.reduce((best, n) => (Math.abs(speed(n) - own) < Math.abs(speed(best) - own) ? n : best));
    into.lo = Math.min(into.lo, s.lo);
    into.hi = Math.max(into.hi, s.hi);
    segs.splice(k, 1);
  }
  for (const s of segs) {
    if (s.polar) s.omega = 0;
    else if (!s.plateau) s.omega = meanOmega(s.lo, s.hi);
  }
  return segs.map((s) => ({ lo: s.lo, hi: s.hi, omega: s.omega, plateau: s.plateau, polar: !!s.polar }));
}

/** Indeks segmentu zawierającego szerokość φc [°]. */
export function bandIndex(segs, latDeg) {
  for (let i = 0; i < segs.length; i++) if (latDeg < segs[i].hi) return i;
  return segs.length - 1;
}

/**
 * Rekordy wirów dla shadera: 3 × vec4 na wir (A = u środka, v środka, półoś a w u, półoś b w v;
 * B = prędkość kątowa obrzeża [rad na sekundę RZECZYWISTĄ, ze znakiem zwrotu], core, kąt obrotu sztywnego
 * (pisze atmosfera co klatkę), indeks segmentu-plateau; C = część sztywna, 0, 0, 0). Wolne miejsca — zera
 * (a = 0: shader pomija).
 */
export function vortexRecords(list, cap, segs) {
  const out = [];
  for (let i = 0; i < cap; i++) {
    const v = list[i];
    if (!v) { out.push([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]); continue; }
    const omega = v.sense * 2 * Math.PI / (v.periodDays * 86400);
    out.push([v.u / 360, (v.lat + 90) / 180, v.a / 360, v.b / 180], [omega, v.core, 0, bandIndex(segs, v.lat)],
      [vortexRigid(v.core, v.rigid !== false), 0, 0, 0]);
  }
  return out;
}

/**
 * Rekordy pasów dla shadera: vec4 na segment (x = górna granica w v, y = przesunięcie sztywne w u [0, 1) — pisze
 * atmosfera co klatkę, z = prędkość kątowa [u na s rzeczywistą], w = 0). Wolne miejsca: x = 2.
 */
export function bandRecords(segs, cap, label = 'gasGiantAtmosphere') {
  if (segs.length > cap) throw new Error(`${label}: ${segs.length} pasów > ${cap}`);
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = segs[i];
    out.push(s ? [(s.hi + 90) / 180, 0, s.omega, 0] : [2, 0, 0, 0]);
  }
  return out;
}

/**
 * Tekstura profilu (1 wiersz, teksel i ↔ v = (i + 0,5) / N, v = 0 — biegun S): R = wiatr [m/s], G = ścinanie
 * |dw/dy| znormalizowane do 1, B = maska turbulencji (gaśnie ku biegunom od `fadeFrom` na `fadeWidth` stopniach),
 * A = 1. Float32Array RGBA.
 */
export function buildWindTexels(windAt, n, fadeFrom = 55, fadeWidth = 12) {
  const data = new Float32Array(n * 4);
  const wind = new Float64Array(n);
  for (let i = 0; i < n; i++) wind[i] = windAt(((i + 0.5) / n - 0.5) * 180);
  let maxShear = 1e-9;
  const shear = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    shear[i] = Math.abs(wind[Math.min(n - 1, i + 1)] - wind[Math.max(0, i - 1)]);
    if (shear[i] > maxShear) maxShear = shear[i];
  }
  for (let i = 0; i < n; i++) {
    const lat = Math.abs(((i + 0.5) / n - 0.5) * 180);
    const fade = 1 - Math.min(1, Math.max(0, (lat - fadeFrom) / fadeWidth));
    data[i * 4] = wind[i];
    data[i * 4 + 1] = shear[i] / maxShear;
    data[i * 4 + 2] = fade * fade * (3 - 2 * fade);
    data[i * 4 + 3] = 1;
  }
  return data;
}

/** Tekstura profilu wiatru (RGBA16F, N × 1, liniowa, bez mipmap). */
export function createWindTexture(texels, n, name) {
  const half = new Uint16Array(texels.length);
  for (let i = 0; i < texels.length; i++) half[i] = THREE.DataUtils.toHalfFloat(texels[i]);
  const tex = new THREE.DataTexture(half, n, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = name;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Model atmosfery planety (jeden na planetę i grę). spec:
 *   id, radius [m], windAt(φc) [m/s], cuts (granice pasów z ±90), vortices, bands { blendDeg, minDeg, vortexReach,
 *   vortexPad }, bandCap, vortexCap, maxSpread, windTexels, turbFade [od, szerokość], texSize [w, h] mapy dnia,
 *   names { bands, vortices, wind } — stałe nazwy buforów (jeden kod WGSL), keys { clock, flow, turb, pole? },
 *   tune (obiekt strojenia — czytany co klatkę), poles (opcjonalnie): { north?, south? } z { cap, core, hexagon? }.
 */
export class GasGiantModel {
  constructor(spec) {
    this.spec = spec;
    this.id = spec.id;
    this.radius = spec.radius;
    this.windAt = spec.windAt;
    this.vortices = spec.vortices;
    this.bands = spec.bands;
    this.bandCap = spec.bandCap;
    this.vortexCap = spec.vortexCap;
    this.windTexels = spec.windTexels || 512;
    this.texSize = spec.texSize;
    this.names = spec.names;
    this.keys = spec.keys;
    this.tune = spec.tune;
    this.poles = spec.poles || null;
    this._segments = null;
    this._bandArray = null;
    this._vortexArray = null;
    this._windTex = null;
  }

  /** Klucze `material.uniforms` czytane przez gałąź atmosfery (po kluczach powierzchni planety). */
  get uniformKeys() {
    const k = { [this.keys.clock]: 'vec4', [this.keys.flow]: 'vec4', [this.keys.turb]: 'vec4' };
    if (this.keys.pole) k[this.keys.pole] = 'vec4';
    return k;
  }

  get segments() {
    if (!this._segments) {
      const polar = this.poles ? { north: this.poles.north ? this.poles.north.cap : 90, south: this.poles.south ? -this.poles.south.cap : -90 } : null;
      this._segments = bandSegments({ windAt: this.windAt, cuts: this.spec.cuts, radius: this.radius, vortices: this.vortices,
        cfg: this.bands, maxSpread: this.spec.maxSpread ?? Infinity, polar });
    }
    return this._segments;
  }

  /** Węzeł tablicy pasów (UniformArrayNode wysyła tablicę co render — atmosfera pisze `.array[i]`). */
  bandArray() {
    if (!this._bandArray) {
      const rows = bandRecords(this.segments, this.bandCap, this.id).map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w));
      this._bandArray = uniformArray(rows, 'vec4').setName(this.names.bands);
    }
    return this._bandArray;
  }

  vortexArray() {
    if (!this._vortexArray) {
      const rows = vortexRecords(this.vortices, this.vortexCap, this.segments).map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w));
      this._vortexArray = uniformArray(rows, 'vec4').setName(this.names.vortices);
    }
    return this._vortexArray;
  }

  windTexels_() {
    const [from, width] = this.spec.turbFade || [55, 12];
    return buildWindTexels(this.windAt, this.windTexels, from, width);
  }

  /** Tekstura profilu wiatru (jedna na grę). */
  windTexture() {
    return this._windTex || (this._windTex = createWindTexture(this.windTexels_(), this.windTexels, this.names.wind));
  }

  /**
   * Prędkość kątowa obrotu sztywnego jądra czapy [rad na s rzeczywistą, + = na wschód / rosnące u]: średnia
   * prędkości kątowej wokół bieguna w jądrze (ρ < core).
   */
  poleCoreOmega(which) {
    const p = this.poles && this.poles[which];
    if (!p) return 0;
    const sgn = which === 'north' ? 1 : -1;
    const n = 48;
    let s = 0;
    let wsum = 0;
    for (let k = 0; k < n; k++) {
      const rho = p.core * (k + 0.5) / n;
      const w = this.windAt(sgn * (90 - rho));
      const om = w / (this.radius * Math.sin(Math.max(rho, 0.05) * D2R));
      s += om * rho;      // waga ~ pole pierścienia
      wsum += rho;
    }
    return s / wsum;
  }
}

/**
 * Zegar i strojenie atmosfery: dopisuje klucze do `uniforms` planety (przed budową materiału), ustawia zawijanie
 * mapy dnia w u (próbki przesunięte wychodzą poza [0, 1]) i co klatkę przelicza z czasu gry: zegar faz, przesunięcia
 * sztywne pasów, kąty wirów i jąder czap (double, zawinięte — float32 w shaderze nie traci dokładności).
 */
export class GasGiantAtmosphere {
  constructor(model, planet, dayTexture) {
    this.model = model;
    this.planet = planet;
    this.uniforms = planet.uniforms;
    for (const key of Object.keys(model.uniformKeys)) {
      if (!this.uniforms[key]) this.uniforms[key] = { value: new THREE.Vector4() };
    }
    if (dayTexture) {
      dayTexture.wrapS = THREE.RepeatWrapping;
      if (dayTexture.image) dayTexture.needsUpdate = true;
    }
    this.segments = model.segments;
    this.bands = model.bandArray();
    this.vortices = model.vortexArray();
    this.offsets = new Float64Array(this.segments.length);   // przesunięcie sztywne pasów [u, zawinięte]
    this.angles = new Float64Array(model.vortexCap);          // kąt obrotu sztywnego wirów [rad, zawinięty]
    this.poleAngles = new Float64Array(2);                     // kąt jądra czapy N / S [rad, zawinięty]
    this.poleOmega = [model.poleCoreOmega('north'), model.poleCoreOmega('south')];
    this.time = 0;          // czas GRY [s] od startu
    this.phase = 0;         // zegar faz s (w oknie GAS_PHASE_WRAP), całkowany: ds = dt / T
    this.pace = 1;          // mnożnik tempa z powiększenia (wygładzony)
    this._last = null;
    this._wall = null;
    this.sync(0, 0);
  }

  /** Krok co klatkę: przyrost czasu gry z SimClock (pauza, sceny — 0; skok zegara w tył albo > 0,5 s — pominięty). */
  step() {
    const now = Number(SimClock.render) || 0;
    let dt = 0;
    if (this._last !== null) {
      dt = now - this._last;
      if (!(dt > 0) || dt > 0.5) dt = 0;
    }
    this._last = now;
    const wall = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    const wallDt = this._wall === null ? 0 : Math.min(0.25, Math.max(0, wall - this._wall));
    this._wall = wall;
    this.sync(dt, wallDt);
  }

  /** Mnożnik tempa dla powiększenia: px ekranu na teksel mapy na równiku przy zoomie kamery gry. */
  paceFor(zoom, radius) {
    const T = this.model.tune;
    const texW = this.model.texSize[0];
    const pxPerTexel = Math.max(1e-6, Number(zoom) || 0) * 2 * Math.PI * Math.max(1, Number(radius) || 1) / texW;
    if (!(T.zoomFollow > 0) || pxPerTexel <= T.refPxPerTexel) return 1;
    return Math.pow(T.refPxPerTexel / pxPerTexel, T.zoomFollow);
  }

  /** Stan od zera (zrzuty, testy): czas gry 0, pasy i wiry w położeniu mapy. */
  reset() {
    this.time = 0;
    this.phase = 0;
    this.offsets.fill(0);
    this.angles.fill(0);
    this.poleAngles.fill(0);
  }

  /** dt — przyrost czasu gry [s], wallDt — czasu ściany (tempo z powiększenia goni zoom także w pauzie). */
  sync(dt, wallDt = 0) {
    const M = this.model;
    const T = M.tune;
    const period = Math.max(0.5, Number(T.period) || 9);
    // Tempo z powiększenia tylko dla planety w kamerze gry (pass ortho przy ringu); planeta tła (perspektywa,
    // isRingAnchored === false) ma stałą tarczę na ekranie — tempo 1.
    const cam = typeof window !== 'undefined' && this.planet?.isRingAnchored !== false ? window.camera : null;
    const radius = this.planet?.group?.scale?.x || 48000;
    const want = cam ? this.paceFor(cam.zoom, radius) : 1;
    // Wygładzone; skok o więcej niż połowę (cięcie kamery, teleport) — od razu.
    const k = 1 - Math.exp(-wallDt / Math.max(0.01, Number(T.zoomLag) || 0.4));
    this.pace += (want - this.pace) * (Math.abs(want - this.pace) > 0.5 * this.pace ? 1 : k);
    const scale = (Number(T.timeScale) || 0) * this.pace;
    const real = dt * scale;   // sekundy rzeczywiste tej klatki
    this.time += dt;
    this.phase = (this.phase + dt / period) % GAS_PHASE_WRAP;
    const bands = this.bands.array;
    for (let i = 0; i < this.segments.length; i++) {
      const o = this.offsets[i] + this.segments[i].omega * real;
      this.offsets[i] = o - Math.floor(o);
      bands[i].y = this.offsets[i];
    }
    // Wiry: obrót odbiera się kątem, nie pikselami — z powiększeniem zwalnia słabiej niż pasy (vortexZoomFollow).
    const vPace = Math.pow(this.pace, Number(T.vortexZoomFollow) || 0) * (Number(T.vortexSpeed) || 0);
    const realV = dt * (Number(T.timeScale) || 0) * vPace;
    const vort = this.vortices.array;
    const VS = GAS_VORTEX_VEC4;
    for (let i = 0; i < M.vortexCap; i++) {
      const B = vort[i * VS + 1];
      const a = this.angles[i] + B.x * vort[i * VS + 2].x * realV;
      this.angles[i] = a - Math.floor(a / (2 * Math.PI)) * 2 * Math.PI;
      B.z = this.angles[i];
    }
    const u = this.uniforms;
    u[M.keys.clock].value.set(this.phase, period, scale, T.on ? 1 : 0);
    // x — windK: przesunięcie u na sekundę gry na m/s na równiku = scale / (2πR); w — mnożnik obrotu wirów
    // względem `scale` (shader: ω · scale · w = ω · timeScale · tempo wirów)
    u[M.keys.flow].value.set(scale / (2 * Math.PI * M.radius), T.desync, T.on ? T.contrast : 0,
      scale > 0 ? (Number(T.timeScale) * vPace) / scale : 0);
    u[M.keys.turb].value.set(T.eddy, T.eddyFloor, Math.max(1, Math.round(T.eddyScaleU)), Math.max(1, T.eddyScaleV));
    if (M.keys.pole) {
      // Jądra czap: kąt w rad (+ = na wschód); tempo jak wiry (obrót odbiera się kątem).
      const realP = dt * (Number(T.timeScale) || 0) * Math.pow(this.pace, Number(T.vortexZoomFollow) || 0) * (Number(T.poleSpeed ?? 1));
      for (let p = 0; p < 2; p++) {
        const a = this.poleAngles[p] + this.poleOmega[p] * realP;
        this.poleAngles[p] = a - Math.floor(a / (2 * Math.PI)) * 2 * Math.PI;
      }
      u[M.keys.pole].value.set(this.poleAngles[0], this.poleAngles[1], Number(T.poleSpeed ?? 1), 0);
    }
  }
}
