// Dekompresja i pożary budowli bazy piratów W GRZE (2026-10-19: src/game/story/pirateBaseAtmosphere.js — decyzje,
// src/3d/pirateBaseVents3D.js — obraz). Vite (własny serwer) + headless Chrome z WebGPU, skok dev ?story=shipyard.
//
//   node scripts/webgpu/dekompresja-gra.mjs [--tryb prog,krater,szyja,magazyn,final,koszt] [--out .tmp/dekompresja]
//     [--worker 1] [--rozmiar 1600x900] [--zoom 0.22] [--blisko 0.55] [--k3d 1]
//
// prog    — próg punktów habitatu przy ścianie bębna od południa (applyDamageToStation → onBaseDamageStep →
//           storyBaseBreak): pęknięcie ćwiartki, wyrwa (strumień pary i lodu), ogień w wylatującym tlenie, szczątki;
//           kadry w kilku chwilach z góry (zoom domyślny i bliski) i z kamery 3D (K).
// krater  — strzały armatą Atlasa w ścianę bębna (kratery broni w ciele kawałka — HullBodies.onImpact): krótki syk.
// szyja   — zerwanie szyi habitatu (window.snapPirateBaseNeck): wylot z kikuta wieży (wyrwa jedzie z bryłą) i szybu.
// magazyn — próg punktów magazynu (pęknięcie M-1 — wylot, pożar towarów).
// final   — habitat do zera (StoryGame._chainExplosion: ćwiartki, szyb, wieża, dysk — implozja, ogień).
// glebia  — wyrwa w dysku mieszkalnym (pass tła) i na sztucznej bryle spadającej od głowy wieży do −9 km (kontrakt breach /
//           ignite z encją ciała 3D — efekt jedzie z ciałem; domena głęboka reżysera wybuchów, gdy ją ma).
// koszt   — scenariusz „prog” DWA RAZY: z atmosferą i bez (PirateBaseAtmosphere.tune.enabled = false) — mediana i p95
//           czasu GPU klatki (Core3D.gpuFrameMs) i klatki w oknie 0–6 s po pęknięciu; tryb off (Core3D strony).
// Wszystkie: pipeline'y tworzone synchronicznie w klatkach scenariusza (ma być 0), stan atmosfery i obrazu wyrw.
// --worker 1 — render w workerze (tryb gracza; stan obrazu wyrw i pipeline'y z dziennika workera).
// Raport: <out>/raport.json, kadry PNG.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const WORKER = String(args.worker || '0') === '1';
const out = resolve(repo, args.out || (WORKER ? '.tmp/dekompresja-worker' : '.tmp/dekompresja'));
mkdirSync(out, { recursive: true });
const tryby = String(args.tryb || 'prog,krater,szyja,magazyn,final').split(',').map((s) => s.trim()).filter(Boolean);
const ZOOM = Number(args.zoom || 0.22);
const NEAR = Number(args.blisko || 0.55);
const K3D = String(args.k3d || '1') === '1';

const { server, base } = await startVite(Number(args.port || 5391));
const chrome = await startChrome({ width: W, height: H, renderMode: WORKER ? 'worker' : 'off' });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { worker: WORKER, tryby: {}, bledy: [] };

// Pipeline'y renderu tworzone SYNCHRONICZNIE w klatkach (nikt ich nie rozgrzał) — ma być 0 (tryb off: Core3D strony).
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, t: performance.now(), nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

