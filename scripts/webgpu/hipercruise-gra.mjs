// Hipercruise (E5, 20–40 tys. j/s) w PRAWDZIWEJ grze — kolizje, duch kadłubów, koszt kroku (E9, 2026-10-22).
// Vite + headless Chrome z WebGPU (CDP), gra swobodna bez kampanii i mgły wojny, Atlas z silnikiem Mk III (konsola:
// ship.hypercruiseEngine). Hipercruise wymuszony od razu w stanie 'active' z prędkością vmax (narzędzie, nie rozgrywka).
//
//   node scripts/webgpu/hipercruise-gra.mjs [--etapy ring,duch,koszt] [--query renderWorker=1] [--port 5381]
//
// Etapy:
//   ring  — Atlas z daleka (poza studnią Ziemi, strefa 1) kursem na płytę ringu pod kątem 90° i 30°: prędkość przy
//           uderzeniu (strefa planety × 0,3 hamuje automat), przebicie płyty, prędkość i droga po zerwaniu hipercruise'u;
//   duch  — przelot przez szereg 12 okrętów (sojusznicy — bez blokady masy): styki pary w silniku belek, straty węzłów,
//           ship.noHullCollisions w locie i po wyjściu;
//   koszt — bitwa ~60 okrętów 30 km od gracza; okna po 4 s na zmianę: A — lot bojowy (stoi), B — hipercruise 40 tys.
//           j/s (powrót na start co 1 s): czasy funkcji kroku fizyki z PerfHUD na krok (ms).
// Na końcu pipeline'y utworzone synchronicznie po starcie (ma być 0). Wynik: <out>/raport.json.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/hipercruise');
mkdirSync(out, { recursive: true });
const etapy = new Set(String(args.etapy || 'ring,duch,koszt').split(','));
const query = args.query ? `&${args.query}` : '';

const { server, base } = await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: 1280, height: 720 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { query, etapy: {} };

await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); localStorage.setItem('sc_fog_of_war', '0'); } catch {}
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

const czekaj = async (expr, ms = 60000) => { for (let t0 = Date.now(); Date.now() - t0 < ms;) { if (await ev(expr)) return true; await sleep(40); } return false; };
const pauza = (on) => ev(`window.__setGamePaused(${on}); true`);
const simT = () => ev('(window.WarpTraffic && window.WarpTraffic.time) || 0');
async function czekajGra(s) { const t0 = await simT(); for (let i = 0; i < 6000; i++) { if ((await simT()) - t0 >= s) return; await sleep(40); } }

// Hipercruise od razu w locie (Mk III, vmax, kurs z dziobu). Blokada masy i trafienie dalej przerywają.
const HIPER = `(() => {
  const s = window.ship, hc = window.hypercruise;
  s.hypercruiseEngine = 'hypercruise_mk3';
  window.__hypercruiseReset();
  if (!window.PlayerHypercruise.start({ quiet: true })) return { ok: false };
  hc.state = 'active'; hc.t = 0; hc.speed = hc.vmax;
  return { ok: true, vmax: hc.vmax, decel: hc.decel };
})()`;

