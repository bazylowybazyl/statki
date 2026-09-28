// src/3d/asteroids/miningView.js
//
// Obraz PLATFORMY WYDOBYWCZEJ gracza (zadanie 21b portu WebGPU): drony, wiązki (lasery,
// drut i szczelina piły, podgląd linii piły, wiązka ściągająca) i efekty zdarzeń wydobycia
// (wybuch ładunku, rozpad, zbiórka) — tylko obraz; stan liczy src/game/asteroidMiningRig.js
// (drony, piła, ładunki, zdarzenia w pierścieniu `fx`). Wzór: miningRig.js dema
// dema/asteroidy-webgpu (BeamLines, DroneMeshes, _blastFx, addLights, addGlows).
//
//   • DRONY: prosta bryła z kilku części (kadłub sześciokątny, płyta, żółty pas, trzy
//     ramiona z gondolami silników, światła pozycyjne, kopuła czujnika) — jedna scalona
//     geometria (atrybut części) w instancjach Mesh + InstancedBufferGeometry (jeden
//     przepleciony bufor instancji; nie InstancedMesh — uuid w kluczu programu). Światło
//     jak skały pasa: słońce pola × transmitancja, otoczenie, światła siatki gry (bez
//     własnych lamp dronów — właściciel DRONE_LIGHT_OWNER), pył ośrodka (`kolor · a + rgb`),
//     kolano bloomu pasa.
//   • WIĄZKI: paski od A do B (szerokość w świecie, w płaszczyźnie widoku z góry), rdzeń HDR
//     + poświata, addytywnie z testem głębi (skała zasłania wiązkę w otworze).
//   • EFEKTY: iskry i duszki pasa (asteroidBelt: sparks, glow), światło wybuchu w siatce
//     świateł gry (krzywa `dynamics.explode` dema: błysk + żar, rozpraszanie w pyle 1,0),
//     fala = sama refrakcja (Core3D.fxDistortion().shock) — bez nowych pul; losowość z
//     fxRandom (Math.random gry nietknięty).
//
// Pozycje LOKALNE względem początku pola (Core3D.fx.origin; grupa pola stoi na nim),
// bez alokacji na klatkę (bufory ze stałym zakresem wysyłki — tslCommon.js).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, vec3, vec4, uniform, uniformArray, attribute, varyingProperty, positionGeometry, normalGeometry,
  exp, max, min, normalize, cross, length, select, mix, clamp, dot, pow, sin, cos, fract
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Core3D } from '../core3d.js';
import { fxRandom } from '../fx/fxRandom.js';
import { hexToLinear } from './rockMaterial.js';
import { beltBloomKnee, permanentUpdateRange, markLiveRange } from './tslCommon.js';
import { GLOW_ROUND } from './glowSprites.js';
import { MINING_FX } from '../../game/asteroidMiningRig.js';

/** Właściciel świateł dronów w siatce — materiał dronów je pomija (bez samooświetlenia). */
export const DRONE_LIGHT_OWNER = 9217;
const DRONE_CAP = 8;
const DRONE_FLOATS = 8;   // iPos (x, y, z, kurs), iParam (słońce, laser, ciąg, faza)
const BEAM_CAP = 64;
const BEAM_FLOATS = 12;   // A (x, y, z, szerokość), B (x, y, z, —), C (r, g, b, siła)
const SHOCK_CAP = 8;
const FLASH_CAP = 16;
// Wybuchy ładunków: światło siatki i jądro żaru jak `dynamics.explode` dema (życie 1,9 s).
const BLAST_CAP = 8;
const BLAST_LIFE = 1.9;
// Kolejka przezroczystych passa gry (asteroidBelt.js): duszki 20, iskry 24; drony nieprzezroczyste.
const RENDER_ORDER = Object.freeze({ drones: 5, beams: 21 });

