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
//   • SUPERNOWA (wersja z gry, src/3d/rockets/effects.js — stan 2026-11-09): implozja
//     (wsysanie dymu, soczewka do środka, przygaszenie), detonacja ×NOVA_SCALE (oślepiający
//     błysk, linia anamorficzna, światło na pół kadru, podbicie bloomu), fala z falą odbitą
//     (refrakcja + wymiatanie dymu, siła z sufitem z zoomu), gorące powietrze o grubszym wzorze,
//     pozostałość z WIREM i dżetami pulsara (nebula.js), tysiące iskier, stygnące jądro
//     z pulsowaniem i wirujące snopy pulsara; sekwencja NOVA_SEQ_END = 2,8 s;
//   • NISZCZYCIEL (tylko demo, 2026-11-10 — jedna ciężka rakieta przeciw kadłubowi): ciężki zapłon nad
//     pokładem (pierścień spalin, iskry), lot członem startowym z gęstym dymem, START SPRINTU (człon
//     startowy odpada i koziołkuje, penetrator odpala błękitną lancę, rozgrzane czoło, iskry zjonizowanego
//     gazu), TRAFIENIE: głowica przebija poszycie (snop iskier z otworu, żar bije przez kadłub wzdłuż jej
//     toru), po zwłoce WYBUCH W ŚRODKU — kula ognia i dym z GAZU NA SIATCE 3D gry (gasBlast.js) ze
//     strumieniami z otworu wlotowego, z wylotu po drugiej stronie i z burt, błysk, iskry, płonące odłamki,
//     fala (sama refrakcja), gorące powietrze, wybuchy WTÓRNE w kadłubie, dogasające ogniska w otworach.

import { MISSILE_VFX, SMOKE_PALETTES, SMOKE_KIND, SPARK_COLORS, PULSAR_BEAM, lin } from './palette.js';
import { ROCKET_BODY_LENGTH } from './flight.js';
import { GLOW_ROUND, GLOW_STREAK } from './common.js';
import { GAS_LIGHT_OWNER_BASE } from './gasBlast.js';

const TAU = Math.PI * 2;
// Skrót perspektywy z wysokości (jak w grze, src/3d/rockets/effects.js): kadłubek, płomień i łuna
// rosną do ×(1 + LIFT_K) na wysokości LIFT_H — rakieta wyskakująca z komory „podchodzi” ku kamerze.
// Wysokość i wzniesienie nosa mają tylko rakiety z lotem gry (`m.game` — wyrzut Supernowej).
const LIFT_K = 0.45;
const LIFT_H = 160;
const hgtOf = (m) => (m.game && m.z > 0 ? m.z : 0);
const pitchOf = (m) => (m.game ? m.nosePitch || 0 : 0);
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
const NOVA_LIGHT = [0.95, 0.62, 1.0];

// Supernowa jak w grze (src/3d/rockets/effects.js — zmiana tam → przenieś tutaj).
// Życie pozostałości i dżetów [s], prędkość dżetu [j./s]; sekwencja reżysera (jądro, snopy,
// światło) trwa NOVA_SEQ_END od wybuchu głowicy. 2026-10-05 (user): wybuch ~2× większy,
// wir po wybuchu krótki.
const NOVA_REMNANT_LIFE = 2.2;
const NOVA_JET_SPEED = 2000;
const NOVA_JET_SPAN = 1.5;
const NOVA_JET_LIFE = 0.8;
const NOVA_SEQ_END = 2.8;
const NOVA_SCALE = 2;
// Fala: siła [px ekranu] z sufitem na px grubości frontu (capPerWidth), echo — siła fali odbitej.
const NOVA_SHOCK = { life: 1.8, rMax: 3000, tau: 0.5, width: 230, strength: 55, echo: 0.4, capPerWidth: 0.6 };
// Gorące powietrze: core — siła wewnętrznego kłębu, scale — skala wzoru (grubszy — bez „wafla”
// przy nakładaniu się 4 wybuchów), capPerZoom — sufit siły [px] na jednostkę zoomu.
const NOVA_HAZE = { life: 2.6, radius: 1000, strength: 13, core: 1.3, scale: 0.3, capPerZoom: 75 };
// Cząstek pozostałości na jedną supernową — salwa 4 mieści się w pierścieniu mgławicy.
const NOVA_REMNANT_PARTICLES = 64000;

// „NISZCZYCIEL” (tylko demo). Fala i gorące powietrze wybuchu w kadłubie: siła [px ekranu] z sufitami jak
// u Supernowej (cap — na px grubości frontu, capPerZoom — na jednostkę zoomu), echo — fala odbita.
const HEAVY_SHOCK = { life: 1.1, rMax: 2600, tau: 0.36, width: 150, strength: 30, echo: 0.4, cap: 0.6 };
const HEAVY_HAZE = { life: 2.6, radius: 520, strength: 6.5, scale: 0.55, capPerZoom: 40 };
// Rekord wybuchu (podbicie bloomu, kolejka wtórnych) żyje tyle sekund.
const HEAVY_SEQ_END = 6.0;
// Czoło ognia w kadłubie [j./s]: opóźnienie strumieni z wylotu i burt = droga / prędkość.
const HEAVY_FLAME_SPEED = 3200;
// Środek odrzuconego członu startowego: tyle długości kadłubka za środkiem rakiety (missileBodies.js).
const HEAVY_BOOSTER_BACK = 0.28;
// Iskry głowicy „Fala”: obok jonowego błękitu (SPARK_COLORS.ion) prawie białe.
const WAVE_SPARK_WHITE = [0.85, 0.95, 1.0];
const _pa = { x: 0, y: 0 };
const _pb = { x: 0, y: 0 };

