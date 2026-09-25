import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Soczewka skoku (warp) — pass Core3D na samym tle (src/3d/warpLens3D.js).
// Stara wersja miała własny kontekst WebGL, próbkowała gotową klatkę 2D ze
// statkiem i bloomem, a statek ratowała wyciętą elipsą — w grze było widać
// „jajko” z uciętą poświatą dysz, fałdę mapy i ciemną obwódkę. Te testy
// pilnują mapy (ciągła, monotoniczna), mapowania świat → UV i tego, że
// soczewka nie wraca na gotową klatkę.

globalThis.window = globalThis.window || {};
const THREE = await import('three');
const {
  WARP_LENS_MAX_SWALLOW,
  WARP_LENS_MIN_RADIUS_PX,
  warpLensSourceRadius,
  computeWarpLensUniforms,
  warpLensSampleUv,
  createWarpLensShader
} = await import('../src/3d/warpLens3D.js');
const { Core3D } = await import('../src/3d/core3d.js');
const { updateWarpLens3D } = await import('../src/vfx/warpLensPass.js');
const { publishGameState } = await import('../src/game/gameState.js');

const readSrc = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('mapa soczewki: brzeg bez szwu, środek połknięty, monotoniczna (bez fałd)', () => {
  for (const a of [0.05, 0.2, 0.4, 0.55, WARP_LENS_MAX_SWALLOW]) {
    assert.ok(Math.abs(warpLensSourceRadius(0, a) - a) < 1e-12, `s(0) = a dla a=${a}`);
    assert.ok(Math.abs(warpLensSourceRadius(1, a) - 1) < 1e-12, `s(1) = 1 dla a=${a}`);
    // Pochodna przy brzegu = 1 (bez załamania na granicy soczewki).
    const h = 1e-4;
    const slope = (warpLensSourceRadius(1, a) - warpLensSourceRadius(1 - h, a)) / h;
    assert.ok(Math.abs(slope - 1) < 2e-3, `s'(1) ≈ 1 dla a=${a}, jest ${slope}`);
    let prev = -1;
    for (let i = 0; i <= 4000; i++) {
      const x = i / 4000;
      const s = warpLensSourceRadius(x, a);
      assert.ok(s > prev, `fałda przy x=${x}, a=${a}`);
      assert.ok(s >= x - 1e-12, 'soczewka ściąga tło z zewnątrz, nigdy od środka');
      prev = s;
    }
  }
  // Poza soczewką tożsamość; siła przycięta do progu monotoniczności.
  assert.equal(warpLensSourceRadius(1.3, 0.5), 1.3);
  assert.ok(Math.abs(warpLensSourceRadius(0, 5) - WARP_LENS_MAX_SWALLOW) < 1e-12);
  assert.ok(WARP_LENS_MAX_SWALLOW < Math.SQRT1_2, 'powyżej 1/√2 mapa zawija się w fałdę');
});

test('świat → UV: środek, oś lotu, promienie w wysokościach ekranu, kadr', () => {
  const out = {};
  const cam = { x: 1000, y: 2000, zoom: 0.5 };
  const lens = { x: 1000, y: 2000, angle: 0, radiusAlong: 400, radiusAcross: 200, swallow: 0.5 };
  assert.equal(computeWarpLensUniforms(lens, cam, 1000, 800, out), true);
  assert.equal(out.centerU, 0.5);
  assert.equal(out.centerV, 0.5);
  assert.equal(out.aspect, 1000 / 800);
  assert.ok(Math.abs(out.radiusAlong - 400 * 0.5 / 800) < 1e-12);
  assert.ok(Math.abs(out.radiusAcross - 200 * 0.5 / 800) < 1e-12);
  assert.deepEqual([out.axisX, out.axisY], [1, -0]);

  // Oś y gry w dół, UV w górę: +100 j. w prawo i w dół.
  computeWarpLensUniforms({ ...lens, x: 1100, y: 2100 }, cam, 1000, 800, out);
  assert.ok(Math.abs(out.centerU - 0.55) < 1e-12);
  assert.ok(Math.abs(out.centerV - (0.5 - 50 / 800)) < 1e-12);

  // Dziób w dół ekranu (kąt gry π/2) = oś UV (0, -1).
  computeWarpLensUniforms({ ...lens, angle: Math.PI / 2 }, cam, 1000, 800, out);
  assert.ok(Math.abs(out.axisX) < 1e-12 && Math.abs(out.axisY + 1) < 1e-12);

  // Siła przycięta do progu.
  computeWarpLensUniforms({ ...lens, swallow: 3 }, cam, 1000, 800, out);
  assert.equal(out.swallow, WARP_LENS_MAX_SWALLOW);

  // Bez siły, za mała na ekranie albo w całości poza kadrem = brak passa.
  assert.equal(computeWarpLensUniforms({ ...lens, swallow: 0 }, cam, 1000, 800, {}), false);
  const tiny = (WARP_LENS_MIN_RADIUS_PX * 0.5) / 0.5;
  assert.equal(computeWarpLensUniforms({ ...lens, radiusAlong: tiny, radiusAcross: tiny }, cam, 1000, 800, {}), false);
  // Środek 1000 px w prawo od ekranu (zoom 0.5 → 4000 j.), promień 400 j. = 200 px.
  assert.equal(computeWarpLensUniforms({ ...lens, x: 1000 + 1000 / 0.5 + 4000 }, cam, 1000, 800, {}), false);
  // Środek tuż za prawą krawędzią, ale elipsa zachodzi na kadr = pass zostaje.
  assert.equal(computeWarpLensUniforms({ ...lens, x: 1000 + 500 / 0.5 + 100 / 0.5 }, cam, 1000, 800, {}), true);
});

