// MAPA POLA PASA W UKŁADZIE SCENY (src/3d/asteroids/fieldMap.js, 2026-10-29, zgłoszenie „snopy front i pomocnicze
// drżą”): mapa nad kadrem (słońce, pył ośrodka, lód, burza — czytają ją ośrodek smug reflektorów, mgła i maska słońca
// Core3D) przebudowuje się po przeskoku lepkiego początku pola (Core3D.fx.origin, co 20 tys. j. drogi kamery). Siatka
// tekseli względem początku przesuwała się wtedy w świecie o (przeskok mod teksel) — pył i cień pola pod smugami
// przeskakiwały. W układzie sceny przebudowa próbkuje te same punkty świata (te same wartości). A/B: FIELD_MAP_TUNE.
// node --test tests/pasMapaPola.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldMap, FIELD_MAP_TUNE } from '../src/3d/asteroids/fieldMap.js';

const RES = 48;
// Pole atrapy: gładkie funkcje punktu świata (mapa zależy tylko od miejsca w świecie).
const field = {
  seed: 7,
  sampleMacro(x, y) {
    return {
      weight: 0.5 + 0.5 * Math.sin(x / 9000), cluster: 0.5 + 0.5 * Math.cos(y / 7000), hole: 1, gas: 0,
      ice: 0.3 + 0.2 * Math.sin((x + y) / 11000)
    };
  }
};
const sunT = (x, y) => 0.5 + 0.5 * Math.sin(x / 13000 + y / 17000);

function build(map, originX, originY) {
  const cam = { x: 1.6e6 + 21234.5, y: 345.6, zoom: 0.45 };
  map.invalidate();
  map.update({ cam, viewW: 5120, viewH: 1440, focalPx: 720 / Math.tan(17.5 * Math.PI / 180), originX, originY, sunT, field });
  const r = map.rect;
  const texel = r.w / RES;
  // róg mapy w układzie sceny: lokalne = scena − początek (x sceny początku = originX, y sceny = −originY)
  return { x: r.x0 + originX, y: r.y0 - originY, texel, data: map.data.slice() };
}

const phase = (v, t) => {
  const p = ((v / t) % 1 + 1) % 1;
  return Math.min(p, 1 - p);
};

test('mapa pola: przebudowa po przeskoku początku próbkuje te same punkty świata (A/B FIELD_MAP_TUNE.worldAnchor)', () => {
  const keep = FIELD_MAP_TUNE.worldAnchor;
  try {
    assert.equal(keep, true, 'domyślnie siatka w układzie sceny');
    const map = new FieldMap();
    assert.equal(map.tune, FIELD_MAP_TUNE, 'uchwyt A/B');
    // początek pola (świat gry) przed i po przeskoku o całkowitą liczbę jednostek (lepki FxPoolOrigin)
    const a = build(map, 1600000, -300);
    const b = build(map, 1620017, -283);
    assert.equal(a.texel, b.texel);
    assert.ok(phase(a.x, a.texel) < 1e-6 && phase(a.y, a.texel) < 1e-6, 'róg = wielokrotność teksela w układzie sceny');
    assert.ok(phase(b.x, b.texel) < 1e-6 && phase(b.y, b.texel) < 1e-6);
    // teksele w tym samym miejscu świata mają te same wartości (połówki float) — obraz bez przeskoku
    const di = Math.round((b.x - a.x) / a.texel);
    const dj = Math.round((b.y - a.y) / a.texel);
    let same = 0;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const ia = i + di;
        const ja = j + dj;
        if (ia < 0 || ja < 0 || ia >= RES || ja >= RES) continue;
        for (let c = 0; c < 4; c++) assert.equal(b.data[(j * RES + i) * 4 + c], a.data[(ja * RES + ia) * 4 + c], `teksel ${i},${j}.${c}`);
        same++;
      }
    }
    assert.ok(same > RES * RES * 0.5, `wspólnych tekseli: ${same}`);
    // A/B: siatka względem początku — po przeskoku inna faza w świecie (przesunięcie o przeskok mod teksel)
    FIELD_MAP_TUNE.worldAnchor = false;
    const c = build(map, 1600000, -300);
    const d = build(map, 1620017, -283);
    const shift = Math.abs(phase(c.x, c.texel) - phase(d.x, d.texel)) + Math.abs(phase(c.y, c.texel) - phase(d.y, d.texel));
    assert.ok(shift > 0.05, `dawniej siatka przeskakiwała w świecie (${shift.toFixed(3)} teksela)`);
  } finally {
    FIELD_MAP_TUNE.worldAnchor = keep;
  }
});
