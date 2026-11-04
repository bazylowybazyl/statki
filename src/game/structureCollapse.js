/**
 * structureCollapse — GOSPODARZ ZAWALENIA budowli (docs/PLAN-zawalenia-budowli-3d.md § 3.3–3.4, § 4.1; synteza dema D20
 * § 2e; etap demo D20 krok 3, wpięcie w grę E5–E7 bez zmian API).
 *
 * Łączy GRUBY GRAF NOŚNY (structureGraph.js — prawda o tym, CO trzyma, CO pęka i GDZIE się przewróci) z KLASTRAMI
 * SZTYWNYMI silnika belek (HullBodies.createCluster — beamRigid3D.js: ruch, styki, teren, przeguby). Graf nie rusza ciał,
 * silnik nie zna wiązań — gospodarz przekłada jedno na drugie:
 *  - KIKUT (część zakotwiczona grafu): ZAMROŻONE klastry, jeden na poziom (structureBlockBoxes → buildClusterDesc →
 *    createCluster → freezeCluster). Hak styku działa też dla zamrożonego klastra — uderzenie w kikut idzie wprost do
 *    grafu (structureAddImpulse); pary zamrożony × zamrożony silnik pomija. W grze (E5) kikut w płaszczyźnie gry to ciało
 *    pasa ze słupem — decyzja E5 (plan § 3.6).
 *  - UZGADNIANIE po każdej zmianie S.topoVer: prawdą są S.island / S.dead (bufor zdarzeń ma sufit STRUCT_EV_CAP 64).
 *    Blok z kikuta do wyspy → klaster wyspy w pozie postoju; blok z wyspy A do wyspy B (podział — ISLAND z rodzicem)
 *    → klaster-dziecko z pozą i ruchem rodzica (respawn: origin = pos − R·com, kwaternion rodzica, v + ω × R·Δcom, ω);
 *    blok martwy → przebudowa właściciela i rekord gruzu; wyspa z 1 bloku → gruz obrazu (blok ginie w grafie);
 *    wyspa ≤ 2 bloków oderwana od budowli → klaster z KOPNIĘCIEM na zewnątrz rzutu (PRNG ziarna — kaskada elewacji
 *    widoczna); createCluster → null (sufit 256) → gruz obrazu. ≤ birthsPer120 narodzin na 1/120 s, reszta czeka
 *    (bloki zostają u starego właściciela — bez przenikania).
 *  - IMPULSY STYKU: blok kikuta → structureAddImpulse; blok wyspy → WŁASNY bufor gospodarza na blok, bo ocena części
 *    zakotwiczonej (_evaluate) zeruje wszystkie S.jx. Uderzenie (Δv = |J| / m wyspy > impactDv) wstawia wyspę do
 *    kolejki FIFO; JEDNA wyspa na krok: bufor → structureAddImpulse → structureSolveIsland, ponawiane co krok aż do
 *    wyniku ≥ 0 (S.islPend ma jedno miejsce). Zerwania dzielą wyspę — dzieci rodzą się w uzgadnianiu.
 *  - ZDARZENIA: HINGE → przegub silnika (clusterJoint w punkcie zawiasu, breakTilt = v2·π/180, up = −ĝ) i kopnięcie
 *    ω0 wzdłuż osi; ISLAND ze spadkiem pionowym (v3 = 1, > 3 bloki) → FRONT (structureStartFront); pęknięcie przegubu
 *    (kąt — D11: przechył 30–45°, potem zgniot; albo ZASTÓJ — przechył stoi, bo róg wyspy oparł się o ziemię lub kikut)
 *    → FRONT z prędkością pionową i zapamiętanym ω. FRONT KINEMATYCZNY: poza = poza startu + (s0 − F.s)·ĝ, przechył
 *    zostaje, bez par (noHullCollisions), najniższa kondygnacja wyspy w gruz (1-D model frontu liczy spód wyspy od
 *    jej najniższego stropu). FRONT L → klaster kikuta poziomu L znika (graf zabija bloki), pierścień gruzu. Koniec
 *    frontu (FRONT_GROUND / FRONT_STOP albo najniższy punkt wyspy na podłożu) → wyspa wolna: grawitacja, pary,
 *    v = F.v·ĝ, ω przywrócone.
 *  - RUINA: klaster śpiący dłużej niż freezeAfter s → freezeCluster (koszt kroku 0; utrata podpory go odmraża).
 *  - OBRAZ i REŻYSER KADRU: pierścień rekordów (gruz, pierścienie frontu, odpryski, pył, rysy — collapseRecords) i oś
 *    czasu (oderwanie, zawias, przechył w czasie, pęknięcie przegubu, poziomy frontu, dach na ziemi — collapseTimeline;
 *    D15 ustawi ujęcie z przewidzianego czasu).
 *
 * ŚWIAT gospodarza = świat SILNIKA (x gry, −y gry, z) jak opcje createCluster: origin, punkty trafień, rekordy, oś czasu.
 * Hak styku przychodzi ze świata GRY (rozdzielacz HullBodies, y w dół) — gospodarz odbija y sam. Układ archetypu:
 * p_świat = origin + Rz(yaw)·p_lokalny; klaster = układ archetypu (prostopadłościany opisu są lokalne), więc J_lokalny =
 * R(kwaternion klastra)ᵀ·J_świat. Jednostka masy: masa silnika = masa grafu × massUnit (45², D5) — impuls z haka / massUnit.
 * g gospodarza = g archetypu (A.g) = g klastrów = g frontu (D12); broń: J × g/400 (historia zerwań przy g 80 = przy 400).
 *
 * Czysty moduł (zasady obszaru): bez three, DOM, `window` i Math.random — rozrzut kopnięć z structureRng (ziarno
 * gospodarza). HullBodies przychodzi z opcji (`bodies`), nie z importu (domknięcie importów obszaru bez Math.random).
 * Krok bez alokacji POZA NARODZINAMI klastrów (createCluster, opis, rekord klastra); liczby zmiennoprzecinkowe stanu
 * w tablicach typowanych (pola dużych obiektów V8 pakuje). Budżety na 1/120 s (per120), iteracje wyspy swobodnej
 * ∝ dt (islandIters120 na 1/120 s) — 60 i 120 Hz dają te same czasy.
 *
 * Kolejność kroku (gra / demo / narzędzie): collapsePreStep(H, dt) → HullBodies.step(dt, [..., ...H.entities]) →
 * collapseStep(H, dt, tick). Teren podłoża dodaje scena (collapseGroundTerrain → engine.addTerrain) — jeden na kilka
 * gospodarzy.
 * AGENT: E5 — kikut w płaszczyźnie gry to ciało pasa (słup colZ0..colZ1 skracany do najwyższego zakotwiczonego poziomu),
 *   broń przez HullBodies.sweep / impact + hak onImpact → collapseWeaponHit; filtr par klaster × klaster (D.rigidRRFilter)
 *   dopiero, gdy pomiar pokaże zakleszczenie przy przegubie (dziś zapas: ZASTÓJ łamie przegub).
 */

import {
  createStructure, stepStructure, structureAddImpulse, structureSolveIsland, structureStartFront, structureDestroyBlock,
  structureDamageSphere, structureDamageBond, structureHit, structureAddLoad, structureReleaseAnchor, structureReset, structureBlockBoxes,
  structureRng, STRUCT_EV, STRUCT_EV_STRIDE, STRUCT_BOX_STRIDE, STRUCT_BOX_GAP, STRUCT_MASS_UNIT
} from './structureGraph.js';
import { buildClusterDesc, clusterMassProperties } from './beamRigid3D.js';

// ── stałe publiczne ─────────────────────────────────────────────────────────────────────────────────────────────
/** Fazy klastra gospodarza. */
export const COLLAPSE_PHASE = Object.freeze({ FREE: 0, HINGE: 1, FRONT: 2, STUMP: 3 });

/** Rekordy obrazu (pierścień collapseRecords). Słowa: 0 typ, 1 czas [s], 2–4 punkt (świat silnika), 5–7 prędkość,
 *  8–11 kwaternion, 12 masa (jednostka silnika), 13 a, 14 b, 15 c. */
export const COLLAPSE_REC = Object.freeze({
  DEBRIS: 1,   // blok w gruz: punkt = początek układu archetypu klastra-właściciela (pos − R·com), kwaternion klastra,
               // v = prędkość bloku, masa bloku, a = blok, b = 1 zniszczony / 2 zmiażdżony frontem / 3 sufit klastrów
  RING: 2,     // pierścień gruzu frontu: punkt = środek poziomu, v = F.v·ĝ, masa gruzu, a = poziom, b = promień rzutu
  CHIP: 3,     // odprysk trafienia: punkt trafienia, v = kierunek strzału (jednostkowy), masa = J (silnik), a = broń
  DUST: 4,     // pył uderzenia wyspy: punkt styku, v = prędkość klastra, masa = |J| (silnik), a = bloki wyspy
  CRACK: 5     // rysa / podpora puszcza: punkt kotwicy, a = blok
});
export const COLLAPSE_REC_STRIDE = 16;

/**
 * Bronie gospodarza (J w jednostce GRAFU przy g 400 — gospodarz skaluje × g/400; krater: promień [j.] i spadek zdrowia
 * wiązań w środku). `bateria` — bateria dema (mocniejsza niż broń gry: test mechaniki, nie balansu), reszta — bronie sceny
 * ręcznej dema (synteza § 4, scena 2). Indeks broni (`i`) idzie w rekord odprysku.
 */
export const COLLAPSE_WEAPONS = Object.freeze({
  bateria: Object.freeze({ i: 0, r: 110, amount: 0.3, J: 3000, radius: 120 }),
  dzialo: Object.freeze({ i: 1, r: 80, amount: 0.12, J: 1500, radius: 100 }),
  torpeda: Object.freeze({ i: 2, r: 150, amount: 0.3, J: 4000, radius: 160 }),
  reaktor: Object.freeze({ i: 3, r: 360, amount: 0.25, J: 6000, radius: 360 })
});

/** Strojenie gospodarza (zamrożone; wartości na egzemplarz — opcje createCollapseHost). */
export const COLLAPSE_TUNE = Object.freeze({
  birthsPer120: 4,      // narodziny klastrów (createCluster) na 1/120 s (plan § 3.4); nadmiar czeka w kolejce
  islandIters120: 250,  // iteracje CG wyspy swobodnej na 1/120 s (structureSolveIsland; 60 Hz — 500 na krok)
  islandMaxCalls: 40,   // wywołania jednej wyspy bez wyniku ≥ 0 — potem wypada z kolejki (topologia zmienia się co krok)
  impactDv: 60,         // [j/s] uderzenie wyspy: |J| / masa wyspy w kroku ponad tyle → kolejka rozwiązań (spoczynek g·dt;
                        // osiadanie wyspy na luzie 2 j. przy narodzinach √(2·g·2) — 40 j/s przy g 400 — to nie uderzenie)
  contactR: 150,        // [j.] promień łaty styku wyspy: impuls haka rozkładany na bloki wyspy przy punkcie styku
  impactScale: 0.5,     // ułamek impulsu styku do grafu wyspy (structureSolveIsland liczy siłę J / pulseT 1/30 s; mniejszy
                        // ułamek = dłuższe uderzenie)
  hingeKick: 0.02,      // [rad/s] ω0 wzdłuż osi zawiasu przy HINGE (synteza § 2e)
  stallDeg: 0.5,        // [°] ZASTÓJ przechyłu: przyrost mniejszy niż tyle przez stallTime s → przegub pęka (róg na ziemi /
  stallTime: 1,         // [s]  kikucie — kulisty przegub z podparciem w drugim punkcie trzymałby wyspę bez końca; × √(400 / g))
  kickMin: 15, kickMax: 40,   // [j/s] kopnięcie małej wyspy (≤ 2 bloki, od budowli) na zewnątrz rzutu
  kickSpin: 0.6,        // [rad/s] największe ω kopnięcia
  freezeAfter: 3,       // [s] klaster śpiący dłużej → ruina zamrożona
  groundEps: 2,         // [j.] najniższy punkt wyspy frontu tyle nad podłożem → wyspa wolna
  crushDepth: 0.25,     // kikut pod przechyłem: punkt wyspy wchodzi w blok kikuta głębiej niż tyle × promień → blok zmiażdżony
  crushTouch: -0.1,     // … pod przewracaną wieżą (z parami): wystarczy styk (kula do 0,1 promienia od bloku)
  stallGround: 30,      // [j.] zastój z najniższym punktem tyle nad podłożem = wieża stoi na narożniku → bez frontu
  toppleEndDeg: 80,     // [°] przechył, od którego przewrócona wieża dostaje z powrotem tłumienie spoczynku / toczenia
  toppleNudges: 3,      // pchnięcia przewracanej wieży, która zasnęła / stoi w równowadze chwiejnej na narożniku (ω hingeKick)
  stuckStalls: 4,       // … po nich jeszcze tyle zastojów z NACISKIEM (narożnik kruszy graf wyspy — stuckStaticEvery), potem koniec
  stuckStaticEvery: 0.25, // [s] okno nacisku wieży, której pchnięcia nie ruszyły (wieża oparta narożnikiem stabilnie, przechył < ~20°)
  toppleStallTime: 3,   // [s] przewracanie bez przyrostu przechyłu (stallDeg) tyle × √(400 / g) — koniec (wieża oparta o gruz)
  staticEvery: Infinity,// [s] NACISK przewracanej wieży: okno zbierania obciążenia styku do grafu wyspy (kruszenie narożnika, na
                        // którym wieża stoi). Domyślnie wył.: przy 0,25 s wieża kruszyła się od podstawy w gruz (128–158 bloków
                        // z 178), a czasy 60 / 120 Hz rozjeżdżały się o 35% — A/B do oceny R1 (zawalenia-sym --set staticEvery=0.25)
  roofEps: 60,          // [j.] narożnik bloku poziomu dachu tyle nad podłożem → „dach na ziemi” (oś czasu; dach węższy niż
                        // podstawa — uskok ×0,76 — leżącej wieży wisi ~45 j. nad gruntem)
  roofDebrisHalf: 50,   // [j.] dach w gruzie: spód bloku tyle pod jego środkiem (lądowanie analityczne)
  mainFrac: 0.3,        // wyspa cięższa niż ułamek budowli = „główna” (oś czasu, przechył)
  tiltSampleDt: 0.05    // [s] próbki przechyłu w osi czasu
});

