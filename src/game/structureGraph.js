/**
 * structureGraph — GRUBY GRAF NOŚNY budowli (docs/PLAN-zawalenia-budowli-3d.md, etap E1; § 3.2, § 3.4, § 4.1, § 4.2).
 *
 * Budowla = ARCHETYP (niezmienny, liczony raz na ekranie ładowania: bloki L1 i wiązania w tablicach typowanych SoA,
 * limity skalibrowane, rozrzut ±15% z PRNG ziarna archetypu) + EGZEMPLARZ (stan bloków i wiązań, przemieszczenia CG
 * jako ciepły start, kolejka zerwań, wyspy, front zawalenia). Graf mówi grze, CO trzyma, CO pęka i GDZIE się
 * przewróci — nie rusza ciał: klastry sztywne, zawias i lądowanie liczy silnik (E2/E5), obraz worker (E3/E4).
 * Zasada 1: graf to prawda gry (żadnego rzutowania po kamerze); zasada 7: krok bez alokacji (pule i bufory
 * z createStructure); zasada 8: kadencje i budżety na 1/120 s (ticksAt120), zmęczenie w 1/s × czas — 60 i 120 Hz
 * dają te same zdarzenia w czasie; zasada 9: zero Math.random — rozrzut z PRNG ziarna archetypu (mulberry32).
 *
 * MODEL (poprawki sceptyka fizyki, .tmp/destrukcja-2026-11-03/w3-sceptyk-fizyka.md):
 * - 3 DOF na blok, wiązanie OSIOWE k_a·n·nᵀ + mały człon ścinania k_s·(I − n·nᵀ), k_s = shearK·k_a. Laplasjan
 *   izotropowy z benchmarku (graf.mjs:67-78) nie przenosił momentu (siły niecentralne, 0 rozciągania) — kratownica
 *   z wiązaniami osiowymi przenosi zginanie parą sił w pasach (wspornik, płyta dysku z dwiema warstwami
 *   i stężeniami). Człon ścinania to regulator mechanizmów (po zerwaniach) — mały, żeby nie psuł bilansu momentów.
 * - KALIBRACJA PER WIĄZANIE z podłogami (grupa poziom × klasa, poziom, cała budowla): nienaruszona budowla ma
 *   wykorzystanie u0 = 0,5 NA KAŻDYM POZIOMIE (globalny limit benchmarku dawał ~0,02 przy szczycie — grawitacja
 *   nigdy nie odrywała nic wysoko). Wieżowiec ma do tego przekroje słupów ∝ ciężarowi nad poziomem.
 * - Kontrola PRZEKROJÓW kondygnacji (N/A ± M·c/I, sztywności pionowe wiązań jako wagi) — wywracanie i ostatnia
 *   linia podpór (oś przekroju zdegenerowana → przewrócenie), niezależnie od zbieżności CG.
 * - Solver CG 25 iteracji z prekondycjonerem blokowym Jacobiego (3×3 na blok), ciepły start (egzemplarz startuje
 *   z przemieszczeń kalibracji — smukłe kratownice z zimnego startu zbiegają setki iteracji), co 4 kroki 120 Hz
 *   z przesunięciem faz (id + tick) mod okres, tylko gdy coś się zmieniło. OCENA (zmęczenie, zerwania) WYŁĄCZNIE
 *   na rozwiązaniu z resztą ≤ solveTol (reszta liczona na tej samej K, na której liczy się siły) — niezbieżny
 *   przebieg dostaje dalszy przebieg w następnym kroku (benchmark łamał wiązania przy 43% błędu równowagi w chwili
 *   rozstrzygającej); oceny wymuszonej nie ma. Po zerwaniach: blok-mechanizm dostaje większe ścinanie (shearMech) —
 *   lokalny z testu wyznacznika, a mechanizm rozległy (CG nie zbiega softAfter przebiegów) z TRYBU MIĘKKIEGO: bloki
 *   o największym przyroście przemieszczeń w przebiegu; przekroje łamią także przy przebiegu niezbieżnym
 *   (wywracanie). Seria niezbieżnych przebiegów: co krok do fastPending, dalej w fazie (koszt ograniczony).
 * - Zmęczenie: między limitem sprężystym (1) i krytycznym (critMul) wiązanie traci zdrowie w czasie
 *   (fatigueRate [1/s] × czas od poprzedniej oceny), ponad krytycznym pęka od razu; ≤ 64 zerwania na 1/120 s
 *   (nadmiar w kolejce — także cięcia plastra i zawalenia mechanizmu), wyspy union-find po zerwaniach. Poza tym
 *   budżetem: zniszczenie bloku (front — własny budżet ≤ 1 poziom na 1/120 s, otwór płyty) — S.cutsThisStep.
 * - ZDARZENIA (prealokowany bufor, ≤ STRUCT_EV_CAP rekordów na krok, nadmiar zbiorczo): zerwanie, wyspa bez kotwicy
 *   (bloki, masa, środek masy), ZAWIAS (ostatnie podparcie: punkt, oś, kierunek przechyłu = od środka podparcia ku
 *   środkowi masy — wychodzi W STRONĘ PODCIĘTĄ, decyzja D11; punkt = ostatnia linia podpór po stronie przeciwnej), PĘKNIĘCIE wysokiej wąskiej wyspy po wiązaniach pięter
 *   (bez pełnowysokiego „plastra” — Ronan Point), FRONT zawalenia, utrata podpory.
 * - FRONT Bažanta–Verdure: d(mv)/dt = m·g − R(z), R = κ · nośność krytyczna SŁUPÓW kondygnacji pod frontem bez
 *   zapasu kalibracji (≈ critMul · ciężar nad nią), κ 0,1–0,3 przy gruzie 20–30% dochodzi do ziemi (przy κ = 1
 *   staje po 1–3 piętrach — R ≈ 1,25 ciężaru), ≤ 1 poziom na 1/120 s (czas ponad budżet przechodzi na następny
 *   krok), debrisFrac masy zmiażdżonego poziomu w gruz. stepCollapseFront jest czysty (tablice poziomów) — E5 go
 *   wepnie.
 * - FALA W KONSTRUKCJI (§ 4.1 p. 2, F0): trafienie = impuls J do grafu (siła J / pulseT na bloki przy trafieniu)
 *   + spadek wytrzymałości wiązań nad trafieniem malejący z wysokością (deterministycznie) — jedyne źródło kruszenia
 *   ponad pasem broni (|z| ≤ 70).
 * - WYSPA SWOBODNA przy styku (structureSolveIsland): K wolnej wyspy jest osobliwa, więc obciążenia z odciążeniem
 *   bezwładnościowym (−m·a − m·α×r, jeden blok przypięty) — pękanie klastrów przy lądowaniu; zerwania tylko
 *   z rozwiązania o reszcie ≤ solveTol (inaczej −1).
 * - POLE GRUBOŚCI PŁYTY (dysk, § 4.2): u8 na komórkę 45 j., zgniot plastyczny (opór σ·A ponad nośność zjada grubość,
 *   przy 0 — otwór; poniżej — styk sprężysty, siła do grafu) + prototyp progu szyja / upadek (ryzyko R3). WYNIK
 *   (scripts/struktura-sym.mjs --tryb prog): jeden próg NIE rozdziela — upadek przechodzi przy σ ≤ 6 (900 j/s), szyja
 *   trzyma od σ ≥ 160 (krawędź 1,2–1,4 km/s), luka ×27 → próg zależny od utrzymania (D8) z jawnym oknem: σ = sigmaFree
 *   przy utrzymaniu ≤ holdFree, sigmaHeld przy ≥ holdHeld (plateSigma); wieża dochodzi do dysku po v0 / gFall ≥ 3,5 s,
 *   czyli po zegarze D8 (2,5 s) — przy utrzymaniu 0. Podpory dysku mają osobną krzywą (supportHoldFloor) — dysk nie
 *   odpada sam przed wieżą. Graf dysku z zapasem u0 0,15 (w szyi traci ≤ 2% bloków).
 * AGENT: E2/E5/E6 — styk rigid × pole płyty (6 DOF) zamiast prototypowego 1-DOF z plateImpactScenario; mapowanie
 *   świat → układ lokalny archetypu, pętla `structureStartFront` / zawias w silniku; archetypy H-C i bębna (D14).
 *
 * Układ: archetyp w układzie LOKALNYM budowli (wieżowiec: x wzdłuż pomostu, y w poprzek, z świata; dysk: środek
 * habitatu, z świata). Przekształcenie świat → lokalny robi gospodarz (E5). Masa bloku w „węzłach komórki 45”
 * (objętość / 45³ × gęstość materiału, jak węzły silnika belek), siły w masa·j/s²; masa silnika = × 45²
 * (STRUCT_MASS_UNIT). GEOMETRIA BLOKU L1 (plan § 3.1, synteza dema D20 § 2a): prostopadłościany bloków (addBlockBox,
 * CSR A.boxStart / A.boxData, structureBlockBoxes → buildClusterDesc), różne bloki bez nachodzenia (luz
 * STRUCT_BOX_GAP). g archetypu — opcja `g` (D12; domyślnie 400 bit w bit, waveJ × g/400).
 * Bez three i DOM.
 */

import { PIRATE_BASE_SPEC } from '../3d/portBuildings/pirateBaseLayout.js';
import { k7HeightToZ } from '../3d/haloRing/haloPortK7Layout.js';
import { REF_STEP_DT, ticksAt120 } from './stepDecay.js';

export const STRUCT_TUNE = Object.freeze({
  E: 1,                  // moduł umowny (siły wiązań nie zależą od skali sztywności)
  shearK: 1e-6,          // k_s / k_a — regulator (K dodatnio określona); człon k_s·(I − n·nᵀ) karze sztywny obrót (siły
                         // niecentralne), więc przejmuje moment pasów ku końcowi smukłej kratownicy: wspornik 12 przęseł
                         // (L/h 15) — moment przekroju przy końcu 63% przy 1e-4, 96% przy 1e-5, 99,6% przy 1e-6
                         // (scripts/struktura-sym.mjs --tryb wspornik); mechanizmy dostają shearMech (niżej)
  u0: 0.5,               // wykorzystanie nienaruszonej budowli (kalibracja)
  critMul: 1.25,         // limit krytyczny / sprężysty (stal: granica plastyczności / wytrzymałość ~1,2–1,5)
  tensionFrac: 0.5,      // limit rozciągania / ściskania słupów (VERT, CHORD); reszta klas — tensionFracOther
  tensionFracOther: 1,   // ściany poziomo, stropy, stężenia: rozciąganie jak ściskanie (stal, ciągłe ściany)
  shearFrac: 0.35,       // limit ścinania / ściskania (podłoga trybu)
  spread: 0.15,          // rozrzut limitów ±15% (PRNG ziarna archetypu)
  floorGroup: 0.5,       // podłoga limitu: ułamek najmocniejszego wiązania grupy (poziom × klasa)
  floorLevel: 0.5,       // … poziomu (wiązania bezczynne pod ciężarem — obwód, strop — nie są papierowe)
  floorGlobal: 0.04,     // … całej budowli
  fatigueRate: 0.6,      // [1/s] utrata zdrowia przy stosunku = critMul (liniowo od 1)
  hMin: 0.05,            // zdrowie, poniżej którego wiązanie pęka
  cgIters: 25,           // iteracje CG na przebieg
  solveTol: 0.02,        // względna reszta równowagi ‖f − K·u‖ / ‖f‖, przy której wolno oceniać
  stopTol: 0.004,        // wcześniejsze wyjście z przebiegu (ciepły start już zbieżny)
  solveEvery120: 4,      // przebieg co tyle kroków 1/120 s (fazy: (id + tick) mod okres)
  fastPending: 12,       // niezbieżne przebiegi z rzędu co krok; dalej tylko w fazie (co solveEvery120) — koszt ograniczony;
                         // OCENY BEZ ZBIEŻNOŚCI NIE MA (zerwania z rozwiązania o reszcie > solveTol łamałyby losowo)
  softAfter: 2,          // od tylu niezbieżnych przebiegów z rzędu: TRYB MIĘKKI — bloki o przemieszczeniu ponad softU ×
                         // skala sprężysta (mechanizm: kawałek „wisi” na przegubie) dostają shearMech
  mechAfter: 24,         // niezbieżne przebiegi z rzędu (po trybie miękkim), po których MECHANIZM SIĘ ZAWALA: wiązania
                         // między blokami o |u| ≥ próg trybu miękkiego a resztą pękają (MECH) — część, której budowla
                         // nie utrzyma inaczej niż ścinaniem przegubu, odpada jako wyspa
  softU: 10,             // … |u| ≥ softU · uScale · max(1, ‖f‖ / fScale) (uScale, fScale — nienaruszona budowla); zwykła
                         // wolna zbieżność po zerwaniach ma |u| ≤ ~5 uScale (podcięcie), mechanizmy 30–1000 uScale
  shearMech: 0.05,       // ścinanie wiązań bloku-mechanizmu (k_s / k_a): przegub mechanizmu niesie obciążenie ścinaniem
                         // i pęka (SHEAR) — tak, jak mechanizm się zawala; reszta budowli zostaje przy shearK
  islandIters: 100,      // iteracje CG wyspy swobodnej na wywołanie (~0,7 ms przy 600 wiązaniach; niezbieżne — kontynuacja
                         // w następnym wywołaniu, structureSolveIsland)
  mechTol: 1e-5,         // det / (tr/3)³ bloku osiowego poniżej — mechanizm lokalny
  supportHoldFloor: 0.5, // podpory SUPPORT przy utrzymaniu 0 trzymają ułamek nośności (anchorCap = 3× reakcja
                         // nienaruszona → 1,5× przy utrzymaniu 0): nieobciążony dysk po HP 0 nie odpada sam w całości
                         // (przy nośności × utrzymanie wszystkie 28 podpór puszczało w jednej ocenie już przy 0,3 —
                         // dysk spadał jako jedna wyspa, zanim wieża go dotknęła); puszczają podpory przeciążone
                         // przez wieżę i gruz (plan § 4.2 p. 5). Pole płyty ma osobną krzywą (plateSigma).
  breaksPer120: 64,      // zerwania na 1/120 s (nadmiar w kolejce)
  breakRecords: 24,      // rekordy BREAK na krok — dalsze zbiorczo w BREAKS
  hingeMinMassFrac: 0.08,// wyspa lżejsza niż ułamek masy budowli nie dostaje zawiasu
  hingeWindow: 1.5,      // [s] wiązania podparcia zerwane tak niedawno — kandydaci (kaskada przed oderwaniem)
  hingeMinEcc: 0.05,     // mimośród podparcia (środek masy − środek sztywności zerwanego podparcia) ≥ ułamek promienia
                         // rzutu, inaczej spadek pionowy (front): podcięcia dają 25–49 j. (0,09–0,17 footR), zniszczenie
                         // symetryczne kondygnacji 0–4 j.
  hingeBand: 0.15,       // ostatnia linia podpór: wiązania podparcia w pasie hingeBand·footR od skrajnego po stronie
                         // przeciwnej do przechyłu
  hingeBreakTiltDeg: 40, // kąt pęknięcia zawiasu (D11: przechył 30–45°, potem zgniot) — podpowiedź dla silnika
  overturnEcc: 0.03,     // mimośród (ułamek promienia rzutu) ponad zdegenerowaną podporą = przewrócenie
  pulseT: 1 / 30,        // [s] czas impulsu fali (J → siła J / pulseT na jeden przebieg oceny)
  waveRadius: 260,       // promień poziomy osłabienia fali [j.]
  waveDecayZ: 600,       // zanik osłabienia z wysokością [j.] (e-krotnie)
  waveWeaken: 0.05,      // spadek wytrzymałości tuż nad trafieniem przy impulsie waveJ (liniowo z J)
  waveVert: 0.15,        // słupy (VERT) słabną wolniej: fala kruszy elewację (obwód, stropy, stężenia), nie nośność
  strengthMin: 0.02,     // wiązanie, które straciło wytrzymałość (fala), pęka niezależnie od obciążenia
  waveJ: 2000,           // impuls odniesienia fali [masa·j/s] (~5% ciężaru wieżowca przez pulseT)
  kappa: 0.2,            // front: opór po wyboczeniu / nośność krytyczna kondygnacji BEZ zapasu kalibracji (u0): R = κ·critMul·
                         // (ciężar, na który kondygnację zaprojektowano). Zapas 1/u0 to margines gry na ostrzał, nie
                         // wytrzymałość po wyboczeniu — z nim (R = κ·2,5 W) front stawał przy κ 0,3 i gruzie 0,3
  debrisFrac: 0.2,       // front: ułamek masy zmiażdżonego poziomu w gruz (plan: 20–30%)
  frontLevelsPer120: 1   // front: poziomy na 1/120 s
});

export const STRUCT_ANCHOR = Object.freeze({ NONE: 0, GROUND: 1, SUPPORT: 2, SECTION: 3 });
// Klasy wiązań: kalibracja grupuje po (poziom, klasa); kontrola przekrojów bierze wiązania z `storey` ≥ 0.
export const STRUCT_BOND = Object.freeze({ VERT: 0, RING: 1, SPOKE: 2, DIAG: 3, PLATE_T: 4, PLATE_R: 5, PLATE_Z: 6, PLATE_D: 7, CHORD: 8, WEB: 9, ANCHOR: 10 });
export const STRUCT_MODE = Object.freeze({ COMPRESSION: 0, TENSION: 1, SHEAR: 2, SECTION: 3, FATIGUE: 4, SPLIT: 5, CRUSH: 6, CRATER: 7, IMPACT: 8, WAVE: 9, MECH: 10 });
// Rekord zdarzenia (Float64, STRUCT_EV_STRIDE słów): 0 typ, 1 czas [s], 2 a, 3 b, 4–6 punkt, 7–9 kierunek,
// 10–12 oś, 13–15 v1..v3. Znaczenie pól — przy typach niżej.
export const STRUCT_EV = Object.freeze({
  BREAK: 1,        // a wiązanie, b tryb (STRUCT_MODE), punkt = środek, kierunek = n, v1 stosunek, v2 1 = zmęczenie
  BREAKS: 2,       // nadmiar zerwań kroku: b liczba, punkt = średni środek
  ISLAND: 3,       // a id wyspy, b bloki, punkt = środek masy, v1 masa, v2 wyspa-rodzic (−1 = od budowli), v3 1 = spadek pionowy (bez zawiasu)
  HINGE: 4,        // a id wyspy, b wiązania ostatniej linii podpór, punkt = punkt zawiasu (ta linia), kierunek = przechył (poziomo), oś = obrót (+kąt → ku kierunkowi), v1 ramię (zawias → środek masy), v2 kąt pęknięcia [°], v3 masa
  SPLIT: 5,        // a wyspa-rodzic, b kawałki, punkt = środek masy, v1 poziomy rodzica
  FRONT: 6,        // a poziom zmiażdżony, punkt = środek poziomu, kierunek = ĝ, v1 prędkość frontu, v2 masa w gruz, v3 masa w ruchu
  FRONT_STOP: 7,   // a poziom, v1 prędkość (0), v3 masa w ruchu
  FRONT_GROUND: 8, // a poziom, v1 prędkość u ziemi, v3 masa w ruchu
  SUPPORT_FAIL: 9, // a blok kotwicy, punkt = kotwica, v1 reakcja, v2 nośność × utrzymanie
  OVERFLOW: 10     // b liczba pominiętych rekordów
});
export const STRUCT_EV_STRIDE = 16;
export const STRUCT_EV_CAP = 64;
// Prostopadłościany bloków L1 (A.boxStart CSR po blokach, A.boxData — STRUCT_BOX_STRIDE słów): środek xyz, półosie
// xyz, yaw (obrót wokół z archetypu), udział w masie bloku (Σ = 1 na blok).
export const STRUCT_BOX_STRIDE = 8;
// Luz [j.] odejmowany od każdej półosi prostopadłościanu w archetypach gry: nominalnie stykające się prostopadłościany
// różnych bloków dzieli ≥ 2 j. (synteza dema D20 § 2a: klaster urodzony w przenikaniu dostaje wyrzut).
export const STRUCT_BOX_GAP = 1;
// Najmniejszy wymiar prostopadłościanu po luzie [j.] — krótsze (ramię narożnika przy gęstym obwodzie) pomijane.
const BOX_MIN = 6;
// Jednostka masy silnika belek: masa grafu („węzły komórki 45”) × 45² (masa węzła bryły = gęstość · komórka²,
// hullBodies.js; synteza dema D20 § 1).
export const STRUCT_MASS_UNIT = 45 * 45;

// ── PRNG (mulberry32) — rozrzut archetypu; deterministyczny, poza sekwencją rozgrywki ──────────────────────────
export function structureRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function rnd() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Budżet „na 1/120 s” → na krok dt (60 Hz: ×2). Przy kroku 1/120 s dokładnie wejście.
function per120(n, dt) {
  if (dt === REF_STEP_DT) return n;
  return Math.max(1, Math.round(n * dt * 120));
}

// ── ARCHETYP: budowniczy ────────────────────────────────────────────────────────────────────────────────────────
/** Budowniczy archetypu (tablice z zapasem; finishArchetype przycina i kalibruje). maxBoxes — prostopadłościany
 *  bloków (addBlockBox; domyślnie 4 na blok). */
export function createArchetypeBuilder(maxBlocks, maxBonds, maxBoxes = 4 * maxBlocks) {
  return {
    n: 0, e: 0, maxBlocks, maxBonds,
    x: new Float64Array(maxBlocks), y: new Float64Array(maxBlocks), z: new Float64Array(maxBlocks),
    mass: new Float64Array(maxBlocks), level: new Int16Array(maxBlocks), sector: new Int16Array(maxBlocks),
    kind: new Uint8Array(maxBlocks), anchor: new Uint8Array(maxBlocks), anchorCap: new Float64Array(maxBlocks),
    ba: new Int32Array(maxBonds), bb: new Int32Array(maxBonds), area: new Float64Array(maxBonds),
    cls: new Uint8Array(maxBonds), storey: new Int16Array(maxBonds),
    nBox: 0, maxBoxes, boxBlock: new Int32Array(maxBoxes), boxData: new Float64Array(maxBoxes * STRUCT_BOX_STRIDE)
  };
}

/** Blok L1: pozycja (lokalnie), masa, poziom (−1 = kotwica pod budowlą), sektor, kotwica (STRUCT_ANCHOR) i jej
 *  nośność (SUPPORT; 0 = skalibruj × supportCapMul), rodzaj (dowolny u8 gospodarza). Zwraca id. */
