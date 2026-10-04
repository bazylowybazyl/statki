// Wezwania i POWRÓT skrzydła wsparcia tunelem warpa „Nurt” (src/game/supportWarp.js): kurs od Ziemi,
// kolejka wezwań (spawn w klatce wyrzutu), automat powrotu (obrót → ładowanie → szczelina →
// usunięcie), sterownik efektu w Node (Core3D zaślepiony, jak w warpNurt.test.mjs) i spięcie
// z kokpitem / index.html.
// node --test tests/supportWarp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  createSupportWarpCallIns, createSupportReturn, supportWarpCourse, wrapSupportWarpAngle, SUPPORT_RETURN
} from '../src/game/supportWarp.js';
import { planWarpArrivalFx, HERALD_REACH } from '../src/3d/warp/arrivals.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('kurs: z punktu do punktu (świat gry, y w dół), punkty wspólne — zapas', () => {
  assert.ok(near(supportWarpCourse({ x: 0, y: 0 }, { x: 10, y: 0 }), 0));
  assert.ok(near(supportWarpCourse({ x: 0, y: 0 }, { x: 0, y: 10 }), Math.PI / 2));
  assert.ok(near(supportWarpCourse({ x: 5, y: 5 }, { x: -5, y: 5 }), Math.PI));
  assert.equal(supportWarpCourse({ x: 3, y: 3 }, { x: 3.2, y: 3.1 }, 1.25), 1.25);
  assert.equal(supportWarpCourse(null, undefined, 0.5), 0.5);
  assert.ok(near(wrapSupportWarpAngle(3 * Math.PI), Math.PI) || near(wrapSupportWarpAngle(3 * Math.PI), -Math.PI));
  assert.ok(near(wrapSupportWarpAngle(-0.25 + 4 * Math.PI), -0.25, 1e-9));
});

test('nić zwiastuna: heraldReach skraca nić (start przy Ziemi), nie dłuższa niż HERALD_REACH ani krótsza niż 2 L', () => {
  const base = { x: 0, y: 0, angle: 0, hullLength: 600, hullWidth: 250, startTime: 0 };
  assert.equal(planWarpArrivalFx(base).heraldReach, HERALD_REACH);
  assert.equal(planWarpArrivalFx({ ...base, heraldReach: 20000 }).heraldReach, 20000);
  assert.equal(planWarpArrivalFx({ ...base, heraldReach: 1e9 }).heraldReach, HERALD_REACH);
  assert.equal(planWarpArrivalFx({ ...base, heraldReach: 300 }).heraldReach, 1200);
  assert.equal(planWarpArrivalFx({ ...base, heraldReach: -5 }).heraldReach, HERALD_REACH);
  assert.equal(planWarpArrivalFx({ ...base, heraldReach: Infinity }).heraldReach, HERALD_REACH);
});

// Zaślepka efektu dla kolejki: planArrival (wyrzut po 2 s), attach, arrive.
function fakeArrivalWarp() {
  return {
    time: 0,
    full: false,
    planned: [],
    attached: [],
    arrived: [],
    planArrival(o) {
      if (this.full) return null;
      const rec = { fx: { tBurst: this.time + 2 }, o };
      this.planned.push(rec);
      return rec;
    },
    attach(rec, e) { this.attached.push([rec, e]); },
    arrive(e) { this.arrived.push(e); }
  };
}

