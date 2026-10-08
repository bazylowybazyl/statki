// ============================================================
// Wypiekacz nieba (dema/niebo-webgpu.html): SkyBaker + style „galaktyka” / „mgławica” (src/3d/skybake/).
//
// Wypiek liczy teksturę raz (pełna albo ½ rozdzielczości), podgląd próbkuje ją jak NebulaSystem
// (dwuliniowo, wartości po dekodowaniu sRGB) i pokazuje postem gry: bloom gry → ACES gry → sRGB.
// Kadr GRA: środek tekstury w powiększeniu gry (płaszczyzna 800 × 500 tys. j. na z = −150 000,
// kamera 35°, src/3d/planet3d.assets.js NebulaSystem + core3d.js syncCamera) przy zoomie i 1080p.
// Widok A/B 1:1: ten sam kadr z tekstury (powiększonej jak w grze) albo z KAFLA wypieczonego w
// gęstości ekranu (piksel kafla = piksel ekranu; SkyBaker.setRegion, atlas światła pożyczony od
// wypieku bazowego), bez i z dodatkowymi oktawami detalu — czy kafle wysokiej rozdzielczości się opłacą.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  abs, float, ivec2, max, mix, nodeObject, screenCoordinate, screenUV, select, step, texture, textureLoad,
  uniform, vec2, vec3, vec4
} from 'three/tsl';
import { BloomGry } from '../src/3d/tsl/postGry.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import { resizeRenderTarget } from '../src/3d/renderTargetResize.js';
import { SkyBaker, SKY_GAME_SIZE } from '../src/3d/skybake/skyBaker.js';
import { createGalaktykaStyle } from '../src/3d/skybake/styleGalaktyka.js';
import { createMglawicaStyle } from '../src/3d/skybake/styleMglawica.js';
import { srgbDecodeCpu, srgbEncodeCpu } from '../src/3d/skybake/skyGameColor.js';

/** Style wypiekacza: nazwa → fabryka (lista w panelu i w ?styl=). */
const STYLES = Object.freeze({ galaktyka: createGalaktykaStyle, mglawica: createMglawicaStyle });

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const errEl = $('err');
function showError(text) { errEl.style.display = 'block'; errEl.textContent += `${text}\n`; console.error(text); }
window.addEventListener('error', (e) => showError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => showError(`Promise: ${e.reason?.stack || e.reason}`));
if (params.get('test') === '1') $('panel').classList.add('hidden');

const DEG = Math.PI / 180;
const NEBULA_PLANE = Object.freeze({ width: 800000, height: 500000, z: -150000, fovDeg: 35 });
const MENU_PATCH = Object.freeze({ heightFrac: 0.42, gain: 1.15 });

/** Kadr gry na teksturze (w tekselach eksportu) przy zoomie i wysokości okna (core3d.js syncCamera). */
export function gameWindowTexels(viewW, viewH, zoom) {
  const half = NEBULA_PLANE.fovDeg * 0.5 * DEG;
  const targetZ = (viewH / 2) / Math.tan(half) / Math.max(1e-4, zoom);
  const visH = 2 * (targetZ - NEBULA_PLANE.z) * Math.tan(half);
  const th = visH / (NEBULA_PLANE.height / SKY_GAME_SIZE.height);
  return { w: th * viewW / viewH, h: th };
}

const renderer = new THREE.WebGPURenderer({ antialias: false });
// Natywna rozdzielczość ekranu (HiDPI: przy pixelRatio 1 przeglądarka powiększała podgląd drugi raz); ?dpr=1 — jak dawniej.
const DPR = Math.max(0.5, Math.min(3, Number(params.get('dpr')) || window.devicePixelRatio || 1));
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 1);
document.body.appendChild(renderer.domElement);
await renderer.init();
if (!renderer.backend?.isWebGPUBackend) showError('WebGPU niedostępne — wypiekacz wymaga WebGPU.');

const styleName0 = STYLES[params.get('styl')] ? params.get('styl') : 'galaktyka';
let style = STYLES[styleName0]();
// Domyślnie PEŁNA rozdzielczość (jak tekstura gry); ?res=0.5 — szybki podgląd przy strojeniu suwakami.
let resScale = Number(params.get('res') || 1);
const baker = new SkyBaker(renderer, { width: Math.round(SKY_GAME_SIZE.width * resScale), height: Math.round(SKY_GAME_SIZE.height * resScale) });
baker.setStyle(style);

