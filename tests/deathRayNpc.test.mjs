// Promień śmierci na Colossusie Terra Nova (2026-10-20, user: „built-in turret single target — daj go supercapitalovi
// Terran”): uzbrojenie NPC jak w grze (equipNpcWeapons: gniazda z edytora, spec ramy, domyślne uzbrojenie ramy), wieża
// gniazda builtin w autoWeapons (capitalAI.initAutonomousWeapons: `rot` z edytora w stopniach → kurs dziobu, łuk 270°),
// jeden cel — okręt kapitałowy albo niszczyciel (fregaty i myśliwce pomijane), ładowanie 4 s przed strzałem, linia ognia
// z pasem szerokiej wiązki, kąt wieży bez NaN (broń natychmiastowa — getLeadAim bez wyprzedzenia).
// node --test tests/deathRayNpc.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const { SHIPS } = await import('../src/data/ships.js');
const { SHIP_EDITOR_DEFAULTS } = await import('../src/data/hardpointEditorDefaults.js');
const { selectSpecSlots, resolveNpcSpecFrameId } = await import('../src/game/npcWeaponSpec.js');
const { getLeadAim } = await import('../src/ai/aiUtils.js');
const { isFriendlyLineOfFireBlocked } = await import('../src/ai/lineOfFire.js');
const { processAutonomousWeapons } = await import('../src/ai/capitalAI.js');
const { cancelCharge } = await import('../src/game/weaponCharge.js');
const { readIndexHtml } = await import('./helpers/indexSource.mjs');

const DEF = MASTER_WEAPONS.death_ray;
const DT = 0.05;

// Uzbrojenie NPC jak equipNpcWeapons w index.html (loadout frakcji + domyślne uzbrojenie ramy, limit spec ramy,
// broń jednej frakcji — `npcFaction`).
function equipLikeGame(npc, faction) {
  npc.weapons = { main: [], aux: [], missile: [], hangar: [], special: [], special_missile: [], builtin: [] };
  const loadout = faction === 'pirate'
    ? { main: 'armata_mk1', aux: 'ciws_mk1', missile: 'missile_rack' }
    : { main: 'railgun_mk2', aux: 'laser_pd_mk1', missile: 'missile_rack' };
  const frame = resolveNpcSpecFrameId(npc, SHIPS);
  Object.assign(loadout, frame ? SHIPS[frame].defaultNpcLoadout : null);
  const armed = selectSpecSlots(npc.editorHardpoints, frame ? SHIPS[frame].spec : null, Object.keys(loadout));
  for (const hp of npc.editorHardpoints) {
    const id = loadout[hp.type];
    if (!id || !MASTER_WEAPONS[id]) continue;
    const only = MASTER_WEAPONS[id].npcFaction;
    if (only && only !== faction) { hp.mount = null; continue; }
    if (!armed.has(hp)) { hp.mount = null; continue; }
    hp.mount = id;
    npc.weapons[hp.type].push({ hp, weapon: MASTER_WEAPONS[id] });
  }
  return npc;
}

function colossus(opts = {}) {
  const hps = SHIP_EDITOR_DEFAULTS.ships.terran_supercapital.hardpoints.map((h) => ({ ...h, mount: null }));
  const npc = {
    id: 'colossus', type: 'supercapital', x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0,
    friendly: !opts.pirate, isPirate: !!opts.pirate, radius: 500, editorHardpoints: hps
  };
  if (opts.pirate) npc.shipFrame = undefined;
  return equipLikeGame(npc, opts.pirate ? 'pirate' : 'terran');
}

// Sama wieża promienia (reszta uzbrojenia poza testem — działa main strzelałyby do celu obok).
function rayOnly(npc) {
  npc.weapons.main = []; npc.weapons.aux = []; npc.weapons.missile = []; npc.weapons.special = [];
  return npc;
}

