// WYLOT Z HALI K-7 przez bramę G-01 w PRAWDZIWEJ grze (zgłoszenie użytkownika 2026-11-03: „jak wyjdę z hali, gaz nagle
// się zakleszcza — szybko i nierealistycznie wraca, wypełniając pustkę po statku”): Atlas rusza z pasa C-01 dziobem ku
// bramie (pełny ciąg W), dysze MAIN mijają pole siłowe i stożek strumienia znika z hali. Seria odczytów pól pyłu z GPU
// w pauzie (wzór hala-pyl-audyt.mjs) — w prostokącie przy bramie od środka hali (x okrętu ± 700 j., 60…1400 j. przed
// licem pola): pył w powietrzu i na pokładzie, prędkość wzdłuż osi hali i |v|; pył w korytarzu lotu (x okrętu
// ± 12 komórek, cała głębokość). A/B pamięci strumienia (src/3d/gasField/gasField2D.js: srcRelease / cleanRelease):
// dwa przebiegi w jednej stronie — bez pamięci (dawniej) i z pamięcią — od świeżego pyłu (requestClear).
// Opcjonalnie obrazy pól (PNG: pył × gain, prędkość) i zrzuty gry z kamerą nad bramą (tryb RTS tylko na czas zrzutu).
//
//   node scripts/webgpu/hala-wylot-gra.mjs [--out .tmp/hala-wylot] [--od 7.2] [--do 9.6] [--krok 0.1] [--ab 1]
//     [--side 0|1] [--pola 1] [--gain 6] [--zrzuty 1] [--bramaZoom 0.22] [--query renderWorker=1]
// Liczby czasu dobrane do startu z C-01 przy pełnym ciągu: strumień gaśnie w hali przy t ≈ 7,8–8,0 s.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/hala-wylot');
mkdirSync(out, { recursive: true });
const T0 = Number(args.od || 7.2), T1 = Number(args.do || 9.6), DT = Number(args.krok || 0.1);
const AB = args.ab !== '0';
const SIDE = args.side === '1';
const FIELDS = args.pola === '1';
const SHOTS = args.zrzuty === '1';
const GAIN = Number(args.gain || 6);
const [VW, VH] = (args.rozmiar || '1600x900').split('x').map(Number);

const { server, base } = await startVite(Number(args.port || 5399));
const chrome = await startChrome({ width: VW, height: VH });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { przebiegi: {} };
const KEYS = { w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 } };
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });
const pause = (on) => ev(`window.__setGamePaused(${on ? 'true' : 'false'})`);
const save = (url, file) => writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));

// odczyt tekstury RGBA16F z GPU (strona — tryb off) i pole → PNG (komórki stałe na czerwono, kadłuby na niebiesko)
const HELPERS = `(() => {
  const f16 = (h) => { const s = (h & 0x8000) ? -1 : 1; const e = (h >> 10) & 0x1f; const m = h & 0x3ff;
    if (e === 0) return s * m * Math.pow(2, -24); if (e === 31) return m ? NaN : s * Infinity; return s * (1 + m / 1024) * Math.pow(2, e - 15); };
  window.__readTex = async (tex) => {
    const r = window.Core3D.renderer; const dev = r.backend.device;
    const gpuTex = r.backend.get(tex).texture;
    const w = tex.image.width, h = tex.image.height;
    const bpr = Math.ceil(w * 8 / 256) * 256;
    const buf = dev.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: gpuTex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u16 = new Uint16Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const o = new Float32Array(w * h * 4);
    const rowU16 = bpr / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) o[y * w * 4 + x] = f16(u16[y * rowU16 + x]);
    return { w, h, data: o };
  };
  window.__fieldPng = (field, c, scale, cells, bodies) => {
    const { w, h, data } = field;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const g = Math.round(Math.max(0, Math.min(1, data[i * 4 + c] * scale)) * 255);
      img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
      if (cells[i * 4] > 127) { img.data[i * 4] = 160; img.data[i * 4 + 1] = 30; img.data[i * 4 + 2] = 30; }
      else if (bodies.data[i * 4] > 0.5) { img.data[i * 4] = 40; img.data[i * 4 + 1] = 90; img.data[i * 4 + 2] = 200; }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  };
  return true;
})()`;

