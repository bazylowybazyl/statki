import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TRAFFIC_HULLS,
  TRAFFIC_UNIT_HULLS,
  TRAFFIC_FALLBACK_HULL,
  resolveTrafficHullId,
  isKnownTrafficUnitClass,
  trafficHullFootprint,
  trafficHullRenderSize
} from '../src/data/trafficHulls.js';
import { HULL_RENDER_PROFILES } from '../src/data/ships.js';
import { hullFootprint } from '../src/game/traffic/dockLayout.js';
import { hullForVanClass } from '../src/game/traffic/transportCompanies.js';
import { CARAVAN_ROLES } from '../src/game/traffic/agentFleets.js';
import { WARSHIP_CLASSES } from '../src/game/traffic/shipyards.js';
import { VAN_CLASSES } from '../src/game/cargoFleet.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';

const trafficDir = fileURLToPath(new URL('../src/game/traffic/', import.meta.url));

/** Wymiary płótna z nagłówka PNG (IHDR). */
function pngSize(path) {
  const buf = readFileSync(path);
  assert.equal(buf.toString('latin1', 12, 16), 'IHDR', `${path}: to nie PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

/** Wszystkie `unitClass: '…'` z kodu ruchu v2 — nowa rola bez wpisu wywali test. */
function unitClassLiterals() {
  const out = new Set();
  for (const name of readdirSync(trafficDir)) {
    if (!name.endsWith('.js')) continue;
    const text = readFileSync(join(trafficDir, name), 'utf8');
    for (const m of text.matchAll(/unitClass:\s*'([^']+)'/g)) out.add(m[1]);
  }
  return out;
}

test('każda klasa, którą ruch v2 wystawia, ma w rejestrze własny kadłub', () => {
  const classes = new Set(unitClassLiterals());
  assert.ok(classes.has('raider') && classes.has('tug') && classes.has('warfleet'), 'skaner widzi role z kodu ruchu');
  for (const cls of VAN_CLASSES) {
    classes.add(cls.npcType);
    classes.add(hullForVanClass(cls.id));
  }
  for (const role of CARAVAN_ROLES) classes.add(role.hull);
  classes.add('heavy_freighter');
  classes.add('long_haul_freighter');
  const missing = [...classes].filter((cls) => !isKnownTrafficUnitClass(cls));
  assert.deepEqual(missing, [], 'dopisz klasy do TRAFFIC_UNIT_HULLS albo TRAFFIC_HULLS');
});

test('zapas okrętów w portach (shipyards) ma sprite w rejestrze', () => {
  for (const cls of Object.values(WARSHIP_CLASSES)) {
    assert.ok(TRAFFIC_HULLS[cls.hull], `${cls.id}: ${cls.hull} bez wpisu w TRAFFIC_HULLS`);
  }
});

test('mapowania ról trafiają w kadłuby rejestru, obca klasa — w zapasowy obrys', () => {
  for (const [cls, hull] of Object.entries(TRAFFIC_UNIT_HULLS)) {
    assert.ok(TRAFFIC_HULLS[hull], `${cls} → ${hull} bez wpisu w TRAFFIC_HULLS`);
    assert.equal(resolveTrafficHullId(cls), hull);
  }
  for (const hull of Object.keys(TRAFFIC_HULLS)) assert.equal(resolveTrafficHullId(hull), hull);
  assert.equal(resolveTrafficHullId('nieznana-klasa'), TRAFFIC_FALLBACK_HULL);
  assert.equal(resolveTrafficHullId(null), TRAFFIC_FALLBACK_HULL);
  assert.equal(isKnownTrafficUnitClass('nieznana-klasa'), false);
  // Klasy bez statku jak vany w index.html, ciężka i mega klasa — ciężki frachtowiec.
  assert.equal(resolveTrafficHullId('freighter-small'), 'inter_station_shuttle');
  assert.equal(resolveTrafficHullId('freighter-capital'), 'heavy_freighter');
});

test('kadłuby rejestru: profil, plik PNG, płótno zgodne z nagłówkiem', () => {
  for (const [id, hull] of Object.entries(TRAFFIC_HULLS)) {
    assert.ok(HULL_RENDER_PROFILES[id], `${id}: brak HULL_RENDER_PROFILES`);
    const path = fileURLToPath(hull.sprite);
    assert.ok(existsSync(path), `${id}: brak pliku ${path}`);
    assert.deepEqual(pngSize(path), hull.png, `${id}: płótno PNG`);
  }
});

test('płaszczyzna sprite\'a bez zniekształcenia (podłoga 64 j. w getHullRenderSize)', () => {
  for (const [id, hull] of Object.entries(TRAFFIC_HULLS)) {
    const size = trafficHullRenderSize(id);
    const want = hull.png[1] / hull.png[0];
    const got = size.h / size.w;
    // Prom (200 → 120 × 64 zamiast 60) ma 6,7% od zawsze; dron przy 110 miałby 45%.
    assert.ok(Math.abs(got / want - 1) < 0.07, `${id}: ${size.w} × ${size.h} przy płótnie ${hull.png.join(' × ')}`);
  }
});

test('dysze MAIN: na rufie, w płótnie; kadłuby edytora mają dysze w danych edytora', () => {
  for (const [id, hull] of Object.entries(TRAFFIC_HULLS)) {
    if (hull.editorKey) {
      const main = SHIP_EDITOR_DEFAULTS.ships?.[hull.editorKey]?.engines?.main;
      assert.ok(Array.isArray(main) && main.length > 0, `${id}: ${hull.editorKey} bez dysz w SHIP_EDITOR_DEFAULTS`);
      continue;
    }
    assert.ok(Array.isArray(hull.main) && hull.main.length > 0, `${id}: brak dysz`);
    const [w, h] = hull.png;
    for (const [x, y, d] of hull.main) {
      assert.ok(x < -w * 0.15 && x > -w * 0.5, `${id}: dysza x=${x} poza rufą`);
      assert.ok(Math.abs(y) < h * 0.5, `${id}: dysza y=${y} poza płótnem`);
      assert.ok(d > 0 && d < h * 0.3, `${id}: średnica ${d}`);
    }
  }
});

test('gabaryty klasy = wzór dockLayout.hullFootprint dla zarejestrowanego kadłuba', () => {
  for (const cls of [...Object.keys(TRAFFIC_UNIT_HULLS), ...Object.keys(TRAFFIC_HULLS)]) {
    assert.deepEqual(trafficHullFootprint(cls), hullFootprint(resolveTrafficHullId(cls)), cls);
  }
});
