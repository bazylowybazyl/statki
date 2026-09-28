// Mapa ran (zadanie 18-C) pod obciążeniem: bitwa jak w `zrzuty.mjs --wydajnosc` (24 na stronę, 17% pancerników),
// w czasie rzeczywistym. Tryb `--bez-tarcz` zdejmuje tarcze wszystkim okrętom (najgorszy przypadek: każde
// trafienie to krater i stempel). Próbki co sekundę w blokach: „U hex” (PerfHUD), CPU klatki efektów, GPU klatki
// i compute (znaczniki czasu), sloty, wątki kernela, stemple/s, wypchnięcia LRU, przepadłe stemple.
// Mapa: domyślnie włączona przez cały przebieg, `--wylaczona` — wyłączona od startu (A/B między przebiegami: bitwa
// wygasa w czasie, więc bloki wł./wył. w jednej sesji mieszają koszt mapy ze spadkiem liczby okrętów), `--naprzemian`
// — bloki wł./wył. w jednej sesji (tylko do podglądu liczników).
// `--blyski N`: przy każdym stemplu N błysków w siatce świateł (jak trafienia z 17) — koszt świateł efektów na poszyciu.
//
//   node scripts/webgpu/rany-bitwa.mjs [--out <katalog>] [--port 5359] [--bok 24] [--bez-tarcz] [--blyski 1]
//        [--wylaczona | --naprzemian] [--bloki 2] [--sek 6] [--tag nazwa]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, sleep, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5359);
const side = Math.max(2, Number(args.bok || 24));
const noShields = !!args['bez-tarcz'];
const flashes = Math.max(0, Number(args.blyski || 0));
const blocks = Math.max(1, Number(args.bloki || 2));
const blockSec = Math.max(2, Number(args.sek || 6));
const mapOff = !!args.wylaczona;
const alternate = !!args.naprzemian;
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
const out = resolve(repo, args.out || '.tmp/webgpu/zadania/18c/rany-bitwa');
mkdirSync(out, { recursive: true });

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { bok: side, bezTarcz: noShields, blyski: flashes, mapa: alternate ? 'naprzemian' : (mapOff ? 'wył.' : 'wł.'), bloki: [] };
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  await ev(`(async () => { const m = await import('/src/ui/perfHud.js'); window.__PH = m.PerfHUD; if (!m.PerfHUD.visible) m.PerfHUD.toggle(); return true; })()`);
  result.spawn = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = ship; let n = 0; const put = (k, mode, x, y, a) => { const r = spawnCallInShip(k, { mode, spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a }); n += Array.isArray(r) ? r.length : (r ? 1 : 0); };
    const side = ${side}, nb = Math.max(1, Math.round(side * 0.17)), nd = side - nb;
    for (let i = 0; i < nd; i++) put('destroyer', 'pirate', 6000 + (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, Math.PI);
    for (let i = 0; i < nb; i++) put('pirate_battleship', 'pirate', 9000, -(nb * 1300) + i * 2600, Math.PI);
    for (let i = 0; i < nd; i++) put('destroyer', 'friendly', 800 - (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, 0);
    for (let i = 0; i < nb; i++) put('battleship', 'friendly', -2600, -(nb * 1300) + i * 2600, 0);
    S.cam(s.pos.x + 3500, s.pos.y, 0.12);
    for (let i = 0; i < 900 && !S.hullsReady(); i++) await H.frames(2);
    if (${mapOff && !alternate}) { window.HullDamageMap.enabled = false; window.HullDamageMap.reset(); }
    if (${noShields}) {
      window.__stripShields = () => { for (const e of window.npcs || []) if (e.shield) { e.shield.val = 0; e.shield.regenTimer = 1e9; } };
      window.__stripShields();
    }
    // Błyski trafień (zastępstwo receptur 17): przy każdym stemplu N błysków w siatce świateł nad punktem.
    const M = window.HullDamageMap, orig = M.onHullImpact;
    window.__flashN = ${flashes};
    window.HullBodies.onImpact = (e, r) => {
      orig(e, r);
      const L = window.Core3D.fx?.lights;
      for (let k = 0; k < window.__flashN && L; k++) L.flash(r.x, r.y, 1.0, 0.65, 0.35, 6, 320, 0.16, 2, 0, 40);
    };
    H.clock.mode = 'real';
    return n; })()`, 300000);
  console.log('okręty:', result.spawn);
  await sleep(6000);
  const sample = `(() => { const d = window.__PH?.display || {}; const C = window.Core3D; const M = window.HullDamageMap; const st = M.stats;
    if (window.__stripShields) window.__stripShields();
    return { uHex: d.render3dHexUpdateTime, klatka: d.frameMs, rysowanie: d.drawTime, gpu: C.gpuFrameMs, compute: C.gpuComputeMs, fxCpu: C.fxStats?.cpuMs,
      swiatla: C.fxStats?.lights, sloty: st.slotsL + st.slotsM + st.slotsS, L: st.slotsL, M: st.slotsM, S: st.slotsS, watki: st.threads, dispatch: st.dispatch, zadania: st.jobs,
      stemple: st.stamps, receptury: st.recipeStamps, duplikaty: st.recipeDup, wypchniete: st.evictions, mniejsza: st.downgrades, wieksza: st.upgrades, brak: st.noSlot, przepadle: st.droppedStamps, pozaKadrem: st.offView,
      npc: (window.npcs || []).filter((n) => !n.dead).length, wraki: (window.wrecks || []).length }; })()`;
  const med = (arr, k) => { const v = arr.map((s) => Number(s[k])).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length / 2)].toFixed(4) : null; };
  for (let b = 0; b < (alternate ? blocks * 2 : blocks); b++) {
    const on = alternate ? b % 2 === 0 : !mapOff;
    if (alternate) {
      await ev(`(() => { const M = window.HullDamageMap; if (${on}) { M.enabled = true; } else { M.enabled = false; M.reset(); } return true; })()`);
      await sleep(1000);
    }
    const s0 = JSON.parse(await ev(`JSON.stringify(${sample})`));
    const samples = [];
    for (let i = 0; i < blockSec; i++) {
      await sleep(1000);
      samples.push(JSON.parse(await ev(`JSON.stringify(${sample})`)));
    }
    const last = samples[samples.length - 1];
    const row = {
      mapa: on ? 'wł.' : 'wył.',
      uHex: med(samples, 'uHex'), klatka: med(samples, 'klatka'), gpu: med(samples, 'gpu'), compute: med(samples, 'compute'), fxCpu: med(samples, 'fxCpu'),
      swiatla: med(samples, 'swiatla'), sloty: last.sloty, L: last.L, M: last.M, S: last.S, watkiMed: med(samples, 'watki'), watkiMax: Math.max(...samples.map((s) => s.watki || 0)),
      stempleNaS: +((last.stemple - s0.stemple) / blockSec).toFixed(1), recepturyNaS: +((last.receptury - s0.receptury) / blockSec).toFixed(1), duplikatyNaS: +((last.duplikaty - s0.duplikaty) / blockSec).toFixed(1), wypchniete: last.wypchniete - s0.wypchniete, przepadle: last.przepadle - s0.przepadle,
      brak: last.brak - s0.brak, pozaKadrem: last.pozaKadrem - s0.pozaKadrem, npc: last.npc, wraki: last.wraki
    };
    result.bloki.push({ ...row, probki: samples });
    console.log(JSON.stringify(row));
  }
  result.pula = await ev('JSON.stringify({ poolBytes: window.HullDamageMap.stats.poolBytes, cpuCopyBytes: window.HullDamageMap.stats.cpuCopyBytes })');
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels|TimestampQueryPool/.test(l)).slice(0, 20);
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await chrome.close();
  await server.close();
}
const tag = args.tag || `${noShields ? 'bez-tarcz' : 'tarcze'}${flashes ? `-blyski${flashes}` : ''}-${result.mapa === 'wył.' ? 'wyl' : result.mapa === 'wł.' ? 'wl' : 'ab'}`;
writeFileSync(join(out, `wynik-${tag}.json`), JSON.stringify(result, null, 2) + '\n');
console.log('pula:', result.pula, 'błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 3).join(' | '));
process.exit(result.blad ? 1 : 0);
