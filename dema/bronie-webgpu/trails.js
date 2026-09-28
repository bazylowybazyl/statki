// dema/bronie-webgpu/trails.js
//
// Smugi pocisków w przestrzeni świata — port SlugTrail (src/3d/slugTrail3D.js,
// smuga Hexlance'a i Yamato) do TSL, z jedną różnicą: styl (barwy, życie,
// turbulencja, żar czubka, dryf, helisa) siedzi w TABLICY STYLÓW, a segment
// niesie tylko jego numer — wszystkie bronie dzielą jeden draw call.
//
// Segmenty zapisuje CPU wyłącznie przy emisji (pierścień), GPU liczy dryf gazu,
// rozszerzanie z wiekiem, meandry, włókna, zanik i rozżarzony rdzeń tuż za
// pociskiem. Próbkowanie po PRZEBYTEJ DRODZE (co `spacing` j.), wzór wzdłuż
// smugi od drogi — nie od czasu — jak w grze.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, attributeArray, instanceIndex,
  positionGeometry, uv, varyingProperty, texture, If, select, mix, clamp, smoothstep, exp, pow,
  sin, cos, max, min, abs, length, normalize
} from 'three/tsl';

const CAP = 1 << 15;
const SEG_FLOATS = 16;
const STYLE_V4 = 6;

