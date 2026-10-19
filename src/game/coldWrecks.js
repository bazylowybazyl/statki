/**
 * Zimne wraki — trzeci stan wraku („tło”), obok gorącego i śpiącego.
 *
 * Po bitwie 174 okrętów zostaje ~426 wraków. Uśpiony wrak (`_wreckSleeping`)
 * nadal siedzi w listach: pętla wraków w physicsStep, siatka pocisków, pętla
 * budzenia, lista encji 3D, budżet węzłów wraków i graf sceny.
 * Zimny wrak nie jest w ŻADNEJ z nich: stan kadłuba żyje w zrzucie, stoi
 * w miejscu i jest duchem dla okrętów i pocisków.
 *
 * Kadłuby na belkach (hullBodies.js — etap 3 portu silnika belek; ścieżkę wraków
 * heksowych usunięto 2026-10-19 razem z silnikiem heksów): migawka ciała względem
 * szablonu kadłuba (src/game/hullColdSnapshot.js), ciało silnika zwolnione.
 * W kadrze (większy od smugi) render prosi o CIAŁO DO RYSOWANIA (`ensureRenderBody`):
 * odtworzone z migawki w budżecie węzłów na klatkę, poza fizyką, zwalniane, gdy
 * render przestanie o nie prosić (`renderIdleSec`). Rysunek: hexShips3D.js
 * (§ ZIMNE WRAKI) — ta sama skóra, mapa ran, mostek i rdzeń co u wraku śpiącego.
 *
 * To TEN SAM obiekt JS co przed zamrożeniem — łup (`_salvage`), ładunek
 * (`_cargoManifest`), `_wreckAge`, sprawca, ród mapy ran i historia zostają.
 * Zimny nie znaczy „do recyklingu”: ładunek i złom zostają.
 *
 * Zamrażanie jest automatyczne i konserwatywne (isFreezeCandidate), budzenie
 * WYŁĄCZNIE jawne (thaw): holowanie, cięcie, rozkaz, konsola. Budzenie na
 * zbliżenie odtworzyłoby pętlę budzenia O(śpiące × aktywne).
 *
 * Moduł nie zna index.html: listy i zapytania o stan gry dostaje w opcjach
 * createColdWreckSystem, więc da się go sprawdzić w node (tests/coldWrecksBeam.test.mjs).
 */

import { HullBodies } from './hullBodies.js';
import { COLD_BEAM_KIND, beamColdSnapshotBytes } from './hullColdSnapshot.js';

// Odmrożony wrak trzyma się obudzony tyle kroków (jak budzenie wraku śpiącego w index.html).
const THAW_WAKE_FRAMES = 20;

