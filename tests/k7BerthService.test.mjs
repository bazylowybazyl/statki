// Automat obsługi stanowisk capital K-7 w grze swobodnej (2026-10-07, src/game/k7BerthService.js): postój gracza
// na polu stanowiska → zamki pola, ramiona i przewody paliwowe się podpinają, ruszenie → awaryjne odpięcie (upust,
// odryglowanie — buch pary w źródłach gazu hali), pozy fabuły (owner = 'story') nietknięte. Suwnic nie ma.
// Obraz w prawdziwej grze: node scripts/webgpu/hala-swiatla-gra.mjs --automat
// node --test tests/k7BerthService.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  K7_POSE_OWNER, K7_SERVICE_TUNE, K7_SERVICE_DOCK, K7_SERVICE_RELEASE, K7_SERVICE_LAMP,
  createK7BerthService, stepK7BerthService, syncK7BerthLamps, k7BerthServiceState
} = await import('../src/game/k7BerthService.js');
const { HaloRingCollider } = await import('../src/game/haloRingCollision.js');
const { k7BerthPose } = await import('../src/game/story/k7Dock.js');
const { createK7Layout } = await import('../src/3d/haloRing/haloPortK7Layout.js');
const { HALL_DUST_IN, hallDustDomain } = await import('../src/3d/gasField/hallDustLayout.js');
const { packHallService } = await import('../src/game/hallDustInput.js');
const { HALL_GAS_MAX, createHallGasSources, writeHallGasSources } = await import('../src/3d/gasField/hallGasSources.js');

const DT = 1 / 60;
const DEG = Math.PI / 180;
const KEYS = ['clamp', 'extension', 'seat', 'lock', 'flow', 'vent'];
const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function world(x = 6123456.7, y = 4234567.8) {
  const planet = { id: 'earth', name: 'earth', x, y };
  const col = new HaloRingCollider(planet);
  const svc = createK7BerthService(col.registry);
  return { planet, col, svc, place: col.place };
}

/** Atlas na stanowisku `berthId` hali `hall` (kurs stanowiska + `turn`), w spoczynku. */
function shipOn(w, berthId = 'C-01', hall = 0, turn = 0, size = { w: 1800, h: 806 }) {
  const p = k7BerthPose(w.planet, berthId, hall);
  return { pos: { x: p.x, y: p.y }, vel: { x: 0, y: 0 }, angle: p.angle + turn, angVel: 0, w: size.w, h: size.h, berth: p };
}

function run(w, ship, sec, each = null, dt = DT) {
  const list = [ship];
  const n = Math.round(sec / Math.max(dt, DT));
  for (let i = 0; i < n; i++) {
    if (ship) { ship.pos.x += ship.vel.x * dt; ship.pos.y += ship.vel.y * dt; }
    stepK7BerthService(w.svc, dt, w.place, list, 1);
    if (each) each(i);
  }
}

const poseOf = (w, id = 'C-01', hall = 0) => w.col.registry.halls[hall].poses.get(id);
const stateOf = (w, id = 'C-01', hall = 0) => k7BerthServiceState(w.svc, hall, id);
const snap = (p) => Object.fromEntries(KEYS.map((k) => [k, p[k]]));

