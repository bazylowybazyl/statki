// src/render/blocks/cloakBlock.js — blok migawki: wygląd maskowania (docs/PLAN-render-worker.md § 3.2, RW-11b; RW-26).
//
// Od RW-26 wygląd maskowania liczy GRA (`stepCloakLooks`, src/game/cloakLooks.js → `CLOAK_LOOK_FRAME` i
// `entity.__cloakLook`), a render robi z niego obraz (slot kadłuba uCloakA..E, cząstki, światła, wizjer; wieże, dysze,
// lampy i modele czytają `__cloakLook` encji). Blok niesie wygląd każdej encji listy RENDER, która go ma (także
// nieaktywny — render sprawdza `look.active`), i ramkę klatki (dt, zegar wzoru, lista aktywnych, gracz).
//
// Pola wyglądu NIE są wypisane ręcznie: układ rekordu bierze się z szablonu `createCloakLook()` (liczby, flagi,
// wektory {x, y, z, w}, napisy przez słownik migawki) — nowe pole wyglądu przechodzi samo, a lustro ma tę samą klasę
// ukrytą co wygląd gry (tworzone tą samą funkcją). Pola innego rodzaju (stała `tint`, `lastBreak`) zostają z szablonu.
//
// ZDARZENIA (`look.events` — bity CLOAK_EVENT jednej klatki: start włączania, zerwanie…) to impulsy: strona niesie
// SUMĘ bitów z klatek po ostatnio odebranej (`frame.lastConsumed`) — pominięta strona w trybie `worker` ich nie gubi.
//
// Rejestracja (gra): `packer.addBlock(createCloakBlock())`, w klatce `frame.cloak = CLOAK_LOOK_FRAME` (po
// `stepCloakLooks`, przed `packer.begin`). Render: `applyCloakBlock(view.blocks.cloak, entityAt, renderMirrors, dict,
// state)` → `state.frame` = lustro CLOAK_LOOK_FRAME, `mirror.__cloakLook` = lustro wyglądu. Czysty moduł.

import { createCloakLook } from '../../game/cloakLook.js';
import { LIST } from '../snapshotLayout.js';

// ── Układ rekordu z szablonu ─────────────────────────────────────────────────────────────────────────────────────
const TEMPLATE = createCloakLook(null, 0);
const NUM = [];      // klucze liczb (bez `events` — osobno, z sumą klatek)
const BOOL = [];
const STR = [];
const VEC = [];
for (const key of Object.keys(TEMPLATE)) {
  if (key === 'events') continue;
  const v = TEMPLATE[key];
  if (typeof v === 'number') NUM.push(key);
  else if (typeof v === 'boolean') BOOL.push(key);
  else if (typeof v === 'string') STR.push(key);
  else if (v && typeof v === 'object' && !Array.isArray(v) && 'x' in v && 'y' in v && 'z' in v && 'w' in v) VEC.push(key);
}

const REC_HEAD = 4;   // [slot, gen, flagi bool (bit i = BOOL[i]), zdarzenia]
const REC_STRIDE = REC_HEAD + NUM.length + STR.length + VEC.length * 4;

export const CLOAK_BLOCK = Object.freeze({
  // [liczba rekordów, dt, zegar wzoru, slot gracza, gen gracza, gracz ma wygląd ramki (0/1), długość listy, słowa]
  HEAD: 8,
  REC_HEAD,
  REC_STRIDE,
  KEYS: Object.freeze({ num: Object.freeze(NUM.slice()), bool: Object.freeze(BOOL.slice()), str: Object.freeze(STR.slice()), vec: Object.freeze(VEC.slice()) }),
  EVENT_RING: 4,      // klatki ze zdarzeniami pamiętane na slot (więcej — łączone w najstarszy wpis)
  WORDS: 1024
});

const num = (v) => (typeof v === 'number' ? v : NaN);

