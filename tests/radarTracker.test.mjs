import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RADAR_SRC, angleInSweep, createRadarTracker, normAngle, radarEchoLevel, radarProject, radarTheta, radarUnproject,
  relativeBearing, stepRadarTracker
} from '../src/ui/radar/radarTracker.js';
import { RADAR_TUNE, formatRadarDistance, radarClassCode, radarStationLabel, scanPulseRadius, scanPulseTime, stepRadarRange } from '../src/ui/radar/radarConfig.js';
import { createRadarFeed } from '../src/ui/radar/radarFeed.js';

// Radar taktyczny kokpitu (2026-10-07): tarcza dziobem do góry, antena maluje kontakty, ślady ARPA.

const tune = { ...RADAR_TUNE };

function feedWith(targets, own = { x: 0, y: 0, vx: 0, vy: 0, heading: 0 }, extra = {}) {
  return { own, theta: radarTheta(own.heading, 'head'), paintRange: 60000, range: 20000, targets, count: targets.length, pingSerial: 0, ...extra };
}

function rec(key, x, y, extra = {}) {
  return { key, src: RADAR_SRC.STATIC, kind: 'ship', aff: 'hostile', x, y, vx: 0, vy: 0, angle: 0, length: 300, width: 120, cls: 'DD', name: '', ...extra };
}

test('H-UP: dziób okrętu jest u góry tarczy, rufa u dołu', () => {
  const out = { x: 0, y: 0 };
  for (const heading of [0, 0.7, -2.1, Math.PI]) {
    const th = radarTheta(heading, 'head');
    radarProject(Math.cos(heading) * 1000, Math.sin(heading) * 1000, th, 0.1, 50, 50, out);
    assert.ok(Math.abs(out.x - 50) < 1e-6 && Math.abs(out.y - (50 - 100)) < 1e-6, `dziób przy kursie ${heading}: ${out.x}, ${out.y}`);
    radarProject(-Math.cos(heading) * 1000, -Math.sin(heading) * 1000, th, 0.1, 50, 50, out);
    assert.ok(Math.abs(out.y - (50 + 100)) < 1e-6, 'rufa na dole');
    // prawa burta (zgodnie z zegarem od dzioba, y ekranu w dół) — po prawej tarczy
    radarProject(Math.cos(heading + Math.PI / 2) * 1000, Math.sin(heading + Math.PI / 2) * 1000, th, 0.1, 50, 50, out);
    assert.ok(Math.abs(out.x - 150) < 1e-6, 'prawa burta po prawej');
  }
  assert.equal(radarTheta(1.3, 'north'), 0);
});

test('rzut i odwrotność, namiar względny', () => {
  const p = { x: 0, y: 0 };
  const q = { x: 0, y: 0 };
  const th = radarTheta(0.9, 'head');
  radarProject(1234, -567, th, 0.02, 140, 140, p);
  radarUnproject(p.x, p.y, th, 0.02, 140, 140, q);
  assert.ok(Math.abs(q.x - 1234) < 1e-6 && Math.abs(q.y + 567) < 1e-6);
  assert.ok(Math.abs(relativeBearing(Math.cos(0.9), Math.sin(0.9), 0.9)) < 1e-9);
  assert.ok(Math.abs(relativeBearing(0, 1, 0) - Math.PI / 2) < 1e-9, 'y w dół = prawa burta = 90°');
});

test('przedział przemiatania przez 0 / 2π', () => {
  assert.ok(angleInSweep(6.2, 0.2, 0.05));
  assert.ok(!angleInSweep(6.2, 0.05, 0.05));
  assert.ok(angleInSweep(-0.1, 0.2, 0.05));
  assert.ok(!angleInSweep(0, 0, 0));
  assert.ok(Math.abs(normAngle(-0.5) - (2 * Math.PI - 0.5)) < 1e-12);
});