export function addBlock(B, x, y, z, mass, level = 0, sector = -1, anchor = 0, anchorCap = 0, kind = 0) {
  const i = B.n++;
  if (i >= B.maxBlocks) throw new Error('structureGraph: za dużo bloków');
  B.x[i] = x; B.y[i] = y; B.z[i] = z; B.mass[i] = mass; B.level[i] = level; B.sector[i] = sector;
  B.anchor[i] = anchor; B.anchorCap[i] = anchorCap; B.kind[i] = kind;
  return i;
}

/** Wiązanie a→b: pole przekroju [j²], klasa (STRUCT_BOND), kondygnacja do kontroli przekrojów (−1 = żadna). */
export function addBond(B, a, b, area, cls = 0, storey = -1) {
  const k = B.e++;
  if (k >= B.maxBonds) throw new Error('structureGraph: za dużo wiązań');
  B.ba[k] = a; B.bb[k] = b; B.area[k] = area; B.cls[k] = cls; B.storey[k] = storey;
  return k;
}

/**
 * Prostopadłościan bloku L1 (plan § 3.1 — geometria bloku dla klastra sztywnego, obrazu i trafień): środek (cx, cy, cz)
 * w układzie archetypu, półosie (hx, hy, hz), obrót `yaw` [rad] wokół osi z archetypu (pion — archetypy
 * z prostopadłościanami mają ĝ = −z), waga udziału w masie bloku `massFrac` (finishArchetype normalizuje udziały
 * bloku do Σ = 1, więc wystarczy np. objętość). Blok może mieć kilka prostopadłościanów (narożnik w L, ściana + kafle
 * stropu); prostopadłościany RÓŻNYCH bloków nie mogą na siebie nachodzić — klaster urodzony w przenikaniu dostaje
 * wyrzut (luz STRUCT_BOX_GAP na każdej półosi w archetypach gry). Zwraca numer prostopadłościanu w budowniczym.
 */
export function addBlockBox(B, b, cx, cy, cz, hx, hy, hz, yaw = 0, massFrac = 1) {
  const i = B.nBox++;
  if (i >= B.maxBoxes) throw new Error('structureGraph: za dużo prostopadłościanów');
  if (!(b >= 0 && b < B.n)) throw new Error('structureGraph: prostopadłościan bez bloku');
  const o = i * STRUCT_BOX_STRIDE, d = B.boxData;
  B.boxBlock[i] = b;
  d[o] = cx; d[o + 1] = cy; d[o + 2] = cz; d[o + 3] = hx; d[o + 4] = hy; d[o + 5] = hz; d[o + 6] = yaw; d[o + 7] = massFrac;
  return i;
}

/**
 * Archetyp z budowniczego: geometria wiązań, sztywności, poziomy, kondygnacje (CSR), kalibracja limitów (rozwiązanie
 * nienaruszonej budowli do zbieżności, każde wiązanie przy u0 z podłogami), rozrzut ±spread z PRNG ziarna.
 * opts: { name, seed, gravity: [gx, gy, gz] (kierunek), g (j/s²), levelZ (wysokości poziomów wzdłuż −ĝ; domyślnie
 * średnie bloków), groundZ, split (pękanie wysp po piętrach), splitMinLevels, chunkLevels, sliverFrac,
 * supportCapMul (nośność SUPPORT = reakcja nienaruszona × mnożnik), tune: { …STRUCT_TUNE } }.
 * Prostopadłościany z addBlockBox → A.boxStart (Int32Array n + 1, CSR po blokach, kolejność dodania w bloku),
 * A.boxData (Float64Array, STRUCT_BOX_STRIDE słów na prostopadłościan), A.boxCount; udziały masy znormalizowane
 * do Σ = 1 na blok (blok bez prostopadłościanów — kotwica, archetypy testowe — ma pusty zakres).
 */
export function finishArchetype(B, opts = {}) {
  const tune = Object.freeze({ ...STRUCT_TUNE, ...(opts.tune || {}) });
  const n = B.n, e = B.e;
  const sl = (a, len) => a.slice(0, len);
  let gx = 0, gy = 0, gz = -1;
  if (opts.gravity) { gx = opts.gravity[0]; gy = opts.gravity[1]; gz = opts.gravity[2]; }
  const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1; gx /= gl; gy /= gl; gz /= gl;
  // baza poziomej płaszczyzny (⊥ ĝ): e1, e2
  let e1x = 1, e1y = 0, e1z = 0;
  if (Math.abs(gx) > 0.9) { e1x = 0; e1y = 1; }
  const d1 = e1x * gx + e1y * gy + e1z * gz; e1x -= d1 * gx; e1y -= d1 * gy; e1z -= d1 * gz;
  const l1 = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z); e1x /= l1; e1y /= l1; e1z /= l1;
  const e2x = gy * e1z - gz * e1y, e2y = gz * e1x - gx * e1z, e2z = gx * e1y - gy * e1x;
  const A = {
    name: opts.name || 'struktura', seed: opts.seed >>> 0, tune,
    n, e,
    x: sl(B.x, n), y: sl(B.y, n), z: sl(B.z, n), mass: sl(B.mass, n), level: sl(B.level, n), sector: sl(B.sector, n),
    kind: sl(B.kind, n), anchor: sl(B.anchor, n), anchorCap: sl(B.anchorCap, n),
    ba: sl(B.ba, e), bb: sl(B.bb, e), area: sl(B.area, e), cls: sl(B.cls, e), storey: sl(B.storey, e),
    nx: new Float64Array(e), ny: new Float64Array(e), nz: new Float64Array(e), len: new Float64Array(e),
    cx: new Float64Array(e), cy: new Float64Array(e), cz: new Float64Array(e), k0: new Float64Array(e),
    ng: new Float64Array(e),        // n·ĝ (pionowa składowa osi wiązania)
    limC: new Float64Array(e).fill(1e300), limT: new Float64Array(e).fill(1e300), limS: new Float64Array(e).fill(1e300),
    gx, gy, gz, g: opts.g ?? 400, e1x, e1y, e1z, e2x, e2y, e2z,
    nLevels: 0, levelZ: null, groundZ: 0, storeyStart: null, storeyBonds: null, nStoreys: 0,
    totalMass: 0, footR: 1, centerX: 0, centerY: 0, centerZ: 0,
    split: !!opts.split, splitMinLevels: opts.splitMinLevels ?? 3, chunkLevels: opts.chunkLevels ?? 2,
    sliverFrac: opts.sliverFrac ?? 0.4,
    calib: null
  };
  for (let k = 0; k < e; k++) {
    const a = A.ba[k], b = A.bb[k];
    const dx = A.x[b] - A.x[a], dy = A.y[b] - A.y[a], dz = A.z[b] - A.z[a];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    A.nx[k] = dx / L; A.ny[k] = dy / L; A.nz[k] = dz / L; A.len[k] = L;
    A.cx[k] = (A.x[a] + A.x[b]) * 0.5; A.cy[k] = (A.y[a] + A.y[b]) * 0.5; A.cz[k] = (A.z[a] + A.z[b]) * 0.5;
    A.k0[k] = tune.E * A.area[k] / L;
    A.ng[k] = A.nx[k] * gx + A.ny[k] * gy + A.nz[k] * gz;
  }
  // poziomy (wysokość wzdłuż −ĝ)
  let maxL = -1;
  for (let i = 0; i < n; i++) if (A.level[i] > maxL) maxL = A.level[i];
  A.nLevels = maxL + 1;
  A.levelZ = new Float64Array(Math.max(1, A.nLevels));
  if (opts.levelZ) for (let l = 0; l < A.nLevels; l++) A.levelZ[l] = opts.levelZ[l];
  else {
    const cnt = new Float64Array(Math.max(1, A.nLevels));
    for (let i = 0; i < n; i++) { const l = A.level[i]; if (l < 0) continue; A.levelZ[l] += -(A.x[i] * gx + A.y[i] * gy + A.z[i] * gz); cnt[l]++; }
    for (let l = 0; l < A.nLevels; l++) A.levelZ[l] = cnt[l] ? A.levelZ[l] / cnt[l] : 0;
  }
  if (opts.groundZ !== undefined) A.groundZ = opts.groundZ;
  else {
    let gmin = Infinity; for (let i = 0; i < n; i++) if (A.anchor[i]) gmin = Math.min(gmin, -(A.x[i] * gx + A.y[i] * gy + A.z[i] * gz));
    A.groundZ = Number.isFinite(gmin) ? gmin : 0;
  }
  // kondygnacje (CSR po `storey`)
  let maxS = -1;
  for (let k = 0; k < e; k++) if (A.storey[k] > maxS) maxS = A.storey[k];
  A.nStoreys = maxS + 1;
  A.storeyStart = new Int32Array(A.nStoreys + 1);
  for (let k = 0; k < e; k++) if (A.storey[k] >= 0) A.storeyStart[A.storey[k] + 1]++;
  for (let s = 0; s < A.nStoreys; s++) A.storeyStart[s + 1] += A.storeyStart[s];
  A.storeyBonds = new Int32Array(Math.max(1, A.storeyStart[A.nStoreys]));
  { const fill = A.storeyStart.slice(0, A.nStoreys); for (let k = 0; k < e; k++) { const s = A.storey[k]; if (s >= 0) A.storeyBonds[fill[s]++] = k; } }
  // masa, środek, promień rzutu
  let M = 0, mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) { if (A.anchor[i]) continue; M += A.mass[i]; mx += A.mass[i] * A.x[i]; my += A.mass[i] * A.y[i]; mz += A.mass[i] * A.z[i]; }
  A.totalMass = M; A.centerX = M ? mx / M : 0; A.centerY = M ? my / M : 0; A.centerZ = M ? mz / M : 0;
  let fr = 0;
  for (let i = 0; i < n; i++) {
    const dx = A.x[i] - A.centerX, dy = A.y[i] - A.centerY, dz = A.z[i] - A.centerZ;
    const p1 = dx * e1x + dy * e1y + dz * e1z, p2 = dx * e2x + dy * e2y + dz * e2z;
    const r = Math.sqrt(p1 * p1 + p2 * p2); if (r > fr) fr = r;
  }
  A.footR = fr || 1;
  A.nSupport = 0;
  for (let i = 0; i < n; i++) if (A.anchor[i] === STRUCT_ANCHOR.SUPPORT) A.nSupport++;
  _boxesCsr(A, B);
  _calibrate(A, opts);
  return A;
}

// Prostopadłościany bloków: CSR po blokach (kolejność dodania w bloku), udziały masy → Σ = 1 na blok.
function _boxesCsr(A, B) {
  const n = A.n, nb = B.nBox | 0, W = STRUCT_BOX_STRIDE;
  const start = new Int32Array(n + 1), data = new Float64Array(nb * W);
  for (let i = 0; i < nb; i++) start[B.boxBlock[i] + 1]++;
  for (let b = 0; b < n; b++) start[b + 1] += start[b];
  const fill = start.slice(0, n);
  for (let i = 0; i < nb; i++) {
    const o = fill[B.boxBlock[i]]++ * W;
    for (let w = 0; w < W; w++) data[o + w] = B.boxData[i * W + w];
  }
  for (let b = 0; b < n; b++) {
    let s = 0;
    for (let j = start[b]; j < start[b + 1]; j++) s += data[j * W + 7];
    if (!(s > 0)) { const c = start[b + 1] - start[b]; for (let j = start[b]; j < start[b + 1]; j++) data[j * W + 7] = 1 / c; continue; }
    for (let j = start[b]; j < start[b + 1]; j++) data[j * W + 7] /= s;
  }
  A.boxStart = start; A.boxData = data; A.boxCount = nb;
}

/**
 * Prostopadłościany bloków `blocks[0..count)` jako wejście buildClusterDesc (beamRigid3D.js): [{ x, y, z (środek), hx,
 * hy, hz (półosie), mass, id (numer bloku w grafie), q (obrót wokół z: { x, y, z, w } albo null) }] w układzie
 * archetypu. Masa = masa bloku × udział × massUnit (domyślnie STRUCT_MASS_UNIT = 45²: masa grafu → masa silnika
 * belek). Bloki bez prostopadłościanów (kotwice) pomija. `out` — tablica do ponownego użycia (obiekty nadpisywane,
 * długość przycinana). Kwaternion jest zawsze nowy: opis z buildClusterDesc trzyma referencje `q` (blockQuat), więc
 * ponowne użycie `out` nie może zmienić opisu wcześniejszego klastra. Poza krokiem (narodziny klastra).
 */
export function structureBlockBoxes(A, blocks, count = blocks.length, out = [], massUnit = STRUCT_MASS_UNIT) {
  const W = STRUCT_BOX_STRIDE, st = A.boxStart, d = A.boxData;
  let k = 0;
  if (st) {
    for (let t = 0; t < count; t++) {
      const b = blocks[t];
      for (let j = st[b]; j < st[b + 1]; j++) {
        const o = j * W;
        let r = out[k];
        if (!r) { r = { x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, mass: 0, id: 0, q: null }; out[k] = r; }
        r.x = d[o]; r.y = d[o + 1]; r.z = d[o + 2]; r.hx = d[o + 3]; r.hy = d[o + 4]; r.hz = d[o + 5];
        r.mass = A.mass[b] * d[o + 7] * massUnit; r.id = b;
        const yaw = d[o + 6];
        r.q = yaw !== 0 ? { x: 0, y: 0, z: Math.sin(yaw * 0.5), w: Math.cos(yaw * 0.5) } : null;
        k++;
      }
    }
  }
  out.length = k;
  return out;
}

// Kalibracja: nienaruszona budowla do zbieżności; każde wiązanie przy u0 z podłogami grupy / poziomu / budowli.
function _calibrate(A, opts) {
  const T = A.tune;
  const S = createStructure(A, { id: 0 });
  S.calibrating = true;
  _setupActive(S);
  _assemble(S);
  let err = 1;
  for (let pass = 0; pass < 800 && err > 1e-10; pass++) err = _cgPass(S, S.mode, S.act, S.nAct, 50, 1e-11);
  _bondForces(S);
  _sectionCheck(S, true);
  const e = A.e, base = new Float64Array(e);
  const sf = T.shearFrac;
  const tfOf = (k) => (A.cls[k] === STRUCT_BOND.VERT || A.cls[k] === STRUCT_BOND.CHORD ? T.tensionFrac : T.tensionFracOther);
  for (let k = 0; k < e; k++) {
    const tf = tfOf(k);
    if (!S.inAct[k]) { base[k] = 0; continue; }
    const Aa = A.area[k];
    const N = S.nAx[k];
    const sc = Math.max(N < 0 ? -N / Aa : 0, S.secC[k] > 0 ? S.secC[k] / Aa : 0);
    const st = Math.max(N > 0 ? N / Aa : 0, S.secC[k] < 0 ? -S.secC[k] / Aa : 0);
    const ss = S.shr[k] / Aa;
    base[k] = Math.max(sc, st / tf, ss / sf);
  }
  // podłogi: grupa (poziom wiązania × klasa), poziom, budowla
  const lvOf = (k) => { const la = A.level[A.ba[k]], lb = A.level[A.bb[k]]; return Math.max(la, lb, 0); };
  const NL = Math.max(1, A.nLevels), NC = 16;
  const gMax = new Float64Array(NL * NC), lMax = new Float64Array(NL);
  let all = 0;
  for (let k = 0; k < e; k++) {
    const l = lvOf(k), c = A.cls[k] & 15, v = base[k];
    if (v > gMax[l * NC + c]) gMax[l * NC + c] = v;
    if (v > lMax[l]) lMax[l] = v;
    if (v > all) all = v;
  }
  const rnd = structureRng(A.seed ^ 0x51a7e);
  const sp = T.spread;
  for (let k = 0; k < e; k++) {
    const l = lvOf(k), c = A.cls[k] & 15;
    let b = Math.max(base[k], T.floorGroup * gMax[l * NC + c], T.floorLevel * lMax[l], T.floorGlobal * all);
    if (!(b > 0)) b = 1e-9 + T.floorGlobal * all;
    const f = 1 + sp * (2 * rnd() - 1);
    A.limC[k] = b / T.u0 * f; A.limT[k] = A.limC[k] * tfOf(k); A.limS[k] = A.limC[k] * sf;
  }
  // nośność podpór SUPPORT bez wartości: reakcja nienaruszona × supportCapMul
  const capMul = opts.supportCapMul ?? 3;
  for (let i = 0; i < A.n; i++) {
    if (A.anchor[i] !== STRUCT_ANCHOR.SUPPORT || A.anchorCap[i] > 0) continue;
    A.anchorCap[i] = Math.max(1e-9, _reaction(S, i) * capMul);
  }
  // ciepły start egzemplarzy: przemieszczenia nienaruszonej budowli (stan z ekranu ładowania) — smukłe kratownice
  // (wspornik, płyta dysku) z zimnego startu zbiegają setki iteracji
  A.u0x = S.ux.slice(); A.u0y = S.uy.slice(); A.u0z = S.uz.slice();
  // skale trybu miękkiego (_markSoft): największe przemieszczenie i ‖f‖ nienaruszonej budowli pod ciężarem
  let us = 0;
  for (let i = 0; i < A.n; i++) { const v = S.ux[i] * S.ux[i] + S.uy[i] * S.uy[i] + S.uz[i] * S.uz[i]; if (v > us) us = v; }
  A.uScale = Math.sqrt(us) || 1; A.fScale = Math.sqrt(S.fn2) || 1;
  A.calib = { err, maxBase: all };
}

// ── EGZEMPLARZ ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Egzemplarz archetypu: stan, bufory solvera i zdarzeń (wszystko prealokowane — krok bez alokacji). */
export function createStructure(A, opts = {}) {
  const n = A.n, e = A.e, nI = 2 * n + 2;
  const F = () => new Float64Array(n), V = () => new Float64Array(n + 1);
  const S = {
    arch: A, id: opts.id | 0, time: 0, lastEval: 0, tick: 0, dt: 0,
    jFirst: -1, jLast: -1,   // czasy pierwszego i ostatniego impulsu od poprzedniej oceny (okno siły impulsu)
    calibrating: false, hold: 1,
    // bloki
    dead: new Uint8Array(n), island: new Int32Array(n).fill(-1), anchorOn: new Uint8Array(n), mode: new Uint8Array(n),
    mode2: new Uint8Array(n), mech: new Uint8Array(n), soft: new Uint8Array(n), Rx: F(), Ry: F(), Rz: F(),
    // wyspa swobodna: prawa strona i przemieszczenia między wywołaniami (kontynuacja niezbieżnego rozwiązania)
    ifx: F(), ify: F(), ifz: F(), iux: F(), iuy: F(), iuz: F(), islPend: -1, islPendVer: -1, topoVer: 0, lx: F(), ly: F(), lz: F(), jx: F(), jy: F(), jz: F(), util: new Uint8Array(n), utilF: F(),
    // wektory solvera mają slot n = „ziemia” (x[n] = 0): kotwice i bloki spoza solve wskazują na niego, więc
    // pętla wiązań nie ma rozgałęzień (pa / pb — końce aktywnych wiązań po mapowaniu, pk — n, k_a − k_s, k_s)
    ux: V(), uy: V(), uz: V(), rx: V(), ry: V(), rz: V(), zx: V(), zy: V(), zz: V(),
    px: V(), py: V(), pz: V(), qx: V(), qy: V(), qz: V(), fx: V(), fy: V(), fz: V(), pre: new Float64Array(6 * n),
    pa: new Int32Array(e), pb: new Int32Array(e), pk: new Float64Array(5 * e),
    // wiązania
    alive: new Uint8Array(e).fill(1), health: new Float64Array(e).fill(1), strength: new Float64Array(e).fill(1),
    ka: new Float64Array(e), kS: new Float64Array(e), ratio: new Float64Array(e), nAx: new Float64Array(e), shr: new Float64Array(e),
    secC: new Float64Array(e), secR: new Float64Array(e), brokeAt: new Float64Array(e).fill(-1e9), queued: new Uint8Array(e),
    inAct: new Uint8Array(e), act: new Int32Array(e), nAct: 0, act2: new Int32Array(e), nAct2: 0,
    // kolejka zerwań (pierścień)
    q: new Int32Array(e), qMode: new Uint8Array(e), qHead: 0, qCount: 0,
    // wyspy
    parent: new Int32Array(n), root: new Int32Array(n), rootAnch: new Uint8Array(n), rootIsl: new Int32Array(n),
    nIsl: 0, islClaim: new Int32Array(nI).fill(-1), islParent: new Int32Array(nI).fill(-1), islNew: new Uint8Array(nI),
    newList: new Int32Array(nI), nNew: 0,
    islMass: new Float64Array(nI), islCx: new Float64Array(nI), islCy: new Float64Array(nI), islCz: new Float64Array(nI),
    islCount: new Int32Array(nI), islLmin: new Int32Array(nI), islLmax: new Int32Array(nI),
    islA1: new Float64Array(nI), islB1: new Float64Array(nI), islA2: new Float64Array(nI), islB2: new Float64Array(nI),
    islDrop: new Uint8Array(nI), islHinge: new Uint8Array(nI), islRetired: new Uint8Array(nI),
    // poziomy (przekroje, front)
    levW: new Float64Array(Math.max(1, A.nLevels)), levQ1: new Float64Array(Math.max(1, A.nLevels)), levQ2: new Float64Array(Math.max(1, A.nLevels)),
    levMass: new Float64Array(Math.max(1, A.nLevels)), levCap: new Float64Array(Math.max(1, A.nLevels)),
    // stan solvera
    dirty: true, topoDirty: true, pending: 0, fatigued: false, fn2: 0, lastErr: 0, lastIters: 0,
    // zdarzenia
    ev: new Float64Array(STRUCT_EV_CAP * STRUCT_EV_STRIDE), evCount: 0, evDropped: 0,
    brkRec: 0, brkAggN: 0, brkAggX: 0, brkAggY: 0, brkAggZ: 0, breaksThisStep: 0, breakBudget: 0, cutsThisStep: 0,
    // front
    front: createCollapseFront(),
    // statystyki (narzędzia, testy)
    stats: { passes: 0, evals: 0, breaks: 0, maxEvalErr: 0, lastEvalErr: 0, islands: 0, iters: 0,
      softMarks: 0, mechCuts: 0, maxPending: 0, splitCuts: 0, crushCuts: 0, islandRefused: 0 }
  };
  for (let i = 0; i < n; i++) S.anchorOn[i] = A.anchor[i] ? 1 : 0;
  for (let k = 0; k < e; k++) S.ka[k] = A.k0[k];
  if (A.u0x) { S.ux.set(A.u0x); S.uy.set(A.u0y); S.uz.set(A.u0z); }
  return S;
}

