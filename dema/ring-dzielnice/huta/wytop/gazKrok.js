// HUTA — wytop: GAZ KOMORY — KROK EFEKTU w potoku gry (`Core3D.addFxStep`) i klej siatki z obrazem. Bez window / DOM.
//
// `createWytopGaz(Core3D, { root, preset })` → obiekt gazu jednej komory:
//   submit(inp)      wejście jednego kroku fizyki (tablica `GAZ_IN`, kopiowana) — krok pola wykona się w najbliższej
//                    klatce efektów (compute raz na klatkę, przed passami); zaległość ponad `maxPerFrame` kroków
//                    jest scalana (masy źródeł się sumują — gaz nie ginie)
//   stepNow(inp)     krok od razu (harness zrzutów: `simulate` bez pętli klatek — pole nadąża za symulacją)
//   frame(a)         klatka obrazu: kamera, ułamek kroku (przenikanie dwóch stanów obrazu), bryła do ucięcia promienia,
//                    widok z góry (tarcza drgania powietrza) — woła strona przed `Core3D.render`
//   probe()          odczyt mapy kolumn (przesłona, masy) — tylko harness
// Krok czyta wyłącznie tablicę wejścia (`gazWejscie.js`) — przy wpięciu w grę to blok migawki klatki. Pole bez gazu
// i bez źródeł przez `sleepAfter` s zasypia (krok i rysunek się pomijają, pole wyzerowane).
import { FX_DISTORT_LAYER } from '../../../../src/3d/fx/fxFrame.js';
import { GAZ, GAZ_FIZ, GAZ_IN, GAZ_IN_N, GAZ_SLOTS, GAZ_SRC, GAZ_STRIDE, gazPrzeslonaCpu, gazPulseOf } from './gaz.js';
import { GazSiatka } from './gazSiatka.js';
import { GazObraz } from './gazObraz.js';

/** Po tylu sekundach bez źródeł i bez gazu w liczbach symulacji pole zasypia. */
export const GAZ_SLEEP_AFTER = 12;
/** Luz regulatora masy po ciągu cyklu odciągu gaśnie z tym czasem [s]. */
export const PULSE_MEM = 1.5;
/** Gaz w komorze [t], poniżej którego (bez źródeł) liczy się cisza. */
export const GAZ_SLEEP_TONS = 0.05;

/**
 * Sumuje wejście `add` do `into` (zaległe kroki scalane w jeden): stan z nowszego kroku, masy źródeł zsumowane
 * (rekord slotu z nowszego kroku, jeśli ma masę; inaczej zostaje starszy).
 */
export function mergeGasInput(into, add) {
  const I = GAZ_IN;
  for (let q = 0; q < GAZ_SLOTS; q++) {
    const o = I.src + q * GAZ_STRIDE;
    const td = into[o + GAZ_SRC.dym];
    const to = into[o + GAZ_SRC.opar];
    const had = td + to > 0;
    const has = add[o + GAZ_SRC.dym] + add[o + GAZ_SRC.opar] > 0;
    if (has) {
      for (let k = 0; k < GAZ_STRIDE; k++) into[o + k] = add[o + k];
      if (had) { into[o + GAZ_SRC.dym] += td; into[o + GAZ_SRC.opar] += to; }
    }
  }
  const emit = into[I.emitT] + add[I.emitT];
  for (let i = 0; i < I.src; i++) into[i] = add[i];
  into[I.emitT] = emit;
  return into;
}

/**
 * @param {object} Core3D  potok gry
 * @param {object} o
 * @param {object} o.root     grupa w układzie komory (bryły marszu)
 * @param {number} [o.preset] preset jakości 0…2 (`GAZ.presets`)
 * @param {number} [o.layer]  warstwa brył marszu (warstwa komory)
 * @param {object} [o.metal]  metal (barwy `gasSmoke`, `gasFume`)
 * @param {object} [o.fiz]    nadpisania liczb fizyki `GAZ_FIZ` (strojenie)
 */
