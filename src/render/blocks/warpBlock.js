// src/render/blocks/warpBlock.js — blok migawki: ruch warpa NPC i wejście klatki „Nurtu” (docs/PLAN-render-worker.md
// § 3.2, RW-11c; rejestr ruchu warpa — RW-28, src/game/warpTraffic.js).
//
// Render (src/3d/warp/warpNurt.js) dostaje rekordy WARP_* strumienia rozkazów i oś przylotu / odlotu czyta z puli
// rejestru gry przez `recordAt(slot)` (warpTrafficCommands.js). Inline to obiekt gry; w workerze — LUSTRO z tego bloku:
// oś każdego zajętego slotu (stałe listy pól osi przylotu / odlotu z warpDrive.js + planWarp*Axis, bity obecności —
// pole nieobecne zostaje nieobecne, nie NaN), paleta przez słownik strony, numer rekordu (nowy rekord w tym samym
// slocie = nowe lustro osi — widok renderu trzyma referencję do osi, jak do obiektu gry). Oś jest dla renderu tylko do
// odczytu (próbki trzyma widok `dressWarp*`, `fired` nie czyta nikt); obiekty zagnieżdżone dostaje lustro świeże.
// Nagłówek: zegar rejestru (`trafficTime`) i pola klatki „Nurtu” spoza HEAD (`dt`, `camFollow`, `lensAllowed`).
//
// Rejestracja (strona gry): `packer.addBlock(createWarpBlock())`, w fazie begin `frame.warpTraffic = warpTraffic`,
// `frame.warpNurt = _warpNurtFrame(…)`. Strona renderu: `applyWarpBlock(view.blocks.warp, dict, mirror)` →
// `mirror.recordAt(slot)`, `mirror.frame`. Czysty moduł (bez three, DOM i `window`).

// Typy pól: n — liczba, N — liczba albo null (null jako NaN), b — prawda / fałsz, s — napis (słownik strony).
const ARRIVAL_FIELDS = [
  ['id', 'N'], ['x', 'n'], ['y', 'n'], ['angle', 'n'], ['dirX', 'n'], ['dirY', 'n'], ['hullLength', 'n'],
  ['hullWidth', 'n'], ['sizeScale', 'n'], ['palette', 's'], ['t0', 'n'], ['herald', 'n'], ['tear', 'n'],
  ['emerge', 'n'], ['close', 'n'], ['tTear', 'n'], ['tBurst', 'n'], ['tClose', 'n'], ['tSettled', 'n'], ['tEnd', 'n'],
  ['seamLength', 'n'], ['seamHalfWidth', 'n'], ['emergeDist', 'n'], ['v0', 'n'], ['rushDist', 'n'], ['brake', 'n'],
  ['coast', 'n'], ['tBrake', 'n'], ['tAppear', 'n'], ['tStop', 'n'], ['x0', 'n'], ['y0', 'n'], ['sx', 'n'], ['sy', 'n'],
  ['tSpawn', 'n'], ['pirate', 'b'], ['moving', 'b'], ['drive', 'b'], ['heraldReach', 'n'], ['pushReleaseT', 'n']
];
const DEPARTURE_FIELDS = [
  ['id', 'N'], ['x', 'n'], ['y', 'n'], ['angle', 'n'], ['dirX', 'n'], ['dirY', 'n'], ['hullLength', 'n'],
  ['hullWidth', 'n'], ['sizeScale', 'n'], ['palette', 's'], ['t0', 'n'], ['charge', 'n'], ['accel', 'n'],
  ['rushDist', 'n'], ['vEnd', 'n'], ['close', 'n'], ['tDive', 'n'], ['tIn', 'n'], ['tGone', 'n'], ['dive', 'n'],
  ['tEnd', 'n'], ['cx', 'n'], ['cy', 'n'], ['mouth', 'n'], ['pirate', 'b'], ['drive', 'b']
];
// Pola osi, których blok nie niesie: encja (render dostaje ją z rozkazu WARP_BEGIN / WARP_ATTACH) i obiekty robocze
// (lustro dostaje własne — tylko do zgodności kształtu).
const NESTED = {
  arrival: () => ({ entity: null, fired: { tear: false, burst: false, settled: false }, rushSample: {} }),
  departure: () => ({ entity: null, fired: { dive: false, gone: false }, sample: {} })
};
const MAX_FIELDS = Math.max(ARRIVAL_FIELDS.length, DEPARTURE_FIELDS.length);
const MASK_WORDS = Math.ceil(MAX_FIELDS / 26);       // bity obecności po 26 na słowo f64 (dokładnie w mantysie)

export const WARP_BLOCK = Object.freeze({
  HEAD: Object.freeze({ CAP: 0, N: 1, TIME: 2, DT: 3, CAM_FOLLOW: 4, LENS: 5, STRIDE: 8 }),
  REC: Object.freeze({ SLOT: 0, SEQ: 1, KIND: 2, MASK: 3, STRIDE: 3 + MASK_WORDS + MAX_FIELDS }),
  KIND: Object.freeze({ ARRIVAL: 0, DEPARTURE: 1 }),
  FIELDS: Object.freeze({ arrival: ARRIVAL_FIELDS.map((f) => f[0]), departure: DEPARTURE_FIELDS.map((f) => f[0]) }),
  NESTED_KEYS: Object.freeze({ arrival: Object.keys(NESTED.arrival()), departure: Object.keys(NESTED.departure()) }),
  CAP: 32
});

