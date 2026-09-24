import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SHADER_SHIP_LIGHTS,
  NAV_LIGHT_CHASE,
  buildCombinedShipLightShaderPayload,
  buildPositionLightWorldSprites,
  buildRoadLightWorldEmitters,
  buildShipLightShaderPayload,
  computeRoadEmitterReach,
  createRoadEmitterReach,
  getEntityLights,
  glslFloat,
  hexToRgb01,
  roadEmittersMayReach
} from '../src/game/shipLightRuntime.js';
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

  assert.equal(payload.count, 2);
  assert.deepEqual(payload.lights[0].pos, { x: 125, y: 37 });
  assert.equal(payload.lights[0].kind, 'position');
  assert.equal(payload.lights[0].radiusPx, 5);
  assert.deepEqual(payload.lights[1].pos, { x: 45, y: 67 });
  assert.equal(payload.lights[1].kind, 'road');
  assert.deepEqual(payload.lights[1].dir, { x: 1, y: 0 });
  assert.equal(payload.lights[1].rangePx, 1600);
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

test('shader payload clamps to the max supported light count with position lights first', () => {
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

  assert.equal(payload.count, MAX_SHADER_SHIP_LIGHTS);
  assert.equal(payload.lights.at(-1).id, `p${MAX_SHADER_SHIP_LIGHTS - 1}`);
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

  assert.equal(ATLAS_EDITOR_DEFAULTS.lights.position.length, 20);
  assert.equal(ATLAS_EDITOR_DEFAULTS.lights.road.length, 2);
  assert.equal(payload.count, 22);
  assert.ok(payload.count <= MAX_SHADER_SHIP_LIGHTS);
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
