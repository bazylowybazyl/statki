// src/render/mirrorBridge.js — PRZEJŚCIOWE mosty gra ↔ lustro w trybie `inline` (docs/PLAN-render-worker.md § 3.6,
// RW-11a). Jawna lista pól, które dziś płyną między modułami renderu PRZEZ obiekty gry albo są pisane przez render
// i czytane przez grę. W trybie `worker` mostów nie ma — każde pole ma zadanie, które je usuwa:
//
//   gra → lustro (pisze inny moduł renderu albo gra w przebiegu renderu, czyta ścieżka kadłubów na lustrze):
//     __warpHullU, __warpNurtMode   — WarpNurt.update pisze na encjach gry (RW-28: harmonogram warpa w grze,
//                                     obraz z rekordów; lustro dostaje stan z migawki);
//     __bayCut                      — scoutBay3D.sync pisze na statku gry (RW-11b: luk na lustrze gracza);
//     __lightOcclude                — funkcja gry (fregata nad Atlasem; RW-26: zasłonięcie po stronie gry → flaga);
//     __lightMate                   — tożsamość innej encji (holownik / fregata) → lustro tej encji;
//   lustro → gra (pisze render, czyta gra albo moduł renderu jeszcze na obiektach gry):
//     __cloakLook                   — referencja (mutowana w miejscu przez render): czytają kanwa 2D, mostki,
//                                     drony, modele 3D, luk (RW-26: wygląd maskowania liczony w grze);
//     __inDrawBox                   — model lotu NPC (LOD stanu dysz; RW-31 / RW-26: pudło po stronie gry);
//     __hiddenFromView, _coldSkinFrame — zimne wraki i cień (RW-31);
//     __engineFxFallback            — paleta warpa (warp/palette.js na encjach gry; RW-28).
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
    const mate = g.__lightMate;
    if (mate) {
      const ms = slotOf(mate);
      m.__lightMate = ms >= 0 ? (list[ms] || null) : null;
    } else m.__lightMate = mate;
  }
}

/**
 * Lustra → gra (po modułach renderu na lustrach). Pola pisze render tylko encjom ze swoich list: `__inDrawBox`,
 * `__hiddenFromView` — lista RENDER (updateHexShips3D), `_coldSkinFrame`, `__hiddenFromView` — zimne wraki (COLD);
 * most przepisuje tylko tam (bez nowych pól na innych obiektach gry — klasy ukryte bez zmian).
 */
export function bridgeMirrorsToGame(rm, renderList, coldList) {
  for (let i = 0; i < renderList.length; i++) {
    const m = renderList[i];
    const g = m.__game;
    if (!g) continue;
    if (m.__cloakLook !== undefined && g.__cloakLook !== m.__cloakLook) g.__cloakLook = m.__cloakLook;
    if (g.__inDrawBox !== m.__inDrawBox) g.__inDrawBox = m.__inDrawBox;
    if (g.__hiddenFromView !== m.__hiddenFromView) g.__hiddenFromView = m.__hiddenFromView;
    if (m.__engineFxFallback !== undefined && g.__engineFxFallback !== m.__engineFxFallback) g.__engineFxFallback = m.__engineFxFallback;
  }
  if (!coldList) return;
  for (let i = 0; i < coldList.length; i++) {
    const m = coldList[i];
    const g = m.__game;
    if (!g) continue;
    if (m._coldSkinFrame !== undefined && g._coldSkinFrame !== m._coldSkinFrame) g._coldSkinFrame = m._coldSkinFrame;
    if (g.__hiddenFromView !== m.__hiddenFromView) g.__hiddenFromView = m.__hiddenFromView;
  }
}
