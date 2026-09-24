// src/ai/capitalAI.js

import {
  resolveAiPersonality,
  resolveCapitalIdealRange,
  resolveHoldRange,
  updateCombatPressure
} from './capitalAiTuning.js';
import { getBattleSlot } from './fleetCoordinator.js';
import { AWARENESS_CONFIG } from './fleetAwareness.js';
import { PD_CHIP_ID, PD_HULL_SCORE, isPointDefenseWeapon } from './pointDefenseTargeting.js';
import {
  flightSpeedLimit,
  flightTurnTime,
  getFlightIntent,
  resolveShipFlightSpec,
  setFlightArrive,
  setFlightBoost,
  setFlightDodge,
  setFlightSeparation,
  setFlightStop,
  usesShipFlightModel
} from '../game/flight/shipFlightModel.js';

// ============================================================================
// 1. KIEROWCA — mózg ustawia INTENCJĘ lotu, ruch liczy shipFlightModel
// ============================================================================
//
// Mózgi (20 Hz, fazowane) nie całkują już ruchu. Dawniej applyCapitalAutopilot
// przesuwał okręt krokiem 0,05 s, a przez pozostałe 5 z 6 ticków fizyki robiła
// to ścieżka awaryjna npcStep z innym tarciem i innym sterownikiem obrotu:
// pozycja szła 1,83× szybciej, niż mówiła prędkość, a dwa regulatory obrotu
// biły się ze sobą (setki zmian kierunku na minutę). Teraz ruch liczy wyłącznie
// stepShipFlight w każdym ticku 120 Hz, według specyfikacji kadłuba
// (src/data/shipFlightSpecs.js).

const clampNum = (v, min, max) => Math.max(min, Math.min(max, v));
const TWO_PI = Math.PI * 2;

function wrapAng(a) {
  return window.wrapAngle ? window.wrapAngle(a) : Math.atan2(Math.sin(a), Math.cos(a));
}

// Zatwierdza intencję ustawioną przez mózg: dokłada separację (liczoną raz na
// tick AI) i stan dopalacza.
function commitCapitalFlight(npc, boostT = 0, dt = 1 / 20) {
  const sep = window.applySeparationForces ? window.applySeparationForces(npc, 0, 0) : null;
  setFlightSeparation(npc, sep?.ax || 0, sep?.ay || 0);
  setFlightBoost(npc, boostT > 0);
  if (!usesShipFlightModel(npc)) legacyFollowIntent(npc, boostT, dt);
}

// Byty bez specyfikacji kadłuba, które mimo to mają mózg kapitalny: prosta
// kinematyka po tej samej intencji. Pozycję i obrót całkuje dalej npcStep.
function legacyFollowIntent(npc, boostT, dt) {
  const it = getFlightIntent(npc);
  const boost = boostT > 0 ? 1.7 : 1;
  const maxSpeed = Math.max(40, (Number(it.speedLimit) || Number(npc.maxSpeed) || 200) * boost);
  const accel = Math.max(12, (Number(npc.accel) || 150) * boost);
  let desVx = 0;
  let desVy = 0;
  if (it.mode === 'arrive') {
    const dx = it.x - npc.x;
    const dy = it.y - npc.y;
    const d = Math.hypot(dx, dy);
    const reach = Math.max(0, d - it.arrival);
    const s = Math.min(maxSpeed, Math.sqrt(2 * accel * 0.8 * reach), reach * 1.6, it.approachCap);
    desVx = it.refVx;
    desVy = it.refVy;
    if (d > 1e-3) {
      desVx += (dx / d) * s;
      desVy += (dy / d) * s;
    }
  }
  desVx += it.sepAx * 0.6;
  desVy += it.sepAy * 0.6;
  const ex = desVx - (npc.vx || 0);
  const ey = desVy - (npc.vy || 0);
  const e = Math.hypot(ex, ey);
  if (e > 1e-6) {
    const step = Math.min(e, accel * Math.max(0, Number(dt) || 0));
    npc.vx = (npc.vx || 0) + (ex / e) * step;
    npc.vy = (npc.vy || 0) + (ey / e) * step;
  }
  if (Number.isFinite(it.face)) npc.desiredAngle = it.face;
  else if (desVx * desVx + desVy * desVy > 1600) npc.desiredAngle = Math.atan2(desVy, desVx);
}

// ============================================================================
// 1a. INTENCJE RUCHU — wspólne dla mózgów kapitalnych
// ============================================================================

// Bez jawnego trybu: dalej niż tyle od punktu leci z bonusem przelotowym,
// bliżej — prędkością bojową.
const COMBAT_RADIUS = 2600;

// Predykcyjny ogranicznik prędkości: maksymalna prędkość w danym KIERUNKU taka,
// by zdążyć wyhamować przed przeszkodą na kursie (gracz / inny duży okręt).
// Hamowanie bierzemy z tej samej specyfikacji, z której hamuje integrator —
// dawna stała 420 u/s² była drugim źródłem prawdy (pancernik hamuje 400,
// fregata 2000). Horyzont rośnie z bieżącą prędkością, bo z prędkości
// przelotowej ciężki okręt hamuje kilka kilometrów.
// Sprawdza DWA kierunki (do celu i pędu) w JEDNYM zapytaniu do grida i cache'uje
// wynik per klatkę (window.__frameId).
const OBSTACLE_LOOK_MIN = 1500;
const OBSTACLE_LOOK_MAX = 20000;
function capitalObstacleSpeedCap(npc, d1x, d1y, d2x, d2y, spec) {
  const fid = window.__frameId;
  if (fid && npc.__obsCapFid === fid && npc.__obsCapVal !== undefined) return npc.__obsCapVal;

  const brake = spec ? spec.decel * 0.85 : 420;
  const speed = Math.hypot(npc.vx || 0, npc.vy || 0);
  const look = clampNum((speed * speed) / (2 * brake) + 600, OBSTACLE_LOOK_MIN, OBSTACLE_LOOK_MAX);
  const myR = npc.radius || 100;
  const has2 = Number.isFinite(d2x) && (d2x !== 0 || d2y !== 0);
  let cap = Infinity;
  const consider = (ox, oy, oR) => {
    const rx = ox - npc.x;
    const ry = oy - npc.y;
    const clearance = myR + oR + 150;
    let along = rx * d1x + ry * d1y;
    if (along > 0 && along <= look) {
      const perp = Math.abs(-rx * d1y + ry * d1x);
      if (perp <= clearance) {
        const v = Math.sqrt(2 * brake * Math.max(0, along - clearance));
        if (v < cap) cap = v;
      }
    }
    if (has2) {
      along = rx * d2x + ry * d2y;
      if (along > 0 && along <= look) {
        const perp = Math.abs(-rx * d2y + ry * d2x);
        if (perp <= clearance) {
          const v = Math.sqrt(2 * brake * Math.max(0, along - clearance));
          if (v < cap) cap = v;
        }
      }
    }
  };
  const ship = window.ship;
  if (ship && !ship.destroyed && ship.pos) consider(ship.pos.x, ship.pos.y, ship.radius || 220);
  if (window.queryAIGrid) {
    const q = window.queryAIGrid(npc.x, npc.y, look);
    const buf = q.buffer;
    const n = q.count;
    for (let i = 0; i < n; i++) {
      const o = buf[i];
      if (!o || o === npc || o.dead || o === ship || o.fighter) continue;
      consider(o.x, o.y, o.radius || 100);
    }
  }
  if (fid) { npc.__obsCapFid = fid; npc.__obsCapVal = cap; }
  return cap;
}