export const COLD_WRECK_CONFIG = Object.freeze({
  // Sen bez przerwy i cisza po ostatnim trafieniu/kontakcie [s czasu gry].
  afterSec: 20,
  // Żadnego obudzonego ciała (żywe okręty, gorące wraki, gracz) bliżej [j.] — gracz i ciało ruchome
  // (≥ clearMoveSpeed); ciało stojące (flota w szyku po bitwie) blokuje tylko bliżej niż promienie + clearContactPad.
  // Bez tego zaparkowana przy polu flota nie pozwalała mu zamarznąć (zimny wrak jest omijany przez AI jak każdy).
  clearRadius: 2500,
  clearMoveSpeed: 40,
  clearContactPad: 1000,
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
  // Krycie smugi zimnego wraku bez własnego krycia (smuga z migawki ma `beamImpostorOpacity`) — sygnał „tło”.
  impostorOpacity: 0.7,

  // --- wraki na belkach (kadłuby gry) ---
  // Węzłów migawek na klatkę przy zamrażaniu (zapis ~1–3 µs na węzeł); pierwszy wrak klatki idzie zawsze.
  freezeNodesPerFrame: 12000,
  // Suma węzłów migawek zimnych na belkach (~40–80 B na węzeł); nadmiar: jak maxCold.
  maxColdNodes: 3000000,
  // Ciało do rysowania (skóra zimnego wraku w kadrze): węzłów odtwarzanych na klatkę (do tego czasu smuga).
  renderRestoreNodesPerFrame: 8000,
  // Ciało do rysowania, o które render nie prosił przez tyle sekund (czasu rzeczywistego — przy 500 fps klatki
  // mijają za szybko: przesunięcie kamery tam i z powrotem odtwarzałoby ciała w kółko), wraca do samej migawki.
  renderIdleSec: 4,
  // Ciało wraku zamrożonego poza kadrem (render po nie nie sięgnie) — wraca do migawki po tylu ms.
  renderClaimMs: 150,
  // WYGLĄD w kadrze (docs/BRIEF-zimne-wraki.md § „Belki”): wrak większy od smugi rysuje skóra z ciała odtworzonego
  // z migawki (false — zawsze smuga, bez ciał do rysowania).
  staticSkin: true,
  // Światła innych okrętów (reflektory, lampy pozycyjne, błyski świata) na skórze zimnego — jak u śpiącego.
  nearLights: true,
  // Mostek 3D, okna mostka, rdzeń reaktora, model 3D okrętu („Statki 3D”) i cień SDF — jak u śpiącego.
  nearExtras: true,
  // Zamrażanie w kadrze do tylu px promienia na ekranie. Przy staticSkin + nearExtras wygląd zimnego jest wyglądem
  // śpiącego, więc bez limitu; bez nich — tylko poziom smugi (hexShips3D.js: isColdFreezeVisuallySafe).
  inViewFreezeMaxPx: Infinity,
  // Krycie smugi zimnego wraku na belkach: 1 = jak smuga gorącego (bez przeskoku przy zamrożeniu).
  beamImpostorOpacity: 1
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

/** Czy zimny wrak jest wrakiem na belkach (migawka ciała silnika belek). */
export function isBeamColdWreck(wreck) {
  return wreck?._coldSnapshot?.kind === COLD_BEAM_KIND;
}

// Promień w jednostkach świata (okręty i kadłuby na belkach trzymają go już w świecie).
function entityWorldRadius(entity) {
  return Number(entity?.radius) || 0;
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
  const beam = snapshot?.kind === COLD_BEAM_KIND;
  // Węzły (salvage liczy udziały w węzłach — sourceShards to węzły rodu; nazwy pól z czasów heksów).
  const liveHexes = beam ? (snapshot.liveNodes || 0) : 0;
  const sourceShards = Number(salvage?.sourceShards)
    || (beam ? Number(snapshot.hull?.baseNodes) : 0)
    || liveHexes || 1;
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

// Rdzeń reaktora w STOPIENIU (detonacja w toku) — wrak z bombą nie idzie w tło.
function hasMeltingCore(w) {
  const cores = w?.reactorCores;
  if (!Array.isArray(cores)) return false;
  for (let i = 0; i < cores.length; i++) {
    const c = cores[i];
    if (c && c.host === w && c.state === 'meltdown') return true;
  }
  return false;
}

/**
 * @param {object} options
 * @param {object[]} options.wrecks      gorące i śpiące (index.html: `wrecks`)
 * @param {object[]} options.coldWrecks  zimne (index.html: `coldWrecks`)
 * @param {() => object[]} [options.getAwakeBodies]  obudzone ciała (lista destruktora z klatki)
 * @param {(stamp: number) => void} [options.markReferences]  stempluje `w._coldRefStamp = stamp`
 *        na wrakach, do których coś się odwołuje (holowanie, cięcie, lock, hover, rozkaz, ładunek)
 * @param {(w: object) => boolean} [options.isReferenced]  tanie odwołania sprawdzane wprost
 * @param {(w: object) => boolean} [options.isVisuallySafe]  poza kadrem albo zamiana obrazu niewidoczna
 * @param {() => ({x:number,y:number}|null)} [options.getPlayerPos]
 * @param {() => number} [options.getSimTimeMs]  zegar symulacji (jak `_lastImpactMs`); domyślnie
 *        HullBodies.simTime
 * @param {(w: object, snapshot: object) => void} [options.onBeforeFreeze]  przed zamrożeniem:
 *        odpięcie lin, zapis smugi (kolor)
 * @param {(w: object, reason: string) => void} [options.onThawed]
 * @param {(w: object) => void} [options.onEvicted]
 * @param {(w: object) => unknown} [options.recycle]  zwolnienie wypartego zimnego wraku; domyślnie
 *        HullBodies.recycleWreck
 * @param {() => number} [options.getFrameId]  id klatki rAF: budżety liczone na klatkę
 *        także dla thaw() wołanego z UI między klatkami; bez niego — na wywołanie step()
 * @param {() => number} [options.getTimeMs]  zegar rzeczywisty [ms] (zwalnianie ciał do rysowania); domyślnie
 *        performance.now
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
  const fixedClock = typeof options.getSimTimeMs === 'function' ? options.getSimTimeMs : null;
  const onBeforeFreeze = typeof options.onBeforeFreeze === 'function' ? options.onBeforeFreeze : null;
  const onThawed = typeof options.onThawed === 'function' ? options.onThawed : null;
  const onEvicted = typeof options.onEvicted === 'function' ? options.onEvicted : null;
  const recycle = typeof options.recycle === 'function'
    ? options.recycle
    : (w) => ((w.beamHull || isBeamColdWreck(w)) ? HullBodies.recycleWreck(w) : null);
  const getFrameId = typeof options.getFrameId === 'function' ? options.getFrameId : null;
  const getTimeMs = typeof options.getTimeMs === 'function' ? options.getTimeMs
    : () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const freezeQueue = [];
  const thawQueue = [];
  // Zimne wraki na belkach z ciałem do rysowania (kolejność bez znaczenia, swap-pop).
  const renderBodies = [];
  let scanTimer = 0;
  let refStamp = 0;
  let freezesThisFrame = 0;
  let freezeNodesThisFrame = 0;
  let thawsThisFrame = 0;
  let renderNodesThisFrame = 0;
  let budgetFrameId = null;
  // Rośnie przy każdej zmianie zbioru zimnych — UI (pola wraków) przebudowuje się po nim.
  let version = 0;

  // Zegar warunku „cisza po trafieniu” — ten sam, którym stemplowano `_lastImpactMs`.
  function simMsOf(w) {
    if (fixedClock) return fixedClock();
    return w?.beamHull ? (Number(HullBodies.simTime) || 0) * 1000 : 0;
  }

  // Nowa klatka = nowe budżety. Bez getFrameId zeruje je każde step().
  function syncFrameBudget(force) {
    if (getFrameId) {
      const id = getFrameId();
      if (id === budgetFrameId) return;
      budgetFrameId = id;
    } else if (!force) {
      return;
    }
    freezesThisFrame = 0;
    freezeNodesThisFrame = 0;
    thawsThisFrame = 0;
    renderNodesThisFrame = 0;
  }
  const stats = {
    frozen: 0,
    thawed: 0,
    evicted: 0,
    thawFailed: 0,
    lastScanCandidates: 0,
    queued: 0,
    // belki: węzły i bajty migawek zimnych, odmowy zapisu (wrak spoza szablonu), ciała do rysowania
    coldNodes: 0,
    snapshotBytes: 0,
    unsupported: 0,
    renderBodies: 0,
    renderRestores: 0,
    renderReleases: 0,
    renderDeferred: 0
  };

  function refreshReferences() {
    refStamp = (refStamp + 1) | 0;
    if (refStamp <= 0) refStamp = 1;
    if (markReferences) markReferences(refStamp);
  }

  // 0 — nic; 1 — gracz w clearRadius; 2 — ciało ruchome w clearRadius; 3 — stojące tuż przy wraku (clearContactPad).
  function awakeBodyNear(w) {
    const bodies = getAwakeBodies() || EMPTY;
    const wx = entityX(w);
    const wy = entityY(w);
    const wr = entityWorldRadius(w);
    const moveSq = config.clearMoveSpeed * config.clearMoveSpeed;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b || b === w || b.dead || b.destroyed) continue;
      // Śpiący (i zimny) wrak nie jest obudzonym ciałem — pole zamarza razem.
      if (b.isWreck && (b._wreckSleeping || b.isCold)) continue;
      const br = entityWorldRadius(b);
      const reach = config.clearRadius + wr + br;
      const dx = entityX(b) - wx;
      const dy = entityY(b) - wy;
      const distSq = dx * dx + dy * dy;
      if (distSq >= reach * reach) continue;
      if (b.isPlayer === true) return 1;
      const vx = Number(b.vel?.x ?? b.vx ?? 0), vy = Number(b.vel?.y ?? b.vy ?? 0);
      if (vx * vx + vy * vy >= moveSq) return 2;
      const near = wr + br + config.clearContactPad;
      if (distSq < near * near) return 3;
    }
    return 0;
  }

  function hasAwakeBodyNear(w) {
    return awakeBodyNear(w) !== 0;
  }

  // Kadłub na belkach do zamrożenia: wrak gry (kotwica środka masy), nie budowla, bez czekającego rozpadu.
  function beamFreezable(w) {
    const hull = w.beamHull;
    if (hull.entity !== w || !hull.body || hull.body.dead || hull.body.activeNodes <= 0) return false;
    if (hull.world || w.worldDebris || w.isWorldPiece || hull.body.anchored || hull.anchorMode !== 'com') return false;
    if (HullBodies.pendingStructure(w)) return false;
    return !hasMeltingCore(w);
  }

  // Pierwszy niespełniony warunek zamrożenia (diagnostyka — ColdWreckSystem.explain w konsoli); null = kandydat.
  function explain(w) {
    if (!w || !w.isWreck || w.dead || w._inPool) return 'nie-wrak';
    if (w.isCold) return 'zimny';
    if (w._coldUnsupported === true) return 'spoza-szablonu';
    if (w.beamHull) {
      const hull = w.beamHull;
      if (hull.entity !== w || !hull.body || hull.body.dead || hull.body.activeNodes <= 0) return 'bez-ciala';
      if (hull.world || w.worldDebris || w.isWorldPiece || hull.body.anchored || hull.anchorMode !== 'com') return 'budowla';
      if (HullBodies.pendingStructure(w)) return 'rozpad-w-kolejce';
      if (hasMeltingCore(w)) return 'rdzen-stopienie';
    } else {
      return 'bez-siatki';
    }
    if (w.noWreckSleep) return 'bez-snu';
    if (!w._wreckSleeping) return 'nie-spi';
    if (!((Number(w._wreckSleptSec) || 0) >= config.afterSec)) return 'spi-krotko';
    const lastHit = Number(w._lastImpactMs);
    if (Number.isFinite(lastHit) && simMsOf(w) - lastHit < config.afterSec * 1000) return 'trafiony-niedawno';
    refreshReferences();
    if (w._coldRefStamp === refStamp) return 'odwolanie';
    if (isReferenced && isReferenced(w)) return 'odwolanie-wprost';
    if (!isVisuallySafe(w)) return 'kadr';
    const near = awakeBodyNear(w);
    if (near !== 0) return near === 1 ? 'gracz-w-poblizu' : near === 2 ? 'ruch-w-poblizu' : 'okret-tuz-obok';
    return null;
  }

  // Wszystkie warunki z briefu, od najtańszych. Wołane przy skanie i ponownie
  // tuż przed zamrożeniem (między skanem a klatką stan mógł się zmienić).
  function isFreezeCandidate(w) {
    if (!w || !w.isWreck || w.dead || w._inPool || w.isCold) return false;
    if (w._coldUnsupported === true) return false;
    if (!w.beamHull || !beamFreezable(w)) return false;
    // Holowany wrak ma noWreckSleep (startWreckTow).
    if (w.noWreckSleep) return false;
    if (!w._wreckSleeping) return false;
    if (!((Number(w._wreckSleptSec) || 0) >= config.afterSec)) return false;
    const lastHit = Number(w._lastImpactMs);
    if (Number.isFinite(lastHit) && simMsOf(w) - lastHit < config.afterSec * 1000) return false;
    if (w._coldRefStamp === refStamp) return false;
    if (isReferenced && isReferenced(w)) return false;
    if (!isVisuallySafe(w)) return false;
    if (hasAwakeBodyNear(w)) return false;
    return true;
  }

  function scan() {
    for (let i = 0; i < freezeQueue.length; i++) freezeQueue[i]._coldQueued = false;
    freezeQueue.length = 0;
    let candidates = 0;
    for (let i = 0; i < wrecks.length; i++) {
      const w = wrecks[i];
      if (!isFreezeCandidate(w)) continue;
      candidates++;
      if (freezeQueue.length < config.queueMax && w._coldQueued !== true) {
        w._coldQueued = true;
        freezeQueue.push(w);
      }
    }
    stats.lastScanCandidates = candidates;
    stats.queued = freezeQueue.length;
  }

  function noteBeamSnapshot(snapshot, sign) {
    stats.coldNodes += sign * (snapshot.nodeCount || 0);
    stats.snapshotBytes += sign * beamColdSnapshotBytes(snapshot);
  }

  function freeze(w) {
    if (!w || w.isCold || !w.beamHull) return false;
    const index = wrecks.indexOf(w);
    if (index < 0) return false;
    const snapshot = HullBodies.captureColdSnapshot(w);
    if (!snapshot) {
      // Siatka nie leży na komórkach szablonu (awaryjny wrak, belka spoza szablonu) — nie próbujemy znowu.
      w._coldUnsupported = true;
      stats.unsupported++;
      return false;
    }
    snapshot.summary = buildColdWreckSummary(w, snapshot);
    w._coldSnapshot = snapshot;
    // Lina, smuga (kolor liczony z meshu, póki istnieje) — przed uśpieniem ciała.
    if (onBeforeFreeze) onBeforeFreeze(w, snapshot);
    // Ciało zostaje jako ciało do rysowania: render przejmie je w tej klatce, jeśli wrak jest w kadrze
    // (bez przebudowy skóry); inaczej po renderClaimMs wraca do samej migawki.
    HullBodies.sleep(w);
    w._coldRenderMs = getTimeMs() - Math.max(0, config.renderIdleSec * 1000 - config.renderClaimMs);
    listRenderBody(w);
    stats.renderBodies = renderBodies.length;
    noteBeamSnapshot(snapshot, 1);
    freezeNodesThisFrame += snapshot.nodeCount;
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
    version++;
    freezesThisFrame++;
    return true;
  }

  function processFreezeQueue() {
    let attempts = config.freezeAttemptsPerFrame;
    while (freezesThisFrame < config.freezePerFrame && attempts > 0 && freezeQueue.length > 0) {
      attempts--;
      const w = freezeQueue[freezeQueue.length - 1];
      // Budżet węzłów migawek: duży wrak poczeka na następną klatkę (pierwszy w klatce idzie zawsze).
      const nodes = w.beamHull?.body ? w.beamHull.body.activeNodes : 0;
      if (nodes > 0 && freezeNodesThisFrame > 0 && freezeNodesThisFrame + nodes > config.freezeNodesPerFrame) break;
      freezeQueue.pop();
      w._coldQueued = false;
      if (!isFreezeCandidate(w)) continue;
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

  // Lista ciał do rysowania bez powtórzeń (ciało zwolnione spoza systemu wypada z niej dopiero w step()).
  function listRenderBody(w) {
    if (renderBodies.indexOf(w) < 0) renderBodies.push(w);
  }

  function hasRenderBody(w) {
    const hull = w.beamHull;
    return !!hull && hull.entity === w && !!hull.body && !hull.body.dead;
  }

  function performThaw(w, reason) {
    w._coldThawQueued = false;
    const snapshot = w._coldSnapshot;
    const index = coldWrecks.indexOf(w);
    let ok = !!w.isCold && !!snapshot && snapshot.kind === COLD_BEAM_KIND && index >= 0;
    if (ok) ok = hasRenderBody(w) || !!HullBodies.restoreColdBody(w, snapshot);
    if (!ok) {
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
    noteBeamSnapshot(snapshot, -1);
    w._wreckSleeping = false;
    w._wreckSleepTimer = 0;
    HullBodies.wake(w, THAW_WAKE_FRAMES);
    if (!wrecks.includes(w)) wrecks.push(w);
    stats.thawed++;
    version++;
    if (onThawed) onThawed(w, reason);
    const callback = w._coldThawCallback;
    w._coldThawCallback = null;
    if (typeof callback === 'function') callback(w);
    return true;
  }

  /**
   * Jawne wybudzenie. Wrak wraca do `wrecks` z odtworzoną siatką / ciałem; meshe
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
    syncFrameBudget(false);
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

  /**
   * Render (hexShips3D, raz na klatkę): zimny wrak na belkach w kadrze i większy od smugi potrzebuje ciała do
   * rysowania. true = ciało jest (wrak oznaczony jako rysowany w tej klatce); false = smuga (staticSkin wyłączone,
   * budżet węzłów klatki wyczerpany — spróbuje w następnej, migawka nie pasuje do szablonu).
   */
  function ensureRenderBody(w) {
    if (!w || !w.isCold || w.dead) return false;
    const snapshot = w._coldSnapshot;
    if (!snapshot || snapshot.kind !== COLD_BEAM_KIND) return false;
    if (hasRenderBody(w)) {
      w._coldRenderMs = getTimeMs();
      return true;
    }
    if (!config.staticSkin || snapshot.renderFailed) return false;
    syncFrameBudget(false);
    const nodes = snapshot.nodeCount || 0;
    if (renderNodesThisFrame > 0 && renderNodesThisFrame + nodes > config.renderRestoreNodesPerFrame) {
      stats.renderDeferred++;
      return false;
    }
    if (!HullBodies.restoreColdBody(w, snapshot)) {
      snapshot.renderFailed = true;
      return false;
    }
    renderNodesThisFrame += nodes;
    w._coldRenderMs = getTimeMs();
    listRenderBody(w);
    stats.renderBodies = renderBodies.length;
    stats.renderRestores++;
    return true;
  }

  // Ciała do rysowania, o które render przestał prosić, wracają do migawki (pamięć); odmrożone i wyrzucone
  // wypadają z listy. O(ciała do rysowania), raz na klatkę.
  function releaseIdleRenderBodies() {
    const now = getTimeMs();
    const idleMs = config.renderIdleSec * 1000;
    for (let i = renderBodies.length - 1; i >= 0; i--) {
      const w = renderBodies[i];
      let drop = !w || !w.isCold || w.dead || !hasRenderBody(w);
      if (!drop && now - (Number(w._coldRenderMs) || 0) > idleMs) {
        HullBodies.releaseColdBody(w);
        stats.renderReleases++;
        drop = true;
      }
      if (!drop) continue;
      const last = renderBodies.length - 1;
      if (i !== last) renderBodies[i] = renderBodies[last];
      renderBodies.pop();
    }
    stats.renderBodies = renderBodies.length;
  }

  function evict(w, index) {
    removeCold(w, index);
    if (isBeamColdWreck(w)) noteBeamSnapshot(w._coldSnapshot, -1);
    w.isCold = false;
    recycle(w);
    stats.evicted++;
    version++;
    if (onEvicted) onEvicted(w);
  }

  // Nadmiar ponad maxCold (i ponad maxColdNodes węzłów migawek): najdalszy od gracza, nigdy z ładunkiem ani
  // czekający na odmrożenie. Zwykle 1–4 na klatkę (tyle, ile przybyło), O(zimne) każdy.
  function enforceColdLimit() {
    let excess = coldWrecks.length - config.maxCold;
    let nodeExcess = stats.coldNodes - config.maxColdNodes;
    if (excess <= 0 && nodeExcess <= 0) return 0;
    const player = getPlayerPos();
    const px = Number(player?.x) || 0;
    const py = Number(player?.y) || 0;
    let evicted = 0;
    while (excess > 0 || nodeExcess > 0) {
      let worst = -1;
      let worstDistSq = -1;
      for (let i = 0; i < coldWrecks.length; i++) {
        const w = coldWrecks[i];
        if (w._coldThawQueued || wreckHasCargo(w)) continue;
        // Nadmiar samych węzłów: tylko wraki na belkach coś zwalniają.
        if (excess <= 0 && !isBeamColdWreck(w)) continue;
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
      const nodes = isBeamColdWreck(w) ? (w._coldSnapshot.nodeCount || 0) : 0;
      evict(w, worst);
      evicted++;
      excess--;
      nodeExcess -= nodes;
    }
    return evicted;
  }

  /**
   * Raz na klatkę (index.html: physicsStep przy runFrameLogic, PRZED pętlą
   * wraków — zamrożony wrak nie trafia już do buforów tej klatki).
   */
  function step(frameDt) {
    syncFrameBudget(true);

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
      scan();
    }
    if (freezeQueue.length > 0) processFreezeQueue();
    if (renderBodies.length > 0) releaseIdleRenderBodies();
    if (coldWrecks.length > config.maxCold || stats.coldNodes > config.maxColdNodes) enforceColdLimit();
  }

  /** Zdejmuje wrak z listy zimnych bez recyklingu (np. removeWreckFromWorld). */
  function forget(w) {
    if (!w) return false;
    w._coldThawQueued = false;
    w._coldThawCallback = null;
    const removed = removeCold(w);
    if (removed) {
      if (isBeamColdWreck(w)) noteBeamSnapshot(w._coldSnapshot, -1);
      w.isCold = false;
      version++;
    }
    return removed;
  }

  return {
    config,
    stats,
    step,
    freeze,
    thaw,
    forget,
    ensureRenderBody,
    explain,
    isFreezeCandidate(w) {
      refreshReferences();
      return isFreezeCandidate(w);
    },
    enforceColdLimit,
    get freezeQueueLength() { return freezeQueue.length; },
    get thawQueueLength() { return thawQueue.length; },
    get renderBodyCount() { return renderBodies.length; },
    // Zimne wraki na belkach z ciałem do rysowania (może zawierać odmrożone / zwolnione do najbliższego step()).
    get renderList() { return renderBodies; },
    get version() { return version; }
  };
}
