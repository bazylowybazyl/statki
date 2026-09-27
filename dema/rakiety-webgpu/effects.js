// dema/rakiety-webgpu/effects.js
//
// Reżyser efektów rakiet: zdarzenia lotu (flight.js) → receptury na pulach
// (dym, iskry, płomienie, kule ognia, mgławica, łuki, duszki blasku, światła
// siatki, zniekształcenia, siły w dymie). Stan w świecie gry (double); do GPU
// idzie względem początku sceny (ox, oy): scena = (x − ox, −(y − oy)).
//
// Receptury:
//   • WYRZUT (VLS, zimny start): obłok białej pary, krótki chłodny błysk;
//   • ZAPŁON: błysk dyszy, kłąb gorących spalin, impuls światła;
//   • LOT: płomień z dyskami Macha (plumes.js), światło dyszy (oświetla własną
//     smugę i kadłuby), smuga = porcje gazu wzdłuż odcinka dyszy w klatce
//     (wiek z ułamka klatki, ruch doliczony analitycznie, trzy długości życia:
//     gęsty gorący ogon, średnia smuga, długi dym); supernowa: plazma, dym
//     chemiczny, iskrzące jony i łuki wyładowań, pulsująca głowica w fazie
//     końcowej;
//   • WYBUCH (głowica): błysk (rdzeń + halo) i silne krótkie światło, kula
//     ognia (fireballs.js), iskry w półprzestrzeni od poszycia, płonące odłamki
//     z własnymi smugami, kłęby sadzy, fala uderzeniowa (refrakcja + pchnięcie
//     dymu), gorące powietrze, przypalenie poszycia dymiące przez chwilę;
//   • SUPERNOWA: implozja (wsysanie dymu, soczewka do środka, przygaszenie),
//     detonacja (oślepiający błysk, linia anamorficzna, światło na pół kadru,
//     podbicie bloomu), fala (refrakcja + wymiatanie dymu), pozostałość
//     (nebula.js), tysiące iskier, stygnące jądro z pulsowaniem.

import { MISSILE_VFX, SMOKE_PALETTES, SMOKE_KIND, SPARK_COLORS, lin } from './palette.js';
import { ROCKET_BODY_LENGTH } from './flight.js';
import { GLOW_ROUND, GLOW_STREAK } from './common.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOVA_CORE = [30, 26, 34];
const NOVA_HALO = [1.1, 0.8, 1.35];

export class Effects {
  constructor({ smoke, sparks, plumes, fireballs, nebula, arcs, glow, post, bodies, origin }) {
    this.smoke = smoke;
    this.sparks = sparks;
    this.plumes = plumes;
    this.fireballs = fireballs;
    this.nebula = nebula;
    this.arcs = arcs;
    this.glow = glow;
    this.post = post;
    this.bodies = bodies;
    this.ox = origin.x;
    this.oy = origin.y;
    this.rng = mulberry(0x5EED);
    this.time = 0;
    this.flashes = [];
    this.blasts = [];
    this.shocks = [];
    this.hazes = [];
    this.fragments = [];
    this.scorches = [];
    this.novas = [];
    this.shake = 0;
    this.bloomBoost = 0;
    this.exposure = 1;
    this.opts = {
      trails: true,
      fragments: true,
      wakes: true,
      arcs: true,
      scorch: true,
      trailDensity: 1,
      blastGain: 1
    };
    this._blastList = [];
    this._wakeList = [];
    this.stats = { flashes: 0, fragments: 0, novas: 0, lights: 0 };
  }

  // --- pomocnicze -------------------------------------------------------------

  sx(x) { return x - this.ox; }
  sy(y) { return -(y - this.oy); }

  _nozzle(m, out) {
    const L = ROCKET_BODY_LENGTH * m.p.bodyScale;
    out.x = m.x - Math.cos(m.heading) * L * 0.5;
    out.y = m.y - Math.sin(m.heading) * L * 0.5;
    return out;
  }

  /**
   * Porcja dymu w ŚWIECIE: ruch własny (vx, vy) i nośnik (cx, cy) świata,
   * wiek początkowy age0 — ruch doliczony analitycznie (opór palety).
   */
  _puff(x, y, vx, vy, cx, cy, size0, growth, life, temp, kind, opacity, age0 = 0, z = 12, angle = null) {
    const k = SMOKE_PALETTES[kind].drag;
    if (age0 > 0) {
      const f = (1 - Math.exp(-k * age0)) / k;
      const e = Math.exp(-k * age0);
      x += vx * f + cx * age0;
      y += vy * f + cy * age0;
      vx *= e;
      vy *= e;
    }
    // Kąt świata → scena (oś y odwrócona).
    this.smoke.spawn(this.sx(x), this.sy(y), z, vx, -vy, 0, cx, -cy, size0, growth, life, temp, kind, opacity, age0, angle === null ? null : -angle);
  }

