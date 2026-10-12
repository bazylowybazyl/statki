// Kernele WGSL fizyki belek (tryb płaski) — port destructorBeams3D.js na compute.
//
// Model ten sam co na CPU: ciało sztywne (pozycja, prędkość, kąt) niesie ruch całości,
// węzły w układzie ciała odkształcają się przez PBD na belkach. Różnice wynikające z GPU:
//  - Gauss-Seidel z kolorowaniem krawędzi (belki jednego koloru nie dzielą węzłów),
//  - PEŁNY solver (cfg.localSolver = false) albo LOKALNY (port _solveLocal: obszar w ruchu A ∪ F z pierścieniem,
//    reszta kadłuba sztywna — sekcja „solver lokalny” niżej; świat wybiera tryb z rozmiaru sceny),
//  - kontakty z jednej siatki świata dla wszystkich ciał (bez siatek per para),
//  - sumy kontaktów w stałym przecinku (deterministycznie, niezależnie od kolejności wątków),
//  - rozpady (wyspy, mosty) liczy CPU z odczytu flag, GPU tylko przenosi węzły między ciałami.
//
// Nazwy buforów → typy WGSL w BUFFERS; każdy kernel deklaruje listę wiązań, z której powstają
// i deklaracje w shaderze, i układ bind groupy (gpuWorld.js) — jedno źródło, zero rozjazdów.
// Słowa zarezerwowane WGSL (active, target, static, type, meta, set, …) nie mogą być nazwami.

export const MAX_BODIES = 256;
export const MAX_PAIRS = 256;
export const MAX_IMPACTS = 64;
export const PROJECTILES = 256;
export const BLASTS = 32;
export const EFFECTS = 128;
export const DEBRIS_CAPACITY = 16384;
export const COUNTERS = 64;
export const BODY_FLOATS = 36;           // 9 × vec4 = 144 B

// Flagi ciała (state.x). RECENTRE: solver lokalny — przed następnym krokiem wyrównać środek masy
// i przeliczyć statystyki ciała (liczba żywych węzłów, masa, dokładny obrys).
export const BODY = { USED: 1, STATIC: 2, DEAD: 4, SLEEP: 8, NOSPLIT: 16, WRECK: 32, RECENTRE: 64 };
// Flagi węzła (nodeInfo.x)
export const NODE = { ACTIVE: 1, SURFACE: 2, MOUNTFAIL: 4, DOOMED: 8, STATIC: 16 };
// Flagi kroku (step.flags). RECENTRE: redukcja tylko ciał z flagą BODY.RECENTRE (solver lokalny).
export const STEP = { CONTROLS: 1, FIRE: 2, DAMAGE: 4, TRANSFER: 8, WEAPONS: 16, STRAIN: 32, RECENTRE: 64 };
// Solver lokalny: liczniki i stan na GPU (bufor loc) i argumenty dispatchy pośrednich (locArgs).
// Lista obszaru ma dwie połówki (parzystość epoki podkroku): połówka bieżąca = [A | F | O],
// do drugiej trafia A następnego podkroku (węzły wciąż w ruchu i aktywowane: zgniot, zerwania, trafienia).
export const LOC = {
  epoch: 0, act0: 1, act1: 2, nA: 3, nAF: 4, nAll: 5, settled: 6, front0: 7, front1: 8, cand: 9,
  maxA: 10, maxS: 11, maxAll: 12, maxBeams: 13, maxCand: 14, color: 16, cbase: 80
};
export const LOC_WORDS = 16 + 64 + 64;   // color: liczba belek w kubełku koloru, cbase: początek kubełka (stały)
export const ARG = { a: 0, f: 3, o: 6, s: 9, settled: 12, front: 15, prep: 18, cand: 21, nodes: 24, gs: 27 };
export const ARG_WORDS = 27 + 3 * 64;
export const LOCAL_MAX_DEGREE = 24;          // belek na węzeł (lokalne tablice w growF / growO)
export const BODY_ACC = 16;                  // słów akumulatorów ciała (bodyAcc)
const WP_FAR = new Uint32Array(new Float32Array([3.0e38]).buffer)[0];   // znacznik „poza strefą” w worldPos.x
const _ordView = new DataView(new ArrayBuffer(4));
/** f32 → i32 o tej samej kolejności (lustro ordF z WGSL; inicjalizacja min / max w bodyAcc). */
export function ordF32(f) {
  _ordView.setFloat32(0, f, true);
  const i = _ordView.getInt32(0, true);
  return i < 0 ? (i ^ 0x7fffffff) : i;
}
// Zdarzenia ciała (bodyEvents, atomowo)
export const EVENT = { WAKE: 1, INTEGRITY: 2, DIRTY: 4 };
// Liczniki (counters)
export const COUNTER = {
  debrisCursor: 0, beamsBroken: 1, contacts: 2, nodesKilled: 3, laserHits: 4, missileHits: 5,
  lasersFired: 6, missilesFired: 7, pairs: 8, maxPairContacts: 9, rawContacts: 10, effectCursor: 11,
  projectileCursor: 12, impacts: 13, crushNodes: 14
};
// Stan broni (weaponState, atomowo)
export const WEAPON = { impactCount: 0 };

// ------------------------------------------------------------------ uniformy

export const CONFIG_FIELDS = [
  ['solverIterations', 'u32'], ['plasticRate', 'f32'], ['maxRestDrift', 'f32'], ['plasticFatigue', 'f32'],
  ['breakOn', 'u32'], ['stiffMul', 'f32'], ['breakMul', 'f32'], ['mountRatio', 'f32'],
  ['nodeDamping', 'f32'], ['nodeRadiusRatio', 'f32'], ['restitution', 'f32'], ['friction', 'f32'],
  ['separationPercent', 'f32'], ['separationSlop', 'f32'], ['crushTransfer', 'f32'], ['crushSpeedThreshold', 'f32'],
  ['crushMassBias', 'f32'], ['crushBuckling', 'f32'], ['crushStrength', 'f32'], ['maxContacts', 'u32'],
  ['cellSize', 'f32'], ['linearDamping', 'f32'], ['angularDamping', 'f32'], ['sleepMotionThreshold', 'f32'],
  ['sleepFrames', 'u32'], ['wakeHoldFrames', 'u32'], ['impactPush', 'f32'], ['gridCell', 'f32'],
  ['gridMask', 'u32'], ['staticMask', 'u32'], ['bodyCount', 'u32'], ['nodeCount', 'u32'],
  ['beamCount', 'u32'], ['maxBodies', 'u32'], ['contactCapacity', 'u32'], ['maxPairs', 'u32'],
  ['debrisCapacity', 'u32'], ['wreckKick', 'f32'], ['wreckSpin', 'f32'], ['impactCapacity', 'u32'],
  ['heatGain', 'f32'], ['heatSpeed', 'f32'], ['heatContact', 'f32'], ['heatSpread', 'f32'],
  ['heatWoundWindow', 'f32'], ['listCount', 'u32'], ['reduceStride', 'u32'], ['localMode', 'u32'],
  // solver lokalny: pojemność list węzłów, kolory belek, próg ruchu (j./s), kroki ciszy, próg × podkroki
  ['listCap', 'u32'], ['localColors', 'u32'], ['actThreshold', 'f32'], ['actSettle', 'u32'],
  ['actScale', 'u32'], ['stepPad', 'f32'], ['occMask', 'u32'], ['occCell', 'f32'],
  ['fineMask', 'u32'], ['_pad5', 'u32'], ['_pad6', 'u32'], ['_pad7', 'u32']
];

// Parametry podkroku: jeden wpis na (podkrok, iteracja kolizji), krok 256 B, przesunięcie dynamiczne.
export const STEP_FIELDS = [
  ['dt', 'f32'], ['invDt', 'f32'], ['damp', 'f32'], ['plasticK', 'f32'],
  ['stepScaleSq', 'f32'], ['stepDt', 'f32'], ['originX', 'f32'], ['originY', 'f32'],
  ['flags', 'u32'], ['stamp', 'u32'], ['controlBody', 'u32'], ['fireCount', 'u32'],
  ['throttle', 'f32'], ['turn', 'f32'], ['strafe', 'f32'], ['time', 'f32'],
  ['boost', 'u32'], ['brake', 'u32'], ['assist', 'u32'], ['iteration', 'u32'],
  ['cruiseSpeed', 'f32'], ['boostSpeed', 'f32'], ['reverseSpeed', 'f32'], ['strafeSpeed', 'f32'],
  ['accel', 'f32'], ['boostAccel', 'f32'], ['turnRate', 'f32'], ['turnAccel', 'f32'],
  ['laserSpeed', 'f32'], ['missileSpeed', 'f32'], ['convergence', 'f32'], ['opOffset', 'u32']
];
export const STEP_TAIL_VEC4 = 5;           // fire: array<vec4<f32>, 4> + fireSide: vec4<f32>
export const STEP_STRIDE = 256;
export const COLOR_STRIDE = 256;           // wpis koloru GS: start, count

function structSource(name, fields, tail = '') {
  return `struct ${name} {\n${fields.map(([n, t]) => `  ${n}: ${t},`).join('\n')}\n${tail}}\n`;
}

export function uniformLayout(fields) {
  const index = new Map();
  fields.forEach(([n, t], i) => index.set(n, { i, t }));
  return index;
}

const CONFIG_WGSL = structSource('Config', CONFIG_FIELDS);
const STEP_WGSL = structSource('Step', STEP_FIELDS, '  fire: array<vec4<f32>, 4>,\n  fireSide: vec4<f32>,\n');

// ------------------------------------------------------------------ wspólne

const COMMON = /* wgsl */`
const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;
const B_USED: u32 = 1u;
const B_STATIC: u32 = 2u;
const B_DEAD: u32 = 4u;
const B_SLEEP: u32 = 8u;
const B_WRECK: u32 = 32u;
const N_ACTIVE: u32 = 1u;
const N_SURFACE: u32 = 2u;
const N_MOUNTFAIL: u32 = 4u;
const N_DOOMED: u32 = 8u;
const N_STATIC: u32 = 16u;
const S_CONTROLS: u32 = 1u;
const S_FIRE: u32 = 2u;
const S_DAMAGE: u32 = 4u;
const S_TRANSFER: u32 = 8u;
const S_STRAIN: u32 = 32u;   // ostatni podkrok kroku: prepare zapisuje odkształcenie belek (tylko widok)
const E_WAKE: u32 = 1u;
const E_INTEGRITY: u32 = 2u;
const E_DIRTY: u32 = 4u;
const B_RECENTRE: u32 = 64u;
const S_RECENTRE: u32 = 64u;
const LOC_EPOCH: u32 = ${LOC.epoch}u;
const LOC_ACT0: u32 = ${LOC.act0}u;
const LOC_NA: u32 = ${LOC.nA}u;
const LOC_NAF: u32 = ${LOC.nAF}u;
const LOC_NALL: u32 = ${LOC.nAll}u;
const LOC_SETTLED: u32 = ${LOC.settled}u;
const LOC_FRONT0: u32 = ${LOC.front0}u;
const LOC_CAND: u32 = ${LOC.cand}u;
const LOC_COLOR: u32 = ${LOC.color}u;
const LOC_CBASE: u32 = ${LOC.cbase}u;
const ACT_BIT: u32 = 256u;          // actState: bit aktywności, niższe 8 bitów — kroki ciszy
const MAX_DEG: u32 = ${LOCAL_MAX_DEGREE}u;
const MAX_BODIES: u32 = ${MAX_BODIES}u;
const PROJECTILES: u32 = ${PROJECTILES}u;
const BLASTS: u32 = ${BLASTS}u;
const EFFECTS: u32 = ${EFFECTS}u;
const BLAST_DURATION: f32 = 0.22;

struct Body {
  pos: vec4<f32>,       // hi.xy (wielokrotność 16), lo.zw — pozycja świata bez utraty precyzji
  motion: vec4<f32>,    // vel.xy, kąt, prędkość kątowa
  massInfo: vec4<f32>,  // masa, 1/masa, 1/Izz, mnożnik masy taranu
  bounds: vec4<f32>,    // obrys węzłów w układzie ciała: min.xy, max.xy
  transfer: vec4<f32>,  // średnie przemieszczenie i prędkość węzłów przeniesione na ciało
  shape: vec4<f32>,     // promień, maks. przemieszczenie, bok komórki, —
  rot: vec4<f32>,       // cos, sin kąta; żar rany: poziom, czas
  list: vec4<u32>,      // początek listy węzłów, liczba, żywe węzły, kursor kontaktów
  state: vec4<u32>,     // flagi, kroki snu, przytrzymanie, instancja (skóra)
}

struct Contact {
  key: u32, nodeA: u32, nodeB: u32, iterLocal: u32,
  pen: f32, nx: f32, ny: f32, hx: f32, hy: f32,
}

struct PairData {
  key: u32, bodyA: u32, bodyB: u32, iterBody: u32,
  count: u32, total: u32, threshold: u32, flags: u32,
  cursor: u32, listTotal: u32,
  hitX: f32, hitY: f32, nX: f32, nY: f32,
  pen: f32, massA: f32, massB: f32, contactDist: f32,
  lnAx: f32, lnAy: f32, lnBx: f32, lnBy: f32,
  scaleA: f32, scaleB: f32, travel: f32, heat: f32,
}

struct Projectile { pos: vec4<f32>, motion: vec4<f32>, data: vec4<f32>, tags: vec4<u32> }
struct Blast { pos: vec4<f32>, motion: vec4<f32>, data: vec4<f32>, tags: vec4<u32> }
struct Effect { pos: vec4<f32>, data: vec4<f32> }
struct Impact { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, tags: vec4<u32> }
struct Debris { pos: vec4<f32>, motion: vec4<f32>, look: vec4<f32>, color: vec4<u32> }
struct TopoOp { body: u32, parent: u32, isWreck: u32, count: u32 }

fn rot2(cs: vec2<f32>, v: vec2<f32>) -> vec2<f32> { return vec2<f32>(cs.x * v.x - cs.y * v.y, cs.y * v.x + cs.x * v.y); }
fn rot2T(cs: vec2<f32>, v: vec2<f32>) -> vec2<f32> { return vec2<f32>(cs.x * v.x + cs.y * v.y, -cs.y * v.x + cs.x * v.y); }
fn cross2(a: vec2<f32>, b: vec2<f32>) -> f32 { return a.x * b.y - a.y * b.x; }

// Pozycja hi/lo: hi zawsze wielokrotnością 16 (dokładnie w f32 do 2^28), lo ∈ [−8, 8].
fn posAdd(p: vec4<f32>, d: vec2<f32>) -> vec4<f32> {
  let lo = p.zw + d;
  let carry = round(lo * 0.0625) * 16.0;
  return vec4<f32>(p.xy + carry, lo - carry);
}
fn posRel(p: vec4<f32>, origin: vec2<f32>) -> vec2<f32> { return (p.xy - origin) + p.zw; }
fn posDiff(a: vec4<f32>, b: vec4<f32>) -> vec2<f32> { return (a.xy - b.xy) + (a.zw - b.zw); }

fn bodySolving(b: Body) -> bool {
  let f = b.state.x;
  if ((f & B_USED) == 0u || (f & (B_DEAD | B_STATIC)) != 0u) { return false; }
  return (f & B_SLEEP) == 0u || b.state.z > 0u;
}

fn hashCell(c: vec2<i32>) -> u32 {
  return (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u);
}

// f32 → i32 o tej samej kolejności (atomicMin / atomicMax na liczbach zmiennoprzecinkowych).
fn ordF(f: f32) -> i32 {
  let i = bitcast<i32>(f);
  return select(i, i ^ 0x7fffffff, i < 0);
}
fn unordF(i: i32) -> f32 { return bitcast<f32>(select(i, i ^ 0x7fffffff, i < 0)); }

fn hash11(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) * (1.0 / 4294967296.0);
}
`;

// ------------------------------------------------------------------ bufory

export const BUFFERS = {
  bodies: 'array<Body>',
  pred: 'array<vec2<f32>>',
  prev: 'array<vec2<f32>>',
  posVel: 'array<vec4<f32>>',
  restMass: 'array<vec4<f32>>',       // ox, oy, masa, HP
  invMass: 'array<f32>',
  nodeInfo: 'array<vec4<u32>>',       // flagi, ciało, indeks na liście ciała, komórka ix | iy << 16
  nodeMeta: 'array<vec4<u32>>',       // adjStart, adjEnd, belki bazowe (próg oparcia), belki poszycia pierwotne
  nodeAux: 'array<vec4<f32>>',        // maxHP, żar, czas żaru, kolor (bity RGBA8)
  adj: 'array<u32>',
  worldPos: 'array<vec4<u32>>',       // węzeł w siatce kontaktów: bity x, y świata, ciało, następny w komórce (~0 = koniec)
  gridHead: 'array<atomic<i32>>',
  staticHead: 'array<i32>',
  crush: 'array<atomic<u32>>',        // 2 na węzeł: głębokość (bity f32), stempel
  crushKey: 'array<atomic<u32>>',     // najmniejszy klucz pary, która zgniata węzeł w tym przebiegu (~0 = żadna)
  massStamp: 'array<atomic<u32>>',
  nodeLists: 'array<u32>',
  beamEnds: 'array<vec2<u32>>',
  beamLen: 'array<vec4<f32>>',        // rest, restBase, factor, strain
  beamMat: 'array<vec4<f32>>',        // sztywność, próg plastyczności, próg zerwania, zmęczenie
  beamFlags: 'array<u32>',            // bit0 zerwana, bit1 most pierwotny, typ << 8
  beamSlot: 'array<u32>',             // miejsce belki w kolejności kolorów (zakresy colorRanges / gsTable)
  gsPack: 'array<vec4<u32>>',         // belka w kolejności kolorów dla GS: końce, rest (bity f32), waga więzu (bity f32)
  gsTable: 'array<u32>',
  partials: 'array<vec4<f32>>',       // sumy częściowe redukcji: 4 × vec4 na (ciało, kawałek listy)
  bodyNear: 'array<u32>',             // 1 = kula ciała dotyka innego ciała (siatka i wąska faza)
  bodyBox: 'array<vec4<f32>>',        // strefa możliwego styku w układzie ciała: min.xy, max.xy
  pairFlags: 'array<atomic<u32>>',
  collide: 'array<atomic<u32>>',      // [0] par, [1] kontaktów, [2..] klucze par
  contacts: 'array<Contact>',
  contactKeys: 'array<vec4<u32>>',    // klucz pary, iterLocal, miejsce w koszyku pary — zwarta kopia do agregatu
  keyCount: 'array<atomic<u32>>',     // kontakty na klucz pary (MAX_BODIES²) — liczy narrow, zeruje collideReset
  pairRange: 'array<vec2<u32>>',      // koszyk pary w pairBins: początek, liczba (pairArgs)
  pairBins: 'array<u32>',             // indeksy kontaktów pogrupowane parami (contactBin)
  pairHist: 'array<atomic<u32>>',     // pary z nadmiarem kontaktów: histogram 12 górnych bitów klucza (4096 na parę)
  pairData: 'array<PairData>',
  dispatchArgs: 'array<u32>',
  counters: 'array<atomic<u32>>',
  bodyEvents: 'array<atomic<u32>>',
  projectiles: 'array<Projectile>',
  blasts: 'array<Blast>',
  effects: 'array<Effect>',
  impacts: 'array<Impact>',
  weaponState: 'array<atomic<u32>>',
  debris: 'array<Debris>',
  topoOps: 'array<TopoOp>',
  topoList: 'array<u32>',
  topoBits: 'array<u32>',
  reseatTmp: 'array<vec4<f32>>',      // rozpad: na operację com, cur, vb, masa, ω (reseatFinal1 / 2)
  // --- solver lokalny ---
  loc: 'array<atomic<u32>>',          // liczniki i stan (LOC)
  locArgs: 'array<u32>',              // argumenty dispatchy pośrednich (ARG)
  actState: 'array<u32>',             // bit ACT_BIT = węzeł w A; niższe 8 bitów — kroki ciszy
  listMark: 'array<atomic<u32>>',     // epoka listy A, na której jest węzeł (bez duplikatów)
  regionMark: 'array<atomic<u32>>',   // epoka·4 + rola w podkroku: 3 = A, 2 = F, 1 = O (pierścień)
  solveW: 'array<f32>',               // waga węzła w podkroku: 1/masa w A ∪ F, 0 w pierścieniu
  regionList: 'array<u32>',           // 2 × listCap: [A | F | O] bieżącej epoki, A następnej
  frontList: 'array<u32>',            // 2 × listCap: wolni sąsiedzi F (zapiekanie w następnym podkroku)
  settleList: 'array<u32>',           // węzły uspokojone w podkroku (zapiekanie)
  slotBeam: 'array<u32>',             // miejsce w kubełku koloru → belka (kubełki = zakresy colorRanges)
  bodyAcc: 'array<atomic<i32>>',      // BODY_ACC słów na ciało: pęd (stały przecinek), dryf, obrys, promień
  candList: 'array<u32>',             // kandydaci do kontaktów (węzły w strefie styku kroku)
  occ: 'array<atomic<u32>>',          // zgrubna siatka zajętości świata: na komórkę min i max indeksu ciała
  occFine: 'array<atomic<u32>>',      // to samo w przebiegu kontaktów (komórka 4 × siatka kontaktów, pozycje z tej chwili)
  stepBox: 'array<vec4<f32>>'         // strefa styku całego kroku (z zapasem na ruch w kroku)
};

// ------------------------------------------------------------------ solver lokalny: wspólne
//
// Port _solveLocal (destructorBeams3D.js) na GPU. Na podkrok: A = węzły aktywne (lista z poprzedniego
// podkroku), F = ich sąsiedzi przez całe belki (też ruchomi), O = pierścień — końce belek F poza A ∪ F
// (stoją, waga 0). Więzy = belki z końcem w A ∪ F, w kubełkach kolorów (GS jak w pełnym solverze).
// Reszta kadłuba jest sztywna: reakcja pierścienia i pęd węzłów uspokojonych idą na ciało sztywne.
// Węzeł wypada z A po actSettle podkrokach ciszy (|v|₁ ≤ próg); belki do węzłów spoza obliczeń
// przyjmują wtedy obecną długość (zapiekanie, _bakeRest). Zbiory i sumy nie zależą od kolejności
// wątków (pęd w stałym przecinku), więc wynik jest deterministyczny jak w pełnym solverze.

// Aktywacja (activateNode): węzeł trafia na listę A następnego podkroku (epoka zapisana + 1 — przed
// regionBegin to bieżący podkrok: trafienia broni liczą się od razu). Wymaga wiązań loc, listMark,
// actState, regionList. W trybie pełnym nic nie robi.
const ACTIVATE = /* wgsl */`
fn activate(i: u32) {
  if (cfg.localMode == 0u) { return; }
  actState[i] = ACT_BIT;
  let t = atomicLoad(&loc[LOC_EPOCH]) + 1u;
  if (atomicMax(&listMark[i], t) < t) {
    let pos = atomicAdd(&loc[LOC_ACT0 + (t & 1u)], 1u);
    if (pos < cfg.listCap) { regionList[(t & 1u) * cfg.listCap + pos] = i; }
  }
}
`;

// Mocowania wręgów i grodzi węzła (refreshBeamMounts / _refreshMountsLocal). Wiązania: nodeInfo (rw),
// nodeMeta, adj, beamFlags, beamEnds.
const MOUNT_CHECK = /* wgsl */`
fn mountCheck(i: u32, flags: u32) {
  if (cfg.breakOn == 0u) { return; }
  let m = nodeMeta[i];
  var failed = false;
  if (m.w >= 4u) {
    var support = 0u;
    for (var q = m.x; q < m.y; q++) {
      let e = adj[q];
      let fl = beamFlags[e];
      if ((fl & 1u) != 0u || ((fl >> 8u) & 255u) >= 2u) { continue; }
      let ends = beamEnds[e];
      if ((nodeInfo[ends.x].x & N_ACTIVE) != 0u && (nodeInfo[ends.y].x & N_ACTIVE) != 0u) { support++; }
    }
    failed = f32(support) < f32(m.w) * cfg.mountRatio;
  }
  let want = select(flags & ~N_MOUNTFAIL, flags | N_MOUNTFAIL, failed);
  if (want != flags) { nodeInfo[i].x = want; }
}
`;

// Zapiekanie (_bakeRest): belki węzła i do żywych węzłów nieaktywnych (i spoza A ∪ F podkroku ep, gdy
// ep > 0; A = lista z listMark == ep, F = regionMark == ep·4 + 2) przyjmują obecną długość w granicach
// dryfu plastycznego. Wiązania: nodeMeta, adj, beamFlags, beamEnds, nodeInfo, actState, posVel,
// beamLen (rw), regionMark, listMark.
const BAKE = /* wgsl */`
fn inRegion(o: u32, ep: u32) -> bool {
  return atomicLoad(&listMark[o]) == ep || atomicLoad(&regionMark[o]) == ep * 4u + 2u;
}
fn bakeBeams(i: u32, ep: u32) {
  let m = nodeMeta[i];
  let xi = posVel[i].xy;
  for (var q = m.x; q < m.y; q++) {
    let e = adj[q];
    if ((beamFlags[e] & 1u) != 0u) { continue; }
    let ends = beamEnds[e];
    let o = ends.x ^ ends.y ^ i;
    if ((nodeInfo[o].x & N_ACTIVE) == 0u || (actState[o] & ACT_BIT) != 0u) { continue; }
    if (ep != 0u && inRegion(o, ep)) { continue; }
    let len = length(posVel[o].xy - xi);
    let l = beamLen[e];
    let next = max(l.y * (1.0 - cfg.maxRestDrift), min(l.y * (1.0 + cfg.maxRestDrift), len));
    if (next != l.x) { beamLen[e].x = next; }
  }
}
`;

