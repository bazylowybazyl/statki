// Efekty mechaniki broni w WeaponFx (zadanie 18-B): rzaz, wyjście za burtą i zakleszczenie z
// receptur rodziny (Mjolnir, Valkyrie), gęstość rzazu jak w demie (najwyżej jeden znak na
// podkrok 240 Hz — co v/240 j.), rykoszet tylko z decyzji gry (hit.ric — obraz z tego samego
// hasha, bez losowania decyzji w recepturze), smuga pocisku przebijającego nie kończy się na
// wejściu. Bez Math.random gry.
// node --test tests/weaponFxPierce.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Core3D } from '../src/3d/core3d.js';
import { FxFrame } from '../src/3d/fx/fxFrame.js';
import { WeaponFx, KERF_PER_CALL, RICOCHET_CAP } from '../src/3d/weapons/weaponFx.js';

Core3D.isInitialized = true;
Core3D.scene = new THREE.Scene();
Core3D.fx = Core3D.fx || new FxFrame();
assert.ok(WeaponFx.ensure());
globalThis.window = Object.assign(globalThis.window || {}, { camera: { shakeMag: 0, shakeTime: 0, shakeDur: 0, zoom: 1, addShake() {} } });

const bullet = (vfxKey, type, extra = {}) => ({ vfxKey, type, weaponSize: 'Capital', owner: 'player', vx: 1000, vy: 0, ivx: 0, ivy: 0, ...extra });
const stat = (k) => WeaponFx.stats[k];

function noRandom(fn) {
  const r = Math.random;
  Math.random = () => { throw new Error('Math.random w efektach mechaniki'); };
  try { return fn(); } finally { Math.random = r; }
}

test('rzaz: co k-ty znak mechaniki jak w demie (Mjolnir ~104 j., Valkyrie ~66 j.), wolny pocisk — każdy', () => {
  noRandom(() => {
    const cases = [
      ['siege_railgun', 25000, 9, 2],        // 22 j. × 9 = 198 j. drogi → co 5. znak
      ['special_valkyrie_railgun', 15000, 9, 3],
      ['special_valkyrie_railgun', 3000, 9, 9],
      ['siege_railgun', 25000, 1, 1],          // cienka burta: jeden znak
      ['siege_railgun', 4000, 40, KERF_PER_CALL]
    ];
    for (const [id, speed, count, want] of cases) {
      const k0 = stat('kerfs');
      assert.equal(WeaponFx.kerf(bullet(id, 'rail'), 0, 0, 22, 0, count, speed, 0, null), true);
      assert.equal(stat('kerfs') - k0, want, `${id} ${speed} j/s, ${count} znaków`);
    }
    // Rodzina bez rzazu (Vulcan) — nic.
    assert.equal(WeaponFx.kerf(bullet('vulcan_minigun', 'autocannon'), 0, 0, 22, 0, 5, 4000, 0, null), false);
  });
  WeaponFx.reset();
});

test('rzaz w efekcie bez stempla mapy ran: pas rzazu stempluje gra (stampKerf), receptura dostaje kadłub null', async () => {
  const { HullDamageMap } = await import('../src/3d/hullDamageMap.js');
  const orig = HullDamageMap.stampRecipe;
  let withHull = 0;
  HullDamageMap.stampRecipe = (e) => { if (e) withHull++; return false; };
  try {
    const k0 = stat('kerfs');
    const hull = { beamHull: { dmgKey: 1 } };
    assert.equal(WeaponFx.kerf(bullet('siege_railgun', 'rail'), 0, 0, 22, 0, 9, 25000, 0, hull), true);
    assert.equal(WeaponFx.kerf(bullet('special_valkyrie_railgun', 'rail'), 0, 0, 22, 0, 9, 3000, 0, hull), true);
    assert.ok(stat('kerfs') - k0 > 0, 'efekty rzazu są');
    assert.equal(withHull, 0, 'bez drugiego stempla rzazu z receptury');
  } finally { HullDamageMap.stampRecipe = orig; }
  WeaponFx.reset();
});

