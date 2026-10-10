// src/3d/gas/gasExplosions.js
//
// REŻYSER WYBUCHÓW NA GAZIE — przepisy wybuchów i pożarów budowli rozpisane na źródła gasGrid
// w czasie (CPU, bez three). Wybuch to nie jedna kula: kilka kłębów paliwa z opóźnieniami
// (nieregularna kula ognia), płonące odłamki ciągnące smugi ognia i dymu („pająk” z filmów),
// wybuchy wtórne, dogasające ogniska. Obraz z gazu: kula ognia, sadza, wiry — liczy siatka.
// Reszta (błysk, światło, iskry, fala refrakcji) idzie przez haki `on*` — demo i gra podpinają
// własne pule (iskry: gasEmbers.js, światła: siatka Core3D / PointLight w demie).
//
// Jednostki: scena [j.], czas [s] reżysera (zegar wołającego — w pauzie stoi). Losowanie tylko
// z `rng` (fxRandom w grze — agents.md: wizualia nie ruszają Math.random gry).

/** Emiter źródła gazu (pula obiektów, bez alokacji w klatce). */
class GasEmitter {
  constructor() { this.reset(); }
  reset() {
    this.alive = false;
    this.slot = -1;
    this.t0 = 0; this.t1 = 0;
    this.x = 0; this.y = 0; this.z = 0;
    this.px = 0; this.py = 0; this.pz = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.drag = 0; this.gravity = 0;
    this.r0 = 1; this.r1 = 1;
    this.fuel = 0; this.temp = 0; this.smoke = 0;
    this.radial = 0; this.dvx = 0; this.dvy = 0; this.dvz = 0; this.velBlend = 0;
    this.noise = 0.4;
    this.tau = 0;          // zanik tempa (0 = stałe)
    this.started = false;
    this.flicker = 0;      // migotanie tempa (pożar)
    this.rampIn = 0;       // narastanie tempa [s] (0 = od razu)
    this.rampOut = 0;      // wygaszanie tempa przed końcem [s] (0 = bez)
    this.seed = 0;
    this.trail = false;
    this.jet = false;      // strumień: kapsuła od otworu (x, y, z) o wektor (jx, jy, jz)
    this.jx = 0; this.jy = 0; this.jz = 0;
    this.velTau = -1;      // zanik narzucenia prędkości [s] tego emitera (−1 = tune.velTau reżysera)
    this.ox = 0; this.oy = 0; this.hasO = false;   // środek wybuchu (scena) — źródło zostaje po jego stronie brył statyki
    return this;
  }
}

/** Zdarzenie z opóźnieniem (błysk, światło, iskry wtórnego wybuchu). */
class DelayedEvent {
  constructor() { this.alive = false; this.t = 0; this.kind = 0; this.x = 0; this.y = 0; this.z = 0; this.size = 0; this.nx = 0; this.ny = 1; this.nz = 0; this.slot = -1; }
}

const EV_SECONDARY = 1;

export class GasExplosions {
  /**
   * @param {object} o
   * @param {import('./gasGrid.js').GasGrid} o.grid
   * @param {{ next(): number }} o.rng
   * @param {object} [o.hooks] onFlash(x,y,z,size,power), onLight(x,y,z,radius,r,g,b,intensity,life),
   *   onSparks(x,y,z,nx,ny,nz,size,count,speed,slot), onShock(x,y,z,radius,strength), onDebris(x,y,z,vx,vy,vz,size,life)
   */
  constructor({ grid, rng, hooks = {}, emitterCap = 256 }) {
    this.grid = grid;
    this.rng = rng;
    this.hooks = hooks;
    this.time = 0;
    this.emitters = Array.from({ length: emitterCap }, () => new GasEmitter());
    this.events = Array.from({ length: 64 }, () => new DelayedEvent());
    // blocked — odłamki zgaszone w bryle statyki, moved — źródła przesunięte z bryły statyki
    this.stats = { emitters: 0, dropped: 0, explosions: 0, blocked: 0, moved: 0 };
    this._free = { x: 0, y: 0 };
    // Środek bieżącego wybuchu (setOrigin): nowe emitery go zapamiętują.
    this._ox = 0; this._oy = 0; this._hasO = false;
    // Narzucenie prędkości źródeł (F8 audytu 2026-10-08): po `velHold` s od startu (nie krócej niż rampIn) siła
    // narzucenia `velBlend` maleje wykładniczo (τ = velTau) do `velFloor` [1/s] — strumień i front zaczynają żyć
    // własną dynamiką (rwą się i kłębią) zamiast sztywnej rury. velTau 0 = narzucenie przez całe życie (dawniej).
    // followCarrier: emitery jadą z nośnikiem swojej domeny (wybuch wraku w ruchu — reżyser wybuchów gry); bez tego
    // wołający sam stawia emitery (dym wraków gasSmokeGame przypina ogniska do kadłuba) albo domeny stoją.
    this.tune = { velHold: 0.06, velTau: 0, velFloor: 6, followCarrier: false };
    // Pomiar mocy ognia (CPU, do świateł punktowych): suma tempa paliwa × temperatury emiterów.
    this.firePower = 0;
  }

