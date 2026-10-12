// Demo KOMET na WebGPU — wszystko jak w grze: Core3D (WebGPU, TSL, bloom, ACES, maska słońca), arkusz gazu i jądro
// z src/3d/comets/ (CometsView), logika z src/game/cometField.js (miejsca, budowa jąder w workerze, obrót, obrys
// kolizji) i src/game/comets.js (orbita, aktywność, warkocze). Po otwarciu od razu: kometa Halleya przy ~0,95 AU —
// jądro z dżetami, zielona koma, niebieski warkocz jonowy i zakrzywiony warkocz pyłowy; Atlas obok dla skali.
//
// Serwowanie: `npm run dev` → /dema/komety-webgpu.html   ?kometa=hale-bopp   ?clean=1 (bez paneli)
//   ?test=1 (klatki tylko z __komety.runFrames — harness zrzutów: scripts/webgpu/komety-demo.mjs)
import { Core3D } from '../src/3d/core3d.js';
import { createBackdrop } from './rdzen-webgpu/tlo.js';
import { COMETS, COMET_TUNE } from '../src/data/comets.js';
import { cometOrbitState, cometGasGeometry, cometSheetExtent } from '../src/game/comets.js';
import { CometField } from '../src/game/cometField.js';
import { CometsView, COMET_VIEW_TUNE } from '../src/3d/comets/comets3D.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
if (params.get('clean') === '1') document.body.classList.add('clean');
const $ = (id) => document.getElementById(id);
function reportError(text) {
  const el = $('errors');
  el.style.display = 'block';
  el.textContent += `${text}\n`;
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

const AU = 42253.52;
const SUN = { x: 6_000_000, y: 6_000_000, r: 823 };
window.SUN = SUN;
window.CometTune = COMET_VIEW_TUNE;

const S = {
  paused: false, speed: 1, time: 0, frameMs: 16, cpuMs: 0,
  cam: { x: 0, y: 0, zoom: 0.08 }, sel: null, follow: true, offX: 0, offY: 0,
  outline: false, ship: true, drag: null, syncPipes: 0, syncNames: []
};

const canvas2d = $('c');
const ctx = canvas2d.getContext('2d');
let W = innerWidth, H = innerHeight;
canvas2d.width = W; canvas2d.height = H;
const glCanvas = $('webgl-layer');
glCanvas.width = W; glCanvas.height = H;
Core3D.init(glCanvas);
Core3D.resize(W, H);
window.Core3D = Core3D;

let field = null;
let view = null;
let backdrop = null;
const atlasImg = new Image();
atlasImg.src = '../assets/capital_ship_rect_v1.png';

// ---------------------------------------------------------------------------
// Kometa i suwak odległości (wylot z peryhelium)

function rRange(def) {
  const o = def.orbit;
  const Q = o.e < 1 ? o.q * (1 + o.e) / (1 - o.e) : Infinity;
  return { lo: o.q, hi: Math.min(5.2, Q) };
}
function nuForR(def, r) {
  const o = def.orbit;
  const p = o.q * (1 + o.e);
  const c = Math.max(-1, Math.min(1, (p / r - 1) / o.e));
  return Math.acos(c) * 180 / Math.PI;
}
function sliderToR(def, v) {
  const { lo, hi } = rRange(def);
  return lo + (hi - lo) * Math.pow(v / 1000, 1.6);
}
function rToSlider(def, r) {
  const { lo, hi } = rRange(def);
  return Math.round(Math.pow(Math.max(0, Math.min(1, (r - lo) / (hi - lo))), 1 / 1.6) * 1000);
}

function setDistance(rAu) {
  const site = S.sel;
  if (!site) return;
  const def = site.def;
  const nu = nuForR(def, rAu);
  site.state = cometOrbitState(def, site.offset, COMET_TUNE, nu);
  site.geo = cometGasGeometry(def, site.state, AU, COMET_TUNE);
  site.x = SUN.x + site.state.ux * site.state.rMap * AU;
  site.y = SUN.y + site.state.uy * site.state.rMap * AU;
  view.refresh(site);
  $('dist-v').textContent = `${site.state.rAu.toFixed(2)} AU`;
}

function select(id) {
  const site = field.sites.find((s) => s.id === id) || field.sites[0];
  S.sel = site;
  for (const b of document.querySelectorAll('#comet-btns button')) b.classList.toggle('on', b.dataset.id === site.id);
  const { lo, hi } = rRange(site.def);
  $('dist-l').textContent = `q ${lo.toFixed(2)}`;
  $('dist-r').textContent = `${hi.toFixed(1)} AU`;
  $('dist').value = String(rToSlider(site.def, site.state.rAu));
  $('dist-v').textContent = `${site.state.rAu.toFixed(2)} AU`;
  setView(site.geo.active ? 'all' : 'nuc');
}

// ---------------------------------------------------------------------------
// Kadry

function tailFrame(site) {
  const g = site.geo;
  return { ax: g.ax, ay: g.ay, yx: -g.ay * g.lagSign, yy: g.ax * g.lagSign };
}

function setView(name) {
  const site = S.sel;
  if (!site) return;
  const g = site.geo;
  const R = site.reach || site.R * 1.3;
  S.offX = 0; S.offY = 0;
  if (name === 'all' && g.active) {
    const e = cometSheetExtent(g);
    const f = tailFrame(site);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const X of [e[0], e[1]]) {
      for (const Y of [e[2], e[3]]) {
        const wx = X * f.ax + Y * f.yx, wy = X * f.ay + Y * f.yy;
        x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
      }
    }
    S.offX = (x0 + x1) * 0.5; S.offY = (y0 + y1) * 0.5;
    S.cam.zoom = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.92;
  } else if (name === 'coma' && g.active) {
    const f = tailFrame(site);
    S.offX = f.ax * g.comaR * 0.6; S.offY = f.ay * g.comaR * 0.6;
    S.cam.zoom = H / (g.comaR * 4.2);
  } else if (name === 'far') {
    S.cam.zoom = 0.035;
  } else {
    S.cam.zoom = H / (R * 3.6);
  }
  S.follow = true;
  for (const [id, v] of [['v-all', 'all'], ['v-coma', 'coma'], ['v-nuc', 'nuc'], ['v-far', 'far']]) $(id).classList.toggle('on', v === name);
}

