// src/3d/swarm/swarmDrones.tsl.js
//
// RENDER ROJU (TSL, WebGPU): bryły dronów S / M / L / Capital (geometria: swarmDroneModel.js),
// ich światła (billboardy addytywne) i cienie na kadłubach / pokładzie. Wszystko czyta stan wprost
// z bufora symulacji GPU (swarmSim.js: rekord drona 11 × vec4) — bez wysyłki z CPU co klatkę.
// Galeria dema pisze ten sam bufor z CPU.
//
// BRYŁA: Mesh + InstancedBufferGeometry na klasę i LOD (jeden graf materiału, klony z
// `material.uniforms.uBase` — pierwszy dron klasy w buforze; drony są w buforze klasami po kolei).
// RAMIONA pozuje shader wierzchołków: części (aRig = ramię, część) w układach przegubów, kąty
// mieszane z rozłożenia e (LOOK.x) między pozą złożoną a chwytem (IK chwytu liczone raz na CPU —
// tablica klas, lustro swarmArmPose), teleskop przedramienia wysuwa się z e (dwa człony), chwytak
// w osiach drona (zamki w gniazdach narożnych, podwójny na styku kontenerów), szczęki rozwarte
// o (1 − zacisk g).
// Światło jak ładunek (cargoLight.tsl.js: model kadłuba gry, maska słońca, lampy ładowni, gdy
// dron jest w ładowni — INFO.z). Emisja: listwa stanu (barwa fazy), dysze jonowe (ciąg), wizjer,
// okna Capitala, lampki szczęk (bursztyn → zieleń przy zacisku).
import * as THREE from 'three/webgpu';
import {
  Fn, If, abs, attribute, cos, cross, dot, exp, float, floor, fract, instanceIndex, int, length, max, min, mix,
  normalize, positionGeometry, select, sin, smoothstep, uint, uniform, uniformArray, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import {
  CARGO_LIGHT, bayAmbientOcclusion, bayFillLight, bayLampLight, bayRecord, bayRimVisibility, bayToLocal, cargoHash,
  cargoShade, cargoSurfaceCap, dirToLocal
} from '../cargo/cargoLight.tsl.js';
import { hexToLinear } from '../cargo/containers.tsl.js';
import { CARGO_LIGHT_VIEW } from '../cargo/drones.tsl.js';
import { SWARM_DRONE, SWARM_DRONE_VEC4 } from '../../game/swarm/swarmPort.js';
import { SWARM_ARM_ROWS, SWARM_CLASS_ROW, SWARM_CLASS_ROWS, SWARM_LIGHT_SLOT, swarmClassTable } from './swarmClassTable.js';
import { SWARM_DRONE_MAT } from './swarmDroneModel.js';
import { SWARM_DRONE_CLASS_LIST, SWARM_MAX_ARMS } from '../../data/swarmDrones.js';

export const SWARM_DRONE_RENDER_ORDER = 12.5;
export const SWARM_LIGHTS_PER_DRONE = 12 + SWARM_MAX_ARMS;
const CR = SWARM_CLASS_ROW;
const DV = SWARM_DRONE_VEC4;
const DR = SWARM_DRONE;

/** Farby (sRGB) materiałów drona — indeks = SWARM_DRONE_MAT. */
export const SWARM_DRONE_PAINT = Object.freeze([
  '#e3e7ec', // kadłub — biała ceramika
  '#252a31', // grafit
  '#0a0c0f', // czerń dysz
  '#e79f2b', // bursztyn znaków klasy
  '#9ca3ab', // stal
  '#0a1d25', // szkło czujników
  '#000000', '#000000', '#000000', '#000000', // emisja (barwy niżej)
  '#c4cad1', // jasnoszare płyty
  '#000000'
]);

/** Barwy listwy stanu (liniowe, HDR × moc) — indeks = SWARM_STATUS_CODE. */
export const SWARM_STATUS_COLORS = Object.freeze([
  [0.12, 0.62, 0.52, 0.55], // w gnieździe
  [0.22, 0.82, 1.0, 2.4],   // pusty lot
  [1.0, 0.6, 0.14, 2.6],    // z ładunkiem
  [0.3, 1.0, 0.45, 2.6],    // prowadzony (zejście, gniazdo)
  [1.0, 0.22, 0.68, 2.8],   // czeka na kolumnę
  [1.0, 1.0, 1.0, 3.2]      // chwyt / odłożenie
]);

const wrapAngle = (a) => a.sub(floor(a.add(Math.PI).div(Math.PI * 2)).mul(Math.PI * 2));

/**
 * Poza ramienia (węzły TSL): bark S, łokieć E, nadgarstek W, kierunek poziomy h, oś boczna,
 * osie odcinków a1 / a2, wysuw teleskopu ext — kąty mieszane liniowo z e między złożeniem
 * a chwytem, przedramię = tuleja + wysuw smoothstep(extA, extB, e) (tablica klas; lustro CPU
 * swarmArmPose w src/data/swarmDrones.js).
 */
export function swarmArmNodes(CT, cb, arm, e) {
  const ab = cb.add(CR.ARMS).add(arm.mul(SWARM_ARM_ROWS));
  const r0 = CT.element(ab);
  const r1 = CT.element(ab.add(1));
  const r2 = CT.element(ab.add(2));
  const r3 = CT.element(ab.add(3));
  const r4 = CT.element(ab.add(4));
  const S = r0.xyz;
  const l1 = r0.w;
  const sleeve = r3.w;
  const ext = r1.w.sub(sleeve).mul(smoothstep(r4.y, r4.z, e));
  const l2 = sleeve.add(ext);
  const phi = mix(r2.x, r3.x, e);
  const th1 = mix(r2.y, r3.y, e);
  const fore = mix(r2.z, r3.z, e);
  const h = vec3(cos(phi), sin(phi), 0.0);
  const side = vec3(sin(phi).negate(), cos(phi), 0.0);
  const up = vec3(0.0, 0.0, 1.0);
  const a1 = h.mul(cos(th1)).add(up.mul(sin(th1)));
  const a2 = h.mul(cos(fore)).add(up.mul(sin(fore)));
  const E = S.add(a1.mul(l1));
  const W = E.add(a2.mul(l2));
  return { S, E, W, h, side, a1, a2, ext, twin: r4.x, active: r2.w };
}

const rotZ = (v, c, s) => vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);

