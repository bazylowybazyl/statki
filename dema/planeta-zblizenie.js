// dema/planeta-zblizenie.js
//
// DEMO PLANETY Z BLISKA (2026-11-09, prośba użytkownika: „piękne proceduralne planety … wulkany … brakuje mi grafiki
// na zbliżeniu”). Planeta wulkaniczna z generatora (src/3d/planetGen/) w widoku gry: kamera z góry na płaszczyznę gry,
// słońce w płaszczyźnie gry z boku, od całej tarczy do zbliżenia bojowego (px na jednostkę gry przy promieniu planety
// R_GAME). Pod kamerą piecze się WYCINEK mapy (planetGenPatch.js), materiał zbliżenia (planetGenSurfaceNear.tsl.js)
// dokłada żar płynącej lawy, a erupcja — pióropusz liczony marszem promienia z cieniem na gruncie
// (planetGenPlume.tsl.js). Własny WebGPURenderer i post jak w grze (bloom gry → ACES gry → sRGB), jak
// dema/generator-planet.js.
import * as THREE from 'three/webgpu';
import { max, nodeObject, pass, uniform, vec3, vec4 } from 'three/tsl';
import { BloomGry } from '../src/3d/tsl/postGry.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import { compileAsyncNaCelu } from '../src/3d/rozgrzewka.js';
import { describePlanet } from '../src/3d/planetGen/planetGenSpec.js';
import { PlanetGenBaker } from '../src/3d/planetGen/planetGenBaker.js';
import { createGenNearBody } from '../src/3d/planetGen/planetGenNear.js';
import { freshSeed, mix32 } from '../src/3d/planetGen/planetGenRng.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEG = Math.PI / 180;
const errEl = $('err');
function showError(text) { errEl.style.display = 'block'; errEl.textContent += `${text}\n`; console.error(text); }
addEventListener('error', (e) => showError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => showError(`Promise: ${e.reason?.stack || e.reason}`));
if (params.get('test') === '1') document.body.classList.add('test');

/** Promień planety w jednostkach gry (planeta spoza ringów: promień bazowy 2 800 × 4,5 — planet3d.assets.js). */
const R_GAME = 12600;
const STYLES = [['popiol', 'popiół', 'wulkany'], ['lawa', 'lawa', 'morza lawy'], ['siarka', 'siarka', 'jak Io'], ['terran', 'terrańska', 'lądy i morza']];
const STYLE_SEED = { popiol: 2902783164, lawa: 4139236332, siarka: 1679835275, terran: 21 };
const typeOf = (style) => (style === 'terran' ? 'terran' : 'volcanic');

// ── Renderer i post jak w grze ─────────────────────────────────────────────────────────────────────────────────
const canvas = $('gpu');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, trackTimestamp: params.get('gpu') === '1' });
const DPR = Math.max(0.5, Math.min(2, Number(params.get('dpr')) || window.devicePixelRatio || 1));
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x000000, 1);
await renderer.init();
if (!renderer.backend?.isWebGPUBackend) showError('WebGPU niedostępne — demo wymaga przeglądarki z WebGPU.');
// Osłona jak Core3D._guardPendingPipelines (pipeline z compileAsync w cache, zanim GPU go odda).
{
  const backend = renderer.backend;
  const draw = backend.draw;
  backend.draw = function drawWhenPipelineReady(renderObject, info) {
    const data = this.get(renderObject.pipeline);
    if (data.pipeline === undefined && data.error !== true) return undefined;
    return draw.call(this, renderObject, info);
  };
}

const scene = new THREE.Scene();
// widok gry: kamera ortho z góry; widok orbitalny: kamera perspektywiczna krążąca wokół planety
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
cam.position.set(0, 0, 20);
const orb = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.02, 400);

// Gwiazdy tła (punkty 1 px, nieruchome; ziarno stałe): płaszczyzna za planetą dla widoku z góry, sfera dla orbitalnego.
const stars = {};
{
  const mk = (n, place) => {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      pos.set(place(rnd), i * 3);
      const b = Math.pow(rnd(), 4) * 0.7 + 0.03;
      col.set([b, b * 0.97, b * 1.05], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const p = new THREE.Points(g, new THREE.PointsNodeMaterial({ vertexColors: true, sizeAttenuation: false, size: 1, depthWrite: false }));
    p.frustumCulled = false;
    scene.add(p);
    return p;
  };
  stars.top = mk(4000, (rnd) => [(rnd() * 2 - 1) * 4, (rnd() * 2 - 1) * 2.4, -30]);
  stars.orbit = mk(9000, (rnd) => {
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a) * 150, z * 150, r * Math.sin(a) * 150];
  });
}

