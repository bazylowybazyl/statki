// Zasięg radarów — demo propozycji wyglądu (2026-11-03, etap 1; opis i decyzje: docs/PLAN-zasieg-czujnikow.md).
// Model i geometria z gry 1:1: src/game/sensorDetection.js (czujniki × sygnatura × osłona, KONTAKT / IDENTYFIKACJA,
// niepewność miejsca kontaktu), src/game/sensorCoverage.js (suma kół → jeden obrys, skupiska, krawędź najbliżej,
// grupy znaczników), zasięgi czujników z SHIP_SENSOR_PROFILES, wzrok z FOG_TUNE, symbole śladów radaru kokpitu.
// Propozycje: 1 KONTUR, 2 STREFY, 3 IZOLINIE, 4 HUD BOJOWY, 5 MGŁA RADAROWA. Klawisze — pasek na dole strony.
import {
  DETECTION_TUNE, SENSOR_DRIVE, SENSOR_LEVEL, SENSOR_SIZE_LABELS, computeDetectionPicture, contactOffset,
  contactSizeClass, createDetectionPicture, createSensorState, entitySignature, noteSensorFire, noteSensorPing,
  sensorStrength, stepSensorState
} from '../src/game/sensorDetection.js';
import {
  addCoverageCircle, beginCoverage, buildCoverage, coverageCountAt, createCoverage, createPointGroups, groupPoints,
  nearestCoverageEdge
} from '../src/game/sensorCoverage.js';
import { SHIP_SENSOR_PROFILES } from '../src/data/ships.js';
import { FOG_TUNE } from '../src/game/fogOfWar.js';
import { drawRadarSymbol, radarColor } from '../src/ui/radar/radarSymbols.js';
import { RADAR_RGB, formatRadarDistance } from '../src/ui/radar/radarConfig.js';

const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- propozycje
const VARIANTS = [
  { key: 'kontur', name: 'KONTUR', desc: 'Jak w Starsectorze: radary wroga zszyte w jeden obrys z lekkim wypełnieniem, jeden podpis na skupisko (liczba radarów, zasięg). Radar zidentyfikowany — linia ciągła, oszacowany z samej sygnatury — przerywana. Wokół okrętu pierścień wykrywalności: z jakiej odległości widzi cię pancernik.' },
  { key: 'strefy', name: 'STREFY', desc: 'Mapa zagrożenia: im więcej radarów zachodzi na siebie, tym mocniejsza czerwień; brzeg świeci tylko od środka strefy. W strefie — czerwona winieta i napis WYKRYTY u góry.' },
  { key: 'izolinie', name: 'IZOLINIE', desc: 'Jak poziomice: brzeg stref wroga przy obecnej sygnaturze (ciągły), w cichej pracy (kreski) i na pełnym ciągu (kropki) — widać, którędy przemknąć w ciszy. Cyjan: twoje czujniki dla celu FF / BB / SC.' },
  { key: 'hud', name: 'HUD BOJOWY', desc: 'Bez plam: tylko brzeg stref blisko okrętu (z kreskami do środka strefy), pierścień wokół okrętu z namiarami radarów, które cię widzą, i wskaźnik najbliższej krawędzi (także poza kadrem).' },
  { key: 'mgla', name: 'MGŁA RADAROWA', desc: 'Zasięg wpisany w mgłę wojny: poza czujnikami ciemno i chmury, w zasięgu kontaktu półmrok, w zasięgu wzroku jasno. Strefy wroga barwią mgłę na czerwono — wariant pod post „uber”.' }
];
let variant = Math.max(0, Math.min(VARIANTS.length - 1, (Number(params.get('wariant')) || 1) - 1));

// ---------------------------------------------------------------- kadłuby (dane gry)
const P = SHIP_SENSOR_PROFILES;
const V = FOG_TUNE.vision;
const HULLS = {
  atlas: { cls: 'SC', base: 1.3, sens: P.atlas_combat, vision: V.atlas, speed: 507, boost: 1137, kind: 'ship', name: 'Atlas' },
  scout: { cls: 'FF', base: 0.7, sens: P.frigate_radar, vision: V.radar, speed: 820, boost: 1500, kind: 'ship', name: 'Fregata zwiadu' },
  frigate: { cls: 'FF', base: 0.7, sens: P.frigate_combat, vision: V.frigate, speed: 450, kind: 'ship' },
  radar: { cls: 'FF', base: 0.7, sens: P.frigate_radar, vision: V.radar, speed: 450, kind: 'ship', note: 'RADAR' },
  destroyer: { cls: 'DD', base: 0.85, sens: P.destroyer_combat, vision: V.destroyer, speed: 380, kind: 'ship' },
  battleship: { cls: 'BB', base: 1.0, sens: P.battleship_combat, vision: V.battleship, speed: 280, kind: 'ship' },
  fighter: { cls: 'FT', base: 0.5, sens: P.fighter_combat, vision: V.fighter, speed: 1400, kind: 'fighter' },
  station: { cls: 'ST', base: 1.5, sens: { passiveRange: 60000, activeRange: 60000 }, vision: V.station, kind: 'station' },
  sensorStation: { cls: 'ST', base: 1.5, sens: { passiveRange: 45000, activeRange: 45000 }, vision: V.sensorStation, kind: 'station' },
  drone: { cls: 'DR', base: 0.3, sens: { passiveRange: 30000, activeRange: 30000 }, vision: V.drone, kind: 'drone', speed: 3000 }
};
// Moc radaru zgadywana z rozmiaru kontaktu (MAŁY … OGROMNY), póki nie zidentyfikowany.
const STRENGTH_GUESS = [18000, 30000, 45000, 60000];
const GHOST_SEC = 25;
const HYPER_SPEED = 20000;
const REF_SIG = 1.0; // własne czujniki pokazujemy dla celu o sygnaturze pancernika

// ---------------------------------------------------------------- teren: pas asteroid (fala), obłok gazu
const BELT = { y: 50000, amp: 6000, len: 70000, half: 12000, rim: 3500, x0: -60000, x1: 260000 };
const GAS = { x: 98000, y: -48000, r: 18000 };
function beltCenterY(x) { return BELT.y + BELT.amp * Math.sin(x / BELT.len); }
function coverAt(x, y) {
  let c = DETECTION_TUNE.cover.open;
  if (x > BELT.x0 && x < BELT.x1) {
    const d = Math.abs(y - beltCenterY(x));
    if (d < BELT.half) c = DETECTION_TUNE.cover.belt;
    else if (d < BELT.half + BELT.rim) c = DETECTION_TUNE.cover.beltRim;
  }
  const dx = x - GAS.x, dy = y - GAS.y;
  if (dx * dx + dy * dy < GAS.r * GAS.r) c = Math.min(c, DETECTION_TUNE.cover.gas);
  return c;
}

// ---------------------------------------------------------------- byty
let nextId = 1;
const ents = [];
function makeEnt(side, hull, x, y, extra = {}) {
  const e = {
    id: nextId++, side, hull, H: HULLS[hull], x, y, vx: 0, vy: 0, heading: 0,
    st: createSensorState(), signature: 1, strength: 0, cover: 1, ident: 0, tx: x, ty: y, role: '',
    // wiedza strony gracza o bycie (dla piratów)
    k: { level: 0, ident: false, seenAt: -1e9, x: 0, y: 0, err: 0, sigSeen: 1, disc: false },
    ...extra
  };
  ents.push(e);
  return e;
}

const player = makeEnt('friendly', 'atlas', 0, 0, { role: 'player' });
const escorts = [
  makeEnt('friendly', 'frigate', -2600, -2200, { role: 'escort', ox: -2600, oy: -2200 }),
  makeEnt('friendly', 'frigate', -2600, 2200, { role: 'escort', ox: -2600, oy: 2200 })
];
// dron A rozpoznaje środkową czatę (G — dron do kursora), dron B pilnuje floty piratów z daleka
const drone = makeEnt('friendly', 'drone', 52000, -14000, { role: 'drone' });
makeEnt('friendly', 'drone', 92000, -47000, { role: 'drone' });
makeEnt('friendly', 'sensorStation', -30000, 30000, { role: 'station', name: 'STACJA CZUJNIKÓW' });

