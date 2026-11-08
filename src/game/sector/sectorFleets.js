// src/game/sector/sectorFleets.js
//
// FLOTY MIĘDZY UKŁADAMI — rekordy na mapie gwiezdnej (decyzja użytkownika 2026-11-07: gospodarki układów
// są niezależne, a między układami ruszają się tylko floty kupieckie i wojsko). Trzy rodzaje:
//   • KONWÓJ KUPIECKI — między układami rdzenia, po szlakach handlowych (`sector.lanes`, najkrótsza trasa
//     `sector.laneNext`); cel losowany wagą handlu (Sol 5, nazwani sąsiedzi 2,5, reszta rdzenia 1);
//     w porcie stoi 8–22 s. Po napadzie ucieka do najbliższego układu rdzenia.
//   • PATROL — frakcji rdzenia, krąży po układach swojej frakcji; widzi piratów w zasięgu i ich ściga
//     (najwyżej 40 s, tylko w pobliżu rdzenia).
//   • PIRACI — z kryjówek na pograniczu (`sector.pirateBases`): zasadzka na szlaku przy brzegu rdzenia
//     albo przy układzie pogranicza, krążenie 25–50 s, pościg za konwojem albo graczem (najwyżej 30 s),
//     powrót. Rozbita flota znika i wraca z bazy po 150–300 s.
// Starcie (pościg dogonił, < 0,18 ly) rozstrzyga siła + los z ziarna floty; wynik → `state.events`.
//
// Krok STAŁY (`FLEET_TICK` 0,1 s = 10 Hz; `stepFleets` zbiera czas klatek, `advanceFleets` — przewijanie,
// np. po powrocie z układu o czas spędzony w nim). Losowanie tylko z ziarna floty (`rng` w rekordzie) —
// ten sam sektor + te same wejścia gracza → te same floty (test determinizmu). Krok bez alokacji poza
// zdarzeniami. Mgławice spowalniają floty jak gracza i zasłaniają je czujnikom.

import { FACTIONS, FACTION } from '../../data/factions.js';
import { hashU32, rngStep } from './sectorRandom.js';
import { zoneAt, createZoneSample, ZONE } from './sectorZone.js';
import { SECTOR_FLIGHT } from './sectorFlight.js';

export const FLEET_TICK = 0.1;

export const FLEET_KINDS = Object.freeze({
  trade: Object.freeze({ label: 'konwój kupiecki', speed: 0.13, sight: 3.0, dwell: [8, 22], strength: [1, 3] }),
  patrol: Object.freeze({ label: 'patrol', speed: 0.17, sight: 5.0, dwell: [3, 8], strength: [3, 5] }),
  pirate: Object.freeze({ label: 'piraci', speed: 0.19, sight: 4.5, dwell: [12, 30], strength: [2, 4] })
});

export const FLEET_DEFAULTS = Object.freeze({
  trade: 24,
  patrolsPerFaction: 2,
  pirates: 10,
  /** Odległość starcia [ly]. */
  contact: 0.18,
  huntPirate: 30,
  huntPatrol: 40,
  respawn: [150, 300],
  /** Rdzeń „widzi” floty w promieniu rdzenia + tyle [ly] (sieć przekaźników) — UI gracza. */
  relayMargin: 3,
  /** Pamięć zdarzeń. */
  eventCap: 40
});

const MODE = Object.freeze({ DOCKED: 0, TRANSIT: 1, LOITER: 2, HUNT: 3, RETURN: 4, FLEE: 5, GONE: 6 });
export const FLEET_MODE = MODE;
export const FLEET_MODE_LABELS = Object.freeze(['w porcie', 'w drodze', 'zasadzka', 'pościg', 'powrót', 'ucieczka', 'rozbita']);

/**
 * Klasy kadłubów floty (skład z `fleetComposition`): obraz mapy rysuje sylwetki tych klas, przyszły model
 * floty / doku (silniki, paliwo — docs/PLAN-mapa-gwiezdna.md § „Dok międzygwiezdny”) liczy z nich.
 */
