// src/3d/rockets/ringUpload.js
//
// Wysyłka pierścienia instancji (iskry, łuki — port WebGPU, zadanie 19): zakresy uploadu
// NA STAŁE (dwa obiekty na atrybut, bez alokacji na klatkę), wysyłany tylko wycinek zapisany
// od ostatniej wysyłki. Zawinięcie pierścienia = DWA wycinki (koniec bufora + początek),
// nie cały bufor (dawne RocketFireGPU/RocketSmokeGPU: tests/renderBugfixGuards). Przeskok
// początku pul / epok przesuwa żywe dane na CPU — wtedy jeden zakres [0, highWater).
// Drugi zakres bez danych ma count = 0 (writeBuffer o rozmiarze 0 jest w WebGPU poprawny).

import * as THREE from 'three/webgpu';

/** Atrybut instancji pierścienia z dwoma stałymi zakresami uploadu. */
export function ringAttr(capacity, itemSize) {
  const at = new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
  at.setUsage(THREE.DynamicDrawUsage);
  at.updateRanges.length = 0;
  at.updateRanges.push({ start: 0, count: 0 }, { start: 0, count: 0 });
  // three czyści zakresy po wysyłce — tu zostają (przepisywane przed każdą wysyłką).
  at.clearUpdateRanges = () => {};
  return at;
}

export class RingUpload {
  constructor(capacity) {
    this.capacity = capacity;
    this.start = 0;     // pierwszy indeks zapisany od ostatniej wysyłki
    this.count = 0;     // ile kolejnych indeksów (mod capacity) zapisano
    this.all = false;   // przeskok: wyślij [0, highWater)
  }

  /** Zapis indeksu i — pierścień pisze kolejne indeksy (head + 1 mod capacity). */
  touch(i) {
    if (this.count === 0) this.start = i;
    this.count++;
  }

  /** Żywe dane przesunięte w miejscu (przeskok początku / epok). */
  markAll() {
    this.all = true;
  }

  reset() {
    this.count = 0;
    this.all = false;
  }

  /** Ustawia zakresy atrybutów i needsUpdate; false, gdy nie ma czego wysyłać. */
  flush(attrs, highWater) {
    const cap = this.capacity;
    let s0 = 0;
    let n0 = 0;
    let n1 = 0;
    if (this.all || this.count >= cap) {
      n0 = this.count >= cap ? cap : highWater;
    } else if (this.count > 0) {
      s0 = this.start;
      n0 = this.count;
      const over = s0 + n0 - cap;
      if (over > 0) { n0 = cap - s0; n1 = over; }
    } else {
      return false;
    }
    for (let k = 0; k < attrs.length; k++) {
      const at = attrs[k];
      const size = at.itemSize;
      const r = at.updateRanges;
      r[0].start = s0 * size; r[0].count = n0 * size;
      r[1].start = 0; r[1].count = n1 * size;
      at.needsUpdate = true;
    }
    this.count = 0;
    this.all = false;
    return true;
  }
}