const pickets = [
  makeEnt('pirate', 'radar', 60000, -62000, { role: 'picket' }),
  makeEnt('pirate', 'radar', 60000, -2000, { role: 'picket' }),
  makeEnt('pirate', 'radar', 60000, 58000, { role: 'picket' })   // w pasie asteroid — osłona
];
const fleetHome = { x: 105000, y: -30000, r: 9000 };
const flagship = makeEnt('pirate', 'battleship', fleetHome.x + fleetHome.r, fleetHome.y, { role: 'flag' });
const FLEET_OFFS = [[-2600, -1800, 'destroyer'], [-2600, 1800, 'destroyer'], [-4600, -3600, 'frigate'], [-4600, 3600, 'frigate'],
  [-5200, 0, 'frigate'], [-1200, -4200, 'frigate'], [-1200, 4200, 'frigate']];
for (const [ox, oy, h] of FLEET_OFFS) makeEnt('pirate', h, flagship.x + ox, flagship.y + oy, { role: 'fleet', ox, oy });
for (let i = 0; i < 6; i++) makeEnt('pirate', 'fighter', flagship.x, flagship.y, { role: 'cap', phase: i / 6 * TAU });
const raider = makeEnt('pirate', 'destroyer', 30000, 100000, { role: 'raider', wp: 0 });
const RAIDER_PATH = [[30000, 100000], [110000, 105000], [150000, 85000], [80000, 125000]];
makeEnt('pirate', 'station', 165000, 35000, { role: 'station', name: 'STACJA PIRATÓW' });

const pirates = ents.filter((e) => e.side === 'pirate');
const friendlies = ents.filter((e) => e.side === 'friendly');

// ---------------------------------------------------------------- stan demo
let time = 0;
let paused = false;
let truth = params.get('prawda') === '1';
let alarmAt = -1e9;
const alarm = { x: 0, y: 0 };
const keys = new Set();
const pings = [];   // { x, y, t0, r, v, aff }
const flashes = []; // { x, y, t0 }
const picture = createDetectionPicture(64);
const covEnemy = createCoverage();
const covTruth = createCoverage();
const covOwn = createCoverage();
const covVision = createCoverage();
const covIso = [createCoverage(), createCoverage(), createCoverage()];
const covOwnIso = [createCoverage(), createCoverage(), createCoverage()];
const enemyInfo = [];   // tag → { est, ghost, e }
const edge = { x: 0, y: 0, dist: 0, inside: false, arc: -1, circle: -1 };
const groupsA = createPointGroups();
const groupsB = createPointGroups();
const tmpState = createSensorState();
let playerSigEff = 1;
let detectedTrue = 0, detectedKnown = 0;

// ---------------------------------------------------------------- kanwa i kamera
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
const cam = { x: 68000, y: 18000, zoom: 0.006, follow: false, preset: 'cic' };
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  if (cam.preset === 'cic') cam.zoom = Math.min(W / 300000, H / 210000);
}
resize();
window.addEventListener('resize', resize);
const sx = (x) => (x - cam.x) * cam.zoom + W / 2;
const sy = (y) => (y - cam.y) * cam.zoom + H / 2;
const wx = (px) => (px - W / 2) / cam.zoom + cam.x;
const wy = (py) => (py - H / 2) / cam.zoom + cam.y;

function setPreset(p) {
  cam.preset = p;
  if (p === 'cic') { cam.zoom = Math.min(W / 300000, H / 210000); }
  else { cam.zoom = W / 45000; cam.follow = true; }
}
if (params.get('kadr') === 'taktyczny') setPreset('taktyczny');

