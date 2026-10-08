// Noc i pas zachodu planet w PRAWDZIWEJ grze (2026-10-06): ta sama zatrzymana klatka, pełna scena
// (mgławica, gwiazdy, ring, planety), mgła wojny wyłączona (kamera nad planetą jest daleko od Atlasa).
// Zrzut każdego kadru zapisuje się jako `<kadr>__<tag>.png`; zestawienie `<kadr>.jpg` kładzie obok
// siebie zrzuty z tagów `--obok` (pliki z wcześniejszych przebiegów, np. sprzed zmiany) i bieżący.
//
//   node scripts/webgpu/planety-noc-gra.mjs [--tag nowy] [--obok A,B] [--out .tmp/planety-noc-ab]
//                                           [--port 5351] [--tylko ziemia-cala,mars-caly]
// Pierwsze A i B (2026-10-06): dawna noc (szeroki terminator z uAmbient, czerwony pas, szaroniebieska
// noc Marsa i Jowisza) i noc czarna z wąskim doklejonym pasem — przed modelem SUNSET.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5351);
const out = resolve(repo, args.out || '.tmp/planety-noc-ab');
const tag = String(args.tag || 'nowy');
const beside = String(args.obok ?? 'A,B').split(',').filter(Boolean);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const LABELS = { A: 'A — dawna noc', B: 'B — czarna noc, doklejony pas', nowy: 'teraz — pas zachodu z atmosfery' };
const labelOf = (t) => LABELS[t] || t;

// Kadry: `at` = kąt względem kierunku do słońca (0 dzień, π noc), `dist` w promieniach, `fill` = ile
// wysokości kadru zajmuje promień ciała.
const VIEWS = [
  { name: 'ziemia-cala', body: 'earth', fill: 0.36 },
  { name: 'ziemia-noc-brzeg', body: 'earth', at: Math.PI * 0.82, dist: 1.0, fill: 3.0 },
  { name: 'ziemia-noc-miasta', body: 'earth', at: Math.PI * 0.85, dist: 0.55, fill: 2.5 },
  { name: 'ziemia-terminator', body: 'earth', at: Math.PI / 2, dist: 0.97, fill: 3.2 },
  { name: 'mars-caly', body: 'mars', fill: 0.36 },
  { name: 'jowisz-caly', body: 'jupiter', fill: 0.36 }
];
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { tag, zrzuty: {} };
mkdirSync(out, { recursive: true });
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  // Gra swobodna (bez kampanii — intro kampanii leci w tle menu i trzyma świat).
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) {
    throw new Error('gra nie ruszyła: ' + JSON.stringify(await ev(`({ frame: window.__frameId, loading: document.getElementById('loading')?.className, menu: !!window.__menuBackdrop?.ready })`)));
  }
  // Mgła wojny przykrywa wszystko poza wzrokiem Atlasa — kamera nad planetą jest daleko od niego.
  await ev('(() => { window.setFogOfWar?.(false); return true; })()');
  await ev('window.__harness.frames(4)');
  await ev('window.__harness.hold(true)');
  await ev('window.__harness.scene.hideHud(true)');
  await ev('(() => { window.camera.minZoom = 0.003; return true; })()');

  const texturesReady = `(() => {
    const pending = [];
    const want = (t, name) => { if (t && t.isTexture && t.version === 0 && !t.image) pending.push(name); };
    for (const e of (window._entities || [])) {
      const u = e.uniforms;
      if (u?.dayTexture) { want(u.dayTexture.value, e.name + ':day'); if (e.name === 'earth') { want(u.nightTexture.value, 'earth:night'); want(u.normalTexture.value, 'earth:normal'); want(u.specularTexture.value, 'earth:spec'); } }
      if (e.cloudUniforms) want(e.cloudUniforms.cloudTexture.value, 'earth:clouds');
    }
    return pending.length === 0;
  })()`;
  for (let i = 0; i < 600; i++) {
    if (await ev(texturesReady)) break;
    await ev('window.__harness.frames(2)');
  }

  const placeCamera = (view) => ev(`(() => {
    const view = ${JSON.stringify(view)};
    const p = planets.find((q) => q.id === view.body);
    if (!p) return { blad: 'brak planety ' + view.body };
    const e = (window._entities || []).find((q) => q.data === p);
    let x = p.x, y = p.y;
    const r = e && e.group ? e.group.scale.x : p.r;
    if (view.at !== undefined) {
      const a = Math.atan2(SUN.y - y, SUN.x - x) + view.at;
      x += Math.cos(a) * r * view.dist;
      y += Math.sin(a) * r * view.dist;
    }
    const zoom = view.fill * 1080 / (2 * r);
    window.__harness.scene.cam(x, y, zoom);
    return { x: Math.round(x), y: Math.round(y), r: Math.round(r), zoom: +zoom.toFixed(5) };
  })()`);

  // Zestawienie w stronie (kanwa 2D): miniatury 960 × 540 z podpisem, 2 kolumny dla 4 zrzutów.
  const compose = (shots, title) => ev(`(async () => {
    const shots = ${JSON.stringify(shots)};
    const cols = shots.length <= 3 ? shots.length : 2;
    const rows = Math.ceil(shots.length / cols);
    const W = 960, H = 540, bar = 44, head = 52;
    const cv = document.createElement('canvas');
    cv.width = cols * W; cv.height = head + rows * (H + bar);
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#eee'; g.font = '600 28px sans-serif'; g.textBaseline = 'middle';
    g.fillText(${JSON.stringify(title)}, 16, head / 2);
    for (let i = 0; i < shots.length; i++) {
      const img = new Image();
      img.src = 'data:image/png;base64,' + shots[i].data;
      await img.decode();
      const cx = (i % cols) * W, cy = head + Math.floor(i / cols) * (H + bar);
      g.fillStyle = '#1d1d1d'; g.fillRect(cx, cy, W, bar);
      g.fillStyle = '#fff'; g.font = '600 24px sans-serif';
      g.fillText(shots[i].label, cx + 14, cy + bar / 2);
      g.drawImage(img, cx, cy + bar, W, H);
    }
    return cv.toDataURL('image/jpeg', 0.92).slice(23);
  })()`);

  for (const view of VIEWS) {
    if (only && !only.has(view.name)) continue;
    const place = await placeCamera(view);
    if (place.blad) throw new Error(place.blad);
    await ev('window.__harness.frames(12)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(6)');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${view.name}__${tag}.png`), Buffer.from(data, 'base64'));
    const shots = [];
    for (const t of beside) {
      const file = join(out, `${view.name}__${t}.png`);
      if (t !== tag && existsSync(file)) shots.push({ label: labelOf(t), data: readFileSync(file).toString('base64') });
    }
    shots.push({ label: labelOf(tag), data });
    const sheet = await compose(shots, `${view.name}  (zoom ${place.zoom})`);
    writeFileSync(join(out, `${view.name}.jpg`), Buffer.from(sheet, 'base64'));
    result.zrzuty[view.name] = place;
    console.log(' ', view.name.padEnd(20), JSON.stringify(place));
  }
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
console.log('wynik →', out);
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
