// src/3d/cargo/containers.tsl.js
//
// KONTENERY 3D w TSL (zadanie 26) — port wyglądu kontenerów Z5 (src/3d/cargoContainers3D.js,
// GLSL poza grą — plik Z5 bez zmian): rodziny z src/data/cargoContainers.js (standard,
// zbiornik ISO, zsyp z usypanym ładunkiem, hazmat). Kontener to WIDOK liczby — moduł rysuje
// to, co podaje logika (ładownie: cargoBays.js, przeładunek: cargoBayOps.js).
//
// RYSOWANIE: jedna siatka instancji (Mesh + InstancedBufferGeometry — nie InstancedMesh:
// uuid w kluczu programu), sfazowany prostopadłościan Z5 bez dna, jeden przepleciony bufor
// instancji (limit 8 buforów wierzchołków). Kolory liczone raz na CPU (containerLook →
// liniowo), shader robi tylko wzór i światło. Kolejka przezroczysta z NoBlending i zapisem
// głębi (renderOrder 12): cienie na kadłubie (shadows.tsl.js, GREATER) rysują się PRZED
// kontenerami, więc kontener nie zaciemnia sam siebie (jak mostek i Z5).
//
// ŚWIATŁO: model kadłuba (cargoLight.tsl.js); kontener w ładowni (pole bay ≥ 0) dostaje
// cień krawędzi otworu, lampy i otoczenie wnętrza z tablicy ładowni.
//
// DANE INSTANCJI (20 × f32): pozycja podstawy (x, y, z) i kurs; L, W, H, ładownia;
// farba rgb + rodzina; akcent rgb + ziarno; rama rgb + materiał zsypu (+16 = hazmat).
import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If, abs, attribute, clamp, cos, dot, float, floor, fract, fwidth, int, length, max, min, mix, normalize,
  positionGeometry, select, sin, smoothstep, sqrt, step, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import {
  CONTAINER_FAMILY_CODE, HOPPER_MATERIAL, containerLook, cargoHash01
} from '../../data/cargoContainers.js';
import {
  CARGO_LIGHT, bayAmbientOcclusion, bayFillLight, bayLampLight, bayRecord, bayRimVisibility, bayToLocal, cargoHash,
  cargoShade, cargoSurfaceCap, dirToLocal, smoothDown
} from './cargoLight.tsl.js';

export const CONTAINER_FLOATS = 20;
export const CONTAINER_RENDER_ORDER = 12;

// ---------------------------------------------------------------------------
// Geometria (jak buildContainerGeometry w Z5): x, y ∈ [−½, ½], z ∈ [0, 1]; aBevel =
// przesunięcie wierzchołka o fazę (xy do środka, z w dół), fazę w j. liczy shader.
// ---------------------------------------------------------------------------