// ---------------------------------------------------------------- wejście
const tabs = document.getElementById('tabs');
VARIANTS.forEach((v, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1} ${v.name}`;
  b.addEventListener('click', () => { variant = i; syncTabs(); });
  tabs.appendChild(b);
});
function syncTabs() { [...tabs.children].forEach((b, i) => b.classList.toggle('on', i === variant)); }
syncTabs();

let mouseX = 0, mouseY = 0;
window.addEventListener('keydown', (ev) => {
  const k = ev.key.toLowerCase();
  if (ev.repeat && 'cfxhgtzlp'.includes(k)) return;
  if (k >= '1' && k <= '5') { variant = Number(k) - 1; syncTabs(); }
  else if (k === 'c') player.st.silent = !player.st.silent;
  else if (k === 'f') { noteSensorFire(player.st); flashes.push({ x: player.x, y: player.y, t0: time }); }
  else if (k === 'x') {
    noteSensorPing(player.st);
    pings.push({ x: player.x, y: player.y, t0: time, r: player.H.sens.activeRange, v: player.H.sens.scanWaveSpeed || 40000 });
  } else if (k === 'h') { switchHull(); }
  else if (k === 'g') { drone.tx = wx(mouseX); drone.ty = wy(mouseY); }
  else if (k === 't') truth = !truth;
  else if (k === 'z') setPreset(cam.preset === 'cic' ? 'taktyczny' : 'cic');
  else if (k === 'l') cam.follow = !cam.follow;
  else if (k === 'p') paused = !paused;
  else if (k === ' ') { player.st.drive = player.st.drive === SENSOR_DRIVE.hyper ? SENSOR_DRIVE.combat : SENSOR_DRIVE.hyper; ev.preventDefault(); }
  keys.add(k);
});
window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function switchHull() {
  player.hull = player.hull === 'atlas' ? 'scout' : 'atlas';
  player.H = HULLS[player.hull];
}

let drag = null;
canvas.addEventListener('mousedown', (ev) => {
  const dp = Math.hypot(ev.clientX - sx(player.x), ev.clientY - sy(player.y));
  drag = dp < 16 ? { mode: 'player' } : { mode: 'pan', x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y };
  if (drag.mode === 'pan') cam.follow = false;
});
window.addEventListener('mousemove', (ev) => {
  mouseX = ev.clientX; mouseY = ev.clientY;
  if (!drag) return;
  if (drag.mode === 'player') { player.x = wx(ev.clientX); player.y = wy(ev.clientY); player.vx = 0; player.vy = 0; }
  else { cam.x = drag.cx - (ev.clientX - drag.x) / cam.zoom; cam.y = drag.cy - (ev.clientY - drag.y) / cam.zoom; }
});
window.addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const ax = wx(ev.clientX), ay = wy(ev.clientY);
  cam.zoom = Math.max(W / 600000, Math.min(W / 8000, cam.zoom * Math.exp(-ev.deltaY * 0.0012)));
  cam.preset = '';
  cam.x = ax - (ev.clientX - W / 2) / cam.zoom;
  cam.y = ay - (ev.clientY - H / 2) / cam.zoom;
}, { passive: false });

// ---------------------------------------------------------------- symulacja
function steer(e, tx, ty, speed, dt, arrive = 0.6) {
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const want = d > 1 ? Math.min(speed, d * arrive) : 0;
  const dvx = (d > 1 ? dx / d * want : 0) - e.vx;
  const dvy = (d > 1 ? dy / d * want : 0) - e.vy;
  const a = Math.min(1, dt * 1.6);
  e.vx += dvx * a; e.vy += dvy * a;
  e.x += e.vx * dt; e.y += e.vy * dt;
  const v = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
  if (v > 5) e.heading = Math.atan2(e.vy, e.vx);
  e.st.thrust = speed > 0 ? Math.min(1, want / speed) : 0;
}

function stepPlayer(dt) {
  let ix = 0, iy = 0;
  if (keys.has('w')) iy -= 1;
  if (keys.has('s')) iy += 1;
  if (keys.has('a')) ix -= 1;
  if (keys.has('d')) ix += 1;
  const il = Math.hypot(ix, iy);
  const hyper = player.st.drive === SENSOR_DRIVE.hyper;
  const boost = keys.has('shift') && !hyper;
  if (!hyper) player.st.drive = boost ? SENSOR_DRIVE.boost : SENSOR_DRIVE.combat;
  let speed = hyper ? HYPER_SPEED : (boost ? player.H.boost : player.H.speed);
  if (player.st.silent) speed *= 0.6;
  const tvx = il > 0 ? ix / il * speed : 0;
  const tvy = il > 0 ? iy / il * speed : 0;
  const a = Math.min(1, dt * (hyper ? 0.9 : 1.4));
  player.vx += (tvx - player.vx) * a;
  player.vy += (tvy - player.vy) * a;
  if (!drag || drag.mode !== 'player') { player.x += player.vx * dt; player.y += player.vy * dt; }
  const v = Math.hypot(player.vx, player.vy);
  if (v > 5) player.heading = Math.atan2(player.vy, player.vx);
  player.st.thrust += ((il > 0 ? 1 : 0) - player.st.thrust) * Math.min(1, dt * 3);
}

function stepAi(dt) {
  const alarmed = time - alarmAt < 20;
  // flota: patrol po okręgu albo pościg za ostatnim wykryciem
  const pa = time * 0.012;
  if (alarmed) steer(flagship, alarm.x, alarm.y, flagship.H.speed, dt, 0.3);
  else steer(flagship, fleetHome.x + Math.cos(pa) * fleetHome.r, fleetHome.y + Math.sin(pa) * fleetHome.r, flagship.H.speed * 0.6, dt);
  const ch = Math.cos(flagship.heading), shh = Math.sin(flagship.heading);
  for (const e of pirates) {
    if (e.role === 'fleet') {
      steer(e, flagship.x + e.ox * ch - e.oy * shh, flagship.y + e.ox * shh + e.oy * ch, e.H.speed, dt, 0.8);
    } else if (e.role === 'cap') {
      const a = time * 0.25 + e.phase;
      steer(e, flagship.x + Math.cos(a) * 5000, flagship.y + Math.sin(a) * 5000, e.H.speed, dt, 1.2);
    } else if (e.role === 'raider') {
      const dAl = Math.hypot(alarm.x - e.x, alarm.y - e.y);
      if (alarmed && dAl < 80000) steer(e, alarm.x, alarm.y, e.H.speed, dt, 0.3);
      else {
        const [tx, ty] = RAIDER_PATH[e.wp];
        if (Math.hypot(tx - e.x, ty - e.y) < 3000) e.wp = (e.wp + 1) % RAIDER_PATH.length;
        steer(e, tx, ty, e.H.speed * 0.8, dt, 1);
      }
    } else if (e.role === 'picket' || e.role === 'station') {
      e.st.thrust = 0;
    }
    // ostrzał z bliska zdradza strzelca
    if (e.H.kind !== 'station' && Math.hypot(player.x - e.x, player.y - e.y) < 14000 && ((time + e.id * 0.37) % 2.2) < dt) {
      noteSensorFire(e.st);
      flashes.push({ x: e.x, y: e.y, t0: time });
    }
  }
}

function stepFriendlies(dt) {
  for (const e of escorts) {
    e.st.silent = player.st.silent;  // grupa gracza przechodzi w ciszę razem z nim
    const sp = Math.max(e.H.speed, Math.hypot(player.vx, player.vy) * 1.15);
    steer(e, player.x + e.ox, player.y + e.oy, sp, dt, 1.2);
  }
  for (const e of friendlies) if (e.role === 'drone') steer(e, e.tx, e.ty, e.H.speed, dt, 0.8);
}

function updateSensors(dt) {
  for (const e of ents) {
    stepSensorState(e.st, dt);
    e.cover = coverAt(e.x, e.y);
    e.signature = entitySignature(e.H.base, e.st);
    e.strength = sensorStrength(e.H.sens.passiveRange, e.H.sens.activeRange, e.st);
    e.ident = e.H.vision;
  }
  // jeden przebieg: każdy byt jako cel strony przeciwnej (źródła tej samej strony są pomijane)
  computeDetectionPicture(picture, ents, ents.length, ents, ents.length);
  detectedTrue = 0;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const lv = picture.level[i];
    if (e.side === 'friendly') {
      if (lv > 0) {
        if (e === player || time - alarmAt > 1) { alarm.x = e.x; alarm.y = e.y; }
        alarmAt = time;
        if (e === player) detectedTrue = picture.seenBy[i];
      }
      continue;
    }
    const k = e.k;
    if (lv > 0) {
      if (lv === SENSOR_LEVEL.IDENTIFIED) k.ident = true;
      else if (k.level === 0 && time - k.seenAt > 1) k.ident = false; // ponowny kontakt po zgubieniu — znów nieznany
      if (e.H.kind === 'station' && k.ident) k.disc = true;
      k.seenAt = time;
      k.sigSeen = e.signature * e.cover;
      const src = ents[picture.by[i]];
      const d = Math.hypot(e.x - src.x, e.y - src.y);
      if (lv === SENSOR_LEVEL.IDENTIFIED) { k.x = e.x; k.y = e.y; k.err = 0; }
      else {
        const o = contactOffset(e.id, time, d, picture.detectR[i], src.ident, _off);
        k.x = e.x + o.x; k.y = e.y + o.y; k.err = o.err;
      }
    }
    k.level = lv;
  }
}
const _off = { x: 0, y: 0, err: 0 };

function knownState(e) {
  const k = e.k;
  if (k.level > 0) return 'live';
  if (k.disc) return 'disc';
  if (time - k.seenAt < GHOST_SEC) return 'ghost';
  return null;
}

function sigFor(state) {
  return entitySignature(player.H.base, state) * player.cover;
}

function buildCoverages() {
  playerSigEff = player.signature * player.cover;
  // strefy wroga ZNANE graczowi, przy obecnej sygnaturze okrętu
  beginCoverage(covEnemy);
  enemyInfo.length = 0;
  for (const e of pirates) {
    const ks = knownState(e);
    if (!ks) continue;
    const k = e.k;
    const est = !k.ident;
    const strength = est ? STRENGTH_GUESS[contactSizeClass(k.sigSeen)] : e.strength;
    enemyInfo.push({ est, ghost: ks === 'ghost', e, strength });
    addCoverageCircle(covEnemy, k.x, k.y, strength * playerSigEff, enemyInfo.length - 1);
  }
  buildCoverage(covEnemy);
  detectedKnown = coverageCountAt(covEnemy, player.x, player.y);
  nearestCoverageEdge(covEnemy, player.x, player.y, edge);
  if (truth) {
    beginCoverage(covTruth);
    for (const e of pirates) addCoverageCircle(covTruth, e.x, e.y, e.strength * playerSigEff);
    buildCoverage(covTruth);
  }
  // własne czujniki (cel o sygnaturze pancernika) i wzrok
  beginCoverage(covOwn);
  beginCoverage(covVision);
  for (const e of friendlies) {
    addCoverageCircle(covOwn, e.x, e.y, e.strength * REF_SIG);
    addCoverageCircle(covVision, e.x, e.y, e.ident);
  }
  buildCoverage(covOwn);
  buildCoverage(covVision);
  if (VARIANTS[variant].key === 'izolinie') {
    tmpState.silent = true; tmpState.thrust = 0; tmpState.drive = SENSOR_DRIVE.combat;
    const sSilent = sigFor(tmpState);
    tmpState.silent = false; tmpState.thrust = 1; tmpState.drive = SENSOR_DRIVE.boost;
    const sLoud = sigFor(tmpState);
    const sigs = [playerSigEff, sSilent, sLoud];
    for (let v = 0; v < 3; v++) {
      const c = covIso[v];
      beginCoverage(c);
      for (let i = 0; i < covEnemy.n; i++) addCoverageCircle(c, covEnemy.x[i], covEnemy.y[i], covEnemy.r[i] / playerSigEff * sigs[v], covEnemy.tag[i]);
      buildCoverage(c);
    }
    const own = [0.7, 1.0, 1.3];
    for (let v = 0; v < 3; v++) {
      const c = covOwnIso[v];
      beginCoverage(c);
      for (const e of friendlies) addCoverageCircle(c, e.x, e.y, e.strength * own[v]);
      buildCoverage(c);
    }
    covIso.sigs = sigs;
  }
}

// ---------------------------------------------------------------- rysunek: tło, teren
const starTile = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  let s = 1234567;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 220; i++) {
    const a = 0.15 + rnd() * rnd() * 0.75;
    g.fillStyle = `rgba(${200 + rnd() * 55 | 0}, ${210 + rnd() * 45 | 0}, 255, ${a.toFixed(2)})`;
    const r = rnd() < 0.92 ? 0.6 : 1.1;
    g.fillRect(rnd() * 512, rnd() * 512, r, r);
  }
  return c;
})();

// szum wartości zawinięty (kafel bez szwów) — chmury mgły w propozycji 5
const noiseTile = (() => {
  const N = 192, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const lat = (gx, gy, per, salt) => {
    gx = ((gx % per) + per) % per; gy = ((gy % per) + per) % per;
    let h = Math.imul(gx * 374761393 + gy * 668265263 + salt * 2147483647, 1274126177);
    h ^= h >>> 13; h = Math.imul(h, 1103515245);
    return ((h >>> 0) % 10000) / 10000;
  };
  const vnoise = (x, y, per, salt) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = lat(x0, y0, per, salt), b = lat(x0 + 1, y0, per, salt), cc = lat(x0, y0 + 1, per, salt), d = lat(x0 + 1, y0 + 1, per, salt);
    return a + (b - a) * ux + (cc - a) * uy + (a - b - cc + d) * ux * uy;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, amp = 0.55, f = 4;
    for (let o = 0; o < 4; o++) { v += vnoise(x / N * f, y / N * f, f, o + 1) * amp; amp *= 0.5; f *= 2; }
    const a = Math.max(0, Math.min(1, (v - 0.35) * 1.9));
    const i = (y * N + x) * 4;
    img.data[i] = 70; img.data[i + 1] = 92; img.data[i + 2] = 128; img.data[i + 3] = a * 150;
  }
  g.putImageData(img, 0, 0);
  return c;
})();

function drawBackground() {
  ctx.fillStyle = '#04070c';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.35, Math.max(W, H) * 0.8);
  g.addColorStop(0, 'rgba(14, 26, 44, 0.9)');
  g.addColorStop(1, 'rgba(4, 7, 12, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // gwiazdy z lekką paralaksą
  const ox = -((cam.x * cam.zoom * 0.04) % 512) - 512, oy = -((cam.y * cam.zoom * 0.04) % 512) - 512;
  for (let y = oy; y < H; y += 512) for (let x = ox; x < W; x += 512) ctx.drawImage(starTile, x, y);
  // siatka: krok tak, żeby linie były co ~90–220 px
  const steps = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
  let step = steps[steps.length - 1];
  for (const s of steps) if (s * cam.zoom >= 90) { step = s; break; }
  ctx.lineWidth = 1;
  ctx.strokeStyle = radarColor(RADAR_RGB.grid, 0.05);
  ctx.beginPath();
  const x0 = Math.floor(wx(0) / step) * step, y0 = Math.floor(wy(0) / step) * step;
  for (let x = x0; x <= wx(W); x += step) { const p = Math.round(sx(x)) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
  for (let y = y0; y <= wy(H); y += step) { const p = Math.round(sy(y)) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
  ctx.stroke();
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = radarColor(RADAR_RGB.grid, 0.28);
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(`siatka ${formatRadarDistance(step)}`, 14, H - 56);
}

function drawTerrain() {
  // pas asteroid: wstęga (osłona ×0,6, obrzeże ×0,8)
  const xa = Math.max(BELT.x0, wx(-50)), xb = Math.min(BELT.x1, wx(W + 50));
  if (xb > xa) {
    const n = 64;
    const band = (half, dir) => {
      for (let i = 0; i <= n; i++) {
        const x = dir > 0 ? xa + (xb - xa) * i / n : xb - (xb - xa) * i / n;
        const y = beltCenterY(x) + half * dir;
        if (i === 0 && dir > 0) ctx.moveTo(sx(x), sy(y)); else ctx.lineTo(sx(x), sy(y));
      }
    };
    ctx.beginPath(); band(-(BELT.half + BELT.rim), 1); band(BELT.half + BELT.rim, -1); ctx.closePath();
    ctx.fillStyle = radarColor(RADAR_RGB.clutter, 0.05); ctx.fill();
    ctx.beginPath(); band(-BELT.half, 1); band(BELT.half, -1); ctx.closePath();
    ctx.fillStyle = radarColor(RADAR_RGB.clutter, 0.08); ctx.fill();
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = radarColor(RADAR_RGB.clutter, 0.3); ctx.stroke();
    ctx.setLineDash([]);
    // ziarno skał w siatce świata (nie migocze), gęstość wg zoomu
    const cell = Math.max(400, 26 / cam.zoom);
    const cx0 = Math.floor(xa / cell), cx1 = Math.ceil(xb / cell);
    const yMin = BELT.y - BELT.amp - BELT.half - BELT.rim, yMax = BELT.y + BELT.amp + BELT.half + BELT.rim;
    const cy0 = Math.floor(Math.max(yMin, wy(0)) / cell), cy1 = Math.ceil(Math.min(yMax, wy(H)) / cell);
    ctx.fillStyle = radarColor(RADAR_RGB.rock, 0.45);
    for (let gy = cy0; gy <= cy1; gy++) for (let gx = cx0; gx <= cx1; gx++) {
      let h = Math.imul(gx * 73856093 ^ gy * 19349663, 0x5bd1e995); h ^= h >>> 15;
      const u = ((h >>> 0) & 0xffff) / 65536, v = ((h >>> 16) & 0xffff) / 65536;
      const x = (gx + u) * cell, y = (gy + v) * cell;
      if (Math.abs(y - beltCenterY(x)) > BELT.half + BELT.rim * u) continue;
      const r = 0.6 + (h & 3) * 0.35;
      ctx.fillRect(sx(x) - r / 2, sy(y) - r / 2, r, r);
    }
    const lx = Math.max(xa, Math.min(xb, wx(W * 0.18)));
    label(`PAS ASTEROID · OSŁONA ×${fmtMul(DETECTION_TUNE.cover.belt)}`, sx(lx), sy(beltCenterY(lx) - BELT.half) - 6, RADAR_RGB.clutter, 0.55, 'left');
  }
  // obłok gazu
  const gx = sx(GAS.x), gy = sy(GAS.y), gr = GAS.r * cam.zoom;
  const g = ctx.createRadialGradient(gx, gy, gr * 0.2, gx, gy, gr);
  g.addColorStop(0, 'rgba(150, 120, 230, 0.12)');
  g.addColorStop(0.75, 'rgba(120, 100, 210, 0.07)');
  g.addColorStop(1, 'rgba(120, 100, 210, 0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(gx, gy, gr, 0, TAU); ctx.fill();
  label(`GAZ · OSŁONA ×${fmtMul(DETECTION_TUNE.cover.gas)}`, gx, gy - gr * 0.55, RADAR_RGB.mass, 0.6, 'center');
}

// ---------------------------------------------------------------- rysunek: pomocnicze
function fmtMul(v) { return (Math.round(v * 100) / 100).toString().replace('.', ','); }
function plural(n, one, few, many) {
  const d = n % 10, h = n % 100;
  if (n === 1) return one;
  if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return few;
  return many;
}
function label(text, x, y, rgb, alpha = 1, align = 'left', font = '10px Consolas, monospace', base = 'bottom') {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.lineWidth = 3;
  ctx.strokeStyle = `rgba(3, 5, 8, ${(0.75 * alpha).toFixed(3)})`;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = radarColor(rgb, alpha);
  ctx.fillText(text, x, y);
}

function pathUnion(cov) {
  ctx.beginPath();
  for (let i = 0; i < cov.n; i++) {
    if (!cov.alive[i]) continue;
    const x = sx(cov.x[i]), y = sy(cov.y[i]), r = cov.r[i] * cam.zoom;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
}
function pathArcs(cov, pick) {
  ctx.beginPath();
  for (let k = 0; k < cov.arcN; k++) {
    if (pick && !pick(cov.tag[cov.arcCircle[k]])) continue;
    const i = cov.arcCircle[k];
    const x = sx(cov.x[i]), y = sy(cov.y[i]), r = cov.r[i] * cam.zoom;
    const a0 = cov.arcA0[k], a1 = cov.arcA1[k];
    ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    ctx.arc(x, y, r, a0, a1);
  }
}
const isEst = (tag) => !!enemyInfo[tag]?.est;
const isSure = (tag) => !enemyInfo[tag]?.est;

// Podpisy skupisk: szczyt sumy; gdy poza kadrem — punkt brzegu najbliżej środka ekranu.
const _lab = { x: 0, y: 0, dist: 0, inside: false, arc: -1, circle: -1 };
function clusterLabels(cov, rgb, alpha, textOf, fallback = true) {
  nearestCoverageEdge(cov, wx(W / 2), wy(H / 2), _lab);
  const nearCluster = _lab.circle >= 0 ? cov.cluster[_lab.circle] : -1;
  for (let c = 0; c < cov.clusterN; c++) {
    let x = sx(cov.clusterTopX[c]), y = sy(cov.clusterTopY[c]) - 5;
    if (y < 60 || x < 20 || x > W - 340 || y > H - 40) {
      if (!fallback || c !== nearCluster) continue;
      x = sx(_lab.x); y = sy(_lab.y) - 5;
      if (y < 60 || x < 20 || x > W - 340 || y > H - 40) continue;
    }
    label(textOf(c), x, y, rgb, alpha, 'center');
  }
}
function enemyClusterText(c) {
  let est = false, n = 0;
  for (let i = 0; i < covEnemy.n; i++) {
    if (covEnemy.cluster[i] !== c) continue;
    n++;
    if (enemyInfo[covEnemy.tag[i]]?.est) est = true;
  }
  return `${est ? '~' : ''}${n} ${plural(n, 'RADAR', 'RADARY', 'RADARÓW')} · ${formatRadarDistance(covEnemy.clusterMaxR[c])}`;
}

// ---------------------------------------------------------------- rysunek: byty i kontakty
const groupXs = new Float64Array(128), groupYs = new Float64Array(128);
const groupEnts = [];
const contactXs = new Float64Array(128), contactYs = new Float64Array(128);
const contactEnts = [];
const ghostXs = new Float64Array(128), ghostYs = new Float64Array(128), ghostAge = new Float64Array(128);
const groupsC = createPointGroups();

function symSize(e) {
  const c = e.H.cls;
  return c === 'SC' ? 6.5 : c === 'BB' ? 5.6 : c === 'DD' ? 4.6 : c === 'FF' ? 3.9 : c === 'ST' ? 6 : 3.2;
}

function drawFriendlies() {
  for (const e of friendlies) {
    const x = sx(e.x), y = sy(e.y);
    if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
    drawRadarSymbol(ctx, x, y, { kind: e.H.kind, aff: 'friendly', cls: e.H.cls, s: symSize(e) * (e === player ? 1.25 : 1), halo: e === player ? 1 : 0, rotation: e.heading });
    if (e === player) {
      const v = Math.hypot(e.vx, e.vy);
      if (v > 20) {
        const L = 16 + Math.min(40, v * 0.02);
        ctx.strokeStyle = radarColor(RADAR_RGB.heading, 0.85);
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(e.heading) * L, y + Math.sin(e.heading) * L); ctx.stroke();
      }
      label(e.H.name.toUpperCase(), x + 12, y - 8, RADAR_RGB.own, 0.85);
    } else if (e.role === 'station') {
      label(e.name, x + 10, y - 8, RADAR_RGB.friendly, 0.6);
    } else if (e.role === 'drone') {
      label('DRON', x + 8, y - 6, RADAR_RGB.friendly, 0.6);
    }
  }
}

function drawContacts() {
  // zidentyfikowani — symbole NTDS z kodem klasy; kontakty — miejsce przybliżone (koło niepewności); duchy — „?”.
  let gn = 0, cn = 0, hn = 0;
  groupEnts.length = 0; contactEnts.length = 0;
  for (const e of pirates) {
    const ks = knownState(e);
    if (!ks) continue;
    const k = e.k;
    if (ks === 'ghost') {
      if (hn < 128) { ghostXs[hn] = sx(k.x); ghostYs[hn] = sy(k.y); ghostAge[hn] = time - k.seenAt; hn++; }
      continue;
    }
    if (k.ident) { if (gn < 128) { groupXs[gn] = sx(k.x); groupYs[gn] = sy(k.y); groupEnts.push(e); gn++; } }
    else if (cn < 128) { contactXs[cn] = sx(k.x); contactYs[cn] = sy(k.y); contactEnts.push(e); cn++; }
  }
  // grupy: wiele znaczników blisko siebie na ekranie → jeden z liczbą
  groupPoints(groupsA, groupXs, groupYs, gn, 22);
  for (let g = 0; g < groupsA.n; g++) {
    let lead = null;
    for (let i = 0; i < gn; i++) if (groupsA.groupOf[i] === g && (!lead || symSize(groupEnts[i]) > symSize(lead))) lead = groupEnts[i];
    const x = groupsA.count[g] > 1 ? groupsA.cx[g] : sx(lead.k.x), y = groupsA.count[g] > 1 ? groupsA.cy[g] : sy(lead.k.y);
    if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
    drawRadarSymbol(ctx, x, y, { kind: lead.H.kind, aff: 'hostile', cls: lead.H.cls, s: symSize(lead), rotation: lead.heading });
    const tag = groupsA.count[g] > 1 ? `${lead.H.cls} ×${groupsA.count[g]}` : `${lead.H.cls}${lead.H.note ? ' ' + lead.H.note : ''}`;
    label(lead.role === 'station' ? lead.name : tag, x + 9, y - 6, RADAR_RGB.hostile, 0.85);
  }
  groupPoints(groupsB, contactXs, contactYs, cn, 26);
  for (let g = 0; g < groupsB.n; g++) {
    let big = 0, errPx = 0, lead = null;
    for (let i = 0; i < cn; i++) {
      if (groupsB.groupOf[i] !== g) continue;
      const e = contactEnts[i];
      const sc = contactSizeClass(e.k.sigSeen);
      if (sc >= big) { big = sc; lead = e; }
      errPx = Math.max(errPx, e.k.err * cam.zoom);
    }
    const n = groupsB.count[g];
    const x = n > 1 ? groupsB.cx[g] : sx(lead.k.x), y = n > 1 ? groupsB.cy[g] : sy(lead.k.y);
    if (x < -80 || y < -80 || x > W + 80 || y > H + 80) continue;
    const r = Math.max(7, errPx);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = radarColor(RADAR_RGB.unknown, 0.05); ctx.fill();
    ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.strokeStyle = radarColor(RADAR_RGB.unknown, 0.45); ctx.stroke(); ctx.setLineDash([]);
    drawRadarSymbol(ctx, x, y, { kind: 'ship', aff: 'unknown', shape: 'square', s: 2.6 + big * 0.7, fill: 0.15 });
    label(`?? ${SENSOR_SIZE_LABELS[big]}${n > 1 ? ` ×${n}` : ''}`, x + r * 0.72 + 4, y - r * 0.72, RADAR_RGB.unknown, 0.8);
  }
  // duchy (ostatnie znane miejsce zgubionego kontaktu) — też grupami, „? ×N”, gasną z wiekiem najświeższego
  groupPoints(groupsC, ghostXs, ghostYs, hn, 26);
  for (let g = 0; g < groupsC.n; g++) {
    let age = GHOST_SEC;
    for (let i = 0; i < hn; i++) if (groupsC.groupOf[i] === g && ghostAge[i] < age) age = ghostAge[i];
    const a = Math.max(0, 1 - age / GHOST_SEC);
    const x = groupsC.cx[g], y = groupsC.cy[g], n = groupsC.count[g];
    drawRadarSymbol(ctx, x, y, { shape: 'acq', rgb: RADAR_RGB.ghost, s: 4.5, alpha: 0.25 + 0.5 * a });
    label(n > 1 ? `? ×${n}` : '?', x + 8, y - 5, RADAR_RGB.ghost, 0.35 + 0.5 * a);
  }
  if (truth) {
    for (const e of pirates) {
      if (knownState(e) === 'live') continue;
      drawRadarSymbol(ctx, sx(e.x), sy(e.y), { kind: e.H.kind, aff: 'hostile', cls: e.H.cls, s: symSize(e) * 0.8, alpha: 0.3, rgb: RADAR_RGB.ghost, rotation: e.heading });
    }
  }
}

function drawEffects() {
  for (let i = pings.length - 1; i >= 0; i--) {
    const p = pings[i];
    const r = (time - p.t0) * p.v;
    if (r > p.r) { pings.splice(i, 1); continue; }
    const a = 1 - r / p.r;
    ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), r * cam.zoom, 0, TAU);
    ctx.lineWidth = 1.5; ctx.strokeStyle = radarColor(RADAR_RGB.ping, 0.5 * a); ctx.stroke();
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const t = time - f.t0;
    if (t > 0.6) { flashes.splice(i, 1); continue; }
    ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), 4 + t * 24, 0, TAU);
    ctx.lineWidth = 1.2; ctx.strokeStyle = radarColor(RADAR_RGB.weapon, 0.7 * (1 - t / 0.6)); ctx.stroke();
  }
}

function drawTruth() {
  if (!truth) return;
  ctx.setLineDash([2, 6]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = radarColor(RADAR_RGB.ghost, 0.45);
  pathArcs(covTruth);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPlayerStatus(compact = true) {
  const x = sx(player.x), y = sy(player.y);
  if (detectedKnown > 0) label(`W ZASIĘGU ×${detectedKnown}`, x, y + 22, RADAR_RGB.hostile, 0.9, 'center', '10px Consolas, monospace', 'top');
  else if (compact && edge.arc >= 0) label(`DO STREFY ${formatRadarDistance(edge.dist)}`, x, y + 22, RADAR_RGB.friendly, 0.75, 'center', '10px Consolas, monospace', 'top');
}

// ---------------------------------------------------------------- propozycje: warstwy zasięgu
function drawOwnContours(alpha = 1) {
  // własne czujniki (cel BB) — cienka cyjanowa kreska; wzrok (identyfikacja) — jaśniejszy obrys
  ctx.lineWidth = 1;
  ctx.setLineDash([10, 7]);
  ctx.strokeStyle = radarColor(RADAR_RGB.own, 0.32 * alpha);
  pathArcs(covOwn); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = radarColor(RADAR_RGB.own, 0.22 * alpha);
  pathArcs(covVision); ctx.stroke();
}

function drawKontur() {
  drawOwnContours();
  clusterLabels(covOwn, RADAR_RGB.own, 0.5, (c) => `CZUJNIKI · CEL BB ${formatRadarDistance(covOwn.clusterMaxR[c])}`, false);
  // strefy wroga: wypełnienie sumy + obrys (ciągły — zidentyfikowane, kreski — oszacowane)
  pathUnion(covEnemy);
  ctx.fillStyle = radarColor(RADAR_RGB.hostile, 0.07); ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.85);
  pathArcs(covEnemy, isSure); ctx.stroke();
  ctx.setLineDash([9, 6]);
  ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.7);
  pathArcs(covEnemy, isEst); ctx.stroke();
  ctx.setLineDash([]);
  clusterLabels(covEnemy, RADAR_RGB.hostile, 0.9, enemyClusterText);
  // pierścień wykrywalności: z jakiej odległości widzi cię pancernik (pasywnie)
  const rr = P.battleship_combat.passiveRange * playerSigEff * cam.zoom;
  const x = sx(player.x), y = sy(player.y);
  ctx.setLineDash([4, 5]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = radarColor(RADAR_RGB.unknown, 0.7);
  ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  label(`WYKRYWALNOŚĆ (BB) ${formatRadarDistance(rr / cam.zoom)}`, x + rr * 0.7071 + 4, y - rr * 0.7071, RADAR_RGB.unknown, 0.85);
  drawPlayerStatus();
}

let heatCanvas = null, heatCtx = null;
function drawStrefy() {
  // własne pokrycie — delikatny niebieski nalot
  pathUnion(covOwn);
  ctx.fillStyle = radarColor(RADAR_RGB.own, 0.018); ctx.fill();
  // nakładanie się radarów: każde koło dokłada czerwieni (raster 1/3, wygładzony)
  const sc = 1 / 3;
  const hw = Math.ceil(W * sc), hh = Math.ceil(H * sc);
  if (!heatCanvas || heatCanvas.width !== hw || heatCanvas.height !== hh) {
    heatCanvas = document.createElement('canvas');
    heatCanvas.width = hw; heatCanvas.height = hh;
    heatCtx = heatCanvas.getContext('2d');
  }
  heatCtx.clearRect(0, 0, hw, hh);
  heatCtx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < covEnemy.n; i++) {
    const x = sx(covEnemy.x[i]) * sc, y = sy(covEnemy.y[i]) * sc, r = covEnemy.r[i] * cam.zoom * sc;
    const g = heatCtx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255, 60, 50, 0.07)');
    g.addColorStop(0.85, 'rgba(255, 60, 50, 0.05)');
    g.addColorStop(1, 'rgba(255, 60, 50, 0.035)');
    heatCtx.fillStyle = g;
    heatCtx.beginPath(); heatCtx.arc(x, y, r, 0, TAU); heatCtx.fill();
  }
  heatCtx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.85;
  ctx.drawImage(heatCanvas, 0, 0, W, H);
  ctx.globalAlpha = 1;
  // brzeg świeci od środka strefy (przycięcie do sumy)
  ctx.save();
  pathUnion(covEnemy);
  ctx.clip();
  ctx.lineWidth = 22; ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.06); pathArcs(covEnemy); ctx.stroke();
  ctx.lineWidth = 8; ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.12); pathArcs(covEnemy); ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 1; ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.4); pathArcs(covEnemy); ctx.stroke();
  // w strefie: winieta i napis
  if (detectedKnown > 0) {
    const pulse = 0.75 + 0.25 * Math.sin(time * 4);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255, 40, 40, 0)');
    g.addColorStop(1, `rgba(255, 40, 40, ${(0.22 * pulse).toFixed(3)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    label(`WYKRYTY · ${detectedKnown} ${plural(detectedKnown, 'RADAR', 'RADARY', 'RADARÓW')}`, W / 2 - 150, 62, RADAR_RGB.hostile, 0.95, 'center', 'bold 15px Consolas, monospace', 'top');
    if (edge.arc >= 0) label(`WYJŚCIE ZE STREFY ${formatRadarDistance(edge.dist)}`, W / 2 - 150, 82, RADAR_RGB.hostile, 0.7, 'center', '11px Consolas, monospace', 'top');
  } else if (edge.arc >= 0) {
    label(`POZA ZASIĘGIEM · ${formatRadarDistance(edge.dist)} DO STREFY`, W / 2 - 150, 62, RADAR_RGB.friendly, 0.8, 'center', '13px Consolas, monospace', 'top');
  }
  clusterLabels(covEnemy, RADAR_RGB.hostile, 0.75, enemyClusterText);
}

function drawIzolinie() {
  // własne: FF / BB / SC — cienkie cyjanowe izolinie
  const ownCls = ['FF', 'BB', 'SC'];
  for (let v = 0; v < 3; v++) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = radarColor(RADAR_RGB.own, 0.14 + v * 0.06);
    pathArcs(covOwnIso[v]); ctx.stroke();
    clusterLabels(covOwnIso[v], RADAR_RGB.own, 0.45, (c) => `${ownCls[v]} ${formatRadarDistance(covOwnIso[v].clusterMaxR[c])}`, false);
  }
  // wroga: kropki — pełny ciąg, ciągła — teraz, kreski — cisza
  pathUnion(covIso[0]);
  ctx.fillStyle = radarColor(RADAR_RGB.hostile, 0.045); ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.setLineDash([1.5, 5]);
  ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.6);
  pathArcs(covIso[2]); ctx.stroke();
  ctx.setLineDash([10, 6]);
  ctx.strokeStyle = radarColor(RADAR_RGB.unknown, 0.75);
  pathArcs(covIso[1]); ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.9);
  pathArcs(covIso[0]); ctx.stroke();
  clusterLabels(covIso[2], RADAR_RGB.hostile, 0.55, () => 'CIĄG');
  clusterLabels(covIso[1], RADAR_RGB.unknown, 0.75, () => 'CISZA');
  clusterLabels(covIso[0], RADAR_RGB.hostile, 0.9, (c) => `TERAZ · ${enemyClusterTextIso(c)}`);
  // skala sygnatury przy okręcie
  const x = sx(player.x) + 16, y = sy(player.y) + 30;
  const s = covIso.sigs;
  const bar = (v, rgb, row, txt) => {
    const w = Math.min(120, v * 60);
    ctx.fillStyle = radarColor(rgb, 0.7);
    ctx.fillRect(x, y + row * 12, w, 3);
    label(`${txt} ${fmtMul(v)}`, x + w + 5, y + row * 12 + 6, rgb, 0.75);
  };
  bar(s[1], RADAR_RGB.unknown, 0, 'CISZA');
  bar(s[0], RADAR_RGB.hostile, 1, 'TERAZ');
  bar(s[2], RADAR_RGB.weapon, 2, 'CIĄG');
  if (detectedKnown > 0) label(`W ZASIĘGU ×${detectedKnown}`, sx(player.x), sy(player.y) + 22, RADAR_RGB.hostile, 0.9, 'center', '10px Consolas, monospace', 'top');
}
function enemyClusterTextIso(c) {
  let n = 0;
  for (let i = 0; i < covIso[0].n; i++) if (covIso[0].cluster[i] === c) n++;
  return `${n} ${plural(n, 'RADAR', 'RADARY', 'RADARÓW')}`;
}

