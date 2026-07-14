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
  const html = readFileSync('index.html', 'utf8');

  assert.match(html, /\.hud-radar-shell\s*\{[\s\S]*?\bheight:\s*176px/);
  assert.doesNotMatch(html, /\.hud-radar-shell\s*\{[\s\S]*?\bmin-height:\s*218px/);
  assert.match(html, /\.hud-radar-readout\s*\{[\s\S]*?\bposition:\s*absolute/);
});

test('HUD radar exposes clickable tactical range controls', () => {
  const html = readFileSync('index.html', 'utf8');
  const hudSystem = readFileSync('src/ui/hudSystem.js', 'utf8');

  assert.match(html, /class="hud-radar-controls"[^>]*aria-label="Zasięg radaru"/);
  for (const range of [5000, 10000, 20000, 40000, 60000]) {
    assert.match(html, new RegExp(`data-radar-range="${range}"`));
  }
  assert.match(html, /\.hud-radar-controls\s*\{[\s\S]*?pointer-events:\s*auto/);
  assert.match(hudSystem, /CIC_MINI_RADAR_RANGES\s*=\s*Object\.freeze\(\[5000, 10000, 20000, 40000, 60000\]\)/);
  assert.match(hudSystem, /bindRangeControls\(\)/);
  assert.match(hudSystem, /setViewRange\(range\)/);
  assert.doesNotMatch(hudSystem, /bindMiddleMousePan/);
});

test('HUD radar refresh follows the selected view range', () => {
  const html = readFileSync('index.html', 'utf8');
  const hudSystem = readFileSync('src/ui/hudSystem.js', 'utf8');

  assert.match(hudSystem, /getRadarRange\(\)/);
  assert.match(html, /hudRadarRange\s*=\s*window\.hudSystem\?\.getRadarRange\?\.\(\)/);
  assert.match(html, /hudRadarSnapshot\?\.range\)\s*!==\s*hudRadarRange/);
  assert.match(html, /range:\s*hudRadarRange/);
});
