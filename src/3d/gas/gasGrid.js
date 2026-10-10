// src/3d/gas/gasGrid.js
//
// GAZ NA SIATCE 3D — symulacja płynu na GPU (compute WebGPU, TSL) w duchu „Grid 3D Gas” z Niagara
// Fluids: ogień, kula ognia i dym wybuchów oraz pożarów budowli (plan docs/PLAN-zniszczenia-swiata-3d.md
// § 12). Siatka Eulera, nie cząstki: dym ma kłęby, wiry i wstęgi z prawdziwego pola prędkości.
//
// DOMENY (przegródki): każdy wybuch / pożar dostaje sześcian N³ komórek ustawiony w scenie (środek
// w double, rozmiar komórki h — mały wybuch = drobna siatka). Wszystkie domeny leżą w JEDNYM atlasie
// tekstur 3D (N × N × N·S, RGBA16F, Storage3DTexture) — jeden dispatch liczy wszystkie aktywne domeny
// (lista aktywnych w uniformie; wątków = N³ · aktywne). Symulacja jest w UKŁADZIE KOMÓREK domeny
// (prędkość w komórkach/s), więc przesunięcie początku sceny (precyzja float32 przy 5–10 mln j.) to
// tylko inny uniform pozycji domeny — dane na GPU nic nie wiedzą o świecie. Domena może jechać z
// nośnikiem (wrak w ruchu): dym leci z nim jak efekty z `ActiveCarrier` (agents.md § Nośnik).
//
// KROK (stały, domyślnie 1/60 s; podkroki przy dłuższej klatce), kernele w jednym renderer.compute:
//   1. wiry      — rotacja pola prędkości (do wzmacniania wirów),
//   2a. adwekcja — RK2 wstecz (semi-Lagrange, trójliniowo sprzętowo): skalary (φ̂), pozycja spoczynkowa, przy
//                  MacCormacku prędkości (velMacCormack) też v̂ do velC,
//   2b. reakcja  — prędkość: v̂ z korekcją MacCormacka (obcięta do sąsiadów jak skalary), źródła prędkości
//                  (kapsuły: prędkość promieniowa i kierunkowa), siły: wzmacnianie wirów, wypór, unoszenie od
//                  środka wybuchu, turbulencja z szumu 3D (2 oktawy), opór (stały, gąbka przy brzegu, kwadratowy
//                  dla frontu); skalary z korekcją MacCormacka (2. rząd, obcięta do sąsiadów — ostre kłęby zamiast
//                  rozmytej waty), źródła (paliwo, temperatura, dym, szum brzegu), SPALANIE (paliwo
//                  gorętsze od zapłonu płonie: ciepło, sadza, rozprężanie), stygnięcie (Newton + T⁴),
//                  zanik dymu i paliwa, miękki brzeg domeny; na końcu KOMÓRKI STAŁE (przeszkody, niżej): prędkość
//                  przeszkody, skalary 0, flaga w velB.w,
//   3. dywergencja z celem ROZPRĘŻANIA (spalanie = źródło objętości — kula ognia „puchnie”) i KURCZENIA
//                  (stygnący gaz zasysa — kłęby się zawijają; contraction); sąsiad stały oddaje prędkość
//                  przeszkody (gaz nie wnika), flaga do prs.z,
//   4. ciśnienie — Jacobi (K iteracji, nieparzyste; rozgrzany wynikiem poprzedniego kroku), otwarte
//                  brzegi (p = 0 poza domeną — gaz swobodnie wypływa), ŚCIANA — Neumann (p sąsiada stałego
//                  = p komórki), komórka stała p = 0,
//   5. rzut      — v −= ∇p (sąsiad stały bez spadku przez ścianę), w komórce stałej prędkość przeszkody, flaga
//                  do velA.w; kopia skalarów do tekstur startowych następnego kroku.
// PRZESZKODY (F2 audytu 2026-10-08, etap C 2026-10-09): pryzmaty przez całą wysokość domeny (gra z góry — bryły
// w płaszczyźnie gry). STATYKA (budowle: ściany hal K-7, kawałki suchego doku) — raster CPU w oknie MS × MS teksli
// ZAKOTWICZONYM W ŚWIECIE (teksel = komórka domeny), liczony przy zajęciu domeny i po zmianie budowli; domena
// jadąca z nośnikiem próbkuje go z przesunięciem (ściana stoi w świecie, w układzie domeny ma prędkość −nośnik),
// okno wyprzedza nośnik, nowe okno przed jego brzegiem. Bryły rastrowane zachowawczo (+0,75 komórki: cienka brama
// ma ≥ 2 teksle — gaz nie przecieka). KADŁUBY (okręty, wraki) — maska obrysu z żywych węzłów belek
// (src/game/hullFootprint.js) w paśmie tekstury masek, przekształcenie i prędkość ciała + ω × r w uniformach
// domeny (jak pył hal — src/3d/gasField/gasField2D.js); kadłub-GOSPODARZ domeny (wrak, z którego wybucha zbiornik)
// nie jest przeszkodą swojego gazu. Źródła nie wstrzykują przez ścianę statyki (marsz po masce od komórki do początku
// kapsuły źródła). Adwekcja i korekcja MacCormacka próbkują skalary z pominięciem komórek stałych (freeSample — bez pustego
// pasa przy licu ściany). LUSTRA CPU: komórka stała GasGrid.solidCpu, zasłanianie źródła sourceOcclusionCpu, Jacobi i rzut
// gasJacobiCellCpu / gasProjectCellCpu (porównanie z kernelem na GPU: checkProjectCpu).
// Pole POZYCJI SPOCZYNKOWYCH (rest): współrzędna komórki, z której przypłynął gaz (adwekcja jak skalary, powolny
// powrót do tożsamości) — obraz czyta detal z tego pola, więc drobne kłęby jadą Z dymem. Dawny detal przesuwany
// fazami mapy przepływu co 0,7 s wracał do startu — dym „szedł i cofał się” (zgłoszenie użytkownika 2026-10-05,
// A/B: 9 zawrotek środka dymu na 3 s, bez detalu 0).
// Raz na klatkę: OBJĘTOŚĆ ŚWIATŁA — przepuszczalność ku słońcu (marsz po dymie = samocień kłębów)
// i blask ognia rozproszony w dymie (dym przy płomieniu świeci od środka na pomarańczowo).
//
// Tekstury (atlas, RGBA16F): vel (vx, vy, vz, komórka stała — velA / velB), den (dym, temperatura, paliwo, tempo spalania
// — przy kurczeniu w komórce bez spalania: −tempo stygnięcia),
// prs (ciśnienie, prawa strona, komórka stała), curl (ω, |ω|), light (T słońca, blask rgb), rest (pozycja spoczynkowa).
// vel trzy (velC — v̂ dla MacCormacka prędkości), den trzy, prs/rest po dwie, curl i light DZIELĄ atlas z prsA i denB
// (rozłączny czas życia w kroku — konstruktor). Pamięć: 10 × N²·NZ·S × 8 B (96² × 36 — 26,5 MB na domenę; 128² × 48 —
// 62,9 MB); przy alokacji leniwej (`lazy`, F17) atlasy mają 1 × 1 × 1 do pierwszej domeny i mogą wrócić do 1 × 1 × 1 po
// `releaseAfter` s bez domen. Maski przeszkód (R8, filtr liniowy, próg 0,5): statyka MS × MS na domenę (MS = 2N:
// 192² × 8 — 295 KB), obrysy kadłubów 64 × 32 na pasmo (32 pasma — 64 KB).
// SKALA KOMÓRKI domeny (GasSlot.k, uniform slotK): parametry w jednostkach komórek (sufit prędkości, wiry, turbulencja i jej
// skala, unoszenie, opór kwadratowy, dopływ przy ścianie, krok samocienia, promienie blasku, szum źródeł) skalowane k —
// rozdzielczość domeny (komórki na promień kuli ognia) nie zmienia strojenia; k = 1 — wynik bit w bit jak przed etapem D.
// Wielkości względne domeny (pas przy ścianach, szum brzegu elipsoidy) skalowane bokiem względem `nRef`.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, float, int, uint, vec2, vec3, vec4, uvec3, uniform, uniformArray, instanceIndex, instancedArray,
  texture, texture3D, textureStore, select, mix, clamp, smoothstep, step, exp, max, min, abs, length, cross, dot, ceil
} from 'three/tsl';
import { gasBlackbody, gasFirePower, GAS_FIRE_MAX } from './gasCommon.js';
import { GAS_HULL_MASK, GAS_HULL_REC } from './gasObstacleLayout.js';
import { fxRandom } from '../fx/fxRandom.js';

export const GAS_GRID_DEFAULTS = Object.freeze({
  N: 64,             // komórek na bok domeny (x, y)
  NZ: 0,             // komórek w pionie (z); 0 = N. Gra z góry: płaska domena (np. 48 × 48 × 24)
  slots: 6,          // domen naraz
  jacobi: 25,        // iteracje ciśnienia (nieparzyste)
  maxSources: 192,   // źródeł na klatkę (wszystkie domeny)
  maxHulls: 64,      // kadłubów-przeszkód na klatkę (rekordy w domenach — kadłub w dwóch domenach liczy się dwa razy)
  hullBands: 32,     // pasm tekstury masek obrysu (różnych kadłubów naraz)
  maskSize: 0,       // okno rastra statyki [teksle = komórki] na domenę; 0 = 2N
  maxBoxes: 1024,    // brył statyki (pudła w scenie)
  maxFoots: 24,      // obrysów statyki (ruszone kawałki budowli — maska kadłuba w rastrze statyki)
  substep: 1 / 60,   // krok symulacji [s]
  maxSubsteps: 3,
  lazy: false,       // atlasy alokowane przy pierwszej domenie (F17); false — od razu
  releaseAfter: 0    // [s] bez domen, po których atlasy wracają do 1 × 1 × 1 (tylko lazy; 0 — nigdy)
});

// Maska obrysu kadłuba (64 × 32) i rekord kadłuba / obrysu statyki (w gasGrid: scena — x gry, −y gry; ω sceny = −ω gry).
export { GAS_HULL_MASK, GAS_HULL_REC };

/** Zapas rastra statyki [komórki]: bryła rośnie o tyle z każdej strony (cienka ściana ≥ 2 teksle — bez przecieku). */
export const GAS_STATIC_GROW = 0.75;

/** Dno przesunięcia źródła wybuchu z bryły statyki: szukanie wolnej komórki do tylu komórek od środka. */
const FREE_SEARCH = 24;

/**
 * Strojenie fizyki gazu (wspólne dla domen; uniformy). Jednostki: komórki, sekundy, temperatura
 * gazu (gasCommon.js — 1 ≈ 1600 K). Wartości dobrane w demie dema/wybuchy-webgpu.html.
 */
export function createGasTuning() {
  return {
    ignition: 0.32,     // temperatura zapłonu paliwa
    burnRate: 5.5,      // ułamek paliwa spalany na sekundę przy pełnym zapłonie
    heat: 1.0,          // przyrost temperatury na jednostkę spalonego paliwa
    soot: 0.75,         // dym (sadza) na jednostkę spalonego paliwa
    expansion: 0.5,     // rozprężanie [1/s na komórkę] na jednostkę tempa spalania (∫ = 0,5 · spalone paliwo ≈ 1,5 →
                        // objętość spalin ~5×; przy 1,4 kula ognia rosła 60× i wypełniała domenę sześcianem)
    cooling: 1.0,       // stygnięcie Newtona [1/s]
    edgeCooling: 2.5,   // przyspieszenie stygnięcia w rzadkim gazie (brzeg kuli ognia)
    radiative: 0.3,     // stygnięcie promieniste (∝ T⁴)
    smokeDecay: 0.16,   // zanik dymu [1/s] (połowa po ~4 s — dym ma się rozejść i zniknąć, decyzja użytkownika 2026-10-05)
    disperse: 0.06,     // rozprężanie zimnego dymu w próżni [1/s na jednostkę dymu] — obłok rośnie i rzednie
    restRelax: 0.05,    // powrót pola pozycji spoczynkowych do tożsamości [1/s] (detal nie rozciąga się bez końca)
    fuelDecay: 0.25,    // ulatnianie się niespalonego paliwa [1/s]
    drag: 0.9,          // opór prędkości [1/s] (front kuli ognia hamuje w ~0,5 s)
    dragQuad: 0,        // opór zależny od prędkości [1/komórka] (opór = drag + dragQuad·|v|·front): szybki front hamuje,
                        // wolny dym dalej odpływa (w próżni stały opór zatrzymywał dym — „wisiał w miejscu”)
    dragFrontLo: 0,     // pasmo prędkości [kom./s], w którym dragQuad wchodzi (front = 0 poniżej Lo, 1 powyżej Hi;
    dragFrontHi: 0,     // Hi ≤ Lo = wszędzie — dawny opór, bit w bit). Gra zostaje przy oporze wszędzie: bez wolnego oporu
                        // przy MacCormacku prędkości energia nie gasła (sonda, etap A 2026-10-09) — do ponownej próby po F6
    sponge: 0,          // GĄBKA: opór [1/s] przy brzegu domeny (0 = bez) — w próżni oporu nie ma; brzeg gasi
    spongeStart: 0.7,   // prędkość tam, gdzie i tak znikają skalary; początek pasa w promieniu elipsoidy domeny (< 1)
    velMacCormack: 0,   // adwekcja prędkości 2. rzędu (MacCormack z obcięciem jak skalary) — 1 = wł. (F4)
    contraction: 0,     // KURCZENIE przy stygnięciu: cel dywergencji −contraction · tempo stygnięcia [1/s] w komórkach
                        // bez spalania — stygnący gaz zasysa otoczenie, kłęby się zawijają (F7); 0 = bez
    vorticity: 2.0,     // wzmacnianie wirów (ε)
    turbulence: 35,     // siła turbulencji z szumu [komórki/s²]
    turbScale: 0.055,   // częstotliwość szumu turbulencji [1/komórka]
    turbSpeed: 0.08,    // tempo zmian szumu turbulencji
    buoyancy: 7,        // wypór [komórki/s² na jednostkę T] wzdłuż buoyDir
    sootWeight: 0.6,    // ciężar dymu przeciw wyporowi
    radialLift: 2.5,    // unoszenie gorącego gazu od środka wybuchu [komórki/s² na jednostkę T]
    maxSpeed: 110,      // sufit prędkości [komórki/s]
    wallBlock: 1,       // ŚCIANA w rzucie: składowa normalna ku sąsiadowi stałemu ≤ v + wallBlock · (prędkość ściany − v) —
                        // 1 = twardo do prędkości ściany, 0,5 = średnia z licem (jak siatka przesunięta: środek komórki przy
                        // ścianie = średnia ściany i wnętrza), 0 = bez (sam warunek Neumanna w ciśnieniu)
    wallFill: 64,       // DOPŁYW 1. rzędu przy ścianie: obcięcie składowej normalnej zabiera komórce przy licu dopływ z wnętrza
                        // (pusty pas wzdłuż ściany: dym w 1. rzędzie ~1% 2. rzędu — sonda, przegląd etapu C pkt 6) — skalary
                        // dostają go z powrotem: φ += (φ sąsiada od wnętrza − φ) · min(1, wallFill · zabrana prędkość · dt);
                        // ściana odjeżdżająca nic nie zabiera (pustka za nią zostaje). A/B 2026-10-09 (1 / 4 / 16 / 64 / 256):
                        // 64 — 1. rząd ≈ 2. rząd (0,82 / 0,85), masa jak bez ściany, przeciek 0; samo wallBlock 0 dawało to
                        // samo, ale strumień w ścianę tracił w niej 33% gazu (gaz wnikał i ginął)
    borderFade: 5,      // pas zaniku przy brzegu domeny [komórki]
    warm: 0.92,         // rozgrzanie ciśnienia wynikiem poprzedniego kroku
    buoyDir: [0, 1, 0], // kierunek wyporu (scena; w grze z góry — 0 albo ku kamerze)
    // Światło (objętość raz na klatkę)
    shadow: 0.9,        // gęstość optyczna dymu dla słońca [na komórkę na jednostkę dymu]
    lightStep: 2.0,     // krok marszu ku słońcu [komórki]
    fireGain: 0.45,     // moc żaru ∝ T² (T = 1 → 0,45 HDR, T = 1,5 → 1, T = 2,5 → 2,8 — ACES nie przepala barwy)
    fireBurn: 0.05,     // czysty płomień frontu spalania ∝ tempo spalania [na komórkę]
    glow: 0.8,          // blask ognia rozproszony w dymie
    glowFar: 0          // DALEKI blask (F10, etap B 2026-10-09): pierścień 6 osi × GLOW_FAR_RADIUS komórek, waga × glowFar;
                        // 0 = bez pierścienia (gałąź po uniformie — bez kosztu, wynik bit w bit jak dawniej)
  };
}

/** Powrót obrazu domeny odżywionej w trakcie wygaszania [1/s] i spadek dodatkowego zaniku dymu [1/s na 1/s]. */
const FADE_RISE = 2.0;
const FADE_RISE_FAST = 10.0;
const EXTRA_DECAY_FALL = 8.0;

/** Tempo spalania [1/s], poniżej którego komórka liczy się jako niepaląca (kanał w = −tempo stygnięcia, F7). */
const BURN_EPS = 0.02;