function drawHud() {
  const px = sx(player.x), py = sy(player.y);
  // brzeg stref blisko okrętu: odcinki ~20 px, alfa maleje z odległością od okrętu, kreski do środka strefy
  const near = Math.min(W, H) * 0.35, far = Math.min(W, H) * 0.95;
  ctx.lineWidth = 2;
  for (let k = 0; k < covEnemy.arcN; k++) {
    const i = covEnemy.arcCircle[k];
    const cx = sx(covEnemy.x[i]), cy = sy(covEnemy.y[i]), r = covEnemy.r[i] * cam.zoom;
    const a0 = covEnemy.arcA0[k], a1 = covEnemy.arcA1[k];
    const segs = Math.max(1, Math.min(2000, Math.ceil((a1 - a0) * r / 20)));
    const da = (a1 - a0) / segs;
    const est = isEst(covEnemy.tag[i]);
    for (let s = 0; s < segs; s++) {
      const am = a0 + (s + 0.5) * da;
      const mx = cx + Math.cos(am) * r, my = cy + Math.sin(am) * r;
      if (mx < -30 || my < -30 || mx > W + 30 || my > H + 30) continue;
      const d = Math.hypot(mx - px, my - py);
      const a = d <= near ? 1 : Math.max(0, 1 - (d - near) / (far - near));
      if (a <= 0.02) continue;
      if (est && (s & 1)) continue; // oszacowane — co drugi odcinek
      ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.9 * a);
      ctx.beginPath(); ctx.arc(cx, cy, r, a0 + s * da, a0 + (s + 1) * da); ctx.stroke();
      if (s % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - Math.cos(am) * 7, my - Math.sin(am) * 7);
        ctx.lineWidth = 1.2; ctx.stroke(); ctx.lineWidth = 2;
      }
    }
  }
  // pierścień wokół okrętu: namiary radarów, które cię mają, i najbliższa krawędź
  const R = 44;
  ctx.lineWidth = 1;
  ctx.strokeStyle = radarColor(RADAR_RGB.own, 0.25);
  ctx.beginPath(); ctx.arc(px, py, R, 0, TAU); ctx.stroke();
  for (let i = 0; i < covEnemy.n; i++) {
    const dx = covEnemy.x[i] - player.x, dy = covEnemy.y[i] - player.y;
    if (dx * dx + dy * dy > covEnemy.r[i] * covEnemy.r[i]) continue;
    const b = Math.atan2(dy, dx);
    ctx.lineWidth = 5;
    ctx.strokeStyle = radarColor(RADAR_RGB.hostile, isEst(covEnemy.tag[i]) ? 0.55 : 0.9);
    ctx.beginPath(); ctx.arc(px, py, R, b - 0.12, b + 0.12); ctx.stroke();
  }
  if (truth) {
    for (const e of pirates) {
      const dx = e.x - player.x, dy = e.y - player.y, r = e.strength * playerSigEff;
      if (dx * dx + dy * dy > r * r) continue;
      const b = Math.atan2(dy, dx);
      ctx.lineWidth = 3; ctx.strokeStyle = radarColor(RADAR_RGB.ghost, 0.6);
      ctx.beginPath(); ctx.arc(px, py, R + 6, b - 0.08, b + 0.08); ctx.stroke();
    }
  }
  if (edge.arc >= 0) {
    const ex = sx(edge.x), ey = sy(edge.y);
    const b = Math.atan2(ey - py, ex - px);
    const rgb = edge.inside ? RADAR_RGB.friendly : RADAR_RGB.unknown;
    // grot na pierścieniu w stronę krawędzi (w strefie — w stronę wyjścia)
    const gx = px + Math.cos(b) * (R + 4), gy = py + Math.sin(b) * (R + 4);
    ctx.fillStyle = radarColor(rgb, 0.9);
    ctx.beginPath();
    ctx.moveTo(gx + Math.cos(b) * 9, gy + Math.sin(b) * 9);
    ctx.lineTo(gx + Math.cos(b + 2.4) * 5, gy + Math.sin(b + 2.4) * 5);
    ctx.lineTo(gx + Math.cos(b - 2.4) * 5, gy + Math.sin(b - 2.4) * 5);
    ctx.closePath(); ctx.fill();
    const txt = edge.inside ? `WYKRYTY ×${detectedKnown} · WYJŚCIE ${formatRadarDistance(edge.dist)}` : `STREFA ${formatRadarDistance(edge.dist)}`;
    label(txt, px + Math.cos(b) * (R + 18), py + Math.sin(b) * (R + 18) + 4, edge.inside ? RADAR_RGB.hostile : RADAR_RGB.unknown, 0.9, Math.cos(b) >= 0 ? 'left' : 'right');
    // krawędź poza kadrem — znacznik na brzegu ekranu
    const m = 30;
    if (ex < m || ey < 60 || ex > W - 330 || ey > H - 50) {
      const t = Math.min(
        Math.cos(b) > 0 ? (W - 330 - px) / Math.cos(b) : Math.cos(b) < 0 ? (m - px) / Math.cos(b) : Infinity,
        Math.sin(b) > 0 ? (H - 50 - py) / Math.sin(b) : Math.sin(b) < 0 ? (60 - py) / Math.sin(b) : Infinity
      );
      const bx = px + Math.cos(b) * t, by = py + Math.sin(b) * t;
      ctx.fillStyle = radarColor(rgb, 0.85);
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(b) * 10, by + Math.sin(b) * 10);
      ctx.lineTo(bx + Math.cos(b + 2.5) * 7, by + Math.sin(b + 2.5) * 7);
      ctx.lineTo(bx + Math.cos(b - 2.5) * 7, by + Math.sin(b - 2.5) * 7);
      ctx.closePath(); ctx.fill();
      label(edge.inside ? 'WYJŚCIE' : 'STREFA RADARÓW', bx - Math.cos(b) * 14, by - Math.sin(b) * 14, rgb, 0.85, 'center');
    }
  }
}

