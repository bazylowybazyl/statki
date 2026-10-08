// src/3d/gasField/hallDust.js
//
// PYŁ W HALACH K-7 — strona RENDERU (etap 1 gazów w grze, wymagania użytkownika 2026-10-07): okręt odpala
// silnik, strumień podrywa kurz z pokładu, pył uderza w ścianę hali i rozlewa się wzdłuż niej.
//
// Szew gra ↔ render (uzgodniony z sesją „Rendering w workerze” 2026-10-07): gra co klatkę pakuje WEJŚCIE
// (src/game/hallDustInput.js → Float64Array o układzie HALL_DUST_IN: hala przy kamerze, przekształcenie
// hala → świat w double, okręty w domenie, dt czasu gry) i oddaje je `HallDust.submit(tablica)`. Ten moduł
// czyta TYLKO tę tablicę i dysze MAIN tej klatki z EngineFrame (pisze je EngineVfxSystem w
// updateHexShips3D, przed Core3D.render) — bez window.*, DOM i referencji do encji; czas = dt z wejścia
// (pauza = 0). Przeniesienie renderu do workera = przekazanie tablicy.
//
// Wpięcie w Core3D: krok efektów `Core3D.addFxStep` (symulacja — gasField2D.js, kernele w jednym
// renderer.compute), siatki w passie ortho (gasFieldLayer.js), rozgrzewka przez `Core3D.warmup` (siatki
// warstw na ekranie ładowania, kernele pustymi dispatchami w `warm` kroku). Jedna symulacja na grę: hala
// przy kamerze (wszystkie hale K-7 mają ten sam układ — rastr liczony raz, zmiana hali = czyszczenie stanu).
//
// Gaz ma źródła (2026-10-07, hallGasSources.js): przewody paliwowe stanowisk (sączenie, upust i zerwanie przy
// odcumowaniu — pozy obsługi z bloku `service` wejścia), szpule na piedestałach i zawory magazynów (harmonogram,
// koguty w tej samej fazie), wentylacja. Hala jest OŚWIETLONA (haloPortK7Lights.js): krok `lights` dokłada do
// siatki świateł gry lampy, reflektory i migające soczewki hali — oświetlają pył, parę i kadłuby.

