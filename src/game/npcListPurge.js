/**
 * Martwe NPC, po których nic już nie zostało do zrobienia, wypadają z `npcs`.
 *
 * NPC misji (mission = true — call-iny, flota, piraci, myśliwce) nie ma ścieżki
 * odrodzenia: npcStep robił dla martwego `if (npc.dead) continue` NA ZAWSZE,
 * a każda pętla po `npcs` (fizyka, siatka pocisków, AI, render, liczniki, lista
 * destruktora) nadal go odwiedzała. Po bitwie 174 okrętów to ~125 trupów w każdej
 * z tych pętli do końca sesji.
 *
 * Kompaktowanie W MIEJSCU: ta sama tablica (window.npcs i GameState trzymają
 * referencję), kolejność żywych bez zmian (od niej zależą listy destruktora).
 * Wołać tylko w bezpiecznym punkcie klatki — nigdy w trakcie iteracji po npcs.
 *
 * @param {object[]} npcs
 * @param {(npc: object) => boolean} isFinished
 * @param {(npc: object) => void} [onRemoved]  sprzątanie referencji (np. zaznaczenie RTS)
 * @returns {number} ile NPC usunięto
 */
export function purgeFinishedNpcs(npcs, isFinished, onRemoved = null) {
  if (!Array.isArray(npcs) || npcs.length === 0) return 0;
  let write = 0;
  let removed = 0;
  for (let read = 0; read < npcs.length; read++) {
    const npc = npcs[read];
    if (npc && isFinished(npc)) {
      removed++;
      if (onRemoved) onRemoved(npc);
      continue;
    }
    if (write !== read) npcs[write] = npc;
    write++;
  }
  if (removed > 0) npcs.length = write;
  return removed;
}
