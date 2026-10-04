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
import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard,
  attribute, cameraProjectionMatrix, cameraViewMatrix, dot, exp, float, fract, int, length, max, modelViewMatrix,
  normalView, normalize, positionGeometry, pow, select, step, uniform, varying, vec3, vec4
} from 'three/tsl';
import { sceneOriginNearCamera } from '../sceneOrigin.js';
import { uniformsAdapter } from '../tsl/uniformy.js';
import { blendAddytywnePremul } from '../tsl/mieszanie.js';
import { resolvePortBuildingStyle } from './portBuildingStyle.js';
import { BUOY_KIND } from './portBuoyLayout.js';

const BODY_Z = -24;         // środek pływaka (z świata)
const LIGHT_Z = 6;          // światło tuż nad płaszczyzną gry
const MARGIN_PX = 64;
// rozmiar per rodzaj: narożnik, brzeg, rząd — [promień pływaka, rozmiar światła]
const KIND_SIZE = [[30, 70], [22, 48], [14, 30]];

// Port WebGPU: materiały w TSL (NodeMaterial), wzory 1:1 z dawnym GLSL
// (PortBuoyBody / PortBuoyLight). Graf budowany RAZ na egzemplarz PortBuoys3D
// (materiał jest współdzielony przez przebudowy geometrii w setBuoys), wartości
// w `material.uniforms` (adapter src/3d/tsl/uniformy.js — `.value` jak dawniej).
// Pozycja zawsze przez węzeł modelViewMatrix (three składa go na CPU w double,
// renderer.highPrecision) — dane instancji są względem początku przy kamerze.

// barwa roli: 0 cywilna, 1 wojskowa, 2 kolejka (trzy uniformy zamiast tablicy vec3 —
// bez osobnego bufora uniformArray)
function roleColor(U, roleF) {
  const r = int(roleF.add(0.5));
  return select(r.equal(0), U.uRoleCol0, select(r.equal(1), U.uRoleCol1, U.uRoleCol2));
}

function buildBodyMaterial(U) {
  const iPos = attribute('iPos', 'vec4');   // x, y względem początku, z, skala
  const iData = attribute('iData', 'vec4'); // rodzaj, rola, faza, -
  const m = new THREE.NodeMaterial();
  m.name = 'PortBuoyBody';
  m.lights = false;
  m.fog = false;
  // pozycja lokalna siatki = dawne w = iPos.xyz + position * skala; dalej standardowo
  // modelViewMatrix (double na CPU) i projekcja kamery
  m.positionNode = positionGeometry.mul(iPos.w).add(iPos.xyz);
  const vRole = varying(iData.y, 'vBuoyRole');
  const vLocalY = varying(positionGeometry.z, 'vBuoyLocalY');
  // dawne normalize(mat3(viewMatrix) * uSunDirW)
  const vSun = varying(normalize(cameraViewMatrix.mul(vec4(U.uSunDirW, 0.0)).xyz), 'vBuoySun');
  m.fragmentNode = Fn(() => {
    const N = normalize(normalView);
    const NdL = max(dot(N, normalize(vSun)), 0.0);
    // pływak: ciemny grafit z pasem w barwie roli (zmatowionym), maszt jasny
    const role = roleColor(U, vRole);
    const albedo = select(vLocalY.greaterThan(0.55), vec3(0.42, 0.43, 0.42),
      select(vLocalY.greaterThan(0.2), role.mul(0.16), vec3(0.05, 0.055, 0.06)));
    const col = albedo.mul(vec3(1.0, 0.97, 0.92).mul(NdL).mul(U.uSunVisS).add(vec3(0.05, 0.056, 0.066)));
    return vec4(col, 1.0);
  })();
  return m;
}

// rytm błysku: uRhythm = okres [s], liczba błysków, długość błysku [s], czas
function buoyFlash(U, phase) {
  const R = U.uRhythm;
  const period = max(0.2, R.x);
  const u = fract(R.w.div(period).sub(phase.mul(0.35))).mul(period);
  let on = float(0.0);
  for (let k = 0; k < 3; k++) {
    const t0 = R.z.mul(k * 2.0);
    const lit = step(t0, u).mul(step(u, t0.add(R.z)));
    on = max(on, select(R.y.greaterThan(k), lit, float(0.0)));
  }
  return on;
}

function buildLightMaterial(U) {
  const iPos = attribute('iPos', 'vec4');   // x, y względem początku, z, rozmiar [j.]
  const iData = attribute('iData', 'vec4'); // rodzaj, rola, faza, -
  const m = new THREE.NodeMaterial();
  m.name = 'PortBuoyLight';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  // dawne AdditiveBlending + premultipliedAlpha (ONE, ONE) — shader pisze alfa = max(rgb)
  blendAddytywnePremul(m);
  m.forceSinglePass = true;
  // kwad zwrócony do kamery w przestrzeni widoku (jak dawny shader — bez gl_PointSize)
  m.vertexNode = Fn(() => {
    const size = max(iPos.w, U.uPxWorld.mul(7.0));
    const mv = modelViewMatrix.mul(vec4(iPos.xyz, 1.0)).toVar();
    const off = positionGeometry.xy.mul(size);
    return cameraProjectionMatrix.mul(vec4(mv.x.add(off.x), mv.y.add(off.y), mv.z, mv.w));
  })();
  const vQ = varying(positionGeometry.xy.mul(2.0), 'vBuoyQ');
  const vCol = varying(roleColor(U, iData.y), 'vBuoyCol');
  // boje rzędów świecą stale, narożniki i brzegi w rytmie redy
  const vFlash = varying(select(iData.x.greaterThan(1.5), float(0.55), buoyFlash(U, iData.z)), 'vBuoyFlash');
  m.fragmentNode = Fn(() => {
    const d = length(vQ).toVar();
    If(d.greaterThan(1.0), () => { Discard(); });
    // mały rdzeń HDR (tylko w błysku) + poświata gasnąca przed brzegiem kwadu
    const core = exp(d.mul(d).mul(-60.0));
    // max(1 − d, 0) ≥ 0: potęga bez ujemnej podstawy
    const halo = pow(max(float(1.0).sub(d), 0.0), 2.2);
    const col = vCol.mul(halo.mul(vFlash.mul(0.62).add(0.18)))
      .add(vec3(1.0, 0.96, 0.9).mul(core).mul(vFlash.mul(5.2).add(0.4))).toVar();
    const a = max(col.r, max(col.g, col.b));
    return vec4(col, a);
  })();
  return m;
}

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
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
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
    const sb = this.style.buoy;
    this._uniforms = uniformsAdapter({
      uRoleCol0: uniform(new THREE.Vector3(...sb.civil)),
      uRoleCol1: uniform(new THREE.Vector3(...sb.military)),
      uRoleCol2: uniform(new THREE.Vector3(...sb.queue)),
      uRhythm: uniform(new THREE.Vector4(sb.period, sb.flashes, sb.flash, 0)),
      uPxWorld: uniform(1),
      uSunDirW: uniform(new THREE.Vector3(0.4, 0.3, 0.87).normalize()),
      uSunVisS: uniform(1)
    });
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
        this.bodyMat = buildBodyMaterial(this._uniforms);
        this.lightMat = buildLightMaterial(this._uniforms);
        this.bodyMat.uniforms = this._uniforms;
        this.lightMat.uniforms = this._uniforms;
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