// Tryb bloków solvera budowli: 0 poza (martwy, wyspa swobodna), 1 stopnie swobody, 2 kotwica (u = 0). Lista
// aktywnych wiązań: żywe, oba końce w części zakotwiczonej, co najmniej jeden ruchomy.
function _setupActive(S) {
  const A = S.arch, n = A.n, e = A.e, mode = S.mode, dead = S.dead, isl = S.island, anc = S.anchorOn;
  for (let i = 0; i < n; i++) mode[i] = dead[i] || isl[i] >= 0 ? 0 : (anc[i] ? 2 : 1);
  let c = 0;
  const ba = A.ba, bb = A.bb, alive = S.alive, inAct = S.inAct, act = S.act;
  for (let k = 0; k < e; k++) {
    inAct[k] = 0;
    if (!alive[k]) continue;
    const ma = mode[ba[k]], mb = mode[bb[k]];
    if (!ma || !mb || (ma === 2 && mb === 2)) continue;
    inAct[k] = 1; act[c++] = k;
  }
  S.nAct = c;
  S.topoDirty = false;
}

// Obciążenia części zakotwiczonej: ciężar (m·g·ĝ) + obciążenia chwilowe (fala, styk). fn2 = ‖f‖².
function _assemble(S) {
  const A = S.arch, n = A.n, mode = S.mode, G = A.g;
  const gx = A.gx * G, gy = A.gy * G, gz = A.gz * G, m = A.mass;
  const fx = S.fx, fy = S.fy, fz = S.fz, lx = S.lx, ly = S.ly, lz = S.lz, jx = S.jx, jy = S.jy, jz = S.jz;
  // impulsy (fala, styk) jako siła średnia w oknie, w którym PRZYSZŁY (od pierwszego do ostatniego impulsu + krok),
  // nie krótszym niż pulseT (jeden okres przebiegu): pojedyncze trafienie = J / pulseT niezależnie od fazy i od
  // serii niezbieżnych przebiegów (okno „od poprzedniej oceny” rosło, póki CG nie zbiegł — siła malała do 10×),
  // styk ciągły F·dt co krok = F
  const span = S.jFirst >= 0 ? S.jLast - S.jFirst + S.dt : 0, w = 1 / (span > A.tune.pulseT ? span : A.tune.pulseT);
  let f2 = 0;
  for (let i = 0; i < n; i++) {
    if (mode[i] !== 1) { fx[i] = 0; fy[i] = 0; fz[i] = 0; S.ux[i] = 0; S.uy[i] = 0; S.uz[i] = 0; continue; }
    const a = m[i] * gx + lx[i] + jx[i] * w, b = m[i] * gy + ly[i] + jy[i] * w, c = m[i] * gz + lz[i] + jz[i] * w;
    fx[i] = a; fy[i] = b; fz[i] = c; f2 += a * a + b * b + c * c;
  }
  S.fn2 = f2;
}

// Sztywności aktywnych wiązań (zdrowie), ścinanie per wiązanie i prekondycjoner blokowy Jacobiego (odwrotność 3×3).
// MECHANIZM LOKALNY: blok, którego wiązania osiowe nie rozpinają 3D (po zerwaniach: same wiązania w płaszczyźnie
// ściany, jedno wiązanie, linia) — det(Σ k_a·n·nᵀ) / (tr/3)³ < mechTol — dostaje ścinanie shearMech·k_a na swoich
// wiązaniach (inaczej K prawie osobliwa: CG bez zbieżności). Nienaruszone archetypy są kratownicami
// trójkątowanymi, więc mechanizmów nie mają i moment przenoszą pasy (shearK 1e-6). MECHANIZM ROZLEGŁY (bloki
// sztywne osobno, razem przegub — np. kawałek ściany wiszący na jednej linii wiązań): bloki z S.soft (tryb miękki,
// _markSoft) dostają to samo shearMech — zmiana K tylko w mechanizmie, a reszta i ocena liczą się na tej samej K.
function _precond(S, mode, act, nAct) {
  const A = S.arch, n = A.n, pre = S.pre, ka = S.ka, kS = S.kS, k0 = A.k0, health = S.health, T = A.tune;
  const nx = A.nx, ny = A.ny, nz = A.nz, ba = A.ba, bb = A.bb, mech = S.mech;
  const shear = T.shearK, shearM = T.shearMech, soft = S.soft;
  pre.fill(0, 0, 6 * n);
  // 1) bloki osiowe
  for (let t = 0; t < nAct; t++) {
    const k = act[t];
    const kk = k0[k] * health[k]; ka[k] = kk;
    const ex = nx[k], ey = ny[k], ez = nz[k];
    const d0 = kk * ex * ex, d1 = kk * ex * ey, d2 = kk * ex * ez, d3 = kk * ey * ey, d4 = kk * ey * ez, d5 = kk * ez * ez;
    const a = ba[k], b = bb[k];
    if (mode[a] === 1) { const o = 6 * a; pre[o] += d0; pre[o + 1] += d1; pre[o + 2] += d2; pre[o + 3] += d3; pre[o + 4] += d4; pre[o + 5] += d5; }
    if (mode[b] === 1) { const o = 6 * b; pre[o] += d0; pre[o + 1] += d1; pre[o + 2] += d2; pre[o + 3] += d3; pre[o + 4] += d4; pre[o + 5] += d5; }
  }
  // 2) mechanizmy lokalne
  const tol = T.mechTol;
  for (let i = 0; i < n; i++) {
    if (mode[i] !== 1) { mech[i] = 0; continue; }
    const o = 6 * i;
    const a = pre[o], b = pre[o + 1], c = pre[o + 2], d = pre[o + 3], e = pre[o + 4], f = pre[o + 5];
    const det = a * (d * f - e * e) + b * (c * e - b * f) + c * (b * e - c * d), tr3 = (a + d + f) / 3;
    mech[i] = det < tol * tr3 * tr3 * tr3 || soft[i] ? 1 : 0;
  }
  // 3) ścinanie per wiązanie + upakowana lista dla _matvec
  const pa = S.pa, pb = S.pb, pk = S.pk;
  for (let t = 0; t < nAct; t++) {
    const k = act[t], a = ba[k], b = bb[k];
    const ks = ka[k] * (mech[a] || mech[b] ? (shearM > shear ? shearM : shear) : shear); kS[k] = ks;
    const ex = nx[k], ey = ny[k], ez = nz[k];
    pa[t] = mode[a] === 1 ? a : n; pb[t] = mode[b] === 1 ? b : n;
    const o5 = 5 * t; pk[o5] = ex; pk[o5 + 1] = ey; pk[o5 + 2] = ez; pk[o5 + 3] = ka[k] - ks; pk[o5 + 4] = ks;
    const d0 = ks * (1 - ex * ex), d1 = -ks * ex * ey, d2 = -ks * ex * ez, d3 = ks * (1 - ey * ey), d4 = -ks * ey * ez, d5 = ks * (1 - ez * ez);
    if (mode[a] === 1) { const o = 6 * a; pre[o] += d0; pre[o + 1] += d1; pre[o + 2] += d2; pre[o + 3] += d3; pre[o + 4] += d4; pre[o + 5] += d5; }
    if (mode[b] === 1) { const o = 6 * b; pre[o] += d0; pre[o + 1] += d1; pre[o + 2] += d2; pre[o + 3] += d3; pre[o + 4] += d4; pre[o + 5] += d5; }
  }
  for (let i = 0; i < n; i++) {
    if (mode[i] !== 1) continue;
    const o = 6 * i;
    const a = pre[o], b = pre[o + 1], c = pre[o + 2], d = pre[o + 3], e = pre[o + 4], f = pre[o + 5];
    // odwrotność macierzy symetrycznej [[a b c][b d e][c e f]]
    const A0 = d * f - e * e, B0 = c * e - b * f, C0 = b * e - c * d;
    let det = a * A0 + b * B0 + c * C0;
    const tr = a + d + f;
    if (!(det > 1e-12 * tr * tr * tr)) {
      // blok osobliwy (np. jedno wiązanie bez ścinania) — skalarny Jacobi
      const s = tr > 0 ? 3 / tr : 0;
      pre[o] = s; pre[o + 1] = 0; pre[o + 2] = 0; pre[o + 3] = s; pre[o + 4] = 0; pre[o + 5] = s;
      continue;
    }
    det = 1 / det;
    pre[o] = A0 * det; pre[o + 1] = B0 * det; pre[o + 2] = C0 * det;
    pre[o + 3] = (a * f - c * c) * det; pre[o + 4] = (b * c - a * e) * det; pre[o + 5] = (a * d - b * b) * det;
  }
}

// y = K·x po liście wiązań (bez zapisu macierzy). Bloki trybu 2 (kotwica) mają x = 0, wiersze tylko trybu 1.
// Wymaga _precond na tej samej liście (pa / pb / pk). x[n] = 0 (slot ziemi), y[n] — śmieci, nieczytane.
function _matvec(S, mode, act, nAct, xx, xy, xz, yx, yy, yz) {
  const n = S.arch.n, pa = S.pa, pb = S.pb, pk = S.pk;
  yx.fill(0, 0, n + 1); yy.fill(0, 0, n + 1); yz.fill(0, 0, n + 1);
  for (let t = 0; t < nAct; t++) {
    const a = pa[t], b = pb[t], o = 5 * t;
    const dx = xx[b] - xx[a], dy = xy[b] - xy[a], dz = xz[b] - xz[a];
    const ex = pk[o], ey = pk[o + 1], ez = pk[o + 2], ks = pk[o + 4];
    const c = pk[o + 3] * (ex * dx + ey * dy + ez * dz);
    const gx = ks * dx + c * ex, gy = ks * dy + c * ey, gz = ks * dz + c * ez;
    yx[a] -= gx; yy[a] -= gy; yz[a] -= gz;
    yx[b] += gx; yy[b] += gy; yz[b] += gz;
  }
}

// Jeden przebieg PCG (ciepły start z S.u*). Zwraca względną resztę ‖f − K·u‖ / ‖f‖ (z rekurencji; przebieg
// zaczyna od prawdziwej reszty, więc dryf nie kumuluje się między przebiegami).
function _cgPass(S, mode, act, nAct, iters, stopTol) {
  const n = S.arch.n, pre = S.pre;
  const ux = S.ux, uy = S.uy, uz = S.uz, rx = S.rx, ry = S.ry, rz = S.rz, zx = S.zx, zy = S.zy, zz = S.zz;
  const px = S.px, py = S.py, pz = S.pz, qx = S.qx, qy = S.qy, qz = S.qz, fx = S.fx, fy = S.fy, fz = S.fz;
  _precond(S, mode, act, nAct);
  _matvec(S, mode, act, nAct, ux, uy, uz, qx, qy, qz);
  let rzd = 0, rr = 0;
  for (let i = 0; i < n; i++) {
    if (mode[i] !== 1) { rx[i] = ry[i] = rz[i] = 0; px[i] = py[i] = pz[i] = 0; continue; }
    const a = fx[i] - qx[i], b = fy[i] - qy[i], c = fz[i] - qz[i];
    rx[i] = a; ry[i] = b; rz[i] = c;
    const o = 6 * i;
    const sa = pre[o] * a + pre[o + 1] * b + pre[o + 2] * c;
    const sb = pre[o + 1] * a + pre[o + 3] * b + pre[o + 4] * c;
    const sc = pre[o + 2] * a + pre[o + 4] * b + pre[o + 5] * c;
    zx[i] = sa; zy[i] = sb; zz[i] = sc; px[i] = sa; py[i] = sb; pz[i] = sc;
    rzd += a * sa + b * sb + c * sc; rr += a * a + b * b + c * c;
  }
  const fn2 = S.fn2;
  if (!(fn2 > 0)) { S.lastIters = 0; return 0; }
  const stop2 = stopTol * stopTol * fn2;
  let it = 0;
  for (; it < iters && rr > stop2; it++) {
    _matvec(S, mode, act, nAct, px, py, pz, qx, qy, qz);
    let pq = 0;
    for (let i = 0; i < n; i++) if (mode[i] === 1) pq += px[i] * qx[i] + py[i] * qy[i] + pz[i] * qz[i];
    if (!(pq > 0)) break;
    const al = rzd / pq;
    let nz2 = 0; rr = 0;
    for (let i = 0; i < n; i++) {
      if (mode[i] !== 1) continue;
      ux[i] += al * px[i]; uy[i] += al * py[i]; uz[i] += al * pz[i];
      const a = rx[i] - al * qx[i], b = ry[i] - al * qy[i], c = rz[i] - al * qz[i];
      rx[i] = a; ry[i] = b; rz[i] = c;
      const o = 6 * i;
      const sa = pre[o] * a + pre[o + 1] * b + pre[o + 2] * c;
      const sb = pre[o + 1] * a + pre[o + 3] * b + pre[o + 4] * c;
      const sc = pre[o + 2] * a + pre[o + 4] * b + pre[o + 5] * c;
      zx[i] = sa; zy[i] = sb; zz[i] = sc;
      nz2 += a * sa + b * sb + c * sc; rr += a * a + b * b + c * c;
    }
    const be = nz2 / rzd; rzd = nz2;
    for (let i = 0; i < n; i++) {
      if (mode[i] !== 1) continue;
      px[i] = zx[i] + be * px[i]; py[i] = zy[i] + be * py[i]; pz[i] = zz[i] + be * pz[i];
    }
  }
  S.lastIters = it;
  S.stats.iters += it;
  return Math.sqrt(rr / fn2);
}

/** Względna reszta równowagi części zakotwiczonej liczona od nowa (‖f − K·u‖ / ‖f‖) — testy i narzędzia. */
export function structureResidual(S) {
  if (S.topoDirty) _setupActive(S);
  _assemble(S);
  _precond(S, S.mode, S.act, S.nAct);
  _matvec(S, S.mode, S.act, S.nAct, S.ux, S.uy, S.uz, S.qx, S.qy, S.qz);
  let r2 = 0;
  for (let i = 0; i < S.arch.n; i++) {
    if (S.mode[i] !== 1) continue;
    const a = S.fx[i] - S.qx[i], b = S.fy[i] - S.qy[i], c = S.fz[i] - S.qz[i];
    r2 += a * a + b * b + c * c;
  }
  return S.fn2 > 0 ? Math.sqrt(r2 / S.fn2) : 0;
}

// Siły osiowe (rozciąganie +) i ścinające aktywnych wiązań z przemieszczeń.
function _bondForces(S) {
  const A = S.arch, ba = A.ba, bb = A.bb, nx = A.nx, ny = A.ny, nz = A.nz, ka = S.ka, kS = S.kS, mode = S.mode;
  const ux = S.ux, uy = S.uy, uz = S.uz, act = S.act, nAx = S.nAx, shr = S.shr;
  for (let t = 0; t < S.nAct; t++) {
    const k = act[t], a = ba[k], b = bb[k];
    const ma = mode[a] === 1, mb = mode[b] === 1;
    const dx = (mb ? ux[b] : 0) - (ma ? ux[a] : 0), dy = (mb ? uy[b] : 0) - (ma ? uy[a] : 0), dz = (mb ? uz[b] : 0) - (ma ? uz[a] : 0);
    const ex = nx[k], ey = ny[k], ez = nz[k], dot = ex * dx + ey * dy + ez * dz;
    nAx[k] = ka[k] * dot;
    const qx = dx - dot * ex, qy = dy - dot * ey, qz = dz - dot * ez;
    shr[k] = kS[k] * Math.sqrt(qx * qx + qy * qy + qz * qz);
  }
}

// Reakcje kotwic (wektor siły wiązań aktywnych na blok kotwicy) do S.Rx / Ry / Rz — jedno przejście po act.
function _anchorReactions(S) {
  const A = S.arch, ba = A.ba, bb = A.bb, nx = A.nx, ny = A.ny, nz = A.nz, ka = S.ka, kS = S.kS, mode = S.mode;
  const ux = S.ux, uy = S.uy, uz = S.uz, Rx = S.Rx, Ry = S.Ry, Rz = S.Rz, act = S.act;
  Rx.fill(0); Ry.fill(0); Rz.fill(0);
  for (let t = 0; t < S.nAct; t++) {
    const k = act[t], a = ba[k], b = bb[k];
    const ma = mode[a] === 1, mb = mode[b] === 1;
    if (ma && mb) continue;   // kotwica to koniec trybu 2
    const dx = (mb ? ux[b] : 0) - (ma ? ux[a] : 0), dy = (mb ? uy[b] : 0) - (ma ? uy[a] : 0), dz = (mb ? uz[b] : 0) - (ma ? uz[a] : 0);
    const ex = nx[k], ey = ny[k], ez = nz[k], kk = ka[k], ks = kS[k], c = (kk - ks) * (ex * dx + ey * dy + ez * dz);
    const gx = ks * dx + c * ex, gy = ks * dy + c * ey, gz = ks * dz + c * ez;
    if (!ma) { Rx[a] += gx; Ry[a] += gy; Rz[a] += gz; } else { Rx[b] -= gx; Ry[b] -= gy; Rz[b] -= gz; }
  }
}

// Reakcja kotwicy i (moduł siły wiązań aktywnych na blok kotwicy) — kalibracja (raz).
function _reaction(S, i) {
  const A = S.arch, ba = A.ba, bb = A.bb, nx = A.nx, ny = A.ny, nz = A.nz, ka = S.ka, kS = S.kS, mode = S.mode;
  let rx = 0, ry = 0, rz = 0;
  for (let t = 0; t < S.nAct; t++) {
    const k = S.act[t], a = ba[k], b = bb[k];
    if (a !== i && b !== i) continue;
    const ma = mode[a] === 1, mb = mode[b] === 1;
    const dx = (mb ? S.ux[b] : 0) - (ma ? S.ux[a] : 0), dy = (mb ? S.uy[b] : 0) - (ma ? S.uy[a] : 0), dz = (mb ? S.uz[b] : 0) - (ma ? S.uz[a] : 0);
    const ex = nx[k], ey = ny[k], ez = nz[k], kk = ka[k], ks = kS[k], c = (kk - ks) * (ex * dx + ey * dy + ez * dz);
    const gx = ks * dx + c * ex, gy = ks * dy + c * ey, gz = ks * dz + c * ez;
    if (a === i) { rx += gx; ry += gy; rz += gz; } else { rx -= gx; ry -= gy; rz -= gz; }
  }
  return Math.sqrt(rx * rx + ry * ry + rz * rz);
}

// KONTROLA PRZEKROJÓW kondygnacji (belka pięter, N/A ± M·c/I): wagi = sztywność pionowa wiązania k_a·(n·ĝ)²,
// obciążenie = ciężar części zakotwiczonej nad kondygnacją w jej środku masy. secC — siła ściskająca wzdłuż osi
// wiązania (+ ściskanie), secR — stosunek do limitu. Podpora zdegenerowana (jedno wiązanie albo jedna linia)
// z mimośrodem ponad overturnEcc·footR w osi słabej → przewrócenie (stosunek 1e3).
function _sectionCheck(S, calib) {
  const A = S.arch;
  if (!A.nStoreys) return;
  const n = A.n, mode = S.mode, lev = A.level, m = A.mass, G = A.g;
  const e1x = A.e1x, e1y = A.e1y, e1z = A.e1z, e2x = A.e2x, e2y = A.e2y, e2z = A.e2z;
  const levW = S.levW, levQ1 = S.levQ1, levQ2 = S.levQ2, NL = A.nLevels;
  levW.fill(0); levQ1.fill(0); levQ2.fill(0);
  for (let i = 0; i < n; i++) {
    if (mode[i] !== 1) continue;
    const l = lev[i]; if (l < 0 || l >= NL) continue;
    const w = m[i] * G;
    levW[l] += w;
    levQ1[l] += w * (A.x[i] * e1x + A.y[i] * e1y + A.z[i] * e1z);
    levQ2[l] += w * (A.x[i] * e2x + A.y[i] * e2y + A.z[i] * e2z);
  }
  const sb = A.storeyBonds, ss = A.storeyStart, ka = S.ka, ng = A.ng, inAct = S.inAct;
  const cx = A.cx, cy = A.cy, cz = A.cz, secC = S.secC, secR = S.secR;
  const area = A.area, health = S.health, strength = S.strength, limC = A.limC, limT = A.limT;
  const ecc = A.tune.overturnEcc * A.footR;
  let W = 0, Q1 = 0, Q2 = 0;
  for (let st = A.nStoreys - 1; st >= 0; st--) {
    if (st < NL) { W += levW[st]; Q1 += levQ1[st]; Q2 += levQ2[st]; }
    let s0 = 0, s1 = 0, s2 = 0, cnt = 0;
    for (let j = ss[st]; j < ss[st + 1]; j++) {
      const k = sb[j];
      secC[k] = 0; secR[k] = 0;
      if (!inAct[k]) continue;
      const s = ka[k] * ng[k] * ng[k];
      if (!(s > 0)) continue;
      s0 += s; s1 += s * (cx[k] * e1x + cy[k] * e1y + cz[k] * e1z); s2 += s * (cx[k] * e2x + cy[k] * e2y + cz[k] * e2z);
      cnt++;
    }
    if (!(s0 > 0) || !(W > 0)) continue;
    const c1 = s1 / s0, c2 = s2 / s0, q1 = Q1 / W, q2 = Q2 / W;
    let I11 = 0, I22 = 0, I12 = 0;
    for (let j = ss[st]; j < ss[st + 1]; j++) {
      const k = sb[j];
      if (!inAct[k]) continue;
      const s = ka[k] * ng[k] * ng[k];
      if (!(s > 0)) continue;
      const p1 = cx[k] * e1x + cy[k] * e1y + cz[k] * e1z - c1, p2 = cx[k] * e2x + cy[k] * e2y + cz[k] * e2z - c2;
      I11 += s * p1 * p1; I22 += s * p2 * p2; I12 += s * p1 * p2;
    }
    const m1 = W * (q1 - c1), m2 = W * (q2 - c2);
    const tr = I11 + I22, det = I11 * I22 - I12 * I12;
    let over = false;
    if (cnt === 1 || !(tr > 0)) over = (q1 - c1) * (q1 - c1) + (q2 - c2) * (q2 - c2) > ecc * ecc;
    else if (!(det > 1e-6 * tr * tr)) {
      // jedna linia podpór: oś słaba = wektor własny mniejszej wartości własnej
      const lmin = 0.5 * tr - Math.sqrt(0.25 * (I11 - I22) * (I11 - I22) + I12 * I12);
      let v1 = I12, v2 = lmin - I11;
      if (Math.abs(I12) < 1e-30 * tr) { v1 = I11 < I22 ? 1 : 0; v2 = I11 < I22 ? 0 : 1; }
      const vl = Math.sqrt(v1 * v1 + v2 * v2) || 1;
      over = Math.abs(((q1 - c1) * v1 + (q2 - c2) * v2) / vl) > ecc;
    }
    const k1 = det > 1e-6 * tr * tr ? (I22 * m1 - I12 * m2) / det : 0, k2 = det > 1e-6 * tr * tr ? (I11 * m2 - I12 * m1) / det : 0;
    const e0 = W / s0;
    for (let j = ss[st]; j < ss[st + 1]; j++) {
      const k = sb[j];
      if (!inAct[k]) continue;
      const g = ng[k], s = ka[k] * g * g;
      if (!(s > 0)) continue;
      const p1 = cx[k] * e1x + cy[k] * e1y + cz[k] * e1z - c1, p2 = cx[k] * e2x + cy[k] * e2y + cz[k] * e2z - c2;
      const V = s * (e0 + k1 * p1 + k2 * p2);
      const C = V / Math.abs(g);
      secC[k] = C;
      if (calib) continue;
      const Ae = area[k] * health[k] * (strength[k] > 1e-9 ? strength[k] : 1e-9);
      secR[k] = over ? 1e3 : (C > 0 ? C / (Ae * limC[k]) : -C / (Ae * limT[k]));
    }
  }
}

