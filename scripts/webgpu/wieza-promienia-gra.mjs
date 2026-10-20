// Wieża Promienia Śmierci „Gungnir” (rodzina 3D `deathRay`, model z Blendera — scripts/blender/deathRay.py) NA SWOIM
// MIEJSCU w prawdziwej grze: supercapital Terra Nova (Colossus) z promieniem (DevScene.equipDeathRay — gniazdo special
// albo wirtualne gniazdo na osi dziobu), zrzuty z góry przy kilku zoomach i z kamer 3D (K), warianty modelu
// stary / Blender (lista rodzin z GLB w ?bronieGlb=, rejestr weaponGlb.js). Harness strony (czas stoi, gra kroczy
// przez __harness.step), gra swobodna, Colossus bez mózgu w pustej przestrzeni.
//
//   node scripts/webgpu/wieza-promienia-gra.mjs [--warianty stary,blender] [--zoomy 0.35,0.9,1.4,1.8,3.2]
//        [--kamery3d tactical,orbit] [--zoom3d 2.4] [--query renderWorker=1] [--out .tmp/blender/wieza-promienia]
//        [--rozmiar 1600x900] [--wycinek 560x360] [--port 5419]
// Warianty: stary — ?bronieGlb= (budowniczy weapons3D.js), blender — rodziny gry (WEAPON_GLB_GAME), <nazwa>:<lista>
// — własna lista (np. lod1:deathRay@1). Tryb worker (--query renderWorker=1): pipeline'y synchroniczne z konsoli workera.
// Wynik: <out>/ab-z<zoom>.png (wycinki 1:1 wokół wieży obok siebie), <out>/ab-3d-<kamera>.png, <out>/kadry/*.png,
// <out>/raport.json (partie wież LOD0 / LOD1 na kadr — tylko tryb off, pipeline'y synchroniczne, błędy konsoli).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const [CW, CH] = (args.wycinek || '560x360').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/blender/wieza-promienia');
mkdirSync(join(out, 'kadry'), { recursive: true });
const VARIANT_GLB = {};
const VARIANTS = String(args.warianty || 'stary,blender').split(',').map((t) => {
  const [name, list] = t.split(':');
  VARIANT_GLB[name] = list != null ? list.split('+').join(',') : name === 'stary' ? '' : null;
  return name;
});
const ZOOMS = String(args.zoomy || '0.35,0.9,1.4,1.8,3.2').split(',').map(Number);
const CAMS3D = String(args.kamery3d || 'tactical,orbit').split(',').filter(Boolean);
const ZOOM3D = Number(args.zoom3d || 2.4);
const QUERY = args.query ? `&${args.query}` : '';
const LABEL = { stary: 'weapons3D.js (dawny)', blender: 'Blender (GLB + AO)' };
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };   // pusta przestrzeń (jak promien-gra)

