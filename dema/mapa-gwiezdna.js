// ============================================================
// Mapa gwiezdna — demo (dema/mapa-gwiezdna.html): lot Atlasa po strefie międzygwiezdnej.
// Dane i zasady: src/game/sector/ (moduł czysty), obraz GPU: ./mapa-gwiezdna-obraz.js (tło z paralaksą,
// mgławice, gwiazdy, pył) i ./mapa-gwiezdna-floty.js (sylwetki statków w szyku, ogony, dysze), nakładka 2D
// (etykiety, punkty skoku, kółka flot, trasa) i HUD (paliwo, strefa, karta układu, dziennik) — tutaj.
// Kamera: sprężyna z wyprzedzeniem wzdłuż prędkości, lekkie oddalenie przy szybkim locie, drżenie w burzy.
// Losowość obrazu (pioruny burz) — fxRandom; dane sektora — z ziarna (?seed=).
// ============================================================
import * as THREE from 'three/webgpu';
import {
  generateSector, sectorSummary, createFleets, stepFleets, advanceFleets, createShip, stepShip,
  createExploration, updateExploration, nearestSystem, jumpPointAt, jumpPointPosition, zoneExitFromWorld,
  worldEntryFromJump, fleetVisibleToPlayer, timeForDistance, fuelForDistance,
  SECTOR_FLIGHT, ZONE, EXPLORE, EXPLORE_LABELS, FLEET_MODE, FLEET_TICK, JUMP_CORNERS,
  PLANET_TYPE_LABELS, STAR_CLASSES, starColorRgb
} from '../src/game/sector/index.js';
import { FACTIONS } from '../src/data/factions.js';
import { fxRandom } from '../src/3d/fx/fxRandom.js';
import { StarMapImage, STAR_SIZE } from './mapa-gwiezdna-obraz.js';
import { FleetImage } from './mapa-gwiezdna-floty.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const SEED = Number(params.get('seed') || 1) >>> 0;
const errEl = $('err');
function showError(text) { errEl.style.display = 'block'; errEl.textContent += `${text}\n`; console.error(text); window.__mapa && (window.__mapa.error = text); }
window.addEventListener('error', (e) => showError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => showError(`Promise: ${e.reason?.stack || e.reason}`));
window.__mapa = { ready: false, error: null };