async function startStory(phase) {
  for (let i = 0; ; i++) {
    try { return await startStoryOnce(phase); } catch (err) {
      if (i >= 2) throw err;
      console.log(`start fazy ${phase} — ponowienie (${err.message})`);
    }
  }
}
async function startStoryOnce(phase) {
  const q = WORKER ? '&renderWorker=1' : '&renderWorker=0';
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${phase}${q}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.rwHost', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await sleep(1500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, `window.StoryGame.active && window.StoryGame.phase === '${phase}' && !!window.StoryGame.site?.station`, 300000, 400)) throw new Error(`faza ${phase} nie ruszyła`);
  await sleep(2500);
  // Atlas nieśmiertelny, wieże na auto wstrzymane, mgła wyłączona (baza widoczna)
  await ev(`(() => {
    window.setFogOfWar?.(false);
    if (!window.__guard) window.__guard = setInterval(() => { const s = window.ship; if (!s) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; if (window.fireControl) window.fireControl.posture = 'hold'; }, 100);
    return true;
  })()`);
}

const placeHub = (x, z, heading) => ev(`(() => {
  const S = window.StoryGame, d = S.site.dock, ship = window.ship;
  const p = d.toGame(${x}, ${z});
  const a = d.headingToGame(${heading});
  S.deps.placePlayer(p.x, p.y, a);
  ship.vel.x = 0; ship.vel.y = 0;
  return true;
})()`);
const camHub = (x, z, zoom) => ev(`(() => {
  const site = window.StoryGame.site, c = window.camera;
  const p = site.dock.toGame(${x}, ${z});
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  c.transition = null;
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective, .st-dialogue')) el.style.display = 'none';
  return true;
})()`);
const keyEv = (type, k, code, vk) => cdp.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
const tapK = async () => { await keyEv('keyDown', 'k', 'KeyK', 75); await sleep(40); await keyEv('keyUp', 'k', 'KeyK', 75); };
const camClassic = () => ev(`(() => { const G = window.Game3D; if (G && G.setCamera) G.setCamera('classic'); return true; })()`);
const cam3D = (mode = 'tactical') => ev(`(() => { const G = window.Game3D; if (G && G.setCamera) { G.setCamera('${mode}'); return true; } return false; })()`);

const pipesSince = (t0) => ev(`(() => {
  const R = window.__pipeRec; if (!R) return null;
  const s = R.pipes.filter((p) => p.sync && p.t >= ${t0});
  return { sync: s.length, lista: [...new Set(s.map((p) => p.nazwa))].slice(0, 12) };
})()`);
const nowMs = () => ev('performance.now()');

// stan atmosfery (gra) i obrazu wyrw (render strony — tryb off)
const atmo = () => ev(`(() => {
  const A = window.PirateBaseAtmosphere; if (!A) return null;
  const S = A.state();
  const mods = S.modules.filter((m) => m.breached || m.burning || m.smolder > 0.02 || m.rho < 0.999).map((m) => ({ id: m.id,
    p: +(m.rho * m.T).toFixed(3), T: +m.T.toFixed(2), o2: +m.x.toFixed(3), ogien: +m.fire.toFixed(2), zar: +m.smolder.toFixed(2), wypalony: m.spent }));
  const vents = S.vents.map((v) => ({ id: v.id, m: v.module.id, glowna: v.main, r: Math.round(v.size), strumien: +v.flow.toFixed(3),
    ogien: +v.fire.toFixed(2), zar: +v.smolder.toFixed(2), z: Math.round(v.wz), cialo: !!v.ent }));
  const V = window.__pirateVents3D, X = window.__explosions;
  const dom = X ? X.grid.slots.filter((s) => s.active && s.tag === 9).map((s) => ({ h: +s.h.toFixed(1), fade: +s.fade.toFixed(2), z: Math.round(s.cz) })) : null;
  return { t: +S.time.toFixed(2), moduly: mods, wyrwy: vents, stats: { ...S.stats }, obraz: V ? { ...V.stats } : null, domenyWylotu: dom,
    domeny: X ? X.grid.stats.active : null };
})()`);

