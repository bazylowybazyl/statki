// Demo syntezy dźwięków gry (dema/dzwieki.html): karty dźwięków, suwaki, spektrogram.
// Silnik i przepisy: dema/dzwieki/ (bez DOM — do wpięcia w grę).
import { SoundEngine, paramDefaults, clamp } from './dzwieki/silnik.js';
import { SOUNDS, GROUPS } from './dzwieki/katalog.js';
import { renderSound, analyze, encodeWav } from './dzwieki/pomiar.js';

const $ = (id) => document.getElementById(id);
const G = { vol: $('g-vol'), rev: $('g-rev'), dist: $('g-dist'), pan: $('g-pan'), rand: $('g-rand') };
const OUT = { vol: $('o-vol'), rev: $('o-rev'), dist: $('o-dist'), pan: $('o-pan') };
const statusEl = $('status');
const vizEl = $('viz');

let ctx = null;
let E = null;
const active = new Map(); // id → uchwyt dźwięku ciągłego
const cards = new Map(); // id → { def, card, play, params }

function ensureAudio() {
  if (!E) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    E = new SoundEngine(ctx, { seed: Date.now() >>> 0 });
    applyGlobals();
    vizEl.classList.add('live');
    updateStatus();
  }
  if (ctx.state !== 'running') ctx.resume();
  return E;
}

// ---- ustawienia ogólne

const pct = (v) => Math.round(v * 100) + '%';
const panLabel = (v) => (Math.abs(v) < 0.02 ? 'środek' : (v < 0 ? 'L ' : 'P ') + Math.round(Math.abs(v) * 100));

function applyGlobals() {
  OUT.vol.textContent = pct(+G.vol.value);
  OUT.rev.textContent = pct(+G.rev.value);
  OUT.dist.textContent = pct(+G.dist.value);
  OUT.pan.textContent = panLabel(+G.pan.value);
  if (!E) return;
  E.setVolume(+G.vol.value);
  E.setReverb(+G.rev.value);
  E.space.dist = +G.dist.value;
  E.space.pan = +G.pan.value;
}
for (const k of ['vol', 'rev', 'dist', 'pan']) G[k].addEventListener('input', applyGlobals);
applyGlobals();

function positionFor(def) {
  if (def.ui || !G.rand.checked) return {};
  return { pan: E.pick(-0.85, 0.85), dist: E.pick(0.05, 0.8) };
}

function updateStatus() {
  if (!E) return;
  const running = ctx.state === 'running';
  statusEl.classList.toggle('on', running);
  statusEl.textContent = running
    ? `Audio działa · ${(ctx.sampleRate / 1000).toFixed(1)} kHz · głosy: ${E.voices.size}`
    : 'Audio wstrzymane — kliknij dźwięk';
}

// ---- karty

function fmt(q, v) {
  if (q.marks) {
    const i = Math.round(((v - q.min) / (q.max - q.min)) * (q.marks.length - 1));
    return q.marks[clamp(i, 0, q.marks.length - 1)];
  }
  if (q.unit) return (q.step < 1 ? (+v).toFixed(1) : String(Math.round(v))) + q.unit;
  if (q.step >= 1) return String(Math.round(v));
  return Math.round(v * 100) + '%';
}

function setParam(def, id, v, params) {
  params[id] = v;
  const h = active.get(def.id);
  if (h) h.set(id, v);
}