// Zerwania z samej kontroli przekrojów (przebieg niezbieżny): kondygnacje ze stosunkiem ponad krytycznym.
function _sectionBreaks(S) {
  _sectionCheck(S, false);
  const A = S.arch, crit = A.tune.critMul, sb = A.storeyBonds, n = A.storeyStart[A.nStoreys];
  let q = 0;
  for (let j = 0; j < n; j++) {
    const k = sb[j];
    if (!S.inAct[k] || !(S.secR[k] > crit)) continue;
    S.ratio[k] = S.secR[k];
    _queueBreak(S, k, STRUCT_MODE.SECTION); q++;
  }
  return q;
}

// ── zdarzenia ──
function _evSlot(S) {
  if (S.evCount >= STRUCT_EV_CAP - 1) { S.evDropped++; return -1; }
  const o = S.evCount * STRUCT_EV_STRIDE;
  S.evCount++;
  const ev = S.ev;
  for (let j = 0; j < STRUCT_EV_STRIDE; j++) ev[o + j] = 0;
  ev[o + 1] = S.time;
  return o;
}

function _queueBreak(S, k, mode) {
  if (S.queued[k] || !S.alive[k]) return;
  S.queued[k] = 1;
  const e = S.arch.e;
  const slot = (S.qHead + S.qCount) % e;
  S.q[slot] = k; S.qMode[slot] = mode; S.qCount++;
}

function _breakNow(S, k, mode, fatigue) {
  if (!S.alive[k]) return;
  const A = S.arch;
  S.alive[k] = 0; S.queued[k] = 0; S.brokeAt[k] = S.time;
  S.topoDirty = true; S.dirty = true; S.breaksThisStep++; S.stats.breaks++; S.topoVer++;
  if (S.calibrating) return;
  if (S.brkRec < A.tune.breakRecords) {
    const o = _evSlot(S);
    if (o >= 0) {
      const ev = S.ev;
      ev[o] = STRUCT_EV.BREAK; ev[o + 2] = k; ev[o + 3] = mode;
      ev[o + 4] = A.cx[k]; ev[o + 5] = A.cy[k]; ev[o + 6] = A.cz[k];
      ev[o + 7] = A.nx[k]; ev[o + 8] = A.ny[k]; ev[o + 9] = A.nz[k];
      ev[o + 13] = S.ratio[k]; ev[o + 14] = fatigue ? 1 : 0;
      S.brkRec++;
    }
  } else {
    S.brkAggN++; S.brkAggX += A.cx[k]; S.brkAggY += A.cy[k]; S.brkAggZ += A.cz[k];
  }
}

// Zerwania z kolejki w budżecie kroku (≤ breaksPer120 na 1/120 s); nadmiar czeka do następnego kroku.
function _drainQueue(S) {
  const e = S.arch.e, ba = S.arch.ba, bb = S.arch.bb;
  while (S.qCount > 0 && S.breaksThisStep < S.breakBudget) {
    const k = S.q[S.qHead], mode = S.qMode[S.qHead];
    S.qHead = (S.qHead + 1) % e; S.qCount--;
    S.queued[k] = 0;
    if (!S.alive[k]) continue;
    _breakNow(S, k, mode, mode === STRUCT_MODE.FATIGUE);
  }
}

// ── wyspy (union-find po żywych wiązaniach między żywymi blokami) ──
function _find(parent, i) {
  while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
  return i;
}

function _islands(S, splitAllowed) {
  const A = S.arch, n = A.n, e = A.e, parent = S.parent, dead = S.dead, ba = A.ba, bb = A.bb, alive = S.alive;
  for (let i = 0; i < n; i++) parent[i] = i;
  for (let k = 0; k < e; k++) {
    if (!alive[k]) continue;
    const a = ba[k], b = bb[k];
    if (dead[a] || dead[b]) continue;
    let ra = _find(parent, a), rb = _find(parent, b);
    if (ra === rb) continue;
    if (ra < rb) { const t = ra; ra = rb; rb = t; }
    parent[ra] = rb;   // korzeń = najmniejszy indeks (deterministycznie)
  }
  const root = S.root, rootAnch = S.rootAnch, rootIsl = S.rootIsl, isl = S.island;
  rootAnch.fill(0); rootIsl.fill(-2);
  for (let i = 0; i < n; i++) {
    if (dead[i]) continue;
    const r = _find(parent, i); root[i] = r;
    if (S.anchorOn[i]) rootAnch[r] = 1;
    if (isl[i] >= 0) S.islClaim[isl[i]] = -1;
  }
  S.nNew = 0;
  for (let i = 0; i < n; i++) {
    if (dead[i]) continue;
    const r = root[i];
    if (rootAnch[r]) { isl[i] = -1; continue; }
    if (rootIsl[r] === -2) {
      const old = isl[i];
      if (old >= 0 && !S.islRetired[old] && S.islClaim[old] === -1) { S.islClaim[old] = r; rootIsl[r] = old; }
      else {
        const id = S.nIsl++;
        rootIsl[r] = id; S.islParent[id] = old; S.islNew[id] = 1; S.islClaim[id] = r;
        S.islDrop[id] = 0; S.islHinge[id] = 0;
        S.newList[S.nNew++] = id;
      }
    }
    isl[i] = rootIsl[r];
  }
  if (!S.nNew) return 0;
  S.topoVer++;
  // statystyki nowych wysp
  const e1x = A.e1x, e1y = A.e1y, e1z = A.e1z, e2x = A.e2x, e2y = A.e2y, e2z = A.e2z;
  for (let j = 0; j < S.nNew; j++) {
    const id = S.newList[j];
    S.islMass[id] = 0; S.islCx[id] = 0; S.islCy[id] = 0; S.islCz[id] = 0; S.islCount[id] = 0;
    S.islLmin[id] = 1 << 30; S.islLmax[id] = -(1 << 30);
    S.islA1[id] = Infinity; S.islB1[id] = -Infinity; S.islA2[id] = Infinity; S.islB2[id] = -Infinity;
  }
  for (let i = 0; i < n; i++) {
    if (dead[i]) continue;
    const id = isl[i];
    if (id < 0 || !S.islNew[id]) continue;
    const m = A.mass[i];
    S.islMass[id] += m; S.islCx[id] += m * A.x[i]; S.islCy[id] += m * A.y[i]; S.islCz[id] += m * A.z[i]; S.islCount[id]++;
    const l = A.level[i];
    if (l < S.islLmin[id]) S.islLmin[id] = l;
    if (l > S.islLmax[id]) S.islLmax[id] = l;
    const p1 = A.x[i] * e1x + A.y[i] * e1y + A.z[i] * e1z, p2 = A.x[i] * e2x + A.y[i] * e2y + A.z[i] * e2z;
    if (p1 < S.islA1[id]) S.islA1[id] = p1;
    if (p1 > S.islB1[id]) S.islB1[id] = p1;
    if (p2 < S.islA2[id]) S.islA2[id] = p2;
    if (p2 > S.islB2[id]) S.islB2[id] = p2;
  }
  let splitHappened = false;
  for (let j = 0; j < S.nNew; j++) {
    const id = S.newList[j];
    const m = S.islMass[id];
    if (m > 0) { S.islCx[id] /= m; S.islCy[id] /= m; S.islCz[id] /= m; }
    // PĘKNIĘCIE WYSOKIEJ WĄSKIEJ WYSPY (wyspa oderwana od budowli; rodzic −1): ≥ splitMinLevels poziomów, rzut
    // węższy niż sliverFrac rzutu budowli → wiązania między paczkami chunkLevels poziomów idą do kolejki (SPLIT)
    // i pękają w budżecie kroku (≤ breaksPer120; nadmiar w kolejnych krokach — kawałki wychodzą z rodzicem).
    if (splitAllowed && A.split && S.islParent[id] === -1) {
      const levels = S.islLmax[id] - S.islLmin[id] + 1;
      const w1 = S.islB1[id] - S.islA1[id], w2 = S.islB2[id] - S.islA2[id];
      const narrow = Math.min(w1, w2);   // plaster: ściana (jedna oś rzutu ~0) albo słup
      if (levels >= A.splitMinLevels && narrow < A.sliverFrac * 2 * A.footR) {
        const ch = A.chunkLevels, l0 = S.islLmin[id];
        let cut = 0;
        for (let k = 0; k < e; k++) {
          if (!alive[k]) continue;
          const a = ba[k], b = bb[k];
          if (isl[a] !== id || isl[b] !== id) continue;
          const ca = Math.floor((A.level[a] - l0) / ch), cb = Math.floor((A.level[b] - l0) / ch);
          if (ca === cb) continue;
          _queueBreak(S, k, STRUCT_MODE.SPLIT); cut++;
        }
        S.stats.splitCuts += cut;
        if (cut) {
          const o = _evSlot(S);
          if (o >= 0) {
            S.ev[o] = STRUCT_EV.SPLIT; S.ev[o + 2] = id; S.ev[o + 3] = Math.ceil(levels / ch);
            S.ev[o + 4] = S.islCx[id]; S.ev[o + 5] = S.islCy[id]; S.ev[o + 6] = S.islCz[id]; S.ev[o + 13] = levels;
          }
          splitHappened = true;
          S.islNew[id] = 0; S.islRetired[id] = 1;   // rodzic znika — kawałki dostaną nowe id (rodzic = id)
          continue;
        }
      }
    }
  }
  if (splitHappened) {
    // rodzice rozbitych wysp mają już nowe dzieci po ponownym union-find; reszta nowych wysp zostaje przy swoich id
    const keepN = S.nNew;
    for (let j = 0; j < keepN; j++) { const id = S.newList[j]; if (S.islNew[id]) _emitIsland(S, id); }
    for (let j = 0; j < keepN; j++) S.islNew[S.newList[j]] = 0;
    S.stats.islands += keepN;
    _drainQueue(S);   // cięcia plastra w budżecie kroku (FIFO za wcześniejszymi zerwaniami)
    return keepN + _islands(S, false);
  }
  // najpierw zdarzenia wszystkich nowych wysp, potem flagi (_isSupport: podparciem bywa wyspa oderwana w tym kroku)
  for (let j = 0; j < S.nNew; j++) _emitIsland(S, S.newList[j]);
  for (let j = 0; j < S.nNew; j++) S.islNew[S.newList[j]] = 0;
  S.stats.islands += S.nNew;
  return S.nNew;
}

// Zdarzenie ISLAND (+ HINGE) nowej wyspy. ZAWIAS: wyspa oderwana od budowli (rodzic −1), masa ≥ hingeMinMassFrac;
// podparcie = wiązania między wyspą a częścią zakotwiczoną zerwane w ostatnich hingeWindow s (kaskada).
// (1) KIERUNEK i decyzja przechył / spadek: środek sztywności podparcia z chwili zerwania (k0·zdrowie·wytrzymałość·
//     ((n·ĝ)² + 0,05) — część przekroju, która jeszcze niosła; zjedzone ostrzałem prawie się nie liczą) wobec środka
//     masy wyspy: mimośród < hingeMinEcc·footR → spadek pionowy (front; v3 = 1), inaczej przechył ku (środek masy −
//     środek podparcia) — od części, która trzymała, ku stronie podciętej (D11). Ważenie ściskaniem z rozwiązania
//     przesuwało środek KU stronie podciętej (belka ściska włókna od strony mimośrodu).
// (2) PUNKT ZAWIASU = OSTATNIA LINIA PODPÓR: wiązania podparcia w pasie hingeBand·footR od skrajnego po stronie
//     PRZECIWNEJ do przechyłu (min (c − środek masy)·kierunek), średnia ważona sztywnością nominalną. Kaskada podcięcia
//     idzie od strony podciętej ku przeciwnej i ostatnie pękają ściskane słupy tej krawędzi (scripts/struktura-sym.mjs
//     --tryb podciecie). Środek całego okna wychodził przy środku rzutu (ramię 35–45 j.) — obrót wokół niego wpychał
//     połowę podstawy w kikut. Ramię (v1) = odległość pozioma punktu zawiasu od środka masy.
// Oś = (−ĝ) × kierunek (obrót o +kąt przechyla górę ku kierunkowi). Brak wiązań w oknie (kotwice puściły — pomost
// zniszczony, D13) → spadek pionowy.
// Wiązanie k (zerwane) podpierało wyspę id: drugi koniec w części zakotwiczonej albo w wyspie oderwanej w tym samym
// kroku PONIŻEJ (cała budowla zeszła z kotwic razem z kondygnacją 0 — podparciem górnej wyspy jest ta kondygnacja).
function _isSupport(S, id, k) {
  const A = S.arch, a = A.ba[k], b = A.bb[k], isl = S.island;
  if (S.dead[a] || S.dead[b]) return false;
  let me, ot;
  if (isl[a] === id && isl[b] !== id) { me = a; ot = b; } else if (isl[b] === id && isl[a] !== id) { me = b; ot = a; } else return false;
  const io = isl[ot];
  if (io === -1) return true;
  if (io < 0 || !S.islNew[io]) return false;
  const hm = -(A.x[me] * A.gx + A.y[me] * A.gy + A.z[me] * A.gz), ho = -(A.x[ot] * A.gx + A.y[ot] * A.gy + A.z[ot] * A.gz);
  return ho < hm - 1;
}

function _emitIsland(S, id) {
  const A = S.arch, T = A.tune;
  const o = _evSlot(S);
  if (o >= 0) {
    const ev = S.ev;
    ev[o] = STRUCT_EV.ISLAND; ev[o + 2] = id; ev[o + 3] = S.islCount[id];
    ev[o + 4] = S.islCx[id]; ev[o + 5] = S.islCy[id]; ev[o + 6] = S.islCz[id];
    ev[o + 13] = S.islMass[id]; ev[o + 14] = S.islParent[id];
  }
  if (S.islParent[id] !== -1 || S.islMass[id] < T.hingeMinMassFrac * A.totalMass) { if (o >= 0) S.ev[o + 15] = 0; return; }
  const t0 = S.time - T.hingeWindow;
  const gx = A.gx, gy = A.gy, gz = A.gz, mx = S.islCx[id], my = S.islCy[id], mz = S.islCz[id];
  let w = 0, sx = 0, sy = 0, sz = 0, cnt = 0, tx = 0, ty = 0, tz = 0;
  for (let k = 0; k < A.e; k++) {
    if (S.alive[k] || S.brokeAt[k] < t0) continue;
    if (!_isSupport(S, id, k)) continue;
    const g = A.ng[k];
    const c = A.k0[k] * S.health[k] * (S.strength[k] > 0 ? S.strength[k] : 0) * (g * g + 0.05);
    w += c; sx += c * A.cx[k]; sy += c * A.cy[k]; sz += c * A.cz[k];
    tx += A.cx[k]; ty += A.cy[k]; tz += A.cz[k]; cnt++;
  }
  if (!cnt) { if (o >= 0) S.ev[o + 15] = 1; S.islDrop[id] = 1; return; }
  let Px, Py, Pz;
  if (w > 0) { Px = sx / w; Py = sy / w; Pz = sz / w; } else { Px = tx / cnt; Py = ty / cnt; Pz = tz / cnt; }
  let dx = mx - Px, dy = my - Py, dz = mz - Pz;
  const dg = dx * gx + dy * gy + dz * gz;
  dx -= dg * gx; dy -= dg * gy; dz -= dg * gz;
  const ecc = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (ecc < T.hingeMinEcc * A.footR) { if (o >= 0) S.ev[o + 15] = 1; S.islDrop[id] = 1; return; }
  dx /= ecc; dy /= ecc; dz /= ecc;
  // ostatnia linia podpór: skrajne wiązania podparcia po stronie przeciwnej do przechyłu
  let pmin = Infinity;
  for (let k = 0; k < A.e; k++) {
    if (S.alive[k] || S.brokeAt[k] < t0) continue;
    if (!_isSupport(S, id, k)) continue;
    const p = (A.cx[k] - mx) * dx + (A.cy[k] - my) * dy + (A.cz[k] - mz) * dz;
    if (p < pmin) pmin = p;
  }
  const band = pmin + T.hingeBand * A.footR;
  let hw = 0, hx = 0, hy = 0, hz = 0, hn = 0;
  for (let k = 0; k < A.e; k++) {
    if (S.alive[k] || S.brokeAt[k] < t0) continue;
    if (!_isSupport(S, id, k)) continue;
    if ((A.cx[k] - mx) * dx + (A.cy[k] - my) * dy + (A.cz[k] - mz) * dz > band) continue;
    const g = A.ng[k], c = A.k0[k] * (g * g + 0.05);
    hw += c; hx += c * A.cx[k]; hy += c * A.cy[k]; hz += c * A.cz[k]; hn++;
  }
  hx /= hw; hy /= hw; hz /= hw;
  const arm = (mx - hx) * dx + (my - hy) * dy + (mz - hz) * dz;
  // oś = up × dir, up = −ĝ
  const ux = -gx, uy = -gy, uz = -gz;
  const ax = uy * dz - uz * dy, ay = uz * dx - ux * dz, az = ux * dy - uy * dx;
  S.islHinge[id] = 1;
  const h = _evSlot(S);
  if (h < 0) return;
  const ev = S.ev;
  ev[h] = STRUCT_EV.HINGE; ev[h + 2] = id; ev[h + 3] = hn;
  ev[h + 4] = hx; ev[h + 5] = hy; ev[h + 6] = hz; ev[h + 7] = dx; ev[h + 8] = dy; ev[h + 9] = dz;
  ev[h + 10] = ax; ev[h + 11] = ay; ev[h + 12] = az;
  ev[h + 13] = arm; ev[h + 14] = T.hingeBreakTiltDeg; ev[h + 15] = S.islMass[id];
}

// TRYB MIĘKKI: przebieg CG nie zbiegł softAfter razy z rzędu. Mechanizm (przegub, kawałek na jednej linii wiązań)
// to kierunek o sztywności ~shearK, wzdłuż którego iteracje CG rosną bez końca — przemieszczenia bloków mechanizmu
// idą w dziesiątki–setki skali sprężystej budowli, a zwykła wolna zbieżność po zerwaniach zostaje w kilku. Bloki
// z |u| ≥ softU · uScale · max(1, ‖f‖ / fScale) dostają shearMech (_precond): mechanizm niesie obciążenie ścinaniem
// przegubu (i pęka — SHEAR), K przestaje być prawie osobliwa, a ocena idzie na tej samej K (reszta ≤ solveTol na
// modelu, na którym liczy się siły; reszta budowli bez zmian). Zwraca liczbę nowych bloków.
function _markSoft(S, mode) {
  const A = S.arch, n = A.n, ux = S.ux, uy = S.uy, uz = S.uz, soft = S.soft;
  const fr = Math.sqrt(S.fn2) / A.fScale, thr = A.tune.softU * A.uScale * (fr > 1 ? fr : 1), t2 = thr * thr;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (mode[i] !== 1 || soft[i]) continue;
    if (ux[i] * ux[i] + uy[i] * uy[i] + uz[i] * uz[i] >= t2) { soft[i] = 1; cnt++; }
  }
  S.stats.softMarks += cnt;
  return cnt;
}

// ZAWALENIE MECHANIZMU: CG nie zbiega mechAfter przebiegów mimo trybu miękkiego — część budowli trzyma się tylko
// przegubem (u rośnie bez końca). Wiązania aktywne między blokami ruchomymi o |u| ≥ próg _markSoft a resztą (bloki
// o małym |u| albo kotwice) idą do kolejki (MECH, budżet kroku): mechanizm odpada jako wyspa, reszta zbiega. Bez
// bloków ponad progiem — nic (przebiegi dalej w fazie, ocena dopiero po zbieżności). Zwraca liczbę wiązań.
function _mechanismCollapse(S) {
  const A = S.arch, mode = S.mode, ux = S.ux, uy = S.uy, uz = S.uz, ba = A.ba, bb = A.bb;
  const fr = Math.sqrt(S.fn2) / A.fScale, thr = A.tune.softU * A.uScale * (fr > 1 ? fr : 1), t2 = thr * thr;
  let q = 0;
  for (let t = 0; t < S.nAct; t++) {
    const k = S.act[t], a = ba[k], b = bb[k];
    const inA = mode[a] === 1 && ux[a] * ux[a] + uy[a] * uy[a] + uz[a] * uz[a] >= t2;
    const inB = mode[b] === 1 && ux[b] * ux[b] + uy[b] * uy[b] + uz[b] * uz[b] >= t2;
    if (inA === inB) continue;
    S.ratio[k] = 0;
    _queueBreak(S, k, STRUCT_MODE.MECH); q++;
  }
  S.stats.mechCuts += q;
  return q;
}

