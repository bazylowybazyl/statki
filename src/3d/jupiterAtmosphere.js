// src/3d/jupiterAtmosphere.js
//
// Żywa atmosfera Jowisza — dane, pasy, wiry i zegar (strona CPU). Shader: jupiterAtmosphere.tsl.js (barwa dnia
// w grafie powierzchni planety — rodzaj 'jupiter' w planet3d.assets.tsl.js). Wpięcie: planet3d.assets.js
// (DirectPlanet.init / _spin). Wszystko to tylko uv / barwa — bryła, doba, soczewka warpa i obroty siatki bez zmian.
//
// CO SIĘ RUSZA:
//   • PASY I STREFY z prędkością wiatru strefowego (prawdziwy profil: prądy strumieniowe z Cassini, Porco et al.
//     2003 — tabela J. Rogersa, BAA; do 137 m/s na wschód, do 62 m/s na zachód, naprzemiennie);
//   • TURBULENCJA: drobne wiry (pole wirowe bez źródeł — curl3D efektów) niesione przez pas, najsilniejsze tam,
//     gdzie wiatr najszybciej zmienia się z szerokością (ścinanie na brzegach pasów);
//   • WIRY: Wielka Czerwona Plama (anticyklon półkuli płd. — obrót PRZECIWNY do wskazówek zegara, ~5,5 doby na
//     obrzeżu, środek wolniej: ruch różnicowy) i owale (białe owale pd. umiarkowanej, owal płn., brązowe „barki” —
//     cyklony NEB); ruch po elipsach (wir Kirchhoffa: kąt eliptyczny).
//
// JAK — dwie warstwy ruchu (sama mapa przepływu z dwiema fazami nie wystarcza: przenikanie faz trzyma średni
// wiek próbki stały (T/2), więc w pierwszym rzędzie obraz STOI — płynie tylko detal; spójny ruch wymaga
// nieograniczonego przesunięcia, a ono przy zmiennej prędkości narasta ścinaniem):
//   1) RUCH SZTYWNY (nieograniczony, liczony tu w double): tarcza podzielona na PASY-SEGMENTY między lokalnymi
//      minimami profilu (granice na prądach wstecznych; każdy segment ze swoim prądem wschodnim w środku — także
//      festony NEB) — segment przesuwa się w u ze średnią prędkością kątową swojego zakresu szerokości (bez ścinania
//      wewnątrz), na granicy dwa sąsiednie segmenty przenikają barwą (wąski pas, bez narastającego zwijania).
//      Wiry leżą w segmentach-PLATEAU (stała prędkość — dryf wiru, GRS −3 m/s) i obracają się sztywno po elipsie
//      (kąt w double) — wnętrze i otoczenie owalu się nie rozrywa, mapa nie ma drugiej kopii plamy;
//   2) RESZTA w shaderze z dwiema fazami przenikanymi (flow map, Vlachos 2010): prędkość prawdziwa − sztywna
//      (szybsze dżety w środku segmentu, różnicowy obrót wiru: kołnierz szybciej, wnętrze wolniej) i turbulencja —
//      płynący detal, który nie narasta (faza wraca do zera, gdy jej waga = 0).
//
// CZAS = czas GRY (SimClock.render — w pauzie i w scenach fabuły stoi) × JUPITER_ATM_TUNE.timeScale (sekund
// rzeczywistych na sekundę gry). Przy zbliżeniu tempo maleje (`zoomFollow`) — ruch na ekranie zostaje spokojny,
// a rozdwojenie faz w pikselach nie rośnie z powiększeniem (mapa 4K z bliska ma ~20 px na teksel).
//
// DANE: mapa `jupiter_cassini_color.jpg` (scripts/planety/jowisz.py z PIA07782, NASA/JPL/SSI — domena publiczna),
// szerokość PLANETOCENTRYCZNA liniowo w v (v = 1 — biegun N), u rośnie na wschód. Położenia wirów zmierzone na tej
// mapie (u jak w teksturze, nie długość System III).
//
// Od 2026-10-09 liczy to wspólny silnik gazowych olbrzymów (gasGiantAtmosphere.js — także Saturn); tu dane Jowisza,
// jego model i dawne nazwy (testy, planet3d.assets.js).
import {
  GAS_PHASE_WRAP, GAS_SEED_WRAP, GAS_VORTEX_MASK, GAS_VORTEX_VEC4, GasGiantAtmosphere, GasGiantModel, bandIndex,
  bandRecords, bandSegments, buildWindTexels, createWindTexture, phaseWeights, vortexOmega, vortexRecords, vortexRigid,
  zonalOmegaU
} from './gasGiantAtmosphere.js';

