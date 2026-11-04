// Demo wyglądu KONTAKTU czujników (etap 1, 2026-11-04; plan i decyzje: docs/PLAN-kontakt-czujnikow.md).
// Kontakt = „coś tam jest, ale nie wiesz co” (wykryty czujnikami, niezidentyfikowany). Cztery propozycje w TSL na
// Core3D (dema/kontakty-czujnikow/kontaktyTSL.js): 1 ECHO (plama-echo luminoforu), 2 OBŁOK (zakłócenia), 3 WIR (masa,
// soczewka), 4 RÓJ (drobiny prawdopodobieństwa); 0 — dzisiejszy znacznik prototypu (przerywane koło z „?”).
// Dane przykładowe jak w prototypie zasięgu radarów (src/game/sensorPicture.js w gałęzi prototypu): kontakt =
// { x, y — miejsce PRZYBLIŻONE (odświeżane co 0,2 s, przesunięcie wędruje płynnie jak `contactOffset`), err, klasa }.
// Między odświeżeniami obraz goni miejsce wykładniczo (τ 0,45 s) — skok co 0,2 s nie wychodzi na ekran.
//
// Serwowanie: `npm run dev` → /dema/kontakty-czujnikow.html
//   ?wariant=0..4|porownanie   ?scena=plansza|gra   ?podpisy=0   ?daleko=1   ?clean=1 (bez paneli)
//   ?tryb=wachlarze (klawisz W): WACHLARZE namierzania „) ) )” przy okręcie gracza — 1 PULS, 2 FALA, 3 ISKRY,
//     0 dziś (rysunek 2D prototypu), 5 porównanie; ?wachlarz=puls|fala|iskry|dzis|porownanie
//   ?test=1 (klatki tylko z __kontakty.runFrames — zrzuty: scripts/webgpu/kontakty-demo.mjs)
import { Core3D } from '../src/3d/core3d.js';
import {
  createContactBlock, createContactMesh, createSpaceBackdrop, KONTAKT_STYLES, KONTAKT_MAX, KONTAKT_HDR,
  KONTAKT_NOISE_TILE, wrap01
} from './kontakty-czujnikow/kontaktyTSL.js';
import { createFanDemo } from './kontakty-czujnikow/wachlarzeDemo.js';
import { FX_DISTORT_LAYER } from '../src/3d/fx/fxFrame.js';

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

// Klasy rozmiaru kontaktu (contactSizeClass: MAŁY / ŚREDNI / DUŻY / OGROMNY). R — promień „ciała” kontaktu [j.]
// (symboliczny, nie kadłub), minPx — najmniejszy promień na ekranie (CIC / daleki zoom), masa — waga w polu.
const SIZE = [
  { name: 'MAŁY', R: 380, mass: 0.8, minPx: 6 },
  { name: 'ŚREDNI', R: 600, mass: 1.0, minPx: 8 },
  { name: 'DUŻY', R: 900, mass: 1.25, minPx: 10 },
  { name: 'OGROMNY', R: 1350, mass: 1.6, minPx: 13 }
];
const VARIANTS = ['dzis', 'echo', 'oblok', 'wir', 'roj', 'porownanie'];
const TITLES = { dzis: 'DZIŚ (prototyp)', echo: '1 · ECHO', oblok: '2 · OBŁOK', wir: '3 · WIR', roj: '4 · RÓJ', porownanie: 'PORÓWNANIE 2 × 2' };
const DESC = {
  dzis: 'Dzisiejszy znacznik prototypu zasięgu radarów: przerywane koło niepewności z „?” i napisem rozmiaru (grupy bliskie na ekranie — jeden znak „? ×N”). Dla porównania.',
  echo: '<b>Plama-echo luminoforu.</b> Kilka płatów krąży wokół punktu i zlewa się w jedną morfującą plamę (metakule). Jasny brzeg jak echo na tarczy PPI, w środku warstwice — cięższy kontakt ma ich więcej. Plama jaśnieje, gdy przejdzie wiązka radaru Atlasa (2,4 s), i gaśnie jak luminofor. Niepewność rozsuwa płaty i rozmywa brzeg; przerywana obwiednia = gdzie kontakt może być. Flota = jedna plama.',
  oblok: '<b>Obłok zakłóceń.</b> Miękka, zawirowana chmura z pasmami interferencji, rwanymi wierszami jak zakłócony odbiór i rzadkim „śniegiem” sygnału. Cięższy = gęstszy, z cieplejszym rdzeniem; niepewność = szersza, rzadsza, bardziej postrzępiona chmura. Flota = jeden obłok.',
  wir: '<b>Wir masy</b> — w duchu sygnatur masy mgły wojny. Ciemne jądro połyka tło, wokół soczewka (gwiazdy wyginają się), spiralny pył ciepłej barwy i cienki fioletowy horyzont. Cięższy = większe jądro, mocniejsza soczewka, szybszy wir; niepewność rozmywa horyzont i poszerza pył. Flota = kilka jąder w jednym wirze.',
  roj: '<b>Rój drobin prawdopodobieństwa.</b> Iskry rozbłyskują tam, gdzie kontakt może być (gęstość = prawdopodobieństwo), i krążą wokół środka jak rój; każda żyje ~1 s i odradza się gdzie indziej. Cięższy = gęstszy, większy rój; niepewność = szerszy i rzadszy; flota = roje przenikają się nad wspólną poświatą.',
  porownanie: 'Wszystkie cztery naraz: w każdej ćwiartce cztery rozmiary (MAŁY → OGROMNY), flota pięciu i para, która się zbliża i rozchodzi.'
};

