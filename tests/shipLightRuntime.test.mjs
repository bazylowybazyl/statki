import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SHADER_SHIP_LIGHTS,
  NAV_CLUSTER,
  NAV_LIGHT_CHASE,
  buildCombinedShipLightShaderPayload,
  buildNavLightClusters,
  navChaseSequence,
  buildPositionLightWorldSprites,
  buildRoadLightWorldEmitters,
  buildShipLightShaderPayload,
  computeAutoFloodMarkers,
  computeRoadEmitterReach,
  createRoadEmitterReach,
  floodLightAllowed,
  getEntityLights,
  glslFloat,
  hexToRgb01,
  roadEmittersMayReach
} from '../src/game/shipLightRuntime.js';
import { normalizeLightsBlock } from '../src/ui/shipLightEditorModel.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';

test('editor lights are packed into sprite grid coordinates for shader use', () => {
  const entity = {
    __hardpointScaleX: 2,
    __hardpointScaleY: 0.5,
    editorLights: {
      position: [
        { id: 'p', x: 10, y: -20, color: '#ff2b2b', power: 0.8, radius: 4, sequenceGroup: 'edge' }
      ],
      road: [
        { id: 'r', x: -30, y: 40, color: '#ffffff', power: 3, radius: 14, deg: 90, range: 800, coneDeg: 40 }
      ]
    }
  };
  const grid = { srcWidth: 200, srcHeight: 100, pivot: { x: 5, y: -3 } };

  const payload = buildShipLightShaderPayload(entity, grid);

  // Kierunkowe (reflektory) przed pozycyjnymi — przy nadmiarze lamp wypada
  // lampa pozycyjna, nie reflektor.
  assert.equal(payload.count, 2);
  assert.deepEqual(payload.lights[1].pos, { x: 125, y: 37 });
  assert.equal(payload.lights[1].kind, 'position');
  assert.equal(payload.lights[1].radiusPx, 5);
  assert.deepEqual(payload.lights[0].pos, { x: 45, y: 67 });
  assert.equal(payload.lights[0].kind, 'road');
  assert.deepEqual(payload.lights[0].dir, { x: 1, y: 0 });
  assert.equal(payload.lights[0].rangePx, 1600);
  // Podpis jest liczbą (hash) — skala hardpointu nadal w nim siedzi.
  assert.equal(typeof payload.signature, 'number');
  const rescaled = buildShipLightShaderPayload({ ...entity, __hardpointScaleY: 0.6 }, grid);
  assert.notEqual(rescaled.signature, payload.signature, 'zmiana skali musi zmienić podpis');
});

// Podpis liczbowy (FNV-1a) zamiast join('|') — pakiet F napraw po audycie bitwy.
test('podpis świateł: ten sam blok → ten sam hash, zmiana lampy → inny', () => {
  const lights = {
    position: [{ id: 'p1', x: 10, y: -20, color: '#ff2b2b', power: 0.8, radius: 4 }],
    road: [{ id: 'r1', x: -30, y: 40, color: '#ffffff', power: 3, radius: 14, deg: 90, range: 800, coneDeg: 40 }]
  };
  const grid = { srcWidth: 200, srcHeight: 100, pivot: { x: 5, y: -3 } };
  const a = buildShipLightShaderPayload({ editorLights: lights }, grid).signature;
  const b = buildShipLightShaderPayload({ editorLights: structuredClone(lights) }, grid).signature;
  assert.equal(a, b, 'ten sam blok (także kopia) → ten sam podpis');
  assert.ok(Number.isInteger(a) && a >= 0 && a <= 0xffffffff);

  const moved = structuredClone(lights);
  moved.position[0].x = 11;
  assert.notEqual(buildShipLightShaderPayload({ editorLights: moved }, grid).signature, a, 'przesunięta lampa');
  const recolored = structuredClone(lights);
  recolored.road[0].color = '#ffeeee';
  assert.notEqual(buildShipLightShaderPayload({ editorLights: recolored }, grid).signature, a, 'inny kolor');
  const renamed = structuredClone(lights);
  renamed.road[0].id = 'r2';
  assert.notEqual(buildShipLightShaderPayload({ editorLights: renamed }, grid).signature, a, 'inne id');
  assert.notEqual(buildShipLightShaderPayload({ editorLights: lights }, { ...grid, srcWidth: 201 }).signature, a, 'inna siatka');
});

