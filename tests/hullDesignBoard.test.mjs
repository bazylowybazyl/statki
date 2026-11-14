// Układ maszynowni „jak płytka drukowana” (prototyp do makiety, src/game/hullDesign/hullDesignBoard.js): to samo wejście
// daje ten sam układ, układ jest lustrzany względem osi okrętu, nie rusza pola ani sieci, a wąskie rowy Bellatora nie
// zostają puste. Bez zegara ściennego.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { buildHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { buildHullBoard, hullBoardSample, HD_BOARD_VARIANTS, HD_BOARD_KINDS } from '../src/game/hullDesign/hullDesignBoard.js';

const fields = {};
const fieldOf = (k) => (fields[k] ||= buildHullField(hullDesignPreset(k)));

/** Skrót tablicy liczb (FNV-1a po bajtach). */
function digest(arr) {
  const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const summary = (bd) => ({
  elems: JSON.stringify(bd.elems), traces: JSON.stringify(bd.traces),
  D: digest(bd.D), T: digest(bd.T), E: digest(bd.E), id: digest(bd.id), tr: digest(bd.tr), dom: digest(bd.dom)
});

test('układ: to samo pole i wariant → ten sam wynik (także z nowego pola)', () => {
  for (const v of Object.keys(HD_BOARD_VARIANTS)) {
    const a = summary(buildHullBoard(fieldOf('colossus'), { variant: v }));
    const b = summary(buildHullBoard(fieldOf('colossus'), { variant: v }));
    assert.deepEqual(a, b, `wariant ${v}`);
  }
  const fresh = buildHullField(hullDesignPreset('bellator'));
  assert.deepEqual(summary(buildHullBoard(fresh, { variant: 'A' })), summary(buildHullBoard(fieldOf('bellator'), { variant: 'A' })));
});

test('układ: inne ziarno → inny układ', () => {
  const a = buildHullBoard(fieldOf('colossus'), { variant: 'A' });
  const b = buildHullBoard(fieldOf('colossus'), { variant: 'A', seed: 12345 });
  assert.notEqual(JSON.stringify(a.elems), JSON.stringify(b.elems));
});

test('układ: lustro względem osi — próbka (x, y) = próbka (x, −y), elementy po stronie y ≤ 0 albo na osi', () => {
  for (const k of ['colossus', 'bellator']) {
    const bd = buildHullBoard(fieldOf(k), { variant: 'A' });
    for (const e of bd.elems) {
      if (e.axis) assert.equal(e.y, 0, `${k}: element osi poza osią`);
      else assert.ok(e.y + e.hh <= 1e-9, `${k}: element po stronie y > 0`);
    }
    const b = fieldOf(k).bounds;
    const s1 = {}, s2 = {};
    let n = 0;
    for (let q = 0; q < 4000; q++) {
      const x = b.minX + (b.maxX - b.minX) * ((q * 0.6180339887) % 1);
      const y = (b.maxY - b.minY) * 0.5 * ((q * 0.7548776662) % 1);
      hullBoardSample(bd, x, y, s1); hullBoardSample(bd, x, -y, s2);
      assert.deepEqual({ ...s1, y: 0 }, { ...s2, y: 0 }, `${k}: (${x}, ±${y})`);
      if (s1.dom > 0.5) n++;
    }
    assert.ok(n > 20, `${k}: za mało próbek w maszynowni (${n})`);
  }
});

test('układ: elementy w odsłoniętej maszynowni, pole i sieć bez zmian', () => {
  const f = fieldOf('colossus');
  const before = JSON.stringify(f.pipeNet.runs), lv = digest(f.levels[1]);
  const bd = buildHullBoard(f, { variant: 'A' });
  assert.equal(JSON.stringify(f.pipeNet.runs), before);
  assert.equal(digest(f.levels[1]), lv);
  const s = {};
  for (const e of bd.elems) {
    if (e.kind === HD_BOARD_KINDS.via) continue;
    hullBoardSample(bd, e.x, e.y - (e.axis ? e.hh * 0.5 : 0), s);
    assert.ok(s.dom > 0.99 && s.D > 0, `element ${e.kind} w (${e.x.toFixed(1)}, ${e.y.toFixed(1)}) poza maszynownią`);
  }
});

test('układ: wąskie rowy Bellatora dostają drobny detal (nie pustkę)', () => {
  const bel = buildHullBoard(fieldOf('bellator'), { variant: 'A' });
  assert.ok(bel.elems.length >= 40, `Bellator: elementów ${bel.elems.length}`);
  const big = bel.elems.filter((e) => !e.axis && e.kind !== HD_BOARD_KINDS.via && Math.max(e.hw, e.hh) * 2 / bel.detail > 30).length;
  assert.ok(big <= bel.elems.length * 0.1, 'Bellator: w wąskich rowach przeważa drobny detal');
});
