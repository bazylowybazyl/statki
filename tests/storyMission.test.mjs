// Fabuła (2026-09-30, kampania z dwóch misji 2026-10-07): misje 1 i 2 na atrapie gry — StoryGame (klej) + skrypty
// od doku przez stocznię (zegar wodowania, herszt) i odwet w falach do powrotu. Sprawdza kolejność faz, zamrożenie
// świata w scenach, blokadę w doku, starty z parkingu i pochylni, ucieczkę herszta, fale warpa, nagrody i dziennik.
import test from 'node:test';
import assert from 'node:assert/strict';

import { StoryGame, STORY_UNDOCK } from '../src/game/story/storyGame.js';
import { ViewState3D } from '../src/game/view3D.js';
import { engageCloak, stepCloak } from '../src/game/cloak.js';
import { MISSION01 } from '../src/game/story/missions/mission01.js';
import { MISSION02 } from '../src/game/story/missions/mission02.js';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function makeWorld() {
  const AU = 42253.52;
  const sun = { x: 6_000_000, y: 6_000_000 };
  const earth = { id: 'earth', x: sun.x + 25 * AU, y: sun.y, r: 600 };
  const ship = { pos: { x: earth.x + 50000, y: earth.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0, w: 1800, h: 800, x: 0, y: 0 };
  const w = {
    AU, sun, earth, ship, npcs: [], stations: [], credits: 0, rep: [], journal: [], completed: [], phases: [],
    warpedOut: 0, blows: 0, courses: [], course: null,
    // mgła wojny (atrapa SensorSystem): co strona gracza widzi, sygnatury masy
    fogSeen: new Set(), masses: new Map(),
    hallPoses: new Map(['C-01', 'C-02', 'C-03', 'C-04'].map((id) => [id, { clamp: 0, extension: 0, seat: 0, lock: 0, flow: 0, vent: 0 }]))
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
    // rejestr hali w koliderze (pozy obsługi stanowisk — zamki pola, ramiona i przewody paliwowe)
    k7HallPoses: () => w.hallPoses,
    viewHeight: () => 900,
    forceClassicCamera: () => { w.classicForced = true; },
    setGameCamera: (x, y, zoom) => { w.gameCam = { x, y, zoom }; w.gameCamReleased = false; },
    releaseGameCamera: () => { w.gameCamReleased = true; },
    setHallRoof: (o) => { w.roof = o ? { ...o } : null; },
    hasContact: (a, b) => !!w.contact?.has(b),
    setCourse: (x, y) => { w.course = { x, y }; w.courses.push(w.course); },
    clearCourse: () => { w.course = null; },
    warpState: () => w.warp || 'idle',
    // zasadzka w pasie: wyrwanie z warpa / przerwane ładowanie (zakłócacz)
    interdictWarp: () => { if ((w.warp || 'idle') === 'idle') return false; w.warp = 'idle'; w.interdicted = (w.interdicted || 0) + 1; return true; },
    spawnShip: (key, opts) => [mkNpc(key, opts, opts.mode)],
    spawnPirateStation: (spec) => { const st = { ...spec, maxHp: spec.hp, _destroyed3D: false }; w.stations.push(st); return st; },
    spawnTurret: (spec) => mkNpc('turret', { spawnPos: spec }, 'pirate'),
    sleepNpc: (n) => { n.asleep = true; },
    wakeNpc: (n) => { n.asleep = false; },
    launchNpc: (n, path, delay, opts) => { n.asleep = false; n.launch = { path, delay, opts }; },
    armNpc: (n) => { n.armed = true; },
    fleeNpc: (n, p) => { n.flee = p; },
    openDockGate: (id) => (w.gates ||= []).push(id),
    isHulk: (n) => !!n.isBridgeHulk,
    bridgeAimPoint: (n, out) => { out.x = (n.pos?.x ?? n.x) + 100; out.y = (n.pos?.y ?? n.y); return out; },
    hullRatio: (e) => (e === ship ? (w.hull ?? 1) : (e?.hullRatio ?? 1)),
    repairPlayer: () => true,
    repairActive: () => false,
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
    warn: () => {},
    fogEnabled: () => true,
    fogSeen: (e) => w.fogSeen.has(e),
    setMassSignature: (sid, spec) => { const m = { ...spec, resolved: false }; w.masses.set(sid, m); return m; },
    clearMassSignature: (sid) => { w.masses.delete(sid); },
    massResolved: (sid) => !w.masses.has(sid) || w.masses.get(sid).resolved
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

test('kampania na atrapie gry: misja 1 (dok, rozpoznanie, taran, zegar wodowania, herszt, dok piratów) i misja 2 (naprawa, trzy fale, zasadzka w pasie, powrót)', async () => {
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
  assert.equal(S.cine.mode, null, 'kino skończone');
  assert.equal(w.hud, true, 'HUD wrócił przed odcumowaniem');
  // dok: Atlas przypięty do stanowiska, dopóki gracz nie kliknie ODDOKUJ (2026-10-07)
  assert.ok(S.ui.action && S.ui.action.id === 'undock' && S.ui.action.label === 'ODDOKUJ', 'panel stanowiska z przyciskiem ODDOKUJ');
  assert.ok(S.ui.hint, 'samouczek: odcumowanie');
  await frames(S, w, 30 * 10, view);
  assert.ok(S.lock && S.blocksInput, 'bez kliknięcia Atlas stoi w doku (stery zablokowane)');
  assert.ok(Math.hypot(w.ship.pos.x - berth.x, w.ship.pos.y - berth.y) < 1, 'na stanowisku');
  const row = (label) => S.ui.action.rows().find((r) => r[0] === label)?.[1];
  assert.equal(row('PALIWO'), 'PRZEPŁYW');
  assert.equal(row('ZŁĄCZA'), 'ZARYGLOWANE');
  const pose = w.hallPoses.get('C-01');
  assert.ok(pose.lock === 1 && pose.extension === 1 && pose.flow === 1, 'przewody podpięte w rejestrze hali');
  assert.equal(pose.owner, 'story', 'poza fabuły ma właściciela (automat stanowisk gry swobodnej jej nie rusza)');
  assert.equal(S.triggerAction('undock'), true, 'klik ODDOKUJ');
  assert.equal(S.triggerAction('undock'), false, 'drugi klik nic nie robi');
  // sekwencja obsługi: przepływ → kontrolowany upust (gaz z przewodów) → rygle → złączki w górę → zamki → napęd
  let maxVent = 0;
  let lockWhenVent = 0;
  await frames(S, w, Math.ceil(STORY_UNDOCK.driveAt * 30) + 4, view, () => {
    if (pose.vent > maxVent) { maxVent = pose.vent; lockWhenVent = pose.lock; }
  });
  assert.ok(maxVent > 0.95, `kontrolowany upust: ${maxVent}`);
  assert.ok(lockWhenVent > 0.9, 'upust przed odryglowaniem');
  assert.equal(S.lock, null, 'napęd odblokowany po zwolnieniu mocowań');
  assert.ok(!S.blocksInput, 'stery u gracza');
  assert.ok(pose.lock < 0.01 && pose.seat < 0.01 && pose.clamp < 0.01, 'złączki odryglowane i podniesione, zamki pola zwolnione');
  assert.ok(Math.hypot(w.ship.pos.x - berth.x, w.ship.pos.y - berth.y) < 1, 'bez automatycznego wysuwania — wylot należy do gracza');
  assert.ok(S.ui.objective && /K-7/.test(S.ui.objective.text));
  assert.ok(S.ui.hint, 'samouczek sterowania');
  await frames(S, w, 30 * 5, view);
  assert.equal(S.ui.action, null, 'panel stanowiska znika');
  assert.ok(pose.extension < 0.01 && pose.seat < 0.01, 'ramiona paliwowe złożone');
  assert.equal(pose.owner, null, 'koniec odcumowania: poza oddana automatowi stanowisk');

  // wylot z hali → kurs na stocznię
  const p = S._api().dock.approachPoint();
  w.ship.pos.x = p.x; w.ship.pos.y = p.y;
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'course');
  assert.ok(S.site && S.site.station, 'stocznia postawiona');
  assert.equal(S.site.parkedList.length, 10, 'dziesięć okrętów na parkingu suchego doku');
  assert.ok(S.site.parkedList.every((n) => n.asleep), 'zaparkowane bez załogi');
  assert.equal(S.site.turretList.length, 0, 'bez wieżyczek (2026-10-05)');
  assert.equal(w.courses.length >= 1, true, 'kurs wyznaczony');
  // skok „kawałek dalej”: kurs na punkt wyjścia z warpa, poza zasięgiem wzroku Atlasa (mgła wojny)
  assert.deepEqual(w.course, { x: S.site.warpIn.x, y: S.site.warpIn.y }, 'kurs na wyjście z warpa, nie na zbiórkę');
  assert.ok(Math.hypot(S.site.warpIn.x - S.site.building.x, S.site.warpIn.y - S.site.building.y) > 50000, 'stocznia za mgłą');
  w.ship.pos.x = S.site.warpIn.x; w.ship.pos.y = S.site.warpIn.y;
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'scout');
  const mass = w.masses.get('m01-yard-mass');
  assert.ok(mass, 'czujniki grawitacyjne: sygnatura masy');
  assert.equal(mass.entity, S.site.station, 'rozpoznanie sygnatury = zobaczenie budynku');
  assert.ok(mass.offset && Math.hypot(mass.offset.x, mass.offset.y) > 1000, 'miejsce niepewne (odchyłka)');
  assert.ok(/sygnatur/.test(S.ui.objective?.text || ''), S.ui.objective?.text);
  assert.ok(S.ui.hint, 'samouczek: mgła wojny i dron zwiadu');
  await frames(S, w, 30, view);
  assert.equal(S.phase, 'scout', 'bez rozpoznania misja czeka');
  assert.ok(!S.site.alarmed, 'zwiad z daleka nie budzi stoczni');
  // dron zwiadu / podejście: budynek w zasięgu wzroku strony gracza
  w.fogSeen.add(S.site.station);
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'approach');
  assert.equal(w.masses.size, 0, 'sygnatura zdjęta po rozpoznaniu');
  // podejście: na punkt zbiórki
  w.ship.pos.x = S.site.rally.x; w.ship.pos.y = S.site.rally.y;
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'approach');
  assert.equal(S.ui.targets.size, 0, 'podejście ma punkt nawigacji, bez etykiet wszystkich statków');
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
  // taran: znaczniki na okrętach parkingu; pierwszy zniszczony kadłub budzi stocznię
  assert.equal(S.ui.targets.size, 10, 'znacznik na każdym okręcie parkingu');
  assert.ok(/\(F\).*\(4\)/.test(S.ui.objective?.text || ''), 'cel podaje obie drogi: ' + S.ui.objective?.text);
  const kill = (n) => { n.dead = true; n.hp = 0; };
  const parked = S.site.parkedList;
  kill(parked[0]);
  await frames(S, w, 2, view);
  assert.ok(S.site.alarmed, 'alarm po taranie');
  // eskorta i supercapital wylatują z hali suchego doku bramami (trasa z planu): supercapital pierwszy
  assert.ok(S.site.defenderList.length === 6 && S.site.defenderList.every((n) => n.launch && n.launch.path.length >= 3), 'wylot eskorty trasą');
  assert.equal(S.site.defenderList[0].type, 'pirate_supercapital');
  const boss = S.site.flagship;
  assert.equal(boss, S.site.defenderList[0]);
  const delays = S.site.defenderList.map((n) => n.launch.delay);
  assert.ok(delays.slice(1).every((d) => d > delays[0]), 'supercapital wylatuje pierwszy');
  assert.equal(new Set(delays).size, delays.length, 'kolejno, bez dwóch naraz');

  // ZEGAR WODOWANIA (2026-10-07): parking i pochylnie startują po kolei; cele: 9 na parkingu, 2 pochylnie, obrona
  assert.equal(S.phase, 'defences');
  const slips = S.site.slipList;
  assert.equal(slips.length, 2, 'dwa pancerniki na pochylniach hali');
  assert.ok(slips.every((n) => n.asleep && n.hp < n.maxHp), 'niedokończone kadłuby, bez załogi');
  assert.equal(S.ui.targets.size, 9 + 2 + 6);
  assert.ok(/ZNISZCZONY D-01 · 1 \/ 12/.test(S.ui.banner?.text || ''), S.ui.banner?.text);
  assert.ok(/Nie dopuść/.test(S.ui.objective?.text || '') && /start za 0:4\d/.test(S.ui.objective.progress()), S.ui.objective?.progress?.());
  // taran: zmiażdżony kadłub w styku z Atlasem
  parked[1].hullRatio = 0.2;
  w.contact = new Set([parked[1]]);
  await frames(S, w, 2, view);
  assert.ok(/STARANOWANY D-02 · 2 \/ 12/.test(S.ui.banner?.text || ''), S.ui.banner?.text);
  w.contact = null;
  // pierwszy start: z końca parkingu (G-E) — D-09 (niszczyciel) po 48 s, w połowie rozgrzewania strzela ze stanowiska
  const d09 = parked[8];
  await frames(S, w, 30 * 26, view);
  assert.ok(d09.armed && !d09.launch, 'załoga przy działach w połowie rozgrzewania');
  await frames(S, w, 30 * 23, view);
  assert.ok(d09.launch, 'D-09 wystartował');
  assert.equal(d09.launch.opts.fightFrom, 1);
  assert.ok(Number.isFinite(d09.launch.path[0].face) && d09.launch.path[0].speed > 0, 'rufą przez bramę stanowiska');
  assert.ok(w.gates.includes('B-09'), 'brama stanowiska otwarta');
  assert.equal(S.ui.targets.get('ram-8')?.group, 'Wystartowały');
  assert.ok(!parked[2].launch, 'reszta parkingu jeszcze stoi');
  kill(d09);
  await frames(S, w, 2, view);
  assert.equal(S.ui.targets.has('ram-8'), false, 'zniszczony po starcie traci znacznik');

  // HERSZT: przy 2/3 punktów przyspiesza starty, przy 1/3 ucieka i ładuje skok
  assert.ok(S.ui.markers.has('bridge'), 'mostek supercapitala jako słaby punkt');
  assert.notDeepEqual(S.journalEntry.pos, S.ui.markers.get('bridge'), 'mostek nie przejmuje dziennika');
  boss.hp = boss.maxHp * 0.6;
  await frames(S, w, 30 * 10, view);
  assert.ok(parked[9].launch, 'D-10 (pancernik, 60 s) wystartował wcześniej — herszt przyspieszył starty');
  boss.hp = boss.maxHp * 0.3;
  await frames(S, w, 3, view);
  assert.ok(boss.flee, 'herszt ucieka');
  assert.equal(S.ui.objective?.id, 'boss-flee');
  await frames(S, w, 30 * (MISSION01.boss.escapeSec + 1), view);
  assert.ok(boss.warpedOut, 'nie zatrzymany — odleciał warpem');
  assert.equal(S.ui.markers.has('bridge'), false);
  // reszta stoczni: wystartowane, w stanowiskach i na pochylniach (te jeszcze nie zwodowane), eskorta
  assert.ok(slips[0].launch && !slips[1].launch, 'pierwsza pochylnia zwodowana (przyspieszona przez herszta), druga jeszcze w budowie');
  for (const n of [...parked, ...slips, ...S.site.defenderList]) if (!n.dead) kill(n);
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'shipyard');
  assert.deepEqual([...S.ui.targets.keys()], ['yard'], 'poprzednie cele zdjęte po bitwie');
  assert.equal(S.ui.targets.get('yard').entity, S.site.station, 'budynek śledzi żywą stację');
  assert.equal(S.ui.targets.get('yard').radius, S.site.buildingRadius, 'ramka otacza bryłę, nie małą kolizję stacji');
  assert.equal(S.ui.markers.has('yard'), false, 'budynek nie ma drugiej etykiety nawigacji');
  assert.deepEqual(S.journalEntry.pos, S.site.building, 'CIC i dziennik dalej wskazują budynek');
  assert.ok(/wbudowaną/.test(S.ui.objective?.text || ''));
  assert.equal(S.site.station.maxHp, MISSION01.dock.hp, 'dok z punktami misji');
  // budynek: Hexlance → łańcuch rozpadu → podsumowanie misji 1 w polu
  S.site.station.hp = 0; S.site.station._destroyed3D = true;
  await frames(S, w, 30 * 9, view);
  assert.equal(S.ui.targets.size, 0, 'po zniszczeniu budynku nie zostaje marker na wraku');
  assert.ok(w.blows >= 7, `łańcuch wybuchów (${w.blows})`);
  for (let i = 0; i < 30 && !S.ui.summary; i++) await frames(S, w, 30, view);
  assert.equal(S.phase, 'aftermath');
  assert.ok(S.ui.summary, 'podsumowanie misji 1');
  const stopRow = S.ui.summary.stats.find((r) => /Zatrzymane/.test(r[0]));
  const stopped = Number(/^(\d+) \/ 12$/.exec(stopRow[1])?.[1]);
  assert.ok(stopped >= 3, `zatrzymane przed startem: ${stopRow[1]}`);
  assert.equal(S.ui.summary.stats.find((r) => /herszta/.test(r[0]))[1], 'uciekł');
  assert.equal(w.credits, MISSION01.rewards.credits + stopped * MISSION01.bonus.perStopped.credits, 'premia za zatrzymane, bez premii za herszta');
  assert.equal(S.progress.exp, MISSION01.rewards.exp + stopped * MISSION01.bonus.perStopped.exp);
  assert.deepEqual(w.rep, [['terra_nova', 10], ['pirates', -12]]);
  assert.equal(S.campaign.bossEscaped, true);
  S.closeSummary();
  const exp1 = S.progress.exp;
  const credits1 = w.credits;

  // MISJA 2 „Odwet”: naprawa, trzy fale, posiłki w drugiej, herszt wraca w trzeciej
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'repair');
  assert.equal(S.journalEntry.id, MISSION02.id, 'nowy wpis dziennika');
  assert.deepEqual(w.completed, [MISSION01.id], 'misja 1 zaliczona w polu');
  assert.ok(/Napraw/.test(S.ui.objective?.text || ''));
  await frames(S, w, 30 * 9, view);
  assert.equal(S.phase, 'counter', 'pełny kadłub — odwet po chwili');
  await frames(S, w, 30 * 8, view);
  const wave1 = w.npcs.filter((n) => n.__storyTag === 'counter');
  assert.equal(wave1.length, 13, 'fala 1: 4 niszczyciele + 9 fregat');
  assert.equal(wave1.filter((n) => /battleship/.test(n.type)).length, 0);
  assert.ok(/Fala 1/.test(S.ui.objective?.text || ''));
  wave1.forEach(kill);
  await frames(S, w, 3, view);
  assert.equal(S.ui.objective?.id, 'break', 'przerwa między falami');
  await frames(S, w, 30 * (MISSION02.breakSec + 1), view);
  assert.equal(S.phase, 'counter2');
  await frames(S, w, 30 * 6, view);
  const wave2 = w.npcs.filter((n) => n.__storyTag === 'counter2');
  assert.equal(wave2.length, 11, 'fala 2: 5 pancerników + 3 niszczyciele + 3 fregaty');
  assert.equal(wave2.filter((n) => /battleship/.test(n.type)).length, 5);
  await frames(S, w, 30 * (MISSION02.supportDelaySec + 4), view);
  const allies = w.npcs.filter((n) => n.__storyTag === 'support');
  assert.equal(allies.length, 12, 'wsparcie: 4 + 4 + 4 (słabsze od odwetu)');
  assert.ok(allies.every((n) => n.friendly));
  // fala 2 pada do ostatniego okrętu — ten ucieka po `rout.delay`
  wave2.slice(0, 10).forEach(kill);
  const out0 = w.warpedOut;
  await frames(S, w, 30 * (MISSION02.rout.delay + 1), view);
  assert.equal(w.warpedOut, out0 + 1, 'niedobitek odlatuje tunelem');
  await frames(S, w, 30 * (MISSION02.breakSec + 1), view);
  assert.equal(S.phase, 'counter3');
  await frames(S, w, 30 * 6, view);
  const wave3 = w.npcs.filter((n) => n.__storyTag === 'counter3');
  assert.equal(wave3.length, 7, 'fala 3: 2 + 1 + 3 i okręt herszta');
  const boss2 = wave3.find((n) => n.__storyBoss);
  assert.ok(boss2 && boss2.type === 'pirate_supercapital', 'herszt w trzeciej fali');
  assert.equal(boss2.hp, Math.round(boss2.maxHp * MISSION02.bossHpEscaped), 'uciekł z misji 1 — wraca połatany');
  assert.equal(S.ui.targets.get('boss')?.entity, boss2);
  await frames(S, w, 2, view);
  assert.ok(S.ui.markers.has('bridge'));
  kill(boss2);
  const out1 = w.warpedOut;
  await frames(S, w, 30 * (MISSION02.bossRoutDelay + 1), view);
  assert.equal(w.warpedOut, out1 + 6, 'po upadku herszta reszta fali ucieka');
  await frames(S, w, 30 * 4, view);
  assert.equal(S.phase, 'victory');
  assert.ok(S.ui.summary, 'podsumowanie misji 2');
  assert.ok(S.worldFrozen);
  assert.equal(w.credits, credits1 + MISSION02.rewards.credits);
  assert.equal(S.progress.exp, exp1 + MISSION02.rewards.exp);
  assert.deepEqual(w.rep.slice(2), [['terra_nova', 10], ['pirates', -10]]);
  assert.ok(w.wingReturned, 'wsparcie wraca na Ziemię');
  S.closeSummary();
  await frames(S, w, 3, view);
  // ZASADZKA W PASIE: kurs do domu przecina pas, w nim piraci wyrywają Atlasa z warpa
  assert.equal(S.phase, 'ambush', 'droga do domu przez pas asteroid');
  assert.ok(w.course, 'kurs na K-7 od razu po podsumowaniu');
  assert.ok(/K-7/.test(S.ui.objective?.text || ''), 'gracz o zasadzce nie wie');
  const plan = S.ambushPlan;
  assert.ok(plan && plan.kind === 'belt', 'atrapa bez mapy gęstości: środek cięciwy pasa');
  w.warp = 'active';
  w.ship.pos.x = plan.x; w.ship.pos.y = plan.y;
  await frames(S, w, 3, view);
  assert.equal(w.interdicted, 1, 'wyrwany z warpa');
  assert.equal(w.course, null, 'kurs zdjęty na czas walki');
  assert.ok(/WYRWANI Z WARPA/.test(S.ui.banner?.text || ''), S.ui.banner?.text);
  await frames(S, w, 30 * 3, view);
  const front = w.npcs.filter((n) => n.__storyTag === 'ambush');
  assert.equal(front.length, 6, 'front zasadzki: niszczyciel, 4 fregaty i zakłócacz');
  const jammer = front.find((n) => n.__storyJammer);
  assert.ok(jammer && S.ui.targets.get('jammer')?.entity === jammer, 'zakłócacz oznaczony');
  // front przed Atlasem na kursie, tunele z pola przed nim
  const ahead = (n) => (n.pos.x - w.ship.pos.x) * plan.dirX + (n.pos.y - w.ship.pos.y) * plan.dirY;
  assert.ok(front.every((n) => ahead(n) > 3000), 'front przed dziobem na kursie');
  front.forEach(kill);
  await frames(S, w, 3, view);
  assert.ok(/Rozbij/.test(S.ui.objective?.text || ''), S.ui.objective?.text);
  await frames(S, w, 30 * MISSION02.ambush.flankDelay, view);
  const flank = w.npcs.filter((n) => n.__storyTag === 'ambush' && !front.includes(n));
  assert.equal(flank.length, 3, 'skrzydło zasadzki z boku kursu');
  flank.forEach(kill);
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'return');
  assert.ok(w.course, 'kurs na K-7 przywrócony po zasadzce');
  assert.equal(S.ui.targets.has('jammer'), false);
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
  assert.deepEqual(w.completed, [MISSION01.id, MISSION02.id]);
  assert.equal(S.lock, null);
  assert.equal(S.cine.mode, null);
  assert.equal(S.runner.result, 'complete');
  assert.equal(w.course, null, 'po zakończeniu misji stary kurs nie wraca');
  S.abort('test');
  assert.equal(S.ui.targets.size, 0);
});

