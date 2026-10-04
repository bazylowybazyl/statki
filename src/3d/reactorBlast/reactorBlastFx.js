// src/3d/reactorBlast/reactorBlastFx.js
//
// REŻYSER WYBUCHU REAKTORA (WebGPU) — obraz rdzenia na kadłubie belkowym (logika:
// src/game/reactorCore.js) jako KROK klatki efektów Core3D (`Core3D.addFxStep`). Zastępuje
// w nowym demie rdzenia (dema/rdzen-webgpu.html) stary obraz: `reactorblow.js` (port overlaya
// WebGL — płaskie cząstki, błysk wybielający kadr) i wybuchowe części `coreFx3D.js` (heksy).
//
// Obraz składa się z pul, które gra już ma, i dwóch nowych (ten katalog):
//   • nowe: kula plazmy z objętości (plasmaFireballs.js — plazma → ogień → sadza, kula topiąca),
//     strumień plazmy (plasmaJets.js), własne duszki blasku (GlowSprites z rakiet — osobna
//     instancja, bo pula rakiet przepisuje swoje co klatkę);
//   • wspólne z rakietami: dym compute z samocieniem i światłem siatki (SmokeSystem, paleta
//     „opary reaktora” w wolnym miejscu 7), łuki wyładowań i linia anamorficzna (ArcSystem),
//     iskry gry (SparkSystem3D), pchnięcie dymu falą (reżyser rakiet — _blast);
//   • wspólne z bronią (WeaponFx.gpu): języki plazmy i ogień (ADD), rozżarzone odłamki
//     oświetlane siatką świateł (DEBRIS), łuki po poszyciu (ARC), płonące rany (ctx.burn);
//   • Core3D: światła efektów (fx.lights — oświetlają kadłuby w siatce świateł), implozja
//     i gorące powietrze (fxDistortion — sama refrakcja, bez świecących okręgów; fala uderzeniowa
//     tylko jako opcja `shock`, domyślnie wył. — w grze ma ją wyłącznie supernowa rakiet,
//     decyzja usera 2026-09-24), przygaszenie i lekkie podbicie bloomu (fx.post), mapa ran kadłubów (HullDamageMap — żar płyty nad komorą,
//     rozżarzone brzegi pęknięć, osmalenie sąsiadów od strony wybuchu).
//
// Przebieg (demo rdzenia, wariant z logiki):
//   STOPIENIE — światło reaktora pulsuje w wyrwie (1,2 → 7 Hz), płyta nad komorą grzeje się od
//   wiśni do bieli, z wyrwy biją języki plazmy z iskrami i parą, po poszyciu pełzają łuki;
//   ostatnie 0,35 s: implozja (soczewka do środka, przygaszenie kadru, iskry wsysane do komory).
//   DETONACJA — biały rdzeń błysku z linią anamorficzną (biel ~0,1 s), krótkie światło na pół
//   kadru, kula plazmy (barwa frakcji) przechodząca w ogień, który rwie się na kłęby i stygnie do
//   przezroczystości (szary dym robi SmokeSystem), bryły wzdłuż pęknięć, łuki w szczelinach,
//   setki iskier, rozżarzone i płonące odłamki, chmura oparów metalu (samocień, światło z
//   siatki), pchnięcie dymu, rozżarzone brzegi pęknięć, osmalone burty sąsiadów.
//   Z bliska wszystko razem przechodzi przez bloom — jasności dobrane tak, żeby biały dysk
//   trwał ~0,1 s (A/B warstw: __rdzen2.still(ukryte) w demie). STRUMIEŃ i KULA — osobne receptury ciągłe (syncHazards).
//
// Zegary: reżysera = czas symulacji (advance(dt) z pętli gry; pauza = 0) — kule plazmy,
// błyski, fale, odłamki; łuki i dym — zegar reżysera rakiet (ta sama pula), iskry — SimClock.
// Pozycje w świecie gry (double); do GPU względem początku pul Core3D (fx.origin).
// Zero alokacji na klatkę: rekordy SoA o stałej pojemności, wpisy robocze pul.

import { PlasmaFireballSystem, PLASMA_KIND_BLAST, PLASMA_KIND_ORB } from './plasmaFireballs.js';
import { PlasmaJetSystem } from './plasmaJets.js';
import { GlowSprites, GLOW_ROUND, GLOW_STREAK } from '../rockets/glow.js';
import { SMOKE_PALETTES } from '../rockets/palette.js';
import { fxNoise } from '../fx/noise.js';
import { fxRandom } from '../fx/fxRandom.js';
import { K } from '../weapons/gpuFx.js';
import { SparkSystem3D } from '../sparkSystem3D.js';
import { HullDamageMap } from '../hullDamageMap.js';
import { HullBodies } from '../../game/hullBodies.js';
import { ActiveCarrier, writeCarrierVelocity } from '../../game/carrierVelocity.js';
import { SimClock, CLOCK_SIM } from '../../game/simClock.js';
import { CORE_STATE } from '../../game/coreModel.js';
import { reactorCoreWorld, reactorCellWorld, reactorHull } from '../../game/reactorCore.js';
import {
  REACTOR_PLASMA, normalizePlasma, REACTOR_VAPOR_PALETTE, SMOKE_SOOT, SMOKE_DEBRIS, SMOKE_VAPOR,
  CLASS_FX, VARIANT_FX, SPARK_HOT, SPARK_GOLD, SPARK_WARM, EMBER_LIGHT, CHUNK_HOT, CHUNK_STEEL,
  FIRE_HOT, FIRE_COOL, FIRE_DIM
} from './palette.js';

const TAU = Math.PI * 2;
const BLAST_CAP = 128;
const FLASH_CAP = 96;
const SHOCK_CAP = 24;
const HAZE_CAP = 48;
const FRAG_CAP = 192;
const BOOST_CAP = 16;
const FB = 16;   // float na kulę: cx, cy, rMax, life, heat, soot, plasma, warp, bright, kind, r, g, b, seed, z, tauR
const FL = 14;   // błysk: life, cx, cy, core rgb, coreSize, tauCore, halo rgb, haloSize, tauHalo, z
const SH = 7;    // fala: life, rMax, tau, width, strength, cx, cy
const HZ = 5;    // gorące powietrze: life, radius, strength, cx, cy
const FG = 12;   // płonący odłamek: vx, vy, cx, cy, life, drag, heat, size, acc, r, g, b

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

function entVx(e) { return Number(e?.vel?.x ?? e?.vx) || 0; }
function entVy(e) { return Number(e?.vel?.y ?? e?.vy) || 0; }

/** Barwa plazmy rdzenia (maks. kanał 1): core.color, frakcja gospodarza albo niebieska Terra Nova. */
function plasmaOf(core, out) {
  const c = core?.color;
  if (Array.isArray(c) && c.length >= 3) return normalizePlasma(c, out);
  const f = String(core?.host?.faction || core?.origin?.faction || '').toLowerCase();
  const base = f.includes('pira') ? REACTOR_PLASMA.pirate : (f.includes('player') ? REACTOR_PLASMA.player : REACTOR_PLASMA.terran);
  return normalizePlasma(base, out);
}