// Pęd w stałym przecinku: hi = round(v / 64), lo = round((v − 64·hi) · 256). Sumy liczb całkowitych
// nie zależą od kolejności dodawania (deterministycznie), rozdzielczość 1/256 na składnik.
const FIXED = /* wgsl */`
fn fixHi(v: f32) -> i32 { return i32(round(clamp(v, -1.0e11, 1.0e11) * 0.015625)); }
fn fixLo(v: f32, hi: i32) -> i32 { return i32(round((clamp(v, -1.0e11, 1.0e11) - f32(hi) * 64.0) * 256.0)); }
fn unfix(hi: i32, lo: i32) -> f32 { return f32(hi) * 64.0 + f32(lo) * 0.00390625; }
`;
// Słowa bodyAcc (na ciało): pęd x / y (hi, lo), dryf (·4), obrys (ordF), r², maks. przemieszczenie,
// węzły A ∪ F podkroku, węzły zostające w A, dryf od ostatniego wyrównania środka (bity f32).
export const ACC = { pxHi: 0, pxLo: 1, pyHi: 2, pyLo: 3, drift: 4, minX: 5, minY: 6, maxX: 7, maxY: 8, r2: 9, disp: 10,
  solved: 11, kept: 12, driftTotal: 13, lHi: 14, lLo: 15 };   // l: moment pędu węzłów wyzerowanych po rozpadzie
const ACC_SLOT = 13;   // słów sumowanych w grupie roboczej (0..12)

// ------------------------------------------------------------------ kernele

export const KERNELS = {};
const K = (name, bindings, code, extra = {}) => { KERNELS[name] = { bindings, code, ...extra }; };

// Ruch ciał sztywnych + sterowanie lotem (applyPlanarFlightControls) w pierwszym podkroku kroku.
const INTEGRATE_FN = /* wgsl */`
fn approach(v: f32, goal: f32, stepV: f32) -> f32 { return v + clamp(goal - v, -stepV, stepV); }

fn integrateBody(i: u32) {
  var b = bodies[i];
  let f = b.state.x;
  if ((f & B_USED) == 0u || (f & (B_DEAD | B_STATIC)) != 0u) { return; }
  var vel = b.motion.xy;
  var w = b.motion.w;
  var ang = b.motion.z;
  if ((sp.flags & S_CONTROLS) != 0u && i == sp.controlBody) {
    let fx = cos(ang);
    let fy = sin(ang);
    let lx = -fy;
    let ly = fx;
    var forward = vel.x * fx + vel.y * fy;
    var side = vel.x * lx + vel.y * ly;
    let accel = select(sp.accel, sp.boostAccel, sp.boost != 0u) * sp.stepDt;
    if (sp.brake != 0u) {
      let speed = sqrt(forward * forward + side * side);
      var scale = 0.0;
      if (speed > 0.0) { scale = max(0.0, 1.0 - accel * 2.0 / speed); }
      forward *= scale;
      side *= scale;
    } else {
      if (sp.throttle > 0.0) { forward = approach(forward, select(sp.cruiseSpeed, sp.boostSpeed, sp.boost != 0u), accel); }
      else if (sp.throttle < 0.0) { forward = approach(forward, -sp.reverseSpeed, accel); }
      if (sp.strafe != 0.0) { side = approach(side, sp.strafe * sp.strafeSpeed, accel); }
      else if (sp.assist != 0u) { side = approach(side, 0.0, accel * 0.6); }
    }
    vel = vec2<f32>(fx * forward + lx * side, fy * forward + ly * side);
    if (sp.turn != 0.0 || sp.assist != 0u) { w = approach(w, sp.turn * sp.turnRate, sp.turnAccel * sp.stepDt); }
  }
  let dt = sp.dt;
  vel *= exp(-cfg.linearDamping * dt);
  w *= exp(-cfg.angularDamping * dt);
  b.pos = posAdd(b.pos, vel * dt);
  // Kwaternion wokół z całkowany jak na CPU i normalizowany = przyrost kąta 2·atan(dt·ω/2).
  ang = ang + 2.0 * atan(0.5 * dt * w);
  if (ang > PI) { ang -= TAU; } else if (ang < -PI) { ang += TAU; }
  b.motion = vec4<f32>(vel, ang, w);
  b.rot = vec4<f32>(cos(ang), sin(ang), b.rot.zw);
  bodies[i] = b;
}
`;
K('integrate', [['bodies', 'rw']], /* wgsl */`
${INTEGRATE_FN}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < cfg.bodyCount) { integrateBody(gid.x); }
}
`);

// Zdarzenia z trafień (budzenie) → stan ciała; zdarzenie integralności gaśnie po krokach broni.
const BODY_EVENT_FN = /* wgsl */`
fn bodyEvent(i: u32) {
  let ev = atomicAnd(&bodyEvents[i], E_DIRTY);
  if ((ev & E_WAKE) == 0u) { return; }
  var b = bodies[i];
  b.state.x = b.state.x & ~B_SLEEP;
  b.state.y = 0u;
  b.state.z = max(b.state.z, cfg.wakeHoldFrames);
  bodies[i] = b;
}
`;
K('bodyEvents', [['bodies', 'rw'], ['bodyEvents', 'rw']], /* wgsl */`
${BODY_EVENT_FN}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < cfg.bodyCount) { bodyEvent(gid.x); }
}
`);
// Solver lokalny bez broni: ruch ciała i zdarzenia budzenia w jednym dispatchu (to samo ciało, ta sama kolejność).
K('integrateEvents', [['bodies', 'rw'], ['bodyEvents', 'rw']], /* wgsl */`
${INTEGRATE_FN}
${BODY_EVENT_FN}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < cfg.bodyCount) { integrateBody(gid.x); bodyEvent(gid.x); }
}
`);

// 1) predykcja z prędkości + mocowania wręgów i grodzi (refreshBeamMounts)
K('predict', [['bodies', 'r'], ['posVel', 'r'], ['pred', 'rw'], ['prev', 'rw'], ['nodeInfo', 'rw'],
  ['nodeMeta', 'r'], ['adj', 'r'], ['beamEnds', 'r'], ['beamFlags', 'r']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) != 0u) { return; }
  let b = bodies[info.y];
  if (!bodySolving(b)) { return; }
  let pv = posVel[i];
  prev[i] = pv.xy;
  pred[i] = pv.xy + pv.zw * sp.dt;
  if (cfg.breakOn != 0u) {
    let m = nodeMeta[i];
    var failed = false;
    if (m.w >= 4u) {
      var support = 0u;
      for (var q = m.x; q < m.y; q++) {
        let e = adj[q];
        let fl = beamFlags[e];
        if ((fl & 1u) != 0u || ((fl >> 8u) & 255u) >= 2u) { continue; }
        let ends = beamEnds[e];
        if ((nodeInfo[ends.x].x & N_ACTIVE) != 0u && (nodeInfo[ends.y].x & N_ACTIVE) != 0u) { support++; }
      }
      failed = f32(support) < f32(m.w) * cfg.mountRatio;
    }
    let want = select(info.x & ~N_MOUNTFAIL, info.x | N_MOUNTFAIL, failed);
    if (want != info.x) { nodeInfo[i].x = want; }
  }
}
`);

// 2) pomiar belek przed rzutowaniem: zmęczenie, zerwania, plastyczność, wagi więzów (prepareBeamConstraints)
// Waga więzu idzie też do gsPack (miejsce belki w kolejności kolorów): GS czyta jeden ciągły rekord
// 16 B zamiast colorBeams → beamLen, beamEnds rozrzuconych po pamięci (3 iteracje × 13 kolorów na podkrok).
K('prepare', [['bodies', 'r'], ['pred', 'r'], ['invMass', 'r'], ['nodeInfo', 'r'], ['beamEnds', 'r'],
  ['beamLen', 'rw'], ['beamMat', 'rw'], ['beamFlags', 'rw'], ['counters', 'rw'], ['bodyEvents', 'rw'], ['nodeAux', 'rw'],
  ['beamSlot', 'r'], ['gsPack', 'rw']], /* wgsl */`
// Brzeg rany zderzenia (tylko wygląd): belka zerwana tuż po styku rozżarza oba końce do poziomu zderzenia.
fn woundHeat(i: u32, level: f32) {
  var aux = nodeAux[i];
  let decayed = aux.y * exp(-max(0.0, sp.time - aux.z) * 0.35);
  if (level > decayed) { aux.y = min(1.0, level); aux.z = sp.time; nodeAux[i] = aux; }
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let e = gid.x;
  if (e >= cfg.beamCount) { return; }
  var len4 = beamLen[e];
  let fl = beamFlags[e];
  // beamLen.z (waga więzu) pisze tylko ten kernel — rekord GS zmienia się razem z nim, zero tylko przy zmianie
  if ((fl & 1u) != 0u) {
    if (len4.z != 0.0) { beamLen[e].z = 0.0; gsPack[beamSlot[e]].w = 0u; }
    return;
  }
  let ends = beamEnds[e];
  let ia = nodeInfo[ends.x];
  let ib = nodeInfo[ends.y];
  if ((ia.x & ib.x & N_ACTIVE) == 0u) {
    if (len4.z != 0.0) { beamLen[e].z = 0.0; gsPack[beamSlot[e]].w = 0u; }
    return;
  }
  let body = bodies[ia.y];
  if (!bodySolving(body)) {
    if (len4.z != 0.0) { beamLen[e].z = 0.0; gsPack[beamSlot[e]].w = 0u; }
    return;
  }
  let btype = (fl >> 8u) & 255u;
  var broke = false;
  var mat = beamMat[e];
  if (cfg.breakOn != 0u && btype >= 2u && ((ia.x | ib.x) & N_MOUNTFAIL) != 0u) {
    broke = true;
  } else {
    let d = pred[ends.y] - pred[ends.x];
    let len = length(d);
    var rest = len4.x;
    let restBase = len4.y;
    let C = len - rest;
    let strain = C / rest;
    let absStrain = abs(strain);
    len4.w = strain;
    if (cfg.breakOn != 0u) {
      let limit = mat.z * cfg.breakMul;
      if (absStrain > mat.y) { mat.w += (absStrain - mat.y) / limit * cfg.plasticFatigue * sp.dt * 60.0; }
      if (max(absStrain, abs(len - restBase) / restBase) > limit || mat.w >= 1.0) { broke = true; }
    }
    if (!broke) {
      if (absStrain > mat.y) {
        let over = C - sign(C) * mat.y * rest;
        rest = clamp(rest + over * sp.plasticK, restBase * (1.0 - cfg.maxRestDrift), restBase * (1.0 + cfg.maxRestDrift));
      }
      let wsum = invMass[ends.x] + invMass[ends.y];
      var factor = 0.0;
      if (wsum > 0.0) {
        let stiff = min(1.0, mat.x * cfg.stiffMul);
        let kk = stiff / (stiff + (1.0 - stiff) / sp.stepScaleSq);
        factor = kk / wsum;
      }
      // Zapis tylko przy zmianie: belka sprężysta ma ten sam rest i wagę co podkrok, a strain czyta
      // tylko widok (raz na krok). Przy gęstej siatce zapisy były ~połową ruchu pamięci tego kernela.
      // gsPack.z / .w = bity beamLen.x / .z (pilnuje tego też repairBeams).
      let changed = rest != len4.x || factor != len4.z;
      if (changed || (sp.flags & S_STRAIN) != 0u) { beamLen[e] = vec4<f32>(rest, restBase, factor, len4.w); }
      if (absStrain > mat.y) { beamMat[e].w = mat.w; }
      if (changed) { gsPack[beamSlot[e]] = vec4<u32>(ends.x, ends.y, bitcast<u32>(rest), bitcast<u32>(factor)); }
      return;
    }
  }
  beamFlags[e] = fl | 1u;
  beamLen[e] = vec4<f32>(len4.x, len4.y, 0.0, len4.w);
  beamMat[e].w = mat.w;
  gsPack[beamSlot[e]].w = 0u;
  atomicAdd(&counters[${COUNTER.beamsBroken}], 1u);
  atomicOr(&bodyEvents[ia.y], E_DIRTY);
  if (cfg.heatGain > 0.0 && body.rot.z > 0.02 && sp.time - body.rot.w <= cfg.heatWoundWindow) {
    woundHeat(ends.x, body.rot.z);
    woundHeat(ends.y, body.rot.z);
  }
}
`);

// 3) rzutowanie więzów — jeden kolor naraz (przesunięcie dynamiczne: początek i liczba belek koloru)
// Rekord gsPack[k] (k = miejsce w colorBeams) pisze prepare w tym samym podkroku: ten sam wynik
// co dawne colorBeams[k] → beamLen / beamEnds, ale jeden ciągły odczyt 16 B na belkę.
const SOLVE_BEAM = /* wgsl */`
fn solveBeam(k: u32) {
  let g = gsPack[k];
  if (g.w == 0u) { return; }
  let pa = pred[g.x];
  let pb = pred[g.y];
  let d = pb - pa;
  let len = length(d);
  if (len < 1e-9) { return; }
  let c = d * ((len - bitcast<f32>(g.z)) / len * bitcast<f32>(g.w));
  pred[g.x] = pa + c * invMass[g.x];
  pred[g.y] = pb - c * invMass[g.y];
}
`;
K('gsColor', [['gsPack', 'r'], ['pred', 'rw'], ['invMass', 'r']], /* wgsl */`
struct ColorRange { start: u32, count: u32, index: u32 }
@group(2) @binding(0) var<uniform> colorRange: ColorRange;
${SOLVE_BEAM}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= colorRange.count) { return; }
  solveBeam(colorRange.start + k);
}
`, { colorGroup: true });

// 3c) Solver lokalny: kubełek koloru (początek z zakresu koloru, liczba belek z licznika podkroku),
//     waga węzłów z solveW (pierścień O = 0), dispatch pośredni.
K('gsLocal', [['gsPack', 'r'], ['pred', 'rw'], ['invMass', 'r', null, 'solveW'], ['loc', 'rw']], /* wgsl */`
struct ColorRange { start: u32, count: u32, index: u32 }
@group(2) @binding(0) var<uniform> colorRange: ColorRange;
${SOLVE_BEAM}
var<workgroup> wN: u32;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) { wN = atomicLoad(&loc[LOC_COLOR + colorRange.index]); }
  let n = workgroupUniformLoad(&wN);
  let k = gid.x;
  if (k >= n) { return; }
  solveBeam(colorRange.start + k);
}
`, { colorGroup: true });

// 3b) Małe kadłuby: wszystkie iteracje i kolory w JEDNEJ grupie roboczej na kadłub (bariera między
//     kolorami zamiast osobnego dispatcha). Przy kilkunastu tysiącach belek narzut ~40 dispatchy
//     na podkrok był większy niż samo liczenie. gsTable: na instancję [liczba kolorów, (start, count) × MAX].
export const GS_GROUP_COLORS = 32;
export const GS_GROUP_SIZE = 256;   // domyślny rozmiar grupy; świat podaje własny przez stałą override GS_SIZE
K('gsGroup', [['gsPack', 'r'], ['pred', 'rw'], ['invMass', 'r'], ['gsTable', 'r']], /* wgsl */`
${SOLVE_BEAM}
const GS_STRIDE: u32 = ${1 + GS_GROUP_COLORS * 2}u;
override GS_SIZE: u32 = ${GS_GROUP_SIZE}u;
var<workgroup> wColors: u32;
var<workgroup> wRange: vec2<u32>;
@compute @workgroup_size(GS_SIZE)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let base = wid.x * GS_STRIDE;
  if (lid == 0u) { wColors = gsTable[base]; }
  let nc = workgroupUniformLoad(&wColors);
  for (var it = 0u; it < cfg.solverIterations; it++) {
    for (var c = 0u; c < nc; c++) {
      if (lid == 0u) { wRange = vec2<u32>(gsTable[base + 1u + c * 2u], gsTable[base + 2u + c * 2u]); }
      let r = workgroupUniformLoad(&wRange);
      for (var j = lid; j < r.y; j += GS_SIZE) { solveBeam(r.x + j); }
      storageBarrier();
    }
  }
}
`, { overrides: (world) => ({ GS_SIZE: world.gsGroupSize }) });

// 4) prędkości z przesunięcia + tłumienie (węzeł zostaje w płaszczyźnie z = 0)
K('velocity', [['bodies', 'r'], ['nodeInfo', 'r'], ['pred', 'r'], ['prev', 'r'], ['posVel', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) != 0u) { return; }
  if (!bodySolving(bodies[info.y])) { return; }
  let x = pred[i];
  posVel[i] = vec4<f32>(x, (x - prev[i]) * (sp.invDt * sp.damp));
}
`);

// 5) redukcja na ciało, dwupoziomowo: grupy po REDUCE_CHUNK węzłów listy liczą sumy częściowe
//    (wiele grup na duży kadłub — przy 48 tys. węzłów jedna grupa robocza była ~20% kroku), potem
//    grupa na ciało składa je i aktualizuje ciało: wspólny ruch węzłów → ciało sztywne, masa, żywe
//    węzły, obrys, sen. Odejmowanie od węzłów robi 'insert' (flaga S_TRANSFER).
export const REDUCE_CHUNK = 1024;
K('reducePartial', [['bodies', 'r'], ['nodeLists', 'r'], ['nodeInfo', 'r'], ['posVel', 'r'], ['restMass', 'r'],
  ['partials', 'rw']], /* wgsl */`
const WG: u32 = 256u;
const CHUNK: u32 = ${REDUCE_CHUNK}u;
var<workgroup> sA: array<vec4<f32>, 256>;
var<workgroup> sB: array<vec4<f32>, 256>;
var<workgroup> sC: array<vec4<f32>, 256>;
var<workgroup> sD: array<f32, 256>;
var<workgroup> wList: vec4<u32>;
var<workgroup> wFlags: u32;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32,
        @builtin(num_workgroups) nwg: vec3<u32>) {
  let bi = wid.y;
  let chunk = wid.x;
  if (lid == 0u) {
    let b = bodies[bi];
    wList = b.list;
    wFlags = b.state.x;
  }
  let fl = workgroupUniformLoad(&wFlags);
  let lst = workgroupUniformLoad(&wList);
  if ((fl & B_USED) == 0u || (fl & (B_DEAD | B_STATIC)) != 0u || chunk * CHUNK >= lst.y) { return; }
  // solver lokalny: redukcja tylko ciał do wyrównania środka (recentreFinal)
  if ((sp.flags & S_RECENTRE) != 0u && (fl & B_RECENTRE) == 0u) { return; }
  let end = min(lst.y, (chunk + 1u) * CHUNK);
  var m = 0.0; var dx = 0.0; var dy = 0.0; var vx = 0.0; var vy = 0.0; var mot = 0.0;
  var mnX = 3.0e38; var mnY = 3.0e38; var mxX = -3.0e38; var mxY = -3.0e38; var r2 = 0.0; var disp = 0.0;
  var cnt = 0.0;
  for (var k = chunk * CHUNK + lid; k < end; k += WG) {
    let i = nodeLists[lst.x + k];
    if ((nodeInfo[i].x & N_ACTIVE) == 0u) { continue; }
    let pv = posVel[i];
    let rm = restMass[i];
    cnt += 1.0;
    m += rm.z;
    let dd = pv.xy - rm.xy;
    dx += dd.x * rm.z; dy += dd.y * rm.z;
    vx += pv.z * rm.z; vy += pv.w * rm.z;
    mot = max(mot, abs(pv.z) + abs(pv.w));
    mnX = min(mnX, pv.x); mnY = min(mnY, pv.y); mxX = max(mxX, pv.x); mxY = max(mxY, pv.y);
    r2 = max(r2, dot(pv.xy, pv.xy));
    disp = max(disp, max(abs(dd.x), abs(dd.y)));
  }
  sA[lid] = vec4<f32>(m, dx, dy, vx);
  sB[lid] = vec4<f32>(vy, cnt, mot, r2);
  sC[lid] = vec4<f32>(mnX, mnY, mxX, mxY);
  sD[lid] = disp;
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s = s >> 1u) {
    if (lid < s) {
      let o = lid + s;
      sA[lid] += sA[o];
      let b0 = sB[lid]; let b1 = sB[o];
      sB[lid] = vec4<f32>(b0.x + b1.x, b0.y + b1.y, max(b0.z, b1.z), max(b0.w, b1.w));
      let c0 = sC[lid]; let c1 = sC[o];
      sC[lid] = vec4<f32>(min(c0.xy, c1.xy), max(c0.zw, c1.zw));
      sD[lid] = max(sD[lid], sD[o]);
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    let o = (bi * nwg.x + chunk) * 4u;
    partials[o] = sA[0];
    partials[o + 1u] = sB[0];
    partials[o + 2u] = sC[0];
    partials[o + 3u] = vec4<f32>(sD[0], 0.0, 0.0, 0.0);
  }
}
`);

K('reduceFinal', [['bodies', 'rw'], ['partials', 'r']], /* wgsl */`
const WG: u32 = 64u;
const CHUNK: u32 = ${REDUCE_CHUNK}u;
var<workgroup> sA: array<vec4<f32>, 64>;
var<workgroup> sB: array<vec4<f32>, 64>;
var<workgroup> sC: array<vec4<f32>, 64>;
var<workgroup> sD: array<f32, 64>;
var<workgroup> wList: vec4<u32>;
var<workgroup> wFlags: u32;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let bi = wid.x;
  if (lid == 0u) {
    var fl = 0u;
    if (bi < cfg.bodyCount) { fl = bodies[bi].state.x; wList = bodies[bi].list; }
    wFlags = fl;
  }
  let fl = workgroupUniformLoad(&wFlags);
  if ((fl & B_USED) == 0u || (fl & (B_DEAD | B_STATIC)) != 0u) { return; }
  let lst = wList;
  let chunks = (lst.y + CHUNK - 1u) / CHUNK;
  let stride = cfg.reduceStride;  // liczba grup na ciało w reducePartial (num_workgroups.x)
  var a = vec4<f32>(0.0);
  var b = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var c = vec4<f32>(3.0e38, 3.0e38, -3.0e38, -3.0e38);
  var dsp = 0.0;
  for (var k = lid; k < chunks; k += WG) {
    let o = (bi * stride + k) * 4u;
    a += partials[o];
    let pb = partials[o + 1u];
    b = vec4<f32>(b.x + pb.x, b.y + pb.y, max(b.z, pb.z), max(b.w, pb.w));
    let pc = partials[o + 2u];
    c = vec4<f32>(min(c.xy, pc.xy), max(c.zw, pc.zw));
    dsp = max(dsp, partials[o + 3u].x);
  }
  sA[lid] = a; sB[lid] = b; sC[lid] = c; sD[lid] = dsp;
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s = s >> 1u) {
    if (lid < s) {
      let o = lid + s;
      sA[lid] += sA[o];
      let b0 = sB[lid]; let b1 = sB[o];
      sB[lid] = vec4<f32>(b0.x + b1.x, b0.y + b1.y, max(b0.z, b1.z), max(b0.w, b1.w));
      let c0 = sC[lid]; let c1 = sC[o];
      sC[lid] = vec4<f32>(min(c0.xy, c1.xy), max(c0.zw, c1.zw));
      sD[lid] = max(sD[lid], sD[o]);
    }
    workgroupBarrier();
  }
  if (lid != 0u) { return; }
  var body = bodies[bi];
  let sums = sA[0];
  let more = sB[0];
  let box = sC[0];
  let count = u32(more.y + 0.5);
  body.list.z = count;
  if (count == 0u) {
    body.state.x = body.state.x | B_DEAD;
    body.transfer = vec4<f32>(0.0);
    bodies[bi] = body;
    return;
  }
  let msum = sums.x;
  body.massInfo.x = msum;
  body.massInfo.y = 1.0 / msum;
  var mean = vec2<f32>(0.0);
  var meanV = vec2<f32>(0.0);
  if (bodySolving(body) && msum > 0.0) {
    mean = sums.yz / msum;
    meanV = vec2<f32>(sums.w, more.x) / msum;
    let cs2 = body.rot.xy;
    body.pos = posAdd(body.pos, rot2(cs2, mean));
    body.motion = vec4<f32>(body.motion.xy + rot2(cs2, meanV), body.motion.zw);
    if (abs(mean.x) + abs(mean.y) <= 1e-9) { mean = vec2<f32>(0.0); }
    // Sen jak w pełnym solverze CPU: ruch węzłów względem ciała (po tłumieniu, przed odjęciem średniej).
    if (more.z > cfg.sleepMotionThreshold) {
      body.state.y = 0u;
      body.state.x = body.state.x & ~B_SLEEP;
    } else if (body.state.z > 0u) {
      body.state.z = body.state.z - 1u;
    } else {
      body.state.y = body.state.y + 1u;
      if (body.state.y >= cfg.sleepFrames) { body.state.x = body.state.x | B_SLEEP; }
    }
  }
  body.transfer = vec4<f32>(mean, meanV);
  body.bounds = vec4<f32>(box.xy - mean, box.zw - mean);
  body.shape.x = sqrt(more.w) + length(mean) + body.shape.z;
  body.shape.y = sD[0] + length(mean);
  bodies[bi] = body;
}
`);

