// Złote wzorce jąder sąsiedztwa AI SPRZED migawki (2026-10-07) — dosłowne kopie kodu z commitu aad43f8:
// index.html (isNpcCombatActive … applySeparationForces), src/ai/aiSpatialGrid.js (siatka na Map ze stemplami
// na obiektach), src/ai/capitalAI.js (computeTrafficAvoidance, capitalObstacleSpeedCap). tests/aiNeighborSnapshot.test.mjs porównuje z nimi
// nowe ścieżki (migawka w tablicach typowanych) bit w bit. Nie poprawiać tych tekstów — to punkt odniesienia,
// nie kod gry (wygenerowane ze źródeł commitu, bez zmian).

import { spatialCellKey } from '../../src/game/spatialCellKey.js';

const GRID_SOURCE = `const CELL_SIZE = 600;
const INV_CELL = 1 / CELL_SIZE;

// Reusable storage:
//  cells: Map<key, entity[]>  — cell arrays reused, not realloc'd
//  result: Entity[]           — single shared result buffer
const cells = new Map();
const result = [];
let resultCount = 0;
const queryResponse = { buffer: result, count: 0 };
let nextQueryId = 1;
const activeCells = [];
const activeEntities = [];
const friendlyEntities = [];
const nonFriendlyEntities = [];
const pirateEntities = [];
let factionPoolsReady = false;

function registerInCell(entity, cx, cy) {
  const key = spatialCellKey(cx, cy);
  let arr = cells.get(key);
  if (!arr) {
    arr = [];
    cells.set(key, arr);
  }
  if (arr.length === 0) activeCells.push(arr);
  arr.push(entity);
}

function rebuildAIGrid(entityList, includePlayer) {
  // Czyścimy wyłącznie komórki aktywne w poprzednim cyklu. Jednostki mogą
  // przemierzać cały układ, więc skanowanie wszystkich historycznych wpisów Map
  // sprawiałoby, że koszt clear() rósł wraz z długością sesji.
  for (let i = 0; i < activeCells.length; i++) activeCells[i].length = 0;
  activeCells.length = 0;
  activeEntities.length = 0;
  friendlyEntities.length = 0;
  nonFriendlyEntities.length = 0;
  pirateEntities.length = 0;

  if (entityList && entityList.length) {
    for (let i = 0; i < entityList.length; i++) {
      const e = entityList[i];
      if (!e || e.dead) continue;
      activeEntities.push(e);
      if (e.friendly === true) friendlyEntities.push(e);
      else nonFriendlyEntities.push(e);
      if (e.isPirate === true) pirateEntities.push(e);
      const cx = Math.floor(e.x * INV_CELL);
      const cy = Math.floor(e.y * INV_CELL);
      registerInCell(e, cx, cy);
    }
  }

  if (includePlayer && typeof window !== 'undefined' && window.ship && !window.ship.dead && !window.ship.destroyed) {
    const ship = window.ship;
    const sx = ship.pos?.x ?? ship.x ?? 0;
    const sy = ship.pos?.y ?? ship.y ?? 0;
    const cx = Math.floor(sx * INV_CELL);
    const cy = Math.floor(sy * INV_CELL);
    registerInCell(ship, cx, cy);
  }
  factionPoolsReady = true;
}

// Listy są własnością grida i pozostają ważne do następnego rebuildAIGrid().
// Wywołujący nie może ich mutować. Dają szczególnie duży zysk w asymetrycznych
// bitwach (np. 85 sojuszników kontra 3 wrogów), bo skanują tylko przeciwną stronę.
function getAIOpposingCandidates(entity) {
  if (!factionPoolsReady) return null;
  if (entity?.friendly === true) return nonFriendlyEntities;
  if (entity?.friendly === false || entity?.isPirate === true) return friendlyEntities;
  return activeEntities;
}

function getAIFriendlyCandidates() {
  return factionPoolsReady ? friendlyEntities : null;
}

function getAIPirateCandidates() {
  return factionPoolsReady ? pirateEntities : null;
}

// Returns shared result buffer + count. CALLER MUST consume immediately
// (next call invalidates the buffer). Zero allocation per query.
//
// For HUGE query radii (span > 8 cells, e.g. aiPickBestTarget at 20000u or
// long-range capital weapons), iterating the full per-cell box would do
// thousands of empty map lookups — strictly slower than just returning
// the full entity list. In that case we bail to "iterate all populated
// cells" which is O(N) over real entities and matches the old O(N) scan.
function queryAIGrid(x, y, radius) {
  resultCount = 0;
  const extent = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  const minCx = Math.floor((x - extent) * INV_CELL);
  const maxCx = Math.floor((x + extent) * INV_CELL);
  const minCy = Math.floor((y - extent) * INV_CELL);
  const maxCy = Math.floor((y + extent) * INV_CELL);
  const queryId = nextQueryId++;

  if ((maxCx - minCx) > 16 || (maxCy - minCy) > 16) {
    // Full-list path: dump all populated cells. Caller will still range-check
    // each candidate, so the only cost vs. the targeted path is one extra
    // pass over irrelevant entities. Same complexity as the old O(N) scan.
    for (let cellIndex = 0; cellIndex < activeCells.length; cellIndex++) {
      const arr = activeCells[cellIndex];
      for (let i = 0; i < arr.length; i++) {
        const entity = arr[i];
        if (entity._aiGridQueryId === queryId) continue;
        entity._aiGridQueryId = queryId;
        result[resultCount++] = entity;
      }
    }
    if (result.length > resultCount) result.length = resultCount;
    queryResponse.count = resultCount;
    return queryResponse;
  }

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const key = spatialCellKey(cx, cy);
      const arr = cells.get(key);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const entity = arr[i];
        if (entity._aiGridQueryId === queryId) continue;
        entity._aiGridQueryId = queryId;
        result[resultCount++] = entity;
      }
    }
  }
  // Trim residual stale references past the active count to allow GC.
  // Keep buffer length at exactly resultCount so callers using .length see right size.
  if (result.length > resultCount) result.length = resultCount;
  queryResponse.count = resultCount;
  return queryResponse;
}`;