// Od jakiej odległości od punktu kadłub zaczyna odwracać się z kursu lotu na
// kurs bojowy: mniej więcej tyle, ile przeleci w czasie obrotu o 90°.
function resolveFaceBlend(spec) {
  if (!spec) return 550;
  return clampNum(spec.maxSpeed * flightTurnTime(spec, Math.PI / 2), 500, 4000);
}

// „Bądź w punkcie (tx, ty)" — ustawia intencję lotu. Prędkość: `speedMode`
// ('combat' | 'cruise' | 'travel') ze specyfikacji kadłuba; opts.matchVx/Vy to
// prędkość punktu (ruchomy cel, lider formacji). Kurs: daleko od punktu dziób
// idzie w kierunku lotu (najmocniejszy ciąg jest do przodu), na pozycji —
// opts.combatFacing (burta/działa na wroga), płynnie w pasie `faceBlend`.
// Hamowanie i obrót planuje pilot z tej samej specyfikacji, więc okręt dojeżdża
// bez przestrzelenia i nie krąży wokół punktu, do którego nie umie skręcić.
function capitalArriveControls(npc, tx, ty, opts = {}) {
  const spec = resolveShipFlightSpec(npc);
  const dx = tx - npc.x;
  const dy = ty - npc.y;
  const dist = Math.hypot(dx, dy);
  const arrival = Math.max(0, Number(opts.arrival) || 50);
  const speedMode = opts.speedMode || (dist > (Number(opts.combatRadius) || COMBAT_RADIUS) ? 'cruise' : 'combat');
  let speedLimit = spec ? flightSpeedLimit(spec, speedMode) : Math.max(40, Number(npc.maxSpeed) || 200);
  if (Number(opts.speedMul) > 0) speedLimit *= Number(opts.speedMul);

  let approachCap = Infinity;
  if (!opts.noObstacleCap) {
    const invD = dist > 1e-4 ? 1 / dist : 0;
    const vlen = Math.hypot(npc.vx || 0, npc.vy || 0);
    const useVel = vlen > 40;
    approachCap = capitalObstacleSpeedCap(
      npc, dx * invD, dy * invD,
      useVel ? (npc.vx || 0) / vlen : 0,
      useVel ? (npc.vy || 0) / vlen : 0,
      spec
    );
  }

  const face = Number.isFinite(opts.combatFacing) ? opts.combatFacing : NaN;
  const faceBlend = Number.isFinite(opts.faceBlend) ? opts.faceBlend : resolveFaceBlend(spec);
  setFlightArrive(npc, tx, ty, {
    arrival,
    speedLimit,
    approachCap,
    noBrake: opts.noBrake === true,
    refVx: Number(opts.matchVx) || 0,
    refVy: Number(opts.matchVy) || 0,
    face,
    faceNear: arrival,
    faceFar: arrival + faceBlend
  });
  return { facing: face, dist, budget: Math.min(speedLimit, approachCap) };
}

// Wygodny wrapper: intencja arrive + zatwierdzenie (separacja). Używany m.in.
// przez formację guard w index.html, żeby capitale wsparcia latały tym samym
// pilotem co w walce.
function capitalArriveTo(npc, tx, ty, opts = {}) {
  const ctl = capitalArriveControls(npc, tx, ty, opts);
  commitCapitalFlight(npc, 0, Number(opts.dt) || (1 / 20));
  return ctl;
}

// Średni kąt montażu broni głównych względem dziobu. Statek z działami
// frontowymi celuje dziobem, broadside ustawia się burtą do wroga.
function resolveWeaponFacingBias(npc) {
  if (Number.isFinite(npc.__weaponFacingBias)) return npc.__weaponFacingBias;
  const weapons = npc.autoWeapons;
  if (!Array.isArray(weapons) || weapons.length === 0) return 0;

  let sumSin = 0;
  let sumCos = 0;
  let sumAbs = 0;
  let n = 0;
  for (let i = 0; i < weapons.length; i++) {
    const w = weapons[i];
    if (!w || !(w.arc < 1.0)) continue; // tylko wąskołukowe baterie główne
    const ma = window.wrapAngle ? window.wrapAngle(w.mountAngle || 0) : (w.mountAngle || 0);
    sumSin += Math.sin(ma);
    sumCos += Math.cos(ma);
    sumAbs += Math.abs(ma);
    n++;
  }
  if (n === 0) { npc.__weaponFacingBias = 0; return 0; }

  const resultant = Math.hypot(sumSin, sumCos) / n;
  // Spójny kierunek montażu → średnia kołowa. Symetryczna burta (wektory się
  // znoszą) → średnia |kąta| (≈ π/2), znak wybierany per klatka w facing.
  const bias = resultant > 0.5 ? Math.atan2(sumSin, sumCos) : (sumAbs / n);
  npc.__weaponFacingBias = bias;
  return bias;
}

function resolveCombatFacing(npc, toAng) {
  const bias = resolveWeaponFacingBias(npc);
  if (Math.abs(bias) < 0.2) return toAng;
  const wrap = window.wrapAngle || ((a) => Math.atan2(Math.sin(a), Math.cos(a)));
  const cur = npc.angle || 0;
  const optA = toAng - bias;
  const optB = toAng + bias;
  return Math.abs(wrap(optA - cur)) <= Math.abs(wrap(optB - cur)) ? optA : optB;
}

const _targetPosScratch = { x: 0, y: 0, vx: 0, vy: 0 };
function readTargetKinematics(t, out = _targetPosScratch) {
  out.x = t.pos ? t.pos.x : (t.x || 0);
  out.y = t.pos ? t.pos.y : (t.y || 0);
  out.vx = Number(t.vx ?? t.vel?.x) || 0;
  out.vy = Number(t.vy ?? t.vel?.y) || 0;
  return out;
}

// Zachowanie bez celu: piraci wracają w okolice macierzystej stacji, pozostali
// aktywnie hamują (koniec z dryfem w pustkę po bitwie). `face` — opcjonalny
// kurs postoju (NaN = zostaw obecny).
function capitalIdleControls(npc, face = NaN) {
  const home = npc.home;
  if (home && Number.isFinite(home.x) && Number.isFinite(home.y)) {
    const hd = Math.hypot(npc.x - home.x, npc.y - home.y);
    const guardR = (home.r || 300) + 1400;
    if (hd > guardR * 1.7) {
      capitalArriveControls(npc, home.x, home.y, { arrival: guardR, speedMode: 'cruise' });
      return;
    }
  }
  setFlightStop(npc, face);
}

