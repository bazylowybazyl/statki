// Profil DUŻEJ bitwy flot w prawdziwej grze (2026-10-07): piraci vs Terra Nova, skład na stronę z --sklad
// (fregaty, niszczyciele, pancerniki, supercapitale). Vite + headless Chrome z GPU przez CDP (pomocniki
// z dema/rdzen-cdp.js — jak scripts/profil-bitwy.mjs), gra z ?dev w trybie SWOBODNYM (kampania stawia gracza w
// doku K-7 i zamraża świat w scenach), statek gracza przeniesiony w pustą przestrzeń daleko od planet i ringu,
// gracz nieśmiertelny (kadłub i tarcza dolewane co 100 ms — inaczej koniec gry w połowie pomiaru).
//   node scripts/profil-bitwy-flot.mjs --sklad 50,20,10,3 [--trwanie 100] [--profile 1:3,8:6,45:6] [--prof 6]
//        [--co 3] [--zoom 0.1] [--seed 7] [--diag 1] [--query physHz=60] [--out katalog] [--port 5294]
// Wynik: próbki PerfHUD co --co sekund (fps, klatka, fizyka / krok, podkroki, AI, pociski, kolizje, U hex,
// Core3D, passy, GPU), spokój przed bitwą, profile CPU (Profiler CDP) w chwilach --profile (s od pojawienia się
// flot, `:długość`) rozbite na loop / physicsStep (też ms na krok) / render / updateHexShips3D / renderSingle +
// self-time strony; probki.json i .cpuprofile w --out (DevTools → Performance → Load profile). --profile 999 = bez
// profilu. --diag 1: pary narrowphase silnika belek (typy, węzły, kontakt), wywołania WebGPU na klatkę, obiekty
// renderu three liczone od nowa, tryb słownikowy i mapy V8 obiektów gry (Chrome z --allow-natives-syntax).
// Bitwa jest chaotyczna mimo ziarna (czas rzeczywisty) — A/B na kilku przebiegach na przemian.
// Wyniki 2026-10-07: docs/AUDYT-wydajnosc-bitwa-2026-10-07.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, navigateAndWait, evaluate, sleep } from '../dema/rdzen-cdp.js';
import { startChrome } from './webgpu/wspolne.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SKLAD = String(arg('sklad', '50,20,10,3')).split(',').map((v) => Math.max(0, Number(v) || 0));
const [NF, ND, NB, NS] = [SKLAD[0] || 0, SKLAD[1] || 0, SKLAD[2] || 0, SKLAD[3] || 0];
const TRWANIE = Number(arg('trwanie', 100));
const PROF = Number(arg('prof', 6));
// --profile 0:3,8:6 — chwila startu profilu w s od pojawienia się flot, opcjonalnie :długość (domyślnie --prof).
const PROFILE_AT = String(arg('profile', '25,70')).split(',').filter(Boolean)
  .map((v) => { const [a, d] = v.split(':').map(Number); return { at: a, dur: Number.isFinite(d) && d > 0 ? d : PROF }; })
  .filter((p) => p.at >= 0);
// --diag 1: liczniki par narrowphase silnika belek (kto z kim, węzły, kontakty) i wywołań WebGPU na klatkę.
// Opakowania kosztują trochę CPU — przebieg diagnostyczny, nie do porównań ms.
const DIAG = arg('diag', '0') === '1';
const CO = Number(arg('co', 3));
const ZOOM = Number(arg('zoom', 0.1));
const PORT = Number(arg('port', 5294));
const SEED = arg('seed', null);
// --query 'physHz=60' — dodatkowe parametry adresu gry (np. A/B kroku fizyki).
const QUERY = arg('query', '');
// Kroki fizyki na takt AI (20 Hz): liczymy kroki z licznika taktów AI gry (window.__aiDecisionTickId).
const STEPS_PER_AI = (Number((QUERY.match(/physHz=(\d+)/) || [])[1]) || 120) / 20;
const OUT = arg('out', join(tmpdir(), `profil-bitwy-flot-${SKLAD.join('-')}`));
mkdirSync(OUT, { recursive: true });

