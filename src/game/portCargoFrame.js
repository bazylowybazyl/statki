/**
 * PRZEŁADUNEK W PORTACH — RAMKA GRY (E12): co obraz przeładunku ma w tej klatce. Czyta tylko rozgrywkę i jej
 * odczyty — encje bańki ruchu (E6: poza, faza, stanowisko, zegar postoju), kontrakt przeładunku z workera ruchu
 * (`actors.cargo`: tryb LOAD / UNLOAD, postój, surowiec, wypełnienie ładowni — liczy świat ruchu) i ładunek gracza.
 * Obraz (plan dronów, ładownie, taśmy) liczy worker renderu z bloku `cargoOps` (src/render/blocks/cargoOpsBlock.js,
 * src/3d/cargo/portCargo3D.js) — tu nic się nie planuje.
 *
 * Czysty moduł: bez three, DOM i `window` — index.html podaje bańkę, tabele mostu i kamerę.
 */

import { TRAFFIC_CARGO_BAY_HULLS } from '../data/cargoBays.js';
import { K7_BANK_SLOTS } from '../3d/haloRing/haloPortK7Layout.js';
import { HALO_BAY } from '../3d/haloRing/haloPortBays.js';
// Kontrakt przeładunku bańki (E12 ↔ E6): koder w workerze ruchu, układ rekordu — jedno źródło.
import { ACTOR_CARGO_FIELD, ACTOR_CARGO_STRIDE } from './traffic/bubbleCargo.js';

/**
 * Pola zatok wg klasy (id stanowiska `…-MG1`, `…-L01`, `…-M02`, `…-S01`) — wymiary pola, portal taśmy i pół szerokości
 * statku, za którą stoją stoły placu (`yardHalfBeam`): największy frachtowiec ruchu, jaki tam staje, z zapasem na sylwetkę
 * sprite'a (S — prom, M — kontenerowiec, L — frachtowiec dalekiego zasięgu, MEGA — ciężki: sylwetka dalekiego zasięgu
 * w skali 1800 j., ~270 j. od osi). Z `maxBeam` pola plac wypadałby poza pole (MEGA: 1100 przy polu 1150).
 */
export const PORT_CARGO_PADS = Object.freeze({
  S: Object.freeze({ padLength: K7_BANK_SLOTS.S.padLength, padBeam: K7_BANK_SLOTS.S.padBeam, maxBeam: K7_BANK_SLOTS.S.maxBeam, portalGap: 0, yardHalfBeam: 60 }),
  M: Object.freeze({ padLength: K7_BANK_SLOTS.M.padLength, padBeam: K7_BANK_SLOTS.M.padBeam, maxBeam: K7_BANK_SLOTS.M.maxBeam, portalGap: 0, yardHalfBeam: 95 }),
  L: Object.freeze({ padLength: K7_BANK_SLOTS.L.padLength, padBeam: K7_BANK_SLOTS.L.padBeam, maxBeam: K7_BANK_SLOTS.L.maxBeam, portalGap: 0, yardHalfBeam: 130 }),
  // Pas MEGA: dziobem do ściany tylnej zatoki, 150 j. przed nią (haloPortBays: megaZ = backZ + 150 + pół pola).
  MEGA: Object.freeze({ padLength: HALO_BAY.mega.padLength, padBeam: HALO_BAY.mega.padBeam, maxBeam: HALO_BAY.mega.maxBeam, portalGap: 150, yardHalfBeam: 300 })
});

const PHASE_AT_BERTH = new Set(['capture', 'docked', 'undock']);

/** Klasa pola zatoki z id stanowiska ruchu (null — nie zatoka: hala K-7, pomost). */
export function bayBerthSize(berthId) {
  const m = /[:-](MG|L|M|S)\d+$/.exec(String(berthId || ''));
  if (!m) return null;
  return m[1] === 'MG' ? 'MEGA' : m[1];
}

