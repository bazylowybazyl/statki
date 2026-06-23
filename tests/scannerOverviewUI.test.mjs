import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLockedTargetLogModel,
  createScannerOverviewModel,
  getPanelCollapseLabel,
  resolveScannerLayout,
  updateScannerFilters
} from '../src/ui/scannerOverviewUI.js';

test('scanner overview model exposes selected contact details', () => {
  const target = { id: 'ast-1' };
  const model = createScannerOverviewModel({
    contacts: [{ target, type: 'asteroid', tone: 'resource', distance: 1200, label: 'AST-0001 Iron', classLabel: 'BIG' }],
    selectedTarget: target,
    lockedTargets: [target]
  });
  assert.equal(model.rows[0].selected, true);
  assert.equal(model.rows[0].locked, true);
  assert.equal(model.rows[0].distanceLabel, '1.2k');
});

test('scanner overview rows keep a stable key while distance changes', () => {
  const target = { id: 'ast-1' };
  const first = createScannerOverviewModel({
    contacts: [{ target, type: 'asteroid', tone: 'resource', distance: 1200, label: 'Crystal Asteroid', classLabel: 'M' }]
  });
  const next = createScannerOverviewModel({
    contacts: [{ target, type: 'asteroid', tone: 'resource', distance: 1300, label: 'Crystal Asteroid', classLabel: 'M' }]
  });
  assert.equal(typeof first.rows[0].key, 'string');
  assert.ok(first.rows[0].key.length > 0);
  assert.equal(first.rows[0].key, next.rows[0].key);
});

test('scanner overview uses class icons instead of visible ship class text', () => {
  const target = { id: 'pir-1' };
  const model = createScannerOverviewModel({
    contacts: [{ target, type: 'ship', tone: 'hostile', distance: 900, label: 'PIR-0001', classLabel: 'KRAZOWNIK' }]
  });
  assert.equal(model.rows[0].classIcon, 'cruiser');
  assert.equal(model.rows[0].classTitle, 'KRAZOWNIK');
  assert.equal(model.rows[0].classDisplay, '');
});

test('scanner filters can hide asteroids without mutating previous state', () => {
  const current = { all: true, hostile: true, asteroid: true, station: true, friendly: true };
  const next = updateScannerFilters(current, 'asteroid');
  assert.equal(current.asteroid, true);
  assert.equal(next.asteroid, false);
  assert.equal(next.all, false);
});

test('scanner layout resolves fixed and floating defaults', () => {
  assert.equal(resolveScannerLayout({ mode: 'floating' }).mode, 'floating');
  assert.equal(resolveScannerLayout({ mode: 'nonsense' }).mode, 'fixed');
});

test('scanner collapse toggle exposes an expand label when panel is closed', () => {
  assert.equal(getPanelCollapseLabel(false), 'COLLAPSE');
  assert.equal(getPanelCollapseLabel(true), 'EXPAND');
});

test('locked target log model stacks multiple selected targets', () => {
  const cruiser = { id: 'pir-1' };
  const asteroid = { id: 'ast-1' };
  const model = createLockedTargetLogModel({
    lockedTargets: [cruiser, asteroid],
    contacts: [
      { target: cruiser, type: 'ship', tone: 'hostile', label: 'PIR-0001', classLabel: 'KRAZOWNIK' },
      { target: asteroid, type: 'asteroid', tone: 'resource', label: 'Crystal Asteroid', classLabel: 'M' }
    ]
  });

  assert.deepEqual(model.rows.map(row => row.label), ['PIR-0001', 'Crystal Asteroid']);
  assert.equal(model.rows[0].indexLabel, '01');
  assert.equal(model.rows[0].classIcon, 'cruiser');
  assert.equal(model.rows[0].classDisplay, '');
  assert.equal(model.rows[1].indexLabel, '02');
  assert.equal(model.rows[1].classIcon, '');
  assert.equal(model.rows[1].classDisplay, 'M');
});
