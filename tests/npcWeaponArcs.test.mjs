import test from 'node:test';
import assert from 'node:assert/strict';

// Łuki dział NPC i kurs bojowy (src/ai/capitalAI.js): ten sam model łuków co
// u gracza (src/game/weaponAim.js, mountFireArc — 180° od normalnej obrysu
// kadłuba w miejscu gniazda). Dawniej każde gniazdo poza osią kadłuba było
// działem burtowym (±90°, łuk ±0,55 rad): NPC nie strzelały do przodu i stawały
// burtą do celu — także w locie.
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
globalThis.window = globalThis.window || {};
Object.assign(globalThis.window, {
  wrapAngle,
  applySeparationForces: () => ({ ax: 0, ay: 0 }),
  queryAIGrid: () => ({ buffer: [], count: 0 }),
  ship: null,
  __frameId: 1,
  bullets: [],
  __npcRocketThreats: [],
  __playerRocketThreats: [],
  getUnitKind: () => 'battleship',
  spawnBulletAdapter: () => {},
  isLineOfFireBlocked: () => false
});

const { aiBattleship, processAutonomousWeapons, resolveWeaponFacingBias } = await import('../src/ai/capitalAI.js');
const { stepShipFlight } = await import('../src/game/flight/shipFlightModel.js');
const { SHIP_EDITOR_DEFAULTS } = await import('../src/data/hardpointEditorDefaults.js');
const { SHIPS } = await import('../src/data/ships.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const { selectSpecSlots, resolveNpcSpecFrameId } = await import('../src/game/npcWeaponSpec.js');

// NPC uzbrojony jak w grze (equipNpcWeapons): gniazda z edytora, liczba dział ze spec ramy.
function armedNpc(type, editorId, pirate) {
  const hps = SHIP_EDITOR_DEFAULTS.ships[editorId].hardpoints.map(h => ({ ...h, mount: null }));
  const npc = {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mission: true, type,
    shipFrame: (pirate ? 'pirate_' : 'terran_') + (type === 'frigate_pd' ? 'frigate' : type),
    isPirate: pirate, friendly: !pirate, radius: 300,
    hp: 5000, maxHp: 5000, shield: { val: 5000, max: 5000 },
    editorHardpoints: hps
  };
  const frame = resolveNpcSpecFrameId(npc, SHIPS);
  const armed = selectSpecSlots(hps, frame ? SHIPS[frame].spec : null, ['main']);
  const wid = pirate ? 'armata_mk1' : 'railgun_mk2';
  npc.weapons = { main: [], aux: [], missile: [] };
  for (const hp of hps) {
    if (hp.type !== 'main' || !armed.has(hp)) continue;
    hp.mount = wid;
    npc.weapons.main.push({ hp, weapon: MASTER_WEAPONS[wid] });
  }
  processAutonomousWeapons(npc, 0);
  return npc;
}

const HULLS = [
  ['frigate_pd', 'frigate', false],
  ['frigate_pd', 'pirate_frigate', true],
  ['destroyer', 'destroyer', false],
  ['destroyer', 'pirate_destroyer', true],
  ['battleship', 'battleship', false],
  ['battleship', 'pirate_battleship', true],
  ['carrier', 'terran_carrier', false],
  ['supercapital', 'terran_supercapital', false]
];

test('NPC main guns get 180° arcs centred on the hull outline and the fleet fights bow-on', () => {
  for (const [type, editorId, pirate] of HULLS) {
    const npc = armedNpc(type, editorId, pirate);
    const mains = npc.autoWeapons.filter(w => w.group === 'main');
    assert.ok(mains.length > 0, `${editorId}: brak dział`);
    for (const w of mains) {
      assert.ok(w.arc >= Math.PI / 2, `${editorId}: łuk ${w.arc.toFixed(2)} rad — znowu wąska burta`);
      // Środek łuku co 45° (burta, dziób, rufa, ukos).
      const steps = w.mountAngle / (Math.PI / 4);
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${editorId}: środek łuku poza siatką 45°`);
    }
    assert.ok(Math.abs(resolveWeaponFacingBias(npc)) < 1e-9, `${editorId}: kurs bojowy nie dziobem do celu`);
  }
});

test('a ship whose guns cannot reach ahead turns them to the target', () => {
  // Oba działa na rufowej ćwiartce jednej burty (łuk ±97° od 135°): cel na
  // wprost jest poza łukiem, więc okręt ustawia się tą ćwiartką do celu.
  const npc = {
    x: 0, y: 0, angle: 0, type: 'battleship', shipFrame: 'terran_battleship', friendly: true,
    editorHardpoints: [
      { type: 'main', x: -380, y: 150, mount: 'railgun_mk2' },
      { type: 'main', x: -390, y: 120, mount: 'railgun_mk2' },
      { type: 'aux', x: 400, y: 0 },
      { type: 'aux', x: -400, y: -200 }
    ]
  };
  npc.weapons = {
    main: npc.editorHardpoints.filter(h => h.type === 'main').map(hp => ({ hp, weapon: MASTER_WEAPONS.railgun_mk2 })),
    aux: [],
    missile: []
  };
  processAutonomousWeapons(npc, 0);
  const bias = resolveWeaponFacingBias(npc);
  assert.ok(bias > 0.5 && bias < Math.PI, `kąt celu od dziobu ${bias.toFixed(2)} rad`);
});

test('an armed battleship faces its target bow-on instead of turning broadside', () => {
  const npc = armedNpc('battleship', 'battleship', false);
  npc.x = -9000;
  const target = { x: 0, y: 3000, vx: 0, vy: 0, radius: 220, angle: 0 };
  window.aiPickTarget = () => target;
  let brainT = 0;
  for (let i = 0; i < 120 * 40; i++) {
    window.__frameId++;
    brainT -= 1 / 120;
    if (brainT <= 0) {
      brainT += 1 / 20;
      aiBattleship(null, npc, 1 / 20);
    }
    stepShipFlight(npc, 1 / 120);
  }
  const toTarget = Math.atan2(target.y - npc.y, target.x - npc.x);
  const err = Math.abs(wrapAngle(toTarget - npc.angle));
  assert.ok(err < 0.35, `kadłub ${(err * 57.3).toFixed(0)}° od celu (burta = ~90°)`);
});