export class ReactorBlastFx {
  /**
   * @param {object} core Core3D (po init: scena, fx)
   * @param {object} o
   * @param {object} [o.rocketFx] createRocketFx(Core3D) — dym, łuki, reżyser rakiet (siły w dymie)
   * @param {object} [o.weaponFx] WeaponFx — pule ADD / SPARK / DEBRIS / ARC, płonące rany
   */
  constructor(core, { rocketFx = null, weaponFx = null } = {}) {
    this.core = core;
    this.rocketFx = rocketFx;
    this.weaponFx = weaponFx;
    const scene = core.scene;
    this.fireballs = new PlasmaFireballSystem({ scene, noise3D: fxNoise.noise3D() });
    this.jetPool = new PlasmaJetSystem({ scene, noise2D: fxNoise.tile2D() });
    this.glow = new GlowSprites({ scene, capacity: 2048, renderOrder: 93 });
    this.glow.mesh.name = 'ReactorGlow';
    this.meshes = [this.fireballs.mesh, this.jetPool.mesh, this.glow.mesh];
    this.time = 0;
    // Fala z refrakcją domyślnie WYŁ.: decyzja usera 2026-09-24/25 — w grze ma ją tylko supernowa
    // rakiet („ściągaj wszędzie”); zostaje jako opcja (demo: W) do porównania.
    this.opts = {
      shock: false, haze: true, smoke: true, fireball: true, sparks: true, arcs: true, heat: true,
      debris: true, frags: true, lights: true, post: true, vents: true, implosion: true, gain: 1
    };
    this.stats = { blasts: 0, fireballs: 0, flashes: 0, frags: 0, jets: 0, orbs: 0, lights: 0, cpuMs: 0 };
    this.onShake = null;       // (mag, dur) — wstrząs kamery (gra: camera.addShake)
    // Paleta oparów reaktora w wolnym miejscu puli dymu rakiet (PAL_CAP 8).
    this.vaporPal = SMOKE_VAPOR;
    const smoke = rocketFx?.smoke;
    if (smoke && typeof smoke.setPalettes === 'function' && SMOKE_PALETTES.length < 8) {
      smoke.setPalettes([...SMOKE_PALETTES, REACTOR_VAPOR_PALETTE]);
      this.vaporPal = SMOKE_PALETTES.length;
    }
    // ── Kule plazmy (wybuchy, bryły, wtórne) ──
    this.fbN = 0;
    this.fbX = new Float64Array(BLAST_CAP); this.fbY = new Float64Array(BLAST_CAP); this.fbT0 = new Float64Array(BLAST_CAP);
    this.fbD = new Float32Array(BLAST_CAP * FB);
    // ── Błyski (duszki) ──
    this.flN = 0;
    this.flX = new Float64Array(FLASH_CAP); this.flY = new Float64Array(FLASH_CAP); this.flT0 = new Float64Array(FLASH_CAP);
    this.flD = new Float32Array(FLASH_CAP * FL);
    // ── Fale (refrakcja) i gorące powietrze ──
    this.shN = 0;
    this.shX = new Float64Array(SHOCK_CAP); this.shY = new Float64Array(SHOCK_CAP); this.shT0 = new Float64Array(SHOCK_CAP);
    this.shD = new Float32Array(SHOCK_CAP * SH);
    this.hzN = 0;
    this.hzX = new Float64Array(HAZE_CAP); this.hzY = new Float64Array(HAZE_CAP); this.hzT0 = new Float64Array(HAZE_CAP);
    this.hzD = new Float32Array(HAZE_CAP * HZ);
    // ── Płonące odłamki ze smugami ──
    this.fgN = 0;
    this.fgX = new Float64Array(FRAG_CAP); this.fgY = new Float64Array(FRAG_CAP); this.fgT0 = new Float64Array(FRAG_CAP);
    this.fgD = new Float32Array(FRAG_CAP * FG);
    // ── Podbicie bloomu / przygaszenie po detonacjach ──
    this.boN = 0;
    this.boT0 = new Float64Array(BOOST_CAP); this.boA = new Float32Array(BOOST_CAP);
    // ── Implozje (ostatnie chwile stopienia) — lista klatki ──
    this.imN = 0;
    this.imX = new Float64Array(16); this.imY = new Float64Array(16); this.imD = new Float32Array(16 * 3);
    // ── Rdzenie w stopieniu (stan efektu per rdzeń) i zagrożenia ──
    this._coreFx = new WeakMap();
    this.cores = null;
    this.jets = [];
    this.orbs = [];
    this._orbFx = new WeakMap();
    this._jetFx = new WeakMap();
    // Robocze: barwa, nośnik, punkty.
    this._col = [0, 0, 0];
    this._carrier = { x: 0, y: 0, z: 0, vx: 0, vy: 0, clock: CLOCK_SIM, t0: 0 };
    this._p = { x: 0, y: 0 };
    this._q = { x: 0, y: 0 };
    this.post = { exposure: 1, bloomBoost: 0 };
    const self = this;
    this.step = {
      name: 'reaktor-rdzen',
      update: (ctx) => self._update(ctx),
      warm: (ctx) => self._warm(ctx)
    };
    core.addFxStep(this.step);
  }

  // ------------------------------------------------------------------ zegar

  /** Krok czasu symulacji (pętla gry, przed renderem; pauza = 0). */
  advance(dt) {
    if (dt > 0) this.time += dt;
    this._stepFrags(dt > 0 ? dt : 0);
  }

  _rocketTime() {
    const d = this.rocketFx?.director;
    return d ? d.time - d.epoch : this.time;
  }

  _setCarrier(vx, vy) {
    ActiveCarrier.set(writeCarrierVelocity(vx, vy, CLOCK_SIM, SimClock.sim, this._carrier));
  }

  // ------------------------------------------------------------------ rekordy

  _fireball(x, y, delay, rMax, life, heat, soot, plasma, warp, bright, kind, col, cx, cy, z = 40, tauR = 0.12) {
    let i = this.fbN;
    if (i >= BLAST_CAP) {
      let oldest = 0;
      for (let k = 1; k < this.fbN; k++) if (this.fbT0[k] < this.fbT0[oldest]) oldest = k;
      i = oldest;
    } else this.fbN++;
    this.fbX[i] = x; this.fbY[i] = y; this.fbT0[i] = this.time + delay;
    const o = i * FB, D = this.fbD;
    D[o] = cx; D[o + 1] = cy; D[o + 2] = rMax; D[o + 3] = life; D[o + 4] = heat; D[o + 5] = soot;
    D[o + 6] = plasma; D[o + 7] = warp; D[o + 8] = bright; D[o + 9] = kind;
    D[o + 10] = col[0]; D[o + 11] = col[1]; D[o + 12] = col[2]; D[o + 13] = fxRandom.next();
    D[o + 14] = z; D[o + 15] = tauR;
    this.stats.fireballs++;
  }

  _flash(x, y, life, cx, cy, cr, cg, cb, coreSize, tauCore, hr, hg, hb, haloSize, tauHalo, z = 96) {
    let i = this.flN;
    if (i >= FLASH_CAP) {
      let oldest = 0;
      for (let k = 1; k < this.flN; k++) if (this.flT0[k] < this.flT0[oldest]) oldest = k;
      i = oldest;
    } else this.flN++;
    this.flX[i] = x; this.flY[i] = y; this.flT0[i] = this.time;
    const o = i * FL, D = this.flD;
    D[o] = life; D[o + 1] = cx; D[o + 2] = cy; D[o + 3] = cr; D[o + 4] = cg; D[o + 5] = cb;
    D[o + 6] = coreSize; D[o + 7] = tauCore; D[o + 8] = hr; D[o + 9] = hg; D[o + 10] = hb;
    D[o + 11] = haloSize; D[o + 12] = tauHalo; D[o + 13] = z;
    this.stats.flashes++;
  }

  _shock(x, y, life, rMax, tau, width, strength, cx, cy) {
    if (this.shN >= SHOCK_CAP) return;
    const i = this.shN++;
    this.shX[i] = x; this.shY[i] = y; this.shT0[i] = this.time;
    const o = i * SH, D = this.shD;
    D[o] = life; D[o + 1] = rMax; D[o + 2] = tau; D[o + 3] = width; D[o + 4] = strength; D[o + 5] = cx; D[o + 6] = cy;
  }

  _haze(x, y, life, radius, strength, cx, cy) {
    if (this.hzN >= HAZE_CAP) return;
    const i = this.hzN++;
    this.hzX[i] = x; this.hzY[i] = y; this.hzT0[i] = this.time;
    const o = i * HZ, D = this.hzD;
    D[o] = life; D[o + 1] = radius; D[o + 2] = strength; D[o + 3] = cx; D[o + 4] = cy;
  }

  _boost(amp) {
    let i = this.boN;
    if (i >= BOOST_CAP) i = 0; else this.boN++;
    this.boT0[i] = this.time; this.boA[i] = amp;
  }

  _frag(x, y, vx, vy, cx, cy, life, drag, heat, size, col) {
    if (this.fgN >= FRAG_CAP) return;
    const g = this.fgN++;
    this.fgX[g] = x; this.fgY[g] = y; this.fgT0[g] = this.time;
    const o = g * FG, D = this.fgD;
    D[o] = vx; D[o + 1] = vy; D[o + 2] = cx; D[o + 3] = cy; D[o + 4] = life; D[o + 5] = drag;
    D[o + 6] = heat; D[o + 7] = size; D[o + 8] = 0; D[o + 9] = col[0]; D[o + 10] = col[1]; D[o + 11] = col[2];
    this.stats.frags++;
  }

  // ------------------------------------------------------------------ pule wspólne

  _spark(x, y, vx, vy, life, size, drag, col, gain, cx, cy) {
    const S = SparkSystem3D.stage();
    if (!S) return;
    S.x = x; S.y = y; S.vx = vx; S.vy = vy; S.life = life; S.size = size; S.drag = drag;
    S.r = col[0]; S.g = col[1]; S.b = col[2]; S.gain = gain;
    S.cvx = cx; S.cvy = cy; S.t0 = SimClock.sim; S.clock = CLOCK_SIM;
    SparkSystem3D.pushStaged();
  }

  _puff(x, y, vx, vy, cx, cy, size0, growth, life, temp, pal, opacity, z) {
    const smoke = this.rocketFx?.smoke;
    if (!smoke || !this.opts.smoke) return;
    const S = smoke.s;
    S.x = x; S.y = y; S.z = z; S.vx = vx; S.vy = vy; S.cx = cx; S.cy = cy;
    S.size0 = size0; S.growth = growth; S.life = life; S.temp = temp; S.pal = pal; S.opacity = opacity;
    S.age = 0; S.angle = NaN;
    smoke.push();
  }

  /** Paczka puli broni w ŚWIECIE gry (at/dir w scenie: y odwrócone). */
  _pk(pool, kind, n, x, y, dx, dy) {
    return pool.begin(kind, fxRandom.round(n)).at(x, -y).dir(dx, -dy);
  }

  _gpu() {
    const W = this.weaponFx;
    if (!W) return null;
    if (!W.gpu && typeof W.ensure === 'function') W.ensure();
    return W.gpu || null;
  }

  _stamp(entity, x, y, r, heat, scorch, hole, ion) {
    if (!this.opts.heat || !entity || !HullDamageMap?.enabled) return;
    HullDamageMap.stampRecipe(entity, x, y, r, heat, scorch, hole, ion, 0, 0, 1);
  }

  // ------------------------------------------------------------------ stopienie

  /**
   * Obraz rdzeni co klatkę (przed renderem): światło reaktora, żar płyty nad komorą, języki
   * plazmy z wyrwy, łuki po poszyciu, iskry, implozja. `cores` — wszystkie rdzenie w grze.
   */
  syncCores(cores, simDt) {
    this.cores = cores;
    this.imN = 0;
    if (!Array.isArray(cores)) return;
    const dt = simDt > 0 ? simDt : 0;
    for (let c = 0; c < cores.length; c++) {
      const core = cores[c];
      if (!core || core.invalid || core.state === CORE_STATE.DETONATED || core.state === CORE_STATE.NOMINAL) continue;
      if (!reactorHull(core.host)) continue;
      this._syncCore(core, dt);
    }
  }