// Paleta części drona (liniowo): barwa, metaliczność, emisja (× parametr instancji).
const DRONE_PARTS = Object.freeze([
  { color: '#3a4148', metal: 0.55 },   // 0 kadłub
  { color: '#8a9098', metal: 0.35 },   // 1 płyta górna
  { color: '#d9a321', metal: 0.2 },    // 2 pas ostrzegawczy
  { color: '#2b3036', metal: 0.5 },    // 3 ramiona
  { color: '#4a5058', metal: 0.5 },    // 4 gondole silników
  { color: '#ff2a1a', metal: 0, emit: 3.2 },  // 5 światło pozycyjne czerwone
  { color: '#23ff55', metal: 0, emit: 3.2 },  // 6 zielone
  { color: '#ffffff', metal: 0, emit: 3.0 },  // 7 białe
  { color: '#1d2a36', metal: 0.1, emit: 0 }   // 8 kopuła czujnika (świeci przy laserze)
]);

// --------------------------------------------------------------------------------
// Geometria drona (układ drona: z w górę, przód = +x; ~90 j. średnicy)

function part(geo, id) {
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count;
  geo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
  return geo.index ? geo.toNonIndexed() : geo;
}

function buildDroneGeometry() {
  const parts = [];
  const hull = new THREE.CylinderGeometry(36, 40, 14, 6);
  hull.rotateX(Math.PI / 2);
  parts.push(part(hull, 0));
  const plate = new THREE.CylinderGeometry(22, 27, 6, 6);
  plate.rotateX(Math.PI / 2);
  plate.translate(0, 0, 9);
  parts.push(part(plate, 1));
  const stripe = new THREE.RingGeometry(28, 36.5, 6, 1);
  stripe.translate(0, 0, 7.2);
  parts.push(part(stripe, 2));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const arm = new THREE.BoxGeometry(46, 9, 5);
    arm.translate(52, 0, 2);
    arm.rotateZ(a);
    parts.push(part(arm, 3));
    const pod = new THREE.CylinderGeometry(11, 13, 16, 10);
    pod.rotateX(Math.PI / 2);
    pod.translate(76, 0, 1);
    pod.rotateZ(a);
    parts.push(part(pod, 4));
    const nav = new THREE.BoxGeometry(6, 6, 4);
    nav.translate(76, 0, 11);
    nav.rotateZ(a);
    parts.push(part(nav, 5 + k));
  }
  const dome = new THREE.SphereGeometry(11, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.rotateX(Math.PI / 2);
  dome.translate(0, 0, 12);
  parts.push(part(dome, 8));
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

// --------------------------------------------------------------------------------

class DroneMeshes {
  constructor({ parent, layer, shared, grid }) {
    const S = shared;
    const base = buildDroneGeometry();
    const data = new Float32Array(DRONE_CAP * DRONE_FLOATS);
    const buffer = new THREE.InstancedInterleavedBuffer(data, DRONE_FLOATS, 1);
    this.range = permanentUpdateRange(buffer);
    const ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute('position', base.getAttribute('position'));
    ig.setAttribute('normal', base.getAttribute('normal'));
    ig.setAttribute('aPart', base.getAttribute('aPart'));
    ig.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    ig.setAttribute('iParam', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    ig.instanceCount = 0;
    ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.data = data;
    this.buffer = buffer;
    this.geo = ig;
    this.count = 0;
    // Paleta: [barwa (liniowo), metal], [emisja, —].
    const rows = [];
    const lin = new THREE.Vector3();
    for (const p of DRONE_PARTS) {
      hexToLinear(p.color, lin);
      rows.push(new THREE.Vector4(lin.x, lin.y, lin.z, p.metal), new THREE.Vector4(p.emit || 0, 0, 0, 0));
    }
    const pal = uniformArray(rows, 'vec4').setName('miningDronePalette');
    this.time = uniform(0);
    const mat = new THREE.NodeMaterial();
    mat.name = 'AsteroidBelt:miningDrones';
    mat.lights = false;
    mat.fog = false;
    const vN = varyingProperty('vec3', 'vDroneN');
    const vP = varyingProperty('vec3', 'vDroneP');
    const vPart = varyingProperty('float', 'vDronePart');
    const vParam = varyingProperty('vec4', 'vDroneParam');
    mat.positionNode = Fn(() => {
      const iPos = attribute('iPos', 'vec4');
      const c = cos(iPos.w), s = sin(iPos.w);
      const p = positionGeometry;
      const n = normalGeometry;
      const local = vec3(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)), p.z);
      vN.assign(vec3(n.x.mul(c).sub(n.y.mul(s)), n.x.mul(s).add(n.y.mul(c)), n.z));
      const P = iPos.xyz.add(local).toVar();
      vP.assign(P);
      vPart.assign(attribute('aPart', 'float'));
      vParam.assign(attribute('iParam', 'vec4'));
      return P;
    })();
    mat.fragmentNode = Fn(() => {
      const pid = int(vPart.add(0.5)).toVar();
      const row = pal.element(pid.mul(2)).toVar();
      const emitRow = pal.element(pid.mul(2).add(1)).toVar();
      const N = normalize(vN).toVar();
      const P = vP;
      const albedo = row.rgb.toVar();
      const metal = row.w.toVar();
      const sunT = vParam.x;
      const Vw = vec3(0.0, 0.0, 1.0);
      const ndl = dot(N, S.sunDir).toVar();
      const fillK = mix(float(0.22), float(1.0), sunT).mul(float(1.0).sub(float(1.0).sub(sunT).mul(0.96)));
      const diff = S.sunColor.mul(sunT).mul(clamp(ndl.add(0.1).div(1.1), 0.0, 1.0)).toVar();
      const gloss = mix(float(24.0), float(70.0), metal);
      const spec = S.sunColor.mul(sunT).mul(pow(max(dot(N, normalize(S.sunDir.add(Vw))), 0.0), gloss)).mul(metal.mul(0.9).add(0.08)).toVar();
      const amb = S.ambientTop.mul(N.z.mul(0.3).add(0.7)).mul(fillK).toVar();
      grid.loop(P, ({ toL, att, col }) => {
        const c = col.mul(att).toVar();
        const nl = dot(N, toL);
        diff.addAssign(c.mul(clamp(nl.add(0.1).div(1.1), 0.0, 1.0)));
        spec.addAssign(c.mul(pow(max(dot(N, normalize(toL.add(Vw))), 0.0), gloss)).mul(metal.mul(1.1).add(0.08)));
      }, float(DRONE_LIGHT_OWNER));
      const col = albedo.mul(diff.add(amb)).mul(float(1.0).sub(metal.mul(0.6))).add(spec).toVar();
      // Światła pozycyjne migają (faza drona), kopuła świeci przy laserze.
      const blink = select(fract(this.time.mul(0.9).add(vParam.w)).lessThan(0.18), float(1.0), float(0.25));
      const navK = select(pid.equal(7), blink, float(1.0));
      col.addAssign(albedo.mul(emitRow.x).mul(navK));
      const lens = select(pid.equal(8), vParam.y, float(0.0));
      col.addAssign(vec3(0.12, 0.5, 0.75).mul(lens));
      const outc = beltBloomKnee(col.mul(S.exposure)).toVar();
      if (S.volume) {
        const v = S.volume.sample(P);
        outc.assign(outc.mul(v.a).add(v.rgb));
      }
      return vec4(max(outc, vec3(0.0)), 1.0);
    })();
    this.material = mat;
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = RENDER_ORDER.drones;
    mesh.name = 'AsteroidBelt:miningDrones';
    mesh.visible = false;
    mesh.layers.set(layer);
    parent.add(mesh);
    this.mesh = mesh;
  }

  begin() { this.count = 0; }

  add(x, y, z, yaw, sunT, laser, thrust, phase) {
    if (this.count >= DRONE_CAP) return;
    const o = this.count++ * DRONE_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw;
    d[o + 4] = sunT; d[o + 5] = laser; d[o + 6] = thrust; d[o + 7] = phase;
  }

  commit(time) {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    this.time.value = time;
    if (n) markLiveRange(this.buffer, this.range, n * DRONE_FLOATS);
  }
}

