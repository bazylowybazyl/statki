import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Strażnicy poprawek z audytu rysowania (2026-09-23): każda z tych bramek
// zdejmuje pracę, której nie widać na ekranie (daleki zoom, poza kadrem,
// puste passy). Cofnięcie którejkolwiek nie psuje obrazu — tylko klatkę —
// więc bez testu wróciłaby niezauważona.

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core3d = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
const hexShips = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
const shield3d = readFileSync(new URL('../src/3d/shield3D.js', import.meta.url), 'utf8');

function loadCircleArcInRect() {
  const start = indexHtml.indexOf('const _circleArcScratch');
  const end = indexHtml.indexOf('function strokeHudDashedArc', start);
  assert.ok(start > 0 && end > start, 'circleArcInRect musi stać w index.html przed strokeHudDashedArc');
  const source = indexHtml.slice(start, end);
  return new Function(`${source}\nreturn circleArcInRect;`)();
}

const TAU = Math.PI * 2;

function angleInArc(a, arc) {
  // Kąt a (dowolny) należy do łuku [start, end] z dokładnością do okresu.
  const span = arc.end - arc.start;
  let d = (a - arc.start) % TAU;
  if (d < 0) d += TAU;
  return d <= span + 1e-9;
}

test('circleArcInRect: okrąg w całości poza kadrem albo obejmujący cały kadr = nic do rysowania', () => {
  const circleArcInRect = loadCircleArcInRect();
  // Daleko w bok.
  assert.equal(circleArcInRect(5000, 400, 300, 0, 0, 1920, 1080), null);
  // Zasięg Hexlance (60k j.) przy zoomie 1: kadr leży wewnątrz koła.
  assert.equal(circleArcInRect(960, 540, 60000, 0, 0, 1920, 1080), null);
  // Ten sam zasięg przy zoomie 0.035 (2100 px) — nadal obejmuje cały kadr.
  assert.equal(circleArcInRect(960, 540, 60000 * 0.035, 0, 0, 1920, 1080), null);
});

test('circleArcInRect: środek w kadrze = pełny okrąg', () => {
  const circleArcInRect = loadCircleArcInRect();
  const arc = circleArcInRect(960, 540, 400, 0, 0, 1920, 1080);
  assert.ok(arc);
  assert.equal(arc.start, 0);
  assert.equal(arc.end, TAU);
});

test('circleArcInRect: środek poza kadrem = łuk obejmujący KAŻDY widoczny punkt obwodu', () => {
  const circleArcInRect = loadCircleArcInRect();
  const cases = [
    { cx: -3000, cy: 540, r: 3500 },       // z lewej, wielki promień
    { cx: 960, cy: 9000, r: 8700 },        // z dołu
    { cx: 2500, cy: -700, r: 1400 },       // róg
    { cx: -60000 + 900, cy: 300, r: 60000 } // zasięg 60k przecinający kadr w RTS
  ];
  for (const c of cases) {
    const arc = circleArcInRect(c.cx, c.cy, c.r, 0, 0, 1920, 1080, { start: 0, end: 0 });
    assert.ok(arc, `łuk powinien istnieć dla ${JSON.stringify(c)}`);
    assert.ok(arc.end - arc.start < Math.PI, 'środek poza kadrem => łuk krótszy niż półokrąg');
    let visible = 0;
    for (let i = 0; i < 20000; i++) {
      const a = (i / 20000) * TAU;
      const x = c.cx + Math.cos(a) * c.r;
      const y = c.cy + Math.sin(a) * c.r;
      if (x < 0 || x > 1920 || y < 0 || y > 1080) continue;
      visible++;
      assert.ok(angleInArc(a, arc), `punkt pod kątem ${a.toFixed(4)} wypadł z łuku ${arc.start}..${arc.end}`);
    }
    assert.ok(visible > 0, 'przypadek testowy musi przecinać kadr');
  }
});

