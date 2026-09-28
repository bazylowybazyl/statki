// src/3d/weapons/trails.js
//
// Smugi pocisków w świecie — port `dema/bronie-webgpu/trails.js` (który portował SlugTrail
// z dawnego `src/3d/slugTrail3D.js`) do gry, zadanie 17. Styl (barwy, życie, turbulencja,
// żar czubka, dryf, helisa) siedzi w TABLICY STYLÓW, segment niesie tylko jego numer —
// wszystkie bronie w jednym draw callu. Segmenty zapisuje CPU wyłącznie przy emisji
// (pierścień), GPU liczy dryf gazu, rozszerzanie z wiekiem, meandry, włókna, zanik i
// rozżarzony rdzeń za pociskiem. Próbkowanie po PRZEBYTEJ DRODZE (co `spacing` j.).
//
// Zmiany względem dema:
//   • NOŚNIK: pocisk dziedziczy prędkość strzelca, więc gaz, który zostawia, też
//     (agents.md § Nośnik prędkości; wzór z dawnego slugTrail3D.js). Węzeł pamięta czas
//     zegara gry (SimClock) swojej pozy, segment — prędkość nośnika i zegar; shader dokłada
//     v · (T_zegar − t). Zerowy nośnik = smuga stoi w świecie jak w demie.
//   • Pozycje względem początku pul przy kamerze, czasy względem epok (FxPoolOrigin) —
//     przeskoki przesuwa kernel przesunięcia (pierścień zarejestrowany w origin).
//   • Uchwyty smug z puli (demo: obiekt na pocisk), zero alokacji na segment i na klatkę;
//     rysowana tylko zajęta część pierścienia.
//
// Układ segmentu (5 × vec4): A (a.xy lokalnie, z, narodziny A), B (b.xy, z, narodziny B),
// C (bok.xy, szerokość, styl + 16·zegar), D (droga A, droga B, ziarno, energia),
// E (nośnik vx, vy sceny, t_A − epoka gry, t_B − epoka gry).
//
// Bez Math.hypot w gorących ścieżkach — w V8 alokuje (~30–40 B na wywołanie).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, attributeArray, instanceIndex,
  positionGeometry, varyingProperty, texture, If, select, mix, clamp, smoothstep, exp, pow,
  sin, max, min, abs, mod
} from 'three/tsl';
import { additiveMaterial } from './gpuFx.js';
import { createShiftKernel } from '../fx/gpuPoolOrigin.js';
import { liveRangeAttribute, markRange } from './liveRange.js';
import { CLOCK_RENDER } from '../../game/simClock.js';
import { fxRandom } from '../fx/fxRandom.js';

/** Segmentów w pierścieniu (demo: 2¹⁵). */
export const TRAIL_CAP = 1 << 15;
const SEG_V4 = 5;
const SEG_FLOATS = SEG_V4 * 4;
const STYLE_V4 = 6;
const HANDLE_CAP = 4096;