export function createWytopGaz(Core3D, { root, preset = 1, layer = 1, metal = null, maxPerFrame = 2, fiz = null } = {}) {
  const grid = new GazSiatka({ preset, fiz });
  const image = new GazObraz({ grid });
  image.setLayer(layer);
  root.add(image.front);
  root.add(image.back);
  Core3D.scene.add(image.heat);
  if (metal) grid.setColors(metal.gasSmoke, metal.gasFume);

  const queue = [new Float32Array(GAZ_IN_N), new Float32Array(GAZ_IN_N), new Float32Array(GAZ_IN_N), new Float32Array(GAZ_IN_N)];
  const last = new Float32Array(GAZ_IN_N);
  let pending = 0;
  let quiet = 0;
  let asleep = true;
  let warmed = false;
  let relight = false;
  let heatOn = false;
  const stats = { steps: 0, dispatches: 0, merged: 0, asleep: true, quiet: 0, cpuMs: 0, perFrame: 0, mass: 0, target: 0, extraDecay: 0, reads: 0 };
  const F = grid.F;
  let massBusy = false;
  let massAt = 0;
  /** pamięć ciągu cyklu odciągu 0…1 (gaśnie z czasem `PULSE_MEM` s po końcu ciągu) — luz regulatora masy */
  let pulseMem = 0;
  const pulseOut = new Float64Array(2);

  /**
   * REGULATOR MASY: co `massEvery` kroków asynchroniczny odczyt mapy kolumn (bez czekania — wynik przychodzi kilka
   * klatek później), z niego masa pola; zanik dodatkowy trzyma pole przy liczbie gazu w komorze z symulacji.
   */
  function massControl(renderer, inp) {
    const target = Math.max(F.massFloor, inp[GAZ_IN.gasAirT]);
    stats.target = target;
    const ratio = stats.mass / target;
    // CYKL ODCIĄGU (runda 6): w ciągu symulacja liczy szybki odciąg, a pole musi gaz do okapów DONIEŚĆ — regulator
    // toleruje do `pulseBand` × więcej gazu w polu (luz gaśnie z czasem `PULSE_MEM` po ciągu), zamiast gasić go w miejscu
    gazPulseOf(inp[GAZ_IN.draw], pulseOut);
    const dt = inp[GAZ_IN.dt] > 0 ? inp[GAZ_IN.dt] : 1 / 60;
    pulseMem = Math.max(pulseOut[1], pulseMem * Math.exp(-dt / PULSE_MEM));
    stats.pulse = pulseMem;
    const band = F.massBand * (1 + (F.pulseBand - 1) * pulseMem);
    grid.extraDecay = Math.max(0, Math.min(F.massMax, F.massGain * (ratio - band)));
    // pole ma mniej gazu niż symulacja → zanik podstawowy przymknięty (upusty i obmywanie bryły pracują dalej)
    grid.removalK = Math.max(0.05, Math.min(1, (ratio - 0.6) / 0.4));
    stats.extraDecay = grid.extraDecay;
    stats.removalK = grid.removalK;
    if (massBusy || stats.steps - massAt < F.massEvery) return;
    massBusy = true;
    massAt = stats.steps;
    grid.probe(renderer).then((m) => {
      stats.mass = grid.massOf(m.data);
      stats.reads++;
      massBusy = false;
    }, () => { massBusy = false; });
  }

  /** Cisza: bez źródeł i bez gazu w liczbach symulacji. Zwraca true, gdy krok ma się wykonać. */
  function wake(inp) {
    const dt = inp[GAZ_IN.dt] > 0 ? inp[GAZ_IN.dt] : 1 / 60;
    if (inp[GAZ_IN.emitT] > 0 || inp[GAZ_IN.gasAirT] > GAZ_SLEEP_TONS) quiet = 0;
    else quiet += dt;
    stats.quiet = quiet;
    if (quiet > GAZ_SLEEP_AFTER) {
      if (!asleep) {
        asleep = true;
        stats.asleep = true;
        return 'sleep';
      }
      return 'skip';
    }
    asleep = false;
    stats.asleep = false;
    return 'run';
  }

  function run(renderer, inp) {
    const w = wake(inp);
    last.set(inp);
    if (w === 'run') {
      massControl(renderer, inp);
      stats.dispatches += grid.step(renderer, inp);
      stats.steps++;
      stats.perFrame++;
    } else if (w === 'sleep') {
      grid.clear(renderer);
      stats.mass = 0;
      grid.extraDecay = 0;
      grid.removalK = 1;
    }
  }

  const fxStep = {
    name: 'wytop: gaz komory',
    update(ctx) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      stats.perFrame = 0;
      const renderer = ctx.renderer;
      for (let i = 0; i < pending; i++) run(renderer, queue[i]);
      pending = 0;
      if (relight && !asleep) grid.relight(renderer);
      relight = false;
      // tarcza drgania: zgłoszenie warstwy zniekształceń z kroku efektów (flagę kasuje start klatki efektów)
      if (heatOn && image.heat.visible && !asleep) Core3D.setDistortLayerActive(true);
      stats.cpuMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    },
    warm(ctx) {
      grid.warm(ctx.renderer);
      warmed = true;
    }
  };
  Core3D.addFxStep(fxStep);

  return {
    grid, image, stats, fxStep,
    get preset() { return grid.preset; },
    get asleep() { return asleep; },
    get warmed() { return warmed; },
    /** Wejście ostatniego wykonanego kroku (do sond i testów — tylko odczyt). */
    get lastInput() { return last; },
    /** Bryły do rozgrzewki rysunku: [PRZÓD, TYŁ] na warstwie komory i tarcza na warstwie zniekształceń. */
    meshes: { volume: [image.front, image.back], heat: [image.heat], heatLayer: FX_DISTORT_LAYER },
    setMetal(M) { grid.setColors(M.gasSmoke, M.gasFume); relight = true; },
    setLook(o) { grid.setLook(o); relight = true; },
    submit(inp) {
      if (pending < maxPerFrame) queue[pending++].set(inp);
      else {
        mergeGasInput(queue[pending - 1], inp);
        stats.merged++;
      }
    },
    stepNow(inp) {
      const renderer = Core3D.renderer;
      if (!renderer) return;
      run(renderer, inp);
    },
    /** Obraz przeliczony od razu z bieżącego stanu (zmiana wyglądu / metalu przy stojącej symulacji). */
    relightNow() {
      if (Core3D.renderer && !asleep) grid.relight(Core3D.renderer);
      relight = false;
    },
    /**
     * Klatka obrazu: `cam` [x, y, z] w układzie komory, `alpha`, `frame` (numer klatki), `body` [x, y, z, rx, ry],
     * `on` (gaz włączony); drganie: `heat` = { x, y (środek tarczy w scenie), size, time, strength } albo null.
     */
    frame(a) {
      image.frame({ cam: a.cam, alpha: a.alpha, frame: a.frame, body: a.body, mach: a.mach, on: a.on !== false && !asleep });
      const h = a.heat;
      heatOn = !!h && !asleep && image.placeHeat(h.x, h.y, h.size, h.time, h.strength);
      if (!heatOn) image.heat.visible = false;
    },
    /**
     * SONDA (harness): przesłona pionowa z kamery z góry i masy pola. `R` — promień kuli (tarcza K1), `off` — środek
     * kuli [x, z]. Zwraca statystyki stref kryteriów K1–K4 (średnia, percentyl 95, udział pikseli ponad progami).
     */
    async probe({ R = 0, offX = 0, offZ = 0, map = false, core = 0 } = {}) {
      const renderer = Core3D.renderer;
      if (!renderer) return null;
      const m = await grid.probe(renderer);
      const out = analyseColumns(m, R, offX, offZ);
      // jądro ciekłe w topionej kupie: osobna tarcza (kupa dymi z całej powierzchni, jądro ma zostać widoczne)
      if (core > 1) out.jadro = analyseColumns(m, core, offX, offZ).kula;
      // mapa przesłony z góry (wiersze = z, kolumny = x) — do podglądu w harnessie
      if (map) {
        out.mapa = { nx: m.nx, nz: m.nz, przeslona: Array.from({ length: m.nx * m.nz }, (_, i) => +gazPrzeslonaCpu(Math.max(0, m.data[i * 4 + 1])).toFixed(3)) };
      }
      return out;
    },
    dispose() {
      Core3D.fx?.removeStep?.(fxStep);
      root.remove(image.front);
      root.remove(image.back);
      Core3D.scene.remove(image.heat);
      image.dispose();
      grid.dispose();
    }
  };
}

