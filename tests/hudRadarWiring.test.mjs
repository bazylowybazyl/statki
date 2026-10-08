import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('bottom HUD right dock is wired as a CIC radar surface', () => {
  const html = readFileSync('index.html', 'utf8');
  const hudSystem = readFileSync('src/ui/hudSystem.js', 'utf8');

  assert.match(html, /id="hud-radar-dock"/);
  assert.match(html, /class="hud-radar-canvas"/);
  assert.match(hudSystem, /class CicMiniRadarHUD/);
  assert.match(hudSystem, /drawCicHudRadarSurface/);
  assert.match(hudSystem, /env\?\.radar/);
});

test('HUD radar shell is compact and does not reserve an empty lower panel', () => {
  // Style HUD-u wyniesione z index.html do assets/css/main.css (rozbiór index.html, 2026-08-23).
  const html = readFileSync('index.html', 'utf8');
  const css = readFileSync('assets/css/main.css', 'utf8');

  assert.match(html, /<link rel="stylesheet" href="assets\/css\/main\.css">/);
  assert.match(css, /\.hud-radar-shell\s*\{[^}]*\bheight:\s*176px/);
  assert.doesNotMatch(css, /\.hud-radar-shell\s*\{[^}]*\bmin-height:\s*218px/);
  assert.match(css, /\.hud-radar-readout\s*\{[^}]*\bposition:\s*absolute/);
});

test('HUD radar exposes clickable tactical range controls', () => {
  const html = readFileSync('index.html', 'utf8');
  const css = readFileSync('assets/css/main.css', 'utf8');
  const hudSystem = readFileSync('src/ui/hudSystem.js', 'utf8');

  assert.match(html, /class="hud-radar-controls"[^>]*aria-label="Zasięg radaru"/);
  for (const range of [5000, 10000, 20000, 40000, 60000]) {
    assert.match(html, new RegExp(`data-radar-range="${range}"`));
  }
  assert.match(css, /\.hud-radar-controls\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(hudSystem, /CIC_MINI_RADAR_RANGES\s*=\s*Object\.freeze\(\[5000, 10000, 20000, 40000, 60000\]\)/);
  assert.match(hudSystem, /bindRangeControls\(\)/);
  assert.match(hudSystem, /setViewRange\(range\)/);
  assert.doesNotMatch(hudSystem, /bindMiddleMousePan/);
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
  assert.match(html, /env\.features\s*=\s*hudRadarWorldFeatures/);
  assert.match(html, /env\.range\s*=\s*range/);
});

test('HUD radar builds planet and megaring outlines from shared world geometry', () => {
  const html = readFileSync('index.html', 'utf8');
  const cicDisplay = readFileSync('src/ui/cicDisplay.js', 'utf8');

  assert.match(html, /function buildHudRadarWorldFeatures\(planetList, sun\)/);
  assert.match(html, /computeHaloRingLayout\(planet\)/);
  assert.match(html, /innerRadius:\s*layout\.innerRadius/);
  assert.match(html, /outerRadius:\s*layout\.outerRadius/);
  assert.match(cicDisplay, /drawCicHudRadarWorldFeatures/);
  assert.match(cicDisplay, /drawCicHudRadarShipFootprint/);
  assert.match(cicDisplay, /hullWorldW/);
  assert.match(cicDisplay, /hullWorldH/);
});
