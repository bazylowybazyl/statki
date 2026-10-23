// src/3d/cargo/conveyor.tsl.js
//
// TAŚMOCIĄGI, STOŁY PRZEŁADUNKOWE I PORTALE PLACU (E12 — przeładunek w bańce ruchu, src/game/swarm/berthTransfer.js):
// jedna partia pudeł (Mesh + InstancedBufferGeometry, jeden przepleciony bufor instancji) dla wszystkich stanowisk
// zatok w kadrze. Rodzaj pudła w instancji: 0 — stół (stalowa płyta z bursztynowymi narożnikami pod obrys warstwy),
// 1 — taśma (gumowy pas z poprzecznymi listwami przesuwanymi z zegarem roju, stalowe burty z rolkami),
// 2 — portal w grzbiecie zatoki (ciemny wlot z bursztynową listwą HDR — świeci w bloomie). Pozycje względem początku
// przy kamerze (mesh.position = początek), światło jak ładunek (cargoShade: słońce kadłubów, maska słońca Core3D).
// Pudło: buildLeafGeometry z bay.tsl.js (x, y ∈ [−½, ½], z ∈ [0, 1]; aFace: 0 wierzch, 1 spód, 2 / 3 boki ±y, 4 czoła).
import * as THREE from 'three/webgpu';
import {
  Fn, If, abs, attribute, float, floor, fract, int, max, min, mix, normalize, positionGeometry, select, sin, smoothstep,
  step, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { buildLeafGeometry } from './bay.tsl.js';
import { CARGO_LIGHT, cargoHash, cargoShade, cargoSurfaceCap, smoothDown } from './cargoLight.tsl.js';

export const CONVEYOR_STRIDE = 12;
export const CONVEYOR_KIND = Object.freeze({ TABLE: 0, BELT: 1, PORTAL: 2 });
export const CONVEYOR_RENDER_ORDER = 11.5;

const AMBER = vec3(0.86, 0.46, 0.05);

function buildMaterial() {
  const m = new THREE.NodeMaterial();
  m.name = 'Cargo:tasmy';
  m.lights = false;
  m.fog = false;
  // Kolejka przezroczysta z NoBlending i zapisem głębi — jak kontenery (cienie na kadłubie przed nią).
  m.transparent = true;
  m.blending = THREE.NoBlending;
  m.depthWrite = true;
  m.side = THREE.FrontSide;
  const vU = varyingProperty('vec3', 'vCvU');
  const vN = varyingProperty('vec3', 'vCvN');
  const vFace = varyingProperty('float', 'vCvFace');
  const vDims = varyingProperty('vec4', 'vCvDims');
  const vInfo = varyingProperty('vec4', 'vCvInfo');
  const vRot = varyingProperty('vec4', 'vCvRot');
  m.positionNode = Fn(() => {
    const pose = attribute('iBoxPose', 'vec4');
    const dims = attribute('iBoxDims', 'vec4');
    const g = positionGeometry;
    const lx = g.x.mul(dims.x);
    const ly = g.y.mul(dims.y);
    vU.assign(g);
    vN.assign(attribute('normal', 'vec3'));
    vFace.assign(attribute('aFace', 'float'));
    vDims.assign(dims);
    vInfo.assign(attribute('iBoxInfo', 'vec4'));
    vRot.assign(vec4(pose.z, pose.w, 0.0, 0.0));
    return vec3(pose.x.add(lx.mul(pose.z)).sub(ly.mul(pose.w)), pose.y.add(lx.mul(pose.w)).add(ly.mul(pose.z)), g.z.mul(dims.z).add(dims.w));
  })();
  m.fragmentNode = Fn(() => {
    const u = vU.toVar();
    const L = vDims.x;
    const W = vDims.y;
    const la = u.x.mul(L).toVar();
    const lb = u.y.mul(W).toVar();
    const face = int(vFace.add(0.5)).toVar();
    const kind = int(vInfo.x.add(0.5)).toVar();
    const phase = vInfo.y;
    const seed = vInfo.z;
    const N = normalize(vN).toVar();
    const albedo = vec3(0.08, 0.085, 0.095).toVar();
    const emis = vec3(0.0).toVar();
    const specK = float(0.6).toVar();
    const grime = cargoHash(floor(vec2(la, lb).mul(0.5)).add(seed.mul(13.0))).mul(0.18).add(0.9);
    const edgeB = W.mul(0.5).sub(abs(lb)).toVar();
    const edgeA = L.mul(0.5).sub(abs(la)).toVar();
    If(kind.equal(int(1)), () => {
      If(face.equal(int(0)), () => {
        // Pas: listwy poprzeczne co 2,2 j. jadą z zegarem roju (phase = droga taśmy), burty stalowe po bokach.
        const slat = smoothstep(0.42, 0.5, abs(fract(la.sub(phase).div(2.2)).sub(0.5)));
        albedo.assign(mix(vec3(0.03, 0.032, 0.036), vec3(0.075, 0.078, 0.085), slat).mul(grime));
        specK.assign(0.25);
        const rail = smoothDown(1.4, 1.1, edgeB);
        albedo.assign(mix(albedo, vec3(0.14, 0.145, 0.155), rail));
        // Bursztynowe kreski bezpieczeństwa na burtach.
        const dash = step(0.5, fract(la.div(3.0)));
        albedo.assign(mix(albedo, AMBER.mul(0.8), rail.mul(dash).mul(smoothDown(0.55, 0.35, edgeB))));
      }).Else(() => {
        // Burty: stal z rolkami (ciemne okręgi co 2 j.).
        const rq = fract(la.div(2.0)).sub(0.5);
        const roll = smoothDown(0.32, 0.22, abs(rq));
        albedo.assign(vec3(0.09, 0.095, 0.105).mul(float(1.0).sub(roll.mul(0.45))));
        specK.assign(0.9);
      });
    }).ElseIf(kind.equal(int(0)), () => {
      If(face.equal(int(0)), () => {
        // Stół: płyta 4 j. ze szwami, bursztynowe narożniki obrysu warstwy, rolki przesuwu (kierunek taśmy).
        const sd = min(abs(fract(la.div(4.0)).sub(0.5)), abs(fract(lb.div(4.0)).sub(0.5))).mul(4.0);
        albedo.assign(vec3(0.1, 0.104, 0.112).mul(grime).mul(float(1.0).sub(smoothDown(0.12, 0.05, sd).mul(0.35))));
        const corner = step(edgeA, 3.0).mul(step(edgeB, 3.0)).mul(step(0.25, min(edgeA, edgeB)));
        const border = smoothDown(0.7, 0.45, min(edgeA, edgeB));
        albedo.assign(mix(albedo, AMBER, corner.mul(0.9)));
        albedo.mulAssign(float(1.0).sub(border.mul(0.35)));
        specK.assign(0.8);
      }).Else(() => {
        albedo.assign(vec3(0.07, 0.072, 0.08));
      });
    }).Else(() => {
      // Portal: ciemny wlot w grzbiecie, nad nim bursztynowa listwa (HDR > 1 — bloom), światło przechodzi
      // pulsem wolnym jak lampy hal.
      albedo.assign(vec3(0.02, 0.021, 0.024));
      specK.assign(0.4);
      If(face.equal(int(0)), () => {
        const strip = smoothDown(1.6, 1.0, edgeA);
        const pulse = sin(CARGO_LIGHT.time.mul(2.2).add(seed.mul(6.0))).mul(0.15).add(0.85);
        emis.assign(AMBER.mul(strip.mul(pulse).mul(2.4)));
        albedo.assign(mix(albedo, vec3(0.12), smoothDown(0.6, 0.3, edgeB)));
      });
    });
    // Normalna pudła → świat sceny (obrót xy kursem instancji).
    const c = vRot.x;
    const s = vRot.y;
    const Nw = normalize(vec3(N.x.mul(c).sub(N.y.mul(s)), N.x.mul(s).add(N.y.mul(c)), N.z));
    const col = cargoShade(albedo, Nw, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), specK, float(28.0));
    return vec4(cargoSurfaceCap(col).add(emis), 1.0);
  })();
  return m;
}

