import test from 'node:test';
import assert from 'node:assert/strict';

import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';

test('atlas defaults include saved core and bridge markers', () => {
  assert.deepEqual(ATLAS_EDITOR_DEFAULTS.cores, [
    {
      id: 'm_tu1ttof',
      x: -1395.99,
      y: -11.07,
      type: 'core'
    }
  ]);

  assert.deepEqual(ATLAS_EDITOR_DEFAULTS.bridges, [
    {
      id: 'm_cj05w0n',
      x: -673.57,
      y: -7.5,
      type: 'bridge'
    }
  ]);
});

test('ship editor defaults expose atlas critical markers', () => {
  assert.equal(SHIP_EDITOR_DEFAULTS.ships.atlas, ATLAS_EDITOR_DEFAULTS);
  assert.equal(SHIP_EDITOR_DEFAULTS.ships.atlas.cores, ATLAS_EDITOR_DEFAULTS.cores);
  assert.equal(SHIP_EDITOR_DEFAULTS.ships.atlas.bridges, ATLAS_EDITOR_DEFAULTS.bridges);
});

test('capital carrier defaults include core, bridge, and special hardpoints', () => {
  const carrier = SHIP_EDITOR_DEFAULTS.ships.capital_carrier;

  assert.deepEqual(carrier.cores, [
    {
      id: 'm_96zlho9',
      x: 203.87,
      y: -1.33,
      type: 'core'
    }
  ]);

  assert.deepEqual(carrier.bridges, [
    {
      id: 'm_kqzfs4y',
      x: 429.21,
      y: -3.54,
      type: 'bridge'
    }
  ]);

  assert.deepEqual(carrier.hardpoints.slice(-2), [
    {
      id: 'm_gh0qju1',
      type: 'special',
      x: -378.44,
      y: -2.92
    },
    {
      id: 'm_2qhdwsk',
      type: 'special',
      x: -11.27,
      y: -2.92
    }
  ]);
});

test('battleship defaults include updated core, bridge, and special loadout', () => {
  const battleship = SHIP_EDITOR_DEFAULTS.ships.battleship;
  const hardpointById = new Map(battleship.hardpoints.map(hardpoint => [hardpoint.id, hardpoint]));
  const typeCounts = battleship.hardpoints.reduce((counts, hardpoint) => {
    counts[hardpoint.type] = (counts[hardpoint.type] || 0) + 1;
    return counts;
  }, {});

  assert.deepEqual(battleship.cores, [
    {
      id: 'm_u55gg37',
      x: -45.32,
      y: -0.46,
      type: 'core'
    }
  ]);

  assert.deepEqual(battleship.bridges, [
    {
      id: 'm_svnh5ji',
      x: -334.65,
      y: -2.29,
      type: 'bridge'
    }
  ]);

  assert.equal(battleship.hardpoints.length, 33);
  assert.deepEqual(typeCounts, {
    main: 14,
    aux: 15,
    missile: 2,
    special: 2
  });

  assert.deepEqual(hardpointById.get('m_ary5h8q'), {
    id: 'm_ary5h8q',
    type: 'special',
    x: -191.61,
    y: -108.17
  });
  assert.deepEqual(hardpointById.get('m_s6fjaq6'), {
    id: 'm_s6fjaq6',
    type: 'special',
    x: -192.35,
    y: 107.43
  });
  assert.deepEqual(hardpointById.get('m_m0yjrki'), {
    id: 'm_m0yjrki',
    type: 'aux',
    x: 218.24,
    y: -99.85
  });
  assert.deepEqual(hardpointById.get('m_7qszf05'), {
    id: 'm_7qszf05',
    type: 'main',
    x: -55.39,
    y: 220.2
  });

  assert.equal(hardpointById.has('m_dg1aaif'), false);
  assert.equal(hardpointById.has('m_4tql3dt'), false);
});

