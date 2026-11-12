// src/3d/trafficWork3D.js — obraz pracy statków ruchu v2 w bańce (E24): górnicy i złomiarze NPC.
//
// Wejście: ramka pracy z bloku `trafficWork` (`src/render/blocks/trafficWorkBlock.js`; gra liczy ją w
// `src/game/trafficSalvage.js`). Tylko obraz — uszczuplenie pasa i odzysk złomu liczy świat ruchu, a ubytek wraku
// (cięcie węzłów, lina holu) — gra.
//   • GÓRNIK (MINE): drony i lasery platformy wydobywczej gracza na skałach pola — `MiningView` pasa
//     (`asteroidBelt.setNpcWork`, te same partie i materiały, iskry pasa).
//   • CIĘCIE (CUT): dwa palniki od dziobu złomiarza do brzegu wraku (wiązki `BeamLines` z `miningView.js` — ten sam
//     graf, własna siatka w scenie gry), iskry z puli `SparkSystem3D`, odłamki blachy z puli `HullDebris3D`,
//     żar cięcia w siatce świateł (`Core3D.fx.lights.point`).
//   • HOL (TOW): pulsująca wiązka ściągająca od rufy holownika do wraku (jak wiązka platformy); linę rysuje kanwa 2D
//     (`drawTowRopes` — `TowSystem`).
//   • CIĘCIE JAKO PROCES (rekord CUT z polem `aux` — reguła `zlomowanie`): dwa WYSIĘGNIKI z laserami tnącymi (człony
//     i przeguby — partia `ArmStruts`, jeden rysunek), laser od głowicy do rzazu, iskry i żar w miejscu cięcia, wiązki
//     trzymające wrak przy dziobie, snop iskier i odłamki z paszczy, gdy miele sekcję. Pozy liczy gra w układzie statku.
// Jeden rysunek na wszystkie wiązki, pozycje względem początku przy kamerze (`sceneOriginNearCamera`, float32), bez
// alokacji w klatce; losowość obrazu z `fxRandom`. Rozgrzewka: wpis `praca statków ruchu (wiązki)` przy imporcie.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard, float, vec3, vec4, attribute, varyingProperty, positionGeometry,
  abs, clamp, cross, fract, length, max, mix, normalize, select, smoothstep, step
} from 'three/tsl';
import { Core3D } from './core3d.js';
import { BeamLines } from './asteroids/miningView.js';
import { permanentUpdateRange, markLiveRange } from './asteroids/tslCommon.js';
import { sunShadeUnlit } from './hexShips3D.tsl.js';
import { TRAFFIC_WORK_AUX } from '../render/blocks/trafficWorkBlock.js';
import { scrapArmElbow } from '../data/scrapRigs.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { SparkSystem3D } from './sparkSystem3D.js';
import { HullDebris3D } from './hullDebris3D.js';
import { fxRandom } from './fx/fxRandom.js';
import { WARIANT_INSTANCJI } from './rozgrzewka.js';

const KIND_CUT = 2;
const KIND_TOW = 3;
const BEAM_CAP = 96;
/** Człony i przeguby wysięgników: 5 na ramię, 2 ramiona na złomiarza. */
const STRUT_CAP = 160;
const STRUT_FLOATS = 12;   // A (x, y, z, szerokość), B (x, y, z, rodzaj: 0 człon, 1 przegub), C (r, g, b, —)

