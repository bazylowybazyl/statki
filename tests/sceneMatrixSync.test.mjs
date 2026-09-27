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

// Port WebGPU (zadanie 01): _renderDirect (render bez composera) i split w jednym
// renderze zniknęły — ścieżki renderu sceny to render() (passy gry, także każda
// połówka podzielonego ekranu przez renderSingle) i renderBackdrop() (tło menu).
test('render() i renderBackdrop() robią jeden ręczny sync macierzy przed pierwszym przejściem sceny', () => {
  assert.match(
    core3d,
    /_syncSceneMatrices\(\)\s*\{\s*if \(this\.scene\) this\.scene\.updateMatrixWorld\(\);/,
    'helper musi przechodzić graf sceny'
  );
  assert.ok(!core3d.includes('_renderDirect('), 'martwa ścieżka bez composera wróciła');

  const body = (header) => {
    const start = core3d.indexOf(header);
    assert.ok(start > 0, `brak ${header}`);
    return core3d.slice(start, core3d.indexOf('\n  },', start));
  };
  const renderBody = body('\n  render() {');
  const syncIdx = renderBody.indexOf('this._syncSceneMatrices()');
  assert.ok(syncIdx > 0, 'render() musi zsynchronizować macierze');
  assert.equal(renderBody.split('this._syncSceneMatrices()').length - 1, 1, 'jeden sync na render()');
  // Sync MUSI stać przed pierwszym przejściem sceny w klatce (maska cieni,
  // pre-pass halo, refrakcja, passy sceny), inaczej czyta macierze z poprzedniej klatki.
  for (const pass of ['this._renderSunShadowMask(', 'this._renderPlanetHaloPrepass()', 'this._updateShockwaves(', 'this._runScenePass(pass)']) {
    const at = renderBody.indexOf(pass);
    assert.ok(at > 0, `render() woła ${pass}`);
    assert.ok(syncIdx < at, `sync przed ${pass}`);
  }

  const backdropBody = body('\n  renderBackdrop(camera) {');
  const bSync = backdropBody.indexOf('this._syncSceneMatrices()');
  const bRender = backdropBody.indexOf('renderer.render(this.scene, camera)');
  assert.ok(bSync > 0 && bRender > bSync, 'renderBackdrop: sync przed renderem sceny');
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
