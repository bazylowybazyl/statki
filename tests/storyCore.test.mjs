// Fabuła (2026-09-30): reżyser misji, dialogi, EXP, maskowanie, tor kamery intro, układ stoczni, geometria K-7.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createStoryRunner, isStoryCancelled } from '../src/game/story/storyRunner.js';
import { createDialogueQueue } from '../src/game/story/dialogue.js';
import { createProgress, grantExp, rankProgress, RANKS } from '../src/game/story/progression.js';
import { createCloak, engageCloak, breakCloak, stepCloak, isCloakHidden, toggleCloak, cloakBlockReason } from '../src/game/cloak.js';
import { buildDockIntroKeys, sampleKeys, keysDuration, topDownPose, blendPose } from '../src/game/story/introCamera.js';
import { planShipyard, planFleetWave, SHIPYARD_TUNE } from '../src/game/story/shipyardLayout.js';
import { k7BerthPose, k7HallCenter, k7IsOutsideHall, k7GameToHub, k7HubToGame, k7FrameFor } from '../src/game/story/k7Dock.js';
import { MISSION01_DIALOGUE } from '../src/data/story/mission01.dialogue.js';
import { STORY_CAST } from '../src/data/story/cast.js';
import { MISSION01, MISSION01_PHASES, MISSION01_HINTS } from '../src/game/story/missions/mission01.js';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('reżyser: wait liczy czas gry, pauza (dt = 0) go wstrzymuje', async () => {
  const r = createStoryRunner();
  const log = [];
  r.start(async (ctx) => { log.push('a'); await ctx.wait(1); log.push('b'); });
  await flush();
  assert.deepEqual(log, ['a']);
  r.tick(0); r.tick(0); await flush();
  assert.deepEqual(log, ['a']);
  r.tick(0.6); await flush();
  assert.deepEqual(log, ['a']);
  r.tick(0.5); await flush();
  assert.deepEqual(log, ['a', 'b']);
});

test('reżyser: until, event z filtrem, timeout i fazy', async () => {
  const phases = [];
  const r = createStoryRunner({ onPhase: (p) => phases.push(p) });
  let flag = false;
  let got = null;
  let timedOut = 'x';
  const done = r.start(async (ctx) => {
    ctx.phase('one');
    await ctx.until(() => flag);
    ctx.phase('two');
    got = await ctx.event('kill', (d) => d.id === 2);
    timedOut = await ctx.until(() => false, { timeout: 2, onTimeout: 'late' });
    return 'ok';
  });
  await flush();
  r.tick(1); await flush();
  assert.deepEqual(phases, ['one']);
  flag = true;
  r.tick(0.016); await flush();
  assert.deepEqual(phases, ['one', 'two']);
  assert.equal(r.emit('kill', { id: 1 }), 0);
  assert.equal(r.emit('kill', { id: 2 }), 1);
  await flush();
  assert.equal(got.id, 2);
  r.tick(1); await flush();
  assert.equal(timedOut, 'x');
  r.tick(1.1); await flush();
  assert.equal(timedOut, 'late');
  assert.equal(await done, 'ok');
  assert.equal(r.running, false);
});

test('reżyser: anulowanie rzuca w oczekujących, wątki potomne giną z rodzicem', async () => {
  const r = createStoryRunner({ log: () => {} });
  let childEnded = false;
  let caught = null;
  const done = r.start(async (ctx) => {
    ctx.spawn(async (sub) => {
      try { await sub.wait(100); } finally { childEnded = true; }
    });
    try { await ctx.wait(100); } catch (err) { caught = err; throw err; }
  });
  await flush();
  assert.equal(r.pendingCount, 2);
  r.cancel('test');
  await flush();
  assert.ok(isStoryCancelled(caught));
  assert.equal(childEnded, true);
  assert.equal(await done, null);
  assert.equal(r.pendingCount, 0);
});

test('reżyser: wyjątek w warunku nie wywraca misji', async () => {
  const errs = [];
  const r = createStoryRunner({ log: (m, e) => errs.push(e) });
  let n = 0;
  r.start(async (ctx) => { await ctx.until(() => { n++; if (n < 3) throw new Error('boom'); return true; }); });
  await flush();
  r.tick(0.1); r.tick(0.1); await flush();
  assert.equal(r.running, false);
  assert.equal(errs.length, 1);
});

