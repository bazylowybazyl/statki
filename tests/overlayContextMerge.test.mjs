import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Strażnik JEDNEGO renderera (port WebGPU, zadanie 20). Historia: każde initOverlay tworzyło
// własny THREE.WebGLRenderer, więc przy strzelaniu przeglądarka przełączała się między
// trzema kontekstami na klatkę (Core3D + efekty + rakiety) — pomiar usera: „Overlay FX 3D”
// 0,22 ms na postoju → 3,45 ms przy ogniu. Potem rakiety weszły do kontekstu efektów (warstwa
// raw), w zadaniach 17–19 efekty broni, iskry, rakiety i Supernowa przeszły do sceny Core3D,
// a w zadaniu 20 ostatni efekt overlaya (wybuch reaktora) i sam overlay (drugi renderer,
// EffectComposer, bloom overlaya, kanwa `overlay3d`) zniknęły: jeden renderer, jedna kanwa 3D,
// jeden bloom.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1 ');
const indexHtml = read('index.html');

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) jsFiles(path, out);
    else if (/\.m?js$/.test(name)) out.push(path);
  }
  return out;
}

test('w grze jeden renderer: WebGPURenderer tylko w core3d.js, żadnego WebGLRenderer', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const webgl = [];
  const webgpu = [];
  for (const path of jsFiles(root)) {
    const src = code(readFileSync(path, 'utf8'));
    const rel = path.slice(root.length + 1).replace(/\\/g, '/');
    if (/new\s+(THREE\.)?WebGLRenderer\s*\(/.test(src)) webgl.push(rel);
    if (/new\s+(THREE\.)?WebGPURenderer\s*\(/.test(src)) webgpu.push(rel);
  }
  assert.deepEqual(webgl, [], 'WebGLRenderer w src/ (drugi kontekst obok Core3D)');
  assert.deepEqual(webgpu, ['3d/core3d.js'], 'WebGPURenderer tylko w Core3D');
  const page = code(indexHtml);
  assert.doesNotMatch(page, /new\s+(THREE\.)?(WebGLRenderer|WebGPURenderer)\s*\(/, 'index.html tworzy renderer poza Core3D');
  // Kanwy gry: warstwa 3D (#webgl-layer, Core3D) i 2D (#c) — kanwa overlaya efektów nie wraca.
  const gameRoot = indexHtml.match(/<div id="game-root"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  assert.deepEqual((gameRoot.match(/<canvas id="[^"]+"/g) || []).map((c) => c.slice(12, -1)), ['webgl-layer', 'c']);
  assert.doesNotMatch(read('assets/css/main.css'), /overlay3d/, 'CSS kanwy overlaya');
});

test('overlay efektów usunięty: moduł, wpięcie w index.html, bloom overlaya', () => {
  assert.equal(existsSync(new URL('../src/effects3d/overlay.js', import.meta.url)), false, 'src/effects3d/overlay.js');
  const page = code(indexHtml);
  assert.doesNotMatch(page, /initOverlay|startOverlay3D|overlay3D|resizeOverlay3D|rocketOverlay3D|splitOverlayContexts|overlayView|withRawLayer/);
  assert.doesNotMatch(page, /EffectComposer|UnrealBloomPass/);
  // Parametry bloomu overlaya (dawny drugi bloom) — bez odbiorcy, usunięte z bloomConfig i tunera.
  assert.doesNotMatch(code(read('src/3d/bloomConfig.js')), /overlay/i);
  const tuner = code(read('src/ui/bloomTunerPanel.js'));
  assert.doesNotMatch(tuner, /overlay3D|'Overlay FX'|key: 'overlay/);
  // Kubełek PerfHUD „Overlay FX 3D” — został sam lot rakiet (wybuchy liczy render Core3D).
  const hud = read('src/ui/perfHud.js');
  assert.doesNotMatch(hud, /overlayFxTime|Overlay FX 3D/);
  assert.match(page, /PerfHUD\.addTiming\('rocketsTime', rocketsMs\);/);
});

// Port WebGPU, zadanie 19: rakiety (lot: rocketSystem3D, wygląd: src/3d/rockets/) i iskry
// (SparkSystem3D) w scenie Core3D; wybuchy (2026-10-07: src/3d/explosions/ — gaz 3D, pule gry; zastąpiły
// reactorblow.js, „tragiczne, do usunięcia”) też jako krok klatki efektów.
test('rakiety, iskry i wybuchy WebGPU w scenie Core3D (kroki klatki efektów)', () => {
  assert.match(indexHtml, /SparkSystem3D\.init\(Core3D\.scene\);\s*const rocketFx = createRocketFx\(Core3D\);\s*initRocketSystem3D\(Core3D\.scene, \{ effects: rocketFx \}\);/);
  assert.doesNotMatch(indexHtml, /createReactorBlowFactory|effects3d\/reactorblow/);
  assert.equal(existsSync(new URL('../src/effects3d/reactorblow.js', import.meta.url)), false, 'stary wybuch usunięty');
  assert.match(indexHtml, /window\.makeReactorBlow = createExplosionFactory\(Core3D, \{ rocketFx, weaponFx: WeaponFx \}\);/);
  assert.match(indexHtml, /Destruction3D\.init\(\{\s*scene:\s*Core3D\.scene,\s*reactorFactory:\s*window\.makeReactorBlow,/);
  const trigger = indexHtml.match(/function triggerReactorBlow3D\([^)]*\) \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(trigger, /window\.makeReactorBlow\?\.\(\{ x, y, size, \.\.\.options \}\);/);
  const blow = code(read('src/3d/explosions/explosionFx.js'));
  assert.match(blow, /core\.addFxStep\(this\.step\)/);
  assert.doesNotMatch(blow, /overlay3D|WebGLRenderer|WebGPURenderer|new THREE\.RenderPipeline/);
  // Rozpad stacji uruchamia wybuchy fabryką (bez oddawania efektu tickowi overlaya).
  assert.doesNotMatch(code(read('src/vfx/destruction3D.js')), /overlay3D/);
  // Demo rdzenia (warsztat reaktorów) na tej samej ścieżce.
  const demo = code(read('dema/rdzen-demo.js'));
  assert.doesNotMatch(demo, /initOverlay|overlay3D/);
  assert.match(demo, /createExplosionFactory\(Core3D\)/);
});