  _coreRec(core) {
    let r = this._coreFx.get(core);
    if (!r) {
      r = { pulse: fxRandom.next() * TAU, vent: 0, arc: 0, heat: 0, spark: 0, suck: 0, col: [0, 0, 0] };
      plasmaOf(core, r.col);
      this._coreFx.set(core, r);
    }
    return r;
  }

  _syncCore(core, dt) {
    const rec = this._coreRec(core);
    const col = rec.col;
    const host = core.host;
    const w = reactorCoreWorld(core, this._p);
    const x = w.x, y = w.y;
    const R = core.gridR;
    const hvx = entVx(host), hvy = entVy(host);
    const melt = core.state === CORE_STATE.MELTDOWN;
    const crit = core.state === CORE_STATE.CRITICAL;
    const prog = melt && core.meltdownDuration > 0 ? clamp(1 - core.meltdownRemaining / core.meltdownDuration, 0, 1) : 0;
    const hz = melt ? 1.2 + 5.8 * prog * prog : (crit ? 0.9 : 0.5);
    rec.pulse += TAU * hz * dt;
    const s = Math.max(0, Math.sin(rec.pulse));
    const pulse = 0.55 + 0.45 * s * s;
    const deadN = core.deadCount + core.elsewhereCount;
    // 1) Światło reaktora: z wyrwy (świeci wnętrze rany i okoliczne poszycie), rośnie ze stanem.
    if (this.opts.lights && this.core.fx?.lights) {
      const base = melt ? 1.2 + 2.6 * prog * prog : (crit ? 0.9 : 0.4);
      const hole = deadN > 0 ? 1 : 0.35;
      const power = base * pulse * hole;
      const range = R * (melt ? 6 + 9 * prog : (crit ? 5 : 4));
      this.core.fx.lights.point(x, y, col[0] * 0.85 + 0.15, col[1] * 0.85 + 0.15, col[2] * 0.85 + 0.15, power, range, 18, 0.5);
      this.stats.lights++;
    }
    // 2) Żar płyty nad komorą (mapa ran — stygnie sama, odświeżamy co 0,18 s).
    rec.heat -= dt;
    if (rec.heat <= 0 && (melt || crit)) {
      rec.heat = 0.18;
      const hHeat = melt ? 0.55 + 1.65 * prog * prog + (prog > 0.9 ? (prog - 0.9) * 4 : 0) : 0.32;
      const hR = R * (melt ? 1.15 + 1.1 * prog : 1.05);
      this._stamp(host, x, y, hR, hHeat, melt ? 0.25 + 0.55 * prog : 0.2, 0, melt ? 0.15 * prog : 0);
    }
    // 3) Języki plazmy z wyrwy, para i iskry (tylko przez martwe komórki komory).
    const ventRate = melt ? 6 + 44 * prog * prog : (crit ? 3 : 1.2);
    const suck = this.opts.implosion && melt && core.meltdownRemaining < 0.35;
    if (this.opts.vents && deadN > 0 && dt > 0) {
      rec.vent += ventRate * dt;
      let guard = 0;
      while (rec.vent >= 1 && guard++ < 12) {
        rec.vent -= 1;
        this._vent(core, rec, x, y, R, hvx, hvy, prog, melt, suck);
      }
    }
    // 4) Łuki po poszyciu wokół komory (pula ARC broni — przeskakują co 1/30 s).
    const arcRate = melt ? 1.5 + 12 * prog * prog : (crit ? 0.8 : 0);
    if (this.opts.arcs && arcRate > 0 && dt > 0) {
      rec.arc += arcRate * dt;
      let guard = 0;
      while (rec.arc >= 1 && guard++ < 6) {
        rec.arc -= 1;
        this._hullArc(core, col, x, y, R, hvx, hvy, prog);
      }
    }
    // 5) Implozja: ostatnie 0,35 s — soczewka do środka, przygaszenie, blask ładuje się w komorze.
    if (suck && this.imN < 16) {
      const k = 1 - core.meltdownRemaining / 0.35;
      const i = this.imN++;
      this.imX[i] = x; this.imY[i] = y;
      this.imD[i * 3] = R * 9; this.imD[i * 3 + 1] = k; this.imD[i * 3 + 2] = 0;
    }
  }

  _vent(core, rec, x, y, R, hvx, hvy, prog, melt, suck) {
    // losowa martwa komórka komory (wyrwa) — jej pozycja i kierunek od rdzenia
    const n = core.cellX.length;
    let k = -1;
    for (let t = 0; t < 8; t++) {
      const c = Math.floor(fxRandom.next() * n);
      if (core.cellState[c] !== 0) { k = c; break; }
    }
    if (k < 0) return;
    const p = reactorCellWorld(core, k, this._q);
    let dx = p.x - x, dy = p.y - y;
    const dl = Math.sqrt(dx * dx + dy * dy);
    if (dl > 1e-3) { dx /= dl; dy /= dl; } else { const a = fxRandom.next() * TAU; dx = Math.cos(a); dy = Math.sin(a); }
    const j = (fxRandom.next() - 0.5) * 0.8;
    const cj = Math.cos(j), sj = Math.sin(j);
    const ux = dx * cj - dy * sj, uy = dx * sj + dy * cj;
    const col = rec.col;
    const gpu = this._gpu();
    this._setCarrier(hvx, hvy);
    try {
      if (suck) {
        // wsysanie: iskry lecą DO komory
        for (let s = 0; s < 6; s++) {
          const a = fxRandom.next() * TAU;
          const r0 = R * (1.6 + fxRandom.next() * 2.4);
          const sx = x + Math.cos(a) * r0, sy = y + Math.sin(a) * r0;
          const sp = 900 + fxRandom.next() * 900;
          this._spark(sx, sy, -Math.cos(a) * sp, -Math.sin(a) * sp, 0.14 + fxRandom.next() * 0.1, 0.35, 0.2, SPARK_HOT, 1.2, hvx, hvy);
        }
        return;
      }
      const hot = melt ? 0.6 + 0.4 * prog : 0.45;
      if (gpu) {
        // język plazmy (PLUME: długość s0, szerokość s1) w barwie frakcji, biały u nasady
        const L = R * (0.9 + 1.6 * hot) * (0.7 + fxRandom.next() * 0.6);
        this._pk(gpu.add, K.PLUME, 1, p.x, p.y, ux, uy).life(0.14, 0.26)
          .s0(L * 0.4, L).s1(R * 0.35, R * 0.7)
          .color(col[0] * 1.4 + 0.9, col[1] * 1.4 + 0.9, col[2] * 1.4 + 0.9).color1(col[0] * 0.9, col[1] * 0.9, col[2] * 0.9)
          .mix(6).alpha(0.85, 1).emit();
        this._pk(gpu.add, K.GLOW, 1, p.x, p.y, ux, uy).life(0.1, 0.18).s0(R * 0.3, R * 0.4).s1(R * 1.2, R * 1.8)
          .color(col[0] * 1.6 + 0.5, col[1] * 1.6 + 0.5, col[2] * 1.6 + 0.5).color1(col[0] * 0.4, col[1] * 0.4, col[2] * 0.4)
          .mix(8).alpha(0.6, 0.8).fade(0.01, 2).grow(0.5).emit();
      }
      // iskry z wyrwy
      const ns = melt ? 3 + Math.round(6 * prog) : 2;
      for (let s = 0; s < ns; s++) {
        const a = Math.atan2(uy, ux) + (fxRandom.next() - 0.5) * 1.1;
        const sp = (380 + fxRandom.next() * 900) * (0.8 + hot * 0.5);
        const c = fxRandom.next() < 0.5 ? SPARK_HOT : SPARK_GOLD;
        this._spark(p.x, p.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + fxRandom.next() * 0.45, 0.3 + fxRandom.next() * 0.4, 1.4, c, 1, hvx, hvy);
      }
      // para plazmy z wyrwy (świeci, stygnie)
      if (fxRandom.next() < 0.55) {
        const sp = 90 + fxRandom.next() * 220;
        this._puff(p.x, p.y, ux * sp, uy * sp, hvx, hvy, R * 0.25, R * 0.9, 1.2 + fxRandom.next() * 1.4,
          0.3 + 0.25 * hot, this.vaporPal, 0.14 + 0.08 * hot, 16);
      }
    } finally {
      ActiveCarrier.clear();
    }
  }

  _hullArc(core, col, x, y, R, hvx, hvy, prog) {
    const gpu = this._gpu();
    const host = core.host;
    if (!gpu) return;
    let tx = x, ty = y;
    for (let t = 0; t < 6; t++) {
      const a = fxRandom.next() * TAU;
      const r = R * (1.3 + fxRandom.next() * (1.6 + 2.2 * prog));
      tx = x + Math.cos(a) * r; ty = y + Math.sin(a) * r;
      if (HullBodies.probe(host, tx, ty)) break;
    }
    const dx = tx - x, dy = ty - y;
    const L = Math.sqrt(dx * dx + dy * dy);
    this._setCarrier(hvx, hvy);
    try {
      this._pk(gpu.arc, 0, 1, x, y, dx, dy).speed(L, L).life(0.07, 0.18)
        .color(col[0] * 2.2 + 1.6, col[1] * 2.2 + 1.6, col[2] * 2.2 + 1.6).x01(R * 0.18, 1.3).z(17).emit();
      if (this.core.fx?.lights) this.core.fx.lights.flash(tx, ty, col[0], col[1], col[2], 1.4 + 2 * prog, R * 3, 0.12, 2, 0.6, 16);
      for (let s = 0; s < 3; s++) {
        const a = fxRandom.next() * TAU, sp = 200 + fxRandom.next() * 500;
        this._spark(tx, ty, Math.cos(a) * sp, Math.sin(a) * sp, 0.15 + fxRandom.next() * 0.25, 0.25, 2, SPARK_HOT, 0.9, hvx, hvy);
      }
    } finally {
      ActiveCarrier.clear();
    }
  }

