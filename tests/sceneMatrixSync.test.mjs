import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core3d = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
const shockwave = readFileSync(new URL('../src/effects3d/shockwave3D.js', import.meta.url), 'utf8');

// Jedna scena obsługuje 6 RenderPassów + pre-pass halo + snapshot refrakcji, czyli
// do 11 wywołań `renderer.render(scene, …)` na klatkę. Każde z nich woła
// `scene.updateMatrixWorld()`, a ten ZAWSZE schodzi do wszystkich dzieci (także
// niewidocznych) i dla każdego węzła z matrixAutoUpdate=true robi compose +
// multiplyMatrices — nic się nie cache'uje między przejściami. Przy ~1000 węzłach
// (2 na ciało heksowe, pule asteroid, miasto ringu) to był cały rząd wielkości
// pracy na darmo. Macierze liczymy więc RAZ na klatkę, ręcznie.

test('scena ma wyłączony automatyczny update macierzy', () => {
  assert.match(
    core3d,
    /this\.scene\.matrixWorldAutoUpdate = false/,
    'bez tego renderer aktualizuje graf raz na KAŻDY pass'
  );
});

test('render() i _renderDirect() robią jeden ręczny sync macierzy', () => {
  assert.match(
    core3d,
    /_syncSceneMatrices\(\)\s*\{\s*if \(this\.scene\) this\.scene\.updateMatrixWorld\(\);/,
    'helper musi przechodzić graf sceny'
  );

  const renderStart = core3d.indexOf('\n  render() {');
  const renderDirectStart = core3d.indexOf('\n  _renderDirect(');
  assert.ok(renderStart > 0 && renderDirectStart > renderStart, 'obie ścieżki renderu muszą istnieć');

  const renderBody = core3d.slice(renderStart, renderDirectStart);
  const syncIdx = renderBody.indexOf('this._syncSceneMatrices()');
  assert.ok(syncIdx > 0, 'render() musi zsynchronizować macierze');

  // Sync MUSI stać przed pierwszym renderem sceny w klatce (pre-pass halo),
  // inaczej pierwsze przejście czyta macierze z poprzedniej klatki.
  const firstSceneRender = renderBody.indexOf('this.renderer.render(this.scene');
  assert.ok(firstSceneRender > 0, 'render() renderuje scenę');
  assert.ok(syncIdx < firstSceneRender, 'sync musi poprzedzać pierwsze przejście sceny');

  const directBody = core3d.slice(renderDirectStart, renderDirectStart + 4000);
  assert.match(directBody, /this\._syncSceneMatrices\(\)/, '_renderDirect też potrzebuje synca');
});

test('węzły ruszane W TRAKCIE render() odświeżają macierz same', () => {
  // syncCamera leci wewnątrz każdego passa, czyli już po globalnym syncu.
  assert.match(
    core3d,
    /this\.shadowCatcher\.position\.set\(camX, camY, -2\);\s*\n\s*this\.shadowCatcher\.updateMatrixWorld\(\);/,
    'shadowCatcher przesuwa się per pass'
  );
  assert.match(
    core3d,
    /this\.shadowCatcherFg\.position\.set\(camX, camY, -100\);\s*\n\s*this\.shadowCatcherFg\.updateMatrixWorld\(\);/,
    'shadowCatcherFg przesuwa się per pass'
  );

  // Shockwave3DManager.update() skaluje fale w środku Core3D.render().
  const updateBody = shockwave.slice(shockwave.indexOf('update(dt) {'), shockwave.indexOf('hasActive()'));
  assert.match(
    updateBody,
    /wave\.mesh\.updateMatrixWorld\(\)/,
    'fala skalowana po globalnym syncu musi odświeżyć swój węzeł'
  );
});
