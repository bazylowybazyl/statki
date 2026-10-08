// Holownik serwisowy — logika (src/game/serviceTug.js): geometria pokładu i trzymania pozycji, plan wyładunku przy hali
// K-7 (prawdziwa rama hali Ziemi z k7Dock.js), przejścia faz na atrapie gry: naprawa → odlot, cel bez napędu →
// załadunek → zaczepy → lot (odcinek napędem i skok) → zawrót → wyładunek do stanowiska → remont → odlot.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../src/game/serviceTug.js');
const { k7FrameFor, k7HubToGame, k7HubHeadingToGame, k7AxesGame, k7LayoutTemplate, k7GameToHub } = await import('../src/game/story/k7Dock.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('deck geometry: load point puts the deck centre under the target; cargo pose and tug-under-cargo are inverse', () => {
  const tugSize = { length: 5000, beam: 2100 };
  const deck = T.tugDeckLocal(tugSize, T.SERVICE_TUG, { x: 0, y: 0 });
  near(deck.x, 5000 * T.SERVICE_TUG.deckAlong, 1e-9, 'pokład wzdłuż');
  const target = { x: 1e6, y: 2e6, vx: 0, vy: 0, a: 0.7 };
  const load = T.tugLoadPoint(target, deck, { x: 0, y: 0, a: 0 });
  near(load.a, target.a, 1e-12, 'kurs celu');
  const cargo = T.tugCargoPose({ x: load.x, y: load.y, a: load.a }, deck, 0, { x: 0, y: 0, a: 0 });
  near(cargo.x, target.x, 1e-6, 'x'); near(cargo.y, target.y, 1e-6, 'y');
  const back = T.tugUnderCargo(cargo, deck, 0, { x: 0, y: 0, a: 0 });
  near(back.x, load.x, 1e-6, 'x holownika'); near(back.y, load.y, 1e-6, 'y holownika'); near(back.a, load.a, 1e-12, 'kurs');
  // Punkt trzymania: burta w burtę, odstęp holdGap między burtami.
  const hold = T.tugHoldPoint(target, { length: 3000, beam: 806 }, tugSize, 1, T.SERVICE_TUG, { x: 0, y: 0, a: 0 });
  const d = Math.hypot(hold.x - target.x, hold.y - target.y);
  near(d, (806 + 2100) / 2 + T.SERVICE_TUG.holdGap, 1e-6, 'odstęp osi');
  // Prawa burta celu: (−sin a, cos a).
  near(((hold.x - target.x) * -Math.sin(0.7) + (hold.y - target.y) * Math.cos(0.7)), d, 1e-6, 'po prawej burcie');
});

function earthHall(earth) {
  const frame = k7FrameFor(earth, 0);
  const layout = k7LayoutTemplate();
  const berth = layout.berths.find((b) => b.id === 'C-01');
  const lane = layout.lanes.find((l) => l.berthId === 'C-01');
  const axes = k7AxesGame(frame);
  return {
    frame, layout, berth, lane,
    hall: {
      toGame: (hx, hz, out) => k7HubToGame(earth, frame, hx, hz, out),
      outAngle: Math.atan2(axes.out.y, axes.out.x),
      berth: { x: berth.x, z: berth.z, angle: k7HubHeadingToGame(frame, berth.angle) },
      laneEnd: lane.z1
    }
  };
}

