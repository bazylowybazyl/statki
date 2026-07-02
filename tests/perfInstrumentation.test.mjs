import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core3dJs = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
const hexShips3dJs = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
const engineEffectsJs = readFileSync(new URL('../Engineeffects.js', import.meta.url), 'utf8');

const requiredPhysicsCounters = [
  'preAiTime',
  'projectileTime',
  'destructiblePrepTime',
  'hardpointTime',
  'hudNavTime',
  'worldZoneTime',
  'playerSystemsTime',
  'scanUiTime',
  'playerFlightTime',
  'wreckPrepTime',
  'ciwsTime',
  'bulletGridTime',
  'bulletMoveVfxTime',
  'bulletInterceptTime',
  'bulletNpcHitTime',
  'bulletAsteroidTime',
  'bulletRingTime',
  'bulletMiscHitTime',
  'npcFireTime',
  'npcFireScanTime',
  'npcFireSpawnTime',
  'aiSquadsTime',
  'aiSupportWingTime',
  'aiNpcStepTime',
  'aiNpcGridTime',
  'aiNpcEnemyBrainTime',
  'aiNpcFriendlyBrainTime',
  'aiNpcOtherTime',
  'aiPirateMissionTime',
  'aiSeparationTime',
  'aiWeaponScanTime',
  'aiTargetPickTime'
];

const requiredRenderCounters = [
  'renderPrepTime',
  'render3dUpdateTime',
  'render3dPlanetsUpdateTime',
  'render3dRingsUpdateTime',
  'render3dStationsUpdateTime',
  'render3dWorldUpdateTime',
  'render3dAsteroidsUpdateTime',
  'render3dDestructionUpdateTime',
  'render3dHexUpdateTime',
  'render3dShieldsUpdateTime',
  'render3dDrawTime',
  'render2dWorldTime',
  'render2dNpcTime',
  'render2dPlayerTime',
  'render2dProjectilesTime',
  'render2dVfxTime',
  'renderHudTime',
  'renderUiTime',
  'render3dCoreCallTime',
  'render3dCoreRenderTime',
  'render3dComposerTime',
  'render3dBlitTime'
];

const requiredDrawInfoElementIds = [
  'perfDrawCallsRefraction',
  'perfDrawCallsBg',
  'perfDrawCallsPlanets',
  'perfDrawCallsShafts',
  'perfDrawCallsOrtho',
  'perfDrawCallsFg',
  'perfDrawCallsBloom',
  'perfDrawCallsPost',
  'perfDrawCallsOther'
];

test('PerfHUD exposes physics subsection counters in the panel', () => {
  const requiredElementIds = [
    'perfPreAi',
    'perfProjectiles',
    'perfDestructiblePrep',
    'perfHardpoints',
    'perfHudNav',
    'perfWorldZone',
    'perfPlayerSystems',
    'perfScanUi',
    'perfPlayerFlight',
    'perfWreckPrep',
    'perfCiws',
    'perfBulletGrid',
    'perfBulletMoveVfx',
    'perfBulletIntercept',
    'perfBulletNpcHit',
    'perfBulletAsteroids',
    'perfBulletRing',
    'perfBulletMiscHits',
    'perfNpcFire',
    'perfNpcFireScan',
    'perfNpcFireSpawn',
    'perfAiSquads',
    'perfAiSupportWing',
    'perfAiNpcStep',
    'perfAiNpcGrid',
    'perfAiNpcEnemyBrain',
    'perfAiNpcFriendlyBrain',
    'perfAiNpcOther',
    'perfAiPirateMission',
    'perfAiSeparation',
    'perfAiWeaponScan',
    'perfAiTargetPick'
  ];

  for (const id of requiredElementIds) {
    assert.ok(indexHtml.includes(`id="${id}"`), `${id} row is missing`);
  }
});

test('PerfHUD exposes render subsection counters in the panel', () => {
  const requiredElementIds = [
    'perfRenderPrep',
    'perfRender3dUpdate',
    'perfRender3dPlanetsUpdate',
    'perfRender3dRingsUpdate',
    'perfRender3dStationsUpdate',
    'perfRender3dWorldUpdate',
    'perfRender3dAsteroidsUpdate',
    'perfRender3dDestructionUpdate',
    'perfRender3dHexUpdate',
    'perfRender3dShieldsUpdate',
    'perfRender3dDraw',
    'perfRender2dWorld',
    'perfRender2dNpc',
    'perfRender2dPlayer',
    'perfRender2dProjectiles',
    'perfRender2dVfx',
    'perfRenderHud',
    'perfRenderUi',
    'perfRender3dCoreCall',
    'perfRender3dCoreRender',
    'perfRender3dComposer',
    'perfRender3dBlit'
  ];

  for (const id of requiredElementIds) {
    assert.ok(indexHtml.includes(`id="${id}"`), `${id} row is missing`);
  }
});