let _paletteNode = null;
function paletteNode() {
  if (_paletteNode) return _paletteNode;
  const t = [0, 0, 0];
  const rows = SWARM_DRONE_PAINT.map((h) => { hexToLinear(h, t); return new THREE.Vector4(t[0], t[1], t[2], 1); });
  _paletteNode = uniformArray(rows, 'vec4').setName('swarmDronePaint');
  return _paletteNode;
}
let _statusNode = null;
function statusNode() {
  if (_statusNode) return _statusNode;
  _statusNode = uniformArray(SWARM_STATUS_COLORS.map((c) => new THREE.Vector4(c[0], c[1], c[2], c[3])), 'vec4').setName('swarmStatusColors');
  return _statusNode;
}

const perObject = (key, type, init) =>
  uniform(init, type).onObjectUpdate(({ material }) => material.uniforms?.[key]?.value ?? init);

/** Wspólne strojenie wyglądu (grupa renderu nie jest potrzebna — mało materiałów). */
export const SWARM_LOOK = Object.freeze({
  engineGain: uniform(1.0),
  statusGain: uniform(1.0),
  time: uniform(0)
});

/** Szablon materiału bryły dronów dla bufora dronów (węzeł instancedArray symulacji). */
export function swarmDroneMaterial(dronesNode) {
  const CT = swarmClassTable();
  const PAL = paletteNode();
  const STC = statusNode();
  const m = new THREE.NodeMaterial();
  m.name = 'Roj:drony';
  m.lights = false;
  m.fog = false;
  // Kolejka przezroczysta z NoBlending i zapisem głębi — po cieniach na kadłubie (jak ładunek).
  m.transparent = true;
  m.blending = THREE.NoBlending;
  m.depthWrite = true;
  m.side = THREE.FrontSide;
  const uBase = perObject('uBase', 'uint', 0);
  const vN = varyingProperty('vec3', 'vRjN');
  const vW = varyingProperty('vec3', 'vRjW');
  const vL = varyingProperty('vec4', 'vRjL');     // e, g, ciąg, kod stanu
  const vI = varyingProperty('vec4', 'vRjI');     // klasa, ziarno, ładownia, materiał
  const vU = varyingProperty('vec3', 'vRjU');     // pozycja lokalna (wzór paneli)
  m.positionNode = Fn(() => {
    const idx = uBase.add(instanceIndex);
    const b = idx.mul(uint(DV));
    const pose = dronesNode.element(b.add(uint(DR.POSE)));
    const look = dronesNode.element(b.add(uint(DR.LOOK)));
    const info = dronesNode.element(b.add(uint(DR.INFO)));
    const cb = int(info.x).mul(SWARM_CLASS_ROWS);
    const rig = attribute('aRig', 'vec2');
    const part = rig.y;
    const lp = positionGeometry.toVar();
    const nl = attribute('normal', 'vec3').toVar();
    const e = look.x;
    const g = look.y;
    If(part.greaterThan(0.5), () => {
      const arm = int(rig.x.add(0.5));
      const A = swarmArmNodes(CT, cb, arm, e);
      const q = positionGeometry.toVar();
      const n = attribute('normal', 'vec3').toVar();
      const O = vec3(0.0).toVar();
      const X = vec3(1.0, 0.0, 0.0).toVar();
      const Y = vec3(0.0, 1.0, 0.0).toVar();
      const Z = vec3(0.0, 0.0, 1.0).toVar();
      If(part.lessThan(1.5), () => {
        O.assign(A.S); X.assign(A.a1); Y.assign(A.side); Z.assign(cross(A.a1, A.side));
      }).ElseIf(part.lessThan(2.5), () => {
        O.assign(A.E); X.assign(A.a2); Y.assign(A.side); Z.assign(cross(A.a2, A.side));
      }).ElseIf(part.greaterThan(5.5), () => {
        // Człony teleskopu: wysuwają się z tulei wzdłuż przedramienia (pierwszy o pół wysuwu, drugi
        // o cały — jego koniec to nadgarstek).
        O.assign(A.E.add(A.a2.mul(A.ext.mul(select(part.greaterThan(6.5), float(1.0), float(0.5))))));
        X.assign(A.a2); Y.assign(A.side); Z.assign(cross(A.a2, A.side));
      }).Else(() => {
        // Chwytak w osiach drona (wzdłuż kontenerów — zamki trafiają w gniazda narożne).
        O.assign(A.W); X.assign(vec3(1.0, 0.0, 0.0)); Y.assign(vec3(0.0, 1.0, 0.0)); Z.assign(vec3(0.0, 0.0, 1.0));
        If(part.greaterThan(3.5), () => {
          // Szczęka: obrót wokół osi x (wzdłuż kontenera) przez zawias; rozwarcie z (1 − g) i złożenia.
          const s = select(part.lessThan(4.5), float(1.0), float(-1.0));
          const rPay = CT.element(cb.add(CR.PAYLOAD));
          const rParts = CT.element(cb.add(CR.PARTS));
          const hy = rPay.w.mul(0.62).mul(s);
          const hz = rParts.x.mul(-0.47);
          // Złożone ramię — szczęki zamknięte (obrys pustego drona w obrysie warstwy); rozwierają się
          // z rozłożeniem, zaciskają przy chwycie.
          const open = float(1.0).sub(g).mul(0.62).mul(smoothstep(0.15, 0.6, e)).mul(s);
          const c = cos(open);
          const sn = sin(open);
          const ry = q.y.sub(hy);
          const rz = q.z.sub(hz);
          q.assign(vec3(q.x, hy.add(ry.mul(c)).sub(rz.mul(sn)), hz.add(ry.mul(sn)).add(rz.mul(c))));
          n.assign(vec3(n.x, n.y.mul(c).sub(n.z.mul(sn)), n.y.mul(sn).add(n.z.mul(c))));
        });
      });
      lp.assign(O.add(X.mul(q.x)).add(Y.mul(q.y)).add(Z.mul(q.z)));
      nl.assign(X.mul(n.x).add(Y.mul(n.y)).add(Z.mul(n.z)));
    });
    const c = cos(pose.w);
    const s = sin(pose.w);
    const wp = pose.xyz.add(rotZ(lp, c, s)).toVar();
    // Niewidoczny dron (INFO.w = 0): trójkąty zwinięte w punkt.
    If(info.w.lessThan(0.5), () => { wp.assign(pose.xyz); });
    vN.assign(rotZ(nl, c, s));
    vW.assign(wp);
    vL.assign(look);
    vI.assign(vec4(info.x, info.y, info.z, attribute('aMat', 'float')));
    vU.assign(lp);
    return wp;
  })();
  m.fragmentNode = Fn(() => {
    const mi = int(vI.w.add(0.5)).toVar();
    const albedo = PAL.element(mi).rgb.toVar();
    const Nw = normalize(vN).toVar();
    const specK = float(0.55).toVar();
    const specPow = float(26.0).toVar();
    const emis = vec3(0.0).toVar();
    const look = vL;
    If(mi.equal(int(SWARM_DRONE_MAT.HULL)).or(mi.equal(int(SWARM_DRONE_MAT.PANEL))), () => {
      // Panele ceramiki: delikatne szwy i rozrzut odcienia (z ziarna drona).
      const cbI = int(vI.x).mul(SWARM_CLASS_ROWS);
      const bodyL = swarmClassTable().element(cbI.add(CR.BODY)).x;
      const cell = max(bodyL.mul(0.09), 0.3);
      const pq = vU.xy.div(cell);
      const seam = smoothstep(0.42, 0.5, abs(fract(pq.x).sub(0.5))).mul(0.12);
      albedo.mulAssign(float(1.0).sub(seam));
      albedo.mulAssign(cargoHash(floor(pq).add(vI.y.mul(17.0))).mul(0.08).add(0.95));
      specK.assign(0.9); specPow.assign(40.0);
    }).ElseIf(mi.equal(int(SWARM_DRONE_MAT.STEEL)), () => {
      specK.assign(1.2); specPow.assign(48.0);
    }).ElseIf(mi.equal(int(SWARM_DRONE_MAT.GLASS)), () => {
      specK.assign(2.2); specPow.assign(80.0);
    }).ElseIf(mi.equal(int(SWARM_DRONE_MAT.E_STATUS)), () => {
      const st = STC.element(int(look.w.add(0.5)));
      // Puls listwy (wolny przy czekaniu, szybki przy chwycie).
      const pulse = select(look.w.greaterThan(3.5), sin(SWARM_LOOK.time.mul(9.0).add(vI.y.mul(20.0))).mul(0.35).add(0.75), float(1.0));
      emis.assign(st.rgb.mul(st.w).mul(pulse).mul(SWARM_LOOK.statusGain));
      albedo.assign(vec3(0.02));
    }).ElseIf(mi.equal(int(SWARM_DRONE_MAT.E_ENGINE)), () => {
      emis.assign(vec3(0.42, 0.68, 1.0).mul(look.z.mul(4.2).add(0.25)).mul(SWARM_LOOK.engineGain));
      albedo.assign(vec3(0.02));
    }).ElseIf(mi.equal(int(SWARM_DRONE_MAT.E_VISOR)), () => {
      emis.assign(vec3(0.25, 0.85, 1.0).mul(1.7));
      albedo.assign(vec3(0.02));
    }).ElseIf(mi.equal(int(SWARM_DRONE_MAT.E_WINDOW)), () => {
      emis.assign(vec3(1.0, 0.84, 0.6).mul(1.5));
      albedo.assign(vec3(0.03));
    }).ElseIf(mi.equal(int(SWARM_DRONE_MAT.E_CLAW)), () => {
      emis.assign(mix(vec3(1.0, 0.55, 0.1), vec3(0.25, 1.0, 0.42), look.y).mul(look.x.mul(2.4).add(0.15)));
      albedo.assign(vec3(0.02));
    });
    const col = vec3(0.0).toVar();
    const bay = vI.z;
    If(bay.greaterThan(-0.5), () => {
      const rec = bayRecord(int(bay.add(0.5)));
      const P = bayToLocal(rec, vW).toVar();
      const Nl = dirToLocal(rec, Nw).toVar();
      const vis = bayRimVisibility(P, dirToLocal(rec, CARGO_LIGHT.shadowDir), rec.r1.x, rec.r2.x);
      const lamp = bayLampLight(rec, P, Nl).add(bayFillLight(rec, P, Nl));
      col.assign(cargoShade(albedo, Nl, dirToLocal(rec, CARGO_LIGHT.sunDir), vis, bayAmbientOcclusion(rec, P), lamp, specK, specPow));
    }).Else(() => {
      col.assign(cargoShade(albedo, Nw, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), specK, specPow));
    });
    return vec4(cargoSurfaceCap(col).add(emis), 1.0);
  })();
  return m;
}

