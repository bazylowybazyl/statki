// src/3d/asteroids/storm.js
//
// Burze energetyczne pasa — port dema/asteroidy-webgpu/storm.js (zadanie 21): NOWE
// PIORUNY dema WebGPU. Zmiany względem dema: losowanie efektów z generatora warstwy
// efektów gry (fxRandom — nie Math.random gry, sceny harnessu powtarzalne), segmenty
// pod grupą pola na warstwie passa gry (punkt fragmentu lokalnie, z wierzchołka),
// stały zakres wysyłki atrybutów, zbieranie skał bez domknięć na klatkę. Kiedy i gdzie uderza:
// StormSimulator z src/game/asteroidStorms.js (skały energetyczne w komórkach
// burz gęstych pól, łuki skała ↔ skała, wyładowania w pył, błyski w chmurach).
// Tu wygląd i światło:
//
//   • kształt: kanał główny z meandrami (duże przemieszczenie) i zygzakiem
//     (drobne), rozgałęzienia z pod-gałęziami, część gałęzi „martwa” (świeci
//     tylko w liderze) — jak prawdziwy piorun widziany z góry;
//   • przebieg: LIDER KROKOWY rośnie skokami od skały (widać go ~0,15–0,3 s,
//     gałęzie sondują na boki), UDAR GŁÓWNY rozświetla kanał do bieli (gałęzie
//     słabiej i krócej), 0–3 UDARY POWROTNE po tym samym kanale (lekko
//     przesunięte — migotanie), na koniec POŚWIATA stygnącego kanału
//     (błękit → fiolet), gaśnie ~0,4 s;
//   • render: segmenty-kapsuły (odległość piksela od odcinka): biały rdzeń HDR
//     (jedyne miejsce nad progiem bloomu, cienki), fioletowa poświata i szeroka
//     słaba otoczka; mieszanie MAX (łączenia segmentów bez jaśniejszych kropek);
//   • światło: łańcuch świateł siatki wzdłuż kanału (co ~450 j.) — oświetla
//     skały obok, kadłuby i pył (światło wolumetryczne: kanał w pyle świeci
//     objętością), światło na czubku lidera, gałęzie; błyski w chmurach głęboko
//     pod płaszczyzną rozświetlają mgłę tła i niebo (sky.js);
//   • w miejscu uderzenia: rozbłysk pęknięć skały energetycznej (S.strikes),
//     snop iskier na GPU (sparks.js), błysk, stygnący żar i łuki pełzające po
//     skale; ciche trzaski (ognie świętego Elma) na skałach w burzy.
//
// Wszystko w świecie gry (double); do GPU względem lokalnego początku sceny.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, positionGeometry, varyingProperty,
  mix, smoothstep, clamp, exp, max, min, dot, length
} from 'three/tsl';
import { StormSimulator, sheetEnvelope, mulberry32 } from '../../game/asteroidStorms.js';
import { ENERGY_TYPE } from '../../game/asteroidRockKinds.js';
import { fxRandom } from '../fx/fxRandom.js';
import { permanentUpdateRange, markLiveRange } from './tslCommon.js';
import { GLOW_ROUND } from './glowSprites.js';

const SEG_CAP = 6144;
const STRIKE_SLOTS = 8;

export const STORM_LOOK = Object.freeze({
  core: [0.86, 0.93, 1.0],      // rdzeń udaru (× coreGain → biel HDR)
  coreGain: 10.0,
  glow: [0.52, 0.42, 1.0],      // poświata kanału (fiolet ładunku)
  glowGain: 1.25,
  halo: [0.34, 0.3, 1.0],       // szeroka otoczka
  haloGain: 0.16,
  leader: [0.45, 0.55, 1.0],    // lider (błękit)
  after: [0.62, 0.24, 1.0],     // poświata stygnącego kanału (fiolet)
  coreW: 5, glowW: 26, haloW: 110,   // [j.] promienie przy długości ~1500 j.
  light: [0.74, 0.8, 1.0],      // światła kanału
  lightGain: 2.4,
  lightSpacing: 450,
  sheet: [0.55, 0.42, 1.0],
  sheetGain: 2.2,
  ion: [1.5, 2.4, 3.9]          // iskry jonowe (HDR)
});

// ---------------------------------------------------------------------------
// Kształt

