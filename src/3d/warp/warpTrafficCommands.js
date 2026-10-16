// src/3d/warp/warpTrafficCommands.js — dekoder rekordów ruchu warpa strumienia rozkazów (RW-28, docs/PLAN-render-worker.md
// § 3.3): WARP_* → wygląd przylotów i odlotów NPC w sterowniku warpa „Nurt” (warpNurt.js). Oś rekordu (czasy, droga,
// wymiary, kurs) render czyta z puli rejestru gry przez `recordAt(slot)` (inline: src/game/warpTraffic.js — ten sam
// obiekt; worker: lustro bloku WARP migawki), encję — z czytelnika (slot, generacja).

import { RC, WARP, WARP_KIND } from '../../render/renderCommands.js';

/** nurt — WarpNurt, recordAt(slot) → rekord rejestru gry ({ fx, kind, entity }). */
export function installWarpTrafficCommands(reader, nurt, recordAt) {
  if (!reader || !nurt || typeof recordAt !== 'function') return false;
  reader.on(RC.WARP_BEGIN, (r, d, o) => {
    const slot = d[o + WARP.SLOT];
    const rec = recordAt(slot);
    if (!rec) return;
    const kind = d[o + WARP.B_KIND] === WARP_KIND.DEPARTURE ? 'departure' : 'arrival';
    nurt.warpBegin(slot, kind, rec.fx, r.ent(d, o + WARP.B_ENT));
  });
  reader.on(RC.WARP_ATTACH, (r, d, o) => nurt.warpAttach(d[o + WARP.SLOT], r.ent(d, o + WARP.A_ENT)));
  reader.on(RC.WARP_END, (r, d, o) => nurt.warpEnd(d[o]));
  reader.on(RC.WARP_CLEAR, () => nurt.warpClear());
  return true;
}
