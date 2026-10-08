// Lanca — klasa dział snajperskich (2026-10-08, docs/PLAN-fitowanie.md etap 1, src/data/weapons.js § KLASA DZIAŁ
// SNAJPERSKICH) w PRAWDZIWEJ grze: własny Vite (bez HMR) + headless Chrome z WebGPU (CDP), gra swobodna. Atlas w pustej
// przestrzeni, broń w gniazdach main (DevScene.mountMain), cel ćwiczebny (piracki niszczyciel bez mózgu i bez tarczy)
// w zadanej odległości na wschód (+x); kurs okrętu `--kurs` (domyślnie −90° — dziób w górę kadru, cel na prawym
// trawersie: strzela cała burta; 0 — cel przed dziobem, łuki dział main sięgają tam tylko wieżami dziobowymi);
// strzela kierowanie ogniem na auto (grupa main), gracz nic nie robi.
//
//   node scripts/webgpu/lanca-gra.mjs [--bron lance_rail_l] [--odl 9500] [--kurs -90] [--cel destroyer] [--czas 12]
//        [--out .tmp/lanca] [--rozmiar 1600x900]
//
// Mierzy: strzały (szyna strzałów — broń, odległość do celu), pociski broni w locie (czas lotu i droga do zniknięcia,
// odległość od celu — trafienie / pudło), efekty WeaponFx (wyloty pełne / tanie, trafienia, wylot i zakleszczenie
// przebicia), punkty i węzły kadłuba celu, wieże 2D (rekordy Turret2D: sylwetka, wylot) i 3D (opcja „Bronie 3D”:
// rodzina partii wież), pipeline'y tworzone synchronicznie w klatce (ma być 0), czas klatki i GPU, błędy konsoli.
// Zrzuty: szeroki kadr z celem, wieże 2D przy strzale, trafienia przy celu (kamera RTS), wieże 3D przy strzale.
// Wynik: <out>/*.png i <out>/raport.json.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const bron = args.bron || 'lance_rail_l';
const odl = Number(args.odl || 9500);
const celTyp = args.cel || 'destroyer';
const kurs = Number(args.kurs ?? -90) * Math.PI / 180;
const czas = Number(args.czas || 12);
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/lanca');
mkdirSync(out, { recursive: true });
const DEEP = { x: 6210000, y: 5330000 };   // pusta przestrzeń (jak specjale-f-gra / dym-gra)

const { server, base } = await startVite(Number(args.port || 5411));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { bron, odl, kursDeg: Math.round(kurs * 180 / Math.PI), cel: celTyp, etapy: {}, pipelineSync: {}, bledy: [] };
const r2 = (v) => Math.round(v * 100) / 100;

// Pipeline'y tworzone synchronicznie w klatce (to, czego nie rozgrzano) — licznik w backendzie three.
const HOOK = `(() => {
  const be = window.Core3D?.renderer?.backend;
  if (!be || be.__lancaHook) return !!be;
  const list = window.__lancaSync = [];
  const orig = be.createRenderPipeline.bind(be);
  be.createRenderPipeline = (ro, promises) => {
    if (!promises) list.push((ro.material && (ro.material.name || ro.material.type)) + ' @ ' + (ro.object && (ro.object.name || ro.object.type)));
    return orig(ro, promises);
  };
  be.__lancaHook = true;
  return true;
})()`;
const syncCount = () => ev('(window.__lancaSync || []).length');
const syncSince = async (stage, from) => {
  const list = await ev(`(window.__lancaSync || []).slice(${from})`);
  report.pipelineSync[stage] = { liczba: list.length, lista: list.slice(0, 20) };
  return list.length;
};