// ── Podgląd: jeden RenderPipeline, widok wybierany uniformem ──────────────────
const uOff = uniform(new THREE.Vector2(0, 0));
const uScale = uniform(new THREE.Vector2(1, 1));
const uGain = uniform(1);
const uMode = uniform(0);     // 0 — tekstura postem gry, 1 — pola (debug)
const uBloom = uniform(1);
// A/B 1:1: położenie kafla w uv tekstury tła, wariant (1 tekstura, 2 kafel 1:1, 3 kafel + oktawy, 4 podział).
const uTileOff = uniform(new THREE.Vector2(0, 0));
const uTileScale = uniform(new THREE.Vector2(1, 1));
const uTileOn = uniform(0);
const uAbMode = uniform(1);
const uAbRight = uniform(3);  // podział: kafel po prawej (2 / 3), tekstura po lewej
const uLineW = uniform(0.001);
const srcUv = uOff.add(screenUV.mul(uScale));
const inside = step(0.0, srcUv.x).mul(step(0.0, srcUv.y)).mul(step(srcUv.x, 1.0)).mul(step(srcUv.y, 1.0));
// Widok „pola”: styl podaje pass i odwzorowanie (style.debug), domyślnie pola galaktyki (R = L, G = τ, B = ρ).
const DEBUG_DEFAULT = { pass: 'pola', view: (f) => vec3(f.x.mul(0.45), f.y.mul(0.18), f.z.mul(0.5)) };

/** Cel kafla A/B (HalfFloat, liniowo jak tekstura wypieku) — rozmiar = kanwa (piksel kafla = piksel ekranu). */
function makeAbTarget(w, h) {
  const rt = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.generateMipmaps = false;
  renderer.initRenderTarget(rt);
  return rt;
}
/** [0] — kafel 1:1, [1] — kafel 1:1 + dodatkowe oktawy. */
const abRT = [makeAbTarget(4, 4), makeAbTarget(4, 4)];

const pipeline = new THREE.RenderPipeline(renderer);
function buildPipeline() {
  const texNode = texture(baker.texture, srcUv);
  const dbgSpec = style.debug || DEBUG_DEFAULT;
  const polaNode = texture(baker.target(dbgSpec.pass).texture, srcUv);
  // Kafel A/B: uv kafla z uv tekstury (kadr przesunięty po wypieku — kafel zostaje na swoim miejscu nieba).
  const tileUv = srcUv.sub(uTileOff).div(uTileScale);
  const inTile = step(0.0, tileUv.x).mul(step(0.0, tileUv.y)).mul(step(tileUv.x, 1.0)).mul(step(tileUv.y, 1.0)).mul(uTileOn);
  const variant = select(uAbMode.lessThan(3.5), uAbMode, select(screenUV.x.greaterThan(0.5), uAbRight, float(1.0)));
  const tileRgb = select(variant.greaterThan(2.5), texture(abRT[1].texture, tileUv).rgb, texture(abRT[0].texture, tileUv).rgb);
  const useTile = variant.greaterThan(1.5).and(inTile.greaterThan(0.5));
  const src = select(useTile, tileRgb, texNode.rgb).mul(uGain).mul(inside);
  const bloom = nodeObject(new BloomGry(vec4(src, 1.0), BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold));
  const lin = src.add(bloom.rgb.mul(uBloom));
  const game = linearDoSrgb(acesGry(max(lin, vec3(0.0))));
  const dbg = dbgSpec.view(polaNode).mul(inside).min(vec3(1.0));
  // Podział: cienka linia na środku kadru.
  const line = select(uAbMode.greaterThan(3.5), step(abs(screenUV.x.sub(0.5)), uLineW), float(0.0)).mul(uTileOn);
  pipeline.outputNode = vec4(mix(select(uMode.greaterThan(0.5), dbg, game), vec3(0.75), line), 1.0);
  pipeline.outputColorTransform = false;
  pipeline.needsUpdate = true;
}
buildPipeline();