// oś czasu: indeksy H.tv
const TL_DETACH = 0, TL_HINGE = 1, TL_JOINT = 2, TL_JOINT_TILT = 3, TL_BREAK_MODE = 4, TL_TILT40 = 5, TL_FRONT_START = 6,
  TL_FRONT_END = 7, TL_FRONT_END_KIND = 8, TL_ROOF = 9, TL_MAX_TILT = 10, TL_ROOF_DEBRIS = 11, TL_N = 12;
const TILT_CAP = 4096, FRONT_CAP = 64, REC_CAP = 4096;
// liczniki: indeksy H.st
const ST_BIRTHS = 0, ST_RELEASES = 1, ST_DEBRIS = 2, ST_SOLVES = 3, ST_SOLVE_OK = 4, ST_SOLVE_DROP = 5, ST_QUEUED = 6,
  ST_KICKS = 7, ST_FRONT_LEVELS = 8, ST_NULL = 9, ST_PENDING_STEPS = 10, ST_MAX_CLUSTERS = 11, ST_JOINTS = 12,
  ST_FRONTS = 13, ST_OVERFLOW = 14, ST_STALLS = 15, ST_CRUSHED = 16, ST_SOLVED_J = 17, ST_N = 18;

const GRAV_ON = Object.freeze({ gravity: true });
const GRAV_OFF = Object.freeze({ gravity: false });

// Budżet „na 1/120 s” → na krok dt (60 Hz: ×2). Przy kroku 1/120 s dokładnie wejście.
function per120(n, dt) {
  if (dt === 1 / 120) return n;
  return Math.max(1, Math.round(n * dt * 120));
}

// ── podłoże ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Teren silnika z opisu podłoża sceny (engine.addTerrain): { kind: 'kula', cx, cy, cz, R, friction?, armorMul? } —
 * kula (płaski grunt = R 10⁶). Jeden teren na kilka gospodarzy na tym samym gruncie.
 */
export function collapseGroundTerrain(ground) {
  const R = +ground.R, cx = +ground.cx || 0, cy = +ground.cy || 0, cz = +ground.cz || 0;
  return {
    cx, cy, cz, R, rMax: R + 1, friction: ground.friction ?? 0.6, armorMul: ground.armorMul ?? 3, restAngDamp: 2,
    onContact: null, radius() { return R; }
  };
}

/** Wysokość podłoża (z świata silnika) pod punktem (x, y): kula — górna półsfera, płaszczyzna — z. */
export function collapseGroundZ(ground, x, y) {
  if (ground.kind === 'plaszczyzna') return +ground.z || 0;
  const dx = x - (+ground.cx || 0), dy = y - (+ground.cy || 0), R = +ground.R;
  const h = R * R - dx * dx - dy * dy;
  return (+ground.cz || 0) + (h > 0 ? Math.sqrt(h) : 0);
}

// ── gospodarz ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Gospodarz zawalenia archetypu `A` (structureGraph). opts:
 * - bodies — HullBodies (wymagane; init i rozdzielacz haka styku instaluje gospodarz);
 * - origin {x, y, z} — początek układu archetypu w świecie silnika, yaw [rad] — obrót wokół z (świat silnika);
 * - ground — podłoże jak collapseGroundTerrain (wysokość pod frontem, dach na ziemi; teren dodaje scena);
 * - massUnit (45²), kappa / debrisFrac (front; domyślnie z A.tune), angularDamping (tłumienie obrotu klastrów [1/s];
 *   null — silnik 0,2/s; A/B tempa D12), gravityWell (studnia skały — E7), id, seed (PRNG kopnięć), name;
 * - tune — nadpisania COLLAPSE_TUNE (birthsPer120, islandIters120, impactDv, hingeKick, stall*, kick*, freezeAfter, …);
 * - stumpCollide (false — kikut bez par: stojącą część niesie pole płyty silnika, structurePlate.js), hinge / front
 *   (false — wyspa bez przegubu zawiasu / bez frontu zgniotu: wycinki płyty dysku spadają swobodnie); domyślnie true.
 * Tworzy egzemplarz grafu i kikut (zamrożone klastry poziomów). Zwraca H; encje klastrów — H.entities (scena dokłada je
 * do listy HullBodies.step).
 */
export function createCollapseHost(A, opts = {}) {
  const HB = opts.bodies;
  if (!HB || typeof HB.createCluster !== 'function') throw new TypeError('createCollapseHost: opts.bodies (HullBodies) wymagane');
  HB.init();
  HB.installClusterContactRouter();
  const T = Object.freeze({ ...COLLAPSE_TUNE, ...(opts.tune || {}) });
  const n = A.n, nI = 2 * n + 2, NL = Math.max(1, A.nLevels);
  const yaw = +opts.yaw || 0, cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const O = opts.origin || { x: 0, y: 0, z: 0 };
  // ĝ świata = Rz(yaw)·ĝ archetypu
  const gx = cyw * A.gx - syw * A.gy, gy = syw * A.gx + cyw * A.gy, gz = A.gz;
  const G = A.g;
  const ground = opts.ground || { kind: 'plaszczyzna', z: (+O.z || 0) + A.groundZ };
  // bloki z prostopadłościanami (kotwice ich nie mają) i poziom dachu (oś czasu): najwyższy poziom z ≥ 3 blokami
  const boxed = [];
  const levCount = new Int32Array(NL);
  for (let b = 0; b < n; b++) if (A.boxStart && A.boxStart[b + 1] > A.boxStart[b] && !A.anchor[b]) { boxed.push(b); if (A.level[b] >= 0) levCount[A.level[b]]++; }
  let roofL = -1;
  for (const b of boxed) { const l = A.level[b]; if (l >= 0 && levCount[l] >= 3 && l > roofL) roofL = l; }
  const roofBlocks = boxed.filter((b) => A.level[b] === roofL);
  const H = {
    A, S: createStructure(A, { id: opts.id | 0 }), HB, T, name: String(opts.name || A.name || 'budowla'),
    n, nI, NL,
    massUnit: Number(opts.massUnit) > 0 ? Number(opts.massUnit) : STRUCT_MASS_UNIT,
    kappa: Number.isFinite(opts.kappa) ? opts.kappa : A.tune.kappa,
    debrisFrac: Number.isFinite(opts.debrisFrac) ? opts.debrisFrac : A.tune.debrisFrac,
    angularDamping: Number.isFinite(opts.angularDamping) ? opts.angularDamping : null,
    gravityWell: opts.gravityWell || null,
    seed: (opts.seed ?? (A.seed ^ 0x2c0115e)) >>> 0,
    rnd: null,
    ground,
    // podłoże w tablicy (pętle kroku liczą wysokość w miejscu — bez liczb w argumentach i wynikach funkcji): 0 płaszczyzna?,
    // 1–3 środek kuli, 4 promień, 5 z płaszczyzny
    upL: Float64Array.of(-A.gx, -A.gy, -A.gz),
    gr: Float64Array.of(ground.kind === 'plaszczyzna' ? 1 : 0, +ground.cx || 0, +ground.cy || 0, +ground.cz || 0, +ground.R || 0, +ground.z || 0),
    // skala czasu ruchu przy niskim g (zastoje: √(400 / g) — przechył i przewracanie są tyle wolniejsze)
    slow: Math.sqrt(400 / Math.max(1, G)),
    // poza archetyp → świat: origin, yaw (f64), ĝ świata, g, kwaternion postoju
    pose: Float64Array.of(+O.x || 0, +O.y || 0, +O.z || 0, cyw, syw, gx, gy, gz, G, 0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)),
    origin: { x: +O.x || 0, y: +O.y || 0, z: +O.z || 0 },
    quat0: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) },
    gravity: { x: gx * G, y: gy * G, z: gz * G },
    upW: { x: -gx, y: -gy, z: -gz },
    boxed: Int32Array.from(boxed), roofL, roofBlocks: Int32Array.from(roofBlocks),
    // klastry: rekordy (rosną przy narodzinach), właściciel bloku, mapy klucz → rekord
    cls: [], entities: [],
    own: new Int32Array(n).fill(-1), islCl: new Int32Array(nI).fill(-1), stumpCl: new Int32Array(NL).fill(-1),
    // uzgadnianie (bufory)
    want: new Int32Array(n), newKey: new Int32Array(n), tMark: new Uint8Array(nI + NL), tChosen: new Uint8Array(nI + NL),
    tList: new Int32Array(nI + NL), tMass: new Float64Array(nI + NL), tCnt: new Int32Array(nI + NL),
    bList: new Int32Array(n), srcMark: null,
    // impulsy wysp (świat archetypu, jednostka grafu), kolejka FIFO wysp
    bj: new Float64Array(3 * n), blkT: new Uint8Array(n), tBlk: new Int32Array(n), islJ: new Float64Array(nI),
    islT: new Uint8Array(nI), tIsl: new Int32Array(nI), q: new Int32Array(nI), inQ: new Uint8Array(nI), qCalls: new Int32Array(nI),
    qStatic: new Uint8Array(nI), islAcc: new Uint8Array(nI),
    // semantyka wysp czekająca na klaster (HINGE, spadek pionowy): flagi i dane zawiasu (punkt, oś, kąt)
    pend: new Uint8Array(nI), pendList: new Int32Array(nI), hingeData: new Float64Array(nI * 8),
    // stan skalarny (int) i liczby (f64)
    iv: new Int32Array(16), fv: new Float64Array(8),
    tv: new Float64Array(TL_N), tilt: new Float64Array(2 * TILT_CAP), front: new Float64Array(2 * FRONT_CAP),
    st: new Float64Array(ST_N),
    rec: { buf: new Float64Array(REC_CAP * COLLAPSE_REC_STRIDE), cap: REC_CAP, stride: COLLAPSE_REC_STRIDE, head: 0 },
    // wektory wywołań driveCluster (stałe obiekty — bez alokacji)
    _p: { x: 0, y: 0, z: 0 }, _v: { x: 0, y: 0, z: 0 }, _w: { x: 0, y: 0, z: 0 }, _zero: { x: 0, y: 0, z: 0 },
    _m: new Float64Array(9), _t: new Float64Array(8), _boxes: [], _cboxes: [], _hitO: { radius: 120 }, _frontOpts: null,
    bMark: new Uint8Array(nI + NL), buildK: new Int32Array(nI + NL), crushCand: new Int32Array(n), crushMark: new Uint8Array(n),
    madeK: new Int32Array(nI + NL), madeNew: new Int32Array(nI + NL), madeOld: new Int32Array(nI + NL),
    onClusterContact: null,
    // budowla z polem płyty (dysk — structurePlate.js): kikut bez par (stojącą część niesie pole płyty silnika), bez
    // semantyki zawiasu i frontu (wycinki płyty to nie kondygnacje — wyspa spada swobodnie)
    stumpCollide: opts.stumpCollide !== false, allowHinge: opts.hinge !== false, allowFront: opts.front !== false,
    dbg: null   // narzędzia: dbg(rodzaj, a, b, c) — uderzenia wysp, rozwiązania (null w grze)
  };
  // iv: 0 tick, 1 topoSeen, 2 reconcilePending, 3 qHead, 4 qCount, 5 nPend, 6 frontEnd (0/1 ziemia/2 stop), 7 mainRec,
  //     8 frontRec, 9 nTilt, 10 nFront, 12 bloki z impulsem (tBlk), 13 wyspy z impulsem w kroku (tIsl)
  // fv: 0 czas, 1 następna próbka przechyłu, 2 lądowanie dachu w gruzie (analitycznie; 0 — brak), 3 dt bieżącego kroku
  H.onClusterContact = function onClusterContact(entity, hull, blk, jx, jy, jz, x, y, z) {
    collapseContact(this, entity, blk, jx, jy, jz, x, y, z);
  };
  _resetState(H);
  _buildStump(H);
  return H;
}

