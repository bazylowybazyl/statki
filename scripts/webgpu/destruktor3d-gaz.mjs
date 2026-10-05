// Zniszczenia z wybuchami i dymem w destruktor3d-webgpu.html (plan docs/PLAN-zniszczenia-swiata-3d.md § 12).
// Własny Vite (bez HMR) + headless Chrome z WebGPU. Na próbę: cel, broń / taran / wybuch reaktora, klatki
// w chwilach od pierwszego trafienia (kroki fizyki 1/120 s z efektami gazu w tym samym zegarze).
//   node scripts/webgpu/destruktor3d-gaz.mjs [--proby lance,rocket,cannon,beam,ram,reactor] [--cel anchored]
//        [--klatki 0.05,0.3,0.8,1.6,3] [--out katalog] [--v 300] [--statek 60]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startVite, startChrome, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const WEAPONS = { cannon: 0, rocket: 1, beam: 2, lance: 3, ram: -1, reactor: -2 };
const trials = arg('proby', 'lance,rocket,ram,reactor').split(',').filter((w) => w in WEAPONS);
const target = arg('cel', 'anchored');
const times = arg('klatki', '0.05,0.3,0.8,1.6,3').split(',').map(Number);
const outDir = arg('out', '.tmp/destruktor3d-gaz');
const ramSpeed = Number(arg('v', 0));
const shipPct = Number(arg('statek', 0));
const HOLD = { cannon: 0.6, beam: 1.6, lance: 0, rocket: 0, ram: 0, reactor: 0 };
mkdirSync(outDir, { recursive: true });

const { server, base } = await startVite(5295);
const chrome = await startChrome({ width: 1280, height: 720, webgpu: true });
const { cdp, logs } = chrome;
const ev = (expr) => evaluate(cdp, expr);
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
const errors = () => logs.filter((l) => /^\[(error|exception)\]/.test(l));
const report = { trials: [], errors: [] };

try {
  const ok = await navigateAndWait(cdp, `${base}/destruktor3d-webgpu.html`,
    '!!(window.__demo && window.__demo.station && window.__demo.structure && window.__demo.structure.stats.nodes > 600)', 180000);
  if (!ok) throw new Error('demo się nie wczytało: ' + JSON.stringify(errors().slice(0, 8)));
  await sleep(2500);
  if (shipPct > 0 || ramSpeed > 0) {
    await ev(`(() => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); };
      if (${shipPct} > 0) set('sl-ship-size', ${shipPct});
      if (${ramSpeed} > 0) set('sl-speed', ${ramSpeed});
      return true;
    })()`);
    await sleep(1500);
  }
  const rows = [];
  for (const trial of trials) {
    await ev(`(() => {
      const d = window.__demo;
      d.setPaused(true);
      d.gasFx.clear(); d.gasDestruction.clear();
      d.setTarget(${JSON.stringify(target)});
      d.setPaused(true);
      d.setLegacy(false);
      const w = ${WEAPONS[trial]};
      if (w >= 0) d.selectWeapon(w);
      else if (w === -1) { d.launch(); d.setPaused(true); }
      d.view(${JSON.stringify(arg('oko', '71.4,29.4,75.6').split(',').map(Number))}, ${JSON.stringify(arg('cel3d', '12,-1,0').split(',').map(Number))});
      window.__probe = { broken0: d.DestructorBeams3D.perf.beamsBroken, time: 0 };
      return true;
    })()`);
    const first = await ev(`(() => {
      const d = window.__demo, w = d.weapons, p = window.__probe;
      const kind = ${WEAPONS[trial]};
      if (kind === -2) { d.blowReactor(); d.setPaused(true); p.firstHit = 0; return 0; }
      if (${HOLD[trial]} === 0 && kind >= 0) w.fire(kind, d.ram, d.bodies);
      const hits = kind >= 0 ? () => w.stats.hits.reduce((a, b) => a + b, 0)
        : () => d.DestructorBeams3D.perf.contacts + (d.DestructorBeams3D.perf.beamsBroken - p.broken0);
      for (let k = 0; k < 600 && hits() === 0; k++) { d.step(1 / 120, 1, ${HOLD[trial] > 0}, false); p.time += 1 / 120; }
      p.firstHit = hits() > 0 ? p.time : -1;
      p.holdLeft = ${HOLD[trial]};
      return p.firstHit;
    })()`);
    const frames = [];
    let tNow = 0;
    for (const at of times) {
      const st = await ev(`(() => {
        const d = window.__demo, p = window.__probe;
        const steps = Math.round((${at} - ${tNow}) * 120);
        const t0 = performance.now();
        for (let k = 0; k < steps; k++) { d.step(1 / 120, 1, p.holdLeft > 0, false); p.holdLeft -= 1 / 120; }
        d.render();
        const g = d.gasFx.grid.stats;
        return { t: ${at}, ms: +(performance.now() - t0).toFixed(0), domeny: g.active, zrodla: g.sources,
          iskry: d.gasFx.embers.stats.alive, zerwane: d.DestructorBeams3D.perf.beamsBroken - p.broken0,
          wraki: d.bodies.filter((b) => b.isWreck && !b.dead).length, ogniska: d.gasDestruction.stats.wreckFires,
          styki: d.gasDestruction.stats.contact };
      })()`);
      await sleep(120);
      await ev('(() => { window.__demo.render(); return true; })()');
      await sleep(80);
      const png = await shot();
      writeFileSync(join(outDir, `${trial}-${String(at).replace('.', '_')}.png`), Buffer.from(png, 'base64'));
      frames.push({ st, png });
      tNow = at;
    }
    rows.push({ trial, frames, first });
    report.trials.push({ trial, first, frames: frames.map((f) => f.st) });
    console.log(trial.padEnd(8), 'trafienie', first, JSON.stringify(frames.map((f) => [f.st.t, f.st.domeny, f.st.iskry, f.st.zerwane, f.st.wraki])));
  }
  const cell = (f) => `<td><img src="data:image/png;base64,${f.png}"><div>t=${f.st.t}s · dom ${f.st.domeny} · iskry ${f.st.iskry} · zerw ${f.st.zerwane} · wraki ${f.st.wraki}</div></td>`;
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#05060c;color:#cfe4ff;font:12px Consolas,monospace}
    table{border-collapse:collapse} td{padding:3px;vertical-align:top} img{width:384px;height:216px;display:block} th{color:#ffd479;padding:4px 6px}
    div{width:384px}</style><table>${rows.map((r) => `<tr><th>${r.trial}</th>${r.frames.map(cell).join('')}</tr>`).join('')}</table>`;
  const SW = 110 + times.length * 390, SH = rows.length * 240 + 8;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: SW, height: SH, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await ev(`(() => { document.open(); document.write(${JSON.stringify(html)}); document.close(); return true; })()`);
  await sleep(900);
  writeFileSync(join(outDir, 'arkusz.png'), Buffer.from(await shot(), 'base64'));
} catch (e) {
  console.log('BŁĄD', e.message);
} finally {
  report.errors = errors().slice(0, 40);
  writeFileSync(join(outDir, 'raport.json'), JSON.stringify(report, null, 1));
  console.log('błędy konsoli', JSON.stringify(report.errors.slice(0, 12), null, 1));
  console.log('wyniki', outDir);
  await chrome.close();
  await server.close();
  process.exit(0);
}