async function shot(name) {
  await sleep(60);
  await screenshotPng(cdp, join(out, `${name}.png`));
}
// seria kadrów w chwilach `times` [s] od t0 (czas rzeczywisty — gra biegnie)
async function series(prefix, t0, times, camFn = null) {
  const rows = [];
  for (const at of times) {
    const wait = t0 + at * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    if (camFn) await camFn(at);
    await shot(`${prefix}-${String(at).replace('.', '_')}s`);
    const a = await atmo();
    rows.push({ t: at, ...a });
    console.log(`${prefix} ${at}s`, JSON.stringify({ wyrwy: a?.wyrwy?.length, moduly: a?.moduly, obraz: a?.obraz, dom: a?.domenyWylotu }));
  }
  return rows;
}

// Próg punktów habitatu przy ścianie bębna (hub: x, z) — kawałek pod trafieniem pęka (onBaseDamageStep).
const habitatStep = (hx, hz) => ev(`(() => {
  const S = window.StoryGame, st = S.site.structures.habitat, d = S.site.dock;
  const p = d.toGame(${hx}, ${hz});
  st.lastHitX = p.x; st.lastHitY = p.y;
  const before = st.hp;
  // do najbliższego progu (1/steps maks. punktów) i odrobinę dalej
  const step = st.maxHp / Math.max(1, st.damageSteps || 8);
  const next = Math.floor((st.hp - 1) / step) * step;
  window.applyDamageToStation(st, Math.max(1, st.hp - next + 5));
  return { przed: Math.round(before), po: Math.round(st.hp), zlamane: window.PirateBase.broken() };
})()`);

async function trybProg() {
  await startStory('shipyard');
  const L = await ev(`(() => { const l = window.StoryGame.site.dock.layout; return { drumR: l.habitat.drumR }; })()`);
  // Atlas 4 km na południe (bańka ciał obejmuje bęben), dziobem ku habitatowi
  await placeHub(0, 4000, -Math.PI / 2);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  await sleep(1500);
  await camHub(0, L.drumR * 1.2, ZOOM);
  await shot('prog-00-przed');
  const tp = await nowMs();
  const t0 = Date.now();
  const r = await habitatStep(0, L.drumR * 0.9);
  console.log('próg:', JSON.stringify(r));
  const rows = await series('prog-a', t0, [0.15, 0.6, 1.5, 3, 6]);
  // bliżej i z kamery 3D (kolejne pęknięcie — ćwiartka wschodnia)
  await camHub(L.drumR * 1.25, 0, NEAR);
  const t1 = Date.now();
  const r2 = await habitatStep(L.drumR * 0.9, 0);
  console.log('próg 2:', JSON.stringify(r2));
  const rows2 = await series('prog-b-blisko', t1, [0.2, 0.8, 2, 4]);
  let rows3 = null;
  if (K3D) {
    await camHub(-L.drumR * 1.2, 0, ZOOM * 1.4);
    const ok = await cam3D('tactical');
    const t2 = Date.now();
    const r3 = await habitatStep(-L.drumR * 0.9, 0);
    console.log('próg 3 (kamera 3D):', ok, JSON.stringify(r3));
    rows3 = await series('prog-c-3d', t2, [0.3, 1.2, 3]);
    await camClassic();
  }
  report.tryby.prog = { prog: r, kadry: rows, prog2: r2, kadry2: rows2, kadry3D: rows3, pipeline: await pipesSince(tp) };
}