const uBloomOn = uniform(1);
const pipes = {};
const passes = {};
for (const [name, camera] of [['top', cam], ['orbit', orb]]) {
  const p = new THREE.RenderPipeline(renderer);
  const sp = pass(scene, camera, { samples: 4 });
  const col = sp.getTextureNode('output');
  const bloom = nodeObject(new BloomGry(col, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold));
  p.outputNode = vec4(linearDoSrgb(acesGry(max(col.rgb.add(bloom.rgb.mul(uBloomOn)), vec3(0.0)))), 1.0);
  p.outputColorTransform = false;
  pipes[name] = p;
  passes[name] = sp;
}

// ── Stan ──────────────────────────────────────────────────────────────────────────────────────────────────────
const num = (k, d) => (params.has(k) && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : d);
const S = {
  style: STYLE_SEED[params.get('styl')] ? params.get('styl') : 'terran',
  seed: params.has('ziarno') ? (Number(params.get('ziarno')) >>> 0) : null,
  // widok: 'orbit' — kamera perspektywiczna przy krawędzi tarczy, 'top' — widok gry (z góry, ortho)
  view: params.get('widok') === 'gora' ? 'top' : (params.get('widok') === 'orbita' ? 'orbit' : null),
  cx: 0, cy: 0, zoom: 0.05,           // widok z góry: środek kadru [R], px na jednostkę gry
  // widok orbitalny: azymut i wysokość kamery nad środkiem planety [rad], odległość [R], przesunięcie celu [R]
  orb: { az: num('az', 0.2), el: num('el', 0.5), dist: num('odl', 1.62), px: num('px', 0.52), py: num('py', 0.2) },
  pora: num('pora', 90), doba: num('doba', 0), lavaRate: 1,
  patchOn: params.get('wycinki') !== '0', lavaOn: true, cloudsOn: false,
  // chmury jako bryła: osobno dla widoku orbitalnego (domyślnie tak) i widoku z góry (domyślnie płaska maska)
  volOrbit: params.get('bryla') !== '0', volTop: params.get('bryla') === '1', auroraOn: true, atmOn: true,
  patchW: Number(params.get('wycinek')) === 4096 ? 4096 : (Number(params.get('wycinek')) === 2048 ? 2048 : (innerWidth * DPR > 3000 ? 4096 : 2048)),
  body: null, baked: null, spec: null, vents: [], ventIdx: 0, lavaStrength: 1,
  busy: 0, paused: false, frameNo: 0, gen: 0, volcanic: true,
  stats: { bakeMs: 0, fps: 0, gpuMs: null, frameMs: 0 }
};
const baker = new PlanetGenBaker(renderer);
const keys = new Set();

function seedForStyle(style, base) {
  if (style === 'terran') return base >>> 0;
  const want = { popiol: 'popiół', lawa: 'lawa', siarka: 'siarka' }[style];
  for (let i = 0; i < 400; i++) {
    const seed = mix32(base, i + 1);
    if (describePlanet({ type: 'volcanic', seed }).look.style === want) return seed;
  }
  return base;
}

// ── Wulkany: kandydaci z map planety (odczyt CPU raz po wypieku) ─────────────────────────────────────────────────
const h2f = (u) => { const e = (u >> 10) & 31; const m = u & 1023; const sg = u >> 15 ? -1 : 1; return e === 0 ? sg * m * 5.96e-8 : (e === 31 ? 0 : sg * Math.pow(2, e - 15) * (1 + m / 1024)); };
function uvDir(u, v) {
  const phi = 2 * Math.PI * u;
  const th = Math.PI * (1 - v);
  return new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
}
async function findVents(baked) {
  const rm = baked.rt.mask;
  const rr = baked.rt.relief;
  const W = rm.width;
  const H = rm.height;
  const mp = await renderer.readRenderTargetPixelsAsync(rm, 0, 0, W, H);
  const rp = await renderer.readRenderTargetPixelsAsync(rr, 0, 0, W, H);
  const mRow = mp.length / H;
  const rRow = rp.length / H;
  const cell = 16;
  const out = [];
  for (let cy = Math.floor(H * 0.12 / cell); cy < Math.ceil(H * 0.88 / cell); cy++) {
    for (let cx = 0; cx < W / cell; cx++) {
      let best = -1; let bx = 0; let by = 0; let sum = 0; let bh = 0; let bl = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) {
        for (let x = cx * cell; x < (cx + 1) * cell; x++) {
          const L = mp[y * mRow + x * 4] / 255;
          sum += L;
          if (L < 0.3) continue;
          const h = h2f(rp[y * rRow + x * 4]);
          const sc = L * (0.55 + 0.45 * Math.min(1, Math.max(0, h / 4)));
          if (sc > best) { best = sc; bx = x; by = y; bh = h; bl = L; }
        }
      }
      const mean = sum / (cell * cell);
      // jezioro albo szczyt z lawą, nie środek morza lawy
      if (best > 0 && mean < 0.5) out.push({ score: best * (1.2 - mean), dir: uvDir((bx + 0.5) / W, (by + 0.5) / H), h: bh, lava: bl });
    }
  }
  out.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const c of out) {
    if (keep.every((k) => k.dir.dot(c.dir) < Math.cos(0.07))) keep.push(c);
    if (keep.length >= 48) break;
  }
  return keep;
}

