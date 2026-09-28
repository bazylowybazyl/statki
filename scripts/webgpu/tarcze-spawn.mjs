// Spawn floty z tarczami w PRAWDZIWEJ grze (?dev, WebGPU, czas rzeczywisty): czy spawn buduje
// materiały tarcz per okręt (port WebGPU, zadanie 14; kryterium z docs/webgpu/zadania/14-tarcze.md).
// Spawn N piratów (domyślnie 30) w kadrze, wszystkie tarcze w rozruchu (kopuły widoczne naraz),
// pomiar ~3 s: budowy NodeBuildera materiałów tarcz (licznik SHIELD_TSL_STATS.builds), wpisy
// cache NodeManagera, lekkie materiały per tarcza, czasy klatek i updateShields3D (RenderLiveDebug).
// Dla porównania: czas JEDNEJ budowy świeżego grafu tarczy (NodeBuilder na CPU, kopia modułu TSL
// z nowymi węzłami) — tyle kosztowałby każdy okręt przy materiale z własnym grafem.
//   node scripts/webgpu/tarcze-spawn.mjs [--out .tmp/webgpu/zadania/14/spawn] [--port 5348] [--n 30]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startChrome, attachLogs, waitFor, evaluate, repo, parseArgs, sleep } from './wspolne.mjs';

const args = parseArgs();
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/14/spawn');
mkdirSync(outDir, { recursive: true });
const N = Math.max(1, Number(args.n || 30));
const DEEP = { x: 6210000, y: 5330000 };

