// RYNEK w PRAWDZIWEJ grze (E2 — jedna ekonomia, reguła `ruch-v2`): ruch v2 rusza bez flagi, terminal stacji czyta
// magazyn i ceny z mostu (`TrafficV2.getEconomy`), kupno i sprzedaż przyciskami terminalu zmieniają zapas kopii od
// razu i zostają po następnym kroku workera (`stockSeq`). Na końcu zrzut terminalu, pipeline'y synchroniczne
// (ma być 0) i błędy strony.
//
//   node scripts/webgpu/rynek-gra.mjs [--out .tmp/rynek] [--stacja earth] [--query renderWorker=1]
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
mkdirSync(out, { recursive: true });

// Stan wiersza terminalu (DOM) i kopii rynku dla jednego surowca.
const rowState = (key) => `(() => {
  const pane = document.querySelector('.trade-market-table');
  const row = pane?.querySelector('tr[data-market-key="${key}"]');
  const econ = window.TrafficV2?.getEconomy?.(${JSON.stringify(stationId)});
  return {
    komorka: row?.querySelector('[data-field="stock"]')?.textContent || null,
    cena: row?.querySelector('[data-field="price"]')?.textContent || null,
    zapasKopii: econ ? econ.resources['${key}'] : null,
    kredyty: window.DevEconomy?.getCredits?.() ?? null,
    oczekujace: window.TrafficV2Stats?.()?.pendingStock ?? null
  };
})()`;

try {
  await osobneLosowanieUuid(cdp);
  // Gra swobodna: kampania jest domyślna i jej intro w K-7 blokuje start (StoryOptions czyta to RAZ przy starcie).
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sc_story_campaign', '0'); } catch {}\nwindow.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}`
  });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) {
    throw new Error('gra nie ruszyła');
  }
  const begLog = await ev('window.__harness.frameLog.n');

  // 1. Ruch v2 żyje bez flagi: most, tryb, rynki, pierwszy krok świata z rynkiem.
  if (!await waitFor(cdp, `!!(window.TrafficV2Stats?.()?.ready)`, 120000, 300)) throw new Error('ruch v2 nie wstał');
  for (let i = 0; i < 40; i++) {
    const ok = await ev(`(() => { const e = window.TrafficV2?.getEconomy?.(${JSON.stringify(stationId)}); return !!e && Object.values(e.resources).some(v => v > 0); })()`);
    if (ok) break;
    await ev('window.__harness.frames(30)');
  }
  result.ruch = await ev(`(() => {
    const s = window.TrafficV2Stats();
    return { tryb: s.mode, ready: s.ready, failed: s.failed, ziarno: s.seed, budowaMs: Math.round(s.buildMs),
      rynki: window.TrafficV2.market.size, czasMostu: +s.time.toFixed(2), kroki: s.stats?.steps ?? null,
      kursyWBance: s.courses, flaga: window.DevFlags?.trafficV2 };
  })()`);
  console.log('ruch v2', JSON.stringify(result.ruch));

  // 2. Terminal stacji: magazyn i ceny z kopii rynku.
  result.terminal = await ev(`(() => {
    const st = (window.stations || []).find((s) => s.id === ${JSON.stringify(stationId)});
    if (!st) return { blad: 'brak stacji' };
    window.DevScene?.teleport?.(st.x + st.r * 4, st.y + st.r * 1.5, Math.PI);
    window.DevEconomy?.addCredits?.(2000000);
    window.openStationUI(st, 'trade');
    return { stacja: st.name, otwarty: !!window.stationUI?.open };
  })()`);
  await ev('window.__harness.frames(20)');
  Object.assign(result.terminal, await ev(`(() => {
    const rows = [...document.querySelectorAll('.trade-market-table tr[data-market-key]')];
    const stock = [...document.querySelectorAll('.trade-resource-table tr[data-resource-key]')];
    const econ = window.TrafficV2.getEconomy(${JSON.stringify(stationId)});
    const pick = rows.find((r) => {
      const btn = r.querySelector('button[data-trade-type="buy"]');
      return btn && !btn.disabled;
    });
    return {
      wiersze: rows.length,
      zCenami: rows.filter((r) => /\\d+ \\/ \\d+ CR/.test(r.querySelector('[data-field="price"]')?.textContent || '')).length,
      magazyn: stock.slice(0, 4).map((r) => r.dataset.resourceKey + ' ' + r.querySelector('[data-field="amount"]')?.textContent + '/' + r.querySelector('[data-field="capacity"]')?.textContent),
      notka: document.querySelector('.trade-hold-note')?.textContent || null,
      towarowKopii: Object.values(econ.resources).filter((v) => v > 0).length,
      doKupna: pick?.dataset.marketKey || null
    };
  })()`));
  console.log('terminal', JSON.stringify(result.terminal));
  const key = result.terminal.doKupna;
  if (!key) throw new Error('żaden towar nie do kupienia w terminalu');

  // 3. Kupno i sprzedaż przyciskami terminalu: kopia zmienia się od razu, po kroku workera zostaje.
  const przed = await ev(rowState(key));
  await ev(`(() => { document.querySelector('.trade-market-table tr[data-market-key="${key}"] button[data-trade-type="buy"]').click(); return true; })()`);
  const poKupnie = await ev(rowState(key));
  await ev(`(() => { document.querySelector('.trade-market-table tr[data-market-key="${key}"] button[data-trade-type="buy"]').click(); return true; })()`);
  await ev(`(() => { document.querySelector('.trade-market-table tr[data-market-key="${key}"] button[data-trade-type="sell"]').click(); return true; })()`);
  const poSprzedazy = await ev(rowState(key));
  // Krok świata ruchu = 5 s czasu gry świata; ~6 s gry wystarczy na kolejny `tick` z rynkiem.
  const tickBefore = await ev('window.TrafficV2Stats().clock');
  for (let i = 0; i < 30; i++) {
    await ev('window.__harness.frames(30)');
    if (await ev(`window.TrafficV2Stats().clock !== ${tickBefore} && window.TrafficV2Stats().pendingStock === 0`)) break;
  }
  const poTicku = await ev(rowState(key));
  result.handel = { towar: key, przed, poKupnie, poSprzedazy, poTicku };
  console.log('handel', JSON.stringify(result.handel));
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, `terminal-${stationId}.png`), Buffer.from(data, 'base64'));

  result.pipeline = (await ev(`window.__harness.frameStats(${begLog})`)).pipeline;
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
console.log('pipeline:', JSON.stringify(result.pipeline));
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