// Planeta z wodą: ciekawe miejsca = wybrzeże przy górach (pół komórki lądu, wysoki szczyt), bez czap polarnych.
async function findCoasts(baked) {
  const rr = baked.rt.relief;
  const W = rr.width;
  const H = rr.height;
  const rp = await renderer.readRenderTargetPixelsAsync(rr, 0, 0, W, H);
  const rRow = rp.length / H;
  const cell = 24;
  const out = [];
  for (let cy = Math.floor(H * 0.2 / cell); cy < Math.ceil(H * 0.8 / cell); cy++) {
    for (let cx = 0; cx < W / cell; cx++) {
      let land = 0; let top = 0; let bx = 0; let by = 0; let coast = 1e9;
      for (let y = cy * cell; y < (cy + 1) * cell; y += 2) {
        for (let x = cx * cell; x < (cx + 1) * cell; x += 2) {
          const h = h2f(rp[y * rRow + x * 4]);
          if (h > 0) land++;
          if (h > top) top = h;
          if (Math.abs(h) < coast) { coast = Math.abs(h); bx = x; by = y; }
        }
      }
      const frac = land / (cell * cell / 4);
      if (frac > 0.2 && frac < 0.8 && top > 0.6) out.push({ score: Math.min(top, 5) * (1 - Math.abs(frac - 0.5) * 1.6), dir: uvDir((bx + 0.5) / W, (by + 0.5) / H), h: top, lava: 0 });
    }
  }
  out.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const c of out) {
    if (keep.every((k) => k.dir.dot(c.dir) < Math.cos(0.22))) keep.push(c);
    if (keep.length >= 32) break;
  }
  return keep;
}

// ── Budowa planety ────────────────────────────────────────────────────────────────────────────────────────────
async function build(style = S.style, seed = null) {
  const gen = ++S.gen;
  S.busy++;
  $('load').style.display = '';
  try {
    if (S.body) { scene.remove(S.body.group); S.body.dispose(); S.baked.dispose(); S.body = null; }
    S.style = style;
    S.seed = seed ?? STYLE_SEED[style];
    const type = typeOf(style);
    const volcanic = type === 'volcanic';
    await baker.compile([type]);
    const spec0 = describePlanet({ type, seed: S.seed });
    // wulkaniczna — noc bez lawy: żar daje materiał zbliżenia (w dzień i w nocy), mapa nocy zostaje dla świateł kolonii
    // bohater dema (domyślne ziarno planety z wodą): zachmurzenie ze środka zakresu generatora (0,26–0,48; z ziarna
    // wyszło najmniejsze) — bryły chmur widać od razu; planety z „Losuj” mają je z ziarna. `?chmury=0…1` — wprost.
    const cover = params.has('chmury') ? num('chmury', 0.33) : (S.seed === STYLE_SEED[style] ? 0.33 : null);
    const heroClouds = !volcanic && cover != null && spec0.clouds ? { ...spec0.clouds, cover } : null;
    const spec = volcanic ? describePlanet({ type, seed: S.seed, night: { lava: 0 } })
      : (heroClouds ? describePlanet({ type, seed: S.seed, clouds: heroClouds }) : spec0);
    S.paused = true;
    let baked;
    try { baked = (await baker.bakeSystem([spec], { size: 2048, mask: true }))[0]; } finally { S.paused = false; }
    const vents = volcanic ? await findVents(baked) : await findCoasts(baked);
    if (gen !== S.gen) { baked.dispose(); return; }
    S.lavaStrength = volcanic ? 0.55 + 0.6 * spec0.night.lava : 0;
    S.volcanic = volcanic;
    setToggle('t-clouds', 'cloudsOn', !volcanic);
    $('b-erupt').style.display = volcanic ? '' : 'none';
    $('b-vent').textContent = volcanic ? 'Następny wulkan' : 'Następne wybrzeże';
    if (S.view === null) S.view = 'orbit';
    const body = createGenNearBody(spec, baked, baker, { lava: S.lavaStrength, patch: { width: S.patchW, height: S.patchW / 2 } });
    scene.add(body.group);
    // rozgrzewka materiałów w obu widokach (typ kamery wchodzi do klucza pipeline'u); pióropusz i obie postaci
    // chmur widoczne na czas kompilacji
    body.plume.visible = true;
    if (body.clouds) body.clouds.visible = true;
    if (body.cloudVol) body.cloudVol.visible = true;
    const prev = renderer.getRenderTarget();
    try {
      const jobs = [];
      for (const [name, camera] of [['top', cam], ['orbit', orb]]) {
        renderer.setRenderTarget(passes[name].renderTarget);
        jobs.push(compileAsyncNaCelu(renderer, body.group, camera, scene));
      }
      renderer.setRenderTarget(prev);
      await Promise.all(jobs);
    } catch (e) { renderer.setRenderTarget(prev); console.warn('compileAsync', e); }
    body.plume.visible = false;
    if (gen !== S.gen) { scene.remove(body.group); body.dispose(); baked.dispose(); return; }
    S.body = body; S.baked = baked; S.spec = spec; S.vents = vents;
    // bohater: najlepszy wulkan w pasie ±35° szerokości
    S.ventIdx = Math.max(0, vents.findIndex((v) => Math.abs(v.dir.y) < Math.sin(35 * DEG)));
    for (const b of document.querySelectorAll('#styles button')) b.classList.toggle('on', b.dataset.s === style);
  } finally {
    S.busy--;
    if (!S.busy) $('load').style.display = 'none';
  }
}