  _spark(x, y, vx, vy, life, size, drag, col, gain = 1, cx = 0, cy = 0, z = 34) {
    this.sparks.emit(this.time, this.sx(x), this.sy(y), z, vx, -vy, 0, life, size, drag, col[0], col[1], col[2], gain, cx, -cy);
  }

  _flash(x, y, o) {
    this.flashes.push({ x, y, t0: this.time, ...o });
  }

  // --- zdarzenia lotu ---------------------------------------------------------

  onLaunch(m) {
    const rng = this.rng;
    const vfx = MISSILE_VFX[m.vfx];
    const bs = m.p.bodyScale;
    const ud = m.userData;
    const n = { x: 0, y: 0 };
    this._nozzle(m, n);
    ud.nx0 = n.x; ud.ny0 = n.y; ud.acc = 0; ud.tick = 0; ud.ionAcc = 0;
    ud.arcT = 0.2 + rng() * 0.3; ud.roll = rng() * TAU; ud.flick = rng() * 10;
    // Zimny gaz wyrzutu: obłok pary rozchodzący się od komory.
    const puffs = Math.round(14 * Math.sqrt(bs));
    for (let i = 0; i < puffs; i++) {
      const a = rng() * TAU;
      const sp = 60 + rng() * 240;
      this._puff(m.x + Math.cos(a) * 4, m.y + Math.sin(a) * 4, Math.cos(a) * sp + m.vx * 0.3, Math.sin(a) * sp + m.vy * 0.3,
        m.fx, m.fy, (5 + rng() * 4) * Math.sqrt(bs), (26 + rng() * 14) * Math.sqrt(bs), 0.9 + rng() * 0.7, 0, SMOKE_KIND.VAPOR, 0.3 + rng() * 0.18, 0, 14);
    }
    this._flash(m.x, m.y, { life: 0.12, core: [1.4, 1.6, 1.9], coreSize: 26 * bs, tauCore: 0.04, halo: [0.12, 0.14, 0.18], haloSize: 120 * bs, tauHalo: 0.06, light: null });
    void vfx;
  }

  onIgnite(m) {
    const rng = this.rng;
    const vfx = MISSILE_VFX[m.vfx];
    const bs = m.p.bodyScale;
    const ud = m.userData;
    const n = { x: 0, y: 0 };
    this._nozzle(m, n);
    ud.nx0 = n.x; ud.ny0 = n.y; ud.acc = 0;
    const c = Math.cos(m.heading);
    const s = Math.sin(m.heading);
    const L = vfx.light;
    this._flash(n.x, n.y, {
      life: 0.3, core: vfx.plume.core.map((v) => v * 0.7), coreSize: 30 * bs, tauCore: 0.05,
      halo: vfx.plume.hot.map((v) => v * 0.25), haloSize: 160 * bs, tauHalo: 0.1,
      light: { color: L.color, I1: 3.0 * L.intensity, tau1: 0.08, I2: 0, tau2: 1, range: L.range * 1.1, z: 40 }
    });
    // Kłąb gorących spalin przy zapłonie.
    const kind = vfx.trail.kind;
    for (let i = 0; i < 12; i++) {
      const sp = 250 + rng() * 550;
      const spread = (rng() - 0.5) * 1.6;
      const vx = -(c * Math.cos(spread) - s * Math.sin(spread)) * sp;
      const vy = -(s * Math.cos(spread) + c * Math.sin(spread)) * sp;
      this._puff(n.x, n.y, vx, vy, m.fx, m.fy, (4 + rng() * 3) * Math.sqrt(bs), (30 + rng() * 20) * Math.sqrt(bs),
        0.8 + rng() * 1.4, 1.0, kind, 0.42 + rng() * 0.15, rng() * 0.02, 12);
    }
  }