/** Blok do `packer.addBlock` (faza begin — po encjach: sloty już nadane). */
export function createCloakBlock() {
  const RING = CLOAK_BLOCK.EVENT_RING;
  let evGen = new Uint32Array(0);   // generacja slotu, do której należą zdarzenia
  let evK = new Int32Array(0);      // RING na slot: klatka (0 = wolne)
  let evBits = new Int32Array(0);   // RING na slot: bity
  const ensure = (cap) => {
    if (evGen.length >= cap) return;
    const g = new Uint32Array(cap); g.set(evGen); evGen = g;
    const k = new Int32Array(cap * RING); k.set(evK); evK = k;
    const b = new Int32Array(cap * RING); b.set(evBits); evBits = b;
  };
  // Zdarzenia slotu po ostatnio odebranej stronie (dopisuje bity tej klatki, zwalnia odebrane).
  const events = (s, gen, k, bits, consumed) => {
    const o = s * RING;
    if (evGen[s] !== gen) { evGen[s] = gen; for (let i = 0; i < RING; i++) { evK[o + i] = 0; evBits[o + i] = 0; } }
    let sum = 0, freeAt = -1, oldest = -1;
    for (let i = 0; i < RING; i++) {
      const fk = evK[o + i];
      if (fk !== 0 && fk <= consumed) { evK[o + i] = 0; evBits[o + i] = 0; }
      if (evK[o + i] === 0) { if (freeAt < 0) freeAt = i; continue; }
      sum |= evBits[o + i];
      if (oldest < 0 || evK[o + i] < evK[o + oldest]) oldest = i;
    }
    if (bits !== 0) {
      if (freeAt >= 0) { evK[o + freeAt] = k; evBits[o + freeAt] = bits; }
      else evBits[o + oldest] |= bits;   // pełny pierścień: najstarszy wpis odbierze także te bity
      sum |= bits;
    }
    return sum;
  };
  return {
    name: 'cloak', f64: CLOAK_BLOCK.WORDS, phase: 'begin',
    pack(blk, frame, packer) {
      const F = blk.f64;
      const ents = packer.ids.entities;
      const dict = packer.dict;
      const cf = frame.cloak || null;
      const render = packer._lists[LIST.RENDER];
      const k = packer.k | 0;
      const consumed = typeof frame.lastConsumed === 'number' ? frame.lastConsumed : k - 1;
      ensure(ents.capacity);
      const list = cf && Array.isArray(cf.list) ? cf.list : null;
      const listWords = 2 * (list ? list.length : 0);
      let want = 0;
      for (let i = 0; i < render.length; i++) { const l = render[i].__cloakLook; if (l && typeof l === 'object') want++; }
      const need = CLOAK_BLOCK.HEAD + want * REC_STRIDE + listWords;
      // za mały blok: następna strona większa (nowy układ stron), ta niesie tyle rekordów, ile się zmieści
      if (need > F.length) packer.resizeBlock('cloak', { f64: Math.ceil(need * 1.5) });
      let o = CLOAK_BLOCK.HEAD, n = 0;
      for (let i = 0; i < render.length; i++) {
        const e = render[i];
        const look = e.__cloakLook;
        if (!look || typeof look !== 'object') continue;
        if (o + REC_STRIDE > F.length - listWords) break;
        const s = ents.peek(e);
        if (s < 0) continue;
        const gen = ents.gen(s);
        F[o] = s; F[o + 1] = gen;
        let fl = 0;
        for (let b = 0; b < BOOL.length; b++) if (look[BOOL[b]] === true) fl |= 1 << b;
        F[o + 2] = fl;
        F[o + 3] = events(s, gen, k, look.events | 0, consumed);
        let p = o + REC_HEAD;
        for (let j = 0; j < NUM.length; j++) F[p++] = num(look[NUM[j]]);
        for (let j = 0; j < STR.length; j++) F[p++] = dict.code(look[STR[j]]);
        for (let j = 0; j < VEC.length; j++) {
          const v = look[VEC[j]];
          F[p] = num(v.x); F[p + 1] = num(v.y); F[p + 2] = num(v.z); F[p + 3] = num(v.w);
          p += 4;
        }
        o = p;
        n++;
      }
      let ln = 0;
      if (list) {
        for (let i = 0; i < list.length && o + 2 <= F.length; i++) {
          const s = ents.peek(list[i]);
          if (s < 0) continue;
          F[o] = s; F[o + 1] = ents.gen(s);
          o += 2; ln++;
        }
      }
      const player = cf ? cf.player : null;
      const ps = player ? ents.peek(player) : -1;
      F[0] = n;
      F[1] = cf ? num(cf.dt) : 0;
      F[2] = cf ? num(cf.time) : 0;
      F[3] = ps; F[4] = ps >= 0 ? ents.gen(ps) : 0;
      F[5] = cf && cf.playerLook && player && cf.playerLook === player.__cloakLook ? 1 : 0;
      F[6] = ln;
      F[7] = o;
    }
  };
}