// ── ocena: stosunki, zmęczenie, kolejka zerwań, podpory, wykorzystanie bloków ──
function _evaluate(S, dtEval) {
  const A = S.arch, T = A.tune, crit = T.critMul;
  _bondForces(S);
  _sectionCheck(S, false);
  const act = S.act, nAct = S.nAct, area = A.area, health = S.health, strength = S.strength;
  const limC = A.limC, limT = A.limT, limS = A.limS, nAx = S.nAx, shr = S.shr, ratio = S.ratio, secR = S.secR, storey = A.storey;
  const utilF = S.utilF, ba = A.ba, bb = A.bb, mech = S.mech;
  utilF.fill(0);
  let fatigued = false;
  const rate = T.fatigueRate * dtEval / (crit - 1);
  for (let t = 0; t < nAct; t++) {
    const k = act[t];
    const Ae = area[k] * health[k] * (strength[k] > 1e-9 ? strength[k] : 1e-9);
    const N = nAx[k];
    let r = N < 0 ? -N / (Ae * limC[k]) : N / (Ae * limT[k]);
    let mode = N < 0 ? STRUCT_MODE.COMPRESSION : STRUCT_MODE.TENSION;
    const rs = shr[k] / (Ae * limS[k]);
    // ścinanie wiązania bloku-mechanizmu (shearMech — lokalny z wyznacznika albo tryb miękki) to przegub, który się
    // zawala, nie ścinanie materiału: tryb MECH (statystyki odróżniają artefakt regulatora od ścinania)
    if (rs > r) { r = rs; mode = mech[ba[k]] || mech[bb[k]] ? STRUCT_MODE.MECH : STRUCT_MODE.SHEAR; }
    if (storey[k] >= 0 && secR[k] > r) { r = secR[k]; mode = STRUCT_MODE.SECTION; }
    ratio[k] = r;
    if (r > utilF[ba[k]]) utilF[ba[k]] = r;
    if (r > utilF[bb[k]]) utilF[bb[k]] = r;
    if (r > crit) { _queueBreak(S, k, mode); continue; }
    if (strength[k] <= T.strengthMin) { _queueBreak(S, k, STRUCT_MODE.WAVE); continue; }
    if (r > 1) {
      fatigued = true;
      health[k] -= rate * (r - 1);
      if (health[k] < T.hMin) { health[k] = T.hMin; _queueBreak(S, k, STRUCT_MODE.FATIGUE); }
    }
  }
  S.fatigued = fatigued;
  // podpory o skończonej nośności (SUPPORT × krzywa utrzymania: supportHoldFloor + (1 − floor)·hold); reakcje
  // wszystkich kotwic jednym przejściem po wiązaniach aktywnych (było: przejście na każdą podporę — 28 × nAct na dysku)
  const holdMul = T.supportHoldFloor + (1 - T.supportHoldFloor) * S.hold;
  if (A.nSupport) _anchorReactions(S);
  for (let i = 0; A.nSupport && i < A.n; i++) {
    if (!S.anchorOn[i] || A.anchor[i] !== STRUCT_ANCHOR.SUPPORT || S.dead[i]) continue;
    const rx = S.Rx[i], ry = S.Ry[i], rz = S.Rz[i];
    const R = Math.sqrt(rx * rx + ry * ry + rz * rz), cap = A.anchorCap[i] * holdMul;
    if (R > cap) {
      S.anchorOn[i] = 0; S.topoDirty = true; S.dirty = true;
      const o = _evSlot(S);
      if (o >= 0) { const ev = S.ev; ev[o] = STRUCT_EV.SUPPORT_FAIL; ev[o + 2] = i; ev[o + 4] = A.x[i]; ev[o + 5] = A.y[i]; ev[o + 6] = A.z[i]; ev[o + 13] = R; ev[o + 14] = cap; }
    }
  }
  const u = S.util, inv = 255 / crit;
  for (let i = 0; i < A.n; i++) { const v = utilF[i] * inv; u[i] = v >= 255 ? 255 : v | 0; }
  // obciążenia chwilowe zużyte
  S.lx.fill(0); S.ly.fill(0); S.lz.fill(0); S.jx.fill(0); S.jy.fill(0); S.jz.fill(0); S.jFirst = -1; S.jLast = -1;
  S.stats.evals++;
}

/**
 * Krok egzemplarza (dt — krok fizyki, tick — całkowity licznik kroków gry). Kolejność: front zawalenia → zerwania
 * z kolejki (budżet) → wyspy → przebieg CG (faza (id + tick) mod okres, tylko gdy coś się zmieniło albo poprzedni
 * przebieg nie zbiegł) → ocena (gdy reszta ≤ solveTol) → zerwania z oceny → zdarzenia kroku w S.ev[0..S.evCount).
 * Zwraca liczbę zdarzeń. Bez alokacji.
 */
export function stepStructure(S, dt, tick) {
  const A = S.arch, T = A.tune;
  S.evCount = 0; S.evDropped = 0; S.brkRec = 0; S.brkAggN = 0; S.brkAggX = 0; S.brkAggY = 0; S.brkAggZ = 0;
  S.breaksThisStep = 0; S.cutsThisStep = 0; S.breakBudget = per120(T.breaksPer120, dt);
  S.time += dt; S.tick = tick; S.dt = dt;
  if (S.front.active) _stepFrontCoupled(S, dt);
  _drainQueue(S);
  if (S.topoDirty) { _islands(S, true); _setupActive(S); S.dirty = true; }
  const period = ticksAt120(T.solveEvery120, dt);
  const phase = ((S.id + tick) % period) === 0, fast = S.pending > 0 && S.pending < T.fastPending;
  if ((S.dirty || S.pending) && (phase || fast)) {
    _assemble(S);
    const err = _cgPass(S, S.mode, S.act, S.nAct, T.cgIters, T.stopTol);
    S.lastErr = err; S.stats.passes++;
    if (err <= T.solveTol) {
      S.stats.lastEvalErr = err;
      if (err > S.stats.maxEvalErr) S.stats.maxEvalErr = err;
      S.pending = 0;
      _evaluate(S, S.time - S.lastEval);
      S.lastEval = S.time;
      S.dirty = S.fatigued || S.topoDirty || S.qCount > 0;
      _drainQueue(S);
      if (S.topoDirty) { _islands(S, true); _setupActive(S); S.dirty = true; }
    } else {
      S.pending++;
      if (S.pending > S.stats.maxPending) S.stats.maxPending = S.pending;
      if (S.pending >= T.softAfter) _markSoft(S, S.mode);
      if (S.pending >= T.mechAfter && _mechanismCollapse(S)) {
        S.pending = 0;
        _drainQueue(S);
        if (S.topoDirty) { _islands(S, true); _setupActive(S); S.dirty = true; }
      }
      // przekroje nie zależą od przemieszczeń: wywracanie (ostatnia linia podpór) łamie od razu, zanim CG
      // domknie mechanizm globalny (przegub na linii podpór — bez tego dziesiątki przebiegów do zbieżności)
      if (A.nStoreys && _sectionBreaks(S)) {
        _drainQueue(S);
        if (S.topoDirty) { _islands(S, true); _setupActive(S); S.dirty = true; S.pending = 0; }
      }
    }
  }
  if (!S.dirty && !S.pending) S.lastEval = S.time;
  if (S.brkAggN > 0) {
    const o = _evSlot(S);
    if (o >= 0) { const ev = S.ev; ev[o] = STRUCT_EV.BREAKS; ev[o + 3] = S.brkAggN; ev[o + 4] = S.brkAggX / S.brkAggN; ev[o + 5] = S.brkAggY / S.brkAggN; ev[o + 6] = S.brkAggZ / S.brkAggN; }
  }
  if (S.evDropped > 0) {
    const o = S.evCount * STRUCT_EV_STRIDE; S.evCount++;
    const ev = S.ev;
    for (let j = 0; j < STRUCT_EV_STRIDE; j++) ev[o + j] = 0;
    ev[o] = STRUCT_EV.OVERFLOW; ev[o + 1] = S.time; ev[o + 3] = S.evDropped;
  }
  return S.evCount;
}

// ── API obrażeń i obciążeń (współrzędne lokalne archetypu) ──────────────────────────────────────────────────────
function _touch(S) { S.dirty = true; }

/** Krater (martwe komórki pasa zmniejszają pole wiązań): zdrowie wiązań o środku w kuli r spada o amount·(1 − d/r). */
export function structureDamageSphere(S, x, y, z, r, amount) {
  const A = S.arch; let hit = 0;
  for (let k = 0; k < A.e; k++) {
    if (!S.alive[k]) continue;
    const dx = A.cx[k] - x, dy = A.cy[k] - y, dz = A.cz[k] - z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) continue;
    const h = S.health[k] - amount * (1 - Math.sqrt(d2) / r);
    S.health[k] = h > A.tune.hMin ? h : A.tune.hMin;
    if (h <= A.tune.hMin) _queueBreak(S, k, STRUCT_MODE.CRATER);
    hit++;
  }
  if (hit) _touch(S);
  return hit;
}

/** Zdrowie jednego wiązania (narzędzia, testy, mapa krateru gospodarza). */
export function structureDamageBond(S, k, amount) {
  if (!S.alive[k]) return;
  const h = S.health[k] - amount;
  S.health[k] = h > S.arch.tune.hMin ? h : S.arch.tune.hMin;
  if (h <= S.arch.tune.hMin) _queueBreak(S, k, STRUCT_MODE.CRATER);
  _touch(S);
}

/** Obciążenie chwilowe bloku [siła] — zużyte przy najbliższej ocenie (np. ciężar leżącego ciała). */
export function structureAddLoad(S, b, fx, fy, fz) {
  S.lx[b] += fx; S.ly[b] += fy; S.lz[b] += fz; _touch(S);
}

/** Impuls na blok [masa·j/s] (styk krok po kroku: F·dt, trafienie: J) — przy ocenie siła średnia okna
 *  (≥ pulseT), więc wynik nie zależy od kroku fizyki ani fazy przebiegu. */
export function structureAddImpulse(S, b, jx, jy, jz) {
  S.jx[b] += jx; S.jy[b] += jy; S.jz[b] += jz; _markImpulse(S); _touch(S);
}

// Okno impulsów (_assemble): czas pierwszego i ostatniego impulsu od poprzedniej oceny.
function _markImpulse(S) {
  if (S.jFirst < 0) S.jFirst = S.time;
  S.jLast = S.time;
}

/** Najbliższy żywy blok (opcjonalnie tylko w części zakotwiczonej / w wyspie `island`). */
export function structureNearestBlock(S, x, y, z, island = -3) {
  const A = S.arch; let best = -1, bd = Infinity;
  for (let i = 0; i < A.n; i++) {
    if (S.dead[i] || (A.anchor[i] && S.anchorOn[i])) continue;
    if (island !== -3 && S.island[i] !== island) continue;
    const dx = A.x[i] - x, dy = A.y[i] - y, dz = A.z[i] - z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bd) { bd = d2; best = i; }
  }
  return best;
}

/**
 * FALA W KONSTRUKCJI (§ 4.1 p. 2; F0 — broń zmienia pęd i wytrzymałość, nie kasuje węzłów): trafienie w (x, y, z)
 * impulsem J [masa·j/s] w kierunku (dx, dy, dz) daje (1) siłę J / pulseT na bloki w promieniu `radius` (wagi
 * 1 − d/r; bez bloków w promieniu — najbliższy), zużytą przy najbliższej ocenie, (2) spadek wytrzymałości wiązań
 * NAD trafieniem w promieniu poziomym waveRadius: waveWeaken · (J / waveJ) · (1 − d⊥/R)² · exp(−h / waveDecayZ)
 * (h — wysokość nad trafieniem wzdłuż −ĝ; poniżej trafienia tylko w kuli `radius`). Deterministycznie, bez kamery.
 * Zwraca liczbę osłabionych wiązań.
 */
export function structureHit(S, x, y, z, J, dx = 0, dy = 0, dz = 0, opts = null) {
  const A = S.arch, T = A.tune;
  const radius = opts?.radius ?? 120, R = opts?.waveRadius ?? T.waveRadius, decay = opts?.decayZ ?? T.waveDecayZ;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dl > 0 && J > 0) {
    let wsum = 0;
    for (let i = 0; i < A.n; i++) {
      if (S.dead[i] || S.island[i] !== -1 || S.anchorOn[i]) continue;
      const ex = A.x[i] - x, ey = A.y[i] - y, ez = A.z[i] - z, d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d < radius) wsum += 1 - d / radius;
    }
    if (wsum > 0) {
      for (let i = 0; i < A.n; i++) {
        if (S.dead[i] || S.island[i] !== -1 || S.anchorOn[i]) continue;
        const ex = A.x[i] - x, ey = A.y[i] - y, ez = A.z[i] - z, d = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (d >= radius) continue;
        const w = (1 - d / radius) / wsum * J / dl;
        S.jx[i] += w * dx; S.jy[i] += w * dy; S.jz[i] += w * dz;
      }
    } else {
      const b = structureNearestBlock(S, x, y, z, -1);
      if (b >= 0) { S.jx[b] += J * dx / dl; S.jy[b] += J * dy / dl; S.jz[b] += J * dz / dl; }
    }
    _markImpulse(S);
  }
  const amp = T.waveWeaken * J / T.waveJ;
  let cnt = 0;
  if (amp > 0) {
    const ux = -A.gx, uy = -A.gy, uz = -A.gz;
    for (let k = 0; k < A.e; k++) {
      if (!S.alive[k]) continue;
      const ex = A.cx[k] - x, ey = A.cy[k] - y, ez = A.cz[k] - z;
      const h = ex * ux + ey * uy + ez * uz;
      const px = ex - h * ux, py = ey - h * uy, pz = ez - h * uz, dp = Math.sqrt(px * px + py * py + pz * pz);
      if (dp >= R) continue;
      if (h < 0 && h * h + dp * dp >= radius * radius) continue;
      const f = 1 - dp / R;
      const loss = amp * f * f * (h > 0 ? Math.exp(-h / decay) : 1) * (A.cls[k] === STRUCT_BOND.VERT ? T.waveVert : 1);
      if (!(loss > 1e-6)) continue;
      const s = S.strength[k] - loss;
      S.strength[k] = s > 0 ? s : 0;
      cnt++;
    }
  }
  _touch(S);
  return cnt;
}

/** Blok zniszczony (front, otwór w płycie, przekrój zjedzony): jego wiązania znikają z grafu (S.cutsThisStep). */
export function structureDestroyBlock(S, b, crushed = false) {
  if (S.dead[b]) return;
  S.dead[b] = crushed ? 2 : 1;
  const A = S.arch;
  // to nie zerwania (blok znika z wiązaniami) — poza budżetem breaksPer120, osobny licznik: front ma własny budżet
  // (≤ frontLevelsPer120 poziomów na 1/120 s), otwory płyty — gospodarz
  let c = 0;
  for (let k = 0; k < A.e; k++) if (S.alive[k] && (A.ba[k] === b || A.bb[k] === b)) { S.alive[k] = 0; S.brokeAt[k] = S.time; c++; }
  S.cutsThisStep += c; S.stats.crushCuts += c; S.topoVer++;
  S.topoDirty = true; S.dirty = true;
}

/** Kotwica puszcza (SECTION — zniszczona budowla nośna, np. pomost; D13). */
export function structureReleaseAnchor(S, b) {
  if (!S.anchorOn[b]) return;
  S.anchorOn[b] = 0; S.topoDirty = true; S.dirty = true;
}

/** Utrzymanie podpór SUPPORT (D8: habitat po HP 0 traci je w ~2–3 s), 0..1 — nośność × (supportHoldFloor +
 *  (1 − supportHoldFloor)·h). Pole płyty dostaje utrzymanie osobno (P.hold, krzywa plateSigma). */
export function structureSetHold(S, h) {
  if (h === S.hold) return;
  S.hold = h; S.dirty = true;
}

/** Egzemplarz wraca do stanu nienaruszonego (ruina → odbudowa, narzędzia, testy). Bez alokacji. */
export function structureReset(S) {
  const A = S.arch;
  S.time = 0; S.lastEval = 0; S.tick = 0; S.dt = 0; S.hold = 1; S.jFirst = -1; S.jLast = -1;
  S.dead.fill(0); S.island.fill(-1); S.mode.fill(0); S.mech.fill(0); S.soft.fill(0);
  S.lx.fill(0); S.ly.fill(0); S.lz.fill(0); S.jx.fill(0); S.jy.fill(0); S.jz.fill(0); S.util.fill(0);
  for (let i = 0; i < A.n; i++) S.anchorOn[i] = A.anchor[i] ? 1 : 0;
  S.alive.fill(1); S.health.fill(1); S.strength.fill(1); S.ratio.fill(0); S.nAx.fill(0); S.shr.fill(0);
  S.brokeAt.fill(-1e9); S.queued.fill(0); S.qHead = 0; S.qCount = 0;
  S.nIsl = 0; S.islClaim.fill(-1); S.islParent.fill(-1); S.islNew.fill(0); S.islRetired.fill(0); S.nNew = 0;
  S.ux.fill(0); S.uy.fill(0); S.uz.fill(0);
  if (A.u0x) { S.ux.set(A.u0x); S.uy.set(A.u0y); S.uz.set(A.u0z); }
  S.dirty = true; S.topoDirty = true; S.pending = 0; S.fatigued = false; S.evCount = 0; S.islPend = -1; S.topoVer++;
  S.front.active = 0; S.front.arrested = 0; S.front.grounded = 0; S.front.nEv = 0;
}

/** Liczniki egzemplarza (narzędzia, testy). */
export function structureCounts(S) {
  const A = S.arch;
  let alive = 0, dead = 0, free = 0;
  for (let i = 0; i < A.n; i++) { if (A.anchor[i]) continue; if (S.dead[i]) dead++; else if (S.island[i] >= 0) free++; else alive++; }
  let bonds = 0; for (let k = 0; k < A.e; k++) bonds += S.alive[k];
  return { blocks: A.n, anchored: alive, dead, free, bondsAlive: bonds, bonds: A.e, islands: S.nIsl };
}

// ── WYSPA SWOBODNA przy styku: odciążenie bezwładnościowe ───────────────────────────────────────────────────────
/**
 * Naprężenia wolnej wyspy `id` od obciążeń chwilowych jej bloków (styk — structureAddLoad / structureAddImpulse), z
 * odciążeniem bezwładnościowym: f_i = F_i − m_i·(a + α × r_i) (a = ΣF / M, α = I⁻¹·τ; jednorodna grawitacja znika —
 * swobodny spadek nie naręża), jeden blok (najbliższy środkowi masy) przypięty — K wolnej wyspy jest osobliwa.
 * Tensor I bez członu własnego bloków (inaczej Σ r × f ≠ 0 i obciążenie pobudza obrót wokół przypiętego bloku —
 * mod prawie zerowy przy shearK 1e-6); człon własny tylko dla wyspy osobliwej (1–2 bloki, linia).
 * Przebiegi po cgIters do maxIters na wywołanie (tryb miękki jak w części zakotwiczonej). ZERWANIA TYLKO PRZY
 * RESZCIE ≤ solveTol: niezbieżne rozwiązanie zwraca −1 (nic nie pęka, stats.islandRefused) i ZOSTAJE ZAPAMIĘTANE —
 * kolejne wywołanie dla tej samej wyspy przy niezmienionej topologii kontynuuje CG od zapamiętanych przemieszczeń,
 * a nowe obciążenia dodaje do starych (superpozycja — oba zrównoważone bezwładnością). Smukła wyspa z zimnego startu
 * (wieżowiec po podcięciu, 144 bloki) potrzebuje ~1,5–5 tys. iteracji, więc gospodarz woła co krok aż do wyniku
 * ≥ 0 (pęknięcia przychodzą ułamek sekundy po styku). Wiązania ponad limitem krytycznym pękają (budżet kroku),
 * wyspa dzieli się na kawałki (ISLAND z rodzicem = id; zdarzenia dopisane do bufora bieżącego kroku). Zwraca liczbę
 * zerwań (≥ 0) albo −1. Bez alokacji.
 */
