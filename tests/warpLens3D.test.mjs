import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Soczewka skoku (warp) — pass Core3D na samym tle (src/3d/warpLens3D.js).
// Stara wersja miała własny kontekst WebGL, próbkowała gotową klatkę 2D ze
// statkiem i bloomem, a statek ratowała wyciętą elipsą — w grze było widać
// „jajko” z uciętą poświatą dysz, fałdę mapy i ciemną obwódkę. Te testy
// pilnują mapy (ciągła, monotoniczna), mapowania świat → UV i tego, że
// soczewka nie wraca na gotową klatkę.
// Port WebGPU (zadanie 01): warp poza portem — pass soczewki usunięty z Core3D,
// jego API to no-op; zostaje matematyka CPU soczewki i glue gry (warpLensPass.js).

globalThis.window = globalThis.window || {};
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

// Port WebGPU (zadanie 01, decyzja użytkownika: warp poza portem): pass soczewki,
// jej cele i gwiazdy warstwy 8 usunięte z Core3D — asercje o passie zniknęły,
// matematyka CPU soczewki (wyżej) zostaje. Tu: API bez rysowania i miejsce na
// pass zgięcia tła nowego warpa zaraz po passie tła.
test('Core3D: soczewka poza portem — bez passa i celów, jeden renderer (WebGPU), miejsce po passie tła', () => {
  const core = readSrc('src/3d/core3d.js');
  const list = core.match(/_scenePasses\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  assert.ok(!list.includes('warpLensPass'), 'pass soczewki wrócił do łańcucha');
  assert.doesNotMatch(core, /import[^;]*warpLens3D/);
  assert.doesNotMatch(core, /warpLensTarget|warpStarTarget|renderPassWarpStars|_prepareWarpLens/);
  // Miejsce na pass zgięcia tła (nowy warp) w render(): zaraz po passie tła.
  const renderAt = core.indexOf('\n  render() {');
  const bgHook = core.indexOf('if (pass === this.renderPassBg) {', renderAt);
  const note = core.indexOf('Pass zgięcia tła (nowy warp)', bgHook);
  assert.ok(renderAt > 0 && bgHook > renderAt && note > bgHook, 'komentarz-miejsce na pass zgięcia tła w render()');
  // Jeden renderer gry: WebGPU w Core3D, żadnego WebGLRenderer.
  assert.equal((core.match(/new THREE\.WebGLRenderer/g) || []).length, 0);
  assert.equal((core.match(/new THREE\.WebGPURenderer\(/g) || []).length, 1, 'jedyny renderer gry to Core3D');
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

// Core3D.setWarpLensWorld / clearWarpLens są na WebGPU no-opami (warp poza portem),
// więc zgłoszenie glue gry (warpLensPass.js — matematyka CPU) łapie podsłuch.
function spyWarpLens() {
  const req = { x: 0, y: 0, angle: 0, radiusAlong: 0, radiusAcross: 0, swallow: 0, stampMs: -Infinity };
  const prev = { set: Core3D.setWarpLensWorld, clear: Core3D.clearWarpLens };
  Core3D.setWarpLensWorld = (x, y, angle, radiusAlong, radiusAcross, swallow) => {
    Object.assign(req, { x, y, angle, radiusAlong, radiusAcross, swallow, stampMs: performance.now() });
  };
  Core3D.clearWarpLens = () => { req.stampMs = -Infinity; };
  return { req, restore() { Core3D.setWarpLensWorld = prev.set; Core3D.clearWarpLens = prev.clear; } };
}

test('updateWarpLens3D: środek na osi kadłuba, promień w długościach kadłuba, rampa i wygaszanie', () => {
  const spy = spyWarpLens();
  try {
    const req = spy.req;
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
  } finally {
    spy.restore();
  }
});

test('updateWarpLens3D: tylko w strefie z efektem, martwy statek gasi od razu', () => {
  const spy = spyWarpLens();
  try {
    const req = spy.req;
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
  } finally {
    spy.restore();
  }
});

test('Core3D: API soczewki to bezpieczny no-op — te same sygnatury, bez stanu i bez rysowania', () => {
  assert.equal(Core3D.setWarpLensWorld.length, 6);
  assert.equal(Core3D.setWarpLensWorld(0, 0, 0, 2340, 1800, 0.55), undefined);
  assert.equal(Core3D.clearWarpLens(), undefined);
  // Dawny stan soczewki (zgłoszenie, pass, cel z mipmapami i lustrem) nie istnieje.
  for (const key of ['_warpLensRequest', 'warpLensPass', 'warpLensTarget', '_prepareWarpLens', '_warpLensActive']) {
    assert.equal(Core3D[key], undefined, key);
  }
});