// Instrumentacja: strzały gracza (szyna), pociski broni w locie (rAF — start i zniknięcie), efekty WeaponFx, czasy klatek.
const INSTRUMENT = `(() => {
  if (window.__lanca) return true;
  const BRON = ${JSON.stringify(bron)};
  const L = window.__lanca = { on: false, shots: [], ends: [], fxImpact: 0, exits: 0, stuck: 0, lastShotMs: 0, lastHitMs: 0, frames: [], last: 0 };
  window.WeaponShotBus.on((d) => {
    if (!L.on || d.shooter !== window.ship) return;
    const t = window.__lancaTarget, s = window.ship;
    L.shots.push({ t: window.SimClock.sim, w: d.weaponId, d: t ? Math.hypot(t.x - s.pos.x, t.y - s.pos.y) : null });
    L.lastShotMs = performance.now();
  });
  const fx = window.WeaponFx;
  const wrap = (name, fn) => {
    const o = fx[name];
    if (typeof o !== 'function') return;
    fx[name] = function (...a) { try { fn(...a); } catch (e) { /* pomiar */ } return o.apply(this, a); };
  };
  wrap('impact', (b) => { if (L.on && b && b.vfxKey === BRON) { L.fxImpact++; L.lastHitMs = performance.now(); } });
  wrap('pierceExit', (b) => { if (L.on && b && b.vfxKey === BRON) L.exits++; });
  wrap('pierceStuck', (b) => { if (L.on && b && b.vfxKey === BRON) L.stuck++; });
  const live = new Map();
  const seen = new Set();
  const loop = (t) => {
    if (L.on) {
      if (L.last) L.frames.push(t - L.last);
      seen.clear();
      for (const b of window.bullets || []) {
        if (!b || b.vfxKey !== BRON) continue;
        seen.add(b);
        let r = live.get(b);
        if (!r) { r = { born: Number(b.bornSim) || window.SimClock.sim, x0: b.x, y0: b.y, x: b.x, y: b.y, t: window.SimClock.sim }; live.set(b, r); }
        r.x = b.x; r.y = b.y; r.t = window.SimClock.sim;
      }
      for (const [b, r] of live) {
        if (seen.has(b)) continue;
        live.delete(b);
        const tg = window.__lancaTarget;
        L.ends.push({ lot: r.t - r.born, droga: Math.hypot(r.x - r.x0, r.y - r.y0), doCelu: tg ? Math.hypot(r.x - tg.x, r.y - tg.y) : null });
      }
    }
    L.last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return true;
})()`;

