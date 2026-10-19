import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// 2026-10-19: dawny dolny dok HUD-u z mini-radarem CIC (CicMiniRadarHUD, drawCicHudRadarSurface,
// przyciski zasięgu w DOM) usunięty — radar jest w kokpicie (src/ui/cockpitUI.js, src/ui/radar/).
test('dawny mini-radar HUD-u usunięty (markup, fasada HUD, rysunek w cicDisplay)', () => {
  const html = readFileSync('index.html', 'utf8');
  const hudSystem = readFileSync('src/ui/hudSystem.js', 'utf8');
  const cicDisplay = readFileSync('src/ui/cicDisplay.js', 'utf8');
  assert.doesNotMatch(html, /hud-radar-dock|hud-radar-canvas|hud-bottom-container|side-panels-container/);
  assert.doesNotMatch(hudSystem, /CicMiniRadarHUD|drawCicHudRadarSurface/);
  assert.doesNotMatch(cicDisplay, /drawCicHudRadarSurface|getHudRadarSnapshot|triggerHudRadarBurst/);
});

test('HUD radar refresh follows the selected view range', () => {
  // 2026-10-07: wejście radaru kokpitu zbiera src/ui/radar/radarFeed.js (refreshRadarFeed w index.html),
  // ~10 Hz albo od razu po zmianie zasięgu i impulsie skanera; antena i tarcza biegną w kokpicie.
  const html = readFileSync('index.html', 'utf8');
  const hudSystem = readFileSync('src/ui/hudSystem.js', 'utf8');

  assert.match(hudSystem, /getRadarRange\(\)/);
  assert.match(html, /hudRadarRange\s*=\s*window\.hudSystem\?\.getRadarRange\?\.\(\)/);
  assert.match(html, /hudRadarSnapshot\?\.range\)\s*!==\s*hudRadarRange/);
  assert.match(html, /hudRadarSnapshot\.pingSerial\s*!==\s*radarPingSerial/);
  assert.match(html, /hudRadarSnapshot\s*=\s*refreshRadarFeed\(hudRadarRange\)/);
  assert.match(html, /env\.features\s*=\s*(?:radarFeaturesWithPirateRock\()?hudRadarWorldFeatures/);
  assert.match(html, /env\.range\s*=\s*range/);
});

test('HUD radar builds planet and megaring outlines from shared world geometry', () => {
  const html = readFileSync('index.html', 'utf8');
  const cicDisplay = readFileSync('src/ui/cicDisplay.js', 'utf8');

  assert.match(html, /function buildHudRadarWorldFeatures\(planetList, sun\)/);
  assert.match(html, /computeHaloRingLayout\(planet\)/);
  assert.match(html, /innerRadius:\s*layout\.innerRadius/);
  assert.match(html, /outerRadius:\s*layout\.outerRadius/);
  assert.match(cicDisplay, /hullWorldW/);
  assert.match(cicDisplay, /hullWorldH/);
});
