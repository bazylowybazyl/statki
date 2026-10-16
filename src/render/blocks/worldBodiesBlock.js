// src/render/blocks/worldBodiesBlock.js — blok migawki: stan kawałków ciał świata budowli (docs/PLAN-render-worker.md
// § 4, RW-40b). Obraz skór ciał świata (`src/3d/worldBodies3D.js`) czyta `worldBodies` gry: miejsca (budowle), ich
// kawałki (stan static / live / lost, `touched`, encja kawałka), `allLive` i punkty uwagi (`focus` — wypiek z
// wyprzedzeniem). Worker trzyma REPLIKĘ miejsc zbudowaną z własnej bryły budowli (te same kawałki w tej samej
// kolejności — `createPirateBaseSites` na układzie bazy), a blok niesie tylko stan klatki.
//
// Miejsce = indeks klucza budowli w `site.base.layout.structures` (kolejność kluczy układu — ta sama po obu stronach),
// kawałek = indeks w `site.pieces`. Encja kawałka: slot + generacja (lustro z listy WORLD_BODIES).
//
// Rejestracja (strona gry, tryb worker): `packer.addBlock(createWorldBodiesBlock())`, w klatce `frame.worldBodies =
// worldBodies`. Strona renderu: `applyWorldBodiesBlock(view.blocks.worldBodies, entityAt, replica)`.
// Czysty moduł (bez three, DOM i `window`).

export const WORLD_BODIES_BLOCK = Object.freeze({
  FOCUS_MAX: 8,
  HEAD: 2 + 2 * 8,                  // [liczba miejsc, liczba punktów uwagi, x0, y0, …]
  SITE: 3,                          // [klucz budowli, allLive, liczba kawałków]
  PIECE: 4,                         // [stan (0 static, 1 live, 2 lost), touched, slot encji, generacja]
  WORDS: 1024
});
const B = WORLD_BODIES_BLOCK;
const STATE = { static: 0, live: 1, lost: 2 };
export const WORLD_PIECE_STATE = Object.freeze(['static', 'live', 'lost']);

/** Blok do `packer.addBlock` (faza begin). */
export function createWorldBodiesBlock() {
  return {
    name: 'worldBodies', f64: B.WORDS, phase: 'begin',
    pack(blk, frame, packer) {
      const A = blk.f64;
      const wb = frame.worldBodies;
      const sites = wb && Array.isArray(wb.sites) ? wb.sites : null;
      let need = B.HEAD;
      if (sites) for (const s of sites) need += B.SITE + (s.pieces ? s.pieces.length : 0) * B.PIECE;
      if (need > A.length) packer.resizeBlock('worldBodies', { f64: Math.ceil(need * 1.5) });
      const focus = wb && Array.isArray(wb.focus) ? wb.focus : [];
      let nf = 0;
      for (let i = 0; i < focus.length && nf < B.FOCUS_MAX; i++) {
        const f = focus[i];
        if (!f) continue;
        A[2 + nf * 2] = f.x; A[3 + nf * 2] = f.y;
        nf++;
      }
      A[1] = nf;
      const ents = packer.ids.entities;
      let o = B.HEAD, n = 0;
      if (sites) {
        for (const s of sites) {
          const keys = s.base && s.base.layout && s.base.layout.structures ? Object.keys(s.base.layout.structures) : null;
          const key = keys ? keys.indexOf(s.structure) : -1;
          if (key < 0 || !Array.isArray(s.pieces)) continue;
          if (o + B.SITE + s.pieces.length * B.PIECE > A.length) break;
          A[o] = key; A[o + 1] = s.allLive ? 1 : 0; A[o + 2] = s.pieces.length;
          o += B.SITE;
          for (const p of s.pieces) {
            A[o] = STATE[p.state] ?? 0;
            A[o + 1] = p.touched ? 1 : 0;
            const es = p.entity ? ents.peek(p.entity) : -1;
            A[o + 2] = es; A[o + 3] = es >= 0 ? ents.gen(es) : 0;
            o += B.PIECE;
          }
          n++;
        }
      }
      A[0] = n;
    }
  };
}

/**
 * Stan klatki na replice: `replica` = { sitesByKey: [miejsce | null] (indeks klucza budowli), focus: [] }.
 * Miejsce repliki: { pieces: [...], allLive }. Kawałek: state, touched, entity (lustro albo null).
 */
export function applyWorldBodiesBlock(blk, entityAt, replica) {
  const A = blk.f64;
  const focus = replica.focus;
  const nf = A[1] | 0;
  focus.length = nf;
  for (let i = 0; i < nf; i++) {
    const f = focus[i] || (focus[i] = { x: 0, y: 0 });
    f.x = A[2 + i * 2]; f.y = A[3 + i * 2];
  }
  const n = A[0] | 0;
  let o = B.HEAD;
  for (let i = 0; i < n; i++) {
    const site = replica.sitesByKey[A[o] | 0] || null;
    const np = A[o + 2] | 0;
    if (site) site.allLive = A[o + 1] === 1;
    o += B.SITE;
    for (let j = 0; j < np; j++, o += B.PIECE) {
      const p = site && site.pieces[j];
      if (!p) continue;
      p.state = WORLD_PIECE_STATE[A[o] | 0] || 'static';
      p.touched = A[o + 1] === 1;
      p.entity = entityAt(A[o + 2], A[o + 3]);
    }
  }
  return replica;
}