test('HUD: okrąg zasięgu i pierścienie skanera idą przez bramkę kadru, bez shadowBlur', () => {
  const rangeFn = indexHtml.match(/function _drawTargetingRange[\s\S]*?\n      }\n/)?.[0] || '';
  assert.match(rangeFn, /circleArcInRect\(/);
  assert.match(rangeFn, /if \(!arc\) return;/);

  const contacts = indexHtml.match(/if \(!radarUiActive && scannerState\.active && scannerContacts\.length\) \{[\s\S]*?PerfHUD\.addTiming\('renderHudTime'/)?.[0] || '';
  assert.ok(contacts.length > 0);
  assert.match(contacts, /hudMarkerOffscreen\(/);
  assert.doesNotMatch(contacts, /ctx\.shadowBlur\s*=/);
});

test('kropki hardpointów NPC są tylko za DevFlags.showNpcHardpoints (domyślnie off)', () => {
  assert.match(indexHtml, /showNpcHardpoints: false/);
  assert.match(indexHtml, /if \(DevFlags\.showNpcHardpoints\) drawNpcHardpointOverlay\(ctx, npc, s\);/);
});

test('trafienia pocisków: efekt 3D i iskry dopiero po bramce kadru/rozmiaru', () => {
  const fn = indexHtml.match(/function spawnBulletImpactEffect\(b, x, y, scale = 1\.0\) \{[\s\S]*?\n    }\n/)?.[0] || '';
  assert.ok(fn.length > 0);
  const gate = fn.indexOf('impactFxScreenPx(x, y, fxSize) >= IMPACT_FX_MIN_PX');
  assert.ok(gate > 0, 'brak bramki rozmiaru/kadru przed efektem trafienia');
  for (const trigger of ['triggerYamatoImpact3D(x', 'triggerArmataImpact3D(x', 'triggerRailgunExplosion3D(x', 'triggerAutocannonImpact3D(x']) {
    assert.ok(fn.indexOf(trigger) > gate, `${trigger} musi stać za bramką`);
  }
  assert.ok(fn.indexOf('spark3D.burst(') > fn.indexOf('IMPACT_SPARK_MIN_PX'), 'iskry za bramką rozrzutu');
});

// Port WebGPU (zadanie 01): renderer.shadowMap ma tylko enabled / type — mapa
// cienia odświeża się per światło. Słońce gry zgłasza się do Core3D, a render()
// raz na klatkę (na starcie, przed pierwszym odbiorcą) ustawia autoUpdate = false
// i needsUpdate = true. Dawne dwa odświeżenia z WebGL (przed ortho i FG) są
// zbędne: ShadowNode i tak aktualizuje najwyżej raz na klatkę rAF (SPIKE 9).
test('Core3D: mapa cienia słońca per światło, odświeżana raz na klatkę na starcie render()', async () => {
  assert.doesNotMatch(core3d, /shadowMap\.(autoUpdate|needsUpdate)\s*=/, 'WebGL-owe flagi mapy cienia wróciły');
  const renderAt = core3d.indexOf('\n  render() {');
  const requestAt = core3d.indexOf('this._requestSunShadowUpdate(t);', renderAt);
  const chainAt = core3d.indexOf('for (const pass of this._scenePasses)', renderAt);
  assert.ok(renderAt > 0 && requestAt > renderAt && requestAt < chainAt, 'odświeżenie mapy przed passami sceny');
  const planets = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
  assert.match(planets, /Core3D\.setSunShadowLight\?\.\(this\.sunLight\);/);
  // Zachowanie: needsUpdate tylko przy włączonych cieniach, autoUpdate zawsze wyłączony.
  globalThis.window = globalThis.window || {};
  const { Core3D } = await import('../src/3d/core3d.js');
  const light = { isLight: true, castShadow: true, shadow: { autoUpdate: true, needsUpdate: false } };
  const core = Object.create(Core3D);
  core.setSunShadowLight(light);
  assert.equal(light.shadow.autoUpdate, false);
  core._requestSunShadowUpdate({ threeShadows: false });
  assert.equal(light.shadow.needsUpdate, false, 'cienie wyłączone — bez odświeżania');
  core._requestSunShadowUpdate({ threeShadows: true });
  assert.equal(light.shadow.needsUpdate, true);
  core.setSunShadowLight(null);
  assert.equal(core._sunShadowLight, null);
});

test('Core3D: puste passy planet/halo/ring-planet/tarcz są pomijane', () => {
  assert.match(core3d, /if \(!this\._scenePassHasContent\(pass, layerActivity\)\) continue;/);
  assert.match(core3d, /layerActivity\.halo !== false && this\.planetHaloTarget/);
  // Właściciele flag: planety (culling) i tarcze.
  const planets = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
  assert.match(planets, /Core3D\.beginPlanetLayerFrame\(\)/);
  assert.match(planets, /markPlanetLayersActive\(anchoredToRing, true\)/);
  assert.match(shield3d, /Core3D\.setShieldLayerActive\(anyDomeVisible \|\| ShieldImpactFX\.hasVisibleContent\(\)\)/);
});

test('hexShips3D: pudło rysowania oddzielone od pudła rozgrzania', () => {
  assert.match(hexShips, /function isEntityInDrawBox\(entity, cull, cameraZoom\)/);
  assert.match(hexShips, /for \(const entity of drawHex\) \{/);
  assert.match(indexHtml, /_hexCullInfo\.drawHalfW = viewHalfW;/);
});

// Port WebGPU (zadanie 04): tablice lamp i stref dysz nie są już uniformami per
// materiał (w WebGL wysyłane przy każdym rysowaniu, stąd needsUpdate: false przy
// zerze). Leżą w jednym buforze storage (HullLightStore) — slot na kadłub, zapis
// i wysyłka tylko przy zmianie podpisu lamp / układu dysz, nigdy przy rysowaniu.
test('hexShips3D: lampy i strefy dysz w buforze storage — wysyłka tylko przy zmianie, pusty kadłub bez slotu', () => {
  const lights = hexShips.slice(hexShips.indexOf('function syncEntityLightUniforms('), hexShips.indexOf('function disposeMeshData('));
  assert.ok(lights.length > 0);
  // Podpis bez zmian = wyjście przed zapisem.
  assert.ok(lights.indexOf('if (payload.signature === data.lightSignature) return;') < lights.indexOf('HullLightStore.markDirty('));
  assert.match(lights, /HullLightStore\.markDirty\(data\.lightSlot, 0, count \* 3\);/);
  // Zero lamp (i stref) = slot wraca do puli; shader i tak czyta tylko do licznika.
  assert.match(lights, /if \(count === 0\) releaseHullLightSlotIfUnused\(data\);/);
  const lacquer = hexShips.slice(hexShips.indexOf('function syncEntityLacquer('), hexShips.indexOf('// Lampy w shaderze kadłuba'));
  assert.ok(lacquer.indexOf('data.zoneMul === zoneMul') < lacquer.indexOf('HullLightStore.markDirty('), 'strefy tylko przy zmianie układu');
  assert.match(lacquer, /HullLightStore\.markDirty\(data\.lightSlot, HULL_LIGHT_ZONE_OFFSET, zoneCount\);/);
  // Jedna wersja bufora na klatkę (zakresy zmienionych slotów).
  assert.equal((hexShips.match(/HullLightStore\.commit\(\);/g) || []).length, 1);
  assert.match(hexShips, /HullLightStore\.release\(data\.lightSlot\);/);
});

test('shield3D: próg kopuły = próg cząstek ShieldImpactFX (9 px)', async () => {
  assert.match(shield3d, /const SHIELD_DOME_MIN_PX = 9;/);
  const src = readFileSync(new URL('../src/3d/shieldImpactFx.js', import.meta.url), 'utf8');
  assert.match(src, /if \(px < 9\) return 0;/);
});

test('stary panel skanera i radar: bez modelu kontaktów, gdy kokpit go chowa / radar wyłączony', () => {
  assert.match(indexHtml, /const legacyScannerPanelVisible = !window\.hudSystem\?\.cockpit;/);
  assert.match(indexHtml, /const scannerUiEnabled = legacyScannerPanelVisible && /);
  assert.match(indexHtml, /const _radarTargets = radarUiEnabled \? lockedTargets\.filter\(/);
  assert.match(indexHtml, /if \(radarUiEnabled && scannerState\.active\) \{/);
});

// ── Druga tura audytu (2026-09-23): przycięcia i stałe koszty w spoczynku ──

const readSrc = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('wybuchy overlaya bez PointLight (scena bez materiałów oświetlanych, światło zmieniało klucz programu)', () => {
  for (const path of ['src/effects3d/reactorblow.js', 'src/effects3d/supernovaMissileBlow.js', 'src/effects3d/yamato.js']) {
    assert.doesNotMatch(readSrc(path), /new THREE\.PointLight/, path);
  }
});

test('martwe: bez regl z unpkg, warp „Nurt” bez własnego kontekstu i bez próbkowania gotowej klatki (Core3D)', () => {
  assert.doesNotMatch(indexHtml, /unpkg\.com\/regl/);
  // Zadanie 22: stara soczewka (warpLensPass / warpLens3D / warpWorldLens / warpFx3D) usunięta
  // razem z no-opami API Core3D; nowy warp to moduły src/3d/warp/ na scenie i kroku efektów Core3D.
  assert.doesNotMatch(indexHtml, /import[^;]*warpLensPass|updateWarpLens3D\(/);
  assert.doesNotMatch(core3d, /import[^;]*warpLens3D|setWarpLensWorld\(|pushWarpSpaceWorld\(|setWarpViewWorld\(/);
  assert.doesNotMatch(core3d, /warpLensTarget|warpStarTarget|_prepareWarpLens|createWarpLensShader/);
  const nurt = readSrc('src/3d/warp/warpNurt.js');
  for (const file of ['warpNurt.js', 'medium.js', 'sprites.js', 'skyBend.js', 'stars.js']) {
    const src = readSrc(`src/3d/warp/${file}`);
    // Jeden renderer (Core3D), bez kanwy 2D jako tekstury i bez celu z gotową klatką („jajko”).
    assert.doesNotMatch(src, /new THREE\.(WebGPURenderer|WebGLRenderer)|getContext\(|texImage2D|composerTarget\.texture/, file);
  }
  assert.match(nurt, /Core3D\.addFxStep\(/);
  assert.match(nurt, /Core3D\.setWarpLayerActive\(/);
  assert.match(core3d, /this\.renderPassWarp = makeScenePass\('warp', 'warp', WARP_MEDIUM_RENDER_LAYER, false, false, false\);/);
  assert.match(core3d, /if \(pass === this\.renderPassWarp\) return activity\.warp === true;/);
});

test('warstwa raw rakiet i pule odłamków paneli: puste siatki są niewidoczne', () => {
  assert.match(readSrc('src/effects3d/rocketFireGPU.js'), /this\.mesh\.visible = this\.highWater > 0;/);
  assert.match(readSrc('src/effects3d/rocketSmokeGPU.js'), /this\.points\.visible = this\.highWater > 0;/);
  assert.match(readSrc('src/effects3d/rocketSystem3D.js'), /this\.mesh\.visible = this\.activeRockets > 0;/);
  const shards = readSrc('src/vfx/panelShardManager.js');
  assert.match(shards, /if \(this\.activeCount === 0\) return;/);
  assert.match(shards, /this\.mesh\.count = 0;\s*this\.mesh\.visible = false;/);
});

test('pociski 3D: barwy HDR raz na styl, upload tylko zajętego wycinka', () => {
  const w3d = readSrc('src/3d/weapon3DSystem.js');
  assert.doesNotMatch(w3d, /colorObj\.set\(style\./);
  assert.match(w3d, /setColorAt\(instanceCount, styleHdr\.core\)/);
  assert.match(w3d, /uploadInstancePrefix\(bulletInstances\.trails\.instanceMatrix, instanceCount, 16\)/);
  assert.doesNotMatch(w3d, /bulletInstances\.heads\.instanceMatrix\.needsUpdate = true;\s*if \(bulletInstances\.trails\.instanceColor\)/);
});

test('overlay: adaptacja jakości z histerezą, pusta lista efektów nie zmienia skali', () => {
  const overlay = readSrc('src/effects3d/overlay.js');
  assert.match(overlay, /const TIER_UPGRADE_HOLD_MS = 1500;/);
  assert.doesNotMatch(overlay, /Math\.max\(targetScale, 0\.76\)/);
});

test('CIC: bez renderu świata 3D pod planszą', () => {
  assert.match(indexHtml, /const skipWorld3D = CICDisplay\.active && !!ship;/);
  assert.match(indexHtml, /if \(skipWorld3D\) \{\s*ctx\.clearRect\(0, 0, W, H\);\s*Core3D\.beginHeatHazeFrame\(\);\s*\} else if \(drawHexShips3D\)/);
});

test('spawn floty: budżet initHexBody na klatkę + rozgrzanie tekstury i lakieru typu kadłuba', () => {
  // Reset raz na klatkę — przed pętlą split-screen, nie w passie NPC.
  assert.match(indexHtml, /beginHexInitBudgetFrame\(\);\s*for \(let _sp = 0; _sp < _splitPassCount; _sp\+\+\)/);
  assert.equal(indexHtml.match(/beginHexInitBudgetFrame\(\);/g)?.length, 1);
  assert.match(indexHtml, /&& hexInitBudgetAllows\(\)\) \{/);
  // Tekstura skóry kadłuba na belkach = pełny sprite (visualImage), rozgrzany przy budowie kadłuba.
  assert.match(indexHtml, /HullBodies\.createHull\(npc, \(hexInit\?\.image \|\| sprite\.image\), \{ visualImage: sprite\.image \}\);/);
  assert.match(indexHtml, /if \(npc\.beamHull\) \{\s*prewarmHexShipVisual\(sprite\.image\);/);
  assert.match(hexShips, /export function prewarmHexShipVisual\(image\)/);
});

test('tekstury planet: dekodowanie po pobraniu i upload z kolejki Core3D', () => {
  assert.match(core3d, /queueTextureUpload\(texture\) \{/);
  assert.match(core3d, /this\.renderer\.initTexture\(texture\);/);
  // WebGPU: initTexture wymaga gotowego urządzenia — kolejka czeka na Core3D.ready
  // (tekstury planet zgłaszają się, zanim urządzenie powstanie).
  const schedule = core3d.slice(core3d.indexOf('_scheduleTextureUpload() {'), core3d.indexOf('_pumpTextureUpload() {'));
  assert.match(schedule, /if \(!this\.gpuReady\) \{[\s\S]*?this\.ready\.then\(/);
  assert.match(readSrc('src/3d/planet3d.assets.js'), /textureLoader\.load\(path, prewarmLoadedTexture\)/);
});