// --------------------------------------------------------------------------------
// Wiązki: pasek od A do B, szerokość w świecie, rdzeń HDR + poświata; addytywnie,
// z testem głębi (skała zasłania wiązkę).

class BeamLines {
  constructor({ parent, layer }) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(BEAM_CAP * BEAM_FLOATS);
    const buffer = new THREE.InstancedInterleavedBuffer(data, BEAM_FLOATS, 1);
    this.range = permanentUpdateRange(buffer);
    const ig = new THREE.InstancedBufferGeometry();
    ig.setIndex(plane.index);
    ig.setAttribute('position', plane.getAttribute('position'));
    ig.setAttribute('uv', plane.getAttribute('uv'));
    ig.setAttribute('bA', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    ig.setAttribute('bB', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    ig.setAttribute('bC', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    ig.instanceCount = 0;
    ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.data = data;
    this.buffer = buffer;
    this.geo = ig;
    const mat = new THREE.NodeMaterial();
    mat.name = 'AsteroidBelt:miningBeams';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.premultipliedAlpha = false;
    mat.forceSinglePass = true;
    mat.side = THREE.DoubleSide;
    const vAcross = varyingProperty('float', 'vBeamAcross');
    const vAlong = varyingProperty('float', 'vBeamAlong');
    const vCol = varyingProperty('vec4', 'vBeamCol');
    mat.positionNode = Fn(() => {
      const A = attribute('bA', 'vec4');
      const B = attribute('bB', 'vec4');
      const p = positionGeometry;
      const d = B.xyz.sub(A.xyz);
      const dxy = vec3(d.x, d.y, 0.0);
      const perp = select(length(dxy).greaterThan(1e-3), normalize(cross(dxy, vec3(0.0, 0.0, 1.0))), vec3(1.0, 0.0, 0.0));
      vAcross.assign(p.y.mul(2.0));
      vAlong.assign(p.x.add(0.5));
      vCol.assign(attribute('bC', 'vec4'));
      return mix(A.xyz, B.xyz, p.x.add(0.5)).add(perp.mul(p.y).mul(A.w));
    })();
    mat.fragmentNode = Fn(() => {
      const y = clamp(vAcross, -1.0, 1.0);
      const along = clamp(vAlong, 0.0, 1.0);
      const core = exp(y.mul(y).mul(-18.0));
      const halo = exp(y.mul(y).mul(-2.5)).mul(0.22);
      // Końce łagodnie (bez prostokątnych krawędzi).
      const ends = max(float(0.0), float(1.0).sub(max(float(0.0), along.sub(0.97).mul(33.0))));
      const col = vCol.rgb.mul(core.add(halo)).mul(vCol.w).mul(ends);
      return vec4(beltBloomKnee(col), 0.0);
    })();
    this.material = mat;
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = RENDER_ORDER.beams;
    mesh.name = 'AsteroidBelt:miningBeams';
    mesh.visible = false;
    mesh.layers.set(layer);
    parent.add(mesh);
    this.mesh = mesh;
    this.count = 0;
  }

  begin() { this.count = 0; }

  /** Wiązka (lokalnie): A → B, szerokość [j.], barwa HDR, siła. */
  add(ax, ay, az, bx, by, bz, width, r, g, b, k) {
    if (this.count >= BEAM_CAP || !(k > 0)) return;
    const o = this.count++ * BEAM_FLOATS;
    const d = this.data;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = az; d[o + 3] = width;
    d[o + 4] = bx; d[o + 5] = by; d[o + 6] = bz; d[o + 7] = 0;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = k;
  }

  commit() {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) markLiveRange(this.buffer, this.range, n * BEAM_FLOATS);
  }
}

// --------------------------------------------------------------------------------

export class MiningView {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.parent grupa pola (stoi na początku pola)
   * @param {number} [o.layer] warstwa passa gry (0)
   * @param {object} o.shared uniformy skał (słońce, otoczenie, volume, exposure)
   * @param {import('../fx/lightGrid.js').LightGrid} o.grid siatka świateł gry
   * @param {import('./sparks.js').Sparks} o.sparks iskry pasa
   */
  constructor({ parent, layer = 0, shared, grid, sparks }) {
    this.drones = new DroneMeshes({ parent, layer, shared, grid });
    this.beams = new BeamLines({ parent, layer });
    this.sparks = sparks;
    this.rig = null;
    this._fxRead = 0;
    this._w = [0, 0, 0];
    this._shocks = [];
    for (let i = 0; i < SHOCK_CAP; i++) this._shocks.push({ x: 0, y: 0, t0: -1e9, life: 0, rMax: 0, width: 0, strength: 0 });
    this._flashes = [];
    for (let i = 0; i < FLASH_CAP; i++) this._flashes.push({ x: 0, y: 0, z: 0, t0: -1e9, life: 0, size: 0, r: 0, g: 0, b: 0 });
    this._flashHead = 0;
    this._shockHead = 0;
    this._blasts = [];
    for (let i = 0; i < BLAST_CAP; i++) this._blasts.push({ x: 0, y: 0, t0: -1e9, k: 0 });
    this._blastHead = 0;
    this.time = 0;
    this.visible = false;
    this.stats = { drones: 0, beams: 0, blasts: 0 };
  }

