// Zegar klatki efektów (2026-10-28, zgłoszenie „240 kl/s, a cząstki, trafienia w tarcze, pociski i strzały klatkują —
// jakby rozsynchronizowane”, docs/AUDYT-wydajnosc-baza-gpu-2026-10-28.md): efekty (Core3D.fx, WeaponFx z bankiem Fx3D,
// odłamki kadłubów) biorą czas ze znacznika rAF klatki strony, nie z performance.now() w chwili rysowania — ten szedł po
// fizyce, więc przy 240 Hz klatka z krokiem 60 Hz „trwała” dla efektów o czas kroku dłużej, następna krócej.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Core3D.frameNowMs: zegar z zewnątrz (worker), inaczej znacznik rAF strony (RenderWorld), poza pętlą performance.now()', async () => {
  const { Core3D } = await import('../src/3d/core3d.js');
  const { RenderWorld } = await import('../src/render/renderWorld.js');
  const prevWindow = globalThis.window, prevNow = Core3D.fxNowMs;
  try {
    globalThis.window = { __frameNowMs: 1234.5 };
    Core3D.fxNowMs = NaN;
    assert.equal(Core3D.frameNowMs(), 1234.5, 'off: znacznik rAF pętli gry');
    Core3D.fxNowMs = 777;
    assert.equal(Core3D.frameNowMs(), 777, 'worker: HEAD.WALL migawki');
    Core3D.fxNowMs = NaN;
    RenderWorld.setSource({ frameNowMs: 42 });
    assert.equal(Core3D.frameNowMs(), 42, 'źródło migawki z polem');
    RenderWorld.setSource({});                  // źródło luster bez pola (inline) — globale strony
    assert.equal(Core3D.frameNowMs(), 1234.5);
    RenderWorld.setSource(null);
    globalThis.window = {};
    assert.ok(Number.isFinite(Core3D.frameNowMs()), 'poza pętlą gry: performance.now()');
  } finally {
    RenderWorld.setSource(null);
    globalThis.window = prevWindow;
    Core3D.fxNowMs = prevNow;
  }
});

test('index.html: zegar efektów migawki i strony = znacznik rAF pętli, nie performance.now() po fizyce', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // na początku klatki narysowanej: po decyzji limitu klatek (2026-10-29), przed wejściem i fizyką
  const loop = html.slice(html.indexOf('function loop(now) {'), html.indexOf('pumpInput(now);', html.indexOf('function loop(now) {')));
  assert.ok(loop.length > 0 && loop.length < 2500, 'początek loop()');
  assert.match(loop, /if \(!frameLimitTick\(now\)\) return;[\s\S]*window\.__frameNowMs = now;/, 'pętla gry wystawia znacznik rAF');
  assert.match(html, /f\.wall = lastTime;/, 'HEAD.WALL migawki = znacznik rAF klatki');
  assert.doesNotMatch(html, /f\.wall = performance\.now\(\)/);
});

test('moduły efektów biorą czas klatki z Core3D.frameNowMs (WeaponFx.sync, kadłuby, odłamki)', () => {
  const src = (p) => readFileSync(new URL(`../src/3d/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const sync = src('weapons/weaponFx.js').match(/\n  sync\(bullets\) \{[\s\S]*?\n  \},?\n/);
  assert.ok(sync, 'WeaponFx.sync');
  assert.match(sync[0], /Core3D\.frameNowMs\(\)/);
  assert.doesNotMatch(sync[0], /performance\.now\(\)/);
  assert.match(src('hexShips3D.js'), /const now = Core3D\.frameNowMs\(\);\n  state\.lastTime = now;/);
  assert.match(src('hullDebris3D.js'), /structural, Core3D\.frameNowMs\(\) \* 0\.001/);
  assert.match(src('core3d.js'), /!!freePerspective, this\.frameNowMs\(\)\);/);
});