// Promienie Jowisza na poziomie 1 bar [m] (IAU): równikowy i biegunowy.
export const JUPITER_RADIUS_EQ = 71492e3;
export const JUPITER_RADIUS_POLAR = 66854e3;
const FLAT2 = (JUPITER_RADIUS_POLAR / JUPITER_RADIUS_EQ) ** 2;
const D2R = Math.PI / 180;

/** Szerokość planetograficzna → planetocentryczna [°] (tabele wiatrów są planetograficzne, mapa — planetocentryczna). */
export function jupiterCentricLat(graphicDeg) {
  return Math.atan(Math.tan(graphicDeg * D2R) * FLAT2) / D2R;
}

// Prądy strumieniowe Jowisza z Cassini (XII 2000 — ta sama epoka co mapa): [szerokość planetograficzna °, u3 m/s
// (System III, + na wschód)]. Porco et al. 2003, Science 299, 1541; wartości z tabeli J. Rogersa (BAA Jupiter
// Section, „Latitudes and speeds of jets on Jupiter”, kolumna Cassini). Na zmianę szczyty wschodnie i zachodnie.
export const JUPITER_JETS_CASSINI = Object.freeze([
  [68.7, 27.5], [64.1, 17.7], [55.9, 19.9], [47.1, 14.5], [42.8, 18.6], [39.1, -14.7], [34.9, 31.8], [31.0, -24.8],
  [23.9, 136.2], [17.1, -20.1], [6.8, 113.9], [0.3, 71.8], [-7.1, 136.9], [-19.7, -62.0], [-26.7, 48.1],
  [-32.0, -16.1], [-35.8, 34.2], [-43.0, 42.6], [-52.4, 37.9], [-60.8, 22.0], [-66.8, 33.9]
]);
// Tabela nie podaje minimów między sąsiednimi szczytami wschodnimi wysokich szerokości (|φ| > 30°) — słabe prądy
// wsteczne w połowie odstępu (przyjęte −8 m/s), a za ostatnimi szczytami wiatr gaśnie do zera (biegun). Przy
// równiku trzy wartości dodatnie z rzędu to szczyt — minimum równikowe (CEC, 72 m/s) — szczyt: bez wstawek.
export const JUPITER_WIND_FILL = Object.freeze({ retro: -8, retroFromLat: 30, poleLat: 80 });

/**
 * Ekstrema profilu w szerokości PLANETOCENTRYCZNEJ, rosnąco: [[φc °, m/s], …] — szczyty z tabeli, wstawione
 * minima wsteczne i zera przy biegunach.
 */
export function jupiterWindExtrema(jets = JUPITER_JETS_CASSINI, fill = JUPITER_WIND_FILL) {
  const pts = jets.map(([g, w]) => [jupiterCentricLat(g), w]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i - 1][1] > 0 && pts[i][1] > 0 && Math.min(Math.abs(pts[i - 1][0]), Math.abs(pts[i][0])) > fill.retroFromLat) {
      out.push([(pts[i - 1][0] + pts[i][0]) * 0.5, fill.retro]);
    }
    out.push(pts[i]);
  }
  out.unshift([-fill.poleLat, 0]);
  out.push([fill.poleLat, 0]);
  return out;
}

/**
 * Wiatr strefowy [m/s] na szerokości planetocentrycznej φc [°]: interpolacja kosinusowa między kolejnymi
 * ekstremami (zerowe nachylenie w każdym szczycie — szczyt wypada dokładnie w tabelowej szerokości), za
 * ±poleLat zero.
 */