// Style (kolejność = indeks w tablicy). Wartości barw jak w slugTrail3D.js
// (Hexlance, Yamato) i nowe dla pozostałych broni.
export const TRAIL_STYLES = [
  // 0 HEXLANCE — pełna smuga z gry: 3,5 s, turbulencja 0,45
  { key: 'hexlance', young: [0.22, 0.62, 1.25], old: [0.07, 0.035, 0.30], accent: [0.55, 1.05, 1.70], hot: [1.10, 1.50, 2.00], life: 3.5, opacity: 1.0, turb: 0.45, hotAmt: 1.2, drift: 30, grow: 0.16, growCap: 2.1, helix: 0, helixFreq: 0 },
  // 1 YAMATO — delikatniejsza, cyjan (BULLET_TRAIL_CONFIG)
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
export const TRAIL = Object.fromEntries(TRAIL_STYLES.map((s, i) => [s.key, i]));

export class TrailSystem {
  constructor({ scene, noise, renderOrder = 50 }) {
    this.segNode = attributeArray(CAP * 4, 'vec4').setName('trailSegs');
    this.data = this.segNode.value.array;
    this.head = 0;
    this.pending = 0;
    this.pendingStart = 0;
    const vals = [];
    for (const s of TRAIL_STYLES) {
      vals.push(new THREE.Vector4(s.young[0], s.young[1], s.young[2], s.life));
      vals.push(new THREE.Vector4(s.old[0], s.old[1], s.old[2], s.opacity));
      vals.push(new THREE.Vector4(s.accent[0], s.accent[1], s.accent[2], s.turb));
      vals.push(new THREE.Vector4(s.hot[0], s.hot[1], s.hot[2], s.hotAmt));
      vals.push(new THREE.Vector4(s.drift, s.grow, s.growCap, 0));
      vals.push(new THREE.Vector4(s.helix, s.helixFreq, 0, 0));
    }
    this.styles = uniformArray(vals, 'vec4');
    this.U = { time: uniform(0), gain: uniform(1) };
    this.noise = noise;
    this.time = 0;
    this._buildMesh(scene, renderOrder);
    this.handles = [];
    this.stats = { segments: 0 };
  }

  _buildMesh(scene, renderOrder) {
    const U = this.U;
    const segs = this.segNode;
    const styles = this.styles;
    const noise = this.noise;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
    geo.setIndex([0, 2, 1, 2, 3, 1]);
    const vA = varyingProperty('vec4', 'vTrA');   // u (w poprzek), wiek, droga, ziarno
    const vB = varyingProperty('vec4', 'vTrB');   // styl, energia, życie, -
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    const S = (st, k) => styles.element(int(st).mul(int(STYLE_V4)).add(int(k)));
    // Koniec segmentu: dryf gazu, meandry, helisa, szerokość rosnąca z wiekiem.
    const endpoint = (P, side, width, path, seed, st, v) => {
      const age = max(U.time.sub(P.w), 0.0).toVar();
      const s4 = S(st, 4);
      const s5 = S(st, 5);
      const turb = S(st, 2).w;
      const dir = vec2(side.y.negate(), side.x);
      const drift = min(age, 0.35).add(max(age.sub(0.35), 0.0).mul(0.26));
      const p = P.xy.sub(dir.mul(s4.x.mul(drift))).toVar();
      const develop = smoothstep(0.15, 2.8, age);
      const wobble = sin(path.mul(2.7).add(seed).add(age.mul(0.75))).mul(0.68).add(sin(path.mul(6.1).sub(seed).sub(age.mul(0.9))).mul(0.28));
      p.addAssign(side.mul(wobble.mul(width).mul(turb).mul(develop).mul(0.46)));
      // helisa: skręt pasma wokół osi (zwęża szerokość po stronie „tyłu”)
      const hel = sin(path.mul(s5.y.mul(6.2831853)).add(seed).sub(age.mul(3.0))).mul(s5.x);
      p.addAssign(side.mul(hel.mul(width).mul(0.5)));
      const neck = mix(float(0.30), float(1.0), smoothstep(0.0, 0.62, age));
      const w = width.mul(neck).mul(float(1.0).add(min(age.mul(s4.y), s4.z)));
      return vec3(p.add(side.mul(v.mul(w))), P.z);
    };
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(4)).toVar();
      const A = segs.element(i).toVar();
      const B = segs.element(i.add(uint(1))).toVar();
      const C = segs.element(i.add(uint(2))).toVar();
      const D = segs.element(i.add(uint(3))).toVar();
      const st = C.w.toVar();
      const life = S(st, 0).w;
      const t = positionGeometry.x;
      const v = positionGeometry.y;
      const out = vec3(0.0, 0.0, -80.0).toVar();
      vA.assign(vec4(0.0));
      vB.assign(vec4(0.0));
      const ageB = U.time.sub(B.w);
      If(ageB.lessThan(life.add(0.05)).and(C.z.greaterThan(0.0)), () => {
        const side = C.xy;
        const pa = endpoint(A, side, C.z, D.x, D.z, st, v);
        const pb = endpoint(B, side, C.z, D.y, D.z, st, v);
        out.assign(mix(pa, pb, t));
        const birth = mix(A.w, B.w, t);
        vA.assign(vec4(v, max(U.time.sub(birth), 0.0), mix(D.x, D.y, t), D.z));
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
      const y = vA.x;
      const age = vA.y;
      const path = vA.z;
      const seed = vA.w;
      const turb = s2.w;
      const nAge = clamp(age.div(max(s0.w, 1e-3)), 0.0, 1.0);
      const fade = pow(float(1.0).sub(nAge), 1.3).mul(float(1.0).sub(smoothstep(0.75, 1.0, nAge)))
        .mul(float(1.0).add(s3.w.mul(exp(age.mul(-5.0))))).mul(s1.w).mul(pow(max(vB.y, 1e-3), 0.75)).mul(this.U.gain);
      // cloud() z gry: ~3,2 komórki na jednostkę drogi, 2,8 w poprzek (tekstura: 4 komórki na 1,0)
      const n = texture(noise, vec2(path.mul(0.8).sub(this.U.time.mul(0.12)), y.mul(0.7).add(seed.mul(0.25)))).r;
      const w = y.add(n.sub(0.5).mul(0.16).mul(turb).mul(smoothstep(0.1, 1.5, age)));
      const diffuse = exp(w.mul(w).mul(-5.5));
      const f1 = w.sub(sin(path.mul(7.5).sub(this.U.time.mul(0.9)).add(seed)).mul(0.17).mul(turb)).mul(10.0);
      const f2 = w.add(0.25).sub(sin(path.mul(5.0).sub(this.U.time.mul(0.65)).add(seed)).mul(0.12).mul(turb)).mul(15.0);
      const filament = exp(f1.mul(f1).negate());
      const filament2 = exp(f2.mul(f2).negate());
      const center = exp(w.mul(w).mul(-40.0)).mul(exp(age.mul(-0.13)));
      const pulse = sin(path.mul(15.0).add(seed).sub(this.U.time.mul(1.2))).mul(0.06).add(0.94);
      const col = mix(s0.xyz, s1.xyz, smoothstep(0.12, 0.95, nAge)).mul(diffuse.mul(n.mul(0.35).add(0.65))).toVar();
      col.addAssign(s2.xyz.mul(filament.mul(0.24).add(filament2.mul(0.13)).add(center.mul(0.28))).mul(exp(age.mul(-0.065))));
      col.addAssign(s3.xyz.mul(exp(w.mul(w).mul(-70.0))).mul(exp(age.mul(-7.0))));
      const edge = float(1.0).sub(smoothstep(0.68, 1.0, abs(y)));
      return vec4(max(col.mul(fade).mul(pulse).mul(edge), vec3(0.0)), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'trails';
    this.mesh.count = CAP;
    scene.add(this.mesh);
  }

  /**
   * Nowa smuga (świat gry). width — półszerokość [j.], spacing — próbki co
   * tyle j. drogi, pathUnit — j. drogi na „sekundę” wzoru.
   */
  begin(styleKey, x, y, dx, dy, { width = 27, spacing = 45, pathUnit = 200, z = 14 } = {}) {
    const style = TRAIL[styleKey] ?? 0;
    const l = Math.hypot(dx, dy) || 1;
    const h = {
      style, width, spacing, pathUnit, z, active: true,
      lx: x, ly: y, lt: this.time, lpath: Math.random() * 40,
      path: 0, acc: 0, dx: dx / l, dy: dy / l, seed: Math.random() * 100, energy: 1
    };
    h.path = h.lpath;
    return h;
  }

  /** Przesuwa smugę do (x, y) — emisja segmentów po drodze (czas w oknie klatki). */
  advance(h, x, y, t0, t1) {
    if (!h || !h.active) return;
    const sx = h.lx; const sy = h.ly;
    const seg = Math.hypot(x - sx, y - sy);
    if (seg < 1e-6) return;
    const dx = (x - sx) / seg; const dy = (y - sy) / seg;
    h.dx = dx; h.dy = dy;
    let d = h.spacing - h.acc;
    let px = sx; let py = sy; let pt = h.lt; let ppath = h.path;
    while (d <= seg) {
      const f = d / seg;
      const nx = sx + (x - sx) * f;
      const ny = sy + (y - sy) * f;
      const nt = t0 + (t1 - t0) * f;
      const npath = h.path + d / h.pathUnit;
      this._write(h, px, py, pt, ppath, nx, ny, nt, npath);
      px = nx; py = ny; pt = nt; ppath = npath;
      d += h.spacing;
    }
    h.acc = seg - (d - h.spacing);
    h.path += seg / h.pathUnit;
    // ostatni zapisany węzeł zostaje początkiem następnego segmentu
    const wrote = px !== sx || py !== sy;
    if (wrote) { h.lx = px; h.ly = py; h.lt = pt; h.lpath = ppath; }
    h._curX = x; h._curY = y; h._curT = t1;
  }

  /** Domyka smugę w punkcie (np. trafienia). */
  end(h, x, y, t) {
    if (!h || !h.active) return;
    const d = Math.hypot(x - h.lx, y - h.ly);
    if (d > 1) this._write(h, h.lx, h.ly, h.lt, h.lpath, x, y, t, h.lpath + d / h.pathUnit);
    h.active = false;
  }

  _write(h, ax, ay, at, apath, bx, by, bt, bpath) {
    const i = this.head;
    this.head = (this.head + 1) & (CAP - 1);
    if (this.pending === 0) this.pendingStart = i;
    this.pending = Math.min(CAP, this.pending + 1);
    const o = i * SEG_FLOATS;
    const D = this.data;
    // bok = kierunek obrócony o −90° w płaszczyźnie sceny (scena: y odwrócone)
    const sdx = h.dx; const sdy = -h.dy;
    D[o] = ax; D[o + 1] = -ay; D[o + 2] = h.z; D[o + 3] = at;
    D[o + 4] = bx; D[o + 5] = -by; D[o + 6] = h.z; D[o + 7] = bt;
    D[o + 8] = sdy; D[o + 9] = -sdx; D[o + 10] = h.width; D[o + 11] = h.style;
    D[o + 12] = apath; D[o + 13] = bpath; D[o + 14] = h.seed; D[o + 15] = h.energy;
    this.stats.segments++;
  }

  update(dt) {
    this.time += dt;
    this.U.time.value = this.time;
    if (this.pending > 0) {
      const attr = this.segNode.value;
      attr.clearUpdateRanges();
      const start = this.pendingStart;
      const n = this.pending;
      if (start + n <= CAP) {
        attr.addUpdateRange(start * SEG_FLOATS, n * SEG_FLOATS);
      } else {
        attr.addUpdateRange(start * SEG_FLOATS, (CAP - start) * SEG_FLOATS);
        attr.addUpdateRange(0, (start + n - CAP) * SEG_FLOATS);
      }
      attr.needsUpdate = true;
      this.pending = 0;
    }
  }

  clear() {
    this.data.fill(0);
    const attr = this.segNode.value;
    attr.clearUpdateRanges();
    attr.needsUpdate = true;
    this.pending = 0;
  }
}