const AVOIDANCE_SOURCE = `const AVOID_HORIZON = 2.5;
const AVOID_PAD = 140;
const AVOID_MAX_ACCEL = 900;
const AVOID_RANGE_MAX = 6000;
const _avoid = { ax: 0, ay: 0 };
function computeTrafficAvoidance(npc, out = _avoid) {
  out.ax = 0;
  out.ay = 0;
  const query = window.queryAIGrid;
  if (typeof query !== 'function') return out;
  const vx = Number(npc.vx) || 0;
  const vy = Number(npc.vy) || 0;
  const myR = Number(npc.radius) || 60;
  const myMass = Math.max(1, Number(npc.mass) || 1);
  const sp = Math.sqrt(vx * vx + vy * vy);
  const range = Math.min(AVOID_RANGE_MAX, myR + 600 + (sp + 1500) * AVOID_HORIZON);
  const ship = window.ship;
  const q = query(npc.x, npc.y, range);
  const buf = q.buffer;
  const n = q.count;
  for (let i = 0; i < n; i++) {
    const o = buf[i];
    if (!o || o === npc || o === ship || o.dead || o.fighter) continue;
    const rx = (Number(o.x) || 0) - npc.x;
    const ry = (Number(o.y) || 0) - npc.y;
    const rvx = (Number(o.vx) || 0) - vx;
    const rvy = (Number(o.vy) || 0) - vy;
    const vv = rvx * rvx + rvy * rvy;
    if (vv < 900) continue; // < 30 j/s względem siebie — to robota separacji
    const t = -(rx * rvx + ry * rvy) / vv;
    if (t <= 0 || t > AVOID_HORIZON) continue;
    const cx = rx + rvx * t;
    const cy = ry + rvy * t;
    const d = Math.sqrt(cx * cx + cy * cy);
    const safe = myR + (Number(o.radius) || 60) + AVOID_PAD;
    if (d >= safe) continue;
    // W bok od miejsca, w którym będzie sąsiad. Czołowo (d ≈ 0) — reguła prawej
    // ręki względem prędkości względnej: obaj schodzą w przeciwne strony.
    let ux;
    let uy;
    if (d > 1) {
      ux = -cx / d;
      uy = -cy / d;
    } else {
      const L = Math.sqrt(vv);
      ux = -rvy / L;
      uy = rvx / L;
    }
    const tt = Math.max(0.35, t);
    const oMass = Math.max(1, Number(o.mass) || myMass);
    const a = ((2 * (safe - d)) / (tt * tt)) * (2 * oMass / (oMass + myMass));
    out.ax += ux * a;
    out.ay += uy * a;
  }
  const mag = Math.sqrt(out.ax * out.ax + out.ay * out.ay);
  if (mag > AVOID_MAX_ACCEL) {
    out.ax *= AVOID_MAX_ACCEL / mag;
    out.ay *= AVOID_MAX_ACCEL / mag;
  }
  return out;
}`;

