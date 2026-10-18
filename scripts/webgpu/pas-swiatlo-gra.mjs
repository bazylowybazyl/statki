// Światło objętościowe pasa asteroid w bitwie (2026-10-18, docs/AUDYT-render-worker-2026-10-17.md § 7.5): kernel
// `plastry` (`VOLUME_LIGHT_TUNE.slices`, src/3d/asteroids/volumetrics.js) kontra dawny kernel (wątek na kolumnę) —
// DOKŁADNOŚĆ (oba kernele na tych samych wejściach w tej samej klatce, odczyt całej tekstury ośrodka z GPU, porównanie
// słów; kontrola dawny ↔ dawny; --uklady — inne pary kolumny × plastry na wątek), ROZKŁAD PRACY (lustro CPU: światła
// komórki siatki na kolumnę, w zasięgu xy, trafienia na kolumnę), KOSZT (--koszt R: czas GPU kernela, warianty na
// przemian w zatrzymanej bitwie) i ZRZUTY A/B tej samej zatrzymanej klatki (z kontrolą szumu A ↔ A2).
//
//   node scripts/webgpu/pas-swiatlo-gra.mjs [--out .tmp/webgpu/pas-swiatlo] [--rozmiar 2560x1440] [--bok 24]
//        [--zoom 0.12] [--klatki 8] [--rozbieg 240] [--koszt 3 [--warianty 'kodA|kodB']] [--uklady 4x1,16x4]
//        [--inject 'kod przed wczytaniem strony']
//
// Bitwa bok × bok w gęstym polu (miejsce sceny „pole” dema asteroid), floty 3 km od siebie — ogień od pierwszych
// sekund; harness z wirtualnym zegarem (klatki na żądanie, małe obciążenie GPU). Co `--rozbieg / --klatki` klatek
// pomiar: w tej klatce oba kernele i odczyt tekstury (rgba f16 → f32, porównanie słów). Tryb gry `off`.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';
import { readPng } from './png.mjs';

// Piksele różne (maks. różnica kanału > próg) między dwoma zrzutami.
function pixelDiff(fa, fb, prog = 0) {
  const a = readPng(fa), b = readPng(fb);
  let n = 0, max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const m = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (m > prog) n++;
    if (m > max) max = m;
  }
  return { rozne: n, maks: max, piksele: a.width * a.height };
}

const args = parseArgs();
const [W, H] = (args.rozmiar || '2560x1440').split('x').map(Number);
const port = Number(args.port || 5361);
const outDir = resolve(repo, args.out || '.tmp/webgpu/pas-swiatlo');
const SIDE = Math.max(2, Number(args.bok || 24));
const ZOOM = Number(args.zoom || 0.12);
const SAMPLES = Math.max(1, Number(args.klatki || 8));
const WARM = Math.max(10, Number(args.rozbieg || 240));
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const SEED = 0x5eed1234;
const GRA_SWOBODNA = `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch (e) {}\n`;
const IGNORE = [/favicon\.ico/, /AudioSys/, /Unable to decode audio data/, /powerPreference option is currently ignored/, /\[vite\]/, /DevTools/, /GPU stall due to ReadPixels/];

