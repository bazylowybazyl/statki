// src/3d/fx/fxLights.js
//
// Światła EFEKTÓW → siatka świateł (lightGrid.js) raz na klatkę. Port FxLights z dema
// broni (dema/bronie-webgpu/fxLights.js) + zasady gry:
//   • błysk (`flash`) — krótkie światło z krzywą zaniku (lufa, trafienie, żar rany),
//     żyje `life` sekund; światło punktowe (`point`) — tylko na bieżącą klatkę
//     (pocisk w locie, wiązka, dysza rakiety);
//   • argumenty POZYCYJNE zamiast obiektu opcji i pule typowane (SoA) — zero alokacji
//     na wywołanie i na klatkę (demo: `{ decay, flicker, z }` i obiekt światła na błysk);
//   • losowość (faza migotania) z generatora warstwy efektów (fxRandom.js), nie z
//     `Math.random` gry;
//   • NOŚNIK (agents.md, src/game/carrierVelocity.js): błysk rodzi się z prędkością
//     kadłuba, z którego wyszedł (`ActiveCarrier` ustawiony przez fasadę efektu), i
//     jedzie z nim: pozycja = x0 + v · (T_zegar − t0) z zegara gry (SimClock). Bez
//     tego błysk lufy Atlasa przy 10 000 j/s zostawałby 1400–6000 j. za okrętem
//     (życie 0,14–0,6 s); zdjęty nośnik = stoi w świecie jak w demie;
//   • tylko w kadrze: `setView` (świat gry) odrzuca błyski i światła punktowe, których
//     koło zasięgu nie dotyka kadru z zapasem — pula 512 nie zapycha się bitwą poza
//     ekranem; do tego siatka odrzuca w `add` wszystko poza swoim prostokątem.
//
// Pozycje w układzie ŚWIATA gry (x, y), double na CPU; `commit` przelicza je do układu
// lokalnego siatki (`grid.addWorld`: scena − początek).

import { fxRandom } from './fxRandom.js';
import { ActiveCarrier } from '../../game/carrierVelocity.js';
import { SimClock, CLOCK_RENDER } from '../../game/simClock.js';

export const FX_FLASH_CAP = 512;        // błysków żyjących naraz (demo: CAP 512)
export const FX_POINT_CAP = 512;        // świateł punktowych na klatkę
export const FX_LIGHT_SCATTER = 0.6;    // rozpraszanie w ośrodku (L1.w) — jak demo broni

export class FxLights {
  /**
   * @param {object} [o]
   * @param {number} [o.flashCap]
   * @param {number} [o.pointCap]
   * @param {{ next(): number }} [o.random]   generator (domyślnie fxRandom)
   * @param {{ vx: number, vy: number, t0: number, clock: number }} [o.carrier] nośnik (ActiveCarrier)
   * @param {{ now(clock: number): number }} [o.clock] zegar gry (SimClock)
   */
  constructor({ flashCap = FX_FLASH_CAP, pointCap = FX_POINT_CAP, random = fxRandom, carrier = ActiveCarrier, clock = SimClock } = {}) {
    this.flashCap = flashCap;
    this.pointCap = pointCap;
    this.random = random;
    this.carrier = carrier;
    this.clock = clock;
    this.gain = 1;
    this.enabled = true;
    // Błyski (SoA): pozycja świata w double, reszta float32.
    this.fx = new Float64Array(flashCap);       // x0 świata
    this.fy = new Float64Array(flashCap);       // y0 świata
    this.ft0 = new Float64Array(flashCap);      // czas pozy nośnika (zegar gry, godziny → double)
    this.fcv = new Float32Array(flashCap * 2);  // prędkość nośnika (świat)
    this.fck = new Uint8Array(flashCap);        // zegar nośnika (CLOCK_*)
    this.fz = new Float32Array(flashCap);
    this.fcol = new Float32Array(flashCap * 3);
    this.fpower = new Float32Array(flashCap);
    this.frange = new Float32Array(flashCap);
    this.flife = new Float32Array(flashCap);
    this.fage = new Float32Array(flashCap);
    this.fdecay = new Float32Array(flashCap);
    this.fflicker = new Float32Array(flashCap);
    this.fgrow = new Float32Array(flashCap);
    this.fseed = new Float32Array(flashCap);
    this.fscatter = new Float32Array(flashCap);
    this.flashes = 0;
    // Światła jednej klatki: x, y (świat, double), z, r, g, b (× moc), zasięg, rozpraszanie.
    this.pxy = new Float64Array(pointCap * 2);
    this.pdata = new Float32Array(pointCap * 6);
    this.points = 0;
    // Kadr (świat gry) do odrzucania; brak = bez odrzucania.
    this.hasView = false;
    this.vx0 = 0; this.vy0 = 0; this.vx1 = 0; this.vy1 = 0;
    this.stats = { flashes: 0, points: 0, committed: 0, rejected: 0, full: 0 };
  }