function _resetState(H) {
  H.rnd = structureRng(H.seed);
  H.iv.fill(0); H.iv[1] = -1; H.iv[7] = -1; H.iv[8] = -1;
  H.fv.fill(0);
  H.tv.fill(-1); H.tv[TL_JOINT_TILT] = NaN; H.tv[TL_ROOF_DEBRIS] = 0; H.tv[TL_BREAK_MODE] = 0; H.tv[TL_FRONT_END_KIND] = 0; H.tv[TL_MAX_TILT] = 0;
  H.st.fill(0);
  H.own.fill(-1); H.islCl.fill(-1); H.stumpCl.fill(-1);
  H.bj.fill(0); H.blkT.fill(0); H.islJ.fill(0); H.islT.fill(0); H.inQ.fill(0); H.qCalls.fill(0); H.pend.fill(0);
  H.qStatic.fill(0); H.islAcc.fill(0);
  H.tMark.fill(0); H.tChosen.fill(0);
  H.rec.head = 0;
}

// ── poza: archetyp ↔ świat ─────────────────────────────────────────────────────────────────────────────────────
/** Punkt układu archetypu → świat silnika (out {x, y, z}). */
export function collapseLocalToWorld(H, lx, ly, lz, out) {
  const p = H.pose;
  out.x = p[0] + p[3] * lx - p[4] * ly; out.y = p[1] + p[4] * lx + p[3] * ly; out.z = p[2] + lz;
  return out;
}

/** Punkt świata silnika → układ archetypu (out {x, y, z}). */
export function collapseWorldToLocal(H, x, y, z, out) {
  const p = H.pose, dx = x - p[0], dy = y - p[1];
  out.x = p[3] * dx + p[4] * dy; out.y = -p[4] * dx + p[3] * dy; out.z = z - p[2];
  return out;
}

// macierz obrotu kwaternionu (wiersze) do m
function _rot(q, m) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - w * z); m[2] = 2 * (x * z + w * y);
  m[3] = 2 * (x * y + w * z); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - w * x);
  m[6] = 2 * (x * z - w * y); m[7] = 2 * (y * z + w * x); m[8] = 1 - 2 * (x * x + y * y);
}

// ── klastry: narodziny, zwolnienie ──────────────────────────────────────────────────────────────────────────────
// Encja-lustro klastra (HullBodies.syncSolidOut pisze co krok pozę i prędkości): wszystkie pola od razu, w stałej
// kolejności, liczby jako double — literał z polami dopisywanymi przez silnik przechodził w tryb słownikowy i każdy zapis
// pozy pakował liczbę (pomiar: ~2,9 KB na krok przy 18 klastrach kikuta).
class CollapseEntity {
  constructor(name, H) {
    this.name = name; this.isWreck = true; this.collapseHost = H; this.collapseRec = null;
    this.x = 0.5; this.y = 0.5; this.z = 0.5; this.vx = 0.5; this.vy = 0.5; this.vz = 0.5;
    this.angle = 0.5; this.angVel = 0.5; this.mass = NaN; this.radius = 0.5; this._bpRadius = 0.5;
    this.quat = { x: 0.5, y: 0.5, z: 0.5, w: 0.5 };
    this.pos = null; this.vel = null; this.beamHull = null; this.solid3D = false; this.rigidCluster = false;
    this.noWreckSleep = false; this._coldUnsupported = false; this.noHullCollisions = false; this.isCollidable = true; this.dead = false;
  }
}

// Klucz: wyspa grafu (0 … nI−1) albo poziom kikuta (nI + L).
function _clOfKey(H, key) {
  const k = key < H.nI ? H.islCl[key] : H.stumpCl[key - H.nI];
  return k >= 0 && H.cls[k].alive ? H.cls[k] : null;
}

/**
 * Narodziny klastra z bloków `list[0..nb)` (POZA KROKIEM gorącej ścieżki — alokuje). src — rekord, z którego klaster
 * dziedziczy pozę i ruch (null — poza postoju budowli). kick — kopnięcie małej wyspy. Zwraca rekord albo null (sufit).
 */
function _spawn(H, key, list, nb, src, kick) {
  const A = H.A, HB = H.HB, stump = key >= H.nI;
  const blocks = Int32Array.from(list.subarray(0, nb));
  const boxes = _contactBoxes(A, structureBlockBoxes(A, blocks, nb, H._boxes, H.massUnit), H._cboxes);
  const desc = buildClusterDesc(boxes);
  const mp = clusterMassProperties(desc);
  let ox = H.origin.x, oy = H.origin.y, oz = H.origin.z;
  let q = H.quat0;
  let vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0;
  if (src && src.kind === 0 && src.body && !src.body.dead) {
    const b = src.body, m = H._m;
    _rot(b.quat, m);
    const f = src.f;
    // początek układu archetypu rodzica w świecie: pos − R·com
    ox = b.pos.x - (m[0] * f[0] + m[1] * f[1] + m[2] * f[2]);
    oy = b.pos.y - (m[3] * f[0] + m[4] * f[1] + m[5] * f[2]);
    oz = b.pos.z - (m[6] * f[0] + m[7] * f[1] + m[8] * f[2]);
    q = { x: b.quat.x, y: b.quat.y, z: b.quat.z, w: b.quat.w };
    // pole prędkości rodzica w środku masy dziecka: v + ω × R·(com_dziecka − com_rodzica)
    const dx = mp.com[0] - f[0], dy = mp.com[1] - f[1], dz = mp.com[2] - f[2];
    const rx = m[0] * dx + m[1] * dy + m[2] * dz, ry = m[3] * dx + m[4] * dy + m[5] * dz, rz = m[6] * dx + m[7] * dy + m[8] * dz;
    wx = b.angVel.x; wy = b.angVel.y; wz = b.angVel.z;
    vx = b.vel.x + wy * rz - wz * ry; vy = b.vel.y + wz * rx - wx * rz; vz = b.vel.z + wx * ry - wy * rx;
  }
  if (kick) { vx += kick[0]; vy += kick[1]; vz += kick[2]; wx += kick[3]; wy += kick[4]; wz += kick[5]; }
  const entity = new CollapseEntity(`${H.name}:${stump ? 'kikut' : 'wyspa'}${stump ? key - H.nI : key}`, H);
  const hull = HB.createCluster(entity, desc, {
    origin: { x: ox, y: oy, z: oz }, quaternion: q,
    velocity: { x: vx, y: vy, z: vz }, angularVelocity: { x: wx, y: wy, z: wz },
    gravity: H.gravity, gravityWell: H.gravityWell, angularDamping: H.angularDamping
  });
  if (!hull) { H.st[ST_NULL]++; return null; }
  // f: 0–2 com (układ archetypu), 3 masa (silnik), 4 sen od [s], 5 przechył odniesienia (zastój), 6 jego czas,
  //    7–9 ω zapamiętane (front), 10–12 baza frontu (pos przy d = 0), 13 s0 frontu, 14 narodziny [s], 15 początek zbierania
  //    nacisku przewracanej wieży [s] (−1 — nie zbiera)
  const rec = {
    k: H.cls.length, key, kind: stump ? 1 : 0, level: stump ? key - H.nI : -1, alive: true, phase: stump ? COLLAPSE_PHASE.STUMP : COLLAPSE_PHASE.FREE,
    dirty: 0, frozen: stump, entity, hull, body: hull.body, blocks, nb, joint: null, topple: 0, nudge: 0, bottom: stump ? null : _bottomPoints(A, hull.body),
    f: Float64Array.of(mp.com[0], mp.com[1], mp.com[2], mp.mass, -1, 0, H.fv[0], 0, 0, 0, 0, 0, 0, 0, H.fv[0], -1)
  };
  entity.collapseRec = rec;
  H.cls.push(rec);
  H.entities.push(entity);
  if (stump) { HB.freezeCluster(entity); if (!H.stumpCollide) entity.noHullCollisions = true; }
  H.st[ST_BIRTHS]++;
  if (H.entities.length > H.st[ST_MAX_CLUSTERS]) H.st[ST_MAX_CLUSTERS] = H.entities.length;
  return rec;
}

// CIENKIE PŁYTY a punkty styku. buildClusterDesc daje prostopadłościanowi kule o promieniu do max(najmniejsza półoś,
// ½ środkowej) (R11 — oczko bez przelotu węzła 15 j.), więc przy środkowej półosi > 2 × najmniejsza kula WYSTAJE z bryły
// w najcieńszym wymiarze: kafel stropu 78 × 78 × 13 — o ~13 j. ponad i pod płytę, rdzeń kondygnacji 35 j. — o ~13 j. w
// sąsiedni poziom. Na granicy wyspa / kikut albo dziecko / rodzic to INNY klaster (luz prostopadłościanów to tylko 2 j.),
// a klaster urodzony w przenikaniu dostaje wyrzut (pomiar: wyspa W-1 Δv 113 j/s przy narodzinach, potem rozbita). Opis
// STYKU dostaje więc prostopadłościany bez wystających kul:
//  (1) płyta pozioma (półoś z najmniejsza i < ½ środkowej) rośnie W DÓŁ — w pustą kondygnację pod sobą, do jej podłogi
//      z luzem (wierzch i rzut bez zmian; ściany i rdzeń poziomu leżą poza kaflem); masa bez zmian, środek kafla niżej;
//  (2) prostopadłościan, w którym środkowa półoś > 2 × najmniejsza, dzieli się wzdłuż osi środkowej na równe części
//      (masa po równo — masa, środek masy i tensor bloku bez zmian), aż kule zmieszczą się w grubości.
// Narodziny — alokuje (nowe obiekty prostopadłościanów).
function _contactBoxes(A, boxes, out) {
  const G = STRUCT_BOX_GAP;
  out.length = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b0 = boxes[i];
    let hx = b0.hx, hy = b0.hy, hz = b0.hz, z = b0.z;
    // (1) kafel stropu: w dół do podłogi kondygnacji
    const mid0 = hx + hy + hz - Math.min(hx, hy, hz) - Math.max(hx, hy, hz);
    if (!b0.q && hz === Math.min(hx, hy, hz) && hz < 0.5 * mid0 && A.levelZ && A.level[b0.id] >= 0) {
      const L = A.level[b0.id];
      const floor = L > 0 ? A.levelZ[L - 1] : A.groundZ;
      const top = z + hz;
      const h = Math.min(0.5 * mid0, 0.5 * (top - floor - 2 * G));
      if (h > hz) { z = top - h; hz = h; }
    }
    // (2) podział wzdłuż osi środkowej
    // oś środkowa: indeks (nie równość liczb — suma półosi minus skrajne gubi bit)
    const iMin = hx <= hy && hx <= hz ? 0 : (hy <= hz ? 1 : 2), iMax = hx > hy && hx > hz ? 0 : (hy > hz ? 1 : 2);
    const ax0 = iMin !== 0 && iMax !== 0 ? 0 : (iMin !== 1 && iMax !== 1 ? 1 : 2);
    const mn = iMin === 0 ? hx : (iMin === 1 ? hy : hz), md = ax0 === 0 ? hx : (ax0 === 1 ? hy : hz);
    let k = md > 2 * mn + 1e-9 ? Math.ceil(md / (2 * mn) - 1e-9) : 1;
    if (k > 8) k = 8;
    const ax = k > 1 ? ax0 : -1;
    const yaw = b0.q ? 2 * Math.atan2(b0.q.z, b0.q.w) : 0, c = Math.cos(yaw), s = Math.sin(yaw);
    for (let p = 0; p < k; p++) {
      const off = k > 1 ? md * ((2 * p + 1) / k - 1) : 0;
      const ox = ax === 0 ? off : 0, oy = ax === 1 ? off : 0, oz = ax === 2 ? off : 0;
      out.push({
        x: b0.x + c * ox - s * oy, y: b0.y + s * ox + c * oy, z: z + oz,
        hx: ax === 0 ? hx / k : hx, hy: ax === 1 ? hy / k : hy, hz: ax === 2 ? hz / k : hz,
        mass: b0.mass / k, id: b0.id, q: b0.q
      });
    }
  }
  return out;
}

// Punkty styku dolnych poziomów wyspy (≤ najniższy + 3) — kruszenie kikuta pod przechyłem (_crushUnder). Narodziny.
function _bottomPoints(A, body) {
  const g = body.rg;
  let lmin = 1 << 30;
  for (let i = 0; i < g.n; i++) { const l = A.level[g.blockId[g.blk[i]]]; if (l < lmin) lmin = l; }
  const out = [];
  for (let i = 0; i < g.n; i++) if (A.level[g.blockId[g.blk[i]]] <= lmin + 3) out.push(i);
  return Int32Array.from(out);
}

