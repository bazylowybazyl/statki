// src/effects3d/particlePool.js
//
// Księgowość pul cząstek GPU wybuchu reaktora (reactorblow.js) — pierścień slotów z ruchem
// analitycznym w wierzchołkach (cząstka = zapis przy narodzinach, bez stanu na GPU):
//
//   1. rysujemy tylko [0, highWater) — pula 100 000 slotów nie mieli instancji, których nie
//      zapisano; bezczynna pula (wszystkie cząstki martwe) jest ukryta i wraca na start
//      (kolejny wybuch zajmuje od zera tyle slotów, ile potrzebuje);
//   2. wysyłamy tylko zapisany wycinek pierścienia: zakresy uploadu NA STAŁE (dwa obiekty na
//      atrybut — drugi dla zawinięcia pierścienia; bez alokacji na klatkę: three czyści
//      `updateRanges` po wysyłce, a ponowne `addUpdateRange` alokuje), domyślne użycie bufora
//      (StaticDraw + needsUpdate — `DynamicDrawUsage` w r183 wysyła bufor przy KAŻDYM renderze);
//   3. wycinek jest skumulowany do POTWIERDZENIA wysyłki: three woła `clearUpdateRanges()` zaraz
//      po zapisie atrybutu (tu podmienione na licznik), więc zapis z klatki, w której siatki nie
//      narysowano (pass wyłączony, izolacja warstw), dołącza do następnej wysyłki zamiast przepaść;
//   4. zegar (`timeUniform`) biegnie, dopóki żyje najdłuższa cząstka (`liveUntil`) — efekty
//      kończą się przed zgaśnięciem swoich iskier (życie do 4 s przy wybuchu trwającym 3 s).
//
// Port WebGPU (zadanie 20): dawniej pule overlaya (`flushParticlePools` z ticku overlaya).

const pools = new Set();

export class ParticlePool {
  /**
   * @param {object}   opts
   *   mesh        — THREE.Mesh z InstancedBufferGeometry
   *   attributes  — atrybuty instancji zapisywane przy narodzinach (InstancedBufferAttribute)
   *   capacity    — liczba slotów
   *   timeUniform — węzeł uniform ({ value }) z czasem cząstek (opcjonalny)
   */
  constructor({ mesh, attributes, capacity, timeUniform = null, name = '' }) {
    this.mesh = mesh;
    this.attributes = Array.isArray(attributes) ? attributes.filter(Boolean) : [];
    this.capacity = Math.max(1, capacity | 0);
    this.timeUniform = timeUniform;
    this.name = name;

    this.cursor = 0;
    this.highWater = 0;
    this.liveUntil = -Infinity;
    // Wycinek pierścienia zapisany od ostatniej POTWIERDZONEJ wysyłki (ciągły w kolejności slotów).
    this.pendStart = 0;
    this.pendCount = 0;
    // Ile atrybutów czeka na potwierdzenie wysyłki (clearUpdateRanges z three) i ile slotów
    // objęła zaznaczona wysyłka (zapisy PO zaznaczeniu zostają w wycinku).
    this.awaiting = 0;
    this.markedCount = 0;
    this.stats = { uploads: 0, uploadedSlots: 0 };

    const self = this;
    const confirm = function confirmUpload() {
      if (self.awaiting > 0 && --self.awaiting === 0) self._confirmed();
    };
    for (const attr of this.attributes) {
      attr.updateRanges.length = 0;
      attr.updateRanges.push({ start: 0, count: 0 }, { start: 0, count: 0 });
      // three czyści zakresy zaraz po zapisie atrybutu — tu zostają (przepisywane przed każdą
      // wysyłką), a wywołanie potwierdza wysyłkę.
      attr.clearUpdateRanges = confirm;
    }

    if (mesh) {
      mesh.visible = false;
      if (mesh.geometry) mesh.geometry.instanceCount = 0;
    }
    pools.add(this);
  }

  /** Bezczynna (nic nie zapisano od ostatniego wygaśnięcia) — kolejny wybuch może przestawić początek puli. */
  get idle() {
    return this.highWater === 0;
  }

  /** Kolejny slot pierścienia (dopisany do wycinka do wysyłki). */
  next() {
    const i = this.cursor;
    this.cursor = i + 1 < this.capacity ? i + 1 : 0;
    if (i + 1 > this.highWater) this.highWater = i + 1;
    if (this.pendCount === 0) this.pendStart = i;
    if (this.pendCount < this.capacity) this.pendCount++;
    return i;
  }

  /** Do kiedy pula ma być rysowana i mieć bieżący zegar. */
  keepAlive(untilTime) {
    if (untilTime > this.liveUntil) this.liveUntil = untilTime;
  }

  /**
   * Raz na klatkę (przed passem, który rysuje siatkę): zakresy wysyłki zapisanego wycinka,
   * zegar, widoczność, instanceCount.
   * @returns {boolean} czy pula ma jeszcze żywe cząstki
   */
  flush(nowSec) {
    const live = nowSec < this.liveUntil;
    const mesh = this.mesh;
    const geo = mesh ? mesh.geometry : null;
    if (!live) {
      if (this.highWater !== 0) {
        this.highWater = 0;
        this.cursor = 0;
        this.pendCount = 0;
        this.awaiting = 0;
        this.markedCount = 0;
        if (geo) geo.instanceCount = 0;
      }
      if (mesh && mesh.visible) mesh.visible = false;
      return false;
    }
    if (this.pendCount > 0) this._markUpload();
    if (this.timeUniform) this.timeUniform.value = nowSec;
    if (mesh && !mesh.visible) mesh.visible = true;
    if (geo && geo.instanceCount !== this.highWater) geo.instanceCount = this.highWater;
    return true;
  }

  _markUpload() {
    const cap = this.capacity;
    let s0 = this.pendStart;
    let n0 = this.pendCount;
    let n1 = 0;
    if (n0 >= cap) {
      s0 = 0;
      n0 = cap;
    } else if (s0 + n0 > cap) {
      n1 = s0 + n0 - cap;
      n0 = cap - s0;
    }
    const attrs = this.attributes;
    for (let k = 0; k < attrs.length; k++) {
      const at = attrs[k];
      const size = at.itemSize;
      const r = at.updateRanges;
      r[0].start = s0 * size; r[0].count = n0 * size;
      r[1].start = 0; r[1].count = n1 * size;
      at.needsUpdate = true;
    }
    this.awaiting = attrs.length;
    this.markedCount = this.pendCount;
    this.stats.uploads++;
    this.stats.uploadedSlots += n0 + n1;
  }

  // Wysyłka potwierdzona (wszystkie atrybuty): z wycinka schodzi to, co objęło zaznaczenie.
  _confirmed() {
    const done = Math.min(this.markedCount, this.pendCount);
    this.markedCount = 0;
    if (done >= this.pendCount) {
      this.pendCount = 0;
      return;
    }
    this.pendStart = (this.pendStart + done) % this.capacity;
    this.pendCount -= done;
  }

  dispose() {
    pools.delete(this);
    this.mesh = null;
    this.attributes.length = 0;
    this.timeUniform = null;
  }
}

/** Statystyki wszystkich pul (PerfHUD / konsola). */
export function getParticlePoolStats() {
  let live = 0;
  let instances = 0;
  for (const pool of pools) {
    if (pool.mesh?.visible) { live++; instances += pool.highWater; }
  }
  return { pools: pools.size, livePools: live, liveInstances: instances };
}
