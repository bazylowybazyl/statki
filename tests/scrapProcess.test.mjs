// Złomowanie jako proces (reguła `zlomowanie`), etap 1: podawanie wraku, cięcie rzazem na sekcje, mielenie w paszczy.
// Prawdziwy silnik belek i HullBodies; atrapą jest obraz kadłuba (płyta RGBA), encja złomiarza i pętla wraków gry
// (całkowanie ruchu encji — w grze robi to pętla wraków w `physicsStep`).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const {
  stepScrapJob, releaseScrapJob, estimateScrapSeconds, scrapNaturalSeconds, SCRAP_TUNE
} = await import('../src/game/scrapProcess.js');
const { planScrapCuts } = await import('../src/game/scrapPlan.js');
const { SCRAP_RIG_DEFAULT } = await import('../src/data/scrapRigs.js');
const {
  createTrafficSalvage, noteTrafficWreck, stepTrafficSalvage, fillTrafficWorkFrame, onTrafficSalvageTaken,
  TRAFFIC_WORK_AUX, TRAFFIC_WORK_KIND
} = await import('../src/game/trafficSalvage.js');

const DT = 1 / 60;

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = 130; data[o + 1] = 140; data[o + 2] = 150; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function makeWreck(x, y, angle, w = 600, h = 180) {
  const e = { x, y, vx: 0, vy: 0, angle, angVel: 0, mass: 5000, name: 'próba' };
  HullBodies.createHull(e, plate(w, h));
  // `convertToWreck` sam dopisuje wrak do `window.wrecks` (lista wraków gry).
  const wreck = HullBodies.convertToWreck(e);
  e.dead = true;
  assert.ok(wreck && wreck.beamHull, 'wrak z kadłuba');
  assert.equal(window.wrecks.filter((w) => w === wreck).length, 1);
  return wreck;
}

/** Haki gry na prawdziwym HullBodies (jak `trafficSalvageHooks.scrap` w index.html). */
function scrapHooks() {
  return {
    rig: () => SCRAP_RIG_DEFAULT,
    cells: (w, out) => HullBodies.activeCells(w, out),
    cellSize: (w) => w.beamHull?.body?.cellSize || 0,
    cellWorld: (w, gx, gy, out) => HullBodies.cellWorld(w, gx, gy, out),
    cutLine: (w, x0, y0, x1, y1, hw) => HullBodies.cutSegment(w, x0, y0, x1, y1, hw),
    chew: (w, x, y, n) => HullBodies.cutNearest(w, x, y, n)
  };
}

const nodesOf = (w) => (w?.beamHull && HullBodies.hasHull(w) ? w.beamHull.body.activeNodes : 0);

/** Pętla wraków gry: ruch encji, potem krok silnika (rozpad na wyspy, synchronizacja). */
function worldStep() {
  for (const w of window.wrecks) {
    if (w.dead) continue;
    w.x += w.vx * DT;
    w.y += w.vy * DT;
    w.angle += (w.angVel || 0) * DT;
  }
  HullBodies.step(DT, window.wrecks);
  for (let i = window.wrecks.length - 1; i >= 0; i--) {
    const w = window.wrecks[i];
    if (!w.dead && nodesOf(w) <= 0) { w.dead = true; HullBodies.recycleWreck?.(w); }
    if (w.dead) window.wrecks.splice(i, 1);
  }
}

function setup(wreck) {
  const entry = { wreck, extras: [] };
  HullBodies.onWreckSpawned = (w) => { if (w !== entry.wreck) entry.extras.push(w); };
  const ts = { hooks: { alive: (w) => !w.dead, nodes: nodesOf, scrap: scrapHooks() }, scrapTune: { ...SCRAP_TUNE } };
  const a = { cx: 0, cy: 0, ca: 0, length: 700, vx: 0, vy: 0, alive: true };
  return { ts, entry, a, job: {} };
}