export function createPortCargoFrame() {
  return {
    yards: [], yardCount: 0, ops: [], opCount: 0, player: null,
    _player: { x: 0, y: 0, angle: 0, door: 0, fill: 0, hull: 'atlas', frigate: false, res: [] },
    _yardIndex: new Map(),
    _cargo: new Map(),
    _cargoSeq: -1,
    // Zatoki wszystkich portów bańki (Ziemia, Mars, Jowisz — ten sam układ zatok ringu): lista przebudowywana, gdy
    // worker przyśle nową tabelę stanowisk (rynki w biegu) — klatka nie przegląda pomostów ani hal K-7.
    _bayTables: null,
    _bays: [],
    stats: { yards: 0, ops: 0, withCargo: 0 }
  };
}

function rec(list, i, make) {
  let r = list[i];
  if (!r) { r = make(); list[i] = r; }
  return r;
}

/**
 * Kontrakt przeładunku E6 (`actors.cargo`, krok ACTOR_CARGO_STRIDE) → mapa numer kursu → rekord. Raz na
 * wiadomość workera (sekwencja bufora `actors.seq`). Brak tablicy — pusta mapa (obraz bez przeładunku).
 */
export function syncPortCargoContract(frame, actors, resources) {
  if (!actors || actors.seq === frame._cargoSeq) return frame._cargo;
  frame._cargoSeq = actors.seq;
  const map = frame._cargo;
  for (const v of map.values()) v.seen = false;
  const data = actors.cargo;
  const F = ACTOR_CARGO_FIELD;
  const n = data ? Math.floor(data.length / ACTOR_CARGO_STRIDE) : 0;
  for (let k = 0; k < n; k++) {
    const o = k * ACTOR_CARGO_STRIDE;
    const id = data[o + F.ID];
    let r = map.get(id);
    if (!r) { r = { mode: null, dwell: 0, move: 0, resourceId: null, fill: 0, units: 0, seen: true }; map.set(id, r); }
    const mode = data[o + F.MODE];
    r.mode = mode === 1 ? 'load' : mode === 2 ? 'unload' : null;
    r.dwell = data[o + F.DWELL];
    r.move = data[o + F.MOVE];
    const ri = data[o + F.RES] | 0;
    r.resourceId = ri >= 0 && resources ? (resources[ri]?.id ?? resources[ri] ?? null) : null;
    r.fill = data[o + F.FILL];
    r.units = data[o + F.UNITS];
    r.seen = true;
  }
  for (const [id, v] of map) if (!v.seen) map.delete(id);
  return map;
}

/**
 * Zatoki (pola S / M / L / MEGA poza halami K-7) ze wszystkich portów tabeli `ready.bubblePorts` ({ stacja: [stanowiska] }).
 */
function bayList(frame, ports) {
  if (frame._bayTables === ports) return frame._bays;
  frame._bayTables = ports;
  const out = frame._bays;
  out.length = 0;
  if (!ports) return out;
  for (const list of Object.values(ports)) {
    if (!Array.isArray(list)) continue;
    for (const b of list) {
      if (b.hall === 'K-7') continue;
      const size = bayBerthSize(b.id);
      if (size) out.push({ b, size });
    }
  }
  return out;
}

/**
 * Ramka klatki. o: { bubble (TrafficBubble gry), ports (ready.bubblePorts — wszystkie porty bańki), time (czas mostu
 * w chwili klatki), cam { x, y, zoom }, viewW, viewH, cargo (mapa z syncPortCargoContract), player (rekord gracza albo
 * null), liveSlots (stanowiska z rojem na żywo — preset grafiki) }. Pola tylko w kadrze (+ zapas), przeładunki tylko przy polach zatok i kadłubach z ładownią.
 */