function _release(H, rec) {
  if (!rec.alive) return;
  rec.alive = false;
  H.HB.release(rec.entity);
  const list = H.entities, e = rec.entity;
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== e) continue;
    list[i] = list[list.length - 1]; list.length--;
    break;
  }
  H.st[ST_RELEASES]++;
}

// Kikut: zamrożony klaster na każdy poziom (bloki części zakotwiczonej z prostopadłościanami).
function _buildStump(H) {
  const A = H.A, S = H.S, list = H.bList;
  for (let L = 0; L < H.NL; L++) {
    let c = 0;
    for (let j = 0; j < H.boxed.length; j++) {
      const b = H.boxed[j];
      if (A.level[b] !== L || S.dead[b] || S.island[b] !== -1) continue;
      list[c++] = b;
    }
    if (!c) continue;
    const rec = _spawn(H, H.nI + L, list, c, null, null);
    if (!rec) continue;
    H.stumpCl[L] = rec.k;
    for (let j = 0; j < c; j++) H.own[list[j]] = rec.k;
  }
  H.iv[1] = S.topoVer;
}

// ── rekordy obrazu ──────────────────────────────────────────────────────────────────────────────────────────────
// Slot w pierścieniu (wyzerowany, typ i czas wpisane); zwraca przesunięcie w buforze.
function _recSlot(H, type) {
  const R = H.rec, o = (R.head % R.cap) * R.stride, buf = R.buf;
  for (let j = 0; j < R.stride; j++) buf[o + j] = 0;
  buf[o] = type; buf[o + 1] = H.fv[0];
  R.head++;
  return o;
}

// Rekord gruzu bloku b z pozą klastra rec (albo pozą postoju).
function _debrisRec(H, b, rec, kind) {
  const o = _recSlot(H, COLLAPSE_REC.DEBRIS), buf = H.rec.buf, A = H.A;
  H.st[ST_DEBRIS]++;
  buf[o + 12] = A.mass[b] * H.massUnit; buf[o + 13] = b; buf[o + 14] = kind;
  if (rec && rec.kind === 0 && rec.body && !rec.body.dead) {
    const bd = rec.body, m = H._m, f = rec.f;
    _rot(bd.quat, m);
    buf[o + 2] = bd.pos.x - (m[0] * f[0] + m[1] * f[1] + m[2] * f[2]);
    buf[o + 3] = bd.pos.y - (m[3] * f[0] + m[4] * f[1] + m[5] * f[2]);
    buf[o + 4] = bd.pos.z - (m[6] * f[0] + m[7] * f[1] + m[8] * f[2]);
    const dx = A.x[b] - f[0], dy = A.y[b] - f[1], dz = A.z[b] - f[2];
    const rx = m[0] * dx + m[1] * dy + m[2] * dz, ry = m[3] * dx + m[4] * dy + m[5] * dz, rz = m[6] * dx + m[7] * dy + m[8] * dz;
    const w = bd.angVel;
    buf[o + 5] = bd.vel.x + w.y * rz - w.z * ry; buf[o + 6] = bd.vel.y + w.z * rx - w.x * rz; buf[o + 7] = bd.vel.z + w.x * ry - w.y * rx;
    buf[o + 8] = bd.quat.x; buf[o + 9] = bd.quat.y; buf[o + 10] = bd.quat.z; buf[o + 11] = bd.quat.w;
  } else {
    buf[o + 2] = H.origin.x; buf[o + 3] = H.origin.y; buf[o + 4] = H.origin.z;
    buf[o + 8] = H.quat0.x; buf[o + 9] = H.quat0.y; buf[o + 10] = H.quat0.z; buf[o + 11] = H.quat0.w;
  }
  // blok dachu w gruz (oś czasu): lądowanie gruzu analitycznie (rzut pionowy z prędkością bloku, g gospodarza)
  if (A.level[b] === H.roofL && H.tv[TL_ROOF] < 0 && !(H.fv[2] > 0) && _roofGone(H)) {
    const m = H._m;
    _rot({ x: buf[o + 8], y: buf[o + 9], z: buf[o + 10], w: buf[o + 11] }, m);
    const px = buf[o + 2] + m[0] * A.x[b] + m[1] * A.y[b] + m[2] * A.z[b];
    const py = buf[o + 3] + m[3] * A.x[b] + m[4] * A.y[b] + m[5] * A.z[b];
    const pz = buf[o + 4] + m[6] * A.x[b] + m[7] * A.y[b] + m[8] * A.z[b];
    const h = Math.max(0, pz - collapseGroundZ(H.ground, px, py) - H.T.roofDebrisHalf), vz = buf[o + 7], g = H.pose[8];
    H.fv[2] = H.fv[0] + (vz + Math.sqrt(vz * vz + 2 * g * h)) / g;
  }
}

// Cały poziom dachu w gruzie (bloki martwe) — tylko wtedy oś czasu bierze lądowanie gruzu dachu.
function _roofGone(H) {
  const rb = H.roofBlocks, S = H.S;
  for (let j = 0; j < rb.length; j++) if (!S.dead[rb[j]]) return false;
  return true;
}

// ── UZGADNIANIE (graf → klastry) ────────────────────────────────────────────────────────────────────────────────
/*
 * Prawdą są S.island / S.dead. Cel bloku: martwy → brak; część zakotwiczona → kikut poziomu; wyspa → klaster wyspy.
 * Cele (klucze, do których przechodzą bloki) w kolejności masy; wybrane w budżecie narodzin (koszt ≈ cel + źródła,
 * z których bierze bloki). Klastry, które tracą bloki (na rzecz wybranych celów albo śmierci), przebudowują się z tym,
 * co im zostaje — bloki celów niewybranych czekają u starego właściciela. Narodziny NAJPIERW (pozy źródeł żyją),
 * zwolnienia potem. POZA GORĄCĄ ŚCIEŻKĄ tylko narodziny (alokacje); pętle po blokach bez alokacji.
 */
function _reconcile(H) {
  const dt = H.fv[3];
  const A = H.A, S = H.S, nI = H.nI, boxed = H.boxed, nb = boxed.length, own = H.own, want = H.want, cls = H.cls;
  const tMark = H.tMark, tList = H.tList, tMass = H.tMass, tCnt = H.tCnt, tChosen = H.tChosen;
  let nT = 0, anyDirty = false;
  for (let j = 0; j < nb; j++) {
    const b = boxed[j];
    const w = S.dead[b] ? -1 : (S.island[b] < 0 ? nI + A.level[b] : S.island[b]);
    want[b] = w;
    const o = own[b], cur = o >= 0 ? cls[o].key : -1;
    if (w === cur) continue;
    if (w >= 0 && !tMark[w]) { tMark[w] = 1; tList[nT++] = w; tMass[w] = 0; tCnt[w] = 0; }
    if (o >= 0) { cls[o].dirty = 1; anyDirty = true; }
  }
  if (!nT && !anyDirty) { H.iv[2] = 0; H.iv[1] = S.topoVer; return; }
  for (let j = 0; j < nb; j++) { const b = boxed[j], w = want[b]; if (w >= 0 && tMark[w]) { tMass[w] += A.mass[b]; tCnt[w]++; } }
  // wyspy z 1 bloku → gruz obrazu: blok ginie w grafie (rekord gruzu przy przebudowie właściciela)
  for (let t = 0; t < nT; t++) {
    const w = tList[t];
    if (w >= nI || tCnt[w] !== 1) continue;
    for (let j = 0; j < nb; j++) {
      const b = boxed[j];
      if (want[b] !== w) continue;
      structureDestroyBlock(S, b, false);
      want[b] = -1;
      break;
    }
    tMark[w] = 0; tCnt[w] = 0;
  }
  // kolejność: masa malejąco, potem klucz (deterministycznie); usuwanie wycofanych celów
  let m = 0;
  for (let t = 0; t < nT; t++) if (tMark[tList[t]]) tList[m++] = tList[t];
  nT = m;
  for (let i = 1; i < nT; i++) {
    const v = tList[i];
    let k = i - 1;
    while (k >= 0 && (tMass[tList[k]] < tMass[v] || (tMass[tList[k]] === tMass[v] && tList[k] > v))) { tList[k + 1] = tList[k]; k--; }
    tList[k + 1] = v;
  }
  // wybór w budżecie narodzin (co najmniej jeden cel na krok)
  const budget = per120(H.T.birthsPer120, dt);
  let cost = 0, chosen = 0, pending = 0;
  const srcMark = H.srcMark && H.srcMark.length >= cls.length ? H.srcMark : (H.srcMark = new Uint8Array(Math.max(64, 2 * cls.length)));
  for (let t = 0; t < nT; t++) {
    const w = tList[t];
    if (chosen > 0 && cost >= budget) { pending++; continue; }
    tChosen[w] = 1; chosen++; cost++;
    for (let j = 0; j < nb; j++) {
      const b = boxed[j];
      if (want[b] !== w) continue;
      const o = own[b];
      if (o >= 0 && !srcMark[o]) { srcMark[o] = 1; cost++; }
    }
  }
  srcMark.fill(0, 0, cls.length);
  // nowy klucz bloku; właściciele tracący bloki → przebudowa
  const newKey = H.newKey;
  for (let j = 0; j < nb; j++) {
    const b = boxed[j], w = want[b], o = own[b];
    const nk = w === -1 ? -1 : (w >= 0 && tMark[w] && tChosen[w] ? w : (o >= 0 ? cls[o].key : -1));
    newKey[b] = nk;
    if (o >= 0 && nk !== cls[o].key) cls[o].dirty = 1;
  }
  // zbiór przebudowy: wybrane cele + klucze brudnych klastrów (bez powtórzeń)
  const list = H.bList, nCls = cls.length, bMark = H.bMark, buildK = H.buildK;
  let nB = 0;
  for (let t = 0; t < nT; t++) { const w = tList[t]; if (tChosen[w] && !bMark[w]) { bMark[w] = 1; buildK[nB++] = w; } }
  for (let k = 0; k < nCls; k++) { const r = cls[k]; if (r.alive && r.dirty && !bMark[r.key]) { bMark[r.key] = 1; buildK[nB++] = r.key; } }
  // narodziny NAJPIERW (pozy źródeł żyją): klucz → nowy rekord (−1 — brak) i stary (−1)
  const madeK = H.madeK, madeNew = H.madeNew, madeOld = H.madeOld;
  for (let i = 0; i < nB; i++) {
    const K = buildK[i];
    bMark[K] = 0;
    let c = 0, heavy = -1;
    for (let j = 0; j < nb; j++) {
      const b = boxed[j];
      if (newKey[b] !== K) continue;
      list[c++] = b;
      if (heavy < 0 || A.mass[b] > A.mass[heavy]) heavy = b;
    }
    const old = _clOfKey(H, K);
    madeK[i] = K; madeNew[i] = -1; madeOld[i] = old ? old.k : -1;
    if (K < nI && c === 1) {
      // klaster wyspy z jednym blokiem → gruz (blok ginie w grafie; rekord gruzu przy zwolnieniu właściciela)
      structureDestroyBlock(S, list[0], false);
      newKey[list[0]] = -1;
      c = 0;
    }
    if (!c) continue;
    const src = old || (own[heavy] >= 0 ? cls[own[heavy]] : null);
    let kick = null;
    if (K < nI && !old && c <= 2 && S.islParent[K] === -1 && (!src || src.kind === 1)) kick = _kick(H, list, c);
    const rec = _spawn(H, K, list, c, src, kick);
    if (!rec) {
      // sufit klastrów → gruz obrazu: bloki giną w grafie (rekordy z pozą starego właściciela)
      for (let j = 0; j < c; j++) {
        const b = list[j], o = own[b];
        _debrisRec(H, b, o >= 0 ? cls[o] : null, 3);
        structureDestroyBlock(S, b, false);
        newKey[b] = -1;
      }
      continue;
    }
    if (kick) H.st[ST_KICKS]++;
    if (old) _inherit(H, old, rec);
    madeNew[i] = rec.k;
  }
  // gruz: bloki martwe u dotychczasowego właściciela (poza z jego ciała — przed zwolnieniem)
  for (let j = 0; j < nb; j++) {
    const b = boxed[j], o = own[b];
    if (o < 0 || newKey[b] !== -1 || !S.dead[b]) continue;
    _debrisRec(H, b, cls[o], S.dead[b] === 2 ? 2 : 1);
  }
  // zwolnienia: stare rekordy przebudowanych kluczy (w tym wszystkie brudne)
  for (let i = 0; i < nB; i++) if (madeOld[i] >= 0) _release(H, cls[madeOld[i]]);
  // mapy i właściciele
  for (let i = 0; i < nB; i++) {
    const K = madeK[i];
    if (K < nI) H.islCl[K] = madeNew[i]; else H.stumpCl[K - nI] = madeNew[i];
  }
  for (let j = 0; j < nb; j++) {
    const b = boxed[j], K = newKey[b];
    if (K === -1) { own[b] = -1; continue; }
    const r = _clOfKey(H, K);
    own[b] = r ? r.k : -1;
  }
  for (let k = 0; k < cls.length; k++) cls[k].dirty = 0;
  for (let t = 0; t < nT; t++) { tMark[tList[t]] = 0; tChosen[tList[t]] = 0; }
  // główna wyspa (oś czasu): pierwsza cięższa niż mainFrac budowli
  for (let i = 0; i < nB; i++) {
    if (madeNew[i] < 0) continue;
    const rec = cls[madeNew[i]];
    if (rec.kind !== 0) continue;
    const main = H.iv[7] >= 0 ? cls[H.iv[7]] : null;
    if (main && main.alive && main.key === rec.key) H.iv[7] = rec.k;
    else if ((!main || !main.alive) && rec.f[3] >= H.T.mainFrac * A.totalMass * H.massUnit) H.iv[7] = rec.k;
  }
  if (H.iv[8] >= 0 && !cls[H.iv[8]].alive) {
    // klaster frontu przebudowany — nowy rekord tego samego klucza
    const old = cls[H.iv[8]], r = _clOfKey(H, old.key);
    H.iv[8] = r && r.phase === COLLAPSE_PHASE.FRONT ? r.k : -1;
  }
  H.iv[2] = pending > 0 ? 1 : 0;
  if (pending) H.st[ST_PENDING_STEPS]++;
  H.iv[1] = S.topoVer;
}

