// Opis układu z sektora (src/game/sector/) → wpis rejestru układów (src/data/starSystems.js): pola jak SOL_SYSTEM,
// planety w formacie systemMap.js (buildSystemMap je przyjmuje, orbity za studnią gwiazdy), globalne id = id sektora,
// bez przypadkowego ringu „Halo”, wybór układu z adresu, Słońce ręczne.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSector, systemRegistryEntry, sectorRegistryEntries, localBodyId, PLANET_TYPES } from '../src/game/sector/index.js';
import { SOL_SYSTEM, globalBodyId, resolveStarSystemId, systemHome } from '../src/data/starSystems.js';
import { buildSystemMap, SYSTEM_MAP_CONSTANTS, sunWellRadius } from '../src/data/systemMap.js';
import { normalizeRingPlanetKey } from '../src/3d/ringScale.js';

const sector = generateSector({ seed: 1 });
const entries = sectorRegistryEntries(sector, { handmade: { sol: SOL_SYSTEM } });
const HEX = /^#[0-9a-f]{6}$/i;

test('wpis rejestru: pola jak SOL_SYSTEM, zamrożony, deterministyczny, bez domu i treści ręcznej', () => {
  const ids = Object.keys(entries);
  assert.equal(ids.length, sector.systems.length);
  assert.equal(entries.sol, SOL_SYSTEM, 'Słońce = wpis ręczny');
  assert.equal(systemRegistryEntry(sector, 'sol'), null, 'Słońce bez wpisu ręcznego → null');
  assert.equal(systemRegistryEntry(sector, 'nieznany'), null);
  const keys = Object.keys(SOL_SYSTEM).sort();
  for (const id of ids) {
    if (id === 'sol') continue;
    const e = entries[id];
    for (const k of keys) assert.ok(k in e, `${id}: pole ${k}`);
    assert.equal(e.id, id);
    assert.equal(e.home, null);
    assert.equal(systemHome(e), null);
    assert.equal(e.handmade, false);
    assert.ok(e.label && e.label === e.label.toUpperCase() && e.label.length <= 14, `${id}: podpis ${e.label}`);
    assert.equal(e.star.id, 'sun');
    assert.ok(typeof e.star.spectral === 'string' && e.star.spectral.length >= 2, `${id}: widmo ${e.star.spectral}`);
    assert.ok(e.star.r > 0);
    for (const c of ['core', 'mid', 'rim']) assert.match(e.star.color[c], HEX, `${id}: barwa ${c}`);
    assert.deepEqual([...e.moons], []);
    assert.ok(Object.isFrozen(e) && Object.isFrozen(e.star) && Object.isFrozen(e.star.color) && Object.isFrozen(e.planets));
    for (const p of e.planets) assert.ok(Object.isFrozen(p));
  }
  // Prawdziwe widma nazwanych, zgodność G z barwą Słońca gry.
  assert.equal(entries['alfa-centauri'].star.spectral, 'G2V');
  assert.equal(entries.syriusz.star.spectral, 'A1V');
  assert.deepEqual({ ...entries['tau-ceti'].star.color }, { ...SOL_SYSTEM.star.color });
  assert.ok(entries['alfa-centauri'].companion, 'Alfa Centauri ma towarzysza');
  const again = sectorRegistryEntries(generateSector({ seed: 1 }), { handmade: { sol: SOL_SYSTEM } });
  assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(entries)));
});

test('planety w formacie systemMap.js: buildSystemMap je przyjmuje, orbity rosną i leżą za studnią gwiazdy', () => {
  const angleFor = (def, i) => i * 0.7;
  const types = new Set(PLANET_TYPES);
  let checked = 0;
  for (const e of Object.values(entries)) {
    if (e === SOL_SYSTEM) continue;
    for (const p of e.planets) {
      assert.equal(typeof p.id, 'string');
      assert.equal(typeof p.name, 'string');
      assert.ok(p.baseR > 0 && Number.isFinite(p.orbitAU));
      assert.ok(types.has(p.type), p.type);
      assert.equal(p.seed >>> 0, p.seed);
      assert.ok(!p.id.includes(':'), `${e.id}: id planety lokalne (${p.id})`);
    }
    if (!e.planets.length) continue;
    const map = buildSystemMap(140, { planets: e.planets, sunRadius: e.star.r, angleFor });
    let prev = 0;
    const well = sunWellRadius(e.star);
    for (const p of map.planets) {
      assert.ok(p.orbitRadius > prev, `${e.id}: orbity rosną`);
      assert.ok(p.orbitRadius - p.r > well, `${e.id}/${p.id}: orbita ${Math.round(p.orbitRadius)} za studnią ${Math.round(well)}`);
      assert.ok(p.orbitRadius + p.r < SYSTEM_MAP_CONSTANTS.worldTargetDiameter / 2, `${e.id}/${p.id}: w świecie`);
      prev = p.orbitRadius;
    }
    checked++;
  }
  assert.ok(checked > 100, `układy z planetami: ${checked}`);
});

test('globalne id = id sektora (globalBodyId), bez przypadkowego ringu „Halo”, wybór układu z adresu', () => {
  for (const s of sector.systems) {
    if (s.id === 'sol') {
      for (const p of s.planets) assert.ok(SOL_SYSTEM.planets.some((q) => globalBodyId('sol', q.id) === p.id), p.id);
      continue;
    }
    const e = entries[s.id];
    assert.equal(e.planets.length, s.planets.length);
    e.planets.forEach((p, i) => {
      assert.equal(globalBodyId(e.id, p.id), s.planets[i].id);
      assert.equal(localBodyId(s.planets[i].id), p.id);
      assert.equal(normalizeRingPlanetKey(p), '', `${p.name}: nazwa nie może wybrać ringu Ziemi / Marsa / Jowisza`);
    });
    e.belts.forEach((b, i) => assert.equal(globalBodyId(e.id, b.id), s.belts[i].id));
    assert.equal(normalizeRingPlanetKey({ id: e.id, name: e.name, label: e.label }), '', e.name);
  }
  assert.deepEqual(resolveStarSystemId('?uklad=Tau-Ceti', null, entries), { id: 'tau-ceti', source: 'url', rejected: null });
  assert.deepEqual(resolveStarSystemId('', 'hf-0042', entries), { id: 'hf-0042', source: 'save', rejected: null });
});