test('misja 1: herszt zatrzymany przed skokiem, dok zburzony w środku bitwy — w stanowiskach giną, wystartowane nie', async () => {
  const w = makeWorld();
  const S = StoryGame;
  S.init(w.deps);
  const view = new ViewState3D();
  S.beginNewGame({ tutorial: false, startPhase: 'defences' });
  await flush();
  await frames(S, w, 2, view);
  assert.equal(S.phase, 'defences');
  const parked = S.site.parkedList;
  await frames(S, w, 30 * 49, view);
  const launched = parked.filter((n) => n.launch);
  assert.ok(launched.length >= 1, 'pierwszy start z parkingu');
  // eskorta i herszt już poza halą (atrapa nie lata — stawiamy je na końcu trasy wylotu)
  for (const n of S.site.defenderList) { const q = n.launch.path.at(-1); n.pos.x = n.x = q.x; n.pos.y = n.y = q.y; }
  // dok pada w środku bitwy: łańcuch zabiera to, co stoi w stanowiskach i na pochylniach
  S.site.station.hp = 0; S.site.station._destroyed3D = true;
  await frames(S, w, 30 * 9, view);
  assert.ok(parked.filter((n) => !n.launch).every((n) => n.dead), 'w stanowiskach — z dokiem');
  assert.ok(S.site.slipList.every((n) => n.dead), 'pochylnie — z dokiem');
  assert.ok(launched.every((n) => !n.dead), 'wystartowane walczą dalej');
  assert.equal(S.phase, 'defences', 'bitwa trwa, póki są wrogowie');
  // herszt: bez dowodzenia (mostek) w trakcie ładowania skoku
  const boss = S.site.flagship;
  boss.hp = boss.maxHp * 0.3;
  await frames(S, w, 3, view);
  assert.ok(boss.flee);
  boss.isBridgeHulk = true;
  await frames(S, w, 3, view);
  for (const n of [...launched, ...S.site.defenderList]) { n.dead = true; n.hp = 0; }
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'aftermath', 'dok już zburzony — od razu podsumowanie');
  await frames(S, w, 30 * 4, view);
  assert.equal(S.ui.summary.stats.find((r) => /herszta/.test(r[0]))[1], 'bez dowodzenia');
  assert.equal(S.campaign.bossEscaped, false);
  assert.ok(w.credits > MISSION01.rewards.credits + MISSION01.bonus.boss.credits, 'premia za herszta i zatrzymane');
  S.abort('test');
});