// Punkt trzymania dystansu wokół celu. Namiar jest KOTWICZONY — powoli podąża
// za faktycznym — a na nim okręt lekko się kołysze na boki. Stary dryf
// przesuwał punkt stycznie o 28-50% dystansu przy KAŻDEJ decyzji, więc okręt
// wiecznie gonił punkt przed sobą i walka zamieniała się w karuzelę wokół celu.
// Zygzak (odchylenie, nie stały dryf) zostaje, żeby okręt nie był tarczą
// strzelniczą: fregata ±600 u, superkapitał ±150 u.
const HOLD_BEARING_TAU = 6;
const WEAVE_DIST_BY_CLASS = { frigate: 600, destroyer: 400, battleship: 220, carrier: 150, supercapital: 150 };
function computeHoldPoint(npc, tk, target, idealRange, dt) {
  const current = Math.atan2(npc.y - tk.y, npc.x - tk.x);
  let bearing = npc.__holdBearing;
  if (!Number.isFinite(bearing) || npc.__holdTarget !== target) {
    bearing = current;
    npc.__holdTarget = target;
    npc.__weavePhase = Math.random() * TWO_PI;
    npc.__weavePeriod = 8 + Math.random() * 6;
    npc.__weaveT = 0;
  } else {
    bearing += wrapAng(current - bearing) * Math.min(1, dt / HOLD_BEARING_TAU);
  }
  npc.__holdBearing = bearing;
  npc.__weaveT = (Number(npc.__weaveT) || 0) + dt;
  const spec = resolveShipFlightSpec(npc);
  const weaveDist = WEAVE_DIST_BY_CLASS[spec?.flightClass] ?? 220;
  const weave = (weaveDist / Math.max(1, idealRange))
    * Math.sin(npc.__weavePhase + (TWO_PI * npc.__weaveT) / npc.__weavePeriod);
  const a = bearing + weave;
  return {
    x: tk.x + Math.cos(a) * idealRange,
    y: tk.y + Math.sin(a) * idealRange
  };
}

// Walka bez slotu floty: trzymaj dystans bojowy (bateria główna × osobowość,
// dłuższy pod presją — jak flux w Starsectorze) na kotwiczonym namiarze. Daleko
// od celu: dolot z bonusem przelotowym, dziobem do przodu.
function engageTarget(npc, target, dt, arrival = 40) {
  const tk = readTargetKinematics(target);
  const dist = Math.hypot(tk.x - npc.x, tk.y - npc.y);
  const combatFacing = resolveCombatFacing(npc, Math.atan2(tk.y - npc.y, tk.x - npc.x));
  const personality = resolveAiPersonality(npc);
  const pressure = updateCombatPressure(npc, personality);
  const idealRange = resolveCapitalIdealRange(npc, target);
  // Pasmo trzymania (capitalAiTuning.resolveHoldRange): podchodzimy do dystansu
  // bojowego, ale przed wrogiem, który sam się zbliża, nie uciekamy — stoimy,
  // dopóki nie wejdzie głębiej niż holdFrac × dystans.
  const clearance = (Number(npc.radius) || 60) + (Number(target.radius) || 60) + 300;
  const band = resolveHoldRange(dist, idealRange, personality, pressure, clearance);
  const hold = computeHoldPoint(npc, tk, target, band.range, dt);
  return capitalArriveControls(npc, hold.x, hold.y, {
    arrival,
    matchVx: band.holding ? 0 : tk.vx,
    matchVy: band.holding ? 0 : tk.vy,
    speedMode: dist > band.range * 1.5 ? 'cruise' : 'combat',
    combatFacing
  });
}

// Lot na slot flankowy: punkt obraca się razem z celem (bearing względem jego
// dziobu), prędkość celu jest kompensowana. Gdy slot leży po drugiej stronie
// ofiary, obchodzimy ją po łuku (najwyżej 60° naraz) zamiast lecieć na wprost
// przez jej kadłub — ogranicznik przeszkód i tak by nas przed nim zatrzymał.
const FLANK_ARC_STEP = Math.PI / 3;
function computeFlankControls(npc, slot) {
  const vt = slot.target;
  const tk = readTargetKinematics(vt);
  const slotAng = (Number(vt.angle) || 0) + slot.bearing;
  const current = Math.atan2(npc.y - tk.y, npc.x - tk.x);
  const diff = wrapAng(slotAng - current);
  let aimAng = slotAng;
  let aimDist = slot.dist;
  if (Math.abs(diff) > FLANK_ARC_STEP) {
    aimAng = current + Math.sign(diff) * FLANK_ARC_STEP;
    aimDist = slot.dist * 1.15;
  }
  const fx = tk.x + Math.cos(aimAng) * aimDist;
  const fy = tk.y + Math.sin(aimAng) * aimDist;
  const distToVictim = Math.hypot(tk.x - npc.x, tk.y - npc.y);
  const combatFacing = resolveCombatFacing(npc, Math.atan2(tk.y - npc.y, tk.x - npc.x));
  const ctl = capitalArriveControls(npc, fx, fy, {
    arrival: 40,
    matchVx: tk.vx,
    matchVy: tk.vy,
    speedMode: distToVictim > slot.dist * 1.6 ? 'cruise' : 'combat',
    combatFacing
  });
  return { ctl, faceAngle: ctl.facing, distToVictim };
}

// Unik przed nadlatującą rakietą: krótki ruch boczny względem kadłuba. Ile to
// da, zależy od dysz manewrowych (strafeAccel) — pancernik ledwo drgnie.
function tryRocketDodge(npc, dt) {
  npc._dodgeTimer = (npc._dodgeTimer || 0) - dt;
  if (npc._dodgeTimer > 0) return;
  const rocketCandidates = getHostileRocketCandidates(npc);
  const sourceIsFactionBuffer = rocketCandidates !== window.bullets;
  for (let i = 0; i < rocketCandidates.length; i++) {
    const b = rocketCandidates[i];
    if (!isHostileRocketCandidate(npc, b, sourceIsFactionBuffer)) continue;
    const bdx = npc.x - b.x;
    const bdy = npc.y - b.y;
    if (bdx * bdx + bdy * bdy >= 800 * 800) continue;
    const bAng = Math.atan2(b.vy || 0, b.vx || 0);
    const toMe = Math.atan2(bdy, bdx);
    if (Math.abs(wrapAng(bAng - toMe)) >= 0.5) continue;
    const dir = Math.random() > 0.5 ? 1 : -1;
    const spec = resolveShipFlightSpec(npc);
    const speed = spec ? Math.min(spec.maxSpeed * 0.6, spec.strafeAccel * 0.9) : 250;
    const a = npc.angle || 0;
    setFlightDodge(npc, -Math.sin(a) * dir * speed, Math.cos(a) * dir * speed, 0.5);
    npc._dodgeTimer = 0.5;
    return;
  }
}