let FZ = 0;
const affine = `const m = await import('/src/game/hallDustInput.js');
  const e = window.__haloRings.entries.find((q) => q.key === 'earth');
  const a = m.hallToGameAffine(e.collider.place, e.collider.registry.halls[0].frame, {});`;
const place = (x, z, nose) => ev(`(async () => {
  ${affine}
  const gx = a.p0x + ${x} * a.ax + ${z} * a.bx, gy = a.p0y + ${x} * a.ay + ${z} * a.by;
  window.DevScene.teleport(gx, gy, Math.atan2(${nose} * a.by, ${nose} * a.bx));
  window.DevScene.syncCamera();
  return true;
})()`);
const measure = (name, png) => ev(`(async () => {
  ${affine}
  const s = window.ship, HD = window.HallDust, sim = HD.sim, dom = HD.domain;
  const hp = m.gameToHall(a, s.pos.x, s.pos.y, {});
  const den = await window.__readTex(sim.denA), vel = await window.__readTex(sim.velA), flag = await window.__readTex(sim.flagT);
  const cells = sim.cellTex.image.data;
  const { w, h } = den;
  const cx = (hp.x - dom.x0) / dom.h;
  let pathAir = 0, pathN = 0;
  const bx0 = Math.max(0, Math.floor((hp.x - 700 - dom.x0) / dom.h)), bx1 = Math.min(w - 1, Math.ceil((hp.x + 700 - dom.x0) / dom.h));
  const bz0 = Math.max(0, Math.floor((${FZ} - 1400 - dom.z0) / dom.h)), bz1 = Math.min(h - 1, Math.ceil((${FZ} - 60 - dom.z0) / dom.h));
  let bAir = 0, bFloor = 0, bVz = 0, bV = 0, bN = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (cells[i * 4 + 2] < 128 || cells[i * 4] > 127 || flag.data[i * 4] > 0.5) continue;
    const air = den.data[i * 4];
    if (Math.abs(x + 0.5 - cx) < 12) { pathAir += air; pathN++; }
    if (x < bx0 || x > bx1 || y < bz0 || y > bz1) continue;
    const vx = vel.data[i * 4], vy = vel.data[i * 4 + 1];
    bAir += air; bFloor += den.data[i * 4 + 1]; bVz += vy; bV += Math.sqrt(vx * vx + vy * vy); bN++;
  }
  const r = { name: ${JSON.stringify(name)}, z: Math.round(hp.z), v: Math.round(Math.hypot(s.vel.x, s.vel.y)),
    korytarz: +(pathAir / Math.max(1, pathN)).toFixed(4),
    brama: { pyl: +(bAir / Math.max(1, bN)).toFixed(4), poklad: +(bFloor / Math.max(1, bN)).toFixed(4),
      vz: Math.round(bVz / Math.max(1, bN) * dom.h), v: Math.round(bV / Math.max(1, bN) * dom.h) },
    stats: { main: HD.stats.main, side: HD.stats.side, zrodla: HD.stats.sources, kadluby: HD.stats.bodies, spi: HD.stats.sleeping } };
  if (${png ? 'true' : 'false'}) { r.pngPyl = window.__fieldPng(den, 0, ${GAIN}, cells, flag); r.pngV = window.__fieldPng(den, 3, 1 / 1500, cells, flag); }
  return r;
})()`);
// zrzut gry z kamerą nad bramą (od środka hali): tryb RTS trzyma kadr, potem powrót kamery statku
const gateShot = async (file) => {
  await ev(`(async () => {
    ${affine}
    const c = window.camera;
    window.__camSave = { mode: c.mode, x: c.x, y: c.y, tx: c.targetX, ty: c.targetY, z: c.zoom, tz: c.targetZoom, zb: c.zoomBase };
    const hx = -810, hz = ${FZ} - 1100;
    c.mode = 'rts'; c.transition = null;
    c.x = c.targetX = a.p0x + hx * a.ax + hz * a.bx; c.y = c.targetY = a.p0y + hx * a.ay + hz * a.by;
    const z = ${Number(args.bramaZoom || 0.22)};
    c.minZoom = Math.min(c.minZoom, z); c.zoom = c.targetZoom = c.zoomBase = z;
    window.DevScene.syncCamera();
    return true;
  })()`);
  await sleep(250);
  await screenshotPng(cdp, file);
  await ev(`(() => { const c = window.camera, S = window.__camSave; c.mode = S.mode; c.transition = null;
    c.x = S.x; c.y = S.y; c.targetX = S.tx; c.targetY = S.ty; c.zoom = S.z; c.targetZoom = S.tz; c.zoomBase = S.zb;
    window.DevScene.syncCamera(); return true; })()`);
};

