// dema/bronie-webgpu/fxLights.js
//
// Światła efektów na CPU → siatka świateł (lightGrid.js) raz na klatkę.
// Błyski luf, trafienia i żar ran to krótkie światła punktowe z krzywą zaniku;
// pociski i wiązki dokładają światła tylko na bieżącą klatkę.
// W grze błyski były „rozlaniem” (addytywny kwad na poszyciu) — tu oświetlają
// kadłub, wieżyczki, dym i odłamki naprawdę (z reliefem paneli).

const CAP = 512;

export class FxLights {
  constructor() {
    this.list = [];
    this.pool = [];
    this.frame = [];
    this.gain = 1;
    this.enabled = true;
  }

  /**
   * Błysk (świat gry): barwa × moc, zasięg [j.], życie [s], wykładnik zaniku,
   * migotanie (0..1), z nad płaszczyzną.
   */
  flash(x, y, r, g, b, power, range, life, { decay = 2, flicker = 0, z = 60, grow = 0 } = {}) {
    if (!this.enabled || this.list.length >= CAP) return null;
    const L = this.pool.pop() || {};
    L.x = x; L.y = y; L.z = z; L.r = r; L.g = g; L.b = b;
    L.power = power; L.range = range; L.life = life; L.age = 0;
    L.decay = decay; L.flicker = flicker; L.grow = grow; L.seed = Math.random() * 100;
    this.list.push(L);
    return L;
  }

  /** Światło tylko na tę klatkę (pocisk, wiązka). */
  point(x, y, r, g, b, power, range, z = 40) {
    if (!this.enabled || this.frame.length >= CAP) return;
    this.frame.push(x, y, z, r * power, g * power, b * power, range);
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i];
      l.age += dt;
      if (l.age >= l.life) {
        L[i] = L[L.length - 1];
        L.pop();
        this.pool.push(l);
      }
    }
  }

  /** Do siatki (współrzędne sceny: x, −y). */
  commit(grid, time) {
    if (!this.enabled) { this.frame.length = 0; return; }
    const k = this.gain;
    for (const l of this.list) {
      const u = l.age / l.life;
      let e = Math.pow(1 - u, l.decay);
      if (l.flicker > 0) e *= 1 - l.flicker * (0.5 + 0.5 * Math.sin(time * 37 + l.seed) * Math.sin(time * 23.7 + l.seed * 1.7));
      const range = l.range * (1 + l.grow * u);
      const p = l.power * e * k;
      if (p < 1e-3) continue;
      grid.add(l.x, -l.y, l.z, range, l.r * p, l.g * p, l.b * p, 0.6);
    }
    const F = this.frame;
    for (let i = 0; i < F.length; i += 7) {
      grid.add(F[i], -F[i + 1], F[i + 2], F[i + 6], F[i + 3] * k, F[i + 4] * k, F[i + 5] * k, 0.6);
    }
    F.length = 0;
  }

  get count() { return this.list.length; }

  clear() { while (this.list.length) this.pool.push(this.list.pop()); this.frame.length = 0; }
}