const { createServer } = await import('vite');
const server = await createServer({
  root: repo, logLevel: 'error',
  server: { port: Number(args.port) || 5348, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } },
  optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl'] }
});
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const ev = (e, t = 180000) => evaluate(chrome.cdp, e, t);
try {
  await chrome.cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(chrome.cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(chrome.cdp, '(window.__frameId || 0) > 60', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(chrome.cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  // Głęboka próżnia, kamera nad siatką spawnu; chwila na ustalenie klatki.
  await ev(`(() => { DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0); camera.zoom = camera.targetZoom = 0.14; DevScene.syncCamera(); return true; })()`);
  await sleep(2500);
  const before = await ev(`(async () => {
    const m = await import('/src/3d/shield3D.js');
    return { stats: m.getShieldMaterialStats(), nodeBuilders: Core3D.renderer._nodes.nodeBuilderCache.size, npc: npcs.filter((n) => !n.dead).length };
  })()`);
  // Rejestrator klatek (rAF) + sekcje renderu (RenderLiveDebug: updateShields3D, render Core3D).
  const spawnJs = `(() => {
    window.__spawnFrames = [];
    let last = performance.now();
    const domesVisible = () => { let v = 0; for (const o of Core3D.scene.children) if (o.material?.isShieldNodeMaterial && o.visible) v++; return v; };
    const loop = (t) => { window.__spawnFrames.push({ t, dt: t - last, render: Core3D.lastFramePerf?.renderTotalMs ?? null, vis: domesVisible(), nb: Core3D.renderer._nodes.nodeBuilderCache.size }); last = t; if (window.__spawnFrames.length < 400) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    RenderLiveDebug.start(600000);
    const s = ship; const cols = 6; const spacing = 900;
    window.__spawnT0 = performance.now();
    const spawned = [];
    for (let i = 0; i < ${N}; i++) {
      const cx = (i % cols) - (cols - 1) / 2; const cy = Math.floor(i / cols) - (Math.ceil(${N} / cols) - 1) / 2;
      const r = spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: { x: s.pos.x + cx * spacing, y: s.pos.y + cy * spacing }, spawnAngle: Math.PI });
      for (const n of (Array.isArray(r) ? r : [r])) if (n) spawned.push(n);
    }
    window.__spawnMs = performance.now() - window.__spawnT0;
    window.__spawned = spawned;
    // Rozruch tarcz: kopuły widoczne naraz (fala rozruchu).
    for (const n of spawned) if (n.shield && n.shield.max) { n.shield.state = 'activating'; n.shield.activationProgress = 0; }
    return { spawned: spawned.length, spawnMs: window.__spawnMs, shields: spawned.filter((n) => n.shield && n.shield.max).length };
  })()`;
  const spawn = await ev(spawnJs);
  await sleep(3500);
  const after = await ev(`(async () => {
    const m = await import('/src/3d/shield3D.js');
    let domes = 0; let domesVisible = 0; let hullDomes = 0;
    Core3D.scene.traverse((o) => { if (o.material?.isShieldNodeMaterial) { domes++; if (o.visible) domesVisible++; if (o.material.name === 'ShieldHull') hullDomes++; } });
    const frames = window.__spawnFrames.filter((f) => f.t >= window.__spawnT0 - 1);
    const dts = frames.map((f) => f.dt).sort((a, b) => a - b);
    const q = (p) => dts.length ? +dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(2) : null;
    const renders = frames.map((f) => f.render).filter((v) => Number.isFinite(v));
    const b = RenderLiveDebug.buckets;
    const pick = (k) => b[k] ? { wywolan: b[k].calls, sredniaMs: +(b[k].sum / Math.max(1, b[k].calls)).toFixed(3), maksMs: +b[k].max.toFixed(3) } : null;
    const out = {
      stats: m.getShieldMaterialStats(), nodeBuilders: Core3D.renderer._nodes.nodeBuilderCache.size,
      npc: npcs.filter((n) => !n.dead).length, kadluby: window.__spawned.filter((n) => n.beamHull).length,
      kopuly: domes, kopulyWidoczne: domesVisible, kopulyObrysu: hullDomes,
      kopulyWidoczneMaks: Math.max(0, ...frames.map((f) => f.vis)), klatkiZKopulami: frames.filter((f) => f.vis > 0).length,
      nodeBuildersMaks: Math.max(0, ...frames.map((f) => f.nb)),
      klatki: { liczba: frames.length, pierwszaMs: frames[0] ? +frames[0].dt.toFixed(2) : null, p50: q(0.5), p95: q(0.95), maks: q(1), renderMaksMs: renders.length ? +Math.max(...renders).toFixed(3) : null },
      updateShields3D: pick('updateShields3D'), updateHexShips3D: pick('updateHexShips3D'), core3dRenderTotal: pick('core3dRenderTotal')
    };
    RenderLiveDebug.stop();
    return out;
  })()`);
  // Koszt jednej budowy świeżego grafu tarczy (kopia modułu TSL = nowe węzły = nowy klucz).
  const buildCost = await ev(`(async () => {
    let src = null; Core3D.scene.traverse((o) => { if (!src && o.material?.name === 'ShieldHull') src = o; });
    if (!src) return null;
    const r = Core3D.renderer; const out = [];
    for (let k = 1; k <= 4; k++) {
      const fresh = await import('/src/3d/shield3D.tsl.js?kopia=' + k);
      const mat = fresh.createShieldNodeMaterial('hull', src.material.uniforms);
      const mesh = src.clone(false);
      mesh.material = mat;
      const b = r.backend.createNodeBuilder(mesh, r);
      b.material = mat; b.scene = Core3D.scene; b.camera = Core3D.cameraOrtho; b.context.material = mat;
      const t0 = performance.now(); b.build(); out.push(+(performance.now() - t0).toFixed(2));
    }
    return out;
  })()`);
  const res = { when: new Date().toISOString(), n: N, before, spawn, after, budowaSwiezegoGrafuMs: buildCost,
    bledy: logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20) };
  writeFileSync(join(outDir, 'spawn.json'), JSON.stringify(res, null, 2) + '\n');
  console.log(JSON.stringify(res, null, 2));
} finally {
  await chrome.close();
  await server.close();
}
