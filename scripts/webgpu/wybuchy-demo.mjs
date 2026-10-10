// Zrzuty dema dema/wybuchy-webgpu.html — wybuchy gry (src/3d/explosions/) na prawdziwym Core3D, widok z góry jak w
// grze i kamera 3D. Czas wirtualny harnessu gry (scripts/webgpu/harness-strona.js): każda klatka = 1/60 s, zrzut na
// zatrzymanej klatce — kadry powtarzalne.
//   node scripts/webgpu/wybuchy-demo.mjs [--przypadki capital@0.3,final@0.3,escort@0.3,capital@0.14,chain,kino]
//        [--klatki 0.05,0.15,0.35,0.7,1.2,2,3.5,6] [--out .tmp/wybuchy-demo] [--rozmiar 1600x900] [--port 5294]
//        [--tune klucz=wartość,…] (EXPLOSION_TUNE) [--look k=v,…] (obraz gazu) [--gaz k=v,…] (fizyka gazu) [--rez k=v,…] (reżyser gazu) [--ab klucz] (każdy kadr też z wyłączoną warstwą: *-bez-klucz.png)
//        [--koszt] (koszt GPU: łańcuch doku w czasie rzeczywistym, z gazem i bez)
// Przypadek: profil@zoom (wybuch w środku galerii, size z profilu demo), `chain` (łańcuch rozpadu doku), `threshold`
// (progi punktów doku), `station` (rozpad stacji), `kino` (kamera 3D, okręt liniowy).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const cases = String(args.przypadki || 'capital@0.3,final@0.3,escort@0.3,capital@0.14,chain,kino').split(',');
const times = String(args.klatki || '0.05,0.15,0.35,0.7,1.2,2,3.5,6').split(',').map(Number);
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const outDir = resolve(repo, args.out || '.tmp/wybuchy-demo');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
mkdirSync(outDir, { recursive: true });
const SIZES = { fighter: 40, escort: 160, cruiser: 220, capital: 300, chain: 200, cut: 260, final: 320 };
const kv = (str) => Object.fromEntries(String(str || '').split(',').filter(Boolean).map((p) => {
  const [k, v] = p.split('=');
  return [k, v === 'true' ? true : v === 'false' ? false : Number(v)];
}));