// Bliskość ciał: węzły kadłuba, którego kula (z zapasem na drogę w podkroku) nie dotyka żadnego
// innego ciała, nie trafiają do siatki i nie szukają kontaktów. Flota w locie prawie nie płaci
// za wąską fazę. Para dwóch ciał statycznych się nie liczy (jak na CPU).
//
// Strefa styku (bodyBox): suma obrysów bliskich ciał przeniesionych do układu ciała, z zapasem.
// Węzeł spoza niej nie może mieć kontaktu w żadnej z dwóch iteracji podkroku (odległość do każdego
// węzła drugiego ciała > zasięg styku) — nie idzie do siatki i nie szuka sąsiadów. Bez tego przy
// taranie Atlas–Atlas (kule ciał nakładają się od startu) wąska faza liczyła wszystkie węzły obu
// kadłubów: przy siatce 1,5 j. ~5 ms na krok, zanim kadłuby w ogóle się dotkną.
// Zapas: między wstawieniem a drugą iteracją odpowiedź przesuwa ciała o ≤ głębokość styku, a zgniot
// węzły o ≤ 0,65 zasięgu — 4 zasięgi styku + 1 j. to z naddatkiem.
const NEAR_FN = /* wgsl */`
fn nearBody(i: u32) {
  let a = bodies[i];
  var near = 0u;
  var lo = vec2<f32>(3.0e38);
  var hi = vec2<f32>(-3.0e38);
  if ((a.state.x & B_USED) != 0u && (a.state.x & B_DEAD) == 0u) {
    let aStatic = (a.state.x & B_STATIC) != 0u;
    for (var j = 0u; j < cfg.bodyCount; j++) {
      if (j == i) { continue; }
      let b = bodies[j];
      if ((b.state.x & B_USED) == 0u || (b.state.x & B_DEAD) != 0u) { continue; }
      if (aStatic && (b.state.x & B_STATIC) != 0u) { continue; }
      let rel = posDiff(a.pos, b.pos);
      let margin = length(a.motion.xy - b.motion.xy) * sp.dt * 2.0 + (a.shape.z + b.shape.z) * 2.0;
      let r = a.shape.x + b.shape.x + margin;
      if (dot(rel, rel) > r * r) { continue; }
      near = 1u;
      // obrys b (układ b) → układ a: środek i półosie po obrocie
      let bc = (b.bounds.xy + b.bounds.zw) * 0.5;
      let bh = (b.bounds.zw - b.bounds.xy) * 0.5;
      let cs = vec2<f32>(a.rot.x * b.rot.x + a.rot.y * b.rot.y, a.rot.x * b.rot.y - a.rot.y * b.rot.x);  // obrót b względem a
      let c = rot2T(a.rot.xy, -rel) + rot2(cs, bc);
      let ext = vec2<f32>(abs(cs.x) * bh.x + abs(cs.y) * bh.y, abs(cs.y) * bh.x + abs(cs.x) * bh.y);
      let pad = (a.shape.z + b.shape.z) * cfg.nodeRadiusRatio * 4.0 + 1.0;
      lo = min(lo, c - ext - vec2<f32>(pad));
      hi = max(hi, c + ext + vec2<f32>(pad));
    }
  }
  bodyNear[i] = near;
  bodyBox[i] = vec4<f32>(lo, hi);
}
`;
K('nearFlags', [['bodies', 'r'], ['bodyNear', 'rw'], ['bodyBox', 'rw']], /* wgsl */`
${NEAR_FN}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < cfg.bodyCount) { nearBody(gid.x); }
}
`);

// Kontakty — czyszczenie listy par z poprzedniej iteracji (jedna grupa robocza).
K('collideReset', [['pairFlags', 'rw'], ['collide', 'rw'], ['keyCount', 'rw']], /* wgsl */`
var<workgroup> wN: u32;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) { wN = min(atomicLoad(&collide[0]), cfg.maxPairs); }
  let n = workgroupUniformLoad(&wN);
  for (var k = lid; k < n; k += 64u) {
    let key = atomicLoad(&collide[2u + k]);
    atomicStore(&pairFlags[key], 0u);
    atomicStore(&keyCount[key], 0u);
  }
  workgroupBarrier();
  if (lid == 0u) {
    atomicStore(&collide[0], 0u);
    atomicStore(&collide[1], 0u);
  }
}
`);

K('clearGrid', [['gridHead', 'rw']], /* wgsl */`
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x > cfg.gridMask) { return; }
  atomicStore(&gridHead[gid.x], -1);
}
`);

K('clearStatic', [['gridHead', 'rw', null, 'staticHead']], /* wgsl */`
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x > cfg.staticMask) { return; }
  atomicStore(&gridHead[gid.x], -1);
}
`);

K('weaponReset', [['weaponState', 'rw']], /* wgsl */`
@compute @workgroup_size(1)
fn main() { atomicStore(&weaponState[0], 0u); }
`);

// Odjęcie wspólnego ruchu (po redukcji), pozycja świata węzła i wstawienie do siatki świata.
// Węzeł spoza strefy styku ciała dostaje znacznik w worldPos (x = 3e38) — wąska faza go pomija.
// Rekord węzła w siatce (pozycja, ciało, następny) to jeden odczyt 16 B na sąsiada w wąskiej fazie
// (dawniej nodeInfo + worldPos + gridNext — trzy rozproszone odczyty).
const INSERT_NODE = (fine) => /* wgsl */`
fn insertNode(i: u32) {
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) != 0u) { return; }
  let b = bodies[info.y];
  if ((b.state.x & B_DEAD) != 0u) { return; }
  var pv = posVel[i];
  if ((sp.flags & S_TRANSFER) != 0u && (abs(b.transfer.x) + abs(b.transfer.y) + abs(b.transfer.z) + abs(b.transfer.w)) > 0.0) {
    pv = pv - b.transfer;
    posVel[i] = pv;
  }
  if (bodyNear[info.y] == 0u) {
    if (cfg.localMode != 0u) { worldPos[i] = vec4<u32>(${WP_FAR}u, 0u, 0u, ~0u); }   // lista: znacznik dla czyszczenia siatki
    return;
  }
  let box = bodyBox[info.y];
  if (any(pv.xy < box.xy) || any(pv.xy > box.zw)) {
    worldPos[i] = vec4<u32>(${WP_FAR}u, 0u, 0u, ~0u);
    return;
  }
  let w = posRel(b.pos, vec2<f32>(sp.originX, sp.originY)) + rot2(b.rot.xy, pv.xy);
  let cell = vec2<i32>(floor(w / cfg.gridCell));
  let h = hashCell(cell) & cfg.gridMask;
  let next = atomicExchange(&gridHead[h], i32(i));
  worldPos[i] = vec4<u32>(bitcast<u32>(w.x), bitcast<u32>(w.y), info.y, bitcast<u32>(next));
  ${fine ? `let hf = (hashCell(vec2<i32>(floor(w / (cfg.gridCell * 4.0)))) & cfg.fineMask) * 2u;
  if (atomicLoad(&occFine[hf]) > info.y) { atomicMin(&occFine[hf], info.y); }
  if (atomicLoad(&occFine[hf + 1u]) < info.y) { atomicMax(&occFine[hf + 1u], info.y); }` : ''}
}
`;
const INSERT_BINDINGS = [['bodies', 'r'], ['nodeInfo', 'r'], ['posVel', 'rw'], ['worldPos', 'rw'],
  ['gridHead', 'rw'], ['bodyNear', 'r'], ['bodyBox', 'r']];
K('insert', INSERT_BINDINGS, /* wgsl */`
${INSERT_NODE(false)}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= cfg.nodeCount) { return; }
  insertNode(gid.x);
}
`);
// Solver lokalny: wstawienie tylko kandydatów kroku (candList), bez przeglądu całej kratownicy.
K('insertList', [...INSERT_BINDINGS, ['candList', 'r'], ['loc', 'rw'], ['occFine', 'rw']], /* wgsl */`
${INSERT_NODE(true)}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= atomicLoad(&loc[LOC_CAND])) { return; }
  insertNode(candList[gid.x]);
}
`);

// Ciała statyczne: siatka budowana raz (ściana się nie rusza). Zmienna 'gridHead' = bufor staticHead.
K('insertStatic', [['bodies', 'r'], ['nodeInfo', 'r'], ['posVel', 'r'], ['worldPos', 'rw'],
  ['gridHead', 'rw', null, 'staticHead']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) == 0u) { return; }
  let b = bodies[info.y];
  let w = posRel(b.pos, vec2<f32>(sp.originX, sp.originY)) + rot2(b.rot.xy, posVel[i].xy);
  let cell = vec2<i32>(floor(w / cfg.gridCell));
  let h = hashCell(cell) & cfg.staticMask;
  let next = atomicExchange(&gridHead[h], i32(i));
  worldPos[i] = vec4<u32>(bitcast<u32>(w.x), bitcast<u32>(w.y), info.y, bitcast<u32>(next));
}
`);

// Wąska faza: węzeł ciała „iterującego” (mniej żywych węzłów w parze, jak collideBodies) szuka
// najbliższego węzła każdego innego ciała w promieniu styku. Klucz pary = mniejszy·MAX + większy.
const NARROW_NODE = (fine) => /* wgsl */`
var<private> fBody: array<u32, 4>;
var<private> fNode: array<u32, 4>;
var<private> fD2: array<f32, 4>;
var<private> fCd2: array<f32, 4>;
var<private> fN: u32;
var<private> gI: u32;
var<private> gA: u32;
var<private> gActA: u32;
var<private> gCsA: f32;
var<private> gW: vec2<f32>;

fn consider(j: u32, rec: vec4<u32>) {
  let bj = rec.z;
  if (bj == gA) { return; }
  let other = bodies[bj];
  if ((other.state.x & B_DEAD) != 0u) { return; }
  let actB = other.list.z;
  let lo = min(gA, bj);
  let actLo = select(actB, gActA, lo == gA);
  let actHi = select(gActA, actB, lo == gA);
  let iterBody = select(lo, max(gA, bj), actLo > actHi);
  if (iterBody != gA) { return; }
  let cd = (gCsA + other.shape.z) * cfg.nodeRadiusRatio;
  let d = gW - vec2<f32>(bitcast<f32>(rec.x), bitcast<f32>(rec.y));
  let d2 = dot(d, d);
  if (d2 >= cd * cd) { return; }
  for (var s = 0u; s < fN; s++) {
    if (fBody[s] == bj) {
      if (d2 < fD2[s] || (d2 == fD2[s] && j < fNode[s])) { fD2[s] = d2; fNode[s] = j; }
      return;
    }
  }
  if (fN < 4u) {
    fBody[fN] = bj; fNode[fN] = j; fD2[fN] = d2; fCd2[fN] = cd;
    fN++;
    return;
  }
  // więcej niż 4 ciała w zasięgu (wraki): 4 o najmniejszych indeksach — zbiór nie zależy od kolejności
  // łańcucha w komórce siatki (kolejności atomików wstawiania)
  var worst = 0u;
  for (var s = 1u; s < 4u; s++) { if (fBody[s] > fBody[worst]) { worst = s; } }
  if (bj < fBody[worst]) { fBody[worst] = bj; fNode[worst] = j; fD2[worst] = d2; fCd2[worst] = cd; }
}

fn narrowNode(i: u32) {
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) != 0u) { return; }
  if (bodyNear[info.y] == 0u) { return; }
  let a = bodies[info.y];
  if ((a.state.x & B_DEAD) != 0u) { return; }
  let wr = worldPos[i];
  gI = i; gA = info.y; gActA = a.list.z; gCsA = a.shape.z; gW = vec2<f32>(bitcast<f32>(wr.x), bitcast<f32>(wr.y)); fN = 0u;
  if (gW.x > 1.0e37) { return; }   // poza strefą styku (insert)
  ${fine ? `// otoczenie bez innego ciała (komórki 4 × siatka kontaktów z tego samego wstawienia) — bez szukania;
  // przy ciele statycznym (siatka budowana raz, poza tą tablicą) filtr wyłączony
  if (cfg.staticMask == 0u) {
    let cf = vec2<i32>(floor(gW / (cfg.gridCell * 4.0)));
    var other = false;
    for (var fy = -1; fy <= 1 && !other; fy++) {
      for (var fx = -1; fx <= 1; fx++) {
        let hf = (hashCell(cf + vec2<i32>(fx, fy)) & cfg.fineMask) * 2u;
        let mn = atomicLoad(&occFine[hf]);
        if (mn != 0xffffffffu && (mn != gA || atomicLoad(&occFine[hf + 1u]) != gA)) { other = true; break; }
      }
    }
    if (!other) { return; }
  }` : ''}
  let cell = vec2<i32>(floor(gW / cfg.gridCell));
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let c = cell + vec2<i32>(dx, dy);
      let hc = hashCell(c);
      var j = gridHead[hc & cfg.gridMask];
      loop {
        if (j < 0) { break; }
        let rec = worldPos[u32(j)];
        consider(u32(j), rec);
        j = bitcast<i32>(rec.w);
      }
      if (cfg.staticMask != 0u) {
        j = staticHead[hc & cfg.staticMask];
        loop {
          if (j < 0) { break; }
          let rec = worldPos[u32(j)];
          consider(u32(j), rec);
          j = bitcast<i32>(rec.w);
        }
      }
    }
  }
  for (var s = 0u; s < fN; s++) {
    let bj = fBody[s];
    let j = fNode[s];
    let dist = sqrt(fD2[s]);
    let pen = fCd2[s] - dist;
    if (pen <= 0.0) { continue; }
    let lo = min(gA, bj);
    let hi = max(gA, bj);
    let key = lo * cfg.maxBodies + hi;
    if (atomicLoad(&pairFlags[key]) == 0u) {
      if (atomicExchange(&pairFlags[key], 1u) == 0u) {
        let p = atomicAdd(&collide[0], 1u);
        if (p < cfg.maxPairs) { atomicStore(&collide[2u + p], key); }
      }
    }
    let ci = atomicAdd(&collide[1], 1u);
    if (ci >= cfg.contactCapacity) { continue; }
    let wjr = worldPos[j];
    let wj = vec2<f32>(bitcast<f32>(wjr.x), bitcast<f32>(wjr.y));
    let aIsLo = gA == lo;
    let n = select(wj - gW, gW - wj, aIsLo);
    let hit = (gW + wj) * 0.5 - posRel(bodies[lo].pos, vec2<f32>(sp.originX, sp.originY));
    var c: Contact;
    c.key = key;
    c.nodeA = select(j, i, aIsLo);
    c.nodeB = select(i, j, aIsLo);
    c.iterLocal = info.z;
    c.pen = pen;
    c.nx = n.x; c.ny = n.y;
    c.hx = hit.x; c.hy = hit.y;
    contacts[ci] = c;
    contactKeys[ci] = vec4<u32>(key, info.z, atomicAdd(&keyCount[key], 1u), 0u);
  }
}
`;
const NARROW_BINDINGS = [['bodies', 'r'], ['nodeInfo', 'r'], ['worldPos', 'r'], ['gridHead', 'r', 'array<i32>'],
  ['staticHead', 'r'], ['pairFlags', 'rw'], ['collide', 'rw'], ['contacts', 'rw'], ['bodyNear', 'r'], ['contactKeys', 'rw'],
  ['keyCount', 'rw']];
K('narrow', NARROW_BINDINGS, /* wgsl */`
${NARROW_NODE(false)}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= cfg.nodeCount) { return; }
  narrowNode(gid.x);
}
`);
K('narrowList', [...NARROW_BINDINGS, ['candList', 'r'], ['loc', 'rw'], ['occFine', 'rw']], /* wgsl */`
${NARROW_NODE(true)}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= atomicLoad(&loc[LOC_CAND])) { return; }
  narrowNode(candList[gid.x]);
}
`);

// Też: miejsce pary w pairFlags (p + 2, dawniej dopiero na końcu agregatu) i koszyki kontaktów —
// agregat pary przegląda tylko swoje kontakty (dawniej wszystkie, ~20 razy w bisekcji limitu:
// przy rozpadzie na dziesiątki wraków to była połowa kroku).
K('pairArgs', [['collide', 'rw'], ['dispatchArgs', 'rw'], ['pairFlags', 'rw'], ['keyCount', 'rw'], ['pairRange', 'rw']], /* wgsl */`
var<workgroup> sScan: array<u32, ${MAX_PAIRS}>;
@compute @workgroup_size(${MAX_PAIRS})
fn main(@builtin(local_invocation_index) lid: u32) {
  let pairs = min(atomicLoad(&collide[0]), cfg.maxPairs);
  if (lid == 0u) {
    let contactCount = min(atomicLoad(&collide[1]), cfg.contactCapacity);
    dispatchArgs[0] = pairs; dispatchArgs[1] = 1u; dispatchArgs[2] = 1u;
    dispatchArgs[3] = (contactCount + 63u) / 64u; dispatchArgs[4] = 1u; dispatchArgs[5] = 1u;
  }
  var cnt = 0u;
  if (lid < pairs) {
    let key = atomicLoad(&collide[2u + lid]);
    cnt = atomicLoad(&keyCount[key]);
    atomicStore(&pairFlags[key], lid + 2u);
  }
  sScan[lid] = cnt;
  workgroupBarrier();
  for (var o = 1u; o < ${MAX_PAIRS}u; o = o << 1u) {
    var add = 0u;
    if (lid >= o) { add = sScan[lid - o]; }
    workgroupBarrier();
    sScan[lid] += add;
    workgroupBarrier();
  }
  pairRange[lid] = vec2<u32>(sScan[lid] - cnt, cnt);
}
`);

// Też: para z nadmiarem kontaktów (> maxContacts) dostaje zgrubny histogram klucza cyklicznego (12 górnych
// bitów) — agregat pary szuka progu tylko w jednym kubełku zamiast trzech przejść po wszystkich kontaktach
// (przy 1 j. para Atlas–kukła ma 30–60 tys. kontaktów na przebieg, a liczy ją jedna grupa robocza).
K('contactBin', [['collide', 'rw'], ['pairFlags', 'rw'], ['contactKeys', 'r'], ['pairRange', 'r'], ['pairBins', 'rw'],
  ['bodies', 'r'], ['pairHist', 'rw']], /* wgsl */`
fn keyOf(local: u32, cursor: u32, total: u32) -> u32 { return (local + total - (cursor % total)) % total; }
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= min(atomicLoad(&collide[1]), cfg.contactCapacity)) { return; }
  let ck = contactKeys[k];
  let p = atomicLoad(&pairFlags[ck.x]) - 2u;
  if (p >= cfg.maxPairs) { return; }
  let range = pairRange[p];
  pairBins[range.x + ck.z] = k;
  if (range.y > cfg.maxContacts) {
    let A = ck.x / cfg.maxBodies;
    let B = ck.x % cfg.maxBodies;
    let lst = bodies[select(A, B, bodies[A].list.z > bodies[B].list.z)].list;
    let v = keyOf(ck.y, lst.w, max(1u, lst.y));
    atomicAdd(&pairHist[p * 4096u + min(v >> 12u, 4095u)], 1u);
  }
}
`);

// Agregat pary (grupa robocza na parę): limit maxContacts od kursora ciała iterującego jak
// na CPU (pierwsze N węzłów w kolejności cyklicznej), sumy w stałym przecinku.
K('pairAggregate', [['bodies', 'r'], ['restMass', 'r'], ['contacts', 'r'], ['collide', 'rw'], ['pairFlags', 'rw'],
  ['pairData', 'rw'], ['massStamp', 'rw'], ['contactKeys', 'r'], ['pairRange', 'r'], ['pairBins', 'r'], ['pairHist', 'rw']], /* wgsl */`
const WG: u32 = 1024u;
const CACHE: u32 = 8u;   // kontaktów pary na wątek trzymanych w rejestrach (do 8192 bez ponownych odczytów)
var<workgroup> wKey: u32;
var<workgroup> wTotal: u32;
var<workgroup> wCursor: u32;
var<workgroup> wThreshold: u32;
var<workgroup> wCount: u32;
var<workgroup> wSel: vec2<u32>;
var<workgroup> hist: array<atomic<u32>, 4096>;
var<workgroup> sScan: array<u32, 1024>;
var<workgroup> wSelected: atomic<u32>;
var<workgroup> acc: array<atomic<i32>, 6>;
var<workgroup> accPen: atomic<u32>;

fn keyOf(local: u32, cursor: u32, total: u32) -> u32 { return (local + total - (cursor % total)) % total; }