test('skok dev ?story=counter: misja 1 pominięta (stocznia zburzona), misja 2 od pierwszej fali', async () => {
  const w = makeWorld();
  const S = StoryGame;
  S.init(w.deps);
  const view = new ViewState3D();
  S.beginNewGame({ tutorial: false, startPhase: 'counter' });
  await flush();
  // łańcuch rozpadu suchego doku (~6 s), misja 1 zaliczona bez podsumowania, naprawa pominięta
  await frames(S, w, 30 * 9, view);
  assert.equal(S.phase, 'counter');
  assert.ok(S.site.station._destroyed3D);
  assert.equal(S.ui.hint, null, 'bez samouczka');
  assert.equal(S.ui.summary, null, 'pominięta misja bez podsumowania');
  assert.equal(S.journalEntry.id, MISSION02.id);
  assert.ok([...S.site.parkedList, ...S.site.slipList, ...S.site.defenderList].every((n) => n.dead), 'stocznia pokonana');
  await frames(S, w, 30 * 8, view);
  assert.equal(w.npcs.filter((n) => n.__storyTag === 'counter').length, 13, 'fala 1');
  S.abort('test');
});

test('skok dev ?story=ambush: Atlas na kursie przed pasem, wyrwanie z warpa w miejscu zasadzki, zakłócacz zrywa skok, niedobitek ucieka, dalej do K-7', async () => {
  const w = makeWorld();
  const S = StoryGame;
  S.init(w.deps);
  const view = new ViewState3D();
  const kill = (n) => { n.dead = true; n.hp = 0; };
  S.beginNewGame({ tutorial: false, startPhase: 'ambush' });
  await flush();
  // łańcuch rozpadu doku (misja 1 pominięta), misja 2 pominięta do zasadzki
  await frames(S, w, 30 * 9, view);
  assert.equal(S.phase, 'ambush');
  assert.equal(S.ui.summary, null, 'pominięte fazy bez podsumowania');
  const plan = S.ambushPlan;
  const r = Math.hypot(plan.x - w.sun.x, plan.y - w.sun.y);
  assert.ok(r > 36 * w.AU && r < 47 * w.AU, 'miejsce w pasie');
  const d0 = Math.hypot(w.ship.pos.x - plan.x, w.ship.pos.y - plan.y);
  assert.ok(Math.abs(d0 - MISSION02.ambush.devBack) < 1, 'teleport przed miejsce zasadzki na kursie');
  assert.ok(Math.abs(w.ship.angle - plan.angle) < 1e-9, 'dziobem w kurs');
  assert.ok(w.course, 'kurs na K-7 (TRAVEL TO prowadzi skok)');
  // warp: daleko przed miejscem — nic; w zasięgu hamowania (prędkość × brakeLead) — wyrwanie
  w.warp = 'active';
  const put = (back) => { w.ship.pos.x = plan.x - plan.dirX * back; w.ship.pos.y = plan.y - plan.dirY * back; };
  w.ship.vel.x = plan.dirX * 200000; w.ship.vel.y = plan.dirY * 200000;
  put(40000);
  await frames(S, w, 2, view);
  assert.equal(w.interdicted ?? 0, 0, 'za wcześnie');
  put(15000);
  await frames(S, w, 1, view);
  assert.equal(w.interdicted, 1, 'wyrwany z zapasem na hamowanie');
  assert.equal(w.course, null);
  w.ship.vel.x = w.ship.vel.y = 0;   // atrapa: wyhamował
  await frames(S, w, 30 * 3, view);
  const front = w.npcs.filter((n) => n.__storyTag === 'ambush');
  assert.equal(front.length, 6);
  const jammer = front.find((n) => n.__storyJammer);
  assert.equal(jammer?.type, MISSION02.ambush.jammer);
  assert.equal(jammer.displayName, 'Zakłócacz warpa');
  // zakłócacz zrywa ponowny skok (ładowanie), po jego upadku skok działa
  w.warp = 'charging';
  await frames(S, w, 1, view);
  assert.equal(w.interdicted, 2, 'ładowanie przerwane');
  assert.equal(w.warp, 'idle');
  kill(jammer);
  await frames(S, w, 3, view);
  assert.ok(/WARP ODBLOKOWANY/.test(S.ui.banner?.text || ''), S.ui.banner?.text);
  w.warp = 'charging';
  await frames(S, w, 1, view);
  assert.equal(w.interdicted, 2, 'bez zakłócacza skok nie jest zrywany');
  w.warp = 'idle';
  // skrzydło po flankDelay z boku kursu
  await frames(S, w, 30 * MISSION02.ambush.flankDelay, view);
  const flank = w.npcs.filter((n) => n.__storyTag === 'ambush' && !front.includes(n));
  assert.equal(flank.length, 3);
  const side = (n) => Math.abs((n.pos.x - w.ship.pos.x) * plan.dirY - (n.pos.y - w.ship.pos.y) * plan.dirX);
  assert.ok(flank.every((n) => side(n) > 5000), 'skrzydło z boku kursu');
  // zostaje jeden — ucieka po rout.delay
  [...front, ...flank].filter((n) => n !== flank[0]).forEach(kill);
  const out0 = w.warpedOut;
  await frames(S, w, 30 * (MISSION02.rout.delay + 1), view);
  assert.equal(w.warpedOut, out0 + 1, 'niedobitek zasadzki odlatuje');
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'return');
  assert.ok(w.course && /K-7/.test(S.ui.objective?.text || ''), 'dalej do K-7');
  S.abort('test');
});

