// Zniszczenia świata W GRZE (F2 docs/PLAN-zniszczenia-swiata-3d.md): kawałki BAZY PIRATÓW (misja 1, od 2026-10-11 —
// dawniej suchy dok) w bańce gracza są ciałami silnika belek (src/game/worldBodies.js; miejsce na budowlę: habitat,
// paliwo, magazyn, pomosty — src/game/story/pirateBaseBodies.js), rysuje je skóra brył (src/3d/worldBodies3D.js).
// Wybuchy progów i rozpadu — gaz WebGPU (§ „Wybuchy WebGPU”), ciała bez dymu i ognia. Vite + headless Chrome z WebGPU.
//
//   node scripts/webgpu/zniszczenia-gra.mjs [--out .tmp/zniszczenia-gra] [--rozmiar 1600x900] [--hexlance | --final] [--czujka] [--dziennik]
//   --czujka: klatka, w której kawałek bębna habitatu albo pomostu traci > 20 węzłów (lekki podgląd w rAF),
//   --dziennik: fale ciśnienia i zniszczone węzły na kawałek między kadrami (opakowania zmieniają przebieg).
//
// Skok dev ?story=ram, kamera RTS bez HUD-u:
//   01 statyka — rozwidlenie Y i habitat, kawałki w bańce już są ciałami (nietknięte: rysuje je statyka budowli),
//   02 skóra bez ruchu — te same kawałki oznaczone „ruszone” (skóra zamiast statyki; A/B z 01 — ma być ten sam obraz),
//   03 taran rzędu przy ramieniu A (tor layout.ram: Atlas z maskowaniem, W + Shift — zderzenia z okrętami w
//   stanowiskach i z ciałem pomostu), 04 Atlas na końcu toru,
//   05 ostrzał ściany bębna habitatu od południa (ćwiartka H-S: Yamato, autodziało oblężnicze, armata z promieniem
//   rażenia), 06 wiązka pulsowa (ciepło), 07 rakieta manewrująca w ścianę (front ciśnienia), 08–09 próg punktów
//   habitatu — kawałek-ciało odpada fizycznie (onBaseDamageStep → storyBaseBreak).
// --hexlance: faza „shipyard”, Atlas 4 km na południe od habitatu, Hexlance (4, ładowanie, 4) w bęben.
// --final: faza „shipyard”, progi punktów habitatu do 3/8 (wszystkie kawałki habitatu ciałami, także duchy: część
// techniczna i dysk), wypiek skór, śmierć habitatu → rozpad misji (_chainExplosion: implozja, reakcja w rurach od
// habitatu) — kadry 30–36, czasy klatek w rozpadzie i po nim, rysunki, odłamy.
// Raport: <out>/raport.json — WorldBodies.stats, kanały broni, skóra, stan kawałków, pipeline'y synchroniczne, błędy.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/zniszczenia-gra');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5376));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { kadry: [], bledy: [] };

