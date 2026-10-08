// Systemy okrętu pod F („specjale F”, 2026-10-08) w PRAWDZIWEJ grze: src/data/shipSystems.js, src/game/shipSystem.js,
// src/ai/npcShipSystem.js, klej gracza w index.html (blok „SYSTEM OKRĘTU (F)”). Vite + headless Chrome z WebGPU (CDP),
// gra swobodna, klawisze jak od gracza, czas z zegara symulacji (DevScene.simTime).
//
//   node scripts/webgpu/specjale-f-gra.mjs [--out .tmp/specjale-f] [--rozmiar 1600x900] [--etapy szarza,manewr,zryw,ogien,npc]
//        [--npcCzas 40]
//
// Etapy:
//   szarza — Atlas (domyślnie): F, prędkość zrywu, czas, struga MAIN jak dopalacz;
//   manewr — Atlas z systemem `maneuver`: E + F i Q + F (przesunięcie w bok, czas, ciąg dysz SIDE), D + F (obrót na kursor
//            90° w prawo: czas, błąd końcowy), samo F na kursor za rufą (najkrótszą drogą);
//   zryw   — Custos (Terra Nova): W, potem F — prędkość bojowa i w zrywie, czas, hamowanie po zrywie;
//   ogien  — Marauder (piraci): spust na cel ćwiczebny — strzały na sekundę bez i z szybkim ogniem;
//   npc    — potyczka z dala od gracza: piracki niszczyciel (szybki ogień — użycia, tempo strzałów działa) i niszczyciel
//            Terra Nova, pancernik Terra Nova daleko za szykiem (zryw w drodze do miejsca w szyku).
// Wynik: <out>/*.png i <out>/raport.json (pomiary, pipeline'y tworzone synchronicznie w klatce, błędy konsoli).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/specjale-f');
const only = args.etapy ? new Set(String(args.etapy).split(',')) : null;
const npcSeconds = Number(args.npcCzas || 40);
mkdirSync(out, { recursive: true });
const DEEP = { x: 6210000, y: 5330000 };   // pusta przestrzeń (jak dym-gra / efekty-kontrola)

const { server, base } = await startVite(Number(args.port || 5397));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { etapy: {}, pipelineSync: {}, bledy: [] };

const CODES = { e: 'KeyE', q: 'KeyQ', a: 'KeyA', d: 'KeyD', w: 'KeyW', f: 'KeyF' };
const keyEv = (type, k) => cdp.send('Input.dispatchKeyEvent', {
  type, key: k, code: CODES[k], windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), nativeVirtualKeyCode: k.toUpperCase().charCodeAt(0)
});
const down = (k) => keyEv('keyDown', k);
const up = (k) => keyEv('keyUp', k);
const tap = async (k) => { await down(k); await sleep(50); await up(k); };
const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });

// Pipeline'y tworzone synchronicznie w klatce (to, czego nie rozgrzano) — licznik w backendzie three.
const HOOK = `(() => {
  const be = window.Core3D?.renderer?.backend;
  if (!be || be.__fSysHook) return !!be;
  const list = window.__fSysSync = [];
  const orig = be.createRenderPipeline.bind(be);
  be.createRenderPipeline = (ro, promises) => {
    if (!promises) list.push((ro.material && (ro.material.name || ro.material.type)) + ' @ ' + (ro.object && (ro.object.name || ro.object.type)));
    return orig(ro, promises);
  };
  be.__fSysHook = true;
  return true;
})()`;
const syncCount = () => ev('(window.__fSysSync || []).length');
const syncSince = async (stage, from) => {
  const list = await ev(`(window.__fSysSync || []).slice(${from})`);
  report.pipelineSync[stage] = { liczba: list.length, lista: list.slice(0, 20) };
  return list.length;
};

