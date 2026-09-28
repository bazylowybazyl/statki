// Kernele WGSL fizyki belek (tryb płaski) — port destructorBeams3D.js na compute.
//
// Model ten sam co na CPU: ciało sztywne (pozycja, prędkość, kąt) niesie ruch całości,
// węzły w układzie ciała odkształcają się przez PBD na belkach. Różnice wynikające z GPU:
//  - Gauss-Seidel z kolorowaniem krawędzi (belki jednego koloru nie dzielą węzłów),
//  - zawsze PEŁNY solver (odpowiednik cfg.localSolver = false) — GPU nie oszczędza na śnie,
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

// Flagi ciała (state.x)
export const BODY = { USED: 1, STATIC: 2, DEAD: 4, SLEEP: 8, NOSPLIT: 16, WRECK: 32 };
// Flagi węzła (nodeInfo.x)
export const NODE = { ACTIVE: 1, SURFACE: 2, MOUNTFAIL: 4, DOOMED: 8, STATIC: 16 };
// Flagi kroku (step.flags)
export const STEP = { CONTROLS: 1, FIRE: 2, DAMAGE: 4, TRANSFER: 8, WEAPONS: 16 };
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
  ['heatWoundWindow', 'f32'], ['listCount', 'u32'], ['reduceStride', 'u32'], ['_pad1', 'u32']
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
const E_WAKE: u32 = 1u;
const E_INTEGRITY: u32 = 2u;
const E_DIRTY: u32 = 4u;
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
  worldPos: 'array<vec2<f32>>',
  gridNext: 'array<i32>',
  gridHead: 'array<atomic<i32>>',
  staticHead: 'array<i32>',
  crush: 'array<atomic<u32>>',        // 2 na węzeł: głębokość (bity f32), stempel
  massStamp: 'array<atomic<u32>>',
  nodeLists: 'array<u32>',
  beamEnds: 'array<vec2<u32>>',
  beamLen: 'array<vec4<f32>>',        // rest, restBase, factor, strain
  beamMat: 'array<vec4<f32>>',        // sztywność, próg plastyczności, próg zerwania, zmęczenie
  beamFlags: 'array<u32>',            // bit0 zerwana, bit1 most pierwotny, typ << 8
  colorBeams: 'array<u32>',
  gsTable: 'array<u32>',
  partials: 'array<vec4<f32>>',       // sumy częściowe redukcji: 4 × vec4 na (ciało, kawałek listy)
  bodyNear: 'array<u32>',             // 1 = kula ciała dotyka innego ciała (siatka i wąska faza)
  pairFlags: 'array<atomic<u32>>',
  collide: 'array<atomic<u32>>',      // [0] par, [1] kontaktów, [2..] klucze par
  contacts: 'array<Contact>',
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
  topoBits: 'array<u32>'
};

// ------------------------------------------------------------------ kernele

export const KERNELS = {};
const K = (name, bindings, code, extra = {}) => { KERNELS[name] = { bindings, code, ...extra }; };

// Ruch ciał sztywnych + sterowanie lotem (applyPlanarFlightControls) w pierwszym podkroku kroku.
K('integrate', [['bodies', 'rw']], /* wgsl */`
fn approach(v: f32, goal: f32, stepV: f32) -> f32 { return v + clamp(goal - v, -stepV, stepV); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.bodyCount) { return; }
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
`);