// Dojście do slotu linii. Slot jedzie z frontem (i z wrogiem), więc pilot
// dostaje jego prędkość — okręt płynie razem z linią, zamiast skokami ją gonić.
function goToSlot(npc, slot, combatFacing, arrival, target = null) {
  let speedMode = slot.phase === 'engage' ? 'combat' : 'cruise';
  if (target) {
    const tk = readTargetKinematics(target);
    const dist = Math.hypot(tk.x - npc.x, tk.y - npc.y);
    speedMode = dist > resolveCapitalIdealRange(npc, target) * 1.5 ? 'cruise' : 'combat';
  }
  return capitalArriveControls(npc, slot.x, slot.y, {
    arrival,
    speedMode,
    combatFacing,
    matchVx: Number(slot.vx) || 0,
    matchVy: Number(slot.vy) || 0
  });
}

// Czy okręt ze slotem linii może wyłamać się i walczyć na własną rękę:
// w fazie zbliżania dopiero, gdy wróg jest praktycznie na jego dystansie
// (flota idzie razem), w fazie walki — gdy cel jest w rozsądnym zasięgu.
function shouldBreakFormation(npc, slot, target) {
  if (!slot || slot.kind !== 'line') return true;
  const tk = readTargetKinematics(target);
  const dist = Math.hypot(tk.x - npc.x, tk.y - npc.y);
  const ideal = resolveCapitalIdealRange(npc, target);
  if (slot.phase === 'engage') return dist <= ideal * 1.6 + 1500;
  return dist <= ideal * 1.15;
}

function isProjectileTarget(t) {
  return !!t && (t.type === 'rocket' || t.type === 'torpedo');
}

function entityVelX(e) { return Number(e?.vel?.x ?? e?.vx) || 0; }
function entityVelY(e) { return Number(e?.vel?.y ?? e?.vy) || 0; }

// ============================================================================
// 2. NIEZALEŻNY SYSTEM UZBROJENIA (Zintegrowany z Hardpointami)
// ============================================================================

function initAutonomousWeapons(npc) {
  if (npc.autoWeapons !== undefined && npc._weaponsInit) return;

  npc._weaponsInit = true;
  npc.autoWeapons = [];
  npc._shipScanCaches = Object.create(null);

  if (npc.weapons) {
    const addWeaponsFromGroup = (group, arc, prefers, scanProfile) => {
      if (!group || !Array.isArray(group)) return;
      for (let i = 0; i < group.length; i++) {
        const loadout = group[i];
        const def = loadout.weapon;
        if (!def || loadout?.hp?.destroyed || !loadout?.hp?.mount) continue;

        const localY = loadout.hp?.y || loadout.hp?.pos?.y || 0;
        let baseAngle = loadout.hp?.rot || loadout.hp?.pos?.rot;
        if (typeof baseAngle !== 'number') {
          if (localY > 15) baseAngle = Math.PI / 2;
          else if (localY < -15) baseAngle = -Math.PI / 2;
          else baseAngle = 0;
        }

        let startAmmo = null;
        if (loadout.hp?.maxAmmo != null) startAmmo = loadout.hp.maxAmmo;
        else if (def.ammo != null) startAmmo = def.ammo;

        npc.autoWeapons.push({
          id: def.id,
          def: def,
          type: def.category,
          cd: Math.random() * 2,
          scanCd: getNextWeaponScanInterval(scanProfile),
          ammo: startAmmo,
          hpOffset: loadout.hp,
          mountAngle: baseAngle,
          arc: arc,
          prefers: prefers,
          // Obrona punktowa (gniazdo aux): kadłub spoza `prefers` to brak celu,
          // chyba że okręt ma PD CHIP (getTargetScoreForWeapon).
          pd: isPointDefenseWeapon(def),
          scanProfile
        });
      }
    };

    addWeaponsFromGroup(npc.weapons.main, 0.55, ['battleship', 'destroyer', 'frigate'], 'slow');
    addWeaponsFromGroup(npc.weapons.aux, Math.PI * 2, ['rocket', 'fighter'], 'fast');
    addWeaponsFromGroup(npc.weapons.missile, 1.2, ['battleship', 'destroyer', 'frigate', 'fighter'], 'slow');
  }

  // Układ broni mógł się zmienić — przelicz preferowane ustawienie kadłuba.
  npc.__weaponFacingBias = undefined;
}

function getTargetScoreForWeapon(weapon, target, isRocket = false, knownKind = null, pdHullsAllowed = false) {
  if (!target) return -1;
  const kind = isRocket ? 'rocket' : (knownKind || window.getUnitKind?.(target) || 'other');

  const prefIndex = weapon.prefers.indexOf(kind);
  let score = 0;

  if (prefIndex !== -1) {
    score += (10 - prefIndex) * 100;
  } else {
    // PD: cel spoza `prefers` (kadłub) to ODRZUCENIE, nie wynik 0 — inaczej
    // lufy PD mieliły kadłuby za 20% obrażeń i zalewały bitwę pociskami.
    // Z PD CHIP-em kadłub wolno, ale zawsze za rakietą i myśliwcem.
    if (weapon.pd) return pdHullsAllowed ? PD_HULL_SCORE : -Infinity;
    if (weapon.type === 'rail' && kind === 'fighter') score -= 500;
  }
  return score;
}

// Czy PD bez chipa może trzymać ten cel: pocisk (rakieta/torpeda) albo myśliwiec.
function isPdTargetWithoutChip(target) {
  if (!target) return false;
  if (isProjectileTarget(target)) return true;
  return window.getUnitKind?.(target) === 'fighter';
}

const SUBSYSTEM_PRIORITY = ['main', 'missile', 'aux', 'special', 'hangar'];
const SUBSYSTEM_RESCAN_INTERVAL = 1.5;

function getNextWeaponScanInterval(scanProfile) {
  if (scanProfile === 'fast') return 0.08 + Math.random() * 0.06;
  return 0.24 + Math.random() * 0.16;
}

const EMPTY_ROCKET_CANDIDATES = [];

function getHostileRocketCandidates(npc) {
  const factionBuffer = npc.friendly
    ? window.__npcRocketThreats
    : window.__playerRocketThreats;
  return Array.isArray(factionBuffer) ? factionBuffer : (window.bullets || EMPTY_ROCKET_CANDIDATES);
}

function isHostileRocketCandidate(npc, bullet, sourceIsFactionBuffer) {
  if (!bullet || bullet.life <= 0) return false;
  if (bullet.type !== 'rocket' && bullet.type !== 'torpedo') return false;
  if (sourceIsFactionBuffer) return true;
  const myTeam = npc.friendly ? 'player' : 'npc';
  return bullet.owner !== myTeam;
}