// Rejestrator klatek gracza (czas symulacji, ruch, stan systemu F, ciąg dysz).
const REC = `(() => {
  if (window.__fRec) return true;
  const r = window.__fRec = { on: false, s: [] };
  const loop = () => {
    if (r.on) {
      const s = window.ship, st = window.ramBurn;
      let side = 0, main = 0;
      for (const t of (s.visual?.torqueThrusters || [])) side = Math.max(side, Number(t.__throttle) || 0);
      for (const t of (s.visual?.mainThrusters || [])) main = Math.max(main, Number(t.__throttle) || 0);
      const c = window.__fcEnv?.cursor;
      r.s.push({ t: window.DevScene.simTime(), x: s.pos.x, y: s.pos.y, vx: s.vel.x, vy: s.vel.y, a: s.angle, w: s.angVel,
        act: st.action, on: st.active, actT: st.actT, sysT: st.t, ch: st.charges, side, main, boost: !!s.__fSysBoost,
        cx: c ? c.x : 0, cy: c ? c.y : 0 });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return true;
})()`;
const recStart = () => ev('(() => { window.__fRec.s.length = 0; window.__fRec.on = true; return true; })()');
const recStop = () => ev('(() => { window.__fRec.on = false; return window.__fRec.s; })()');

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const speedOf = (s) => Math.hypot(s.vx, s.vy);