test('postój na polu: po 2 s zamki, ramiona i przewody, potem przepływ — każda hala, każde stanowisko, kurs zgodny i odwrotny', () => {
  const w = world();
  const dockEnd = K7_SERVICE_TUNE.dwell + K7_SERVICE_DOCK.end;
  for (let hall = 0; hall < w.col.registry.halls.length; hall++) {
    for (const id of ['C-01', 'C-02', 'C-03', 'C-04']) {
      for (const turn of [0, Math.PI]) {
        const ship = shipOn(w, id, hall, turn);
        const pose = poseOf(w, id, hall);
        const tag = `hala ${hall} ${id} ${turn ? 'odwrotny' : 'zgodny'}`;
        run(w, ship, K7_SERVICE_TUNE.dwell - 0.1);
        assert.equal(stateOf(w, id, hall).state, 'settle', tag);
        assert.equal(stateOf(w, id, hall).lamp, K7_SERVICE_LAMP.reserved, `${tag}: lampka — pole widzi statek`);
        assert.ok(KEYS.every((k) => pose[k] === 0), `${tag}: w postoju nic nie rusza`);
        // kolejność: ramię nad wlewem → złączka na wlewie → rygiel → przepływ
        let order = true;
        run(w, ship, dockEnd - K7_SERVICE_TUNE.dwell + 0.3, () => {
          if (pose.seat > 1e-3 && pose.extension < 0.999) order = false;
          if (pose.lock > 1e-3 && pose.seat < 0.999) order = false;
          if (pose.flow > 1e-3 && pose.lock < 0.999) order = false;
        });
        assert.ok(order, `${tag}: ramię → złączka → rygle → przepływ`);
        assert.equal(stateOf(w, id, hall).state, 'docked', tag);
        for (const k of ['clamp', 'extension', 'seat', 'lock', 'flow']) assert.equal(pose[k], 1, `${tag}: ${k}`);
        assert.equal(pose.vent, 0);
        assert.equal(pose.owner, K7_POSE_OWNER.auto, `${tag}: właściciel pozy — automat`);
        assert.equal(stateOf(w, id, hall).lamp, K7_SERVICE_LAMP.occupied);
        // pozostałe stanowiska i hale w spoczynku
        for (let h2 = 0; h2 < w.col.registry.halls.length; h2++) {
          for (const [bid, p] of w.col.registry.halls[h2].poses) {
            if (h2 === hall && bid === id) continue;
            assert.ok(KEYS.every((k) => p[k] === 0) && !p.owner, `${tag}: ${h2}/${bid} w spoczynku`);
          }
        }
        // odlot: stanowisko wraca do spoczynku
        ship.vel.x = 200;
        run(w, ship, K7_SERVICE_RELEASE.end + 0.5);
        assert.equal(stateOf(w, id, hall).state, 'idle', tag);
        assert.ok(KEYS.every((k) => pose[k] === 0) && pose.owner === null, `${tag}: zwinięte`);
      }
    }
  }
});

test('bez podpięcia: za szybko, obrót, poza polem, kurs poza tolerancją, kadłub za duży / za mały, pauza', () => {
  const cases = [
    ['30 j/s', (s) => { s.vel.x = 30 * Math.cos(s.angle + 0.5); s.vel.y = 30 * Math.sin(s.angle + 0.5); }],
    ['obrót 0,1 rad/s', (s) => { s.angVel = 0.1; }],
    ['200 j. w poprzek', (s, w) => { const a = s.angle + Math.PI / 2; s.pos.x += 200 * Math.cos(a); s.pos.y += 200 * Math.sin(a); }],
    ['220 j. wzdłuż', (s) => { s.pos.x += 220 * Math.cos(s.angle); s.pos.y += 220 * Math.sin(s.angle); }],
    ['kurs +15°', (s) => { s.angle += 15 * DEG; }],
    ['kurs −15° od odwrotnego', (s) => { s.angle += Math.PI - 15 * DEG; }],
    ['kadłub 2200 j.', (s) => { s.w = 2200; }],
    ['kadłub 900 × 400', (s) => { s.w = 900; s.h = 400; }],
    ['martwy', (s) => { s.dead = true; }]
  ];
  for (const [tag, mod] of cases) {
    const w = world();
    const ship = shipOn(w);
    mod(ship, w);
    const v = { x: ship.vel.x, y: ship.vel.y };
    run(w, ship, 10, () => { ship.vel.x = v.x; ship.vel.y = v.y; ship.pos.x -= v.x * DT; ship.pos.y -= v.y * DT; });
    const p = poseOf(w);
    assert.ok(KEYS.every((k) => p[k] === 0) && !p.owner, tag);
    assert.notEqual(stateOf(w).state, 'dock', tag);
  }
  // w tolerancji: kurs +10°, przesunięcie 130 j. w poprzek
  const w = world();
  const ship = shipOn(w);
  ship.angle += 10 * DEG;
  const a = ship.angle + Math.PI / 2;
  ship.pos.x += 130 * Math.cos(a); ship.pos.y += 130 * Math.sin(a);
  run(w, ship, 8);
  assert.equal(stateOf(w).state, 'docked', 'w tolerancji pola i kursu');
  // pauza (dt = 0): postój nie biegnie
  const w2 = world();
  const s2 = shipOn(w2);
  run(w2, s2, 10, null, 0);
  assert.notEqual(stateOf(w2).state, 'dock');
  assert.ok(KEYS.every((k) => poseOf(w2)[k] === 0), 'pauza: obsługa stoi');
  // automat wyłączony: zadokowany statek — stanowisko się zwija
  const w3 = world();
  const s3 = shipOn(w3);
  run(w3, s3, 8);
  K7_SERVICE_TUNE.enabled = false;
  try { run(w3, s3, K7_SERVICE_RELEASE.end + 0.2); } finally { K7_SERVICE_TUNE.enabled = true; }
  assert.equal(stateOf(w3).state, 'idle');
  assert.ok(KEYS.every((k) => poseOf(w3)[k] === 0));
});

