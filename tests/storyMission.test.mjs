// Fabuła (2026-09-30): cała misja 1 na atrapie gry — StoryGame (klej) + skrypt misji od doku do powrotu.
// Sprawdza kolejność faz, zamrożenie świata w scenach, blokadę w doku, fale warpa, nagrody i dziennik.
import test from 'node:test';
import assert from 'node:assert/strict';

import { StoryGame } from '../src/game/story/storyGame.js';
import { ViewState3D } from '../src/game/view3D.js';
import { engageCloak, stepCloak } from '../src/game/cloak.js';
import { MISSION01 } from '../src/game/story/missions/mission01.js';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function makeWorld() {
  const AU = 42253.52;
  const sun = { x: 6_000_000, y: 6_000_000 };
  const earth = { id: 'earth', x: sun.x + 25 * AU, y: sun.y, r: 600 };
  const ship = { pos: { x: earth.x + 50000, y: earth.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0, w: 1800, h: 800, x: 0, y: 0 };
  const w = {
    AU, sun, earth, ship, npcs: [], stations: [], credits: 0, rep: [], journal: [], completed: [], phases: [],
    warpedOut: 0, blows: 0, courses: [], course: null
  };
  let id = 0;
  const mkNpc = (key, opts, mode) => {
    const p = opts.spawnPos || opts.pos || { x: 0, y: 0 };
    const n = { id: ++id, type: key, pos: { x: p.x, y: p.y }, x: p.x, y: p.y, vel: { x: 0, y: 0 }, angle: opts.angle || 0, hp: 1000, maxHp: 1000, dead: false, isPirate: mode === 'pirate', friendly: mode === 'friendly', ai: () => {} };
    w.npcs.push(n);
    return n;
  };
  w.deps = {
    ship: () => ship,
    player: () => (w.player ||= { credits: 0 }),
    planets: () => [earth, { id: 'mars', x: sun.x - 38 * AU, y: sun.y, r: 400 }],
    stations: () => w.stations,
    npcs: () => w.npcs,
    sun: () => sun,
    belt: () => ({ inner: 36 * AU, outer: 47 * AU }),
    worldUnitsPerAu: () => AU,
    gameTime: () => 0,
    shipLength: () => 1800,
    shipRenderPose: () => ({ x: ship.pos.x, y: ship.pos.y }),
    placePlayer: (x, y, a) => { ship.pos.x = x; ship.pos.y = y; if (Number.isFinite(a)) ship.angle = a; ship.vel.x = ship.vel.y = 0; },
    showHud: (on) => { w.hud = on; },
    fadeScreen: () => Promise.resolve(),
    shake: () => {},
    k7Hall: () => null,
    viewHeight: () => 900,
    forceClassicCamera: () => { w.classicForced = true; },
    setGameCamera: (x, y, zoom) => { w.gameCam = { x, y, zoom }; w.gameCamReleased = false; },
    releaseGameCamera: () => { w.gameCamReleased = true; },
    setHallRoof: (o) => { w.roof = o ? { ...o } : null; },
    hasContact: () => false,
    setCourse: (x, y) => { w.course = { x, y }; w.courses.push(w.course); },
    clearCourse: () => { w.course = null; },
    warpState: () => 'idle',
    spawnShip: (key, opts) => [mkNpc(key, opts, opts.mode)],
    spawnPirateStation: (spec) => { const st = { ...spec, maxHp: spec.hp, _destroyed3D: false }; w.stations.push(st); return st; },
    spawnTurret: (spec) => mkNpc('turret', { spawnPos: spec }, 'pirate'),
    sleepNpc: (n) => { n.asleep = true; },
    wakeNpc: (n) => { n.asleep = false; },
    killNpc: (n) => { n.dead = true; n.hp = 0; },
    destroyStation: (st) => { st._destroyed3D = true; st.hp = 0; },
    callInWarp: (key, opts) => { const n = mkNpc(key, opts, opts.mode); opts.onSpawned?.([n]); return { planned: true, eta: 1 }; },
    warpArrivalsFree: () => 24,
    warpOut: (list) => { for (const n of list) { n.warpedOut = true; n.dead = true; w.warpedOut++; } },
    returnWing: () => { w.wingReturned = true; },
    reactorBlow: () => { w.blows++; },
    addCredits: (n) => { w.credits += n; },
    changeReputation: (f, d) => w.rep.push([f, d]),
    factionLabel: (f) => f,
    addMission: (e) => w.journal.push(e),
    onMissionUpdated: () => {},
    completeMission: (idm) => w.completed.push(idm),
    onPhase: (p) => w.phases.push(p),
    log: () => {},
    warn: () => {}
  };
  return w;
}

async function frames(S, w, n, view, act) {
  for (let i = 0; i < n; i++) {
    const dt = 1 / 30;
    S.frame(dt);
    S.cameraFrame({ dt, W: 1600, H: 900, camX: w.ship.pos.x, camY: w.ship.pos.y, zoom: 0.3, gameCam3d: null, View3D: view });
    const gameDt = S.worldFrozen ? 0 : dt;
    if (gameDt > 0) S.applyPlayerLock(w.ship, gameDt);
    S.tick(gameDt);
    await flush();
    if (act) act();
  }
}

test('misja 1 od doku do powrotu na atrapie gry: fazy, dok, fale, nagrody, dziennik', async () => {
  const w = makeWorld();
  const S = StoryGame;
  S.init(w.deps);
  const view = new ViewState3D();
  assert.ok(w.ship.cloak, 'Atlas dostaje maskowanie');
  S.beginNewGame({ tutorial: true, menuPose: null });
  await flush();

  // intro: kamera kinowa, świat zamrożony, Atlas w stanowisku (blokada), dach K-7 zamknięty, kamera gry czeka z góry
  assert.equal(S.cine.mode, 'path');
  assert.ok(S.worldFrozen && S.blocksInput && S.letterbox);
  assert.ok(S.lock, 'Atlas zablokowany w doku');
  assert.deepEqual(w.roof, { key: 'earth', hall: 0, roofFade: 0, cut: 1 }, 'dach zamknięty na czas lotu');
  assert.equal(w.gameCam?.x, w.ship.pos.x, 'kamera gry w kadrze końca toru');
  assert.ok(w.classicForced);
  const berth = { x: w.ship.pos.x, y: w.ship.pos.y };
  await frames(S, w, Math.ceil(S.cine.duration * 30) + 5, view);
  // koniec toru: kamera 2D gry (cameraFrame → null), dach się otwiera, świat dalej stoi
  assert.equal(S.cine.mode, null);
  assert.ok(S.reveal && S.worldFrozen);
  await frames(S, w, 30 * 3, view);
  assert.equal(w.roof, null, 'dach oddany grze (otwarty — Atlas w hali)');
  assert.ok(w.gameCamReleased, 'zoom wraca do statku');
  assert.equal(S.phase, 'briefing');
  assert.ok(S.dialogue.active && S.dialogue.mode === 'scene');
  assert.ok(S.worldFrozen, 'scena zamraża świat');
  // odprawa: gracz przewija
  for (let i = 0; i < 40 && S.dialogue.active && S.dialogue.mode === 'scene'; i++) { S.dialogue.advance(); await flush(); }
  await frames(S, w, 2, view);
  assert.equal(S.phase, 'undock');
  assert.ok(!S.worldFrozen, 'odcumowanie w czasie gry');
  // wysunięcie: ~13 s gry, potem kamera oddana grze
  await frames(S, w, 30 * 16, view);
  assert.equal(S.lock, null, 'blokada zdjęta po odcumowaniu');
  assert.ok(Math.hypot(w.ship.pos.x - berth.x, w.ship.pos.y - berth.y) > 2000, 'Atlas wysunięty ze stanowiska');
  await frames(S, w, 30 * 3, view);
  assert.equal(S.cine.mode, null, 'kino skończone');
  assert.equal(w.hud, true, 'HUD wrócił');
  assert.ok(S.ui.objective && /K-7/.test(S.ui.objective.text));
  assert.ok(S.ui.hint, 'samouczek sterowania');

  // wylot z hali → kurs na stocznię
  const p = S._api().dock.approachPoint();
  w.ship.pos.x = p.x; w.ship.pos.y = p.y;
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'course');
  assert.ok(S.site && S.site.station, 'stocznia postawiona');
  assert.equal(S.site.parkedList.length, 10);
  assert.ok(S.site.parkedList.every((n) => n.asleep), 'zaparkowane bez załogi');
  assert.equal(S.site.turretList.length, 6);
  assert.equal(w.courses.length >= 1, true, 'kurs wyznaczony');
  // skok: przy punkcie zbiórki
  w.ship.pos.x = S.site.rally.x; w.ship.pos.y = S.site.rally.y;
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'approach');
  // maskowanie
  engageCloak(w.ship.cloak);
  stepCloak(w.ship.cloak, 3);
  await frames(S, w, 3, view);
  assert.ok(/rzędu/.test(S.ui.objective?.text || ''), S.ui.objective?.text);
  // podejście pod rząd (niewykryty — ukryty)
  w.ship.pos.x = S.site.rowStart.x - 3000 * Math.cos(S.site.axis); w.ship.pos.y = S.site.rowStart.y - 3000 * Math.sin(S.site.axis);
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'ram');
  assert.ok(!S.site.alarmed);
  // taran: trzy kadłuby zmiażdżone
  for (const n of S.site.parkedList.slice(0, 3)) { n.dead = true; n.hp = 0; }
  await frames(S, w, 4, view);
  assert.ok(S.site.alarmed, 'alarm po taranie');
  assert.ok(S.site.turretList.every((n) => !n.asleep), 'wieżyczki obudzone');
  assert.equal(S.phase, 'defences');
  for (const n of [...S.site.turretList, ...S.site.defenderList]) { n.dead = true; n.hp = 0; }
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'shipyard');
  assert.ok(/wbudowaną/.test(S.ui.objective?.text || ''));
  // budynek: Hexlance
  S.site.station.hp = 0; S.site.station._destroyed3D = true;
  await frames(S, w, 30 * 5, view);
  assert.ok(w.blows >= 7, `łańcuch wybuchów (${w.blows})`);
  assert.ok(S.site.parkedList.every((n) => n.dead), 'reszta rzędu idzie z zakładem');
  // odwet: fale przez kolejkę przylotów
  await frames(S, w, 30 * 6, view);
  assert.equal(S.phase, 'counter');
  await frames(S, w, 30 * 12, view);
  const pirates = w.npcs.filter((n) => n.__storyTag === 'counter');
  assert.equal(pirates.length, 30, 'odwet: 7 + 8 + 15');
  assert.equal(pirates.filter((n) => /battleship/.test(n.type)).length, 7);
  await frames(S, w, 30 * (MISSION01.supportDelaySec + 10), view);
  const allies = w.npcs.filter((n) => n.__storyTag === 'support');
  assert.equal(allies.length, 20, 'wsparcie: 10 + 5 + 5');
  assert.ok(allies.every((n) => n.friendly));
  // bitwa: 25 piratów pada, reszta ucieka
  for (const n of pirates.slice(0, 25)) { n.dead = true; n.hp = 0; }
  await frames(S, w, 10, view);
  assert.equal(w.warpedOut, 5, 'niedobitki odlatują tunelem');
  await frames(S, w, 10, view);
  assert.equal(S.phase, 'victory');
  // nagrody i podsumowanie
  await frames(S, w, 30 * 4, view);
  assert.ok(S.ui.summary, 'podsumowanie misji');
  assert.ok(S.worldFrozen);
  assert.equal(w.credits, MISSION01.rewards.credits);
  assert.deepEqual(w.rep, [['terra_nova', 15], ['pirates', -20]]);
  assert.equal(S.progress.exp, MISSION01.rewards.exp);
  assert.equal(S.ui.summary.reward.exp, MISSION01.rewards.exp);
  assert.ok(w.wingReturned, 'wsparcie wraca na Ziemię');
  S.closeSummary();
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'return');
  assert.ok(w.course, 'kurs na K-7 istnieje na początku powrotu');
  // powrót: przy porcie → przejście przez czerń, dok, scena
  w.ship.pos.x = p.x + 2000; w.ship.pos.y = p.y;
  await frames(S, w, 6, view);
  assert.ok(S.lock, 'z powrotem w stanowisku');
  assert.equal(w.course, null, 'powrót do hali kasuje kurs również w grze');
  assert.equal(S.ui.course, null);
  assert.equal(S.ui.markers.has('course'), false);
  assert.ok(S.dialogue.active && S.dialogue.mode === 'scene');
  for (let i = 0; i < 40 && S.dialogue.active; i++) { S.dialogue.advance(); await flush(); }
  await frames(S, w, 30 * 4, view);
  assert.equal(S.phase, 'done');
  assert.deepEqual(w.completed, [MISSION01.id]);
  assert.equal(S.lock, null);
  assert.equal(S.cine.mode, null);
  assert.equal(S.runner.result, 'complete');
  assert.equal(w.course, null, 'po zakończeniu misji stary kurs nie wraca');
  S.abort('test');
});

test('skok dev ?story=counter: stocznia zburzona, od razu odwet', async () => {
  const w = makeWorld();
  const S = StoryGame;
  S.init(w.deps);
  const view = new ViewState3D();
  S.beginNewGame({ tutorial: false, startPhase: 'counter' });
  await flush();
  await frames(S, w, 30 * 6, view);
  assert.equal(S.phase, 'counter');
  assert.ok(S.site.station._destroyed3D);
  assert.equal(S.ui.hint, null, 'bez samouczka');
  await frames(S, w, 30 * 12, view);
  assert.equal(w.npcs.filter((n) => n.__storyTag === 'counter').length, 30);
  S.abort('test');
});