function runAI(npc, enemies, seconds, { blocked = false } = {}) {
  const shots = [];
  const charges = [];
  const los = [];
  let clock = 0;
  Object.assign(globalThis.window, {
    npcs: enemies, bullets: [], __npcRocketThreats: [], __playerRocketThreats: [], ship: null,
    wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    getUnitKind: (t) => (t.type === 'frigate' ? 'frigate' : t.type === 'battleship' ? 'battleship' : t.type === 'destroyer' ? 'destroyer' : 'other'),
    hasShipChip: () => false,
    getLeadAim,
    isLineOfFireBlocked: (s, t, range, pad) => { los.push(pad); return blocked; },
    spawnBulletAdapter: (owner, target, def, o) => { shots.push({ t: clock + DT, id: def.id, target, hp: o?.hp }); },
    spawnWeaponChargeFx: (owner, weapon, u) => { charges.push(u); }
  });
  processAutonomousWeapons(npc, DT);
  const w = npc.autoWeapons.find((a) => a.def === DEF);
  if (w) { w.cd = 0; if (w.charge) cancelCharge(w.charge); }
  for (; clock < seconds; clock += DT) processAutonomousWeapons(npc, DT);
  return { shots, charges, los, weapon: w };
}

test('uzbrojenie jak w grze: Colossus Terra Nova ma promień na gnieździe builtin dziobu, piracka rama Colossusa — nie', () => {
  const tn = colossus();
  assert.equal(tn.weapons.builtin.length, 1, 'jedna wieża promienia');
  const lo = tn.weapons.builtin[0];
  assert.equal(lo.weapon, DEF);
  assert.equal(lo.hp.mount, 'death_ray');
  assert.ok(lo.hp.x > 600 && Math.abs(lo.hp.y) < 50, 'gniazdo na dziobie');
  assert.ok(tn.weapons.main.length > 0, 'reszta uzbrojenia ramy bez zmian');
  // piracki „supercapital” bez własnej ramy rozwiązuje się do ramy Colossusa — broń frakcji zostaje u Terra Nova
  const pir = colossus({ pirate: true });
  assert.equal(resolveNpcSpecFrameId(pir, SHIPS), 'terran_supercapital');
  assert.equal(pir.weapons.builtin.length, 0, 'piraci bez promienia');
});

test('AI: wieża builtin w autoWeapons — kurs dziobu z `rot` 90, łuk 270°, jeden cel z pasem linii ognia', () => {
  const npc = rayOnly(colossus());
  const { weapon } = runAI(npc, [], 0.1);
  assert.ok(weapon, 'promień w autoWeapons');
  assert.equal(weapon.group, 'builtin');
  assert.ok(Math.abs(weapon.mountAngle) < 1e-9, `kurs dziobu (${weapon.mountAngle})`);
  assert.ok(weapon.arc > Math.PI * 0.74 && weapon.arc < Math.PI * 0.8, `łuk broni specjalnej (${weapon.arc})`);
  assert.deepEqual(weapon.prefers, ['battleship', 'destroyer']);
  assert.equal(weapon.strict, true);
  assert.equal(weapon.losPad, DEF.deathRay.cutHalfWidth + 60);
});

test('AI: pancernik przed dziobem — 4 s ładowania przy lufie, jeden strzał w cel, wieża celuje bez NaN', () => {
  const npc = rayOnly(colossus());
  const enemy = { type: 'battleship', x: 6000, y: 900, vx: 40, vy: -20, isPirate: true, friendly: false };
  const { shots, charges, los, weapon } = runAI(npc, [enemy], 6);
  assert.equal(shots.length, 1, `jeden strzał (${shots.length})`);
  assert.equal(shots[0].id, 'death_ray');
  assert.equal(shots[0].target, enemy);
  assert.equal(shots[0].hp, weapon.hpOffset, 'wylot z gniazda builtin');
  assert.ok(shots[0].t >= DEF.chargeTime - 1e-9, `po ładowaniu (${shots[0].t})`);
  assert.ok(charges.length >= DEF.chargeTime / DT - 2 && charges.every((u) => u >= 0 && u <= 1), 'efekt ładowania przez hak gry');
  assert.ok(los.length >= 1 && los.every((p) => p === DEF.deathRay.cutHalfWidth + 60), 'linia ognia z pasem wiązki');
  assert.ok(Number.isFinite(weapon.visualAngle), 'kąt wieży skończony (broń natychmiastowa)');
  assert.ok(Math.abs(weapon.visualAngle - Math.atan2(enemy.y, enemy.x - npc.x)) < 0.05, 'wieża na celu');
});