  /** Platforma do rysowania (src/game/asteroidMiningRig.js). */
  attach(rig) {
    this.rig = rig;
    this._fxRead = rig ? rig.fxWrite : 0;
  }

  /** Warstwy na czas rozgrzewki: jedna instancja drona i wiązki (kompilacja programów). */
  warmInstances() {
    this.drones.begin();
    this.drones.add(0, 0, 0, 0, 1, 0, 0, 0);
    this.drones.add(0, 0, -5000, 0, 1, 0, 0, 0);
    this.drones.commit(0);
    this.beams.begin();
    this.beams.add(0, 0, -5000, 1, 0, -5000, 1, 0, 0, 0, 1e-6);
    this.beams.add(0, 0, -5000, 1, 0, -5000, 1, 0, 0, 0, 1e-6);
    this.beams.commit();
  }

  hide() {
    this.drones.begin(); this.drones.commit(this.time);
    this.beams.begin(); this.beams.commit();
    this.visible = false;
  }

  /**
   * Światła platformy do siatki gry (krok świateł pasa, przed grid.build): lampy dronów,
   * reflektory robocze, żar miejsc cięcia, punkt piły, migające ładunki.
   */
  addLights(grid, ox, oy, time) {
    // Wybuchy: błysk (szybki) + żar (wolny), zasięg rośnie, barwa stygnie do pomarańczu;
    // rozpraszanie w pyle 1,0 (łuna w ośrodku) — wzór dynamics.addLights dema.
    for (let i = 0; i < BLAST_CAP; i++) {
      const b = this._blasts[i];
      const a = time - b.t0;
      if (!(a >= 0 && a < BLAST_LIFE)) continue;
      const k = b.k;
      const I = (7.0 * Math.exp(-a / 0.16) + 1.3 * Math.exp(-a / 0.8)) * k;
      if (I < 0.01) continue;
      const range = (900 + 2800 * (1 - Math.exp(-a / 0.3))) * Math.sqrt(Math.max(0.2, k));
      const warm = Math.min(1, a / 0.5);
      grid.add(b.x - ox, b.y + oy, 80, range, I, I * (0.82 - 0.25 * warm), I * (0.62 - 0.4 * warm), 1.0);
    }
    const rig = this.rig;
    if (!rig || !rig.busy) return;
    const D = rig.drones;
    const owner = DRONE_LIGHT_OWNER;
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      if (d.parked && !rig.enabled) continue;
      const lx = d.p[0] - ox, ly = d.p[1] + oy, lz = d.p[2];
      grid.add(lx, ly, lz, 420, 0.35, 0.55, 0.8, 0.05, 0, 0, -1, -2, 0, 0, 0, owner);
      // Reflektor roboczy drona (w dół): oświetla miejsce cięcia i wnętrze otworu.
      if (!d.parked) grid.add(lx, ly, lz - 20, 1400, 1.1, 1.2, 1.3, 0.06, 0, 0, -1, 0.766, 0.951, 0.3, 0, owner);
      if (d.laserOn) {
        const h = d.hit;
        const f = 0.85 + 0.15 * Math.sin(time * 47 + d.phase * 5);
        grid.add(h.x - ox + h.nx * 40, h.y + oy + h.ny * 40, h.z + h.nz * 40, 620, 1.7 * f, 0.8 * f, 0.3 * f, 0.18);
      }
    }
    const sp = rig.sawPoint;
    if (rig.saw.active && !rig.saw.done && sp.hit) grid.add(sp.x - ox, sp.y + oy, sp.z + 60, 700, 1.9, 1.1, 0.45, 0.16);
    const w = this._w;
    for (let i = 0; i < rig.charges.length; i++) {
      const ch = rig.charges[i];
      if (!ch.body.alive) continue;
      ch.body.localToWorld(ch.local[0], ch.local[1], ch.local[2], w);
      const blink = Math.sin((rig.time - ch.t0) * 7) > 0.2 ? 1 : 0.25;
      grid.add(w[0] - ox, w[1] + oy, w[2] + 60, 380, 1.4 * blink, 0.12 * blink, 0.08 * blink, 0.08);
    }
  }

