// Zrzuty i raport dema D20 „Zawalenia budowli” (dema/zawalenia-budowli.html, synteza dema § 7 (3)) w headless Chrome
// z GPU (CDP), w tle — bez okna. Zegar ręczny dema (?test=1 → window.__zaw.runFrames: 1/60 s na klatkę, kroki fizyki
// z licznika całkowitego), dziennik pipeline'ów z scripts/webgpu/harness-strona.js (hak window.__HARNESS_RENDERER__).
// Dla każdej sceny: kadry w chwilach pokazu (domyślnie 0/1/3/5/8/12/16 s) kamerami „Kino” i „Z góry jak w grze”, arkusz
// zbiorczy, oś czasu przeglądarki porównana z narzędziem Node (scripts/zawalenia-sym.mjs — ten sam kod sceny), pipeline'y
// synchroniczne po rozgrzewce (ma być 0), błędy konsoli i walidacji WebGPU, czasy kroku i klatki.
//
//   node scripts/webgpu/zawalenia-demo.mjs [--sceny 1,2,3] [--chwile 0,1,3,5,8,12,16] [--kamery kino,gora]
//        [--out .tmp/zawalenia-demo] [--rozmiar 1600x900] [--port 5410] [--node 0] [--interakcje 0] [--wymus 1]
//   --kamery    także profil, sledz, podstawa, dach, gruz (przyciski panelu)
//   --interakcje 0 — bez przebiegu interakcji sceny 2 (pomost, torpeda LPM, zmiana strony, salwa, zniszczenie pomostu)
//   --panel 0   — bez kadru z panelem i podpisem (panel.png: scena 1 po 3 s, jak po otwarciu)
//
// Kod wyjścia 1: błędy strony, pipeline'y synchroniczne po rozgrzewce, rozjazd osi czasu z Node albo demo nie wstało.
// Przed startem sprawdza gry użytkownika (wtedy pomija przebieg — kod 0, raport z powodem) i cudze harnessy (--wymus 1
// — mimo to).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo } from './wspolne.mjs';
import { gryUzytkownika, obceProcesy } from './sondaGpuWorkera.mjs';

const args = parseArgs();
const SCENY = String(args.sceny || '1,2,3').split(',').map(Number).filter((n) => n >= 1 && n <= 3);
const CHWILE = String(args.chwile || '0,1,3,5,8,12,16').split(',').map(Number).sort((a, b) => a - b);
const KAMERY = String(args.kamery || 'kino,gora').split(',').filter(Boolean);
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const outDir = resolve(repo, args.out || '.tmp/zawalenia-demo');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
mkdirSync(outDir, { recursive: true });
const report = { start: new Date().toISOString(), sceny: [], bledy: [], syncPipes: 0, syncHarness: [], porazki: [] };
const fail = (msg) => { report.porazki.push(msg); console.log('PORAŻKA', msg); };

