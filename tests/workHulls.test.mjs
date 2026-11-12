// Statki robocze z kreatora kadłubów jako KADŁUBY GRY (src/data/workHulls.js — plik generowany): tabela zgodna
// z presetami (rachunek src/game/hullDesign/hullDesignGameHull.js), płótno = nagłówek PNG sprite'a z kompozytora,
// wpisy w tabelach gry (profil, kadłub ruchu, edytor, mostek, rdzeń, zbiornik, lampy, osprzęt złomiarski) i klasa
// `tug` świata ruchu na nowym złomiarzu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORK_HULLS, WORK_HULL_IDS, workHullSpritePath } from '../src/data/workHulls.js';
import { buildWorkHullTables, workHullsModuleText, workHullId } from '../src/game/hullDesign/hullDesignGameHull.js';
import { HD_WORKSHIP_KEYS } from '../src/game/hullDesign/workships/index.js';
import { HULL_RENDER_PROFILES, HULL_RENDER_WORLD_SCALE } from '../src/data/ships.js';
import { TRAFFIC_HULLS, resolveTrafficHullId, trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { SCRAP_RIGS, SCRAP_RIG_DEFAULT, scrapRigFor } from '../src/data/scrapRigs.js';
import { NAV_LIGHT_POINTS } from '../src/data/shipNavLights.js';
import { TRAFFIC_EDITOR_FRAMES } from '../src/game/npcHardpointRuntime.js';

const pngSize = (id) => { const b = readFileSync(new URL(`../${workHullSpritePath(id)}`, import.meta.url)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('tabela generowana = rachunek z presetów kreatora (po zmianie presetu: kreator-kadluby-tabele.mjs --zapisz)', () => {
  assert.deepEqual([...WORK_HULL_IDS], HD_WORKSHIP_KEYS.map(workHullId));
  const text = workHullsModuleText(buildWorkHullTables((key) => pngSize(workHullId(key))));
  const file = readFileSync(new URL('../src/data/workHulls.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(file, text, 'src/data/workHulls.js różni się od presetów — node scripts/kreator-kadluby-tabele.mjs --zapisz');
});

test('sprite z kompozytora: płótno = nagłówek PNG, długość kadłuba w grze = obraz projektu', () => {
  for (const id of WORK_HULL_IDS) {
    const v = WORK_HULLS[id];
    assert.deepEqual([...v.png], pngSize(id), `${id}: płótno`);
    assert.equal(Math.max(...v.png), 1774, `${id}: dłuższy bok jak sprite'y ruchu`);
    const size = trafficHullRenderSize(id);
    assert.ok(Math.abs(size.w - v.worldL) <= 1, `${id}: szerokość w grze ${size.w} j. ≠ obraz projektu ${v.worldL} j.`);
    assert.equal(HULL_RENDER_PROFILES[id].length, Math.round(v.worldL / HULL_RENDER_WORLD_SCALE));
  }
});

test('wpisy w tabelach gry: kadłub ruchu, edytor (dysze MAIN i SIDE), lampy, rama cywilna', () => {
  for (const id of WORK_HULL_IDS) {
    const v = WORK_HULLS[id];
    assert.ok(TRAFFIC_HULLS[id]?.sprite.endsWith(`assets/ships/work/${v.key}.png`), `${id}: sprite`);
    assert.equal(resolveTrafficHullId(id), id);
    const ed = SHIP_EDITOR_DEFAULTS.ships[id];
    assert.ok(ed?.sideOnly, `${id}: wpis edytora cywilny`);
    assert.deepEqual(ed.engines.main.map((m) => [m.x, m.y]), v.main.map(([x, y]) => [x, y]), `${id}: MAIN`);
    assert.ok(ed.engines.side.length >= 2 && ed.engines.side.length % 2 === 0, `${id}: pary dysz SIDE`);
    assert.equal(new Set(ed.engines.side.map((s) => s.id)).size, ed.engines.side.length, `${id}: id dysz SIDE bez powtórzeń`);
    for (const s of ed.engines.side) assert.equal(s.deg, s.y < 0 ? 180 : 0, `${id}: wydech SIDE na swoją burtę`);
    // dysze MAIN przy rufie płótna, rdzeń i mostek na osi, wszystko w płótnie
    for (const [x] of v.main) assert.ok(x < -v.png[0] * 0.4, `${id}: dysza MAIN przy rufie (${x})`);
    for (const q of [v.core, v.bridge, v.fuel]) assert.ok(q && Math.abs(q.x) < v.png[0] / 2 && Math.abs(q.y) < v.png[1] / 2, `${id}: marker w płótnie`);
    assert.equal(v.bridge.level, v.cls, `${id}: poziom mostka = klasa`);
    assert.deepEqual(NAV_LIGHT_POINTS[id].p.length, 6);
    assert.ok(TRAFFIC_EDITOR_FRAMES.has(id), `${id}: rama cywilna runtime NPC`);
  }
});

test('złomiarz świata ruchu = nowy kadłub; osprzęt złomiarski z obrotnic i kosza projektu', () => {
  assert.equal(resolveTrafficHullId('tug'), 'work_zlomiarz');
  const rig = scrapRigFor('work_zlomiarz');
  assert.equal(rig, SCRAP_RIGS.work_zlomiarz);
  assert.notEqual(rig, SCRAP_RIG_DEFAULT);
  assert.deepEqual(Object.keys(rig).sort(), Object.keys(SCRAP_RIG_DEFAULT).sort(), 'te same pola co zestaw domyślny');
  // dwa wysięgniki: lewy (y < 0) i prawy, przy dziobie; punkt mielenia w koszu na śródokręciu (ładownia od góry)
  assert.equal(rig.mounts.length, 2);
  assert.ok(rig.mounts[0][1] < 0 && rig.mounts[1][1] > 0 && rig.mounts[0][0] === rig.mounts[1][0]);
  assert.ok(rig.mounts[0][0] > 0.3 && rig.mounts[0][0] < rig.front, `wysięgniki przy dziobie: ${rig.mounts[0]}`);
  assert.ok(Math.abs(rig.maw[0]) < 0.1 && rig.maw[1] === 0, `kosz na śródokręciu: ${rig.maw}`);
  assert.ok(rig.front > 0.45 && rig.front <= 0.5, `dziób sylwetki w płótnie: ${rig.front}`);
  // podstawy wysięgników = obrotnice projektu (ułamki sylwetki → ułamki płótna: różnica to margines obrazu)
  const w = WORK_HULLS.work_zlomiarz.work;
  assert.ok(Math.abs(rig.mounts[0][1] * WORK_HULLS.work_zlomiarz.worldL - w.mounts[0][1] * w.L) < 1, 'ta sama obrotnica');
  // paszcza: punkt mielenia w szczękach na dziobie; statki bez paszczy i kosza z wysięgnikami — zestaw domyślny
  assert.ok(SCRAP_RIGS.work_paszcza.maw[0] > 0.3);
  for (const id of ['work_mlyn', 'work_rafineria', 'work_rampowiec', 'work_dzwig']) assert.equal(scrapRigFor(id), SCRAP_RIG_DEFAULT, id);
});
