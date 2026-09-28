// Port WebGPU ringu „Halo” (zadanie 06): budowa ringu asynchroniczna — ring nie
// zgłasza gotowości przed odczytem mapy CPU, plan budowli czeka na odczyt, kolizje
// z terenem podpinają się po `ready` (nigdy do pustej mapy). Bez GPU: atrapa
// renderera (kompilacja, render, odczyt asynchroniczny z dopełnieniem wierszy).
// node --test tests/haloRingAsync.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHaloRing } from '../src/3d/haloRing/index.js';
import { HaloRingGame } from '../src/3d/haloRing/haloRingGame.js';

// Odczyt: kanał 0 = 50 + numer wiersza (wysokość terenu ≠ 0 wszędzie); odpowiedź po chwili.
function fakeRenderer({ delay = 3 } = {}) {
  const calls = [];
  let target = null;
  return {
    calls,
    autoClear: true,
    async init() {},
    getRenderTarget: () => target,
    setRenderTarget(t) { target = t; },
    async compileAsync() { calls.push('compile'); },
    render() { calls.push('render'); },
    async readRenderTargetPixelsAsync(rt, x, y, w, h) {
      calls.push('read');
      await new Promise((r) => setTimeout(r, delay));
      const rowElems = Math.ceil(w * 16 / 256) * 64;
      const out = new Float32Array((h - 1) * rowElems + w * 4);
      for (let r = 0; r < h; r++) for (let i = 0; i < w; i++) out[r * rowElems + i * 4] = 50 + r;
      return out;
    }
  };
}

test('createHaloRing: gotowość dopiero po odczycie mapy CPU (bryły, K-7, budowle i teren po ready)', async () => {
  const r = fakeRenderer();
  const ring = createHaloRing({ renderer: r, planetRadius: 37800, seed: 1337, quality: 'low' });
  // od razu: układ i uniformy (host ustawia warstwy, słońce, wycięcia), nic więcej
  assert.ok(ring.layout && ring.uniforms);
  assert.equal(ring.isReady, false);
  assert.equal(ring.mapsReady, false);
  assert.equal(ring.terrainHeightAt(42300, 0, 0), 0, 'przed odczytem brak rzeźby (host czeka na ready)');
  assert.equal(ring.k7Halls.length, 0);
  assert.equal(ring.group.children.length, 0);
  assert.equal(ring.stats.mapsReady, false);
  ring.setLayers({ default: 1, fg: 2 });
  ring.setSun(0.5, 0.8);
  ring.setVisible('clouds', false);
  ring.setCutaway(1, { x: 1, y: 2, a: 1350, strength: 1 });
  assert.doesNotThrow(() => ring.update(1 / 60, { camera: { getWorldPosition: (v) => v.set(0, 0, 0) } }));
  const ok = await ring.ready;
  assert.equal(ok, true);
  assert.equal(ring.isReady, true);
  assert.ok(r.calls.indexOf('read') < r.calls.lastIndexOf('render'), 'setCivic: ponowny bake po pierwszym odczycie');
  assert.equal(r.calls.filter((c) => c === 'read').length, 2, 'odczyt przed placami i po nich');
  const h = ring.terrainHeightAt(42300, 0, 0);
  assert.ok(h > 50, `wysokość z odczytu: ${h}`);
  assert.equal(ring.k7Halls.length, 4);
  assert.ok(ring.landmarks.length > 0 && ring.domes.length > 0, 'budowle i kopuły z mapy CPU');
  assert.ok(ring.group.children.length > 0);
  // widoczność ustawiona przed budową nałożona na zbudowane części
  const clouds = ring.group.children.find((o) => o.name === 'HaloClouds');
  assert.ok(clouds, 'siatka chmur w grupie');
  assert.equal(clouds.visible, false);
  // pełna mapa dopieka się plastrami w update(); dopiero wtedy mapsReady
  assert.equal(ring.mapsReady, false);
  ring.dispose();
});

test('setQuality: nowy zestaw w tle, stary rysuje się i odpowiada wysokością do podmiany; dispose w trakcie budowy', async () => {
  const r = fakeRenderer();
  const ring = createHaloRing({ renderer: r, planetRadius: 37800, seed: 1337, quality: 'low' });
  await ring.ready;
  const before = ring.group.children.length;
  ring.setQuality('medium');
  assert.equal(ring.isReady, false, 'przebudowa w toku');
  assert.equal(ring.group.children.length, before, 'stary zestaw zostaje do podmiany');
  assert.ok(ring.terrainHeightAt(42300, 0, 0) > 50, 'mapa CPU bez przerwy (kolizje)');
  assert.equal(await ring.ready, true);
  assert.equal(ring.quality, 'medium');
  // dispose w trakcie budowy: budowa kończy się bez podpięcia brył
  const r2 = fakeRenderer({ delay: 10 });
  const ring2 = createHaloRing({ renderer: r2, planetRadius: 37800, seed: 1337, quality: 'low' });
  const pending = ring2.ready;
  ring2.dispose();
  assert.equal(await pending, false);
  assert.equal(ring2.group.children.length, 0);
  ring.dispose();
});