const { server, base } = await startVite(Number(args.port || 5419));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
// Konsola workera renderu (pipeline'y synchroniczne loguje render.worker.js — „pipeline sync #n”).
const workerLogs = [];
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const sid = msg.params.sessionId;
    cdp.ws.send(JSON.stringify({ id: 900000 + Math.floor(Math.random() * 99999), method: 'Runtime.enable', sessionId: sid }));
    cdp.ws.send(JSON.stringify({ id: 900000 + Math.floor(Math.random() * 99999), method: 'Runtime.runIfWaitingForDebugger', sessionId: sid }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 2000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

// Partie wież w scenie (tryb off — scena na stronie): rodzina → { instancje, rysowana, trójkąty }
const batchInfo = () => ev(`(() => {
  const o = {};
  if (!window.Core3D?.scene) return null;
  window.Core3D.scene.traverse((m) => {
    if (!m.isMesh || !String(m.name).startsWith('wieże 3D: ')) return;
    const g = m.geometry;
    o[m.name.slice(10)] = { instancje: g.instanceCount, rysowana: m.visible, trojkaty: g.index ? g.index.count / 3 : 0 };
  });
  return o;
})()`);
const lodOf = (p) => (p ? ['deathRay', 'deathRay@1'].filter((n) => p[n]?.instancje > 0 && p[n].rysowana !== false).map((n) => `${n}: ${p[n].instancje}`).join(', ') || 'brak' : 'scena w workerze');
const turretAt = `(() => {
  const e = window.__wpColossus;
  // Najbardziej wysunięta ku dziobowi wieża promienia (equipDeathRay montuje go na wszystkich gniazdach special).
  const c = Math.cos(e.angle), s = Math.sin(e.angle);
  let t = null, best = -Infinity;
  for (const q of window.Turret2D.recordsFor(e) || []) {
    if (q.weaponId !== 'death_ray') continue;
    const f = (q.wx - e.x) * c + (q.wy - e.y) * s;
    if (f > best) { best = f; t = q; }
  }
  return t ? { wx: t.wx, wy: t.wy, skala: +t.scale.toFixed(3) }
    : { brak: true, rekordy: (window.Turret2D.recordsFor(e) || []).map((q) => q.weaponId).slice(0, 12),
      auto: (e.autoWeapons || []).map((w) => [w.id, w.def?.mountType, !!w.hpOffset]).slice(0, 12) };
})()`;

const report = { tryb: null, warianty: {} };
const files = {}, files3d = {};
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4243};\n${INJECT}` });
  for (const v of VARIANTS) {
    logs.clear();
    const w0 = workerLogs.length;
    const glb = VARIANT_GLB[v] == null ? '' : `&bronieGlb=${encodeURIComponent(VARIANT_GLB[v])}`;
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${glb}${QUERY}` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.ship && window.__harness && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
    await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
    await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30 && !!window.DevScene?.equipDeathRay", 300000, 400)) {
      throw new Error('gra nie ruszyła');
    }
    await ev('window.__harness.hold(true)');
    report.tryb = await ev('window.__RENDER_MODE || window.RenderWorkerHost?.mode || (window.RenderWorkerHost ? "worker" : "off")');
    const k0 = await ev('window.__harness.frameLog.n');
    const prep = await ev(String.raw`(async () => {
      const H = window.__harness, S = H.scene;
      S.hideHud(true);
      window.setFogOfWar?.(false);
      DevScene.preloadHullSprites();
      DevScene.teleport(${DEEP.x - 30000}, ${DEEP.y}, 0);
      const r = spawnCallInShip('supercapital', { mode: 'friendly', spawnPos: { x: ${DEEP.x}, y: ${DEEP.y} }, spawnAngle: -0.35 });
      const e = Array.isArray(r) ? r[0] : r;
      if (!e) return { error: 'brak Colossusa' };
      e.ai = () => {}; e.vx = 0; e.vy = 0; e.angVel = 0;
      const n = DevScene.equipDeathRay(e);
      // Wieże NPC rysują się z autoWeapons (Turret2D.sync) — budowa raz (mózg wyłączony, więc nie strzela).
      (await import('/src/ai/capitalAI.js')).processAutonomousWeapons(e, 0);
      window.__wpColossus = e;
      S.cam(e.x, e.y, 0.3);
      await H.step(30);
      S.cam(e.x, e.y, 0.3);
      for (let i = 0; i < 600 && !S.hullsReady(); i++) await H.frames(2);
      await H.step(30);
      await H.frames(12);
      const w = await import('/src/3d/ships3d/weapons/weapons3D.js');
      const m = w.buildWeapon3D('deathRay');
      const t = (k) => m.parts[k].build().triangleCount;
      return { gniazda: n, typ: e.type, poz: [Math.round(e.x - ${DEEP.x}), Math.round(e.y - ${DEEP.y})], warp: !!(e.__warpReturn || e.warpIn || e.__warpArrival),
        dead: !!e.dead, wNpcs: npcs.includes(e), auto: (e.autoWeapons || []).filter((w) => w.id === 'death_ray').length, kadlub: e.hullId || e.__hullId || null, zrodlo: m.source, trojkatyLOD0: t('ring') + t('housing') + t('barrel') };
    })()`);
    console.log(v, JSON.stringify(prep));
    if (prep.error) throw new Error(prep.error);
    const vr = (report.warianty[v] = { ...prep, kadry: {} });
    // Kurs wieży: cel na prawo od dziobu (wieża obraca się — widać korpus i lufę pod kątem).
    for (const z of ZOOMS) {
      const t = await ev(turretAt);
      if (!t || t.brak) throw new Error(`brak wieży death_ray w rekordach Colossusa (${v}): ${JSON.stringify(t)}`);
      await ev(`(async () => { window.__harness.scene.cam(${t.wx}, ${t.wy}, ${z}); await window.__harness.frames(8); return true; })()`);
      const partie = await batchInfo();
      const f = join(out, 'kadry', `z${z}--${v}.png`);
      await screenshotPng(cdp, f);
      ((files[z] ||= {})[v] = f);
      vr.kadry[`z${z}`] = { ...t, lod: lodOf(partie) };
      console.log('zrzut', v, `zoom ${z}`, `skala ${t.skala}`, lodOf(partie));
    }
    for (const k of CAMS3D) {
      await ev(`(async () => { const H = window.__harness, S = H.scene;
        const t = ${turretAt};
        S.cam(t.wx, t.wy, ${ZOOM3D});
        window.Game3D.setCamera(${JSON.stringify(k)});
        window.Game3D.focusEntity = ${JSON.stringify(k)} === 'orbit' ? { pos: { x: t.wx, y: t.wy }, angle: window.__wpColossus.angle, z: 0 } : null;
        const r = window.Game3D.rig; r.az = ${Number(args.az3d ?? -35)}; r.el = ${Number(args.el3d ?? 28)}; r.first = true;
        await H.frames(12); return true; })()`);
      const partie = await batchInfo();
      const f = join(out, 'kadry', `3d-${k}--${v}.png`);
      await screenshotPng(cdp, f);
      ((files3d[k] ||= {})[v] = f);
      vr.kadry[`3d-${k}`] = { lod: lodOf(partie) };
      console.log('zrzut', v, '3d', k, lodOf(partie));
      await ev(`(async () => { window.Game3D.focusEntity = null; window.Game3D.setCamera('classic'); await window.__harness.frames(4); return true; })()`);
    }
    vr.pipeline = await ev(`(() => {
      const L = window.__harness.pipes.list.filter((p) => p.k >= ${k0} && !p.budowa);
      const sync = L.filter((p) => p.sync && !p.compute);
      return { render: sync.length, compute: L.filter((p) => p.compute).length, lista: [...new Set(sync.map((p) => p.nazwa))].slice(0, 12) };
    })()`);
    const wl = workerLogs.slice(w0);
    vr.pipeline.worker = wl.filter((l) => l.includes('pipeline sync')).length;
    vr.pipeline.workerLista = wl.filter((l) => l.includes('pipeline sync')).slice(0, 12);
    vr.bledy = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 30);
    vr.workerBledy = wl.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
    console.log('  pipeline', JSON.stringify(vr.pipeline), 'błędy', vr.bledy.length + vr.workerBledy.length);
    if (vr.bledy.length || vr.workerBledy.length) console.log('  ' + [...vr.bledy, ...vr.workerBledy].join('\n  '));
  }

  // Zestawienia: wycinek 1:1 wokół wieży (środek kadru), warianty obok siebie; kamery 3D — cały kadr w połowie.
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  const compose = async (list, crop) => ev(`(async () => {
    const list = ${JSON.stringify(list)};
    const imgs = await Promise.all(list.map((e) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + e.data; })));
    const crop = ${JSON.stringify(crop)};
    const w = crop ? crop[0] : Math.round(imgs[0].width / 2), h = crop ? crop[1] : Math.round(imgs[0].height / 2), gap = 6;
    const c = document.createElement('canvas'); c.width = w * imgs.length + gap * (imgs.length - 1); c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#555'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = !crop;
    imgs.forEach((im, k) => {
      const x = k * (w + gap);
      if (crop) g.drawImage(im, (im.width - w) / 2, (im.height - h) / 2, w, h, x, 0, w, h); else g.drawImage(im, x, 0, w, h);
      g.font = '600 14px system-ui, sans-serif'; g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x + 6, 6, g.measureText(list[k].label).width + 12, 22);
      g.fillStyle = '#e8f2ff'; g.fillText(list[k].label, x + 12, 22);
    });
    return c.toDataURL('image/png').slice(22);
  })()`, 60000);
  for (const z of ZOOMS) {
    const list = VARIANTS.map((v) => ({ label: `${LABEL[v] || v} · zoom ${z} · ${report.warianty[v].kadry[`z${z}`].lod}`, data: readFileSync(files[z][v]).toString('base64') }));
    const f = join(out, `ab-z${z}.png`);
    writeFileSync(f, Buffer.from(await compose(list, [CW, CH]), 'base64'));
    console.log('zestawienie', f);
  }
  for (const [k, byVar] of Object.entries(files3d)) {
    const list = VARIANTS.map((v) => ({ label: `${LABEL[v] || v} · kamera ${k} · ${report.warianty[v].kadry[`3d-${k}`].lod}`, data: readFileSync(byVar[v]).toString('base64') }));
    const f = join(out, `ab-3d-${k}.png`);
    writeFileSync(f, Buffer.from(await compose(list, null), 'base64'));
    console.log('zestawienie', f);
  }
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', e.message);
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 1));
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
