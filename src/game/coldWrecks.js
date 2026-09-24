/**
 * Zimne wraki — trzeci stan wraku („tło”), obok gorącego i śpiącego.
 *
 * Po bitwie 174 okrętów zostaje ~426 wraków. Uśpiony wrak (`_wreckSleeping`)
 * nadal siedzi w sześciu listach: pętla wraków w physicsStep, siatka pocisków,
 * pętla budzenia destruktora, lista encji 3D, budżet areny heksów i graf sceny.
 * Zimny wrak nie jest w ŻADNEJ z nich: nie ma hexGrid (heksy wróciły do areny,
 * stan siatki żyje w zrzucie — captureHexBodySnapshot), nie ma meshy, stoi
 * w miejscu i jest duchem dla okrętów i pocisków. Rysuje go tylko batch smug.
 *
 * To TEN SAM obiekt JS co przed zamrożeniem — łup (`_salvage`), ładunek
 * (`_cargoManifest`), `_wreckAge`, sprawca i historia zostają. Wymieniamy tylko
 * hexGrid i listy. Zimny nie znaczy „do recyklingu”: ładunek i złom zostają.
 *
 * Zamrażanie jest automatyczne i konserwatywne (isFreezeCandidate), budzenie
 * WYŁĄCZNIE jawne (thaw): holowanie, cięcie, rozkaz, konsola. Budzenie na
 * zbliżenie odtworzyłoby dzisiejszą pętlę budzenia O(śpiące × aktywne).
 *
 * Moduł nie zna index.html: listy i zapytania o stan gry dostaje w opcjach
 * createColdWreckSystem, więc da się go sprawdzić w node (tests/coldWrecks.test.mjs).
 */

import {
  DESTRUCTOR_CONFIG,
  DestructorSystem,
  captureHexBodySnapshot,
  disposeHexBody,
  initHexBodyFromSnapshot
} from './destructor.js';

export const COLD_WRECK_CONFIG = Object.freeze({
  // Sen bez przerwy i cisza po ostatnim trafieniu/kontakcie [s czasu gry].
  afterSec: 20,
  // Żadnego obudzonego ciała (żywe okręty, gorące wraki, gracz) bliżej [j.].
  clearRadius: 2500,
  // Skan kandydatów [s], jak enforceWreckHexBudget.
  scanIntervalSec: 0.5,
  // Zamrożeń na klatkę — setki wraków po bitwie rozkładają się na klatki.
  freezePerFrame: 4,
  // Prób na klatkę (kandydat mógł przestać spełniać warunki od skanu).
  freezeAttemptsPerFrame: 16,
  // Odmrożeń na klatkę — odtworzenie pancernika to kilka ms. Reszta czeka.
  thawPerFrame: 1,
  // Limit zimnych; nadmiar: najdalszy od gracza, nigdy z ładunkiem.
  maxCold: 1500,
  // Kolejka z jednego skanu (reszta wejdzie w następnym).
  queueMax: 256,
  // Krycie smugi zimnego wraku — sygnał „tło”.
  impostorOpacity: 0.7
});

export const THAW_RESULT = Object.freeze({
  THAWED: 'thawed',
  QUEUED: 'queued',
  FAILED: 'failed'
});

const EMPTY = Object.freeze([]);

export function wreckHasCargo(wreck) {
  const bag = wreck?._cargoManifest;
  if (!bag) return false;
  for (const id in bag) {
    if ((Number(bag[id]) || 0) > 0) return true;
  }
  return false;
}

// Promień w jednostkach świata. Wrak z destruktora trzyma `radius` w jednostkach
// siatki (piksele sprite'a), okręty — już przeskalowany.
function entityWorldRadius(entity) {
  const r = Number(entity?.radius) || 0;
  if (!entity?.isWreck) return r;
  const v = entity.visual;
  const sx = Math.abs(Number(v?.spriteScaleX ?? v?.spriteScale) || 1);
  const sy = Math.abs(Number(v?.spriteScaleY ?? v?.spriteScale) || 1);
  return r * (sx > sy ? sx : sy);
}

function entityX(entity) {
  return entity?.pos && typeof entity.pos.x === 'number' ? entity.pos.x : (Number(entity?.x) || 0);
}

function entityY(entity) {
  return entity?.pos && typeof entity.pos.y === 'number' ? entity.pos.y : (Number(entity?.y) || 0);
}