const SEPARATION_SOURCE = `function isNpcCombatActive(npc) {
  return !!(
    npc &&
    (
      npc.forceTarget ||
      npc.target ||
      npc.state === 'engage_formation' ||
      npc.state === 'dogfight3D' ||
      npc.state === 'bombing'
    )
  );
}

function clampVecLen(x, y, maxLen) {
  const len = Math.hypot(x, y);
  if (len <= maxLen || len <= 1e-6) return { x, y };
  const s = maxLen / len;
  return { x: x * s, y: y * s };
}

let __sepUidCounter = 0;
function sepUid(u) {
  if (u.__sepUid === undefined) u.__sepUid = ++__sepUidCounter;
  return u.__sepUid;
}

function sepPriority(u) {
  if (u === window.ship) return 1e9; // gracz zawsze ma pierwszeństwo
  let p = Math.max(1, u.mass || 1);
  if (isNpcCombatActive(u)) p *= 1.5; // atakujący przepycha
  return p;
}

function sepYieldFactor(npc, other) {
  const pa = sepPriority(npc);
  const pb = sepPriority(other);
  if (pa < pb * 0.98) return 1.7;
  if (pa > pb * 1.02) return 0.3;
  return sepUid(npc) <= sepUid(other) ? 1.7 : 0.3; // remis → stały rozjazd
}

function shieldPairStandoff(a, b) {
  const read = (e) => {
    if (!e) return 0;
    const progress = Number(getEntityShieldBlockingProgress(e)) || 0;
    if (progress <= 0) return 0;
    return (Number(getEntityShieldBaseRadius(e)) || 0) * progress;
  };
  return read(a) + read(b);
}

function applySeparationForces(npc, ax, ay) {
  // Separacja jest decyzją AI, więc przeliczamy ją raz na tick AI (20 Hz),
  // a pomiędzy decyzjami reużywamy ostatni wektor. Wynik również ma stały
  // obiekt per NPC, żeby gorąca ścieżka nie produkowała śmieci dla GC.
  if (npc.__sepDecisionTick === aiDecisionTickId && npc.__sepVec) {
    const cachedResult = npc.__sepResult || (npc.__sepResult = { ax: 0, ay: 0 });
    cachedResult.ax = npc.__sepVec.x + (ax || 0);
    cachedResult.ay = npc.__sepVec.y + (ay || 0);
    return cachedResult;
  }
  const tSep0 = (typeof performance !== 'undefined') ? performance.now() : 0;
  const myRadius = npc.radius || 20;
  const myMass = Math.max(1, npc.mass || 1);
  const inCombat = isNpcCombatActive(npc);
  const myFighter = !!npc.fighter;
  const myCapital = !!npc.isCapitalShip || !myFighter;

  // Siła separacji jako AKCELERACJA. Dawny podział przez pełną masę zerował
  // separację capitali (masa 10k-50k → ~0 u/s² — stąd taranowanie).
  // Fighterów (masa <=2) nie ruszamy — zachowują dokładnie stare siły.
  const myGain = myMass <= 2 ? (1 / myMass) : (1 / Math.pow(myMass, 0.25));

  // Predykcja zbliżenia dla dużych: pchamy zanim strefy się nałożą,
  // proporcjonalnie do prędkości zbliżania (max wydłużenie strefy 420u).
  const LOOKAHEAD_T = 0.85;
  const LOOKAHEAD_MAX = 420;

  let sumAx = ax || 0;
  let sumAy = ay || 0;

  // Spatial grid query — typical 5-15 candidates vs 200 in old O(N) scan.
  // Fighters: 450 covers worst-case safeDistance (myRadius + otherRadius~250 + margin 140).
  // Capitals: 900, bo strefa + look-ahead sięga ~880u.
  const QUERY_RADIUS = myCapital ? 900 : 450;
  let __sepCandidates = null;
  let __sepCandCount = 0;
  if (window.queryAIGrid) {
    const __q = window.queryAIGrid(npc.x, npc.y, QUERY_RADIUS);
    __sepCandidates = __q.buffer;
    __sepCandCount = __q.count;
  } else {
    __sepCandidates = npcs;
    __sepCandCount = npcs.length;
  }

  for (let __si = 0; __si < __sepCandCount; __si++) {
    const other = __sepCandidates[__si];
    if (!other || other === npc || other.dead) continue;
    // Grid may include window.ship — skip here, handled by player block below.
    if (other === window.ship) continue;
    // Once metal touches, the destructor owns the response. AI avoidance
    // inside the crushed hull would add an independent repulsive force.
    if (HullBodies.hasContact(npc, other)) continue;

    const enemy = window.isEnemyUnit
      ? window.isEnemyUnit(npc, other)
      : (!!npc.friendly !== !!other.friendly);

    const otherFighter = !!other.fighter;
    const otherCapital = !!other.isCapitalShip || !otherFighter;

    const dx = npc.x - other.x;
    const dy = npc.y - other.y;
    const distSq = dx * dx + dy * dy;
    const otherRadius = other.radius || 20;

    // 1) Wróg-vs-wróg fighter NIE może robić force-fielda.
    // Dajemy tylko minimalny anti-overlap, żeby sprite'y się nie nakładały 1:1.
    if (enemy && myFighter && otherFighter) {
      const safeDistance = myRadius + otherRadius + 10;
      if (distSq < safeDistance * safeDistance) {
        const dist = Math.sqrt(distSq) || 1;
        const overlap = safeDistance - dist;
        const force = overlap * 6.0 * myGain;
        sumAx += (dx / dist) * force;
        sumAy += (dy / dist) * force;
      }
      continue;
    }

    let strength = 0;
    let sepMargin = 0;
    // Luz dla par z udziałem dużego okrętu — skalowany od sumy promieni,
    // żeby dwa battleshipy (radius 140) miały realny odstęp, a nie 36-70u.
    const bigPairMargin = Math.max(70, (myRadius + otherRadius) * 0.6);

    // 2) Sojusznicy trzymają odstęp, ale dużo mniejszy niż teraz.
    if (!enemy && myFighter && otherFighter) {
      sepMargin = inCombat ? 22 : 46;
      strength = inCombat ? 8.0 : 12.0;
    }
    // 3) Sojusznicy duzi / mieszani — dla dwóch battleshipów (radius 140)
    //    margines 70 to ledwie 70u luzu, stąd obijanie; rozszerzamy.
    else if (!enemy) {
      sepMargin = bigPairMargin;
      strength = 12.0;
    }
    // 4) Kontakt z capitalami wroga — margines 36 był absurdalnie mały
    //    dla okrętów o promieniu 140.
    else if (myCapital || otherCapital) {
      sepMargin = bigPairMargin;
      strength = 13.0;
    }
    else {
      continue;
    }

    // Margines liczymy PONAD większy z dwóch obrysów: kadłub albo tarcza.
    // Tarcza nie jest ścianą (patrz shieldPairStandoff) — to bufor, żeby
    // sojusznicze kadłuby nie ocierały się o siebie.
    const safeDistance = Math.max(
      myRadius + otherRadius,
      shieldPairStandoff(npc, other)
    ) + sepMargin;

    const bigPair = myCapital || otherCapital;
    const reach = bigPair ? (safeDistance + LOOKAHEAD_MAX) : safeDistance;
    if (distSq < reach * reach) {
      const dist = Math.sqrt(distSq) || 1;
      let overlap = safeDistance - dist;
      if (bigPair) {
        // Prędkość zbliżania (na kursie kolizyjnym).
        const relVx = (npc.vx || 0) - (other.vx || 0);
        const relVy = (npc.vy || 0) - (other.vy || 0);
        const closing = -(relVx * dx + relVy * dy) / dist;
        if (overlap <= 0 && closing > 40) {
          const predicted = dist - Math.min(closing * LOOKAHEAD_T, LOOKAHEAD_MAX);
          if (predicted < safeDistance) {
            overlap = (safeDistance - predicted) * 0.6;
          }
        }
        // Styczny nudge: przy niemal czołowym zbliżeniu dwóch dużych okrętów
        // dołóż boczny impuls, żeby MINĘŁY się bokiem, a nie stanęły dziób w
        // dziób / weszły w siebie. Strona = commit do bieżącego dryfu.
        if (closing > 60) {
          let perpX = -dy / dist;
          let perpY = dx / dist;
          const along = perpX * (npc.vx || 0) + perpY * (npc.vy || 0);
          if (along < 0) { perpX = -perpX; perpY = -perpY; }
          const prox = 1 - Math.min(1, dist / reach);
          // Pierwszeństwo: lżejszy/nieaktywny ustępuje (×1.7), drugi trzyma kurs (×0.3).
          const yf = sepYieldFactor(npc, other);
          const slide = Math.min(closing, 400) * strength * myGain * 0.30 * prox * yf;
          sumAx += perpX * slide;
          sumAy += perpY * slide;
        }
      }
      if (overlap > 0) {
        const force = overlap * strength * myGain;
        sumAx += (dx / dist) * force;
        sumAy += (dy / dist) * force;
      }
    }
  }

  // --- Separacja od gracza / capitala ---
  if (window.ship && !window.ship.destroyed && npc !== window.ship &&
      !HullBodies.hasContact(npc, window.ship)) {
    const player = window.ship;
    const dx = npc.x - player.pos.x;
    const dy = npc.y - player.pos.y;
    const distSq = dx * dx + dy * dy;

    let strength = 0;
    let sepMargin = 0;

    if (npc.friendly) {
      // Friendly fighter w walce może podejść bliżej do własnego capitala.
      sepMargin = inCombat ? 40 : 140;
      strength = inCombat ? 10.0 : 28.0;
    } else {
      sepMargin = 80;
      strength = 12.0;
    }

    // Ta sama zasada co przy parach NPC: odstęp od większego z obrysów
    // (kadłub / tarcza). Tarcza gracza nie odbija już niczego — bufor
    // trzyma cudze kadłuby z dala od jego pancerza.
    const safeDistance = Math.max(
      myRadius + (player.radius || 220),
      shieldPairStandoff(npc, player)
    ) + sepMargin;

    const reach = safeDistance + LOOKAHEAD_MAX;
    const dist = Math.sqrt(distSq) || 1;
    const relVx = (npc.vx || 0) - (Number(player.vel?.x) || 0);
    const relVy = (npc.vy || 0) - (Number(player.vel?.y) || 0);

    // Bliskie pole: radialne odpychanie (anty-overlap + look-ahead).
    if (dist < reach) {
      const closing = -(relVx * dx + relVy * dy) / dist; // >0 = zbliżają się
      let overlap = safeDistance - dist;
      if (overlap <= 0 && closing > 40) {
        const predicted = dist - Math.min(closing * LOOKAHEAD_T, LOOKAHEAD_MAX);
        if (predicted < safeDistance) {
          overlap = (safeDistance - predicted) * 0.6;
        }
      }
      if (overlap > 0) {
        const force = overlap * strength * myGain;
        sumAx += (dx / dist) * force;
        sumAy += (dy / dist) * force;
      }
    }

    // PROAKTYWNY UNIK (tylko sojusznicy — wróg nie „grzecznie ustępuje").
    // Najbliższe zbliżenie (CPA): jeśli gracz przetnie naszą strefę w ciągu
    // horyzontu, ODSUWAMY SIĘ W BOK już teraz — im bliżej momentu CPA, tym
    // mocniej (kinematyka s=½at²). Zasięg 2600, żeby szykowali unik WCZEŚNIE.
    const DODGE_RANGE = 2600;
    if (npc.friendly && dist < DODGE_RANGE) {
      const vv = relVx * relVx + relVy * relVy;
      if (vv > 400) { // istotny ruch względny (>20 u/s)
        const tCPA = Math.max(0, -((dx * relVx + dy * relVy) / vv));
        const T_HORIZON = 3.2;
        if (tCPA < T_HORIZON) {
          const cpaX = dx + relVx * tCPA;
          const cpaY = dy + relVy * tCPA;
          const dCPA = Math.hypot(cpaX, cpaY);
          const threat = safeDistance + 140;
          if (dCPA < threat) {
            // Prostopadle do względnej prędkości, w stronę większego prześwitu.
            let perpX = -relVy;
            let perpY = relVx;
            const L = Math.hypot(perpX, perpY) || 1;
            perpX /= L; perpY /= L;
            const refX = dCPA > 1 ? cpaX : dx;
            const refY = dCPA > 1 ? cpaY : dy;
            if (perpX * refX + perpY * refY < 0) { perpX = -perpX; perpY = -perpY; }
            const deficit = threat - dCPA;
            const tSafe = Math.max(0.5, tCPA);
            let aNeeded = (2 * deficit) / (tSafe * tSafe);
            aNeeded = Math.min(aNeeded, 620);
            const dodge = aNeeded * sepYieldFactor(npc, player);
            sumAx += perpX * dodge;
            sumAy += perpY * dodge;
          }
        }
      }
    }
  }

  // Limit całkowitej separacji, żeby duży rój nie tworzył stabilnego "muru".
  // Capitale dostają wyższy limit (560), bo ciąg kontrolera arrive sięga ~380
  // i przy 320 separacja przegrywała — okręty wtapiały się w siebie mimo AI.
  const maxAccel = npc.fighter
    ? (inCombat ? 180 : 240)
    : 560;

  const clamped = clampVecLen(sumAx, sumAy, maxAccel);

  if (typeof performance !== 'undefined') {
    const __sepDt = performance.now() - tSep0;
    window.__aiSepMs = (window.__aiSepMs || 0) + __sepDt;
  }

  // Zapamiętaj czystą separację (base ax/ay = 0 u wszystkich callerów) na ten tick AI.
  npc.__sepDecisionTick = aiDecisionTickId;
  if (npc.__sepVec) { npc.__sepVec.x = clamped.x; npc.__sepVec.y = clamped.y; }
  else npc.__sepVec = { x: clamped.x, y: clamped.y };

  const result = npc.__sepResult || (npc.__sepResult = { ax: 0, ay: 0 });
  result.ax = clamped.x + (ax || 0);
  result.ay = clamped.y + (ay || 0);
  return result;
}`;