test('proces: wrak obrócony i dosunięty do dziobu, linie planu rozdzielają go na sekcje, paszcza mieli wszystko', () => {
  window.wrecks.length = 0;
  const wreck = makeWreck(1900, 350, 0.9);
  const { ts, entry, a, job } = setup(wreck);
  const nodes0 = nodesOf(wreck);
  assert.ok(nodes0 > 200, `płyta ma węzły (${nodes0})`);
  const rec = { t0: 0, dur: 600 };
  let time = 0;
  const seen = new Set();
  let aligned = null;
  let maxPieces = 1;
  for (let k = 0; k < 60 * 400; k++) {
    const S = stepScrapJob(ts, job, entry, rec, a, time, DT);
    if (!seen.has(S.phase)) seen.add(S.phase);
    if (S.phase === 'cut' && !aligned) {
      // Chwila pierwszego rzazu: bliski koniec przed dziobem, oś wraku wzdłuż kursu statku.
      aligned = { pos: S.posErr, ang: S.angErr, lines: S.plan.lines.length, seg: S.seg };
    }
    maxPieces = Math.max(maxPieces, window.wrecks.length);
    if (S.phase === 'done') break;
    worldStep();
    time += DT;
  }
  const S = job.scrap;
  assert.equal(S.phase, 'done', `praca skończona (fazy: ${[...seen].join(', ')}; czas ${time.toFixed(0)} s)`);
  assert.ok(aligned, 'doszło do cięcia');
  assert.ok(aligned.pos <= SCRAP_TUNE.alignPos && aligned.ang <= SCRAP_TUNE.alignAng, 'wrak ustawiony przed rzazem');
  assert.ok(aligned.lines >= 2, `plan ma linie (${aligned.lines})`);
  assert.ok(aligned.seg * 2 > 200, 'człony wysięgnika sięgają linii');
  assert.equal(S.stats.lines, aligned.lines, 'każda linia przecięta');
  assert.ok(S.stats.sections >= aligned.lines, `sekcje odcięte (${S.stats.sections})`);
  assert.ok(maxPieces >= 2, 'odcięta sekcja to osobne ciało');
  assert.ok(S.stats.cutNodes > 0 && S.stats.chewNodes > 0);
  // Zostaje ostatni kęs w paszczy (praca trzyma wysięgniki do końca postoju).
  let left = 0;
  for (const w of window.wrecks) left += nodesOf(w);
  assert.ok(left >= 4 && left <= SCRAP_TUNE.keepNodes, `został ostatni kęs (${left})`);
  // Reszta to drobnica: mielona sekcja kruszy się na okruchy poniżej progu odłamu — silnik zamienia je w odłamki.
  assert.ok(S.stats.cutNodes + S.stats.chewNodes >= nodes0 * 0.7, `większość zdjęły palniki i paszcza (${S.stats.cutNodes} + ${S.stats.chewNodes} z ${nodes0})`);
  // Czas: w okolicach czasu naturalnego (tempo ~1), daleko przed końcem postoju.
  const natural = scrapNaturalSeconds(S.plan, S.cs);
  assert.ok(time < natural * 2.2 + 30, `czas ${time.toFixed(0)} s przy naturalnym ${natural.toFixed(0)} s`);
  releaseScrapJob(job);
  assert.equal(job.scrap, null);
});

test('proces: krótki postój przyspiesza pracę (tempo w granicach), wrak krótszy niż sekcja idzie w całości', () => {
  window.wrecks.length = 0;
  const wreck = makeWreck(900, -200, -0.4, 240, 150);
  const { ts, entry, a, job } = setup(wreck);
  const rec = { t0: 0, dur: 14 };
  let time = 0;
  let rate = 0;
  for (let k = 0; k < 60 * 200; k++) {
    const S = stepScrapJob(ts, job, entry, rec, a, time, DT);
    rate = Math.max(rate, S.rate);
    if (S.phase === 'done') break;
    worldStep();
    time += DT;
  }
  assert.equal(job.scrap.phase, 'done');
  assert.equal(job.scrap.plan.lines.length, 0, 'bez cięć');
  assert.equal(job.scrap.stats.lines, 0);
  assert.equal(rate, SCRAP_TUNE.rateMax, 'tempo na suficie przy za krótkim postoju');
});

test('szacunek czasu pracy rośnie z wielkością wraku', () => {
  const small = estimateScrapSeconds({ nodes: 120, cellSize: 15, radius: 130 });
  const big = estimateScrapSeconds({ nodes: 2400, cellSize: 30, radius: 900 });
  assert.ok(small > SCRAP_TUNE.alignTime && small < 90, `mały ${small.toFixed(0)} s`);
  assert.ok(big > small * 3, `duży ${big.toFixed(0)} s`);
  assert.equal(estimateScrapSeconds({ nodes: 0, cellSize: 15, radius: 100 }), 0);
  const cells = [];
  for (let y = 0; y < 12; y++) for (let x = 0; x < 40; x++) cells.push(x, y);
  const plan = planScrapCuts(cells, cells.length / 2, { sectionCells: 14 });
  const nat = scrapNaturalSeconds(plan, 15);
  const est = estimateScrapSeconds({ nodes: 480, cellSize: 15, radius: 313 });
  assert.ok(est > nat * 0.6 && est < nat * 1.8, `szacunek ${est.toFixed(0)} s przy naturalnym ${nat.toFixed(0)} s`);
});

