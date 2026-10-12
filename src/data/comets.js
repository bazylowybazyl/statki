// src/data/comets.js
//
// KOMETY — dane (strumień B, docs/PLAN-pas-realizm.md; decyzja użytkownika 2026-10-12: „model i wdrożenie”).
// Bez importów — moduł czytają gra (src/game/comets.js), obraz (src/3d/comets/), demo i testy w Node.
//
// ORBITY w prawdziwych AU (q — peryhelium, e — mimośród) z prawdziwych komet; gra liczy położenie w AU
// MAPY przez `realAuToMapAu` (umowa planu: liniowo między sąsiednimi planetami gry — Mars 1,524 AU = 33,
// Jowisz 5,203 = 50,2). Płaszczyzna orbity = płaszczyzna gry (nachylenia nie ma), `dir` = −1 dla orbit
// wstecznych (Halley, i = 162°). `nuDeg` — anomalia prawdziwa CHWILI GRY: komety STOJĄ na swoich orbitach
// jak planety (speed 0 — uzasadnienie w src/game/comets.js), ale prędkość orbitalna wchodzi w obraz
// (zakrzywienie warkocza pyłowego, aberracja jonowego). `perihelionDeg` — długość peryhelium w grze;
// gra obraca orbitę, gdy kometa wypada przy planecie (kąty planet są losowe — `placeComets`).
//
// AKTYWNOŚĆ (komety.js: `cometActivity`): lód wody budzi się ~3 AU (realnie: sublimacja H₂O gaśnie ostro
// między 2,5 a 3,5 AU), CO / CO₂ daje słabą aktywność dalej (Hale–Bopp świecił jeszcze przy 7 AU).
// `production` = produkcja gazu przy 1 AU względem Halleya (skompresowana — Hale–Bopp realnie ~20×).
//
// JĄDRO: promień w j. gry (1 j. ≈ 1 m — Atlas ma 3 km; 67P ~4 km, Halley ~10 km, Hale–Bopp ściśnięty z 60 do
// 16 km), kształt z płatów (67P — dwuczłonowe), wypaczenie domeny, tarasy warstw (półki i urwiska jak na 67P),
// grzbiety, rumosz, kratery z wałem i jamy aktywne (źródła dżetów), albedo ~0,04 (najciemniejsze ciała Układu).
// Dżety: długość / szerokość na powierzchni (rad) — aktywne tylko po stronie dziennej (obraz liczy porę
// dnia z obrotu jądra i opóźnienia gazu).

/** Prawdziwe AU → AU mapy: węzły [AU, AU mapy] (planety gry + pas Kuipera z planu). */
export const REAL_TO_MAP_AU = Object.freeze([
  [0, 0],
  [0.387, 8.0],     // Merkury
  [0.723, 15.0],    // Wenus
  [1.0, 25.0],      // Ziemia
  [1.524, 33.0],    // Mars
  [5.203, 50.2],    // Jowisz
  [9.537, 80.58],   // Saturn
  [19.19, 100.2],   // Uran
  [30.07, 120.0],   // Neptun
  [39.48, 127.0],   // Pluton (plutonki 3:2 — plan)
  [48.0, 137.5]     // urwisko Kuipera
].map((p) => Object.freeze(p)));

/** Prawdziwe AU → AU mapy (liniowo między węzłami; za ostatnim — nachylenie ostatniego odcinka). */
export function realAuToMapAu(rAu) {
  const r = Math.max(0, Number(rAu) || 0);
  const T = REAL_TO_MAP_AU;
  for (let i = 1; i < T.length; i++) {
    if (r <= T[i][0] || i === T.length - 1) {
      const [a0, m0] = T[i - 1];
      const [a1, m1] = T[i];
      return m0 + (r - a0) * (m1 - m0) / (a1 - a0);
    }
  }
  return r;
}

/** Pochodna d(AU mapy) / d(AU) w punkcie (kierunek prędkości w AU mapy). */
export function realAuToMapSlope(rAu) {
  const r = Math.max(0, Number(rAu) || 0);
  const T = REAL_TO_MAP_AU;
  for (let i = 1; i < T.length; i++) {
    if (r <= T[i][0] || i === T.length - 1) return (T[i][1] - T[i - 1][1]) / (T[i][0] - T[i - 1][0]);
  }
  return 1;
}

