// Baza piratów (misja 1): budowle do zera — progi punktów zostawiają ostatni kawałek (bryłę trafień), zgniot taranem
// zdejmuje punkty, budowla bez stojącego kawałka ginie (zgłoszenie użytkownika 2026-10-14: „habitat staje na ~32%,
// taran też nie idzie”).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createPirateBaseLayout } from '../src/3d/portBuildings/pirateBaseLayout.js';
import { PIRATE_BASE_TUNE } from '../src/game/story/pirateBaseSite.js';
import { BASE_INTEGRITY_TUNE, baseStepChunk, markBaseBroken, noteBaseRam, stepBaseIntegrity } from '../src/game/story/pirateBaseIntegrity.js';

const L = createPirateBaseLayout();
const center = (c) => ({ x: (c.box.x0 + c.box.x1) / 2, z: (c.box.z0 + c.box.z1) / 2 });

test('progi punktów: każda budowla do zera ma w co trafić (ostatni kawałek zostaje)', () => {
  for (const key of Object.keys(L.structures)) {
    const steps = PIRATE_BASE_TUNE.hp[key].steps;
    const hittable = L.structures[key].filter((id) => !L.chunkById.get(id).ghost);
    const hitChunks = new Set(L.hitSolids.map((h) => h.chunk));
    for (const id of hittable) assert.ok(hitChunks.has(id), `${key}: ${id} ma bryłę trafień`);
    // gracz trafia po kolei w kawałki (różne miejsca) — próg łamie kawałek pod trafieniem albo najbliższy
    const gone = new Set();
    let k = 0;
    for (let s = 1; s < steps; s++) {   // próg `steps` = zero punktów (rozpad misji), progi w życiu: 1 … steps − 1
      const standing = hittable.filter((id) => !gone.has(id));
      const at = center(L.chunkById.get(standing[k++ % standing.length]));
      const id = baseStepChunk(L, key, at.x, at.z, (q) => gone.has(q));
      if (id) {
        assert.ok(!gone.has(id) && hittable.includes(id), `${key}: próg ${s} łamie stojący kawałek budowli`);
        gone.add(id);
      }
      assert.ok(hittable.some((q) => !gone.has(q)), `${key}: po progu ${s}/${steps} stoi kawałek z bryłą trafień`);
    }
    // dawne zachowanie (każdy próg łamie kawałek) zostawiało budowle z mniejszą liczbą kawałków niż progów bez brył
    if (hittable.length <= steps - 1) assert.equal(gone.size, hittable.length - 1, `${key}: łamie wszystko poza ostatnim`);
  }
});

test('progi punktów: kawałek pod trafieniem, duchy i pęknięte pomijane', () => {
  const at = center(L.chunkById.get('H-S'));
  assert.equal(baseStepChunk(L, 'habitat', at.x, at.z, () => false), 'H-S');
  // H-S już pękł — najbliższy stojący (nie duch dysku / części technicznej)
  const id = baseStepChunk(L, 'habitat', at.x, at.z, (q) => q === 'H-S');
  assert.ok(id && id !== 'H-S' && !L.chunkById.get(id).ghost);
  // magazyn: dwa kawałki — pęka jeden, drugi zostaje do zera punktów
  const m = center(L.chunkById.get('M-1'));
  assert.equal(baseStepChunk(L, 'warehouse', m.x, m.z, () => false), 'M-1');
  assert.equal(baseStepChunk(L, 'warehouse', m.x, m.z, (q) => q === 'M-1'), null);
});

// atrapa miejsca ciał: kawałki z ciałem (activeNodes) albo statyczne
function fakeSite(maxHp, nodes) {
  const owner = { id: 'hab', hp: maxHp, maxHp };
  const pieces = nodes.map((n, i) => ({
    id: `P${i}`, ghost: false, state: 'live', lost: false, islands: [],
    entity: null, nodeCount: () => n
  }));
  for (const p of pieces) {
    const body = { activeNodes: p.nodeCount(), dead: false, anchored: true };
    p.entity = { beamHull: { body } };
    p.entity.beamHull.entity = p.entity;
  }
  return { sites: { habitat: { owner, pieces } }, owner, pieces };
}
const hooksFor = (log, gone = () => false) => ({
  pieceNodes: (p) => p.nodeCount(),
  isGone: gone,
  damage: (o, hp, x, y) => { log.dmg.push({ hp, x, y }); o.hp = Math.max(0, o.hp - hp); },
  kill: (o) => { log.kill.push(o.id); o.hp = 0; }
});