try {
  await (await import('../../dema/rdzen-cdp.js')).navigateAndWait(cdp, `${base}/index.html?dev=1${query}`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  await waitFor(cdp, '(window.__frameId || 0) > 30 && !!window.camera && !!window.ship?.beamHull && !!window.PlayerHypercruise', 240000);
  await ev(`(() => { window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
    if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = 0.05; return true; })()`);
  await ev(`(async () => { window.__GS = (await import('/src/game/gameState.js')).GameState; return !!window.__GS.zoneState; })()`);
  const pipes0 = await ev('window.__pipeRec.pipes.length');

  // ------------------------------------------------------------------ RING
  if (etapy.has('ring')) {
    const wyn = [];
    for (const kat of [90, 30]) {
      await pauza(true);
      const plan = await ev(`(() => {
        const W = window.__haloWorld, e = W && W.entry('earth');
        if (!e) return null;
        const c = e.collider; c.setPlanet(e.planet);
        const P = { x: e.planet.x, y: e.planet.y };
        const fm = c.floorMid, mid = (c.back + c.floorMid) / 2;
        let ang = NaN;
        for (let s = 0; s < 128; s++) {
          const a = s * Math.PI * 2 / 128 + 0.07;
          const x = P.x + Math.cos(a) * (fm - 5), y = P.y + Math.sin(a) * (fm - 5);
          const p = c._local[0]; window.__hrl = window.__hrl || { x: 0, y: 0 };
          if (c.pointInSlab(x, y) && Math.abs(a % (Math.PI / 2)) > 0.3) { ang = a; break; }
        }
        const gw = window.planetOrbitRadii(e.planet).gravityWell;
        const n = { x: Math.cos(ang), y: Math.sin(ang) }, t = { x: -n.y, y: n.x };
        const k = ${kat} * Math.PI / 180;
        const dir = { x: -n.x * Math.sin(k) + t.x * Math.cos(k), y: -n.y * Math.sin(k) + t.y * Math.cos(k) };
        const A = { x: P.x + n.x * (fm + 60), y: P.y + n.y * (fm + 60) };
        const L = (gw + 25000 - fm) / Math.sin(k);
        const S = { x: A.x - dir.x * L, y: A.y - dir.y * L };
        window.cancelTravel && window.cancelTravel(null);
        window.setShipMode('combat', true);
        window.DevScene.teleport(S.x, S.y, Math.atan2(dir.y, dir.x)); window.DevScene.syncCamera();
        // Dziennik kolidera ringu: każdy krok fizyki gracza (stepShipRingCollisions).
        const log = window.__ringLog = [];
        if (!W.__e9wrap) {
          W.__e9wrap = true;
          const orig = W.constrainShip.bind(W);
          W.constrainShip = function (ship, walls) {
            const r0 = Math.hypot(ship.pos.x - P.x, ship.pos.y - P.y), v0 = Math.hypot(ship.vel.x, ship.vel.y);
            const hc = window.hypercruise.state;
            const res = orig(ship, walls);
            if (ship === window.ship && window.__ringLog) window.__ringLog.push({ r0, r1: Math.hypot(ship.pos.x - P.x, ship.pos.y - P.y),
              v0, v1: Math.hypot(ship.vel.x, ship.vel.y), hit: !!(res && res.hit), hc, duch: !!ship.noHullCollisions,
              strefa: window.__GS?.zoneState?.current?.warpMultiplier ?? null, x: ship.pos.x, y: ship.pos.y });
            return res;
          };
        }
        window.__ringP = { P, fm, mid, back: c.back, gw };
        return { ang, gw: Math.round(gw), fm: Math.round(fm), back: Math.round(c.back), L: Math.round(L) };
      })()`);
      if (!plan) { console.log('ring: brak ringu Ziemi'); break; }
      const h = await ev(HIPER);
      await pauza(false);
      await czekaj('(window.__ringLog || []).some((r) => r.hit) || (window.__ringLog || []).length > 60 * 40', 240000);
      await czekajGra(10);
      await pauza(true);
      const r = await ev(`(() => {
        const L = window.__ringLog, R = window.__ringP; window.__ringLog = null;
        const i = L.findIndex((q) => q.hit);
        const minR = Math.min(...L.map((q) => q.r1));
        const at = (s) => L[Math.min(L.length - 1, i + Math.round(s * 60))];
        const drog = (s) => { let d = 0; for (let j = i + 1; j <= Math.min(L.length - 1, i + s * 60); j++) d += Math.hypot(L[j].x - L[j - 1].x, L[j].y - L[j - 1].y); return Math.round(d); };
        const wejscieStrefy = L.findIndex((q) => q.strefa !== null && q.strefa < 1);
        return { krokow: L.length, uderzenie: i, vPrzyUderzeniu: i >= 0 ? Math.round(L[i].v0) : null, vPo: i >= 0 ? Math.round(L[i].v1) : null,
          wbicie: i >= 0 ? Math.round(R.fm + 14 - (L[i].r0 - 0)) : null,
          przebicie: minR < R.mid, minPromien: Math.round(minR), polowaPlyty: Math.round(R.mid),
          vStrefa: wejscieStrefy >= 0 ? Math.round(L[wejscieStrefy].v0) : null,
          v1s: i >= 0 ? Math.round(at(1).v1) : null, v5s: i >= 0 ? Math.round(at(5).v1) : null, v10s: i >= 0 ? Math.round(at(10).v1) : null,
          droga10s: i >= 0 ? drog(10) : null, hcPo: window.hypercruise.state, duchPo: !!window.ship.noHullCollisions,
          kolejneUderzenia: L.filter((q, j) => j > i && q.hit).length };
      })()`);
      const row = { kat, plan, hiper: h, ...r };
      console.log('RING', JSON.stringify(row));
      wyn.push(row);
    }
    report.etapy.ring = wyn;
  }

  // ------------------------------------------------------------------ DUCH
  if (etapy.has('duch')) {
    await pauza(true);
    const start = await ev(`(() => {
      const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
      const sun = window.SUN || { x: 0, y: 0 };
      const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
      const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
      let best = null;
      for (let k = 0; k < 96; k++) {
        const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
        let dmin = Infinity; for (const p of pl) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
        if (!best || dmin > best.dmin) best = { x, y, dmin };
      }
      window.cancelTravel && window.cancelTravel(null);
      window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
      window.__startPose = { x: best.x, y: best.y };
      return { x: Math.round(best.x), y: Math.round(best.y) };
    })()`);
    const spawn = await ev(`(async () => {
      const s = window.ship, list = [];
      const keys = ['battleship', 'destroyer', 'frigate_pd', 'supercapital', 'carrier'];
      for (let i = 0; i < 12; i++) {
        const along = 60000 + i * 2500, side = [0, 150, -150][i % 3];
        const pos = { x: s.pos.x + along, y: s.pos.y + side };
        for (const e of [].concat(window.spawnCallInShip(keys[i % keys.length], { mode: 'friendly', spawnPos: pos, pos, spawnAngle: Math.PI / 2 }) || [])) {
          e.__e9 = list.length; e.combatDisabled = true; e.ai = null; list.push(e);
        }
      }
      for (let t = 0; t < 600 && list.some((e) => !e.beamHull && !e.dead); t++) await new Promise((r) => setTimeout(r, 50));
      for (const e of list) { e.vx = 0; e.vy = 0; if (e.vel) { e.vel.x = 0; e.vel.y = 0; } e.__n0 = e.beamHull?.body.activeNodes || 0; }
      window.__e9cele = list;
      const D = window.HullBodies.engine, T = window.__e9t = { styki: 0, v: [], duch: [] };
      if (!D.__e9wrap) {
        D.__e9wrap = true;
        const orig = D.collideBodies;
        D.collideBodies = function (A, B, dt, dmg) {
          const c = orig.call(this, A, B, dt, dmg);
          if (c > 0 && (A.entity === window.ship || B.entity === window.ship) && window.__e9t) { window.__e9t.styki += c; window.__e9t.v.push(Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y))); }
          return c;
        };
      }
      window.__atlasN0 = s.beamHull?.body.activeNodes || 0;
      return { n: list.length, kadluby: list.filter((e) => e.beamHull).length };
    })()`);
    const h = await ev(HIPER);
    await pauza(false);
    const duchW = [];
    for (let k = 0; k < 40; k++) {
      await sleep(100);
      duchW.push(await ev(`[window.ship.noHullCollisions === true, Math.round(window.ship.pos.x - window.__startPose.x)]`));
      if (duchW.at(-1)[1] > 120000) break;
    }
    await ev(`window.PlayerHypercruise.stop('manual'); true`);
    await czekaj(`window.hypercruise.state === 'idle'`, 60000);
    await czekajGra(1);
    await pauza(true);
    const r = await ev(`(() => {
      const L = window.__e9cele, T = window.__e9t;
      return { styki: T.styki, vStykow: [...new Set(T.v)].slice(0, 8),
        utrataWezlowCelow: L.reduce((a, e) => a + (e.beamHull ? e.__n0 - e.beamHull.body.activeNodes : 0), 0),
        utrataWezlowAtlasa: window.__atlasN0 - (window.ship.beamHull?.body.activeNodes || 0),
        duchPoWyjsciu: window.ship.noHullCollisions === true, hc: window.hypercruise.state };
    })()`);
    const row = { start, spawn, hiper: h, duchWLocie: duchW.every((q) => q[0] || q[1] < 0), probki: duchW.length, ...r };
    console.log('DUCH', JSON.stringify(row));
    report.etapy.duch = row;
    await ev(`for (const e of window.__e9cele) e.dead = true; true`);
  }

  // ------------------------------------------------------------------ KOSZT
  if (etapy.has('koszt')) {
    await pauza(true);
    await ev(`(async () => {
      window.__hypercruiseReset(); window.setShipMode('combat', true);
      const p = window.__startPose || { x: window.ship.pos.x, y: window.ship.pos.y };
      window.DevScene.teleport(p.x, p.y, 0); window.DevScene.syncCamera();
      const s = window.ship;
      const keysA = ['battleship', 'destroyer', 'frigate_pd', 'destroyer', 'frigate_pd', 'carrier'];
      const keysB = ['pirate_battleship', 'destroyer', 'frigate_pd', 'destroyer', 'frigate_pd', 'pirate_supercapital'];
      const list = [];
      for (let i = 0; i < 30; i++) {
        const posA = { x: s.pos.x - 6000 + (i % 6) * 900, y: s.pos.y - 30000 - Math.floor(i / 6) * 900 };
        const posB = { x: s.pos.x + 6000 - (i % 6) * 900, y: s.pos.y - 30000 - Math.floor(i / 6) * 900 };
        for (const e of [].concat(window.spawnCallInShip(keysA[i % 6], { mode: 'friendly', spawnPos: posA, pos: posA, spawnAngle: 0 }) || [])) list.push(e);
        for (const e of [].concat(window.spawnCallInShip(keysB[i % 6], { mode: 'pirate', spawnPos: posB, pos: posB, spawnAngle: Math.PI }) || [])) list.push(e);
      }
      for (let t = 0; t < 600 && list.some((e) => !e.beamHull && !e.dead); t++) await new Promise((r) => setTimeout(r, 50));
      window.__e9bitwa = list;
      const { PerfHUD } = await import('/src/ui/perfHud.js');
      window.__e9perf = PerfHUD;
      if (!PerfHUD.__e9wrap) {
        PerfHUD.__e9wrap = true;
        const add = PerfHUD.addTiming.bind(PerfHUD), mark = PerfHUD.markPhysicsStep.bind(PerfHUD);
        PerfHUD.addTiming = (k, ms) => { const S = window.__e9sum; if (S && Number.isFinite(ms)) S[k] = (S[k] || 0) + ms; return add(k, ms); };
        PerfHUD.markPhysicsStep = () => { const S = window.__e9sum; if (S) S.__kroki = (S.__kroki || 0) + 1; return mark(); };
      }
      return list.length;
    })()`);
    await pauza(false);
    await czekajGra(6);                    // bitwa się zawiązuje
    const okna = { A: [], B: [] };
    const KLUCZE = ['physicsTime', 'playerFlightTime', 'collisionTime', 'destructorTime', 'projectileTime', 'bulletGridTime', 'bulletNpcHitTime', 'aiTime', 'worldZoneTime'];
    for (let rep = 0; rep < 3; rep++) {
      for (const tryb of ['A', 'B']) {
        await ev(`(() => { const p = window.__startPose; window.__hypercruiseReset(); window.setShipMode('combat', true);
          window.DevScene.teleport(p.x, p.y, Math.PI); window.DevScene.syncCamera(); return true; })()`);
        if (tryb === 'B') await ev(HIPER);
        await ev('window.__e9sum = {}; true');
        const t0 = await simT();
        for (let k = 0; k < 400; k++) {
          await sleep(250);
          if (tryb === 'B') await ev(`(() => { const p = window.__startPose, s = window.ship; s.pos.x = p.x; s.pos.y = p.y; return true; })()`);
          if ((await simT()) - t0 >= 4) break;
        }
        const S = await ev(`(() => { const S = window.__e9sum; window.__e9sum = null; return S; })()`);
        const n = Math.max(1, S.__kroki || 0);
        const row = { kroki: n, zywe: await ev('window.__e9bitwa.filter((e) => !e.dead && !e.destroyed).length'), hc: await ev('window.hypercruise.state') };
        for (const k of KLUCZE) row[k] = +((S[k] || 0) / n).toFixed(3);
        okna[tryb].push(row);
        console.log('KOSZT', tryb, JSON.stringify(row));
      }
    }
    const sr = (rows) => Object.fromEntries(KLUCZE.map((k) => [k, +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(3)]));
    report.etapy.koszt = { okna, srednieA: sr(okna.A), srednieB: sr(okna.B) };
    console.log('KOSZT śr. A (bojowy)', JSON.stringify(report.etapy.koszt.srednieA));
    console.log('KOSZT śr. B (hipercruise)', JSON.stringify(report.etapy.koszt.srednieB));
  }

  const pipes = await ev(`window.__pipeRec.pipes.slice(${pipes0})`);
  report.pipelineSync = pipes.filter((p) => p.sync).length;
  report.pipelineSyncNazwy = [...new Set(pipes.filter((p) => p.sync).map((p) => p.nazwa))].slice(0, 12);
  console.log('pipeline\'y synchroniczne po starcie:', report.pipelineSync, report.pipelineSyncNazwy);
} finally {
  report.bledy = logs.errors().filter((l) => !/AudioSys/.test(l)).slice(0, 12);
  if (report.bledy.length) console.log('błędy:', report.bledy);
  writeJson(resolve(out, 'raport.json'), report);
  console.log('zapis:', resolve(out, 'raport.json'));
  await chrome.close();
  await server.close();
}
