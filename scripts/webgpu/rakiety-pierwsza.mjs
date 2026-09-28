// Pierwsza salwa rakiet i pierwsza Supernowa w PRAWDZIWEJ grze (?dev, WebGPU, czas rzeczywisty) — czy
// efekty rakiet (zadanie 19, src/3d/rockets/) budują coś w klatce gry: budowy NodeBuildera, moduły WGSL,
// pipeline'y renderu i compute, czasy klatek (odstęp wywołań Core3D.render i ich CPU) przed i po
// znacznikach. Rozgrzewka kroku „rakiety” (rocketFx._warm) i iskier idzie przy gotowym urządzeniu,
// więc po znaczniku nie powinno być ani jednej budowy.
//   node scripts/webgpu/rakiety-pierwsza.mjs [--out .tmp/webgpu/zadania/19/pierwsza] [--port 5347]
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, writeJson, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/19/pierwsza');
const port = Number(args.port || 5347);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
const IGNORE = [/favicon\.ico/, /AudioSys/, /Unable to decode audio data/, /powerPreference option is currently ignored/, /\[vite\]/, /DevTools/];

// Haki backendu: budowy NodeBuildera, programy WGSL, pipeline'y renderu i compute; czasy klatek.
const HAKI = `(() => {
  window.__rk1 = {
    events: [], frames: [],
    hook() {
      const C = window.Core3D; const r = C.renderer; const be = r.backend; const now = window.__harness.realNow;
      const evs = this.events;
      const nameOf = (m, o) => (m && (m.name || m.type)) || (o && (o.name || o.type)) || '?';
      const wrap = (obj, fn, label, nm) => {
        if (!obj || typeof obj[fn] !== 'function') return;
        const orig = obj[fn].bind(obj);
        obj[fn] = (...a) => { const t0 = now(); try { return orig(...a); } finally { evs.push({ co: label, nazwa: nm(...a), ms: +(now() - t0).toFixed(2), t: now() }); } };
      };
      const origNB = be.createNodeBuilder.bind(be);
      be.createNodeBuilder = (obj, rr) => {
        const b = origNB(obj, rr); const ob = b.build.bind(b);
        b.build = (...a) => { const t0 = now(); try { return ob(...a); } finally { evs.push({ co: 'NodeBuilder', nazwa: nameOf(b.material, obj), ms: +(now() - t0).toFixed(2), t: now() }); } };
        return b;
      };
      wrap(be, 'createRenderPipeline', 'pipeline renderu', (ro) => nameOf(ro?.material, ro?.object));
      wrap(be, 'createComputePipeline', 'pipeline compute', (p) => (p && (p.name || p.computeProgram?.name)) || '?');
      wrap(be, 'createProgram', 'program', (p) => (p && ((p.stage || '') + ' ' + (p.name || ''))) || '?');
      const fr = this.frames; const origRender = C.render; let last = now();
      C.render = function (...a) { const t0 = now(); const res = origRender.apply(this, a); fr.push({ t: t0, odstep: +(t0 - last).toFixed(2), cpu: +(now() - t0).toFixed(2) }); last = t0; return res; };
      return true;
    },
    mark(label) { this.events.push({ co: 'znacznik', nazwa: label, t: window.__harness.realNow() }); return window.__harness.realNow(); }
  };
})();`;

const quantile = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
const stat = (fs) => ({ klatki: fs.length, odstepMediana: +quantile(fs.map((f) => f.odstep), 0.5).toFixed(2),
  odstepP99: +quantile(fs.map((f) => f.odstep), 0.99).toFixed(2), odstepMaks: +Math.max(0, ...fs.map((f) => f.odstep)).toFixed(2),
  cpuMediana: +quantile(fs.map((f) => f.cpu), 0.5).toFixed(2), cpuMaks: +Math.max(0, ...fs.map((f) => f.cpu)).toFixed(2) });

mkdirSync(outDir, { recursive: true });
const { server, base } = await startVite(port);
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
let failed = false;
try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1919};\n${INJECT}\n${HAKI}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(true);
    DevFlags.globalShieldsOff = true;
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = ship; const made = [];
    const put = (k, x, y) => { const r = spawnCallInShip(k, { mode: 'pirate', spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: Math.PI }); for (const n of (Array.isArray(r) ? r : [r])) if (n) { n.ai = null; made.push(n); } };
    put('pirate_battleship', 4200, -150); put('destroyer', 3600, 1100);
    window.__rk1cele = made;
    S.cam(s.pos.x + 2000, s.pos.y, 0.3);
    for (let i = 0; i < 400 && !S.hullsReady(); i++) await H.frames(2);
    H.clock.mode = 'real'; return true; })()`, 300000);
  await sleep(4000);
  await ev('window.__rk1.hook()');
  await sleep(2500);
  const tSalwa = await ev(`(() => { const t = window.__rk1.mark('pierwsza salwa'); const W = MASTER_WEAPONS.missile_rack; const s = ship;
    for (let i = 0; i < 6; i++) rocketSystem3D.fire(s.pos.x + 250, s.pos.y + (i - 2.5) * 60, window.__rk1cele[i % 2], 1, W, 'blue', 0, 0);
    return t; })()`);
  await sleep(5000);
  const tNova = await ev(`(() => { const t = window.__rk1.mark('pierwsza Supernowa'); const c = window.__rk1cele[0];
    rocketSystem3D.fire(c.x - 2600, c.y - 400, c, 1, MASTER_WEAPONS.supernova_missile, 'blue', 0, 0); return t; })()`);
  await sleep(6000);
  const data = await ev('(() => ({ events: window.__rk1.events, frames: window.__rk1.frames, dym: window.__rocketFx?.smoke?.stats, mglawica: window.__rocketFx?.nebula?.highWater }))()');
  const okno = (t0, t1) => data.frames.filter((f) => f.t >= t0 && f.t < t1);
  const budowy = (t0, t1) => data.events.filter((e) => e.co !== 'znacznik' && e.t >= t0 && e.t < t1);
  const errors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
  const res = {
    przed: stat(okno(0, tSalwa)),
    salwa3s: stat(okno(tSalwa, tSalwa + 3000)), budowyPoSalwie: budowy(tSalwa, tNova),
    supernowa4s: stat(okno(tNova, tNova + 4000)), budowyPoSupernowej: budowy(tNova, Infinity),
    budowyPrzedZnacznikami: data.events.filter((e) => e.t < tSalwa).length,
    dym: data.dym, mglawica: data.mglawica, bledy: errors.slice(0, 20)
  };
  writeJson(join(outDir, 'pierwsza.json'), res);
  const fmt = (list) => (list.length ? list.map((e) => `${e.co} ${e.nazwa} ${e.ms} ms`).join(' ; ') : 'żadnych');
  console.log(`  przed:              ${JSON.stringify(res.przed)}`);
  console.log(`  pierwsza salwa 3 s: ${JSON.stringify(res.salwa3s)}`);
  console.log(`  budowy po salwie:   ${fmt(res.budowyPoSalwie)}`);
  console.log(`  Supernowa 4 s:      ${JSON.stringify(res.supernowa4s)}`);
  console.log(`  budowy po Supernowej: ${fmt(res.budowyPoSupernowej)}`);
  if (errors.length) { failed = true; console.log(`  BŁĘDY: ${errors.slice(0, 3).join(' ; ')}`); }
} catch (err) {
  failed = true;
  console.log(`BŁĄD: ${err.message}`);
} finally {
  await chrome.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
