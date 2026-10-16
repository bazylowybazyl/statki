// src/render/miningSync.js — wydobycie skał w trybie worker (docs/PLAN-render-worker.md RW-41b cz. 2).
//
// Obraz wydobycia (`src/3d/asteroids/minedRocks.js`, `miningView.js`) czyta fizykę skał gry (`AsteroidMining`:
// ciała z siatkami komórek, okruchy, zegar) i platformę gracza (`MiningRig`: drony, piła, ładunki, wiązka, przejęte
// id `taken`, pierścień zdarzeń `fx`). Strona pakuje to raz na klatkę do wiadomości klatki workera:
//   - ciało: pola stałe + siatki (fill, ore, orig, bonds, boulder) TYLKO po zmianie wersji (`body.version`) — z pudłem
//     zmian (`dirtyBox`; strona potwierdza wysłanie jak render inline — `ackMinedUpload`), poza co klatkę;
//   - okruchy, platforma (pola czytane przez miningView), nowe zdarzenia pierścienia, `taken` po zmianie wersji.
// Worker trzyma repliki: ciała to `RockBody` (metody układu skały — ładunki: `localToWorld`), platforma — zwykły
// obiekt o polach MiningRig (zbiór `taken` o stałej tożsamości — warstwa pola chowa przejęte skały po nim).
// Czysty moduł (bez three, DOM i `window`).

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const v3 = (a) => [num(a?.[0]), num(a?.[1]), num(a?.[2])];

/** Stan pakującego (strona): wersje wysłanych ciał, odczyt pierścienia zdarzeń, wersja `taken`, konfiguracja. */
export function createMiningPackState() {
  return { sent: new Map(), fxRead: -1, takenVersion: -1, cfgSent: false };
}