const VIEWS = ['gra', 'menu', 'calosc', 'pola', 'ab'];
const S = {
  styl: styleName0,
  preset: params.get('preset') || 'gra',
  seed: Number(params.get('seed') || 1),
  values: {},
  view: VIEWS.includes(params.get('widok')) ? params.get('widok') : 'gra',
  zoom: 0.45,
  viewH: 1080,
  /** Kadr GRA / A/B: przesunięcie środka (teksele tekstury 5120 × 3200) i lupa (× powiększenie gry). */
  pan: { x: Number(params.get('panX') || 0), y: Number(params.get('panY') || 0) },
  lupa: Math.max(1, Number(params.get('lupa') || 1)),
  bakeMs: 0,
  dirty: true
};

/** Stan A/B: wariant, kafel w podziale, dodatkowe oktawy (0 — auto z gęstości), ostatni wypiek kafla. */
const AB = { mode: 4, right: 3, okt: 0, stale: true, tile: null };
const LUPY = [1, 1.5, 2, 3, 4, 6, 8];
/** Dodatkowe oktawy „auto”: tyle, ile podwojeń gęstości względem tekstury 5120 (≥ 1). */
const autoOctaves = (k) => Math.max(1, Math.round(Math.log2(Math.max(1, k))));

function currentParams() {
  return { ...style.defaults, ...(style.presets[S.preset] || {}), ...S.values };
}

function setView(name, o = {}) {
  S.view = name;
  if (o.zoom !== undefined) S.zoom = o.zoom;
  if (o.viewH !== undefined) S.viewH = o.viewH;
  const W = renderer.domElement.width || innerWidth;
  const H = renderer.domElement.height || innerHeight;
  const aspect = W / H;
  const tw = SKY_GAME_SIZE.width;
  const th = SKY_GAME_SIZE.height;
  uMode.value = name === 'pola' ? 1 : 0;
  uGain.value = name === 'menu' ? MENU_PATCH.gain : 1;
  uBloom.value = o.bloom === false ? 0 : 1;
  if (o.lupa !== undefined) S.lupa = o.lupa;
  if (o.pan !== undefined) S.pan = { x: o.pan.x, y: o.pan.y };
  if (o.abMode !== undefined) AB.mode = o.abMode;
  let sx = 1;
  let sy = 1;
  let cx = 0.5;
  let cy = 0.5;
  if (name === 'gra' || name === 'ab') {
    const win = gameWindowTexels(S.viewH * aspect, S.viewH, S.zoom);
    sx = win.w / tw / S.lupa;
    sy = win.h / th / S.lupa;
    cx = 0.5 + S.pan.x / tw;
    cy = 0.5 + S.pan.y / th;
  } else if (name === 'menu') {
    sy = MENU_PATCH.heightFrac;
    sx = sy * aspect * th / tw;
  } else {
    // całość / pola: cała tekstura w kadrze (pasy po bokach)
    const texAspect = tw / th;
    if (aspect > texAspect) { sy = 1; sx = aspect / texAspect; } else { sx = 1; sy = texAspect / aspect; }
  }
  uScale.value.set(sx, sy);
  uOff.value.set(cx - sx * 0.5, cy - sy * 0.5);
  uTileOn.value = name === 'ab' && AB.tile ? 1 : 0;
  uAbMode.value = AB.mode;
  uAbRight.value = AB.right;
  uLineW.value = 0.75 / W;
  for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.v === name);
  for (const b of document.querySelectorAll('#ab-modes button')) b.classList.toggle('on', Number(b.dataset.m) === AB.mode);
  $('ab-panel').style.display = name === 'ab' ? '' : 'none';
  abLabel();
}

/** Powiększenie tekstury bazowej na ekranie (piksele ekranu na teksel wypieku bazowego) w bieżącym widoku. */
function baseMagnification() {
  return (renderer.domElement.height || innerHeight) / (uScale.value.y * baker.height);
}