// WACHLARZE namierzania (tryb W): semantyka z prototypu — niebieska połówka = MÓJ zasięg względem grupy, czerwona = ICH
// zasięg względem mnie (mój ślad sygnałowy), zapalonych łuków = ułamek × 7, grot = sięga; zmienia się tylko wygląd.
const FAN_VARIANTS = ['dzis', 'puls', 'fala', 'iskry', null, 'porownanie'];
const FAN_TITLES = { dzis: 'DZIŚ (prototyp)', puls: '1 · PULS', fala: '2 · FALA', iskry: '3 · ISKRY', porownanie: 'PORÓWNANIE 2 × 2' };
const FAN_DESC = {
  dzis: 'Dzisiejsze wachlarze prototypu (rysunek 2D): łuki ) ) ) — niebieska połówka = MÓJ zasięg względem grupy, czerwona = ICH zasięg względem mnie; zapalonych łuków = ułamek × 7, grot = sięga.',
  puls: '<b>Puls.</b> Łuki świecą z poświatą, a od okrętu biegnie po nich puls — tym szybszy, im bliżej progu (jak bicie serca). Przy przekroczeniu 1 rozbłysk: pierścień przelatuje przez wachlarz, łuki się żarzą i migoczą, grot oddycha poświatą. Radar zgadnięty — czerwień w kreskach.',
  fala: '<b>Fala.</b> Grzbiety fal płyną od okrętu do granicy zasięgu i NAPRAWDĘ zginają tło (refrakcja z aberracją barw — warstwa DIST Core3D). Po przekroczeniu 1 przez wachlarz co chwilę przechodzi fala uderzeniowa. Radar zgadnięty — grzbiety rwane.',
  iskry: '<b>Iskry.</b> Strumień iskier płynie od okrętu do granicy zasięgu (jak RÓJ kontaktów), pod spodem cienkie łuki skali, na granicy migocący front. Po przekroczeniu 1 iskry dolatują do grota, który iskrzy. Radar zgadnięty — iskier mniej i słabsze.',
  porownanie: 'Trzy warianty i dzisiejszy rysunek naraz: przy okręcie cztery grupy — daleko, przy progu (przechodzi przez 1 — rozbłysk), sięga, radar zgadnięty.'
};

// Model miejsca kontaktu jak w prototypie (sensorDetection.js: contactErrFrac 0,07, contactJitterSec 2,5; wzrok 18 km
// Atlasa, wykrycie przez pancernik ~58,5 km) — kopia wzoru, bo moduł prototypu nie jest jeszcze w repozytorium.
const ERR_FRAC = 0.07;
const JITTER_SEC = 2.5;
const REFRESH_SEC = 0.2;
const FOLLOW_TAU = 0.45;
const IDENT_R = 18000;
const DETECT_R = 58500;

