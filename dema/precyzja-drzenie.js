// Pomiar drżenia efektów 3D względem kadłuba przy współrzędnych świata jak
// w grze (5–10 mln j.) — moduły z pozycjami świata w danych instancji:
//   lights   — światła pozycyjne (src/3d/shipLights3D.js)
//   windows  — szczeliny okien mostka (src/3d/bridgeFx3D.js)
//   exhaust  — dysze (src/3d/engineExhaustBatch.js)
//   impostor — smugi dalekich / zimnych wraków (src/3d/hexBodyImpostorBatch.js)
//   fx       — wspólny bank cząstek Fx3D (src/3d/fxParticles3D.js)
//   bullets  — pociski: smuga, rdzeń, łuki jonowe (src/3d/weapon3DSystem.js)
//   muzzle   — tani błysk wylotowy przy lufie (src/3d/weapon3DSystem.js)
//   trails   — smuga gazu pocisku Yamato (src/3d/slugTrail3D.js, BulletTrails)
//   sparks   — iskry trafień i tarcia (src/3d/sparkSystem3D.js, scena overlay)
// Metoda i demo jak w dema/mostki3d-drzenie.js (model mostka, §8.12
// docs/PORT-mostki.md): demo mostków w headless Chrome przez CDP, kamera co
// klatkę o DOKŁADNIE 1 px po przekątnej, kadłub schowany (`--hull-depth`:
// sama głębia), bloom/promienie/żar/tło off, jasność = RGB × alfa. W każdej
// klatce moduł wył. i wł. (przełącznik chowa jego meshe tuż przed
// Core3D.render, pozostałe badane moduły są schowane zawsze) — Lucas–Kanade
// liczy przesunięcie SAMEGO wkładu modułu (różnica klatek), więc gwiazdy dema
// z paralaksą nie wchodzą. Drżenie = reszty po odjęciu stałego dryfu: pass FG
// (światła, okna) ma kamerę perspektywiczną i z = 12–13 jedzie ~1,9% szybciej
// niż kadłub. Iskry żyją na scenie overlay (kamera patrzy w −Y, płaszczyzna
// XZ): osobna scena renderowana tym samym rendererem Core3D, kamera jak w
// src/effects3d/overlay.js.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/precyzja-drzenie.js
//   node ... dema/precyzja-drzenie.js --variant po --modules lights,fx --frames 24
//   node ... dema/precyzja-drzenie.js --only fx_7M_z1.8
//
// Wariant „przed”: kopie modułów sprzed poprawki precyzji z
// .tmp/precyzja/przed/<moduł>.orig.js podawane aliasem Vite (resolve.alias)
// — pliki w drzewie zostają nietknięte (inne sesje edytują równolegle).
// Efekty w pomiarze stoją: Fx3D.update z dt = 0, dysze po rozbiegu (wygładzanie
// ciągu idzie per wywołanie), błysk wylotowy odpalany co klatkę (stała suma
// gasnących błysków; kadłuby dema nie mają wieżyczek, więc Turret2D.triggerShot
// oddaje na ten czas stałą lufę), smuga po zniknięciu pocisku z zamrożonym
// zegarem. Bloom wyłączony WPROST (bloomPass.enabled): sam zapis
// perfToggles.bloom = false go nie wyłącza, a piramida bloomu (×2) dawała
// jasnym efektom wzór co 2 px przesunięcia i rozlewała błysk na pół ekranu.
// `--bloom` zostawia go włączonego.
//
// Wyniki: .tmp/precyzja/drzenie/<wariant>_<przypadek>.png (klatka 0),
// ..._roznica.png (czerwony jaśniej, zielony ciemniej, niebieski — maska),
// drzenie.json.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repo, args.out || '.tmp/precyzja/drzenie');
mkdirSync(outDir, { recursive: true });
const W = 1600;
const H = 900;
const FRAMES = Math.max(4, Number(args.frames) || 16);
const only = args.only ? new Set(args.only.split(',')) : null;
const modulesArg = args.modules ? new Set(args.modules.split(',')) : null;
const variants = (args.variant && args.variant !== 'obie') ? [args.variant] : ['przed', 'po'];

// Moduły podmieniane w wariancie „przed” (nazwa pliku w src/3d/).
const PRZED_FILES = ['shipLights3D', 'bridgeFx3D', 'engineExhaustBatch', 'hexBodyImpostorBatch', 'fxParticles3D',
  'weapon3DSystem', 'sparkSystem3D', 'slugTrail3D'];
const przedDir = resolve(repo, '.tmp/precyzja/przed');
// Pliki w toku u innych sesji — w OBU wariantach wersja z HEAD (alias), żeby
// cudza praca w toku nie psuła pomiaru. `--pin none` wyłącza.
const PIN_HEAD = args.pin === 'none' ? [] : (args.pin ? args.pin.split(',') : ['src/3d/engineVfxSystem.js']);
const pinDir = resolve(repo, '.tmp/precyzja/pin');