let fogCanvas = null, fogCtx = null;
function drawMgla() {
  const sc = 0.5;
  const fw = Math.ceil(W * sc), fh = Math.ceil(H * sc);
  if (!fogCanvas || fogCanvas.width !== fw || fogCanvas.height !== fh) {
    fogCanvas = document.createElement('canvas');
    fogCanvas.width = fw; fogCanvas.height = fh;
    fogCtx = fogCanvas.getContext('2d');
  }
  const f = fogCtx;
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, fw, fh);
  f.fillStyle = 'rgba(4, 8, 16, 0.82)';
  f.fillRect(0, 0, fw, fh);
  // chmury szumu zakotwiczone w świecie: dwie skale kafla (170 km i 37 km — powtórzenie kafla nie rzuca się w oczy)
  const layers = [[170000, 0.75, 220], [37000, 0.45, -480]];
  for (const [T, alpha, speed] of layers) {
    const tz = T * cam.zoom * sc;
    if (tz < 24) continue;
    const drift = (time * speed) % T;
    const tx0 = Math.floor((wx(0) - drift) / T) - 1, ty0 = Math.floor(wy(0) / T);
    f.globalAlpha = alpha;
    for (let ty = ty0; ty * T <= wy(H); ty++) {
      for (let tx = tx0; tx * T + drift <= wx(W); tx++) {
        f.drawImage(noiseTile, sx(tx * T + drift) * sc, sy(ty * T) * sc, tz + 1, tz + 1);
      }
    }
  }
  f.globalAlpha = 1;
  // wycięcia: zasięg kontaktu — półmrok, wzrok — jasno (miękki brzeg)
  f.globalCompositeOperation = 'destination-out';
  f.fillStyle = 'rgba(0, 0, 0, 0.42)';
  f.beginPath();
  for (let i = 0; i < covOwn.n; i++) {
    if (!covOwn.alive[i]) continue;
    const x = sx(covOwn.x[i]) * sc, y = sy(covOwn.y[i]) * sc, r = covOwn.r[i] * cam.zoom * sc;
    f.moveTo(x + r, y); f.arc(x, y, r, 0, TAU);
  }
  f.fill();
  for (let i = 0; i < covVision.n; i++) {
    const x = sx(covVision.x[i]) * sc, y = sy(covVision.y[i]) * sc, r = covVision.r[i] * cam.zoom * sc;
    const g = f.createRadialGradient(x, y, r * 0.7, x, y, r);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    f.fillStyle = g;
    f.beginPath(); f.arc(x, y, r, 0, TAU); f.fill();
  }
  // strefy wroga barwią mgłę mocniej (tam, gdzie mgła jest) i lekko całą swoją sumę (także w zasięgu wzroku)
  f.globalCompositeOperation = 'source-atop';
  f.beginPath();
  for (let i = 0; i < covEnemy.n; i++) {
    if (!covEnemy.alive[i]) continue;
    const x = sx(covEnemy.x[i]) * sc, y = sy(covEnemy.y[i]) * sc, r = covEnemy.r[i] * cam.zoom * sc;
    f.moveTo(x + r, y); f.arc(x, y, r, 0, TAU);
  }
  f.fillStyle = 'rgba(150, 24, 24, 0.45)';
  f.fill();
  f.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fogCanvas, 0, 0, W, H);
  pathUnion(covEnemy);
  ctx.fillStyle = radarColor(RADAR_RGB.hostile, 0.06); ctx.fill();
  // brzeg stref: poświata + linia z poszarpanym rytmem
  ctx.lineWidth = 9; ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.08); pathArcs(covEnemy); ctx.stroke();
  ctx.setLineDash([14, 3, 5, 3]);
  ctx.lineDashOffset = -time * 12;
  ctx.lineWidth = 1.3; ctx.strokeStyle = radarColor(RADAR_RGB.hostile, 0.6); pathArcs(covEnemy); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  clusterLabels(covEnemy, RADAR_RGB.hostile, 0.8, enemyClusterText);
  drawPlayerStatus();
}