test('podpis z emiterem zewnętrznym różni się od podpisu bazowego i zależy od emitera', () => {
  const entity = { x: 0, y: 0, radius: 40, editorLights: { position: [{ id: 'p', x: 0, y: 0 }], road: [] } };
  const grid = { srcWidth: 100, srcHeight: 100 };
  const emitter = { owner: {}, ownerId: 'ally', id: 'road0', x: -100, y: 0, dir: { x: 1, y: 0 }, rangeWorld: 400, coneDeg: 40, radiusWorld: 10, power: 3 };
  const base = buildShipLightShaderPayload(entity, grid).signature;
  const combined = buildCombinedShipLightShaderPayload(entity, grid, [emitter]);
  assert.equal(combined.count, 2);
  assert.notEqual(combined.signature, base);
  const again = buildCombinedShipLightShaderPayload(entity, grid, [{ ...emitter }]).signature;
  assert.equal(again, combined.signature);
  const shifted = buildCombinedShipLightShaderPayload(entity, grid, [{ ...emitter, x: -120 }]).signature;
  assert.notEqual(shifted, combined.signature);
});

test('blok lamp jest normalizowany raz na obiekt źródłowy', () => {
  const lights = { position: [{ id: 'p', x: 1, y: 2 }], road: [] };
  const a = getEntityLights({ editorLights: lights });
  const b = getEntityLights({ editorLights: lights });
  assert.equal(a, b, 'to samo źródło → ten sam blok');
  assert.notEqual(getEntityLights({ editorLights: { ...lights } }), a, 'nowe źródło → nowa normalizacja');
  const empty = getEntityLights({});
  assert.equal(getEntityLights(null), empty, 'brak źródła → wspólny pusty blok');
  assert.ok(Object.isFrozen(empty) && empty.position.length === 0 && empty.road.length === 0);
});

test('pudło zasięgu emiterów jest zachowawcze: nie wycina celu, który emiter oświetla', () => {
  let seed = 99;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const emitters = [];
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    emitters.push({
      owner: {}, x: rnd() * 4000 - 2000, y: rnd() * 4000 - 2000,
      dir: { x: Math.cos(a), y: Math.sin(a) }, rangeWorld: 100 + rnd() * 1500, coneDeg: 8 + rnd() * 150,
      radiusWorld: 10, power: 3
    });
  }
  const reach = computeRoadEmitterReach(emitters, createRoadEmitterReach());
  assert.equal(reach.count, 6);
  let reached = 0;
  for (let k = 0; k < 3000; k++) {
    const target = { x: rnd() * 30000 - 15000, y: rnd() * 30000 - 15000, radius: 10 + rnd() * 400, editorLights: null };
    const lit = buildCombinedShipLightShaderPayload(target, { srcWidth: 100, srcHeight: 100 }, emitters).count > 0;
    const may = roadEmittersMayReach(reach, target, { srcWidth: 100, srcHeight: 100 });
    if (lit) {
      reached++;
      assert.ok(may, `cel oświetlony, a pudło go wycięło: ${JSON.stringify(target)}`);
    }
  }
  assert.ok(reached > 20, `za mało oświetlonych celów w próbie: ${reached}`);
  assert.equal(roadEmittersMayReach(reach, { x: 1e7, y: 1e7, radius: 50 }, null), false, 'daleki cel — bez payloadu');
  assert.equal(roadEmittersMayReach(computeRoadEmitterReach([], createRoadEmitterReach()), { x: 0, y: 0, radius: 50 }, null), false);
});

