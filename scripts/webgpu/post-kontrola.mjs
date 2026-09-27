// Kontrola postu gry na prawdziwym GPU (port WebGPU, zadanie 02): rzeczy, których harness zrzutów nie sprawdza.
//  - tuner bloomu (__bloomPanel / DevVFX.bloom, jak panel Bloom z ?dev): siła 0 = obraz bez bloomu, siła 2 i skala
//    rozdzielczości 0,5 zmieniają obraz, powrót do bloomConfig.js = obraz wyjściowy co do piksela;
//  - perfToggles.bloom (drugi RenderPipeline): wyłączony = 0 passów bloomu, włączony z powrotem = ten sam obraz;
//  - MSAA 4 → 0 → 4 (setMsaaEnabled na composerTarget i planetHaloTarget): bez błędów, obraz wraca;
//  - pula znaczników czasu three przy 200 krokach (brama _gpuTimerGate — bez „Maximum number of queries exceeded”);
//  - podzielony ekran: bloom liczony raz na RENDER (dwa renderSingle w klatce = dwa bloomy).
//   node scripts/webgpu/post-kontrola.mjs [--out .tmp/webgpu/post-kontrola] [--port 5355]
// Kod wyjścia 1, gdy któraś kontrola nie przeszła (lista w <out>/wynik.json).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';
import { readPng } from './png.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/webgpu/post-kontrola');
const port = Number(args.port || 5355);
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const result = { kroki: [], kontrole: [] };
const note = (k, v) => { result.kroki.push({ k, v }); console.log(' ', k, typeof v === 'string' ? v : JSON.stringify(v)); };
const check = (name, ok, detail = '') => { result.kontrole.push({ name, ok: !!ok, detail }); console.log(`  [${ok ? 'OK' : 'NIE'}] ${name}${detail ? ' — ' + detail : ''}`); };

// Odsetek pikseli różniących się > 2/255 (kanał RGB).
function diffPct(a, b) {
  const A = readPng(join(out, `${a}.png`)); const B = readPng(join(out, `${b}.png`));
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    if (Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2])) > 2) n++;
  }
  return +(100 * n / (A.width * A.height)).toFixed(4);
}

async function session(fn) {
  const chrome = await startChrome({ width: 1920, height: 1080 });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 180000) => evaluate(cdp, e, t);
  try {
    await osobneLosowanieUuid(cdp);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
    await fn({ cdp, ev });
  } catch (err) {
    check('sesja bez wyjątku', false, String(err?.stack || err).slice(0, 400));
  } finally {
    const bad = logs.all().filter((l) => /^\[(error|exception|log:error|warning|log:warning|http|net)\]/.test(l) && !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels|Zamiennik/.test(l));
    check('konsola bez błędów i ostrzeżeń (poza zamiennikami)', bad.length === 0, bad.slice(0, 5).join(' | '));
    await chrome.close();
  }
}

