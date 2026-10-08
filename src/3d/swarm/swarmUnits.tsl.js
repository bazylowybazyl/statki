// src/3d/swarm/swarmUnits.tsl.js
//
// KONTENERY ROJU I CIENIE (TSL, WebGPU) — z bufora symulacji (swarmSim.js), bez wysyłki z CPU
// co klatkę. Kontener: wygląd i światło jak ładunek ładowni (src/3d/cargo/containers.tsl.js —
// ten sam graf, poza ze źródła zewnętrznego), instancje statyczne na scenę (jednostka, wymiary,
// barwy z containerLookLinear), poza i ładownia światła z rekordu jednostki. Jednostka = JEDEN
// kontener standardowy 16 × 8 × 8 (decyzja użytkownika 2026-10-06 — megakontenerów nie ma; dron
// niesie warstwę płasko, każdy kontener ma swoją pozę: hak + obrót × miejsce w chwycie).
//
// CIENIE (materiały z src/3d/cargo/shadows.tsl.js, źródło zewnętrzne):
//   • dron (z kontenerem pod hakiem) na kadłubie / pokładzie — prostokąt obrysu przeciągnięty
//     wzdłuż „słońca cieni” (GREATER — tylko tam, gdzie kadłub zapisał głębię);
//   • kontakt — miękka obwódka podstawy kontenera stojącego (ładownia, plac).
import * as THREE from 'three/webgpu';
import { attribute, cos, float, instanceIndex, int, max, select, sin, uint, uniform, vec4 } from 'three/tsl';
import { CONTAINER_RENDER_ORDER, buildCargoContainerMaterial, buildContainerGeometry, containerLookLinear } from '../cargo/containers.tsl.js';
import { buildCargoContactShadowMaterial, buildCargoHullShadowMaterial } from '../cargo/shadows.tsl.js';
import { CARGO_CONTAINER } from '../../data/cargoBays.js';
import { SWARM_DRONE, SWARM_DRONE_VEC4, SWARM_UNIT, SWARM_UNIT_VEC4 } from '../../game/swarm/swarmPort.js';
import { SWARM_CLASS_ROW, SWARM_CLASS_ROWS, swarmClassTable } from './swarmClassTable.js';

const UNIT_FLOATS = 20; // iUnitOff (jednostka, a, b, z), iSize (L, W, H, —), iPaint, iAccent, iFrame
const UV = SWARM_UNIT_VEC4;
const DV = SWARM_DRONE_VEC4;
const CR = SWARM_CLASS_ROW;

function keepRanges() {}

