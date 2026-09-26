// Dym PRAWDZIWEJ gry na silniku belek (kadłuby: src/game/hullBodies.js): Vite + headless
// Chrome (CDP, pomocniki z dema rdzenia), gra z ?dev, menu → tryb single.
//   node scripts/dym-gry-belki.mjs [--scen taran|bitwa|oba] [--s 30] [--out katalog]
// Taran: kukła-niszczyciel (dummy) przed dziobem, trzy kratery po 1000, potem wlatuje
// w gracza 700 j./s (pchnięcie do pierwszego styku). Bitwa: 5 piratów vs 4 wsparcia,
// próbki kroku kadłubów co 100 ms. Wypisuje stan i błędy konsoli, zapisuje zrzuty.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, startChrome, navigateAndWait, evaluate, sleep } from '../dema/rdzen-cdp.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const scen = arg('scen', 'oba');
const seconds = Number(arg('s', 30));
const outDir = arg('out', join(tmpdir(), 'belki-gra'));
mkdirSync(outDir, { recursive: true });

const { server, base } = await startVite(5292);
const chrome = await startChrome({ width: 1600, height: 900, webgpu: false });
const { cdp, logs } = chrome;
const ev = (expr) => evaluate(cdp, expr);
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(data, 'base64'));
};
const report = (label, value) => console.log(label.padEnd(16), typeof value === 'string' ? value : JSON.stringify(value));
const errors = () => logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));

try {
  const ready = await navigateAndWait(cdp, `${base}/index.html?dev=1`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 120000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  const started = await navigateAndWaitFrames(240000);
  report('gra', { ready, started });
  await sleep(2500);
  report('gracz', await ev(`(() => { const h = window.ship.beamHull; return h ? { węzły: h.body.activeNodes, belki: h.body.liveBeams,
    promień: Math.round(window.ship.radius), masa: Math.round(window.ship.mass), sprite: [h.srcWidth, h.srcHeight] } : null; })()`));

  if (scen === 'taran' || scen === 'oba') await ramScenario();
  if (scen === 'bitwa' || scen === 'oba') await battleScenario();
  report('błędy konsoli', errors().slice(0, 20));
  report('zrzuty', outDir);
} catch (e) {
  console.log('BŁĄD', e.message, errors().slice(0, 10));
} finally {
  await chrome.close();
  await server.close();
  process.exit(0);
}

async function navigateAndWaitFrames(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(250);
    try { if (await ev('(window.__frameId || 0) > 30')) return true; } catch { /* ładuje się */ }
  }
  return false;
}

