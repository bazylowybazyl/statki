// src/3d/cargo/bay.tsl.js
//
// ŁADOWNIA 3D „à la Venator” (zadanie 26): WNĘTRZE (dno, ściany z żebrami, pas ostrzegawczy,
// oprawy lamp, znaki slotów, światła prowadzące) i WROTA (skrzydła jako bryły: wierzch
// z wycinka sprite'a kadłuba — zamknięta ładownia wygląda jak sam sprite; boki ze stali, na
// krawędzi przy szczelinie pas ostrzegawczy; szczelina świeci bursztynem przy ostrzeżeniu).
// Kadłub ma w otworze dziurę (materiał kadłuba — w demie dema/ladownia-webgpu/kadlub.js,
// w grze skóra na belkach), wnętrze stoi pod nią.
//
// UKŁAD: grupa ładowni = dziecko grupy statku w środku ładowni (a = x, b = y statku 3D);
// wnętrze w z ∈ [−głębokość, 0], skrzydła nad / pod z = 0 (cargoBayDoorPose z cargoBays.js).
// Graf materiału RAZ na moduł (wnętrze i skrzydła), obiekty dostają klony z własnym
// `material.uniforms` (wartości per obiekt: onObjectUpdate; sprite: teksturaObiektu) — jeden
// program na wszystkie ładownie. Światło: cargoLight.tsl.js (rekord ładowni z tablicy).
import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If, abs, attribute, clamp, float, floor, fract, fwidth, int, length, max, min, mix, normalize, positionGeometry,
  positionLocal, select, sign, sin, smoothstep, step, uniform, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { cargoBayDoorPose, cargoShipToWorld, cargoBayWorldYaw } from '../../data/cargoBays.js';
import { teksturaObiektu, teksturaZastepcza } from '../tsl/teksturaObiektu.js';
import {
  CARGO_LIGHT, CargoBayTable, bayAmbientOcclusion, bayFillLight, bayLampLevel, bayLampLight, bayRecord,
  bayRimVisibility, cargoHash, cargoShade, cargoSurfaceCap, dirToLocal, smoothDown
} from './cargoLight.tsl.js';

export const LEAF_RENDER_ORDER = 11;

const perObject = (key, type, init) =>
  uniform(init, type).onObjectUpdate(({ material }) => material.uniforms?.[key]?.value ?? init);

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

