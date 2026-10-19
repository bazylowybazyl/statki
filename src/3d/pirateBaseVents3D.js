// src/3d/pirateBaseVents3D.js
//
// OBRAZ WYRW budowli bazy piratów (2026-10-19 — dekompresja, wylot powietrza, pożary; decyzje w grze:
// src/game/story/pirateBaseAtmosphere.js, stan klatki: src/render/blocks/pirateVentsBlock.js). Sam obraz — moduł nie
// czyta obiektów gry (szew renderu): dostaje rekordy wyrw (świat gry w czasie renderu: punkt, normalna, prędkość
// nośnika, promień otworu, strumień, ogień, żarzenie, kondensacja, wiek, gwałtowność, zwarcia).
//
// Warstwy (preferencja użytkownika z § „Wybuchy WebGPU”: strumień wychodzi, rozchodzi się i znika — nie wisi):
//   • STRUMIEŃ PARY I LODU: kłęby białej pary (kondensacja w próżni — rozprężony gaz stygnie), szybkie, rozchylone
//     w stożku wylotu, rozchodzą się i gasną; rdzeń strumienia (jęzor wzdłuż normalnej) i iskierki kryształków lodu;
//     duża wyrwa głównej objętości modułu na ekranie — także GAZ reżysera wybuchów (domena efektu VENT_TAG: wybuchy
//     mają pierwszeństwo; src/3d/explosions/explosionFx.js), pod płaszczyzną gry — domena głęboka (deepDomain, gdy
//     reżyser ją ma — pass tła z perspektywą).
//   • OGIEŃ w wylatującym tlenie: krótkie języki (kłęby addytywne, jęzor), światło w siatce (migocze);
//   • ŻARZENIE po pożarze: żar na brzegu otworu, poświata, ciemny dym (gaśnie z modułem);
//   • ROZSZCZELNIENIE: chłodny błysk w siatce świateł, szczątki wyrwane strumieniem (pula odłamków kadłubów), iskry
//     zwarć (elektryka wnętrza) i błyski przepięć.
// Cząstki rysują WŁASNE systemy banku Fx3D (te same grafy TSL — wspólne programy) w passach TŁA (warstwa 1, pod
// płaszczyzną gry: dysk, spadające bryły) i FG (warstwa 2, nad nią: bęben, szyb, głowa wieży) z kamerą perspektywy jak
// bryły bazy (pass ortho nie zna paralaksy — wyrwa 1,5 km nad płaszczyzną byłaby ~3× przesunięta) i z testem głębi
// (głowa wieży, dysk zasłaniają strumień za sobą). Iskry i szczątki (pule ortho gry) tylko przy płaszczyźnie gry.
// Losowanie tylko fxRandom. Rozgrzewka: wpis `wyrwy bazy piratów` (obie warstwy, licznik instancji ≥ 2).

import * as THREE from 'three/webgpu';
import { Fx3D, BillboardSystem, OrientedQuadSystem, fxQuadGraphs, sp, makeBasis, coneDir } from './fxParticles3D.js';
import { fxRandom } from './fx/fxRandom.js';
import { SimClock } from '../game/simClock.js';
import { HullDebris3D } from './hullDebris3D.js';
import { VENT_REC, VENT_KIND } from '../render/blocks/pirateVentsBlock.js';
import { VENT_TAG, FIT_RR } from './explosions/explosionFx.js';
import { WARIANT_INSTANCJI } from './rozgrzewka.js';
import { pirateRockSite } from './pirateBaseGame.js';
import { PIRATE_ROCK_SPEC } from './portBuildings/pirateRockLayout.js';

const LAYER_BG = 1;
const LAYER_FG = 2;
// Pasmo płaszczyzny gry, w którym iskry i szczątki (pule ortho) wyglądają poprawnie [|z| j.].
const PLANE_BAND = 260;
// Wyrwa poniżej tego z — domena gazu głęboka (pass tła), nad nim — zwykła.
const DEEP_Z = -300;