async function ramScenario() {
  await ev(`(() => {
    const s = window.ship, a = s.angle, d = 1400;
    window.__dummy = window.spawnCallInShip('destroyer', { mode: 'dummy', spawnPos: { x: s.pos.x + Math.cos(a) * d, y: s.pos.y + Math.sin(a) * d }, spawnAngle: a + Math.PI / 2 })[0];
    const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = 0.3;
    return true;
  })()`);
  await sleep(2500);
  report('kukła', await ev(`(() => { const n = window.__dummy, h = n.beamHull; return { kadłub: !!h, węzły: h?.body.activeNodes, masa: Math.round(n.mass) }; })()`));
  report('kratery', await ev(`(() => {
    const n = window.__dummy, H = window.HullBodies, before = n.beamHull?.body.activeNodes ?? 0, hits = [];
    const c = Math.cos(n.angle), s = Math.sin(n.angle);
    for (const off of [-120, 0, 120]) {
      const x = n.x + c * off, y = n.y + s * off;
      const r = H.sweep(n, x - s * 800, y + c * 800, x, y, 2);
      hits.push(r ? H.impact(n, r.worldX, r.worldY, 1000, { x: s * 3000, y: -c * 3000 }) : 'pudło');
    }
    return { hits, zabite: before - (n.beamHull?.body.activeNodes ?? 0) };
  })()`));
  await ev(`(() => { const c = window.camera, n = window.__dummy; c.enterRtsMode(); c.x = c.targetX = n.x; c.y = c.targetY = n.y; c.manualZoom = true; c.zoom = c.targetZoom = 1.1; return true; })()`);
  await sleep(700);
  await shot('taran-1-kratery');
  await ev(`(() => { window.camera.exitRtsMode(); const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = 0.3; return true; })()`);
  await sleep(900);
  // Pchnięcie do pierwszego styku — dalej kukła leci własnym pędem (bez nieskończonego taranu).
  await ev(`(() => { const n = window.__dummy, s = window.ship; const dx = s.pos.x - n.x, dy = s.pos.y - n.y, d = Math.hypot(dx, dy);
    n.ai = null; window.__ram = setInterval(() => { if (n.dead || window.HullBodies.hasContact(n, s)) { clearInterval(window.__ram); return; }
      n.vx = dx / d * 700; n.vy = dy / d * 700; }, 8); return true; })()`);
  for (let t = 0; t < 4; t++) {
    await sleep(900);
    report(`taran ${t}`, await ev(`(() => { const n = window.__dummy, s = window.ship; return { d: Math.round(Math.hypot(n.x - s.pos.x, n.y - s.pos.y)),
      styk: window.HullBodies.hasContact(n, s), krokMs: +window.HullBodies.perf.lastStepMs.toFixed(2), gracz: s.beamHull?.body.activeNodes,
      kukła: n.beamHull?.body.activeNodes ?? (n.dead ? 'martwa' : null), wraki: window.wrecks.length, vGracza: [Math.round(s.vel.x), Math.round(s.vel.y)] }; })()`));
    if (t === 0) {
      await ev(`(() => { const c = window.camera, n = window.__dummy, s = window.ship; c.enterRtsMode(); c.x = c.targetX = n.x + (s.pos.x - n.x) * 0.15; c.y = c.targetY = n.y; c.manualZoom = true; c.zoom = c.targetZoom = 0.9; return true; })()`);
      await sleep(350);
      await shot('taran-2-styk');
      await ev(`(() => { window.camera.exitRtsMode(); return true; })()`);
    }
  }
}

async function battleScenario() {
  report('bitwa', await ev(`(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    let count = 0;
    const put = (key, mode, pos, ang) => { count += window.spawnCallInShip(key, { mode, spawnPos: pos, spawnAngle: ang }).length; };
    for (let i = 0; i < 4; i++) put('destroyer', 'pirate', at(4200, -1800 + i * 1200), a + Math.PI);
    put('pirate_battleship', 'pirate', at(5200, 0), a + Math.PI);
    for (let i = 0; i < 3; i++) put('destroyer', 'friendly', at(600, -1500 + i * 1500), a);
    put('battleship', 'friendly', at(-600, 1400), a);
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = 0.16;
    window.__hullSamples = [];
    window.__hullSampler = setInterval(() => window.__hullSamples.push(window.HullBodies.perf.lastStepMs), 100);
    return { statki: count };
  })()`));
  const t0 = Date.now();
  let shots = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(2500);
    report(`t=${Math.round((Date.now() - t0) / 1000)}`, await ev(`(() => { const live = window.npcs.filter((n) => !n.dead && !n.fighter);
      return { npc: live.length, kadłuby: live.filter((n) => n.beamHull).length, wraki: window.wrecks.length,
        węzłyWraków: window.wrecks.reduce((s, w) => s + (w.beamHull ? w.beamHull.body.activeNodes : 0), 0),
        krokMs: +window.HullBodies.perf.lastStepMs.toFixed(2), ciała: window.HullBodies.perf.bodies }; })()`));
    if (shots < 3) await shot(`bitwa-${shots++}`);
  }
  report('krok kadłubów', await ev(`(() => { clearInterval(window.__hullSampler); const v = window.__hullSamples.slice().sort((a, b) => a - b);
    const p = (q) => v.length ? +v[Math.min(v.length - 1, Math.floor(v.length * q))].toFixed(2) : 0;
    return { próbek: v.length, mediana: p(0.5), p95: p(0.95), maks: p(1),
      skończone: [window.ship, ...window.npcs, ...window.wrecks].every((e) => Number.isFinite((e.pos ? e.pos.x : e.x) + (e.pos ? e.pos.y : e.y))) }; })()`));
}