test('ruszenie: awaryjne odpięcie — przepływ, krótki upust, rygle szybko (buch pary w źródłach gazu), składanie', () => {
  const w = world();
  const ship = shipOn(w);
  run(w, ship, 8);
  assert.equal(stateOf(w).state, 'docked');
  const pose = poseOf(w);
  // źródła gazu hali 0 (wejście klatki z pozy rejestru, jak packHallDustFrame)
  const L = createK7Layout();
  const src = createHallGasSources(L);
  const dom = hallDustDomain(L);
  const IN = new Float64Array(HALL_DUST_IN.size);
  const J = new Float32Array(64 * 12);
  const gas = () => { packHallService(IN, w.col.registry.halls[0].poses); return writeHallGasSources(src, J, 0, HALL_GAS_MAX, IN, dom, DT); };
  for (let i = 0; i < 30; i++) gas();
  assert.equal(src.stats.bursts, 0, 'podpięty: bez wyrzutu');
  // ruszenie: W do przodu, 60 j/s
  ship.vel.x = 60 * Math.cos(ship.angle);
  ship.vel.y = 60 * Math.sin(ship.angle);
  let t = 0;
  let flowZeroAt = -1;
  let lockDropAt = -1;
  let ventMax = 0;
  let burstAt = -1;
  let lockAtVentMax = 0;
  run(w, ship, K7_SERVICE_RELEASE.end + 0.5, () => {
    t += DT;
    if (flowZeroAt < 0 && pose.flow === 0) flowZeroAt = t;
    if (lockDropAt < 0 && pose.lock < 0.999) lockDropAt = t;
    if (pose.vent > ventMax) { ventMax = pose.vent; lockAtVentMax = pose.lock; }
    gas();
    if (burstAt < 0 && src.stats.bursts > 0) burstAt = t;
  });
  assert.ok(flowZeroAt > 0 && flowZeroAt < lockDropAt, `przepływ odcięty (${flowZeroAt.toFixed(2)} s) przed ryglami (${lockDropAt.toFixed(2)} s)`);
  assert.ok(ventMax > 0.9 && lockAtVentMax > 0.9, `krótki upust z zaryglowanych przewodów: ${ventMax}`);
  assert.ok(lockDropAt < 0.6, 'rygle puszczają szybko');
  assert.ok(burstAt > 0 && burstAt < 0.7, `odryglowanie → buch pary w źródłach gazu (${burstAt})`);
  assert.equal(stateOf(w).state, 'idle');
  assert.ok(KEYS.every((k) => pose[k] === 0) && pose.owner === null, 'zwinięte, bez właściciela');
  assert.equal(stateOf(w).lamp, K7_SERVICE_LAMP.free);
  // zjazd z pola powoli (20 j/s w poprzek): też odpięcie, ale dopiero za zapasem pola
  const w2 = world();
  const s2 = shipOn(w2);
  run(w2, s2, 8);
  const a = s2.angle + Math.PI / 2;
  s2.vel.x = 20 * Math.cos(a); s2.vel.y = 20 * Math.sin(a);
  let releasedAt = -1;
  let tt = 0;
  run(w2, s2, 30, () => { tt += DT; if (releasedAt < 0 && stateOf(w2).state === 'release') releasedAt = tt; });
  const off = releasedAt * 20;
  const cap = createK7Layout().berths[0].capture;
  assert.ok(off > cap.halfWidth + K7_SERVICE_TUNE.leaveMargin - 2 && off < cap.halfWidth + K7_SERVICE_TUNE.leaveMargin + 2,
    `odpięcie na brzegu pola z zapasem: ${off.toFixed(0)} j.`);
});