/** Strojenie wspólne komet (obraz + gra). Długości w AU mapy, rozmiary w j. gry. */
export const COMET_TUNE = Object.freeze({
  // Sublimacja lodu wody: f = 1/r² · 1 / (1 + (r / waterR)^waterN) — przy 3 AU ~20% wartości bez progu, przy 4 AU ~1%.
  waterR: 2.7,
  waterN: 9,
  // CO / CO₂ (aktywność daleko od Słońca): udział × 1/r² · 1 / (1 + (r / coR)^4).
  coR: 9,
  // Poniżej tej aktywności nie ma komy ani warkoczy (samo jądro).
  minActivity: 0.004,
  // Warkocz jonowy: długość = ionLen · A^ionExp [AU mapy], szerokość u nasady i rozwarcie.
  ionLen: 2.1,
  ionExp: 0.6,
  ionWidth0: 900,
  ionSpread: 0.045,
  // Warkocz pyłowy (model synchron / syndyn — src/game/comets.js): długość widocznego warkocza (= zasięg
  // najdrobniejszego pyłu w wieku odniesienia), wiek odniesienia [doby] — z prędkością kątową orbity daje
  // zakrzywienie C, najstarszy widoczny pył w wiekach odniesienia (wachlarz do synchrony u = ageSpan),
  // βmin / βmax (najgrubszy pył), rozmycie wyrzutem (σ / L na jednostkę wieku), wykładnik kompresji jasności.
  dustLen: 1.35,
  dustExp: 0.6,
  dustAgeDays: 20,
  dustAgeSpan: 2.2,
  dustCurlGain: 1.0,
  dustBmin: 0.025,
  dustEject: 0.06,
  dustGamma: 0.62,
  // Koma: promień widocznej komy [j.] = 2 R jądra + comaR · √A (sufit comaMax) — koma dominuje głowę komety.
  comaR: 22000,
  comaMax: 60000,
  // Wiatr słoneczny [km/s] — aberracja warkocza jonowego: atan(v⊥ / vSw).
  solarWind: 400,
  // Gaz dżetów [j./s] i okres obrotu jądra [s gry] — spirale dżetów mają skok gasSpeed · okres.
  gasSpeed: 420,
  // Przyspieszenie ciśnienia promieniowania na pył dżetów [j./s²] (dżety zawracają za jądro).
  jetPush: 2.2,
  // Kolizje: koło kadłuba = szerokość × hullCircle, odbicie składowej w głąb jak olbrzymy pasa.
  hullCircle: 0.46,
  bounce: 1.3
});

/**
 * Komety gry. Kształt jądra: płaty (środek i półosie w promieniach jądra), wygładzenie złączenia,
 * chropowatość, kratery. Orientacja `tilt` [rad] — stały obrót bryły przed obrotem wokół osi z.
 */