export function structureSolveIsland(S, id, maxIters = S.arch.tune.islandIters) {
  const A = S.arch, n = A.n, e = A.e, T = A.tune, mode = S.mode2, isl = S.island, dead = S.dead, soft = S.soft;
  const resume = S.islPend === id && S.islPendVer === S.topoVer;
  const ifx = S.ifx, ify = S.ify, ifz = S.ifz, iux = S.iux, iuy = S.iuy, iuz = S.iuz;
  // impulsy styku → siła w oknie impulsów (jak _assemble: pojedyncze uderzenie J / pulseT, styk ciągły F·dt → F)
  const span = S.jFirst >= 0 ? S.jLast - S.jFirst + S.dt : 0, ip = 1 / (span > T.pulseT ? span : T.pulseT);
  let M = 0, cx = 0, cy = 0, cz = 0, Fx = 0, Fy = 0, Fz = 0;
  for (let i = 0; i < n; i++) {
    if (dead[i] || isl[i] !== id) { mode[i] = 0; continue; }
    mode[i] = 1;
    if (!resume) soft[i] = 0;
    const m = A.mass[i]; M += m; cx += m * A.x[i]; cy += m * A.y[i]; cz += m * A.z[i];
    S.lx[i] += S.jx[i] * ip; S.ly[i] += S.jy[i] * ip; S.lz[i] += S.jz[i] * ip; S.jx[i] = 0; S.jy[i] = 0; S.jz[i] = 0;
    Fx += S.lx[i]; Fy += S.ly[i]; Fz += S.lz[i];
  }
  if (!(M > 0)) return 0;
  cx /= M; cy /= M; cz /= M;
  // moment sił i tensor bezwładności względem środka masy
  let tx = 0, ty = 0, tz = 0, Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0, pin = -1, pd = Infinity;
  for (let i = 0; i < n; i++) {
    if (mode[i] !== 1) continue;
    const m = A.mass[i], rx = A.x[i] - cx, ry = A.y[i] - cy, rz = A.z[i] - cz;
    tx += ry * S.lz[i] - rz * S.ly[i]; ty += rz * S.lx[i] - rx * S.lz[i]; tz += rx * S.ly[i] - ry * S.lx[i];
    Ixx += m * (ry * ry + rz * rz); Iyy += m * (rx * rx + rz * rz); Izz += m * (rx * rx + ry * ry);
    Ixy -= m * rx * ry; Ixz -= m * rx * rz; Iyz -= m * ry * rz;
    const d2 = rx * rx + ry * ry + rz * rz;
    if (d2 < pd) { pd = d2; pin = i; }
  }
  // α = I⁻¹ τ (wyspa osobliwa — linia, 1–2 bloki: + człon własny bloku 40×40)
  let det = 0, c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0;
  for (let pass = 0; pass < 2; pass++) {
    c00 = Iyy * Izz - Iyz * Iyz; c01 = Ixz * Iyz - Ixy * Izz; c02 = Ixy * Iyz - Ixz * Iyy;
    c11 = Ixx * Izz - Ixz * Ixz; c12 = Ixy * Ixz - Ixx * Iyz; c22 = Ixx * Iyy - Ixy * Ixy;
    det = Ixx * c00 + Ixy * c01 + Ixz * c02;
    const tr = Ixx + Iyy + Izz;
    if (det > 1e-9 * tr * tr * tr) break;
    const own = M * 40 * 40 / 6; Ixx += own; Iyy += own; Izz += own;
  }
  const id_ = det !== 0 ? 1 / det : 0;
  const alx = (c00 * tx + c01 * ty + c02 * tz) * id_, aly = (c01 * tx + c11 * ty + c12 * tz) * id_, alz = (c02 * tx + c12 * ty + c22 * tz) * id_;
  const ax = Fx / M, ay = Fy / M, az = Fz / M;
  let f2 = 0, l2 = 0;
  if (pin >= 0) mode[pin] = 2;   // ta sama wyspa i topologia → ten sam blok (najbliższy środkowi masy)
  for (let i = 0; i < n; i++) {
    if (mode[i] !== 1) {
      if (mode[i] === 2) { S.lx[i] = 0; S.ly[i] = 0; S.lz[i] = 0; ifx[i] = 0; ify[i] = 0; ifz[i] = 0; iux[i] = 0; iuy[i] = 0; iuz[i] = 0; }
      continue;
    }
    l2 += S.lx[i] * S.lx[i] + S.ly[i] * S.ly[i] + S.lz[i] * S.lz[i];
    const m = A.mass[i], rx = A.x[i] - cx, ry = A.y[i] - cy, rz = A.z[i] - cz;
    const fx = S.lx[i] - m * (ax + aly * rz - alz * ry), fy = S.ly[i] - m * (ay + alz * rx - alx * rz), fz = S.lz[i] - m * (az + alx * ry - aly * rx);
    if (resume) { ifx[i] += fx; ify[i] += fy; ifz[i] += fz; } else { ifx[i] = fx; ify[i] = fy; ifz[i] = fz; iux[i] = 0; iuy[i] = 0; iuz[i] = 0; }
    // wektory solvera dzielone z częścią zakotwiczoną (_assemble je nadpisuje) — kopia na czas wywołania
    S.fx[i] = ifx[i]; S.fy[i] = ify[i]; S.fz[i] = ifz[i]; S.ux[i] = iux[i]; S.uy[i] = iuy[i]; S.uz[i] = iuz[i];
    f2 += ifx[i] * ifx[i] + ify[i] * ify[i] + ifz[i] * ifz[i];
    S.lx[i] = 0; S.ly[i] = 0; S.lz[i] = 0;
  }
  // lista wiązań wyspy
  let c = 0;
  for (let k = 0; k < e; k++) {
    if (!S.alive[k]) continue;
    const ma = mode[A.ba[k]], mb = mode[A.bb[k]];
    if (!ma || !mb || (ma === 2 && mb === 2)) continue;
    S.act2[c++] = k;
  }
  S.nAct2 = c;
  S.fn2 = f2;
  // obciążenie w całości zrównoważone bezwładnością (ruch sztywny — np. jednorodne przyspieszenie): bez naprężeń
  // (reszta względna z szumu zaokrągleń nie ma sensu)
  if (!(f2 > 1e-18 * l2)) {
    for (let t = 0; t < c; t++) S.ratio[S.act2[t]] = 0;
    S.lastErr = 0; S.islPend = -1;
    return 0;
  }
  let err = 1, passes = 0;
  for (let it = 0; it < maxIters && err > T.solveTol; it += T.cgIters) {
    err = _cgPass(S, mode, S.act2, S.nAct2, T.cgIters, T.stopTol);
    if (err > T.solveTol && ++passes >= T.softAfter) _markSoft(S, mode);
  }
  S.lastErr = err;
  for (let i = 0; i < n; i++) if (mode[i] === 1) { iux[i] = S.ux[i]; iuy[i] = S.uy[i]; iuz[i] = S.uz[i]; }
  if (err > T.solveTol) { S.stats.islandRefused++; S.islPend = id; S.islPendVer = S.topoVer; return -1; }
  S.islPend = -1;
  // ocena: tylko próg krytyczny (uderzenie jest chwilowe — bez zmęczenia)
  const crit = T.critMul, ba = A.ba, bb = A.bb, nx = A.nx, ny = A.ny, nz = A.nz, ka = S.ka, kS = S.kS;
  let broke = 0;
  for (let t = 0; t < S.nAct2; t++) {
    const k = S.act2[t], a = ba[k], b = bb[k];
    const ma = mode[a] === 1, mb = mode[b] === 1;
    const dx = (mb ? S.ux[b] : 0) - (ma ? S.ux[a] : 0), dy = (mb ? S.uy[b] : 0) - (ma ? S.uy[a] : 0), dz = (mb ? S.uz[b] : 0) - (ma ? S.uz[a] : 0);
    const dot = nx[k] * dx + ny[k] * dy + nz[k] * dz, N = ka[k] * dot;
    const qx = dx - dot * nx[k], qy = dy - dot * ny[k], qz = dz - dot * nz[k];
    const Sh = kS[k] * Math.sqrt(qx * qx + qy * qy + qz * qz);
    const Ae = A.area[k] * S.health[k] * (S.strength[k] > 1e-9 ? S.strength[k] : 1e-9);
    let r = N < 0 ? -N / (Ae * A.limC[k]) : N / (Ae * A.limT[k]);
    const rs = Sh / (Ae * A.limS[k]); if (rs > r) r = rs;
    S.ratio[k] = r;
    if (r > crit) { _queueBreak(S, k, STRUCT_MODE.IMPACT); broke++; }
  }
  // zerwania w budżecie kroku i podział wyspy (statystyki wysp w zdarzeniach bieżącego kroku)
  const qb = S.qCount;
  while (S.qCount > 0 && S.breaksThisStep < S.breakBudget) {
    const k = S.q[S.qHead], md = S.qMode[S.qHead];
    S.qHead = (S.qHead + 1) % e; S.qCount--; S.queued[k] = 0;
    if (S.alive[k]) _breakNow(S, k, md, false);
  }
  if (qb && S.topoDirty) { _islands(S, false); _setupActive(S); }
  return broke;
}

// ── FRONT ZAWALENIA (Bažant–Verdure) ────────────────────────────────────────────────────────────────────────────
/** Stan frontu (prealokowany; zdarzenia kroku w ev* do nEv). */
export function createCollapseFront() {
  return {
    active: 0, arrested: 0, grounded: 0, level: -1, s: 0, v: 0, m: 0, kappa: STRUCT_TUNE.kappa,
    debrisFrac: STRUCT_TUNE.debrisFrac, g: 400, crushing: 0, crushed: 0, islandId: -1, t: 0,
    levelsPer120: STRUCT_TUNE.frontLevelsPer120, lag: 0,   // budżet poziomów; czas niedoliczony przy wyczerpanym budżecie
    nEv: 0, evLevel: new Int32Array(8), evV: new Float64Array(8), evDebris: new Float64Array(8), evMass: new Float64Array(8)
  };
}

/** Front startuje: blok o masie m, spód na wysokości s (wzdłuż −ĝ), prędkość v (w dół), następny poziom do zgniotu. */
export function startCollapseFront(F, m, s, v, nextLevel, g, kappa = STRUCT_TUNE.kappa, debrisFrac = STRUCT_TUNE.debrisFrac,
  levelsPer120 = STRUCT_TUNE.frontLevelsPer120) {
  F.active = 1; F.arrested = 0; F.grounded = 0; F.m = m; F.s = s; F.v = v; F.level = nextLevel; F.g = g;
  F.kappa = kappa; F.debrisFrac = debrisFrac; F.crushing = 0; F.crushed = 0; F.t = 0; F.nEv = 0;
  F.levelsPer120 = levelsPer120; F.lag = 0;
}

/**
 * Krok frontu (czysty, bez silnika): d(mv)/dt = m·g − R, R = κ·levCap[L] w trakcie zgniotu kondygnacji L (od
 * levZ[L] do levZ[L−1], kondygnacja 0 do groundZ). Swobodny spadek do podłogi poziomu L, zderzenie niesprężyste
 * z jej masą levMass[L] (pęd dzielony z całą masą poziomu, debrisFrac z niej odlatuje w gruz), potem zgniot
 * z oporem. Ruch w fazie ze stałym przyspieszeniem liczony dokładnie (czas dojścia do granicy z równania
 * kwadratowego) — 60 i 120 Hz dają te same czasy; ≤ F.levelsPer120 poziomów na 1/120 s. Wyczerpany budżet
 * poziomów: front stoi na podłodze do końca kroku, a niedoliczony czas (F.lag) dochodzi w następnym kroku — czas
 * frontu (F.t) nie gubi się względem zegara gry.
 * Zwraca liczbę zgniecionych poziomów; zdarzenia kroku w F.ev* (nEv).
 */
export function stepCollapseFront(F, levZ, levMass, levCap, groundZ, dt) {
  F.nEv = 0;
  if (!F.active) return 0;
  const maxLv = per120(F.levelsPer120, dt);
  let rem = dt + F.lag, crushedNow = 0;
  F.lag = 0;
  while (rem > 0 && F.active) {
    const L = F.level;
    const floorZ = L >= 0 ? levZ[L] : groundZ;
    if (!F.crushing) {
      // swobodny spadek do podłogi poziomu L (albo ziemi)
      const d = F.s - floorZ;
      if (d > 0) {
        const t = _timeTo(F.v, F.g, d);
        if (t > rem) { F.s -= F.v * rem + 0.5 * F.g * rem * rem; F.v += F.g * rem; F.t += rem; return crushedNow; }
        F.s = floorZ; F.v += F.g * t; rem -= t; F.t += t;
      }
      if (L < 0) {
        F.active = 0; F.grounded = 1;
        if (F.nEv < 8) { F.evLevel[F.nEv] = -1; F.evV[F.nEv] = F.v; F.evDebris[F.nEv] = 0; F.evMass[F.nEv] = F.m; F.nEv++; }
        return crushedNow;
      }
      if (crushedNow >= maxLv) { F.lag = rem; return crushedNow; }
      // zderzenie z podłogą poziomu L
      const mL = levMass[L];
      F.v = F.m * F.v / (F.m + mL);
      F.m += mL * (1 - F.debrisFrac);
      F.crushing = 1;
      crushedNow++; F.crushed++;
      if (F.nEv < 8) { F.evLevel[F.nEv] = L; F.evV[F.nEv] = F.v; F.evDebris[F.nEv] = mL * F.debrisFrac; F.evMass[F.nEv] = F.m; F.nEv++; }
    }
    // zgniot kondygnacji L: od levZ[L] do levZ[L−1] (ziemia dla 0)
    const bot = L > 0 ? levZ[L - 1] : groundZ;
    const a = F.g - F.kappa * levCap[L] / F.m;
    const d = F.s - bot;
    if (d > 0) {
      const t = _timeTo(F.v, a, d);
      if (!(t <= rem)) {
        // nie dochodzi w tym kroku: albo staje (a < 0 i v → 0), albo jedzie dalej
        const tStop = a < 0 ? F.v / -a : Infinity;
        if (tStop <= rem) {
          F.s -= F.v * tStop + 0.5 * a * tStop * tStop; F.v = 0; F.t += tStop;
          F.active = 0; F.arrested = 1;
          if (F.nEv < 8) { F.evLevel[F.nEv] = -2 - L; F.evV[F.nEv] = 0; F.evDebris[F.nEv] = 0; F.evMass[F.nEv] = F.m; F.nEv++; }
          return crushedNow;
        }
        F.s -= F.v * rem + 0.5 * a * rem * rem; F.v += a * rem; F.t += rem;
        return crushedNow;
      }
      F.s = bot; F.v += a * t; rem -= t; F.t += t;
    }
    F.crushing = 0;
    F.level = L - 1;
  }
  return crushedNow;
}

// Czas przejścia drogi d > 0 przy prędkości v ≥ 0 i stałym przyspieszeniu a (Infinity — nie dojdzie).
function _timeTo(v, a, d) {
  if (Math.abs(a) < 1e-12) return v > 0 ? d / v : Infinity;
  const disc = v * v + 2 * a * d;
  if (disc < 0) return Infinity;
  const t = (-v + Math.sqrt(disc)) / a;
  return t >= 0 ? t : Infinity;
}

/**
 * Front na egzemplarzu: wyspa `islandId` (spadek pionowy) zgniata budowlę pod sobą. Masa = masa wyspy, spód =
 * najniższy poziom wyspy, następny poziom = najwyższy poziom poniżej z żywymi blokami części zakotwiczonej.
 * Nośność kondygnacji = u0 · Σ limC·critMul·A·zdrowie·wytrzymałość·|n·ĝ| żywych SŁUPÓW kondygnacji (klasa VERT,
 * rdzeń też; stężenia przy zgniocie wyboczają się pierwsze — w oporze po wyboczeniu ich nie liczymy), stan z chwili
 * startu. Czynnik u0 zdejmuje zapas kalibracji (limity = obciążenie / u0 — margines gry na ostrzał): nośność ≈
 * critMul · ciężar nad kondygnacją, więc R = κ·1,25·W. κ 0,1–0,3 przy gruzie 20–30% → front dochodzi do ziemi
 * (ρ = R / (m·g) < 1 mimo zderzeń niesprężystych), κ = 1 → staje po jednym piętrze (R ≈ 1,25 W > ciężar bloku). Zgnieciony poziom: jego bloki giną (dead = 2), FRONT z masą gruzu.
 * opts: { kappa, debrisFrac }.
 */
export function structureStartFront(S, islandId, v0 = 0, opts = null) {
  const A = S.arch, T = A.tune;
  if (!A.nLevels) return false;
  let lmin = 1 << 30, M = 0;
  for (let i = 0; i < A.n; i++) {
    if (S.dead[i] || S.island[i] !== islandId) continue;
    M += A.mass[i];
    if (A.level[i] < lmin) lmin = A.level[i];
  }
  if (!(M > 0) || lmin <= 0) return false;
  _frontTables(S);
  let next = lmin - 1;
  while (next >= 0 && !(S.levMass[next] > 0)) next--;
  const F = S.front;
  startCollapseFront(F, M, A.levelZ[lmin], v0, next, A.g, opts?.kappa ?? T.kappa, opts?.debrisFrac ?? T.debrisFrac, T.frontLevelsPer120);
  F.islandId = islandId;
  return true;
}

function _frontTables(S) {
  const A = S.arch, T = A.tune, NL = A.nLevels;
  S.levMass.fill(0); S.levCap.fill(0);
  for (let i = 0; i < A.n; i++) {
    if (S.dead[i] || S.island[i] !== -1) continue;
    const l = A.level[i]; if (l < 0 || l >= NL) continue;
    S.levMass[l] += A.mass[i];
  }
  for (let st = 0; st < A.nStoreys && st < NL; st++) {
    let cap = 0;
    for (let j = A.storeyStart[st]; j < A.storeyStart[st + 1]; j++) {
      const k = A.storeyBonds[j];
      if (!S.alive[k] || A.cls[k] !== STRUCT_BOND.VERT) continue;
      cap += A.limC[k] * T.critMul * A.area[k] * S.health[k] * S.strength[k] * Math.abs(A.ng[k]);
    }
    S.levCap[st] = cap * T.u0;
  }
}

function _stepFrontCoupled(S, dt) {
  const A = S.arch, F = S.front;
  stepCollapseFront(F, A.levelZ, S.levMass, S.levCap, A.groundZ, dt);
  for (let j = 0; j < F.nEv; j++) {
    const L = F.evLevel[j];
    const o = _evSlot(S);
    if (L >= 0) {
      for (let i = 0; i < A.n; i++) if (!S.dead[i] && S.island[i] === -1 && A.level[i] === L) structureDestroyBlock(S, i, true);
      if (o >= 0) {
        const ev = S.ev;
        ev[o] = STRUCT_EV.FRONT; ev[o + 2] = L; ev[o + 4] = A.centerX; ev[o + 5] = A.centerY; ev[o + 6] = A.levelZ[L];
        ev[o + 7] = A.gx; ev[o + 8] = A.gy; ev[o + 9] = A.gz; ev[o + 13] = F.evV[j]; ev[o + 14] = F.evDebris[j]; ev[o + 15] = F.evMass[j];
      }
    } else if (o >= 0) {
      const ev = S.ev;
      ev[o] = L === -1 ? STRUCT_EV.FRONT_GROUND : STRUCT_EV.FRONT_STOP; ev[o + 2] = L === -1 ? -1 : -2 - L;
      ev[o + 4] = A.centerX; ev[o + 5] = A.centerY; ev[o + 6] = F.s; ev[o + 13] = F.evV[j]; ev[o + 15] = F.evMass[j];
    }
  }
}

// ── ARCHETYPY ───────────────────────────────────────────────────────────────────────────────────────────────────
const NODE_VOL = 45 * 45 * 45;   // masa bloku w „węzłach komórki 45” (jak silnik belek)

/**
 * Kolumna (test, narzędzia): kwadrat w×w, `levels` poziomów co h, 4 bloki na poziom, kotwice GROUND u podstawy.
 * Słupy, obwód, stężenia X w ścianach i krzyż w stropie. Wiązania pionowe i ukośne w kondygnacjach (przekroje).
 */
export function buildColumnArchetype({ levels = 10, h = 100, w = 80, mass = 10, area = 400, seed = 1, tune = null, split = true } = {}) {
  const B = createArchetypeBuilder(4 * (levels + 1), 20 * levels + 8);
  const P = [[w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2], [-w / 2, -w / 2]];
  const id = (l, s) => 4 + l * 4 + s;
  for (let s = 0; s < 4; s++) addBlock(B, P[s][0], P[s][1], 0, 0, -1, s, STRUCT_ANCHOR.GROUND);
  for (let l = 0; l < levels; l++) for (let s = 0; s < 4; s++) addBlock(B, P[s][0], P[s][1], (l + 1) * h, mass, l, s);
  const low = (l, s) => (l === 0 ? s : id(l - 1, s));
  for (let l = 0; l < levels; l++) {
    for (let s = 0; s < 4; s++) {
      addBond(B, low(l, s), id(l, s), area, STRUCT_BOND.VERT, l);
      addBond(B, low(l, s), id(l, (s + 1) % 4), area * 0.3, STRUCT_BOND.DIAG, l);
      addBond(B, low(l, (s + 1) % 4), id(l, s), area * 0.3, STRUCT_BOND.DIAG, l);
      addBond(B, id(l, s), id(l, (s + 1) % 4), area * 0.5, STRUCT_BOND.RING);
    }
    addBond(B, id(l, 0), id(l, 2), area * 0.3, STRUCT_BOND.SPOKE);
    addBond(B, id(l, 1), id(l, 3), area * 0.3, STRUCT_BOND.SPOKE);
  }
  return finishArchetype(B, { name: 'kolumna', seed, g: 400, groundZ: 0, split, tune });
}

/**
 * Wspornik (test analityki): skrzynka kratowa wzdłuż +x, `segments` przęseł po `len`, wysokość h, szerokość b,
 * 4 bloki na przekrój, kotwice GROUND w x = 0. Pasy, przekroje z krzyżem, stężenia X we wszystkich ścianach.
 * Moment u nasady = Σ m·g·x — rośnie z długością (∝ L²).
 */
export function buildCantileverArchetype({ segments = 8, len = 100, h = 80, b = 80, mass = 10, area = 400, seed = 1, tune = null } = {}) {
  const B = createArchetypeBuilder(4 * (segments + 1), 20 * segments + 8);
  const P = [[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, h / 2], [-b / 2, h / 2]];   // (y, z)
  const id = (s, c) => s * 4 + c;
  for (let s = 0; s <= segments; s++) for (let c = 0; c < 4; c++) addBlock(B, s * len, P[c][0], P[c][1], s ? mass : 0, s ? s - 1 : -1, c, s ? 0 : STRUCT_ANCHOR.GROUND);
  for (let s = 1; s <= segments; s++) {
    for (let c = 0; c < 4; c++) {
      addBond(B, id(s - 1, c), id(s, c), area, STRUCT_BOND.CHORD);
      addBond(B, id(s - 1, c), id(s, (c + 1) % 4), area * 0.3, STRUCT_BOND.WEB);
      addBond(B, id(s - 1, (c + 1) % 4), id(s, c), area * 0.3, STRUCT_BOND.WEB);
      addBond(B, id(s, c), id(s, (c + 1) % 4), area * 0.5, STRUCT_BOND.RING);
    }
    addBond(B, id(s, 0), id(s, 2), area * 0.3, STRUCT_BOND.SPOKE);
    addBond(B, id(s, 1), id(s, 3), area * 0.3, STRUCT_BOND.SPOKE);
  }
  return finishArchetype(B, { name: 'wspornik', seed, g: 400, tune });
}

// g archetypu (D12 / D10c): przy g ≠ 400 impuls odniesienia fali skaluje się z ciężarem (waveJ × g/400) — salwa
// J × g/400 osłabia wtedy wiązania tak samo (structureHit: waveWeaken · J / waveJ), a siła J / pulseT rośnie jak m·g
// (synteza dema D20 § 1). Kalibracja i tak skaluje limity z ciężarem. Przy g 400 strojenie bez zmian (bit w bit).
function _tuneForG(tune, g) {
  if (!(g > 0) || !Number.isFinite(g)) throw new Error('structureGraph: g archetypu musi być > 0');
  if (g === 400) return tune;
  return { ...(tune || {}), waveJ: (tune?.waveJ ?? STRUCT_TUNE.waveJ) * g / 400 };
}