// ---------------------------------------------------------------------------
// Klatka

function frame(dt) {
  const t0 = performance.now();
  if (!S.paused) S.time += dt * S.speed;
  field.update(S.time);
  if (S.follow && S.sel) { S.cam.x = S.sel.x + S.offX; S.cam.y = S.sel.y + S.offY; }
  const cam = S.cam;
  Core3D.beginPlanetLayerFrame?.();
  view.update(S.time, cam);
  backdrop.sync(cam, W, H);
  Core3D.syncCamera(cam);
  Core3D.render();
  drawOverlay(cam);
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  updateHud();
}

function toS(cam, x, y) {
  return { x: (x - cam.x) * cam.zoom + W * 0.5, y: (y - cam.y) * cam.zoom + H * 0.5 };
}

function drawOverlay(cam) {
  ctx.clearRect(0, 0, W, H);
  const site = S.sel;
  if (!site) return;
  // Atlas dla skali — obok jądra, od strony Słońca
  if (S.ship && atlasImg.complete && atlasImg.naturalWidth) {
    const L = 3000 * cam.zoom;
    if (L > 3) {
      const g = site.geo;
      const d = (site.reach || site.R) + 2600;
      const p = toS(cam, site.x - g.ax * d + g.ay * d * 0.35, site.y - g.ay * d - g.ax * d * 0.35);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(g.ay, g.ax) + Math.PI * 0.5);
      ctx.drawImage(atlasImg, -L / 2, -L * 1677 / 3747 / 2, L, L * 1677 / 3747);
      ctx.restore();
    }
  }
  // obrys kolizji (z góry, obraca się z jądrem)
  if (S.outline && site.ready) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,170,90,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 180; i++) {
      const a = i / 180 * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      const r = field.outlineRadius(site, dx, dy);
      const p = toS(cam, site.x + dx * r, site.y + dy * r);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
  // podziałka
  if (!document.body.classList.contains('clean')) {
    const targetPx = 160;
    const raw = targetPx / cam.zoom;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const unit = [1, 2, 5, 10].map((k) => k * pow).find((v) => v * cam.zoom >= targetPx * 0.6) || pow * 10;
    const px = unit * cam.zoom;
    ctx.save();
    ctx.strokeStyle = 'rgba(220,230,240,0.8)'; ctx.fillStyle = 'rgba(220,230,240,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W - 340 - px, H - 26); ctx.lineTo(W - 340, H - 26);
    ctx.moveTo(W - 340 - px, H - 31); ctx.lineTo(W - 340 - px, H - 21);
    ctx.moveTo(W - 340, H - 31); ctx.lineTo(W - 340, H - 21);
    ctx.stroke();
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(unit >= 1000 ? `${(unit / 1000).toLocaleString('pl-PL')} km` : `${unit} m`, W - 340 - px / 2, H - 36);
    ctx.restore();
  }
}

