// SONDA PRZESZKÓD GAZU (etap C — F2 docs/AUDYT-wybuchy-gaz-2026-10-08.md) na demie dema/wybuchy-webgpu.html: liczby zamiast
// zrzutów. Ściana próbna (pudło statyki) przed wybuchem, domena stojąca i w ruchu, przelot kadłuba przez obłok.
//
//   node scripts/webgpu/wybuchy-przeszkody-sonda.mjs [--przypadki brak,sciana20,sciana60,sciana160,wzdluz,ku,od,kadlub,brama]
//        [--klatki 0.25,0.5,1,1.5,2,3,4] [--out .tmp/wybuchy-przeszkody] [--gaz k=v,…] [--port 5298] [--wolno 1]
//
// Przypadek: wybuch „capital” (size 300 → R 480 j., domena 2592 j., komórka 27 j.) w galerii demo; ściana (pudło 6000 j.
// × grubość) prostopadle do osi x w odległości D od środka (0,55 R). Na każdą chwilę (suma po domenach):
//   za     — dym za ścianą (półprzestrzeń za jej tylnym licem + 1 komórka) — PRZECIEK (bez ściany: ile tam byłoby),
//   masa, keS (energia w dymie), div / divNear (niedobieżność rzutu we wnętrzu / przy ścianie), nearMass / nearSpeed
//   (dym przy ścianie i jego średnia prędkość — gaz „przyklejony”), inSolid (dym w komórkach stałych — ma być 0), NaN;
//   GPU ↔ lustro CPU maski (solidCpu) w przekroju z = środek — niezgodne komórki.
// --wolno k: klatka k/60 s (k = 2: 30 Hz — dwa podkroki 1/60 s na klatkę; k = 6: 10 Hz — trzy podkroki po 1/30 s: dłuższy
//   krok adwekcji, ryzyko przeskoku przez ścianę). --gesto 1: pomiar co 2 klatki od 0,4 do 2,4 s (skoki przy przebudowie maski).
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson, screenshotPng } from './wspolne.mjs';

