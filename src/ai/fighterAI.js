// src/ai/fighterAI.js
//
// Mózg myśliwca. Stany: engage_formation (dolot), dogfight3D (kocioł),
// bombing (nalot na duży cel), guard (formacja przy liderze).
//
// Cała geometria walki wyprowadzana jest z zasięgu działka i prędkości
// maksymalnej myśliwca (fighterEnvelope). Poprzednie stałe (kocioł od 600 u,
// ogień od 1400 u, podfazy po 0.6-1.2 s) pochodziły z czasów, gdy eskadry
// latały 650 u/s — przy obecnych ~2800 u/s myśliwiec przelatywał całą
// obwiednię w ~0.2 s i stany przełączały się szybciej, niż zdążył wystrzelić.

import { clampTurnVec, getLeadAim, scoreAiTarget } from './aiUtils.js';

const _leadScratch = { x: 0, y: 0 };
const _turnScratch = { vx: 0, vy: 0 };
const _normScratch = { x: 0, y: 0 };

const FIGHTER_LONG_SEARCH_RANGE = 16000;
const FIGHTER_GUARD_SEARCH_RANGE = 6000;
const FIGHTER_RETARGET_MIN = 1.6;
const FIGHTER_RETARGET_SPREAD = 0.8;

// --- TRZYMANIE CELU ---------------------------------------------------------
// aiPickBestTarget jest zdominowany przez człon -dystans² (0.00016 * d²), więc
// w kotle "najbliższy wróg" zmieniał się przy każdym mijaniu i myśliwiec co
// ~2 s wykręcał na nowy cel. Każda taka zmiana to ostry zakręt — z zewnątrz
// wygląda dokładnie jak ucieczka z walki. Teraz cel zmieniamy dopiero gdy:
// zginął, urwał się ze smyczy, albo minął commitment I nowy kandydat jest
// wyraźnie bliżej.
const TARGET_COMMIT_TIME = 5.0;
// Histereza liczona na SKALI SCORINGU, nie na dystansie. Wersja dystansowa
// ("nowy musi być 38% bliżej") miała fatalny skutek uboczny: myśliwce eskorty
// lecą TUŻ OBOK gracza, więc dla pirata zaczepionego o gracza były w tej samej
// odległości i warunek nigdy nie był spełniony — cała chmara fiksowała się na
// graczu i ignorowała myśliwce, które ją ostrzeliwały. Różnica premii za rodzaj
// celu (myśliwiec 5000 vs gracz 1600) jest teraz w tej samej walucie.
const TARGET_SWITCH_MARGIN = 900;
const TARGET_LEASH_MUL = 1.4;      // ile SEARCH_RANGE zanim porzucimy pościg

const norm = (vX, vY, out = _normScratch) => {
  const L = Math.hypot(vX, vY);
  out.x = L ? vX / L : 0;
  out.y = L ? vY / L : 0;
  return out;
};

