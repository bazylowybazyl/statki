import test from 'node:test';
import assert from 'node:assert/strict';
import { HIT_MARK, HIT_MARKER_TUNE, createHitMarker, noteHitMarker, hitStrength, hitMarkerActive, drawHitMarker } from '../src/ui/hitMarker.js';

// Atrapa kontekstu 2D: zlicza kreski i pilnuje liczb.
function fakeCtx() {
  const c = { lines: 0, strokes: [], save() {}, restore() {}, beginPath() {}, stroke() { c.strokes.push(c.strokeStyle); },
    moveTo(x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); }, lineTo(x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); c.lines++; } };
  return c;
}

test('znacznik trafienia: rodzaj, gaśnięcie, seria trafień z sufitem siły', () => {
  const m = createHitMarker();
  assert.equal(hitMarkerActive(m, 0), false);
  noteHitMarker(m, HIT_MARK.HULL, 10, hitStrength(850));
  assert.equal(hitMarkerActive(m, 10.1), true);
  assert.equal(hitMarkerActive(m, 10 + HIT_MARKER_TUNE.life[HIT_MARK.HULL] + 0.01), false);
  for (let i = 0; i < 20; i++) noteHitMarker(m, HIT_MARK.HULL, 20 + i * 0.01, 1);
  assert.equal(m.amt[HIT_MARK.HULL], HIT_MARKER_TUNE.maxStrength);
  assert.ok(hitStrength(1) >= HIT_MARKER_TUNE.minStrength && hitStrength(1e6) === 1);
});

test('znacznik trafienia: cztery kreski na rodzaj, barwy tarcza / kadłub / zniszczenie', () => {
  const m = createHitMarker();
  noteHitMarker(m, HIT_MARK.SHIELD, 5, 1);
  noteHitMarker(m, HIT_MARK.HULL, 5, 1);
  noteHitMarker(m, HIT_MARK.KILL, 5, 1);
  const c = fakeCtx();
  assert.equal(drawHitMarker(c, 100, 100, m, 5.05, 1.2), 3);
  assert.equal(c.lines, 12);
  assert.deepEqual(c.strokes, HIT_MARKER_TUNE.color);
  assert.equal(drawHitMarker(fakeCtx(), 100, 100, m, 6, 1), 0, 'po czasie — nic');
});
