// src/ai/capitalAI.js

import { resolveCapitalIdealRange } from './capitalAiTuning.js';
import { getBattleSlot } from './fleetCoordinator.js';

// ============================================================================
// 1. SYSTEM AUTOPILOTA (Ruch i fizyka - KIEROWCA)
// ============================================================================

const clampNum = (v, min, max) => Math.max(min, Math.min(max, v));

function applyCapitalAutopilot(npc, thrustNorm, strafeNorm, desiredAngle, boostT, dt) {
  npc.desiredAngle = desiredAngle;
  const speedBoost = (boostT > 0) ? 1.7 : 1.0;

  if (window.applyNpcFlightVector && window.npcHasPhysicalThrusters?.(npc)) {
    const sep = window.applySeparationForces ? window.applySeparationForces(npc, 0, 0) : null;
    const flight = window.applyNpcFlightVector(npc, {
      thrustNorm,
      strafeNorm,
      desiredAngle,
      boostT,
      separation: sep
    }, dt);
    if (flight?.usedThrusters) return;
  }

  const forwardAccel = thrustNorm * (npc.accel || 150) * speedBoost;
  const sideAccel = strafeNorm * (npc.accel || 150) * speedBoost;

  const c = Math.cos(npc.angle || 0);
  const s = Math.sin(npc.angle || 0);

  let ax = c * forwardAccel - s * sideAccel;
  let ay = s * forwardAccel + c * sideAccel;

  if (window.applySeparationForces) {
    const sep = window.applySeparationForces(npc, 0, 0); // Dodaje separację
    ax += sep.ax;
    ay += sep.ay;
  }

  npc.vx = (npc.vx || 0) + ax * dt;
  npc.vy = (npc.vy || 0) + ay * dt;

  // Kontroler arrive może celowo lecieć szybciej niż maxSpeed (cruise/boost) —
  // wtedy zostawia limit w __speedCapHint, żeby tłumik go nie zjadał.
  const capHint = Number(npc.__speedCapHint) || 0;
  const maxV = Math.max((npc.maxSpeed || 200) * speedBoost, capHint);
  const v = Math.hypot(npc.vx, npc.vy);

  if (v > maxV) {
    const dampFactor = 0.96 + Math.min(0.03, (npc.mass || 0) / 5000000 * 0.03);
    npc.vx *= dampFactor;
    npc.vy *= dampFactor;
  }
}

// ============================================================================
// 1a. KONTROLER PRĘDKOŚCI (arrive) — wspólne sterowanie dla mózgów kapitalnych
// ============================================================================

// Ścieżka fizycznych thrusterów skaluje teraz siłę z npc.accel, więc kontroler
// używa tej samej wartości co faktyczna integracja ruchu.
function resolveAccelRef(npc) {
  return Math.max(12, Number(npc.accel) || 150);
}