export function jupiterZonalWind(latDeg, extrema = jupiterWindExtrema()) {
  if (latDeg <= extrema[0][0] || latDeg >= extrema[extrema.length - 1][0]) return 0;
  let i = 1;
  while (extrema[i][0] < latDeg) i++;
  const [l0, w0] = extrema[i - 1];
  const [l1, w1] = extrema[i];
  const t = (latDeg - l0) / (l1 - l0);
  return w0 + (w1 - w0) * (1 - Math.cos(Math.PI * t)) * 0.5;
}

/** Prędkość kątowa wiatru strefowego w u mapy [obwody na sekundę RZECZYWISTĄ] (cos φ — krótszy równoleżnik). */
export function jupiterZonalOmegaU(latDeg, extrema = jupiterWindExtrema()) {
  return zonalOmegaU(jupiterZonalWind(latDeg, extrema), JUPITER_RADIUS_EQ, latDeg);
}

export const JUPITER_WIND_TEXELS = 512;

/**
 * Tekstura profilu (1 wiersz, teksel i ↔ v = (i + 0,5) / N, v = 0 — biegun S): R = wiatr [m/s], G = ścinanie
 * |dw/dy| znormalizowane do 1, B = maska turbulencji (gaśnie ku biegunom), A = 1. Float32Array RGBA.
 */
export function buildJupiterWindTexels(n = JUPITER_WIND_TEXELS) {
  const ext = jupiterWindExtrema();
  return buildWindTexels((lat) => jupiterZonalWind(lat, ext), n, 55, 12);
}

/** Tekstura profilu wiatru (RGBA16F, 512 × 1, liniowa, bez mipmap). */
export function createJupiterWindTexture() {
  return createWindTexture(buildJupiterWindTexels(), JUPITER_WIND_TEXELS, 'jupiterWind');
}

// Wiry na mapie jupiter_cassini_color.jpg: środek (u w stopniach tekstury 0–360, φc °), półosie (a — stopnie u,
// b — stopnie szerokości), zwrot (+1 przeciwnie do wskazówek zegara patrząc z zewnątrz, północ w górę; −1 zgodnie),
// okres obiegu na obrzeżu [doby ziemskie], core — prędkość kątowa środka względem obrzeża, drift — dryf wiru
// względem System III [m/s] (null — z profilu na jego szerokości), rigid — obrót sztywny (spójny obrót całego
// owalu; bez niego wir tylko „płynie w miejscu” resztą z dwiema fazami). Anticyklony: półkula płd. +1, płn. −1;
// cyklony odwrotnie. GRS: ~5,5 doby na obrzeżu (Mitchell i in. 1981: ~6 dób w erze Voyagera, od tamtej pory
// szybciej), spokojniejsze wnętrze, dryf ~3 m/s na zachód; owal z zapasem na jasny kołnierz (przenikanie z tłem
// wypada na jednolitej „dziupli” wokół plamy, nie na ciemnym brzegu). Małe owale bez obrotu sztywnego: białe plamy
// bez struktury wewnątrz — obrót byłby niewidoczny, a każdy błąd dopasowania elipsy wynosiłby plamę poza maskę.
export const JUPITER_VORTICES = Object.freeze([
  Object.freeze({ id: 'GRS', u: 132.4, lat: -20.5, a: 7.9, b: 5.3, sense: 1, periodDays: 5.5, core: 0.3, drift: -3, rigid: true }),
  Object.freeze({ id: 'owal S-A', u: 55.5, lat: -37.1, a: 2.1, b: 1.15, sense: 1, periodDays: 2.6, core: 0.5, drift: null, rigid: false }),
  Object.freeze({ id: 'owal S-B', u: 72.9, lat: -37.2, a: 2.1, b: 1.15, sense: 1, periodDays: 2.6, core: 0.5, drift: null, rigid: false }),
  Object.freeze({ id: 'owal S-C', u: 87.0, lat: -37.0, a: 2.6, b: 1.25, sense: 1, periodDays: 2.8, core: 0.5, drift: null, rigid: false }),
  Object.freeze({ id: 'owal N', u: 102.5, lat: 37.0, a: 2.6, b: 1.3, sense: -1, periodDays: 2.8, core: 0.5, drift: null, rigid: false }),
  Object.freeze({ id: 'owal NEB', u: 3.5, lat: 17.0, a: 2.2, b: 1.2, sense: -1, periodDays: 2.4, core: 0.5, drift: null, rigid: false }),
  Object.freeze({ id: 'barka NEB-1', u: 14.6, lat: 13.8, a: 2.0, b: 0.9, sense: 1, periodDays: 2.2, core: 0.5, drift: null, rigid: false }),
  Object.freeze({ id: 'barka NEB-2', u: 60.5, lat: 14.5, a: 2.2, b: 1.0, sense: 1, periodDays: 2.2, core: 0.5, drift: null, rigid: false })
]);
// Rekord wiru w tablicy uniformów: 3 × vec4 (jupiterVortexRecords).
export const JUPITER_VORTEX_VEC4 = GAS_VORTEX_VEC4;
export const JUPITER_VORTEX_CAP = 8;
export const JUPITER_BAND_CAP = 48;
// Pasy: półszerokość przenikania na granicy [° szerokości], najwęższy segment, zapas plateau wiru ponad maskę
// (maska wiru gaśnie do ρ = 1,3).
export const JUPITER_BANDS = Object.freeze({ blendDeg: 0.6, minDeg: 1.8, vortexReach: 1.3, vortexPad: 0.3 });

