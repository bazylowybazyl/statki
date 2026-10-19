import test from 'node:test';
import assert from 'node:assert/strict';

// RW-31 (docs/PLAN-render-worker.md § 2.6 p. 15, 29, 30): widok klatki po stronie gry — flaga pudła rysowania,
// bramka zamrażania zimnych wraków, wybór ciał do rysowania i smuga zimnego wraku liczone w grze, bez pytania
// renderu (src/game/coldWreckView.js, wspólne pudła src/render/drawBox.js, kolor src/render/bodyColor.js).

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
// Atrapa płótna do koloru smugi (średnia z 32 × 32, piksele z alfą ≥ 64).
globalThis.document = globalThis.document || {
  createElement() {
    const c = { width: 0, height: 0, getContext() {
      return {
        drawImage(src) { c.src = src; },
        getImageData(x, y, w, h) {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i++) data.set(c.src.fill || [0, 0, 0, 0], i * 4);
          return { data };
        }
      };
    } };
    return c;
  }
};

const { HullBodies } = await import('../src/game/hullBodies.js');
const { COLD_WRECK_CONFIG } = await import('../src/game/coldWrecks.js');
const V = await import('../src/game/coldWreckView.js');
const B = await import('../src/render/drawBox.js');
const { averageImageRGB } = await import('../src/render/bodyColor.js');
const { readIndexHtml } = await import('./helpers/indexSource.mjs');
const { readFileSync } = await import('node:fs');

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    data[o] = 120; data[o + 1] = 140; data[o + 2] = 160; data[o + 3] = 255;
  }
  return { width: w, height: h, data, fill: [120, 140, 160, 255] };
}
const IMAGE = plate(400, 160);

function ship(x, y, extra = {}) {
  const e = { x, y, vx: 0, vy: 0, angle: 0.4, angVel: 0, mass: 5000, ...extra };
  HullBodies.createHull(e, IMAGE);
  return e;
}

function view(cull, zoom = 0.5, pixelRatio = 1, frameId = 7) {
  return V.setDrawView(V.createDrawView(), cull, zoom, pixelRatio, frameId);
}

const CULL = { x: 0, y: 0, halfW: 9000, halfH: 6000, drawHalfW: 3000, drawHalfH: 2000 };

test('pudła: rozgrzanie i rysowanie (margines ekranowy, wymiary sprite\'a i pivot)', () => {
  const near = { x: 3100, y: 0, radius: 50 };
  const far = { x: 3400, y: 0, radius: 50 };
  assert.equal(B.isEntityInCull(near, CULL), true);
  // promień 140 (minimum) + margines 96 px / zoom 0,5 = 192 j. → 3000 + 332
  assert.equal(B.isEntityInDrawBox(near, CULL, 0.5), true);
  assert.equal(B.isEntityInDrawBox(far, CULL, 0.5), false);
  assert.equal(B.isEntityInDrawBox(far, null, 0.5), true, 'bez pudła — zawsze');
  assert.equal(B.isEntityInCull({ x: 20000, y: 0 }, CULL), false);
  assert.equal(B.wreckImpostorEnterPx(null), B.WRECK_IMPOSTOR_PX);
  assert.equal(B.wreckImpostorEnterPx({ wreckImpostorPx: 22 }), 22);
});

test('stampDrawBoxFlags: ukryte, poza rozgrzaniem, w kadrze; martwe bez zmian', () => {
  const inView = { x: 0, y: 0 };
  const outDraw = { x: 7000, y: 0 };
  const outCull = { x: 30000, y: 0 };
  const hidden = { x: 0, y: 0, fog: true };
  const hideMesh = { x: 0, y: 0, hideHexVisual: true };
  const dead = { x: 0, y: 0, dead: true, __inDrawBox: 'stare' };
  V.stampDrawBoxFlags([inView, outDraw, outCull, hidden, hideMesh, dead, null], view(CULL), (e) => e.fog === true);
  assert.equal(inView.__inDrawBox, true);
  assert.equal(inView.__drawFogHidden, false);
  assert.equal(outDraw.__inDrawBox, false);
  assert.equal(outCull.__inDrawBox, false);
  assert.equal(hidden.__inDrawBox, false);
  assert.equal(hidden.__drawFogHidden, true);
  assert.equal(hideMesh.__inDrawBox, false);
  assert.equal(dead.__inDrawBox, 'stare');
});