// Zdarzenia z trafień (budzenie) → stan ciała; zdarzenie integralności gaśnie po krokach broni.
K('bodyEvents', [['bodies', 'rw'], ['bodyEvents', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.bodyCount) { return; }
  let ev = atomicAnd(&bodyEvents[i], E_DIRTY);
  if ((ev & E_WAKE) == 0u) { return; }
  var b = bodies[i];
  b.state.x = b.state.x & ~B_SLEEP;
  b.state.y = 0u;
  b.state.z = max(b.state.z, cfg.wakeHoldFrames);
  bodies[i] = b;
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
K('prepare', [['bodies', 'r'], ['pred', 'r'], ['invMass', 'r'], ['nodeInfo', 'r'], ['beamEnds', 'r'],
  ['beamLen', 'rw'], ['beamMat', 'rw'], ['beamFlags', 'rw'], ['counters', 'rw'], ['bodyEvents', 'rw'], ['nodeAux', 'rw']], /* wgsl */`
// Brzeg rany zderzenia (tylko wygląd): belka zerwana tuż po styku rozżarza oba końce do poziomu zderzenia.
fn woundHeat(i: u32, level: f32) {
  var aux = nodeAux[i];
  let decayed = aux.y * exp(-max(0.0, sp.time - aux.z) * 0.35);
  if (level > decayed) { aux.y = min(1.0, level); aux.z = sp.time; nodeAux[i] = aux; }
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let e = gid.x;
  if (e >= cfg.beamCount) { return; }
  var len4 = beamLen[e];
  let fl = beamFlags[e];
  if ((fl & 1u) != 0u) {
    if (len4.z != 0.0) { beamLen[e].z = 0.0; }
    return;
  }
  let ends = beamEnds[e];
  let ia = nodeInfo[ends.x];
  let ib = nodeInfo[ends.y];
  if ((ia.x & ib.x & N_ACTIVE) == 0u) {
    if (len4.z != 0.0) { beamLen[e].z = 0.0; }
    return;
  }
  let body = bodies[ia.y];
  if (!bodySolving(body)) {
    if (len4.z != 0.0) { beamLen[e].z = 0.0; }
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
      beamLen[e] = vec4<f32>(rest, restBase, factor, len4.w);
      beamMat[e].w = mat.w;
      return;
    }
  }
  beamFlags[e] = fl | 1u;
  beamLen[e] = vec4<f32>(len4.x, len4.y, 0.0, len4.w);
  beamMat[e].w = mat.w;
  atomicAdd(&counters[${COUNTER.beamsBroken}], 1u);
  atomicOr(&bodyEvents[ia.y], E_DIRTY);
  if (cfg.heatGain > 0.0 && body.rot.z > 0.02 && sp.time - body.rot.w <= cfg.heatWoundWindow) {
    woundHeat(ends.x, body.rot.z);
    woundHeat(ends.y, body.rot.z);
  }
}
`);

// 3) rzutowanie więzów — jeden kolor naraz (przesunięcie dynamiczne: początek i liczba belek koloru)
const SOLVE_BEAM = /* wgsl */`
fn solveBeam(e: u32) {
  let l = beamLen[e];
  if (l.z == 0.0) { return; }
  let ends = beamEnds[e];
  let pa = pred[ends.x];
  let pb = pred[ends.y];
  let d = pb - pa;
  let len = length(d);
  if (len < 1e-9) { return; }
  let c = d * ((len - l.x) / len * l.z);
  pred[ends.x] = pa + c * invMass[ends.x];
  pred[ends.y] = pb - c * invMass[ends.y];
}
`;
K('gsColor', [['beamEnds', 'r'], ['beamLen', 'r'], ['pred', 'rw'], ['invMass', 'r'], ['colorBeams', 'r']], /* wgsl */`
struct ColorRange { start: u32, count: u32 }
@group(2) @binding(0) var<uniform> colorRange: ColorRange;
${SOLVE_BEAM}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= colorRange.count) { return; }
  solveBeam(colorBeams[colorRange.start + k]);
}
`, { colorGroup: true });

// 3b) Małe kadłuby: wszystkie iteracje i kolory w JEDNEJ grupie roboczej na kadłub (bariera między
//     kolorami zamiast osobnego dispatcha). Przy kilkunastu tysiącach belek narzut ~40 dispatchy
//     na podkrok był większy niż samo liczenie. gsTable: na instancję [liczba kolorów, (start, count) × MAX].
export const GS_GROUP_COLORS = 32;
export const GS_GROUP_SIZE = 256;   // domyślny rozmiar grupy; świat podaje własny przez stałą override GS_SIZE
K('gsGroup', [['beamEnds', 'r'], ['beamLen', 'r'], ['pred', 'rw'], ['invMass', 'r'], ['colorBeams', 'r'], ['gsTable', 'r']], /* wgsl */`
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
      for (var j = lid; j < r.y; j += GS_SIZE) { solveBeam(colorBeams[r.x + j]); }
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
K('nearFlags', [['bodies', 'r'], ['bodyNear', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.bodyCount) { return; }
  let a = bodies[i];
  var near = 0u;
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
      if (dot(rel, rel) <= r * r) { near = 1u; break; }
    }
  }
  bodyNear[i] = near;
}
`);

// Kontakty — czyszczenie listy par z poprzedniej iteracji (jedna grupa robocza).
K('collideReset', [['pairFlags', 'rw'], ['collide', 'rw']], /* wgsl */`
var<workgroup> wN: u32;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) { wN = min(atomicLoad(&collide[0]), cfg.maxPairs); }
  let n = workgroupUniformLoad(&wN);
  for (var k = lid; k < n; k += 64u) {
    let key = atomicLoad(&collide[2u + k]);
    atomicStore(&pairFlags[key], 0u);
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
K('insert', [['bodies', 'r'], ['nodeInfo', 'r'], ['posVel', 'rw'], ['worldPos', 'rw'], ['gridNext', 'rw'],
  ['gridHead', 'rw'], ['bodyNear', 'r']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) != 0u) { return; }
  let b = bodies[info.y];
  if ((b.state.x & B_DEAD) != 0u) { return; }
  var pv = posVel[i];
  if ((sp.flags & S_TRANSFER) != 0u && (abs(b.transfer.x) + abs(b.transfer.y) + abs(b.transfer.z) + abs(b.transfer.w)) > 0.0) {
    pv = pv - b.transfer;
    posVel[i] = pv;
  }
  if (bodyNear[info.y] == 0u) { return; }
  let w = posRel(b.pos, vec2<f32>(sp.originX, sp.originY)) + rot2(b.rot.xy, pv.xy);
  worldPos[i] = w;
  let cell = vec2<i32>(floor(w / cfg.gridCell));
  let h = hashCell(cell) & cfg.gridMask;
  gridNext[i] = atomicExchange(&gridHead[h], i32(i));
}
`);

// Ciała statyczne: siatka budowana raz (ściana się nie rusza). Zmienna 'gridHead' = bufor staticHead.
K('insertStatic', [['bodies', 'r'], ['nodeInfo', 'r'], ['posVel', 'r'], ['worldPos', 'rw'], ['gridNext', 'rw'],
  ['gridHead', 'rw', null, 'staticHead']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) == 0u) { return; }
  let b = bodies[info.y];
  let w = posRel(b.pos, vec2<f32>(sp.originX, sp.originY)) + rot2(b.rot.xy, posVel[i].xy);
  worldPos[i] = w;
  let cell = vec2<i32>(floor(w / cfg.gridCell));
  let h = hashCell(cell) & cfg.staticMask;
  gridNext[i] = atomicExchange(&gridHead[h], i32(i));
}
`);

// Wąska faza: węzeł ciała „iterującego” (mniej żywych węzłów w parze, jak collideBodies) szuka
// najbliższego węzła każdego innego ciała w promieniu styku. Klucz pary = mniejszy·MAX + większy.
K('narrow', [['bodies', 'r'], ['nodeInfo', 'r'], ['worldPos', 'r'], ['gridNext', 'r'], ['gridHead', 'r', 'array<i32>'],
  ['staticHead', 'r'], ['pairFlags', 'rw'], ['collide', 'rw'], ['contacts', 'rw'], ['bodyNear', 'r']], /* wgsl */`
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

fn consider(j: u32) {
  let bj = nodeInfo[j].y;
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
  let d = gW - worldPos[j];
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
  }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cfg.nodeCount) { return; }
  let info = nodeInfo[i];
  if ((info.x & N_ACTIVE) == 0u || (info.x & N_STATIC) != 0u) { return; }
  if (bodyNear[info.y] == 0u) { return; }
  let a = bodies[info.y];
  if ((a.state.x & B_DEAD) != 0u) { return; }
  gI = i; gA = info.y; gActA = a.list.z; gCsA = a.shape.z; gW = worldPos[i]; fN = 0u;
  let cell = vec2<i32>(floor(gW / cfg.gridCell));
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let c = cell + vec2<i32>(dx, dy);
      let hc = hashCell(c);
      var j = gridHead[hc & cfg.gridMask];
      loop {
        if (j < 0) { break; }
        consider(u32(j));
        j = gridNext[u32(j)];
      }
      if (cfg.staticMask != 0u) {
        j = staticHead[hc & cfg.staticMask];
        loop {
          if (j < 0) { break; }
          consider(u32(j));
          j = gridNext[u32(j)];
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
    let wj = worldPos[j];
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
  }
}
`);

K('pairArgs', [['collide', 'rw'], ['dispatchArgs', 'rw']], /* wgsl */`
@compute @workgroup_size(1)
fn main() {
  let pairs = min(atomicLoad(&collide[0]), cfg.maxPairs);
  let contactCount = min(atomicLoad(&collide[1]), cfg.contactCapacity);
  dispatchArgs[0] = pairs; dispatchArgs[1] = 1u; dispatchArgs[2] = 1u;
  dispatchArgs[3] = (contactCount + 63u) / 64u; dispatchArgs[4] = 1u; dispatchArgs[5] = 1u;
}
`);

// Agregat pary (grupa robocza na parę): limit maxContacts od kursora ciała iterującego jak
// na CPU (pierwsze N węzłów w kolejności cyklicznej), sumy w stałym przecinku.
K('pairAggregate', [['bodies', 'r'], ['restMass', 'r'], ['contacts', 'r'], ['collide', 'rw'], ['pairFlags', 'rw'],
  ['pairData', 'rw'], ['massStamp', 'rw']], /* wgsl */`