export function buildContainerGeometry() {
  const pos = [];
  const nrm = [];
  const bev = [];
  const idx = [];
  const quad = (a, b, c, d, n) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) {
      pos.push(v[0], v[1], v[2]);
      bev.push(v[3], v[4], v[5]);
      nrm.push(n[0], n[1], n[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const S = Math.SQRT1_2;
  const B = (x, y) => [x, y, 0, 0, 0, 0];
  const O = (x, y) => [x, y, 1, 0, 0, -1];
  const I = (x, y) => [x, y, 1, -Math.sign(x), -Math.sign(y), 0];
  const h = 0.5;
  quad(B(h, -h), B(h, h), O(h, h), O(h, -h), [1, 0, 0]);
  quad(B(-h, h), B(-h, -h), O(-h, -h), O(-h, h), [-1, 0, 0]);
  quad(B(h, h), B(-h, h), O(-h, h), O(h, h), [0, 1, 0]);
  quad(B(-h, -h), B(h, -h), O(h, -h), O(-h, -h), [0, -1, 0]);
  quad(O(h, -h), O(h, h), I(h, h), I(h, -h), [S, 0, S]);
  quad(O(-h, h), O(-h, -h), I(-h, -h), I(-h, h), [-S, 0, S]);
  quad(O(h, h), O(-h, h), I(-h, h), I(h, h), [0, S, S]);
  quad(O(-h, -h), O(h, -h), I(h, -h), I(-h, -h), [0, -S, S]);
  quad(I(-h, -h), I(h, -h), I(h, h), I(-h, h), [0, 0, 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aBevel', new THREE.BufferAttribute(new Float32Array(bev), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

// ---------------------------------------------------------------------------
// Wygląd na CPU: kolory liniowe z containerLook (cargoContainers.js), pamięć podręczna
// ---------------------------------------------------------------------------

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function hexToLinear(hex, out = [0, 0, 0]) {
  const raw = String(hex || '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) { out[0] = out[1] = out[2] = 1; return out; }
  for (let i = 0; i < 3; i++) out[i] = srgbToLinear(parseInt(raw.slice(i * 2, i * 2 + 2), 16) / 255);
  return out;
}

const _looks = new Map();
/**
 * Wygląd kontenera (surowiec, ziarno kursu, numer) → Float32Array(13): farba rgb, rodzina,
 * akcent rgb, ziarno, rama rgb, materiał (+16 hazmat) — tak jak w buforze instancji.
 */
export function containerLookLinear(resourceId, seed, unit) {
  const key = `${resourceId}|${seed | 0}|${unit | 0}`;
  let v = _looks.get(key);
  if (v) return v;
  const L = containerLook(resourceId, seed, unit, {});
  v = new Float32Array(12);
  const t = [0, 0, 0];
  hexToLinear(L.paint, t); v[0] = t[0]; v[1] = t[1]; v[2] = t[2]; v[3] = CONTAINER_FAMILY_CODE[L.family] ?? 0;
  hexToLinear(L.accent, t); v[4] = t[0]; v[5] = t[1]; v[6] = t[2]; v[7] = cargoHash01(seed, unit, 5);
  hexToLinear(L.frame, t); v[8] = t[0]; v[9] = t[1]; v[10] = t[2]; v[11] = (L.material ?? HOPPER_MATERIAL.ORE) + (L.hazmat ? 16 : 0);
  if (_looks.size > 4096) _looks.clear();
  _looks.set(key, v);
  return v;
}

// ---------------------------------------------------------------------------
// Szum (wartości) — jak cgNoise Z5
// ---------------------------------------------------------------------------

function vnoise(p) {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(vec2(3.0).sub(f.mul(2.0)));
  const a = cargoHash(i);
  const b = cargoHash(i.add(vec2(1.0, 0.0)));
  const c = cargoHash(i.add(vec2(0.0, 1.0)));
  const d = cargoHash(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ---------------------------------------------------------------------------
// Materiał
// ---------------------------------------------------------------------------

/**
 * Materiał kontenerów. source (opcjonalnie) — poza z zewnątrz zamiast atrybutów iPos / iSize:
 * { name, pose: () => { pos: vec4 (podstawa x, y, z, kurs), size: vec4 (L, W, H, ładownia), visible: float } }
 * — np. kontenery roju z bufora symulacji GPU (src/3d/swarm/swarmUnits.tsl.js). Wzór i światło bez zmian.
 */
export function buildCargoContainerMaterial(source = null) {
  return buildMaterial(source);
}

function buildMaterial(source = null) {
  const m = new THREE.NodeMaterial();
  m.name = source?.name || 'Cargo:kontenery';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.blending = THREE.NoBlending;
  m.depthWrite = true;
  m.depthTest = true;
  m.side = THREE.FrontSide;

  const vLocal = varyingProperty('vec3', 'vCgLocal');
  const vN = varyingProperty('vec3', 'vCgN');
  const vW = varyingProperty('vec3', 'vCgW');
  const vSize = varyingProperty('vec4', 'vCgSize');
  const vPaint = varyingProperty('vec4', 'vCgPaint');
  const vAccent = varyingProperty('vec4', 'vCgAccent');
  const vFrame = varyingProperty('vec4', 'vCgFrame');
  const vRot = varyingProperty('vec2', 'vCgRot');

  m.positionNode = Fn(() => {
    const ext = source ? source.pose() : null;
    const iPos = ext ? ext.pos : attribute('iPos', 'vec4');
    const iSize = ext ? ext.size : attribute('iSize', 'vec4');
    const bev = min(min(iSize.x, iSize.y).mul(0.07), iSize.z.mul(0.3));
    const lp = positionGeometry.mul(iSize.xyz).add(attribute('aBevel', 'vec3').mul(bev)).toVar();
    const c = cos(iPos.w);
    const s = sin(iPos.w);
    const wp = vec3(iPos.x.add(lp.x.mul(c)).sub(lp.y.mul(s)), iPos.y.add(lp.x.mul(s)).add(lp.y.mul(c)), iPos.z.add(lp.z)).toVar();
    // Niewidoczny (źródło zewnętrzne): trójkąty zwinięte w punkt.
    if (ext && ext.visible) wp.assign(select(ext.visible.greaterThan(0.5), wp, iPos.xyz));
    vLocal.assign(lp);
    vN.assign(attribute('normal', 'vec3'));
    vW.assign(wp);
    vSize.assign(iSize);
    vPaint.assign(attribute('iPaint', 'vec4'));
    vAccent.assign(attribute('iAccent', 'vec4'));
    vFrame.assign(attribute('iFrame', 'vec4'));
    vRot.assign(vec2(c, s));
    return wp;
  })();

  m.fragmentNode = Fn(() => {
    const N = normalize(vN).toVar();
    const size = vSize.xy;
    const hs = size.mul(0.5).toVar();
    const cc = vLocal.xy.toVar();
    const fam = vPaint.w;
    const seed = vAccent.w;
    const matCode = vFrame.w;
    const hazmat = matCode.greaterThan(15.5);
    const mat = select(hazmat, matCode.sub(16.0), matCode).toVar();
    const paint = vPaint.rgb;
    const accent = vAccent.rgb;
    const frame = vFrame.rgb;
    // Pochodne przed gałęziami (WGSL: pochodna w rozbieżnej gałęzi jest nieokreślona).
    const fw = fwidth(vLocal.xy);
    const px = max(max(fw.x, fw.y), 1e-4).toVar();
    const top = N.z.greaterThan(0.9);
    const chamfer = N.z.greaterThan(0.3).and(N.z.lessThan(0.9));
    const albedo = vec3(paint).toVar();
    const Nb = vec3(N).toVar();
    const specK = float(0.6).toVar();
    const specPow = float(24.0).toVar();
    const grimeN = vnoise(vLocal.xy.mul(float(0.9).div(max(size.y, 0.5))).add(seed.mul(3.0))).toVar();

    If(fam.greaterThan(1.5), () => {
      // ZSYP: burty i otwarty wierzch z usypanym ładunkiem.
      albedo.assign(paint.mul(vnoise(vLocal.xy.mul(0.35).add(seed)).mul(0.25).add(0.85)));
      If(top, () => {
        const rim = min(size.x, size.y).mul(0.09).add(0.25);
        const dd = hs.sub(abs(cc));
        const inner = min(dd.x, dd.y).sub(rim).toVar();
        If(inner.greaterThan(0.0), () => {
          const hn = cc.div(max(hs.sub(rim), vec2(0.2))).toVar();
          const lump = float(3.0).div(max(min(size.x, size.y), 1.0));
          const np = cc.mul(lump.mul(4.0)).add(seed.mul(17.0)).toVar();
          const n1 = vnoise(np).toVar();
          const n2 = vnoise(np.mul(2.3).add(5.1)).toVar();
          const g = hn.mul(-2.0).mul(vec2(float(1.0).sub(hn.y.mul(hn.y)), float(1.0).sub(hn.x.mul(hn.x)))).mul(0.6).toVar();
          g.addAssign(vec2(vnoise(np.add(vec2(0.4, 0.0))), vnoise(np.add(vec2(0.0, 0.4)))).sub(n1).mul(2.2));
          const col = vec3(accent).toVar();
          If(mat.lessThan(0.5), () => {
            col.assign(accent.mul(mix(float(0.55), float(1.15), n1.mul(0.7).add(n2.mul(0.3)))));
          }).ElseIf(mat.lessThan(1.5), () => {
            col.assign(mix(accent, vec3(0.92, 0.97, 1.0), n2.mul(0.35).add(0.45)).mul(n1.mul(0.3).add(0.85)));
            specK.assign(1.6); specPow.assign(60.0);
          }).ElseIf(mat.lessThan(2.5), () => {
            const pick = cargoHash(floor(np.mul(1.6)));
            col.assign(select(pick.lessThan(0.35), vec3(0.22, 0.12, 0.06), select(pick.lessThan(0.7), accent, vec3(0.12, 0.14, 0.17))).mul(n2.mul(0.6).add(0.7)));
            g.mulAssign(1.8);
            specK.assign(1.0);
          }).ElseIf(mat.lessThan(3.5), () => {
            const bw = max(size.y.div(9.0), 0.3);
            const fb = fract(cc.y.div(bw));
            g.assign(vec2(0.0, fb.sub(0.5).mul(3.0)));
            col.assign(accent.mul(sin(fb.mul(3.1416)).mul(0.4).add(0.75)).mul(cargoHash(vec2(floor(cc.y.div(bw)), seed.mul(9.0))).mul(0.2).add(0.9)));
            specK.assign(1.2); specPow.assign(40.0);
          }).ElseIf(mat.lessThan(4.5), () => {
            const cd = max(min(size.x, size.y).div(3.2), 0.4);
            const cq = fract(cc.div(cd)).sub(0.5);
            const rr = length(cq).mul(2.0);
            const ring = cos(rr.mul(18.0)).mul(0.5).add(0.5);
            col.assign(accent.mul(ring.mul(0.5).add(0.6)).mul(step(rr, 0.95)).add(vec3(0.02).mul(step(0.95, rr))));
            g.assign(cq.mul(1.5));
            specK.assign(1.3); specPow.assign(36.0);
          }).ElseIf(mat.lessThan(5.5), () => {
            col.assign(accent.mul(vnoise(np.mul(5.0)).mul(0.35).add(0.8)));
            g.mulAssign(0.4);
          }).Else(() => {
            const f = vnoise(np.mul(1.7));
            col.assign(mix(accent.mul(0.6), vec3(0.95, 0.9, 1.0), smoothstep(0.62, 0.8, f)));
            g.assign(vec2(cargoHash(floor(np.mul(1.7))), cargoHash(floor(np.mul(1.7)).add(3.3))).sub(0.5).mul(2.4));
            specK.assign(2.0); specPow.assign(80.0);
          });
          const ao = smoothstep(0.0, rim.mul(3.0).add(0.4), inner);
          albedo.assign(col.mul(ao.mul(0.55).add(0.45)));
          Nb.assign(normalize(vec3(g, 1.0)));
        }).Else(() => {
          albedo.mulAssign(1.12);
        });
      }).Else(() => {
        const rib = cos(dot(vLocal.xy, vec2(1.0)).div(max(min(size.x, size.y).mul(0.18), 0.2)).mul(3.1416)).mul(0.5).add(0.5);
        albedo.mulAssign(rib.mul(0.12).add(0.88));
      });
    }).ElseIf(fam.greaterThan(0.5), () => {
      // ZBIORNIK ISO: rama na końcach, walec wzdłuż, pas barwy ładunku, pomost.
      albedo.assign(frame);
      If(top, () => {
        const endW = size.x.mul(0.09);
        const r = hs.y.mul(0.97);
        const yy = cc.y.div(r);
        const ax = abs(cc.x);
        If(ax.greaterThan(hs.x.sub(endW)), () => {
          const dd = hs.sub(abs(cc));
          const cst = hs.y.mul(0.16);
          albedo.assign(frame.mul(select(min(dd.x, dd.y).lessThan(cst), float(0.45), float(1.0))));
        }).ElseIf(abs(yy).lessThan(1.0), () => {
          const zz = sqrt(max(float(1.0).sub(yy.mul(yy)), 0.0));
          const headZone = size.x.mul(0.12);
          const hd = smoothstep(hs.x.sub(endW).sub(headZone), hs.x.sub(endW), ax);
          Nb.assign(normalize(vec3(select(cc.x.greaterThan(0.0), float(1.0), float(-1.0)).mul(hd).mul(1.4), yy.mul(1.15), zz)));
          const shell = mix(vec3(0.78, 0.8, 0.82), paint, 0.85);
          const base = shell.mul(vnoise(cc.mul(0.6).add(seed.mul(11.0))).mul(0.1).add(0.9)).mul(float(1.0).sub(hd.mul(0.35))).toVar();
          const bandW = size.x.mul(0.045);
          const band = smoothDown(bandW.add(px), bandW, abs(ax.sub(hs.x.mul(0.42))));
          base.assign(mix(base, accent, band.mul(float(1.0).sub(hd))));
          const walk = smoothDown(hs.y.mul(0.05).add(px), hs.y.mul(0.05), abs(cc.y));
          base.assign(mix(base, base.mul(0.55), walk.mul(float(1.0).sub(hd))));
          albedo.assign(base);
          specK.assign(1.5); specPow.assign(40.0);
        }).Else(() => {
          albedo.assign(frame.mul(0.3));
        });
      }).Else(() => {
        const post = smoothstep(hs.x.sub(size.x.mul(0.13)), hs.x.sub(size.x.mul(0.1)), abs(cc.x));
        albedo.assign(mix(paint.mul(0.55), frame, post));
      });
    }).Else(() => {
      // STANDARD: dach z przetłoczeniami w poprzek, pas drzwi, narożniki, farba z palety.
      If(top, () => {
        const period = max(size.x.div(10.0), 0.2);
        const ribAA = float(1.0).sub(smoothstep(0.25, 0.6, px.div(period)));
        const ph = cc.x.div(period).mul(6.2832);
        const rib = cos(ph).mul(0.5).add(0.5);
        albedo.mulAssign(float(1.0).sub(rib.mul(0.16).mul(ribAA)));
        Nb.assign(normalize(vec3(sin(ph).negate().mul(0.22).mul(ribAA), 0.0, 1.0)));
        const dir = select(cargoHash(vec2(seed.mul(71.0), 3.0)).greaterThan(0.5), float(1.0), float(-1.0));
        const door = smoothstep(hs.x.mul(0.9), hs.x.mul(0.92), cc.x.mul(dir));
        albedo.mulAssign(float(1.0).sub(door.mul(0.22)));
        const cst = min(size.x, size.y).mul(0.075).add(0.12);
        const dd = hs.sub(abs(cc));
        albedo.assign(mix(albedo, vec3(0.06), step(dd.x, cst).mul(step(dd.y, cst))));
        If(hazmat, () => {
          // Pas ostrzegawczy i romb nalepki.
          const band = smoothstep(hs.x.mul(0.62), hs.x.mul(0.66), abs(cc.x));
          const stripe = step(0.5, fract(cc.x.add(cc.y).div(max(hs.y.mul(0.55), 0.2))));
          albedo.assign(mix(albedo, mix(paint, vec3(0.018), stripe), band));
          const rr = min(hs.x, hs.y).mul(0.46);
          const dm = abs(cc.x).add(abs(cc.y));
          albedo.assign(mix(albedo, vec3(0.8), smoothDown(rr.mul(1.04), rr.mul(0.98), dm)));
          albedo.assign(mix(albedo, accent, smoothDown(rr.mul(0.84), rr.mul(0.78), dm)));
        });
        albedo.mulAssign(float(1.0).sub(smoothstep(0.55, 0.95, grimeN).mul(0.18)));
      }).ElseIf(chamfer.not(), () => {
        const period = max(size.x.div(18.0), 0.18);
        const rib = cos(vLocal.x.add(vLocal.y).div(period).mul(6.2832)).mul(0.5).add(0.5);
        albedo.mulAssign(rib.mul(0.1).add(0.9));
        If(hazmat, () => {
          albedo.assign(mix(albedo, vec3(0.018), step(0.5, fract(vLocal.x.add(vLocal.z).div(max(size.y.mul(0.3), 0.2)))).mul(0.8)));
        });
      });
    });
    If(chamfer, () => { albedo.mulAssign(1.08); });

    // Światło: normalna obiektu → świat (kurs instancji).
    const c = vRot.x;
    const s = vRot.y;
    const Nw = normalize(vec3(Nb.x.mul(c).sub(Nb.y.mul(s)), Nb.x.mul(s).add(Nb.y.mul(c)), Nb.z)).toVar();
    const col = vec3(0.0).toVar();
    const bay = vSize.w;
    If(bay.greaterThan(-0.5), () => {
      const rec = bayRecord(int(bay.add(0.5)));
      const P = bayToLocal(rec, vW).toVar();
      const Nl = dirToLocal(rec, Nw).toVar();
      const Ll = dirToLocal(rec, CARGO_LIGHT.sunDir);
      const Sl = dirToLocal(rec, CARGO_LIGHT.shadowDir);
      const vis = bayRimVisibility(P, Sl, rec.r1.x, rec.r2.x);
      const occl = bayAmbientOcclusion(rec, P);
      const lamp = bayLampLight(rec, P, Nl).add(bayFillLight(rec, P, Nl));
      col.assign(cargoShade(albedo, Nl, Ll, vis, occl, lamp, specK, specPow));
    }).Else(() => {
      col.assign(cargoShade(albedo, Nw, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), specK, specPow));
    });
    return vec4(cargoSurfaceCap(col), 1.0);
  })();
  return m;
}

// ---------------------------------------------------------------------------
// Pula
// ---------------------------------------------------------------------------

function keepRanges() {}

/**
 * Kontenery sceny: begin() → push…() → commit(). Współrzędne świata sceny (x, y = −y gry).
 */
export class CargoContainers {
  constructor(scene, capacity = 16384) {
    this.capacity = capacity;
    const base = buildContainerGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.setAttribute('aBevel', base.getAttribute('aBevel'));
    geo.setIndex(base.getIndex());
    this.data = new Float32Array(capacity * CONTAINER_FLOATS);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, CONTAINER_FLOATS, 1);
    this.range = { start: 0, count: this.data.length };
    this.buffer.updateRanges.length = 0;
    this.buffer.updateRanges.push(this.range);
    this.buffer.clearUpdateRanges = keepRanges;
    geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    geo.setAttribute('iSize', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    geo.setAttribute('iPaint', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    geo.setAttribute('iAccent', new THREE.InterleavedBufferAttribute(this.buffer, 4, 12));
    geo.setAttribute('iFrame', new THREE.InterleavedBufferAttribute(this.buffer, 4, 16));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geometry = geo;
    this.material = buildMaterial();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'Cargo:kontenery';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = CONTAINER_RENDER_ORDER;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.count = 0;
  }

  begin() { this.count = 0; }

  /**
   * Kontener: podstawa (x, y, z), kurs yaw, wymiary L × W × H, ładownia (−1 = poza),
   * look — containerLookLinear (Float32Array 12).
   */
  push(x, y, z, yaw, L, W, H, bay, look) {
    if (this.count >= this.capacity) return false;
    const o = this.count++ * CONTAINER_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw;
    d[o + 4] = L; d[o + 5] = W; d[o + 6] = H; d[o + 7] = bay;
    for (let i = 0; i < 12; i++) d[o + 8 + i] = look[i];
    return true;
  }

  commit() {
    const n = this.count;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.range.count = n * CONTAINER_FLOATS;
      this.buffer.needsUpdate = true;
    }
  }
}
