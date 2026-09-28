// Parzystość bloomu (zadanie 23): BloomGryCompute (jeden pass compute, droga gry) vs BloomGry (BloomNode three,
// 12 renderów, dawna droga) na tym samym buforze sceny — cele HalfFloat porównane bit w bit (jasne, 5 × poziom
// i pion, kompozyt). Sceny: statek przy Ziemi (ring, K-7), słońce z bliska, bitwa (pociski, tarcze, dysze).
//
//   node scripts/webgpu/bloom-parzystosc.mjs [--port 5363] [--out .tmp/webgpu/zadania/23/bloom-parzystosc.json]
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5363);
const out = resolve(repo, args.out || '.tmp/webgpu/zadania/23/bloom-parzystosc.json');
mkdirSync(dirname(out), { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const SCENY = {
  hud: `S.cam(ship.pos.x, ship.pos.y, 1.0);`,
  slonce: `const sun = window.SUN; if (sun) { DevScene.teleport(sun.x + (sun.r || 20000) * 1.6, sun.y, 0); S.cam(ship.pos.x, ship.pos.y, 0.35); }`,
  bitwa: `DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
    spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, -900), spawnAngle: Math.PI });
    spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(4000, 0), spawnAngle: Math.PI });
    spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: at(600, -1200), spawnAngle: 0 });
    spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
    S.cam(s.pos.x + 1800, s.pos.y, 0.3);
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    H.reseed(0xb17a);
    await H.step(150);
    S.cam(s.pos.x + 1800, s.pos.y, 0.3);`
};

const { server, base } = await startVite(port);
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 300000) => evaluate(cdp, e, t);
const wynik = { when: new Date().toISOString(), sceny: {} };
let zgodne = true;
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');
  for (const [id, js] of Object.entries(SCENY)) {
    await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x23b); S.hideHud(true); ${js} return true; })()`);
    await ev('window.__harness.frames(20)');
    const r = await ev(`(async () => { const m = await import('/scripts/webgpu/bloom-parzystosc-strona.js'); return m.porownajBloom(); })()`);
    wynik.sceny[id] = r;
    const rows = Object.entries(r).map(([k, v]) => (v.blad ? `${k}: ${v.blad}` : `${k} ${v.rozmiar}: różne ${v.rozne}/${v.wartosci} (jasnych ${v.jasnych}${v.rozne ? `, maks ${v.maksRoznica}` : ''})`));
    for (const v of Object.values(r)) if (v.blad || v.rozne) zgodne = false;
    console.log(`${id}:\n  ${rows.join('\n  ')}`);
  }
  wynik.zgodne = zgodne;
  wynik.bledy = logs.errors().filter((l) => !/favicon|AudioSys/.test(l)).slice(0, 20);
  console.log(zgodne ? 'BIT W BIT: wszystkie cele zgodne' : 'RÓŻNICE — patrz wyżej');
  if (wynik.bledy.length) console.log('błędy strony:', wynik.bledy);
} finally {
  writeFileSync(out, JSON.stringify(wynik, null, 1));
  await chrome.close();
  await server.close();
}