// Strona: sonda z modułu przez serwer gry (ta sama instancja three / TSL co gra) — scripts/webgpu/pas-swiatlo-sonda.js.
const PAGE_SETUP = `(async () => {
  const m = await import('/scripts/webgpu/pas-swiatlo-sonda.js');
  const P = window.__pasSwiatlo = m.installVolumeProbe(window.__asteroidBelt, window.Core3D);
  P.uklady = ${JSON.stringify(String(args.uklady || '').split(',').filter(Boolean).map((u) => u.split('x').map(Number)))};
  return { NX: P.NX, NY: P.NY, NZ: P.NZ };
})()`;

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { server, base } = await startVite(port);
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 300000) => evaluate(cdp, e, t);
  const report = { when: new Date().toISOString(), rozmiar: `${W}x${H}`, bok: SIDE, zoom: ZOOM, probki: [] };
  try {
    await osobneLosowanieUuid(cdp);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `${GRA_SWOBODNA}${args.inject || ''}\nwindow.__HARNESS_SEED__ = ${SEED};\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
    await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
    if (!await waitFor(cdp, '!!(window.__asteroidBelt && window.__asteroidBelt.ready)', 120000, 400)) throw new Error('pas nie wstał');
    await ev('window.__harness.hold(true)');
    report.spawn = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(true); H.reseed(0x21a5);
      const W = await import('/dema/asteroidy-webgpu/world.js');
      const at = W.SPOTS.field; DevScene.teleport(at.x, at.y, 0);
      const s = ship; let n = 0;
      const put = (k, mode, x, y, a) => { const r = spawnCallInShip(k, { mode, spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a }); n += Array.isArray(r) ? r.length : (r ? 1 : 0); };
      const side = ${SIDE}, nb = Math.max(1, Math.round(side * 0.17)), nd = side - nb;
      for (let i = 0; i < nd; i++) put('destroyer', 'pirate', 3600 + (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, Math.PI);
      for (let i = 0; i < nb; i++) put('pirate_battleship', 'pirate', 6400, -(nb * 1300) + i * 2600, Math.PI);
      for (let i = 0; i < nd; i++) put('destroyer', 'friendly', 600 - (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, 0);
      for (let i = 0; i < nb; i++) put('battleship', 'friendly', -2400, -(nb * 1300) + i * 2600, 0);
      S.cam(s.pos.x + 2000, s.pos.y, ${ZOOM});
      for (let i = 0; i < 900 && !S.hullsReady(); i++) await H.frames(2);
      return n; })()`);
    report.setup = await ev(PAGE_SETUP);
    console.log('bitwa:', report.spawn, 'okrętów, tekstura ośrodka', report.setup);
    const every = Math.max(1, Math.floor(WARM / SAMPLES));
    for (let k = 0; k < SAMPLES; k++) {
      await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; await H.step(${every}); S.cam(ship.pos.x + 2000, ship.pos.y, ${ZOOM}); await H.step(1); return true; })()`);
      const cmp = await ev('window.__pasSwiatlo.compare()');
      const work = await ev('window.__pasSwiatlo.work()');
      const row = { klatka: (k + 1) * every, ...cmp, praca: work };
      report.probki.push(row);
      if (cmp.diff) console.log('    różnice:', JSON.stringify({ maxRel: cmp.maxRel, kanaly: cmp.kanaly, pierwszyPlaster: cmp.pierwszyPlaster, probki: cmp.probki }));
      console.log(`  ${row.klatka}: kolumny ${cmp.count}, różne słowa ${cmp.diff} z ${cmp.slow} (dawny ↔ dawny: ${cmp.kontrola}, układy: ${JSON.stringify(cmp.uklady)}; niezerowe rgb ${cmp.nonzero}) | światła ${work.swiatla} (maks. ${work.maxNaKomorke} w komórce), na kolumnę: w komórce ${work.srN} (maks. ${work.maxN}), w zasięgu xy ${work.srn}, bez rozpraszania ${work.bezRozpraszaniaNaKolumne}, trafienia ${work.plastryWZasiegu} (dawny kernel: ${work.pracaDawna} testów zasięgu)`);
    }
    // --koszt R: zatrzymany czas gry (klatki lecą, bitwa stoi), warianty na przemian co 2,5 s (0,5 s rozbiegu), R rund —
    // czas GPU kernela z kolektora passów (scripts/webgpu/gpu-passy-worker.js działa też na stronie). Headless bez limitu
    // klatek zawyża znaczniki 3–4 × — tylko stosunek wariantów; pomiar właściwy: rytm-bitwy.mjs w oknie 240 Hz.
    if (args.koszt) {
      const rounds = Math.max(1, Number(args.koszt) || 4);
      // --warianty 'kodA|kodB' — kod strony przy przełączeniu (P = sonda, V = VolumeLight); domyślnie dawny | plastry
      const VARIANTS = String(args.warianty || 'P.tune.slices = false;|P.tune.slices = true;').split('|');
      report.kolektor = await ev(readFileSync(join(repo, 'scripts/webgpu/gpu-passy-worker.js'), 'utf8'));
      await ev('(() => { window.__harness.hold(false); return true; })()');
      for (let r = 0; r < rounds; r++) {
        const ids = VARIANTS.map((_, i) => i);
        for (const v of r % 2 ? ids.reverse() : ids) {
          await ev(`(() => { globalThis.__gpcVariant = 9; const P = window.__pasSwiatlo, V = P.V; ${VARIANTS[v]} return true; })()`);
          await sleep(500);
          await ev(`(() => { globalThis.__gpcVariant = ${v}; return true; })()`);
          await sleep(2500);
        }
      }
      report.koszt = await ev(`(() => { const G = globalThis.__gpc, out = {};
        for (let v = 0; v < ${VARIANTS.length}; v++) { const c = G.cframes.filter((f) => f[1] === v); const r = G.frames.filter((f) => f[1] === v);
          const avg = (a) => a.length ? +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(4) : null;
          const med = (a) => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q); return +s[Math.floor(s.length / 2)].toFixed(4); };
          out['v' + v] = { n: c.length, swiatloPasa: avg(c.map((f) => f[4])), swiatloPasaMed: med(c.map((f) => f[4])), compute: avg(c.map((f) => f[5])), render: avg(r.map((f) => f[9])), swiatla: avg(r.map((f) => f[11])), maksNaKomorke: avg(r.map((f) => f[10])) }; }
        return out; })()`);
      report.warianty = VARIANTS;
      await ev('(() => { window.__harness.hold(true); window.__pasSwiatlo.tune.slices = true; globalThis.__gpcVariant = 0; return true; })()');
      console.log('koszt (headless, stosunek):', JSON.stringify(report.koszt));
    }
    // zrzuty A/B w zatrzymanej bitwie: nowy, dawny, nowy2, dawny2 (A↔B porównywać z szumem A↔A2)
    // czas gry stoi (zegar harnessu zamrożony, klatki na żądanie) — bez pauzy gry (nakładka pauzy zmienia kadr)
    // --uspokoj s (domyślnie 15): klatki przy stojącym czasie gry — warstwy skał, skóry kadłubów i efekty dochodzą do
    // stanu ustalonego (po 2,5 s kontrola tego samego kernela różniła się jeszcze o ~150 tys. pikseli)
    await ev('(() => { window.__harness.freeze(); window.__harness.hold(false); return true; })()');
    await sleep(Math.max(0, Number(args.uspokoj ?? 15)) * 1000);
    await ev('(() => { window.__harness.hold(true); return true; })()');
    await ev('window.__harness.frames(3)');
    for (const [tag, on] of [['nowy', true], ['dawny', false], ['nowy2', true], ['dawny2', false]]) {
      await ev(`(async () => { window.__pasSwiatlo.tune.slices = ${on}; await window.__harness.frames(2); return true; })()`);
      await screenshotPng(cdp, join(outDir, `ab-${tag}.png`));
    }
    const f = (t) => join(outDir, `ab-${t}.png`);
    report.zrzuty = { 'nowy-dawny': pixelDiff(f('nowy'), f('dawny')), 'nowy2-dawny2': pixelDiff(f('nowy2'), f('dawny2')),
      'kontrola nowy-nowy2': pixelDiff(f('nowy'), f('nowy2')), 'kontrola dawny-dawny2': pixelDiff(f('dawny'), f('dawny2')) };
    console.log('zrzuty A/B (piksele różne):', JSON.stringify(report.zrzuty));
    await ev('(() => { window.__pasSwiatlo.tune.slices = true; return true; })()');
    report.bledy = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l))).slice(0, 30);
  } finally {
    if (!report.bledy) report.logi = logs.all().slice(-60);
    writeFileSync(join(outDir, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
    await chrome.close();
    await server.close();
  }
  console.log('błędy konsoli:', report.bledy?.length ?? '?');
  console.log('gotowe:', outDir);
}

main().catch((e) => { console.error(e); process.exit(1); });