// Ustawia planetę tak, żeby wulkan `i` leżał 22° za terminatorem po stronie dnia (niskie słońce, długie cienie),
// i kadr nad nim.
// (widok orbitalny: słońce wyżej — jaśniejszy ląd i wyraźne barwy, cienie chmur nadal długie)
function goVent(i, zoom = 0.45, sunDeg = S.view === 'orbit' ? (S.volcanic ? 26 : 34) : (S.volcanic ? 22 : 20)) {
  const v = S.vents[i];
  if (!v || !S.body) return;
  S.ventIdx = i;
  const lonObj = Math.atan2(v.dir.x, v.dir.z);
  const lonScene = (S.pora - 90 + sunDeg) * DEG;
  S.body.mesh.rotation.y = lonScene - lonObj;
  S.body.mesh.updateMatrixWorld(true);
  const p = v.dir.clone().applyQuaternion(S.body.mesh.quaternion);
  S.cx = p.x; S.cy = p.y;
  if (zoom) S.zoom = zoom;
}
// Kamera orbitalna względem miejsca-bohatera: punkt pod kamerą przesunięty od niego o (dAz, dEl) [rad]; `abs` —
// kąty wprost w układzie sceny (słońce w +X przy porze 90°). Domyślnie: bohater po lewej, krawędź tarczy w prawym
// górnym rogu, kamera patrzy ku słońcu (odblask na morzu, srebrne brzegi chmur).
const ORB_DEFAULT = [-0.25, -0.2, 1.5, 0.42, 0.27];
function orbitAt(dAz = ORB_DEFAULT[0], dEl = ORB_DEFAULT[1], dist = ORB_DEFAULT[2], px = ORB_DEFAULT[3], py = ORB_DEFAULT[4], abs = false) {
  let lon = 0; let lat = 0;
  const v = S.vents[S.ventIdx];
  if (!abs && v && S.body) {
    const p = v.dir.clone().applyQuaternion(S.body.mesh.quaternion);
    lon = Math.atan2(p.x, p.z);
    lat = Math.asin(Math.max(-1, Math.min(1, p.y)));
  }
  Object.assign(S.orb, { az: lon + dAz, el: Math.max(-1.5, Math.min(1.5, lat + dEl)), dist, px, py });
}
function viewAll() {
  S.cx = 0; S.cy = 0;
  S.zoom = Math.min(innerWidth, innerHeight) / (2.25 * R_GAME);
}
const _inv = new THREE.Quaternion();
const _c = new THREE.Vector3();
function nearestVent() {
  if (!S.body || !S.vents.length) return -1;
  const r2 = S.cx * S.cx + S.cy * S.cy;
  if (r2 >= 1) return -1;
  _c.set(S.cx, S.cy, Math.sqrt(1 - r2)).applyQuaternion(_inv.copy(S.body.mesh.quaternion).invert());
  let best = -1; let bd = -2;
  for (let i = 0; i < S.vents.length; i++) { const d = S.vents[i].dir.dot(_c); if (d > bd) { bd = d; best = i; } }
  return best;
}
function toggleEruption() {
  const b = S.body;
  if (!b || !S.volcanic) return;
  if (b.eruption.on && b.eruption.off < 0) { b.stopEruption(); return; }
  const i = nearestVent();
  if (i >= 0) b.erupt(S.vents[i].dir);
}