// Prostopadłościan osiowy z zakresu nominalnego [x0, x1] × [y0, y1] × [z0, z1] minus luz STRUCT_BOX_GAP na każdej
// półosi; udział w masie bloku ∝ objętość. Pomija (−1), gdy któryś wymiar po luzie < BOX_MIN.
function _boxAA(B, b, x0, x1, y0, y1, z0, z1) {
  const G = STRUCT_BOX_GAP;
  const hx = (x1 - x0) * 0.5 - G, hy = (y1 - y0) * 0.5 - G, hz = (z1 - z0) * 0.5 - G;
  if (!(2 * hx >= BOX_MIN && 2 * hy >= BOX_MIN && 2 * hz >= BOX_MIN)) return -1;
  return addBlockBox(B, b, (x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5, hx, hy, hz, 0, 8 * hx * hy * hz);
}

// Kawałek ściany obwodu na boku s (0: x = +hx, 1: y = +hy, 2: x = −hx, 3: y = −hy) od punktu u do v, grubość t do
// środka obrysu. Ściany poprzeczne y = ±hy mają pełną szerokość (róg należy do nich, jak w modelu
// pirateBaseScene.highriseTower), ściany x = ±hx leżą między nimi (|y| ≤ hy − t).
function _wallPiece(B, b, s, ux, uy, vx, vy, hx, hy, t, z0, z1) {
  if ((s & 1) === 0) {
    const x0 = s === 0 ? hx - t : -hx;
    const y0 = Math.max(Math.min(uy, vy), -hy + t), y1 = Math.min(Math.max(uy, vy), hy - t);
    return y1 > y0 ? _boxAA(B, b, x0, x0 + t, y0, y1, z0, z1) : -1;
  }
  const y0 = s === 1 ? hy - t : -hy;
  return _boxAA(B, b, Math.min(ux, vx), Math.max(ux, vx), y0, y0 + t, z0, z1);
}

// Linie siatki kafli stropu na osi o półszerokości wnętrza i z rdzeniem ±c: zakresy [−i, −c], [−c, c], [c, i]
// dzielone na kawałki ~tile j. (rdzeń zostaje jedną komórką siatki albo jej wielokrotnością).
function _tileLines(i, c, tile) {
  if (!(i > c)) return [-i, i];
  const nO = Math.max(1, Math.round((i - c) / tile)), nM = Math.max(1, Math.round(2 * c / tile)), out = [];
  for (let k = 0; k < nO; k++) out.push(-i + (i - c) * k / nO);
  for (let k = 0; k < nM; k++) out.push(-c + 2 * c * k / nM);
  for (let k = 0; k <= nO; k++) out.push(c + (i - c) * k / nO);
  return out;
}

// Prostopadłościany wieżowca (synteza dema D20 § 2a). Blok obwodu poziomu l = ściana kondygnacji POD jego stropem
// (od stropu niżej do własnego): odcinek obwodu między połowami dróg do sąsiadów × grubość ściany, wewnątrz obrysu;
// narożnik — dwa ramiona w L (ramię krótsze niż BOX_MIN po luzie — przy gęstym obwodzie — odpada) + kafle stropu
// (grubość slabT, dach ×3 jak masa) przypisane najbliższemu blokowi poziomu (obwód albo rdzeń). Rdzeń — słup coreW²
// przez całą kondygnację (kafle omijają jego komórkę). Iglica — walec r 30 jako prostopadłościan o tym samym polu.
// Udziały masy ∝ objętość (finishArchetype normalizuje do masy bloku).
function _highriseBoxes(B, rings, ids, core, zOf, z0, ks, roofL, hx0, hy0, wall, coreW, slabT, tile) {
  const NL = zOf.length, c = coreW / 2, hs = 30 * Math.sqrt(Math.PI) / 2;
  for (let l = 0; l < NL; l++) {
    const zA = l ? zOf[l - 1] : z0, zB = zOf[l];
    if (l > roofL) { _boxAA(B, core[l], -hs, hs, -hs, hs, zA, zB); continue; }
    const r = rings[l], np = r.length, per1 = np / 4, hx = hx0 * ks[l], hy = hy0 * ks[l], row = ids[l];
    for (let j = 0; j < np; j++) {
      const p = r[j], a = r[(j + np - 1) % np], b = r[(j + 1) % np];
      const ax = (a[0] + p[0]) * 0.5, ay = (a[1] + p[1]) * 0.5, bx = (p[0] + b[0]) * 0.5, by = (p[1] + b[1]) * 0.5;
      const s = Math.floor(j / per1);
      if (j % per1 === 0) {
        _wallPiece(B, row[j], (s + 3) & 3, ax, ay, p[0], p[1], hx, hy, wall, zA, zB);
        _wallPiece(B, row[j], s, p[0], p[1], bx, by, hx, hy, wall, zA, zB);
      } else _wallPiece(B, row[j], s, ax, ay, bx, by, hx, hy, wall, zA, zB);
    }
    _boxAA(B, core[l], -c, c, -c, c, zA, zB);
    const sT = l === roofL ? 3 * slabT : slabT;
    const xs = _tileLines(hx - wall, c, tile), yl = _tileLines(hy - wall, c, tile);
    for (let u = 0; u + 1 < xs.length; u++) {
      for (let v = 0; v + 1 < yl.length; v++) {
        const mx = (xs[u] + xs[u + 1]) * 0.5, my = (yl[v] + yl[v + 1]) * 0.5;
        if (Math.abs(mx) < c && Math.abs(my) < c) continue;
        let best = core[l], bd = mx * mx + my * my;
        for (let j = 0; j < np; j++) {
          const dx = r[j][0] - mx, dy = r[j][1] - my, dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = row[j]; }
        }
        _boxAA(B, best, xs[u], xs[u + 1], yl[v], yl[v + 1], zB - sT, zB);
      }
    }
  }
}

// Prostopadłościany dysku (synteza dema D20 § 2a): wycinek pierścienia na warstwę — dolna: spód płyty (½T), górna:
// wierzch (½T) z tarasami tier1 / tier2 jak masa bloku (promień środka pierścienia); obrót yaw = kąt wycinka.
// Prostopadłościan leży w wycinku z luzem: od promienia ra + luz, połowa szerokości do odległości luzu od krawędzi
// wycinka, narożniki zewnętrzne ≤ rb − luz — sąsiednie wycinki i pierścienie się nie przenikają. `split`
// prostopadłościanów promieniowo na wycinek (pokrycie pola wycinka ~80% przy pierścieniu wewnętrznym, ~93% przy
// zewnętrznym; udziały masy ∝ objętość).
function _discBoxes(B, id, S, rings, rIn, dr, zBot, T, tierDz, split) {
  const G = STRUCT_BOX_GAP;
  for (let i = 0; i < rings; i++) {
    const s = S[i], phi = Math.PI / s, tn = Math.tan(phi), cs = Math.cos(phi);
    const zTop1 = zBot + T + tierDz(rIn + (i + 0.5) * dr), zMid = zBot + 0.5 * T;
    for (let j = 0; j < s; j++) {
      const a = (j + 0.5) / s * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      for (let q = 0; q < split; q++) {
        const ra = rIn + (i + q / split) * dr, rb = rIn + (i + (q + 1) / split) * dr;
        const x0 = ra + G, hw = x0 * tn - G / cs, ro = rb - G;
        const x1 = Math.sqrt(Math.max(0, ro * ro - hw * hw));
        if (!(x1 - x0 >= BOX_MIN && 2 * hw >= BOX_MIN)) continue;
        const xc = (x0 + x1) * 0.5, hxr = (x1 - x0) * 0.5;
        for (let L = 0; L < 2; L++) {
          const za = L ? zMid : zBot, zb = L ? zTop1 : zMid, hz = (zb - za) * 0.5 - G;
          addBlockBox(B, id[L][i][j], xc * ca, xc * sa, (za + zb) * 0.5, hxr, hw, hz, a, 8 * hxr * hw * hz);
        }
      }
    }
  }
}