function buildShipScanCache(npc, dt, scanProfile = 'slow') {
  let caches = npc._shipScanCaches;
  if (!caches) caches = npc._shipScanCaches = Object.create(null);

  let cache = caches[scanProfile];
  if (!cache) {
    cache = caches[scanProfile] = {
      ttl: 0,
      x: 0,
      y: 0,
      enemies: [],
      enemyDistSq: [],
      enemyAngles: [],
      enemyKinds: [],
      rockets: [],
      maxRange: 0,
      geometryId: 0
    };
  }

  cache.ttl -= dt;
  const moveThreshold = scanProfile === 'fast' ? 140 : 180;
  const movedFar = ((npc.x - cache.x) ** 2 + (npc.y - cache.y) ** 2) > (moveThreshold * moveThreshold);
  if (cache.ttl > 0 && !movedFar) return cache;

  cache.x = npc.x;
  cache.y = npc.y;
  cache.enemies.length = 0;
  cache.rockets.length = 0;

  let maxRange = 0;
  let needsRocketThreats = false;
  for (let i = 0; i < npc.autoWeapons.length; i++) {
    const weapon = npc.autoWeapons[i];
    if ((weapon.scanProfile || 'slow') !== scanProfile) continue;
    maxRange = Math.max(maxRange, Number(weapon.def?.baseRange) || 1000);
    if (!needsRocketThreats && weapon.prefers?.includes('rocket')) needsRocketThreats = true;
  }
  if (!(maxRange > 0)) maxRange = 1000;
  cache.maxRange = maxRange;
  const maxRangeSq = maxRange * maxRange;

  if (!npc.friendly && window.ship && !window.ship.dead) {
    const playerX = window.ship.pos?.x ?? window.ship.x ?? 0;
    const playerY = window.ship.pos?.y ?? window.ship.y ?? 0;
    const dx = playerX - npc.x;
    const dy = playerY - npc.y;
    if (dx * dx + dy * dy <= maxRangeSq) cache.enemies.push(window.ship);
  }

  // Długie zasięgi i tak zmuszają grid do ścieżki pełnej listy. Wtedy pula
  // przeciwnej frakcji jest ściśle tańsza — w asymetrycznej bitwie 85 vs 3
  // przyjazny okręt ogląda 3 kandydatów zamiast wszystkich 88 jednostek.
  const factionPool = maxRange > 4800
    ? (npc.friendly ? window.getAIPirateCandidates?.() : window.getAIFriendlyCandidates?.())
    : null;
  if (Array.isArray(factionPool)) {
    for (let i = 0; i < factionPool.length; i++) {
      const enemy = factionPool[i];
      if (!enemy || enemy.dead || enemy === npc || enemy === window.ship) continue;
      if (npc.friendly && !enemy.isPirate) continue;
      if (!npc.friendly && enemy.friendly === false) continue;
      const enemyX = enemy.pos?.x ?? enemy.x ?? 0;
      const enemyY = enemy.pos?.y ?? enemy.y ?? 0;
      const dx = enemyX - npc.x;
      const dy = enemyY - npc.y;
      if (dx * dx + dy * dy > maxRangeSq) continue;
      cache.enemies.push(enemy);
    }
  } else if (window.queryAIGrid) {
    const query = window.queryAIGrid(npc.x, npc.y, maxRange);
    const buffer = query.buffer;
    const count = query.count;
    for (let i = 0; i < count; i++) {
      const enemy = buffer[i];
      if (!enemy || enemy.dead || enemy === npc) continue;
      if (enemy === window.ship) continue;
      if (npc.friendly && !enemy.isPirate) continue;
      if (!npc.friendly && enemy.friendly === false) continue;
      const enemyX = enemy.pos?.x ?? enemy.x ?? 0;
      const enemyY = enemy.pos?.y ?? enemy.y ?? 0;
      const dx = enemyX - npc.x;
      const dy = enemyY - npc.y;
      if (dx * dx + dy * dy > maxRangeSq) continue;
      cache.enemies.push(enemy);
    }
  } else {
    const npcs = window.npcs || [];
    for (let i = 0; i < npcs.length; i++) {
      const enemy = npcs[i];
      if (!enemy || enemy.dead || enemy === npc) continue;
      if (npc.friendly && !enemy.isPirate) continue;
      if (!npc.friendly && enemy.friendly === false) continue;
      const enemyX = enemy.pos?.x ?? enemy.x ?? 0;
      const enemyY = enemy.pos?.y ?? enemy.y ?? 0;
      const dx = enemyX - npc.x;
      const dy = enemyY - npc.y;
      if (dx * dx + dy * dy > maxRangeSq) continue;
      cache.enemies.push(enemy);
    }
  }

  if (needsRocketThreats) {
    const rocketCandidates = getHostileRocketCandidates(npc);
    const sourceIsFactionBuffer = rocketCandidates !== window.bullets;
    for (let i = 0; i < rocketCandidates.length; i++) {
      const b = rocketCandidates[i];
      if (!isHostileRocketCandidate(npc, b, sourceIsFactionBuffer)) continue;
      const distSq = (b.x - npc.x) ** 2 + (b.y - npc.y) ** 2;
      if (distSq > maxRangeSq) continue;
      cache.rockets.push(b);
    }
  }

  cache.ttl = scanProfile === 'fast'
    ? (0.08 + Math.random() * 0.06)
    : (0.24 + Math.random() * 0.16);
  return cache;
}

function prepareShipScanGeometry(cache, npc, geometryId) {
  if (cache.geometryId === geometryId) return;
  cache.geometryId = geometryId;
  const count = cache.enemies.length;
  const enemyDistSq = cache.enemyDistSq || (cache.enemyDistSq = []);
  const enemyAngles = cache.enemyAngles || (cache.enemyAngles = []);
  const enemyKinds = cache.enemyKinds || (cache.enemyKinds = []);
  enemyDistSq.length = count;
  enemyAngles.length = count;
  enemyKinds.length = count;
  for (let i = 0; i < count; i++) {
    const enemy = cache.enemies[i];
    const tx = enemy.pos ? enemy.pos.x : enemy.x;
    const ty = enemy.pos ? enemy.pos.y : enemy.y;
    const dx = tx - npc.x;
    const dy = ty - npc.y;
    enemyDistSq[i] = dx * dx + dy * dy;
    enemyAngles[i] = Math.atan2(dy, dx);
    enemyKinds[i] = window.getUnitKind?.(enemy) || 'other';
  }
}

function getSubsystemWorldPos(target, hp) {
  if (window.getEntityHardpointWorldPos) {
    return window.getEntityHardpointWorldPos(target, hp);
  }
  const tx = target.pos ? target.pos.x : (target.x || 0);
  const ty = target.pos ? target.pos.y : (target.y || 0);
  const hpScale = (Number.isFinite(target.__hardpointScale) && target.__hardpointScale > 0)
    ? target.__hardpointScale : 1;
  const localX = (Number(hp.x) || Number(hp.pos?.x) || 0) * hpScale;
  const localY = (Number(hp.y) || Number(hp.pos?.y) || 0) * hpScale;
  const spriteRot = (target === window.ship) ? 0 : (Number(target.capitalProfile?.spriteRotation) || 0);
  const angle = (Number(target.angle) || 0) + spriteRot;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: tx + localX * c - localY * s, y: ty + localX * s + localY * c };
}