/** Stan lustra wyglądu (trzymany przez wołającego). `frame` — lustro CLOAK_LOOK_FRAME dla renderu. */
export function createCloakMirrorState() {
  return {
    frame: { dt: 0, time: 0, list: [], playerLook: null, player: null },
    _looks: new WeakMap(),   // lustro encji → lustro wyglądu (stała tożsamość: render mutuje i porównuje)
    _given: new WeakMap(),   // lustro encji → numer strony, na której dostało wygląd
    _page: 0
  };
}

/**
 * Wygląd ze strony: `entityAt(slot, gen)` → lustro encji albo null, `renderMirrors` — lustra listy RENDER tej strony
 * (lustro bez rekordu traci wygląd — jak encja gry bez `__cloakLook`), `dict` — słownik migawki. Zwraca `state`.
 */
export function applyCloakBlock(blk, entityAt, renderMirrors, dict, state) {
  const F = blk.f64;
  const page = ++state._page;
  const n = F[0] | 0;
  let o = CLOAK_BLOCK.HEAD;
  for (let r = 0; r < n; r++, o += REC_STRIDE) {
    const m = entityAt(F[o], F[o + 1]);
    if (!m) continue;
    let look = state._looks.get(m);
    if (!look) { look = createCloakLook(null, 0); state._looks.set(m, look); }
    const fl = F[o + 2] | 0;
    for (let b = 0; b < BOOL.length; b++) look[BOOL[b]] = (fl & (1 << b)) !== 0;
    look.events = F[o + 3] | 0;
    let p = o + REC_HEAD;
    for (let j = 0; j < NUM.length; j++) look[NUM[j]] = F[p++];
    for (let j = 0; j < STR.length; j++) look[STR[j]] = dict.value(F[p++]);
    for (let j = 0; j < VEC.length; j++) {
      const v = look[VEC[j]];
      v.x = F[p]; v.y = F[p + 1]; v.z = F[p + 2]; v.w = F[p + 3];
      p += 4;
    }
    if (m.__cloakLook !== look) m.__cloakLook = look;
    state._given.set(m, page);
  }
  if (renderMirrors) {
    for (let i = 0; i < renderMirrors.length; i++) {
      const m = renderMirrors[i];
      if (m && m.__cloakLook !== undefined && state._given.get(m) !== page) m.__cloakLook = undefined;
    }
  }
  const fr = state.frame;
  fr.dt = F[1]; fr.time = F[2];
  const ln = F[6] | 0;
  fr.list.length = 0;
  for (let i = 0; i < ln; i++, o += 2) {
    const m = entityAt(F[o], F[o + 1]);
    if (m) fr.list.push(m);
  }
  const player = F[3] >= 0 ? entityAt(F[3], F[4]) : null;
  fr.player = player;
  fr.playerLook = F[5] === 1 && player ? (player.__cloakLook || null) : null;
  return state;
}
