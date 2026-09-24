// Walidacja lustra solvera sprężyn (dema/rdzen-softbody-cpu.js) na prawdziwym
// WebGPU: ta sama seria strzałów w demie z solverem GPU i z lustrem CPU, na
// zegarze ręcznym (runFrames) — klatki po 1/fps czasu gry, bo solver GPU liczy
// dispatch na klatkę, a headless Chrome bez limitu chodzi po ~700 FPS.
//   node dema/rdzen-gpu-check.js [--seconds 20] [--weapons beam_continuous,...]
//   node dema/rdzen-gpu-check.js --until 250   → ogień do STOPIENIA (≤ 250 s gry):
//        trafienia do ODSŁONIĘCIA / KRYTYCZNEGO / STOPIENIA, GPU@60 vs lustro CPU@60
// Wynik: .tmp/rdzen/gpu-check.json (albo gpu-check-until.json)
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startChrome, startVite, evaluate, navigateAndWait, sleep, repo } from './rdzen-cdp.js';

const argv = process.argv.slice(2);
const arg = (n, f = null) => { const i = argv.indexOf(`--${n}`); return i < 0 ? f : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '1'); };
const seconds = Number(arg('seconds', 20));
const until = arg('until') ? Number(arg('until')) : 0;
const weapons = (arg('weapons') || (until ? 'special_valkyrie_railgun,special_yamato_cannon' : 'beam_continuous,heavy_autocannon,special_valkyrie_railgun')).split(',');
const hullScene = arg('hull', 'battleship');
// wait = czekanie na odczyt GPU po każdej klatce (jak w grze przy 16,7 ms klatki),
// legacy = okna sond i solver sprzed poprawki heksów-duchów (A/B).
const MODES = until ? [
  { id: 'gpu@60', cpu: false, fps: 60, wait: false, legacy: false },
  { id: 'gpu@60 czekaj', cpu: false, fps: 60, wait: true, legacy: false },
  { id: 'cpu@60', cpu: true, fps: 60, wait: false, legacy: false }
] : [
  { id: 'gpu@60', cpu: false, fps: 60, wait: false, legacy: false },
  { id: 'gpu@60 czekaj', cpu: false, fps: 60, wait: true, legacy: false },
  { id: 'cpu@60', cpu: true, fps: 60, wait: false, legacy: false },
  { id: 'gpu@144 czekaj', cpu: false, fps: 144, wait: true, legacy: false },
  { id: 'cpu@144', cpu: true, fps: 144, wait: false, legacy: false },
  { id: 'gpu@60 czekaj, sprzed poprawki', cpu: false, fps: 60, wait: true, legacy: true }
];
const RANK = { nominal: 0, exposed: 1, critical: 2, meltdown: 3, detonated: 4 };
const outDir = resolve(repo, '.tmp/rdzen');
mkdirSync(outDir, { recursive: true });