function getEngineWorldPos(target) {
  const offsets = target.capitalProfile?.engineOffsets;
  if (Array.isArray(offsets) && offsets.length > 0) {
    const eng = offsets[Math.floor(Math.random() * offsets.length)];
    const r = target.radius || 100;
    const localX = (eng.x || 0) * r;
    const localY = (eng.y || 0) * r;
    const spriteRot = Number(target.capitalProfile?.spriteRotation) || 0;
    const angle = (Number(target.angle) || 0) + spriteRot;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const tx = target.pos ? target.pos.x : (target.x || 0);
    const ty = target.pos ? target.pos.y : (target.y || 0);
    return { x: tx + localX * c - localY * s, y: ty + localX * s + localY * c };
  }
  if (target.engines?.main?.vfxOffset) {
    const off = target.engines.main.vfxOffset;
    const hpScale = (Number.isFinite(target.__hardpointScale) && target.__hardpointScale > 0)
      ? target.__hardpointScale : 1;
    const localX = (off.x || 0) * hpScale;
    const localY = (off.y || 0) * hpScale;
    const spriteRot = Number(target.capitalProfile?.spriteRotation) || 0;
    const angle = (Number(target.angle) || 0) + spriteRot;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const tx = target.pos ? target.pos.x : (target.x || 0);
    const ty = target.pos ? target.pos.y : (target.y || 0);
    return { x: tx + localX * c - localY * s, y: ty + localX * s + localY * c };
  }
  return null;
}

function pickTargetSubsystem(weapon, target) {
  if (!target) return null;
  const hps = target.editorHardpoints || target.hardpoints;
  if (!Array.isArray(hps) || hps.length === 0) {
    const engPos = getEngineWorldPos(target);
    return engPos ? { type: 'engine', worldPos: engPos } : null;
  }

  const weaponHps = [];
  for (let i = 0; i < hps.length; i++) {
    const hp = hps[i];
    if (hp.destroyed || !hp.mount) continue;
    if (SUBSYSTEM_PRIORITY.includes(hp.type || '')) {
      weaponHps.push(hp);
    }
  }

  if (weaponHps.length > 0) {
    weaponHps.sort((a, b) => {
      return SUBSYSTEM_PRIORITY.indexOf(a.type || '') - SUBSYSTEM_PRIORITY.indexOf(b.type || '');
    });
    const pool = weaponHps.slice(0, Math.min(3, weaponHps.length));
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const worldPos = getSubsystemWorldPos(target, chosen);
    if (worldPos) return { type: 'weapon', hp: chosen, worldPos };
  }

  const engPos = getEngineWorldPos(target);
  if (engPos) return { type: 'engine', worldPos: engPos };

  return null;
}

const _leadAimScratch = { x: 0, y: 0 };
const _leadOriginScratch = { x: 0, y: 0 };
const _spawnOpts = { type: null, hp: null, angleOverride: 0, pdTarget: null };
const _leadTargetScratch = { x: 0, y: 0, vx: 0, vy: 0 };
let nextWeaponGeometryId = 1;