const WG: u32 = 256u;
var<workgroup> wKey: u32;
var<workgroup> wTotal: u32;
var<workgroup> wCursor: u32;
var<workgroup> wThreshold: u32;
var<workgroup> wCount: u32;
var<workgroup> wRange: vec2<u32>;
var<workgroup> sCnt: array<u32, 256>;
var<workgroup> acc: array<atomic<i32>, 6>;
var<workgroup> accPen: atomic<u32>;

fn keyOf(local: u32, cursor: u32, total: u32) -> u32 { return (local + total - (cursor % total)) % total; }

@compute @workgroup_size(256)
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
    pairData[p].iterBody = iterBody;
  }
  let key = workgroupUniformLoad(&wKey);
  let total = wTotal;
  let cursor = wCursor;
  let nC = min(atomicLoad(&collide[1]), cfg.contactCapacity);
  // liczba kontaktów pary
  var local = 0u;
  for (var k = lid; k < nC; k += WG) { if (contacts[k].key == key) { local++; } }
  sCnt[lid] = local;
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s = s >> 1u) {
    if (lid < s) { sCnt[lid] += sCnt[lid + s]; }
    workgroupBarrier();
  }
  if (lid == 0u) {
    wCount = sCnt[0];
    wRange = vec2<u32>(1u, total);
    wThreshold = total;
  }
  let cnt = workgroupUniformLoad(&wCount);
  // najmniejszy próg T z liczbą kontaktów o kluczu < T ≥ maxContacts (klucze unikalne → dokładnie maxContacts)
  if (cnt > cfg.maxContacts) {
    loop {
      let range = workgroupUniformLoad(&wRange);
      if (range.x >= range.y) { break; }
      let mid = (range.x + range.y) / 2u;
      var c = 0u;
      for (var k = lid; k < nC; k += WG) {
        let ct = contacts[k];
        if (ct.key == key && keyOf(ct.iterLocal, cursor, total) < mid) { c++; }
      }
      sCnt[lid] = c;
      workgroupBarrier();
      for (var s = WG / 2u; s > 0u; s = s >> 1u) {
        if (lid < s) { sCnt[lid] += sCnt[lid + s]; }
        workgroupBarrier();
      }
      if (lid == 0u) {
        if (sCnt[0] >= cfg.maxContacts) { wRange.y = mid; } else { wRange.x = mid + 1u; }
      }
      workgroupBarrier();
    }
    if (lid == 0u) { wThreshold = wRange.x; }
  }
  let threshold = workgroupUniformLoad(&wThreshold);
  let stampVal = (sp.stamp << 8u) | (p & 255u);
  var selected = 0u;
  for (var k = lid; k < nC; k += WG) {
    let ct = contacts[k];
    if (ct.key != key || keyOf(ct.iterLocal, cursor, total) >= threshold) { continue; }
    selected++;
    atomicAdd(&acc[0], i32(round(ct.hx * 64.0)));
    atomicAdd(&acc[1], i32(round(ct.hy * 64.0)));
    atomicAdd(&acc[2], i32(round(ct.nx * 4096.0)));
    atomicAdd(&acc[3], i32(round(ct.ny * 4096.0)));
    atomicMax(&accPen, bitcast<u32>(ct.pen));
    if (atomicExchange(&massStamp[ct.nodeA], stampVal) != stampVal) { atomicAdd(&acc[4], i32(round(restMass[ct.nodeA].z * 16.0))); }
    if (atomicExchange(&massStamp[ct.nodeB], stampVal) != stampVal) { atomicAdd(&acc[5], i32(round(restMass[ct.nodeB].z * 16.0))); }
  }
  sCnt[lid] = selected;
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s = s >> 1u) {
    if (lid < s) { sCnt[lid] += sCnt[lid + s]; }
    workgroupBarrier();
  }
  if (lid == 0u) {
    var pd = pairData[p];
    pd.key = key;
    pd.bodyA = key / cfg.maxBodies;
    pd.bodyB = key % cfg.maxBodies;
    pd.count = sCnt[0];
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
var<private> order: array<u32, ${MAX_PAIRS}>;

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

@compute @workgroup_size(1)
fn main() {
  let nP = min(atomicLoad(&collide[0]), cfg.maxPairs);
  for (var k = 0u; k < nP; k++) {
    var at = k;
    let key = pairData[k].key;
    loop {
      if (at == 0u) { break; }
      if (pairData[order[at - 1u]].key <= key) { break; }
      order[at] = order[at - 1u];
      at--;
    }
    order[at] = k;
  }
  let dt = sp.dt;
  let doDamage = (sp.flags & S_DAMAGE) != 0u;
  var contactsTotal = 0u;
  var maxPair = 0u;
  for (var oi = 0u; oi < nP; oi++) {
    let p = order[oi];
    var pd = pairData[p];
    pd.flags = 0u;
    if (pd.count == 0u) { pairData[p] = pd; continue; }
    let A = pd.bodyA;
    let B = pd.bodyB;
    var a = woken(bodies[A]);
    var b = woken(bodies[B]);
    let aStatic = (a.state.x & B_STATIC) != 0u;
    let bStatic = (b.state.x & B_STATIC) != 0u;
    let count = f32(pd.count);
    contactsTotal += pd.count;
    maxPair = max(maxPair, pd.total);
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
  if (doDamage) {
    atomicAdd(&counters[${COUNTER.contacts}], contactsTotal);
    atomicMax(&counters[${COUNTER.pairs}], nP);
    atomicMax(&counters[${COUNTER.maxPairContacts}], maxPair);
  }
}
`);

// Zgniot, faza 1: najgłębsze wymuszenie na węzeł (kilka kontaktów → jeden węzeł, bez mnożenia).
K('crushMark', [['contacts', 'r'], ['pairData', 'r'], ['pairFlags', 'rw'], ['collide', 'rw'], ['crush', 'rw'],
  ['nodeInfo', 'r']], /* wgsl */`
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
  if (pd.scaleA > 0.0 && (nodeInfo[c.nodeA].x & N_ACTIVE) != 0u) { atomicMax(&crush[c.nodeA * 2u], bitcast<u32>(depth * pd.scaleA)); }
  if (pd.scaleB > 0.0 && (nodeInfo[c.nodeB].x & N_ACTIVE) != 0u) { atomicMax(&crush[c.nodeB * 2u], bitcast<u32>(depth * pd.scaleB)); }
}
`);

// Zgniot, faza 2: węzeł przesuwa się raz o największą głębokość, z wyboczeniem na boki (_crushNode).
K('crushApply', [['contacts', 'r'], ['pairData', 'r'], ['pairFlags', 'rw'], ['collide', 'rw'], ['crush', 'rw'],
  ['posVel', 'rw'], ['restMass', 'r'], ['nodeAux', 'rw'], ['counters', 'rw']], /* wgsl */`
fn crushNode(i: u32, ln: vec2<f32>, heat: f32) {
  if (atomicExchange(&crush[i * 2u + 1u], sp.stamp) == sp.stamp) { return; }
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
  if (pd.scaleA > 0.0) { crushNode(c.nodeA, vec2<f32>(pd.lnAx, pd.lnAy), heat); }
  if (pd.scaleB > 0.0) { crushNode(c.nodeB, vec2<f32>(pd.lnBx, pd.lnBy), heat); }
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
    }
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
  ['bodyEvents', 'rw'], ['counters', 'rw']], /* wgsl */`
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
  if (rm.w <= 0.0) { nodeInfo[i].x = info.x | N_DOOMED; }
}
`);

