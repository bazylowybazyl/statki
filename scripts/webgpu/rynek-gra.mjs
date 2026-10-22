// RYNEK w PRAWDZIWEJ grze (E2 / E7 — reguła `ruch-v2`): ruch v2 rusza bez flagi, terminal stacji pokazuje ofertę
// portu (ile ma, ile sprzeda, ile skupi i za ile) z mostu, kupno i sprzedaż przyciskami terminalu zmieniają zapas
// kopii od razu i zostają po kroku workera; stacja gracza jako rynek (hak konsoli `DevEconomy.foundStation`),
// komputer handlowy w CIC (warstwa „HANDEL”), zapis ekonomii → F5 → wczytanie (magazyny, wyrwy, stacja gracza).
// Zrzuty terminali i CIC, pipeline'y synchroniczne (strona i worker renderu — ma być 0) i błędy.
//
//   node scripts/webgpu/rynek-gra.mjs [--out .tmp/rynek] [--stacja earth] [--query renderWorker=1] [--bez-f5 1]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5356);
const out = resolve(repo, args.out || '.tmp/rynek');
const query = args.query ? `&${args.query}` : '';
const stationId = String(args.stacja || 'earth');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { stacja: stationId, query: args.query || null };
// Konsola workerów (render: „pipeline sync” w klatkach; ruch v2: błędy) — wzór mostki-gra.mjs.
const workerLogs = [];
let msgId = 900000;
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    for (const method of ['Runtime.enable', 'Runtime.runIfWaitingForDebugger']) cdp.ws.send(JSON.stringify({ id: ++msgId, method, sessionId: msg.params.sessionId }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 2000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
mkdirSync(out, { recursive: true });

const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'));
};

// Stan wiersza terminalu (DOM) i kopii rynku dla jednego surowca.
const rowState = (key, id = stationId) => `(() => {
  const row = document.querySelector('.trade-market-table tr[data-market-key="${key}"]');
  const econ = window.TrafficV2?.getEconomy?.(${JSON.stringify(id)});
  const f = (name) => row?.querySelector('[data-field="' + name + '"]')?.textContent || null;
  return {
    ladownia: f('held'), portMa: f('stock'), portSprzedaje: f('sell'), portSkupuje: f('buy'),
    zapasKopii: econ ? econ.resources['${key}'] : null,
    ofertaKopii: econ ? { sell: econ.sell?.['${key}'], buy: econ.buy?.['${key}'] } : null,
    kredyty: window.DevEconomy?.getCredits?.() ?? null,
    oczekujace: window.TrafficV2Stats?.()?.pendingStock ?? null
  };
})()`;

/** Start (i restart po F5): menu → gra swobodna → ruch v2 gotowy z rynkiem. Zwraca początek dziennika klatek. */
async function startGame() {
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) {
    throw new Error('gra nie ruszyła');
  }
  const begLog = await ev('window.__harness.frameLog.n');
  if (!await waitFor(cdp, `!!(window.TrafficV2Stats?.()?.ready)`, 120000, 300)) throw new Error('ruch v2 nie wstał');
  for (let i = 0; i < 40; i++) {
    const ok = await ev(`(() => { const e = window.TrafficV2?.getEconomy?.(${JSON.stringify(stationId)}); return !!e && Object.values(e.resources).some(v => v > 0); })()`);
    if (ok) break;
    await ev('window.__harness.step(30)');
  }
  return begLog;
}

async function waitWorldTick(maxRounds = 30) {
  const tickBefore = await ev('window.TrafficV2Stats().clock');
  for (let i = 0; i < maxRounds; i++) {
    await ev('window.__harness.step(30)');
    if (await ev(`window.TrafficV2Stats().clock !== ${tickBefore} && window.TrafficV2Stats().pendingStock === 0`)) return true;
  }
  return false;
}

try {
  await osobneLosowanieUuid(cdp);
  // Gra swobodna: kampania jest domyślna i jej intro w K-7 blokuje start (StoryOptions czyta to RAZ przy starcie).
  // Zapis ekonomii czyszczony tylko przy pierwszym wejściu (znacznik w sessionStorage) — F5 ma go wczytać.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sc_story_campaign', '0');
      if (!sessionStorage.getItem('rynek-gra')) { localStorage.removeItem('economy'); sessionStorage.setItem('rynek-gra', '1'); } } catch {}