test('lustro shadera: tożsamość poza elipsą, ciągłość na brzegu, próbka dalej na tym samym promieniu', () => {
  const u = {};
  computeWarpLensUniforms(
    { x: 0, y: 0, angle: 0.7, radiusAlong: 600, radiusAcross: 300, swallow: 0.55 },
    { x: 150, y: -80, zoom: 0.4 }, 1600, 900, u
  );
  const s = { u: 0, v: 0 };
  // Poza soczewką piksel bierze tło spod siebie.
  warpLensSampleUv(0.02, 0.97, u, s);
  assert.deepEqual([s.u, s.v], [0.02, 0.97]);

  // Na brzegu elipsy mapa zbiega do tożsamości (bez szwu) — wzdłuż i w poprzek osi.
  const toUv = (along, across) => {
    const perpX = -u.axisY, perpY = u.axisX;
    const dx = u.axisX * along * u.radiusAlong + perpX * across * u.radiusAcross;
    const dy = u.axisY * along * u.radiusAlong + perpY * across * u.radiusAcross;
    return { u: u.centerU + dx / u.aspect, v: u.centerV + dy };
  };
  for (const [a, b] of [[0.9999, 0], [0, 0.9999], [0.7070, 0.7070], [-0.9999, 0]]) {
    const p = toUv(a, b);
    warpLensSampleUv(p.u, p.v, u, s);
    assert.ok(Math.hypot(s.u - p.u, s.v - p.v) < 1e-4, `szew na brzegu (${a}, ${b})`);
  }

  // W środku: próbka na tym samym promieniu, dalej od środka o s(x) / x.
  const p = toUv(0.3, 0.2);
  warpLensSampleUv(p.u, p.v, u, s);
  const x = Math.hypot(0.3, 0.2);
  const k = warpLensSourceRadius(x, u.swallow) / x;
  const q = toUv(0.3 * k, 0.2 * k);
  assert.ok(Math.hypot(s.u - q.u, s.v - q.v) < 1e-9);
});

test('GLSL soczewki liczy to samo co lustro CPU', () => {
  const fs = createWarpLensShader().fragmentShader;
  assert.match(fs, /float s2 = x2 \+ uSwallow \* uSwallow \* w \* w;/);
  assert.match(fs, /vec2 qs = q \* sqrt\(s2 \/ max\(x2, 1e-12\)\);/);
  assert.match(fs, /vec2 perp = vec2\(-uAxis\.y, uAxis\.x\);/);
  assert.match(fs, /d\.x \*= uAspect;/);
  assert.match(fs, /ds\.x \/= uAspect;/);
  // Próbkowanie poza gałęzią — pochodne dla mipmap z ciągłej mapy.
  assert.match(fs, /\}\s*\n\s*(\/\/[^\n]*\n\s*)*gl_FragColor = texture2D\(tSource, uv\);/);
});

