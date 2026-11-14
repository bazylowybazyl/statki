// Sekwencja zrzutów rakiety „Niszczyciel” w demie rakiet WebGPU (dema/rakiety-webgpu.html): jedno ładowanie
// strony, demo krokowane synchronicznie (`window.__demo.step(n, dt)` w pauzie), kadry przy zdarzeniach lotu
// i wybuchu — zawis nad wyrzutnią, zapłon, przelot członem startowym, start sprintu, wejście w kadłub,
// wybuch wybranej głowicy w kolejnych chwilach. Każdy kadr: cały ekran (pomniejszony ×0,5) i wycinek 960 × 540
// w pikselach ekranu wokół rakiety / miejsca trafienia. Wypisuje stan lotu i efektów przy każdym kadrze oraz
// błędy konsoli i walidacji WebGPU.
//
//   node scripts/webgpu/niszczyciel-demo.mjs [--out .tmp/webgpu/niszczyciel] [--port 5356]
//        [--base http://localhost:5198]   istniejący serwer dev zamiast własnego Vite
//        [--glowica fala|pulsar|gaz]      głowica: fala — poświata i fala refrakcji od środka (domyślnie),
//                                         pulsar — miniaturowy pulsar 3D, gaz — kula ognia z gazu gry
//        [--sc niszczyciel]               scenariusz dema: niszczyciel | niszczycielZoom
//        [--kadry zawis,zaplon,…]         tylko wybrane kadry (stan i tak idzie po kolei)
//        [--zoom 1.2]                     stały zoom kamery (bez — zoom scenariusza)
//        [--ruch 1]                       „bitwa w ruchu” (flota 700 j./s — wybuch jedzie z kadłubem)
//        [--pustka 1]                     cel-punkt w pustce zamiast okrętu (wybuch bez kadłuba)
//        [--pomiar 1]                     po zrzutach: scenariusz w czasie rzeczywistym, koszt klatki co 0,5 s
//        [--swiezy 1]                     ZAMIAST zrzutów: świeża strona w czasie rzeczywistym (headless w takcie
//                                         monitora) — najdłuższe klatki przy pierwszej rakiecie i pierwszym wybuchu
//        [--w 1920 --h 1080]
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo } from './wspolne.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/webgpu/niszczyciel');
const W = Number(args.w || 1920);
const H = Number(args.h || 1080);
const only = args.kadry ? new Set(String(args.kadry).split(',')) : null;

// Głowica: fala (domyślna), pulsar albo gaz — nazwa z adresu strony dema (?glowica=) i jej id w reżyserze efektów.
const glowicaParam = ['fala', 'pulsar', 'gaz'].includes(String(args.glowica)) ? String(args.glowica) : 'fala';
const glowica = { fala: 'wave', pulsar: 'pulsar', gaz: 'gas' }[glowicaParam];
const sc = String(args.sc || 'niszczyciel');

// Kadry: nazwa i krok w przeglądarce (D = __demo, U = __until(warunek, limit klatek), M = rakieta w locie).
const DT = '1 / 60';
const LOT = [
  ['zawis', `U(() => D.flight.count > 0); D.step(33, ${DT});`],
  ['zaplon', `U(() => M() && M().state === 'POWERED'); D.step(5, ${DT});`],
  ['przechyl', `D.step(32, ${DT});`],
  ['przelot', `U(() => !M() || M().stage === 2 || M().travel > 900, 400);`],
  ['sprint0', `U(() => !M() || M().stage === 2, 900); D.step(3, ${DT});`],
  ['sprint', `D.step(14, ${DT});`],
  ['wlot', `U(() => D.flight.count === 0, 600); D.step(2, ${DT});`]
];
const WYBUCH = {
  // Fala: całe życie 1,35 s — gęste kadry na początku (czasy w nazwach — setne sekundy od detonacji).
  wave: [
    ['f003-blysk', `U(() => D.wave.count > 0, 120); D.step(1, ${DT});`],
    ['f007', `D.step(2, ${DT});`],
    ['f012', `D.step(3, ${DT});`],
    ['f018', `D.step(4, ${DT});`],
    ['f028', `D.step(6, ${DT});`],
    ['f042', `D.step(8, ${DT});`],
    ['f062', `D.step(12, ${DT});`],
    ['f087', `D.step(15, ${DT});`],
    ['f117', `D.step(18, ${DT});`],
    ['f150-po', `D.step(20, ${DT});`]
  ],
  gas: [
    ['wybuch0', `U(() => D.fx.heavies.length > 0, 120); D.step(1, ${DT});`],
    ['wybuch1', `D.step(11, ${DT});`],
    ['wybuch2', `D.step(18, ${DT});`],
    ['wybuch3', `D.step(30, ${DT});`],
    ['wybuch4', `D.step(48, ${DT});`],
    ['wybuch5', `D.step(72, ${DT});`],
    ['wybuch6', `D.step(90, ${DT});`]
  ],
  // Pulsar: ładowanie 0,55 s → detonacja → pulsar 3,4 s → zapaść 0,45 s (czasy w nazwach — od początku ładowania).
  pulsar: [
    ['p020-ladowanie', `U(() => D.pulsar.count > 0, 120); D.step(11, ${DT});`],
    ['p050-ladowanie', `D.step(18, ${DT});`],
    ['p058-blysk', `D.step(5, ${DT});`],
    ['p070-powloka', `D.step(7, ${DT});`],
    ['p095-powloka', `D.step(15, ${DT});`],
    ['p135-pulsar', `D.step(24, ${DT});`],
    ['p195-pulsar', `D.step(36, ${DT});`],
    ['p275-pulsar', `D.step(48, ${DT});`],
    ['p355-pulsar', `D.step(48, ${DT});`],
    ['p415-zapasc', `D.step(36, ${DT});`],
    ['p437-koniec', `D.step(13, ${DT});`],
    ['p445-blysk', `D.step(5, ${DT});`],
    ['p520-po', `D.step(45, ${DT});`]
  ]
};
const KADRY = [...LOT, ...WYBUCH[glowica]];

