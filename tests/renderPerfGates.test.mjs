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

test('Core3D: shadow mapa odświeżana ręcznie tylko przed passami ortho i FG', () => {
  assert.match(core3d, /shadowMap\.autoUpdate = false;/);
  assert.match(core3d, /if \(pass === this\.renderPassOrtho \|\| pass === this\.renderPassFg\) shadowMap\.needsUpdate = true;/);
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

test('hexShips3D: tablice lamp i stref dysz bez uploadu, gdy są puste', () => {
  assert.match(hexShips, /uShipLightData: \{ value: createLightUniformArray\(\), needsUpdate: false \}/);
  assert.match(hexShips, /uEngineZones: \{ value: createEngineZoneArray\(\), needsUpdate: false \}/);
  assert.match(hexShips, /uniforms\.uEngineZones\.needsUpdate = zones\.length > 0;/);
  assert.match(hexShips, /setShipLightArraysUpload\(uniforms, payload\.count > 0\);/);
});

test('shield3D: próg kopuły = próg cząstek ShieldImpactFX (9 px)', async () => {
  assert.match(shield3d, /const SHIELD_DOME_MIN_PX = 9;/);
  const src = readFileSync(new URL('../src/3d/shieldImpactFx.js', import.meta.url), 'utf8');
  assert.match(src, /if \(px < 9\) return 0;/);
});