@compute @workgroup_size(1024)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let p = wid.x;
  if (lid == 0u) {
    let key = atomicLoad(&collide[2u + p]);
    let A = key / cfg.maxBodies;
    let B = key % cfg.maxBodies;
    let iterBody = select(A, B, bodies[A].list.z > bodies[B].list.z);
    wKey = key;
    wTotal = max(1u, bodies[iterBody].list.y);
    wCursor = bodies[iterBody].list.w;
    for (var k = 0u; k < 6u; k++) { atomicStore(&acc[k], 0); }
    atomicStore(&accPen, 0u);
    atomicStore(&wSelected, 0u);
    pairData[p].iterBody = iterBody;
  }
  let key = workgroupUniformLoad(&wKey);
  let total = wTotal;
  let cursor = wCursor;
  // koszyk pary (pairArgs + contactBin): tylko jej kontakty, w dowolnej kolejności — sumy są w stałym przecinku
  let bin = pairRange[p];
  let nC = bin.y;
  if (lid == 0u) {
    wCount = nC;
    wThreshold = total;
  }
  let cnt = workgroupUniformLoad(&wCount);
  // klucze kontaktów raz z pamięci (pairBins → contactKeys: dwa zależne odczyty) do rejestrów;
  // przejścia histogramu i sumy czytają je stąd (dawniej 4 przejścia po pamięci, grupa 256 wątków)
  var kc: array<u32, 8>;
  var kv: array<u32, 8>;
  var nMine = 0u;
  for (var j = lid; j < min(nC, WG * CACHE); j += WG) {
    let k = pairBins[bin.x + j];
    kc[nMine] = k;
    kv[nMine] = keyOf(contactKeys[k].y, cursor, total);
    nMine++;
  }
  // najmniejszy próg T z liczbą kontaktów o kluczu < T ≥ maxContacts (klucze unikalne → dokładnie maxContacts)
  // = v* + 1, v* — maxContacts-ty najmniejszy klucz. Wybór pozycyjny po 8 bitach (klucz < 2^24, bo
  // < liczby węzłów ciała): 3 przejścia histogramem zamiast ~20 przeglądów bisekcji. Ten sam próg co
  // bisekcja (także przy powtórzonych kluczach). Przy rozpadzie na wraki jedna para potrafi mieć
  // dziesiątki tysięcy kontaktów, a liczy ją jedna grupa robocza.
  // najmniejszy próg T z liczbą kontaktów o kluczu < T ≥ maxContacts (klucze unikalne → dokładnie maxContacts)
  // = v* + 1, v* — maxContacts-ty najmniejszy klucz (klucz < 2^24). Kubełek 12 górnych bitów z histogramu
  // contactBin (prefiks po 4096 kubełkach), potem 12 dolnych bitów w tym kubełku — jedno przejście po
  // kontaktach pary. Ten sam próg co dawne przejścia po 8 bitach (także przy powtórzonych kluczach).
  if (cnt > cfg.maxContacts) {
    let M = cfg.maxContacts;
    var h4: array<u32, 4>;
    var s4 = 0u;
    for (var q = 0u; q < 4u; q++) {
      let a = p * 4096u + lid * 4u + q;
      h4[q] = atomicLoad(&pairHist[a]);
      atomicStore(&pairHist[a], 0u);          // pusty na następny przebieg
      s4 += h4[q];
    }
    sScan[lid] = s4;
    workgroupBarrier();
    for (var o = 1u; o < WG; o = o << 1u) {
      var add = 0u;
      if (lid >= o) { add = sScan[lid - o]; }
      workgroupBarrier();
      sScan[lid] += add;
      workgroupBarrier();
    }
    var excl = sScan[lid] - s4;
    if (excl < M && sScan[lid] >= M) {
      var b = 0u;
      loop { if (excl + h4[b] >= M || b == 3u) { break; } excl += h4[b]; b++; }
      wSel = vec2<u32>((lid * 4u + b) << 12u, M - excl);
    }
    for (var q = 0u; q < 4u; q++) { atomicStore(&hist[lid * 4u + q], 0u); }
    let sel = workgroupUniformLoad(&wSel);
    let coarse = sel.x >> 12u;
    for (var t = 0u; t < nMine; t++) {
      let v = kv[t];
      if ((v >> 12u) == coarse) { atomicAdd(&hist[v & 4095u], 1u); }
    }
    for (var j = WG * CACHE + lid; j < nC; j += WG) {
      let v = keyOf(contactKeys[pairBins[bin.x + j]].y, cursor, total);
      if ((v >> 12u) == coarse) { atomicAdd(&hist[v & 4095u], 1u); }
    }
    workgroupBarrier();
    s4 = 0u;
    for (var q = 0u; q < 4u; q++) { h4[q] = atomicLoad(&hist[lid * 4u + q]); s4 += h4[q]; }
    sScan[lid] = s4;
    workgroupBarrier();
    for (var o = 1u; o < WG; o = o << 1u) {
      var add = 0u;
      if (lid >= o) { add = sScan[lid - o]; }
      workgroupBarrier();
      sScan[lid] += add;
      workgroupBarrier();
    }
    excl = sScan[lid] - s4;
    if (excl < sel.y && sScan[lid] >= sel.y) {
      var b = 0u;
      loop { if (excl + h4[b] >= sel.y || b == 3u) { break; } excl += h4[b]; b++; }
      wThreshold = (sel.x | (lid * 4u + b)) + 1u;
    }
    workgroupBarrier();
  }
  let threshold = workgroupUniformLoad(&wThreshold);
  let stampVal = (sp.stamp << 8u) | (p & 255u);
  var selected = 0u;
  for (var t = 0u; t < nMine + max(nC, WG * CACHE) - WG * CACHE; t++) {
    var k = 0u;
    var v = 0u;
    if (t < nMine) { k = kc[t]; v = kv[t]; }
    else {
      let j = WG * CACHE + lid + (t - nMine) * WG;
      if (j >= nC) { break; }
      k = pairBins[bin.x + j];
      v = keyOf(contactKeys[k].y, cursor, total);
    }
    if (v >= threshold) { continue; }
    let ct = contacts[k];
    selected++;
    atomicAdd(&acc[0], i32(round(ct.hx * 64.0)));
    atomicAdd(&acc[1], i32(round(ct.hy * 64.0)));
    atomicAdd(&acc[2], i32(round(ct.nx * 4096.0)));
    atomicAdd(&acc[3], i32(round(ct.ny * 4096.0)));
    atomicMax(&accPen, bitcast<u32>(ct.pen));
    if (atomicExchange(&massStamp[ct.nodeA], stampVal) != stampVal) { atomicAdd(&acc[4], i32(round(restMass[ct.nodeA].z * 16.0))); }
    if (atomicExchange(&massStamp[ct.nodeB], stampVal) != stampVal) { atomicAdd(&acc[5], i32(round(restMass[ct.nodeB].z * 16.0))); }
  }
  if (selected > 0u) { atomicAdd(&wSelected, selected); }
  workgroupBarrier();
  if (lid == 0u) {
    var pd = pairData[p];
    pd.key = key;
    pd.bodyA = key / cfg.maxBodies;
    pd.bodyB = key % cfg.maxBodies;
    pd.count = atomicLoad(&wSelected);
    pd.total = cnt;
    pd.threshold = threshold;
    pd.flags = 0u;
    pd.cursor = cursor;
    pd.listTotal = total;
    pd.hitX = f32(atomicLoad(&acc[0])) / 64.0;
    pd.hitY = f32(atomicLoad(&acc[1])) / 64.0;
    pd.nX = f32(atomicLoad(&acc[2])) / 4096.0;
    pd.nY = f32(atomicLoad(&acc[3])) / 4096.0;
    pd.pen = bitcast<f32>(atomicLoad(&accPen));
    pd.massA = f32(atomicLoad(&acc[4])) / 16.0;
    pd.massB = f32(atomicLoad(&acc[5])) / 16.0;
    pairData[p] = pd;
    atomicStore(&pairFlags[key], p + 2u);
  }
}
`);

// Odpowiedź par po kolei (jeden wątek, pary w kolejności kluczy = kolejność dawnej pętli par):
// impuls ciał sztywnych, tarcie, granica plastyczności zgniotu, rozdzielenie, parametry zgniotu.
K('response', [['bodies', 'rw'], ['collide', 'rw'], ['pairData', 'rw'], ['counters', 'rw']], /* wgsl */`
// Odpowiedź par jak dawniej po kolei w kolejności kluczy, ale poziomami: para czeka tylko na wcześniejsze
// pary, które dzielą z nią ciało (poziom = 1 + najwyższy poziom tych par). Pary jednego poziomu nie
// mają wspólnych ciał — liczą się naraz, a wynik jest bit w bit ten sam co w pętli jednego wątku
// (te same działania w tej samej kolejności zależności). Przy rozpadzie na dziesiątki wraków
// jeden wątek był ~1/4 kroku (sortowanie wstawianiem po pamięci globalnej i pary po kolei).
var<workgroup> sKey: array<u32, ${MAX_PAIRS}>;
var<workgroup> sOrder: array<u32, ${MAX_PAIRS}>;
var<workgroup> sLevel: array<u32, ${MAX_PAIRS}>;
var<workgroup> sBodyLvl: array<u32, ${MAX_BODIES}>;
var<workgroup> wN: u32;
var<workgroup> wLevels: u32;
var<workgroup> wContacts: atomic<u32>;
var<workgroup> wMaxPair: atomic<u32>;
const SLOTS: u32 = 96u;
var<workgroup> sBody: array<Body, 96>;
var<workgroup> sSlot: array<u32, ${MAX_BODIES}>;
var<workgroup> sSlotBody: array<u32, 96>;
var<workgroup> wSlots: u32;
var<workgroup> sCnt: array<u32, ${MAX_PAIRS}>;

fn impulse(b: Body, r: vec2<f32>, j: vec2<f32>, invM: f32, invI: f32) -> Body {
  var o = b;
  if (invM <= 0.0) { return o; }
  o.motion = vec4<f32>(b.motion.xy + j * invM, b.motion.z, b.motion.w + invI * cross2(r, j));
  return o;
}

fn woken(b: Body) -> Body {
  var o = b;
  o.state.x = b.state.x & ~B_SLEEP;
  o.state.y = 0u;
  o.state.z = max(b.state.z, cfg.wakeHoldFrames);
  return o;
}

// Ciała par w pamięci grupy roboczej na czas całej odpowiedzi (sSlot: ciało → miejsce w sBody):
// poziomów bywa kilkadziesiąt (pary wraków z jednym kadłubem), a każdy czytał i pisał rekordy po 144 B
// w pamięci globalnej. Te same działania, ten sam wynik.
fn processPair(p: u32, pd0: PairData) {
  let dt = sp.dt;
  let doDamage = (sp.flags & S_DAMAGE) != 0u;
  var pd = pd0;
  pd.flags = 0u;
  if (pd.count == 0u) { pairData[p] = pd; return; }
  let A = pd.bodyA;
  let B = pd.bodyB;
  var a = woken(sBody[sSlot[A]]);
  var b = woken(sBody[sSlot[B]]);
  let aStatic = (a.state.x & B_STATIC) != 0u;
  let bStatic = (b.state.x & B_STATIC) != 0u;
  let count = f32(pd.count);
  atomicAdd(&wContacts, pd.count);
  atomicMax(&wMaxPair, pd.total);
  let ab = posDiff(a.pos, b.pos);
  let rA = vec2<f32>(pd.hitX, pd.hitY) / count;
  let rB = rA + ab;
  var n = vec2<f32>(pd.nX, pd.nY);
  var nLenSq = dot(n, n);
  if (nLenSq < 1e-12) {
    n = ab;
    nLenSq = dot(n, n);
    if (nLenSq < 1e-12) { n = vec2<f32>(1.0, 0.0); nLenSq = 1.0; }
  }
  n = n / sqrt(nLenSq);
  let contactDist = (a.shape.z + b.shape.z) * cfg.nodeRadiusRatio;
  let vA = a.motion.xy + vec2<f32>(-a.motion.w * rA.y, a.motion.w * rA.x);
  let vB = b.motion.xy + vec2<f32>(-b.motion.w * rB.y, b.motion.w * rB.x);
  let dv = vA - vB;
  let closing = dot(dv, ab);
  let speed = length(dv);
  let mA = a.massInfo.x;
  let mB = b.massInfo.x;
  let massRatio = max(mA, mB) / max(1.0, min(mA, mB));
  if (speed > cfg.crushSpeedThreshold &&
      ((closing < 0.0 && dot(dv, n) >= 0.0) || ((aStatic || bStatic || massRatio > 4.0) && pd.pen > contactDist * 0.2))) {
    n = -dv / speed;
  }
  let van = dot(dv, n);
  let approachV = max(0.0, -van);
  let massA = max(1.0, mA * a.massInfo.w);
  let massB = max(1.0, mB * b.massInfo.w);
  let invMassA = select(1.0 / massA, 0.0, aStatic);
  let invMassB = select(1.0 / massB, 0.0, bStatic);
  let invIA = select(a.massInfo.z / max(1e-6, a.massInfo.w), 0.0, aStatic);
  let invIB = select(b.massInfo.z / max(1e-6, b.massInfo.w), 0.0, bStatic);
  let crushing = approachV > cfg.crushSpeedThreshold;
  let transfer = select(0.0, clamp(cfg.crushTransfer, 0.0, 1.0), crushing);
  var jImp = 0.0;
  if (van < 0.0) {
    let rnA = cross2(rA, n);
    let rnB = cross2(rB, n);
    let denom = invMassA + invMassB + invIA * rnA * rnA + invIB * rnB * rnB;
    if (denom > 1e-9 && denom < 3.0e38) {
      let rest = select(cfg.restitution, 0.0, crushing);
      var j = (-(1.0 + rest) * van) / denom;
      if (crushing && cfg.crushStrength > 0.0) {
        // Granica plastyczności: impuls ≤ siła frontu styku (liczba kontaktów × masa węzła lżejszego).
        var light = b;
        if (bStatic) { light = a; } else if (!aStatic && mA <= mB) { light = a; }
        let nodeMass = light.massInfo.x / max(1.0, f32(light.list.z));
        let jYield = cfg.crushStrength * count * nodeMass / max(1e-6, light.shape.z) * dt;
        j = select(0.0, min(j, jYield), doDamage);
      } else if (crushing) {
        var share = max(pd.massA / mA, pd.massB / mB);
        if (aStatic) { share = pd.massB / mB; } else if (bStatic) { share = pd.massA / mA; }
        j *= select(0.0, (1.0 - pow(transfer, dt * 60.0)) * clamp(share, 0.04, 1.0), doDamage);
      }
      jImp = j;
      a = impulse(a, rA, n * j, invMassA, invIA);
      b = impulse(b, rB, -n * j, invMassB, invIB);
      var t = dv - n * van;
      let tLen = length(t);
      if (tLen > 1e-6) {
        t = t / tLen;
        var jt = -tLen / max(1e-9, invMassA + invMassB);
        let maxF = abs(j) * cfg.friction;
        if (jt < -maxF) { jt = -maxF; }
        a = impulse(a, rA, t * jt, invMassA, invIA);
        b = impulse(b, rB, -t * jt, invMassB, invIB);
      }
    }
  }
  if (doDamage && transfer > 0.0) {
    let total = massA + massB;
    var wA = pow(massB / total, cfg.crushMassBias);
    var wB = pow(massA / total, cfg.crushMassBias);
    if (aStatic) { wA = 0.0; } else if (bStatic) { wA = 1.0; }
    if (bStatic) { wB = 0.0; } else if (aStatic) { wB = 1.0; }
    var wsum = wA + wB;
    if (wsum <= 0.0) { wsum = 1.0; }
    let lnA = rot2T(a.rot.xy, n);
    let lnB = rot2T(b.rot.xy, -n);
    pd.flags = 1u;
    pd.scaleA = transfer * wA / wsum;
    pd.scaleB = transfer * wB / wsum;
    pd.travel = approachV * dt;
    pd.lnAx = lnA.x; pd.lnAy = lnA.y;
    pd.lnBx = lnB.x; pd.lnBy = lnB.y;
    pd.contactDist = contactDist;
    if (cfg.heatGain > 0.0) {
      let level = min(1.0, approachV / max(1e-6, cfg.heatSpeed)) * cfg.heatGain;
      pd.heat = level;
      if (level > 0.02) {
        if (level >= a.rot.z || sp.time - a.rot.w > cfg.heatWoundWindow) { a.rot = vec4<f32>(a.rot.xy, level, sp.time); }
        if (level >= b.rot.z || sp.time - b.rot.w > cfg.heatWoundWindow) { b.rot = vec4<f32>(b.rot.xy, level, sp.time); }
      }
    } else { pd.heat = 0.0; }
  }
  let slop = cfg.separationSlop;
  if (pd.pen > slop && (invMassA + invMassB) > 0.0) {
    let separation = 1.0 - pow(1.0 - cfg.separationPercent, dt * 60.0);
    let corr = (pd.pen - slop) / (invMassA + invMassB) * separation * (1.0 - transfer);
    a.pos = posAdd(a.pos, n * (corr * invMassA));
    b.pos = posAdd(b.pos, -n * (corr * invMassB));
  }
  if (doDamage && pd.total >= cfg.maxContacts) {
    if (pd.iterBody == A) { a.list.w = (a.list.w + pd.threshold) % max(1u, a.list.y); }
    else { b.list.w = (b.list.w + pd.threshold) % max(1u, b.list.y); }
  }
  pd.nX = n.x; pd.nY = n.y;
  pairData[p] = pd;
  sBody[sSlot[A]] = a;
  sBody[sSlot[B]] = b;
}
fn processPairGlobal(p: u32) {
  let dt = sp.dt;
  let doDamage = (sp.flags & S_DAMAGE) != 0u;
  var pd = pairData[p];
  pd.flags = 0u;
  if (pd.count == 0u) { pairData[p] = pd; return; }
  let A = pd.bodyA;
  let B = pd.bodyB;
  var a = woken(bodies[A]);
  var b = woken(bodies[B]);
  let aStatic = (a.state.x & B_STATIC) != 0u;
  let bStatic = (b.state.x & B_STATIC) != 0u;
  let count = f32(pd.count);
  atomicAdd(&wContacts, pd.count);
  atomicMax(&wMaxPair, pd.total);
  let ab = posDiff(a.pos, b.pos);
  let rA = vec2<f32>(pd.hitX, pd.hitY) / count;
  let rB = rA + ab;
  var n = vec2<f32>(pd.nX, pd.nY);
  var nLenSq = dot(n, n);
  if (nLenSq < 1e-12) {
    n = ab;
    nLenSq = dot(n, n);
    if (nLenSq < 1e-12) { n = vec2<f32>(1.0, 0.0); nLenSq = 1.0; }
  }
  n = n / sqrt(nLenSq);
  let contactDist = (a.shape.z + b.shape.z) * cfg.nodeRadiusRatio;
  let vA = a.motion.xy + vec2<f32>(-a.motion.w * rA.y, a.motion.w * rA.x);
  let vB = b.motion.xy + vec2<f32>(-b.motion.w * rB.y, b.motion.w * rB.x);
  let dv = vA - vB;
  let closing = dot(dv, ab);
  let speed = length(dv);
  let mA = a.massInfo.x;
  let mB = b.massInfo.x;
  let massRatio = max(mA, mB) / max(1.0, min(mA, mB));
  if (speed > cfg.crushSpeedThreshold &&
      ((closing < 0.0 && dot(dv, n) >= 0.0) || ((aStatic || bStatic || massRatio > 4.0) && pd.pen > contactDist * 0.2))) {
    n = -dv / speed;
  }
  let van = dot(dv, n);
  let approachV = max(0.0, -van);
  let massA = max(1.0, mA * a.massInfo.w);
  let massB = max(1.0, mB * b.massInfo.w);
  let invMassA = select(1.0 / massA, 0.0, aStatic);
  let invMassB = select(1.0 / massB, 0.0, bStatic);
  let invIA = select(a.massInfo.z / max(1e-6, a.massInfo.w), 0.0, aStatic);
  let invIB = select(b.massInfo.z / max(1e-6, b.massInfo.w), 0.0, bStatic);
  let crushing = approachV > cfg.crushSpeedThreshold;
  let transfer = select(0.0, clamp(cfg.crushTransfer, 0.0, 1.0), crushing);
  var jImp = 0.0;
  if (van < 0.0) {
    let rnA = cross2(rA, n);
    let rnB = cross2(rB, n);
    let denom = invMassA + invMassB + invIA * rnA * rnA + invIB * rnB * rnB;
    if (denom > 1e-9 && denom < 3.0e38) {
      let rest = select(cfg.restitution, 0.0, crushing);
      var j = (-(1.0 + rest) * van) / denom;
      if (crushing && cfg.crushStrength > 0.0) {
        // Granica plastyczności: impuls ≤ siła frontu styku (liczba kontaktów × masa węzła lżejszego).
        var light = b;
        if (bStatic) { light = a; } else if (!aStatic && mA <= mB) { light = a; }
        let nodeMass = light.massInfo.x / max(1.0, f32(light.list.z));
        let jYield = cfg.crushStrength * count * nodeMass / max(1e-6, light.shape.z) * dt;
        j = select(0.0, min(j, jYield), doDamage);
      } else if (crushing) {
        var share = max(pd.massA / mA, pd.massB / mB);
        if (aStatic) { share = pd.massB / mB; } else if (bStatic) { share = pd.massA / mA; }
        j *= select(0.0, (1.0 - pow(transfer, dt * 60.0)) * clamp(share, 0.04, 1.0), doDamage);
      }
      jImp = j;
      a = impulse(a, rA, n * j, invMassA, invIA);
      b = impulse(b, rB, -n * j, invMassB, invIB);
      var t = dv - n * van;
      let tLen = length(t);
      if (tLen > 1e-6) {
        t = t / tLen;
        var jt = -tLen / max(1e-9, invMassA + invMassB);
        let maxF = abs(j) * cfg.friction;
        if (jt < -maxF) { jt = -maxF; }
        a = impulse(a, rA, t * jt, invMassA, invIA);
        b = impulse(b, rB, -t * jt, invMassB, invIB);
      }
    }
  }
  if (doDamage && transfer > 0.0) {
    let total = massA + massB;
    var wA = pow(massB / total, cfg.crushMassBias);
    var wB = pow(massA / total, cfg.crushMassBias);
    if (aStatic) { wA = 0.0; } else if (bStatic) { wA = 1.0; }
    if (bStatic) { wB = 0.0; } else if (aStatic) { wB = 1.0; }
    var wsum = wA + wB;
    if (wsum <= 0.0) { wsum = 1.0; }
    let lnA = rot2T(a.rot.xy, n);
    let lnB = rot2T(b.rot.xy, -n);
    pd.flags = 1u;
    pd.scaleA = transfer * wA / wsum;
    pd.scaleB = transfer * wB / wsum;
    pd.travel = approachV * dt;
    pd.lnAx = lnA.x; pd.lnAy = lnA.y;
    pd.lnBx = lnB.x; pd.lnBy = lnB.y;
    pd.contactDist = contactDist;
    if (cfg.heatGain > 0.0) {
      let level = min(1.0, approachV / max(1e-6, cfg.heatSpeed)) * cfg.heatGain;
      pd.heat = level;
      if (level > 0.02) {
        if (level >= a.rot.z || sp.time - a.rot.w > cfg.heatWoundWindow) { a.rot = vec4<f32>(a.rot.xy, level, sp.time); }
        if (level >= b.rot.z || sp.time - b.rot.w > cfg.heatWoundWindow) { b.rot = vec4<f32>(b.rot.xy, level, sp.time); }
      }
    } else { pd.heat = 0.0; }
  }
  let slop = cfg.separationSlop;
  if (pd.pen > slop && (invMassA + invMassB) > 0.0) {
    let separation = 1.0 - pow(1.0 - cfg.separationPercent, dt * 60.0);
    let corr = (pd.pen - slop) / (invMassA + invMassB) * separation * (1.0 - transfer);
    a.pos = posAdd(a.pos, n * (corr * invMassA));
    b.pos = posAdd(b.pos, -n * (corr * invMassB));
  }
  if (doDamage && pd.total >= cfg.maxContacts) {
    if (pd.iterBody == A) { a.list.w = (a.list.w + pd.threshold) % max(1u, a.list.y); }
    else { b.list.w = (b.list.w + pd.threshold) % max(1u, b.list.y); }
  }
  pd.nX = n.x; pd.nY = n.y;
  pairData[p] = pd;
  bodies[A] = a;
  bodies[B] = b;
}

@compute @workgroup_size(${MAX_PAIRS})
fn main(@builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) {
    wN = min(atomicLoad(&collide[0]), cfg.maxPairs);
    atomicStore(&wContacts, 0u);
    atomicStore(&wMaxPair, 0u);
  }
  if (lid < ${MAX_BODIES}u) { sBodyLvl[lid] = 0u; sSlot[lid] = 0xffffffffu; }
  let nP = workgroupUniformLoad(&wN);
  if (lid < nP) { sKey[lid] = pairData[lid].key; sCnt[lid] = pairData[lid].count; }
  workgroupBarrier();
  if (lid < nP) {
    let key = sKey[lid];
    var rank = 0u;
    for (var j = 0u; j < nP; j++) { if (sKey[j] < key) { rank++; } }
    sOrder[rank] = lid;
  }
  workgroupBarrier();
  if (lid == 0u) {
    var levels = 1u;
    var slots = 0u;
    var overflow = false;
    for (var r = 0u; r < nP; r++) {
      let p = sOrder[r];
      if (sCnt[p] == 0u) { sLevel[r] = 0u; continue; }
      let A = sKey[p] / cfg.maxBodies;
      let B = sKey[p] % cfg.maxBodies;
      let lv = max(sBodyLvl[A], sBodyLvl[B]);
      sLevel[r] = lv;
      sBodyLvl[A] = lv + 1u;
      sBodyLvl[B] = lv + 1u;
      levels = max(levels, lv + 1u);
      if (sSlot[A] == 0xffffffffu && slots < SLOTS) { sSlot[A] = slots; sSlotBody[slots] = A; slots++; }
      if (sSlot[B] == 0xffffffffu && slots < SLOTS) { sSlot[B] = slots; sSlotBody[slots] = B; slots++; }
      if (sSlot[A] == 0xffffffffu || sSlot[B] == 0xffffffffu) { overflow = true; }
    }
    wLevels = select(levels, 0xffffffffu, overflow);
    wSlots = slots;
  }
  var L = workgroupUniformLoad(&wLevels);
  let nSlots = workgroupUniformLoad(&wSlots);
  if (L == 0xffffffffu) {
    // więcej niż SLOTS ciał w parach: wszystkie pary jednym wątkiem po kolei w pamięci globalnej
    if (lid == 0u) {
      for (var r = 0u; r < nP; r++) { processPairGlobal(sOrder[r]); }
      atomicAdd(&counters[${COUNTER.contacts}], select(0u, atomicLoad(&wContacts), (sp.flags & S_DAMAGE) != 0u));
      if ((sp.flags & S_DAMAGE) != 0u) {
        atomicMax(&counters[${COUNTER.pairs}], nP);
        atomicMax(&counters[${COUNTER.maxPairContacts}], atomicLoad(&wMaxPair));
      }
    }
    return;
  }
  for (var q = lid; q < nSlots; q += ${MAX_PAIRS}u) { sBody[q] = bodies[sSlotBody[q]]; }
  // rekord pary do rejestrów wątku przed pętlą poziomów (wszystkie odczyty naraz, nie po jednym na poziom)
  var myPd: PairData;
  if (lid < nP) { myPd = pairData[sOrder[lid]]; }
  workgroupBarrier();
  for (var lv = 0u; lv < L; lv++) {
    if (lid < nP && sLevel[lid] == lv) { processPair(sOrder[lid], myPd); }
    workgroupBarrier();
  }
  for (var q = lid; q < nSlots; q += ${MAX_PAIRS}u) { bodies[sSlotBody[q]] = sBody[q]; }
  if (lid == 0u && (sp.flags & S_DAMAGE) != 0u) {
    atomicAdd(&counters[${COUNTER.contacts}], atomicLoad(&wContacts));
    atomicMax(&counters[${COUNTER.pairs}], nP);
    atomicMax(&counters[${COUNTER.maxPairContacts}], atomicLoad(&wMaxPair));
  }
}
`);

// Zgniot, faza 1: najgłębsze wymuszenie na węzeł (kilka kontaktów → jeden węzeł, bez mnożenia).
// Węzeł w styku z kilkoma ciałami (po rozpadzie): kierunek zgniotu z pary o najmniejszym kluczu (crushKey).
// Dawniej wygrywał wątek, który pierwszy przestawił stempel — także kontakt niewybrany do limitu pary —
// i przebiegi rozjeżdżały się po pierwszym rozpadzie (także pełny solver sam ze sobą).
K('crushMark', [['contacts', 'r'], ['pairData', 'r'], ['pairFlags', 'rw'], ['collide', 'rw'], ['crush', 'rw'],
  ['nodeInfo', 'r'], ['crushKey', 'rw']], /* wgsl */`