test('taran: zgniecione węzły w oknie styku okrętu zdejmują punkty budowli', () => {
  const { sites, owner, pieces } = fakeSite(40000, [1000, 1000, 1000, 1000]);
  const log = { dmg: [], kill: [] };
  const hooks = hooksFor(log);
  stepBaseIntegrity(sites, 0, hooks);   // pierwszy odczyt — bez ubytku
  assert.equal(log.dmg.length, 0);
  // ubytek bez styku okrętu (broń — punkty liczy pocisk) — nic
  pieces[0].entity.beamHull.body.activeNodes = 900;
  stepBaseIntegrity(sites, 1, hooks);
  assert.equal(log.dmg.length, 0);
  // taran: styk w t = 2, 200 węzłów mniej
  noteBaseRam(pieces[0], 2, 10, 20);
  pieces[0].entity.beamHull.body.activeNodes = 700;
  stepBaseIntegrity(sites, 2.1, hooks);
  assert.equal(log.dmg.length, 1);
  const want = 200 / 4000 * 40000 * BASE_INTEGRITY_TUNE.ramHpMul;
  assert.ok(Math.abs(log.dmg[0].hp - want) < 1e-6, `${log.dmg[0].hp} ≈ ${want}`);
  assert.deepEqual([log.dmg[0].x, log.dmg[0].y], [10, 20]);
  // po oknie taranu — ubytek się nie liczy
  pieces[0].entity.beamHull.body.activeNodes = 600;
  stepBaseIntegrity(sites, 2 + BASE_INTEGRITY_TUNE.ramWindow + 0.1, hooks);
  assert.equal(log.dmg.length, 1);
  assert.ok(owner.hp > 0);
});

test('taran: kawałek pęknięty z progu albo statyczny nie liczy się jako zgniot', () => {
  const { sites, pieces } = fakeSite(40000, [1000, 1000]);
  const log = { dmg: [], kill: [] };
  const hooks = hooksFor(log);
  stepBaseIntegrity(sites, 0, hooks);
  noteBaseRam(pieces[0], 0.1, 0, 0);
  markBaseBroken(pieces[0]);
  pieces[0].entity.beamHull.body.activeNodes = 0;   // rozbity na odłamy
  pieces[1].state = 'static';
  pieces[1].entity = null;
  stepBaseIntegrity(sites, 0.2, hooks);
  assert.equal(log.dmg.length, 0);
  assert.equal(log.kill.length, 0, 'drugi kawałek stoi (statyka)');
});

test('bezpiecznik: budowla bez stojącego kawałka ginie; duch się nie liczy', () => {
  const { sites, owner, pieces } = fakeSite(9000, [500, 500]);
  pieces.push({ id: 'G', ghost: true, state: 'static', lost: false, islands: [], entity: null, nodeCount: () => 50 });
  const log = { dmg: [], kill: [] };
  const gone = new Set();
  const hooks = hooksFor(log, (id) => gone.has(id));
  gone.add('P0');
  pieces[1].lost = true;
  pieces[1].state = 'lost';
  stepBaseIntegrity(sites, 0, hooks);
  assert.deepEqual(log.kill, ['hab']);
  assert.equal(owner.hp, 0);
  // martwa budowla — bez dalszych wywołań
  stepBaseIntegrity(sites, 1, hooks);
  assert.equal(log.kill.length, 1);
});

test('klej w index.html: progi przez baseStepChunk, pęknięcie oznacza kawałek, krok po silniku', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function onBaseDamageStep('), src.indexOf('function storyBaseBreak('));
  assert.ok(fn.includes('baseStepChunk('), 'onBaseDamageStep wybiera kawałek przez baseStepChunk');
  assert.ok(/breakPiece\([^\n]*\)\)\s*\{\s*markBaseBroken\(wPiece\)/.test(src), 'storyBaseBreak oznacza pęknięty kawałek');
  const step = src.indexOf('HullBodies.step(dt, worldBodies.withEntities(allDestructibles));');
  assert.ok(step > 0 && src.indexOf('stepPirateBaseIntegrity();', step) - step < 300, 'stepPirateBaseIntegrity tuż po kroku silnika');
});
