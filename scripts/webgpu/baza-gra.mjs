// Baza piratów (misja 1, szkic użytkownika 2026-10-11) w PRAWDZIWEJ grze: Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/baza-gra.mjs [--out .tmp/baza-gra] [--rozmiar 1600x900] [--czekaj 700] [--mgla 0] [--kadry 1]
//
// --mgla 0 — bez mgły wojny (barwy budowli na całej bazie), --kadry 1 — tylko kadry bazy (01–04 + zbliżenia
// zbiorników, zatoki supercapitali i magazynu), bez taranu i reakcji.
//
// Skok dev ?story=ram (baza postawiona, gracz przed rzędem do taranu), kamera RTS bez HUD-u:
//   01 cała baza, 02 habitat z bliska (bęben otwarty, dysk mieszkalny pod spodem), 03 ramię A z rzędem okrętów,
//   04 zbiorniki paliwa i zatoka supercapitali, 05–06 taran — Atlas wzdłuż rzędu przy ramieniu A (zderzenia kadłubów
//   z ciałami bazy i okrętami), 07 alarm: drony z hangarów, herszt z zatoki, 08–09 reakcja łańcuchowa ze zbiorników
//   (front w rurach), 10–11 rozpad habitatu (bęben, dysk — implozja).
// Raport: <out>/raport.json — stan bazy (punkty budowli, kawałki odpadłe), taran, drony, reakcja, pipeline'y
// synchroniczne w klatkach gry (ma być 0 dla materiałów bazy), błędy konsoli.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/baza-gra');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5376));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { kadry: [], bledy: [] };

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