/** Prędkość kątowa wiru na promieniu eliptycznym ρ (lustro shadera) — gasGiantAtmosphere.vortexOmega. */
export const jupiterVortexOmega = vortexOmega;
/** Obrót sztywny JĄDRA wiru (ułamek prędkości obrzeża) — gasGiantAtmosphere.vortexRigid. */
export const jupiterVortexRigid = vortexRigid;
// Maska wiru: jądro obracane sztywnie do ρ = coreIn…coreOut, cały wir (z kołnierzem) do ρ = edgeIn…edgeOut.
export const JUPITER_VORTEX_MASK = GAS_VORTEX_MASK;

/** Granice pasów Jowisza: lokalne minima profilu (prądy wsteczne, minimum równikowe), zera przy biegunach, ±90°. */
function jupiterCuts(extrema) {
  const cuts = [-90];
  for (let i = 1; i < extrema.length - 1; i++) {
    if (extrema[i][1] < extrema[i - 1][1] && extrema[i][1] < extrema[i + 1][1]) cuts.push(extrema[i][0]);
  }
  cuts.push(extrema[0][0], extrema[extrema.length - 1][0], 90);
  return cuts.sort((a, b) => a - b);
}

/**
 * Pasy-segmenty ruchu sztywnego: [{ lo, hi (φc °), omega (u na s rzeczywistą), plateau }] rosnąco, pokrywają
 * [−90°, 90°]. Granice na lokalnych minimach profilu (prądy wsteczne i minimum równikowe), segment ze średnią
 * prędkością kątową swojego zakresu; wiry w plateau ze swoim dryfem (gasGiantAtmosphere.bandSegments).
 */
export function jupiterBandSegments(extrema = jupiterWindExtrema(), vortices = JUPITER_VORTICES, cfg = JUPITER_BANDS) {
  return bandSegments({ windAt: (lat) => jupiterZonalWind(lat, extrema), cuts: jupiterCuts(extrema), radius: JUPITER_RADIUS_EQ, vortices, cfg })
    .map(({ lo, hi, omega, plateau }) => ({ lo, hi, omega, plateau }));
}

/** Indeks segmentu zawierającego szerokość φc [°]. */
export const jupiterBandIndex = bandIndex;

/** Rekordy wirów dla shadera (gasGiantAtmosphere.vortexRecords). */
export function jupiterVortexRecords(list = JUPITER_VORTICES, cap = JUPITER_VORTEX_CAP, segs = jupiterBandSegments()) {
  return vortexRecords(list, cap, segs);
}

/** Rekordy pasów dla shadera (gasGiantAtmosphere.bandRecords). */
export function jupiterBandRecords(segs = jupiterBandSegments(), cap = JUPITER_BAND_CAP) {
  return bandRecords(segs, cap, 'jupiterAtmosphere');
}

