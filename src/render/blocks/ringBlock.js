// src/render/blocks/ringBlock.js — blok migawki: stan ringów „Halo” dla obrazu (docs/PLAN-render-worker.md § 3.2,
// RW-11c; świat ringów po stronie gry — RW-27, src/game/haloRingWorld.js).
//
// Obraz ringów (src/3d/haloRing/haloRingGame.js: update → _portVisuals) czyta z gry: zegar migania świateł hal
// (`world.clock`), dynamiczną część rejestru kolidera każdego ringu — na halę wersję i zajętość stanowisk
// (`berthVersion`, `layout.berths[].occupied / reserved` → lampki), poziom lamp (`lampLevel`), pozy obsługi
// stanowisk (`poses`: zamki pola, ramiona, przewody paliwowe, upust; `settle`, właściciel) — obrys kadłuba gracza
// w hubie (`collider.hubOutline(ship)`) i nadpisanie dachu hali przez fabułę (intro nad K-7). Geometria kolidera
// (płyta, hale, zatoki, przekształcenia) jest statyczna — worker buduje ją sam z układu ringu; ten blok niesie tylko
// to, co się zmienia. Lustro po stronie renderu: `createRingMirror()` + `applyRingBlock(blk, dict, mirror)` →
// `mirror.entries[key] = { hub, halls: [{ berthVersion, lampLevel, berths: [{ id, occupied, reserved }], poses: Map }] }`,
// `mirror.clock`, `mirror.roof`.
//
// Rejestracja (strona gry): `packer.addBlock(createRingBlock())`, w fazie begin `frame.ringWorld = haloWorld`,
// `frame.ringShip = ship`, `frame.ringRoof = nadpisanie dachu albo null`. Czysty moduł (bez three, DOM i `window`).

const POSE_KEYS = ['clamp', 'extension', 'seat', 'lock', 'flow', 'vent'];

export const RING_BLOCK = Object.freeze({
  HEAD: Object.freeze({ N: 0, CLOCK: 1, ROOF: 2, ROOF_KEY: 3, ROOF_HALL: 4, ROOF_CUT: 5, ROOF_FADE: 6, USED: 7, STRIDE: 8 }),
  POSE_KEYS: Object.freeze(POSE_KEYS),
  WORDS: 4096
});

const H = RING_BLOCK.HEAD;
const num = (v) => (typeof v === 'number' ? v : NaN);

// Słowa potrzebne na wpis ringu (do sprawdzenia rozmiaru bloku przed pisaniem).
function entryWords(e, ship) {
  const reg = e.collider && e.collider.registry;
  const hub = ship && !ship.dead && ship.pos && e.collider ? e.collider.hubOutline(ship) : null;
  let w = 3 + (hub ? hub.length * 2 : 0);
  const halls = reg && Array.isArray(reg.halls) ? reg.halls : [];
  for (const h of halls) {
    w += 4;
    const berths = h && h.layout && Array.isArray(h.layout.berths) ? h.layout.berths : [];
    w += berths.length * 3;
    w += (h && h.poses ? h.poses.size : 0) * (3 + POSE_KEYS.length);
  }
  return { w, hub };
}