test('antena maluje kontakt raz na obrót — także gdy okręt się obraca', () => {
  for (const turnRate of [0, 0.31, -0.31, 1.2]) {
    const tr = createRadarTracker(tune);
    const key = {};
    const own = { x: 0, y: 0, vx: 0, vy: 0, heading: 0 };
    const targets = [rec(key, 8000, 3000)];
    const dt = 1 / 30;
    const steps = Math.round(tune.sweepPeriod * 5 / dt);
    let paints = 0;
    let last = 0;
    for (let i = 0; i < steps; i++) {
      own.heading += turnRate * dt;
      stepRadarTracker(tr, feedWith(targets, own), dt, tune);
      const t = tr.tracks.get(key);
      if (t.paints !== last) { paints += t.paints - last; last = t.paints; }
    }
    // 5 obrotów anteny w układzie tarczy; obrót okrętu dokłada / odejmuje turnRate·T/2π obrotu w świecie
    const expected = 5 * (1 + turnRate * tune.sweepPeriod / (2 * Math.PI));
    assert.ok(Math.abs(paints - expected) <= 1, `obrót ${turnRate}: malowań ${paints}, oczekiwane ~${expected.toFixed(2)}`);
  }
});

test('ślad: numer po dojrzeniu, klasyfikacja z bliska, echo gaśnie', () => {
  const tr = createRadarTracker(tune);
  const far = {};
  const near = {};
  const targets = [rec(far, 15000, 0), rec(near, 3000, 500)];
  const dt = 1 / 30;
  for (let i = 0; i < Math.round(tune.sweepPeriod * 3 / dt); i++) stepRadarTracker(tr, feedWith(targets), dt, tune);
  const tf = tr.tracks.get(far);
  const tn = tr.tracks.get(near);
  assert.ok(tf.paints >= tune.trackMature && tf.no > 0, 'dojrzały ślad ma numer');
  assert.equal(tf.classified, false, 'daleko — bez klasy');
  assert.equal(tn.classified, true, 'z bliska — sklasyfikowany');
  const lvl = radarEchoLevel(tr, tf, tune);
  assert.ok(lvl > 0 && lvl <= 1.4);
  tr.time = tf.paintT + 10;
  assert.ok(radarEchoLevel(tr, tf, tune) < 0.001, 'echo gaśnie');
});

test('impuls skanera maluje i klasyfikuje kontakty, gdy fala do nich dociera', () => {
  const tr = createRadarTracker(tune);
  const key = {};
  // kontakt dokładnie za rufą (antena dotrze tam później niż fala)
  const targets = [rec(key, -20000, 0)];
  const dt = 1 / 60;
  stepRadarTracker(tr, feedWith(targets, undefined, { pingSerial: 0 }), dt, tune);
  const t0 = tr.time;
  let pingedAt = -1;
  for (let i = 0; i < 300; i++) {
    stepRadarTracker(tr, feedWith(targets, undefined, { pingSerial: 1, pingSpeed: 60000, pingRange: 90000 }), dt, tune);
    const t = tr.tracks.get(key);
    if (t.pingT > 0 && pingedAt < 0) pingedAt = tr.time - t0;
  }
  const t = tr.tracks.get(key);
  assert.ok(t.classified, 'po impulsie sklasyfikowany');
  const expected = scanPulseTime(20000, 60000);
  assert.ok(Math.abs(pingedAt - expected) < 0.05, `fala dotarła po ${pingedAt.toFixed(3)} s, oczekiwane ${expected.toFixed(3)} s`);
});

test('profil fali: odwrotność czasu, wolny start', () => {
  for (const r of [0, 500, 5000, 20000, 90000]) {
    const t = scanPulseTime(r, 60000);
    assert.ok(Math.abs(scanPulseRadius(t, 60000) - r) < 1e-6 * Math.max(1, r));
  }
  assert.ok(scanPulseRadius(0.3, 60000) < 6000, 'pierwsze ~5 km około 0,3 s (falę widać w kadrze)');
  assert.ok(scanPulseTime(90000, 60000) < 2.3, 'cały zasięg Atlasa ~2 s');
});

test('dead reckoning; szybki kontakt w żywej pozycji', () => {
  const tr = createRadarTracker(tune);
  const slow = { x: 5000, y: 0, vx: 0, vy: 300 };
  const fast = { x: 9000, y: 0, vx: 0, vy: 20000 };
  const targets = [
    { ...rec(slow, 0, 0), src: RADAR_SRC.XY },
    { ...rec(fast, 0, 0), src: RADAR_SRC.XY }
  ];
  const dt = 1 / 30;
  for (let i = 0; i < 200; i++) {
    stepRadarTracker(tr, feedWith(targets), dt, tune);
    slow.y += slow.vy * dt;
    fast.y += fast.vy * dt;
  }
  const ts = tr.tracks.get(slow);
  const age = Math.min(tr.time - ts.paintT, tune.sweepPeriod * 1.3);
  assert.ok(Math.abs(ts.sy - (ts.py + ts.pvy * age)) < 1e-6, 'symbol = malowanie + v·wiek');
  const tf = tr.tracks.get(fast);
  assert.equal(tf.sy, tf.ly, 'szybki: żywa pozycja');
});

