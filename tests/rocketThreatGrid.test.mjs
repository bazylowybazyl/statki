// Siatka rakiet dla pocisków CIWS (src/game/rocketIntercept.js, etap 0 audytu fizyki — docs/AUDYT-fizyka-worker-2026-10-17.md
// § 6 D): kandydaci z siatki testowani rosnąco dają TO SAMO pierwsze trafienie co pełny przegląd bufora — także gdy
// rakiety kanwy przesuną się po budowie siatki (pętla pocisków kroku).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ciwsShotHitsRocket, ciwsRocketReach, RocketThreatGrid } from '../src/game/rocketIntercept.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function firstHitLinear(b, bx0, by0, threats, span, reach) {
  for (let j = 0; j < threats.length; j++) {
    const rb = threats[j];
    if (!rb || rb.life <= 0) continue;
    if (ciwsShotHitsRocket(b, bx0, by0, rb, span, reach)) return j;
  }
  return -1;
}

function firstHitGrid(grid, b, bx0, by0, threats, span, reach) {
  const cand = grid.query(b.x, b.y, reach);
  for (let k = 1; k < cand.length; k++) assert.ok(cand[k] > cand[k - 1], 'indeksy rosnąco, bez powtórzeń');
  for (let jj = 0; jj < cand.length; jj++) {
    const rb = threats[cand[jj]];
    if (!rb || rb.life <= 0) continue;
    if (ciwsShotHitsRocket(b, bx0, by0, rb, span, reach)) return cand[jj];
  }
  return -1;
}

test('RocketThreatGrid: pierwsze trafienie jak pełny przegląd (rakiety ruszone po budowie, ujemne współrzędne, zbite skupiska)', () => {
  const dt = 1 / 60;
  for (let seed = 1; seed <= 12; seed++) {
    const r = rng(seed);
    const grid = new RocketThreatGrid(seed % 2 ? 256 : 97);
    const ox = (r() - 0.5) * 2e7, oy = (r() - 0.5) * 2e7;   // świat do ±10 mln j.
    const spread = seed % 3 === 0 ? 300 : 6000;              // co trzecie ziarno — gęste skupisko
    const threats = [];
    for (let i = 0; i < 400; i++) {
      const a = r() * Math.PI * 2, v = 600 + r() * 5400;
      threats.push({ x: ox + (r() - 0.5) * spread, y: oy + (r() - 0.5) * spread, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 3 + r() * 7, life: r() < 0.05 ? -1 : 1 });
    }
    grid.build(threats, dt);
    // rakiety kanwy lecą dalej w pętli pocisków (po budowie siatki) — część przesuwa się o krok
    for (const rb of threats) if (r() < 0.5) { rb.x += rb.vx * dt; rb.y += rb.vy * dt; }
    let hits = 0;
    for (let k = 0; k < 600; k++) {
      const a = r() * Math.PI * 2, v = 1800 + r() * 800;
      const near = threats[(r() * threats.length) | 0];
      const b = { x: near.x + (r() - 0.5) * 120, y: near.y + (r() - 0.5) * 120, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 };
      const span = dt * (0.3 + r() * 0.7);
      const bx0 = b.x - b.vx * span, by0 = b.y - b.vy * span;
      const reach = ciwsRocketReach(b, span);
      const lin = firstHitLinear(b, bx0, by0, threats, span, reach);
      assert.equal(firstHitGrid(grid, b, bx0, by0, threats, span, reach), lin, `ziarno ${seed}, pocisk ${k}`);
      if (lin >= 0) hits++;
    }
    assert.ok(hits > 20, `ziarno ${seed}: za mało trafień w próbie (${hits})`);
  }
});

test('RocketThreatGrid: przebudowa czyści poprzedni krok, pusty bufor', () => {
  const g = new RocketThreatGrid(256);
  g.build([{ x: 10, y: 10, vx: 0, vy: 0 }], 1 / 60);
  assert.deepEqual([...g.query(10, 10, 50)], [0]);
  g.build([{ x: 5000, y: 5000, vx: 0, vy: 0 }], 1 / 60);
  assert.deepEqual([...g.query(10, 10, 50)], []);
  assert.deepEqual([...g.query(5000, 5000, 50)], [0]);
  g.build([], 1 / 60);
  assert.deepEqual([...g.query(5000, 5000, 50)], []);
  // bufor większy niż pojemność początkowa
  const many = Array.from({ length: 1000 }, (_, i) => ({ x: i * 3, y: 0, vx: 0, vy: 0 }));
  g.build(many, 1 / 60);
  assert.ok(g.query(1500, 0, 20).includes(500));
});