test('PerfHUD exposes the untracked frame gap in the panel', () => {
  assert.ok(indexHtml.includes('id="perfFrameUntracked"'), 'perfFrameUntracked row is missing');
  assert.ok(indexHtml.includes('id="barFrameUntracked"'), 'barFrameUntracked is missing');
  assert.ok(indexHtml.includes('frameUntrackedTime'), 'frameUntrackedTime display state is missing');
  // Untracked = klatka minus wszystkie mierzone buckety najwyższego poziomu
  // (fizyka, rysowanie, deformacje destruktora, CanvasVFX, overlay FX 3D).
  assert.ok(indexHtml.includes('this.display.frameUntrackedTime = Math.max(0, this.display.frameMs'), 'frame gap calculation is missing');
  assert.ok(indexHtml.includes('- this.display.physicsTime'), 'frame gap should subtract physics time');
  assert.ok(indexHtml.includes('- this.display.drawTime'), 'frame gap should subtract draw time');
  assert.ok(indexHtml.includes('- this.display.overlayFxTime'), 'frame gap should subtract overlay FX time');
});

test('PerfHUD exposes enemy versus allied NPC counts', () => {
  assert.ok(indexHtml.includes('id="perfNpcTeams"'), 'perfNpcTeams row is missing');
  assert.ok(indexHtml.includes('enemyNpcCount'), 'enemy NPC count display state is missing');
  assert.ok(indexHtml.includes('friendlyNpcCount'), 'friendly NPC count display state is missing');
  assert.ok(indexHtml.includes('enemyFighterCount'), 'enemy fighter count display state is missing');
  assert.ok(indexHtml.includes('friendlyFighterCount'), 'friendly fighter count display state is missing');
});

test('PerfHUD exposes engine PointLight diagnostics and toggle', () => {
  assert.ok(indexHtml.includes('id="perfPointLights"'), 'perfPointLights row is missing');
  assert.ok(indexHtml.includes('id="perfToggleEngineLights"'), 'engine light toggle is missing');
  assert.ok(indexHtml.includes('enginePointLights'), 'engine point light toggle state is missing');
  assert.ok(indexHtml.includes('enginePointLightCount'), 'engine point light count is missing');
  assert.ok(core3dJs.includes('enginePointLights'), 'Core3D engine light perf toggle is missing');
  assert.ok(engineEffectsJs.includes('userData.enginePointLight'), 'engine exhaust PointLight marker is missing');
  assert.ok(engineEffectsJs.includes('areEnginePointLightsEnabled'), 'engine exhaust PointLight toggle check is missing');
});

test('PerfHUD exposes draw-call pass breakdown rows', () => {
  for (const id of requiredDrawInfoElementIds) {
    assert.ok(indexHtml.includes(`id="${id}"`), `${id} row is missing`);
  }
  assert.ok(indexHtml.includes('formatDrawInfo'), 'draw-call formatter is missing');
  assert.ok(indexHtml.includes('ri.passes'), 'PerfHUD does not read Core3D pass breakdowns');
});

test('PerfHUD exposes collapsible section controls', () => {
  const requiredToggles = [
    'data-perf-toggle="physics"',
    'data-perf-toggle="ai"',
    'data-perf-toggle="render"',
    'data-perf-toggle="render3dDraw"'
  ];

  for (const toggle of requiredToggles) {
    assert.ok(indexHtml.includes(toggle), `${toggle} is missing`);
  }

  assert.ok(indexHtml.includes('collapsedSections'), 'PerfHUD collapsed section state is missing');
  assert.ok(indexHtml.includes('applySectionCollapse'), 'PerfHUD collapse applier is missing');
  assert.ok(indexHtml.includes('data-perf-caret'), 'PerfHUD caret markers are missing');
});

test('PerfHUD tracks and resets physics subsection timings', () => {
  for (const key of requiredPhysicsCounters) {
    assert.ok(indexHtml.includes(`${key}: 0`), `${key} is missing from PerfHUD state`);
    assert.match(indexHtml, new RegExp(`this\\.display\\.${key}\\s*=\\s*this\\.accum\\.${key}`), `${key} is missing from flush`);
    assert.match(indexHtml, new RegExp(`this\\.accum\\.${key}\\s*=\\s*0`), `${key} is missing from resetAccum`);
  }
});

test('PerfHUD tracks and resets render subsection timings', () => {
  for (const key of requiredRenderCounters) {
    assert.ok(indexHtml.includes(`${key}: 0`), `${key} is missing from PerfHUD state`);
    assert.match(indexHtml, new RegExp(`this\\.display\\.${key}\\s*=\\s*this\\.accum\\.${key}`), `${key} is missing from flush`);
    assert.match(indexHtml, new RegExp(`this\\.accum\\.${key}\\s*=\\s*0`), `${key} is missing from resetAccum`);
  }
});

