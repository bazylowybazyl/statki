// Zniszczenia świata W GRZE (F2 docs/PLAN-zniszczenia-swiata-3d.md): kawałki suchego doku piratów w bańce gracza
// są ciałami silnika belek (src/game/worldBodies.js), rysuje je skóra brył (src/3d/worldBodies3D.js). Bez dymu,
// ognia i wybuchów gazu (decyzja użytkownika 2026-10-05). Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/zniszczenia-gra.mjs [--out .tmp/zniszczenia-gra] [--rozmiar 1600x900] [--hexlance] [--czujka] [--dziennik]
//   --czujka: klatka, w której kawałek trzonu traci > 20 węzłów (lekki podgląd w rAF), --dziennik: fale ciśnienia
//   i zniszczone węzły na kawałek między kadrami (opakowania zmieniają przebieg — tylko do szukania źródła).
//
// Skok dev ?story=ram, kamera RTS bez HUD-u:
//   01 statyka — parking, kawałki w bańce już są ciałami (nietknięte: rysuje je statyka budowli),
//   02 skóra bez ruchu — te same kawałki oznaczone „ruszone” (skóra zamiast statyki; A/B z 01 — ma być ten sam obraz),
//   03 taran bramy G-W Atlasem (zwykłe zderzenie kadłubów), 04 Atlas za bramą,
//   05 ostrzał ściany hali (Yamato, autodziało oblężnicze, armata z promieniem rażenia), 06 wiązka pulsowa (ciepło),
//   07 rakieta manewrująca w ścianę (front ciśnienia), 08 próg punktów doku — kawałek-ciało odpada fizycznie.
// --hexlance: faza „shipyard”, Atlas przed parkingiem, Hexlance (4, ładowanie, 4) w trzon.
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

// Dziennik zniszczeń (każdy kadr): fale ciśnienia (miejsce w układzie doku, promień, moc, źródło) i zniszczone węzły
// na kawałek (hak destroyNode silnika) — skąd ubytek w konstrukcji.
const DMG_LOG = `(() => {
  const hook = setInterval(() => {
    const W = window.WorldBodies, D = window.HullBodies && window.HullBodies.engine;
    if (!W || !D || !W.detonate || !D.destroyNode) return;
    clearInterval(hook);
    const L = window.__dmgLog = { fale: [], lost: {} };
    const det = W.detonate.bind(W);
    W.detonate = function (x, y, radius, power, dx, dy) {
      const site = W.sites[0], d = site && site.place;
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
    const Wb = window.WorldBodies, site = Wb && Wb.sites && Wb.sites[0];
    if (!site) return;
    for (const p of site.pieces) {
      if (p.kind !== 'spine' || p.state !== 'live') continue;
      const n = p.alive | 0, was = W.prev[p.id];
      W.prev[p.id] = n;
      if (was && n < was - 20 && W.hits.length < 12) {
        const sh = window.ship, d = site.place, h = d.toHub(sh.pos.x, sh.pos.y);
        const wr = (window.wrecks || []).filter((w) => w && !w.dead && w.worldDebris).map((w) => ({ id: w.beamHull && w.beamHull.world && w.beamHull.world.id, n: w.beamHull && w.beamHull.body && w.beamHull.body.activeNodes, v: Math.round(Math.hypot(w.vx || 0, w.vy || 0)) }));
        W.hits.push({ id: p.id, przed: was, po: n, frame: window.__frameId | 0, atlas: { hub: [Math.round(h.x), Math.round(h.z)], v: Math.round(Math.hypot(sh.vel.x, sh.vel.y)), kurs: +((sh.angle - d.axis) * 57.3).toFixed(1) },
          kanaly: { ...Wb.channels.stats, impulse: Math.round(Wb.channels.stats.impulse) }, stats: { ...Wb.stats }, reaktor: window.ReactorGame && window.ReactorGame.detonations, odlamy: wr,
          hp: Math.round(window.StoryGame.site.station.hp), bramaG: (site.pieces.find((q) => q.id === 'G-W') || {}).alive });
      }
    }
  };
  requestAnimationFrame(tick);
})();` });

// Pipeline'y three utworzone SYNCHRONICZNIE (render materiału bez rozgrzewki = przestój) — skóra ciał świata
// (PortBuildingSkin_*) ma być rozgrzana na ekranie ładowania (Core3D.warmup, pirateDryDockGame.js).
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

