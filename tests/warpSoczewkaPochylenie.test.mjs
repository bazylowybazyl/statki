// Pochylenie soczewki świata z adresu (3a, 2026-10-29): `?warpSoczewka=plaska` / liczba → hf mapy O1
// (src/3d/warp/worldLens.js: parseWarpLensTilt, sterownik warpNurt.js: _commitWorldLens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseWarpLensTilt, WARP_LENS_FLAT_HF, WARP_LENS_HF_RANGE, WORLD_LENS_DEFAULTS, mapWorldLens, warpLensFrame,
  newWarpLensFrame
} from '../src/3d/warp/worldLens.js';

test('parseWarpLensTilt: słowo, liczba, zakres, brak', () => {
  assert.ok(Number.isNaN(parseWarpLensTilt('')));
  assert.ok(Number.isNaN(parseWarpLensTilt(undefined)));
  assert.ok(Number.isNaN(parseWarpLensTilt('?warpFx=wszystko')));
  assert.ok(Number.isNaN(parseWarpLensTilt('?warpSoczewka=xyz')));
  assert.ok(Number.isNaN(parseWarpLensTilt('?warpSoczewka=')));
  assert.equal(parseWarpLensTilt('?warpSoczewka=plaska'), WARP_LENS_FLAT_HF);
  assert.equal(parseWarpLensTilt('?dev=1&warpSoczewka=p%C5%82aska&renderWorker=1'), WARP_LENS_FLAT_HF);
  assert.equal(parseWarpLensTilt('?warpSoczewka=FLAT'), WARP_LENS_FLAT_HF);
  assert.equal(parseWarpLensTilt('?warpSoczewka=1.5'), 1.5);
  assert.equal(parseWarpLensTilt('?warpSoczewka=1,5'), 1.5);
  assert.equal(parseWarpLensTilt('?warpSoczewka=1'), 1);
  assert.equal(parseWarpLensTilt('?warpSoczewka=99'), WARP_LENS_HF_RANGE[1]);
  assert.equal(parseWarpLensTilt('?warpSoczewka=0.1'), WARP_LENS_HF_RANGE[0]);
  assert.ok(WARP_LENS_FLAT_HF > 1, 'płaska: punkt zbiegu nad górną krawędzią kadru');
  assert.equal(WORLD_LENS_DEFAULTS.hf, 0.8, 'domyślne pochylenie bez zmian');
});

test('pochylenie płaskie: dalekie ciało za górną krawędzią, skala w trawersie bez zmian', () => {
  // 1080p, kurs w górę ekranu, kotwica 100 px pod środkiem kadru, pełny udział soczewki
  const base = { zoom: 0.02, beta: 1, velAngle: -Math.PI / 2, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: 100 };
  const far = (hf) => mapWorldLens(0, -1e6, 1000, { ...base, hf }, {});
  const yDef = 100 + far(WORLD_LENS_DEFAULTS.hf).y;
  const yFlat = 100 + far(WARP_LENS_FLAT_HF).y;
  assert.ok(yDef > -540 && yDef < 100, `domyślnie dalekie ciało w kadrze przed dziobem (y ${yDef.toFixed(0)})`);
  assert.ok(yFlat < -540, `płaska: dalekie ciało jeszcze nad górną krawędzią (y ${yFlat.toFixed(0)})`);
  // ciało w trawersie (a = 0): ta sama skala s przy każdym hf
  const side = (hf) => mapWorldLens(75000, 0, 30000, { ...base, hf }, {}).q;
  assert.ok(Math.abs(side(WORLD_LENS_DEFAULTS.hf) - side(WARP_LENS_FLAT_HF)) < 1e-12);
  // punkt zbiegu i płaszczyzna kamery rosną z hf proporcjonalnie, s bez zmian
  const F0 = warpLensFrame(0, -1, 960, 540, 0, 100, { ...WORLD_LENS_DEFAULTS }, newWarpLensFrame());
  const s0 = F0.s;
  const A0 = F0.A;
  const Ef0 = F0.Ef;
  const F1 = warpLensFrame(0, -1, 960, 540, 0, 100, { ...WORLD_LENS_DEFAULTS, hf: WARP_LENS_FLAT_HF }, newWarpLensFrame());
  assert.ok(Math.abs(F1.s - s0) < 1e-15);
  assert.ok(Math.abs(F1.A / A0 - WARP_LENS_FLAT_HF / WORLD_LENS_DEFAULTS.hf) < 1e-9);
  assert.ok(Ef0 < F1.ef && F1.Ef > F1.ef, 'punkt zbiegu: domyślnie w kadrze, płaska — nad krawędzią');
});

test('sterownik: przełącznik z adresu strony stosowany przy zmianie adresu (także w workerze — RenderWorld.pageSearch)', () => {
  const src = readFileSync(new URL('../src/3d/warp/warpNurt.js', import.meta.url), 'utf8');
  const i = src.indexOf('_commitWorldLens(o, t, dt, camX, camY, zoom, view, hasPlayer) {');
  assert.ok(i > 0);
  const body = src.slice(i, i + 1200);
  assert.match(body, /RenderWorld\.pageSearch/);
  assert.match(body, /if \(search !== this\._lensTiltSearch\)/);
  assert.match(body, /const hf = parseWarpLensTilt\(search\);/);
  assert.match(body, /WARP_LENS_SHARED\.params\.hf = hf > 0 \? hf : WORLD_LENS_DEFAULTS\.hf;/);
});
