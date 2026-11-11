// src/game/hullPower.js
//
// ZASILANIE Z SIATKI BELEK (2026-11-11, stan zasilania okrętu — decyzja użytkownika: „wieże bez zasilania też
// przestają strzelać”). Prąd idzie z KOMORY REAKTORA po żywych belkach kadłuba; część kadłuba bez połączenia z komorą
// traci zasilanie: gasną lampy i dysze (mocowania — hullMounts.js), wieże nie strzelają (capitalAI / kierowanie ogniem
// gracza). Po rozpadzie żywe węzły ciała są zawsze spójne belkami, więc przewodzi tylko „okablowanie”: poszycie,
// wnętrze i grodzie (PLATING / INTERIOR / BULKHEAD), a nie długie wręgi (FRAME — strut od burty do burty, przez dziurę).
// Rdzeń odcięty z odłamem / zniszczony (żadna komórka komory nie żyje na tym ciele) = cały okręt bez prądu.
//
// Maska węzłów (Uint8Array, 1 = zasilany) w pamięci per ciało, liczona od nowa tylko przy zmianie: ciała, liczby
// żywych węzłów, liczby żywych belek (gra; lustro renderu jej nie ma) albo komór rdzeni. Działa na ciele gry i na
// lustrze ciała w workerze renderu (te same pola magazynów: ix, iy, active, CSR adjStart / adj, belki a, b, broken,
// type). Kadłub bez rdzenia — null (wszystko zasilane, jak dawniej). Czysty moduł: bez three, DOM i `window`.

const BEAM_FRAME = 2; // BEAM_TYPE.FRAME (src/game/beamBody3D.js) — wręg nie przewodzi

const _cache = new WeakMap();
let _stack = new Int32Array(1024);

/** Rdzenie bytu, których gospodarzem jest ten byt (gra: `reactorCores`; lustro workera — ta sama lista). */
function coresOf(entity) {
  const list = entity?.reactorCores;
  return Array.isArray(list) && list.length ? list : null;
}

function coreSignature(cores, entity) {
  let sig = 0;
  for (let i = 0; i < cores.length; i++) {
    const c = cores[i];
    if (!c || c.host !== entity) continue;
    sig = (sig * 31 + (c.cellX ? c.cellX.length : 0) * 7 + (Number(c.aliveCount) | 0) + 1) | 0;
  }
  return sig;
}

/**
 * Maska zasilania węzłów ciała kadłuba bytu (1 = zasilany) albo null — kadłub bez rdzenia albo bez ciała
 * (wszystko zasilane). Wynik współdzielony (tylko do odczytu); `version` rośnie przy każdej zmianie maski.
 */