  /**
   * Klatka (krok update pasa, przed iskrami): drony, wiązki, iskry, zdarzenia efektów
   * (błyski, fale). f: { dt, time, originX, originY (świat gry), zoom, ship, sunT(x, y) }.
   */
  update(f) {
    const rig = this.rig;
    this.time = f.time;
    const ox = f.originX, oy = f.originY;
    this.drones.begin();
    this.beams.begin();
    if (!rig) { this.drones.commit(f.time); this.beams.commit(); return; }
    this._drainFx(f);
    const sp = this.sparks;
    const dt = f.dt;
    const sunT = f.sunT;
    // Drony (widoczne, gdy platforma pracuje albo wracają do doku).
    if (rig.busy) {
      const D = rig.drones;
      for (let i = 0; i < D.length; i++) {
        const d = D[i];
        const lx = d.p[0] - ox, ly = d.p[1] + oy;
        const v2 = d.v[0] * d.v[0] + d.v[1] * d.v[1] + d.v[2] * d.v[2];
        this.drones.add(lx, ly, d.p[2], d.yaw, sunT ? sunT(d.p[0], -d.p[1]) : 1, d.laserOn ? 1 : 0, Math.min(1, Math.sqrt(v2) / 1500), d.phase);
        if (!d.laserOn) continue;
        const h = d.hit;
        // Laser: szeroka poświata + biały rdzeń; iskry z miejsca cięcia (odbite od ściany).
        this.beams.add(lx, ly, d.p[2] - 10, h.x - ox, h.y + oy, h.z, 16, 3.2, 1.35, 0.5, 1.4);
        this.beams.add(lx, ly, d.p[2] - 10, h.x - ox, h.y + oy, h.z, 5, 6, 5, 4.2, 1.2);
        if (sp && dt > 0 && fxRandom.next() < dt * 40) {
          sp.emit(h.x - ox, h.y + oy, h.z, h.nx, h.ny, h.nz, 6, SPARK_CUT);
        }
      }
    }
    // Piła: rozżarzona szczelina za piłą (stygnie), drut między dronami, zejście do skały.
    const sw = rig.saw;
    if (sw.active && (!sw.done || rig.time - sw.doneAt < 1.5)) {
      const t = sw.t;
      const x0 = sw.x0 + sw.dx * Math.max(0, t - 900), y0 = sw.y0 + sw.dy * Math.max(0, t - 900);
      const x1 = sw.x0 + sw.dx * t, y1 = sw.y0 + sw.dy * t;
      const k = sw.done ? Math.max(0, 1 - (rig.time - sw.doneAt) / 1.5) : 1;
      this.beams.add(x0 - ox, y0 + oy, -60, x1 - ox, y1 + oy, -60, 30, 3.0, 1.1, 0.3, 0.55 * k);
      if (!sw.done) {
        const a = rig.drones[0], b = rig.drones[1];
        if (a && b) this.beams.add(a.p[0] - ox, a.p[1] + oy, a.p[2] - 8, b.p[0] - ox, b.p[1] + oy, b.p[2] - 8, 9, 4.5, 4.0, 3.2, 1.0);
        const q = rig.sawPoint;
        const cx = x1 - ox, cy = y1 + oy;
        if (q.hit) {
          this.beams.add(cx, cy, rig.cfg.sawZ - 8, q.x - ox, q.y + oy, q.z, 7, 5, 3.2, 1.4, 0.9);
          if (sp && dt > 0 && fxRandom.next() < dt * 30) sp.emit(q.x - ox, q.y + oy, q.z + 10, 0, 0, 1, 10, SPARK_SAW);
        }
      }
    }
    const pv = rig.sawPreview;
    if (pv.on) this.beams.add(pv.ax - ox, pv.ay + oy, 150, pv.bx - ox, pv.by + oy, 150, 8, 0.5, 1.4, 2.4, 0.5);
    // Wiązka ściągająca: od statku do najbliższych celów (pulsuje).
    if (rig.tractorOn && f.ship && rig.tractorCount > 0) {
      const sx = f.ship.x - ox, sy = -f.ship.y + oy;
      for (let i = 0; i < rig.tractorCount; i++) {
        const t = rig.tractorTargets[i];
        const pulse = 0.55 + 0.45 * Math.sin(f.time * 9 + t[0] * 0.01);
        this.beams.add(sx, sy, 20, t[0] - ox, t[1] + oy, t[2], 38, 0.25, 0.6, 1.6, 0.35 * pulse);
      }
    }
    this.drones.commit(f.time);
    this.beams.commit();
    // Fale wybuchów (sama refrakcja, świat gry — zgłoszenie co klatkę).
    const field = Core3D.fxDistortion ? Core3D.fxDistortion() : null;
    for (let i = 0; i < SHOCK_CAP; i++) {
      const s = this._shocks[i];
      const u = (f.time - s.t0) / s.life;
      if (!(u >= 0 && u < 1)) continue;
      if (field) field.shock(s.x, s.y, s.rMax * (0.08 + 0.92 * Math.sqrt(u)), s.width * (1 + u), s.strength * (1 - u) * (1 - u), 0.35);
    }
    this.stats.drones = this.drones.count;
    this.stats.beams = this.beams.count;
    this.visible = this.drones.count > 0 || this.beams.count > 0;
  }

