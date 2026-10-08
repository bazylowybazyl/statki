// src/ai/npcCommandPilot.js
//
// Komendy RTS (move / approach / hold / orbit / ram / attack-move) dla okrętów,
// które latają modelem shipFlightModel. Komenda tylko ustawia intencję lotu;
// sam lot liczy stepShipFlight w npcStep — ten sam pilot i ta sama
// specyfikacja kadłuba co w walce, więc rozkaz „leć tam" nie ma innej fizyki
// niż autonomiczne AI (dawniej: dysze z edytora dla jednych, kinematyka dla
// innych).
//
// Zależności od index.html wchodzą przez `deps`, żeby moduł był testowalny:
//   getTargetPos(npc, cmd) → {x, y} | null
//   pickTarget(npc)        → cel dla attack-move
//   triggerRam(npc, impulse)
//   defaultOrbitRadius
//   steer, freePoint, separate — omijanie przeszkód (capitalAI.js: capitalCommandSteer,
//     capitalCommandFreePoint, capitalCommandSeparate); bez nich lot prosto, jak dawniej.

import {
  resolveShipFlightSpec,
  setFlightArrive,
  wrapFlightAngle
} from '../game/flight/shipFlightModel.js';

// Na miejscu = w promieniu przybycia i prędkość względna poniżej tego progu.
const ARRIVED_REL_SPEED = 40;
// Taran odpala dopiero przy dziobie na celu i spokojnym obrocie.
const RAM_ALIGN = 0.28;
const RAM_MAX_SPIN = 0.55;
// Ruch zatrzymany przez przeszkodę, gdy punkt leży w jej strefie (wrak albo okręt na miejscu) —
// po tylu sekundach postoju rozkaz kończy się „hold” tam, gdzie okręt stoi; zatrzymany dalej od punktu
// przez stojące przeszkody (ściśnięty w tłumie okrętów, które już stanęły) — po STUCK_HOLD_TIME.
const BLOCKED_HOLD_TIME = 1.2;
const STUCK_HOLD_TIME = 3;
// …ale nie w pierwszych sekundach rozkazu: grupa rusza z postoju i stojący przed okrętem sąsiad zaraz odjedzie.
const STUCK_MIN_AGE = 5;
// Promień przybycia do wolnego punktu przy wraku (punkt rozkazu leżał w wraku): podjedź pod sam wrak.
const FREE_POINT_ARRIVAL = 40;

// ---------------------------------------------------------------------------
// Omijanie przeszkód (2026-10-08). Mózgi bojowe i szyk omijają przez capitalArriveControls;
// rozkaz RTS dawniej ustawiał setFlightArrive wprost i taranował okręty, gracza i wraki. Teraz
// ta sama droga (deps.steer = capitalCommandSteer): ogranicznik przed przeszkodą, objazd po
// stycznej, sufit całej prędkości od wraków; do tego separacja i unik CPA (deps.separate), których
// okręt na rozkazie nie dostawał (wektor separacji zostawał sprzed rozkazu).
// Rozkaz biegnie co tick fizyki, a zapytanie o przeszkody kosztuje tyle co u mózgu — liczymy je
// raz na takt AI (1/20 s) z fazą per okręt (rozkaz dla grupy nie liczy wszystkich w jednym ticku)
// i od razu przy nowym rozkazie; między taktami punkt objazdu jedzie z prędkością przeszkody,
// ograniczniki — z ostatniego taktu (jak intencja mózgu).
// ---------------------------------------------------------------------------
const STEER_PERIOD = 1 / 20;
const STEER_PHASES = 6;
let _steerPhase = 0;
// A/B w grze: window.CommandAvoidTune.enabled = false — dawny pilot (bez omijania i separacji).
export const COMMAND_AVOID_TUNE = { enabled: true };
if (typeof window !== 'undefined') window.CommandAvoidTune = COMMAND_AVOID_TUNE;

// Pola liczbowe od początku jako double (V8: zmiana reprezentacji pola = wolna ścieżka).
function newSteerState() {
  return {
    cmd: null,
    next: 0.5,
    t: 0.5,
    age: 0.5,
    blockedT: 0.5,
    detour: false,
    blocked: 0,
    aimX: 0.5,
    aimY: 0.5,
    aimVx: 0.5,
    aimVy: 0.5,
    approachCap: Infinity,
    totalCap: Infinity,
    // wolny punkt rozkazu ruchu (capitalCommandFreePoint)
    x: 0.5,
    y: 0.5,
    moved: false
  };
}

function steerState(npc) {
  let st = npc.__cmdSteer;
  if (!st) {
    st = npc.__cmdSteer = newSteerState();
    st.next = ((_steerPhase++ % STEER_PHASES) + 0.5) * (STEER_PERIOD / STEER_PHASES);
  }
  return st;
}