import { Core3D } from '../core3d.js';
import { EngineFrame } from '../engineFrame.js';
import { fxNoise } from '../fx/noise.js';
import { createK7Layout, k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { K7_BEACON, K7_BEACON_GRID, K7_BEACON_LOOK, k7BeaconLevel, k7LightRig } from '../haloRing/haloPortK7Lights.js';
import {
  HALL_DUST_IN, HALL_DUST_MASK, HALL_DUST_SERVICE, HALL_DUST_SHIP, hallBodyUniforms, hallDustDomain, hallDomainDistance,
  rasterizeHallCells
} from './hallDustLayout.js';
import { GasField2D } from './gasField2D.js';
import { GasFieldLayer } from './gasFieldLayer.js';
import {
  HALL_GAS_EVENT, HALL_GAS_EVENT_STRIDE, HALL_GAS_MAX, HALL_GAS_TUNE, createHallGasSources, resetHallGasSources, writeHallGasSources
} from './hallGasSources.js';
import { SMOKE_KIND } from '../rockets/palette.js';
import { fxRandom } from '../fx/fxRandom.js';

/** Strojenie pyłu hal (na żywo: window.HallDustTune w trybie ?dev — ustawia gra). */
export const HALL_DUST_TUNE = {
  enabled: true,
  jetSpeed: 2600,       // prędkość gazu u nasady strumienia MAIN przy pełnym ciągu [j/s]
  jetLength: 2800,      // zasięg strumienia [j.] (× 0,6 + 0,4 · moc)
  jetWidth: 1.15,       // szerokość u nasady × (rozstaw dysz + promień dyszy)
  jetWiden: 0.16,       // rozszerzanie stożka [na jednostkę długości]
  jetRate: 7,           // tempo narzucania prędkości w stożku [1/s]
  minPower: 0.2,        // moc dysz, od której dmuchają (jałowe płomyki nie)
  zBack: -26,           // wysokość warstwy pod kadłubami (scena; kadłuby −10,4…−5,3, struga MAIN −5)
  zFront: 9,            // warstwa nad kadłubami (pod efektami z = 14–15)
  fadeView: [26000, 52000], // zanik obrazu przy oddaleniu: pół przekątnej kadru [j.]
  idleClear: 45,        // po tylu sekundach bez hali stan się zeruje (powrót = świeży kurz)
  sleepAfter: 25,       // po tylu sekundach czasu gry bez dysz i ruchu kadłubów symulacja przestaje liczyć
  movingSpeed: 30,      // kadłub szybszy niż to [j/s] rusza gaz (budzi symulację)
  gas: HALL_GAS_TUNE,   // źródła gazu hali (hallGasSources.js)
  // światła hali w siatce gry (pył, para, kadłuby): lampy × (lampBase + poziom lamp dzień / noc), reflektory,
  // soczewki migające (rodzaje i zasięgi — K7_BEACON_GRID)
  hallLights: true,
  lampGain: 1.1,
  lampBase: 0.4,
  lampScatter: 0.12,    // lampy dookólne prawie bez snopów (mgiełka szarzałaby całą halę) — snopy dają reflektory
  spotGain: 1.0,
  beaconGain: 1.0,
  // kłęby pary przy złączkach przewodów paliwowych (pula dymu rakiet — setVaporSmoke): buch dookoła złączki
  // przy odryglowaniu (duży) i ryglowaniu (mały), strumień z zaworu przedmuchu przy upuście
  puffs: true,
  puffRing: 22,         // kłębów w buchu odryglowania (ryglowanie: × 0,55)
  puffSpeed: [380, 760],
  puffSize: [7, 13],    // rozmiar startowy [j.]
  puffGrowth: [36, 64], // przyrost [j./√s]
  puffLife: [0.8, 1.7],
  puffOpacity: [0.4, 0.66],
  puffBloom: 8,         // wolnych, dużych kłębów, które zostają przy złączce
  ventRate: 34          // kłębów na sekundę przy pełnym upuście
};

const I = HALL_DUST_IN;
const SH = HALL_DUST_SHIP;
const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

class HallDustSystem {
  constructor() {
    this.input = new Float64Array(I.size);
    this.tune = HALL_DUST_TUNE;
    this.sim = null;
    this.layer = null;
    this.domain = null;
    this.step = null;
    this._hall = 0;
    this._serial = -1;
    this._idle = 1e9;
    this._quiet = 0;
    this._aff = { p0x: 0, p0y: 0, ax: 1, ay: 0, bx: 0, by: 1 };
    this.rig = null;
    this.gasSrc = null;
    this._beaconBerth = null;
    // pula dymu rakiet (SmokeSystem: s + push) — kłęby pary przy złączkach; host podaje ją setVaporSmoke
    this.smoke = null;
    this._ventAcc = new Float64Array(16);
    this.stats = {
      active: false, hall: 0, jets: 0, sources: 0, bodies: 0, substeps: 0, dispatches: 0, sleeping: false, cpuMs: 0,
      lights: 0, bursts: 0, venting: 0
    };
  }

  /** Budowa symulacji, warstw i kroku efektów (leniwie — po Core3D.init). */
  _ensure() {
    if (this.sim) return true;
    if (!Core3D.isInitialized || !Core3D.scene || !Core3D.fx) return false;
    const layout = createK7Layout();
    const dom = hallDustDomain(layout);
    const cells = rasterizeHallCells(layout, dom);
    this.domain = dom;
    this.rig = k7LightRig(layout);
    this.gasSrc = createHallGasSources(layout, this.rig);
    const capIds = layout.berths.filter((b) => b.size === 'CAPITAL').map((b) => b.id);
    this._beaconBerth = this.rig.beacons.map((b) => (b.berthId ? capIds.indexOf(b.berthId) : -1));
    this.sim = new GasField2D({
      nx: dom.nx, ny: dom.ny, h: dom.h, cellData: cells.data, noise3D: fxNoise.noise3D(),
      maskW: HALL_DUST_MASK.w, maskH: HALL_DUST_MASK.h
    });
    this._maskWords = new Float64Array(this.sim.maxBodies * HALL_DUST_MASK.words).fill(NaN);
    this.layer = new GasFieldLayer(this.sim, {
      domain: dom, detailTex: fxNoise.cloud2D(), grid: Core3D.fx.grid, layer: 0,
      renderOrderBack: 1, renderOrderFront: 26, name: 'HallDust'
    });
    Core3D.scene.add(this.layer.group);
    this.step = Core3D.addFxStep({
      name: 'pył hal K-7',
      lights: (ctx) => this._lights(ctx),
      update: (ctx) => this._update(ctx),
      // pipeline'y compute powstają synchronicznie — puste dispatche na ekranie ładowania
      warm: (ctx) => this.sim.warm(ctx.renderer)
    });
    return true;
  }

  /**
   * Pula dymu (src/3d/rockets/smoke.js — SmokeSystem: wpis roboczy `s` + `push()`, świat gry) na kłęby pary przewodów
   * paliwowych: buch dookoła złączki przy ryglowaniu i odryglowaniu, strumień z zaworu przedmuchu przy upuście.
   * Oświetla je siatka świateł (lampy, reflektory i soczewki hali). null — bez kłębów (zostaje para w polu gazu).
   */
  setVaporSmoke(smoke) {
    this.smoke = smoke && typeof smoke.push === 'function' && smoke.s ? smoke : null;
  }

  /** Wejście klatki od gry (Float64Array, układ HALL_DUST_IN). */
  submit(input) {
    if (input && input !== this.input) this.input.set(input);
    this._ensure();
  }

  /** Siatki warstw do rozgrzewki (Core3D.warmup, ekran ładowania). */
  warmupMeshes() {
    return this._ensure() ? this.layer.warmupMeshes() : [];
  }

  _update(ctx) {
    const t0 = performance.now();
    const IN = this.input;
    const sim = this.sim;
    const st = this.stats;
    const fresh = IN[I.serial] !== this._serial;
    this._serial = IN[I.serial];
    const on = !!(this.tune.enabled && sim && IN[I.active] > 0.5);
    st.active = on;
    if (!on) {
      if (this.layer) this.layer.setVisible(false);
      this._idle += ctx.dt;
      st.substeps = 0;
      return;
    }
    if (IN[I.hall] !== this._hall || this._idle > this.tune.idleClear) {
      sim.requestClear();
      resetHallGasSources(this.gasSrc);
      this._hall = IN[I.hall];
    }
    this._idle = 0;
    st.hall = this._hall;
    const aff = this._aff;
    aff.p0x = IN[I.p0x]; aff.p0y = IN[I.p0y];
    aff.ax = IN[I.ax]; aff.ay = IN[I.ay];
    aff.bx = IN[I.bx]; aff.by = IN[I.by];
    const dom = this.domain;
    const h = dom.h;
    const det = aff.ax * aff.by - aff.bx * aff.ay;
    const T = this.tune;

    // Strumienie dysz MAIN tej klatki (EngineFrame: scena x, y w górę = −y gry) → komórki domeny. Ostatnie
    // HALL_GAS_MAX miejsc tablicy należy do źródeł gazu hali.
    const J = sim.jets;
    let nj = 0;
    const maxEngine = Math.max(0, sim.maxJets - HALL_GAS_MAX);
    for (let k = 0; k < EngineFrame.count && nj < maxEngine; k++) {
      const power = EngineFrame.power[k];
      if (!(power >= T.minPower)) continue;
      const dx = EngineFrame.x[k] - aff.p0x;
      const dy = -EngineFrame.y[k] - aff.p0y;
      const hx = (aff.by * dx - aff.bx * dy) / det;
      const hz = (aff.ax * dy - aff.ay * dx) / det;
      const p = Math.min(power, 1.5);
      const len = T.jetLength * (0.6 + 0.4 * p);
      if (hallDomainDistance(dom, hx, hz) > len) continue;
      const vx = EngineFrame.dirX[k];
      const vy = -EngineFrame.dirY[k];
      let ux = (aff.by * vx - aff.bx * vy) / det;
      let uz = (aff.ax * vy - aff.ay * vx) / det;
      const ul = Math.sqrt(ux * ux + uz * uz) || 1;
      ux /= ul; uz /= ul;
      const o = nj * 12;
      J[o] = (hx - dom.x0) / h;
      J[o + 1] = (hz - dom.z0) / h;
      J[o + 2] = ux;
      J[o + 3] = uz;
      J[o + 4] = len / h;
      J[o + 5] = Math.max(2, (EngineFrame.spread[k] + EngineFrame.radius[k]) * T.jetWidth / h);
      J[o + 6] = T.jetWiden;
      J[o + 7] = T.jetSpeed * p / h;
      J[o + 8] = T.jetRate;
      J[o + 9] = 0; J[o + 10] = 0; J[o + 11] = 0;
      nj++;
    }
    const engines = nj;
    // Czas gry z wejścia (nowa klatka gry); bez nowej klatki — symulacja stoi.
    const dt = fresh ? IN[I.dt] : 0;
    // Źródła gazu hali (przewody paliwowe, szpule, zawory, wentylacja) — po dyszach.
    nj += writeHallGasSources(this.gasSrc, J, nj, sim.maxJets - nj, IN, dom, dt, T.gas);
    sim.jetCount = nj;
    st.sources = nj - engines;
    st.bursts = this.gasSrc.stats.bursts;
    st.venting = this.gasSrc.stats.venting;
    // kłęby pary przy złączkach (pula dymu rakiet): buchy z tej klatki i strumień upustu
    if (this.smoke && T.puffs) this._puffs(dt);

    // Kadłuby z wejścia (układ hali [j.]) → komórki: kotwica, macierz komórki → teksle maski obrysu, prędkość
    // i obrót; maski obrysu do tekstury tylko przy zmianie.
    const Bd = sim.bodies;
    const ns = Math.min(IN[I.ships] | 0, sim.maxBodies);
    for (let s = 0; s < ns; s++) hallBodyUniforms(IN, s, dom, Bd, s * 12);
    sim.bodyCount = ns;
    this._syncMasks(ns);

    // Usypianie: bez dysz, źródeł i ruchu kadłubów gaz po kilkunastu sekundach i tak stoi, a pył leży — symulacja
    // nie liczy (obraz zostaje). Pierwsza dysza albo ruszony (obracany) kadłub budzi ją od razu. Hala ze źródłami
    // gazu żyje.
    let moving = nj > 0;
    for (let s = 0; s < ns && !moving; s++) {
      const o = I.header + s * I.stride;
      const v = Math.sqrt(IN[o + SH.vx] * IN[o + SH.vx] + IN[o + SH.vz] * IN[o + SH.vz]) + Math.abs(IN[o + SH.w]) * IN[o + SH.reach];
      moving = v > T.movingSpeed;
    }
    this._quiet = moving ? 0 : this._quiet + dt;
    st.sleeping = this._quiet > T.sleepAfter && !sim._clear;
    if (st.sleeping) {
      sim.stats.substeps = 0;
      sim.stats.dispatches = 0;
    } else {
      sim.step(ctx.renderer, dt);
    }
    st.jets = sim.stats.jets;
    st.bodies = sim.stats.bodies;
    st.substeps = sim.stats.substeps;
    st.dispatches = sim.stats.dispatches;

    const layer = this.layer;
    layer.place(aff, T.zBack, T.zFront);
    const fade = 1 - smooth(T.fadeView[0], T.fadeView[1], IN[I.viewHalf]);
    layer.L.fade.value = fade;
    layer.setVisible(fade > 0.004);
    st.cpuMs = performance.now() - t0;
  }

  /**
   * Maski obrysu kadłubów (słowa 32-bitowe w rekordach wejścia, HALL_DUST_MASK) → pasy tekstury masek pola gazu.
   * Rozpakowanie i wysyłka tylko przy zmianie słów slotu (nowy okręt w slocie, rany, rozpad).
   */
  _syncMasks(ns) {
    const IN = this.input;
    const M = HALL_DUST_MASK;
    const words = this._maskWords;
    const data = this.sim.maskData;
    const area = M.w * M.h;
    let dirty = false;
    for (let s = 0; s < ns; s++) {
      const o = I.header + s * I.stride + SH.mask;
      const wo = s * M.words;
      let same = true;
      for (let k = 0; k < M.words; k++) {
        if (words[wo + k] !== IN[o + k]) { same = false; break; }
      }
      if (same) continue;
      dirty = true;
      for (let k = 0; k < M.words; k++) words[wo + k] = IN[o + k];
      const base = s * area;
      for (let b = 0; b < area; b++) data[base + b] = ((IN[o + (b >>> 5)] >>> (b & 31)) & 1) ? 255 : 0;
    }
    if (dirty) this.sim.markMasks();
  }

  /**
   * Kłęby pary z puli dymu rakiet (świat gry, paleta VAPOR — biała para, oświetla ją siatka świateł hali): BUCH
   * dookoła złączki przy odryglowaniu (duży) i ryglowaniu (mały) — zdarzenia źródeł gazu tej klatki, złączka na
   * wlewie; kłęby rozchodzą się od obwodu złączki we wszystkie strony, płatami (dwie harmoniczne o losowej fazie —
   * nierówny buch, nie okrąg), kilka wolnych i dużych zostaje przy złączce. UPUST — strumień kłębów z zaworu
   * przedmuchu na zewnątrz stanowiska. Losowanie: fxRandom (wizualia nie ruszają losowań gry).
   */
  _puffs(dt) {
    const sm = this.smoke;
    const src = this.gasSrc;
    const T = this.tune;
    const a = this._aff;
    const S = sm.s;
    const R = fxRandom;
    const E = src.events;
    const pick = (range) => range[0] + (range[1] - range[0]) * R.next();
    for (let e = 0; e < src.eventCount; e++) {
      const o = e * HALL_GAS_EVENT_STRIDE;
      const big = E[o] === HALL_GAS_EVENT.unlatch;
      const hx = E[o + 1];
      const hz = E[o + 3];
      const gx = a.p0x + hx * a.ax + hz * a.bx;
      const gy = a.p0y + hx * a.ay + hz * a.by;
      const z0 = k7HeightToZ(E[o + 2]);
      const k = big ? 1 : 0.6;
      const n = Math.max(6, Math.round(T.puffRing * (big ? 1 : 0.55)));
      const p1 = R.next() * TAU;
      const p2 = R.next() * TAU;
      const m1 = 2 + Math.floor(R.next() * 3);
      const m2 = 5 + Math.floor(R.next() * 3);
      for (let i = 0; i < n; i++) {
        const th = (i + (R.next() - 0.5) * 0.7) / n * TAU;
        const lobe = 0.64 + 0.26 * Math.sin(m1 * th + p1) + 0.16 * Math.sin(m2 * th + p2);
        const c = Math.cos(th);
        const s = Math.sin(th);
        // kierunek w hubie → świat gry (przekształcenie sztywne)
        const dx = c * a.ax + s * a.bx;
        const dy = c * a.ay + s * a.by;
        const sp = pick(T.puffSpeed) * lobe * (big ? 1 : 0.62);
        S.x = gx + dx * 24; S.y = gy + dy * 24; S.z = z0 + 2 + R.next() * 8;
        S.vx = dx * sp; S.vy = dy * sp; S.cx = 0; S.cy = 0;
        S.size0 = pick(T.puffSize) * (big ? 1 : 0.8);
        S.growth = pick(T.puffGrowth) * (0.7 + 0.4 * lobe) * k;
        S.life = pick(T.puffLife) * (big ? 1 : 0.75);
        S.temp = 0; S.pal = SMOKE_KIND.VAPOR;
        S.opacity = pick(T.puffOpacity) * (big ? 1 : 0.8);
        S.age = 0; S.angle = NaN;
        sm.push();
      }
      const nb = Math.round(T.puffBloom * (big ? 1 : 0.4));
      for (let i = 0; i < nb; i++) {
        const th = R.next() * TAU;
        const r0 = 10 + R.next() * 26;
        const dx = Math.cos(th) * a.ax + Math.sin(th) * a.bx;
        const dy = Math.cos(th) * a.ay + Math.sin(th) * a.by;
        const sp = 40 + R.next() * 110;
        S.x = gx + dx * r0; S.y = gy + dy * r0; S.z = z0 + 6 + R.next() * 10;
        S.vx = dx * sp; S.vy = dy * sp; S.cx = 0; S.cy = 0;
        S.size0 = (13 + R.next() * 8) * k; S.growth = (56 + R.next() * 34) * k;
        S.life = 1.6 + R.next() * 1.1; S.temp = 0; S.pal = SMOKE_KIND.VAPOR;
        S.opacity = (0.26 + R.next() * 0.14) * (big ? 1 : 0.8); S.age = 0; S.angle = NaN;
        sm.push();
      }
    }
    // upust: strumień kłębów z zaworu przedmuchu (na zewnątrz stanowiska i ku bramie — jak strumień pola gazu)
    if (!(dt > 0)) return;
    for (let i = 0; i < src.hoses.length && i < this._ventAcc.length; i++) {
      const H = src.hoses[i];
      const v = H.venting;
      if (!(v > 0.02)) { this._ventAcc[i] = 0; continue; }
      this._ventAcc[i] += T.ventRate * v * dt;
      const gx = a.p0x + H.cx * a.ax + H.cz * a.bx;
      const gy = a.p0y + H.cx * a.ay + H.cz * a.by;
      const z0 = k7HeightToZ(H.cy) + 8;
      const base = Math.atan2(0.75, H.side);
      while (this._ventAcc[i] >= 1) {
        this._ventAcc[i] -= 1;
        const th = base + (R.next() - 0.5) * 0.7;
        const dx = Math.cos(th) * a.ax + Math.sin(th) * a.bx;
        const dy = Math.cos(th) * a.ay + Math.sin(th) * a.by;
        const sp = (300 + R.next() * 220) * (0.6 + 0.4 * v);
        S.x = gx + dx * 20; S.y = gy + dy * 20; S.z = z0 + R.next() * 6;
        S.vx = dx * sp; S.vy = dy * sp; S.cx = 0; S.cy = 0;
        S.size0 = 5 + R.next() * 4; S.growth = 28 + R.next() * 22;
        S.life = 0.7 + R.next() * 0.5; S.temp = 0; S.pal = SMOKE_KIND.VAPOR;
        S.opacity = (0.22 + R.next() * 0.16) * v; S.age = 0; S.angle = NaN;
        sm.push();
      }
    }
  }

  /**
   * Światła hali w siatce świateł gry (krok `lights` klatki efektów — przed `update`): lampy, reflektory i migające
   * soczewki aktywnej hali (haloPortK7Lights.js) w świecie gry (przekształcenie hala → gra z wejścia, double).
   * Oświetlają pył i parę (gasFieldLayer.js) i kadłuby w hali (hullLighting). Zegar migania z wejścia — ten sam
   * co w shaderze hali (soczewka i jej światło w tej samej fazie).
   */
  _lights(ctx) {
    const IN = this.input;
    const T = this.tune;
    const st = this.stats;
    st.lights = 0;
    if (!T.enabled || !T.hallLights || !this.rig || !(IN[I.active] > 0.5)) return;
    if (IN[I.viewHalf] > T.fadeView[1]) return;
    const grid = ctx.grid;
    if (!grid) return;
    const p0x = IN[I.p0x], p0y = IN[I.p0y], ax = IN[I.ax], ay = IN[I.ay], bx = IN[I.bx], by = IN[I.by];
    const t = IN[I.clock];
    const n0 = grid.count;
    const lampK = T.lampGain * (T.lampBase + (Number(IN[I.lamps]) || 0));
    for (const L of this.rig.lamps) {
      const k = L.intensity * lampK;
      grid.addWorld(p0x + L.x * ax + L.z * bx, p0y + L.x * ay + L.z * by, k7HeightToZ(L.y), L.range,
        L.color[0] * k, L.color[1] * k, L.color[2] * k, T.lampScatter);
    }
    const spotK = T.spotGain * (0.6 + (Number(IN[I.lamps]) || 0));
    for (const s of this.rig.spots) {
      const k = s.intensity * spotK;
      const dx = s.dir[0], dz = s.dir[2];
      // oś: hala (x, z) → gra (liniowo), scena = (x, −y gry); pion = wysokość sceny
      const gx = dx * ax + dz * bx;
      const gy = dx * ay + dz * by;
      grid.addWorld(p0x + s.x * ax + s.z * bx, p0y + s.x * ay + s.z * by, k7HeightToZ(s.y), s.range,
        s.color[0] * k, s.color[1] * k, s.color[2] * k, 0.9, gx, -gy, s.dir[1], s.cosOuter, s.cosInner);
    }
    const S = HALL_DUST_SERVICE;
    const bk = T.beaconGain;
    const beacons = this.rig.beacons;
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i];
      let kind = b.kind;
      const bi = this._beaconBerth[i];
      if (bi >= 0) kind = IN[I.service + bi * S.stride + S.occupied] > 0.5 ? K7_BEACON.HOLD : K7_BEACON.CLEAR;
      const G = K7_BEACON_GRID[kind];
      if (!G) continue;
      const lvl = k7BeaconLevel(kind, t, b.phase, b.period) * G.gain * bk;
      if (!(lvl > 0.03)) continue;
      const c = K7_BEACON_LOOK[kind].color;
      grid.addWorld(p0x + b.x * ax + b.z * bx, p0y + b.x * ay + b.z * by, k7HeightToZ(b.y) + 6, G.range,
        c[0] * lvl, c[1] * lvl, c[2] * lvl, G.scatter);
    }
    st.lights = grid.count - n0;
  }
}

export const HallDust = new HallDustSystem();

// Rozgrzewka: siatki warstw powstają dopiero na ekranie ładowania (Core3D gotowy) — wpis czeka na urządzenie.
Core3D.warmup.add({ name: 'pył hal K-7', objects: () => HallDust.warmupMeshes(), phase: 'loading' });