/** Wiadomość klatki z wydobyciem albo null (brak fizyki skał). `ack(body)` — potwierdzenie wysłania zmian siatki. */
export function packMiningFrame(mining, rig, ps, ack) {
  if (!mining) return null;
  const out = { time: num(mining.time), bodies: [], data: [], pebbles: null, rig: null, fx: null, taken: null };
  const seen = new Set();
  for (const b of mining.bodies || []) {
    if (!b) continue;
    seen.add(b.id);
    if (ps.sent.get(b.id) !== b.version) {
      ps.sent.set(b.id, b.version);
      const box = b.dirtyBox ? Array.from(b.dirtyBox) : null;
      out.data.push({
        id: b.id, sourceId: b.sourceId, generation: b.generation, parentId: b.parentId, type: b.type, oreTypeId: b.oreTypeId,
        shape: b.shape, seed: b.seed, r: b.r, sx: b.sx, sy: b.sy, sz: b.sz, sunT: b.sunT,
        cs: b.cs, nx: b.nx, ny: b.ny, nz: b.nz, gx: b.gx, gy: b.gy, gz: b.gz, porosity: b.porosity, anchored: b.anchored,
        version: b.version, box,
        fill: b.fill.slice(), ore: b.ore.slice(), orig: b.orig.slice(), bonds: b.bonds.slice(),
        boulder: b.boulder ? b.boulder.slice() : null
      });
      if (ack) ack(b);
    }
    out.bodies.push(b.id, b.alive ? 1 : 0, b.p[0], b.p[1], b.p[2], b.q[0], b.q[1], b.q[2], b.q[3], b.com[0], b.com[1], b.com[2],
      b.hot[0], b.hot[1], b.hot[2], b.hot[3]);
  }
  for (const id of ps.sent.keys()) if (!seen.has(id)) ps.sent.delete(id);
  const pebs = mining.pebbles || [];
  const P = new Float64Array(pebs.length * 12);
  for (let i = 0; i < pebs.length; i++) {
    const p = pebs[i], o = i * 12;
    P[o] = num(p.id); P[o + 1] = p.p[0]; P[o + 2] = p.p[1]; P[o + 3] = p.p[2];
    P[o + 4] = p.q[0]; P[o + 5] = p.q[1]; P[o + 6] = p.q[2]; P[o + 7] = p.q[3];
    P[o + 8] = num(p.r); P[o + 9] = num(p.type); P[o + 10] = num(p.shape); P[o + 11] = num(p.seed);
  }
  out.pebbles = P;
  if (rig) {
    const sw = rig.saw || {}, sp = rig.sawPoint || {}, pv = rig.sawPreview || {};
    const tc = num(rig.tractorCount);
    out.rig = {
      busy: !!rig.busy, enabled: !!rig.enabled, time: num(rig.time), tractorOn: !!rig.tractorOn, tractorCount: tc,
      tractorTargets: (rig.tractorTargets || []).slice(0, tc).map(v3),
      drones: (rig.drones || []).map((d) => ({ p: v3(d.p), v: v3(d.v), yaw: num(d.yaw), parked: !!d.parked, laserOn: !!d.laserOn,
        phase: num(d.phase), hit: d.hit ? { x: num(d.hit.x), y: num(d.hit.y), z: num(d.hit.z), nx: num(d.hit.nx), ny: num(d.hit.ny), nz: num(d.hit.nz) } : null })),
      saw: { active: !!sw.active, done: !!sw.done, doneAt: num(sw.doneAt), t: num(sw.t), x0: num(sw.x0), y0: num(sw.y0), dx: num(sw.dx), dy: num(sw.dy) },
      sawPoint: { hit: !!sp.hit, x: num(sp.x), y: num(sp.y), z: num(sp.z) },
      sawPreview: { on: !!pv.on, ax: num(pv.ax), ay: num(pv.ay), bx: num(pv.bx), by: num(pv.by) },
      charges: (rig.charges || []).map((c) => ({ body: c.body ? c.body.id : -1, local: v3(c.local), t0: num(c.t0) })),
      fxCap: rig.fx ? rig.fx.length : 0, fxWrite: num(rig.fxWrite),
      cfg: ps.cfgSent ? null : { sawZ: num(rig.cfg?.sawZ) }
    };
    ps.cfgSent = true;
    // nowe zdarzenia pierścienia (pierwsza wiadomość — bez zaległych)
    const fw = num(rig.fxWrite), cap = rig.fx ? rig.fx.length : 0;
    if (ps.fxRead < 0) ps.fxRead = fw;
    if (fw - ps.fxRead > cap) ps.fxRead = fw - cap;
    if (cap && ps.fxRead < fw) {
      out.fx = [];
      for (; ps.fxRead < fw; ps.fxRead++) out.fx.push(ps.fxRead, Object.assign({}, rig.fx[ps.fxRead % cap]));
    }
    if (rig.taken && rig.takenVersion !== ps.takenVersion) {
      ps.takenVersion = rig.takenVersion;
      out.taken = { version: rig.takenVersion, ids: Array.from(rig.taken) };
    }
  }
  return out;
}

/** Repliki workera: { mining: { bodies, pebbles, time }, rig: { …pola MiningRig } } — `rig.taken` stały zbiór. */
export function createMiningReplica() {
  return {
    mining: { bodies: [], pebbles: [], time: 0 },
    rig: {
      taken: new Set(), takenVersion: 0, busy: false, enabled: false, time: 0, drones: [], tractorOn: false, tractorCount: 0,
      tractorTargets: [], saw: { active: false, done: true, doneAt: -1e9, t: 0, x0: 0, y0: 0, dx: 0, dy: 0 },
      sawPoint: { hit: false, x: 0, y: 0, z: 0 }, sawPreview: { on: false, ax: 0, ay: 0, bx: 0, by: 0 },
      charges: [], fx: [], fxWrite: 0, cfg: { sawZ: 0 }
    },
    _byId: new Map()
  };
}

const unionBox = (a, b) => (!a ? b.slice() : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]),
  Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])]);