export function hullPowerMask(entity) {
  const hull = entity?.beamHull;
  const body = hull?.body;
  if (!body || body.dead || !body.nodeStore || !body.beamStore) return null;
  const cores = coresOf(entity);
  if (!cores) return null;
  const s = body.nodeStore, e = body.beamStore;
  const active = Number(body.activeNodes) | 0;
  const live = Number.isFinite(body.liveBeams) ? body.liveBeams | 0 : -1;
  const csig = coreSignature(cores, entity);
  let rec = _cache.get(body);
  if (rec && rec.store === s && rec.active === active && rec.live === live && rec.csig === csig) return rec;
  if (!rec) { rec = { store: null, active: -1, live: -1, csig: 0, mask: new Uint8Array(0), version: 0, powered: 0, unpowered: 0 }; _cache.set(body, rec); }
  rec.store = s; rec.active = active; rec.live = live; rec.csig = csig;
  const n = s.count | 0;
  if (rec.mask.length < n) rec.mask = new Uint8Array(n);
  const mask = rec.mask;
  mask.fill(0, 0, n);
  const d = body.dims;
  // węzeł komórki (ix, iy, z = 0) — siatka komórek ciała
  const lat = latticeOf(body, s, d);
  let top = 0;
  for (let ci = 0; ci < cores.length; ci++) {
    const c = cores[ci];
    if (!c || c.host !== entity || !c.cellX) continue;
    for (let k = 0; k < c.cellX.length; k++) {
      const x = c.cellX[k], y = c.cellY[k];
      if (x < 0 || y < 0 || x >= d.x || y >= d.y) continue;
      const i = lat[x + y * d.x];
      if (i < 0 || !s.active[i] || mask[i]) continue;
      mask[i] = 1;
      if (top >= _stack.length) _stack = growStack(_stack);
      _stack[top++] = i;
    }
  }
  // Komora wybita do zera, ale rdzeń jeszcze na tym ciele: prąd z najbliższych żywych sąsiadów komory (8 kierunków).
  if (top === 0) {
    for (let ci = 0; ci < cores.length; ci++) {
      const c = cores[ci];
      if (!c || c.host !== entity || !c.cellX || !(Number(c.aliveCount) > 0 || Number(c.elsewhereCount) === 0)) continue;
      for (let k = 0; k < c.cellX.length; k++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const x = c.cellX[k] + ox, y = c.cellY[k] + oy;
            if (x < 0 || y < 0 || x >= d.x || y >= d.y) continue;
            const i = lat[x + y * d.x];
            if (i < 0 || !s.active[i] || mask[i]) continue;
            mask[i] = 1;
            if (top >= _stack.length) _stack = growStack(_stack);
            _stack[top++] = i;
          }
        }
      }
    }
  }
  const adjStart = s.adjStart, adj = s.adj, A = e.a, B = e.b, broken = e.broken, type = e.type;
  while (top > 0) {
    const i = _stack[--top];
    for (let p = adjStart[i], q = adjStart[i + 1]; p < q; p++) {
      const bi = adj[p];
      if (broken[bi] || type[bi] === BEAM_FRAME) continue;
      const j = A[bi] === i ? B[bi] : A[bi];
      if (j < 0 || j >= n || mask[j] || !s.active[j]) continue;
      mask[j] = 1;
      if (top >= _stack.length) _stack = growStack(_stack);
      _stack[top++] = j;
    }
  }
  let on = 0, off = 0;
  for (let i = 0; i < n; i++) {
    if (!s.active[i]) continue;
    if (mask[i]) on++; else off++;
  }
  rec.powered = on; rec.unpowered = off;
  rec.version++;
  return rec;
}

function growStack(st) {
  const next = new Int32Array(st.length * 2);
  next.set(st);
  return next;
}

// Siatka komórka → węzeł (z = 0), w pamięci per magazyn (jak D._latticeIndex — bez importu silnika).
const _lattice = new WeakMap();
function latticeOf(body, s, d) {
  let L = _lattice.get(s);
  if (L && L.length === d.x * d.y) return L;
  L = new Int32Array(d.x * d.y).fill(-1);
  for (let i = 0; i < s.count; i++) {
    if (s.iz && s.iz[i] !== 0) continue;
    const c = s.ix[i] + s.iy[i] * d.x;
    if (c >= 0 && c < L.length) L[c] = i;
  }
  _lattice.set(s, L);
  return L;
}

/** Komórka (ix + iy · dims.x) zasilana? Bez maski (kadłub bez rdzenia) — true; komórka bez żywego węzła — false. */
export function hullCellPowered(entity, cell) {
  const rec = hullPowerMask(entity);
  if (!rec) return true;
  const body = entity.beamHull.body;
  const lat = latticeOf(body, body.nodeStore, body.dims);
  const i = cell >= 0 && cell < lat.length ? lat[cell] : -1;
  return i >= 0 && rec.mask[i] === 1;
}

/** Statystyka (narzędzia, HUD): { powered, unpowered } żywych węzłów albo null. */
export function hullPowerStats(entity) {
  const rec = hullPowerMask(entity);
  return rec ? { powered: rec.powered, unpowered: rec.unpowered } : null;
}