  _r(a = 0, b = 1) { return a + (b - a) * this.rng.next(); }

  /**
   * Środek wybuchu (scena) dla emiterów tworzonych do clearOrigin(): przy pierwszym wstrzyknięciu źródło za bryłą
   * statyki (kłąb za cienką ścianą) wraca przed nią — gaz nie pojawia się po drugiej stronie ściany.
   */
  setOrigin(x, y) { this._ox = x; this._oy = y; this._hasO = true; }
  clearOrigin() { this._hasO = false; }

  _emitter() {
    for (const e of this.emitters) if (!e.alive) {
      e.reset(); e.alive = true;
      if (this._hasO) { e.ox = this._ox; e.oy = this._oy; e.hasO = true; }
      return e;
    }
    this.stats.dropped++;
    return null;
  }

  _event() {
    for (const e of this.events) if (!e.alive) { e.alive = true; return e; }
    return null;
  }

  /** Losowy kierunek w półkuli wokół normalnej (n) z rozrzutem (0 = wzdłuż n, 1 = cała półkula). */
  _dirAround(nx, ny, nz, spread, out) {
    let x, y, z, l;
    do {
      x = this._r(-1, 1); y = this._r(-1, 1); z = this._r(-1, 1);
      l = x * x + y * y + z * z;
    } while (l > 1 || l < 1e-4);
    l = Math.sqrt(l);
    x /= l; y /= l; z /= l;
    const d = x * nx + y * ny + z * nz;
    if (d < 0) { x -= 2 * d * nx; y -= 2 * d * ny; z -= 2 * d * nz; }
    x = nx + (x - nx) * spread; y = ny + (y - ny) * spread; z = nz + (z - nz) * spread;
    l = Math.sqrt(x * x + y * y + z * z) || 1;
    out[0] = x / l; out[1] = y / l; out[2] = z / l;
    return out;
  }

  /**
   * Kłąb paliwa (część kuli ognia): krótki wyrzut paliwa i iskry zapłonu w kuli o promieniu r,
   * gaz rozpychany promieniowo z prędkością `radial` [j./s].
   */
  puff(slot, x, y, z, r, delay, duration, fuel, radial, opts = {}) {
    const e = this._emitter();
    if (!e) return null;
    e.slot = slot;
    e.t0 = this.time + delay; e.t1 = e.t0 + duration;
    e.x = e.px = x; e.y = e.py = y; e.z = e.pz = z;
    e.r0 = r; e.r1 = r * (opts.grow ?? 1.4);
    e.fuel = fuel; e.temp = opts.temp ?? 7; e.smoke = opts.smoke ?? 1.5;
    e.radial = radial; e.velBlend = opts.velBlend ?? 40;
    e.noise = opts.noise ?? 0.55;
    e.tau = opts.tau ?? 0;
    if (opts.dir) { e.dvx = opts.dir[0]; e.dvy = opts.dir[1]; e.dvz = opts.dir[2]; }
    return e;
  }