export const FLEET_HULL_CLASSES = Object.freeze({
  fregata: Object.freeze({ label: 'fregata', warship: true }),
  niszczyciel: Object.freeze({ label: 'niszczyciel', warship: true }),
  pancernik: Object.freeze({ label: 'pancernik', warship: true }),
  prom: Object.freeze({ label: 'prom', warship: false }),
  kontenerowiec: Object.freeze({ label: 'kontenerowiec', warship: false }),
  frachtowiec: Object.freeze({ label: 'frachtowiec dalekiego zasięgu', warship: false }),
  ciezki: Object.freeze({ label: 'ciężki frachtowiec', warship: false })
});
const FREIGHTERS = Object.freeze(['frachtowiec', 'kontenerowiec', 'ciezki', 'prom', 'frachtowiec']);

/**
 * Skład floty: lista klas kadłubów (pierwsza = prowadzący), z rodzaju i siły, deterministycznie z id floty
 * (nie z `rng` rekordu — skład nie zmienia się w biegu). Konwój: 1 + siła frachtowców, od siły 2 eskorta
 * (fregata na czele); patrol: siła okrętów (niszczyciel prowadzi, przy 5 — pancernik); piraci: siła + 1.
 */
export function fleetComposition(f) {
  const h = { rng: hashU32('skład floty', f.id, f.kind, f.strength) };
  const out = [];
  const s = f.strength | 0;
  if (f.kind === 'trade') {
    if (s >= 2) out.push('fregata');
    for (let i = 0; i < 1 + s; i++) out.push(FREIGHTERS[Math.floor(rngStep(h) * FREIGHTERS.length)]);
  } else if (f.kind === 'patrol') {
    out.push(s >= 5 ? 'pancernik' : 'niszczyciel');
    for (let i = 1; i < s; i++) out.push(i === 1 && s >= 4 ? 'niszczyciel' : 'fregata');
  } else {
    out.push(s >= 4 ? 'pancernik' : 'niszczyciel');
    for (let i = 0; i < s; i++) out.push(rngStep(h) < 0.25 && i > 0 ? 'niszczyciel' : 'fregata');
  }
  return out;
}

const PIRATE_NAMES = ['Kruka', 'Szakala', 'Żmii', 'Wilka', 'Hieny', 'Sępa', 'Szczura', 'Rekina', 'Kosy', 'Ości', 'Mątwy', 'Pająka'];
/** Cel pościgu: gracz. */
export const TARGET_PLAYER = -2;

const rnd = (f) => rngStep(f);
const rrange = (f, a, b) => a + (b - a) * rngStep(f);

/**
 * Stan flot sektora. Zwraca { t, acc, fleets, events, … } — `fleets` to rekordy z liczbami (migawka =
 * JSON), indeksy układów (`sector.systems`).
 */