// Start gracza w grze leży ok. (7,08 mln; 6,29 mln); 9,9 mln — krok float32 = 1 j.
const FAR_7M = [7075238.77, 6289731.51];
const FAR_99M = [9874885.3, 8289731.4];
const MODULES = ['lights', 'windows', 'exhaust', 'impostor', 'fx', 'bullets', 'muzzle', 'trails', 'sparks'];
const HULL_OF = { lights: 'atlas', muzzle: 'atlas' };
// Zoom 1,8 / 0,9: krok kamery 1 px = 0,556 / 1,111 j. — niewspółmierny z siatką
// float32 (0,5 j. przy 7 mln), jak ruch kamery w grze. Przy zoomie 2 krok
// 0,5 j. trafia w siatkę i błąd samego zaokrąglenia kamery stoi w miejscu
// (zostaje tylko ta część, którą GPU składa w NDC) — przypadek z §8.12.
const CASES = [];
for (const mod of MODULES) {
  const hull = HULL_OF[mod] || 'battleship';
  CASES.push({ id: `${mod}_0_z1.8`, module: mod, hull, zoom: 1.8 });
  CASES.push({ id: `${mod}_7M_z1.8`, module: mod, hull, zoom: 1.8, far: FAR_7M });
  CASES.push({ id: `${mod}_7M_z0.9`, module: mod, hull, zoom: 0.9, far: FAR_7M });
  CASES.push({ id: `${mod}_9.9M_z1.8`, module: mod, hull, zoom: 1.8, far: FAR_99M });
  CASES.push({ id: `${mod}_7M_z2`, module: mod, hull, zoom: 2, far: FAR_7M });
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find((p) => existsSync(p));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) fail(new Error(JSON.stringify(msg.error)));
        else ok(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  on(fn) { this.handlers.push(fn); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(cdp, expression, timeout = 240000) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}

// Kopia leży w .tmp/ — względne importy przepisane na ścieżki od korzenia
// Vite (tak, jakby plik stał w `rel`).
function rootImports(src, rel) {
  const dir = '/' + posix.dirname(rel);
  return src.replace(/(from\s+|import\()'(\.{1,2}\/[^']+)'/g, (m, head, spec) => `${head}'${posix.join(dir, spec)}'`);
}

function preparePrzed() {
  for (const m of PRZED_FILES) {
    const orig = join(przedDir, `${m}.orig.js`);
    if (!existsSync(orig)) throw new Error(`brak kopii „przed”: ${orig}`);
    writeFileSync(join(przedDir, `${m}.przed.js`), rootImports(readFileSync(orig, 'utf8'), `src/3d/${m}.js`));
  }
  return PRZED_FILES.map((m) => ({ find: new RegExp(`^.*\\/${m}\\.js$`), replacement: `/.tmp/precyzja/przed/${m}.przed.js` }));
}

function preparePins() {
  mkdirSync(pinDir, { recursive: true });
  return PIN_HEAD.map((rel) => {
    const name = posix.basename(rel, '.js');
    const src = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
    writeFileSync(join(pinDir, `${name}.head.js`), rootImports(src, rel));
    return { find: new RegExp(`^.*\\/${name}\\.js$`), replacement: `/.tmp/precyzja/pin/${name}.head.js` };
  });
}

// --- w stronie: analiza klatek (wspólna dla sond) ------------------------------
// frames[k] = jasność samego modułu w oknie odczytu przesuniętym o k px (obraz
// rysowany precyzyjnie jest wtedy identyczny), firstImg — pełna klatka 0.
function analyze(frames, firstImg, RW, RH) {
  const L0 = frames[0];
  const mask = new Uint8Array(RW * RH);
  let maskN = 0;
  for (let y = 2; y < RH - 2; y++) {
    for (let x = 2; x < RW - 2; x++) {
      const i = y * RW + x;
      let any = false;
      for (let dy = -1; dy <= 1 && !any; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(L0[i + dy * RW + dx]) > 4) { any = true; break; }
        }
      }
      if (any) { mask[i] = 1; maskN++; }
    }
  }
  const sample = (L, x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const at = (xx, yy) => L[Math.max(0, Math.min(RH - 1, yy)) * RW + Math.max(0, Math.min(RW - 1, xx))];
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  const res = [];
  for (let k = 1; k < frames.length; k++) {
    const Lk = frames[k];
    // Najpierw przesunięcie całkowite (SSD), potem Lucas–Kanade: Lk(x + δ) ≈ L0(x).
    let best = [0, 0];
    let bestE = Infinity;
    for (let oy = -3; oy <= 3; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        let e = 0;
        for (let y = 4; y < RH - 4; y++) {
          for (let x = 4; x < RW - 4; x++) {
            const i = y * RW + x;
            if (!mask[i]) continue;
            const d = Lk[(y + oy) * RW + x + ox] - L0[i];
            e += d * d;
          }
        }
        if (e < bestE) { bestE = e; best = [ox, oy]; }
      }
    }
    let dx = best[0];
    let dy = best[1];
    for (let it = 0; it < 6; it++) {
      let a = 0; let b = 0; let cc = 0; let ex = 0; let ey = 0;
      for (let y = 4; y < RH - 4; y++) {
        for (let x = 4; x < RW - 4; x++) {
          const i = y * RW + x;
          if (!mask[i]) continue;
          const gx = (sample(Lk, x + dx + 1, y + dy) - sample(Lk, x + dx - 1, y + dy)) * 0.5;
          const gy = (sample(Lk, x + dx, y + dy + 1) - sample(Lk, x + dx, y + dy - 1)) * 0.5;
          const e = sample(Lk, x + dx, y + dy) - L0[i];
          a += gx * gx; b += gx * gy; cc += gy * gy; ex += gx * e; ey += gy * e;
        }
      }
      const det = a * cc - b * b;
      if (Math.abs(det) < 1e-9) break;
      const ux = (cc * ex - b * ey) / det;
      const uy = (a * ey - b * ex) / det;
      dx -= ux; dy -= uy;
      if (Math.hypot(ux, uy) < 1e-3) break;
    }
    let mad = 0;
    let n = 0;
    for (let y = 4; y < RH - 4; y++) {
      for (let x = 4; x < RW - 4; x++) {
        const i = y * RW + x;
        if (!mask[i]) continue;
        mad += Math.abs(Lk[i] - L0[i]);
        n++;
      }
    }
    res.push({ k, dx: +dx.toFixed(3), dy: +dy.toFixed(3), mad: +(mad / Math.max(1, n)).toFixed(3) });
  }
  const mags = res.map((r) => Math.hypot(r.dx, r.dy));
  // Skok między kolejnymi klatkami — to oko widzi jako drżenie.
  const steps = res.map((r, i) => (i ? Math.hypot(r.dx - res[i - 1].dx, r.dy - res[i - 1].dy) : mags[0]));
  // Stały dryf (px na klatkę) to nie drżenie: pass FG ma kamerę
  // perspektywiczną, więc z = 12–13 przesuwa się o ~1,9% szybciej niż kadłub
  // (paralaksa). Prosta przez (0, 0) metodą najmniejszych kwadratów, reszty = drżenie.
  let kk = 0; let kx = 0; let ky = 0;
  for (const r of res) { kk += r.k * r.k; kx += r.k * r.dx; ky += r.k * r.dy; }
  const vx = kx / kk;
  const vy = ky / kk;
  const resid = res.map((r) => Math.hypot(r.dx - vx * r.k, r.dy - vy * r.k));
  const summary = {
    maskPx: maskN,
    shiftRmsPx: +Math.sqrt(mags.reduce((q, v) => q + v * v, 0) / mags.length).toFixed(3),
    shiftMaxPx: +Math.max(...mags).toFixed(3),
    stepMaxPx: +Math.max(...steps).toFixed(3),
    driftPxPerFrame: [+vx.toFixed(4), +vy.toFixed(4)],
    jitterRmsPx: +Math.sqrt(resid.reduce((q, v) => q + v * v, 0) / resid.length).toFixed(3),
    jitterMaxPx: +Math.max(...resid).toFixed(3),
    madMean: +(res.reduce((q, r) => q + r.mad, 0) / res.length).toFixed(3)
  };
  const cv = document.createElement('canvas');
  cv.width = RW;
  cv.height = RH;
  const cx = cv.getContext('2d');
  const d0 = firstImg.data;
  for (let j = 0; j < d0.length; j += 4) {
    const al = d0[j + 3] / 255;
    d0[j] *= al; d0[j + 1] *= al; d0[j + 2] *= al; d0[j + 3] = 255;
  }
  cx.putImageData(firstImg, 0, 0);
  const png = cv.toDataURL('image/png').split(',')[1];
  const Ln = frames[frames.length - 1];
  const dimg = new ImageData(RW, RH);
  for (let j = 0; j < Ln.length; j++) {
    const d = Ln[j] - L0[j];
    dimg.data[j * 4] = d > 0 ? Math.min(255, d * 8) : 0;
    dimg.data[j * 4 + 1] = d < 0 ? Math.min(255, -d * 8) : 0;
    dimg.data[j * 4 + 2] = mask[j] ? 90 : 0;
    dimg.data[j * 4 + 3] = 255;
  }
  cx.putImageData(dimg, 0, 0);
  const diff = cv.toDataURL('image/png').split(',')[1];
  return { summary, frames: res, png, diff };
}