// Zoom „ręczny” (bez manualZoom kamera statku co klatkę wraca do zoomu domyślnego z długości kadłuba).
const ZOOM = (zoom) => `c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom}; c.zoomVel = 0; c.zoomImpulseLog = 0;`;
// Statek w pustej przestrzeni, stoi, kurs `kurs`, kamera statku z zoomem.
const place = (zoom) => ev(`(() => {
  window.DevScene.teleport(${DEEP.x}, ${DEEP.y}, ${kurs});
  window.ship.angVel = 0;
  const c = window.camera; ${ZOOM(zoom)}
  window.DevScene.syncCamera();
  return true;
})()`);
const zoomShip = (zoom) => ev(`(() => { const c = window.camera; ${ZOOM(zoom)} window.DevScene.syncCamera(); return true; })()`);
// Kamera RTS (wieże na auto strzelają dalej — kierowanie ogniem nie zależy od trybu kamery) nad punktem świata.
const rtsAt = (x, y, zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode !== 'rts') c.toggleRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y};
  ${ZOOM(zoom)}
  window.DevScene.syncCamera();
  return c.mode;
})()`);
const rtsOff = () => ev(`(() => { const c = window.camera; if (c.mode === 'rts') c.toggleRtsMode(); window.DevScene.syncCamera(); return c.mode; })()`);
// Zrzut tuż po zdarzeniu (strzał / trafienie): czeka na świeży znacznik czasu w stronie, potem `delay` ms.
async function shotAfter(kind, name, delay, timeout = 15000) {
  const key = kind === 'hit' ? 'lastHitMs' : 'lastShotMs';
  const t0 = await ev(`window.__lanca.${key}`);
  const ok = await waitFor(cdp, `window.__lanca.${key} > ${t0}`, timeout, 15);
  if (delay > 0) await sleep(delay);
  await screenshotPng(cdp, join(out, `${name}.png`));
  return ok;
}
const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : null);

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
    localStorage.setItem('sc_ships3d', '0'); localStorage.setItem('sc_weapons3d', '0');
  } catch {} })();` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene && window.WeaponFx && window.MASTER_WEAPONS)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 40 && !!window.DevScene?.simTime && !!window.DevScene?.mountMain', 300000, 400)) throw new Error('gra nie ruszyła');
  await waitFor(cdp, HOOK, 30000, 300);
  await ev(INSTRUMENT);
  await sleep(1500);

  // ------------------------------------------------------------- przygotowanie: broń w gniazdach main, cel
  const sPrep = await syncCount();
  await place(0.075);
  const fit = await ev(`(() => {
    window.DevScene.mountMissile(null);    // bez rakiet w kadrze (cel bez zagrożenia i tak ich nie ściąga)
    const n = window.DevScene.mountMain(${JSON.stringify(bron)});
    const w = window.Game.player.weapons || {};
    const ids = (g) => (w[g] || []).filter((l) => l?.weapon).map((l) => l.weapon.id);
    const def = window.MASTER_WEAPONS[${JSON.stringify(bron)}];
    return { zamontowane: n, main: ids('main'), special: ids('special'), wRece: window.fireControl.inHand, autoMain: window.fireControl.auto.main,
      bron: { nazwa: def.name, klasa: def.weaponClass, zasieg: def.baseRange, predkosc: def.baseSpeed, obrazenia: def.baseDamage, przeladowanie: def.cooldown,
        dps: def.baseDamage / def.cooldown, lotDoKoncaZasiegu: def.baseRange / def.baseSpeed, penDepth: def.penDepth, penetration: def.penetration } };
  })()`);
  report.fit = fit;
  console.log('fit', JSON.stringify(fit));
  if (!(fit.zamontowane > 0) || !fit.main.every((id) => id === bron)) throw new Error('broń nie weszła do gniazd main');
  const spawned = await ev(`(() => {
    const r = window.spawnCallInShip(${JSON.stringify(celTyp)}, { mode: 'pirate', spawnPos: { x: ${DEEP.x + odl}, y: ${DEEP.y} }, spawnAngle: Math.PI / 2 });
    const e = Array.isArray(r) ? r[0] : r;
    if (!e) return null;
    e.__lancaTag = 'cel'; e.ai = () => {};
    e.hp = e.maxHp = 1e7;
    if (e.shield) { e.shield.max = 0; e.shield.val = 0; }
    window.__lancaTarget = e;
    return { typ: e.type, frakcja: e.faction || null, wrogi: window.isHostileNpc ? window.isHostileNpc(e) : null };
  })()`);
  if (!spawned) throw new Error('brak celu');
  report.celInfo = spawned;
  await waitFor(cdp, '!!window.__lancaTarget?.beamHull', 30000, 300);
  // Kursor nad celem (kamera walki patrzy w jego stronę) — grupa main jest na auto, kursor nie steruje ogniem.
  await ev(`window.DevScene.pointerAt(${DEEP.x + odl}, ${DEEP.y})`);
  await sleep(800);
  await syncSince('przygotowanie', sPrep);

  // ------------------------------------------------------------- 2D: ostrzał na auto, kadr szeroki
  const s2d = await syncCount();
  const nodes0 = await ev('window.__lancaTarget.beamHull.body.activeNodes');
  const fx0 = await ev('({ ...window.WeaponFx.stats })');
  await ev(`(() => { const L = window.__lanca; L.shots.length = 0; L.ends.length = 0; L.frames.length = 0; L.fxImpact = L.exits = L.stuck = 0; L.on = true; return true; })()`);
  const t0 = await ev('window.SimClock.sim');
  const first = await waitFor(cdp, 'window.__lanca.shots.length > 0', 20000, 50);
  report.pierwszyStrzalS = first ? r2((await ev('window.__lanca.shots[0].t')) - t0) : null;
  await shotAfter('shot', '01-szeroko-salwa-w-locie', 330);
  await sleep(1200);
  await zoomShip(0.42);
  await sleep(600);
  await shotAfter('shot', '02-wieze-2d-wylot', 40);
  await sleep(500);
  await zoomShip(1.0);
  await sleep(500);
  await screenshotPng(cdp, join(out, '03-wieze-2d.png'));
  // Trafienia przy celu: kamera RTS nad celem.
  await rtsAt(DEEP.x + odl, DEEP.y, 0.3);
  await sleep(400);
  await shotAfter('hit', '04-trafienia-przy-celu', 60, 20000);
  await sleep(1500);
  await screenshotPng(cdp, join(out, '05-cel-rany.png'));
  await rtsOff();
  await zoomShip(0.075);
  const left = Math.max(0, czas - (await ev('window.SimClock.sim')) + t0);
  await sleep(left * 1000);
  const m2d = await ev(`(() => {
    const L = window.__lanca; L.on = false;
    const tg = window.__lancaTarget;
    const fr = L.frames.slice().sort((a, b) => a - b);
    const t2d = window.Turret2D.recordsFor(window.ship) || [];
    const recs = t2d.filter((r) => r.weaponId === ${JSON.stringify(bron)});
    return {
      shots: L.shots.slice(), ends: L.ends.slice(), fxImpact: L.fxImpact, exits: L.exits, stuck: L.stuck,
      hp: tg.hp, maxHp: tg.maxHp, nodes: tg.beamHull?.body?.activeNodes ?? null, celPromien: tg.radius || null,
      klatkaMs: fr.length ? fr[fr.length >> 1] : null, klatkaP95: fr.length ? fr[Math.floor(fr.length * 0.95)] : null,
      gpuMs: window.Core3D?.gpuFrameMs || 0, fx: { ...window.WeaponFx.stats },
      wieze2d: { rekordy: recs.length, wylot: recs[0]?.spec?.m || null, klucz: recs[0]?.fxKey || null, skala: recs[0]?.scale || null },
      fc: { ...window.fireControl.stats }
    };
  })()`);
  const lots = m2d.ends.map((e) => e.lot).sort((a, b) => a - b);
  const hits = m2d.ends.filter((e) => e.doCelu != null && e.doCelu < 900);
  const dists = m2d.shots.map((s) => s.d).filter(Number.isFinite).sort((a, b) => a - b);
  report.etapy.ostrzal2d = {
    strzaly: m2d.shots.length, strzalyWg: m2d.shots.reduce((o, s) => { o[s.w] = (o[s.w] || 0) + 1; return o; }, {}),
    odlegloscStrzaluM: { min: dists[0] ?? null, mediana: pct(dists, 0.5), maks: dists.length ? dists[dists.length - 1] : null },
    pociskiZakonczone: m2d.ends.length, trafienia: hits.length, pudla: m2d.ends.length - hits.length,
    czasLotuS: { mediana: lots.length ? r2(pct(lots, 0.5)) : null, maks: lots.length ? r2(lots[lots.length - 1]) : null },
    drogaDoTrafieniaM: hits.length ? Math.round(pct(hits.map((h) => h.droga).sort((a, b) => a - b), 0.5)) : null,
    efektyTrafienia: m2d.fxImpact, przebicieWylot: m2d.exits, przebicieZakleszczenie: m2d.stuck,
    wezlyCelu: { przed: nodes0, po: m2d.nodes }, punktyCelu: { przed: 1e7, po: Math.round(m2d.hp) },
    wylotyPelne: (m2d.fx.muzzles || 0) - (fx0.muzzles || 0), wylotyTanie: (m2d.fx.cheapMuzzles || 0) - (fx0.cheapMuzzles || 0),
    wieze2d: m2d.wieze2d, kierowanieOgnia: m2d.fc,
    klatkaMs: m2d.klatkaMs != null ? r2(m2d.klatkaMs) : null, klatkaP95: m2d.klatkaP95 != null ? r2(m2d.klatkaP95) : null, gpuMs: r2(m2d.gpuMs)
  };
  await syncSince('ostrzal2d', s2d);
  console.log('2D', JSON.stringify(report.etapy.ostrzal2d));

  // ------------------------------------------------------------- 3D: opcja „Bronie 3D”
  const s3dSwitch = await syncCount();
  await ev('window.setVisualMode(false, true)');
  await zoomShip(0.42);
  await sleep(1500);
  await syncSince('przelaczenieBronie3D', s3dSwitch);
  const s3d = await syncCount();
  await ev(`(() => { const L = window.__lanca; L.shots.length = 0; L.ends.length = 0; L.on = true; return true; })()`);
  await shotAfter('shot', '06-wieze-3d-wylot', 40, 20000);
  await sleep(600);
  await zoomShip(1.0);
  await sleep(500);
  await screenshotPng(cdp, join(out, '07-wieze-3d.png'));
  await sleep(4000);
  const m3d = await ev(`(async () => {
    const L = window.__lanca; L.on = false;
    const mod = await import('/src/3d/ships3d/shipModels3DGame.js');
    const st = mod.shipModels3DStats();
    const fam = await import('/src/3d/ships3d/weapons/weapons3D.js');
    return { strzaly: L.shots.length, trafienia: L.ends.filter((e) => e.doCelu != null && e.doCelu < 900).length, partia: st,
      rodzina: fam.WEAPON3D_FAMILY[${JSON.stringify(bron)}] };
  })()`);
  report.etapy.bronie3d = m3d;
  await syncSince('ostrzal3d', s3d);
  console.log('3D', JSON.stringify(m3d));
  await ev('window.setVisualMode(false, false)');

  report.pipelineSync.razem = await syncCount();
  report.pipelineSync.lista = await ev('(window.__lancaSync || []).slice(0, 40)');
  console.log('pipeline\'y synchroniczne:', JSON.stringify(report.pipelineSync));
} catch (err) {
  report.blad = String(err?.stack || err);
  console.error(err);
  try { await screenshotPng(cdp, join(out, 'blad.png')); } catch { /* */ }
} finally {
  report.bledy = logs.errors().slice(0, 40);
  writeJson(join(out, 'raport.json'), report);
  console.log('raport:', join(out, 'raport.json'), 'błędy konsoli:', report.bledy.length);
  await chrome.close();
  await server.close();
}
