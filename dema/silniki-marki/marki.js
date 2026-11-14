// dema/silniki-marki/marki.js
//
// MARKI SILNIKÓW frakcji — dane dema (czyste: bez three i DOM, testy tests/silnikiMarki.test.mjs).
// Marka = osprzęt dyszy (bryłę buduje dysze.js po `id`) + nastawy STRUGI dla pięciu stanów:
//   normal (pełny ciąg), boost (dopalacz), hiper (lot hipercruise'u), warp (lot warpa), ladowanie (ładowanie warpa).
// Shader strugi (struga.js) nie zna trybów — dostaje jeden wektor liczb; tryby to mieszanie nastaw kanałami
// automatu (automat.js) w `blendPlume`. Nowa marka = nowy wpis tutaj + bryła w dysze.js, bez nowego shadera.
//
// Jednostki: `len` — długość strugi w promieniach wylotu (r dyszy), `wid` — półszerokość przy wardze w półszerokościach
// wylotu (rw dyszy), `flow` — przepływ wzoru w promieniach na sekundę (ujemny = do dyszy), barwy liniowe HDR
// (rdzeń > 1 — jedyne źródło bloomu, ciało ≤ ~0,8 luminancji).

const DOMYSLNE = Object.freeze({
  len: 14, wid: 1, flare: 0.3, taper: 0.9,
  diamonds: 0, dSpacing: 2, dDecay: 2.5,
  turb: 0.1, streak: 0.45,
  pulse: 0, pFreq: 0, pSpacing: 3,
  twist: 0, flat: 0, grid: 0, shell: 0,
  coreLen: 0.2, coreW: 0.3, coreGain: 1,
  sheathW: 1.7, sheathGain: 0.5,
  gain: 1, flow: 22,
  haze: 1, hazeLen: 9,
  sputter: 0, sparks: 0, glow: 1,
  core: [8, 8, 8], body: [0.5, 0.5, 0.5], tip: [0.3, 0.3, 0.3], sheath: [0.2, 0.2, 0.2]
});

export const POLA_LICZB = Object.freeze(Object.keys(DOMYSLNE).filter((k) => typeof DOMYSLNE[k] === 'number'));
export const POLA_BARW = Object.freeze(['core', 'body', 'tip', 'sheath']);
export const STANY = Object.freeze(['normal', 'boost', 'hiper', 'warp', 'ladowanie']);

function pelne(baza, nadpis) {
  const o = {};
  for (const k of POLA_LICZB) o[k] = nadpis && nadpis[k] !== undefined ? nadpis[k] : baza[k];
  for (const k of POLA_BARW) o[k] = [...((nadpis && nadpis[k]) || baza[k])];
  return Object.freeze(o);
}

function struga(normal, boost, hiper, warp, ladowanie) {
  const n = pelne(DOMYSLNE, normal);
  return Object.freeze({
    normal: n,
    boost: pelne(n, boost),
    hiper: pelne(n, hiper),
    warp: pelne(n, warp),
    ladowanie: pelne(n, ladowanie)
  });
}

/**
 * Dysza marki: wylot (x, y) w układzie okrętu (dziób +X, wydech −X), r — promień wylotu (jednostka długości strugi),
 * rw — półszerokość wylotu (dysza płaska / panel: rw > r), kLen / kGain — odchyłka tej dyszy, ph — przesunięcie
 * fazy impulsów, splay — rozchylenie osi [°], gimbal — największe wychylenie bryły dyszy [°] (0 = dysza stała),
 * odchyl — odchylenie samej strugi polem [°] (dysza stoi — silnik magnetoplazmowy).
 */
function dysza(x, y, r, o = {}) {
  return Object.freeze({ x, y, r, rw: o.rw ?? r, kLen: o.kLen ?? 1, kGain: o.kGain ?? 1, ph: o.ph ?? 0, splay: o.splay ?? 0, gimbal: o.gimbal ?? 0, odchyl: o.odchyl ?? 0, seed: o.seed ?? (Math.abs(x * 0.137 + y * 0.731) % 1) });
}

