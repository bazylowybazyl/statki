// src/3d/skybake/styleMglawica.js
//
// Styl wypieku nieba „mgławica”: MGŁAWICA OBJĘTOŚCIOWA (krok 3 wypiekacza, referencje użytkownika
// 4, 6, 7, 9 i obecne tło Starkiteckt: rzeźbione kłęby oświetlone od środka, jasne brzegi od strony
// gwiazd, ciemny pył z przodu z ostrą krawędzią, świecące jądra, barwne obrzeża). Prawdziwa objętość
// 3D w płycie z ∈ ±grubość (jednostki nieba, x ∈ ±0,8, y ∈ ±0,5, y w dół; kamera patrzy z +z
// ortogonalnie), gęstość proceduralna (obwiednia mas → masy o niskiej częstotliwości z zawinięciem
// domeny → kłęby |szum| → erozja brzegów), marsz promienia, emisja (Hα, O III — jonizacja od gorących
// gwiazd), rozpraszanie z SAMOCIENIEM od 1–8 gwiazd (objętość światła w atlasie + cień bliski
// z detalu), faza Henyeya–Greensteina, przybliżenie rozpraszania wielokrotnego, ciemny pył z przodu.
// Wzór marszu: src/3d/gas/gasVolume.js (tam co klatkę dla dymu; tu raz, większym budżetem).
//
// Passy SkyBaker (skyBaker.js):
//   zasieg   — (½ rozdzielczości) zakres t ∈ [0, 1] wzdłuż z, w którym gęstość zgrubna > 0, i jej
//              maksima (gaz, pył): marsz główny liczy tylko ten odcinek, puste piksele nic;
//   swiatlo1 / swiatlo2 — (½) ATLAS OBJĘTOŚCI ŚWIATŁA: 8 × 8 kafli = 64 przekroje z, w kanałach
//              RGBA przepuszczalność z woksela do gwiazd 0–3 / 4–7 (marsz zgrubny do gwiazdy);
//   objetosc — (pełna, w 8 pasach) marsz główny: (barwa radiancji, przepuszczalność T);
//   gwiazdy  — pole gwiazd (skyBakeStars.js): gwiazdy TŁA gasną za płytą z poczerwienieniem;
//   obraz    — tło (głębia, mgiełka 2D), objętość, gwiazdy, gwiazdy-lampy (jądro, halo, kolce — za
//              pyłem z przodu) → wywołanie (ekspozycja, asinh, nasycenie, czerń, cienie, ramię) → Dl.
//
// Kompozycja pod grę: kadr gry widzi ~0,35 × 0,19 jednostki w ŚRODKU, menu ~0,7 × 0,42, kamery 3D
// całość — główna masa przy środku, reszta czarna z gwiazdami; gaz pod progiem bloomu (biel ≤ 0,8),
// wyżej tylko gwiazdy. Parametry = uniformy (zmiana bez przebudowy grafu); ziarno przesuwa szumy i
// losuje masy, gwiazdy-lampy i gromady na CPU (skyHashCpu).
import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, abs, clamp, dot, exp, float, int, ivec2, log, max, min, mix, pow, saturate,
  select, smoothstep, sqrt, step, uint, uniform, uniformArray, vec2, vec3, vec4
} from 'three/tsl';
import { skyBillow3, skyFbm, skyFbm3, skyHash, skyHashCpu, skyNoise3 } from './skyBakeNoise.js';
import { starFieldNode } from './skyBakeStars.js';

const DEG = Math.PI / 180;
const LUMA = vec3(0.2126, 0.7152, 0.0722);