// Strojenie (window.JupiterAtmTune): czytane co klatkę.
export const JUPITER_ATM_TUNE = {
  on: 1,
  // sekund rzeczywistych na sekundę gry przy kadrze z całą tarczą (refPxPerTexel): cała tarcza — strefa
  // równikowa ~6 px/s, obrzeże GRS obiega owal w ~3 min
  timeScale: 5000,
  // okres fazy przepływu reszty [s gry]: dłuższy = dłuższa droga detalu w fazie, krótszy = mniejsze rozdwojenie
  period: 9,
  // przesunięcie faz w przestrzeni (0 — cała tarcza przenika naraz)
  desync: 0.7,
  // zachowanie kontrastu przy przenikaniu faz (0 — zwykłe mieszanie, 1 — pełna korekta wariancji)
  contrast: 0.55,
  // turbulencja: prędkość wirów [m/s] przy największym ścinaniu, dno poza ścinaniem (ułamek), okresy szumu
  // na obwód / na wysokość mapy
  eddy: 22,
  eddyFloor: 0.3,
  eddyScaleU: 14,
  eddyScaleV: 11,
  // mnożnik prędkości obrotu wirów (ponad stosunek do wiatrów: GRS ma być widocznie „wirującym okiem”)
  vortexSpeed: 1.5,
  // tempo przy zbliżeniu: ×(ref / px na teksel)^zoomFollow, gdy tarcza większa niż w kadrze odniesienia
  // (wiry: tempo^vortexZoomFollow — obrót odbiera się kątem)
  refPxPerTexel: 1.5,
  zoomFollow: 0.75,
  vortexZoomFollow: 0.3,
  // wygładzenie zmian tempa z powiększeniem [s]
  zoomLag: 0.4
};
if (typeof window !== 'undefined') window.JupiterAtmTune = JUPITER_ATM_TUNE;

// Klucze `material.uniforms` czytane przez gałąź Jowisza (po kluczach powierzchni planety).
export const JUPITER_UNIFORM_KEYS = Object.freeze({ uJupClock: 'vec4', uJupFlow: 'vec4', uJupTurb: 'vec4' });

// Okno zegara faz i ziarna — wspólne (gasGiantAtmosphere.js).
export const JUPITER_PHASE_WRAP = GAS_PHASE_WRAP;
export const JUPITER_SEED_WRAP = GAS_SEED_WRAP;

/** Wagi dwóch faz dla zegara s (lustro shadera): { f0, f1, w0, w1 }. */
export const jupiterPhaseWeights = phaseWeights;

// Model Jowisza (jeden na grę; stałe nazwy buforów — jeden kod WGSL).
const _ext = jupiterWindExtrema();
export const JUPITER_MODEL = new GasGiantModel({
  id: 'jupiterAtmosphere',
  radius: JUPITER_RADIUS_EQ,
  windAt: (lat) => jupiterZonalWind(lat, _ext),
  cuts: jupiterCuts(_ext),
  vortices: JUPITER_VORTICES,
  bands: JUPITER_BANDS,
  bandCap: JUPITER_BAND_CAP,
  vortexCap: JUPITER_VORTEX_CAP,
  windTexels: JUPITER_WIND_TEXELS,
  turbFade: [55, 12],
  texSize: [4096, 2048],
  names: { bands: 'jupiterBands', vortices: 'jupiterVortices', wind: 'jupiterWind' },
  keys: { clock: 'uJupClock', flow: 'uJupFlow', turb: 'uJupTurb' },
  tune: JUPITER_ATM_TUNE
});

export function jupiterSegments() {
  return JUPITER_MODEL.segments;
}
export function jupiterBandArray() {
  return JUPITER_MODEL.bandArray();
}
export function jupiterVortexArray() {
  return JUPITER_MODEL.vortexArray();
}

/**
 * Zegar i strojenie atmosfery Jowisza (gasGiantAtmosphere.GasGiantAtmosphere): dopisuje klucze do `uniforms`
 * planety (przed budową materiału), zawija mapę dnia w u i co klatkę (DirectPlanet._spin) przelicza z czasu gry
 * zegar faz, przesunięcia sztywne pasów i kąty wirów.
 */
export class JupiterAtmosphere extends GasGiantAtmosphere {
  constructor(planet, dayTexture) {
    super(JUPITER_MODEL, planet, dayTexture);
  }
}
