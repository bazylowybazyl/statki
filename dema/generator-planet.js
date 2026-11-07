// dema/generator-planet.js
//
// DEMO GENERATORA PLANET (2026-11-07, prośba użytkownika: „generator planet — demo … terrańska, gazowa, skalista,
// piaszczysta, lodowa itp.”). Generator: src/3d/planetGen/ (opis z ziarna → wypiek map na GPU → materiały gry).
//  • SIATKA — 15 planet (mieszane rodzaje albo 15 ziaren jednego rodzaju), widok gry: kamera z góry na płaszczyznę
//    gry (biegun N u góry kadru), słońce w płaszczyźnie gry z boku (terminator przez środek tarczy), mapy 1024.
//  • ZBLIŻENIE — jedna planeta w rozdzielczości z panelu (2048 / 4096), obrót kamery myszą, doba, słońce.
// Własny WebGPURenderer (jak dema/planety-webgpu.js): materiały planet tła nie czytają maski słońca (uSunShadowRecv 0).
// Post jak w grze: bloom gry (BloomGry) → ACES gry → sRGB.
import * as THREE from 'three/webgpu';
import { max, nodeObject, pass, uniform, vec3, vec4 } from 'three/tsl';
import { BloomGry } from '../src/3d/tsl/postGry.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import { compileAsyncNaCelu } from '../src/3d/rozgrzewka.js';
import { PLANET_GEN_TYPES, PLANET_GEN_TYPE, PLANET_GEN_TYPE_IDS } from '../src/3d/planetGen/planetGenTypes.js';
import { describePlanet, plannedBytes } from '../src/3d/planetGen/planetGenSpec.js';
import { PlanetGenBaker } from '../src/3d/planetGen/planetGenBaker.js';
import { createGenPlanetBody } from '../src/3d/planetGen/planetGenBody.js';
import { freshSeed, mix32 } from '../src/3d/planetGen/planetGenRng.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEG = Math.PI / 180;
const errEl = $('err');
function showError(text) { errEl.style.display = 'block'; errEl.textContent += `${text}\n`; console.error(text); }
addEventListener('error', (e) => showError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => showError(`Promise: ${e.reason?.stack || e.reason}`));
if (params.get('test') === '1') document.body.classList.add('test');

// ── Renderer i post jak w grze ─────────────────────────────────────────────────────────────────────────────────
const canvas = $('gpu');
const over = $('over');
const octx = over.getContext('2d');
// trackTimestamp — czas GPU wypieku ze znaczników czasu (?gpu=0 — bez)
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, trackTimestamp: params.get('gpu') !== '0' });
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
const gridCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
gridCam.position.set(0, 0, 20);
const closeCam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 300);

// Gwiazdy tła (punkty 1 px, nieruchome; ziarno stałe).
{
  const n = 4000;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(a) * 40, z * 40, r * Math.sin(a) * 40 - 10], i * 3);
    const b = Math.pow(rnd(), 4) * 0.7 + 0.03;
    col.set([b, b * 0.97, b * 1.05], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsNodeMaterial({ vertexColors: true, sizeAttenuation: false, size: 1, depthWrite: false });
  scene.add(new THREE.Points(g, m));
}

const uBloomOn = uniform(1);
const pipes = {};
const scenePasses = {};
for (const [name, cam] of [['grid', gridCam], ['close', closeCam]]) {
  const p = new THREE.RenderPipeline(renderer);
  const sp = pass(scene, cam, { samples: 4 });
  const col = sp.getTextureNode('output');
  const bloom = nodeObject(new BloomGry(col, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold));
  p.outputNode = vec4(linearDoSrgb(acesGry(max(col.rgb.add(bloom.rgb.mul(uBloomOn)), vec3(0.0)))), 1.0);
  p.outputColorTransform = false;
  pipes[name] = p;
  scenePasses[name] = sp;
}