test('dialogi: scena czeka na gracza (odsłonięcie, potem następna kwestia)', async () => {
  const q = createDialogueQueue();
  let result = null;
  q.play([{ who: 'admiral', text: 'Pierwsza kwestia.' }, { who: 'xo', text: 'Druga.' }], { mode: 'scene' }).then((r) => { result = r; });
  assert.equal(q.current.who, 'admiral');
  assert.equal(q.current.shown, 0);
  q.tick(0.05);
  assert.ok(q.current.shown > 0 && !q.current.typed);
  q.advance();                   // odsłania tekst
  assert.equal(q.current.typed, true);
  assert.equal(q.current.index, 0);
  q.tick(20);                    // scena nie idzie sama
  assert.equal(q.current.index, 0);
  q.advance();
  assert.equal(q.current.who, 'xo');
  q.advance(); q.advance();
  await flush();
  assert.equal(result, 'done');
  assert.equal(q.active, false);
});

test('dialogi: radio przechodzi samo po czasie czytania; skip kończy sekwencję', async () => {
  const q = createDialogueQueue();
  let result = null;
  q.play([{ who: 'xo', text: 'Krótko.' }, { who: 'xo', text: 'Dalej.' }], { mode: 'radio' }).then((r) => { result = r; });
  for (let i = 0; i < 400 && q.active; i++) q.tick(0.05);
  await flush();
  assert.equal(result, 'done');
  let r2 = null;
  q.play([{ who: 'xo', text: 'a' }, { who: 'xo', text: 'b' }], { mode: 'radio' }).then((r) => { r2 = r; });
  q.skip();
  await flush();
  assert.equal(r2, 'skipped');
});

test('dialogi misji 1: każda kwestia ma mówiącego z obsady i tekst', () => {
  for (const [scene, lines] of Object.entries(MISSION01_DIALOGUE)) {
    assert.ok(Array.isArray(lines) && lines.length > 0, scene);
    for (const l of lines) {
      assert.ok(STORY_CAST[l.who], `${scene}: nieznany mówiący ${l.who}`);
      assert.ok(typeof l.text === 'string' && l.text.length > 0, scene);
    }
  }
});

test('EXP: stopnie rosną z progami, awanse raportowane', () => {
  const p = createProgress();
  const a = grantExp(p, 1000);
  assert.equal(a.rank, 0);
  assert.deepEqual(a.promoted, []);
  const b = grantExp(p, 3500);
  assert.equal(p.exp, 4500);
  assert.deepEqual(b.promoted, [RANKS[1].name, RANKS[2].name]);
  const rp = rankProgress(p);
  assert.equal(rp.name, RANKS[2].name);
  assert.ok(rp.frac > 0 && rp.frac < 1);
  assert.equal(grantExp(p, -50).gained, 0);
});

test('maskowanie: włączanie, ukrycie dopiero po rozbłysku, zerwanie i przeładowanie, energia', () => {
  const c = createCloak();
  assert.equal(isCloakHidden({ cloak: c }), false);
  assert.ok(engageCloak(c));
  stepCloak(c, 0.5);
  assert.equal(isCloakHidden({ cloak: c }), false, 'w trakcie włączania jeszcze widać');
  stepCloak(c, 2);
  assert.equal(isCloakHidden({ cloak: c }), true);
  assert.ok(breakCloak(c, 'ram'));
  assert.equal(c.state, 'cooldown');
  assert.equal(c.lastBreak.reason, 'ram');
  assert.ok(cloakBlockReason(c));
  assert.equal(engageCloak(c), false);
  stepCloak(c, c.tune.breakCooldownSec + 0.1);
  assert.equal(c.state, 'off');
  // energia: pełne maskowanie gaśnie samo
  c.energy = c.tune.minEnergy + 0.5;
  assert.ok(toggleCloak(c));
  let ev = null;
  for (let i = 0; i < 200 && !ev; i++) ev = stepCloak(c, 0.1);
  assert.equal(ev, 'energy');
  assert.equal(c.state, 'cooldown');
  // za mało energii — odmowa
  stepCloak(c, 100);
  c.energy = 1;
  assert.equal(engageCloak(c), false);
});

