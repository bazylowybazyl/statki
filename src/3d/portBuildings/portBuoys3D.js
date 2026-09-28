// Boje redy w 3D (Z7): znaczniki stref postoju z portBuoyLayout.js (strefy liczy
// portParking.js, Z2). Bez kolizji — statki przelatują nad nimi.
//  - kadłub boi (pływak z masztem) w BG, pod płaszczyzną gry (z −44…−4);
//  - światło w FG (nad statkami): billboard z małym jasnym rdzeniem HDR i
//    poświatą, rytm błysków z profilu planety (portBuildingStyle.js: Ziemia
//    Fl 3 s, Mars Fl(2) 5 s, Jowisz Q), barwa roli (cywilna / wojskowa / kolejka).
// Boje leżą po całym porcie (±60 tys. j. od planety) — co klatkę tylko te w
// kadrze trafiają do buforów, WZGLĘDEM POCZĄTKU PRZY KAMERZE (sceneOriginNearCamera
// w mesh.position, dane w double na CPU) — bez drgań float32 przy 5–10 mln j.
// Dwa draw calle, zero alokacji na klatkę.
import * as THREE from 'three';
import { sceneOriginNearCamera } from '../sceneOrigin.js';
import { resolvePortBuildingStyle } from './portBuildingStyle.js';
import { BUOY_KIND } from './portBuoyLayout.js';

const BODY_Z = -24;         // środek pływaka (z świata)
const LIGHT_Z = 6;          // światło tuż nad płaszczyzną gry
const MARGIN_PX = 64;
// rozmiar per rodzaj: narożnik, brzeg, rząd — [promień pływaka, rozmiar światła]
const KIND_SIZE = [[30, 70], [22, 48], [14, 30]];

const BODY_VERTEX = /* glsl */`
attribute vec4 iPos;    // x, y wzgledem poczatku, z, skala
attribute vec4 iData;   // rodzaj, rola, faza, -
uniform vec3 uSunDirW;
varying vec3 vN;
varying float vRole;
varying vec3 vSun;
varying float vLocalY;
void main() {
  vec3 p = position * vec3(iPos.w, iPos.w, iPos.w);
  vec3 w = vec3(iPos.xy, iPos.z) + p;
  vN = normalize(mat3(modelViewMatrix) * normal);
  vSun = normalize(mat3(viewMatrix) * uSunDirW);
  vRole = iData.y;
  vLocalY = position.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
}
`;
const BODY_FRAGMENT = /* glsl */`
uniform vec3 uRoleCol[3];
uniform float uSunVisS;
varying vec3 vN;
varying float vRole;
varying vec3 vSun;
varying float vLocalY;
void main() {
  vec3 N = normalize(vN);
  float NdL = max(dot(N, normalize(vSun)), 0.0);
  // plywak: ciemny grafit z pasem w barwie roli (zmatowionym), maszt jasny
  int r = int(vRole + 0.5);
  vec3 role = r == 0 ? uRoleCol[0] : (r == 1 ? uRoleCol[1] : uRoleCol[2]);
  vec3 albedo = vLocalY > 0.55 ? vec3(0.42, 0.43, 0.42) : (vLocalY > 0.2 ? role * 0.16 : vec3(0.05, 0.055, 0.06));
  vec3 col = albedo * (vec3(1.0, 0.97, 0.92) * NdL * uSunVisS + vec3(0.05, 0.056, 0.066));
  gl_FragColor = vec4(col, 1.0);
}
`;

const LIGHT_VERTEX = /* glsl */`
attribute vec4 iPos;    // x, y wzgledem poczatku, z, rozmiar [j.]
attribute vec4 iData;   // rodzaj, rola, faza, -
uniform vec4 uRhythm;   // okres [s], liczba blyskow, dlugosc blysku [s], czas
uniform float uPxWorld; // jednostki swiata na piksel (z = 0)
uniform vec3 uRoleCol[3];
varying vec2 vQ;
varying vec3 vCol;
varying float vFlash;
float buoyFlash(float t, float phase) {
  float period = max(0.2, uRhythm.x);
  float u = fract(t / period - phase * 0.35) * period;
  float on = 0.0;
  for (int k = 0; k < 3; k++) {
    if (float(k) < uRhythm.y) {
      float t0 = float(k) * uRhythm.z * 2.0;
      on = max(on, step(t0, u) * step(u, t0 + uRhythm.z));
    }
  }
  return on;
}
void main() {
  vQ = position.xy * 2.0;
  int r = int(iData.y + 0.5);
  vCol = r == 0 ? uRoleCol[0] : (r == 1 ? uRoleCol[1] : uRoleCol[2]);
  // boje rzedow swieca stale, narozniki i brzegi w rytmie redy
  vFlash = iData.x > 1.5 ? 0.55 : buoyFlash(uRhythm.w, iData.z);
  float size = max(iPos.w, uPxWorld * 7.0);
  vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}
`;
const LIGHT_FRAGMENT = /* glsl */`
varying vec2 vQ;
varying vec3 vCol;
varying float vFlash;
void main() {
  float d = length(vQ);
  if (d > 1.0) discard;
  // maly rdzen HDR (tylko w blysku) + poswiata gasnaca przed brzegiem kwadu
  float core = exp(-d * d * 60.0);
  float halo = pow(max(1.0 - d, 0.0), 2.2);
  vec3 col = vCol * (halo * (0.18 + 0.62 * vFlash)) + vec3(1.0, 0.96, 0.9) * core * (0.4 + 5.2 * vFlash);
  float a = max(col.r, max(col.g, col.b));
  gl_FragColor = vec4(col, a);
}
`;