// Kopnięcie małej wyspy oderwanej od budowli: poziomo na zewnątrz rzutu (od osi budowli ku środkowi bloków), 15–40 j/s,
// obrót o losowej osi (PRNG gospodarza). Świat silnika.
function _kick(H, list, c) {
  const A = H.A, rnd = H.rnd, p = H.pose;
  let mx = 0, my = 0, M = 0;
  for (let j = 0; j < c; j++) { const b = list[j]; mx += A.mass[b] * A.x[b]; my += A.mass[b] * A.y[b]; M += A.mass[b]; }
  mx = mx / M - A.centerX; my = my / M - A.centerY;
  let l = Math.sqrt(mx * mx + my * my);
  if (!(l > 1e-6)) { const a = rnd() * 2 * Math.PI; mx = Math.cos(a); my = Math.sin(a); l = 1; }
  mx /= l; my /= l;
  const dx = p[3] * mx - p[4] * my, dy = p[4] * mx + p[3] * my;
  const sp = H.T.kickMin + (H.T.kickMax - H.T.kickMin) * rnd();
  let ax = rnd() * 2 - 1, ay = rnd() * 2 - 1, az = rnd() * 2 - 1;
  const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  const w = H.T.kickSpin * (0.3 + 0.7 * rnd()) / al;
  return [dx * sp, dy * sp, 0, ax * w, ay * w, az * w];
}

// Przebudowa klastra tego samego klucza: faza, przegub (punkt świata i oś ciała z chwili założenia), front, sen.
function _inherit(H, old, rec) {
  rec.phase = old.phase === COLLAPSE_PHASE.STUMP ? rec.phase : old.phase;
  const fo = old.f, fn = rec.f;
  fn[5] = fo[5]; fn[6] = fo[6]; fn[7] = fo[7]; fn[8] = fo[8]; fn[9] = fo[9]; fn[13] = fo[13];
  if (old.topple) _setTopple(H, rec, 1);
  rec.nudge = old.nudge;
  if (old.phase === COLLAPSE_PHASE.HINGE && old.joint && !old.joint.broken) {
    const j = old.joint;
    const nj = H.HB.clusterJoint(rec.entity, j.wx, j.wy, j.wz, { breakTilt: j.breakTilt, up: H.upW, name: j.name });
    if (nj) { nj.ux = j.ux; nj.uy = j.uy; nj.uz = j.uz; nj.tilt = j.tilt; rec.joint = nj; rec.entity.noHullCollisions = true; }
    else rec.phase = COLLAPSE_PHASE.FREE;
  } else if (old.phase === COLLAPSE_PHASE.HINGE) rec.phase = COLLAPSE_PHASE.FREE;
  if (old.phase === COLLAPSE_PHASE.FRONT) {
    // ta sama droga frontu d: baza nowego ciała = pos − (pos_stary − baza_stara)
    const ob = old.body, nb = rec.body;
    fn[10] = nb.pos.x - (ob.pos.x - fo[10]); fn[11] = nb.pos.y - (ob.pos.y - fo[11]); fn[12] = nb.pos.z - (ob.pos.z - fo[12]);
    rec.entity.noHullCollisions = true;
    H.HB.driveCluster(rec.entity, null, null, H._zero, GRAV_OFF);
  }
}

// ── krok ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Przed HullBodies.step: wyspa frontu jedzie za frontem kinematycznie (poza z F.s, prędkość F.v·ĝ, bez grawitacji). */
export function collapsePreStep(H, dt) {
  const k = H.iv[8];
  if (k < 0) return;
  const rec = H.cls[k];
  if (!rec.alive || rec.phase !== COLLAPSE_PHASE.FRONT) return;
  _driveFront(H, rec, false);
}

function _driveFront(H, rec, free) {
  const F = H.S.front, f = rec.f, p = H.pose, P = H._p, V = H._v;
  const d = f[13] - F.s;
  P.x = f[10] + d * p[5]; P.y = f[11] + d * p[6]; P.z = f[12] + d * p[7];
  V.x = F.v * p[5]; V.y = F.v * p[6]; V.z = F.v * p[7];
  if (!free) { H.HB.driveCluster(rec.entity, P, V, H._zero, GRAV_OFF); return; }
  const W = H._w;
  W.x = f[7]; W.y = f[8]; W.z = f[9];
  H.HB.driveCluster(rec.entity, P, V, W, GRAV_ON);
}

/**
 * Krok gospodarza PO HullBodies.step (dt — krok fizyki, tick — całkowity licznik kroków). Kolejność: przeguby (pęknięcie,
 * zastój) → stepStructure → wyspa z kolejki (structureSolveIsland) → zdarzenia (oś czasu, rekordy, semantyka czekająca na
 * klaster) → uzgadnianie (narodziny w budżecie) → semantyka (zawias, front) → koniec frontu → uderzenia wysp (kolejka) →
 * ruiny (zamrożenie) → oś czasu (przechył, dach). Bez alokacji poza narodzinami.
 */
export function collapseStep(H, dt, tick) {
  const S = H.S, A = H.A, T = H.T, cls = H.cls, iv = H.iv, fv = H.fv;
  fv[0] += dt; fv[3] = dt; iv[0] = tick;
  const now = fv[0];
  // 1) przeguby: pęknięcie (silnik — kąt) albo zastój przechyłu
  for (let k = 0; k < cls.length; k++) {
    const r = cls[k];
    if (!r.alive || r.phase !== COLLAPSE_PHASE.HINGE || !r.joint) continue;
    const j = r.joint;
    if (!j.broken) {
      const f = r.f;
      if (j.tilt > f[5] + T.stallDeg * Math.PI / 180) { f[5] = j.tilt; f[6] = now; }
      else if (now - f[6] > T.stallTime * H.slow) {
        // ZASTÓJ: przegub kulisty z drugim podparciem (róg na ziemi / kikucie) trzymałby wyspę bez końca
        j.broken = true; H.st[ST_STALLS]++;
        _jointBroken(H, r, 2);
        continue;
      }
    } else _jointBroken(H, r, 1);
  }
  // 1b) kikut pod przechylaną / prowadzoną frontem wyspą (reguła geometryczna → graf)
  for (let k = 0; k < cls.length; k++) {
    const r = cls[k];
    if (!r.alive || r.kind !== 0) continue;
    if (r.phase === COLLAPSE_PHASE.HINGE || r.phase === COLLAPSE_PHASE.FRONT) _crushUnder(H, r, 0);
    // przewracana wieża (już z parami): kikut, którego dotyka, kruszy się — styk z zamrożonym kikutem pod podstawą
    // rozbijał ją uderzeniami (wyspa swobodna) przy każdym kroku przewracania
    else if (r.topple) _crushUnder(H, r, 1);
  }
  // 2) graf
  stepStructure(S, dt, tick);
  // 3) wyspa z kolejki (jedna na krok; zdarzenia dzieci dopisane do bufora tego kroku — czytane niżej razem)
  _solveQueued(H);
  // 4) zdarzenia
  _events(H, 0, S.evCount);
  // 5) uzgadnianie
  if (S.topoVer !== iv[1] || iv[2]) _reconcile(H);
  // 6) semantyka czekająca na klaster
  if (iv[5]) _applyPending(H);
  // 7) front: koniec (graf) albo najniższy punkt na podłożu
  if (iv[8] >= 0) _frontCheck(H);
  // 8) uderzenia wysp → kolejka; bufory wysp spoza kolejki czyszczone
  _impacts(H);
  // 9) ruiny
  const fz = T.freezeAfter;
  for (let k = 0; k < cls.length; k++) {
    const r = cls[k];
    if (!r.alive || r.kind !== 0 || r.phase !== COLLAPSE_PHASE.FREE) continue;
    const b = r.body;
    if (r.frozen) { if (!b.anchored) r.frozen = false; continue; }
    if (b.isSleeping) {
      if (r.f[4] < 0) r.f[4] = now;
      else if (now - r.f[4] > fz) { H.HB.freezeCluster(r.entity); r.frozen = true; }
    } else r.f[4] = -1;
  }
  // 10) oś czasu
  _timeline(H);
}

// Wyspa z zawiasem albo frontem to oderwanie budowli (oś czasu) i — gdy nie ma innej — wyspa główna (przechył, dach).
function _mainIs(H, r) {
  if (H.tv[TL_DETACH] < 0) H.tv[TL_DETACH] = H.fv[0];
  const m = H.iv[7] >= 0 ? H.cls[H.iv[7]] : null;
  if (!m || !m.alive) H.iv[7] = r.k;
}

function _jointBroken(H, r, mode) {
  const tv = H.tv, b = r.body;
  if (tv[TL_JOINT] < 0 && r.k === H.iv[7]) { tv[TL_JOINT] = H.fv[0]; tv[TL_JOINT_TILT] = r.joint.tilt * 180 / Math.PI; tv[TL_BREAK_MODE] = mode; }
  r.joint = null;
  r.phase = COLLAPSE_PHASE.FREE;
  // D11: przechył, potem zgniot — front z prędkością pionową wyspy i zapamiętanym ω. ZASTÓJ z narożnikiem na podłożu:
  // bez frontu (wieża stoi na narożniku — front zrzucał ją o kondygnację w ziemię i rozwiązanie wyspy rozbijało ją
  // w gruz przed przewróceniem), wyspa wolna przewraca się po narożniku
  const p = H.pose;
  const vDown = b.vel.x * p[5] + b.vel.y * p[6] + b.vel.z * p[7];
  if ((mode === 2 && _lowestAboveGround(H, r) <= H.T.groundEps + H.T.stallGround) ||
    !_startFront(H, r, vDown > 0 ? vDown : 0, b.angVel.x, b.angVel.y, b.angVel.z)) { r.entity.noHullCollisions = false; _toppleClock(H, r); }
}

// Najniższy punkt styku klastra nad podłożem [j.] (pod środkiem klastra).
function _lowestAboveGround(H, r) {
  const b = r.body, g = b.rg, m = H._m;
  _rot(b.quat, m);
  let zmin = Infinity;
  for (let i = 0; i < g.n; i++) {
    const z = b.pos.z + m[6] * g.lx[i] + m[7] * g.ly[i] + m[8] * g.lz[i] - g.r[i];
    if (z < zmin) zmin = z;
  }
  return zmin - collapseGroundZ(H.ground, b.pos.x, b.pos.y);
}

// Zegar zastoju przewracania od tej chwili (f[5] przechył [rad] wyspy, f[6] czas ostatniego przyrostu).
function _toppleClock(H, r) {
  const m = H._m, A = H.A, p = H.pose;
  _rot(r.body.quat, m);
  const ux = -A.gx, uy = -A.gy, uz = -A.gz;
  let c = -((m[0] * ux + m[1] * uy + m[2] * uz) * p[5] + (m[3] * ux + m[4] * uy + m[5] * uz) * p[6] + (m[6] * ux + m[7] * uy + m[8] * uz) * p[7]);
  c = c > 1 ? 1 : (c < -1 ? -1 : c);
  r.f[5] = Math.acos(c); r.f[6] = H.fv[0];
}

// PRZEWRACANIE: wieża (wyspa zawiasu i jej przebudowy) toczy się po narożniku bez tłumienia spoczynku i toczenia silnika
// (restDamping 0 — inaczej przy niskim g przewrócenie trwało dziesiątki sekund); pierwsze rozwiązanie uderzenia z
// zerwaniami albo przechył ponad toppleEndDeg oddaje tłumienie (gruz osiada i zasypia).
function _setTopple(H, r, on) {
  if (r.topple === on) return;
  r.topple = on;
  H.HB.setClusterDamping(r.entity, undefined, on ? 0 : null);
}