// kamera RTS nad punktem układu doku (x wzdłuż trzonu, z w poprzek) z zoomem, bez HUD-u
const camHub = (x, z, zoom) => ev(`(() => {
  const site = window.StoryGame.site, c = window.camera;
  const p = site.dock.toGame(${x}, ${z});
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return true;
})()`);

const PIECES = ['G-W', 'Q-W', 'P-1', 'B-01', 'S-1', 'S-2', 'S-3', 'H-W1', 'H-W2', 'H-SW'];
const worldState = () => ev(`(() => {
  const Wb = window.WorldBodies, site = Wb.sites[0];
  const pieces = {};
  for (const id of ${JSON.stringify(PIECES)}) {
    const p = site && site.pieces.find((q) => q.id === id);
    if (!p) continue;
    const b = p.entity && p.entity.beamHull && p.entity.beamHull.body;
    pieces[id] = { stan: p.state, ruszony: !!p.touched, stracony: !!p.lost, wezly: p.baseNodes, zywe: p.alive != null ? p.alive : (b ? b.activeNodes : 0), wyspy: p.islands.length, maxDisp: b ? +(b._maxDisp || 0).toFixed(1) : 0 };
  }
  const odlamy = (window.wrecks || []).filter((w) => w && !w.dead && w.worldDebris).length;
  const s = Wb.stats;
  const st = window.StoryGame.site && window.StoryGame.site.station;
  const L = window.__dmgLog || { fale: [], lost: {} };
  const fale = L.fale.splice(0), lost = L.lost;
  L.lost = {};
  return {
    zniszczoneWezly: lost, fale,
    stats: { ...s, stepMs: +(s.stepMs || 0).toFixed(3), stepPeakMs: +(s.stepPeakMs || 0).toFixed(2), buildMs: +(s.buildMs || 0).toFixed(2) },
    kanaly: Wb.channels ? { ...Wb.channels.stats, impulse: Math.round(Wb.channels.stats.impulse || 0) } : null,
    skora: { ...(window.__worldSkinStats || {}) }, odlamy,
    dok: st ? { hp: Math.round(st.hp), maxHp: st.maxHp, statykaBrak: [...(st._dockGone || [])].length } : null,
    taran: !!(window.StoryGame.site && window.StoryGame.site.gateRammed),
    pieces
  };
})()`);
async function shot(name, wait = Number(args.czekaj || 700)) {
  await sleep(wait);
  const st = await worldState();
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.kadry.push({ name, ...st });
  console.log(name.padEnd(24), JSON.stringify({ stats: st.stats, skora: st.skora, odlamy: st.odlamy, dok: st.dok, taran: st.taran }));
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

// gracz w punkcie układu doku (hub), kurs w układzie (rad), prędkość [j/s] wzdłuż kursu
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

async function hexlanceRun() {
  await startStory('shipyard');
  await sleep(2000);
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(575, 4000); S.deps.placePlayer(p.x, p.y, d.headingToGame(-Math.PI / 2)); return true; })()`);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  await sleep(1500);
  await camHub(575, 1500, 0.09);
  const before = await worldState();
  await tap4();
  await sleep(1700);
  await tap4();
  await sleep(2600);
  const after = await shot('20-hexlance');
  await camHub(575, 300, 0.2);
  await shot('21-hexlance-zblizenie');
  report.hexlance = { przed: before, po: after };
}

try {
  if (args.hexlance) {
    await hexlanceRun();
  } else {
    await startStory('ram');
    await sleep(2500);
    const L = await ev(`(() => {
      const l = window.StoryGame.site.dock.layout;
      const e = l.hall.edges[4];
      return { z0: l.bounds.z0, z1: l.bounds.z1, cz: (l.bounds.z0 + l.bounds.z1) / 2, lane: l.parking.laneZ, px0: l.parking.x0, px1: l.parking.x1,
        wall: { x: e.a[0] + e.ux * e.length * 0.25, z: e.a[1] + e.uz * e.length * 0.25, nx: e.nx, nz: e.nz } };
    })()`);
    report.uklad = L;
    // gracz nad parkingiem (bańka obejmuje parking i trzon), statyka vs skóra (A/B)
    await placeHub(L.px0 - 1500, L.lane, 0, 0);
    await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 20', 30000, 200);
    await sleep(1500);
    await camHub(L.px0 + 300, L.lane - 400, 0.3);
    await shot('01-statyka', 1200);
    await ev(`(() => { const site = window.WorldBodies.sites[0]; for (const p of site.pieces) if (p.state === 'live' && ['G-W', 'Q-W', 'P-1', 'B-01', 'S-1'].includes(p.id)) p.touched = true; return true; })()`);
    await shot('02-skora-bez-ruchu', 1200);
    // taran: dziób 350 j. przed bramą G-W, 900 j/s wzdłuż osi doku
    report.taranPrzed = await worldState();
    await ev(`(() => {
      const S = window.StoryGame, site = S.site, d = site.dock, ship = window.ship;
      const len = (ship.beamHull && ship.beamHull.srcWidth * ship.beamHull.scale) || 1800;
      const p = d.toGame(${L.px0} - 350 - len / 2, ${L.lane});
      S.deps.placePlayer(p.x, p.y, d.axis);
      ship.vel.x = Math.cos(d.axis) * 900; ship.vel.y = Math.sin(d.axis) * 900;
      return true;
    })()`);
    await camHub(L.px0 + 200, L.lane - 100, 0.3);
    await shot('03-taran-brama', 1100);
    await camHub(L.px0 + 700, L.lane - 100, 0.24);
    await shot('04-za-brama', 1800);
    report.taran = await ev(`(() => ({ v: Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y)), gateRammed: !!window.StoryGame.site.gateRammed, maskowanie: window.ship?.cloak?.state || null }))()`);
    console.log('taran:', JSON.stringify(report.taran));
    // ostrzał ściany hali H-W1 z 2,5 km (lufa 1 km przed statkiem)
    const w = L.wall;
    const sx = w.x + w.nx * 2500, sz = w.z + w.nz * 2500;
    const mx = w.x + w.nx * 1500, mz = w.z + w.nz * 1500;
    await placeHub(sx, sz, Math.atan2(-w.nz, -w.nx), 0);
    await ev('(() => { window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()');
    await waitFor(cdp, `(() => { const p = window.WorldBodies.sites[0].pieces.find((q) => q.id === 'H-W1'); return p && p.state === 'live'; })()`, 20000, 200);
    await camHub(w.x + w.nx * 200, w.z + w.nz * 200, 0.32);
    await sleep(800);
    report.ostrzalPrzed = await worldState();
    await fireHub('special_yamato_cannon', mx, mz, w.x, w.z, 3, 500);
    await fireHub('heavy_autocannon_l', mx, mz, w.x, w.z + 60, 12, 120);
    await fireHub('armata_mk1', mx, mz, w.x, w.z - 120, 4, 400);
    await shot('05-ostrzal-sciany', 1500);
    await fireHub('beam_pulse', mx, mz, w.x, w.z + 160, 10, 300);
    await shot('06-wiazka', 900);
    // rakieta manewrująca w punkt ściany
    await ev(`(() => {
      const d = window.StoryGame.site.dock, W = window.MASTER_WEAPONS.missile_rack;
      const p = d.toGame(${mx}, ${mz}), t = d.toGame(${w.x}, ${w.z} - 260);
      const ang = Math.atan2(t.y - p.y, t.x - p.x);
      window.rocketSystem3D.fireSalvo(window.ship, p.x, p.y, { x: t.x, y: t.y, dead: false, _isPositionTarget: true }, W.baseDamage, W, 'blue', 0, 0, 1, 0, ang, 0);
      return true;
    })()`);
    await shot('07-rakieta', 3500);
    // próg punktów doku w ścianie: kawałek-ciało odpada fizycznie (worldBodies.breakPiece)
    await ev(`(() => {
      const S = window.StoryGame, st = S.site.station, d = S.site.dock;
      const p = d.toGame(${w.x}, ${w.z});
      st.lastHitX = p.x; st.lastHitY = p.y;
      window.applyDamageToStation(st, Math.ceil(st.maxHp / 8) + 10);
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
    return { wszystkie: (window.__pipeRec?.pipes || []).length, wGrze: p.length, sync: sync.length, syncSkora: skin.length, listaSkora: skin.slice(0, 20).map((x) => x.nazwa), lista: sync.slice(0, 30).map((x) => x.nazwa) };
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