async function trybKrater() {
  await startStory('shipyard');
  const L = await ev(`(() => { const l = window.StoryGame.site.dock.layout; return { drumR: l.habitat.drumR }; })()`);
  // ściana południowa (ćwiartka H-S) — od wschodu i zachodu stoją pomosty (nie mają powietrza), z południa nic nie zasłania
  await placeHub(0, L.drumR + 2600, -Math.PI / 2);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  await sleep(1500);
  await camHub(0, L.drumR + 200, NEAR);
  const tp = await nowMs();
  const t0 = Date.now();
  // broń z lufy 2,4 km od ściany południowej w ścianę, cele rozłożone wzdłuż ściany (pociski trafiają ciało kawałka —
  // kratery broni, każdy w innej kajucie)
  const bron = String(args.bron || 'armata_mk1');
  const n = await ev(`new Promise((res) => {
    const d = window.StoryGame.site.dock;
    let k = 0;
    const tick = () => {
      const a = Math.PI / 2 + (k - 2.5) * 0.11;
      const R = ${L.drumR};
      const t = d.toGame(Math.cos(a) * (R - 30), Math.sin(a) * (R - 30)), p = d.toGame(Math.cos(a) * (R + 2400), Math.sin(a) * (R + 2400));
      const dx = t.x - p.x, dy = t.y - p.y, l = Math.hypot(dx, dy) || 1;
      const muzzle = { pos: { x: p.x, y: p.y }, dir: { x: dx / l, y: dy / l }, baseVel: { x: 0, y: 0 } };
      try { window.fireWeaponCore(window.ship, null, '${bron}', muzzle); } catch (e) { console.error('[dekompresja] strzał', e); }
      if (++k >= 6) { clearInterval(h); res(k); }
    };
    const h = setInterval(tick, 450);
    tick();
  })`, 60000);
  const rows = await series('krater', t0, [0.5, 1.2, 2.2, 3.4, 4.6]);
  report.tryby.krater = { strzaly: n, kadry: rows, pipeline: await pipesSince(tp) };
}

async function trybSzyja() {
  await startStory('shipyard');
  await placeHub(5200, 0, Math.PI);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  // wszystkie kawałki habitatu ciałami (wieża i dysk — bryły 3D)
  await ev(`(() => { const st = window.StoryGame.site.structures.habitat; window.WorldBodies.setAllLive(st._worldSite, true); return true; })()`);
  await sleep(3500);
  await camHub(0, 0, ZOOM * 1.2);
  await shot('szyja-00-przed');
  const tp = await nowMs();
  const t0 = Date.now();
  const ok = await ev('window.snapPirateBaseNeck(-1, 0, 3000)');
  console.log('szyja:', ok);
  const rows = await series('szyja', t0, [0.3, 1.5, 3, 5, 7.5]);
  let rows3 = null;
  if (K3D) {
    await cam3D('tactical');
    rows3 = await series('szyja-3d', Date.now(), [0.2, 2]);
    await camClassic();
  }
  report.tryby.szyja = { zerwana: ok, kadry: rows, kadry3D: rows3, pipeline: await pipesSince(tp) };
}

async function trybMagazyn() {
  await startStory('shipyard');
  const W0 = await ev(`(() => { const w = window.StoryGame.site.dock.layout.warehouse; return { x: w.x, z: w.z, w: w.w, d: w.d }; })()`);
  await placeHub(W0.x, W0.z + 3600, -Math.PI / 2);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  await sleep(1500);
  await camHub(W0.x, W0.z, ZOOM * 1.4);
  const tp = await nowMs();
  const t0 = Date.now();
  const r = await ev(`(() => {
    const S = window.StoryGame, st = S.site.structures.warehouse, d = S.site.dock;
    const p = d.toGame(${W0.x}, ${W0.z + W0.d * 0.45});
    st.lastHitX = p.x; st.lastHitY = p.y;
    const step = st.maxHp / Math.max(1, st.damageSteps || 4);
    const next = Math.floor((st.hp - 1) / step) * step;
    window.applyDamageToStation(st, Math.max(1, st.hp - next + 5));
    return { hp: Math.round(st.hp), zlamane: window.PirateBase.broken() };
  })()`);
  console.log('magazyn:', JSON.stringify(r));
  const rows = await series('magazyn', t0, [0.3, 1.2, 2.5, 5]);
  report.tryby.magazyn = { prog: r, kadry: rows, pipeline: await pipesSince(tp) };
}