/** Etykiety A/B nad kadrem (HTML — zrzuty harnessu ich nie łapią). */
function abLabel() {
  const el = $('ab-label');
  if (S.view !== 'ab') { el.textContent = ''; return; }
  const T = AB.tile;
  const tex = `[1] TEKSTURA ${baker.width}×${baker.height} · powiększenie ${baseMagnification().toFixed(2)}×`;
  const t1 = T ? `[2] KAFEL 1:1 · gęstość ${T.k.toFixed(2)}× (jak ekran ${Math.round(T.k * T.rows)} wierszy)` : '[2] KAFEL 1:1 — wypiek…';
  const t2 = T ? `[3] KAFEL 1:1 + ${T.okt} okt.` : '[3] KAFEL 1:1 + oktawy — wypiek…';
  const stale = T && AB.stale ? ' · nieaktualny' : '';
  const lbl = (text, x) => `<span class="lbl" style="left:${x}%">${text}</span>`;
  if (AB.mode === 4) el.innerHTML = lbl(tex, 25) + lbl((AB.right === 3 ? t2 : t1) + stale, 75);
  else el.innerHTML = lbl([tex, t1, t2][AB.mode - 1] + (AB.mode > 1 ? stale : ''), 50);
}

async function bake() {
  style.apply(currentParams(), S.seed, baker);
  S.bakeMs = await baker.bake();
  S.dirty = false;
  AB.stale = true;
  status();
  return S.bakeMs;
}

// ── A/B 1:1: kafel bieżącego kadru w gęstości ekranu ──────────────────────────
let tileBaker = null;
let copyQuad = null;
let copySrc = null;

/** Kopia tekstury kafla do celu wariantu (textureLoad 1:1). */
function copyTile(dst) {
  const src = tileBaker.texture;
  if (src !== copySrc) {
    copyQuad?.material.dispose();
    const m = new THREE.NodeMaterial();
    m.name = 'SkyBake:kopia-kafla';
    m.fragmentNode = vec4(textureLoad(src, ivec2(screenCoordinate.xy)).rgb, 1.0);
    m.blending = THREE.NoBlending;
    m.depthTest = false;
    m.depthWrite = false;
    copyQuad = new THREE.QuadMesh(m);
    copySrc = src;
  }
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(dst);
  copyQuad.render(renderer);
  renderer.setRenderTarget(prev);
}

/**
 * Wypiek kafla bieżącego kadru (A/B): kafel = kanwa (W × H pikseli), gęstość k = piksele ekranu na teksel
 * tekstury 5120 × 3200, pełne niebo 5120k × 3200k, początek = lewy górny róg kadru — piksel kafla trafia
 * dokładnie w piksel ekranu. Dwa warianty: bez i z dodatkowymi oktawami (te same nastawy i ziarno co tło).
 */
async function bakeTiles() {
  setView(S.view);
  const W = renderer.domElement.width;
  const H = renderer.domElement.height;
  if (W < 2 || H < 2) return AB.tile;   // kanwa bez rozmiaru (ukryta karta) — kafel przy następnym resize
  const su = uScale.value.x;
  const sv = uScale.value.y;
  const u0 = uOff.value.x;
  const v0 = uOff.value.y;
  const k = H / (sv * SKY_GAME_SIZE.height);
  const fullW = SKY_GAME_SIZE.width * k;
  const fullH = SKY_GAME_SIZE.height * k;
  const region = { fullWidth: fullW, fullHeight: fullH, x: u0 * fullW, y: v0 * fullH, width: W, height: H };
  if (!tileBaker) {
    tileBaker = new SkyBaker(renderer, { ...region, shared: baker });
    tileBaker.setRegion(region);
    tileBaker.setStyle(style);
  } else {
    tileBaker.setRegion(region);
  }
  for (const rt of abRT) resizeRenderTarget(rt, W, H, renderer);
  const okt = AB.okt > 0 ? AB.okt : autoOctaves(k);
  const ms = [0, 0];
  for (const [slot, extra] of [[0, 0], [1, okt]]) {
    tileBaker.extraOctaves = extra;
    style.apply(currentParams(), S.seed, tileBaker);
    ms[slot] = await tileBaker.bake();
    copyTile(abRT[slot]);
  }
  const win = gameWindowTexels(S.viewH * (W / H), S.viewH, S.zoom);
  AB.tile = { k, W, H, okt, ms, rows: win.h, passMs: { ...tileBaker.passMs } };
  AB.stale = false;
  uTileOff.value.set(u0, v0);
  uTileScale.value.set(su, sv);
  status();
  return AB.tile;
}