// ── Kierunki planety widoczne w kadrze (dla wycinka) ─────────────────────────────────────────────────────────────
const _o = new THREE.Vector3();
const _r = new THREE.Vector3();
function viewDirsOrbit() {
  const b = S.body;
  _inv.copy(b.mesh.quaternion).invert();
  _o.setFromMatrixPosition(orb.matrixWorld);
  const out = [];
  let miss = false;
  const NX = 10; const NY = 6;
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      _r.set(i / NX * 2 - 1, j / NY * 2 - 1, 0.5).unproject(orb).sub(_o).normalize();
      const bq = _o.dot(_r);
      const disc = bq * bq - (_o.lengthSq() - 1);
      if (disc <= 0 || -bq - Math.sqrt(disc) <= 0) { miss = true; continue; }
      _c.copy(_o).addScaledVector(_r, -bq - Math.sqrt(disc)).normalize().applyQuaternion(_inv);
      out.push([_c.x, _c.y, _c.z]);
    }
  }
  if (miss) {
    // krawędź tarczy w kadrze: punkty okręgu horyzontu, które rzutują się w kadr
    const d = _o.length();
    const ch = _o.clone().multiplyScalar(1 / d);
    const e1 = new THREE.Vector3(0, 1, 0).cross(ch);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = ch.clone().cross(e1);
    const ct = 1 / d;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    for (let k = 0; k < 96; k++) {
      const a = k / 96 * 2 * Math.PI;
      _c.copy(ch).multiplyScalar(ct).addScaledVector(e1, st * Math.cos(a)).addScaledVector(e2, st * Math.sin(a));
      _r.copy(_c).project(orb);
      if (Math.abs(_r.x) > 1 || Math.abs(_r.y) > 1 || _r.z > 1) continue;
      _c.applyQuaternion(_inv);
      out.push([_c.x, _c.y, _c.z]);
    }
  }
  return out;
}
function viewDirs() {
  if (S.view === 'orbit') return viewDirsOrbit();
  const b = S.body;
  const hh = innerHeight / (2 * S.zoom * R_GAME);
  const hw = innerWidth / (2 * S.zoom * R_GAME);
  _inv.copy(b.mesh.quaternion).invert();
  const out = [];
  let miss = false;
  const NX = 8; const NY = 6;
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = S.cx + (i / NX * 2 - 1) * hw;
      const y = S.cy + (j / NY * 2 - 1) * hh;
      const r2 = x * x + y * y;
      if (r2 >= 0.9999) { miss = true; continue; }
      _c.set(x, y, Math.sqrt(1 - r2)).applyQuaternion(_inv);
      out.push([_c.x, _c.y, _c.z]);
    }
  }
  if (miss) {
    // brzeg tarczy w kadrze: punkty limbu w prostokącie kadru
    for (let k = 0; k < 96; k++) {
      const a = k / 96 * 2 * Math.PI;
      const x = Math.cos(a); const y = Math.sin(a);
      if (Math.abs(x - S.cx) > hw || Math.abs(y - S.cy) > hh) continue;
      _c.set(x, y, 0).applyQuaternion(_inv);
      out.push([_c.x, _c.y, _c.z]);
    }
  }
  return out;
}

// ── Panel ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const box = $('styles');
  for (const [id, name, hint] of STYLES) {
    const b = document.createElement('button');
    b.textContent = `${name} (${hint})`;
    b.dataset.s = id;
    b.onclick = () => rebuild(id, null);
    box.appendChild(b);
  }
  const slider = (id, out, get, set, fmt) => {
    const el = $(id);
    el.value = get();
    const o = $(out);
    const upd = () => { set(Number(el.value)); o.textContent = fmt(Number(el.value)); };
    el.oninput = upd;
    upd();
  };
  slider('s-pora', 'o-pora', () => S.pora, (v) => { S.pora = v; }, (v) => `${v}°`);
  slider('s-doba', 'o-doba', () => S.doba, (v) => { S.doba = v; }, (v) => v.toFixed(2));
  slider('s-lava', 'o-lava', () => S.lavaRate, (v) => { S.lavaRate = v; }, (v) => `×${v.toFixed(1)}`);
  const toggle = (id, key) => { $(id).onclick = () => setToggle(id, key, !S[key]); $(id).classList.toggle('on', S[key]); };
  toggle('t-patch', 'patchOn');
  toggle('t-lava', 'lavaOn');
  toggle('t-clouds', 'cloudsOn');
  toggle('t-aurora', 'auroraOn');
  toggle('t-atm', 'atmOn');
  $('t-vol').onclick = () => toggleVolume();
  $('b-view').onclick = () => setViewMode(S.view === 'orbit' ? 'top' : 'orbit');
  $('b-erupt').onclick = () => toggleEruption();
  $('b-vent').onclick = () => nextVent();
  $('b-all').onclick = () => viewAll();
  $('b-los').onclick = () => rebuild(S.style, seedForStyle(S.style, freshSeed()));
}
function setToggle(id, key, v) { S[key] = v; $(id).classList.toggle('on', v); }
function setViewMode(v) {
  const was = S.view;
  S.view = v;
  // zmiana widoku: słońce nad bohaterem jak w nowym widoku (orbita — wyżej)
  if (was && was !== v && S.body) goVent(S.ventIdx, S.zoom);
  $('b-view').textContent = v === 'orbit' ? 'Widok z góry (gra)' : 'Widok orbitalny';
  $('t-vol').classList.toggle('on', v === 'orbit' ? S.volOrbit : S.volTop);
}
function toggleVolume() {
  if (S.view === 'orbit') S.volOrbit = !S.volOrbit; else S.volTop = !S.volTop;
  $('t-vol').classList.toggle('on', S.view === 'orbit' ? S.volOrbit : S.volTop);
}
function nextVent() {
  if (!S.vents.length) return;
  goVent((S.ventIdx + 1) % S.vents.length, Math.max(S.zoom, 0.3));
  if (S.view === 'orbit') orbitAt(undefined, undefined, S.orb.dist);
}
async function rebuild(style, seed) {
  await build(style, seed);
  setViewMode(S.view || 'orbit');
  if (S.body) {
    goVent(S.ventIdx);
    // kamera orbitalna nad bohaterem, chyba że adres podaje ją wprost (?az=&el=)
    if (!params.has('az') && !params.has('el')) orbitAt(undefined, undefined, num('odl', ORB_DEFAULT[2]), num('px', ORB_DEFAULT[3]), num('py', ORB_DEFAULT[4]));
    if (S.volcanic && params.get('erupcja') !== '0' && S.vents[S.ventIdx]) S.body.erupt(S.vents[S.ventIdx].dir);
  }
}