// Style (kolejność = indeks w tablicy). Barwy jak w demie (Hexlance i Yamato — dawny
// slugTrail3D.js, reszta nowa).
export const TRAIL_STYLES = [
  // 0 HEXLANCE — pełna smuga z gry: 3,5 s, turbulencja 0,45
  { key: 'hexlance', young: [0.22, 0.62, 1.25], old: [0.07, 0.035, 0.30], accent: [0.55, 1.05, 1.70], hot: [1.10, 1.50, 2.00], life: 3.5, opacity: 1.0, turb: 0.45, hotAmt: 1.2, drift: 30, grow: 0.16, growCap: 2.1, helix: 0, helixFreq: 0 },
  // 1 YAMATO — delikatniejsza, cyjan
  { key: 'yamato', young: [0.30, 0.95, 1.15], old: [0.05, 0.10, 0.22], accent: [0.55, 1.40, 1.60], hot: [0.85, 1.55, 1.75], life: 0.55, opacity: 0.7, turb: 0.28, hotAmt: 0.9, drift: 30, grow: 0.5, growCap: 2.0, helix: 0.18, helixFreq: 2.2 },
  // 2 TEMPEST — jonowy ślad: cienki, chłodny, gaśnie w fiolet, drobne skręty
  { key: 'tempest', young: [0.18, 0.75, 1.35], old: [0.10, 0.04, 0.30], accent: [0.45, 1.25, 1.90], hot: [0.9, 1.6, 2.2], life: 0.45, opacity: 0.85, turb: 0.35, hotAmt: 1.0, drift: 18, grow: 0.9, growCap: 1.6, helix: 0.3, helixFreq: 3.1 },
  // 3 VALKYRIE — magenta, helisa, dłuższy
  { key: 'valkyrie', young: [1.10, 0.22, 1.20], old: [0.18, 0.03, 0.25], accent: [1.50, 0.55, 1.70], hot: [2.0, 1.2, 2.2], life: 1.3, opacity: 0.95, turb: 0.3, hotAmt: 1.2, drift: 25, grow: 0.35, growCap: 2.0, helix: 0.45, helixFreq: 1.6 },
  // 4 MJOLNIR — kanał plazmy: długo wisi, szeroko się rozlewa
  { key: 'mjolnir', young: [0.45, 1.10, 1.30], old: [0.05, 0.08, 0.20], accent: [0.8, 1.6, 1.8], hot: [2.2, 2.6, 2.8], life: 4.5, opacity: 1.0, turb: 0.5, hotAmt: 1.4, drift: 10, grow: 0.22, growCap: 3.2, helix: 0, helixFreq: 0 },
  // 5 HELIOS — ślad plazmy: krótki, czerwono-różowy
  { key: 'helios', young: [1.20, 0.12, 0.30], old: [0.20, 0.02, 0.08], accent: [1.60, 0.35, 0.55], hot: [2.0, 0.8, 1.0], life: 0.22, opacity: 0.7, turb: 0.25, hotAmt: 0.8, drift: 12, grow: 1.2, growCap: 1.4, helix: 0, helixFreq: 0 },
  // 6 SHELL — rozgrzany pocisk armatni: ciepły, dymiący ślad
  { key: 'shell', young: [0.55, 0.30, 0.12], old: [0.06, 0.05, 0.05], accent: [0.9, 0.55, 0.22], hot: [1.6, 0.9, 0.35], life: 0.5, opacity: 0.55, turb: 0.4, hotAmt: 0.8, drift: 20, grow: 1.4, growCap: 2.4, helix: 0, helixFreq: 0 },
  // 7 PLASMA_GLOB — plazmowy gatling: gruby, cyjanowy, krótki
  { key: 'plasmaGlob', young: [0.20, 1.10, 1.00], old: [0.03, 0.12, 0.14], accent: [0.5, 1.6, 1.4], hot: [1.2, 2.0, 1.8], life: 0.35, opacity: 0.8, turb: 0.5, hotAmt: 0.9, drift: 15, grow: 1.6, growCap: 2.2, helix: 0.25, helixFreq: 4.0 }
];
export const TRAIL = Object.freeze(Object.fromEntries(TRAIL_STYLES.map((s, i) => [s.key, i])));
const MAX_STYLE_LIFE = Math.max(...TRAIL_STYLES.map((s) => s.life));

/** Uchwyt smugi (z puli). */
function createHandle() {
  return {
    active: false, style: 0, width: 27, spacing: 45, pathUnit: 200, z: 14,
    lx: 0, ly: 0, lt: 0, lct: 0, lpath: 0, path: 0, acc: 0, dx: 1, dy: 0, seed: 0, energy: 1,
    cvx: 0, cvy: 0, clock: 0
  };
}