/** Parametry stylu: [klucz, etykieta, min, max, krok, domyślna, grupa]. Jednostki geometrii — jednostki nieba. */
export const MGLAWICA_PARAMS = Object.freeze([
  ['srodekX', 'masa główna: x', -0.5, 0.5, 0.005, 0.12, 'kompozycja'],
  ['srodekY', 'masa główna: y', -0.35, 0.35, 0.005, -0.05, 'kompozycja'],
  ['rozmiar', 'masa główna: promień', 0.06, 0.8, 0.005, 0.3, 'kompozycja'],
  ['wydluzenie', 'wydłużenie', 1, 3, 0.02, 1.5, 'kompozycja'],
  ['kat', 'kąt [°]', -90, 90, 1, 28, 'kompozycja'],
  ['masyLiczba', 'masy dodatkowe (liczba)', 0, 6, 1, 3, 'kompozycja'],
  ['masyRozmiar', 'masy dodatkowe: promień', 0.2, 1.5, 0.01, 0.65, 'kompozycja'],
  ['zasiegMasy', 'obwiednia: zwartość', 0.4, 4, 0.02, 1.6, 'kompozycja'],
  ['grubosc', 'grubość płyty (± z)', 0.1, 1, 0.01, 0.45, 'kompozycja'],
  ['gestosc', 'gaz: gęstość optyczna', 0, 100, 0.1, 50, 'gaz'],
  ['prog', 'gaz: próg masy', 0, 0.9, 0.005, 0.58, 'gaz'],
  ['miekkosc', 'gaz: miękkość progu', 0.02, 0.6, 0.005, 0.12, 'gaz'],
  ['skala', 'gaz: skala mas', 1, 20, 0.1, 6, 'gaz'],
  ['plaskosc', 'spłaszczenie wzdłuż z (arkusze)', 0.05, 1, 0.01, 0.4, 'gaz'],
  ['zawiniecie', 'zawinięcie domeny', 0, 1.5, 0.01, 0.5, 'gaz'],
  ['zyly', 'żyły (włókna przez masę)', 0, 1, 0.01, 0.5, 'gaz'],
  ['kleby', 'kłęby (|szum|)', 0, 1, 0.01, 0.85, 'gaz'],
  ['klebyCz', 'kłęby: skala', 1, 12, 0.05, 5, 'gaz'],
  ['klebyDetal', 'kłęby: udział drobnych oktaw', 0.4, 0.8, 0.01, 0.66, 'gaz'],
  ['erozja', 'erozja detalem (remap)', 0, 0.95, 0.01, 0.45, 'gaz'],
  ['wlokna', 'włókna (grzbiety zamiast kłębów)', 0, 1, 0.01, 0.35, 'gaz'],
  ['erozjaCz', 'erozja: skala', 2, 24, 0.1, 11, 'gaz'],
  ['pylGestosc', 'pył: gęstość optyczna', 0, 80, 0.5, 12, 'pył'],
  ['pylUdzial', 'pył: udział', 0, 1, 0.01, 0.7, 'pył'],
  ['pylProg', 'pył: próg', 0.3, 0.98, 0.005, 0.84, 'pył'],
  ['pylMiekk', 'pył: miękkość krawędzi', 0.005, 0.3, 0.005, 0.04, 'pył'],
  ['pylSkala', 'pył: skala', 1, 20, 0.1, 7, 'pył'],
  ['pylZyly', 'pył: żyły (grzbiety) zamiast plam', 0, 1, 0.01, 0.85, 'pył'],
  ['pylPrzod', 'pył: położenie z (0 tył, 1 przód)', 0, 1, 0.01, 0.62, 'pył'],
  ['pylZasieg', 'pył: zasięg poza gaz', 0.8, 2, 0.01, 1.25, 'pył'],
  ['pylKleby', 'pył: kłęby', 0, 1, 0.01, 0.5, 'pył'],
  ['pylErozja', 'pył: erozja detalem', 0, 0.95, 0.01, 0.35, 'pył'],
  ['gwiazdLiczba', 'gwiazdy-lampy (liczba)', 1, 8, 1, 4, 'światło'],
  ['jasnosc', 'lampy: jasność (światło w gazie)', 0, 2, 0.005, 0.1, 'światło'],
  ['zasiegSwiatla', 'lampy: zmiękczenie (promień)', 0.01, 0.3, 0.005, 0.1, 'światło'],
  ['gwiazdCieplo', 'lampy: ciepło barwy', 0, 1, 0.01, 0.25, 'światło'],
  ['faza', 'faza HG (g, płat przedni)', -0.5, 0.9, 0.01, 0.5, 'światło'],
  ['lampyPrzod', 'lampy: położenie z (0 w płycie, 1 przed)', 0, 1, 0.01, 0.7, 'światło'],
  ['wielokrotne', 'rozpraszanie wielokrotne', 0, 1, 0.01, 0.1, 'światło'],
  ['otoczenie', 'światło otoczenia', 0, 0.3, 0.002, 0.03, 'światło'],
  ['ha', 'emisja Hα', 0, 4, 0.02, 1.6, 'światło'],
  ['oiii', 'emisja O III', 0, 4, 0.02, 0.6, 'światło'],
  ['jonizacja', 'jonizacja (zasięg frontu emisji)', 0, 10, 0.01, 0.3, 'światło'],
  ['emisjaZewn', 'emisja zewnętrzna (słaba jonizacja)', 0, 4, 0.02, 0, 'światło'],
  ['lampyPaleta', 'lampy: barwy z palety (udział)', 0, 1, 0.01, 0, 'światło'],
  ['cienBliski', 'cień bliski (próbki)', 0, 6, 1, 4, 'światło'],
  ['cienBliskiZasieg', 'cień bliski: zasięg', 0.005, 0.3, 0.001, 0.03, 'światło'],
  ['cienDaleki', 'cień daleki (siła)', 0, 3, 0.02, 1.0, 'światło'],
  ['cienKroki', 'cień daleki: kroki', 4, 48, 1, 20, 'światło'],
  ['kroki', 'marsz: kroki', 32, 256, 1, 96, 'marsz'],
  ['drganie', 'marsz: drganie startu', 0, 1, 0.01, 1.0, 'marsz'],
  ['gwiazdy', 'gwiazdy: jasność (0 — gra rysuje własne)', 0, 4, 0.02, 0, 'gwiazdy'],
  ['gwiazdyGestosc', 'gwiazdy: gęstość', 0, 3, 0.02, 1.0, 'gwiazdy'],
  ['gwiazdyTlo', 'gwiazdy: tło', 0, 1, 0.01, 0.12, 'gwiazdy'],
  ['gwiazdyJasne', 'jasne gwiazdy', 0, 4, 0.02, 1.0, 'gwiazdy'],
  ['gwiazdyPrzod', 'gwiazdy przed płytą', 0, 1, 0.01, 0.15, 'gwiazdy'],
  ['gwiazdyCieplo', 'gwiazdy: ciepło barw', 0, 1, 0.01, 0.3, 'gwiazdy'],
  ['gromady', 'gromady przy lampach (liczba)', 0, 8, 1, 0, 'gwiazdy'],
  ['blask', 'lampy: blask (jądro, halo)', 0, 4, 0.02, 0.6, 'gwiazdy'],
  ['kolce', 'lampy: kolce', 0, 2, 0.02, 0.6, 'gwiazdy'],
  ['mgielka', 'mgiełka tła', 0, 1, 0.01, 0.06, 'barwa'],
  ['masyBarwy', 'masy: odcień emisji z palety (udział)', 0, 1, 0.01, 0, 'barwa'],
  ['ekspozycja', 'ekspozycja', 0.002, 1, 0.001, 0.025, 'wywołanie'],
  ['rozciagniecie', 'rozciągnięcie (asinh)', 0.5, 40, 0.1, 1.8, 'wywołanie'],
  ['nasycenie', 'nasycenie', 0, 2.5, 0.02, 1.6, 'wywołanie'],
  ['czern', 'punkt czerni', 0, 0.05, 0.0005, 0.0, 'wywołanie'],
  ['kolano', 'kolano ramienia', 0.1, 0.78, 0.01, 0.5, 'wywołanie'],
  ['biel', 'biel (≤ 0,80)', 0.2, 0.8, 0.01, 0.8, 'wywołanie']
]);

/** Barwy (liniowo): [klucz, etykieta, domyślna]. */
export const MGLAWICA_COLORS = Object.freeze([
  ['barwaHa', 'emisja Hα', [1.0, 0.26, 0.4]],
  ['barwaOiii', 'emisja O III', [0.3, 0.85, 0.95]],
  ['barwaZewn', 'emisja zewnętrzna (brzeg)', [0.35, 0.3, 1.0]],
  ['paleta1', 'paleta: 1 (lampy, masy)', [0.3, 0.9, 1.0]],
  ['paleta2', 'paleta: 2', [1.0, 0.35, 0.85]],
  ['paleta3', 'paleta: 3', [1.0, 0.62, 0.25]],
  ['paleta4', 'paleta: 4', [0.55, 0.4, 1.0]],
  ['barwaGazu', 'gaz: albedo (odbicie)', [0.45, 0.72, 1.0]],
  ['barwaPylu', 'pył: albedo', [0.06, 0.045, 0.035]],
  ['barwaOtoczenia', 'światło otoczenia', [0.35, 0.45, 0.7]],
  ['barwaTla', 'tło (głębia)', [0.0008, 0.001, 0.002]],
  ['barwaMgielki', 'mgiełka tła', [0.12, 0.2, 0.3]],
  ['barwaLampZimna', 'lampy: barwa zimna', [0.72, 0.82, 1.0]],
  ['barwaLampCiepla', 'lampy: barwa ciepła', [1.0, 0.86, 0.62]],
  ['uniesienie', 'cienie (uniesienie, obraz)', [0.0004, 0.0006, 0.0014]],
  ['poczerwienienie', 'pył: pochłanianie R G B', [0.8, 1.0, 1.25]]
]);

export const MGLAWICA_DEFAULTS = Object.freeze(Object.fromEntries([
  ...MGLAWICA_PARAMS.map((p) => [p[0], p[5]]),
  ...MGLAWICA_COLORS.map((c) => [c[0], [...c[2]]])
]));