test('K-7 unload plan: deck centre on the lane axis outside the hall, tug bow away from the hall, ship ends in the berth bow to the gate', () => {
  const earth = { id: 'earth', name: 'Earth', x: 5.2e6, y: 6.1e6, r: 900 };
  const { frame, layout, berth, lane, hall } = earthHall(earth);
  const tugSize = { length: 5000, beam: 2100 };
  const deck = T.tugDeckLocal(tugSize, T.SERVICE_TUG, { x: 0, y: 0 });
  const plan = T.planK7Unload(hall, tugSize, deck);
  const hubDeck = k7GameToHub(earth, frame, plan.deckStand.x, plan.deckStand.y, {});
  near(hubDeck.x, berth.x, 1e-6, 'środek pokładu na osi pasa');
  near(hubDeck.z, lane.z1 + T.SERVICE_TUG.standOut, 1e-6, 'za końcem pasa');
  near(plan.stand.a, hall.outAngle, 1e-12, 'holownik dziobem od hali');
  // Cały holownik poza płytą przed bramą: rufa (środek − L/2 wzdłuż kursu) dalej niż koniec płyty.
  const sternX = plan.stand.x - Math.cos(plan.stand.a) * tugSize.length / 2;
  const sternY = plan.stand.y - Math.sin(plan.stand.a) * tugSize.length / 2;
  const hubStern = k7GameToHub(earth, frame, sternX, sternY, {});
  assert.ok(hubStern.z > layout.frontZ + layout.apronDepth, `rufa holownika poza płytą: z ${hubStern.z.toFixed(0)}`);
  // Zjazd: koniec w stanowisku, kurs stanowiska + π (dziobem ku bramie — jak start kampanii).
  const end = plan.slide[plan.slide.length - 1];
  const hubEnd = k7GameToHub(earth, frame, end.x, end.y, {});
  near(hubEnd.x, berth.x, 1e-6, 'x stanowiska'); near(hubEnd.z, berth.z, 1e-6, 'z stanowiska');
  near(Math.abs(T.wrapTugAngle(end.a - (hall.berth.angle + Math.PI))), 0, 1e-9, 'dziobem ku bramie');
  // Punkt zawrotu dalej na tej samej osi.
  const deckPre = T.tugCargoPose(plan.pre, deck, 0, { x: 0, y: 0, a: 0 });
  const hubPre = k7GameToHub(earth, frame, deckPre.x, deckPre.y, {});
  near(hubPre.x, berth.x, 1e-6, 'zawrót na osi pasa');
  // Próbki łamanej: w połowie drogi między punktami, koniec = ostatni punkt.
  const p = T.samplePolyline(plan.slide, 1, { x: 0, y: 0, a: 0 });
  near(p.x, end.x, 1e-6, 'koniec łamanej');
});

// ---------------------------------------------------------------- atrapa gry

function makeWorld({ needsTow = false, rigFinishAt = 3, hall = null } = {}) {
  const log = [];
  const npc = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, isCollidable: false, beamHull: null, w: 5000, h: 2100 };
  const target = { pos: { x: 8000, y: 3000 }, vel: { x: 0, y: 0 }, angle: 0.3, angVel: 0, w: 3000, h: 806 };
  const intent = { mode: 'stop', x: 0, y: 0, face: NaN, speed: 1000, backFace: false };
  const st = { warp: 0, rigT: -1, warpStarts: 0, remont: 0, departs: [], locks: [], placed: null };
  const env = {
    alive: (e) => !!e && !e.dead,
    ghost: (e) => e.isCollidable === false,
    returning: (e) => !!e.__warpReturn,
    arrive: (e, x, y, opts) => {
      intent.mode = 'arrive'; intent.x = x; intent.y = y; intent.face = opts.face; intent.backFace = !!opts.backFace;
      intent.speed = opts.speedLimit || 1500;
    },
    stop: (e, face) => { intent.mode = 'stop'; intent.face = face; },
    needsTow: () => needsTow,
    rig: {
      start: () => { st.rigT = 0; log.push('rig'); return { id: 1 }; },
      status: () => (st.rigT >= rigFinishAt ? 'done' : ''),
      stop: () => log.push('rig-stop')
    },
    lockCargo: (m, mode) => st.locks.push(mode),
    placeCargo: (e, x, y, a) => { st.placed = { x, y, a }; e.pos.x = x; e.pos.y = y; e.angle = a; },
    hall: () => hall,
    route: (m, to) => ({ target: to, waypoints: [to], wells: [] }),
    warpStart: () => { st.warp = 1.5; st.warpStarts++; return true; },
    warpBusy: () => st.warp > 0,
    warpStep: () => {},
    remont: () => { st.remont++; },
    depart: (e, angle) => st.departs.push(angle),
    say: (t) => log.push(t)
  };
  // Prosty „pilot”: holownik leci do punktu intencji z limitem prędkości, obraca się do `face`.
  function fly(dt) {
    if (intent.mode === 'arrive') {
      const dx = intent.x - npc.x, dy = intent.y - npc.y, d = Math.hypot(dx, dy);
      const s = Math.min(intent.speed, d / dt);
      npc.vx = d > 1e-9 ? dx / d * s : 0; npc.vy = d > 1e-9 ? dy / d * s : 0;
    } else { npc.vx = 0; npc.vy = 0; }
    npc.x += npc.vx * dt; npc.y += npc.vy * dt;
    if (Number.isFinite(intent.face)) {
      const e = T.wrapTugAngle(intent.face - npc.angle);
      const step = 0.6 * dt;
      npc.angVel = Math.abs(e) <= step ? 0 : Math.sign(e) * 0.6;
      npc.angle = Math.abs(e) <= step ? intent.face : T.wrapTugAngle(npc.angle + Math.sign(e) * step);
    }
  }
  return { npc, target, env, st, log, fly };
}

