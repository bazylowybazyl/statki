// Tarcze w PRAWDZIWEJ grze A/B renderer↔renderer (port WebGPU, zadanie 14): ta sama bitwa co w harnessie
// (zegar wirtualny, ziarna, UUID z osobnego strumienia) na WebGL (worktree tagu webgl-baseline, --root) i na
// WebGPU (to repo), a potem wymuszone trafienia w tarczę największego pirata we wszystkich klasach (pd, main,
// special, shield — dwie ostatnie dają impulsy gorącego powietrza ShieldImpactFX → Core3D.pushHeatHazeWorld).
// Zrzuty: sama warstwa tarcz (7: kopuła, wstęgi, bańki) z bloomem i gorącym powietrzem, to samo bez gorącego
// powietrza, warstwy 0+7 (kadłuby + tarcze) i cała klatka; liczba źródeł gorącego powietrza w klatce.
//
//   node scripts/webgpu/tarcze-gra.mjs [--root <repo gry, domyślnie to repo>] [--out <katalog>] [--port 5349]
// Porównanie: node scripts/webgpu/porownaj.mjs --a <wynik WebGL> --b <wynik WebGPU> --out <katalog>
// Worktree tagu: docs/webgpu/README.md § Nowa scena bazy (kopia node_modules, nie dowiązanie).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const root = resolve(args.root || repo);
const port = Number(args.port || 5349);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const { createServer } = await import('vite');
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { root, zrzuty: {} };
let out = null;
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  result.renderer = await ev('(() => (window.Core3D.renderer?.isWebGPURenderer ? "webgpu" : "webgl"))()');
  out = resolve(repo, args.out || join('.tmp/webgpu/zadania/14/tarcze-gra', result.renderer));
  mkdirSync(out, { recursive: true });
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');
  console.log('renderer:', result.renderer, '→', out);

  // Liczba źródeł gorącego powietrza w ostatniej klatce: WebGPU — uniformy postu, WebGL (tag) — uberPass.
  const sourceCount = `(() => { const C = window.Core3D; const u = C._postUniforms || C.uberPass?.material?.uniforms; return u ? u.uSourceCount.value : null; })()`;
  const snap = async (name, layers) => {
    await ev(`window.__harness.scene.isolate(${JSON.stringify(layers)})`);
    await ev('window.__harness.frames(12)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(4)');
    await screenshotPng(cdp, join(out, `${name}.png`));
    result.zrzuty[name] = { warstwy: layers, zrodlaGoracegoPowietrza: await ev(sourceCount) };
  };
  const toggles = (o) => ev(`(() => { window.Core3D.setPerfToggles(${JSON.stringify(o)}); return true; })()`);

  // Bitwa jak w harnessie (scena `bitwa`), potem wymuszone trafienia w tarczę największego pirata.
  result.stan = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0xb17b); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
    spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, -900), spawnAngle: Math.PI });
    spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, 900), spawnAngle: Math.PI });
    spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(4000, 0), spawnAngle: Math.PI });
    spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: at(600, -1200), spawnAngle: 0 });
    spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
    S.cam(s.pos.x + 1800, s.pos.y, 0.3);
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    H.reseed(0xb17a);
    await H.step(180);
    const e = npcs.filter((n) => !n.dead && !n.friendly).sort((a, b) => (b.radius || 0) - (a.radius || 0))[0];
    if (!e) return { blad: 'brak pirata' };
    // Kamera z bliska PRZED trafieniami: LOD cząstek (lodScaleFor) liczy się przy emisji — przy zoomie
    // bitwy (0,3) jest < 0,45 i ShieldImpactFX nie tworzy impulsów gorącego powietrza.
    S.cam(e.x, e.y, 0.9);
    await H.frames(2);
    H.reseed(0x7a14);
    const hit = (a, dmg, cls) => registerShieldImpact(e, e.x + Math.cos(a) * 500, e.y + Math.sin(a) * 500, dmg, cls);
    const dir = Math.atan2(s.pos.y - e.y, s.pos.x - e.x);
    hit(dir, 420, 'special');
    await H.step(5);
    hit(dir - 1.4, 300, 'shield');
    await H.step(3);
    hit(dir + 1.1, 200, 'main');
    hit(dir + 2.6, 60, 'pd');
    await H.step(2);
    window.__tarczeCel = { x: e.x, y: e.y };
    S.cam(e.x, e.y, 0.9);
    return { pirat: [Math.round(e.x), Math.round(e.y)], tarcza: e.shield?.state, trafien: e.shield?.impacts?.length ?? 0,
      suma: +((npcs || []).reduce((a, n) => a + (n.dead ? 0 : n.x + n.y), 0) % 100000).toFixed(4) };
  })()`, 300000);
  console.log('stan:', JSON.stringify(result.stan));

  await snap('tarcze', [7]);
  await toggles({ heatHaze: false });
  await snap('tarcze-bez-powietrza', [7]);
  await toggles({ heatHaze: true });
  await snap('tarcze-ortho', [0, 7]);
  await snap('tarcze-cala', null);
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await chrome.close();
  await server.close();
}
if (out) writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.zrzuty));
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