// --- w stronie dema: moduły sceny Core3D --------------------------------------
async function probe(opts, analyze) {
  const { Core3D } = await import('/src/3d/core3d.js');
  const api = window.__mostki;
  const Fx = window.Fx3D;
  // Jak w §8.12: zapis do perfToggles wyłącza to, co render() czyta wprost
  // (promienie, żar). bloomPass.enabled ustawia dopiero _applyPassToggles,
  // więc bloom zostawał włączony — jego piramida (×2) dawała wzór co 2 px
  // przesunięcia. Wyłączony wprost; setPerfToggles z bgPass: false zatrzymuje
  // w demie odświeżanie klatki, więc tego nie ruszamy (pass tła rysuje gwiazdy
  // dema przy zerze — pomiar i tak bierze tylko różnicę wł./wył. modułu).
  const T = Core3D.perfToggles;
  for (const k of ['bloom', 'shadowShafts', 'heatHaze', 'bgPass', 'planetPass']) T[k] = false;
  if (Core3D.bloomPass) Core3D.bloomPass.enabled = !!opts.bloom;

  // Meshe modułów rozpoznawane po nazwie / sygnaturze shadera / kolejności
  // rysowania — działa dla obu wariantów (kopia „przed” to inna instancja
  // modułu, ten sam wygląd).
  const vs = (o) => (typeof o.material?.vertexShader === 'string' ? o.material.vertexShader : '');
  const MATCH = {
    lights: (o) => o.isInstancedMesh && o.name !== 'BRIDGE_WINDOWS' && !!o.material?.uniforms?.uTime && !!o.material?.uniforms?.uCoreGain && vs(o).includes('attribute vec3 aParams'),
    windows: (o) => o.name === 'BRIDGE_WINDOWS',
    exhaust: (o) => o.isMesh && vs(o).includes('attribute vec2 aPos') && (vs(o).includes('attribute vec2 aFlame') || (!!o.material?.uniforms?.uMap && vs(o).includes('attribute float aOpacity') && !vs(o).includes('aRot'))),
    impostor: (o) => o.isMesh && vs(o).includes('attribute vec2 aPos') && vs(o).includes('attribute float aRot') && vs(o).includes('attribute float aOpacity') && !vs(o).includes('aFlame'),
    fx: (o) => typeof o.name === 'string' && o.name.startsWith('FX3D_'),
    // weapon3DSystem: pociski 78–81, błyski wylotowe 82–83 (MeshBasicMaterial).
    bullets: (o) => o.isInstancedMesh && o.renderOrder >= 78 && o.renderOrder <= 81 && !!o.material?.isMeshBasicMaterial,
    muzzle: (o) => o.isInstancedMesh && (o.renderOrder === 82 || o.renderOrder === 83) && !!o.material?.isMeshBasicMaterial,
    trails: (o) => o.name === 'BULLET_SLUG_TRAILS__WORLD_SPACE'
  };
  const find = (mod) => {
    const out = [];
    Core3D.scene.traverse((o) => { if (MATCH[mod](o)) out.push(o); });
    return out;
  };

  // Przełącznik: chowa meshe tuż przed renderem (moduły ustawiają visible
  // same w update, więc wcześniej by nie zadziałało). onRender — strzał co
  // klatkę dla błysku wylotowego.
  if (!Core3D.__precyzjaRender) {
    const orig = Core3D.render;
    Core3D.__precyzjaRender = orig;
    Core3D.render = function (...a) {
      const cfg = window.__precyzjaHide;
      if (cfg) {
        for (const m of cfg.others) m.visible = false;
        if (cfg.off) for (const m of cfg.target) m.visible = false;
        for (const m of cfg.hulls) m.visible = false;
      }
      const r = orig.apply(this, a);
      if (typeof window.__precyzjaOnRender === 'function') window.__precyzjaOnRender();
      return r;
    };
  }
  // Cząstki stoją: syncProjectiles daje co klatkę dt ≥ 1 ms.
  if (Fx && !Fx.__precyzjaUpdate) {
    const origUpdate = Fx.update;
    Fx.__precyzjaUpdate = origUpdate;
    Fx.update = function (dt) { return origUpdate.call(this, window.__precyzjaFreezeFx ? 0 : dt); };
  }
  window.__precyzjaHide = null;
  window.__precyzjaFreezeFx = false;
  window.__precyzjaOnRender = null;

  api.clock.paused = true;
  api.setup({ hull: opts.hull, spin: 0, drift: 0, shield: false,
    overlays: { grid: false, hardpoints: false, bridgeHexes: false, zone: false, aim: false, info: false } });
  api.model3d(false);
  if (Fx?.ready) Fx.reset();
  window.BulletTrails?.reset?.();
  const t = api.sim.targets.find((e) => e.hullKey === opts.hull);
  const sun = window.SUN;
  const sun0 = sun ? { x: sun.x, y: sun.y } : null;
  if (opts.far) {
    // Słońce jedzie ze statkiem — to samo oświetlenie co przy zerze.
    const dx = opts.far[0] - t.x;
    const dy = opts.far[1] - t.y;
    t.x += dx; t.y += dy;
    if (sun) { sun.x += dx; sun.y += dy; }
  }
  const devTuning0 = window.DevTuning;
  if (opts.module === 'impostor') {
    // Smuga przy dużym zoomie — tak zimny wrak rysuje się ZAWSZE.
    t.isWreck = true;
    window.DevTuning = Object.assign({}, devTuning0 || {}, { wreckImpostorPx: 1e9 });
  }
  api.renderFrames(2);            // kamera dema jedzie za przesuniętym celem
  api.cam.x = t.x; api.cam.y = t.y; api.cam.zoom = opts.zoom;
  api.renderFrames(150);          // rozbieg: wygładzanie ciągu dysz (lerp per klatka)

  let center = null;
  let note = '';
  const cleanup = [];
  if (opts.module === 'fx') {
    // Statyczny zestaw cząstek przy środku kadłuba: bilboardy, jęzor, krzyż,
    // rozlanie, iskry, łuk. Bez wzrostu, zmiany barwy i wygaszania w czasie.
    Fx.ensure();
    const fc = { x: t.x + 30, y: t.y - 20 };
    center = [fc.x, fc.y];
    const Z = 15;
    const at = (dx, dy, z = Z) => ({ x: fc.x + dx, y: -(fc.y + dy), z });
    const bb = (sys, dx, dy, size, col, alpha) => {
      const p = at(dx, dy);
      sys.spawn({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 10, drag: 0, s0: size, s1: size, rot: 0.4, vrot: 0,
        r0: col[0], g0: col[1], b0: col[2], r1: col[0], g1: col[1], b1: col[2], mix: 1, alpha, fadeIn: 0.002, fadeOut: 0, grow: 1 });
    };
    bb(Fx.glow, -40, -30, 14, [2.2, 1.6, 0.9], 0.9);
    bb(Fx.glow, 25, 18, 9, [0.8, 1.4, 2.4], 0.9);
    bb(Fx.vapor, -10, 30, 26, [0.5, 0.55, 0.7], 0.5);
    bb(Fx.smoke, 45, -35, 22, [0.3, 0.3, 0.32], 0.8);
    bb(Fx.star, 0, 0, 30, [2.0, 1.8, 1.4], 0.8);
    const dir = (a) => ({ x: Math.cos(a), y: Math.sin(a), z: 0 });
    Fx.plume.spawn(at(-55, 10), dir(0.3), 10, 60, 60, 12, 12, [1.2, 0.9, 0.5], 0.9);
    Fx.cross.spawn(at(35, -5), dir(-0.6), 10, 40, 40, 8, 8, [1.6, 1.4, 1.0], 0.8);
    Fx.wash.spawn(at(-20, -50, 2), dir(1.9), 10, 50, 50, 20, 20, [0.9, 0.7, 0.4], 0.7);
    // Iskry lecą 1 s wieku (niżej) — start cofnięty o drogę, żeby stanęły tu.
    for (let i = 0; i < 12; i++) {
      const a = i * 0.52;
      const v = { x: Math.cos(a) * 400, y: Math.sin(a) * 400, z: 0 };
      const p = at(15 + Math.cos(a) * 20, 45 + Math.sin(a) * 12);
      p.x -= v.x; p.y -= v.y;
      Fx.spark.spawn(p, v, 10, 0, 9, [3.0, 2.1, 1.0], 0.3, 0.06);
    }
    Fx.arcs.spawn(at(-60, 45), at(-15, 60), 10, 6, [1.4, 1.8, 3.0]);
    // Wiek 1 s (alfa w pełni, łuk i iskry na miejscu), potem stop.
    for (let i = 0; i < 10; i++) Fx.__precyzjaUpdate.call(Fx, 0.1);
  } else if (opts.module === 'bullets') {
    // Pociski stoją (symulacja w pauzie): trzy style, w tym łuki jonowe.
    const bc = { x: t.x - 40, y: t.y + 25 };
    center = [bc.x, bc.y];
    const mk = (key, dx, dy, ang, speed) => {
      const vx = Math.cos(ang) * speed;
      const vy = Math.sin(ang) * speed;
      const x = bc.x + dx;
      const y = bc.y + dy;
      return { x, y, px: x - vx * 0.016, py: y - vy * 0.016, vx, vy, life: 100, vfxKey: key, weaponId: key, owner: 'player', r: 2 };
    };
    const list = [mk('vulcan', -50, -30, 0.4, 3200), mk('helios', 20, -45, -0.9, 2600), mk('tempest', -10, 20, 2.3, 3600), mk('vulcan', 55, 35, 1.7, 2900)];
    api.sim.bullets.push(...list);
    cleanup.push(() => { for (const b of list) { const i = api.sim.bullets.indexOf(b); if (i >= 0) api.sim.bullets.splice(i, 1); } });
  } else if (opts.module === 'muzzle') {
    // Kadłuby dema nie mają wieżyczek, więc na czas pomiaru Turret2D.triggerShot
    // oddaje stałą lufę; dalej prawdziwa ścieżka weapon3DSystem
    // (MuzzleFX3D.fire → spawnMuzzleFlash dla broni bez „bogatego” błysku).
    // Strzał co klatkę: stała suma gasnących błysków (pula 192, najstarszy
    // nadpisywany) — obraz ustalony po rozbiegu.
    const T2 = window.Turret2D;
    const muzzle = { x: t.x + 40, y: t.y - 20, angle: 0.7, scale: 1.6, color: '#ffc766', shake: 0 };
    const trigger0 = T2.triggerShot;
    T2.triggerShot = () => muzzle;
    cleanup.push(() => { T2.triggerShot = trigger0; });
    window.__precyzjaOnRender = () => {
      window.dispatchEvent(new CustomEvent('game_weapon_fired', { detail: { weaponId: 'vulcan', x: muzzle.x, y: muzzle.y, shooter: t } }));
    };
    api.renderFrames(260);
    // Materiał błysku ma vertexColors: true, a PlaneGeometry nie ma atrybutu
    // color — barwa bierze przypadkową wartość domyślną atrybutu WebGL (tu
    // czerń). Tylko w pomiarze: sama barwa instancji, jak w pociskach.
    Core3D.scene.traverse((o) => {
      if (MATCH.muzzle(o) && o.material.vertexColors) { o.material.vertexColors = false; o.material.needsUpdate = true; }
    });
    note = 'vertexColors wył. w pomiarze';
    center = [muzzle.x + 12, muzzle.y + 10];
  } else if (opts.module === 'trails') {
    // Pocisk Yamato przelatuje po przekątnej i znika — smuga zostaje; potem
    // zegar banku stop (wiek, dryf i meandry gazu stoją). Okno na KOŃCU smugi:
    // wzdłuż jednolitej wstęgi przesunięcia nie widać (problem apertury).
    const d = Math.SQRT1_2;
    const x0 = t.x - 1100;
    const y0 = t.y - 1100;
    const b = { x: x0, y: y0, px: x0 - 150 * d, py: y0 - 150 * d, vx: 9000 * d, vy: 9000 * d, life: 100, vfxKey: 'special_yamato', weaponId: 'special_yamato', owner: 'player', r: 3 };
    api.sim.bullets.push(b);
    for (let i = 0; i < 20; i++) { b.px = b.x; b.py = b.y; b.x += 150 * d; b.y += 150 * d; api.renderFrames(1); }
    const endX = b.x;
    const endY = b.y;
    const i = api.sim.bullets.indexOf(b);
    if (i >= 0) api.sim.bullets.splice(i, 1);
    api.renderFrames(1);          // endFrame domyka smugę
    center = [endX - 40 * d, endY - 40 * d];
  }
  window.__precyzjaFreezeFx = true;
  api.renderFrames(2);

  // Kadłub schowany całkiem (w §8.12 zostawała głębia pod cień modelu; tu nic
  // na niej nie leży, a płomień dysz jest POD kadłubem, z = −5). `--hull-depth`
  // zostawia głębię.
  const hidden = [];
  const hulls = [];
  Core3D.scene.traverse((o) => {
    const m = o.material;
    if (o.isMesh && m && m.uniforms && (m.uniforms.uStressTint || m.uniforms.uLacquerEye)) {
      hulls.push(o);
      if (m.colorWrite !== false) { m.colorWrite = false; hidden.push(m); }
    }
  });

  const MODS = Object.keys(MATCH);
  const target = find(opts.module);
  const others = [];
  for (const m of MODS) if (m !== opts.module) others.push(...find(m));
  window.__precyzjaHide = { target, others, hulls: opts.hullDepth ? [] : hulls, off: false };

  // Punkt kadru: skupisko instancji modułu (pozycja = mesh.position + dane,
  // tak samo w obu wariantach), dla smugi wraku — jej koniec (krawędź elipsy).
  const RW = 360;
  const RH = 260;
  const pts = [];
  let tip = null;
  if (!center) {
    for (const m of target) {
      if (!m.visible) continue;
      const ox = m.position.x;
      const oy = m.position.y;
      if (m.isInstancedMesh) {
        const a = m.instanceMatrix.array;
        for (let i = 0; i < m.count; i++) pts.push([ox + a[i * 16 + 12], -(oy + a[i * 16 + 13])]);
      } else if (opts.module === 'exhaust' && vs(m).includes('aFlame')) {
        const a = m.geometry.getAttribute('aPos').array;
        for (let i = 0; i < m.geometry.instanceCount; i++) pts.push([ox + a[i * 2], -(oy + a[i * 2 + 1])]);
      } else if (opts.module === 'impostor') {
        const g = m.geometry;
        const a = g.getAttribute('aPos').array;
        const s = g.getAttribute('aSize').array;
        const r = g.getAttribute('aRot').array;
        if (g.instanceCount > 0) {
          const hx = s[0] * 0.5;
          tip = [ox + a[0] + Math.cos(r[0]) * hx, -(oy + a[1] + Math.sin(r[0]) * hx)];
        }
      }
    }
    if (tip) center = tip;
    else if (pts.length) {
      const hx = (RW * 0.4) / opts.zoom;
      const hy = (RH * 0.4) / opts.zoom;
      let best = -1;
      for (const p of pts) {
        let n = 0; let sx = 0; let sy = 0;
        for (const q of pts) if (Math.abs(q[0] - p[0]) <= hx && Math.abs(q[1] - p[1]) <= hy) { n++; sx += q[0]; sy += q[1]; }
        if (n > best) { best = n; center = [sx / n, sy / n]; }
      }
    }
  }
  let instances = 0;
  for (const m of target) {
    if (m.isInstancedMesh) instances += m.visible ? m.count : 0;
    else if (m.geometry?.isInstancedBufferGeometry) instances += m.visible ? m.geometry.instanceCount : 0;
    else if (m.visible) instances += 1;
  }
  const restore = () => {
    for (const m of hidden) m.colorWrite = true;
    window.__precyzjaHide = null;
    window.__precyzjaFreezeFx = false;
    window.__precyzjaOnRender = null;
    for (const f of cleanup) f();
    if (opts.module === 'impostor') { t.isWreck = false; window.DevTuning = devTuning0; }
    if (sun && sun0) { sun.x = sun0.x; sun.y = sun0.y; }
  };
  if (!center || !target.length) {
    restore();
    return { summary: { error: 'brak zawartości modułu', meshes: target.length, instances, note } };
  }
  api.cam.x = center[0];
  api.cam.y = center[1];
  api.cam.zoom = opts.zoom;
  api.renderFrames(2);

  const c = document.getElementById('c');
  const g = c.getContext('2d', { willReadFrequently: true });
  const R = { x: Math.round(c.width / 2 - RW / 2), y: Math.round(c.height / 2 - RH / 2) };
  const lumOf = (d) => {
    const L = new Float32Array(RW * RH);
    for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * d[i + 3] / 255;
    return L;
  };
  const base = { x: api.cam.x, y: api.cam.y };
  api.renderFrames(1);
  // Gdzie siedzi mesh modułu (po poprawce: przy kamerze; przed: w zerze).
  const meshPos = [+target[0].position.x.toFixed(2), +target[0].position.y.toFixed(2)];
  const pos64 = Fx?.glow?.p?.f?.pos instanceof Float64Array;
  // W każdej klatce moduł wył. i wł. — mierzymy SAM wkład modułu (różnicę),
  // więc tło z paralaksą (gwiazdy dema) i reszta sceny nie wchodzą do pomiaru.
  const frames = [];
  let firstImg = null;
  for (let k = 0; k < opts.frames; k++) {
    api.cam.x = base.x + k / opts.zoom;
    api.cam.y = base.y + k / opts.zoom;
    window.__precyzjaHide.off = true; api.renderFrames(1);
    const Loff = lumOf(g.getImageData(R.x - k, R.y - k, RW, RH).data);
    window.__precyzjaHide.off = false; api.renderFrames(1);
    const img = g.getImageData(R.x - k, R.y - k, RW, RH);
    const Lk = lumOf(img.data);
    if (!firstImg) firstImg = img;
    for (let i = 0; i < Lk.length; i++) Lk[i] -= Loff[i];
    frames.push(Lk);
  }
  restore();
  const out = analyze(frames, firstImg, RW, RH);
  Object.assign(out.summary, { shipX: t.x, shipY: t.y, camX: base.x, camY: base.y, meshes: target.length, instances, meshPos, fxPos64: pos64, note });
  return out;
}