/**
 * Najwięcej próbek rastra statyki na marsz komórka → POCZĄTEK kapsuły źródła (zasłanianie źródeł bryłą; krok ≤ 1 komórka
 * do 24 komórek — puff kuli ognia gry ma do ~20 komórek promienia).
 */
const SRC_OCCLUSION_STEPS = 24;
/** Gospodarzy (rodów kadłubów wyłączonych z maski) na domenę — pełna domena nie przyjmuje wybuchu z nowym gospodarzem. */
export const GAS_SLOT_HOSTS = 16;
/** Wyprzedzenie okna rastra statyki wzdłuż nośnika domeny [s ruchu] (ograniczone zapasem okna). */
const RASTER_LOOKAHEAD = 4;
/** Najkrótszy odstęp nowych rastrów statyki domeny po zmianach budowli [s] (kawałki doku pękają seriami). */
const STATIC_MIN_INTERVAL = 0.1;

/**
 * LUSTRO CPU kanału w (gasReact) i prawej strony równania ciśnienia (gasDivergence, `_rhsOf`) — testy F7. Zmiana
 * w kernelu = zmiana tutaj. w: tempo spalania, a w komórce bez spalania przy contraction > 0 — MINUS tempo stygnięcia.
 */
export function gasReactWCpu(burnRate, coolRate, contraction) {
  return contraction > 0 && burnRate < BURN_EPS ? -coolRate : burnRate;
}
/** rhs = div − max(w,0)·expansion − min(dym,3)·disperse + max(−w,0)·contraction (rzut usuwa div − cel). */
export function gasRhsCpu(div, w, smoke, T) {
  return div - Math.max(w, 0) * T.expansion - Math.min(smoke, 3) * T.disperse + Math.max(-w, 0) * T.contraction;
}

/**
 * LUSTRO CPU rzutu ciśnienia z PRZESZKODAMI (kernele gasDivergence → gasJacobi* → gasProject, etap C) na jednej domenie
 * nx × ny × nz: vel (Float64Array 3·n — prędkość po reakcji; komórka stała ma prędkość przeszkody), solid (Uint8Array n),
 * target (cel dywergencji n — rhs = div − target), iters (nieparzyste), q0 (rozgrzanie, opcjonalnie). Próbki brzegowe obcięte
 * do domeny (jak `_at`), ciśnienie poza domeną 0, sąsiad stały — Neumann, komórka stała p = 0; rzut: v −= ∇p / 2, sufit
 * prędkości `maxSpeed` (przed warunkiem ściany), bez wnikania w ścianę w osiach x i y, komórka stała — prędkość przeszkody.
 * Zwraca { q, vel }. Zmiana w kernelu = zmiana tutaj (reguły komórki: gasJacobiCellCpu, gasProjectCellCpu — te same
 * porównuje z kernelem GasGrid.checkProjectCpu).
 */
export function gasProjectCpu(vel, solid, target, nx, ny, nz, iters, q0 = null, maxSpeed = Infinity, wallBlock = 1) {
  const n = nx * ny * nz;
  const cl = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  const id = (x, y, z) => cl(x, nx - 1) + nx * (cl(y, ny - 1) + ny * cl(z, nz - 1));
  const rhs = new Float64Array(n);
  let qa = new Float64Array(n), qb = new Float64Array(n);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = id(x, y, z);
    if (solid[i]) continue;
    const div = (vel[id(x + 1, y, z) * 3] - vel[id(x - 1, y, z) * 3] + vel[id(x, y + 1, z) * 3 + 1] - vel[id(x, y - 1, z) * 3 + 1]
      + vel[id(x, y, z + 1) * 3 + 2] - vel[id(x, y, z - 1) * 3 + 2]) * 0.5;
    rhs[i] = div - target[i];
    qa[i] = q0 ? q0[i] : 0;
  }
  // Sąsiedzi komórki (x+, x−, y+, y−, z+, z−): indeksy, w domenie, stały.
  const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const nbI = new Int32Array(6), nbIn = new Uint8Array(6), nbS = new Uint8Array(6), nbQ = new Float64Array(6);
  const around = (x, y, z) => {
    for (let k = 0; k < 6; k++) {
      const xx = x + NB[k][0], yy = y + NB[k][1], zz = z + NB[k][2];
      nbIn[k] = xx >= 0 && xx < nx && yy >= 0 && yy < ny && zz >= 0 && zz < nz ? 1 : 0;
      nbI[k] = id(xx, yy, zz);
      nbS[k] = solid[nbI[k]] ? 1 : 0;
    }
  };
  for (let it = 0; it < iters; it++) {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = id(x, y, z);
      around(x, y, z);
      for (let k = 0; k < 6; k++) nbQ[k] = qa[nbI[k]];
      qb[i] = gasJacobiCellCpu(qa[i], nbQ, nbS, nbIn, rhs[i], solid[i]);
    }
    const t = qa; qa = qb; qb = t;
  }
  const out = new Float64Array(n * 3);
  const vb = [0, 0, 0], wallV = [0, 0, 0, 0], res = [0, 0, 0];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = id(x, y, z);
    around(x, y, z);
    for (let k = 0; k < 6; k++) nbQ[k] = qa[nbI[k]];
    vb[0] = vel[i * 3]; vb[1] = vel[i * 3 + 1]; vb[2] = vel[i * 3 + 2];
    wallV[0] = vel[nbI[0] * 3]; wallV[1] = vel[nbI[1] * 3]; wallV[2] = vel[nbI[2] * 3 + 1]; wallV[3] = vel[nbI[3] * 3 + 1];
    gasProjectCellCpu(vb, solid[i], qa[i], nbQ, nbS, nbIn, wallV, maxSpeed, res, wallBlock);
    out[i * 3] = res[0]; out[i * 3 + 1] = res[1]; out[i * 3 + 2] = res[2];
  }
  return { q: qa, vel: out };
}

/**
 * LUSTRO CPU jednej komórki Jacobiego (gasJacobi*): q — p komórki, nb[6] — p sąsiadów (x+, x−, y+, y−, z+, z−), nbSolid[6] —
 * sąsiad stały, nbIn[6] — sąsiad w domenie, rhs, solid — komórka stała. Poza domeną p = 0 (otwarty brzeg), sąsiad stały —
 * NEUMANN (p komórki), komórka stała zostaje 0. Zmiana w kernelu = zmiana tutaj.
 */
export function gasJacobiCellCpu(q, nb, nbSolid, nbIn, rhs, solid) {
  if (solid) return 0;
  let s = 0;
  for (let k = 0; k < 6; k++) s += nbIn[k] ? (nbSolid[k] ? q : nb[k]) : 0;
  return (s - rhs) / 6;
}

/**
 * LUSTRO CPU rzutu jednej komórki (gasProject): vb [3] — prędkość po reakcji, solid — komórka stała, q — p komórki, nb / nbSolid
 * / nbIn — jak gasJacobiCellCpu (p po Jacobim), wallV [4] — prędkość sąsiadów x+, x−, y+, y− w ich osi (velB: vx dla x±, vy
 * dla y±), maxSpeed. v = vb − ∇p (różnica centralna / 2, Neumann), sufit |v| ≤ maxSpeed, potem bez wnikania: ku sąsiadowi
 * stałemu składowa ≤ prędkość ściany (x+ / y+ — min, x− / y− — max); komórka stała — vb. Wynik w out [3]. Zmiana w kernelu =
 * zmiana tutaj.
 */
/**
 * LUSTRO CPU dopływu skalarów 1. rzędu przy ścianie (gasProject, strojenie wallFill): den [4] komórki, up [4] — sąsiad od
 * wnętrza (przeciwnie do ściany), removed — prędkość zabrana komórce przez warunek ściany w tej osi [kom./s, ≥ 0], dt.
 * den := den + (up − den) · min(1, wallFill · removed · dt) (w miejscu). Zmiana w kernelu = zmiana tutaj.
 */
export function gasWallFillCpu(den, up, removed, wallFill, dt) {
  if (!(wallFill > 0)) return den;
  const t = Math.min(1, wallFill * Math.abs(removed) * dt);
  for (let k = 0; k < 4; k++) den[k] += (up[k] - den[k]) * t;
  return den;
}

export function gasProjectCellCpu(vb, solid, q, nb, nbSolid, nbIn, wallV, maxSpeed, out, wallBlock = 1) {
  if (solid) { out[0] = vb[0]; out[1] = vb[1]; out[2] = vb[2]; return out; }
  const P = (k) => (nbIn[k] ? (nbSolid[k] ? q : nb[k]) : 0);
  let vx = vb[0] - (P(0) - P(1)) * 0.5, vy = vb[1] - (P(2) - P(3)) * 0.5, vz = vb[2] - (P(4) - P(5)) * 0.5;
  const c = Math.min(1, maxSpeed / Math.max(Math.sqrt(vx * vx + vy * vy + vz * vz), 1e-3));
  vx *= c; vy *= c; vz *= c;
  const k = wallBlock;
  if (nbIn[0] && nbSolid[0]) vx = Math.min(vx, vx + k * (wallV[0] - vx));
  if (nbIn[1] && nbSolid[1]) vx = Math.max(vx, vx + k * (wallV[1] - vx));
  if (nbIn[2] && nbSolid[2]) vy = Math.min(vy, vy + k * (wallV[2] - vy));
  if (nbIn[3] && nbSolid[3]) vy = Math.max(vy, vy + k * (wallV[3] - vy));
  out[0] = vx; out[1] = vy; out[2] = vz;
  return out;
}

const LIGHT_STEPS = 16;
// Kierunki zbierania blasku ognia (6 osi + 8 przekątnych, jednostkowe) i promienie [komórki].
const GLOW_DIRS = (() => {
  const d = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const k = 1 / Math.sqrt(3);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) d.push([sx * k, sy * k, sz * k]);
  return d;
})();
const GLOW_RADII = [2.0, 4.5];
// Daleki pierścień blasku (glowFar > 0): 6 osi, promień [komórki] — dym dalej od ognia (do ~0,5 R kuli) nie jest czarny.
const GLOW_FAR_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const GLOW_FAR_RADIUS = 9.0;

const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);