let _material = null;
export function conveyorMaterial() { return _material || (_material = buildMaterial()); }

/** Partia pudeł placu: begin(origin) → push…() → end(). Pozycje w scenie względem początku. */
export class PortConveyors {
  constructor(scene, capacity = 2048) {
    this.capacity = capacity;
    const base = buildLeafGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'aFace']) geo.setAttribute(name, base.getAttribute(name));
    geo.setIndex(base.getIndex());
    this.data = new Float32Array(capacity * CONVEYOR_STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, CONVEYOR_STRIDE, 1);
    geo.setAttribute('iBoxPose', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    geo.setAttribute('iBoxDims', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    geo.setAttribute('iBoxInfo', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mesh = new THREE.Mesh(geo, conveyorMaterial());
    this.mesh.name = 'Cargo:tasmy';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = CONVEYOR_RENDER_ORDER;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.count = 0;
    this.origin = { x: 0, y: 0 };
  }

  begin(origin) { this.count = 0; this.origin.x = origin.x; this.origin.y = origin.y; }

  /** Pudło: środek (x, y) względem początku, kurs yaw (scena), L × W × H, spód z0, rodzaj, faza taśmy, ziarno. */
  push(x, y, yaw, L, W, H, z0, kind, phase = 0, seed = 0) {
    if (this.count >= this.capacity) return false;
    const o = this.count++ * CONVEYOR_STRIDE;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = Math.cos(yaw); d[o + 3] = Math.sin(yaw);
    d[o + 4] = L; d[o + 5] = W; d[o + 6] = H; d[o + 7] = z0;
    d[o + 8] = kind; d[o + 9] = phase; d[o + 10] = seed; d[o + 11] = 0;
    return true;
  }

  end() {
    const n = this.count;
    this.mesh.position.set(this.origin.x, this.origin.y, 0);
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.buffer.updateRanges.length = 0;
      this.buffer.addUpdateRange(0, n * CONVEYOR_STRIDE);
      this.buffer.needsUpdate = true;
    }
    return n > 0 ? 1 : 0;
  }
}