// ── Stan ──────────────────────────────────────────────────────────────────────────────────────────────────────
const RES_LIST = [1024, 2048, 4096];
const S = {
  view: 'grid',
  gridType: PLANET_GEN_TYPE[params.get('rodzaj')] ? params.get('rodzaj') : 'mieszane',
  baseSeed: params.has('ziarno') ? (Number(params.get('ziarno')) >>> 0) : null,
  closeRes: RES_LIST.includes(Number(params.get('roz'))) ? Number(params.get('roz')) : 2048,
  gridRes: 1024,
  pora: Number(params.get('pora') ?? 90),
  doba: Number(params.get('doba') ?? 0.15),
  atmRate: 1,
  cloudsOn: true, haloOn: true, labels: true,
  az: 0.6, el: 0.12, dist: 3.4,
  tiles: [],            // { spec, baked, body, x, y }
  close: null,          // { spec, baked, body }
  busy: 0,
  paused: false,
  frameNo: 0,
  gen: 0,
  stats: { compileMs: 0, gridMs: 0, gridGpu: 0, closeMs: 0, compiled: false }
};
const baker = new PlanetGenBaker(renderer);

const COLS = 5;
const ROWS = 3;
const SPACING = 2.7;

function gridEntries() {
  const n = COLS * ROWS;
  const base = S.baseSeed ?? freshSeed();
  const out = [];
  for (let i = 0; i < n; i++) {
    const seed = mix32(base, i + 1);
    let type = S.gridType;
    if (type === 'mieszane') type = i < PLANET_GEN_TYPE_IDS.length ? PLANET_GEN_TYPE_IDS[i] : PLANET_GEN_TYPE_IDS[mix32(seed, 77) % PLANET_GEN_TYPE_IDS.length];
    out.push({ type, seed });
  }
  // mieszane: rodzaje rozrzucone po siatce (nie w kolejności listy)
  if (S.gridType === 'mieszane') {
    for (let i = out.length - 1; i > 0; i--) {
      const j = mix32(base, 1000 + i) % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

async function ensureCompiled(types) {
  const t0 = performance.now();
  await baker.compile(types);
  return performance.now() - t0;
}

async function compileBody(body, cam, sp) {
  scene.add(body.group);
  const prev = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(sp.renderTarget);
    const p = compileAsyncNaCelu(renderer, body.group, cam, scene);
    renderer.setRenderTarget(prev);
    await p;
  } catch (e) { renderer.setRenderTarget(prev); console.warn('compileAsync', e); }
}

function disposeTile(t) {
  scene.remove(t.body.group);
  t.body.dispose();
  t.baked.dispose();
  if (t.baked.gas) t.baked.gas.dispose();
}

async function buildGrid() {
  const gen = ++S.gen;
  S.busy++;
  try {
    for (const t of S.tiles) disposeTile(t);
    S.tiles = [];
    const entries = gridEntries();
    {
      const ms = await ensureCompiled([...new Set(entries.map((e) => e.type))]);
      if (!S.stats.compiled) S.stats.compileMs = ms;
      S.stats.compiled = true;
    }
    const t0 = performance.now();
    const specs = entries.map((e) => describePlanet(e));
    // wypiek całej siatki jak układu (jeden odczyt prób); klatki stoją na czas wypieku (czas GPU — tylko wypiek)
    S.paused = true;
    let res;
    try { res = await baker.bakeSystem(specs, { size: S.gridRes }); } finally { S.paused = false; }
    S.stats.gridWall = performance.now() - t0;
    S.stats.gridGpu = res[0]?.ms.gpu ?? null;
    if (gen !== S.gen) { for (const b of res) b.dispose(); return; }
    for (let i = 0; i < res.length; i++) {
      const spec = specs[i];
      const baked = res[i];
      const body = createGenPlanetBody(spec, baked, { segments: 128 });
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      body.group.position.set((col - (COLS - 1) / 2) * SPACING, ((ROWS - 1) / 2 - row) * SPACING, 0);
      body.mesh.rotation.y = (mix32(spec.seed, 5) % 1000) / 1000 * Math.PI * 2;
      await compileBody(body, gridCam, scenePasses.grid);
      if (gen !== S.gen) { body.dispose(); baked.dispose(); return; }
      S.tiles.push({ spec, baked, body, i });
      body.group.visible = S.view === 'grid';
    }
    S.stats.gridMs = performance.now() - t0;
    baker.releaseScratch();
  } finally {
    S.busy--;
  }
  updateInfo();
}

async function openClose(type, seed) {
  const gen = ++S.gen;
  S.busy++;
  try {
    if (S.close) { disposeTile(S.close); S.close = null; }
    await ensureCompiled([type]);
    const spec = describePlanet({ type, seed });
    const t0 = performance.now();
    S.paused = true;
    let baked;
    try { baked = await baker.bake(spec, { size: S.closeRes }); } finally { S.paused = false; }
    S.stats.closeMs = performance.now() - t0;
    S.stats.closeBake = baked.ms;
    baker.releaseScratch();
    const body = createGenPlanetBody(spec, baked, { segments: 256 });
    body.group.position.set(0, 0, 0);
    await compileBody(body, closeCam, scenePasses.close);
    if (gen !== S.gen) { disposeTile({ spec, baked, body }); return; }
    S.close = { spec, baked, body };
    setView('close');
    $('seed').value = String(seed);
  } finally {
    S.busy--;
  }
  updateInfo();
}

function setView(v) {
  S.view = v;
  for (const t of S.tiles) t.body.group.visible = v === 'grid';
  if (S.close) S.close.body.group.visible = v === 'close';
  for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.v === v);
  updateInfo();
}

// ── Panel ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const box = $('types');
  for (const id of ['mieszane', ...PLANET_GEN_TYPE_IDS]) {
    const b = document.createElement('button');
    b.textContent = id === 'mieszane' ? 'mieszane' : PLANET_GEN_TYPE[id].name;
    b.dataset.t = id;
    b.onclick = () => {
      S.gridType = id;
      S.baseSeed = null;
      for (const x of box.children) x.classList.toggle('on', x.dataset.t === id);
      setView('grid');
      buildGrid();
    };
    box.appendChild(b);
  }
  for (const x of box.children) x.classList.toggle('on', x.dataset.t === S.gridType);
  const views = $('views');
  for (const [v, name] of [['grid', 'siatka (gra)'], ['close', 'zbliżenie']]) {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.v = v;
    b.onclick = () => { if (v === 'close' && !S.close) { const t = S.tiles[0]; if (t) openClose(t.spec.type, t.spec.seed); } else setView(v); };
    views.appendChild(b);
  }
  const res = $('res');
  for (const r of RES_LIST) {
    const b = document.createElement('button');
    b.textContent = `${r} × ${r / 2}`;
    b.onclick = () => {
      S.closeRes = r;
      for (const x of res.children) x.classList.toggle('on', x.textContent === b.textContent);
      if (S.close) openClose(S.close.spec.type, S.close.spec.seed);
    };
    b.classList.toggle('on', r === S.closeRes);
    res.appendChild(b);
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
  slider('s-atm', 'o-atm', () => S.atmRate, (v) => { S.atmRate = v; }, (v) => `×${v.toFixed(1)}`);
  const toggle = (id, key) => { $(id).onclick = () => { S[key] = !S[key]; $(id).classList.toggle('on', S[key]); }; };
  toggle('t-chmury', 'cloudsOn');
  toggle('t-poswiata', 'haloOn');
  toggle('t-podpisy', 'labels');
  $('b-los').onclick = () => reroll();
  $('b-siatka').onclick = () => { setView('grid'); if (!S.tiles.length) buildGrid(); };
  $('b-seed').onclick = () => {
    const seed = Number($('seed').value) >>> 0;
    const type = S.close ? S.close.spec.type : (S.gridType === 'mieszane' ? 'terran' : S.gridType);
    openClose(type, seed);
  };
}

function reroll() {
  if (S.view === 'close' && S.close) openClose(S.close.spec.type, freshSeed());
  else { S.baseSeed = null; buildGrid(); }
}

const fmtMB = (b) => `${(b / 1048576).toFixed(1)} MB`;
function describeLook(spec) {
  const L = spec.look;
  const bits = [];
  if (L.style) bits.push(L.style);
  if (L.palette && typeof L.palette === 'string') bits.push(L.palette);
  if (spec.type === 'ocean') bits.push(`woda: ${L.tint}`);
  if (L.water > 0) bits.push(`ocean ${(L.water * 100).toFixed(0)}%`);
  if (L.vegetation && spec.type === 'terran') bits.push(`roślinność: ${L.vegetation}`);
  if (spec.type === 'terran' || spec.type === 'ocean') bits.push(L.temp < -0.1 ? 'zimna' : (L.temp > 0.1 ? 'gorąca' : 'umiarkowana'));
  if (spec.kind === 'gas') bits.push(`${L.rows.length} pasów`, `${L.vortices.length} wirów`, L.ring ? 'pierścienie' : 'bez pierścieni');
  if (spec.night.cities > 0) bits.push(`miasta ${(spec.night.cities * 100).toFixed(0)}%`);
  if (spec.clouds) bits.push(`chmury ${(spec.clouds.cover * 100).toFixed(0)}%`);
  return bits.join(' · ');
}
function updateInfo() {
  const el = $('info');
  const sp = S.view === 'close' && S.close ? S.close.spec : null;
  if (sp) {
    el.innerHTML = `<h2>Planeta</h2><b>${PLANET_GEN_TYPE[sp.type].name}</b> · ziarno ${sp.seed}<br>${PLANET_GEN_TYPE[sp.type].opis}` +
      `<div class="kv">${describeLook(sp)}<br>promień ${sp.rKm.toLocaleString('pl')} km</div>`;
  } else {
    const t = S.gridType === 'mieszane' ? null : PLANET_GEN_TYPE[S.gridType];
    el.innerHTML = `<h2>Siatka</h2>${t ? `<b>${t.name}</b> — ${t.opis}` : 'wszystkie rodzaje — kliknij planetę, żeby ją przybliżyć'}`;
  }
  updateStat();
}
function updateStat() {
  const tilesBytes = S.tiles.reduce((s, t) => s + t.baked.bytes, 0);
  const lines = [];
  const gpu = (ms) => (ms == null ? '' : ` · GPU ${ms.toFixed(1)} ms`);
  if (S.stats.compiled) lines.push(`kompilacja przejść ${S.stats.compileMs.toFixed(0)} ms`);
  if (S.tiles.length) lines.push(`siatka: ${S.tiles.length} planet ${S.gridRes} px · ${S.stats.gridWall.toFixed(0)} ms${gpu(S.stats.gridGpu)} · ${fmtMB(tilesBytes)}`);
  if (S.close) {
    const b = S.close.baked;
    lines.push(`zbliżenie: ${b.size} px · ${b.ms.total.toFixed(0)} ms${gpu(b.ms.gpu)} · ${fmtMB(b.bytes)}`);
  }
  if (S.busy) lines.push('wypiek…');
  $('stat').textContent = lines.join('\n');
}

// ── Mysz i klawisze ───────────────────────────────────────────────────────────────────────────────────────────
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, az: S.az, el: S.el, moved: false }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (S.view === 'close' && drag.moved) {
    canvas.classList.add('drag');
    S.az = drag.az - dx * 0.006;
    S.el = Math.max(-1.45, Math.min(1.45, drag.el + dy * 0.006));
  }
});
canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('drag');
  if (drag && !drag.moved && S.view === 'grid') {
    const hit = pickTile(e.clientX, e.clientY);
    if (hit) openClose(hit.spec.type, hit.spec.seed);
  }
  drag = null;
});
canvas.addEventListener('wheel', (e) => {
  if (S.view !== 'close') return;
  e.preventDefault();
  S.dist = Math.max(1.04, Math.min(12, 1 + (S.dist - 1) * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') setView('grid');
  if (e.key === 'r' || e.key === 'R') reroll();
  if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hide');
  if (e.key === 'c' || e.key === 'C') { S.cloudsOn = !S.cloudsOn; $('t-chmury').classList.toggle('on', S.cloudsOn); }
  if (e.key === 'd' || e.key === 'D') { S.doba = S.doba > 0 ? 0 : 0.15; $('s-doba').value = S.doba; $('o-doba').textContent = S.doba.toFixed(2); }
});

// Siatka w obszarze bez panelu (panel po prawej): środek kadru przesunięty w lewo o pół szerokości panelu.
function panelWidth() {
  const p = document.getElementById('panel');
  if (!p || document.body.classList.contains('test') || document.body.classList.contains('hide') || innerWidth < 720) return 0;
  return p.offsetWidth + 20;
}
function gridFrame() {
  const W = innerWidth;
  const H = innerHeight;
  const pw = panelWidth();
  const needW = COLS * SPACING + 0.2;
  const needH = ROWS * SPACING + 0.5;
  const s = Math.max(needW / Math.max(W - pw, 200), needH / H);
  const cx = (W - pw) / 2;                 // środek siatki na ekranie [px]
  return { left: -cx * s, right: (W - cx) * s, halfH: H * s / 2, s, cx };
}
function pickTile(cx, cy) {
  const f = gridFrame();
  const x = (cx - f.cx) * f.s;
  const y = -(cy - innerHeight / 2) * f.s;
  for (const t of S.tiles) {
    const p = t.body.group.position;
    if ((x - p.x) ** 2 + (y - p.y) ** 2 < 1.1) return t;
  }
  return null;
}

// ── Klatka ────────────────────────────────────────────────────────────────────────────────────────────────────
const sunDir = new THREE.Vector3();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const W = innerWidth;
  const H = innerHeight;
  if (canvas.width !== Math.round(W * DPR) || canvas.height !== Math.round(H * DPR)) renderer.setSize(W, H, false);
  if (over.width !== Math.round(W * DPR) || over.height !== Math.round(H * DPR)) { over.width = Math.round(W * DPR); over.height = Math.round(H * DPR); }
  const bodies = S.view === 'grid' ? S.tiles.map((t) => t.body) : (S.close ? [S.close.body] : []);
  let cam;
  if (S.view === 'grid') {
    const f = gridFrame();
    gridCam.left = f.left; gridCam.right = f.right; gridCam.top = f.halfH; gridCam.bottom = -f.halfH;
    gridCam.updateProjectionMatrix();
    cam = gridCam;
    // słońce w płaszczyźnie gry (XY), z boku: kąt `pora` od kierunku widoku (+Z)
    sunDir.set(Math.sin(S.pora * DEG), 0, Math.cos(S.pora * DEG));
  } else {
    closeCam.aspect = W / H;
    closeCam.updateProjectionMatrix();
    const ce = Math.cos(S.el);
    closeCam.position.set(Math.sin(S.az) * ce * S.dist, Math.sin(S.el) * S.dist, Math.cos(S.az) * ce * S.dist);
    closeCam.lookAt(0, 0, 0);
    cam = closeCam;
    // słońce: kąt `pora` od kamery w poziomie, lekko z góry
    const a = S.az + S.pora * DEG;
    sunDir.set(Math.sin(a), 0.18, Math.cos(a)).normalize();
  }
  for (const b of bodies) {
    b.setSun(sunDir);
    b.step(dt, { spin: S.doba * 0.25, cloudSpin: S.doba * 0.03, rate: S.atmRate });
    if (b.clouds) b.clouds.visible = S.cloudsOn;
    if (b.atm) b.atm.visible = S.haloOn;
  }
  if (!S.paused) {
    pipes[S.view === 'grid' ? 'grid' : 'close'].render();
    // znaczniki czasu klatek odczytywane na bieżąco (pula znaczników ma limit — wypiek mierzy potem tylko siebie)
    if (renderer.backend.trackTimestamp && (++S.frameNo % 20 === 0)) renderer.resolveTimestampsAsync('render');
  }
  drawLabels(cam);
  if ((now | 0) % 20 === 0) updateStat();
  requestAnimationFrame(frame);
}

// Podrodzaj do podpisu: styl, paleta olbrzyma, barwa wody, roślinność.
function subLabel(spec) {
  const L = spec.look;
  if (L.style) return L.style;
  if (typeof L.palette === 'string') return L.palette;
  if (spec.type === 'ocean') return `woda: ${L.tint}`;
  if (L.vegetation) return `roślinność: ${L.vegetation}`;
  return '';
}

function drawLabels(cam) {
  octx.setTransform(DPR, 0, 0, DPR, 0, 0);
  octx.clearRect(0, 0, innerWidth, innerHeight);
  if (!S.labels || S.view !== 'grid' || document.body.classList.contains('test')) return;
  const f = gridFrame();
  octx.font = '11px "Segoe UI", system-ui, sans-serif';
  octx.textAlign = 'center';
  for (const t of S.tiles) {
    const p = t.body.group.position;
    const x = f.cx + p.x / f.s;
    const y = innerHeight / 2 - (p.y - 1.18) / f.s;
    octx.fillStyle = '#8f9cb0';
    octx.fillText(`${PLANET_GEN_TYPE[t.spec.type].name}`, x, y);
    octx.fillStyle = '#5c6878';
    octx.fillText(`${subLabel(t.spec)} · ${t.spec.seed}`, x, y + 13);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Płaska mapa wypieku jako PNG (data URL) — narzędzia zrzutów: which = day | normal | spec | night | clouds; wiersz 0
// celu = biegun S (v = 0), obraz odwrócony do „północ u góry”.
async function mapPng(which = 'day', tile = -1, maxW = 1024) {
  const b = tile < 0 ? S.close?.baked : S.tiles[tile]?.baked;
  const rt = b?.rt?.[which];
  if (!rt) return null;
  const w = rt.width;
  const h = rt.height;
  const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
  const red = which === 'spec';
  const stride = red ? 1 : 4;
  const rowBytes = px.length / h;
  const k = Math.max(1, Math.ceil(w / maxW));
  const W = Math.floor(w / k);
  const H = Math.floor(h / k);
  const cv = new OffscreenCanvas(W, H);
  const cx = cv.getContext('2d');
  const img = cx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const sy = (h - 1 - y * k) * rowBytes;
    for (let x = 0; x < W; x++) {
      const si = sy + x * k * stride;
      const di = (y * W + x) * 4;
      if (red) { img.data[di] = img.data[di + 1] = img.data[di + 2] = px[si]; }
      else { img.data[di] = px[si]; img.data[di + 1] = px[si + 1]; img.data[di + 2] = px[si + 2]; }
      img.data[di + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s2 = '';
  for (let i = 0; i < buf.length; i += 0x8000) s2 += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s2);
}

window.__gen = {
  S, baker, renderer, mapPng,
  ready: () => S.busy === 0 && (S.view === 'close' ? !!S.close : S.tiles.length === COLS * ROWS),
  buildGrid, openClose, setView, describePlanet, plannedBytes,
  types: PLANET_GEN_TYPES
};
requestAnimationFrame(frame);
updateInfo();
const only = params.get('planeta');
if (only) {
  const [type, seed] = only.split(':');
  setView('close');
  openClose(type, Number(seed) >>> 0);
} else {
  buildGrid();
}