test('shader payload clamps to the max supported light count with directional lights first', () => {
  const position = Array.from({ length: MAX_SHADER_SHIP_LIGHTS + 8 }, (_, i) => ({
    id: `p${i}`,
    x: i,
    y: i,
    color: '#ff2b2b',
    power: 0.8,
    radius: 4
  }));
  const entity = { editorLights: { position, road: [{ id: 'road', x: 0, y: 0 }] } };
  const payload = buildShipLightShaderPayload(entity, { srcWidth: 100, srcHeight: 100 });

  // Kadłub o długości ~100 px przy skali 1 jest za mały na reflektory otoczenia.
  assert.equal(payload.count, MAX_SHADER_SHIP_LIGHTS);
  assert.equal(payload.lights[0].id, 'road', 'reflektor nie wypada przy nadmiarze lamp');
  assert.equal(payload.lights.at(-1).id, `p${MAX_SHADER_SHIP_LIGHTS - 2}`);
});

test('hex colors convert to normalized rgb values', () => {
  assert.deepEqual(hexToRgb01('#ffffff'), { r: 1, g: 1, b: 1 });
  assert.deepEqual(hexToRgb01('#000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexToRgb01('bad', '#ff0000'), { r: 1, g: 0, b: 0 });
});

test('atlas default lights fit in one shader payload', () => {
  const payload = buildShipLightShaderPayload(
    { editorLights: ATLAS_EDITOR_DEFAULTS.lights },
    { srcWidth: 3600, srcHeight: 1300 }
  );

  // Wszystkie lampy z edytora + reflektory otoczenia dużego okrętu (rufa +
  // 2 × 2 burty) mieszczą się — nic nie wypada (przy limicie 32 i 42 lampach
  // pozycyjnych wypadały oba reflektory dziobu).
  const { position, road } = ATLAS_EDITOR_DEFAULTS.lights;
  const floods = payload.lights.filter((l) => l.kind === 'flood');
  assert.equal(floods.length, 5);
  assert.equal(payload.count, position.length + road.length + floods.length);
  assert.ok(payload.count <= MAX_SHADER_SHIP_LIGHTS);
  assert.equal(payload.lights.filter((l) => l.kind === 'road').length, road.length);
});

test('reflektory otoczenia z obrysu lamp: rufa + burty zależnie od długości kadłuba', () => {
  // Obrys prostokąta 1000 × 200 px z lamp pozycyjnych, reflektory dziobu do przodu.
  const outline = [];
  for (let i = 0; i <= 10; i++) {
    outline.push({ x: -500 + i * 100, y: -100 }, { x: -500 + i * 100, y: 100 });
  }
  const lights = { position: outline, road: [{ id: 'r', x: 500, y: 0, deg: 90 }] };
  const block = getEntityLights({ editorLights: lights });
  assert.equal(block.flood.length, 7, 'rufa + para środkowa + dwie pary (filtr per encja)');
  const rear = block.flood.find((f) => f.id === 'auto_flood_rear');
  assert.equal(rear.deg, -90);
  assert.ok(rear.x < -450 && Math.abs(rear.y) < 1);
  for (const f of block.flood.filter((f) => f.id !== 'auto_flood_rear')) {
    assert.ok(Math.abs(f.y) < 100 && Math.abs(f.y) > 60, 'burta tuż wewnątrz obrysu');
    assert.equal(f.deg, f.y < 0 ? 0 : 180, 'burta świeci na zewnątrz');
  }
  const grid = { srcWidth: 1100, srcHeight: 260 };
  const kinds = (scale) => buildShipLightShaderPayload({ editorLights: lights, __hardpointScale: scale }, grid)
    .lights.filter((l) => l.kind === 'flood').map((l) => l.id).sort();
  // Długość = 1000 px × skala: 100 j. (za mały), 400 j. (średni), 1000 j. (duży).
  assert.deepEqual(kinds(0.1), []);
  assert.deepEqual(kinds(0.4), ['auto_flood_mid_l', 'auto_flood_mid_r', 'auto_flood_rear']);
  assert.deepEqual(kinds(1), ['auto_flood_pair0_l', 'auto_flood_pair0_r', 'auto_flood_pair1_l', 'auto_flood_pair1_r', 'auto_flood_rear']);
  // Własny reflektor w bok = kadłub ma już swoje — bez generowanych.
  const own = getEntityLights({ editorLights: { position: outline, road: [{ id: 'side', x: 0, y: 100, deg: 180 }] } });
  assert.equal(own.flood.length, 0);
  // Emitery: reflektory otoczenia jako krótkie reflektory z flagą flood.
  const emitters = buildRoadLightWorldEmitters([{ id: 's', x: 0, y: 0, angle: 0, editorLights: lights }]);
  assert.equal(emitters.filter((e) => e.flood).length, 5);
  assert.equal(emitters.filter((e) => !e.flood).length, 1);
});

test('reflektory z obrysu: generator dla edytora = blok gry, autoFlood:false gasi', () => {
  const outline = [];
  for (let i = 0; i <= 10; i++) {
    outline.push({ x: -500 + i * 100, y: -100 }, { x: -500 + i * 100, y: 100 });
  }
  const lights = { position: outline, road: [{ id: 'r', x: 500, y: 0, deg: 90 }] };
  // Edytor liczy podgląd z tego samego generatora co gra (bez mutacji bloku).
  const plain = normalizeLightsBlock(lights);
  const { hullLenPx, markers } = computeAutoFloodMarkers(plain);
  assert.equal(hullLenPx, 1000);
  assert.equal(plain.flood.length, 0, 'generator nie dopisuje do bloku');
  assert.deepEqual(markers.map((m) => m.id), getEntityLights({ editorLights: lights }).flood.map((f) => f.id));
  // Progi długości: te same, które payload stosuje per encja.
  assert.deepEqual(markers.filter((m) => floodLightAllowed(m, 400)).map((m) => m.id).sort(),
    ['auto_flood_mid_l', 'auto_flood_mid_r', 'auto_flood_rear']);
  assert.ok(floodLightAllowed({ id: 'own' }, 0), 'własny reflektor świeci na każdym kadłubie');
  // Hulk po utracie dowodzenia: lampy bez reflektorów, ale bez automatycznych.
  const dark = getEntityLights({ editorLights: { position: outline, road: [], flood: [], autoFlood: false } });
  assert.equal(dark.flood.length, 0);
  assert.equal(dark.hullLenPx, 1000);
  // Własne reflektory z edytora przechodzą bez zmian i wyłączają generator.
  const own = getEntityLights({ editorLights: { ...lights, flood: [{ id: 'f', x: 0, y: 90, deg: 180 }] } });
  assert.deepEqual(own.flood.map((f) => f.id), ['f']);
  assert.equal(computeAutoFloodMarkers(own).markers.length, 0);
});

test('grupy lamp pozycyjnych: do 4 na statek, sekwencja w [rest, 1], rozlew na inny kadłub', () => {
  const source = { id: 'atlas', x: 0, y: 0, angle: 0, radius: 900, editorLights: ATLAS_EDITOR_DEFAULTS.lights };
  const clusters = buildNavLightClusters([source], { time: 1.3 });
  assert.equal(clusters.length, 4);
  assert.equal(clusters.reduce((s, c) => s + c.count, 0), ATLAS_EDITOR_DEFAULTS.lights.position.length);
  for (const c of clusters) {
    assert.ok(c.pulse >= NAV_LIGHT_CHASE.rest - 1e-9 && c.pulse <= 1 + 1e-9);
    assert.ok(c.rangeWorld > c.spreadWorld);
  }
  // Średnia sekwencji w cyklu zgadza się ze stałą payloadu kadłubów.
  let mean = 0;
  for (let k = 0; k < 2000; k++) mean += navChaseSequence(k / 2000 / NAV_LIGHT_CHASE.speed, 0.3);
  assert.ok(Math.abs(mean / 2000 - NAV_CLUSTER.meanSequence) < 0.03, `średnia sekwencji ${mean / 2000}`);
  // Eskorta obok: dostaje rozlew czerwieni (typ 'omni'), własnych grup nie.
  const target = { id: 'escort', x: 0, y: 1300, angle: 0, radius: 500, editorLights: { position: [], road: [] } };
  const grid = { srcWidth: 1000, srcHeight: 400 };
  const lit = buildCombinedShipLightShaderPayload(target, grid, [], { externalOmniLights: clusters });
  assert.ok(lit.count > 0 && lit.lights.every((l) => l.kind === 'omni' && l.external));
  const self = buildCombinedShipLightShaderPayload(source, grid, [], { externalOmniLights: clusters });
  assert.equal(self.lights.filter((l) => l.kind === 'omni').length, 0);
  const far = buildCombinedShipLightShaderPayload({ ...target, y: 9000 }, grid, [], { externalOmniLights: clusters });
  assert.equal(far.count, 0);
});

test('road lights can be exported as world-space emitters for other ships', () => {
  const source = {
    id: 'source',
    x: 100,
    y: 200,
    angle: Math.PI / 2,
    __hardpointScaleX: 2,
    __hardpointScaleY: 1,
    visual: { spriteScale: 0.5 },
    editorLights: {
      position: [{ id: 'position', x: 0, y: 0 }],
      road: [{ id: 'road', x: 10, y: 0, deg: 90, range: 100, radius: 10, power: 3 }]
    }
  };

  const emitters = buildRoadLightWorldEmitters([source]);

  assert.equal(emitters.length, 1);
  assert.equal(emitters[0].owner, source);
  assert.equal(emitters[0].id, 'road');
  assert.deepEqual({ x: emitters[0].x, y: emitters[0].y }, { x: 100, y: 210 });
  assert.deepEqual({ x: emitters[0].dir.x, y: emitters[0].dir.y }, { x: 0, y: 1 });
  assert.equal(emitters[0].rangeWorld, 100);
  assert.equal(emitters[0].radiusWorld, 7.5);
});

test('external road lights are packed into the target ship shader space', () => {
  const source = {
    id: 'source',
    x: 0,
    y: 0,
    angle: 0,
    editorLights: {
      road: [{ id: 'road', x: 0, y: 0, deg: 90, range: 120, radius: 8, power: 3 }]
    }
  };
  const target = {
    id: 'target',
    x: 50,
    y: 0,
    angle: 0,
    radius: 20,
    editorLights: { position: [], road: [] }
  };
  const grid = { srcWidth: 100, srcHeight: 80, pivot: { x: 0, y: 0 } };

  const emitters = buildRoadLightWorldEmitters([source, target]);
  const payload = buildCombinedShipLightShaderPayload(target, grid, emitters);

  assert.equal(payload.count, 1);
  assert.equal(payload.lights[0].kind, 'road');
  assert.equal(payload.lights[0].external, true);
  assert.deepEqual(payload.lights[0].pos, { x: 0, y: 40 });
  assert.deepEqual(payload.lights[0].dir, { x: 1, y: 0 });
  assert.equal(payload.lights[0].rangePx, 120);
});

test('position lights are exported as world-space sprites with hull-shader phase', () => {
  const entity = {
    id: 'ship',
    x: 100,
    y: 200,
    angle: Math.PI / 2,
    __hardpointScaleX: 2,
    __hardpointScaleY: 1,
    visual: { spriteScale: 0.5 },
    hexGrid: { srcWidth: 200, srcHeight: 100, pivot: { x: 10, y: 0 } },
    editorLights: {
      position: [{ id: 'p', x: 40, y: -20, color: '#00ff88', power: 2, radius: 8 }],
      road: []
    }
  };

  const sprites = buildPositionLightWorldSprites([entity]);

  assert.equal(sprites.length, 1);
  const sprite = sprites[0];
  assert.deepEqual({ x: sprite.x, y: sprite.y }, { x: 110, y: 240 });
  // phase = (local.x*scaleX + srcWidth/2 + pivotX) / srcWidth — dokładnie jak
  // localPhase w pętli lamp shadera kadłuba.
  assert.equal(sprite.phase, 0.95);
  assert.equal(sprite.coreWorld, 6);
  assert.equal(sprite.haloWorld, 96);
  assert.equal(sprite.intensity, 2);
  assert.equal(sprite.color.g, 1);
});

test('position light sprites honor min halo size and fade out subpixel ships', () => {
  const tiny = {
    id: 'tiny',
    x: 0,
    y: 0,
    angle: 0,
    radius: 10,
    editorLights: { position: [{ id: 'a', x: 0, y: 0, radius: 1 }], road: [] }
  };
  const big = {
    id: 'big',
    x: 500,
    y: 0,
    angle: 0,
    radius: 2000,
    editorLights: { position: [{ id: 'b', x: 0, y: 0, radius: 1 }], road: [] }
  };

  const sprites = buildPositionLightWorldSprites([tiny, big], { zoom: 0.1, minHaloWorld: 50 });

  assert.equal(sprites.length, 1);
  assert.equal(sprites[0].x, 500);
  assert.equal(sprites[0].haloWorld, 50);
});

test('position light sprites are capped by maxSprites', () => {
  const position = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
  const entity = { id: 'ship', x: 0, y: 0, angle: 0, editorLights: { position, road: [] } };

  const sprites = buildPositionLightWorldSprites([entity], { maxSprites: 8 });

  assert.equal(sprites.length, 8);
});

test('nav light chase sequence runs from bow to stern', () => {
  // Dziób = wyższa faza (większe X sprite'a). Błysk aktywuje się, gdy
  // fract(t*speed + phase*gain) wchodzi w okno ataku — dziób musi błysnąć
  // wcześniej niż rufa ("od prawej do lewej" przy dziobie w prawo).
  // Zbocze narastające: światło mogło jeszcze dogasać z poprzedniego cyklu
  // w t=0, więc szukamy pierwszego WEJŚCIA w okno błysku, nie samego stanu.
  const firstFlashStart = (phase) => {
    let wasFlashing = true;
    for (let t = 0; t < 2 / NAV_LIGHT_CHASE.speed; t += 0.005) {
      const chase = (t * NAV_LIGHT_CHASE.speed + phase * NAV_LIGHT_CHASE.phaseGain) % 1;
      const flashing = chase < NAV_LIGHT_CHASE.attack;
      if (flashing && !wasFlashing) return t;
      wasFlashing = flashing;
    }
    return Infinity;
  };

  const bow = firstFlashStart(0.9);
  const mid = firstFlashStart(0.5);
  const stern = firstFlashStart(0.1);
  assert.ok(bow < mid && mid < stern, `expected bow (${bow}) < mid (${mid}) < stern (${stern})`);
});

test('glslFloat always emits a float literal', () => {
  assert.equal(glslFloat(1), '1.0000');
  assert.equal(glslFloat(0.42), '0.4200');
  assert.equal(glslFloat('bad', 0.5), '0.5000');
});

test('external road lights skip ships outside the cone', () => {
  const source = {
    id: 'source',
    x: 0,
    y: 0,
    angle: 0,
    editorLights: {
      road: [{ id: 'road', x: 0, y: 0, deg: 90, range: 120, coneDeg: 30 }]
    }
  };
  const behindSource = {
    id: 'target',
    x: -60,
    y: 0,
    angle: 0,
    radius: 16
  };

  const emitters = buildRoadLightWorldEmitters([source, behindSource]);
  const payload = buildCombinedShipLightShaderPayload(
    behindSource,
    { srcWidth: 100, srcHeight: 80 },
    emitters
  );

  assert.equal(payload.count, 0);
});

// Payload świateł zewnętrznych wybiera najbliższe sięgające światła bez sortowania
// wszystkich kandydatów (bufor K najbliższych). Wzorzec: filtr + stabilny sort
// całej listy + pierwsze K — tak liczyła wersja sprzed optymalizacji.
test('światła zewnętrzne: K najbliższych sięgających, remis → wcześniejsze (jak stabilny sort)', () => {
  let seed = 4242;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const grid = { srcWidth: 100, srcHeight: 100 };
  const reachOmni = (l, t) => {
    const reach = Math.max(1, Number(l.rangeWorld) || 1) + t.radius;
    const dx = t.x - l.x, dy = t.y - l.y;
    return dx * dx + dy * dy <= reach * reach;
  };
  const reachRoad = (e, t) => {
    const dx = t.x - e.x, dy = t.y - e.y;
    const along = dx * e.dir.x + dy * e.dir.y;
    const range = Math.max(1, Number(e.rangeWorld) || 1);
    if (along < -t.radius || along > range + t.radius) return false;
    const perpSq = Math.max(0, dx * dx + dy * dy - along * along);
    const cone = Math.max(0, along) * Math.tan(Math.max(8, Math.min(160, e.coneDeg)) * Math.PI / 360) + t.radius;
    return perpSq <= cone * cone;
  };
  const expected = (list, t, test, k) => list
    .map((l, i) => ({ l, i, d: (t.x - l.x) ** 2 + (t.y - l.y) ** 2 }))
    .filter(({ l }) => l.owner !== t && l.power > 0 && test(l, t))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map(({ l }) => `external:${l.ownerId}:${l.id}`);
  // Siatka punktów (0, 50, 100 …) daje remisy odległości — sprawdzają kolejność.
  const snap = () => Math.round((rnd() - 0.5) * 16) * 50;
  let checked = 0;
  for (let scene = 0; scene < 300; scene++) {
    const target = { id: 't', x: 0, y: 0, angle: 0, radius: 20 + rnd() * 200, editorLights: { position: [], road: [] } };
    const owner = {};
    const omni = Array.from({ length: Math.floor(rnd() * 40) }, (_, i) => ({
      owner: rnd() < 0.05 ? target : owner, ownerId: `o${i % 7}`, id: `nav${i}`,
      x: snap(), y: snap(), rangeWorld: 50 + rnd() * 400, power: rnd() < 0.05 ? 0 : 1 + rnd(), mean: 0.44,
      color: { r: 1, g: 0, b: 0 }
    }));
    const emitters = Array.from({ length: Math.floor(rnd() * 40) }, (_, i) => {
      const a = Math.floor(rnd() * 8) * Math.PI / 4;
      return {
        owner: rnd() < 0.05 ? target : owner, ownerId: `e${i % 5}`, id: `road${i}`,
        x: snap(), y: snap(), dir: { x: Math.cos(a), y: Math.sin(a) },
        rangeWorld: 100 + rnd() * 600, coneDeg: 8 + rnd() * 150, radiusWorld: 10, power: 3, color: { r: 1, g: 1, b: 1 }
      };
    });
    const payload = buildCombinedShipLightShaderPayload(target, grid, emitters, { externalOmniLights: omni });
    const got = payload.lights.filter((l) => l.external).map((l) => l.id);
    const want = [...expected(omni, target, reachOmni, 4), ...expected(emitters, target, reachRoad, 8)];
    assert.deepEqual(got, want, `scena ${scene}`);
    checked += want.length;
  }
  assert.ok(checked > 1000, `za mało wybranych świateł w próbie: ${checked}`);
});

test('własne lampy: wynik z cache per encja, przeliczany po zmianie skali, siatki albo źródła', () => {
  const lights = {
    position: [{ id: 'p1', x: 10, y: -20, color: '#ff2b2b', power: 0.8, radius: 4 }],
    road: [{ id: 'r1', x: -30, y: 40, color: '#ffffff', power: 3, radius: 14, deg: 90, range: 800, coneDeg: 40 }]
  };
  const entity = { editorLights: lights, __hardpointScale: 1 };
  const grid = { srcWidth: 200, srcHeight: 100, pivot: { x: 5, y: -3 } };
  const a = buildShipLightShaderPayload(entity, grid);
  a.lights.push({ id: 'obcy' }); // wynik należy do wołającego — cache tego nie widzi
  const b = buildShipLightShaderPayload(entity, grid);
  assert.equal(b.count, 2);
  assert.deepEqual(b.lights.map((l) => l.id), ['r1', 'p1']);
  assert.equal(b.signature, buildShipLightShaderPayload({ editorLights: lights, __hardpointScale: 1 }, grid).signature);

  entity.__hardpointScale = 2;
  const scaled = buildShipLightShaderPayload(entity, grid);
  assert.notEqual(scaled.signature, b.signature, 'skala hardpointu');
  assert.equal(scaled.lights[1].radiusPx, 8);

  grid.pivot = { x: 6, y: -3 };
  const moved = buildShipLightShaderPayload(entity, grid);
  assert.notEqual(moved.signature, scaled.signature, 'pivot siatki');
  assert.equal(moved.lights[1].pos.x, scaled.lights[1].pos.x + 1);

  entity.editorLights = { ...lights, position: [{ ...lights.position[0], x: 11 }] };
  const relit = buildShipLightShaderPayload(entity, grid);
  assert.notEqual(relit.signature, moved.signature, 'nowe źródło lamp');
  assert.deepEqual(relit, buildShipLightShaderPayload({ editorLights: entity.editorLights, __hardpointScale: 2 }, grid));
});