// Takt omijania: przelicz przy nowym rozkazie albo gdy minął okres. `free` — punkt rozkazu ruchu
// może leżeć w wraku (wolny punkt). Zwraca stan albo null (bez omijania — testy, atrapy).
function steerTick(npc, cmd, tx, ty, arrival, ignore, loose, free, deps, dt) {
  if (!COMMAND_AVOID_TUNE.enabled || typeof deps.steer !== 'function') return null;
  const st = steerState(npc);
  st.next -= dt;
  st.t += dt;
  st.age += dt;
  if (st.cmd === cmd && st.next > 0) return st;
  if (st.cmd !== cmd) {
    st.blockedT = 0;
    st.age = 0;
  }
  st.cmd = cmd;
  st.t = 0;
  st.next = st.next > 0 ? STEER_PERIOD : Math.max(st.next + STEER_PERIOD, 0.25 * STEER_PERIOD);
  st.moved = false;
  if (free && typeof deps.freePoint === 'function') {
    deps.freePoint(npc, tx, ty, ignore, st);
    if (st.moved) {
      tx = st.x;
      ty = st.y;
      arrival = Math.min(arrival, FREE_POINT_ARRIVAL);
    }
  }
  deps.steer(npc, tx, ty, arrival, ignore, loose, st);
  if (typeof deps.separate === 'function') deps.separate(npc);
  return st;
}

// Intencja lotu do (tx, ty) z omijaniem: objazd (punkt jedzie z przeszkodą) albo prosto z ogranicznikami.
function arriveAvoiding(npc, st, tx, ty, opts) {
  if (!st) {
    setFlightArrive(npc, tx, ty, opts);
    return;
  }
  opts.approachCap = st.approachCap;
  opts.totalCap = st.totalCap;
  if (st.detour) {
    opts.arrival = 0;
    opts.noBrake = false;
    opts.refVx = st.aimVx;
    opts.refVy = st.aimVy;
    setFlightArrive(npc, st.aimX + st.aimVx * st.t, st.aimY + st.aimVy * st.t, opts);
    return;
  }
  setFlightArrive(npc, tx, ty, opts);
}

function liveEntity(e) {
  return e && !e.dead && !e.destroyed && !e.removed ? e : null;
}

function velX(e) { return Number(e?.vel?.x ?? e?.vx) || 0; }
function velY(e) { return Number(e?.vel?.y ?? e?.vy) || 0; }