const DRAW = { kontur: drawKontur, strefy: drawStrefy, izolinie: drawIzolinie, hud: drawHud, mgla: drawMgla };

// ---------------------------------------------------------------- panel
const panel = document.getElementById('panel');
let panelAt = 0;
function updatePanel() {
  const v = VARIANTS[variant];
  const s = player.st;
  const mods = [];
  if (s.thrust > 0.05) mods.push(`ciąg +${Math.round(DETECTION_TUNE.signature.thrustAdd * s.thrust * 100)}%`);
  if (s.drive === SENSOR_DRIVE.boost) mods.push('dopalacz ×1,25');
  if (s.drive === SENSOR_DRIVE.hyper) mods.push('hipercruise ×2,5');
  if (s.fireHeat > 0) mods.push(`ostrzał +${Math.round(DETECTION_TUNE.signature.fireAdd * s.fireHeat * 100)}%`);
  if (s.pingHeat > 0) mods.push(`impuls +${Math.round(DETECTION_TUNE.signature.pingAdd * s.pingHeat * 100)}%`);
  if (s.silent) mods.push('cisza ×0,5');
  if (player.cover < 1) mods.push(`osłona ×${fmtMul(player.cover)}`);
  let ident = 0, cont = 0, ghost = 0;
  for (const e of pirates) {
    const ks = knownState(e);
    if (ks === 'ghost') ghost++;
    else if (ks === 'live') { if (e.k.ident) ident++; else cont++; }
  }
  const det = detectedKnown > 0
    ? `<span class="hot">W ZASIĘGU ${detectedKnown} ${plural(detectedKnown, 'radaru', 'radarów', 'radarów')}</span>`
    : '<span class="ok">poza znanymi strefami</span>';
  const edgeTxt = edge.arc < 0 ? '—' : (edge.inside ? `wyjście ${formatRadarDistance(edge.dist)}` : `do strefy ${formatRadarDistance(edge.dist)}`);
  panel.innerHTML = `<h2>${variant + 1} · ${v.name}</h2><p class="opis">${v.desc}</p><table>
    <tr><td>kadłub</td><td>${player.H.name}</td></tr>
    <tr><td>sygnatura</td><td>${fmtMul(Math.round(playerSigEff * 100) / 100)} <span class="dim">(klasa ${fmtMul(player.H.base)}${mods.length ? ' · ' + mods.join(' · ') : ''})</span></td></tr>
    <tr><td>czujniki</td><td>${formatRadarDistance(player.strength)}${s.silent ? ' <span class="warn">(cisza)</span>' : ''}${s.pingHeat > 0 ? ' <span class="warn">(impuls)</span>' : ''} · wzrok ${formatRadarDistance(player.H.vision)}</td></tr>
    <tr><td>wykrycie</td><td>${det}</td></tr>
    <tr><td>krawędź</td><td>${edgeTxt}</td></tr>
    <tr><td>kontakty</td><td>${ident} zidentyf. · ${cont} niepewnych · ${ghost} duchów</td></tr>
    <tr><td>prawda <span class="dim">(T)</span></td><td>${truth ? `<span class="${detectedTrue ? 'hot' : 'ok'}">widzi cię ${detectedTrue}</span>` : '<span class="dim">ukryta</span>'}</td></tr>
    <tr><td>flota piratów</td><td>${time - alarmAt < 20 ? '<span class="hot">POŚCIG</span>' : '<span class="dim">patrol</span>'}</td></tr>
  </table>`;
}

