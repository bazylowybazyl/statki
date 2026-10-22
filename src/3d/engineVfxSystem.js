// Dysze silników: MAIN i WARP w nowych modułach, SIDE na starym batchu.
//
//   MAIN  — mainExhaust3D.js (port dema wydechu): struga + iskry, jedna pula
//           na całą flotę; rozmiar i paleta PER STATEK (visual.engineFx,
//           edytowane w edytorze hardpointów, src/data/engineFx.js).
//   WARP  — warpPlume3D.js (port PlasmaEngineFX): leci z tych samych dysz co
//           MAIN na czas ładowania i skoku; pula z limitem, nadmiar dysz
//           dostaje strugę MAIN z dopalaczem.
//   SIDE  — od 2026-10-07 sideJets3D.js (WebGPU: praca impulsowa, struga TSL, gaz w pulach GPU,
//           światło na blasze; barwa z palety MAIN okrętu), dawny engineExhaustBatch.js tylko jako A/B
//           (SideJets3D.enabled = false). Dysza ma model 3D (sponson + obrotowy dzwon,
//           ships3d/thrusters/sideThruster3D.js) — tu wpis na listę klatki (SideNozzleFrame), a struga
//           zaczyna się w wylocie dzwonu.
import { Core3D } from './core3d.js';
import { RenderWorld } from '../render/renderWorld.js';
import { EngineExhaustBatch, createExhaustState } from './engineExhaustBatch.js';
import { getEngineVfxClassScale } from './engineVfxScale.js';
import {
  MainExhaust3D,
  MAIN_EXHAUST_Z,
  createMainExhaustState,
  mainExhaustReach,
  releaseMainExhaustState
} from './mainExhaust3D.js';
import { WarpPlume3D } from './warpPlume3D.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
// Dysze MAIN tej klatki per okręt — dla poświaty dysz na pyle kosmicznym (src/3d/dust/).
import { EngineFrame } from './engineFrame.js';
import { enginePlumeScale, engineIgnitionKick } from '../game/engineIgnition.js';
// Dysze SIDE tej klatki — modele 3D dysz bocznych (sideNozzleFrame.js → shipModels3DGame.js); płomień z wylotu dzwonu.
import { SideNozzleFrame, SIDE_NOZZLE_RADIUS, SIDE_NOZZLE_MOUTH } from './sideNozzleFrame.js';
// Dysze SIDE na WebGPU (2026-10-07): struga TSL, gaz w pulach GPU, światło na blasze — zamiast engineExhaustBatch.
import { SideJets3D, createSideJetState, SIDE_JET_TUNE, SIDE_JET_REACH_R } from './sideJets3D.js';
import { buildEntityEngineFx, fallbackNozzleRadius } from '../data/engineFx.js';
import { cloakVisAtWorld } from '../game/cloakLook.js';
// Rozpad kadłuba belkowego: dysza gaśnie, gdy komórka pod nią nie jest już żywym węzłem ciała właściciela.
import {
  beginHullMountBind,
  bindHullMount,
  createHullMountSet,
  mountHullOf,
  refreshHullMountSet
} from '../game/hullMounts.js';
import {
  getHullRenderProfile,
  resolveEntityHullProfileId,
  HULL_RENDER_WORLD_SCALE
} from '../data/ships.js';

import { DrawCallStats } from './drawCallStats.js';

// Silnik żywego statku nigdy nie gaśnie do zera — na jałowym dysza lekko
// pracuje (dawny płomień miał w tym miejscu stały rdzeń w wylocie).
const MAIN_IDLE_THROTTLE = 0.06;
// Iskry NPC rzadziej niż gracza: bank iskier dzielą bronie całej bitwy.
const NPC_SPARK_MUL = 0.35;

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function getEntityScale(entity) {
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

// window.ship i __interpShipPose czytane raz na klatkę (EngineVfxSystem.update → frameCtx), nie na każdy okręt.
function getInterpolatedPose(entity) {
  const player = frameCtx.playerShip;
  if (!player || entity !== player) return null;
  const pose = frameCtx.playerPose;
  if (!pose) return null;
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.angle)) return null;
  return pose;
}