const HOOD_AZ = [82, 222, 300, 343].map((a) => a * Math.PI / 180);

/**
 * Statystyki mapy kolumn dla kryteriów czytelności (projekt § 4): przesłona = 1 − e^(−τ) w pionie od błony do pierwszej
 * bryły. Strefy: tarcza kuli (ρ < R wokół środka kuli), pas wyświetlacza (452 < ρ < 517), tarcza leja (ρ < 400),
 * pierścień (R + 40 < ρ < 440), okapy (kolumny do 90 j. od środka wlotu). Masy pola [t].
 */
export function analyseColumns(m, R, offX = 0, offZ = 0) {
  const { nx, nz, cell, data } = m;
  const zone = () => ({ v: [] });
  const Z = { kula: zone(), wyswietlacz: zone(), lej: zone(), pierscien: zone(), okapy: zone(), calosc: zone() };
  let dym = 0;
  let opar = 0;
  let heatMax = 0;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const o = (k * nx + i) * 4;
    const x = GAZ.x0 + (i + 0.5) * cell;
    const z = GAZ.z0 + (k + 0.5) * cell;
    const rho = Math.sqrt(x * x + z * z);
    dym += data[o + 2];
    opar += data[o + 3];
    if (rho > 517) continue;
    const p = gazPrzeslonaCpu(Math.max(0, data[o + 1]));
    if (data[o] > heatMax) heatMax = data[o];
    Z.calosc.v.push(p);
    const rb = Math.hypot(x - offX, z - offZ);
    if (R > 1 && rb < R) Z.kula.v.push(p);
    if (rho > 452 && rho < 517) Z.wyswietlacz.v.push(p);
    if (rho < 400) Z.lej.v.push(p);
    if (rho > R + 40 && rho < 440) Z.pierscien.v.push(p);
    for (const a of HOOD_AZ) if (Math.hypot(x - 437.5 * Math.cos(a), z - 437.5 * Math.sin(a)) < 90) { Z.okapy.v.push(p); break; }
  }
  const out = {};
  for (const [name, q] of Object.entries(Z)) {
    const v = q.v.sort((a, b) => a - b);
    const n = v.length;
    let s = 0;
    for (let i = 0; i < n; i++) s += v[i];
    out[name] = n ? {
      n, srednia: s / n, p95: v[Math.min(n - 1, Math.floor(n * 0.95))], max: v[n - 1],
      ponad20: v.filter((x) => x > 0.2).length / n, ponad30: v.filter((x) => x > 0.3).length / n
    } : { n: 0, srednia: 0, p95: 0, max: 0, ponad20: 0, ponad30: 0 };
  }
  const cv = cell * cell * cell / 1e6;
  out.masa = { dym: dym * cv, opar: opar * cv, razem: (dym + opar) * cv };
  out.cieplo = heatMax;
  out.kDym = GAZ_FIZ.kDym;
  return out;
}