test('moduł złomiarzy: zgłoszenie niesie czas pracy, ramka obrazu — pozy wysięgników, koniec postoju zdejmuje resztę', () => {
  window.wrecks.length = 0;
  const wreck = makeWreck(1500, 0, 0.3);
  const reports = [];
  const works = new Map();
  const bridge = { actorWorks: works, reportWrecks: (l) => reports.push(...l), wrecksGone: () => assert.fail('wreck-gone') };
  const removed = [];
  const ts = createTrafficSalvage(bridge, {
    alive: (w) => !w.dead,
    nodes: nodesOf,
    remove: (w) => { w.dead = true; removed.push(w); },
    scrap: scrapHooks()
  });
  HullBodies.onWreckSpawned = (w, parent, parentBody) => noteTrafficWreck(ts, w, null, 0, parent, parentBody);
  noteTrafficWreck(ts, wreck, { classId: 'frigate', scale: 1, towable: false }, 0);
  stepTrafficSalvage(ts, null, 3, DT, 0, 0);
  assert.equal(reports.length, 1);
  assert.ok(reports[0].work > 20, `szacunek pracy w zgłoszeniu (${reports[0].work} s)`);
  const gid = reports[0].gid;
  const a = { id: 7, cx: 0, cy: 0, ca: 0, length: 700, vx: 0, vy: 0, alive: true, phase: 'station' };
  const tb = { byId: new Map([[7, a]]), dead: new Set(), promoted: new Set() };
  works.set(7, { id: 7, kind: 'cut', phase: 'work', x: wreck.x, y: wreck.y, t0: 3, dur: reports[0].work, gid });
  let time = 3;
  let sawTorch = false, sawGrip = false, sawMaw = false;
  const A = TRAFFIC_WORK_AUX;
  for (let k = 0; k < 60 * 300; k++) {
    stepTrafficSalvage(ts, tb, time, DT, 0, 0);
    const job = ts.jobs.get(7);
    if (k % 20 === 0 && job) {
      const frame = fillTrafficWorkFrame(ts, tb, time, null);
      assert.equal(frame.count, 1);
      const r = frame.list[0];
      assert.equal(r.kind, TRAFFIC_WORK_KIND.CUT);
      assert.equal(r.scrap, true);
      if (r.aux[A.ARM + A.TORCH] > 0 || r.aux[A.ARM + A.ARM_STRIDE + A.TORCH] > 0) sawTorch = true;
      if (r.aux[A.GRIP] > 0.5) sawGrip = true;
      if (r.aux[A.MAW] > 0) sawMaw = true;
      assert.ok(r.aux[A.SEG] > 0);
      assert.ok(Math.abs(r.aux[A.ARM + A.MY] + SCRAP_RIG_DEFAULT.mounts[1][1] * 700) < 1e-3, 'podstawy wysięgników z zestawu kadłuba');
    }
    if (job?.scrap?.phase === 'done') break;
    worldStep();
    time += DT;
  }
  assert.equal(ts.jobs.get(7)?.scrap?.phase, 'done', 'praca skończona przed końcem postoju');
  assert.ok(time < 3 + reports[0].work, `czas ${(time - 3).toFixed(0)} s w postoju ${reports[0].work} s`);
  assert.ok(sawTorch && sawGrip && sawMaw, 'ramka pokazała palnik, wiązki i paszczę');
  assert.equal(ts.stats.scrapJobs, 1);
  // Koniec postoju z workera: ostatni okruch znika, bez „wrak przepadł”.
  onTrafficSalvageTaken(ts, [{ gid, mode: 'cut' }]);
  works.delete(7);
  stepTrafficSalvage(ts, tb, time, DT, 0, 0);
  stepTrafficSalvage(ts, tb, time + DT, DT, 0, 0);
  assert.equal(ts.reported.size, 0);
  assert.ok(removed.length >= 1);
  assert.equal(ts.jobs.size, 0);
});
