// Zrzuty dema dema/dok-k7-webgpu.html — sama hala K-7 (ramiona SCARA, przewody paliwowe z fizyką liny, buchy pary
// dookoła złączek, rurociągi i zbiorniki, bez suwnic) na prawdziwym Core3D. Czas wirtualny harnessu gry
// (scripts/webgpu/harness-strona.js): każda klatka = 1/60 s, zrzut na zatrzymanej klatce — kadry powtarzalne.
//   node scripts/webgpu/dok-k7-demo.mjs [--przypadki odlacz@stanowisko,odlacz@3d-ramie,podlacz@zblizenie,hala,zbiorniki]
//        [--klatki 0,0.9,1.45,1.6,2.1,2.8,3.6,4.6,6.5] [--out .tmp/dok-k7-demo] [--rozmiar 1600x900] [--port 5296]
//        [--tune klucz=wartość,…] (K7FuelTune) [--noc] [--koszt]
// Przypadek: sekwencja@widok (sekwencja: odlacz | podlacz | awaryjnie; widok z VIEWS dema), lot@widok (z podpiętymi
// przewodami gracz trzyma W — automat stanowiska awaryjnie odpina, odlatujący kadłub ciągnie przewody) albo sam
// widok (hala, zbiorniki, stanowisko, …) — jeden kadr.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const cases = String(args.przypadki || 'odlacz@stanowisko,odlacz@3d-ramie,podlacz@zblizenie,podlacz@3d-stanowisko,hala,zbiorniki').split(',');
const times = String(args.klatki || '0,0.9,1.45,1.6,2.1,2.8,3.6,4.6,6.5').split(',').map(Number);
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const outDir = resolve(repo, args.out || '.tmp/dok-k7-demo');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
mkdirSync(outDir, { recursive: true });
const SEQ = { odlacz: 'undock', podlacz: 'dock', awaryjnie: 'release' };
const kv = (str) => Object.fromEntries(String(str || '').split(',').filter(Boolean).map((p) => {
  const [k, v] = p.split('=');
  return [k, v === 'true' ? true : v === 'false' ? false : Number(v)];
}));

