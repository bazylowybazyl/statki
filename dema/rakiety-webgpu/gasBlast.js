// dema/rakiety-webgpu/gasBlast.js
//
// WYBUCH 3D rakiety „Niszczyciel” — kula ognia i dym z GAZU NA SIATCE 3D, tego samego, którym gra rysuje
// śmierć okrętów (src/3d/gas/; reżyser gry: src/3d/explosions/explosionFx.js). Demo bierze moduły gazu wprost:
//   • GasGrid       — płyn na siatce 3D w compute (adwekcja MacCormacka, spalanie paliwa z rozprężaniem,
//                     kurczenie przy stygnięciu, rzut ciśnienia Jacobim); domena 128 × 128 × 48 komórek
//                     wokół wybuchu (jak atlas „fine” gry), jedzie z nośnikiem — trafionym kadłubem;
//   • GasVolume     — obraz: marsz promienia przez domenę (ogień jako ciało czarne, sadza, samocień ku
//                     słońcu, blask ognia w dymie, światła siatki dema). Bryłę domeny dzieli płaszczyzna
//                     gry: część POD nią rysuje się przed kadłubami (kadłub ją zasłania), część NAD nią —
//                     po nich (ogień i dym przykrywają okręt). Stąd głębia obrazu przy kamerze z góry;
//   • GasExplosions — emitery źródeł w czasie: rdzeń paliwa, kłęby, STRUMIENIE z otworów, płonące odłamki
//                     ze smugami ognia, dogasające ogniska;
//   • GasEmbers     — żar porywany polem prędkości gazu (wiruje w kuli ognia, stygnie w dymie).
// Receptura (`detonate`) wzorowana na `_gasRecipe` gry. Inne są strumienie: podaje je wołający (effects.js) —
// biją z otworu wlotowego kanałem, którym weszła głowica, z wylotu po drugiej stronie kadłuba i z burt.
//
// Strojenie fizyki i obrazu to KOPIA `tuneGasForSpace` / `tuneLookForGame` z explosionFx.js (stan
// 2026-11-10): demo nie importuje reżysera gry (ciągnie za sobą Core3D i pół renderu gry). Zmiana strojenia
// w grze → przenieś tutaj. Bez przeszkód: w demie gaz przenika kadłuby (w grze kadłuby i budowle są
// przeszkodami — src/game/gasObstacleInput.js).
// Układ: scena dema (x − O.x, −(y − O.y), z ku kamerze); początek siatki gazu = (0, 0, 0).

import { GasGrid } from '../../src/3d/gas/gasGrid.js';
import { GasVolume, GAS_LIGHT_OWNER_BASE } from '../../src/3d/gas/gasVolume.js';
import { GasExplosions } from '../../src/3d/gas/gasExplosions.js';
import { GasEmbers } from '../../src/3d/gas/gasEmbers.js';

export { GAS_LIGHT_OWNER_BASE };

/**
 * Siatka jak atlas „fine” gry (kula ognia duża na ekranie): 128² × 48 komórek, 41 iteracji ciśnienia.
 * Dwie domeny = dwa wybuchy naraz w różnych miejscach (trzeci zabiera starszą). Alokacja leniwa: atlasy
 * (63 MB na domenę) powstają przy pierwszym wybuchu i wracają do 1 × 1 × 1 po `releaseAfter` s bez domen.
 */
export const GAS_BLAST_GRID = Object.freeze({ N: 128, NZ: 48, slots: 2, jacobi: 41, maxSources: 160, lazy: true, releaseAfter: 30, nRef: 96 });
/** Bok domeny / promień kuli ognia i komórki na promień przy strojeniu gazu (explosionFx.js: domainScale, GAS_CELLS_PER_R_REF). */
const DOMAIN_SCALE = 5.4;
const CELLS_PER_R_REF = 96 / 5.4;
const TAU = Math.PI * 2;

/** Fizyka gazu dla wybuchu w próżni — kopia tuneGasForSpace (explosionFx.js). */
function tuneGasForSpace(T) {
  T.buoyancy = 0;
  T.buoyDir = [0, 0, 1];
  T.radialLift = 1.6;
  T.smokeDecay = 0.545;
  T.disperse = 0.14;
  T.drag = 0.23;
  T.dragQuad = 0.03;
  T.cooling = 1.04;
  T.soot = 0.39;
  T.velMacCormack = 1;
  T.vorticity = 1.0;
  T.turbulence = 10;
  T.sponge = 3;
  T.contraction = 0.3;
  T.restRelax = 1.5;
  T.fireBurn = 0.03;
  T.glowFar = 4;
  return T;
}