const { server, base } = await startVite(PORT);
// webgpu: false — bez flag „unsafe” (domyślny WebGPU Chrome jak u gracza); --diag: %HasFastProperties w stronie.
const chrome = await startChrome({ width: 1920, height: 1080, webgpu: false,
  extraArgs: DIAG ? ['--js-flags=--allow-natives-syntax'] : [] });
const { cdp, logs } = chrome;
// Swobodna gra bez samouczka; --seed: Math.random z ziarnem (mulberry32) przed skryptami strony.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {}
  ${SEED !== null ? `let s = ${Number(SEED) >>> 0};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };` : ''}
})();` });
const ev = (expr) => evaluate(cdp, expr);
const report = (label, value) => console.log(String(label).padEnd(12), typeof value === 'string' ? value : JSON.stringify(value));
const errors = () => logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));

// Próbka: cały PerfHUD.display (pola liczbowe) + stan bitwy i passy Core3D.
const HUD_EXPR = `(() => { const d = window.__PH.display; const r = (v) => Math.round(v * 1000) / 1000;
  const hud = {}; for (const k in d) if (typeof d[k] === 'number' && Number.isFinite(d[k])) hud[k] = r(d[k]);
  const npcs = window.npcs || [], live = npcs.filter((n) => !n.dead && !n.fighter);
  const C = window.Core3D, P = window.__rendererInfo?.passes || C?.lastFrameRenderInfo || {};
  const passes = {}; for (const k in P) if (P[k] && P[k].calls) passes[k] = [P[k].calls, Math.round((P[k].triangles || 0) / 1000), r(P[k].ms || 0)];
  const HB = window.HullBodies; let nodes = 0, bodies = 0;
  for (const h of (HB?._hulls || [])) { const b = h?.body; if (b && !b.dead) { bodies++; nodes += b.activeNodes || 0; } }
  const lod = window.__hexLodStats || {};
  const guns = {}; for (const n of live) for (const g in (n.weapons || {})) guns[g] = (guns[g] || 0) + ((n.weapons[g] || []).length || 0);
  const sh = typeof window.getShieldPoolStats === 'function' ? window.getShieldPoolStats() : null;
  return { hud, stan: {
    npc: live.length, piraci: live.filter((n) => !n.friendly).length, tn: live.filter((n) => n.friendly).length,
    mysliwce: npcs.filter((n) => !n.dead && n.fighter).length,
    wraki: (window.wrecks || []).length, zimne: (window.coldWrecks || []).length,
    pociski: (window.bullets || []).length, rakiety: window.rocketSystem3D?.rockets?.length ?? window.rocketSystem3D?.active?.length ?? null,
    cialaBelek: bodies, wezly: nodes, kontakty: HB?.perf?.lastContacts, hbStepMs: r(HB?.perf?.lastStepMs || 0),
    pelne: lod.fullBodies, smugi: lod.impostorBodies, tarcze: sh ? sh.alive : null, dziala: guns,
    silnik: (() => { const p = HB?.engine?.perf || {}; return { bp: p.broadphasePairs, aabbOdrz: p.aabbRejected, np: p.narrowphasePairs,
      kontakty: p.contacts, lookups: p.hashLookups, kolMs: r(p.lastCollisionMs || 0), krokMs: r(p.lastUpdateMs || 0) }; })(),
    graczZyje: !window.ship?.destroyed },
  diag: window.__diag ? window.__diag.take() : null,
  gpu: { gpuMs: r(Number(C?.gpuFrameMs) || 0), computeMs: r(Number(C?.gpuComputeMs) || 0),
    composer: r(C?.lastFramePerf?.composerMs || 0), renderTotal: r(C?.lastFramePerf?.renderTotalMs || 0),
    dc: window.__rendererInfo?.calls, tris: Math.round((window.__rendererInfo?.triangles || 0) / 1000),
    fx: C?.fxStats ? { dispatch: C.fxStats.dispatches, cpuMs: r(C.fxStats.cpuMs || 0) } : null }, passes }; })()`;

const KEY = ['fps', 'frameMs', 'frameP95', 'physicsTime', 'physicsPerStep', 'aiTime', 'projectileTime', 'collisionTime',
  'destructorTime', 'drawTime', 'render3dHexUpdateTime', 'render3dCoreRenderTime', 'rocketsTime'];
const short = (s) => {
  const h = s.hud, steps = h.physicsPerStep > 0 ? h.physicsTime / h.physicsPerStep : 0;
  return `fps ${h.fps} kl ${h.frameMs?.toFixed(1)} p95 ${h.frameP95?.toFixed(1)} | fiz ${h.physicsTime?.toFixed(2)} (${h.physicsPerStep?.toFixed(2)}/krok × ${steps.toFixed(2)}) ` +
    `AI ${h.aiTime?.toFixed(2)} poc ${h.projectileTime?.toFixed(2)} kol ${h.collisionTime?.toFixed(2)} | rys ${h.drawTime?.toFixed(2)} Uhex ${h.render3dHexUpdateTime?.toFixed(2)} ` +
    `core ${h.render3dCoreRenderTime?.toFixed(2)} | gpu ${s.gpu.gpuMs} dc ${s.gpu.dc} | npc ${s.stan.npc} (${s.stan.piraci}/${s.stan.tn}) wr ${s.stan.wraki} poc ${s.stan.pociski} węzły ${s.stan.wezly}`;
};

// --diag: opakowanie narrowphase silnika belek (HullBodies.engine.collideBodies) i wywołań WebGPU. Okno = od
// poprzedniej próbki. Pary: etykieta ciała = typ okrętu i strona (TN / P), wrak, gracz; „iter” = węzły ciała, po
// którym idzie skan (mniejsze z pary — koszt pary ∝ iter niezależnie od liczby kontaktów).
const DIAG_INSTALL = `(() => {
  const HB = window.HullBodies, D = HB.engine, orig = D.collideBodies;
  const lab = new Map(); let ids = 0;
  const rebuild = () => { lab.clear(); for (const h of HB._hulls) { const e = h.entity, b = h.body; if (!b) continue;
    lab.set(b, e?.isWreck ? 'wrak' : (e?.isPlayer ? 'gracz' : String(e?.type || '?').replace('pirate_', '') + (e?.friendly ? '/TN' : '/P'))); } };
  let w = null;
  const reset = () => { w = { calls: 0, ms: 0, iter: 0, withC: 0, contacts: 0, pairs: new Map(), distinct: new Set(), f0: window.__frameId || 0,
    k0: (window.__aiDecisionTickId || 0) * ${STEPS_PER_AI}, gpu: { writeBuffer: 0, writeBufferKB: 0, writeTexture: 0, writeTextureKB: 0, submit: 0,
      createBuffer: 0, createBindGroup: 0, createTexture: 0, createRenderPipeline: 0, createComputePipeline: 0 } }; };
  reset();
  D.collideBodies = function (A, B, dt, doDamage) {
    const c0 = this.perf.contacts, t0 = performance.now();
    const r = orig.call(this, A, B, dt, doDamage);
    const ms = performance.now() - t0, got = this.perf.contacts - c0;
    let la = lab.get(A), lb = lab.get(B);
    if (la === undefined || lb === undefined) { rebuild(); la = lab.get(A) || '?'; lb = lab.get(B) || '?'; }
    const iter = Math.min(A.activeNodes, B.activeNodes);
    w.calls++; w.ms += ms; w.iter += iter; w.contacts += got; if (got > 0) w.withC++;
    A.__dId ??= ++ids; B.__dId ??= ++ids;
    w.distinct.add(Math.min(A.__dId, B.__dId) * 100000 + Math.max(A.__dId, B.__dId));
    const key = la < lb ? la + ' × ' + lb : lb + ' × ' + la;
    const e = w.pairs.get(key) || { calls: 0, ms: 0, iter: 0, contacts: 0, withC: 0 };
    e.calls++; e.ms += ms; e.iter += iter; e.contacts += got; if (got > 0) e.withC++; w.pairs.set(key, e);
    return r;
  };
  const dev = window.Core3D?.renderer?.backend?.device;
  if (dev) {
    const q = dev.queue;
    const wq = (name, bytes) => { const o = q[name].bind(q); q[name] = (...a) => { w.gpu[name]++; if (bytes) w.gpu[name + 'KB'] += bytes(a) / 1024; return o(...a); }; };
    wq('writeBuffer', (a) => { const d = a[2], bpe = d?.BYTES_PER_ELEMENT || 1; return a[4] != null ? a[4] * bpe : (d?.byteLength || 0) - (a[3] || 0) * bpe; });
    wq('writeTexture', (a) => a[1]?.byteLength || 0);
    wq('submit');
    for (const name of ['createBuffer', 'createBindGroup', 'createTexture', 'createRenderPipeline', 'createComputePipeline']) {
      const o = dev[name].bind(dev); dev[name] = (...a) => { w.gpu[name]++; return o(...a); };
    }
  }
  // three r183: RenderObject liczy atrybuty od nowa po podmianie geometrii / atrybutu (inne id) albo jako nowy obiekt
  // renderu — co klatkę to zbędne getAttributes, wiązania i klucze. Licznik po nazwie siatki i materiału.
  const objs = window.Core3D?.renderer?._objects;
  const roAttr = new Map(), roNew = new Map();
  const roName = (ro) => { const o = ro.object, m = ro.material; return (o?.name || o?.type || '?') + ' / ' + (m?.name || m?.type || '?'); };
  if (objs && typeof objs.get === 'function') {
    const origGet = objs.get, origCreate = objs.createRenderObject;
    let hooked = false;
    objs.get = function (...a) {
      const ro = origGet.apply(this, a);
      if (!hooked && ro) {
        hooked = true;
        const proto = Object.getPrototypeOf(ro), ga = proto.getAttributes;
        proto.getAttributes = function () { if (this.attributes === null) { const k = roName(this); roAttr.set(k, (roAttr.get(k) || 0) + 1); } return ga.call(this); };
      }
      return ro;
    };
    if (typeof origCreate === 'function') objs.createRenderObject = function (...a) { const ro = origCreate.apply(this, a); const k = roName(ro); roNew.set(k, (roNew.get(k) || 0) + 1); return ro; };
  }
  window.__diag = { take() {
    const frames = Math.max(1, (window.__frameId || 0) - w.f0), steps = Math.max(1, (window.__aiDecisionTickId || 0) * ${STEPS_PER_AI} - w.k0);
    const top = [...w.pairs.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8)
      .map(([k, e]) => [k, +(e.ms / steps).toFixed(3), +(e.calls / steps).toFixed(1), Math.round(e.iter / Math.max(1, e.calls)), +(e.withC / Math.max(1, e.calls)).toFixed(2)]);
    const g = {}; for (const k in w.gpu) g[k] = +(w.gpu[k] / frames).toFixed(1);
    const out = { klatek: frames, krokow: steps, paryNaKrok: +(w.calls / steps).toFixed(1), roznychPar: w.distinct.size,
      msNaKrok: +(w.ms / steps).toFixed(3), iterNaPare: Math.round(w.iter / Math.max(1, w.calls)), zKontaktem: +(w.withC / Math.max(1, w.calls)).toFixed(2),
      kontaktyNaKrok: +(w.contacts / steps).toFixed(1), top, gpuNaKlatke: g,
      atrybutyOdNowa: [...roAttr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +(v / frames).toFixed(1)]),
      noweObiektyRenderu: [...roNew.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +(v / frames).toFixed(1)]) };
    roAttr.clear(); roNew.clear();
    reset(); return out; } };
  return { ok: true, gpu: !!dev };
})()`;
// --diag (Chrome z --allow-natives-syntax): ile obiektów gorących pętli V8 trzyma w trybie słownikowym
// (każdy odczyt pola = wyszukiwanie w haszu) i ile mają własnych pól.
const NATIVE_EXPR = `(() => {
  const st = (list) => { let fast = 0, slow = 0, keys = 0, n = 0;
    for (const o of list) { if (!o || typeof o !== 'object') continue; n++; keys += Object.keys(o).length; if (%HasFastProperties(o)) fast++; else slow++; }
    // różne klasy ukryte (mapy V8): > 4 w jednym miejscu odczytu = megamorficzny inline cache
    const reps = []; for (const o of list) { if (!o || typeof o !== 'object') continue; if (!reps.some((r) => %HaveSameMap(r, o))) reps.push(o); }
    return { n, szybkie: fast, slownik: slow, pol: n ? Math.round(keys / n) : 0, map: reps.length }; };
  const npcs = (window.npcs || []).filter((x) => !x.dead);
  return { npc: st(npcs), wraki: st(window.wrecks || []), pociski: st((window.bullets || []).slice(0, 400)),
    kadluby: st(npcs.map((x) => x.beamHull)), ciala: st(npcs.map((x) => x.beamHull?.body)), gracz: st([window.ship]) };
})()`;
const diagLine = (d) => `pary/krok ${d.paryNaKrok} (różnych ${d.roznychPar}) ${d.msNaKrok} ms/krok, iter ${d.iterNaPare} węzłów/parę, z kontaktem ${d.zKontaktem}, kontakty/krok ${d.kontaktyNaKrok}\n` +
  d.top.map(([k, ms, calls, iter, wc]) => `      ${k.padEnd(34)} ${String(ms).padStart(6)} ms/krok  ${String(calls).padStart(5)} par/krok  iter ${String(iter).padStart(5)}  z kontaktem ${wc}`).join('\n') +
  `\n      GPU/klatkę: ${JSON.stringify(d.gpuNaKlatke)}` +
  `\n      three — atrybuty od nowa /klatkę: ${JSON.stringify(d.atrybutyOdNowa)}` +
  `\n      three — nowe obiekty renderu /klatkę: ${JSON.stringify(d.noweObiektyRenderu)}`;

const samples = [];
const profiles = [];
try {
  const ready = await navigateAndWait(cdp, `${base}/index.html?dev=1${QUERY ? '&' + QUERY : ''}`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  let started = false;
  for (let t0 = Date.now(); !started && Date.now() - t0 < 240000;) {
    await sleep(250);
    try { started = await ev('(window.__frameId || 0) > 30 && !!window.camera'); } catch { /* ładuje się */ }
  }
  report('gra', { ready, started, gpu: await ev('!!window.Core3D?.ready') });
  await ev(`(async () => { const m = await import('/src/ui/perfHud.js'); window.__PH = m.PerfHUD; if (!m.PerfHUD.visible) m.PerfHUD.toggle(); return true; })()`);

  // Pusta przestrzeń: orbita w połowie między Wenus a Ziemią (poza pasem asteroid i studniami), kąt najdalej
  // od planet, księżyców i stacji.
  report('miejsce', await ev(`(() => {
    const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
    const st = (window.stations || []).map((s) => ({ x: s.x ?? s.pos?.x, y: s.y ?? s.pos?.y })).filter((p) => Number.isFinite(p.x));
    const sun = window.SUN || { x: 0, y: 0 };
    const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
    const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
    let best = null;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      let dmin = Infinity; for (const p of pl.concat(st)) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
      if (!best || dmin > best.dmin) best = { x, y, dmin };
    }
    window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    // Nieśmiertelny gracz: dolewka kadłuba i tarczy (pomiar nie kończy się ekranem końca gry).
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    return { x: Math.round(best.x), y: Math.round(best.y), odSlonca: Math.round(R), najblizejKm: Math.round(best.dmin / 1000) };
  })()`));

  // Spokój: ta sama scena bez bitwy.
  await sleep(4000);
  const calm = [];
  for (let i = 0; i < 4; i++) { await sleep(2000); const d = await ev(HUD_EXPR); calm.push(d); report('spokój', short(d)); }

  report('spawn', await ev(`(() => {
    const s = window.ship, a = 0, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const out = { piraci: 0, tn: 0 };
    // spawnPos czytają okręty wsparcia, pos — kapitały (resolveCapitalSpawnPos; bez pos supercapital ląduje 1 AU
    // przed dziobem gracza, wszystkie w jednym punkcie). Tryb LINIE i Rezerwa podają oba — tu tak samo.
    const put = (key, mode, pos, ang) => { const r = window.spawnCallInShip(key, { mode, spawnPos: pos, pos, spawnAngle: ang });
      const k = Array.isArray(r) ? r.length : (r ? 1 : 0); if (mode === 'pirate') out.piraci += k; else out.tn += k; };
    // Rzędy po najwyżej 'perRow' okrętów; kolejne rzędy dalej od środka.
    const block = (key, mode, k, fwd0, rowGap, spacing, perRow, dir, ang) => {
      for (let i = 0; i < k; i++) { const row = Math.floor(i / perRow), inRow = Math.min(perRow, k - row * perRow), j = i - row * perRow;
        put(key, mode, at(fwd0 + dir * row * rowGap, (j - (inRow - 1) / 2) * spacing), ang); } };
    // Piraci przed dziobem (zwróceni ku graczowi), Terra Nova za graczem.
    block('frigate_pd', 'pirate', ${NF}, 7000, 700, 650, 25, 1, a + Math.PI);
    block('destroyer', 'pirate', ${ND}, 8600, 900, 900, 20, 1, a + Math.PI);
    block('pirate_battleship', 'pirate', ${NB}, 10600, 1500, 1500, 10, 1, a + Math.PI);
    block('pirate_supercapital', 'pirate', ${NS}, 13500, 3500, 4000, 5, 1, a + Math.PI);
    block('frigate_laser', 'friendly', ${NF}, -1500, 700, 650, 25, -1, a);
    block('destroyer', 'friendly', ${ND}, -3100, 900, 900, 20, -1, a);
    block('battleship', 'friendly', ${NB}, -5100, 1500, 1500, 10, -1, a);
    block('supercapital', 'friendly', ${NS}, -8000, 3500, 4000, 5, -1, a);
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    return out;
  })()`));

  if (DIAG) report('diag', await ev(DIAG_INSTALL));
  const t0 = Date.now();
  const sec = () => (Date.now() - t0) / 1000;
  const todo = [...PROFILE_AT].sort((a, b) => a.at - b.at);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  const STEPS_EXPR = `(window.__aiDecisionTickId || 0) * ${STEPS_PER_AI}`;
  while (sec() < TRWANIE) {
    if (todo.length && sec() >= todo[0].at) {
      const { at, dur } = todo.shift();
      const f0 = await ev('window.__frameId'), k0 = await ev(STEPS_EXPR);
      const before = await ev(HUD_EXPR);
      await cdp.send('Profiler.start');
      await sleep(dur * 1000);
      const { profile } = await cdp.send('Profiler.stop');
      const frames = (await ev('window.__frameId')) - f0, steps = (await ev(STEPS_EXPR)) - k0;
      const file = join(OUT, `bitwa-${SKLAD.join('-')}-t${at}.cpuprofile`);
      writeFileSync(file, JSON.stringify(profile));
      profiles.push({ at, dur, frames, steps, profile, file, before });
      report(`profil t=${at}`, { klatek: frames, krokow: steps, s: dur, plik: file });
      continue;
    }
    await sleep(CO * 1000);
    const d = await ev(HUD_EXPR);
    d.t = Math.round(sec());
    samples.push(d);
    report(`t=${d.t}`, short(d));
    if (d.diag) report('  diag', diagLine(d.diag));
    if (DIAG && samples.length % 4 === 1) { try { report('  V8 pola', await ev(NATIVE_EXPR)); } catch (e) { report('  V8 pola', String(e.message || e)); } }
  }
  writeFileSync(join(OUT, 'probki.json'), JSON.stringify({ sklad: SKLAD, zoom: ZOOM, seed: SEED, calm, samples,
    profiles: profiles.map((p) => ({ at: p.at, dur: p.dur, frames: p.frames, steps: p.steps, file: p.file, before: p.before })) }, null, 1));

  // Średnie: spokój, wczesna bitwa (do pierwszego profilu), reszta.
  const avg = (list, path) => { const v = list.map(path).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
  const fields = (list) => {
    const o = {};
    for (const k of KEY) o[k] = +avg(list, (s) => s.hud[k]).toFixed(2);
    o.krokow = +avg(list, (s) => (s.hud.physicsPerStep > 0 ? s.hud.physicsTime / s.hud.physicsPerStep : NaN)).toFixed(2);
    o.gpuMs = +avg(list, (s) => s.gpu.gpuMs).toFixed(2); o.dc = Math.round(avg(list, (s) => s.gpu.dc));
    o.npc = Math.round(avg(list, (s) => s.stan.npc)); o.wraki = Math.round(avg(list, (s) => s.stan.wraki));
    o.pociski = Math.round(avg(list, (s) => s.stan.pociski)); o.wezly = Math.round(avg(list, (s) => s.stan.wezly));
    return o;
  };
  const split = 15;
  console.log('\n== ŚREDNIE');
  report('spokój', fields(calm));
  report(`t ≤ ${split}`, fields(samples.filter((s) => s.t <= split)));
  report(`t > ${split}`, fields(samples.filter((s) => s.t > split)));
  // Wszystkie pola *Time / *PerStep HUD-u (średnie z bitwy, > 0,05 ms) — pełna lista podsekcji.
  console.log('\n== PerfHUD: wszystkie podsekcje (średnia z bitwy, ms na klatkę; „/krok” = ms na podkrok)');
  const battle = samples.filter((s) => s.t > 8);
  const keys = Object.keys(battle[0]?.hud || {}).filter((k) => /Time$|PerStep$/.test(k));
  for (const k of keys.sort()) { const v = avg(battle, (s) => s.hud[k]); if (v > 0.05) console.log(`  ${v.toFixed(3).padStart(8)}  ${k}`); }
  console.log('\n== passy Core3D (średnia z bitwy: draw calle, tys. trójkątów, ms CPU)');
  const pk = new Set(); for (const s of battle) for (const k in s.passes) pk.add(k);
  for (const k of pk) console.log(`  ${k.padEnd(14)} dc ${avg(battle, (s) => s.passes[k]?.[0]).toFixed(0).padStart(6)}  tris ${avg(battle, (s) => s.passes[k]?.[1]).toFixed(0).padStart(6)}k  ms ${avg(battle, (s) => s.passes[k]?.[2]).toFixed(3)}`);

  for (const p of profiles) analyze(p.profile, p.frames, p.steps,
    `PROFIL t=${p.at} s (${p.frames} klatek, ${p.steps} kroków fizyki / ${p.dur} s = ${(p.frames / p.dur).toFixed(0)} fps pod profilerem)`);
  report('błędy', errors().slice(0, 12));
} catch (e) {
  console.log('BŁĄD', e.stack || e.message, errors().slice(0, 10));
} finally {
  await chrome.close();
  await server.close();
  process.exit(0);
}

function analyze(profile, frames, steps, title) {
  console.log(`\n################ ${title}`);
  const nodes = new Map();
  for (const n of profile.nodes) nodes.set(n.id, { ...n, self: 0, total: 0, parent: null });
  for (const n of nodes.values()) for (const c of (n.children || [])) nodes.get(c).parent = n;
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) nodes.get(samples[i]).self += (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000;
  const totalOf = (n) => { let t = n.self; for (const c of (n.children || [])) t += totalOf(nodes.get(c)); n.total = t; return t; };
  for (const n of nodes.values()) if (!n.parent) totalOf(n);
  const pf = (ms) => (ms / Math.max(1, frames)).toFixed(3);
  const nameOf = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  const breakdown = (fname, depth, minMs) => {
    const tops = [...nodes.values()].filter((n) => {
      if (n.callFrame.functionName !== fname) return false;
      for (let p = n.parent; p; p = p.parent) if (p.callFrame.functionName === fname) return false;
      return true;
    });
    const sum = tops.reduce((s, n) => s + n.total, 0);
    console.log(`\n== ${fname}: ${pf(sum)} ms/klatkę` + (fname === 'physicsStep' && steps > 0
      ? ` = ${(sum / steps).toFixed(3)} ms/krok × ${(steps / Math.max(1, frames)).toFixed(2)} kroku/klatkę (pod profilerem)` : ''));
    const merge = (list, d, indent) => {
      const by = new Map();
      for (const n of list) for (const cid of (n.children || [])) {
        const c = nodes.get(cid), k = nameOf(c);
        const e = by.get(k) || { total: 0, self: 0, kids: [] };
        e.total += c.total; e.self += c.self; e.kids.push(c); by.set(k, e);
      }
      for (const [k, e] of [...by.entries()].sort((a, b) => b[1].total - a[1].total)) {
        if (e.total / Math.max(1, frames) < minMs) continue;
        console.log(`${indent}${pf(e.total)}  ${k}  [self ${pf(e.self)}]`);
        if (d > 1) merge(e.kids, d - 1, indent + '    ');
      }
    };
    merge(tops, depth, '  ');
  };
  // Cała strona: korzenie (idle, GC, program, loop).
  let all = 0; for (const n of nodes.values()) all += n.self;
  const idle = [...nodes.values()].filter((n) => n.callFrame.functionName === '(idle)').reduce((s, n) => s + n.self, 0);
  const gc = [...nodes.values()].filter((n) => n.callFrame.functionName === '(garbage collector)').reduce((s, n) => s + n.self, 0);
  const prog = [...nodes.values()].filter((n) => n.callFrame.functionName === '(program)').reduce((s, n) => s + n.self, 0);
  console.log(`całość ${pf(all)} ms/kl: idle ${pf(idle)}, GC ${pf(gc)}, (program) ${pf(prog)}`);
  breakdown('loop', 1, 0.05);
  breakdown('physicsStep', 3, 0.04);
  breakdown('render', 1, 0.04);
  breakdown('updateHexShips3D', 2, 0.04);
  breakdown('renderSingle', 4, 0.05);
  const byName = new Map();
  for (const n of nodes.values()) {
    const fn = n.callFrame.functionName || '(anon)';
    let dup = false;
    for (let p = n.parent; p; p = p.parent) if (p.callFrame.functionName === fn) { dup = true; break; }
    if (dup) continue;
    byName.set(fn, (byName.get(fn) || 0) + n.total);
  }
  console.log('\n-- łącznie (inkluzywnie) wybrane funkcje (ms/klatkę):');
  for (const fn of ['npcStep', 'bulletsAndCollisionsStep', 'ciwsStep', 'stepPlayerFireControl', 'step', 'update', 'fireWeaponCore',
    'updateFleetCoordinator', 'rebuildAIGrid', 'runCallInCombatAI', 'runSupportAI', 'steerWithFormation', 'commitCapitalFlight',
    'computeTrafficAvoidance', '_renderScene', 'renderObject', '_renderObjectDirect', 'draw', 'writeBuffer', 'compute',
    'updateShields3D', 'syncShipModels3D', 'drawNPCPretty', 'renderEntities']) {
    if (byName.has(fn)) console.log(`  ${pf(byName.get(fn)).padStart(7)}  ${fn}`);
  }
  const self = new Map();
  for (const n of nodes.values()) { const k = nameOf(n); self.set(k, (self.get(k) || 0) + n.self); }
  console.log('\n-- self-time całej strony (ms/klatkę):');
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${pf(v)}  ${k}`);
}
