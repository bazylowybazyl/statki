// WARP ZAWSZE DO CELU (DECYZJE-2 T1–T4, 2026-10-26): wybór skoku klawiszem warpa (kurs → cel w stożku ±20° → skok
// awaryjny 400 tys. j.), planista skoku awaryjnego (skrócony przed studnią i brzegiem świata), oś czasu planu trasy,
// przyciąganie TRAVEL TO w CIC, stałe kąty planet z ziarna zapisu, hipercruise krótkich odcinków TRAVEL TO.
// node --test tests/warpDoCelu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WARP_COURSE_TUNE, warpConeError, pickWarpConeTarget, chooseWarpJump, warpConeAimPoint, warpChargeTurn, WARP_CHARGE_TURN,
  warpCourseInCone
} from '../src/game/warpCourse.js';
import {
  WARP_EMERGENCY, WARP_EXIT, planWarpEmergency, warpExitRampTime, createWarpExitRamp, warpLegTimeline, simulateWarpLeg,
  planWarpCruise, warpTripTuneFor, warpExitRampDistance, WARP_FLYBY_DEFAULTS
} from '../src/game/warpDrive.js';
import {
  TRAVEL_TUNE, travelHypercruiseLegOk, travelApproachPoint, snapTravelTarget, planTravelLeg
} from '../src/game/travelNav.js';
import { loadIndexFunction } from './helpers/indexSource.mjs';
import {
  buildSystemMap, normalizeWorldSeed, planetAngleFromSeed, systemMapAngleForSeed, resolveWorldSeed, SYSTEM_MAP_PLANETS
} from '../src/data/systemMap.js';
import { ECONOMY_SAVE_VERSION } from '../src/game/traffic/economySave.js';
import { HYPERCRUISE_TUNE, WARP_DRIVES } from '../src/data/driveModes.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const deg = Math.PI / 180;
const html = read('index.html');
function sliceFunction(src, head) {
  const start = src.indexOf(head);
  assert.ok(start >= 0, head);
  return src.slice(start, src.indexOf('\n    }\n', start) + 6);
}

// ── T1: stożek celu ─────────────────────────────────────────────────────────────────────────────────────────────
test('T1 stożek: odchyłka z tarczą (dziób na studni = 0), ±20°, kolejność — najmniejsza odchyłka, potem najbliższy', () => {
  const pos = { x: 0, y: 0 };
  assert.equal(WARP_COURSE_TUNE.cone, 20 * deg);
  assert.ok(near(warpConeError(pos, 0, 100000, 100000 * Math.tan(10 * deg)), 10 * deg, 1e-9));
  // tarcza 50 tys. j. w 100 tys. j. (atan 0,5 = 26,6°) — dziób 25° obok środka trafia w tarczę
  assert.equal(warpConeError(pos, 0, 100000 * Math.cos(25 * deg), 100000 * Math.sin(25 * deg), 50000), 0);
  const legFor = (c) => ({ x: c.tx ?? c.x, y: c.ty ?? c.y, kind: 'warp' });
  const a = { x: 500000, y: 500000 * Math.tan(12 * deg), r: 0, label: 'A' };
  const b = { x: 900000, y: 900000 * Math.tan(4 * deg), r: 0, label: 'B' };
  const off = { x: 300000, y: 300000 * Math.tan(25 * deg), r: 0, label: 'poza' };
  const pick = pickWarpConeTarget(pos, 0, [a, b, off], legFor);
  assert.equal(pick.cand, b, 'mniejsza odchyłka wygrywa');
  assert.ok(near(pick.bearing, 4 * deg, 1e-9), 'dokładny namiar');
  // dwa cele na tarczy (odchyłka 0) — bliższy
  const p1 = { x: 800000, y: 0, r: 100000, label: 'daleka planeta' };
  const p2 = { x: 300000, y: 30000, r: 60000, label: 'bliska planeta' };
  assert.equal(pickWarpConeTarget(pos, 0, [p1, p2], legFor).cand, p2);
  assert.equal(pickWarpConeTarget(pos, 0, [off], legFor), null, 'poza stożkiem — nic');
  // za blisko (minDist) — pominięty
  assert.equal(pickWarpConeTarget(pos, 0, [{ x: 30000, y: 0 }], legFor, { minDist: 40000 }), null);
});

test('T1 stożek: odcinek planisty musi być skokiem w stożku (nie dolot napędem, nie objazd w bok)', () => {
  const pos = { x: 0, y: 0 };
  const c = { x: 600000, y: 0, r: 0, label: 'C' };
  const d = { x: 700000, y: 70000, r: 0, label: 'D' };
  // C: pierwszy odcinek to objazd studni 60° w bok — pominięty; D: skok prosto
  const legFor = (t) => (t === c ? { x: 100000, y: 173000, kind: 'warp' } : { x: t.x, y: t.y, kind: 'warp' });
  assert.equal(pickWarpConeTarget(pos, 0, [c, d], legFor).cand, d);
  // dolot napędem (cel bliżej niż minWarp / w studni startu) — nie jest skokiem
  assert.equal(pickWarpConeTarget(pos, 0, [c], () => ({ x: 600000, y: 0, kind: 'drive' })), null);
  assert.equal(pickWarpConeTarget(pos, 0, [c], () => null), null);
});

test('T1 wybór skoku: kurs w ±5° → cel w stożku → skok awaryjny; skok awaryjny za krótki — odmowa z powodem', () => {
  const pos = { x: 0, y: 0 };
  const legFor = (c) => ({ x: c.x, y: c.y, kind: 'warp' });
  const em = (dx, dy) => planWarpEmergency(pos, dx, dy, [], null);
  const course = { x: 500000, y: 500000 * Math.tan(4 * deg), kind: 'warp' };
  const cone = { x: 400000, y: 400000 * Math.tan(15 * deg), label: 'Mars' };
  let j = chooseWarpJump({ pos, heading: 0, courseLeg: course, courseLabel: 'K-7', candidates: [cone], legFor, emergency: em });
  assert.equal(j.kind, 'course');
  assert.equal(j.label, 'K-7');
  assert.ok(near(j.bearing, 4 * deg, 1e-9));
  // kurs poza ±5°, ale w stożku ±20° — kurs gracza wygrywa z innym celem w stożku (recenzja T ust. 6: kurs na Jowisza
  // 8° od dzioba i Mars w stożku — skok idzie kursem)
  j = chooseWarpJump({ pos, heading: 0, courseLeg: { ...course, y: 500000 * Math.tan(8 * deg) }, courseLabel: 'Jowisz', candidates: [{ ...cone, y: 0 }], legFor, emergency: em });
  assert.equal(j.kind, 'course');
  assert.equal(j.label, 'Jowisz');
  assert.ok(near(j.bearing, 8 * deg, 1e-9));
  assert.ok(warpCourseInCone(8 * deg) && !warpCourseInCone(20.01 * deg));
  // kurs poza stożkiem — cel ze stożka (kurs zostaje dla HUD-u, skok idzie do celu przed dziobem)
  j = chooseWarpJump({ pos, heading: 0, courseLeg: { ...course, y: 500000 * Math.tan(25 * deg) }, candidates: [cone], legFor, emergency: em });
  assert.equal(j.kind, 'cone');
  assert.equal(j.label, 'Mars');
  // odcinek napędem nie jest kursem skoku
  j = chooseWarpJump({ pos, heading: 0, courseLeg: { ...course, kind: 'drive' }, candidates: [], legFor, emergency: em });
  assert.equal(j.kind, 'emergency');
  assert.equal(j.bearing, 0, 'skok awaryjny dokładnie w dziób');
  assert.ok(near(j.aim.x, WARP_EMERGENCY.dist) && near(j.aim.y, 0));
  // studnia 30 tys. j. przed dziobem — za krótko
  j = chooseWarpJump({ pos, heading: 0, candidates: [], legFor, emergency: (dx, dy) => planWarpEmergency(pos, dx, dy, [{ x: 40000, y: 0, r: 9000 }], null) });
  assert.equal(j.kind, null);
  assert.equal(j.reason, 'well');
});