// Kolejka pracy GPU: wypiek bazowy i kafle nigdy naraz (bake() czeka na GPU między pasami).
const want = { base: false, tile: false };
let busy = false;
async function kick() {
  if (busy) return;
  busy = true;
  try {
    while (want.base || want.tile) {
      if (want.base) {
        want.base = false;
        await bake();
        if (S.view === 'ab') want.tile = true;
        render();
        continue;
      }
      want.tile = false;
      if (S.view === 'ab') {
        await bakeTiles();
        render();
      }
    }
  } catch (err) {
    showError(String(err?.stack || err));
  } finally {
    busy = false;
  }
}
/** Praca na wyłączność z kolejką (zrzuty A/B, eksport): czeka na koniec wypieku, potem wznawia kolejkę. */
async function exclusive(fn) {
  while (busy) await new Promise((ok) => setTimeout(ok, 50));
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
    if (want.base || want.tile) kick();
  }
}
let tileTimer = 0;
/** Kafel do ponownego wypieku (kadr, lupa, rozmiar kanwy, oktawy); w innym widoku — przy wejściu w A/B. */
function scheduleTiles(delay = 160) {
  AB.stale = true;
  clearTimeout(tileTimer);
  abLabel();
  if (S.view !== 'ab') return;
  tileTimer = setTimeout(() => { want.tile = true; kick(); }, delay);
}

function setViewByName(name) {
  S.view = name;
  render();
  if (name === 'ab' && (AB.stale || !AB.tile)) scheduleTiles(0);
}

function setAbMode(m) {
  AB.mode = m;
  if (m === 2 || m === 3) AB.right = m;
  if (S.view !== 'ab') setViewByName('ab');
  else render();
}

function render() {
  setView(S.view);
  pipeline.render();
}

function status(extra = '') {
  const passy = Object.entries(baker.passMs || {}).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ');
  const T = AB.tile;
  const ab = S.view === 'ab' && T
    ? `\na/b: kafel ${T.W} × ${T.H} (${(T.W * T.H / 1e6).toFixed(1)} Mpx) · gęstość ${T.k.toFixed(2)}× · 1:1 ${T.ms[0].toFixed(0)} ms · +${T.okt} okt. ${T.ms[1].toFixed(0)} ms`
    : '';
  $('status').textContent = `${baker.width} × ${baker.height} · wypiek ${S.bakeMs.toFixed(0)} ms · ziarno ${S.seed} · ${S.styl}/${S.preset}${passy ? `\n${passy}` : ''}${ab}${extra ? `\n${extra}` : ''}`;
}

/** Zmiana stylu: nowe passy wypiekacza, podgląd i panel od nowa; nastawa z listy nowego stylu. */
function setStyleByName(name) {
  if (!STYLES[name] || name === S.styl) return false;
  style = STYLES[name]();
  S.styl = name;
  S.values = {};
  if (!style.presets[S.preset]) S.preset = Object.keys(style.presets)[0];
  baker.setStyle(style);
  buildPipeline();
  buildParams();
  S.dirty = true;
  return true;
}

async function setRes(scale) {
  if (Math.abs(scale - resScale) < 1e-6) return;
  resScale = scale;
  baker.setSize(Math.round(SKY_GAME_SIZE.width * scale), Math.round(SKY_GAME_SIZE.height * scale));
  buildPipeline();
  S.dirty = true;
}