// Dziennik zniszczeń (każdy kadr): fale ciśnienia (miejsce w układzie bazy, promień, moc, źródło) i zniszczone węzły
// na kawałek (hak destroyNode silnika) — skąd ubytek w konstrukcji.
const DMG_LOG = `(() => {
  const hook = setInterval(() => {
    const W = window.WorldBodies, D = window.HullBodies && window.HullBodies.engine;
    if (!W || !D || !W.detonate || !D.destroyNode) return;
    clearInterval(hook);
    const L = window.__dmgLog = { fale: [], lost: {} };
    const det = W.detonate.bind(W);
    W.detonate = function (x, y, radius, power, dx, dy) {
      const site = W.sites.find((s) => s.place), d = site && site.place;
      const h = d && d.toHub ? d.toHub(x, y) : { x, z: y };
      const stack = (new Error().stack || '').split('\\n').slice(2, 5).map((s) => s.trim().replace(/^at /, '').replace(/\\(.*\\//, '(')).join(' < ');
      L.fale.push({ hub: [Math.round(h.x), Math.round(h.z)], r: Math.round(radius), moc: +(+power).toFixed(2), skad: stack.slice(0, 160) });
      return det(x, y, radius, power, dx, dy);
    };
    const dn = D.destroyNode.bind(D);
    D.destroyNode = function (body, i, ...rest) {
      const e = body && body.hull && body.hull.entity;
      const id = (e && e.worldPiece && e.worldPiece.id) || (e && e.beamHull && e.beamHull.world && ('odł:' + e.beamHull.world.id)) || (e === window.ship ? 'ATLAS' : 'okręty');
      L.lost[id] = (L.lost[id] || 0) + 1;
      return dn(body, i, ...rest);
    };
  }, 50);
})();`;
// --dziennik: opakowania WorldBodies.detonate / destroyNode zmieniają czas klatek, a z nim przebieg (ostrzał AI) —
// do szukania źródła zniszczeń, nie do pomiaru „jak w grze” (ten — bez flagi, ewentualnie z --czujka)
if (args.dziennik) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: DMG_LOG });
// --czujka: lekki podgląd w rAF (bez opakowań) — klatka, w której kawałek trzonu traci węzły: stan gracza, kanały, wraki
if (args.czujka) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const W = { prev: {}, hits: [] };
  window.__czujka = W;
  const tick = () => {
    requestAnimationFrame(tick);
    const Wb = window.WorldBodies, sites = Wb && Wb.sites;
    if (!sites || !sites.length) return;
    for (const site of sites) for (const p of site.pieces) {
      if ((p.kind !== 'drum' && p.kind !== 'pier') || p.state !== 'live') continue;
      const n = p.alive | 0, was = W.prev[p.id];
      W.prev[p.id] = n;
      if (was && n < was - 20 && W.hits.length < 12) {
        const sh = window.ship, d = site.place, h = d.toHub(sh.pos.x, sh.pos.y);
        const wr = (window.wrecks || []).filter((w) => w && !w.dead && w.worldDebris).map((w) => ({ id: w.beamHull && w.beamHull.world && w.beamHull.world.id, n: w.beamHull && w.beamHull.body && w.beamHull.body.activeNodes, v: Math.round(Math.hypot(w.vx || 0, w.vy || 0)) }));
        W.hits.push({ id: p.id, przed: was, po: n, frame: window.__frameId | 0, atlas: { hub: [Math.round(h.x), Math.round(h.z)], v: Math.round(Math.hypot(sh.vel.x, sh.vel.y)), kurs: +((sh.angle - d.axis) * 57.3).toFixed(1) },
          kanaly: { ...Wb.channels.stats, impulse: Math.round(Wb.channels.stats.impulse) }, stats: { ...Wb.stats }, reaktor: window.ReactorGame && window.ReactorGame.detonations, odlamy: wr,
          hp: Math.round(window.StoryGame.site.station.hp) });
      }
    }
  };
  requestAnimationFrame(tick);
})();` });

// Pipeline'y three utworzone SYNCHRONICZNIE (render materiału bez rozgrzewki = przestój) — skóra ciał świata
// (PortBuildingSkin_*) ma być rozgrzana na ekranie ładowania (Core3D.warmup — wpis „baza piratów: skóra ciał”,
// src/3d/pirateBaseGame.js).
const PIPE_REC = `(() => {
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, frame: window.__frameId | 0, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();`;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PIPE_REC });

// kamera RTS nad punktem układu bazy (x wzdłuż osi podejścia, z w poprzek; habitat w 0, 0) z zoomem, bez HUD-u
const camHub = (x, z, zoom) => ev(`(() => {
  const site = window.StoryGame.site, c = window.camera;
  const p = site.dock.toGame(${x}, ${z});
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return true;
})()`);

const PIECES = ['YA-1', 'YA-2', 'YB-1', 'NP', 'H-W', 'H-S', 'H-N', 'H-E', 'H-C', 'FP'];
// kawałek bazy po id (miejsca ciał na budowlę)
const PIECE_OF = `const pieceOf = (id) => { for (const s of window.WorldBodies.sites) for (const q of s.pieces) if (q.id === id) return q; return null; };`;
const worldState = () => ev(`(() => {
  const Wb = window.WorldBodies;
  ${PIECE_OF}
  const pieces = {};
  for (const id of ${JSON.stringify(PIECES)}) {
    const p = pieceOf(id);
    if (!p) continue;
    const b = p.entity && p.entity.beamHull && p.entity.beamHull.body;
    pieces[id] = { stan: p.state, ruszony: !!p.touched, stracony: !!p.lost, wezly: p.baseNodes, zywe: p.alive != null ? p.alive : (b ? b.activeNodes : 0), wyspy: p.islands.length, maxDisp: b ? +(b._maxDisp || 0).toFixed(1) : 0 };
  }
  const odlamy = (window.wrecks || []).filter((w) => w && !w.dead && w.worldDebris).length;
  const s = Wb.stats;
  const site = window.StoryGame.site, st = site && site.station, bud = (site && site.structures) || {};
  const L = window.__dmgLog || { fale: [], lost: {} };
  const fale = L.fale.splice(0), lost = L.lost;
  L.lost = {};
  return {
    zniszczoneWezly: lost, fale,
    stats: { ...s, stepMs: +(s.stepMs || 0).toFixed(3), stepPeakMs: +(s.stepPeakMs || 0).toFixed(2), buildMs: +(s.buildMs || 0).toFixed(2) },
    kanaly: Wb.channels ? { ...Wb.channels.stats, impulse: Math.round(Wb.channels.stats.impulse || 0) } : null,
    skora: { ...(window.__worldSkinStats || {}) }, odlamy,
    baza: st ? { habitat: Math.round(st.hp), habitatMax: st.maxHp, paliwo: Math.round(bud.fuel?.hp ?? 0), magazyn: Math.round(bud.warehouse?.hp ?? 0),
      pomosty: Math.round(bud.piers?.hp ?? 0), statykaBrak: [...(st._dockGone || [])].length } : null,
    taran: !!(window.StoryGame.site && window.StoryGame.site.gateRammed),
    pieces
  };
})()`);
async function shot(name, wait = Number(args.czekaj || 700)) {
  await sleep(wait);
  const st = await worldState();
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.kadry.push({ name, ...st });
  console.log(name.padEnd(24), JSON.stringify({ stats: st.stats, skora: st.skora, odlamy: st.odlamy, baza: st.baza, taran: st.taran }));
  console.log(''.padEnd(24), 'węzły:', JSON.stringify(st.zniszczoneWezly), st.fale.length ? 'fale: ' + JSON.stringify(st.fale) : '');
  return st;
}

const KEY4 = { key: '4', code: 'Digit4', windowsVirtualKeyCode: 52, nativeVirtualKeyCode: 52 };
const tap4 = async () => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY4 });
  await sleep(60);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY4 });
};

async function startStory(phase) {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${phase}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, `window.StoryGame.active && window.StoryGame.phase === '${phase}' && !!window.StoryGame.site?.station`, 300000, 400)) throw new Error(`faza ${phase} nie ruszyła`);
}

// gracz w punkcie układu bazy (hub), kurs w układzie (rad), prędkość [j/s] wzdłuż kursu
const placeHub = (x, z, heading, speed = 0) => ev(`(() => {
  const S = window.StoryGame, d = S.site.dock, ship = window.ship;
  const p = d.toGame(${x}, ${z});
  const a = d.headingToGame(${heading});
  S.deps.placePlayer(p.x, p.y, a);
  ship.vel.x = Math.cos(a) * ${speed}; ship.vel.y = Math.sin(a) * ${speed};
  return true;
})()`);

// broń gry z lufy w punkcie hub (x, z) w kierunku punktu hub (tx, tz): n strzałów co `every` ms (rdzeń strzału gry)
const fireHub = (weaponId, x, z, tx, tz, n, every) => ev(`new Promise((res) => {
  const d = window.StoryGame.site.dock;
  const p = d.toGame(${x}, ${z}), t = d.toGame(${tx}, ${tz});
  const dx = t.x - p.x, dy = t.y - p.y, l = Math.hypot(dx, dy) || 1;
  const muzzle = { pos: { x: p.x, y: p.y }, dir: { x: dx / l, y: dy / l }, baseVel: { x: 0, y: 0 } };
  let k = 0;
  const tick = () => {
    try { window.fireWeaponCore(window.ship, null, '${weaponId}', muzzle); } catch (e) { console.error('[zniszczenia] strzał', e); }
    if (++k >= ${n}) { clearInterval(h); res(k); }
  };
  const h = setInterval(tick, ${every});
  tick();
})`, 60000);

// --final: faza „shipyard”, progi punktów habitatu do 3/8 (wszystkie kawałki habitatu ciałami, skóry pieką się w tle),
// potem śmierć habitatu i rozpad misji (StoryGame._chainExplosion → storyBaseBreak → worldBodies.breakPiece: ćwiartki
// bębna, szyb, część techniczna i dysk — duchy — pękają na odłamy z odłamkami; reakcja w rurach od habitatu). Kadry
// 30–36, czasy klatek w rozpadzie i po nim, rysunki, odłamy, skóry.
const FRAME_REC = `(() => {
  const R = window.__frames = { on: false, dt: [], draws: [], last: 0 };
  const tick = (t) => {
    requestAnimationFrame(tick);
    if (R.on && R.last) {
      R.dt.push(t - R.last);
      const info = window.Core3D?.renderer?.info?.render;
      if (info) R.draws.push(info.drawCalls | 0);
    }
    R.last = t;
  };
  requestAnimationFrame(tick);
  return true;
})()`;
const frameStats = () => ev(`(() => {
  const R = window.__frames, a = R.dt.slice().sort((x, y) => x - y), d = R.draws.slice().sort((x, y) => x - y);
  const q = (arr, f) => arr.length ? +arr[Math.min(arr.length - 1, Math.floor(arr.length * f))].toFixed(1) : 0;
  const out = { klatek: a.length, p50: q(a, 0.5), p95: q(a, 0.95), max: q(a, 1), ponad33ms: a.filter((x) => x > 33).length, rysunkiP50: q(d, 0.5), rysunkiMax: q(d, 1) };
  R.dt.length = 0; R.draws.length = 0;
  return out;
})()`);
async function finalRun() {
  await startStory('shipyard');
  await sleep(2000);
  const L = await ev(`(() => { const l = window.StoryGame.site.dock.layout; return { cx: l.center.x, cz: l.center.z, drumR: l.habitat.drumR, discR: l.habitat.discR }; })()`);
  report.uklad = L;
  // Atlas 4,5 km na południe od habitatu (bańka 7 km obejmuje bęben, szyb i dysk), dziobem ku habitatowi
  await placeHub(0, 4500, -Math.PI / 2, 0);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  await ev(FRAME_REC);
  await sleep(1500);
  await camHub(0, 0, 0.12);
  await shot('30-habitat-caly', 900);
  // progi punktów habitatu do 3/8: kawałki pod trafieniem w bęben pękają, habitat przechodzi w „wszystkie ciałami”
  const tProg = await ev(`(() => {
    const S = window.StoryGame, st = S.site.structures.habitat, d = S.site.dock;
    const p = d.toGame(0, ${L.drumR} * 0.85);
    st.lastHitX = p.x; st.lastHitY = p.y;
    const t0 = performance.now();
    window.applyDamageToStation(st, st.hp - st.maxHp * 0.36);
    const site = window.WorldBodies.site(st._worldSite);
    return { ms: +(performance.now() - t0).toFixed(1), hp: Math.round(st.hp), allLive: !!(site && site.allLive) };
  })()`);
  console.log('progi:', JSON.stringify(tProg));
  report.progi = tProg;
  await shot('31-progi', 1500);
  // wypiek skór w tle (requestIdleCallback) — czekaj na komplet kawałków habitatu
  const tBake = Date.now();
  const SITE_H = `window.WorldBodies.site(window.StoryGame.site.structures.habitat._worldSite)`;
  await waitFor(cdp, `(() => { const s = ${SITE_H}; return s.pieces.every((p) => p.state !== 'live' || (p.__skin && p.entity && p.__skin.key === p.entity.beamHull?.image)); })()`, 60000, 300);
  report.wypiek = { s: (Date.now() - tBake) / 1000, ...(await ev('(() => ({ ...window.__worldSkinStats }))()')) };
  console.log('wypiek:', JSON.stringify(report.wypiek));
  await frameStats();
  await ev('(() => { window.__frames.on = true; return true; })()');
  await sleep(1500);
  report.klatkiPrzed = await frameStats();
  console.log('klatki przed:', JSON.stringify(report.klatkiPrzed));
  // śmierć habitatu → misja: rozpad habitatu (implozja) i reakcja w rurach od środka
  await ev(`(() => { const st = window.StoryGame.site.structures.habitat; window.applyDamageToStation(st, st.hp + 10); return true; })()`);
  await sleep(4800);
  report.klatkiLancuch = await frameStats();
  console.log('klatki rozpad:', JSON.stringify(report.klatkiLancuch));
  await shot('32-rozpad', 10);
  await sleep(3000);
  await shot('33-po-rozpadzie', 10);
  await camHub(0, 0, 0.32);
  await shot('34-habitat-zblizenie', 1200);
  await camHub(-2150, 0, 0.32);
  await shot('35-pomost-NP-zblizenie', 1200);
  await camHub(0, 0, 0.12);
  await frameStats();
  await sleep(3000);
  report.klatkiPo = await frameStats();
  console.log('klatki po:', JSON.stringify(report.klatkiPo));
  await shot('36-po-10s', 10);
  report.odlamy = await ev(`(() => {
    const w = (window.wrecks || []).filter((x) => x && !x.dead && x.worldDebris && x.beamHull?.body?.activeNodes > 0);
    const duchy = w.filter((x) => x.isCollidable === false).length;
    const s = window.WorldBodies.stats, site = ${SITE_H};
    const all = window.WorldBodies.sites.flatMap((q) => q.pieces);
    return { odlamy: w.length, duchy, rozpady: s.shattered, odlamki: s.shatterDebris,
      habitatStracone: site.pieces.filter((p) => p.state === 'lost').length, habitatZ: site.pieces.length,
      bazaStracone: all.filter((p) => p.state === 'lost').length, bazaZ: all.length,
      reakcja: { ...window.StoryGame.site.chain, burnt: window.StoryGame.site.chain.burnt.size, pending: undefined } };
  })()`);
  console.log('odłamy:', JSON.stringify(report.odlamy));
}

async function hexlanceRun() {
  await startStory('shipyard');
  await sleep(2000);
  // Atlas 4 km na południe od habitatu, dziobem ku bębnowi (Hexlance 15 km)
  await placeHub(0, 4000, -Math.PI / 2, 0);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  await sleep(1500);
  await camHub(0, 2000, 0.09);
  const before = await worldState();
  await tap4();
  await sleep(1700);
  await tap4();
  await sleep(2600);
  const after = await shot('20-hexlance');
  await camHub(0, 600, 0.2);
  await shot('21-hexlance-zblizenie');
  report.hexlance = { przed: before, po: after };
}

const key = (code, k, vk) => ({ key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
const KEY_I = key('KeyI', 'i', 73), KEY_W = key('KeyW', 'w', 87), KEY_SHIFT = key('ShiftLeft', 'Shift', 16);
// kamera statku (stery gracza: w trybie RTS klawisze lotu i maskowania nie działają)
const camShip = (zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode === 'rts' && typeof c.exitRtsMode === 'function') c.exitRtsMode();
  c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  return true;
})()`);

try {
  if (args.final) {
    await finalRun();
  } else if (args.hexlance) {
    await hexlanceRun();
  } else {
    await startStory('ram');
    await sleep(2500);
    const L = await ev(`(() => {
      const l = window.StoryGame.site.dock.layout, r = l.ram, H = l.habitat;
      return { ram: r, F: l.nodes.F, A1: l.nodes.A1, drumR: H.drumR,
        // ściana bębna od południa (ćwiartka H-S): środek lica, normalna na zewnątrz (+z), wzdłuż ściany ±x
        wall: { x: 0, z: H.drumR, nx: 0, nz: 1 } };
    })()`);
    report.uklad = L;
    // gracz przed rozwidleniem Y (bańka obejmuje ramiona Y, pomost NP i habitat), statyka vs skóra (A/B)
    await placeHub(L.F.x - 4500, 0, 0, 0);
    await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 6', 30000, 200);
    await sleep(1500);
    await camHub((L.F.x + L.A1.x) / 2 + 400, -800, 0.16);
    await shot('01-statyka', 1200);
    await ev(`(() => { ${PIECE_OF} for (const id of ['YA-1', 'YA-2', 'YB-1', 'NP', 'H-W']) { const p = pieceOf(id); if (p && p.state === 'live') p.touched = true; } return true; })()`);
    await shot('02-skora-bez-ruchu', 1200);
    // taran rzędu przy ramieniu A (tor layout.ram jak w baza-gra.mjs): rufą 400 j. przed początkiem toru, maskowanie,
    // rozpęd 700 j/s, W + Shift (dopalacz) trzymane
    report.taranPrzed = await worldState();
    await ev(`(() => {
      const S = window.StoryGame, d = S.site.dock, ship = window.ship, r = d.layout.ram;
      const a = d.headingToGame(r.dir), p = d.toGame(r.start.x, r.start.z);
      const back = Math.max(ship.w || 0, ship.h || 0, 2 * (ship.radius || 0)) / 2 + 400;
      S.deps.placePlayer(p.x - Math.cos(a) * back, p.y - Math.sin(a) * back, a);
      ship.vel.x = 0; ship.vel.y = 0;
      return true;
    })()`);
    await camShip(0.13);
    await sleep(900);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_I });
    await sleep(80);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_I });
    await sleep(2500);
    await ev(`(() => { const d = window.StoryGame.site.dock, ship = window.ship, a = d.headingToGame(d.layout.ram.dir); ship.vel.x = Math.cos(a) * 700; ship.vel.y = Math.sin(a) * 700; return true; })()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_SHIFT });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_W, modifiers: 8 });
    await shot('03-taran-rzad', 3000);
    await sleep(5000);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_W });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_SHIFT });
    await camHub((L.ram.start.x + L.ram.end.x) / 2, (L.ram.start.z + L.ram.end.z) / 2, 0.14);
    await shot('04-po-taranie', 1200);
    report.taran = await ev(`(() => { const site = window.StoryGame.site; return { v: Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y)), gateRammed: !!site.gateRammed, rammed: site.rammed(),
      rzad: site.ramList().map((n) => n.dead ? 'x' : (n.hp / n.maxHp).toFixed(2)), alarm: !!site.alarmed, maskowanie: window.ship?.cloak?.state || null }; })()`);
    console.log('taran:', JSON.stringify(report.taran));
    // ostrzał ściany bębna H-S z 2,5 km (lufa 1 km przed statkiem); wieże na auto wstrzymane (alarm po taranie)
    const w = L.wall;
    const sx = w.x + w.nx * 2500, sz = w.z + w.nz * 2500;
    const mx = w.x + w.nx * 1500, mz = w.z + w.nz * 1500;
    await placeHub(sx, sz, Math.atan2(-w.nz, -w.nx), 0);
    await ev('(() => { window.ship.vel.x = 0; window.ship.vel.y = 0; if (window.fireControl) window.fireControl.posture = "hold"; return true; })()');
    await waitFor(cdp, `(() => { ${PIECE_OF} const p = pieceOf('H-S'); return p && p.state === 'live'; })()`, 20000, 200);
    await camHub(w.x + w.nx * 200, w.z + w.nz * 200, 0.32);
    await sleep(800);
    report.ostrzalPrzed = await worldState();
    await fireHub('special_yamato_cannon', mx, mz, w.x, w.z, 3, 500);
    await fireHub('heavy_autocannon_l', mx, mz, w.x + 60, w.z, 12, 120);
    await fireHub('armata_mk1', mx, mz, w.x - 120, w.z, 4, 400);
    await shot('05-ostrzal-sciany', 1500);
    await fireHub('beam_pulse', mx, mz, w.x + 160, w.z, 10, 300);
    await shot('06-wiazka', 900);
    // rakieta manewrująca w punkt ściany
    await ev(`(() => {
      const d = window.StoryGame.site.dock, W = window.MASTER_WEAPONS.missile_rack;
      const p = d.toGame(${mx}, ${mz}), t = d.toGame(${w.x} - 260, ${w.z});
      const ang = Math.atan2(t.y - p.y, t.x - p.x);
      window.rocketSystem3D.fireSalvo(window.ship, p.x, p.y, { x: t.x, y: t.y, dead: false, _isPositionTarget: true }, W.baseDamage, W, 'blue', 0, 0, 1, 0, ang, 0);
      return true;
    })()`);
    await shot('07-rakieta', 3500);
    // próg punktów habitatu w ścianie: kawałek-ciało odpada fizycznie (worldBodies.breakPiece)
    await ev(`(() => {
      const S = window.StoryGame, st = S.site.structures.habitat, d = S.site.dock;
      const p = d.toGame(${w.x}, ${w.z});
      st.lastHitX = p.x; st.lastHitY = p.y;
      window.applyDamageToStation(st, Math.ceil(st.maxHp / (st.damageSteps || 8)) + 10);
      return true;
    })()`);
    await camHub(w.x + w.nx * 600, w.z + w.nz * 600, 0.2);
    await shot('08-prog-odpada', 2500);
    await shot('09-prog-odpada-2', 3000);
  }
  report.pipeline = await ev(`(() => {
    const p = (window.__pipeRec?.pipes || []).filter((x) => x.frame > 0);
    const sync = p.filter((x) => x.sync);
    const skin = sync.filter((x) => /PortBuildingSkin|ciało świata/.test(x.nazwa));
    const W = window.Core3D?.warmup?.stats;
    return { wszystkie: (window.__pipeRec?.pipes || []).length, wGrze: p.length, sync: sync.length, syncSkora: skin.length, listaSkora: skin.slice(0, 20).map((x) => x.nazwa), lista: sync.slice(0, 30).map((x) => x.nazwa),
      klatki: sync.slice(0, 30).map((x) => x.frame), rozgrzewka: W ? { flush: W.flush, grupy: W.grupy } : null };
  })()`);
  console.log('pipeline:', JSON.stringify(report.pipeline));
  report.koniec = await worldState();
  console.log('kawałki:', JSON.stringify(report.koniec.pieces));
  if (args.czujka) {
    report.czujka = await ev('(() => (window.__czujka ? window.__czujka.hits : null))()');
    for (const h of report.czujka || []) console.log('czujka:', JSON.stringify(h));
  }
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
