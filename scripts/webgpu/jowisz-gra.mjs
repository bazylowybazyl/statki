// Żywa atmosfera Jowisza (src/3d/jupiterAtmosphere*.js) w PRAWDZIWEJ grze: zatrzymana klatka, doba Jowisza
// ustawiona tak, żeby cel (GRS, pas równikowy) był w żądanym miejscu tarczy, czas atmosfery ustawiany wprost
// (JupiterAtmosphere: zegar faz z czasu gry) — zrzuty w kilku chwilach czasu gry i arkusze ruchu, A/B
// z atmosferą wyłączoną, sprawdzenie zegara (krok gry przesuwa, pauza nie), pipeline'y w klatkach, koszt GPU.
//
//   node scripts/webgpu/jowisz-gra.mjs [--out .tmp/jowisz] [--tylko caly,grs,grs-blisko,pas-blisko,owale]
//                                      [--tune '{"timeScale":2600,"period":9}'] [--koszt 0]
//                                      [--anim 0] [--klatki 40] [--krok 1.5]   (GIF widoku GRS: klatki co krok s gry)
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5355);
const out = resolve(repo, args.out || '.tmp/jowisz');
const tune = args.tune ? JSON.parse(String(args.tune)) : null;
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

// Widoki: cel na tarczy (u tekstury, φc °), jego położenie w poziomie (ułamek promienia, + ku słońcu); fill — ile
// wysokości kadru zajmuje promień planety (center 'planet') albo zoom wprost; times — chwile czasu gry [s].
const GRS = [0.3678, -20.5];
// Słońce gry leży w płaszczyźnie gry — terminator przechodzi przez środek tarczy; cele po stronie dziennej (x ~0,6).
const VIEWS = [
  { name: 'caly', target: GRS, x: 0.45, center: 'planet', fill: 0.95, times: [0, 30, 60], sheet: 'Jowisz cały: t = 0 / 30 / 60 s gry' },
  { name: 'grs', target: GRS, x: 0.6, center: 'target', zoom: 0.07, times: [0, 6, 12, 18, 24, 30], sheet: 'GRS: 6 klatek co 6 s gry', anim: 1 },
  { name: 'grs-blisko', target: GRS, x: 0.6, center: 'target', zoom: 0.2, times: [0, 15, 30], sheet: 'GRS z bliska (zoom 0,2): t = 0 / 15 / 30 s' },
  { name: 'pas-blisko', target: [0.55, 7.5], x: 0.6, center: 'target', zoom: 0.3, times: [0, 15, 30], sheet: 'NEB i dżet 7° N z bliska (zoom 0,3): t = 0 / 15 / 30 s' },
  { name: 'owale', target: [0.2, -37.1], x: 0.6, center: 'target', zoom: 0.1, times: [0, 15, 30], sheet: 'białe owale 37° S (zoom 0,1): t = 0 / 15 / 30 s' }
];
// Animacja (--anim 1): klatki co ANIM_STEP s gry dla widoków z `anim`, GIF przez Pillow z .tmp/venv-planety.
const ANIM = String(args.anim ?? '1') !== '0';
const ANIM_FRAMES = Number(args.klatki || 40);
const ANIM_STEP = Number(args.krok || 1.5);

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { widoki: {} };
mkdirSync(out, { recursive: true });

