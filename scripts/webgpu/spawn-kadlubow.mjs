// Koszt spawnu kadłubów NPC (port WebGPU, zadanie 04 — „graf na wariant zamiast materiału
// na encję”): gra z ?dev, 30 niszczycieli w kadrze naraz, potem klatka po klatce (zegar
// wirtualny harnessu, tryb hold) aż wszystkie kadłuby są narysowane. Mierzy prawdziwym
// zegarem: CPU Core3D.render każdej klatki (tu powstają obiekty renderu, stany NodeBuildera
// i pipeline'y nowych materiałów) i czas całej klatki strony.
//
//   node scripts/webgpu/spawn-kadlubow.mjs [--port 5344] [--ile 30] [--powtorz 3] [--out plik.json]
//
// Wynik (mediana z powtórzeń): klatki do zbudowania wszystkich kadłubów (beamHull — budżet
// initHexBody na klatkę) i do narysowania wszystkich (siatki w kadrze), suma CPU Core3D.render
// i czasu klatek w tym oknie, maks. klatka, CPU renderu pierwszej klatki z nowym kadłubem
// i pierwszej klatki po spawnie całej floty.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, waitFor, evaluate, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5344);
const COUNT = Math.max(1, Number(args.ile || 30));
const REPEATS = Math.max(1, Number(args.powtorz || 3));
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

async function once(base) {
  const chrome = await startChrome({ width: 1920, height: 1080 });
  const { cdp } = chrome;
  const ev = (e, t = 300000) => evaluate(cdp, e, t);
  try {
    await osobneLosowanieUuid(cdp);
    // --skrypt plik.js: dodatkowy kod przed skryptami strony (np. przełącznik eksperymentu).
    const extra = args.skrypt ? readFileSync(resolve(repo, args.skrypt), 'utf8') : '';
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${extra}\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
    await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
    if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
    await ev('window.__harness.hold(true)');
    return await ev(`(async () => {
      const S = window.__harness.scene, H = window.__harness, C = window.Core3D, now = H.realNow;
      S.hideHud(true);
      DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
      S.cam(ship.pos.x + 3000, ship.pos.y, 0.12);
      await H.frames(30);
      const orig = C.render;
      let renderMs = 0;
      C.render = function (...a) { const t0 = now(); const r = orig.apply(this, a); renderMs += now() - t0; return r; };
      const frames = [];
      const step = async () => {
        renderMs = 0;
        const t0 = now();
        await H.frames(1);
        const lod = window.__hexLodStats || {};
        const npc = (window.npcs || []).filter((n) => !n.dead && n.__spawnKadlub);
        frames.push({ klatka: +(now() - t0).toFixed(3), render: +renderMs.toFixed(3),
          kadluby: npc.filter((n) => n.beamHull).length, rysowane: lod.fullBodies || 0 });
      };
      // Dwie klatki bazowe przed spawnem.
      await step(); await step();
      const base = frames.length;
      const bodiesBefore = frames[base - 1].rysowane;
      const t0 = now();
      const s = ship;
      for (let i = 0; i < ${COUNT}; i++) {
        const r = spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: { x: s.pos.x + 800 + (i % 6) * 900, y: s.pos.y - 2400 + Math.floor(i / 6) * 1100 }, spawnAngle: 0 });
        for (const n of (Array.isArray(r) ? r : [r])) if (n) n.__spawnKadlub = true;
      }
      const spawnCallMs = now() - t0;
      let allBuilt = -1, allDrawn = -1, firstNew = -1;
      for (let k = 0; k < 600; k++) {
        await step();
        const f = frames[frames.length - 1];
        const idx = frames.length - 1 - base;
        if (firstNew < 0 && f.rysowane > bodiesBefore) firstNew = idx;
        if (allBuilt < 0 && f.kadluby >= ${COUNT}) allBuilt = idx;
        if (allDrawn < 0 && f.rysowane >= bodiesBefore + ${COUNT}) { allDrawn = idx; }
        if (allDrawn >= 0 && idx >= allDrawn + 5) break;
      }
      C.render = orig;
      const win = frames.slice(base, base + (allDrawn >= 0 ? allDrawn + 1 : frames.length - base));
      const sum = (a, k) => a.reduce((x, f) => x + f[k], 0);
      const beforeRender = frames.slice(0, base).map((f) => f.render);
      return {
        spawnCallMs: +spawnCallMs.toFixed(2),
        klatekDoZbudowania: allBuilt + 1, klatekDoNarysowania: allDrawn + 1,
        sumaRenderMs: +sum(win, 'render').toFixed(2), sumaKlatekMs: +sum(win, 'klatka').toFixed(2),
        maksRenderMs: +Math.max(...win.map((f) => f.render)).toFixed(2), maksKlatkaMs: +Math.max(...win.map((f) => f.klatka)).toFixed(2),
        renderPierwszegoKadluba: firstNew >= 0 ? frames[base + firstNew].render : null,
        renderPoSpawnie: frames[base].render, renderPrzed: beforeRender,
        renderPoNarysowaniu: frames.slice(base + allDrawn + 1).map((f) => f.render),
        klatki: frames.slice(base)
      };
    })()`);
  } finally {
    await chrome.close();
  }
}

const { server, base } = await startVite(port);
const runs = [];
try {
  for (let i = 0; i < REPEATS; i++) {
    const r = await once(base);
    runs.push(r);
    console.log(`przebieg ${i + 1}: do zbudowania ${r.klatekDoZbudowania} kl., do narysowania ${r.klatekDoNarysowania} kl., ` +
      `Σ render ${r.sumaRenderMs} ms, Σ klatek ${r.sumaKlatekMs} ms, maks render ${r.maksRenderMs} ms, ` +
      `render 1. kadłuba ${r.renderPierwszegoKadluba} ms, po spawnie ${r.renderPoSpawnie} ms, po narysowaniu ${r.renderPoNarysowaniu.join(' ')}`);
  }
} finally {
  await server.close();
}
const med = (k) => { const v = runs.map((r) => r[k]).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const summary = Object.fromEntries(['klatekDoZbudowania', 'klatekDoNarysowania', 'sumaRenderMs', 'sumaKlatekMs', 'maksRenderMs', 'maksKlatkaMs', 'renderPierwszegoKadluba', 'renderPoSpawnie', 'spawnCallMs'].map((k) => [k, med(k)]));
console.log('mediana:', JSON.stringify(summary));
if (args.out) writeFileSync(resolve(repo, args.out), JSON.stringify({ ile: COUNT, mediana: summary, przebiegi: runs }, null, 1) + '\n');
process.exit(0);