async function run(tag, memory) {
  const dir = join(out, tag);
  if (FIELDS || SHOTS) mkdirSync(dir, { recursive: true });
  await ev(`(() => {
    const T = window.HallDust.sim.tune, D = ${JSON.stringify({ src: 0.5, clean: 0.9 })};
    window.__memDefault = window.__memDefault || { src: T.srcRelease, clean: T.cleanRelease };
    T.srcRelease = ${memory} ? window.__memDefault.src : 0; T.cleanRelease = ${memory} ? window.__memDefault.clean : 0;
    window.HallDust.sim.syncTune();
    window.HallDustTune.sideJets = ${SIDE};
    return true;
  })()`);
  await place(-810, FZ - 2300, 1);
  await ev('(() => { window.HallDust.sim.requestClear(); return true; })()');
  await sleep(2500);
  await down('w');
  const t0 = Date.now();
  let paused = 0;
  const series = [];
  for (let t = T0; t <= T1 + 1e-6; t += DT) {
    const wait = t * 1000 - (Date.now() - t0 - paused);
    if (wait > 0) await sleep(wait);
    const p0 = Date.now();
    await pause(true);
    await sleep(120);
    const r = await measure('t' + t.toFixed(1), FIELDS);
    if (r.pngPyl) { save(r.pngPyl, join(dir, `pyl-${r.name}.png`)); save(r.pngV, join(dir, `v-${r.name}.png`)); delete r.pngPyl; delete r.pngV; }
    if (SHOTS) await gateShot(join(dir, `gra-${r.name}.png`));
    series.push(r);
    console.log(`[${tag}]`.padEnd(14), r.name.padEnd(6), JSON.stringify({ z: r.z, korytarz: r.korytarz, brama: r.brama }));
    await pause(false);
    paused += Date.now() - p0;
  }
  await up('w');
  await sleep(500);
  report.przebiegi[tag] = series;
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${args.query ? '&' + args.query : ''}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  if (!await ev('!!(window.HallDust && window.HallDust.sim && window.Core3D.renderer)')) throw new Error('pył hal niedostępny na stronie (tryb worker? narzędzie czyta pola z Core3D strony — tryb off)');
  await ev(HELPERS);
  FZ = await ev(`(async () => (await import('/src/3d/haloRing/haloPortK7Layout.js')).createK7Layout().frontZ)()`);
  report.frontZ = FZ;
  if (AB) await run('bez-pamieci', false);
  await run('pamiec', true);
  // podsumowanie: pył i prędkość w prostokącie przy bramie — chwila zgaśnięcia strumienia (największy spadek |v|) i dalej
  report.podsumowanie = {};
  for (const [tag, s] of Object.entries(report.przebiegi)) {
    let k = 1;
    for (let i = 1; i < s.length; i++) if (s[i].brama.v - s[i - 1].brama.v < s[k].brama.v - s[k - 1].brama.v) k = i;
    const at = (dt) => s[Math.min(s.length - 1, Math.max(0, k - 1 + Math.round(dt / DT)))];
    report.podsumowanie[tag] = { zgasniecie: s[k - 1].name, przed: s[k - 1].brama, po06: at(0.6).brama, po14: at(1.4).brama };
  }
  console.log('podsumowanie:', JSON.stringify(report.podsumowanie));
} catch (e) {
  console.error('BŁĄD', e);
  report.fatal = String(e?.stack || e);
} finally {
  report.bledy = logs.errors();
  console.log('błędy konsoli:', report.bledy.length, report.bledy.slice(0, 8));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