function run(w, tug, seconds, dt = 1 / 30, until = null) {
  for (let t = 0; t < seconds; t += dt) {
    if (w.st.rigT >= 0) w.st.rigT += dt;
    let leads = false;
    if (w.st.warp > 0) {
      leads = true;
      w.st.warp -= dt;
      // Skok: ładunek (gracz) prowadzi — przesuwamy go do celu odcinka, holownik pod nim.
      if (w.st.warp <= 0 && tug.leg) { w.target.pos.x = tug.leg.x; w.target.pos.y = tug.leg.y; }
    }
    T.stepServiceTug(tug, w.env, dt);
    w.fly(dt);
    if (leads || (tug.leg && tug.legPhase === 'warp')) {
      const deck = T.tugDeckLocal({ length: 5000, beam: 2100 }, T.SERVICE_TUG, { x: 0, y: 0 });
      const u = T.tugUnderCargo({ x: w.target.pos.x, y: w.target.pos.y, a: w.target.angle }, deck, 0, { x: 0, y: 0, a: 0 });
      w.npc.x = u.x; w.npc.y = u.y; w.npc.angle = u.a;
    } else {
      const p = T.serviceTugCargoPose(tug);
      if (p) { w.target.pos.x = p.x; w.target.pos.y = p.y; w.target.angle = p.a; }
    }
    if (until && until()) return true;
  }
  return false;
}

test('repairable target: arrive (ghost) → approach → hold beside → swarm → depart, no tow', () => {
  const w = makeWorld({ needsTow: false });
  const tug = T.createServiceTug(w.npc, w.target);
  T.stepServiceTug(tug, w.env, 1 / 30);
  assert.equal(tug.phase, T.TUG_PHASE.ARRIVE, 'w tunelu czeka');
  w.npc.isCollidable = true;
  assert.ok(run(w, tug, 60, 1 / 30, () => tug.phase === T.TUG_PHASE.SERVICE), 'dotarł do punktu trzymania');
  assert.ok(w.log.includes('rig'), 'rój wystartował');
  assert.ok(run(w, tug, 20, 1 / 30, () => tug.phase === T.TUG_PHASE.DEPART), 'po naprawie odlot');
  assert.equal(tug.rigDone, 'done');
  assert.equal(w.st.locks.length, 0, 'bez zaczepów');
  assert.equal(w.st.departs.length, 1);
});