test('Core3D: soczewka jako pass zaraz po tle, tło do osobnego celu, bez nowego renderera', () => {
  const core = readSrc('src/3d/core3d.js');
  const list = core.match(/_scenePasses\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  const bg = list.indexOf('this.renderPassBg');
  const lens = list.indexOf('this.warpLensPass');
  const planets = list.indexOf('this.renderPassPlanets');
  const ortho = list.indexOf('this.renderPassOrtho');
  assert.ok(bg >= 0 && lens > bg, 'soczewka musi iść po passie tła');
  assert.ok(lens < planets && lens < ortho, 'planety i statki kładą się NA zakrzywionym tle');
  assert.match(core, /const target = \(warpLensOn && pass === this\.renderPassBg\) \? this\.warpLensTarget : this\.composerTarget;/);
  assert.match(core, /if \(pass === this\.warpLensPass\) return this\._warpLensActive;/);
  assert.match(core, /new FullScreenBlendPass\(createWarpLensShader\(\), \{ blending: THREE\.NoBlending \}\)/);
  assert.equal((core.match(/new THREE\.WebGLRenderer/g) || []).length, 1, 'jedyny renderer WebGL gry to Core3D');
});

test('gra zgłasza soczewkę przed renderem 3D i bez własnego kontekstu', () => {
  const lens = readSrc('src/vfx/warpLensPass.js');
  assert.doesNotMatch(lens, /getContext\(|WarpBlackHole|drawImage\(|clip\(/);
  const html = readSrc('index.html');
  const call = html.indexOf('updateWarpLens3D(interpPos, interpAngle, frameDt);');
  const draw = html.indexOf('} else if (drawHexShips3D) {\n        drawHexShips3D(ctx, W, H);');
  assert.ok(call > 0 && draw > 0, 'brak wywołania soczewki albo rysowania 3D');
  assert.ok(call < draw, 'parametry soczewki muszą dojść do Core3D PRZED Core3D.render');
  assert.doesNotMatch(html, /renderWarpLensPass|configureWarpLensSource|initWarpLens/);
});

function makeWarpWorld({ state = 'active', entryProgress = 1, wormholeVfx = true, angle = 0 } = {}) {
  const ship = { w: 1800, h: 806, radius: 300, angle, dead: false, visual: { spriteScale: 1 } };
  const warp = { state, entryProgress };
  publishGameState({ ship, warp, zoneState: { current: { wormholeVfx } } });
  return { ship, warp };
}

test('updateWarpLens3D: środek na osi kadłuba, promień w długościach kadłuba, rampa i wygaszanie', () => {
  const req = Core3D._warpLensRequest;
  const defaults = window.__WARP_LENS_DEFAULTS;
  const { warp } = makeWarpWorld({ angle: Math.PI / 2 });

  updateWarpLens3D({ x: 100, y: 200 }, Math.PI / 2, 1 / 60);
  // Oś lotu = +y gry (kąt π/2): przesunięcie WZDŁUŻ kadłuba, nie w bok.
  assert.ok(Math.abs(req.x - 100) < 1e-9, 'środek przesunięty w bok od osi kadłuba');
  assert.ok(Math.abs(req.y - (200 + defaults.centerOffset * 1800)) < 1e-9);
  assert.ok(Math.abs(req.radiusAlong - defaults.radius * 1800) < 1e-9);
  assert.ok(Math.abs(req.radiusAcross - defaults.radius * 1800 / defaults.stretch) < 1e-9);
  assert.ok(Math.abs(req.swallow - defaults.swallow) < 1e-12);
  assert.ok(performance.now() - req.stampMs < 1000, 'zgłoszenie musi być świeże');

  // Wyjście ze skoku: soczewka gaśnie przez fadeOut, nie w jednej klatce.
  warp.state = 'idle';
  updateWarpLens3D({ x: 100, y: 200 }, Math.PI / 2, 1 / 30);
  assert.ok(req.swallow > 0 && req.swallow < defaults.swallow, 'brak płynnego wygaszania');
  let frames = 1;
  while (req.stampMs !== -Infinity && frames < 200) {
    updateWarpLens3D({ x: 100, y: 200 }, Math.PI / 2, 1 / 30);
    frames++;
  }
  assert.equal(req.stampMs, -Infinity, 'po wygaszeniu soczewka ma zniknąć');
  const fadeSec = frames / 30;
  assert.ok(Math.abs(fadeSec - defaults.fadeOut) < 0.05, `wygaszanie trwało ${fadeSec} s zamiast ${defaults.fadeOut} s`);

  // Wejście w skok: siła rośnie z entryProgress.
  warp.state = 'active';
  warp.entryProgress = 0.5;
  updateWarpLens3D({ x: 0, y: 0 }, 0, 1 / 60);
  assert.ok(req.swallow > 0 && req.swallow < defaults.swallow);
});

test('updateWarpLens3D: tylko w strefie z efektem, martwy statek gasi od razu', () => {
  const req = Core3D._warpLensRequest;
  makeWarpWorld({ wormholeVfx: false });
  // Poprzedni test mógł zostawić poziom > 0 — w strefie bez efektu gaśnie.
  for (let i = 0; i < 20; i++) updateWarpLens3D({ x: 0, y: 0 }, 0, 0.1);
  assert.equal(req.stampMs, -Infinity);

  const { ship } = makeWarpWorld();
  updateWarpLens3D({ x: 0, y: 0 }, 0, 1 / 60);
  assert.ok(req.stampMs > 0);
  ship.dead = true;
  updateWarpLens3D({ x: 0, y: 0 }, 0, 1 / 60);
  assert.equal(req.stampMs, -Infinity);
});

function makeFakeCore(overrides = {}) {
  const def = createWarpLensShader();
  return Object.assign(Object.create(Core3D), {
    composerTarget: { width: 1600, height: 900 },
    warpLensPass: { enabled: true, uniforms: THREE.UniformsUtils.clone(def.uniforms) },
    renderer: { capabilities: { isWebGL2: true, getMaxAnisotropy: () => 16 } },
    activeCam1: { x: 0, y: 0, zoom: 0.2 },
    activeCam2: null,
    warpLensTarget: null,
    _warpLensActive: false,
    _warpLensLastUseMs: 0,
    _warpLensRequest: { x: 0, y: 0, angle: 0, radiusAlong: 0, radiusAcross: 0, swallow: 0, stampMs: -Infinity },
    _warpLensUniformScratch: {}
  }, overrides);
}

test('Core3D._prepareWarpLens: uniformy, cel z mipmapami i lustrem, zgłoszenie przeterminowane i split', () => {
  const core = makeFakeCore();
  const nowSec = performance.now() / 1000;
  assert.equal(core._prepareWarpLens(false, nowSec), false, 'bez zgłoszenia nie ma passa');
  assert.equal(core.warpLensTarget, null, 'cel powstaje dopiero przy pierwszej soczewce');

  core.setWarpLensWorld(0, 0, 0, 2340, 1800, 0.55);
  assert.equal(core._prepareWarpLens(false, performance.now() / 1000), true);
  assert.equal(core._warpLensActive, true);
  const lu = core.warpLensPass.uniforms;
  assert.equal(lu.tSource.value, core.warpLensTarget.texture);
  assert.ok(Math.abs(lu.uRadius.value.x - 2340 * 0.2 / 900) < 1e-9);
  assert.equal(lu.uSwallow.value, 0.55);
  const tex = core.warpLensTarget.texture;
  assert.equal(core.warpLensTarget.width, 1600);
  assert.equal(tex.generateMipmaps, true);
  assert.equal(tex.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(tex.wrapS, THREE.MirroredRepeatWrapping);
  assert.equal(tex.wrapT, THREE.MirroredRepeatWrapping);
  assert.equal(tex.type, THREE.HalfFloatType);

  // Wolna kamera i dwa widoki w jednym renderze — bez soczewki.
  assert.equal(core._prepareWarpLens(true, performance.now() / 1000), false);
  window.splitScreenMode = true;
  core.activeCam2 = { x: 0, y: 0, zoom: 0.2 };
  assert.equal(core._prepareWarpLens(false, performance.now() / 1000), false);
  window.splitScreenMode = false;
  core.activeCam2 = null;

  // Gra przestała zgłaszać: po WARP_LENS_STALE_MS soczewka znika sama.
  assert.equal(core._prepareWarpLens(false, performance.now() / 1000 + 1), false);
  // clearWarpLens gasi od razu.
  core.setWarpLensWorld(0, 0, 0, 2340, 1800, 0.55);
  core.clearWarpLens();
  assert.equal(core._prepareWarpLens(false, performance.now() / 1000), false);
  assert.equal(core._warpLensActive, false);

  // Po długiej przerwie cel wraca do puli (dispose).
  let disposed = false;
  core.warpLensTarget.dispose = () => { disposed = true; };
  core._prepareWarpLens(false, performance.now() / 1000 + 120);
  assert.equal(disposed, true);
  assert.equal(core.warpLensTarget, null);
});