// Obwód prostokąta ±hx × ±hy: narożniki + `per` punktów na bok, przeciwnie do zegara od (hx, −hy).
function _perimeter(hx, hy, per) {
  const C = [[hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]], out = [];
  for (let s = 0; s < 4; s++) {
    const a = C[s], b = C[(s + 1) % 4];
    for (let k = 0; k <= per; k++) { const t = k / (per + 1); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/**
 * WIEŻOWIEC W-1/W-2 (PIRATE_BASE_SPEC.highrise, plan § 4.1 „Przygotowanie”): stropy wg wysokości K-7 (×0,42 nad
 * płaszczyzną — k7HeightToZ), gęściej w pasie broni i przy podstawie (16 bloków obwodu na poziomie), wyżej 8
 * sektorów obwodu + rdzeń, ponad zwężeniem (setbackY) rzut ×0,76, iglica 2 poziomy. Kotwice SECTION (pomost — D13)
 * na pokładzie (deckY0). Przekroje słupów ∝ ciężarowi nad kondygnacją (plan § 3.2: kalibracja per poziom).
 * Masa: ściany (wall), stropy, rdzeń — objętość / 45³ × gęstość 1,8 (materiał highrise).
 * Lokalnie: x wzdłuż pomostu (w), y w poprzek (d), z świata; środek rzutu w (0, 0).
 * Prostopadłościany bloków (A.boxStart / A.boxData, structureBlockBoxes): _highriseBoxes — ściany, narożniki w L,
 * rdzeń, kafle stropu ~`tile` j., iglica. `g` — przyspieszenie budowli (D12; domyślnie 400 — bit w bit z E1),
 * przy g ≠ 400 waveJ × g/400 (_tuneForG).
 */
export function buildHighriseArchetype({ seed = 1, tune = null, density = 1.8, slabT = 15, coreWall = 22, g = 400, tile = 80 } = {}) {
  const HR = PIRATE_BASE_SPEC.highrise;
  const deckY = PIRATE_BASE_SPEC.pier.deckY0;
  const ys = [46, 116, 200, 283, 450, 600, 800, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 3450, 3900];
  const roofL = 15, denseTop = 3;
  const NL = ys.length;
  const zOf = ys.map((y) => k7HeightToZ(y)), z0 = k7HeightToZ(deckY);
  const hx0 = HR.w / 2, hy0 = HR.d / 2;
  const rings = [];
  for (let l = 0; l < NL; l++) {
    if (l > roofL) { rings.push([]); continue; }
    const k = ys[l] > HR.setbackY ? 0.76 : 1;
    rings.push(_perimeter(hx0 * k, hy0 * k, l <= denseTop ? 3 : 1));
  }
  const ringAnch = _perimeter(hx0, hy0, 3);
  const B = createArchetypeBuilder(1024, 4096);
  const sectorOf = (px, py) => { let a = Math.atan2(py, px); if (a < 0) a += 2 * Math.PI; return Math.floor(a / (Math.PI / 4)) & 7; };
  // masy poziomów (do przekrojów ∝ obciążeniu)
  const storeyH = (l) => zOf[l] - (l ? zOf[l - 1] : z0);
  const levMass = new Float64Array(NL);
  const perimLen = (r) => { let L = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; };
  const blockMass = [];
  for (let l = 0; l < NL; l++) {
    const hs = storeyH(l), ms = [];
    if (l > roofL) {
      const m = Math.PI * 30 * 30 * hs / NODE_VOL * density;
      ms.push(m); levMass[l] = m; blockMass.push(ms); continue;
    }
    const r = rings[l], P = perimLen(r), np = r.length;
    const k = ys[l] > HR.setbackY ? 0.76 : 1, ax = 2 * hx0 * k, ay = 2 * hy0 * k;
    const wallM = P * HR.wall * hs / NODE_VOL * density;
    const slabM = ax * ay * slabT / NODE_VOL * density * (l === roofL ? 3 : 1);
    const coreM = 4 * HR.coreW * coreWall * hs / NODE_VOL * density;
    let tot = 0;
    for (let i = 0; i < np; i++) {
      const a = r[(i + np - 1) % np], b = r[i], c = r[(i + 1) % np];
      const trib = 0.5 * (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1])) / P;
      const m = (wallM + 0.7 * slabM) * trib; ms.push(m); tot += m;
    }
    const mc = coreM + 0.3 * slabM; ms.push(mc); tot += mc;
    levMass[l] = tot; blockMass.push(ms);
  }
  const Wabove = new Float64Array(NL + 1);
  for (let l = NL - 1; l >= 0; l--) Wabove[l] = Wabove[l + 1] + levMass[l];
  const loadF = (l) => Math.max(0.12, Wabove[l] / Wabove[0]);
  // bloki
  const anchorIds = ringAnch.map((p) => addBlock(B, p[0], p[1], z0, 0, -1, sectorOf(p[0], p[1]), STRUCT_ANCHOR.SECTION));
  const anchorCore = addBlock(B, 0, 0, z0, 0, -1, 8, STRUCT_ANCHOR.SECTION);
  const ids = [], core = [];
  for (let l = 0; l < NL; l++) {
    const row = [];
    if (l > roofL) { core.push(addBlock(B, 0, 0, zOf[l], blockMass[l][0], l, 8)); ids.push(row); continue; }
    rings[l].forEach((p, i) => row.push(addBlock(B, p[0], p[1], zOf[l], blockMass[l][i], l, sectorOf(p[0], p[1]))));
    core.push(addBlock(B, 0, 0, zOf[l], blockMass[l][rings[l].length], l, 8));
    ids.push(row);
  }
  // wiązania
  const colA = (l, trib) => HR.wall * trib * loadF(l);
  const coreA = (l) => 4 * HR.coreW * coreWall * loadF(l);
  const nearest = (r, p) => { let bi = 0, bd = Infinity; for (let i = 0; i < r.length; i++) { const d = (r[i][0] - p[0]) ** 2 + (r[i][1] - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  for (let l = 0; l <= roofL; l++) {
    const up = rings[l], low = l ? rings[l - 1] : ringAnch, upI = ids[l], lowI = l ? ids[l - 1] : anchorIds;
    const np = up.length, nl = low.length, hs = storeyH(l);
    const P = perimLen(up);
    const used = new Uint8Array(nl);
    for (let j = 0; j < np; j++) {
      const i = nearest(low, up[j]); used[i] = 1;
      const trib = P / np;
      addBond(B, lowI[i], upI[j], colA(l, trib), STRUCT_BOND.VERT, l);
      // stężenia X w ścianie: do sąsiadów dolnego punktu
      addBond(B, lowI[(i + 1) % nl], upI[j], colA(l, trib) * 0.25, STRUCT_BOND.DIAG, l);
      addBond(B, lowI[(i + nl - 1) % nl], upI[j], colA(l, trib) * 0.25, STRUCT_BOND.DIAG, l);
    }
    for (let i = 0; i < nl; i++) {
      if (used[i]) continue;
      const j = nearest(up, low[i]);
      addBond(B, lowI[i], upI[j], colA(l, P / np) * 0.6, STRUCT_BOND.VERT, l);
    }
    addBond(B, l ? core[l - 1] : anchorCore, core[l], coreA(l), STRUCT_BOND.VERT, l);
    // strop: obwód (ściana poziomo) i szprychy do rdzenia
    for (let j = 0; j < np; j++) {
      addBond(B, upI[j], upI[(j + 1) % np], HR.wall * hs * 0.5, STRUCT_BOND.RING);
      addBond(B, upI[j], core[l], slabT * (P / np), STRUCT_BOND.SPOKE);
    }
  }
  // iglica: maszt na rdzeniu dachu + odciągi do narożników dachu
  const roof = ids[roofL], roofRing = rings[roofL];
  const corners = [];
  for (let j = 0; j < roofRing.length; j++) if (Math.abs(Math.abs(roofRing[j][0]) - hx0 * 0.76) < 1 && Math.abs(Math.abs(roofRing[j][1]) - hy0 * 0.76) < 1) corners.push(roof[j]);
  for (let l = roofL + 1; l < NL; l++) {
    addBond(B, core[l - 1], core[l], Math.PI * 30 * 30 * loadF(l), STRUCT_BOND.VERT, l);
    for (const c of corners) addBond(B, c, core[l], 150, STRUCT_BOND.DIAG, l);
  }
  // prostopadłościany bloków (geometria L1 — klaster, obraz, trafienia)
  const ks = ys.map((y) => (y > HR.setbackY ? 0.76 : 1));
  _highriseBoxes(B, rings, ids, core, zOf, z0, ks, roofL, hx0, hy0, HR.wall, HR.coreW, slabT, tile);
  return finishArchetype(B, {
    name: 'wiezowiec', seed, g, levelZ: zOf, groundZ: z0, split: true, splitMinLevels: 3, chunkLevels: 2, sliverFrac: 0.4,
    tune: _tuneForG(tune, g)
  });
}

/**
 * DYSK MIESZKALNY habitatu (plan § 4.2, D1 — „tarcza”): `rings` pierścieni od stemR do discR, wycinki ~`wedge` j.,
 * 2 warstwy (góra i spód płyty) z wiązaniami OSIOWYMI: obwodowe, promieniowe, pionowe i ukośne między warstwami
 * (promieniowo i obwodowo) — para sił w warstwach przenosi zginanie płyty. Kotwice SUPPORT na trzonie (r = stemR,
 * góra i spód) o skończonej nośności (reakcja nienaruszona × supportCapMul) × utrzymanie (D8). Poziom bloku =
 * numer pierścienia. Masa: płyta (thick) + tarasy tier1 / tier2 na górnej warstwie.
 * Prostopadłościany bloków: _discBoxes — wycinek × warstwa, `boxSplit` promieniowo, obrót wokół z. `g` — jak
 * w buildHighriseArchetype (domyślnie 400 — bit w bit z E1).
 */
export function buildDiscArchetype({ seed = 1, tune = null, rings = 6, wedge = 300, density = 0.6, supportCapMul = 3, u0 = 0.15, g = 400, boxSplit = 2 } = {}) {
  const H = PIRATE_BASE_SPEC.habitat;
  const rIn = H.stemR, rOut = H.discR, zBot = k7HeightToZ(H.discY0), zTop = k7HeightToZ(H.discY1);
  const T = zTop - zBot, dr = (rOut - rIn) / rings;
  const zt = zTop - 0.25 * T, zb = zBot + 0.25 * T;
  const tier1 = { r: H.tier1R, dz: k7HeightToZ(H.tier1Y) - zTop }, tier2 = { r: H.tier2R, dz: k7HeightToZ(H.tier2Y) - k7HeightToZ(H.tier1Y) };
  const S = [];
  for (let i = 0; i < rings; i++) S.push(Math.max(8, Math.round(2 * Math.PI * (rIn + (i + 0.5) * dr) / wedge)));
  let nb = 2 * S[0]; for (const s of S) nb += 2 * s;
  const B = createArchetypeBuilder(nb + 8, nb * 8);
  const ang = (s, j) => (j + 0.5) / s * 2 * Math.PI;
  const anc = [[], []];
  for (let L = 0; L < 2; L++) for (let j = 0; j < S[0]; j++) {
    const a = ang(S[0], j);
    anc[L].push(addBlock(B, rIn * Math.cos(a), rIn * Math.sin(a), L ? zt : zb, 0, -1, j, STRUCT_ANCHOR.SUPPORT, 0));
  }
  const id = [[], []];
  for (let i = 0; i < rings; i++) {
    const r = rIn + (i + 0.5) * dr, ri = rIn + i * dr, ro = ri + dr;
    for (let L = 0; L < 2; L++) {
      const row = [];
      for (let j = 0; j < S[i]; j++) {
        const a = ang(S[i], j);
        const areaW = Math.PI * (ro * ro - ri * ri) / S[i];
        let m = areaW * T * 0.5 / NODE_VOL * density;
        if (L === 1) {
          if (r <= tier1.r) m += areaW * tier1.dz / NODE_VOL * density;
          if (r <= tier2.r) m += areaW * tier2.dz / NODE_VOL * density;
        }
        row.push(addBlock(B, r * Math.cos(a), r * Math.sin(a), L ? zt : zb, m, i, j));
      }
      id[L].push(row);
    }
  }
  const half = T * 0.5;
  // kotwice → pierścień 0 (promieniowo + krzyż między warstwami)
  for (let j = 0; j < S[0]; j++) {
    const arc = 2 * Math.PI * rIn / S[0];
    for (let L = 0; L < 2; L++) addBond(B, anc[L][j], id[L][0][j], half * arc, STRUCT_BOND.ANCHOR);
    addBond(B, anc[0][j], id[1][0][j], half * arc * 0.3, STRUCT_BOND.PLATE_D);
    addBond(B, anc[1][j], id[0][0][j], half * arc * 0.3, STRUCT_BOND.PLATE_D);
  }
  for (let i = 0; i < rings; i++) {
    const s = S[i], r = rIn + (i + 0.5) * dr, arc = 2 * Math.PI * r / s;
    for (let j = 0; j < s; j++) {
      const j1 = (j + 1) % s;
      for (let L = 0; L < 2; L++) addBond(B, id[L][i][j], id[L][i][j1], half * dr, STRUCT_BOND.PLATE_T);
      addBond(B, id[0][i][j], id[1][i][j], arc * dr * 0.08, STRUCT_BOND.PLATE_Z);
      addBond(B, id[0][i][j], id[1][i][j1], half * dr * 0.3, STRUCT_BOND.PLATE_D);
      addBond(B, id[1][i][j], id[0][i][j1], half * dr * 0.3, STRUCT_BOND.PLATE_D);
    }
    if (i + 1 >= rings) continue;
    // promieniowe: blok pierścienia i+1 do bloków pierścienia i, których zakres kąta zachodzi na jego
    const so = S[i + 1], ro = rIn + (i + 1) * dr;
    for (let j = 0; j < so; j++) {
      const a0 = j / so, a1 = (j + 1) / so;
      for (let q = 0; q < s; q++) {
        const b0 = q / s, b1 = (q + 1) / s;
        const ov = Math.min(a1, b1) - Math.max(a0, b0);
        if (ov <= 1e-9) continue;
        const w = ov * 2 * Math.PI * ro;
        for (let L = 0; L < 2; L++) addBond(B, id[L][i][q], id[L][i + 1][j], half * w, STRUCT_BOND.PLATE_R);
        addBond(B, id[0][i][q], id[1][i + 1][j], half * w * 0.3, STRUCT_BOND.PLATE_D);
        addBond(B, id[1][i][q], id[0][i + 1][j], half * w * 0.3, STRUCT_BOND.PLATE_D);
      }
    }
  }
  const tierDz = (r) => (r <= tier1.r ? tier1.dz : 0) + (r <= tier2.r ? tier2.dz : 0);
  _discBoxes(B, id, S, rings, rIn, dr, zBot, T, tierDz, boxSplit);
  const A = finishArchetype(B, { name: 'dysk', seed, g, split: false, supportCapMul, tune: { u0, ...(_tuneForG(tune, g) || {}) } });
  A.disc = { rIn, rOut, zTop, zBot, rings, sectors: S, dr };
  return A;
}

// ── POLE GRUBOŚCI PŁYTY (dysk, § 4.2; prototyp progu przed E6) ─────────────────────────────────────────────────
/**
 * Pole grubości u8 na komórkę `cell` j. pierścienia rIn..rOut (środek cx, cy): 255 = pełna grubość komórki
 * (warstwa zBot…zBot + full[c]; full = thick + tarasy `tiers` [{ r, dz }] — wierzch dysku z tarasami), 0 = otwór.
 * ZGNIOT PLASTYCZNY: komórka stawia opór σ·A (σ(utrzymanie) — awaryjny próg zależny od utrzymania z jawnym oknem,
 * D8, plateSigma; jeden próg: sigmaHeld = sigmaFree), materiał zgnieciony traci grubość od góry, przy
 * 0 — otwór; poniżej oporu — styk sprężysty (siła do grafu przez cellBlock). Masa zgniecionej warstwy
 * (rho · A · Δτ) przejmuje prędkość ciała (zderzenie niesprężyste — „wieża traci ten pęd”).
 */
export function createPlateField({ cx = 0, cy = 0, rIn = 560, rOut = 1950, cell = 45, zBot = -1056, thick = 220, tiers = null,
  sigma = 20, sigmaHeld = null, sigmaFree = null, holdFree = PLATE_TUNE.holdFree, holdHeld = PLATE_TUNE.holdHeld,
  rho = 0.6 / NODE_VOL } = {}) {
  const gw = Math.ceil(2 * rOut / cell) + 2, ox = cx - rOut - cell, oy = cy - rOut - cell;
  const nc = gw * gw;
  const th = new Uint8Array(nc), inDisc = new Uint8Array(nc), cellBlock = new Int32Array(nc).fill(-1), full = new Float64Array(nc);
  let count = 0;
  for (let j = 0; j < gw; j++) for (let i = 0; i < gw; i++) {
    const x = ox + (i + 0.5) * cell - cx, y = oy + (j + 0.5) * cell - cy, r = Math.sqrt(x * x + y * y);
    if (r < rIn || r > rOut) continue;
    const c = i + j * gw;
    let f = thick;
    if (tiers) for (const t of tiers) if (r <= t.r) f += t.dz;
    th[c] = 255; inDisc[c] = 1; full[c] = f; count++;
  }
  return {
    cx, cy, rIn, rOut, cell, gw, ox, oy, nc, zBot, zTop: zBot + thick, thick, rho, hold: 1,
    sigmaHeld: sigmaHeld ?? sigma, sigmaFree: sigmaFree ?? sigma, holdFree, holdHeld,
    th, inDisc, cellBlock, full, cells: count,
    // styki kroku (prealokowane): wnikanie, ramię uogólnione, liczba punktów, lista dotkniętych komórek
    pen: new Float64Array(nc), lev: new Float64Array(nc), cnt: new Int32Array(nc), touched: new Int32Array(nc), nTouched: 0,
    newTop: new Float64Array(nc), cellF: new Float64Array(nc),
    stats: { crushedCells: 0, holes: 0, energy: 0, accreted: 0, maxForce: 0 }
  };
}

/** Komórka pola pod punktem (x, y) albo −1. */
export function plateCellAt(P, x, y) {
  const i = Math.floor((x - P.ox) / P.cell), j = Math.floor((y - P.oy) / P.cell);
  if (i < 0 || j < 0 || i >= P.gw || j >= P.gw) return -1;
  const c = i + j * P.gw;
  return P.inDisc[c] ? c : -1;
}

/** Wierzch materiału komórki (z) — płyta zgniatana od góry. */
export function plateSurfaceZ(P, c) {
  return P.zBot + P.th[c] * P.full[c] / 255;
}

/** Opór zgniotu komórki [siła] przy bieżącym utrzymaniu. */
export function plateCellCap(P) {
  return plateSigma(P) * P.cell * P.cell;
}

/**
 * Styk ciała 1-DOF z polami płyt (prototyp progu): punkty ciała w położeniu PRZEWIDZIANYM (wx, wy, wz), ramię
 * uogólnione jac[i] = prędkość punktu W DÓŁ na jednostkę q̇ (≥ 0 — punkt wchodzi w płytę). Zbiera komórki
 * z wnikaniem (pen — najgłębszy punkt, lev — średnie ramię). Zwraca uogólnioną nośność zgniotu Σ σ·A·lev.
 */
export function plateGather(P, wx, wy, wz, jac, n) {
  for (let t = 0; t < P.nTouched; t++) { const c = P.touched[t]; P.pen[c] = 0; P.lev[c] = 0; P.cnt[c] = 0; }
  P.nTouched = 0;
  const cell = P.cell, gw = P.gw, ox = P.ox, oy = P.oy, th = P.th, full = P.full, zb = P.zBot, inD = P.inDisc;
  for (let i = 0; i < n; i++) {
    const z = wz[i];
    if (z < zb - cell) continue;
    const gi = Math.floor((wx[i] - ox) / cell), gj = Math.floor((wy[i] - oy) / cell);
    if (gi < 0 || gj < 0 || gi >= gw || gj >= gw) continue;
    const c = gi + gj * gw;
    if (!inD[c] || !th[c]) continue;
    const top = zb + th[c] * full[c] / 255;
    const p = top - z;
    if (!(p > 0)) continue;
    if (!P.cnt[c]) P.touched[P.nTouched++] = c;
    P.cnt[c]++;
    if (p > P.pen[c]) P.pen[c] = p;
    P.lev[c] += jac[i];
  }
  const cap = plateCellCap(P);
  let Q = 0;
  for (let t = 0; t < P.nTouched; t++) {
    const c = P.touched[t];
    P.lev[c] /= P.cnt[c];
    if (P.lev[c] > 0) Q += cap * P.lev[c];
  }
  return Q;
}

/**
 * Zgniot komórek dotkniętych w plateGather po ruchu ciała: nowy wierzch = najniższy punkt ciała w komórce
 * (newTop — liczy gospodarz po ruchu), utrata grubości → energia σ·A·Δτ, masa rho·A·Δτ (zwraca Σ Δm·lev² —
 * uogólnioną masę przejętą przez ciało). Otwór przy 0.
 */
export function plateCrush(P) {
  const cap = plateCellCap(P), A = P.cell * P.cell;
  let acc = 0;
  for (let t = 0; t < P.nTouched; t++) {
    const c = P.touched[t];
    if (!(P.lev[c] > 0)) continue;
    const top = P.zBot + P.th[c] * P.full[c] / 255;
    const nt = P.newTop[c];
    if (!(nt < top)) continue;
    let v = Math.floor((nt - P.zBot) / P.full[c] * 255);
    if (v < 0) v = 0;
    if (v >= P.th[c]) continue;
    const dTau = (P.th[c] - v) * P.full[c] / 255;
    if (P.th[c] === 255) P.stats.crushedCells++;
    P.th[c] = v;
    if (!v) P.stats.holes++;
    P.stats.energy += cap * dTau;
    const dm = P.rho * A * dTau;
    P.stats.accreted += dm;
    acc += dm * P.lev[c] * P.lev[c];
  }
  return acc;
}

/** Statystyki pola: komórki nienaruszone / z rowem / otwory, najgłębszy ubytek (ułamek pełnej grubości). */
export function plateCounts(P) {
  let intact = 0, trench = 0, holes = 0, maxLoss = 0, lossSum = 0;
  for (let c = 0; c < P.nc; c++) {
    if (!P.inDisc[c]) continue;
    const t = P.th[c];
    if (t === 255) intact++; else if (t === 0) holes++; else trench++;
    const loss = 1 - t / 255; lossSum += loss;
    if (loss > maxLoss) maxLoss = loss;
  }
  return { cells: P.cells, intact, trench, holes, maxLoss, meanLossTouched: trench + holes ? lossSum / (trench + holes) : 0 };
}

// ── PROTOTYP PROGU SZYJA / UPADEK (ryzyko R3; scenariusze testu i narzędzia) ────────────────────────────────────
/**
 * Chmura punktów wieży H-T (PIRATE_BASE_SPEC.habitat, komórka 45 — jak wokselizacja): szyja (kratownica,
 * gęstość 0,35), talerz ringR0..ringR1 (lity), piasta headR, maszt. Układ lokalny: oś wieży +bz od nasady szyi
 * (neckY0). Masa punktu = gęstość × 1,6 (materiał H-T) — „węzły komórki 45”.
 */
export function towerPointCloud(cell = 45) {
  const H = PIRATE_BASE_SPEC.habitat, z0 = k7HeightToZ(H.neckY0);
  const parts = [
    { r0: 0, r1: H.neckR, z0: 0, z1: k7HeightToZ(H.neckY1) - z0, d: 0.35 },
    { r0: H.ringR0, r1: H.ringR1, z0: k7HeightToZ(H.ringY0) - z0, z1: k7HeightToZ(H.ringY1) - z0, d: 1 },
    { r0: 0, r1: H.headR, z0: k7HeightToZ(H.ringY0) - z0, z1: k7HeightToZ(H.headTop) - z0, d: 0.8 },
    { r0: 0, r1: 60, z0: k7HeightToZ(H.headTop) - z0, z1: k7HeightToZ(H.mastTop) - z0, d: 0.5 }
  ];
  const bx = [], by = [], bz = [], m = [];
  for (const p of parts) {
    for (let z = p.z0 + cell / 2; z < p.z1; z += cell) {
      const R = Math.ceil(p.r1 / cell);
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        const x = i * cell, y = j * cell, r = Math.sqrt(x * x + y * y);
        if (r > p.r1 || r < p.r0) continue;
        bx.push(x); by.push(y); bz.push(z); m.push(p.d * 1.6);
      }
    }
  }
  const n = bx.length;
  let M = 0; for (const v of m) M += v;
  return { n, bx: Float64Array.from(bx), by: Float64Array.from(by), bz: Float64Array.from(bz), m: Float64Array.from(m), M,
    ringR: H.ringR1, neckBaseZ: z0 };
}

/** Domyślne nastawy prototypu progu (strojenie: scripts/struktura-sym.mjs --tryb prog). */
export const PLATE_TUNE = Object.freeze({
  sigmaHeld: 200,   // opór zgniotu dysku przy utrzymaniu 1 (szyja — habitat żyje) [siła / j²]
  sigmaFree: 4,     // … przy utrzymaniu 0 (upadek — po HP 0 utrzymanie zanika w ~2–3 s, D8)
  holdFree: 0.1,    // okno progu: utrzymanie ≤ holdFree → sigmaFree (wieża przechodzi), ≥ holdHeld → sigmaHeld (trzyma)
  holdHeld: 0.5,
  d8Seconds: 2.5,   // zegar D8: utrzymanie 1 → 0 liniowo w tyle sekund od HP 0 (scenariusz upadku liczy z niego hold)
  crownMul: 1,      // korona bębna: opór × mnożnik względem dysku (bok szyi gniecie się o koronę)
  gHabitat: 400,    // grawitacja habitatu (szyja)
  gFall: 260        // grawitacja wieży do przejścia przez dysk (reguła baza-piratow, UPADEK)
});

/**
 * Scenariusz progu: 'szyja' — leżąca wieża (przegub w nasadzie szyi, oś y, przechył ku +x) uderza bokiem: korona
 * bębna (pole r 910…1000) i talerz w dysk z tarasami; 'upadek' — stojąca wieża spada pionowo przez dysk
 * z prędkością v0 (talerz r ≤ 880 nad pierścieniem 560…880). Ciało sztywne 1-DOF (kąt / wysokość), styk
 * prędkościowy: gdy uogólniona nośność zgniotu wystarcza, by zatrzymać ruch w kroku — styk sprężysty (siła do
 * grafu dysku), inaczej zgniot wszystkich dotkniętych komórek z oporem σ·A i przejęciem masy. Graf dysku liczony
 * równolegle (siły komórek → bloki, utrzymanie = hold). opts: { hz, v0, omega0, theta0Deg, hold, sigmaHeld,
 * sigmaFree, crownMul, seconds, graph (true), cloud, disc (archetyp) }.
 */
export function plateImpactScenario(kind, opts = {}) {
  const T = { ...PLATE_TUNE, ...opts };
  const H = PIRATE_BASE_SPEC.habitat;
  const hz = opts.hz ?? 120, dt = 1 / hz;
  const C = opts.cloud || towerPointCloud();
  const n = C.n;
  const zBot = k7HeightToZ(H.discY0), zTop = k7HeightToZ(H.discY1);
  const tiers = [{ r: H.tier1R, dz: k7HeightToZ(H.tier1Y) - zTop }, { r: H.tier2R, dz: k7HeightToZ(H.tier2Y) - k7HeightToZ(H.tier1Y) }];
  // utrzymanie: szyja — habitat żyje (1); upadek — z zegara D8 w chwili dojścia wieży do dysku (spadek od spoczynku
  // do v0 przy gFall trwa v0 / gFall; utrzymanie 1 → 0 w d8Seconds od HP 0), chyba że podane jawnie
  const tArrive = kind === 'upadek' ? (opts.v0 ?? 1200) / T.gFall : 0;
  const holdD8 = Math.max(0, 1 - tArrive / T.d8Seconds);
  const hold = opts.hold ?? (kind === 'szyja' ? 1 : holdD8);
  const disc = createPlateField({ rIn: H.stemR, rOut: H.discR, zBot, thick: zTop - zBot, tiers, sigmaHeld: T.sigmaHeld, sigmaFree: T.sigmaFree,
    holdFree: T.holdFree, holdHeld: T.holdHeld });
  disc.hold = hold;
  const crownTop = k7HeightToZ(H.rimTop), crownBot = k7HeightToZ(H.floorY);
  const crown = createPlateField({ rIn: H.drumR - H.wall, rOut: H.drumR, zBot: crownBot, thick: crownTop - crownBot,
    sigmaHeld: T.sigmaHeld * T.crownMul, sigmaFree: T.sigmaFree * T.crownMul, holdFree: T.holdFree, holdHeld: T.holdHeld, rho: 2.4 / NODE_VOL });
  crown.hold = hold;
  const fields = kind === 'szyja' ? [disc, crown] : [disc];
  // graf dysku
  let G = null;
  if (opts.graph !== false) {
    const A = opts.disc || buildDiscArchetype({ seed: opts.seed ?? 7 });
    G = createStructure(A, { id: 3 });
    structureSetHold(G, hold);
    plateBindGraph(disc, G);
  }
  // 1-DOF: q — kąt przechyłu (szyja) albo droga w dół (upadek)
  const hx = 0.5 * H.neckR, hzW = C.neckBaseZ;
  let q, qd, I = 0;
  if (kind === 'szyja') {
    q = (opts.theta0Deg ?? 80) * Math.PI / 180; qd = opts.omega0 ?? 0.7;
    for (let i = 0; i < n; i++) I += C.m[i] * (C.bx[i] * C.bx[i] + C.bz[i] * C.bz[i]);
  } else {
    // spód talerza tuż nad wierzchem dysku (z tarasami)
    q = 0; qd = opts.v0 ?? 1200; I = C.M;
  }
  const ringBot = k7HeightToZ(H.ringY0) - hzW;
  const topMax = zTop + tiers[0].dz + tiers[1].dz;
  const z0fall = topMax + 5 - ringBot;   // położenie nasady szyi przy q = 0
  const wx = new Float64Array(n), wy = new Float64Array(n), wz = new Float64Array(n), jac = new Float64Array(n);
  const pose = (qq) => {
    if (kind === 'szyja') {
      const c = Math.cos(qq), s = Math.sin(qq);
      for (let i = 0; i < n; i++) {
        wx[i] = hx + C.bx[i] * c + C.bz[i] * s; wy[i] = C.by[i]; wz[i] = hzW - C.bx[i] * s + C.bz[i] * c;
        jac[i] = C.bx[i] * c + C.bz[i] * s;
      }
    } else {
      for (let i = 0; i < n; i++) { wx[i] = C.bx[i]; wy[i] = C.by[i]; wz[i] = z0fall + C.bz[i] - qq; jac[i] = 1; }
    }
  };
  const gravQ = (qq) => {
    if (kind !== 'szyja') return C.M * T.gFall;
    const c = Math.cos(qq), s = Math.sin(qq); let Q = 0;
    for (let i = 0; i < n; i++) Q += C.m[i] * T.gHabitat * (C.bx[i] * c + C.bz[i] * s);
    return Q;
  };
  const seconds = opts.seconds ?? (kind === 'szyja' ? 3 : 2.5);
  const steps = Math.round(seconds * hz);
  let tick = 0, tFirst = -1, holdSteps = 0, crushSteps = 0, maxQd = qd, vPass = NaN, passed = false, supFailPre = 0, supFail = 0;
  for (let s = 0; s < steps; s++, tick++) {
    const qdp = qd + gravQ(q) / I * dt;
    pose(q + qdp * dt);
    let Qcap = 0;
    for (const P of fields) Qcap += plateGather(P, wx, wy, wz, jac, n);
    let touched = 0; for (const P of fields) touched += P.nTouched;
    if (touched && tFirst < 0) tFirst = s * dt;
    if (!touched || qdp <= 0) { q += qdp * dt; qd = qdp; }
    else if (Qcap * dt >= I * qdp) {
      // styk sprężysty: ruch staje, siła do grafu ∝ nośności komórek
      holdSteps++;
      const share = I * qdp / dt / Qcap;
      if (G) for (let t = 0; t < disc.nTouched; t++) {
        const c = disc.touched[t], b = disc.cellBlock[c];
        if (b >= 0 && disc.lev[c] > 0) structureAddImpulse(G, b, 0, 0, -plateCellCap(disc) * share * dt);
      }
      qd = 0;
    } else {
      crushSteps++;
      let qn = qdp - Qcap * dt / I;
      const qNew = q + qn * dt;
      pose(qNew);
      for (const P of fields) {
        for (let t = 0; t < P.nTouched; t++) P.newTop[P.touched[t]] = Infinity;
        for (let i = 0; i < n; i++) {
          const c = plateCellAt(P, wx[i], wy[i]);
          if (c < 0 || !P.cnt[c]) continue;
          if (wz[i] < P.newTop[c]) P.newTop[c] = wz[i];
        }
        const acc = plateCrush(P);
        qn *= I / (I + acc);
        if (G && P === disc) for (let t = 0; t < disc.nTouched; t++) {
          const c = disc.touched[t], b = disc.cellBlock[c];
          if (b >= 0 && disc.lev[c] > 0) structureAddImpulse(G, b, 0, 0, -plateCellCap(disc) * dt);
        }
      }
      q = qNew; qd = qn;
    }
    if (qd > maxQd) maxQd = qd;
    if (kind === 'upadek' && !passed && z0fall + ringBot + (k7HeightToZ(H.ringY1) - k7HeightToZ(H.ringY0)) - q < zBot) { passed = true; vPass = qd; }
    if (G) {
      // komórki-otwory zabierają bloki grafu (≥ 60% komórek bloku przebite)
      if (crushSteps && (s & 3) === 0) _plateKillBlocks(disc, G);
      stepStructure(G, dt, tick);
      for (let j = 0; j < G.evCount; j++) if (G.ev[j * STRUCT_EV_STRIDE] === STRUCT_EV.SUPPORT_FAIL) { supFail++; if (tFirst < 0) supFailPre++; }
    }
  }
  if (G) _plateKillBlocks(disc, G);
  const pc = plateCounts(disc);
  const res = { kind, hz, hold, tArrive, holdD8, sigmaHeld: T.sigmaHeld, sigmaFree: T.sigmaFree, sigma: plateSigma(disc), crownMul: T.crownMul,
    disc: pc, crown: kind === 'szyja' ? plateCounts(crown) : null, energyDisc: disc.stats.energy, energyCrown: crown.stats.energy,
    accreted: disc.stats.accreted,
    tFirst, holdSteps, crushSteps, endQ: q, endQd: qd, maxQd, passed, vPass };
  if (kind === 'szyja') { res.endDeg = q * 180 / Math.PI; res.rimSpeed = maxQd * Math.sqrt((C.ringR) ** 2 + ringBot ** 2); }
  else res.iou = plateHoleIoU(disc, 0, 0, C.ringR);
  if (G) {
    let lost = 0, nb = 0;
    for (let i = 0; i < G.arch.n; i++) { if (G.arch.anchor[i]) continue; nb++; if (G.dead[i] || G.island[i] >= 0) lost++; }
    res.graph = { blocks: nb, lost, lostFrac: lost / nb, islands: G.nIsl, breaks: G.stats.breaks, maxEvalErr: G.stats.maxEvalErr,
      supportFails: supFail, supportFailsBeforeContact: supFailPre };
  }
  return res;
}

/**
 * Bieżący opór zgniotu pola (σ przy jego utrzymaniu) — AWARYJNY PRÓG OD UTRZYMANIA (D8) z jawnym oknem: σ = sigmaFree
 * przy utrzymaniu ≤ holdFree, sigmaHeld przy ≥ holdHeld, smoothstep między (liniowe σ(h) przebijało tylko przy
 * h ≤ 0,01 — urwisko zamiast progu). Zegar D8 (utrzymanie 1 → 0 w d8Seconds od HP 0) a upadek: wieża dochodzi do
 * dysku po v0 / gFall ≥ 3,5 s (v0 ≥ 900 j/s), czyli przy utrzymaniu 0; szyja (habitat żyje) — przy 1.
 */
export function plateSigma(P) {
  const h = P.hold, a = P.holdFree, b = P.holdHeld;
  if (h <= a) return P.sigmaFree;
  if (h >= b) return P.sigmaHeld;
  const t = (h - a) / (b - a), sm = t * t * (3 - 2 * t);
  return P.sigmaFree + sm * (P.sigmaHeld - P.sigmaFree);
}

// Bloki grafu nad otworami: blok ginie, gdy ≥ 60% jego komórek to otwory (liczniki z plateBindGraph).
function _plateKillBlocks(P, G) {
  const nb = G.arch.n, tot = P.blockCells, holes = P.blockHoles;
  tot.fill(0); holes.fill(0);
  for (let c = 0; c < P.nc; c++) {
    const b = P.cellBlock[c];
    if (b < 0) continue;
    tot[b]++;
    if (!P.th[c]) holes[b]++;
  }
  for (let b = 0; b < nb; b++) {
    if (!(tot[b] > 0) || G.dead[b]) continue;
    if (holes[b] >= 0.6 * tot[b]) {
      structureDestroyBlock(G, b);
      // blok spodniej warstwy pod nim też (otwór na wylot)
      const A = G.arch;
      let best = -1, bd = Infinity;
      for (let j = 0; j < nb; j++) {
        if (j === b || A.anchor[j] || G.dead[j] || A.level[j] !== A.level[b]) continue;
        const d = (A.x[j] - A.x[b]) ** 2 + (A.y[j] - A.y[b]) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0 && bd < 1) structureDestroyBlock(G, best);
    }
  }
}

/** IoU otworów pola z kołem r wokół (x, y) przyciętym do pierścienia płyty (przekrój wieży). */
export function plateHoleIoU(P, x, y, r) {
  let inter = 0, uni = 0;
  for (let c = 0; c < P.nc; c++) {
    if (!P.inDisc[c]) continue;
    const i = c % P.gw, j = (c / P.gw) | 0;
    const dx = P.ox + (i + 0.5) * P.cell - x, dy = P.oy + (j + 0.5) * P.cell - y;
    const inS = dx * dx + dy * dy <= r * r, hole = P.th[c] === 0;
    if (inS && hole) inter++;
    if (inS || hole) uni++;
  }
  return uni ? inter / uni : 0;
}

/** Przypisanie komórek do bloków GÓRNEJ warstwy grafu dysku (najbliższy blok w rzucie) — siła styku do grafu.
 *  Warstwa górna = bloki ponad środkiem wysokości bloków grafu (filtr po P.zTop był martwy: pole nie miało zTop). */
export function plateBindGraph(P, S) {
  const A = S.arch;
  P.blockCells = new Int32Array(A.n); P.blockHoles = new Int32Array(A.n);
  let z0 = Infinity, z1 = -Infinity;
  for (let b = 0; b < A.n; b++) { if (A.anchor[b]) continue; if (A.z[b] < z0) z0 = A.z[b]; if (A.z[b] > z1) z1 = A.z[b]; }
  const zMid = 0.5 * (z0 + z1);
  for (let c = 0; c < P.nc; c++) {
    if (!P.inDisc[c]) continue;
    const i = c % P.gw, j = (c / P.gw) | 0;
    const x = P.ox + (i + 0.5) * P.cell, y = P.oy + (j + 0.5) * P.cell;
    let best = -1, bd = Infinity;
    for (let b = 0; b < A.n; b++) {
      if (A.anchor[b] || A.z[b] < zMid) continue;
      const d = (A.x[b] - x) ** 2 + (A.y[b] - y) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    P.cellBlock[c] = best;
  }
}
