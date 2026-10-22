// Scena „Wojna” (src/game/warScene.js, DevScene.wojna): skład flot, klin bez nakładania kadłubów, plan fal (najmniejsze
// pierwsze, flagowiec ostatni), floty naprzeciw siebie dziobami do siebie, start tunelu za flotą; wpięcie w grze.
//   node --test tests/warScene.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAR_SCENE_DEFAULTS, layoutWarWedge, pickDeepSpot, planWarBackdrop, planWarScene, topCameraHeight, warSceneRoster } from '../src/game/warScene.js';
import { WB_PLANET_DEFAULTS, heroFocus } from '../src/render/warBackdropPlan.js';

const LEN = { supercapital: 4200, pirate_supercapital: 4000, carrier: 2600, battleship: 1700, destroyer: 950, frigate_pd: 620 };
const hull = (key) => ({ length: LEN[key] || 900, width: (LEN[key] || 900) * 0.42 });

test('skład: A ~20 (superkapitał, 2 lotniskowce, 3 pancerniki, 5 niszczycieli, 9 fregat), B ~25; inne liczności w proporcjach', () => {
  const a = warSceneRoster('A', 20);
  assert.equal(a.length, 20);
  assert.equal(a[0], 'supercapital');
  const count = (l, k) => l.filter((x) => x === k).length;
  assert.deepEqual([count(a, 'carrier'), count(a, 'battleship'), count(a, 'destroyer'), count(a, 'frigate_pd')], [2, 3, 5, 9]);
  const b = warSceneRoster('B', 25);
  assert.equal(b.length, 25);
  assert.equal(b[0], 'pirate_supercapital');
  for (const n of [1, 5, 12, 40, 60]) assert.equal(warSceneRoster('A', n).length, n);
  assert.equal(warSceneRoster('A', 1)[0], 'supercapital');
});

test('klin: flagowiec w wierzchołku, ramiona do tyłu, lotniskowce na osi; kadłuby (obrys elipsy) się nie nakładają', () => {
  const keys = warSceneRoster('A', 20);
  const ships = keys.map((k) => ({ ...hull(k), carrier: k === 'carrier' }));
  const slots = layoutWarWedge(ships);
  assert.deepEqual(slots[0], { fwd: 0, lat: 0 });
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i].fwd < 0, `okręt ${i} za wierzchołkiem`);
  for (let i = 0; i < ships.length; i++) if (ships[i].carrier) assert.equal(slots[i].lat, 0);
  for (let i = 0; i < ships.length; i++) {
    for (let j = i + 1; j < ships.length; j++) {
      const dx = slots[i].fwd - slots[j].fwd;
      const dy = slots[i].lat - slots[j].lat;
      // obrysy jako elipsy (pół długości wzdłuż fwd, pół szerokości w bok) — test zachodzenia po osiach z zapasem
      const ox = (ships[i].length + ships[j].length) * 0.5;
      const oy = (ships[i].width + ships[j].width) * 0.5;
      assert.ok(Math.abs(dx) >= ox || Math.abs(dy) >= oy, `okręty ${keys[i]} ${i} i ${keys[j]} ${j} nachodzą na siebie`);
    }
  }
});

test('plan: floty naprzeciw siebie, dziobami do siebie, fale od najmniejszych, flagowiec ostatni, B po gapB', () => {
  const plan = planWarScene({ seed: 3 }, { x: 1000, y: 2000 }, 0, hull);
  const { A, B } = plan.fleets;
  assert.equal(A.ships.length, WAR_SCENE_DEFAULTS.countA);
  assert.equal(B.ships.length, WAR_SCENE_DEFAULTS.countB);
  assert.ok(Math.abs(B.apex.x - A.apex.x - WAR_SCENE_DEFAULTS.distance) < 1e-6);
  assert.ok(Math.abs(A.heading) < 1e-9, 'A leci w stronę B (+x)');
  assert.ok(Math.abs(Math.abs(B.heading) - Math.PI) < 1e-9, 'B leci w stronę A (−x)');
  assert.ok(A.origin.x < A.apex.x - 100000 && B.origin.x > B.apex.x + 100000, 'start tunelu daleko za flotą');
  assert.equal(B.start, WAR_SCENE_DEFAULTS.gapB);
  for (const f of [A, B]) {
    const flag = f.ships[0];
    for (const sh of f.ships.slice(1)) assert.ok(sh.burst < flag.burst, 'flagowiec wychodzi ostatni');
    const fr = f.ships.filter((s) => s.key === 'frigate_pd');
    const bs = f.ships.filter((s) => s.key === 'battleship');
    assert.ok(Math.max(...fr.map((s) => s.burst)) < Math.min(...bs.map((s) => s.burst)), 'fregaty przed pancernikami');
    // cała flota A za wierzchołkiem (dalej od B), B — za swoim
    for (const sh of f.ships) assert.ok(f === A ? sh.x <= A.apex.x + 1e-6 : sh.x >= B.apex.x - 1e-6);
  }
  // to samo ziarno — ten sam plan
  const again = planWarScene({ seed: 3 }, { x: 1000, y: 2000 }, 0, hull);
  assert.deepEqual(again.fleets.A.ships.map((s) => s.burst), A.ships.map((s) => s.burst));
});