export class TrailSystem {
  /**
   * @param {object} o
   * @param {THREE.Texture} o.noise
   * @param {import('../fx/gpuPoolOrigin.js').FxPoolOrigin} o.origin
   */
  constructor({ noise, origin, renderOrder = 50 }) {
    this.noise = noise;
    this.origin = origin;
    this.renderOrder = renderOrder;
    this.segNode = attributeArray(TRAIL_CAP * SEG_V4, 'vec4').setName('wfxTrailSegs');
    this.data = this.segNode.value.array;
    liveRangeAttribute(this.segNode.value);
    this.head = 0;
    this.wrapped = false;
    this.pending = 0;
    this.pendingStart = 0;
    this.liveUntil = -1;
    this.time = 0;          // zegar efektów [s] (Core3D.fx.time)
    const vals = [];
    for (const s of TRAIL_STYLES) {
      vals.push(new THREE.Vector4(s.young[0], s.young[1], s.young[2], s.life));
      vals.push(new THREE.Vector4(s.old[0], s.old[1], s.old[2], s.opacity));
      vals.push(new THREE.Vector4(s.accent[0], s.accent[1], s.accent[2], s.turb));
      vals.push(new THREE.Vector4(s.hot[0], s.hot[1], s.hot[2], s.hotAmt));
      vals.push(new THREE.Vector4(s.drift, s.grow, s.growCap, 0));
      vals.push(new THREE.Vector4(s.helix, s.helixFreq, 0, 0));
    }
    this.styles = uniformArray(vals, 'vec4').setName('wfxTrailStyles');
    this.U = { gain: uniform(1).setName('wfxTrailGain') };
    this.mesh = null;
    this._seg = new Float64Array(10);
    this._free = [];
    for (let i = 0; i < HANDLE_CAP; i++) this._free.push(createHandle());
    this.stats = { segments: 0, handles: 0, dropped: 0 };
  }

