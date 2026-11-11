// Demo MAPY TERENU (src/3d/planetGen/planetGenTerrainMap.js) — trzeci poziom szczegółowości planety: wycinek
// kilkudziesięciu kilometrów dla jednego miejsca (cel ostrzału z orbity, strefa desantu). Obraz to gotowa warstwa
// barw z generatora na kanwie 2D (ocena wyglądu); w grze te same warstwy trafią do materiału TSL.
//   ?rzeka=meandry|wielka|roztoki|delta  ?ros=tajga|tropik|czerwona|purpura|zlota  ?ziarno=N  ?roz=1024|2048
//   ?km=5…80 (domyślnie ze stylu rzeki)  ?szer=szerokość koryta [m]
// Sterowanie: przeciąganie — przesuw, kółko — zoom, „Losuj miejsce” — nowe ziarno, listy — styl rzeki i roślinność.

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : d);
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const ctx = canvas.getContext('2d');

// style rzek: nazwa na liście i domyślny bok mapy [km] (skala, w której styl dobrze widać)
const RIVERS = {
  delta: ['delta i morze', 40], wielka: ['wielka rzeka z wyspami', 40], meandry: ['rzeka nizinna (zakola)', 40], roztoki: ['rzeka roztokowa', 16]
};
const VEGS = { tropik: 'zielona (tropik)', tajga: 'tajga', czerwona: 'czerwona', purpura: 'purpurowa', zlota: 'złota' };

const S = {
  seed: num('ziarno', 4) >>> 0,
  size: num('roz', 2048) === 1024 ? 1024 : 2048,
  river: RIVERS[params.get('rzeka')] ? params.get('rzeka') : 'delta',
  veg: VEGS[params.get('ros')] ? params.get('ros') : 'tropik',
  km: 0,
  riverW: Math.min(2000, Math.max(0, num('szer', 0))),
  bitmap: null, mapSize: 0, mapKm: 0, stats: null,
  cx: 0.5, cy: 0.5, zoom: 1,          // środek kadru w ułamkach mapy, zoom: piksele ekranu na teksel mapy
  job: 0, busy: false
};
const kmFor = () => (params.has('km') ? Math.min(80, Math.max(5, num('km', 40))) : RIVERS[S.river][1]);

for (const [id, list, cur] of [['river', Object.entries(RIVERS).map(([k, v]) => [k, v[0]]), S.river], ['veg', Object.entries(VEGS), S.veg]]) {
  const el = $(id);
  for (const [k, label] of list) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = label;
    if (k === cur) o.selected = true;
    el.appendChild(o);
  }
}

const worker = new Worker(new URL('./mapa-terenu.worker.js', import.meta.url), { type: 'module' });
worker.onmessage = async (ev) => {
  const m = ev.data;
  if (m.id !== S.job) return;
  S.busy = false;
  $('load').style.display = 'none';
  if (m.error) { $('info').textContent = `Błąd: ${m.error}`; return; }
  const img = new ImageData(new Uint8ClampedArray(m.albedo), m.size, m.size);
  S.bitmap = await createImageBitmap(img);
  S.mapSize = m.size;
  S.mapKm = m.extentKm;
  S.stats = m.stats;
  fit();
  draw();
  window.__teren = { ready: true, seed: m.seed, stats: m.stats, size: m.size, river: S.river, veg: S.veg };
};

function generate() {
  S.busy = true;
  S.job++;
  S.km = kmFor();
  $('load').style.display = 'flex';
  $('seed').value = String(S.seed);
  if (window.__teren) window.__teren.ready = false;
  worker.postMessage({ id: S.job, opts: { seed: S.seed, size: S.size, extentKm: S.km, river: S.river, veg: S.veg, riverWidthM: S.riverW } });
}

// kadr na start: mapa wypełnia dłuższy bok okna
function fit() {
  S.zoom = Math.max(canvas.width, canvas.height) / S.mapSize;
  S.cx = 0.5;
  S.cy = 0.5;
  clampView();
}
function clampView() {
  const zMin = Math.min(canvas.width, canvas.height) / S.mapSize;
  // (górna granica: 3 piksele ekranu na teksel — głębiej widać już tylko rozmyte teksele)
  S.zoom = Math.min(3, Math.max(zMin, S.zoom));
  const hw = canvas.width / (2 * S.zoom * S.mapSize);
  const hh = canvas.height / (2 * S.zoom * S.mapSize);
  S.cx = hw >= 0.5 ? 0.5 : Math.min(1 - hw, Math.max(hw, S.cx));
  S.cy = hh >= 0.5 ? 0.5 : Math.min(1 - hh, Math.max(hh, S.cy));
}

function draw() {
  ctx.fillStyle = '#0b0f0e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!S.bitmap) return;
  const n = S.mapSize;
  const sw = canvas.width / S.zoom;
  const sh = canvas.height / S.zoom;
  const sx = S.cx * n - sw / 2;
  const sy = S.cy * n - sh / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(S.bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  // podziałka
  const dpr = devicePixelRatio || 1;
  const mPerPx = S.mapKm * 1000 / n / S.zoom;
  const want = 160 * dpr * mPerPx;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const len = steps.reduce((b, s) => (Math.abs(s - want) < Math.abs(b - want) ? s : b), steps[0]);
  $('scale').querySelector('i').style.width = `${(len / mPerPx / dpr).toFixed(0)}px`;
  $('scale').querySelector('b').textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
  const st = S.stats;
  $('info').textContent = `${RIVERS[S.river][0]} · roślinność ${VEGS[S.veg]} · ziarno ${S.seed} · ${S.mapKm} × ${S.mapKm} km · teksel ${(S.mapKm * 1000 / n).toFixed(1)} m`
    + (st ? ` · generacja ${(st.ms / 1000).toFixed(1)} s` : '');
}

function resize() {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  if (S.bitmap) { clampView(); draw(); }
}
addEventListener('resize', resize);

let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || !S.bitmap) return;
  const dpr = devicePixelRatio || 1;
  S.cx = drag.cx - (e.clientX - drag.x) * dpr / (S.zoom * S.mapSize);
  S.cy = drag.cy - (e.clientY - drag.y) * dpr / (S.zoom * S.mapSize);
  clampView();
  draw();
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!S.bitmap) return;
  const dpr = devicePixelRatio || 1;
  const n = S.mapSize;
  // punkt pod kursorem zostaje w miejscu
  const mx = S.cx + (e.clientX * dpr - canvas.width / 2) / (S.zoom * n);
  const my = S.cy + (e.clientY * dpr - canvas.height / 2) / (S.zoom * n);
  const z0 = S.zoom;
  S.zoom *= Math.exp(-e.deltaY * 0.0015);
  clampView();
  S.cx = mx - (mx - S.cx) * z0 / S.zoom;
  S.cy = my - (my - S.cy) * z0 / S.zoom;
  clampView();
  draw();
}, { passive: false });

$('roll').addEventListener('click', () => { if (S.busy) return; S.seed = (Math.imul(S.seed ^ 0x9E3779B9, 0x85EBCA6B) + 0x1234567) >>> 0; generate(); });
$('seed').addEventListener('change', () => { const v = Number($('seed').value); if (Number.isFinite(v) && !S.busy) { S.seed = v >>> 0; generate(); } });
$('river').addEventListener('change', () => { if (S.busy) { $('river').value = S.river; return; } S.river = $('river').value; generate(); });
$('veg').addEventListener('change', () => { if (S.busy) { $('veg').value = S.veg; return; } S.veg = $('veg').value; generate(); });

resize();
generate();
