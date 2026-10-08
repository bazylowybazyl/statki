// OBRYS KADŁUBA w polu gazu hal K-7 (src/game/hullFootprint.js → src/3d/gasField/gasField2D.js) w PRAWDZIWEJ grze:
// Vite + headless Chrome z WebGPU (CDP). Atlas przelatuje ukosem przez kurz hali K-7 Ziemi (tor prowadzony co
// klatkę — prędkość i obrót kadłuba idą do gazu), w pauzie: zrzut kadru i ODCZYT Z GPU komórek stałych pola
// (flagT) i pyłu (denA) — mapa `obrys-mapa.png`: przeszkody hali szare, komórki stałe kadłuba białe, pył brązowy,
// węzły kadłuba (HullBodies.nodeWorld) czerwone kropki. Kadłub ma rozcinać pył swoim kształtem (zgłoszenie
// użytkownika 2026-10-07: dawniej obrócone pudło). Raport: udział węzłów w komórkach stałych, komórki stałe
// daleko od węzłów (ma być 0), pipeline'y utworzone synchronicznie po starcie (ma być 0).
//
//   node scripts/webgpu/hala-obrys-gra.mjs [--out .tmp/hala-obrys] [--rozmiar 1600x900] [--zoom 0.3] [--kat 35] [--v 350]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';
import { writePng } from './png.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/hala-obrys');
mkdirSync(out, { recursive: true });
const ZOOM = Number(args.zoom || 0.3);
const TILT = Number(args.kat ?? 35) * Math.PI / 180;
const SPEED = Number(args.v || 350);

const { server, base } = await startVite(Number(args.port || 5396));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { zdjecia: [] };

await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
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
    const comp = pu.createComputePipeline;
    if (comp) pu.createComputePipeline = function (p, b) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: true, compute: true, nazwa: (p && p.computeProgram && p.computeProgram.name) || 'compute' });
      return comp.call(this, p, b);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

const KEY_W = { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 };
const pause = (on) => ev(`window.__setGamePaused(${on ? 'true' : 'false'})`);
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await ev(`(() => { const d = window.HallDust; return d ? { ...d.stats, cpuMs: +d.stats.cpuMs.toFixed(3) } : null; })()`);
  report.zdjecia.push({ name, pyl: s });
  console.log(('[' + name + ']').padEnd(28), JSON.stringify(s));
}