fn keyOf(local: u32, cursor: u32, total: u32) -> u32 { return (local + total - (cursor % total)) % total; }
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= min(atomicLoad(&collide[1]), cfg.contactCapacity)) { return; }
  let c = contacts[k];
  let p = atomicLoad(&pairFlags[c.key]) - 2u;
  if (p >= cfg.maxPairs) { return; }
  let pd = pairData[p];
  if (pd.flags == 0u) { return; }
  // ten sam wybór co w agregacie (kursor sprzed odpowiedzi, zapisany w parze)
  if (pd.total > cfg.maxContacts && keyOf(c.iterLocal, pd.cursor, pd.listTotal) >= pd.threshold) { return; }
  let depth = min(pd.contactDist * 0.65, max(c.pen, pd.travel));
  if (pd.scaleA > 0.0 && (nodeInfo[c.nodeA].x & N_ACTIVE) != 0u) {
    atomicMax(&crush[c.nodeA * 2u], bitcast<u32>(depth * pd.scaleA));
    atomicMin(&crushKey[c.nodeA], pd.key);
  }
  if (pd.scaleB > 0.0 && (nodeInfo[c.nodeB].x & N_ACTIVE) != 0u) {
    atomicMax(&crush[c.nodeB * 2u], bitcast<u32>(depth * pd.scaleB));
    atomicMin(&crushKey[c.nodeB], pd.key);
  }
}
`);

// Zgniot, faza 2: węzeł przesuwa się raz o największą głębokość, z wyboczeniem na boki (_crushNode).
K('crushApply', [['contacts', 'r'], ['pairData', 'r'], ['pairFlags', 'rw'], ['collide', 'rw'], ['crush', 'rw'],
  ['posVel', 'rw'], ['restMass', 'r'], ['nodeAux', 'rw'], ['counters', 'rw'], ['crushKey', 'rw'], ['loc', 'rw'], ['listMark', 'rw'], ['actState', 'rw'], ['regionList', 'rw']], /* wgsl */`
${ACTIVATE}
fn crushNode(i: u32, ln: vec2<f32>, heat: f32, key: u32) {
  if (atomicLoad(&crushKey[i]) != key) { return; }
  if (atomicExchange(&crush[i * 2u + 1u], sp.stamp) == sp.stamp) { return; }
  atomicStore(&crushKey[i], 0xffffffffu);
  let d = bitcast<f32>(atomicExchange(&crush[i * 2u], 0u));
  if (d <= 0.0) { return; }
  let o = restMass[i].xy;
  let along = dot(o, ln);
  let t = o - along * ln;
  let side = cfg.crushBuckling / max(max(d * 2.0, length(t)), 1e-6);
  let nn = ln + t * side;
  var pv = posVel[i];
  pv = vec4<f32>(pv.xy + nn * d, pv.zw + nn * (d * 30.0));
  posVel[i] = pv;
  activate(i);
  atomicAdd(&counters[${COUNTER.crushNodes}], 1u);
  if (heat > 0.02) {
    var aux = nodeAux[i];
    let decayed = aux.y * exp(-max(0.0, sp.time - aux.z) * 0.35);
    if (heat > decayed) { aux.y = min(1.0, heat); aux.z = sp.time; nodeAux[i] = aux; }
  }
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= min(atomicLoad(&collide[1]), cfg.contactCapacity)) { return; }
  let c = contacts[k];
  let p = atomicLoad(&pairFlags[c.key]) - 2u;
  if (p >= cfg.maxPairs) { return; }
  let pd = pairData[p];
  if (pd.flags == 0u) { return; }
  let heat = pd.heat * cfg.heatContact;
  if (pd.scaleA > 0.0) { crushNode(c.nodeA, vec2<f32>(pd.lnAx, pd.lnAy), heat, pd.key); }
  if (pd.scaleB > 0.0) { crushNode(c.nodeB, vec2<f32>(pd.lnBx, pd.lnBy), heat, pd.key); }
}
`);

// ------------------------------------------------------------------ broń

// Strzały z rozkazów CPU (liczniki kadencji zostają na CPU; lufa liczona ze stanu ciała na GPU).
K('fire', [['bodies', 'r'], ['projectiles', 'rw'], ['counters', 'rw']], /* wgsl */`
@compute @workgroup_size(1)
fn main() {
  var cursor = atomicLoad(&counters[${COUNTER.projectileCursor}]);
  for (var k = 0u; k < min(sp.fireCount, 4u); k++) {
    let cmd = sp.fire[k];
    let kind = u32(cmd.x);
    let owner = u32(cmd.y);
    let o = bodies[owner];
    if ((o.state.x & (B_DEAD | B_STATIC)) != 0u || (o.state.x & B_USED) == 0u) { continue; }
    var slot = PROJECTILES;
    for (var s = 0u; s < PROJECTILES; s++) {
      let idx = (cursor + s) % PROJECTILES;
      if (projectiles[idx].tags.z == 0u) { slot = idx; cursor = (idx + 1u) % PROJECTILES; break; }
    }
    if (slot == PROJECTILES) { continue; }
    let cs2 = o.rot.xy;
    let nose = o.bounds.z + o.shape.z;
    let side = sp.fireSide[k] * (o.bounds.w - o.bounds.y) * 0.5 * 0.6;
    let muzzle = rot2(cs2, vec2<f32>(nose, side));
    let dir = rot2(cs2, vec2<f32>(sp.convergence, -side));
    let speed = select(sp.missileSpeed, sp.laserSpeed, kind == 0u);
    var p: Projectile;
    p.pos = posAdd(o.pos, muzzle);
    p.motion = vec4<f32>(normalize(dir) * speed + o.motion.xy, 0.0, select(6.0, 2.4, kind == 0u));
    p.data = vec4<f32>(cmd.z * select(2.0, 0.3, kind == 0u), cfg.cellSize * select(cmd.w, 1.15, kind == 0u), 0.0, 0.0);
    p.tags = vec4<u32>(kind, owner, 1u, 0u);
    projectiles[slot] = p;
    atomicAdd(&counters[select(${COUNTER.missilesFired}u, ${COUNTER.lasersFired}u, kind == 0u)], 1u);
  }
  atomicStore(&counters[${COUNTER.projectileCursor}], cursor);
}
`);

// Fale ciśnienia rakiet (updateBlasts): przyrost obrażeń i pchnięcie jako prędkość węzłów.
K('blasts', [['bodies', 'r'], ['blasts', 'rw'], ['impacts', 'rw'], ['weaponState', 'rw']], /* wgsl */`
fn progress(age: f32) -> f32 {
  let t = clamp(age / BLAST_DURATION, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
@compute @workgroup_size(32)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= BLASTS) { return; }
  var bl = blasts[k];
  if (bl.tags.y == 0u) { return; }
  let before = progress(bl.motion.z);
  bl.motion.z = min(BLAST_DURATION, bl.motion.z + sp.dt);
  let after = progress(bl.motion.z);
  let radius = bl.data.x;
  for (var bi = 0u; bi < cfg.bodyCount; bi++) {
    let b = bodies[bi];
    if ((b.state.x & B_USED) == 0u || (b.state.x & (B_DEAD | B_STATIC)) != 0u || bi == bl.tags.x) { continue; }
    let rel = posDiff(bl.pos, b.pos);
    if (length(rel) > b.shape.x + radius) { continue; }
    let slot = atomicAdd(&weaponState[0], 1u);
    if (slot >= cfg.impactCapacity) { continue; }
    let l = rot2T(b.rot.xy, rel);
    var dir = rot2T(b.rot.xy, bl.motion.xy);
    let dl = length(dir);
    dir = select(vec2<f32>(0.0), dir / dl, dl > 1e-6);
    var im: Impact;
    im.a = vec4<f32>(l, dir);
    im.b = vec4<f32>(bl.motion.w, radius, radius * 0.7, after - before);
    im.c = vec4<f32>(after, 0.12, cfg.impactPush * min(3.0, bl.motion.w / 200.0) * cfg.cellSize, 0.0);
    im.tags = vec4<u32>(bi, 1u, 0u, 0u);
    impacts[slot] = im;
  }
  if (bl.motion.z >= BLAST_DURATION) { bl.tags.y = 0u; }
  blasts[k] = bl;
}
`);

// Pociski: grupa robocza na pocisk, promień względem kół węzłów (traceBeamShot), detonacja.
K('projectiles', [['bodies', 'r'], ['nodeLists', 'r'], ['nodeInfo', 'r'], ['posVel', 'r'], ['projectiles', 'rw'],
  ['blasts', 'rw'], ['effects', 'rw'], ['impacts', 'rw'], ['weaponState', 'rw'], ['counters', 'rw']], /* wgsl */`
const WG: u32 = 64u;
var<workgroup> wP: Projectile;
var<workgroup> wAlive: u32;
var<workgroup> wCand: array<u32, ${MAX_BODIES}>;
var<workgroup> wCandN: atomic<u32>;
var<workgroup> wN: u32;
var<workgroup> sT: array<f32, 64>;
var<workgroup> sI: array<u32, 64>;
var<workgroup> wBestT: f32;
var<workgroup> wBestBody: u32;
var<workgroup> wBestNode: u32;
var<workgroup> wBody: u32;
var<workgroup> wList: vec4<u32>;
var<workgroup> wSkip: u32;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let pi = wid.x;
  if (lid == 0u) {
    wP = projectiles[pi];
    wAlive = wP.tags.z;
    atomicStore(&wCandN, 0u);
  }
  if (workgroupUniformLoad(&wAlive) == 0u) { return; }
  let p = wP;
  let speed = length(p.motion.xy);
  let stepT = min(sp.dt, p.motion.w - p.motion.z);
  let dir = select(vec2<f32>(1.0, 0.0), p.motion.xy / speed, speed > 1e-8);
  let dist = speed * stepT;
  // kandydaci: kula ciała przecina odcinek lotu
  for (var bi = lid; bi < cfg.bodyCount; bi += WG) {
    let b = bodies[bi];
    if ((b.state.x & B_USED) == 0u || (b.state.x & B_DEAD) != 0u || bi == p.tags.y) { continue; }
    let rel = posDiff(b.pos, p.pos);
    let along = clamp(dot(rel, dir), 0.0, dist);
    let perp = rel - dir * along;
    let rad = b.shape.x + b.shape.z;
    if (dot(perp, perp) > rad * rad) { continue; }
    wCand[atomicAdd(&wCandN, 1u)] = bi;
  }
  if (lid == 0u) {
    wN = atomicLoad(&wCandN);
    wBestT = dist;
    wBestBody = 0xffffffffu;
    wBestNode = 0u;
  }
  let nCand = workgroupUniformLoad(&wN);
  for (var ci = 0u; ci < nCand; ci++) {
    if (lid == 0u) {
      // kolejność kandydatów z atomów jest dowolna — przeglądamy od najmniejszego indeksu ciała
      var best = 0xffffffffu;
      var bestAt = 0u;
      for (var q = 0u; q < nCand; q++) { if (wCand[q] < best) { best = wCand[q]; bestAt = q; } }
      wCand[bestAt] = 0xffffffffu;
      wBody = best;
      wList = bodies[best].list;
      // Odcinek lotu poza obrysem węzłów ciała (+ promień węzła) = brak trafienia: bez przeglądu
      // wszystkich węzłów (przy 1,5 j. ~300 tys. na kadłub; kula ciała łapie pocisk dużo wcześniej).
      let cb = bodies[best];
      let o = rot2T(cb.rot.xy, posDiff(p.pos, cb.pos));
      let v = rot2T(cb.rot.xy, dir);
      let pad = cb.shape.z * 0.72 + 1e-3;
      let bmin = cb.bounds.xy - vec2<f32>(pad);
      let bmax = cb.bounds.zw + vec2<f32>(pad);
      var t0 = 0.0;
      var t1 = wBestT;
      for (var ax = 0; ax < 2; ax++) {
        let oa = o[ax];
        let va = v[ax];
        if (abs(va) < 1e-12) {
          if (oa < bmin[ax] || oa > bmax[ax]) { t0 = 1.0; t1 = 0.0; }
        } else {
          let ta = (bmin[ax] - oa) / va;
          let tb = (bmax[ax] - oa) / va;
          t0 = max(t0, min(ta, tb));
          t1 = min(t1, max(ta, tb));
        }
      }
      wSkip = select(0u, 1u, t0 > t1);
    }
    if (workgroupUniformLoad(&wSkip) != 0u) { continue; }
    let bi = workgroupUniformLoad(&wBody);
    let b = bodies[bi];
    let lst = wList;
    let lo = rot2T(b.rot.xy, posDiff(p.pos, b.pos));
    let lv = rot2T(b.rot.xy, dir);
    let nr = b.shape.z * 0.72;
    let limitT = wBestT;
    var bt = limitT;
    var bn = 0xffffffffu;
    for (var k = lid; k < lst.y; k += WG) {
      let i = nodeLists[lst.x + k];
      if ((nodeInfo[i].x & N_ACTIVE) == 0u) { continue; }
      let x = posVel[i].xy - lo;
      let t = dot(x, lv);
      let perp = max(0.0, dot(x, x) - t * t);
      if (perp > nr * nr) { continue; }
      let half = sqrt(nr * nr - perp);
      if (t + half < 0.0) { continue; }
      let entry = max(0.0, t - half);
      if (entry > bt || (entry == bt && i >= bn)) { continue; }
      bt = entry;
      bn = i;
    }
    sT[lid] = bt;
    sI[lid] = bn;
    workgroupBarrier();
    for (var s = WG / 2u; s > 0u; s = s >> 1u) {
      if (lid < s) {
        let o = lid + s;
        if (sT[o] < sT[lid] || (sT[o] == sT[lid] && sI[o] < sI[lid])) { sT[lid] = sT[o]; sI[lid] = sI[o]; }
      }
      workgroupBarrier();
    }
    if (lid == 0u && sI[0] != 0xffffffffu && sT[0] <= wBestT) {
      wBestT = sT[0];
      wBestBody = bi;
      wBestNode = sI[0];
    }
    workgroupBarrier();
  }
  if (lid != 0u) { return; }
  var q = wP;
  if (wBestBody != 0xffffffffu) {
    let b = bodies[wBestBody];
    let node = posVel[wBestNode].xy;
    let hitPos = posAdd(q.pos, dir * wBestT);
    let nodeWorld = posAdd(b.pos, rot2(b.rot.xy, node));
    let kind = q.tags.x;
    if (kind == 0u) {
      if ((b.state.x & B_STATIC) == 0u) {
        let slot = atomicAdd(&weaponState[0], 1u);
        if (slot < cfg.impactCapacity) {
          var ld = rot2T(b.rot.xy, q.motion.xy);
          let dl = length(ld);
          ld = select(vec2<f32>(0.0), ld / dl, dl > 1e-6);
          var im: Impact;
          im.a = vec4<f32>(node, ld);
          im.b = vec4<f32>(q.data.x, q.data.y, q.data.y * 0.45, 1.0);
          im.c = vec4<f32>(1.0, 0.0, cfg.impactPush * min(3.0, q.data.x / 200.0) * cfg.cellSize, 0.0);
          im.tags = vec4<u32>(wBestBody, 0u, 0u, 0u);
          impacts[slot] = im;
        }
      }
      atomicAdd(&counters[${COUNTER.laserHits}], 1u);
    } else {
      for (var s = 0u; s < BLASTS; s++) {
        if (blasts[s].tags.y != 0u) { continue; }
        var bl: Blast;
        bl.pos = nodeWorld;
        bl.motion = vec4<f32>(q.motion.xy, 0.0, q.data.x);
        bl.data = vec4<f32>(q.data.y, 0.0, 0.0, 0.0);
        bl.tags = vec4<u32>(q.tags.y, 1u, 0u, 0u);
        blasts[s] = bl;
        break;
      }
      atomicAdd(&counters[${COUNTER.missileHits}], 1u);
    }
    let ei = atomicAdd(&counters[${COUNTER.effectCursor}], 1u) % EFFECTS;
    var ef: Effect;
    ef.pos = hitPos;
    ef.data = vec4<f32>(sp.time, select(0.7, 0.16, kind == 0u), select(q.data.y, cfg.cellSize * 0.6, kind == 0u), f32(kind));
    effects[ei] = ef;
    q.tags.z = 0u;
  } else {
    q.pos = posAdd(q.pos, q.motion.xy * stepT);
  }
  q.motion.z += stepT;
  if (q.motion.z >= q.motion.w - 1e-6) { q.tags.z = 0u; }
  projectiles[pi] = q;
}
`);

K('impactArgs', [['weaponState', 'rw'], ['dispatchArgs', 'rw']], /* wgsl */`
@compute @workgroup_size(1)
fn main() {
  let n = min(atomicLoad(&weaponState[0]), cfg.impactCapacity);
  let nodes = select(0u, (cfg.nodeCount + 63u) / 64u, n > 0u);
  let beams = select(0u, (cfg.beamCount + 63u) / 64u, n > 0u);
  dispatchArgs[6] = nodes; dispatchArgs[7] = 1u; dispatchArgs[8] = 1u;
  dispatchArgs[9] = beams; dispatchArgs[10] = 1u; dispatchArgs[11] = 1u;
}
`);

// Trafienia w węzły (applyImpact, tryb bez krateru jak w demie): HP z opadaniem, pchnięcie
// (laser: przesunięcie; fala rakiety: prędkość), węzeł z HP ≤ 0 do zniszczenia.
K('impactNodes', [['nodeInfo', 'rw'], ['posVel', 'rw'], ['restMass', 'rw'], ['impacts', 'r'], ['weaponState', 'rw'],
  ['bodyEvents', 'rw'], ['counters', 'rw'], ['loc', 'rw'], ['listMark', 'rw'], ['actState', 'rw'], ['regionList', 'rw']], /* wgsl */`
${ACTIVATE}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  var info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) != 0u) { return; }
  let n = min(atomicLoad(&weaponState[0]), cfg.impactCapacity);
  var pv = posVel[i];
  var rm = restMass[i];
  var touched = false;
  for (var k = 0u; k < n; k++) {
    let im = impacts[k];
    if (im.tags.x != info.y) { continue; }
    let d = pv.xy - im.a.xy;
    let d2 = dot(d, d);
    let r = im.b.y;
    if (d2 > r * r) { continue; }
    touched = true;
    atomicOr(&bodyEvents[info.y], E_WAKE | E_INTEGRITY);
    let falloff = 1.0 - sqrt(d2) / r;
    let influence = falloff * falloff * (3.0 - 2.0 * falloff);
    rm.w -= im.b.x * 0.5 * influence * im.b.w;
    let push = im.c.z;
    if (im.c.y > 0.0) {
      let len = sqrt(d2);
      let radial = select(0.0, 0.7 / len, len > 1e-6);
      let v = d * radial + im.a.zw * select(1.0, 0.3, radial > 0.0);
      pv = vec4<f32>(pv.xy, pv.zw + v * (push * influence * im.b.w / im.c.y));
    } else {
      pv = vec4<f32>(pv.xy + im.a.zw * (push * influence * im.b.w), pv.zw);
    }
  }
  if (!touched) { return; }
  posVel[i] = pv;
  restMass[i] = rm;
  activate(i);
  if (rm.w <= 0.0) { nodeInfo[i].x = info.x | N_DOOMED; }
}
`);

// Zerwania belek w rdzeniu trafienia (środek belki w promieniu, obrażenia ≥ odporność typu).
K('impactBeams', [['nodeInfo', 'r'], ['posVel', 'r'], ['beamEnds', 'r'], ['beamFlags', 'rw'], ['impacts', 'r'],
  ['weaponState', 'rw'], ['bodyEvents', 'rw'], ['counters', 'rw'], ['loc', 'rw'], ['listMark', 'rw'], ['actState', 'rw'], ['regionList', 'rw']], /* wgsl */`
${ACTIVATE}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let e = gid.x;
  if (e >= cfg.beamCount) { return; }
  let fl = beamFlags[e];
  if ((fl & 1u) != 0u) { return; }
  let ends = beamEnds[e];
  let body = nodeInfo[ends.x].y;
  let n = min(atomicLoad(&weaponState[0]), cfg.impactCapacity);
  let btype = (fl >> 8u) & 255u;
  let resist = select(select(90.0, 260.0, btype == 2u), 380.0, btype == 3u);
  for (var k = 0u; k < n; k++) {
    let im = impacts[k];
    if (im.tags.x != body) { continue; }
    let mid = (posVel[ends.x].xy + posVel[ends.y].xy) * 0.5 - im.a.xy;
    if (dot(mid, mid) > im.b.z * im.b.z) { continue; }
    if (im.b.x * im.c.x < resist) { continue; }
    beamFlags[e] = fl | 1u;
    atomicAdd(&counters[${COUNTER.beamsBroken}], 1u);
    atomicOr(&bodyEvents[body], E_DIRTY);
    activate(ends.x);
    activate(ends.y);
    return;
  }
}
`);

// Śmierć węzła (destroyNode): węzeł gaśnie, jego belki pękają, powstaje odłamek blachy.
K('deaths', [['bodies', 'r'], ['nodeInfo', 'rw'], ['posVel', 'r'], ['restMass', 'rw'], ['nodeMeta', 'r'], ['adj', 'r'],
  ['beamFlags', 'rw', 'array<atomic<u32>>'], ['nodeAux', 'r'], ['debris', 'rw'], ['counters', 'rw'], ['bodyEvents', 'rw'],
  ['beamEnds', 'r'], ['loc', 'rw'], ['listMark', 'rw'], ['actState', 'rw'], ['regionList', 'rw']], /* wgsl */`
${ACTIVATE}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_DOOMED) == 0u) { return; }
  nodeInfo[i].x = info.x & ~(N_ACTIVE | N_DOOMED);
  restMass[i].w = 0.0;
  let m = nodeMeta[i];
  var broke = 0u;
  for (var q = m.x; q < m.y; q++) {
    let old = atomicOr(&beamFlags[adj[q]], 1u);
    if ((old & 1u) == 0u) { broke++; }
    // activateNeighbors (destroyNode): sąsiedzi tracą oparcie
    let ends = beamEnds[adj[q]];
    let o = ends.x ^ ends.y ^ i;
    if ((nodeInfo[o].x & N_ACTIVE) != 0u) { activate(o); }
  }
  atomicAdd(&counters[${COUNTER.beamsBroken}], broke);
  atomicAdd(&counters[${COUNTER.nodesKilled}], 1u);
  atomicOr(&bodyEvents[info.y], E_DIRTY);
  let b = bodies[info.y];
  let pv = posVel[i];
  let r = rot2(b.rot.xy, pv.xy);
  let vel = b.motion.xy + vec2<f32>(-b.motion.w * r.y, b.motion.w * r.x) + rot2(b.rot.xy, pv.zw);
  let slot = atomicAdd(&counters[${COUNTER.debrisCursor}], 1u) % cfg.debrisCapacity;
  let seed = i * 1664525u + sp.stamp * 22695477u;
  let structural = select(0.0, 1.0, m.z > m.w && hash11(seed) < 0.4);
  var d: Debris;
  d.pos = posAdd(b.pos, r);
  d.motion = vec4<f32>(vel, sp.time, 8.0);
  d.look = vec4<f32>(b.shape.z * (0.5 + hash11(seed + 1u) * 0.45), hash11(seed + 2u) * TAU, (hash11(seed + 3u) - 0.5) * 8.0, structural);
  d.color = vec4<u32>(bitcast<u32>(nodeAux[i].w), 0u, 0u, 0u);
  debris[slot] = d;
}
`);

// Integralność (_refreshNodeIntegrity) dla ciał trafionych w tym podkroku: migawka liczby żywych
// belek, węzeł z ≤ 22% pierwotnego oparcia do zniszczenia (zniszczy go drugie 'deaths').
K('integrity', [['nodeInfo', 'rw'], ['nodeMeta', 'r'], ['adj', 'r'], ['beamFlags', 'r'], ['bodyEvents', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) != 0u) { return; }
  if ((atomicLoad(&bodyEvents[info.y]) & E_INTEGRITY) == 0u) { return; }
  let m = nodeMeta[i];
  if (m.z == 0u) { return; }
  var live = 0u;
  for (var q = m.x; q < m.y; q++) { if ((beamFlags[adj[q]] & 1u) == 0u) { live++; } }
  if (live <= max(1u, u32(floor(f32(m.z) * 0.22)))) { nodeInfo[i].x = info.x | N_DOOMED; }
}
`);

// ------------------------------------------------------------------ topologia (rozpady z CPU)