const { server, base } = await startVite(Number(args.port || 5296));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const shotB64 = async () => (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
const report = { cases: [], errors: [] };
const rows = [];

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/dema/dok-k7-webgpu.html?shot=1&pokaz=0${args.noc ? '&noc=1' : ''}` });
  if (!await waitFor(cdp, '!!(window.__dok && window.__dok.ready && window.__harness)', 240000, 400)) throw new Error('demo nie wstało');
  // ładowanie (tekstury, rozgrzewka): prawdziwe klatki chwilę, potem zegar zatrzymany
  await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
  await sleep(4000);
  await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
  await ev(`(() => { Object.assign(window.K7FuelTune, ${JSON.stringify(kv(args.tune))}); window.__dok.wake(); return true; })()`);
  for (const spec of cases) {
    const [kind, view] = spec.includes('@') ? spec.split('@') : [null, spec];
    const seq = SEQ[kind];
    const frames = [];
    // stan wyjściowy: podłączony (odłączanie, awaryjne) albo złożony (podłączanie), przewody w spoczynku
    await ev(`(async () => {
      const d = window.__dok, h = window.__harness;
      d.view('${view}');
      d.seq('${seq === 'dock' ? 'stowed' : 'connected'}');
      d.wake();
      await h.step(240);
      return true;
    })()`);
    if (kind === 'lot') {
      // stery u gracza: W trzymane przez 2,4 s (Input.dispatchKeyEvent — wejście dema), potem swobodnie
      const key = async (type) => cdp.send('Input.dispatchKeyEvent', { type, code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
      await key('keyDown');
      let tNow = 0;
      for (const at of times) {
        if (tNow < 2.4 && at >= 2.4) {
          const n1 = Math.max(0, Math.round((2.4 - tNow) * 60));
          if (n1) await ev(`window.__harness.step(${n1})`);
          await key('keyUp');
          tNow = 2.4;
        }
        const n = Math.max(0, Math.round((at - tNow) * 60));
        if (n) await ev(`window.__harness.step(${n})`);
        // statystyki z ostatniej klatki z czasem gry (klatka zrzutu stoi: dt = 0, licznik aktywnych = 0)
        const stats = await ev('window.__dok.stats()');
        await ev('window.__harness.frames(1)');
        await sleep(80);
        const png = await shotB64();
        writeFileSync(join(outDir, `lot-${view}-${String(at).replace('.', '_')}.png`), Buffer.from(png, 'base64'));
        frames.push({ t: at, stats, png });
        tNow = at;
      }
      await key('keyUp');
    } else if (!seq) {
      await ev('window.__harness.frames(2)');
      await sleep(80);
      const png = await shotB64();
      writeFileSync(join(outDir, `${view}.png`), Buffer.from(png, 'base64'));
      frames.push({ t: 0, stats: await ev('window.__dok.stats()'), png });
    } else {
      await ev(`(() => { window.__dok.seq('${seq}'); return true; })()`);
      let tNow = 0;
      for (const at of times) {
        const n = Math.max(0, Math.round((at - tNow) * 60));
        if (n) await ev(`window.__harness.step(${n})`);
        const stats = await ev('window.__dok.stats()');
        await ev('window.__harness.frames(1)');
        await sleep(80);
        const png = await shotB64();
        writeFileSync(join(outDir, `${kind}-${view}-${String(at).replace('.', '_')}.png`), Buffer.from(png, 'base64'));
        frames.push({ t: at, stats, png });
        tNow = at;
      }
    }
    rows.push({ name: spec, frames });
    report.cases.push({ spec, frames: frames.map((f) => ({ t: f.t, stats: f.stats })) });
    console.log(spec.padEnd(26), JSON.stringify(frames.map((f) => [f.t, f.stats.rig.awake, f.stats.rig.latched, f.stats.gas.bursts, +f.stats.rig.cpuMs.toFixed(2)])));
  }
  if (args.koszt) {
    // koszt w czasie rzeczywistym: pętla pokazu w kadrze stanowiska (fizyka, gaz, kłęby), czas klatki i GPU
    const r = await ev(`(async () => {
      const d = window.__dok, h = window.__harness;
      h.hold(false); h.clock.mode = 'real';
      d.view('stanowisko'); d.loop(true);
      await new Promise((r) => setTimeout(r, 1500));
      const s = [];
      const t0 = performance.now();
      let last = t0, worst = 0, n = 0, rig = 0, gas = 0;
      while (performance.now() - t0 < 14000) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        worst = Math.max(worst, now - last); last = now; n++;
        const g = window.Core3D.gpuFrameMs;
        if (Number.isFinite(g)) s.push(g);
        rig = Math.max(rig, d.rig.stats.cpuMs);
        gas = Math.max(gas, d.stats().gas.cpuMs);
      }
      h.clock.t = h.realNow(); h.clock.mode = 'frozen'; h.hold(true);
      s.sort((a, b) => a - b);
      const q = (p) => s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null;
      return { klatki: n, fps: +(n / 14).toFixed(1), najgorszaMs: +worst.toFixed(1), gpuMed: q(0.5), gpuP90: q(0.9), fizykaCpuMax: +rig.toFixed(2), gazCpuMax: +gas.toFixed(2) };
    })()`);
    report.koszt = r;
    console.log('koszt', JSON.stringify(r));
  }
  // arkusz: wiersz = przypadek, kolumny = chwile
  const cell = (f) => `<td><img src="data:image/png;base64,${f.png}"><div>t=${f.t}s · ramiona ${f.stats.rig.awake} · zarygl. ${f.stats.rig.latched} · buchy ${f.stats.gas.bursts}</div></td>`;
  const cols = Math.max(...rows.map((r) => r.frames.length));
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#05060c;color:#cfe4ff;font:12px Consolas,monospace}
    table{border-collapse:collapse} td{padding:3px;vertical-align:top} img{width:400px;height:225px;display:block} th{color:#ffc23a;padding:4px 6px}
    div{width:400px}</style><table>${rows.map((r) => `<tr><th>${r.name}</th>${r.frames.map(cell).join('')}</tr>`).join('')}</table>`;
  const SW = 150 + cols * 406;
  const SH = rows.length * 250 + 8;
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