async function trybFinal() {
  await startStory('shipyard');
  await placeHub(0, 4500, -Math.PI / 2);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  await ev(`(() => { const st = window.StoryGame.site.structures.habitat; window.WorldBodies.setAllLive(st._worldSite, true); return true; })()`);
  await sleep(3500);
  await camHub(0, 0, ZOOM * 0.75);
  await shot('final-00-przed');
  const tp = await nowMs();
  const t0 = Date.now();
  await ev(`(() => { const st = window.StoryGame.site.structures.habitat; window.applyDamageToStation(st, st.hp + 10); return true; })()`);
  const rows = await series('final', t0, [0.5, 1.4, 2.4, 3.5, 5, 7.5, 11]);
  let rows3 = null;
  if (K3D) {
    await cam3D('tactical');
    rows3 = await series('final-3d', Date.now(), [0.2, 2.5]);
    await camClassic();
  }
  report.tryby.final = { kadry: rows, kadry3D: rows3, pipeline: await pipesSince(tp) };
}

// Głębia: wyrwa w dysku mieszkalnym (z ≈ −950 — pass tła) i wyrwa na SZTUCZNEJ bryle spadającej od głowy wieży do −9 km
// (kontrakt fizyki upadku: breach / ignite z encją ciała 3D — punkt i normalna w układzie ciała, pozycja co krok).
async function trybGlebia() {
  await startStory('shipyard');
  await placeHub(0, 5200, -Math.PI / 2);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  await sleep(1500);
  await camHub(0, 1200, ZOOM);
  const tp = await nowMs();
  // dysk: sektor południowy (D-3 — kąt π/2), pęknięcie z zapłonem
  const t0 = Date.now();
  const d = await ev(`(() => { const A = window.PirateBaseAtmosphere; const id = A.test({ module: 'D-3', fire: true }); return { id, v: A.vents().map((v) => ({ m: v.module.id, z: Math.round(v.wz) })) }; })()`);
  console.log('dysk:', JSON.stringify(d));
  const rows = await series('glebia-dysk', t0, [0.4, 1.5, 3]);
  // bryła spadająca: start w głowie wieży, opada z przyspieszeniem 400 j/s² (grawitacja habitatu) i obraca się
  const t1 = Date.now();
  const f = await ev(`(() => {
    const S = window.StoryGame, hc = S.site.dock.habitat;
    const body = { pos: { x: hc.x + 400, y: -(hc.y + 900), z: 1500 }, vel: { x: 0, y: 0, z: 0 }, angVel: { x: 0.25, y: 0, z: 0.1 },
      quat: { x: 0, y: 0, z: 0, w: 1 }, planar: false, dead: false, radius: 300 };
    const e = { x: body.pos.x, y: -body.pos.y, solid3D: true, beamHull: { body, solid3D: true, dmgKey: 0 } };
    e.beamHull.entity = e;
    window.__fallBody = e;
    const A = window.PirateBaseAtmosphere;
    const id = A.breach({ module: 'H-T', x: e.x + 260, y: e.y, z: 1500, nx: 1, ny: 0, nz: 0.2, size: 160, entity: e, kind: 'break' });
    A.ignite({ module: 'H-T' });
    let last = performance.now();
    window.__fallTimer = setInterval(() => {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (body.pos.z < -9000) { body.vel.z = 0; return; }
      body.vel.z -= 400 * dt; body.pos.z += body.vel.z * dt;
      const w = body.angVel, q = body.quat, h = dt * 0.5;
      const qx = q.x + h * (w.x * q.w + w.y * q.z - w.z * q.y), qy = q.y + h * (w.y * q.w + w.z * q.x - w.x * q.z);
      const qz = q.z + h * (w.z * q.w + w.x * q.y - w.y * q.x), qw = q.w - h * (w.x * q.x + w.y * q.y + w.z * q.z);
      const l = Math.hypot(qx, qy, qz, qw); q.x = qx / l; q.y = qy / l; q.z = qz / l; q.w = qw / l;
      e.x = body.pos.x; e.y = -body.pos.y;
    }, 16);
    return { id };
  })()`);
  console.log('bryła:', JSON.stringify(f));
  const rows2 = await series('glebia-spadek', t1, [0.5, 2, 4, 6.5]);
  await ev('(() => { clearInterval(window.__fallTimer); return true; })()');
  report.tryby.glebia = { dysk: d, kadryDysk: rows, bryla: f, kadrySpadek: rows2, pipeline: await pipesSince(tp) };
}