export class SwarmUnits {
  /** unitsNode — bufor jednostek symulacji; capacity — najwięcej instancji (kontenerów do narysowania). */
  constructor(scene, unitsNode, capacity = 65536) {
    this.capacity = capacity;
    this.unitsNode = unitsNode;
    const base = buildContainerGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.setAttribute('aBevel', base.getAttribute('aBevel'));
    geo.setIndex(base.getIndex());
    this.data = new Float32Array(capacity * UNIT_FLOATS);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, UNIT_FLOATS, 1);
    this.range = { start: 0, count: this.data.length };
    this.buffer.updateRanges.length = 0;
    this.buffer.updateRanges.push(this.range);
    this.buffer.clearUpdateRanges = keepRanges;
    geo.setAttribute('iUnitOff', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    geo.setAttribute('iSize', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    geo.setAttribute('iPaint', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    geo.setAttribute('iAccent', new THREE.InterleavedBufferAttribute(this.buffer, 4, 12));
    geo.setAttribute('iFrame', new THREE.InterleavedBufferAttribute(this.buffer, 4, 16));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geometry = geo;
    const U = unitsNode;
    this.material = buildCargoContainerMaterial({
      name: 'Roj:kontenery',
      pose: () => {
        const uo = attribute('iUnitOff', 'vec4');
        const sz = attribute('iSize', 'vec4');
        const ub = uint(int(uo.x)).mul(uint(UV));
        const up = U.element(ub.add(uint(SWARM_UNIT.POSE)));
        const ui = U.element(ub.add(uint(SWARM_UNIT.INFO)));
        const c = cos(up.w);
        const s = sin(up.w);
        const pos = vec4(up.x.add(uo.y.mul(c)).sub(uo.z.mul(s)), up.y.add(uo.y.mul(s)).add(uo.z.mul(c)), up.z.add(uo.w), up.w);
        return { pos, size: vec4(sz.xyz, ui.x), visible: ui.y };
      }
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'Roj:kontenery';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = CONTAINER_RENDER_ORDER;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.count = 0;
    this.units = [];
  }

  /** Kontenery sceny: [{ resource, seed }] (indeks = numer jednostki w buforze symulacji). */
  build(units) {
    this.units = units;
    const C = CARGO_CONTAINER;
    const d = this.data;
    let n = 0;
    for (let u = 0; u < units.length && n < this.capacity; u++) {
      const un = units[u];
      const o = n * UNIT_FLOATS;
      d[o] = u; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0;
      d[o + 4] = C.L; d[o + 5] = C.W; d[o + 6] = C.H; d[o + 7] = 0;
      d.set(containerLookLinear(un.resource, un.seed, 0), o + 8);
      n++;
    }
    this.count = n;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    this.range.count = Math.max(1, n) * UNIT_FLOATS;
    this.buffer.needsUpdate = true;
  }
}

/**
 * Cienie roju: drony z ładunkiem na kadłubie / pokładzie (jeden prostokąt na drona) i kontakt
 * kontenerów stojących (jeden na jednostkę). Liczba instancji — liczba dronów / jednostek sceny.
 */
export class SwarmShadows {
  constructor(scene, dronesNode, unitsNode) {
    const CT = swarmClassTable();
    this.strength = uniform(0.5);
    const S = this.strength;
    const plane = new THREE.PlaneGeometry(1, 1);
    // Dron: obrys pusty (półosie z tablicy) albo kontener; od dołu kontenera do wierzchu kadłuba.
    const hullMat = buildCargoHullShadowMaterial({
      name: 'Roj:cienDronow',
      attrs: () => {
        const b = instanceIndex.mul(uint(DV));
        const pose = dronesNode.element(b.add(uint(SWARM_DRONE.POSE)));
        const info = dronesNode.element(b.add(uint(SWARM_DRONE.INFO)));
        const aux = dronesNode.element(b.add(uint(SWARM_DRONE.AUX)));
        const cb = int(info.x).mul(SWARM_CLASS_ROWS);
        const rPay = CT.element(cb.add(CR.PAYLOAD));
        const rBody = CT.element(cb.add(CR.BODY));
        const rFoot = CT.element(cb.add(CR.FOOT_EMPTY));
        const loaded = aux.x.greaterThan(-0.5);
        const L = select(loaded, rPay.x, rFoot.x.mul(2.0));
        const W = select(loaded, rPay.y, rFoot.y.mul(2.0));
        const z0 = select(loaded, pose.z.sub(rPay.z), pose.z.add(rBody.w));
        const z1 = pose.z.add(rBody.w).add(rBody.z);
        // Siła maleje z wysokością (miękki, jaśniejszy cień wysoko), zero w ładowni i w gnieździe.
        const k = max(float(0.0), float(1.0).sub(z0.div(260.0))).mul(S).mul(select(z1.greaterThan(0.5).and(info.w.greaterThan(0.5)), float(1.0), float(0.0)));
        return { a: vec4(pose.x, pose.y, pose.w, k), b: vec4(L, W, max(z0, 0.0), z1) };
      }
    });
    const contactMat = buildCargoContactShadowMaterial({
      name: 'Roj:cienKontaktu',
      attrs: () => {
        const ub = instanceIndex.mul(uint(UV));
        const up = unitsNode.element(ub.add(uint(SWARM_UNIT.POSE)));
        const ui = unitsNode.element(ub.add(uint(SWARM_UNIT.INFO)));
        const k = select(ui.z.lessThan(-0.5).and(ui.y.greaterThan(0.5)), float(0.55), float(0.0));
        return { a: vec4(up.x, up.y, up.w, k), b: vec4(CARGO_CONTAINER.L, CARGO_CONTAINER.W, up.z, 1.2) };
      }
    });
    const mk = (mat, name, order) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', plane.getAttribute('position'));
      geo.setIndex(plane.getIndex());
      geo.instanceCount = 0;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    };
    this.drones = mk(hullMat, 'Roj:cienDronow', 10);
    this.contact = mk(contactMat, 'Roj:cienKontaktu', 10.5);
  }

  setCounts(drones, units) {
    this.drones.geometry.instanceCount = drones;
    this.drones.visible = drones > 0;
    this.contact.geometry.instanceCount = units;
    this.contact.visible = units > 0;
  }

  warmupMeshes() { return [this.drones, this.contact]; }
}