const S = {
  mode: params.get('tryb') === 'wachlarze' ? 'wachlarze' : 'kontakty',
  fanVariant: Math.max(0, FAN_VARIANTS.indexOf(params.get('wachlarz') || 'puls')),
  variant: Math.max(0, VARIANTS.indexOf(params.get('wariant') || 'echo')),
  scene: params.get('scena') === 'gra' ? 'gra' : 'plansza',
  time: Number(params.get('t')) || 0,
  paused: false, labels: params.get('podpisy') !== '0', truth: false, far: params.get('daleko') === '1',
  cam: { x: 0, y: 0, zoom: 0.035 }, offX: 0, offY: 0, drag: null,
  frameMs: 16, cpuMs: 0, syncPipes: 0, syncNames: [],
  contacts: [], captions: [], observer: null, vision: 0, sweepOn: 1
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

const atlasImg = new Image();
atlasImg.src = '../assets/capital_ship_rect_v1.png';
let blocks = null;   // blok kontaktów na propozycję (porównanie: każda ćwiartka tylko swoje kontakty)
let meshes = null;
let fans = null;     // tryb wachlarzy (wachlarzeDemo.js)
let backdrop = null;

// ---------------------------------------------------------------------------
// Miejsce przybliżone (wzór contactOffset: dwa losowania w kole err, płynne przejście co JITTER_SEC; hasz zamiast
// Math.random — zasada 9)

function hash01(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function contactOffset(id, time, err, out) {
  const u = time / JITTER_SEC;
  const k = Math.floor(u);
  let f = u - k;
  f = f * f * (3 - 2 * f);
  const a0 = hash01(id, k, 11) * Math.PI * 2, r0 = Math.sqrt(hash01(id, k, 23));
  const a1 = hash01(id, k + 1, 11) * Math.PI * 2, r1 = Math.sqrt(hash01(id, k + 1, 23));
  out.x = (Math.cos(a0) * r0 + (Math.cos(a1) * r1 - Math.cos(a0) * r0) * f) * err;
  out.y = (Math.sin(a0) * r0 + (Math.sin(a1) * r1 - Math.sin(a0) * r0) * f) * err;
  return out;
}
function errAtDistance(d) {
  const t = Math.max(0, Math.min(1, (d - IDENT_R) / (DETECT_R - IDENT_R)));
  return ERR_FRAC * d * t;
}

// ---------------------------------------------------------------------------
// Sceny (świat gry: x w prawo, y w dół; j. = m). Kontakt: { id, cls, err, quad, move(t, c) → c.tx / c.ty, label }

let nextId = 1;
function contact(cls, err, move, extra = {}) {
  return {
    id: nextId++, cls, err, errBase: err, move, quad: -1, label: null,
    tx: 0, ty: 0, sx: 0, sy: 0, mx: 0, my: 0, last: -1e9, born: 0, alpha: 0,
    seed: hash01(nextId, 7, 3), ...extra
  };
}
const drift = (ax, ay, amp, ph) => (t, c) => {
  c.tx = ax + amp * Math.sin(0.11 * t + ph);
  c.ty = ay + amp * Math.cos(0.09 * t + ph * 1.7);
};
function fleet(ax, ay, members, err, k = 1, quad = -1) {
  const out = [];
  members.forEach(([dx, dy, cls], i) => {
    out.push(contact(cls, err, (t, c) => {
      const gx = ax + 600 * k * Math.sin(0.07 * t), gy = ay + 400 * k * Math.cos(0.05 * t);
      c.tx = gx + dx * k + 150 * Math.sin(0.4 * t + i * 1.3);
      c.ty = gy + dy * k + 150 * Math.cos(0.33 * t + i * 2.1);
    }, { quad }));
  });
  return out;
}
function pair(ax, ay, sMin, sMax, period, err, cls, quad = -1) {
  const sep = (t) => (sMin + sMax) / 2 + (sMax - sMin) / 2 * Math.sin((2 * Math.PI * t) / period - Math.PI / 2);
  return [0, 1].map((side) => contact(cls, err, (t, c) => {
    const a = 0.35 + 0.08 * t + side * Math.PI;
    const r = sep(t) / 2;
    c.tx = ax + Math.cos(a) * r;
    c.ty = ay + Math.sin(a) * r * 0.6;
  }, { quad }));
}

function scenePlansza() {
  const C = [];
  const cap = [];
  const xs = [-15000, -8000, -500, 7000];
  xs.forEach((x, cls) => C.push(contact(cls, 900, drift(x, -6800, 220, cls * 1.9), { label: SIZE[cls].name })));
  cap.push({ x: -4250, y: -11300, text: 'ROZMIAR — ta sama niepewność ±0,9 km' });
  [[-11500, 250], [-3500, 1300], [5500, 2600]].forEach(([x, err], i) => {
    C.push(contact(2, err, drift(x, 4300, 180, 4 + i), { label: `DUŻY ±${(err / 1000).toLocaleString('pl-PL')} km` }));
  });
  cap.push({ x: -3000, y: 9900, text: 'NIEPEWNOŚĆ — ten sam DUŻY bliżej i dalej' });
  C.push(...fleet(16000, -5200, [[0, 0, 3], [-2300, 1300, 2], [2100, -1500, 2], [-1100, -2500, 0], [2600, 1700, 0], [500, 2900, 1]], 900));
  cap.push({ x: 16000, y: -10600, text: 'FLOTA ×6 (OGROMNY, 2 DUŻE, ŚREDNI, 2 MAŁE)' });
  C.push(...pair(16000, 6300, 1000, 7000, 16, 800, 1));
  cap.push({ x: 16000, y: 10300, text: 'PARA — zbliża się i rozchodzi' });
  return { contacts: C, captions: cap, observer: { x: -19500, y: 9400 }, vision: 0 };
}

function sceneGra() {
  const C = [];
  const atlas = { x: -17000, y: 1500 };
  C.push(...fleet(13500, -3500, [[0, 0, 2], [-1800, 1100, 1], [1500, -1300, 1], [-900, -2000, 0], [2200, 900, 0]], 0));
  C.push(contact(1, 0, drift(4500, 9000, 400, 1.1)));
  for (let i = 0; i < 3; i++) {
    C.push(contact(0, 0, (t, c) => {
      const a = 0.22 * t + i * 2.094;
      c.tx = 1500 + Math.cos(a) * 1800;
      c.ty = -9500 + Math.sin(a) * 1800;
    }));
  }
  C.push(contact(3, 0, drift(20500, 7500, 300, 2.7)));
  for (const c of C) c.errFromDistance = true;
  return {
    contacts: C, observer: atlas, vision: IDENT_R,
    captions: [{ x: atlas.x, y: atlas.y + IDENT_R + 900, text: 'zasięg wzroku Atlasa 18 km — dalej tylko KONTAKT' }]
  };
}

const QUAD_STYLE = ['echo', 'oblok', 'wir', 'roj'];
function quadCenter(q) { return { x: (q % 2 ? 1 : -1) * 11250, y: (q < 2 ? -1 : 1) * 6330 }; }
function scenePorownanie() {
  const C = [];
  for (let q = 0; q < 4; q++) {
    const c0 = quadCenter(q);
    [-7800, -2800, 2200, 7400].forEach((dx, cls) => C.push(contact(cls, 700, drift(c0.x + dx, c0.y - 2300, 150, cls + q), { quad: q, label: SIZE[cls].name })));
    C.push(...fleet(c0.x - 4300, c0.y + 3400, [[0, 0, 3], [-1800, 900, 1], [1700, -900, 1], [-700, -1700, 0], [1900, 1300, 0]], 700, 0.85, q));
    C.push(...pair(c0.x + 5300, c0.y + 3400, 800, 5200, 16, 700, 1, q));
  }
  return { contacts: C, captions: [], observer: { x: -22000, y: 0 }, vision: 0, quads: true };
}

function setScene() {
  nextId = 1;
  if (S.mode === 'wachlarze') {
    fans.setScene(S.fanVariant === 5, quadCenter);
    S.contacts = []; S.captions = []; S.observer = null; S.vision = 0; S.quads = S.fanVariant === 5;
    S.offX = 0; S.offY = 0;
    applyZoom();
    return;
  }
  const sc = S.variant === 5 ? scenePorownanie() : (S.scene === 'gra' ? sceneGra() : scenePlansza());
  S.contacts = sc.contacts;
  S.captions = sc.captions;
  S.observer = sc.observer;
  S.vision = sc.vision;
  S.quads = !!sc.quads;
  if (S.contacts.length > KONTAKT_MAX) throw new Error(`za dużo kontaktów: ${S.contacts.length}`);
  for (const c of S.contacts) {
    c.move(S.time, c);
    c.born = S.time - 1.2 * hash01(c.id, 5, 9);
    c.last = -1e9;
    refreshShown(c, true);
  }
  S.offX = 0; S.offY = 0;
  applyZoom();
}

function refreshShown(c, snap) {
  if (c.errFromDistance && S.observer) {
    const d = Math.hypot(c.tx - S.observer.x, c.ty - S.observer.y);
    c.err = errAtDistance(d);
    c.dist = d;
  }
  const o = contactOffset(c.id, S.time, c.err, _off);
  c.sx = c.tx + o.x;
  c.sy = c.ty + o.y;
  c.last = S.time;
  if (snap) { c.mx = c.sx; c.my = c.sy; }
}
const _off = { x: 0, y: 0 };

function stepContacts(dt) {
  const k = 1 - Math.exp(-dt / FOLLOW_TAU);
  for (const c of S.contacts) {
    c.move(S.time, c);
    if (S.time - c.last >= REFRESH_SEC || S.time < c.last) refreshShown(c, false);
    c.mx += (c.sx - c.mx) * k;
    c.my += (c.sy - c.my) * k;
    c.alpha = Math.max(0, Math.min(1, (S.time - c.born) / 1.2));
  }
}

// ---------------------------------------------------------------------------
// Wariant, kamera

function applyZoom() {
  S.cam.zoom = W / (S.far ? 180000 : 45000);
}

function setVariant(v) {
  const fanMode = S.mode === 'wachlarze';
  if (fanMode && !FAN_VARIANTS[v]) return;
  const wasCmp = (fanMode ? S.fanVariant : S.variant) === 5;
  if (fanMode) S.fanVariant = v; else S.variant = v;
  if ((v === 5) !== wasCmp) setScene();
  syncPanel();
}

// Przyciski i opis panelu wg trybu (kontakty / wachlarze).
function syncPanel() {
  const fanMode = S.mode === 'wachlarze';
  const v = fanMode ? S.fanVariant : S.variant;
  const names = fanMode ? ['Dziś (prototyp)', '1 · PULS', '2 · FALA', '3 · ISKRY', '', 'Porównanie 2 × 2']
    : ['Dziś (prototyp)', '1 · ECHO', '2 · OBŁOK', '3 · WIR', '4 · RÓJ', 'Porównanie 2 × 2'];
  for (let i = 0; i <= 5; i++) {
    const b = $(`v${i}`);
    if (!b) continue;
    b.firstChild.nodeValue = names[i];
    b.style.display = names[i] ? '' : 'none';
    b.classList.toggle('on', i === v);
  }
  $('desc').innerHTML = fanMode ? FAN_DESC[FAN_VARIANTS[v]] : DESC[VARIANTS[v]];
  $('m-kontakty').classList.toggle('on', !fanMode);
  $('m-wachlarze').classList.toggle('on', fanMode);
  $('scena-box').style.display = fanMode ? 'none' : '';
  $('s-plansza').classList.toggle('on', S.scene === 'plansza' && v !== 5);
  $('s-gra').classList.toggle('on', S.scene === 'gra' && v !== 5);
}

function setMode(mode) {
  S.mode = mode === 'wachlarze' ? 'wachlarze' : 'kontakty';
  setScene();
  syncPanel();
}

function setSceneName(name) {
  if (S.mode === 'wachlarze') return;
  S.scene = name;
  if (S.variant === 5) S.variant = 1;
  setScene();
  setVariant(S.variant);
}

function syncMeshes() {
  const fanMode = S.mode === 'wachlarze';
  fans.sync(FAN_VARIANTS[S.fanVariant], S.cam, W, H, fanMode);
  const v = fanMode ? null : VARIANTS[S.variant];
  const pr = Core3D.pixelRatio || 1;
  const bw = Core3D.composerTarget?.width || W * pr;
  const bh = Core3D.composerTarget?.height || H * pr;
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const style = KONTAKT_STYLES[i];
    const on = v === 'porownanie' || v === style;
    m.visible = on;
    const r = m.userData.rect.value;
    if (v === 'porownanie') {
      const q = QUAD_STYLE.indexOf(style);
      const x0 = (q % 2) * bw / 2, y0 = (q < 2 ? 0 : 1) * bh / 2;
      r.set(x0, y0, x0 + bw / 2, y0 + bh / 2);
    } else {
      r.set(-1, -1, 1e9, 1e9);
    }
  }
}

// Blok kontaktów: nagłówek + kontakty względem środka kadru, osie sceny (y w górę). `quad` ≥ 0 — tylko kontakty
// tej ćwiartki porównania.
function packBlock(A, quad) {
  const cam = S.cam;
  const zoomBuf = Core3D.viewZoom(cam);
  const pxs = Core3D.pxScale || Core3D.pixelRatio || 1;
  const bw = Core3D.composerTarget?.width || W * pxs;
  const bh = Core3D.composerTarget?.height || H * pxs;
  let n = 0;
  for (let i = 0; i < S.contacts.length && n < KONTAKT_MAX; i++) {
    const c = S.contacts[i];
    if (quad >= 0 && c.quad !== quad) continue;
    const sz = SIZE[c.cls];
    const R = Math.max(sz.R, sz.minPx / cam.zoom);
    A[KONTAKT_HDR + 2 * n].set(c.mx - cam.x, -(c.my - cam.y), R, c.err);
    A[KONTAKT_HDR + 2 * n + 1].set(c.cls, sz.mass, c.seed, c.alpha);
    n++;
  }
  A[0].set(n, S.time % 600, zoomBuf, pxs);
  A[1].set(bw, bh, wrap01(cam.x / KONTAKT_NOISE_TILE), wrap01(-cam.y / KONTAKT_NOISE_TILE));
  const ob = S.observer || { x: cam.x - 1e6, y: cam.y };
  A[2].set(ob.x - cam.x, -(ob.y - cam.y), 2.4, S.sweepOn);
  A[3].set(0, 0, 0, 0);
}

// Soczewka wiru: refrakcja „uber” (implozja — obraz wsysany ku środkowi) na kontakt, co klatkę.
function pushLens() {
  if (S.mode === 'wachlarze') return;
  const v = VARIANTS[S.variant];
  if (v !== 'wir' && v !== 'porownanie') return;
  const dist = Core3D.fxDistortion?.();
  if (!dist) return;
  for (const c of S.contacts) {
    if (v === 'porownanie' && QUAD_STYLE[c.quad] !== 'wir') continue;
    const sz = SIZE[c.cls];
    const R = Math.max(sz.R, sz.minPx / S.cam.zoom);
    const rc = R * 0.72 + c.err * 0.2;           // promień jądra jak w wirLook
    const px = Math.min(14, Math.max(1.2, rc * S.cam.zoom * (0.16 + 0.05 * c.cls))) * c.alpha;
    dist.implode(c.mx, c.my, rc * 3.2, px, 0.25);
  }
}

// ---------------------------------------------------------------------------
// Klatka

function frame(dt) {
  const t0 = performance.now();
  if (!S.paused) S.time += dt;
  stepContacts(S.paused ? 0 : dt);
  if (S.mode === 'wachlarze') fans.step(S.time);
  const cam = S.cam;
  cam.x = S.offX; cam.y = S.offY;
  syncMeshes();
  const cmp = VARIANTS[S.variant] === 'porownanie';
  for (let i = 0; i < meshes.length; i++) {
    if (S.mode === 'wachlarze') break;
    if (meshes[i].visible) packBlock(blocks[i].array, cmp ? QUAD_STYLE.indexOf(KONTAKT_STYLES[i]) : -1);
  }
  Core3D.beginPlanetLayerFrame?.();
  pushLens();
  backdrop.sync(cam, W, H);
  Core3D.syncCamera(cam);
  Core3D.render();
  drawOverlay(cam);
  S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  updateHud();
}

function toS(cam, x, y, out = {}) {
  out.x = (x - cam.x) * cam.zoom + W * 0.5;
  out.y = (y - cam.y) * cam.zoom + H * 0.5;
  return out;
}

const _p = {};
function text(str, x, y, rgb, a, size = 11, align = 'center') {
  ctx.font = `${size}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(str, x + 1, y + 1);
  ctx.fillStyle = `rgba(${rgb},${a})`;
  ctx.fillText(str, x, y);
}

function drawAtlas(cam, x, y) {
  if (!atlasImg.complete || !atlasImg.naturalWidth) return;
  const L = 3000 * cam.zoom;
  const p = toS(cam, x, y, _p);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = 0.95;
  ctx.drawImage(atlasImg, -L / 2, -L * 1677 / 3747 / 2, L, L * 1677 / 3747);
  ctx.restore();
  text('ATLAS', p.x, p.y + L * 0.25 + 6, '159, 220, 255', 0.8, 10);
}

// Dzisiejszy znacznik prototypu (radarRangeOverlay.js: przerywane koło niepewności, „?”, rozmiar; grupy 28 px).
function drawToday(cam) {
  const pts = S.contacts.map((c) => ({ c, p: toS(cam, c.mx, c.my, {}) }));
  const used = new Set();
  for (let i = 0; i < pts.length; i++) {
    if (used.has(i)) continue;
    const g = [i];
    used.add(i);
    for (let j = i + 1; j < pts.length; j++) {
      if (used.has(j)) continue;
      if (Math.hypot(pts[j].p.x - pts[i].p.x, pts[j].p.y - pts[i].p.y) < 28) { g.push(j); used.add(j); }
    }
    let size = 0, errPx = 0, cx = 0, cy = 0;
    for (const k of g) {
      size = Math.max(size, pts[k].c.cls);
      errPx = Math.max(errPx, pts[k].c.err * cam.zoom);
      cx += pts[k].p.x; cy += pts[k].p.y;
    }
    cx /= g.length; cy /= g.length;
    const rr = Math.max(10, Math.min(160, errPx));
    const a = Math.min(...g.map((k) => pts[k].c.alpha));
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 92, 92, ${0.45 * a})`;
    ctx.stroke();
    ctx.setLineDash([]);
    text(g.length > 1 ? `? ×${g.length}` : '?', cx, cy - 6, '255, 92, 92', 0.9 * a);
    text(SIZE[size].name, cx, cy + rr + 3, '255, 92, 92', 0.6 * a, 10);
  }
}