// --- w stronie dema: iskry na scenie w układzie overlay -------------------------
// SparkSystem3D rysuje w grze scena overlay (src/effects3d/overlay.js): kamera
// ortho w (x, 120, y) patrzy w dół −Y, iskry leżą w XZ. Tu osobna scena
// renderowana rendererem Core3D (bez nowego renderera), Core3D.activeCam1 =
// kamera dema — z niej poprawiony moduł bierze początek puli.
async function probeSparks(opts, analyze) {
  const { Core3D } = await import('/src/3d/core3d.js');
  // Ten sam URL three, który załadowała strona (goły 'three' w kodzie z CDP
  // się nie rozwiąże, a inny URL = druga kopia biblioteki).
  const names = performance.getEntriesByType('resource').map((e) => e.name);
  const threeUrl = names.find((n) => /\/node_modules\/\.vite\/deps\/three\.js(\?|$)/.test(n))
    || names.find((n) => /\/node_modules\/three\/build\/three\.module\.js(\?|$)/.test(n));
  if (!threeUrl) return { summary: { error: 'nie znaleziono modułu three strony', meshes: 0, instances: 0, note: '' } };
  const THREE = await import(threeUrl);
  const { SparkSystem3D } = await import(opts.sparkUrl);
  const api = window.__mostki;
  api.clock.paused = true;
  const renderer = Core3D.renderer;
  const cv = renderer.domElement;
  const Wc = cv.width;
  const Hc = cv.height;
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-Wc / (2 * opts.zoom), Wc / (2 * opts.zoom), Hc / (2 * opts.zoom), -Hc / (2 * opts.zoom), -1000, 1000);
  cam.up.set(0, 0, -1);
  if (SparkSystem3D.isInitialized) SparkSystem3D.dispose();
  SparkSystem3D.init(scene);
  const c0 = opts.far ? { x: opts.far[0], y: opts.far[1] } : { x: 30, y: -20 };
  const setCam = (x, y) => {
    api.cam.x = x; api.cam.y = y; api.cam.zoom = opts.zoom;   // = Core3D.activeCam1
    cam.position.set(x, 120, y);
    cam.lookAt(x, 0, y);
    cam.updateMatrixWorld();
  };
  setCam(c0.x, c0.y);
  // Snop iskier przy środku kadru; wiek ~1/3 życia, potem zegar stoi.
  for (let i = 0; i < 48; i++) {
    const a = i * 0.37;
    const sp = 110 + (i % 5) * 35;
    SparkSystem3D.emit(c0.x + Math.cos(a * 1.7) * 30, c0.y + Math.sin(a * 2.3) * 22, Math.cos(a) * sp, Math.sin(a) * sp, 0.9, 0.35 + (i % 4) * 0.12);
  }
  SparkSystem3D.update(0.3);
  let mesh = null;
  scene.traverse((o) => { if (o.isMesh) mesh = o; });
  const RW = 360;
  const RH = 260;
  const R = { x: Math.round(Wc / 2 - RW / 2), y: Math.round(Hc / 2 - RH / 2) };
  const g2 = document.createElement('canvas');
  g2.width = Wc; g2.height = Hc;
  const g = g2.getContext('2d', { willReadFrequently: true });
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevTarget = renderer.getRenderTarget();
  const draw = (visible) => {
    SparkSystem3D.update(0);
    mesh.visible = visible && mesh.visible;
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, Wc / renderer.getPixelRatio(), Hc / renderer.getPixelRatio());
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = true;
    renderer.render(scene, cam);
    g.clearRect(0, 0, Wc, Hc);
    g.drawImage(cv, 0, 0);
  };
  const lumOf = (d) => {
    const L = new Float32Array(RW * RH);
    for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * d[i + 3] / 255;
    return L;
  };
  const frames = [];
  let firstImg = null;
  for (let k = 0; k < opts.frames; k++) {
    setCam(c0.x + k / opts.zoom, c0.y + k / opts.zoom);
    draw(false);
    const Loff = lumOf(g.getImageData(R.x - k, R.y - k, RW, RH).data);
    draw(true);
    const img = g.getImageData(R.x - k, R.y - k, RW, RH);
    const Lk = lumOf(img.data);
    if (!firstImg) firstImg = img;
    for (let i = 0; i < Lk.length; i++) Lk[i] -= Loff[i];
    frames.push(Lk);
  }
  const meshPos = [+mesh.position.x.toFixed(2), +mesh.position.z.toFixed(2)];
  SparkSystem3D.dispose();
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
  renderer.setRenderTarget(prevTarget);
  const out = analyze(frames, firstImg, RW, RH);
  Object.assign(out.summary, { shipX: c0.x, shipY: c0.y, camX: c0.x, camY: c0.y, meshes: 1, instances: 48, meshPos, fxPos64: null, note: '' });
  return out;
}