/** Wygląd (strojenie na żywo: `TrafficWork3D.look`). */
export const TRAFFIC_WORK_LOOK = {
  torchWidth: 14, torchCore: 5,
  torchHalo: [3.2, 1.35, 0.5], torchWhite: [6, 5, 4.2],
  sparkRate: 46, sparkSpeed: [160, 820], sparkLife: [0.15, 0.6], sparkSize: 0.35, sparkGain: 1.4,
  sparkColor: [3.2, 1.5, 0.45],
  debrisRate: 1.6, debrisColor: [0.32, 0.33, 0.35],
  light: [1.0, 0.55, 0.2], lightPower: 2.4, lightRange: 1100,
  tractorWidth: 46, tractorColor: [0.25, 0.6, 1.6], tractorK: 0.32,
  // Cięcie jako proces: wysięgniki (szerokości jako ułamek długości członu), laser tnący, wiązki trzymające, paszcza.
  armZ: 46, armWidth: 0.15, armWidth2: 0.115, jointR: 0.105, headR: 0.075,
  armSteel: [0.115, 0.125, 0.14], armPaint: [0.5, 0.36, 0.06], armJoint: [0.07, 0.075, 0.085], armHead: [0.2, 0.21, 0.23],
  laserWidth: 9, laserCore: 3.2, laserBack: 0.2,
  laserHalo: [0.9, 2.6, 3.4], laserWhite: [5.5, 6.5, 7],
  cutGlowWidth: 26, cutGlow: [3.4, 1.5, 0.45],
  cutSparkRate: 70, cutLight: [1.0, 0.6, 0.25], cutLightPower: 2.2, cutLightRange: 700,
  gripWidth: 20, gripColor: [0.25, 0.6, 1.6], gripK: 0.22,
  mawSparkRate: 110, mawDebrisRate: 5, mawLightPower: 2.0, mawLightRange: 600
};

const _origin = { x: 0, y: 0 };
const _el = { x: 0, y: 0 };
const _w0 = { x: 0, y: 0 };
const _w1 = { x: 0, y: 0 };
const _w2 = { x: 0, y: 0 };

/**
 * Człony i przeguby wysięgników — jedna partia, jeden rysunek. Kwad wzdłuż odcinka A → B w płaszczyźnie gry
 * (jak wiązki `BeamLines`), materiał NIEPRZEZROCZYSTY z głębią: człon to kratownica malowana na pasie (belki przy
 * krawędziach, ukośne zastrzały), przegub — krążek (A → B = średnica). Światło: maska słońca jak kadłuby.
 */