let server = null;
let base = args.base ? String(args.base).replace(/\/$/, '') : null;
if (!base) {
  const v = await startVite(Number(args.port || 5356));
  server = v.server;
  base = v.base;
}
// --swiezy: takt monitora (klatka = okres odświeżania, przycięcie = wielokrotność okresu); zrzuty i --pomiar — bez limitu.
const chrome = await startChrome({ width: W, height: H, takt: !!args.swiezy });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
let failed = false;

async function shot(file, clip) {
  const p = { format: 'png', captureBeyondViewport: false };
  if (clip) p.clip = clip;
  const { data } = await cdp.send('Page.captureScreenshot', p);
  writeFileSync(file, Buffer.from(data, 'base64'));
}

async function sekwencjaZrzutow() {
  await cdp.send('Page.navigate', { url: `${base}/dema/rakiety-webgpu.html?scenario=${sc}&shot=1&loop=0&glowica=${glowicaParam}` });
  if (!await waitFor(cdp, 'window.__demo && window.__demo.S.ready', 180000)) throw new Error('demo nie wstało');
  await evaluate(cdp, `(() => {
    const D = window.__demo;
    D.S.hideUi = true;
    D.pause(true); D.clear();
    ${args.ruch ? "document.getElementById('t-move').checked = true; document.getElementById('t-move').dispatchEvent(new Event('change'));" : ''}
    D.scenario(${JSON.stringify(sc)});
    D.fx.opts.heavyWarhead = ${JSON.stringify(glowica)};
    ${args.pustka ? `D.scen.queue.length = 0; D.scen.at(0.4, () => { const a = D.hulls.atlas; D.scen.missile = D.fireAt('niszczyciel', { x: a.x + 3600, y: a.y - 900, point: true }, { warhead: ${JSON.stringify(glowica)} }); });` : ''}
    ${args.zoom ? `D.setZoom(${Number(args.zoom)});` : ''}
    window.__until = (cond, max = 1200) => { let g = 0; while (!cond() && g++ < max) D.step(1, 1 / 60); return g; };
    window.__m = () => D.flight.list.find((m) => m.vfx === 'niszczyciel') || null;
    // Punkt uwagi kadru [px ekranu]: rakieta w locie, potem miejsce trafienia (jedzie z kadłubem).
    window.__focus = () => {
      const S = D.S; const m = window.__m() || D.scen.missile;
      let x = S.cam.x, y = S.cam.y;
      if (m) { x = m.x; y = m.y; if (!m.alive && m.hitHull && D.scen.lastNova && D.scen.lastNova.hull) { x = D.scen.lastNova.hull.x + D.scen.lastNova.ox; y = D.scen.lastNova.hull.y + D.scen.lastNova.oy; } }
      return { x: (x - S.cam.x) * S.cam.zoom + innerWidth * 0.5, y: (y - S.cam.y) * S.cam.zoom + innerHeight * 0.5 };
    };
    window.__snap = () => {
      const m = window.__m() || D.scen.missile; const st = D.stats();
      return { t: +D.scen.t.toFixed(3), lot: D.flight.count, stan: m ? m.state : null, faza: m ? m.phase : null, czlon: m ? m.stage : null,
        z: m ? +m.z.toFixed(0) : null, v: m ? +m.speed.toFixed(0) : null, x: m ? +(m.x - 6700000).toFixed(0) : null, y: m ? +(m.y - 6600000).toFixed(0) : null,
        zoom: +D.S.cam.zoom.toFixed(3), fale: st.waves, pulsary: st.pulsars, plazma: st.pulsarParticles, gaz: st.gasDomains, zar: st.gasEmbers,
        przebicia: D.fx.pens.length, wybuchy: D.fx.heavies.length,
        wtorne: D.fx.cookoffs.length, czlony: D.fx.boosters.length, odlamki: st.fragments, dym: st.smoke, iskry: st.sparks, swiatla: st.lights };
    };
    return true;
  })()`);
  for (const [tag, js] of KADRY) {
    await evaluate(cdp, `(() => { const D = window.__demo; const U = window.__until; const M = window.__m; ${js} return true; })()`, 240000);
    if (only && !only.has(tag)) continue;
    await sleep(350);
    const info = await evaluate(cdp, 'JSON.stringify({ s: window.__snap(), f: window.__focus() })');
    const { s, f } = JSON.parse(info);
    await shot(join(out, `${tag}-caly.png`), { x: 0, y: 0, width: W, height: H, scale: 0.5 });
    const cw = Math.min(960, W);
    const ch = Math.min(540, H);
    const cx = Math.min(Math.max(0, Math.round(f.x - cw / 2)), W - cw);
    const cy = Math.min(Math.max(0, Math.round(f.y - ch / 2)), H - ch);
    await shot(join(out, `${tag}-wycinek.png`), { x: cx, y: cy, width: cw, height: ch, scale: 1 });
    console.log(`${tag}: ${JSON.stringify(s)}`);
  }
  const st = await evaluate(cdp, 'JSON.stringify(window.__demo.stats())');
  console.log(`statystyki: ${st}`);
  console.log(`zrzuty: ${out}`);
  if (args.pomiar) {
    // KOSZT w czasie rzeczywistym: scenariusz od nowa bez pauzy, próbka statystyk dema co 0,5 s (headless bez
    // vsync — FPS to sufit maszyny; GPU z znaczników czasu three, wygładzone przez demo).
    await evaluate(cdp, `(() => { const D = window.__demo; D.clear(); D.scenario(${JSON.stringify(sc)}); D.fx.opts.heavyWarhead = ${JSON.stringify(glowica)}; D.pause(false); return true; })()`);
    console.log('pomiar (czas scenariusza [s] | FPS | CPU ms | GPU render ms | GPU compute ms | pulsary | cząstki plazmy | domeny gazu):');
    let peak = 0;
    for (let i = 0; i < Math.round(Number(args.pomiar) > 1 ? Number(args.pomiar) * 2 : 26); i++) {
      await sleep(500);
      const s = JSON.parse(await evaluate(cdp, 'JSON.stringify({ t: window.__demo.scen.t, s: window.__demo.stats() })'));
      const g = s.s.gpuRenderMs + s.s.gpuComputeMs;
      if (g > peak) peak = g;
      console.log(`  ${s.t.toFixed(1).padStart(5)} | ${String(Math.round(s.s.fps)).padStart(4)} | ${s.s.cpuMs.toFixed(2)} | ${s.s.gpuRenderMs.toFixed(2)} | ${s.s.gpuComputeMs.toFixed(2)} | ${s.s.pulsars} | ${s.s.pulsarParticles} | ${s.s.gasDomains}`);
    }
    console.log(`szczyt GPU (render + compute): ${peak.toFixed(2)} ms`);
  }
}