// --- przebieg -----------------------------------------------------------------
const dbgPort = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(tmpdir(), 'precyzja-drzenie-' + Date.now())}`,
  '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl',
  '--disable-gpu-vsync', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'
], { stdio: 'ignore' });
const logs = [];
const results = [];
let ws;
try {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()).find((x) => x.type === 'page'); } catch { /* Chrome jeszcze wstaje */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('Chrome nie wystartował');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  const cdp = new Cdp(ws);
  let variantNow = '';
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[${variantNow}][wyjątek] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') logs.push(`[${variantNow}][błąd] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 600));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  const pins = preparePins();
  if (pins.length) console.log(`przypięte do HEAD (oba warianty): ${PIN_HEAD.join(', ')}`);
  for (const variant of variants) {
    variantNow = variant;
    const alias = [...pins, ...(variant === 'przed' ? preparePrzed() : [])];
    const server = await createServer({ root: repo, logLevel: 'error', server: { port: 5292, strictPort: false }, resolve: { alias } });
    await server.listen();
    try {
      const base = `http://localhost:${server.httpServer.address().port}`;
      await cdp.send('Page.navigate', { url: `${base}/dema/mostki-demo.html` });
      let ready = false;
      for (let i = 0; i < 200 && !ready; i++) {
        await sleep(300);
        try { ready = await evaluate(cdp, '!!(window.__mostki && window.__mostki.ready)'); } catch { ready = false; }
      }
      if (!ready) throw new Error(`demo mostków nie wstało (${variant})`);
      const sparkUrl = variant === 'przed' ? '/.tmp/precyzja/przed/sparkSystem3D.przed.js' : '/src/3d/sparkSystem3D.js';
      // Które pliki modułów naprawdę przyszły (alias „przed” czy drzewo).
      const watch = [...PRZED_FILES, ...PIN_HEAD.map((rel) => posix.basename(rel, '.js')), 'sceneOrigin'];
      const listLoaded = () => evaluate(cdp, `performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /(${watch.join('|')})(\\.przed|\\.head)?\\.js/.test(n)).map((n) => n.replace(/^https?:\\/\\/[^/]+/, '').replace(/\\?.*$/, ''))`);
      console.log(`\n=== wariant ${variant}: ${(await listLoaded()).join(', ')}`);
      console.log('przypadek               siatki inst.   maska   RMS px   max px   skok px   dryf px/kl.       drżenie RMS / max   mesh.position');
      for (const cs of CASES) {
        if (only && !only.has(cs.id)) continue;
        if (modulesArg && !modulesArg.has(cs.module)) continue;
        const opts = { ...cs, frames: FRAMES, hullDepth: !!args['hull-depth'], bloom: !!args.bloom, sparkUrl };
        const fn = cs.module === 'sparks' ? probeSparks : probe;
        const r = await evaluate(cdp, `(${fn.toString()})(${JSON.stringify(opts)}, ${analyze.toString()})`);
        const s = r.summary;
        if (s.error) {
          console.log(`${cs.id.padEnd(22)} ${String(s.meshes).padStart(6)} ${String(s.instances).padStart(5)}   — ${s.error}${s.note ? ` (${s.note})` : ''}`);
          results.push({ variant, ...cs, ...s });
          continue;
        }
        writeFileSync(join(outDir, `${variant}_${cs.id}.png`), Buffer.from(r.png, 'base64'));
        writeFileSync(join(outDir, `${variant}_${cs.id}_roznica.png`), Buffer.from(r.diff, 'base64'));
        const drift = `${s.driftPxPerFrame[0].toFixed(4)},${s.driftPxPerFrame[1].toFixed(4)}`;
        const extra = cs.module === 'fx' ? ` pos64=${s.fxPos64}` : (s.note ? ` ${s.note}` : '');
        console.log(`${cs.id.padEnd(22)} ${String(s.meshes).padStart(6)} ${String(s.instances).padStart(5)} ${String(s.maskPx).padStart(7)}  ${s.shiftRmsPx.toFixed(3).padStart(7)}  ${s.shiftMaxPx.toFixed(3).padStart(7)}  ${s.stepMaxPx.toFixed(3).padStart(8)}  ${drift.padEnd(16)}  ${s.jitterRmsPx.toFixed(3).padStart(7)} / ${s.jitterMaxPx.toFixed(3).padEnd(7)}  ${JSON.stringify(s.meshPos)}${extra}`);
        results.push({ variant, ...cs, ...s, frames: r.frames });
      }
      if (modulesArg?.has('sparks') || !modulesArg) console.log(`   (iskry: ${(await listLoaded()).filter((n) => n.includes('sparkSystem3D')).join(', ')})`);
    } finally {
      await server.close();
    }
  }

  if (variants.length > 1) {
    console.log('\n(px ekranu)             przesunięcie RMS / max          drżenie bez dryfu RMS / max');
    console.log('przypadek               przed            po               przed            po');
    const f2 = (r, a, b) => `${r[a].toFixed(3)} / ${r[b].toFixed(3)}`.padEnd(17);
    for (const cs of CASES) {
      const a = results.find((r) => r.variant === 'przed' && r.id === cs.id);
      const b = results.find((r) => r.variant === 'po' && r.id === cs.id);
      if (!a || !b || a.error || b.error) continue;
      console.log(`${cs.id.padEnd(22)}  ${f2(a, 'shiftRmsPx', 'shiftMaxPx')}${f2(b, 'shiftRmsPx', 'shiftMaxPx')}${f2(a, 'jitterRmsPx', 'jitterMaxPx')}${f2(b, 'jitterRmsPx', 'jitterMaxPx')}`);
    }
  }
} finally {
  writeFileSync(join(outDir, 'drzenie.json'), JSON.stringify({ frames: FRAMES, results, logs }, null, 1));
  console.log(`logi błędów: ${logs.length} → ${join(outDir, 'drzenie.json')}`);
  for (const l of logs.slice(0, 12)) console.log('  ', l);
  try { ws?.close(); } catch { /* już zamknięty */ }
  chrome.kill();
}