/** Obraz gazu przy kamerze z góry — kopia tuneLookForGame (explosionFx.js). */
function tuneLookForGame(L) {
  L.stepCells = 0.8;
  L.maxSteps = 80;
  L.density = 0.45;
  L.frontDensity = 0.5;
  L.albedo = [0.15, 0.135, 0.12];
  L.emission = 0.62;
  L.jitter = 0.4;
  L.warpAmp = 1.4;
  L.detailScale = 0.09;
  L.detail = 0.7;
  L.erosion = 0.9;
  L.flameNoise = 0.9;
  L.glowGain = 2.5;
  return L;
}

export class GasBlast {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene scena dema (kamera ortho z góry)
   * @param {THREE.Data3DTexture} o.noise3D szum 3D dema (ten sam algorytm co fxNoise.noise3D gry)
   * @param {THREE.Data3DTexture} o.curl3D pole wirowe dema (fxNoise.curl3D gry)
   * @param {object} [o.lightGrid] siatka świateł dema (lights.js) — dym łapie dysze, błyski i reflektory
   * @param {() => number} [o.rng] losowanie efektów
   * @param {number} [o.renderOrderBack] bryła pod płaszczyzną gry (przed kadłubami)
   * @param {number} [o.renderOrderFront] bryła nad płaszczyzną gry (po kadłubach i dymie rakiet)
   */
  constructor({ renderer, scene, noise3D, curl3D, lightGrid = null, rng = Math.random, renderOrderBack = 1, renderOrderFront = 34, renderOrderEmbers = 62 }) {
    this.renderer = renderer;
    this.rng = { next: rng };
    this.grid = new GasGrid({ ...GAS_BLAST_GRID, noise3D, rng: this.rng });
    tuneGasForSpace(this.grid.tune);
    this.volume = new GasVolume({ grid: this.grid, noise3D, curl3D, lightGrid });
    tuneLookForGame(this.volume.look);
    this._sunGain = this.volume.look.sunGain;
    this.meshes = this.volume.createMeshes({ layer: 0, renderOrderBack, renderOrderFront, name: 'GazNiszczyciela' });
    scene.add(this.meshes.back, this.meshes.front);
    this.director = new GasExplosions({ grid: this.grid, rng: this.rng, hooks: {}, emitterCap: 192 });
    // Jak w grze: narzucenie prędkości źródeł gaśnie po starcie (strumienie i kłęby żyją własną dynamiką),
    // źródła jadą z nośnikiem domeny (trafiony kadłub w ruchu).
    this.director.tune.velTau = 0.15;
    this.director.tune.followCarrier = true;
    this.embers = new GasEmbers({ scene, grid: this.grid, rng: this.rng, renderOrder: renderOrderEmbers });
    this.embers.mesh.name = 'ZarNiszczyciela';
    this.embers.U.fadeIn.value = 0.12;
    this._acq = { size: 1, life: 3.4, carrier: [0, 0, 0], now: 0, k: 1, noStatics: true, noHulls: true, fadeTime: 1.6 };
    this.stats = { blasts: 0, secondaries: 0 };
  }

  /** Siatki do rozgrzewki potoków (bryły gazu i żar). */
  get warmMeshes() {
    return [this.meshes.back, this.meshes.front, this.embers.mesh];
  }

  /** Żywe domeny gazu. */
  get domains() {
    return this.grid.stats.active;
  }

