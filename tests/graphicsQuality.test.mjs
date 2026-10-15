// Opcje grafiki (src/game/graphicsQuality.js): presety, normalizacja, zapis z dawnymi kluczami, dopasowanie presetu;
// „Wysoka” = wartości gry sprzed opcji (strażnik — zmiana stałej w module efektu bez tabeli presetów);
// skala renderu w Core3D (kadr kamery z kanwy CSS, px bufora na j. świata = zoom · pxScale).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const G = await import('../src/game/graphicsQuality.js');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test('presety: pełne, z dozwolonymi wartościami, każdy rozpoznany po zastosowaniu', () => {
  for (const id of G.GFX_PRESET_IDS) {
    const p = G.GFX_PRESETS[id];
    for (const k of G.GFX_PRESET_KEYS) {
      assert.ok(k in p, `${id}: brak ${k}`);
      assert.ok(G.GFX_SETTINGS[k].values.includes(p[k]), `${id}.${k} = ${p[k]} spoza listy`);
    }
    assert.ok(!('spaceDust' in p), 'pył kosmiczny to preferencja, nie preset');
    assert.equal(G.matchGfxPreset(G.gfxWithPreset(G.defaultGfx(), id)), id);
    assert.ok(G.GFX_EXPLOSIONS[p.explosions] && G.GFX_EFFECTS[p.effects]);
  }
  // Presety rozróżnialne (żadne dwa nie są tym samym zestawem).
  const sig = G.GFX_PRESET_IDS.map((id) => JSON.stringify(G.GFX_PRESET_KEYS.map((k) => G.GFX_PRESETS[id][k])));
  assert.equal(new Set(sig).size, sig.length);
});

test('domyślne = Wysoka; zmiana pojedynczej opcji → „Własna”; pył kosmiczny presetu nie psuje', () => {
  const d = G.defaultGfx();
  assert.equal(G.matchGfxPreset(d), 'high');
  assert.equal(G.matchGfxPreset({ ...d, bloom: 'half' }), 'custom');
  assert.equal(G.matchGfxPreset({ ...d, spaceDust: 'off' }), 'high');
  const low = G.gfxWithPreset({ ...d, spaceDust: 'off' }, 'low');
  assert.equal(low.spaceDust, 'off', 'preset nie rusza preferencji spoza presetów');
  assert.equal(low.msaa, 0);
  assert.ok(low.renderScale < 1);
  assert.equal(G.gfxWithPreset(d, 'ultra').renderScale, 1.25);
});

test('normalizacja: skala do najbliższej z listy, aliasy, śmieci → domyślne', () => {
  assert.equal(G.normalizeGfxValue('renderScale', 0.7), 0.67);
  assert.equal(G.normalizeGfxValue('renderScale', '0.85'), 0.85);
  assert.equal(G.normalizeGfxValue('renderScale', 9), 1.5);
  assert.equal(G.normalizeGfxValue('renderScale', 'x'), 1);
  assert.equal(G.normalizeGfxValue('msaa', 2), 0);   // WebGPU: 1 albo 4 próbki — 2 najbliżej 0
  assert.equal(G.normalizeGfxValue('msaa', 8), 4);
  assert.equal(G.normalizeGfxValue('shadowShafts', 'med'), 'medium');
  assert.equal(G.normalizeGfxValue('planetQuality', 'ULTRA'), 'ultra');
  assert.equal(G.normalizeGfxValue('bloom', 'nope'), 'full');
  const n = G.normalizeGfx({ bloom: 'half', obce: 1 });
  assert.deepEqual(Object.keys(n).sort(), [...G.GFX_KEYS].sort());
  assert.equal(n.bloom, 'half');
});