/**
 * Bryły dronów: po dwie siatki (LOD hi / lo) na klasę, wspólny materiał (klony z uBase).
 * setRanges(ranges) — [{ classIndex, base, count }]; setLod(pxPerUnit) — przełącza LOD wg
 * rozmiaru kontenera klasy na ekranie.
 */
export class SwarmDroneMeshes {
  constructor(scene, dronesNode, geometries) {
    this.template = swarmDroneMaterial(dronesNode);
    this.meshes = [];
    for (const cls of SWARM_DRONE_CLASS_LIST) {
      const g = geometries[cls.id];
      const entry = { cls, base: 0, count: 0, lod: 'hi', meshes: {} };
      for (const lod of ['hi', 'lo']) {
        const src = g[lod];
        const geo = new THREE.InstancedBufferGeometry();
        for (const name of ['position', 'normal', 'aMat', 'aRig']) geo.setAttribute(name, src.getAttribute(name));
        geo.setIndex(src.getIndex());
        geo.instanceCount = 0;
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
        const mat = this.template.clone();
        mat.uniforms = { uBase: { value: 0 } };
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `Roj:drony:${cls.id}:${lod}`;
        mesh.frustumCulled = false;
        mesh.renderOrder = SWARM_DRONE_RENDER_ORDER;
        mesh.visible = false;
        scene.add(mesh);
        entry.meshes[lod] = mesh;
      }
      this.meshes.push(entry);
    }
  }