/** Strojenie (konsola: window.PirateVentLook; A/B warstw tej samej klatki). */
export const VENT_LOOK = {
  enabled: true,
  particles: true,
  gas: true,
  lights: true,
  sparks: true,
  debris: true,
  // gaz (domena wylotu): wyrwa głównej objętości ≥ gasMinR j. i ≥ gasMinPx px promienia na ekranie, w kadrze
  gasMinR: 60, gasMinPx: 6, gasDomains: 2, gasReserve: 2,
  gasLenK: 11.5,                // długość obłoku przy pełnym strumieniu [× promień otworu] (rozmiar domeny)
  gasDomainK: 2.6, gasDomainMin: 1200, gasDomainMax: 4400,
  // paliwo w gazie tylko na krótki język przy otworze (ogień w wylatującym tlenie — nie miotacz płomieni)
  gasSmoke: 7, gasFuel: 4.5, gasTemp: 0.25, gasFireTemp: 1.2,
  gasSpeed: 1.25,               // prędkość strumienia gazu [× długość obłoku / s]
  // para sublimuje i rozchodzi się w próżni — stały zanik w domenie wylotu (obłok nie wisi)
  gasLinger: 1.0, gasFade: 1.3, gasDecay: 1.1,
  // obraz i symulacja gaszą gaz za ~0,9 elipsoidy wpisanej w pudło domeny (pudło płaskie: wysokość 0,375 boku) — prędkość
  // strumienia dopasowana do drogi do brzegu: zasięg ≈ dysza + v · gasCoast ≤ gasFitK × droga (wyrwa w pion — kikut szybu,
  // spód dysku — nie wbija się płasko w sufit); światło otoczenia obłoku (bez niego gęsty rdzeń pod słońcem z boku czarny)
  gasCoast: 1.2, gasFitK: 0.8, gasAmbient: 0.22,
  // barwa domeny × albedo sadzy obrazu gazu (0,15) = albedo pary: biała, lekko błękitna (~0,77); przy ogniu — szara
  steamTint: [4.3, 4.9, 5.9], sootTint: [1.5, 1.45, 1.4], sootFire: 0.3, sootSmolder: 0.15,
  // para i lód (cząstki)
  steamRate: 46,                // kłęby / s przy strumieniu 1 i promieniu 100 j.
  // wspólny budżet cząstek wszystkich wyrw [/s] (finał: ~30 wyrw naraz — biała para zalewała kadr): wyrwy dzielą go
  // proporcjonalnie do swoich potrzeb
  steamBudget: 300, flameBudget: 220, emberBudget: 160,
  steamAlpha: 0.32,
  // kłąb rośnie i rzednie jak gaz rozprężający się w próżni (gęstość kolumny ~ 1 / pole: (1 − u)^steamFade przy rozroście
  // u^steamGrow), najwyżej steamSizeMax [j.]; przy wyrwie z domeną gazu cząstek pary × steamWithGas (gaz niesie obłok)
  steamFade: 2.6, steamGrow: 0.8, steamSizeMax: 480, steamWithGas: 0.35, birthSizeMax: 900,
  rimGlow: 0.12,                // poświata rozgrzanego brzegu wyrwy (żar) — alfa przy żarzeniu 1
  steamColor0: [0.74, 0.78, 0.85], steamColor1: [0.4, 0.44, 0.5],
  lenK: 3.5, lenFlowK: 8, lenMax: 2200,   // długość strumienia: promień × (lenK + lenFlowK · √strumień), najwyżej lenMax
  spread: 0.62,                 // półkąt stożka wylotu [rad] (w próżni strumień szeroko się rozchyla)
  glintRate: 26,
  coreGain: 0.55,
  // ogień i żarzenie
  flameRate: 42, flameAlpha: 0.5,
  emberRate: 22, smokeRate: 6, smokeAlpha: 0.32,
  // rozszczelnienie
  burstDebris: 22, sparkRate: 32, flashGain: 1,
  maxEmitPerFrame: 160          // najwięcej nowych cząstek jednej wyrwy w klatce
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();


const _carrier = { vx: 0, vy: 0, t0: 0, z: 0, clock: 0 };
const _col = [0, 0, 0];
const SPARK_COOL = [3.4, 3.9, 4.6];
const SPARK_WARM = [4.2, 2.6, 1.2];
const DEBRIS_RGB = [[0.42, 0.4, 0.38], [0.3, 0.29, 0.27], [0.55, 0.5, 0.42]];

// Systemy jednej warstwy (tło albo FG): para/dym (zwykłe mieszanie), poświata (addytywnie), ogień (addytywnie, faktura
// kłębu), rdzeń strumienia (kwady wzdłuż osi).
function makeLayerSystems(scene, layer, tex, graphs, name) {
  const steam = new BillboardSystem(scene, tex.smoke, THREE.NormalBlending, 3000, 85, `${name}:para`);
  const flame = new BillboardSystem(scene, tex.smoke, THREE.AdditiveBlending, 1400, 87, `${name}:ogień`);
  const glow = new BillboardSystem(scene, tex.glow, THREE.AdditiveBlending, 2600, 88, `${name}:poświata`);
  const core = new OrientedQuadSystem(scene, tex.plume, 256, graphs.plume, 89, 2.0, 0.1, `${name}:rdzeń`);
  const list = [steam, flame, glow, core];
  for (const s of list) {
    s.mesh.layers.set(layer);
    s.mesh.name = `${name}:${s.mat.name}`;
    // test głębi z bryłami passa (głowa wieży, dysk zasłaniają strumień za sobą); zapis — nie
    s.mat.depthTest = true;
    s.mat.depthWrite = false;
  }
  return { steam, flame, glow, core, list };
}

class VentState {
  constructor(id) {
    this.id = id;
    this.seen = 0;
    this.born = false;
    this.accSteam = 0; this.accGlint = 0; this.accFlame = 0; this.accEmber = 0; this.accSmoke = 0; this.accSpark = 0;
    this.accDebris = 0; this.accZap = 0;
    this.lastFire = 0;
    this.slot = -1; this.slotBorn = -1; this.em = null; this.deep = false;
    this.flick = fxRandom.next() * 100;
  }
}

export class PirateBaseVents3D {
  /**
   * @param {object} core Core3D (scena, fx — światła, warmup)
   * @param {object} [o]
   * @param {() => object|null} [o.explosions] reżyser wybuchów (ExplosionFx: grid, director, deepDomain?) albo null
   */
  constructor(core, { explosions = null } = {}) {
    this.core = core;
    this.look = VENT_LOOK;
    this.getExplosions = typeof explosions === 'function' ? explosions : () => explosions;
    this.states = new Map();
    this.frameNo = 0;
    this.ready = false;
    // budżet emisji (potrzeby wszystkich wyrw z poprzedniej klatki → mnożnik tej)
    this._steamWant = 0; this._flameWant = 0; this._emberWant = 0;
    this._steamK = 1; this._flameK = 1; this._emberK = 1;
    this.layers = null;
    this.stats = { vents: 0, gas: 0, deepGas: 0, noSlot: 0, particles: 0, lights: 0, cpuMs: 0, cpuAvg: 0, cpuMax: 0 };
    this._ensure();
    if (core.warmup && typeof core.warmup.add === 'function') {
      core.warmup.add({ name: 'wyrwy bazy piratów (para, ogień, żar)', objects: () => (this._ensure() ? this.meshes() : null), phase: 'loading', variant: WARIANT_INSTANCJI });
    }
  }

  _ensure() {
    if (this.ready) return true;
    const core = this.core;
    if (!core?.scene || !Fx3D.ensure()) return false;
    const tex = {
      smoke: Fx3D.smoke.mat.uniforms.map.value,
      glow: Fx3D.glow.mat.uniforms.map.value,
      plume: Fx3D.plume.mat.uniforms.map.value
    };
    const graphs = fxQuadGraphs();
    this.layers = {
      bg: makeLayerSystems(core.scene, LAYER_BG, tex, graphs, 'WyrwyTło'),
      fg: makeLayerSystems(core.scene, LAYER_FG, tex, graphs, 'WyrwyFG')
    };
    this.ready = true;
    return true;
  }

  meshes() {
    if (!this.layers) return [];
    return [...this.layers.bg.list, ...this.layers.fg.list].map((s) => s.mesh);
  }

  /**
   * Klatka (render(): po updateHexShips3D — bank Fx3D ma już początek układu tej klatki). frame — stan klatki wyrw
   * ({ has, n, time, dt, rec } — gra wprost albo lustro bloku migawki), dt — krok klatki obrazu [s] (0 w pauzie).
   */
  update(frame, dt) {
    if (!this.look.enabled || !this._ensure()) return;
    const t0 = performance.now();
    this._update(frame, dt);
    // czas CPU obrazu wyrw (klatka, średnia wykładnicza, szczyt) — narzędzia
    const ms = performance.now() - t0, S = this.stats;
    S.cpuMs = ms; S.cpuAvg += (ms - S.cpuAvg) * 0.05; if (ms > S.cpuMax) S.cpuMax = ms;
  }

  _update(frame, dt) {
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    this.frameNo++;
    const f = this.frameNo;
    const L = this.look;
    let n = 0;
    // mnożniki budżetu z potrzeb poprzedniej klatki (bez skoku: wygładzone)
    const kS = this._steamWant > L.steamBudget ? L.steamBudget / this._steamWant : 1;
    const kF = this._flameWant > L.flameBudget ? L.flameBudget / this._flameWant : 1;
    const kE = this._emberWant > L.emberBudget ? L.emberBudget / this._emberWant : 1;
    if (step > 0) { this._steamK += (kS - this._steamK) * 0.3; this._flameK += (kF - this._flameK) * 0.3; this._emberK += (kE - this._emberK) * 0.3; }
    this._steamWant = 0; this._flameWant = 0; this._emberWant = 0;
    if (frame && frame.has && frame.n > 0) {
      const R = VENT_REC, S = R.STRIDE, rec = frame.rec;
      for (let i = 0; i < frame.n; i++) {
        const o = i * S;
        const id = rec[o + R.ID];
        let st = this.states.get(id);
        if (!st) { st = new VentState(id); this.states.set(id, st); }
        st.seen = f;
        if (step > 0 || !st.born) this._vent(st, rec, o, step);
        n++;
      }
    }
    // wyrwy, których nie ma w klatce — koniec (gaz domeny gaśnie sam)
    for (const [id, st] of this.states) {
      if (st.seen === f) continue;
      this._stopGas(st);
      this.states.delete(id);
    }
    this.stats.vents = n;
    // systemy cząstek: ruch i wysyłka (po wszystkich wyrwach)
    let parts = 0;
    for (const lay of [this.layers.bg, this.layers.fg]) {
      for (const s of lay.list) { s.update(step); parts += s.p.count; }
    }
    this.stats.particles = parts;
    if (!L.particles) for (const lay of [this.layers.bg, this.layers.fg]) for (const s of lay.list) s.reset();
  }

  // Systemy warstwy dla punktu sceny (z ≥ 0 — FG, pod płaszczyzną — tło).
  _lay(z) { return z >= 0 ? this.layers.fg : this.layers.bg; }

  _vent(st, rec, o, dt) {
    const R = VENT_REC;
    const L = this.look;
    const x = rec[o + R.X], y = rec[o + R.Y], z = rec[o + R.Z];
    let nx = rec[o + R.NX], ny = rec[o + R.NY], nz = rec[o + R.NZ];
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const r = Math.max(4, rec[o + R.R]);
    const flow = Math.max(0, rec[o + R.FLOW]);
    const speedK = clamp(rec[o + R.SPEED], 0.4, 1.8);
    const fire = sat(rec[o + R.FIRE]);
    const smolder = sat(rec[o + R.SMOLDER]);
    const ice = sat(rec[o + R.ICE]);
    const age = rec[o + R.AGE];
    const burst = sat(rec[o + R.BURST]);
    const spark = sat(rec[o + R.SPARK]);
    const main = rec[o + R.MAIN] === 1;
    const kind = rec[o + R.KIND] | 0;
    const host = rec[o + R.HOST];
    const cvx = rec[o + R.VX], cvy = rec[o + R.VY], cvz = rec[o + R.VZ];
    // nośnik cząstek: prędkość punktu ciała (spadająca wieża — para leci z nią i swoim pędem)
    _carrier.vx = cvx; _carrier.vy = cvy; _carrier.z = z; _carrier.t0 = Number(SimClock.sim) || 0; _carrier.clock = 0;
    const sq = Math.sqrt(flow);
    const len = clamp(r * (L.lenK + L.lenFlowK * sq), 40, L.lenMax);
    // scena: (x, −y, z); kierunek wylotu
    _dir.set(nx, -ny, nz);
    const X = x, Y = -y;
    const nearPlane = Math.abs(z) < PLANE_BAND;
    const sizeK = clamp(r / 100, 0.3, 3.5);
    Fx3D.setCarrier(_carrier);
    try {
      if (!st.born) {
        st.born = true;
        // pierwsze chwile (wyrwa świeża; obraz, który zobaczył ją później — mniejszy wybuch)
        const fresh = sat(1 - age / 0.6);
        if (fresh > 0) this._birth(X, Y, z, r, burst * fresh, main, kind, nearPlane, cvx, cvy, cvz);
      }
      if (!(dt > 0)) return;
      // gaz (duża wyrwa głównej objętości na ekranie)
      if (L.gas) this._gas(st, x, y, z, nx, ny, nz, r, flow, fire, smolder, main, host, cvx, cvy, cvz, len, speedK, dt);
      if (!L.particles) return;
      makeBasis(_dir);
      const lay = this._lay(z);
      const k = L.maxEmitPerFrame;
      // --- para i lód (strumień)
      if (flow > 0.01) {
        const want = L.steamRate * (0.15 + flow) * Math.sqrt(sizeK) * (st.slot >= 0 ? L.steamWithGas : 1);
        this._steamWant += want;
        st.accSteam += want * this._steamK * dt;
        let ns = Math.min(k, Math.floor(st.accSteam));
        st.accSteam -= ns;
        // w próżni para leci swoim pędem i rzednie (mały opór — nie wisi przy wyrwie)
        const life0 = clamp(0.4 + r / 450, 0.4, 1.2);
        const U = len * 1.2 * speedK;
        for (let i = 0; i < ns; i++) {
          coneDir(_d, _dir, L.spread * (0.55 + 0.45 * fxRandom.next()), 1);
          const vv = U * (0.45 + 0.75 * fxRandom.next());
          const s = sp();
          const a = fxRandom.next() * r * 0.5;
          s.x = X + _dir.x * a; s.y = Y + _dir.y * a; s.z = z + _dir.z * a;
          s.vx = _d.x * vv; s.vy = _d.y * vv; s.vz = _d.z * vv;
          s.life = life0 * (0.75 + 0.5 * fxRandom.next());
          s.drag = 0.5;
          s.s0 = r * (0.45 + 0.3 * fxRandom.next());
          s.s1 = Math.min(r * (1.3 + 0.8 * fxRandom.next()) + len * 0.16, L.steamSizeMax);
          s.rot = fxRandom.next() * 6.283; s.vrot = (fxRandom.next() - 0.5) * 1.2;
          const c0 = L.steamColor0, c1 = L.steamColor1;
          const w = 0.75 + 0.25 * ice;
          s.r0 = c0[0] * w; s.g0 = c0[1] * w; s.b0 = c0[2] * w;
          s.r1 = c1[0]; s.g1 = c1[1]; s.b1 = c1[2]; s.mix = 1.4;
          s.alpha = L.steamAlpha * (0.25 + 0.75 * Math.min(1, flow * 1.3)) * (0.35 + 0.65 * ice);
          s.fadeIn = 0.03; s.fadeOut = L.steamFade; s.grow = L.steamGrow;
          this._lay(s.z).steam.spawn(s);
        }
        // rdzeń strumienia (jęzor wzdłuż normalnej — krótki, co klatkę)
        const g = L.coreGain * sq * (0.6 + 0.4 * ice);
        _pos.set(X + _dir.x * r * 0.3, Y + _dir.y * r * 0.3, z + _dir.z * r * 0.3);
        _col[0] = 0.62 * g; _col[1] = 0.72 * g; _col[2] = 0.9 * g;
        lay.core.spawn(_pos, _dir, 0.09, len * 0.32, len * 0.42, r * 0.7, r * 1.25, _col, 0.85);
        // kryształki lodu
        st.accGlint += L.glintRate * flow * Math.sqrt(sizeK) * ice * this._steamK * dt;
        let ng = Math.min(k, Math.floor(st.accGlint));
        st.accGlint -= ng;
        for (let i = 0; i < ng; i++) {
          coneDir(_d, _dir, L.spread * 0.8, 1);
          const vv = U * (0.8 + 0.5 * fxRandom.next());
          const s = sp();
          s.x = X; s.y = Y; s.z = z + 0.5;
          s.vx = _d.x * vv; s.vy = _d.y * vv; s.vz = _d.z * vv;
          s.life = 0.25 + 0.35 * fxRandom.next(); s.drag = 0.7;
          s.s0 = Math.max(3, r * 0.05); s.s1 = Math.max(1.5, r * 0.025);
          s.r0 = 2.1; s.g0 = 2.4; s.b0 = 2.9; s.r1 = 0.4; s.g1 = 0.5; s.b1 = 0.7; s.mix = 5;
          s.alpha = 0.9; s.fadeIn = 0.01; s.fadeOut = 1.5; s.grow = 1;
          this._lay(s.z).glow.spawn(s);
        }
        // szczątki wyrywane strumieniem (główna objętość, przy płaszczyźnie gry)
        if (L.debris && main && nearPlane && flow > 0.25) {
          st.accDebris += 2.5 * flow * (0.3 + burst) * sizeK * dt;
          while (st.accDebris >= 1) { st.accDebris -= 1; this._debris(X, Y, z, r, U * 0.5, cvx, cvy, cvz, false); }
        }
      }
      // --- ogień w wylatującym tlenie
      if (fire > 0.01) {
        const wantF = L.flameRate * fire * Math.sqrt(sizeK) * (0.3 + Math.min(1, flow * 2));
        this._flameWant += wantF;
        st.accFlame += wantF * this._flameK * dt;
        let nf = Math.min(k, Math.floor(st.accFlame));
        st.accFlame -= nf;
        const U = len * 0.7 * speedK;
        for (let i = 0; i < nf; i++) {
          coneDir(_d, _dir, L.spread * 0.7, 1);
          const vv = U * (0.35 + 0.55 * fxRandom.next());
          const s = sp();
          const a = fxRandom.next() * r * 0.6;
          s.x = X + _dir.x * a; s.y = Y + _dir.y * a; s.z = z + _dir.z * a;
          s.vx = _d.x * vv; s.vy = _d.y * vv; s.vz = _d.z * vv;
          s.life = 0.22 + 0.25 * fxRandom.next(); s.drag = 2.6;
          s.s0 = r * (0.4 + 0.3 * fxRandom.next()); s.s1 = r * (1.4 + 0.8 * fxRandom.next());
          s.rot = fxRandom.next() * 6.283; s.vrot = (fxRandom.next() - 0.5) * 3;
          s.r0 = 3.0; s.g0 = 1.55; s.b0 = 0.5; s.r1 = 0.9; s.g1 = 0.22; s.b1 = 0.04; s.mix = 6;
          s.alpha = L.flameAlpha * (0.4 + 0.6 * fire); s.fadeIn = 0.02; s.fadeOut = 1.2; s.grow = 0.45;
          this._lay(s.z).flame.spawn(s);
        }
        // jęzor ognia przy otworze
        const g = (0.7 + 0.6 * fxRandom.next()) * fire;
        _pos.set(X, Y, z);
        _col[0] = 1.7 * g; _col[1] = 0.72 * g; _col[2] = 0.2 * g;
        lay.core.spawn(_pos, _dir, 0.08, r * (1.2 + 3.2 * fire * Math.min(1, sq * 1.5)), r * (1.6 + 3.6 * fire), r * 0.6, r * 1.1, _col, 0.9);
      }
      // --- żarzenie: żar na brzegu otworu, poświata, ciemny dym
      if (smolder > 0.02) {
        const wantE = L.emberRate * smolder * Math.sqrt(sizeK);
        this._emberWant += wantE;
        st.accEmber += wantE * this._emberK * dt;
        let ne = Math.min(k, Math.floor(st.accEmber));
        st.accEmber -= ne;
        if (ne > 0) perpBasis(_dir);
        for (let i = 0; i < ne; i++) {
          const ph = fxRandom.next() * 6.283, rr = r * (0.55 + 0.6 * fxRandom.next());
          // punkt na brzegu otworu (płaszczyzna prostopadła do normalnej)
          const cu = Math.cos(ph) * rr, cw = Math.sin(ph) * rr;
          const s = sp();
          s.x = X + _dir.x * r * 0.05 + cu * _ux + cw * _wx;
          s.y = Y + _dir.y * r * 0.05 + cu * _uy + cw * _wy;
          s.z = z + _dir.z * r * 0.05 + cu * _uz + cw * _wz;
          const vv = 12 + 30 * fxRandom.next();
          s.vx = _dir.x * vv + (fxRandom.next() - 0.5) * 20; s.vy = _dir.y * vv + (fxRandom.next() - 0.5) * 20; s.vz = _dir.z * vv;
          s.life = 0.6 + 0.7 * fxRandom.next(); s.drag = 0.8;
          s.s0 = Math.max(4, r * (0.05 + 0.05 * fxRandom.next())); s.s1 = s.s0 * 0.5;
          s.r0 = 2.6; s.g0 = 0.95; s.b0 = 0.25; s.r1 = 0.6; s.g1 = 0.12; s.b1 = 0.02; s.mix = 1.8;
          s.alpha = 0.6 + 0.4 * smolder; s.fadeIn = 0.05; s.fadeOut = 1.3; s.grow = 1;
          this._lay(s.z).glow.spawn(s);
        }
        // poświata rozgrzanego brzegu (co klatkę, krótka; mała — z kamery 3D duże tarcze wisiały jak kule światła)
        if (smolder > 0.08 && L.rimGlow > 0) {
          const s = sp();
          s.x = X; s.y = Y; s.z = z;
          s.life = 0.12; s.drag = 0;
          s.s0 = s.s1 = r * 1.25;
          s.r0 = s.r1 = 0.95; s.g0 = s.g1 = 0.32; s.b0 = s.b1 = 0.07;
          s.alpha = L.rimGlow * smolder * (0.85 + 0.3 * Math.sin(st.flick + age * 5.3)); s.fadeIn = 0.02; s.fadeOut = 1; s.grow = 1;
          lay.glow.spawn(s);
        }
        st.accSmoke += L.smokeRate * smolder * Math.sqrt(sizeK) * this._emberK * dt;
        let nk = Math.min(k, Math.floor(st.accSmoke));
        st.accSmoke -= nk;
        for (let i = 0; i < nk; i++) {
          coneDir(_d, _dir, 0.6, 1);
          const vv = 40 + 70 * fxRandom.next();
          const q = sp();
          q.x = X + _dir.x * r * 0.4; q.y = Y + _dir.y * r * 0.4; q.z = z + _dir.z * r * 0.4;
          q.vx = _d.x * vv; q.vy = _d.y * vv; q.vz = _d.z * vv;
          q.life = 2.4 + 1.6 * fxRandom.next(); q.drag = 0.45;
          q.s0 = r * (0.6 + 0.3 * fxRandom.next()); q.s1 = r * (2.4 + fxRandom.next());
          q.rot = fxRandom.next() * 6.283; q.vrot = (fxRandom.next() - 0.5) * 0.6;
          q.r0 = 0.15; q.g0 = 0.135; q.b0 = 0.12; q.r1 = 0.09; q.g1 = 0.085; q.b1 = 0.08; q.mix = 0.8;
          q.alpha = L.smokeAlpha * smolder; q.fadeIn = 0.15; q.fadeOut = 1.4; q.grow = 0.55;
          this._lay(q.z).steam.spawn(q);
        }
      }
      // --- zwarcia: iskry i błyski przepięć
      if (spark > 0.02) {
        if (L.sparks && nearPlane && Fx3D.spark) {
          st.accSpark += L.sparkRate * spark * dt;
          let nk = Math.min(40, Math.floor(st.accSpark));
          st.accSpark -= nk;
          for (let i = 0; i < nk; i++) {
            coneDir(_d, _dir, 1.1, 1);
            const vv = 220 + 520 * fxRandom.next();
            _v.set(_d.x * vv, _d.y * vv, _d.z * vv);
            _pos.set(X, Y, z + 1);
            Fx3D.spark.spawn(_pos, _v, 0.18 + 0.4 * fxRandom.next(), 1.6, 3 + 8 * fxRandom.next(), fire > 0.2 ? SPARK_WARM : SPARK_COOL, 0.45, 0.12);
          }
        }
        st.accZap += 5 * spark * dt;
        if (st.accZap >= 1 && L.lights) {
          st.accZap -= 1;
          const lights = this.core.fx?.lights;
          if (lights) lights.flash(x + nx * r * 0.3, y + ny * r * 0.3, 0.6, 0.76, 1.0, 2.2 * spark * L.flashGain, r * 3 + 140, 0.07, 2, 0.6, z + 30);
        }
      }
      // --- światła: ogień (migocze), żar
      if (L.lights && (fire > 0.02 || smolder > 0.05)) {
        const lights = this.core.fx?.lights;
        if (lights) {
          const fl = 0.75 + 0.25 * Math.sin(st.flick + age * 17.3) * Math.sin(st.flick * 1.7 + age * 7.1);
          const p = (0.6 + 2.6 * fire) * fl * fire + 0.35 * smolder;
          if (lights.point(x + nx * r * 0.8, y + ny * r * 0.8, 1.0, 0.5 - 0.1 * (1 - fire), 0.18, p, r * (3 + 3 * fire) + 220, z + nz * r + 25)) this.stats.lights++;
        }
      }
      st.lastFire = fire;
    } finally {
      Fx3D.clearCarrier();
    }
  }

  // Rozszczelnienie: chłodny błysk w siatce świateł, kłąb pary, szczątki (przy płaszczyźnie gry), iskry zwarć.
  _birth(X, Y, z, r, burst, main, kind, nearPlane, cvx, cvy, cvz) {
    const L = this.look;
    const x = X, y = -Y;
    if (L.lights) {
      const lights = this.core.fx?.lights;
      if (lights) lights.flash(x, y, 0.72, 0.84, 1.0, (main ? 3.2 : 1.4) * (0.35 + burst) * L.flashGain, r * (main ? 7 : 4) + 160, main ? 0.45 : 0.18, 2, 0.25, z + 30);
    }
    if (!L.particles) return;
    makeBasis(_dir);
    const lay = this._lay(z);
    // błysk rozszczelnienia (rdzeń nad progiem bloomu, krótko) i rozprężający się kłąb
    let s = sp();
    s.x = X; s.y = Y; s.z = z;
    s.life = main ? 0.16 : 0.08; s.drag = 0;
    s.s0 = r * 0.5; s.s1 = r * (main ? 3 : 1.6);
    s.r0 = 5.5; s.g0 = 6.2; s.b0 = 7.4; s.r1 = 0.6; s.g1 = 0.8; s.b1 = 1.2; s.mix = 12;
    s.alpha = 0.6 + 0.4 * burst; s.fadeIn = 0.003; s.fadeOut = 2.2; s.grow = 0.35;
    lay.glow.spawn(s);
    const nPuff = Math.round((main ? 10 : 3) * (0.4 + burst));
    for (let i = 0; i < nPuff; i++) {
      coneDir(_d, _dir, 1.0, 1);
      const vv = r * (2 + 5 * fxRandom.next()) * (main ? 1.4 : 1);
      s = sp();
      s.x = X; s.y = Y; s.z = z;
      s.vx = _d.x * vv; s.vy = _d.y * vv; s.vz = _d.z * vv;
      s.life = (main ? 1.2 : 0.55) * (0.7 + 0.6 * fxRandom.next()); s.drag = 1.8;
      s.s0 = r * 0.6; s.s1 = Math.min(r * (main ? 3.2 : 2.0) * (0.8 + 0.4 * fxRandom.next()), L.birthSizeMax);
      s.rot = fxRandom.next() * 6.283; s.vrot = (fxRandom.next() - 0.5);
      s.r0 = 0.9; s.g0 = 0.93; s.b0 = 0.98; s.r1 = 0.5; s.g1 = 0.54; s.b1 = 0.6; s.mix = 1.2;
      s.alpha = 0.5 * (0.4 + 0.6 * burst); s.fadeIn = 0.01; s.fadeOut = L.steamFade; s.grow = 0.7;
      this._lay(s.z).steam.spawn(s);
    }
    // szczątki wyrwane strumieniem (pula odłamków kadłubów — przy płaszczyźnie gry)
    if (L.debris && nearPlane) {
      const nd = Math.round(main ? 4 + L.burstDebris * burst : 1 + 2 * burst);
      for (let i = 0; i < nd; i++) this._debris(X, Y, z, r, r * (3 + 6 * fxRandom.next()) * (main ? 1 : 0.6), cvx, cvy, cvz, fxRandom.next() < 0.35);
    }
    // iskry zwarć przy rozszczelnieniu (wnętrze z elektryką)
    if (L.sparks && nearPlane && Fx3D.spark && kind !== VENT_KIND.warehouse) {
      const nk = Math.round((main ? 18 : 5) * (0.4 + burst));
      for (let i = 0; i < nk; i++) {
        coneDir(_d, _dir, 0.9, 1);
        const vv = 260 + 700 * fxRandom.next();
        _v.set(_d.x * vv, _d.y * vv, _d.z * vv);
        _pos.set(X, Y, z + 1);
        Fx3D.spark.spawn(_pos, _v, 0.25 + 0.5 * fxRandom.next(), 1.2, 4 + 9 * fxRandom.next(), SPARK_COOL, 0.4, 0.1);
      }
    }
  }

  // Odłamek wyrwany strumieniem: kierunek w stożku wylotu, prędkość własna + nośnik (scena → gra: y odbite).
  _debris(X, Y, z, r, speed, cvx, cvy, cvz, structural) {
    coneDir(_d, _dir, 0.7, 1);
    const c = DEBRIS_RGB[(fxRandom.next() * DEBRIS_RGB.length) | 0];
    const vx = _d.x * speed, vyScene = _d.y * speed, vz = _d.z * speed;
    HullDebris3D.spawn(X, -Y, vx + cvx, -vyScene + cvy, c[0], c[1], c[2], clamp(r * 0.11, 5, 36) * (0.6 + 0.8 * fxRandom.next()),
      structural, performance.now() * 0.001, z, vz + cvz);
  }

  // ------------------------------------------------------------------ gaz (domena wylotu)

  _fx() {
    const fx = this.getExplosions();
    return fx && fx.grid && fx.director ? fx : null;
  }

  _pxPerUnit(x, y) {
    const fx = this._fx();
    if (fx && typeof fx._pxPerUnit === 'function') return fx._pxPerUnit(x, y);
    return Math.max(1e-4, Number(this.core.activeCam1?.zoom) || 1);
  }

  _slotOk(st, fx) {
    if (st.slot < 0) return false;
    const s = fx.grid.slots[st.slot];
    if (!s || !s.active || s.tag !== VENT_TAG || s.born !== st.slotBorn) return false;
    const e = st.em;
    return !!(e && e.alive && e.slot === st.slot);
  }

  _stopGas(st) {
    const fx = this._fx();
    if (fx && this._slotOk(st, fx)) st.em.t1 = fx.director.time;   // emiter gaśnie; domena żyje do `until` + wygaszanie
    st.slot = -1; st.em = null; st.slotBorn = -1;
  }

  _gas(st, x, y, z, nx, ny, nz, r, flow, fire, smolder, main, host, cvx, cvy, cvz, len, speedK, dt) {
    const L = this.look;
    const fx = this._fx();
    if (!fx) return;
    const g = fx.grid;
    const active = main && r >= L.gasMinR && (flow > 0.06 || fire > 0.05);
    if (st.slot >= 0 && !this._slotOk(st, fx)) { st.slot = -1; st.em = null; }
    if (!active) { if (st.slot >= 0) this._stopGas(st); return; }
    const X = x, Y = -y;
    const deep = z < DEEP_Z;
    // domena: obłok mieści się w kole życia gazu (FIT_RR), źródło przy otworze
    const L0 = r * L.gasLenK;
    const D = clamp(L0 * L.gasDomainK, L.gasDomainMin, L.gasDomainMax);
    if (st.slot >= 0) {
      // źródło wyjechało z domeny (spadająca bryła) — domena zostaje (gaśnie), nowa przy źródle
      const s = g.slots[st.slot];
      const half = s.h * s.n * 0.5;
      const dx = X - s.cx, dy = Y - s.cy;
      if (Math.sqrt(dx * dx + dy * dy) > FIT_RR * half - 2 * s.h || Math.abs(z - s.cz) > s.h * s.nz * 0.35 || st.deep !== deep) this._stopGas(st);
    }
    if (st.slot < 0) {
      if (deep) {
        // pod płaszczyzną (pass tła, perspektywa): skala z rzutu reżysera na głębokości wyrwy; kadr sprawdza deepDomain
        const ppu = typeof fx._pxPerUnitZ === 'function' ? fx._pxPerUnitZ(x, y, z) : this._pxPerUnit(x, y);
        if (r * ppu < L.gasMinPx) return;
      } else {
        const view = this.core.fx?.view || null;
        const inView = !view || !(view.x1 > view.x0) || !(x + D * 0.5 < view.x0 || x - D * 0.5 > view.x1 || y + D * 0.5 < view.y0 || y - D * 0.5 > view.y1);
        if (!inView || r * this._pxPerUnit(x, y) < L.gasMinPx) return;
      }
      if (!this._acquire(st, fx, x, y, z, nx, ny, nz, r, L0, D, host, cvx, cvy, cvz, deep)) return;
    }
    const s = g.slots[st.slot];
    // domena jedzie z punktem ciała (spadająca bryła przyspiesza; gaz w próżni spada razem z nią — ta sama grawitacja,
    // więc obłok zostaje przy wyrwie; scena: y odbite)
    s.vx = cvx; s.vy = -cvy; s.vz = cvz;
    // życie domeny: zasilana, póki wyrwa wieje albo płonie
    g.feed(st.slot, g.time + L.gasLinger);
    // barwa dymu domeny: biała para → sadza przy pożarze i żarzeniu
    const soot = sat(fire * L.sootFire + smolder * L.sootSmolder);
    const T0 = L.steamTint, T1 = L.sootTint;
    s.tint[0] = T0[0] + (T1[0] - T0[0]) * soot;
    s.tint[1] = T0[1] + (T1[1] - T0[1]) * soot;
    s.tint[2] = T0[2] + (T1[2] - T0[2]) * soot;
    // emiter: przy otworze (na zewnątrz), wzdłuż normalnej; tempa z bieżącego strumienia i ognia
    const e = st.em;
    const off = r * 0.7;
    e.x = X + nx * off; e.y = Y - ny * off; e.z = z + nz * off;
    e.px = e.x; e.py = e.y; e.pz = e.z;
    const jl = r * 1.6;
    e.jx = nx * jl; e.jy = -ny * jl; e.jz = nz * jl;
    let U = L0 * L.gasSpeed * speedK * (0.35 + 0.65 * Math.sqrt(flow));
    // droga od dyszy do brzegu elipsoidy domeny wzdłuż wylotu (scena) — prędkość dopasowana (najmniej 0,12 U: „pyknięcie”)
    const avail = fitAlong(s, e.x, e.y, e.z, nx, -ny, nz, 0.9);
    if (avail > 0) U = Math.max(0.12 * U, Math.min(U, (L.gasFitK * avail - jl) / L.gasCoast));
    e.dvx = nx * U; e.dvy = -ny * U; e.dvz = nz * U;
    e.radial = U * 0.22;
    e.r0 = Math.max(r * 0.8, 3.2 * s.h); e.r1 = e.r0 * 1.7;
    e.smoke = L.gasSmoke * Math.min(1.3, flow) + 2.5 * smolder;
    e.fuel = L.gasFuel * fire * Math.min(1, flow * 3);
    e.temp = L.gasTemp + L.gasFireTemp * fire;
    e.t1 = fx.director.time + 0.5;
    this.stats.gas++;
  }

  _acquire(st, fx, x, y, z, nx, ny, nz, r, L0, D, host, cvx, cvy, cvz, deep) {
    const L = this.look;
    const g = fx.grid;
    // sufit: domeny z ŻYWYM emiterem wyrwy (domena po zgaszeniu emitera gaśnie sama — nie blokuje nowej przy źródle,
    // które z niej wyjechało; wybuchy chroni zapas wolnych domen)
    let mine = 0, free = 0;
    for (const o of this.states.values()) if (o.slot >= 0) mine++;
    for (let i = 0; i < g.S; i++) if (!g.slots[i].active) free++;
    const reserve = Number(fx.tune?.muzzleReserve ?? L.gasReserve);
    if (mine >= L.gasDomains || free <= reserve) { this.stats.noSlot++; return false; }
    // środek domeny: przed otworem (obłok mieści się w kole życia gazu); płaska domena (wysokość 0,375 boku) — w pionie
    // źródło w dolnej (wylot w górę) / górnej (w dół) części pudła: środek o nz × min(ahead, 0,103 boku) dalej
    const ahead = Math.min(L0 * 0.42, FIT_RR * D * 0.5 - r * 2);
    const cx = x + nx * ahead, cy = y + ny * ahead;
    const cz = z + nz * Math.min(ahead, 0.103 * D);
    let slot = -1;
    if (deep) {
      // domena GŁĘBOKA (pass tła z perspektywą — reżyser wybuchów, ExplosionFx.deepDomain; świat gry): skała pod bazą
      // jako kula-przeszkoda (para z wyrwy leżącej na skale rozlewa się po niej), bez statyki i kadłubów
      if (typeof fx.deepDomain !== 'function') { this.stats.noSlot++; return false; }
      const rs = pirateRockSite();
      const ground = rs && rs.at && rs.rock?.layout?.center ? this._ground(rs) : null;
      slot = fx.deepDomain(cx, cy, cz, D / 5.4, {
        carrier: [cvx, cvy, cvz], life: L.gasLinger, fadeTime: L.gasFade, baseDecay: L.gasDecay, tint: L.steamTint, fire: 0,
        tag: VENT_TAG, priority: 0, domainScale: 5.4, reserve: L.gasReserve, ground, ambient: L.gasAmbient
      });
      if (slot >= 0) this.stats.deepGas++;
    } else {
      if (typeof fx._freeIn === 'function' && fx._freeIn(0) < 0) { this.stats.noSlot++; return false; }
      // nad płaszczyzną (głowa wieży, szczyt szybu) statyka bazy — pryzmaty przez całą wysokość domeny — blokowałaby
      // strumień: domena bez rastra statyki (GasSlot.noStatics)
      const A = {
        size: D, life: L.gasLinger, carrier: [cvx, -cvy, cvz], tint: L.steamTint, now: g.time, reuse: false, tag: VENT_TAG,
        priority: 0, host, fire: 0, fadeTime: L.gasFade, baseDecay: L.gasDecay, tier: 0, k: 1, noStatics: z > 260, noHulls: false,
        ambient: L.gasAmbient
      };
      slot = g.acquire(cx, -cy, cz, r, A);
    }
    if (slot < 0) { this.stats.noSlot++; return false; }
    const s = g.slots[slot];
    s.rx = x; s.ry = -y;
    st.slot = slot;
    st.slotBorn = s.born;
    st.deep = deep;
    const d = fx.director;
    const X = x, Y = -y;
    d.setOrigin(X + nx * r * 1.4, Y - ny * r * 1.4);
    const jo = { delay: 0, fuel: 0, temp: 0.2, smoke: 0, radial: 0, velBlend: 32, noise: 0.42, tau: 0, flicker: 0.22, grow: 1.7,
      rampIn: 0.04, rampOut: 0.25, velTau: 0 };
    st.em = d.jet(slot, X + nx * r * 0.7, Y - ny * r * 0.7, z + nz * r * 0.7, nx, -ny, nz, r, r * 1.6, L0, 1e6, jo);
    d.clearOrigin();
    if (!st.em) { st.slot = -1; return false; }
    return true;
  }

  // Skała pod bazą (planetoida — kula-przeszkoda domen głębokich): środek w świecie gry (x, y w dół, z), promień.
  _ground(rs) {
    const g = this._groundObj || (this._groundObj = { x: 0, y: 0, z: 0, r: 0 });
    g.x = rs.at.x; g.y = rs.at.y; g.z = rs.rock.layout.center[1]; g.r = Number(rs.rock.layout.R) || PIRATE_ROCK_SPEC.radius;
    return g;
  }

  clear() {
    for (const st of this.states.values()) this._stopGas(st);
    this.states.clear();
    if (this.layers) for (const lay of [this.layers.bg, this.layers.fg]) for (const s of lay.list) s.reset();
  }
}

// Droga od punktu (X, Y, Z sceny) wzdłuż kierunku jednostkowego (dx, dy, dz) do elipsoidy wpisanej w pudło domeny,
// ściśniętej do f (obraz i symulacja gaszą gaz za ~0,9 — wzór RockImpactFx._fitAlong); punkt poza nią — 0.
function fitAlong(s, X, Y, Z, dx, dy, dz, f) {
  const ax = s.h * s.n * 0.5, az = s.h * s.nz * 0.5;
  if (!(ax > 0) || !(az > 0)) return 0;
  const ux = (X - s.cx) / ax, uy = (Y - s.cy) / ax, uz = (Z - s.cz) / az;
  const vx = dx / ax, vy = dy / ax, vz = dz / az;
  const a = vx * vx + vy * vy + vz * vz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = ux * ux + uy * uy + uz * uz - f * f;
  if (!(a > 0) || c >= 0) return 0;
  return (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a;
}

// Baza prostopadła do normalnej otworu (punkt na brzegu wyrwy — żar): u ⟂ d (oś pomocnicza +Z albo +X), w = d × u.
let _ux = 1, _uy = 0, _uz = 0, _wx = 0, _wy = 1, _wz = 0;
function perpBasis(d) {
  let ax = 0, ay = 0, az = 1;
  if (Math.abs(d.z) > 0.9) { ax = 1; az = 0; }
  _ux = ay * d.z - az * d.y; _uy = az * d.x - ax * d.z; _uz = ax * d.y - ay * d.x;
  const l = Math.sqrt(_ux * _ux + _uy * _uy + _uz * _uz) || 1;
  _ux /= l; _uy /= l; _uz /= l;
  _wx = d.y * _uz - d.z * _uy; _wy = d.z * _ux - d.x * _uz; _wz = d.x * _uy - d.y * _ux;
}

/** Obraz wyrw w Core3D (wymaga Core3D.init — scena). explosions — () → reżyser wybuchów (ExplosionFx) albo null. */
export function createPirateBaseVents3D(core, opts = {}) {
  if (!core?.scene) return null;
  const v = new PirateBaseVents3D(core, opts);
  if (typeof window !== 'undefined') { window.PirateVentLook = VENT_LOOK; window.__pirateVents3D = v; }
  return v;
}