// A/B kosztu: ten sam scenariusz (próg punktów bębna) z atmosferą i bez; okno 0–6 s po pęknięciu.
async function trybKoszt() {
  const runOne = async (on) => {
    await startStory('shipyard');
    const L = await ev(`(() => { const l = window.StoryGame.site.dock.layout; return { drumR: l.habitat.drumR }; })()`);
    await placeHub(0, 4000, -Math.PI / 2);
    await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
    await ev(`(() => { window.PirateBaseAtmosphere.tune.enabled = ${on}; return true; })()`);
    await sleep(2500);
    await camHub(0, L.drumR * 1.2, Number(args.zoomKoszt || 0.3));
    await sleep(1500);
    await ev(`(() => {
      const R = window.__kz = { on: false, gpu: [], dt: [], last: 0 };
      const C = window.Core3D;
      const tick = (t) => { requestAnimationFrame(tick); if (R.on) { if (R.last) R.dt.push(t - R.last); const g = C.gpuFrameMs; if (g > 0) R.gpu.push(g); } R.last = t; };
      requestAnimationFrame(tick);
      return true;
    })()`);
    const tp = await nowMs();
    await habitatStep(0, L.drumR * 0.9);
    await ev('(() => { window.__kz.on = true; return true; })()');
    await sleep(6000);
    const s = await ev(`(() => {
      const R = window.__kz; R.on = false;
      const q = (a, f) => { const b = a.slice().sort((x, y) => x - y); return b.length ? +b[Math.min(b.length - 1, Math.floor(b.length * f))].toFixed(3) : 0; };
      return { klatek: R.dt.length, klatkaP50: q(R.dt, 0.5), klatkaP95: q(R.dt, 0.95), gpuP50: q(R.gpu, 0.5), gpuP95: q(R.gpu, 0.95), gpuMax: q(R.gpu, 1), probekGpu: R.gpu.length };
    })()`);
    s.pipeline = await pipesSince(tp);
    s.atmo = await atmo();
    return s;
  };
  const A = await runOne(true);
  const B = await runOne(false);
  const A2 = await runOne(true);
  const B2 = await runOne(false);
  report.tryby.koszt = { z: [A, A2], bez: [B, B2] };
  console.log('KOSZT z atmosferą', JSON.stringify([A, A2].map((x) => ({ gpuP50: x.gpuP50, gpuP95: x.gpuP95, klatkaP50: x.klatkaP50 }))));
  console.log('KOSZT bez', JSON.stringify([B, B2].map((x) => ({ gpuP50: x.gpuP50, gpuP95: x.gpuP95, klatkaP50: x.klatkaP50 }))));
}

const RUN = { prog: trybProg, krater: trybKrater, szyja: trybSzyja, magazyn: trybMagazyn, final: trybFinal, glebia: trybGlebia, koszt: trybKoszt };
try {
  for (const t of tryby) {
    if (!RUN[t]) { console.log('nieznany tryb', t); continue; }
    console.log(`== ${t}`);
    try { await RUN[t](); } catch (err) { console.error(`tryb ${t}:`, err); report.bledy.push(`${t}: ${err.message}`); }
  }
} finally {
  report.bledyKonsoli = logs.errors().slice(0, 60);
  report.logi = logs.all().filter((l) => /pipeline sync|wyrwy|\[render\.worker\]/i.test(l)).slice(0, 80);
  writeJson(join(out, 'raport.json'), report);
  console.log('raport:', join(out, 'raport.json'));
  await chrome.close();
  await server.close();
}