test('zapis: sc_gfx wygrywa, bez niego dawne klucze opcji; zapis pisze też dawne klucze', () => {
  const legacy = memStorage({ sc_planet_quality: 'medium', sc_shadow_shafts: 'low', sc_hull_light: 'classic', sc_space_dust: 'off' });
  const a = G.loadGfxSettings(legacy);
  assert.equal(a.planetQuality, 'medium');
  assert.equal(a.shadowShafts, 'low');
  assert.equal(a.hullLight, 'classic');
  assert.equal(a.spaceDust, 'off');
  assert.equal(a.renderScale, 1, 'nowe opcje — domyślne');
  assert.equal(G.matchGfxPreset(a), 'custom');

  const st = memStorage({ sc_planet_quality: 'medium' });
  const saved = G.saveGfxSettings(st, G.gfxWithPreset(G.defaultGfx(), 'ultra'));
  assert.equal(st.map.get('sc_planet_quality'), 'ultra');
  assert.equal(st.map.get('sc_shadow_shafts'), 'high');
  assert.equal(st.map.get('sc_hull_lacquer'), 'on');
  const back = G.loadGfxSettings(st);
  assert.deepEqual(back, saved);
  assert.equal(G.matchGfxPreset(back), 'ultra');

  // Zepsuty JSON — dawne klucze i domyślne, bez wyjątku.
  const bad = memStorage({ sc_gfx: '{zepsute', sc_planet_quality: 'low' });
  assert.equal(G.loadGfxSettings(bad).planetQuality, 'low');
  assert.deepEqual(G.loadGfxSettings(null), G.defaultGfx());
});

test('?grafika= — polskie i angielskie nazwy presetów', () => {
  assert.equal(G.gfxPresetFromQuery('?grafika=niska'), 'low');
  assert.equal(G.gfxPresetFromQuery('?dev=1&grafika=srednia'), 'medium');
  assert.equal(G.gfxPresetFromQuery('?grafika=Wysoka'), 'high');
  assert.equal(G.gfxPresetFromQuery('?grafika=ultra'), 'ultra');
  assert.equal(G.gfxPresetFromQuery('?grafika=mega'), null);
  assert.equal(G.gfxPresetFromQuery(''), null);
});

test('„Wysoka” = wartości gry sprzed opcji (gaz wybuchów, budżety efektów)', async () => {
  await import('three/webgpu');
  const { EXPLOSION_TUNE } = await import('../src/3d/explosions/explosionFx.js');
  for (const [k, v] of Object.entries(G.GFX_EXPLOSIONS.high)) assert.equal(EXPLOSION_TUNE[k], v, `EXPLOSION_TUNE.${k}`);
  for (const level of G.GFX_LEVELS) {
    for (const k of Object.keys(G.GFX_EXPLOSIONS.high)) assert.ok(k in G.GFX_EXPLOSIONS[level], `${level}: ${k}`);
    for (const k of Object.keys(G.GFX_EFFECTS.high)) assert.ok(k in G.GFX_EFFECTS[level], `${level}: ${k}`);
  }
  const fx = G.GFX_EFFECTS.high;
  const num = (text, re) => Number((text.match(re) || [])[1]);
  const weap = src('src/3d/weapons/weaponFx.js');
  assert.equal(num(weap, /export const MUZZLE_PER_FRAME = (\d+)/), fx.weaponMuzzles);
  assert.equal(num(weap, /export const IMPACT_PER_FRAME = (\d+)/), fx.weaponImpacts);
  const side = src('src/3d/sideJets3D.js');
  assert.equal(num(side, /\bmaxLights:\s*([\d.]+)/), fx.sideJetLights);
  assert.equal(num(side, /\bminGasPx:\s*([\d.]+)/), fx.sideJetGasPx);
  const belt = src('src/3d/asteroids/asteroidBelt.js');
  assert.equal(num(belt, /\bmaxLitShips:\s*(\d+)/), fx.beltLitShips);
  assert.equal(num(belt, /\bmaxShadowShips:\s*(\d+)/), fx.beltShadowShips);
  assert.equal(num(src('src/3d/warp/medium.js'), /MEDIUM_COUNT_DEFAULT = (\d+)/), fx.warpParticles);
  // Budżety czytane z pól ustawianych przez opcje, nie ze stałych.
  assert.match(weap, /this\._muzzleBudget = this\.muzzlePerFrame;/);
  assert.match(weap, /this\._impactBudget = this\.impactPerFrame;/);
});