function paramControl(def, q, params) {
  if (q.toggle) {
    const lab = document.createElement('label');
    lab.className = 'check';
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.checked = !!params[q.id];
    inp.addEventListener('change', () => setParam(def, q.id, inp.checked ? 1 : 0, params));
    lab.append(inp, document.createTextNode(q.name));
    return lab;
  }
  const lab = document.createElement('label');
  lab.className = 'row';
  const name = document.createElement('span');
  name.textContent = q.name;
  const out = document.createElement('output');
  let inp;
  if (q.options) {
    inp = document.createElement('select');
    for (const [v, text] of q.options) inp.append(new Option(text, v));
    inp.value = params[q.id];
    inp.addEventListener('change', () => setParam(def, q.id, inp.value, params));
  } else {
    inp = document.createElement('input');
    inp.type = 'range';
    inp.min = q.min;
    inp.max = q.max;
    inp.step = q.step;
    inp.value = params[q.id];
    out.textContent = fmt(q, params[q.id]);
    inp.addEventListener('input', () => {
      const v = +inp.value;
      out.textContent = fmt(q, v);
      setParam(def, q.id, v, params);
    });
  }
  lab.append(name, out, inp);
  return lab;
}

function setPlayLabel(entry, on) {
  entry.play.textContent = entry.def.hold ? (on ? '■ Stop' : '▶ Włącz') : '▶ Graj';
  entry.card.classList.toggle('on', on);
}

function startHold(entry) {
  const eng = ensureAudio();
  const h = eng.play(entry.def, entry.params, positionFor(entry.def));
  active.set(entry.def.id, h);
  setPlayLabel(entry, true);
}

function stopHold(entry) {
  const h = active.get(entry.def.id);
  if (h) h.release();
  active.delete(entry.def.id);
  setPlayLabel(entry, false);
}

function fire(entry) {
  const eng = ensureAudio();
  eng.play(entry.def, entry.params, positionFor(entry.def));
  const c = entry.card;
  c.classList.remove('flash');
  void c.offsetWidth;
  c.classList.add('flash');
  clearTimeout(entry.flashT);
  entry.flashT = setTimeout(() => c.classList.remove('flash'), 220);
}

function wire(entry) {
  const { def, play } = entry;
  play.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    play.focus({ preventScroll: true });
    if (!def.hold) {
      fire(entry);
      return;
    }
    if (active.has(def.id)) {
      stopHold(entry);
      return;
    }
    startHold(entry);
    // krótkie stuknięcie — zostaje włączony; przytrzymanie — gra, póki trzymasz
    const t0 = performance.now();
    try {
      play.setPointerCapture(e.pointerId);
    } catch (_) {
      /* wskaźnik już nieaktywny */
    }
    const up = () => {
      play.removeEventListener('pointerup', up);
      play.removeEventListener('pointercancel', up);
      if (performance.now() - t0 > 350 && active.has(def.id)) stopHold(entry);
    };
    play.addEventListener('pointerup', up);
    play.addEventListener('pointercancel', up);
  });
  play.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
    e.preventDefault();
    if (!def.hold) fire(entry);
    else if (active.has(def.id)) stopHold(entry);
    else startHold(entry);
  });
}