test('wezwanie: efekt planowany od razu, okręt powstaje w klatce, której render przekracza wyrzut', () => {
  const warp = fakeArrivalWarp();
  const spawned = [];
  const placed = [];
  const q = createSupportWarpCallIns({
    warp,
    spawn: (req) => { const e = { id: req.key }; spawned.push(e); return [e]; },
    onSpawned: (list, req) => { for (const e of list) { e.angle = req.angle; placed.push(e); } }
  });
  const rec = q.request({ key: 'battleship', x: 5, y: 6, angle: 0.5, hullLength: 624, hullWidth: 280, palette: 'magenta', pirate: false, heraldReach: 1000 });
  assert.ok(rec);
  assert.deepEqual(warp.planned[0].o, { x: 5, y: 6, angle: 0.5, hullLength: 624, hullWidth: 280, palette: 'magenta', pirate: false, heraldReach: 1000 });
  assert.equal(q.pending.length, 1);
  // Przed wyrzutem nic nie powstaje (zwiastun i rozdarcie grają bez okrętu).
  assert.equal(q.flush(1 / 60), 0);
  warp.time = 1.9;
  assert.equal(q.flush(1 / 60), 0);
  // Klatka, której render przesunie zegar efektu za tBurst: spawn teraz, podpięcie do efektu.
  warp.time = 2 - 1 / 120;
  assert.equal(q.flush(1 / 60), 1);
  assert.equal(spawned.length, 1);
  assert.equal(warp.attached.length, 1);
  assert.equal(warp.attached[0][0], rec);
  assert.equal(warp.attached[0][1], spawned[0]);
  assert.equal(placed[0].angle, 0.5, 'kurs przylotu z wezwania');
  assert.equal(q.pending.length, 0);
  assert.equal(q.flush(1 / 60), 0, 'raz');
});

test('wezwanie: skład (megafrachtowiec) — głowa podpina przylot, wagony wypadają w tej samej chwili; myśliwce bez efektu', () => {
  const warp = fakeArrivalWarp();
  const train = [{ id: 'head' }, { id: 'w1' }, { id: 'w2' }];
  const q = createSupportWarpCallIns({
    warp,
    spawn: (req) => (req.key === 'train' ? train : [{ id: 'f1', fighter: true }, { id: 'f2', fighter: true }]),
    isHull: (e) => !e.fighter
  });
  q.request({ key: 'train', x: 0, y: 0, angle: 0, hullLength: 2760, hullWidth: 900 });
  q.request({ key: 'wing', x: 0, y: 0, angle: 0, hullLength: 60, hullWidth: 40 });
  warp.time = 5;
  assert.equal(q.flush(0), 2);
  assert.equal(warp.attached.length, 1);
  assert.equal(warp.attached[0][1].id, 'head');
  assert.deepEqual(warp.arrived.map((e) => e.id), ['w1', 'w2']);
  // Spawn nieudany (null) — efekt dogrywa bez okrętu, kolejka pusta.
  const q2 = createSupportWarpCallIns({ warp, spawn: () => null });
  q2.request({ key: 'x', x: 0, y: 0, angle: 0, hullLength: 400, hullWidth: 160 });
  warp.time = 99;
  assert.equal(q2.flush(0), 1);
  assert.equal(q2.pending.length, 0);
});

test('wezwanie: pula przylotów pełna albo efekt niedostępny — request zwraca null (wołający spawnuje od razu)', () => {
  const warp = fakeArrivalWarp();
  warp.full = true;
  const q = createSupportWarpCallIns({ warp, spawn: () => { throw new Error('bez spawnu'); } });
  assert.equal(q.request({ key: 'destroyer', x: 0, y: 0, angle: 0, hullLength: 288, hullWidth: 100 }), null);
  assert.equal(q.pending.length, 0);
  const q2 = createSupportWarpCallIns({ warp: null, spawn: () => null });
  assert.equal(q2.request({ key: 'destroyer', x: 0, y: 0, angle: 0 }), null);
});

// Zaślepka efektu dla powrotu: depart (ładowanie 2 s, wejście 0,5 s).
function fakeDepartWarp() {
  return {
    time: 0,
    fail: false,
    calls: [],
    depart(e, opts) {
      if (this.fail) return null;
      const rec = { fx: { x: e.x, y: e.y, tDive: this.time + 2, tGone: this.time + 2.5 }, opts };
      this.calls.push({ e, opts, rec, at: this.time });
      return rec;
    }
  };
}

