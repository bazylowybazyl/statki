// Baza piratów (misja 1): budowle do zera — progi punktów zostawiają ostatni kawałek (bryłę trafień), zgniot taranem
// zdejmuje punkty, budowla bez stojącego kawałka ginie (zgłoszenie użytkownika 2026-10-14: „habitat staje na ~32%,
// taran też nie idzie”).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createPirateBaseLayout } from '../src/3d/portBuildings/pirateBaseLayout.js';
import { PIRATE_BASE_TUNE } from '../src/game/story/pirateBaseSite.js';
import { BASE_INTEGRITY_TUNE, baseStepChunk, createPiecePools, damagePool, habitatStages, markBaseBroken, noteBaseRam, poolPieceAt, stepBaseIntegrity } from '../src/game/story/pirateBaseIntegrity.js';

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

// Decyzje użytkownika 2026-11-03 („punkty stają, ciężko zbić, nienaturalnie się ostrzeliwuje”): kawałek habitatu pęka od
// trafień w niego (pula), habitat ginie z etapów — wyłom (1 ćwiartka), wieża, wieżowce.
test('pule kawałków: habitat — ćwiartki bębna i szyb (bez duchów), inne budowle bez pul', () => {
  const T = PIRATE_BASE_TUNE.hp.habitat;
  const pools = createPiecePools(L, 'habitat', T.pieces);
  assert.deepEqual(Object.keys(pools).sort(), ['H-C', 'H-E', 'H-N', 'H-S', 'H-W']);
  for (const [id, p] of Object.entries(pools)) {
    assert.equal(p.hp, p.max);
    assert.equal(p.max, T.pieces[L.chunkById.get(id).kind]);
  }
  assert.equal(T.steps, 0, 'habitat bez progów „kawałek najbliżej trafienia”');
  assert.deepEqual(createPiecePools(L, 'warehouse', T.pieces), {});
});

test('pule kawałków: trafienie zdejmuje punkty kawałka trafionego, nie przechodzi na inny', () => {
  const pools = createPiecePools(L, 'habitat', { drum: 100, core: 100 });
  const gone = new Set();
  const isGone = (id) => gone.has(id);
  const at = center(L.chunkById.get('H-S'));
  // pod punktem
  assert.equal(poolPieceAt(L, pools, at.x, at.z, isGone), 'H-S');
  // kawałek trafiony wprost (ciało) ma pierwszeństwo przed miejscem
  assert.equal(poolPieceAt(L, pools, at.x, at.z, isGone, 'H-C'), 'H-C');
  // pusta pula: trafienie zostaje przy kawałku (bez przenoszenia punktów na drugi koniec habitatu)
  assert.equal(damagePool(pools, 'H-S', 60), false);
  assert.equal(damagePool(pools, 'H-S', 60), true, 'pula do zera — kawałek ma pęknąć');
  assert.equal(damagePool(pools, 'H-S', 60), false, 'pęka raz');
  assert.equal(poolPieceAt(L, pools, at.x, at.z, isGone, 'H-S'), 'H-S');
  // kawałek pęknięty (bez brył): trafienie poza bryłami — najbliższy stojący z pulą
  gone.add('H-S');
  const id = poolPieceAt(L, pools, at.x * 3, at.z * 3, isGone);
  assert.ok(id && id !== 'H-S' && pools[id].hp > 0, id);
  // budowla bez pul
  assert.equal(poolPieceAt(L, null, at.x, at.z, isGone), null);
});

test('etapy habitatu: wyłom 1 ćwiartki + wieża + wieżowce, kolejność dowolna; punkty = maks. × reszta', () => {
  const need = PIRATE_BASE_TUNE.hp.habitat.breachNeed;
  assert.equal(need, 1);
  const total = L.highrises.length;
  assert.equal(total, 2, 'dwa wieżowce');
  let s = habitatStages({ breachNeed: need, highrisesTotal: total });
  assert.deepEqual([s.done, s.total, s.left], [0, 4, 1]);
  s = habitatStages({ quadrantsDown: 3, breachNeed: need, highrisesTotal: total });
  assert.equal(s.breach, 1, 'więcej ćwiartek nie liczy się ponad potrzebę');
  assert.equal(s.left, 0.75);
  s = habitatStages({ quadrantsDown: 1, breachNeed: need, towerDown: true, highrisesDown: 1, highrisesTotal: total });
  assert.equal(s.left, 0.25);
  s = habitatStages({ quadrantsDown: 0, breachNeed: need, towerDown: true, highrisesDown: 2, highrisesTotal: total });
  assert.ok(s.left > 0, 'bez wyłomu habitat żyje');
  s = habitatStages({ quadrantsDown: 1, breachNeed: need, towerDown: true, highrisesDown: 2, highrisesTotal: total });
  assert.deepEqual([s.done, s.left], [4, 0], 'komplet — finał');
});