// ── 1. pojedynczy widok: tuner, przełącznik bloomu, MSAA, pula znaczników ─────────
await session(async ({ cdp, ev }) => {
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  await ev('window.__harness.hold(true)');
  await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x1234); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y + 60000}, 0);
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/three\\.js(\\?|$)|three\\.module\\.js/.test(n));
    const T = await import(url);
    const root = new T.Group();
    const x0 = ship.pos.x, y0 = -ship.pos.y;
    const add = (mesh, dx, dy) => { mesh.position.set(x0 + dx, y0 + dy, 20); mesh.layers.set(0); root.add(mesh); };
    add(new T.Mesh(new T.SphereGeometry(110, 48, 24), new T.MeshStandardMaterial({ color: 0x202020, emissive: new T.Color(1, 0.45, 0.1), emissiveIntensity: 4 })), -200, 150);
    const hdr = new T.MeshBasicMaterial(); hdr.color.setRGB(3.0, 1.5, 0.6);
    add(new T.Mesh(new T.PlaneGeometry(220, 60), hdr), 200, 180);
    Core3D.scene.add(root); root.updateMatrixWorld(true);
    S.cam(ship.pos.x, ship.pos.y, 1.0);
    S.isolate([0, 7]);
    return true; })()`);
  const snap = async (name) => {
    await ev('window.__harness.frames(8)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(4)');
    await screenshotPng(cdp, join(out, `${name}.png`));
    return ev(`(() => { const C = window.Core3D, b = C.bloomPass; return { sila: b.strength.value, skala: b.resolutionScale,
      jasny: b._renderTargetBright.width + 'x' + b._renderTargetBright.height, bloomDc: C.lastFrameRenderInfo?.bloom?.calls, postDc: C.lastFrameRenderInfo?.post?.calls,
      msaa: C.composerTarget.samples, halo: C.planetHaloTarget.samples }; })()`);
  };
  const setBloom = (o) => ev(`(() => { const o = ${JSON.stringify(o)}; if (window.__bloomPanel) window.__bloomPanel.set(o); else { window.DevVFX = window.DevVFX || {}; window.DevVFX.bloom = Object.assign({}, window.DevVFX.bloom || {}, o); } return true; })()`);
  const a = await snap('a-domyslny'); note('domyślny', a);
  check('bloom w kubełkach: 12 passów bloomu, 1 post', a.bloomDc === 12 && a.postDc === 1, JSON.stringify(a));
  note('panel Bloom (__bloomPanel)', await ev('!!window.__bloomPanel'));
  await setBloom({ strength: 0 }); note('siła 0', await snap('b-sila0'));
  await setBloom({ strength: 2 }); note('siła 2', await snap('c-sila2'));
  await setBloom({ strength: 0.85, resolutionScale: 0.5 });
  const d = await snap('d-skala05'); note('skala 0,5', d);
  check('tuner: skala 0,5 zmniejsza cele bloomu', d.jasny === '480x270', d.jasny);
  await setBloom({ strength: 0.85, resolutionScale: 1.0 }); note('powrót', await snap('e-powrot'));
  await ev('(() => { window.Core3D.setPerfToggles({ bloom: false }); return true; })()');
  const f = await snap('f-bez-bloomu'); note('perfToggles.bloom = false', f);
  check('bloom wyłączony: 0 passów bloomu', f.bloomDc === 0, JSON.stringify(f));
  await ev('(() => { window.Core3D.setPerfToggles({ bloom: true }); return true; })()'); note('perfToggles.bloom = true', await snap('g-bloom-znowu'));
  await ev('window.Core3D.setMsaaEnabled(false)');
  const h = await snap('h-msaa0'); note('MSAA 0', h);
  check('MSAA 0 na celu sceny i halo', h.msaa === 0 && h.halo === 0);
  await ev('window.Core3D.setMsaaEnabled(true, 4)');
  const i = await snap('i-msaa4'); note('MSAA 4', i);
  check('MSAA 4 z powrotem', i.msaa === 4 && i.halo === 4);
  const maxIdx = await ev(`(async () => { const H = window.__harness; const p = window.Core3D.renderer.backend.timestampQueryPool?.render; let mx = 0;
    H.step(200); for (let k = 0; k < 400 && H.clock.mode === 'step'; k++) { await new Promise((r) => setTimeout(r, 5)); if (p) mx = Math.max(mx, p.currentQueryIndex); }
    return { mx, max: p ? p.maxQueries : null }; })()`);
  note('pula znaczników przy 200 krokach', maxIdx);
  check('pula znaczników bez przepełnienia', maxIdx.max === null || maxIdx.mx + 2 <= maxIdx.max, JSON.stringify(maxIdx));
  for (const [x, y, name, expect] of [['b-sila0', 'f-bez-bloomu', 'siła 0 = obraz bez bloomu', 0], ['a-domyslny', 'e-powrot', 'tuner: powrót = obraz wyjściowy', 0],
    ['a-domyslny', 'g-bloom-znowu', 'perfToggles.bloom: powrót = obraz wyjściowy', 0], ['a-domyslny', 'i-msaa4', 'MSAA 4 → 0 → 4: obraz wraca', 0]]) {
    const pct = diffPct(x, y);
    check(name, pct === expect, `${x} vs ${y}: ${pct}% pikseli > 2/255`);
  }
  for (const [x, y, name] of [['a-domyslny', 'c-sila2', 'tuner: siła 2 zmienia obraz'], ['a-domyslny', 'd-skala05', 'tuner: skala 0,5 zmienia obraz'], ['a-domyslny', 'h-msaa0', 'bez MSAA inne krawędzie']]) {
    const pct = diffPct(x, y);
    check(name, pct > 0, `${x} vs ${y}: ${pct}%`);
  }
});

// ── 2. podzielony ekran: bloom raz na render ───────────────────────────────────
await session(async ({ cdp, ev }) => {
  await ev(`(() => { window.DevScene.startSplit(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('split nie ruszył');
  await ev('window.__harness.hold(true)');
  const r = await ev(`(async () => { const C = window.Core3D; const b = C.bloomPass; let blooms = 0, renders = 0;
    const ub = b.updateBefore; b.updateBefore = function (...a) { blooms++; return ub.apply(this, a); };
    const rs = C.renderSingle; C.renderSingle = function (...a) { renders++; return rs.apply(this, a); };
    await window.__harness.frames(20);
    b.updateBefore = ub; C.renderSingle = rs;
    return { klatki: 20, renderSingle: renders, bloom: blooms, split: !!window.splitScreenMode }; })()`);
  note('podzielony ekran', r);
  check('split: bloom raz na renderSingle', r.split && r.renderSingle >= 40 && r.bloom === r.renderSingle, JSON.stringify(r));
  await screenshotPng(cdp, join(out, 'j-split.png'));
});

await server.close();
writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
const failed = result.kontrole.filter((c) => !c.ok);
console.log(failed.length ? `NIE PRZESZŁO: ${failed.map((c) => c.name).join('; ')}` : `wszystkie kontrole OK (${result.kontrole.length})`);
process.exit(failed.length ? 1 : 0);