async function exportWav(entry, btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '…';
  try {
    const buf = await renderSound(entry.def, entry.params, { seed: Date.now() >>> 0, reverb: +G.rev.value, hold: entry.def.wavHold ?? 3 });
    const url = URL.createObjectURL(encodeWav(buf));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry.def.id}.wav`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.error('[dzwieki] eksport WAV', err);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function buildCard(def) {
  const params = paramDefaults(def);
  const card = document.createElement('article');
  card.className = 'card';
  const head = document.createElement('div');
  head.className = 'card-head';
  const h3 = document.createElement('h3');
  h3.textContent = def.name;
  const kind = document.createElement('span');
  kind.className = 'kind';
  kind.textContent = def.hold ? 'ciągły' : 'jednorazowy';
  head.append(h3, kind);
  const desc = document.createElement('p');
  desc.className = 'desc';
  desc.textContent = def.desc;
  card.append(head, desc);
  if (def.params?.length) {
    const ps = document.createElement('div');
    ps.className = 'params';
    for (const q of def.params) ps.append(paramControl(def, q, params));
    card.append(ps);
  }
  const actions = document.createElement('div');
  actions.className = 'actions';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'play';
  const wav = document.createElement('button');
  wav.type = 'button';
  wav.className = 'wav';
  wav.textContent = 'WAV';
  wav.title = 'Pobierz WAV (render offline)';
  actions.append(play, wav);
  card.append(actions);
  const entry = { def, card, play, params, flashT: 0 };
  cards.set(def.id, entry);
  setPlayLabel(entry, false);
  wire(entry);
  wav.addEventListener('click', () => exportWav(entry, wav));
  return card;
}

const main = $('groups');
for (const g of GROUPS) {
  const sec = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = g;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const def of SOUNDS) if (def.group === g) grid.append(buildCard(def));
  sec.append(h2, grid);
  main.append(sec);
}

function stopAll() {
  if (E) E.stopAll();
  for (const id of [...active.keys()]) {
    const en = cards.get(id);
    active.delete(id);
    if (en) setPlayLabel(en, false);
  }
}
$('stop').addEventListener('click', stopAll);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') stopAll();
});

// ---- spektrogram i przebieg

const spec = $('spec');
const scope = $('scope');
const sctx = spec.getContext('2d', { alpha: false });
const octx = scope.getContext('2d');
const FMIN = 30;
const FMAX = 18000;
const GRID = [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
let W = 0;
let H = 0;
let dpr = 1;
let rows = null;
let freq = null;
let wave = null;
let column = null;
let meter = 0;
let frameN = 0;

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = vizEl.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (w === W && h === H) return;
  W = w;
  H = h;
  spec.width = scope.width = W;
  spec.height = scope.height = H;
  sctx.fillStyle = '#04060a';
  sctx.fillRect(0, 0, W, H);
  rows = null;
  column = null;
}
new ResizeObserver(resize).observe(vizEl);
resize();

const LUT = (() => {
  const stops = [[0, [4, 6, 10]], [0.22, [28, 16, 68]], [0.45, [110, 28, 110]], [0.65, [214, 64, 80]], [0.82, [252, 150, 60]], [1, [252, 246, 190]]];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let j = 0;
    while (j < stops.length - 2 && x > stops[j + 1][0]) j++;
    const [x0, c0] = stops[j];
    const [x1, c1] = stops[j + 1];
    const u = (x - x0) / (x1 - x0);
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = c0[k] + (c1[k] - c0[k]) * u;
  }
  return lut;
})();

// Wiersz y → przedział binów (szeroki wiersz: maksimum) albo ułamek binu (wąski: interpolacja).
function buildRows(an) {
  const binHz = an.context.sampleRate / an.fftSize;
  const nb = an.frequencyBinCount;
  const b0 = new Int32Array(H);
  const b1 = new Int32Array(H);
  const fr = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const fTop = FMAX * Math.pow(FMIN / FMAX, y / H);
    const fBot = FMAX * Math.pow(FMIN / FMAX, (y + 1) / H);
    const fMid = Math.sqrt(fTop * fBot) / binHz;
    if (fTop / binHz - fBot / binHz < 1) {
      b0[y] = clamp(Math.floor(fMid), 1, nb - 2);
      b1[y] = -1;
      fr[y] = fMid - Math.floor(fMid);
    } else {
      b0[y] = clamp(Math.floor(fBot / binHz), 1, nb - 1);
      b1[y] = clamp(Math.ceil(fTop / binHz), b0[y], nb - 1);
    }
  }
  return { b0, b1, fr };
}

function draw() {
  requestAnimationFrame(draw);
  if (!E || !W) return;
  const an = E.analyser;
  if (!freq) {
    freq = new Float32Array(an.frequencyBinCount);
    wave = new Float32Array(an.fftSize);
  }
  if (!rows) rows = buildRows(an);
  an.getFloatFrequencyData(freq);
  const step = Math.max(1, Math.round(2 * dpr));
  sctx.drawImage(spec, -step, 0);
  if (!column || column.width !== step || column.height !== H) column = sctx.createImageData(step, H);
  const d = column.data;
  const { b0, b1, fr } = rows;
  for (let y = 0; y < H; y++) {
    let v;
    if (b1[y] < 0) {
      const a = freq[b0[y]];
      v = a + (freq[b0[y] + 1] - a) * fr[y];
    } else {
      v = -200;
      for (let b = b0[y]; b <= b1[y]; b++) if (freq[b] > v) v = freq[b];
    }
    const li = ((clamp((v + 100) / 78, 0, 1) * 255) | 0) * 3;
    for (let x = 0; x < step; x++) {
      const o = (y * step + x) * 4;
      d[o] = LUT[li];
      d[o + 1] = LUT[li + 1];
      d[o + 2] = LUT[li + 2];
      d[o + 3] = 255;
    }
  }
  sctx.putImageData(column, W - step, 0);

  octx.clearRect(0, 0, W, H);
  octx.font = `${10 * dpr}px system-ui, sans-serif`;
  octx.lineWidth = 1;
  octx.strokeStyle = 'rgba(125,138,160,0.16)';
  octx.fillStyle = 'rgba(125,138,160,0.75)';
  for (const [f, label] of GRID) {
    const y = Math.round((H * Math.log(FMAX / f)) / Math.log(FMAX / FMIN)) + 0.5;
    octx.beginPath();
    octx.moveTo(0, y);
    octx.lineTo(W, y);
    octx.stroke();
    octx.fillText(label, 6 * dpr, y - 3 * dpr);
  }
  an.getFloatTimeDomainData(wave);
  let pk = 0;
  for (let i = 0; i < wave.length; i++) {
    const a = Math.abs(wave[i]);
    if (a > pk) pk = a;
  }
  const mid = H * 0.82;
  const amp = H * 0.15;
  octx.strokeStyle = 'rgba(216,224,236,0.5)';
  octx.lineWidth = Math.max(1, dpr);
  octx.beginPath();
  for (let x = 0; x < W; x++) {
    const y = mid - wave[Math.floor((x / W) * wave.length)] * amp;
    if (x) octx.lineTo(x, y);
    else octx.moveTo(x, y);
  }
  octx.stroke();
  // miernik szczytu z opadaniem
  meter = Math.max(pk, meter * 0.93);
  const db = 20 * Math.log10(meter + 1e-9);
  const top = 8 * dpr;
  const span = H - 16 * dpr;
  const mh = clamp((db + 60) / 60, 0, 1) * span;
  const mx = W - 10 * dpr;
  octx.fillStyle = 'rgba(30,39,53,0.9)';
  octx.fillRect(mx, top, 4 * dpr, span);
  octx.fillStyle = db > -1 ? '#ff6b5f' : db > -6 ? '#ffb347' : '#8ef0b0';
  octx.fillRect(mx, top + span - mh, 4 * dpr, mh);
  octx.textAlign = 'right';
  octx.fillStyle = 'rgba(216,224,236,0.8)';
  octx.fillText(db > -90 ? `${db.toFixed(1)} dB` : '−∞ dB', mx - 6 * dpr, 16 * dpr);
  octx.textAlign = 'left';
  if ((frameN++ & 15) === 0) updateStatus();
}
requestAnimationFrame(draw);

// ---- pomiar (konsola): await __dzwieki.measureAll()

window.__dzwieki = {
  get engine() {
    return E;
  },
  SOUNDS,
  async measure(id, params = {}, opts = {}) {
    const def = SOUNDS.find((s) => s.id === id);
    const buf = await renderSound(def, params, opts);
    return analyze(buf);
  },
  async measureAll(opts = {}) {
    const out = [];
    for (const def of SOUNDS) {
      const t0 = performance.now();
      const buf = await renderSound(def, {}, { hold: 3, ...opts });
      out.push({ id: def.id, ms: Math.round(performance.now() - t0), ...analyze(buf) });
    }
    return out;
  },
};