export class ArmStruts {
  constructor({ parent, layer, cap = STRUT_CAP, name = 'TrafficWork:arms' }) {
    this.cap = cap;
    const plane = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(cap * STRUT_FLOATS);
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRUT_FLOATS, 1);
    this.range = permanentUpdateRange(buffer);
    const ig = new THREE.InstancedBufferGeometry();
    ig.setIndex(plane.index);
    ig.setAttribute('position', plane.getAttribute('position'));
    ig.setAttribute('uv', plane.getAttribute('uv'));
    ig.setAttribute('sA', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    ig.setAttribute('sB', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    ig.setAttribute('sC', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    ig.instanceCount = 0;
    ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.data = data;
    this.buffer = buffer;
    this.geo = ig;
    const mat = new THREE.NodeMaterial();
    mat.name = name;
    mat.transparent = false;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.side = THREE.DoubleSide;
    const vAcross = varyingProperty('float', 'vStrutAcross');
    const vAlong = varyingProperty('float', 'vStrutAlong');
    const vRatio = varyingProperty('float', 'vStrutRatio');
    const vCol = varyingProperty('vec4', 'vStrutCol');
    mat.positionNode = Fn(() => {
      const A = attribute('sA', 'vec4');
      const B = attribute('sB', 'vec4');
      const p = positionGeometry;
      const d = B.xyz.sub(A.xyz);
      const dxy = vec3(d.x, d.y, 0.0);
      const len = length(dxy);
      const perp = select(len.greaterThan(1e-3), normalize(cross(dxy, vec3(0.0, 0.0, 1.0))), vec3(1.0, 0.0, 0.0));
      vAcross.assign(p.y.mul(2.0));
      vAlong.assign(p.x.add(0.5));
      vRatio.assign(len.div(max(A.w, 1e-3)));
      vCol.assign(vec4(attribute('sC', 'vec4').xyz, B.w));
      return mix(A.xyz, B.xyz, p.x.add(0.5)).add(perp.mul(p.y).mul(A.w));
    })();
    mat.fragmentNode = Fn(() => {
      const y = clamp(vAcross, -1.0, 1.0).toVar();
      const along = clamp(vAlong, 0.0, 1.0).toVar();
      const joint = step(0.5, vCol.w).toVar();
      // Przegub: krążek wpisany w kwad (poza kołem — nic).
      const rx = along.mul(2.0).sub(1.0);
      const rr = rx.mul(rx).add(y.mul(y)).toVar();
      If(joint.greaterThan(0.5).and(rr.greaterThan(1.0)), () => {
        Discard();
      });
      // Człon: belki nośne przy krawędziach i ukośne zastrzały (piła wzdłuż członu), między nimi ciemne wnętrze.
      const rail = smoothstep(0.6, 0.7, abs(y));
      const zig = abs(fract(along.mul(vRatio).mul(0.85)).sub(0.5)).mul(4.0).sub(1.0);
      const brace = float(1.0).sub(smoothstep(0.16, 0.3, abs(y.div(0.62).sub(zig))));
      const solid = max(rail, brace);
      const bevel = float(0.82).add(float(0.18).mul(float(1.0).sub(y.mul(y))));
      const strut = vCol.rgb.mul(mix(0.38, 1.0, solid)).mul(bevel);
      // Przegub: ciemna piasta, jaśniejszy pierścień.
      const ring = smoothstep(0.3, 0.42, rr).mul(float(1.0).sub(smoothstep(0.78, 0.92, rr)));
      const hub = vCol.rgb.mul(mix(0.7, 1.9, ring));
      return vec4(sunShadeUnlit(mix(strut, hub, joint)), 1.0);
    })();
    this.material = mat;
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    // Nad kadłubami (10) i odłamkami (11): wysięgnik pracuje nad wrakiem.
    mesh.renderOrder = 13;
    mesh.name = name;
    mesh.visible = false;
    mesh.layers.set(layer);
    parent.add(mesh);
    this.mesh = mesh;
    this.count = 0;
  }

  begin() { this.count = 0; }

  /** Człon albo przegub (lokalnie): A → B, szerokość [j.], rodzaj (0 człon, 1 przegub), barwa liniowa. */
  add(ax, ay, az, bx, by, bz, width, kind, r, g, b) {
    if (this.count >= this.cap) return;
    const o = this.count++ * STRUT_FLOATS;
    const d = this.data;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = az; d[o + 3] = width;
    d[o + 4] = bx; d[o + 5] = by; d[o + 6] = bz; d[o + 7] = kind;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = 0;
  }

  /** Przegub — krążek o promieniu `rad` w punkcie (x, y). */
  disc(x, y, z, rad, col) {
    this.add(x - rad, y, z, x + rad, y, z, rad * 2, 1, col[0], col[1], col[2]);
  }

  commit() {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) markLiveRange(this.buffer, this.range, n * STRUT_FLOATS);
  }
}

class TrafficWorkView {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'TrafficWork';
    this.beams = new BeamLines({ parent: this.group, layer: 0, cap: BEAM_CAP, name: 'TrafficWork:beams' });
    this.arms = new ArmStruts({ parent: this.group, layer: 0 });
    Core3D.scene?.add(this.group);
    this.look = TRAFFIC_WORK_LOOK;
    this.stats = { cut: 0, tow: 0, mine: 0, scrap: 0, beams: 0, struts: 0 };
  }

  warmupMeshes() {
    return [this.beams.mesh, this.arms.mesh];
  }

  /**
   * Klatka: `frame` — ramka `trafficWork`, `belt` — pas obrazu (górnicy) albo null, `nowSec` — zegar efektów
   * (`Core3D.frameNowMs() / 1000`), `dt` — czas klatki (0 w pauzie: bez emisji iskier i odłamków).
   */
  update(frame, belt, nowSec, dt) {
    if (belt && typeof belt.setNpcWork === 'function') belt.setNpcWork(frame);
    const beams = this.beams;
    beams.begin();
    this.arms.begin();
    const st = this.stats;
    st.cut = 0; st.tow = 0; st.mine = 0; st.scrap = 0;
    const n = frame ? frame.count | 0 : 0;
    if (n) {
      sceneOriginNearCamera(_origin);
      const ox = _origin.x, oy = _origin.y;
      this.group.position.set(ox, oy, 0);
      this.group.updateMatrixWorld();
      for (let i = 0; i < n; i++) {
        const r = frame.list[i];
        if (r.kind === KIND_CUT && r.scrap) { this._scrap(r, ox, oy, nowSec, dt); st.cut++; st.scrap++; }
        else if (r.kind === KIND_CUT) { this._cut(r, ox, oy, nowSec, dt); st.cut++; }
        else if (r.kind === KIND_TOW) { this._tow(r, ox, oy, nowSec); st.tow++; }
        else st.mine++;
      }
    }
    beams.commit();
    this.arms.commit();
    st.beams = beams.count;
    st.struts = this.arms.count;
  }