  /**
   * WYBUCH (scena): kula ognia o promieniu R [j.] w punkcie (X, Y) płaszczyzny gry. Opcje:
   *   power   — mnożnik paliwa (jasność i rozmach kuli),
   *   cvx/cvy — nośnik domeny [j./s] (scena) — gaz jedzie z trafionym kadłubem,
   *   jets    — strumienie gazu z otworów: [{ x, y, dx, dy, fire, speed, dur, delay, r, tau, velTau }] (scena;
   *             bez listy — 3–4 w losowych kierunkach jak wybuch w pustce),
   *   fires   — dogasające ogniska: [{ x, y, ux, uy, r, dur, delay }] (płomień bije wzdłuż (ux, uy)),
   *   lobes, trails, embers — liczba kłębów, płonących odłamków i iskier żaru,
   *   lift    — środek kuli nad płaszczyzną gry [× R] (większość ognia przed kadłubem, ku kamerze),
   *   life    — życie domeny po wybuchu [s] (potem wygaszanie 1,6 s).
   * Zwraca indeks domeny albo −1.
   */
  detonate(X, Y, o = {}) {
    const g = this.grid;
    const d = this.director;
    const r = () => this.rng.next();
    const R = o.R ?? 300;
    const P = o.power ?? 1;
    const smoke = o.smoke ?? 1;
    const A = this._acq;
    A.size = R * DOMAIN_SCALE;
    A.life = o.life ?? 3.4;
    A.carrier[0] = o.cvx || 0; A.carrier[1] = o.cvy || 0; A.carrier[2] = 0;
    A.now = g.time;
    // Skala komórki domeny (GasSlot.k): parametry gazu w jednostkach komórek strojone przy 96 / 5,4 komórki na promień.
    A.k = g.N / DOMAIN_SCALE / CELLS_PER_R_REF;
    const slot = g.acquire(X, Y, 0, R, A);
    if (slot < 0) return -1;
    this.stats.blasts++;
    const Z = R * (o.lift ?? 0.1);
    // Rdzeń: krótki wyrzut paliwa w kuli 0,4 R, rozpychany promieniowo.
    d.puff(slot, X, Y, Z, R * 0.4, 0, 0.13, 13 * P, R * 3.2, { temp: 7, smoke: 0.9 * smoke, grow: 1.5, velBlend: 40, noise: 0.6, tau: 0 });
    // Kłęby wokół rdzenia (nieregularna kula): drobne, opóźnione, z przewagą ku kamerze.
    const nL = (o.lobes ?? 6) + (r() < 0.5 ? 1 : 0);
    const a0 = r() * TAU;
    for (let i = 0; i < nL; i++) {
      const a = a0 + (i + (r() - 0.5) * 0.9) / nL * TAU;
      let ux = Math.cos(a);
      let uy = Math.sin(a);
      let uz = -0.15 + r() * 0.6;
      const l = Math.sqrt(ux * ux + uy * uy + uz * uz);
      ux /= l; uy /= l; uz /= l;
      const dist = R * (0.18 + r() * 0.42);
      d.puff(slot, X + ux * dist, Y + uy * dist, Z + uz * dist, R * (0.12 + r() * 0.12), 0.01 + r() * 0.16, 0.06 + r() * 0.06,
        (8 + r() * 5) * P, R * (1.4 + r() * 1.2),
        { temp: 6.5, smoke: 1.0 * smoke, grow: 1.4, velBlend: 40, noise: 0.6, dir: [ux * R * 2.2, uy * R * 2.2, uz * R * 1.0] });
    }
    // Strumienie gazu z otworów (gaz wychodzi z miejsca wybuchu z pędem, dalej leci i kłębi się sam).
    let jets = o.jets;
    if (!jets || !jets.length) {
      jets = [];
      const nJ = 3 + (r() < 0.5 ? 1 : 0);
      const aj = r() * TAU;
      for (let i = 0; i < nJ; i++) {
        const a = aj + (i + (r() - 0.5) * 0.8) / nJ * TAU;
        jets.push({ x: X + Math.cos(a) * R * 0.15, y: Y + Math.sin(a) * R * 0.15, dx: Math.cos(a), dy: Math.sin(a), fire: r() < 0.5 });
      }
    }
    for (const j of jets) {
      const fire = !!j.fire;
      const rr = j.r ?? R * (0.055 + r() * 0.035);
      d.jet(slot, j.x, j.y, j.z ?? Z * 0.5, j.dx, j.dy, j.dz ?? (r() - 0.5) * 0.2, rr, rr * 3, j.speed ?? R * (5 + r() * 3), j.dur ?? 0.6 + r() * 0.9, {
        delay: j.delay ?? r() * 0.12,
        fuel: fire ? (7 + r() * 4) * P : 0, temp: fire ? 5 : 0.3, smoke: (fire ? 3 : 8 + r() * 4) * smoke,
        radial: R * 0.14, velBlend: 36, noise: 0.3, tau: j.tau ?? 0.55 + r() * 0.35, flicker: 0.3, grow: 1.25,
        rampIn: 0.04, rampOut: 0.3, velTau: j.velTau ?? -1
      });
    }
    // Płonące odłamki w gazie: smugi ognia przechodzące w dym + rozżarzony łeb (bez porwania, z nośnikiem domeny).
    const nT = o.trails ?? 9;
    for (let i = 0; i < nT; i++) {
      const a = r() * TAU;
      const uz = (r() - 0.5) * 0.3 + 0.08;
      const sp = R * (1.9 + r() * 1.3);
      const life = 0.7 + r() * 0.7;
      d.trail(slot, X, Y, Z, Math.cos(a) * sp, Math.sin(a) * sp, uz * sp, R * (0.085 + r() * 0.045), life,
        { delay: 0, drag: 1.1, fuel: (28 + r() * 14) * P, temp: 30, smoke: (10 + r() * 6) * smoke, shrink: 0.45, velBlend: 14, tau: life * 0.7 });
      this.embers.burst(X, Y, Z, Math.cos(a), Math.sin(a), uz, 0, 1, sp, sp, life + 0.8 + r() * 1.4, life + 1.0, R * (0.03 + r() * 0.025), 2.1, -1, 1, 0, slot);
    }
    // Dogasające ogniska w otworach (płomień w bok, tuż nad płaszczyzną gry).
    for (const f of (o.fires || [])) {
      d.fire(slot, f.x, f.y, f.z ?? Z * 0.3, f.r ?? R * 0.11, f.dur ?? 2.4, {
        delay: f.delay ?? 0.4, fuel: (2.4 + r() * 1.2) * P, temp: 2.6 + r() * 0.6, smoke: 1.6 + r() * 0.8,
        radial: R * 0.08, lift: R * 0.5, velBlend: 6, flicker: 0.55, keep: 1.0, up: [f.ux, f.uy, f.uz ?? 0.12]
      });
    }
    // Żar porywany przez gaz: szybkie iskry z kuli ognia i wolne, dłużej tlące się w dymie.
    const n = o.embers ?? 700;
    if (n > 0) {
      this.embers.burst(X, Y, Z, 0, 0, 1, 1.0, Math.round(n * 0.5), R * 0.6, R * 3.0, 0.5, 1.5, R * 0.016, 2.1, slot, 0.18, R * 0.4);
      this.embers.burst(X, Y, Z, 0, 0, 1, 1.0, Math.round(n * 0.5), R * 0.15, R * 1.1, 1.4, 3.4, R * 0.022, 1.6, slot, 0.25, R * 0.5);
    }
    return slot;
  }