function normalizeDeg(value, fallback = 0) {
  let deg = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function normalizeForward(forward, fallbackX = 0, fallbackY = 1) {
  const rawX = Number(forward?.x);
  const rawY = Number(forward?.y);
  const x = Number.isFinite(rawX) ? rawX : fallbackX;
  const y = Number.isFinite(rawY) ? rawY : fallbackY;
  const lenSq = x * x + y * y;
  if (lenSq <= 1e-10) return { x: fallbackX, y: fallbackY };
  const inv = 1 / Math.sqrt(lenSq);
  return { x: x * inv, y: y * inv };
}

function forwardToDeg(forward) {
  const norm = normalizeForward(forward, 0, 1);
  return normalizeDeg(Math.atan2(norm.x, -norm.y) * 180 / Math.PI, 0);
}

function degToForward(deg) {
  const rad = normalizeDeg(deg, 0) * Math.PI / 180;
  return normalizeForward({ x: Math.sin(rad), y: -Math.cos(rad) }, 0, 1);
}

function normalizeGimbal(minDeg, maxDeg, fallbackMin, fallbackMax) {
  let min = normalizeDeg(minDeg, fallbackMin);
  let max = normalizeDeg(maxDeg, fallbackMax);
  if (min > max) {
    const tmp = min;
    min = max;
    max = tmp;
  }
  return { min, max };
}

function clampNozzleDegToGimbal(nozzleDeg, baseDeg, gimbalMinDeg, gimbalMaxDeg) {
  const base = normalizeDeg(baseDeg, 0);
  const nozzle = normalizeDeg(nozzleDeg, base);
  const rel = normalizeDeg(nozzle - base, 0);
  const min = Number.isFinite(Number(gimbalMinDeg)) ? Number(gimbalMinDeg) : -45;
  const max = Number.isFinite(Number(gimbalMaxDeg)) ? Number(gimbalMaxDeg) : 45;
  const clamped = Math.max(min, Math.min(max, rel));
  return normalizeDeg(base + clamped, base);
}

function inferSideFromMount(mount, y = 0) {
  const raw = String(mount || '').toLowerCase();
  if (raw.endsWith('_left')) return 'left';
  if (raw.endsWith('_right')) return 'right';
  return (Number(y) || 0) < 0 ? 'left' : 'right';
}

// Kierunek dyszy zależy od slotu (stały od buildSlots) i czterech pól źródła — nozzleDeg zmienia się tylko przy
// ruchu gimbala. Pamięć per slot: te same surowe wartości = ten sam wynik (bez normalizacji i trzech obiektów
// na dyszę na klatkę). Wynik tylko do odczytu.
function resolveSlotForward(slot) {
  if (!slot) return { x: 0, y: 1 };
  const source = slot.source;
  const b = source?.baseDeg;
  const g0 = source?.gimbalMinDeg;
  const g1 = source?.gimbalMaxDeg;
  const nz = source?.nozzleDeg;
  const memo = slot._fwdMemo;
  if (memo !== undefined && memo.b === b && memo.g0 === g0 && memo.g1 === g1 && memo.nz === nz) return memo.fwd;
  const fwd = computeSlotForward(slot, source);
  if (memo !== undefined) {
    memo.b = b; memo.g0 = g0; memo.g1 = g1; memo.nz = nz; memo.fwd = fwd;
  } else {
    slot._fwdMemo = { b, g0, g1, nz, fwd };
  }
  return fwd;
}

function computeSlotForward(slot, source) {
  const baseDeg = Number.isFinite(Number(source?.baseDeg))
    ? normalizeDeg(source.baseDeg, slot.baseDeg)
    : normalizeDeg(slot.baseDeg, forwardToDeg(slot.forward));
  const fallbackMin = slot.kind === 'side' ? -90 : -45;
  const fallbackMax = slot.kind === 'side' ? 90 : 45;
  const range = normalizeGimbal(
    Number.isFinite(Number(source?.gimbalMinDeg)) ? source.gimbalMinDeg : slot.gimbalMinDeg,
    Number.isFinite(Number(source?.gimbalMaxDeg)) ? source.gimbalMaxDeg : slot.gimbalMaxDeg,
    fallbackMin,
    fallbackMax
  );
  const nozzleRaw = Number.isFinite(Number(source?.nozzleDeg))
    ? source.nozzleDeg
    : (Number.isFinite(Number(slot.nozzleDeg)) ? slot.nozzleDeg : baseDeg);
  const nozzleDeg = clampNozzleDegToGimbal(nozzleRaw, baseDeg, range.min, range.max);
  return degToForward(nozzleDeg);
}

function buildSlots(entity) {
  const slots = [];

  const mainThrusters = Array.isArray(entity?.visual?.mainThrusters) ? entity.visual.mainThrusters : null;
  if (mainThrusters && mainThrusters.length) {
    for (const thruster of mainThrusters) {
      if (!thruster?.offset) continue;
      const ox = Number(thruster.offset.x);
      const oy = Number(thruster.offset.y);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      const fwd = normalizeForward(thruster.forward, 0, 1);
      const baseDeg = Number.isFinite(Number(thruster?.baseDeg))
        ? normalizeDeg(thruster.baseDeg, forwardToDeg(fwd))
        : forwardToDeg(fwd);
      const gimbal = normalizeGimbal(thruster?.gimbalMinDeg, thruster?.gimbalMaxDeg, -45, 45);
      const nozzleDeg = clampNozzleDegToGimbal(
        Number.isFinite(Number(thruster?.nozzleDeg)) ? thruster.nozzleDeg : baseDeg,
        baseDeg,
        gimbal.min,
        gimbal.max
      );
      slots.push({
        kind: 'main',
        mode: 'absolute',
        source: thruster,
        offset: { x: ox, y: oy },
        forward: degToForward(nozzleDeg),
        mount: String(thruster?.mount || ''),
        baseDeg,
        nozzleDeg,
        gimbalMinDeg: gimbal.min,
        gimbalMaxDeg: gimbal.max,
        side: null
      });
    }
  } else {
    const mainEngine = entity?.engines?.main;
    if (mainEngine) {
      const mainOffset = mainEngine.vfxOffset || mainEngine.visualOffset || mainEngine.offset;
      if (mainOffset && Number.isFinite(mainOffset.x) && Number.isFinite(mainOffset.y)) {
        const baseForward = normalizeForward(mainEngine.vfxForward, 0, 1);
        const baseDeg = Number.isFinite(Number(mainEngine?.baseDeg))
          ? normalizeDeg(mainEngine.baseDeg, forwardToDeg(baseForward))
          : forwardToDeg(baseForward);
        const gimbal = normalizeGimbal(mainEngine?.gimbalMinDeg, mainEngine?.gimbalMaxDeg, -45, 45);
        const nozzleDeg = clampNozzleDegToGimbal(
          Number.isFinite(Number(mainEngine?.nozzleDeg)) ? mainEngine.nozzleDeg : baseDeg,
          baseDeg,
          gimbal.min,
          gimbal.max
        );
        slots.push({
          kind: 'main',
          mode: 'absolute',
          source: mainEngine,
          offset: { x: Number(mainOffset.x) || 0, y: Number(mainOffset.y) || 0 },
          forward: degToForward(nozzleDeg),
          mount: String(mainEngine?.mount || ''),
          baseDeg,
          nozzleDeg,
          gimbalMinDeg: gimbal.min,
          gimbalMaxDeg: gimbal.max,
          side: null
        });
      }
    }
  }

  const sideThrusters = Array.isArray(entity?.visual?.torqueThrusters) ? entity.visual.torqueThrusters : null;
  if (sideThrusters && sideThrusters.length) {
    for (const thruster of sideThrusters) {
      if (!thruster?.offset) continue;
      const ox = Number(thruster.offset.x);
      const oy = Number(thruster.offset.y);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      const fwd = normalizeForward(thruster.forward, 0, 1);
      const baseDeg = Number.isFinite(Number(thruster?.baseDeg))
        ? normalizeDeg(thruster.baseDeg, forwardToDeg(fwd))
        : forwardToDeg(fwd);
      const gimbal = normalizeGimbal(thruster?.gimbalMinDeg, thruster?.gimbalMaxDeg, -90, 90);
      const nozzleDeg = clampNozzleDegToGimbal(
        Number.isFinite(Number(thruster?.nozzleDeg)) ? thruster.nozzleDeg : baseDeg,
        baseDeg,
        gimbal.min,
        gimbal.max
      );
      const mount = String(thruster?.mount || '');
      slots.push({
        kind: 'side',
        mode: 'absolute',
        source: thruster,
        offset: { x: ox, y: oy },
        forward: degToForward(nozzleDeg),
        mount,
        baseDeg,
        nozzleDeg,
        gimbalMinDeg: gimbal.min,
        gimbalMaxDeg: gimbal.max,
        side: thruster.side === 'left' || thruster.side === 'right'
          ? thruster.side
          : inferSideFromMount(mount, oy)
      });
    }
  }

  if (slots.length > 0) return slots;

  const legacyOffsets = Array.isArray(entity?.capitalProfile?.engineOffsets) ? entity.capitalProfile.engineOffsets : null;
  if (!legacyOffsets || !legacyOffsets.length) return slots;
  for (const offset of legacyOffsets) {
    const ox = Number(offset?.x);
    const oy = Number(offset?.y);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
    slots.push({
      kind: 'main',
      mode: 'normalized',
      offset: { x: ox, y: oy },
      forward: { x: 0, y: 1 },
      side: null
    });
  }

  return slots;
}

function makeSlotKey(slots) {
  return slots.map((slot) => {
    const mode = slot.mode || 'absolute';
    const kind = slot.kind || 'main';
    const mount = String(slot.mount || '');
    const side = slot.side || '';
    const ox = Number(slot.offset?.x) || 0;
    const oy = Number(slot.offset?.y) || 0;
    const baseDeg = Number(slot.baseDeg) || 0;
    const gimbalMinDeg = Number(slot.gimbalMinDeg) || 0;
    const gimbalMaxDeg = Number(slot.gimbalMaxDeg) || 0;
    return `${mode}|${kind}|${side}|${mount}|${ox.toFixed(2)}|${oy.toFixed(2)}|${baseDeg.toFixed(2)}|${gimbalMinDeg.toFixed(2)}|${gimbalMaxDeg.toFixed(2)}`;
  }).join('||');
}

// Odcisk wejść klucza dysz: te same źródła i pola, które czyta buildSlots
// (bez nozzleDeg — nie wchodzi do klucza), wartości po Number()/String() jak
// tam, zmieszane FNV-1a bez alokacji. Ten sam odcisk = ten sam klucz, więc
// sloty i klucz tekstowy (5 toFixed + konkatenacje na dyszę) liczą się tylko
// po zmianie układu — dawniej co klatkę dla każdej encji w pudle rozgrzania.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const _mixF64 = new Float64Array(1);
const _mixU32 = new Uint32Array(_mixF64.buffer);

function mixTag(hash, tag) {
  return Math.imul(hash ^ tag, FNV_PRIME);
}

function mixNumber(hash, value) {
  _mixF64[0] = Number(value);
  hash = Math.imul(hash ^ _mixU32[0], FNV_PRIME);
  return Math.imul(hash ^ _mixU32[1], FNV_PRIME);
}

function mixString(hash, str) {
  hash = Math.imul(hash ^ str.length, FNV_PRIME);
  for (let i = 0; i < str.length; i++) hash = Math.imul(hash ^ str.charCodeAt(i), FNV_PRIME);
  return hash;
}

function mixThruster(hash, thruster) {
  if (!thruster) return mixTag(hash, 1);
  const offset = thruster.offset;
  if (!offset) return mixTag(hash, 2);
  hash = mixNumber(hash, offset.x);
  hash = mixNumber(hash, offset.y);
  hash = mixNumber(hash, thruster.forward?.x);
  hash = mixNumber(hash, thruster.forward?.y);
  hash = mixNumber(hash, thruster.baseDeg);
  hash = mixNumber(hash, thruster.gimbalMinDeg);
  hash = mixNumber(hash, thruster.gimbalMaxDeg);
  hash = mixString(hash, String(thruster.mount || ''));
  return mixTag(hash, thruster.side === 'left' ? 3 : (thruster.side === 'right' ? 4 : 5));
}

function mixMainEngine(hash, mainEngine) {
  if (!mainEngine) return mixTag(hash, 6);
  const offset = mainEngine.vfxOffset || mainEngine.visualOffset || mainEngine.offset;
  // Ten sam test co buildSlots (Number.isFinite bez konwersji).
  if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return mixTag(hash, 7);
  hash = mixNumber(hash, offset.x);
  hash = mixNumber(hash, offset.y);
  hash = mixNumber(hash, mainEngine.vfxForward?.x);
  hash = mixNumber(hash, mainEngine.vfxForward?.y);
  hash = mixNumber(hash, mainEngine.baseDeg);
  hash = mixNumber(hash, mainEngine.gimbalMinDeg);
  hash = mixNumber(hash, mainEngine.gimbalMaxDeg);
  return mixString(hash, String(mainEngine.mount || ''));
}

function slotInputHash(entity) {
  let hash = FNV_OFFSET_BASIS;
  const mainThrusters = entity?.visual?.mainThrusters;
  if (Array.isArray(mainThrusters) && mainThrusters.length) {
    hash = mixTag(hash, 0x100 + mainThrusters.length);
    for (let i = 0; i < mainThrusters.length; i++) hash = mixThruster(hash, mainThrusters[i]);
  } else {
    hash = mixMainEngine(mixTag(hash, 0x200), entity?.engines?.main);
  }
  const sideThrusters = entity?.visual?.torqueThrusters;
  if (Array.isArray(sideThrusters) && sideThrusters.length) {
    hash = mixTag(hash, 0x300 + sideThrusters.length);
    for (let i = 0; i < sideThrusters.length; i++) hash = mixThruster(hash, sideThrusters[i]);
  }
  const legacyOffsets = entity?.capitalProfile?.engineOffsets;
  if (Array.isArray(legacyOffsets) && legacyOffsets.length) {
    hash = mixTag(hash, 0x400 + legacyOffsets.length);
    for (let i = 0; i < legacyOffsets.length; i++) {
      hash = mixNumber(hash, legacyOffsets[i]?.x);
      hash = mixNumber(hash, legacyOffsets[i]?.y);
    }
  }
  return hash >>> 0;
}

// Odcisk liczył się co klatkę dla każdej encji w pudle (~1,5 µs na okręt, w bitwie 166 okrętów ~0,25 ms
// na klatkę), choć układ dysz zmienia się tylko podmianą tablic (edytor, układ NPC, konfiguracja gracza).
// Szybka ścieżka: te same obiekty wejść co przy ostatnim odcisku = ten sam układ. Zapis W MIEJSCU pól dyszy
// (np. thrusterModel uzupełnia brakujące baseDeg w pierwszych krokach) łapie pełny odcisk: co klatkę przez
// SLOT_INPUT_SETTLE klatek po (prze)budowie, potem co SLOT_INPUT_RECHECK klatek (faza rozłożona po encjach).
const SLOT_INPUT_SETTLE = 16;
const SLOT_INPUT_RECHECK = 32;
let slotInputPhase = 0;

function createSlotInputRefs() {
  return {
    visual: undefined, main: undefined, mainLen: -1, side: undefined, sideLen: -1,
    engine: undefined, engineOffset: undefined, engineForward: undefined, legacy: undefined, legacyLen: -1,
    settle: SLOT_INPUT_SETTLE, phase: (slotInputPhase++) % SLOT_INPUT_RECHECK
  };
}

// Te same pola, które czyta slotInputHash, jako tożsamości obiektów i długości tablic.
function slotInputRefsSame(entity, refs, frame) {
  if (refs.settle > 0) return false;
  if (((frame + refs.phase) % SLOT_INPUT_RECHECK) === 0) return false;
  const visual = entity.visual;
  if (refs.visual !== visual) return false;
  const main = visual?.mainThrusters;
  if (refs.main !== main || refs.mainLen !== (Array.isArray(main) ? main.length : -1)) return false;
  const side = visual?.torqueThrusters;
  if (refs.side !== side || refs.sideLen !== (Array.isArray(side) ? side.length : -1)) return false;
  const engine = entity.engines?.main;
  if (refs.engine !== engine) return false;
  if (engine && (refs.engineOffset !== (engine.vfxOffset || engine.visualOffset || engine.offset)
    || refs.engineForward !== engine.vfxForward)) return false;
  const legacy = entity.capitalProfile?.engineOffsets;
  return refs.legacy === legacy && refs.legacyLen === (Array.isArray(legacy) ? legacy.length : -1);
}

function rememberSlotInputRefs(entity, refs) {
  const visual = entity.visual;
  refs.visual = visual;
  const main = visual?.mainThrusters;
  refs.main = main;
  refs.mainLen = Array.isArray(main) ? main.length : -1;
  const side = visual?.torqueThrusters;
  refs.side = side;
  refs.sideLen = Array.isArray(side) ? side.length : -1;
  const engine = entity.engines?.main;
  refs.engine = engine;
  refs.engineOffset = engine ? (engine.vfxOffset || engine.visualOffset || engine.offset) : undefined;
  refs.engineForward = engine ? engine.vfxForward : undefined;
  const legacy = entity.capitalProfile?.engineOffsets;
  refs.legacy = legacy;
  refs.legacyLen = Array.isArray(legacy) ? legacy.length : -1;
  if (refs.settle > 0) refs.settle--;
}

// Dla testów: odcisk musi się zmieniać zawsze, gdy zmienia się klucz slotów.
export const EngineSlotKeyInternals = Object.freeze({
  buildSlots, makeSlotKey, slotInputHash, createSlotInputRefs, slotInputRefsSame, rememberSlotInputRefs,
  SLOT_INPUT_SETTLE, SLOT_INPUT_RECHECK, resolveSlotForward, computeSlotForward
});
// Dla testów: dysze gasną z komórką kadłuba belkowego (syncNozzleMounts — niżej).
export const EngineNozzleInternals = Object.freeze({
  buildSlots,
  syncNozzleMounts: (e, fx) => syncNozzleMounts(e, fx),
  // LOD dysz MAIN za kadrem (testy): kadr klatki z kamery gry i cullInfo, decyzja dla wylotu, kontekst klatki
  // (getter — frameCtx jest zadeklarowany niżej)
  prepareMainLod,
  mainJetsOffView,
  get frameCtx() { return frameCtx; }
});

// Dysza nie ma juz wlasnych obiektow w scenie — zostaje sam stan wygladzania,
// ktory batch przepisuje na atrybuty instancji. Cala flota rysuje sie stala
// liczba wywolan zamiast kilkoma NA DYSZE. Dysza MAIN trzyma stan strugi
// i (tylko w skoku) instancje plazmy warpa z puli.
function createEffects(slots) {
  const exhausts = [];
  for (const slot of slots) {
    if (slot.kind === 'side') exhausts.push({ state: createExhaustState(), jet: createSideJetState(), slot, main: null, warp: null });
    else exhausts.push({ state: null, jet: null, slot, main: createMainExhaustState(), warp: null });
  }
  return { exhausts, slotKey: makeSlotKey(slots), inputHash: 0, inputRefs: createSlotInputRefs(), mounts: null };
}

// Dysze na kadłubie belkowym (hullBodies.js) leżą w pikselach sprite'a właściciela: po rozpadzie dysze odpadłej
// części paliły się dalej na rodzicu — nad dryfującym wrakiem, potem w pustce. Dysza = mocowanie (hullMounts.js):
// komórka siatki belek pod wylotem (offset w px renderu, jak niżej), wiązanie raz na układ dysz i ród kadłuba,
// żywotność przy zmianie ciała. Zwraca maskę `alive` (indeksy jak fxData.exhausts) albo null (bez kadłuba).
function syncNozzleMounts(entity, fxData) {
  const hull = mountHullOf(entity);
  if (!hull) return null;
  const exhausts = fxData.exhausts;
  let set = fxData.mounts;
  if (!set) set = fxData.mounts = createHullMountSet();
  if (set.lineage !== hull.dmgKey || set.count !== exhausts.length) {
    const rest = beginHullMountBind(set, hull, exhausts.length);
    for (let i = 0; i < exhausts.length; i++) {
      const slot = exhausts[i].slot;
      // Dawne offsety znormalizowane (capitalProfile.engineOffsets) zależą od promienia — bez wiązania.
      if (!slot || slot.mode === 'normalized' || !slot.offset) continue;
      set.cells[i] = bindHullMount(hull, Number(slot.offset.x) || 0, Number(slot.offset.y) || 0, rest);
    }
  }
  refreshHullMountSet(set, hull);
  return set.alive;
}

// Dysza zgasła z komórką kadłuba: struga oddaje właściciela (jej kwady dogasają tam, gdzie były — ≤ 0,3 s),
// plazma skoku wraca do puli. Bez instancji SIDE, poświaty na pyle i gorącego powietrza.
function cutNozzle(item) {
  if (item.main && item.main.owner >= 0) releaseMainExhaustState(item.main);
  if (item.warp) {
    WarpPlume3D.release(item.warp);
    item.warp = null;
  }
}

/**
 * Konfiguracja silników encji: blok z edytora (visual.engineFx — ustawia go
 * runtime układu NPC i układ gracza) albo zapas liczony od kadłuba.
 */
function resolveEntityEngineFx(entity) {
  const fx = entity?.visual?.engineFx;
  if (fx && typeof fx === 'object') return fx;
  const hullId = resolveEntityHullProfileId(entity);
  const cached = entity.__engineFxFallback;
  if (cached && cached.hullId === hullId) return cached;
  const renderLength = (Number(getHullRenderProfile(hullId)?.length) || 3000) * HULL_RENDER_WORLD_SCALE;
  const fallback = buildEntityEngineFx(hullId, null, 1);
  // Promień z domyślnych edytora jest w pikselach PNG i bez hpScale nic nie
  // znaczy — kadłub bez układu z edytora bierze dyszę od długości renderu.
  fallback.nozzleRadius = fallbackNozzleRadius(renderLength);
  fallback.hullId = hullId;
  entity.__engineFxFallback = fallback;
  return fallback;
}

/** Tryb napędu skokowego encji: 'off' | 'charging' | 'active'. */
function resolveWarpMode(entity) {
  if (entity.__warpPreview === true) return 'active';
  // Hipercruise (E5, decyzja użytkownika 2026-10-22: „obecny silnik warp będzie hypercruise”): ta sama plazma
  // WARP na dyszach MAIN — rozruch jak ładowanie, lot jak skok (gracz i NPC: `__hyperMode` z gry / lustra).
  const hyper = entity.__hyperMode;
  if (hyper === 'active' || hyper === 'charging') return hyper;
  const player = RenderWorld.ship;
  if (player && entity === player) {
    const w = RenderWorld.warp;
    if (w?.state === 'charging') return 'charging';
    if (w?.state === 'active') return 'active';
    // Wyjście z warpa = przylot jak u NPC (warpDrive.js: WARP_EXIT): plazma do hamowania.
    const r = w?.exitRamp;
    if (r && r.active && r.age < r.tBrake + 0.25) return 'active';
    return 'off';
  }
  if (entity.state === 'warping_in' || entity.phase === 'warping') return 'active';
  // Warp „Nurt” (zadanie 22, src/3d/warp/warpNurt.js): przylot / odlot tunelem zapala plazmę
  // na czas wyrzutu i ładowania odlotu (sam wygląd — rozgrywki nie dotyka).
  const nurt = entity.__warpNurtMode;
  if (nurt === 'active' || nurt === 'charging') return nurt;
  return 'off';
}

/**
 * Dopalacz silników MAIN: Shift gracza, system F w toku — szarża albo zryw silników, gracz i NPC
 * (`entity.__fSysBoost`: index.html, src/ai/npcShipSystem.js); w edytorze — Shift testu.
 */
function resolveMainBoost(entity) {
  if (entity.__editorBoost === true || entity.__fSysBoost === true) return true;
  const player = RenderWorld.ship;
  return !!(player && entity === player && RenderWorld.boost?.state === 'active');
}

/**
 * Plazma warpa na dyszy MAIN. Zwraca, co ma robić struga MAIN tej dyszy:
 * 'none' — normalna praca, 'on' — plazma pali (struga gaśnie),
 * 'fallback' — skok bez wolnej instancji (struga na dopalaczu).
 */
function driveWarpPlume(item, mode, frame, x, y, dirX, dirY, radius, fx) {
  let plume = item.warp;
  if (!plume) {
    if (mode === 'off') return 'none';
    plume = WarpPlume3D.acquire();
    if (!plume) return 'fallback';
    item.warp = plume;
  }
  if (mode === 'off') {
    plume.shutdown();
  } else {
    plume.ignite();              // bez skutku, gdy już pali
    plume.setBoost(mode === 'active');
  }
  plume.setPalette(fx.warpPaletteIndex | 0);
  plume.params.plumeLength = Number(fx.warpLength) > 0 ? Number(fx.warpLength) : 1;
  plume.setPose(x, y, MAIN_EXHAUST_Z, dirX, dirY, radius);
  plume.update(frame.dt, frame.camera, frame.viewportH, frame.isOrtho);
  if (plume.finished) {
    WarpPlume3D.release(plume);
    item.warp = null;
    return 'none';
  }
  return (plume.state === 'ignition' || plume.state === 'running') ? 'on' : 'none';
}

// Kontekst klatki (jeden obiekt, bez alokacji per klatkę).
const frameOrigin = { x: 0, y: 0 };
const frameCtx = {
  dt: 1 / 60,
  zoom: 1,
  camera: null,
  isOrtho: true,
  viewportH: 1080,
  // odczyty window raz na klatkę (update): statek gracza i jego poza interpolowana, strojenie dysz SIDE
  playerShip: null,
  playerPose: null,
  tune: null,
  sideWidthMul: 1,
  // LOD dysz SIDE (audyt FPS 2026-10-11, updateEffects): kamera z góry (piksele z zoomu — w kamerach 3D skala zależy
  // od punktu, decyduje rysownik), margines pudła rysowania [j. świata], próg modelu dyszy [px promienia wylotu]
  lod: false,
  drawMargin: Infinity,
  modelMinPx: 0,
  // LOD dysz MAIN za kadrem (MainExhaust3D.offscreenLod): kadr tej klatki w scenie (środek, połowy boków [j.]),
  // prędkość kadru (scena, j/s) i prędkość jego brzegu przy oddalaniu, zapas na wstrząs i przyspieszenie kadru [j.]
  mainLod: false,
  viewX: 0, viewY: 0, viewHW: 0, viewHH: 0,
  viewVX: 0, viewVY: 0, viewGrow: 0,
  viewPad: 0
};
// Statystyki LOD dysz MAIN ostatniej klatki: dysze MAIN, w tym okrętów poza pudłem rysowania, i dysze bez strug
// (`cut` liczone także przy MainExhaust3D.offscreenLod = false — ile by odpadło).
export const MainLodStats = { nozzles: 0, offBox: 0, cut: 0 };
// Kadr poprzedniej klatki (kamera gry BEZ wstrząsu — window.camera): prędkość kadru i oddalania, z pamięcią szczytu
// (MAIN_LOD_HOLD s) — ruszający kadr podnosi zapas od razu, hamujący oddaje go powoli.
const viewTrack = { ok: false, x: 0, y: 0, zoom: 1, vx: 0, vy: 0, hold: 0, grow: 0 };
const MAIN_LOD_HOLD = 0.4;
// Skok kadru szybszy niż to (teleport, cięcie kamery) nie jest ruchem — to, co jest w nowym kadrze, i tak rodzi się
// od nowa (przedtem leżało poza pudłem rozgrzania).
const VIEW_CUT_SPEED = 200000;

// Kadr tej klatki dla LOD dysz MAIN (raz na klatkę, przed okrętami). Tylko kamera z góry jednego gracza: kamera
// drugiego gracza (podzielony ekran) jedzie osobno, a jej ruchu tu nie śledzimy.
function prepareMainLod(view, dt, win) {
  const t = viewTrack;
  const cam = win ? win.camera : null;
  const cx = Number(cam?.x);
  const cy = Number(cam?.y);
  const cz = Number(cam?.zoom);
  // ruch kadru znany dopiero od drugiej klatki z kamerą — w pierwszej bez LOD
  let known = false;
  if (Number.isFinite(cx) && Number.isFinite(cy) && cz > 0) {
    if (t.ok && dt > 1e-4) {
      known = true;
      const vx = (cx - t.x) / dt;
      const vy = -(cy - t.y) / dt;                     // scena: y w górę
      const sp = Math.sqrt(vx * vx + vy * vy);
      const decay = Math.exp(-dt / MAIN_LOD_HOLD);
      if (sp > VIEW_CUT_SPEED) {
        t.vx = 0; t.vy = 0; t.hold = 0; t.grow = 0;
      } else {
        t.vx = vx; t.vy = vy;
        t.hold = Math.max(sp, t.hold * decay);
        // względne tempo oddalania [1/s] — połowa boku kadru rośnie jak 1 / zoom
        const grow = cz < t.zoom ? (t.zoom / cz - 1) / dt : 0;
        t.grow = Math.max(grow, t.grow * decay);
      }
    }
    t.x = cx; t.y = cy; t.zoom = cz; t.ok = true;
  } else {
    t.ok = false;
  }
  const hw = Number(view?.drawHalfW);
  const hh = Number(view?.drawHalfH);
  frameCtx.mainLod = frameCtx.lod && known && !(win && win.splitScreenMode)
    && Number.isFinite(hw) && Number.isFinite(hh) && Number.isFinite(frameCtx.drawMargin);
  if (!frameCtx.mainLod) return;
  frameCtx.viewX = Number(view.x) || 0;
  frameCtx.viewY = -(Number(view.y) || 0);
  frameCtx.viewHW = hw;
  frameCtx.viewHH = hh;
  frameCtx.viewVX = t.vx;
  frameCtx.viewVY = t.vy;
  // + nadwyżka szczytu prędkości kadru nad bieżącą i brzeg kadru przy oddalaniu
  frameCtx.viewGrow = (t.hold - Math.sqrt(t.vx * t.vx + t.vy * t.vy)) + t.grow * (hw > hh ? hw : hh);
  // Zapas: kadr tej klatki jest ze wstrząsem (do shakeMaxPx w każdą stronę — za chwilę może być po drugiej), a
  // przyspieszenia kadru (szarpnięcie kursora w postawie walki, start przejścia) prędkość nie przewiduje — margines
  // pudła rysowania (96 px).
  const shakeRaw = Number(win?.cameraRig?.tune?.shakeMaxPx);
  const shakePx = Number.isFinite(shakeRaw) ? Math.max(0, shakeRaw) : 80;
  frameCtx.viewPad = frameCtx.drawMargin + (2 * shakePx) / frameCtx.zoom;
}

// Czy strugi i iskry wypuszczone w tej klatce z wylotu (x, y — scena) nie sięgną kadru (prepareMainLod) w swoim
// życiu. Prędkość dyszy: okręt (vx, vy — scena) + obrót (`spin` = |ω| × ramię dyszy, j/s).
function mainJetsOffView(x, y, radius, lengthMul, widthMul, sparks, vx, vy, spin) {
  // odległość wylotu za kadrem po osi (nie większa niż prawdziwa odległość od prostokąta kadru) minus zapas
  const ox = Math.abs(x - frameCtx.viewX) - frameCtx.viewHW;
  const oy = Math.abs(y - frameCtx.viewY) - frameCtx.viewHH;
  const out = (ox > oy ? ox : oy) - frameCtx.viewPad;
  if (!(out > 0)) return false;
  const rvx = vx - frameCtx.viewVX;
  const rvy = vy - frameCtx.viewVY;
  const rel = Math.sqrt(rvx * rvx + rvy * rvy) + spin + frameCtx.viewGrow;
  const speed = Math.sqrt(vx * vx + vy * vy) + spin;
  return out > mainExhaustReach(radius, lengthMul, widthMul, rel, speed, sparks);
}
const mainPush = {
  x: 0, y: 0, dirX: 0, dirY: -1, radius: 0, throttle: 0, boost: false,
  lengthMul: 1, widthMul: 1, palette: 0, jetGain: 1, sparkMul: 1, pixelRadius: 99, dt: 0
};
// Dysza SIDE dla SideJets3D.push (obiekt wielokrotnego użytku — gorąca pętla klatki).
const sidePush = {
  x: 0, y: 0, dirX: 0, dirY: -1, radius: 0, fire: 0, idle: 0, dead: false, palette: 0, gain: 1,
  entity: null, fromRender: false, sparks: false
};

function updateEffects(entity, fxData, dt) {
  const interpPose = getInterpolatedPose(entity);
  const ex = interpPose ? interpPose.x : (entity?.pos ? entity.pos.x : (entity?.x || 0));
  const ey = interpPose ? interpPose.y : (entity?.pos ? entity.pos.y : (entity?.y || 0));
  const angle = interpPose ? interpPose.angle : (entity?.angle || 0);
  const scale = getEntityScale(entity);
  const classScale = getEngineVfxClassScale(entity);

  const sceneOriginY = -ey;
  const sceneAngle = -angle;
  const cA = Math.cos(sceneAngle);
  const sA = Math.sin(sceneAngle);

  const speed = Math.hypot(entity.vx || entity.vel?.x || 0, entity.vy || entity.vel?.y || 0);
  const moveGlow = Math.min(speed / 900, 0.6) * 0.8;
  const thrustMain = Math.max(
    0,
    entity.thrusterInput?.main || 0,
    entity.input?.main || 0,
    entity.input?.thrustY || 0
  );
  const strafeLeft = Math.max(0, entity.thrusterInput?.leftSide || 0);
  const strafeRight = Math.max(0, entity.thrusterInput?.rightSide || 0);
  const torque = Math.abs(entity.thrusterInput?.torque || 0);
  const mainThrottle = Math.max(thrustMain, moveGlow);

  const lengthScale = entity.capitalProfile?.lengthScale || 3.2;
  const widthScale = entity.capitalProfile?.widthScale || 1.2;
  const radius = entity.radius || 20;
  const halfL = radius * lengthScale * 0.5;
  const halfW = radius * widthScale * 0.5;

  // MAIN: rozmiar i paleta per statek, tryb skoku, dopalacz — raz na encję.
  const engineFx = resolveEntityEngineFx(entity);
  const warpMode = resolveWarpMode(entity);
  // Silniki MAIN wyłączone / zapłon / gaszenie (src/game/engineIgnition.js — etap E2): moc strugi MAIN (z płomykiem
  // jałowym) × mnożnik stanu; rampa mocy strugi (mainExhaust3D) wygładza resztę. Encja bez stanu — 1.
  const plumeK = entity.engineIgn ? enginePlumeScale(entity) : 1;
  const plumeKick = entity.engineIgn ? engineIgnitionKick(entity) : 0;   // silnik „łapie” — rozbłysk strugi w zapłonie
  const mainBoost = resolveMainBoost(entity) && plumeK >= 1;
  const isPlayerEntity = entity === RenderWorld.ship || entity.isPlayer === true;
  const isHulk = entity.isBridgeHulk === true;
  const jetGainRaw = isPlayerEntity ? Number(RenderWorld.options?.vfx?.bloomGain) : NaN;
  const jetGain = Number.isFinite(jetGainRaw) && jetGainRaw >= 0 ? jetGainRaw : 1;
  const sparkMul = isPlayerEntity ? 1 : NPC_SPARK_MUL;
  // Maskowanie (src/game/cloakLook.js): dysza gaśnie z komórką kadłuba pod sobą; ukryty okręt zostawia
  // samo drżenie gorącego powietrza (refrakcja — jak reszta maskowania).
  const cloakLook = entity.__cloakLook && entity.__cloakLook.active ? entity.__cloakLook : null;
  // dysze MAIN tego okrętu do listy klatki (poświata dysz na pyle); prędkość w scenie (y w górę)
  EngineFrame.beginShip(entity, Number(entity.vel?.x ?? entity.vx) || 0, -(Number(entity.vel?.y ?? entity.vy) || 0), isPlayerEntity);
  // Kadłub belkowy: dysze, których komórka nie jest już żywym węzłem ciała (odcięta z odłamem, zestrzelona).
  const nozzleAlive = syncNozzleMounts(entity, fxData);
  // Modele dysz SIDE (sideNozzleFrame.js): pierwsza dysza tego okrętu na liście klatki (zdublowane markery — jedna bryła).
  const sideModels = SideNozzleFrame.enabled;
  const sideFrom = SideNozzleFrame.count;
  // LOD dysz SIDE tego okrętu (audyt FPS 2026-10-11; promień wylotu ten sam dla wszystkich jego dysz SIDE, piksele
  // z zoomu kamery z góry — frameCtx.lod):
  //   sideModelsHere — model dyszy przejdzie próg rysownika (shipModels3DGame.js publikuje go w
  //     SideNozzleFrame.modelMinPx); dawniej lista klatki dostawała każdą dyszę w kadrze, a rysownik odrzucał ją
  //     dopiero po pracy na okręt (przy zoomie 0,1 — wszystkie). A/B: SideNozzleFrame.sourceLod;
  //   sideQuiet — dysze SIDE nie dadzą w kadrze nic: wylot mniejszy niż próg strugi (SIDE_JET_TUNE.minJetPx —
  //     najmniejszy z progów strugi, gazu, świateł i modelu) albo okręt poza pudłem rysowania (`__inDrawBox`,
  //     hexShips3D.js) dalej, niż sięga struga (SIDE_JET_REACH_R promieni wylotu), z wylotem poniżej progu świateł
  //     (dysza nie dawała ani światła, ani gazu; od 2026-10-12 limit świateł SIDE liczy tylko światła przyjęte
  //     przez siatkę, więc próg świateł zostaje tylko z ostrożności) — wtedy sam automat dyszy (stan ciągły), bez
  //     strugi, gazu, świateł, modelu i gorącego powietrza
  //     (takich źródeł Core3D i tak nie bierze: dysza < 3 px albo spoza kadru). A/B: SideJets3D.lod.
  const sideR = SIDE_NOZZLE_RADIUS * scale * classScale * frameCtx.sideWidthMul;
  const sidePx = sideR * frameCtx.zoom;
  const lod = frameCtx.lod;
  const sideModelsHere = sideModels && (!lod || !SideNozzleFrame.sourceLod || sidePx >= frameCtx.modelMinPx);
  const sideQuiet = lod && SideJets3D.enabled && SideJets3D.lod && (sidePx < SIDE_JET_TUNE.minJetPx
    || (entity.__inDrawBox === false && sidePx < SIDE_JET_TUNE.minLightPx && sideR * SIDE_JET_REACH_R <= frameCtx.drawMargin));
  // LOD dysz MAIN za kadrem (audyt FPS 2026-10-11 § 6.2 pkt 2): okręt poza pudłem rysowania — dysza, której strugi
  // i iskry wypuszczone w tej klatce nie sięgną kadru w swoim życiu (mainExhaustReach: struga ≈ 25 R × długość,
  // iskry ≈ 38 R, plus ruch dyszy względem kadru), nie wypuszcza ich (pixelRadius = 0). Moc i żar dyszy liczą się
  // dalej — poświata dysz na pyle, światła dysz na kadłubach, gorące powietrze i zapłon (EngineFrame) bez zmian.
  // Prędkość dyszy względem kadru: ruch okrętu − ruch kadru + obrót okrętu (ω × ramię dyszy). A/B:
  // MainExhaust3D.offscreenLod (MainLodStats.cut liczy dysze bez strug także przy wyłączonym).
  const mainLod = frameCtx.mainLod && entity.__inDrawBox === false;
  let shipVX = 0;
  let shipVY = 0;
  let shipSpin = 0;
  if (mainLod) {
    shipVX = Number(entity.vel?.x ?? entity.vx) || 0;
    shipVY = -(Number(entity.vel?.y ?? entity.vy) || 0);
    shipSpin = Math.abs(Number(entity.angVel) || 0) * scale;
  }

  const exhausts = fxData.exhausts;
  for (let n = 0; n < exhausts.length; n++) {
    const item = exhausts[n];
    // …albo dysza MAIN zniszczona (src/game/engineDamage.js — zatrzask do remontu w doku, także gdy rój dronów
    // odbuduje komórkę pod nią).
    if ((nozzleAlive !== null && nozzleAlive[n] === 0) || item.slot?.source?.__destroyed === true) {
      cutNozzle(item);
      continue;
    }
    const slot = item.slot || {};

    const forcedThrottleRaw = Number(slot?.source?.__throttle);
    const hasForcedThrottle = Number.isFinite(forcedThrottleRaw);
    let slotThrottle = mainThrottle;
    // SIDE: ciąg manewrowy (nowe dysze — sideJets3D.js) osobno od jałowego połysku szybkiego lotu (płomyk).
    let sideFire = 0;
    let sideIdle = 0;
    if (slot.kind === 'side') {
      const sideDrive = slot.side === 'left'
        ? strafeLeft
        : (slot.side === 'right' ? strafeRight : Math.max(strafeLeft, strafeRight));
      slotThrottle = Math.max(sideDrive, torque * 0.8, moveGlow * 0.55);
      sideFire = Math.max(sideDrive, torque * 0.8);
      sideIdle = moveGlow * 0.55;
    } else if (!isHulk) {
      slotThrottle = Math.max(slotThrottle, MAIN_IDLE_THROTTLE);
    }
    // __throttle: ciąg dyszy z modelu dysz (thrusterModel.js — gracz i NPC) albo wymuszony (narzędzia).
    if (hasForcedThrottle) {
      slotThrottle = forcedThrottleRaw;
      sideFire = forcedThrottleRaw;
      sideIdle = 0;
    }
    slotThrottle = Math.max(0, Math.min(1, slotThrottle));

    // Pozycje dysz pozostają w przestrzeni kadłuba. vfxScale dyszy dławi ją
    // przy utracie dowodzenia (shipBridge) — dla MAIN i SIDE tak samo.
    const slotScaleRaw = Number(slot?.source?.vfxScale);
    const slotScale = Number.isFinite(slotScaleRaw) && slotScaleRaw > 0 ? slotScaleRaw : 1;

    // Dysza SIDE bez obrazu w tej klatce (sideQuiet wyżej): sam automat — gdy okręt urośnie na ekranie albo wjedzie
    // w kadr, struga rusza z właściwej fazy impulsu, mocy i żaru.
    if (sideQuiet && slot.kind === 'side') {
      SideJets3D.idle(item.jet, Math.max(0, Math.min(1, sideFire)) * (slotScale < 1 ? slotScale : 1));
      continue;
    }

    const slotForward = resolveSlotForward(slot);
    const offset = slot.offset || { x: 0, y: 0 };
    const lx = slot.mode === 'normalized'
      ? (offset.x || 0) * halfL
      : (offset.x || 0);
    const ly = slot.mode === 'normalized'
      ? -(offset.y || 0) * halfW
      : -(offset.y || 0);

    // Rozwiniety lancuch transformacji, ktory wczesniej robila hierarchia
    // Object3D: T(ex,-ey) . Rz(-angle) . S(scale) . T(lx,ly). Skala encji jest
    // jednorodna, wiec przechodzi przez obrot i mozna ja zwinac do jednej
    // pozycji i jednego kata na dysze.
    const nozzleWorldX = ex + (lx * scale) * cA - (ly * scale) * sA;
    const nozzleWorldY = sceneOriginY + (lx * scale) * sA + (ly * scale) * cA;
    // (nozzleWorldY jest w układzie sceny — świat gry ma y odwrócone)
    const cloakVis = cloakLook ? cloakVisAtWorld(cloakLook, nozzleWorldX, -nozzleWorldY) : 1;

    // Kierunek wydechu = os dyszy (slotForward) obrocona do sceny,
    // spojnie z meshem plomienia — nie wektor srodek statku -> dysza.
    const fwdX = Number(slotForward.x);
    const fwdY = Number(slotForward.y);
    const localDirX = Number.isFinite(fwdX) ? -fwdX : 0;
    const localDirY = Number.isFinite(fwdY) ? fwdY : 1;
    let dirX = localDirX * cA - localDirY * sA;
    let dirY = localDirX * sA + localDirY * cA;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
    if (dirLen > 0.0001) {
      dirX /= dirLen;
      dirY /= dirLen;
    } else {
      dirX = 0;
      dirY = -1;
    }

    if (slot.kind !== 'side') {
      const nozzleR = Math.max(0, Number(engineFx.nozzleRadius) || 0) * scale * slotScale;
      const warpUse = driveWarpPlume(item, isHulk ? 'off' : warpMode, frameCtx,
        nozzleWorldX, nozzleWorldY, dirX, dirY, nozzleR, engineFx);
      const warpOn = warpUse === 'on';
      const warpFallback = warpUse === 'fallback';

      const p = mainPush;
      p.x = nozzleWorldX;
      p.y = nozzleWorldY;
      p.dirX = dirX;
      p.dirY = dirY;
      p.radius = nozzleR;
      // Plazma pali — struga MAIN gaśnie; skok bez wolnej instancji — dopalacz.
      p.throttle = warpOn ? 0 : (warpFallback ? 1 : Math.max(slotThrottle, plumeKick) * plumeK);
      p.boost = !warpOn && (warpFallback || mainBoost);
      p.lengthMul = Number(engineFx.mainLength) > 0 ? Number(engineFx.mainLength) : 1;
      p.widthMul = Number(engineFx.mainWidth) > 0 ? Number(engineFx.mainWidth) : 1;
      p.palette = engineFx.mainPaletteIndex | 0;
      p.jetGain = jetGain * cloakVis;
      p.sparkMul = sparkMul * cloakVis;
      p.pixelRadius = nozzleR * frameCtx.zoom;
      p.dt = dt;
      MainLodStats.nozzles++;
      if (mainLod) {
        MainLodStats.offBox++;
        // iskry jak w push: wylot ≥ 1,2 px i mnożnik iskier > 0; uderzenie dopalacza (kick) sypie nimi bez progu
        const sparks = p.sparkMul > 0 && (p.pixelRadius >= 1.2 || (p.boost && !item.main.boosting));
        if (mainJetsOffView(nozzleWorldX, nozzleWorldY, nozzleR, p.lengthMul, p.widthMul, sparks,
          shipVX, shipVY, shipSpin * Math.sqrt(lx * lx + ly * ly))) {
          MainLodStats.cut++;
          if (MainExhaust3D.offscreenLod) p.pixelRadius = 0;
        }
      }
      MainExhaust3D.push(item.main, p);
      // moc strugi po rampie (dopalacz do 1,5); plazma warpa i hulk — bez poświaty
      EngineFrame.nozzle(nozzleWorldX, nozzleWorldY, dirX, dirY, nozzleR,
        warpOn || isHulk ? 0 : (Number(item.main.power) || 0) * cloakVis, p.palette);

      // Gorące powietrze jak w demie plazmy: źródło = wylot (promień dyszy),
      // siła = rampa mocy × (1 + 0,5 · dopalacz); kształt stożka liczy uberPass.
      if (nozzleR > 0 && Core3D.pushHeatHazeWorld) {
        const plume = warpOn ? item.warp : null;
        const hazePower = plume ? plume.ch.power : Math.min(1, item.main.power);
        const hazeBoost = plume ? plume.ch.boost : (item.main.boosting ? 1 : 0);
        const hazeK = smoothstep(0.08, 0.45, hazePower) * (1 + 0.5 * hazeBoost) * (0.55 + 0.45 * cloakVis);
        if (hazeK > 0.01) {
          Core3D.pushHeatHazeWorld(nozzleWorldX, nozzleWorldY, -4, nozzleR * (plume ? 1 : p.widthMul), hazeK, dirX, dirY);
        }
      }
      continue;
    }

    const tune = frameCtx.tune;
    const widthMul = frameCtx.sideWidthMul;

    // Model dyszy SIDE: oś obrotu w markerze (nozzleWorld), dzwon wzdłuż wydechu — struga, gaz, światło i gorące
    // powietrze zaczynają się w WYLOCIE dzwonu (promień wylotu jak rdzeń strugi — sideNozzleFrame.js).
    const sideNozzleR = SIDE_NOZZLE_RADIUS * scale * classScale * widthMul;
    let flameX = nozzleWorldX;
    let flameY = nozzleWorldY;
    if (sideModels) {
      flameX += dirX * SIDE_NOZZLE_MOUTH * sideNozzleR;
      flameY += dirY * SIDE_NOZZLE_MOUTH * sideNozzleR;
    }

    let jetPower = 0;
    let jetHeat = 0;
    if (SideJets3D.enabled) {
      // Dysze SIDE na WebGPU (sideJets3D.js): praca impulsowa, struga TSL, gaz w pulach GPU, światło na blasze.
      // Utrata dowodzenia (vfxScale dyszy < 1) dławi ciąg, hulk bez płomyka dyżurnego.
      const jp = sidePush;
      jp.x = flameX;
      jp.y = flameY;
      jp.dirX = dirX;
      jp.dirY = dirY;
      jp.radius = sideNozzleR;
      jp.fire = Math.max(0, Math.min(1, sideFire)) * (slotScale < 1 ? slotScale : 1);
      jp.idle = sideIdle;
      jp.dead = isHulk;
      jp.palette = engineFx.mainPaletteIndex | 0;
      jp.gain = cloakVis * jetGain;
      jp.entity = entity;
      jp.fromRender = interpPose !== null;
      SideJets3D.push(item.jet, jp);
      jp.entity = null;
      jetPower = item.jet.power;
      jetHeat = item.jet.heat;
    } else {
      // Dawny płomień SIDE (engineExhaustBatch.js — A/B: SideJets3D.enabled = false).
      const lengthMul = Math.max(0.05, Number(tune?.sideL) || 1);
      const curveVal = Number(tune?.sideCurve ?? tune?.curve);
      const curve = Number.isFinite(curveVal) ? Math.max(0.2, Math.min(4.0, curveVal)) : 1.8;
      // Płomień boczny skaluje się z klasą statku, a globalny tuner jest końcowym mnożnikiem.
      const effectScale = classScale * slotScale;
      const state = item.state;
      state.curve = curve;
      state.throttleTarget = slotThrottle;
      if (entity.isPlayer && RenderWorld.options?.vfx) {
        const driveColorTemp = Number(RenderWorld.driveState?.engineColorTempK);
        state.colorTempK = Number.isFinite(driveColorTemp)
          ? driveColorTemp
          : RenderWorld.options.vfx.colorTempK;
        state.bloomGain = RenderWorld.options.vfx.bloomGain;
      }
      // Dalej łańcuch dyszy bocznej: . Rz(nozzleRot) . S(widthMul*effectScale,
      // lengthMul*effectScale) — para skal na instancję. Maskowanie: jasność × widoczność komórki dyszy,
      // ukryta dysza bez instancji.
      if (cloakVis > 0.01) {
        const nozzleRot = Math.atan2(-slotForward.y, slotForward.x) - (Math.PI * 0.5);
        EngineExhaustBatch.push(state, {
          x: flameX,
          y: flameY,
          rot: sceneAngle + nozzleRot,
          scaleX: scale * widthMul * effectScale,
          scaleY: scale * lengthMul * effectScale,
          dt,
          gain: cloakVis
        });
      }
      jetPower = Number(state.currentThrottle) || 0;
      jetHeat = Number(state.heat) || 0;
    }
    if (cloakVis <= 0.01) continue;

    // Model dyszy na listę klatki (rysuje shipModels3DGame.js). Maskowanie: znika z komórką kadłuba pod sobą
    // (jak wieże 3D — próg 0,5). Kierunek podstawy = wydech w spoczynku (baseDeg — na zewnątrz burty) w scenie.
    if (sideModelsHere && cloakVis >= 0.5 && !SideNozzleFrame.near(sideFrom, nozzleWorldX, nozzleWorldY, sideNozzleR * 0.5)) {
      const src = slot.source;
      const baseDeg = Number.isFinite(Number(src?.baseDeg)) ? Number(src.baseDeg) : (Number(slot.baseDeg) || 0);
      const bRad = baseDeg * Math.PI / 180;
      const bLocalX = -Math.sin(bRad);
      const bLocalY = -Math.cos(bRad);
      SideNozzleFrame.push(entity, src || slot, nozzleWorldX, nozzleWorldY, offset.x || 0, offset.y || 0,
        bLocalX * cA - bLocalY * sA, bLocalX * sA + bLocalY * cA, dirX, dirY, sideNozzleR, jetPower, jetHeat);
    }

    // Ten sam model gorącego powietrza co MAIN (stożek od wylotu w uberPass),
    // słabszy: wylot bocznej dyszy ~1/5 dawnego promienia smugi.
    const sideHaze = smoothstep(0.08, 0.45, jetPower) * 0.6;
    if (sideHaze > 0.01 && Core3D.pushHeatHazeWorld) {
      const sideR = 78 * scale * classScale * slotScale * widthMul * 0.2;
      Core3D.pushHeatHazeWorld(flameX, flameY, -4, sideR, sideHaze, dirX, dirY);
    }
  }
  EngineFrame.endShip();
}

function disposeEffects(fxData) {
  // Stan strugi oddaje właściciela (strugi dogasają same), plazma wraca do puli.
  if (fxData?.exhausts) {
    for (const item of fxData.exhausts) {
      if (item.main) releaseMainExhaustState(item.main);
      if (item.warp) WarpPlume3D.release(item.warp);
      item.main = null;
      item.warp = null;
    }
    fxData.exhausts.length = 0;
  }
}

export const EngineVfxSystem = {
  entityEffects: new Map(),
  _activeScratch: new Set(),
  _lastUpdateSec: 0,
  _frame: 0,

  /**
   * @param {object[]} entities  encje w pudle rozgrzania (hexShips3D.js)
   * @param {number} drawMargin  margines pudła rysowania [j. świata]: kadłub encji z `__inDrawBox === false` leży co
   *                             najmniej tyle za kadrem (LOD dysz SIDE); Infinity — nieznany (bez tego LOD)
   * @param {object} [view]      kadr tej klatki (hexShips3D.js — cullInfo: środek x, y w świecie gry, drawHalfW / H) —
   *                             LOD dysz MAIN za kadrem; bez niego dysze MAIN jak dawniej
   */
  update(entities = [], drawMargin = Infinity, view = null) {
    if (!Core3D.isInitialized || !Core3D.scene) return;

    // Licznik zrodel kasuje pass w Core3D.render(); tutaj tylko dorzucamy.

    // Wspólny Set zamiast nowego co klatkę (update nie jest re-entrant).
    const activeEntities = this._activeScratch;
    activeEntities.clear();
    const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
    // UWAGA na zmiane zachowania: stary kod wolal `exhaust.update(time)`, gdzie
    // `time` to bylo BEZWZGLEDNE performance.now()/1000, a funkcja oczekiwala
    // `dt`. Skutki: wewnetrzne uTime rosnie o kilkanascie tysiecy na klatke
    // (turbulencja i shock diamonds migotaly losowo zamiast plynac, a po dluzszej
    // sesji float32 tracil precyzje), a heatAccumulator saturowal sie do 1.0 w
    // pierwszej klatce (heat glow zawsze na maksa). Teraz leci prawdziwy dt.
    const dt = this._lastUpdateSec > 0 ? Math.max(0, Math.min(0.1, now - this._lastUpdateSec)) : 1 / 60;
    this._lastUpdateSec = now;

    // Kamera tej klatki: zoom do LOD strug, kamera passa ortho do raymarchu
    // plazmy, początek układu strug przy środku kadru (precyzja float32).
    const cam = Core3D.activeCam1;
    frameCtx.dt = dt;
    frameCtx.zoom = Math.max(0.0001, Number(cam?.zoom) || 1);
    frameCtx.camera = Core3D.getPassCamera(true);
    frameCtx.isOrtho = frameCtx.camera === Core3D.cameraOrtho;
    frameCtx.viewportH = Math.max(1, Number(Core3D.renderer?.domElement?.height) || Number(Core3D.height) || 1080);
    frameCtx.playerShip = RenderWorld.ship || null;
    frameCtx.playerPose = frameCtx.playerShip ? (RenderWorld.playerPose || null) : null;
    frameCtx.tune = RenderWorld.vfxTune || null;
    frameCtx.sideWidthMul = Math.max(0.05, Number(frameCtx.tune?.sideW) || 1);
    frameCtx.lod = frameCtx.isOrtho;
    frameCtx.drawMargin = Number.isFinite(drawMargin) && drawMargin > 0 ? drawMargin : 0;
    frameCtx.modelMinPx = Number(SideNozzleFrame.modelMinPx) || 0;
    prepareMainLod(view, dt, RenderWorld); // kamera, podzielony ekran i wstrząs z fasady (camera, splitScreenMode, cameraRig)
    MainLodStats.nozzles = 0;
    MainLodStats.offBox = 0;
    MainLodStats.cut = 0;
    sceneOriginNearCamera(frameOrigin, cam);

    EngineExhaustBatch.begin();
    MainExhaust3D.begin(frameOrigin.x, frameOrigin.y, dt);
    EngineFrame.begin();
    SideNozzleFrame.begin();
    SideJets3D.begin(frameOrigin.x, frameOrigin.y, dt, frameCtx.zoom);

    const frame = ++this._frame;
    for (const entity of entities) {
      if (!entity || entity.dead) continue;

      let fxData = this.entityEffects.get(entity);
      // Te same obiekty wejść układu dysz co przy ostatnim odcisku — bez odcisku (slotInputRefsSame).
      if (!fxData || !slotInputRefsSame(entity, fxData.inputRefs, frame)) {
        const inputHash = slotInputHash(entity);
        if (!fxData || fxData.inputHash !== inputHash) {
          const slots = buildSlots(entity);
          if (!slots.length) continue;
          const slotKey = makeSlotKey(slots);
          if (!fxData || fxData.slotKey !== slotKey) {
            if (fxData) disposeEffects(fxData);
            fxData = createEffects(slots);
            this.entityEffects.set(entity, fxData);
          }
          fxData.inputHash = inputHash;
          fxData.inputRefs.settle = SLOT_INPUT_SETTLE;
        }
        rememberSlotInputRefs(entity, fxData.inputRefs);
      }
      activeEntities.add(entity);
      // Dysze chwilowo bez obrazu (fregata zwiadu w luku / wylot nad Atlasem — src/3d/cargo/scoutBay3D.js).
      if (entity.__enginesHidden === true) continue;

      updateEffects(entity, fxData, dt);
    }

    for (const [entity, fxData] of this.entityEffects) {
      if (!activeEntities.has(entity)) {
        disposeEffects(fxData);
        this.entityEffects.delete(entity);
      }
    }

    EngineExhaustBatch.flush();
    MainExhaust3D.flush(dt);
    SideJets3D.flush();
    const batchStats = EngineExhaustBatch.getStats();
    const mainStats = MainExhaust3D.getStats();
    const sideStats = SideJets3D.getStats();
    // Plazma warpa: ~5 obiektów renderowalnych na aktywną instancję.
    const warpDraws = WarpPlume3D.activeCount * 5;
    DrawCallStats.addEngine(batchStats.nozzles + mainStats.nozzles + sideStats.nozzles,
      batchStats.draws + mainStats.draws + sideStats.draws + warpDraws);
  },

  disposeAll() {
    for (const [, fxData] of this.entityEffects) {
      disposeEffects(fxData);
    }
    this.entityEffects.clear();
    this._lastUpdateSec = 0;
    EngineExhaustBatch.dispose();
    MainExhaust3D.dispose();
    SideJets3D.dispose();
    WarpPlume3D.disposeAll();
  }
};