// KRUSZENIE KIKUTA pod przechylaną (i prowadzoną frontem) wyspą: punkty styku dolnych poziomów wyspy (r.bottom) w układzie
// postoju budowli wobec prostopadłościanów bloków części zakotwiczonej — blok, w który punkt wchodzi głębiej niż
// crushDepth × promień punktu, ginie zmiażdżony (graf: structureDestroyBlock, gruz przy przebudowie poziomu kikuta).
function _crushUnder(H, r, touch) {
  const depth = touch ? H.T.crushTouch : H.T.crushDepth;
  const S = H.S, A = H.A, g = r.body.rg, b = r.body, m = H._m, p = H.pose, bt = r.bottom;
  if (!bt || !bt.length) return;
  // najwyższy strop części zakotwiczonej (szybkie odrzucenie punktów)
  let topZ = -Infinity;
  const boxed = H.boxed, cand = H.crushCand;
  let nc = 0;
  for (let j = 0; j < boxed.length; j++) {
    const k = boxed[j];
    if (S.dead[k] || S.island[k] !== -1) continue;
    const L = A.level[k];
    const z = L >= 0 ? A.levelZ[L] : A.groundZ;
    if (z > topZ) topZ = z;
    cand[nc++] = k;
  }
  if (!nc) return;
  _rot(b.quat, m);
  const st = A.boxStart, d = A.boxData, W = STRUCT_BOX_STRIDE, mark = H.crushMark;
  let hit = 0;
  for (let t = 0; t < bt.length; t++) {
    const i = bt[t], lx = g.lx[i], ly = g.ly[i], lz = g.lz[i], rr = g.r[i];
    const wx = b.pos.x + m[0] * lx + m[1] * ly + m[2] * lz - p[0], wy = b.pos.y + m[3] * lx + m[4] * ly + m[5] * lz - p[1];
    const z = b.pos.z + m[6] * lx + m[7] * ly + m[8] * lz - p[2];
    if (z - rr > topZ) continue;
    const x = p[3] * wx + p[4] * wy, y = -p[4] * wx + p[3] * wy;
    for (let c = 0; c < nc; c++) {
      const k = cand[c];
      if (mark[k]) continue;
      for (let j = st[k]; j < st[k + 1]; j++) {
        const o = j * W, hz = d[o + 5];
        const dz = z - d[o + 2];
        if (dz > hz + rr || dz < -hz - rr) continue;
        const cs = Math.cos(d[o + 6]), sn = Math.sin(d[o + 6]);
        const ex = x - d[o], ey = y - d[o + 1];
        const qx = cs * ex + sn * ey, qy = -sn * ex + cs * ey;
        const hx = d[o + 3], hy = d[o + 4];
        const cx = qx > hx ? qx - hx : (qx < -hx ? qx + hx : 0), cy = qy > hy ? qy - hy : (qy < -hy ? qy + hy : 0);
        const cz = dz > hz ? dz - hz : (dz < -hz ? dz + hz : 0);
        const dist = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (rr - dist > depth * rr) { mark[k] = 1; hit++; break; }
      }
    }
  }
  if (!hit) return;
  for (let c = 0; c < nc; c++) {
    const k = cand[c];
    if (!mark[k]) continue;
    mark[k] = 0;
    structureDestroyBlock(S, k, true);
    H.st[ST_CRUSHED]++;
  }
}

// Front zgniotu pod wyspą rekordu r (wolną); false — graf odmówił (najniższy poziom 0, inny front w toku).
function _startFront(H, r, v0, wx, wy, wz) {
  const S = H.S, A = H.A;
  if (!H.allowFront || r.key >= H.nI || (S.front.active && H.iv[8] >= 0)) return false;
  // front zgniata KIKUT pod wyspą: kondygnacja tuż pod nią musi należeć do części zakotwiczonej (inna wyspa pod spodem —
  // front przeszedłby przez nią bez oporu, model 1-D zna tylko kikut)
  let lmin0 = 1 << 30;
  for (let j = 0; j < H.boxed.length; j++) { const bb = H.boxed[j]; if (!S.dead[bb] && S.island[bb] === r.key && A.level[bb] < lmin0) lmin0 = A.level[bb]; }
  let below = false;
  for (let j = 0; j < H.boxed.length && !below; j++) { const bb = H.boxed[j]; below = !S.dead[bb] && S.island[bb] === -1 && A.level[bb] === lmin0 - 1; }
  if (!below) return false;
  if (!structureStartFront(S, r.key, v0, H._frontOpts || (H._frontOpts = { kappa: H.kappa, debrisFrac: H.debrisFrac }))) return false;
  const f = r.f, b = r.body;
  f[7] = wx; f[8] = wy; f[9] = wz;
  f[10] = b.pos.x; f[11] = b.pos.y; f[12] = b.pos.z; f[13] = S.front.s;
  r.phase = COLLAPSE_PHASE.FRONT;
  r.entity.noHullCollisions = true;
  H.iv[8] = r.k; H.iv[6] = 0;
  _mainIs(H, r);
  H.st[ST_FRONTS]++;
  if (H.tv[TL_FRONT_START] < 0) H.tv[TL_FRONT_START] = H.fv[0];
  // najniższa kondygnacja wyspy w gruz: model frontu liczy spód wyspy od jej najniższego stropu (levelZ[lmin])
  let lmin = 1 << 30;
  for (let j = 0; j < H.boxed.length; j++) { const bb = H.boxed[j]; if (!S.dead[bb] && S.island[bb] === r.key && A.level[bb] < lmin) lmin = A.level[bb]; }
  for (let j = 0; j < H.boxed.length; j++) {
    const bb = H.boxed[j];
    if (!S.dead[bb] && S.island[bb] === r.key && A.level[bb] === lmin) structureDestroyBlock(S, bb, true);
  }
  H.HB.driveCluster(r.entity, null, null, H._zero, GRAV_OFF);
  return true;
}

function _frontCheck(H) {
  const S = H.S, rec = H.cls[H.iv[8]], F = S.front;
  if (!rec.alive || rec.phase !== COLLAPSE_PHASE.FRONT) { H.iv[8] = -1; return; }
  let kind = 0;
  if (!F.active) kind = F.grounded ? 1 : 2;
  else if ((F.crushing ? F.level - 1 : F.level) >= 0 && !_stumpAt(H, F.crushing ? F.level - 1 : F.level)) {
    kind = 4; F.active = 0;   // następna kondygnacja pod frontem nie należy do kikuta (oderwała się jako inna wyspa)
  }
  else {
    // najniższy punkt wyspy (z kroku prowadzenia: poza z F.s) wobec podłoża
    const b = rec.body, g = b.rg, m = H._m;
    _rot(b.quat, m);
    const d = rec.f[13] - F.s, p = H.pose;
    const px = rec.f[10] + d * p[5], py = rec.f[11] + d * p[6], pz = rec.f[12] + d * p[7];
    let zmin = Infinity;
    for (let i = 0; i < g.n; i++) {
      const z = pz + m[6] * g.lx[i] + m[7] * g.ly[i] + m[8] * g.lz[i] - g.r[i];
      if (z < zmin) zmin = z;
    }
    const gr = H.gr, gdx = px - gr[1], gdy = py - gr[2], gh = gr[4] * gr[4] - gdx * gdx - gdy * gdy;
    if (zmin <= (gr[0] ? gr[5] : gr[3] + (gh > 0 ? Math.sqrt(gh) : 0)) + H.T.groundEps) { kind = 3; F.active = 0; }
  }
  if (!kind) return;
  // wyspa wolna: poza z F.s, v = F.v·ĝ, ω przywrócone, grawitacja i pary
  _driveFront(H, rec, true);
  rec.phase = COLLAPSE_PHASE.FREE;
  rec.entity.noHullCollisions = false;
  _toppleClock(H, rec);
  H.iv[8] = -1;
  if (rec.k === H.iv[7] || H.tv[TL_FRONT_END] < 0) { H.tv[TL_FRONT_END] = H.fv[0]; H.tv[TL_FRONT_END_KIND] = kind; }
}

// Poziom L ma żywe bloki części zakotwiczonej (kikut).
function _stumpAt(H, L) {
  const S = H.S, A = H.A, bx = H.boxed;
  for (let j = 0; j < bx.length; j++) { const b = bx[j]; if (A.level[b] === L && !S.dead[b] && S.island[b] === -1) return true; }
  return false;
}

// Zdarzenia grafu [e0, e1): oś czasu, rekordy, semantyka wysp (flagi czekają na klaster).
function _events(H, e0, e1) {
  const S = H.S, A = H.A, ev = S.ev, W = STRUCT_EV_STRIDE, tv = H.tv, p = H.pose, buf = H.rec.buf;
  for (let j = e0; j < e1; j++) {
    const o = j * W, type = ev[o];
    if (type === STRUCT_EV.ISLAND) {
      const id = ev[o + 2] | 0, nb = ev[o + 3], mass = ev[o + 13], parent = ev[o + 14];
      if (parent === -1 && mass >= H.T.mainFrac * A.totalMass && tv[TL_DETACH] < 0) tv[TL_DETACH] = ev[o + 1];
      if (ev[o + 15] === 1 && nb > 3 && parent === -1) _pend(H, id, 2);
    } else if (type === STRUCT_EV.HINGE && H.allowHinge) {
      const id = ev[o + 2] | 0, d = id * 8, hd = H.hingeData;
      hd[d] = ev[o + 4]; hd[d + 1] = ev[o + 5]; hd[d + 2] = ev[o + 6];
      hd[d + 3] = ev[o + 10]; hd[d + 4] = ev[o + 11]; hd[d + 5] = ev[o + 12]; hd[d + 6] = ev[o + 14];
      _pend(H, id, 1);
      if (tv[TL_HINGE] < 0 && ev[o + 15] >= H.T.mainFrac * A.totalMass) tv[TL_HINGE] = ev[o + 1];
    } else if (type === STRUCT_EV.FRONT) {
      const L = ev[o + 2] | 0;
      const r = _recSlot(H, COLLAPSE_REC.RING);
      const lx = A.centerX, ly = A.centerY;
      buf[r + 2] = p[0] + p[3] * lx - p[4] * ly; buf[r + 3] = p[1] + p[4] * lx + p[3] * ly; buf[r + 4] = p[2] + A.levelZ[L];
      buf[r + 5] = ev[o + 13] * p[5]; buf[r + 6] = ev[o + 13] * p[6]; buf[r + 7] = ev[o + 13] * p[7];
      buf[r + 11] = 1; buf[r + 12] = ev[o + 14] * H.massUnit; buf[r + 13] = L; buf[r + 14] = A.footR;
      H.st[ST_FRONT_LEVELS]++;
      const nf = H.iv[10];
      if (nf < FRONT_CAP) { H.front[2 * nf] = ev[o + 1]; H.front[2 * nf + 1] = L; H.iv[10] = nf + 1; }
    } else if (type === STRUCT_EV.FRONT_GROUND || type === STRUCT_EV.FRONT_STOP) {
      H.iv[6] = type === STRUCT_EV.FRONT_GROUND ? 1 : 2;
    } else if (type === STRUCT_EV.SUPPORT_FAIL) {
      const b = ev[o + 2] | 0;
      const r = _recSlot(H, COLLAPSE_REC.CRACK);
      buf[r + 2] = p[0] + p[3] * A.x[b] - p[4] * A.y[b]; buf[r + 3] = p[1] + p[4] * A.x[b] + p[3] * A.y[b]; buf[r + 4] = p[2] + A.z[b];
      buf[r + 11] = 1; buf[r + 13] = b;
    } else if (type === STRUCT_EV.OVERFLOW) H.st[ST_OVERFLOW] += ev[o + 3];
  }
}

function _pend(H, id, flag) {
  if (!H.pend[id]) H.pendList[H.iv[5]++] = id;
  H.pend[id] |= flag;
}

// Semantyka wysp, które mają już klaster: HINGE → przegub + kopnięcie, spadek pionowy → front.
function _applyPending(H) {
  const S = H.S, list = H.pendList, pend = H.pend;
  let w = 0;
  for (let i = 0; i < H.iv[5]; i++) {
    const id = list[i];
    const r = _clOfKey(H, id);
    const alive = !S.islRetired[id];
    if (!r) { if (alive && H.iv[2]) list[w++] = id; else pend[id] = 0; continue; }   // czeka na narodziny
    const fl = pend[id];
    pend[id] = 0;
    if (r.phase !== COLLAPSE_PHASE.FREE) continue;
    if (fl & 1) _hinge(H, r, id);
    else if (fl & 2) _startFront(H, r, 0, 0, 0, 0);
  }
  H.iv[5] = w;
}