test('zniszczony kontakt zostawia ✕, ukryty mgłą znika bez znacznika', () => {
  const tr = createRadarTracker(tune);
  const dead = { dead: false };
  const hidden = {};
  const dt = 1 / 30;
  const all = [rec(dead, 4000, 0), rec(hidden, 0, 4000)];
  for (let i = 0; i < 120; i++) stepRadarTracker(tr, feedWith(all), dt, tune);
  dead.dead = true;
  stepRadarTracker(tr, feedWith([]), dt, tune);
  assert.equal(tr.kills.length, 1);
  assert.equal(tr.tracks.size, 0);
});

test('ten sam slot puli rakiet, nowa rakieta (gen) — ślad od zera', () => {
  const tr = createRadarTracker(tune);
  const slot = { active: true, position: { x: 3000, z: 0 }, velocity: { x: 0, z: 0 }, frameVel: { x: 0, z: 0 } };
  const r1 = { ...rec(slot, 0, 0), src: RADAR_SRC.ROCKET, kind: 'missile', gen: 1 };
  const dt = 1 / 30;
  for (let i = 0; i < 160; i++) stepRadarTracker(tr, feedWith([r1]), dt, tune);
  assert.ok(tr.tracks.get(slot).no > 0);
  const r2 = { ...r1, gen: 2 };
  stepRadarTracker(tr, feedWith([r2]), dt, tune);
  assert.equal(tr.tracks.get(slot).no, 0, 'nowy ślad');
});

test('kody klas, podpisy stacji, zasięgi', () => {
  assert.equal(radarClassCode('pirate_battleship'), 'BB');
  assert.equal(radarClassCode('frigate_pd'), 'FF');
  assert.equal(radarClassCode('pirate_supercapital'), 'SC');
  assert.equal(radarClassCode('destroyer'), 'DD');
  assert.equal(radarClassCode('fighter'), 'FT');
  assert.equal(radarClassCode('container_ship'), 'TR');
  assert.equal(radarStationLabel({ id: 'earth', planet: { id: 'earth' }, ringPort: true }), 'ZIEMIA · PORT K-7');
  assert.equal(radarStationLabel({ id: 'mars', planet: { id: 'mars' }, ringPort: true }, true), 'MARS K-7');
  assert.equal(radarStationLabel({ name: 'Suchy dok piratów' }), 'SUCHY DOK PIRATÓW');
  assert.equal(stepRadarRange(20000, 1), 40000);
  assert.equal(stepRadarRange(60000, 1), 60000);
  assert.equal(stepRadarRange(60000, 1, true), 5000);
});