function returnHarness(warp, home = { x: -10000, y: 0 }) {
  const log = [];
  const R = createSupportReturn({
    warp,
    origin: () => home,
    // Prosty „pilot”: połowa błędu kursu i połowa prędkości na klatkę.
    hold: (e, face) => {
      log.push(['hold', e.id]);
      e.angle += wrapSupportWarpAngle(face - e.angle) * 0.5;
      e.vx *= 0.5;
      e.vy *= 0.5;
    },
    keep: (e, x, y, face) => log.push(['keep', e.id, x, y, face]),
    dive: (e, a) => log.push(['dive', e.id, a]),
    remove: (e) => { log.push(['remove', e.id]); e.dead = true; }
  });
  return { R, log };
}

test('POWRÓT: dziób do Ziemi i hamowanie → ładowanie z odstępem → duch w szczelinie → usunięcie (raz)', () => {
  const warp = fakeDepartWarp();
  const { R, log } = returnHarness(warp);
  const a = { id: 'a', x: 0, y: 0, vx: 400, vy: 0, angle: 0 };            // leci od Ziemi, rufą do niej
  const b = { id: 'b', x: 0, y: 500, vx: 0, vy: 0, angle: Math.PI };      // już prawie na kursie
  assert.equal(R.begin([a, b, a, null, { id: 'x', dead: true }]), 2);
  assert.equal(R.begin([a]), 0, 'druga prośba o powrót tej samej jednostki nic nie zmienia');
  assert.ok(R.has(a) && R.has(b));
  const dt = 1 / 60;
  for (let i = 0; i < 400 && R.units.length; i++) {
    R.step(dt, dt);
    warp.time += dt;
  }
  assert.equal(R.units.length, 0);
  // b stał na kursie — poszedł pierwszy; a po obrocie, co najmniej `stagger` później.
  assert.deepEqual(warp.calls.map((c) => c.e.id), ['b', 'a']);
  assert.ok(warp.calls[1].at - warp.calls[0].at >= SUPPORT_RETURN.stagger - 1e-9);
  for (const c of warp.calls) {
    assert.equal(c.opts.drive, true, 'efekt prowadzi okręt w szczelinie');
    assert.equal(typeof c.opts.onGone, 'function');
    // kurs odlotu = do Ziemi
    assert.ok(near(c.opts.angle, supportWarpCourse(c.e, { x: -10000, y: 0 }), 1e-9));
  }
  assert.ok(Math.abs(wrapSupportWarpAngle(a.angle - Math.PI)) <= SUPPORT_RETURN.alignTolerance, 'a obrócony do Ziemi');
  const count = (kind, id) => log.filter((l) => l[0] === kind && l[1] === id).length;
  for (const id of ['a', 'b']) {
    assert.equal(count('dive', id), 1);
    assert.equal(count('remove', id), 1);
    assert.ok(count('keep', id) > 0, 'ładowanie trzyma punkt skoku');
  }
  // Ładowanie trzyma punkt z chwili startu (pozycja w rec.fx), wejście dopiero przy tDive.
  const keepA = log.find((l) => l[0] === 'keep' && l[1] === 'a');
  assert.equal(keepA[2], warp.calls[1].rec.fx.x);
  const diveIdx = log.findIndex((l) => l[0] === 'dive' && l[1] === 'a');
  const removeIdx = log.findIndex((l) => l[0] === 'remove' && l[1] === 'a');
  assert.ok(diveIdx > 0 && removeIdx > diveIdx);
  assert.equal(a.__warpReturn, null);
  assert.equal(a.dead, true);
});

