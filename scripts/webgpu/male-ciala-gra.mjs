// MAŁE CIAŁA w PRAWDZIWEJ grze (src/data/smallBodies.js, docs/PLAN-pas-realizm.md — strumień C): Ceres ze stolicą
// Unii Pasa i stacją, Westa, Pallas, Hygiea, Psyche, Pluton z Charonem. Zatrzymana klatka, słońce na czas kadru
// w poziomie od ciała (terminator pionowy), obrót ciała tak, żeby cel (lon, lat) stał w żądanym miejscu tarczy.
// Zrzuty `<kadr>.png`, na końcu dok na Ceres (terminal, rynek, frakcja), położenia (tor kampanii, olbrzymy, ciała,
// stacje), pipeline'y utworzone synchronicznie w klatkach (ma być 0) i błędy strony.
//
//   node scripts/webgpu/male-ciala-gra.mjs [--out .tmp/ciala] [--tylko ceres-cala,pluton-charon]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5354);
const out = resolve(repo, args.out || '.tmp/ciala');
const query = args.query ? `&${args.query}` : '';
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

// body — id z smallBodies.js; target [lon, lat] obrócony na x tarczy = pitX (+ ku słońcu, − w noc), fill — promień
// tarczy w wysokości kadru, km — pół wysokości kadru wokół celu, zoom — zoom gry wprost (kadr na środku ciała,
// albo stacji: `at: 'station'`), hud — bez ukrywania HUD-u (podpisy, radar).
const VIEWS = [
  { name: 'ceres-cala', body: 'ceres', target: [-120.7, 19.8], pitX: 0.35, fill: 0.42 },
  { name: 'ceres-stolica', body: 'ceres', target: [-120.7, 19.8], pitX: 0.3, km: 230 },
  { name: 'ceres-stolica-noc', body: 'ceres', target: [-120.7, 19.8], pitX: -0.35, km: 260 },
  { name: 'ceres-noc', body: 'ceres', target: [-120.7, 19.8], pitX: -0.45, fill: 0.42 },
  { name: 'ceres-stacja', body: 'ceres', at: 'station', target: [-120.7, 19.8], pitX: 0.2, zoom: 0.07 },
  { name: 'ceres-stacja-gra', body: 'ceres', at: 'station', target: [-120.7, 19.8], pitX: 0.2, zoom: 0.21 },
  { name: 'ceres-dystans', body: 'ceres', target: [-120.7, 19.8], pitX: 0.3, zoom: 0.012, hud: true },
  { name: 'westa-cala', body: 'vesta', target: [22, -6], pitX: 0.3, fill: 0.42 },
  { name: 'westa-rheasilvia', body: 'vesta', target: [-60, -70], pitX: 0.2, fill: 0.42 },
  { name: 'westa-huta-noc', body: 'vesta', target: [22, -6], pitX: -0.35, km: 120 },
  { name: 'westa-stacja-gra', body: 'vesta', at: 'station', target: [22, -6], pitX: 0.2, zoom: 0.07 },
  { name: 'pallas-cala', body: 'pallas', target: [-62, -38], pitX: 0.3, fill: 0.42 },
  { name: 'hygiea-cala', body: 'hygiea', target: [-14, 27], pitX: 0.3, fill: 0.42 },
  { name: 'psyche-cala', body: 'psyche', target: [-38, 12], pitX: 0.3, fill: 0.42 },
  { name: 'psyche-noc', body: 'psyche', target: [60, -8], pitX: -0.35, fill: 0.42 },
  { name: 'pluton-cala', body: 'pluto', target: [177, 22], pitX: 0.25, fill: 0.42 },
  { name: 'pluton-charon', body: 'pluto', target: [177, 22], pitX: 0.25, zoom: 0.014 },
  { name: 'charon-cala', body: 'charon', target: [0, 30], pitX: 0.3, fill: 0.42 },
  { name: 'ceres-gra', body: 'ceres', at: 'station', target: [-120.7, 19.8], pitX: 0.2, zoom: 0.21, hud: true }
];

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { zrzuty: {} };
mkdirSync(out, { recursive: true });
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) {
    throw new Error('gra nie ruszyła');
  }
  await ev('(() => { window.setFogOfWar?.(false); return true; })()');
  await ev('window.__harness.frames(4)');
  await ev('window.__harness.hold(true)');
  await ev('(() => { window.camera.minZoom = 0.002; window.camera.maxZoom = 8; return true; })()');
  const begLog = await ev('window.__harness.frameLog.n');

  // Położenia: ciała, stacje Unii, odstęp od toru kampanii (fabuła) i od olbrzymów pasa.
  result.polozenia = await ev(`(() => {
    const au = window.AU_IN_WORLD_UNITS;
    const sun = window.SUN;
    const out = { kąty: window.SMALL_BODY_ANGLES, ciała: {}, stacje: {} };
    for (const b of window.smallBodies || []) {
      out.ciała[b.id] = { au: +(Math.hypot(b.x - sun.x, b.y - sun.y) / au).toFixed(3), r: b.r, x: Math.round(b.x), y: Math.round(b.y) };
    }
    for (const st of (window.stations || []).filter((s) => s.smallBody)) {
      out.stacje[st.id] = { nazwa: st.name, frakcja: st.factionId, x: Math.round(st.x), y: Math.round(st.y), r: st.r };
    }
    const nep = (window.planets || []).find((p) => p.id === 'neptune');
    const plu = (window.smallBodies || []).find((b) => b.id === 'pluto');
    if (nep && plu) {
      let d = Math.atan2(plu.y - sun.y, plu.x - sun.x) - Math.atan2(nep.y - sun.y, nep.x - sun.x);
      d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      out.plutonOdNeptuna = +(d * 180 / Math.PI).toFixed(1);
    }
    const belt = window.__asteroidBelt;
    if (belt?.giants?.entries) {
      out.olbrzymy = belt.giants.entries.map((g) => {
        let best = null;
        for (const b of window.smallBodies || []) {
          const d = Math.hypot(g.x - b.x, g.y - b.y);
          if (!best || d < best.d) best = { id: b.id, d: Math.round(d) };
        }
        return { id: g.id, najbliższe: best };
      });
    }
    out.wyłączenia = belt?.field?.exclusions?.length ?? null;
    return out;
  })()`);
  console.log('położenia', JSON.stringify(result.polozenia));

  const texturesReady = `(() => {
    for (const e of (window._entities || [])) {
      if (!e.mesh || !e.def) continue;
      const m = e.mesh.material;
      for (const t of [m.map, m.emissiveMap, m.normalMap]) {
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
    const e = (window._entities || []).find((q) => q.def && q.id === view.body && q.mesh);
    if (!e) return { blad: 'brak ciała ' + view.body };
    const b = e.data;
    const gx = b.x, gy = b.y, r = b.r * (e._extent || 1);
    window.__sunSaved = { x: SUN.x, y: SUN.y };
    { const d = Math.hypot(SUN.x - gx, SUN.y - gy); SUN.x = gx + d; SUN.y = gy; }
    // cel na tarczy: bez nachylenia osi na czas kadru (obrót wokół osi pionowej ekranu)
    window.__tiltSaved = window.__tiltSaved || {};
    if (!(e.id in window.__tiltSaved)) window.__tiltSaved[e.id] = e.tilt;
    e.tilt = 0;
    const lo = view.target[0] * Math.PI / 180, la = view.target[1] * Math.PI / 180;
    const cx = Math.cos(la) * Math.cos(lo), cy = Math.sin(la), cz = -Math.cos(la) * Math.sin(lo);
    const ring = Math.hypot(cx, cz);
    const th = Math.asin(Math.max(-1, Math.min(1, view.pitX / Math.max(ring, 1e-3) * ring))) - Math.atan2(cx, cz);
    e._spinAngle = th;
    const xs = cx * Math.cos(th) + cz * Math.sin(th);
    let x = gx, y = gy, zoom = view.zoom ?? view.fill * 1080 / (2 * r);
    if (view.km) {
      x = gx + xs * b.r; y = gy - cy * b.r;
      zoom = 540 / (view.km / b.def.radiusKm * b.r);
    }
    if (view.at === 'station') {
      const st = (window.stations || []).find((s) => s.smallBody === view.body);
      if (st) { x = st.x; y = st.y; }
    }
    window.__harness.scene.hideHud(!view.hud);
    window.__harness.scene.cam(x, y, zoom);
    return { r: Math.round(r), zoom: +zoom.toFixed(5), cel: [+(xs).toFixed(3), +(cy).toFixed(3)] };
  })()`);

  for (const view of VIEWS) {
    if (only && !only.has(view.name)) continue;
    const info = await place(view);
    if (info.blad) throw new Error(info.blad);
    await ev('window.__harness.frames(12)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(6)');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, `${view.name}.png`), Buffer.from(data, 'base64'));
    result.zrzuty[view.name] = info;
    await ev('(() => { const s = window.__sunSaved; if (s) { SUN.x = s.x; SUN.y = s.y; } return true; })()');
    console.log(' ', view.name.padEnd(20), JSON.stringify(info));
  }
  await ev(`(() => { for (const e of window._entities || []) if (e.def && window.__tiltSaved && e.id in window.__tiltSaved) e.tilt = window.__tiltSaved[e.id]; return true; })()`);

  // DOK NA CERES: statek przy stacji stolicy, terminal z rynkiem (frakcja Unii, ceny), zrzut
  if (!only || only.has('dok')) {
    result.dok = await ev(`(() => {
      const st = (window.stations || []).find((s) => s.id === 'ceres');
      if (!st) return { blad: 'brak stacji ceres' };
      window.DevScene?.teleport?.(st.x + st.r * 4, st.y + st.r * 1.5, Math.PI);
      window.__harness.scene.hideHud(false);
      window.__harness.scene.shipCam(0.35);
      window.openStationUI(st, 'trade');
      window.DevEconomy?.addCredits?.(1);   // odświeża zawartość zakładki (renderStationOverlay)
      return { stacja: st.name, frakcja: st.factionId, otwarty: !!window.stationUI?.open || null };
    })()`);
    await ev('window.__harness.hold(false)');
    await ev('window.__harness.frames(90)');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, 'ceres-dok.png'), Buffer.from(data, 'base64'));
    // porównanie: terminal stacji Wenus w tych samych warunkach
    await ev(`(() => { const v = (window.stations || []).find((s) => s.id === 'venus'); window.closeStationUI?.(); window.openStationUI(v, 'trade'); window.DevEconomy?.addCredits?.(1); return true; })()`);
    await ev('window.__harness.frames(90)');
    const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, 'wenus-dok.png'), Buffer.from(shot2.data, 'base64'));
    await ev('window.__harness.hold(true)');
    result.dok.rynek = await ev(`(() => {
      const out = {};
      for (const id of ['ceres', 'vesta', 'venus']) {
        const st = (window.stations || []).find((s) => s.id === id);
        const econ = st ? window.TrafficV2?.getEconomy?.(id) : null;   // kopia rynku ruchu v2 (jedyna ekonomia)
        const res = econ?.resources || {};
        out[id] = { towary: Object.keys(res).filter((k) => res[k] > 0).length,
          przykład: Object.entries(res).filter(([, v]) => v > 0).slice(0, 5).map(([k, v]) => k + ':' + Math.round(v)),
          rynek: !!econ };
      }
      out.stacjeGospodarki = window.TrafficV2?.market?.size ?? null;   // rynki ruchu v2 (kopia w moście)
      return out;
    })()`);
    console.log('dok', JSON.stringify(result.dok));
  }
  result.trafficV2 = await ev(`(() => {
    const T = window.TrafficV2;
    if (!T) return null;
    return { ceres: T.hasStation?.('ceres') ?? null, vesta: T.hasStation?.('vesta') ?? null };
  })()`);
  result.pipeline = (await ev(`window.__harness.frameStats(${begLog})`)).pipeline;
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
console.log('pipeline:', JSON.stringify(result.pipeline));
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