export const PORT_BUOY_SHADERS = Object.freeze({ BODY_VERTEX, BODY_FRAGMENT, LIGHT_VERTEX, LIGHT_FRAGMENT });

// Pływak (sześciokąt) + maszt + latarnia — jedna geometria, oś z do góry,
// wysokość w [0, 1] (z lokalne: 0–0,2 dno, 0,2–0,55 pas roli, 0,55–1 maszt).
function makeBuoyGeometry() {
  const parts = [
    { r0: 1.0, r1: 0.85, z0: 0.0, z1: 0.5, seg: 6 },
    { r0: 0.12, r1: 0.12, z0: 0.5, z1: 0.95, seg: 4 },
    { r0: 0.3, r1: 0.26, z0: 0.95, z1: 1.05, seg: 6 }
  ];
  const pos = [];
  const nor = [];
  const idx = [];
  for (const p of parts) {
    const base = pos.length / 3;
    for (let k = 0; k <= p.seg; k++) {
      const a = (k / p.seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(c * p.r0, s * p.r0, p.z0, c * p.r1, s * p.r1, p.z1);
      const nz = (p.r0 - p.r1) / Math.max(1e-3, p.z1 - p.z0);
      const nl = Math.hypot(1, nz);
      nor.push(c / nl, s / nl, nz / nl, c / nl, s / nl, nz / nl);
    }
    for (let k = 0; k < p.seg; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    // wieczko
    const cap = pos.length / 3;
    pos.push(0, 0, p.z1);
    nor.push(0, 0, 1);
    for (let k = 0; k <= p.seg; k++) {
      const a = (k / p.seg) * Math.PI * 2;
      pos.push(Math.cos(a) * p.r1, Math.sin(a) * p.r1, p.z1);
      nor.push(0, 0, 1);
    }
    for (let k = 0; k < p.seg; k++) idx.push(cap, cap + 1 + k, cap + 2 + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function makeInstancedGeometry(base, capacity) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  if (base.getAttribute('normal')) geo.setAttribute('normal', base.getAttribute('normal'));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iData', iData);
  geo.instanceCount = 0;
  return { geo, iPos, iData };
}

/**
 * Boje redy portu. `buoys` — zbiór z buildPortBuoys (portBuoyLayout.js), w
 * układzie GRY; `style` — styl budowli (barwy ról, rytm). Obiekty trafiają do
 * sceny gospodarza (`scene.add(buoys.group)`), warstwy przez setLayers.
 */
export class PortBuoys3D {
  constructor({ buoys, style = 'earth' }) {
    this.style = style && style.palette ? style : resolvePortBuildingStyle(style);
    this.group = new THREE.Group();
    this.group.name = 'PortBuoys';
    this.origin = { x: 0, y: 0 };
    this._range = { start: 0, count: 0 };
    this.stats = { total: 0, drawn: 0 };
    this._uniforms = {
      uRoleCol: { value: [this.style.buoy.civil, this.style.buoy.military, this.style.buoy.queue].map((c) => new THREE.Vector3(...c)) },
      uRhythm: { value: new THREE.Vector4(this.style.buoy.period, this.style.buoy.flashes, this.style.buoy.flash, 0) },
      uPxWorld: { value: 1 },
      uSunDirW: { value: new THREE.Vector3(0.4, 0.3, 0.87).normalize() },
      uSunVisS: { value: 1 }
    };
    this._bodyBase = makeBuoyGeometry();
    this._quad = new THREE.PlaneGeometry(1, 1);
    this.setBuoys(buoys);
  }

  /** Nowy zbiór boi (np. po przeliczeniu redy) — bufory rosną tylko w górę. */
  setBuoys(buoys) {
    this.buoys = buoys || { count: 0 };
    const n = Math.max(16, this.buoys.count || 0);
    if (!this.body || this.capacity < n) {
      this.capacity = n;
      for (const m of [this.body, this.light]) {
        if (!m) continue;
        this.group.remove(m);
        m.geometry.dispose();
      }
      const b = makeInstancedGeometry(this._bodyBase, n);
      const l = makeInstancedGeometry(this._quad, n);
      this._b = b;
      this._l = l;
      if (!this.bodyMat) {
        this.bodyMat = new THREE.ShaderMaterial({ name: 'PortBuoyBody', uniforms: this._uniforms, vertexShader: BODY_VERTEX, fragmentShader: BODY_FRAGMENT });
        this.lightMat = new THREE.ShaderMaterial({
          name: 'PortBuoyLight', uniforms: this._uniforms, vertexShader: LIGHT_VERTEX, fragmentShader: LIGHT_FRAGMENT,
          transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true
        });
      }
      this.body = new THREE.Mesh(b.geo, this.bodyMat);
      this.light = new THREE.Mesh(l.geo, this.lightMat);
      this.body.name = 'PortBuoys_body';
      this.light.name = 'PortBuoys_light';
      // przycinanie robi update (kadr), obwiednia instancji nie jest znana three
      this.body.frustumCulled = false;
      this.light.frustumCulled = false;
      this.light.renderOrder = 30;
      this.group.add(this.body, this.light);
      this._attrs = [b.iPos, b.iData, l.iPos, l.iData];
      if (this._layers) this.setLayers(this._layers.bg, this._layers.fg);
    }
    this.stats.total = this.buoys.count || 0;
  }

  setLayers(bgLayer = 1, fgLayer = 2) {
    this._layers = { bg: bgLayer, fg: fgLayer };
    this.body.layers.set(bgLayer);
    this.light.layers.set(fgLayer);
  }

  /**
   * Klatka: `camera` — kamera gry { x, y, zoom } (ta sama, co passy Core3D),
   * opts: time [s], viewW / viewH [px], sunAzimuth (scena, rad), sunVisibility.
   */
  update(camera, opts = {}) {
    const B = this.buoys;
    const o = sceneOriginNearCamera(this.origin, camera);
    const zoom = Math.max(1e-4, Number(camera?.zoom) || 1);
    const vw = Number(opts.viewW) || 1920;
    const vh = Number(opts.viewH) || 1080;
    const halfW = vw / 2 / zoom + MARGIN_PX / zoom + 200;
    const halfH = vh / 2 / zoom + MARGIN_PX / zoom + 200;
    const cx = Number(camera?.x) || 0;
    const cy = Number(camera?.y) || 0;
    const bp = this._b.iPos.array;
    const bd = this._b.iData.array;
    const lp = this._l.iPos.array;
    const ld = this._l.iData.array;
    let n = 0;
    for (let i = 0; i < (B.count || 0); i++) {
      const x = B.x[i];
      const y = B.y[i];
      if (Math.abs(x - cx) > halfW || Math.abs(y - cy) > halfH) continue;
      const kind = B.kind[i];
      const size = KIND_SIZE[kind] || KIND_SIZE[BUOY_KIND.edge];
      const j = n * 4;
      // układ sceny: (x, −y) względem początku przy kamerze (liczone w double)
      const sx = x - o.x;
      const sy = -y - o.y;
      bp[j] = sx; bp[j + 1] = sy; bp[j + 2] = BODY_Z - size[0] * 0.5; bp[j + 3] = size[0];
      bd[j] = kind; bd[j + 1] = B.role[i]; bd[j + 2] = B.phase[i]; bd[j + 3] = 0;
      lp[j] = sx; lp[j + 1] = sy; lp[j + 2] = LIGHT_Z; lp[j + 3] = size[1];
      ld[j] = kind; ld[j + 1] = B.role[i]; ld[j + 2] = B.phase[i]; ld[j + 3] = 0;
      n++;
    }
    this.body.position.set(o.x, o.y, 0);
    this.light.position.set(o.x, o.y, 0);
    this._b.geo.instanceCount = n;
    this._l.geo.instanceCount = n;
    // własne obiekty zakresu (addUpdateRange alokuje { start, count } co wywołanie)
    this._range.count = n * 4;
    for (let k = 0; k < this._attrs.length; k++) {
      const a = this._attrs[k];
      a.updateRanges.length = 0;
      if (n > 0) {
        a.updateRanges.push(this._range);
        a.needsUpdate = true;
      }
    }
    this.body.visible = n > 0;
    this.light.visible = n > 0;
    const u = this._uniforms;
    u.uRhythm.value.w = Number(opts.time) || 0;
    u.uPxWorld.value = 1 / zoom;
    if (Number.isFinite(opts.sunAzimuth)) {
      const el = 49 * Math.PI / 180;
      u.uSunDirW.value.set(Math.cos(el) * Math.cos(opts.sunAzimuth), Math.cos(el) * Math.sin(opts.sunAzimuth), Math.sin(el));
    }
    if (Number.isFinite(opts.sunVisibility)) u.uSunVisS.value = opts.sunVisibility;
    this.stats.drawn = n;
    return n;
  }

  dispose() {
    for (const m of [this.body, this.light]) m?.geometry.dispose();
    this.bodyMat?.dispose();
    this.lightMat?.dispose();
    this._bodyBase.dispose();
    this._quad.dispose();
    this.group.removeFromParent();
  }
}
