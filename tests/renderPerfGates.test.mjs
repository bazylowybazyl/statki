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

// Zadanie 17: trafienie = receptura rodziny z dema bronie-webgpu (WeaponFx.impact) zamiast
// fabryk overlaya (trigger*3D) i iskier SparkSystem3D.burst — bramki kadru/rozmiaru i
// cooldownu komórki zostają przed recepturą.
test('trafienia pocisków: receptura WeaponFx dopiero po bramce kadru/rozmiaru i cooldownu', () => {
  const fn = indexHtml.match(/function spawnBulletImpactEffect\(b, x, y, scale = 1\.0, hit = null\) \{[\s\S]*?\n    }\n/)?.[0] || '';
  assert.ok(fn.length > 0);
  const gate = fn.indexOf('impactFxScreenPx(x, y, fxSize) >= IMPACT_FX_MIN_PX');
  assert.ok(gate > 0, 'brak bramki rozmiaru/kadru przed efektem trafienia');
  const cooldown = fn.indexOf('impactFxCooldownReady(');
  assert.ok(cooldown > gate, 'cooldown komórki za bramką kadru');
  assert.ok(fn.indexOf('WeaponFx.impact(') > cooldown, 'receptura trafienia musi stać za bramkami');
  assert.doesNotMatch(fn, /trigger\w+3D\(|spark3D\.burst\(/, 'stare efekty trafień (overlay, iskry) wróciły');
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
  // (yamato.js usunięty w zadaniu 17 — trafienie Yamato to receptura WeaponFx w Core3D.)
  for (const path of ['src/effects3d/reactorblow.js']) {
    assert.doesNotMatch(readSrc(path), /new THREE\.PointLight/, path);
  }
  // Rakiety i Supernowa (port WebGPU, zadanie 19): światła wybuchów, dysz i łuków idą do
  // siatki świateł efektów Core3D (grid.addWorld), nie do świateł sceny three.
  for (const f of ['effects', 'rocketFx', 'smoke', 'fireballs', 'missileBodies', 'nebula', 'arcs', 'glow', 'plumes', 'sparks']) {
    assert.doesNotMatch(readSrc(`src/3d/rockets/${f}.js`), /PointLight|SpotLight/, f);
  }
  assert.match(readSrc('src/3d/rockets/effects.js'), /grid\.addWorld\(/);
});

test('martwe: bez regl z unpkg, soczewka warpu bez własnego kontekstu WebGL (API Core3D)', () => {
  assert.doesNotMatch(indexHtml, /unpkg\.com\/regl/);
  // Soczewka zgłasza się do Core3D (warpLensPass.js) — żadnego trzeciego
  // kontekstu ani uploadu całej kanwy 2D jako tekstury co klatkę.
  const lens = readSrc('src/vfx/warpLensPass.js');
  assert.doesNotMatch(lens, /WarpBlackHole|getContext\(|texImage2D/);
  assert.match(lens, /Core3D\.setWarpLensWorld\(/);
  // Port WebGPU: warp poza portem — pass soczewki i jej cele usunięte z Core3D,
  // API zostaje jako no-op (nowy warp wejdzie w TSL w miejscu opisanym w render()).
  assert.doesNotMatch(core3d, /import[^;]*warpLens3D/);
  assert.doesNotMatch(core3d, /warpLensTarget|warpStarTarget|_prepareWarpLens|createWarpLensShader/);
  assert.match(core3d, /setWarpLensWorld\(worldX, worldY, angle, radiusAlong, radiusAcross, swallow\) \{ \},/);
});

test('pule rakiet (Core3D) i odłamków paneli: puste siatki są niewidoczne', () => {
  // Port WebGPU, zadanie 19: rakiety rysują pule w scenie Core3D (src/3d/rockets/); pusta pula
  // nie wchodzi do passa (zachowanie: tests/rocketFx.test.mjs).
  for (const f of ['fireballs', 'glow', 'missileBodies', 'plumes', 'sparks']) {
    assert.match(readSrc(`src/3d/rockets/${f}.js`), /this\.mesh\.visible = n > 0;/, f);
  }
  assert.match(readSrc('src/3d/rockets/arcs.js'), /this\.mesh\.visible = this\.highWater > 0;/);
  assert.match(readSrc('src/3d/rockets/nebula.js'), /this\.mesh\.visible = this\.highWater > 1;/);
  const smoke = readSrc('src/3d/rockets/smoke.js');
  assert.match(smoke, /this\.mesh\.visible = n > 1;/);
  assert.match(smoke, /this\.densityMesh\.visible = n > 1;/);
  assert.doesNotMatch(readSrc('src/effects3d/rocketSystem3D.js'), /this\.mesh\b/, 'lot rakiet bez własnej siatki');
  const shards = readSrc('src/vfx/panelShardManager.js');
  assert.match(shards, /if \(this\.activeCount === 0\) return;/);
  assert.match(shards, /this\.mesh\.count = 0;\s*this\.mesh\.visible = false;/);
});

// Zadanie 17: pociski rysuje ProjectileSystem (src/3d/weapons/projectiles.js — style w jednym draw
// callu, dawniej weapon3DSystem.js): barwa HDR z konfiguracji rodziny (raz na rodzinę i rozmiar
// w WeaponFx), wysyłka tylko zajętej części bufora przez stałe zakresy (liveRange.js — bez obiektu
// zakresu na klatkę).
test('pociski 3D: barwy HDR raz na rodzinę, upload tylko zajętego wycinka', () => {
  const proj = readSrc('src/3d/weapons/projectiles.js');
  assert.match(proj, /if \(n > 0\) markRange\(this\.node\.value, 0, Math\.max\(2, n\) \* FLOATS\);/);
  assert.doesNotMatch(proj, /addUpdateRange\(|needsUpdate = true/);
  const wfx = readSrc('src/3d/weapons/weaponFx.js');
  assert.match(wfx, /function projectileConf\(family, size\) \{[\s\S]*?_confCache\.get\(key\)/);
  assert.match(readSrc('src/3d/weapons/liveRange.js'), /attr\.clearUpdateRanges = keepUpdateRanges;/);
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