/** Blok do `packer.addBlock` (faza begin — świat ringów kroczy w render() przed obrazem). */
export function createRingBlock() {
  return {
    name: 'ring', f64: RING_BLOCK.WORDS, phase: 'begin',
    pack(blk, frame, packer) {
      let F = blk.f64;
      const world = frame.ringWorld || null;
      const entries = world && Array.isArray(world.entries) ? world.entries : [];
      const ship = frame.ringShip || null;
      const dict = packer.dict;
      const hubs = [];
      let total = H.STRIDE;
      for (const e of entries) { const r = entryWords(e, ship); hubs.push(r.hub); total += r.w; }
      if (total > F.length) { packer.resizeBlock('ring', { f64: Math.ceil(total * 1.5) }); }
      F[H.N] = 0;
      F[H.CLOCK] = world ? num(world.clock) : NaN;
      const roof = frame.ringRoof || null;
      F[H.ROOF] = roof ? 1 : 0;
      F[H.ROOF_KEY] = roof ? dict.code(roof.key) : -1;
      F[H.ROOF_HALL] = roof ? num(roof.hall) : NaN;
      F[H.ROOF_CUT] = roof ? num(roof.cut) : NaN;
      F[H.ROOF_FADE] = roof ? num(roof.roofFade) : NaN;
      let o = H.STRIDE, n = 0;
      for (let k = 0; k < entries.length; k++) {
        const e = entries[k];
        const reg = e.collider && e.collider.registry;
        const halls = reg && Array.isArray(reg.halls) ? reg.halls : [];
        const hub = hubs[k];
        if (o + entryWords(e, null).w + (hub ? hub.length * 2 : 0) > F.length) break;   // strona niesie, ile się zmieści
        F[o++] = dict.code(e.key);
        F[o++] = hub ? hub.length : -1;
        if (hub) for (let i = 0; i < hub.length; i++) { F[o++] = hub[i].x; F[o++] = hub[i].z; }
        F[o++] = halls.length;
        for (const h of halls) {
          const berths = h && h.layout && Array.isArray(h.layout.berths) ? h.layout.berths : [];
          const poses = h && h.poses ? h.poses : null;
          F[o++] = num(h && h.berthVersion);
          F[o++] = num(h && h.lampLevel);
          F[o++] = berths.length;
          F[o++] = poses ? poses.size : -1;
          for (const b of berths) { F[o++] = dict.code(b.id); F[o++] = dict.code(b.occupied); F[o++] = dict.code(b.reserved); }
          if (poses) {
            for (const [id, p] of poses) {
              F[o++] = dict.code(id);
              for (let i = 0; i < POSE_KEYS.length; i++) F[o++] = num(p[POSE_KEYS[i]]);
              F[o++] = p.settle === undefined ? -1 : (p.settle ? 1 : 0);
              F[o++] = p.owner === undefined ? -2 : dict.code(p.owner);   // -2 brak pola, -1 null
            }
          }
        }
        n++;
      }
      F[H.N] = n;
      F[H.USED] = o;
    }
  };
}

/** Lustro stanu ringów po stronie renderu. */
export function createRingMirror() {
  return { clock: NaN, roof: null, entries: Object.create(null) };
}

/** Strona renderu: stan ringów z bloku strony → lustro (`dict` — słownik strony: value(code)). */
export function applyRingBlock(blk, dict, mirror) {
  const F = blk.f64;
  mirror.clock = F[H.CLOCK];
  if (F[H.ROOF] === 1) {
    const r = mirror.roof || (mirror.roof = {});
    r.key = dict.value(F[H.ROOF_KEY]);
    r.hall = F[H.ROOF_HALL];
    r.cut = F[H.ROOF_CUT];
    r.roofFade = F[H.ROOF_FADE];
  } else mirror.roof = null;
  const n = F[H.N] | 0;
  let o = H.STRIDE;
  const seen = new Set();
  for (let k = 0; k < n; k++) {
    const key = dict.value(F[o++]);
    seen.add(key);
    const m = mirror.entries[key] || (mirror.entries[key] = { hub: null, halls: [] });
    const hn = F[o++];
    if (hn < 0) m.hub = null;
    else {
      if (!m.hub || m.hub.length !== hn) m.hub = Array.from({ length: hn }, () => ({ x: 0, z: 0 }));
      for (let i = 0; i < hn; i++) { m.hub[i].x = F[o++]; m.hub[i].z = F[o++]; }
    }
    const nh = F[o++] | 0;
    if (m.halls.length !== nh) m.halls = Array.from({ length: nh }, () => ({ berthVersion: NaN, lampLevel: NaN, berths: [], poses: null }));
    for (let i = 0; i < nh; i++) {
      const h = m.halls[i];
      h.berthVersion = F[o++];
      h.lampLevel = F[o++];
      const nb = F[o++] | 0;
      const np = F[o++];
      if (h.berths.length !== nb) h.berths = Array.from({ length: nb }, () => ({ id: null, occupied: null, reserved: null }));
      for (let j = 0; j < nb; j++) {
        const b = h.berths[j];
        b.id = dict.value(F[o++]) ?? null;
        b.occupied = dict.value(F[o++]) ?? null;
        b.reserved = dict.value(F[o++]) ?? null;
      }
      if (np < 0) { h.poses = null; continue; }
      if (!h.poses) h.poses = new Map();
      const live = new Set();
      for (let j = 0; j < np; j++) {
        const id = dict.value(F[o++]);
        live.add(id);
        let p = h.poses.get(id);
        if (!p) { p = {}; h.poses.set(id, p); }
        for (let q = 0; q < POSE_KEYS.length; q++) p[POSE_KEYS[q]] = F[o++];
        const st = F[o++];
        if (st < 0) delete p.settle; else p.settle = st === 1;
        const oc = F[o++];
        if (oc === -2) delete p.owner; else p.owner = oc === -1 ? null : dict.value(oc);
      }
      for (const id of [...h.poses.keys()]) if (!live.has(id)) h.poses.delete(id);
    }
  }
  for (const key of Object.keys(mirror.entries)) if (!seen.has(key)) delete mirror.entries[key];
  return mirror;
}