  /** Kadr w świecie gry (z zapasem) — światła, których koło go nie dotyka, są pomijane. */
  setView(x0, y0, x1, y1) {
    this.vx0 = Math.min(x0, x1); this.vx1 = Math.max(x0, x1);
    this.vy0 = Math.min(y0, y1); this.vy1 = Math.max(y0, y1);
    this.hasView = true;
    return this;
  }

  clearView() {
    this.hasView = false;
    return this;
  }

  _outside(x, y, r) {
    return this.hasView && (x + r < this.vx0 || x - r > this.vx1 || y + r < this.vy0 || y - r > this.vy1);
  }

  /**
   * Błysk (świat gry): barwa (r, g, b) × moc, zasięg [j.], życie [s], wykładnik zaniku
   * (1 − u)^decay, migotanie 0..1, z nad płaszczyzną, rozrost zasięgu (× (1 + grow·u)),
   * rozpraszanie w ośrodku. Nośnik z `ActiveCarrier` w chwili wywołania.
   * Zwraca slot (≥ 0) albo −1 (wyłączone, poza kadrem, pula pełna).
   */
  flash(x, y, r, g, b, power, range, life, decay = 2, flicker = 0, z = 60, grow = 0, scatter = FX_LIGHT_SCATTER) {
    if (!this.enabled || !(life > 0) || !(range > 0)) return -1;
    if (this._outside(x, y, range * (1 + Math.max(0, grow)))) { this.stats.rejected++; return -1; }
    if (this.flashes >= this.flashCap) { this.stats.full++; return -1; }
    const i = this.flashes++;
    const c = this.carrier;
    this.fx[i] = x;
    this.fy[i] = y;
    this.fcv[i * 2] = c ? c.vx : 0;
    this.fcv[i * 2 + 1] = c ? c.vy : 0;
    this.ft0[i] = c ? c.t0 : 0;
    this.fck[i] = c && c.clock === CLOCK_RENDER ? CLOCK_RENDER : 0;
    this.fz[i] = z;
    this.fcol[i * 3] = r; this.fcol[i * 3 + 1] = g; this.fcol[i * 3 + 2] = b;
    this.fpower[i] = power;
    this.frange[i] = range;
    this.flife[i] = life;
    this.fage[i] = 0;
    this.fdecay[i] = decay;
    this.fflicker[i] = flicker;
    this.fgrow[i] = grow;
    this.fseed[i] = this.random.next() * 100;
    this.fscatter[i] = scatter;
    this.stats.flashes++;
    return i;
  }

  /** Światło tylko na tę klatkę (pocisk, wiązka, dysza) — pozycja bieżąca, świat gry. */
  point(x, y, r, g, b, power, range, z = 40, scatter = FX_LIGHT_SCATTER) {
    if (!this.enabled || !(range > 0)) return false;
    if (this._outside(x, y, range)) { this.stats.rejected++; return false; }
    if (this.points >= this.pointCap) { this.stats.full++; return false; }
    const i = this.points++;
    this.pxy[i * 2] = x;
    this.pxy[i * 2 + 1] = y;
    const o = i * 6;
    const d = this.pdata;
    d[o] = z; d[o + 1] = r * power; d[o + 2] = g * power; d[o + 3] = b * power; d[o + 4] = range; d[o + 5] = scatter;
    this.stats.points++;
    return true;
  }