const gry = await gryUzytkownika().catch(() => []);
if (gry.length) {
  report.pominiete = `gra użytkownika: ${gry.join(', ')}`;
  writeFileSync(join(outDir, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('POMIJAM —', report.pominiete);
  process.exit(0);
}
const obce = await obceProcesy().catch(() => []);
if (obce.length) {
  report.obce = obce;
  console.log('UWAGA: cudze harnessy / przeglądarki z portem debugowania:', obce.map((o) => o.cmd).join(' | '));
  if (args.wymus !== '1') {
    report.pominiete = 'cudzy harness w tle (--wymus 1 — mimo to)';
    writeFileSync(join(outDir, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
    process.exit(2);
  }
}

// oś czasu z Node (ten sam kod sceny) — do porównania z przeglądarką
function nodeTimeline(nr, czas) {
  const outp = execFileSync(process.execPath, [join(repo, 'scripts/zawalenia-sym.mjs'), '--scena', String(nr), '--czas', String(czas), '--json'],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  const line = outp.split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
  return line ? JSON.parse(line) : null;
}
const r2 = (v) => (v === null || v === undefined || !(v >= 0) || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

const { server, base } = await startVite(Number(args.port || 5410));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 900000) => evaluate(cdp, e, t);
const shotB64 = async () => (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
const sheets = [];

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  const tNav = Date.now();
  await cdp.send('Page.navigate', { url: `${base}/dema/zawalenia-budowli.html?test=1&shot=1&scena=${SCENY[0] || 1}` });
  // zegar harnessu od razu prawdziwy (demo ma własny zegar ręczny; frozen zerowałby czasy kroku i klatki)
  await waitFor(cdp, '!!(window.__harness && ((window.__harness.clock.mode = "real") === "real"))', 60000, 20);
  if (!await waitFor(cdp, '!!(window.__zaw && (window.__zaw.ready || window.__zaw.error))', 300000, 300)) throw new Error('demo nie wstało (limit 300 s)');
  const err = await ev('window.__zaw.error || null');
  if (err) throw new Error(`demo: ${err}`);
  report.startMs = Date.now() - tNav;
  report.warmupMs = await ev('window.__zaw.stats().warmupMs');
  const pipeStart = await ev('window.__harness.pipes.list.length');
  report.pipeStart = pipeStart;
  console.log(`demo gotowe po ${report.startMs} ms (rozgrzewka ${Math.round(report.warmupMs)} ms), pipeline'y przed gotowością: ${pipeStart}`);

  for (const nr of SCENY) {
    const sc = { scena: nr, kadry: [] };
    const s0 = await ev(`window.__zaw.scene(${nr})`);
    sc.start = { kroki: s0.kroki, bloki: s0.bloki };
    let tNow = 0;
    const cells = [];
    const frameMs = [];
    for (const t of CHWILE) {
      const n = Math.max(0, Math.round((t - tNow) * 60));
      if (n) {
        const t0 = Date.now();
        await ev(`window.__zaw.runFrames(${n}, 60)`);
        frameMs.push((Date.now() - t0) / n);
      }
      tNow = t;
      const tl = await ev('window.__zaw.timeline()');
      let st = null;
      for (const kam of KAMERY) {
        await ev(`(async () => { window.__zaw.camera(${JSON.stringify(kam)}); await window.__zaw.render(); await window.__zaw.render(); return true; })()`);
        await sleep(60);
        const png = await shotB64();
        const name = `s${nr}-t${String(t).padStart(2, '0')}-${kam}.png`;
        writeFileSync(join(outDir, name), Buffer.from(png, 'base64'));
        // liczniki po klatce tej kamery (rysunki i bloki liczy render)
        const stK = await ev('window.__zaw.stats()');
        if (!st) st = stK;
        cells.push({ t, kam, png, st: stK });
      }
      sc.kadry.push({
        t, rysunki: st.rysunki, bloki: st.bloki, kamienie: st.stones, pyl: st.dust, blyski: st.glow, smugi: st.beams,
        klatkaCpuMs: st.klatkaCpuMs, przechyl: tl.map((w) => (w.tiltNow === null ? null : Math.round(w.tiltNow))),
        klastry: st.gospodarze.map((g) => g.clusters)
      });
      console.log(`scena ${nr} t=${String(t).padStart(2)} s  rysunki ${st.rysunki}  bloki ${st.bloki}  gruz ${st.stones}  pył ${st.dust}  przechył ${JSON.stringify(sc.kadry.at(-1).przechyl)}  klastry ${JSON.stringify(sc.kadry.at(-1).klastry)}  sync ${st.syncPipes}`);
    }
    const st = await ev('window.__zaw.stats()');
    sc.krokMs = st.krokMs;
    sc.klatkaMsSciana = frameMs.length ? +(frameMs.reduce((a, b) => a + b, 0) / frameMs.length).toFixed(2) : null;
    sc.syncPipes = st.syncPipes;
    sc.syncNames = st.syncNames;
    sc.zamienniki = st.zamienniki;
    sc.gospodarze = st.gospodarze;
    // oś czasu: przeglądarka a Node (te same kroki: przewinięcie + ostatnia chwila pokazu)
    const tlB = await ev('window.__zaw.timeline()');
    const przewin = tlB[0]?.przewin || 0;
    const czas = przewin + CHWILE[CHWILE.length - 1];
    sc.os = tlB.map((w) => ({
      wieza: w.name, g: w.g, oderwanie: r2(w.detach), zawias: r2(w.hinge), przegub: r2(w.jointBroken), przegubTryb: w.breakMode || null,
      przechyl40: r2(w.tilt40), przechylMax: Math.round(w.maxTilt * 10) / 10, frontStart: r2(w.frontStart), frontPoziomy: w.frontLevels.map((f) => f.level),
      frontKoniec: r2(w.frontEnd), dach: r2(w.roofGround), dachOdPokazu: w.roofGround >= 0 ? r2(w.roofGround - przewin) : null
    }));
    if (args.node !== '0') {
      const nd = nodeTimeline(nr, czas);
      sc.node = nd ? nd.wieze.map((w) => ({ wieza: w.wieza, oderwanie: w.oderwanie, zawias: w.zawias, przegub: w.przegub, przechyl40: w.przechyl40, przechylMax: w.przechylMax, frontStart: w.frontStart, frontPoziomy: w.frontPoziomy, frontKoniec: w.frontKoniec, dach: w.dach })) : null;
      const keys = ['oderwanie', 'zawias', 'przegub', 'przechyl40', 'frontStart', 'frontKoniec', 'dach'];
      sc.zgodnoscZNode = !!sc.node && sc.os.every((w, i) => keys.every((k) => w[k] === sc.node[i]?.[k]) && JSON.stringify(w.frontPoziomy) === JSON.stringify(sc.node[i]?.frontPoziomy));
      if (!sc.zgodnoscZNode) fail(`scena ${nr}: oś czasu przeglądarki ≠ Node`);
    }
    if (st.syncPipes > 0) fail(`scena ${nr}: ${st.syncPipes} pipeline'ów synchronicznych (${st.syncNames.join(', ')})`);
    report.syncPipes = Math.max(report.syncPipes, st.syncPipes);
    report.sceny.push(sc);
    console.log(`scena ${nr}: oś ${JSON.stringify(sc.os)}${sc.node ? `\n          node ${JSON.stringify(sc.node)}` : ''}\n          zgodność z Node: ${sc.zgodnoscZNode}  krok ms ${JSON.stringify(sc.krokMs)}  klatka (ściana) ${sc.klatkaMsSciana} ms`);
    sheets.push({ nr, cells });
  }
  // interakcje sceny 2 (bez porównania z Node): pomost nad pustką, torpeda z okrętu (LPM przez shootWorld), zmiana strony
  // w biegu, salwa F, zniszczenie pomostu −y (D13) — błędy, pipeline'y i kadry
  if (args.interakcje !== '0' && SCENY.includes(2)) {
    const it = { kroki: [] };
    const krok = async (opis, expr, kadr) => {
      const r = await ev(expr);
      if (kadr) {
        await ev('(async () => { window.__zaw.camera("kino"); await window.__zaw.render(); await window.__zaw.render(); return true; })()');
        await sleep(60);
        writeFileSync(join(outDir, `s2-interakcje-${kadr}.png`), Buffer.from(await shotB64(), 'base64'));
      }
      it.kroki.push({ opis, wynik: typeof r === 'object' ? { t: r?.t, sync: r?.syncPipes } : r });
    };
    await krok('scena 2 na pomoście, torpeda', 'window.__zaw.scene(2, { pomost: true, bron: "torpeda" })');
    await krok('1 s auto-salwy', 'window.__zaw.runFrames(60, 60)');
    await krok('LPM: torpeda w środek wieży', 'window.__zaw.shootWorld()');
    await krok('0,1 s', 'window.__zaw.runFrames(6, 60)', '1-torpeda');
    await krok('strzały z −x (okręt przestawiony)', 'window.__zaw.side("-x")');
    await krok('salwa F', 'window.__zaw.salvo()');
    await krok('2 s', 'window.__zaw.runFrames(120, 60)', '2-strona-x');
    await krok('pomost −y (D13)', 'window.__zaw.bridge()');
    await krok('6 s', 'window.__zaw.runFrames(360, 60)', '3-pomost');
    const st = await ev('window.__zaw.stats()');
    it.syncPipes = st.syncPipes; it.bledy = st.bledy; it.gospodarze = st.gospodarze;
    if (st.syncPipes > report.syncPipes) report.syncPipes = st.syncPipes;
    if (st.syncPipes > 0) fail(`interakcje: ${st.syncPipes} pipeline'ów synchronicznych (${st.syncNames.join(', ')})`);
    report.interakcje = it;
    console.log(`interakcje sceny 2: sync ${st.syncPipes}, błędy ${st.bledy.length}, klastry ${JSON.stringify(st.gospodarze.map((g) => g.clusters))}`);
  }
  // dziennik harnessu: pipeline'y synchroniczne po gotowości (render, nie budowy i nie compute)
  const pipes = await ev(`window.__harness.pipes.list.slice(${pipeStart}).filter((p) => p.sync && !p.budowa && !p.compute).map((p) => p.nazwa)`);
  report.syncHarness = pipes;
  if (pipes.length) fail(`harness: ${pipes.length} pipeline'ów synchronicznych po gotowości (${[...new Set(pipes)].join(', ')})`);
  report.budowyWKlatkach = await ev(`window.__harness.pipes.list.slice(${pipeStart}).filter((p) => p.budowa && !p.poza).length`);

  // kadr z panelem i podpisem jak po otwarciu dema: tryb żywy (pętla rAF, prawdziwy czas, interpolacja póz), ~3 s
  if (args.panel !== '0') {
    await cdp.send('Page.navigate', { url: `${base}/dema/zawalenia-budowli.html` });
    await waitFor(cdp, '!!(window.__harness && ((window.__harness.clock.mode = "real") === "real"))', 60000, 20);
    if (await waitFor(cdp, '!!(window.__zaw && (window.__zaw.ready || window.__zaw.error))', 300000, 300)) {
      const k0 = await ev('(() => { window.__klatki = 0; const f = () => { window.__klatki++; requestAnimationFrame(f); }; requestAnimationFrame(f); return true; })()');
      void k0;
      await sleep(3000);
      writeFileSync(join(outDir, 'panel.png'), Buffer.from(await shotB64(), 'base64'));
      const stP = await ev('window.__zaw.stats()');
      report.zywy = { t: stP.t, klatki: await ev('window.__klatki'), syncPipes: stP.syncPipes, klatkaCpuMs: stP.klatkaCpuMs, krokMs: stP.krokMs, bledy: stP.bledy };
      console.log(`tryb żywy: t pokazu ${stP.t} s, klatki rAF ${report.zywy.klatki} w ~3 s, sync ${stP.syncPipes}, błędy ${stP.bledy.length}`);
      if (stP.syncPipes > 0) fail(`tryb żywy: ${stP.syncPipes} pipeline'ów synchronicznych (${stP.syncNames.join(', ')})`);
      if (!(stP.t > 0.5)) fail(`tryb żywy: czas pokazu nie płynie (t ${stP.t})`);
    } else fail('tryb żywy: demo nie wstało');
  }

  // arkusze: wiersz = kamera, kolumny = chwile
  for (const { nr, cells } of sheets) {
    const rows = KAMERY.map((k) => cells.filter((c) => c.kam === k));
    const cell = (c) => `<td><img src="data:image/png;base64,${c.png}"><div>t=${c.t} s · ${c.kam} · bloki ${c.st.bloki} · gruz ${c.st.stones}</div></td>`;
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#05060c;color:#cfe4ff;font:11px Consolas,monospace}
      table{border-collapse:collapse} td{padding:2px;vertical-align:top} img{width:384px;height:216px;display:block} div{width:384px}</style>
      <table>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table>`;
    const SWp = 8 + CHWILE.length * 389, SHp = rows.length * 236 + 8;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: SWp, height: SHp, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(400);
    await ev(`(() => { document.open(); document.write(${JSON.stringify(html)}); document.close(); return true; })()`);
    await sleep(900);
    writeFileSync(join(outDir, `arkusz-s${nr}.png`), Buffer.from(await shotB64(), 'base64'));
  }
} catch (e) {
  report.blad = String(e?.stack || e);
  fail(`harness: ${report.blad}`);
} finally {
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 40);
  if (report.bledy.length) fail(`błędy strony: ${report.bledy.length}`);
  await chrome.close();
  await server.close();
}
report.koniec = new Date().toISOString();
writeFileSync(join(outDir, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`raport: ${join(outDir, 'raport.json')}  sync ${report.syncPipes}  harness sync ${report.syncHarness.length}  błędy ${report.bledy.length}  porażki ${report.porazki.length}`);
for (const b of report.bledy.slice(0, 8)) console.log('  ', b.slice(0, 300));
process.exit(report.porazki.length ? 1 : 0);