export class Effects {
  constructor({ smoke, sparks, plumes, fireballs, nebula, arcs, glow, post, bodies, heavyBodies = null, gas = null, pulsar = null, wave = null, origin }) {
    this.smoke = smoke;
    this.sparks = sparks;
    this.plumes = plumes;
    this.fireballs = fireballs;
    this.nebula = nebula;
    this.arcs = arcs;
    this.glow = glow;
    this.post = post;
    this.bodies = bodies;
    // Kadłubki „Niszczyciela” ({ full, dart, booster } — MissileBodies) i jego trzy głowice: „Fala”
    // (WaveBlast — rozmyta poświata i fala refrakcji od środka, domyślna), „Pulsar” (PulsarBlast)
    // i wybuch z gazu na siatce 3D gry (GasBlast).
    this.heavyBodies = heavyBodies;
    this.gas = gas;
    this.pulsar = pulsar;
    this.wave = wave;
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
    // „Niszczyciel”: głowice w kadłubie (przebicie → wybuch), rekordy wybuchów, kolejka wtórnych,
    // odrzucone człony startowe.
    this.pens = [];
    this.heavies = [];
    this.cookoffs = [];
    this.boosters = [];
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
      blastGain: 1,
      // Głowica „Niszczyciela”: 'wave' — „Fala” (waveBlast.js), 'pulsar' — „Pulsar” (pulsar.js), 'gas' — kula
      // ognia z gazu gry (gasBlast.js). Rakieta z własnym polem `warhead` bierze je zamiast tej opcji.
      heavyWarhead: 'wave'
    };
    this._blastList = [];
    this._wakeList = [];
    this.stats = { flashes: 0, fragments: 0, novas: 0, lights: 0, heavies: 0 };
  }

  // --- pomocnicze -------------------------------------------------------------

  sx(x) { return x - this.ox; }
  sy(y) { return -(y - this.oy); }

  /**
   * Ułamek długości kadłubka od środka do dyszy: 0,5 — rufa rakiety; po odrzuceniu członu startowego
   * („Niszczyciel” w sprincie, m.stage === 2) — dysza penetratora (`body.tail2`).
   */
  _tailK(m) {
    return m.stage === 2 ? (MISSILE_VFX[m.vfx].body.tail2 ?? 0.5) : 0.5;
  }

  /** Dysza w świecie (x, y) i jej wysokość h — z wzniesieniem nosa (lot gry). */
  _nozzle(m, out) {
    const L = ROCKET_BODY_LENGTH * m.p.bodyScale;
    const tail = this._tailK(m);
    const pitch = pitchOf(m);
    const cp = Math.cos(pitch);
    out.x = m.x - Math.cos(m.heading) * cp * L * tail;
    out.y = m.y - Math.sin(m.heading) * cp * L * tail;
    out.h = Math.max(0, hgtOf(m) - Math.sin(pitch) * L * tail);
    return out;
  }

  /** Punkt świata → układ kadłuba `h` (oś x wzdłuż kadłuba) i z powrotem. */
  _toHull(h, wx, wy, out) {
    const dx = wx - h.x;
    const dy = wy - h.y;
    const c = Math.cos(h.angle);
    const s = Math.sin(h.angle);
    out.x = dx * c + dy * s;
    out.y = -dx * s + dy * c;
    return out;
  }

  _fromHull(h, lx, ly, out) {
    const c = Math.cos(h.angle);
    const s = Math.sin(h.angle);
    out.x = h.x + lx * c - ly * s;
    out.y = h.y + lx * s + ly * c;
    return out;
  }

  /**
   * Promień z punktu (x, y) wzdłuż (dx, dy) przez kadłub: pierwszy punkt POZA sylwetką po przejściu przez
   * jej wnętrze, do `max` j. — { x, y, d } (tuż pod poszyciem) albo null.
   */
  _hullExit(h, x, y, dx, dy, max) {
    let inside = false;
    for (let t = 0; t <= max; t += 12) {
      const d = h.sdfAt(x + dx * t, y + dy * t);
      if (d < -4) inside = true;
      else if (inside && d > 0) return { x: x + dx * (t - 8), y: y + dy * (t - 8), d: t };
    }
    return null;
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
    const n = { x: 0, y: 0, h: 0 };
    this._nozzle(m, n);
    ud.nx0 = n.x; ud.ny0 = n.y; ud.nh0 = n.h; ud.acc = 0; ud.vAcc = 0; ud.tick = 0; ud.ionAcc = 0;
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
    const n = { x: 0, y: 0, h: 0 };
    this._nozzle(m, n);
    ud.nx0 = n.x; ud.ny0 = n.y; ud.nh0 = n.h; ud.acc = 0;
    const c = Math.cos(m.heading);
    const s = Math.sin(m.heading);
    const L = vfx.light;
    this._flash(n.x, n.y, {
      life: 0.3, core: vfx.plume.core.map((v) => v * 0.7), coreSize: 30 * bs, tauCore: 0.05,
      halo: vfx.plume.hot.map((v) => v * 0.25), haloSize: 160 * bs, tauHalo: 0.1,
      light: { color: L.color, I1: 3.0 * L.intensity, tau1: 0.08, I2: 0, tau2: 1, range: L.range * 1.1, z: 40 + n.h }
    });
    // Kłąb gorących spalin przy zapłonie (chemiczny dym supernowej słabiej — świeci sam i łapie
    // jej magentowe światło). Jak w grze: z pionu strumień bije w pokład i rozlewa się pierścieniem,
    // z poziomu idzie stożkiem do tyłu (mieszanka według wzniesienia nosa).
    const kind = vfx.trail.kind;
    const nova = m.vfx === 'supernova';
    const sp0 = Math.sin(pitchOf(m));
    const steep = sp0 > 0 ? sp0 : 0;
    for (let i = 0; i < (nova ? 9 : 12); i++) {
      let vx;
      let vy;
      if (rng() < steep) {
        const a = rng() * TAU;
        const v = (180 + rng() * 460) * (0.55 + 0.45 * steep);
        vx = Math.cos(a) * v;
        vy = Math.sin(a) * v;
      } else {
        const sp = 250 + rng() * 550;
        const spread = (rng() - 0.5) * 1.6;
        vx = -(c * Math.cos(spread) - s * Math.sin(spread)) * sp;
        vy = -(s * Math.cos(spread) + c * Math.sin(spread)) * sp;
      }
      this._puff(n.x, n.y, vx, vy, m.fx, m.fy, (4 + rng() * 3) * Math.sqrt(bs), (30 + rng() * 20) * Math.sqrt(bs),
        0.8 + rng() * 1.4, nova ? 0.45 : 1.0, kind, 0.42 + rng() * 0.15, rng() * 0.02, 12 + n.h * 0.25);
    }
    if (vfx.heavy && steep > 0.5) {
      // Ciężki zapłon nad pokładem („Niszczyciel”): pierścień spalin rozlany po kadłubie, snop iskier,
      // gorące powietrze i wstrząs — silnik członu startowego bije w pokład, zanim rakieta się położy.
      const sq = Math.sqrt(bs);
      for (let i = 0; i < 26; i++) {
        const a = rng() * TAU;
        const v = 240 + rng() * 620;
        this._puff(n.x + Math.cos(a) * 6, n.y + Math.sin(a) * 6, Math.cos(a) * v, Math.sin(a) * v, m.fx, m.fy,
          (5 + rng() * 5) * sq, (34 + rng() * 26) * sq, 1.4 + rng() * 2.2, 0.75, kind, 0.34 + rng() * 0.14, rng() * 0.03, 10 + n.h * 0.15);
      }
      for (let i = 0; i < 70; i++) {
        const a = rng() * TAU;
        const v = 500 + rng() * 1700;
        this._spark(n.x, n.y, Math.cos(a) * v, Math.sin(a) * v, 0.25 + rng() * 0.5, 0.25 + rng() * 0.35, 2.6,
          rng() < 0.6 ? SPARK_COLORS.gold : SPARK_COLORS.warm, 0.9, m.fx, m.fy, 30);
      }
      this.hazes.push({ x: n.x, y: n.y, t0: this.time, life: 1.2, radius: 300, strength: 4.5, cx: m.fx, cy: m.fy });
      this.shake = Math.min(14, this.shake + 3);
    }
  }

  /**
   * „Niszczyciel”: START SPRINTU (flight.js — m.stage właśnie zmienił się na 2). Człon startowy jest
   * wypalony: odpada i koziołkuje (boosters), penetrator odpala własny silnik — błękitny błysk przy dyszy,
   * pierścień gazu z ładunków rozdzielających, iskry w tył.
   */
  onSprint(m) {
    const rng = this.rng;
    const vfx = MISSILE_VFX[m.vfx];
    const bs = m.p.bodyScale;
    const ud = m.userData;
    const L = ROCKET_BODY_LENGTH * bs;
    const c = Math.cos(m.heading);
    const s = Math.sin(m.heading);
    const pitch = pitchOf(m);
    const cp = Math.cos(pitch);
    const hgt = hgtOf(m);
    const sq = Math.sqrt(bs);
    // Środek członu startowego na obrazie (kadłubek rysuje się × skrót perspektywy z wysokości).
    const lift = 1 + LIFT_K * (hgt < LIFT_H ? hgt / LIFT_H : 1);
    const bx = m.x - c * cp * L * lift * HEAVY_BOOSTER_BACK;
    const by = m.y - s * cp * L * lift * HEAVY_BOOSTER_BACK;
    const side = rng() < 0.5 ? -1 : 1;
    const kick = 30 + rng() * 50;
    this.boosters.push({
      x: bx, y: by, h: hgt, vx: m.vx * 0.86 - s * side * kick, vy: m.vy * 0.86 + c * side * kick, cx: m.fx, cy: m.fy,
      ang: m.heading, spin: side * (1.6 + rng() * 2.6), pitch, pitchSpin: (rng() - 0.5) * 3, roll: rng() * TAU,
      t0: this.time, life: 2.6, bs, drag: 0.55, acc: 0, vfx: m.vfx
    });
    // Dysza penetratora (m.stage === 2): od niej liczy się dalej smuga.
    const n = { x: 0, y: 0, h: 0 };
    this._nozzle(m, n);
    ud.nx0 = n.x; ud.ny0 = n.y; ud.nh0 = n.h; ud.acc = 0; ud.ionAcc = 0;
    const P2 = vfx.plume2 || vfx.plume;
    const L2 = vfx.light2 || vfx.light;
    this._flash(n.x, n.y, {
      life: 0.3, cx: m.fx, cy: m.fy,
      core: P2.core.map((v) => v * 0.9), coreSize: 16 * bs, tauCore: 0.05,
      halo: P2.mid.map((v) => v * 0.5), haloSize: 150 * bs, tauHalo: 0.09,
      light: { color: L2.color, I1: 4 * L2.intensity, tau1: 0.09, I2: 0, tau2: 1, range: L2.range * 1.4, z: 40 + n.h }
    });
    for (let i = 0; i < 18; i++) {
      const sd = i % 2 ? 1 : -1;
      const v = 90 + rng() * 260;
      const fwd = 0.25 + rng() * 0.2;
      this._puff(bx + c * L * 0.2, by + s * L * 0.2, m.vx * fwd - s * sd * v, m.vy * fwd + c * sd * v, m.fx, m.fy,
        (3 + rng() * 3) * sq, (20 + rng() * 16) * sq, 0.7 + rng() * 1.1, 0.5, SMOKE_KIND.BOOST, 0.3 + rng() * 0.12, 0, 12 + hgt);
    }
    for (let i = 0; i < 50; i++) {
      const a = m.heading + Math.PI + (rng() - 0.5) * 1.5;
      const v = 300 + rng() * 1500;
      this._spark(n.x, n.y, m.vx * 0.5 + Math.cos(a) * v, m.vy * 0.5 + Math.sin(a) * v, 0.2 + rng() * 0.45, 0.2 + rng() * 0.3, 2.8,
        rng() < 0.6 ? SPARK_COLORS.ion : SPARK_COLORS.gold, 0.9, m.fx, m.fy, 32 + hgt);
    }
    this.shake = Math.min(14, this.shake + 1.5);
  }

  /** Para zimnego wyrzutu przed zapłonem (lot gry): rzadkie kłęby wzdłuż drogi dyszy w zawisie. */
  _popVapor(m, dt, n) {
    const ud = m.userData;
    const rng = this.rng;
    const L = ROCKET_BODY_LENGTH * m.p.bodyScale;
    const pitch = pitchOf(m);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const c = Math.cos(m.heading);
    const s = Math.sin(m.heading);
    const x1 = n.x;
    const y1 = n.y;
    const h1 = n.h;
    const x0 = x1 - (m.vx + m.fx) * dt;
    const y0 = y1 - (m.vy + m.fy) * dt;
    const h0 = Math.max(0, h1 - (m.vz || 0) * dt);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dh = h1 - h0;
    const d = Math.sqrt(dx * dx + dy * dy + dh * dh);
    ud.vAcc = (ud.vAcc || 0) + d;
    const sq = Math.sqrt(m.p.bodyScale);
    let guard = 0;
    while (ud.vAcc >= 7 && guard++ < 16) {
      ud.vAcc -= 7;
      const u = d > 1e-6 ? clamp(1 - ud.vAcc / d, 0, 1) : 1;
      const a = rng() * TAU;
      const v = 20 + rng() * 50;
      this._puff(x0 + dx * u - c * cp * L * 0.1, y0 + dy * u - s * cp * L * 0.1, Math.cos(a) * v, Math.sin(a) * v, m.fx, m.fy,
        (2.4 + rng() * 1.6) * sq, (12 + rng() * 8) * sq, 0.35 + rng() * 0.3, 0, SMOKE_KIND.VAPOR,
        (0.14 + rng() * 0.08) * (0.5 + 0.5 * sp), (1 - u) * dt, 12 + h0 + dh * u);
    }
  }

  onFly(m, dt) {
    const ud = m.userData;
    const vfx = MISSILE_VFX[m.vfx];
    const n = { x: 0, y: 0, h: 0 };
    this._nozzle(m, n);
    if (m.state !== 'POWERED' || !this.opts.trails) {
      if (m.game && m.state !== 'POWERED' && this.opts.trails) this._popVapor(m, dt, n);
      ud.nx0 = n.x; ud.ny0 = n.y; ud.nh0 = n.h;
      return;
    }
    // Smuga członu: „Niszczyciel” w sprincie (m.stage === 2) ciągnie cienką bladą smugę zamiast gęstego dymu.
    const tr = (m.stage === 2 && vfx.trail2) || vfx.trail;
    const rng = this.rng;
    const bs = m.p.bodyScale;
    const c = Math.cos(m.heading);
    const s = Math.sin(m.heading);
    const x0 = ud.nx0;
    const y0 = ud.ny0;
    const h0 = ud.nh0 || 0;
    const dx = n.x - x0;
    const dy = n.y - y0;
    const dh = n.h - h0;
    const d = Math.sqrt(dx * dx + dy * dy + dh * dh);
    // Wzniesienie nosa (lot gry): wylot w płaszczyźnie × cos(el), składowa w dół (nos w górze)
    // uderza w pokład / rozpręża się — rozrzut na boki; słup z pionu — kłęby bez kierunku.
    const pitch = pitchOf(m);
    const cp = Math.cos(pitch);
    const spn = Math.sin(pitch);
    const speed3 = Math.sqrt(m.vx * m.vx + m.vy * m.vy + (m.game ? m.vz * m.vz : 0));
    const spacing = tr.spacing / Math.max(0.25, this.opts.trailDensity);
    ud.acc += d;
    const speed = m.speed;
    const exhaust = Math.max(650, (m.game ? speed3 : speed) * tr.exhaust);
    const exPlanar = exhaust * cp;
    const radial = exhaust * (spn > 0 ? spn : 0) * 0.28;
    const steepAngle = spn > 0.7;
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
      const ra = rng() * TAU;
      const rr = radial * (0.4 + 0.6 * rng());
      const vx = m.vx - c * (exPlanar + lon) - s * lat + Math.cos(ra) * rr;
      const vy = m.vy - s * (exPlanar + lon) + c * lat + Math.sin(ra) * rr;
      const size0 = tr.size0 * Math.pow(bs, 0.7) * (0.8 + rng() * 0.4);
      const temp = tr.temp * thr * (0.85 + rng() * 0.3);
      this._puff(px, py, vx, vy, m.fx, m.fy, size0, grow, life, temp, tr.kind, opac, age0, 10 + rng() * 6 + h0 + dh * u,
        steepAngle ? rng() * TAU : m.heading + (rng() - 0.5) * 0.12);
    }
    ud.nx0 = n.x; ud.ny0 = n.y; ud.nh0 = n.h;

    if (m.stage === 2 && vfx.heavy) {
      // Sprint „Niszczyciela”: iskry zjonizowanego gazu zrywane z rozgrzanego czoła (krótkie, biało-błękitne
      // i złote), co ~26 j. toru — przy 4600 j./s gęsta, szybko gasnąca wstęga wokół smugi.
      ud.ionAcc += d;
      let g2 = 0;
      while (ud.ionAcc > 26 && g2++ < 32) {
        ud.ionAcc -= 26;
        const u = d > 1e-6 ? clamp(1 - ud.ionAcc / d, 0, 1) : 1;
        const a = rng() * TAU;
        const sp = 40 + rng() * 150;
        this._spark(x0 + dx * u + (rng() - 0.5) * 10, y0 + dy * u + (rng() - 0.5) * 10, m.vx * 0.12 + Math.cos(a) * sp, m.vy * 0.12 + Math.sin(a) * sp,
          0.25 + rng() * 0.4, 0.16 + rng() * 0.14, 2.4, rng() < 0.6 ? SPARK_COLORS.ion : SPARK_COLORS.gold, 0.7, m.fx, m.fy, 30 + h0);
      }
    }

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
    else if (MISSILE_VFX[m.vfx].blast.style === 'heavy') this._heavyImpact(m, x, y, hull, nx, ny);
    else this._standard(m, x, y, hull, nx, ny);
  }

  // --- „Niszczyciel”: przebicie kadłuba i wybuch 3D ---------------------------------

  /**
   * TRAFIENIE „Niszczyciela”. W kadłub: głowica PRZEBIJA poszycie — ostry błysk, snop iskier i odprysków
   * z otworu wlotowego — i leci w głąb do `penetration.depth` j.; po `penetration.delay` s wybucha W ŚRODKU
   * (_heavyDetonate). Tor liczony w układzie kadłuba (wybuch jedzie z okrętem). Cienki kadłub, przez który
   * tor wychodzi na drugą stronę — wybuch w połowie drogi w sylwetce. Bez kadłuba (cel-punkt, zapalnik
   * zbliżeniowy, cel minięty w sprincie) — wybuch od razu, w pustce.
   */
  _heavyImpact(m, x, y, hull, nx, ny) {
    const rng = this.rng;
    const ux = Math.cos(m.heading);
    const uy = Math.sin(m.heading);
    const warhead = m.warhead || this.opts.heavyWarhead;
    if (!hull) {
      this._heavyDetonate({ x, y, ux, uy, nx: -ux, ny: -uy, hull: null, cx: m.fx, cy: m.fy, entry: null, warhead });
      return;
    }
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const cx = hull.vx || 0;
    const cy = hull.vy || 0;
    const pen = m.p.penetration || { depth: 150, delay: 0.15 };
    // Najgłębszy punkt toru w sylwetce (próbki co 10 j.; pierwsze wyjście z kadłuba kończy tor).
    let depth = 0;
    for (let t = 10; t <= pen.depth; t += 10) {
      if (hull.sdfAt(x + ux * t, y + uy * t) < -6) depth = t;
      else if (depth > 0) break;
    }
    const inner = depth >= pen.depth - 10 ? depth : depth * 0.55;
    const gain = this.opts.blastGain;
    // Wejście: ostry biały błysk, iskry i odpryski w półprzestrzeń od poszycia, kłąb pyłu, krótka fala.
    this._flash(x, y, {
      life: 0.5, cx, cy,
      core: [16, 14, 11], coreSize: 30, tauCore: 0.03,
      halo: [0.7, 0.5, 0.3], haloSize: 300, tauHalo: 0.06,
      light: { color: [1.0, 0.8, 0.6], I1: 7, tau1: 0.05, I2: 0, tau2: 1, range: 1900, z: 120 }
    });
    const an = Math.atan2(ny, nx);
    const nSp = Math.round(220 * gain);
    for (let i = 0; i < nSp; i++) {
      const a = an + (rng() - 0.5) * 2 * 0.95;
      const sp = 1400 + rng() * 4200;
      const col = rng() < 0.45 ? SPARK_COLORS.gold : (rng() < 0.6 ? SPARK_COLORS.warm : [1.0, 0.9, 0.75]);
      this._spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + rng() * 0.6, 0.3 + rng() * 0.5, 2.2 + rng() * 1.6, col, 1, cx, cy);
    }
    if (this.opts.fragments) {
      for (let i = 0; i < 5; i++) {
        const a = an + (rng() - 0.5) * 2 * 0.9;
        const sp = 500 + rng() * 900;
        this.fragments.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, cx, cy,
          t0: this.time, life: 0.7 + rng() * 0.8, drag: 1.2 + rng() * 0.6, acc: 0, heat: 0.7 + rng() * 0.4,
          size: 0.8 + rng() * 0.6, nx0: x, ny0: y
        });
      }
    }
    for (let i = 0; i < 14; i++) {
      const a = an + (rng() - 0.5) * 2 * 1.2;
      const sp = 120 + rng() * 420;
      this._puff(x, y, Math.cos(a) * sp, Math.sin(a) * sp, cx, cy, 8 + rng() * 10, 30 + rng() * 22, 1.6 + rng() * 2.0,
        0.25, SMOKE_KIND.SOOT, 0.22 + rng() * 0.1, rng() * 0.03, 18 + rng() * 8);
    }
    this.shocks.push({ x, y, t0: this.time, life: 0.35, speed: 2600, width: 46, strength: 7, cx, cy });
    this.shake = Math.min(14, this.shake + 4);
    // Rekord przebicia w układzie kadłuba: wlot e, punkt wybuchu i, kierunek lotu u, normalna poszycia n.
    const c = Math.cos(hull.angle);
    const s = Math.sin(hull.angle);
    const e = this._toHull(hull, x, y, _pa);
    const pn = {
      hull, t0: this.time, delay: pen.delay, depth: inner, stage: 0, sparkAcc: 0, warhead,
      ex: e.x, ey: e.y, ix: 0, iy: 0,
      ulx: ux * c + uy * s, uly: -ux * s + uy * c,
      nlx: nx * c + ny * s, nly: -nx * s + ny * c
    };
    const ip = this._toHull(hull, x + ux * inner, y + uy * inner, _pa);
    pn.ix = ip.x; pn.iy = ip.y;
    this.pens.push(pn);
  }

  /**
   * WYBUCH „Niszczyciela” w punkcie (x, y) świata; (ux, uy) — kierunek lotu głowicy, (nx, ny) — normalna poszycia
   * przy wlocie, entry — otwór wlotowy (świat) albo null. W kadłubie gaz dostaje STRUMIENIE z otworów: wsteczny
   * kanałem wlotowym, z wylotu po drugiej stronie (promień wzdłuż lotu aż do burty) i z burt w poprzek; w otworach
   * zostają dogasające ogniska, w kadłubie odpalają wybuchy wtórne. Kula ognia, dym i żar: gaz 3D (gasBlast.js).
   */
  _heavyDetonate({ x, y, ux, uy, nx, ny, hull, cx, cy, entry, warhead }) {
    if (warhead === 'wave' && this.wave) {
      // Głowica „Fala”: poświatę, falę refrakcji, haze i światło prowadzi waveBlast.js (nośnik = trafiony kadłub).
      // Reżyser dokłada z pul dema tylko iskry — promieniście od środka, bez stożków — i przypalenie wlotu.
      this.wave.spawn(this.sx(x), this.sy(y), { cvx: cx, cvy: -cy });
      const rng = this.rng;
      const nSp = Math.round(900 * this.opts.blastGain);
      for (let i = 0; i < nSp; i++) {
        const a = rng() * TAU;
        const sp = 1700 + rng() * 5800;
        const col = rng() < 0.7 ? SPARK_COLORS.ion : WAVE_SPARK_WHITE;
        this._spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.22 + rng() * 0.55, 0.4 + rng() * 0.6, 1.8 + rng() * 1.4, col, 1, cx, cy, 36);
      }
      if (hull && this.opts.scorch) {
        const le = this._toHull(hull, entry ? entry.x : x, entry ? entry.y : y, _pa);
        this.scorches.push({ hull, lx: le.x, ly: le.y, t0: this.time, life: 6, size: 46, smokeAcc: 0 });
      }
      return;
    }
    if (warhead === 'pulsar' && this.pulsar) {
      // Głowica „Pulsar”: cały wybuch — ładowanie, bryła 3D, cząstki, światła i ugięcie przestrzeni — prowadzi
      // pulsar.js (nośnik = trafiony kadłub); reżyser dokłada tylko jego wyjścia klatki (mergePulsar).
      this.pulsar.spawn(this.sx(x), this.sy(y), { cvx: cx, cvy: -cy });
      return;
    }
    const rng = this.rng;
    const B = MISSILE_VFX.niszczyciel.blast;
    const R = B.radius;
    const gain = this.opts.blastGain;
    const t0 = this.time;
    const X = this.sx(x);
    const Y = this.sy(y);
    const jets = [];
    const fires = [];
    let exit = null;
    let ex = x;
    let ey = y;
    if (hull) {
      if (entry) { ex = entry.x; ey = entry.y; }
      // Wlot: strumień wsteczny kanałem, którym weszła głowica (między normalną poszycia a kierunkiem wstecz).
      let bx = nx * 0.6 - ux;
      let by = ny * 0.6 - uy;
      const bl = Math.hypot(bx, by) || 1;
      bx /= bl; by /= bl;
      jets.push({ x: this.sx(ex), y: this.sy(ey), dx: bx, dy: -by, fire: true, speed: R * 7.5, dur: 1.5, delay: 0, r: R * 0.075, velTau: 0.5 });
      fires.push({ x: this.sx(ex), y: this.sy(ey), ux: bx, uy: -by, r: R * 0.11, dur: 2.8, delay: 0.5 });
      // Wylot: tam, gdzie tor głowicy przebiłby drugą burtę.
      // (do 460 j. — przebicie w poprzek kadłuba; tor wzdłuż całego okrętu nie wybija rufy)
      exit = this._hullExit(hull, x, y, ux, uy, 460);
      if (exit) {
        const dl = exit.d / HEAVY_FLAME_SPEED;
        jets.push({ x: this.sx(exit.x), y: this.sy(exit.y), dx: ux, dy: -uy, fire: true, speed: R * 6, dur: 1.1, delay: dl, r: R * 0.065 });
        fires.push({ x: this.sx(exit.x), y: this.sy(exit.y), ux, uy: -uy, r: R * 0.09, dur: 2.2, delay: 0.6 + dl });
      }
      // Upusty z burt w poprzek toru.
      for (let sd = -1; sd <= 1; sd += 2) {
        const px = -uy * sd;
        const py = ux * sd;
        const v = this._hullExit(hull, x, y, px, py, 420);
        if (v) {
          jets.push({ x: this.sx(v.x), y: this.sy(v.y), dx: px, dy: -py, fire: rng() < 0.5, speed: R * 4.6, dur: 0.8 + rng() * 0.4,
            delay: 0.04 + v.d / HEAVY_FLAME_SPEED, r: R * 0.055 });
        }
      }
    }
    const slot = this.gas
      ? this.gas.detonate(X, Y, { R, power: 1, cvx: cx, cvy: -cy, jets, fires, embers: Math.round(760 * gain) })
      : -1;
    // Bez gazu (brak modułu albo domeny): kula ognia z cząstek, jak głowica standardowa — tylko większa.
    if (slot < 0) this.fireballs.add(t0, X, Y, 40, R * 0.9, 1.4, 1.2, 1.0, cx, -cy);
    // Błysk i światło (światło z właścicielem domeny gazu: własny dym łapie je tylko w dalekim polu).
    this._flash(x, y, {
      life: 1.8, cx, cy,
      core: [24, 20, 14], coreSize: 66, tauCore: 0.05,
      halo: [0.85, 0.52, 0.26], haloSize: 1150, tauHalo: 0.15,
      light: { color: [1.0, 0.72, 0.45], I1: 10, tau1: 0.09, I2: 3.6, tau2: 0.9, range: 5600, z: 260, owner: slot >= 0 ? GAS_LIGHT_OWNER_BASE + slot : 0 }
    });
    // Iskry: połowa w stożkach otworów (wlot wstecz, wylot wzdłuż lotu), reszta dookoła.
    const nSp = Math.round(B.sparks * gain);
    const aBack = Math.atan2(-uy, -ux);
    const aFwd = Math.atan2(uy, ux);
    for (let i = 0; i < nSp; i++) {
      const q = rng();
      let a;
      let px = x;
      let py = y;
      if (hull && q < 0.3) { a = aBack + (rng() - 0.5) * 1.0; px = ex; py = ey; }
      else if (exit && q < 0.5) { a = aFwd + (rng() - 0.5) * 0.9; px = exit.x; py = exit.y; }
      else a = rng() * TAU;
      const sp = 1300 + rng() * 4600;
      const col = rng() < 0.5 ? SPARK_COLORS.warm : (rng() < 0.7 ? SPARK_COLORS.gold : [1.0, 0.9, 0.75]);
      this._spark(px, py, Math.cos(a) * sp, Math.sin(a) * sp, 0.4 + rng() * 1.0, 0.35 + rng() * 0.6, 1.6 + rng() * 1.4, col, 1, cx, cy, 36);
    }
    // Płonące odłamki z własnymi smugami dymu (lecą daleko poza kulę ognia).
    if (this.opts.fragments) {
      for (let i = 0; i < B.fragments; i++) {
        const a = rng() * TAU;
        const sp = 700 + rng() * 1500;
        this.fragments.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, cx, cy,
          t0, life: 1.0 + rng() * 1.3, drag: 0.9 + rng() * 0.5, acc: 0, heat: 0.9 + rng() * 0.4,
          size: 1.2 + rng() * 1.0, nx0: x, ny0: y
        });
      }
    }
    // Sadza z cząstek: rzadka, długo wisząca reszta wokół rany (gaz gaśnie po ~5 s, ona zostaje dłużej).
    for (let i = 0; i < B.smoke; i++) {
      const a = rng() * TAU;
      const sp = 90 + rng() * 420;
      const r0 = rng() * R * 0.5;
      this._puff(x + Math.cos(a) * r0, y + Math.sin(a) * r0, Math.cos(a) * sp, Math.sin(a) * sp, cx, cy,
        16 + rng() * 22, 60 + rng() * 40, 3.5 + rng() * 3.5, 0.3 + rng() * 0.2, SMOKE_KIND.SOOT, 0.16 + rng() * 0.08, rng() * 0.05, 20 + rng() * 14);
    }
    // Fala (sama refrakcja, z falą odbitą) + wymiatanie dymu rakiet; gorące powietrze nad kulą.
    const SH = HEAVY_SHOCK;
    this.shocks.push({ x, y, t0, life: SH.life, rMax: SH.rMax, tauR: SH.tau, width: SH.width, strength: SH.strength, cx, cy, cap: SH.cap, disp: 0.42 });
    this.shocks.push({ x, y, t0, life: SH.life * 1.25, rMax: SH.rMax * 0.6, tauR: SH.tau * 1.6, width: SH.width * 0.7, strength: SH.strength * SH.echo, cx, cy, cap: SH.cap, disp: 0.42 });
    this.blasts.push({ x, y, t0, life: 1.0, rMax: 2300, tauR: 0.38, width: 190, strength: 12000, type: 0, cx, cy });
    const HZ = HEAVY_HAZE;
    this.hazes.push({ x, y, t0, life: HZ.life, radius: HZ.radius, strength: HZ.strength, cx, cy, scale: HZ.scale, capPerZoom: HZ.capPerZoom });
    // Rany: żar w otworach (wlot i wylot) dymi i stygnie; wybuchy wtórne w kadłubie.
    if (hull) {
      if (this.opts.scorch) {
        const le = this._toHull(hull, ex, ey, _pa);
        this.scorches.push({ hull, lx: le.x, ly: le.y, t0, life: 6, size: 46, smokeAcc: 0 });
        if (exit) {
          const lo = this._toHull(hull, exit.x, exit.y, _pa);
          this.scorches.push({ hull, lx: lo.x, ly: lo.y, t0, life: 5, size: 38, smokeAcc: 0 });
        }
      }
      const want = 3 + (rng() < 0.5 ? 1 : 0);
      const reach = Math.max(70, hull.length * 0.38);
      for (let got = 0, tries = 0; got < want && tries < 48; tries++) {
        const a = rng() * TAU;
        const rr = 80 + rng() * reach;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (hull.sdfAt(px, py) > -10) continue;
        const l = this._toHull(hull, px, py, _pa);
        this.cookoffs.push({ hull, lx: l.x, ly: l.y, t: t0 + 0.4 + rng() * 1.5, R: 70 + rng() * 45, slot });
        got++;
      }
    }
    this.heavies.push({ t0, x, y, hull, slot });
    this.shake = Math.min(26, Math.max(this.shake, 15));
  }

  /** Wybuch wtórny w trafionym kadłubie (zapas amunicji, przewody paliwa): mała kula w tej samej domenie gazu. */
  _cookoff(ck) {
    const rng = this.rng;
    const h = ck.hull;
    const p = this._fromHull(h, ck.lx, ck.ly, _pb);
    const x = p.x;
    const y = p.y;
    const g = h.sdfGradAt(x, y);
    const nx = g.x;
    const ny = g.y;
    const cx = h.vx || 0;
    const cy = h.vy || 0;
    const R = ck.R;
    const k = R / 100;
    const X = this.sx(x);
    const Y = this.sy(y);
    const inGas = this.gas ? this.gas.secondary(ck.slot, X, Y, R, nx, -ny) : false;
    if (!inGas) this.fireballs.add(this.time, X, Y, 36, R * 0.7, 0.9, 1.0, 1.0, cx, -cy);
    this._flash(x, y, {
      life: 0.9, cx, cy,
      core: [13, 10, 7], coreSize: 20 * k, tauCore: 0.035,
      halo: [0.55, 0.34, 0.18], haloSize: 210 * k, tauHalo: 0.08,
      light: { color: [1.0, 0.7, 0.42], I1: 5, tau1: 0.06, I2: 1.0, tau2: 0.4, range: 1900 * Math.sqrt(k), z: 130 }
    });
    const an = Math.atan2(ny, nx);
    const nSp = Math.round(120 * this.opts.blastGain);
    for (let i = 0; i < nSp; i++) {
      const a = an + (rng() - 0.5) * 2 * 1.5;
      const sp = (1100 + rng() * 2900) * Math.sqrt(k);
      this._spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + rng() * 0.7, 0.3 + rng() * 0.5, 2.0 + rng() * 1.6,
        rng() < 0.6 ? SPARK_COLORS.warm : SPARK_COLORS.gold, 1, cx, cy);
    }
    if (this.opts.fragments) {
      for (let i = 0; i < 3; i++) {
        const a = an + (rng() - 0.5) * 2 * 1.3;
        const sp = 500 + rng() * 900;
        this.fragments.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, cx, cy,
          t0: this.time, life: 0.7 + rng() * 0.9, drag: 1.1 + rng() * 0.6, acc: 0, heat: 0.8 + rng() * 0.4,
          size: 0.8 + rng() * 0.6, nx0: x, ny0: y
        });
      }
    }
    this.shocks.push({ x, y, t0: this.time, life: 0.5, speed: 2700 * Math.sqrt(k), width: 62 * k, strength: 8, cx, cy });
    this.blasts.push({ x, y, t0: this.time, life: 0.5, speed: 2700 * Math.sqrt(k), width: 100 * k, strength: 4200, type: 0, cx, cy });
    this.hazes.push({ x, y, t0: this.time, life: 0.9, radius: R * 1.5, strength: 3.0, cx, cy });
    this.shake = Math.min(20, this.shake + 3.5);
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
    const S = NOVA_SCALE;
    this._flash(x, y, {
      life: 1.6,
      core: NOVA_CORE, coreSize: 150 * S, tauCore: 0.09,
      halo: NOVA_HALO, haloSize: 1900 * S, tauHalo: 0.32,
      light: { color: NOVA_LIGHT, I1: 26, tau1: 0.12, I2: 4.0, tau2: 0.7, range: 8000 * S, z: 400 }
    });
    // Linia anamorficzna (w poziomie ekranu), cienka i krótka.
    const sx = this.sx(x);
    const sy = this.sy(y);
    this.arcs.line(this.time, sx - 1500 * S, sy, sx + 1500 * S, sy, { life: 0.4, corePx: 1.1, glowPx: 5 * S, core: [6, 8.5, 10], glow: [0.28, 0.6, 0.9], z: 95 });
    this.arcs.line(this.time, sx - 520 * S, sy, sx + 520 * S, sy, { life: 0.22, corePx: 1.8, glowPx: 9 * S, core: [12, 10, 14], glow: [0.45, 0.4, 0.9], z: 96 });
    // Fala: refrakcja i wymiatanie dymu (front hamuje jak fala Sedova), za nią słabsza fala odbita;
    // gorące powietrze szerokie i długie + krótszy, silniejszy kłąb w środku.
    const SH = NOVA_SHOCK;
    this.shocks.push({ x, y, t0: this.time, life: SH.life, rMax: SH.rMax * S, tauR: SH.tau, width: SH.width * S, strength: SH.strength, cx: 0, cy: 0, nova: true });
    this.shocks.push({ x, y, t0: this.time, life: SH.life * 1.25, rMax: SH.rMax * 0.62 * S, tauR: SH.tau * 1.6, width: SH.width * 0.7 * S,
      strength: SH.strength * SH.echo, cx: 0, cy: 0, nova: true });
    this.blasts.push({ x, y, t0: this.time, life: 1.3, rMax: 2700 * S, tauR: 0.42, width: 220 * S, strength: 16000 * S, type: 0, cx: 0, cy: 0 });
    const HZ = NOVA_HAZE;
    this.hazes.push({ x, y, t0: this.time, life: HZ.life, radius: HZ.radius * S, strength: HZ.strength, cx: 0, cy: 0, nova: true });
    this.hazes.push({ x, y, t0: this.time, life: HZ.life * 0.45, radius: HZ.radius * 0.45 * S, strength: HZ.strength * HZ.core, cx: 0, cy: 0, nova: true });
    // Pozostałość: wir (obrót różnicowy — kierunek losowy), dżety pulsara na obracającej się osi.
    const dir = rng() < 0.5 ? -1 : 1;
    nv.spin = dir * (0.95 + 0.35 * rng());
    nv.jetA = rng() * TAU;
    nv.jetW = dir * (2.0 + 0.7 * rng());
    const arms = rng() < 0.5 ? 2 : 3;
    const armPhase = rng() * TAU;
    this.nebula.spawn(this.time, sx, sy, {
      count: NOVA_REMNANT_PARTICLES, speed: 1250 * S, size: 10.5, life: NOVA_REMNANT_LIFE, gain: 0.27,
      spin: nv.spin, jetA0: nv.jetA, jetOmega: nv.jetW, jetSpeed: NOVA_JET_SPEED, jetSpan: NOVA_JET_SPAN, jetLife: NOVA_JET_LIFE,
      arms, armPhase
    });
    // Iskry gwiezdne (w próżni: bez nośnika — pozostałość stoi w świecie).
    const n = Math.round(B.sparks * this.opts.blastGain);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const sp = (900 + rng() * 3900) * S;
      const col = rng() < 0.7 ? SPARK_COLORS.nova : (rng() < 0.5 ? SPARK_COLORS.ion : [1, 0.85, 0.95]);
      this._spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + rng() * 1.3, 0.3 + rng() * 0.5, 0.8 + rng() * 0.9, col, 0.8, 0, 0, 36);
    }
    // Wstrząs jak w grze: szczyt 16 (salwa 4 nie sumuje się w trzęsienie bez końca).
    this.shake = Math.min(26, Math.max(this.shake, 16));
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
    this.novas = this.novas.filter((nv) => time - nv.t0 < NOVA_SEQ_END);

    // „Niszczyciel” w kadłubie: głowica leci w głąb (z otworu wlotowego biją iskry, obraz lekko przygasa),
    // po zwłoce wybuch w środku — w punkcie przeliczonym z układu kadłuba (okręt mógł się przesunąć).
    for (const pn of this.pens) {
      if (pn.stage !== 0) continue;
      const a = time - pn.t0;
      const h = pn.hull;
      const hc = Math.cos(h.angle);
      const hs = Math.sin(h.angle);
      const nx = pn.nlx * hc - pn.nly * hs;
      const ny = pn.nlx * hs + pn.nly * hc;
      if (a >= pn.delay) {
        pn.stage = 1;
        const ip = this._fromHull(h, pn.ix, pn.iy, _pa);
        const ix = ip.x;
        const iy = ip.y;
        const ep = this._fromHull(h, pn.ex, pn.ey, _pb);
        this._heavyDetonate({
          x: ix, y: iy, ux: pn.ulx * hc - pn.uly * hs, uy: pn.ulx * hs + pn.uly * hc, nx, ny,
          hull: h, cx: h.vx || 0, cy: h.vy || 0, entry: { x: ep.x, y: ep.y }, warhead: pn.warhead
        });
        continue;
      }
      expo = Math.min(expo, 1 - 0.1 * smooth(a / Math.max(pn.delay, 1e-3)));
      pn.sparkAcc += dt;
      const ep = this._fromHull(h, pn.ex, pn.ey, _pb);
      const an = Math.atan2(ny, nx);
      let g = 0;
      while (pn.sparkAcc > 0.004 && g++ < 24) {
        pn.sparkAcc -= 0.004;
        const aa = an + (rng() - 0.5) * 1.3;
        const sp = 900 + rng() * 2600;
        this._spark(ep.x, ep.y, Math.cos(aa) * sp, Math.sin(aa) * sp, 0.2 + rng() * 0.4, 0.25 + rng() * 0.35, 2.6,
          rng() < 0.5 ? SPARK_COLORS.gold : [1.0, 0.9, 0.75], 1, h.vx || 0, h.vy || 0);
      }
    }
    this.pens = this.pens.filter((pn) => time - pn.t0 < pn.delay + 1.4);
    // Wybuchy wtórne w trafionym kadłubie (kolejka z _heavyDetonate).
    if (this.cookoffs.length) {
      const wait = [];
      for (const ck of this.cookoffs) {
        if (ck.t > time) wait.push(ck);
        else this._cookoff(ck);
      }
      this.cookoffs = wait;
    }
    // Błysk wybuchu „Niszczyciela”: krótkie podbicie bloomu, obraz wraca z przygaszenia.
    for (const hv of this.heavies) {
      const b = time - hv.t0;
      boost = Math.max(boost, 0.7 * Math.exp(-b / 0.22));
      expo = Math.min(expo, 1 - 0.1 * Math.exp(-b / 0.06));
    }
    this.heavies = this.heavies.filter((hv) => time - hv.t0 < HEAVY_SEQ_END);
    // Odrzucone człony startowe: lecą z oporem, koziołkują, przez sekundę ciągną cienką smużkę dymu.
    this.boosters = this.boosters.filter((b) => time - b.t0 < b.life);
    for (const b of this.boosters) {
      const a = time - b.t0;
      const e = Math.exp(-b.drag * dt);
      const x0 = b.x;
      const y0 = b.y;
      b.x += b.vx * (1 - e) / b.drag + b.cx * dt;
      b.y += b.vy * (1 - e) / b.drag + b.cy * dt;
      b.vx *= e; b.vy *= e;
      b.ang += b.spin * dt;
      b.pitch += b.pitchSpin * dt;
      if (a < 1.1 && this.opts.trails) {
        const d = Math.hypot(b.x - x0, b.y - y0);
        b.acc += d;
        const sq = Math.sqrt(b.bs);
        const k = 1 - a / 1.1;
        let g = 0;
        while (b.acc > 14 && g++ < 32) {
          b.acc -= 14;
          const u = d > 1e-6 ? clamp(1 - b.acc / d, 0, 1) : 1;
          this._puff(x0 + (b.x - x0) * u, y0 + (b.y - y0) * u, b.vx * 0.1, b.vy * 0.1, b.cx, b.cy,
            3 * sq, 16 * sq, 0.8 + rng() * 0.9, 0.35 * k, SMOKE_KIND.BOOST, 0.2 * k, (1 - u) * dt, 12 + b.h);
        }
      }
    }
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
    this.stats.heavies = this.heavies.length;
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

  /** Wizualia rakiet w locie (kadłubki, płomienie) — co klatkę; lot gry: wysokość i wzniesienie nosa. */
  addMissiles(list, time) {
    for (const m of list) {
      const vfx = MISSILE_VFX[m.vfx];
      const bs = m.p.bodyScale;
      const ud = m.userData;
      const hgt = hgtOf(m);
      const lift = 1 + LIFT_K * (hgt < LIFT_H ? hgt / LIFT_H : 1);
      const L = ROCKET_BODY_LENGTH * bs * lift;
      const pitch = pitchOf(m);
      const cp = Math.cos(pitch);
      const sx = this.sx(m.x);
      const sy = this.sy(m.y);
      const ang = -m.heading;
      const on = m.state === 'POWERED';
      // „Niszczyciel”: własne siatki — oba człony, w sprincie sam penetrator (wiruje szybciej: stabilizacja obrotem).
      const heavy = vfx.heavy && this.heavyBodies ? this.heavyBodies : null;
      const sprint = m.stage === 2;
      const set = heavy ? (sprint ? heavy.dart : heavy.full) : this.bodies;
      const roll = (heavy ? (sprint ? time * 9 : time * 1.1) : time * 3.5) + m.seed * TAU;
      set.add(sx, sy, 44 + hgt, ang, L, vfx.body.hull, vfx.body.band, on ? 1 : 0, roll, pitch);
      // Nos w górę: płomień schowany pod kadłubkiem (z góry widać łunę — addGlows), skrót strugi cos(el).
      if (!on || cp < 0.12) continue;
      const c = Math.cos(m.heading);
      const s = Math.sin(m.heading);
      const tail = this._tailK(m);
      const nx = m.x - c * L * tail * cp;
      const ny = m.y - s * L * tail * cp;
      const P = (sprint && vfx.plume2) || vfx.plume;
      const flick = 0.9 + 0.1 * Math.sin(time * 41 + ud.flick) * Math.sin(time * 27 + ud.flick * 3);
      // Człon sprintu pali pełnym ciągiem do trafienia (ciąg z regulatora prędkości spada przy prędkości zadanej).
      const thr = sprint ? 1 : m.throttle;
      const len = L * P.len * cp * (0.5 + 0.5 * thr) * flick * (m.vfx === 'supernova' || sprint ? 1 : (0.8 + 0.2 * Math.min(1, m.t * 2)));
      // P.gain — jasność ciała płomienia (duża struga „Niszczyciela” ma na ekranie kilka razy więcej pikseli
      // nad progiem bloomu niż mała rakieta — bez przygaszenia z bliska robi się z niej biała plama).
      this.plumes.add(this.sx(nx), this.sy(ny), 46 + hgt, -c, s, len, L * P.width, Math.max(0.2, thr), P.kind, m.seed, P.gain ?? 1.0, P.core, P.hot, P.mid);
    }
    // Odrzucone człony startowe „Niszczyciela” (koziołkują; żar dyszy stygnie, na koniec maleją do zera).
    const HB = this.heavyBodies;
    if (HB) {
      for (const b of this.boosters) {
        const vfx = MISSILE_VFX[b.vfx];
        const a = time - b.t0;
        const lift = 1 + LIFT_K * (b.h < LIFT_H ? b.h / LIFT_H : 1);
        const L = ROCKET_BODY_LENGTH * b.bs * lift * (1 - smooth((a - (b.life - 0.5)) / 0.5));
        if (L > 0.5) HB.booster.add(this.sx(b.x), this.sy(b.y), 43 + b.h, -b.ang, L, vfx.body.hull, vfx.body.band, Math.exp(-a / 0.5), b.roll + a * 2.2, b.pitch);
      }
    }
  }

  /** Światła siatki: dysze, błyski, odłamki, supernowe. */
  addLights(grid, list, time) {
    let n = 0;
    for (const m of list) {
      if (m.state !== 'POWERED') continue;
      const vfx = MISSILE_VFX[m.vfx];
      const sprint = m.stage === 2;
      const L = (sprint && vfx.light2) || vfx.light;
      const bl = ROCKET_BODY_LENGTH * m.p.bodyScale;
      const c = Math.cos(m.heading);
      const s = Math.sin(m.heading);
      // Światło dyszy na wysokości rakiety (lot gry): nad pokładem plama ostra, wyżej szersza i słabsza.
      const cpl = Math.cos(pitchOf(m));
      const back = this._tailK(m) + 0.9;
      const x = m.x - c * bl * back * cpl;
      const y = m.y - s * bl * back * cpl;
      const flick = 0.9 + 0.1 * Math.sin(time * 33 + m.seed * 20);
      let I = L.intensity * (0.45 + 0.55 * (sprint ? 1 : m.throttle)) * flick;
      if (m.vfx === 'supernova' && m.phase === 'terminal') I *= 1 + 1.5 * pulse(m.terminalT);
      if (grid.add(this.sx(x), this.sy(y), 40 + hgtOf(m), L.range, L.color[0] * I, L.color[1] * I, L.color[2] * I, 0.9) >= 0) n++;
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
      // owner — właściciel światła (błysk wybuchu „Niszczyciela”: domena gazu, która łapie je tylko w dalekim polu).
      if (grid.add(this.sx(x), this.sy(y), L.z, range, L.color[0] * I, L.color[1] * I, L.color[2] * I, 1.0,
        0, 0, -1, -2, 0, 0, 0, L.owner || 0) >= 0) n++;
    }
    // Głowica „Niszczyciela” w kadłubie: żar w otworze wlotowym narasta do wybuchu.
    for (const pn of this.pens) {
      if (pn.stage !== 0) continue;
      const I = 2.4 * Math.min(1, (time - pn.t0) / Math.max(pn.delay, 1e-3));
      const e = this._fromHull(pn.hull, pn.ex, pn.ey, _pa);
      if (grid.add(this.sx(e.x), this.sy(e.y), 40, 800, 1.0 * I, 0.62 * I, 0.3 * I, 0.8) >= 0) n++;
    }
    // Wybuchy „Pulsar”: jądro i snopy dżetów omiatające kadłuby; „Fala”: jeden błysk dookólny.
    if (this.pulsar) n += this.pulsar.addLights(grid);
    if (this.wave) n += this.wave.addLights(grid);
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
      // Implozja: narasta do detonacji; potem błysk gaśnie (e^(−t/0,8)), zasięg na pół kadru;
      // pulsar dokłada migotanie w rytm snopów, dopóki kręci się wir.
      const implode = a < 0.24;
      const pb = a - 0.24;
      const ps = Math.max(0, Math.sin(pb * TAU * 6.5));
      const I = implode ? 3 * smooth(a / 0.24) : 1.4 * Math.exp(-pb / 0.8) + 0.3 * Math.exp(-pb / 1.0) * (0.5 + 0.5 * ps * ps);
      if (!implode && !(I > 0.02)) continue;
      const z = (implode ? 60 : 80) * NOVA_SCALE;
      const range = (implode ? 1400 : 2600) * NOVA_SCALE;
      if (grid.add(this.sx(nv.x), this.sy(nv.y), z, range, (implode ? 0.8 : 0.6) * I, (implode ? 0.6 : 0.75) * I, I, 1.0) >= 0) n++;
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
      const bl = ROCKET_BODY_LENGTH * m.p.bodyScale;
      const hgt = hgtOf(m);
      const pitch = pitchOf(m);
      const cpn = Math.cos(pitch);
      const spn = Math.sin(pitch);
      const c = Math.cos(m.heading);
      const s = Math.sin(m.heading);
      if (m.state === 'POWERED' && spn > 0.3) {
        // Nos w górę po zapłonie: dysza patrzy w pokład — z góry nie widać płomienia, tylko łunę
        // w obłoku spalin pod rakietą (gaśnie, gdy rakieta kładzie się w kurs).
        const lift = 1 + LIFT_K * (hgt < LIFT_H ? hgt / LIFT_H : 1);
        const hot = MISSILE_VFX[m.vfx].plume.hot;
        // (łuna dużej rakiety ma na ekranie ~9× więcej pikseli — jaśniejsza robiła z bliska białą plamę)
        const kk = (spn - 0.3) / 0.7 * (0.55 + 0.45 * m.throttle) * (0.85 + 0.15 * Math.sin(time * 37 + m.seed * 20))
          * (MISSILE_VFX[m.vfx].heavy ? 0.5 : 1);
        glow.add(this.sx(m.x - c * bl * 0.5 * cpn), this.sy(m.y - s * bl * 0.5 * cpn), 45 + hgt, 20 * m.p.bodyScale * lift,
          hot[0] * 1.4 * kk, hot[1] * 1.4 * kk, hot[2] * 1.4 * kk, GLOW_ROUND);
      }
      if (m.stage === 2 && MISSILE_VFX[m.vfx].heavy) {
        // Sprint „Niszczyciela”: rozgrzane czoło penetratora — biało-błękitny punkt na nosie i igła fali
        // czołowej wzdłuż kadłubka (jasny koniec na nosie), narastają przez 0,15 s od odpalenia członu.
        const lift = 1 + LIFT_K * (hgt < LIFT_H ? hgt / LIFT_H : 1);
        const k = Math.min(1, (m.t - (m.sprintAt || 0)) / 0.15) * (0.8 + 0.2 * Math.sin(time * 71 + m.seed * 30));
        const px = m.x + c * bl * 0.5 * cpn * lift;
        const py = m.y + s * bl * 0.5 * cpn * lift;
        glow.add(this.sx(px), this.sy(py), 54 + hgt, 3.2 * m.p.bodyScale, 1.7 * k, 2.3 * k, 3.6 * k, GLOW_ROUND);
        const len = bl * 1.5 * lift;
        const w = 8 * m.p.bodyScale;
        glow.add(this.sx(px - c * len * 0.5), this.sy(py - s * len * 0.5), 53 + hgt, w, 0.3 * k, 0.5 * k, 1.0 * k, GLOW_STREAK, c, -s, len / w);
      }
      if (m.vfx !== 'supernova') continue;
      const x = m.x + c * bl * 0.42 * cpn;
      const y = m.y + s * bl * 0.42 * cpn;
      let k = 1.0 + 0.2 * Math.sin(time * 9 + m.seed * 10);
      if (m.phase === 'terminal') k += 2.2 * pulse(m.terminalT);
      glow.add(this.sx(x), this.sy(y), 52 + hgt, 11 * m.p.bodyScale, 2.0 * k, 0.6 * k, 2.2 * k, GLOW_ROUND);
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
    // Głowica „Niszczyciela” w kadłubie: otwór wlotowy żarzy się, a wzdłuż toru głowicy żar bije przez
    // poszycie — smuga od wlotu ku głowicy rośnie z jej drogą (jasny koniec przy głowicy), po wybuchu stygnie.
    for (const pn of this.pens) {
      const a = time - pn.t0;
      const pre = Math.min(1, a / Math.max(pn.delay, 1e-3));
      const k = (0.4 + 0.6 * pre) * (a > pn.delay ? Math.exp(-(a - pn.delay) / 0.45) : 1);
      const e = this._fromHull(pn.hull, pn.ex, pn.ey, _pa);
      glow.add(this.sx(e.x), this.sy(e.y), 9, 34 * (1 + 0.3 * pre), 5.0 * k, 3.2 * k, 1.3 * k, GLOW_ROUND);
      if (pn.depth > 12) {
        const i = this._fromHull(pn.hull, pn.ix, pn.iy, _pb);
        const dxw = (i.x - e.x) / pn.depth;
        const dyw = (i.y - e.y) / pn.depth;
        const len = Math.max(12, pn.depth * pre);
        const w = 22;
        glow.add(this.sx(e.x + dxw * len * 0.5), this.sy(e.y + dyw * len * 0.5), 8, w, 4.2 * k, 2.4 * k, 0.9 * k, GLOW_STREAK, dxw, -dyw, len / w);
      }
    }
    for (const nv of this.novas) {
      const a = time - nv.t0;
      const x = this.sx(nv.x);
      const y = this.sy(nv.y);
      if (a < 0.24) {
        const t = smooth(a / 0.24);
        glow.add(x, y, 94, (10 + 40 * t) * NOVA_SCALE, 8 + 22 * t, 7 + 18 * t, 10 + 24 * t, GLOW_ROUND);
      } else {
        const b = a - 0.24;
        // Stygnące jądro z pulsowaniem (pulsar) — świeci przez całe życie wiru, gaśnie z nim.
        const core = Math.exp(-b / 0.6) * 0.7 + 0.3 * Math.exp(-b / 1.0);
        const sp = Math.max(0, Math.sin(b * TAU * 6.5));
        const sp2 = sp * sp;
        const pul = core * (0.6 + 0.4 * sp2 * sp2 * sp2);
        glow.add(x, y, 93, 26 * NOVA_SCALE, 6 * pul, 7 * pul, 10 * pul, GLOW_ROUND);
        const hot = Math.exp(-b / 0.7);
        glow.add(x, y, 91, (420 + 900 * (1 - Math.exp(-b / 0.5))) * NOVA_SCALE, 0.18 * hot, 0.26 * hot, 0.42 * hot, GLOW_ROUND);
        // Snopy pulsara: dwie przeciwne smugi z jądra wzdłuż osi dżetów (ta sama oś, która kreśli
        // spiralę cząstek w mgławicy) — obracają się jak latarnia, błyskają w rytm pulsu.
        const beamK = Math.min(1, b / 0.25) * Math.exp(-b / 0.8) * (0.55 + 0.45 * sp2);
        if (beamK > 0.01 && nv.jetA !== undefined) {
          const th = nv.jetA + nv.jetW * b;
          const len = (300 + 520 * Math.min(1, b / 0.8)) * NOVA_SCALE;
          const ux = Math.cos(th);
          const uy = Math.sin(th);
          const Pb = PULSAR_BEAM;
          for (let side = -1; side <= 1; side += 2) {
            // Jasny koniec smugi (+kierunek) w jądrze: kierunek = −oś, środek = jądro + oś · len / 2.
            // Wąski rdzeń snopu i szeroka, słaba poświata pod nim.
            for (let layer = 0; layer < 2; layer++) {
              const width = (layer === 0 ? 46 : 190) * NOVA_SCALE;
              const k = layer === 0 ? beamK : beamK * 0.16;
              const l = layer === 0 ? len : len * 0.8;
              glow.add(x + ux * side * l * 0.5, y + uy * side * l * 0.5, 94, width, Pb[0] * k, Pb[1] * k, Pb[2] * k,
                GLOW_STREAK, -ux * side, -uy * side, l / width);
            }
          }
        }
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
        bl.push({ x: this.sx(nv.x), y: this.sy(nv.y), front: 0, width: 60 * NOVA_SCALE, strength: 5200 * NOVA_SCALE * t, type: 1, reach: 1500 * NOVA_SCALE });
      }
    }
    // Wybuchy „Pulsar”: ładowanie i zapaść wsysają dym, detonacja go wymiata (rekordy już w scenie).
    if (this.pulsar) for (const f of this.pulsar.forces) bl.push(f);
    // Wybuchy „Fala”: fala wymiata dym.
    if (this.wave) for (const f of this.wave.forces) bl.push(f);
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

  /**
   * Źródła zniekształceń (scena); zoom — px ekranu na j. (sufity siły supernowej jak w grze);
   * list — rakiety w locie (gorące powietrze za „Niszczycielem” w sprincie).
   */
  fillDistortion(post, time, zoom = 1, list = null) {
    for (const s of this.shocks) {
      const a = time - s.t0;
      const R = this._shockRadius(s, a);
      const k = 1 - a / s.life;
      const width = s.width * (1 + a * 0.8);
      let strength = s.strength * k * k;
      // Fala supernowej (i „Niszczyciela” — `cap`): siła w px ekranu z sufitem z grubości frontu na ekranie —
      // przy dalekim zoomie cienki pierścień z dużym przesunięciem zawijałby obraz.
      if (s.nova) strength = Math.min(strength, width * zoom * NOVA_SHOCK.capPerWidth);
      else if (s.cap) strength = Math.min(strength, width * zoom * s.cap);
      post.add(0, this.sx(s.x + s.cx * a), this.sy(s.y + s.cy * a), R, width, strength, s.nova ? 0.45 : (s.disp ?? 0.35));
    }
    if (list) {
      for (const m of list) {
        if (m.stage !== 2 || !MISSILE_VFX[m.vfx].heavy) continue;
        const back = ROCKET_BODY_LENGTH * m.p.bodyScale * 2.2;
        post.add(2, this.sx(m.x - Math.cos(m.heading) * back), this.sy(m.y - Math.sin(m.heading) * back), 150, 0, Math.min(5, zoom * 14), 0, 1);
      }
    }
    for (const nv of this.novas) {
      const a = time - nv.t0;
      if (a < 0.3) {
        const t = smooth(Math.min(1, a / 0.24));
        const out = a > 0.24 ? 1 - (a - 0.24) / 0.06 : 1;
        post.add(1, this.sx(nv.x), this.sy(nv.y), 720 * NOVA_SCALE, 0, 30 * t * Math.max(0, out), 0.35);
      }
    }
    for (const h of this.hazes) {
      const a = time - h.t0;
      const k = 1 - a / h.life;
      let strength = h.strength * k;
      if (h.nova) strength = Math.min(strength, zoom * NOVA_HAZE.capPerZoom);
      else if (h.capPerZoom) strength = Math.min(strength, zoom * h.capPerZoom);
      post.add(2, this.sx(h.x + h.cx * a), this.sy(h.y + h.cy * a), h.radius * (1 + a * 0.6), 0, strength, 0, h.nova ? NOVA_HAZE.scale : (h.scale || 1));
    }
    // Wybuchy „Pulsar”: soczewka, skręcenie przestrzeni, fala.
    if (this.pulsar) this.pulsar.fillDistortion(post, zoom);
    // Wybuchy „Fala”: trzy kręgi refrakcji od środka i duże gorące powietrze.
    if (this.wave) this.wave.fillDistortion(post, zoom);
  }

  /**
   * Wybuchy „Fala” i „Pulsar” (ich moduły liczą się co klatkę, także w pauzie): wstrząs, przygaszenie obrazu
   * i podbicie bloomu tej klatki do wyjść reżysera. Wołać po ich update, przed kamerą i postem.
   */
  mergeBlasts() {
    for (const p of [this.wave, this.pulsar]) {
      if (!p) continue;
      this.shake = Math.min(26, Math.max(this.shake, p.shake));
      this.exposure = Math.min(this.exposure, p.exposure);
      this.bloomBoost = Math.max(this.bloomBoost, p.bloomBoost);
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
    this.pens.length = 0;
    this.heavies.length = 0;
    this.cookoffs.length = 0;
    this.boosters.length = 0;
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