test('zbieracz: mgła i maskowanie ukrywają wroga, sojusznik ciągły, liczniki i kontakty listy', () => {
  const fb = createRadarFeed(tune);
  const ship = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0 };
  const visible = { x: 5000, y: 0, vx: 0, vy: 0, type: 'pirate_destroyer', friendly: false };
  const fogged = { x: 6000, y: 0, type: 'pirate_frigate', friendly: false, fog: true };
  const cloaked = { x: 7000, y: 0, type: 'pirate_frigate', friendly: false, cloak: true };
  const ally = { x: -3000, y: 0, type: 'battleship', friendly: true, isCapitalShip: true };
  const farAway = { x: 900000, y: 0, type: 'destroyer', friendly: false };
  const station = { x: 0, y: 8000, r: 300, isPirate: true, name: 'Placówka' };
  const objective = { x: 0, y: -9000, type: 'pirate_battleship', friendly: false };
  const rocket = { active: true, hostile: true, seed: 7, bornFrame: 1, position: { x: 2000, z: 0 }, velocity: { x: -800, z: 0 }, frameVel: { x: 0, z: 0 } };
  const feed = fb.collect({
    ship, range: 20000,
    npcs: [visible, fogged, cloaked, ally, farAway, objective],
    stations: [station],
    rockets: [rocket, { active: false, position: { x: 0, z: 0 } }],
    lockedTargets: [visible],
    storyTargets: new Map([['cel', { entity: objective, label: 'Cel' }]]),
    hides: (e) => !!e.fog,
    cloaked: (e) => !!e.cloak,
    isHostile: (e) => !e.friendly,
    hullMetrics: () => ({ worldW: 400, worldH: 160 })
  });
  const keys = feed.targets.slice(0, feed.count).map((r) => r.key);
  assert.ok(keys.includes(visible) && keys.includes(ally) && keys.includes(station) && keys.includes(rocket) && keys.includes(objective));
  assert.ok(!keys.includes(fogged), 'mgła');
  assert.ok(!keys.includes(cloaked), 'maskowanie');
  assert.ok(!keys.includes(farAway), 'poza zasięgiem malowania');
  const byKey = new Map(feed.targets.slice(0, feed.count).map((r) => [r.key, r]));
  assert.equal(byKey.get(ally).continuous, true);
  assert.equal(byKey.get(ally).aff, 'friendly');
  assert.equal(byKey.get(visible).locked, true);
  assert.equal(byKey.get(objective).objective, true);
  assert.equal(byKey.get(station).kind, 'station');
  assert.equal(byKey.get(station).aff, 'hostile');
  assert.equal(byKey.get(rocket).kind, 'missile');
  assert.equal(feed.counts.hostile, 2, 'wróg w zasięgu tarczy: niszczyciel i cel misji');
  assert.equal(feed.counts.missiles, 1);
  assert.ok(feed.contacts.some((c) => c.entity === station && c.isStation));
});

test('odległość z pamięci = dawne formatowanie (napis z wyświetlanej wartości)', () => {
  const ref = (metres) => {
    const m = Math.abs(Number(metres) || 0);
    if (m < 1000) return `${Math.round(m)} m`;
    const km = m / 1000;
    let text = km.toFixed(km >= 100 ? 0 : km >= 10 ? 1 : 2);
    if (text.includes('.')) text = text.replace(/\.?0+$/, '');
    return `${text.replace('.', ',')} km`;
  };
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < 20000; i++) {
    const v = rnd() < 0.5 ? rnd() * 200000 : rnd() * 1e7;
    assert.equal(formatRadarDistance(v), ref(v), `${v}`);
    assert.equal(formatRadarDistance(v), ref(v), `${v} drugi raz (z pamięci)`);
  }
  for (const v of [0, 999.4, 1000, 9994.9, 9999, 10000, 99949, 100000, 123456789, -5000, NaN]) assert.equal(formatRadarDistance(v), ref(v), `${v}`);
});

test('zbieracz: dane bytu z pamięci, odświeżone po zmianie typu i co kilkanaście zebrań', () => {
  const fb = createRadarFeed(tune);
  const ship = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0 };
  const e = { x: 3000, y: 0, type: 'pirate_frigate', friendly: false };
  let names = 0;
  let hulls = 0;
  const env = {
    ship, range: 20000, npcs: [e], isHostile: () => true,
    nameOf: (x) => { names++; return `N-${x.type}`; },
    hullMetrics: (x) => { if (x === e) hulls++; return { worldW: 400, worldH: 160 }; }
  };
  const recOf = () => fb.feed.targets.slice(0, fb.feed.count).find((r) => r.key === e);
  fb.collect(env);
  assert.equal(recOf().cls, 'FF');
  assert.equal(recOf().name, 'N-pirate_frigate');
  assert.equal(recOf().length, 400);
  for (let i = 0; i < 5; i++) fb.collect(env);
  assert.equal(names, 1, 'nazwa liczona raz, nie co zebranie');
  assert.equal(hulls, 1);
  e.type = 'pirate_battleship';
  fb.collect(env);
  assert.equal(recOf().cls, 'BB', 'zmiana typu — od razu');
  assert.equal(recOf().name, 'N-pirate_battleship');
  const before = names;
  for (let i = 0; i < 20; i++) fb.collect(env);
  assert.ok(names > before, 'odświeżenie okresowe (nazwa / wymiary po budowie kadłuba)');
});