// Flagi do odczytu: zerwane belki i żywe węzły, po 32 na słowo.
K('topoPack', [['beamFlags', 'r'], ['nodeInfo', 'r'], ['topoBits', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = gid.x;
  let beamWords = (cfg.beamCount + 31u) / 32u;
  let nodeWords = (cfg.nodeCount + 31u) / 32u;
  if (w < beamWords) {
    var bits = 0u;
    for (var k = 0u; k < 32u; k++) {
      let e = w * 32u + k;
      if (e < cfg.beamCount && (beamFlags[e] & 1u) != 0u) { bits = bits | (1u << k); }
    }
    topoBits[w] = bits;
  } else if (w < beamWords + nodeWords) {
    let nw = w - beamWords;
    var bits = 0u;
    for (var k = 0u; k < 32u; k++) {
      let i = nw * 32u + k;
      if (i < cfg.nodeCount && (nodeInfo[i].x & N_ACTIVE) != 0u) { bits = bits | (1u << k); }
    }
    topoBits[w] = bits;
  }
}
`);

// Rozkazy CPU: zerwij belki (mosty rozdartych połączeń), zniszcz węzły (drobne odpryski).
K('topoBreak', [['topoList', 'r'], ['beamFlags', 'rw', 'array<atomic<u32>>'], ['counters', 'rw'], ['beamEnds', 'r'],
  ['loc', 'rw'], ['listMark', 'rw'], ['actState', 'rw'], ['regionList', 'rw']], /* wgsl */`
${ACTIVATE}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = topoList[0];
  if (gid.x >= n) { return; }
  let e = topoList[1u + gid.x];
  let old = atomicOr(&beamFlags[e], 1u);
  if ((old & 1u) == 0u) { atomicAdd(&counters[${COUNTER.beamsBroken}], 1u); }
  activate(beamEnds[e].x);
  activate(beamEnds[e].y);
}
`);

K('topoDoom', [['topoList', 'r'], ['nodeInfo', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = topoList[0];
  let k = gid.x;
  let nb = topoList[1u + n];
  if (k >= nb) { return; }
  let i = topoList[2u + n + k];
  if ((nodeInfo[i].x & N_ACTIVE) != 0u) { nodeInfo[i].x = nodeInfo[i].x | N_DOOMED; }
}
`);

// Przypisanie węzłów do list ciał (po podziale): ciało, pozycja na liście, belki bazowe = żywe.
K('topoAssign', [['topoOps', 'r'], ['bodies', 'r'], ['nodeLists', 'r'], ['nodeInfo', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let op = topoOps[wid.y];
  let lst = bodies[op.body].list;
  let k = wid.x * 64u + lid;
  if (k >= lst.y) { return; }
  let i = nodeLists[lst.x + k];
  nodeInfo[i].y = op.body;
  nodeInfo[i].z = k;
}
`);

K('topoCut', [['topoOps', 'r'], ['bodies', 'r'], ['nodeLists', 'r'], ['nodeInfo', 'r'], ['nodeMeta', 'rw'],
  ['adj', 'r'], ['beamFlags', 'rw', 'array<atomic<u32>>'], ['beamEnds', 'r'], ['counters', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let op = topoOps[wid.y];
  let lst = bodies[op.body].list;
  let k = wid.x * 64u + lid;
  if (k >= lst.y) { return; }
  let i = nodeLists[lst.x + k];
  let m = nodeMeta[i];
  var live = 0u;
  for (var q = m.x; q < m.y; q++) {
    let e = adj[q];
    let ends = beamEnds[e];
    let o = select(ends.x, ends.y, ends.x == i);
    if (nodeInfo[o].y != op.body) {
      let old = atomicOr(&beamFlags[e], 1u);
      if ((old & 1u) == 0u) { atomicAdd(&counters[${COUNTER.beamsBroken}], 1u); }
      continue;
    }
    if ((atomicLoad(&beamFlags[e]) & 1u) == 0u) { live++; }
  }
  nodeMeta[i].z = live;
}
`);

// Nowy układ ciała na jego liście węzłów (_spawnWreck / _rebuildBody + _transferFragmentMotion):
// środek masy spoczynkowy, masa, bezwładność, przesunięcie węzłów, pęd lokalny → ciało sztywne.
// Wraki czytają stan rodzica sprzed przebudowy — dlatego dwa przebiegi (najpierw wraki, potem
// rodzice); sp.opOffset = początek przebiegu na liście operacji.
K('reseat', [['topoOps', 'r'], ['bodies', 'rw'], ['nodeLists', 'r'], ['nodeInfo', 'r'], ['restMass', 'rw'],
  ['posVel', 'rw'], ['prev', 'rw']], /* wgsl */`
const WG: u32 = 256u;
var<workgroup> s0: array<f32, 256>;
var<workgroup> s1: array<f32, 256>;
var<workgroup> s2: array<f32, 256>;
var<workgroup> s3: array<f32, 256>;
var<workgroup> s4: array<f32, 256>;
var<workgroup> s5: array<f32, 256>;
var<workgroup> s6: array<f32, 256>;
var<workgroup> wList: vec4<u32>;
var<workgroup> wOut: vec4<f32>;     // com.xy, cur.xy
var<workgroup> wOut2: vec4<f32>;    // vb.xy, omega, —

fn reduceSums(lid: u32) {
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s = s >> 1u) {
    if (lid < s) {
      let o = lid + s;
      s0[lid] += s0[o]; s1[lid] += s1[o]; s2[lid] += s2[o]; s3[lid] += s3[o];
      s4[lid] += s4[o]; s5[lid] += s5[o]; s6[lid] += s6[o];
    }
    workgroupBarrier();
  }
}

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let op = topoOps[wid.x + sp.opOffset];
  if (lid == 0u) { wList = bodies[op.body].list; }
  let lst = workgroupUniformLoad(&wList);
  if (lst.y == 0u) { return; }
  // przebieg 1: masa, środek spoczynkowy (com), środek bieżący i pęd (układ rodzica)
  var m = 0.0; var ox = 0.0; var oy = 0.0; var xx = 0.0; var xy = 0.0; var vx = 0.0; var vy = 0.0;
  for (var k = lid; k < lst.y; k += WG) {
    let i = nodeLists[lst.x + k];
    if ((nodeInfo[i].x & N_ACTIVE) == 0u) { continue; }
    let rm = restMass[i];
    let pv = posVel[i];
    m += rm.z; ox += rm.x * rm.z; oy += rm.y * rm.z;
    xx += pv.x * rm.z; xy += pv.y * rm.z; vx += pv.z * rm.z; vy += pv.w * rm.z;
  }
  s0[lid] = m; s1[lid] = ox; s2[lid] = oy; s3[lid] = xx; s4[lid] = xy; s5[lid] = vx; s6[lid] = vy;
  reduceSums(lid);
  let M = max(1e-9, s0[0]);
  let com = vec2<f32>(s1[0], s2[0]) / M;
  let cur = vec2<f32>(s3[0], s4[0]) / M - com;      // środek bieżący po przesunięciu o com
  let vb = vec2<f32>(s5[0], s6[0]) / M;
  workgroupBarrier();
  // przebieg 2: bezwładność wokół com, moment pędu względem środka bieżącego, promień
  let cs = bodies[op.body].shape.z;
  let cube = cs * cs / 6.0;
  var izz = 0.0; var L = 0.0; var r2 = 0.0;
  for (var k = lid; k < lst.y; k += WG) {
    let i = nodeLists[lst.x + k];
    if ((nodeInfo[i].x & N_ACTIVE) == 0u) { continue; }
    let rm = restMass[i];
    let pv = posVel[i];
    let o = rm.xy - com;
    izz += rm.z * (dot(o, o) + cube);
    L += rm.z * cross2((pv.xy - com) - cur, pv.zw - vb);
    r2 = max(r2, dot(o, o));
  }
  s0[lid] = izz; s1[lid] = L; s2[lid] = 0.0; s3[lid] = 0.0; s4[lid] = 0.0; s5[lid] = 0.0; s6[lid] = 0.0;
  reduceSums(lid);
  let izzSum = s0[0];
  let Lsum = s1[0];
  workgroupBarrier();
  s0[lid] = r2;
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s = s >> 1u) {
    if (lid < s) { s0[lid] = max(s0[lid], s0[lid + s]); }
    workgroupBarrier();
  }
  if (lid == 0u) {
    let invI = select(0.0, 1.0 / izzSum, izzSum > 1e-9);
    var omega = Lsum * invI;
    omega = omega * min(1.0, 6.0 / max(abs(omega), 1e-9));
    let base = bodies[select(op.body, op.parent, op.isWreck != 0u)];
    var b = bodies[op.body];
    let shift = rot2(base.rot.xy, com);
    b.pos = posAdd(base.pos, shift);
    var vel = base.motion.xy + vec2<f32>(-base.motion.w * shift.y, base.motion.w * shift.x);
    var w = base.motion.w;
    // _transferFragmentMotion: średnia i moment pola prędkości węzłów → ruch ciała
    vel += rot2(base.rot.xy, vec2<f32>(vb.x + omega * cur.y, vb.y - omega * cur.x));
    w += omega;
    if (op.isWreck != 0u) {
      let outLen = length(shift);
      if (outLen > 1e-4) {
        vel += shift / outLen * cfg.wreckKick;
        w += shift.x / outLen * cfg.wreckSpin;
      }
      b.shape.y = base.shape.y;
    }
    b.motion = vec4<f32>(vel, base.motion.z, w);
    b.rot = vec4<f32>(base.rot.xy, 0.0, 0.0);
    b.massInfo = vec4<f32>(M, 1.0 / M, invI, b.massInfo.w);
    b.shape.x = sqrt(s0[0]) + b.shape.z;
    b.state.x = (b.state.x & ~(B_SLEEP | B_DEAD)) | B_RECENTRE;   // solver lokalny: statystyki i obrys od nowa
    b.state.y = 0u;
    b.state.z = cfg.wakeHoldFrames;
    b.list.w = 0u;
    b.transfer = vec4<f32>(0.0);
    bodies[op.body] = b;
    wOut = vec4<f32>(com, cur);
    wOut2 = vec4<f32>(vb, omega, 0.0);
  }
  workgroupBarrier();
  let c = wOut.xy;
  let cr = wOut.zw;
  let v0 = wOut2.xy;
  let om = wOut2.z;
  for (var k = lid; k < lst.y; k += WG) {
    let i = nodeLists[lst.x + k];
    let rm = restMass[i];
    let pv = posVel[i];
    let x = pv.xy - c;
    let r = x - cr;
    restMass[i] = vec4<f32>(rm.xy - c, rm.zw);
    posVel[i] = vec4<f32>(x, pv.zw - (v0 + vec2<f32>(-om * r.y, om * r.x)));
    prev[i] = prev[i] - c;
  }
}
`);

// Ten sam reseat po kawałkach listy (REDUCE_CHUNK węzłów na grupę roboczą): dawniej jedna grupa 256
// wątków na ciało przechodziła 3 razy po całej liście — przy 1 j. rodzic ma ~670 tys. węzłów i każdy
// rozpad kosztował ~7 ms. Sumy częściowe → złożenie na ciało → drugi przebieg → ciało → zastosowanie.
// Kolejność ciał jak dawniej: wraki czytają rodzica sprzed przebudowy (reseatFinal2 najpierw dla wraków).
// Bufor partials (ten sam co redukcji ciał; rozpady idą przed krokami), reseatTmp: na operację com, cur,
// vb, ω. Kolejność sum inna niż w jednej grupie (wynik różni się na poziomie zaokrągleń).
const RESEAT_SUM = (second) => /* wgsl */`
const WG: u32 = 256u;
const CHUNK: u32 = ${REDUCE_CHUNK}u;
var<workgroup> s0: array<f32, 256>;
var<workgroup> s1: array<f32, 256>;
var<workgroup> s2: array<f32, 256>;
var<workgroup> s3: array<f32, 256>;
var<workgroup> s4: array<f32, 256>;
var<workgroup> s5: array<f32, 256>;
var<workgroup> s6: array<f32, 256>;
var<workgroup> wList: vec4<u32>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let opi = wid.y;
  let chunk = wid.x;
  if (lid == 0u) { wList = bodies[topoOps[opi].body].list; }
  let lst = workgroupUniformLoad(&wList);
  if (chunk * CHUNK >= lst.y) { return; }
  let end = min(lst.y, (chunk + 1u) * CHUNK);
  ${second ? `let t0 = reseatTmp[opi * 2u];
  let t1 = reseatTmp[opi * 2u + 1u];
  let com = t0.xy;
  let cur = t0.zw;
  let vb = t1.xy;
  let cs = bodies[topoOps[opi].body].shape.z;
  let cube = cs * cs / 6.0;
  var izz = 0.0; var L = 0.0; var r2 = 0.0;
  for (var k = chunk * CHUNK + lid; k < end; k += WG) {
    let i = nodeLists[lst.x + k];
    if ((nodeInfo[i].x & N_ACTIVE) == 0u) { continue; }
    let rm = restMass[i];
    let pv = posVel[i];
    let o = rm.xy - com;
    izz += rm.z * (dot(o, o) + cube);
    L += rm.z * cross2((pv.xy - com) - cur, pv.zw - vb);
    r2 = max(r2, dot(o, o));
  }
  s0[lid] = izz; s1[lid] = L; s2[lid] = r2;` : `var m = 0.0; var ox = 0.0; var oy = 0.0; var xx = 0.0; var xy = 0.0; var vx = 0.0; var vy = 0.0;
  for (var k = chunk * CHUNK + lid; k < end; k += WG) {
    let i = nodeLists[lst.x + k];
    if ((nodeInfo[i].x & N_ACTIVE) == 0u) { continue; }
    let rm = restMass[i];
    let pv = posVel[i];
    m += rm.z; ox += rm.x * rm.z; oy += rm.y * rm.z;
    xx += pv.x * rm.z; xy += pv.y * rm.z; vx += pv.z * rm.z; vy += pv.w * rm.z;
  }
  s0[lid] = m; s1[lid] = ox; s2[lid] = oy; s3[lid] = xx; s4[lid] = xy; s5[lid] = vx; s6[lid] = vy;`}
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s = s >> 1u) {
    if (lid < s) {
      let o = lid + s;
      ${second ? 's0[lid] += s0[o]; s1[lid] += s1[o]; s2[lid] = max(s2[lid], s2[o]);'
        : 's0[lid] += s0[o]; s1[lid] += s1[o]; s2[lid] += s2[o]; s3[lid] += s3[o]; s4[lid] += s4[o]; s5[lid] += s5[o]; s6[lid] += s6[o];'}
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    let o = (opi * cfg.reduceStride + chunk) * 4u;
    ${second ? 'partials[o + 2u] = vec4<f32>(s0[0], s1[0], s2[0], 0.0);'
      : 'partials[o] = vec4<f32>(s0[0], s1[0], s2[0], s3[0]);\n    partials[o + 1u] = vec4<f32>(s4[0], s5[0], s6[0], 0.0);'}
  }
}
`;
const RESEAT_SUM_BINDINGS = [['topoOps', 'r'], ['bodies', 'r'], ['nodeLists', 'r'], ['nodeInfo', 'r'], ['restMass', 'r'],
  ['posVel', 'r'], ['partials', 'rw']];
K('reseatSum1', RESEAT_SUM_BINDINGS, RESEAT_SUM(false));
K('reseatSum2', [...RESEAT_SUM_BINDINGS, ['reseatTmp', 'r']], RESEAT_SUM(true));

// Złożenie sum kawałków ciała (grupa 64 wątki na operację, kolejność stała).
const RESEAT_GATHER = (n, combine) => /* wgsl */`
var<workgroup> sA: array<vec4<f32>, 64>;
var<workgroup> sB: array<vec4<f32>, 64>;
var<workgroup> wList: vec4<u32>;
fn gather(opi: u32, lid: u32) {
  if (lid == 0u) { wList = bodies[topoOps[opi].body].list; }
  let lst = workgroupUniformLoad(&wList);
  let chunks = (lst.y + ${REDUCE_CHUNK - 1}u) / ${REDUCE_CHUNK}u;
  var a = vec4<f32>(0.0);
  var b = vec4<f32>(0.0);
  for (var k = lid; k < chunks; k += 64u) {
    let o = (opi * cfg.reduceStride + k) * 4u;
    ${combine}
  }
  sA[lid] = a; sB[lid] = b;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (lid < s) { ${n === 1 ? 'sA[lid] = vec4<f32>(sA[lid].xy + sA[lid + s].xy, max(sA[lid].z, sA[lid + s].z), 0.0);'
      : 'sA[lid] += sA[lid + s]; sB[lid] += sB[lid + s];'} }
    workgroupBarrier();
  }
}
`;
K('reseatFinal1', [['topoOps', 'r'], ['bodies', 'r'], ['partials', 'r'], ['reseatTmp', 'rw']], /* wgsl */`
${RESEAT_GATHER(2, 'a += partials[o]; b += partials[o + 1u];')}
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  gather(wid.x, lid);
  if (lid != 0u) { return; }
  let A = sA[0];
  let Bv = sB[0];
  let M = max(1e-9, A.x);
  let com = vec2<f32>(A.y, A.z) / M;
  let cur = vec2<f32>(A.w, Bv.x) / M - com;      // środek bieżący po przesunięciu o com
  let vb = vec2<f32>(Bv.y, Bv.z) / M;
  reseatTmp[wid.x * 2u] = vec4<f32>(com, cur);
  reseatTmp[wid.x * 2u + 1u] = vec4<f32>(vb, M, 0.0);
}
`);

// Ciało po rozpadzie (_spawnWreck / _rebuildBody + _transferFragmentMotion) — jak w dawnym reseat.
// sp.opOffset: przebieg wraków (czytają rodzica sprzed przebudowy), potem rodziców.
K('reseatFinal2', [['topoOps', 'r'], ['bodies', 'rw'], ['partials', 'r'], ['reseatTmp', 'rw']], /* wgsl */`
${RESEAT_GATHER(1, 'let p2 = partials[o + 2u]; a = vec4<f32>(a.xy + p2.xy, max(a.z, p2.z), 0.0);')}
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let opi = wid.x + sp.opOffset;
  gather(opi, lid);
  if (lid != 0u) { return; }
  let op = topoOps[opi];
  let t0 = reseatTmp[opi * 2u];
  let t1 = reseatTmp[opi * 2u + 1u];
  let com = t0.xy;
  let cur = t0.zw;
  let vb = t1.xy;
  let M = t1.z;
  let izzSum = sA[0].x;
  let Lsum = sA[0].y;
  let invI = select(0.0, 1.0 / izzSum, izzSum > 1e-9);
  var omega = Lsum * invI;
  omega = omega * min(1.0, 6.0 / max(abs(omega), 1e-9));
  let base = bodies[select(op.body, op.parent, op.isWreck != 0u)];
  var b = bodies[op.body];
  let shift = rot2(base.rot.xy, com);
  b.pos = posAdd(base.pos, shift);
  var vel = base.motion.xy + vec2<f32>(-base.motion.w * shift.y, base.motion.w * shift.x);
  var w = base.motion.w;
  vel += rot2(base.rot.xy, vec2<f32>(vb.x + omega * cur.y, vb.y - omega * cur.x));
  w += omega;
  if (op.isWreck != 0u) {
    let outLen = length(shift);
    if (outLen > 1e-4) {
      vel += shift / outLen * cfg.wreckKick;
      w += shift.x / outLen * cfg.wreckSpin;
    }
    b.shape.y = base.shape.y;
  }
  b.motion = vec4<f32>(vel, base.motion.z, w);
  b.rot = vec4<f32>(base.rot.xy, 0.0, 0.0);
  b.massInfo = vec4<f32>(M, 1.0 / M, invI, b.massInfo.w);
  b.shape.x = sqrt(sA[0].z) + b.shape.z;
  b.state.x = (b.state.x & ~(B_SLEEP | B_DEAD)) | B_RECENTRE;   // solver lokalny: statystyki i obrys od nowa
  b.state.y = 0u;
  b.state.z = cfg.wakeHoldFrames;
  b.list.w = 0u;
  b.transfer = vec4<f32>(0.0);
  bodies[op.body] = b;
  reseatTmp[opi * 2u + 1u] = vec4<f32>(vb, M, omega);
}
`);

K('reseatApply', [['topoOps', 'r'], ['bodies', 'r'], ['nodeLists', 'r'], ['restMass', 'rw'], ['posVel', 'rw'], ['prev', 'rw'],
  ['reseatTmp', 'r']], /* wgsl */`
const CHUNK: u32 = ${REDUCE_CHUNK}u;
var<workgroup> wList: vec4<u32>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let opi = wid.y;
  let chunk = wid.x;
  if (lid == 0u) { wList = bodies[topoOps[opi].body].list; }
  let lst = workgroupUniformLoad(&wList);
  if (chunk * CHUNK >= lst.y) { return; }
  let end = min(lst.y, (chunk + 1u) * CHUNK);
  let t0 = reseatTmp[opi * 2u];
  let t1 = reseatTmp[opi * 2u + 1u];
  let c = t0.xy;
  let cr = t0.zw;
  let v0 = t1.xy;
  let om = t1.w;
  for (var k = chunk * CHUNK + lid; k < end; k += 256u) {
    let i = nodeLists[lst.x + k];
    let rm = restMass[i];
    let pv = posVel[i];
    let x = pv.xy - c;
    let r = x - cr;
    restMass[i] = vec4<f32>(rm.xy - c, rm.zw);
    posVel[i] = vec4<f32>(x, pv.zw - (v0 + vec2<f32>(-om * r.y, om * r.x)));
    prev[i] = prev[i] - c;
  }
}
`);

// ------------------------------------------------------------------ solver lokalny (kernele)
//
// Kolejność w podkroku (gpuWorld.encodeFrame): integrateEvents → regionBegin → growF → regionArgs1 →
// growO → regionArgs2 → ringFront → prepareLocal → GS (gsAll albo gsLocal: iteracje × kolory) →
// velocityRing → settleBake → bodyStage, potem kontakty na listach kandydatów (clearReset, insertList,
// narrowList, …). Raz na krok: reducePartial (S_RECENTRE) → recentreFinal → shiftNodes, clearReset →
// candReset → stepBoxes → candBuild → candArgs.
// Narzut dispatcha (~3 µs z barierą) przy 13 podkrokach na krok był większy niż praca małego obszaru —
// stąd kernele scalone tam, gdzie zależności na to pozwalają.

const ORD_MAX = ordF32(3.0e38), ORD_MIN = ordF32(-3.0e38);
const ACT_BINDINGS = [['loc', 'rw'], ['listMark', 'rw'], ['actState', 'rw'], ['regionList', 'rw']];
const ARGS = (slot, count, per = 64) => `locArgs[${slot}u] = (${count} + ${per - 1}u) / ${per}u; locArgs[${slot + 1}u] = 1u; locArgs[${slot + 2}u] = 1u;`;
export const GROW_LANES = 8;   // wątków na węzeł w growF / growO (8 węzłów na grupę 64)
const GROW_SPLIT = 32768;      // grupy w x; więcej → druga oś (limit 65 535 grup na wymiar: 1 j. to do 1,35 mln węzłów × 8)
const GROW_ARGS = (slot, count) => `{ let g = (${count} + ${GROW_LANES - 1}u) / ${GROW_LANES}u;
    locArgs[${slot}u] = min(g, ${GROW_SPLIT}u); locArgs[${slot + 1}u] = (g + ${GROW_SPLIT - 1}u) / ${GROW_SPLIT}u; locArgs[${slot + 2}u] = 1u; }`;

// Początek podkroku: nowa epoka, A = lista zebrana w poprzednim podkroku, zerowanie liczników.
K('regionBegin', [['loc', 'rw'], ['locArgs', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) {
    let ep = atomicLoad(&loc[LOC_EPOCH]) + 1u;
    atomicStore(&loc[LOC_EPOCH], ep);
    let p = ep & 1u;
    let nA = min(atomicLoad(&loc[LOC_ACT0 + p]), cfg.listCap);
    atomicStore(&loc[LOC_ACT0 + p], nA);
    atomicStore(&loc[LOC_NA], nA);
    atomicStore(&loc[LOC_ACT0 + (p ^ 1u)], 0u);
    atomicStore(&loc[LOC_FRONT0 + p], min(atomicLoad(&loc[LOC_FRONT0 + p]), cfg.listCap));
    atomicStore(&loc[LOC_FRONT0 + (p ^ 1u)], 0u);
    atomicStore(&loc[LOC_SETTLED], 0u);
    atomicMax(&loc[${LOC.maxA}u], nA);
    ${GROW_ARGS(ARG.a, 'nA')}
  }
  for (var c = lid; c < cfg.localColors; c += 64u) { atomicStore(&loc[LOC_COLOR + c], 0u); }
}
`);

// Rozrost obszaru, GROW_LANES wątków na węzeł (każdy co GROW_LANES-ty wpis sąsiedztwa — dużo wątków
// w locie ukrywa opóźnienia losowych odczytów). Węzeł listy: predykcja, waga, mocowania (A w growF,
// F w growO). Belki do kubełków kolorów, bez atomików na belkach — belkę dopisuje jeden koniec:
// A–A i F–F mniejszy indeks, A–F koniec A, F–O koniec F. A = listMark == epoka (lista podkroku, przed
// aktywacjami w tym podkroku), F = regionMark == epoka·4 + 2, O = epoka·4 + 1. Sąsiad spoza obszaru
// dostaje rolę (F z A, O z F) i miejsce na liście; dopisywanie zbiorcze, jeden atomik globalny na kolor.
const GROW = (role, fromF) => /* wgsl */`
${MOUNT_CHECK}
const LANES: u32 = ${GROW_LANES}u;
var<workgroup> wColorCnt: array<atomic<u32>, 64>;
var<workgroup> wColorBase: array<u32, 64>;
var<workgroup> wNCnt: atomic<u32>;
var<workgroup> wNBase: u32;

fn owns(i: u32, o: u32, ep: u32) -> bool {
  if (atomicLoad(&listMark[o]) == ep) { return ${fromF ? 'false' : 'i < o'}; }
  ${fromF ? 'if (atomicLoad(&regionMark[o]) == ep * 4u + 2u) { return i < o; }' : ''}
  return true;
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  atomicStore(&wColorCnt[lid], 0u);
  if (lid == 0u) { atomicStore(&wNCnt, 0u); }
  workgroupBarrier();
  let ep = atomicLoad(&loc[LOC_EPOCH]);
  let p = ep & 1u;
  let ep4 = ep * 4u;
  let first = ${fromF ? 'atomicLoad(&loc[LOC_NA])' : '0u'};
  let last = ${fromF ? 'atomicLoad(&loc[LOC_NAF])' : 'atomicLoad(&loc[LOC_NA])'};
  let tid = (wid.y * ${GROW_SPLIT}u + wid.x) * 64u + lid;
  let lane = tid % LANES;
  let k = first + tid / LANES;
  var fN: array<u32, 4>;
  var fL: array<u32, 4>;
  var nF = 0u;
  var oE: array<u32, 4>;     // posiadane belki wątku (≤ 3: stopień ≤ MAX_DEG, LANES wątków na węzeł)
  var oL: array<u32, 4>;     // kolor << 24 | miejsce w kubełku grupy
  var nO = 0u;
  if (k < last) {
    let i = regionList[p * cfg.listCap + k];
    let info = nodeInfo[i];
    if ((info.x & N_ACTIVE) != 0u && (info.x & N_STATIC) == 0u) {
      if (lane == 0u) {
        let pv = posVel[i];
        prev[i] = pv.xy;
        pred[i] = pv.xy + pv.zw * sp.dt;
        solveW[i] = invMass[i];
        mountCheck(i, info.x);
      }
      let m = nodeMeta[i];
      for (var q = m.x + lane; q < m.y; q += LANES) {
        let e = adj[q];
        let fl = beamFlags[e];
        if ((fl & 1u) != 0u) { continue; }
        let ends = beamEnds[e];
        let o = ends.x ^ ends.y ^ i;
        if ((nodeInfo[o].x & N_ACTIVE) == 0u) { continue; }
        if (owns(i, o, ep) && nO < 4u) {
          let c = (fl >> 16u) & 255u;
          oE[nO] = e;
          oL[nO] = (c << 24u) | atomicAdd(&wColorCnt[c], 1u);
          nO++;
        }
        if (atomicLoad(&listMark[o]) != ep && atomicLoad(&regionMark[o]) < ep4) {
          if (atomicMax(&regionMark[o], ep4 + ${role}u) < ep4 && nF < 4u) {
            fN[nF] = o;
            fL[nF] = atomicAdd(&wNCnt, 1u);
            nF++;
          }
        }
      }
    }
  }
  workgroupBarrier();
  if (lid < cfg.localColors) {
    let cnt = atomicLoad(&wColorCnt[lid]);
    if (cnt > 0u) { wColorBase[lid] = atomicAdd(&loc[LOC_COLOR + lid], cnt); }
  }
  if (lid == 0u) { wNBase = atomicAdd(&loc[LOC_ACT0 + p], atomicLoad(&wNCnt)); }
  workgroupBarrier();
  for (var j = 0u; j < nO; j++) {
    let c = oL[j] >> 24u;
    slotBeam[atomicLoad(&loc[LOC_CBASE + c]) + wColorBase[c] + (oL[j] & 0xffffffu)] = oE[j];
  }
  for (var j = 0u; j < nF; j++) {
    let pos = wNBase + fL[j];
    if (pos < cfg.listCap) { regionList[p * cfg.listCap + pos] = fN[j]; }
  }
}
`;
const GROW_BINDINGS = [['loc', 'rw'], ['regionList', 'rw'], ['regionMark', 'rw'], ['listMark', 'rw'], ['nodeMeta', 'r'],
  ['adj', 'r'], ['beamEnds', 'r'], ['beamFlags', 'r'], ['slotBeam', 'rw'], ['nodeInfo', 'rw'], ['posVel', 'r'],
  ['pred', 'rw'], ['prev', 'rw'], ['solveW', 'rw'], ['invMass', 'r']];
K('growF', GROW_BINDINGS, GROW(2, false));
K('growO', GROW_BINDINGS, GROW(1, true));

K('regionArgs1', [['loc', 'rw'], ['locArgs', 'rw']], /* wgsl */`
@compute @workgroup_size(1)
fn main() {
  let ep = atomicLoad(&loc[LOC_EPOCH]);
  let nAF = min(atomicLoad(&loc[LOC_ACT0 + (ep & 1u)]), cfg.listCap);
  atomicStore(&loc[LOC_NAF], nAF);
  let nF = nAF - atomicLoad(&loc[LOC_NA]);
  ${GROW_ARGS(ARG.f, 'nF')}
}
`);

K('regionArgs2', [['loc', 'rw'], ['locArgs', 'rw']], /* wgsl */`
var<workgroup> wMax: atomic<u32>;
var<workgroup> wTot: atomic<u32>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) { atomicStore(&wMax, 0u); atomicStore(&wTot, 0u); }
  workgroupBarrier();
  for (var c = lid; c < cfg.localColors; c += 64u) {
    let cnt = atomicLoad(&loc[LOC_COLOR + c]);
    locArgs[${ARG.gs}u + c * 3u] = (cnt + 63u) / 64u;
    locArgs[${ARG.gs}u + c * 3u + 1u] = 1u;
    locArgs[${ARG.gs}u + c * 3u + 2u] = 1u;
    atomicMax(&wMax, cnt);
    atomicAdd(&wTot, cnt);
  }
  workgroupBarrier();
  if (lid == 0u) {
    let ep = atomicLoad(&loc[LOC_EPOCH]);
    let p = ep & 1u;
    let nAll = min(atomicLoad(&loc[LOC_ACT0 + p]), cfg.listCap);
    atomicStore(&loc[LOC_NALL], nAll);
    let nAF = atomicLoad(&loc[LOC_NAF]);
    let nO = nAll - nAF;
    let ring = max(nO, atomicLoad(&loc[LOC_FRONT0 + p]));   // ringFront: pierścień i wolni sąsiedzi
    ${ARGS(ARG.o, 'ring')}
    let vel = max(nAF, nO);                                   // velocityRing, settleBake
    ${ARGS(ARG.s, 'vel')}
    locArgs[${ARG.prep}u] = (atomicLoad(&wMax) + 255u) / 256u;
    locArgs[${ARG.prep + 1}u] = cfg.localColors;
    locArgs[${ARG.prep + 2}u] = 1u;
    atomicMax(&loc[${LOC.maxS}u], nAF);
    atomicMax(&loc[${LOC.maxAll}u], nAll);
    atomicMax(&loc[${LOC.maxBeams}u], atomicLoad(&wTot));
  }
}
`);

// Pierścień O (stoi: predykcja = pozycja, waga 0, mocowania jak w _refreshMountsLocal) i wolni sąsiedzi
// z poprzedniego podkroku, którzy wypadli z obliczeń (zapiekanie: napięcie belek do nieliczonych węzłów
// to ich stan spoczynkowy — bez tego wracało skokiem prędkości i obszar nigdy nie zasypiał).
const BAKE_BINDINGS = [['nodeMeta', 'r'], ['adj', 'r'], ['beamFlags', 'r'], ['beamEnds', 'r'], ['actState', 'r'],
  ['posVel', 'r'], ['beamLen', 'rw'], ['regionMark', 'rw'], ['listMark', 'rw']];
K('ringFront', [['loc', 'rw'], ['regionList', 'r'], ['frontList', 'r'], ['nodeInfo', 'rw'], ['pred', 'rw'], ['prev', 'rw'],
  ['solveW', 'rw'], ...BAKE_BINDINGS], /* wgsl */`