function drawOverlay(cam) {
  ctx.clearRect(0, 0, W, H);
  const clean = document.body.classList.contains('clean');
  if (S.mode === 'wachlarze') {
    const fv = FAN_VARIANTS[S.fanVariant];
    fans.drawOverlay(ctx, cam, W, H, fv, atlasImg, text, S.labels);
    if (fv === 'porownanie') {
      ctx.strokeStyle = 'rgba(160, 190, 210, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
      ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
      ctx.stroke();
      const qs = ['puls', 'fala', 'iskry', 'dzis'];
      for (let q = 0; q < 4; q++) {
        const x = (q % 2) * W / 2 + 14, y = (q < 2 ? 0 : 1) * H / 2 + (q < 2 && !clean ? 64 : 12);
        text(FAN_TITLES[qs[q]], x, y, '255, 207, 106', 0.95, 14, 'left');
      }
    }
    return;
  }
  if (S.observer && !S.quads) drawAtlas(cam, S.observer.x, S.observer.y);
  if (S.vision > 0 && S.observer) {
    const p = toS(cam, S.observer.x, S.observer.y, _p);
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120, 210, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, S.vision * cam.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (VARIANTS[S.variant] === 'dzis') drawToday(cam);
  if (S.quads) {
    ctx.strokeStyle = 'rgba(160, 190, 210, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();
    for (let q = 0; q < 4; q++) {
      const x = (q % 2) * W / 2 + 14, y = (q < 2 ? 0 : 1) * H / 2 + (q < 2 && !clean ? 64 : 12);
      text(TITLES[QUAD_STYLE[q]], x, y, '255, 207, 106', 0.95, 14, 'left');
    }
  }
  if (S.labels) {
    for (const c of S.contacts) {
      const lab = c.label || (c.errFromDistance ? `${SIZE[c.cls].name} · ${((c.dist || 0) / 1000).toFixed(0)} km` : null);
      if (!lab) continue;
      const R = Math.max(SIZE[c.cls].R, SIZE[c.cls].minPx / cam.zoom);
      const p = toS(cam, c.tx, c.ty, _p);
      const off = (R * 1.15 + c.err * 1.1) * cam.zoom + 10;
      text(lab, p.x, p.y + off, '200, 214, 226', 0.62 * c.alpha, 10);
    }
    for (const t of S.captions) {
      const p = toS(cam, t.x, t.y, _p);
      text(t.text, p.x, p.y, '160, 180, 196', 0.7, 11);
    }
  }
  if (S.truth) {
    for (const c of S.contacts) {
      const p = toS(cam, c.tx, c.ty, _p);
      const q = toS(cam, c.mx, c.my, {});
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y);
      ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
  }
  // podziałka
  if (!clean) {
    const raw = 160 / cam.zoom;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const unit = [1, 2, 5, 10].map((k) => k * pow).find((v) => v * cam.zoom >= 96) || pow * 10;
    const px = unit * cam.zoom;
    const x1 = W - 340, y1 = H - 26;
    ctx.strokeStyle = 'rgba(220,230,240,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1 - px, y1); ctx.lineTo(x1, y1);
    ctx.moveTo(x1 - px, y1 - 5); ctx.lineTo(x1 - px, y1 + 5);
    ctx.moveTo(x1, y1 - 5); ctx.lineTo(x1, y1 + 5);
    ctx.stroke();
    text(`${(unit / 1000).toLocaleString('pl-PL')} km`, x1 - px / 2, y1 - 18, '220, 230, 240', 0.85, 11);
  }
}

let hudN = 0;
function updateHud() {
  if (++hudN % 6) return;
  const info = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  const fanMode = S.mode === 'wachlarze';
  const v = fanMode ? FAN_VARIANTS[S.fanVariant] : VARIANTS[S.variant];
  const lines = [];
  lines.push(`<b>${(1000 / Math.max(1, S.frameMs)).toFixed(0)} FPS</b> · CPU ${S.cpuMs.toFixed(2)} ms · GPU ${(Number(Core3D.gpuFrameMs) || 0).toFixed(2)} ms · draw ${info.drawCalls ?? info.calls ?? 0}${S.paused ? ' · <span class="warn">PAUZA</span>' : ''}`);
  lines.push(fanMode ? `<b>WACHLARZE · ${FAN_TITLES[v]}</b> · stanowiska ${fans.st.stations.length} · kadr ${(W / S.cam.zoom / 1000).toFixed(0)} km`
    : `<b>${TITLES[v]}</b> · scena ${v === 'porownanie' ? 'porównanie' : S.scene} · kontakty ${S.contacts.length} · kadr ${(W / S.cam.zoom / 1000).toFixed(0)} km`);
  lines.push(`pipeline'y synchr. w klatkach: <b>${S.syncPipes}</b>${S.syncNames.length ? ` (${S.syncNames.slice(0, 2).join(', ')})` : ''}`);
  $('hud').innerHTML = lines.join('\n');
}

// ---------------------------------------------------------------------------
// Wejście

const ACTIONS = {
  0: () => setVariant(0), 1: () => setVariant(1), 2: () => setVariant(2), 3: () => setVariant(3), 4: () => setVariant(4),
  5: () => setVariant(5),
  s: () => setSceneName(S.scene === 'gra' ? 'plansza' : 'gra'),
  w: () => setMode(S.mode === 'wachlarze' ? 'kontakty' : 'wachlarze'),
  l: () => { S.labels = !S.labels; $('b-labels').classList.toggle('on', S.labels); },
  t: () => { S.truth = !S.truth; $('b-truth').classList.toggle('on', S.truth); },
  ' ': () => { S.paused = !S.paused; $('b-pause').classList.toggle('on', S.paused); },
  z: () => { S.far = !S.far; applyZoom(); $('b-far').classList.toggle('on', S.far); },
  h: () => document.body.classList.toggle('clean')
};

function bindInput() {
  for (let i = 0; i <= 5; i++) $(`v${i}`).addEventListener('click', () => ACTIONS[i]());
  $('s-plansza').addEventListener('click', () => setSceneName('plansza'));
  $('s-gra').addEventListener('click', () => setSceneName('gra'));
  $('m-kontakty').addEventListener('click', () => setMode('kontakty'));
  $('m-wachlarze').addEventListener('click', () => setMode('wachlarze'));
  const map = { 'b-labels': 'l', 'b-truth': 't', 'b-pause': ' ', 'b-far': 'z', 'b-clean': 'h' };
  for (const [id, k] of Object.entries(map)) $(id).addEventListener('click', () => ACTIONS[k]());
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
    S.cam.zoom = Math.min(0.5, Math.max(0.002, S.cam.zoom * Math.exp(-e.deltaY * 0.0012)));
    S.offX = bx - (e.clientX - W * 0.5) / S.cam.zoom;
    S.offY = by - (e.clientY - H * 0.5) / S.cam.zoom;
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
    applyZoom();
  });
}