/** Gotowe nastawy (nadpisują domyślne). „gra” — pod rozgrywkę; reszta — w duchu referencji 4, 6, 7, 9. */
export const MGLAWICA_PRESETS = Object.freeze({
  // Pod rozgrywkę (jak obecne tło): błękit i cyjan na brzegach kłębów, magenta w jądrach, dużo czerni.
  gra: {
    // Jak obecne tło: głęboka czerń, gęste ciemne kłęby oświetlone OD ŚRODKA (lampy w płycie, szum izotropowy —
    // światło przebija cienkie limby), cyjanowe światło krawędziowe, magenta w jądrach. BEZ pola gwiazd: materiał
    // mgławicy gry dokłada gwiazdy w rozdzielczości ekranu (skyStars.tsl.js) i StarSystem — tekstura niesie same
    // gładkie warstwy (dywan z tekstury dwoił obraz i szarzył kadr, zrzuty niebo-gra.mjs 2026-10-06).
    jonizacja: 0.22, ha: 1.3, srodekX: 0.18, rozmiar: 0.27,
    barwaLampZimna: [0.55, 0.8, 1.0], barwaGazu: [0.4, 0.75, 1.0], lampyPrzod: 0.15, plaskosc: 0.8, faza: 0.6,
    gestosc: 60, jasnosc: 0.14, wielokrotne: 0.06, otoczenie: 0.012
  },
  // Ref. 7: rozeta — różowe jądro z turkusowym O III na tle turkusowej mgiełki, ciemne żyły pyłu.
  rozeta: {
    ha: 1.6, oiii: 1.1, jonizacja: 0.45, mgielka: 0.7, barwaMgielki: [0.1, 0.32, 0.34], barwaTla: [0.004, 0.009, 0.011],
    barwaGazu: [0.6, 0.85, 0.95], gwiazdLiczba: 6, jasnosc: 0.08, rozmiar: 0.34, wydluzenie: 1.15, nasycenie: 1.45,
    ekspozycja: 0.02, pylUdzial: 0.8, gestosc: 40, lampyPrzod: 0.3, uniesienie: [0.0008, 0.0016, 0.002]
  },
  // Ref. 9: filary — złoto i pomarańcz oświetlone od góry, turkusowe tło, gromady gwiazd.
  filary: {
    barwaHa: [1.0, 0.55, 0.16], barwaOiii: [1.0, 0.8, 0.4], barwaGazu: [1.0, 0.78, 0.5], barwaPylu: [0.5, 0.3, 0.14],
    barwaMgielki: [0.12, 0.3, 0.28], mgielka: 0.4, ha: 1.8, oiii: 0.5, jonizacja: 0.4, gwiazdLiczba: 5, jasnosc: 0.1,
    gwiazdCieplo: 0.6, wydluzenie: 2.2, kat: 70, erozja: 0.6, kleby: 0.8, wlokna: 0.5, ekspozycja: 0.018, nasycenie: 1.3,
    gestosc: 45, lampyPrzod: 0.5, uniesienie: [0.0006, 0.0012, 0.0012]
  },
  // Ref. 6: pyłowa — brązowe kłęby pyłu w świetle błękitnych gwiazd z dużymi halo, różowy obłok H II.
  pylowa: {
    pylUdzial: 1.0, pylGestosc: 18, pylPrzod: 0.5, pylMiekk: 0.1, barwaPylu: [0.5, 0.38, 0.28], barwaGazu: [0.7, 0.72, 0.8],
    ha: 0.7, oiii: 0.2, gwiazdLiczba: 3, jasnosc: 0.12, gwiazdCieplo: 0.1, blask: 1.2, kolce: 0.9,
    mgielka: 0.1, gestosc: 30, ekspozycja: 0.02, nasycenie: 1.1, otoczenie: 0.03, lampyPrzod: 0.5
  },
  // Kolorowa (prośba użytkownika 2026-10-06: „bardziej kolorowa”): lampy w czterech barwach palety (cyjan, magenta,
  // pomarańcz, fiolet) — gaz wokół każdej świeci inaczej; emisja per masa w odcieniu palety; trzy pasma emisji
  // (O III przy gwiazdach, Hα dalej, fioletowo-błękitny brzeg przy słabej jonizacji); albedo gazu neutralne, żeby
  // barwy lamp nie ginęły w błękicie.
  kolorowa: {
    lampyPaleta: 1.0, masyBarwy: 0.85, emisjaZewn: 1.6, ha: 1.9, oiii: 1.5, jonizacja: 0.42,
    barwaHa: [1.0, 0.28, 0.42], barwaOiii: [0.2, 1.0, 0.8], barwaZewn: [0.35, 0.3, 1.0],
    barwaGazu: [0.78, 0.78, 0.8], barwaMgielki: [0.3, 0.14, 0.4], mgielka: 0.08,
    gwiazdLiczba: 7, masyLiczba: 4, rozmiar: 0.26, wydluzenie: 1.6, kat: 20, masyRozmiar: 0.55, srodekX: 0.2, srodekY: -0.04,
    // Ekspozycja niżej niż w `gra`: rozproszone światło lamp dochodziło do kolana (różowo-biały wypał bez barwy).
    prog: 0.62, erozja: 0.6, gestosc: 45, jasnosc: 0.15, lampyPrzod: 0.25, plaskosc: 0.6, faza: 0.55,
    wielokrotne: 0.12, otoczenie: 0.015, ekspozycja: 0.023, nasycenie: 1.9, uniesienie: [0.0008, 0.0006, 0.0016]
  },
  // Ref. 4: fiolet — magenta i fiolet ze świecącymi rdzeniami, błękit po jednej stronie, pył z przodu.
  fiolet: {
    barwaHa: [1.0, 0.3, 0.75], barwaOiii: [0.45, 0.5, 1.0], barwaGazu: [0.6, 0.5, 1.0], barwaMgielki: [0.2, 0.12, 0.36],
    mgielka: 0.35, ha: 1.5, oiii: 0.9, jonizacja: 0.4, gwiazdLiczba: 5, jasnosc: 0.08, wydluzenie: 2.0, kat: 10,
    rozmiar: 0.36, masyLiczba: 4, nasycenie: 1.4, ekspozycja: 0.02, pylUdzial: 0.7, gestosc: 40, lampyPrzod: 0.3,
    uniesienie: [0.0012, 0.0006, 0.0024]
  }
});

const MAX_LAMPS = 8;
const MAX_MASSES = 7;
/** Radiancja objętości → jednostki pola gwiazd (strumień siatek: ziarno 0,6–5, jasne do 1000; ekspozycja ~0,03). */
const RADIANCE_GAIN = 4.0;
/** Emisja (Hα, O III) względem rozpraszania — przy `ha` = 1 jądra świecą wyraźnie. */
const EMISSION_GAIN = 8.0;
/** Cień DALEKI (atlas) liczy gęstość ZGRUBNĄ (bez detalu), ~2× większą od gęstości po remapie — korekta. */
const SHADOW_DETAIL_MEAN = 0.6;
/** Mgiełka tła (2D) i gwiazdy-lampy w jednostkach pola gwiazd (jak RADIANCE_GAIN dla objętości). */
const HAZE_GAIN = 12.0;
const LAMP_GAIN = 2000.0;
/** Atlas objętości światła: 8 × 8 kafli (64 przekroje z), zasięg × 1,15 kadru, ½ rozdzielczości wypieku. */
const ATLAS = Object.freeze({ tx: 8, ty: 8, nz: 64, ext: 1.15, size: 0.5 });
const ZASIEG_SIZE = 0.5;
const ZASIEG_STEPS = 48;
const STRIPS = 8;