const OBSTACLE_SOURCE = `const clampNum = (v, min, max) => Math.max(min, Math.min(max, v));

const OBSTACLE_LOOK_MIN = 1500;
const OBSTACLE_LOOK_MAX = 20000;
const _obsScratch = { on: false, x: 0, y: 0, vx: 0, vy: 0, c: 0, along: Infinity };
let _obsCap = Infinity;
function considerObstacle(npc, o, ox, oy, oR, d1x, d1y, d2x, d2y, has2, look, brake, blk) {
  const rx = ox - npc.x;
  const ry = oy - npc.y;
  const clearance = (npc.radius || 100) + oR + 150;
  let along = rx * d1x + ry * d1y;
  if (along > 0 && along <= look) {
    const perp = Math.abs(-rx * d1y + ry * d1x);
    if (perp <= clearance) {
      const v = Math.sqrt(2 * brake * Math.max(0, along - clearance));
      if (v < _obsCap) _obsCap = v;
      if (along < blk.along) {
        blk.on = true;
        blk.x = ox;
        blk.y = oy;
        blk.vx = Number(o.vel?.x ?? o.vx) || 0;
        blk.vy = Number(o.vel?.y ?? o.vy) || 0;
        blk.c = clearance;
        blk.along = along;
      }
    }
  }
  if (has2) {
    along = rx * d2x + ry * d2y;
    if (along > 0 && along <= look) {
      const perp = Math.abs(-rx * d2y + ry * d2x);
      if (perp <= clearance) {
        const v = Math.sqrt(2 * brake * Math.max(0, along - clearance));
        if (v < _obsCap) _obsCap = v;
      }
    }
  }
}
function capitalObstacleSpeedCap(npc, d1x, d1y, d2x, d2y, spec, fresh = false) {
  const fid = window.__frameId;
  if (!fresh && fid && npc.__obsCapFid === fid && npc.__obsCapVal !== undefined) return npc.__obsCapVal;

  const brake = spec ? spec.decel * 0.85 : 420;
  const speed = Math.hypot(npc.vx || 0, npc.vy || 0);
  const look = clampNum((speed * speed) / (2 * brake) + 600, OBSTACLE_LOOK_MIN, OBSTACLE_LOOK_MAX);
  const has2 = Number.isFinite(d2x) && (d2x !== 0 || d2y !== 0);
  const blk = fresh ? _obsScratch : (npc.__obsBlk || (npc.__obsBlk = { on: false, x: 0, y: 0, vx: 0, vy: 0, c: 0, along: Infinity }));
  blk.on = false;
  blk.along = Infinity;
  _obsCap = Infinity;
  const ship = window.ship;
  if (ship && !ship.destroyed && ship.pos) {
    considerObstacle(npc, ship, ship.pos.x, ship.pos.y, ship.radius || 220, d1x, d1y, d2x, d2y, has2, look, brake, blk);
  }
  if (window.queryAIGrid) {
    const q = window.queryAIGrid(npc.x, npc.y, look);
    const buf = q.buffer;
    const n = q.count;
    for (let i = 0; i < n; i++) {
      const o = buf[i];
      if (!o || o === npc || o.dead || o === ship || o.fighter) continue;
      considerObstacle(npc, o, o.x, o.y, o.radius || 100, d1x, d1y, d2x, d2y, has2, look, brake, blk);
    }
  }
  const cap = _obsCap;
  if (!fresh && fid) { npc.__obsCapFid = fid; npc.__obsCapVal = cap; }
  return cap;
}`;

/** Dawna siatka AI; `win` zastępuje window (gracz: win.ship). */
export function createReferenceGrid(win) {
  return new Function('spatialCellKey', 'window', GRID_SOURCE + '\nreturn { rebuildAIGrid, queryAIGrid };')(spatialCellKey, win);
}

/** Dawny computeTrafficAvoidance; czyta win.queryAIGrid i win.ship. */
export function createReferenceAvoidance(win) {
  return new Function('window', AVOIDANCE_SOURCE + '\nreturn computeTrafficAvoidance;')(win);
}

/** Dawny capitalObstacleSpeedCap; czyta win.__frameId, win.ship, win.queryAIGrid. */
export function createReferenceObstacleCap(win) {
  return new Function('window', OBSTACLE_SOURCE + '\nreturn capitalObstacleSpeedCap;')(win);
}

/**
 * Dawna separacja z pomocnikami. Zakres (żywy): window, npcs, HullBodies, aiDecisionTickId,
 * getEntityShieldBlockingProgress, getEntityShieldBaseRadius, performance.
 */
export function createReferenceSeparation(scope) {
  return new Function('__scope', 'with (__scope) {\n' + SEPARATION_SOURCE + '\nreturn { applySeparationForces, sepUid };\n}')(scope);
}