test('HaloRingGame: kolizje z terenem i stanowiska K-7 dopiero po ready (nigdy pusta mapa)', async () => {
  const EARTH = { id: 'earth', x: 1060000, y: -250000, r: 2800 };
  const scene = { add() {}, remove() {} };
  const game = new HaloRingGame({ planets: [EARTH], renderer: fakeRenderer(), scene, quality: 'low' });
  const entry = game.entries[0];
  assert.equal(entry.collider.terrainHeightAt, null);
  const ring = game.showcaseRing('earth');
  assert.ok(ring);
  assert.equal(entry.collider.terrainHeightAt, null, 'przed odczytem kolider zna samą płytę');
  await ring.ready;
  await Promise.resolve();
  assert.equal(typeof entry.collider.terrainHeightAt, 'function');
  const L = ring.layout;
  const h = entry.collider.terrainHeightAt(L.radii.floorMid, 0);
  assert.ok(h !== 0 && Number.isFinite(h), `kolider dostaje wysokość terenu: ${h}`);
  for (const hall of ring.k7Halls) for (const b of hall.layout.berths) assert.equal(b.occupied, null);
  game.dispose();
});

// Zadanie 23 portu WebGPU: dach nad płaszczyzną gry całkiem wygaszony (uFgFade.x = 0) — każdy fragment
// górnej ściany i brył dachu odpada w haloFgClip, ale `discard` w WGSL nie kończy cieniowania (Tint:
// demote-to-helper), więc ring nie rysuje wtedy tych siatek; przy powrocie dachu wracają z widocznością
// sprzed zaniku (setVisible części, bryły bez instancji zostają ukryte).
test('update: dach przy pełnym zaniku (uFgFade.x = 0) bez rysunku, wraca z widocznością sprzed zaniku', async () => {
  const THREE = await import('three');
  const ring = createHaloRing({ renderer: fakeRenderer(), planetRadius: 37800, seed: 1337, quality: 'low' });
  assert.equal(await ring.ready, true);
  const L = ring.layout;
  const top = ring.group.children.find((o) => o.name === 'HaloStructure_topWall');
  assert.ok(top, 'górna ściana (FG) w grupie');
  // dach FG megastruktury: bryły detalu, pociągi, światła dachu (doki i ich światła to BG — bez zmian)
  const fgMega = [];
  ring.group.traverse((o) => { if (/^HaloMega_(detail_|trains$|lights$)/.test(o.name)) fgMega.push(o); });
  assert.ok(fgMega.length >= 3, `siatki dachu FG: ${fgMega.map((m) => m.name)}`);
  const bg = [];
  ring.group.traverse((o) => { if (/^HaloMega_(landmark_|domeGlass$|dockLights$)/.test(o.name)) bg.push(o); });
  const bgBefore = bg.map((m) => m.visible);
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 1, 1e7);
  const view = { camera: cam, viewportHeight: 1080, gameView: true };
  const at = (z) => { cam.position.set(L.radii.floorMid, 0, z); cam.lookAt(L.radii.floorMid, 0, 0); cam.updateMatrixWorld(true); ring.update(1 / 60, view); };
  at(L.z.top * 4); // daleko nad dachem: m → 1,33 < fadeMag[0] — dach pełny
  assert.equal(ring.uniforms.uFgFade.value.x, 1);
  const before = new Map(fgMega.map((m) => [m, m.visible]));
  assert.equal(top.visible, true);
  at(L.z.top * 1.2); // tuż nad dachem: m = 6 > fadeMag[1] — zanik pełny
  assert.equal(ring.uniforms.uFgFade.value.x, 0);
  assert.equal(top.visible, false, 'górna ściana bez rysunku przy pełnym zaniku');
  for (const m of fgMega) assert.equal(m.visible, false, `${m.name} bez rysunku przy pełnym zaniku`);
  assert.deepEqual(bg.map((m) => m.visible), bgBefore, 'doki (BG) bez zmian');
  at(L.z.top * 4);
  assert.equal(top.visible, true, 'ściana wraca');
  for (const m of fgMega) assert.equal(m.visible, before.get(m), `${m.name}: widoczność sprzed zaniku`);
  // część wyłączona przez hosta zostaje wyłączona po powrocie dachu
  ring.setVisible('structureTop', false);
  at(L.z.top * 1.2);
  at(L.z.top * 4);
  assert.equal(top.visible, false, 'setVisible(structureTop, false) ma pierwszeństwo');
  ring.dispose();
});