function _hinge(H, r, id) {
  const hd = H.hingeData, d = id * 8, p = H.pose, P = H._t;
  // punkt i oś zawiasu → świat (oś obrócona yaw)
  const lx = hd[d], ly = hd[d + 1], lz = hd[d + 2];
  P[0] = p[0] + p[3] * lx - p[4] * ly; P[1] = p[1] + p[4] * lx + p[3] * ly; P[2] = p[2] + lz;
  const ax = p[3] * hd[d + 3] - p[4] * hd[d + 4], ay = p[4] * hd[d + 3] + p[3] * hd[d + 4], az = hd[d + 5];
  const j = H.HB.clusterJoint(r.entity, P[0], P[1], P[2], { breakTilt: hd[d + 6] * Math.PI / 180, up: H.upW, name: 'zawias' });
  if (!j) return;
  r.joint = j;
  r.phase = COLLAPSE_PHASE.HINGE;
  _mainIs(H, r);
  r.f[5] = 0; r.f[6] = H.fv[0];
  H.st[ST_JOINTS]++;
  // przechył bez par z kikutem: kikut pod krawędzią kruszy reguła geometryczna (_crushUnder → graf), nie styk —
  // styk z zamrożonym kikutem dawał zakleszczenie i tempo zależne od tłumienia spoczynku silnika (pomiar w Node, krok 3)
  r.entity.noHullCollisions = true;
  _setTopple(H, r, 1);
  const W = H._w, k = H.T.hingeKick;
  W.x = ax * k; W.y = ay * k; W.z = az * k;
  H.HB.driveCluster(r.entity, null, null, W, GRAV_ON);
}

// ── impulsy styku ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Styk klastra gospodarza (rozdzielacz HullBodies → H.onClusterContact; świat GRY: y w dół). Impuls do układu
 * archetypu (R klastraᵀ, y odbite) i jednostki grafu (/ massUnit): blok części zakotwiczonej → structureAddImpulse,
 * blok wyspy → bufor gospodarza (uderzenie — kolejka rozwiązań w collapseStep). Bez alokacji.
 */
export function collapseContact(H, entity, blk, jx, jy, jz, x, y, z) {
  const S = H.S, rec = entity ? entity.collapseRec : null;
  if (!rec || blk < 0 || blk >= H.n || S.dead[blk]) return;
  const b = rec.body, m = H._m;
  _rot(b.quat, m);
  const u = 1 / H.massUnit, Jx = jx * u, Jy = -jy * u, Jz = jz * u;
  // Rᵀ·J
  const lx = m[0] * Jx + m[3] * Jy + m[6] * Jz, ly = m[1] * Jx + m[4] * Jy + m[7] * Jz, lz = m[2] * Jx + m[5] * Jy + m[8] * Jz;
  const id = S.island[blk];
  if (id < 0) { if (!H.A.anchor[blk]) structureAddImpulse(S, blk, lx, ly, lz); return; }
  if (!H.islT[id]) { H.islT[id] = 1; H.tIsl[H.iv[13]++] = id; H.islJ[id] = 0; }
  H.islJ[id] += Math.sqrt(lx * lx + ly * ly + lz * lz);
  // WYSPA: impuls na bloki przy punkcie styku (łata styku obejmuje kilka bloków; hak podaje jeden blok na parę i krok —
  // cały impuls w jednym bloku rozbijał wyspę w drobny gruz przy każdym uderzeniu). Wagi 1 − d / contactR po blokach
  // wyspy w klastrze; bez bloków w promieniu — blok z haka.
  const A = H.A, f = rec.f, R = H.T.contactR;
  const px = x - b.pos.x, py = -y - b.pos.y, pz = z - b.pos.z;
  const cx = m[0] * px + m[3] * py + m[6] * pz + f[0], cy = m[1] * px + m[4] * py + m[7] * pz + f[1], cz = m[2] * px + m[5] * py + m[8] * pz + f[2];
  let ws = 0;
  const bl = rec.blocks;
  for (let j = 0; j < rec.nb; j++) {
    const k = bl[j];
    if (S.dead[k] || S.island[k] !== id) continue;
    const dx = A.x[k] - cx, dy = A.y[k] - cy, dz = A.z[k] - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < R) ws += 1 - d / R;
  }
  const bj = H.bj;
  if (!(ws > 0)) {
    const o = 3 * blk;
    bj[o] += lx; bj[o + 1] += ly; bj[o + 2] += lz;
    if (!H.blkT[blk]) { H.blkT[blk] = 1; H.tBlk[H.iv[12]++] = blk; }
    return;
  }
  const inv = 1 / ws;
  for (let j = 0; j < rec.nb; j++) {
    const k = bl[j];
    if (S.dead[k] || S.island[k] !== id) continue;
    const dx = A.x[k] - cx, dy = A.y[k] - cy, dz = A.z[k] - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(d < R)) continue;
    const w = (1 - d / R) * inv, o = 3 * k;
    bj[o] += lx * w; bj[o + 1] += ly * w; bj[o + 2] += lz * w;
    if (!H.blkT[k]) { H.blkT[k] = 1; H.tBlk[H.iv[12]++] = k; }
  }
}

// Uderzenia wysp w kroku → kolejka (FIFO); bufory bloków wysp spoza kolejki czyszczone (spoczynek się nie zbiera).
function _impacts(H) {
  const S = H.S, iv = H.iv, dv = H.T.impactDv;
  for (let i = 0; i < iv[13]; i++) {
    const id = H.tIsl[i];
    H.islT[id] = 0;
    if (H.inQ[id]) continue;
    const r = _clOfKey(H, id);
    // wyspa na zawiasie / we froncie: róg na podłożu to podparcie (zastój łamie przegub), nie uderzenie — rozwiązanie wyspy
    // swobodnej nie zna reakcji przegubu i rozbijało wieżę w gruz przy pierwszym dotknięciu ziemi
    if (r && (r.phase === COLLAPSE_PHASE.HINGE || r.phase === COLLAPSE_PHASE.FRONT)) continue;
    const M = r ? r.f[3] / H.massUnit : S.islMass[id];
    if (!(M > 0)) continue;
    let stat = 0;
    if (H.islJ[id] / M <= dv) {
      // NACISK przewracanej wieży (wolna, topple): obciążenie styku zbierane przez staticEvery s idzie do grafu wyspy
      // jako siła średnia — narożnik, na którym stoi cała wieża, kruszy się (nośność bloku, nie uderzenie), wieża
      // osiada na nim i przewraca się dalej; bez tego przy niskim g stała oparta o narożnik bez końca
      // (zawsze przy staticEvery skończonym; domyślnie dopiero, gdy pchnięcia nie ruszyły wieży z narożnika — wieża
      // oparta narożnikiem przy przechyle < ~20° stoi stabilnie, póki narożnik się nie skruszy)
      if (!r || !r.topple || r.phase !== COLLAPSE_PHASE.FREE) continue;
      const every = r.nudge >= H.T.toppleNudges ? Math.min(H.T.staticEvery, H.T.stuckStaticEvery) : H.T.staticEvery;
      if (!(every < Infinity)) continue;
      const f = r.f;
      if (f[15] < 0) { f[15] = H.fv[0]; H.islAcc[id] = 1; continue; }
      if (H.fv[0] - f[15] < every) { H.islAcc[id] = 1; continue; }
      stat = 1;
    }
    if (H.dbg) H.dbg(stat ? 'nacisk' : 'uderzenie', id, H.islJ[id] / M, r ? r.nb : -1);
    H.inQ[id] = 1; H.qCalls[id] = 0; H.qStatic[id] = stat;
    H.q[(iv[3] + iv[4]) % H.nI] = id; iv[4]++;
    H.st[ST_QUEUED]++;
    if (r && !stat) {
      const o = _recSlot(H, COLLAPSE_REC.DUST), buf = H.rec.buf, b = r.body;
      buf[o + 2] = b.pos.x; buf[o + 3] = b.pos.y; buf[o + 4] = b.pos.z;
      buf[o + 5] = b.vel.x; buf[o + 6] = b.vel.y; buf[o + 7] = b.vel.z; buf[o + 11] = 1;
      buf[o + 12] = H.islJ[id] * H.massUnit; buf[o + 13] = r.nb;
    }
  }
  iv[13] = 0;
  for (let i = 0; i < iv[12]; i++) {
    const b = H.tBlk[i];
    const id = S.island[b];
    if (id >= 0 && (H.inQ[id] || H.islAcc[id])) continue;   // czeka w kolejce albo zbiera nacisk — bufor zostaje
    H.blkT[b] = 0;
    H.bj[3 * b] = 0; H.bj[3 * b + 1] = 0; H.bj[3 * b + 2] = 0;
  }
  // zostają tylko bloki wysp w kolejce
  let w = 0;
  for (let i = 0; i < iv[12]; i++) { const b = H.tBlk[i]; if (H.blkT[b]) { H.tBlk[w++] = b; const id = S.island[b]; if (id >= 0) H.islAcc[id] = 0; } }
  iv[12] = w;
}

// Jedna wyspa z kolejki: bufor → structureAddImpulse → structureSolveIsland (iteracje ∝ dt), aż wynik ≥ 0.
function _solveQueued(H) {
  const dt = H.fv[3];
  const S = H.S, iv = H.iv, n = H.n;
  while (iv[4] > 0) {
    const id = H.q[iv[3]];
    let alive = false;
    if (!S.islRetired[id]) for (let b = 0; b < n; b++) if (!S.dead[b] && S.island[b] === id) { alive = true; break; }
    if (!alive || H.qCalls[id] >= H.T.islandMaxCalls) {
      if (alive) H.st[ST_SOLVE_DROP]++;
      _dequeue(H, id);
      continue;
    }
    // uderzenie: impuls × impactScale (siła J / pulseT w grafie); nacisk: siła średnia okna zbierania (bez skali)
    const stat = H.qStatic[id] === 1, rc = stat ? _clOfKey(H, id) : null;
    const win = stat && rc ? Math.max(dt, H.fv[0] - rc.f[15]) : 0;
    const sc = stat ? 1 / win : H.T.impactScale;
    if (rc) rc.f[15] = -1;
    for (let b = 0; b < n; b++) {
      if (S.island[b] !== id || S.dead[b]) continue;
      const o = 3 * b;
      if (H.bj[o] === 0 && H.bj[o + 1] === 0 && H.bj[o + 2] === 0) continue;
      if (stat) structureAddLoad(S, b, H.bj[o] * sc, H.bj[o + 1] * sc, H.bj[o + 2] * sc);
      else {
        structureAddImpulse(S, b, H.bj[o] * sc, H.bj[o + 1] * sc, H.bj[o + 2] * sc);
        H.st[ST_SOLVED_J] += Math.sqrt(H.bj[o] * H.bj[o] + H.bj[o + 1] * H.bj[o + 1] + H.bj[o + 2] * H.bj[o + 2]) * sc;
      }
      H.bj[o] = 0; H.bj[o + 1] = 0; H.bj[o + 2] = 0;
    }
    H.qStatic[id] = 0;
    H.qCalls[id]++;
    H.st[ST_SOLVES]++;
    const res = structureSolveIsland(S, id, Math.max(1, Math.round(H.T.islandIters120 * dt * 120)));
    if (H.dbg) H.dbg('rozwiazanie', id, res, H.qCalls[id]);
    if (res >= 0) {
      H.st[ST_SOLVE_OK]++;
      _dequeue(H, id);
    }
    return;
  }
}

// Zdejmuje głowę kolejki (wyspa id). Bufor jej bloków wyczyści najbliższe _impacts.
function _dequeue(H, id) {
  const iv = H.iv;
  H.inQ[id] = 0;
  iv[3] = (iv[3] + 1) % H.nI; iv[4]--;
}

