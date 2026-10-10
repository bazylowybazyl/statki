// Mapy planet z generatora (scripts/planety/) i wielka kopalnia ringu w PRAWDZIWEJ grze: zatrzymana
// klatka, doba Ziemi ustawiona tak, żeby dziura była w żądanym miejscu tarczy (środek, brzeg od słońca,
// strona nocna), zrzuty `<kadr>__<tag>.png` + zestawienie z tagami `--obok` (np. `--obok stare` po
// przebiegu z `--query planety=stare --tag stare`).
//
//   node scripts/webgpu/planety-mapy-gra.mjs [--tag nowe] [--obok stare] [--query planety=stare]
//                                            [--out .tmp/planety-mapy] [--tylko dziura-dzien,ziemia-cala]
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5353);
const out = resolve(repo, args.out || '.tmp/planety-mapy');
const tag = String(args.tag || 'nowe');
const beside = String(args.obok ?? '').split(',').filter(Boolean);
const query = args.query ? `&${args.query}` : '';
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

// pitX: położenie dziury na tarczy w poziomie (ułamek promienia; + ku słońcu, − w noc), fill: ile wysokości
// kadru zajmuje promień planety (planet) albo promień dziury (pit); center: 'planet' | 'pit'; sunFlip: słońce na czas
// kadru odbite względem planety (dziura na 20,5° N przy słońcu „u góry” ekranu jest zawsze po stronie dziennej);
// sunH: słońce na czas kadru w poziomie od planety (ta sama odległość) — terminator pionowy, pitX działa wprost.
const VIEWS = [
  { name: 'ziemia-cala', body: 'earth', center: 'planet', pitX: 0.35, fill: 0.42 },
  { name: 'ziemia-noc', body: 'earth', center: 'planet', pitX: -0.45, fill: 0.42 },
  { name: 'dziura-dzien', body: 'earth', center: 'pit', pitX: 0.25, fill: 0.62 },
  { name: 'dziura-brzeg', body: 'earth', center: 'pit', pitX: 0.93, fill: 0.55 },
  { name: 'dziura-na-krawedzi', body: 'earth', center: 'pit', pitX: 0.995, fill: 1.1 },
  { name: 'dziura-terminator', body: 'earth', center: 'pit', pitX: 0.08, fill: 0.6 },
  { name: 'dziura-noc', body: 'earth', center: 'pit', pitX: 0.1, fill: 0.6, sunFlip: true },
  { name: 'ziemia-noc-cala', body: 'earth', center: 'planet', pitX: 0.1, fill: 0.42, sunFlip: true },
  { name: 'dziura-blisko', body: 'earth', center: 'pit', pitX: 0.4, fill: 2.6 },
  { name: 'mars-caly', body: 'mars', center: 'planet', fill: 0.42 },
  { name: 'mars-ocean', body: 'mars', center: 'planet', target: [-35, 25], pitX: 0.55, fill: 0.42 },
  { name: 'mars-hellas', body: 'mars', center: 'planet', target: [70, -30], pitX: 0.55, fill: 0.42 },
  { name: 'mars-wybrzeze', body: 'mars', center: 'pit', target: [-48, 22], pitX: 0.55, fill: 1.6 },
  { name: 'mars-noc', body: 'mars', center: 'planet', target: [-60, 10], pitX: 0.1, fill: 0.42, sunFlip: true },
  // Planety tła (perspektywa, z = −50 000): promień na ekranie ma sufit (zoom gry ≤ 3,2) — Merkury ~0,56
  // wysokości kadru, Wenus ~0,79; `zoom` = zoom gry wprost (przy `fill` liczony z perspektywy).
  { name: 'merkury-caly', body: 'mercury', center: 'planet', target: [20, 10], pitX: 0.3, zoom: 0.45 },
  { name: 'merkury-dzien', body: 'mercury', center: 'planet', target: [-40, 10], pitX: 0.45, zoom: 0.45, sunH: true },
  { name: 'merkury-oddal', body: 'mercury', center: 'planet', target: [-100, 5], pitX: 0.3, zoom: 0.08, sunH: true },
  { name: 'merkury-blisko', body: 'mercury', center: 'pit', target: [-35, 15], pitX: 0.5, zoom: 3.2, sunH: true },
  { name: 'merkury-noc', body: 'mercury', center: 'planet', target: [120, 10], pitX: -0.35, zoom: 0.45, sunH: true },
  { name: 'merkury-noc-blisko', body: 'mercury', center: 'pit', target: [70, 5], pitX: -0.5, zoom: 3.2, sunH: true },
  { name: 'wenus-cala', body: 'venus', center: 'planet', target: [60, 0], pitX: 0.3, zoom: 0.45 },
  { name: 'wenus-dzien', body: 'venus', center: 'planet', target: [40, 20], pitX: 0.45, zoom: 0.45, sunH: true },
  { name: 'wenus-ishtar', body: 'venus', center: 'pit', target: [10, 62], pitX: 0.45, zoom: 3.2, sunH: true },
  { name: 'wenus-afrodyta', body: 'venus', center: 'pit', target: [100, -8], pitX: 0.5, zoom: 3.2, sunH: true },
  { name: 'wenus-noc', body: 'venus', center: 'planet', target: [100, -5], pitX: -0.35, zoom: 0.45, sunH: true },
  { name: 'wenus-noc-blisko', body: 'venus', center: 'pit', target: [-10, 50], pitX: -0.45, zoom: 3.2, sunH: true },
  // Saturn (scripts/planety/saturn.py + żywa atmosfera saturnAtmosphere.js): cała tarcza, głowa burzy 2011, biegun płn.
  { name: 'saturn-caly', body: 'saturn', center: 'planet', target: [114, 25], pitX: 0.3, zoom: 0.45 },
  { name: 'saturn-burza', body: 'saturn', center: 'pit', target: [114, 33], pitX: 0.45, zoom: 3.2, sunH: true },
  { name: 'saturn-biegun', body: 'saturn', center: 'pit', target: [-148, 72], pitX: 0.45, zoom: 3.2, sunH: true },
  // Księżyce (DirectMoon, mapy scripts/planety/ksiezyce.py): `moon` = id strojenia (Luna 'moon'), target [lon, lat]
  // obrócony na x tarczy = pitX (+ ku słońcu), `km` = pół wysokości kadru w km wokół celu (bez — cała tarcza
  // z `fill`), `eclipse` — słońce za planetą macierzystą (księżyc w jej cieniu: światła nocne za dnia).
  // Słońce księżyców w płaszczyźnie gry (jak planet): terminator przez środek tarczy, noc dla pitX < 0.
  { name: 'luna-cala', moon: 'moon', target: [0, 10], pitX: 0.35, fill: 0.42 },
  { name: 'luna-noc', moon: 'moon', target: [-16, 29], pitX: -0.4, fill: 0.42 },
  { name: 'luna-noc-blisko', moon: 'moon', target: [-16, 29], pitX: -0.4, km: 260 },
  { name: 'luna-stocznia', moon: 'moon', target: [-16, 29], pitX: 0.4, km: 110 },
  { name: 'luna-port', moon: 'moon', target: [2, 1], pitX: -0.35, km: 300 },
  { name: 'luna-zacmienie', moon: 'moon', target: [-5, 15], pitX: 0.0, fill: 0.42, eclipse: true },
  { name: 'io-cale', moon: 'io', target: [-38, 22], pitX: 0.3, fill: 0.42 },
  { name: 'io-kopalnia', moon: 'io', target: [-38, 22], pitX: 0.4, km: 220 },
  { name: 'io-noc', moon: 'io', target: [-60, 15], pitX: -0.4, fill: 0.42 },
  { name: 'europa-cala', moon: 'europa', target: [0, -5], pitX: 0.3, fill: 0.42 },
  { name: 'europa-ciecia', moon: 'europa', target: [23, -23], pitX: 0.4, km: 260 },
  { name: 'europa-noc', moon: 'europa', target: [5, 0], pitX: -0.4, fill: 0.42 },
  { name: 'ganimedes-caly', moon: 'ganymede', target: [-150, 10], pitX: 0.3, fill: 0.42 },
  { name: 'ganimedes-noc', moon: 'ganymede', target: [-150, 10], pitX: -0.4, fill: 0.42 },
  { name: 'kallisto-cala', moon: 'callisto', target: [-60, 15], pitX: 0.3, fill: 0.42 },
  { name: 'kallisto-noc', moon: 'callisto', target: [-60, 15], pitX: -0.4, fill: 0.42 },
  { name: 'io-noc-blisko', moon: 'io', target: [-38, 22], pitX: -0.35, km: 260 },
  { name: 'europa-noc-blisko', moon: 'europa', target: [23, -23], pitX: -0.35, km: 300 },
  { name: 'ganimedes-noc-blisko', moon: 'ganymede', target: [-163, 2], pitX: -0.35, km: 320 },
  { name: 'kallisto-noc-blisko', moon: 'callisto', target: [-56, 15], pitX: -0.35, km: 320 },
  { name: 'jowisz-ksiezyce', moon: 'europa', target: [-46, 15], pitX: 0.0, zoom: 0.035 },
  // Cienie planet tła (perspektywa) z planetą poza środkiem kadru: off = przesunięcie kamery w promieniach
  // planety — tarcza w masce tam, gdzie planetę widać (zgłoszenie „cienie planet się rozjeżdżają”).
  { name: 'saturn-bok', body: 'saturn', center: 'planet', fill: 0.3, off: [2.2, 1.2] },
  { name: 'wenus-bok', body: 'venus', center: 'planet', fill: 0.3, off: [-2.0, 0.8] }
];
// --cienieStare 1: maska słońca jak przed poprawką cieni (2026-10-08) — tarcze ciał tła w prawdziwym miejscu
// płaszczyzny gry (bez rzutu perspektywy) i cień ringu „Halo” zgłaszany przed podpięciem jego brył.
const oldShadows = args.cienieStare === '1';
const MOON_R_KM = { moon: 1737.4, io: 1821.6, europa: 1560.8, ganymede: 2634.1, callisto: 2410.3 };
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
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  if (!only || only.has('menu')) {
    await ev('window.__menuBackdrop.renderFrame(0)');
    await new Promise((r) => setTimeout(r, 1500));
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `menu__${tag}.png`), Buffer.from(data, 'base64'));
  }
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) {
    throw new Error('gra nie ruszyła');
  }
  await ev('(() => { window.setFogOfWar?.(false); return true; })()');
  await ev('window.__harness.frames(4)');
  await ev('window.__harness.hold(true)');
  await ev('window.__harness.scene.hideHud(true)');
  await ev('(() => { window.camera.minZoom = 0.003; window.camera.maxZoom = 8; return true; })()');
  if (oldShadows) {
    await ev(`(() => {
      const C = window.Core3D;
      const resolve = C._resolveShaftDiscs;
      C._resolveShaftDiscs = function (sun, cx, cy, zoom, h) {
        const src = this.shaftDiscSrc;
        const n = this.shaftDiscCount | 0;
        const keep = src.slice(0, n * 3);
        for (let i = 0; i < n; i++) src[i * 3] = 0;
        const count = resolve.call(this, sun, cx, cy, zoom, h);
        src.set(keep);
        return count;
      };
      for (const e of (window.__haloRings?.entries || [])) e.shadowReady = true;
      return true;
    })()`);
  }
  const begLog = await ev('window.__harness.frameLog.n');

  const texturesReady = `(() => {
    for (const e of (window._entities || [])) {
      for (const u of [e.uniforms, e.cloudUniforms]) {
        if (!u) continue;
        for (const k of ['dayTexture', 'nightTexture', 'normalTexture', 'specularTexture', 'cloudTexture']) {
          const t = u[k]?.value;
          if (t && t.isTexture && t.image === undefined && t.version === 0) return false;
          if (t && t.image && t.image.complete === false) return false;
        }
      }
      const mm = e.lensBody && e.parentData ? e.mesh?.material : null;      // księżyce: wbudowane pola materiału
      for (const t of mm ? [mm.map, mm.emissiveMap, mm.normalMap, mm.bumpMap] : []) {
        if (t && t.image && t.image.complete === false) return false;
        if (t && t.isTexture && !t.image) return false;
      }
    }
    return true;
  })()`;
  for (let i = 0; i < 600; i++) {
    if (await ev(texturesReady)) break;
    await ev('window.__harness.frames(2)');
  }

  const place = (view) => ev(`(() => {
    const view = ${JSON.stringify(view)};
    if (view.moon) {
      // księżyc: pozycja z grupy (scena: y = −y gry), promień = skala siatki, obrót osi Y = _spinAngle (update)
      const e = (window._entities || []).find((q) => q.parentData && q.lensBody && q.lensBody.id === view.moon && q.mesh);
      if (!e) return { blad: 'brak księżyca ' + view.moon };
      const gx = e.group.position.x, gy = -e.group.position.y, r = e.mesh.scale.x;
      const par = e.parentData;
      window.__sunSaved = { x: SUN.x, y: SUN.y };
      // słońce w poziomie od księżyca (ta sama odległość) po stronie DALEJ od planety macierzystej — terminator
      // pionowy, pitX działa wprost, planeta nie zasłania słońca (bez tego Io wypadało w cieniu Jowisza)
      { const d = Math.hypot(SUN.x - gx, SUN.y - gy); SUN.x = gx + Math.sign((gx - par.x) || 1) * d; SUN.y = gy; }
      if (view.eclipse) {
        const k = Math.hypot(SUN.x - par.x, SUN.y - par.y) / Math.max(1, Math.hypot(gx - par.x, gy - par.y));
        SUN.x = par.x + (par.x - gx) * k; SUN.y = par.y + (par.y - gy) * k;
      }
      const lo = view.target[0] * Math.PI / 180, la = view.target[1] * Math.PI / 180;
      const cx = Math.cos(la) * Math.cos(lo), cy = Math.sin(la), cz = -Math.cos(la) * Math.sin(lo);
      const ring = Math.hypot(cx, cz);
      const sx = Math.sign((SUN.x - gx) || 1);
      const th = Math.asin(Math.max(-1, Math.min(1, view.pitX * sx))) - Math.atan2(cx, cz);
      e._spinAngle = th;
      e.mesh.rotation.set(0, th, 0);
      const xs = cx * Math.cos(th) + cz * Math.sin(th);
      let x = gx, y = gy, zoom = view.zoom ?? view.fill * 1080 / (2 * r);
      if (view.km) {
        x = gx + xs * r; y = gy - cy * r;
        zoom = 540 / (view.km / ${JSON.stringify(MOON_R_KM)}[view.moon] * r);
      }
      window.__harness.scene.cam(x, y, zoom);
      return { r: Math.round(r), zoom: +zoom.toFixed(5), cel: [+(xs).toFixed(3), +(cy).toFixed(3)], ring: +ring.toFixed(3) };
    }
    const p = planets.find((q) => q.id === view.body);
    if (!p) return { blad: 'brak planety ' + view.body };
    const e = (window._entities || []).find((q) => q.data === p);
    const r = e && e.group ? e.group.scale.x : p.r;
    if (view.sunFlip || view.sunH) window.__sunSaved = { x: SUN.x, y: SUN.y };
    if (view.sunH) { const d = Math.hypot(SUN.x - p.x, SUN.y - p.y); SUN.x = p.x + Math.sign((SUN.x - p.x) || 1) * d; SUN.y = p.y; }
    if (view.sunFlip) { SUN.x = 2 * p.x - SUN.x; SUN.y = 2 * p.y - SUN.y; }
    // Planety tła leżą na z = −50 000 w kamerze perspektywy (Core3D: FOV 35°, kamera f / zoom nad płaszczyzną
    // gry) — promień na ekranie r · f / (f / zoom + 50 000), nie r · zoom.
    const persp = !!(e && !e.isRingAnchored);
    const fPx = (window.innerHeight || 1080) / 2 / Math.tan(17.5 * Math.PI / 180);
    const zoomFor = (fill) => {
      if (!persp) return fill * 1080 / (2 * r);
      const d = r * fPx / (fill * (window.innerHeight || 1080) / 2) - 50000;
      return d > 0 ? Math.min(3.2, fPx / d) : 3.2;
    };
    let x = p.x, y = p.y, zoom = view.zoom ?? zoomFor(view.fill);
    if (view.off) { x += view.off[0] * r; y += view.off[1] * r; }
    const info = { r: Math.round(r) };
    if (e && (e.pit || view.target) && view.pitX !== undefined) {
      // kierunek celu w układzie siatki: punkt (lon, lat) albo środek dziury (pierwszy wierzchołek łaty)
      let cx, cy, cz;
      if (view.target) {
        const lo = view.target[0] * Math.PI / 180, la = view.target[1] * Math.PI / 180;
        cx = Math.cos(la) * Math.cos(lo); cy = Math.sin(la); cz = -Math.cos(la) * Math.sin(lo);
      } else {
        const pos = e.pit.geometry.attributes.position.array;
        cx = pos[0]; cy = pos[1]; cz = pos[2];
        const cl = Math.hypot(cx, cy, cz); cx /= cl; cy /= cl; cz /= cl;
      }
      const ring = Math.hypot(cx, cz);
      // słońce w płaszczyźnie sceny (y sceny = −y gry): znak x względem planety
      const sx = Math.sign((SUN.x - p.x) || 1);
      const want = view.pitX * sx * ring;      // pożądane x' dziury na tarczy
      // obrót Y: x' = cx cos θ + cz sin θ = ring · sin(θ + atan2(cx, cz)), z' > 0
      const base = Math.atan2(cx, cz);
      const th = Math.asin(Math.max(-1, Math.min(1, want / ring))) - base;
      e._spinY = th;
      e._orient(null);
      const xs = cx * Math.cos(th) + cz * Math.sin(th);
      info.spin = +th.toFixed(4);
      info.pitScreen = [+(xs).toFixed(3), +(cy).toFixed(3)];
      if (view.center === 'pit') {
        x = p.x + xs * r;
        y = p.y - cy * r;
        const pitR = r * (860 / 6371);
        zoom = view.zoom ?? (persp ? zoomFor(view.fill) : view.fill * 1080 / (2 * pitR * 1.25));
      }
    }
    if (persp) info.promienPx = Math.round(r * fPx / (fPx / zoom + 50000));
    window.__harness.scene.cam(x, y, zoom);
    info.zoom = +zoom.toFixed(5);
    return info;
  })()`);

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
    const info = await place(view);
    if (info.blad) throw new Error(info.blad);
    await ev('window.__harness.frames(12)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(6)');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${view.name}__${tag}.png`), Buffer.from(data, 'base64'));
    const shots = [];
    for (const t of beside) {
      const file = join(out, `${view.name}__${t}.png`);
      if (t !== tag && existsSync(file)) shots.push({ label: t, data: readFileSync(file).toString('base64') });
    }
    shots.push({ label: tag, data });
    const sheet = await compose(shots, `${view.name}  ${JSON.stringify(info)}`);
    writeFileSync(join(out, `${view.name}.jpg`), Buffer.from(sheet, 'base64'));
    result.zrzuty[view.name] = info;
    if (view.sunFlip || view.sunH || view.moon) await ev('(() => { const s = window.__sunSaved; if (s) { SUN.x = s.x; SUN.y = s.y; } return true; })()');
    console.log(' ', view.name.padEnd(20), JSON.stringify(info));
  }
  // pipeline'y utworzone w klatkach od startu gry (sync — kompilowane w klatce; łata dziury ma być rozgrzana)
  result.pipeline = (await ev(`window.__harness.frameStats(${begLog})`)).pipeline;
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, `wynik-${tag}.json`), JSON.stringify(result, null, 2) + '\n');
console.log('wynik →', out);
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