// ── T1: skok awaryjny ───────────────────────────────────────────────────────────────────────────────────────────
test('T1 skok awaryjny: 400 tys. j. w dziób; skrócony przed brzegiem studni (zapas jak TRAVEL TO) i świata; studnia startu nie skraca', () => {
  assert.equal(WARP_EMERGENCY.dist, 400000);
  assert.equal(WARP_EMERGENCY.minDist, TRAVEL_TUNE.minWarp, 'najkrótszy skok = najkrótszy odcinek warpem TRAVEL TO');
  assert.equal(WARP_EMERGENCY.wellMargin, TRAVEL_TUNE.wellMargin, 'koniec przed studnią z tym samym zapasem co TRAVEL TO');
  const pos = { x: 1_000_000, y: 1_000_000 };
  const free = planWarpEmergency(pos, 1, 0, [], { w: 1e7, h: 1e7 });
  assert.ok(free.ok && free.cut === 'none' && near(free.dist, 400000) && near(free.x, 1_400_000));
  // studnia na kursie: koniec dokładnie wellMargin przed brzegiem
  const well = { x: 1_300_000, y: 1_010_000, r: 50000 };
  const cut = planWarpEmergency(pos, 1, 0, [well], { w: 1e7, h: 1e7 });
  assert.equal(cut.cut, 'well');
  assert.equal(cut.well, well);
  assert.ok(near(Math.hypot(cut.x - well.x, cut.y - well.y), well.r + TRAVEL_TUNE.wellMargin, 1e-6));
  assert.ok(cut.ok && cut.dist < 400000);
  // studnia, w której statek stoi (port) — wylot, bez skracania
  const home = { x: 1_010_000, y: 1_000_000, r: 60000 };
  assert.equal(planWarpEmergency(pos, 1, 0, [home], { w: 1e7, h: 1e7 }).cut, 'none');
  // studnia za rufą / obok kursu — bez wpływu
  assert.equal(planWarpEmergency(pos, 1, 0, [{ x: 600000, y: 1_000_000, r: 50000 }, { x: 1_200_000, y: 1_200_000, r: 50000 }], null).cut, 'none');
  // brzeg świata: koniec edgeMargin przed brzegiem, za krótko — odmowa
  const edge = planWarpEmergency({ x: 9_800_000, y: 5e6 }, 1, 0, [], { w: 1e7, h: 1e7 });
  assert.equal(edge.cut, 'edge');
  assert.ok(near(edge.x, 1e7 - WARP_EMERGENCY.edgeMargin) && edge.ok);
  const wall = planWarpEmergency({ x: 9_950_000, y: 5e6 }, 1, 0, [], { w: 1e7, h: 1e7 });
  assert.equal(wall.ok, false);
  assert.equal(wall.cut, 'edge');
  // kierunek nieznormalizowany — ten sam wynik
  const n2 = planWarpEmergency(pos, 3, 4, [], null);
  assert.ok(near(n2.x - pos.x, 240000) && near(n2.y - pos.y, 320000));
});

test('T1 skok awaryjny: czasy Mk I / II / III i tempo warstw (W0) — prędkość przelotowa ponad limit kamery gwiazd', () => {
  // AGENT: STAR_SPEED_CAP w warpNurt.js — gwiazdy w warpie liczą tempo z min(v, 14 000), wszystkie warstwy (deep / mid /
  // speed) z TEJ SAMEJ prędkości kamery, więc kolejność W0 (DECYZJE-2) nie zależy od prędkości skoku. Poza mijanym ciałem
  // skok awaryjny leci ponad limitem także w strefie planety (× 0,3) — gwiazdy mają wtedy dokładnie tempo zwykłego skoku.
  // Przy mijanym ciele (zwolnienie do 1 − depth = 0,15) skok awaryjny schodzi pod limit (Mk II: 9,0 tys. j/s, w strefie
  // planety 2,7 tys.) — wszystkie warstwy gwiazd zwalniają w tej samej proporcji (recenzja T ust. 12).
  const cap = Number(/const STAR_SPEED_CAP = (\d+);/.exec(read('src/3d/warp/warpNurt.js'))?.[1]);
  assert.equal(cap, 14000);
  const out = {};
  for (const id of ['warp_mk1', 'warp_mk2', 'warp_mk3']) {
    const tune = warpTripTuneFor(WARP_DRIVES[id].speed);
    const plan = planWarpCruise({ dist: WARP_EMERGENCY.dist, v0: 0, hullLength: 1800, bodies: [], entry: 0.9, lag: 6, dt: 1 / 30 }, tune);
    out[id] = plan;
    assert.ok(plan.speed * 0.3 > cap, `${id}: ${Math.round(plan.speed)} j/s × 0,3 > ${cap}`);
    // przy mijanym ciele — pod limitem (tempo gwiazd × v / cap, wspólne dla warstw)
    assert.ok(plan.speed * (1 - WARP_FLYBY_DEFAULTS.depth) < cap, `${id}: przy mijanym ciele pod limitem kamery gwiazd`);
    assert.ok(plan.time > 5 && plan.time < 9, `${id}: czas do wyjścia ${plan.time.toFixed(2)} s`);
  }
  assert.ok(out.warp_mk1.time >= out.warp_mk2.time && out.warp_mk2.time >= out.warp_mk3.time - 1e-9);
});