  build(scene) {
    if (this.mesh) return this;
    const U = this.U;
    const segs = this.segNode;
    const styles = this.styles;
    const noise = this.noise;
    const o = this.origin;
    const T = o.timeFx;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
    geo.setIndex([0, 2, 1, 2, 3, 1]);
    const vA = varyingProperty('vec4', 'vWfxTrA');   // u (w poprzek), wiek, droga, ziarno
    const vB = varyingProperty('vec4', 'vWfxTrB');   // styl, energia, życie, -
    const mat = additiveMaterial('wfxTrails');
    const S = (st, k) => styles.element(int(st).mul(int(STYLE_V4)).add(int(k)));
    // Koniec segmentu: dryf gazu, meandry, helisa, szerokość rosnąca z wiekiem, nośnik.
    const endpoint = (P, side, width, path, seed, st, v, carrierT, cv, clockRender) => {
      const age = max(T.sub(P.w), 0.0).toVar();
      const s4 = S(st, 4);
      const s5 = S(st, 5);
      const turb = S(st, 2).w;
      const dir = vec2(side.y.negate(), side.x);
      const drift = min(age, 0.35).add(max(age.sub(0.35), 0.0).mul(0.26));
      const p = P.xy.sub(dir.mul(s4.x.mul(drift))).toVar();
      // nośnik: węzeł leci z prędkością odziedziczoną przez pocisk
      const Tc = select(clockRender, o.timeRender, o.timeSim);
      p.addAssign(cv.mul(Tc.sub(carrierT)));
      const develop = smoothstep(0.15, 2.8, age);
      const wobble = sin(path.mul(2.7).add(seed).add(age.mul(0.75))).mul(0.68).add(sin(path.mul(6.1).sub(seed).sub(age.mul(0.9))).mul(0.28));
      p.addAssign(side.mul(wobble.mul(width).mul(turb).mul(develop).mul(0.46)));
      // helisa: skręt pasma wokół osi
      const hel = sin(path.mul(s5.y.mul(6.2831853)).add(seed).sub(age.mul(3.0))).mul(s5.x);
      p.addAssign(side.mul(hel.mul(width).mul(0.5)));
      const neck = mix(float(0.30), float(1.0), smoothstep(0.0, 0.62, age));
      const w = width.mul(neck).mul(float(1.0).add(min(age.mul(s4.y), s4.z)));
      return vec3(p.add(side.mul(v.mul(w))), P.z);
    };
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(SEG_V4)).toVar();
      const A = segs.element(i).toVar();
      const B = segs.element(i.add(uint(1))).toVar();
      const C = segs.element(i.add(uint(2))).toVar();
      const D = segs.element(i.add(uint(3))).toVar();
      const E = segs.element(i.add(uint(4))).toVar();
      const st = mod(C.w, 16.0).toVar();
      const clockRender = C.w.greaterThanEqual(15.5);
      const life = S(st, 0).w;
      const t = positionGeometry.x;
      const v = positionGeometry.y;
      const out = vec3(0.0, 0.0, -80.0).toVar();
      vA.assign(vec4(0.0));
      vB.assign(vec4(0.0));
      const ageB = T.sub(B.w);
      If(ageB.lessThan(life.add(0.05)).and(C.z.greaterThan(0.0)), () => {
        const side = C.xy;
        const pa = endpoint(A, side, C.z, D.x, D.z, st, v, E.z, E.xy, clockRender);
        const pb = endpoint(B, side, C.z, D.y, D.z, st, v, E.w, E.xy, clockRender);
        out.assign(mix(pa, pb, t));
        const birth = mix(A.w, B.w, t);
        vA.assign(vec4(v, max(T.sub(birth), 0.0), mix(D.x, D.y, t), D.z));
        vB.assign(vec4(st, D.w, life, 0.0));
      });
      return out;
    })();
    mat.fragmentNode = Fn(() => {
      const st = vB.x;
      const s0 = S(st, 0);
      const s1 = S(st, 1);
      const s2 = S(st, 2);
      const s3 = S(st, 3);
      const y = clamp(vA.x, -1.0, 1.0);
      const age = vA.y;
      const path = vA.z;
      const seed = vA.w;
      const turb = s2.w;
      const nAge = clamp(age.div(max(s0.w, 1e-3)), 0.0, 1.0);
      const fade = pow(float(1.0).sub(nAge), 1.3).mul(float(1.0).sub(smoothstep(0.75, 1.0, nAge)))
        .mul(float(1.0).add(s3.w.mul(exp(age.mul(-5.0))))).mul(s1.w).mul(pow(max(vB.y, 1e-3), 0.75)).mul(U.gain);
      // cloud() z gry: ~3,2 komórki na jednostkę drogi, 2,8 w poprzek (tekstura: 4 komórki na 1,0)
      const n = texture(noise, vec2(path.mul(0.8).sub(T.mul(0.12)), y.mul(0.7).add(seed.mul(0.25)))).r;
      const w = y.add(n.sub(0.5).mul(0.16).mul(turb).mul(smoothstep(0.1, 1.5, age)));
      const diffuse = exp(w.mul(w).mul(-5.5));
      const f1 = w.sub(sin(path.mul(7.5).sub(T.mul(0.9)).add(seed)).mul(0.17).mul(turb)).mul(10.0);
      const f2 = w.add(0.25).sub(sin(path.mul(5.0).sub(T.mul(0.65)).add(seed)).mul(0.12).mul(turb)).mul(15.0);
      const filament = exp(f1.mul(f1).negate());
      const filament2 = exp(f2.mul(f2).negate());
      const center = exp(w.mul(w).mul(-40.0)).mul(exp(age.mul(-0.13)));
      const pulse = sin(path.mul(15.0).add(seed).sub(T.mul(1.2))).mul(0.06).add(0.94);
      const col = mix(s0.xyz, s1.xyz, smoothstep(0.12, 0.95, nAge)).mul(diffuse.mul(n.mul(0.35).add(0.65))).toVar();
      col.addAssign(s2.xyz.mul(filament.mul(0.24).add(filament2.mul(0.13)).add(center.mul(0.28))).mul(exp(age.mul(-0.065))));
      col.addAssign(s3.xyz.mul(exp(w.mul(w).mul(-70.0))).mul(exp(age.mul(-7.0))));
      const edge = float(1.0).sub(smoothstep(0.68, 1.0, abs(y)));
      const c = max(col.mul(fade).mul(pulse).mul(edge), vec3(0.0)).toVar();
      return vec4(c, max(c.x, max(c.y, c.z)));
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = this.renderOrder;
    this.mesh.name = 'wfxTrails';
    this.mesh.count = 2;
    this.mesh.visible = false;
    if (scene) scene.add(this.mesh);
    // Przeskok początku / epok: pozycje obu węzłów, narodziny (zegar efektów), czasy nośnika.
    this.shiftNode = createShiftKernel(o, {
      buffer: segs, capacity: TRAIL_CAP, stride: SEG_V4, name: 'wfxShiftTrails',
      pos: [[0, 'xy'], [1, 'xy']], fxTime: [[0, 'w'], [1, 'w']], simTime: [[4, 'z'], [4, 'w']]
    });
    this.originEntry = o.register({ shiftNode: this.shiftNode, isLive: () => this.isLive() });
    return this;
  }

  isLive() { return this.pending > 0 || this.time <= this.liveUntil; }

  get used() { return this.wrapped ? TRAIL_CAP : Math.max(2, this.head); }

  /**
   * Nowa smuga (świat gry). width — półszerokość [j.], spacing — próbki co tyle j. drogi,
   * pathUnit — j. drogi na „sekundę” wzoru; cvx, cvy — nośnik (prędkość odziedziczona przez
   * pocisk, świat), ct — czas zegara gry pozy (x, y), clock — CLOCK_RENDER / CLOCK_SIM.
   * Zwraca uchwyt z puli albo null (pula pełna).
   */
  begin(style, x, y, dx, dy, width, spacing, pathUnit, cvx = 0, cvy = 0, ct = 0, clock = 0, z = 14) {
    const h = this._free.pop();
    if (!h) { this.stats.dropped++; return null; }
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    h.active = true;
    h.style = style;
    h.width = width;
    h.spacing = Math.max(4, spacing);
    h.pathUnit = Math.max(1, pathUnit);
    h.z = z;
    h.lx = x; h.ly = y; h.lt = this.time; h.lct = ct;
    h.lpath = fxRandom.next() * 40;
    h.path = h.lpath;
    h.acc = 0;
    h.dx = dx / l; h.dy = dy / l;
    h.seed = fxRandom.next() * 100;
    h.energy = 1;
    h.cvx = cvx; h.cvy = cvy;
    h.clock = clock === CLOCK_RENDER ? 1 : 0;
    this.stats.handles++;
    return h;
  }

  /**
   * Przesuwa smugę do (x, y) — emisja segmentów po drodze. ct — czas zegara gry pozy (x, y);
   * czasy efektów węzłów rozkłada się liniowo od ostatniego węzła do bieżącej klatki.
   */
  advance(h, x, y, ct) {
    if (!h || !h.active) return;
    const sx = h.lx; const sy = h.ly;
    const ex = x - sx; const ey = y - sy;
    const seg = Math.sqrt(ex * ex + ey * ey);
    if (seg < 1e-6) return;
    const dx = (x - sx) / seg; const dy = (y - sy) / seg;
    h.dx = dx; h.dy = dy;
    const t0 = h.lt; const t1 = this.time;
    const c0 = h.lct;
    let d = h.spacing - h.acc;
    let px = sx; let py = sy; let pt = t0; let pc = c0; let ppath = h.path;
    const basePath = h.path;
    while (d <= seg) {
      const f = d / seg;
      const nx = sx + (x - sx) * f;
      const ny = sy + (y - sy) * f;
      const nt = t0 + (t1 - t0) * f;
      const nc = c0 + (ct - c0) * f;
      const npath = basePath + d / h.pathUnit;
      const N = this._seg;
      N[0] = px; N[1] = py; N[2] = pt; N[3] = pc; N[4] = ppath;
      N[5] = nx; N[6] = ny; N[7] = nt; N[8] = nc; N[9] = npath;
      this._write(h);
      px = nx; py = ny; pt = nt; pc = nc; ppath = npath;
      d += h.spacing;
    }
    h.acc = seg - (d - h.spacing);
    h.path = basePath + seg / h.pathUnit;
    // ostatni zapisany węzeł zostaje początkiem następnego segmentu
    if (px !== sx || py !== sy) { h.lx = px; h.ly = py; h.lt = pt; h.lct = pc; h.lpath = ppath; }
  }

  /** Domyka smugę w punkcie (np. trafienia) i oddaje uchwyt do puli. */
  end(h, x, y, ct) {
    if (!h || !h.active) return;
    const ex = x - h.lx; const ey = y - h.ly;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d > 1) {
      const N = this._seg;
      N[0] = h.lx; N[1] = h.ly; N[2] = h.lt; N[3] = h.lct; N[4] = h.lpath;
      N[5] = x; N[6] = y; N[7] = this.time; N[8] = ct; N[9] = h.lpath + d / h.pathUnit;
      this._write(h);
    }
    h.active = false;
    this._free.push(h);
  }

  /** Porzuca smugę bez domknięcia (reset gry). */
  drop(h) {
    if (!h || !h.active) return;
    h.active = false;
    this._free.push(h);
  }

  // Węzły segmentu przez this._seg (Float64Array) — wywołanie z dziesięcioma liczbami double
  // pakowałoby je w V8 (alokacja na segment), gdy _write nie jest wklejone.
  _write(h) {
    const N = this._seg;
    const ax = N[0], ay = N[1], at = N[2], act = N[3], apath = N[4];
    const bx = N[5], by = N[6], bt = N[7], bct = N[8], bpath = N[9];
    const i = this.head;
    this.head = (this.head + 1) & (TRAIL_CAP - 1);
    if (this.head === 0) this.wrapped = true;
    if (this.pending === 0) this.pendingStart = i;
    this.pending = Math.min(TRAIL_CAP, this.pending + 1);
    const o = i * SEG_FLOATS;
    const D = this.data;
    const og = this.origin;
    const fxE = og.fxEpoch;
    const simE = og.simEpoch;
    // bok = kierunek obrócony o −90° w płaszczyźnie sceny (scena: y odwrócone)
    const sdx = h.dx; const sdy = -h.dy;
    D[o] = ax - og.x; D[o + 1] = -ay - og.y; D[o + 2] = h.z; D[o + 3] = at - fxE;
    D[o + 4] = bx - og.x; D[o + 5] = -by - og.y; D[o + 6] = h.z; D[o + 7] = bt - fxE;
    D[o + 8] = sdy; D[o + 9] = -sdx; D[o + 10] = h.width; D[o + 11] = h.style + 16 * h.clock;
    D[o + 12] = apath; D[o + 13] = bpath; D[o + 14] = h.seed; D[o + 15] = h.energy;
    const moving = h.cvx !== 0 || h.cvy !== 0;
    D[o + 16] = h.cvx; D[o + 17] = -h.cvy;
    D[o + 18] = moving ? act - simE : 0;
    D[o + 19] = moving ? bct - simE : 0;
    this.stats.segments++;
    const until = this.time + MAX_STYLE_LIFE + 0.5;
    if (until > this.liveUntil) this.liveUntil = until;
  }

  /**
   * Krok 1 klatki efektów (przed przeskokiem początku): wysyłka segmentów zapisanych od
   * ostatniej klatki (kernel przesunięcia obejmie je, gdy początek przeskoczy).
   */
  upload() {
    if (this.pending <= 0) return;
    const start = this.pendingStart;
    const n = this.pending;
    const attr = this.segNode.value;
    if (start + n <= TRAIL_CAP) markRange(attr, start * SEG_FLOATS, n * SEG_FLOATS);
    else markRange(attr, start * SEG_FLOATS, (TRAIL_CAP - start) * SEG_FLOATS, 0, (start + n - TRAIL_CAP) * SEG_FLOATS);
    this.pending = 0;
  }

  /** Krok 5: siatka na początku pul, liczba instancji (pusty pierścień wraca na 0). */
  place(originX, originY) {
    if (!this.mesh) return;
    if (!this.isLive()) {
      this.head = 0;
      this.wrapped = false;
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.count = this.used;
    this.mesh.position.set(originX, originY, 0);
    this.mesh.updateMatrixWorld(true);
  }

  reset() {
    this.pending = 0;
    this.head = 0;
    this.wrapped = false;
    this.liveUntil = -1;
    if (this.mesh) this.mesh.visible = false;
  }
}