export function buildPortCargoFrame(frame, o) {
  frame.yardCount = 0;
  frame.opCount = 0;
  frame.player = o.player || null;
  frame.time = Number(o.time) || 0;
  frame.liveSlots = Number.isFinite(o.liveSlots) ? o.liveSlots : 8;
  frame.stats.yards = 0; frame.stats.ops = 0; frame.stats.withCargo = 0;
  const bays = bayList(frame, o.ports || null);
  const idx = frame._yardIndex;
  idx.clear();
  const cam = o.cam;
  const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
  // Pola w kadrze z zapasem większym niż obraz trzyma slot roju (portCargo3D: 1,6 × pół kadru) — przeładunek nie
  // znika z ramki, póki rój go liczy.
  const halfW = (o.viewW || 1920) * 0.85 / zoom + 1800;
  const halfH = (o.viewH || 1080) * 0.85 / zoom + 1800;
  if (cam) {
    for (let i = 0; i < bays.length; i++) {
      const b = bays[i].b;
      if (Math.abs(b.x - cam.x) > halfW || Math.abs(b.y - cam.y) > halfH) continue;
      const size = bays[i].size;
      if (frame.yardCount >= 96) break;
      const pad = PORT_CARGO_PADS[size];
      const r = rec(frame.yards, frame.yardCount, () => ({ id: '', x: 0, y: 0, angle: 0, size: 'M', padLength: 0, padBeam: 0, portalGap: 0, halfBeam: 0, seed: 0 }));
      r.id = b.id; r.x = b.x; r.y = b.y; r.angle = b.angle; r.size = size;
      r.padLength = pad.padLength; r.padBeam = pad.padBeam; r.portalGap = pad.portalGap;
      r.halfBeam = pad.yardHalfBeam;
      r.seed = frame.yardCount + 1;
      idx.set(b.id, frame.yardCount);
      frame.yardCount++;
    }
  }
  frame.stats.yards = frame.yardCount;
  const list = o.bubble?.list;
  if (!frame.yardCount) return frame;
  if (o.stress > 0) return stressOps(frame, o);
  if (o.probe) return probeOps(frame, o);
  if (!list) return frame;
  const cargo = o.cargo;
  for (let i = 0; i < list.length && frame.opCount < 48; i++) {
    const a = list[i];
    if (!a.alive || !a.berthId || !PHASE_AT_BERTH.has(a.phase) || a.flags & 64) continue;
    const yi = idx.get(a.berthId);
    if (yi === undefined) continue;
    const hull = TRAFFIC_CARGO_BAY_HULLS[a.hullId];
    if (!hull) continue;
    frame.stats.ops++;
    const c = cargo ? cargo.get(a.id) : null;
    if (!c || !c.mode) continue;
    frame.stats.withCargo++;
    const r = rec(frame.ops, frame.opCount, () => ({ seed: 0, yard: -1, hull: '', x: 0, y: 0, angle: 0, mode: null, fill: 0, resourceId: null, dwell: 0, move: 0, dockTime: 0, halfBeam: 0, capture: false }));
    r.seed = a.id; r.yard = yi; r.hull = hull;
    // Przechwyt: poza jeszcze w drodze na stanowisko (interpolacja bańki) — obraz bez roju na żywo.
    r.capture = a.phase === 'capture';
    // Poza w chwili klatki (cx / cy / ca — ekstrapolacja bańki do kroku; postój = stała poza).
    r.x = a.cx; r.y = a.cy; r.angle = a.ca;
    r.mode = c.mode; r.fill = c.fill; r.resourceId = c.resourceId; r.dwell = c.dwell; r.move = c.move;
    // Zegar postoju: DOCK_TIME z bufora (w chwili a.time) + czas od bufora — przy stanowisku płynie razem z grą.
    r.dockTime = a.dockTime + Math.max(0, (Number(o.time) || 0) - a.time);
    r.halfBeam = a.width * 0.5;
    frame.opCount++;
  }
  return frame;
}