test('physicsStep records the missing high-level subsection timings', () => {
  const requiredTimingCalls = [
    "PerfHUD.addTiming('preAiTime'",
    "PerfHUD.addTiming('projectileTime'",
    "PerfHUD.addTiming('destructiblePrepTime'",
    "PerfHUD.addTiming('hardpointTime'",
    "PerfHUD.addTiming('hudNavTime'",
    "PerfHUD.addTiming('worldZoneTime'",
    "PerfHUD.addTiming('playerSystemsTime'",
    "PerfHUD.addTiming('scanUiTime'",
    "PerfHUD.addTiming('playerFlightTime'",
    "PerfHUD.addTiming('wreckPrepTime'",
    "PerfHUD.addTiming('ciwsTime'",
    "PerfHUD.addTiming('npcFireTime'",
    "PerfHUD.addTiming('npcFireScanTime'",
    "PerfHUD.addTiming('npcFireSpawnTime'",
    "PerfHUD.addTiming('aiSquadsTime'",
    "PerfHUD.addTiming('aiSupportWingTime'",
    "PerfHUD.addTiming('aiNpcStepTime'",
    "PerfHUD.addTiming('aiNpcGridTime'",
    "PerfHUD.addTiming('aiNpcEnemyBrainTime'",
    "PerfHUD.addTiming('aiNpcFriendlyBrainTime'",
    "PerfHUD.addTiming('aiNpcOtherTime'",
    "PerfHUD.addTiming('aiPirateMissionTime'",
    "PerfHUD.addTiming('aiSeparationTime'",
    "PerfHUD.addTiming('aiWeaponScanTime'",
    "PerfHUD.addTiming('aiTargetPickTime'"
  ];

  for (const call of requiredTimingCalls) {
    assert.ok(indexHtml.includes(call), `${call} is not wired in physicsStep`);
  }
});

test('render records major draw subsection timings', () => {
  const requiredTimingCalls = [
    "PerfHUD.addTiming('renderPrepTime'",
    "PerfHUD.addTiming('render3dUpdateTime'",
    "PerfHUD.addTiming('render3dPlanetsUpdateTime'",
    "PerfHUD.addTiming('render3dRingsUpdateTime'",
    "PerfHUD.addTiming('render3dStationsUpdateTime'",
    "PerfHUD.addTiming('render3dWorldUpdateTime'",
    "PerfHUD.addTiming('render3dAsteroidsUpdateTime'",
    "PerfHUD.addTiming('render3dDestructionUpdateTime'",
    "PerfHUD.addTiming('render3dHexUpdateTime'",
    "PerfHUD.addTiming('render3dShieldsUpdateTime'",
    "PerfHUD.addTiming('render3dDrawTime'",
    "PerfHUD.addTiming('render2dWorldTime'",
    "PerfHUD.addTiming('render2dNpcTime'",
    "PerfHUD.addTiming('render2dPlayerTime'",
    "PerfHUD.addTiming('render2dProjectilesTime'",
    "PerfHUD.addTiming('render2dVfxTime'",
    "PerfHUD.addTiming('renderHudTime'",
    "PerfHUD.addTiming('renderUiTime'",
    "PerfHUD.addTiming('render3dCoreCallTime'",
    "PerfHUD.addTiming('render3dCoreRenderTime'",
    "PerfHUD.addTiming('render3dComposerTime'",
    "PerfHUD.addTiming('render3dBlitTime'"
  ];

  for (const call of requiredTimingCalls) {
    assert.ok(indexHtml.includes(call), `${call} is not wired in render`);
  }
});

test('3D draw exposes core render and blit timings', () => {
  assert.ok(core3dJs.includes('lastFramePerf'), 'Core3D lastFramePerf is missing');
  assert.ok(core3dJs.includes('composerMs'), 'Core3D composer timing is missing');
  assert.ok(core3dJs.includes('renderTotalMs'), 'Core3D total render timing is missing');
  assert.ok(hexShips3dJs.includes('__hexShips3DLastDrawPerf'), 'hexShips3D draw perf bridge is missing');
  assert.ok(hexShips3dJs.includes('coreCallMs'), 'hexShips3D core call timing is missing');
  assert.ok(hexShips3dJs.includes('blitMs'), 'hexShips3D blit timing is missing');
});

test('Core3D exposes renderer.info deltas per render pass', () => {
  const requiredCore3dSnippets = [
    'lastFrameRenderInfo',
    '_wrapRenderInfoPass',
    '_addRenderInfoDelta',
    '_resetRenderInfoBuckets',
    "bucketName === 'fg'",
    "bucketName === 'bloom'",
    "bucketName === 'refraction'"
  ];

  for (const snippet of requiredCore3dSnippets) {
    assert.ok(core3dJs.includes(snippet), `${snippet} is missing from Core3D draw-call instrumentation`);
  }
});

test('bulletsAndCollisionsStep records projectile hot-path subsection timings', () => {
  const requiredTimingCalls = [
    "PerfHUD.addTiming('bulletGridTime'",
    "PerfHUD.addTiming('bulletMoveVfxTime'",
    "PerfHUD.addTiming('bulletInterceptTime'",
    "PerfHUD.addTiming('bulletNpcHitTime'",
    "PerfHUD.addTiming('bulletAsteroidTime'",
    "PerfHUD.addTiming('bulletRingTime'",
    "PerfHUD.addTiming('bulletMiscHitTime'"
  ];

  for (const call of requiredTimingCalls) {
    assert.ok(indexHtml.includes(call), `${call} is not wired in bulletsAndCollisionsStep`);
  }
});