// Predykcyjny ogranicznik prędkości: maksymalna prędkość w danym KIERUNKU taka,
// by zdążyć wyhamować przed przeszkodą (gracz / inny duży okręt) leżącą na
// kursie. Zwraca Infinity, gdy nic nie blokuje. To lekarstwo na "wlatywanie z
// rozpędu w Atlasa i wzajemne taranowanie": ciężki okręt zaczyna zwalniać z
// wyprzedzeniem, zamiast liczyć na słabą, ograniczoną accelem separację.
const OBSTACLE_LOOK = 1500;
const OBSTACLE_BRAKE = 420;
// Ogranicznik prędkości względem przeszkód. Sprawdza DWA kierunki (do celu i pędu)
// w JEDNYM zapytaniu do grida i cache'uje wynik per klatkę (window.__frameId) —
// bo liczone jest per capital w każdym substepie (~3×/klatkę), a pozycje między
// substepami zmieniają się pomijalnie.
function capitalObstacleSpeedCap(npc, d1x, d1y, d2x, d2y) {
  const fid = window.__frameId;
  if (fid && npc.__obsCapFid === fid && npc.__obsCapVal !== undefined) return npc.__obsCapVal;

  const myR = npc.radius || 100;
  const has2 = Number.isFinite(d2x) && (d2x !== 0 || d2y !== 0);
  let cap = Infinity;
  const consider = (ox, oy, oR) => {
    const rx = ox - npc.x;
    const ry = oy - npc.y;
    const clearance = myR + oR + 150;
    let along = rx * d1x + ry * d1y;
    if (along > 0 && along <= OBSTACLE_LOOK) {
      const perp = Math.abs(-rx * d1y + ry * d1x);
      if (perp <= clearance) {
        const v = Math.sqrt(2 * OBSTACLE_BRAKE * Math.max(0, along - clearance));
        if (v < cap) cap = v;
      }
    }
    if (has2) {
      along = rx * d2x + ry * d2y;
      if (along > 0 && along <= OBSTACLE_LOOK) {
        const perp = Math.abs(-rx * d2y + ry * d2x);
        if (perp <= clearance) {
          const v = Math.sqrt(2 * OBSTACLE_BRAKE * Math.max(0, along - clearance));
          if (v < cap) cap = v;
        }
      }
    }
  };
  const ship = window.ship;
  if (ship && !ship.destroyed && ship.pos) consider(ship.pos.x, ship.pos.y, ship.radius || 220);
  if (window.queryAIGrid) {
    const q = window.queryAIGrid(npc.x, npc.y, OBSTACLE_LOOK);
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

// Płynna interpolacja kąta po najkrótszej drodze (t: 0→a, 1→b).
function angleLerp(a, b, t) {
  const wrap = window.wrapAngle || ((x) => Math.atan2(Math.sin(x), Math.cos(x)));
  return a + wrap(b - a) * clampNum(t, 0, 1);
}

// Zamienia punkt docelowy w świecie na thrust/strafe + zalecany kąt kadłuba.
// Budżet prędkości: blisko celu ogranicza go droga hamowania sqrt(2·a·d)
// (statek dohamowuje zamiast przestrzelić), daleko — cruise cap. Dzięki pętli
// sprzężenia (desiredV - v) prędkość jest ograniczana także na ścieżce
// fizycznych thrusterów, która ignoruje npc.maxSpeed.
//
// TURN-TO-BURN: terrańskie kadłuby nie mają silników bocznych (engines.side),
// więc strafeNorm nie wytwarza siły. Dlatego gdy trzeba PRZEBYĆ dystans,
// zwracamy facing = kierunek ruchu (dziób jedzie tam, gdzie leci statek, a
// główny silnik go pcha — dokładnie jak działająca ścieżka komend RTS). Dopiero
// na pozycji przechodzimy na opts.combatFacing (burta/działa na wroga). Bez tego
// statek facił wroga i stał, bo lateralnie nie miał czym dojechać.
function capitalArriveControls(npc, tx, ty, opts = {}) {
  const dx = tx - npc.x;
  const dy = ty - npc.y;
  const dist = Math.hypot(dx, dy);
  const maxSpeed = Math.max(40, Number(opts.maxSpeed) || npc.maxSpeed || 200);
  // Zachowaj hierarchię klas także w walce. Dawna podłoga 300 u/s zrównywała
  // battleshipy, carriery i supercapitale niezależnie od ich parametrów.
  const combatSpeed = Math.max(maxSpeed * (Number(opts.combatSpeedMul) || 1.05), 40);
  const cruiseCap = Math.max(combatSpeed, Math.min(Number(opts.cruiseSpeed) || maxSpeed * 5, 1300));
  const combatRadius = Number(opts.combatRadius) || 2600;
  const arrival = Math.max(0, Number(opts.arrival) || 50);
  const brakeAccel = Math.max(12, Number(opts.brakeAccel) || resolveAccelRef(npc) * 0.8);
  const remaining = Math.max(0, dist - arrival);

  let budget = Math.min(remaining * 1.6, Math.sqrt(2 * brakeAccel * remaining) * 0.95);
  budget = Math.min(budget, dist > combatRadius ? cruiseCap : combatSpeed);

  const invD = dist > 1e-4 ? 1 / dist : 0;
  const destDirX = dx * invD;
  const destDirY = dy * invD;

  // Predykcyjne omijanie: nie rozpędzaj się w stronę przeszkody szybciej, niż
  // zdążysz wyhamować. Sprawdzamy kierunek do celu ORAZ kierunek aktualnego
  // pędu (żeby skasować rozpęd, który niesie prosto w gracza/sojusznika).
  if (!opts.noObstacleCap) {
    const vlen = Math.hypot(npc.vx || 0, npc.vy || 0);
    const useVel = vlen > 40;
    const obsCap = capitalObstacleSpeedCap(
      npc, destDirX, destDirY,
      useVel ? (npc.vx || 0) / vlen : 0,
      useVel ? (npc.vy || 0) / vlen : 0
    );
    if (obsCap < budget) budget = obsCap;
  }

  const desiredVx = destDirX * budget + (Number(opts.matchVx) || 0);
  const desiredVy = destDirY * budget + (Number(opts.matchVy) || 0);

  const tau = Math.max(0.25, Number(opts.tau) || 0.55);
  const ax = (desiredVx - (npc.vx || 0)) / tau;
  const ay = (desiredVy - (npc.vy || 0)) / tau;

  // Thrust/strafe liczymy w osiach BIEŻĄCEGO kąta (poprawne dla przyłożenia
  // siły); dziób obracamy osobno przez zwracany `facing`.
  const c = Math.cos(npc.angle || 0);
  const s = Math.sin(npc.angle || 0);
  const accelRef = resolveAccelRef(npc);

  const moveSpeed = Math.hypot(desiredVx, desiredVy);
  const combatFacing = Number.isFinite(opts.combatFacing) ? opts.combatFacing : null;
  const moveHeading = moveSpeed > 30
    ? Math.atan2(desiredVy, desiredVx)
    : (combatFacing != null ? combatFacing : (npc.angle || 0));
  const faceThreshold = Number.isFinite(opts.faceThreshold) ? opts.faceThreshold : (arrival + 550);
  let facing;
  if (combatFacing == null) {
    facing = moveHeading;
  } else {
    // Daleko (t→1) kierunek ruchu; na pozycji (t→0) combat facing; płynnie.
    const t = clampNum((dist - arrival) / Math.max(1, faceThreshold - arrival), 0, 1);
    facing = angleLerp(combatFacing, moveHeading, t);
  }

  npc.__speedCapHint = Math.max(budget, moveSpeed);

  return {
    thrustNorm: clampNum((ax * c + ay * s) / accelRef, -1, 1),
    strafeNorm: clampNum((-ax * s + ay * c) / accelRef, -1, 1),
    facing,
    dist,
    budget
  };
}

// Wygodny wrapper: policz sterowanie arrive (turn-to-burn + omijanie) i od razu
// je zastosuj (autopilot dokłada separację). Używany m.in. przez formację guard
// w index.html, żeby capitale wsparcia poruszały się tym samym mózgiem co w walce.
function capitalArriveTo(npc, tx, ty, opts = {}) {
  const dt = Number(opts.dt) || (1 / 60);
  const ctl = capitalArriveControls(npc, tx, ty, opts);
  applyCapitalAutopilot(npc, ctl.thrustNorm, ctl.strafeNorm, ctl.facing, 0, dt);
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

// Zachowanie bez celu: piraci wracają w okolice macierzystej stacji,
// pozostali aktywnie hamują (koniec z dryfem w pustkę po bitwie).
function capitalIdleControls(npc) {
  const home = npc.home;
  if (home && Number.isFinite(home.x) && Number.isFinite(home.y)) {
    const hd = Math.hypot(npc.x - home.x, npc.y - home.y);
    const guardR = (home.r || 300) + 1400;
    if (hd > guardR * 1.7) {
      const ctl = capitalArriveControls(npc, home.x, home.y, { arrival: guardR });
      return {
        thrustNorm: ctl.thrustNorm,
        strafeNorm: ctl.strafeNorm,
        faceAngle: ctl.facing
      };
    }
  }
  const ctl = capitalArriveControls(npc, npc.x, npc.y, { arrival: 0 });
  return { thrustNorm: ctl.thrustNorm, strafeNorm: ctl.strafeNorm, faceAngle: NaN };
}

// Punkt trzymania dystansu wokół celu: promień idealRange + dryf styczny,
// żeby okręt nie stał w miejscu jak tarcza strzelnicza.
function computeHoldPoint(npc, tk, idealRange, driftMul) {
  const dx = npc.x - tk.x;
  const dy = npc.y - tk.y;
  const dist = Math.hypot(dx, dy);
  const invD = dist > 1e-4 ? 1 / dist : 0;
  const rx = invD ? dx * invD : 1;
  const ry = invD ? dy * invD : 0;
  const dir = npc._orbitDir || 1;
  const tangX = -ry * dir;
  const tangY = rx * dir;
  const drift = idealRange * driftMul;
  return {
    x: tk.x + rx * idealRange + tangX * drift,
    y: tk.y + ry * idealRange + tangY * drift
  };
}

function updateOrbitDirTimers(npc, dt, flipBase) {
  if (npc._orbitDir == null) npc._orbitDir = Math.random() > 0.5 ? 1 : -1;
  npc._orbitFlipTimer = (Number.isFinite(npc._orbitFlipTimer) ? npc._orbitFlipTimer : (flipBase + Math.random() * 6)) - dt;
  if (npc._orbitFlipTimer <= 0) {
    npc._orbitDir = -npc._orbitDir;
    npc._orbitFlipTimer = flipBase + Math.random() * 6;
  }
}

// Lot na slot flankowy: punkt obraca się razem z celem (bearing względem jego
// dziobu), prędkość celu jest kompensowana (match velocity).
function computeFlankControls(npc, slot, opts = {}) {
  const vt = slot.target;
  const tk = readTargetKinematics(vt);
  const ang = (Number(vt.angle) || 0) + slot.bearing;
  const fx = tk.x + Math.cos(ang) * slot.dist;
  const fy = tk.y + Math.sin(ang) * slot.dist;
  const combatFacing = resolveCombatFacing(npc, Math.atan2(tk.y - npc.y, tk.x - npc.x));
  const ctl = capitalArriveControls(npc, fx, fy, {
    arrival: 40,
    matchVx: tk.vx,
    matchVy: tk.vy,
    combatSpeedMul: opts.combatSpeedMul || 1.35,
    cruiseSpeed: opts.cruiseSpeed,
    combatFacing
  });
  const distToVictim = Math.hypot(tk.x - npc.x, tk.y - npc.y);
  return { ctl, faceAngle: ctl.facing, distToVictim };
}

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

function getTargetScoreForWeapon(weapon, target, isRocket = false) {
  if (!target) return -1;
  const kind = isRocket ? 'rocket' : (window.getUnitKind?.(target) || 'other');

  const prefIndex = weapon.prefers.indexOf(kind);
  let score = 0;

  if (prefIndex !== -1) {
    score += (10 - prefIndex) * 100;
  } else {
    if (weapon.type === 'rail' && kind === 'fighter') score -= 500;
  }
  return score;
}

const SUBSYSTEM_PRIORITY = ['main', 'missile', 'aux', 'special', 'hangar'];
const SUBSYSTEM_RESCAN_INTERVAL = 1.5;

function getNextWeaponScanInterval(scanProfile) {
  if (scanProfile === 'fast') return 0.08 + Math.random() * 0.06;
  return 0.24 + Math.random() * 0.16;
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
      rockets: [],
      maxRange: 0
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

  if (!npc.friendly && window.ship && !window.ship.dead) {
    cache.enemies.push(window.ship);
  }

  if (window.queryAIGrid) {
    const query = window.queryAIGrid(npc.x, npc.y, maxRange);
    const buffer = query.buffer;
    const count = query.count;
    for (let i = 0; i < count; i++) {
      const enemy = buffer[i];
      if (!enemy || enemy.dead || enemy === npc) continue;
      if (enemy === window.ship) continue;
      if (npc.friendly && !enemy.isPirate) continue;
      if (!npc.friendly && enemy.friendly === false) continue;
      cache.enemies.push(enemy);
    }
  } else {
    const npcs = window.npcs || [];
    for (let i = 0; i < npcs.length; i++) {
      const enemy = npcs[i];
      if (!enemy || enemy.dead || enemy === npc) continue;
      if (npc.friendly && !enemy.isPirate) continue;
      if (!npc.friendly && enemy.friendly === false) continue;
      cache.enemies.push(enemy);
    }
  }

  if (needsRocketThreats && window.bullets) {
    const myTeam = npc.friendly ? 'player' : 'npc';
    for (let i = 0; i < window.bullets.length; i++) {
      const b = window.bullets[i];
      if (!b || b.owner === myTeam) continue;
      if (b.type !== 'rocket' && b.type !== 'torpedo') continue;
      const distSq = (b.x - npc.x) ** 2 + (b.y - npc.y) ** 2;
      if (distSq > (maxRange * maxRange)) continue;
      cache.rockets.push(b);
    }
  }

  cache.ttl = scanProfile === 'fast'
    ? (0.08 + Math.random() * 0.06)
    : (0.24 + Math.random() * 0.16);
  return cache;
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

function processAutonomousWeapons(npc, dt) {
  if (!npc) return;
  // Carrier: wypuszczanie eskadr z hangarów (early-return wewnątrz dla nie-carrierów).
  if (window.updateNpcHangars) window.updateNpcHangars(npc, dt);
  initAutonomousWeapons(npc);
  if (!npc.autoWeapons || npc.autoWeapons.length === 0) return;

  const tWeap0 = (typeof performance !== 'undefined') ? performance.now() : 0;
  const scanCaches = Object.create(null);

  for (let wIdx = 0; wIdx < npc.autoWeapons.length; wIdx++) {
    const weapon = npc.autoWeapons[wIdx];
    const hpRef = weapon.hpOffset;
    if (hpRef && (hpRef.destroyed || !hpRef.mount || (weapon.id && hpRef.mount !== weapon.id))) {
      continue;
    }
    const restAngle = (npc.angle || 0) + weapon.mountAngle;
    if (weapon.visualAngle === undefined) weapon.visualAngle = restAngle;

    weapon.cd -= dt;

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
      (bestTarget.x == null && bestTarget.pos?.x == null);

    if (mustRescan) {
      bestTarget = null;
      const scanProfile = weapon.scanProfile || 'slow';
      const cache = scanCaches[scanProfile] || (scanCaches[scanProfile] = buildShipScanCache(npc, dt, scanProfile));

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

      // IN-PLACE FILTERING for enemies
      const checkAndScoreTarget = (enemy) => {
        const tx = enemy.pos ? enemy.pos.x : enemy.x;
        const ty = enemy.pos ? enemy.pos.y : enemy.y;
        const distSq = (tx - npc.x) ** 2 + (ty - npc.y) ** 2;
        if (distSq > rangeSq) return;

        const absTargetAngle = Math.atan2(ty - npc.y, tx - npc.x);
        const angleDiff = Math.abs(window.wrapAngle(absTargetAngle - restAngle));

        if (angleDiff > weapon.arc) return;
        if (window.isLineOfFireBlocked?.(npc, enemy, range)) return;

        const score = getTargetScoreForWeapon(weapon, enemy, false) - distSq * 0.001;
        if (score > bestScore) {
          bestScore = score;
          bestTarget = enemy;
        }
      };

      for (let i = 0; i < cache.enemies.length; i++) {
        checkAndScoreTarget(cache.enemies[i]);
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
      const subTarget = {
        x: aimX, y: aimY,
        vx: bestTarget.vx ?? bestTarget.vel?.x ?? 0,
        vy: bestTarget.vy ?? bestTarget.vel?.y ?? 0
      };

      const lead = window.getLeadAim ? window.getLeadAim({ x: npc.x, y: npc.y }, subTarget, speed, _leadAimScratch) : { x: aimX, y: aimY };
      const aimAngle = Math.atan2(lead.y - npc.y, lead.x - npc.x);

      let diff = window.wrapAngle(aimAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 8 * dt);

      if (weapon.cd <= 0) {
        if (window.spawnBulletAdapter) {
          window.spawnBulletAdapter(npc, bestTarget, weapon.def, {
            type: weapon.type,
            hp: weapon.hpOffset,
            angleOverride: weapon.visualAngle
          });
        }
        weapon.cd = weapon.def.cooldown || 2.0;
        if (weapon.ammo !== null && weapon.ammo > 0) weapon.ammo -= 1;
      }
    } else {
      let diff = window.wrapAngle(restAngle - weapon.visualAngle);
      weapon.visualAngle = window.wrapAngle(weapon.visualAngle + diff * 3 * dt);
    }
  }

  if (typeof performance !== 'undefined') {
    window.__aiWeaponScanMs = (window.__aiWeaponScanMs || 0) + (performance.now() - tWeap0);
  }
}

// ============================================================================
// 3. MÓZGI NAWIGACYJNE
// ============================================================================

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

    if (window.bullets) {
      const myTeam = npc.friendly ? 'player' : 'npc';
      for (let i = 0; i < window.bullets.length; i++) {
        const b = window.bullets[i];
        if ((b.type === 'rocket' || b.type === 'torpedo') && b.owner !== myTeam) {
          const d2 = (b.x - npc.x) ** 2 + (b.y - npc.y) ** 2;
          if (d2 < pdRange * pdRange) {
            const score = 2000 - d2 * 0.001;
            if (score > bestScore) { bestScore = score; bestTarget = b; }
          }
        }
      }
    }

    if (!bestTarget) {
      const freshTarget = window.aiPickTarget?.(npc);
      if (freshTarget) {
        const d2 = ((freshTarget.pos?.x ?? freshTarget.x) - npc.x) ** 2 +
                    ((freshTarget.pos?.y ?? freshTarget.y) - npc.y) ** 2;
        const engageRange = 3200;
        if (d2 < engageRange * engageRange) bestTarget = freshTarget;
      }
    }

    npc.target = bestTarget || null;
    npc.retargetTimer = 0.3 + Math.random() * 0.2;
  }

  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (target && target.dead) target = null;

  // Smycz eskorty: tylko skrzydło wsparcia w trybie GUARD wraca do lidera.
  const guardOrder = isSupport && (window.SupportWing?.order || 'guard') !== 'engage';
  if (guardOrder && guardian && distToGuard > 2600) {
    target = null;
    npc.target = null;
  }

  let targetAng = npc.angle || 0;
  let thrustNorm = 0;
  let strafeNorm = 0;

  const slot = getBattleSlot(npc);

  if (slot && slot.kind === 'flank' && !guardOrder) {
    const flank = computeFlankControls(npc, slot, { combatSpeedMul: 1.3 });
    thrustNorm = flank.ctl.thrustNorm;
    strafeNorm = flank.ctl.strafeNorm;
    targetAng = flank.faceAngle;
  } else if (target && !target.dead) {
    const tk = readTargetKinematics(target);
    const toAng = Math.atan2(tk.y - npc.y, tk.x - npc.x);
    const idealRange = Math.max(420, Number(npc.preferredRange) || 700);
    updateOrbitDirTimers(npc, dt, 10);
    const hold = computeHoldPoint(npc, tk, idealRange, 0.4);
    const ctl = capitalArriveControls(npc, hold.x, hold.y, {
      arrival: 30,
      matchVx: tk.vx,
      matchVy: tk.vy,
      combatSpeedMul: 1.3,
      combatFacing: resolveCombatFacing(npc, toAng)
    });
    thrustNorm = ctl.thrustNorm;
    strafeNorm = ctl.strafeNorm;
    targetAng = ctl.facing;
  } else if (slot && slot.kind === 'line') {
    const ctl = capitalArriveControls(npc, slot.x, slot.y, {
      arrival: 60,
      combatSpeedMul: 1.2,
      combatFacing: resolveCombatFacing(npc, slot.facing)
    });
    thrustNorm = ctl.thrustNorm;
    strafeNorm = ctl.strafeNorm;
    targetAng = ctl.facing;
  } else if (guardian) {
    // Eskorta: trzymaj się w pobliżu lidera, z hamowaniem zamiast taranowania.
    const escortDist = Math.max(380, (guardian.radius || 220) + (npc.radius || 45) + 160);
    if (distToGuard > escortDist) {
      const ctl = capitalArriveControls(npc, guardX, guardY, {
        arrival: escortDist,
        matchVx: Number(guardian.vel?.x ?? guardian.vx) || 0,
        matchVy: Number(guardian.vel?.y ?? guardian.vy) || 0
      });
      thrustNorm = ctl.thrustNorm;
      strafeNorm = ctl.strafeNorm;
      targetAng = ctl.facing;
    } else {
      const idle = capitalIdleControls(npc);
      thrustNorm = idle.thrustNorm;
      strafeNorm = idle.strafeNorm;
      if (Number.isFinite(guardian.angle)) targetAng = guardian.angle;
    }
  } else {
    const idle = capitalIdleControls(npc);
    thrustNorm = idle.thrustNorm;
    strafeNorm = idle.strafeNorm;
    if (Number.isFinite(idle.faceAngle)) targetAng = idle.faceAngle;
  }

  // Unik przed nadlatującymi rakietami — nakładka na strafe.
  if (target && !target.dead) {
    npc._dodgeTimer = (npc._dodgeTimer || 0) - dt;
    if (npc._dodgeTimer <= 0 && window.bullets) {
      const myTeam = npc.friendly ? 'player' : 'npc';
      for (let i = 0; i < window.bullets.length; i++) {
        const b = window.bullets[i];
        if ((b.type === 'rocket' || b.type === 'torpedo') && b.owner !== myTeam) {
          const bdx = npc.x - b.x;
          const bdy = npc.y - b.y;
          const bd = Math.hypot(bdx, bdy);
          if (bd < 800) {
            const bAng = Math.atan2(b.vy || 0, b.vx || 0);
            const toMe = Math.atan2(bdy, bdx);
            if (Math.abs(window.wrapAngle(bAng - toMe)) < 0.5) {
              npc._dodgeDir = (Math.random() > 0.5) ? 1 : -1;
              npc._dodgeTimer = 0.5;
              break;
            }
          }
        }
      }
    }
    if (npc._dodgeTimer > 0) {
      strafeNorm = clampNum(strafeNorm + (npc._dodgeDir || 1) * 0.6, -1, 1);
    }
  }

  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, 0, dt);
  processAutonomousWeapons(npc, dt);
}

export function aiDestroyer(sim, npc, dt) {
  npc.boostT = Math.max(0, (npc.boostT || 0) - dt);
  npc.boostCd = Math.max(0, (npc.boostCd || 0) - dt);

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) {
      if (freshTarget !== npc.target) {
        npc._orbitDir = (Math.random() > 0.5) ? 1 : -1;
      }
      npc.target = freshTarget;
    }
    npc.retargetTimer = 1.0 + Math.random() * 0.5;
  }
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (target && target.dead) target = null;

  let targetAng = npc.angle || 0;
  let thrustNorm = 0;
  let strafeNorm = 0;

  const slot = getBattleSlot(npc);

  if (slot && slot.kind === 'flank') {
    const vt = slot.target;
    const vtx = vt.pos ? vt.pos.x : vt.x;
    const vty = vt.pos ? vt.pos.y : vt.y;
    const distToVictim = Math.hypot(vtx - npc.x, vty - npc.y);
    if (distToVictim > 2600 && npc.boostCd <= 0) {
      npc.boostT = npc.boostDur || 2.2;
      npc.boostCd = 12.0;
    }
    const flank = computeFlankControls(npc, slot, {
      combatSpeedMul: 1.45,
      cruiseSpeed: (npc.maxSpeed || 200) * (npc.boostT > 0 ? 4.6 : 3.2)
    });
    thrustNorm = flank.ctl.thrustNorm;
    strafeNorm = flank.ctl.strafeNorm;
    targetAng = flank.faceAngle;
  } else if (target && !target.dead) {
    const tk = readTargetKinematics(target);
    const toAng = Math.atan2(tk.y - npc.y, tk.x - npc.x);
    const combatFacing = resolveCombatFacing(npc, toAng);
    const idealRange = resolveCapitalIdealRange(npc, target);
    const dist = Math.hypot(tk.x - npc.x, tk.y - npc.y);

    if (dist > 2800 && npc.boostCd <= 0) {
      npc.boostT = npc.boostDur || 2.5;
      npc.boostCd = 12.0;
    }

    if (slot && slot.kind === 'line' && dist > idealRange * 0.7) {
      const ctl = capitalArriveControls(npc, slot.x, slot.y, {
        arrival: 50,
        combatSpeedMul: 1.25,
        cruiseSpeed: (npc.maxSpeed || 200) * (npc.boostT > 0 ? 4.6 : 3.0),
        combatFacing
      });
      thrustNorm = ctl.thrustNorm;
      strafeNorm = ctl.strafeNorm;
      targetAng = ctl.facing;
    } else {
      updateOrbitDirTimers(npc, dt, 12);
      const hold = computeHoldPoint(npc, tk, idealRange, 0.5);
      const ctl = capitalArriveControls(npc, hold.x, hold.y, {
        arrival: 40,
        matchVx: tk.vx,
        matchVy: tk.vy,
        combatSpeedMul: 1.35,
        cruiseSpeed: (npc.maxSpeed || 200) * (npc.boostT > 0 ? 4.6 : 3.0),
        combatFacing
      });
      thrustNorm = ctl.thrustNorm;
      strafeNorm = ctl.strafeNorm;
      targetAng = ctl.facing;
    }
  } else if (slot && slot.kind === 'line') {
    const ctl = capitalArriveControls(npc, slot.x, slot.y, {
      arrival: 60,
      combatSpeedMul: 1.25,
      combatFacing: resolveCombatFacing(npc, slot.facing)
    });
    thrustNorm = ctl.thrustNorm;
    strafeNorm = ctl.strafeNorm;
    targetAng = ctl.facing;
  } else {
    const idle = capitalIdleControls(npc);
    thrustNorm = idle.thrustNorm;
    strafeNorm = idle.strafeNorm;
    if (Number.isFinite(idle.faceAngle)) targetAng = idle.faceAngle;
  }

  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, npc.boostT, dt);
  processAutonomousWeapons(npc, dt);
}