// ── T2: plan trasy (oś czasu) ───────────────────────────────────────────────────────────────────────────────────
test('T2 plan trasy: oś czasu = ta sama symulacja co plan prędkości; znaczniki mijane po kolei; czas rampy = tHalt', () => {
  const o = { dist: 1_200_000, v0: 0, hullLength: 1800, bodies: [{ along: 600000, lateral: 120000, r: 48000 }],
    zone: (s) => (s > 300000 && s < 500000 ? 0.8 : 1), entry: 0.9, lag: 6, dt: 1 / 30 };
  const plan = planWarpCruise(o, warpTripTuneFor(175000));
  const marks = new Float64Array([600000, 300000, 500000, -1, 5e9, NaN]);
  const T = new Float64Array(6);
  const res = {};
  const t = warpLegTimeline(plan.speed, o, marks, T, res, plan.target + 30);
  assert.equal(t, simulateWarpLeg(plan.speed, o, plan.target + 30), 'ta sama oś co plan prędkości');
  assert.equal(res.exitT, t);
  assert.ok(res.exitV > 0 && res.exitS > 0 && res.exitS < o.dist);
  assert.ok(T[1] > 0 && T[1] < T[2] && T[2] < T[0] && T[0] < t, `${[...T]}`);
  assert.equal(T[3], 0, 'za punktem skoku — od razu');
  assert.ok(Number.isNaN(T[4]) && Number.isNaN(T[5]), 'po początku wyjścia / brak — NaN');
  for (const [v0, vEnd] of [[175000, 0], [60000, 1521], [3000, 1500]]) {
    assert.ok(near(warpExitRampTime(v0, 1800, vEnd), createWarpExitRamp({ v0, hullLength: 1800, vEnd }).tHalt, 1e-9));
  }
  assert.equal(WARP_EXIT.ahead, undefined, 'wysunięcie swobodnego skoku usunięte');
});

