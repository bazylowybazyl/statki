// Nakładki dowodzenia (src/ui/commandOverlay.js): podpis zaznaczonej jednostki i układ podpisów
// po przekątnej — bez nachodzenia, w ekranie, bez skakania przy ruchu.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeSelectedUnit,
  formatUnitMass,
  layoutSelectionLabels,
  unitClassLabel
} from '../src/ui/commandOverlay.js';

const frame = (x0, y0, x1, y1, len = 150, prev = null) => ({ x0, y0, x1, y1, len, prev });

test('podpis jednostki: nazwa kadłuba Terra Nova, klasa po polsku, masa w tonach', () => {
  const bellator = describeSelectedUnit({ friendly: true, callInTemplateKey: 'battleship', type: 'battleship', mass: 50000 });
  assert.equal(bellator.title, 'BELLATOR · PANCERNIK');
  assert.equal(bellator.sub, `MASA ${formatUnitMass(50000)}`);
  assert.match(formatUnitMass(50000), /^50\s000 t$/);
  assert.match(formatUnitMass(1200000), /^1,2 Mt$/);
  assert.equal(formatUnitMass(0), '');
  // Kapitałowe mają własne imię; statek gracza — z katalogu kadłubów.
  assert.equal(describeSelectedUnit({ friendly: true, displayName: 'Citadella', type: 'carrier', mass: 100000 }).title, 'CITADELLA · LOTNISKOWIEC');
  assert.equal(describeSelectedUnit({ mass: 200000 }, { name: 'Atlas', typeKey: 'atlas' }).title, 'ATLAS · SUPERCAPITAL');
  // Pirat nie dostaje imienia kadłuba Terra Nova.
  assert.equal(describeSelectedUnit({ isPirate: true, type: 'destroyer' }).title, 'NISZCZYCIEL');
  assert.equal(unitClassLabel('frigate_laser'), 'FREGATA LASEROWA');
});

test('układ podpisów: sąsiednie ramki nie dostają tego samego miejsca, podpis mieści się w ekranie', () => {
  // Jak Bellator i Hasta obok siebie: domyślny podpis pierwszej ramki (w górę-prawo) przeciąłby drugą.
  const entries = layoutSelectionLabels([
    frame(300, 400, 360, 470),
    frame(380, 380, 420, 420)
  ], 1600, 900);
  assert.ok(entries[0].place && entries[1].place);
  assert.notDeepEqual(entries[0].place, { sx: 1, sy: -1, gap: 10 }, 'pierwszy podpis omija sąsiednią ramkę');
  assert.deepEqual(entries[1].place, { sx: 1, sy: -1, gap: 10 });
});

test('układ podpisów: przy prawej krawędzi podpis idzie w lewo, przy górnej — w dół', () => {
  const [right] = layoutSelectionLabels([frame(1500, 400, 1560, 460)], 1600, 900);
  assert.equal(right.place.sx, -1);
  const [top] = layoutSelectionLabels([frame(700, 20, 760, 70)], 1600, 900);
  assert.equal(top.place.sy, 1);
});

test('układ podpisów: poprzednie miejsce zostaje, dopóki jest wolne; wpis bez podpisu nie dostaje miejsca', () => {
  const prev = { sx: -1, sy: 1, gap: 30 };
  const [kept, silent] = layoutSelectionLabels([frame(700, 400, 760, 460, 150, prev), frame(100, 100, 140, 140, 0)], 1600, 900);
  assert.deepEqual(kept.place, prev);
  assert.equal(silent.place, null);
});