const args = parseArgs();
const cases = String(args.przypadki || 'brak,sciana20,sciana60,sciana160,wzdluz,ku,od,kadlub,brama').split(',');
const times = String(args.klatki || '0.25,0.5,1,1.5,2,3,4').split(',').map(Number);
const outDir = resolve(repo, args.out || '.tmp/wybuchy-przeszkody');
mkdirSync(outDir, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const kv = (str) => Object.fromEntries(String(str || '').split(',').filter(Boolean).map((p) => {
  const [k, v] = p.split('=');
  return [k, v === 'true' ? true : v === 'false' ? false : Number(v)];
}));
const SIZE = 300;
const R = SIZE * 1.6;
const D = R * 0.55;
const stepsPerFrame = args.wolno ? Math.max(1, Number(args.wolno) === 1 ? 2 : Number(args.wolno)) : 1;   // klatka stepsPerFrame/60 s
// przypadki: ściana (grubość, nośnik), kadłub (przelot), brama (ściana z otworem)
const CASES = {
  brak: { wall: null },
  sciana20: { wall: 20 },
  sciana60: { wall: 60 },
  sciana160: { wall: 160 },
  wzdluz: { wall: 60, vx: 0, vy: 250 },
  ku: { wall: 60, vx: 250, vy: 0, d: R * 1.4 },
  od: { wall: 60, vx: -250, vy: 0, d: R * 0.4 },
  kadlub: { wall: null, hull: { w: 720, h: 264, x: -R * 2.2, y: 0, vx: 520, vy: 0, angle: 0 } },
  brama: { wall: 60, gap: R * 0.5 },
  // strumienie gazu wzdłuż osi (rozerwany zbiornik — pierwszy ku ścianie): początek 0,15 R, kapsuła do 0,31–0,42 R, cienka
  // ściana 0,17–0,21 R od środka — kapsuła strumienia przecina ją całą (poprawki etapu C, pkt 1 przeglądu)
  strumien: { wall: 20, d: R * 0.17, opts: { axisX: -1, axisY: 0, jetVelTau: 0.6 } },
  daleko: { wall: 60, d: R * 3.2 }
};

const { server, base } = await startVite(Number(args.port || 5298));
const chrome = await startChrome({ width: 1280, height: 720 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { gaz: kv(args.gaz), wolno: !!args.wolno, cases: [] };

// Suma sond po domenach z obszarem „za ścianą” (półprzestrzeń x > xWall w świecie gry → komórki domeny).
const probeAll = (xWall) => ev(`(async () => {
  const g = window.__demo.fx.grid, r = window.Core3D.renderer;
  const t = { domeny: 0, za: 0, masa: 0, keS: 0, div: 0, divNear: 0, nearMass: 0, nearSpeed: 0, inSolid: 0, speed: 0, nan: 0, near: 0, mismatch: 0, solidCells: 0,
    eS1: 0, eS2: 0, eS3: 0, ePairs: 0, jacErr: 0, projErr: 0, jacWall: 0, projWall: 0, projCells: 0 };
  let ns = 0;
  for (const s of g.slots) {
    if (!s.active) continue;
    // indeks GLOBALNY domeny (zestaw siatek — atlas podstawowy / „fine” / „coarse”), bok z siatki domeny
    const gi = s.gid ?? s.index, N = s.n || g.N;
    const region = ${xWall === null ? 'null' : `[1, 0, 0, (${xWall} - s.cx) / s.h + N * 0.5]`};
    const p = await g.probe(r, gi, region ? { region } : null);
    t.domeny++; t.nan += p.nan; t.za += p.sum.region; t.masa += p.sum.mass; t.keS += p.sum.keS; t.div += p.sum.divRes;
    t.divNear = Math.max(t.divNear, p.sum.divResNear); t.nearMass += p.sum.nearMass; ns += p.sum.nearSpeed * p.sum.nearMass;
    t.inSolid += p.sum.inSolid; t.speed = Math.max(t.speed, p.max.speed); t.near += p.sum.nearCells;
    // GPU ↔ lustro CPU: przekrój w połowie wysokości
    const sl = await g.probeSlice(r, gi);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const gpu = sl[(j * N + i) * 4] > 0.5 ? 1 : 0;
      const cpu = g.solidCpu(gi, i + 0.5, j + 0.5);
      if (gpu) t.solidCells++;
      if (gpu !== cpu) t.mismatch++;
    }
    // EROZJA przy ścianie (pkt 6 przeglądu): w przekroju dym w 1., 2. i 3. rzędzie komórek wolnych wzdłuż normalnej od
    // komórki stałej (pary tylko tam, gdzie w 3. rzędzie jest dym > 0,05) — r12 = Σ1 / Σ2 wyraźnie < r23 = Σ2 / Σ3 to
    // ciemny pas wzdłuż lica (adwekcja próbkuje zera z bryły).
    const fl = (i, j) => (i < 1 || j < 1 || i > N - 2 || j > N - 2) ? -1 : (sl[(j * N + i) * 4] > 0.5 ? 1 : 0);
    const sm = (i, j) => sl[(j * N + i) * 4 + 1];
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      if (fl(i, j) !== 1) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (fl(i + dx, j + dy) !== 0 || fl(i + 2 * dx, j + 2 * dy) !== 0 || fl(i + 3 * dx, j + 3 * dy) !== 0) continue;
        const s3 = sm(i + 3 * dx, j + 3 * dy);
        if (!(s3 > 0.05)) continue;
        t.eS1 += sm(i + dx, j + dy); t.eS2 += sm(i + 2 * dx, j + 2 * dy); t.eS3 += s3; t.ePairs++;
      }
    }
    // Rzut GPU ↔ lustro CPU (pkt 9): jedna iteracja Jacobiego i rzut w przekroju z odczytów atlasu po klatce.
    if (g.checkProjectCpu) {
      const pc = await g.checkProjectCpu(r, gi);
      t.jacErr = Math.max(t.jacErr, pc.jacErr); t.projErr = Math.max(t.projErr, pc.projErr);
      t.jacWall = Math.max(t.jacWall, pc.jacWall); t.projWall = Math.max(t.projWall, pc.projWall); t.projCells += pc.wallCells;
    }
  }
  t.e12 = t.eS2 > 1e-6 ? t.eS1 / t.eS2 : 0;
  t.e23 = t.eS3 > 1e-6 ? t.eS2 / t.eS3 : 0;
  delete t.eS1; delete t.eS2; delete t.eS3;
  t.nearSpeed = t.nearMass > 1e-6 ? ns / t.nearMass : 0;
  t.div = t.domeny ? t.div / t.domeny : 0;
  for (const k of Object.keys(t)) t[k] = +Number(t[k]).toPrecision(4);
  return t;
})()`);

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  // --siatka k=v,… — nadpisanie EXPLOSION_GRID w demie (np. fineSlots=0 — domena w atlasie podstawowym, k = 1)
  await cdp.send('Page.navigate', { url: `${base}/dema/wybuchy-webgpu.html?shot=1${args.siatka ? `&siatka=${encodeURIComponent(String(args.siatka))}` : ''}` });
  if (!await waitFor(cdp, '!!(window.__demo && window.__demo.ready && window.__harness)', 240000, 400)) throw new Error('demo nie wstało');
  await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
  await waitFor(cdp, 'window.__demo.proxiesReady()', 120000, 300);
  await sleep(2000);
  await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
  await ev(`(() => { Object.assign(window.__demo.fx.grid.tune, ${JSON.stringify(kv(args.gaz))}); window.__demo.obst.ships = false; return true; })()`);
  for (const kind of cases) {
    const C = CASES[kind];
    if (!C) { console.log('nieznany przypadek', kind); continue; }
    const d = C.d ?? D;
    const T = C.wall ?? 60;
    // ściana: x = GAL.x + d (lico od strony wybuchu), pudło wzdłuż y; brama — dwa pudła z otworem ±gap/2 wokół y = GAL.y
    const setup = await ev(`(async () => {
      const dm = window.__demo, h = window.__harness, G = dm.gallery;
      dm.clear(); dm.testHulls.length = 0;
      const walls = [];
      ${C.wall ? `const cx = G.x + ${d} + ${T} / 2;
      ${C.gap ? `walls.push({ cx, cy: G.y - ${C.gap} / 2 - 1500, ux: 0, uy: 1, hw: 1500, hd: ${T} / 2 }, { cx, cy: G.y + ${C.gap} / 2 + 1500, ux: 0, uy: 1, hw: 1500, hd: ${T} / 2 });`
        : `walls.push({ cx, cy: G.y, ux: 0, uy: 1, hw: 3000, hd: ${T} / 2 });`}` : ''}
      dm.walls(walls);
      ${C.hull ? `dm.testHulls.push({ x: G.x + ${C.hull.x}, y: G.y + ${C.hull.y}, angle: ${C.hull.angle}, w: ${C.hull.w}, h: ${C.hull.h}, vx: ${C.hull.vx}, vy: ${C.hull.vy}, angVel: 0, beamHull: null });` : ''}
      h.reseed(${0x5eed4321 + cases.indexOf(kind) * 7919}); await h.step(4);
      dm.cam(G.x, G.y, 0.3);
      await h.step(2);
      // ten sam ciąg efektów w każdym przypadku (reseed harnessu ma inne ziarno Math.random — pułapka 38)
      window.fxRandom.seed(0x0c0ffee5);
      // ten sam zegar gazu (turbulencja i szum źródeł zależą od czasu siatki — inaczej przypadki rozjeżdżają się chaotycznie)
      dm.fx.grid.time = 0; dm.fx.director.time = 0;
      dm.fx.director.stats.moved = 0; dm.fx.director.stats.blocked = 0;
      dm.fx.spawn(G.x, G.y, ${SIZE}, 'capital', ${C.vx || 0}, ${C.vy || 0}${C.opts ? `, ${JSON.stringify(C.opts)}` : ''});
      return { x: G.x, y: G.y };
    })()`);
    const xWall = C.wall || kind === 'brak' ? `${setup.x + d + T + 27}` : null;
    const rows = [];
    let tNow = 0;
    // --gesto 1: co 2 klatki od 0,4 do 2,4 s (skoki energii / niedobieżności przy przebudowie maski kadłuba w ruchu)
    const tl = args.gesto ? Array.from({ length: 61 }, (_, i) => +(0.4 + i / 30).toFixed(4)) : times;
    for (const at of tl) {
      const n = Math.max(1, Math.round((at - tNow) * 60 / stepsPerFrame));
      await ev(`window.__harness.step(${n}, ${1000 / 60 * stepsPerFrame})`);
      tNow = at;
      // ściana jedzie z domeną w przypadkach ruchu? nie — stoi w świecie; obszar „za” liczony od ściany w świecie
      const p = await probeAll(xWall);
      const st = await ev('(() => { const x = window.__demo.fx; return { hulls: x.stats.hulls, masked: x.stats.masked, moved: x.stats.moved, rasters: x.grid.stats.rasters, blocked: x.director.stats.blocked, emitery: x.director.stats.emitters, zrodla: x.grid.stats.sources }; })()');
      rows.push({ t: at, ...p, ...st });
      console.log(kind.padEnd(10), JSON.stringify(rows.at(-1)));
      if (args.zrzuty && (at === 0.5 || at === 1 || at === 2.5 || at === 4)) await screenshotPng(cdp, join(outDir, `${kind}-${String(at).replace('.', '_')}.png`));
    }
    report.cases.push({ kind, C, rows });
  }
  report.tslUuid = await ev('(() => { const u = window.Core3D?.tslUuid; return u ? { kolizje: u.kolizje } : null; })()');
  console.log('tslUuid', JSON.stringify(report.tslUuid));
} catch (e) {
  report.wyjatek = String(e.stack || e);
  console.log('BŁĄD', e.stack || e.message);
} finally {
  report.errors = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference/.test(l)).slice(0, 40);
  if (report.errors.length) console.log('błędy konsoli', JSON.stringify(report.errors.slice(0, 12), null, 1));
  writeJson(join(outDir, 'raport.json'), report);
  console.log('wyniki', outDir);
  await chrome.close();
  await server.close();
  process.exit(0);
}