// Zerwania belek w rdzeniu trafienia (środek belki w promieniu, obrażenia ≥ odporność typu).
K('impactBeams', [['nodeInfo', 'r'], ['posVel', 'r'], ['beamEnds', 'r'], ['beamFlags', 'rw'], ['impacts', 'r'],
  ['weaponState', 'rw'], ['bodyEvents', 'rw'], ['counters', 'rw']], /* wgsl */`
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
    return;
  }
}
`);

// Śmierć węzła (destroyNode): węzeł gaśnie, jego belki pękają, powstaje odłamek blachy.
K('deaths', [['bodies', 'r'], ['nodeInfo', 'rw'], ['posVel', 'r'], ['restMass', 'rw'], ['nodeMeta', 'r'], ['adj', 'r'],
  ['beamFlags', 'rw', 'array<atomic<u32>>'], ['nodeAux', 'r'], ['debris', 'rw'], ['counters', 'rw'], ['bodyEvents', 'rw']], /* wgsl */`
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
K('topoBreak', [['topoList', 'r'], ['beamFlags', 'rw', 'array<atomic<u32>>'], ['counters', 'rw']], /* wgsl */`
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = topoList[0];
  if (gid.x >= n) { return; }
  let old = atomicOr(&beamFlags[topoList[1u + gid.x]], 1u);
  if ((old & 1u) == 0u) { atomicAdd(&counters[${COUNTER.beamsBroken}], 1u); }
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
    b.state.x = b.state.x & ~(B_SLEEP | B_DEAD);
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

// ------------------------------------------------------------------ naprawa (N)

K('repairBeams', [['beamEnds', 'r'], ['beamLen', 'rw'], ['beamMat', 'rw'], ['beamFlags', 'rw'], ['nodeInfo', 'r']], /* wgsl */`
@compute @workgroup_size(64)
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
  }
  beamFlags[e] = beamFlags[e] & ~1u;
}
`);

K('repairNodes', [['nodeInfo', 'r'], ['posVel', 'rw'], ['restMass', 'rw'], ['nodeAux', 'r'], ['nodeMeta', 'rw'],
  ['adj', 'r'], ['beamFlags', 'r'], ['bodyEvents', 'rw']], /* wgsl */`
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