test('przerwane podpinanie: odpięcie od bieżącej pozy, bez skoków; po odpięciu ponowny postój podpina od nowa', () => {
  const w = world();
  const ship = shipOn(w);
  const pose = poseOf(w);
  run(w, ship, K7_SERVICE_TUNE.dwell + 3.9);
  assert.equal(stateOf(w).state, 'dock');
  assert.ok(pose.extension > 0.99 && pose.seat > 0 && pose.seat < 1 && pose.lock === 0 && pose.clamp === 1,
    `w połowie podpinania (złączka schodzi na wlew): ${JSON.stringify(snap(pose))}`);
  let prev = snap(pose);
  let jump = 0;
  ship.vel.x = 80 * Math.cos(ship.angle);
  ship.vel.y = 80 * Math.sin(ship.angle);
  run(w, ship, K7_SERVICE_RELEASE.end + 0.2, () => {
    for (const k of KEYS) jump = Math.max(jump, Math.abs(pose[k] - prev[k]));
    prev = snap(pose);
  });
  assert.ok(jump < 0.15, `ciągłe przejście (największy krok ${jump.toFixed(3)})`);
  assert.equal(stateOf(w).state, 'idle');
  // statek wraca i staje — podpięcie od nowa
  const back = shipOn(w);
  ship.pos.x = back.pos.x; ship.pos.y = back.pos.y; ship.vel.x = 0; ship.vel.y = 0;
  run(w, ship, 8);
  assert.equal(stateOf(w).state, 'docked');
});

test('fabuła: poza z właścicielem nietknięta; oddana — statek musi najpierw zjechać z pola; niezwinięta zwija się', () => {
  const w = world();
  const ship = shipOn(w, 'C-01', 0, Math.PI);   // jak w kampanii: dziobem ku bramie
  const pose = poseOf(w);
  Object.assign(pose, { clamp: 1, extension: 1, seat: 1, lock: 1, flow: 1, vent: 0.3, owner: K7_POSE_OWNER.story });
  const before = snap(pose);
  run(w, ship, 12);
  assert.deepEqual(snap(pose), before, 'automat nie pisze cudzej pozy');
  assert.equal(pose.owner, K7_POSE_OWNER.story);
  assert.equal(stateOf(w).state, 'foreign');
  // lampki: cudzego stanowiska automat nie rusza
  const berths = createK7Layout().berths;
  berths[0].occupied = 'player';
  syncK7BerthLamps(w.svc, 0, berths);
  assert.equal(berths[0].occupied, 'player');
  // koniec odcumowania fabuły: poza zwinięta, oddana; statek dalej stoi na polu → bez ponownego podpięcia
  Object.assign(pose, { clamp: 0, extension: 0, seat: 0, lock: 0, flow: 0, vent: 0, owner: null });
  run(w, ship, 10);
  assert.ok(KEYS.every((k) => pose[k] === 0), 'po ODDOKUJ przewody nie wracają');
  assert.equal(stateOf(w).armed, false);
  // statek rusza (wylot), po czym wraca i staje — wtedy automat podpina
  ship.vel.x = 100 * Math.cos(ship.angle); ship.vel.y = 100 * Math.sin(ship.angle);
  run(w, ship, 1);
  assert.equal(stateOf(w).armed, true, 'uzbrojony po zjeździe z pola');
  const back = shipOn(w, 'C-01', 0, Math.PI);
  ship.pos.x = back.pos.x; ship.pos.y = back.pos.y; ship.vel.x = 0; ship.vel.y = 0;
  run(w, ship, 8);
  assert.equal(stateOf(w).state, 'docked');
  // fabuła przejmuje stanowisko w trakcie obsługi automatu (dockReturn): automat milknie od razu
  pose.owner = K7_POSE_OWNER.story;
  pose.seat = 0.42;
  run(w, ship, 2);
  assert.equal(pose.seat, 0.42);
  // przerwana kampania: poza oddana niezwinięta → automat ją zwija (bez ponownego podpięcia)
  Object.assign(pose, { clamp: 1, extension: 1, seat: 1, lock: 1, flow: 1, vent: 0 });
  pose.owner = null;
  run(w, ship, K7_SERVICE_RELEASE.end + 1);
  assert.ok(KEYS.every((k) => pose[k] === 0) && pose.owner === null, 'zwinięta');
  assert.equal(stateOf(w).state, 'idle');
});

