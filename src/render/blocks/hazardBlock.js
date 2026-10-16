// src/render/blocks/hazardBlock.js — blok migawki: strumienie i kule plazmy rdzeni reaktorów (docs/PLAN-render-worker.md
// § 4, RW-40b). Obraz rdzeni (`reactorBlastFx.syncHazards`, rekordy RX_HAZARD / RX_ORB_BURST / RX_MELT) czyta co
// klatkę ŻYWE obiekty strumieni i kul z logiki gry (ReactorGame); rekordy niosą tylko id (`ReactorFxEvents.hazardAt`).
// Blok niesie stan wszystkich obiektów z rejestru id (strona: `ReactorFxEvents.forEachHazard`), worker trzyma lustra
// o stałej tożsamości (obraz pamięta stan efektu per obiekt — WeakMap) i rozwiązuje nimi id rekordów.
//
// Rejestracja (strona gry, tryb worker): `packer.addBlock(createHazardBlock(ReactorFxEvents))`.
// Strona renderu: `applyHazardBlock(view.blocks.hazards, entityAt, state)`, `state.byId.get(id)` — lustro albo undefined.
// Czysty moduł (bez three, DOM i `window`).

export const HAZARD_BLOCK = Object.freeze({
  HEAD: 1,                           // [liczba obiektów]
  STRIDE: 22,
  F: Object.freeze({ ID: 0, KIND: 1, A: 2, B: 3, C: 4, D: 5, E: 6, F: 7, WIDTH: 8, ENV: 9, FLAGS: 10, HVX: 11, HVY: 12,
    R: 13, G: 14, BL: 15, FACTION: 16, HIT_SLOT: 17, HIT_GEN: 18, HIT_X: 19, HIT_Y: 20, AGE: 21 }),
  KIND: Object.freeze({ JET: 1, ORB: 2 }),
  FLAG: Object.freeze({ DONE: 1, DETONATED: 2, HAS_COLOR: 4 }),
  WORDS: 512
});

const F = HAZARD_BLOCK.F, K = HAZARD_BLOCK.KIND, FL = HAZARD_BLOCK.FLAG;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// frakcja do barwy plazmy (reactorBlastFx.plasmaOf): 1 piraci, 2 gracz, 0 reszta
function factionCode(o) {
  const c = o.core || null;
  const f = String(c?.host?.faction || c?.origin?.faction || o.host?.faction || '').toLowerCase();
  return f.includes('pira') ? 1 : (f.includes('player') ? 2 : 0);
}
const FACTION_NAME = ['terran', 'pirate', 'player'];

/** Blok do `packer.addBlock` (faza begin). `events` — ReactorFxEvents strony (`forEachHazard`). */
export function createHazardBlock(events) {
  return {
    name: 'hazards', f64: HAZARD_BLOCK.WORDS, phase: 'begin',
    pack(blk, frame, packer) {
      const A = blk.f64;
      let n = 0;
      if (events && typeof events.forEachHazard === 'function') {
        let need = 0;
        events.forEachHazard(() => { need++; });
        const words = HAZARD_BLOCK.HEAD + need * HAZARD_BLOCK.STRIDE;
        if (words > A.length) packer.resizeBlock('hazards', { f64: Math.ceil(words * 1.5) });
        const ents = packer.ids.entities;
        events.forEachHazard((id, o) => {
          const b = HAZARD_BLOCK.HEAD + n * HAZARD_BLOCK.STRIDE;
          if (b + HAZARD_BLOCK.STRIDE > A.length) return;
          const jet = o.originX !== undefined;
          A[b + F.ID] = id; A[b + F.KIND] = jet ? K.JET : K.ORB;
          let flags = 0;
          if (o.done) flags |= FL.DONE;
          if (o.detonated) flags |= FL.DETONATED;
          const col = o.core?.color || o.color;
          if (Array.isArray(col) && col.length >= 3) {
            flags |= FL.HAS_COLOR; A[b + F.R] = num(col[0]); A[b + F.G] = num(col[1]); A[b + F.BL] = num(col[2]);
          }
          A[b + F.FACTION] = factionCode(o);
          A[b + F.FLAGS] = flags;
          if (jet) {
            A[b + F.A] = num(o.originX); A[b + F.B] = num(o.originY); A[b + F.C] = num(o.dirWX); A[b + F.D] = num(o.dirWY);
            A[b + F.E] = num(o.endX); A[b + F.F] = num(o.endY); A[b + F.WIDTH] = num(o.width); A[b + F.ENV] = num(o.env);
            A[b + F.HVX] = num(o.hostVx); A[b + F.HVY] = num(o.hostVy);
            const hs = o.hitEntity ? ents.peek(o.hitEntity) : -1;
            A[b + F.HIT_SLOT] = hs; A[b + F.HIT_GEN] = hs >= 0 ? ents.gen(hs) : 0;
            A[b + F.HIT_X] = num(o.hitX); A[b + F.HIT_Y] = num(o.hitY);
          } else {
            A[b + F.A] = num(o.x); A[b + F.B] = num(o.y); A[b + F.C] = num(o.vx); A[b + F.D] = num(o.vy);
            A[b + F.WIDTH] = num(o.radius); A[b + F.AGE] = num(o.age); A[b + F.ENV] = num(o.env);
            A[b + F.HIT_SLOT] = -1;
          }
          n++;
        });
      }
      A[0] = n;
    }
  };
}