test('zasadzka: Atlas odlatuje po upadku zakłócacza — reszta zostaje w pasie i ucieka, skrzydło nie przychodzi', async () => {
  const w = makeWorld();
  const S = StoryGame;
  S.init(w.deps);
  const view = new ViewState3D();
  const kill = (n) => { n.dead = true; n.hp = 0; };
  S.beginNewGame({ tutorial: false, startPhase: 'ambush' });
  await flush();
  await frames(S, w, 30 * 9, view);
  const plan = S.ambushPlan;
  w.ship.pos.x = plan.x; w.ship.pos.y = plan.y;
  await frames(S, w, 30 * 3, view);
  assert.equal(w.interdicted ?? 0, 0, 'bez warpa nie ma czego wyrywać');
  assert.ok(/^ZASADZKA$/.test(S.ui.banner?.text || ''), S.ui.banner?.text);
  const front = w.npcs.filter((n) => n.__storyTag === 'ambush');
  kill(front.find((n) => n.__storyJammer));
  await frames(S, w, 3, view);
  // skok dalej: Atlas daleko od miejsca zasadzki
  w.ship.pos.x += plan.dirX * (MISSION02.ambush.leaveDist + 5000);
  w.ship.pos.y += plan.dirY * (MISSION02.ambush.leaveDist + 5000);
  const out0 = w.warpedOut;
  await frames(S, w, 3, view);
  assert.equal(w.warpedOut, out0 + 5, 'reszta frontu ucieka');
  await frames(S, w, 30 * (MISSION02.ambush.flankDelay + 1), view);
  assert.equal(w.npcs.filter((n) => n.__storyTag === 'ambush').length, 6, 'skrzydło nie przychodzi');
  assert.equal(S.phase, 'return');
  assert.ok(w.course);
  S.abort('test');
});