  /**
   * Płonący odłamek: emiter lecący po łuku, zostawia smugę ognia przechodzącą w dym. Tempa są
   * NA SEKUNDĘ, a szybkie źródło mija komórkę w ułamku kroku — stąd wysokie domyślne (smuga z
   * tempami kuli ognia była niewidoczna: ~0,2 dymu na komórkę).
   */
  trail(slot, x, y, z, vx, vy, vz, r, life, opts = {}) {
    const e = this._emitter();
    if (!e) return null;
    e.slot = slot;
    e.t0 = this.time + (opts.delay ?? 0); e.t1 = e.t0 + life;
    e.x = e.px = x; e.y = e.py = y; e.z = e.pz = z;
    e.vx = vx; e.vy = vy; e.vz = vz;
    e.drag = opts.drag ?? 0.9;
    e.gravity = opts.gravity ?? 0;
    e.r0 = r; e.r1 = r * (opts.shrink ?? 0.55);
    e.fuel = opts.fuel ?? 30; e.temp = opts.temp ?? 28; e.smoke = opts.smoke ?? 16;
    e.radial = 0; e.velBlend = opts.velBlend ?? 14;
    e.dvx = vx * 0.35; e.dvy = vy * 0.35; e.dvz = vz * 0.35;
    e.noise = 0.3;
    e.tau = opts.tau ?? life * 0.7;
    e.trail = true;
    return e;
  }

  /** Ognisko (pożar): stałe tempo z migotaniem, płomień do góry wzdłuż `up` [j./s]. */
  fire(slot, x, y, z, r, duration, opts = {}) {
    const e = this._emitter();
    if (!e) return null;
    e.slot = slot;
    e.t0 = this.time + (opts.delay ?? 0); e.t1 = e.t0 + duration;
    e.x = e.px = x; e.y = e.py = y; e.z = e.pz = z;
    e.r0 = r; e.r1 = r * 0.7;
    e.fuel = opts.fuel ?? 3.2; e.temp = opts.temp ?? 3.5; e.smoke = opts.smoke ?? 1.2;
    e.radial = opts.radial ?? r * 0.6;
    const up = opts.up || [0, 1, 0];
    const lift = opts.lift ?? r * 4;
    e.dvx = up[0] * lift; e.dvy = up[1] * lift; e.dvz = up[2] * lift;
    e.velBlend = opts.velBlend ?? 6;
    e.noise = 0.65;
    e.flicker = opts.flicker ?? 0.55;
    e.rampIn = 0.6;
    e.rampOut = 1.5;
    e.seed = this._r(0, 100);
    // Domena żyje dłużej niż ognisko (dym ma się rozejść): `keep` [s] po końcu ognia (domyślnie 8).
    if (this.grid) this.grid.keepAlive(slot, e.t1 + (opts.keep ?? 8));
    return e;
  }

  /**
   * STRUMIEŃ GAZU z otworu (rozerwana rura, wyrwa w kadłubie, wylot wybuchu): gaz wyrzucany z prędkością `speed`
   * [j./s] wzdłuż (dx, dy, dz) z kapsuły od otworu (x, y, z) o długości `len` i promieniu r — dalej leci własnym
   * pędem, rozchyla się (`radial`) i kłębi; tempo gaśnie z τ = opts.tau przez `duration` s. Paliwo (opts.fuel) daje
   * jęzor ognia, bez paliwa — strumień zimnego gazu i dymu.
   */
  jet(slot, x, y, z, dx, dy, dz, r, len, speed, duration, opts = {}) {
    const e = this._emitter();
    if (!e) return null;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l; dy /= l; dz /= l;
    e.slot = slot;
    e.t0 = this.time + (opts.delay ?? 0); e.t1 = e.t0 + duration;
    e.x = e.px = x; e.y = e.py = y; e.z = e.pz = z;
    e.jet = true;
    e.jx = dx * len; e.jy = dy * len; e.jz = dz * len;
    e.r0 = r; e.r1 = r * (opts.grow ?? 1);
    e.fuel = opts.fuel ?? 0; e.temp = opts.temp ?? 0; e.smoke = opts.smoke ?? 6;
    e.radial = opts.radial ?? speed * 0.12;
    e.dvx = dx * speed; e.dvy = dy * speed; e.dvz = dz * speed;
    e.velBlend = opts.velBlend ?? 30;
    e.noise = opts.noise ?? 0.35;
    e.tau = opts.tau ?? duration * 0.5;
    e.flicker = opts.flicker ?? 0.25;
    e.rampIn = opts.rampIn ?? 0.04;
    e.rampOut = opts.rampOut ?? Math.min(0.3, duration * 0.4);
    // Własny zanik narzucenia prędkości (np. strumień rozerwanego zbiornika paliwa bije dłużej niż kłęby wybuchu).
    e.velTau = Number(opts.velTau) >= 0 ? Number(opts.velTau) : -1;
    e.seed = this._r(0, 100);
    return e;
  }