  onFly(m, dt) {
    const ud = m.userData;
    const vfx = MISSILE_VFX[m.vfx];
    const n = { x: 0, y: 0 };
    this._nozzle(m, n);
    if (m.state !== 'POWERED' || !this.opts.trails) {
      ud.nx0 = n.x; ud.ny0 = n.y;
      return;
    }
    const tr = vfx.trail;
    const rng = this.rng;
    const bs = m.p.bodyScale;
    const c = Math.cos(m.heading);
    const s = Math.sin(m.heading);
    const x0 = ud.nx0;
    const y0 = ud.ny0;
    const dx = n.x - x0;
    const dy = n.y - y0;
    const d = Math.hypot(dx, dy);
    const spacing = tr.spacing / Math.max(0.25, this.opts.trailDensity);
    ud.acc += d;
    const speed = m.speed;
    const exhaust = Math.max(650, speed * tr.exhaust);
    const spreadV = 55 + speed * 0.045;
    const thr = 0.45 + 0.55 * m.throttle;
    let guard = 0;
    while (ud.acc >= spacing && guard++ < 256) {
      ud.acc -= spacing;
      const u = d > 1e-6 ? clamp(1 - ud.acc / d, 0, 1) : 1;
      const px = x0 + dx * u;
      const py = y0 + dy * u;
      const age0 = (1 - u) * dt;
      // 60 % krótkich (gorący ogon), 20 % średnich, 20 % długich (dym na sekundy).
      const tier = ud.tick++ % 10;
      const lifeIdx = tier < 6 ? 0 : (tier < 8 ? 1 : 2);
      const life = tr.lives[lifeIdx] * (0.85 + rng() * 0.3);
      const opac = tr.opacity * [1.0, 0.75, 0.7][lifeIdx] * (0.8 + rng() * 0.4);
      const grow = tr.growth * [0.55, 0.9, 1.0][lifeIdx] * (0.75 + rng() * 0.5) * Math.pow(bs, 0.6);
      const lat = (rng() - 0.5) * 2 * spreadV;
      const lon = (rng() - 0.5) * 0.08 * exhaust;
      const vx = m.vx - c * (exhaust + lon) - s * lat;
      const vy = m.vy - s * (exhaust + lon) + c * lat;
      const size0 = tr.size0 * Math.pow(bs, 0.7) * (0.8 + rng() * 0.4);
      const temp = tr.temp * thr * (0.85 + rng() * 0.3);
      this._puff(px, py, vx, vy, m.fx, m.fy, size0, grow, life, temp, tr.kind, opac, age0, 10 + rng() * 6, m.heading + (rng() - 0.5) * 0.12);
    }
    ud.nx0 = n.x; ud.ny0 = n.y;

    if (m.vfx === 'supernova') {
      // Iskrzące jony w śladzie (migoczą w drugiej połowie życia).
      ud.ionAcc += d;
      while (ud.ionAcc > 16) {
        ud.ionAcc -= 16;
        const u = d > 1e-6 ? clamp(1 - ud.ionAcc / d, 0, 1) : 1;
        const px = x0 + dx * u + (rng() - 0.5) * 14;
        const py = y0 + dy * u + (rng() - 0.5) * 14;
        const a = rng() * TAU;
        const sp = 20 + rng() * 60;
        const col = rng() < 0.55 ? SPARK_COLORS.nova : SPARK_COLORS.ion;
        this._spark(px, py, Math.cos(a) * sp, Math.sin(a) * sp, 0.9 + rng() * 1.3, 0.14 + rng() * 0.1, 1.2, col, 0.55, m.fx, m.fy, 30);
      }
      // Łuki wyładowań między głowicą a świeżym śladem.
      ud.arcT -= dt;
      if (ud.arcT <= 0 && this.opts.arcs) {
        ud.arcT = 0.16 + rng() * 0.38;
        const back = 60 + rng() * 150;
        const side = (rng() - 0.5) * 70;
        const ax = n.x;
        const ay = n.y;
        const bx = n.x - c * back - s * side;
        const by = n.y - s * back + c * side;
        this.arcs.bolt(this.time, this.sx(ax), this.sy(ay), this.sx(bx), this.sy(by), { life: 0.07 + rng() * 0.06, rng, branches: rng() < 0.5 ? 1 : 0 });
      }
    }
  }

  onDetonate(m, x, y, hull, nx, ny) {
    if (m.vfx === 'supernova') this._supernova(m, x, y);
    else this._standard(m, x, y, hull, nx, ny);
  }

  // --- wybuch głowicy -----------------------------------------------------------