const { server, base } = await startVite(Number(args.port || 5294));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const shotB64 = async () => (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
const report = { cases: [], errors: [] };
const rows = [];

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/dema/wybuchy-webgpu.html?shot=1` });
  if (!await waitFor(cdp, '!!(window.__demo && window.__demo.ready && window.__harness)', 240000, 400)) throw new Error('demo nie wstało');
  // Ładowanie (tekstury proxy, rozgrzewka): prawdziwe klatki aż proxy gotowe, potem wstrzymanie.
  await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
  await waitFor(cdp, 'window.__demo.proxiesReady()', 120000, 300);
  await sleep(2500);
  await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
  await ev(`(() => { Object.assign(window.__demo.tune, ${JSON.stringify(kv(args.tune))}); Object.assign(window.__demo.fx.volume.look, ${JSON.stringify(kv(args.look))}); Object.assign(window.__demo.fx.grid.tune, ${JSON.stringify(kv(args.gaz))}); Object.assign(window.__demo.fx.director.tune, ${JSON.stringify(kv(args.rez))}); return true; })()`);
  for (const spec of cases) {
    const [kind, zoomStr] = spec.split('@');
    const zoom = Number(zoomStr) || 0.3;
    const setup = await ev(`(async () => {
      const d = window.__demo, h = window.__harness;
      d.clear();
      h.reseed(0x5eed1234);
      await h.step(30);   // dym i iskry poprzednich przypadków znikają z pul rakiet i broni
      const g = d.gallery;
      if ('${kind}' === 'chain' || '${kind}' === 'threshold' || '${kind}' === 'station') d.scene('${kind}');
      else if ('${kind}' === 'kino') { d.cine(4200, -0.7, 0.62); d.boomAt('capital', 0, 0, 300); }
      else { d.cam(g.x, g.y, ${zoom}); d.boomAt('${kind}', 0, 0, ${SIZES[kind] || 300}); }
      return d.stats();
    })()`);
    const frames = [];
    let tNow = 0;
    for (const at of times) {
      const n = Math.max(1, Math.round((at - tNow) * 60));
      const t0 = Date.now();
      await ev(`window.__harness.step(${n})`);
      const stats = await ev('window.__demo.stats()');
      stats.realMs = Date.now() - t0;
      await ev('window.__harness.frames(2)');
      await sleep(60);
      const png = await shotB64();
      const name = `${kind}${zoomStr ? '-' + zoomStr : ''}-${String(at).replace('.', '_')}`;
      writeFileSync(join(outDir, `${name}.png`), Buffer.from(png, 'base64'));
      if (args.ab) {
        await ev(`(async () => { window.__demo.tune['${args.ab}'] = false; await window.__harness.frames(2); return true; })()`);
        await sleep(60);
        writeFileSync(join(outDir, `${name}-bez-${args.ab}.png`), Buffer.from(await shotB64(), 'base64'));
        await ev(`(async () => { window.__demo.tune['${args.ab}'] = true; await window.__harness.frames(1); return true; })()`);
      }
      frames.push({ t: at, stats, png });
      tNow = at;
    }
    rows.push({ name: spec, frames });
    report.cases.push({ spec, setup, frames: frames.map((f) => ({ t: f.t, stats: f.stats })) });
    console.log(spec.padEnd(14), JSON.stringify(frames.map((f) => [f.t, f.stats.grid.active, f.stats.grid.sources, f.stats.embers, +f.stats.cpuMs.toFixed(2)])));
  }
  if (args.ruch) {
    // Test RUCHU dymu (dawny błąd „idzie i cofa się”): okręt liniowy w galerii, kadr sprzed wybuchu, od 1,6 s seria klatek
    // co 1/30 s — środek ciężkości różnicy względem kadru tła (obłok) i jego pole. Zawrotki = zmiany zwrotu ruchu środka;
    // druga seria: symulacja zamrożona (krok czasu 0 dla wybuchów) — obraz nie może ruszać się sam.
    const { decodePng } = await import('./png.mjs');
    const shotImg = async () => decodePng(Buffer.from(await shotB64(), 'base64'));
    await ev(`(async () => { const d = window.__demo, h = window.__harness; d.clear(); h.reseed(0x5eed1234); await h.step(30); d.cam(d.gallery.x, d.gallery.y, 0.3); await h.frames(2); return true; })()`);
    const bg = await shotImg();
    await ev('(async () => { const d = window.__demo; d.boomAt("capital", 0, 0, 300); await window.__harness.step(96); return true; })()');
    const measure = (img) => {
      let sa = 0, sx = 0, sy = 0;
      const { width: w, height: hgt, data } = img;
      for (let y = 0; y < hgt; y += 2) for (let x = 0; x < w; x += 2) {
        const o = (y * w + x) * 4;
        const dd = Math.abs(data[o] - bg.data[o]) + Math.abs(data[o + 1] - bg.data[o + 1]) + Math.abs(data[o + 2] - bg.data[o + 2]);
        if (dd > 24) { sa++; sx += x; sy += y; }
      }
      return { a: sa, cx: sx / Math.max(1, sa), cy: sy / Math.max(1, sa) };
    };
    const series = async (n, step) => {
      const out = [];
      for (let i = 0; i < n; i++) { await ev(`window.__harness.step(${step})`); out.push(measure(await shotImg())); }
      return out;
    };
    const stats = (sr) => {
      let rev = 0, path = 0;
      for (let i = 1; i < sr.length; i++) path += Math.hypot(sr[i].cx - sr[i - 1].cx, sr[i].cy - sr[i - 1].cy);
      for (let i = 2; i < sr.length; i++) {
        const ax = sr[i].cx - sr[i - 1].cx, ay = sr[i].cy - sr[i - 1].cy, bx = sr[i - 1].cx - sr[i - 2].cx, by = sr[i - 1].cy - sr[i - 2].cy;
        if (ax * bx + ay * by < 0) rev++;
      }
      const net = Math.hypot(sr.at(-1).cx - sr[0].cx, sr.at(-1).cy - sr[0].cy);
      return { zawrotki: rev, droga: +path.toFixed(1), przesuniecie: +net.toFixed(1), polePocz: sr[0].a, poleKon: sr.at(-1).a };
    };
    const live = await series(36, 2);
    // Zamrożony wybuch: zegar wybuchów stoi (clock demo = state.T; pauza dema zatrzymuje symulację i T).
    await ev('(() => { window.__demo.setSpeed(0); return true; })()');
    const frozen = await series(12, 2);
    await ev('(() => { window.__demo.setSpeed(1); return true; })()');
    report.ruch = { live: stats(live), frozen: stats(frozen), seria: live.filter((_, i) => i % 6 === 0).map((m) => [+m.cx.toFixed(1), +m.cy.toFixed(1), m.a]) };
    console.log('ruch', JSON.stringify(report.ruch));
  }
  if (args.koszt) {
    // Koszt w czasie rzeczywistym: łańcuch rozpadu doku (kadr całego doku), próbki czasu GPU klatki (znaczniki
    // Core3D co kilka klatek) i czasu klatki; ten sam przebieg z gazem i bez (wybuchy z cząstek) oraz bez wybuchów.
    const run = (label, tune) => ev(`(async () => {
      const d = window.__demo, h = window.__harness;
      Object.assign(d.tune, ${JSON.stringify(tune)});
      d.clear();
      h.hold(false); h.clock.mode = 'real';
      await new Promise((r) => setTimeout(r, 1500));
      d.scene('chain');
      const s = [];
      const t0 = performance.now();
      let last = t0, worst = 0, n = 0, maxDom = 0, cpu = 0;
      while (performance.now() - t0 < 5200) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        worst = Math.max(worst, now - last); last = now; n++;
        const g = window.Core3D.gpuFrameMs;
        if (Number.isFinite(g)) s.push(g);
        maxDom = Math.max(maxDom, d.fx.grid.stats.active);
        cpu = Math.max(cpu, d.fx.stats.cpuMs);
      }
      h.clock.t = h.realNow(); h.clock.mode = 'frozen'; h.hold(true);
      s.sort((a, b) => a - b);
      const q = (p) => s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null;
      return { label: '${label}', klatki: n, fps: +(n / 5.2).toFixed(1), najgorszaMs: +worst.toFixed(1), gpuMed: q(0.5), gpuP90: q(0.9), gpuMax: q(0.999), maxDomen: maxDom, cpuKrokuMax: +cpu.toFixed(2) };
    })()`);
    report.koszt = [];
    for (const [label, tune] of [['bez wybuchów', { enabled: false }], ['z gazem', { enabled: true, gas: true }], ['bez gazu', { enabled: true, gas: false }], ['z gazem 2', { enabled: true, gas: true }]]) {
      const r = await run(label, tune);
      report.koszt.push(r);
      console.log('koszt', JSON.stringify(r));
    }
    await ev('(() => { Object.assign(window.__demo.tune, { enabled: true, gas: true }); return true; })()');
  }
  // Arkusz: wiersz = przypadek, kolumny = chwile.
  const cell = (f) => `<td><img src="data:image/png;base64,${f.png}"><div>t=${f.t}s · dom ${f.stats.grid.active} · źr ${f.stats.grid.sources} · żar ${f.stats.embers}</div></td>`;
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#05060c;color:#cfe4ff;font:12px Consolas,monospace}
    table{border-collapse:collapse} td{padding:3px;vertical-align:top} img{width:400px;height:225px;display:block} th{color:#ffb070;padding:4px 6px}
    div{width:400px}</style><table>${rows.map((r) => `<tr><th>${r.name}</th>${r.frames.map(cell).join('')}</tr>`).join('')}</table>`;
  const SW = 120 + times.length * 406, SH = rows.length * 250 + 8;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: SW, height: SH, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(500);
  await ev(`(() => { document.open(); document.write(${JSON.stringify(html)}); document.close(); return true; })()`);
  await sleep(1200);
  writeFileSync(join(outDir, 'arkusz.png'), Buffer.from(await shotB64(), 'base64'));
} catch (e) {
  console.log('BŁĄD', e.stack || e.message);
} finally {
  report.errors = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference/.test(l)).slice(0, 40);
  writeJson(join(outDir, 'raport.json'), report);
  console.log('błędy konsoli', JSON.stringify(report.errors.slice(0, 12), null, 1));
  console.log('wyniki', outDir);
  await chrome.close();
  await server.close();
  process.exit(0);
}