  /**
   * WYBUCH BUDOWLI (moduł stacji, magazyn, reaktor pomocniczy): kula ognia z kilku kłębów,
   * płonące odłamki, wybuchy wtórne, dogasające ogniska, błysk, światło, iskry, fala.
   * (x, y, z) — miejsce, R — promień kuli ognia [j.], n — normalna powierzchni (kierunek wyrzutu).
   * opts: power (mnożnik paliwa), trails, secondaries, fires, fireTime, carrier, up, tint.
   */
  building(x, y, z, R, n = [0, 1, 0], opts = {}) {
    const g = this.grid;
    const up = opts.up || g.tune.buoyDir;
    const slot = g.acquire(x, y, z, R, {
      size: R * (opts.domainScale ?? 4.4),
      offset: [up[0] * R * 0.55 + n[0] * R * 0.35, up[1] * R * 0.55 + n[1] * R * 0.35, up[2] * R * 0.55 + n[2] * R * 0.35],
      life: opts.life ?? 16, carrier: opts.carrier, tint: opts.tint, now: g.time
    });
    if (slot < 0) return -1;
    this.stats.explosions++;
    const power = opts.power ?? 1;
    const nx = n[0], ny = n[1], nz = n[2];
    const d = [0, 0, 0];
    // Rdzeń: wyrzut paliwa w kuli 0,32 R, rozpychany promieniowo, lekko wzdłuż normalnej.
    this.puff(slot, x + nx * R * 0.15, y + ny * R * 0.15, z + nz * R * 0.15, R * 0.42, 0, 0.14, 14 * power, R * 3.8,
      { temp: 8, smoke: 1.2, dir: [nx * R * 2, ny * R * 2, nz * R * 2], grow: 1.6 });
    // Kłęby satelitarne (nieregularna kula): opóźnione, przesunięte wzdłuż półkuli normalnej.
    const nPuff = opts.puffs ?? (4 + Math.floor(this._r(0, 4)));
    for (let i = 0; i < nPuff; i++) {
      this._dirAround(nx, ny, nz, 0.92, d);
      const dist = R * this._r(0.25, 0.7);
      this.puff(slot, x + d[0] * dist, y + d[1] * dist, z + d[2] * dist, R * this._r(0.2, 0.34), this._r(0.02, 0.22),
        this._r(0.07, 0.14), this._r(8, 13) * power, R * this._r(1.8, 3.2),
        { temp: 7, smoke: 1.5, dir: [d[0] * R * 2.5, d[1] * R * 2.5, d[2] * R * 2.5] });
    }
    // Płonące odłamki: smugi ognia po łukach (pająk).
    const nTrail = opts.trails ?? (5 + Math.floor(this._r(0, 5)));
    for (let i = 0; i < nTrail; i++) {
      this._dirAround(nx, ny, nz, 0.95, d);
      const sp = R * this._r(2.6, 4.8);
      const life = this._r(0.8, 1.6);
      // Opór smugi = opór łba odłamka (gasEmbers: 1,1/s) — ogień i dym zostają za rozżarzonym łbem.
      this.trail(slot, x, y, z, d[0] * sp, d[1] * sp, d[2] * sp, R * this._r(0.085, 0.13), life,
        { delay: 0, drag: 1.1, fuel: this._r(28, 42) * power, temp: 30, smoke: this._r(15, 24), shrink: 0.45 });
      if (this.hooks.onDebris) this.hooks.onDebris(x, y, z, d[0] * sp, d[1] * sp, d[2] * sp, R * this._r(0.035, 0.06), life + this._r(0.8, 2.2));
    }
    // Wybuchy wtórne.
    const nSec = opts.secondaries ?? (1 + Math.floor(this._r(0, 3)));
    for (let i = 0; i < nSec; i++) {
      const ev = this._event();
      if (!ev) break;
      this._dirAround(nx, ny, nz, 1.0, d);
      const dist = R * this._r(0.45, 0.95);
      ev.kind = EV_SECONDARY;
      ev.t = this.time + this._r(0.35, 1.7);
      ev.x = x + d[0] * dist; ev.y = y + d[1] * dist; ev.z = z + d[2] * dist;
      ev.size = R * this._r(0.35, 0.55);
      ev.nx = d[0]; ev.ny = d[1]; ev.nz = d[2];
      ev.slot = slot;
    }
    // Dogasające ogniska u podstawy.
    const nFire = opts.fires ?? (1 + Math.floor(this._r(0, 3)));
    const fireTime = opts.fireTime ?? 9;
    for (let i = 0; i < nFire; i++) {
      this._dirAround(nx, ny, nz, 1.0, d);
      const dist = R * this._r(0.05, 0.4);
      this.fire(slot, x + d[0] * dist, y + d[1] * dist, z + d[2] * dist, R * this._r(0.1, 0.17), fireTime * this._r(0.6, 1.2),
        { delay: this._r(0.25, 0.6), up, fuel: this._r(2.6, 3.8) * power });
    }
    const h = this.hooks;
    if (h.onFlash) h.onFlash(x, y, z, R * 0.9, 1.0 * power);
    if (h.onLight) h.onLight(x + nx * R * 0.4, y + ny * R * 0.4, z + nz * R * 0.4, R * 9, 1.0, 0.62, 0.3, 60 * power, 1.4);
    if (h.onSparks) h.onSparks(x, y, z, nx, ny, nz, R, Math.round(2600 * power), R * 7, slot);
    if (h.onShock) h.onShock(x, y, z, R * 5, power);
    return slot;
  }

