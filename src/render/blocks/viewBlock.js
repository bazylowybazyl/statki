// src/render/blocks/viewBlock.js — blok migawki: widok klatki liczony po stronie gry (RW-31) dla luster w workerze
// (docs/PLAN-render-worker.md, RW-40b; zastępuje mosty `__inDrawBox` i `_coldDrawFrame` z src/render/mirrorBridge.js).
// Na encję: flaga pudła rysowania (true / false / brak), na zimny wrak: ciało do rysowania w tej klatce i lista
// dodatków (mostek, model 3D, rdzeń). Rejestracja (strona gry): `packer.addBlock(createViewBlock())`, w fazie begin
// `frame.viewList` (encje kadłubów klatki), `frame.coldWrecks`, `frame.frameId`. Strona renderu:
// `applyViewBlock(blk, entityAt)` → pola luster (`__inDrawBox`, `_coldDrawFrame`, `_coldExtrasFrame` = numer klatki
// strony albo −1). Czysty moduł.

const FLAG = Object.freeze({ IN_BOX: 1, OUT_BOX: 2, COLD_DRAWN: 4, COLD_EXTRAS: 8 });
export const VIEW_BLOCK = Object.freeze({ HEAD: Object.freeze({ N: 0, FRAME: 1, STRIDE: 2 }), REC: 3, FLAG, CAP: 2048 });

export function createViewBlock() {
  return {
    name: 'view', f64: VIEW_BLOCK.HEAD.STRIDE + VIEW_BLOCK.CAP * VIEW_BLOCK.REC, phase: 'begin',
    pack(blk, frame, packer) {
      const F = blk.f64;
      const ents = packer.ids.entities;
      const fid = frame.frameId;
      const list = frame.viewList || null;
      const cold = frame.coldWrecks || null;
      const need = VIEW_BLOCK.HEAD.STRIDE + ((list ? list.length : 0) + (cold ? cold.length : 0)) * VIEW_BLOCK.REC;
      if (need > F.length) { packer.resizeBlock('view', { f64: need * 2 }); }
      let n = 0, o = VIEW_BLOCK.HEAD.STRIDE;
      const put = (e, fl) => {
        if (!fl) return;
        const s = ents.peek(e);
        if (s < 0 || o + 3 > F.length) return;
        F[o] = s; F[o + 1] = ents.gen(s); F[o + 2] = fl;
        o += 3; n++;
      };
      if (list) for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e) continue;
        put(e, e.__inDrawBox === true ? FLAG.IN_BOX : e.__inDrawBox === false ? FLAG.OUT_BOX : 0);
      }
      if (cold) for (let i = 0; i < cold.length; i++) {
        const w = cold[i];
        if (!w) continue;
        put(w, (w._coldDrawFrame === fid ? FLAG.COLD_DRAWN : 0) | (w._coldExtrasFrame === fid ? FLAG.COLD_EXTRAS : 0));
      }
      F[VIEW_BLOCK.HEAD.N] = n;
      F[VIEW_BLOCK.HEAD.FRAME] = fid;
    }
  };
}

/** Strona renderu: pola widoku na lustrach (`frameId` — numer klatki, z którym porównują haki zimnych wraków). */
export function applyViewBlock(blk, entityAt, frameId) {
  const F = blk.f64;
  const n = F[VIEW_BLOCK.HEAD.N] | 0;
  let o = VIEW_BLOCK.HEAD.STRIDE;
  for (let k = 0; k < n; k++, o += 3) {
    const m = entityAt(F[o], F[o + 1]);
    if (!m) continue;
    const fl = F[o + 2];
    m.__inDrawBox = (fl & FLAG.IN_BOX) ? true : (fl & FLAG.OUT_BOX) ? false : m.__inDrawBox;
    if (fl & FLAG.COLD_DRAWN) m._coldDrawFrame = frameId;
    if (fl & FLAG.COLD_EXTRAS) m._coldExtrasFrame = frameId;
  }
}