// Streszczenie dla UI (pole wraków, skaner). Liczone raz, przy zamrażaniu.
export function buildColdWreckSummary(wreck, snapshot) {
  const salvage = wreck?._salvage || null;
  const liveHexes = snapshot?.cells?.length || 0;
  const sourceShards = Number(salvage?.sourceShards) || Number(snapshot?.baseStructuralCount) || liveHexes || 1;
  let hasScrap = false;
  for (const id in salvage?.materials || {}) {
    if ((Number(salvage.materials[id]) || 0) >= 1) {
      hasScrap = true;
      break;
    }
  }
  return {
    label: salvage?.label || 'Wrak',
    hullClass: wreck?.owner?.type ? String(wreck.owner.type) : null,
    liveHexes,
    aliveFrac: Math.max(0, Math.min(1, liveHexes / Math.max(1, sourceShards))),
    weapons: Array.isArray(salvage?.weapons) ? salvage.weapons.length : 0,
    hasCargo: wreckHasCargo(wreck),
    hasScrap
  };
}

/**
 * @param {object} options
 * @param {object[]} options.wrecks      gorące i śpiące (index.html: `wrecks`)
 * @param {object[]} options.coldWrecks  zimne (index.html: `coldWrecks`)
 * @param {() => object[]} [options.getAwakeBodies]  obudzone ciała (lista destruktora z klatki)
 * @param {(stamp: number) => void} [options.markReferences]  stempluje `w._coldRefStamp = stamp`
 *        na wrakach, do których coś się odwołuje (holowanie, cięcie, lock, hover, rozkaz, ładunek)
 * @param {(w: object) => boolean} [options.isReferenced]  tanie odwołania sprawdzane wprost
 * @param {(w: object) => boolean} [options.isVisuallySafe]  poza kadrem albo już smuga
 * @param {() => ({x:number,y:number}|null)} [options.getPlayerPos]
 * @param {() => number} [options.getSimTimeMs]  zegar symulacji (jak `_lastImpactMs`)
 * @param {(w: object, snapshot: object) => void} [options.onBeforeFreeze]  przed zwolnieniem
 *        siatki: odpięcie lin, zapis smugi (kolor), unieważnienie meshy 3D
 * @param {(w: object, reason: string) => void} [options.onThawed]
 * @param {(w: object) => void} [options.onEvicted]
 * @param {(w: object) => unknown} [options.recycle]  domyślnie DestructorSystem.recycleWreck
 * @param {object} [options.config]  nadpisania COLD_WRECK_CONFIG
 */