function midpointChain(ax, ay, az, bx, by, bz, levels, jag, rng, wander = 0) {
  let pts = [ax, ay, az, bx, by, bz];
  // Meandry: dwa poziomy dużego przemieszczenia (kanał nie jest prostą z zygzakiem).
  let amp = wander > 0 ? wander : jag;
  for (let l = 0; l < levels; l++) {
    const next = [];
    const segs = pts.length / 3 - 1;
    for (let s = 0; s < segs; s++) {
      const x0 = pts[s * 3]; const y0 = pts[s * 3 + 1]; const z0 = pts[s * 3 + 2];
      const x1 = pts[s * 3 + 3]; const y1 = pts[s * 3 + 4]; const z1 = pts[s * 3 + 5];
      const dx = x1 - x0; const dy = y1 - y0;
      const seg = Math.hypot(dx, dy, z1 - z0);
      const pl = Math.hypot(dx, dy) || 1;
      const off = (rng() * 2 - 1) * amp * seg;
      next.push(x0, y0, z0, (x0 + x1) * 0.5 - dy / pl * off, (y0 + y1) * 0.5 + dx / pl * off, (z0 + z1) * 0.5 + (rng() * 2 - 1) * amp * seg * 0.35);
    }
    next.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
    pts = next;
    if (wander > 0 && l === 1) amp = jag;
    else amp *= 0.56;
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
  return { points, t, count, length: acc };
}

/**
 * Piorun A → B: kanał główny + gałęzie (poziom 1) + pod-gałęzie (poziom 2).
 * Łańcuch: points (x, y, z świata), t (czas dojścia lidera, 0..~1,3), w
 * (jasność), level, dead (gałąź, która nie dostaje udaru).
 */
export function buildBolt(ax, ay, az, bx, by, bz, seed, opts = {}) {
  const rng = mulberry32(seed >>> 0);
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const levels = opts.levels ?? (len > 1800 ? 7 : 6);
  const main = midpointChain(ax, ay, az, bx, by, bz, levels, opts.jag ?? 0.24, rng, opts.wander ?? 0.2);
  // Łuk ku kamerze: kanał między skałami podnosi się do opts.bowTo (tuż pod
  // płaszczyzną gry) — z góry widać go nad skałami, a nie pod ich czubkami.
  if (Number.isFinite(opts.bowTo)) {
    const zMid = (az + bz) * 0.5;
    const bow = Math.max(0, Math.min(opts.bowTo - zMid, len * (opts.bowMax ?? 0.35)));
    for (let k = 0; k < main.count; k++) main.points[k * 3 + 2] += Math.sin(Math.PI * main.t[k]) * bow;
  }
  const chains = [{ points: main.points, t: main.t, count: main.count, w: 1, level: 0, dead: false }];
  const maxBranches = opts.branches ?? 7;
  const n = main.count;
  const grow = (parent, level, prob, maxN, lenK) => {
    let made = 0;
    for (let i = 2; i < parent.count - 3 && made < maxN; i++) {
      if (rng() > prob) continue;
      const px = parent.points[i * 3];
      const py = parent.points[i * 3 + 1];
      const pz = parent.points[i * 3 + 2];
      const dx = parent.points[(i + 1) * 3] - px;
      const dy = parent.points[(i + 1) * 3 + 1] - py;
      const dl = Math.hypot(dx, dy) || 1;
      const ang = (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 0.65);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const remain = 1 - parent.t[i] * 0.6;
      const bl = len * lenK * (0.35 + rng() * 0.65) * remain;
      const ex = px + (dx / dl * ca - dy / dl * sa) * bl;
      const ey = py + (dx / dl * sa + dy / dl * ca) * bl;
      const ez = pz - bl * (rng() * 0.5 - 0.15);
      const br = midpointChain(px, py, pz, ex, ey, ez, Math.max(3, levels - 1 - level), (opts.jag ?? 0.24) * 1.15, rng);
      const t0 = parent.t[i];
      const span = (bl / Math.max(1, len)) * 1.25;
      for (let k = 0; k < br.count; k++) br.t[k] = t0 + br.t[k] * span;
      const ch = { points: br.points, t: br.t, count: br.count, w: (level === 1 ? 0.5 : 0.3) * (0.75 + rng() * 0.5), level, dead: rng() < (level === 1 ? 0.35 : 0.6) };
      chains.push(ch);
      made++;
      if (level < 2) grow(ch, level + 1, 0.12, 2, lenK * 0.45);
    }
    return made;
  };
  grow(chains[0], 1, Math.min(0.3, maxBranches / Math.max(8, n)), maxBranches, opts.branchLen ?? 0.32);
  return chains;
}

// ---------------------------------------------------------------------------
// Render segmentów

class BoltBatch {
  constructor(parent, layer = 0) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(SEG_CAP * 4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(SEG_CAP * 4), 4);
    this.c = new THREE.InstancedBufferAttribute(new Float32Array(SEG_CAP * 4), 4);
    this._ranges = [this.a, this.b, this.c].map((at) => permanentUpdateRange(at));
    geo.setAttribute('bA', this.a);
    geo.setAttribute('bB', this.b);
    geo.setAttribute('bC', this.c);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;
    const L = STORM_LOOK;
    this.U = {
      zoom: uniform(1),
      core: uniform(new THREE.Vector3(...L.core).multiplyScalar(L.coreGain)),
      glow: uniform(new THREE.Vector3(...L.glow).multiplyScalar(L.glowGain)),
      halo: uniform(new THREE.Vector3(...L.halo).multiplyScalar(L.haloGain)),
      leader: uniform(new THREE.Vector3(...L.leader)),
      after: uniform(new THREE.Vector3(...L.after)),
      widths: uniform(new THREE.Vector3(L.coreW, L.glowW, L.haloW))
    };
    const U = this.U;
    const vP0 = varyingProperty('vec2', 'vBoltP0');
    const vP1 = varyingProperty('vec2', 'vBoltP1');
    const vR = varyingProperty('vec3', 'vBoltR');
    const vD = varyingProperty('vec4', 'vBoltD');
    // Punkt kwadu lokalnie (względem początku pola) — w demie positionWorld sceny dema.
    const vP = varyingProperty('vec2', 'vBoltP');
    const mat = new THREE.NodeMaterial();
    mat.name = 'AsteroidBelt:bolts';
    mat.premultipliedAlpha = false;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    // MAX: nakładające się końce segmentów nie sumują się w jasne kropki.
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.MaxEquation;
    mat.blendEquationAlpha = THREE.MaxEquation;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.positionNode = Fn(() => {
      const A = attribute('bA', 'vec4');
      const B = attribute('bB', 'vec4');
      const C = attribute('bC', 'vec4');
      const d = B.xy.sub(A.xy).toVar();
      const len = max(length(d), 1e-3).toVar();
      const dir = d.div(len).toVar();
      const perp = vec2(dir.y.negate(), dir.x);
      // Promienie: w jednostkach świata, z dolną granicą w pikselach (piorun
      // widać przy każdym zoomie, rdzeń zostaje cienki).
      const rs = A.w;
      const rc = max(U.widths.x.mul(rs), float(0.9).div(U.zoom));
      const rg = max(U.widths.y.mul(rs), float(3.5).div(U.zoom));
      const rh = max(U.widths.z.mul(rs), float(10.0).div(U.zoom)).toVar();
      const pad = rh.mul(2.6);
      const q = positionGeometry.xy;
      const along = q.x.add(0.5).mul(len.add(pad.mul(2.0))).sub(pad);
      const p = A.xy.add(dir.mul(along)).add(perp.mul(q.y.mul(pad).mul(2.0)));
      const tz = clamp(along.div(len), 0.0, 1.0);
      vP0.assign(A.xy);
      vP1.assign(B.xy);
      vR.assign(vec3(rc, rg, rh));
      vD.assign(vec4(B.w, C.x, C.y, 0.0));
      vP.assign(p);
      return vec3(p, mix(A.z, B.z, tz));
    })();
    mat.fragmentNode = Fn(() => {
      const P = vP;
      const ab = vP1.sub(vP0);
      const t = clamp(dot(P.sub(vP0), ab).div(max(dot(ab, ab), 1e-6)), 0.0, 1.0);
      const dd = length(P.sub(vP0.add(ab.mul(t)))).toVar();
      const I = vD.x;
      const whiteK = vD.y;
      const afterK = vD.z;
      const core = exp(dd.mul(dd).div(vR.x.mul(vR.x)).negate());
      const glow = exp(dd.mul(dd).div(vR.y.mul(vR.y)).negate());
      const halo = exp(dd.mul(dd).div(vR.z.mul(vR.z)).negate());
      // Barwa kanału: lider błękitny, udar fioletowo-biały, poświata fiolet.
      const tint = mix(mix(U.leader, vec3(1.0), whiteK.mul(0.35)), U.after, afterK);
      const col = U.core.mul(core).mul(whiteK)
        .add(U.glow.mul(tint).mul(glow))
        .add(U.halo.mul(tint).mul(halo));
      return vec4(max(col.mul(I), vec3(0.0)), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    // Nad skałami gry i mgłą płytką, pod kadłubami (z < 0) i duszkami.
    this.mesh.renderOrder = 14;
    this.mesh.name = 'AsteroidBelt:stormBolts';
    this.mesh.layers.set(layer);
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.count = 0;
  }

  begin() { this.count = 0; }

  push(x0, y0, z0, x1, y1, z1, rs, I, whiteK, afterK) {
    if (this.count >= SEG_CAP || I < 0.004) return;
    const o = (this.count++) * 4;
    const A = this.a.array; const B = this.b.array; const C = this.c.array;
    A[o] = x0; A[o + 1] = y0; A[o + 2] = z0; A[o + 3] = rs;
    B[o] = x1; B[o + 1] = y1; B[o + 2] = z1; B[o + 3] = I;
    C[o] = whiteK; C[o + 1] = afterK; C[o + 2] = 0; C[o + 3] = 0;
  }

  commit(zoom) {
    const n = this.count;
    this.U.zoom.value = zoom;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    markLiveRange(this.a, this._ranges[0], n * 4);
    markLiveRange(this.b, this._ranges[1], n * 4);
    markLiveRange(this.c, this._ranges[2], n * 4);
  }
}

// ---------------------------------------------------------------------------

const _hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export class StormSystem {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.parent grupa pola (pass gry — warstwa layer)
   * @param {number} [o.layer] warstwa passa Core3D
   * @param {import('../../game/asteroidBeltField.js').AsteroidBeltField} o.field
   * @param {object} o.shared uniformy skał (S.strikes)
   * @param {import('./sparks.js').Sparks} o.sparks
   */
  constructor({ parent, layer = 0, field, shared, sparks }) {
    this.field = field;
    this.shared = shared;
    this.sparks = sparks;
    this.sim = new StormSimulator({}, 0x5707);
    this.batch = new BoltBatch(parent, layer);
    this.enabled = true;
    this.intensity = 0;
    this.look = { ...STORM_LOOK };
    this._rocks = [];
    this._pool = [];
    this._state = new Map();       // id pioruna → stan (kształt, przebieg)
    this._arcs = [];               // łuki pełzające po skałach i trzaski
    this._glows = [];              // błyski i żar w miejscach uderzeń
    this._lights = [];             // światła tej klatki (świat gry)
    this._lightPool = [];
    this._view = { x: 0, y: 0, halfW: 0, halfH: 0 };
    this._tick = 0;
    this.flashes = [];             // błyski w chmurach (niebo)
    this._flashPool = [];
    this.stats = { rocks: 0, strikes: 0, sheets: 0, segments: 0, lights: 0 };
    // Zbieranie skał energetycznych bez domknięcia na klatkę (parametry w polach).
    this._cz = { zOf: null, cx: 0, cy: 0, rx: 0, ry: 0 };
    this._collectCb = (rock) => this._collectOne(rock);
  }

  setVisible(v) {
    this.enabled = !!v;
    if (!v) {
      this.batch.begin();
      this.batch.commit(1);
      for (const s of this.shared.strikes.array) s.w = 0;
    }
  }

  _collectRocks(layer, zOf, cx, cy, reachX, reachY) {
    const list = this._rocks;
    list.length = 0;
    if (!layer || !layer.enabled) return list;
    const c = this._cz;
    c.zOf = zOf; c.cx = cx; c.cy = cy; c.rx = reachX; c.ry = reachY;
    layer.forEachLoaded(this._collectCb);
    return list;
  }

  _collectOne(rock) {
    if (!rock || rock.type !== ENERGY_TYPE) return;
    const c = this._cz;
    if (Math.abs(rock.x - c.cx) > c.rx || Math.abs(rock.y - c.cy) > c.ry) return;
    const list = this._rocks;
    const pool = this._pool;
    const i = list.length;
    const rec = pool[i] || (pool[i] = { id: 0, x: 0, y: 0, z: 0, r: 0 });
    rec.id = rock.id; rec.x = rock.x; rec.y = rock.y; rec.r = rock.r;
    rec.z = c.zOf ? c.zOf(rock) : -rock.r;
    list.push(rec);
  }

  /** Przebieg nowego pioruna (wolniejszy lider niż w symulatorze — ma być widać, jak rośnie). */
  _newState(s) {
    const rng = mulberry32((s.seed ^ 0xB017) >>> 0);
    // Końce na GÓRNEJ powierzchni skał, od strony partnera (widać je z góry;
    // symulator stawia je na boku skały, w połowie jej głębokości), kanał
    // wygięty łukiem ku kamerze nad skałami po drodze.
    const ux = s.bx - s.acx;
    const uy = s.by - s.acy;
    const ul = Math.hypot(ux, uy) || 1;
    const A = { x: s.acx + ux / ul * s.ar * 0.55, y: s.acy + uy / ul * s.ar * 0.55, z: s.az + s.ar * 0.78 };
    let B;
    if (s.kind === 'arc') {
      const vx = s.acx - s.bcx;
      const vy = s.acy - s.bcy;
      const vl = Math.hypot(vx, vy) || 1;
      B = { x: s.bcx + vx / vl * s.br * 0.55, y: s.bcy + vy / vl * s.br * 0.55, z: s.bz + s.br * 0.78 };
    } else {
      B = { x: s.bx, y: s.by, z: s.bz };
    }
    const chains = buildBolt(A.x, A.y, A.z, B.x, B.y, B.z, s.seed, {
      branches: s.kind === 'cloud' ? 9 : 6, branchLen: s.kind === 'cloud' ? 0.38 : 0.3,
      bowTo: s.kind === 'arc' ? 5 : undefined, bowMax: 0.7
    });
    const leader = 0.14 + rng() * 0.14;
    const strokes = [{ at: leader, amp: 1, seed: s.seed }];
    for (let k = 1; k < s.strokes.length; k++) {
      strokes.push({ at: leader + (s.strokes[k].at - s.leader) * 1.4, amp: s.strokes[k].amp, seed: s.strokes[k].seed || (s.seed + k * 977) });
    }
    const last = strokes[strokes.length - 1].at;
    // Symulator zdejmuje piorun po s.duration — przedłużony o dłuższy lider i poświatę.
    s.duration = Math.max(s.duration, last + 0.6);
    // Kroki lidera: czas dojścia do kolejnych progów (skoki z przestojami).
    const steps = 9 + Math.floor(rng() * 6);
    const stepT = new Float32Array(steps + 1);
    let acc = 0;
    for (let i = 0; i < steps; i++) { acc += 0.5 + rng(); stepT[i + 1] = acc; }
    for (let i = 1; i <= steps; i++) stepT[i] /= acc;
    return { chains, leader, strokes, last, steps, stepT, fx: -1, len: s.length, A, B };
  }

  /** Postęp lidera (0..1) w wieku a: skokami, z przestojami między krokami. */
  _reveal(st, a) {
    if (a >= st.leader) return 1.3;
    const u = a / st.leader;
    const n = st.steps;
    for (let i = 1; i <= n; i++) {
      if (u < st.stepT[i]) {
        const k = (u - st.stepT[i - 1]) / Math.max(1e-4, st.stepT[i] - st.stepT[i - 1]);
        // Skok w pierwszych 30% kroku, potem przestój.
        return ((i - 1) + Math.min(1, k / 0.3)) / n * 1.05;
      }
    }
    return 1.05;
  }

  /**
   * @param {object} f cam {x,y,zoom}, viewW, viewH, dt, originX, originY
   * @param {object} o { layer (skały gry), zOf, glow (GlowSprites) }
   */
  update(f, o) {
    const cam = f.cam;
    const zoom = Math.max(1e-5, cam.zoom || 1);
    const halfW = f.viewW * 0.5 / zoom;
    const halfH = f.viewH * 0.5 / zoom;
    const reachX = halfW * 1.05 + 400;
    const reachY = halfH * 1.05 + 400;
    const dt = Math.min(0.1, Math.max(0, Number(f.dt) || 0));
    let storm = 0;
    if (this.enabled) {
      for (let k = 0; k < 5; k++) {
        const sx = k === 0 ? 0 : (k & 1 ? 1 : -1) * halfW * 0.6;
        const sy = k === 0 ? 0 : (k & 2 ? 1 : -1) * halfH * 0.6;
        storm = Math.max(storm, this.field.stormAt(cam.x + sx, cam.y + sy));
      }
    }
    this.intensity = storm;
    const rocks = this.enabled ? this._collectRocks(o.layer, o.zOf, cam.x, cam.y, reachX, reachY) : this._rocks;
    if (!this.enabled) rocks.length = 0;
    const v = this._view;
    v.x = cam.x; v.y = cam.y; v.halfW = halfW * 1.1; v.halfH = halfH * 1.1;
    this.sim.update(dt, rocks, storm, v);
    this._frame(f, zoom, dt);
    if (this.enabled && storm > 0.02) this._crackle(dt, rocks, storm);
    this.stats.rocks = rocks.length;
    this.stats.strikes = this.sim.strikes.length;
    this.stats.sheets = this.sim.sheets.length;
  }

  /**
   * Wymuszony piorun (przycisk dema): łuk między dużymi skałami przy punkcie
   * (świat) — skała energetyczna ma pierwszeństwo, partner 900–3000 j. dalej
   * (długi, rozgałęziony kanał); bez partnera — wyładowanie w pył.
   */
  forceStrike(layer, zOf, x, y) {
    const cands = [];
    layer.forEachLoaded((rock) => {
      if (rock.r < 90) return;
      const d = Math.hypot(rock.x - x, rock.y - y);
      if (d < 3600) cands.push({ id: rock.id, x: rock.x, y: rock.y, z: zOf(rock), r: rock.r, d, e: rock.type === ENERGY_TYPE ? 1 : 0 });
    });
    if (!cands.length) return false;
    // A: blisko punktu, duża, energetyczna lepiej.
    let a = null;
    for (const c of cands) {
      const score = c.r * (1 + c.e) / (1 + (c.d / 1800) ** 2);
      if (!a || score > a.score) { a = c; a.score = score; }
    }
    // B: jak najdalej w zasięgu łuku (900–3000 j.), duża.
    let b = null;
    for (const c of cands) {
      if (c === a) continue;
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      const reach = Math.min(3300, 900 + 2.2 * (a.r + c.r));
      if (d < 900 || d > reach) continue;
      const score = d * (0.6 + c.r / 600) * (1 + c.e * 0.5);
      if (!b || score > b.score) { b = c; b.score = score; }
    }
    const sim = this.sim;
    sim.cooldown.delete(a.id);
    if (b) sim.cooldown.delete(b.id);
    const cloud = sim.config.cloudShare;
    // Z partnerem — łuk; symulator losuje partnera z puli, więc pula = [a, b].
    sim.config.cloudShare = b ? 0 : 1;
    const s = sim._spawnStrike(b ? [a, b] : [a], sim.time);
    sim.config.cloudShare = cloud;
    if (!s) return false;
    sim.strikes.push(s);
    return true;
  }

  _frame(f, zoom, dt) {
    const B = this.batch;
    B.begin();
    const L = this.look;
    const ox = f.originX;
    const oy = f.originY;
    const now = this.sim.time;
    const lights = this._lights;
    lights.length = 0;
    this.flashes.length = 0;
    const slots = this.shared.strikes.array;
    for (const s of slots) s.w = 0;
    let slot = 0;
    const tick = ++this._tick;
    for (const s of this.sim.strikes) {
      let st = this._state.get(s.id);
      if (!st) { st = this._newState(s); this._state.set(s.id, st); }
      st.tick = tick;
      const a = now - s.t0;
      const reveal = this._reveal(st, a);
      // Udar: skok w ~6 ms, zanik; poświata po ostatnim udarze.
      let strokeMain = 0;
      let strokeBranch = 0;
      let strokeIdx = -1;
      for (let k = 0; k < st.strokes.length; k++) {
        const sk = st.strokes[k];
        const t = a - sk.at;
        if (t < 0) continue;
        const e = sk.amp * Math.min(1, t / 0.006);
        const m = e * Math.exp(-t / 0.075);
        if (m > strokeMain) { strokeMain = m; strokeIdx = k; }
        if (k === 0) strokeBranch = e * Math.exp(-t / 0.035);
      }
      const after = a > st.leader ? 0.14 * Math.exp(-(a - st.last) / 0.22) * Math.min(1, (a - st.leader) / 0.05) : 0;
      const flick = 0.82 + 0.18 * _hash(Math.floor(now * 90) + s.id * 13.1);
      const leaderI = a < st.leader ? (this.look.leaderI ?? 0.22) * flick : 0;
      // Segmenty łańcuchów.
      for (const ch of st.chains) {
        const P = ch.points;
        const T = ch.t;
        const main = ch.level === 0;
        const rsBase = (main ? 1 : (ch.level === 1 ? 0.55 : 0.38)) * Math.min(1.6, Math.max(0.6, st.len / 1500));
        for (let i = 0; i < ch.count - 1; i++) {
          if (T[i] > reveal) break;
          const tipK = Math.exp(-Math.max(0, reveal - T[i + 1]) / 0.035);
          let I;
          let white;
          let aft = 0;
          if (a < st.leader) {
            I = (leaderI + 0.9 * tipK) * (main ? 1 : ch.w * 1.4);
            white = 0.25 + 0.6 * tipK;
          } else if (main) {
            I = Math.max(strokeMain, after) * flick;
            white = strokeMain > after ? 1 : 0.2;
            aft = strokeMain > after ? 0 : 1;
          } else {
            if (ch.dead) { I = 0.25 * strokeBranch * ch.w; white = 0.3; }
            else { I = Math.max(strokeBranch, after * 0.5) * ch.w * 1.6; white = strokeBranch > after ? 0.85 : 0.2; aft = strokeBranch > after ? 0 : 1; }
          }
          if (I < 0.004) continue;
          // Udary powrotne: drobne przesunięcie kanału (migotanie).
          let jx = 0;
          let jy = 0;
          if (strokeIdx > 0 && main) {
            const h = _hash(i * 7.3 + strokeIdx * 91.7 + s.id);
            const amp = st.len * 0.004;
            jx = (h - 0.5) * amp;
            jy = (_hash(h * 13.7) - 0.5) * amp;
          }
          const k0 = i * 3;
          const k1 = k0 + 3;
          // Zwężenie ku końcom gałęzi.
          const taper = main ? 1 : Math.max(0.35, 1 - T[i] * 0.4);
          B.push(
            P[k0] - ox + jx, -(P[k0 + 1] - oy) - jy, P[k0 + 2],
            P[k1] - ox + jx, -(P[k1 + 1] - oy) - jy, P[k1 + 2],
            rsBase * taper, I, white, aft
          );
        }
      }
      // Światła: czubek lidera, łańcuch wzdłuż kanału przy udarze, gałęzie.
      const mainCh = st.chains[0];
      if (a < st.leader) {
        const tip = this._pointAt(mainCh, Math.min(1, reveal));
        this._light(tip.x, tip.y, tip.z + 60, 700, L.leader, 0.35 * flick, 0.25);
      } else {
        const I = Math.max(strokeMain, after * 0.6) * flick;
        if (I > 0.01) {
          const n = Math.max(3, Math.min(10, Math.round(st.len / L.lightSpacing)));
          const spacing = st.len / n;
          const col = strokeMain > after ? L.light : L.after;
          for (let k = 0; k < n; k++) {
            const p = this._pointAt(mainCh, (k + 0.5) / n);
            this._light(p.x, p.y, p.z + 80, Math.max(900, spacing * 2.4), col, L.lightGain * I / Math.sqrt(n) * 0.8, 0.12);
          }
          for (let c = 1; c < st.chains.length; c++) {
            const ch = st.chains[c];
            if (ch.level !== 1 || ch.dead || strokeBranch * ch.w < 0.05) continue;
            const p = this._pointAt(ch, 0.5);
            this._light(p.x, p.y, p.z + 60, 700, L.light, strokeBranch * ch.w, 0.14);
          }
        }
      }
      // Rozbłysk pęknięć skał na końcach (skała → pył: tylko początek).
      if (strokeIdx >= 0 && slot < slots.length) {
        slots[slot++].set(st.A.x - ox, -(st.A.y - oy), st.A.z, strokeMain);
        if (slot < slots.length && s.kind === 'arc') slots[slot++].set(st.B.x - ox, -(st.B.y - oy), st.B.z, strokeMain);
      }
      // Nowy udar = iskry, błysk, żar i łuki w miejscu uderzenia.
      if (strokeIdx > st.fx) {
        st.fx = strokeIdx;
        this._impact(s, st, st.strokes[strokeIdx].amp, strokeIdx === 0, ox, oy);
        if (s.kind === 'arc') this._impact(s, st, st.strokes[strokeIdx].amp, strokeIdx === 0, ox, oy, true);
      }
    }
    for (const [id, st] of this._state) if (st.tick !== tick) this._state.delete(id);
    // Błyski w chmurach głęboko pod płaszczyzną: światło w mgle + niebo.
    for (const sh of this.sim.sheets) {
      const e = sheetEnvelope(sh, now - sh.t0);
      if (!(e > 0.02)) continue;
      this._light(sh.x, sh.y, sh.z, sh.range, L.sheet, L.sheetGain * e, 0.8);
      const fi = this.flashes.length;
      const fl = this._flashPool[fi] || (this._flashPool[fi] = { x: 0, y: 0, e: 0, range: 0 });
      fl.x = sh.x; fl.y = sh.y; fl.e = e; fl.range = sh.range;
      this.flashes.push(fl);
    }
    this._arcsFrame(dt, ox, oy);
    B.commit(zoom);
    this.stats.segments = B.count;
    this.stats.lights = lights.length;
  }

  _pointAt(ch, u) {
    const T = ch.t;
    const P = ch.points;
    let i = 0;
    while (i < ch.count - 2 && T[i + 1] < u) i++;
    const k = Math.max(0, Math.min(1, (u - T[i]) / Math.max(1e-5, T[i + 1] - T[i])));
    const p = this._pt || (this._pt = { x: 0, y: 0, z: 0 });
    p.x = P[i * 3] + (P[i * 3 + 3] - P[i * 3]) * k;
    p.y = P[i * 3 + 1] + (P[i * 3 + 4] - P[i * 3 + 1]) * k;
    p.z = P[i * 3 + 2] + (P[i * 3 + 5] - P[i * 3 + 2]) * k;
    return p;
  }

  _light(x, y, z, range, col, I, scatter) {
    const i = this._lights.length;
    const l = this._lightPool[i] || (this._lightPool[i] = { x: 0, y: 0, z: 0, range: 0, r: 0, g: 0, b: 0, scatter: 0 });
    l.x = x; l.y = y; l.z = z; l.range = range;
    l.r = col[0] * I; l.g = col[1] * I; l.b = col[2] * I;
    l.scatter = scatter;
    this._lights.push(l);
  }

  /** Iskry (GPU), błysk, żar i łuki w miejscu uderzenia (koniec A albo B). */
  _impact(s, st, amp, main, ox, oy, endB = false) {
    const E = endB ? st.B : st.A;
    const x = E.x;
    const y = E.y;
    const z = E.z;
    const cx = endB ? s.bcx : s.acx;
    const cy = endB ? s.bcy : s.acy;
    const rr = endB ? s.br : s.ar;
    let nx = x - cx;
    let ny = y - cy;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const k = Math.max(0.3, Math.min(1.5, amp));
    const sx = x - ox;
    const sy = -(y - oy);
    const L = this.look;
    // Snop jonów od powierzchni (scena: y odwrócone), trochę ku kamerze.
    this.sparks?.emit(sx, sy, z + 10, nx, -ny, 0.45, (main ? 420 : 200) * k, {
      cone: -0.1, speed: [250, 1700 * (0.6 + 0.4 * k)], life: [0.12, 0.6], color: L.ion, size: 5
    });
    this.sparks?.emit(sx, sy, z + 10, nx, -ny, 1.2, (main ? 90 : 40) * k, {
      cone: 0.55, speed: [600, 2600], life: [0.05, 0.2], color: [3.2, 3.6, 4.4], size: 3
    });
    // Błysk i stygnący żar (duszki), światło punktu.
    this._glows.push({ x, y, z: z + 20, t: 0, life: 0.09, size: 90 + rr * 0.5, col: [3.4, 3.8, 4.6], k });
    this._glows.push({ x, y, z: z + 15, t: 0, life: 0.7, size: 26 + rr * 0.12, col: [1.1, 0.45, 1.6], k: k * 0.8 });
    // Łuki pełzające po skale: od miejsca uderzenia do punktów obrysu obok.
    const arcs = main ? 3 : 2;
    for (let i = 0; i < arcs; i++) {
      const aa = (fxRandom.next() * 2 - 1) * 1.2;
      const ca = Math.cos(aa);
      const sa = Math.sin(aa);
      const ex = cx + (nx * ca - ny * sa) * rr * 0.95;
      const ey = cy + (nx * sa + ny * ca) * rr * 0.95;
      this._addArc(x, y, z, ex, ey, z - rr * 0.1, 0.08 + fxRandom.next() * 0.14, 0.35 + fxRandom.next() * 0.25);
    }
  }

  _addArc(x0, y0, z0, x1, y1, z1, life, w) {
    if (this._arcs.length > 48) return;
    const chains = buildBolt(x0, y0, z0, x1, y1, z1, (fxRandom.next() * 4294967296) >>> 0, { levels: 4, branches: 1, jag: 0.3, wander: 0.15, branchLen: 0.4 });
    this._arcs.push({ chains, t: 0, life, w, len: Math.hypot(x1 - x0, y1 - y0) });
  }

  /** Ciche trzaski na skałach energetycznych w kadrze (ognie świętego Elma). */
  _crackle(dt, rocks, storm) {
    if (!rocks.length) return;
    let expect = rocks.length * 0.7 * storm * dt;
    let budget = 3;
    while (budget-- > 0 && fxRandom.next() < expect) {
      expect -= 1;
      const r = rocks[Math.floor(fxRandom.next() * rocks.length)];
      const a0 = fxRandom.next() * Math.PI * 2;
      const a1 = a0 + (fxRandom.next() < 0.5 ? -1 : 1) * (0.4 + fxRandom.next() * 0.9);
      const z = r.z + r.r * 0.45;
      this._addArc(r.x + Math.cos(a0) * r.r * 0.85, r.y + Math.sin(a0) * r.r * 0.85, z,
        r.x + Math.cos(a1) * r.r * 0.85, r.y + Math.sin(a1) * r.r * 0.85, z, 0.05 + fxRandom.next() * 0.1, 0.25);
    }
  }

  _arcsFrame(dt, ox, oy) {
    const B = this.batch;
    let w = 0;
    for (const arc of this._arcs) {
      arc.t += dt;
      if (arc.t >= arc.life) continue;
      this._arcs[w++] = arc;
      const u = arc.t / arc.life;
      const I = (u < 0.15 ? u / 0.15 : Math.exp(-(u - 0.15) * 3.5)) * (0.75 + 0.25 * fxRandom.next());
      const rs = arc.w * Math.min(1, Math.max(0.35, arc.len / 600));
      for (const ch of arc.chains) {
        const P = ch.points;
        for (let i = 0; i < ch.count - 1; i++) {
          const k0 = i * 3;
          B.push(P[k0] - ox, -(P[k0 + 1] - oy), P[k0 + 2], P[k0 + 3] - ox, -(P[k0 + 4] - oy), P[k0 + 5], rs * (ch.level ? 0.6 : 1), I * (ch.level ? 0.6 : 1), 0.7, 0);
        }
      }
      if (I > 0.2) {
        const p = this._pointAt(arc.chains[0], 0.5);
        this._light(p.x, p.y, p.z + 40, 450, STORM_LOOK.light, 0.6 * I, 0.6);
      }
    }
    this._arcs.length = w;
    let g = 0;
    for (const gl of this._glows) {
      gl.t += dt;
      if (gl.t < gl.life) this._glows[g++] = gl;
    }
    this._glows.length = g;
  }

  /** Światła tej klatki do siatki świateł (scena względem początku). */
  addLights(grid, ox, oy) {
    for (const l of this._lights) {
      grid.add(l.x - ox, -(l.y - oy), l.z, l.range, l.r, l.g, l.b, l.scatter);
    }
    for (const gl of this._glows) {
      const e = Math.max(0, 1 - gl.t / gl.life);
      const I = e * e * gl.k * (gl.life < 0.2 ? 0.9 : 0.3);
      if (I > 0.01) grid.add(gl.x - ox, -(gl.y - oy), gl.z + 40, gl.life < 0.2 ? 1000 : 450, gl.col[0] * I * 0.3, gl.col[1] * I * 0.3, gl.col[2] * I * 0.3, 0.1);
    }
  }

  /** Duszki: błyski i żar w miejscach uderzeń. */
  addGlows(glow, ox, oy) {
    for (const gl of this._glows) {
      const u = gl.t / gl.life;
      const e = gl.life < 0.2 ? Math.exp(-u * 3) : (1 - u) * (1 - u);
      const k = e * gl.k;
      if (k < 0.01) continue;
      glow.add(gl.x - ox, -(gl.y - oy), gl.z, gl.size * (gl.life < 0.2 ? 0.7 + u : 1), gl.col[0] * k, gl.col[1] * k, gl.col[2] * k, GLOW_ROUND);
    }
  }
}