test('POWRÓT: efekt zgłasza zniknięcie (onGone) — usunięcie w następnym kroku, bez czekania na zegar', () => {
  const warp = fakeDepartWarp();
  const { R, log } = returnHarness(warp);
  const e = { id: 'e', x: 0, y: 0, vx: 0, vy: 0, angle: Math.PI };
  R.begin([e]);
  R.step(1 / 60, 1 / 60);
  assert.equal(warp.calls.length, 1);
  warp.time = warp.calls[0].rec.fx.tDive;
  R.step(1 / 60, 1 / 60);
  assert.ok(log.some((l) => l[0] === 'dive'));
  warp.calls[0].opts.onGone(e);
  R.step(1 / 60, 1 / 60);
  assert.ok(log.some((l) => l[0] === 'remove'));
  assert.equal(R.units.length, 0);
});

test('POWRÓT: zniszczony w drodze nie jest usuwany drugi raz; pełna pula efektów — znika bez tunelu po limicie', () => {
  const warp = fakeDepartWarp();
  const { R, log } = returnHarness(warp);
  const e = { id: 'e', x: 0, y: 0, vx: 0, vy: 0, angle: 0 };
  R.begin([e]);
  R.step(1 / 60, 1 / 60);
  e.dead = true;            // wrak powstał po staremu (applyDamageToNPC)
  R.step(1 / 60, 1 / 60);
  assert.equal(R.units.length, 0);
  assert.equal(log.filter((l) => l[0] === 'remove').length, 0);
  assert.equal(e.__warpReturn, null);

  const warp2 = fakeDepartWarp();
  warp2.fail = true;
  const h = returnHarness(warp2);
  const f = { id: 'f', x: 0, y: 0, vx: 0, vy: 0, angle: Math.PI };
  h.R.begin([f]);
  const limit = SUPPORT_RETURN.alignTimeout + SUPPORT_RETURN.queueTimeout;
  for (let t = 0; t < limit - 0.5; t += 0.1) h.R.step(0.1, 0.1);
  assert.equal(h.R.units.length, 1, 'czeka na miejsce w puli efektów');
  for (let t = 0; t < 1; t += 0.1) h.R.step(0.1, 0.1);
  assert.equal(h.R.units.length, 0);
  assert.deepEqual(h.log.filter((l) => l[0] === 'remove').map((l) => l[1]), ['f']);
});

test('POWRÓT: bez Ziemi (inny układ) — kurs zostaje z kadłuba, obrót bez limitu czasu nie blokuje', () => {
  const warp = fakeDepartWarp();
  const { R } = returnHarness(warp, null);
  const e = { id: 'e', x: 0, y: 0, vx: 0, vy: 0, angle: 0.7 };
  R.begin([e]);
  R.step(1 / 60, 1 / 60);
  assert.equal(warp.calls.length, 1);
  assert.ok(near(warp.calls[0].opts.angle, 0.7));
});

// ── Sterownik efektu w Node (bez GPU) ─────────────────────────────────────────────────────────

async function initNurt() {
  const { Core3D } = await import('../src/3d/core3d.js');
  const { WarpNurt } = await import('../src/3d/warp/warpNurt.js');
  Core3D.isInitialized = true;
  Core3D.scene = Core3D.scene || new THREE.Scene();
  Core3D.addFxStep = () => {};
  WarpNurt.init({ count: 4096 });
  assert.equal(WarpNurt.initialized, true);
  return WarpNurt;
}