// ── Mysz i klawisze ───────────────────────────────────────────────────────────────────────────────────────────
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy, az: S.orb.az, el: S.orb.el, px: S.orb.px, py: S.orb.py, pan: e.button !== 0 || e.shiftKey };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('drag');
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (S.view === 'orbit') {
    // lewy przycisk — obrót kamery wokół planety, prawy albo Shift — przesunięcie kadru
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.pan) {
      const k = 2 * Math.tan(orb.fov * DEG / 2) * S.orb.dist / innerHeight;
      S.orb.px = drag.px - dx * k;
      S.orb.py = drag.py + dy * k;
    } else {
      const k = 0.0045 * Math.min(1, S.orb.dist - 0.95);
      S.orb.az = drag.az - dx * k;
      S.orb.el = Math.max(-1.5, Math.min(1.5, drag.el + dy * k));
    }
    return;
  }
  const k = 1 / (S.zoom * R_GAME);
  S.cx = drag.cx - (e.clientX - drag.x) * k;
  S.cy = drag.cy + (e.clientY - drag.y) * k;
});
canvas.addEventListener('pointerup', () => { drag = null; canvas.classList.remove('drag'); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (S.view === 'orbit') {
    // odległość od powierzchni rośnie / maleje wykładniczo (przy samej planecie drobne kroki)
    S.orb.dist = Math.max(1.06, Math.min(9, 1 + (S.orb.dist - 1) * Math.exp(e.deltaY * 0.0012)));
    return;
  }
  const zMin = Math.min(innerWidth, innerHeight) / (2.6 * R_GAME);
  const z1 = Math.max(zMin, Math.min(3, S.zoom * Math.exp(-e.deltaY * 0.0014)));
  // punkt pod kursorem zostaje pod kursorem
  const dx = (e.clientX - innerWidth / 2) / R_GAME;
  const dy = -(e.clientY - innerHeight / 2) / R_GAME;
  S.cx += dx * (1 / S.zoom - 1 / z1);
  S.cy += dy * (1 / S.zoom - 1 / z1);
  S.zoom = z1;
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'e') toggleEruption();
  if (k === 'v') nextVent();
  if (k === 't') setToggle('t-patch', 'patchOn', !S.patchOn);
  if (k === 'l') setToggle('t-lava', 'lavaOn', !S.lavaOn);
  if (k === 'c') setToggle('t-clouds', 'cloudsOn', !S.cloudsOn);
  if (k === 'o') setViewMode(S.view === 'orbit' ? 'top' : 'orbit');
  if (k === 'b') toggleVolume();
  if (k === 'z') setToggle('t-aurora', 'auroraOn', !S.auroraOn);
  if (k === 'r') rebuild(S.style, seedForStyle(S.style, freshSeed()));
  if (k === 'h') document.body.classList.toggle('hide');
  if (k === 'home') viewAll();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// ── Klatka ────────────────────────────────────────────────────────────────────────────────────────────────────
const sunDir = new THREE.Vector3();
let last = performance.now();
let fpsT = 0; let fpsN = 0;
function simulate(dt) {
  const b = S.body;
  if (!b) return false;
  b.patches.enabled = S.patchOn;
  b.step(dt, { spin: S.doba * 0.02, cloudSpin: S.doba * 0.004, lavaRate: S.lavaRate });
  b.mesh.updateMatrixWorld(true);
  sunDir.set(Math.sin(S.pora * DEG), 0, Math.cos(S.pora * DEG));
  b.setSun(sunDir);
  b.setCamera(S.view === 'orbit' ? orb : cam);
  b.uniforms.uGnLava.value.x = S.lavaOn ? S.lavaStrength : 0;
  b.setCloudMode(S.cloudsOn ? ((S.view === 'orbit' ? S.volOrbit : S.volTop) ? 'volume' : 'flat') : 'off');
  if (b.aurora) b.aurora.visible = S.auroraOn;
  b.setAtmosphere(S.atmOn);
  const t0 = performance.now();
  const baked = b.updatePatches(viewDirs(), dt);
  if (baked) S.stats.bakeMs = performance.now() - t0;
  return baked;
}
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const W = innerWidth;
  const H = innerHeight;
  if (canvas.width !== Math.round(W * DPR) || canvas.height !== Math.round(H * DPR)) renderer.setSize(W, H, false);
  // przesuw klawiszami: pół kadru na sekundę
  const hh = H / (2 * S.zoom * R_GAME);
  const hw = W / (2 * S.zoom * R_GAME);
  const mv = hh * 1.1 * dt * (keys.has('shift') ? 3 : 1);
  const orbit = S.view === 'orbit';
  if (orbit) {
    // klawisze w widoku orbitalnym przesuwają kadr (cel kamery)
    const pm = S.orb.dist * 0.5 * dt * (keys.has('shift') ? 3 : 1);
    if (keys.has('a') || keys.has('arrowleft')) S.orb.px -= pm;
    if (keys.has('d') || keys.has('arrowright')) S.orb.px += pm;
    if (keys.has('w') || keys.has('arrowup')) S.orb.py += pm;
    if (keys.has('s') || keys.has('arrowdown')) S.orb.py -= pm;
    S.cx = clampTop(S.cx, mv, false);
  } else {
    S.cx = clampTop(S.cx, mv, true);
  }
  cam.left = S.cx - hw; cam.right = S.cx + hw; cam.top = S.cy + hh; cam.bottom = S.cy - hh;
  cam.updateProjectionMatrix();
  placeOrbitCamera();
  stars.top.visible = !orbit;
  stars.orbit.visible = orbit;
  if (!S.paused) {
    simulate(dt);
    pipes[S.view === 'orbit' ? 'orbit' : 'top'].render();
    if (renderer.backend.trackTimestamp && (++S.frameNo % 30 === 0)) {
      renderer.resolveTimestampsAsync('render').then((ms) => { if (ms != null) S.stats.gpuMs = ms / 30; });
    }
  }
  fpsT += dt; fpsN++;
  if (fpsT > 0.5) { S.stats.fps = fpsN / fpsT; fpsT = 0; fpsN = 0; updateStat(); }
  requestAnimationFrame(frame);
}