const vite = await startVite(5271);
const ch = await startChrome({ width: 1280, height: 720 });
const ev = (expr) => evaluate(ch.cdp, expr, 600000);
const rows = [];
try {
  for (const weaponId of weapons) {
    for (const mode of MODES) {
      const url = `${vite.base}/dema/rdzen-demo.html?scene=${hullScene}&shot=1&weapon=${weaponId}${mode.cpu ? '&cpuSoft=1' : ''}`;
      if (!await navigateAndWait(ch.cdp, url, '!!(window.__rdzen && window.__rdzen.ready)', 120000)) throw new Error('demo nie wstało');
      // WebGPU wstaje asynchronicznie po pierwszym ticku solvera
      let solver = '';
      for (let i = 0; i < 40; i++) {
        solver = await ev('window.__rdzen.summary().softBody');
        if (mode.cpu || solver === 'gpu') break;
        await sleep(150);
      }
      await ev(`(() => { const R = window.__rdzen; R.setOpt('hp-off', true); R.setOpt('legacy-probes', ${mode.legacy}); R.setOpt('lock', true); R.setOpt('autofire', true); R.S.stats.hullHits = 0; R.S.stats.hullDamage = 0; return true; })()`);
      const t0 = await ev('window.__rdzen.S.simTime');
      const c0 = await ev('window.__rdzen.solverCounters()');
      const wall0 = Date.now();
      const rf = `{ waitGpu: ${mode.wait} }`;
      const reached = {};
      if (until) {
        // po sekundzie gry: zapis trafień przy pierwszym wejściu w każdy stan
        for (let s = 0; s < until; s++) {
          const st = await ev(`window.__rdzen.runFrames(${mode.fps}, ${mode.fps}, ${rf}).then(() => { const R = window.__rdzen; const c = R.S.ships[0].shipCores[0]; return { state: c.state, hits: R.S.stats.hullHits || 0, t: R.S.simTime, hexAlive: R.S.ships[0].hexGrid.activeStructuralCount }; })`);
          for (const k of ['exposed', 'critical', 'meltdown']) {
            if (!reached[k] && RANK[st.state] >= RANK[k]) reached[k] = { hits: st.hits, t: +(st.t - t0).toFixed(1), hexesLost: null, hexAlive: st.hexAlive };
          }
          if (reached.meltdown) break;
        }
      } else {
        await ev(`window.__rdzen.runFrames(${Math.round(seconds * mode.fps)}, ${mode.fps}, ${rf}).then(() => true)`);
      }
      const out = await ev(`(() => { const R = window.__rdzen; R.setOpt('autofire', false); const s = R.S.ships[0]; const c = s.shipCores[0]; return { simTime: R.S.simTime, hits: R.S.stats.hullHits || 0, damage: Math.round(R.S.stats.hullDamage || 0), hexTotal: s.hexGrid.shards.length, hexAlive: s.hexGrid.activeStructuralCount, maxDrift: +(s.hexGrid._maxHexDrift || 0).toFixed(1), core: { state: c.state, integrity: +c.integrity.toFixed(3), dead: c.deadCount } }; })()`);
      const simSec = out.simTime - t0;
      const c1 = await ev('window.__rdzen.solverCounters()');
      const solverPerSec = +(((mode.cpu ? c1.cpuDispatches - c0.cpuDispatches : c1.gpuApplied - c0.gpuApplied)) / Math.max(1e-6, simSec)).toFixed(1);
      const row = { weaponId, mode: mode.id, solver, simSec: +simSec.toFixed(2), wallSec: +((Date.now() - wall0) / 1000).toFixed(1), solverPerSec, ...out, hexesLost: out.hexTotal - out.hexAlive, reached };
      for (const k of Object.keys(reached)) reached[k].hexesLost = out.hexTotal - reached[k].hexAlive;
      rows.push(row);
      if (until) console.log(`  → ${Object.entries(reached).map(([k, v]) => `${k}: ${v.hits} tr / ${v.t} s / -${v.hexesLost} heksów`).join(' · ') || 'nic'}`);
      console.log(`${weaponId.padEnd(26)} ${mode.id.padEnd(31)} solver=${String(solver).padEnd(4)} kroków/s ${String(solverPerSec).padStart(5)}  sim ${simSec.toFixed(1)} s  trafień ${String(out.hits).padStart(5)}  heksów -${String(row.hexesLost).padStart(4)}  dryf max ${String(out.maxDrift).padStart(5)}  komora ${out.core.state} ${Math.round(out.core.integrity * 100)}% (${out.core.dead} martwych)  [${row.wallSec} s]`);
    }
  }
} finally {
  writeFileSync(resolve(outDir, until ? `gpu-check-until-${hullScene}.json` : 'gpu-check.json'), JSON.stringify({ seconds, rows, logs: ch.logs.filter((l) => /error|exception/i.test(l)).slice(0, 20) }, null, 2));
  await ch.close();
  await vite.server.close();
}
