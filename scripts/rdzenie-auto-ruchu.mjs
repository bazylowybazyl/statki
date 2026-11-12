// Rdzenie z automatu kadłubów ruchu v2 bez markera w REACTOR_CORE_MARKERS (E17b) — dla OBRAZU proxy bańki.
// NPC po awansie dostaje komorę z `autoReactorMarker` (src/game/reactorCoreGame.js: najgłębsza komórka siatki belek
// przy środku masy); proxy nie ma kadłuba na belkach, więc miejsce liczy ten skrypt na PRAWDZIWYM kadłubie (sprite
// w rozmiarze renderu, HullBodies.createHull jak w tests/trafficHullData.test.mjs) i wypisuje tabelę do
// `src/data/reactorCores.js` (TRAFFIC_AUTO_CORE_MARKERS). Rozgrywka ich nie czyta. Strażnik:
// tests/reactorCoreProxy.test.mjs (tabela = automat).
//
//   node scripts/rdzenie-auto-ruchu.mjs
import { fileURLToPath } from 'node:url';
import { readPng } from './webgpu/png.mjs';
import { resizeBox } from '../tests/helpers/reactorHulls.mjs';
import { TRAFFIC_HULLS } from '../src/data/trafficHulls.js';
import { REACTOR_CORE_MARKERS } from '../src/data/reactorCores.js';
import { getHullRenderSize } from '../src/data/ships.js';
import { HullBodies } from '../src/game/hullBodies.js';
import { autoReactorMarker } from '../src/game/reactorCoreGame.js';

/** Kadłuby ruchu bez markera rdzenia (NPC po awansie — komora z automatu). */
export function trafficHullsWithAutoCore() {
  return Object.keys(TRAFFIC_HULLS).filter((id) => !REACTOR_CORE_MARKERS[id]);
}

/** Marker z automatu na prawdziwym kadłubie belkowym kadłuba ruchu `id` (px PNG) albo null. */
export function autoCoreMarkerFor(id) {
  const img = readPng(fileURLToPath(TRAFFIC_HULLS[id].sprite));
  const size = getHullRenderSize(id, img.width, img.height);
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 1e4, hp: 1000, maxHp: 1000, type: id, shipFrame: id };
  HullBodies.createHull(e, resizeBox(img, size.w, size.h), {
    visualImage: { naturalWidth: img.width, naturalHeight: img.height, width: img.width, height: img.height }
  });
  try {
    return e.beamHull ? autoReactorMarker(e, img.width, img.height) : null;
  } finally {
    HullBodies.release(e);
  }
}

const round = (v) => Math.round(v * 100) / 100;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('export const TRAFFIC_AUTO_CORE_MARKERS = Object.freeze({');
  for (const id of trafficHullsWithAutoCore()) {
    const m = autoCoreMarkerFor(id);
    if (!m) { console.log(`  // ${id}: kadłub za mały — bez rdzenia`); continue; }
    console.log(`  ${id}: Object.freeze({ x: ${round(m.x)}, y: ${round(m.y)}, r: ${round(m.r)} }),`);
  }
  console.log('});');
}
