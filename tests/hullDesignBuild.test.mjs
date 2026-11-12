// Budowa projektu zależna od zmiany (src/game/hullDesign/hullDesignBuild.js): pamięć etapów po kluczu wejścia,
// pakiety tekstur kompozytora bit w bit jak dawna ścieżka HullComposer.setDesign (DataUtils.toHalfFloat three),
// przerwanie budowy na granicy etapu, sieć z poprzedniego podglądu w trakcie przeciągania.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils } from 'three';
import { toHalfBits, packHalfChannel } from '../src/game/hullDesign/hullDesignHalf.js';
import { createHullDesignBuilder, packHullFieldTextures, packHullGrooveTexture, packHullPipeTextures } from '../src/game/hullDesign/hullDesignBuild.js';
import { buildHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';

test('float16: toHalfBits = DataUtils.toHalfFloat (bit w bit, z obcięciem i liczbami podnormalnymi)', () => {
  const vals = [0, -0, 1, -1, 0.5, 1e-8, -1e-8, 6.1e-5, 5.9e-8, 65504, 65519, 70000, -70000, 1000, 1.4, Math.PI, -48, 48.0001];
  let s = 12345;
  for (let i = 0; i < 4000; i++) { s = (s * 1103515245 + 12345) >>> 0; vals.push((s / 4294967296 - 0.5) * Math.pow(2, (i % 40) - 20)); }
  const f32 = new Float32Array(vals);
  const out = new Uint16Array(f32.length * 4);
  packHalfChannel(out, 2, f32);
  f32.forEach((v, i) => {
    const want = DataUtils.toHalfFloat(v);
    assert.equal(toHalfBits(v), want, `toHalfBits(${v})`);
    assert.equal(out[i * 4 + 2], want, `packHalfChannel(${v})`);
  });
});

test('pakiety tekstur kompozytora = dawna ścieżka setDesign (pola, kopuła, rowki, sieć rur)', () => {
  const f = buildHullField(hullDesignPreset('custos'));
  const n = f.grid.w * f.grid.h;
  const toHalf = DataUtils.toHalfFloat;
  const { field, aux } = packHullFieldTextures(f);
  const gr = packHullGrooveTexture(f.groove, f.grooveBand, n);
  const pp = packHullPipeTextures(f.pipeNet, f.pipeTex, f.grid);
  for (let i = 0; i < n; i += 7) {
    for (let c = 0; c < 4; c++) assert.equal(field[i * 4 + c], toHalf(f.levels[c][i]));
    assert.equal(aux[i * 4], toHalf(f.dome[i]));
    for (let c = 1; c < 4; c++) assert.equal(aux[i * 4 + c], toHalf(f.oct[c][i]));
    assert.equal(gr[i * 4], toHalf(f.groove[i]));
    assert.equal(gr[i * 4 + 1], toHalf(f.groove.width[i]));
    const o = i * 4;
    if (f.pipeTex.mask[i]) for (let c = 0; c < 4; c++) assert.equal(pp.a[o + c], toHalf(f.pipeTex.a[o + c]));
    else { assert.equal(pp.a[o], toHalf(1000)); assert.equal(pp.a[o + 1], toHalf(1)); }
  }
  assert.equal(pp.b, f.pipeTex.b);
});

test('budowniczy: etapy z pamięci po kluczu — barwy, naklejki, moduł bez bryły, klocek', async () => {
  const b = createHullDesignBuilder();
  const d = hullDesignPreset('custos');
  const a = await b.run(d, { full: true });
  const ref = buildHullField(d);
  assert.deepEqual(Array.from(a.field.levels[1].subarray(0, 4000)), Array.from(ref.levels[1].subarray(0, 4000)));
  assert.equal(a.field.pipeNet.runs.length, ref.pipeNet.runs.length);
  // barwy i naklejki: ani geometria, ani sieć
  d.palette = 'pirate';
  const p = await b.run(d, { full: true });
  assert.equal(p.keys.geo, a.keys.geo);
  assert.equal(p.keys.power, a.keys.power);
  assert.equal(p.field.packed.field.data, a.field.packed.field.data, 'pakiet pól z pamięci');
  // gniazdo broni (moduł bez bryły): geometria z pamięci, sieć od nowa
  const m = d.modules.find((q) => !q.lock && (q.type === 'mount' || q.type.startsWith('turret')));
  m.x += 4;
  const q = await b.run(d, { full: true });
  assert.equal(q.keys.geo, a.keys.geo);
  assert.notEqual(q.keys.pipes, a.keys.pipes);
  // klocek: nowa geometria
  const bl = d.shapes.find((s) => s.kind === 'block' && s.level >= 1);
  bl.x += d.grid;
  const r = await b.run(d, { full: true });
  assert.notEqual(r.keys.geo, a.keys.geo);
  assert.ok(r.physics && r.physics.data.length === r.physics.width * r.physics.height * 4);
  const c = b.checks();
  assert.ok(c.netCheck && c.integrity && c.systems);
});

test('budowniczy: przerwanie na granicy etapu (wynik null), podgląd z siecią poprzedniego podglądu', async () => {
  const b = createHullDesignBuilder();
  const d = hullDesignPreset('custos');
  assert.equal(await b.run(d, { full: true }, async () => false), null);
  const f1 = await b.run(d, { fast: true });
  assert.equal(f1.pipesStale, false);
  const bl = d.shapes.find((s) => s.kind === 'block' && s.level >= 1);
  bl.x += d.grid;
  const f2 = await b.run(d, { fast: true });
  assert.notEqual(f2.keys.geo, f1.keys.geo);
  assert.equal(f2.pipesStale, true, 'przeciąganie: trasy z poprzedniego podglądu');
  const full = await b.run(d, { full: true });
  assert.equal(full.pipesStale, false, 'pełna budowa liczy prawdziwe trasy');
});