/** Wnętrze: dno + cztery ściany (normalne do środka), układ ładowni. */
export function buildBayInteriorGeometry(geo) {
  const A = geo.halfA;
  const B = geo.halfB;
  const D = geo.depth;
  const pos = [];
  const nrm = [];
  const idx = [];
  const quad = (a, b, c, d, n) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) { pos.push(v[0], v[1], v[2]); nrm.push(n[0], n[1], n[2]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad([-A, -B, -D], [A, -B, -D], [A, B, -D], [-A, B, -D], [0, 0, 1]);
  quad([-A, B, -D], [A, B, -D], [A, B, 0], [-A, B, 0], [0, -1, 0]);
  quad([A, -B, -D], [-A, -B, -D], [-A, -B, 0], [A, -B, 0], [0, 1, 0]);
  quad([A, B, -D], [A, -B, -D], [A, -B, 0], [A, B, 0], [-1, 0, 0]);
  quad([-A, -B, -D], [-A, B, -D], [-A, B, 0], [-A, -B, 0], [1, 0, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}

/** Skrzydło: pudło jednostkowe x, y ∈ [−½, ½], z ∈ [0, 1]; aFace: 0 wierzch, 1 spód, 2 bok +y, 3 bok −y, 4 czoła. */
export function buildLeafGeometry() {
  const pos = [];
  const nrm = [];
  const face = [];
  const idx = [];
  const quad = (a, b, c, d, n, f) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) { pos.push(v[0], v[1], v[2]); nrm.push(n[0], n[1], n[2]); face.push(f); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const h = 0.5;
  quad([-h, -h, 1], [h, -h, 1], [h, h, 1], [-h, h, 1], [0, 0, 1], 0);
  quad([-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0], [0, 0, -1], 1);
  quad([h, h, 0], [-h, h, 0], [-h, h, 1], [h, h, 1], [0, 1, 0], 2);
  quad([-h, -h, 0], [h, -h, 0], [h, -h, 1], [-h, -h, 1], [0, -1, 0], 3);
  quad([h, -h, 0], [h, h, 0], [h, h, 1], [h, -h, 1], [1, 0, 0], 4);
  quad([-h, h, 0], [-h, -h, 0], [-h, -h, 1], [-h, h, 1], [-1, 0, 0], 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aFace', new THREE.BufferAttribute(new Float32Array(face), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Materiał wnętrza
// ---------------------------------------------------------------------------

const AMBER = vec3(0.86, 0.46, 0.05);
const HAZARD_Y = vec3(0.92, 0.62, 0.05);

function buildInteriorMaterial() {
  const m = new THREE.NodeMaterial();
  m.name = 'Cargo:wnetrze';
  m.lights = false;
  m.fog = false;
  m.side = THREE.DoubleSide;
  const uBay = perObject('uBayIndex', 'int', 0);
  const uGridA = perObject('uGridA', 'vec4', new THREE.Vector4(0, 0, 17, 9));
  const uGridB = perObject('uGridB', 'vec4', new THREE.Vector4(1, 1, 16, 8));
  const vN = varyingProperty('vec3', 'vBayN');
  m.positionNode = Fn(() => {
    vN.assign(attribute('normal', 'vec3'));
    return positionGeometry;
  })();
  m.fragmentNode = Fn(() => {
    const P = positionLocal.toVar();
    const N = normalize(vN).toVar();
    const rec = bayRecord(uBay);
    const hA = rec.r1.x;
    const hB = rec.r1.y;
    const D = rec.r1.z;
    const spacing = rec.r2.z;
    const pocket = rec.r3.y; // dół skrzydeł w kieszeni (0 = over)
    const lampZ = rec.r3.w;
    // Pochodne przed gałęziami.
    const fw = fwidth(P);
    const px = max(max(fw.x, fw.y), max(fw.z, 1e-4)).toVar();
    const grime = cargoHash(floor(P.xy.mul(0.35))).mul(0.5).add(cargoHash(floor(P.xy.mul(1.3).add(7.0))).mul(0.5)).toVar();
    const albedo = vec3(0.1, 0.108, 0.12).toVar();
    const emis = vec3(0.0).toVar();
    const specK = float(0.35).toVar();
    const ao = float(1.0).toVar();
    If(N.z.greaterThan(0.5), () => {
      // DNO: płyty 8 j. ze szwami, brud, znaki slotów modułów, światła prowadzące.
      const g = P.xy;
      const sd = min(abs(fract(g.x.div(8.0).add(0.5)).sub(0.5)), abs(fract(g.y.div(8.0).add(0.5)).sub(0.5))).mul(8.0);
      const seam = smoothDown(px.mul(1.2).add(0.07), 0.07, sd);
      albedo.assign(vec3(0.06, 0.064, 0.072).mul(grime.mul(0.3).add(0.82)).mul(float(1.0).sub(seam.mul(0.45))));
      const cols = uGridB.x;
      const rows = uGridB.y;
      const ci = clamp(floor(g.x.sub(uGridA.x).div(uGridA.z).add(0.5)), 0.0, max(cols.sub(1.0), 0.0));
      const cj = clamp(floor(g.y.sub(uGridA.y).div(uGridA.w).add(0.5)), 0.0, max(rows.sub(1.0), 0.0));
      const q = g.sub(vec2(uGridA.x.add(ci.mul(uGridA.z)), uGridA.y.add(cj.mul(uGridA.w))));
      const half = vec2(uGridB.z.mul(0.5).add(0.3), uGridB.w.mul(0.5).add(0.3));
      const e = abs(q).sub(half);
      const od = max(e.x, e.y);
      const line = smoothDown(px.add(0.13), 0.13, abs(od));
      const corner = step(half.x.mul(0.6), abs(q.x)).mul(step(half.y.mul(0.6), abs(q.y)));
      albedo.assign(mix(albedo, AMBER, line.mul(corner).mul(0.85)));
      // Oś ładowni: przerywana linia wzdłuż środka (między rzędami).
      const dash = step(0.5, fract(g.x.div(6.0)));
      albedo.assign(mix(albedo, AMBER.mul(0.7), smoothDown(px.add(0.1), 0.1, abs(g.y)).mul(dash).mul(0.6)));
      // Światła prowadzące przy długich ścianach (co 6 j.) — turkus, z falą lamp.
      const la = abs(fract(g.x.add(hA).div(6.0)).sub(0.5)).mul(6.0);
      const lb = abs(abs(g.y).sub(hB.sub(0.45)));
      const dl = length(vec2(la, lb));
      emis.addAssign(vec3(0.25, 0.85, 1.0).mul(smoothDown(0.26, 0.1, dl)).mul(rec.r2.y.mul(2.6)));
      const edge = min(hA.sub(abs(g.x)), hB.sub(abs(g.y)));
      ao.assign(mix(float(0.3), float(1.0), smoothstep(0.0, 5.0, edge)));
    }).Else(() => {
      // ŚCIANY: żebra co 5 j., podłużnice, pas ostrzegawczy pod krawędzią, oprawy lamp.
      const longWall = abs(N.y).greaterThan(0.5);
      const s = select(longWall, P.x, P.y);
      const rf = abs(fract(s.div(5.0).add(0.5)).sub(0.5)).mul(5.0);
      const rib = smoothDown(0.55, 0.2, rf);
      albedo.assign(vec3(0.085, 0.09, 0.1).mul(grime.mul(0.25).add(0.85)).mul(rib.mul(0.45).add(0.75)));
      specK.assign(rib.mul(0.6).add(0.3));
      const hz = P.z.add(D);
      const str = abs(fract(hz.div(D.div(3.0)).add(0.5)).sub(0.5)).mul(D.div(3.0));
      albedo.mulAssign(float(1.0).sub(smoothDown(0.35, 0.1, str).mul(0.35)));
      // Szczelina skrzydeł (kieszeń) i pas ostrzegawczy tuż pod nią / pod krawędzią.
      const slotBot = select(pocket.greaterThan(0.5).and(longWall), pocket.add(0.3).negate(), float(0.0));
      const inSlot = step(slotBot, P.z).mul(select(pocket.greaterThan(0.5).and(longWall), float(1.0), float(0.0)));
      const bandTop = min(slotBot, float(-0.12));
      const inBand = step(bandTop.sub(0.85), P.z).mul(step(P.z, bandTop));
      const stripe = step(0.5, fract(s.add(P.z).div(1.6)));
      albedo.assign(mix(albedo, mix(HAZARD_Y, vec3(0.02), stripe), inBand));
      albedo.assign(mix(albedo, vec3(0.012), inSlot));
      // Oprawy lamp (długie ściany): prostokąt 3,2 × 0,8 j. przy każdej lampie.
      const kf = clamp(floor(P.x.add(hA).div(spacing)), 0.0, max(rec.r1.w.sub(1.0), 0.0));
      const ca = hA.negate().add(kf.add(0.5).mul(spacing));
      const inLamp = step(abs(P.x.sub(ca)), 1.6).mul(step(abs(P.z.sub(lampZ)), 0.4)).mul(select(longWall, float(1.0), float(0.0)));
      const level = bayLampLevel(rec, kf);
      albedo.assign(mix(albedo, vec3(0.3), inLamp));
      emis.addAssign(CARGO_LIGHT.lampColor.mul(level.mul(3.2).mul(inLamp)));
      ao.assign(mix(float(0.5), float(1.0), smoothstep(0.0, 2.8, hz)));
    });
    // Światło w układzie ładowni.
    const Ll = dirToLocal(rec, CARGO_LIGHT.sunDir);
    const Sl = dirToLocal(rec, CARGO_LIGHT.shadowDir);
    const vis = bayRimVisibility(P, Sl, hA, rec.r2.x);
    const occl = bayAmbientOcclusion(rec, P).mul(ao);
    const lamp = bayLampLight(rec, P, N).add(bayFillLight(rec, P, N)).mul(ao);
    const col = cargoShade(albedo, N, Ll, vis, occl, lamp, specK, float(28.0));
    return vec4(cargoSurfaceCap(col).add(emis), 1.0);
  })();
  return m;
}

// ---------------------------------------------------------------------------
// Materiał skrzydeł wrót
// ---------------------------------------------------------------------------

const SPRITE_PLACEHOLDER = teksturaZastepcza(0, 0, 0, 0, THREE.SRGBColorSpace);

function buildLeafMaterial() {
  const m = new THREE.NodeMaterial();
  m.name = 'Cargo:wrota';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.blending = THREE.NoBlending;
  m.depthWrite = true;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  const uBay = perObject('uBayIndex', 'int', 0);
  const uUV = perObject('uLeafUV', 'vec4', new THREE.Vector4(0, 0, 1, 1));
  const uDims = perObject('uLeafDims', 'vec4', new THREE.Vector4(10, 5, 1, 0));
  const uInfo = perObject('uLeafInfo', 'vec4', new THREE.Vector4(1, 1, 0, 0));
  const vN = varyingProperty('vec3', 'vLfN');
  const vU = varyingProperty('vec3', 'vLfU');
  const vFace = varyingProperty('float', 'vLfFace');
  m.positionNode = Fn(() => {
    vN.assign(attribute('normal', 'vec3'));
    vU.assign(positionGeometry);
    vFace.assign(attribute('aFace', 'float'));
    return positionGeometry;
  })();
  m.fragmentNode = Fn(() => {
    const u = vU.toVar();
    const t = u.xy.add(0.5);
    const suv = mix(uUV.xy, uUV.zw, t).toVar();
    // Próbka sprite'a w jednolitym przepływie (pochodne), wybór po ścianie niżej.
    const spr = teksturaObiektu('uSprite', SPRITE_PLACEHOLDER, suv).toVar();
    const face = int(vFace.add(0.5)).toVar();
    const rec = bayRecord(uBay);
    const side = uInfo.x;
    const innermost = uInfo.y;
    const L = uDims.x;
    const W = uDims.y;
    const la = u.x.mul(L);
    const lb = u.y.mul(W);
    const albedo = vec3(0.07, 0.075, 0.085).toVar();
    const N = normalize(vN).toVar();
    const emis = vec3(0.0).toVar();
    const specK = float(0.5).toVar();
    // Odległość od krawędzi przy szczelinie (bok −y dla strony +, bok +y dla strony −).
    const dIn = select(side.greaterThan(0.0), u.y.add(0.5), float(0.5).sub(u.y)).mul(W).toVar();
    // Kieszeń: część skrzydła poza otworem jest już w kadłubie — bez rysunku (poza sylwetką
    // wąskiego kadłuba wystawałaby za sprite). uInfo.w = środek skrzydła w b ładowni (update).
    If(uInfo.z.greaterThan(0.5).and(abs(uInfo.w.add(lb)).greaterThan(rec.r1.y)), () => { Discard(); });
    If(face.equal(0), () => {
      // WIERZCH: sprite kadłuba z poduszkową normalną jak kadłub gry (ciągłość z otoczeniem)
      // i fazą krawędzi (normalna pochyla się na zewnątrz — strona ku słońcu łapie światło,
      // przeciwna ciemnieje: skrzydło czyta się jako płyta, nie naklejka).
      albedo.assign(spr.rgb);
      const p = suv.mul(2.0).sub(1.0);
      const ex = float(0.5).sub(abs(u.x)).mul(L);
      const ey = float(0.5).sub(abs(u.y)).mul(W);
      const bev = float(0.9);
      const tilt = vec3(smoothDown(bev, 0.0, ex).mul(sign(u.x)), smoothDown(bev, 0.0, ey).mul(sign(u.y)), 0.0);
      N.assign(normalize(vec3(p.x.mul(0.45), p.y.mul(0.45), 1.0).add(tilt.mul(1.3))));
      specK.assign(1.0);
      const dEdge = min(ex, ey);
      albedo.mulAssign(float(1.0).sub(smoothDown(0.75, 0.15, dEdge).mul(0.5)));
      // Pas ostrzegawczy przy szczelinie — pojawia się, gdy skrzydła się rozchodzą
      // (zamknięte wrota wyglądają jak sam sprite).
      const openF = clamp(rec.r2.x.div(max(rec.r1.y, 1.0)), 0.0, 1.0);
      const band = smoothDown(1.3, 1.05, dIn).mul(smoothstep(0.0, 0.12, openF));
      const stripe = step(0.5, fract(la.add(lb).div(1.6)));
      albedo.assign(mix(albedo, mix(HAZARD_Y, vec3(0.02), stripe), band));
      // Szczelina świeci bursztynem przy ostrzeżeniu (tylko skrzydła przy osi), gaśnie, gdy
      // skrzydła się rozejdą (światło „przecieka” przez szparę zamkniętych wrót).
      const pulse = sin(CARGO_LIGHT.time.mul(7.5)).mul(0.35).add(0.65);
      const shut = float(1.0).sub(smoothstep(0.0, 0.05, openF));
      emis.addAssign(vec3(1.0, 0.5, 0.1).mul(rec.r3.x.mul(pulse).mul(innermost).mul(shut).mul(smoothDown(0.7, 0.0, dIn)).mul(2.2)));
    }).ElseIf(face.equal(1), () => {
      albedo.assign(vec3(0.03));
    }).Else(() => {
      // BOKI: stal; bok przy szczelinie w pasy ostrzegawcze.
      const inner = select(side.greaterThan(0.0), face.equal(3), face.equal(2));
      const stripe = step(0.5, fract(la.add(u.z.mul(uDims.z)).div(1.4)));
      albedo.assign(vec3(0.09, 0.095, 0.105).mul(float(0.85).add(cargoHash(floor(vec2(la, lb).mul(0.5))).mul(0.3))));
      albedo.assign(select(inner, mix(HAZARD_Y, vec3(0.02), stripe), albedo));
      specK.assign(0.8);
    });
    // Światło w układzie ładowni (skrzydło nad / pod poszyciem: bez cienia otworu).
    const Ll = dirToLocal(rec, CARGO_LIGHT.sunDir);
    const col = cargoShade(albedo, N, Ll, float(1.0), float(1.0), vec3(0.0), specK, float(32.0));
    // Na „odrzucaniu” przezroczystych pikseli sprite'a (poza sylwetką) — ciemna stal.
    const outc = select(face.equal(0).and(spr.a.lessThan(0.5)), vec3(0.02), cargoSurfaceCap(col)).add(emis);
    return vec4(outc, 1.0);
  })();
  return m;
}

let _interiorTemplate = null;
let _leafTemplate = null;
let _leafGeometry = null;
export function cargoInteriorTemplate() { return _interiorTemplate || (_interiorTemplate = buildInteriorMaterial()); }
export function cargoLeafTemplate() { return _leafTemplate || (_leafTemplate = buildLeafMaterial()); }
function leafGeometry() { return _leafGeometry || (_leafGeometry = buildLeafGeometry()); }

// ---------------------------------------------------------------------------
// Ładownia: wnętrze + skrzydła, przebieg wrót, rekord w tablicy świateł
// ---------------------------------------------------------------------------

/**
 * Ładownia na statku. shipGroup — grupa statku 3D (pozycja (x, −y) gry, obrót −kąt),
 * geo — cargoBayGeometry, spriteTex — tekstura kadłuba (wierzch skrzydeł), spriteSize —
 * { w, h } płótna w j. (uv skrzydeł), tableIndex — rekord w CargoBayTable.
 */
export class CargoBayRig {
  constructor({ shipGroup, geo, spriteTex, spriteSize, tableIndex, seed = 0 }) {
    this.geo = geo;
    this.tableIndex = tableIndex;
    this.seed = seed;
    this.group = new THREE.Group();
    this.group.position.set(geo.cx, geo.cy, 0);
    this.group.name = `Cargo:ladownia:${geo.hull.label}:${geo.id}`;
    shipGroup.add(this.group);
    // Wnętrze.
    const im = cargoInteriorTemplate().clone();
    im.uniforms = {
      uBayIndex: { value: tableIndex },
      uGridA: { value: new THREE.Vector4(geo.a0, geo.b0, geo.pitchA, geo.pitchB) },
      uGridB: { value: new THREE.Vector4(geo.cols, geo.rows, geo.module.L, geo.module.W) }
    };
    this.interior = new THREE.Mesh(buildBayInteriorGeometry(geo), im);
    this.interior.name = 'Cargo:wnetrze';
    this.group.add(this.interior);
    // Skrzydła.
    this.leaves = [];
    const W = spriteSize.w;
    const H = spriteSize.h;
    for (const L of geo.leaves) {
      const lm = cargoLeafTemplate().clone();
      const x0 = geo.cx + L.a0;
      const x1 = geo.cx + L.a1;
      const y0 = geo.cy + Math.min(L.b0, L.b1);
      const y1 = geo.cy + Math.max(L.b0, L.b1);
      lm.uniforms = {
        uBayIndex: { value: tableIndex },
        uSprite: { value: spriteTex },
        uLeafUV: { value: new THREE.Vector4(x0 / W + 0.5, y0 / H + 0.5, x1 / W + 0.5, y1 / H + 0.5) },
        uLeafDims: { value: new THREE.Vector4(L.a1 - L.a0, Math.abs(L.b1 - L.b0), geo.leafT, 0) },
        uLeafInfo: { value: new THREE.Vector4(L.side, L.index === 0 ? 1 : 0, geo.door === 'pocket' ? 1 : 0, 0) }
      };
      const mesh = new THREE.Mesh(leafGeometry(), lm);
      mesh.name = 'Cargo:skrzydlo';
      mesh.renderOrder = LEAF_RENDER_ORDER;
      mesh.frustumCulled = false;
      mesh.scale.set(L.a1 - L.a0, Math.abs(L.b1 - L.b0), geo.leafT);
      this.group.add(mesh);
      this.leaves.push({ def: L, mesh, bc: (L.b0 + L.b1) / 2 });
    }
    this.pose = cargoBayDoorPose(geo, 0);
    this.world = { x: 0, y: 0, yaw: 0 };
  }

  /**
   * Stan wrót dla postępu p [s] i poza GRY statku { x, y, angle }; wpisuje rekord do tablicy
   * świateł. Zwraca pozę wrót (cargoBayDoorPose).
   */
  update(progress, shipPose) {
    const geo = this.geo;
    const pose = cargoBayDoorPose(geo, progress, this.pose);
    const w = cargoShipToWorld(shipPose, geo.cx, geo.cy, this.world);
    w.yaw = cargoBayWorldYaw(shipPose);
    CargoBayTable.set(this.tableIndex, geo, w.x, w.y, w.yaw, pose, this.seed);
    for (let k = 0; k < this.leaves.length; k++) {
      const lf = this.leaves[k];
      const q = pose.leaves[k];
      lf.mesh.position.set(q.da, lf.bc + q.db, q.z0);
      lf.mesh.material.uniforms.uLeafInfo.value.w = lf.bc + q.db;
      // Skrzydło „pocket” schowane całe pod poszyciem — bez rysunku.
      lf.mesh.visible = !(geo.door === 'pocket' && Math.abs(q.db) >= Math.abs(lf.def.b1 - lf.def.b0) + geo.halfB * 0 && pose.open >= 0.999);
    }
    return pose;
  }

  /** Środek skrzydła k w świecie (cienie na kadłubie) → out { x, y }. */
  leafWorld(k, shipPose, out) {
    const lf = this.leaves[k];
    const q = this.pose.leaves[k];
    return cargoShipToWorld(shipPose, this.geo.cx + q.da, this.geo.cy + lf.bc + q.db, out);
  }

  /** Narożniki otworu w świecie (koguty) → tablica 4 × { x, y }. */
  corners(shipPose, out = [{}, {}, {}, {}]) {
    const g = this.geo;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) cargoShipToWorld(shipPose, g.cx + c[i][0] * (g.halfA + 1.2), g.cy + c[i][1] * (g.halfB + 1.2), out[i]);
    return out;
  }

  dispose() {
    this.group.removeFromParent();
    this.interior.geometry.dispose();
    this.interior.material.dispose();
    for (const lf of this.leaves) lf.mesh.material.dispose();
  }
}