  // Zdarzenia platformy od ostatniej klatki (pierścień rig.fx).
  _drainFx(f) {
    const rig = this.rig;
    const cap = rig.fx.length;
    if (rig.fxWrite - this._fxRead > cap) this._fxRead = rig.fxWrite - cap;
    const ox = f.originX, oy = f.originY;
    const sp = this.sparks;
    while (this._fxRead < rig.fxWrite) {
      const e = rig.fx[this._fxRead % cap];
      this._fxRead++;
      const lx = e.x - ox, ly = e.y + oy;
      if (e.kind === MINING_FX.BLAST || e.kind === MINING_FX.CONTAINED) {
        const breach = e.kind === MINING_FX.BLAST;
        const E = Math.max(0.05, e.energy);
        const sq = Math.sqrt(E);
        // Moc błysku jak w demie (_blastFx: rośnie wolno z energią — przy mocy > 2
        // pomarańczowa łuna zalewała cały kadr); ładunek za słaby — stłumiony w skale.
        const k = Math.min(1.2, 0.3 + sq * 0.16) * (breach ? 1 : 0.45);
        if (sp) {
          SPARK_BLAST.speed[1] = 2200 * Math.min(1.6, k);
          sp.emit(lx, ly, e.z + 40, 0, 0, 1, breach ? 250 + 120 * sq : 60 + 30 * sq, SPARK_BLAST);
        }
        this._blast(e.x, e.y, k);
        if (breach) this._shock(e.x, -e.y, 700 + 500 * sq, 60 + 25 * sq, 6 + 3 * sq, 0.65);
        this.stats.blasts++;
      } else if (e.kind === MINING_FX.SPLIT) {
        if (sp && e.n > 0) sp.emit(lx, ly, e.z + 30, 0, 0, 1, 20 + 6 * e.n, SPARK_SAW);
      } else if (e.kind === MINING_FX.COLLECT) {
        this._flash(lx, ly, e.z + 30, 60 + 40 * Math.min(4, Math.sqrt(Math.max(0, e.energy))), 0.35, 0.8, 1.7, 3.0);
      }
    }
  }

