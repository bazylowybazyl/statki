// Zrzuty DEMA dema/asteroidy-webgpu.html w miejscach i zoomie scen pola gry (zadanie 21):
// odniesienie do scen `asteroidy-gra.mjs` / `zrzuty.mjs` (pole, noc, burza, olbrzym).
// Demo liczy się klatkami ręcznymi (`__demo.step`, pętla rAF zatrzymana), UI schowane
// (`?shot=1`), eskorta wyłączona (w grze scena ma samego gracza), flary pola wyłączone
// (demo dopełnia nimi liczbę świateł — gra ich nie ma).
//
//   node scripts/webgpu/asteroidy-demo.mjs [--out katalog] [--port 5356] [--sceny pole,noc,burza,olbrzym] [--rozmiar 1920x1080]
//
// --tryb typy (A1 / A2 pasa realistycznego, docs/PLAN-pas-realizm.md): galeria typów skał (przegląd,
// dystans, zbliżenia nowych typów C / M / V / D / platynowce / wypełniacz węglowy obok dawnych),
// scena „gradient” — przystanki od wewnętrznego pasa po Kuipera ze składem kadru — i scena „families”
// — pole każdej rodziny kolizyjnej z nazwą i składem (wynik.json):
//   node scripts/webgpu/asteroidy-demo.mjs --tryb typy --out .tmp/pas-typy/demo
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';
import { STORM_STAGE } from './asteroidy-gra.mjs';

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
        // Burza powtarzalna — ten sam kod co w grze (STORM_STAGE z asteroidy-gra.mjs).
        await ev(`(async () => { const d = window.__demo; const s = d.S.ship;
          const sim = d.storm.sim; const sx = s.x, sy = s.y, sa = s.angle;
          const force = (x, y) => d.strike(x, y);
          ${STORM_STAGE} })()`);
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

// Galeria typów i skład pasa wg odległości (A1).
async function mainTypes() {
  const out = resolve(repo, args.out || '.tmp/pas-typy/demo');
  mkdirSync(out, { recursive: true });
  const { server, base } = await startVite(port);
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 240000) => evaluate(cdp, e, t);
  const report = { when: new Date().toISOString(), galeria: [], gradient: [] };
  const open = async (scene) => {
    logs.clear();
    await cdp.send('Page.navigate', { url: `${base}/dema/asteroidy-webgpu.html?scene=${scene}&shot=1&lights=0` });
    if (!await waitFor(cdp, '!!(window.__demo && window.__demo.S.ready)', 240000, 400)) throw new Error('demo nie wstało');
    await ev(`(() => { const d = window.__demo; d.stopLoop(); d.S.showEscort = false; d.S.hideUi = true; document.body.classList.add('shot'); return true; })()`);
  };
  const shot = async (name, frames = 30) => {
    await ev(`(() => { window.__demo.step(${frames}, 1 / 60); return true; })()`);
    const png = join(out, `${name}.png`);
    await screenshotPng(cdp, png);
    return png;
  };
  try {
    // Galeria: przegląd (bliski dystans), daleki dystans, zbliżenia komórek.
    await open('gallery');
    await shot('galeria-przeglad', 40);
    const cells = await ev('window.__demo.galleryCells.map((c) => c.label)');
    await ev(`(() => { const d = window.__demo; d.setZoom(0.05); return true; })()`);
    await shot('galeria-dystans', 30);
    const want = new Set(['węglowa', 'metaliczna', 'bazaltowa', 'prymitywna', 'platynowce', 'skała neutralna (węglowa)', 'skała neutralna', 'krzem', 'żelazo', 'lód', 'węglowa z lodem']);
    for (let i = 0; i < cells.length; i++) {
      if (!want.has(cells[i])) continue;
      await ev(`(() => { const d = window.__demo; d.focusGallery(${i}); const g = d.S.camGoal; d.S.cam.x = g.x; d.S.cam.y = g.y; d.S.cam.zoom = d.S.targetZoom; return true; })()`);
      const png = await shot(`typ-${String(i).padStart(2, '0')}`, 30);
      report.galeria.push({ i, typ: cells[i], png });
      console.log(`  galeria ${String(i).padStart(2)} ${cells[i]}`);
    }
    // Skład pasa: przystanki sceny „gradient”.
    await open('gradient');
    const n = await ev('window.__demo.gradient.stops.length');
    for (let i = 0; i < n; i++) {
      await ev(`(() => { window.__demo.gradient.go(${i}); return true; })()`);
      const png = await shot(`gradient-${i}`, 40);
      const info = await ev(`(() => { const d = window.__demo; const c = d.gradient.composition(); return { stop: d.gradient.stops[${i}].label, n: c.n, typy: c.types.slice(0, 8).map((t) => t.type + ' ' + Math.round(t.share * 100) + '%') }; })()`);
      report.gradient.push({ ...info, png });
      console.log(`  gradient ${i}: ${info.stop} | ${info.n} skał | ${info.typy.join(', ')}`);
    }
    // Rodziny kolizyjne (A2): pole każdej rodziny (scena „families”), skład kadru i nazwa.
    report.rodziny = [];
    await open('families');
    const nf = await ev('window.__demo.families.stops().length');
    for (let i = 0; i < nf; i++) {
      const id = await ev(`(() => { const d = window.__demo; d.families.go(${i}); return d.families.stops()[${i}].fam.id; })()`);
      const png = await shot(`rodzina-${id}`, 40);
      const info = await ev(`(() => { const d = window.__demo; const st = d.families.stops()[${i}]; const c = d.gradient.composition(); return { rodzina: d.families.title(st.fam), n: c.n, typy: c.types.slice(0, 8).map((t) => t.type + ' ' + Math.round(t.share * 100) + '%') }; })()`);
      report.rodziny.push({ id, ...info, png });
      console.log(`  rodzina ${id}: ${info.rodzina} | ${info.n} skał | ${info.typy.join(', ')}`);
    }
    report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
    if (report.bledy.length) console.log('  błędy konsoli:', report.bledy);
  } finally {
    writeFileSync(join(out, 'wynik.json'), JSON.stringify(report, null, 2) + '\n');
    await chrome.close();
    await server.close();
  }
  console.log('gotowe:', out);
}

(args.tryb === 'typy' ? mainTypes() : main()).catch((err) => { console.error(err); process.exit(1); });