test('bramka zamrażania: poza kadrem tak, w kadrze ukryty mgłą nie, przy pełnym wyglądzie zimnego tak', () => {
  window.wrecks.length = 0;
  const e = ship(0, 0);
  const far = ship(8000, 0);
  const v = view(CULL);
  assert.equal(V.coldFreezeVisuallySafe(e, V.createDrawView()), true, 'przed pierwszą klatką — bez ograniczeń');
  assert.equal(V.coldFreezeVisuallySafe(far, v), true, 'poza pudłem rysowania');
  e.__drawFogHidden = true;
  assert.equal(V.coldFreezeVisuallySafe(e, v), false, 'ukryty mgłą w kadrze');
  e.__drawFogHidden = false;
  assert.equal(V.coldFreezeVisuallySafe(e, v, COLD_WRECK_CONFIG), true, 'staticSkin + nearExtras, limit ∞');
  const capped = { ...COLD_WRECK_CONFIG, inViewFreezeMaxPx: 10 };
  assert.equal(V.coldFreezeVisuallySafe(e, v, capped), false, 'w kadrze ponad limit px');
  const rPx = B.beamBodyRadiusPx(e, 0.5, 1);
  assert.equal(V.coldFreezeVisuallySafe(e, v, { ...capped, inViewFreezeMaxPx: rPx + 1 }), true);
  // Bez pełnego wyglądu zimnego — tylko na poziomie smugi.
  const plain = { ...COLD_WRECK_CONFIG, nearExtras: false };
  assert.equal(V.coldFreezeVisuallySafe(e, view(CULL, 0.001), plain), true);
  assert.equal(V.coldFreezeVisuallySafe(e, view(CULL, 2), plain), false);
  // Wrak bez kadłuba na belkach — w obrazie nie ma czego zmienić.
  assert.equal(V.coldFreezeVisuallySafe({ x: 0, y: 0 }, v), true);
  HullBodies.release(e); HullBodies.release(far);
});

test('smuga zimnego wraku: środek pudła ciała, kąt skóry, kolor obrazu, przezroczystość z konfiguracji', () => {
  window.wrecks.length = 0;
  const e = ship(1200, -300);
  const snap = {};
  assert.equal(V.captureBeamColdImpostor(e, snap, { beamImpostorOpacity: 0.6 }), true);
  const imp = snap.impostor;
  assert.ok(Math.hypot(imp.wx - 1200, imp.wy + 300) < 40, 'środek przy kotwicy (płyta bez wycięć)');
  assert.equal(imp.wy, -imp.y);
  assert.ok(Number.isFinite(imp.rot));
  assert.ok(imp.halfW > imp.halfH && imp.reach === Math.hypot(imp.halfW, imp.halfH));
  const rgb = averageImageRGB(IMAGE);
  assert.deepEqual(snap.color, { r: rgb.r, g: rgb.g, b: rgb.b });
  assert.ok(Math.abs(rgb.r - 120 / 255) < 1e-12 && Math.abs(rgb.b - 160 / 255) < 1e-12);
  assert.equal(imp.opacity, 0.6);
  assert.equal(V.captureBeamColdImpostor({ x: 0, y: 0 }, {}), false, 'bez kadłuba');
  HullBodies.release(e);
});

