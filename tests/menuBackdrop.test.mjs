// Tło menu głównego — Ziemia z ringiem „Halo” (2026-09-26): wypożyczenie ringu
// gry na czas menu, rozgrzewka shadera map zgodna z materiałami bake'u,
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

test('rozgrzewka shadera map = te same programy co bake (klucz cache three)', () => {
  const warm = createHaloBakeWarmup();
  const meshes = warm.scene.children.filter((o) => o.isMesh);
  assert.equal(meshes.length, 3);
  assert.equal(warm.scene.children.filter((o) => o.isLight).length, 0, 'bez świateł, jak scena bake’u (liczba świateł jest w kluczu)');
  const owner = { uniforms: {} };
  ['A', 'B', 'C'].forEach((output, i) => {
    const bake = HaloWorldMaps.prototype._makeMaterial.call(owner, output);
    const w = meshes[i].material;
    assert.equal(w.vertexShader, bake.vertexShader, `${output}: vertex`);
    assert.equal(w.fragmentShader, bake.fragmentShader, `${output}: fragment`);
    for (const key of ['type', 'defines', 'side', 'transparent', 'blending', 'depthTest', 'depthWrite', 'lights', 'fog', 'glslVersion', 'extensions', 'vertexColors']) {
      assert.deepEqual(w[key], bake[key], `${output}: ${key}`);
    }
    bake.dispose();
  });
  warm.dispose();
});

test('tło menu: własna warstwa i render przez composer Core3D, bez własnego renderera', () => {
  const core = read('src/3d/core3d.js');
  assert.equal(MENU_BACKDROP_LAYER, 9);
  for (const m of core.matchAll(/const\s+\w+_RENDER_LAYER\s*=\s*(\d+)/g)) {
    assert.notEqual(Number(m[1]), MENU_BACKDROP_LAYER, 'warstwa zajęta przez pass gry');
  }
  const body = core.slice(core.indexOf('renderBackdrop(camera) {'));
  assert.match(body, /camera\.layers\.set\(MENU_BACKDROP_LAYER\)[\s\S]*?for \(const pass of this\._postPasses\)/, 'scena → resolve → bloom → ACES jak w grze');
  const src = read('src/3d/menuBackdrop3D.js');
  assert.doesNotMatch(src, /new\s+THREE\.WebGLRenderer|EffectComposer|UnrealBloomPass/);
  assert.match(src, /Core3D\.renderBackdrop\(cam\)/);
  assert.match(src, /compileAsync\(warm\.scene/, 'shader map w tle przed budową ringu');
  assert.match(src, /compileAsync\(ring\.group,/, 'programy ringu, Ziemi i nieba w tle przed pierwszą klatką');
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
