// src/game/repairFxEvents.js
//
// Zdarzenia rigów dronów naprawczych po stronie GRY (RW-22, docs/PLAN-render-worker.md § 2.6 p. 28): render drenował
// pierścień `rig.fx` (src/game/repairRig.js) kursorem w swojej WeakMap — w workerze nie sięgnie do obiektu gry. Gra
// przepisuje nowe zdarzenia na rekordy REPAIR_FX (src/render/hullCommands.js) raz na klatkę, tuż przed przebiegiem
// dronów renderu (ta sama chwila i kolejność co dawne drenowanie; pierwsze spotkanie rigu pomija stare zdarzenia,
// przepełnienie pierścienia — najnowsze `cap`). Rig ma id (inline: rejestr `rigAt`; worker — blok dronów migawki).

import { HC, REPAIR_FX_REC } from '../render/hullCommands.js';

export function createRepairFxEvents(writer) {
  const read = new WeakMap();
  const ids = new WeakMap();
  const byId = new Map();
  let next = 1;
  const idOf = (rig) => {
    let id = ids.get(rig);
    if (id === undefined) { id = next++; ids.set(rig, id); byId.set(id, rig); }
    return id;
  };
  return {
    rigAt(id) { return byId.get(id) || null; },
    /** Nowe zdarzenia wszystkich rigów (kolejność rejestru) → rekordy. */
    flush(rigs) {
      if (!rigs) return;
      for (let r = 0; r < rigs.length; r++) {
        const rig = rigs[r];
        let cur = read.get(rig);
        if (cur === undefined) { read.set(rig, rig.fxWrite); continue; }
        const cap = rig.fx.length;
        if (rig.fxWrite - cur > cap) cur = rig.fxWrite - cap;
        if (cur >= rig.fxWrite) continue;
        const id = idOf(rig);
        for (; cur < rig.fxWrite; cur++) {
          const f = rig.fx[cur % cap];
          const R = REPAIR_FX_REC;
          const o = writer._begin(HC.REPAIR_FX, R.WORDS);
          const d = writer.ring.data;
          d[o + R.RIG] = id; d[o + R.KIND] = f.kind; d[o + R.X] = f.x; d[o + R.Y] = f.y;
          writer._commit();
        }
        read.set(rig, cur);
      }
    }
  };
}