const H = WARP_BLOCK.HEAD, R = WARP_BLOCK.REC, K = WARP_BLOCK.KIND;

/** Blok do `packer.addBlock` (faza begin — rejestr ruchu warpa kroczy przed render()). */
export function createWarpBlock() {
  const seqOf = new WeakMap();
  let seq = 0;
  return {
    name: 'warp', f64: H.STRIDE + WARP_BLOCK.CAP * R.STRIDE, phase: 'begin',
    pack(blk, frame, packer) {
      const F = blk.f64;
      const tr = frame.warpTraffic || null;
      const wf = frame.warpNurt || null;
      const cap = tr ? (tr.cap | 0) : 0;
      if (H.STRIDE + cap * R.STRIDE > F.length) packer.resizeBlock('warp', { f64: H.STRIDE + cap * R.STRIDE });
      F[H.CAP] = cap;
      F[H.TIME] = tr ? tr.time : NaN;
      F[H.DT] = wf ? wf.dt : NaN;
      F[H.CAM_FOLLOW] = wf && wf.camFollow ? 1 : 0;
      F[H.LENS] = wf && wf.lensAllowed ? 1 : 0;
      let n = 0;
      for (let s = 0; s < cap; s++) {
        const rec = tr.recordAt(s);
        if (!rec || !rec.fx) continue;
        const o = H.STRIDE + n * R.STRIDE;
        if (o + R.STRIDE > F.length) break;
        let id = seqOf.get(rec);
        if (id === undefined) { id = ++seq; seqOf.set(rec, id); }
        const dep = rec.kind === 'departure';
        const list = dep ? DEPARTURE_FIELDS : ARRIVAL_FIELDS;
        const fx = rec.fx;
        F[o + R.SLOT] = s; F[o + R.SEQ] = id; F[o + R.KIND] = dep ? K.DEPARTURE : K.ARRIVAL;
        for (let w = 0; w < MASK_WORDS; w++) F[o + R.MASK + w] = 0;
        const base = o + R.MASK + MASK_WORDS;
        for (let i = 0; i < list.length; i++) {
          const key = list[i][0];
          if (!(key in fx)) { F[base + i] = 0; continue; }
          F[o + R.MASK + ((i / 26) | 0)] += 2 ** (i % 26);
          const v = fx[key];
          const t = list[i][1];
          F[base + i] = t === 's' ? packer.dict.code(v) : t === 'b' ? (v ? 1 : 0) : t === 'N' && v === null ? NaN : v;
        }
        n++;
      }
      F[H.N] = n;
    }
  };
}

/** Lustro rejestru po stronie renderu. */
export function createWarpMirror() {
  const slots = [];
  const seqs = [];
  const mirror = {
    frame: { dt: 0, camFollow: false, lensAllowed: false, trafficTime: NaN },
    recordAt(slot) { return slots[slot] || null; },
    _slots: slots, _seqs: seqs
  };
  return mirror;
}

/** Strona renderu: lustro osi zajętych slotów z bloku strony (`dict` — słownik strony: value(code)). */
export function applyWarpBlock(blk, dict, mirror) {
  const F = blk.f64;
  const slots = mirror._slots, seqs = mirror._seqs;
  const cap = F[H.CAP] | 0;
  const n = F[H.N] | 0;
  const fr = mirror.frame;
  fr.trafficTime = F[H.TIME];
  fr.dt = F[H.DT];
  fr.camFollow = F[H.CAM_FOLLOW] === 1;
  fr.lensAllowed = F[H.LENS] === 1;
  const live = new Array(cap).fill(false);
  for (let r = 0; r < n; r++) {
    const o = H.STRIDE + r * R.STRIDE;
    const s = F[o + R.SLOT] | 0;
    const id = F[o + R.SEQ];
    const dep = F[o + R.KIND] === K.DEPARTURE;
    const kind = dep ? 'departure' : 'arrival';
    let rec = slots[s];
    if (!rec || seqs[s] !== id) {
      rec = { id: s, kind, fx: NESTED[kind](), entity: null };
      slots[s] = rec; seqs[s] = id;
    }
    live[s] = true;
    const list = dep ? DEPARTURE_FIELDS : ARRIVAL_FIELDS;
    const fx = rec.fx;
    const base = o + R.MASK + MASK_WORDS;
    for (let i = 0; i < list.length; i++) {
      const key = list[i][0];
      const bit = Math.floor(F[o + R.MASK + ((i / 26) | 0)] / 2 ** (i % 26)) % 2;
      if (!bit) { if (key in fx) delete fx[key]; continue; }
      const v = F[base + i];
      const t = list[i][1];
      fx[key] = t === 's' ? dict.value(v) : t === 'b' ? v === 1 : t === 'N' && Number.isNaN(v) ? null : v;
    }
  }
  for (let s = 0; s < slots.length; s++) if (!live[s]) { slots[s] = null; seqs[s] = undefined; }
  return mirror;
}