export function createFleets(sector, opts = {}) {
  const O = { ...FLEET_DEFAULTS, ...opts };
  const S = sector.systems;
  const N = S.length;
  const core = sector.core;
  const weights = new Float64Array(core.length);
  let total = 0;
  core.forEach((i, k) => { total += S[i].tradeWeight; weights[k] = total; });
  const territory = {};
  for (const fid of [FACTION.TERRA_NOVA, FACTION.MARS, FACTION.INNER_CONSORTIUM, FACTION.BELT_UNION, FACTION.OUTER_CONSORTIUM]) {
    territory[fid] = Int16Array.from(core.filter((i) => S[i].faction === fid));
  }
  // Zasadzki: szlaki przy brzegu rdzenia (dalszy koniec > 9 ly od Słońca).
  const borderLanes = Int16Array.from(sector.lanes.map((l, k) => [l, k]).filter(([l]) => Math.max(S[l[0]].distSol, S[l[1]].distSol) > 9).map(([, k]) => k));
  const state = {
    seed: sector.seed,
    t: 0,
    tick: 0,
    acc: 0,
    opts: O,
    fleets: [],
    events: [],
    eventSeq: 0,
    coreWeights: weights,
    coreWeightTotal: total,
    territory,
    borderLanes,
    _zone: createZoneSample(),
    _core: sector.core,
    N
  };
  const mk = (kind, faction, n, extra) => {
    const K = FLEET_KINDS[kind];
    const f = {
      id: `${kind}-${n}`,
      kind,
      faction,
      name: '',
      strength: 1,
      home: -1,
      x: 0, y: 0, vx: 0, vy: 0, heading: 0,
      mode: MODE.DOCKED,
      at: -1, hop: -1, dest: -1,
      tx: 0, ty: 0, lx: 0, ly: 0, ang: 0,
      timer: 0, target: -1, hunt: 0, cooldown: 0,
      loot: kind === 'trade',
      nebula: 0, sensorMul: 1, playerCooldown: 0,
      rng: hashU32(sector.seed, 'flota', kind, n),
      ...extra
    };
    f.strength = Math.round(rrange(f, K.strength[0], K.strength[1] + 0.999) - 0.5) || K.strength[0];
    f.strength = Math.max(K.strength[0], Math.min(K.strength[1], f.strength));
    state.fleets.push(f);
    return f;
  };
  // Konwoje: od razu w drodze (losowy odcinek pierwszego przeskoku trasy) — mapa żyje od pierwszej klatki.
  for (let n = 0; n < O.trade; n++) {
    const f = mk('trade', null, n + 1);
    const from = pickCore(state, f);
    let dest = pickCore(state, f);
    for (let k = 0; k < 8 && dest === from; k++) dest = pickCore(state, f);
    f.faction = S[from].faction;
    f.name = `Konwój ${FACTIONS[f.faction]?.short || '—'}-${n + 1}`;
    if (dest === from) {
      dockAt(f, from, rrange(f, 0, 6));
      continue;
    }
    const hop = sector.laneNext[from * N + dest];
    const k = rrange(f, 0.1, 0.9);
    f.x = S[from].x + (S[hop].x - S[from].x) * k;
    f.y = S[from].y + (S[hop].y - S[from].y) * k;
    f.mode = MODE.TRANSIT;
    f.hop = hop;
    f.dest = dest;
    f.tx = S[hop].x;
    f.ty = S[hop].y;
  }
  let pn = 0;
  for (const fid of Object.keys(territory)) {
    const terr = territory[fid];
    if (!terr.length) continue;
    for (let k = 0; k < O.patrolsPerFaction; k++) {
      const f = mk('patrol', fid, ++pn);
      f.name = `Patrol ${FACTIONS[fid].short}-${k + 1}`;
      f.home = terr[Math.floor(rnd(f) * terr.length) % terr.length];
      dockAt(f, f.home, rrange(f, 0, 4));
    }
  }
  const bases = sector.pirateBases;
  for (let n = 0; n < O.pirates && bases.length; n++) {
    const f = mk('pirate', FACTION.PIRATES, n + 1);
    f.name = `Banda ${PIRATE_NAMES[n % PIRATE_NAMES.length]}${n >= PIRATE_NAMES.length ? ` ${Math.floor(n / PIRATE_NAMES.length) + 1}` : ''}`;
    f.home = bases[n % bases.length];
    dockAt(f, f.home, rrange(f, 0, 10));
  }
  return state;
}

function dockAt(f, sysIdx, timer) {
  f.mode = MODE.DOCKED;
  f.at = sysIdx;
  f.hop = -1;
  f.timer = timer;
  f.vx = 0;
  f.vy = 0;
  f.target = -1;
}

/** Układ rdzenia losowany wagą handlu (indeks układu). */
function pickCore(state, f) {
  const r = rnd(f) * state.coreWeightTotal;
  const w = state.coreWeights;
  for (let k = 0; k < w.length; k++) if (r < w[k]) return state._core[k];
  return state._core[w.length - 1];
}

