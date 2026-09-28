import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const overlayJs = readFileSync(new URL('../src/effects3d/overlay.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Każde wywołanie initOverlay tworzyło własny THREE.WebGLRenderer, więc przy
// strzelaniu przeglądarka przełączała się między trzema kontekstami WebGL na
// klatkę (Core3D + efekty + rakiety). Pomiar usera: „Overlay FX 3D" 0.22 ms na
// postoju → 3.45 ms przy ogniu. Rakiety dzielą teraz kontekst z efektami.

test('overlay exposes a raw layer instead of a second renderer', () => {
  assert.match(overlayJs, /withRawLayer = false/, 'initOverlay musi umieć drugą scenę');
  assert.match(overlayJs, /const rawScene = withRawLayer \? new THREE\.Scene\(\) : null/);

  // Fasada trzyma kształt API dawnego osobnego overlaya.
  assert.match(overlayJs, /const rawLayer = rawScene \? \{/);
  for (const member of ['scene: rawScene', 'tick: \\(\\) => \\{\\}', 'resize: \\(\\) => \\{\\}']) {
    assert.match(overlayJs, new RegExp(member), `fasada musi mieć ${member}`);
  }
  assert.match(overlayJs, /rawScene, rawLayer,/, 'rawLayer musi wychodzić z initOverlay');

  // W całym module wolno stworzyć DOKŁADNIE jeden renderer.
  const rendererCount = (overlayJs.match(/new THREE\.WebGLRenderer/g) || []).length;
  assert.equal(rendererCount, 1, 'overlay.js nie może tworzyć drugiego renderera');
});

test('raw layer renders after the composer, with its own depth clear', () => {
  const tickSlice = overlayJs.slice(overlayJs.indexOf('function tick(dt)'), overlayJs.indexOf('function spawn('));

  const composerIdx = tickSlice.indexOf('composer.render()');
  const rawIdx = tickSlice.indexOf('renderer.render(rawScene, camera)');
  assert.ok(composerIdx > 0 && rawIdx > 0, 'tick musi rysować obie warstwy');
  assert.ok(rawIdx > composerIdx, 'warstwa raw idzie PO kompozytorze (dawny zIndex 21 nad 20)');

  // Kompozytor kończy passem na kanwę — bez wyłączenia autoClear skasowałby efekty.
  assert.match(tickSlice, /renderer\.autoClear = false;[\s\S]*renderer\.render\(rawScene/);
  // Fullscreen quad zostawia zapis w buforze Z — bez clearDepth rakiety znikają.
  assert.match(tickSlice, /renderer\.clearDepth\(\);[\s\S]*renderer\.render\(rawScene/);
  // I autoClear musi wrócić, inaczej następna klatka nie wyczyści kanwy.
  assert.match(tickSlice, /renderer\.render\(rawScene, camera\);[\s\S]*renderer\.autoClear = prevAutoClear/);
});

test('an empty raw scene does not keep the overlay awake', () => {
  const tickSlice = overlayJs.slice(overlayJs.indexOf('function tick(dt)'), overlayJs.indexOf('function spawn('));
  // Wczesne wyjście musi uwzględniać rakiety, inaczej znikają gdy nie ma efektów.
  // Siatki rakiet wiszą w rawScene stale i chowają się, gdy są puste — liczy
  // się widoczność, nie liczba dzieci.
  assert.match(tickSlice, /const hasRawContent = !!\(rawScene && sceneHasVisibleContent\(rawScene\)\)/);
  assert.match(tickSlice, /if \(effects\.length === 0 && !hasPersistentSceneContent && !hasRawContent\)/);
});

// Port WebGPU, zadanie 19: rakiety (lot: rocketSystem3D, wygląd: src/3d/rockets/) i iskry
// (SparkSystem3D) przeszły do sceny Core3D — overlay nie ma już warstwy raw rakiet ani iskier
// (sam overlay i jego renderer odchodzą w zadaniu 20).
test('rakiety i iskry w scenie Core3D, nie w overlayu (warstwa raw bez rakiet)', () => {
  assert.match(indexHtml, /SparkSystem3D\.init\(Core3D\.scene\);\s*initRocketSystem3D\(Core3D\.scene, \{ effects: createRocketFx\(Core3D\) \}\);/);
  assert.doesNotMatch(indexHtml, /SparkSystem3D\.init\(ov\.scene\)/, 'iskry nie w scenie overlaya');
  assert.doesNotMatch(indexHtml, /rocketOverlay3D|withRawLayer|splitOverlayContexts/, 'bez warstwy raw rakiet');
  assert.doesNotMatch(overlayJs, /SparkSystem3D\.update\(/, 'tick overlaya nie prowadzi już zegara iskier');
});
