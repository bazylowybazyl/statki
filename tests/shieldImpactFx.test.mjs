import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { ShieldImpactFX, SHIELD_IMPACT_PRESETS } from '../src/3d/shieldImpactFx.js';

const SHIELD_LAYER = 7;
const COLOR = new THREE.Color('#5992f7');

let scene = null;
let fxRoot = null;
let fxMesh = null;
let flashMesh = null;

function boot() {
  if (!scene) {
    scene = new THREE.Scene();
    ShieldImpactFX.init(scene);
    // Grupa niesie wspólny układ lokalny; w środku wstęgi + bańki.
    fxRoot = scene.children[0];
    fxMesh = fxRoot.children.find((c) => c.material?.uniforms?.uTrailScale);
    flashMesh = fxRoot.children.find((c) => !c.material?.uniforms?.uTrailScale);
  }
  return fxMesh;
}

// Reset puli między testami: po wygaśnięciu wszystkiego update() zeruje
// high-water i indeks, więc kolejny test startuje od czystego bufora.
function drainPool(mesh, atTime) {
  ShieldImpactFX.update(atTime + 60, 1);
  assert.equal(mesh.geometry.instanceCount, 0);
  assert.equal(flashMesh.geometry.instanceCount, 0);
}

function emitAt(opts) {
  return ShieldImpactFX.emit({
    x: 0, y: 0, nx: 1, ny: 0, radius: 400,
    color: COLOR, power: 1, vx: 0, vy: 0, lod: 1, time: 0,
    ...opts
  });
}

test('efekt to dwie siatki na warstwie tarcz: wstęgi i bańki', () => {
  const mesh = boot();
  assert.equal(fxRoot.children.length, 2);
  for (const m of [mesh, flashMesh]) {
    assert.equal(m.layers.mask, 1 << SHIELD_LAYER);
    assert.equal(m.frustumCulled, false);
  }
  // 16 quadów = 96 indeksów, 17 przekrojów × 2 boki = 34 wierzchołki.
  assert.equal(mesh.geometry.index.count, 96);
  assert.equal(mesh.geometry.attributes.position.count, 34);
  // Bańka to jeden quad; rysuje się POD wstęgami.
  assert.equal(flashMesh.geometry.attributes.position.count, 6);
  assert.ok(flashMesh.renderOrder < mesh.renderOrder);
});

test('cztery klasy trafień rosną zgodnie: BD < główna < special', () => {
  const p = SHIELD_IMPACT_PRESETS;
  const midCount = (k) => (p[k].count[0] + p[k].count[1]) / 2;
  const midLife = (k) => (p[k].life[0] + p[k].life[1]) / 2;
  const midLength = (k) => midLife(k) * p[k].trailFactor;

  assert.ok(midCount('pd') < midCount('main'), 'BD ma mniej cząstek niż główna');
  assert.ok(midCount('main') < midCount('special'), 'główna ma mniej niż special');
  assert.ok(midLife('pd') < midLife('main'), 'BD żyje krócej niż główna');
  assert.ok(midLife('main') < midLife('special'), 'główna żyje krócej niż special');
  assert.ok(midLength('pd') < midLength('main'), 'BD ma krótsze wstęgi');
  assert.ok(midLength('main') < midLength('special'), 'special ma najdłuższe wstęgi');

  // BD to wyłącznie iskry i wyładowania — żadnych grubych macek.
  assert.equal(p.pd.mix[0], 0);
  // Tylko zderzenie tarcza-tarcza wyrzuca na boki.
  assert.equal(p.shield.tangential, true);
  assert.equal(p.main.tangential, false);
});