window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}`
  });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  const begLog = await startGame();

  // 1. Ruch v2 żyje bez flagi.
  result.ruch = await ev(`(() => {
    const s = window.TrafficV2Stats();
    return { tryb: s.mode, ready: s.ready, failed: s.failed, ziarno: s.seed, budowaMs: Math.round(s.buildMs),
      rynki: window.TrafficV2.market.size, flaga: window.DevFlags?.trafficV2 };
  })()`);
  console.log('ruch v2', JSON.stringify(result.ruch));

  // 2. Terminal stacji: oferta portu z mostu, kupno i sprzedaż.
  result.terminal = await ev(`(() => {
    const st = (window.stations || []).find((s) => s.id === ${JSON.stringify(stationId)});
    if (!st) return { blad: 'brak stacji' };
    window.DevScene?.teleport?.(st.x + st.r * 4, st.y + st.r * 1.5, Math.PI);
    window.DevEconomy?.addCredits?.(2000000);
    window.openStationUI(st, 'trade');
    return { stacja: st.name, otwarty: !!window.stationUI?.open };
  })()`);
  await ev('window.__harness.step(20)');
  Object.assign(result.terminal, await ev(`(() => {
    const rows = [...document.querySelectorAll('.trade-market-table tr[data-market-key]')];
    const pick = rows.find((r) => {
      const buy = r.querySelector('button[data-trade-type="buy"]');
      const skup = r.querySelector('[data-field="buy"]')?.textContent || '';
      return buy && !buy.disabled && /×/.test(skup);
    });
    return {
      wiersze: rows.length,
      sprzedaje: rows.filter((r) => /×/.test(r.querySelector('[data-field="sell"]')?.textContent || '')).length,
      skupuje: rows.filter((r) => /×/.test(r.querySelector('[data-field="buy"]')?.textContent || '')).length,
      naglowek: [...document.querySelectorAll('.trade-market-table th')].map((th) => th.textContent),
      doHandlu: pick?.dataset.marketKey || null
    };
  })()`));
  console.log('terminal', JSON.stringify(result.terminal));
  const key = result.terminal.doHandlu;
  if (!key) throw new Error('żaden towar do kupna i sprzedaży w terminalu');
  const przed = await ev(rowState(key));
  await ev(`(() => { document.querySelector('.trade-market-table tr[data-market-key="${key}"] button[data-trade-type="buy"]').click(); return true; })()`);
  const poKupnie = await ev(rowState(key));
  await ev(`(() => { document.querySelector('.trade-market-table tr[data-market-key="${key}"] button[data-trade-type="sell"]').click(); return true; })()`);
  const poSprzedazy = await ev(rowState(key));
  await waitWorldTick();
  const poTicku = await ev(rowState(key));
  result.handel = { towar: key, przed, poKupnie, poSprzedazy, poTicku };
  console.log('handel', JSON.stringify(result.handel));
  await shot(`terminal-${stationId}`);

  // 3. Stacja gracza jako rynek (hak konsoli): encja w grze, rynek w świecie ruchu, budynek, terminal.
  const playerId = await ev(`(() => { window.closeStationUI?.(); return window.DevEconomy.foundStation({ name: 'Przyczółek E7', buildings: ['foundry'] }).id; })()`);
  for (let i = 0; i < 30 && !await ev(`window.TrafficV2.hasStation(${JSON.stringify(playerId)})`); i++) await ev('window.__harness.step(10)');
  await ev(`window.DevEconomy.addStationBuilding(${JSON.stringify(playerId)}, 'electronics')`);
  await waitWorldTick();
  result.stacjaGracza = await ev(`(() => {
    const st = (window.stations || []).find((s) => s.id === ${JSON.stringify(playerId)});
    const econ = window.TrafficV2.getEconomy(${JSON.stringify(playerId)});
    window.openStationUI(st, 'trade');
    return { id: ${JSON.stringify(playerId)}, encja: !!st, rynek: !!econ, rodzaj: window.TrafficV2.getStation(${JSON.stringify(playerId)})?.kind || null,
      towary: econ ? Object.values(econ.resources).filter((v) => v > 0).length : 0,
      skupuje: econ ? Object.values(econ.buy || {}).filter((v) => v > 0).length : 0,
      budynki: window.DevEconomy.playerStations()[0]?.buildings || null };
  })()`);
  await ev('window.__harness.step(10)');
  await shot('terminal-stacja-gracza');
  console.log('stacja gracza', JSON.stringify(result.stacjaGracza));

  // 4. Komputer handlowy w CIC: widok układu, warstwa „HANDEL”.
  await ev(`(() => { window.closeStationUI?.(); const C = window.CICDisplay; C.open(); const sun = window.SUN || { x: 0, y: 0 };
    C.setView({ zoom: 0.00009, panX: sun.x - window.ship.pos.x, panY: sun.y - window.ship.pos.y }); C.toggleTrade(); return true; })()`);
  for (let i = 0; i < 20 && !(await ev('window.CICDisplay.tradeStats().routes')); i++) await ev('window.__harness.step(30)');
  await ev('window.__harness.step(20)');
  result.cic = await ev('window.CICDisplay.tradeStats()');
  await shot('cic-handel');
  await ev(`(() => { const C = window.CICDisplay; C.setView({ zoom: 0.0006, panX: 0, panY: 0 }); return true; })()`);
  await ev('window.__harness.step(20)');
  await shot('cic-handel-blisko');
  await ev(`(() => { window.CICDisplay.close(); return true; })()`);
  console.log('cic', JSON.stringify(result.cic));

  result.pipelineCzesc1 = (await ev(`window.__harness.frameStats(${begLog})`)).pipeline;

  // 5. Zapis → F5 → wczytanie. Najpierw urobek gracza w pasie (ten sam rejestr co wyprawy NPC) — wyrwa ma przeżyć F5.
  if (!args['bez-f5']) {
    await ev(`(() => { const b = window.ASTEROID_BELT; const sun = window.SUN || { x: 0, y: 0 };
      for (const k of [0.25, 0.4, 0.55, 0.7]) {
        const r = b.inner + (b.outer - b.inner) * k;
        for (let i = 0; i < 4; i++) window.TrafficV2.reportMining(sun.x + r, sun.y + i * 4000, 3e6);
      }
      return true; })()`);
    await waitWorldTick();
    result.zapis = await ev(`(async () => {
      const ok = await window.DevEconomy.saveEconomy();
      const s = window.DevEconomy.economySave();
      return { ok, rynki: Object.keys(s?.world?.stations || {}).length, pas: s?.world?.mining?.length || 0,
        floty: Object.keys(s?.world?.fleets || {}).length, stacjeGracza: s?.playerStations?.length || 0,
        ziemia: s?.world?.stations?.earth?.stock?.[${JSON.stringify(key)}] ?? null,
        gracz: Object.keys(s?.world?.stations?.[${JSON.stringify(playerId)}]?.stock || {}).length,
        wyrwy: window.TrafficV2.beltHoles.size, rozmiarKB: Math.round(JSON.stringify(s).length / 1024) };
    })()`);
    console.log('zapis', JSON.stringify(result.zapis));
    await cdp.send('Page.reload', { ignoreCache: false });
    const begLog2 = await startGame();
    await waitWorldTick(10);
    result.wczytanie = await ev(`(() => {
      const econ = window.TrafficV2.getEconomy('earth');
      return { stacjeGracza: window.DevEconomy.playerStations().length,
        encja: !!(window.stations || []).find((s) => s.id === ${JSON.stringify(playerId)}),
        rynekGracza: window.TrafficV2.hasStation(${JSON.stringify(playerId)}),
        ziemia: econ ? econ.resources[${JSON.stringify(key)}] : null,
        wyrwy: window.TrafficV2.beltHoles.size,
        zapisPas: (() => { try { const z = JSON.parse(localStorage.getItem('economy')); return [z?.world?.mining?.length ?? null, z?.world?.miningCell ?? null]; } catch { return null; } })() };
    })()`);
    result.dziennikRuchu = logs.all().filter((l) => l.includes('[ruch v2]')).slice(-6);
    console.log('dziennik ruchu', JSON.stringify(result.dziennikRuchu));
    console.log('wczytanie', JSON.stringify(result.wczytanie));
    result.pipelineCzesc2 = (await ev(`window.__harness.frameStats(${begLog2})`)).pipeline;
  }

  result.syncWorker = workerLogs.filter((l) => l.includes('pipeline sync')).map((l) => l.replace(/^.*pipeline sync #\d+ k=\d+: /, ''));
  result.bledyWorkerow = workerLogs.filter((l) => /^\[(error|exception)\]/.test(l)).slice(0, 20);
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
console.log('wynik →', out);
console.log('pipeline:', JSON.stringify(result.pipelineCzesc1?.sync ?? null), '/', JSON.stringify(result.pipelineCzesc2?.sync ?? null),
  '| sync w workerze:', (result.syncWorker || []).length, (result.syncWorker || []).slice(0, 5).join(' | '));
console.log('błędy workerów:', (result.bledyWorkerow || []).length, (result.bledyWorkerow || []).slice(0, 5).join(' | '));
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