const shotPng = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const compose = (shots, title, cols) => ev(`(async () => {
  const shots = ${JSON.stringify(shots)};
  const cols = ${cols || 0} || (shots.length <= 3 ? shots.length : (shots.length === 4 ? 2 : 3));
  const rows = Math.ceil(shots.length / cols);
  const W = 960, H = 540, bar = 40, head = 50;
  const cv = document.createElement('canvas');
  cv.width = cols * W; cv.height = head + rows * (H + bar);
  const g = cv.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#eee'; g.font = '600 26px sans-serif'; g.textBaseline = 'middle';
  g.fillText(${JSON.stringify(title)}, 16, head / 2);
  for (let i = 0; i < shots.length; i++) {
    const img = new Image();
    img.src = 'data:image/png;base64,' + shots[i].data;
    await img.decode();
    const cx = (i % cols) * W, cy = head + Math.floor(i / cols) * (H + bar);
    g.fillStyle = '#1d1d1d'; g.fillRect(cx, cy, W, bar);
    g.fillStyle = '#fff'; g.font = '600 22px sans-serif';
    g.fillText(shots[i].label, cx + 14, cy + bar / 2);
    g.drawImage(img, cx, cy + bar, W, H);
  }
  return cv.toDataURL('image/jpeg', 0.92).slice(23);
})()`);

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) {
    throw new Error('gra nie ruszyła');
  }
  await ev('(() => { window.setFogOfWar?.(false); return true; })()');
  if (tune) await ev(`(() => { Object.assign(window.JupiterAtmTune, ${JSON.stringify(tune)}); return true; })()`);
  await ev('window.__harness.frames(4)');
  await ev('window.__harness.hold(true)');
  await ev('window.__harness.scene.hideHud(true)');
  await ev('(() => { window.camera.minZoom = 0.003; window.camera.maxZoom = 8; return true; })()');
  const begLog = await ev('window.__harness.frameLog.n');

  const jup = `(window._entities || []).find((q) => q.jupiterAtm)`;
  result.atmosfera = await ev(`(() => { const e = ${jup}; return e ? { material: e.mesh.material.name, mapa: e.uniforms.dayTexture.value?.image?.src?.split('/').pop() || null, wrapS: e.uniforms.dayTexture.value?.wrapS } : null; })()`);
  if (!result.atmosfera) throw new Error('brak Jowisza z atmosferą (DirectPlanet.jupiterAtm)');
  const ready = `(() => { const t = ${jup}.uniforms.dayTexture.value; return !!(t && t.image && t.image.complete !== false && t.image.width > 0); })()`;
  for (let i = 0; i < 600 && !(await ev(ready)); i++) await ev('window.__harness.frames(2)');

  // Zegar w czasie GRY: 2 s kroków gry przesuwają czas atmosfery o ~2 s, ten sam krok w pauzie — o 0.
  const clockAt = () => ev(`${jup}.jupiterAtm.time`);
  await ev(`(() => { const e = ${jup}; const p = planets.find((q) => q.id === 'jupiter'); window.__harness.scene.cam(p.x, p.y, 0.02); return true; })()`);
  await ev('window.__harness.frames(3)');
  const c0 = await clockAt();
  await ev('window.__harness.step(120, 1000 / 60)');
  const c1 = await clockAt();
  await ev('window.__setGamePaused(true)');
  await ev('window.__harness.step(120, 1000 / 60)');
  const c2 = await clockAt();
  await ev('window.__setGamePaused(false)');
  result.zegar = { krokGry2s: +(c1 - c0).toFixed(3), pauza2s: +(c2 - c1).toFixed(3) };
  console.log('  zegar atmosfery:', JSON.stringify(result.zegar));

  const place = (view) => ev(`(() => {
    const view = ${JSON.stringify(view)};
    const p = planets.find((q) => q.id === 'jupiter');
    const e = ${jup};
    const r = e.group.scale.x;
    const lo = (view.target[0] * 360 - 180) * Math.PI / 180, la = view.target[1] * Math.PI / 180;
    const cx = Math.cos(la) * Math.cos(lo), cy = Math.sin(la), cz = -Math.cos(la) * Math.sin(lo);
    const ring = Math.hypot(cx, cz);
    const sx = Math.sign((SUN.x - p.x) || 1);
    const want = view.x * sx * ring;
    const th = Math.asin(Math.max(-1, Math.min(1, want / ring))) - Math.atan2(cx, cz);
    e._spinY = th;
    e._orient(null);
    const xs = cx * Math.cos(th) + cz * Math.sin(th);
    let x = p.x, y = p.y, zoom = (view.fill || 0.44) * 1080 / (2 * r);
    if (view.center === 'target') { x = p.x + xs * r; y = p.y - cy * r; zoom = view.zoom; }
    window.__harness.scene.cam(x, y, zoom);
    return { r: Math.round(r), zoom: +zoom.toFixed(4), spin: +th.toFixed(4) };
  })()`);
  // Czas atmosfery ustawiony wprost (to samo, co liczy krok z SimClock): faza z czasu gry, tempo z powiększenia.
  const atmAt = (t, on = 1) => ev(`(() => {
    const a = ${jup}.jupiterAtm, T = window.JupiterAtmTune;
    T.on = ${on};
    a.reset();
    a.pace = a.paceFor(window.camera.zoom, a.planet.group.scale.x);
    a.sync(${t}, 0);
    return { t: +a.time.toFixed(2), s: +a.phase.toFixed(3), tempo: +a.pace.toFixed(3) };
  })()`);

  for (const view of VIEWS) {
    if (only && !only.has(view.name)) continue;
    const info = await place(view);
    await ev('window.__harness.frames(8)');
    // ring Jowisza (Fable) buduje się asynchronicznie przy pierwszym zbliżeniu — zrzuty z gotowym
    const ringReady = `!!window.__haloRings?.entries?.find((q) => q.key === 'jupiter')?.ring?.mapsReady`;
    for (let i = 0; i < 400 && !(await ev(ringReady)); i++) await ev('window.__harness.frames(2)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(4)');
    const shots = [];
    let atm = null;
    for (const t of view.times) {
      atm = await atmAt(t);
      await ev('window.__harness.frames(3)');
      const data = await shotPng();
      writeFileSync(join(out, `${view.name}-t${String(t).padStart(2, '0')}.png`), Buffer.from(data, 'base64'));
      shots.push({ label: `t = ${t} s gry  (zegar faz ${atm.s}, tempo ×${atm.tempo})`, data });
    }
    const sheet = await compose(shots, `${view.sheet}   ${JSON.stringify(info)}`);
    writeFileSync(join(out, `${view.name}-ruch.jpg`), Buffer.from(sheet, 'base64'));
    // A/B: atmosfera wyłączona (sama mapa) ↔ włączona, ta sama chwila
    await atmAt(view.times[view.times.length - 1], 0);
    await ev('window.__harness.frames(3)');
    const off = await shotPng();
    await atmAt(view.times[view.times.length - 1], 1);
    await ev('window.__harness.frames(3)');
    const on = await shotPng();
    const ab = await compose([{ label: 'atmosfera wył. (sama mapa)', data: off }, { label: 'atmosfera wł.', data: on }], `${view.name}: A/B`);
    writeFileSync(join(out, `${view.name}-ab.jpg`), Buffer.from(ab, 'base64'));
    if (view.anim && ANIM) {
      const dir = join(out, `anim-${view.name}`);
      mkdirSync(dir, { recursive: true });
      for (let k = 0; k < ANIM_FRAMES; k++) {
        await atmAt(+(k * ANIM_STEP).toFixed(3));
        await ev('window.__harness.frames(2)');
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 0.5 } });
        writeFileSync(join(dir, `${String(k).padStart(3, '0')}.png`), Buffer.from(data, 'base64'));
      }
      const py = join(repo, '.tmp', 'venv-planety', 'Scripts', 'python.exe');
      if (existsSync(py)) {
        const code = 'import sys,glob\nfrom PIL import Image\nf=sorted(glob.glob(sys.argv[1]+"/*.png"))\nim=[Image.open(p).convert("RGB").quantize(colors=200,method=Image.Quantize.MEDIANCUT) for p in f]\nim[0].save(sys.argv[2],save_all=True,append_images=im[1:],duration=int(sys.argv[3]),loop=0)\n';
        const r = spawnSync(py, ['-I', '-c', code, dir, join(out, `${view.name}-anim.gif`), '100'], { encoding: 'utf8' });
        if (r.status !== 0) console.log('  GIF:', r.stderr?.slice(-300));
      }
      result.animacja = { klatki: ANIM_FRAMES, krokSGry: ANIM_STEP, msNaKlatke: 100 };
    }
    result.widoki[view.name] = { ...info, tempo: atm?.tempo };
    console.log(' ', view.name.padEnd(12), JSON.stringify(result.widoki[view.name]));
  }

  // pipeline'y w klatkach gry (przed pomiarem kosztu — ten podmienia materiał)
  result.pipeline = (await ev(`window.__harness.frameStats(${begLog})`)).pipeline;

  // Koszt GPU: tarcza na cały kadr (najgorszy przypadek); materiał Jowisza ↔ zwykła powierzchnia planety (ten sam
  // graf bez przepływu, te same uniformy) — mediana Core3D.gpuFrameMs, naprzemiennie.
  if (String(args.koszt ?? '1') !== '0') {
    await place({ target: GRS, x: 0.1, center: 'target', zoom: 0.03 });
    await atmAt(5, 1);
    const swap = (isJ) => ev(`(() => {
      const e = ${jup};
      if (!e.__matJ) { e.__matJ = e.mesh.material; e.__matS = new e.__matJ.constructor('surface', e.uniforms); }
      e.mesh.material = ${isJ ? 'e.__matJ' : 'e.__matS'};
      return e.mesh.material.name;
    })()`);
    const gpu = async (isJ) => {
      await swap(isJ);
      await ev('window.__harness.frames(6)');
      const v = [];
      for (let i = 0; i < 60; i++) {
        await ev('window.__harness.frames(2)');
        const g = await ev('window.Core3D?.gpuFrameMs ?? 0');
        if (g > 0) v.push(g);
      }
      v.sort((a, b) => a - b);
      return v.length ? +v[v.length >> 1].toFixed(3) : null;
    };
    const a1 = await gpu(true); const a0 = await gpu(false); const b1 = await gpu(true); const b0 = await gpu(false);
    await swap(true);
    result.kosztGpu = { atmosfera: [a1, b1], zwyklaPowierzchnia: [a0, b0], roznicaMs: +(((a1 + b1) - (a0 + b0)) / 2).toFixed(3) };
    console.log('  koszt GPU (mediana klatki, tarcza na cały kadr):', JSON.stringify(result.kosztGpu));
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
console.log('pipeline:', JSON.stringify({ sync: result.pipeline?.sync, syncLista: result.pipeline?.syncLista }));
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