  // ------------------------------------------------------------------ detonacja

  /**
   * Detonacja rdzenia: zdarzenie logiki (`detonate`), wynik rozpadu (applyReactorDetonation)
   * i trafienia fali (applyReactorBlast — skopiowane). Obraz w świecie gry.
   */
  detonation(ev, res, hits = null) {
    const core = ev.core;
    const host = ev.host;
    const col = plasmaOf(core, this._col);
    const v = VARIANT_FX[ev.variant] || VARIANT_FX.shatter;
    const cls = CLASS_FX[core.classId] || CLASS_FX.capital;
    const hostR = Math.max(60, Number(host?.radius) || 200);
    const Rb = clamp(hostR * 0.95, 90, 1100) * v.fireball;
    const Rs = clamp(hostR * 0.95, 90, 1100);   // skala sceny wybuchu (niezależna od wariantu)
    const cx = entVx(host), cy = entVy(host);
    this.stats.blasts++;
    this._blastCore(ev.x, ev.y, col, v, cls, Rb, Rs, cx, cy, 1);
    // Plazma bije z pęknięć (przełamanie, rozerwanie, rozprysk): bryły i snopy iskier wzdłuż szczelin.
    if (v.crack > 0 && res?.cuts?.length) this._cracks(res, col, v, cls, Rs, cx, cy);
    // Rozżarzone brzegi rany: żar i osmalenie na odłamach, kilka płonących ran.
    if (res) this._woundEdges(res, col, Rs);
    // Sąsiedzi: osmalenie od strony wybuchu, iskry odbite od burty.
    if (hits && hits.length) this._neighborHits(hits, col, Rs);
    if (this.onShake) this.onShake(18 * cls.shake * v.flash, 0.7);
  }

  /** Wybuch kuli plazmy (zdarzenie orbDetonate). */
  orbBurst(ev, hits = null) {
    const orb = ev.orb;
    const core = orb?.core;
    const col = plasmaOf(core || { color: orb?.color, host: orb?.host }, this._col);
    const v = VARIANT_FX['orb-burst'];
    const cls = CLASS_FX[orb?.classId] || CLASS_FX.capital;
    const Rs = clamp((Number(orb?.radius) || 30) * 7, 90, 700);
    this._blastCore(ev.x, ev.y, col, v, cls, Rs * v.fireball, Rs, Number(orb?.vx) || 0, Number(orb?.vy) || 0, 0.85);
    if (hits && hits.length) this._neighborHits(hits, col, Rs);
    if (this.onShake) this.onShake(10 * cls.shake, 0.45);
  }

