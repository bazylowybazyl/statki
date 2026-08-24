// src/effects3d/particlePool.js
//
// Księgowość pul cząstek GPU dla efektów overlaya (reactorblow / yamato /
// supernova). Trzy te pliki miały niezależne kopie tej samej klasy menedżera i
// każda kopia płaciła dwa razy:
//
//   1. `geo.instanceCount = maxParticles` ustawiane RAZ w konstruktorze i nigdy
//      nieobniżane. Siatki wisiały w scenie od startu gry, `frustumCulled=false`,
//      więc karta przemielała ~251 000 instancji (≈1 mln wierzchołków) na każdą
//      klatkę — także wtedy, gdy w grze nie było ani jednej eksplozji. Cząstki
//      odpadały dopiero na klipowaniu (`gl_Position = 9999`), czyli po pełnym
//      koszcie vertex shadera.
//
//   2. Każdy `spawn()` ustawiał `needsUpdate = true` na trzech atrybutach, a to
//      w three znaczy „wgraj CAŁY bufor". Profil `capital` sypie 4000 iskier, co
//      dawało ~4 MB `bufferSubData` w klatce wybuchu. Ring bufor zapisuje ciągły
//      zakres, więc wystarczy wgrać tylko dotknięty wycinek.
//
// Pula pilnuje też `uTime`: dotąd uniform popychały same efekty, a te kasują się
// zanim zgasną ich najdłuższe iskry (życie do 4.0 s przy `explosionDuration`
// 3.0 s). Czas zamarzał i po ostatnim wybuchu na ekranie zostawały nieruchome
// cząstki aż do następnego. Teraz zegar biegnie do `liveUntil`, a potem siatka
// znika ze sceny.

const pools = new Set();

// Powyżej tylu oczekujących zakresów przestaje się opłacać sklejanie —
// wgrywamy cały bufor i zaczynamy od zera.
const MAX_PENDING_RANGES = 8;

export class ParticlePool {
  /**
   * @param {object}   opts
   *   mesh        — THREE.Mesh z InstancedBufferGeometry
   *   attributes  — atrybuty instancji zapisywane w spawnie
   *   capacity    — liczba slotów (maxParticles)
   *   timeUniform — uniform { value } z czasem globalnym (opcjonalny)
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
    this.dirtyLo = -1;
    this.dirtyHi = -1;

    if (mesh) {
      mesh.visible = false;
      if (mesh.geometry) mesh.geometry.instanceCount = 0;
    }
    pools.add(this);
  }

  /** Kolejny slot ring bufora + zapis do zakresu brudnych indeksów. */
  next() {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (i + 1 > this.highWater) this.highWater = i + 1;
    if (this.dirtyLo < 0 || i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
    return i;
  }

  /** Do kiedy pula ma być rysowana i mieć bieżący zegar. */
  keepAlive(untilTime) {
    if (untilTime > this.liveUntil) this.liveUntil = untilTime;
  }

  /**
   * Raz na klatkę: wgranie dotkniętego wycinka, zegar, widoczność, instanceCount.
   * @returns {boolean} czy pula ma jeszcze żywe cząstki
   */
  flush(nowSec) {
    if (this.dirtyLo >= 0) {
      const lo = this.dirtyLo;
      const count = this.dirtyHi - lo + 1;
      for (const attr of this.attributes) {
        const items = attr.itemSize || 1;
        // Zakresy z pominiętych klatek się kumulują (three czyści je dopiero po
        // faktycznym uploadzie) — po progu wracamy do pełnego wgrania.
        if (attr.updateRanges && attr.updateRanges.length >= MAX_PENDING_RANGES) attr.clearUpdateRanges();
        else if (attr.addUpdateRange) attr.addUpdateRange(lo * items, count * items);
        attr.needsUpdate = true;
      }
      this.dirtyLo = -1;
      this.dirtyHi = -1;
    }

    const live = nowSec < this.liveUntil;
    if (this.timeUniform && live) this.timeUniform.value = nowSec;

    const mesh = this.mesh;
    if (!mesh) return live;
    if (mesh.visible !== live) mesh.visible = live;

    const geo = mesh.geometry;
    if (live) {
      if (geo && geo.instanceCount !== this.highWater) geo.instanceCount = this.highWater;
    } else if (this.highWater !== 0) {
      // Bezczynna pula wraca na start: kolejny wybuch znowu zajmie tylko tyle
      // slotów, ile naprawdę potrzebuje, zamiast ciągnąć stary high-water.
      this.highWater = 0;
      this.cursor = 0;
      if (geo) geo.instanceCount = 0;
    }
    return live;
  }

  dispose() {
    pools.delete(this);
    this.mesh = null;
    this.attributes.length = 0;
    this.timeUniform = null;
  }
}

/**
 * @returns {boolean} czy którakolwiek pula ma żywe cząstki
 */
export function flushParticlePools(nowSec) {
  let anyLive = false;
  for (const pool of pools) {
    if (pool.flush(nowSec)) anyLive = true;
  }
  return anyLive;
}

export function getParticlePoolStats() {
  let live = 0;
  let instances = 0;
  for (const pool of pools) {
    if (pool.mesh?.visible) { live++; instances += pool.highWater; }
  }
  return { pools: pools.size, livePools: live, liveInstances: instances };
}