// Eksport dla testów (tests/pointDefenseTargeting.test.mjs); gra woła przez mózgi.
export function processAutonomousWeapons(npc, dt) {
  if (!npc) return;
  // Carrier: wypuszczanie eskadr z hangarów (early-return wewnątrz dla nie-carrierów).
  if (window.updateNpcHangars) window.updateNpcHangars(npc, dt);
  initAutonomousWeapons(npc);
  if (!npc.autoWeapons || npc.autoWeapons.length === 0) return;

  const tWeap0 = (typeof performance !== 'undefined') ? performance.now() : 0;
  let fastScanCache = null;
  let slowScanCache = null;
  const geometryId = nextWeaponGeometryId++;
  const losTargets = npc._weaponLosTargets || (npc._weaponLosTargets = []);
  const losBlocked = npc._weaponLosBlocked || (npc._weaponLosBlocked = []);
  let losCount = 0;
  // PD CHIP to cecha okrętu, nie działa — pytamy raz na wywołanie.
  const pdHullsAllowed = window.hasShipChip?.(npc, PD_CHIP_ID) === true;

  for (let wIdx = 0; wIdx < npc.autoWeapons.length; wIdx++) {
    const weapon = npc.autoWeapons[wIdx];
    const hpRef = weapon.hpOffset;
    if (hpRef && (hpRef.destroyed || !hpRef.mount || (weapon.id && hpRef.mount !== weapon.id))) {
      continue;
    }
    const restAngle = (npc.angle || 0) + weapon.mountAngle;
    if (weapon.visualAngle === undefined) weapon.visualAngle = restAngle;

    weapon.cd -= dt;
    weapon._losRetryCd = Math.max(0, (weapon._losRetryCd || 0) - dt);
    weapon._blockedTargetT = Math.max(0, (weapon._blockedTargetT || 0) - dt);
    if (weapon._blockedTargetT <= 0) weapon._blockedTarget = null;

    if (weapon.ammo !== null && weapon.ammo <= 0) {
      let diff = window.wrapAngle(restAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 3 * dt);
      continue;
    }

    const range = weapon.def.baseRange || 1000;
    const rangeSq = range * range;
    weapon.scanCd = Math.max(0, (weapon.scanCd || 0) - dt);
    let bestTarget = weapon.cachedTarget || null;
    let bestScore = -Infinity;

    const mustRescan =
      weapon.scanCd <= 0 ||
      !bestTarget ||
      bestTarget.dead ||
      (bestTarget.x == null && bestTarget.pos?.x == null) ||
      // Cel sprzed zmiany reguł (albo sprzed zdjęcia chipa) może być kadłubem —
      // PD bez chipa nie trzyma go ani jednej decyzji dłużej.
      (weapon.pd && !pdHullsAllowed && !isPdTargetWithoutChip(bestTarget));

    if (mustRescan) {
      bestTarget = null;
      const scanProfile = weapon.scanProfile || 'slow';
      const cache = scanProfile === 'fast'
        ? (fastScanCache || (fastScanCache = buildShipScanCache(npc, dt, 'fast')))
        : (slowScanCache || (slowScanCache = buildShipScanCache(npc, dt, 'slow')));
      prepareShipScanGeometry(cache, npc, geometryId);

      if (weapon.prefers.includes('rocket')) {
        for (let i = 0; i < cache.rockets.length; i++) {
          const b = cache.rockets[i];
          const distSq = (b.x - npc.x) ** 2 + (b.y - npc.y) ** 2;
          if (distSq <= rangeSq) {
            const score = getTargetScoreForWeapon(weapon, b, true) - distSq * 0.001;
            if (score > bestScore) {
              bestScore = score;
              bestTarget = b;
            }
          }
        }
      }

      // Tani score wybiera cel; LOS sprawdzamy dopiero wtedy, gdy działo jest
      // gotowe faktycznie wystrzelić.
      for (let i = 0; i < cache.enemies.length; i++) {
        const candidate = cache.enemies[i];
        if (candidate === weapon._blockedTarget && weapon._blockedTargetT > 0) continue;
        const distSq = cache.enemyDistSq[i];
        if (distSq > rangeSq) continue;

        const candidateKind = cache.enemyKinds[i];
        // PD bez chipa: z okrętów tylko myśliwce (rakiety zebrała pętla wyżej).
        if (weapon.pd && !pdHullsAllowed && candidateKind !== 'fighter') continue;

        const absTargetAngle = cache.enemyAngles[i];
        const angleDiff = Math.abs(window.wrapAngle(absTargetAngle - restAngle));
        if (angleDiff > weapon.arc) continue;

        const candidateScore = getTargetScoreForWeapon(weapon, candidate, false, candidateKind, pdHullsAllowed) - distSq * 0.001;
        if (candidateScore <= bestScore) continue;
        bestScore = candidateScore;
        bestTarget = candidate;
      }

      weapon.cachedTarget = bestTarget || null;
      weapon.scanCd = getNextWeaponScanInterval(scanProfile);
    }

    if (bestTarget) {
      const tx = bestTarget.pos ? bestTarget.pos.x : bestTarget.x;
      const ty = bestTarget.pos ? bestTarget.pos.y : bestTarget.y;

      weapon._subsystemTimer = (weapon._subsystemTimer || 0) - dt;
      if (!weapon._subsystem || weapon._subsystemTimer <= 0 || weapon._subsystemTarget !== bestTarget) {
        weapon._subsystem = pickTargetSubsystem(weapon, bestTarget);
        weapon._subsystemTarget = bestTarget;
        weapon._subsystemTimer = SUBSYSTEM_RESCAN_INTERVAL + Math.random() * 1.0;
      }

      let aimX = tx;
      let aimY = ty;
      if (weapon._subsystem?.worldPos) {
        if (weapon._subsystem.hp) {
          const freshPos = getSubsystemWorldPos(bestTarget, weapon._subsystem.hp);
          if (freshPos) { aimX = freshPos.x; aimY = freshPos.y; }
        } else if (weapon._subsystem.type === 'engine') {
          const freshPos = getEngineWorldPos(bestTarget);
          if (freshPos) { aimX = freshPos.x; aimY = freshPos.y; }
        }
      }

      const speed = weapon.def.baseSpeed || 1000;
      _leadOriginScratch.x = npc.x;
      _leadOriginScratch.y = npc.y;
      _leadTargetScratch.x = aimX;
      _leadTargetScratch.y = aimY;
      _leadTargetScratch.vx = bestTarget.vx ?? bestTarget.vel?.x ?? 0;
      _leadTargetScratch.vy = bestTarget.vy ?? bestTarget.vel?.y ?? 0;
      _leadAimScratch.x = aimX;
      _leadAimScratch.y = aimY;
      const lead = window.getLeadAim
        ? window.getLeadAim(_leadOriginScratch, _leadTargetScratch, speed, _leadAimScratch)
        : _leadAimScratch;
      const aimAngle = Math.atan2(lead.y - npc.y, lead.x - npc.x);

      let diff = window.wrapAngle(aimAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 8 * dt);

      if (weapon.cd <= 0 && weapon._losRetryCd <= 0) {
        const targetIsRocket = bestTarget.type === 'rocket' || bestTarget.type === 'torpedo';
        let lineBlocked = false;
        if (!targetIsRocket) {
          let losIndex = -1;
          for (let i = 0; i < losCount; i++) {
            if (losTargets[i] === bestTarget) { losIndex = i; break; }
          }
          if (losIndex >= 0) {
            lineBlocked = losBlocked[losIndex] === true;
          } else {
            lineBlocked = window.isLineOfFireBlocked?.(npc, bestTarget, range) === true;
            losTargets[losCount] = bestTarget;
            losBlocked[losCount] = lineBlocked;
            losCount++;
          }
        }
        if (lineBlocked) {
          // Nie miel LOS co 20 Hz: odrzuć zasłonięty cel na kilka decyzji i
          // pozostaw działo gotowe, by mogło natychmiast wybrać czystą linię.
          weapon._blockedTarget = bestTarget;
          weapon._blockedTargetT = 0.18;
          weapon._losRetryCd = 0.15;
          weapon.cachedTarget = null;
          weapon.scanCd = 0;
        } else {
          if (window.spawnBulletAdapter) {
            // Opcje strzału — jeden obiekt na moduł (adapter czyta je od razu).
            const opts = _spawnOpts;
            opts.type = weapon.type;
            opts.hp = weapon.hpOffset;
            opts.angleOverride = weapon.visualAngle;
            // PD: cel wybrany i sprawdzony (LOS) — wiązka testuje tylko jego.
            opts.pdTarget = weapon.pd ? bestTarget : null;
            window.spawnBulletAdapter(npc, bestTarget, weapon.def, opts);
            opts.hp = null;
            opts.pdTarget = null;
          }
          weapon.cd = weapon.def.cooldown || 2.0;
          if (weapon.ammo !== null && weapon.ammo > 0) weapon.ammo -= 1;
        }
      }
    } else {
      let diff = window.wrapAngle(restAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 3 * dt);
    }
  }

  losTargets.length = losCount;
  losBlocked.length = losCount;

  if (typeof performance !== 'undefined') {
    window.__aiWeaponScanMs = (window.__aiWeaponScanMs || 0) + (performance.now() - tWeap0);
  }
}

// ============================================================================
// 3. MÓZGI NAWIGACYJNE
// ============================================================================
//
// Każdy mózg decyduje GDZIE być i JAK stać (slot linii, flanka, dystans od
// celu, eskorta), ustawia intencję przez capitalArriveControls/…Idle, a na
// końcu commitCapitalFlight dokłada separację. Samym lotem zajmuje się pilot.