  /**
   * Cięcie jako proces: wysięgniki, laser tnący, wiązki trzymające wrak i paszcza — pozy z pola `aux` rekordu
   * (układ statku), obrócone pozą statku w chwili klatki.
   */
  _scrap(r, ox, oy, t, dt) {
    const L = this.look, A = TRAFFIC_WORK_AUX, aux = r.aux, arms = this.arms;
    const c = Math.cos(r.angle), s = Math.sin(r.angle);
    const seg = Math.max(1, aux[A.SEG]);
    const live = dt > 0;
    for (let i = 0; i < 2; i++) {
      const o = A.ARM + i * A.ARM_STRIDE;
      const mx = aux[o + A.MX], my = aux[o + A.MY], hx = aux[o + A.HX], hy = aux[o + A.HY];
      const torch = aux[o + A.TORCH];
      scrapArmElbow(mx, my, hx, hy, seg, i === 0 ? -1 : 1, _el);
      // Głowica lasera siedzi przed końcem ramienia: laser idzie skosem od niej do rzazu.
      let dx = hx - _el.x, dy = hy - _el.y;
      const dl = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= dl; dy /= dl;
      const back = seg * L.laserBack;
      const m = shipToWorld(r, c, s, mx, my, _w0);
      const e = shipToWorld(r, c, s, _el.x, _el.y, _w1);
      const tip = shipToWorld(r, c, s, hx - dx * back, hy - dy * back, _w2);
      const mX = m.x - ox, mY = -m.y - oy, eX = e.x - ox, eY = -e.y - oy, tX = tip.x - ox, tY = -tip.y - oy;
      const z = L.armZ;
      arms.add(mX, mY, z, eX, eY, z + 3, seg * L.armWidth, 0, L.armSteel[0], L.armSteel[1], L.armSteel[2]);
      arms.add(eX, eY, z + 4, tX, tY, z + 6, seg * L.armWidth2, 0, L.armPaint[0], L.armPaint[1], L.armPaint[2]);
      arms.disc(mX, mY, z + 7, seg * L.jointR * 1.25, L.armJoint);
      arms.disc(eX, eY, z + 8, seg * L.jointR, L.armJoint);
      arms.disc(tX, tY, z + 9, seg * L.headR, L.armHead);
      if (!(torch > 0)) continue;
      const cut = shipToWorld(r, c, s, hx, hy, _w0);
      const cX = cut.x - ox, cY = -cut.y - oy;
      const flick = 0.8 + 0.2 * Math.sin(t * 47 + r.id + i * 2.1);
      // Laser od głowicy do rzazu (halo + rdzeń) i żar w miejscu cięcia (krótka poprzeczna smuga).
      this.beams.add(tX, tY, z + 10, cX, cY, 12, L.laserWidth, L.laserHalo[0], L.laserHalo[1], L.laserHalo[2], 1.2 * flick * torch);
      this.beams.add(tX, tY, z + 10, cX, cY, 12, L.laserCore, L.laserWhite[0], L.laserWhite[1], L.laserWhite[2], flick * torch);
      const g = L.cutGlowWidth * 0.5;
      this.beams.add(cX - g, cY, 14, cX + g, cY, 14, L.cutGlowWidth, L.cutGlow[0], L.cutGlow[1], L.cutGlow[2], 0.9 * flick * torch);
      Core3D.fx?.lights?.point(cut.x, cut.y, L.cutLight[0], L.cutLight[1], L.cutLight[2], L.cutLightPower * flick * torch, L.cutLightRange, 30);
      if (!live) continue;
      // Iskry: snop spod rzazu na obie strony linii cięcia (linia idzie w poprzek statku).
      const want = L.cutSparkRate * torch * dt;
      let ns = Math.floor(want);
      if (fxRandom.next() < want - ns) ns++;
      for (let j = 0; j < ns; j++) {
        const a = r.angle + (fxRandom.next() < 0.5 ? 0 : Math.PI) + (fxRandom.next() - 0.5) * 1.9;
        const sp = L.sparkSpeed[0] + fxRandom.next() * (L.sparkSpeed[1] - L.sparkSpeed[0]);
        const life = L.sparkLife[0] + fxRandom.next() * (L.sparkLife[1] - L.sparkLife[0]);
        SparkSystem3D.emit(cut.x, cut.y, Math.cos(a) * sp, Math.sin(a) * sp, life, L.sparkSize * (0.6 + 0.8 * fxRandom.next()), L.sparkGain, L.sparkColor);
      }
    }
    // Wiązki trzymające wrak: od emiterów na dziobie do zaczepów przy bliskim końcu wraku.
    const grip = aux[A.GRIP];
    if (grip > 0.02) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 5 + r.id * 0.37);
      for (let i = 0; i < 2; i++) {
        const em = shipToWorld(r, c, s, aux[A.E0X + i * 2], aux[A.E0Y + i * 2], _w0);
        const tg = shipToWorld(r, c, s, aux[A.G0X + i * 2], aux[A.G0Y + i * 2], _w1);
        this.beams.add(em.x - ox, -em.y - oy, 24, tg.x - ox, -tg.y - oy, 16, L.gripWidth,
          L.gripColor[0], L.gripColor[1], L.gripColor[2], L.gripK * pulse * grip);
      }
    }
    // Paszcza: mielona sekcja sypie iskrami i odłamkami przed dziób.
    const maw = aux[A.MAW];
    if (maw > 0) {
      const mw = shipToWorld(r, c, s, aux[A.MAW_X], aux[A.MAW_Y], _w0);
      const flick = 0.75 + 0.25 * Math.sin(t * 31 + r.id);
      Core3D.fx?.lights?.point(mw.x, mw.y, L.light[0], L.light[1], L.light[2], L.mawLightPower * flick * maw, L.mawLightRange, 30);
      if (live) {
        const want = L.mawSparkRate * maw * dt;
        let ns = Math.floor(want);
        if (fxRandom.next() < want - ns) ns++;
        for (let j = 0; j < ns; j++) {
          const a = r.angle + (fxRandom.next() - 0.5) * 2.6;
          const sp = L.sparkSpeed[0] + fxRandom.next() * (L.sparkSpeed[1] - L.sparkSpeed[0]) * 0.7;
          const life = L.sparkLife[0] + fxRandom.next() * (L.sparkLife[1] - L.sparkLife[0]);
          const off = (fxRandom.next() - 0.5) * r.length * 0.1;
          SparkSystem3D.emit(mw.x - s * off, mw.y + c * off, Math.cos(a) * sp, Math.sin(a) * sp, life,
            L.sparkSize * (0.6 + 0.8 * fxRandom.next()), L.sparkGain, L.sparkColor);
        }
        if (fxRandom.next() < L.mawDebrisRate * maw * dt) {
          const a = r.angle + (fxRandom.next() - 0.5) * 2.2;
          const sp = 30 + fxRandom.next() * 110;
          const g = 0.8 + 0.4 * fxRandom.next();
          HullDebris3D.spawn(mw.x, mw.y, Math.cos(a) * sp, Math.sin(a) * sp, L.debrisColor[0] * g, L.debrisColor[1] * g, L.debrisColor[2] * g,
            8 + fxRandom.next() * 14, fxRandom.next() < 0.4, t);
        }
      }
    }
  }

  _cut(r, ox, oy, t, dt) {
    const L = this.look;
    const c = Math.cos(r.angle), s = Math.sin(r.angle);
    const half = r.length * 0.45;
    const bx = r.x + c * half, by = r.y + s * half;
    // Punkt cięcia: brzeg wraku od strony złomiarza, wolno wędruje wzdłuż brzegu (szew cięcia).
    let ux = bx - r.tx, uy = by - r.ty;
    const ul = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= ul; uy /= ul;
    const wob = 0.45 * Math.sin(t * 0.31 + r.id * 0.7);
    const cw = Math.cos(wob), sw = Math.sin(wob);
    const dx = ux * cw - uy * sw, dy = ux * sw + uy * cw;
    const px = r.tx + dx * r.tr * 0.55, py = r.ty + dy * r.tr * 0.55;
    const flick = 0.82 + 0.18 * Math.sin(t * 41 + r.id);
    const side = r.length * 0.07;
    for (let k = -1; k <= 1; k += 2) {
      const ax = bx - s * side * k, ay = by + c * side * k;
      const qx = px + (-dy) * 14 * k, qy = py + dx * 14 * k;
      const lax = ax - ox, lay = -ay - oy, lqx = qx - ox, lqy = -qy - oy;
      this.beams.add(lax, lay, 22, lqx, lqy, 14, L.torchWidth, L.torchHalo[0], L.torchHalo[1], L.torchHalo[2], 1.3 * flick);
      this.beams.add(lax, lay, 22, lqx, lqy, 14, L.torchCore, L.torchWhite[0], L.torchWhite[1], L.torchWhite[2], 1.1 * flick);
    }
    Core3D.fx?.lights?.point(px, py, L.light[0], L.light[1], L.light[2], L.lightPower * flick, L.lightRange, 30);
    if (!(dt > 0)) return;
    let want = L.sparkRate * dt;
    let ns = Math.floor(want);
    if (fxRandom.next() < want - ns) ns++;
    for (let j = 0; j < ns; j++) {
      // Snop od miejsca cięcia na zewnątrz wraku (stożek wokół kierunku do złomiarza).
      const a = Math.atan2(dy, dx) + (fxRandom.next() - 0.5) * 2.2;
      const sp = L.sparkSpeed[0] + fxRandom.next() * (L.sparkSpeed[1] - L.sparkSpeed[0]);
      const life = L.sparkLife[0] + fxRandom.next() * (L.sparkLife[1] - L.sparkLife[0]);
      SparkSystem3D.emit(px, py, Math.cos(a) * sp, Math.sin(a) * sp, life, L.sparkSize * (0.6 + 0.8 * fxRandom.next()), L.sparkGain, L.sparkColor);
    }
    want = L.debrisRate * dt;
    if (fxRandom.next() < want) {
      const a = Math.atan2(dy, dx) + (fxRandom.next() - 0.5) * 1.6;
      const sp = 40 + fxRandom.next() * 120;
      const g = 0.8 + 0.4 * fxRandom.next();
      HullDebris3D.spawn(px, py, Math.cos(a) * sp, Math.sin(a) * sp, L.debrisColor[0] * g, L.debrisColor[1] * g, L.debrisColor[2] * g,
        8 + fxRandom.next() * 14, fxRandom.next() < 0.4, t);
    }
  }

  _tow(r, ox, oy, t) {
    const L = this.look;
    // Zaczep liny od strony wraku (jak `hitchOf` w grze): punkt obrysu holownika w kierunku wraku.
    let ux = r.tx - r.x, uy = r.ty - r.y;
    const ul = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= ul; uy /= ul;
    const half = r.length * 0.5;
    const ax = r.x + ux * half, ay = r.y + uy * half;
    const pulse = 0.55 + 0.45 * Math.sin(t * 6 + r.id * 0.37);
    this.beams.add(ax - ox, -ay - oy, 20, r.tx - ox, -r.ty - oy, 16, L.tractorWidth,
      L.tractorColor[0], L.tractorColor[1], L.tractorColor[2], L.tractorK * pulse * (r.haul ? 1.25 : 1));
  }
}