function atlasTexture(N, NZ, S, name) {
  const t = new THREE.Storage3DTexture(N, N, NZ * S);
  t.name = name;
  t.type = THREE.HalfFloatType;
  t.format = THREE.RGBAFormat;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Maska przeszkód R8 (0 / 255) z filtrem liniowym: próg 0,5 kładzie brzeg na granicy teksli, przy dowolnym
// przesunięciu próbki (domena jadąca względem rastra) — bryła z k teksli ma w domenie k komórek.
function maskTexture(data, w, h, name) {
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  t.name = name;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Domena (przegródka atlasu) — stan CPU. */
class GasSlot {
  constructor(index) {
    this.index = index;
    this.active = false;
    this.cx = 0; this.cy = 0; this.cz = 0;   // środek (scena, double)
    this.h = 1;                              // rozmiar komórki [j. sceny]
    this.vx = 0; this.vy = 0; this.vz = 0;   // nośnik [j./s]
    this.rx = 0; this.ry = 0; this.rz = 0;   // środek unoszenia (scena)
    this.born = 0;
    this.fed = 0;                            // ostatnie zasilenie (nowy wybuch w domenie) — presja liczy wiek od niego
    this.until = 0;                          // koniec życia (potem wygaszanie)
    this.fastRise = false;                   // odżycie po zasileniu nowym wybuchem: obraz wraca szybko (FADE_RISE_FAST)
    this.fadeTime = 1.6;
    this.fade = 1;                           // mnożnik obrazu 0..1
    this.extraDecay = 0;                     // dodatkowy zanik dymu przy wygaszaniu [1/s]
    this.seed = 0;
    this.clear = false;                      // wyzerować komórki przed krokiem
    this.tint = [1, 1, 1];                   // barwa dymu domeny (para / sadza)
    this.fire = 0;                           // paleta ognia domeny: 0 — ciało czarne, 1 — plazma Yamato, 2 — wodór (gasCommon GAS_FIRE_ROWS)
    this.baseDecay = 0;                      // stały zanik dodatkowy dymu [1/s] (krótki dym wylotu działa — etap E1)
    this.ambient = 0;                        // otoczenie domeny (światło wnętrza hali K-7 — dym zapłonu, etap E2; obraz gry)
    // SKALA KOMÓRKI domeny (etap D 2026-10-09): k = (komórki na promień kuli) / (komórki na promień przy strojeniu —
    // 96 / 5,4 ≈ 17,8). Parametry w jednostkach komórek (sufit prędkości, siły, częstotliwości szumu, krok samocienia,
    // promienie blasku, gęstość optyczna obrazu) skalowane k — drobniejsza siatka (F5a, atlas „fine”) zmienia
    // ROZDZIELCZOŚĆ, nie strojenie (k = 1 — bit w bit jak dawniej). Wylot i zapłon: 1 (strojone na swojej komórce).
    this.k = 1;
    this.n = 0; this.nz = 0;                 // komórki domeny na bok / w pionie (siatka właściciela)
    this.gid = index;                        // indeks globalny (GasGridSet — kilka siatek; sama siatka: = index)
    this.tag = 0;                            // znacznik właściciela (np. id wybuchu)
    this.priority = 0;                       // pierwszeństwo przy braku wolnej domeny (gra: stacja > okręt > kurz)
    this._camD = 0;                          // odległość² od kamery (sortowanie obrazu)
    // Raster statyki (okno zakotwiczone w świecie): róg okna w scenie, wersja statyki, czas rastra, czy są bryły.
    this.mox = 0; this.moy = 0;
    this.maskVer = -1;
    this.maskAt = -1e9;
    this.maskVerAt = -1e9;   // ostatni raster z powodu zmiany budowli (limit STATIC_MIN_INTERVAL)
    this.maskOn = false;
    this._maskStale = false;
    this._fedRaster = false;  // zasilona nowym wybuchem od ostatniego rastra (nowa statyka bez limitu STATIC_MIN_INTERVAL)
    // Gospodarze domeny — klucze rodów kadłubów, które nie są przeszkodą swojego gazu (wrak wybuchającego okrętu).
    this.hosts = new Array(GAS_SLOT_HOSTS).fill(0);
    this.hostN = 0;
    // Zakresy źródeł / kadłubów tej klatki (pakowanie).
    this._src0 = 0; this._srcN = 0; this._hull0 = 0; this._hullN = 0;
  }
  /** Czy domena przyjmie gospodarza `key` (brak klucza, już jest albo jest miejsce). */
  canHost(key) {
    return !key || this.hostN < GAS_SLOT_HOSTS || this.isHost(key);
  }
  /**
   * Dopisuje klucz rodu do gospodarzy domeny (0 = brak). Pełna lista — false bez nadpisania (dawne nadpisanie ostatniego
   * robiło z wraku-gospodarza przeszkodę: jego kula ognia zerowała się w jednej klatce); wołający nie scala wtedy wybuchu.
   */
  addHost(key) {
    if (!key) return true;
    for (let i = 0; i < this.hostN; i++) if (this.hosts[i] === key) return true;
    if (this.hostN >= GAS_SLOT_HOSTS) return false;
    this.hosts[this.hostN++] = key;
    return true;
  }
  isHost(key) {
    if (!key) return false;
    for (let i = 0; i < this.hostN; i++) if (this.hosts[i] === key) return true;
    return false;
  }
  get size() { return this.h; }
}

export class GasGrid {
  /**
   * @param {object} o
   * @param {THREE.Data3DTexture} o.noise3D szum 3D kafelkowy (fxNoise.noise3D — R, G fbm)
   * @param {number} [o.N] @param {number} [o.slots] @param {number} [o.jacobi]
   * @param {number} [o.maxSources] @param {number} [o.maxObstacles]
   * @param {{ next(): number }} [o.rng] generator efektów (domyślnie fxRandom — wizualia nie ruszają Math.random gry) — ziarna domen
   */
  constructor(o = {}) {
    const cfg = { ...GAS_GRID_DEFAULTS, ...o };
    this.N = cfg.N | 0;
    this.NZ = (cfg.NZ | 0) || this.N;
    this.S = cfg.slots | 0;
    this.jacobi = (cfg.jacobi | 1);
    this.maxSources = cfg.maxSources;
    this.maxHulls = cfg.maxHulls | 0;
    this.hullBands = Math.max(1, cfg.hullBands | 0);
    this.MS = (cfg.maskSize | 0) || this.N * 2;
    this.maxBoxes = cfg.maxBoxes | 0;
    this.maxFoots = cfg.maxFoots | 0;
    this.substep = cfg.substep;
    this.maxSubsteps = cfg.maxSubsteps;
    this.noise3D = o.noise3D;
    this.rng = o.rng || fxRandom;
    this.tune = createGasTuning();
    this.time = 0;
    this._acc = 0;
    this.origin = { x: 0, y: 0, z: 0 };
    this.sunDir = new THREE.Vector3(0.45, 0.75, 0.48).normalize();
    this.slots = Array.from({ length: this.S }, (_, i) => new GasSlot(i));
    for (const s of this.slots) { s.n = this.N; s.nz = this.NZ; }
    // Rozmiar odniesienia domeny [komórki na bok] dla wielkości względnych DOMENY (pas zaniku przy ścianach, szum brzegu
    // elipsoidy, miękkie ściany obrazu): atlas „fine” 128 z nRef 96 ma te same pasy w ułamku boku. Domyślnie N (bez zmian).
    this.nRef = Number(cfg.nRef) > 0 ? Number(cfg.nRef) : this.N;
    this.active = [];            // aktywne domeny w kolejności pakowania
    // hulls — rekordy kadłubów w domenach tej klatki, hullsIn — kadłuby klatki (wejście), hullsDropped — bez miejsca,
    // masked — domeny z bryłami statyki, rasters — rastry statyki w tej klatce (licznik), rasterMs — ich czas CPU,
    // packMs — pakowanie kadłubów (CPU), bandUploads — maski obrysu rozpakowane w tej klatce.
    this.stats = { active: 0, sources: 0, hulls: 0, hullsIn: 0, hullsDropped: 0, masked: 0, rasters: 0, rasterMs: 0, packMs: 0,
      bandUploads: 0, substeps: 0, dropped: 0, cells: 0 };

    const N = this.N, NZ = this.NZ, S = this.S;
    // 10 atlasów, 12 ról (F17, etap D 2026-10-09): role o rozłącznym czasie życia w kroku dzielą teksturę —
    //   curlT ≡ prsA: wiry pisze gasCurl, czyta gasReact; prsA pisze dopiero gasDivergence (po reakcji), czyta Jacobi;
    //   lightT ≡ denB: φ̂ pisze gasAdvect, czyta gasReact (w każdym podkroku); objętość światła pisze gasLight na KOŃCU
    //   klatki (po ostatnim rzucie), czytają ją bryły (GasVolume) w tej klatce — następna adwekcja nadpisuje φ̂.
    // Żaden kernel nie czyta i nie pisze tej samej tekstury (zakres użycia dispatchu). Bez zmiany wyniku symulacji i obrazu.
    // Rozmiar atlasów z `allocated` (F17 — alokacja leniwa: do pierwszej domeny 1 × 1 × 1; kernele i pipeline'y bez zmian).
    this.lazy = !!cfg.lazy;
    this.releaseAfter = Number(cfg.releaseAfter) || 0;
    this.allocated = !this.lazy;
    const dims = this.allocated ? [N, NZ, S] : [1, 1, 1];
    this.velA = atlasTexture(...dims, 'gasVelA');
    this.velB = atlasTexture(...dims, 'gasVelB');
    this.velC = atlasTexture(...dims, 'gasVelC');   // v̂ (adwekcja prędkości bez korekcji) — MacCormack prędkości
    this.denA = atlasTexture(...dims, 'gasDenA');
    this.denB = atlasTexture(...dims, 'gasDenB');   // też objętość światła (lightT)
    this.denC = atlasTexture(...dims, 'gasDenC');
    this.prsA = atlasTexture(...dims, 'gasPrsA');   // też wiry (curlT)
    this.prsB = atlasTexture(...dims, 'gasPrsB');
    this.restA = atlasTexture(...dims, 'gasRestA');
    this.restB = atlasTexture(...dims, 'gasRestB');
    this._atlases = [this.velA, this.velB, this.velC, this.denA, this.denB, this.denC, this.prsA, this.prsB, this.restA, this.restB];
    // alias: false — dawne 12 osobnych atlasów (A/B sondy: wynik ma być ten sam).
    if (cfg.alias === false) {
      this.curlT = atlasTexture(...dims, 'gasCurl');
      this.lightT = atlasTexture(...dims, 'gasLight');
      this._atlases.push(this.curlT, this.lightT);
    } else {
      this.curlT = this.prsA;
      this.lightT = this.denB;
    }
    this._idleSince = -1;

    // Źródła tej klatki (CPU, świat w double → komórki przy pakowaniu).
    this._src = new Float64Array(this.maxSources * 18);
    this._srcSlot = new Int32Array(this.maxSources);
    this._srcN = 0;

    // PRZESZKODY. Statyka (scena, double): pudła (cx, cy, ux, uy, pół długości wzdłuż u, pół szerokości) i obrysy
    // (rekordy GAS_HULL_REC) — setStatics; wersja zmienia się z budowlą (nowy raster domen). Raster statyki: okno
    // MS × MS teksli na domenę w jednej teksturze R8 (pas MS wierszy na slot), wysyłka całości po zmianie rastra.
    const MS = this.MS;
    this._boxes = new Float64Array(Math.max(1, this.maxBoxes) * 6);
    this._boxN = 0;
    this._foots = new Float64Array(Math.max(1, this.maxFoots) * GAS_HULL_REC.stride);
    this._footN = 0;
    this.staticVersion = 0;
    this.maskData = new Uint8Array(MS * MS * S);
    this.maskTex = maskTexture(this.maskData, MS, MS * S, 'gasStaticMask');
    this._maskDirty = false;
    // Kadłuby tej klatki (scena, rekordy GAS_HULL_REC) → w _pack rekordy domen (uniformy hullA–C) i pasma masek obrysu
    // (pamięć: uid → pasmo, rozpakowanie bitów tylko przy zmianie wersji maski).
    const HM = GAS_HULL_MASK;
    this._hullCap = Math.max(1, this.maxHulls);
    this._hull = new Float64Array(this._hullCap * GAS_HULL_REC.stride);
    this._hullN = 0;
    this.hullMaskData = new Uint8Array(HM.w * HM.h * this.hullBands);
    this.hullMaskTex = maskTexture(this.hullMaskData, HM.w, HM.h * this.hullBands, 'gasHullMasks');
    this._bandUid = new Float64Array(this.hullBands).fill(-1);
    this._bandVer = new Float64Array(this.hullBands).fill(-1);
    this._bandUsed = new Float64Array(this.hullBands);   // ostatnia klatka użycia (LRU)
    this._hullMaskDirty = false;
    this._frame = 0;

    const U = this.U = {
      dt: uniform(cfg.substep),
      time: uniform(0),
      activeCount: uniform(0, 'uint'),
      // Na aktywną domenę k: [4k] slot, początek źródeł, liczba źródeł, początek kadłubów;
      // [4k+1] liczba kadłubów, środek unoszenia (komórki); [4k+2] zanik dodatkowy, ziarno, czyść, raster statyki (0/1);
      // [4k+3] przesunięcie rastra statyki [teksle] (komórka p → teksel p + o), prędkość ściany względem domeny [kom./s].
      act: v4Array(S * 4, 'gasAct'),
      srcA: v4Array(this.maxSources, 'gasSrcA'),   // p0 (komórki), promień
      srcB: v4Array(this.maxSources, 'gasSrcB'),   // p1 (komórki), siła narzucenia prędkości [1/s]
      srcC: v4Array(this.maxSources, 'gasSrcC'),   // paliwo/s, temperatura/s, dym/s, prędkość promieniowa [kom./s]
      srcD: v4Array(this.maxSources, 'gasSrcD'),   // prędkość kierunkowa [kom./s], szum brzegu
      // Kadłub w domenie (jak pył hal — gasField2D bodyA–C): kotwica (komórki), wiersz 0 macierzy K (komórki →
      // teksle maski); wiersz 1 K, przesunięcie (teksle); prędkość względem domeny [kom./s], ω [rad/s], pasmo maski.
      hullA: v4Array(this._hullCap, 'gasHullA'),
      hullB: v4Array(this._hullCap, 'gasHullB'),
      hullC: v4Array(this._hullCap, 'gasHullC'),
      slotK: v4Array(S, 'gasSlotK'),                // skala komórki domeny k (GasSlot.k) — x; reszta wolna
      ignition: uniform(0), burnRate: uniform(0), heat: uniform(0), soot: uniform(0),
      expansion: uniform(0), cooling: uniform(0), radiative: uniform(0), smokeDecay: uniform(0),
      fuelDecay: uniform(0), edgeCooling: uniform(0), restRelax: uniform(0.05), disperse: uniform(0), drag: uniform(0), dragQuad: uniform(0), vorticity: uniform(0), turbulence: uniform(0),
      dragFrontLo: uniform(0), dragFrontHi: uniform(0), sponge: uniform(0), spongeStart: uniform(0.7), velMacCormack: uniform(0), contraction: uniform(0),
      turbScale: uniform(0), buoyancy: uniform(0), sootWeight: uniform(0), radialLift: uniform(0),
      maxSpeed: uniform(100), wallBlock: uniform(1), wallFill: uniform(0), borderFade: uniform(4), warm: uniform(0.9),
      buoyDir: uniform(new THREE.Vector3(0, 1, 0)),
      sunDir: uniform(new THREE.Vector3(0, 1, 0)),
      shadow: uniform(1), lightStep: uniform(2), fireGain: uniform(1), fireBurn: uniform(1), glow: uniform(1), glowFar: uniform(0)
    };
    this._syncTune();
    this._buildKernels();
    this._list = [];
  }

  // --- TSL: pomocniki ----------------------------------------------------------

  /** Komórka wątku: indeks aktywnej domeny, slot, współrzędne, środek komórki, adres zapisu. */
  _cell() {
    const U = this.U;
    const N = this.N;
    const NZ = this.NZ;
    const N3 = N * N * NZ;
    const k = instanceIndex.div(uint(N3)).toVar();
    If(k.greaterThanEqual(U.activeCount), () => { Return(); });
    const local = instanceIndex.mod(uint(N3)).toVar();
    const xi = int(local.mod(uint(N))).toVar();
    const yi = int(local.div(uint(N)).mod(uint(N))).toVar();
    const zi = int(local.div(uint(N * N))).toVar();
    const a0 = U.act.element(int(k).mul(4)).toVar();
    const sF = a0.x.toVar();
    const slotI = int(sF.add(0.5)).toVar();
    const p = vec3(float(xi), float(yi), float(zi)).add(0.5).toVar();
    const store = uvec3(uint(xi), uint(yi), uint(zi).add(uint(slotI).mul(uint(NZ)))).toVar();
    return { k, a0, xi, yi, zi, sF, slotI, p, store };
  }

  /** Próbka atlasu w punkcie komórkowym p domeny sF (trójliniowo, przycięta do domeny). */
  _at(tex, p, sF) {
    const N = this.N;
    const NZ = this.NZ;
    const q = clamp(p, vec3(0.5), vec3(N - 0.5, N - 0.5, NZ - 0.5));
    const uvw = vec3(q.x.mul(1 / N), q.y.mul(1 / N), q.z.add(sF.mul(NZ)).mul(1 / (NZ * this.S)));
    return texture3D(tex, uvw).level(0);
  }

  /**
   * Raster statyki domeny sF w punkcie komórkowym pxy (vec2): teksel = komórka, przesunięcie a3.xy (okno zakotwiczone
   * w świecie), próbka liniowa obcięta do okna; > 0,5 = bryła. Lustro CPU: solidCpu.
   */
  _maskAt(pxy, sF, a3) {
    const MS = this.MS;
    const tq = clamp(pxy.add(a3.xy), vec2(0.5), vec2(MS - 0.5));
    return texture(this.maskTex, vec2(tq.x.mul(1 / MS), sF.mul(MS).add(tq.y).mul(1 / (MS * this.S)))).level(0).x;
  }

  /**
   * KOMÓRKA STAŁA w punkcie p domeny: bryła statyki (raster, gdy domena go ma — a2.w) albo kadłub z listy domeny
   * (maska obrysu w układzie kadłuba: q = K · (p − kotwica) + przesunięcie, próbka liniowa z pasma maski, próg 0,5).
   * Zwraca { solid (0 / 1), sv (prędkość przeszkody względem domeny [kom./s]) }. Statyka ma prędkość ściany (a3.zw:
   * −nośnik domeny), kadłub — prędkość ciała + ω × r (r w komórkach). Lustro CPU: solidCpu.
   */
  _solidAt(c, p, a1, a2, a3) {
    const U = this.U;
    const HM = GAS_HULL_MASK;
    const bands = this.hullBands;
    const solid = float(0.0).toVar();
    const sv = vec3(0.0).toVar();
    If(a2.w.greaterThan(0.5), () => {
      If(this._maskAt(p.xy, c.sF, a3).greaterThan(0.5), () => {
        solid.assign(1.0);
        sv.assign(vec3(a3.z, a3.w, 0.0));
      });
    });
    const h0 = int(c.a0.w.add(0.5));
    const hN = int(a1.x.add(0.5));
    Loop({ start: h0, end: h0.add(hN), type: 'int', condition: '<', name: 'ghull' }, ({ ghull }) => {
      const A = U.hullA.element(ghull).toVar();
      const B = U.hullB.element(ghull).toVar();
      const rel = p.xy.sub(A.xy).toVar();
      const q = vec2(dot(A.zw, rel), dot(B.xy, rel)).add(B.zw).toVar();
      If(q.x.greaterThan(0.0).and(q.x.lessThan(float(HM.w))).and(q.y.greaterThan(0.0)).and(q.y.lessThan(float(HM.h))), () => {
        const C = U.hullC.element(ghull).toVar();
        const mu = clamp(q.x, 0.5, HM.w - 0.5).mul(1 / HM.w);
        const mv = C.w.mul(HM.h).add(clamp(q.y, 0.5, HM.h - 0.5)).mul(1 / (HM.h * bands));
        If(texture(this.hullMaskTex, vec2(mu, mv)).level(0).x.greaterThan(0.5), () => {
          solid.assign(1.0);
          sv.assign(vec3(C.x.sub(C.z.mul(rel.y)), C.y.add(C.z.mul(rel.x)), 0.0));
        });
      });
    });
    return { solid, sv };
  }

  /**
   * Cel dywergencji komórki z pola den (x dym, w tempo spalania albo −tempo stygnięcia): rozprężanie spalania
   * (źródło objętości — kula ognia puchnie), kurczenie stygnącego gazu (F7) i rozprężanie zimnego dymu w próżni.
   * Wspólny dla kernela dywergencji i sondy (niedobieżność rzutu).
   */
  _rhsOf(div, D) {
    const U = this.U;
    // Kolejność działań jak przed etapem A (div − rozprężanie − rozpraszanie), kurczenie dodane na końcu — przy
    // contraction = 0 (w ≥ 0) wynik bit w bit dawny.
    return div.sub(max(D.w, 0.0).mul(U.expansion)).sub(min(D.x, 3.0).mul(U.disperse)).add(max(D.w.negate(), 0.0).mul(U.contraction));
  }

  _buildKernels() {
    const U = this.U;
    const N = this.N;
    const NZ = this.NZ;
    const cells = N * N * NZ * this.S;
    // Wielkości względne DOMENY (pas przy ścianach, szum brzegu elipsoidy) — skala boku względem nRef (atlas „fine”).
    const nS = N / this.nRef;
    const borderFade = nS === 1 ? U.borderFade : U.borderFade.mul(nS);
    const at = (tex, p, sF) => this._at(tex, p, sF);
    const noise = this.noise3D;

    // 1. Wiry z pola prędkości (przed adwekcją).
    this.curlNode = Fn(() => {
      const c = this._cell();
      const V = (dx, dy, dz) => at(this.velA, c.p.add(vec3(dx, dy, dz)), c.sF).xyz;
      const xp = V(1, 0, 0).toVar(); const xm = V(-1, 0, 0).toVar();
      const yp = V(0, 1, 0).toVar(); const ym = V(0, -1, 0).toVar();
      const zp = V(0, 0, 1).toVar(); const zm = V(0, 0, -1).toVar();
      const w = vec3(
        yp.z.sub(ym.z).sub(zp.y.sub(zm.y)),
        zp.x.sub(zm.x).sub(xp.z.sub(xm.z)),
        xp.y.sub(xm.y).sub(yp.x.sub(ym.x))
      ).mul(0.5).toVar();
      textureStore(this.curlT, c.store, vec4(w, length(w)));
    })().compute(cells).setName('gasCurl');

    // Źródła domeny: pętla po kapsułach p0–p1 z promieniem (brzeg zaburzony szumem 3D); each(w, C, D, B, d, dist).
    // Domena z rastrem statyki: źródło nie wstrzykuje przez bryłę — marsz po rastrze od komórki do POCZĄTKU kapsuły p0
    // (otwór strumienia, środek kłębu, poprzednia pozycja odłamka; krok ≤ 1 komórka do SRC_OCCLUSION_STEPS komórek;
    // bryły mają ≥ 2 teksle), bryła po drodze = brak wkładu (wybuch przy ścianie hali nie przebija jej kulą źródła).
    // Marsz do NAJBLIŻSZEGO punktu osi przepuszczał strumień bijący w ścianę: za ścianą oś kapsuły leży za nią, a marsz
    // w poprzek osi bryły nie przecina (przegląd etapu C, pkt 1 — komórki za ścianą miały pełny wkład).
    const forSources = (c, p, a2, a3, each) => {
      const s0 = int(c.a0.y.add(0.5));
      const sN = int(c.a0.z.add(0.5));
      Loop({ start: s0, end: s0.add(sN), type: 'int', condition: '<', name: 'gsrc' }, ({ gsrc }) => {
        const A = U.srcA.element(gsrc).toVar();
        const B = U.srcB.element(gsrc).toVar();
        const ab = B.xyz.sub(A.xyz).toVar();
        const t = clamp(dot(p.sub(A.xyz), ab).div(max(dot(ab, ab), 1e-4)), 0.0, 1.0);
        const d = p.sub(A.xyz.add(ab.mul(t))).toVar();
        const dist = length(d).toVar();
        const D = U.srcD.element(gsrc).toVar();
        If(dist.lessThan(A.w.mul(D.w.add(1.0))), () => {
          const C = U.srcC.element(gsrc).toVar();
          const nz = texture3D(noise, p.mul(float(0.12).div(c.kS)).add(vec3(a2.y, a2.y.mul(1.7), U.time.mul(0.31)))).level(0).x;
          const rEff = A.w.mul(float(1.0).add(D.w.mul(nz.sub(0.5).mul(2.0))));
          const w = float(1.0).sub(smoothstep(rEff.mul(0.45), max(rEff, 0.6), dist)).toVar();
          If(a2.w.greaterThan(0.5), () => {
            const toA = p.xy.sub(A.xy).toVar();
            const n = int(clamp(ceil(length(toA)), 1.0, SRC_OCCLUSION_STEPS)).toVar();
            Loop({ start: int(1), end: n.add(1), type: 'int', condition: '<', name: 'gocc' }, ({ gocc }) => {
              const pt = p.xy.sub(toA.mul(float(gocc).div(float(n))));
              w.mulAssign(select(this._maskAt(pt, c.sF, a3).greaterThan(0.5), float(0.0), float(1.0)));
            });
          });
          each(w, C, D, B, d, dist, nz);
        });
      });
    };
    // PRÓBKA BEZ KOMÓREK STAŁYCH: skalary w komórce stałej są 0, więc trójliniowa próbka przy ścianie mieszała gaz z zerami
    // bryły (śledzenie wstecz trafia w ścianę przy składowej prędkości od ściany) — pusty pas wzdłuż lica: 1. rząd komórek
    // przy ścianie miał ~1% dymu 2. rzędu (sonda, przegląd etapu C pkt 6). Udział komórek stałych w próbce = trójliniowa
    // flaga velA.w (te same wagi sprzętowe co skalary) — próbka / (1 − flaga) = średnia ważona samych komórek wolnych
    // (głęboko w bryle dzielnik ≥ 0,2). Bez komórki stałej w otoczeniu (flaga 0) — wynik bit w bit jak dawniej.
    const freeSample = (s, flag) => {
      const v = s.toVar();   // jedna próbka (select wkleja węzeł w obie gałęzie)
      return select(flag.greaterThan(1e-3), v.div(max(float(1.0).sub(flag), 0.2)), v);
    };
    // RK2 wstecz (punkt środkowy) z pola velA.
    const backtrace = (p, sF, dt) => {
      const v0 = at(this.velA, p, sF).xyz.toVar();
      const pm = p.sub(v0.mul(dt.mul(0.5)));
      const vm = at(this.velA, pm, sF).xyz.toVar();
      return { v0, pb: p.sub(vm.mul(dt)).toVar() };
    };

    // 2a. Surowa adwekcja (semi-Lagrange RK2 wstecz): skalary φ̂ i pozycja spoczynkowa; przy MacCormacku prędkości —
    // też v̂ do velC (korekcja w kroku 2b musi próbkować ZAPISANE pole v̂: v̂ policzone „w locie” w punkcie do przodu
    // daje z powrotem v w p i korekcję ≈ 0 — sprawdzone na lustrze CPU, test F4).
    this.advectNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const sF = c.sF;
      const dt = U.dt;
      const { pb } = backtrace(p, sF, dt);
      const vPb = at(this.velA, pb, sF).toVar();
      textureStore(this.denB, c.store, freeSample(at(this.denA, pb, sF), vPb.w));
      // Pozycja spoczynkowa: niesiona z gazem, powoli wraca do własnej komórki.
      const rest = at(this.restA, pb, sF).xyz;
      textureStore(this.restB, c.store, vec4(mix(rest, p, float(1.0).sub(exp(U.restRelax.negate().mul(dt)))), 0.0));
      If(U.velMacCormack.greaterThan(0.5), () => {
        textureStore(this.velC, c.store, vec4(vPb.xyz, 0.0));
      });
    })().compute(cells).setName('gasAdvect');

    // 2b. Prędkość i skalary. Prędkość: v̂ (semi-Lagrange) z korekcją MacCormacka (F4 audytu 2026-10-08: v̂ + ½(v − ṽ),
    // ṽ = v̂ z velC w punkcie do przodu p + v·dt, obcięte do min / max 8 komórek wokół punktu wstecz; gałąź po
    // jednolitym uniformie velMacCormack — A/B), źródła prędkości, przeszkody, siły (wiry, wypór, unoszenie,
    // turbulencja), opór → velB. Skalary: korekcja MacCormacka (φ̂ + ½(φ − φ̃), obcięta do sąsiadów — ostre kłęby bez
    // drgań), źródła, SPALANIE, stygnięcie, zanik, brzeg domeny → denC.
    this.reactNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const sF = c.sF;
      const dt = U.dt;
      const a1 = U.act.element(int(c.k).mul(4).add(1)).toVar();
      const a2 = U.act.element(int(c.k).mul(4).add(2)).toVar();
      const a3 = U.act.element(int(c.k).mul(4).add(3)).toVar();
      const { v0, pb } = backtrace(p, sF, dt);
      const b0 = pb.sub(0.5).floor().add(0.5).toVar();
      // Skala komórki domeny (GasSlot.k): siły, szum, sufit, opór w jednostkach komórek — strojenie niezależne od rozdzielczości.
      const kS = U.slotK.element(c.slotI).x.toVar();
      c.kS = kS;
      const fwd = p.add(v0.mul(dt)).toVar();

      // --- prędkość
      const vPb = at(this.velA, pb, sF).toVar();   // w — udział komórek stałych w próbce (freeSample)
      const vel = vPb.xyz.toVar();
      If(U.velMacCormack.greaterThan(0.5), () => {
        const vTilde = at(this.velC, fwd, sF).xyz;
        // v̂ w p z velC (ta sama precyzja co ṽ — jak skalary φ̂ z denB), korekcja ½(v − ṽ).
        const mcV = at(this.velC, p, sF).xyz.add(v0.sub(vTilde).mul(0.5)).toVar();
        const loV = vec3(1e6).toVar();
        const hiV = vec3(-1e6).toVar();
        for (let i = 0; i < 8; i++) {
          const s = at(this.velA, b0.add(vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1)), sF).xyz;
          loV.assign(min(loV, s));
          hiV.assign(max(hiV, s));
        }
        vel.assign(clamp(mcV, loV, hiV));
      });

      // --- skalary: MacCormack
      const phi = at(this.denA, p, sF).xyz;
      const hat = at(this.denB, p, sF).xyz.toVar();
      const tilde = freeSample(at(this.denB, fwd, sF), at(this.velA, fwd, sF).w).xyz;
      const mc = hat.add(phi.sub(tilde).mul(0.5)).toVar();
      // Obcięcie do min / max 8 komórek wokół punktu wstecz (stabilność, brak nowych ekstremów).
      const lo = vec3(1e6).toVar();
      const hi = vec3(-1e6).toVar();
      for (let i = 0; i < 8; i++) {
        const s = at(this.denA, b0.add(vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1)), sF).xyz;
        lo.assign(min(lo, s));
        hi.assign(max(hi, s));
      }
      const den = clamp(mc, lo, hi).toVar();
      const smoke = den.x.toVar();
      const temp = den.y.toVar();
      const fuel = den.z.toVar();

      // Źródła: prędkość (narzucona promieniowa od osi kapsuły — zaburzona szumem, front wychodzi „palcami”, nie gładką
      // kulą — i kierunkowa), paliwo (nierówno — drobny szum daje gorące kieszenie i chłodniejsze pasma), temperatura
      // (zapłon), dym.
      const fuelNoise = texture3D(noise, p.mul(float(0.19).div(kS)).add(vec3(a2.y.mul(2.3), a2.y, a2.y.mul(0.7)))).level(0).y;
      const fuelK = fuelNoise.mul(1.6).add(0.2).toVar();
      forSources(c, p, a2, a3, (w, C, D, B, d, dist, nz) => {
        const dir = d.div(max(dist, 0.35));
        const vTarget = dir.mul(C.w.mul(nz.mul(1.1).add(0.45))).add(D.xyz);
        vel.assign(mix(vel, vTarget, clamp(B.w.mul(w).mul(dt), 0.0, 1.0)));
        fuel.addAssign(C.x.mul(w).mul(dt).mul(fuelK));
        // Zapłon też nierówny (równa temperatura źródła dawała w pierwszej 0,1 s gładki czerwony dysk).
        temp.addAssign(C.y.mul(w).mul(dt).mul(fuelK.mul(0.7).add(0.3)));
        smoke.addAssign(C.z.mul(w).mul(dt));
      });

      // Siły: wzmacnianie wirów (ε h (N × ω)), wypór, unoszenie od środka wybuchu, turbulencja (2 oktawy) — z dymu i
      // temperatury po adwekcji (φ̂, jak dawniej), bez źródeł tej klatki.
      const denAdv = freeSample(at(this.denA, pb, sF), vPb.w).toVar();   // φ̂ w fp32 jak przed etapem A (denB to ta sama wartość w f16)
      const smokeF = denAdv.x;
      const tempF = denAdv.y;
      const W = (dx, dy, dz) => at(this.curlT, p.add(vec3(dx, dy, dz)), sF).w;
      const om = at(this.curlT, p, sF).xyz.toVar();
      const eta = vec3(W(1, 0, 0).sub(W(-1, 0, 0)), W(0, 1, 0).sub(W(0, -1, 0)), W(0, 0, 1).sub(W(0, 0, -1))).mul(0.5).toVar();
      const nv = eta.div(max(length(eta), 1e-4));
      const fvc = cross(nv, om).mul(U.vorticity.mul(kS));
      const fb = U.buoyDir.mul(tempF.mul(U.buoyancy).sub(smokeF.mul(U.sootWeight))).mul(kS);
      const rd = p.sub(a1.yzw).toVar();
      const fr = rd.div(max(length(rd), 1.0)).mul(tempF.mul(U.radialLift)).mul(kS);
      const turbScale = U.turbScale.div(kS);
      const tq = p.mul(turbScale).add(vec3(a2.y.mul(3.1), a2.y.mul(1.3), U.time.mul(0.6)));
      const n1 = texture3D(noise, tq).level(0).xy;
      const n2 = texture3D(noise, tq.mul(1.37).add(vec3(0.41, 0.17, 0.73))).level(0).x;
      const tq2 = p.mul(turbScale.mul(2.7)).add(vec3(a2.y.mul(1.7), U.time.mul(1.1), a2.y.mul(2.3)));
      const n3 = texture3D(noise, tq2).level(0).xy;
      const n4 = texture3D(noise, tq2.mul(1.29).add(vec3(0.63, 0.29, 0.11))).level(0).x;
      const turbW = clamp(tempF.mul(1.6).add(smokeF.mul(0.35)), 0.0, 1.0);
      const ft = vec3(n1.x, n1.y, n2).sub(0.5).mul(2.0).add(vec3(n3.x, n3.y, n4).sub(0.5).mul(1.1)).mul(U.turbulence.mul(kS)).mul(turbW);
      vel.addAssign(fvc.add(fb).add(fr).add(ft).mul(dt));
      // Opór: stały (drag) + GĄBKA przy brzegu domeny (F9 — elipsoida domeny od spongeStart i pas borderFade przy
      // ścianach) + kwadratowy tylko dla szybkiego frontu (pasmo dragFrontLo..Hi). W próżni oporu nie ma — gra
      // trzyma drag 0: wiry w środku obłoku żyją, gaz, który dochodzi do brzegu, gaśnie.
      const e = min(min(min(p.x, float(N).sub(p.x)), min(p.y, float(N).sub(p.y))), min(p.z, float(NZ).sub(p.z))).toVar();
      const halfD = vec3(N * 0.5, N * 0.5, NZ * 0.5);
      const rr = length(p.sub(halfD).div(halfD)).toVar();
      const spd = length(vel).toVar();
      const front = clamp(spd.sub(U.dragFrontLo.mul(kS)).div(max(U.dragFrontHi.sub(U.dragFrontLo).mul(kS), 1e-3)), 0.0, 1.0);
      const bandV = max(
        clamp(rr.sub(U.spongeStart).div(max(float(1.0).sub(U.spongeStart), 1e-3)), 0.0, 1.0),
        float(1.0).sub(clamp(e.sub(0.5).div(max(borderFade, 1e-3)), 0.0, 1.0))).toVar();
      const sponge = bandV.mul(bandV).mul(float(3.0).sub(bandV.mul(2.0)));
      const dragQuad = U.dragQuad.div(kS);
      const quad = select(U.dragFrontHi.greaterThan(U.dragFrontLo), dragQuad.mul(spd).mul(front), dragQuad.mul(spd));
      vel.mulAssign(exp(U.drag.add(U.sponge.mul(sponge)).add(quad).negate().mul(dt)));
      // KOMÓRKA STAŁA (bryła statyki, kadłub): prędkość przeszkody (dywergencja i rzut biorą ją jako warunek ściany),
      // bez gazu (zapis skalarów niżej), flaga w velB.w (dywergencja → prs.z, rzut → velA.w).
      const S0 = this._solidAt(c, p, a1, a2, a3);
      const isSolid = S0.solid.greaterThan(0.5).toVar();
      vel.assign(select(isSolid, S0.sv, vel));
      textureStore(this.velB, c.store, vec4(vel, S0.solid));

      // Spalanie paliwa: zapłon od temperatury, ciepło, sadza, rozprężanie (tempo w den.w).
      const ign = smoothstep(U.ignition, U.ignition.mul(1.8), temp);
      const burn = min(fuel, fuel.mul(U.burnRate).mul(ign).mul(dt)).toVar();
      fuel.subAssign(burn);
      temp.addAssign(burn.mul(U.heat));
      smoke.addAssign(burn.mul(U.soot));
      const burnRate = burn.div(dt);
      // Stygnięcie: Newton (szybsze w rzadkim gazie — brzeg kuli ognia stygnie pierwszy i owija ją
      // ciemna skóra sadzy) + promieniste ∝ T⁴; zanik dymu i paliwa.
      const thin = float(1.0).sub(smoothstep(0.15, 1.6, smoke));
      const cool = U.cooling.mul(thin.mul(U.edgeCooling).add(1.0));
      const t2 = temp.mul(temp);
      const tPre = temp.toVar();
      temp.assign(max(temp.mul(exp(cool.negate().mul(dt))).sub(t2.mul(t2).mul(U.radiative).mul(dt)), 0.0));
      // Kanał w: tempo spalania (płomień, rozprężanie) albo — w komórce bez spalania, przy włączonym kurczeniu (F7) —
      // MINUS tempo stygnięcia (cel dywergencji ujemny: stygnący gaz zasysa). Obraz i blask czytają max(w, 0).
      const coolRate = tPre.sub(temp).div(dt);
      const wOut = select(U.contraction.greaterThan(0.0).and(burnRate.lessThan(BURN_EPS)), coolRate.negate(), burnRate);
      smoke.mulAssign(exp(U.smokeDecay.add(a2.x).negate().mul(dt)));
      fuel.mulAssign(exp(U.fuelDecay.negate().mul(dt)));
      // Brzeg domeny: KULA z brzegiem zaburzonym szumem (0,74–0,97 promienia) + pas przy ścianach —
      // nasycona domena wygląda jak nieregularny obłok, nie pudło (reaktor wypełniał sześcian).
      const bn = texture3D(noise, p.mul(0.021 / nS).add(vec3(a2.y.mul(0.37), a2.y.mul(0.11), 0.5))).level(0).y;
      const ball = float(1.0).sub(smoothstep(0.74, 0.97, rr.add(bn.sub(0.5).mul(0.22))));
      const edge = smoothstep(0.0, borderFade, e.sub(0.5)).mul(ball);
      const edgeK = mix(exp(dt.mul(-9.0)), float(1.0), edge);
      smoke.mulAssign(edgeK);
      temp.mulAssign(edgeK);
      fuel.mulAssign(edgeK);
      textureStore(this.denC, c.store, select(isSolid, vec4(0.0), vec4(max(smoke, 0.0), temp, max(fuel, 0.0), wOut)));
    })().compute(cells).setName('gasReact');

    // 3. Dywergencja (prawa strona równania ciśnienia) z celem rozprężania. Sąsiad stały oddaje prędkość przeszkody
    // (velB w komórce stałej — gaz nie wnika w ścianę, kadłub w ruchu wypycha gaz), komórka stała: p = 0, rhs = 0,
    // flaga do prs.z (Jacobi, rzut).
    this.divNode = Fn(() => {
      const c = this._cell();
      const V = (dx, dy, dz) => at(this.velB, c.p.add(vec3(dx, dy, dz)), c.sF).xyz;
      const div = V(1, 0, 0).x.sub(V(-1, 0, 0).x).add(V(0, 1, 0).y.sub(V(0, -1, 0).y)).add(V(0, 0, 1).z.sub(V(0, 0, -1).z)).mul(0.5);
      const D = at(this.denC, c.p, c.sF);
      const rhs = this._rhsOf(div, D);
      const q0 = at(this.prsB, c.p, c.sF).x.mul(U.warm);
      const solid = at(this.velB, c.p, c.sF).w.greaterThan(0.5).toVar();
      textureStore(this.prsA, c.store, vec4(select(solid, float(0.0), q0), select(solid, float(0.0), rhs), select(solid, float(1.0), float(0.0)), 0.0));
    })().compute(cells).setName('gasDivergence');

    // Ciśnienie sąsiada (Jacobi, rzut): poza domeną 0 (otwarty brzeg), sąsiad stały — NEUMANN (p komórki: ściana nie
    // przenosi spadku ciśnienia — gaz się od niej odbija, nie przez nią przepływa). Flaga komórki stałej w prs.z.
    const prsNb = (src, c, C0, dx, dy, dz, inDomain) => {
      const s = at(src, c.p.add(vec3(dx, dy, dz)), c.sF).toVar();
      return select(inDomain, select(s.z.greaterThan(0.5), C0.x, s.x), float(0.0));
    };

    // 4. Jacobi: q = (Σ sąsiadów − rhs) / 6; komórka stała zostaje 0.
    const jacobi = (src, dst, name) => Fn(() => {
      const c = this._cell();
      const C0 = at(src, c.p, c.sF).toVar();
      const xp = prsNb(src, c, C0, 1, 0, 0, c.xi.lessThan(int(N - 1)));
      const xm = prsNb(src, c, C0, -1, 0, 0, c.xi.greaterThan(int(0)));
      const yp = prsNb(src, c, C0, 0, 1, 0, c.yi.lessThan(int(N - 1)));
      const ym = prsNb(src, c, C0, 0, -1, 0, c.yi.greaterThan(int(0)));
      const zp = prsNb(src, c, C0, 0, 0, 1, c.zi.lessThan(int(NZ - 1)));
      const zm = prsNb(src, c, C0, 0, 0, -1, c.zi.greaterThan(int(0)));
      const q = xp.add(xm).add(yp).add(ym).add(zp).add(zm).sub(C0.y).div(6.0);
      textureStore(dst, c.store, vec4(select(C0.z.greaterThan(0.5), float(0.0), q), C0.y, C0.z, 0.0));
    })().compute(cells).setName(name);
    this.jacAB = jacobi(this.prsA, this.prsB, 'gasJacobiAB');
    this.jacBA = jacobi(this.prsB, this.prsA, 'gasJacobiBA');

    // 5. Rzut: v −= ∇q (sąsiad stały — Neumann); komórka stała — prędkość przeszkody; flaga do velA.w (adwekcja
    // następnego kroku widzi przeszkodę w próbkach — żar gazu, sonda); skalary do tekstur startowych.
    this.projectNode = Fn(() => {
      const c = this._cell();
      const P = (dx, dy, dz) => at(this.prsB, c.p.add(vec3(dx, dy, dz)), c.sF).toVar();
      const C0 = P(0, 0, 0);
      const Sxp = P(1, 0, 0), Sxm = P(-1, 0, 0), Syp = P(0, 1, 0), Sym = P(0, -1, 0), Szp = P(0, 0, 1), Szm = P(0, 0, -1);
      const inXp = c.xi.lessThan(int(N - 1)), inXm = c.xi.greaterThan(int(0));
      const inYp = c.yi.lessThan(int(N - 1)), inYm = c.yi.greaterThan(int(0));
      const nb = (s, inDomain) => select(inDomain, select(s.z.greaterThan(0.5), C0.x, s.x), float(0.0));
      const grad = vec3(nb(Sxp, inXp).sub(nb(Sxm, inXm)), nb(Syp, inYp).sub(nb(Sym, inYm)),
        nb(Szp, c.zi.lessThan(int(NZ - 1))).sub(nb(Szm, c.zi.greaterThan(int(0))))).mul(0.5);
      const vb = at(this.velB, c.p, c.sF).toVar();
      const v = vb.xyz.sub(grad).toVar();
      // Sufit prędkości gazu PRZED warunkiem ściany i nie w komórce stałej: kadłub szybszy niż maxSpeed względem domeny
      // (h 5–9 j. → 550–1000 j/s; gracz z dopalaczem 1500 j/s w dymie małego wybuchu) pcha gaz z własną prędkością — sufit
      // po obcięciu zjadał ją i kadłub połykał dym (przegląd etapu C, pkt 8).
      const kS = U.slotK.element(c.slotI).x.toVar();
      v.mulAssign(min(float(1.0), U.maxSpeed.mul(kS).div(max(length(v), 1e-3))));
      // BEZ WNIKANIA (free-slip): rzut na siatce kolokowanej zostawia przy ścianie składową normalną w ścianę — gaz
      // płynąłby w komórkę stałą i tam znikał (zerowanie skalarów w bryle). Składowa ku sąsiadowi stałemu nie większa niż
      // prędkość przeszkody w tej osi (ściana nadjeżdżająca pcha gaz, odjeżdżająca go nie ciągnie); styczna wolna. Bryły
      // to pryzmaty przez całą wysokość domeny — sąsiedzi stali tylko w x i y. Flagi z tych samych odczytów prs (z).
      const wXp = Sxp.z.greaterThan(0.5).and(inXp), wXm = Sxm.z.greaterThan(0.5).and(inXm);
      const wYp = Syp.z.greaterThan(0.5).and(inYp), wYm = Sym.z.greaterThan(0.5).and(inYm);
      const den = at(this.denC, c.p, c.sF).toVar();
      If(vb.w.lessThan(0.5).and(wXp.or(wXm).or(wYp).or(wYm)), () => {
        const kb = U.wallBlock;
        const fillK = U.wallFill.mul(U.dt).div(kS);
        // Ściana w osi: obcięcie składowej, potem dopływ skalarów z sąsiada od wnętrza w tempie zabranej prędkości (wallFill).
        const wall = (cond, comp, d, isMin) => If(cond, () => {
          const v0 = v[comp].toVar();
          const w = at(this.velB, c.p.add(vec3(d[0], d[1], 0)), c.sF)[comp];
          v[comp].assign(isMin ? min(v[comp], mix(v[comp], w, kb)) : max(v[comp], mix(v[comp], w, kb)));
          If(U.wallFill.greaterThan(0.0), () => {
            const removed = abs(v0.sub(v[comp]));
            den.assign(mix(den, at(this.denC, c.p.sub(vec3(d[0], d[1], 0)), c.sF), min(float(1.0), fillK.mul(removed))));
          });
        });
        wall(wXp, 'x', [1, 0], true);
        wall(wXm, 'x', [-1, 0], false);
        wall(wYp, 'y', [0, 1], true);
        wall(wYm, 'y', [0, -1], false);
      });
      v.assign(select(vb.w.greaterThan(0.5), vb.xyz, v));
      textureStore(this.velA, c.store, vec4(v, vb.w));
      textureStore(this.denA, c.store, den);
      textureStore(this.restA, c.store, at(this.restB, c.p, c.sF));
    })().compute(cells).setName('gasProject');

    // Zerowanie domen zajętych na nowo (flaga w act[4k+2].z).
    this.clearNode = Fn(() => {
      const c = this._cell();
      const a2 = U.act.element(int(c.k).mul(4).add(2));
      If(a2.z.lessThan(0.5), () => { Return(); });
      textureStore(this.velA, c.store, vec4(0.0));
      textureStore(this.denA, c.store, vec4(0.0));
      textureStore(this.prsB, c.store, vec4(0.0));
      textureStore(this.restA, c.store, vec4(c.p, 0.0));
    })().compute(cells).setName('gasClear');

    // Objętość światła: przepuszczalność ku słońcu i blask ognia (raz na klatkę).
    this.lightNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const sF = c.sF;
      const tau = float(0.0).toVar();
      // Skala komórki domeny: marsz ku słońcu i promienie blasku w tej samej odległości od kuli (komórki × k); gęstość
      // optyczna na komórkę / k — τ = Σ dym · krok · cień bez zmian.
      const kS = U.slotK.element(c.slotI).x.toVar();
      const lightStep = U.lightStep.mul(kS);
      for (let i = 1; i <= LIGHT_STEPS; i++) {
        const q = p.add(U.sunDir.mul(lightStep.mul(i)));
        const inside = q.x.greaterThan(0.0).and(q.x.lessThan(float(N))).and(q.y.greaterThan(0.0)).and(q.y.lessThan(float(N)))
          .and(q.z.greaterThan(0.0)).and(q.z.lessThan(float(NZ)));
        tau.addAssign(select(inside, at(this.denA, q, sF).x, float(0.0)));
      }
      const sunT = exp(tau.mul(U.lightStep).mul(U.shadow).negate());
      const glow = vec3(0.0).toVar();
      for (const dir of GLOW_DIRS) {
        for (const r of GLOW_RADII) {
          const s = at(this.denA, p.add(vec3(dir[0] * r, dir[1] * r, dir[2] * r).mul(kS)), sF);
          const pw = gasFirePower(s.y, s.w, U.fireGain, U.fireBurn);
          glow.addAssign(gasBlackbody(s.y).mul(pw).mul(1 / (1 + r * r * 0.06)));
        }
      }
      If(U.glowFar.greaterThan(0.0), () => {
        const far = vec3(0.0).toVar();
        const r = GLOW_FAR_RADIUS;
        for (const dir of GLOW_FAR_DIRS) {
          const s = at(this.denA, p.add(vec3(dir[0] * r, dir[1] * r, dir[2] * r).mul(kS)), sF);
          far.addAssign(gasBlackbody(s.y).mul(gasFirePower(s.y, s.w, U.fireGain, U.fireBurn)));
        }
        glow.addAssign(far.mul(U.glowFar.mul(1 / (1 + r * r * 0.06))));
      });
      const g = glow.mul(U.glow.div(GLOW_DIRS.length * GLOW_RADII.length * 0.5));
      textureStore(this.lightT, c.store, vec4(sunT, g));
    })().compute(cells).setName('gasLight');
  }

  _syncTune() {
    const T = this.tune;
    const U = this.U;
    for (const key of ['ignition', 'burnRate', 'heat', 'soot', 'expansion', 'cooling', 'radiative', 'smokeDecay',
      'fuelDecay', 'edgeCooling', 'restRelax', 'disperse', 'drag', 'dragQuad', 'vorticity', 'turbulence', 'turbScale', 'buoyancy', 'sootWeight', 'radialLift',
      'dragFrontLo', 'dragFrontHi', 'sponge', 'spongeStart', 'velMacCormack', 'contraction',
      'maxSpeed', 'wallBlock', 'wallFill', 'borderFade', 'warm', 'shadow', 'lightStep', 'fireGain', 'fireBurn', 'glow', 'glowFar']) {
      U[key].value = T[key];
    }
    const b = T.buoyDir;
    const bl = Math.hypot(b[0], b[1], b[2]) || 1;
    U.buoyDir.value.set(b[0] / bl, b[1] / bl, b[2] / bl);
  }

  // --- CPU: domeny ---------------------------------------------------------------

  /**
   * Domena dla zdarzenia w punkcie (x, y, z) sceny o promieniu `radius` [j.]. Wybuch w środku
   * żywej domeny (z zapasem) dokłada się do niej (dłuższe życie) — sąsiednie wybuchy mieszają się
   * w jednym płynie, bez nakładania pudeł. Bez wolnej domeny — zabiera najstarszą.
   * @returns {number} indeks domeny albo −1
   * opts: size [j.] (bok domeny; domyślnie 4 × promień), offset [x,y,z] (przesunięcie środka domeny,
   * np. ku górze dla dymu z wyporem), life [s] (życie po ostatnim zasileniu), carrier [vx,vy,vz],
   * tint [r,g,b], now [s] (zegar wołającego), reuse (domyślnie true), tag.
   */
  acquire(x, y, z, radius, opts = {}) {
    this._allocate();
    const now = opts.now ?? this.time;
    const life = opts.life ?? 12;
    const size = opts.size ?? radius * 4;
    if (opts.reuse !== false) {
      for (let i = 0; i < this.S; i++) {
        const s = this.slots[i];
        if (!s.active || s.until < now) continue;
        const half = s.h * this.N * 0.5;
        const m = half * 0.62 - radius;
        if (m <= 0) continue;
        // Pion: domena może być płaska (NZ < N) — wystarczy, że punkt leży w jej środkowym pasie.
        if (Math.abs(x - s.cx) < m && Math.abs(y - s.cy) < m && Math.abs(z - s.cz) < s.h * this.NZ * 0.3 && s.canHost(opts.host || 0)) {
          s.until = Math.max(s.until, now + life);
          s.rx = x; s.ry = y; s.rz = z;
          s.addHost(opts.host || 0);
          s._fedRaster = true;
          return i;
        }
      }
    }
    let pick = -1;
    for (let i = 0; i < this.S; i++) if (!this.slots[i].active) { pick = i; break; }
    if (pick < 0) {
      let best = Infinity;
      for (let i = 0; i < this.S; i++) {
        const s = this.slots[i];
        if (s.until < best) { best = s.until; pick = i; }
      }
      this.stats.dropped++;
    }
    if (pick < 0) return -1;
    const s = this.slots[pick];
    const off = opts.offset;
    s.active = true;
    s.cx = x + (off ? off[0] : 0);
    s.cy = y + (off ? off[1] : 0);
    s.cz = z + (off ? off[2] : 0);
    s.h = size / this.N;
    const car = opts.carrier;
    s.vx = car ? car[0] : 0; s.vy = car ? car[1] : 0; s.vz = car ? car[2] : 0;
    s.rx = x; s.ry = y; s.rz = z;
    s.born = now;
    s.fed = now;
    s.until = now + life;
    s.fastRise = false;
    s.fade = 1;
    s.extraDecay = 0;
    s.seed = this.rng.next() * 17.0;
    s.clear = true;
    const tint = opts.tint;
    s.tint[0] = tint ? tint[0] : 1; s.tint[1] = tint ? tint[1] : 1; s.tint[2] = tint ? tint[2] : 1;
    // Paleta ognia, stały zanik dymu i czas wygaszania domeny (wylot działa: krótki, ostry dym — etap E1; wybuchy: dawne).
    s.fire = Math.max(0, Math.min(GAS_FIRE_MAX, Number(opts.fire) || 0));
    s.ambient = Math.max(0, Number(opts.ambient) || 0);
    s.baseDecay = Math.max(0, Number(opts.baseDecay) || 0);
    s.fadeTime = Number(opts.fadeTime) > 0 ? Number(opts.fadeTime) : 1.6;
    s.extraDecay = s.baseDecay;
    s.tag = opts.tag ?? 0;
    s.priority = opts.priority ?? 0;
    s.k = Number(opts.k) > 0 ? Number(opts.k) : 1;
    // Gospodarz (klucz rodu kadłuba wybuchającego okrętu — jego wrak nie jest przeszkodą tego gazu). Raster statyki
    // w kroku efektów (updateRasters — po świeżej statyce tej klatki: kawałek doku, który właśnie pęka, już bez bryły),
    // przed reżyserem emiterów i symulacją.
    s.hostN = 0;
    s.addHost(opts.host || 0);
    s.maskVer = -1;
    s.maskVerAt = -1e9;
    s.maskOn = false;
    s._maskStale = true;
    s._fedRaster = false;
    return pick;
  }

  /** Zwalnia domenę od razu (bez wygaszania). */
  release(slot) {
    const s = this.slots[slot];
    if (s) { s.active = false; s.clear = true; s.hostN = 0; }
  }

  /**
   * Zasilenie domeny NOWYM wybuchem (scalenie, wtórny): życie do `until`, czas zasilenia = teraz. Domena w wygaszaniu
   * odżywa od razu — zanik dymu zerowany (świeża kula nie gaśnie razem z resztkami), obraz wraca w ~0,1 s
   * (FADE_RISE_FAST); zwykłe przedłużenie (`keepAlive`, ognisko) wraca rampą FADE_RISE.
   */
  feed(slot, until) {
    const s = this.slots[slot];
    if (!s || !s.active) return;
    s.until = Math.max(s.until, until);
    s.fed = this.time;
    s._fedRaster = true;
    if (s.fade < 1 || s.extraDecay > s.baseDecay) { s.extraDecay = s.baseDecay; s.fastRise = true; }
  }

  /** Przedłuża życie domeny (zasilanie pożarem). */
  keepAlive(slot, until) {
    const s = this.slots[slot];
    if (s && s.active) s.until = Math.max(s.until, until);
  }

  /** Czy punkt (scena) leży w domenie (z marginesem w komórkach). */
  contains(slot, x, y, z, marginCells = 2) {
    const s = this.slots[slot];
    if (!s || !s.active) return false;
    const half = s.h * (this.N * 0.5 - marginCells);
    const halfZ = s.h * Math.max(0.5, this.NZ * 0.5 - marginCells);
    return Math.abs(x - s.cx) < half && Math.abs(y - s.cy) < half && Math.abs(z - s.cz) < halfZ;
  }

  /** Domena zawierająca punkt (pierwsza z aktywnych) albo −1. */
  slotAt(x, y, z, marginCells = 2) {
    for (let i = 0; i < this.S; i++) if (this.contains(i, x, y, z, marginCells)) return i;
    return -1;
  }

  /**
   * Źródło w tej klatce (świat sceny, double): kapsuła (x0,y0,z0)–(x1,y1,z1), promień r [j.];
   * tempa na sekundę: paliwo, temperatura, dym; prędkość promieniowa od osi kapsuły [j./s];
   * prędkość kierunkowa (vx, vy, vz) [j./s]; velBlend — siła narzucenia prędkości [1/s];
   * noise — zaburzenie promienia szumem (0..1).
   */
  source(slot, x0, y0, z0, x1, y1, z1, r, fuel, temp, smoke, radial, vx, vy, vz, velBlend, noise) {
    const i = this._srcN;
    if (i >= this.maxSources || slot < 0) { this.stats.dropped++; return false; }
    this._srcN = i + 1;
    this._srcSlot[i] = slot;
    const o = i * 18;
    const A = this._src;
    A[o] = x0; A[o + 1] = y0; A[o + 2] = z0; A[o + 3] = x1; A[o + 4] = y1; A[o + 5] = z1;
    A[o + 6] = r; A[o + 7] = fuel; A[o + 8] = temp; A[o + 9] = smoke; A[o + 10] = radial;
    A[o + 11] = vx; A[o + 12] = vy; A[o + 13] = vz; A[o + 14] = velBlend; A[o + 15] = noise;
    return true;
  }

  // --- PRZESZKODY ------------------------------------------------------------------------------------------------

  /**
   * STATYKA (budowle) w scenie: `boxes` — pudła po 6 liczb (środek x, y, oś u — jednostkowa, pół długości wzdłuż u,
   * pół szerokości), `foots` — obrysy (rekordy GAS_HULL_REC: ruszone kawałki budowli, ich maska z żywych węzłów).
   * Nowa wersja = nowy raster domen (najwyżej co STATIC_MIN_INTERVAL s na domenę). Dane kopiowane.
   */
  setStatics(version, boxes, nBoxes, foots = null, nFoots = 0) {
    const nb = Math.max(0, Math.min(nBoxes | 0, this.maxBoxes));
    const nf = foots ? Math.max(0, Math.min(nFoots | 0, this.maxFoots)) : 0;
    if (nb > 0) this._boxes.set(boxes.subarray ? boxes.subarray(0, nb * 6) : boxes.slice(0, nb * 6));
    if (nf > 0) this._foots.set(foots.subarray ? foots.subarray(0, nf * GAS_HULL_REC.stride) : foots.slice(0, nf * GAS_HULL_REC.stride));
    this._boxN = nb;
    this._footN = nf;
    this.staticVersion = version;
  }

  /**
   * KADŁUB-przeszkoda w tej klatce (scena): rekord GAS_HULL_REC — kopiowany z `src` od `o` (współrzędne już w scenie:
   * x gry, −y gry; ω w scenie = −ω gry). Trafia do domen, które przecina (poza tymi, których jest gospodarzem).
   */
  hull(src, o = 0) {
    const i = this._hullN;
    if (i >= this._hullCap) { this.stats.hullsDropped++; return false; }
    this._hullN = i + 1;
    const R = GAS_HULL_REC.stride;
    for (let k = 0; k < R; k++) this._hull[i * R + k] = src[o + k];
    return true;
  }

  /** Czy punkt sceny (x, y) leży w bryle statyki domeny (raster jak w kernelu — próbka liniowa, próg 0,5). */
  solidAt(slot, x, y) {
    const s = this.slots[slot];
    if (!s || !s.active || !s.maskOn) return false;
    return this._rasterSample(s, (x - s.mox) / s.h, (y - s.moy) / s.h) > 0.5;
  }

  /**
   * Najbliższy wolny punkt rastra statyki domeny do (x, y) sceny w promieniu `maxCells` komórek (środek źródła wybuchu
   * w bryle — źródło przesunięte, nie zjedzone). Zwraca false, gdy punkt jest wolny albo wolnego nie ma (out bez zmian).
   */
  freePoint(slot, x, y, maxCells = FREE_SEARCH, out) {
    const s = this.slots[slot];
    if (!this.solidAt(slot, x, y)) return false;
    const MS = this.MS, h = s.h, D = this.maskData, base = s.index * MS * MS;
    const ci = Math.floor((x - s.mox) / h), cj = Math.floor((y - s.moy) / h);
    const R = Math.max(1, maxCells | 0);
    let best = Infinity, bi = -1, bj = -1;
    for (let j = Math.max(0, cj - R); j <= Math.min(MS - 1, cj + R); j++) {
      for (let i = Math.max(0, ci - R); i <= Math.min(MS - 1, ci + R); i++) {
        if (D[base + j * MS + i] !== 0) continue;
        // wolny teksel z wolnymi sąsiadami (środek nie na brzegu bryły — próbka liniowa < 0,5 z zapasem)
        if (i > 0 && D[base + j * MS + i - 1]) continue;
        if (i < MS - 1 && D[base + j * MS + i + 1]) continue;
        if (j > 0 && D[base + (j - 1) * MS + i]) continue;
        if (j < MS - 1 && D[base + (j + 1) * MS + i]) continue;
        const dx = s.mox + (i + 0.5) * h - x, dy = s.moy + (j + 0.5) * h - y;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    if (bi < 0) return false;
    out.x = s.mox + (bi + 0.5) * h;
    out.y = s.moy + (bj + 0.5) * h;
    return true;
  }

  /**
   * Odcinek sceny (x0, y0) → (x1, y1) przez bryły statyki domeny: zablokowany — `out` = ostatni wolny punkt przed bryłą
   * (cofnięty o pół komórki), zwraca true. Źródło gazu wybuchu leży po stronie jego środka (kłąb za cienką ścianą,
   * wybuch wtórny za bramą — inaczej gaz pojawiałby się za ścianą). Początek w bryle albo bez brył — false.
   */
  clipSegment(slot, x0, y0, x1, y1, out) {
    const s = this.slots[slot];
    if (!s || !s.active || !s.maskOn) return false;
    if (this.solidAt(slot, x0, y0)) return false;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const step = s.h * 0.5;
    const n = Math.ceil(len / step);
    if (n < 1) return false;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (this.solidAt(slot, x0 + dx * t, y0 + dy * t)) {
        // ostatnia wolna próbka (k − 1) cofnięta o pół kroku (ćwierć komórki) od bryły
        const tb = Math.max(0, (k - 1) / n - (0.5 * step) / len);
        out.x = x0 + dx * tb;
        out.y = y0 + dy * tb;
        return true;
      }
    }
    return false;
  }

  // Próbka liniowa rastra statyki domeny w tekslach (środki teksli w k + 0,5), obcięta do okna — jak w kernelu.
  _rasterSample(s, tx, ty) {
    const MS = this.MS;
    const qx = Math.min(MS - 0.5, Math.max(0.5, tx)) - 0.5;
    const qy = Math.min(MS - 0.5, Math.max(0.5, ty)) - 0.5;
    const i0 = Math.floor(qx), j0 = Math.floor(qy);
    const fx = qx - i0, fy = qy - j0;
    const i1 = Math.min(MS - 1, i0 + 1), j1 = Math.min(MS - 1, j0 + 1);
    const D = this.maskData, base = s.index * MS * MS;
    const a = D[base + j0 * MS + i0] * (1 - fx) + D[base + j0 * MS + i1] * fx;
    const b = D[base + j1 * MS + i0] * (1 - fx) + D[base + j1 * MS + i1] * fx;
    return (a * (1 - fy) + b * fy) / 255;
  }

  /**
   * Raster statyki domeny: okno MS × MS teksli (teksel = komórka) zakotwiczone w świecie wokół domeny, przesunięte
   * w stronę nośnika (domena jedzie przez okno, nowe okno dopiero przed jego brzegiem). Bryły rosną o
   * GAS_STATIC_GROW komórki z każdej strony (cienka ściana ma ≥ 2 teksle — bez przecieku; środek teksla w zasięgu
   * 0,75 komórki od bryły = bryła przecina teksel).
   */
  _rasterSlot(s) {
    const t0 = performance.now();
    const MS = this.MS, N = this.N, h = s.h, inv = 1 / h;
    const D = this.maskData, base = s.index * MS * MS;
    const slack = Math.max(0, (MS - N) * 0.5 - 2);
    const spd = Math.sqrt(s.vx * s.vx + s.vy * s.vy) * inv;   // [kom./s]
    const shift = spd > 1e-6 ? Math.min(slack, spd * RASTER_LOOKAHEAD) : 0;
    const ux = spd > 1e-6 ? s.vx * inv / spd : 0, uy = spd > 1e-6 ? s.vy * inv / spd : 0;
    // Róg okna na siatce świata o boku h (kolejne okna domeny — nowe przy brzegu albo po zmianie budowli — mają te same
    // środki teksli): dowolna faza rogu przesuwała lico ściany w rastrze do ~1 komórki przy każdym nowym oknie (skok
    // ściany względem gazu; przegląd etapu C pkt 5). Przesunięcie < 1 komórki mieści się w zapasie okna.
    s.mox = Math.floor((s.cx + ux * shift * h) * inv - MS * 0.5) * h;
    s.moy = Math.floor((s.cy + uy * shift * h) * inv - MS * 0.5) * h;
    const wasOn = s.maskOn || s._maskStale;
    if (wasOn) D.fill(0, base, base + MS * MS);
    s._maskStale = false;
    let any = false;
    const m = GAS_STATIC_GROW * h;
    const wx0 = s.mox, wy0 = s.moy, wx1 = s.mox + MS * h, wy1 = s.moy + MS * h;
    // Pudła.
    const B = this._boxes;
    for (let b = 0; b < this._boxN; b++) {
      const o = b * 6;
      const cx = B[o], cy = B[o + 1], bux = B[o + 2], buy = B[o + 3];
      const hw = B[o + 4] + m, hd = B[o + 5] + m;
      const ex = Math.abs(bux) * hw + Math.abs(buy) * hd, ey = Math.abs(buy) * hw + Math.abs(bux) * hd;
      if (cx + ex < wx0 || cx - ex > wx1 || cy + ey < wy0 || cy - ey > wy1) continue;
      const i0 = Math.max(0, Math.floor((cx - ex - wx0) * inv)), i1 = Math.min(MS - 1, Math.floor((cx + ex - wx0) * inv));
      const j0 = Math.max(0, Math.floor((cy - ey - wy0) * inv)), j1 = Math.min(MS - 1, Math.floor((cy + ey - wy0) * inv));
      for (let j = j0; j <= j1; j++) {
        const dy = wy0 + (j + 0.5) * h - cy;
        const row = base + j * MS;
        for (let i = i0; i <= i1; i++) {
          const dx = wx0 + (i + 0.5) * h - cx;
          const u = dx * bux + dy * buy;
          const v = dy * bux - dx * buy;
          if (u <= hw && u >= -hw && v <= hd && v >= -hd) { D[row + i] = 255; any = true; }
        }
      }
    }
    // Obrysy (ruszone kawałki budowli): teksel w zasięgu m od zapalonego bitu maski (w układzie kadłuba).
    const F = this._foots, RS = GAS_HULL_REC.stride, HR = GAS_HULL_REC, HM = GAS_HULL_MASK;
    for (let f = 0; f < this._footN; f++) {
      const o = f * RS;
      const ax = F[o + HR.ax], ay = F[o + HR.ay], reach = F[o + HR.reach] + m;
      if (ax + reach < wx0 || ax - reach > wx1 || ay + reach < wy0 || ay - reach > wy1) continue;
      const ex = F[o + HR.ex], ey = F[o + HR.ey], fx = F[o + HR.fx], fy = F[o + HR.fy];
      const x0 = F[o + HR.x0], y0 = F[o + HR.y0], tx = F[o + HR.tx] > 0 ? F[o + HR.tx] : 1, ty = F[o + HR.ty] > 0 ? F[o + HR.ty] : 1;
      const i0 = Math.max(0, Math.floor((ax - reach - wx0) * inv)), i1 = Math.min(MS - 1, Math.floor((ax + reach - wx0) * inv));
      const j0 = Math.max(0, Math.floor((ay - reach - wy0) * inv)), j1 = Math.min(MS - 1, Math.floor((ay + reach - wy0) * inv));
      for (let j = j0; j <= j1; j++) {
        const ry = wy0 + (j + 0.5) * h - ay;
        const row = base + j * MS;
        for (let i = i0; i <= i1; i++) {
          if (D[row + i]) continue;
          const rx = wx0 + (i + 0.5) * h - ax;
          const X = ex * rx + ey * ry, Y = fx * rx + fy * ry;
          let ka = Math.floor((X - m - x0) / tx), kb = Math.floor((X + m - x0) / tx);
          let la = Math.floor((Y - m - y0) / ty), lb = Math.floor((Y + m - y0) / ty);
          if (kb < 0 || la > HM.h - 1 || lb < 0 || ka > HM.w - 1) continue;
          if (ka < 0) ka = 0; if (kb > HM.w - 1) kb = HM.w - 1; if (la < 0) la = 0; if (lb > HM.h - 1) lb = HM.h - 1;
          let hit = false;
          for (let l = la; l <= lb && !hit; l++) {
            for (let k = ka; k <= kb; k++) {
              const bit = l * HM.w + k;
              if ((F[o + HR.mask + (bit >>> 5)] >>> (bit & 31)) & 1) { hit = true; break; }
            }
          }
          if (hit) { D[row + i] = 255; any = true; }
        }
      }
    }
    s.maskOn = any;
    if (s.maskVer >= 0 && s.maskVer !== this.staticVersion) s.maskVerAt = this.time;
    s.maskVer = this.staticVersion;
    s.maskAt = this.time;
    s._fedRaster = false;
    if (any || wasOn) this._maskDirty = true;
    this.stats.rasters++;
    this.stats.rasterMs += performance.now() - t0;
  }

  /** Początek klatki: liczniki klatki (rastry statyki, ich czas). */
  beginFrame() {
    this.stats.rasters = 0;
    this.stats.rasterMs = 0;
  }

  /**
   * Rastry statyki aktywnych domen, które ich potrzebują (nowa domena, zmiana budowli, okno przy brzegu) — reżyser woła
   * po świeżej statyce tej klatki, przed emiterami (solidAt, freePoint); simulate — jeszcze raz (bez pracy, gdy gotowe).
   */
  updateRasters() {
    const now = this.time;
    for (let i = 0; i < this.S; i++) {
      const s = this.slots[i];
      if (s.active && this._needsRaster(s, now)) this._rasterSlot(s);
    }
  }

  // Domena potrzebuje nowego rastra statyki: nowa domena, nowa wersja budowli (seria zmian — najwyżej co
  // STATIC_MIN_INTERVAL s; pierwsza od razu; domena zasilona NOWYM wybuchem — od razu: jego emitery przesuwają źródła
  // z brył raz, przy pierwszym wstrzyknięciu — na starym rastrze rdzeń wybuchu pękającego kawałka doku jechał na brzeg
  // nieistniejącej już bryły; przegląd etapu C pkt 2) albo okno przy brzegu (domena dojechała z nośnikiem).
  _needsRaster(s, now) {
    if (s.maskVer < 0) return true;
    if (s.maskVer !== this.staticVersion && (s._fedRaster || now - s.maskVerAt >= STATIC_MIN_INTERVAL)) return true;
    if (!s.maskOn && !this._boxN && !this._footN) return false;
    const MS = this.MS, N = this.N;
    const ox = (s.cx - s.mox) / s.h - N * 0.5, oy = (s.cy - s.moy) / s.h - N * 0.5;
    return ox < 1 || oy < 1 || ox + N > MS - 1 || oy + N > MS - 1;
  }

  // Pasmo tekstury masek obrysu dla rekordu kadłuba (uid, wersja maski): pamięć LRU; bity rozpakowane tylko przy
  // zmianie maski. −1 — wszystkie pasma zajęte w tej klatce.
  _bandFor(H, o) {
    const HR = GAS_HULL_REC;
    const uid = H[o + HR.uid], ver = H[o + HR.ver];
    const nb = this.hullBands;
    let band = -1;
    for (let b = 0; b < nb; b++) if (this._bandUid[b] === uid) { band = b; break; }
    if (band < 0) {
      let oldest = Infinity;
      for (let b = 0; b < nb; b++) {
        if (this._bandUsed[b] === this._frame && this._bandUid[b] >= 0) continue;
        if (this._bandUsed[b] < oldest) { oldest = this._bandUsed[b]; band = b; }
      }
      if (band < 0) return -1;
      this._bandUid[band] = uid;
      this._bandVer[band] = -1;
    }
    this._bandUsed[band] = this._frame;
    if (this._bandVer[band] !== ver) {
      const HM = GAS_HULL_MASK, D = this.hullMaskData, base = band * HM.w * HM.h;
      for (let k = 0; k < HM.w * HM.h; k++) D[base + k] = ((H[o + HR.mask + (k >>> 5)] >>> (k & 31)) & 1) ? 255 : 0;
      this._bandVer[band] = ver;
      this._hullMaskDirty = true;
      this.stats.bandUploads++;
    }
    return band;
  }

  /** Czy jakaś domena żyje. */
  get live() {
    for (let i = 0; i < this.S; i++) if (this.slots[i].active) return true;
    return false;
  }

  /**
   * Krok klatki: domeny (nośnik, życie, wygaszanie), pakowanie źródeł i przeszkód, podkroki
   * symulacji i objętość światła — wszystko w JEDNYM renderer.compute(lista). Źródła i
   * przeszkody tej klatki trzeba dodać przed wywołaniem (kasowane na końcu).
   */
  simulate(renderer, dt) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.time += dt;
    const now = this.time;
    // Domeny: ruch z nośnikiem, wygaszanie po końcu życia.
    const act = this.active;
    act.length = 0;
    for (let i = 0; i < this.S; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      s.cx += s.vx * dt; s.cy += s.vy * dt; s.cz += s.vz * dt;
      s.rx += s.vx * dt; s.ry += s.vy * dt; s.rz += s.vz * dt;
      if (now > s.until) {
        const k = (now - s.until) / s.fadeTime;
        if (k >= 1) { s.active = false; s.fade = 0; continue; }
        s.fastRise = false;
        // Wygaszanie: obraz w dół krzywą 1 − k (nie wyżej niż był — domena po odżyciu gaśnie od miejsca, w którym
        // stała), zanik dymu w górę.
        s.fade = Math.min(s.fade, 1 - k);
        s.extraDecay = Math.max(s.extraDecay, s.baseDecay + 1.2 + 3 * k);
      } else {
        // Żywa (także przedłużona w trakcie wygaszania — scalenie wybuchu, ognisko): obraz wraca RAMPĄ, zanik dymu
        // gaśnie tak samo — dawniej fade skakał z 0,5 do 1 w jednej klatce (obłok nagle gęstniał).
        s.fade = Math.min(1, s.fade + (s.fastRise ? FADE_RISE_FAST : FADE_RISE) * dt);
        s.extraDecay = Math.max(s.baseDecay, s.extraDecay - EXTRA_DECAY_FALL * dt);
        if (s.fade >= 1) s.fastRise = false;
      }
      act.push(s);
    }
    if (act.length) this._idleSince = -1;
    this.stats.active = act.length;
    this.stats.bandUploads = 0;
    this.stats.hullsIn = this._hullN;
    if (!act.length) {
      // F17: atlasy wolne po `releaseAfter` s bez domen (alokacja leniwa — atlas „fine” wraca do 1 × 1 × 1).
      if (this._idleSince < 0) this._idleSince = now;
      else if (this.releaseAfter > 0 && this.allocated && now - this._idleSince > this.releaseAfter) this._release();
      this._srcN = 0;
      this._hullN = 0;
      this.stats.substeps = 0;
      this.stats.hulls = 0;
      this.stats.masked = 0;
      return;
    }
    this._frame++;
    // Raster statyki: nowa domena, zmiana budowli, domena przy brzegu okna (zwykle już w updateRasters reżysera).
    for (let k = 0; k < act.length; k++) if (this._needsRaster(act[k], now)) this._rasterSlot(act[k]);
    if (this._maskDirty) { this.maskTex.needsUpdate = true; this._maskDirty = false; }
    this._syncTune();
    this._pack();
    if (this._hullMaskDirty) { this.hullMaskTex.needsUpdate = true; this._hullMaskDirty = false; }
    // Podkroki: co najmniej jeden na klatkę z ruchem (źródła klatki muszą wejść — przy 144 Hz
    // stały krok 1/60 gubiłby co drugą klatkę zleceń), krok ≤ substep, najwyżej maxSubsteps.
    const n = dt > 0 ? Math.min(this.maxSubsteps, Math.max(1, Math.ceil(dt / this.substep - 1e-6))) : 0;
    const L = this._list;
    L.length = 0;
    const count = this.N * this.N * this.NZ * act.length;
    this.stats.cells = count;
    let clear = false;
    for (const s of act) if (s.clear) { clear = true; s.clear = false; }
    if (clear) { this.clearNode.count = count; L.push(this.clearNode); }
    this.U.dt.value = n > 0 ? dt / n : this.substep;
    for (let k = 0; k < n; k++) {
      this.curlNode.count = count; L.push(this.curlNode);
      this.advectNode.count = count; L.push(this.advectNode);
      this.reactNode.count = count; L.push(this.reactNode);
      this.divNode.count = count; L.push(this.divNode);
      for (let j = 0; j < this.jacobi; j++) {
        const node = (j & 1) === 0 ? this.jacAB : this.jacBA;
        node.count = count;
        L.push(node);
      }
      this.projectNode.count = count; L.push(this.projectNode);
    }
    this.lightNode.count = count;
    L.push(this.lightNode);
    this.U.time.value = (now * this.tune.turbSpeed) % 64;
    renderer.compute(L);
    // Flagi zerowania zjedzone: następna klatka bez czyszczenia.
    const A = this.U.act.array;
    for (let k = 0; k < act.length; k++) A[k * 4 + 2].z = 0;
    this.stats.substeps = n;
    this._srcN = 0;
    this._hullN = 0;
  }

  // Pakowanie: lista aktywnych (act), źródła i kadłuby posortowane po domenach (komórki), raster statyki domeny.
  _pack() {
    const U = this.U;
    const act = this.active;
    const A = U.act.array;
    const sun = this.sunDir;
    U.sunDir.value.copy(sun);
    U.activeCount.value = act.length;
    let srcOut = 0;
    let hullOut = 0;
    let masked = 0;
    const N = this.N;
    const tP = performance.now();
    const HR = GAS_HULL_REC, RS = HR.stride, Hs = this._hull;
    for (let k = 0; k < act.length; k++) {
      const s = act[k];
      const h = s.h;
      const inv = 1 / h;
      const half = N * 0.5;
      const halfZ = this.NZ * 0.5;
      // Źródła tej domeny → komórki.
      const src0 = srcOut;
      for (let i = 0; i < this._srcN; i++) {
        if (this._srcSlot[i] !== s.index) continue;
        if (srcOut >= this.maxSources) break;
        const o = i * 18;
        const S = this._src;
        const a = U.srcA.array[srcOut], b = U.srcB.array[srcOut], c = U.srcC.array[srcOut], d = U.srcD.array[srcOut];
        a.set((S[o] - s.cx) * inv + half, (S[o + 1] - s.cy) * inv + half, (S[o + 2] - s.cz) * inv + halfZ, S[o + 6] * inv);
        b.set((S[o + 3] - s.cx) * inv + half, (S[o + 4] - s.cy) * inv + half, (S[o + 5] - s.cz) * inv + halfZ, S[o + 14]);
        c.set(S[o + 7], S[o + 8], S[o + 9], S[o + 10] * inv);
        d.set(S[o + 11] * inv, S[o + 12] * inv, S[o + 13] * inv, S[o + 15]);
        srcOut++;
      }
      // Kadłuby przecinające domenę (bez gospodarzy domeny): kotwica w komórkach, K = osie kadłuba · h / bok teksla
      // (komórki → teksle maski), przesunięcie −róg / bok teksla, prędkość kotwicy względem domeny [kom./s], ω.
      const hull0 = hullOut;
      const ext = h * half;
      for (let i = 0; i < this._hullN; i++) {
        const o = i * RS;
        const r = Hs[o + HR.reach];
        const ax = Hs[o + HR.ax], ay = Hs[o + HR.ay];
        if (ax - s.cx > ext + r || s.cx - ax > ext + r || ay - s.cy > ext + r || s.cy - ay > ext + r) continue;
        if (s.isHost(Hs[o + HR.key])) continue;
        if (hullOut >= this._hullCap) { this.stats.hullsDropped++; continue; }
        const band = this._bandFor(Hs, o);
        if (band < 0) { this.stats.hullsDropped++; continue; }
        const tx = Hs[o + HR.tx] > 0 ? Hs[o + HR.tx] : 1, ty = Hs[o + HR.ty] > 0 ? Hs[o + HR.ty] : 1;
        const kx = h / tx, ky = h / ty;
        U.hullA.array[hullOut].set((ax - s.cx) * inv + half, (ay - s.cy) * inv + half, Hs[o + HR.ex] * kx, Hs[o + HR.ey] * kx);
        U.hullB.array[hullOut].set(Hs[o + HR.fx] * ky, Hs[o + HR.fy] * ky, -Hs[o + HR.x0] / tx, -Hs[o + HR.y0] / ty);
        U.hullC.array[hullOut].set((Hs[o + HR.vx] - s.vx) * inv, (Hs[o + HR.vy] - s.vy) * inv, Hs[o + HR.w], band);
        hullOut++;
      }
      // Raster statyki: przesunięcie komórka → teksel okna (okno stoi w świecie — domena jedzie przez nie) i prędkość
      // ściany względem domeny (−nośnik).
      const mOn = s.maskOn ? 1 : 0;
      masked += mOn;
      A[k * 4].set(s.index, src0, srcOut - src0, hull0);
      A[k * 4 + 1].set(hullOut - hull0, (s.rx - s.cx) * inv + half, (s.ry - s.cy) * inv + half, (s.rz - s.cz) * inv + halfZ);
      A[k * 4 + 2].set(s.extraDecay, s.seed, s.clear ? 1 : 0, mOn);
      A[k * 4 + 3].set((s.cx - s.mox) * inv - half, (s.cy - s.moy) * inv - half, -s.vx * inv, -s.vy * inv);
      U.slotK.array[s.index].x = s.k;
    }
    this.stats.sources = srcOut;
    this.stats.hulls = hullOut;
    this.stats.masked = masked;
    this.stats.packMs = performance.now() - tP;
  }

  /**
   * LUSTRO CPU testu komórki stałej (kernel: _solidAt) dla domeny `slot` w punkcie komórkowym (px, py) — po _pack
   * (czyta zapakowane uniformy domeny, raster statyki i maski obrysu): raster — próbka liniowa obcięta do okna, kadłuby
   * — q = K · (p − kotwica) + przesunięcie w masce, próbka liniowa obcięta do pasma; próg 0,5. Zwraca 0 / 1 i prędkość
   * przeszkody względem domeny [kom./s] w `out` (vx, vy). Zmiana w kernelu = zmiana tutaj.
   */
  solidCpu(slot, px, py, out = null) {
    const act = this.active;
    let k = -1;
    for (let i = 0; i < act.length; i++) if (act[i].index === slot) { k = i; break; }
    if (k < 0) return 0;
    const A = this.U.act.array;
    const a0 = A[k * 4], a1 = A[k * 4 + 1], a2 = A[k * 4 + 2], a3 = A[k * 4 + 3];
    let solid = 0, vx = 0, vy = 0;
    const s = act[k];
    if (a2.w > 0.5 && this._rasterSample(s, px + a3.x, py + a3.y) > 0.5) { solid = 1; vx = a3.z; vy = a3.w; }
    const HM = GAS_HULL_MASK, bands = this.hullBands, D = this.hullMaskData;
    const h0 = Math.round(a0.w), hN = Math.round(a1.x);
    for (let g = h0; g < h0 + hN; g++) {
      const HA = this.U.hullA.array[g], HB = this.U.hullB.array[g], HC = this.U.hullC.array[g];
      const rx = px - HA.x, ry = py - HA.y;
      const qx = HA.z * rx + HA.w * ry + HB.z, qy = HB.x * rx + HB.y * ry + HB.w;
      if (!(qx > 0 && qx < HM.w && qy > 0 && qy < HM.h)) continue;
      const u = Math.min(HM.w - 0.5, Math.max(0.5, qx)) - 0.5;
      const v = HC.w * HM.h + Math.min(HM.h - 0.5, Math.max(0.5, qy)) - 0.5;
      const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
      const i1 = Math.min(HM.w - 1, i0 + 1), j1 = Math.min(HM.h * bands - 1, j0 + 1);
      const a = D[j0 * HM.w + i0] * (1 - fu) + D[j0 * HM.w + i1] * fu;
      const b = D[j1 * HM.w + i0] * (1 - fu) + D[j1 * HM.w + i1] * fu;
      if ((a * (1 - fv) + b * fv) / 255 > 0.5) { solid = 1; vx = HC.x - HC.z * ry; vy = HC.y + HC.z * rx; }
    }
    if (out) { out.vx = vx; out.vy = vy; }
    return solid;
  }

  /**
   * LUSTRO CPU zasłaniania źródła bryłą statyki (kernel: forSources, marsz `gocc`) — waga 0 / 1 komórki (px, py) [komórki
   * domeny] dla kapsuły o POCZĄTKU (ax, ay) [komórki]: marsz po rastrze domeny od komórki do początku kapsuły. Bez rastra — 1.
   * Zmiana w kernelu = zmiana tutaj.
   */
  sourceOcclusionCpu(slot, px, py, ax, ay) {
    const s = this.slots[slot];
    if (!s || !s.active || !s.maskOn) return 1;
    const ox = (s.cx - s.mox) / s.h - this.N * 0.5, oy = (s.cy - s.moy) / s.h - this.N * 0.5;
    const dx = px - ax, dy = py - ay;
    const n = Math.min(SRC_OCCLUSION_STEPS, Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy))));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (this._rasterSample(s, px - dx * t + ox, py - dy * t + oy) > 0.5) return 0;
    }
    return 1;
  }

  // --- Sonda (strojenie, testy): profile przez środek domeny i maksima kolumn ------------------

  _buildProbe() {
    const N = this.N;
    const NZ = this.NZ;
    this._probeBuf = instancedArray(N * 9, 'vec4').setName('gasProbeLine');
    this._probeMax = instancedArray(N * NZ, 'vec4').setName('gasProbeMax');
    this._probeSlot = uniform(0);
    const at = (tex, p, sF) => this._at(tex, p, sF);
    const sF = this._probeSlot;
    this._probeLineNode = Fn(() => {
      const i = instanceIndex;
      const axis = int(i.div(uint(N)));
      const j = float(i.mod(uint(N))).add(0.5);
      const c = float(N * 0.5);
      const cz = float(NZ * 0.5);
      const p = select(axis.equal(int(0)), vec3(j, c, cz), select(axis.equal(int(1)), vec3(c, j, cz), vec3(c, c, j))).toVar();
      this._probeBuf.element(i.mul(uint(3))).assign(at(this.denA, p, sF));
      this._probeBuf.element(i.mul(uint(3)).add(uint(1))).assign(at(this.velA, p, sF));
      this._probeBuf.element(i.mul(uint(3)).add(uint(2))).assign(at(this.prsB, p, sF));
    })().compute(N * 3).setName('gasProbeLine');
    this._probeMaxNode = Fn(() => {
      const i = instanceIndex;
      const y = float(i.mod(uint(N))).add(0.5);
      const z = float(i.div(uint(N))).add(0.5);
      const m = vec4(0.0).toVar();
      Loop({ start: int(0), end: int(N), type: 'int', condition: '<', name: 'px' }, ({ px }) => {
        const p = vec3(float(px).add(0.5), y, z);
        const d = at(this.denA, p, sF);
        const v = at(this.velA, p, sF).xyz;
        const q = at(this.prsB, p, sF).x;
        m.assign(max(m, vec4(d.x, d.y, length(v), abs(q))));
      });
      this._probeMax.element(i).assign(m);
    })().compute(N * NZ).setName('gasProbeMax');
    // Sumy kontrolne (strojenie fizyki: energia, wiry, niedobieżność rzutu) — kolumna (y, z), wnętrze domeny. Przy
    // przeszkodach (etap C): komórki stałe poza niedobieżnością ogólną; przy ścianie (komórka gazu z sąsiadem stałym) —
    // niedobieżność, dym i dym · |v| osobno (gaz „przyklejony” do ściany: dużo dymu przy ścianie, mała prędkość); dym
    // w komórkach stałych (ma być 0); dym w OBSZARZE (półprzestrzeń n · p > d w komórkach — za ścianą: przeciek).
    this._probeRegion = uniform(new THREE.Vector4(0, 0, 0, 1e9));
    this._probeSum = instancedArray(N * NZ * 4, 'vec4').setName('gasProbeSum');
    this._probeSumNode = Fn(() => {
      const i = instanceIndex;
      const yi = int(i.mod(uint(N)));
      const zi = int(i.div(uint(N)));
      const sA = vec4(0.0).toVar();
      const sB = vec4(0.0).toVar();
      const sC = vec4(0.0).toVar();
      const sD = vec4(0.0).toVar();
      const inner = yi.greaterThan(int(0)).and(yi.lessThan(int(N - 1))).and(zi.greaterThan(int(0))).and(zi.lessThan(int(NZ - 1)));
      const reg = this._probeRegion;
      Loop({ start: int(1), end: int(N - 1), type: 'int', condition: '<', name: 'px' }, ({ px }) => {
        const p = vec3(float(px), float(yi), float(zi)).add(0.5).toVar();
        const uvw = vec3(p.x.mul(1 / N), p.y.mul(1 / N), p.z.add(sF.mul(NZ)).mul(1 / (NZ * this.S))).toVar();
        const d = texture3D(this.denA, uvw).level(0).toVar();
        const vA = texture3D(this.velA, uvw).level(0).toVar();
        const v = vA.xyz.toVar();
        const V = (dx, dy, dz) => texture3D(this.velA, uvw.add(vec3(dx / N, dy / N, dz / (NZ * this.S)))).level(0).toVar();
        const xp = V(1, 0, 0), xm = V(-1, 0, 0), yp = V(0, 1, 0), ym = V(0, -1, 0), zp = V(0, 0, 1), zm = V(0, 0, -1);
        // |ω| z tych samych sąsiadów velA (pole po rzucie): tekstura wirów dzieli atlas z prsA (F17) — po klatce trzyma
        // ciśnienie, nie wiry.
        const w = length(vec3(yp.z.sub(ym.z).sub(zp.y.sub(zm.y)), zp.x.sub(zm.x).sub(xp.z.sub(xm.z)),
          xp.y.sub(xm.y).sub(yp.x.sub(ym.x))).mul(0.5)).toVar();
        const div = xp.x.sub(xm.x).add(yp.y.sub(ym.y)).add(zp.z.sub(zm.z)).mul(0.5);
        const solid = vA.w.greaterThan(0.5).toVar();
        const nbSolid = max(max(max(xp.w, xm.w), max(yp.w, ym.w)), max(zp.w, zm.w)).greaterThan(0.5);
        const near = solid.not().and(nbSolid).toVar();
        const r0 = abs(this._rhsOf(div, d)).toVar();
        const res = select(inner.and(solid.not()), r0, float(0.0)).toVar();
        const resNear = select(inner.and(near), r0, float(0.0));
        const v2 = dot(v, v).toVar();
        sA.addAssign(vec4(v2, d.x, res, d.x.mul(v2)));
        sB.assign(vec4(max(sB.x, w), max(sB.y, res), sB.z.add(d.x.mul(w)), sB.w.add(d.y)));
        // Wielkość obłoku: komórki z dymem > 0,1 i Σ dym · r² w płaszczyźnie xy (promień bezwładności).
        const rx = float(px).add(0.5 - N * 0.5).toVar();
        const ry = float(yi).add(0.5 - N * 0.5).toVar();
        const dn = select(near, d.x, float(0.0));
        sC.addAssign(vec4(step(0.1, d.x), d.x.mul(rx.mul(rx).add(ry.mul(ry))), dn, dn.mul(length(v))));
        const inReg = dot(reg.xyz, p).greaterThan(reg.w).and(solid.not());
        sD.addAssign(vec4(select(inReg, d.x, float(0.0)), select(solid, d.x, float(0.0)), resNear, select(near, float(1.0), float(0.0))));
      });
      this._probeSum.element(i.mul(uint(4))).assign(sA);
      this._probeSum.element(i.mul(uint(4)).add(uint(1))).assign(sB);
      this._probeSum.element(i.mul(uint(4)).add(uint(2))).assign(sC);
      this._probeSum.element(i.mul(uint(4)).add(uint(3))).assign(sD);
    })().compute(N * NZ).setName('gasProbeSum');
  }

  /**
   * Przekrój domeny `slot` w warstwie z (komórki) — N × N rekordów (flaga komórki stałej z velA.w, dym, vx, vy): porównanie
   * maski na GPU z lustrem CPU (solidCpu) i obrazu ściany. Async (GPU → CPU).
   */
  async probeSlice(renderer, slot, z = this.NZ * 0.5 - 0.5) {
    const N = this.N, NZ = this.NZ;
    if (!this._sliceNode) {
      this._sliceBuf = instancedArray(N * N, 'vec4').setName('gasProbeSlice');
      this._sliceSlot = uniform(0);
      this._sliceZ = uniform(0);
      this._sliceNode = Fn(() => {
        const i = instanceIndex;
        const p = vec3(float(i.mod(uint(N))).add(0.5), float(i.div(uint(N))).add(0.5), this._sliceZ.add(0.5));
        const uvw = vec3(p.x.mul(1 / N), p.y.mul(1 / N), p.z.add(this._sliceSlot.mul(NZ)).mul(1 / (NZ * this.S))).toVar();
        const v = texture3D(this.velA, uvw).level(0).toVar();
        const d = texture3D(this.denA, uvw).level(0);
        this._sliceBuf.element(i).assign(vec4(v.w, d.x, v.x, v.y));
      })().compute(N * N).setName('gasProbeSlice');
    }
    this._sliceSlot.value = slot;
    this._sliceZ.value = Math.max(0, Math.min(NZ - 1, Math.floor(z)));
    renderer.compute(this._sliceNode);
    return new Float32Array(await renderer.getArrayBufferAsync(this._sliceBuf.value));
  }

  /**
   * RZUT GPU ↔ LUSTRO CPU (testy kernela ciśnienia z przeszkodami, przegląd etapu C pkt 9): po klatce (simulate) odczyt
   * przekroju z = zc domeny `slot` — prsA (wejście ostatniej iteracji Jacobiego: liczba iteracji nieparzysta, ostatnia AB),
   * prsB (wynik), velB (po reakcji), velA (po rzucie) — i na tych samych wartościach JEDNA iteracja gasJacobiCellCpu i rzut
   * gasProjectCellCpu dla komórek wnętrza przekroju. Zwraca { jacErr, projErr (max różnica względna, podłoga 1), cells,
   * wallCells (komórki gazu z sąsiadem stałym), jacWall, projWall (to samo tylko przy ścianie) }. Pryzmaty przeszkód przez
   * całą wysokość: flaga sąsiadów z± = flaga komórki. Async (GPU → CPU).
   */
  async checkProjectCpu(renderer, slot, zc = Math.floor(this.NZ * 0.5)) {
    const N = this.N, NZ = this.NZ, S = this.S;
    if (!this._projChkNode) {
      this._projChkBuf = instancedArray(N * N * 4, 'vec4').setName('gasProbeProject');
      this._projChkSlot = uniform(0);
      this._projChkZ = uniform(0);
      const sF = this._projChkSlot;
      const T = (tex, p) => texture3D(tex, vec3(p.x.mul(1 / N), p.y.mul(1 / N), p.z.add(sF.mul(NZ)).mul(1 / (NZ * S)))).level(0);
      this._projChkNode = Fn(() => {
        const i = instanceIndex;
        const p = vec3(float(i.mod(uint(N))).add(0.5), float(i.div(uint(N))).add(0.5), this._projChkZ.add(0.5)).toVar();
        const dz = vec3(0.0, 0.0, 1.0);
        const A0 = T(this.prsA, p).toVar();
        const B0 = T(this.prsB, p).toVar();
        const base = i.mul(uint(4));
        this._projChkBuf.element(base).assign(vec4(T(this.prsA, p.sub(dz)).x, A0.x, T(this.prsA, p.add(dz)).x, A0.y));
        this._projChkBuf.element(base.add(uint(1))).assign(vec4(A0.z, T(this.prsB, p.sub(dz)).x, B0.x, T(this.prsB, p.add(dz)).x));
        this._projChkBuf.element(base.add(uint(2))).assign(T(this.velB, p));
        this._projChkBuf.element(base.add(uint(3))).assign(T(this.velA, p));
      })().compute(N * N).setName('gasProbeProject');
    }
    this._projChkSlot.value = slot;
    this._projChkZ.value = Math.max(1, Math.min(NZ - 2, zc | 0));
    renderer.compute(this._projChkNode);
    const D = new Float32Array(await renderer.getArrayBufferAsync(this._projChkBuf.value));
    const at = (i, j, r, c) => D[((j * N + i) * 4 + r) * 4 + c];
    const nbQ = new Float64Array(6), nbS = new Uint8Array(6), nbIn = new Uint8Array(6).fill(1);
    const vb = [0, 0, 0], wallV = [0, 0, 0, 0], out = [0, 0, 0];
    const maxSpeed = this.U.maxSpeed.value * (this.slots[slot]?.k || 1);   // sufit w komórkach × skala komórki domeny
    let jacErr = 0, projErr = 0, jacWall = 0, projWall = 0, cells = 0, wallCells = 0;
    const NBX = [1, -1, 0, 0], NBY = [0, 0, 1, -1];
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const solid = at(i, j, 1, 0) > 0.5;
      let wall = false;
      // Jacobi: wejście prsA (x — p, y — rhs, z — flaga; flagi sąsiadów z prsA.z)
      for (let k = 0; k < 4; k++) {
        nbQ[k] = at(i + NBX[k], j + NBY[k], 0, 1);
        nbS[k] = at(i + NBX[k], j + NBY[k], 1, 0) > 0.5 ? 1 : 0;
        if (nbS[k]) wall = true;
      }
      nbQ[4] = at(i, j, 0, 2); nbQ[5] = at(i, j, 0, 0); nbS[4] = nbS[5] = solid ? 1 : 0;
      const qCpu = gasJacobiCellCpu(at(i, j, 0, 1), nbQ, nbS, nbIn, at(i, j, 0, 3), solid);
      const eJ = Math.abs(qCpu - at(i, j, 1, 2)) / Math.max(1, Math.abs(qCpu));
      // Rzut: p po Jacobim (prsB), prędkość ściany z velB sąsiadów
      for (let k = 0; k < 4; k++) nbQ[k] = at(i + NBX[k], j + NBY[k], 1, 2);
      nbQ[4] = at(i, j, 1, 3); nbQ[5] = at(i, j, 1, 1);
      vb[0] = at(i, j, 2, 0); vb[1] = at(i, j, 2, 1); vb[2] = at(i, j, 2, 2);
      wallV[0] = at(i + 1, j, 2, 0); wallV[1] = at(i - 1, j, 2, 0); wallV[2] = at(i, j + 1, 2, 1); wallV[3] = at(i, j - 1, 2, 1);
      gasProjectCellCpu(vb, at(i, j, 2, 3) > 0.5, at(i, j, 1, 2), nbQ, nbS, nbIn, wallV, maxSpeed, out, this.U.wallBlock.value);
      let eP = 0;
      for (let c = 0; c < 3; c++) eP = Math.max(eP, Math.abs(out[c] - at(i, j, 3, c)) / Math.max(1, Math.abs(out[c])));
      cells++;
      jacErr = Math.max(jacErr, eJ); projErr = Math.max(projErr, eP);
      if (wall && !solid) { wallCells++; jacWall = Math.max(jacWall, eJ); projWall = Math.max(projWall, eP); }
    }
    return { jacErr, projErr, cells, wallCells, jacWall, projWall };
  }

  /**
   * Odczyt kontrolny domeny `slot` (async, GPU → CPU): profile pól wzdłuż osi przez środek
   * ({ x, y, z }: tablice { smoke, T, fuel, burn, vx, vy, vz, q }) i maksima w domenie.
   */
  async probe(renderer, slot, opts = null) {
    if (!this._probeLineNode) this._buildProbe();
    this._probeSlot.value = slot;
    // Obszar sum (przeciek za ścianą): półprzestrzeń n · p > d w komórkach domeny; bez — pusty.
    const rg = opts?.region;
    if (rg) this._probeRegion.value.set(rg[0], rg[1], rg[2], rg[3]);
    else this._probeRegion.value.set(0, 0, 0, 1e9);
    renderer.compute([this._probeLineNode, this._probeMaxNode, this._probeSumNode]);
    // three r183 w przeglądarce potrafi (niedeterministycznie) zbudować kernel budowany późno z podmienionym pod-grafem
    // (`f32( instanceIndex )` zamiast stałej / próbki — 2026-10-08/09, bez żadnego błędu). Sonda to narzędzie
    // pomiarowe: skażony kernel — budowa od nowa, po 4 próbach wyjątek zamiast złych liczb.
    for (let tries = 0; this._probeTainted(renderer); tries++) {
      if (tries >= 4) throw new Error('GasGrid.probe: WGSL sondy skażony (three r183) — liczby nieważne');
      this._buildProbe();
      this._probeSlot.value = slot;
      renderer.compute([this._probeLineNode, this._probeMaxNode, this._probeSumNode]);
    }
    const line = new Float32Array(await renderer.getArrayBufferAsync(this._probeBuf.value));
    const mx = new Float32Array(await renderer.getArrayBufferAsync(this._probeMax.value));
    const sm = new Float32Array(await renderer.getArrayBufferAsync(this._probeSum.value));
    const N = this.N;
    const axes = {};
    ['x', 'y', 'z'].forEach((name, a) => {
      const arr = [];
      for (let j = 0; j < N; j++) {
        const o = ((a * N + j) * 3) * 4;
        arr.push({
          smoke: line[o], T: line[o + 1], fuel: line[o + 2], burn: line[o + 3],
          vx: line[o + 4], vy: line[o + 5], vz: line[o + 6], q: line[o + 8], rhs: line[o + 9]
        });
      }
      axes[name] = arr;
    });
    const max4 = [0, 0, 0, 0];
    let nan = 0;
    for (let i = 0; i < mx.length; i += 4) {
      for (let k = 0; k < 4; k++) {
        const v = mx[i + k];
        if (!Number.isFinite(v)) nan++;
        else if (v > max4[k]) max4[k] = v;
      }
    }
    // Sumy: energia Σ|v|² [kom.²/s²], masa dymu Σs, energia w dymie Σs|v|², wiry max |ω| i średnie w dymie
    // Σs|ω| / Σs, niedobieżność rzutu |div v − cel| (średnia i maks. we wnętrzu), Σ T.
    let ke = 0, mass = 0, res = 0, keS = 0, wMax = 0, resMax = 0, wS = 0, heat = 0, vol = 0, r2 = 0;
    let nearS = 0, nearSV = 0, region = 0, inSolid = 0, resNear = 0, nearN = 0;
    for (let i = 0; i < sm.length; i += 16) {
      for (let k = 0; k < 16; k++) if (!Number.isFinite(sm[i + k])) nan++;
      vol += sm[i + 8]; r2 += sm[i + 9]; nearS += sm[i + 10]; nearSV += sm[i + 11];
      ke += sm[i]; mass += sm[i + 1]; res += sm[i + 2]; keS += sm[i + 3];
      if (sm[i + 4] > wMax) wMax = sm[i + 4];
      if (sm[i + 5] > resMax) resMax = sm[i + 5];
      wS += sm[i + 6]; heat += sm[i + 7];
      region += sm[i + 12]; inSolid += sm[i + 13]; resNear += sm[i + 14]; nearN += sm[i + 15];
    }
    const inner = (N - 2) * (N - 2) * Math.max(1, this.NZ - 2);
    // vol — komórki z dymem > 0,1, rG — promień bezwładności dymu w płaszczyźnie xy [komórki] (wielkość obłoku).
    // Przeszkody: region — dym w obszarze (za ścianą), inSolid — dym w komórkach stałych, nearMass / nearSpeed — dym przy
    // ścianie i jego średnia prędkość [kom./s], divResNear — średnia niedobieżność przy ścianie, nearCells — ile komórek.
    const sum = { ke, keS, mass, heat, wMax, wSmoke: mass > 1e-6 ? wS / mass : 0, divRes: res / inner, divResMax: resMax,
      vol, rG: mass > 1e-6 ? Math.sqrt(r2 / mass) : 0,
      region, inSolid, nearMass: nearS, nearSpeed: nearS > 1e-6 ? nearSV / nearS : 0, divResNear: nearN > 0 ? resNear / nearN : 0, nearCells: nearN };
    return { axes, max: { smoke: max4[0], T: max4[1], speed: max4[2], q: max4[3] }, sum, nan };
  }

  /** Czy WGSL kerneli sondy zawiera podmianę `f32( instanceIndex )` (w tych kernelach nie ma prawa wystąpić). */
  _probeTainted(renderer) {
    const nodes = renderer?._nodes;
    if (!nodes || typeof nodes.getForCompute !== 'function') return false;
    for (const n of [this._probeLineNode, this._probeMaxNode, this._probeSumNode]) {
      try {
        if ((nodes.getForCompute(n)?.computeShader || '').includes('f32( instanceIndex )')) return true;
      } catch { return false; }
    }
    return false;
  }

  /** Rozgrzewka: puste dispatche (licznik aktywnych 0) — pipeline'y compute bez przestoju w klatce. */
  warm(renderer) {
    this.U.activeCount.value = 0;
    const L = [this.clearNode, this.curlNode, this.advectNode, this.reactNode, this.divNode, this.jacAB, this.jacBA, this.projectNode, this.lightNode];
    for (const node of L) node.count = 64;
    renderer.compute(L);
  }

  /** Wszystkie domeny wygaszone natychmiast. */
  clear() {
    for (const s of this.slots) { s.active = false; s.clear = true; s.hostN = 0; }
    this.active.length = 0;
    this._srcN = 0;
    this._hullN = 0;
  }

  dispose() {
    for (const t of [...this._atlases, this.maskTex, this.hullMaskTex]) t.dispose();
  }

  /** Bajty atlasów na GPU (10 tekstur RGBA16F; 0 przed alokacją leniwą) i masek przeszkód (R8). */
  get memoryBytes() {
    const cells = this.allocated ? this.N * this.N * this.NZ * this.S : 0;
    return cells * 8 * this._atlases.length + this.maskData.length + this.hullMaskData.length;
  }

  /**
   * ALOKACJA LENIWA (F17): atlasy w pełnym rozmiarze przy pierwszej domenie (do tej chwili 1 × 1 × 1 — kernele, bryły
   * i pipeline'y są gotowe z rozgrzewki: rozmiar tekstury nie wchodzi do klucza pipeline'u, grupa wiązań odtwarza się
   * po zmianie wersji / generacji tekstury — jak resizeRenderTarget). Zawartość nowych atlasów: zerowanie domeny
   * (clearNode) przy jej zajęciu.
   */
  _allocate() {
    if (this.allocated) return;
    this._setAtlasSize(this.N, this.NZ * this.S, this.N);
    this.allocated = true;
    this.stats.allocs = (this.stats.allocs || 0) + 1;
  }

  /** Zwolnienie atlasów (brak domen dłużej niż `releaseAfter` s; tylko przy alokacji leniwej). */
  _release() {
    if (!this.allocated || !this.lazy) return;
    this._setAtlasSize(1, 1, 1);
    this.allocated = false;
    this.stats.releases = (this.stats.releases || 0) + 1;
  }

  _setAtlasSize(w, depth, h) {
    for (const t of this._atlases) {
      t.image.width = w; t.image.height = h; t.image.depth = depth;
      t.dispose();
      t.needsUpdate = true;
    }
  }
}
