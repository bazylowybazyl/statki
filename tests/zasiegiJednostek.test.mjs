// Zasięgi czujników KAŻDEJ jednostki (audyt 2026-11-11, docs/AUDYT-zasiegi-jednostek-2026-11-11.md, reguła
// zasieg-czujnikow): każdy kadłub i rodzaj jednostki z tabel i z miejsc tworzenia ma jawny profil czujników (KONTAKT),
// jawną wykrywalność (sygnatura) i jawny wzrok (IDENTYFIKACJA) — bez gałęzi awaryjnych (`fallbackSensorProfile` z typu,
// kubełki promienia, wzrok fregaty dla bytu bez klasy). Jedyny wyjątek: SIGNATURE_PENDING_DECISION (decyzja D1).
// Uzupełnienia nie zmieniają rozgrywki: moc z tabeli jednostek = dawny wynik awaryjny z typu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { SHIPS, SHIP_SENSOR_PROFILES, SUPPORT_SHIP_TEMPLATES, CAPITAL_SHIP_TEMPLATES } = await import('../src/data/ships.js');
const { TRAFFIC_HULLS } = await import('../src/data/trafficHulls.js');
const { TRAFFIC_COMBAT_HULLS } = await import('../src/game/trafficPromotion.js');
const U = await import('../src/data/sensorUnits.js');
const { resolveAwarenessSensorRange, unitSensorProfile } = await import('../src/ai/fleetAwareness.js');
const { getEntitySizeModifier, signatureSourceOf, SENSOR_CONFIG } = await import('../src/game/sensorSystem.js');
const { visionRangeOf, FOG_TUNE } = await import('../src/game/fogOfWar.js');
const { sensorStrengthSourceOf, visionSourceOf } = await import('../src/game/sensorUnitAudit.js');
const { SENSOR_PICTURE_TUNE } = await import('../src/game/sensorPicture.js');
const { shipRangeClassOf } = await import('../src/data/shipRanges.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const pos = (v) => Number.isFinite(v) && v > 0;

// Kadłuby dev / awansu ruchu (DEV_HULL_SPAWNS w index.html — klucz → kadłub i typ).
function devHullSpawns() {
  const src = read('index.html');
  const block = src.slice(src.indexOf('const DEV_HULL_SPAWNS = Object.freeze({'), src.indexOf('function spawnDevHull('));
  const out = [];
  for (const m of block.matchAll(/^\s*'?([\w-]+)'?: \{ hull: '(\w+)'(?:, type: '([\w-]+)')?/gm)) out.push({ key: m[1], hull: m[2], type: m[3] || m[2] });
  return out;
}

// Kształty bytów z miejsc tworzenia (audyt, tabela „Miejsca tworzenia”): pola, które czytają czujniki.
function spawnShapes() {
  const S = [];
  const prof = (k) => ({ ...SHIP_SENSOR_PROFILES[k] });
  // gracz (createShipEntity: isCapitalShip zawsze; sensors z kadłuba) — każdy kadłub gracza
  for (const [id, hull] of Object.entries(SHIPS)) S.push({ name: `gracz:${id}`, e: { isPlayer: true, isCapitalShip: true, activeHullId: id, shipFrame: id, sensors: hull.sensors ? { ...hull.sensors } : undefined } });
  // wezwania (spawnSupportShip): myśliwce, fregaty, niszczyciel i pancerniki (isCapitalShip z konfiguratora)
  for (const [key, t] of Object.entries(SUPPORT_SHIP_TEMPLATES)) {
    const fighterKey = /fighter|interceptor|bomber|gunship/.test(key);
    const type = fighterKey ? (key === 'interceptor' ? 'interceptor' : 'fighter') : (key === 'pirate_battleship' ? 'battleship' : key);
    const cap = type === 'destroyer' || type === 'battleship';
    S.push({ name: `wezwanie:${key}`, e: { type, fighter: fighterKey || undefined, isCapitalShip: cap || undefined, sensors: t.sensors ? { ...t.sensors } : undefined, shipFrame: fighterKey ? undefined : `pirate_${type === 'frigate_pd' || type === 'frigate_laser' ? 'frigate' : type}`, radius: 45 } });
  }
  // okręty kapitałowe (createCapitalShipEntry), w tym Colossus (supercapital) i moduły megafrachtowca
  const frames = { carrier: 'terran_carrier', supercapital: 'terran_supercapital', pirate_supercapital: 'pirate_supercapital', atlas: 'atlas', megafreighter: 'megafreighter' };
  for (const [key, t] of Object.entries(CAPITAL_SHIP_TEMPLATES)) S.push({ name: `kapital:${key}`, e: { type: key === 'megafreighter' ? 'megafreighter_wagon' : key, isCapitalShip: true, shipFrame: frames[key], sensors: t.sensors ? { ...t.sensors } : undefined } });
  // bez kopii profilu: myśliwce z hangaru NPC i gracza, drony bazy piratów, spawnPirate
  S.push({ name: 'mysliwiec-hangar', e: { type: 'fighter', fighter: true, radius: 12, playerOwned: true } });
  S.push({ name: 'przechwytujacy-hangar', e: { type: 'interceptor', fighter: true, radius: 12 } });
  for (const t of ['frigate_pd', 'frigate_laser']) S.push({ name: `spawnPirate:${t}`, e: { type: t, shipFrame: 'pirate_frigate', radius: 45 } });
  for (const t of ['destroyer', 'battleship']) S.push({ name: `spawnPirate:${t}`, e: { type: t, shipFrame: `pirate_${t}`, isCapitalShip: true } });
  // fregata zwiadu z ładowni (jawny wzrok 10 km, rola radaru)
  S.push({ name: 'fregata-zwiadu', e: { type: 'frigate_pd', shipFrame: 'terran_frigate', friendly: true, sensors: { ...prof('frigate_combat'), role: 'radar', visionRange: 10000 } } });
  // holownik serwisowy
  S.push({ name: 'holownik', e: { type: 'service_tug', shipFrame: 'service_tug', radius: 912, friendly: true } });
  // awans ruchu v2: okręty (typ klasy, profil z szablonu) i cywile (typ z DEV_HULL_SPAWNS albo kadłub)
  const dev = new Map(devHullSpawns().map((d) => [d.hull, d]));
  for (const id of Object.keys(TRAFFIC_HULLS)) {
    const role = TRAFFIC_COMBAT_HULLS[id];
    const tpl = role ? SUPPORT_SHIP_TEMPLATES[role.template] || CAPITAL_SHIP_TEMPLATES[role.template] : null;
    S.push({ name: `awans:${id}`, e: { type: role?.type || dev.get(id)?.type || id, shipFrame: id, sensors: tpl?.sensors ? { ...tpl.sensors } : undefined, radius: 30 } });
  }
  // kadłuby dev (spawnDevHull)
  for (const d of devHullSpawns()) S.push({ name: `dev:${d.key}`, e: { type: d.type, shipFrame: d.hull, radius: 30 } });
  return S;
}

test('każdy kadłub z SHIPS i szablon okrętu ma jawny profil czujników i klasę wzroku', () => {
  for (const [id, hull] of Object.entries(SHIPS)) {
    assert.ok(pos(hull.sensors?.passiveRange) && pos(hull.sensors?.activeRange), `${id}: profil czujników`);
    assert.ok(shipRangeClassOf(id), `${id}: klasa wzroku`);
  }
  for (const [id, t] of Object.entries({ ...SUPPORT_SHIP_TEMPLATES, ...CAPITAL_SHIP_TEMPLATES })) {
    assert.ok(pos(t.sensors?.passiveRange), `${id}: profil czujników szablonu`);
  }
});

test('każdy kadłub ruchu v2 ma profil czujników, wykrywalność i klasę wzroku (kadłub albo tabela jednostek)', () => {
  for (const id of Object.keys(TRAFFIC_HULLS)) {
    assert.ok(SHIPS[id]?.sensors || U.SENSOR_PROFILE_BY_UNIT[id], `${id}: profil czujników`);
    assert.ok(shipRangeClassOf(id), `${id}: klasa wzroku`);
    if (!SHIPS[id] && !TRAFFIC_COMBAT_HULLS[id]) assert.ok(pos(U.SENSOR_SIGNATURE_BY_UNIT[id]), `${id}: wykrywalność`);
  }
  for (const key of Object.values(U.SENSOR_PROFILE_BY_UNIT)) assert.ok(SHIP_SENSOR_PROFILES[key], `profil ${key} istnieje`);
});

test('każdy rodzaj jednostki z miejsc tworzenia: moc, sygnatura i wzrok jawne, dodatnie i skończone', () => {
  const pending = new Set(U.SIGNATURE_PENDING_DECISION);
  const shapes = spawnShapes();
  assert.ok(shapes.length > 60);
  for (const { name, e } of shapes) {
    const moc = sensorStrengthSourceOf(e);
    const syg = signatureSourceOf(e);
    const wzrok = visionSourceOf(e);
    assert.notEqual(moc, 'awaryjna', `${name}: moc z gałęzi awaryjnej`);
    assert.notEqual(wzrok, 'awaryjna', `${name}: wzrok z gałęzi awaryjnej`);
    if (pending.has(String(e.type))) assert.ok(syg.startsWith('promien:'), `${name}: wyjątek D1 zostaje na kubełkach (do decyzji)`);
    else assert.ok(!syg.startsWith('promien:'), `${name}: sygnatura z kubełków promienia (${syg})`);
    assert.ok(pos(resolveAwarenessSensorRange({ ...e })), `${name}: moc`);
    assert.ok(pos(getEntitySizeModifier(e)), `${name}: sygnatura`);
    assert.ok(pos(visionRangeOf(e)), `${name}: wzrok`);
  }
});

test('tabela jednostek nie zmienia rozgrywki: moc = dawny profil awaryjny z typu', () => {
  // dawna gałąź awaryjna fleetAwareness.js (przed 2026-11-11), słowo w słowo
  const FIGHTER_TYPE_RE = /fighter|interceptor|bomber|drone/;
  const old = (e) => {
    const type = String(e?.type || '').toLowerCase();
    if (e?.fighter || FIGHTER_TYPE_RE.test(type)) return SHIP_SENSOR_PROFILES.fighter_combat;
    if (type.includes('frigate')) return SHIP_SENSOR_PROFILES.frigate_combat;
    if (type === 'destroyer') return SHIP_SENSOR_PROFILES.destroyer_combat;
    if (type.includes('battleship')) return SHIP_SENSOR_PROFILES.battleship_combat;
    if (type === 'atlas') return SHIP_SENSOR_PROFILES.atlas_combat;
    if (e?.isCapitalShip || type.includes('carrier') || type.includes('supercapital')) return SHIP_SENSOR_PROFILES.capital_combat;
    return SHIP_SENSOR_PROFILES.frigate_combat;
  };
  for (const { name, e } of spawnShapes()) {
    if (e.sensors) continue;
    assert.equal(resolveAwarenessSensorRange({ ...e }), old(e).passiveRange, `${name}: moc bez zmian`);
    assert.equal(unitSensorProfile(e)?.passiveRange, old(e).passiveRange, `${name}: profil jednostki = dawny`);
  }
  // wzrok kadłubów cywilnych w klasie fregaty = dawny wzrok awaryjny (fregata)
  for (const id of Object.keys(TRAFFIC_HULLS)) {
    if (SHIPS[id] || TRAFFIC_COMBAT_HULLS[id] || id === 'service_tug' || id === 'megafreighter') continue;
    assert.equal(visionRangeOf({ type: id, shipFrame: id }), FOG_TUNE.vision.frigate, `${id}: wzrok bez zmian`);
  }
  // wykrywalność z tabeli typów i flaga kapitałowa wygrywają z tabelą jednostek (kolejność bez zmian)
  assert.equal(getEntitySizeModifier({ type: 'frigate', shipFrame: 'smuggler' }), SENSOR_CONFIG.sizeModifiers.frigate);
  assert.equal(getEntitySizeModifier({ type: 'carrier', isCapitalShip: true }), SENSOR_CONFIG.sizeModifiers.capital);
});

test('stacje: wzrok w obrazie czujników = źródło wzroku stacji w mgle wojny', () => {
  assert.equal(SENSOR_PICTURE_TUNE.stationVision, FOG_TUNE.vision.station);
  assert.ok(pos(SENSOR_PICTURE_TUNE.stationStrength) && pos(SENSOR_PICTURE_TUNE.stationSignature));
});

test('prototyp w grze: moc aktywna z profilu jednostki, tabela jednostek w scenie audytu', () => {
  const src = read('index.html');
  assert.match(src, /const prof = unitSensorProfile\(e\);/);
  assert.match(src, /jednostki\(\) \{ return radarUnitTable\(\); \}/);
});