/** Układ statku (x — dziób, y — prawa burta) → świat gry (y w dół) przy pozie rekordu. */
function shipToWorld(r, c, s, lx, ly, out) {
  out.x = r.x + c * lx - s * ly;
  out.y = r.y + s * lx + c * ly;
  return out;
}

let _view = null;

/** Wspólny obraz pracy (strona w trybie `off`, worker renderu). */
export function sharedTrafficWork3D() {
  return _view || (_view = new TrafficWorkView());
}

export const TrafficWork3D = {
  get look() { return TRAFFIC_WORK_LOOK; },
  get stats() { return _view ? _view.stats : null; },
  update(frame, belt, nowSec, dt) { sharedTrafficWork3D().update(frame, belt, nowSec, dt); }
};

if (Core3D.warmup && typeof Core3D.warmup.add === 'function') {
  Core3D.warmup.add({ name: 'praca statków ruchu (wiązki)', objects: () => sharedTrafficWork3D().warmupMeshes(), phase: 'loading', variant: WARIANT_INSTANCJI });
  Core3D.warmup.add({ name: 'praca statków ruchu (wiązki, kamery 3D)', objects: () => sharedTrafficWork3D().warmupMeshes(), phase: 'loading', ortho: false, variant: WARIANT_INSTANCJI });
}