  setRanges(ranges) {
    for (const e of this.meshes) { e.base = 0; e.count = 0; }
    for (const r of ranges) {
      const e = this.meshes[r.classIndex];
      if (!e) continue;
      e.base = r.base;
      e.count = r.count;
    }
    this._apply();
  }

  /** LOD: kontener klasy krótszy niż ~22 px na ekranie → 'lo'. */
  setLod(pxPerUnit, force = null) {
    for (const e of this.meshes) e.lod = force || (e.cls.payload.L * pxPerUnit < 22 ? 'lo' : 'hi');
    this._apply();
  }

  _apply() {
    for (const e of this.meshes) {
      for (const lod of ['hi', 'lo']) {
        const mesh = e.meshes[lod];
        const on = e.count > 0 && e.lod === lod;
        mesh.visible = on;
        mesh.geometry.instanceCount = on ? e.count : 0;
        mesh.material.uniforms.uBase.value = e.base;
      }
    }
  }

  /** Siatki do rozgrzewki pipeline'ów (wszystkie warianty). */
  warmupMeshes() { return this.meshes.flatMap((e) => [e.meshes.hi, e.meshes.lo]); }
}

// ---------------------------------------------------------------------------
// Światła dronów (billboardy addytywne, z bufora symulacji)
// ---------------------------------------------------------------------------