test('taran w kawałek z pulą: punkty z puli kawałka; budowla z noFuse nie ginie bez stojących kawałków', () => {
  const { sites, owner, pieces } = fakeSite(40000, [1000, 1000]);
  owner.piecePools = { P0: { hp: 5000, max: 5000 } };
  owner.noFuse = true;
  const log = { dmg: [], kill: [], piece: [] };
  const hooks = { ...hooksFor(log), pieceDamage: (o, id, hp, x, y) => log.piece.push({ id, hp, x, y }) };
  stepBaseIntegrity(sites, 0, hooks);
  noteBaseRam(pieces[0], 1, 5, 6);
  noteBaseRam(pieces[1], 1, 7, 8);
  pieces[0].entity.beamHull.body.activeNodes = 900;
  pieces[1].entity.beamHull.body.activeNodes = 800;
  stepBaseIntegrity(sites, 1.1, hooks);
  assert.equal(log.piece.length, 1);
  assert.equal(log.piece[0].id, 'P0');
  assert.ok(Math.abs(log.piece[0].hp - 100 / 1000 * 5000 * BASE_INTEGRITY_TUNE.ramHpMul) < 1e-6);
  // kawałek bez puli — punkty budowli jak dawniej (ubytek / węzły budowli)
  assert.equal(log.dmg.length, 1);
  assert.ok(Math.abs(log.dmg[0].hp - 200 / 2000 * 40000 * BASE_INTEGRITY_TUNE.ramHpMul) < 1e-6);
  // wszystkie kawałki pęknięte — bezpiecznik wyłączony (habitat ginie z etapów)
  for (const p of pieces) markBaseBroken(p);
  stepBaseIntegrity(sites, 2, hooks);
  assert.equal(log.kill.length, 0);
});

test('klej: obrażenia budowli przez pule, ogień w rurach i finał z etapów wprost', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const apply = src.slice(src.indexOf('function applyDamageToStation('), src.indexOf('window.applyDamageToStation = applyDamageToStation;'));
  assert.ok(/if \(!direct && station\.pieceDamage\) return station\.pieceDamage\(station, dmg\);/.test(apply), 'applyDamageToStation → pule kawałków');
  const piece = src.slice(src.indexOf('function onBasePieceDamage('), src.indexOf('function syncBaseStages('));
  assert.ok(piece.includes('poolPieceAt(') && piece.includes('damagePool(') && piece.includes('storyBaseBreak('), 'kawałek z pulą pęka przez storyBaseBreak');
  const sync = src.slice(src.indexOf('function syncBaseStages('), src.indexOf('function syncBaseStages(') + 1200);
  assert.ok(/applyDamageToStation\(hab, [^\n]*, true\)/.test(sync), 'finał z etapów — punkty wprost');
  const step = src.slice(src.indexOf('function stepPirateBaseIntegrity('), src.indexOf('function stepPirateBaseIntegrity(') + 400);
  assert.ok(step.includes('syncBaseStages();'), 'etapy co krok fizyki');
  assert.ok(/damageStation: \(st, dmg, direct\) => applyDamageToStation\(st, dmg, !!direct\)/.test(src), 'zależność fabuły przekazuje direct');
  const game = readFileSync(new URL('../src/game/story/storyGame.js', import.meta.url), 'utf8');
  assert.ok(/d\.damageStation\(s, dmg, true\)/.test(game), 'ogień w rurach zabija habitat od razu (bez pul)');
});

test('klej w index.html: progi przez baseStepChunk, pęknięcie oznacza kawałek, krok po silniku', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function onBaseDamageStep('), src.indexOf('function storyBaseBreak('));
  assert.ok(fn.includes('baseStepChunk('), 'onBaseDamageStep wybiera kawałek przez baseStepChunk');
  assert.ok(/breakPiece\([^\n]*\)\)\s*\{\s*markBaseBroken\(wPiece\)/.test(src), 'storyBaseBreak oznacza pęknięty kawałek');
  const step = src.indexOf('HullBodies.step(dt, worldBodies.withEntities(allDestructibles));');
  assert.ok(step > 0 && src.indexOf('stepPirateBaseIntegrity();', step) - step < 300, 'stepPirateBaseIntegrity tuż po kroku silnika');
});