// ── Panel ─────────────────────────────────────────────────────────────────────
const toHex = (lin) => '#' + lin.map((v) => Math.round(Math.min(1, Math.max(0, srgbEncodeCpu(v))) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => [1, 3, 5].map((i) => srgbDecodeCpu(parseInt(hex.slice(i, i + 2), 16) / 255));
const inputs = new Map();
function buildParams() {
  const host = $('params');
  host.textContent = '';
  inputs.clear();
  const groups = new Map();
  const groupEl = (g) => {
    if (!groups.has(g)) {
      const d = document.createElement('details');
      d.innerHTML = `<summary>${g}</summary>`;
      host.appendChild(d);
      groups.set(g, d);
    }
    return groups.get(g);
  };
  for (const [k, label, min, maxV, stepV, , group] of style.params) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${maxV}" step="${stepV}"><output></output>`;
    const inp = row.querySelector('input');
    const out = row.querySelector('output');
    inp.addEventListener('input', () => { S.values[k] = Number(inp.value); out.textContent = inp.value; schedule(); });
    inputs.set(k, { inp, out });
    groupEl(group).appendChild(row);
  }
  const cg = groupEl('barwy');
  for (const [k, label] of style.colors) {
    const row = document.createElement('div');
    row.className = 'crow';
    row.innerHTML = `<span>${label}</span><input type="color">`;
    const inp = row.querySelector('input');
    inp.addEventListener('input', () => { S.values[k] = fromHex(inp.value); schedule(); });
    inputs.set(k, { inp, color: true });
    cg.appendChild(row);
  }
  const sel = $('preset');
  sel.textContent = '';
  for (const name of Object.keys(style.presets)) sel.add(new Option(name, name));
  sel.value = S.preset;
  $('title').textContent = `WYPIEK NIEBA · ${S.styl.toUpperCase()}`;
  syncPanel();
}
function buildPanel() {
  const ss = $('styl');
  for (const name of Object.keys(STYLES)) ss.add(new Option(name, name));
  ss.value = S.styl;
  ss.addEventListener('change', () => { if (setStyleByName(ss.value)) { $('preset').value = S.preset; schedule(); } });
  const sel = $('preset');
  sel.addEventListener('change', () => { S.preset = sel.value; S.values = {}; syncPanel(); schedule(); });
  $('seed').value = String(S.seed);
  $('seed').addEventListener('change', () => { S.seed = Math.max(1, Number($('seed').value) || 1); schedule(); });
  $('rnd').addEventListener('click', () => { S.seed = 1 + Math.floor(Math.random() * 999998); $('seed').value = String(S.seed); schedule(); });
  $('res').value = String(resScale);
  $('res').addEventListener('change', async () => { await setRes(Number($('res').value)); schedule(); });
  $('zoom').addEventListener('input', () => {
    S.zoom = Number($('zoom').value);
    $('o-zoom').textContent = S.zoom.toFixed(2);
    render();
    scheduleTiles();
  });
  $('o-zoom').textContent = S.zoom.toFixed(2);
  for (const b of document.querySelectorAll('#views button')) b.addEventListener('click', () => setViewByName(b.dataset.v));
  for (const b of document.querySelectorAll('#ab-modes button')) b.addEventListener('click', () => setAbMode(Number(b.dataset.m)));
  const lupa = $('lupa');
  for (const v of LUPY) lupa.add(new Option(`×${String(v).replace('.', ',')}`, String(v)));
  lupa.value = String(S.lupa);
  lupa.addEventListener('change', () => { setLupa(Number(lupa.value)); });
  const okt = $('okt');
  okt.add(new Option('auto (z gęstości)', '0'));
  for (let i = 1; i <= 4; i++) okt.add(new Option(`+${i}`, String(i)));
  okt.addEventListener('change', () => { AB.okt = Number(okt.value); scheduleTiles(0); });
  $('export').addEventListener('click', () => exportDownload());
  $('copy').addEventListener('click', () => {
    const txt = JSON.stringify({ preset: S.preset, seed: S.seed, values: S.values }, null, 1);
    navigator.clipboard?.writeText(txt).catch(() => {});
    console.log(txt);
    status('nastawy skopiowane (i w konsoli)');
  });
  addEventListener('keydown', (e) => {
    if (e.target !== document.body || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'h') $('panel').classList.toggle('hidden');
    else if (k >= '1' && k <= '4' && k.length === 1) setAbMode(Number(k));
  });
  buildParams();
}

/** Lupa (× powiększenie kadru gry); `at` — punkt ekranu (ułamki kanwy), który zostaje w miejscu. */
function setLupa(v, at = null) {
  const tw = SKY_GAME_SIZE.width;
  const th = SKY_GAME_SIZE.height;
  if (at && (S.view === 'gra' || S.view === 'ab')) {
    const u = uOff.value.x + at.x * uScale.value.x;
    const w = uOff.value.y + at.y * uScale.value.y;
    const r = S.lupa / v;
    S.pan.x = (u - (at.x - 0.5) * uScale.value.x * r - 0.5) * tw;
    S.pan.y = (w - (at.y - 0.5) * uScale.value.y * r - 0.5) * th;
  }
  S.lupa = v;
  $('lupa').value = String(v);
  render();
  scheduleTiles();
}

/** Kadr GRA / A/B: przeciągnięcie przesuwa, kółko — lupa (wokół kursora), dwuklik — środek tekstury, lupa ×1. */
function bindViewMouse() {
  const cv = renderer.domElement;
  let drag = null;
  const framed = () => S.view === 'gra' || S.view === 'ab';
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !framed()) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved = true;
    S.pan.x -= dx * uScale.value.x * SKY_GAME_SIZE.width / cv.clientWidth;
    S.pan.y -= dy * uScale.value.y * SKY_GAME_SIZE.height / cv.clientHeight;
    render();
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) scheduleTiles();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('dblclick', () => {
    if (!framed()) return;
    S.pan = { x: 0, y: 0 };
    setLupa(1);
  });
  cv.addEventListener('wheel', (e) => {
    if (!framed()) return;
    e.preventDefault();
    let i = LUPY.findIndex((v) => v >= S.lupa - 1e-6);
    if (i < 0) i = LUPY.length - 1;
    const ni = Math.max(0, Math.min(LUPY.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
    if (LUPY[ni] === S.lupa) return;
    setLupa(LUPY[ni], { x: e.clientX / cv.clientWidth, y: e.clientY / cv.clientHeight });
  }, { passive: false });
}
function syncPanel() {
  const P = currentParams();
  for (const [k, el] of inputs) {
    if (el.color) el.inp.value = toHex(P[k]);
    else { el.inp.value = String(P[k]); el.out.textContent = String(P[k]); }
  }
}
let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { want.base = true; kick(); }, 120);
}