test('target without main drive: load under it, clamps, fly with it (drive + warp legs), turn at K-7, slide into the berth, remont, depart', () => {
  const earth = { id: 'earth', name: 'Earth', x: 4.0e6, y: 4.0e6, r: 900 };
  const { hall } = earthHall(earth);
  const w = makeWorld({ needsTow: true, rigFinishAt: 1, hall });
  // Cel daleko od Ziemi: odcinek > minWarp — skok.
  w.target.pos.x = earth.x + 3e5; w.target.pos.y = earth.y + 2e5;
  w.npc.x = w.target.pos.x + 6000; w.npc.y = w.target.pos.y; w.npc.isCollidable = true;
  const tug = T.createServiceTug(w.npc, w.target);
  assert.ok(run(w, tug, 120, 1 / 30, () => tug.phase === T.TUG_PHASE.LOAD), 'po naprawie — załadunek');
  assert.deepEqual(w.st.locks, ['overlap'], 'zderzenia pary wyłączone');
  assert.ok(run(w, tug, 120, 1 / 30, () => tug.phase === T.TUG_PHASE.CLAMP), 'pod celem — zaczepy');
  assert.equal(tug.carried, true);
  assert.ok(run(w, tug, 10, 1 / 30, () => tug.phase === T.TUG_PHASE.CARRY), 'statek na pokładzie');
  // Poza ładunku = pokład holownika.
  const p = T.serviceTugCargoPose(tug);
  const deck = T.tugDeckLocal({ length: 5000, beam: 2100 }, T.SERVICE_TUG, { x: 0, y: 0 });
  const expect = T.tugCargoPose({ x: w.npc.x, y: w.npc.y, a: w.npc.angle }, deck, 0, { x: 0, y: 0, a: 0 });
  near(p.x, expect.x, 1e-6, 'ładunek na pokładzie x');
  assert.ok(run(w, tug, 600, 1 / 30, () => tug.phase === T.TUG_PHASE.TURN), 'dolot do K-7');
  assert.ok(w.st.warpStarts >= 1, 'skok z ładunkiem');
  assert.ok(run(w, tug, 600, 1 / 30, () => tug.phase === T.TUG_PHASE.UNLOAD), 'zawrót i cofanie na punkt wyładunku');
  near(Math.abs(T.wrapTugAngle(w.npc.angle - hall.outAngle)), 0, T.SERVICE_TUG.standAngleTol, 'dziobem od hali');
  assert.ok(run(w, tug, 120, 1 / 30, () => tug.phase === T.TUG_PHASE.DEPART), 'zjazd do stanowiska');
  assert.equal(w.st.remont, 1, 'remont w doku');
  assert.equal(w.st.locks.at(-1), 'off', 'zaczepy puszczone');
  assert.equal(tug.carried, false);
  const end = tug.unload.slide.at(-1);
  near(w.st.placed.x, end.x, 1e-6, 'statek w stanowisku');
  near(w.st.departs.at(-1), hall.outAngle, 1e-12, 'odlot od hali');
});

test('target lost mid-carry: cargo released, tug departs', () => {
  const earth = { id: 'earth', name: 'Earth', x: 4.0e6, y: 4.0e6, r: 900 };
  const { hall } = earthHall(earth);
  const w = makeWorld({ needsTow: true, rigFinishAt: 0.5, hall });
  w.npc.x = w.target.pos.x + 5000; w.npc.y = w.target.pos.y; w.npc.isCollidable = true;
  const tug = T.createServiceTug(w.npc, w.target, { repair: false });
  assert.ok(run(w, tug, 200, 1 / 30, () => tug.phase === T.TUG_PHASE.CARRY));
  w.target.dead = true;
  T.stepServiceTug(tug, w.env, 1 / 30);
  assert.equal(tug.phase, T.TUG_PHASE.DEPART);
  assert.equal(tug.carried, false);
  assert.equal(w.st.locks.at(-1), 'off');
});

test('no K-7 (carry not available): drive-less target is only serviced, the tug departs with a message', () => {
  const w = makeWorld({ needsTow: true, rigFinishAt: 0.5, hall: null });
  w.npc.isCollidable = true;
  const tug = T.createServiceTug(w.npc, w.target);
  assert.ok(run(w, tug, 120, 1 / 30, () => tug.phase === T.TUG_PHASE.DEPART));
  assert.equal(tug.reason, 'notow');
  assert.equal(w.st.locks.length, 0);
});

test('POWRÓT skrzydła w trakcie naprawy: misja kończy się bez własnego odlotu, rój zatrzymany, bez zaczepów', () => {
  const w = makeWorld({ needsTow: true, rigFinishAt: 1e9 });
  w.npc.isCollidable = true;
  const tug = T.createServiceTug(w.npc, w.target);
  assert.ok(run(w, tug, 120, 1 / 30, () => tug.phase === T.TUG_PHASE.SERVICE), 'naprawa trwa');
  assert.ok(w.log.includes('rig'));
  w.npc.__warpReturn = { phase: 'align' };   // returnSupportWingToEarth → supportReturn prowadzi holownik
  T.stepServiceTug(tug, w.env, 1 / 30);
  assert.equal(tug.phase, T.TUG_PHASE.DEPART);
  assert.equal(tug.reason, 'recalled');
  assert.ok(w.log.includes('rig-stop'), 'rój odwołany');
  assert.equal(w.st.departs.length, 0, 'bez drugiego odlotu (POWRÓT już prowadzi)');
  assert.equal(w.st.locks.length, 0);
});