test('tor kamery intro: start w pozie menu, ciągły, koniec = kadr kamery gry z góry na Atlasie', () => {
  const start = { eye: { x: -100000, y: 50000, z: 30000 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: 30 };
  const end = topDownPose(39000, -38000, 900 / 14500, 900, 30);
  const keys = buildDockIntroKeys({
    start,
    hall: { x: 40000, y: 40000, outX: 1, outY: 1 },
    end
  });
  const T = keysDuration(keys);
  assert.ok(T > 8 && T < 25, `długość ${T}`);
  const p0 = sampleKeys(keys, 0);
  assert.deepEqual(p0.eye, start.eye);
  let prev = sampleKeys(keys, 0);
  let maxJump = 0;
  for (let t = 0.05; t <= T; t += 0.05) {
    const p = sampleKeys(keys, t, { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: 0 });
    for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(p.eye[k]) && Number.isFinite(p.target[k]));
    maxJump = Math.max(maxJump, Math.hypot(p.eye.x - prev.eye.x, p.eye.y - prev.eye.y, p.eye.z - prev.eye.z));
    prev = p;
  }
  assert.ok(maxJump < 12000, `skok ${maxJump}`);
  // koniec: dokładnie poza z góry (cięcie na kamerę 2D gry bez skoku kadru), pion nad Atlasem, fov 30
  const last = sampleKeys(keys, T + 5);
  assert.deepEqual(last.eye, end.eye);
  assert.deepEqual(last.target, end.target);
  assert.deepEqual(last.up, end.up);
  assert.equal(last.fov, 30);
  assert.ok(Math.abs(last.eye.x - last.target.x) < 1e-9 && Math.abs(last.eye.y - last.target.y) < 1e-9, 'pion');
  // tor nie przelatuje hali: oko przez cały lot po stronie startu albo nad halą, nigdy za nią (ku planecie)
  for (let t = 0; t <= T; t += 0.25) {
    const q = sampleKeys(keys, t);
    assert.ok(q.eye.z > 0, 'oko nad płaszczyzną gry');
  }
  // poza z góry = kadr klasycznej kamery gry
  const top = topDownPose(100, 200, 0.5, 1080, 30);
  const visH = 2 * top.eye.z * Math.tan(15 * Math.PI / 180);
  assert.ok(Math.abs(visH - 1080 / 0.5) < 1e-6);
  assert.equal(top.eye.y, -200);
  const mid = blendPose(p0, top, 0.5);
  assert.ok(Number.isFinite(mid.eye.x) && Math.abs(Math.hypot(mid.up.x, mid.up.y, mid.up.z) - 1) < 1e-9);
});