const PLANET_COLORS = Object.freeze({
  terran: '#5cc77a', ocean: '#3f86e0', desert: '#dba65c', rocky: '#a0958b', ice: '#c4e6f2',
  volcanic: '#e85f3c', barren: '#858585', toxic: '#bccd4c', gas: '#dcb88e', ice_giant: '#82bfe0'
});
const fmt = (v, d = 1) => Number(v).toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return m > 0 ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`;
};
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ── renderer ──────────────────────────────────────────────────────────────────────────────────────
if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) {
  showError('Brak WebGPU — mapa gwiezdna wymaga przeglądarki z WebGPU.');
  throw new Error('brak WebGPU');
}
const renderer = new THREE.WebGPURenderer({ antialias: false });
const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 1);
$('root').appendChild(renderer.domElement);
await renderer.init();
if (!renderer.backend?.isWebGPUBackend) showError('WebGPU niedostępne — demo wymaga WebGPU.');

// ── dane: sektor, floty, mgła eksploracji, statek ─────────────────────────────────────────────────
const sector = generateSector({ seed: SEED });
const summary = sectorSummary(sector);
const S0 = sector.systems;
const fleets = createFleets(sector);
// Rozbieg flot (deterministyczny): mapa od pierwszej klatki wygląda jak w trakcie, nie jak na starcie.
advanceFleets(fleets, sector, 90);
const exp = createExploration(sector);
// Start: wyjście z Układu Słonecznego rogiem NE (jak po wylocie z gry rogiem świata za Kuiperem).
const exit0 = zoneExitFromWorld(sector, 'sol', 5.9e6, -5.9e6);
const ship = createShip(exit0.x, exit0.y, exit0.heading);
const image = new StarMapImage(renderer, sector);
image.setExploration(exp);
const fleetImage = new FleetImage(image.scene, fleets, image.U);

const B = sector.bounds;
const S = {
  t: 0,
  zoom: 190,
  zoomTarget: 190,
  sectorView: false,
  keys: new Set(),
  selected: -1,
  autopilot: null,
  jump: null,
  jumpShown: null,
  banner: null,
  log: [],
  lastEventSeq: fleets.eventSeq,
  bolts: [],
  mouse: { x: 0, y: 0 },
  frames: 0,
  fps: 0,
  fleetMs: 0,
  bakeText: 'wypiek nieba…'
};
image.bakeAll((b) => {
  S.bakeText = b.nebulae < 6 ? `wypiek mgławic ${b.nebulae}/6…` : '';
}).then((b) => {
  S.bakeText = '';
  window.__mapa.bakes = b;
}).catch((e) => showError(`wypiek: ${e?.stack || e}`));

// ── wejście ───────────────────────────────────────────────────────────────────────────────────────
const fitZoom = () => Math.min(innerWidth / (B.x1 - B.x0 + 10), innerHeight / (B.y1 - B.y0 + 8));
const ZOOM_MAX = 420;
addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'KeyW') return;
  S.keys.add(e.code);
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) S.autopilot = null;
  if (e.code === 'KeyM') toggleSectorView();
  if (e.code === 'KeyE') tryJump();
  if (e.code === 'KeyF') toggleEscort();
  if (e.code === 'Escape') { S.selected = -1; S.autopilot = null; }
});
addEventListener('keyup', (e) => S.keys.delete(e.code));
addEventListener('blur', () => S.keys.clear());
addEventListener('wheel', (e) => {
  S.zoomTarget = Math.max(fitZoom(), Math.min(ZOOM_MAX, S.zoomTarget * Math.pow(1.0015, -e.deltaY)));
  S.sectorView = S.zoomTarget <= fitZoom() * 1.05;
}, { passive: true });
addEventListener('mousemove', (e) => { S.mouse.x = e.clientX; S.mouse.y = e.clientY; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousedown', (e) => {
  const w = screenToWorld(e.clientX, e.clientY);
  const pick = pickSystem(e.clientX, e.clientY);
  if (e.button === 0) S.selected = pick;
  if (e.button === 2) {
    if (pick >= 0) {
      S.selected = pick;
      setAutopilotSystem(pick);
    } else S.autopilot = { x: w.x, y: w.y, system: -1 };
  }
});
addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));

function toggleEscort() {
  fleetImage.escort = !fleetImage.escort;
  addLog(fleetImage.escort ? 'Eskorta: Atlas + niszczyciel + 2 fregaty (podgląd floty gracza)' : 'Eskorta odesłana — Atlas sam');
}

function toggleSectorView() {
  S.sectorView = !S.sectorView;
  S.zoomTarget = S.sectorView ? fitZoom() : 190;
}

/** Autopilot do układu: do NAJBLIŻSZEGO punktu skoku (wejście do układu). */
function setAutopilotSystem(i) {
  const sys = S0[i];
  let best = 0;
  let bd = Infinity;
  const p = { x: 0, y: 0 };
  for (let c = 0; c < 4; c++) {
    jumpPointPosition(sys, c, p);
    const d = (p.x - ship.x) ** 2 + (p.y - ship.y) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  jumpPointPosition(sys, best, p);
  S.autopilot = { x: p.x, y: p.y, system: i, corner: best };
}

function tryJump() {
  if (!S.jump) {
    flashBanner('Poza punktem skoku', 'Punkty skoku leżą na okręgu wokół gwiazdy (NE / NW / SW / SE).', 2.5);
    return;
  }
  const sys = S0[S.jump.index];
  const c = JUMP_CORNERS[S.jump.corner];
  const w = worldEntryFromJump(S.jump.corner);
  flashBanner(`Skok: wejście do układu ${displayName(S.jump.index)} (${sys.id}) — punkt ${c.key}`,
    `W grze: przeładowanie strony ?uklad=${sys.id}&wejscie=${c.key} → Atlas w rogu ${c.key} świata układu (${fmt(w.x / 1e6, 2)} / ${fmt(w.y / 1e6, 2)} mln j.), kurs do gwiazdy.`, 5);
  addLog(`Skok do ${displayName(S.jump.index)} (${sys.id}, ${c.key}) — tu tylko komunikat`, 'disc');
}

function flashBanner(big, small, seconds) {
  S.banner = { big, small, until: S.t + seconds };
}

function addLog(text, cls = '') {
  S.log.push({ t: S.t, text, cls });
  if (S.log.length > 6) S.log.shift();
}

// ── widok ─────────────────────────────────────────────────────────────────────────────────────────
const view = { x: 0, y: 0, z: 190 };
/**
 * Kamera lotu: sprężyna krytycznie tłumiona (ω) za punktem przed statkiem (prędkość × `lead`, najwyżej
 * `leadMax` kadru), mnożnik zoomu z prędkości i nurtu, drżenie w burzy [px]. Prędkość kamery → smugi pyłu.
 */
const CAMERA = Object.freeze({ omega: 2.6, lead: 2.5, leadMax: 0.22, zoomSpeed: 0.1, zoomBurn: 0.07, zoomRate: 1.2, shakePx: 2.5 });
const cam = { x: 0, y: 0, vx: 0, vy: 0, zoomMul: 1, velX: 0, velY: 0, prevX: 0, prevY: 0, init: false };
function updateCamera(dt) {
  const C = CAMERA;
  let lx = ship.vx * C.lead;
  let ly = ship.vy * C.lead;
  const maxL = C.leadMax * Math.min(innerWidth, innerHeight) / Math.max(1, view.z);
  const ll = Math.sqrt(lx * lx + ly * ly);
  if (ll > maxL) { lx *= maxL / ll; ly *= maxL / ll; }
  const tx = ship.x + lx;
  const ty = ship.y + ly;
  if (!cam.init) {
    Object.assign(cam, { x: tx, y: ty, vx: 0, vy: 0, init: true });
  } else if (dt > 0) {
    const w = C.omega;
    cam.vx += (w * w * (tx - cam.x) - 2 * w * cam.vx) * dt;
    cam.vy += (w * w * (ty - cam.y) - 2 * w * cam.vy) * dt;
    cam.x += cam.vx * dt;
    cam.y += cam.vy * dt;
  }
  const zm = 1 - C.zoomSpeed * Math.min(1, ship.speed / SECTOR_FLIGHT.cruise) - (ship.burn ? C.zoomBurn : 0);
  cam.zoomMul += (zm - cam.zoomMul) * (1 - Math.exp(-C.zoomRate * dt));
}
function screenToWorld(px, py) {
  return { x: view.x + (px - innerWidth / 2) / view.z, y: view.y + (py - innerHeight / 2) / view.z };
}
function toScreen(x, y, out) {
  out.x = (x - view.x) * view.z + innerWidth / 2;
  out.y = (y - view.y) * view.z + innerHeight / 2;
  return out;
}
function pickSystem(px, py) {
  let best = -1;
  let bd = 16 * 16;
  const p = { x: 0, y: 0 };
  S0.forEach((s, i) => {
    if (exp.level[i] === EXPLORE.HIDDEN) return;
    toScreen(s.x, s.y, p);
    const d = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function displayName(i) {
  const s = S0[i];
  const lv = exp.level[i];
  if (lv >= EXPLORE.SCANNED) return s.name;
  if (lv === EXPLORE.SEEN) return s.catalog;
  return 'nieznany';
}

// ── krok symulacji ────────────────────────────────────────────────────────────────────────────────
const input = { thrust: 0, turn: 0, burn: false };
const near = { index: -1, dist: 0 };
const jpOut = { index: -1, corner: -1, dist: 0 };
const player = { x: 0, y: 0, sensorMul: 1, active: true };
const expEvents = [];

function readInput() {
  const k = S.keys;
  input.thrust = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  input.turn = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  input.burn = k.has('ShiftLeft') || k.has('ShiftRight');
  const ap = S.autopilot;
  if (ap && input.thrust === 0 && input.turn === 0) {
    const dx = ap.x - ship.x;
    const dy = ap.y - ship.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    let diff = Math.atan2(dy, dx) - ship.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    input.turn = Math.max(-1, Math.min(1, diff * 3));
    const brakeDist = (ship.speed * ship.speed) / (2 * SECTOR_FLIGHT.brake) + 0.03;
    if (d < brakeDist) input.thrust = -1;
    else input.thrust = Math.abs(diff) < 0.45 ? 1 : 0;
    input.burn = input.burn || (ap.burn && d > 2);
    if (d < 0.05 && ship.speed < 0.02) S.autopilot = null;
  }
}

function step(dt) {
  readInput();
  stepShip(ship, input, dt, sector, S.t);
  S.t += dt;
  player.x = ship.x;
  player.y = ship.y;
  player.sensorMul = ship.zone.sensorMul;
  const t0 = performance.now();
  stepFleets(fleets, sector, dt, player);
  S.fleetMs = S.fleetMs * 0.95 + (performance.now() - t0) * 0.05;
  // Mgła eksploracji.
  expEvents.length = 0;
  if (updateExploration(exp, sector, ship.x, ship.y, ship.zone.sensorMul, dt, expEvents)) {
    image.setExploration(exp);
    for (const ev of expEvents) {
      const s = S0[ev.index];
      if (ev.level === EXPLORE.SEEN) addLog(`Wykryto gwiazdę ${s.catalog} (${STAR_CLASSES[s.star].label})`, 'disc');
      else if (ev.level === EXPLORE.SCANNED) addLog(`Skan: ${s.catalog} = ${s.name} — planet ${s.planets.length}`, 'disc');
      else if (ev.level === EXPLORE.VISITED && s.zone !== 'core') addLog(`Odwiedzono ${s.name}${s.pirateBase ? ' — kryjówka piratów!' : ''}`, s.pirateBase ? 'hot' : 'disc');
    }
  }
  // Tankowanie w studni układu zamieszkanego (demo; w grze — w porcie).
  nearestSystem(sector, ship.x, ship.y, near);
  if (near.index >= 0 && S0[near.index].inhabited && near.dist < ZONE.jumpRadius * 1.2 && ship.fuel < SECTOR_FLIGHT.fuelMax) {
    ship.fuel = Math.min(SECTOR_FLIGHT.fuelMax, ship.fuel + SECTOR_FLIGHT.refuelRate * dt);
  }
  // Punkt skoku.
  S.jump = jumpPointAt(sector, ship.x, ship.y, jpOut, near) ? { index: jpOut.index, corner: jpOut.corner } : null;
  const key = S.jump ? `${S.jump.index}:${S.jump.corner}` : null;
  if (key !== S.jumpShown) {
    S.jumpShown = key;
    if (S.jump) addLog(`Punkt skoku ${JUMP_CORNERS[S.jump.corner].key}: ${displayName(S.jump.index)}`);
  }
  // Zdarzenia flot w zasięgu wiedzy gracza (rdzeń — przekaźniki; dalej — czujniki).
  for (const ev of fleets.events) {
    if (ev.seq <= S.lastEventSeq) continue;
    S.lastEventSeq = ev.seq;
    const relay = sector.options.coreRadius + 3;
    const sense = SECTOR_FLIGHT.sensorRange * ship.zone.sensorMul;
    const known = ev.x * ev.x + ev.y * ev.y < relay * relay || (ev.x - ship.x) ** 2 + (ev.y - ship.y) ** 2 < sense * sense || ev.b === 'gracz';
    if (!known) continue;
    addLog(ev.text, ev.type === 'poscig' || ev.type === 'przechwycenie' || ev.type === 'napad' ? 'hot' : '');
    if (ev.type === 'przechwycenie') flashBanner('PRZECHWYCENIE', `${ev.text} — w grze: starcie w strefie (scena walki), tu banda odskakuje.`, 4);
  }
  // Zoom: płynnie w logarytmie.
  const lz = Math.log(S.zoom);
  S.zoom = Math.exp(lz + (Math.log(S.zoomTarget) - lz) * (1 - Math.exp(-7 * dt)));
  updateCamera(dt);
}

// ── nakładka 2D ───────────────────────────────────────────────────────────────────────────────────
const hud = $('hud');
const g = hud.getContext('2d');
function resizeHud() {
  hud.width = Math.round(innerWidth * DPR);
  hud.height = Math.round(innerHeight * DPR);
}
resizeHud();
addEventListener('resize', resizeHud);

const P = { x: 0, y: 0 };
const P2 = { x: 0, y: 0 };
const RC = { x: 0, y: 0, vis: 0, radius: 0, color: '' };
const smooth01 = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function factionColor(id) { return FACTIONS[id]?.color || '#94a3b8'; }
/** Rozmiar gwiazdy na ekranie [px CSS] — jak shader (STAR_SIZE). */
function starSizePx(cls) { return Math.min(STAR_SIZE.max, Math.max(STAR_SIZE.min, view.z * STAR_SIZE.k)) * STAR_CLASSES[cls].mapSize; }

/** Najbliższy układ, który gracz widzi (bez ukrytych w mgławicach) → near-podobny { index, dist }. */
function nearestKnown(x, y, out) {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < S0.length; i++) {
    if (exp.level[i] === EXPLORE.HIDDEN) continue;
    const d = (S0[i].x - x) ** 2 + (S0[i].y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  out.index = best;
  out.dist = Math.sqrt(bd);
  return out;
}
const nearKnown = { index: -1, dist: 0 };

function drawOverlay(dt, bolts) {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, innerWidth, innerHeight);
  const z = view.z;
  const W = innerWidth;
  const H = innerHeight;
  const inView = (x, y, m = 40) => {
    toScreen(x, y, P);
    return P.x > -m && P.x < W + m && P.y > -m && P.y < H + m;
  };
  // Brzeg sektora.
  toScreen(B.x0, B.y0, P);
  toScreen(B.x1, B.y1, P2);
  g.strokeStyle = 'rgba(120, 150, 210, 0.16)';
  g.setLineDash([6, 8]);
  g.lineWidth = 1;
  g.strokeRect(P.x, P.y, P2.x - P.x, P2.y - P.y);
  g.setLineDash([]);
  // Pioruny burz.
  for (const b of bolts) S.bolts.push({ ...b, life: 0.3, pts: makeBolt(b) });
  g.lineCap = 'round';
  for (let i = S.bolts.length - 1; i >= 0; i--) {
    const b = S.bolts[i];
    b.life -= dt;
    if (b.life <= 0) { S.bolts.splice(i, 1); continue; }
    g.strokeStyle = `rgba(215, 195, 255, ${Math.min(1, b.life / 0.3) * 0.9})`;
    g.shadowColor = 'rgba(170, 140, 255, 0.9)';
    g.shadowBlur = 8;
    g.lineWidth = 1.4;
    g.beginPath();
    b.pts.forEach(([x, y], k) => {
      toScreen(x, y, P);
      if (k === 0) g.moveTo(P.x, P.y); else g.lineTo(P.x, P.y);
    });
    g.stroke();
    g.shadowBlur = 0;
  }
  // Studnie i punkty skoku (z bliska).
  const jpA = smooth01(45, 90, z);
  if (jpA > 0) {
    S0.forEach((s, i) => {
      if (exp.level[i] === EXPLORE.HIDDEN || !inView(s.x, s.y, ZONE.jumpRadius * z + 20)) return;
      toScreen(s.x, s.y, P);
      g.strokeStyle = `rgba(140, 200, 255, ${0.42 * jpA})`;
      g.setLineDash([3, 5]);
      g.beginPath();
      g.arc(P.x, P.y, ZONE.jumpRadius * z, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      for (let c = 0; c < 4; c++) {
        jumpPointPosition(s, c, P2);
        toScreen(P2.x, P2.y, P2);
        const active = S.jump && S.jump.index === i && S.jump.corner === c;
        const r = active ? 7 : 4.5;
        g.fillStyle = active ? 'rgba(150, 240, 255, 0.95)' : `rgba(130, 200, 255, ${0.55 * jpA})`;
        g.beginPath();
        g.moveTo(P2.x, P2.y - r);
        g.lineTo(P2.x + r, P2.y);
        g.lineTo(P2.x, P2.y + r);
        g.lineTo(P2.x - r, P2.y);
        g.closePath();
        g.fill();
        if (active || jpA > 0.9 && z > 140) {
          g.font = '10px system-ui, sans-serif';
          g.fillStyle = `rgba(150, 210, 255, ${active ? 1 : 0.55})`;
          g.textAlign = 'center';
          g.fillText(JUMP_CORNERS[c].key, P2.x, P2.y + (JUMP_CORNERS[c].dy > 0 ? 17 : -10));
        }
      }
    });
  }
  // Skan w toku: łuk wokół gwiazdy.
  S0.forEach((s, i) => {
    if (exp.level[i] >= EXPLORE.SCANNED || exp.scan[i] <= 0 || !inView(s.x, s.y)) return;
    toScreen(s.x, s.y, P);
    const r = Math.max(10, 0.25 * z);
    g.strokeStyle = 'rgba(150, 255, 200, 0.85)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(P.x, P.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, exp.scan[i] / SECTOR_FLIGHT.scanTime));
    g.stroke();
    g.lineWidth = 1;
  });
  // Etykiety układów.
  g.textAlign = 'left';
  S0.forEach((s, i) => {
    const lv = exp.level[i];
    if (lv === EXPLORE.HIDDEN || !inView(s.x, s.y, 80)) return;
    const sel = i === S.selected;
    const coreNamed = s.named;
    // Cały sektor: tylko nazwani sąsiedzi i wybrany; bliżej — wszystko znane.
    const show = sel || (z >= 22) || (coreNamed && z >= 14) || (s.id === 'sol');
    if (!show) return;
    toScreen(s.x, s.y, P);
    const off = starSizePx(s.star) * 1.3 + 6;
    const name = displayName(i);
    g.font = `${sel ? 600 : 500} ${coreNamed || sel ? 12 : 11}px system-ui, sans-serif`;
    const alpha = lv >= EXPLORE.SCANNED ? 0.92 : 0.5;
    g.fillStyle = s.zone === 'core' ? `rgba(225, 235, 255, ${alpha})` : `rgba(200, 210, 230, ${alpha})`;
    g.fillText(name, P.x + off, P.y - 2);
    let lineY = P.y + 11;
    if (z >= 70 && lv >= EXPLORE.SEEN) {
      g.font = '10px system-ui, sans-serif';
      g.fillStyle = 'rgba(150, 165, 190, 0.8)';
      const cls = STAR_CLASSES[s.star].label + (s.companion ? ' + ' + STAR_CLASSES[s.companion].label : '');
      g.fillText(cls, P.x + off, lineY);
      lineY += 12;
    }
    // Planety (kropki rodzajów) po skanie.
    if (z >= 70 && lv >= EXPLORE.SCANNED) {
      s.planets.forEach((p, k) => {
        g.fillStyle = PLANET_COLORS[p.type];
        g.beginPath();
        g.arc(P.x + off + 4 + k * 9, lineY - 3, 3, 0, Math.PI * 2);
        g.fill();
      });
      lineY += 10;
    }
    // Właściciel / kryjówka / brama — po wizycie (rdzeń znany od startu).
    if (lv >= EXPLORE.VISITED) {
      if (s.faction && s.zone === 'core' && z >= 12) {
        g.strokeStyle = factionColor(s.faction);
        g.globalAlpha = 0.75;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(P.x, P.y, off - 2, Math.PI * 0.15, Math.PI * 0.85);
        g.stroke();
        g.globalAlpha = 1;
        g.lineWidth = 1;
      }
      if (s.pirateBase) {
        g.strokeStyle = 'rgba(255, 90, 80, 0.9)';
        g.lineWidth = 1.5;
        const r = off;
        g.beginPath();
        g.moveTo(P.x, P.y - r);
        g.lineTo(P.x + r, P.y);
        g.lineTo(P.x, P.y + r);
        g.lineTo(P.x - r, P.y);
        g.closePath();
        g.stroke();
        g.lineWidth = 1;
      }
      if (s.gate && z >= 12) {
        g.strokeStyle = 'rgba(255, 215, 120, 0.85)';
        g.beginPath();
        g.arc(P.x - off - 3, P.y - 4, 4, 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (sel) {
      g.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      g.beginPath();
      g.arc(P.x, P.y, off + 4, 0, Math.PI * 2);
      g.stroke();
    }
  });
  // Floty: sylwetki, ogony i dysze rysuje GPU (mapa-gwiezdna-floty.js); tu kółko floty, pościg i nazwa.
  fleets.fleets.forEach((f, r) => {
    const c = fleetImage.rowCircle(r, RC);
    if (c.vis < 0.02 || !inView(c.x, c.y, c.radius + 40)) return;
    toScreen(c.x, c.y, P);
    const hunting = f.mode === FLEET_MODE.HUNT;
    g.globalAlpha = c.vis * (hunting ? 0.75 : 0.14 + 0.18 * smooth01(20, 90, z));
    g.strokeStyle = c.color;
    g.lineWidth = hunting ? 1.4 : 1;
    g.beginPath();
    g.arc(P.x, P.y, c.radius, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
    g.globalAlpha = 1;
    if (hunting) {
      const tgt = f.target === -2 ? ship : fleets.fleets[f.target];
      if (tgt) {
        toScreen(tgt.x, tgt.y, P2);
        g.strokeStyle = `rgba(255, 110, 90, ${0.5 * c.vis})`;
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(P.x, P.y);
        g.lineTo(P2.x, P2.y);
        g.stroke();
        g.setLineDash([]);
      }
    }
    if (z >= 80) {
      g.font = '10px system-ui, sans-serif';
      g.fillStyle = f.kind === 'pirate' ? `rgba(255, 140, 125, ${0.9 * c.vis})` : `rgba(190, 205, 225, ${0.75 * c.vis})`;
      g.textAlign = 'center';
      g.fillText(`${f.name}${hunting ? ' — pościg' : ''}`, P.x, P.y - c.radius - 5);
      g.textAlign = 'left';
    }
  });
  // Trasa do wybranego układu.
  if (S.selected >= 0) {
    const s = S0[S.selected];
    toScreen(ship.x, ship.y, P);
    toScreen(s.x, s.y, P2);
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    g.setLineDash([2, 6]);
    g.beginPath();
    g.moveTo(P.x, P.y);
    g.lineTo(P2.x, P2.y);
    g.stroke();
    g.setLineDash([]);
  }
  if (S.autopilot) {
    toScreen(S.autopilot.x, S.autopilot.y, P2);
    g.strokeStyle = 'rgba(140, 240, 255, 0.8)';
    g.beginPath();
    g.arc(P2.x, P2.y, 9, 0, Math.PI * 2);
    g.stroke();
  }
  // Statek gracza: zasięg czujników, wektor prędkości, ikona.
  toScreen(ship.x, ship.y, P);
  const sens = SECTOR_FLIGHT.sensorRange * ship.zone.sensorMul * z;
  if (z >= 25 && sens < Math.max(W, H) * 1.5) {
    g.strokeStyle = 'rgba(120, 220, 255, 0.12)';
    g.beginPath();
    g.arc(P.x, P.y, sens, 0, Math.PI * 2);
    g.stroke();
  }
  g.font = '600 11px system-ui, sans-serif';
  g.fillStyle = 'rgba(200, 240, 255, 0.9)';
  g.textAlign = 'center';
  g.fillText(fleetImage.escort ? 'ATLAS + ESKORTA' : 'ATLAS', P.x, P.y + fleetImage.rowCircle(fleetImage.playerRow, RC).radius + (fleetImage.escort ? 30 : 12));
  g.textAlign = 'left';
}

/** Piorun: łamana od środka błysku (fxRandom — obraz). */
function makeBolt(b) {
  const pts = [];
  let a = fxRandom.next() * Math.PI * 2;
  let x = b.x;
  let y = b.y;
  const n = 5 + Math.floor(fxRandom.next() * 4);
  const stepL = b.len / n;
  pts.push([x, y]);
  for (let i = 0; i < n; i++) {
    a += (fxRandom.next() - 0.5) * 1.4;
    x += Math.cos(a) * stepL;
    y += Math.sin(a) * stepL;
    pts.push([x, y]);
  }
  return pts;
}

// ── HUD (DOM) ─────────────────────────────────────────────────────────────────────────────────────
let hudTick = 0;
function updateHud() {
  hudTick++;
  if (hudTick % 4 !== 0 && !TEST) return;
  const F = SECTOR_FLIGHT;
  const z = ship.zone;
  const fuelPct = ship.fuel / F.fuelMax;
  const rangeLy = ship.fuel / F.fuelPerLy;
  let zoneTxt = '<span class="muted">czysta przestrzeń</span>';
  if (z.storm > 0.05) zoneTxt = `<span class="danger">BURZA ${Math.round(z.storm * 100)}%</span> — wiatr, paliwo ×${fmt(z.fuelMul, 2)}`;
  else if (z.nebula > 0.05) zoneTxt = `<span class="warn">mgławica ${Math.round(z.nebula * 100)}%</span> — prędkość ×${fmt(z.speedMul, 2)}, czujniki ×${fmt(z.sensorMul, 2)}`;
  nearestKnown(ship.x, ship.y, nearKnown);
  const ns = nearKnown.index >= 0 ? S0[nearKnown.index] : null;
  $('ship').innerHTML = `
    <div class="lbl">Atlas — strefa międzygwiezdna</div>
    <div class="row"><span>Paliwo</span><span>${fmt(ship.fuel, 0)} / ${F.fuelMax} · zasięg ${fmt(rangeLy, 0)} ly</span></div>
    <div class="bar ${fuelPct < 0.25 ? 'low' : ''}"><i style="width:${(fuelPct * 100).toFixed(1)}%"></i></div>
    <div class="row"><span>Prędkość</span><span>${fmt(ship.speed, 2)} ly/s${ship.burn ? ' <span class="warn">NURT</span>' : ''}${ship.fuel <= 0 ? ' <span class="danger">DRYF</span>' : ''}</span></div>
    <div class="row"><span>Flota</span><span>${fleetImage.escort ? 'Atlas + 3 eskorty' : 'Atlas (sam)'} <span class="muted">· F</span></span></div>
    <div class="row"><span>Położenie</span><span>${fmt(ship.x, 1)} · ${fmt(-ship.y, 1)} ly</span></div>
    <div class="row"><span>Strefa</span><span style="text-align:right">${zoneTxt}</span></div>
    ${ns ? `<div class="row"><span>Najbliżej</span><span>${displayName(nearKnown.index)} · ${fmt(nearKnown.dist, 1)} ly</span></div>` : ''}
    ${S.autopilot ? '<div class="row"><span class="warn">AUTOPILOT</span><span class="muted">W / S / A / D — przejmij</span></div>' : ''}`;
  // Karta układu: wybrany albo najbliższy.
  const ci = S.selected >= 0 ? S.selected : nearKnown.index;
  if (ci >= 0) {
    const s = S0[ci];
    const lv = exp.level[ci];
    const d = Math.sqrt((s.x - ship.x) ** 2 + (s.y - ship.y) ** 2);
    const [r, gg, b] = starColorRgb(s.star).map((v) => Math.round(v * 255));
    let h = `<div class="lbl">${S.selected >= 0 ? 'wybrany układ' : 'najbliższy układ'} · ${EXPLORE_LABELS[lv]}</div>`;
    h += `<h2><span style="color:rgb(${r},${gg},${b})">●</span> ${displayName(ci)}</h2>`;
    h += `<div class="sub">${s.catalog !== s.name && lv >= EXPLORE.SCANNED ? s.catalog + ' · ' : ''}${STAR_CLASSES[s.star].label}${s.companion ? ' + ' + STAR_CLASSES[s.companion].label : ''} · ${s.zone === 'core' ? 'rdzeń' : 'pogranicze'}</div>`;
    if (lv >= EXPLORE.VISITED && s.faction) h += `<div class="row"><span>Właściciel</span><span style="color:${factionColor(s.faction)}">${FACTIONS[s.faction]?.name || s.faction}${s.pirateBase ? ' — kryjówka' : ''}</span></div>`;
    if (lv >= EXPLORE.VISITED && s.gate) h += '<div class="row"><span>Brama warp</span><span class="warn">tak</span></div>';
    if (s.nebula && lv >= EXPLORE.SEEN) h += `<div class="row"><span>Mgławica</span><span>${sector.nebulaById.get(s.nebula).name}</span></div>`;
    if (lv >= EXPLORE.SCANNED) {
      h += `<div class="row"><span>Planety</span><span>${s.planets.length}${s.belts.length ? ` · pasy ${s.belts.length}` : ''}</span></div><div class="chips">`;
      for (const p of s.planets) h += `<span class="chip" title="${p.id} · ${fmt(p.orbitAU, 1)} AU"><i style="background:${PLANET_COLORS[p.type]}"></i>${PLANET_TYPE_LABELS[p.type]}</span>`;
      h += '</div>';
    } else h += `<div class="row muted"><span>Zawartość nieznana</span><span>skan: ≤ ${fmt(SECTOR_FLIGHT.scanRange, 1)} ly, ${fmt(SECTOR_FLIGHT.scanTime, 1)} s</span></div>`;
    h += `<div class="row" style="margin-top:6px"><span>Odległość</span><span>${fmt(d, 1)} ly</span></div>`;
    h += `<div class="row"><span>Lot (przelot / nurt)</span><span>${fmtTime(timeForDistance(d))} / ${fmtTime(timeForDistance(d, true))}</span></div>`;
    const need = fuelForDistance(d);
    h += `<div class="row"><span>Paliwo na lot</span><span class="${need > ship.fuel ? 'danger' : ''}">${fmt(need, 0)}${need > ship.fuel ? ' — za mało!' : ''}</span></div>`;
    h += `<div class="row muted"><span>id</span><span>${s.id}</span></div>`;
    $('card').innerHTML = h;
  }
  // Dziennik.
  $('log').innerHTML = `<div class="lbl">dziennik</div>` + (S.log.length ? S.log.slice().reverse().map((l) => `<div class="${l.cls}"><span class="t">${clock(l.t)}</span>${l.text}</div>`).join('') : '<div class="muted">cisza w eterze</div>');
  // Pasek.
  $('topinfo').textContent = `sektor ${SEED} · ${summary.systems} układów · rdzeń ${summary.core} · mgławice ${summary.nebulae} · zegar ${clock(S.t)}${S.bakeText ? ' · ' + S.bakeText : ''}`;
  // Baner punktu skoku / komunikatu.
  const bn = $('banner');
  if (S.banner && S.t < S.banner.until) {
    bn.style.display = 'block';
    bn.innerHTML = `<div class="big">${S.banner.big}</div><div class="small">${S.banner.small}</div>`;
  } else if (S.jump) {
    const s = S0[S.jump.index];
    bn.style.display = 'block';
    bn.innerHTML = `<div class="big">Punkt skoku ${JUMP_CORNERS[S.jump.corner].key} — wejście do układu ${displayName(S.jump.index)} <span class="muted">(${s.id})</span></div><div class="small"><b>E</b> — skok (w grze: przeładowanie strony z id układu)</div>`;
  } else bn.style.display = 'none';
}

// ── klatka ────────────────────────────────────────────────────────────────────────────────────────
function frame(dt, draw = true) {
  // Kamera: z bliska — sprężyna lotu (wyprzedzenie, zoom z prędkości, drżenie w burzy), przy oddaleniu
  // do środka sektora.
  if (!cam.init) updateCamera(0);
  const fz = fitZoom();
  const w = smooth01(fz * 1.0, fz * 2.6, S.zoom);
  const cxS = (B.x0 + B.x1) / 2;
  const cyS = (B.y0 + B.y1) / 2;
  view.z = S.zoom * (1 + (cam.zoomMul - 1) * w);
  const storm = ship.zone.storm;
  const sh = storm > 0.02 ? (CAMERA.shakePx * storm * w) / view.z : 0;
  const shx = sh * (Math.sin(S.t * 27.1) * 0.6 + Math.sin(S.t * 13.7 + 1.3) * 0.4);
  const shy = sh * (Math.sin(S.t * 23.3 + 0.7) * 0.6 + Math.sin(S.t * 11.9 + 2.1) * 0.4);
  view.x = cxS + (cam.x - cxS) * w + shx;
  view.y = cyS + (cam.y - cyS) * w + shy;
  if (dt > 0) {
    const k = 1 - Math.exp(-dt * 8);
    const vx = Math.max(-1, Math.min(1, (view.x - cam.prevX) / dt));
    const vy = Math.max(-1, Math.min(1, (view.y - cam.prevY) / dt));
    cam.velX += (vx - cam.velX) * k;
    cam.velY += (vy - cam.velY) * k;
  }
  cam.prevX = view.x;
  cam.prevY = view.y;
  const dust = 1 + 2.2 * ship.zone.nebula + 3 * storm;
  const v = image.setView(view.x, view.y, view.z, innerWidth, innerHeight, DPR, S.t, cam.velX, cam.velY, dust);
  image.U.selected.value = S.selected;
  fleetImage.update(dt, S.t, ship, sector, view.z);
  const bolts = image.updateFlashes(dt, S.t, v);
  if (!draw) return;
  image.render();
  drawOverlay(dt, bolts);
  updateHud();
}

let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 1) { S.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (!TEST) {
    step(dt);
    frame(dt);
  }
  requestAnimationFrame(loop);
}

// ── haki harnessu (scripts/webgpu/mapa-gwiezdna-demo.mjs) ────────────────────────────────────────
Object.assign(window.__mapa, {
  sector,
  fleets,
  ship,
  exp,
  S,
  summary,
  /**
   * n klatek z krokiem 1/fps: symulacja i stan obrazu (kamera, historia ogonów) w każdej, RYSUNEK tylko ostatniej —
   * w nowej klatce rAF. AGENT: pass sceny three (`PassNode`, updateBefore FRAME) renderuje się RAZ na klatkę rAF
   * (frameId rośnie w pętli animacji renderera) — kilka `render()` w jednym zadaniu JS dawało obraz GPU z pierwszej
   * klatki serii pod nakładką 2D z ostatniej.
   */
  async runFrames(n = 1, fps = 60) {
    for (let i = 0; i < n - 1; i++) {
      step(1 / fps);
      frame(1 / fps, false);
    }
    step(1 / fps);
    await new Promise((r) => requestAnimationFrame(() => r()));
    frame(1 / fps);
    await new Promise((r) => requestAnimationFrame(() => r()));
    return this.stats();
  },
  waitBakes: () => new Promise((res) => {
    const check = () => (window.__mapa.bakes ? res(window.__mapa.bakes) : setTimeout(check, 100));
    check();
  }),
  teleport(x, y, heading = ship.heading) {
    ship.x = x; ship.y = y; ship.vx = 0; ship.vy = 0; ship.heading = heading;
    cam.init = false;
  },
  escort(on = true) { fleetImage.escort = !!on; },
  fleetImage,
  image,
  renderer,
  waitShips: () => fleetImage.loading.then(() => fleetImage.loaded),
  teleportTo(id, dx = 0, dy = 0) {
    const s = sector.byId.get(id);
    this.teleport(s.x + dx, s.y + dy);
  },
  setZoom(z) { S.zoom = S.zoomTarget = Math.max(fitZoom(), Math.min(ZOOM_MAX, z === 'fit' ? fitZoom() : z)); S.sectorView = z === 'fit'; },
  select(id) { S.selected = id == null ? -1 : sector.indexOf.get(id); },
  keys(list) { S.keys.clear(); for (const k of list || []) S.keys.add(k); },
  autopilot(id) { setAutopilotSystem(sector.indexOf.get(id)); },
  jump: () => tryJump(),
  setFuel(v) { ship.fuel = v; },
  stats() {
    const vis = fleets.fleets.filter((f) => fleetVisibleToPlayer(f, sector, ship, ship.zone.sensorMul)).length;
    return {
      t: Math.round(S.t * 10) / 10,
      zoom: Math.round(S.zoom * 10) / 10,
      ship: { x: Math.round(ship.x * 1000) / 1000, y: Math.round(ship.y * 1000) / 1000, speed: Math.round(ship.speed * 1000) / 1000, fuel: Math.round(ship.fuel * 10) / 10 },
      zone: { nebula: Math.round(ship.zone.nebula * 100) / 100, storm: Math.round(ship.zone.storm * 100) / 100 },
      jump: S.jump ? { id: S0[S.jump.index].id, corner: JUMP_CORNERS[S.jump.corner].key } : null,
      fleetsVisible: vis,
      fleets: fleets.fleets.length,
      ships: fleetImage.ships.length,
      shipsLoaded: fleetImage.loaded,
      camera: { x: Math.round(view.x * 100) / 100, y: Math.round(view.y * 100) / 100, z: Math.round(view.z * 10) / 10 },
      fleetTickMs: Math.round(S.fleetMs * 1000) / 1000,
      fleetTick: FLEET_TICK,
      events: fleets.events.length,
      explored: Array.from(exp.level).reduce((a, l) => { a[l] = (a[l] || 0) + 1; return a; }, {}),
      bakes: window.__mapa.bakes || null,
      log: S.log.map((l) => l.text)
    };
  }
});

frame(0);
window.__mapa.ready = true;
requestAnimationFrame(loop);
