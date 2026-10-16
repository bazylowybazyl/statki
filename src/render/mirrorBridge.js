// src/render/mirrorBridge.js — PRZEJŚCIOWE mosty gra ↔ lustro w trybie `inline` (docs/PLAN-render-worker.md § 3.6,
// RW-11a). Jawna lista pól, które płyną do modułów renderu na lustrach PRZEZ obiekty gry albo są pisane przez render
// i czytane przez grę. W trybie `worker` mostów nie ma — każde pole ma zadanie, które je usuwa (pole w migawce):
//
//   gra → lustro (pisze gra albo moduł renderu jeszcze na obiektach gry, czyta ścieżka kadłubów na lustrze):
//     __warpHullU, __warpNurtMode   — WarpNurt.update pisze na encjach gry (RW-28: harmonogram warpa w grze,
//                                     obraz z rekordów; lustro dostaje stan z migawki);
//     __bayCut                      — scoutBay3D.sync pisze na statku gry (luk na lustrze gracza — pole migawki);
//     __lightOcclude                — funkcja gry (fregata nad Atlasem; zasłonięcie po stronie gry → flaga / obrys);
//     __lightMate                   — tożsamość innej encji (holownik / fregata) → lustro tej encji;
//     __inDrawBox, _coldDrawFrame   — widok klatki po stronie gry (RW-31: stampDrawBoxFlags, selectColdRenderBodies)
//                                     — pola ENT / zimnych wraków w migawce;
//   lustro → gra (pisze render, czyta gra):
//     __engineFxFallback            — paleta dysz z obrazu kadłuba (engineVfxSystem.js); czyta ją gra
//                                     (warpTraffic.js — paleta warpa; RW-28: paleta liczona w grze).
//
// Dawne mosty `__cloakLook` (od RW-26 wygląd maskowania liczy gra — blok migawki `cloak`), `__hiddenFromView`
// i `_coldSkinFrame` (pisze i czyta tylko render) usunięte przy wpięciu (RW-11a).
//
// Czysty moduł (bez three, DOM i `window`).

/** Gra → lustra (przed modułami renderu na lustrach). `gameOf(slot)` — obiekt gry slotu; `slotOf(obj)` — slot albo −1. */
export function bridgeGameToMirrors(rm, gameOf, slotOf) {
  const list = rm.entities;
  for (let s = 0; s < list.length; s++) {
    const m = list[s];
    if (!m) continue;
    const g = gameOf(s);
    m.__game = g || null;
    if (!g) continue;
    m.__warpHullU = g.__warpHullU;
    m.__warpNurtMode = g.__warpNurtMode;
    m.__bayCut = g.__bayCut;
    m.__lightOcclude = g.__lightOcclude;
    m.__inDrawBox = g.__inDrawBox;
    m._coldDrawFrame = g._coldDrawFrame;
    const mate = g.__lightMate;
    if (mate) {
      const ms = slotOf(mate);
      m.__lightMate = ms >= 0 ? (list[ms] || null) : null;
    } else m.__lightMate = mate;
  }
}

/**
 * Lustra → gra (po modułach renderu na lustrach): pola, które render pisze encjom listy RENDER, a czyta gra. Most
 * przepisuje tylko zmienione (bez nowych pól na obiektach gry, gdy render ich nie ustawił).
 */
export function bridgeMirrorsToGame(rm, renderList) {
  for (let i = 0; i < renderList.length; i++) {
    const m = renderList[i];
    const g = m.__game;
    if (!g) continue;
    if (m.__engineFxFallback !== undefined && g.__engineFxFallback !== m.__engineFxFallback) g.__engineFxFallback = m.__engineFxFallback;
  }
}