export function aiFrigate(sim, npc, dt) {
  const isSupport = !!npc.supportData;
  const leader = (npc.supportData?.leader && !npc.supportData.leader.dead)
    ? npc.supportData.leader
    : null;
  // Eskortujemy lidera skrzydła; samotne friendly trzymają się gracza.
  // Piraci NIE eskortują nikogo (dawny fallback na window.ship klejił ich do gracza).
  const guardian = leader || ((npc.friendly && window.ship && !window.ship.destroyed) ? window.ship : null);
  const guardX = guardian ? (guardian.pos?.x ?? guardian.x ?? npc.x) : npc.x;
  const guardY = guardian ? (guardian.pos?.y ?? guardian.y ?? npc.y) : npc.y;
  const distToGuard = guardian ? Math.hypot(npc.x - guardX, npc.y - guardY) : 0;

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    let bestTarget = null;
    let bestScore = -Infinity;
    const pdRange = 1200;

    const rocketCandidates = getHostileRocketCandidates(npc);
    const sourceIsFactionBuffer = rocketCandidates !== window.bullets;
    for (let i = 0; i < rocketCandidates.length; i++) {
      const b = rocketCandidates[i];
      if (!isHostileRocketCandidate(npc, b, sourceIsFactionBuffer)) continue;
      const d2 = (b.x - npc.x) ** 2 + (b.y - npc.y) ** 2;
      if (d2 < pdRange * pdRange) {
        const score = 2000 - d2 * 0.001;
        if (score > bestScore) { bestScore = score; bestTarget = b; }
      }
    }

    // Cel z obrazu sytuacji floty (czujniki wszystkich okrętów strony + smycz
    // postawy). Dawne sztywne ~3,2 km sprawiało, że fregata nie widziała wroga,
    // którego gracz miał na radarze. Kiedy walczyć na własną rękę, a kiedy
    // trzymać szyk, rozstrzyga niżej shouldBreakFormation.
    if (!bestTarget) bestTarget = window.aiPickTarget?.(npc) || null;

    npc.target = bestTarget || null;
    npc.retargetTimer = 0.3 + Math.random() * 0.2;
  }

  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (target && target.dead) target = null;

  // Smycz eskorty: skrzydło wsparcia w ESKORCIE nie oddala się od lidera
  // dalej niż promień obrony (ten sam, którym obraz sytuacji filtruje cele).
  const guardOrder = isSupport && (window.SupportWing?.order || 'guard') !== 'engage';
  if (guardOrder && guardian && distToGuard > AWARENESS_CONFIG.guardRadius) {
    target = null;
    npc.target = null;
  }
  // Rakieta jako cel to robota działek PD, nie powód, żeby cały kadłub
  // trzymał wokół niej dystans.
  const shipTarget = (target && !isProjectileTarget(target)) ? target : null;

  const slot = getBattleSlot(npc);

  if (slot && slot.kind === 'flank' && !guardOrder) {
    computeFlankControls(npc, slot);
  } else if (shipTarget && shouldBreakFormation(npc, slot, shipTarget)) {
    engageTarget(npc, shipTarget, dt, 30);
  } else if (slot && slot.kind === 'line') {
    const tk = shipTarget ? readTargetKinematics(shipTarget) : null;
    const facing = tk
      ? resolveCombatFacing(npc, Math.atan2(tk.y - npc.y, tk.x - npc.x))
      : resolveCombatFacing(npc, slot.facing);
    goToSlot(npc, slot, facing, 60, shipTarget);
  } else if (guardian) {
    // Eskorta: w promieniu eskorty dopasowujemy prędkość lidera (lecimy
    // razem, zamiast stawać i doganiać), dalej — dolot, szybki gdy daleko.
    const escortDist = Math.max(380, (guardian.radius || 220) + (npc.radius || 45) + 160);
    capitalArriveControls(npc, guardX, guardY, {
      arrival: escortDist,
      matchVx: entityVelX(guardian),
      matchVy: entityVelY(guardian),
      speedMode: distToGuard > escortDist + 3000 ? 'travel' : 'cruise',
      combatFacing: Number.isFinite(guardian.angle) ? guardian.angle : NaN
    });
  } else {
    capitalIdleControls(npc);
  }

  if (shipTarget) tryRocketDodge(npc, dt);

  commitCapitalFlight(npc, 0, dt);
  processAutonomousWeapons(npc, dt);
}

export function aiDestroyer(sim, npc, dt) {
  npc.boostT = Math.max(0, (npc.boostT || 0) - dt);
  npc.boostCd = Math.max(0, (npc.boostCd || 0) - dt);

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    // Brak celu w obrazie sytuacji / smyczy = brak celu (stary cel nie może
    // wisieć w nieskończoność i ciągnąć okrętu poza postawę).
    npc.target = window.aiPickTarget?.(npc) || null;
    npc.retargetTimer = 1.0 + Math.random() * 0.5;
  }
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (target && target.dead) target = null;

  const slot = getBattleSlot(npc);

  if (slot && slot.kind === 'flank') {
    const flank = computeFlankControls(npc, slot);
    // Dopalacz na dojście do flanki (jak burn drive w Starsectorze).
    if (flank.distToVictim > slot.dist * 2.2 && npc.boostCd <= 0) {
      npc.boostT = npc.boostDur || 2.2;
      npc.boostCd = 12.0;
    }
  } else if (target && !target.dead) {
    const tk = readTargetKinematics(target);
    const toAng = Math.atan2(tk.y - npc.y, tk.x - npc.x);
    const combatFacing = resolveCombatFacing(npc, toAng);
    const idealRange = resolveCapitalIdealRange(npc, target);
    const dist = Math.hypot(tk.x - npc.x, tk.y - npc.y);

    if (dist > Math.max(2800, idealRange * 1.8) && npc.boostCd <= 0) {
      npc.boostT = npc.boostDur || 2.5;
      npc.boostCd = 12.0;
    }

    if (slot && slot.kind === 'line' && dist > idealRange * 0.7) {
      goToSlot(npc, slot, combatFacing, 50, target);
    } else {
      engageTarget(npc, target, dt, 40);
    }
  } else if (slot && slot.kind === 'line') {
    goToSlot(npc, slot, resolveCombatFacing(npc, slot.facing), 60);
  } else {
    capitalIdleControls(npc);
  }

  commitCapitalFlight(npc, npc.boostT, dt);
  processAutonomousWeapons(npc, dt);
}

export function aiBattleship(sim, npc, dt) {
  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    npc.target = window.aiPickTarget?.(npc) || null;
    npc.retargetTimer = 1.5 + Math.random() * 0.5;
  }
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (target && target.dead) target = null;

  const slot = getBattleSlot(npc);

  if (target && !target.dead) {
    const tk = readTargetKinematics(target);
    const toAng = Math.atan2(tk.y - npc.y, tk.x - npc.x);
    const dist = Math.hypot(tk.x - npc.x, tk.y - npc.y);
    const idealRange = resolveCapitalIdealRange(npc, target);
    const combatFacing = resolveCombatFacing(npc, toAng);

    const tooClose = dist < idealRange * 0.6;
    if (slot && slot.kind === 'line' && !tooClose) {
      // Trzymaj slot w linii bitewnej — flota walczy jako front, nie karuzela.
      goToSlot(npc, slot, combatFacing, Math.max(50, (npc.radius || 100) * 0.4), target);
    } else {
      // Samotny okręt (albo wróg wszedł za blisko): trzymaj dystans.
      engageTarget(npc, target, dt, 40);
    }
  } else if (slot && slot.kind === 'line') {
    goToSlot(npc, slot, resolveCombatFacing(npc, slot.facing), 80);
  } else {
    capitalIdleControls(npc);
  }

  commitCapitalFlight(npc, 0, dt);
  processAutonomousWeapons(npc, dt);
}

window.aiFrigate = aiFrigate;
window.aiDestroyer = aiDestroyer;
window.aiBattleship = aiBattleship;
window.capitalArriveTo = capitalArriveTo;