let hudN = 0;
function updateHud() {
  if (++hudN % 6) return;
  const site = S.sel;
  if (!site) return;
  const g = site.geo;
  const st = site.state;
  const info = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  const km = (v) => `${(v / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} km`;
  const lines = [];
  lines.push(`<b>${(1000 / Math.max(1, S.frameMs)).toFixed(0)} FPS</b> · CPU ${S.cpuMs.toFixed(2)} ms · GPU ${(Number(Core3D.gpuFrameMs) || 0).toFixed(2)} ms · draw ${info.drawCalls ?? info.calls ?? 0}${S.paused ? ' · <span class="warn">PAUZA</span>' : ''}${S.speed !== 1 ? ` · czas ×${S.speed}` : ''}`);
  lines.push(`<b>${site.label}</b> (${site.def.designation}) · ${site.def.familyLabel}`);
  lines.push(`r = ${st.rAu.toFixed(2)} AU (mapa ${st.rMap.toFixed(1)} AU) · v = ${st.vKm.toFixed(1)} km/s · aktywność ${g.activity.toFixed(3)}${g.active ? '' : ' — <span class="warn">uśpiona</span>'}`);
  if (g.active) lines.push(`koma ${km(g.comaR)} · jonowy ${km(g.ionLen)} (${(g.ionLen / AU).toFixed(2)} AU mapy, aberracja ${(g.ionAngle * 57.3).toFixed(1)}°) · pyłowy ${km(g.dustLen)} (wachlarz do ${(g.dustAngle * 57.3).toFixed(0)}°)`);
  lines.push(`jądro ${km(site.R * 2)} · obrót ${site.def.nucleus.rotPeriod} s · ${site.ready ? `<span class="good">zbudowane</span> (${field.stats.buildMs.toFixed(0)} ms w workerze)` : 'buduje się…'} · pipeline'y synchr. w klatkach: <b>${S.syncPipes}</b>`);
  $('hud').innerHTML = lines.join('\n');
}

// ---------------------------------------------------------------------------
// Wejście

const ACTIONS = {
  1: () => setView('all'), 2: () => setView('coma'), 3: () => setView('nuc'), 4: () => setView('far'),
  ' ': () => { S.paused = !S.paused; $('b-pause').classList.toggle('on', S.paused); },
  t: () => { S.speed = S.speed === 1 ? 20 : 1; $('b-fast').classList.toggle('on', S.speed !== 1); },
  g: () => { COMET_VIEW_TUNE.sheet = !COMET_VIEW_TUNE.sheet; $('b-sheet').classList.toggle('on', COMET_VIEW_TUNE.sheet); },
  n: () => { COMET_VIEW_TUNE.nucleus = !COMET_VIEW_TUNE.nucleus; $('b-nuc').classList.toggle('on', COMET_VIEW_TUNE.nucleus); },
  o: () => { S.outline = !S.outline; $('b-outline').classList.toggle('on', S.outline); },
  s: () => { S.ship = !S.ship; $('b-ship').classList.toggle('on', S.ship); },
  h: () => document.body.classList.toggle('clean')
};

