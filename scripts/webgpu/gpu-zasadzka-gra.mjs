// GPU PRZY WYRWANIU Z WARPA (zasadzka misji 2 w pasie asteroid) przy rozdzielczości monitora użytkownika — tryb gracza
// (render w workerze). Zgłoszenie 2026-10-28: „podczas wyrwania z warpa też potrafi grubo spaść, z niewiadomych przyczyn
// poci się karta graficzna”. Scenariusz jak zasadzka-gra.mjs (skok dev ?story=ambush, TRAVEL TO prowadzi skok, zakłócacz
// wyrywa z warpa w pasie), pomiar jak gpu-baza-gra.mjs (sonda GPU workera, nvidia-smi, ślad Chrome).
//
//   node scripts/webgpu/gpu-zasadzka-gra.mjs [--rozmiar 5120x1440] [--out .tmp/gpu-zasadzka] [--zoom 0.11] [--walka 20]
//        [--slad 3] [--abWorker 'nazwa@kod##przywróć|…'] [--abPowt 2] [--query …]
//
// Okna: kurs (przed skokiem), warp (co 2 s w skoku), wyrwanie-N (co 2 s od wyrwania przez ~20 s: hamowanie, przylot
// piratów), walka-N (co 4 s, Atlas walczy sam, po --walka s zakłócacz zestrzelony), po-zasadzce. Ślad Chrome: w warpie,
// tuż po wyrwaniu, w walce. --abWorker: warianty kodu workera w PAUZIE w walce (jak gpu-baza-gra.mjs).
// Raport: <out>/raport.json (+ zrzuty PNG). Pomiar tylko przy wolnej maszynie.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';
import { SONDA_INSTALUJ, SONDA_CZYTAJ, startNvidiaSmi, stanMaszyny, sladWatkow } from './sondaGpuWorkera.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '5120x1440').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/gpu-zasadzka');
mkdirSync(out, { recursive: true });
const query = args.query ? `&${args.query}` : '';
const ZOOM = Number(args.zoom || 0.11);
const WALKA = Number(args.walka ?? 20);
const SLAD = Number(args.slad ?? 3);
const AB = String(args.abWorker || '').split('|').filter(Boolean).map((v) => {
  const i = v.indexOf('@');
  const [kod, przywroc] = v.slice(i + 1).split('##');
  return { nazwa: v.slice(0, i), kod, przywroc: przywroc || '' };
});
const AB_POWT = Number(args.abPowt || 2);
const tStart = Date.now();
const watchdog = setTimeout(() => { console.error('STRAŻNIK: przebieg > 12 min — koniec'); finish(2); }, 12 * 60 * 1000);

const report = { args, rozmiar: [W, H], maszynaStart: await stanMaszyny(), okna: [], slady: {}, zdarzenia: [], ab: [], wkLogi: [], bledy: [] };
console.log('maszyna:', JSON.stringify(report.maszynaStart));
const smi = startNvidiaSmi(500);
const { server, base } = await startVite(Number(args.port || 5394));
const chrome = await startChrome({ width: W, height: H, renderMode: 'worker' });
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const note = (co, extra = {}) => { const z = { s: +((Date.now() - tStart) / 1000).toFixed(1), co, ...extra }; report.zdarzenia.push(z); console.log(JSON.stringify(z)); };

