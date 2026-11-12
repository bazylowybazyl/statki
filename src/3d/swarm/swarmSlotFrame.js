// src/3d/swarm/swarmSlotFrame.js
//
// SLOTY STANOWISK W JEDNEJ SYMULACJI ROJU (E12 — rój z dema w grze, src/3d/swarm/swarmBerthPool.js). Symulacja GPU
// (swarmSim.js) liczy wszystkie stanowiska w JEDNEJ przestrzeni „slotów”: stanowisko k leży w swoim prostokącie tej
// przestrzeni (oś statku wzdłuż x — bez obrotu, liczby małe, float32 bez drżenia), drony, kontenery i kolumny slotu
// zajmują stałe zakresy buforów. Obraz przenosi slot na świat transformacją z tablicy uniformów (wiersz na slot:
// przesunięcie względem początku przy kamerze i obrót) — w wierzchołku drona, świateł i kontenerów. Demo (jeden port,
// przestrzeń = świat sceny) materiałów bez ramy nie zmienia.
//
// Wiersz slotu k: (tx, ty, φ, 0) — punkt slotu p ↦ R(φ)·p + (tx, ty), kurs + φ.
import * as THREE from 'three/webgpu';
import { cos, sin, uint, uniformArray, vec3 } from 'three/tsl';

/** Rama slotów: rows (Vector4 na slot), węzeł tablicy (stała nazwa bloku — jeden WGSL), zakresy na slot. */
export function createSwarmSlotFrames(slots, dronesPerSlot, unitsPerSlot) {
  const rows = Array.from({ length: slots }, () => new THREE.Vector4(0, 0, 0, 0));
  const node = uniformArray(rows, 'vec4').setName('swarmSlotFrames');
  return { rows, node, slots, dronesPerSlot, unitsPerSlot };
}

/** Wiersz ramy dla indeksu drona / jednostki (uint) przy `perSlot` na slot. */
export function slotFrameRow(frame, index, perSlot) {
  return frame.node.element(index.div(uint(perSlot)));
}

/** Punkt slotu → świat (względem początku przy kamerze). fr — wiersz ramy (vec4), p — vec3. */
export function slotFrameApply(fr, p) {
  const c = cos(fr.z);
  const s = sin(fr.z);
  return vec3(fr.x.add(p.x.mul(c)).sub(p.y.mul(s)), fr.y.add(p.x.mul(s)).add(p.y.mul(c)), p.z);
}

/** Kierunek slotu → świat (obrót bez przesunięcia). */
export function slotFrameRotate(fr, v) {
  const c = cos(fr.z);
  const s = sin(fr.z);
  return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);
}