  /**
   * Wybuch wtórny w żywej domenie (scena): mała kula o promieniu R w (X, Y), wyrzut wzdłuż (nx, ny).
   * false — punkt poza domeną albo domena wygasła (wołający rysuje wtedy kulę z cząstek).
   */
  secondary(slot, X, Y, R, nx = 0, ny = 0) {
    const g = this.grid;
    if (!(slot >= 0) || !g.slots[slot] || !g.slots[slot].active || !g.contains(slot, X, Y, 0, 10)) return false;
    g.feed(slot, g.time + 2.4);
    this.director.blast(X, Y, R * 0.1, R, [nx, ny, 0.3], { slot, power: 0.8, puffs: 3, trails: 2 });
    this.embers.burst(X, Y, R * 0.1, nx, ny, 0.3, 0.9, 90, R * 0.6, R * 4, 0.4, 1.2, R * 0.03, 2.1, slot, 0.3, R * 0.3);
    this.stats.secondaries++;
    return true;
  }

  /**
   * Krok klatki (przed renderem): emitery → źródła, symulacja, bryły domen, żar. dt = 0 w pauzie (obraz stoi).
   * sunDir — kierunek DO słońca (scena, jednostkowy), sunOn — przełącznik słońca dema.
   */
  update(dt, camera, sunDir, sunOn = true) {
    const g = this.grid;
    g.sunDir.copy(sunDir);
    this.volume.look.sunGain = sunOn ? this._sunGain : 0;
    g.beginFrame();
    this.director.update(dt);
    g.simulate(this.renderer, dt);
    this.volume.syncLook();
    this.volume.updateMeshes(0, 0, 0);
    this.embers.update(this.renderer, dt, camera);
  }

  /** Rozgrzewka: puste dispatche kerneli gazu i żaru (potoki siatek — klatką rozgrzewki dema). */
  warm() {
    this.grid.warm(this.renderer);
    this.embers.warm(this.renderer);
  }

  clear() {
    this.grid.clear();
    this.director.clear();
    this.embers.clear();
    this.volume.updateMeshes(0, 0, 0);
  }
}