// Gracz w pustej przestrzeni, stoi, kurs `heading`, zoom kamery.
const place = (heading = 0, zoom = 0.32) => ev(`(() => {
  window.DevScene.teleport(${DEEP.x}, ${DEEP.y}, ${heading});
  window.ship.angVel = 0;
  const c = window.camera; c.zoom = c.targetZoom = ${zoom};
  window.DevScene.syncCamera();
  return true;
})()`);
const sysInfo = () => ev(`(() => { const d = window.playerShipSystem(); const st = window.ramBurn;
  return d ? { id: d.id, label: d.label, kadlub: window.PLAYER?.activeHullId ?? null, gotowy: st.charge, ladunki: st.charges } : null; })()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
}
// Pole F na szynie kokpitu (pola są w shadow DOM kokpitu — czytane z obiektu CockpitUI).
const hudSlotF = () => ev(`(() => {
  const slot = (window.hudSystem?.cockpit?.slots || []).find((s) => s.definition?.key === 'F');
  return slot ? { nazwa: slot.name?.textContent, ikona: slot.icon?.textContent, tytul: slot.button?.title, klasy: slot.button?.className } : null;
})()`);
// Punkt świata → piksel ekranu przycięty do kanwy (zdarzenia myszy poza kanwą nie dochodzą do gry).
const pointer = async (x, y) => {
  const p = await ev(`window.DevScene.pointerAt(${x}, ${y})`);
  return { x: Math.round(Math.min(W - 12, Math.max(12, p.x))), y: Math.round(Math.min(H - 12, Math.max(12, p.y))) };
};
const want = (stage) => !only || only.has(stage);

// Skok: przesunięcie wzdłuż osi „w prawo” kadłuba z chwili startu, czas skoku (symulacji), ciąg dysz SIDE.
function measureJump(samples) {
  const i0 = samples.findIndex((s) => s.act === 'jump');
  if (i0 < 1) return null;
  let i1 = i0;
  while (i1 + 1 < samples.length && samples[i1 + 1].act === 'jump') i1++;
  const a = samples[i0 - 1];
  const b = samples[Math.min(samples.length - 1, i1 + 1)];
  const rx = -Math.sin(a.a), ry = Math.cos(a.a);
  const fx = Math.cos(a.a), fy = Math.sin(a.a);
  const dx = b.x - a.x, dy = b.y - a.y;
  let side = 0, peak = 0;
  for (let i = i0; i <= i1; i++) {
    side = Math.max(side, samples[i].side);
    peak = Math.max(peak, Math.abs(samples[i].vx * rx + samples[i].vy * ry));
  }
  return {
    wBok: Math.round(dx * rx + dy * ry), wPrzod: Math.round(dx * fx + dy * fy), czasS: r2(b.t - a.t),
    szczytJs: Math.round(peak), ciagSide: r2(side), kurs: r1((b.a - a.a) * 180 / Math.PI)
  };
}

// Obrót: czas (symulacji), kąt obrotu, błąd końcowy względem kursora, największa prędkość kątowa.
function measureTurn(samples) {
  const i0 = samples.findIndex((s) => s.act === 'turn');
  if (i0 < 1) return null;
  let i1 = i0;
  while (i1 + 1 < samples.length && samples[i1 + 1].act === 'turn') i1++;
  const a = samples[i0 - 1];
  const b = samples[Math.min(samples.length - 1, i1 + 1)];
  let travel = 0, wMax = 0, side = 0;
  for (let i = i0; i <= i1 + 1 && i < samples.length; i++) {
    travel += wrap(samples[i].a - samples[i - 1].a);
    wMax = Math.max(wMax, Math.abs(samples[i].w));
    side = Math.max(side, samples[i].side);
  }
  const bearing = Math.atan2(b.cy - b.y, b.cx - b.x);
  return {
    czasS: r2(b.t - a.t), obrotDeg: r1(travel * 180 / Math.PI), bladKoncowyDeg: r1(Math.abs(wrap(bearing - b.a)) * 180 / Math.PI),
    maxDegS: r1(wMax * 180 / Math.PI), ciagSide: r2(side), predkoscKatowaPo: r2(b.w * 180 / Math.PI)
  };
}

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.setPlayerShipSystem)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 40 && !!window.DevScene?.simTime', 300000, 400)) throw new Error('gra nie ruszyła');
  await waitFor(cdp, HOOK, 30000, 300);
  await ev(REC);
  await sleep(1500);
  report.start = { system: await sysInfo(), opcjeAtlasa: await ev(`window.getPlayerShipSystemOptions('atlas').map((d) => d.id)`) };
  console.log('start', JSON.stringify(report.start));

  // ---------------------------------------------------------------- szarża (Atlas)
  if (want('szarza')) {
    const s0 = await syncCount();
    await ev(`window.setPlayerShipSystem('')`);
    await place(0, 0.22);
    await sleep(1200);
    await recStart();
    await tap('f');
    await sleep(1500);
    await shot('01-szarza');
    await sleep(4600);
    const smp = await recStop();
    const act = smp.filter((s) => s.on);
    report.etapy.szarza = {
      system: await sysInfo(), vMax: Math.round(Math.max(...smp.map(speedOf))),
      czasS: act.length ? r2(Math.max(...act.map((s) => s.sysT))) : 0, strugaJakDopalacz: act.some((s) => s.boost)
    };
    await syncSince('szarza', s0);
    console.log('szarża', JSON.stringify(report.etapy.szarza));
  }

  // ---------------------------------------------------------------- manewr (Atlas)
  if (want('manewr')) {
    const s0 = await syncCount();
    const picked = await ev(`window.setPlayerShipSystem('maneuver')?.id || null`);
    const res = { wybrany: picked };
    await place(0, 0.3);
    await sleep(1500);
    // Skok w prawo: E trzymane, F.
    await recStart();
    await down('e');
    await sleep(80);
    await tap('f');
    await sleep(250);
    await shot('02-manewr-skok-prawo');
    await sleep(1300);
    await up('e');
    res.skokPrawo = measureJump(await recStop());
    // Skok w lewo: Q trzymane, F (drugi ładunek).
    await place(0, 0.3);
    await sleep(600);
    await recStart();
    await down('q');
    await sleep(80);
    await tap('f');
    await sleep(1500);
    await up('q');
    res.skokLewo = measureJump(await recStop());
    // Obrót D + F na kursor 90° w prawo (3 km od okrętu), ładunki uzupełnione (bez czekania na odnowę).
    await ev(`(() => { window.ramBurn.charges = 2; window.ramBurn.regen = 0; return true; })()`);
    await place(0, 0.3);
    await sleep(700);
    await ev(`window.DevScene.pointerAt(${DEEP.x}, ${DEEP.y + 3000})`);
    await sleep(500);
    await recStart();
    await down('d');
    await sleep(60);
    await tap('f');
    await sleep(60);
    await up('d');
    await sleep(600);
    await shot('03-manewr-obrot');
    await sleep(2600);
    res.obrotD90 = measureTurn(await recStop());
    // Samo F: kursor za rufą po lewej (150°) — obrót najkrótszą drogą (po końcu poprzedniego obrotu).
    await waitFor(cdp, `!window.ramBurn.action`, 10000, 100);
    await place(0, 0.3);
    await sleep(700);
    const back = 150 * Math.PI / 180;
    await ev(`window.DevScene.pointerAt(${DEEP.x} + Math.cos(-${back}) * 3000, ${DEEP.y} + Math.sin(-${back}) * 3000)`);
    await sleep(500);
    await recStart();
    await tap('f');
    await sleep(4200);
    res.obrotF150 = measureTurn(await recStop());
    // A + F przy kursorze 40° w prawo — obrót „w tę stronę” (przez lewą burtę).
    await waitFor(cdp, `!window.ramBurn.action`, 10000, 100);
    await ev(`(() => { window.ramBurn.charges = 2; window.ramBurn.regen = 0; return true; })()`);
    await place(0, 0.3);
    await sleep(700);
    const r40 = 40 * Math.PI / 180;
    await ev(`window.DevScene.pointerAt(${DEEP.x} + Math.cos(${r40}) * 3000, ${DEEP.y} + Math.sin(${r40}) * 3000)`);
    await sleep(500);
    await recStart();
    await down('a');
    await sleep(60);
    await tap('f');
    await sleep(60);
    await up('a');
    await sleep(7000);
    res.obrotA40 = measureTurn(await recStop());
    res.hud = await hudSlotF();
    report.etapy.manewr = res;
    await shot('04-manewr-hud');
    await syncSince('manewr', s0);
    console.log('manewr', JSON.stringify(res));
  }

  // ---------------------------------------------------------------- zryw silników (Custos)
  if (want('zryw')) {
    const s0 = await syncCount();
    await ev(`window.DevScene.setHull('frigate')`);
    await waitFor(cdp, `window.PLAYER?.activeHullId === 'frigate' && !!window.ship.beamHull`, 30000, 300);
    await place(0, 1.1);
    await sleep(1500);
    await recStart();
    await down('w');
    await sleep(4000);
    const tF = await ev('window.DevScene.simTime()');
    await tap('f');
    await sleep(1400);
    await shot('05-zryw-custos');
    await sleep(2400);
    await up('w');
    await sleep(3000);
    const smp = await recStop();
    const before = smp.filter((s) => s.t < tF);
    const act = smp.filter((s) => s.on);
    const after = smp.filter((s) => s.t > tF && !s.on && s.t > (act.length ? act[act.length - 1].t : tF));
    report.etapy.zryw = {
      system: await sysInfo(), limitBojowy: Math.round(await ev('window.shipDriveState.speedLimit')),
      vPrzed: Math.round(Math.max(0, ...before.map(speedOf))), vZryw: Math.round(Math.max(0, ...act.map(speedOf))),
      czasS: act.length ? r2(Math.max(...act.map((s) => s.sysT))) : 0, strugaJakDopalacz: act.some((s) => s.boost),
      vPo2s: after.length ? Math.round(speedOf(after.find((s) => s.t > after[0].t + 2) || after[after.length - 1])) : null
    };
    await syncSince('zryw', s0);
    console.log('zryw', JSON.stringify(report.etapy.zryw));
  }

  // ---------------------------------------------------------------- szybki ogień (Marauder)
  if (want('ogien')) {
    const s0 = await syncCount();
    await ev(`window.DevScene.setHull('pirate_frigate')`);
    await waitFor(cdp, `window.PLAYER?.activeHullId === 'pirate_frigate' && !!window.ship.beamHull`, 30000, 300);
    await place(0, 0.35);
    await sleep(1200);
    const fit = await ev(`(() => { const w = window.Game.player.weapons || {}; const ids = (g) => (w[g] || []).filter((l) => l?.weapon).map((l) => l.weapon.id); return { main: ids('main'), special: ids('special') }; })()`);
    // Cel ćwiczebny: piracka fregata bez mózgu 1,6 km przed dziobem (na ekranie przy zoomie 0,35), wytrzymała.
    await ev(`(() => {
      const r = window.spawnCallInShip('frigate_pd', { mode: 'pirate', spawnPos: { x: ${DEEP.x} + 1600, y: ${DEEP.y} }, spawnAngle: Math.PI });
      const e = Array.isArray(r) ? r[0] : r;
      if (!e) return false;
      e.__fTag = 'cel'; e.ai = () => {}; e.hp = e.maxHp = 1e8; if (e.shield) { e.shield.max = e.shield.val = 1e8; }
      window.__fTarget = e;
      return true;
    })()`);
    await waitFor(cdp, `!!window.__fTarget?.beamHull`, 30000, 300);
    await ev(`(() => {
      if (window.__fShots) return true;
      const list = window.__fShots = [];
      const orig = window.fireWeaponCore;
      window.fireWeaponCore = function (shooter, target, weaponId) {
        if (shooter === window.ship) list.push({ t: window.DevScene.simTime(), w: weaponId, rapid: window.ramBurn.active && window.ramBurn.def?.id === 'rapid_fire' });
        return orig.apply(this, arguments);
      };
      return true;
    })()`);
    // Kursor na celu (kamera rusza się za kursorem — punkt liczony drugi raz), spust trzymany: działa w ręku strzelają.
    let p = await pointer(DEEP.x + 1600, DEEP.y);
    await mouse('mouseMoved', p.x, p.y);
    await sleep(1500);
    p = await pointer(DEEP.x + 1600, DEEP.y);
    await mouse('mouseMoved', p.x, p.y);
    await sleep(600);
    await mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1 });
    await sleep(1200);   // wieże dochodzą na cel
    await ev('(() => { window.__fShots.length = 0; return true; })()');
    const tA = await ev('window.DevScene.simTime()');
    await sleep(5000);
    const tF = await ev('window.DevScene.simTime()');
    await tap('f');
    await sleep(1500);
    await shot('06-ogien-marauder');
    const hud = await hudSlotF();
    await sleep(3800);
    const tB = await ev('window.DevScene.simTime()');
    await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });
    const shots = await ev('window.__fShots.slice()');
    const def = await ev(`(() => { const d = window.playerShipSystem(); return d ? { mnoznik: d.fireRateMul, czas: d.duration } : null; })()`);
    const rapid = shots.filter((s) => s.rapid);
    const normal = shots.filter((s) => !s.rapid && s.t < tF);
    // Szybki ogień trwa `czas` s od F (spust trzymany dłużej) — okno = czas systemu.
    const rapidSpan = def?.czas || 4;
    report.etapy.ogien = {
      system: await sysInfo(), uzbrojenie: fit, def, hud,
      strzalyNaS: { zwykle: r2(normal.length / Math.max(0.1, tF - tA)), szybkiOgien: r2(rapid.length / Math.max(0.1, rapidSpan)) },
      strzaly: { zwykle: normal.length, szybkiOgien: rapid.length }, oknaS: { zwykle: r2(tF - tA), szybkiOgien: r2(rapidSpan), calosc: r2(tB - tA) }
    };
    const k = report.etapy.ogien.strzalyNaS;
    report.etapy.ogien.stosunek = k.zwykle > 0 ? r2(k.szybkiOgien / k.zwykle) : null;
    await ev(`(() => { const e = window.__fTarget; if (e) { e.hp = 0; e.dead = true; } return true; })()`);
    await syncSince('ogien', s0);
    console.log('ogień', JSON.stringify(report.etapy.ogien));
  }

  // ---------------------------------------------------------------- NPC: szybki ogień piratów, zryw Terra Nova
  if (want('npc')) {
    const s0 = await syncCount();
    await ev(`window.DevScene.setHull('atlas')`);
    await waitFor(cdp, `window.PLAYER?.activeHullId === 'atlas' && !!window.ship.beamHull`, 30000, 300);
    await place(0, 0.3);
    // Kursor na środku — kamera RTS (zrzuty NPC) nie przewija się od krawędzi ekranu.
    await mouse('mouseMoved', Math.round(W / 2), Math.round(H / 2));
    await sleep(800);
    const spawned = await ev(`(() => {
      const put = (k, mode, x, y, a, tag) => {
        const r = window.spawnCallInShip(k, { mode, spawnPos: { x: ${DEEP.x} + x, y: ${DEEP.y} + y }, spawnAngle: a });
        const e = Array.isArray(r) ? r[0] : r;
        if (e) {
          e.__fTag = tag;
          // Potyczka ma trwać cały pomiar: wytrzymałe kadłuby i tarcze.
          e.hp = e.maxHp = 1e6;
          if (e.shield) { e.shield.max = e.shield.val = 1e6; }
        }
        return !!e;
      };
      return {
        pirat: put('destroyer', 'pirate', 16000, -1500, Math.PI, 'pirat'),
        tnNiszczyciel: put('destroyer', 'friendly', 13000, 1500, 0, 'tn_niszczyciel'),
        tnPancernik: put('battleship', 'friendly', -26000, 9000, 0, 'tn_pancernik')
      };
    })()`);
    await ev(`(() => {
      const shots = window.__npcShots = [];
      const orig = window.spawnBulletAdapter;
      window.spawnBulletAdapter = function (owner, target, def, opts) {
        if (owner && owner.__fTag) shots.push({ t: window.DevScene.simTime(), tag: owner.__fTag, w: def?.id, rapid: (owner.__fSysRate || 1) > 1 });
        return orig.apply(this, arguments);
      };
      const rec = window.__npcRec = [];
      const before = { ...window.NpcShipSystemStats };
      window.__npcStatsBefore = before;
      const loop = () => {
        if (!window.__npcRecOn) return;
        for (const n of window.npcs || []) {
          if (!n || !n.__fTag) continue;
          const st = n.__fSys;
          rec.push({ t: window.DevScene.simTime(), tag: n.__fTag, x: n.x, y: n.y, v: Math.hypot(n.vx || 0, n.vy || 0), on: !!st?.active,
            boost: !!n.__fSysBoost, rate: n.__fSysRate || 1, dead: !!n.dead, sys: n.__fSysDef?.id || null });
        }
        setTimeout(loop, 100);
      };
      window.__npcRecOn = true;
      loop();
      return true;
    })()`);
    console.log('npc spawn', JSON.stringify(spawned));
    // Zrzut zrywu pancernika: kamera RTS na nim, gdy zryw trwa.
    let shotZryw = false;
    let shotOgien = false;
    const camAt = (tag, z) => ev(`(() => {
      const e = (window.npcs || []).find((n) => n && n.__fTag === '${tag}' && !n.dead);
      if (!e) return false;
      const c = window.camera;
      if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
      c.x = c.targetX = e.x; c.y = c.targetY = e.y;
      c.manualZoom = true; c.zoom = c.targetZoom = ${z};
      window.DevScene.syncCamera();
      return true;
    })()`);
    const t0 = Date.now();
    while (Date.now() - t0 < npcSeconds * 1000) {
      await sleep(400);
      const st = await ev(`(() => { const f = (tag) => (window.npcs || []).find((n) => n && n.__fTag === tag && !n.dead);
        const b = f('tn_pancernik'), p = f('pirat');
        return { zryw: !!b?.__fSysBoost, ogien: (p?.__fSysRate || 1) > 1 }; })()`);
      if (st.zryw && !shotZryw) {
        shotZryw = true;
        if (await camAt('tn_pancernik', 0.35)) { await sleep(400); await shot('07-npc-zryw-pancernik'); }
      }
      if (st.ogien && !shotOgien) {
        shotOgien = true;
        if (await camAt('pirat', 0.45)) { await sleep(500); await shot('08-npc-szybki-ogien'); }
      }
    }
    const rec = await ev('(() => { window.__npcRecOn = false; return window.__npcRec; })()');
    const shots = await ev('window.__npcShots.slice()');
    const statsNow = await ev('({ ...window.NpcShipSystemStats })');
    const statsBefore = await ev('window.__npcStatsBefore');
    const byTag = (tag) => rec.filter((r) => r.tag === tag);
    const spans = (rows) => {
      // Odcinki aktywności systemu (czas symulacji).
      const out = [];
      let s = null;
      for (const r of rows) {
        if (r.on && !s) s = r.t;
        if (!r.on && s !== null) { out.push([s, r.t]); s = null; }
      }
      if (s !== null && rows.length) out.push([s, rows[rows.length - 1].t]);
      return out;
    };
    const piratRows = byTag('pirat');
    const piratSpans = spans(piratRows);
    const tStart = piratRows.length ? piratRows[0].t : 0;
    // Tempo strzałów działa głównego pirata (railgun) z szybkim ogniem i bez — w oknie od pierwszego do ostatniego
    // strzału działa (pirat ma wtedy cel), czas szybkiego ognia z odcinków systemu przyciętych do tego okna.
    const gun = shots.filter((s) => s.tag === 'pirat' && s.w && !/ciws|flak|pd/i.test(s.w));
    const gunRapid = gun.filter((s) => s.rapid).length;
    const gunNormal = gun.length - gunRapid;
    const g0 = gun.length ? gun[0].t : tStart;
    const g1 = gun.length ? gun[gun.length - 1].t : tStart;
    const activeTime = piratSpans.reduce((a, [s, e]) => a + Math.max(0, Math.min(e, g1) - Math.max(s, g0)), 0);
    const normalTime = Math.max(0.1, (g1 - g0) - activeTime);
    // Zryw: odcinki z prędkością na początku, końcu i największą.
    const burstSpans = (rows) => spans(rows).map(([s, e]) => {
      const inSpan = rows.filter((r) => r.t >= s && r.t <= e);
      return { od: r1(s - tStart), do: r1(e - tStart), vStart: Math.round(inSpan[0]?.v || 0),
        vKoniec: Math.round(inSpan[inSpan.length - 1]?.v || 0), vMax: Math.round(Math.max(0, ...inSpan.map((r) => r.v))) };
    });
    const lastSys = (rows) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].sys) return rows[i].sys; return null; };
    // Największa prędkość bez zrywu — bez 4 s po każdym zrywie (prędkość dopiero wraca do limitu).
    const vMaxNoBurst = (rows) => {
      const sp = spans(rows);
      return Math.round(Math.max(0, ...rows.filter((r) => !sp.some(([s, e]) => r.t >= s && r.t <= e + 4)).map((r) => r.v)));
    };
    const pancernik = byTag('tn_pancernik');
    const niszczyciel = byTag('tn_niszczyciel');
    report.etapy.npc = {
      spawn: spawned,
      uzycia: { zryw: (statsNow.engine_burst || 0) - (statsBefore.engine_burst || 0), szybkiOgien: (statsNow.rapid_fire || 0) - (statsBefore.rapid_fire || 0) },
      pirat: {
        system: lastSys(piratRows), odcinkiSzybkiegoOgnia: piratSpans.map(([s, e]) => [r1(s - tStart), r1(e - tStart)]),
        dzialoNaS: { zwykle: r2(gunNormal / normalTime), szybkiOgien: activeTime > 0.5 ? r2(gunRapid / activeTime) : null },
        strzalyDziala: { zwykle: gunNormal, szybkiOgien: gunRapid }, oknaS: { zwykle: r2(normalTime), szybkiOgien: r2(activeTime) },
        bron: [...new Set(gun.map((s) => s.w))], zginal: piratRows.some((r) => r.dead)
      },
      tnPancernik: { system: lastSys(pancernik), zrywy: burstSpans(pancernik), vMaxBez: vMaxNoBurst(pancernik) },
      tnNiszczyciel: { system: lastSys(niszczyciel), zrywy: burstSpans(niszczyciel), vMaxBez: vMaxNoBurst(niszczyciel) }
    };
    const pr = report.etapy.npc.pirat.dzialoNaS;
    report.etapy.npc.pirat.stosunek = pr.zwykle > 0 && pr.szybkiOgien ? r2(pr.szybkiOgien / pr.zwykle) : null;
    if (!shotZryw && await camAt('tn_pancernik', 0.35)) await shot('07-npc-pancernik');
    if (!shotOgien && await camAt('pirat', 0.45)) await shot('08-npc-pirat');
    await syncSince('npc', s0);
    console.log('npc', JSON.stringify(report.etapy.npc));
  }

  report.pipelineSync.razem = await syncCount();
  report.pipelineSync.lista = await ev('(window.__fSysSync || []).slice(0, 40)');
  report.bledy = logs.errors().slice(0, 80);
  console.log('pipeline\'y synchroniczne (razem):', report.pipelineSync.razem);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