export function createHazardMirrorState() {
  return { byId: new Map(), _seen: new Set() };
}

/** Lustra obiektów ze strony; obiekt, którego nie ma w bloku, wypada z rejestru (oznaczony jako skończony). */
export function applyHazardBlock(blk, entityAt, state) {
  const A = blk.f64;
  const n = A[0] | 0;
  const seen = state._seen;
  seen.clear();
  for (let i = 0; i < n; i++) {
    const b = HAZARD_BLOCK.HEAD + i * HAZARD_BLOCK.STRIDE;
    const id = A[b + F.ID];
    const jet = A[b + F.KIND] === K.JET;
    let o = state.byId.get(id);
    if (!o) {
      const flags0 = A[b + F.FLAGS];
      const core = (flags0 & FL.HAS_COLOR)
        ? { color: [A[b + F.R], A[b + F.G], A[b + F.BL]] }
        : { host: { faction: FACTION_NAME[A[b + F.FACTION] | 0] || 'terran' } };
      o = jet
        ? { core, originX: 0, originY: 0, dirWX: 0, dirWY: 0, endX: 0, endY: 0, width: 0, env: 0, done: false,
          hostVx: 0, hostVy: 0, hitEntity: null, hitX: 0, hitY: 0 }
        : { core, x: 0, y: 0, vx: 0, vy: 0, radius: 0, age: 0, env: 0, detonated: false };
      state.byId.set(id, o);
    }
    seen.add(id);
    const flags = A[b + F.FLAGS];
    if (jet) {
      o.originX = A[b + F.A]; o.originY = A[b + F.B]; o.dirWX = A[b + F.C]; o.dirWY = A[b + F.D];
      o.endX = A[b + F.E]; o.endY = A[b + F.F]; o.width = A[b + F.WIDTH]; o.env = A[b + F.ENV];
      o.done = (flags & FL.DONE) !== 0; o.hostVx = A[b + F.HVX]; o.hostVy = A[b + F.HVY];
      o.hitEntity = entityAt(A[b + F.HIT_SLOT], A[b + F.HIT_GEN]);
      o.hitX = A[b + F.HIT_X]; o.hitY = A[b + F.HIT_Y];
    } else {
      o.x = A[b + F.A]; o.y = A[b + F.B]; o.vx = A[b + F.C]; o.vy = A[b + F.D];
      o.radius = A[b + F.WIDTH]; o.age = A[b + F.AGE]; o.env = A[b + F.ENV];
      o.detonated = (flags & FL.DETONATED) !== 0;
    }
  }
  for (const [id, o] of state.byId) {
    if (seen.has(id)) continue;
    o.done = true; o.env = 0; o.detonated = true;
    state.byId.delete(id);
  }
  return state;
}