test('AI: fregata nie jest celem promienia (superlaser czeka na okręt kapitałowy albo niszczyciel)', () => {
  const npc = rayOnly(colossus());
  const frigate = { type: 'frigate', x: 4000, y: 0, isPirate: true, friendly: false };
  assert.equal(runAI(npc, [frigate], 6).shots.length, 0, 'fregata pominięta');
  const npc2 = rayOnly(colossus());
  const destroyer = { type: 'destroyer', x: 4000, y: 0, isPirate: true, friendly: false };
  assert.equal(runAI(npc2, [frigate, destroyer], 6).shots[0]?.target, destroyer, 'niszczyciel tak');
});

test('AI: łuk wieży — cel za rufą poza łukiem, cel z boku w łuku; zasłonięta linia ognia wstrzymuje strzał', () => {
  const behind = { type: 'battleship', x: -6000, y: 0, isPirate: true, friendly: false };
  assert.equal(runAI(rayOnly(colossus()), [behind], 6).shots.length, 0, 'za rufą — poza łukiem');
  const side = { type: 'battleship', x: 800, y: 6000, isPirate: true, friendly: false };
  assert.equal(runAI(rayOnly(colossus()), [side], 6).shots.length, 1, 'z boku — w łuku 270°');
  const ahead = { type: 'battleship', x: 6000, y: 0, isPirate: true, friendly: false };
  assert.equal(runAI(rayOnly(colossus()), [ahead], 6, { blocked: true }).shots.length, 0, 'sojusznik na linii — bez strzału');
});

test('linia ognia z pasem: sojusznik przy osi i GRACZ (poza siatką AI) blokują szeroką wiązkę, zwykły pocisk — jak dawniej', () => {
  const shooter = { x: 0, y: 0, friendly: true };
  const target = { x: 6000, y: 0 };
  const ally = { x: 3000, y: 200, radius: 100, friendly: true };
  const grid = (list) => () => ({ buffer: list, count: list.length });
  // sojusznik 200 j. od osi, promień 100: pocisk (pas 15) przechodzi, promień śmierci (pas 115) — nie
  assert.equal(isFriendlyLineOfFireBlocked(shooter, target, 12000, grid([ally]), [], null), false);
  assert.equal(isFriendlyLineOfFireBlocked(shooter, target, 12000, grid([ally]), [], null, 115), true);
  // gracz nie siedzi w siatce AI: szeroka wiązka sprawdza go jawnie, pocisk — bez zmian (jak dawniej)
  const player = { pos: { x: 2500, y: -150 }, radius: 100 };
  assert.equal(isFriendlyLineOfFireBlocked(shooter, target, 12000, grid([]), [], player), false);
  assert.equal(isFriendlyLineOfFireBlocked(shooter, target, 12000, grid([]), [], player, 115), true);
});

test('getLeadAim: broń natychmiastowa (baseSpeed Infinity) celuje w cel bez NaN', () => {
  const out = getLeadAim({ x: 0, y: 0 }, { x: 5000, y: 300, vx: 120, vy: -40 }, Infinity, { x: 0, y: 0 }, { x: 30, y: 0 });
  assert.equal(out.x, 5000);
  assert.equal(out.y, 300);
});

test('index.html: equipNpcWeapons zostawia gniazdo puste dla broni innej frakcji (jak equipLikeGame w tym teście)', () => {
  const html = readIndexHtml().replace(/\r\n/g, '\n');
  const start = html.indexOf('function equipNpcWeapons(npc, faction) {');
  assert.ok(start > 0);
  const body = html.slice(start, html.indexOf('\n    }\n', start));
  assert.match(body, /Object\.assign\(loadout, specFrameId \? SHIPS\[specFrameId\]\.defaultNpcLoadout : null\);/);
  assert.match(body, /const onlyFaction = MASTER_WEAPONS\[weaponId\]\.npcFaction;\n\s*if \(onlyFaction && onlyFaction !== faction\) \{\n\s*hp\.mount = null;\n\s*continue;/);
});