test('gra: DevScene.wojna / wojnaStop / wojnaState, krok sceny przed wezwaniami, natarcie obu stron, wezwania przez callInSupport', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(html, /wojna\(opts = \{\}\) \{ return startWarScene\(opts\); \}/);
  assert.match(html, /function stepSupportWarp\(dt\) \{\n\s+stepWarScene\(dt\);\n\s+supportCallIns\.flush\(dt\);/);
  assert.match(html, /setFleetStanceOverride\('friendly', 'charge'\);\n\s+setFleetStanceOverride\('pirate', 'charge'\);/);
  assert.match(html, /function launchWarFleet\(fleet\) \{[\s\S]{0,400}callInSupport\(sh\.key, \{/);
  assert.ok(!/WarpNurt\.(arrive|planArrival|arriveAll)/.test(html.slice(html.indexOf('function startWarScene'), html.indexOf('function warSceneState'))),
    'scena nie woła efektu warpa wprost');
});

test('miejsce sceny w głębi: na okręgu wokół Słońca, z dala od ciał, najpierw ±90° (Słońce w pionie kadru)', () => {
  const sun = { x: 6e6, y: 6e6 };
  const R = WAR_SCENE_DEFAULTS.deepRadius;
  const free = pickDeepSpot(sun, [], R);
  assert.ok(Math.abs(free.angle - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.hypot(free.x - sun.x, free.y - sun.y) - R) < 1e-3);
  // ciało w punkcie +90° — wybór innego kąta z odstępem
  const body = { x: sun.x, y: sun.y + R, r: 400000 };
  const s2 = pickDeepSpot(sun, [body], R);
  assert.ok(Math.hypot(s2.x - body.x, s2.y - body.y) - body.r >= 700000);
});

test('plan obrazu sceny: planeta w głębi prostopadle do Słońca i od widza, bohaterowie pod kamerą, ujęcia rosnąco', () => {
  const center = { x: 6e6, y: 8.76e6 };
  const sun = { x: 6e6, y: 6e6 };
  const bd = planWarBackdrop({}, center, 0, sun, 1);
  const P = bd.backdrop.planet;
  assert.equal(P.on, 1);
  assert.equal(P.z, WB_PLANET_DEFAULTS.z);
  // przesunięcie ⟂ kierunku Słońca (terminator pod środkiem bitwy)
  const sdx = sun.x - center.x;
  const sdy = sun.y - center.y;
  assert.ok(Math.abs(P.dx * sdx + P.dy * sdy) < 1e-6 * Math.hypot(sdx, sdy) * Math.hypot(P.dx, P.dy) + 1e-6);
  assert.ok(Math.abs(Math.hypot(P.dx, P.dy) - WB_PLANET_DEFAULTS.offset) < 1e-6);
  // bohaterowie: dwie sceny, wysokość 0,55 kamery najbliższego kadru, ognisko pary w kadrze w chwili kulminacji
  assert.equal(bd.heroes.length, 2);
  for (const h of bd.heroes) {
    assert.ok(Math.abs(h.params.z - 0.55 * topCameraHeight(h.beat.view)) < 1e-6);
    const kill = h.beat.kind === 'duel' ? h.plan.keys.killB : h.plan.keys.kill;
    const f = heroFocus(h.plan, kill);
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y) && f.extent > 1000);
  }
  for (let i = 1; i < bd.shots.length; i++) assert.ok(bd.shots[i].t >= bd.shots[i - 1].t, 'ujęcia rosnąco');
  assert.deepEqual(bd.shots.map((s) => s.kind), ['wide', 'hero', 'hero', 'wide']);
  // ujęcie bohatera trzyma kadr do końca ich sceny
  for (const s of bd.shots.filter((x) => x.kind === 'hero')) {
    const end = s.t + s.inSec + s.holdSec;
    const k = s.hero.keys;
    assert.ok(end >= (k.killA ?? k.kill), 'kadr trzyma śmierć');
  }
  // tło planety gry: bez planety w głębi; bez kina i bohaterów — puste listy
  assert.equal(planWarBackdrop({ backdrop: 'jupiter' }, center, 0, sun, 1).backdrop.planet.on, 0);
  const bare = planWarBackdrop({ cinema: false, heroes: false }, center, 0, sun, 1);
  assert.equal(bare.shots.length, 0);
  assert.equal(bare.backdrop.heroes.length, 0);
});
