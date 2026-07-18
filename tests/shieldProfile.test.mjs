import test from 'node:test';
import assert from 'node:assert/strict';

import * as shieldSystem from '../shieldSystem.js';

// Syntetyczny hexGrid: wydłużony kadłub 400x100 (lokalne px, środek w 0,0).
// Shardy co 10px na prostokącie [-200..200] x [-50..50].
function makeElongatedShip(overrides = {}) {
  const shards = [];
  for (let x = -200; x <= 200; x += 10) {
    for (let y = -50; y <= 50; y += 10) {
      shards.push({ lx: x, ly: y, origLx: x, origLy: y, radius: 6 });
    }
  }
  return {
    type: 'destroyer',
    angle: 0,
    x: 0,
    y: 0,
    radius: 210,
    hexGrid: { shards, srcWidth: 400, srcHeight: 100 },
    shield: { max: 5000, val: 5000, state: 'active', activationProgress: 1 },
    ...overrides
  };
}

test('hull shield profile follows the ship silhouette', () => {
  const ship = makeElongatedShip();
  const profile = shieldSystem.getEntityShieldProfile(ship);

  assert.ok(profile, 'statek z hexGrid dostaje profil');
  assert.ok(profile.maxR > 200, 'maxR obejmuje dziób');
  assert.ok(profile.minR >= 50, 'minR obejmuje burtę z padem');

  // Wzdłuż osi (dziób, +x) tarcza sięga dalej niż na burcie (+y).
  const noseR = shieldSystem.getEntityShieldRadiusTowards(ship, 1000, 0);
  const sideR = shieldSystem.getEntityShieldRadiusTowards(ship, 0, 1000);
  assert.ok(noseR > sideR * 1.8, `tarcza wydłużona: nose=${noseR} side=${sideR}`);

  // Obrys przylega: promień burty znacznie mniejszy niż promień obwiedni.
  assert.ok(sideR < profile.maxR * 0.55, 'burta ciasno przy kadłubie');

  // Promień obwiedni (do bramek zgrubnych) = maksimum profilu.
  assert.equal(shieldSystem.getEntityShieldBaseRadius(ship), profile.maxR);
});

test('directional blocking radius rotates with the ship', () => {
  const ship = makeElongatedShip({ angle: Math.PI / 2 }); // dziób "w dół" świata (+y)
  const noseR = shieldSystem.getEntityShieldBlockingRadiusTowards(ship, 0, 1000);
  const sideR = shieldSystem.getEntityShieldBlockingRadiusTowards(ship, 1000, 0);
  assert.ok(noseR > sideR * 1.8, `obrót profilu: nose=${noseR} side=${sideR}`);
});

test('blocking radius scales with activation progress and drops to zero when off', () => {
  const ship = makeElongatedShip();
  const full = shieldSystem.getEntityShieldBlockingRadiusTowards(ship, 1000, 0);

  ship.shield.state = 'activating';
  ship.shield.activationProgress = 0.5;
  const half = shieldSystem.getEntityShieldBlockingRadiusTowards(ship, 1000, 0);
  assert.ok(Math.abs(half - full * 0.5) < 1e-6, 'progress skaluje promień');

  ship.shield.state = 'off';
  ship.shield.activationProgress = 0;
  assert.equal(shieldSystem.getEntityShieldBlockingRadiusTowards(ship, 1000, 0), 0);
});

test('entities without hexGrid keep the circular shield', () => {
  const station = {
    type: 'station',
    radius: 300,
    w: 600,
    h: 600,
    shield: { max: 20000, val: 20000, state: 'active', activationProgress: 1 }
  };
  assert.equal(shieldSystem.getEntityShieldProfile(station), null);
  const base = shieldSystem.getEntityShieldBaseRadius(station);
  assert.equal(base, 600 * 0.5 * 1.15);
  // Kierunkowy promień koła jest identyczny w każdą stronę.
  assert.equal(shieldSystem.getEntityShieldRadiusTowards(station, 1000, 0), base);
  assert.equal(shieldSystem.getEntityShieldRadiusTowards(station, 0, 1000), base);
});

test('impacts store the grid-frame angle for the hull shield visual', () => {
  const ship = makeElongatedShip({ angle: 0.7 });
  // Punkt trafienia: przed dziobem w klatce statku (kierunek angle w świecie).
  const hx = Math.cos(0.7) * 240;
  const hy = Math.sin(0.7) * 240;
  assert.ok(shieldSystem.registerShieldImpact(ship, hx, hy, 100));
  const imp = ship.shield.impacts[0];
  assert.ok(Number.isFinite(imp.gridAngle));
  // W klatce statku trafienie jest na dziobie (kąt ~0).
  assert.ok(Math.abs(imp.gridAngle) < 0.05, `gridAngle=${imp.gridAngle}`);
});

test('player spatial proxy resolves the real entity for profile sampling', () => {
  const ship = makeElongatedShip();
  const proxy = {
    _realEntity: ship,
    get x() { return ship.x; },
    get y() { return ship.y; },
    get shield() { return ship.shield; },
    get hexGrid() { return ship.hexGrid; },
    get angle() { return ship.angle; }
  };
  const direct = shieldSystem.getEntityShieldBlockingRadiusTowards(ship, 1000, 0);
  const viaProxy = shieldSystem.getEntityShieldBlockingRadiusTowards(proxy, 1000, 0);
  assert.equal(viaProxy, direct);
  // Cache profilu wylądował na prawdziwej encji, nie na proxy.
  assert.ok(ship._shieldProfileCache);
});