/**
 * Światła: 22 na drona — pozycyjne (czerwone lewe, zielone prawe), stroboskop, stan, 4 dysze,
 * 4 bloki RCS (błysk przy przyspieszaniu w bok / hamowaniu), do 10 lampek chwytaków (przy
 * rozłożonych ramionach). Nieaktywne światło — kwad zwinięty.
 */
export function swarmLightMaterial(dronesNode) {
  const CT = swarmClassTable();
  const STC = statusNode();
  const V = CARGO_LIGHT_VIEW;
  const m = new THREE.NodeMaterial();
  m.name = 'Roj:swiatla';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.premultipliedAlpha = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.forceSinglePass = true;
  const uBase = perObject('uBase', 'uint', 0);
  const vQ = varyingProperty('vec2', 'vRlQ');
  const vC = varyingProperty('vec4', 'vRlC');
  m.positionNode = Fn(() => {
    const li = instanceIndex;
    const di = uBase.add(li.div(uint(SWARM_LIGHTS_PER_DRONE)));
    const kind = int(li.sub(li.div(uint(SWARM_LIGHTS_PER_DRONE)).mul(uint(SWARM_LIGHTS_PER_DRONE))));
    const b = di.mul(uint(DV));
    const pose = dronesNode.element(b.add(uint(DR.POSE)));
    const look = dronesNode.element(b.add(uint(DR.LOOK)));
    const info = dronesNode.element(b.add(uint(DR.INFO)));
    const motion = dronesNode.element(b.add(uint(DR.MOTION)));
    const cb = int(info.x).mul(SWARM_CLASS_ROWS);
    const lp = vec3(0.0).toVar();
    const radius = float(0.0).toVar();
    const color = vec3(0.0).toVar();
    const shape = float(0.0).toVar();
    const c = cos(pose.w);
    const s = sin(pose.w);
    const t = SWARM_LOOK.time;
    const seed = info.y;
    const rParts = CT.element(cb.add(CR.PARTS));
    If(kind.lessThan(int(SWARM_LIGHT_SLOT.ENGINE)), () => {
      const row = CT.element(cb.add(CR.LIGHTS).add(kind));
      lp.assign(row.xyz);
      radius.assign(row.w);
      If(kind.equal(int(SWARM_LIGHT_SLOT.NAV_L)), () => { color.assign(vec3(1.0, 0.12, 0.07).mul(4.0)); })
        .ElseIf(kind.equal(int(SWARM_LIGHT_SLOT.NAV_R)), () => { color.assign(vec3(0.1, 1.0, 0.32).mul(4.0)); })
        .ElseIf(kind.equal(int(SWARM_LIGHT_SLOT.STROBE)), () => {
          const ph = fract(t.mul(0.85).add(seed.mul(7.3)));
          color.assign(vec3(0.95, 0.97, 1.0).mul(select(ph.lessThan(0.07), float(6.0), float(0.0))));
          radius.mulAssign(1.4);
        })
        .Else(() => {
          const st = STC.element(int(look.w.add(0.5)));
          color.assign(st.rgb.mul(st.w).mul(0.9));
          radius.mulAssign(1.2);
          shape.assign(1.0);
        });
    }).ElseIf(kind.lessThan(int(SWARM_LIGHT_SLOT.RCS)), () => {
      const k = kind.sub(int(SWARM_LIGHT_SLOT.ENGINE));
      const row = CT.element(cb.add(CR.LIGHTS).add(kind));
      lp.assign(row.xyz);
      const on = select(k.lessThan(int(rParts.y.add(0.5))), float(1.0), float(0.0));
      const pw = look.z.mul(on);
      radius.assign(row.w.mul(pw.mul(0.9).add(0.5)));
      color.assign(vec3(0.42, 0.68, 1.0).mul(pw.mul(3.6).add(0.12).mul(on)));
      shape.assign(1.0);
    }).ElseIf(kind.lessThan(int(SWARM_LIGHT_SLOT.RCS + 4)), () => {
      const row = CT.element(cb.add(CR.LIGHTS).add(kind));
      lp.assign(row.xyz);
      // Przyspieszenie w układzie drona: blok po stronie przeciwnej wypycha w kierunku ruchu.
      const ax = motion.x.mul(c).add(motion.y.mul(s));
      const ay = motion.y.mul(c).sub(motion.x.mul(s));
      const aMax = max(CT.element(cb.add(CR.FLIGHT)).y, 1.0);
      const dirL = vec2(row.x, row.y);
      const w = dot(normalize(dirL), vec2(ax, ay)).negate().div(aMax).sub(0.15);
      const pw = clamp01(w.mul(1.6));
      radius.assign(row.w.mul(pw.mul(1.2).add(0.4)));
      color.assign(vec3(0.55, 0.8, 1.0).mul(pw.mul(2.6)));
      shape.assign(1.0);
    }).Else(() => {
      // Lampka chwytaka: na zewnętrznej burcie słupka (bursztyn otwarty → zieleń zaciśnięty).
      const k = kind.sub(int(SWARM_LIGHT_SLOT.RCS + 4));
      const A = swarmArmNodes(CT, cb, k, look.x);
      const rPay = CT.element(cb.add(CR.PAYLOAD));
      const outward = select(A.S.y.greaterThan(0.0), float(1.0), float(-1.0));
      lp.assign(A.W.add(vec3(0.0, outward.mul(rPay.w.mul(0.5)), rParts.x.mul(-0.2))));
      const on = select(k.lessThan(int(rParts.z.add(0.5))), float(1.0), float(0.0)).mul(smoothstep(0.35, 0.8, look.x));
      radius.assign(rPay.w.mul(0.55));
      color.assign(mix(vec3(1.0, 0.55, 0.1), vec3(0.25, 1.0, 0.42), look.y).mul(on.mul(2.6)));
    });
    const center = pose.xyz.add(rotZ(lp, c, s));
    const q = positionGeometry.xy.mul(2.0);
    vQ.assign(q);
    vC.assign(vec4(color, shape));
    const lum = color.x.add(color.y).add(color.z);
    const r = select(lum.greaterThan(0.004).and(info.w.greaterThan(0.5)), max(radius, V.minPx.div(max(V.pxPerUnit, 1e-4))), float(0.0));
    return center.add(V.right.mul(q.x).add(V.up.mul(q.y)).mul(r.mul(2.0)));
  })();
  m.fragmentNode = Fn(() => {
    const d = length(vQ);
    const core = select(vC.w.greaterThan(0.5), exp(d.mul(d).mul(-9.0)), float(1.0).sub(smoothstep(0.12, 0.22, d)));
    const halo = select(vC.w.greaterThan(0.5), exp(d.mul(d).mul(-3.0)).mul(0.25),
      max(float(1.0).sub(d), 0.0).mul(max(float(1.0).sub(d), 0.0)).mul(float(1.0).sub(core)));
    const edge = float(1.0).sub(smoothstep(0.85, 1.0, d));
    const col = vC.rgb.mul(core.add(halo.mul(V.halo))).mul(edge);
    return vec4(col, max(max(col.r, col.g), col.b));
  })();
  return m;
}

function clamp01(x) { return min(max(x, 0.0), 1.0); }

export class SwarmDroneLights {
  constructor(scene, dronesNode) {
    const plane = new THREE.PlaneGeometry(1, 1);
    this.template = swarmLightMaterial(dronesNode);
    this.meshes = [];
    for (const cls of SWARM_DRONE_CLASS_LIST) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', plane.getAttribute('position'));
      geo.setIndex(plane.getIndex());
      geo.instanceCount = 0;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mat = this.template.clone();
      mat.uniforms = { uBase: { value: 0 } };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `Roj:swiatla:${cls.id}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 60;
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push({ cls, mesh });
    }
  }

  setRanges(ranges) {
    for (const e of this.meshes) { e.mesh.visible = false; e.mesh.geometry.instanceCount = 0; }
    for (const r of ranges) {
      const e = this.meshes[r.classIndex];
      if (!e || !r.count) continue;
      e.mesh.visible = true;
      e.mesh.geometry.instanceCount = r.count * SWARM_LIGHTS_PER_DRONE;
      e.mesh.material.uniforms.uBase.value = r.base;
    }
  }

  warmupMeshes() { return this.meshes.map((e) => e.mesh); }
}