  /**
   * Rdzeń receptury: błysk z linią anamorficzną, światło, bloom, kula plazmy z bryłami, iskry,
   * rozżarzone odłamki, płonące odłamki, chmura oparów, fala, gorące powietrze.
   */
  _blastCore(x, y, col, v, cls, Rb, Rs, cx, cy, power) {
    const n = cls.count;
    const lifeK = cls.life;
    const sk = Math.sqrt(Rs / 400);
    // 1) Błysk: mały biały rdzeń (nad progiem, krótko) i halo w barwie frakcji pod progiem.
    const cw = 14 * v.flash * power;
    this._flash(x, y, 1.4, cx, cy,
      (col[0] * 0.35 + 0.65) * cw, (col[1] * 0.35 + 0.65) * cw, (col[2] * 0.35 + 0.65) * cw, Rs * 0.3, 0.06,
      col[0] * 0.14, col[1] * 0.14, col[2] * 0.14, Rs * 1.6 * v.flash, 0.25, 97);
    // linia anamorficzna (poziomo na ekranie), cienka i krótka
    const arcs = this.rocketFx?.arcs;
    if (arcs && this.opts.arcs) {
      const tl = this._rocketTime();
      const L = Rs * 1.0 * v.flash;
      arcs.line(tl, x - L, y, x + L, y, 0.2, 1.0, 4, [col[0] * 1.5 + 1.2, col[1] * 1.5 + 1.2, col[2] * 1.5 + 1.2], [col[0] * 0.3, col[1] * 0.3, col[2] * 0.3], 95);
      arcs.line(tl, x - L * 0.35, y, x + L * 0.35, y, 0.18, 1.6, 6, [4.2, 4, 4.5], [col[0] * 0.4, col[1] * 0.4, col[2] * 0.4], 96);
    }
    // 2) Światło: błysk na pół kadru (oświetla kadłuby sąsiadów od strony wybuchu) — KRÓTKI jak
    //    u ciężkiej broni (0,1–0,4 s): przy 1,2 s kadłub pod wybuchem był biały przez pół sekundy;
    //    potem ogień kuli (słabszy, migocze) i długi żar.
    if (this.opts.lights && this.core.fx?.lights) {
      this._setCarrier(cx, cy);
      try {
        this.core.fx.lights.flash(x, y, col[0] * 0.6 + 0.4, col[1] * 0.6 + 0.4, col[2] * 0.6 + 0.4, 9 * v.flash * power, Rs * 5, 0.38, 2, 0.12, 150, 0.3);
        this.core.fx.lights.flash(x, y, col[0] * 0.3 + 0.7, col[1] * 0.3 + 0.45, col[2] * 0.3 + 0.25, 2.2 * v.flash * power, Rs * 3.2, 1.5 * lifeK, 1.6, 0.3, 90, 0.2);
        this.core.fx.lights.flash(x, y, EMBER_LIGHT[0], EMBER_LIGHT[1], EMBER_LIGHT[2], 1.5 * v.flash * power, Rs * 2.2, 3.6 * lifeK, 1.3, 0.35, 60, 0.2);
      } finally { ActiveCarrier.clear(); }
    }
    // 3) Post: lekkie, krótkie podbicie bloomu i chwilowe przygaszenie (działa przy aktywnych
    //    zniekształceniach). Przy +0,3 siły poświata rozżarzonych brzegów, łuków i iskier zlewała
    //    wybuch z bliska w biały dysk na brązowym tle — wybuch świeci własnym HDR.
    if (this.opts.post) this._boost(0.1 * v.flash * power);
    // 4) Kula plazmy i bryły (nieregularny kształt; bryły później, wypychane na zewnątrz).
    if (this.opts.fireball) {
      // Sadza kul tylko na przejściu ogień → dym: stara kula stygnie do przezroczystości, szary dym
      // z kłębami robi system dymu (compute, samocień) — sadza kul dawała szare „księżyce”.
      this._fireball(x, y, 0, Rb, 3.0 * lifeK, 0.95, 0.4, 1.0, 0.5, power, PLASMA_KIND_BLAST, col, cx, cy, 44);
      const lumps = v.lumps[0] + Math.floor(fxRandom.next() * (v.lumps[1] - v.lumps[0] + 1));
      const a0 = fxRandom.next() * TAU;
      for (let l = 0; l < lumps; l++) {
        const a = a0 + (l / lumps) * TAU + (fxRandom.next() - 0.5) * 0.9;
        const d = Rb * (0.3 + fxRandom.next() * 0.38);
        const r = Rb * (0.34 + fxRandom.next() * 0.24);
        const drift = Rb * (0.25 + fxRandom.next() * 0.35);
        this._fireball(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.03 + fxRandom.next() * 0.2, r, (1.5 + fxRandom.next() * 0.8) * lifeK,
          0.88, 0.35, 0.55, 0.8, power * 0.9, PLASMA_KIND_BLAST, col,
          cx + Math.cos(a) * drift, cy + Math.sin(a) * drift, 42 - l * 0.3);
      }
    }
    this._setCarrier(cx, cy);
    try {
      // 5) Iskry: plazma (barwa frakcji → biel), złoto, pomarańcz; w próżni pełne koło.
      if (this.opts.sparks) {
        // 480 × klasa: iskry startują z jednego punktu — w pierwszych 0,1 s gęste pole, którego
        // poświata (z łukami) zlewała wybuch z bliska w biały dysk
        const ns = Math.round(480 * n * v.sparks * power);
        for (let s = 0; s < ns; s++) {
          const a = fxRandom.next() * TAU;
          const sp = (700 + fxRandom.next() * fxRandom.next() * 4800) * sk;
          const r = fxRandom.next();
          let c = SPARK_WARM;
          if (r < 0.4) {
            c = this._sparkCol || (this._sparkCol = [0, 0, 0]);
            c[0] = col[0] * 0.45 + 0.55; c[1] = col[1] * 0.45 + 0.55; c[2] = col[2] * 0.45 + 0.55;
          } else if (r < 0.75) c = SPARK_GOLD;
          this._spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, (0.45 + fxRandom.next() * 1.4) * lifeK, 0.2 + fxRandom.next() * fxRandom.next() * 0.7,
            0.8 + fxRandom.next() * 1.6, c, r < 0.4 ? 0.65 : 0.6, cx, cy);
        }
      }
      const gpu = this._gpu();
      if (gpu) {
        // 6) Rozżarzone odłamki konstrukcji (DEBRIS: żar → blacha, oświetlane siatką świateł).
        if (this.opts.debris) {
          this._pk(gpu.debris, K.CHUNK, 34 * n * v.frags * power, x, y, 1, 0).cone(Math.PI, 0.2)
            .speed(300 * sk, 1700 * sk).life(1.8 * lifeK, 3.8 * lifeK).drag(0.25, 0.5)
            .s0(4 * sk, 11 * sk).s1(4 * sk, 11 * sk).colors(CHUNK_HOT, CHUNK_STEEL).alpha(1, 1).spin(9).x01(0.9, 0).emit();
        }
        // ogień rozerwanego kadłuba (ADD FIRE — kłęby stygną z bieli w czerwień)
        this._pk(gpu.add, K.FIRE, 10 * n * power, x, y, 1, 0).cone(Math.PI, 0.18).speed(160 * sk, 620 * sk)
          .life(0.45, 1.0).drag(2.6, 2.6).s0(Rs * 0.06, Rs * 0.1).s1(Rs * 0.16, Rs * 0.32).colors(FIRE_DIM, FIRE_COOL)
          .mix(2.4).alpha(0.45, 0.8).fade(0.08, 1.3).grow(0.4).spin(1.2).emit();
      }
    } finally {
      ActiveCarrier.clear();
    }
    // 7) Płonące odłamki z własnymi smugami dymu.
    if (this.opts.frags) {
      const nf = Math.round(14 * n * v.frags * power);
      for (let f = 0; f < nf; f++) {
        const a = fxRandom.next() * TAU;
        const sp = (500 + fxRandom.next() * 1300) * sk;
        const c = fxRandom.next() < 0.3 ? col : FIRE_HOT;
        this._frag(x, y, Math.cos(a) * sp, Math.sin(a) * sp, cx, cy, (1.2 + fxRandom.next() * 2.2) * lifeK,
          0.9 + fxRandom.next() * 0.8, 0.8 + fxRandom.next() * 0.4, (0.8 + fxRandom.next() * 0.9) * sk, c);
      }
    }
    // 8) Chmura oparów metalu i sadzy (dym compute: samocień, światło z siatki — błysk go oświetla).
    if (this.opts.smoke) {
      const np = Math.round(80 * n * v.smoke * power);
      for (let p = 0; p < np; p++) {
        const a = fxRandom.next() * TAU;
        const r0 = Rb * 0.35 * Math.sqrt(fxRandom.next());
        const sp = (110 + fxRandom.next() * 560) * sk;
        const vapor = fxRandom.next() < 0.45;
        this._puff(x + Math.cos(a) * r0, y + Math.sin(a) * r0, Math.cos(a) * sp, Math.sin(a) * sp, cx, cy,
          Rs * (0.05 + fxRandom.next() * 0.08), Rs * (0.18 + fxRandom.next() * 0.22), (4 + fxRandom.next() * 5.5) * lifeK,
          vapor ? 0.34 : 0.16 + fxRandom.next() * 0.18, vapor ? this.vaporPal : SMOKE_SOOT, 0.2 + fxRandom.next() * 0.14, 22 + fxRandom.next() * 12);
      }
    }
    // 9) Fala (sama refrakcja) + pchnięcie dymu; gorące powietrze nad kulą.
    if (this.opts.shock) this._shock(x, y, 0.95, Rs * 5.2 * v.shock, 0.36, Rs * 0.26, 15 * v.shock * power, cx, cy);
    const rd = this.rocketFx?.director;
    if (rd && typeof rd._blast === 'function' && this.opts.smoke) {
      rd._blast(x, y, 0.9, 0, Rs * 4.2 * v.shock, 0.36, Rs * 0.35, 9000 * v.shock * power, cx, cy);
    }
    if (this.opts.haze) this._haze(x, y, 2.4 * lifeK, Rb * 1.25, 3.4 * power, cx, cy);
  }

  // Punkty szczeliny W METALU: od rzutu rdzenia na zewnątrz (dir ±1) co `step`, dopóki obok leży
  // blacha któregoś odłamu (sonda ~2,4 komórki) — pęknięcie kończy się na burcie, nie w próżni.
  _crackRun(res, ax, ay, dx, dy, tc, tEnd, dir, step, out) {
    out.length = 0;
    const frags = res.fragments;
    let miss = 0;
    for (let t = tc; dir > 0 ? t <= tEnd : t >= tEnd; t += dir * step) {
      const px = ax + dx * t, py = ay + dy * t;
      let near = false;
      for (let f = 0; f < frags.length && !near; f++) {
        const h = reactorHull(frags[f]);
        if (h && HullBodies.probe(frags[f], px, py, h.body.cellSize * 2.4)) near = true;
      }
      if (near) { out.push(px, py); miss = 0; } else if (out.length && ++miss >= 2) break;
    }
    return out;
  }

  _cracks(res, col, v, cls, Rs, cx, cy) {
    const cuts = res.cuts;
    const sk = Math.sqrt(Rs / 400);
    const n = cls.count;
    const arcs = this.rocketFx?.arcs;
    const tl = this._rocketTime();
    const run = this._run || (this._run = []);
    const bc = this._boltCore || (this._boltCore = [0, 0, 0]);
    const bg = this._boltGlow || (this._boltGlow = [0, 0, 0]);
    // rdzeń szwu ~1,8 luminancji (cienki, nad progiem), poświata pod progiem — przy 2,9 szwy wzdłuż
    // wszystkich szczelin sumowały się w bloomie z iskrami w biały dysk
    bc[0] = col[0] * 1.6 + 1.3; bc[1] = col[1] * 1.6 + 1.3; bc[2] = col[2] * 1.6 + 1.3;
    bg[0] = col[0] * 0.4; bg[1] = col[1] * 0.4; bg[2] = col[2] * 0.4;
    const step = Math.max(8, Rs * 0.06);
    this._setCarrier(cx, cy);
    try {
      for (let c = 0; c + 3 < cuts.length; c += 4) {
        const ax = cuts[c], ay = cuts[c + 1], bx = cuts[c + 2], by = cuts[c + 3];
        let dx = bx - ax, dy = by - ay;
        const L = Math.sqrt(dx * dx + dy * dy);
        if (!(L > 1e-3)) continue;
        dx /= L; dy /= L;
        const nx = -dy, ny = dx;
        // Rzut rdzenia na szczelinę: pęknięcie przez rdzeń (przełamanie) biegnie w obie strony,
        // promień (rozerwanie, rozprysk) — od rdzenia na zewnątrz.
        const tc = clamp((res.x - ax) * dx + (res.y - ay) * dy, 0, L);
        for (let side = 1; side >= -1; side -= 2) {
          if (side < 0 && tc < step) break;
          this._crackRun(res, ax, ay, dx, dy, tc, side > 0 ? L : 0, side, step, run);
          const np = run.length >> 1;
          if (np < 2) continue;
          // szew plazmy: poszarpane, migoczące wyładowanie wzdłuż szczeliny (co ~3 punkty)
          if (arcs && this.opts.arcs) {
            for (let k = 0; k + 1 < np; k += 3) {
              const k2 = Math.min(np - 1, k + 3);
              arcs.bolt(tl, run[k * 2], run[k * 2 + 1], run[k2 * 2], run[k2 * 2 + 1], fxRandom,
                0.42 + fxRandom.next() * 0.25, 1, 0.2, 1.6, 5, bc, bg, 62);
            }
          }
          // bryły plazmy wzdłuż szczeliny (plazma pędzi pęknięciem — dalej od rdzenia później)
          const lumps = Math.round(2 * v.crack);
          for (let l = 0; l < lumps; l++) {
            const k = Math.min(np - 1, Math.floor((0.25 + 0.6 * (l + fxRandom.next()) / Math.max(1, lumps)) * np));
            const px = run[k * 2], py = run[k * 2 + 1];
            const d = Math.hypot(px - res.x, py - res.y);
            this._fireball(px, py, d / 3200, Rs * (0.17 + fxRandom.next() * 0.12), 1.4 * cls.life, 0.9, 0.35, 0.7, 0.75, 0.9,
              PLASMA_KIND_BLAST, col, cx + nx * side * 40, cy + ny * side * 40, 41);
          }
          // snopy iskier z obu brzegów szczeliny (prostopadle)
          if (this.opts.sparks) {
            const ns = Math.round(130 * n * v.crack);
            for (let s = 0; s < ns; s++) {
              const k = Math.floor(fxRandom.next() * np);
              const px = run[k * 2], py = run[k * 2 + 1];
              const sd = fxRandom.next() < 0.5 ? 1 : -1;
              const a = Math.atan2(ny * sd, nx * sd) + (fxRandom.next() - 0.5) * 0.9;
              const sp = (400 + fxRandom.next() * 1700) * sk;
              const cc = fxRandom.next() < 0.5 ? SPARK_HOT : SPARK_GOLD;
              this._spark(px, py, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + fxRandom.next() * 0.7, 0.3 + fxRandom.next() * 0.4, 1.4, cc, 1, cx, cy);
            }
          }
        }
      }
    } finally {
      ActiveCarrier.clear();
    }
  }

  _woundEdges(res, col, Rs) {
    const E = res.edges;
    const gpu = this._gpu();
    let burns = 0;
    for (let k = 0; k + 2 < E.length; k += 6) {
      const x = E[k], y = E[k + 1], e = E[k + 2];
      if (!e) continue;
      // żar 1,0–1,35: poszycie przy przełomie pomarańczowe tuż nad progiem, biel tylko na krawędzi
      // prawdziwej dziury (przy 1,6–2,2 cały przełom świecił pomarańczem ~2,4 i zlewał się w bloomie)
      this._stamp(e, x, y, 14 + fxRandom.next() * 12, 1.0 + fxRandom.next() * 0.35, 0.95, 0.7, 0.15);
      // kilka płonących ran (ogień i dym z brzegu przez parę sekund)
      if (gpu && burns < 3 && fxRandom.next() < 0.15 && this.weaponFx?.ctx?.burn) {
        const nx = x - res.x, ny = y - res.y;
        const nl = Math.sqrt(nx * nx + ny * ny) || 1;
        this.weaponFx.ctx.burn(e, x, y, nx / nl, ny / nl, 4 + fxRandom.next() * 3, 1.1, 'armata');
        burns++;
      }
    }
    // krater wokół rdzenia na głównym wraku (jeśli został)
    if (res.wreck && reactorHull(res.wreck)) this._stamp(res.wreck, res.x, res.y, res.craterR * 1.3, 2.8, 1, 0.8, 0.25);
  }

  _neighborHits(hits, col, Rs) {
    for (let h = 0; h < hits.length; h++) {
      const hit = hits[h];
      const e = hit.entity;
      const t = hit.t;
      if (!(t > 0)) continue;
      this._stamp(e, hit.x, hit.y, 26 + Rs * 0.28 * t, 2.6 * t + 0.4, 0.95 * t, 0.2, 0.15 * t);
      const ex = entVx(e), ey = entVy(e);
      this._setCarrier(ex, ey);
      try {
        const ns = Math.round(120 * t);
        const na = Math.atan2(-hit.ny, -hit.nx);
        for (let s = 0; s < ns; s++) {
          const a = na + (fxRandom.next() - 0.5) * 2.4;
          const sp = 300 + fxRandom.next() * 1500;
          this._spark(hit.x, hit.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + fxRandom.next() * 0.6, 0.3 + fxRandom.next() * 0.4, 1.6,
            fxRandom.next() < 0.5 ? SPARK_GOLD : SPARK_WARM, 1, ex, ey);
        }
        if (this.core.fx?.lights) this.core.fx.lights.flash(hit.x, hit.y, 1.0, 0.7, 0.4, 4 * t, 260 + Rs * 0.4 * t, 0.35, 2, 0.3, 30);
      } finally { ActiveCarrier.clear(); }
    }
  }

  /** Wybuch wtórny (amunicja, paliwo) w odłamie: mała kula ognia, iskry, dym, odłamki. */
  secondary(x, y, entity, size) {
    const col = FIRE_HOT;
    const cx = entVx(entity), cy = entVy(entity);
    const S = Math.max(16, Number(size) || 34);
    this._flash(x, y, 0.5, cx, cy, 9, 7, 5, S * 1.4, 0.05, 0.5, 0.3, 0.12, S * 6, 0.16, 94);
    this._fireball(x, y, 0, S * 2.4, 1.5, 1.0, 0.45, 0.12, 0.7, 1, PLASMA_KIND_BLAST, col, cx, cy, 43);
    this._setCarrier(cx, cy);
    try {
      if (this.core.fx?.lights) this.core.fx.lights.flash(x, y, 1.0, 0.6, 0.3, 9, S * 9, 0.45, 2, 0.2, 60);
      for (let s = 0; s < 55; s++) {
        const a = fxRandom.next() * TAU, sp = 150 + fxRandom.next() * fxRandom.next() * 1500;
        this._spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + fxRandom.next() * 0.7, 0.25 + fxRandom.next() * 0.4, 2.2,
          fxRandom.next() < 0.35 ? SPARK_GOLD : SPARK_WARM, 0.9, cx, cy);
      }
      const gpu = this._gpu();
      if (gpu) {
        this._pk(gpu.add, K.FIRE, 7, x, y, 1, 0).cone(Math.PI, 0.18).speed(40, 220).life(0.4, 0.9).drag(2.8, 2.8)
          .s0(S * 0.35, S * 0.6).s1(S * 0.9, S * 1.6).colors(FIRE_DIM, FIRE_COOL).mix(2.6).alpha(0.5, 0.85).fade(0.05, 1.3).grow(0.4).spin(1.4).emit();
      }
      if (gpu && this.opts.debris) {
        this._pk(gpu.debris, K.CHUNK, 10, x, y, 1, 0).cone(Math.PI, 0.2).speed(200, 900).life(1.2, 2.6).drag(0.3, 0.5)
          .s0(3, 8).s1(3, 8).colors(CHUNK_HOT, CHUNK_STEEL).alpha(1, 1).spin(10).x01(1.0, 0).emit();
      }
    } finally { ActiveCarrier.clear(); }
    for (let p = 0; p < 12; p++) {
      const a = fxRandom.next() * TAU, sp = 60 + fxRandom.next() * 260;
      this._puff(x, y, Math.cos(a) * sp, Math.sin(a) * sp, cx, cy, S * 0.35, S * 1.1, 3 + fxRandom.next() * 2.5, 0.6, SMOKE_SOOT, 0.24, 24);
    }
    if (this.opts.shock) this._shock(x, y, 0.4, S * 9, 0.25, S * 0.7, 5, cx, cy);
    this._stamp(entity, x, y, S * 1.3, 3.2, 1, 0.75, 0);
    if (this.onShake) this.onShake(3, 0.2);
  }

  // ------------------------------------------------------------------ strumień i kula

  addJet(jet) { if (jet && this.jets.indexOf(jet) < 0) { this.jets.push(jet); this.stats.jets++; } }
  addOrb(orb) { if (orb && this.orbs.indexOf(orb) < 0) { this.orbs.push(orb); this.stats.orbs++; } }

  /** Hak logiki kuli: stopione węzły → rozżarzony brzeg kanału (mapa ran), krople i iskry. */
  melt(entity, orb, killed) {
    let r = this._orbFx.get(orb);
    if (!r) { r = { stamp: 0, trail: 0, drip: 0, col: [0, 0, 0] }; plasmaOf(orb.core, r.col); this._orbFx.set(orb, r); }
    if (this.time - r.stamp > 0.045) {
      r.stamp = this.time;
      this._stamp(entity, orb.x, orb.y, orb.radius * 1.7, 3.6, 0.85, 0.75, 0.4);
    }
    r.drip += killed;
  }

  /** Hak logiki strumienia: rzaz w trafionym kadłubie → pas żaru wzdłuż rzazu. */
  jetCut(entity, x, y, dx, dy, depth, jet) {
    if (!this.opts.heat || !entity || !HullDamageMap?.enabled) return;
    HullDamageMap.stampKerf(entity, x, y, x + dx * depth, y + dy * depth, 'hexlance');
  }

  /** Co klatkę (przed renderem): światła i emisja strumieni i kul (dane z logiki). */
  syncHazards(simDt) {
    const dt = simDt > 0 ? simDt : 0;
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const jet = this.jets[i];
      if (!jet || (jet.done && !(jet.env > 0))) { this.jets.splice(i, 1); continue; }
      this._syncJet(jet, dt);
    }
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      if (!orb || orb.detonated) { this.orbs.splice(i, 1); continue; }
      this._syncOrb(orb, dt);
    }
  }

  _jetRec(jet) {
    let r = this._jetFx.get(jet);
    if (!r) { r = { col: [0, 0, 0], puff: 0, spark: 0, hitSpark: 0, stamp: 0, seed: fxRandom.next() }; plasmaOf(jet.core || { color: jet.color }, r.col); this._jetFx.set(jet, r); }
    return r;
  }

  _syncJet(jet, dt) {
    const r = this._jetRec(jet);
    const col = r.col;
    const env = jet.env || 0;
    if (!(env > 0)) return;
    const ox = jet.originX, oy = jet.originY, dx = jet.dirWX, dy = jet.dirWY;
    const ex = jet.endX, ey = jet.endY;
    const L = Math.sqrt((ex - ox) * (ex - ox) + (ey - oy) * (ey - oy));
    const hvx = jet.hostVx || 0, hvy = jet.hostVy || 0;
    const lights = this.core.fx?.lights;
    if (lights && this.opts.lights) {
      // wzdłuż strugi (od 0,3 L — pierwsze światło w 0,15 L leżało w kadłubie źródła i bieliło go)
      for (let k = 0; k < 3; k++) {
        const t = (0.3 + 0.3 * k) * L;
        lights.point(ox + dx * t, oy + dy * t, col[0] * 0.8 + 0.2, col[1] * 0.8 + 0.2, col[2] * 0.8 + 0.2, 2.4 * env, jet.width * 7, 30, 0.6);
      }
      // wylot: poświata wyrwy, z której bije struga
      lights.point(ox, oy, col[0] * 0.7 + 0.3, col[1] * 0.7 + 0.3, col[2] * 0.7 + 0.3, 1.4 * env, jet.width * 5, 24, 0.5);
    }
    if (!(dt > 0)) return;
    this._setCarrier(hvx, hvy);
    try {
      // para plazmy wzdłuż strugi (świeci, rozchodzi się na boki)
      r.puff += dt * 55 * env;
      while (r.puff >= 1) {
        r.puff -= 1;
        const t = fxRandom.next() * L;
        const side = fxRandom.next() < 0.5 ? 1 : -1;
        const sp = 60 + fxRandom.next() * 220;
        this._puff(ox + dx * t, oy + dy * t, (-dy * side) * sp + dx * 400, (dx * side) * sp + dy * 400, hvx, hvy,
          jet.width * 0.35, jet.width * 1.2, 1.4 + fxRandom.next() * 1.6, 0.5, this.vaporPal, 0.12, 20);
      }
      // iskry wzdłuż strugi (plazma wyrywa krople)
      r.spark += dt * 260 * env;
      while (r.spark >= 1) {
        r.spark -= 1;
        const t = fxRandom.next() * L * 0.9;
        const a = Math.atan2(dy, dx) + (fxRandom.next() - 0.5) * 0.5;
        const sp = 1500 + fxRandom.next() * 2600;
        this._spark(ox + dx * t, oy + dy * t, Math.cos(a) * sp, Math.sin(a) * sp, 0.2 + fxRandom.next() * 0.35, 0.3 + fxRandom.next() * 0.3, 1.2,
          fxRandom.next() < 0.6 ? SPARK_HOT : SPARK_GOLD, 1.1, hvx, hvy);
      }
      // trafienie: snop iskier od burty, blask, żar
      if (jet.hitEntity) {
        const ehx = entVx(jet.hitEntity), ehy = entVy(jet.hitEntity);
        r.hitSpark += dt * 420 * env;
        const back = Math.atan2(-dy, -dx);
        while (r.hitSpark >= 1) {
          r.hitSpark -= 1;
          const a = back + (fxRandom.next() - 0.5) * 2.6;
          const sp = 400 + fxRandom.next() * 2000;
          this._spark(jet.hitX, jet.hitY, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + fxRandom.next() * 0.6, 0.3 + fxRandom.next() * 0.4, 1.3,
            fxRandom.next() < 0.5 ? SPARK_GOLD : SPARK_HOT, 1.1, ehx, ehy);
        }
        if (lights) lights.point(jet.hitX, jet.hitY, 1.0, 0.75, 0.55, 5 * env, jet.width * 6, 26, 0.6);
        this._haze(jet.hitX, jet.hitY, 0.3, jet.width * 2.5, 2.2 * env, ehx, ehy);
      }
    } finally {
      ActiveCarrier.clear();
    }
  }

  _syncOrb(orb, dt) {
    let r = this._orbFx.get(orb);
    if (!r) { r = { stamp: 0, trail: 0, drip: 0, col: [0, 0, 0] }; plasmaOf(orb.core, r.col); this._orbFx.set(orb, r); }
    const col = r.col;
    const lights = this.core.fx?.lights;
    if (lights && this.opts.lights) {
      lights.point(orb.x, orb.y, col[0] * 0.7 + 0.3, col[1] * 0.7 + 0.3, col[2] * 0.7 + 0.3, 6, orb.radius * 16, 24, 0.6);
    }
    if (!(dt > 0)) return;
    this._setCarrier(orb.vx, orb.vy);
    try {
      // krople stopionego metalu i iskry (proporcjonalnie do stopionych węzłów)
      const drip = Math.min(90, r.drip * 5);
      r.drip = 0;
      for (let s = 0; s < drip; s++) {
        const a = fxRandom.next() * TAU, sp = 120 + fxRandom.next() * 700;
        this._spark(orb.x + Math.cos(a) * orb.radius, orb.y + Math.sin(a) * orb.radius, Math.cos(a) * sp - orb.vx * 0.2, Math.sin(a) * sp - orb.vy * 0.2,
          0.3 + fxRandom.next() * 0.6, 0.35 + fxRandom.next() * 0.35, 1.5, fxRandom.next() < 0.6 ? SPARK_GOLD : SPARK_HOT, 1, orb.vx, orb.vy);
      }
      if (drip > 6) {
        const gpu = this._gpu();
        if (gpu && this.opts.debris) {
          this._pk(gpu.debris, K.CHUNK, drip * 0.08, orb.x, orb.y, 1, 0).cone(Math.PI, 0.2).speed(80, 420).life(1.0, 2.2).drag(0.4, 0.6)
            .s0(2, 5).s1(2, 5).colors(CHUNK_HOT, CHUNK_STEEL).alpha(1, 1).spin(12).x01(0.6, 0).emit();
        }
      }
      // smuga pary za kulą
      r.trail += dt * 34;
      while (r.trail >= 1) {
        r.trail -= 1;
        const a = fxRandom.next() * TAU;
        this._puff(orb.x + Math.cos(a) * orb.radius * 0.6, orb.y + Math.sin(a) * orb.radius * 0.6, Math.cos(a) * 60, Math.sin(a) * 60, 0, 0,
          orb.radius * 0.4, orb.radius * 1.3, 1.6 + fxRandom.next() * 1.2, 0.5, this.vaporPal, 0.1, 20);
      }
    } finally {
      ActiveCarrier.clear();
    }
  }

  // ------------------------------------------------------------------ płonące odłamki (CPU)

  _stepFrags(dt) {
    if (!(dt > 0) || this.fgN === 0) return;
    const D = this.fgD;
    const time = this.time;
    for (let g = this.fgN - 1; g >= 0; g--) {
      const o = g * FG;
      const a = time - this.fgT0[g];
      const life = D[o + 4];
      if (a > life) {
        const last = --this.fgN;
        if (g !== last) {
          this.fgX[g] = this.fgX[last]; this.fgY[g] = this.fgY[last]; this.fgT0[g] = this.fgT0[last];
          for (let k = 0; k < FG; k++) D[o + k] = D[last * FG + k];
        }
        continue;
      }
      const drag = D[o + 5];
      const e = Math.exp(-drag * dt);
      const x0 = this.fgX[g], y0 = this.fgY[g];
      const vx = D[o], vy = D[o + 1];
      this.fgX[g] = x0 + vx * (1 - e) / drag + D[o + 2] * dt;
      this.fgY[g] = y0 + vy * (1 - e) / drag + D[o + 3] * dt;
      D[o] = vx * e; D[o + 1] = vy * e;
      const ddx = this.fgX[g] - x0, ddy = this.fgY[g] - y0;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      D[o + 8] += d;
      const heat = D[o + 6] * (1 - a / life);
      const size = D[o + 7];
      const spacing = 12;
      let guard = 0;
      while (D[o + 8] > spacing && guard++ < 48) {
        D[o + 8] -= spacing;
        const u = d > 1e-6 ? clamp(1 - D[o + 8] / d, 0, 1) : 1;
        this._puff(x0 + ddx * u, y0 + ddy * u, D[o] * 0.07, D[o + 1] * 0.07, D[o + 2], D[o + 3],
          1.8 * size, 11 * size, 0.9 + fxRandom.next() * 1.3, heat * 0.4, SMOKE_DEBRIS, 0.22, 18);
      }
      if (fxRandom.next() < dt * 24 * heat) {
        const aa = fxRandom.next() * TAU;
        this._spark(this.fgX[g], this.fgY[g], D[o] * 0.3 + Math.cos(aa) * 160, D[o + 1] * 0.3 + Math.sin(aa) * 160,
          0.25 + fxRandom.next() * 0.3, 0.2 + fxRandom.next() * 0.2, 3, SPARK_WARM, 0.8, D[o + 2], D[o + 3]);
      }
    }
  }

  // ------------------------------------------------------------------ krok klatki efektów

  _update(ctx) {
    const t0 = performance.now();
    const origin = ctx.origin;
    const ox = origin.x, oy = origin.y;
    const time = this.time;
    const cam = ctx.core?.activeCam1;
    const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
    // Słońce kul: z puli rakiet (ten sam kierunek co dym i kule ognia).
    const sun = this.rocketFx?.sunDir;
    if (sun) this.fireballs.U.sunDir.value.copy(sun);
    // --- kule plazmy: wybuchy (z opóźnieniem brył) + kule topiące ---
    const F = this.fireballs;
    F.begin();
    const S = F.s;
    const D = this.fbD;
    for (let i = this.fbN - 1; i >= 0; i--) {
      const o = i * FB;
      const age = time - this.fbT0[i];
      if (age >= D[o + 3]) {
        const last = --this.fbN;
        if (i !== last) {
          this.fbX[i] = this.fbX[last]; this.fbY[i] = this.fbY[last]; this.fbT0[i] = this.fbT0[last];
          for (let k = 0; k < FB; k++) D[o + k] = D[last * FB + k];
        }
        continue;
      }
      if (age < 0) continue;
      const rMax = D[o + 2], life = D[o + 3];
      const R = rMax * ((1 - Math.exp(-age / D[o + 15])) * 0.8 + Math.min(1, age / life) * 0.3 + 0.03);
      S.x = this.fbX[i] + D[o] * age - ox;
      S.y = -(this.fbY[i] + D[o + 1] * age) - oy;
      S.z = D[o + 14]; S.R = R; S.age = age; S.life = life; S.seed = D[o + 13];
      S.heat = D[o + 4]; S.soot = D[o + 5]; S.plasma = D[o + 6]; S.warp = D[o + 7] + age * 0.12;
      S.bright = D[o + 8] * this.opts.gain; S.kind = D[o + 9];
      S.r = D[o + 10]; S.g = D[o + 11]; S.b = D[o + 12];
      F.push();
    }
    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      if (!orb || orb.detonated) continue;
      const r = this._orbFx.get(orb);
      const col = r ? r.col : plasmaOf(orb.core, this._col);
      S.x = orb.x - ox; S.y = -orb.y - oy; S.z = 46; S.R = orb.radius * 3.0; S.age = orb.age; S.life = 1e4;
      S.seed = (i * 0.37) % 1; S.heat = 0; S.soot = 0; S.plasma = 1; S.warp = 0.25; S.bright = 1.05 * this.opts.gain;
      S.kind = PLASMA_KIND_ORB; S.r = col[0]; S.g = col[1]; S.b = col[2];
      F.push();
    }
    F.commit(time, ox, oy);
    // --- strumienie ---
    const J = this.jetPool;
    J.begin();
    const JS = J.s;
    for (let i = 0; i < this.jets.length; i++) {
      const jet = this.jets[i];
      if (!jet || !(jet.env > 0)) continue;
      const r = this._jetRec(jet);
      const L = Math.sqrt((jet.endX - jet.originX) ** 2 + (jet.endY - jet.originY) ** 2);
      JS.x = jet.originX - ox; JS.y = -jet.originY - oy; JS.z = 48;
      JS.len = Math.max(1, L); JS.dx = jet.dirWX; JS.dy = -jet.dirWY;
      JS.width = jet.width * 0.75; JS.intensity = jet.env; JS.seed = r.seed;
      JS.flow = 3200; JS.grow = Math.min(1, jet.age / 0.12);
      JS.r = r.col[0]; JS.g = r.col[1]; JS.b = r.col[2];
      J.push();
    }
    J.commit(time, zoom, ox, oy);
    // --- duszki: błyski, blask kul, wylot strumieni, ładowanie implozji, płonące odłamki ---
    const G = this.glow;
    G.begin();
    const FLd = this.flD;
    for (let i = this.flN - 1; i >= 0; i--) {
      const o = i * FL;
      const a = time - this.flT0[i];
      if (a >= FLd[o]) {
        const last = --this.flN;
        if (i !== last) {
          this.flX[i] = this.flX[last]; this.flY[i] = this.flY[last]; this.flT0[i] = this.flT0[last];
          for (let k = 0; k < FL; k++) FLd[o + k] = FLd[last * FL + k];
        }
        continue;
      }
      const x = this.flX[i] + FLd[o + 1] * a - ox;
      const y = -(this.flY[i] + FLd[o + 2] * a) - oy;
      const ec = Math.exp(-a / FLd[o + 7]);
      const eh = Math.exp(-a / FLd[o + 12]);
      const z = FLd[o + 13];
      const hs = FLd[o + 11] * (0.7 + 0.6 * Math.min(1, a / 0.2));
      if (eh > 0.004) G.add(x, y, z - 1, hs, FLd[o + 8] * eh, FLd[o + 9] * eh, FLd[o + 10] * eh, GLOW_ROUND);
      if (ec > 0.004) G.add(x, y, z, FLd[o + 6] * (0.8 + 3 * a), FLd[o + 3] * ec, FLd[o + 4] * ec, FLd[o + 5] * ec, GLOW_ROUND);
    }
    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      if (!orb || orb.detonated) continue;
      const r = this._orbFx.get(orb);
      const col = r ? r.col : this._col;
      const fl = 0.85 + 0.15 * Math.sin(time * 37 + i * 3.1);
      // korona (pod progiem) i małe oczko w środku torusa (duże białe jądro zalewało pierścień)
      G.add(orb.x - ox, -orb.y - oy, 90, orb.radius * 10, col[0] * 0.3 * fl, col[1] * 0.3 * fl, col[2] * 0.3 * fl, GLOW_ROUND);
      G.add(orb.x - ox, -orb.y - oy, 91, orb.radius * 0.8, (col[0] * 1.5 + 1.2) * fl, (col[1] * 1.5 + 1.2) * fl, (col[2] * 1.5 + 1.2) * fl, GLOW_ROUND);
    }
    for (let i = 0; i < this.jets.length; i++) {
      const jet = this.jets[i];
      if (!jet || !(jet.env > 0)) continue;
      const r = this._jetRec(jet);
      const col = r.col;
      const e = jet.env;
      G.add(jet.originX - ox, -jet.originY - oy, 92, jet.width * 2.4, (col[0] * 2 + 2.5) * e, (col[1] * 2 + 2.5) * e, (col[2] * 2 + 2.5) * e, GLOW_ROUND);
      if (jet.hitEntity) G.add(jet.hitX - ox, -jet.hitY - oy, 92, jet.width * 2.2, 3.2 * e, 2.4 * e, 1.6 * e, GLOW_ROUND);
    }
    for (let i = 0; i < this.imN; i++) {
      const k = this.imD[i * 3 + 1];
      const R = this.imD[i * 3] / 9;
      G.add(this.imX[i] - ox, -this.imY[i] - oy, 92, R * (0.8 + 1.8 * k), 3 + 11 * k * k, 3 + 11 * k * k, 3.5 + 12 * k * k, GLOW_ROUND);
    }
    const FGd = this.fgD;
    for (let g = 0; g < this.fgN; g++) {
      const o = g * FG;
      const a = time - this.fgT0[g];
      const heat = FGd[o + 6] * (1 - a / FGd[o + 4]);
      if (heat <= 0.02) continue;
      const sz = 7 * FGd[o + 7];
      G.add(this.fgX[g] - ox, -this.fgY[g] - oy, 40, sz, FGd[o + 9] * 2.2 * heat, FGd[o + 10] * 1.6 * heat, FGd[o + 11] * 1.2 * heat, GLOW_ROUND);
    }
    G.commit(ox, oy);
    // --- zniekształcenia (świat gry, co klatkę): fale, gorące powietrze, implozje ---
    const field = ctx.core?.fxDistortion?.();
    let exposure = 1;
    if (field) {
      const SHd = this.shD;
      for (let i = this.shN - 1; i >= 0; i--) {
        const o = i * SH;
        const a = time - this.shT0[i];
        const life = SHd[o];
        if (a >= life) {
          const last = --this.shN;
          if (i !== last) {
            this.shX[i] = this.shX[last]; this.shY[i] = this.shY[last]; this.shT0[i] = this.shT0[last];
            for (let k = 0; k < SH; k++) SHd[o + k] = SHd[last * SH + k];
          }
          continue;
        }
        if (!this.opts.shock) continue;
        const R = SHd[o + 1] * (1 - Math.exp(-a / SHd[o + 2]));
        const fade = 1 - a / life;
        field.shock(this.shX[i] + SHd[o + 5] * a, this.shY[i] + SHd[o + 6] * a, R, SHd[o + 3] * (1 + 0.8 * a), SHd[o + 4] * fade * fade, 0.3);
      }
      const HZd = this.hzD;
      for (let i = this.hzN - 1; i >= 0; i--) {
        const o = i * HZ;
        const a = time - this.hzT0[i];
        const life = HZd[o];
        if (a >= life) {
          const last = --this.hzN;
          if (i !== last) {
            this.hzX[i] = this.hzX[last]; this.hzY[i] = this.hzY[last]; this.hzT0[i] = this.hzT0[last];
            for (let k = 0; k < HZ; k++) HZd[o + k] = HZd[last * HZ + k];
          }
          continue;
        }
        if (!this.opts.haze) continue;
        field.heat(this.hzX[i] + HZd[o + 3] * a, this.hzY[i] + HZd[o + 4] * a, HZd[o + 1] * (1 + 0.5 * a), HZd[o + 2] * (1 - a / life));
      }
      for (let i = 0; i < this.imN; i++) {
        const k = this.imD[i * 3 + 1];
        field.implode(this.imX[i], this.imY[i], this.imD[i * 3], 26 * k, 0.35);
        exposure = Math.min(exposure, 1 - 0.28 * k);
      }
    }
    // --- post: podbicie bloomu i przygaszenie po detonacjach ---
    let boost = 0;
    for (let i = this.boN - 1; i >= 0; i--) {
      const b = time - this.boT0[i];
      if (b > 2) {
        const last = --this.boN;
        this.boT0[i] = this.boT0[last]; this.boA[i] = this.boA[last];
        continue;
      }
      boost = Math.max(boost, this.boA[i] * Math.exp(-b / 0.14));
      exposure = Math.min(exposure, 1 - 0.18 * this.boA[i] * Math.exp(-b / 0.06));
    }
    this.post.exposure = exposure;
    this.post.bloomBoost = boost;
    const post = ctx.core?.fx?.post;
    if (post && this.opts.post) {
      if (exposure < post.exposure) post.exposure = exposure;
      if (boost > post.bloomBoost) post.bloomBoost = boost;
    }
    this.stats.cpuMs = performance.now() - t0;
    this.stats.live = { fireballs: F.count, flashes: this.flN, frags: this.fgN, shocks: this.shN, jets: J.count, orbs: this.orbs.length };
  }

  /**
   * Rozgrzewka (raz przy gotowym urządzeniu): siatki puli w passie ortho z licznikiem instancji
   * jak w prawdziwym rysowaniu (≥ 2) — pierwsza detonacja bez kompilacji shaderów.
   */
  _warm(ctx) {
    const saved = [];
    for (const m of this.meshes) {
      saved.push(m, m.visible, m.geometry.instanceCount);
      m.visible = true;
      m.geometry.instanceCount = Math.max(2, m.geometry.instanceCount || 0);
    }
    try {
      for (const m of this.meshes) ctx.core.prewarmPass(m, 0);
    } finally {
      for (let k = 0; k < saved.length; k += 3) {
        const m = saved[k];
        m.visible = saved[k + 1];
        m.geometry.instanceCount = saved[k + 2];
      }
    }
  }

  clear() {
    this.fbN = 0; this.flN = 0; this.shN = 0; this.hzN = 0; this.fgN = 0; this.boN = 0; this.imN = 0;
    this.jets.length = 0;
    this.orbs.length = 0;
    this.fireballs.clear();
    this.jetPool.clear();
    this.glow.begin();
    this.glow.mesh.visible = false;
  }
}

/** Tworzy reżysera wybuchu reaktora w Core3D (wymaga Core3D.init — scena i klatka efektów). */
export function createReactorBlastFx(core, opts = {}) {
  if (!core?.scene || !core?.fx) return null;
  const fx = new ReactorBlastFx(core, opts);
  if (typeof window !== 'undefined') window.__reactorBlastFx = fx;
  return fx;
}