/** Wiadomość strony → repliki. `RockBody` — klasa ciała (src/game/asteroidMining.js). */
export function applyMiningFrame(m, rep, RockBody) {
  if (!m) return rep;
  const byId = rep._byId;
  for (const d of m.data) {
    let b = byId.get(d.id);
    const fresh = !b || b.nx !== d.nx || b.ny !== d.ny || b.nz !== d.nz;
    if (fresh) {
      b = new RockBody({ id: d.id, sourceId: d.sourceId, generation: d.generation, parentId: d.parentId, type: d.type, oreTypeId: d.oreTypeId,
        shape: d.shape, seed: d.seed, r: d.r, sx: d.sx, sy: d.sy, sz: d.sz, sunT: d.sunT, cs: d.cs, nx: d.nx, ny: d.ny, nz: d.nz,
        gx: d.gx, gy: d.gy, gz: d.gz, porosity: d.porosity, anchored: d.anchored,
        fill: d.fill, ore: d.ore, orig: d.orig, bonds: d.bonds, boulder: d.boulder });
      byId.set(d.id, b);
      b.dirtyBox = null;
    } else {
      b.fill = d.fill; b.ore = d.ore; b.orig = d.orig; b.bonds = d.bonds; b.boulder = d.boulder;
      // pudło zmian od ostatniego wysłania do GPU (worker: ackMinedUpload zeruje); bez pudła — całe ciało
      b.dirtyBox = d.box ? unionBox(b.dirtyBox, d.box) : null;
    }
    b.version = d.version;
  }
  const bodies = rep.mining.bodies;
  bodies.length = 0;
  const B = m.bodies, seen = new Set();
  for (let o = 0; o < B.length; o += 16) {
    const b = byId.get(B[o]);
    if (!b) continue;
    seen.add(B[o]);
    b.alive = B[o + 1] === 1;
    b.p[0] = B[o + 2]; b.p[1] = B[o + 3]; b.p[2] = B[o + 4];
    b.q[0] = B[o + 5]; b.q[1] = B[o + 6]; b.q[2] = B[o + 7]; b.q[3] = B[o + 8];
    b.com[0] = B[o + 9]; b.com[1] = B[o + 10]; b.com[2] = B[o + 11];
    b.hot[0] = B[o + 12]; b.hot[1] = B[o + 13]; b.hot[2] = B[o + 14]; b.hot[3] = B[o + 15];
    bodies.push(b);
  }
  for (const [id, b] of byId) if (!seen.has(id)) { b.alive = false; byId.delete(id); }
  rep.mining.time = m.time;
  const P = m.pebbles, pebs = rep.mining.pebbles, np = P ? P.length / 12 : 0;
  pebs.length = np;
  for (let i = 0; i < np; i++) {
    const o = i * 12;
    const p = pebs[i] || (pebs[i] = { id: 0, p: [0, 0, 0], q: [0, 0, 0, 1], r: 1, type: 0, shape: 0, seed: 0 });
    p.id = P[o]; p.p[0] = P[o + 1]; p.p[1] = P[o + 2]; p.p[2] = P[o + 3];
    p.q[0] = P[o + 4]; p.q[1] = P[o + 5]; p.q[2] = P[o + 6]; p.q[3] = P[o + 7];
    p.r = P[o + 8]; p.type = P[o + 9]; p.shape = P[o + 10]; p.seed = P[o + 11];
  }
  const r = m.rig, rig = rep.rig;
  if (r) {
    rig.busy = r.busy; rig.enabled = r.enabled; rig.time = r.time; rig.tractorOn = r.tractorOn; rig.tractorCount = r.tractorCount;
    rig.tractorTargets = r.tractorTargets; rig.drones = r.drones; rig.saw = r.saw; rig.sawPoint = r.sawPoint; rig.sawPreview = r.sawPreview;
    if (r.cfg) rig.cfg = r.cfg;
    rig.charges = r.charges.map((c) => ({ body: byId.get(c.body) || { alive: false }, local: c.local, t0: c.t0 }));
    if (rig.fx.length !== r.fxCap) { rig.fx = new Array(r.fxCap); for (let i = 0; i < r.fxCap; i++) rig.fx[i] = { kind: 0, x: 0, y: 0, z: 0 }; }
    if (m.fx) for (let i = 0; i < m.fx.length; i += 2) if (r.fxCap) rig.fx[m.fx[i] % r.fxCap] = m.fx[i + 1];
    rig.fxWrite = r.fxWrite;
  }
  if (m.taken) {
    rig.taken.clear();
    for (const id of m.taken.ids) rig.taken.add(id);
    rig.takenVersion = m.taken.version;
  }
  return rep;
}
