import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Kadłuby na belkach w grze: AI ustępuje fizyce przy styku kadłubów, a ścieżki trafień (wiązka, pocisk) podają
// kadłub i źródło stempla mapy ran do applyHexImpact. Przeniesione 2026-10-19 z testów silnika heksów
// (destructorDeepContact, destructorGhostHexes) usuniętych razem z nim.
globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

// Kadłuby statków są na belkach (src/game/hullBodies.js): AI ustępuje fizyce, gdy HullBodies
// zgłasza styk metalu pary, i wraca do nawigacji, gdy styk wygaśnie (okno contactHoldSec).
test('AI avoidance yields ownership to hull contact and resumes after separation', async () => {
  const { HullBodies } = await import('../src/game/hullBodies.js');
  const plate = (w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 150; data[i * 4 + 3] = 255; }
    return { width: w, height: h, data };
  };
  const image = plate(160, 80);
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function applySeparationForces('), source.indexOf('window.applySeparationForces ='));
  for (const player of [false, true]) {
    const npc = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 50000, friendly: true };
    const other = { x: 20, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 50000, friendly: true };
    if (player) { other.pos = { x: 20, y: 0 }; other.vel = { x: 0, y: 0 }; }
    HullBodies.createHull(npc, image);
    HullBodies.createHull(other, image);
    const context = {
      HullBodies, aiDecisionTickId: 1, npcs: [npc, other], performance,
      isNpcCombatActive: () => false, shieldPairStandoff: () => 0, sepYieldFactor: () => 1,
      clampVecLen: (x, y, max) => { const k = Math.min(1, max / (Math.hypot(x, y) || 1)); return { x: x * k, y: y * k }; },
      window: { ship: player ? other : null, isEnemyUnit: () => false }
    };
    const apply = vm.runInNewContext(`(${code})`, context);
    try {
      const before = apply(npc, 0, 0);
      assert.ok(Math.hypot(before.ax, before.ay) > 0, 'avoidance remains active before impact');
      HullBodies.step(1 / 120, [npc, other]);
      assert.ok(HullBodies.hasContact(npc, other), 'nakładające się kadłuby są w styku');
      const during = apply(npc, 0, 0);
      assert.equal(Math.hypot(during.ax, during.ay), 0, 'cached repulsion must stop on impact');
      // Rozsunięte kadłuby: styk wygasa po oknie contactHoldSec czasu symulacji.
      if (other.pos) { other.pos.x = 5000; } other.x = 5000;
      for (let k = 0; k < 14; k++) HullBodies.step(1 / 120, [npc, other]);
      assert.equal(HullBodies.hasContact(npc, other), false, 'contact history expires after separation');
      if (other.pos) { other.pos.x = 20; } other.x = 20;
      context.aiDecisionTickId++;
      const after = apply(npc, 0, 0);
      assert.ok(Math.hypot(after.ax, after.ay) > 0, 'normal navigation resumes');
    } finally { HullBodies.release(npc); HullBodies.release(other); }
  }
});

test('ścieżki trafień gry podają kadłub i źródło stempla mapy ran do applyHexImpact', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // Raymarch wiązki siedzi w pomocnikach modułowych tuż przed fireWeaponCore
  // (resolveBeamWorldHit), obrażenia nadal w samym fireWeaponCore.
  const beam = html.slice(html.indexOf('// --- Trafienia wiązek: pomocniki modułowe'), html.indexOf('// --- LOGIKA POCISKÓW I RAKIET ---'));
  assert.ok(beam.includes('window.fireWeaponCore = function'), 'pomocniki wiązki muszą stać przed fireWeaponCore');
  // Raymarch heksów (findBeamHexShard) zniknął z gry razem z heksowym destruktorem (etap 8 portu belek).
  assert.doesNotMatch(beam, /findBeamHexShard/);
  assert.doesNotMatch(beam, /for \(let dr = -1; dr <= 1; dr\+\+\)/, 'the fixed 3x3 window is back in the beam raymarch');
  // Ostatni argument po heksie: źródło stempla mapy ran (broń / pocisk, zadanie 18-C).
  assert.match(beam, /applyHexImpact\(hitEntity, finalEndX, finalEndY, damage, [^;]*beamHitShard(?:, weapon)?\)/);
  const bullets = html.slice(html.indexOf('function bulletsAndCollisionsStep('));
  assert.match(bullets, /hullShard = hexSweep\.hitShard/);
  // Zadanie 18-B: krater wejścia z mnożnikiem mechaniki broni (rykoszet × 0,3; reszta arsenału
  // × 1 — obrażenia jak dotąd), encja trafienia jako realHit = hitNPC._realEntity || hitNPC;
  // po heksie źródło stempla mapy ran (pocisk, 18-C) i wariant (rykoszet / trafienie, 18-B).
  assert.match(bullets, /const realHit = hitNPC\._realEntity \|\| hitNPC;/);
  assert.match(bullets, /applyHexImpact\(realHit, hitX, hitY, npcDamage \* entryK\.crater, [^;]*hitHexShard(?:, b(?:,[^;]*)?)?\)/);
});