function bindInput() {
  const btns = $('comet-btns');
  for (const c of COMETS) {
    const b = document.createElement('button');
    b.dataset.id = c.id;
    b.textContent = c.label.replace('Kometa ', '');
    b.addEventListener('click', () => select(c.id));
    btns.appendChild(b);
  }
  const map = { 'v-all': '1', 'v-coma': '2', 'v-nuc': '3', 'v-far': '4', 'b-pause': ' ', 'b-fast': 't', 'b-sheet': 'g', 'b-nuc': 'n', 'b-outline': 'o', 'b-ship': 's', 'b-clean': 'h' };
  for (const [id, k] of Object.entries(map)) $(id)?.addEventListener('click', () => ACTIONS[k]());
  $('dist').addEventListener('input', (e) => setDistance(sliderToR(S.sel.def, Number(e.target.value))));
  canvas2d.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    S.drag = { x: e.clientX, y: e.clientY };
    canvas2d.classList.add('drag');
  });
  window.addEventListener('mouseup', () => { S.drag = null; canvas2d.classList.remove('drag'); });
  window.addEventListener('mousemove', (e) => {
    if (!S.drag) return;
    S.offX -= (e.clientX - S.drag.x) / S.cam.zoom;
    S.offY -= (e.clientY - S.drag.y) / S.cam.zoom;
    S.drag.x = e.clientX; S.drag.y = e.clientY;
  });
  canvas2d.addEventListener('wheel', (e) => {
    e.preventDefault();
    const bx = S.cam.x + (e.clientX - W * 0.5) / S.cam.zoom, by = S.cam.y + (e.clientY - H * 0.5) / S.cam.zoom;
    S.cam.zoom = Math.min(8, Math.max(0.0015, S.cam.zoom * Math.exp(-e.deltaY * 0.0012)));
    S.offX = bx - (e.clientX - W * 0.5) / S.cam.zoom - S.sel.x;
    S.offY = by - (e.clientY - H * 0.5) / S.cam.zoom - S.sel.y;
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (ACTIONS[k]) { ACTIONS[k](); e.preventDefault(); }
  });
  window.addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    canvas2d.width = W; canvas2d.height = H;
    glCanvas.width = W; glCanvas.height = H;
    Core3D.resize(W, H);
  });
}

// Pipeline'y tworzone SYNCHRONICZNIE w zwykłym renderze (nic ich nie rozgrzało) — po rozgrzewce ma być 0.
function hookPipelines() {
  const pu = Core3D.renderer?.backend?.pipelineUtils;
  if (!pu || pu.__kometyHook) return;
  pu.__kometyHook = true;
  const orig = pu.createRenderPipeline;
  pu.createRenderPipeline = function (ro, promises) {
    if (!promises) {
      S.syncPipes++;
      if (S.syncNames.length < 16) S.syncNames.push(`${ro?.material?.name || ro?.material?.type} @ ${ro?.object?.name || ro?.object?.type}`);
    }
    return orig.call(this, ro, promises);
  };
}

let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  S.frameMs = S.frameMs * 0.9 + dt * 1000 * 0.1;
  if (!TEST) frame(dt);
  requestAnimationFrame(loop);
}

window.__komety = {
  ready: false, S, get field() { return field; }, get view() { return view; },
  act(k) { ACTIONS[k]?.(); return true; },
  select(id) { select(id); return true; },
  setView(name) { setView(name); return true; },
  setR(r) { setDistance(r); $('dist').value = String(rToSlider(S.sel.def, r)); return S.sel.state.rAu; },
  setCam(dx, dy, zoom) { S.offX = dx; S.offY = dy; if (zoom) S.cam.zoom = zoom; S.follow = true; return true; },
  async runFrames(n = 1, fps = 60) {
    for (let i = 0; i < n; i++) {
      frame(1 / fps);
      if ((i % 6) === 5) await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    return true;
  },
  stats() {
    const s = S.sel;
    return {
      kometa: s?.id, rAu: s ? +s.state.rAu.toFixed(3) : null, aktywnosc: s ? +s.geo.activity.toFixed(4) : null,
      zoom: +S.cam.zoom.toFixed(4), czas: +S.time.toFixed(2), syncPipes: S.syncPipes, syncNames: S.syncNames.slice(),
      widoczne: view ? { ...view.stats } : null, gpuMs: +(Number(Core3D.gpuFrameMs) || 0).toFixed(3),
      jadra: field ? field.sites.map((q) => ({ id: q.id, ready: q.ready, reach: Math.round(q.reach) })) : null
    };
  }
};

(async () => {
  try {
    if (!(await Core3D.ready)) {
      $('nogpu').style.display = 'flex';
      $('nogpu-detail').textContent = Core3D.gpuError || 'brak adaptera WebGPU';
      $('loading').style.display = 'none';
      window.__komety.error = 'webgpu';
      return;
    }
    backdrop = createBackdrop(Core3D);
    field = new CometField({ sun: SUN, au: AU, keepOut: [] });
    view = new CometsView(Core3D, field);
    window.CometField = field;
    window.CometsView = view;
    Core3D.warmup.add({ name: 'komety', objects: () => view.warmupMeshes() });
    await field.build();
    await Core3D.warmup.flush?.({ timeoutMs: 8000 });
    hookPipelines();
    bindInput();
    select(params.get('kometa') || 'halley');
    $('loading').style.display = 'none';
    window.__komety.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
  }
})();