// ---------------------------------------------------------------- pętla
let last = performance.now();
let simTime = Number(params.get('t')) || 0;
// ?t=… — przewiń symulację (zrzuty) krokami 1/30 s
for (let i = 0; i < simTime * 30; i++) step(1 / 30);
function step(dt) {
  time += dt;
  stepPlayer(dt);
  stepFriendlies(dt);
  stepAi(dt);
  updateSensors(dt);
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) step(dt);
  if (cam.follow) { cam.x += (player.x - cam.x) * Math.min(1, dt * 4); cam.y += (player.y - cam.y) * Math.min(1, dt * 4); }
  buildCoverages();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawBackground();
  drawTerrain();
  DRAW[VARIANTS[variant].key]();
  drawTruth();
  drawFriendlies();
  drawContacts();
  drawEffects();
  if (now - panelAt > 120) { panelAt = now; updatePanel(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Haki narzędzi (scripts/webgpu/radar-zasiegi-demo.mjs): ustawienie sceny i przewinięcie symulacji.
window.RadarZasiegi = {
  ents, player, cam, picture, covEnemy, setPreset,
  set(o = {}) {
    if (o.variant != null) { variant = o.variant; syncTabs(); }
    if (o.hull && o.hull !== player.hull) switchHull();
    if (o.x != null) {
      player.x = o.x; player.y = o.y; player.vx = 0; player.vy = 0;
      for (const e of escorts) { e.x = player.x + e.ox; e.y = player.y + e.oy; e.vx = 0; e.vy = 0; }
    }
    if (o.silent != null) player.st.silent = !!o.silent;
    if (o.truth != null) truth = !!o.truth;
    if (o.preset) setPreset(o.preset);
    if (o.follow != null) cam.follow = !!o.follow;
    if (o.cam) { cam.x = o.cam.x; cam.y = o.cam.y; }
    if (cam.follow) { cam.x = player.x; cam.y = player.y; }
    if (o.pause != null) paused = !!o.pause;
  },
  run(sec) { for (let i = 0; i < sec * 30; i++) step(1 / 30); },
  state: () => ({ variant: VARIANTS[variant].key, time, detectedKnown, detectedTrue, edge: { ...edge }, sig: playerSigEff, arcs: covEnemy.arcN, circles: covEnemy.n, clusters: covEnemy.clusterN })
};