test('lampki stanowisk: postój — zarezerwowane, obsługa — zajęte, spoczynek — wolne', () => {
  const w = world();
  const ship = shipOn(w, 'C-03', 2);
  const berths = createK7Layout().berths;
  for (const b of berths) { b.occupied = null; b.reserved = null; }
  const c3 = berths.find((b) => b.id === 'C-03');
  run(w, ship, 1);
  assert.equal(syncK7BerthLamps(w.svc, 2, berths), true);
  assert.deepEqual([c3.occupied, c3.reserved], [null, 'player']);
  assert.equal(syncK7BerthLamps(w.svc, 2, berths), false, 'bez zmian — bez przeładowania lampek');
  run(w, ship, 2);
  syncK7BerthLamps(w.svc, 2, berths);
  assert.deepEqual([c3.occupied, c3.reserved], ['player', 'player']);
  const other = createK7Layout().berths;
  for (const b of other) { b.occupied = null; b.reserved = null; }
  assert.equal(syncK7BerthLamps(w.svc, 0, other), false, 'inna hala: jej stanowiska wolne');
  ship.vel.x = 300;
  run(w, ship, K7_SERVICE_RELEASE.end + 0.2);
  syncK7BerthLamps(w.svc, 2, berths);
  assert.deepEqual([c3.occupied, c3.reserved], [null, null]);
});

test('klej: czysty moduł, krok w HaloRingGame._portVisuals przed halami, czas gry z index.html, właściciel w fabule', () => {
  const mod = strip(readFileSync(new URL('../src/game/k7BerthService.js', import.meta.url), 'utf8'));
  for (const bad of ['window', 'document', "from 'three'", 'Core3D', 'Math.random', 'performance.now']) assert.ok(!mod.includes(bad), `bez ${bad}`);
  const step = mod.slice(mod.indexOf('export function stepK7BerthService'), mod.indexOf('export function syncK7BerthLamps'));
  assert.ok(!/new |\[\]|=\s*\{/.test(step), 'krok bez alokacji');
  const game = strip(readFileSync(new URL('../src/3d/haloRing/haloRingGame.js', import.meta.url), 'utf8'));
  const pv = game.slice(game.indexOf('_portVisuals(e, dt, ship'), game.indexOf('constrainShip(ship'));
  assert.ok(pv.indexOf('stepK7BerthService(') > 0 && pv.indexOf('stepK7BerthService(') < pv.indexOf('hall.update('), 'automat przed rysowaniem hal');
  assert.ok(pv.indexOf('syncK7BerthLamps(') < pv.indexOf('hall.update('));
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /haloRings\.update\(frameDt, cam, \{[\s\S]{0,400}gameDt: \(PAUSED \|\| StoryGame\.worldFrozen\) \? 0 : frameDt/);
  const story = strip(readFileSync(new URL('../src/game/story/storyGame.js', import.meta.url), 'utf8'));
  assert.ok(/target\.owner = K7_POSE_OWNER\.story/.test(story), 'fabuła oznacza swoją pozę');
  assert.ok(/_releaseHallPose\(\)/.test(story.slice(story.indexOf('_reset(reason)'))), 'reset oddaje pozę');
});