// ŚWIEŻA STRONA (--swiezy 1): scenariusz w czasie rzeczywistym od wczytania strony, bez kroków harnessu przedtem —
// pierwsza rakieta i pierwszy wybuch w życiu strony. Rejestrator odstępów klatek (rAF) wchodzi przed skryptami
// strony i zapisuje klatki od gotowości dema; wynik: mediana, p99 i najdłuższe klatki z czasem scenariusza.
// Pipeline albo kernel spoza rozgrzewki dema widać jako pojedynczą długą klatkę przy pierwszym użyciu
// (start rakiety, start sprintu, wejście w kadłub, początek wybuchu).
async function swiezaStrona() {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const K = window.__klatki = [];
    const Z = window.__zdarzenia = {};
    // Potoki tworzone PO gotowości dema = to, czego rozgrzewka nie objęła (kompilacja w trakcie pokazu).
    const P = window.__potoki = [];
    if (window.GPUDevice) {
      for (const fn of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync']) {
        const orig = GPUDevice.prototype[fn];
        if (!orig) continue;
        GPUDevice.prototype[fn] = function (desc) {
          const D = window.__demo;
          P.push({ fn, po: !!(D && D.S.ready), t: D && D.S.ready ? +D.scen.t.toFixed(2) : -1, label: (desc && desc.label) || '' });
          return orig.call(this, desc);
        };
      }
    }
    let last = 0;
    let gotowe = false;
    const tick = (t) => {
      const D = window.__demo;
      // Pierwszy odstęp po gotowości zawiera samą rozgrzewkę (pod napisem ładowania) — nie liczy się do pokazu.
      const byloGotowe = gotowe;
      gotowe = !!(D && D.S.ready);
      if (gotowe && !byloGotowe) Z.rozgrzewkaMs = last ? t - last : 0;
      if (gotowe && byloGotowe) {
        const m = D.scen.missile;
        const st = D.scen.t;
        if (m && Z.start === undefined) Z.start = st;
        if (m && m.stage === 2 && Z.sprint === undefined) Z.sprint = st;
        if (m && !m.alive && Z.trafienie === undefined) Z.trafienie = st;
        const wyb = D.wave.count + D.pulsar.count + D.fx.heavies.length;
        if (wyb > 0 && Z.wybuch === undefined) Z.wybuch = st;
        if (last) K.push(t - last, st, wyb);
      }
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()` });
  await cdp.send('Page.navigate', { url: `${base}/dema/rakiety-webgpu.html?scenario=${sc}&loop=0&glowica=${glowicaParam}` });
  if (!await waitFor(cdp, 'window.__demo && window.__demo.S.ready', 180000)) throw new Error('demo nie wstało');
  if (!await waitFor(cdp, 'window.__demo.scen.t >= window.__demo.scen.duration', 90000)) throw new Error('scenariusz nie dobiegł końca');
  const r = JSON.parse(await evaluate(cdp, `(() => {
    const K = window.__klatki; const n = K.length / 3;
    const dts = new Float64Array(n);
    for (let i = 0; i < n; i++) dts[i] = K[i * 3];
    const s = Float64Array.from(dts).sort();
    const top = Array.from(dts.keys()).sort((a, b) => dts[b] - dts[a]).slice(0, 8).sort((a, b) => a - b);
    return JSON.stringify({
      n, med: s[n >> 1], p99: s[Math.floor(n * 0.99)], max: s[n - 1], zd: window.__zdarzenia,
      potoki: window.__potoki.length, potokiPo: window.__potoki.filter((p) => p.po),
      top: top.map((i) => ({ ms: +dts[i].toFixed(1), t: +K[i * 3 + 1].toFixed(2), wyb: K[i * 3 + 2] })),
      st: window.__demo.stats()
    });
  })()`));
  const f2 = (v) => (v === undefined ? '—' : Number(v).toFixed(2));
  console.log(`świeża strona, scenariusz ${sc}, głowica ${glowicaParam}: ${r.n} klatek, mediana ${r.med.toFixed(2)} ms, p99 ${r.p99.toFixed(2)} ms, najdłuższa ${r.max.toFixed(1)} ms`);
  console.log(`zdarzenia [s scenariusza]: start rakiety ${f2(r.zd.start)}, sprint ${f2(r.zd.sprint)}, trafienie ${f2(r.zd.trafienie)}, początek wybuchu ${f2(r.zd.wybuch)}`);
  console.log(`ostatni odstęp klatek pod napisem ładowania (rozgrzewka potoków): ${Math.round(r.zd.rozgrzewkaMs || 0)} ms`);
  console.log('najdłuższe klatki (ms @ czas scenariusza, żywe wybuchy):');
  for (const k of r.top) console.log(`  ${String(k.ms).padStart(6)} ms @ ${k.t.toFixed(2)} s, wybuchy ${k.wyb}`);
  console.log(`potoki GPU: ${r.potoki} razem, po gotowości dema ${r.potokiPo.length} (ma być 0 — reszta to rozgrzewka pod napisem ładowania)`);
  for (const p of r.potokiPo.slice(0, 24)) console.log(`  ${p.fn} @ ${p.t.toFixed(2)} s ${p.label}`);
  console.log(`statystyki: ${JSON.stringify(r.st)}`);
}

try {
  mkdirSync(out, { recursive: true });
  if (args.swiezy) await swiezaStrona();
  else await sekwencjaZrzutow();
} catch (err) {
  console.log(String(err.stack || err));
  failed = true;
} finally {
  const errs = logs.errors().filter((l) => !/TimestampQueryPool/.test(l));
  console.log(`błędy konsoli / WebGPU: ${errs.length}`);
  for (const e of errs.slice(0, 20)) console.log('  ', e.slice(0, 1200));
  await chrome.close();
  if (server) await server.close();
}
process.exit(failed ? 1 : 0);