/** RNG CPU z ziarna (lowbias32 po liczniku). */
function cpuRand(seed, salt) {
  let n = 0;
  return () => skyHashCpu(seed >>> 0, salt >>> 0, (n++) >>> 0);
}

/** Rozmiar celu o ułamku `s` — jak SkyBaker.passSize. */
function passSize(baker, s) {
  const w = baker?.width || 5120;
  const h = baker?.height || Math.round(w * 0.625);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export function createMglawicaStyle() {
  const U = {};
  for (const [k, , , , , def] of MGLAWICA_PARAMS) U[k] = uniform(def);
  for (const [k, , def] of MGLAWICA_COLORS) U[k] = uniform(new THREE.Vector3(...def));
  for (let i = 1; i <= 4; i++) U[`o${i}`] = uniform(new THREE.Vector3());
  U.o5 = uniform(new THREE.Vector2());
  U.seed = uniform(1, 'int');
  U.resScale = uniform(1);
  // Dodatkowe oktawy detalu (kafle w gęstości > 1: kłęby, erozja, pył, żyły) — z wypiekacza (`extraOctaves`).
  U.dodOkt = uniform(0, 'int');
  U.atlasSize = uniform(new THREE.Vector2(2560, 1600));
  U.lampCount = uniform(0, 'int');
  U.lampPos = uniformArray(Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()), 'vec4');   // x, y, z, zmiękczenie
  U.lampCol = uniformArray(Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()), 'vec4');   // r, g, b, natężenie względne (× jasnosc)
  U.masyCount = uniform(0, 'int');
  U.masyA = uniformArray(Array.from({ length: MAX_MASSES }, () => new THREE.Vector4()), 'vec4');    // x, y, promień, waga
  U.masyB = uniformArray(Array.from({ length: MAX_MASSES }, () => new THREE.Vector4()), 'vec4');    // wydłużenie u, v, cos, sin
  U.masyC = uniformArray(Array.from({ length: MAX_MASSES }, () => new THREE.Vector4()), 'vec4');    // odcień emisji rgb (paleta), —

  const SPAN = vec2(1.6 * ATLAS.ext, 1.0 * ATLAS.ext);

  // ── obwiednia mas (suma gaussów elips; zTerm — człon z, już podzielony przez grubość) ──────────
  // withTint — dodatkowo średni odcień emisji mas ważony ich udziałem (nastawa „kolorowa”: masy w barwach palety).
  const envelope = (pxy, zTerm, radiusMul, withTint = false) => {
    const env = float(0).toVar();
    const tint = withTint ? vec3(0).toVar() : null;
    Loop({ start: 0, end: U.masyCount, type: 'int', condition: '<', name: 'mk' }, ({ mk }) => {
      const A = U.masyA.element(mk);
      const B = U.masyB.element(mk);
      const rel = pxy.sub(A.xy);
      const u = rel.x.mul(B.z).add(rel.y.mul(B.w));
      const v = rel.y.mul(B.z).sub(rel.x.mul(B.w));
      const R = A.z.mul(radiusMul);
      const ru = u.div(R.mul(B.x));
      const rv = v.div(R.mul(B.y));
      const r2 = ru.mul(ru).add(rv.mul(rv)).add(zTerm);
      const g = exp(r2.negate().mul(U.zasiegMasy)).mul(A.w);
      env.addAssign(g);
      if (withTint) tint.addAssign(U.masyC.element(mk).xyz.mul(g));
    });
    if (!withTint) return env.min(1.5);
    return { env: env.min(1.5), tint: tint.div(max(env, 1e-5)) };
  };

  // ── gęstość zgrubna (masy + pył), zawinięcie domeny raz na próbkę ────────────────────────────
  const coarse = (P, wIn, oct = 3) => {
    const q = P.mul(vec3(U.skala, U.skala, U.skala.mul(U.plaskosc))).add(U.o1).toVar();
    const w = wIn || vec3(
      skyNoise3(q.mul(0.45).add(vec3(31.7, 11.3, 7.9))),
      skyNoise3(q.mul(0.45).add(vec3(5.1, 47.3, 19.1))),
      skyNoise3(q.mul(0.45).add(vec3(17.9, 3.3, 41.7)))
    ).mul(U.zawiniecie).toVar();
    const qs = q.add(w).toVar();
    const shape = skyFbm3(qs, int(oct >= 3 ? 5 : oct), 2.0, 0.5).mul(0.5).add(0.5).toVar();
    // Żyły: grzbiety na zerach drugiego fbm — cienkie włókna przez masę i poza jej progiem (tylko pełna jakość).
    if (oct >= 3) {
      const veins = smoothstep(0.62, 0.97, float(1.0).sub(abs(skyFbm3(qs.mul(1.3).add(vec3(7.1, 2.3, 5.9)), int(3).add(U.dodOkt), 2.0, 0.5))));
      shape.addAssign(veins.mul(U.zyly).mul(0.5).mul(smoothstep(0.0, 0.6, shape)));
    }
    const zt = P.z.div(U.grubosc.mul(0.85));
    // Obwiednia OGRANICZA zasięg (mnoży kształt przed progiem) — krawędź masy zostaje ostra, nie gaussowska.
    const envT = envelope(P.xy, zt.mul(zt), float(1.0), oct >= 3);
    const envG = pow((oct >= 3 ? envT.env : envT).min(1.0), 0.3);
    const mass = smoothstep(U.prog, U.prog.add(U.miekkosc), shape.mul(envG)).toVar();
    // Odcień emisji w tym punkcie (paleta mas × udział `masyBarwy`); poza pełną jakością — biały.
    const tint = oct >= 3 ? mix(vec3(1.0), envT.tint, U.masyBarwy) : vec3(1.0);
    // Pył: kolumna (obwiednia bez z, szerszy zasięg) skupiona przy zadanym z (0 tył … 1 przód), ostra krawędź.
    const qd = P.mul(vec3(U.pylSkala, U.pylSkala, U.pylSkala.mul(U.plaskosc))).add(U.o2).add(w.mul(0.7));
    const dn = skyFbm3(qd, oct >= 3 ? int(4).add(U.dodOkt) : int(oct), 2.0, 0.55);
    // Pył: plamy (fbm) albo cienkie żyły (grzbiety 1 − |fbm| — ciemne pasma pyłu o ostrych brzegach);
    // szerokość żył zmienna w dużej skali (grube kłęby i cienkie nitki).
    const dw = skyNoise3(qd.mul(0.35).add(vec3(2.7, 9.1, 4.4))).mul(0.5).add(0.5);
    const dshape = mix(dn.mul(0.5).add(0.5), float(1.0).sub(abs(dn)), U.pylZyly).mul(dw.mul(0.5).add(0.75));
    const zf = P.z.div(U.grubosc);
    const zc = U.pylPrzod.mul(2.0).sub(1.0);
    const frontK = smoothstep(zc.sub(0.32), zc.sub(0.08), zf).mul(float(1.0).sub(smoothstep(zc.add(0.08), zc.add(0.32), zf)));
    const envD = pow(envelope(P.xy, float(0.0), U.pylZasieg).min(1.0), 0.3);
    const dust = smoothstep(U.pylProg, U.pylProg.add(U.pylMiekk), dshape.mul(envD).mul(frontK)).mul(U.pylUdzial).toVar();
    return { mass, dust, w, qs, tint };
  };

  // Gęstość optyczna do cienia bliskiego: zgrubna 2 oktawy (zawinięcie z próbki głównej) + kłęby 3 oktawy
  // z remapem — cień w skali kłębów (relief), bez drobnej erozji.
  const shadowSigma = (P, w) => {
    const c = coarse(P, w, 2);
    const d = detail(c, 3, false);
    return d.gas.mul(U.gestosc).add(d.dust.mul(U.pylGestosc));
  };

  // ── detal: kłęby |szum| i erozja brzegów ──────────────────────────────────────────────────────
  const detail = (c, octK = 5, fine = true) => {
    // Pełny detal (marsz główny) dostaje dodatkowe oktawy kafla; cień bliski (3 oktawy, bez erozji) nie.
    const k = skyBillow3(c.qs.mul(U.klebyCz).add(U.o3), fine ? int(octK).add(U.dodOkt) : int(octK), 2.05, U.klebyDetal).toVar();
    const e = fine ? skyBillow3(c.qs.mul(U.erozjaCz).add(U.o4), int(3).add(U.dodOkt), 2.1, 0.55).toVar() : float(0.6);
    // Kłęby (|szum|, kalafior) albo włókna (grzbiety 1 − |szum|) — udział `wlokna`.
    const kk = mix(k, max(float(1.0).sub(k.mul(0.62)), 0.0), U.wlokna).toVar();
    const kd = saturate(kk.mul(0.75)).toVar();
    // Remap: dolny próg masy rośnie tam, gdzie detal jest niski — detal rzeźbi masę wszędzie (brzegi strzępiaste,
    // wnętrze kłębiaste), potem drobna erozja cienkich resztek.
    const remap = (m, ero, mulK) => {
      const lo = ero.mul(float(1.0).sub(kd));
      const v = saturate(m.sub(lo).div(max(float(1.0).sub(lo), 0.05))).mul(mix(float(1.0), kk.mul(1.15), mulK))
        .mul(mix(float(1.0), e.mul(1.3), 0.35));
      return max(v.sub(ero.mul(0.5).mul(float(1.0).sub(e)).mul(float(1.0).sub(saturate(v.mul(2.0))))), 0.0);
    };
    const gas = remap(c.mass, U.erozja, U.kleby);
    const dust = remap(c.dust, U.pylErozja, U.pylKleby);
    return { gas, dust };
  };

  // ── atlas objętości światła: adresowanie ──────────────────────────────────────────────────────
  const tileSize = () => U.atlasSize.div(vec2(ATLAS.tx, ATLAS.ty));
  /** Próbka atlasu (vec4 — 4 gwiazdy) w punkcie P: dwuliniowo w przekroju, liniowo między przekrojami. */
  const atlasAt = (ctx, name, P) => {
    const ts = tileSize().toVar();
    const kf = clamp(float(1.0).sub(P.z.div(U.grubosc)).mul(0.5 * ATLAS.nz).sub(0.5), 0.0, ATLAS.nz - 1).toVar();
    const k0 = kf.floor().toVar();
    const k1 = min(k0.add(1.0), ATLAS.nz - 1);
    const fz = kf.sub(k0);
    const loc = clamp(P.xy.div(SPAN).add(0.5).mul(ts), vec2(0.5), ts.sub(0.5)).toVar();
    const uvOf = (k) => {
      const ty = k.div(ATLAS.tx).floor();
      const tx = k.sub(ty.mul(ATLAS.tx));
      return vec2(tx, ty).mul(ts).add(loc).div(U.atlasSize);
    };
    return mix(ctx.sample(name, uvOf(k0)), ctx.sample(name, uvOf(k1)), fz);
  };

  // ── pass 1: zasieg (½): odcinek t ∈ [0, 1] z gęstością zgrubną > 0 ────────────────────────────
  const zasiegNode = (ctx) => Fn(() => {
    // Cel ½: ctx.px to już piksel pełnego nieba (środek piksela ½ przeliczony przez wypiekacz).
    const p = ctx.sky().toVar();
    const tA = float(2.0).toVar();
    const tB = float(-1.0).toVar();
    const mx = float(0.0).toVar();
    const md = float(0.0).toVar();
    const dt = 1.0 / ZASIEG_STEPS;
    Loop({ start: 0, end: ZASIEG_STEPS, type: 'int', condition: '<', name: 'zs' }, ({ zs }) => {
      const t = float(zs).add(0.5).mul(dt);
      const z = U.grubosc.mul(float(1.0).sub(t.mul(2.0)));
      const c = coarse(vec3(p, z), null);
      If(c.mass.add(c.dust).greaterThan(0.002), () => {
        tA.assign(min(tA, t));
        tB.assign(max(tB, t));
        mx.assign(max(mx, c.mass));
        md.assign(max(md, c.dust));
      });
    });
    const ok = tB.greaterThanEqual(tA);
    return select(ok, vec4(max(tA.sub(dt * 1.5), 0.0), min(tB.add(dt * 1.5), 1.0), mx, md), vec4(0.0));
  })();

  // ── pass 2 / 3: atlas objętości światła (gwiazdy base … base + 3) ────────────────────────────
  const swiatloNode = (base) => (ctx) => Fn(() => {
    const ts = tileSize().toVar();
    const px = ctx.px.toVar();
    const tx = px.x.div(ts.x).floor();
    const ty = px.y.div(ts.y).floor();
    const k = ty.mul(ATLAS.tx).add(tx);
    const loc = px.sub(vec2(tx, ty).mul(ts));
    const P = vec3(loc.div(ts).sub(0.5).mul(SPAN), U.grubosc.mul(float(1.0).sub(k.add(0.5).mul(2.0 / ATLAS.nz)))).toVar();
    const T = [0, 1, 2, 3].map(() => float(1.0).toVar());
    for (let j = 0; j < 4; j++) {
      const i = base + j;
      If(U.lampCount.greaterThan(int(i)), () => {
        const L = U.lampPos.element(int(i));
        const dv = L.xyz.sub(P);
        const dist = max(sqrt(dot(dv, dv)), 1e-4).toVar();
        const dir = dv.div(dist);
        const reach = min(dist, 1.8);
        const nk = int(U.cienKroki).toVar();
        const dl = reach.div(float(nk)).toVar();
        const tau = float(0.0).toVar();
        Loop({ start: 0, end: nk, type: 'int', condition: '<', name: `sh${j}` }, ({ [`sh${j}`]: s }) => {
          const Ps = P.add(dir.mul(dl.mul(float(s).add(0.5))));
          const c = coarse(Ps, null);
          tau.addAssign(c.mass.mul(U.gestosc).add(c.dust.mul(U.pylGestosc)).mul(SHADOW_DETAIL_MEAN * 1.0).mul(dl));
        });
        T[j].assign(exp(tau.negate().mul(U.cienDaleki)));
      });
    }
    return vec4(T[0], T[1], T[2], T[3]);
  })();

  // ── pass 4: objętość (marsz główny, w pasach) ────────────────────────────────────────────────
  const objetoscNode = (ctx) => Fn(() => {
    const p = ctx.sky().toVar();
    const px = ctx.px.toVar();
    const col = vec3(0.0).toVar();
    const T = float(1.0).toVar();
    // Zakres z sąsiedztwa 3 × 3 celu ½ (min / max — zapas na detal przy brzegu).
    const zA = float(2.0).toVar();
    const zB = float(-1.0).toVar();
    const zM = float(0.0).toVar();
    Loop({ start: -1, end: 2, type: 'int', condition: '<', name: 'ry' }, ({ ry }) => {
      Loop({ start: -1, end: 2, type: 'int', condition: '<', name: 'rx' }, ({ rx }) => {
        const z = ctx.loadAt('zasieg', px, ivec2(rx, ry));
        If(z.z.add(z.w).greaterThan(0.0), () => {
          zA.assign(min(zA, z.x));
          zB.assign(max(zB, z.y));
          zM.assign(max(zM, z.z.add(z.w)));
        });
      });
    });
    If(zM.greaterThan(0.0), () => {
      const n = int(U.kroki).toVar();
      const dt = zB.sub(zA).div(float(n)).toVar();
      const dz = dt.mul(U.grubosc.mul(2.0)).toVar();
      const jit = skyHash(uint(px.x), uint(px.y), uint(U.seed).add(uint(777))).mul(U.drganie);
      const t = zA.add(dt.mul(jit)).toVar();
      const g = U.faza;
      const g2 = g.mul(g);
      Loop({ start: 0, end: n, type: 'int', condition: '<', name: 'gstep' }, () => {
        const z = U.grubosc.mul(float(1.0).sub(t.mul(2.0)));
        const P = vec3(p, z).toVar();
        const c = coarse(P, null);
        If(c.mass.add(c.dust).greaterThan(0.002), () => {
          const d = detail(c);
          const sG = d.gas.mul(U.gestosc).toVar();
          const sD = d.dust.mul(U.pylGestosc).toVar();
          const sigma = sG.add(sD).toVar();
          If(sigma.greaterThan(1e-4), () => {
            const albedo = U.barwaGazu.mul(sG).add(U.barwaPylu.mul(sD)).div(sigma).toVar();
            const scat = vec3(0.0).toVar();
            const ion = float(0.0).toVar();
            const lt1 = atlasAt(ctx, 'swiatlo1', P).toVar();
            const lt2 = atlasAt(ctx, 'swiatlo2', P).toVar();
            Loop({ start: 0, end: U.lampCount, type: 'int', condition: '<', name: 'lamp' }, ({ lamp }) => {
              const L = U.lampPos.element(lamp);
              const C = U.lampCol.element(lamp);
              const dv = L.xyz.sub(P);
              const r2 = dot(dv, dv);
              const dist = max(sqrt(r2), 1e-4);
              const dir = dv.div(dist).toVar();
              const irr = C.w.mul(U.jasnosc).div(r2.add(L.w.mul(L.w))).toVar();
              const Tfar = select(lamp.equal(int(0)), lt1.x, select(lamp.equal(int(1)), lt1.y, select(lamp.equal(int(2)), lt1.z,
                select(lamp.equal(int(3)), lt1.w, select(lamp.equal(int(4)), lt2.x, select(lamp.equal(int(5)), lt2.y,
                  select(lamp.equal(int(6)), lt2.z, lt2.w)))))));
              // Cień bliski: kilka próbek detalu ku gwieździe (jasne brzegi cienkich kłębów, cień grubych).
              const tau = float(0.0).toVar();
              const nb = int(U.cienBliski).toVar();
              const dl = U.cienBliskiZasieg.div(max(float(nb), 1.0)).toVar();
              Loop({ start: 0, end: nb, type: 'int', condition: '<', name: 'sh' }, ({ sh }) => {
                const Ps = P.add(dir.mul(dl.mul(float(sh).add(0.5))));
                tau.addAssign(shadowSigma(Ps, c.w).mul(dl));
              });
              const Ti = Tfar.mul(exp(tau.negate())).toVar();
              // Faza Henyeya–Greensteina (promień ku −z): cos θ = −dir.z — gwiazda za kłębem rozświetla brzeg.
              const cosT = dir.z.negate();
              const hgF = float(1.0).sub(g2).div(pow(max(float(1.0).add(g2).sub(g.mul(cosT).mul(2.0)), 1e-4), 1.5));
              const hgB = float(1.0 - 0.35 * 0.35).div(pow(max(float(1.0 + 0.35 * 0.35).add(cosT.mul(2.0 * 0.35)), 1e-4), 1.5));
              const phase = mix(float(1.0), hgF.mul(0.65).add(hgB.mul(0.35)), 0.85);
              scat.addAssign(C.xyz.mul(irr).mul(Ti.mul(phase).add(sqrt(max(Ti, 1e-6)).mul(U.wielokrotne))));
              ion.addAssign(irr.mul(Ti));
            });
            // Emisja gazu: Hα wszędzie, gdzie dociera promieniowanie; O III przy silnej jonizacji (blisko gwiazd).
            // Front jonizacji (strefa Strömgrena): przejście ostre — ionK² / (1 + ionK²).
            const ionK2 = ion.mul(U.jonizacja).toVar();
            ionK2.assign(ionK2.mul(ionK2));
            const ionS = ionK2.div(ionK2.add(1.0));
            const oiiiW = smoothstep(0.72, 0.97, ionS);
            // Pasmo zewnętrzne: słabo zjonizowany brzeg (trzecia barwa — jak S II / odbicie w palecie Hubble'a).
            const zewnW = smoothstep(0.02, 0.22, ionS).mul(float(1.0).sub(smoothstep(0.3, 0.75, ionS)));
            // Emisja ∝ ρ² (rekombinacja): jasne węzły i włókna w gęstym gazie, rozrzedzony ledwie świeci.
            const em = sG.mul(d.gas.min(1.5)).mul(EMISSION_GAIN).mul(c.tint).mul(U.barwaHa.mul(U.ha).mul(ionS).mul(float(1.0).sub(oiiiW.mul(0.5)))
              .add(U.barwaOiii.mul(U.oiii).mul(oiiiW).mul(ionS))
              .add(U.barwaZewn.mul(U.emisjaZewn).mul(zewnW)));
            const src = sigma.mul(albedo.mul(scat.add(U.barwaOtoczenia.mul(U.otoczenie)))).add(em);
            const segT = exp(sigma.negate().mul(dz)).toVar();
            col.addAssign(src.mul(float(1.0).sub(segT)).div(sigma).mul(T));
            T.mulAssign(segT);
          });
        });
        t.addAssign(dt);
        If(T.lessThan(0.004), () => { Break(); });
      });
    });
    return vec4(col.mul(RADIANCE_GAIN), T);
  })();

  // ── pass 5: gwiazdy (pole wspólne) — gwiazdy tła gasną za płytą ──────────────────────────────
  const gwiazdyNode = (ctx) => Fn(() => {
    const acc = starFieldNode({
      px: ctx.px.toVar(), size: ctx.size, resScale: U.resScale, seed: U.seed,
      brightness: U.gwiazdy, density: U.gwiazdyGestosc, brightMul: U.gwiazdyJasne, front: U.gwiazdyPrzod,
      sampleAt: (sp) => {
        const T = ctx.loadAt('objetosc', sp).a;
        const ps = sp.sub(ctx.size.mul(0.5)).div(ctx.size.y).toVar();
        const rho = U.gwiazdyTlo.toVar();
        Loop({ start: 0, end: min(U.lampCount, int(U.gromady)), type: 'int', condition: '<', name: 'gk' }, ({ gk }) => {
          const L = U.lampPos.element(gk);
          const r = ps.sub(L.xy).div(L.w.mul(1.2));
          rho.addAssign(exp(dot(r, r).mul(-0.5)).mul(1.2));
        });
        return { prob: rho, warm: U.gwiazdyCieplo, trans: pow(vec3(T), U.poczerwienienie) };
      }
    });
    return vec4(acc, 1.0);
  })();

  // ── pass 6: obraz (wyświetlany, liniowo) ─────────────────────────────────────────────────────
  const obrazNode = (ctx) => Fn(() => {
    const p = ctx.sky().toVar();
    const px = ctx.px.toVar();
    const ip = ctx.pixel();
    const v = ctx.load('objetosc', ip).toVar();
    const stars = ctx.load('gwiazdy', ip).rgb;
    const Trgb = pow(vec3(v.a), U.poczerwienienie);
    // Tło: głębia + mgiełka 2D w dużej skali (odległe obłoki) — za płytą.
    const hz = pow(skyFbm(p.mul(1.7).add(U.o5), int(5), 2.0, 0.55).mul(0.5).add(0.5), 2.2)
      .mul(pow(envelope(p, float(0.0), float(2.2)).min(1.0), 0.35).mul(0.8).add(0.2));
    const bg = U.barwaTla.div(U.ekspozycja).add(U.barwaMgielki.mul(U.mgielka).mul(hz).mul(HAZE_GAIN)).mul(Trgb);
    // Gwiazdy-lampy: jądro Gaussa, halo potęgowe, kolce — za pyłem z przodu (atlas na przedniej ścianie płyty).
    const lamps = vec3(0.0).toVar();
    const haloCut = U.resScale.mul(900.0);
    Loop({ start: 0, end: U.lampCount, type: 'int', condition: '<', name: 'lamp' }, ({ lamp }) => {
      const L = U.lampPos.element(lamp);
      const C = U.lampCol.element(lamp);
      const spx = L.xy.mul(ctx.size.y).add(ctx.size.mul(0.5));
      const d = px.sub(spx).toVar();
      const r = sqrt(dot(d, d)).toVar();
      If(r.lessThan(haloCut), () => {
        const lt1 = atlasAt(ctx, 'swiatlo1', vec3(L.xy, U.grubosc));
        const lt2 = atlasAt(ctx, 'swiatlo2', vec3(L.xy, U.grubosc));
        const occ = select(lamp.equal(int(0)), lt1.x, select(lamp.equal(int(1)), lt1.y, select(lamp.equal(int(2)), lt1.z,
          select(lamp.equal(int(3)), lt1.w, select(lamp.equal(int(4)), lt2.x, select(lamp.equal(int(5)), lt2.y,
            select(lamp.equal(int(6)), lt2.z, lt2.w)))))));
        // Jądro (Gauss ~1,2 teksela), halo potęgowe (promień rośnie z natężeniem), kolce dyfrakcyjne — jednostki
        // pola gwiazd: jądro jak najjaśniejsze gwiazdy siatek (HDR, bloom w grze), halo ≈ 0,2 obrazu przy R.
        const s = U.resScale.mul(float(1.2).add(C.w.mul(0.8))).toVar();
        const core = exp(r.mul(r).negate().div(s.mul(s).mul(2.0)));
        const R = U.resScale.mul(float(16.0).add(C.w.mul(40.0)));
        const halo = pow(r.mul(r).div(R.mul(R)).add(1.0), float(-1.5)).mul(0.006);
        const sw = U.resScale.mul(1.2);
        const sl = U.resScale.mul(float(80.0).add(C.w.mul(160.0)));
        const spikes = exp(abs(d.x).div(sw).negate()).mul(exp(abs(d.y).div(sl).negate()))
          .add(exp(abs(d.y).div(sw).negate()).mul(exp(abs(d.x).div(sl).negate()))).mul(U.kolce).mul(0.0015);
        lamps.addAssign(C.xyz.mul(C.w).mul(U.blask).mul(LAMP_GAIN).mul(core.add(halo).add(spikes)).mul(mix(occ, float(1.0), 0.12)));
      });
    });
    const C0 = bg.add(v.rgb).add(stars).add(lamps);

    // Wywołanie: ekspozycja → asinh po luminancji (barwa zostaje) → nasycenie → czerń, cienie → ramię.
    const x = C0.mul(U.ekspozycja).toVar();
    const lum = max(dot(x, LUMA), 1e-7).toVar();
    const bl = U.rozciagniecie.mul(lum);
    const asinhB = log(U.rozciagniecie.add(sqrt(U.rozciagniecie.mul(U.rozciagniecie).add(1.0))));
    const st = log(bl.add(sqrt(bl.mul(bl).add(1.0)))).div(asinhB);
    const c = x.mul(st.div(lum)).toVar();
    const l2 = dot(c, LUMA);
    c.assign(max(mix(vec3(l2), c, U.nasycenie), vec3(0.0)));
    c.assign(max(c.sub(U.czern), vec3(0.0)).div(float(1.0).sub(U.czern)));
    c.addAssign(U.uniesienie);
    const k = U.kolano.min(U.biel.sub(0.01));
    const span = U.biel.sub(k);
    const over = max(c.sub(k), vec3(0.0));
    const soft = vec3(k).add(vec3(1.0).sub(exp(over.div(span).negate())).mul(span));
    c.assign(mix(c, soft, step(vec3(k), c)));
    return vec4(c, 1.0);
  })();

  /** Nastawy + ziarno → uniformy (masy, gwiazdy-lampy z ziarna na CPU). */
  function apply(params, seed, baker) {
    const P = { ...MGLAWICA_DEFAULTS, ...params };
    for (const [k] of MGLAWICA_PARAMS) U[k].value = Number(P[k]);
    for (const [k] of MGLAWICA_COLORS) U[k].value.set(...P[k]);
    const sd = (Number(seed) | 0) >>> 0;
    U.seed.value = sd & 0x7fffffff;
    // Gęstość nieba (kafel: pełne niebo / 5120) i atlas od wypiekacza, który go liczy (kafel pożycza od bazowego).
    U.resScale.value = baker ? (baker.resScale ?? baker.width / 5120) : 1;
    U.dodOkt.value = Math.max(0, baker?.extraOctaves | 0);
    const atlas = passSize(baker?.shared || baker, ATLAS.size);
    U.atlasSize.value.set(atlas.width, atlas.height);
    const rnd = cpuRand(sd, 0x6e3b);
    for (let i = 1; i <= 4; i++) U[`o${i}`].value.set(rnd() * 240 - 120, rnd() * 240 - 120, rnd() * 240 - 120);
    U.o5.value.set(rnd() * 240 - 120, rnd() * 240 - 120);
    // Masy: główna z nastaw, dodatkowe wokół niej (w elipsie głównej, mniejsze, obrócone losowo).
    const a = P.kat * DEG;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const R0 = P.rozmiar;
    U.masyA.array[0].set(P.srodekX, P.srodekY, R0, 1.0);
    U.masyB.array[0].set(P.wydluzenie, 1.0, ca, sa);
    const PALETA = [P.paleta1, P.paleta2, P.paleta3, P.paleta4];
    const nm = Math.max(0, Math.min(MAX_MASSES - 1, Math.round(P.masyLiczba)));
    const rm = cpuRand(sd, 0x3a51);
    // Odcień emisji mas (udział `masyBarwy` w shaderze): masa główna i satelity dostają KOLEJNE barwy palety
    // (jedno losowe przesunięcie z ziarna — cztery sąsiednie masy to cztery różne barwy).
    const pal0 = Math.floor(rm() * 4);
    for (let i = 0; i < MAX_MASSES; i++) {
      const c = PALETA[(i + pal0) % 4];
      U.masyC.array[i].set(c[0], c[1], c[2], 0);
    }
    for (let i = 1; i < MAX_MASSES; i++) {
      const ang = rm() * Math.PI * 2;
      const dist = R0 * (0.55 + rm() * 1.1);
      const ox = Math.cos(ang) * dist * P.wydluzenie;
      const oy = Math.sin(ang) * dist;
      const x = P.srodekX + ca * ox - sa * oy;
      const y = P.srodekY + sa * ox + ca * oy;
      const r = R0 * P.masyRozmiar * (0.5 + rm() * 0.9);
      const ea = rm() * Math.PI;
      U.masyA.array[i].set(x, y, r, 0.55 + rm() * 0.6);
      U.masyB.array[i].set(1.0 + rm() * 1.3, 1.0, Math.cos(ea), Math.sin(ea));
    }
    U.masyCount.value = 1 + nm;
    // Gwiazdy-lampy: pierwsza przy masie głównej (najjaśniejsza), reszta w jej otoczeniu; z losowe w płycie.
    const zh = P.grubosc;
    const nl = Math.max(1, Math.min(MAX_LAMPS, Math.round(P.gwiazdLiczba)));
    const rl = cpuRand(sd, 0x1a3b);
    const limX = 0.8 * ATLAS.ext - 0.02;
    const limY = 0.5 * ATLAS.ext - 0.02;
    for (let i = 0; i < MAX_LAMPS; i++) {
      let ox;
      let oy;
      let I;
      if (i === 0) {
        ox = (rl() - 0.5) * 0.5 * R0 * P.wydluzenie;
        oy = (rl() - 0.5) * 0.5 * R0;
        I = 1.0;
      } else {
        const ang = rl() * Math.PI * 2;
        const dist = R0 * (0.35 + rl() * 0.9);
        ox = Math.cos(ang) * dist * P.wydluzenie;
        oy = Math.sin(ang) * dist;
        I = 0.2 + rl() * 0.6;
      }
      const x = Math.max(-limX, Math.min(limX, P.srodekX + ca * ox - sa * oy));
      const y = Math.max(-limY, Math.min(limY, P.srodekY + sa * ox + ca * oy));
      // z: `lampyPrzod` 0 — w płycie (±0,5 zh), 1 — przed nią (0,4…1,0 zh); pierwsza lampa bliżej środka.
      const zr = rl() * 2 - 1;
      const zIn = zr * 0.5;
      const zFront = 0.7 + zr * 0.3;
      const z = (zIn + (zFront - zIn) * P.lampyPrzod * (i === 0 ? 0.6 : 1.0)) * zh;
      const t = Math.max(0, Math.min(1, P.gwiazdCieplo + (rl() - 0.5) * 0.6));
      const cz = P.barwaLampZimna;
      const cw = P.barwaLampCiepla;
      // Barwa: zimna ↔ ciepła z „temperatury”, zmieszana z barwą palety (kolejne lampy — kolejne barwy; udział
      // `lampyPaleta`): gaz wokół każdej lampy świeci inaczej (nastawa „kolorowa”).
      const pal = PALETA[i % 4];
      const k = P.lampyPaleta;
      const r0 = cz[0] + (cw[0] - cz[0]) * t;
      const g0 = cz[1] + (cw[1] - cz[1]) * t;
      const b0 = cz[2] + (cw[2] - cz[2]) * t;
      U.lampPos.array[i].set(x, y, z, P.zasiegSwiatla * (0.7 + rl() * 0.6));
      U.lampCol.array[i].set(r0 + (pal[0] - r0) * k, g0 + (pal[1] - g0) * k, b0 + (pal[2] - b0) * k, I);
    }
    U.lampCount.value = nl;
  }

  return {
    name: 'mglawica',
    U,
    params: MGLAWICA_PARAMS,
    colors: MGLAWICA_COLORS,
    defaults: MGLAWICA_DEFAULTS,
    presets: MGLAWICA_PRESETS,
    apply,
    /** Podgląd pól w demie: pokrycie gazem (R), radiancja (G), przepuszczalność (B). */
    debug: { pass: 'objetosc', view: (f) => vec3(float(1.0).sub(f.a), dot(f.rgb, LUMA).mul(0.05), f.a.mul(0.3)) },
    passes: [
      { name: 'zasieg', size: ZASIEG_SIZE, sync: true, node: zasiegNode },
      // Atlas: dziedzina = całe niebo (× ATLAS.ext) niezależnie od kafla — kafel pożycza go od wypiekacza bazowego.
      { name: 'swiatlo1', size: ATLAS.size, sync: true, shared: true, node: swiatloNode(0) },
      { name: 'swiatlo2', size: ATLAS.size, sync: true, shared: true, node: swiatloNode(4) },
      { name: 'objetosc', strips: STRIPS, node: objetoscNode },
      { name: 'gwiazdy', node: gwiazdyNode },
      { name: 'obraz', node: obrazNode }
    ]
  };
}