// ── oś czasu ────────────────────────────────────────────────────────────────────────────────────────────────────
function _timeline(H) {
  const now = H.fv[0];
  const tv = H.tv, iv = H.iv, cls = H.cls, p = H.pose;
  const main = iv[7] >= 0 ? cls[iv[7]] : null;
  if (main && main.alive) {
    // oś „w górę” archetypu (−ĝ lokalne, H.upL) obrócona kwaternionem klastra wobec −ĝ świata
    const q = main.body.quat, x = q.x, y = q.y, z = q.z, w = q.w, u = H.upL, ux = u[0], uy = u[1], uz = u[2];
    const wx = (1 - 2 * (y * y + z * z)) * ux + 2 * (x * y - w * z) * uy + 2 * (x * z + w * y) * uz;
    const wy = 2 * (x * y + w * z) * ux + (1 - 2 * (x * x + z * z)) * uy + 2 * (y * z - w * x) * uz;
    const wz = 2 * (x * z - w * y) * ux + 2 * (y * z + w * x) * uy + (1 - 2 * (x * x + y * y)) * uz;
    let c = -(wx * p[5] + wy * p[6] + wz * p[7]);
    c = c > 1 ? 1 : (c < -1 ? -1 : c);
    // przechył kwaternionu postoju (yaw) wokół ĝ nie zmienia osi — kąt od pionu
    const tilt = Math.acos(c) * 180 / Math.PI;
    if (tilt > tv[TL_MAX_TILT]) tv[TL_MAX_TILT] = tilt;
    if (tilt >= 40 && tv[TL_TILT40] < 0) tv[TL_TILT40] = now;
    // koniec przewracania: wieża leży (przechył ≥ toppleEndDeg) albo przechył stoi stallTime s (oparła się o gruz)
    if (main.topple && main.phase === COLLAPSE_PHASE.FREE) {
      const f = main.f, tr = tilt * Math.PI / 180;
      if (tr > f[5] + H.T.stallDeg * Math.PI / 180) { f[5] = tr; f[6] = now; }
      if (tilt >= H.T.toppleEndDeg) _setTopple(H, main, 0);
      else if (main.body.isSleeping || now - f[6] > H.T.toppleStallTime * H.slow) {
        // wieża w równowadze chwiejnej na narożniku (przy niskim g ruch spada pod próg snu silnika): pchnięcie ω w stronę
        // przechyłu, najwyżej toppleNudges razy — potem koniec (naprawdę oparta o gruz)
        if (main.nudge < H.T.toppleNudges + H.T.stuckStalls && tilt > 1) {
          main.nudge++;
          const ax = p[6] * wz - p[7] * wy, ay = p[7] * wx - p[5] * wz, az = p[5] * wy - p[6] * wx;   // (−ĝ) × oś w górę … znak niżej
          const al = Math.sqrt(ax * ax + ay * ay + az * az), k = al > 1e-9 ? -H.T.hingeKick / al : 0, W = H._w;
          W.x = ax * k; W.y = ay * k; W.z = az * k;
          H.HB.driveCluster(main.entity, null, null, W, GRAV_ON);
          f[6] = now;
        } else _setTopple(H, main, 0);
      }
    }
    if (now >= H.fv[1] && iv[9] < TILT_CAP) {
      H.tilt[2 * iv[9]] = now; H.tilt[2 * iv[9] + 1] = tilt; iv[9]++;
      H.fv[1] = now + H.T.tiltSampleDt;
    }
  }
  if (tv[TL_ROOF] < 0 && H.fv[2] > 0 && now >= H.fv[2]) { tv[TL_ROOF] = H.fv[2]; tv[TL_ROOF_DEBRIS] = 1; }
  // dach na ziemi: narożnik któregoś bloku poziomu dachu w klastrze-wyspie na podłożu
  if (tv[TL_ROOF] < 0 && H.roofL >= 0) {
    const rb = H.roofBlocks;
    for (let j = 0; j < rb.length; j++) {
      const o = H.own[rb[j]];
      const r = o >= 0 ? cls[o] : null;
      if (!r || !r.alive || r.kind !== 0) continue;
      _blockLowest(H, r, rb[j]);
      if (H._t[0] <= H.T.roofEps) { tv[TL_ROOF] = now; break; }
    }
  }
}

// Najniższy narożnik prostopadłościanów bloku b w klastrze r — wysokość nad podłożem (pod narożnikiem) → H._t[0].
function _blockLowest(H, r, b) {
  const A = H.A, bd = r.body, m = H._m, f = r.f, st = A.boxStart, d = A.boxData, W = STRUCT_BOX_STRIDE, gr = H.gr;
  _rot(bd.quat, m);
  let best = Infinity;
  for (let j = st[b]; j < st[b + 1]; j++) {
    const o = j * W, cx = d[o] - f[0], cy = d[o + 1] - f[1], cz = d[o + 2] - f[2], c = Math.cos(d[o + 6]), s = Math.sin(d[o + 6]);
    for (let k = 0; k < 8; k++) {
      const ex = (k & 1 ? 1 : -1) * d[o + 3], ey = (k & 2 ? 1 : -1) * d[o + 4], ez = (k & 4 ? 1 : -1) * d[o + 5];
      const lx = cx + c * ex - s * ey, ly = cy + s * ex + c * ey, lz = cz + ez;
      const x = bd.pos.x + m[0] * lx + m[1] * ly + m[2] * lz, y = bd.pos.y + m[3] * lx + m[4] * ly + m[5] * lz;
      const z = bd.pos.z + m[6] * lx + m[7] * ly + m[8] * lz;
      const gdx = x - gr[1], gdy = y - gr[2], gh = gr[4] * gr[4] - gdx * gdx - gdy * gdy;
      const h = z - (gr[0] ? gr[5] : gr[3] + (gh > 0 ? Math.sqrt(gh) : 0));
      if (h < best) best = h;
    }
  }
  H._t[0] = best;
}

// ── API obciążeń ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Trafienie bronią w punkt (x, y, z) świata silnika, kierunek lotu (dx, dy, dz): krater (structureDamageSphere — promień
 * i spadek zdrowia z broni) + fala w konstrukcji (structureHit, J broni × g/400) + rekord odprysku. `weapon` — klucz
 * COLLAPSE_WEAPONS albo obiekt { r, amount, J, radius, i }. Zwraca liczbę osłabionych wiązań (fala).
 */
export function collapseWeaponHit(H, x, y, z, dx, dy, dz, weapon) {
  const w = typeof weapon === 'string' ? COLLAPSE_WEAPONS[weapon] : weapon;
  if (!w) return 0;
  const p = H.pose, ex = x - p[0], ey = y - p[1];
  const lx = p[3] * ex + p[4] * ey, ly = -p[4] * ex + p[3] * ey, lz = z - p[2];
  const ldx = p[3] * dx + p[4] * dy, ldy = -p[4] * dx + p[3] * dy;
  const S = H.S;
  if (w.r > 0 && w.amount > 0) structureDamageSphere(S, lx, ly, lz, w.r, w.amount);
  const J = (w.J || 0) * p[8] / 400;
  const ho = H._hitO;
  ho.radius = w.radius > 0 ? w.radius : 120;
  const cnt = J > 0 ? structureHit(S, lx, ly, lz, J, ldx, ldy, dz, ho) : 0;
  const o = _recSlot(H, COLLAPSE_REC.CHIP), buf = H.rec.buf;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  buf[o + 2] = x; buf[o + 3] = y; buf[o + 4] = z; buf[o + 5] = dx / dl; buf[o + 6] = dy / dl; buf[o + 7] = dz / dl;
  buf[o + 11] = 1; buf[o + 12] = J * H.massUnit; buf[o + 13] = w.i | 0;
  return cnt;
}

/** Ładunek kondygnacji (scena 3, narzędzia): zdrowie wiązań kondygnacji `storey` −amount (wszystkich albo z filtrem
 *  `side` {x, y} w układzie archetypu — tylko po tej stronie środka). Zwraca liczbę wiązań. */
export function collapseCharge(H, storey, amount, side = null) {
  const A = H.A, S = H.S;
  if (!(storey >= 0 && storey < A.nStoreys)) return 0;
  let c = 0;
  for (let j = A.storeyStart[storey]; j < A.storeyStart[storey + 1]; j++) {
    const k = A.storeyBonds[j];
    if (side && (A.cx[k] - A.centerX) * side.x + (A.cy[k] - A.centerY) * side.y <= 0) continue;
    structureDamageBond(S, k, amount);
    c++;
  }
  return c;
}

/** D13: zniszczony pomost — kotwice SECTION po stronie `side` {x, y} (układ archetypu) puszczają. Zwraca ich liczbę. */
export function collapseReleaseAnchor(H, side) {
  const A = H.A, S = H.S;
  let c = 0;
  for (let b = 0; b < A.n; b++) {
    if (A.anchor[b] !== 3 || !S.anchorOn[b]) continue;
    if ((A.x[b] - A.centerX) * side.x + (A.y[b] - A.centerY) * side.y <= 0.3 * A.footR) continue;
    structureReleaseAnchor(S, b);
    c++;
  }
  return c;
}

// ── odczyty ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Pierścień rekordów obrazu { buf, cap, stride, head } — czytelnik trzyma własny kursor (head rośnie bez końca). */
export function collapseRecords(H) { return H.rec; }

/**
 * Oś czasu (nowy obiekt — HUD, narzędzia; czasy [s] od startu gospodarza, −1 — nie było): detach (oderwanie wyspy
 * ≥ mainFrac budowli), hinge, jointBroken + jointTilt [°] + breakMode ('kat' / 'zastoj'), tilt40, maxTilt [°], frontStart,
 * frontLevels [{ t, level }], frontEnd + frontEndKind ('ziemia' / 'stop' / 'podloze' / 'wyspa' — pod frontem oderwała
 * się inna wyspa), roofGround (+ roofAsDebris — cały poziom dachu w gruzie, lądowanie analityczne), tilt [[t, °]].
 */
export function collapseTimeline(H) {
  const tv = H.tv, iv = H.iv;
  const frontLevels = [], tilt = [];
  for (let i = 0; i < iv[10]; i++) frontLevels.push({ t: H.front[2 * i], level: H.front[2 * i + 1] });
  for (let i = 0; i < iv[9]; i++) tilt.push([H.tilt[2 * i], H.tilt[2 * i + 1]]);
  return {
    detach: tv[TL_DETACH], hinge: tv[TL_HINGE], jointBroken: tv[TL_JOINT], jointTilt: tv[TL_JOINT_TILT],
    breakMode: ['', 'kat', 'zastoj'][tv[TL_BREAK_MODE]] || '', tilt40: tv[TL_TILT40], maxTilt: tv[TL_MAX_TILT],
    frontStart: tv[TL_FRONT_START], frontLevels, frontEnd: tv[TL_FRONT_END],
    frontEndKind: ['', 'ziemia', 'stop', 'podloze', 'wyspa'][tv[TL_FRONT_END_KIND]] || '', roofGround: tv[TL_ROOF],
    roofAsDebris: tv[TL_ROOF_DEBRIS] === 1, tilt
  };
}

/** Liczniki gospodarza (nowy obiekt): narodziny, zwolnienia, gruz, rozwiązania wysp, kolejka, kopnięcia, … */
export function collapseStats(H) {
  const s = H.st;
  let alive = 0, awake = 0, frozen = 0, sleeping = 0;
  for (const r of H.cls) {
    if (!r.alive) continue;
    alive++;
    const b = r.body;
    if (b.anchored) frozen++; else if (b.isSleeping) sleeping++; else awake++;
  }
  return {
    clusters: alive, awake, sleeping, frozen, births: s[ST_BIRTHS], releases: s[ST_RELEASES], debris: s[ST_DEBRIS],
    solves: s[ST_SOLVES], solveOk: s[ST_SOLVE_OK], solveDropped: s[ST_SOLVE_DROP], queued: s[ST_QUEUED], queue: H.iv[4],
    kicks: s[ST_KICKS], frontLevels: s[ST_FRONT_LEVELS], clusterCap: s[ST_NULL], pendingSteps: s[ST_PENDING_STEPS],
    maxClusters: s[ST_MAX_CLUSTERS], joints: s[ST_JOINTS], fronts: s[ST_FRONTS], overflow: s[ST_OVERFLOW], stalls: s[ST_STALLS], crushed: s[ST_CRUSHED],
    solvedImpulse: s[ST_SOLVED_J],
    records: H.rec.head
  };
}

/**
 * Sonda podłoża (testy, narzędzia): najgłębsze wejście punktu styku klastra pod podłoże w promieniach punktu
 * (0 — nic pod podłożem) i liczba żywych klastrów. `out` — obiekt do ponownego użycia.
 */
export function collapseProbe(H, out = { depth: 0, clusters: 0 }) {
  let worst = 0, c = 0;
  const m = H._m;
  for (let k = 0; k < H.cls.length; k++) {
    const r = H.cls[k];
    if (!r.alive) continue;
    c++;
    const b = r.body, g = b.rg;
    _rot(b.quat, m);
    for (let i = 0; i < g.n; i++) {
      const x = b.pos.x + m[0] * g.lx[i] + m[1] * g.ly[i] + m[2] * g.lz[i];
      const y = b.pos.y + m[3] * g.lx[i] + m[4] * g.ly[i] + m[5] * g.lz[i];
      const z = b.pos.z + m[6] * g.lx[i] + m[7] * g.ly[i] + m[8] * g.lz[i];
      const depth = (collapseGroundZ(H.ground, x, y) - (z - g.r[i])) / g.r[i];
      if (depth > worst) worst = depth;
    }
  }
  out.depth = worst; out.clusters = c;
  return out;
}

/** Koniec gospodarza: wszystkie klastry zwolnione (HullBodies.release), lista encji pusta. */
export function collapseDispose(H) {
  for (const r of H.cls) if (r.alive) _release(H, r);
  H.cls.length = 0;
  H.entities.length = 0;
  H.own.fill(-1); H.islCl.fill(-1); H.stumpCl.fill(-1);
  H.iv[7] = -1; H.iv[8] = -1;
}

/** Od nowa (demo „R”, pętla pokazu): klastry zwolnione, graf nienaruszony, kikut od nowa, oś czasu i rekordy wyzerowane. */
export function collapseReset(H) {
  for (const r of H.cls) if (r.alive) _release(H, r);
  H.cls.length = 0;
  H.entities.length = 0;
  structureReset(H.S);
  _resetState(H);
  _buildStump(H);
}