const wrapPi = (a) => {
  if (typeof window !== 'undefined' && window.wrapAngle) return window.wrapAngle(a);
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

// Safe numeric hash for npc.id (string IDs like 'pirate_0' would cause NaN in arithmetic)
const _npcIdNum = (id) => {
  if (typeof id === 'number') return id;
  if (!id) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
};

function targetX(t) {
  return (t && t.pos && t.pos.x !== undefined) ? t.pos.x : (t ? t.x : 0);
}
function targetY(t) {
  return (t && t.pos && t.pos.y !== undefined) ? t.pos.y : (t ? t.y : 0);
}
function distTo(npc, t) {
  if (!t) return Infinity;
  return Math.hypot(targetX(t) - npc.x, targetY(t) - npc.y);
}

// --- OBWIEDNIA WALKI --------------------------------------------------------
// Wszystkie dystanse i czasy podfaz skalowane zasięgiem działka i prędkością,
// żeby tuning eskadr (fighterSquadrons.js) nie rozjeżdżał się z AI.
// Cache'owane na npc — przelicza się tylko po zmianie uzbrojenia/prędkości.
export function fighterEnvelope(npc) {
  const weapons = (typeof window !== 'undefined' && window.MASTER_WEAPONS) || {};
  const gunDef = weapons[npc.gun || 'ciws_mk1'];
  const gunRange = Math.max(400, gunDef?.baseRange || 1200);
  const speed = Math.max(150, npc.maxSpeed || 1200);

  let env = npc.__fighterEnv;
  if (env && env.gunRange === gunRange && env.speed === speed) return env;
  if (!env) env = npc.__fighterEnv = {};

  env.gunRange = gunRange;
  env.speed = speed;
  env.gunSpeed = Number.isFinite(gunDef?.baseSpeed) ? gunDef.baseSpeed : 2000;

  // Kocioł zaczyna się tam, skąd realnie prowadzimy ogień; wyjście ~2x dalej,
  // żeby przelot przez cel nie wyrzucał od razu z powrotem do dolotu.
  env.dogfightEnter = gunRange * 1.7;
  env.dogfightExit = gunRange * 3.2;
  env.bombEnter = gunRange * 1.5;
  env.bombExit = gunRange * 3.6;

  // Czas przelotu obwiedni — baza dla długości podfaz.
  const cross = gunRange / speed;
  env.mergeT = Math.min(1.2, Math.max(0.35, cross * 1.1));
  env.slashT = Math.min(0.9, Math.max(0.30, cross * 0.8));
  env.breakT = Math.min(1.4, Math.max(0.50, cross * 1.6));
  env.minCore = Math.min(2.6, Math.max(1.0, cross * 2.2));
  return env;
}

// --- STEROWANIE -------------------------------------------------------------
// clampTurnVec ustawia moduł prędkości na |want| w JEDNEJ klatce, więc myśliwce
// miały nieskończone przyspieszenie: pełna prędkość natychmiast, stop
// natychmiast. Tu obracamy kurs z limitem skrętu, a moduł prędkości dociągamy
// z ograniczeniem npc.accel (hamowanie 1.5x mocniejsze — retro + opór).
export function steerFighter(npc, wantVx, wantVy, dt, turnDeg) {
  const wantSpeed = Math.hypot(wantVx, wantVy);
  const cur = Math.hypot(npc.vx || 0, npc.vy || 0);

  let dirX = 0;
  let dirY = 0;
  if (wantSpeed <= 1e-6) {
    // Żądanie "stój": trzymamy bieżący kurs i hamujemy. clampTurnVec przy
    // zerowym wektorze docelowym zwróciłby kurs 0 i wyzerował prędkość skokowo.
    const L = Math.hypot(npc.vx || 0, npc.vy || 0);
    if (L > 1e-6) { dirX = (npc.vx || 0) / L; dirY = (npc.vy || 0) / L; }
  } else if (cur > 1) {
    const turned = clampTurnVec(npc.vx, npc.vy, wantVx, wantVy, dt, turnDeg, _turnScratch);
    const L = Math.hypot(turned.vx, turned.vy) || 1;
    dirX = turned.vx / L;
    dirY = turned.vy / L;
  } else {
    // Postój: clampTurnVec czytałby kurs z atan2(0,0)=0 i myśliwiec ruszałby
    // zawsze w prawo. Z miejsca ruszamy prosto w żądanym kierunku.
    dirX = wantVx / wantSpeed;
    dirY = wantVy / wantSpeed;
  }

  const accel = Math.max(60, npc.accel || (npc.maxSpeed || 600) * 0.75);
  const speed = (wantSpeed > cur)
    ? Math.min(wantSpeed, cur + accel * dt)
    : Math.max(wantSpeed, cur - accel * 1.5 * dt);

  npc.vx = dirX * speed;
  npc.vy = dirY * speed;
}

function faceVelocity(npc) {
  if ((npc.vx * npc.vx + npc.vy * npc.vy) > 100) {
    npc.desiredAngle = Math.atan2(npc.vy, npc.vx);
  }
}

// Separacja wchodzi do WEKTORA ŻĄDANEGO, nie jako impuls po sterowaniu.
// Doklejana po fakcie była kasowana w następnej klatce (sterowanie nadpisuje
// vx/vy), więc nie robiła nic. Horyzont 0.5 s zamienia przyspieszenie na
// odchylenie kursu.
function addSeparation(npc, want) {
  const fn = (typeof window !== 'undefined') ? window.applySeparationForces : null;
  if (!fn) return want;
  const sep = fn(npc, 0, 0);
  if (!sep) return want;
  want.x += (sep.ax || 0) * 0.5;
  want.y += (sep.ay || 0) * 0.5;
  return want;
}

const _wantScratch = { x: 0, y: 0 };
function want(vx, vy) {
  _wantScratch.x = vx;
  _wantScratch.y = vy;
  return _wantScratch;
}

// --- OGIEŃ ------------------------------------------------------------------
function tryFireFighter(npc, target, dt) {
  if (!target || target.dead) return;

  const MASTER_WEAPONS = (typeof window !== 'undefined' && window.MASTER_WEAPONS) || {};
  const gunDef = MASTER_WEAPONS[npc.gun || 'ciws_mk1'];

  const tx = targetX(target);
  const ty = targetY(target);
  const dx = tx - npc.x;
  const dy = ty - npc.y;
  const dist = Math.hypot(dx, dy);

  const angleToTarget = Math.atan2(dy, dx);
  const myAngle = Number.isFinite(npc.angle) ? npc.angle : Math.atan2(npc.vy || 0, npc.vx || 0);
  const diff = Math.abs(wrapPi(angleToTarget - myAngle));

  // Działko. isLineOfFireBlocked to skan po WSZYSTKICH npc — wołamy go dopiero
  // po tanich testach zasięgu/kąta i cooldownu, a nie na wejściu do funkcji.
  if (gunDef && (npc.gunCD || 0) <= 0) {
    const gunRange = gunDef.baseRange || 400;
    if (dist < gunRange * 0.95 && diff < 0.75
        && !window.isLineOfFireBlocked?.(npc, target, gunRange)) {
      window.spawnBulletAdapter?.(npc, target, gunDef, { type: gunDef.category });
      npc.gunCD = gunDef.cooldown || 0.2;
    }
  }

  // Rakiety decydują osobno. Wcześniej blokada linii ognia DZIAŁKA przerywała
  // całą funkcję, więc sojusznik przelatujący przed dziobem kasował też
  // odpalenie rakiety naprowadzanej, której to nie dotyczy.
  if (npc.mslAmmo > 0 && (npc.mslCD || 0) <= 0) {
    const mslDef = MASTER_WEAPONS[npc.msl || 'missile_rack'];
    if (!mslDef) return;

    const isLightMsl = mslDef.id === 'osa_micro_missile';
    const fireRange = isLightMsl ? 2800 : 1200;
    const fireDiff = isLightMsl ? 0.85 : 0.6;
    // Szansa na SEKUNDĘ, nie na klatkę — stare 0.18/klatkę to było ~11/s przy
    // 60 fps (czyli "zawsze") i zmieniało się razem z framerate'em.
    const fireRate = isLightMsl ? 6.0 : 3.0;
    const cdReset = isLightMsl ? (mslDef.cooldown || 1.0) : 5.0;

    if (dist < fireRange && diff < fireDiff && Math.random() < fireRate * dt) {
      window.spawnBulletAdapter?.(npc, target, mslDef, { type: 'rocket' });
      npc.mslAmmo--;
      npc.mslCD = cdReset;

      if (window.spawnParticle) {
        window.spawnParticle(
          { x: npc.x, y: npc.y },
          { x: 0, y: 0 },
          isLightMsl ? 0.25 : 0.5,
          isLightMsl ? '#9be8ff' : '#ffffff',
          isLightMsl ? 2.5 : 5,
          true
        );
      }
    }
  }
}

// --- WYBÓR CELU -------------------------------------------------------------
function getEntityAssignedTarget(entity) {
  if (!entity || entity.dead) return null;
  if (entity.forceTarget && !entity.forceTarget.dead) return entity.forceTarget;
  if (entity.target && !entity.target.dead) return entity.target;
  // Gracz nie ma .target — jego "rozkaz" dla eskadry to cel zablokowany na HUD.
  if (typeof window !== 'undefined' && entity === window.ship) {
    const locked = window.getPlayerLockedTarget?.();
    if (locked && !locked.dead) return locked;
  }
  return null;
}

function getInheritedWingmanTarget(npc, rangeSq = Infinity) {
  let leader = null;
  if (npc.squad?.leader && npc.squad.leader !== npc && !npc.squad.leader.dead) {
    leader = npc.squad.leader;
  } else if (npc.supportData?.leader && npc.supportData.leader !== npc && !npc.supportData.leader.dead) {
    leader = npc.supportData.leader;
  }
  if (!leader) return null;

  const inherited = getEntityAssignedTarget(leader);
  if (!inherited) return null;
  if (window.isEnemyUnit && !window.isEnemyUnit(npc, inherited)) return null;

  const dx = targetX(inherited) - npc.x;
  const dy = targetY(inherited) - npc.y;
  if (dx * dx + dy * dy > rangeSq) return null;

  return inherited;
}

function pickScoredTarget(npc, searchRange) {
  if (window.aiPickBestTarget) return window.aiPickBestTarget(npc, searchRange);
  if (window.aiPickTarget) {
    const t = window.aiPickTarget(npc);
    if (t && distTo(npc, t) <= searchRange) return t;
  }
  return null;
}

// Zwraca cel po uwzględnieniu commitmentu i histerezy. Eksportowane, żeby dało
// się to przetestować bez pełnej pętli gry.
export function resolveFighterTarget(npc, current, searchRange, env) {
  const searchRangeSq = searchRange * searchRange;
  const inherited = getInheritedWingmanTarget(npc, searchRangeSq);
  const scored = pickScoredTarget(npc, searchRange);

  const isFighterTarget = (t) => !!t && window.getUnitKind?.(t) === 'fighter';

  // SAMOOBRONA — twardy priorytet. Wrogi myśliwiec w obwiedni kotła bije każdy
  // inny rozkaz: cel odziedziczony po liderze, zaangażowanie w duży okręt i
  // commitment. Bez tego eskadra prowadzona na gracza leciała dalej, mając na
  // ogonie myśliwce, które do niej strzelały.
  const defend = (scored && scored !== current && isFighterTarget(scored)
    && distTo(npc, scored) < env.dogfightEnter) ? scored : null;

  let best = defend;
  if (!best) {
    best = inherited || scored;
    // Rozkaz lidera to PREFERENCJA, nie dogmat. Gdy lokalny cel jest wyraźnie
    // lepszy w scoringu (lider trzyma się gracza, a nas atakują myśliwce),
    // bierzemy lokalny — inaczej cała eskadra dziedziczyła fiksację lidera.
    if (inherited && scored && scored !== inherited
      && scoreAiTarget(npc, scored) > scoreAiTarget(npc, inherited) + TARGET_SWITCH_MARGIN) {
      best = scored;
    }
  }

  if (!best && npc.friendly && window.pickSquadTargets) {
    const squadTargets = window.pickSquadTargets();
    if (Array.isArray(squadTargets) && squadTargets.length > 0) best = squadTargets[0];
  }

  if (!best) return current;
  if (best === current) {
    npc.targetCommitT = TARGET_COMMIT_TIME; // wciąż najlepszy — odnów zaangażowanie
    return current;
  }
  if (!current || current.dead) {
    npc.targetCommitT = TARGET_COMMIT_TIME;
    return best;
  }
  // Samoobrona przerywa commitment natychmiast.
  if (best === defend) {
    npc.targetCommitT = TARGET_COMMIT_TIME;
    return best;
  }
  if (scoreAiTarget(npc, best) > scoreAiTarget(npc, current) + TARGET_SWITCH_MARGIN) {
    npc.targetCommitT = TARGET_COMMIT_TIME;
    return best;
  }
  return current;
}

// --- GŁÓWNY MÓZG ------------------------------------------------------------
export function runAdvancedFighterAI(npc, dt) {
  const isSupport = npc.isSupportWing || !!npc.supportData;
  let order = 'engage';

  if (isSupport && window.SupportWing) {
    order = window.SupportWing.order || 'guard';
  }

  const SEARCH_RANGE = (order === 'engage' || npc.isPirate) ? FIGHTER_LONG_SEARCH_RANGE : FIGHTER_GUARD_SEARCH_RANGE;
  const env = fighterEnvelope(npc);

  npc.gunCD = Math.max(0, (npc.gunCD || 0) - dt);
  npc.mslCD = Math.max(0, (npc.mslCD || 0) - dt);
  npc.breakOffTimer = Math.max(0, (npc.breakOffTimer || 0) - dt);
  npc.targetCommitT = Math.max(0, (npc.targetCommitT || 0) - dt);
  if (npc.state === 'dogfight3D') npc.dogfightTime = (npc.dogfightTime || 0) + dt;
  else npc.dogfightTime = 0;

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (target && target.dead) target = null;

  // Smycz: cel, który wyrwał się daleko poza zasięg szukania, przestaje nas
  // obowiązywać (forceTarget = rozkaz RTS, ten trzymamy bez względu na dystans).
  if (target && target !== npc.forceTarget && distTo(npc, target) > SEARCH_RANGE * TARGET_LEASH_MUL) {
    target = null;
    npc.target = null;
    npc.targetCommitT = 0;
  }

  const pinnedByOrder = !!(npc.forceTarget && !npc.forceTarget.dead);
  if (npc.retargetTimer <= 0) {
    npc.retargetTimer = FIGHTER_RETARGET_MIN + Math.random() * FIGHTER_RETARGET_SPREAD;
    // Skan robimy tylko wtedy, gdy w ogóle wolno nam zmienić cel — commitment
    // oszczędza też O(n) przebieg po npcs[] w aiPickBestTarget. forceTarget to
    // rozkaz RTS: i tak wygrywa w następnej klatce, więc nie ma czego szukać.
    if (!pinnedByOrder && (!target || npc.targetCommitT <= 0)) {
      const next = resolveFighterTarget(npc, target, SEARCH_RANGE, env);
      if (next) {
        target = next;
        npc.target = next;
      }
    }
  }

  const isSquadWingman = (npc.squad && npc.squad.leader && !npc.squad.leader.dead && npc.squad.leader !== npc);
  if (!target && !npc.friendly && !npc.guardStation && !isSquadWingman) {
    target = window.ship;
    npc.target = target;
  }

  let tx = 0;
  let ty = 0;
  let distToTarget = Infinity;
  let targetKind = 'unknown';

  if (target) {
    tx = targetX(target);
    ty = targetY(target);
    distToTarget = Math.hypot(tx - npc.x, ty - npc.y);
    targetKind = window.getUnitKind?.(target) || 'unknown';
  }

  if (target) {
    if (targetKind === 'fighter') {
      if (npc.state === 'dogfight3D') {
        if (distToTarget > env.dogfightExit) npc.state = 'engage_formation';
      } else {
        if (distToTarget < env.dogfightEnter) {
          npc.state = 'dogfight3D';
          npc.sub = 'merge';
          npc.subT = 0;
          npc._mergeInit = false;
          npc.dogfightTime = 0;
          npc.dogfightMin = env.minCore * (0.85 + Math.random() * 0.5);
        } else {
          npc.state = 'engage_formation';
        }
      }
    }
    else {
      const targetR = target.radius || 50;
      if (npc.state === 'bombing') {
        if (distToTarget > env.bombExit + targetR) npc.state = 'engage_formation';
      } else {
        if (distToTarget < env.bombEnter + targetR) npc.state = 'bombing';
        else npc.state = 'engage_formation';
      }
    }
  } else {
    npc.state = 'guard';
  }

  // === DOLOT ===
  if (npc.state === 'engage_formation' && target) {
    // Pościg z wyprzedzeniem. Czysta pogoń "na ogon" nigdy nie dogoni celu o
    // podobnej prędkości — myśliwiec wisiał za rufą, nigdy nie wchodząc w kąt
    // ognia. Punkt upredzenia domyka geometrię i przechodzi w przechwycenie.
    const aim = getLeadAim(npc, target, env.gunSpeed, _leadScratch);
    const dirX = aim.x - npc.x;
    const dirY = aim.y - npc.y;
    const len = Math.hypot(dirX, dirY) || 1;

    const w = addSeparation(npc, want((dirX / len) * npc.maxSpeed, (dirY / len) * npc.maxSpeed));
    steerFighter(npc, w.x, w.y, dt, 300);
    faceVelocity(npc);

    if (distToTarget < env.gunRange * 1.1) tryFireFighter(npc, target, dt);
    return;
  }

  // === KOCIOŁ ===
  if (npc.state === 'dogfight3D' && target) {
    if (!npc.sub) npc.sub = 'merge';

    if (npc.sub === 'core') {
      // Zagęszczenie liczymy TYLKO po SOJUSZNIKACH. Wcześniej liczyły się
      // wszystkie myśliwce, więc wróg, którego mamy zabić, sam był powodem do
      // zerwania walki — w kotle 9v7 `neighbors > 3` było prawdą prawie zawsze,
      // a ta gałąź dodatkowo omijała breakOffTimer. Efekt: myśliwce spędzały
      // dogfight na ucieczkach zamiast na strzelaniu.
      let allies = 0;
      const R = 220;
      const RSQ = R * R;
      if (window.queryAIGrid) {
        const __nq = window.queryAIGrid(npc.x, npc.y, R);
        const __nbuf = __nq.buffer;
        const __nn = __nq.count;
        for (let i = 0; i < __nn; i++) {
          const other = __nbuf[i];
          if (!other || other === npc || other.dead) continue;
          if (other === window.ship) continue;
          if (!other.fighter && other.type !== 'fighter' && other.type !== 'interceptor') continue;
          if (window.isEnemyUnit && window.isEnemyUnit(npc, other)) continue;
          const odx = other.x - npc.x;
          const ody = other.y - npc.y;
          if (odx * odx + ody * ody < RSQ) allies++;
        }
      } else {
        const allNpcs = window.npcs || [];
        for (let i = 0; i < allNpcs.length; i++) {
          const other = allNpcs[i];
          if (!other || other === npc || other.dead) continue;
          if (!other.fighter && other.type !== 'fighter' && other.type !== 'interceptor') continue;
          if (window.isEnemyUnit && window.isEnemyUnit(npc, other)) continue;
          const odx = other.x - npc.x;
          const ody = other.y - npc.y;
          if (odx * odx + ody * ody < RSQ) allies++;
        }
      }

      // Cooldown obowiązuje TERAZ w obu przypadkach (ciasno / rutynowy reset),
      // a losowanie jest na sekundę, nie na klatkę.
      const canBreak = npc.dogfightTime > (npc.dogfightMin || env.minCore) && npc.breakOffTimer <= 0;
      if (canBreak && (allies > 4 || Math.random() < 0.22 * dt)) {
        npc.sub = 'break_off';
        npc.subT = env.breakT;
        // Wyjście W BOK z osi ataku, nie ucieczka na wprost od celu. Myśliwiec
        // zostaje w rejonie walki i wraca kolejnym zajściem, zamiast odlatywać
        // na 1.2x maxSpeed przez ~2 s (to właśnie wyglądało jak "zawracanie").
        const awayX = npc.x - tx;
        const awayY = npc.y - ty;
        const L = Math.hypot(awayX, awayY) || 1;
        const side = Math.random() < 0.5 ? 1 : -1;
        const bx = (-awayY / L) * side * 0.85 + (awayX / L) * 0.5;
        const by = (awayX / L) * side * 0.85 + (awayY / L) * 0.5;
        const bl = Math.hypot(bx, by) || 1;
        npc.breakVector = { x: bx / bl, y: by / bl };
      }
    }

    if (npc.sub === 'break_off') {
      const breakVec = npc.breakVector || norm(npc.x - tx, npc.y - ty);
      const w = want(breakVec.x * npc.maxSpeed, breakVec.y * npc.maxSpeed);
      steerFighter(npc, w.x, w.y, dt, 370);
      npc.subT -= dt;
      // Przerwij wcześniej, gdy i tak wypadliśmy z obwiedni — nie ma po co
      // dalej się oddalać.
      if (npc.subT <= 0 || distToTarget > env.dogfightEnter * 1.1) {
        npc.sub = 'merge';
        npc._mergeInit = false;
        npc.breakOffTimer = 3.5;
        npc.dogfightTime = 0;
        npc.dogfightMin = env.minCore * (1.0 + Math.random() * 0.5);
      }
      faceVelocity(npc);
      tryFireFighter(npc, target, dt);
      return;
    }

    if (npc.sub === 'merge') {
      if (!npc._mergeInit) { npc._mergeInit = true; npc.subT = env.mergeT * (0.85 + Math.random() * 0.4); }
      const lead = getLeadAim(npc, target, env.gunSpeed, _leadScratch);
      const dx = lead.x - npc.x;
      const dy = lead.y - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const w = want((dx / len) * npc.maxSpeed, (dy / len) * npc.maxSpeed);
      steerFighter(npc, w.x, w.y, dt, 400);
      npc.subT -= dt;
      if (npc.subT <= 0 || distToTarget < env.gunRange * 0.3) {
        npc.sub = 'slash';
        npc.subT = env.slashT;
        npc._slashSign = Math.random() > 0.5 ? 1 : -1;
      }
    }
    else if (npc.sub === 'slash') {
      const dx = tx - npc.x;
      const dy = ty - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const px = -ny * npc._slashSign;
      const py = nx * npc._slashSign;

      const w = want(
        (nx * 0.85 + px * 0.45) * npc.maxSpeed,
        (ny * 0.85 + py * 0.45) * npc.maxSpeed
      );
      steerFighter(npc, w.x, w.y, dt, 450);
      npc.subT -= dt;
      if (npc.subT <= 0) { npc.sub = 'core'; npc._mergeInit = false; }
    }
    else if (npc.sub === 'core') {
      const aim = getLeadAim(npc, target, env.gunSpeed, _leadScratch);
      const dx = aim.x - npc.x;
      const dy = aim.y - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const wantVx = (dx / len) * npc.maxSpeed;
      const wantVy = (dy / len) * npc.maxSpeed;
      const timeNow = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
      const idNum = _npcIdNum(npc.id);
      const t = timeNow + (idNum % 17) * 0.13;
      const jrad = (4 * Math.PI / 180) * Math.sin(2 * Math.PI * 0.5 * t);
      const c = Math.cos(jrad);
      const s = Math.sin(jrad);
      const jvx = wantVx * c - wantVy * s;
      const jvy = wantVx * s + wantVy * c;
      // Swirl: lekkie krążenie wokół celu, żeby dwa myśliwce nie zbiegły się w
      // idealnie ten sam punkt. Wchodzi do wektora żądanego, więc nie łamie
      // limitu prędkości ani modelu przyspieszenia.
      const swirl = Math.sin(timeNow * 2.0 + idNum * 0.37) * 0.10;
      const mag = Math.hypot(jvx, jvy) || 1;
      let wx = jvx + (-jvy / mag) * npc.maxSpeed * swirl;
      let wy = jvy + (jvx / mag) * npc.maxSpeed * swirl;

      // Zbyt blisko — dołóż składową styczną, żeby obejść cel zamiast w niego
      // wlecieć. Skalowane prędkością (stałe 110 u/s przy 2800 u/s nic nie robi).
      const tooClose = Math.max(120, npc.maxSpeed * 0.06);
      if (distToTarget < tooClose) {
        const distSafe = Math.max(1, distToTarget);
        wx += (-(ty - npc.y) / distSafe) * npc.maxSpeed * 0.45;
        wy += ((tx - npc.x) / distSafe) * npc.maxSpeed * 0.45;
      }

      steerFighter(npc, wx, wy, dt, 370);
    }

    faceVelocity(npc);
    tryFireFighter(npc, target, dt);
    return;
  }

  // === NALOT NA DUŻY CEL ===
  if (npc.state === 'bombing' && target) {
    const targetR = target.radius || 50;
    // Porównanie po referencji: target.id bywa undefined, a `undefined !==
    // undefined` jest false, więc wektor nalotu nie odświeżał się po zmianie celu.
    if (!npc.bombardVec || npc.__bombTarget !== target) {
      const a = Math.random() * Math.PI * 2;
      npc.bombardVec = { x: Math.cos(a), y: Math.sin(a) };
      npc.bombardSide = 1;
      npc.__bombTarget = target;
    }
    const lineLen = env.gunRange * 1.1 + targetR;
    // Promień zawrotki musi pomieścić łuk przy obecnej prędkości, inaczej
    // myśliwiec zawraca w kółko przed dziobem celu.
    const flipR = Math.max(260, npc.maxSpeed * 0.32) + targetR;

    let wayX = tx + npc.bombardVec.x * lineLen * npc.bombardSide;
    let wayY = ty + npc.bombardVec.y * lineLen * npc.bombardSide;
    if (Math.hypot(wayX - npc.x, wayY - npc.y) < flipR) {
      npc.bombardSide *= -1;
      wayX = tx + npc.bombardVec.x * lineLen * npc.bombardSide;
      wayY = ty + npc.bombardVec.y * lineLen * npc.bombardSide;
    }

    const dx = wayX - npc.x;
    const dy = wayY - npc.y;
    const len = Math.hypot(dx, dy) || 1;

    const w = addSeparation(npc, want((dx / len) * npc.maxSpeed, (dy / len) * npc.maxSpeed));
    steerFighter(npc, w.x, w.y, dt, 280);

    if (distToTarget < env.gunRange) {
      npc.desiredAngle = Math.atan2(ty - npc.y, tx - npc.x);
    } else {
      faceVelocity(npc);
    }

    tryFireFighter(npc, target, dt);
    return;
  }

  // === BRAK CELU: FORMACJA / POWRÓT ===
  let leader = null;
  if (npc.squad && npc.squad.leader && !npc.squad.leader.dead) {
    leader = npc.squad.leader;
  } else if (npc.supportData) {
    leader = npc.supportData.leader;
  }

  if (!leader && !npc.guardStation) {
    const home = npc.friendly ? window.ship : null;

    // Friendly fighters return to player ship; enemies chase player ship
    const chaseTarget = home?.pos ? home : (!npc.friendly && window.ship?.pos ? window.ship : null);
    if (chaseTarget?.pos) {
      const dx = chaseTarget.pos.x - npc.x;
      const dy = chaseTarget.pos.y - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const wantSpeed = Math.min(npc.maxSpeed * (npc.friendly ? 0.75 : 1.0), len * 1.4);
      steerFighter(npc, (dx / len) * wantSpeed, (dy / len) * wantSpeed, dt, 240);
      faceVelocity(npc);
    } else {
      npc.vx *= 0.995;
      npc.vy *= 0.995;
    }
    return;
  }

  const isLeader = (leader === npc);
  let targetPos = null;

  if (isLeader && npc.isPirate && npc.guardStation) {
    const time = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const radius = npc.guardOrbitRadius || 350;
    const speed = npc.guardOrbitSpeed || 0.3;
    const phase = npc.guardPhase || 0;
    const angle = phase + (time * speed);
    targetPos = {
      x: npc.guardStation.x + Math.cos(angle) * radius,
      y: npc.guardStation.y + Math.sin(angle) * radius
    };
    const tangentAngle = angle + (speed > 0 ? Math.PI / 2 : -Math.PI / 2);
    npc.desiredAngle = tangentAngle;
  }
  else if (leader && !isLeader) {
    const offset = npc.formationOffset || { x: 0, y: 0 };
    const la = leader.angle || 0;
    const c = Math.cos(la);
    const s = Math.sin(la);
    const lx = (leader.pos && leader.pos.x !== undefined) ? leader.pos.x : leader.x;
    const ly = (leader.pos && leader.pos.y !== undefined) ? leader.pos.y : leader.y;
    targetPos = {
      x: lx + (offset.x * c - offset.y * s),
      y: ly + (offset.x * s + offset.y * c)
    };
  }
  else if (isLeader) {
    if (!window.ship?.pos) return;
    const pdx = window.ship.pos.x - npc.x;
    const pdy = window.ship.pos.y - npc.y;
    const plen = Math.hypot(pdx, pdy) || 1;
    // Dawniej sztywne 150 u/s — przy skali świata (1 AU = 3000 u) lider
    // dolatywał do gracza szybciej pieszo.
    const wantSpeed = Math.min(npc.maxSpeed * 0.6, plen * 1.2);
    steerFighter(npc, (pdx / plen) * wantSpeed, (pdy / plen) * wantSpeed, dt, 240);
    faceVelocity(npc);
    return;
  }

  if (targetPos) {
    const dx = targetPos.x - npc.x;
    const dy = targetPos.y - npc.y;
    const distToSpot = Math.hypot(dx, dy);
    const len = distToSpot || 1;
    const kp = isLeader ? 2.0 : 3.0;
    const currentMax = isLeader ? (npc.maxSpeed * 0.6) : npc.maxSpeed;
    const wantSpeed = Math.min(currentMax, distToSpot * kp);

    const w = addSeparation(npc, want((dx / len) * wantSpeed, (dy / len) * wantSpeed));
    steerFighter(npc, w.x, w.y, dt, 260);

    // Poprzednio całe ustawianie kursu było pod `if (!Number.isFinite(desiredAngle))`,
    // a desiredAngle zostaje ustawiony przy pierwszej walce i już nigdy nie
    // wraca do NaN — więc myśliwce w formacji trzymały na zawsze ostatni kurs
    // bojowy i leciały bokiem. Kurs aktualizujemy zawsze.
    if (distToSpot > 60) {
      faceVelocity(npc);
    } else if (leader && !isLeader && Number.isFinite(leader.angle)) {
      npc.desiredAngle = leader.angle;
    } else if (!isLeader || !npc.guardStation) {
      faceVelocity(npc);
    }
  }
}

if (typeof window !== 'undefined') {
  window.runAdvancedFighterAI = runAdvancedFighterAI;
  // Używane też przez supportGuardBehavior w index.html, żeby powrót do
  // formacji korzystał z tego samego modelu przyspieszenia co walka.
  window.steerFighter = steerFighter;
  window.fighterEnvelope = fighterEnvelope;
}