${MOUNT_CHECK}
${BAKE}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ep = atomicLoad(&loc[LOC_EPOCH]);
  let p = ep & 1u;
  let k = gid.x;
  let nAF = atomicLoad(&loc[LOC_NAF]);
  if (nAF + k < atomicLoad(&loc[LOC_NALL])) {
    let i = regionList[p * cfg.listCap + nAF + k];
    let x = posVel[i].xy;
    prev[i] = x;
    pred[i] = x;
    solveW[i] = 0.0;
    mountCheck(i, nodeInfo[i].x);
  }
  if (k < atomicLoad(&loc[LOC_FRONT0 + p])) {
    let i = frontList[p * cfg.listCap + k];
    if ((nodeInfo[i].x & N_ACTIVE) != 0u && !inRegion(i, ep)) { bakeBeams(i, ep); }
  }
}
`);

// Pomiar belek kubełka (prepareBeamConstraints na liście więzów): zmęczenie, zerwania, plastyczność,
// waga z solveW (pierścień = 0). Rekord GS zawsze pełny (miejsce w kubełku zmienia belkę co podkrok).
// Zerwanie aktywuje oba końce (flaga; na listę trafiają przez velocityRing).
K('prepareLocal', [['bodies', 'r'], ['pred', 'r'], ['invMass', 'r', null, 'solveW'], ['nodeInfo', 'r'], ['beamEnds', 'r'],
  ['beamLen', 'rw'], ['beamMat', 'rw'], ['beamFlags', 'rw'], ['counters', 'rw'], ['bodyEvents', 'rw'], ['nodeAux', 'rw'],
  ['slotBeam', 'r'], ['gsPack', 'rw'], ['loc', 'rw'], ['actState', 'rw']], /* wgsl */`
fn woundHeat(i: u32, level: f32) {
  var aux = nodeAux[i];
  let decayed = aux.y * exp(-max(0.0, sp.time - aux.z) * 0.35);
  if (level > decayed) { aux.y = min(1.0, level); aux.z = sp.time; nodeAux[i] = aux; }
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let c = wid.y;
  let x = wid.x * 256u + lid;
  if (x >= atomicLoad(&loc[LOC_COLOR + c])) { return; }
  let k = atomicLoad(&loc[LOC_CBASE + c]) + x;
  let e = slotBeam[k];
  let ends = beamEnds[e];
  let len4 = beamLen[e];
  let fl = beamFlags[e];
  let ia = nodeInfo[ends.x];
  let ib = nodeInfo[ends.y];
  if ((fl & 1u) != 0u || (ia.x & ib.x & N_ACTIVE) == 0u) {
    gsPack[k] = vec4<u32>(ends.x, ends.y, 0u, 0u);
    return;
  }
  let btype = (fl >> 8u) & 255u;
  var broke = false;
  var mat = beamMat[e];
  var strain = len4.w;
  if (cfg.breakOn != 0u && btype >= 2u && ((ia.x | ib.x) & N_MOUNTFAIL) != 0u) {
    broke = true;
  } else {
    let d = pred[ends.y] - pred[ends.x];
    let len = length(d);
    var rest = len4.x;
    let restBase = len4.y;
    let C = len - rest;
    strain = C / rest;
    let absStrain = abs(strain);
    if (cfg.breakOn != 0u) {
      let limit = mat.z * cfg.breakMul;
      if (absStrain > mat.y) { mat.w += (absStrain - mat.y) / limit * cfg.plasticFatigue * sp.dt * 60.0; }
      if (max(absStrain, abs(len - restBase) / restBase) > limit || mat.w >= 1.0) { broke = true; }
    }
    if (!broke) {
      if (absStrain > mat.y) {
        let over = C - sign(C) * mat.y * rest;
        rest = clamp(rest + over * sp.plasticK, restBase * (1.0 - cfg.maxRestDrift), restBase * (1.0 + cfg.maxRestDrift));
        beamMat[e].w = mat.w;
      }
      let wsum = invMass[ends.x] + invMass[ends.y];
      var factor = 0.0;
      if (wsum > 0.0) {
        let stiff = min(1.0, mat.x * cfg.stiffMul);
        let kk = stiff / (stiff + (1.0 - stiff) / sp.stepScaleSq);
        factor = kk / wsum;
      }
      beamLen[e] = vec4<f32>(rest, restBase, factor, strain);
      gsPack[k] = vec4<u32>(ends.x, ends.y, bitcast<u32>(rest), bitcast<u32>(factor));
      return;
    }
  }
  beamFlags[e] = fl | 1u;
  beamLen[e] = vec4<f32>(len4.x, len4.y, 0.0, strain);
  beamMat[e].w = mat.w;
  gsPack[k] = vec4<u32>(ends.x, ends.y, 0u, 0u);
  atomicAdd(&counters[${COUNTER.beamsBroken}], 1u);
  atomicOr(&bodyEvents[ia.y], E_DIRTY);
  actState[ends.x] = ACT_BIT;
  actState[ends.y] = ACT_BIT;
  let body = bodies[ia.y];
  if (cfg.heatGain > 0.0 && body.rot.z > 0.02 && sp.time - body.rot.w <= cfg.heatWoundWindow) {
    woundHeat(ends.x, body.rot.z);
    woundHeat(ends.y, body.rot.z);
  }
}
`);

// GS całego obszaru w jednej grupie roboczej (wszystkie iteracje i kolory, bariera między kolorami):
// przy małym obszarze 39 dispatchy na podkrok to głównie narzut. Świat wybiera tryb z odczytu
// rozmiaru obszaru (oba dają ten sam wynik: kolory po kolei, belki koloru niezależne).
K('gsAll', [['gsPack', 'r'], ['pred', 'rw'], ['invMass', 'r', null, 'solveW'], ['loc', 'rw']], /* wgsl */`
${SOLVE_BEAM}
override GS_SIZE: u32 = 256u;
@compute @workgroup_size(GS_SIZE)
fn main(@builtin(local_invocation_index) lid: u32) {
  for (var it = 0u; it < cfg.solverIterations; it++) {
    for (var c = 0u; c < cfg.localColors; c++) {
      let n = atomicLoad(&loc[LOC_COLOR + c]);
      let base = atomicLoad(&loc[LOC_CBASE + c]);
      for (var j = lid; j < n; j += GS_SIZE) { solveBeam(base + j); }
      storageBarrier();
    }
  }
}
`, { overrides: (world) => ({ GS_SIZE: world.gsGroupSize }) });

// Ogon kolorów jednej iteracji GS (kolory od colorRange.index do końca — długie belki: wręgi, grodzie;
// przy 1 j. 84 tys., 83 tys., 2 tys., 1 tys. i 44 belki wobec ~670 tys. w kolorze siatki) w jednej grupie
// roboczej z barierą między kolorami: 9 dispatchy na iterację zamiast 13.
K('gsTail', [['gsPack', 'r'], ['pred', 'rw'], ['invMass', 'r', null, 'solveW'], ['loc', 'rw']], /* wgsl */`
struct ColorRange { start: u32, count: u32, index: u32 }
@group(2) @binding(0) var<uniform> colorRange: ColorRange;
${SOLVE_BEAM}
override GS_SIZE: u32 = 256u;
@compute @workgroup_size(GS_SIZE)
fn main(@builtin(local_invocation_index) lid: u32) {
  for (var c = colorRange.index; c < cfg.localColors; c++) {
    let n = atomicLoad(&loc[LOC_COLOR + c]);
    let base = atomicLoad(&loc[LOC_CBASE + c]);
    for (var j = lid; j < n; j += GS_SIZE) { solveBeam(base + j); }
    storageBarrier();
  }
}
`, { colorGroup: true, overrides: (world) => ({ GS_SIZE: world.gsGroupSize }) });

// Prędkości A ∪ F, aktywność i pęd na ciało (kroki 5–6 _solveLocal), plus pierścień: koniec zerwanej
// belki na pierścieniu traci oparcie — rusza w następnym podkroku.
//  - |v|₁ > próg → węzeł (także sąsiad F) zostaje / wchodzi do A, kroki ciszy od zera;
//  - aktywny i wolny → kroki ciszy + 1; po actSettle: prędkość na ciało, wypada z A, zapiekanie;
//  - wolny sąsiad F → prędkość na ciało (spoczywa w układzie ciała), zapiekanie w następnym podkroku.
// Pęd oddany ciału = m·(v przed − v po): reakcja pierścienia, tłumienie i węzły wyzerowane razem.
K('velocityRing', [['loc', 'rw'], ['regionList', 'rw'], ['listMark', 'rw'], ['actState', 'rw'], ['posVel', 'rw'],
  ['pred', 'r'], ['prev', 'r'], ['restMass', 'r'], ['nodeInfo', 'r'], ['frontList', 'rw'], ['settleList', 'rw'],
  ['bodyAcc', 'rw']], /* wgsl */`
${FIXED}
${ACTIVATE}
const SLOT_W: u32 = ${ACC_SLOT}u;
var<workgroup> wKey: array<atomic<u32>, 4>;
var<workgroup> wAcc: array<atomic<i32>, ${4 * ACC_SLOT}>;
var<workgroup> wCnt: array<atomic<u32>, 3>;
var<workgroup> wBase: array<u32, 3>;