  _standard(m, x, y, hull, nx, ny) {
    const rng = this.rng;
    const vfx = MISSILE_VFX[m.vfx];
    const B = vfx.blast;
    const R = B.radius;
    const k = R / 150;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    // Nośnik: trafiony kadłub (wybuch jedzie z nim) albo układ rakiety.
    const cx = hull ? (hull.vx || 0) : m.fx;
    const cy = hull ? (hull.vy || 0) : m.fy;
    const ex = x + (hull ? nx * R * 0.12 : 0);
    const ey = y + (hull ? ny * R * 0.12 : 0);
    // 1. Błysk i światło.
    this._flash(ex, ey, {
      life: 1.2, cx, cy,
      core: [14, 11, 8].map((v) => v * B.flash), coreSize: 24 * k, tauCore: 0.035,
      halo: [0.6, 0.38, 0.2].map((v) => v * B.flash), haloSize: 210 * k, tauHalo: 0.08,
      light: { color: [1.0, 0.72, 0.45], I1: 6 * B.flash, tau1: 0.06, I2: 1.2 * B.flash, tau2: 0.4, range: 2200 * Math.sqrt(k), z: 140 }
    });
    // 2. Kula ognia.
    this.fireballs.add(this.time, this.sx(ex), this.sy(ey), 36, R * 0.62, 0.95, 1.0, 1.0, cx, -cy);
    // 3. Iskry: półprzestrzeń od poszycia albo pełne koło (wybuch w próżni).
    const nSp = Math.round(B.sparks * this.opts.blastGain);
    for (let i = 0; i < nSp; i++) {
      const a = hull ? Math.atan2(ny, nx) + (rng() - 0.5) * 2 * 1.35 : rng() * TAU;
      const sp = (1200 + rng() * 3000) * Math.sqrt(k);
      const col = rng() < 0.6 ? SPARK_COLORS.warm : SPARK_COLORS.gold;
      this._spark(ex, ey, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + rng() * 0.7, 0.3 + rng() * 0.6, 2.0 + rng() * 1.6, col, 1, cx, cy);
    }
    // 4. Płonące odłamki z własnymi smugami.
    if (this.opts.fragments) {
      for (let i = 0; i < B.fragments; i++) {
        const a = hull ? Math.atan2(ny, nx) + (rng() - 0.5) * 2 * 1.2 : rng() * TAU;
        const sp = (520 + rng() * 950) * Math.sqrt(k);
        this.fragments.push({
          x: ex, y: ey, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, cx, cy,
          t0: this.time, life: 0.7 + rng() * 0.9, drag: 1.1 + rng() * 0.6, acc: 0, heat: 0.8 + rng() * 0.4,
          size: (0.7 + rng() * 0.6) * Math.sqrt(k), nx0: ex, ny0: ey
        });
      }
    }
    // 5. Kłęby sadzy (świeże świecą od środka, potem stygną i dymią).
    const nSm = Math.round(B.smoke);
    for (let i = 0; i < nSm; i++) {
      const a = hull ? Math.atan2(ny, nx) + (rng() - 0.5) * 2 * 1.5 : rng() * TAU;
      const sp = (120 + rng() * 520) * Math.sqrt(k);
      const r0 = rng() * R * 0.25;
      this._puff(ex + Math.cos(a) * r0, ey + Math.sin(a) * r0, Math.cos(a) * sp, Math.sin(a) * sp, cx, cy,
        (10 + rng() * 16) * k, (36 + rng() * 26) * k, 3.2 + rng() * 3.6, 0.35 + rng() * 0.2, SMOKE_KIND.SOOT, 0.26 + rng() * 0.14, rng() * 0.05, 20 + rng() * 10);
    }
    // 6. Fala uderzeniowa (refrakcja, bez obrysu) + pchnięcie dymu; gorące powietrze.
    this.shocks.push({ x: ex, y: ey, t0: this.time, life: 0.55, speed: 2900 * Math.sqrt(k), width: 70 * k, strength: 11 * B.shock, cx, cy });
    this.blasts.push({ x: ex, y: ey, t0: this.time, life: 0.6, speed: 2900 * Math.sqrt(k), width: 110 * k, strength: 5200 * B.shock, type: 0, cx, cy });
    this.hazes.push({ x: ex, y: ey, t0: this.time, life: 0.9, radius: R * 1.3, strength: 3.2, cx, cy });
    // 7. Przypalenie poszycia (żar stygnie, chwilę dymi).
    if (hull && this.opts.scorch) {
      const dxh = x - hull.x;
      const dyh = y - hull.y;
      const ca = Math.cos(-hull.angle);
      const sa = Math.sin(-hull.angle);
      this.scorches.push({
        hull, lx: dxh * ca - dyh * sa, ly: dxh * sa + dyh * ca, t0: this.time, life: 3.2, size: 26 * k, smokeAcc: 0
      });
    }
    this.shake = Math.min(14, this.shake + 3.5 * k);
  }

  _supernova(m, x, y) {
    this.novas.push({ x, y, t0: this.time, stage: 0, cx: m.fx, cy: m.fy });
  }