export const COMETS = Object.freeze([
  {
    id: 'halley',
    label: 'Kometa Halleya',
    radarName: 'HALLEY',
    designation: '1P/Halley',
    family: 'halley',
    familyLabel: 'typ Halleya',
    orbit: { q: 0.586, e: 0.967, dir: -1, nuDeg: 77, perihelionDeg: 205 },
    production: 1.0,
    co: 0.08,
    nucleus: {
      radius: 4000,
      albedo: 0.04,
      rotPeriod: 260,
      tilt: [0.55, 0.3],
      lobes: [
        { c: [-0.42, 0, 0], r: [0.95, 0.62, 0.58] },
        { c: [0.48, 0.05, 0.02], r: [0.8, 0.58, 0.52] }
      ],
      blend: 0.5,
      warp: 0.2, terraces: 5, terraceAmp: 0.05, ridge: 0.04, rough: 0.035,
      craters: 14, pits: 6,
      seed: 11,
      jets: [
        { lon: 0.4, lat: 0.25, power: 1.0, width: 0.13 },
        { lon: 2.3, lat: -0.15, power: 0.7, width: 0.17 },
        { lon: 4.1, lat: 0.5, power: 0.55, width: 0.12 }
      ]
    },
    tint: { coma: [0.66, 1.0, 0.8], ion: [0.32, 0.56, 1.0], dust: [1.0, 0.86, 0.64] }
  },
  {
    id: 'hale-bopp',
    label: 'Kometa Hale’a–Boppa',
    radarName: 'HALE–BOPP',
    designation: 'C/1995 O1',
    family: 'long',
    familyLabel: 'długookresowa',
    orbit: { q: 0.914, e: 0.995, dir: 1, nuDeg: 62, perihelionDeg: 25 },
    production: 3.4,
    co: 0.3,
    nucleus: {
      radius: 8000,
      albedo: 0.04,
      rotPeriod: 340,
      tilt: [0.25, -0.4],
      lobes: [
        { c: [0, 0, 0], r: [1.0, 0.9, 0.84] },
        { c: [0.38, -0.3, 0.1], r: [0.62, 0.58, 0.55] }
      ],
      blend: 0.45,
      warp: 0.16, terraces: 4, terraceAmp: 0.045, ridge: 0.035, rough: 0.03,
      craters: 20, pits: 4,
      seed: 23,
      jets: [
        { lon: 0.2, lat: 0.1, power: 1.0, width: 0.11 },
        { lon: 1.7, lat: 0.4, power: 0.85, width: 0.14 },
        { lon: 3.2, lat: -0.3, power: 0.9, width: 0.1 },
        { lon: 4.9, lat: 0.2, power: 0.6, width: 0.16 }
      ]
    },
    tint: { coma: [0.75, 1.0, 0.82], ion: [0.3, 0.52, 1.0], dust: [1.0, 0.9, 0.72] }
  },
  {
    id: '67p',
    label: 'Kometa Czuriumowa–Gierasimienko',
    radarName: '67P',
    designation: '67P/Czuriumow–Gierasimienko',
    family: 'jupiter',
    familyLabel: 'rodzina Jowisza',
    orbit: { q: 1.243, e: 0.641, dir: 1, nuDeg: 37, perihelionDeg: 130 },
    production: 0.42,
    co: 0.05,
    nucleus: {
      radius: 2000,
      albedo: 0.05,
      rotPeriod: 180,
      tilt: [0.9, 0.2],
      // „Gumowa kaczka”: duży płat (4,1 × 3,3 × 1,8 km) i mały (2,6 × 2,3 × 1,8 km) na szyi.
      lobes: [
        { c: [-0.38, 0, 0], r: [0.92, 0.74, 0.5] },
        { c: [0.68, 0.06, 0.12], r: [0.56, 0.5, 0.44] }
      ],
      blend: 0.22,
      warp: 0.12, terraces: 7, terraceAmp: 0.055, ridge: 0.045, rough: 0.035,
      craters: 6, pits: 10,
      seed: 67,
      jets: [
        { lon: 0.0, lat: 0.35, power: 1.0, width: 0.09 },
        { lon: 2.6, lat: 0.1, power: 0.8, width: 0.12 },
        { lon: 4.4, lat: -0.25, power: 0.6, width: 0.1 }
      ]
    },
    tint: { coma: [0.7, 1.0, 0.8], ion: [0.34, 0.58, 1.0], dust: [1.0, 0.87, 0.66] }
  },
  {
    id: 'tempel-1',
    label: 'Kometa Templa 1',
    radarName: 'TEMPEL 1',
    designation: '9P/Tempel',
    family: 'jupiter',
    familyLabel: 'rodzina Jowisza',
    orbit: { q: 1.542, e: 0.51, dir: 1, nuDeg: 168, perihelionDeg: 290 },
    production: 0.3,
    co: 0.0,
    nucleus: {
      radius: 2600,
      albedo: 0.04,
      rotPeriod: 300,
      tilt: [0.4, 0.7],
      lobes: [
        { c: [0, 0, 0], r: [1.0, 0.66, 0.6] }
      ],
      blend: 0.3,
      warp: 0.12, terraces: 4, terraceAmp: 0.035, ridge: 0.03, rough: 0.03,
      craters: 18, pits: 3,
      seed: 9,
      jets: [
        { lon: 1.0, lat: 0.2, power: 0.8, width: 0.12 }
      ]
    },
    tint: { coma: [0.7, 1.0, 0.8], ion: [0.34, 0.58, 1.0], dust: [1.0, 0.86, 0.66] }
  }
].map((c) => Object.freeze(c)));

export const COMET_BY_ID = Object.freeze(Object.fromEntries(COMETS.map((c) => [c.id, c])));