test('WarpNurt: wezwanie z Ziemi — nić od Ziemi, okręt podpięty w klatce wyrzutu, przeliczenie z kadłuba zachowuje przegródki', async () => {
  const WarpNurt = await initNurt();
  WarpNurt.clear();
  const cam = { x: 0, y: 0, zoom: 0.2 };
  const o = { dt: 1 / 60, cam, camShake: cam, camFollow: false, ship: null, warp: null, npcs: [] };
  const entity = { x: 1000, y: 0, vx: 0, vy: 0, angle: 0, beamHull: null };
  const q = createSupportWarpCallIns({
    warp: WarpNurt,
    spawn: () => entity,
    onSpawned: (list, req) => { for (const e of list) e.angle = req.angle; }
  });
  const rec = q.request({ x: 1000, y: 0, angle: 0, hullLength: 400, hullWidth: 160, palette: 'magenta', heraldReach: 20000 });
  assert.ok(rec, 'przylot zaplanowany');
  const heraldSlot = rec.fx.heraldSlot;
  const pushSlot = rec.fx.pushSlot;
  // Zwiastun: nić 20 tys. j. od strony Ziemi, kończy się w punkcie zbierania (sx).
  for (let i = 0; i < 30; i++) { q.flush(o.dt); WarpNurt.update(o); }
  assert.equal(rec.entity, null, 'w zwiastunie okrętu jeszcze nie ma');
  assert.equal(heraldSlot.heraldLen, 20000);
  assert.ok(near(heraldSlot.x + heraldSlot.heraldLen, rec.fx.sx - cam.x, 1e-6));
  let spawnedAt = -1;
  for (let i = 0; i < 600 && spawnedAt < 0; i++) {
    const before = WarpNurt.time;
    if (q.flush(o.dt)) spawnedAt = before;
    WarpNurt.update(o);
  }
  assert.ok(spawnedAt >= 0, 'okręt powstał');
  // Okręt powstaje w chwili pojawienia się daleko za celem (tSpawn), hamowanie później (tBrake).
  assert.ok(spawnedAt < rec.fx.tSpawn && WarpNurt.time >= rec.fx.tSpawn - 1e-9, 'w klatce, której render przekracza pojawienie się');
  assert.ok(rec.fx.tSpawn < rec.fx.tBrake);
  assert.equal(rec.entity, entity);
  assert.equal(rec.sized, false, 'kadłub jeszcze niezbudowany');
  assert.ok(entity.x < 1000 - rec.fx.rushDist * 0.8, 'efekt prowadzi okręt — wlot zza celu');
  assert.equal(entity.isCollidable, false, 'w locie duch');
  // Gra buduje kadłub przy pierwszym rysunku — następna klatka przelicza wymiary z prawdziwego kadłuba.
  entity.beamHull = { srcWidth: 420, srcHeight: 170, scale: 1 };
  WarpNurt.update(o);
  assert.equal(rec.sized, true);
  assert.equal(rec.fx.hullLength, 420);
  assert.equal(rec.fx.heraldSlot, heraldSlot, 'ta sama przegródka zwiastuna');
  assert.equal(rec.fx.pushSlot, pushSlot, 'ta sama przegródka iskier hamowania');
  assert.ok(near(pushSlot.releaseT, rec.fx.tBrake + 0.02));
  assert.equal(rec.fx.heraldReach, 20000);
  assert.ok(entity.__warpHullU, 'odsłanianie kadłuba od dziobu');
  // Po zatrzymaniu: okręt w miejscu zwiastuna, znów zderza się.
  for (let i = 0; i < 300 && WarpNurt.time < rec.fx.tStop + 0.05; i++) WarpNurt.update(o);
  assert.ok(near(entity.x, 1000, 1e-6) && entity.vx === 0);
  assert.equal(entity.isCollidable, true);
  WarpNurt.clear();
});