test('lot intro w tle menu: koniec = kadr gry nad C-01, słońce przechodzi w słońce gry, wycięcie nad halą na końcu', async () => {
  const { StoryGame } = await import('../src/game/story/storyGame.js');
  const earth = { id: 'earth', x: 7_000_000, y: 6_000_000, r: 600 };
  StoryGame.init({ ship: () => ({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0 }), player: () => ({}), planets: () => [earth], viewHeight: () => 1000 });
  const hc = k7HallCenter(earth, 0);
  const berth = k7BerthPose(earth, 'C-01');
  // menu: kamera po stronie hali, wysoko (jak MENU_SHOT po najeździe)
  const ex = earth.x, ey = -earth.y;
  const az = Math.atan2(-hc.y - ey, hc.x - ex) + 0.35;
  const menuPose = { eye: { x: ex + Math.cos(az) * 118000, y: ey + Math.sin(az) * 118000, z: 27000 }, target: { x: ex, y: ey, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: 26 };
  const plan = StoryGame.planMenuIntro({ menuPose, menuSun: { az: 1, el: 0.47 }, gameSun: { az: -2, el: 0.85 }, H: 1000 });
  assert.ok(plan && plan.duration > 6);
  const end = plan.sample(plan.duration + 1, { eye: {}, target: {}, up: {}, fov: 0 });
  const top = topDownPose(berth.x, berth.y, 1000 / StoryGame.REVEAL_VIEW_HEIGHT, 1000, 30);
  assert.deepEqual(end.eye, top.eye);
  assert.deepEqual(end.target, top.target);
  assert.deepEqual(plan.sun(0), { az: 1, el: 0.47 });
  const s1 = plan.sun(1);
  assert.ok(Math.abs(s1.az - -2) < 1e-9 && Math.abs(s1.el - 0.85) < 1e-9);
  assert.equal(plan.cut(0), 0);
  assert.equal(plan.cut(1), 1);
  // lot nie wchodzi w planetę: oko zawsze dalej od środka niż ring (≈ promień hali), albo wysoko nad halą
  const R = Math.hypot(-hc.y - ey, hc.x - ex);
  for (let t = 0; t <= plan.duration; t += 0.1) {
    const q = plan.sample(t, { eye: {}, target: {}, up: {}, fov: 0 });
    const d = Math.hypot(q.eye.x - ex, q.eye.y - ey);
    assert.ok(d > R * 0.8 || q.eye.z > 20000, `t=${t.toFixed(1)} d=${Math.round(d)} z=${Math.round(q.eye.z)}`);
  }
});

test('stocznia: rząd burta w burtę na osi, punkt zbiórki przed nim, poza czujnikami', () => {
  const center = { x: 2_000_000, y: 1_000_000 };
  const from = { x: 1_000_000, y: 1_000_000 };
  const s = planShipyard(center, from);
  assert.equal(s.parked.length, SHIPYARD_TUNE.parked.length);
  assert.equal(s.turrets.length, SHIPYARD_TUNE.turrets);
  // oś od gracza do stoczni (tu +x)
  assert.ok(Math.abs(s.axis) < 1e-9);
  // zaparkowane po kolei wzdłuż osi, bez nakładania
  for (let i = 1; i < s.parked.length; i++) assert.ok(s.parked[i].x > s.parked[i - 1].x);
  // Punkt zbiórki poza zasięgiem wykrycia niezamaskowanego okrętu (9 km, StoryGame._detected) z zapasem,
  // ale nie dalej, niż Atlas przeleci w pół minuty (limit bojowy 500 j/s).
  const d = Math.hypot(s.rally.x - s.rowStart.x, s.rally.y - s.rowStart.y);
  assert.ok(d >= 12000 && d <= 16000, `zbiórka ${d} j. od rzędu`);
  assert.ok(SHIPYARD_TUNE.counterDistance >= 15000, 'front odwetu daje czas na salwy w nadlatujących');
  assert.ok(s.rally.x < s.rowStart.x, 'zbiórka od strony gracza');
  const wave = planFleetWave({ x: 0, y: 0 }, 0, { battleship: 7, destroyer: 8, frigate: 15 });
  assert.equal(wave.length, 30);
  assert.equal(wave[wave.length - 1].key, 'battleship', 'flagowce przylatują ostatnie');
  const keys = new Set(wave.map((w) => `${Math.round(w.x)}|${Math.round(w.y)}`));
  assert.equal(keys.size, 30, 'każdy okręt ma własne miejsce');
});

test('K-7: stanowisko C-01 w hali, poza bramą = poza halą, kurs dziobem do tylnej ściany', () => {
  const earth = { id: 'earth', x: 1_056_000, y: 3_000_000, r: 600 };
  const pose = k7BerthPose(earth, 'C-01');
  assert.ok(pose && Number.isFinite(pose.x) && Number.isFinite(pose.angle));
  const frame = k7FrameFor(earth, 0);
  const hub = k7GameToHub(earth, frame, pose.x, pose.y);
  assert.ok(Math.abs(hub.x - (-810)) < 1e-6 && Math.abs(hub.z - 1900) < 1e-6);
  assert.equal(k7IsOutsideHall(earth, frame, pose.x, pose.y), false);
  const gate = k7HubToGame(earth, frame, -810, 7400 + 1180 + 1500);
  assert.equal(k7IsOutsideHall(earth, frame, gate.x, gate.y), true);
  // dziób (kurs gry) wskazuje ku tylnej ścianie: punkt przed dziobem ma mniejsze z huba
  const ahead = k7GameToHub(earth, frame, pose.x + Math.cos(pose.angle) * 500, pose.y + Math.sin(pose.angle) * 500);
  assert.ok(ahead.z < hub.z - 400);
  const hc = k7HallCenter(earth, 0);
  assert.ok(Math.hypot(hc.x - pose.x, hc.y - pose.y) < 6000);
});

test('misja 1: skład odwetu i wsparcia z decyzji, fazy i podpowiedzi kompletne', () => {
  assert.deepEqual({ ...MISSION01.counterAttack }, { battleship: 7, destroyer: 8, frigate: 15 });
  assert.deepEqual({ ...MISSION01.support }, { battleship: 10, destroyer: 5, frigate: 5 });
  assert.ok(MISSION01.rewards.exp > 0 && MISSION01.rewards.credits > 0);
  assert.ok(MISSION01.rewards.rep.terra_nova > 0 && MISSION01.rewards.rep.pirates < 0);
  assert.equal(MISSION01_PHASES[0], 'intro');
  for (const h of Object.values(MISSION01_HINTS)) assert.ok(h.title && h.text);
});