  /** Starzeje błyski o dt [s] i usuwa wygasłe (zamiana z ostatnim — bez alokacji). */
  update(dt) {
    const step = dt > 0 ? dt : 0;
    for (let i = this.flashes - 1; i >= 0; i--) {
      this.fage[i] += step;
      if (this.fage[i] >= this.flife[i]) this._removeFlash(i);
    }
  }

  _removeFlash(i) {
    const last = --this.flashes;
    if (i === last) return;
    this.fx[i] = this.fx[last];
    this.fy[i] = this.fy[last];
    this.ft0[i] = this.ft0[last];
    this.fcv[i * 2] = this.fcv[last * 2];
    this.fcv[i * 2 + 1] = this.fcv[last * 2 + 1];
    this.fck[i] = this.fck[last];
    this.fz[i] = this.fz[last];
    this.fcol[i * 3] = this.fcol[last * 3];
    this.fcol[i * 3 + 1] = this.fcol[last * 3 + 1];
    this.fcol[i * 3 + 2] = this.fcol[last * 3 + 2];
    this.fpower[i] = this.fpower[last];
    this.frange[i] = this.frange[last];
    this.flife[i] = this.flife[last];
    this.fage[i] = this.fage[last];
    this.fdecay[i] = this.fdecay[last];
    this.fflicker[i] = this.fflicker[last];
    this.fgrow[i] = this.fgrow[last];
    this.fseed[i] = this.fseed[last];
    this.fscatter[i] = this.fscatter[last];
  }

  /** Pozycja błysku i w tej klatce (świat gry) z członem nośnika: x0 + v · (T − t0). */
  flashX(i) {
    const vx = this.fcv[i * 2];
    return vx === 0 ? this.fx[i] : this.fx[i] + vx * (this.clock.now(this.fck[i]) - this.ft0[i]);
  }

  flashY(i) {
    const vy = this.fcv[i * 2 + 1];
    return vy === 0 ? this.fy[i] : this.fy[i] + vy * (this.clock.now(this.fck[i]) - this.ft0[i]);
  }

  /**
   * Do siatki (raz na klatkę, po `grid.begin` z początkiem tej klatki): błyski z krzywą
   * zaniku i migotaniem (`time` — zegar efektów [s]) oraz światła punktowe tej klatki,
   * które potem znikają. Zwraca liczbę świateł przyjętych przez siatkę.
   */
  commit(grid, time = 0) {
    let n = 0;
    if (!this.enabled) { this.points = 0; return 0; }
    const k = this.gain;
    for (let i = 0; i < this.flashes; i++) {
      const u = this.fage[i] / this.flife[i];
      const base = 1 - u;
      if (!(base > 0)) continue;
      let e = Math.pow(base, this.fdecay[i]);
      const fl = this.fflicker[i];
      if (fl > 0) {
        const s = this.fseed[i];
        e *= 1 - fl * (0.5 + 0.5 * Math.sin(time * 37 + s) * Math.sin(time * 23.7 + s * 1.7));
      }
      const p = this.fpower[i] * e * k;
      if (p < 1e-3) continue;
      const range = this.frange[i] * (1 + this.fgrow[i] * u);
      const x = this.flashX(i);
      const y = this.flashY(i);
      if (this._outside(x, y, range)) continue;
      if (grid.addWorld(x, y, this.fz[i], range, this.fcol[i * 3] * p, this.fcol[i * 3 + 1] * p, this.fcol[i * 3 + 2] * p, this.fscatter[i]) >= 0) n++;
    }
    const d = this.pdata;
    for (let i = 0; i < this.points; i++) {
      const o = i * 6;
      if (grid.addWorld(this.pxy[i * 2], this.pxy[i * 2 + 1], d[o], d[o + 4], d[o + 1] * k, d[o + 2] * k, d[o + 3] * k, d[o + 5]) >= 0) n++;
    }
    this.points = 0;
    this.stats.committed = n;
    return n;
  }

  /** Liczba żyjących błysków. */
  get count() { return this.flashes; }

  clear() {
    this.flashes = 0;
    this.points = 0;
  }
}
