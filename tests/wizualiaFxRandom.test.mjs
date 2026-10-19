// Zadanie 23 portu WebGPU: wizualia (efekty 3D, cząstki kanwy, animacje budowli, wariacja tonu
// dźwięku) losują z fxRandom (warstwa efektów, src/3d/fx/fxRandom.js), nie z Math.random gry.
// Liczba losowań Math.random nie może zależeć od obrazu — kadru, zoomu, zajętości pul efektów,
// dostępności dźwięku ani strojenia wyglądu: inaczej przebieg bitwy (rozrzut, decyzje AI, krytyki)
// zmienia się z każdą zmianą efektu, a sceny harnessu rozjeżdżają się z bazą (regresja „17 → 23”:
// iskry dysz MAIN zależne od zajętości banku Fx3D). Kto zużywa losowania gry w scenie:
// `node scripts/webgpu/zrzuty.mjs --losowania` (wyniki.json → `losowania` sceny).
// node --test tests/wizualiaFxRandom.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readIndexHtml, sliceFunction } from './helpers/indexSource.mjs';

const code = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

// Moduły czysto wizualne ładowane przez grę.
const WIZUALIA = [
  // przeniesione w zadaniu 23 (znalezione licznikiem losowań harnessu i przeglądem kodu)
  'src/3d/explosions/explosionFx.js',
  'src/3d/mainExhaust3D.js',
  'src/3d/warpPlume3D.js',
  'src/3d/hullDebris3D.js',
  'src/3d/shield3D.js',
  'src/3d/fxParticles3D.js',
  'src/3d/engineExhaustBatch.js',
  'src/3d/bridgeFx3D.js',
  'src/3d/stations3D.js',
  'src/vfx/collisionSparks.js',
  'src/vfx/canvasParticleSystem.js',
  'src/vfx/destruction3D.js',
  'src/vfx/shatterShaderBake.js',
  'src/buildings/shipyardVisuals.js',
  'src/game/superweapon.js',
  // efekty z dem (zadania 12, 17–22) — od początku na fxRandom
  'src/3d/sparkSystem3D.js',
  'src/3d/weapons/recipes.js',
  'src/3d/weapons/weaponFx.js',
  'src/3d/weapons/trails.js',
  'src/3d/rockets/effects.js',
  'src/3d/rockets/rocketFx.js',
  'src/3d/fx/fxLights.js',
  'src/3d/hullDamageMap.js',
  'src/3d/asteroids/storm.js',
  'src/3d/asteroids/miningView.js',
  // wybuchy WebGPU (2026-10-07): gaz na siatce 3D — ziarna domen, reżyser, żar
  'src/3d/gas/gasGrid.js',
  'src/3d/gas/gasExplosions.js',
  'src/3d/gas/gasEmbers.js',
  'src/3d/gas/gasVolume.js',
  'src/3d/explosions/explosionRecipes.js',
  // zadanie 25a: wygląd stacji pirackiej (panele, okna) — własny strumień FxRandom ze stałym ziarnem (bryła powstaje
  // na ekranie ładowania: nie zużywa ani Math.random gry, ani wspólnego fxRandom — tests/rozgrzewkaStacji.test.mjs)
  'src/space/pirateStation/pirateStationFactory.js',
  // scena „Wojna” (2026-10-19): bitwa w głębi — własny mulberry32 z ziarna sceny (ten sam obraz w workerze i w off)
  'src/3d/warBackdrop/warBackdropSim.js',
  'src/3d/warBackdrop/warBackdrop3D.js',
  'src/render/warBackdropPlan.js'
];

test('wizualia gry nie wołają Math.random gry (fxRandom — warstwa efektów)', () => {
  for (const p of WIZUALIA) assert.doesNotMatch(code(p), /Math\.random/, `${p}: Math.random w module wizualnym`);
  // Przeniesione moduły naprawdę losują — z fxRandom (strumień renderu) albo, liczone na wątku głównym, z fxRandomGame
  // (strumień gry, RW-20: collisionSparks, canvasParticleSystem, superweapon).
  for (const p of WIZUALIA.slice(0, 15)) assert.match(code(p), /fxRandom(?:Game)?\.next\(\)/, `${p}: brak fxRandom`);
  for (const p of ['src/vfx/collisionSparks.js', 'src/vfx/canvasParticleSystem.js', 'src/game/superweapon.js']) {
    assert.match(code(p), /fxRandomGame\.next\(\)/, `${p}: wątek główny — strumień gry`);
    assert.doesNotMatch(code(p), /\bfxRandom\.next\(/, `${p}: bez strumienia renderu`);
  }
});

test('hullBodies: wygląd odłamka ginącego węzła z fxRandom (fizyka rozpadu — dalej Math.random gry)', () => {
  const src = code('src/game/hullBodies.js');
  const fn = sliceFunction(src, 'function onNodeDebris(');
  assert.doesNotMatch(fn, /Math\.random/);
  assert.match(fn, /fxRandom\.next\(\)/);
});

// RW-20: wątek główny losuje wizualia ze strumienia GRY (fxRandomGame), nie ze strumienia renderu.
test('index.html: cząstki kanwy (ślad pocisku, iskry wyrzutni rakiet, start myśliwca) i ton dźwięku z fxRandomGame', () => {
  const html = readIndexHtml();
  assert.match(html, /import \{ fxRandomGame \} from "\.\/src\/game\/fxRandomGame\.js";/);
  assert.doesNotMatch(html, /\bfxRandom\.next\(/, 'index.html bez strumienia renderu');
  for (const header of ['function spawnBulletTrail(b, count, frameDt) {', 'function playDynamicSound(soundKey, x, y, pitchVar = 0, volume = 1.0) {']) {
    const fn = sliceFunction(html, header);
    assert.doesNotMatch(fn, /Math\.random/, header);
    assert.match(fn, /fxRandomGame\.next\(\)/, header);
  }
  assert.match(html, /const aa = Math\.atan2\(baseDir\.y, baseDir\.x\) \+ \(fxRandomGame\.next\(\) - 0\.5\) \* 0\.9;/, 'iskry wyrzutni rakiet');
  assert.match(html, /const spread = \(fxRandomGame\.next\(\) - 0\.5\) \* 0\.5;/, 'cząstki startu myśliwca');
});
