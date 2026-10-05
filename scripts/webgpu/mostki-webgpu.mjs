// Harness dema mostków na WebGPU (dema/mostki-webgpu.html): headless Chrome na prawdziwym GPU (D3D12
// przez Dawn), klatki z zegarem ręcznym (?test=1 + __mostki2.runFrames).
//
//   node scripts/webgpu/mostki-webgpu.mjs --tryb test                  → wszystkie sceny: utrata
//                                        dowodzenia, wraki, modele, błędy WebGPU/WGSL/JS
//   node scripts/webgpu/mostki-webgpu.mjs --tryb zrzuty [--scena kill] [--kadlub battleship]
//                                        [--czasy 0.5,3,5,7] [--zoom 1.4 (zbliżenie na mostek)] [--czyste]
//   node scripts/webgpu/mostki-webgpu.mjs --tryb wydajnosc [--scena fleet --od 1 --klatek 240]
// Wyniki: .tmp/mostki-webgpu/<tryb>/*.png + wyniki.json. Rozmiar: --size 1600x900.
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, parseArgs, repo } from './wspolne.mjs';

const args = parseArgs();
const mode = args.tryb || 'zrzuty';
const [W, H] = String(args.size || '1600x900').split('x').map(Number);
const outDir = resolve(repo, args.out || `.tmp/mostki-webgpu/${mode}`);
mkdirSync(outDir, { recursive: true });
const port = Number(args.port || 5373);

const vite = await startVite(port);
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (expr, t = 600000) => evaluate(cdp, expr, t);
const results = { mode, size: [W, H], scenes: {} };

async function open(scene, extra = '') {
  const url = `${vite.base}/dema/mostki-webgpu.html?test=1&scene=${scene}${extra}`;
  await cdp.send('Page.navigate', { url });
  const ok = await waitFor(cdp, '!!(window.__mostki2 && (window.__mostki2.ready || window.__mostki2.error || document.getElementById("errors").textContent))', 180000);
  if (!ok) throw new Error(`demo nie wstało: ${scene}`);
  const err = await ev('window.__mostki2.error || document.getElementById("errors").textContent || null');
  if (err) throw new Error(`demo: ${err}`);
  // Scena od nowa przy właściwym rozmiarze okna (kadr liczony z szerokości).
  await ev(`window.__mostki2.scene(${JSON.stringify(scene)}, ${JSON.stringify(args.kadlub || null)})`);
  await ev('window.__mostki2.runFrames(2, 60).then(() => true)');
}

// Czas sceny do `t` (s, czas symulacji) klatkami 60 Hz. Każda klatka czeka na rAF: zegar efektów
// Core3D (światła, pule broni) idzie z klatką rAF — kilka renderów na jedną rAF zostawiało błyski
// żywe kilka razy dłużej (światła się kumulowały i przepalały kadr). `--szybko` — bez czekania.
async function advanceTo(t, fps = 60) {
  const now = await ev('window.__mostki2.sceneTime()');
  const scale = await ev('window.__mostki2.S.timeScale');
  const n = Math.max(0, Math.round((t - now) / Math.max(0.05, scale) * fps));
  if (n > 0) await ev(`window.__mostki2.runFrames(${n}, ${fps}, { realtime: ${args.szybko ? 'false' : 'true'} }).then(() => true)`);
}

async function shot(name) {
  await ev('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(true))))');
  return screenshotPng(cdp, resolve(outDir, `${name}.png`));
}

const SCENE_TIME = { kill: 9, atlas: 14, sever: 6, fleet: 10, close: 9, range: 2 };

try {
  if (mode === 'test') {
    for (const scene of ['kill', 'atlas', 'sever', 'fleet', 'close', 'range']) {
      logs.clear();
      const t0 = Date.now();
      await open(scene);
      await advanceTo(SCENE_TIME[scene]);
      const st = await ev('window.__mostki2.stats()');
      const errors = logs.errors().slice(0, 30);
      results.scenes[scene] = { ms: Date.now() - t0, stats: st, errors };
      console.log(`${scene.padEnd(6)} t ${st.t.toFixed(1)} s · utrat dowodzenia ${st.kills} · okręty ${st.ships} · wraki ${st.wrecks} · modele ${st.bridge3D.visible}/${st.bridge3D.records} · okna ${st.bridge3D.emitters} · łuki ${st.bridgeFx.arcs} · światła ${st.bridgeFx.lights} · błędów ${errors.length}`);
      for (const e of errors.slice(0, 6)) console.log('   ', e.slice(0, 300));
    }
  } else if (mode === 'zrzuty') {
    const scene = args.scena || 'kill';
    const times = String(args.czasy || '0.4,2.5,4.5,6,8').split(',').map(Number);
    await open(scene, args.czyste ? '&clean=1' : '');
    const shots = [];
    for (const t of times) {
      await advanceTo(t);
      if (args.zoom) {
        await ev(`window.__mostki2.focus(${Number(args.zoom)})`);
        await ev('window.__mostki2.runFrames(1, 60).then(() => true)');
      }
      const name = `${scene}${args.kadlub ? '-' + args.kadlub : ''}${args.zoom ? '-z' + args.zoom : ''}-t${t.toFixed(2).replace('.', '_')}`;
      shots.push(await shot(name));
      const st = await ev('window.__mostki2.stats()');
      console.log('  ', name, JSON.stringify(st.target?.bridges?.map((b) => `${b.alive}/${b.total}${b.dead ? ' X' : ''}`)), st.target?.hulk ? 'hulk' : '', `modele ${st.bridge3D.visible} okna ${st.bridge3D.emitters} łuki ${st.bridgeFx.arcs}`);
    }
    results.scenes[scene] = { shots, stats: await ev('window.__mostki2.stats()'), errors: logs.errors().slice(0, 30) };
    for (const e of results.scenes[scene].errors.slice(0, 10)) console.log('   ', e.slice(0, 300));
  } else if (mode === 'wydajnosc') {
    const scene = args.scena || 'fleet';
    await open(scene);
    await advanceTo(Number(args.od || 1));
    const frames = [];
    const n = Number(args.klatek || 240);
    for (let k = 0; k < n; k++) {
      const f = await ev(`(async () => {
        const t0 = performance.now();
        await window.__mostki2.runFrames(1, 60);
        const cpu = performance.now() - t0;
        await new Promise((ok) => requestAnimationFrame(() => ok()));
        const st = window.__mostki2.stats();
        return { t: st.t, cpu, gpu: st.render.gpu || 0, calls: st.render.calls || 0, b3: st.bridge3D.lastMs || 0, models: st.bridge3D.visible };
      })()`);
      frames.push(f);
    }
    results.frames = frames;
    const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
    const cpu = frames.map((f) => f.cpu), gpu = frames.map((f) => f.gpu), b3 = frames.map((f) => f.b3);
    console.log(`CPU klatki: mediana ${q(cpu, 0.5).toFixed(2)} ms, p95 ${q(cpu, 0.95).toFixed(2)}, max ${Math.max(...cpu).toFixed(2)}`);
    console.log(`GPU klatki: mediana ${q(gpu, 0.5).toFixed(2)} ms, p95 ${q(gpu, 0.95).toFixed(2)}`);
    console.log(`Bridge3D.update: mediana ${q(b3, 0.5).toFixed(3)} ms, p95 ${q(b3, 0.95).toFixed(3)} · modeli ${Math.max(...frames.map((f) => f.models))}`);
  }
} finally {
  results.logs = logs.errors().slice(0, 50);
  writeJson(resolve(outDir, 'wyniki.json'), results);
  await chrome.close();
  await vite.server.close();
}
