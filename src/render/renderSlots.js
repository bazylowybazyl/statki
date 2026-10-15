// src/render/renderSlots.js — JEDNA przestrzeń slotów renderu po stronie gry (docs/PLAN-render-worker.md § 3.2):
// rozkazy (RW-21), migawka (RW-10) i kanał zwrotny (RW-29, przebicia tarcz) nazywają encje tą samą parą
// (slot, generacja). Wszyscy użytkownicy wołają tylko `slotOf` / `peek` / `gen`; cykl `begin` / `end` (mark & sweep)
// robi RAZ na klatkę pętla gry: `beginRenderSlotsFrame()` na początku klatki (przed krokami fizyki — rozkazy z fizyki
// odwołują się w tej samej epoce co migawka), `endRenderSlotsFrame()` po renderze. Dwa cykle w jednej klatce
// zwolniłyby sloty widziane tylko w pierwszym. Strażnik `open` — powtórne begin / end w tej samej klatce nic nie robi.
//
// Czysty moduł (bez three, DOM i `window`).

import { createRenderIds } from './renderIds.js';

export const RenderSlots = createRenderIds();

let open = false;

export function beginRenderSlotsFrame() {
  if (open) return;
  RenderSlots.begin();
  open = true;
}

export function endRenderSlotsFrame() {
  if (!open) return 0;
  open = false;
  return RenderSlots.end();
}

/** Czy cykl klatki jest otwarty (diagnostyka, testy). */
export function renderSlotsFrameOpen() {
  return open;
}