function exportDownload() {
  // Na wyłączność z kolejką wypieku (cele wypiekacza są wspólne).
  return exclusive(exportDownloadNow);
}
async function exportDownloadNow() {
  const prev = resScale;
  status('eksport: wypiek w pełnej rozdzielczości…');
  await setRes(1);
  await bake();
  const blob = await baker.exportPngBlob(S.seed);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nebula-${S.styl}-${S.preset}-${S.seed}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  if (prev !== 1) { await setRes(prev); await bake(); }
  render();
  status(`zapisano ${a.download} (${(blob.size / 1048576).toFixed(1)} MB)`);
}

addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); render(); scheduleTiles(); });

// ── API dla narzędzi (scripts/webgpu/niebo-arkusz.mjs) ────────────────────────
const readbackRT = new Map();
/** Kanwa na czas zrzutu: w × h pikseli (pixelRatio 1); zwraca przywrócenie poprzedniego rozmiaru. */
function canvasFor(w, h) {
  const prevPR = renderer.getPixelRatio();
  const prev = renderer.getSize(new THREE.Vector2());
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  return () => {
    renderer.setPixelRatio(prevPR);
    renderer.setSize(prev.x, prev.y, false);
  };
}
async function snapshot(view, w, h, o = {}) {
  const restore = canvasFor(w, h);
  setView(view, o);
  const key = `${w}x${h}`;
  let rt = readbackRT.get(key);
  if (!rt) { rt = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false }); readbackRT.set(key, rt); }
  renderer.setOutputRenderTarget(rt);
  pipeline.render();
  renderer.setOutputRenderTarget(null);
  const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
  restore();
  const stride = Math.ceil(w * 4 / 256) * 256;
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray(y * stride, y * stride + w * 4), y * w * 4);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  const cv = new OffscreenCanvas(w, h);
  cv.getContext('2d').putImageData(img, 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(blob);
}
function blobToDataUrl(blob) {
  return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
}
let exportChunks = null;
async function exportPrepare(seed = S.seed, type = 'image/png', quality = 0.92) {
  const blob = await baker.exportBlob(seed, type, quality);
  const url = await blobToDataUrl(blob);
  const b64 = url.slice(url.indexOf(',') + 1);
  const CH = 4 * 1024 * 1024;
  exportChunks = [];
  for (let i = 0; i < b64.length; i += CH) exportChunks.push(b64.slice(i, i + CH));
  return { bytes: blob.size, chunks: exportChunks.length, width: baker.width, height: baker.height };
}
/** Arkusz: { width, height, items: [{ src, x, y, w, h, label? }], texts?: [{ text, x, y, size?, color? }] } → PNG data URL. */
async function composeSheet(spec) {
  const cv = new OffscreenCanvas(spec.width, spec.height);
  const c = cv.getContext('2d');
  c.fillStyle = spec.background || '#0b0d12';
  c.fillRect(0, 0, spec.width, spec.height);
  c.imageSmoothingQuality = 'high';
  for (const it of spec.items) {
    const blob = await (await fetch(it.src)).blob();
    const bmp = await createImageBitmap(blob);
    let { x, y, w, h } = it;
    if (it.fit) {   // dopasuj z zachowaniem proporcji, wyśrodkuj w polu
      const k = Math.min(w / bmp.width, h / bmp.height);
      const dw = bmp.width * k; const dh = bmp.height * k;
      x += (w - dw) / 2; y += (h - dh) / 2; w = dw; h = dh;
    }
    if (it.crop) c.drawImage(bmp, it.crop[0], it.crop[1], it.crop[2], it.crop[3], x, y, w, h);
    else c.drawImage(bmp, x, y, w, h);
    if (it.label) {
      c.font = '600 15px system-ui, sans-serif';
      c.fillStyle = 'rgba(0,0,0,.6)';
      c.fillRect(it.x, it.y, c.measureText(it.label).width + 12, 22);
      c.fillStyle = '#e8eefc';
      c.fillText(it.label, it.x + 6, it.y + 16);
    }
  }
  for (const t of spec.texts || []) {
    c.font = `600 ${t.size || 18}px system-ui, sans-serif`;
    c.fillStyle = t.color || '#e8eefc';
    c.fillText(t.text, t.x, t.y);
  }
  return blobToDataUrl(await cv.convertToBlob({ type: 'image/png' }));
}