// Sumy w grupie roboczej per ciało (do 4 ciał na grupę; reszta wprost do bodyAcc).
fn slotOf(b: u32) -> u32 {
  for (var s = 0u; s < 4u; s++) {
    let k = atomicLoad(&wKey[s]);
    if (k == b + 1u) { return s; }
    if (k == 0u) {
      let r = atomicCompareExchangeWeak(&wKey[s], 0u, b + 1u);
      if (r.exchanged || r.old_value == b + 1u) { return s; }
      if (atomicLoad(&wKey[s]) == b + 1u) { return s; }
    }
  }
  return 4u;
}
fn accInit(w: u32) -> i32 {
  if (w == ${ACC.minX}u || w == ${ACC.minY}u) { return ${ORD_MAX}; }
  if (w == ${ACC.maxX}u || w == ${ACC.maxY}u) { return ${ORD_MIN}; }
  return 0;
}
fn accOp(w: u32) -> u32 {
  if (w == ${ACC.minX}u || w == ${ACC.minY}u) { return 1u; }
  if (w >= ${ACC.maxX}u && w <= ${ACC.disp}u) { return 2u; }
  return 0u;
}
fn accPut(s: u32, b: u32, w: u32, v: i32) {
  let op = accOp(w);
  if (s < 4u) {
    let a = s * SLOT_W + w;
    if (op == 0u) { atomicAdd(&wAcc[a], v); } else if (op == 1u) { atomicMin(&wAcc[a], v); } else { atomicMax(&wAcc[a], v); }
  } else {
    let a = b * ${BODY_ACC}u + w;
    if (op == 0u) { atomicAdd(&bodyAcc[a], v); } else if (op == 1u) { atomicMin(&bodyAcc[a], v); } else { atomicMax(&bodyAcc[a], v); }
  }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  if (lid < 4u) { atomicStore(&wKey[lid], 0u); }
  if (lid < 3u) { atomicStore(&wCnt[lid], 0u); }
  if (lid < ${4 * ACC_SLOT}u) { atomicStore(&wAcc[lid], accInit(lid % SLOT_W)); }
  workgroupBarrier();
  let ep = atomicLoad(&loc[LOC_EPOCH]);
  let p = ep & 1u;
  let t = ep + 1u;
  let q = t & 1u;
  let nAF = atomicLoad(&loc[LOC_NAF]);
  var node = 0u;
  var put = 3u;           // 0 = A następnego podkroku, 1 = wolny sąsiad (zapiekanie), 2 = uspokojony, 3 = nic
  var at = 0u;
  let k = gid.x;
  if (k < nAF) {
    let i = regionList[p * cfg.listCap + k];
    node = i;
    let info = nodeInfo[i];
    if ((info.x & N_ACTIVE) != 0u && (info.x & N_STATIC) == 0u) {
      let pv = posVel[i];
      let rm = restMass[i];
      let m = rm.z;
      let x1 = pred[i];
      let x0 = prev[i];
      var nv = (x1 - x0) * (sp.invDt * sp.damp);
      let st = actState[i];
      var act = (st & ACT_BIT) != 0u;
      var quiet = st & 255u;
      let thr = cfg.actThreshold * select(1.0, sp.stepDt * sp.invDt, cfg.actScale != 0u);
      if (abs(nv.x) + abs(nv.y) > thr) {
        act = true; quiet = 0u; put = 0u;
      } else if (act) {
        quiet = min(quiet + 1u, 255u);
        if (quiet >= cfg.actSettle) { nv = vec2<f32>(0.0); act = false; quiet = 0u; put = 2u; }
        else { put = 0u; }
      } else {
        nv = vec2<f32>(0.0);
        put = 1u;
      }
      posVel[i] = vec4<f32>(x1, nv);
      actState[i] = select(0u, ACT_BIT, act) | quiet;
      let mom = (pv.zw - nv) * m;
      let b = info.y;
      let s = slotOf(b);
      let hx = fixHi(mom.x);
      let hy = fixHi(mom.y);
      accPut(s, b, ${ACC.pxHi}u, hx);
      accPut(s, b, ${ACC.pxLo}u, fixLo(mom.x, hx));
      accPut(s, b, ${ACC.pyHi}u, hy);
      accPut(s, b, ${ACC.pyLo}u, fixLo(mom.y, hy));
      let dd = abs(x1 - x0);
      accPut(s, b, ${ACC.drift}u, i32(round(min(m * (dd.x + dd.y), 1.0e8) * 4.0)));
      accPut(s, b, ${ACC.minX}u, ordF(x1.x));
      accPut(s, b, ${ACC.minY}u, ordF(x1.y));
      accPut(s, b, ${ACC.maxX}u, ordF(x1.x));
      accPut(s, b, ${ACC.maxY}u, ordF(x1.y));
      accPut(s, b, ${ACC.r2}u, bitcast<i32>(dot(x1, x1)));
      accPut(s, b, ${ACC.disp}u, bitcast<i32>(max(abs(x1.x - rm.x), abs(x1.y - rm.y))));
      accPut(s, b, ${ACC.solved}u, 1);
      if (put == 0u) {
        accPut(s, b, ${ACC.kept}u, 1);
        if (atomicMax(&listMark[i], t) < t) { at = atomicAdd(&wCnt[0], 1u); } else { put = 3u; }
      } else {
        at = atomicAdd(&wCnt[put], 1u);
      }
    }
  }
  // pierścień: aktywowany przez zerwanie w prepareLocal → lista A następnego podkroku
  if (nAF + k < atomicLoad(&loc[LOC_NALL])) {
    let i = regionList[p * cfg.listCap + nAF + k];
    if ((actState[i] & ACT_BIT) != 0u && (nodeInfo[i].x & N_ACTIVE) != 0u) { activate(i); }
  }
  workgroupBarrier();
  if (lid < ${4 * ACC_SLOT}u) {
    let key = atomicLoad(&wKey[lid / SLOT_W]);
    let w = lid % SLOT_W;
    let v = atomicLoad(&wAcc[lid]);
    if (key != 0u && v != accInit(w)) { accPut(4u, key - 1u, w, v); }
  }
  if (lid == 0u) {
    wBase[0] = atomicAdd(&loc[LOC_ACT0 + q], atomicLoad(&wCnt[0]));
    wBase[1] = atomicAdd(&loc[LOC_FRONT0 + q], atomicLoad(&wCnt[1]));
    wBase[2] = atomicAdd(&loc[LOC_SETTLED], atomicLoad(&wCnt[2]));
  }
  workgroupBarrier();
  if (put < 3u) {
    let pos = wBase[put] + at;
    if (pos < cfg.listCap) {
      if (put == 0u) { regionList[q * cfg.listCap + pos] = node; }
      else if (put == 1u) { frontList[q * cfg.listCap + pos] = node; }
      else { settleList[pos] = node; }
    }
  }
}
`);

// Uspokojony węzeł: belki do węzłów, których nikt już nie liczy, przyjmują obecną długość
// (dispatch z rozmiaru A ∪ F — uspokojone są jego podzbiorem).
K('settleBake', [['loc', 'rw'], ['settleList', 'r'], ['nodeInfo', 'r'], ...BAKE_BINDINGS], /* wgsl */`
${BAKE}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= min(atomicLoad(&loc[LOC_SETTLED]), cfg.listCap)) { return; }
  bakeBeams(settleList[gid.x], 0u);
}
`);

// Ciało po podkroku (krok 7 _solveLocal), potem bliskość ciał — jedna grupa robocza (wszystkie ciała),
// bo nearFlags czyta zaktualizowane ciała. Pęd z węzłów → prędkość ciała, obrys i promień tylko rosną
// (dokładne wracają przy wyrównaniu środka), dryf masy → flaga wyrównania, sen = pusty obszar.
K('bodyStage', [['bodies', 'rw'], ['bodyAcc', 'rw'], ['bodyNear', 'rw'], ['bodyBox', 'rw']], /* wgsl */`
${FIXED}
${NEAR_FN}
fn bodyLocal(bi: u32) {
  let a = bi * ${BODY_ACC}u;
  let px = unfix(atomicLoad(&bodyAcc[a + ${ACC.pxHi}u]), atomicLoad(&bodyAcc[a + ${ACC.pxLo}u]));
  let py = unfix(atomicLoad(&bodyAcc[a + ${ACC.pyHi}u]), atomicLoad(&bodyAcc[a + ${ACC.pyLo}u]));
  let drift = f32(atomicLoad(&bodyAcc[a + ${ACC.drift}u])) * 0.25;
  let lo = vec2<f32>(unordF(atomicLoad(&bodyAcc[a + ${ACC.minX}u])), unordF(atomicLoad(&bodyAcc[a + ${ACC.minY}u])));
  let hi = vec2<f32>(unordF(atomicLoad(&bodyAcc[a + ${ACC.maxX}u])), unordF(atomicLoad(&bodyAcc[a + ${ACC.maxY}u])));
  let r2 = bitcast<f32>(atomicLoad(&bodyAcc[a + ${ACC.r2}u]));
  let disp = bitcast<f32>(atomicLoad(&bodyAcc[a + ${ACC.disp}u]));
  let solved = atomicLoad(&bodyAcc[a + ${ACC.solved}u]);
  let kept = atomicLoad(&bodyAcc[a + ${ACC.kept}u]);
  let lmom = unfix(atomicLoad(&bodyAcc[a + ${ACC.lHi}u]), atomicLoad(&bodyAcc[a + ${ACC.lLo}u]));
  atomicStore(&bodyAcc[a + ${ACC.lHi}u], 0);
  atomicStore(&bodyAcc[a + ${ACC.lLo}u], 0);
  for (var w = 0u; w < ${ACC_SLOT}u; w++) {
    var init = 0;
    if (w == ${ACC.minX}u || w == ${ACC.minY}u) { init = ${ORD_MAX}; }
    if (w == ${ACC.maxX}u || w == ${ACC.maxY}u) { init = ${ORD_MIN}; }
    atomicStore(&bodyAcc[a + w], init);
  }
  var b = bodies[bi];
  let f = b.state.x;
  if ((f & B_USED) == 0u || (f & (B_DEAD | B_STATIC)) != 0u) { return; }
  let M = b.massInfo.x;
  if (M > 0.0 && (px != 0.0 || py != 0.0)) {
    b.motion = vec4<f32>(b.motion.xy + rot2(b.rot.xy, vec2<f32>(px, py) / M), b.motion.zw);
  }
  if (lmom != 0.0) { b.motion.w = b.motion.w + lmom * b.massInfo.z; }
  if (solved > 0) {
    b.bounds = vec4<f32>(min(b.bounds.xy, lo), max(b.bounds.zw, hi));
    b.shape.x = max(b.shape.x, sqrt(r2) + b.shape.z);
    b.shape.y = max(b.shape.y, disp);
    let total = bitcast<f32>(atomicLoad(&bodyAcc[a + ${ACC.driftTotal}u])) + drift;
    atomicStore(&bodyAcc[a + ${ACC.driftTotal}u], bitcast<i32>(total));
    if (total > 0.25 * b.shape.z * M || kept == 0) { b.state.x = b.state.x | B_RECENTRE; }
  }
  b.state.x = select(b.state.x & ~B_SLEEP, b.state.x | B_SLEEP, kept == 0);
  b.transfer = vec4<f32>(0.0);
  bodies[bi] = b;
}
@compute @workgroup_size(${MAX_BODIES})
fn main(@builtin(local_invocation_index) lid: u32) {
  if (lid < cfg.bodyCount) { bodyLocal(lid); }
  storageBarrier();
  if (lid < cfg.bodyCount) { nearBody(lid); }
}
`);

// Wyrównanie środka (_recentre) dla ciał z flagą: sumy z reducePartial (S_RECENTRE) → średnie
// przemieszczenie na pozycję ciała, liczba żywych węzłów i masa, dokładny obrys, promień.
// Węzły przesuwa shiftNodes (body.transfer.xy), zeruje bodyStage pierwszego podkroku.
K('recentreFinal', [['bodies', 'rw'], ['partials', 'r'], ['bodyAcc', 'rw']], /* wgsl */`
const WG: u32 = 64u;
const CHUNK: u32 = ${REDUCE_CHUNK}u;
var<workgroup> sA: array<vec4<f32>, 64>;
var<workgroup> sB: array<vec4<f32>, 64>;
var<workgroup> sC: array<vec4<f32>, 64>;
var<workgroup> sD: array<f32, 64>;
var<workgroup> wList: vec4<u32>;
var<workgroup> wFlags: u32;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let bi = wid.x;
  if (lid == 0u) {
    var fl = 0u;
    if (bi < cfg.bodyCount) { fl = bodies[bi].state.x; wList = bodies[bi].list; }
    wFlags = fl;
  }
  let fl = workgroupUniformLoad(&wFlags);
  if ((fl & B_USED) == 0u || (fl & (B_DEAD | B_STATIC)) != 0u || (fl & B_RECENTRE) == 0u) { return; }
  let lst = wList;
  let chunks = (lst.y + CHUNK - 1u) / CHUNK;
  let stride = cfg.reduceStride;
  var a = vec4<f32>(0.0);
  var b = vec4<f32>(0.0);
  var c = vec4<f32>(3.0e38, 3.0e38, -3.0e38, -3.0e38);
  var dsp = 0.0;
  for (var k = lid; k < chunks; k += WG) {
    let o = (bi * stride + k) * 4u;
    a += partials[o];
    let pb = partials[o + 1u];
    b = vec4<f32>(b.x + pb.x, b.y + pb.y, max(b.z, pb.z), max(b.w, pb.w));
    let pc = partials[o + 2u];
    c = vec4<f32>(min(c.xy, pc.xy), max(c.zw, pc.zw));
    dsp = max(dsp, partials[o + 3u].x);
  }
  sA[lid] = a; sB[lid] = b; sC[lid] = c; sD[lid] = dsp;
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s = s >> 1u) {
    if (lid < s) {
      let o = lid + s;
      sA[lid] += sA[o];
      let b0 = sB[lid]; let b1 = sB[o];
      sB[lid] = vec4<f32>(b0.x + b1.x, b0.y + b1.y, max(b0.z, b1.z), max(b0.w, b1.w));
      let c0 = sC[lid]; let c1 = sC[o];
      sC[lid] = vec4<f32>(min(c0.xy, c1.xy), max(c0.zw, c1.zw));
      sD[lid] = max(sD[lid], sD[o]);
    }
    workgroupBarrier();
  }
  if (lid != 0u) { return; }
  var body = bodies[bi];
  let sums = sA[0];
  let more = sB[0];
  let box = sC[0];
  let count = u32(more.y + 0.5);
  body.list.z = count;
  body.state.x = body.state.x & ~B_RECENTRE;
  atomicStore(&bodyAcc[bi * ${BODY_ACC}u + ${ACC.driftTotal}u], 0);
  if (count == 0u) {
    body.state.x = body.state.x | B_DEAD;
    body.transfer = vec4<f32>(0.0);
    bodies[bi] = body;
    return;
  }
  let msum = sums.x;
  body.massInfo.x = msum;
  body.massInfo.y = 1.0 / msum;
  var mean = sums.yz / msum;
  if (abs(mean.x) + abs(mean.y) <= 1e-9) { mean = vec2<f32>(0.0); }
  body.pos = posAdd(body.pos, rot2(body.rot.xy, mean));
  body.transfer = vec4<f32>(mean, 0.0, 0.0);
  body.bounds = vec4<f32>(box.xy - mean, box.zw - mean);
  body.shape.x = sqrt(more.w) + length(mean) + body.shape.z;
  body.shape.y = sD[0] + length(mean);
  bodies[bi] = body;
}
`);

K('shiftNodes', [['bodies', 'r'], ['nodeLists', 'r'], ['nodeInfo', 'r'], ['posVel', 'rw']], /* wgsl */`
const WG: u32 = 256u;
const CHUNK: u32 = ${REDUCE_CHUNK}u;
var<workgroup> wList: vec4<u32>;
var<workgroup> wT: vec2<f32>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let bi = wid.y;
  let chunk = wid.x;
  if (lid == 0u) {
    let b = bodies[bi];
    wList = b.list;
    wT = select(vec2<f32>(0.0), b.transfer.xy, bi < cfg.bodyCount && (b.state.x & (B_STATIC | B_DEAD)) == 0u);
  }
  let t = workgroupUniformLoad(&wT);
  let lst = wList;
  if ((t.x == 0.0 && t.y == 0.0) || chunk * CHUNK >= lst.y) { return; }
  let end = min(lst.y, (chunk + 1u) * CHUNK);
  for (var k = chunk * CHUNK + lid; k < end; k += WG) {
    let i = nodeLists[lst.x + k];
    if ((nodeInfo[i].x & N_ACTIVE) == 0u) { continue; }
    let pv = posVel[i];
    posVel[i] = vec4<f32>(pv.xy - t, pv.zw);
  }
}
`);

// Strefa styku całego kroku (kandydaci do siatki kontaktów): jak nearFlags, z zapasem na ruch ciał
// i obrót w kroku oraz na odkształcenie węzłów (8 komórek).
K('stepBoxes', [['bodies', 'r'], ['stepBox', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.bodyCount) { return; }
  let a = bodies[i];
  var lo = vec2<f32>(3.0e38);
  var hi = vec2<f32>(-3.0e38);
  if ((a.state.x & B_USED) != 0u && (a.state.x & (B_DEAD | B_STATIC)) == 0u) {
    for (var j = 0u; j < cfg.bodyCount; j++) {
      if (j == i) { continue; }
      let b = bodies[j];
      if ((b.state.x & B_USED) == 0u || (b.state.x & B_DEAD) != 0u) { continue; }
      let rel = posDiff(a.pos, b.pos);
      let span = sp.stepDt * 1.5;
      // droga punktu b w układzie a w kroku: ruch względny, obrót a (punkt b leży ≤ |rel| + r_b od środka a),
      // własny obrót b (≤ r_b od jego środka). Mały wrak wirujący 50 rad/s nie rozdyma strefy całego kadłuba.
      let travel = (length(a.motion.xy - b.motion.xy) + abs(a.motion.w) * (length(rel) + b.shape.x) + abs(b.motion.w) * b.shape.x) * span;
      let r = a.shape.x + b.shape.x + travel * 2.0 + (a.shape.z + b.shape.z) * 10.0 + cfg.stepPad;
      if (dot(rel, rel) > r * r) { continue; }
      let bc = (b.bounds.xy + b.bounds.zw) * 0.5;
      let bh = (b.bounds.zw - b.bounds.xy) * 0.5;
      let cs = vec2<f32>(a.rot.x * b.rot.x + a.rot.y * b.rot.y, a.rot.x * b.rot.y - a.rot.y * b.rot.x);
      let c = rot2T(a.rot.xy, -rel) + rot2(cs, bc);
      let ext = vec2<f32>(abs(cs.x) * bh.x + abs(cs.y) * bh.y, abs(cs.y) * bh.x + abs(cs.x) * bh.y);
      let pad = (a.shape.z + b.shape.z) * (cfg.nodeRadiusRatio * 4.0 + 8.0) + 1.0 + travel + cfg.stepPad;
      lo = min(lo, c - ext - vec2<f32>(pad));
      hi = max(hi, c + ext + vec2<f32>(pad));
    }
  }
  stepBox[i] = vec4<f32>(lo, hi);
}
`);

// Czyszczenie siatki kontaktów tylko w komórkach zajętych przy ostatnim wstawieniu (lista kandydatów)
// i w grupie 0 reset par poprzedniej iteracji (collideReset). Dispatch ≥ 1 grupa (candArgs).
K('clearReset', [['loc', 'rw'], ['candList', 'r'], ['worldPos', 'r'], ['gridHead', 'rw'], ['pairFlags', 'rw'],
  ['collide', 'rw'], ['keyCount', 'rw'], ['occFine', 'rw']], /* wgsl */`
var<workgroup> wN: u32;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {
  if (wid.x == 0u) {
    if (lid == 0u) { wN = min(atomicLoad(&collide[0]), cfg.maxPairs); }
    let n = workgroupUniformLoad(&wN);
    for (var k = lid; k < n; k += 64u) {
      let key = atomicLoad(&collide[2u + k]);
      atomicStore(&pairFlags[key], 0u);
      atomicStore(&keyCount[key], 0u);
    }
    workgroupBarrier();
    if (lid == 0u) {
      atomicStore(&collide[0], 0u);
      atomicStore(&collide[1], 0u);
    }
  }
  if (gid.x >= min(atomicLoad(&loc[LOC_CAND]), cfg.listCap)) { return; }
  let wr = worldPos[candList[gid.x]];
  let w = vec2<f32>(bitcast<f32>(wr.x), bitcast<f32>(wr.y));
  if (w.x > 1.0e37) { return; }
  atomicStore(&gridHead[hashCell(vec2<i32>(floor(w / cfg.gridCell))) & cfg.gridMask], -1);
  let hf = (hashCell(vec2<i32>(floor(w / (cfg.gridCell * 4.0)))) & cfg.fineMask) * 2u;
  atomicStore(&occFine[hf], 0xffffffffu);
  atomicStore(&occFine[hf + 1u], 0u);
}
`);

K('candReset', [['loc', 'rw']], /* wgsl */`
@compute @workgroup_size(1)
fn main() { atomicStore(&loc[LOC_CAND], 0u); }
`);

// Zgrubna siatka zajętości świata (komórka occCell = 12 boków komórki: zasięg styku i odkształcenie
// węzłów w kroku). W komórce najmniejszy i największy indeks ciała, którego węzeł przejdzie przez nią
// w kroku: węzeł znaczy komórki wzdłuż swojej drogi (prędkość ciała + obrót + własna, × 1,5 kroku).
// Kandydat do kontaktów = węzeł w strefie kroku (stepBox), którego droga (± 1 komórka) mija drogę
// innego ciała. Sama strefa (suma obrysów AABB) przy dziesiątkach wraków wokół kadłuba obejmowała go
// prawie całego, a komórka z prędkością końca wirującego wraku — dla wszystkich ciał (do 1 mln
// kandydatów przy 1 j.).
const OCC_PATH = /* wgsl */`
const OCC_STEPS: u32 = 24u;
fn occPath(i: u32, info: vec4<u32>, b: Body) -> vec4<f32> {
  let pv = posVel[i];
  let r = rot2(b.rot.xy, pv.xy);
  let w0 = posRel(b.pos, vec2<f32>(sp.originX, sp.originY)) + r;
  var v = vec2<f32>(0.0);
  if ((b.state.x & B_STATIC) == 0u) { v = b.motion.xy + vec2<f32>(-b.motion.w * r.y, b.motion.w * r.x) + rot2(b.rot.xy, pv.zw); }
  return vec4<f32>(w0, w0 + v * (sp.stepDt * 1.5));
}
fn occSteps(path: vec4<f32>) -> u32 { return min(OCC_STEPS, u32(ceil(length(path.zw - path.xy) / cfg.occCell))); }
`;
K('occClear', [['occ', 'rw']], /* wgsl */`
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x > cfg.occMask) { return; }
  atomicStore(&occ[gid.x * 2u], 0xffffffffu);
  atomicStore(&occ[gid.x * 2u + 1u], 0u);
}
`);

K('occMark', [['bodies', 'r'], ['nodeInfo', 'r'], ['posVel', 'r'], ['occ', 'rw']], /* wgsl */`
${OCC_PATH}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u) { return; }
  let b = bodies[info.y];
  if ((b.state.x & B_DEAD) != 0u) { return; }
  let path = occPath(i, info, b);
  let n = occSteps(path);
  var last = vec2<i32>(0x7fffffff);
  for (var s = 0u; s <= n; s++) {
    let c = vec2<i32>(floor(mix(path.xy, path.zw, f32(s) / f32(max(n, 1u))) / cfg.occCell));
    if (all(c == last)) { continue; }
    last = c;
    let h = (hashCell(c) & cfg.occMask) * 2u;
    if (atomicLoad(&occ[h]) > info.y) { atomicMin(&occ[h], info.y); }
    if (atomicLoad(&occ[h + 1u]) < info.y) { atomicMax(&occ[h + 1u], info.y); }
  }
}
`);

K('candBuild', [['loc', 'rw'], ['candList', 'rw'], ['nodeInfo', 'r'], ['posVel', 'r'], ['stepBox', 'r'], ['bodies', 'r'],
  ['occ', 'rw']], /* wgsl */`
${OCC_PATH}
var<workgroup> wCnt: atomic<u32>;
var<workgroup> wBase: u32;
fn contested(c: vec2<i32>, body: u32) -> bool {
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let h = (hashCell(c + vec2<i32>(dx, dy)) & cfg.occMask) * 2u;
      let mn = atomicLoad(&occ[h]);
      if (mn != 0xffffffffu && (mn != body || atomicLoad(&occ[h + 1u]) != body)) { return true; }
    }
  }
  return false;
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) { atomicStore(&wCnt, 0u); }
  workgroupBarrier();
  let i = gid.x;
  var want = false;
  var at = 0u;
  if (i < cfg.nodeCount) {
    let info = nodeInfo[i];
    if ((info.x & N_ACTIVE) != 0u && (info.x & N_STATIC) == 0u) {
      let box = stepBox[info.y];
      if (box.x <= box.z) {
        let x = posVel[i].xy;
        if (all(x >= box.xy) && all(x <= box.zw)) {
          let path = occPath(i, info, bodies[info.y]);
          let n = occSteps(path);
          var last = vec2<i32>(0x7fffffff);
          for (var s = 0u; s <= n && !want; s++) {
            let c = vec2<i32>(floor(mix(path.xy, path.zw, f32(s) / f32(max(n, 1u))) / cfg.occCell));
            if (all(c == last)) { continue; }
            last = c;
            want = contested(c, info.y);
          }
          if (want) { at = atomicAdd(&wCnt, 1u); }
        }
      }
    }
  }
  workgroupBarrier();
  if (lid == 0u) { wBase = atomicAdd(&loc[LOC_CAND], atomicLoad(&wCnt)); }
  workgroupBarrier();
  if (want && wBase + at < cfg.listCap) { candList[wBase + at] = i; }
}
`);

K('candArgs', [['loc', 'rw'], ['locArgs', 'rw']], /* wgsl */`
@compute @workgroup_size(1)
fn main() {
  let n = min(atomicLoad(&loc[LOC_CAND]), cfg.listCap);
  locArgs[${ARG.cand}u] = max(1u, (n + 63u) / 64u);   // ≥ 1: grupa 0 clearReset zeruje pary
  locArgs[${ARG.cand + 1}u] = 1u;
  locArgs[${ARG.cand + 2}u] = 1u;
  atomicMax(&loc[${LOC.maxCand}u], n);
}
`);

// Po rozpadzie (reseat): reseat dopasowuje ruch sztywny nowego ciała do pola prędkości węzłów i odejmuje
// go od węzłów — węzły, które przed rozpadem spoczywały (poza A), dostają prędkość −(v₀ + ω×r) samego
// dopasowania. Solver lokalny zakłada spoczynek poza A: zerujemy ją, a pęd liniowy i moment pędu
// tych węzłów idą na ciało (całkowity moment pędu zachowany). Węzły z A zostają z prędkością względną.
K('topoActivate', [['topoOps', 'r'], ['bodies', 'r'], ['nodeLists', 'r'], ['nodeInfo', 'r'], ['posVel', 'rw'],
  ['restMass', 'r'], ['bodyAcc', 'rw'], ...ACT_BINDINGS], /* wgsl */`
${ACTIVATE}
${FIXED}
var<workgroup> wS: array<atomic<i32>, 6>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  if (lid < 6u) { atomicStore(&wS[lid], 0); }
  workgroupBarrier();
  let op = topoOps[wid.y];
  let lst = bodies[op.body].list;
  let k = wid.x * 64u + lid;
  if (k < lst.y) {
    let i = nodeLists[lst.x + k];
    if ((nodeInfo[i].x & N_ACTIVE) != 0u) {
      let pv = posVel[i];
      if ((actState[i] & ACT_BIT) != 0u) {
        activate(i);
      } else if (pv.z != 0.0 || pv.w != 0.0) {
        let m = restMass[i].z;
        let mom = pv.zw * m;
        let lm = m * cross2(pv.xy, pv.zw);
        let hx = fixHi(mom.x);
        let hy = fixHi(mom.y);
        let hl = fixHi(lm);
        atomicAdd(&wS[0], hx);
        atomicAdd(&wS[1], fixLo(mom.x, hx));
        atomicAdd(&wS[2], hy);
        atomicAdd(&wS[3], fixLo(mom.y, hy));
        atomicAdd(&wS[4], hl);
        atomicAdd(&wS[5], fixLo(lm, hl));
        posVel[i] = vec4<f32>(pv.xy, 0.0, 0.0);
      }
    }
  }
  workgroupBarrier();
  if (lid < 6u) {
    let v = atomicLoad(&wS[lid]);
    let w = select(lid, ${ACC.lHi}u + lid - 4u, lid >= 4u);
    if (v != 0) { atomicAdd(&bodyAcc[op.body * ${BODY_ACC}u + w], v); }
  }
}
`);

// ------------------------------------------------------------------ naprawa (N)

K('repairBeams', [['beamEnds', 'r'], ['beamLen', 'rw'], ['beamMat', 'rw'], ['beamFlags', 'rw'], ['nodeInfo', 'r'],
  ['beamSlot', 'r'], ['gsPack', 'rw']], /* wgsl */`
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let e = gid.x;
  if (e >= cfg.beamCount) { return; }
  let ends = beamEnds[e];
  let ia = nodeInfo[ends.x];
  let ib = nodeInfo[ends.y];
  if ((ia.x & ib.x & N_ACTIVE) == 0u || ia.y != ib.y) { return; }
  let stepK = sp.dt;
  var mat = beamMat[e];
  if (mat.w > 0.0) { mat.w = max(0.0, mat.w - stepK * 2.0); beamMat[e] = mat; }
  var l = beamLen[e];
  if (l.x != l.y) {
    l.x += (l.y - l.x) * stepK * 2.0;
    if (abs(l.x - l.y) < 1e-4) { l.x = l.y; }
    beamLen[e] = l;
    gsPack[beamSlot[e]].z = bitcast<u32>(l.x);   // prepare przepisuje rekord GS tylko przy zmianie rest / wagi
  }
  beamFlags[e] = beamFlags[e] & ~1u;
}
`);

K('repairNodes', [['nodeInfo', 'r'], ['posVel', 'rw'], ['restMass', 'rw'], ['nodeAux', 'r'], ['nodeMeta', 'rw'],
  ['adj', 'r'], ['beamFlags', 'r'], ['bodyEvents', 'rw'], ['loc', 'rw'], ['listMark', 'rw'], ['actState', 'rw'], ['regionList', 'rw']], /* wgsl */`
${ACTIVATE}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) != 0u) { return; }
  let stepK = sp.dt;
  var pv = posVel[i];
  var rm = restMass[i];
  pv = vec4<f32>(pv.xy + (rm.xy - pv.xy) * stepK * 2.0, pv.zw);
  let maxHp = nodeAux[i].x;
  if (rm.w < maxHp) { rm.w = min(maxHp, rm.w + maxHp * stepK); }
  posVel[i] = pv;
  restMass[i] = rm;
  activate(i);
  atomicOr(&bodyEvents[info.y], E_WAKE);
}
`);

// ------------------------------------------------------------------ kamera (render)

// Środek widoku liczony na GPU z ciała za którym jedzie kamera — bez opóźnienia odczytu.
K('camera', [['bodies', 'r'], ['camState', 'rw', 'array<vec4<f32>>']], /* wgsl */`
struct CamIn { mode: u32, a: u32, b: u32, _p: u32, free: vec4<f32>, offset: vec4<f32> }
@group(2) @binding(0) var<uniform> camIn: CamIn;
@compute @workgroup_size(1)
fn main() {
  var c = camIn.free;
  if (camIn.mode == 1u) {
    let b = bodies[camIn.a];
    c = posAdd(vec4<f32>(b.pos.xy, b.pos.zw), camIn.offset.xy);
  } else if (camIn.mode == 2u) {
    let a = bodies[camIn.a];
    let b = bodies[camIn.b];
    let mid = posDiff(b.pos, a.pos) * 0.5;
    c = posAdd(a.pos, mid + camIn.offset.xy);
  }
  camState[0] = c;
}
`, { cameraGroup: true });

// ------------------------------------------------------------------ składanie źródeł

export function kernelSource(name) {
  const k = KERNELS[name];
  if (!k) throw new Error(`nieznany kernel ${name}`);
  const decl = k.bindings.map(([buf, access, type], i) => {
    const t = type || BUFFERS[buf] || 'array<u32>';
    const mode = access === 'r' ? 'read' : 'read_write';
    return `@group(0) @binding(${i}) var<storage, ${mode}> ${buf}: ${t};`;
  }).join('\n');
  return `${COMMON}\n${CONFIG_WGSL}\n${STEP_WGSL}\n@group(1) @binding(0) var<uniform> cfg: Config;\n@group(1) @binding(1) var<uniform> sp: Step;\n${decl}\n${k.code}`;
}
