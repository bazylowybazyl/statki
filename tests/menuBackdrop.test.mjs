// Tło menu głównego — Ziemia z ringiem „Halo” (2026-09-26): wypożyczenie ringu
// gry na czas menu, rozgrzewka map (na WebGPU w HaloWorldMaps.init),
// własna warstwa i render przez composer Core3D, wpięcie w index.html,
// oraz halo (poświata limbu) Ziemi i Marsa w grze z tego samego modelu
// atmosfery co w menu. Bez GPU.
// node --test tests/menuBackdrop.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HaloRingGame, HALO_GAME } from '../src/3d/haloRing/haloRingGame.js';
import { HaloWorldMaps, createHaloBakeWarmup } from '../src/3d/haloRing/haloRingWorldGen.js';
import { MENU_BACKDROP_LAYER } from '../src/3d/core3d.js';
import { MENU_SHOT } from '../src/3d/menuBackdrop3D.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const EARTH = { id: 'earth', x: 1060000, y: -250000, r: 2800 };
const fakeScene = () => ({ add() {}, remove() {} });

function fakeRing() {
  const calls = { layers: [], cuts: [] };
  return {
    calls,
    group: { visible: true },
    setLayers(map) { calls.layers.push({ ...map }); },
    setCutaway(index, cut) { calls.cuts.push([index, cut]); }
  };
}

test('showcase: menu dostaje ring gry, release oddaje go z warstwami gry, bez wycięć i schowany', () => {
  const game = new HaloRingGame({ planets: [EARTH], renderer: {}, scene: fakeScene() });
  const entry = game.entries[0];
  const ring = fakeRing();
  entry.ring = ring; // budowa ringu wymaga GPU — tu gotowy
  entry.sunAz = 1.23;
  assert.equal(game.showcaseRing('earth'), ring, 'ten sam ring co w grze (bez drugiego bake’u)');
  assert.equal(game.showcaseRing('venus'), null);
  game.releaseShowcase('earth');
  assert.deepEqual(ring.calls.layers.at(-1), { ...HALO_GAME.layers }, 'warstwy passów gry');
  assert.deepEqual(ring.calls.cuts, [[0, null], [1, null]]);
  assert.equal(ring.group.visible, false, 'widoczność ustawi pierwszy update() gry');
  assert.ok(Number.isNaN(entry.sunAz), 'słońce gry nałoży się przy pierwszym update()');
  // menu przerwane przed budową ringu: release bez wyjątku
  const early = new HaloRingGame({ planets: [EARTH], renderer: {}, scene: fakeScene() });
  assert.doesNotThrow(() => early.releaseShowcase('earth'));
});

test('rozgrzewka map na WebGPU: tło menu dostaje pustą scenę, pipeline’y bake’u kompiluje HaloWorldMaps.init na prawdziwych celach', async () => {
  // Port WebGPU (zadanie 06): klucz pipeline'u zależy od formatu celu (rgba16float /
  // rgba8unorm / rgba32float), więc kompilacja na kanwie nic nie daje. createHaloBakeWarmup
  // zostaje dla API tła menu (zadanie 11 je usunie) i jest pustą sceną — compileAsync od razu.
  const warm = createHaloBakeWarmup();
  assert.equal(warm.scene.children.length, 0);
  assert.doesNotThrow(() => warm.dispose());
  // Budowa ringu (asynchroniczna) kompiluje PRAWDZIWE obiekty bake'u przed pierwszym bake'iem.
  const calls = [];
  let target = null;
  const renderer = {
    autoClear: true,
    async init() {},
    getRenderTarget: () => target,
    setRenderTarget(t) { target = t; },
    async compileAsync(scene) { calls.push(['compile', target?.texture?.type, scene.children[0].material.name]); },
    render(scene) { calls.push(['render', target?.texture?.type, scene.children[0].material.name]); },
    async readRenderTargetPixelsAsync(rt, x, y, w, h) { calls.push(['read']); return new Float32Array((h - 1) * Math.ceil(w * 16 / 256) * 64 + w * 4); }
  };
  const { createHaloRingLayout } = await import('../src/3d/haloRing/haloRingLayout.js');
  const { HALO_QUALITY } = await import('../src/3d/haloRing/haloRingConfig.js');
  const maps = new HaloWorldMaps(renderer, createHaloRingLayout({}), HALO_QUALITY.low);
  await maps.init();
  const firstRender = calls.findIndex((c) => c[0] === 'render');
  const compiles = calls.filter((c) => c[0] === 'compile');
  assert.equal(compiles.length, 4, 'A (mapa i odczyt), B, C');
  assert.ok(calls.findLastIndex((c) => c[0] === 'compile') < firstRender, 'kompilacja przed bake');
  assert.ok(maps.cpu, 'mapa CPU po odczycie');
  maps.dispose();
});