export function createColdWreckSystem(options = {}) {
  const wrecks = options.wrecks;
  const coldWrecks = options.coldWrecks;
  if (!Array.isArray(wrecks) || !Array.isArray(coldWrecks)) {
    throw new Error('createColdWreckSystem: wymagane tablice wrecks i coldWrecks');
  }
  const config = { ...COLD_WRECK_CONFIG, ...(options.config || {}) };
  const getAwakeBodies = typeof options.getAwakeBodies === 'function' ? options.getAwakeBodies : () => EMPTY;
  const markReferences = typeof options.markReferences === 'function' ? options.markReferences : null;
  const isReferenced = typeof options.isReferenced === 'function' ? options.isReferenced : null;
  const isVisuallySafe = typeof options.isVisuallySafe === 'function' ? options.isVisuallySafe : () => true;
  const getPlayerPos = typeof options.getPlayerPos === 'function' ? options.getPlayerPos : () => null;
  const getSimTimeMs = typeof options.getSimTimeMs === 'function'
    ? options.getSimTimeMs
    : () => (Number(DestructorSystem._simulationTime) || 0) * 1000;
  const onBeforeFreeze = typeof options.onBeforeFreeze === 'function' ? options.onBeforeFreeze : null;
  const onThawed = typeof options.onThawed === 'function' ? options.onThawed : null;
  const onEvicted = typeof options.onEvicted === 'function' ? options.onEvicted : null;
  const recycle = typeof options.recycle === 'function'
    ? options.recycle
    : (w) => DestructorSystem.recycleWreck(w);

  const freezeQueue = [];
  const thawQueue = [];
  let scanTimer = 0;
  let refStamp = 0;
  let freezesThisFrame = 0;
  let thawsThisFrame = 0;
  const stats = {
    frozen: 0,
    thawed: 0,
    evicted: 0,
    thawFailed: 0,
    lastScanCandidates: 0,
    queued: 0
  };

  function refreshReferences() {
    refStamp = (refStamp + 1) | 0;
    if (refStamp <= 0) refStamp = 1;
    if (markReferences) markReferences(refStamp);
  }

  function hasAwakeBodyNear(w) {
    const bodies = getAwakeBodies() || EMPTY;
    const wx = entityX(w);
    const wy = entityY(w);
    const wr = entityWorldRadius(w);
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b || b === w || b.dead || b.destroyed) continue;
      // Śpiący (i zimny) wrak nie jest obudzonym ciałem — pole zamarza razem.
      if (b.isWreck && (b._wreckSleeping || b.isCold)) continue;
      const reach = config.clearRadius + wr + entityWorldRadius(b);
      const dx = entityX(b) - wx;
      const dy = entityY(b) - wy;
      if (dx * dx + dy * dy < reach * reach) return true;
    }
    return false;
  }

  // Wszystkie warunki z briefu, od najtańszych. Wołane przy skanie i ponownie
  // tuż przed zamrożeniem (między skanem a klatką stan mógł się zmienić).
  function isFreezeCandidate(w, simMs = getSimTimeMs()) {
    if (!w || !w.isWreck || w.dead || w._inPool || w.isCold) return false;
    const grid = w.hexGrid;
    if (!grid || !grid.hexTemplate || w._coldUnsupported === true) return false;
    // Holowany wrak ma noWreckSleep (startWreckTow); asteroidy nie zasypiają.
    if (w.noWreckSleep || w.isAsteroidHex) return false;
    if (!w._wreckSleeping) return false;
    if (!((Number(w._wreckSleptSec) || 0) >= config.afterSec)) return false;
    const lastHit = Number(w._lastImpactMs);
    if (Number.isFinite(lastHit) && simMs - lastHit < config.afterSec * 1000) return false;
    if (w._coldRefStamp === refStamp) return false;
    if (isReferenced && isReferenced(w)) return false;
    if (!isVisuallySafe(w)) return false;
    if (hasAwakeBodyNear(w)) return false;
    return true;
  }

  function scan(simMs) {
    for (let i = 0; i < freezeQueue.length; i++) freezeQueue[i]._coldQueued = false;
    freezeQueue.length = 0;
    let candidates = 0;
    for (let i = 0; i < wrecks.length; i++) {
      const w = wrecks[i];
      if (!isFreezeCandidate(w, simMs)) continue;
      candidates++;
      if (freezeQueue.length < config.queueMax && w._coldQueued !== true) {
        w._coldQueued = true;
        freezeQueue.push(w);
      }
    }
    stats.lastScanCandidates = candidates;
    stats.queued = freezeQueue.length;
  }

  function freeze(w) {
    if (!w || w.isCold) return false;
    const index = wrecks.indexOf(w);
    if (index < 0) return false;
    const snapshot = captureHexBodySnapshot(w);
    if (!snapshot) {
      // Siatka nie leży na komórkach szablonu (awaryjny wrak) — nie próbujemy znowu.
      w._coldUnsupported = true;
      return false;
    }
    snapshot.summary = buildColdWreckSummary(w, snapshot);
    w._coldSnapshot = snapshot;
    // Lina, smuga (kolor liczony z meshu, póki istnieje), meshe 3D — przed
    // zwolnieniem siatki, bo renderer czyta jeszcze jej zasięg.
    if (onBeforeFreeze) onBeforeFreeze(w, snapshot);
    disposeHexBody(w);
    w.hexGrid = null;
    w.isCollidable = false;
    w.isCold = true;
    w._coldQueued = false;
    // Stoi w miejscu: dryf per wrak rozjechałby pole o dziesiątki km na godzinę.
    w.vx = 0;
    w.vy = 0;
    w.angVel = 0;
    if (w.vel) {
      w.vel.x = 0;
      w.vel.y = 0;
    }
    // splice, nie swap-pop: kolejność `wrecks` = kolejność list destruktora.
    wrecks.splice(index, 1);
    coldWrecks.push(w);
    stats.frozen++;
    freezesThisFrame++;
    return true;
  }

  function processFreezeQueue(simMs) {
    let attempts = config.freezeAttemptsPerFrame;
    while (freezesThisFrame < config.freezePerFrame && attempts > 0 && freezeQueue.length > 0) {
      attempts--;
      const w = freezeQueue.pop();
      w._coldQueued = false;
      if (!isFreezeCandidate(w, simMs)) continue;
      freeze(w);
    }
    stats.queued = freezeQueue.length;
  }

  function removeCold(w, index = coldWrecks.indexOf(w)) {
    if (index < 0) return false;
    const last = coldWrecks.length - 1;
    if (index !== last) coldWrecks[index] = coldWrecks[last];
    coldWrecks.pop();
    return true;
  }

  function performThaw(w, reason) {
    w._coldThawQueued = false;
    const snapshot = w._coldSnapshot;
    const index = coldWrecks.indexOf(w);
    if (!w.isCold || !snapshot || index < 0 || !initHexBodyFromSnapshot(w, null, snapshot)) {
      w._coldThawCallback = null;
      stats.thawFailed++;
      return false;
    }
    thawsThisFrame++;
    removeCold(w, index);
    w.isCold = false;
    w._coldSnapshot = null;
    w.isCollidable = true;
    w._wreckSleptSec = 0;
    DestructorSystem.wakeWreck(w);
    DestructorSystem.wakeHexEntity(w, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);
    if (!wrecks.includes(w)) wrecks.push(w);
    stats.thawed++;
    if (onThawed) onThawed(w, reason);
    const callback = w._coldThawCallback;
    w._coldThawCallback = null;
    if (typeof callback === 'function') callback(w);
    return true;
  }

  /**
   * Jawne wybudzenie. Wrak wraca do `wrecks` z odtworzoną siatką; meshe
   * powstają leniwie w updateHexShips3D. Najwyżej `thawPerFrame` na klatkę —
   * reszta czeka w kolejce, a `onThawed(w)` zadziała, gdy przyjdzie jej kolej.
   * @returns {'thawed'|'queued'|'failed'}
   */
  function thaw(w, reason = 'dev', onReady = null) {
    if (!w || w.dead || w._inPool) return THAW_RESULT.FAILED;
    if (!w.isCold) {
      if (typeof onReady === 'function') onReady(w);
      return THAW_RESULT.THAWED;
    }
    if (typeof onReady === 'function') w._coldThawCallback = onReady;
    if (thawsThisFrame >= config.thawPerFrame) {
      if (!w._coldThawQueued) {
        w._coldThawQueued = true;
        w._coldThawReason = reason;
        thawQueue.push(w);
      }
      return THAW_RESULT.QUEUED;
    }
    return performThaw(w, reason) ? THAW_RESULT.THAWED : THAW_RESULT.FAILED;
  }

  // Nadmiar ponad maxCold: najdalszy od gracza, nigdy z ładunkiem ani czekający
  // na odmrożenie. Zwykle 1–4 na klatkę (tyle, ile przybyło), O(zimne) każdy.
  function enforceColdLimit() {
    let excess = coldWrecks.length - config.maxCold;
    if (excess <= 0) return 0;
    const player = getPlayerPos();
    const px = Number(player?.x) || 0;
    const py = Number(player?.y) || 0;
    let evicted = 0;
    while (excess > 0) {
      let worst = -1;
      let worstDistSq = -1;
      for (let i = 0; i < coldWrecks.length; i++) {
        const w = coldWrecks[i];
        if (w._coldThawQueued || wreckHasCargo(w)) continue;
        const dx = entityX(w) - px;
        const dy = entityY(w) - py;
        const distSq = dx * dx + dy * dy;
        if (distSq > worstDistSq) {
          worstDistSq = distSq;
          worst = i;
        }
      }
      if (worst < 0) break;
      const w = coldWrecks[worst];
      removeCold(w, worst);
      w.isCold = false;
      recycle(w);
      stats.evicted++;
      evicted++;
      excess--;
      if (onEvicted) onEvicted(w);
    }
    return evicted;
  }

  /**
   * Raz na klatkę (index.html: physicsStep przy runFrameLogic, PRZED pętlą
   * wraków — zamrożony wrak nie trafia już do buforów tej klatki).
   */
  function step(frameDt) {
    freezesThisFrame = 0;
    thawsThisFrame = 0;
    const simMs = getSimTimeMs();

    // Najpierw odmrożenia z kolejki — rozkaz gracza przed porządkami.
    while (thawsThisFrame < config.thawPerFrame && thawQueue.length > 0) {
      const w = thawQueue.shift();
      w._coldThawQueued = false;
      if (!w.isCold || w.dead) continue;
      performThaw(w, w._coldThawReason || 'queue');
    }

    scanTimer -= Math.max(0, Number(frameDt) || 0);
    const scanDue = scanTimer <= 0;
    if (scanDue || freezeQueue.length > 0) refreshReferences();
    if (scanDue) {
      scanTimer = config.scanIntervalSec;
      scan(simMs);
    }
    if (freezeQueue.length > 0) processFreezeQueue(simMs);
    if (coldWrecks.length > config.maxCold) enforceColdLimit();
  }

  /** Zdejmuje wrak z listy zimnych bez recyklingu (np. removeWreckFromWorld). */
  function forget(w) {
    if (!w) return false;
    w._coldThawQueued = false;
    w._coldThawCallback = null;
    const removed = removeCold(w);
    if (removed) w.isCold = false;
    return removed;
  }

  return {
    config,
    stats,
    step,
    freeze,
    thaw,
    forget,
    isFreezeCandidate(w) {
      refreshReferences();
      return isFreezeCandidate(w);
    },
    enforceColdLimit,
    get freezeQueueLength() { return freezeQueue.length; },
    get thawQueueLength() { return thawQueue.length; }
  };
}
