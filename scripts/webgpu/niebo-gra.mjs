// Tło kosmosu w PRAWDZIWEJ grze: Vite + headless Chrome z WebGPU, bez zmian w kodzie gry.
//
//   node scripts/webgpu/niebo-gra.mjs [--tekstura .tmp/niebo/nebula-gra-1.png] [--nazwa b] [--out .tmp/niebo/gra]
//        [--zoomy 0.2,0.45,0.9] [--rozmiar 1920x1080]
//
// --tekstura: kandydat z wypiekacza (dema/niebo-webgpu.html) podstawiany w odpowiedzi na żądanie
// assets/nebula.webp / .png (CDP Fetch) — gra, menu i kamery 3D czytają go jak prawdziwy plik. Bez
// --tekstura: obecne tło (A/B). Kadry: menu (tło menu z płatem mgławicy), swobodny lot w pustce przy
// zoomach, kamera 3D z góry (K). Wyniki: <out>/<nazwa>-*.png (poza repo).
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '1920x1080').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/niebo/gra');
mkdirSync(out, { recursive: true });
const name = args.nazwa || (args.tekstura ? 'b' : 'a');
const zoomy = String(args.zoomy || '0.2,0.45,0.9').split(',').map(Number);
const texFile = args.tekstura ? resolve(repo, args.tekstura) : null;
if (texFile && !existsSync(texFile)) throw new Error(`brak tekstury ${texFile}`);

const { server, base } = await startVite(Number(args.port || 5431));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { tekstura: texFile, kadry: [], podmiany: 0 };

if (texFile) {
  const body = readFileSync(texFile).toString('base64');
  // Typ z rozszerzenia kandydata (WebP / JPEG pod adresem .png — przeglądarka dekoduje po zawartości).
  const mime = /\.webp$/i.test(texFile) ? 'image/webp' : (/\.jpe?g$/i.test(texFile) ? 'image/jpeg' : 'image/png');
  cdp.on((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const p = msg.params;
    if (/\/assets\/nebula\.(png|webp)(\?|$)/.test(p.request.url)) {
      report.podmiany++;
      cdp.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: mime }, { name: 'Cache-Control', value: 'no-store' }], body }).catch(() => {});
    } else {
      cdp.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
    }
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*nebula.*', requestStage: 'Request' }] });
}

async function shot(label) {
  await sleep(Number(args.czekaj || 900));
  const f = join(out, `${name}-${label}.png`);
  await screenshotPng(cdp, f);
  report.kadry.push(f);
  console.log('kadr', f);
}
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await sleep(2500);
  await shot('menu');
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  // Pustka między planetami (jak pyl-gra.mjs), kurs w prawo-górę.
  await ev(`(() => { const s = window.ship; window.DevScene.teleport(s.pos.x + 260000, s.pos.y - 180000, -0.6); window.DevScene.syncCamera(); return true; })()`);
  await sleep(Number(args.przejscie || 5000));   // jasność tła dochodzi do strefy (skyRegion.js, stała 1,5 s)
  for (const z of zoomy) {
    await setZoom(z);
    await shot(`lot-z${z}`);
    // Kadr mgławicy na teksturze: płaszczyzna 'Nebula' i kamera perspektywy passa tła (stan tej klatki).
    const probe = await ev(`(() => {
      const C = window.Core3D; const cam = C.cameraPersp; let neb = null;
      C.scene.traverse((o) => { if (o.name === 'Nebula' && o.isMesh) neb = o; });
      if (!neb) return null;
      neb.updateWorldMatrix(true, false);
      const p = new neb.position.constructor(); neb.getWorldPosition(p);
      const g = neb.geometry.parameters || {};
      const dist = cam.position.z - p.z;
      const visH = 2 * dist * Math.tan(cam.fov * Math.PI / 360);
      const tex = neb.material?.uniforms?.map?.value?.image;
      const texH = tex?.height || 3200;
      return { zoom: window.camera.zoom, camZ: cam.position.z, fov: cam.fov, aspect: cam.aspect, nebZ: p.z, scale: neb.scale.toArray(),
        plane: [g.width, g.height], tex: tex ? [tex.width, tex.height] : null, visH, texelsH: visH / ((g.height || 500000) * neb.scale.y) * texH,
        comp: [C.composerTarget?.width, C.composerTarget?.height], size: [C.width, C.height], dpr: window.devicePixelRatio,
        jasnosc: neb.material?.uniforms?.brightness?.value ?? null };
    })()`);
    report[`kadr-z${z}`] = probe;
    console.log(`  z${z}:`, JSON.stringify(probe));
  }
  // --koszt: czas klatki GPU (Core3D.gpuFrameMs, średnia ~3 s) z mgławicą i bez — koszt materiału tła z gwiazdami.
  if (args.koszt) {
    const gpuAvg = () => ev(`(async () => { const v = []; for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 100)); const g = window.Core3D.gpuFrameMs; if (Number.isFinite(g) && g > 0) v.push(g); } v.sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; })()`);
    const setNeb = (on) => ev(`(() => { window.Core3D.scene.traverse((o) => { if (o.name === 'Nebula' && o.isMesh) o.visible = ${on}; }); return true; })()`);
    const z = zoomy[zoomy.length - 1];
    await setZoom(z);
    report.koszt = { zoom: z, zMglawica: await gpuAvg() };
    await setNeb(false);
    report.koszt.bezMglawicy = await gpuAvg();
    await setNeb(true);
    console.log('  koszt GPU [ms]:', JSON.stringify(report.koszt));
  }
  // Pas asteroid (--pas 0 wyłącza): środek pasa na promieniu statku od Słońca — tło ciemniej (skyRegion.js).
  if (args.pas !== '0') {
    await ev(`(() => { const s = window.ship, S = window.SUN, B = window.ASTEROID_BELT; const a = Math.atan2(s.pos.y - S.y, s.pos.x - S.x);
      window.DevScene.teleport(S.x + Math.cos(a) * B.mid, S.y + Math.sin(a) * B.mid, -0.6); window.DevScene.syncCamera(); return true; })()`);
    await sleep(Number(args.przejscie || 5000));
    await setZoom(0.45);
    await shot('pas-z0.45');
    const pas = await ev(`(() => { let neb = null; window.Core3D.scene.traverse((o) => { if (o.name === 'Nebula' && o.isMesh) neb = o; });
      const z = document.getElementById('loc-text')?.textContent ?? null; return { jasnosc: neb?.material?.uniforms?.brightness?.value ?? null, strefa: z }; })()`);
    report.pas = pas;
    console.log('  pas:', JSON.stringify(pas));
  }
  // Kamera 3D z góry (K) — niebo-sfera z mgławicą w rzucie stereograficznym.
  if (args.k3d !== '0') {
    await setZoom(0.45);
    await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'k', code: 'KeyK', bubbles: true })); return true; })()`);
    await sleep(2500);
    await shot('kamera3d');
  }
  report.fov = await ev('window.Core3D?.cameraPersp?.fov ?? null');
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  console.error(err);
} finally {
  report.bledy = logs.errors().slice(0, 60);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
  console.log(`podmiany tekstury tła: ${report.podmiany}`);
  writeJson(join(out, `${name}.json`), report);
  await chrome.close();
  await server.close();
}