export function aiBattleship(sim, npc, dt) {
  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  if (npc.retargetTimer <= 0) {
    const freshTarget = window.aiPickTarget?.(npc);
    if (freshTarget) {
      if (freshTarget !== npc.target) {
        npc._orbitDir = null;
        npc._orbitFlipTimer = 15 + Math.random() * 5;
      }
      npc.target = freshTarget;
    }
    npc.retargetTimer = 1.5 + Math.random() * 0.5;
  }
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (target && target.dead) target = null;

  let targetAng = npc.angle || 0;
  let thrustNorm = 0;
  let strafeNorm = 0;

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
      const ctl = capitalArriveControls(npc, slot.x, slot.y, {
        arrival: Math.max(50, (npc.radius || 100) * 0.4),
        combatSpeedMul: 1.1,
        combatFacing
      });
      thrustNorm = ctl.thrustNorm;
      strafeNorm = ctl.strafeNorm;
      targetAng = ctl.facing;
    } else {
      // Samotny okręt (lub wróg podszedł za blisko): trzymaj dystans idealRange
      // z lekkim dryfem stycznym.
      updateOrbitDirTimers(npc, dt, 16);
      const hold = computeHoldPoint(npc, tk, idealRange, 0.28);
      const ctl = capitalArriveControls(npc, hold.x, hold.y, {
        arrival: 40,
        matchVx: tk.vx,
        matchVy: tk.vy,
        combatSpeedMul: 1.15,
        combatFacing
      });
      thrustNorm = ctl.thrustNorm;
      strafeNorm = ctl.strafeNorm;
      targetAng = ctl.facing;
    }
  } else if (slot && slot.kind === 'line') {
    const ctl = capitalArriveControls(npc, slot.x, slot.y, {
      arrival: 80,
      combatSpeedMul: 1.2,
      combatFacing: resolveCombatFacing(npc, slot.facing)
    });
    thrustNorm = ctl.thrustNorm;
    strafeNorm = ctl.strafeNorm;
    targetAng = ctl.facing;
  } else {
    const idle = capitalIdleControls(npc);
    thrustNorm = idle.thrustNorm;
    strafeNorm = idle.strafeNorm;
    if (Number.isFinite(idle.faceAngle)) targetAng = idle.faceAngle;
  }

  applyCapitalAutopilot(npc, thrustNorm, strafeNorm, targetAng, 0, dt);
  processAutonomousWeapons(npc, dt);
}

window.aiFrigate = aiFrigate;
window.aiDestroyer = aiDestroyer;
window.aiBattleship = aiBattleship;
window.capitalArriveTo = capitalArriveTo;