// widok z góry: przesuw klawiszami (gdy `move`) i ograniczenie środka kadru do okolicy tarczy
function clampTop(cx, mv, move) {
  if (move) {
    if (keys.has('a') || keys.has('arrowleft')) S.cx -= mv;
    if (keys.has('d') || keys.has('arrowright')) S.cx += mv;
    if (keys.has('w') || keys.has('arrowup')) S.cy += mv;
    if (keys.has('s') || keys.has('arrowdown')) S.cy -= mv;
  }
  const rc = Math.hypot(S.cx, S.cy);
  if (rc > 1.15) { S.cx *= 1.15 / rc; S.cy *= 1.15 / rc; }
  return S.cx;
}
// kamera orbitalna: pozycja z azymutu, wysokości i odległości; patrzy na środek planety przesunięty w płaszczyźnie
// kadru o (px, py) — planeta schodzi z kadru w bok, krawędź tarczy przecina kadr
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tgt = new THREE.Vector3();
function placeOrbitCamera() {
  const o = S.orb;
  const ce = Math.cos(o.el);
  orb.aspect = innerWidth / innerHeight;
  orb.updateProjectionMatrix();
  orb.position.set(Math.sin(o.az) * ce * o.dist, Math.sin(o.el) * o.dist, Math.cos(o.az) * ce * o.dist);
  orb.up.set(0, 1, 0);
  orb.lookAt(0, 0, 0);
  orb.updateMatrixWorld();
  _right.setFromMatrixColumn(orb.matrixWorld, 0);
  _up.setFromMatrixColumn(orb.matrixWorld, 1);
  _tgt.set(0, 0, 0).addScaledVector(_right, o.px).addScaledVector(_up, o.py);
  orb.lookAt(_tgt);
  orb.updateMatrixWorld();
}