  /** Mniejszy wybuch (trafienie pocisku, rakieta, wtórny): bez pożarów, kilka kłębów. */
  blast(x, y, z, R, n = [0, 1, 0], opts = {}) {
    const g = this.grid;
    const slot = opts.slot ?? g.acquire(x, y, z, R, { size: R * 4.6, life: opts.life ?? 9, carrier: opts.carrier, now: g.time });
    if (slot < 0) return -1;
    this.stats.explosions++;
    const power = opts.power ?? 1;
    const d = [0, 0, 0];
    this.puff(slot, x, y, z, R * 0.4, 0, 0.1, 12 * power, R * 3.4, { temp: 8, smoke: 1.4, grow: 1.5 });
    const nPuff = opts.puffs ?? (2 + Math.floor(this._r(0, 3)));
    for (let i = 0; i < nPuff; i++) {
      this._dirAround(n[0], n[1], n[2], 1.0, d);
      const dist = R * this._r(0.2, 0.55);
      this.puff(slot, x + d[0] * dist, y + d[1] * dist, z + d[2] * dist, R * this._r(0.18, 0.3), this._r(0.01, 0.12),
        this._r(0.06, 0.11), this._r(7, 11) * power, R * this._r(1.6, 2.8), { temp: 7, smoke: 1.6 });
    }
    const nTrail = opts.trails ?? Math.floor(this._r(1, 4));
    for (let i = 0; i < nTrail; i++) {
      this._dirAround(n[0], n[1], n[2], 0.9, d);
      const sp = R * this._r(2.5, 4);
      this.trail(slot, x, y, z, d[0] * sp, d[1] * sp, d[2] * sp, R * this._r(0.07, 0.1), this._r(0.5, 1.0), { fuel: 28 * power, drag: 1.1 });
    }
    const h = this.hooks;
    if (h.onFlash) h.onFlash(x, y, z, R * 1.3, 0.7 * power);
    if (h.onLight) h.onLight(x + n[0] * R * 0.3, y + n[1] * R * 0.3, z + n[2] * R * 0.3, R * 7, 1.0, 0.6, 0.28, 30 * power, 0.9);
    if (h.onSparks) h.onSparks(x, y, z, n[0], n[1], n[2], R, Math.round(900 * power), R * 6, slot);
    if (h.onShock) h.onShock(x, y, z, R * 3.5, 0.6 * power);
    return slot;
  }