// Narzędzia (`?przeladunekStres=N`): N syntetycznych przeładunków na polach w kadrze (kadłub wg klasy pola, statek
// na środku pola, tryb na zmianę, zegar postoju przesunięty na pole) — pomiar kosztu obrazu bez czekania na ruch.
// Proxy kadłubów nie ma (rysuje je tylko bańka) — mierzy się sam przeładunek.
const STRESS_RES = Object.freeze(['steel', 'copper_ore', 'chips', 'ice', 'fusion_fuel', 'helium3', 'polymer', 'ammo_kinetic']);
const STRESS_HULL = Object.freeze({ S: 'inter_station_shuttle', M: 'container_ship', L: 'long_haul_freighter', MEGA: 'heavy_freighter' });
function stressOps(frame, o) {
  const n = Math.min(o.stress | 0, frame.yardCount, 48);
  const t = Number(o.time) || 0;
  for (let i = 0; i < n; i++) {
    const y = frame.yards[i];
    const r = rec(frame.ops, frame.opCount, () => ({ seed: 0, yard: -1, hull: '', x: 0, y: 0, angle: 0, mode: null, fill: 0, resourceId: null, dwell: 0, move: 0, dockTime: 0, halfBeam: 0 }));
    const unload = (i & 1) === 0;
    r.seed = 900000 + i; r.yard = i; r.hull = STRESS_HULL[y.size] || 'container_ship'; r.capture = false;
    r.x = y.x; r.y = y.y; r.angle = y.angle;
    r.mode = unload ? 'unload' : 'load'; r.fill = 0.85; r.resourceId = STRESS_RES[i % STRESS_RES.length];
    r.dwell = unload ? 120 : 90; r.move = 0;
    // Postój w pętli przesuniętej na pole: wrota, praca roju, zamykanie — wszystkie fazy naraz na różnych polach.
    r.dockTime = ((t + i * 13) % (r.dwell - 4)) + 2;
    r.halfBeam = 0;
    frame.opCount++;
  }
  frame.stats.ops = n;
  frame.stats.withCargo = n;
  return frame;
}

// Narzędzia (`PortCargo.probe([...])`, ?dev): pełne postoje od zera na polach w kadrze (klasa pola wg kadłuba, pole stałe
// przez próbę) zamiast statków bańki — ile ładunku rój przenosi w oknie postoju (wystarczalność). o.probe: { t0 (czas
// mostu startu), list: [{ hull (kadłub ruchu), mode, fill, dwell?, move?, halfBeam? }] }.
const PROBE_SIZE = Object.freeze({ inter_station_shuttle: 'S', container_ship: 'M', long_haul_freighter: 'L', heavy_freighter: 'MEGA', megafreighter: 'MEGA' });
function probeOps(frame, o) {
  const p = o.probe;
  const dt = (Number(o.time) || 0) - (Number(p.t0) || 0);
  for (let i = 0; i < p.list.length && frame.opCount < 48; i++) {
    const it = p.list[i];
    const hull = TRAFFIC_CARGO_BAY_HULLS[it.hull];
    const dwell = Number(it.dwell) || (it.mode === 'load' ? 90 : 120);
    if (!hull || dt > dwell) continue;
    let yi = it.berthId ? frame._yardIndex.get(it.berthId) : undefined;
    if (yi === undefined && !it.berthId) {
      // Najbliższe środka kadru wolne pole tej klasy (slot roju dostają tylko pola w kadrze).
      let best = Infinity;
      for (let k = 0; k < frame.yardCount; k++) {
        const y = frame.yards[k];
        if (y.size !== PROBE_SIZE[it.hull] || p.list.some((q) => q.berthId === y.id)) continue;
        const d = Math.abs(y.x - (o.cam?.x || 0)) + Math.abs(y.y - (o.cam?.y || 0));
        if (d < best) { best = d; yi = k; }
      }
      if (yi !== undefined) it.berthId = frame.yards[yi].id;
    }
    if (yi === undefined) continue;
    const y = frame.yards[yi];
    const r = rec(frame.ops, frame.opCount, () => ({ seed: 0, yard: -1, hull: '', x: 0, y: 0, angle: 0, mode: null, fill: 0, resourceId: null, dwell: 0, move: 0, dockTime: 0, halfBeam: 0, capture: false }));
    r.seed = 800000 + i; r.yard = yi; r.hull = hull; r.capture = false;
    r.x = y.x; r.y = y.y; r.angle = y.angle;
    r.mode = it.mode === 'load' ? 'load' : 'unload'; r.fill = Number.isFinite(it.fill) ? it.fill : 1;
    r.resourceId = it.resourceId || 'steel';
    r.dwell = dwell; r.move = Number(it.move) || 0;
    r.dockTime = Math.max(0, dt);
    r.halfBeam = Number(it.halfBeam) || 0;
    frame.opCount++;
  }
  frame.stats.ops = frame.opCount;
  frame.stats.withCargo = frame.opCount;
  return frame;
}