  _flash(x, y, z, size, life, r, g, b) {
    const fl = this._flashes[this._flashHead % FLASH_CAP];
    this._flashHead++;
    fl.x = x; fl.y = y; fl.z = z; fl.t0 = this.time; fl.life = life; fl.size = size; fl.r = r; fl.g = g; fl.b = b;
  }

  // Wybuch ładunku: światło i jądro jak `dynamics.explode` dema (x, y — przestrzeń skał).
  _blast(x, y, k) {
    const b = this._blasts[this._blastHead % BLAST_CAP];
    this._blastHead++;
    b.x = x; b.y = y; b.t0 = this.time; b.k = k;
  }

  _shock(x, y, rMax, width, strength, life) {
    const s = this._shocks[this._shockHead % SHOCK_CAP];
    this._shockHead++;
    s.x = x; s.y = y; s.t0 = this.time; s.life = life; s.rMax = rMax; s.width = width; s.strength = strength;
  }

  /** Duszki (krok update pasa, przed glow.commit): żar cięcia, dysze dronów, ładunki, błyski wybuchów. */
  addGlows(glow, ox, oy) {
    const rig = this.rig;
    // Jądra wybuchów (dynamics.addGlows dema).
    for (let i = 0; i < BLAST_CAP; i++) {
      const b = this._blasts[i];
      const a = this.time - b.t0;
      if (!(a >= 0 && a < BLAST_LIFE)) continue;
      const k = Math.exp(-a / 0.2) * b.k;
      if (k > 0.01) glow.add(b.x - ox, b.y + oy, 12, 260 * (0.6 + a * 2.5) * Math.sqrt(b.k), 7 * k, 4.6 * k, 2.6 * k, GLOW_ROUND);
    }
    for (let i = 0; i < FLASH_CAP; i++) {
      const fl = this._flashes[i];
      const u = (this.time - fl.t0) / fl.life;
      if (!(u >= 0 && u < 1)) continue;
      const a = (1 - u) * (1 - u);
      glow.add(fl.x, fl.y, fl.z, fl.size * (0.7 + 0.5 * u), fl.r * a, fl.g * a, fl.b * a, GLOW_ROUND);
    }
    if (!rig || !rig.busy) return;
    const D = rig.drones;
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      if (d.parked && !rig.enabled) continue;
      glow.add(d.p[0] - ox, d.p[1] + oy, d.p[2] + 12, 26, 0.7, 1.6, 2.6, GLOW_ROUND);
      if (d.laserOn) {
        const h = d.hit;
        glow.add(h.x - ox, h.y + oy, h.z + 20, 55, 3.2, 1.7, 0.7, GLOW_ROUND);
      }
    }
    const w = this._w;
    for (let i = 0; i < rig.charges.length; i++) {
      const ch = rig.charges[i];
      if (!ch.body.alive) continue;
      ch.body.localToWorld(ch.local[0], ch.local[1], ch.local[2], w);
      const blink = Math.sin((rig.time - ch.t0) * 7) > 0.2 ? 1 : 0.2;
      glow.add(w[0] - ox, w[1] + oy, w[2] + 80, 70, 5 * blink, 0.4 * blink, 0.25 * blink, GLOW_ROUND);
    }
  }
}

// Opcje emiterów iskier pasa (sparks.emit: stożek, prędkość, życie, barwa HDR, grubość) —
// stałe obiekty (bez literału na emisję); prędkość wybuchu przestawiana przed emisją.
const SPARK_CUT = { cone: 0.7, speed: [150, 900], life: [0.15, 0.6], color: [3.2, 1.5, 0.45], size: 4 };
const SPARK_SAW = { cone: 0.9, speed: [200, 1100], life: [0.15, 0.5], color: [3.4, 2.2, 1.0], size: 4 };
const SPARK_BLAST = { cone: -1, speed: [250, 2200], life: [0.3, 1.3], color: [3.4, 1.8, 0.7], size: 7 };