test('skok dev ?story=scout: Atlas w punkcie wyjścia z warpa, sygnatura masy; przerwanie ją zdejmuje', async () => {
  const w = makeWorld();
  const S = StoryGame;
  S.init(w.deps);
  const view = new ViewState3D();
  S.beginNewGame({ tutorial: false, startPhase: 'scout' });
  await flush();
  await frames(S, w, 3, view);
  assert.equal(S.phase, 'scout');
  assert.ok(Math.hypot(w.ship.pos.x - S.site.warpIn.x, w.ship.pos.y - S.site.warpIn.y) < 1, 'teleport do wyjścia z warpa');
  assert.ok(w.masses.has('m01-yard-mass'));
  S.abort('test');
  assert.equal(w.masses.size, 0, 'reset fabuły zdejmuje sygnatury misji');
});

test('przerwanie i nowa misja usuwają poprzednie cele bojowe', async () => {
  const w = makeWorld(), S = StoryGame;
  S.init(w.deps);
  S.beginNewGame({ tutorial: false, startPhase: 'defences' });
  await flush();
  assert.equal(S.ui.targets.size, 7 + 2 + 6, 'parking (bez trzech staranowanych), pochylnie, obrona stoczni');
  S.abort('test');
  assert.equal(S.ui.targets.size, 0, 'przerwanie nie zostawia podpisów');
  S.beginNewGame({ tutorial: false, startPhase: 'shipyard' });
  await flush();
  assert.deepEqual([...S.ui.targets.keys()], ['yard'], 'druga misja ma tylko własne aktualne cele');
  S.abort('test');
});