function updateStat() {
  const b = S.body;
  // podziałka: okrągła długość ~120 px
  const want = 120 / S.zoom;
  const p10 = Math.pow(10, Math.floor(Math.log10(want)));
  const len = [1, 2, 5, 10].map((m) => m * p10).reduce((a, c) => (Math.abs(c - want) < Math.abs(a - want) ? c : a));
  $('scale').querySelector('i').style.width = `${(len * S.zoom).toFixed(0)}px`;
  $('scale').querySelector('span').textContent = `${len.toLocaleString('pl')} j.`;
  if (!b) { $('stat').textContent = ''; return; }
  const P = b.patches;
  const act = P.active >= 0 ? P.slots[P.active].win : null;
  const texPx = (act ? act.st : 2 * Math.PI / S.baked.size) * R_GAME * S.zoom;
  const lines = [
    `${S.view === 'orbit' ? `widok orbitalny, ${(S.orb.dist - 1).toFixed(2)} R nad powierzchnią` : `1 px = ${(1 / S.zoom).toFixed(2)} j.`} · planeta R = ${R_GAME.toLocaleString('pl')} j. · ${b.spec.look.style || b.spec.name}, ziarno ${b.spec.seed}`,
    `${act ? `wycinek ${P.width} × ${P.height}, poziom ${act.level}` : 'mapa planety 2048'} · teksel ${texPx.toFixed(1)} px · wypieków ${P.stats.bakes}, ostatni ${S.stats.bakeMs.toFixed(1)} ms`
      + ` · ${S.stats.fps.toFixed(0)} kl/s${S.stats.gpuMs != null ? ` · GPU ${S.stats.gpuMs.toFixed(2)} ms` : ''}`
  ];
  $('stat').textContent = lines.join('\n');
  $('b-erupt').textContent = b.eruption.on && b.eruption.off < 0 ? 'Zakończ erupcję' : 'Erupcja';
}

// ── Start ─────────────────────────────────────────────────────────────────────────────────────────────────────
window.__zbl = {
  S, baker, renderer, scene, cam, orb, R_GAME, setViewMode, uBloomOn,
  ready: () => S.busy === 0 && !!S.body,
  build, rebuild, goVent, orbitAt, viewAll, toggleEruption, nearestVent, seedForStyle, viewDirs,
  /** Kadr: środek [R], zoom [px / j.]. */
  setView(cx, cy, zoom) { S.cx = cx; S.cy = cy; if (zoom) S.zoom = zoom; },
  /** Przewija symulację (erupcja, lawa, przenikanie wycinków) o `sec` sekund bez rysowania. */
  advance(sec, step = 1 / 30) { placeOrbitCamera(); for (let t = 0; t < sec; t += step) simulate(step); },
  /**
   * Czas GPU klatki [ms] (mediana z `n` klatek; wymaga ?gpu=1): pętla dema wstrzymana, jedna klatka na takt rAF
   * (pass sceny rysuje raz na klatkę rAF — pułapka 44), znaczniki czasu odczytane po każdej.
   */
  async measureGpu(n = 40, pre = null) {
    if (!renderer.backend.trackTimestamp) return null;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    S.paused = true;
    await raf();
    await renderer.resolveTimestampsAsync('render');
    const out = [];
    for (let i = 0; i < n; i++) {
      await raf();
      placeOrbitCamera();
      simulate(0);
      if (pre) pre();     // nadpisania uniformów na czas pomiaru (krok symulacji ustawia je co klatkę)
      pipes[S.view === 'orbit' ? 'orbit' : 'top'].render();
      const ms = await renderer.resolveTimestampsAsync('render');
      if (ms != null) out.push(ms);
    }
    S.paused = false;
    out.sort((a, b) => a - b);
    return out.length ? out[out.length >> 1] : null;
  },
  /** Mały obraz klatki (jasność, w × h) do porównań: rysuje klatkę bez kroku czasu i kopiuje ją w tym samym zadaniu. */
  async snapshot(w = 400, h = 225) {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    S.paused = true;
    await raf();
    await raf();
    placeOrbitCamera();
    simulate(0);
    pipes[S.view === 'orbit' ? 'orbit' : 'top'].render();
    const cv = new OffscreenCanvas(w, h);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(canvas, 0, 0, w, h);
    const px = cx.getImageData(0, 0, w, h).data;
    S.paused = false;
    const out = new Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = Math.round(px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11);
    return out;
  }
};
requestAnimationFrame(frame);
await build(S.style, S.seed);
setViewMode(S.view || 'orbit');
if (S.body) {
  goVent(S.ventIdx);
  if (params.has('x') || params.has('y') || params.has('zoom')) {
    S.cx = num('x', S.cx); S.cy = num('y', S.cy); S.zoom = num('zoom', S.zoom);
  }
  if (S.volcanic && params.get('erupcja') !== '0' && S.vents[S.ventIdx]) S.body.erupt(S.vents[S.ventIdx].dir);
}
updateStat();