export const MARKI = Object.freeze([
  {
    id: 'helios',
    nazwa: 'HELIOS',
    frakcja: 'Terra Nova',
    typ: 'fuzyjny wodorowy — klasyczny dzwon na przegubie',
    opis: 'Czysta, laminarna struga z łańcuchem dysków Macha. Dopalacz wydłuża łańcuch, hipercruise zwęża strugę w igłę.',
    swiatlo: [0.45, 0.7, 1.0],
    lampa: [0.35, 0.75, 1.0],
    dysze: [
      dysza(-214, 0, 16, { gimbal: 9, seed: 0.13 }),
      dysza(-204, 31, 11, { gimbal: 9, kLen: 0.92, seed: 0.57 }),
      dysza(-204, -31, 11, { gimbal: 9, kLen: 0.92, seed: 0.81 })
    ],
    struga: struga(
      { len: 11, wid: 1.05, flare: 0.35, taper: 0.62, diamonds: 0.55, dSpacing: 1.9, dDecay: 2.2, turb: 0.06, streak: 0.4,
        coreLen: 0.2, coreW: 0.2, sheathW: 1.7, sheathGain: 0.7, flow: 22, haze: 1, hazeLen: 8,
        core: [6.5, 8, 10], body: [0.38, 0.68, 1.5], tip: [0.22, 0.3, 1.1], sheath: [0.07, 0.18, 0.8] },
      { len: 17, wid: 1.0, flare: 0.3, diamonds: 1, dSpacing: 2.4, dDecay: 1.2, coreLen: 0.32, gain: 1.15, flow: 50, streak: 0.5,
        haze: 1.5, hazeLen: 12, body: [0.55, 0.8, 1.5] },
      { len: 46, wid: 0.85, flare: 0.12, taper: 0.45, diamonds: 0.5, dSpacing: 4.5, dDecay: 0.8, turb: 0.025, streak: 0.28,
        coreLen: 0.28, coreW: 0.14, sheathW: 1.6, gain: 0.95, flow: 90, haze: 2.1, hazeLen: 26,
        body: [0.4, 0.75, 1.3], tip: [0.2, 0.35, 1.1] },
      { len: 80, wid: 1.5, flare: 0.5, taper: 0.4, diamonds: 0.7, dSpacing: 6, dDecay: 0.5, turb: 0.04, streak: 0.55,
        coreLen: 0.32, coreW: 0.16, sheathW: 1.9, sheathGain: 0.9, gain: 1.2, flow: 200, haze: 3, hazeLen: 40,
        core: [8, 8, 10], body: [0.75, 0.7, 1.6], tip: [0.45, 0.3, 1.4], sheath: [0.25, 0.15, 1.0] },
      { len: 3.4, wid: 1.35, flare: 0.55, taper: 1.0, diamonds: 0, turb: 0.18, streak: 0.75, coreLen: 0.6, coreW: 0.5,
        gain: 1.4, flow: -16, haze: 1.6, hazeLen: 7 }
    )
  },
  {
    id: 'ares',
    nazwa: 'ARES',
    frakcja: 'Stocznie Marsjańskie',
    typ: 'dopalacz wojskowy — płaska dysza z klapami wektorowania',
    opis: 'Płaski arkusz ognia: fiolet przy wylocie, pomarańcz dalej, fale uderzeniowe w kształcie litery V. Klapy rozchylają się na dopalaczu.',
    swiatlo: [1.0, 0.55, 0.25],
    lampa: [1.0, 0.3, 0.12],
    dysze: [
      dysza(-206, 27, 13, { rw: 19, gimbal: 14, seed: 0.21 }),
      dysza(-206, -27, 13, { rw: 19, gimbal: 14, seed: 0.67 })
    ],
    struga: struga(
      { len: 11, wid: 0.92, flat: 1, flare: 0.18, taper: 0.6, diamonds: 0.7, dSpacing: 1.5, dDecay: 2.0, turb: 0.1, streak: 0.6,
        coreLen: 0.14, coreW: 0.3, coreGain: 0.25, sheathW: 1.3, sheathGain: 0.6, flow: 26, haze: 1.2, hazeLen: 8,
        core: [6, 7, 10], body: [0.55, 0.45, 1.3], tip: [1.35, 0.45, 0.08], sheath: [0.9, 0.17, 0.03] },
      { len: 18, wid: 1.1, flare: 0.25, diamonds: 1, dSpacing: 1.9, dDecay: 1.0, coreLen: 0.24, gain: 1.15, flow: 58,
        haze: 1.8, hazeLen: 13, sparks: 40 },
      { len: 48, wid: 0.8, flare: 0.06, taper: 0.45, diamonds: 0.5, dSpacing: 4, dDecay: 0.7, turb: 0.03, streak: 0.35,
        coreLen: 0.22, coreW: 0.3, gain: 0.9, flow: 95, haze: 2.2, hazeLen: 26 },
      { len: 85, wid: 1.3, flare: 0.3, taper: 0.4, diamonds: 0.9, dSpacing: 5.5, dDecay: 0.45, turb: 0.05, streak: 0.7,
        coreLen: 0.3, coreW: 0.25, coreGain: 0.3, sheathW: 1.5, sheathGain: 0.9, gain: 1.2, flow: 210, haze: 3.2, hazeLen: 42, sparks: 60,
        core: [9, 7.5, 5.5], body: [1.3, 0.75, 0.45], tip: [1.4, 0.5, 0.1], sheath: [1.0, 0.25, 0.04] },
      { len: 3.2, wid: 1.15, flare: 0.3, taper: 1.0, diamonds: 0, turb: 0.2, streak: 0.8, coreLen: 0.6, coreW: 0.7,
        gain: 1.4, flow: -14, haze: 1.6, hazeLen: 7 }
    )
  },
  {
    id: 'krios',
    nazwa: 'KRIOS',
    frakcja: 'Konsorcjum Zewnętrzne',
    typ: 'jonowy — panel siatkowy z radiatorami',
    opis: 'Szeroka, chłodna kurtyna z wiązek siatki. Mało światła, żadnych turbulencji; w warpie brzegi kurtyny jaśnieją.',
    swiatlo: [0.25, 0.95, 0.85],
    lampa: [0.2, 1.0, 0.85],
    dysze: [
      dysza(-197, 0, 15, { rw: 52, seed: 0.37 })
    ],
    struga: struga(
      { len: 15, wid: 1, flat: 1, grid: 7, flare: 0.04, taper: 0.55, diamonds: 0, turb: 0.015, streak: 0.22,
        coreLen: 0.05, coreW: 0.1, coreGain: 0, sheathW: 1.15, sheathGain: 0.5, gain: 0.85, flow: 16, haze: 0.5, hazeLen: 8,
        core: [5, 8, 8], body: [0.08, 0.72, 0.62], tip: [0.04, 0.36, 0.7], sheath: [0.02, 0.22, 0.4] },
      { len: 22, wid: 0.97, gain: 1.25, streak: 0.3, flow: 34, haze: 0.9, hazeLen: 12, body: [0.15, 1.0, 0.85] },
      { len: 52, wid: 0.9, taper: 0.4, gain: 0.85, flow: 80, streak: 0.18, haze: 1.4, hazeLen: 26,
        body: [0.1, 0.7, 0.95], tip: [0.05, 0.3, 0.9] },
      { len: 85, wid: 1.05, taper: 0.35, gain: 1.2, flow: 180, streak: 0.4, shell: 0.6, sheathW: 1.3, sheathGain: 0.9,
        haze: 2.4, hazeLen: 40, body: [0.4, 1.1, 1.2], tip: [0.15, 0.5, 1.2], sheath: [0.05, 0.35, 0.8] },
      { len: 2.6, wid: 1.02, taper: 1.0, gain: 1.9, flow: -10, streak: 0.6, haze: 1, hazeLen: 6 }
    )
  },
  {
    id: 'wulkan',
    nazwa: 'WULKAN',
    frakcja: 'Konsorcjum Wewnętrzne',
    typ: 'magnetoplazmowy — otwarta kratownica z cewkami',
    opis: 'Plazma ściśnięta polem w równe ostrze o stałej szerokości. Bez dzwonu i bez przegubu: wektorowanie polem, cewki świecą po kolei przy ładowaniu.',
    swiatlo: [1.0, 0.35, 0.95],
    lampa: [1.0, 0.4, 0.95],
    dysze: [
      dysza(-186, 27, 13, { odchyl: 8, seed: 0.29 }),
      dysza(-186, -27, 13, { odchyl: 8, seed: 0.73 })
    ],
    struga: struga(
      { len: 12, wid: 0.8, flare: 0, taper: 0.2, diamonds: 0.25, dSpacing: 3.2, dDecay: 0.6, turb: 0.02, streak: 0.25,
        coreLen: 0.5, coreW: 0.22, coreGain: 0.7, sheathW: 2.1, sheathGain: 0.8, shell: 0.15, flow: 20, haze: 0.8, hazeLen: 8,
        core: [8, 5, 8], body: [1.2, 0.16, 0.95], tip: [0.55, 0.1, 1.1], sheath: [0.32, 0.07, 0.9] },
      { len: 18, wid: 0.9, gain: 1.2, diamonds: 0.5, coreLen: 0.65, flow: 46, sheathGain: 1.0, haze: 1.3, hazeLen: 12 },
      { len: 44, wid: 0.66, taper: 0.18, diamonds: 0.3, dSpacing: 6, coreLen: 0.5, coreW: 0.18, gain: 0.9, flow: 85,
        sheathW: 2.0, haze: 1.9, hazeLen: 26 },
      { len: 75, wid: 1.25, taper: 0.22, diamonds: 0.55, dSpacing: 8, dDecay: 0.3, twist: 0.35, coreLen: 0.45, coreW: 0.18,
        sheathW: 2.2, sheathGain: 1.0, gain: 1.15, flow: 170, haze: 3, hazeLen: 40,
        body: [1.25, 0.25, 1.15], tip: [0.6, 0.15, 1.35], sheath: [0.4, 0.1, 1.05] },
      { len: 3, wid: 0.95, taper: 0.8, gain: 1.5, coreLen: 0.7, coreW: 0.5, flow: -14, streak: 0.6, haze: 1.4, hazeLen: 7 }
    )
  },
  {
    id: 'kowal',
    nazwa: 'KOWAL',
    frakcja: 'Unia Pasa',
    typ: 'impulsowy detonacyjny — gruby stożek na amortyzatorach',
    opis: 'Ciąg z serii wybuchów: struga to pociąg rozszerzających się kłębów, dysza cofa się przy każdym. Prosty, głośny, górniczy.',
    swiatlo: [1.0, 0.75, 0.3],
    lampa: [1.0, 0.7, 0.15],
    dysze: [
      dysza(-208, 30, 18, { gimbal: 5, seed: 0.19 }),
      dysza(-208, -30, 18, { gimbal: 5, ph: 0.5, seed: 0.61 })
    ],
    struga: struga(
      { len: 11, wid: 0.95, flare: 0.7, taper: 0.7, diamonds: 0, turb: 0.14, streak: 0.6, pulse: 1, pFreq: 7, pSpacing: 3.4,
        coreLen: 0.12, coreW: 0.3, coreGain: 0.7, sheathW: 1.5, sheathGain: 0.6, flow: 24, haze: 1.2, hazeLen: 8, sparks: 14,
        core: [9, 7.5, 4], body: [1.3, 0.72, 0.12], tip: [0.95, 0.3, 0.05], sheath: [0.65, 0.2, 0.03] },
      { len: 16, flare: 0.85, pFreq: 11, pSpacing: 4.2, gain: 1.2, flow: 46, coreLen: 0.18, haze: 1.9, hazeLen: 12, sparks: 60 },
      { len: 42, wid: 0.85, flare: 0.3, taper: 0.5, pulse: 0.45, pFreq: 14, pSpacing: 7, turb: 0.05, streak: 0.4,
        coreLen: 0.2, coreW: 0.2, coreGain: 0.4, gain: 0.9, flow: 90, haze: 2.2, hazeLen: 26, sparks: 10 },
      { len: 72, wid: 1.3, flare: 0.55, taper: 0.42, pulse: 0.7, pFreq: 14, pSpacing: 10, turb: 0.06, streak: 0.6,
        coreLen: 0.25, coreW: 0.2, coreGain: 0.4, gain: 1.2, flow: 180, haze: 3.2, hazeLen: 42, sparks: 80,
        core: [9, 8, 5.5], body: [1.4, 0.95, 0.3] },
      { len: 3, wid: 1.3, flare: 0.8, taper: 1.0, pulse: 0.3, pFreq: 14, gain: 1.4, flow: -14, coreLen: 0.5, coreW: 0.5,
        haze: 1.6, hazeLen: 7 }
    )
  },
  {
    id: 'szakal',
    nazwa: 'SZAKAL',
    frakcja: 'Piraci',
    typ: 'rakieta chemiczna ze złomu — trzy różne dzwony',
    opis: 'Brudny, nierówny płomień: każda dysza inna, struga przerywa i sypie iskrami. Warp na granicy rozerwania silnika.',
    swiatlo: [1.0, 0.4, 0.15],
    lampa: [1.0, 0.25, 0.08],
    dysze: [
      dysza(-207, -6, 15, { gimbal: 7, seed: 0.11 }),
      dysza(-196, 31, 9.5, { gimbal: 7, kLen: 0.8, kGain: 0.9, splay: 2, seed: 0.47 }),
      dysza(-200, -39, 11, { gimbal: 7, kLen: 1.1, splay: -1.5, seed: 0.89 })
    ],
    struga: struga(
      { len: 10, wid: 1.0, flare: 0.55, taper: 0.8, diamonds: 0.3, dSpacing: 1.7, dDecay: 3.2, turb: 0.24, streak: 0.85,
        coreLen: 0.16, coreW: 0.22, coreGain: 0.8, sheathW: 1.7, sheathGain: 0.7, flow: 22, haze: 1.3, hazeLen: 8, sputter: 0.5, sparks: 30,
        core: [8, 5, 2.2], body: [1.3, 0.32, 0.07], tip: [0.8, 0.1, 0.03], sheath: [0.55, 0.07, 0.03] },
      { len: 15, gain: 1.2, diamonds: 0.7, turb: 0.28, sputter: 0.6, flow: 44, haze: 2, hazeLen: 12, sparks: 120 },
      { len: 38, wid: 0.92, flare: 0.4, taper: 0.6, turb: 0.07, streak: 0.7, sputter: 0.3, coreLen: 0.2, coreW: 0.16, coreGain: 0.5, gain: 0.9, flow: 85,
        haze: 2.2, hazeLen: 26, sparks: 50 },
      { len: 66, wid: 1.5, flare: 0.6, taper: 0.5, turb: 0.07, streak: 0.9, sputter: 0.35, coreLen: 0.25, coreW: 0.18, coreGain: 0.5, gain: 1.2,
        flow: 170, haze: 3.2, hazeLen: 40, sparks: 220, core: [9, 6.5, 3.2], body: [1.4, 0.4, 0.1] },
      { len: 3.4, wid: 1.3, flare: 0.6, taper: 1.0, turb: 0.3, streak: 0.9, gain: 1.4, flow: -14, sputter: 0.7, sparks: 60,
        haze: 1.6, hazeLen: 7 }
    )
  }
]);