// Odczyt flagT i denA z GPU (RGBA16F) + węzły kadłuba w komórkach domeny.
const readMaps = () => ev(`(async () => {
  const r = window.Core3D.renderer, sim = window.HallDust.sim, nx = sim.nx, ny = sim.ny;
  const m = await import('/src/game/hallDustInput.js');
  const L = await import('/src/3d/gasField/hallDustLayout.js');
  const half = (h) => {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
    return e === 0 ? s * f * 5.960464477539063e-8 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * Math.pow(2, e - 15);
  };
  const lens = [];
  const read = async (tex) => {
    const a = await r.backend.copyTextureToBuffer(tex, 0, 0, nx, ny, 0);
    const u = new Uint16Array(a.buffer, a.byteOffset, a.byteLength >> 1);
    const row = Math.ceil(nx * 8 / 256) * 256 / 2;   // wiersze bufora wyrównane do 256 B
    lens.push([a.constructor.name, u.length, row]);
    const outA = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      outA[(j * nx + i) * 2] = half(u[j * row + i * 4]);
      outA[(j * nx + i) * 2 + 1] = half(u[j * row + i * 4 + 1]);
    }
    return outA;
  };
  const flag = await read(sim.flagT);
  const den = await read(sim.denA);
  const dom = window.HallDust.domain;
  const IN = window.HallDust.input;
  const aff = { p0x: IN[L.HALL_DUST_IN.p0x], p0y: IN[L.HALL_DUST_IN.p0y], ax: IN[L.HALL_DUST_IN.ax], ay: IN[L.HALL_DUST_IN.ay], bx: IN[L.HALL_DUST_IN.bx], by: IN[L.HALL_DUST_IN.by] };
  const hull = window.ship.beamHull, s = hull.body.nodeStore, HB = window.HullBodies;
  const nodes = [];
  const q = {}, w = {};
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    HB.nodeWorld(hull, i, w);
    m.gameToHall(aff, w.x, w.y, q);
    nodes.push([(q.x - dom.x0) / dom.h, (q.z - dom.z0) / dom.h]);
  }
  const cells = Array.from(sim.cellTex.image.data.filter((_, k) => k % 4 === 0));
  // lustro CPU testu kernela (hallBodySolidCpu) w tej samej klatce — komórki stałe kadłuba wg CPU
  const cpu = new Uint8Array(nx * ny);
  const ns = IN[L.HALL_DUST_IN.ships] | 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    for (let s2 = 0; s2 < ns; s2++) if (L.hallBodySolidCpu(IN, s2, dom, i + 0.5, j + 0.5)) { cpu[j * nx + i] = 1; break; }
  }
  let maskSum = 0;
  for (let k = 0; k < sim.maskData.length; k++) maskSum += sim.maskData[k] > 0 ? 1 : 0;
  const diag = {
    ships: ns, bodyCount: sim.bodyCount, bodies: Array.from(sim.bodies.slice(0, 12)).map((v) => +v.toFixed(4)),
    uA: sim.U.bodyA.array[0].toArray().map((v) => +v.toFixed(4)), uC: sim.U.bodyC.array[0].toArray().map((v) => +v.toFixed(4)),
    lens, maskSum, maskVersion: sim.maskTex.version, maskImg: [sim.maskTex.image.width, sim.maskTex.image.height]
  };
  return { nx, ny, flag: Array.from(flag), den: Array.from(den), nodes, cells, cpu: Array.from(cpu), diag };
})()`, 120000);

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  report.pipesStart = await ev('window.__pipeRec.pipes.length');
  if (!await ev('!!window.HullBodies')) await ev(`(async () => { window.HullBodies = (await import('/src/game/hullBodies.js')).HullBodies; return true; })()`);

  // Tor: od (−900, 1500) hali ukosem (kąt TILT od osi +z) przez środek hali; prędkość SPEED, okręt dziobem w kierunku lotu.
  await ev(`(async () => {
    const m = await import('/src/game/hallDustInput.js');
    const e = window.__haloRings.entries.find((q) => q.key === 'earth');
    const a = m.hallToGameAffine(e.collider.place, e.collider.registry.halls[0].frame, {});
    const dx = Math.sin(${TILT}), dz = Math.cos(${TILT});
    const gx = dx * a.ax + dz * a.bx, gy = dx * a.ay + dz * a.by;
    const x0 = a.p0x - 900 * a.ax + 1500 * a.bx, y0 = a.p0y - 900 * a.ay + 1500 * a.by;
    const heading = Math.atan2(gy, gx);
    window.DevScene.teleport(x0, y0, heading);
    window.DevScene.syncCamera();
    const H = window.__fly = { x: x0, y: y0, gx, gy, heading, v: 0, on: true, t: performance.now() };
    const tick = (t) => {
      const dt = Math.min(0.05, (t - H.t) / 1000); H.t = t;
      const s = window.ship;
      if (H.on && !window.__isGamePaused()) { H.x += H.gx * H.v * dt; H.y += H.gy * H.v * dt; }
      if (H.on) { s.pos.x = H.x; s.pos.y = H.y; s.vel.x = H.gx * H.v; s.vel.y = H.gy * H.v; s.angle = H.heading; s.angVel = 0; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
  await setZoom(ZOOM);
  await sleep(3000);
  await shot('00-postoj');
  // ciąg MAIN (dysze dmuchają w kurz jak w PRZELOCIE), tor dalej prowadzony — kadłub przecina chmurę za sobą
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_W });
  await sleep(2500);
  await ev(`(() => { window.__fly.v = ${SPEED}; return true; })()`);
  await sleep(2600);
  await pause(true);
  await sleep(400);
  await shot('01-przelot');
  const maps = await readMaps();
  // mapa: okno wokół okrętu (pudło węzłów + zapas), 8 px na komórkę
  const nx = maps.nx, ny = maps.ny;
  let i0 = nx, i1 = 0, j0 = ny, j1 = 0;
  for (const [x, y] of maps.nodes) { i0 = Math.min(i0, x); i1 = Math.max(i1, x); j0 = Math.min(j0, y); j1 = Math.max(j1, y); }
  const pad = 14;
  i0 = Math.max(0, Math.floor(i0) - pad); i1 = Math.min(nx - 1, Math.ceil(i1) + pad);
  j0 = Math.max(0, Math.floor(j0) - pad); j1 = Math.min(ny - 1, Math.ceil(j1) + pad);
  const S = 8, mw = (i1 - i0 + 1) * S, mh = (j1 - j0 + 1) * S;
  const img = { width: mw, height: mh, data: new Uint8Array(mw * mh * 4) };
  const nearNode = new Uint8Array(nx * ny);
  for (const [x, y] of maps.nodes) {
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const ci = Math.floor(x) + di, cj = Math.floor(y) + dj;
      if (ci >= 0 && cj >= 0 && ci < nx && cj < ny) nearNode[cj * nx + ci] = 1;
    }
  }
  let bodyCells = 0, farCells = 0, cpuCells = 0, mismatch = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * nx + i;
    const solid = maps.flag[k * 2] > 0.5, wall = maps.cells[k] > 127, dust = Math.min(1, maps.den[k * 2] * 0.6);
    const body = solid && !wall;
    if (body) { bodyCells++; if (!nearNode[k]) farCells++; }
    if (!wall && maps.cpu[k]) cpuCells++;
    if (!wall && body !== !!maps.cpu[k]) mismatch++;
    const col = wall ? [90, 90, 96] : body ? [235, 235, 240] : [20 + 150 * dust, 18 + 110 * dust, 16 + 70 * dust];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // wiersz mapy = z hali (od dołu obrazu w górę)
      const px = (i - i0) * S + x, py = mh - 1 - ((j - j0) * S + y);
      const o = (py * mw + px) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  let nodesIn = 0;
  for (const [x, y] of maps.nodes) {
    const ci = Math.floor(x), cj = Math.floor(y);
    if (ci >= 0 && cj >= 0 && ci < nx && cj < ny && maps.flag[(cj * nx + ci) * 2] > 0.5) nodesIn++;
    const px = Math.round((x - i0) * S), py = mh - 1 - Math.round((y - j0) * S);
    if (px >= 0 && py >= 0 && px < mw && py < mh) {
      const o = (py * mw + px) * 4;
      img.data[o] = 230; img.data[o + 1] = 40; img.data[o + 2] = 40;
    }
  }
  writePng(join(out, 'obrys-mapa.png'), img);
  report.obrys = {
    wezly: maps.nodes.length, wezlyWKomorkachStalych: nodesIn, udzial: +(nodesIn / maps.nodes.length).toFixed(3),
    komorkiKadluba: bodyCells, komorkiDalekoOdWezlow: farCells,
    // GPU (flagT) ↔ lustro CPU (hallBodySolidCpu) w tej samej klatce
    komorkiCpu: cpuCells, rozbieznosciGpuCpu: mismatch, diag: maps.diag
  };
  console.log('obrys:', JSON.stringify(report.obrys));
  await pause(false);
  await sleep(1500);
  await pause(true);
  await sleep(400);
  await shot('02-przelot-dalej');
  await setZoom(ZOOM * 1.6);
  await sleep(400);
  await shot('03-zblizenie');
  await pause(false);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_W });

  const pipes = await ev('window.__pipeRec.pipes');
  report.pipeline = {
    syncPoStarcie: pipes.slice(report.pipesStart).filter((p) => p.sync && !p.compute).map((p) => p.nazwa),
    computePoStarcie: pipes.slice(report.pipesStart).filter((p) => p.compute).map((p) => p.nazwa)
  };
  console.log('pipeline:', JSON.stringify(report.pipeline));
} catch (e) {
  console.error('BŁĄD', e);
  report.fatal = String(e?.stack || e);
} finally {
  report.bledy = logs.errors();
  console.log('błędy konsoli:', report.bledy.length, report.bledy.slice(0, 12));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