test('LOD wycina efekt, gdy tarcza ma na ekranie kilka pikseli', () => {
  boot();
  // Myśliwiec (R=25) przy dalekim zoomie: 0.9 px — nic nie emitujemy.
  assert.equal(ShieldImpactFX.lodScaleFor(25, 0.035), 0);
  // Ten sam myśliwiec z bliska jest widoczny, ale dostaje ułamek cząstek.
  const fighterNear = ShieldImpactFX.lodScaleFor(25, 1);
  assert.ok(fighterNear > 0 && fighterNear < 0.35, `fighter lod = ${fighterNear}`);
  // Capital z bliska: pełna obsada.
  assert.equal(ShieldImpactFX.lodScaleFor(400, 1), 1);
  // Ten sam capital z daleka schodzi do minimum.
  assert.ok(ShieldImpactFX.lodScaleFor(400, 0.06) < 0.3);
  // LOD rośnie monotonicznie z rozmiarem na ekranie.
  const ladder = [20, 40, 80, 160, 320].map((r) => ShieldImpactFX.lodScaleFor(r, 1));
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] >= ladder[i - 1]);
});

test('lod = 0 nie tworzy ani jednej cząstki', () => {
  boot();
  assert.equal(emitAt({ preset: 'special', lod: 0 }), 0);
});

test('pula wraca do zera, gdy wszystko wygaśnie', () => {
  const mesh = boot();
  const t = 1000;
  const n = emitAt({ preset: 'main', time: t });
  assert.ok(n > 0);

  ShieldImpactFX.update(t, 1);
  assert.equal(mesh.visible, true);
  assert.equal(mesh.geometry.instanceCount, n);

  drainPool(mesh, t);
  assert.equal(mesh.visible, false);
  assert.equal(ShieldImpactFX.stats.live, 0);
});

test('współrzędne cząstek są lokalne — świat 12 mln jednostek nie wchodzi do float32', () => {
  const mesh = boot();
  const t = 2000;
  const worldX = 8_400_000;
  const worldY = 3_100_000;
  emitAt({ preset: 'main', x: worldX, y: worldY, radius: 300, time: t });
  ShieldImpactFX.update(t, 1);

  // Wielka translacja siedzi w transformacie grupy (liczonym na CPU w float64).
  assert.equal(fxRoot.position.x, worldX);
  assert.equal(fxRoot.position.y, -worldY);

  // Atrybuty trzymają wyłącznie offset względem ogniska — rzędu jednostek.
  const origin = mesh.geometry.attributes.iOrigin.array;
  const live = mesh.geometry.instanceCount;
  for (let i = 0; i < live; i++) {
    assert.ok(Math.abs(origin[i * 3]) < 10, `origin.x = ${origin[i * 3]}`);
    assert.ok(Math.abs(origin[i * 3 + 1]) < 10, `origin.y = ${origin[i * 3 + 1]}`);
  }

  drainPool(mesh, t);
});

test('zderzenie tarcza-tarcza wyrzuca stycznie, trafienie broni wzdłuż normalnej', () => {
  const mesh = boot();
  const vel = mesh.geometry.attributes.iVel.array;
  // Normalna wzdłuż +X, więc styczna to oś Y (w scenie 3D y = -yGry).
  const axisSplit = (preset, t) => {
    emitAt({ preset, nx: 1, ny: 0, radius: 400, time: t });
    ShieldImpactFX.update(t, 1);
    let alongNormal = 0;
    let alongTangent = 0;
    const live = mesh.geometry.instanceCount;
    for (let i = 0; i < live; i++) {
      alongNormal += Math.abs(vel[i * 3]);
      alongTangent += Math.abs(vel[i * 3 + 1]);
    }
    const total = alongNormal + alongTangent;
    const share = alongTangent / total;
    drainPool(mesh, t);
    return share;
  };

  const shieldShare = axisSplit('shield', 3000);
  const mainShare = axisSplit('main', 4000);
  assert.ok(shieldShare > 0.6, `tarcza-tarcza leci w bok, udział stycznej = ${shieldShare}`);
  assert.ok(mainShare < shieldShare, `broń główna leci bardziej na wprost (${mainShare})`);
});