test('destroyer defaults include updated hardpoints, critical markers, and engines', () => {
  const destroyer = SHIP_EDITOR_DEFAULTS.ships.destroyer;

  assert.deepEqual(destroyer.hardpoints, [
    { id: 'm_8tmolwi', type: 'main', x: -72, y: 0 },
    { id: 'm_jmpm0j1', type: 'main', x: 24, y: 0 },
    { id: 'm_ce3tghi', type: 'main', x: 72, y: 0 },
    { id: 'm_e2xjoug', type: 'main', x: 120, y: 0 },
    { id: 'm_48n08vv', type: 'main', x: 209.78, y: -48.86 },
    { id: 'm_h5s6zbl', type: 'main', x: 209.78, y: 48.86 },
    { id: 'm_6hsjkvx', type: 'main', x: 170.1, y: -70.17 },
    { id: 'm_joaxj0t', type: 'main', x: 170.1, y: 70.17 },
    { id: 'm_968kch9', type: 'main', x: -219.33, y: -132.63 },
    { id: 'm_561qyq9', type: 'main', x: -219.33, y: 132.63 },
    { id: 'm_cnz2dkk', type: 'aux', x: 54.01, y: -62.82 },
    { id: 'm_d0nuu7t', type: 'aux', x: 54.01, y: 62.82 },
    { id: 'm_2jkl9k3', type: 'aux', x: -9.92, y: -64.29 },
    { id: 'm_fx19i40', type: 'aux', x: -9.92, y: 64.29 },
    { id: 'm_dcmocll', type: 'aux', x: -73.85, y: -65.03 },
    { id: 'm_i0mo0bt', type: 'aux', x: -73.85, y: 65.03 },
    { id: 'm_pt9im4a', type: 'aux', x: 239.91, y: -40.05 },
    { id: 'm_s9mnwpa', type: 'aux', x: 239.91, y: 40.05 },
    { id: 'm_qklgylk', type: 'aux', x: 282.52, y: -33.43 },
    { id: 'm_mxjvtil', type: 'aux', x: 282.52, y: 33.43 },
    { id: 'm_q26e5fg', type: 'aux', x: -189.94, y: -164.96 },
    { id: 'm_qgwm63i', type: 'aux', x: -189.94, y: 164.96 },
    { id: 'm_yia8ss1', type: 'aux', x: -250.19, y: -165.69 },
    { id: 'm_xt1y5p3', type: 'aux', x: -250.19, y: 165.69 }
  ]);

  assert.deepEqual(destroyer.cores, [
    { id: 'm_df32rmj', x: -207.58, y: -0.37, type: 'core' }
  ]);

  assert.deepEqual(destroyer.bridges, [
    { id: 'm_xy7diev', x: -134.1, y: -1.84, type: 'bridge' }
  ]);

  assert.deepEqual(destroyer.engines.main, [
    {
      id: 'm_lh0syhx',
      x: -283.99,
      y: -128.95,
      deg: 90,
      offsetX: 0,
      offsetY: 0,
      mount: 'rear_left',
      gimbalMinDeg: -45,
      gimbalMaxDeg: 45,
      vfxLengthMin: 10,
      vfxLengthMax: 179
    },
    {
      id: 'm_vip1ske',
      x: -287.67,
      y: -72.38,
      deg: 90,
      offsetX: 0,
      offsetY: 0,
      mount: 'rear_left',
      gimbalMinDeg: -45,
      gimbalMaxDeg: 45,
      vfxLengthMin: 10,
      vfxLengthMax: 179
    },
    {
      id: 'm_zxbc4q9',
      x: -287.67,
      y: 70.17,
      deg: 90,
      offsetX: 0,
      offsetY: 0,
      mount: 'rear_right',
      gimbalMinDeg: -45,
      gimbalMaxDeg: 45,
      vfxLengthMin: 10,
      vfxLengthMax: 179
    },
    {
      id: 'm_adz80t3',
      x: -278.12,
      y: 130.42,
      deg: 90,
      offsetX: 0,
      offsetY: 0,
      mount: 'rear_right',
      gimbalMinDeg: -45,
      gimbalMaxDeg: 45,
      vfxLengthMin: 10,
      vfxLengthMax: 179
    }
  ]);

  assert.deepEqual(destroyer.engines.side, [
    {
      id: 'm_w3ccjzv',
      x: 134.1,
      y: 73.85,
      deg: 0,
      offsetX: 0,
      offsetY: 0,
      mount: 'upper_right',
      gimbalMinDeg: -90,
      gimbalMaxDeg: 90,
      vfxWidthMin: 25,
      vfxWidthMax: 227,
      vfxLengthMin: 49,
      vfxLengthMax: 354
    },
    {
      id: 'm_j4fzky6',
      x: 132.63,
      y: -78.99,
      deg: 180,
      offsetX: 0,
      offsetY: 0,
      mount: 'upper_left',
      gimbalMinDeg: -90,
      gimbalMaxDeg: 90,
      vfxWidthMin: 25,
      vfxWidthMax: 227,
      vfxLengthMin: 49,
      vfxLengthMax: 354
    }
  ]);
});

test('frigate defaults include critical markers and remove the center aux hardpoint', () => {
  const frigate = SHIP_EDITOR_DEFAULTS.ships.frigate;
  const hardpointById = new Map(frigate.hardpoints.map(hardpoint => [hardpoint.id, hardpoint]));
  const typeCounts = frigate.hardpoints.reduce((counts, hardpoint) => {
    counts[hardpoint.type] = (counts[hardpoint.type] || 0) + 1;
    return counts;
  }, {});

  assert.deepEqual(frigate.cores, [
    {
      id: 'm_2m1ecvu',
      x: -645.84,
      y: -0.93,
      type: 'core'
    }
  ]);

  assert.deepEqual(frigate.bridges, [
    {
      id: 'm_8ilkhej',
      x: -429.02,
      y: 0.93,
      type: 'bridge'
    }
  ]);

  assert.equal(frigate.hardpoints.length, 23);
  assert.deepEqual(typeCounts, {
    main: 4,
    aux: 19
  });
  assert.equal(hardpointById.has('m_hgurjs5'), false);
  assert.deepEqual(hardpointById.get('m_0ioixun'), {
    id: 'm_0ioixun',
    type: 'aux',
    x: -680,
    y: 400
  });
});