function pushEvent(state, type, text, a, b, x, y) {
  const ev = { seq: ++state.eventSeq, t: Math.round(state.t * 10) / 10, type, text, a, b, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
  state.events.push(ev);
  if (state.events.length > state.opts.eventCap) state.events.shift();
}

/**
 * Krok flot o czas klatki `dt` [s] (zbiera do kroków 0,1 s; najwyżej `maxTicks` na wywołanie).
 * `player` — { x, y, sensorMul, active } albo null (gracz w układzie / brak). Zwraca liczbę kroków.
 */
export function stepFleets(state, sector, dt, player = null, maxTicks = 20) {
  state._core = sector.core;
  state.acc += Math.max(0, dt);
  let n = 0;
  while (state.acc >= FLEET_TICK && n < maxTicks) {
    state.acc -= FLEET_TICK;
    tickOnce(state, sector, player);
    n++;
  }
  if (n >= maxTicks) state.acc = Math.min(state.acc, FLEET_TICK);
  return n;
}

/** Przewinięcie o `seconds` (bez limitu kroków) — np. czas spędzony przez gracza w układzie. */
export function advanceFleets(state, sector, seconds, player = null) {
  state._core = sector.core;
  const ticks = Math.floor((state.acc + Math.max(0, seconds)) / FLEET_TICK + 1e-9);
  state.acc = state.acc + seconds - ticks * FLEET_TICK;
  for (let i = 0; i < ticks; i++) tickOnce(state, sector, player);
  return ticks;
}

function tickOnce(state, sector, player) {
  const dt = FLEET_TICK;
  state.t += dt;
  state.tick++;
  const S = sector.systems;
  const N = state.N;
  const fleets = state.fleets;
  const z = state._zone;
  for (let i = 0; i < fleets.length; i++) {
    const f = fleets[i];
    const K = FLEET_KINDS[f.kind];
    if (f.cooldown > 0) f.cooldown -= dt;
    if (f.mode === MODE.GONE) {
      f.timer -= dt;
      if (f.timer <= 0) dockAt(f, f.home, rrange(f, 2, 8));
      continue;
    }
    if (f.mode === MODE.DOCKED) {
      const s = S[f.at];
      f.x = s.x;
      f.y = s.y;
      f.nebula = 0;
      f.sensorMul = 1;
      f.timer -= dt;
      if (f.timer <= 0) depart(state, sector, f);
      continue;
    }
    // Warunki strefy floty (mgławica spowalnia i zasłania, burza pcha).
    zoneAt(sector, f.x, f.y, state.t, z);
    f.nebula = z.nebula;
    f.sensorMul = z.sensorMul;
    // Wypatrywanie celów (patrole i piraci, nie w trakcie pościgu).
    if (f.kind !== 'trade' && f.mode !== MODE.HUNT && f.mode !== MODE.RETURN && f.cooldown <= 0) lookForPrey(state, sector, f, player);
    // Cel ruchu wg trybu.
    let speed = K.speed;
    if (f.mode === MODE.HUNT) {
      let px;
      let py;
      let lost = false;
      // Patrol nie goni w głąb pogranicza.
      if (f.kind === 'patrol' && f.x * f.x + f.y * f.y > (sector.options.coreRadius + 12) ** 2) lost = true;
      else if (f.target === TARGET_PLAYER) {
        if (!player || !player.active) lost = true;
        else { px = player.x; py = player.y; }
      } else {
        const t = fleets[f.target];
        if (!t || t.mode === MODE.DOCKED || t.mode === MODE.GONE) lost = true;
        else { px = t.x; py = t.y; }
      }
      f.hunt -= dt;
      if (lost || f.hunt <= 0) {
        endHunt(state, sector, f);
      } else {
        f.tx = px;
        f.ty = py;
        speed *= 1.12;
        const d = Math.sqrt((px - f.x) ** 2 + (py - f.y) ** 2);
        if (d < state.opts.contact) resolveContact(state, sector, f);
      }
    } else if (f.mode === MODE.LOITER) {
      f.timer -= dt;
      f.ang += dt * 0.25;
      f.tx = f.lx + Math.cos(f.ang) * 0.8;
      f.ty = f.ly + Math.sin(f.ang) * 0.8;
      speed *= 0.55;
      if (f.timer <= 0) goHome(f, S);
    }
    if (f.mode === MODE.GONE || f.mode === MODE.DOCKED) continue;
    // Ruch: sterowanie do celu z hamowaniem przy dojściu.
    const dx = f.tx - f.x;
    const dy = f.ty - f.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const v = speed * z.speedMul * (f.mode === MODE.LOITER || f.mode === MODE.HUNT ? 1 : Math.min(1, 0.35 + d / 0.6));
    const inv = d > 1e-6 ? 1 / d : 0;
    const k = Math.min(1, 2.5 * dt);
    f.vx += (dx * inv * v - f.vx) * k;
    f.vy += (dy * inv * v - f.vy) * k;
    f.x += (f.vx + z.windX) * dt;
    f.y += (f.vy + z.windY) * dt;
    if (f.vx * f.vx + f.vy * f.vy > 1e-8) f.heading = Math.atan2(f.vy, f.vx);
    // Dojście do układu (przystanek trasy / cel / dom).
    if (f.hop >= 0) {
      const s = S[f.hop];
      const ds = Math.sqrt((s.x - f.x) ** 2 + (s.y - f.y) ** 2);
      if (ds < ZONE.jumpRadius * 0.8) arriveAt(state, sector, f, f.hop, N);
    } else if (f.mode === MODE.TRANSIT && d < 0.25) {
      // Punkt zasadzki osiągnięty.
      f.mode = MODE.LOITER;
      f.lx = f.tx;
      f.ly = f.ty;
      f.ang = rnd(f) * Math.PI * 2;
      f.timer = rrange(f, 25, 50);
    }
  }
}

function depart(state, sector, f) {
  const S = sector.systems;
  const N = state.N;
  const at = f.at;
  f.at = -1;
  if (f.kind === 'trade') {
    f.loot = true;
    const from = at >= 0 && S[at].zone === 'core' ? at : nearestCoreIndex(sector, f.x, f.y);
    let dest = pickCore(state, f);
    for (let k = 0; k < 8 && dest === from; k++) dest = pickCore(state, f);
    if (dest === from) { dockAt(f, from, rrange(f, 3, 8)); return; }
    f.dest = dest;
    f.hop = sector.laneNext[from * N + dest];
    if (f.hop < 0) { dockAt(f, from, rrange(f, 3, 8)); return; }
    f.mode = MODE.TRANSIT;
    f.tx = S[f.hop].x;
    f.ty = S[f.hop].y;
    f.faction = S[from].faction;
    return;
  }
  if (f.kind === 'patrol') {
    const terr = state.territory[f.faction];
    let pick = -1;
    const cur = at >= 0 ? at : nearestCoreIndex(sector, f.x, f.y);
    for (let k = 0; k < 6; k++) {
      const c = terr[Math.floor(rnd(f) * terr.length) % terr.length];
      if (c === cur) continue;
      pick = c;
      if (Math.sqrt((S[c].x - f.x) ** 2 + (S[c].y - f.y) ** 2) < 14) break;
    }
    if (pick < 0) {
      // Frakcja z jednym układem — patrol krąży po szlakach do sąsiada i wraca.
      pick = sector.core[Math.floor(rnd(f) * sector.core.length) % sector.core.length];
      if (pick === cur) { dockAt(f, cur, rrange(f, 4, 10)); return; }
    }
    f.mode = MODE.TRANSIT;
    f.hop = pick;
    f.dest = pick;
    f.tx = S[pick].x;
    f.ty = S[pick].y;
    return;
  }
  // Piraci: zasadzka na szlaku przy brzegu rdzenia (60%) albo przy układzie pogranicza w zasięgu bazy.
  f.loot = false;
  f.mode = MODE.TRANSIT;
  f.hop = -1;
  const lanes = state.borderLanes;
  if (lanes.length && rnd(f) < 0.6) {
    const l = sector.lanes[lanes[Math.floor(rnd(f) * lanes.length) % lanes.length]];
    const k = rrange(f, 0.25, 0.75);
    const a = S[l[0]];
    const b = S[l[1]];
    // Z boku szlaku (zasadzka obok, nie na osi).
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    const off = rrange(f, -1.2, 1.2) / nl;
    f.tx = a.x + (b.x - a.x) * k + nx * off;
    f.ty = a.y + (b.y - a.y) * k + ny * off;
  } else {
    const home = S[f.home];
    let c = -1;
    for (let k = 0; k < 10; k++) {
      const i = Math.floor(rnd(f) * S.length) % S.length;
      const s = S[i];
      if (s.zone !== 'frontier' || i === f.home) continue;
      if ((s.x - home.x) ** 2 + (s.y - home.y) ** 2 > 22 * 22) continue;
      c = i;
      break;
    }
    const s = c >= 0 ? S[c] : home;
    const a = rnd(f) * Math.PI * 2;
    f.tx = s.x + Math.cos(a) * 1.2;
    f.ty = s.y + Math.sin(a) * 1.2;
  }
}

function arriveAt(state, sector, f, sysIdx, N) {
  const S = sector.systems;
  const K = FLEET_KINDS[f.kind];
  if (f.kind === 'trade' && f.mode === MODE.TRANSIT && sysIdx !== f.dest) {
    // Przystanek trasy — przelot przez studnię układu do następnego.
    f.hop = sector.laneNext[sysIdx * N + f.dest];
    if (f.hop < 0) { dockAt(f, sysIdx, rrange(f, K.dwell[0], K.dwell[1])); return; }
    f.tx = S[f.hop].x;
    f.ty = S[f.hop].y;
    return;
  }
  const dwell = f.mode === MODE.FLEE ? rrange(f, 25, 45) : rrange(f, K.dwell[0], K.dwell[1]);
  dockAt(f, sysIdx, dwell);
}

function goHome(f, S) {
  f.mode = MODE.RETURN;
  f.hop = f.home;
  f.dest = f.home;
  f.tx = S[f.home].x;
  f.ty = S[f.home].y;
  f.target = -1;
}

function endHunt(state, sector, f) {
  f.target = -1;
  f.cooldown = 12;
  if (f.kind === 'pirate') goHome(f, sector.systems);
  else {
    // Patrol wraca do najbliższego układu swojej frakcji.
    const terr = state.territory[f.faction];
    let best = f.home;
    let bd = Infinity;
    for (let k = 0; k < terr.length; k++) {
      const s = sector.systems[terr[k]];
      const d = (s.x - f.x) ** 2 + (s.y - f.y) ** 2;
      if (d < bd) { bd = d; best = terr[k]; }
    }
    f.mode = MODE.TRANSIT;
    f.hop = best;
    f.dest = best;
    f.tx = sector.systems[best].x;
    f.ty = sector.systems[best].y;
  }
}

/** Najbliższy układ rdzenia (indeks). */
function nearestCoreIndex(sector, x, y) {
  let best = sector.core[0];
  let bd = Infinity;
  for (const i of sector.core) {
    const s = sector.systems[i];
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function lookForPrey(state, sector, f, player) {
  const K = FLEET_KINDS[f.kind];
  const fleets = state.fleets;
  const O = state.opts;
  if (f.kind === 'patrol') {
    // Tylko w pobliżu rdzenia (patrol nie goni piratów w głąb pogranicza).
    if (f.x * f.x + f.y * f.y > (sector.options.coreRadius + 8) ** 2) return;
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < fleets.length; j++) {
      const p = fleets[j];
      if (p.kind !== 'pirate' || p.mode === MODE.DOCKED || p.mode === MODE.GONE) continue;
      const range = K.sight * f.sensorMul * p.sensorMul;
      const d = (p.x - f.x) ** 2 + (p.y - f.y) ** 2;
      if (d < range * range && d < bd) { bd = d; best = j; }
    }
    if (best >= 0) startHunt(state, f, best, O.huntPatrol, fleets[best]);
    return;
  }
  // Piraci: konwój w drodze albo gracz w zasięgu wzroku (oba × mgławica przy patrzącym i celu).
  let best = -1;
  let bd = Infinity;
  for (let j = 0; j < fleets.length; j++) {
    const c = fleets[j];
    if (c.kind !== 'trade' || !c.loot || (c.mode !== MODE.TRANSIT && c.mode !== MODE.FLEE)) continue;
    const range = K.sight * f.sensorMul * c.sensorMul;
    const d = (c.x - f.x) ** 2 + (c.y - f.y) ** 2;
    if (d < range * range && d < bd) { bd = d; best = j; }
  }
  if (player && player.active) {
    const range = K.sight * f.sensorMul * (player.sensorMul ?? 1);
    const d = (player.x - f.x) ** 2 + (player.y - f.y) ** 2;
    if (d < range * range && d < bd && f.playerCooldown <= state.t) { bd = d; best = TARGET_PLAYER; }
  }
  if (best !== -1) startHunt(state, f, best, O.huntPirate, best === TARGET_PLAYER ? null : fleets[best], player);
}

function startHunt(state, f, target, time, tf, player = null) {
  f.mode = MODE.HUNT;
  f.target = target;
  f.hunt = time;
  f.hop = -1;
  const who = target === TARGET_PLAYER ? 'Atlas' : tf.name;
  const x = target === TARGET_PLAYER ? player.x : tf.x;
  const y = target === TARGET_PLAYER ? player.y : tf.y;
  pushEvent(state, 'poscig', `Pościg: ${f.name} → ${who}`, f.id, target === TARGET_PLAYER ? 'gracz' : tf.id, x, y);
}

function resolveContact(state, sector, f) {
  const fleets = state.fleets;
  if (f.target === TARGET_PLAYER) {
    // Gracz: w grze — starcie w strefie (scena walki). Tu zdarzenie i odskok bandy.
    pushEvent(state, 'przechwycenie', `Przechwycenie: ${f.name} dopada Atlasa`, f.id, 'gracz', f.x, f.y);
    f.playerCooldown = state.t + 60;
    f.cooldown = 20;
    goHome(f, sector.systems);
    return;
  }
  const t = fleets[f.target];
  const a = f.strength + rnd(f) * 2;
  const b = t.strength + rnd(t) * 2;
  if (f.kind === 'pirate') {
    if (a > b) {
      t.loot = false;
      t.mode = MODE.FLEE;
      const c = nearestCoreIndex(sector, t.x, t.y);
      t.hop = c;
      t.dest = c;
      t.tx = sector.systems[c].x;
      t.ty = sector.systems[c].y;
      f.loot = true;
      pushEvent(state, 'napad', `Napad: ${f.name} łupi ${t.name}`, f.id, t.id, f.x, f.y);
    } else {
      pushEvent(state, 'odparty', `Napad odparty: ${t.name} (atak: ${f.name})`, t.id, f.id, f.x, f.y);
    }
    f.cooldown = 20;
    goHome(f, sector.systems);
    return;
  }
  // Patrol kontra piraci: przegrany znika i wraca z bazy.
  const loser = a > b ? t : f;
  const winner = loser === t ? f : t;
  loser.mode = MODE.GONE;
  loser.timer = rrange(loser, state.opts.respawn[0], state.opts.respawn[1]);
  loser.target = -1;
  loser.hop = -1;
  winner.cooldown = 15;
  pushEvent(state, 'bitwa', `Bitwa: ${winner.name} rozbija ${loser.kind === 'pirate' ? 'piratów' : 'patrol'} (${loser.name})`, winner.id, loser.id, f.x, f.y);
  if (winner === f) endHunt(state, sector, f);
  else goHome(winner, sector.systems);
}

/**
 * Czy gracz widzi flotę: nie w porcie i nie rozbita; w zasięgu przekaźników rdzenia albo czujników
 * (zasięg × mgławica przy graczu i przy flocie).
 */
export function fleetVisibleToPlayer(f, sector, ship, shipSensorMul = 1) {
  if (f.mode === MODE.DOCKED || f.mode === MODE.GONE) return false;
  const relay = sector.options.coreRadius + FLEET_DEFAULTS.relayMargin;
  if (f.x * f.x + f.y * f.y < relay * relay) return true;
  const range = SECTOR_FLIGHT.sensorRange * shipSensorMul * f.sensorMul;
  return (f.x - ship.x) ** 2 + (f.y - ship.y) ** 2 < range * range;
}

/** Migawka (zapis gracza): czas, kroki i rekordy flot (liczby). */
export function fleetSnapshot(state) {
  return {
    seed: state.seed,
    t: state.t,
    tick: state.tick,
    acc: state.acc,
    fleets: state.fleets.map((f) => ({ ...f }))
  };
}

/** Odczyt migawki do stanu z `createFleets` tego samego sektora. */
export function restoreFleets(state, snap) {
  if (!snap || snap.seed !== state.seed || !Array.isArray(snap.fleets) || snap.fleets.length !== state.fleets.length) return false;
  state.t = snap.t;
  state.tick = snap.tick;
  state.acc = snap.acc;
  snap.fleets.forEach((f, i) => Object.assign(state.fleets[i], f));
  return true;
}