test('cząstki dziedziczą barwę tarczy, nie własną paletę', () => {
  const mesh = boot();
  const t = 5000;
  const red = new THREE.Color(1, 0.08, 0.04);   // tarcza na resztkach HP
  emitAt({ preset: 'main', color: red, time: t });
  ShieldImpactFX.update(t, 1);

  const cols = mesh.geometry.attributes.iColor.array;
  const live = mesh.geometry.instanceCount;
  assert.ok(live > 0);
  for (let i = 0; i < live; i++) {
    assert.ok(Math.abs(cols[i * 3] - red.r) < 1e-6);
    assert.ok(Math.abs(cols[i * 3 + 1] - red.g) < 1e-6);
    assert.ok(Math.abs(cols[i * 3 + 2] - red.b) < 1e-6);
  }

  drainPool(mesh, t);
});

test('zoom skraca teselację wstęgi, nie jej długość', () => {
  const mesh = boot();
  const near = 1.0;
  const far = 0.1;

  ShieldImpactFX.update(6000, near);
  const nearCount = mesh.geometry.drawRange.count;
  const nearScale = mesh.material.uniforms.uTrailScale.value;

  ShieldImpactFX.update(6000, far);
  const farCount = mesh.geometry.drawRange.count;
  const farScale = mesh.material.uniforms.uTrailScale.value;

  assert.ok(farCount < nearCount, 'daleki zoom rysuje mniej segmentów');
  // Iloczyn (rysowane segmenty) × (skala kroku) jest niezmiennikiem: ogon ma
  // tę samą długość, zmienia się wyłącznie liczba przekrojów.
  assert.ok(Math.abs((nearCount * nearScale) - (farCount * farScale)) < 1e-6);
  // Cieńsze wstęgi z daleka dostają podłogę grubości ~2 px.
  assert.ok(mesh.material.uniforms.uMinHalfWidth.value > 0.9 / near);
});

test('pojedyncza salwa nie wysyca całej puli', () => {
  const mesh = boot();
  const t = 7000;
  // Special na wielkim capitalu to najgrubszy preset, jaki gra potrafi odpalić.
  for (let i = 0; i < 6; i++) emitAt({ preset: 'special', power: 2.2, radius: 900, time: t });
  ShieldImpactFX.update(t, 1);
  assert.ok(ShieldImpactFX.stats.live > 0);
  assert.ok(mesh.geometry.instanceCount <= 3000);
  drainPool(mesh, t);
});

test('każde trafienie daje dokładnie jedną bańkę, rosnącą z klasą', () => {
  const mesh = boot();
  const params = flashMesh.geometry.attributes.fParams.array;
  const radiusFor = (preset, t) => {
    emitAt({ preset, radius: 400, time: t });
    ShieldImpactFX.update(t, 1);
    assert.equal(flashMesh.geometry.instanceCount, 1, 'jedna bańka na trafienie');
    const r = params[2];
    drainPool(mesh, t);
    return r;
  };

  const pd = radiusFor('pd', 8000);
  const main = radiusFor('main', 9000);
  const special = radiusFor('special', 10000);
  assert.ok(pd < main, `pd ${pd} < main ${main}`);
  assert.ok(main < special, `main ${main} < special ${special}`);
});

test('bańka bierze barwę tarczy i da się ją wyłączyć', () => {
  const mesh = boot();
  const t = 11000;
  const green = new THREE.Color(0.1, 0.9, 0.4);
  emitAt({ preset: 'main', color: green, time: t });
  ShieldImpactFX.update(t, 1);
  const cols = flashMesh.geometry.attributes.fColor.array;
  assert.ok(Math.abs(cols[0] - green.r) < 1e-6);
  assert.ok(Math.abs(cols[1] - green.g) < 1e-6);
  assert.ok(Math.abs(cols[2] - green.b) < 1e-6);
  drainPool(mesh, t);

  ShieldImpactFX.flash = false;
  const t2 = 12000;
  emitAt({ preset: 'main', time: t2 });
  ShieldImpactFX.update(t2, 1);
  assert.equal(flashMesh.geometry.instanceCount, 0, 'wyłączona bańka nie tworzy instancji');
  assert.ok(mesh.geometry.instanceCount > 0, 'wstęgi lecą dalej');
  ShieldImpactFX.flash = true;
  drainPool(mesh, t2);
});