export function createPlumeState() {
  const o = {};
  for (const k of POLA_LICZB) o[k] = 0;
  for (const k of POLA_BARW) o[k] = [0, 0, 0];
  o.stretch = 1;
  return o;
}

function lerpInto(out, b, w) {
  if (!(w > 0)) return;
  const k = w > 1 ? 1 : w;
  for (let i = 0; i < POLA_LICZB.length; i++) {
    const f = POLA_LICZB[i];
    out[f] += (b[f] - out[f]) * k;
  }
  for (let i = 0; i < POLA_BARW.length; i++) {
    const f = POLA_BARW[i];
    const o = out[f];
    const c = b[f];
    o[0] += (c[0] - o[0]) * k; o[1] += (c[1] - o[1]) * k; o[2] += (c[2] - o[2]) * k;
  }
}

/** Przepływ wzoru, powyżej którego smugi się wydłużają (drobna oktawa ≤ ~¼ cechy na klatkę przy 60 kl/s). */
export const FLOW_REF = 20.5;

/**
 * Nastawy strugi w tej chwili: normal → boost → hiper → warp → ładowanie (kanały automatu), potem ciąg
 * i pchnięcie zapłonu. Bez alokacji (pisze do `out` z createPlumeState).
 */
export function blendPlume(marka, e, out) {
  const s = marka.struga;
  const n = s.normal;
  for (let i = 0; i < POLA_LICZB.length; i++) { const f = POLA_LICZB[i]; out[f] = n[f]; }
  for (let i = 0; i < POLA_BARW.length; i++) { const f = POLA_BARW[i]; const o = out[f]; const c = n[f]; o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; }
  lerpInto(out, s.boost, e.boost);
  lerpInto(out, s.hiper, e.hyper);
  lerpInto(out, s.warp, e.warp);
  lerpInto(out, s.ladowanie, e.charge);
  const thr = e.thr < 0 ? 0 : e.thr > 1 ? 1 : e.thr;
  out.len *= 0.12 + 0.88 * Math.pow(thr, 1.1);
  out.gain *= 0.35 + 0.65 * thr;
  out.haze *= 0.25 + 0.75 * thr;
  out.sparks *= thr * thr;
  const kick = e.kick;
  out.len *= 1 + 0.3 * kick;
  out.wid *= 1 + 0.12 * kick;
  out.gain *= 1 + 0.6 * kick;
  out.haze *= 1 + 0.8 * kick;
  const af = Math.abs(out.flow);
  out.stretch = af > FLOW_REF ? af / FLOW_REF : 1;
  return out;
}

export function markaById(id) {
  return MARKI.find((m) => m.id === id) || MARKI[0];
}