test('T2 w grze: każdy skok ma koniec — plan trasy przy kopie, wyjście automatyczne, kadr przylotu K1 także dla punktu', () => {
  const plan = sliceFunction(html, '    function planPlayerWarp(dirX, dirY) {');
  // skok bez punktu końca (narzędzia) — koniec z planu skoku awaryjnego, wyjście automatyczne
  assert.match(plan, /if \(!end && !travelNav\.active && !_tugWarp\.active\) \{[\s\S]*?planWarpEmergency\([\s\S]*?warpCourse\.autoExit = true;/);
  assert.match(plan, /rt\.arrive = warp\.targetBody \? 'body' : 'point';/);
  // wyjście automatyczne działa bez kursu TRAVEL TO (cel w stożku, skok awaryjny), holownik — osobno
  const step = sliceFunction(html, '    function stepWarpCourse(dt) {');
  assert.match(step, /if \(travelNav\.active \|\| PAUSED \|\| _tugWarp\.active\) return;\s*if \(warp\.state === 'active'\) \{/);
  // kamera: punkt — odległość 0 (kadr skoku bez odsuwania), ciało celu — brzeg tarczy; arriving jak soczewka
  const kick = sliceFunction(html, '    function updateCameraWarpKick(gameDt) {');
  assert.match(kick, /const tgt = rt && rt\.active && rt\.arrive === 'point' \? null : warp\.targetBody;/);
  assert.match(kick, /\} else \{\s*w\.arrivalDist = 0;/);
  assert.doesNotMatch(kick, /arrivalDist = -1;\s*w\.arrivalDepthK = 0;\s*\}\s*\}/, 'bez gałęzi „swobodny skok — bez celu”');
  // HUD kursu warpa także bez kursu TRAVEL TO (punkt skoku z klawisza)
  const hud = sliceFunction(html, '      function drawWarpCourseOverlay(camRef, clipX, clipW) {'.slice(2));
  assert.match(hud, /const ownAim = !!warpCourse\.aim && !_tugWarp\.active;/);
  assert.match(hud, /\(!travelNav\.target && !ownAim\)/);
});

// ── T1: CIC — przyciąganie TRAVEL TO ────────────────────────────────────────────────────────────────────────────
test('T1 CIC: TRAVEL TO przyciąga do najbliższego celu (tarcza ciała liczy się jak trafienie), w próżni — punkt', () => {
  const st = { x: 1000, y: 0, snapR: 200, label: 'Stacja' };
  const planet = { x: 0, y: 0, snapR: 8000, label: 'Ziemia' };
  // klik na tarczy planety obok stacji: odległość od brzegu tarczy (0) wygrywa
  assert.equal(snapTravelTarget(3000, 3000, [st, planet], 500), planet);
  // klik przy stacji poza tarczą planety
  const far = { x: 50000, y: 0, snapR: 8000, label: 'Mars' };
  const st2 = { x: 70000, y: 0, snapR: 200, label: 'Port' };
  assert.equal(snapTravelTarget(70500, 0, [far, st2], 1000), st2);
  assert.equal(snapTravelTarget(200000, 0, [far, st2], 1000), null, 'w próżni — punkt');
  assert.equal(snapTravelTarget(0, 0, null, 10), null);
  // punkt podróży: brzeg studni + zapas od strony statku
  const ap = travelApproachPoint({ x: 0, y: 0 }, { x: 1e6, y: 0 }, 100000);
  assert.ok(near(ap.x, 100000 + TRAVEL_TUNE.wellMargin * 2) && near(ap.y, 0));
  assert.deepEqual(travelApproachPoint({ x: 5, y: 6 }, { x: 0, y: 0 }, 0), { x: 5, y: 6 });
  const cic = read('src/ui/cicDisplay.js');
  assert.match(cic, /window\.travelToSnapped\(worldX, worldY, snapR\)/);
  assert.match(cic, /hint: snap \? cicTravelHint\(snap\.label\) : 'PUNKT'/);
  assert.match(html, /return setTravelTarget\(worldX, worldY, 'PUNKT'\);/);
});

test('T1 cele znane grze: ciała, stacje (mgła wojny), misja, pas (olbrzymy, pola), wraki, kontakty — jedna lista dla stożka i CIC', () => {
  const fn = sliceFunction(html, '    function collectTravelTargets(from = ship?.pos) {');
  for (const kind of ['body', 'station', 'mission', 'belt', 'wreck', 'contact']) assert.match(fn, new RegExp(`kind: '${kind}'`), kind);
  assert.match(fn, /hides\(st\)/, 'stacja ukryta mgłą nie jest celem');
  assert.match(fn, /isCloakHidden\(n\)/, 'maskowany wróg nie jest celem');
  const start = sliceFunction(html, '    function startManualWarpCharge() {');
  assert.match(start, /const pick = chooseManualWarpJump\(\);/);
  assert.match(start, /warp\.chargeAngle = pick\.bearing;/);
  assert.doesNotMatch(start, /ship\.angle;\s*warp\.state = 'charging'/, 'bez swobodnego skoku w dziób bez końca');
  // skok awaryjny kończy się przed studniami stref hamowania grawitacyjnego (słońce, baza piratów)
  const wells = sliceFunction(html, '    function warpEmergencyWells() {');
  assert.match(wells, /SUN\.r/);
  assert.match(wells, /pirateOrbitRadii\(\)/);
});

// ── T3: stałe kąty planet ───────────────────────────────────────────────────────────────────────────────────────
test('T3 kąty planet z ziarna świata: deterministyczne, zależne od id (nie od kolejności), inne dla innego ziarna', () => {
  const a1 = buildSystemMap(140, { angleFor: systemMapAngleForSeed(12345) }).planets;
  const a2 = buildSystemMap(140, { angleFor: systemMapAngleForSeed(12345) }).planets;
  const b = buildSystemMap(140, { angleFor: systemMapAngleForSeed(12346) }).planets;
  assert.deepEqual(a1.map((p) => p.angle), a2.map((p) => p.angle));
  assert.ok(a1.some((p, i) => Math.abs(p.angle - b[i].angle) > 0.1), 'inne ziarno — inny układ');
  for (const p of a1) assert.ok(p.angle >= 0 && p.angle < Math.PI * 2);
  // kąt z id: odwrócona tabela daje te same kąty planet
  const rev = buildSystemMap(140, { planets: [...SYSTEM_MAP_PLANETS].reverse(), angleFor: systemMapAngleForSeed(12345) }).planets;
  for (const p of rev) assert.equal(p.angle, planetAngleFromSeed(12345, p.id));
  // rozkład: 2000 ziaren × 8 planet — każda ćwiartka koła 20–30%
  const q = [0, 0, 0, 0];
  for (let s = 0; s < 2000; s++) for (const p of SYSTEM_MAP_PLANETS) q[Math.floor(planetAngleFromSeed(s * 7919, p.id) / (Math.PI / 2))]++;
  for (const n of q) assert.ok(n / 16000 > 0.2 && n / 16000 < 0.3, `${q}`);
  assert.equal(normalizeWorldSeed('42'), 42);
  for (const bad of [null, '', -1, 1.5, 2 ** 32, 'abc', NaN]) assert.equal(normalizeWorldSeed(bad), null, String(bad));
});

test('T3 ziarno przy starcie strony: ?ziarno=<n> / nowe, zapis tej wersji, bez zapisu albo obca wersja — nowe', () => {
  const rnd = () => 0.25;
  const save = (seed, version = ECONOMY_SAVE_VERSION) => JSON.stringify({ version, worldSeed: seed, world: { version } });
  assert.deepEqual(resolveWorldSeed('?ziarno=777', save(5), ECONOMY_SAVE_VERSION, rnd), { seed: 777, source: 'url' });
  assert.deepEqual(resolveWorldSeed('?ziarno=nowe', save(5), ECONOMY_SAVE_VERSION, rnd), { seed: 1073741824, source: 'new' });
  assert.deepEqual(resolveWorldSeed('', save(5), ECONOMY_SAVE_VERSION, rnd), { seed: 5, source: 'save' });
  assert.deepEqual(resolveWorldSeed('', JSON.parse(save(5)), ECONOMY_SAVE_VERSION, rnd), { seed: 5, source: 'save' });
  assert.equal(resolveWorldSeed('', save(5, 1), ECONOMY_SAVE_VERSION, rnd).source, 'new', 'zapis wersji 1 (losowe kąty) — nowe ziarno');
  assert.equal(resolveWorldSeed('', null, ECONOMY_SAVE_VERSION, rnd).source, 'new');
  assert.equal(resolveWorldSeed('', '{śmieci', ECONOMY_SAVE_VERSION, rnd).source, 'new');
  assert.equal(resolveWorldSeed('', save('x'), ECONOMY_SAVE_VERSION, rnd).source, 'new');
  assert.equal(resolveWorldSeed('?ziarno=-3', null, ECONOMY_SAVE_VERSION, rnd).source, 'new');
});

test('T3 w grze: wersja zapisu podbita (2), ziarno w zapisie, planety z ziarna, wczytanie tylko w tym samym układzie', () => {
  assert.equal(ECONOMY_SAVE_VERSION, 2);
  const seedVer = Number(/const WORLD_SEED_SAVE_VERSION = (\d+);/.exec(html)?.[1]);
  assert.equal(seedVer, ECONOMY_SAVE_VERSION, 'WORLD_SEED_SAVE_VERSION = ECONOMY_SAVE_VERSION');
  assert.match(html, /resolveWorldSeed\(location\.search, raw, WORLD_SEED_SAVE_VERSION\)/);
  // ziarno ustalone, zanim powstaną planety
  assert.ok(html.indexOf('const WORLD_SEED = WORLD_SEED_INFO.seed;') < html.indexOf('const PLANET_DATA = USE_SOLAR ? makeSolarPlanets()'));
  assert.match(sliceFunction(html, '    function makeSolarPlanets() {'), /angleFor: systemMapAngleForSeed\(WORLD_SEED\)/);
  assert.match(sliceFunction(html, '    function buildEconomySave() {'), /worldSeed: WORLD_SEED,/);
  assert.match(sliceFunction(html, '    function loadEconomyIntoWorld() {'), /if \(saved\.worldSeed !== WORLD_SEED\) \{/);
});

// ── T4: hipercruise krótkich odcinków ───────────────────────────────────────────────────────────────────────────
test('T4 hipercruise odcinka TRAVEL TO: start tylko, gdy odcinek ≥ minLeg + stopMargin (bez pętli start / wyjście)', () => {
  // Atlas: wyjście 1000 j/s, hamowanie 200 j/s² → 2500 j. + pół promienia przylotu 1600 j.
  const margin = (HYPERCRUISE_TUNE.exitSpeed ** 2) / (2 * 200) + TRAVEL_TUNE.arriveRadius * 0.5;
  assert.equal(margin, 4100);
  const lim = HYPERCRUISE_TUNE.minLeg + margin;
  assert.equal(travelHypercruiseLegOk(lim - 1, HYPERCRUISE_TUNE.minLeg, margin), false, 'dawna pętla: 6–10,1 km');
  assert.equal(travelHypercruiseLegOk(8000, HYPERCRUISE_TUNE.minLeg, margin), false);
  assert.equal(travelHypercruiseLegOk(lim, HYPERCRUISE_TUNE.minLeg, margin), true);
  assert.equal(travelHypercruiseLegOk(NaN, 6000, 0), false);
  const fn = sliceFunction(html, '    function travelTryHypercruise(leg) {');
  assert.match(fn, /if \(!travelHypercruiseLegOk\(d, HYPERCRUISE_TUNE\.minLeg, playerHypercruiseStopMargin\(\)\)\) return false;/);
  // ten sam zapas co automat hipercruise'u (jedna funkcja)
  assert.match(sliceFunction(html, '    function stepPlayerHypercruise(dt) {'), /c\.stopMargin = playerHypercruiseStopMargin\(c\.exitSpeed\);/);
  const sm = sliceFunction(html, '    function playerHypercruiseStopMargin(exitSpeed = HYPERCRUISE_TUNE.exitSpeed) {');
  assert.match(sm, /\(exitSpeed \* exitSpeed\) \/ \(2 \* brakeA\) \+ TRAVEL_TUNE\.arriveRadius \* 0\.5/);
});

// ── Recenzja T (2026-10-26): obrót w ładowaniu, punkt skoku ze stożka, jądro studni startu, wylot ze studni ───────────
test('recenzja T ust. 1: punkt skoku do ciała ze stożka — namiar ≤ stożek od dzioba, wejście promienia w brzeg studni', () => {
  assert.equal(WARP_COURSE_TUNE.coneWellMargin, TRAVEL_TUNE.wellMargin * 2, '= zapas travelApproachPoint (CIC)');
  const pos = { x: 0, y: 0 };
  const m = WARP_COURSE_TUNE.coneWellMargin;
  // scenariusz recenzji: tarcza 50 tys. j. w 100 tys. j., dziób 25° obok środka — dziób trafia w studnię: bez obrotu
  const c = { x: 100000 * Math.cos(25 * deg), y: 100000 * Math.sin(25 * deg), r: 50000 };
  const a = warpConeAimPoint(pos, 0, c);
  assert.ok(Math.abs(Math.atan2(a.y, a.x)) < 1e-9, 'skok dokładnie w dziób');
  assert.ok(near(Math.hypot(a.x - c.x, a.y - c.y), 50000 + m, 1e-6), 'na brzegu studni + zapas');
  // dawniej punkt podróży na linii do środka: 25° skrętu kadłuba w skoku
  const old = travelApproachPoint(c, pos, c.r);
  assert.ok(near(Math.atan2(old.y, old.x), 25 * deg, 1e-9));
  // losowe ciała w stożku: obrót ≤ stożek, punkt = PIERWSZE wejście w okrąg studni (odcinek go nie przecina wcześniej)
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    const d = 45000 + ((i * 7919) % 2000) * 900;
    const r = 2000 + ((i * 104729) % 1000) * 0.002 * d * 0.9;
    if (!(d > r + m)) continue;
    const off = (((i * 31337) % 2001) / 1000 - 1) * (WARP_COURSE_TUNE.cone + Math.atan2(r, d));
    const body = { x: d * Math.cos(off), y: d * Math.sin(off), r };
    if (warpConeError(pos, 0, body.x, body.y, r) > WARP_COURSE_TUNE.cone) continue;
    const p = warpConeAimPoint(pos, 0, body);
    const turn = Math.abs(Math.atan2(p.y, p.x));
    worst = Math.max(worst, turn);
    assert.ok(turn <= WARP_COURSE_TUNE.cone + 1e-9, `obrót ${(turn / deg).toFixed(2)}°`);
    assert.ok(near(Math.hypot(p.x - body.x, p.y - body.y), r + m, 1e-4 * (r + m)));
    // środek odcinka pos → p leży poza studnią (pierwsze wejście)
    assert.ok(Math.hypot(p.x / 2 - body.x, p.y / 2 - body.y) > r);
  }
  assert.ok(worst > 15 * deg, `pokrycie: największy obrót ${(worst / deg).toFixed(1)}°`);
  // punkt (r = 0) — punkt podróży; statek w zapasie studni — punkt podróży
  assert.deepEqual(warpConeAimPoint(pos, 0, { x: 5, y: 6, tx: 7, ty: 8, r: 0 }), { x: 7, y: 8 });
  assert.deepEqual(warpConeAimPoint(pos, 0, { x: 50000, y: 0, tx: 1, ty: 2, r: 48500 }), { x: 1, y: 2 });
  // stożek: skok do ciała w dziób; ciało, w którego studni statek stoi — pominięte
  const legFor = (cand, aim) => ({ x: aim.x, y: aim.y, kind: 'warp' });
  const pick = pickWarpConeTarget(pos, 0, [{ ...c, label: 'P' }], legFor);
  assert.ok(pick && Math.abs(pick.err) < 1e-9, 'skok do ciała w dziób');
  assert.equal(pickWarpConeTarget(pos, 0, [{ x: 30000, y: 0, r: 40000 }], legFor), null, 'studnia startu nie jest celem');
});

test('recenzja T ust. 1: dziób dociąga się do namiaru w ładowaniu (0,8 s) — bez skrętu w skoku, bez przeregulowania', () => {
  const rate = Math.PI / 2.5;   // warp.alignRate (72°/s)
  for (const startDeg of [0, 5, 20, 24, -24]) {
    let a = startDeg * deg;
    let w = 0;
    let maxW = 0;
    let maxDw = 0;
    const sign = Math.sign(-a);
    const dt = 1 / 60;
    for (let t = 0; t < 0.8 - 1e-9; t += dt) {
      const w2 = warpChargeTurn(a, w, 0, rate, dt);
      maxDw = Math.max(maxDw, Math.abs(w2 - w));
      w = w2;
      a += w * dt;
      maxW = Math.max(maxW, Math.abs(w));
      if (sign && Math.sign(a) === sign && Math.abs(a) > 0.01 * deg) assert.fail(`przeregulowanie z ${startDeg}°`);   // za namiarem
    }
    assert.ok(Math.abs(a) < 0.3 * deg, `z ${startDeg}°: reszta ${(a / deg).toFixed(3)}° po ładowaniu`);
    assert.ok(maxW <= rate + 1e-9, 'najwyżej alignRate');
    assert.ok(maxDw <= rate * Math.min(1, WARP_CHARGE_TURN.follow / 60) + 1e-9, 'prędkość kątowa bez skoku');
  }
  // gałąź ładowania gracza woła warpChargeTurn (holownik — jak dawniej)
  const charging = /else if \(warp\.state === 'charging'\) \{[\s\S]*?ship\.angle = wrapAngle\(ship\.angle \+ ship\.angVel \* dt\);/.exec(html)?.[0] || '';
  assert.match(charging, /if \(_tugWarp\.active\) ship\.angVel \*= Math\.exp\(-8 \* dt\);\s*else ship\.angVel = warpChargeTurn\(ship\.angle, ship\.angVel, warp\.chargeAngle, warp\.alignRate, dt\);/);
});

test('recenzja T ust. 8: skok awaryjny ze studni startu — wylot tak, w jądro (ring, planeta) nie', () => {
  const home = { x: 0, y: 0, r: 200000, rIn: 50000 };
  const m = WARP_EMERGENCY.wellMargin;
  // port w jądrze (40 tys. j. od środka): dziób na zewnątrz — pełny skok; w głąb — odmowa
  const port = { x: 40000, y: 0 };
  assert.equal(planWarpEmergency(port, 1, 0, [home], null).cut, 'none');
  const inward = planWarpEmergency(port, -1, 0.2, [home], null);
  assert.equal(inward.ok, false);
  assert.equal(inward.cut, 'well');
  assert.equal(planWarpEmergency(port, 0, 1, [home], null).cut, 'none', 'stycznie — wylot');
  // pas studni (150 tys. j.): dziób na jądro — koniec przed nim (z zapasem), obok jądra — bez skracania
  const band = { x: 150000, y: 0 };
  const cut = planWarpEmergency(band, -1, 0, [home], null);
  assert.equal(cut.cut, 'well');
  assert.ok(near(cut.dist, 150000 - 50000 - m, 1e-6) && cut.ok);
  assert.equal(planWarpEmergency(band, -1, 0.6, [home], null).cut, 'none', 'promień mija jądro');
  // bez rIn (dawne wpisy) — wylot jak dawniej
  assert.equal(planWarpEmergency(port, -1, 0, [{ x: 0, y: 0, r: 200000 }], null).cut, 'none');
});

// Prawdziwe funkcje index.html na zaślepionym świecie (recenzja T ust. 5).
function indexFns(scope, names) {
  for (const n of names) scope[n] = loadIndexFunction(html, `    function ${n}(`, n, scope);
  return scope;
}
const clampFn = (v, a, b) => Math.min(b, Math.max(a, v));

test('recenzja T ust. 5/14: collectTravelTargets (prawdziwa) — ciała, stacje (mgła), misja, pas, wraki (żywe, zimne z listy coldWrecks), kontakty', () => {
  const sc = {
    ship: { pos: { x: 0, y: 0 } },
    planets: [{ id: 'mars', label: 'Mars', x: 1e6, y: 0, r: 2000 }],
    window: { smallBodies: [{ id: 'ceres', label: 'Ceres', x: 0, y: 2e6, r: 4700, smallBody: true }], SensorSystem: { hides: (e) => !!e?.fogged } },
    planetOrbitRadii: (p) => ({ inner: p.r * 2, outer: p.r * 4, gravityWell: p.r * 30 }),
    travelApproachPoint, warpBodyRadius: (p) => p.r * 4.5,
    stations: [{ id: 'st1', name: 'Port Marsa', x: 1.05e6, y: 0, hp: 100, r: 300 }, { name: 'mgła', x: 5e5, y: 5e5, hp: 100, fogged: true },
      { name: 'trup', x: 1, y: 1, hp: 0 }],
    StoryGame: { ui: {
      markers: new Map([['m', { x: 3e5, y: 0, label: 'WARP-IN' }]]),
      targets: new Map([['t', { label: 'BAZA', radius: 5000, entity: { pos: { x: 4e6, y: 0 }, radius: 3000 } }], ['dead', { entity: { x: 1, y: 2, dead: true } }]])
    } },
    beltWorld: {
      giants: { entries: [{ id: 'g1', x: 2e6, y: 1e6, radius: 30000, site: { preset: { label: 'Olbrzym A' } } }] },
      field: { familyPeaks: () => [{ x: 2.2e6, y: 1e6, fam: 0 }], families: [{ title: 'Węglowe', label: 'C' }] }
    },
    wrecks: [{ x: 1e5, y: 1e5, radius: 500 }, { x: 2e5, y: 2e5, dead: true }, { x: 3e5, y: 3e5, _inPool: true }],
    coldWrecks: [{ x: 6e5, y: 6e5, radius: 800, isCold: true }, { x: 7e5, y: 7e5, isCold: false }, { x: 8e5, y: 8e5, isCold: true, fogged: true }],
    npcs: [{ x: 9e5, y: 0, hp: 10, radius: 400, name: 'Rabuś', hostile: true }, { x: 9e5, y: 1, hp: 10, hostile: true, cloaked: true },
      { x: 9e5, y: 2, hp: 10, hostile: false }, { x: 9e5, y: 3, hp: 0, hostile: true }, { x: 9e5, y: 4, hp: 10, hostile: true, fogged: true }],
    isHostileNpc: (n) => !!n.hostile, isCloakHidden: (n) => !!n.cloaked, getTargetX: (n) => n.x, getTargetY: (n) => n.y
  };
  indexFns(sc, ['collectTravelTargets']);
  const out = sc.collectTravelTargets();
  const by = (k) => out.filter((c) => c.kind === k);
  assert.deepEqual(by('body').map((c) => c.label), ['Mars', 'Ceres']);
  const mars = by('body')[0];
  assert.equal(mars.r, 60000, 'stożek: studnia ciała');
  assert.equal(mars.snapR, 9000, 'CIC: tarcza ciała');
  assert.ok(near(mars.tx, 1e6 - 60000 - TRAVEL_TUNE.wellMargin * 2) && near(mars.ty, 0), 'punkt podróży od strony statku');
  assert.deepEqual(by('station').map((c) => c.label), ['Port Marsa'], 'mgła wojny i zniszczone — poza listą');
  assert.deepEqual(by('mission').map((c) => c.label), ['WARP-IN', 'BAZA']);
  assert.deepEqual(by('belt').map((c) => c.label), ['OLBRZYM · OLBRZYM A', 'POLE · Węglowe']);
  assert.deepEqual(by('wreck').map((c) => c.x), [1e5, 6e5], 'wraki: żywe gorące + zimne z coldWrecks (bez martwych, z puli, mgły)');
  assert.deepEqual(by('contact').map((c) => c.label), ['KONTAKT · RABUŚ'], 'bez maskowanych, przyjaznych, martwych, we mgle');
});

function jumpWorld(extra = {}) {
  const sc = {
    ship: { pos: { x: 1e6, y: 1e6 }, angle: 0 },
    travelNav: { target: null, label: '' }, nextTravelLeg: () => null,
    planets: [], window: { smallBodies: [] },
    planetOrbitRadii: (p) => ({ inner: p.zr * 0.5, outer: p.zr, gravityWell: p.well }),
    SUN: { x: 9e6, y: 9e6, r: 30000 }, mercMission: null,
    pirateOrbitRadii: () => ({ inner: 20000, outer: 40000, gravityWell: 100000 }),
    WORLD: { w: 1e7, h: 1e7 }, WARP_EMERGENCY, planWarpEmergency, _warpEmergencyPlan: {},
    chooseWarpJump, planTravelLeg, planCruiseRoute: (a, b) => [b], clamp: clampFn,
    DevFlags: { unlimitedWarp: false }, warp: { fuelMax: 60 },
    travelMinWarpDist: () => TRAVEL_TUNE.minWarp,
    cands: [], collectTravelTargets: () => sc.cands,
    ...extra
  };
  return indexFns(sc, ['warpEmergencyWells', 'planPlayerWarpEmergency', 'travelLegToTarget', 'chooseManualWarpJump']);
}

test('recenzja T ust. 1/5/7/8: klawisz warpa (prawdziwe chooseManualWarpJump → planista TRAVEL TO, studnie skoku)', () => {
  // ciało 30° od dzioba, studnia 150 tys. j. w ~462 tys. j. (tarcza w stożku) — skok obraca dziób tylko o 12°, nie o 30°
  {
    const sc = jumpWorld();
    const d = 400000;
    const body = { id: 'a', x: 1e6 + d, y: 1e6 + d * Math.tan(30 * deg), zr: 60000, well: 150000 };
    sc.planets.push(body);
    sc.cands = [{ x: body.x, y: body.y, r: 150000, tx: 0, ty: 0, label: 'A', kind: 'body' }];
    const j = sc.chooseManualWarpJump();
    assert.equal(j.kind, 'cone');
    assert.equal(j.label, 'A');
    const dist = Math.hypot(body.x - 1e6, body.y - 1e6);
    assert.ok(near(j.bearing, 30 * deg - Math.atan2(150000, dist), 1e-9), `namiar ${(j.bearing / deg).toFixed(2)}°`);
    assert.ok(near(Math.hypot(j.aim.x - body.x, j.aim.y - body.y), 150000 + WARP_COURSE_TUNE.coneWellMargin, 1e-6));
  }
  // port w jądrze studni (ring): dziób na zewnątrz — skok awaryjny 400 tys. j.; w głąb — odmowa „studnia”
  {
    const sc = jumpWorld();
    sc.planets.push({ id: 'home', x: 1e6 - 5000, y: 1e6, zr: 8000, well: 20000 });
    let j = sc.chooseManualWarpJump();
    assert.equal(j.kind, 'emergency');
    assert.ok(near(j.plan.dist, WARP_EMERGENCY.dist));
    sc.ship.angle = Math.PI;
    j = sc.chooseManualWarpJump();
    assert.equal(j.kind, null);
    assert.equal(j.reason, 'well');
  }
  // pas studni startu, dziób na planetę — skok kończy się przed jej strefą orbit (z rampą), nie przez planetę
  {
    const sc = jumpWorld();
    sc.planets.push({ id: 'home', x: 1e6 - 150000, y: 1e6, zr: 50000, well: 200000 });
    sc.ship.angle = Math.PI;
    const j = sc.chooseManualWarpJump();
    assert.equal(j.kind, 'emergency');
    assert.ok(near(j.plan.dist, 150000 - 50000 - WARP_EMERGENCY.wellMargin, 1e-6) && j.plan.cut === 'well');
  }
  // cel misji w studni bazy piratów (ust. 7): odcinek do celu kończy się na brzegu studni bazy (rampa), nie w niej
  {
    const st = { x: 1e6 + 600000, y: 1e6 };
    const sc = jumpWorld({ mercMission: { station: st } });
    const ap = travelApproachPoint(st, sc.ship.pos, 5000, 2000);
    sc.cands = [{ x: st.x, y: st.y, r: 0, tx: ap.x, ty: ap.y, label: 'BAZA', kind: 'mission' }];
    const j = sc.chooseManualWarpJump();
    assert.equal(j.kind, 'cone');
    assert.ok(near(Math.hypot(j.aim.x - st.x, j.aim.y - st.y), 100000 + TRAVEL_TUNE.wellMargin, 1e-6), 'brzeg studni bazy + zapas');
    const wells = sc.warpEmergencyWells();
    assert.ok(wells.some((w) => w.x === sc.SUN.x && w.rIn === sc.SUN.r), 'słońce z tarczą jako jądrem');
    assert.ok(wells.some((w) => w.x === st.x && w.r === 100000 && w.rIn === 40000), 'baza piratów z jądrem orbit');
  }
});

test('recenzja T ust. 5: plan trasy przy kopie (prawdziwe planPlayerWarp) — skok awaryjny narzędzi, mijane ciało, pas, czasy; cel = ciało', () => {
  const fly = { id: 'fly', x: 2e6 + 250000, y: 2e6 + 30000, r: 2000 };
  const route = () => ({ active: false, kind: 'none', arrive: 'none', x0: NaN, y0: NaN, x1: NaN, y1: NaN, dist: NaN, exitT: NaN,
    time: NaN, cruise: NaN, flyBody: null, flyAlong: NaN, flyLateral: NaN, flyT: NaN, beltIn: NaN, beltOut: NaN, beltTIn: NaN, beltTOut: NaN });
  const mk = () => indexFns({
    performance, ship: { pos: { x: 2e6, y: 2e6 } }, travelNav: { active: false, leg: null }, _tugWarp: { active: false },
    warpCourse: { aim: null, autoExit: false, kind: '', label: '' },
    planWarpEmergency, warpEmergencyWells: () => [], WORLD: { w: 1e7, h: 1e7 }, WARP_EMERGENCY, _warpEmergencyPlan: {},
    planets: [fly], window: { smallBodies: [] }, planetOrbitRadii: () => ({ inner: 1000, outer: 2000, gravityWell: 5000 }),
    WARP_ORIGIN_REACH: 100000, WARP_TARGET_REACH: 25000, _warpFlybyBodies: [], _warpFlybyCount: 0, warpBodyRadius: (p) => p.r * 4.5,
    warp: { speed: 175000, entryDuration: 0.9, cruise: 0, tripPlan: null, originBody: null, targetBody: null, route: route() },
    detectZones: (p) => ({ current: (p.x - 2e6 >= 100000 && p.x - 2e6 < 200000) ? { id: 'asteroid_belt', warpMultiplier: 0.8 }
      : { id: 'interplanetary', warpMultiplier: 1 } }),
    planWarpCruise, warpTripTuneFor, warpLegTimeline, warpExitRampTime, warpExitRampDistance,
    getPlayerSpeed: () => 0, playerWarpHullLength: () => 1800,
    driveState: { flightSpec: { maxSpeed: 500 }, brakeAccel: 200 }, PLAYER_WARP_MOMENTUM: { k: 3 }, _playerWarpExit: {},
    _warpRouteMarks: new Float64Array(3), _warpRouteMarkT: new Float64Array(3), _warpRouteTimeline: { exitT: NaN, exitV: 0, exitS: 0 }
  }, ['playerWarpLegEnd', 'warpWellEdgeDist', 'warpPlanetNear', 'playerWarpExitPlan', 'planPlayerWarp']);
  // skok bez punktu (narzędzia ustawiają ładowanie wprost) — koniec z planu awaryjnego, wyjście automatyczne
  const sc = mk();
  sc.planPlayerWarp(1, 0);
  const rt = sc.warp.route;
  assert.equal(rt.active, true);
  assert.equal(rt.kind, 'emergency');
  assert.equal(rt.arrive, 'point');
  assert.equal(sc.warpCourse.autoExit, true);
  assert.ok(near(rt.x1, 2e6 + WARP_EMERGENCY.dist) && near(rt.y1, 2e6) && near(rt.dist, WARP_EMERGENCY.dist));
  assert.equal(rt.flyBody, fly);
  assert.ok(near(rt.flyAlong, 250000) && near(rt.flyLateral, 30000));
  assert.ok(near(rt.beltIn, 100000) && near(rt.beltOut, 200000));
  assert.ok(rt.beltTIn > 0 && rt.beltTIn < rt.beltTOut && rt.beltTOut < rt.flyT && rt.flyT < rt.exitT && rt.exitT < rt.time,
    `${rt.beltTIn} ${rt.beltTOut} ${rt.flyT} ${rt.exitT} ${rt.time}`);
  assert.equal(rt.cruise, sc.warp.cruise);
  assert.equal(sc.warp.tripPlan.kind, 'emergency');
  // narzędzie skacze ze studni w jądro (klawisz by odmówił) — skok i tak ma koniec (bez studni, brzeg świata)
  const tool = mk();
  tool.warpEmergencyWells = () => [{ x: 2e6 + 30000, y: 2e6, r: 200000, rIn: 50000 }];
  tool.planPlayerWarp(1, 0);
  assert.ok(near(tool.warp.route.dist, WARP_EMERGENCY.dist) && tool.warpCourse.autoExit);
  // odcinek TRAVEL TO do planety — przylot 'body'
  const tgt = { id: 'tgt', x: 2e6 + 410000, y: 2e6, r: 2000 };
  const sb = mk();
  sb.planets.push(tgt);
  sb.travelNav.active = true;
  sb.travelNav.leg = { x: 2e6 + 400000, y: 2e6, kind: 'warp' };
  sb.planPlayerWarp(1, 0);
  assert.equal(sb.warp.route.kind, 'travel');
  assert.equal(sb.warp.route.arrive, 'body');
  assert.equal(sb.warp.targetBody, tgt);
  assert.equal(sb.warpCourse.autoExit, false, 'TRAVEL TO — bez punktu z klawisza');
});

test('recenzja T ust. 5: wyjście przed końcem planu (prawdziwe exitWarp) przenosi koniec trasy, automat przy punkcie — nie', () => {
  const tgt = { id: 'tgt' };
  const mk = (x) => indexFns({
    warp: { dir: { x: 1, y: 0 }, route: { active: true, kind: 'travel', arrive: 'body', x0: 0, y0: 0, x1: 400000, y1: 0, dist: 400000 },
      targetBody: tgt, chargeAngle: 0, entryProgress: 1, lastDir: null, exitRamp: null },
    ship: { pos: { x, y: 0 }, angle: 0, angVel: 0 },
    getPlayerSpeed: () => 175000, playerWarpExitPlan: () => ({ vEnd: 0, total: 12000 }), stopPlayerWarpSlide() {},
    createWarpExitRamp: (o) => ({ active: true, ...o }), playerWarpHullLength: () => 1800, SimClock: { sim: 0 },
    PLAYER_WARP_ROUTE_CUT: 5000, warpPlanetNear: (px) => (Math.abs(px - 400000) < 30000 ? tgt : null), WARP_TARGET_REACH: 25000,
    camera: { addShake() {} }, noteCameraRigWarp() {}, cameraRig: {}, warpBrakeTimer: 0
  }, ['exitWarp']);
  const manual = mk(150000);
  manual.exitWarp();
  assert.ok(near(manual.warp.route.x1, 162000) && near(manual.warp.route.dist, 162000));
  assert.equal(manual.warp.route.arrive, 'point', 'ręczne wyjście daleko od celu — kadr punktu');
  const auto = mk(400000 - 12000);
  auto.exitWarp();
  assert.equal(auto.warp.route.x1, 400000);
  assert.equal(auto.warp.route.arrive, 'body', 'wyjście automatu przy punkcie — plan bez zmian');
  const brake = mk(150000);
  brake.exitWarp({ abrupt: true });
  assert.ok(near(brake.warp.route.x1, 150000) && brake.warp.route.arrive === 'point', 'hamowanie bez rampy — tu');
  assert.equal(brake.warp.exitRamp, null);
});

test('recenzja T ust. 8: wylot ze studni w skoku nie hamuje (prawdziwe handleZoneTransition), wejście i przelot przez ciało — jak dawniej', () => {
  const brakes = [];
  const sc = indexFns({
    warp: { state: 'active', dir: { x: 1, y: 0 }, route: { x0: 0, y0: 0 } },
    ship: { pos: { x: 0, y: 0 } },
    planets: [{ x: -5000, y: 0, zr: 8000, well: 17000 }], window: { smallBodies: [] },
    planetOrbitRadii: (p) => ({ inner: p.zr / 2, outer: p.zr, gravityWell: p.well }),
    SUN: { x: 9e6, y: 9e6 }, mercMission: { station: { x: -3e6, y: 0 } },
    GRAVITY_WELL_IDS: ['planet_gravity', 'pirate_gravity', 'sun'],
    triggerGravityWarpBrake: (id) => brakes.push(id), MISSIONS: { active: [] }, enterPirateInnerOrbit() {}
  }, ['isGravityWellZoneId', 'warpLeavingWell', 'handleZoneTransition']);
  // wylot z portu (5 tys. j. od środka, w strefie orbit) — pas studni 4 tys. j. dalej: bez hamowania
  sc.ship.pos.x = 4000;
  sc.handleZoneTransition('planet_outer', 'planet_gravity');
  assert.deepEqual(brakes, []);
  // wejście z zewnątrz — hamowanie
  sc.warp.route.x0 = -100000;
  sc.ship.pos.x = -21000;
  sc.handleZoneTransition('interplanetary', 'planet_gravity');
  assert.deepEqual(brakes, ['planet_gravity']);
  // skok z pasa studni w głąb — po drugiej stronie ciała hamuje jak dawniej (siatka bezpieczeństwa)
  sc.warp.route.x0 = -15000;
  sc.ship.pos.x = 4000;
  sc.handleZoneTransition('planet_outer', 'planet_gravity');
  assert.deepEqual(brakes, ['planet_gravity', 'planet_gravity']);
  // baza piratów: oddalanie się od źródła
  sc.warp.route.x0 = -2.9e6;
  assert.equal(sc.warpLeavingWell('pirate_gravity'), true);
  sc.warp.dir.x = -1;
  assert.equal(sc.warpLeavingWell('pirate_gravity'), false);
  sc.warp.dir.x = 1;
  sc.warp.state = 'idle';
  assert.equal(sc.warpLeavingWell('pirate_gravity'), false, 'poza skokiem — bez wyjątku');
});