test('tło menu: własna warstwa i render przez composer Core3D, bez własnego renderera', () => {
  const core = read('src/3d/core3d.js');
  assert.equal(MENU_BACKDROP_LAYER, 9);
  for (const m of core.matchAll(/const\s+\w+_RENDER_LAYER\s*=\s*(\d+)/g)) {
    assert.notEqual(Number(m[1]), MENU_BACKDROP_LAYER, 'warstwa zajęta przez pass gry');
  }
  const body = core.slice(core.indexOf('renderBackdrop(camera) {'));
  // Port WebGPU: post to RenderPipeline (_renderPost — ACES gry + sRGB, bloom od
  // zadania 02), ten sam co w grze; bez _postPasses z EffectComposer.
  assert.match(body, /camera\.layers\.set\(MENU_BACKDROP_LAYER\)[\s\S]*?renderer\.setRenderTarget\(null\);\s*this\._renderPost\(\);/, 'scena → post jak w grze');
  assert.doesNotMatch(core, /_postPasses/);
  // Tło czeka na urządzenie WebGPU (bez niego: menu z komunikatem, tło CSS).
  assert.match(body.slice(0, body.indexOf('\n  },')), /if \(!this\.isInitialized \|\| !this\.gpuReady \|\| !camera\) return;/);
  const src = read('src/3d/menuBackdrop3D.js');
  assert.doesNotMatch(src, /new\s+THREE\.WebGLRenderer|EffectComposer|UnrealBloomPass/);
  assert.match(src, /Core3D\.renderBackdrop\(cam\)/);
  assert.match(src, /compileAsync\(warm\.scene/, 'shader map w tle przed budową ringu');
  assert.match(src, /compileAsync\(ring\.group,/, 'programy ringu, Ziemi i nieba w tle przed pierwszą klatką');
  // Urządzenie WebGPU powstaje w tle po Core3D.init() — start tła czeka na nie.
  const startAsync = src.slice(src.indexOf('async _startAsync() {'));
  assert.ok(startAsync.indexOf('await Core3D.ready') >= 0 && startAsync.indexOf('await Core3D.ready') < startAsync.indexOf('compileAsync(warm.scene'),
    'Core3D.ready przed rozgrzewką i pieczeniem map');
  // tekstury Ziemi pożyczone od planety gry — tło zwalnia tylko własne
  assert.match(src, /for \(const tex of this\._ownTextures\) tex\.dispose\(\)/);
  assert.doesNotMatch(src, /this\._textures\.[a-z]+\.dispose\(\)/);
});

test('ujęcie menu: kamera poza ringiem i halami K-7 także po najeździe przy starcie gry', () => {
  const hallReach = 43752 + 9000; // obwiednia ringu Ziemi + hale K-7 (HALO_GAME.hallReach)
  const closest = MENU_SHOT.distance * Math.min(1, MENU_SHOT.launchDistanceMul);
  assert.ok(closest > hallReach * 1.5, `najbliżej ${closest} j.`);
  assert.ok(MENU_SHOT.shiftX > 0 && MENU_SHOT.shiftX < 0.35, 'planeta po prawej, menu po lewej');
  assert.ok(MENU_SHOT.orbitDegPerSec > 0 && MENU_SHOT.orbitDegPerSec < 2, 'powolny obrót talerza');
});

test('index.html: tło po initHaloRings, ring wraca do gry przed jej pierwszą klatką', () => {
  const html = read('index.html');
  assert.match(html, /initHaloRings\(\);\s*applyHaloRingDevSpawn\(\);\s*startMenuBackdrop\(\);/);
  const start = html.slice(html.indexOf('async function startGame()'));
  const stopAt = start.indexOf('stopMenuBackdrop();');
  const loopAt = start.indexOf('requestAnimationFrame(loop);');
  assert.ok(stopAt > 0 && stopAt < loopAt, 'stopMenuBackdrop przed requestAnimationFrame(loop)');
  assert.match(html, /<link rel="stylesheet" href="assets\/css\/main-menu\.css">/);
  // id, których szuka JS menu i skrypty dymne (scripts/dym-gry-belki.mjs)
  for (const id of ['main-menu', 'menu-home-view', 'menu-options-view', 'menu-gamemode-view', 'menu-credits-view',
    'menu-keybinds-view', 'btn-new-game', 'btn-mode-single', 'btn-mode-split', 'btn-continue', 'btn-load-game',
    'btn-options', 'btn-editor', 'btn-keybinds', 'btn-credits', 'btn-options-back', 'btn-gamemode-back',
    'btn-keybinds-back', 'btn-credits-back', 'mm-hint', 'screen-fade']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  for (const key of ['low', 'medium', 'high', 'ultra']) assert.match(html, new RegExp(`data-planet-q="${key}"`));
  for (const key of ['master', 'music', 'sfx']) assert.match(html, new RegExp(`data-audio="${key}"`));
  assert.match(html, /'sc_audio'/, 'zapis głośności w kluczach resetu');
});

test('halo Ziemi i Marsa w grze: poświata limbu z modelu atmosfery menu, gaśnie do zera na brzegu', () => {
  const src = read('src/3d/planet3d.assets.js');
  const frag = src.match(/const\s+RING_ATMOSPHERE_FRAGMENT\s*=\s*`([\s\S]*?)`;/)?.[1] || '';
  assert.ok(frag, 'brak RING_ATMOSPHERE_FRAGMENT');
  assert.match(frag, /if \(rho >= uRa\) discard;/);
  assert.match(frag, /sqrt\(max\(uRa \* uRa - rho \* rho, 0\.0\)\)/, 'cięciwa przez powłokę → 0 na jej brzegu (bez kropkowanej krawędzi)');
  assert.match(frag, /exp\(-h \/ uHs\)/);
  assert.match(frag, /float alpha = max\(glow\.r, max\(glow\.g, glow\.b\)\);/, 'alfa = max(rgb) przy blendzie ONE/ONE');
  assert.doesNotMatch(frag, /hash12|gl_FragCoord/);
  assert.match(src, /if \(this\.isRingAnchored\) \{[^}]*createRingAtmosphere\(name, resolveRingPlanetWorldRadius\(this\.data\)\)/);
  assert.match(src, /RING_ATMOSPHERE_TUNE = Object\.freeze\(\{\s*earth: Object\.freeze\(\{ height: 1250/, 'wysokość powłoki jak w tle menu (R + 1250)');
  assert.match(src, /atmU\.uSunDir\.value\.set\(dx \/ len, dy \/ len, 0\)/, 'słońce w płaszczyźnie gry');
});