  /** Pożar budowli: kilka ognisk z dymem na długo (bez kuli ognia). */
  blaze(x, y, z, R, duration = 20, n = [0, 1, 0], opts = {}) {
    const g = this.grid;
    const up = opts.up || g.tune.buoyDir;
    const slot = g.acquire(x, y, z, R, { size: R * 5, offset: [up[0] * R * 1.2, up[1] * R * 1.2, up[2] * R * 1.2], life: duration + 6, now: g.time });
    if (slot < 0) return -1;
    const d = [0, 0, 0];
    const nFire = opts.fires ?? 3;
    for (let i = 0; i < nFire; i++) {
      this._dirAround(n[0], n[1], n[2], 1.0, d);
      const dist = R * this._r(0.0, 0.45);
      this.fire(slot, x + d[0] * dist, y + d[1] * dist, z + d[2] * dist, R * this._r(0.16, 0.26), duration * this._r(0.7, 1.0),
        { up, fuel: this._r(3, 4.4), smoke: this._r(1.4, 2.2), lift: R * this._r(3, 5) });
    }
    return slot;
  }

  /**
   * Krok reżysera (przed grid.simulate): emitery → źródła tej klatki, zdarzenia opóźnione.
   * dt — krok zegara reżysera [s] (0 w pauzie).
   */
  update(dt) {
    this.time += dt;
    const now = this.time;
    const g = this.grid;
    const VT = this.tune;
    // Zdarzenia opóźnione (wybuchy wtórne).
    for (const ev of this.events) {
      if (!ev.alive || now < ev.t) continue;
      ev.alive = false;
      if (ev.kind === EV_SECONDARY) {
        this.blast(ev.x, ev.y, ev.z, ev.size, [ev.nx, ev.ny, ev.nz], { slot: g.slots[ev.slot]?.active ? ev.slot : undefined, power: 0.8 });
      }
    }
    let alive = 0;
    let power = 0;
    for (const e of this.emitters) {
      if (!e.alive) continue;
      if (now >= e.t1) { e.alive = false; continue; }
      const slot = e.slot;
      if (slot < 0 || !g.slots[slot].active) { e.alive = false; continue; }
      alive++;
      // Emitery jadą z nośnikiem domeny (gaz w domenie jest w jej układzie; wybuch wraku w ruchu — źródła zostawałyby
      // w miejscu wybuchu, a domena odjeżdżała). Domena stojąca (dok, stacje) — bez zmian.
      const sd = g.slots[slot];
      if (VT.followCarrier && dt > 0 && (sd.vx !== 0 || sd.vy !== 0 || sd.vz !== 0)) {
        e.x += sd.vx * dt; e.y += sd.vy * dt; e.z += sd.vz * dt;
        e.px += sd.vx * dt; e.py += sd.vy * dt; e.pz += sd.vz * dt;
        // środek wybuchu jedzie z nim (odcinek środek → źródło przy pierwszym wstrzyknięciu — przegląd etapu C pkt 10)
        e.ox += sd.vx * dt; e.oy += sd.vy * dt;
      }
      // Ruch emitera (odłamki): opór, grawitacja wzdłuż −wyporu. Odłamek, który wpadł w bryłę statyki domeny (ściana hali,
      // kawałek doku — gasGrid.solidAt), gaśnie — inaczej ciągnąłby smugę ognia przez ścianę i za nią.
      if (e.trail && dt > 0) {
        const k = Math.exp(-e.drag * dt);
        e.vx *= k; e.vy *= k; e.vz *= k;
        if (e.gravity) { const b = g.tune.buoyDir; e.vx -= b[0] * e.gravity * dt; e.vy -= b[1] * e.gravity * dt; e.vz -= b[2] * e.gravity * dt; }
        const x0 = e.x, y0 = e.y;
        e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
        e.dvx = e.vx * 0.35; e.dvy = e.vy * 0.35; e.dvz = e.vz * 0.35;
        // odcinek ruchu w tej klatce (przy wolnej klatce odłamek przeskakuje cienką ścianę między punktami)
        if (g.solidAt && (g.solidAt(slot, e.x, e.y) || g.clipSegment(slot, x0, y0, e.x, e.y, this._free))) {
          e.alive = false; alive--; this.stats.blocked++; continue;
        }
      }
      if (now < e.t0) { e.px = e.x; e.py = e.y; e.pz = e.z; continue; }
      // Pierwsze wstrzyknięcie: środek źródła w bryle statyki domeny (wybuch przy ścianie hali, wrak wciśnięty w bryłę) —
      // przesunięty do najbliższej wolnej komórki (do 1,5 promienia + 2 komórki); bez wolnej zostaje (zasłonięte w kernelu).
      // Źródło po stronie środka wybuchu: odcinek środek → źródło przez bryłę = źródło cofnięte przed bryłę (kłąb za cienką
      // ścianą); bez środka albo środek w bryle — najbliższa wolna komórka.
      if (!e.started) {
        e.started = true;
        const sd0 = g.slots[slot];
        if (g.freePoint && sd0 && ((e.hasO && g.clipSegment(slot, e.ox, e.oy, e.x, e.y, this._free))
          || g.freePoint(slot, e.x, e.y, Math.ceil((e.r0 * 1.5) / sd0.h) + 2, this._free))) {
          const dx = this._free.x - e.x, dy = this._free.y - e.y;
          e.x += dx; e.y += dy; e.px += dx; e.py += dy;
          this.stats.moved++;
        }
      }
      const age = now - e.t0;
      const u = Math.min(1, age / Math.max(1e-3, e.t1 - e.t0));
      let k = e.tau > 0 ? Math.exp(-age / e.tau) : 1;
      if (e.flicker > 0) {
        const s = e.seed + now;
        k *= 1 - e.flicker * 0.5 * (1 + Math.sin(s * 7.3) * 0.6 + Math.sin(s * 13.1 + 1.7) * 0.4) * 0.5;
      }
      // Rozgrzanie i wygaszenie (ognisko, strumień).
      if (e.rampIn > 0) k *= Math.min(1, age / e.rampIn);
      if (e.rampOut > 0) k *= Math.min(1, (e.t1 - now) / e.rampOut);
      const r = e.r0 + (e.r1 - e.r0) * u;
      let vb = e.velBlend;
      const vTau = e.velTau >= 0 ? e.velTau : VT.velTau;
      if (vTau > 0 && vb > VT.velFloor) {
        const a = age - Math.max(e.rampIn, VT.velHold);
        if (a > 0) vb = VT.velFloor + (vb - VT.velFloor) * Math.exp(-a / vTau);
      }
      if (e.jet) {
        g.source(slot, e.x, e.y, e.z, e.x + e.jx, e.y + e.jy, e.z + e.jz, r, e.fuel * k, e.temp * k, e.smoke * k,
          e.radial, e.dvx, e.dvy, e.dvz, vb, e.noise);
      } else {
        g.source(slot, e.px, e.py, e.pz, e.x, e.y, e.z, r, e.fuel * k, e.temp * k, e.smoke * k,
          e.radial, e.dvx, e.dvy, e.dvz, vb, e.noise);
      }
      power += e.fuel * k * r * r;
      e.px = e.x; e.py = e.y; e.pz = e.z;
    }
    this.firePower = power;
    this.stats.emitters = alive;
  }

  /** Emitery i zdarzenia domeny `slot` gasną (domena przejęta przez nowy wybuch — stare źródła nie trafiają do niego). */
  dropSlot(slot) {
    for (const e of this.emitters) if (e.alive && e.slot === slot) e.alive = false;
    for (const ev of this.events) if (ev.alive && ev.slot === slot) ev.slot = -1;
  }

  clear() {
    for (const e of this.emitters) e.alive = false;
    for (const ev of this.events) ev.alive = false;
  }
}