const wk = { sid: null, id: 8000000 };
const wkSend = (method, params = {}, timeoutMs = 60000) => new Promise((ok, reject) => {
  if (!wk.sid) { reject(new Error('brak sesji workera')); return; }
  const id = ++wk.id;
  const timer = setTimeout(() => { cdp.pending.delete(id); reject(new Error(`limit ${method}`)); }, timeoutMs);
  cdp.pending.set(id, { ok: (r) => { clearTimeout(timer); ok(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  cdp.ws.send(JSON.stringify({ id, method, params, sessionId: wk.sid }));
});
const wkEval = async (expression) => {
  const r = await wkSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const ti = msg.params?.targetInfo;
    if (ti?.type === 'worker' && /render\.worker/.test(ti.url || '')) { wk.sid = msg.params.sessionId; wkSend('Runtime.enable').catch(() => {}); }
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.sessionId && msg.sessionId === wk.sid && report.wkLogi.length < 400) {
    report.wkLogi.push({ s: +((Date.now() - tStart) / 1000).toFixed(1), type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400) });
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

const SAMPLE = `(() => {
  const S = window.StoryGame, s = window.ship, w = window.warp, plan = S.ambushPlan, H = window.RenderWorkerHost;
  if (H && typeof H.readStats === 'function') H.readStats();
  const amb = (window.npcs || []).filter((n) => n && n.__storyTag === 'ambush');
  const alive = amb.filter((n) => !n.dead && n.hp > 0 && !n.warpedOut);
  const jam = amb.find((n) => n.__storyJammer);
  return { t: performance.now(), f: window.__frameId | 0, composed: H ? H.composed : -1, faza: S.phase, warp: w.state,
    hamowanie: !!w.gravityBrake?.active, v: Math.round(Math.hypot(s.vel.x, s.vel.y)), baner: S.ui.banner?.text || null,
    piraci: amb.length, zywi: alive.length, zaklocacz: jam ? (jam.dead || !(jam.hp > 0) ? 'zniszczony' : 'zyje') : null,
    domeny: H ? H.domainCount | 0 : -1, cpu: H ? +(H.stats[6] || 0).toFixed(2) : -1, gpu: H ? +(H.stats[0] || 0).toFixed(2) : -1 };
})()`;
const WK_FRAMES = `(() => {
  const f = globalThis.__rwFrameTimes;
  const n = f ? f.n : 0, from = Math.max(globalThis.__wkSeenN || 0, n - 8192);
  globalThis.__wkSeenN = n;
  const a = [];
  for (let i = from; i < n; i++) a.push(f.ms[i & 8191]);
  a.sort((x, y) => x - y);
  const q = (p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(2) : 0);
  return { n: a.length, p50: q(0.5), p95: q(0.95), max: a.length ? +a[a.length - 1].toFixed(1) : 0 };
})()`;

async function okno(label, sekundy, { slad = false } = {}) {
  const p0 = await ev(SAMPLE);
  await wkEval(WK_FRAMES).catch(() => null);
  await wkEval(SONDA_CZYTAJ).catch(() => null);
  const t0 = Date.now();
  await sleep(sekundy * 1000);
  const p1 = await ev(SAMPLE);
  const wf = await wkEval(WK_FRAMES).catch((e) => ({ err: e.message }));
  const so = await wkEval(SONDA_CZYTAJ).catch((e) => ({ err: e.message }));
  let sl = null;
  if (slad && SLAD > 0) {
    const licz = () => ev('(() => { const h = window.RenderWorkerHost; return { f: window.__frameId | 0, c: h ? h.composed : 0, t: performance.now() }; })()');
    sl = await sladWatkow(cdp, SLAD, licz).catch((e) => ({ blad: String(e) }));
    report.slady[label] = sl;
  }
  const dt = Math.max(1e-3, (p1.t - p0.t) / 1000);
  const row = { okno: label, s: +((Date.now() - tStart) / 1000).toFixed(1), dt: +dt.toFixed(2), faza: p1.faza, warp: p1.warp, v: p1.v,
    zlozeniaS: +((p1.composed - p0.composed) / dt).toFixed(1), klatkiStronyS: +((p1.f - p0.f) / dt).toFixed(1),
    workerKlatkiS: wf && !wf.err ? +(wf.n / dt).toFixed(1) : null, workerMs: wf, hudWorker: { cpu: p1.cpu, gpuRender: p1.gpu },
    domeny: p1.domeny, piraci: p1.zywi, nvidia: smi.okno(t0), sonda: so, slad: sl ? true : undefined };
  report.okna.push(row);
  const s = so && !so.err ? so : null;
  console.log(`${label.padEnd(14)} obraz ${String(row.zlozeniaS).padStart(6)}/s  wk ${String(row.workerKlatkiS).padStart(6)}/s  cpuWk p50 ${wf?.p50 ?? '-'}`
    + `  gpuR ${s ? s.gpuRender.msNaKlatke : '-'}  gpuC ${s ? s.gpuCompute.msNaKlatke : '-'}  kolejka śr ${s ? s.sr.lat : '-'} maks ${s ? s.latMax : '-'}`
    + `  wysyłki ${s ? ((s.sr.wbB + s.sr.wtB + s.sr.ceB) / 1024).toFixed(0) + ' KB' : '-'}  nowe ${s ? ((s.sr.nbB + s.sr.ntB) / 1024).toFixed(0) + ' KB' : '-'}`
    + `  pamięć ${s ? s.pamiecMB.bufory + '+' + s.pamiecMB.tekstury + ' MB' : '-'}  pipe s/a ${s ? s.suma.psync + '/' + s.suma.pasync : '-'}  warp ${row.warp}  GPU% ${row.nvidia ? row.nvidia.zajetosc : '-'}`);
  if (s) {
    console.log('   render:', s.gpuRender.wiersze.slice(0, 6).map((w) => `${w[0]} ${w[1]}`).join(' | '));
    console.log('   compute:', s.gpuCompute.wiersze.slice(0, 6).map((w) => `${w[0]} ${w[1]}`).join(' | '));
  }
  if (sl && !sl.blad) console.log('   ślad: zajętość', JSON.stringify(sl.zajetosc), 'top GPU:', sl.topGpuMain.slice(0, 5).map((r) => `${r[0]} ${r[1]}ms/${r[2]}`).join(' | '));
  return row;
}

function finish(code = 0) {
  try { smi.stop(); writeJson(join(out, 'raport.json'), report); } catch (e) { console.error(e); }
  Promise.resolve(chrome.close?.()).finally(() => Promise.resolve(server.close?.()).finally(() => process.exit(code)));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=ambush${query}` });
  if (!await waitFor(cdp, '!!(window.ship && window.StoryGame && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && window.StoryGame.active && window.StoryGame.phase === 'ambush' && !!window.StoryGame.ambushPlan", 300000, 300)) throw new Error('brak fazy ambush');
  for (let i = 0; i < 40 && !wk.sid; i++) await sleep(250);
  if (!wk.sid) throw new Error('bez workera renderu — narzędzie mierzy tryb gracza');
  await ev(`(window.RenderWorkerHost.dev({ eval: 'globalThis.__C3 = Core3D; globalThis.__ST = st;' }), true)`);
  let inst = '';
  for (let i = 0; i < 20 && inst !== 'ok' && inst !== 'już'; i++) { await sleep(500); inst = await wkEval(SONDA_INSTALUJ).catch((e) => e.message); }
  console.log('sonda:', inst);
  await ev(`(() => { setInterval(() => { const s = window.ship; if (s?.shield) s.shield.val = s.shield.max; if (s && s.maxHp) s.hp = s.maxHp; }, 250); return true; })()`);
  await okno('kurs', 3);
  await screenshotPng(cdp, join(out, '10-kurs.png'));
  // skok (TRAVEL TO prowadzi) — okna co 2 s w warpie aż do wyrwania
  let warpN = 0, pulled = null;
  const tw = Date.now();
  while (Date.now() - tw < 60000) {
    const p = await ev(SAMPLE);
    if (p.faza !== 'ambush' || (p.warp === 'idle' && (p.hamowanie || /ZASADZKA/.test(p.baner || '')))) { if (warpN > 0) { pulled = p; break; } }
    if (p.warp === 'active') { warpN++; await okno(`warp-${warpN}`, 2, { slad: warpN === 2 }); if (warpN === 1) await screenshotPng(cdp, join(out, '20-warp.png')); }
    else await sleep(150);
  }
  if (!pulled) throw new Error('brak wyrwania z warpa');
  note('wyrwanie', { v: pulled.v, baner: pulled.baner });
  await screenshotPng(cdp, join(out, '30-wyrwanie.png'));
  await ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${ZOOM}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${ZOOM}; return true; })()`);
  for (let i = 1; i <= 10; i++) await okno(`wyrwanie-${i}`, 2, { slad: i === 1 });
  await screenshotPng(cdp, join(out, '40-po-wyrwaniu.png'));
  // walka wśród skał — Atlas walczy sam; po WALKA s zakłócacz zestrzelony, po WALKA + 15 s reszta
  const tf = Date.now();
  let killedJam = false, killedAll = false, n = 0;
  while ((Date.now() - tf) / 1000 < WALKA + 40) {
    n++;
    const row = await okno(`walka-${n}`, 4, { slad: n === 2 });
    const el = (Date.now() - tf) / 1000;
    if (n === 2) await screenshotPng(cdp, join(out, '50-walka.png'));
    if (n === 2 && AB.length) {
      await ev('(window.__setGamePaused(true), true)');
      await sleep(1000);
      for (let r = 0; r < AB_POWT; r++) {
        for (const v of [{ nazwa: 'baza', kod: '', przywroc: '' }, ...AB]) {
          if (v.kod) await wkEval(`(() => { const Core3D = globalThis.__C3, st = globalThis.__ST; ${v.kod}; return true; })()`).catch((e) => console.log('ab', v.nazwa, e.message));
          await sleep(1200);
          const a = await okno(`ab-${v.nazwa}-${r}`, 3);
          report.ab.push({ wariant: v.nazwa, r, gpuR: a.sonda?.gpuRender?.msNaKlatke, gpuC: a.sonda?.gpuCompute?.msNaKlatke, lat: a.sonda?.sr?.lat, wk: a.workerKlatkiS, obraz: a.zlozeniaS, nv: a.nvidia?.zajetosc });
          if (v.przywroc) await wkEval(`(() => { const Core3D = globalThis.__C3, st = globalThis.__ST; ${v.przywroc}; return true; })()`).catch((e) => console.log('ab przywróć', v.nazwa, e.message));
        }
      }
      await ev('(window.__setGamePaused(false), true)');
    }
    if (row.faza !== 'ambush') { note('po zasadzce', { faza: row.faza }); break; }
    if (!killedJam && el > WALKA) { killedJam = true; await ev(`(() => { for (const n of window.npcs || []) if (n && n.__storyTag === 'ambush' && n.__storyJammer && !n.dead && n.hp > 0) window.StoryGame.deps.killNpc(n); return true; })()`); note('zakłócacz zestrzelony'); }
    if (!killedAll && el > WALKA + 15) { killedAll = true; await ev(`(() => { for (const n of window.npcs || []) if (n && n.__storyTag === 'ambush' && !n.dead && n.hp > 0) window.StoryGame.deps.killNpc(n); return true; })()`); note('reszta zestrzelona'); }
  }
  await okno('po-zasadzce', 4);
} catch (err) {
  console.error(err);
  report.bledy.push(String(err?.stack || err));
} finally {
  clearTimeout(watchdog);
  for (const l of report.wkLogi.filter((l) => /warn|error|exception|pipeline sync|kompilacja w grze/.test(l.type + ' ' + l.text)).slice(0, 20)) console.log('  wk', l.type, l.s, l.text.slice(0, 220));
  console.log('raport:', join(out, 'raport.json'));
  finish(0);
}