test('Core3D: skala renderu — kadr kamery z kanwy CSS, px bufora na j. świata = zoom · pxScale', () => {
  const core = src('src/3d/core3d.js');
  assert.match(core, /this\.syncCamera\(this\.activeCam1, this\._viewCssW\(\), this\._viewCssH\(\)\);/);
  assert.ok(!/this\.syncCamera\(this\.activeCam1, (this\.composerTarget|target)\.width/.test(core),
    'kadr kamery z rozmiaru bufora rozjechałby obraz 3D z nakładkami 2D przy skali ≠ 1');
  assert.match(core, /const zoom1 = this\.viewZoom\(cam1\);/);
  assert.match(core, /v\.zoom = this\.viewZoom\(cam\);/);
  assert.match(core, /samples: this\.msaaBoot > 0 \? 4 : 0/);
  assert.match(src('src/3d/warp/warpNurt.js'), /const zoom = Core3D\.viewZoom\(cam\);/);
  // MSAA i skala renderu ustawiane przed Core3D.init (pierwszy moduł strony).
  const html = src('index.html');
  const cfg = html.indexOf('Core3D.configureQuality(');
  const init = html.indexOf('initHexShips3D({ canvas');
  assert.ok(cfg > 0 && init > 0 && cfg < init, 'configureQuality przed initHexShips3D (Core3D.init)');
  for (const attr of ['data-gfx-preset="low"', 'data-gfx-preset="ultra"', 'data-gfx-scale="0.67"', 'data-gfx-msaa="0"',
    'data-gfx-bloom="half"', 'data-gfx-explosions="ultra"', 'data-gfx-effects="low"', 'data-gfx-heat="off"', 'data-gfx-hall-dust="off"']) {
    assert.ok(html.includes(attr), `brak chipa ${attr}`);
  }
});

test('Core3D: _pixelRatioFor — skala z opcji, bez niej dawne min(1,5; DPR), limit tekstury', async () => {
  await import('three/webgpu');
  const { Core3D } = await import('../src/3d/core3d.js');
  const keep = { renderScale: Core3D.renderScale, renderer: Core3D.renderer };
  try {
    Core3D.renderScale = 0.67;
    assert.equal(Core3D._pixelRatioFor(1920, 1080), 0.67);
    Core3D.renderScale = 1.5;
    assert.equal(Core3D._pixelRatioFor(1920, 1080), 1.5);
    assert.ok(Core3D._pixelRatioFor(7680, 4320) * 7680 <= 8192 + 1e-6, 'bufor ≤ 8192 px w osi');
    Core3D.renderScale = null;
    const pr = Core3D._pixelRatioFor(1600, 900);
    assert.ok(pr >= 1 && pr <= 1.5);
    assert.equal(Core3D.viewZoom({ zoom: 0.5 }), 0.5 * (Core3D.pxScale || 1));
  } finally {
    Core3D.renderScale = keep.renderScale;
  }
});

test('zniekształcenia: siła w px ekranu × pxScale, położenie w px bufora z zoomu · pxScale', async () => {
  await import('three/webgpu');
  const { DistortionField, DISTORT_HEADER } = await import('../src/3d/fx/distortion.js');
  const F = new DistortionField();
  F.begin();
  F.shock(100, 0, 50, 10, 20);
  F.commit(0, 0, 0.5 * 0.67, 1286, 723, 0, 0.67);
  const A = F.array;
  assert.ok(Math.abs(A[DISTORT_HEADER].x - 100 * 0.5 * 0.67) < 1e-9, 'x w px bufora');
  assert.ok(Math.abs(A[DISTORT_HEADER + 1].x - 20 * 0.67) < 1e-9, 'siła w px bufora');
});
