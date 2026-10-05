// Mostki w PRAWDZIWEJ grze (kadłuby belkowe — src/game/shipBridgeBeams.js, docs/PORT-mostki.md § 9):
// nowa gra (tryb swobodny), pirat-pancernik obok Atlasa, stan mostków na belkach, model 3D (Bridge3D),
// zniszczenie mostka kraterami w komórkach strefy (jak ciężka broń) → utrata dowodzenia → agonia hulka
// (wyrzut atmosfery, przepięcia, okna i dysze gasną) → wrak bez wybuchu z modelem mostka; mostki
// Atlasa gracza (rufowy pada — dowodzi zapasowy). Zrzuty, statystyki, pipeline'y tworzone w klatkach
// (rozgrzewka ma je wykluczyć — oczekiwane 0) i błędy konsoli / WebGPU.
//
//   node scripts/webgpu/mostki-gra.mjs [--out .tmp/webgpu/mostki-gra] [--port 5351] [--zoom 0.9]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5351);
const zoom = Number(args.zoom || 0.9);
const out = resolve(repo, args.out || '.tmp/webgpu/mostki-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { zrzuty: [], etapy: {} };
const shot = async (name) => {
  await ev('window.__harness.frames(2)');
  await screenshotPng(cdp, join(out, `${name}.png`));
  const st = await ev('JSON.stringify({ b3: { ...window.Bridge3D.stats, instances: undefined }, fx: { ...window.__bridgeFxStats() } })');
  result.zrzuty.push({ name, ...JSON.parse(st) });
  console.log(name, st);
};
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');
  // Moduły gry (ten sam egzemplarz co w index.html — Vite podaje ten sam URL).
  await ev(`(async () => {
    window.__SB = await import('/src/game/shipBridge.js');
    window.__RT = await import('/src/game/shipBridgeRuntime.js');
    window.__BB = await import('/src/game/shipBridgeBeams.js');
    const { BridgeFx3D } = await import('/src/3d/bridgeFx3D.js');
    window.__bridgeFxStats = () => BridgeFx3D.stats;
    // Mostek pada jak pod ciężką bronią: krater w każdej (frac) komórce strefy, trafienie z burty.
    window.__killCells = (e, b, frac = 1) => {
      const st = e.bridgeState, br = st.bridges[b], hull = e.beamHull, cs = hull.body.cellSize, p = {};
      const n = Math.ceil(br.total * frac);
      const c = __SB.bridgePngToWorld(e, br.def.x, br.def.y, {});
      __RT.noteBridgeHit(e, c.x, c.y, 0, 1800, 0);
      for (let k = 0; k < n; k++) {
        if (__BB.bridgeCellNode(hull, br.cellX[k], br.cellY[k]) < 0) continue;
        __BB.beamLatticeToWorld(hull, (br.cellX[k] + 0.5) * cs, (br.cellY[k] + 0.5) * cs, p);
        HullBodies.impact(e, p.x, p.y, 1, { x: 0, y: 1800 }, { craterRadius: cs * 0.45 });
      }
      return n;
    };
    return true;
  })()`);

  // Atlas gracza: dwa mostki na belkach (rufowy + zapasowy), model 3D.
  result.etapy.gracz = await ev(`(() => { const st = ship.bridgeState; return st ? { backend: st.backend?.kind || 'heks', mostki: st.bridges.map((b) => b.id + ':' + b.total), model3D: st.model3D === true } : null; })()`);
  console.log('gracz', JSON.stringify(result.etapy.gracz));

  result.etapy.scena = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0xb21d); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    if (window.fireControl) window.fireControl.posture = 'hold';
    const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
    spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(3600, 600), spawnAngle: Math.PI * 0.9 });
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    H.reseed(0xb21e);
    await H.step(40);
    const e = npcs.filter((n) => !n.dead && !n.friendly && n.beamHull).sort((a, b) => (b.radius || 0) - (a.radius || 0))[0];
    if (!e) return { blad: 'brak pirata' };
    window.__cel = e;
    const st = e.bridgeState;
    const c = __SB.bridgePngToWorld(e, st.bridges[0].def.x, st.bridges[0].def.y, {});
    S.cam(c.x, c.y, ${zoom});
    await H.frames(4);
    return { typ: e.type, ramka: e.shipFrame, backend: st?.backend?.kind || null, mostki: st?.bridges.map((b) => b.id + ':' + b.total), model3D: st?.model3D === true, rekordy: window.Bridge3D.recordsOf(e).length };
  })()`, 300000);
  console.log('scena', JSON.stringify(result.etapy.scena));
  await shot('a-mostek-pirata');
  const kStart = await ev('window.__harness.frameLog.n');

  // Zniszczenie mostka → utrata dowodzenia (kadencja co 3. podkrok — kilka klatek).
  result.etapy.utrata = await ev(`(async () => { const e = window.__cel, H = window.__harness;
    __killCells(e, 0, 0.5);
    let f = 0;
    for (; f < 60 && !__RT.isBridgeHulk(e); f++) await H.step(1);
    return { klatek: f, hulk: __RT.isBridgeHulk(e), flaga: e.isBridgeHulk === true, wyrwa: e.bridgeState?.vent ? { exit: Math.round(e.bridgeState.vent.exitDist) } : null };
  })()`);
  console.log('utrata', JSON.stringify(result.etapy.utrata));
  await ev('window.__harness.step(18)');
  await shot('b-agonia-0.3s');
  await ev('window.__harness.step(72)');
  await shot('b-agonia-1.5s');
  // Koniec agonii → wrak (finishBridgeKill) z modelem mostka.
  result.etapy.wrak = await ev(`(async () => { const e = window.__cel, H = window.__harness, key = e.beamHull?.dmgKey;
    let f = 0;
    for (; f < 360 && !e.dead; f++) await H.step(1);
    await H.step(6);
    const w = (window.wrecks || []).find((x) => x && !x.dead && x.beamHull && x.beamHull.dmgKey === key);
    return { klatek: f, martwy: !!e.dead, wrak: !!w, wezly: w?.beamHull?.body.activeNodes || 0, rekordyWraku: w ? window.Bridge3D.recordsOf(w).length : 0 };
  })()`);
  console.log('wrak', JSON.stringify(result.etapy.wrak));
  await shot('c-wrak');

  // Atlas gracza: pada rufowy — dowodzi zapasowy, gracz żyje.
  result.etapy.atlas = await ev(`(async () => { const H = window.__harness, S = H.scene;
    const st = ship.bridgeState; if (!st) return { blad: 'brak mostków gracza' };
    const c = __SB.bridgePngToWorld(ship, st.bridges[0].def.x, st.bridges[0].def.y, {});
    S.cam(c.x, c.y, ${zoom * 0.7});
    __killCells(ship, 0, 1);
    await H.step(30);
    return { rufowy: st.bridges[0].dead, zapasowy: !st.bridges[1]?.dead, utrata: st.commandLost, zyje: !ship.destroyed };
  })()`);
  console.log('atlas', JSON.stringify(result.etapy.atlas));
  await shot('d-atlas-rufowy');

  result.etapy.kompilacjeWKlatce = JSON.parse(await ev(`JSON.stringify(window.__harness.pipes.list.filter((p) => p.k >= ${kStart} && (p.budowa ? !p.poza : (p.sync || p.compute))).map((p) => (p.budowa ? 'budowa ' : p.compute ? '' : 'sync ') + p.nazwa + (p.ms ? ' ' + p.ms + ' ms' : '')))`));
  console.log('kompilacje w klatkach:', result.etapy.kompilacjeWKlatce.length, result.etapy.kompilacjeWKlatce.slice(0, 12));
} finally {
  result.bledy = logs.errors().slice(0, 40);
  console.log('błędy konsoli:', result.bledy.length);
  for (const e of result.bledy.slice(0, 8)) console.log('  ', e.slice(0, 300));
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(result, null, 2));
  await chrome.close();
  await server.close();
}
