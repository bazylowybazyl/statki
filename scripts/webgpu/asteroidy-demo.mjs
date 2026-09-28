// Zrzuty DEMA dema/asteroidy-webgpu.html w miejscach i zoomie scen pola gry (zadanie 21):
// odniesienie do scen `asteroidy-gra.mjs` / `zrzuty.mjs` (pole, noc, burza, olbrzym).
// Demo liczy się klatkami ręcznymi (`__demo.step`, pętla rAF zatrzymana), UI schowane
// (`?shot=1`), eskorta wyłączona (w grze scena ma samego gracza), flary pola wyłączone
// (demo dopełnia nimi liczbę świateł — gra ich nie ma).
//
//   node scripts/webgpu/asteroidy-demo.mjs [--out katalog] [--port 5356] [--sceny pole,noc,burza,olbrzym] [--rozmiar 1920x1080]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const port = Number(args.port || 5356);
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/21/demo');

// scena gry → scena dema i przygotowanie (kamera = statek, bez eskorty jak w grze)
const DEMO_SCENES = {
  pole: { scene: 'field', zoom: 1.0 },
  noc: { scene: 'deep', zoom: 0.6 },
  burza: { scene: 'storm', zoom: 0.4, burza: true },
  olbrzym: { scene: 'giantField', zoom: 0.3 }
};

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { server, base } = await startVite(port);
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 240000) => evaluate(cdp, e, t);
  const report = { when: new Date().toISOString(), sceny: [] };
  try {
    const only = args.sceny ? new Set(args.sceny.split(',')) : null;
    for (const [id, sc] of Object.entries(DEMO_SCENES)) {
      if (only && !only.has(id)) continue;
      logs.clear();
      await cdp.send('Page.navigate', { url: `${base}/dema/asteroidy-webgpu.html?scene=${sc.scene}&shot=1&lights=0` });
      if (!await waitFor(cdp, '!!(window.__demo && window.__demo.S.ready)', 240000, 400)) throw new Error('demo nie wstało');
      await ev(`(() => { const d = window.__demo; d.stopLoop(); d.S.showEscort = false; d.S.dynLights = true; d.setLights(0); d.setZoom(${sc.zoom}); d.S.hideUi = true; document.body.classList.add('shot'); return true; })()`);
      if (sc.scene === 'giantField') {
        await waitFor(cdp, `(() => { const d = window.__demo; const st = d.giantState.get(d.FIELD_GIANTS[0]); return !!(st && st.view); })()`, 240000, 500);
      }
      // Klatki: komórki pola, ośrodek, mapy cienia (kamera stoi na statku).
      await ev(`(() => { const d = window.__demo; d.S.cam.x = d.S.ship.x; d.S.cam.y = d.S.ship.y; d.step(40, 1 / 60); return true; })()`);
      if (sc.burza) {
        await ev(`(() => { const d = window.__demo; const s = d.S.ship; return d.strike(s.x + Math.cos(s.angle) * 1400, s.y + Math.sin(s.angle) * 1400); })()`);
        await ev(`(() => { window.__demo.step(20, 1 / 60); return true; })()`);
      }
      await ev(`(() => { window.__demo.step(2, 1 / 60); return true; })()`);
      const png = join(outDir, `${id}.png`);
      await screenshotPng(cdp, png);
      const stats = await ev('window.__demo.stats()');
      const pos = await ev('(() => { const d = window.__demo; return { statek: [Math.round(d.S.ship.x), Math.round(d.S.ship.y), +d.S.ship.angle.toFixed(3)], kamera: [Math.round(d.S.cam.x), Math.round(d.S.cam.y), d.S.cam.zoom] }; })()');
      const errors = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l));
      report.sceny.push({ scena: id, demo: sc.scene, stats, pos, bledy: errors.slice(0, 20) });
      console.log(`  ${id.padEnd(8)} ${sc.scene.padEnd(10)} | skały ${stats.rocks} | światła ${stats.lights} | mapy ${stats.shadowMaps} | GPU ${stats.gpuMs} ms | statek ${pos.statek.join(', ')} | błędy ${errors.length}`);
    }
  } finally {
    writeFileSync(join(outDir, 'wynik.json'), JSON.stringify(report, null, 2) + '\n');
    await chrome.close();
    await server.close();
  }
  console.log('gotowe:', outDir);
}

main().catch((err) => { console.error(err); process.exit(1); });