  _novaDetonate(nv) {
    const rng = this.rng;
    const B = MISSILE_VFX.supernova.blast;
    const { x, y } = nv;
    this._flash(x, y, {
      life: 2.2,
      core: NOVA_CORE, coreSize: 150, tauCore: 0.09,
      halo: NOVA_HALO, haloSize: 1900, tauHalo: 0.32,
      light: { color: [0.95, 0.62, 1.0], I1: 26, tau1: 0.12, I2: 4.0, tau2: 0.95, range: 8000, z: 400 }
    });
    // Linia anamorficzna (w poziomie ekranu), cienka i krótka.
    const sx = this.sx(x);
    const sy = this.sy(y);
    this.arcs.line(this.time, sx - 1500, sy, sx + 1500, sy, { life: 0.4, corePx: 1.1, glowPx: 5, core: [6, 8.5, 10], glow: [0.28, 0.6, 0.9], z: 95 });
    this.arcs.line(this.time, sx - 520, sy, sx + 520, sy, { life: 0.22, corePx: 1.8, glowPx: 9, core: [12, 10, 14], glow: [0.45, 0.4, 0.9], z: 96 });
    // Fala: refrakcja i wymiatanie dymu (front hamuje jak fala Sedova).
    this.shocks.push({ x, y, t0: this.time, life: 1.3, rMax: 2700, tauR: 0.42, width: 170, strength: 22, cx: 0, cy: 0, nova: true });
    this.blasts.push({ x, y, t0: this.time, life: 1.3, rMax: 2700, tauR: 0.42, width: 220, strength: 16000, type: 0, cx: 0, cy: 0 });
    this.hazes.push({ x, y, t0: this.time, life: 1.8, radius: 700, strength: 5, cx: 0, cy: 0 });
    // Pozostałość.
    this.nebula.spawn(this.time, sx, sy, { count: 110000, speed: 1250, size: 9, life: 4.2, gain: 0.22 });
    // Iskry gwiezdne.
    const n = Math.round(B.sparks * this.opts.blastGain);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const sp = 900 + rng() * 3900;
      const col = rng() < 0.7 ? SPARK_COLORS.nova : (rng() < 0.5 ? SPARK_COLORS.ion : [1, 0.85, 0.95]);
      this._spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + rng() * 1.3, 0.3 + rng() * 0.5, 0.8 + rng() * 0.9, col, 0.8, 0, 0, 36);
    }
    this.shake = Math.min(26, this.shake + 20);
  }

  // --- klatka -------------------------------------------------------------------

  update(dt, time) {
    this.time = time;
    const rng = this.rng;
    this.shake *= Math.exp(-dt * 5.5);
    // Supernowe: etapy sekwencji.
    let boost = 0;
    let expo = 1;
    for (const nv of this.novas) {
      const a = time - nv.t0;
      if (nv.stage === 0 && a >= 0.24) { nv.stage = 1; this._novaDetonate(nv); }
      if (a < 0.24) expo = Math.min(expo, 1 - 0.2 * smooth(a / 0.24));
      else {
        const b = a - 0.24;
        boost = Math.max(boost, 1.3 * Math.exp(-b / 0.25));
        expo = Math.min(expo, 1 - 0.2 * Math.exp(-b / 0.05));
      }
    }
    this.novas = this.novas.filter((nv) => time - nv.t0 < 4.6);
    this.bloomBoost = boost;
    this.exposure = expo;

    // Płonące odłamki: lot z oporem, smuga dymu, iskry z żaru.
    const keep = [];
    for (const f of this.fragments) {
      const a = time - f.t0;
      if (a > f.life) {
        this._puff(f.x, f.y, f.vx * 0.2, f.vy * 0.2, f.cx, f.cy, 6 * f.size, 30 * f.size, 1.6, 0.4, SMOKE_KIND.DEBRIS, 0.3, 0, 18);
        continue;
      }
      const e = Math.exp(-f.drag * dt);
      const x0 = f.x;
      const y0 = f.y;
      f.x += (f.vx * (1 - e) / f.drag) + f.cx * dt;
      f.y += (f.vy * (1 - e) / f.drag) + f.cy * dt;
      f.vx *= e; f.vy *= e;
      const d = Math.hypot(f.x - x0, f.y - y0);
      f.acc += d;
      const heat = f.heat * (1 - a / f.life);
      const sp = 7;
      let g = 0;
      while (f.acc > sp && g++ < 64) {
        f.acc -= sp;
        const u = d > 1e-6 ? clamp(1 - f.acc / d, 0, 1) : 1;
        this._puff(x0 + (f.x - x0) * u, y0 + (f.y - y0) * u, f.vx * 0.08, f.vy * 0.08, f.cx, f.cy,
          2.2 * f.size, 14 * f.size * (0.8 + rng() * 0.4), 1.3 + rng() * 1.5, heat * 0.35, SMOKE_KIND.DEBRIS, 0.32, (1 - u) * dt, 16, Math.atan2(f.vy, f.vx));
      }
      if (rng() < dt * 22 * heat) {
        const aa = rng() * TAU;
        this._spark(f.x, f.y, f.vx * 0.3 + Math.cos(aa) * 150, f.vy * 0.3 + Math.sin(aa) * 150, 0.25 + rng() * 0.3, 0.2 + rng() * 0.2, 3, SPARK_COLORS.warm, 0.8, f.cx, f.cy);
      }
      keep.push(f);
    }
    this.fragments = keep;

    // Przypalenia: dymią przez pierwsze 1,6 s.
    this.scorches = this.scorches.filter((sc) => time - sc.t0 < sc.life);
    for (const sc of this.scorches) {
      const a = time - sc.t0;
      if (a > 1.6) continue;
      sc.smokeAcc += dt;
      while (sc.smokeAcc > 0.045) {
        sc.smokeAcc -= 0.045;
        const p = this._scorchWorld(sc);
        const ang = rng() * TAU;
        this._puff(p.x, p.y, Math.cos(ang) * 40, Math.sin(ang) * 40, sc.hull.vx || 0, sc.hull.vy || 0,
          5 + rng() * 5, 24 + rng() * 14, 1.6 + rng() * 1.6, 0.55 * (1 - a / 1.6), SMOKE_KIND.SOOT, 0.22, 0, 16);
      }
    }
    this.flashes = this.flashes.filter((f) => time - f.t0 < f.life);
    this.shocks = this.shocks.filter((s) => time - s.t0 < s.life);
    this.blasts = this.blasts.filter((b) => time - b.t0 < b.life);
    this.hazes = this.hazes.filter((h) => time - h.t0 < h.life);
    this.stats.flashes = this.flashes.length;
    this.stats.fragments = this.fragments.length;
    this.stats.novas = this.novas.length;
  }

  _scorchWorld(sc) {
    const h = sc.hull;
    const c = Math.cos(h.angle);
    const s = Math.sin(h.angle);
    return { x: h.x + sc.lx * c - sc.ly * s, y: h.y + sc.lx * s + sc.ly * c };
  }

  _shockRadius(s, a) {
    if (s.rMax) return s.rMax * (1 - Math.exp(-a / s.tauR));
    return s.speed * a;
  }

  /** Wizualia rakiet w locie (kadłubki, płomienie) — co klatkę. */
  addMissiles(list, time) {
    for (const m of list) {
      const vfx = MISSILE_VFX[m.vfx];
      const bs = m.p.bodyScale;
      const L = ROCKET_BODY_LENGTH * bs;
      const ud = m.userData;
      const sx = this.sx(m.x);
      const sy = this.sy(m.y);
      const ang = -m.heading;
      const roll = time * 3.5 + m.seed * TAU;
      const on = m.state === 'POWERED';
      this.bodies.add(sx, sy, 44, ang, L, vfx.body.hull, vfx.body.band, on ? 1 : 0, roll);
      if (!on) continue;
      const c = Math.cos(m.heading);
      const s = Math.sin(m.heading);
      const nx = m.x - c * L * 0.5;
      const ny = m.y - s * L * 0.5;
      const P = vfx.plume;
      const flick = 0.9 + 0.1 * Math.sin(time * 41 + ud.flick) * Math.sin(time * 27 + ud.flick * 3);
      const thr = m.throttle;
      const len = L * P.len * (0.5 + 0.5 * thr) * flick * (m.vfx === 'supernova' ? 1 : (0.8 + 0.2 * Math.min(1, m.t * 2)));
      this.plumes.add(this.sx(nx), this.sy(ny), 46, -c, s, len, L * P.width, Math.max(0.2, thr), P.kind, m.seed, 1.0, P.core, P.hot, P.mid);
    }
  }

  /** Światła siatki: dysze, błyski, odłamki, supernowe. */
  addLights(grid, list, time) {
    let n = 0;
    for (const m of list) {
      if (m.state !== 'POWERED') continue;
      const vfx = MISSILE_VFX[m.vfx];
      const L = vfx.light;
      const bl = ROCKET_BODY_LENGTH * m.p.bodyScale;
      const c = Math.cos(m.heading);
      const s = Math.sin(m.heading);
      const x = m.x - c * bl * 1.4;
      const y = m.y - s * bl * 1.4;
      const flick = 0.9 + 0.1 * Math.sin(time * 33 + m.seed * 20);
      let I = L.intensity * (0.45 + 0.55 * m.throttle) * flick;
      if (m.vfx === 'supernova' && m.phase === 'terminal') I *= 1 + 1.5 * pulse(m.terminalT);
      if (grid.add(this.sx(x), this.sy(y), 40, L.range, L.color[0] * I, L.color[1] * I, L.color[2] * I, 0.9) >= 0) n++;
    }
    for (const f of this.flashes) {
      const L = f.light;
      if (!L) continue;
      const a = time - f.t0;
      const I = L.I1 * Math.exp(-a / L.tau1) + L.I2 * Math.exp(-a / L.tau2);
      if (I < 0.01) continue;
      const x = f.x + (f.cx || 0) * a;
      const y = f.y + (f.cy || 0) * a;
      const range = L.range * (0.6 + 0.4 * Math.min(1, a / 0.15));
      if (grid.add(this.sx(x), this.sy(y), L.z, range, L.color[0] * I, L.color[1] * I, L.color[2] * I, 1.0) >= 0) n++;
    }
    for (const f of this.fragments) {
      const a = time - f.t0;
      const h = f.heat * (1 - a / f.life);
      if (h < 0.05) continue;
      if (grid.add(this.sx(f.x), this.sy(f.y), 30, 260 * f.size, 1.0 * h, 0.45 * h, 0.15 * h, 0.8) >= 0) n++;
    }
    for (const sc of this.scorches) {
      const a = time - sc.t0;
      const h = Math.exp(-a / 0.7);
      if (h < 0.03) continue;
      const p = this._scorchWorld(sc);
      if (grid.add(this.sx(p.x), this.sy(p.y), 24, 320, 1.1 * h, 0.45 * h, 0.12 * h, 0.7) >= 0) n++;
    }
    for (const nv of this.novas) {
      const a = time - nv.t0;
      if (a < 0.24) {
        const I = 3 * smooth(a / 0.24);
        grid.add(this.sx(nv.x), this.sy(nv.y), 60, 1400, 0.8 * I, 0.6 * I, 1.0 * I, 1.0);
        n++;
      } else {
        const b = a - 0.24;
        const I = 1.4 * Math.exp(-b / 1.6);
        if (I > 0.02) { grid.add(this.sx(nv.x), this.sy(nv.y), 80, 2600, 0.6 * I, 0.75 * I, 1.0 * I, 1.0); n++; }
      }
    }
    this.stats.lights = n;
  }

  /** Duszki blasku: błyski, głowice supernowych, odłamki, przypalenia, jądro supernowej. */
  addGlows(glow, list, time) {
    for (const f of this.flashes) {
      const a = time - f.t0;
      const x = this.sx(f.x + (f.cx || 0) * a);
      const y = this.sy(f.y + (f.cy || 0) * a);
      const kc = Math.exp(-a / f.tauCore);
      const kh = Math.exp(-a / f.tauHalo);
      if (kh > 0.004) glow.add(x, y, 90, f.haloSize * (0.7 + 0.6 * Math.min(1, a / 0.2)), f.halo[0] * kh, f.halo[1] * kh, f.halo[2] * kh, GLOW_ROUND);
      if (kc > 0.004) glow.add(x, y, 92, f.coreSize * (0.8 + a * 3), f.core[0] * kc, f.core[1] * kc, f.core[2] * kc, GLOW_ROUND);
    }
    for (const m of list) {
      if (m.vfx !== 'supernova') continue;
      const bl = ROCKET_BODY_LENGTH * m.p.bodyScale;
      const x = m.x + Math.cos(m.heading) * bl * 0.42;
      const y = m.y + Math.sin(m.heading) * bl * 0.42;
      let k = 1.0 + 0.2 * Math.sin(time * 9 + m.seed * 10);
      if (m.phase === 'terminal') k += 2.2 * pulse(m.terminalT);
      glow.add(this.sx(x), this.sy(y), 52, 11 * m.p.bodyScale, 2.0 * k, 0.6 * k, 2.2 * k, GLOW_ROUND);
    }
    for (const f of this.fragments) {
      const a = time - f.t0;
      const h = f.heat * (1 - a / f.life);
      if (h < 0.03) continue;
      const sp = Math.hypot(f.vx, f.vy) || 1;
      // Żarzący się odłamek: mały punkt (smugę robi jego dym).
      glow.add(this.sx(f.x), this.sy(f.y), 40, 6 * f.size, 3.4 * h, 1.5 * h, 0.45 * h, GLOW_ROUND);
      void sp;
    }
    for (const sc of this.scorches) {
      const a = time - sc.t0;
      const t = a / sc.life;
      const hot = Math.exp(-a / 0.35);
      const warm = Math.exp(-a / 1.2) * (1 - t);
      const p = this._scorchWorld(sc);
      glow.add(this.sx(p.x), this.sy(p.y), 8, sc.size * (1 + 0.4 * Math.min(1, a)), 3.2 * hot + 1.0 * warm, 1.6 * hot + 0.3 * warm, 0.6 * hot + 0.05 * warm, GLOW_ROUND);
    }
    for (const nv of this.novas) {
      const a = time - nv.t0;
      const x = this.sx(nv.x);
      const y = this.sy(nv.y);
      if (a < 0.24) {
        const t = smooth(a / 0.24);
        glow.add(x, y, 94, 10 + 40 * t, 8 + 22 * t, 7 + 18 * t, 10 + 24 * t, GLOW_ROUND);
      } else {
        const b = a - 0.24;
        // Stygnące jądro z pulsowaniem (gwiazda neutronowa w skrócie).
        const core = Math.exp(-b / 1.1);
        const pul = 0.6 + 0.4 * Math.max(0, Math.sin(b * TAU * 6.5)) ** 6;
        glow.add(x, y, 93, 26, 6 * core * pul, 7 * core * pul, 10 * core * pul, GLOW_ROUND);
        const hot = Math.exp(-b / 0.9);
        glow.add(x, y, 91, 420 + 900 * (1 - Math.exp(-b / 0.5)), 0.18 * hot, 0.26 * hot, 0.42 * hot, GLOW_ROUND);
      }
    }
  }

  /** Siły w dymie: fale wybuchów, implozje, ślady rakiet. */
  fillForces(smoke, list, time, camX, camY) {
    const bl = this._blastList;
    bl.length = 0;
    for (const b of this.blasts) {
      const a = time - b.t0;
      const R = this._shockRadius(b, a);
      const fade = 1 - a / b.life;
      bl.push({ x: this.sx(b.x + b.cx * a), y: this.sy(b.y + b.cy * a), front: R, width: b.width * (1 + a * 1.5), strength: b.strength * fade * fade / (1 + R / 900), type: 0 });
    }
    for (const nv of this.novas) {
      const a = time - nv.t0;
      if (a < 0.26) {
        const t = smooth(a / 0.24);
        bl.push({ x: this.sx(nv.x), y: this.sy(nv.y), front: 0, width: 60, strength: 5200 * t, type: 1, reach: 1500 });
      }
    }
    const wl = this._wakeList;
    wl.length = 0;
    if (this.opts.wakes) {
      for (const m of list) {
        if (m.state !== 'POWERED') continue;
        const bs = m.p.bodyScale;
        const L = ROCKET_BODY_LENGTH * bs;
        const c = Math.cos(m.heading);
        const s = Math.sin(m.heading);
        const back = Math.min(260, m.speed * 0.05);
        wl.push({
          x0: this.sx(m.x - c * back), y0: this.sy(m.y - s * back), x1: this.sx(m.x + c * L), y1: this.sy(m.y + s * L),
          radius: 30 * Math.sqrt(bs) + 10, strength: 26, vx: (m.vx + m.fx) * 0.25, vy: -(m.vy + m.fy) * 0.25,
          d2: (m.x - camX) ** 2 + (m.y - camY) ** 2
        });
      }
      if (wl.length > 64) wl.sort((a, b) => a.d2 - b.d2);
    }
    smoke.setForces(bl, wl);
  }

  /** Źródła zniekształceń (scena). */
  fillDistortion(post, time) {
    for (const s of this.shocks) {
      const a = time - s.t0;
      const R = this._shockRadius(s, a);
      const k = 1 - a / s.life;
      post.add(0, this.sx(s.x + s.cx * a), this.sy(s.y + s.cy * a), R, s.width * (1 + a * 0.8), s.strength * k * k, s.nova ? 0.45 : 0.35);
    }
    for (const nv of this.novas) {
      const a = time - nv.t0;
      if (a < 0.3) {
        const t = smooth(Math.min(1, a / 0.24));
        const out = a > 0.24 ? 1 - (a - 0.24) / 0.06 : 1;
        post.add(1, this.sx(nv.x), this.sy(nv.y), 720, 0, 30 * t * Math.max(0, out), 0.35);
      }
    }
    for (const h of this.hazes) {
      const a = time - h.t0;
      const k = 1 - a / h.life;
      post.add(2, this.sx(h.x + h.cx * a), this.sy(h.y + h.cy * a), h.radius * (1 + a * 0.6), 0, h.strength * k, 0);
    }
  }

  clear() {
    this.flashes.length = 0;
    this.blasts.length = 0;
    this.shocks.length = 0;
    this.hazes.length = 0;
    this.fragments.length = 0;
    this.scorches.length = 0;
    this.novas.length = 0;
    this.shake = 0;
  }
}

function smooth(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Puls głowicy w fazie końcowej: częstotliwość rośnie 6 → 16 Hz, więc fazę
 * CAŁKUJEMY (∫f dt), a nie liczymy czas × częstotliwość (to przyspieszałoby
 * puls podwójnie i skakało przy zmianie tempa).
 */
function pulse(t) {
  const tc = 10 / 14;
  const phase = t < tc ? 6 * t + 7 * t * t : 6 * tc + 7 * tc * tc + 16 * (t - tc);
  return Math.max(0, Math.sin(phase * TAU)) ** 4;
}

export { lin };