test('wybór ciał do rysowania: znacznik klatki tylko dla zimnych z ciałem; budżet w kolejności listy', () => {
  window.wrecks.length = 0;
  const mk = (x) => {
    const e = ship(x, 0);
    const snap = { kind: 'beam' };
    V.captureBeamColdImpostor(e, snap);
    e._coldSnapshot = snap;
    return e;
  };
  const a = mk(0), b = mk(400), far = mk(20000);
  const order = [];
  const ensure = (w) => { order.push(w); return w !== b; };
  const v = view(CULL, 0.5, 1, 42);
  const n = V.selectColdRenderBodies([a, b, far, null], v, COLD_WRECK_CONFIG, ensure);
  assert.equal(n, 1);
  assert.deepEqual(order, [a, b], 'poza pudłem rozgrzania — bez prośby o ciało');
  assert.equal(a._coldDrawFrame, 42);
  assert.equal(b._coldDrawFrame, undefined, 'odmowa budżetu — smuga');
  // Z daleka (smuga mniejsza niż 0,8 progu) — bez nowego ciała, ale z ciałem trzymane do połowy progu.
  const tiny = view(CULL, 0.0001, 1, 43);
  order.length = 0;
  V.selectColdRenderBodies([a], tiny, COLD_WRECK_CONFIG, ensure);
  assert.deepEqual(order, [], 'smuga ≪ progu, w kadrze — ciało niepotrzebne');
  assert.equal(V.selectColdRenderBodies([a], v, { ...COLD_WRECK_CONFIG, staticSkin: false }, ensure), 0);
  for (const e of [a, b, far]) HullBodies.release(e);
});

test('wpięcie: gra liczy widok klatki, render nie pisze flag gry ani nie woła ensureBody', () => {
  const src = readIndexHtml();
  assert.match(src, /stampDrawBoxFlags\(renderEntities, _drawView, /);
  assert.match(src, /selectColdRenderBodies\(coldWrecks, _drawView, coldWreckSystem\.config, /);
  assert.ok(src.indexOf('selectColdRenderBodies(coldWrecks, _drawView') < src.indexOf('updateHexShips3D(cam, renderEntities, _hexCullInfo, coldWrecks, cloakFrame);'));
  assert.ok(src.indexOf('Bridge3D.update(renderSeenCold,') < src.indexOf('selectColdRenderBodies(coldWrecks, _drawView'),
    'wybór ciał po mostkach — nowe ciało dołącza do list mostków w następnej klatce, jak dawniej');
  assert.match(src, /isVisuallySafe: \(w\) => coldFreezeVisuallySafe\(w, _drawView, coldWreckSystem\.config\)/);
  assert.match(src, /captureBeamColdImpostor\(w, w\._coldSnapshot, coldWreckSystem\.config\)/);
  const hex = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
  assert.doesNotMatch(hex, /entity\.__inDrawBox\s*=/, 'flagę pudła rysowania pisze gra');
  assert.doesNotMatch(hex, /ensureBody\(w\)/, 'render nie prosi gry o ciało');
  assert.match(hex, /from '\.\.\/render\/drawBox\.js'/);
});

test('RW-31 cz. 2: poza renderu holownika do migawki przez frame.poseOf (bez zapisu w encji)', () => {
  const src = readIndexHtml();
  assert.match(src, /const _snapTugPose = \(e, out\) => e\.serviceTug === true && ServiceTugGame\.renderPoseOf\(e, window\.__interpShipPose, out\);/);
  // audyt renderu 2026-10-17: poza do migawki = holownik (pierwszeństwo), potem interpolacja NPC i wraków (renderPoses)
  assert.match(src, /f\.poseOf = npcRenderLerpOn \? _snapPoseLerp : \(ServiceTugGame\.missions\.length \? _snapTugPose : null\);/);
  assert.match(src, /const _snapPoseLerp = \(e, out\) => \{\s*if \(ServiceTugGame\.missions\.length && _snapTugPose\(e, out\)\) return true;/);
});