test('WarpNurt: odlot z prowadzeniem — okręt wchodzi w szczelinę wzdłuż kursu, onGone raz, kadłub schowany', async () => {
  const WarpNurt = await initNurt();
  WarpNurt.clear();
  const cam = { x: 0, y: 0, zoom: 0.2 };
  const o = { dt: 1 / 60, cam, camShake: cam, camFollow: false, ship: null, warp: null, npcs: [] };
  const course = 2.4;
  const npc = { x: 300, y: -200, vx: 0, vy: 0, angle: course, beamHull: { srcWidth: 400, srcHeight: 160, scale: 1 } };
  let gone = 0;
  const rec = WarpNurt.depart(npc, { angle: course, drive: true, onGone: () => { gone++; } });
  assert.ok(rec);
  for (let i = 0; i < 400 && WarpNurt.time < rec.fx.tGone + 0.1; i++) WarpNurt.update(o);
  assert.equal(gone, 1);
  const dx = npc.x - 300;
  const dy = npc.y + 200;
  const along = dx * Math.cos(course) + dy * Math.sin(course);
  const across = -dx * Math.sin(course) + dy * Math.cos(course);
  // Rozpęd do punktu skoku i dalej pełną prędkością, aż rufa minie punkt skoku.
  assert.ok(along >= rec.fx.rushDist + 400 * 1.1 - 1e-6, `droga rozpędu ${along}`);
  assert.ok(Math.abs(across) < 1e-6);
  assert.equal(npc.__warpHullU.a.y, -1, 'po wejściu kadłub schowany do usunięcia przez grę');
  // Gra usuwa okręt — efekt dogrywa zamknięcie szczeliny i zwalnia rekord.
  npc.dead = true;
  for (let i = 0; i < 120; i++) WarpNurt.update(o);
  assert.ok(!WarpNurt.arrivals.includes(rec));
  WarpNurt.clear();
});

// ── Spięcie z kokpitem i grą ──────────────────────────────────────────────────────────────────

test('kokpit: rozkazy skrzydła ESKORTA / ATAK / POWRÓT (bez STÓJ); wezwanie przez callInSupport', () => {
  const ui = read('src/ui/cockpitUI.js');
  assert.match(ui, /data-order="guard">ESKORTA</);
  assert.match(ui, /data-order="engage">ATAK</);
  assert.match(ui, /data-order="return"[^>]*>POWRÓT</);
  assert.doesNotMatch(ui, /STÓJ|data-order="hold"/);
  assert.match(ui, /if \(order === 'return'\) \{\n\s*this\.returnSupportWing\(\);/);
  assert.match(ui, /window\.CockpitSupport\?\.returnToEarth\?\.\(\)/);
  assert.match(ui, /window\.callInSupport\?\.\(key,/);
  assert.doesNotMatch(ui, /window\.spawnCallInShip\?\.\(/, 'kokpit nie spawnuje z pominięciem tunelu');
});

test('gra: callInSupport, POWRÓT w API kokpitu, krok przed render(), wracający poza skrzydłem', () => {
  const html = read('index.html');
  assert.match(html, /import \{ createSupportWarpCallIns, createSupportReturn, supportWarpCourse \} from "\.\/src\/game\/supportWarp\.js";/);
  assert.match(html, /window\.callInSupport = callInSupport;/);
  assert.match(html, /returnToEarth: \(\) => returnSupportWingToEarth\(\)/);
  assert.match(html, /stepSupportWarp\(frame\);\n\s*render\(alpha, frame\);/);
  assert.match(html, /const earth = planets\.find\(p => p\?\.id === 'earth'\);/);
  // Piraci — z losowego pola pasa asteroid, reszta — z Ziemi.
  assert.match(html, /const home = hull\.pirate \? pickPirateCallInOrigin\(\) : getSupportWarpHome\(\);/);
  assert.match(html, /field\.sampleMacro\(x, y\)\.cluster > PIRATE_CALL_IN_FIELD_MIN/);
  assert.match(html, /SupportWing\.units = SupportWing\.units\.filter\(data => data\?\.npc && !data\.npc\.dead && !data\.npc\.__warpReturn\);/);
  // Okręt w tunelu znika bez wraku: bez createWreckage / wybuchu w dematerializacji.
  const start = html.indexOf('function dematerializeSupportUnit(npc)');
  assert.ok(start > 0);
  const body = html.slice(start, html.indexOf('\n    }\n', start));
  assert.match(body, /npc\.dead = true;/);
  assert.match(body, /releaseNpcHexBody\(npc\);/);
  assert.doesNotMatch(body, /createWreckage|triggerReactorBlow3D|spawnExplosion|registerFactionKill/);
});