// Zwraca true, gdy komenda steruje okrętem w tym ticku (jak executeNpcCommand);
// false — gdy komenda się skończyła albo oddaje sterowanie mózgowi (attack-move
// z celem). `dt` — krok fizyki (takt omijania przeszkód, postój przy przeszkodzie).
export function applyNpcCommandIntent(npc, cmd, deps = {}, dt = 1 / 120) {
  if (!npc || !cmd) return false;
  const spec = resolveShipFlightSpec(npc);
  if (!spec) return false;

  if (cmd.type === 'hold') {
    // Trzymamy PUNKT, w którym padł rozkaz (odpychany okręt wraca), i kurs:
    // zadany albo ten, który miał w chwili rozkazu. Omijanie: odepchnięty okręt nie wraca
    // przez przeszkodę, która stanęła między nim a punktem (staje przed nią).
    if (!Number.isFinite(cmd.holdX) || !Number.isFinite(cmd.holdY)) {
      cmd.holdX = npc.x;
      cmd.holdY = npc.y;
    }
    if (!Number.isFinite(cmd.faceAngle) && !Number.isFinite(cmd.holdFace)) cmd.holdFace = Number(npc.angle) || 0;
    const face = Number.isFinite(cmd.faceAngle) ? cmd.faceAngle : cmd.holdFace;
    const st = steerTick(npc, cmd, cmd.holdX, cmd.holdY, 0, null, false, false, deps, dt);
    arriveAvoiding(npc, st, cmd.holdX, cmd.holdY, { arrival: 0, speedMode: 'combat', face, faceNear: 0, faceFar: 0 });
    npc.forceTarget = null;
    return true;
  }

  const targetPos = typeof deps.getTargetPos === 'function' ? deps.getTargetPos(npc, cmd) : null;
  if (!targetPos) {
    npc.command = null;
    npc.forceTarget = null;
    return false;
  }

  if (cmd.type === 'attack-move') {
    const target = liveEntity(cmd.targetEntity) || (typeof deps.pickTarget === 'function' ? deps.pickTarget(npc) : null);
    if (target) {
      npc.forceTarget = target;
      return false;
    }
  }

  const ent = liveEntity(cmd.targetEntity);
  const refVx = ent ? velX(ent) : 0;
  const refVy = ent ? velY(ent) : 0;
  const dx = targetPos.x - npc.x;
  const dy = targetPos.y - npc.y;
  const dist = Math.hypot(dx, dy);

  if (cmd.type === 'orbit') {
    // „Marchewka" na okręgu kawałek przed okrętem: lecąc za nią, okręt kreśli
    // okrąg. Prędkość tak dobrana, żeby przyspieszenie dośrodkowe (boczne dysze
    // + część ciągu) wystarczyło na ten promień.
    const radius = Math.max(80, Number(cmd.orbitRadius) || Number(deps.defaultOrbitRadius) || 900);
    const dir = (Number(cmd.orbitDir) || 1) >= 0 ? 1 : -1;
    const speed = Math.min(spec.maxSpeed, Math.sqrt(radius * (spec.strafeAccel + 0.5 * spec.accel)));
    const lead = Math.max(0.15, Math.min(0.9, (speed * 1.2) / radius));
    const a = Math.atan2(npc.y - targetPos.y, npc.x - targetPos.x) + dir * lead;
    const cx = targetPos.x + Math.cos(a) * radius;
    const cy = targetPos.y + Math.sin(a) * radius;
    // Orbitowany byt nie jest przeszkodą; objazd także punktu w strefie przeszkody (marchewka
    // tuż przed okrętem — inaczej stawał na okręgu przed wrakiem albo okrętem z przeciwka).
    const st = steerTick(npc, cmd, cx, cy, 0, ent, true, false, deps, dt);
    arriveAvoiding(npc, st, cx, cy, {
      arrival: 0,
      speedLimit: speed,
      noBrake: true,
      refVx,
      refVy
    });
    return true;
  }

  if (cmd.type === 'ram') {
    const heading = Math.atan2(dy, dx);
    // Taranowany byt nie jest przeszkodą — reszta (wraki, okręty po drodze) tak.
    const st = steerTick(npc, cmd, targetPos.x, targetPos.y, 0, ent, true, false, deps, dt);
    arriveAvoiding(npc, st, targetPos.x, targetPos.y, {
      arrival: 0,
      speedMode: 'cruise',
      noBrake: true,
      refVx,
      refVy,
      face: heading,
      faceNear: 0,
      faceFar: 0
    });
    const targetRadius = Math.max(0, Number(ent?.radius || ent?.r || ent?.baseR || 0) || 0);
    const shipRadius = Math.max(0, Number(npc.radius || npc.r || 0) || 0);
    const trigger = Math.max(
      180,
      Number(cmd.ramTriggerDistance) || 0,
      Math.min(Number(cmd.arrival) || Infinity, targetRadius + shipRadius + 260)
    );
    const aligned = Math.abs(wrapFlightAngle(heading - (Number(npc.angle) || 0))) < RAM_ALIGN
      && Math.abs(Number(npc.angVel) || 0) < RAM_MAX_SPIN;
    if (!cmd.ramImpulseDone && dist <= trigger && aligned) {
      cmd.ramImpulseDone = true;
      const angle = Number(npc.angle) || 0;
      if (typeof deps.triggerRam === 'function') {
        deps.triggerRam(npc, {
          power: Math.max(1600, Number(cmd.ramImpulse) || 3400),
          dirX: Math.cos(angle),
          dirY: Math.sin(angle),
          distance: dist
        });
      }
      if (npc.command === cmd) npc.command = null;
    }
    return true;
  }

  // move / approach / attack-move bez celu
  let arrival = Math.max(0, Number(cmd.arrival) || Number(deps.defaultArrival) || ((Number(npc.radius) || 20) + 20));
  const relSpeed = Math.hypot((Number(npc.vx) || 0) - refVx, (Number(npc.vy) || 0) - refVy);
  // Podchodzony byt nie jest przeszkodą (jego rozmiar siedzi w promieniu przybycia); punkt bez bytu
  // w kapsule wraku → najbliższy wolny punkt przy wraku.
  const st = steerTick(npc, cmd, targetPos.x, targetPos.y, arrival, ent, false, !ent, deps, dt);
  let goalX = targetPos.x;
  let goalY = targetPos.y;
  let goalDist = dist;
  if (st && st.moved) {
    goalX = st.x;
    goalY = st.y;
    goalDist = Math.hypot(goalX - npc.x, goalY - npc.y);
    arrival = Math.min(arrival, FREE_POINT_ARRIVAL);
  }
  const slack = Math.max(6, Math.min(24, arrival * 0.1));
  // Stoi przed przeszkodą, która zajmuje punkt (albo w tłumie stojących) — bliżej się nie da.
  if (st) st.blockedT = st.blocked > 0 && relSpeed < ARRIVED_REL_SPEED ? st.blockedT + dt : 0;
  const blockedLong = !!st && (st.blocked === 1
    ? st.blockedT >= BLOCKED_HOLD_TIME
    : st.blockedT >= STUCK_HOLD_TIME && st.age >= STUCK_MIN_AGE);
  if ((goalDist <= arrival + slack && relSpeed < ARRIVED_REL_SPEED) || blockedLong) {
    // Na miejscu komenda przechodzi w „hold": trzymaj punkt (i zadany kurs).
    const hold = Number.isFinite(cmd.faceAngle) ? { type: 'hold', faceAngle: cmd.faceAngle } : { type: 'hold' };
    npc.command = hold;
    npc.forceTarget = null;
    return applyNpcCommandIntent(npc, hold, deps, dt);
  }
  const face = Number.isFinite(cmd.faceAngle) ? cmd.faceAngle : NaN;
  arriveAvoiding(npc, st, goalX, goalY, {
    arrival,
    speedMode: dist > 4000 ? 'cruise' : 'combat',
    refVx,
    refVy,
    face,
    faceNear: arrival,
    faceFar: arrival + Math.max(600, spec.maxSpeed * 2)
  });
  return true;
}