test('wyjście i zakleszczenie: receptury rodziny (Valkyrie ma `stuck`, Mjolnir — trafienie w środku)', () => {
  noRandom(() => {
    const e0 = stat('exits'); const s0 = stat('stuck');
    assert.equal(WeaponFx.pierceExit(bullet('siege_railgun', 'rail'), 0, 0, 25000, 0, null), true);
    assert.equal(WeaponFx.pierceExit(bullet('special_valkyrie_railgun', 'rail'), 0, 0, 15000, 0, null), true);
    assert.equal(stat('exits') - e0, 2);
    const vk = bullet('special_valkyrie_railgun', 'rail');
    vk.__fx = { bullet: vk, endSet: false, endX: 0, endY: 0 };
    assert.equal(WeaponFx.pierceStuck(vk, 120, 40, 12000, 0, null), true);
    assert.deepEqual([vk.__fx.endSet, vk.__fx.endX, vk.__fx.endY], [true, 120, 40], 'smuga kończy się w punkcie zakleszczenia');
    assert.equal(WeaponFx.pierceStuck(bullet('siege_railgun', 'rail'), 0, 0, 300, 0, null), true, 'bez `stuck` — trafienie rodziny');
    assert.equal(stat('stuck') - s0, 2);
    assert.equal(WeaponFx.pierceExit(bullet('vulcan_minigun', 'autocannon'), 0, 0, 4000, 0, null), false, 'Vulcan nie przebija');
  });
  WeaponFx.reset();
});

test('trafienie pocisku przebijającego: smuga leci dalej (hit.through), zwykłe trafienie kończy smugę', () => {
  const hit = { x: 5, y: 6, nx: -1, ny: 0, entity: null, relVx: 25000, relVy: 0, kind: 'hull', through: true, ric: false };
  const b = bullet('siege_railgun', 'rail', { vx: 25000 });
  b.__fx = { bullet: b, endSet: false, endX: 0, endY: 0 };
  noRandom(() => WeaponFx.impact(b, 5, 6, 1, hit));
  assert.equal(b.__fx.endSet, false);
  hit.through = false;
  noRandom(() => WeaponFx.impact(b, 5, 6, 1, hit));
  assert.deepEqual([b.__fx.endSet, b.__fx.endX, b.__fx.endY], [true, 5, 6]);
  WeaponFx.reset();
});

test('rykoszet Vulcana tylko z decyzji gry: hit.ric → smugowiec z kierunkiem i prędkością z hasha; bez — nic', () => {
  const hit = { x: 0, y: 0, nx: 0, ny: -1, entity: null, relVx: 4000, relVy: 400, kind: 'hull', through: false, ric: false };
  const b = bullet('vulcan_minigun', 'autocannon', { weaponSize: 'M', vx: 4000, vy: 400 });
  const r0 = stat('ricochets');
  // Płaski kąt, ale gra nie rozstrzygnęła rykoszetu — receptura już nie losuje własnego.
  for (let k = 0; k < 50; k++) noRandom(() => WeaponFx.impact(b, 0, 0, 1, hit));
  assert.equal(stat('ricochets') - r0, 0, 'bez hit.ric bez smugowca');
  Object.assign(hit, { ric: true, ricDirX: 0.8, ricDirY: -0.6, ricSpeed: 1800, ricLife: 0.3 });
  WeaponFx._impactBudget = 48;   // nowa klatka (budżet pełnych trafień — sync())
  const head = WeaponFx._ricHead;
  noRandom(() => WeaponFx.impact(b, 0, 0, 1, hit));
  assert.equal(stat('ricochets') - r0, 1);
  const R = WeaponFx._ricochets[head];
  assert.ok(R.active);
  assert.ok(Math.abs(R.vx - 0.8 * 1800) < 1e-9 && Math.abs(R.vy + 0.6 * 1800) < 1e-9, 'kierunek i prędkość z decyzji gry');
  assert.equal(R.life, 0.3);
  assert.ok(WeaponFx._ricochets.length === RICOCHET_CAP);
  WeaponFx.reset();
});