// Pipeline'y tworzone SYNCHRONICZNIE w zwykłym renderze (nic ich nie rozgrzało) — po rozgrzewce ma być 0.
function hookPipelines() {
  const pu = Core3D.renderer?.backend?.pipelineUtils;
  if (!pu || pu.__kontaktyHook) return;
  pu.__kontaktyHook = true;
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

window.__kontakty = {
  ready: false, S,
  act(k) { ACTIONS[k]?.(); return true; },
  set(o = {}) {
    if (o.mode && o.mode !== S.mode) {
      S.mode = o.mode;
      if (o.mode === 'wachlarze' && o.variant !== undefined) {
        S.fanVariant = typeof o.variant === 'number' ? o.variant : FAN_VARIANTS.indexOf(o.variant);
      }
      setScene();
      syncPanel();
    } else if (S.mode === 'wachlarze' && o.variant !== undefined) {
      const v = typeof o.variant === 'number' ? o.variant : FAN_VARIANTS.indexOf(o.variant);
      setVariant(v);
    }
    if (S.mode === 'wachlarze') {
      if (o.labels !== undefined) { S.labels = !!o.labels; $('b-labels').classList.toggle('on', S.labels); }
      if (o.clean !== undefined) document.body.classList.toggle('clean', !!o.clean);
      return true;
    }
    if (o.scene) S.scene = o.scene;
    if (o.variant !== undefined) {
      const v = typeof o.variant === 'number' ? o.variant : VARIANTS.indexOf(o.variant);
      if (v === 5 || S.variant === 5 || o.scene) { S.variant = v; setScene(); }
      setVariant(v);
    } else if (o.scene) { setScene(); setVariant(S.variant); }
    if (o.labels !== undefined) { S.labels = !!o.labels; $('b-labels').classList.toggle('on', S.labels); }
    if (o.truth !== undefined) { S.truth = !!o.truth; $('b-truth').classList.toggle('on', S.truth); }
    if (o.far !== undefined) { S.far = !!o.far; applyZoom(); $('b-far').classList.toggle('on', S.far); }
    if (o.clean !== undefined) document.body.classList.toggle('clean', !!o.clean);
    return true;
  },
  async runFrames(n = 1, fps = 60) {
    for (let i = 0; i < n; i++) {
      frame(1 / fps);
      if ((i % 6) === 5) await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    return true;
  },
  stats() {
    return {
      tryb: S.mode, wachlarz: FAN_VARIANTS[S.fanVariant], distLive: fans?.distLive ?? false,
      wariant: VARIANTS[S.variant], scena: S.variant === 5 ? 'porownanie' : S.scene, czas: +S.time.toFixed(2),
      kontakty: S.contacts.length, zoom: +S.cam.zoom.toFixed(5), syncPipes: S.syncPipes, syncNames: S.syncNames.slice(),
      gpuMs: +(Number(Core3D.gpuFrameMs) || 0).toFixed(3),
      fx: Core3D.fx?.distortion?.stats ? { ...Core3D.fx.distortion.stats } : null
    };
  }
};

(async () => {
  try {
    if (!(await Core3D.ready)) {
      $('nogpu').style.display = 'flex';
      $('nogpu-detail').textContent = Core3D.gpuError || 'brak adaptera WebGPU';
      $('loading').style.display = 'none';
      window.__kontakty.error = 'webgpu';
      return;
    }
    backdrop = createSpaceBackdrop(Core3D);
    blocks = KONTAKT_STYLES.map(() => createContactBlock());
    meshes = KONTAKT_STYLES.map((style, i) => {
      const m = createContactMesh(style, blocks[i]);
      m.visible = false;
      Core3D.scene.add(m);
      return m;
    });
    fans = createFanDemo(Core3D, FX_DISTORT_LAYER);
    for (const m of fans.meshes) Core3D.scene.add(m);
    if (fans.dist) Core3D.scene.add(fans.dist);
    // warstwę DIST zgłasza się z kroku efektów (flagę kasuje start klatki efektów — wzór hullCloak.js)
    Core3D.addFxStep({ name: 'wachlarze: fala (demo)', update() { if (fans.distLive) Core3D.setDistortLayerActive(true); } });
    Core3D.warmup.add({ name: 'kontakty czujników (4 propozycje, tło)', objects: () => [backdrop.mesh, ...meshes] });
    Core3D.warmup.add({ name: 'wachlarze czujników (3 warianty)', objects: () => fans.warmupObjects() });
    if (fans.dist) Core3D.warmup.add({ name: 'wachlarze: fala (warstwa DIST)', objects: () => [fans.dist], layer: FX_DISTORT_LAYER });
    await Core3D.warmup.flush?.({ timeoutMs: 8000 });
    hookPipelines();
    bindInput();
    setScene();
    syncPanel();
    if (S.far) $('b-far').classList.add('on');
    if (!S.labels) $('b-labels').classList.remove('on');
    $('loading').style.display = 'none';
    window.__kontakty.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
  }
})();