window.__demo = {
  ready: false,
  S, baker, renderer, STYLES,
  get style() { return style; },
  params: () => ({ styl: S.styl, preset: S.preset, seed: S.seed, values: { ...S.values } }),
  /** Styl + nastawa + ziarno + wartości (nadpisuje poprzednie wartości). */
  configure: (o = {}) => {
    if (o.styl !== undefined) setStyleByName(o.styl);
    if (o.preset !== undefined) S.preset = o.preset;
    if (o.seed !== undefined) S.seed = o.seed;
    if (o.values !== undefined) S.values = { ...o.values };
    syncPanel();
    S.dirty = true;
    return true;
  },
  setStyle: setStyleByName,
  passMs: () => ({ ...baker.passMs }),
  setRes,
  bake,
  view: (name, o) => { S.view = name; setView(name, o); pipeline.render(); return true; },
  snapshot,
  gameWindowTexels,
  exportPrepare,
  exportChunk: (i) => exportChunks?.[i] ?? null,
  composeSheet,
  /**
   * A/B 1:1 w zrzucie: kadr (pan, lupa, zoom) → kafel w × h pikseli wypieczony dla tego kadru → zrzuty
   * wariantów `modes` (1 tekstura, 2 kafel 1:1, 3 kafel + oktawy, 4 podział). Zwraca { tile, shots: { m: dataURL } }.
   */
  abShots: ({ w = 1920, h = 1080, lupa = 1, pan = { x: 0, y: 0 }, zoom, okt, modes = [1, 2, 3] } = {}) => exclusive(async () => {
    if (zoom !== undefined) S.zoom = zoom;
    if (okt !== undefined) AB.okt = okt;
    S.lupa = lupa;
    S.pan = { x: pan.x, y: pan.y };
    S.view = 'ab';
    const restore = canvasFor(w, h);
    let tile;
    try { tile = await bakeTiles(); } finally { restore(); }
    const shots = {};
    for (const m of modes) shots[m] = await snapshot('ab', w, h, { abMode: m });
    // Kanwa wróciła do rozmiaru okna — kafel dla niej przy najbliższej okazji (harness ?test=1 — nie).
    if (!params.get('test')) scheduleTiles();
    else AB.stale = true;
    return { tile: { ...tile }, shots };
  }),
  bakeTiles
};

buildPanel();
bindViewMouse();
try {
  await bake();
  render();
  if (S.view === 'ab') scheduleTiles(0);
  window.__demo.ready = true;
} catch (err) {
  window.__demo.error = String(err?.stack || err);
  showError(window.__demo.error);
}