// kamera RTS nad punktem układu bazy (x wzdłuż osi, z w poprzek) z zoomem, bez HUD-u
const camHub = (x, z, zoom) => ev(`(() => {
  const site = window.StoryGame.site, c = window.camera;
  const p = site.dock.toGame(${x}, ${z});
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return true;
})()`);
// kamera statku (stery gracza: w trybie RTS klawisze lotu i maskowania nie działają)
const camShip = (zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode === 'rts' && typeof c.exitRtsMode === 'function') c.exitRtsMode();
  c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  return true;
})()`);
const baseState = () => ev(`(() => {
  const S = window.StoryGame, site = S.site, st = site.structures || {}, b = window.PirateBase;
  const hp = (s) => s ? Math.round(s.hp) : null;
  return {
    faza: S.phase, alarm: !!site.alarmed,
    habitat: hp(st.habitat), paliwo: hp(st.fuel), magazyn: hp(st.warehouse), pomosty: hp(st.piers),
    odpadle: b ? b.broken() : [],
    zywe: window.WorldBodies?.stats?.live ?? null,
    taran: !!site.gateRammed,
    stanowiska: site.parkedList.filter((n) => !n.dead).length, zaloga: site.crewList.filter((n) => !n.dead && !n.__storyLaunched).length,
    drony: site.droneList.filter((n) => !n.dead).length, herszt: site.flagship ? (site.flagship.dead ? 'x' : site.flagship.__storyLaunched ? 'L' : 'S') : '-',
    reakcja: { paliwo: !!site.chain?.fuel, habitat: !!site.chain?.habitat, zabite: site.chain?.killed || 0 },
    zasilanie: site.powerLive ? Object.fromEntries(Object.entries(site.powerLive).map(([k, v]) => [k, +v.toFixed(2)])) : null
  };
})()`);
async function shot(name) {
  await sleep(Number(args.czekaj || 700));
  const st = await baseState();
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.kadry.push({ name, ...st });
  console.log(name.padEnd(22), JSON.stringify(st));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=ram` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  const fog = String(args.mgla ?? '1') === '0' ? '0' : '1';
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); localStorage.setItem('sc_fog_of_war', '${fog}'); return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'ram' && !!window.StoryGame.site?.station", 300000, 400)) throw new Error('faza ram nie ruszyła');
  await sleep(2500);
  const L = await ev(`(() => {
    const l = window.StoryGame.site.dock.layout;
    const t = l.tanks[0], p1 = l.nodes.P1, r = l.ram;
    return { cx: l.center.x, cz: l.center.z, tank: { x: t.x, z: t.z }, bay: { x: l.nodes.P0.x - 700, z: (l.nodes.P0.z + p1.z) / 2 },
      ram: r, armA: { x: (l.nodes.F.x + l.nodes.A1.x) / 2, z: (l.nodes.F.z + l.nodes.A1.z) / 2 } };
  })()`);
  // gracz z dala od kadrów (bez alarmu: maskowanie nie jest potrzebne — wykrycie przy 9 km)
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(-15000, 0); S.deps.placePlayer(p.x, p.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
  await camHub(L.cx, L.cz, 0.06);
  await shot('01-cala-baza');
  await camHub(0, 0, 0.24);
  await shot('02-habitat');
  await camHub(L.armA.x, L.armA.z, 0.16);
  await shot('03-ramie-A');
  await camHub((L.tank.x + L.bay.x) / 2, (L.tank.z + L.bay.z) / 2, 0.11);
  await shot('04-zbiorniki-zatoka');
  if (args.kadry) {
    await camHub(L.tank.x, L.tank.z, 0.32);
    await shot('04b-zbiorniki-blisko');
    await camHub(L.bay.x, L.bay.z, 0.2);
    await shot('04c-zatoka-supercapitali');
    const M = await ev(`(() => { const w = window.StoryGame.site.dock.layout.warehouse; return { x: w.x, z: w.z }; })()`);
    await camHub(M.x, M.z, 0.24);
    await shot('04d-magazyn');
    report.bledy = logs.errors().slice(0, 80);
    if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
    writeJson(join(out, 'raport.json'), report);
    await chrome.close();
    await server.close();
    process.exit(0);
  }
  // taran: Atlas na torze rzędu (wewnętrzna strona ramienia A) — rufą do rzędu z odstępem (Atlas ~3 km: środek
  // pół długości + 400 j. przed początkiem toru), maskowanie (I), potem W + Shift (dopalacz) przez cały rząd jak gracz
  report.taranPrzed = await baseState();
  await ev(`(() => {
    const S = window.StoryGame, site = S.site, d = site.dock, ship = window.ship, r = d.layout.ram;
    const a = d.headingToGame(r.dir);
    const p = d.toGame(r.start.x, r.start.z);
    const back = Math.max(ship.w || 0, ship.h || 0, 2 * (ship.radius || 0)) / 2 + 400;
    S.deps.placePlayer(p.x - Math.cos(a) * back, p.y - Math.sin(a) * back, a);
    ship.vel.x = 0; ship.vel.y = 0;
    return true;
  })()`);
  await camShip(0.13);
  await sleep(900);
  const key = (code, k, vk) => ({ key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  const KEY_I = key('KeyI', 'i', 73), KEY_W = key('KeyW', 'w', 87), KEY_SHIFT = key('ShiftLeft', 'Shift', 16);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_I });
  await sleep(80);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_I });
  await sleep(2500);
  report.maskowanie = await ev(`(() => ({ stan: window.ship?.cloak?.state || null, alarm: !!window.StoryGame.site.alarmed }))()`);
  console.log('maskowanie:', JSON.stringify(report.maskowanie));
  // rozpęd jak przy podejściu gracza z dopalaczem (700 j/s), potem W + Shift trzymane
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock, ship = window.ship, a = d.headingToGame(d.layout.ram.dir); ship.vel.x = Math.cos(a) * 700; ship.vel.y = Math.sin(a) * 700; return true; })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_SHIFT });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_W, modifiers: 8 });
  const ramT0 = Date.now();
  report.taranTor = [];
  const ramProbe = async () => report.taranTor.push(await ev(`(() => {
    const S = window.StoryGame, site = S.site, d = site.dock, ship = window.ship, h = d.toHub(ship.pos.x, ship.pos.y), r = d.layout.ram;
    const along = ((h.x - r.start.x) * Math.cos(r.dir) + (h.z - r.start.z) * Math.sin(r.dir));
    return { t: +((Date.now() - ${ramT0}) / 1000).toFixed(1), wzdluz: Math.round(along), v: Math.round(Math.hypot(ship.vel.x, ship.vel.y)), rzad: site.ramList().map((n) => n.dead ? 'x' : (n.hp / n.maxHp).toFixed(2)) };
  })()`));
  for (let i = 0; i < 6; i++) { await sleep(500); await ramProbe(); }
  await shot('05-taran-1');
  for (let i = 0; i < 12; i++) { await sleep(500); await ramProbe(); }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_W });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_SHIFT });
  await shot('06-taran-2');
  console.log('tor taranu:', JSON.stringify(report.taranTor));
  report.taran = await ev(`(() => { const site = window.StoryGame.site; return { gateRammed: !!site.gateRammed, rammed: site.rammed(), rzad: site.ramList().map((n) => n.dead ? 'x' : (n.hp / n.maxHp).toFixed(2)), alarm: !!site.alarmed, faza: window.StoryGame.phase }; })()`);
  console.log('taran:', JSON.stringify(report.taran));
  // alarm: drony z hangarów, herszt z zatoki
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(-15000, 0); S.deps.placePlayer(p.x, p.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0; S._alarm(S.site); return true; })()`);
  await camHub(0, 0, 0.12);
  await sleep(3000);
  await shot('07-alarm-drony');
  // reakcja łańcuchowa ze zbiorników (gracz „odkrył” P)
  await ev(`(() => { const S = window.StoryGame, st = S.site.structures.fuel; const p = S.site.dock.toGame(${L.tank.x}, ${L.tank.z}); st.lastHitX = p.x; st.lastHitY = p.y; window.applyDamageToStation(st, 1e7); return true; })()`);
  await camHub(L.cx + 2000, L.cz, 0.07);
  await sleep(3500);
  await shot('08-reakcja-1');
  await sleep(6000);
  await shot('09-reakcja-2');
  // rozpad habitatu (jeśli reakcja go nie zabrała — Hexlance / ostrzał)
  await ev(`(() => { const S = window.StoryGame, st = S.site.structures.habitat; if (st.hp > 0) { st.lastHitX = st.x; st.lastHitY = st.y; window.applyDamageToStation(st, 1e7); } return true; })()`);
  await camHub(0, 0, 0.09);
  await sleep(2500);
  await shot('10-habitat-rozpad-1');
  await sleep(5000);
  await shot('11-habitat-rozpad-2');
  report.pipeline = await ev(`(() => {
    const p = (window.__pipeRec?.pipes || []).filter((x) => x.frame > 0);
    const sync = p.filter((x) => x.sync);
    const base = sync.filter((x) => /PortBuilding|Baza piratów|ciało świata/.test(x.nazwa));
    return { wszystkie: (window.__pipeRec?.pipes || []).length, wGrze: p.length, sync: sync.length, syncBaza: base.length, listaBaza: base.slice(0, 20).map((x) => x.nazwa), lista: sync.slice(0, 30).map((x) => x.nazwa) };
  })()`);
  console.log('pipeline:', JSON.stringify(report.pipeline));
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
