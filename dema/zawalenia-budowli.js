// Demo D20 „Zawalenia budowli na szarych blokach” (docs/PLAN-zawalenia-budowli-3d.md, synteza dema § 3–6). Serwowanie:
// `npm run dev` → /dema/zawalenia-budowli.html. Adres: ?scena=1…5, ?g (prawa wieża sceny 1 / jedyna w 2–3), ?strona=+x|-x|+y|-y,
// ?kappa, ?podpory=0.5|0.25|0 (scena 4), ?ht=klaster (sceny 4–5: H-T jako klaster zamiast bryły belek), ?t (start pokazu
// w sekundach), ?physHz=120, ?shot=1 (bez panelu i podpisu), ?test=1 (zegar ręczny — window.__zaw.runFrames, narzędzie
// scripts/webgpu/zawalenia-demo.mjs). Sceny 4–5 (habitat: dysk = graf + pole płyty, H-T z gry) — habitat.js.
//
// Cienka powłoka: fizyki dema nie ma. Scena to gospodarze zawalenia (src/game/structureCollapse.js) na prawdziwym
// HullBodies, sterowani tym samym kodem co narzędzie Node (dema/zawalenia-budowli/symulacja.js + scenariusze.js) — liczby
// z `node scripts/zawalenia-sym.mjs` = to, co widać. Pętla: stały krok fizyki 60 Hz (tick — licznik całkowity), obraz
// interpoluje pozy klastrów (dema/zawalenia-budowli/obraz.js), efekty (gruz obrazu, pył, smugi) z rekordów gospodarza.
// Każda scena startuje sama i jest przewinięta pod kurtyną (cfg.przewin) — smugi, odpryski i przechył widać od razu.
import * as THREE from 'three/webgpu';
import { HullBodies } from '../src/game/hullBodies.js';
import { STRUCT_TUNE } from '../src/game/structureGraph.js';
import {
  COLLAPSE_TUNE, COLLAPSE_WEAPONS, collapseGroundZ, collapseLocalToWorld, collapseStats, collapseTimeline, collapseWeaponHit
} from '../src/game/structureCollapse.js';
import { createScenaSym } from './zawalenia-budowli/symulacja.js';
import { createHabitatSym, HABITAT_Z } from './zawalenia-budowli/habitat.js';
import { SCENY, SCENA_DOMYSLNA, STRONY, scenaUstaw } from './zawalenia-budowli/scenariusze.js';
import { createObraz } from './zawalenia-budowli/obraz.js';
import { pirateBaseData } from '../src/game/story/pirateBaseWorld.js';
import { dryDockChunkSolids, dryDockSolidsToTriangles } from '../src/3d/portBuildings/pirateDryDockChunks.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const SHOT = params.get('shot') === '1';
if (SHOT) document.body.classList.add('shot');
const HZ = Number(params.get('physHz')) === 120 ? 120 : 60;
const DT = 1 / HZ;
const NAD_POMOST = 900;            // [j.] pomost nad pustką (scena 2, jak w misji — test structureCollapse: przegub pęka kątem)
const INSET = SHOT ? 0 : 320;      // [px] panel po prawej: środek kadru przesunięty w lewo o połowę (setViewOffset)
const $ = (id) => document.getElementById(id);
const canvas = $('view');

const errors = [];
function reportError(text) {
  errors.push(String(text));
  const el = $('errors');
  el.style.display = 'block';
  el.textContent = errors.slice(-8).join('\n\n');
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`JS (obietnica): ${e.reason?.stack || e.reason}`));

// ── stan dema ─────────────────────────────────────────────────────────────────────────────────────────────────
const pNum = (k) => (params.get(k) !== null && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : null);
const startNr = SCENY[pNum('scena')] ? pNum('scena') : SCENA_DOMYSLNA;
const S = {
  nr: startNr,
  g: { 1: SCENY[1].wieze[1].g, 2: SCENY[2].wieze[0].g, 3: SCENY[3].wieze[0].g },
  strona: { 1: SCENY[1].bateria.strona, 2: SCENY[2].bateria.strona },
  kappa: { 1: null, 2: null, 3: SCENY[3].kappa },
  auto: true,
  bron: 'dzialo',
  pomost: false,
  pomostZniszczony: false,
  speed: 1,
  paused: false,
  loop: true,
  cam: 'kino',
  // habitat (sceny 4–5): podpory dysku przy utrzymaniu 0 (D22), przechył szyi ×1 / ×3 (R3), H-T z belek albo klaster
  podpory: SCENY[4].podpory,
  mocniej: 1,
  ht: params.get('ht') === 'klaster' ? 'klaster' : 'belki'
};
if (pNum('podpory') !== null) S.podpory = pNum('podpory');
if (pNum('g') !== null) S.g[startNr] = pNum('g');
if (STRONY[params.get('strona')] && S.strona[startNr]) S.strona[startNr] = params.get('strona');
if (pNum('kappa') !== null) S.kappa[startNr] = pNum('kappa');
const startT = Math.max(0, pNum('t') ?? 0);

// Wygląd broni (indeks COLLAPSE_WEAPONS[…].i): barwa HDR smugi i błysku, szerokość, błysk [j.], fala (reaktor)
const WEAPON_FX = [
  { r: 8, g: 4.2, b: 1.5, width: 8, flash: 170 },          // bateria
  { r: 7, g: 5, b: 2.4, width: 6, flash: 130 },            // działo
  { r: 6, g: 3.6, b: 9, width: 13, flash: 320 },           // torpeda
  { r: 4.5, g: 6.5, b: 10, width: 18, flash: 900, ring: true } // fala reaktora
];

let O = null;            // obraz
let sym = null;          // symulacja sceny
let cfg = null;
let info = null;         // wieże, kierunek upadku, wysokość, kadr
let stepNo = 0, acc = 0, testTime = 0, testSteps = 0;
let ship = null;         // okręt-zastępstwo (scena 2)
let shipSlot = -1;
let sceneryCur = [];     // sceneria sceny (płyty, pomost, okręt) — indeksy = sloty setSceneryBox
const manual = [];       // ręczne trafienia czekające na krok (LPM, salwa F)
const stepMsRing = new Float64Array(4096);
let stepMsN = 0;
let flashMsg = '', flashUntil = 0;
const keys = new Set();
const P = { x: 0, y: 0, z: 0 };

// ── scena ─────────────────────────────────────────────────────────────────────────────────────────────────────
const isHab = () => !!SCENY[S.nr]?.habitat;
function buildCfg() {
  const nr = S.nr;
  if (SCENY[nr].habitat) return scenaUstaw(nr, { podpory: S.podpory, mocniej: S.mocniej, ht: S.ht });
  const c = scenaUstaw(nr, { g: S.g[nr], strona: S.strona[nr] || undefined, kappa: S.kappa[nr] ?? undefined });
  if (c.bateria && !S.auto) c.bateria = { ...c.bateria, auto: false };
  if (nr === 2 && S.pomost) c.wieze = c.wieze.map((w) => ({ ...w, nadPodlozem: NAD_POMOST }));
  return c;
}

function sceneInfo() {
  if (cfg.habitat) {
    // habitat: kolumna od masztu H-T do skały (scena 4) albo sam habitat z leżącą wieżą (scena 5, upadek ku +x)
    const Z = HABITAT_Z, rock = sym.ground.cz + sym.ground.R;
    const st = STRONY[cfg.strona || '+x'];
    const f = { x: st[0], y: st[1] };
    const up = cfg.habitat === 'upadek';
    const top = Z.mastTop + 80, bot = up ? rock : Z.discBot - 150;
    const e0 = up ? -2100 : -2100, e1 = up ? 2100 : 2600;
    return {
      habitat: true, towers: [], f, Ht: top - bot, e0, e1, cx: f.x * (e0 + e1) / 2, cy: f.y * (e0 + e1) / 2,
      deck: bot, ground: bot, top, halfW: (e1 - e0) / 2, rock, mid: (top + bot) / 2
    };
  }
  const towers = sym.hosts.map((H) => {
    const A = H.A;
    return {
      H, x: H.origin.x + A.centerX, y: H.origin.y + A.centerY, deck: H.origin.z + A.groundZ,
      top: H.origin.z + A.levelZ[A.nLevels - 1], plane: H.origin.z, ground: collapseGroundZ(cfg.podloze, H.origin.x, H.origin.y)
    };
  });
  const st = cfg.bateria ? STRONY[cfg.bateria.strona] : [1, 0];
  const f = { x: st[0], y: st[1] };
  const Ht = towers[0].top - towers[0].deck;
  const proj = towers.map((t) => t.x * f.x + t.y * f.y);
  // kadr wzdłuż upadku: wieża kładzie się ku strzałom (D11); bez baterii (front zgniotu) — siada pionowo, kadr na wieży
  const e0 = Math.min(...proj) - (cfg.bateria ? 450 : 0.75 * Ht), e1 = Math.max(...proj) + (cfg.bateria ? Ht + 300 : 0.75 * Ht);
  const pf = towers.map((t) => -t.x * f.y + t.y * f.x);
  const mid = (e0 + e1) / 2, perp = pf.reduce((a, b) => a + b, 0) / pf.length;
  const cx = f.x * mid - f.y * perp, cy = f.y * mid + f.x * perp;
  const deck = towers.reduce((a, t) => a + t.deck, 0) / towers.length;
  const gnd = towers.reduce((a, t) => a + t.ground, 0) / towers.length;
  return { towers, f, Ht, e0, e1, cx, cy, deck, ground: gnd, halfW: (e1 - e0) / 2 };
}

function sceneryFor() {
  const boxes = [];
  for (const t of info.towers) {
    // płyta pod wieżą (wierzch 0,4 j. nad pokładem — spód wieży stoi 1 j. nad nim)
    boxes.push({ x: t.x, y: t.y, z: t.deck - 20, hx: 310, hy: 330, hz: 20.4, r: 0.25, g: 0.245, b: 0.235, support: true, tag: 'plyta' });
    if (t.deck - t.ground > 50) {
      // pomost nad pustką: kładki ±y i filary
      const h = t.deck - 40 - t.ground;
      boxes.push({ x: t.x, y: t.y - 1475, z: t.deck - 16, hx: 95, hy: 1135, hz: 16, r: 0.21, g: 0.215, b: 0.22, support: true, tag: 'pomost-y' });
      boxes.push({ x: t.x, y: t.y + 1475, z: t.deck - 16, hx: 95, hy: 1135, hz: 16, r: 0.21, g: 0.215, b: 0.22, support: true, tag: 'pomost+y' });
      boxes.push({ x: t.x, y: t.y, z: t.ground + h / 2 - 20, hx: 70, hy: 70, hz: h / 2, r: 0.2, g: 0.2, b: 0.205, tag: 'filar' });
      for (const sy of [-1, 1]) boxes.push({ x: t.x, y: t.y + sy * 2450, z: t.ground + h / 2 - 20, hx: 60, hy: 60, hz: h / 2, r: 0.2, g: 0.2, b: 0.205, tag: 'filar' });
    }
  }
  shipSlot = -1;
  if (ship) {
    shipSlot = boxes.length;
    for (const p of SHIP_PARTS) boxes.push({ x: 0, y: 0, z: 0, hx: p.hx, hy: p.hy, hz: p.hz, r: p.c[0], g: p.c[1], b: p.c[2], tag: 'okret' });
  }
  return boxes;
}

// okręt-zastępstwo: prostopadłościany w układzie okrętu (dziób wzdłuż +x)
const SHIP_PARTS = [
  { lx: 0, ly: 0, lz: 0, hx: 300, hy: 68, hz: 42, c: [0.2, 0.22, 0.25] },
  { lx: 345, ly: 0, lz: -4, hx: 55, hy: 44, hz: 30, c: [0.24, 0.26, 0.29] },
  { lx: -110, ly: 0, lz: 66, hx: 72, hy: 30, hz: 26, c: [0.26, 0.28, 0.31] },
  { lx: -335, ly: 38, lz: 0, hx: 40, hy: 26, hz: 30, c: [0.14, 0.15, 0.17] },
  { lx: -335, ly: -38, lz: 0, hx: 40, hy: 26, hz: 30, c: [0.14, 0.15, 0.17] }
];

function placeShip(side) {
  const t = info.towers[0], st = STRONY[side];
  const d = cfg.okret?.odleglosc || 1500;
  // 450 j. w bok od linii strzału (po stronie z dala od kamery „Kino”) — leżąca wieża nie przechodzi przez okręt
  // (okręt dema nie ma fizyki; w grze klastry ranią okręty jak taran — D5)
  ship = { x: t.x + st[0] * d - st[1] * 450, y: t.y + st[1] * d + st[0] * 450, z: t.plane, hd: Math.atan2(-st[1], -st[0]), vx: 0, vy: 0, w: false, s: false };
}

function syncShip() {
  if (!ship || shipSlot < 0) return;
  const c = Math.cos(ship.hd), s = Math.sin(ship.hd);
  SHIP_PARTS.forEach((p, i) => O.setSceneryBox(shipSlot + i, { x: ship.x + c * p.lx - s * p.ly, y: ship.y + s * p.lx + c * p.ly, z: ship.z + p.lz, yaw: ship.hd }));
}

function startScene() {
  try {
    if (sym) sym.dispose();
    cfg = buildCfg();
    sym = cfg.habitat ? createHabitatSym(HullBodies, cfg, { hz: HZ }) : createScenaSym(HullBodies, cfg, { hz: HZ });
    info = sceneInfo();
    ship = null;
    if (S.nr === 2) placeShip(cfg.bateria.strona);
    S.pomostZniszczony = false;
    stepNo = 0; acc = 0; testTime = 0; testSteps = 0; stepMsN = 0; manual.length = 0;
    const r = Math.max(2600, info.halfW + 900);
    sceneryCur = cfg.habitat ? [] : sceneryFor();
    if (cfg.habitat) {
      // pole płyty dysku (i korony) rysuje stojącą część — kikut gospodarza bez obrazu; lina windy z bloku-kotwicy do skały
      const hb = sym.windaBlok, A = sym.A;
      const rx = hb >= 0 ? A.x[hb] : 0, ry = hb >= 0 ? A.y[hb] : 0;
      O.setScene({
        hosts: sym.hosts, ground: sym.ground, sceneryBoxes: [], seed: 7000 + S.nr,
        shadow: { x: 0, y: 0, z: cfg.habitat === 'upadek' ? info.mid : (HABITAT_Z.discBot + HABITAT_Z.mastTop) / 2, r: cfg.habitat === 'upadek' ? 3400 : 2900 },
        plateFields: [{ F: sym.plate.F, Pb: sym.plate.Pb }, sym.plate.crown ? { F: sym.plate.crown } : null],
        hideStump: [sym.host], ht: { pose: sym.towerPose },
        ropeAnchor: hb >= 0 ? { H: sym.host, block: hb, bottom: { x: rx, y: ry, z: info.rock - 2 } } : null
      });
    } else {
      O.setScene({
        hosts: sym.hosts, ground: cfg.podloze, sceneryBoxes: sceneryCur, seed: 7000 + S.nr,
        shadow: { x: info.cx, y: info.cy, z: (info.deck + info.ground) / 2, r }
      });
    }
    syncShip();
    applyPreset(S.cam);
    // przewinięcie pod kurtyną (deterministycznie: kroki fizyki + efekty krokiem fizyki)
    const pre = Math.round(((cfg.przewin || 0) + startT) * HZ);
    for (let i = 0; i < pre; i++) { simStep(); O.updateFx(DT); }
    stepMsN = 0;
    refreshPanel();
  } catch (e) {
    reportError(`scena ${S.nr}: ${e.stack || e}`);
  }
}

const showTime = () => (sym ? sym.t - (cfg.przewin || 0) : 0);

// trafienie w układzie archetypu we wszystkie wieże sceny (jak sterownik sceny — A/B: ten sam strzał w obie)
function hitLocal(lx, ly, lz, dx, dy, dz, bron) {
  for (const H of sym.hosts) {
    collapseLocalToWorld(H, lx, ly, lz, P);
    const c = H.pose[3], s = H.pose[4];
    collapseWeaponHit(H, P.x, P.y, P.z, c * dx - s * dy, s * dx + c * dy, dz, bron);
  }
}

function simStep() {
  O.savePoses(stepNo);
  for (let i = 0; i < manual.length;) {
    const m = manual[i];
    if (m.at > sym.t + 1e-9) { i++; continue; }
    if (m.world) collapseWeaponHit(m.H, m.x, m.y, m.z, m.dx, m.dy, m.dz, m.bron);
    else hitLocal(m.lx, m.ly, m.lz, m.dx, m.dy, 0, m.bron);
    manual.splice(i, 1);
  }
  const t0 = performance.now();
  sym.step();
  stepMsRing[stepMsN++ % stepMsRing.length] = performance.now() - t0;
  stepNo++;
  O.consumeRecords(fxCtx);
}

const fxCtx = {
  weaponFx: WEAPON_FX,
  muzzle(x, y, z, dx, dy, dz, out) {
    if (ship) {
      const c = Math.cos(ship.hd), s = Math.sin(ship.hd);
      out.x = ship.x + c * 400; out.y = ship.y + s * 400; out.z = ship.z + 10;
    } else {
      // bateria poza kadrem: smuga pocisku (1100 j. przed trafieniem) — pełny tor z +x przechodziłby przez drugą wieżę A/B
      out.x = x - dx * 1100; out.y = y - dy * 1100; out.z = z - dz * 1100;
    }
    return out;
  }
};

// salwa F: 6 strzałów co 0,15 s w pas ±70 ściany od strony ostrzału (PRNG sceny obrazu nie rusza fizyki)
let salvoSeed = 1;
function salvo() {
  if (!cfg.bateria && S.nr !== 2) return;
  const side = cfg.bateria ? cfg.bateria.strona : '+x', st = STRONY[side];
  const bron = S.nr === 2 ? S.bron : 'bateria';
  for (let k = 0; k < 6; k++) {
    salvoSeed = (salvoSeed * 1103515245 + 12345) >>> 0;
    const u = (salvoSeed / 4294967296) * 2 - 1;
    salvoSeed = (salvoSeed * 1103515245 + 12345) >>> 0;
    const z = ((salvoSeed / 4294967296) * 2 - 1) * 70;
    const lx = st[0] ? st[0] * 190 : u * 180, ly = st[1] ? st[1] * 210 : u * 200;
    manual.push({ at: sym.t + k * 0.15, lx, ly, lz: z, dx: -st[0], dy: -st[1], bron });
  }
  flash(`salwa: 6 × ${bron}`);
}

// LPM (scena 2): strzał z dziobu okrętu w punkt kursora na płaszczyźnie gry (pas broni ±70 — płaszczyzna)
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function fireAtCursor(ev) {
  if (!ship || !sym) return;
  const rect = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  const camObj = S.cam === 'gora' ? O.ortho : O.persp;
  raycaster.setFromCamera(ndc, camObj);
  const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
  const pz = ship.z;
  if (Math.abs(rd.z) < 1e-6) return;
  const t = (pz - ro.z) / rd.z;
  if (!(t > 0)) return;
  fireAt(ro.x + rd.x * t, ro.y + rd.y * t);
}

// strzał z dziobu okrętu w punkt (tx, ty) płaszczyzny gry: trafiony kikut → krater + fala (collapseWeaponHit w kroku)
function fireAt(tx, ty) {
  if (!ship || !sym) return;
  const pz = ship.z;
  const c = Math.cos(ship.hd), s = Math.sin(ship.hd);
  const mx = ship.x + c * 400, my = ship.y + s * 400, mz = ship.z + 10;
  let dx = tx - mx, dy = ty - my;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  dx /= len; dy /= len;
  const hit = O.raycastBoxes(mx, my, pz, dx, dy, 0, 12000);
  const fx = WEAPON_FX[COLLAPSE_WEAPONS[S.bron].i];
  if (hit && hit.stump) {
    manual.push({ at: sym.t, world: true, H: hit.H, x: mx + dx * hit.t, y: my + dy * hit.t, z: pz, dx, dy, dz: 0, bron: S.bron });
  } else {
    // pudło albo trafienie w oderwany klaster (zapytania broni klastry mijają — E5): sam obraz
    const d = hit ? hit.t : Math.min(len, 6000);
    O.spawnBeam(mx, my, mz, mx + dx * d, my + dy * d, pz, fx.width, 0.16, fx.r, fx.g, fx.b);
    if (hit) O.spawnGlow(mx + dx * d, my + dy * d, pz, 0.25, fx.flash * 0.4, fx.flash * 0.8, fx.r, fx.g, fx.b);
  }
}

function setSide(side) {
  if (!cfg.bateria) return;
  if (S.nr === 1) { S.strona[1] = side; startScene(); return; }
  if (S.nr === 2) {
    S.strona[2] = side;
    sym.bateria({ strona: side, auto: S.auto });
    cfg = sym.cfg;
    info = sceneInfo();
    placeShip(side);
    syncShip();
    if (S.cam === 'kino' || S.cam === 'profil') applyPreset(S.cam);
    flash(`strzały z ${side}`);
    refreshPanel();
  }
}

function destroyBridge() {
  if (S.nr !== 2 || !sym || S.pomostZniszczony) return;
  const n = sym.pomost(SCENY[2].pomost.strona);
  S.pomostZniszczony = true;
  // obraz: kładka −y znika w gruzie (pomost nad pustką)
  const i = sceneryCur.findIndex((b) => b.tag === 'pomost-y');
  if (i >= 0) {
    const b = sceneryCur[i];
    O.setSceneryBox(i, { hidden: true });
    for (let k = 0; k < 90; k++) {
      const y = b.y - b.hy + (k / 90) * 2 * b.hy;
      O.spawnStone(b.x + (k % 3 - 1) * 50, y, b.z, ((k * 37) % 11 - 5) * 6, ((k * 53) % 7 - 3) * 6, -10, 14 + (k % 5) * 6, 0.8, 400);
      if (k % 6 === 0) O.spawnDust(b.x, y, b.z, 0, 0, -6, 6, 120, 420, 0.35);
    }
  }
  flash(`pomost −y zniszczony: puściło ${n} kotwic`);
  refreshPanel();
}

function flash(msg) { flashMsg = msg; flashUntil = performance.now() + 2500; }

// ── okręt (scena 2): W/S ciąg wzdłuż dzioba, A/D obrót, W+S stoi ─────────────────────────────────────────────
function updateShip(dt) {
  if (!ship || dt <= 0) return;
  const w = keys.has('KeyW'), s = keys.has('KeyS');
  if (keys.has('KeyA')) ship.hd += 0.8 * dt;
  if (keys.has('KeyD')) ship.hd -= 0.8 * dt;
  const c = Math.cos(ship.hd), sn = Math.sin(ship.hd);
  if (w && s) { const k = Math.exp(-3 * dt); ship.vx *= k; ship.vy *= k; }
  else if (w) { ship.vx += c * 260 * dt; ship.vy += sn * 260 * dt; }
  else if (s) { ship.vx -= c * 200 * dt; ship.vy -= sn * 200 * dt; }
  const drag = Math.exp(-0.35 * dt);
  ship.vx *= drag; ship.vy *= drag;
  ship.x += ship.vx * dt; ship.y += ship.vy * dt;
  // płomienie: MAIN za rufą (W), wsteczne przed dziobem (S)
  if (w) for (const sy of [-38, 38]) O.spawnGlow(ship.x - c * 395 - sn * sy, ship.y - sn * 395 + c * sy, ship.z, 0.07, 70, 120, 2.2, 3.8, 9);
  if (s) for (const sy of [-30, 30]) O.spawnGlow(ship.x + c * 420 - sn * sy, ship.y + sn * 420 + c * sy, ship.z, 0.07, 45, 85, 2.2, 3.8, 9);
  syncShip();
}

// ── kamera ────────────────────────────────────────────────────────────────────────────────────────────────────
const cam = { mode: 'kino', tx: 0, ty: 0, tz: 0, dist: 5000, az: 0.38, el: 0.16, orthoH: 5000, follow: null, snap: false };
const CAM_ORDER = ['kino', 'profil', 'gora', 'sledz'];

function towerPointWorld(H, b, out) {
  const o = H.own[b];
  if (o < 0 || H.S.dead[b] || !H.cls[o].alive) return null;
  const r = H.cls[o], bd = r.body, q = bd.quat, f = r.f, A = H.A;
  const dx = A.x[b] - f[0], dy = A.y[b] - f[1], dz = A.z[b] - f[2];
  const x = q.x, y = q.y, z = q.z, w = q.w;
  out.x = bd.pos.x + (1 - 2 * (y * y + z * z)) * dx + 2 * (x * y - w * z) * dy + 2 * (x * z + w * y) * dz;
  out.y = bd.pos.y + 2 * (x * y + w * z) * dx + (1 - 2 * (x * x + z * z)) * dy + 2 * (y * z - w * x) * dz;
  out.z = bd.pos.z + 2 * (x * z - w * y) * dx + 2 * (y * z + w * x) * dy + (1 - 2 * (x * x + y * y)) * dz;
  return out;
}

function applyPreset(mode) {
  S.cam = mode;
  cam.mode = mode;
  cam.follow = null;
  const I = info, t0 = I.towers[0], f = I.f;
  const aspect = visibleAspect();
  const vt = O.persp.fov * Math.PI / 360, ht = Math.atan(Math.tan(vt) * aspect);
  // kadr od gruntu do dachu (pomost nad pustką: wieża spada z pokładu na grunt)
  const span = I.Ht + Math.max(0, I.deck - I.ground);
  const fitDist = Math.max(I.halfW / Math.tan(ht), (span * 0.58) / Math.tan(vt)) * 1.08;
  cam.snap = true;
  if (I.habitat) {
    // habitat: kolumna wieża → dysk → skała (scena 4) albo habitat z leżącą wieżą (scena 5)
    const Z = HABITAT_Z;
    if (mode === 'kino' || mode === 'profil' || mode === 'gora') {
      const up = cfg.habitat === 'upadek';
      cam.tx = I.cx; cam.ty = I.cy;
      // scena 4: kolumna wieża → skała (środek nieco niżej — po 7 s wszystko dzieje się na skale); scena 5: dysk z koroną
      // i leżąca wieża (kamera wyżej — dysk z góry pod kątem)
      cam.tz = up ? I.mid - 0.06 * I.Ht : I.mid - 350;
      cam.dist = Math.max(I.halfW / Math.tan(ht), (I.Ht * 0.56) / Math.tan(vt)) * (up ? 1.06 : 1.3);
      cam.az = mode === 'kino' ? 0.42 : 0;
      cam.el = mode === 'kino' ? (up ? 0.1 : 0.32) : 0.03;
      cam.orthoH = Math.max(((I.e1 - I.e0) * 1.15) / aspect, 4600);
      if (mode === 'gora') cam.tz = Z.discTop;
    } else if (mode === 'sledz' || mode === 'dach') {
      cam.dist = mode === 'sledz' ? 4200 : 2200; cam.az = 0.55; cam.el = mode === 'sledz' ? 0.18 : 0.3; cam.follow = mode;
      cam.tx = 0; cam.ty = 0; cam.tz = mode === 'sledz' ? (Z.neckBase + Z.mastTop) / 2 : Z.headTop;
    } else if (mode === 'podstawa') {
      // brzeg otworu (scena 4) / rów pod talerzem leżącej wieży (scena 5) w dysku
      const rr = cfg.habitat === 'upadek' ? 900 : 1350;
      cam.tx = f.x * rr; cam.ty = f.y * rr; cam.tz = Z.discTop;
      cam.dist = 2600; cam.az = 0.6; cam.el = 0.32;
    } else if (mode === 'gruz') {
      const c = O.debrisCenter(0, 0, 4000, _tp);
      cam.tx = c ? c.x : 0; cam.ty = c ? c.y : 0; cam.tz = (c ? c.z : I.ground) + 80;
      cam.dist = 3000; cam.az = 0.5; cam.el = 0.4;
    }
    refreshPanel();
    return;
  }
  if (mode === 'kino' || mode === 'profil' || mode === 'gora') {
    cam.tx = I.cx; cam.ty = I.cy; cam.tz = I.ground + span * 0.42;
    cam.dist = fitDist;
    cam.az = mode === 'kino' ? 0.38 : 0;
    cam.el = mode === 'kino' ? 0.16 : 0.035;
    cam.orthoH = Math.max(((I.e1 - I.e0) * 1.12) / aspect, I.Ht * 1.35);
  } else if (mode === 'sledz') {
    cam.dist = 2600; cam.az = 0.55; cam.el = 0.22; cam.follow = 'sledz';
    cam.tx = t0.x; cam.ty = t0.y; cam.tz = t0.deck + I.Ht * 0.5;
  } else if (mode === 'podstawa') {
    cam.tx = t0.x + f.x * 140; cam.ty = t0.y + f.y * 140; cam.tz = t0.deck + 230;
    cam.dist = 1500; cam.az = 0.6; cam.el = 0.07;
  } else if (mode === 'dach') {
    cam.dist = 1300; cam.az = 0.45; cam.el = 0.2; cam.follow = 'dach';
    cam.tx = t0.x; cam.ty = t0.y; cam.tz = t0.top - 120;
  } else if (mode === 'gruz') {
    // środek gruzu obrazu przy pierwszej wieży (kamienie w promieniu wysokości wieży), inaczej miejsce upadku
    const c = O.debrisCenter(t0.x, t0.y, I.Ht * 1.3, _tp);
    cam.tx = c ? c.x : t0.x + f.x * I.Ht * 0.55; cam.ty = c ? c.y : t0.y + f.y * I.Ht * 0.55;
    cam.tz = (c ? c.z : I.ground) + 60;
    cam.dist = 1900; cam.az = 0.5; cam.el = 0.42;
  }
  refreshPanel();
}

const _tp = { x: 0, y: 0, z: 0 };
const _hp = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
function updateCamera(dt) {
  if (info.habitat && (cam.follow === 'sledz' || cam.follow === 'dach')) {
    // wieża H-T: środek masy (Śledź) albo głowa (Zbliż: dach) — poza układu F
    const b = sym.towerBody();
    if (b && !b.dead && sym.towerPose(_hp)) {
      let x = b.pos.x, y = b.pos.y, z = b.pos.z;
      if (cam.follow === 'dach') {
        const q = { x: _hp.qx, y: _hp.qy, z: _hp.qz, w: _hp.qw }, h = HABITAT_Z.headTop;
        x = _hp.x + 2 * (q.x * q.z + q.w * q.y) * h; y = _hp.y + 2 * (q.y * q.z - q.w * q.x) * h; z = _hp.z + (1 - 2 * (q.x * q.x + q.y * q.y)) * h;
      }
      const k = cam.snap ? 1 : 1 - Math.exp(-4 * dt);
      cam.tx += (x - cam.tx) * k; cam.ty += (y - cam.ty) * k; cam.tz += (z - cam.tz) * k;
    }
  } else if (cam.follow === 'sledz') {
    // środek masy największego ruchomego klastra (bez kikuta i ruin)
    let best = null, bm = 0;
    for (const H of sym.hosts) for (const r of H.cls) {
      if (!r.alive || r.kind !== 0 || r.body.anchored) continue;
      if (r.f[3] > bm) { bm = r.f[3]; best = r.body.pos; }
    }
    if (best) { const k = cam.snap ? 1 : 1 - Math.exp(-4 * dt); cam.tx += (best.x - cam.tx) * k; cam.ty += (best.y - cam.ty) * k; cam.tz += (best.z - cam.tz) * k; }
  } else if (cam.follow === 'dach') {
    const H = info.towers[0].H;
    if (H.roofBlocks.length && towerPointWorld(H, H.roofBlocks[0], _tp)) {
      const k = cam.snap ? 1 : 1 - Math.exp(-5 * dt);
      cam.tx += (_tp.x - cam.tx) * k; cam.ty += (_tp.y - cam.ty) * k; cam.tz += (_tp.z - cam.tz) * k;
    }
  }
  cam.snap = false;
  const f = info.f;
  const bx = f.y, by = -f.x;                          // podstawa: prostopadle do upadku (kamera po stronie −y przy +x)
  const ca = Math.cos(cam.az), sa = Math.sin(cam.az);
  const dx = bx * ca - by * sa, dy = bx * sa + by * ca;
  if (cam.mode === 'gora') {
    const o = O.ortho, a = O.persp.aspect, h = cam.orthoH / 2, sh = (INSET / 2) * (cam.orthoH / Math.max(1, O.view.h));
    o.left = -h * a + sh; o.right = h * a + sh; o.top = h; o.bottom = -h;
    o.position.set(cam.tx, cam.ty, cam.tz + 30000);
    o.up.set(0, 1, 0);
    o.lookAt(cam.tx, cam.ty, cam.tz);
    o.updateProjectionMatrix();
    o.updateMatrixWorld();
  } else {
    const p = O.persp, ce = Math.cos(cam.el);
    p.position.set(cam.tx + dx * ce * cam.dist, cam.ty + dy * ce * cam.dist, cam.tz + Math.sin(cam.el) * cam.dist);
    p.up.set(0, 0, 1);
    p.lookAt(cam.tx, cam.ty, cam.tz);
    p.updateMatrixWorld();
  }
}
const camObject = () => (cam.mode === 'gora' ? O.ortho : O.persp);
// kadr widoczny obok panelu: proporcje i przesunięcie środka
const visibleAspect = () => Math.max(0.3, (O.view.w - INSET) / Math.max(1, O.view.h));
function resizeView() {
  O.resize(window.innerWidth, window.innerHeight);
  if (INSET > 0) { const v = O.view; O.persp.setViewOffset(v.w, v.h, INSET / 2, 0, v.w, v.h); }
}

// ── podpis i panel ────────────────────────────────────────────────────────────────────────────────────────────
const fmt = (v) => (v === null || v === undefined || v < 0 || !Number.isFinite(v) ? '—' : `${v.toFixed(1).replace('.', ',')} s`);
function tiltOf(H) {
  const k = H.iv[7];
  const r = k >= 0 ? H.cls[k] : null;
  if (!r || !r.alive) return null;
  const q = r.body.quat, c = 1 - 2 * (q.x * q.x + q.y * q.y);
  return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
}
function captionHabitat() {
  const sc = SCENY[S.nr], t = showTime(), tl = sym.timeline();
  const tm = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1).replace('.', ',')} s`);
  const run = S.paused ? ' · PAUZA' : S.speed !== 1 ? ` · ×${String(S.speed).replace('.', ',')}` : '';
  const ht = tl.ht === 'klaster' ? 'H-T: klaster' : 'H-T: bryła belek z gry';
  const msg = performance.now() < flashUntil ? `\n${flashMsg}` : '';
  if (cfg.habitat === 'upadek') {
    const st = sym.plate.Pb.fv[2];
    $('caption').innerHTML = `<b>Scena 4 · ${sc.nazwa}</b> · ${ht} · podpory dysku przy utrzymaniu 0: ${String(cfg.podpory).replace('.', ',')} · utrzymanie ${st.toFixed(2).replace('.', ',')} · t ${t.toFixed(1).replace('.', ',')} s${run}\n`
      + `HP 0 ${tm(tl.hp0)} · styk z dyskiem ${tm(tl.dotyk)} · przebicie ${tm(tl.przebicie)} · wieża za dyskiem ${tm(tl.przejscie)} · wieża na skale ${tm(tl.wiezaNaSkale)} · pierwszy wycinek dysku na skale ${tm(tl.wycinekNaSkale)}`
      + `${tl.opoznienieWycinka !== null ? ` (+${tl.opoznienieWycinka.toFixed(1).replace('.', ',')} s)` : ''}\n`
      + `otwór: ${tl.otwory} komórek, IoU z talerzem ${tl.iouPrzejscie === null ? '—' : tl.iouPrzejscie.toFixed(2).replace('.', ',')} · H-T za dyskiem = jeden klaster (D6 zastępczo) · bez bębna i szybu H-C (D14)${msg}`;
  } else {
    $('caption').innerHTML = `<b>Scena 5 · ${sc.nazwa}</b> · ${ht} · utrzymanie 1 · przechył startowy ×${cfg.mocniej} · t ${t.toFixed(1).replace('.', ',')} s${run}\n`
      + `korona bębna ${tm(tl.korona)} · dysk ${tm(tl.dotyk)} · spoczynek ${tm(tl.spoczynek)} · rów ${tl.row} komórek · otwory ${tl.otwory} · graf traci ${tl.blokiUtracone} z ${tl.blokow} bloków\n`
      + `korona bębna — pole płyty bez grafu · bez bębna i szybu H-C (D14)${msg}`;
  }
}

function caption() {
  if (cfg.habitat) { captionHabitat(); return; }
  const sc = SCENY[S.nr], pre = cfg.przewin || 0, t = showTime();
  const names = sym.hosts.length > 1 ? ['lewa', 'prawa'] : ['wieża'];
  const head = `<b>Scena ${S.nr} · ${sc.nazwa}</b> · ${sym.hosts.map((H, i) => `${names[i]} g ${Math.round(H.A.g)}`).join(' · ')}`
    + (cfg.bateria ? ` · strzały z ${cfg.bateria.strona}${cfg.bateria.auto === false ? ' (auto wył.)' : ''}` : '')
    + (S.nr === 3 || cfg.kappa !== null ? ` · κ ${(cfg.kappa ?? sym.hosts[0].A.tune.kappa)}` : '')
    + (S.nr === 2 ? ` · broń ${S.bron}${S.pomost ? ' · pomost nad pustką' : ''}` : '')
    + ` · t ${t.toFixed(1).replace('.', ',')} s${S.paused ? ' · PAUZA' : S.speed !== 1 ? ` · ×${String(S.speed).replace('.', ',')}` : ''}`;
  const rows = sym.hosts.map((H, i) => {
    const tl = collapseTimeline(H), tilt = tiltOf(H);
    const sh = (v) => (v >= 0 ? v - pre : -1);
    const front = tl.frontLevels.length ? ` · front ${tl.frontLevels.length} kond.` : '';
    return `${names[i]}: przechył ${tilt === null ? '—' : `${Math.round(tilt)}°`} · oderwanie ${fmt(sh(tl.detach))} · 40° ${fmt(sh(tl.tilt40))}${front} · dach na ziemi ${fmt(sh(tl.roofGround))}`;
  });
  const msg = performance.now() < flashUntil ? `\n${flashMsg}` : '';
  $('caption').innerHTML = `${head}\n${rows.join('\n')}${msg}`;
}

const on = (id, v) => { const el = $(id); if (el) el.classList.toggle('on', !!v); };
function refreshPanel() {
  if (!cfg) return;
  for (const n of [1, 2, 3, 4, 5]) on(`sc-${n}`, S.nr === n);
  // habitat: podpory dysku (scena 4), przechył szyi (scena 5), H-T z belek / klaster
  for (const p of SCENY[4].podporyPanel) { const el = $(`pod-${String(p).replace('.', '')}`); el.disabled = S.nr !== 4; el.classList.toggle('on', S.nr === 4 && cfg.podpory === p); }
  $('btn-mocniej').disabled = S.nr !== 5; on('btn-mocniej', S.nr === 5 && S.mocniej > 1);
  $('btn-ht').disabled = !isHab();
  $('btn-ht').textContent = `H-T: ${S.ht === 'klaster' ? 'klaster (zapas)' : 'bryła belek z gry'}`;
  $('k-btns').querySelectorAll('button').forEach((b) => { b.disabled = isHab(); });
  // g
  const gb = $('g-btns');
  const gList = S.nr === 1 ? [60, 80, 100] : isHab() ? [] : [400, 100, 80, 60];
  $('h-g').textContent = S.nr === 1 ? 'Tempo g (prawa wieża; lewa 400)' : isHab() ? 'Tempo g (habitat: g gry — 260 do dysku, 400)' : 'Tempo g';
  const gCur = S.g[S.nr];
  if (gb.dataset.nr !== String(S.nr)) {
    gb.dataset.nr = String(S.nr);
    gb.innerHTML = gList.map((g) => `<button data-g="${g}">g ${g}</button>`).join('');
    gb.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.g[S.nr] = Number(b.dataset.g); startScene(); }));
  }
  gb.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.g) === gCur));
  // κ
  const kb = $('k-btns');
  if (!kb.dataset.ok) {
    kb.dataset.ok = '1';
    kb.innerHTML = SCENY[3].kappy.map((k) => `<button data-k="${k}">κ ${String(k).replace('.', ',')}</button>`).join('');
    kb.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.kappa[S.nr] = Number(b.dataset.k); startScene(); }));
  }
  const kCur = cfg.kappa ?? sym?.hosts[0]?.A.tune.kappa;
  kb.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Math.abs(Number(b.dataset.k) - kCur) < 1e-9));
  // strona, auto, broń, podłoże
  const bat = !!cfg.bateria;
  for (const s of Object.keys(STRONY)) { const el = $(`st-${s}`); el.disabled = !bat; el.classList.toggle('on', bat && cfg.bateria.strona === s); }
  $('btn-auto').disabled = !bat; on('btn-auto', bat && cfg.bateria.auto !== false);
  $('btn-salwa').disabled = !bat;
  for (const b of ['dzialo', 'torpeda', 'reaktor']) { const el = $(`br-${b}`); el.disabled = S.nr !== 2; el.classList.toggle('on', S.nr === 2 && S.bron === b); }
  $('btn-podloze').disabled = S.nr !== 2;
  $('btn-podloze').textContent = `Podłoże: ${S.pomost ? 'pomost nad pustką' : 'grunt'}`;
  $('btn-pomost').disabled = S.nr !== 2 || S.pomostZniszczony;
  on('tg-gruz', O.toggles.gruz); on('tg-rysy', O.toggles.rysy); on('tg-pyl', O.toggles.pyl);
  for (const c of CAM_ORDER) on(`cam-${c}`, cam.mode === c);
  on('zb-podstawa', cam.mode === 'podstawa'); on('zb-dach', cam.mode === 'dach'); on('zb-gruz', cam.mode === 'gruz');
  on('t-1', !S.paused && S.speed === 1); on('t-025', !S.paused && S.speed === 0.25); on('t-pauza', S.paused);
  on('btn-petla', S.loop);
}

function bindPanel() {
  const click = (id, fn) => $(id).addEventListener('click', (e) => { fn(e); canvas.focus(); });
  for (const n of [1, 2, 3, 4, 5]) click(`sc-${n}`, () => { S.nr = n; startScene(); });
  for (const p of SCENY[4].podporyPanel) click(`pod-${String(p).replace('.', '')}`, () => { S.podpory = p; startScene(); });
  click('btn-mocniej', () => { S.mocniej = S.mocniej > 1 ? 1 : 3; startScene(); });
  click('btn-ht', () => { S.ht = S.ht === 'klaster' ? 'belki' : 'klaster'; startScene(); });
  click('zb-podstawa', () => applyPreset('podstawa'));
  click('zb-dach', () => applyPreset('dach'));
  click('zb-gruz', () => applyPreset('gruz'));
  for (const s of Object.keys(STRONY)) click(`st-${s}`, () => setSide(s));
  click('btn-auto', () => {
    S.auto = !S.auto;
    if (S.nr === 2) { sym.bateria({ auto: S.auto }); cfg = sym.cfg; refreshPanel(); } else startScene();
  });
  click('btn-salwa', salvo);
  for (const b of ['dzialo', 'torpeda', 'reaktor']) click(`br-${b}`, () => { S.bron = b; refreshPanel(); });
  click('btn-podloze', () => { S.pomost = !S.pomost; startScene(); });
  click('btn-pomost', destroyBridge);
  click('tg-gruz', () => { O.toggles.gruz = !O.toggles.gruz; refreshPanel(); });
  click('tg-rysy', () => { O.toggles.rysy = !O.toggles.rysy; refreshPanel(); });
  click('tg-pyl', () => { O.toggles.pyl = !O.toggles.pyl; refreshPanel(); });
  for (const c of CAM_ORDER) click(`cam-${c}`, () => applyPreset(c));
  click('t-1', () => { S.paused = false; S.speed = 1; refreshPanel(); });
  click('t-025', () => { S.paused = false; S.speed = 0.25; refreshPanel(); });
  click('t-pauza', () => { S.paused = !S.paused; refreshPanel(); });
  click('t-krok', stepOnce);
  click('btn-reset', startScene);
  click('btn-petla', () => { S.loop = !S.loop; refreshPanel(); });
}

function stepOnce() {
  S.paused = true;
  simStep();
  O.updateFx(DT);
  acc = 0;
  refreshPanel();
}

// ── wejście ───────────────────────────────────────────────────────────────────────────────────────────────────
const SIDE_KEYS = { ArrowLeft: '-x', ArrowRight: '+x', ArrowUp: '+y', ArrowDown: '-y' };
window.addEventListener('keydown', (e) => {
  if (!sym || e.target?.tagName === 'INPUT') return;
  keys.add(e.code);
  const d = /^Digit([1-5])$/.exec(e.code);
  if (d) {
    const n = Number(d[1]);
    if (e.shiftKey) { if (n <= 3) { S.bron = ['dzialo', 'torpeda', 'reaktor'][n - 1]; refreshPanel(); } } else { S.nr = n; startScene(); }
    e.preventDefault();
    return;
  }
  if (SIDE_KEYS[e.code]) { setSide(SIDE_KEYS[e.code]); e.preventDefault(); return; }
  switch (e.code) {
    case 'KeyR': startScene(); break;
    case 'Space': S.paused = !S.paused; refreshPanel(); e.preventDefault(); break;
    case 'Period': stepOnce(); break;
    case 'KeyC': applyPreset(CAM_ORDER[(CAM_ORDER.indexOf(cam.mode) + 1) % CAM_ORDER.length]); break;
    case 'KeyG': O.toggles.gruz = !O.toggles.gruz; refreshPanel(); break;
    case 'KeyF': salvo(); break;
    case 'KeyP': destroyBridge(); break;
    default: break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

let drag = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  canvas.focus();
  if (e.button === 0) { fireAtCursor(e); return; }
  drag = { b: e.button, x: e.clientX, y: e.clientY };
  e.preventDefault();
});
window.addEventListener('mouseup', () => { drag = null; });
window.addEventListener('mousemove', (e) => {
  if (!drag || !O) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.b === 2 && cam.mode !== 'gora') {
    cam.az -= dx * 0.005;
    cam.el = Math.max(-0.02, Math.min(1.45, cam.el + dy * 0.004));
  } else if (drag.b === 1 || (drag.b === 2 && cam.mode === 'gora')) {
    cam.follow = null;
    const c = camObject(), h = O.view.h;
    const k = cam.mode === 'gora' ? cam.orthoH / h : (2 * cam.dist * Math.tan(O.persp.fov * Math.PI / 360)) / h;
    const r = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 1);
    cam.tx += (-r.x * dx + u.x * dy) * k; cam.ty += (-r.y * dx + u.y * dy) * k; cam.tz += (-r.z * dx + u.z * dy) * k;
  }
});
canvas.addEventListener('wheel', (e) => {
  const k = Math.exp(Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100) * 0.14);
  if (cam.mode === 'gora') cam.orthoH = Math.max(300, Math.min(30000, cam.orthoH * k));
  else cam.dist = Math.max(300, Math.min(30000, cam.dist * k));
  e.preventDefault();
}, { passive: false });
window.addEventListener('resize', () => { if (O) { resizeView(); if (cam.mode === 'gora') updateCamera(0); } });

// ── pętla ─────────────────────────────────────────────────────────────────────────────────────────────────────
let lastNow = performance.now(), capAt = 0;
function frame(dtShow, alpha, realDt) {
  updateShip(dtShow);
  O.updateFx(dtShow);
  if (S.loop && cfg && showTime() >= (cfg.czas || 1e9)) startScene();
  updateCamera(realDt);
  O.render(camObject(), alpha);
  const now = performance.now();
  if (now >= capAt) { capAt = now + 250; if (!SHOT) caption(); }
}

function loop(now) {
  const real = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  try {
    const dtShow = S.paused ? 0 : real * S.speed;
    acc += dtShow;
    let n = 0;
    while (acc >= DT && n < 6) { simStep(); acc -= DT; n++; }
    if (n === 6 && acc > DT) acc = 0;
    frame(dtShow, S.paused ? 1 : Math.min(1, acc / DT), real);
  } catch (e) {
    reportError(`klatka: ${e.stack || e}`);
    S.paused = true;
  }
  requestAnimationFrame(loop);
}

// ── API narzędzi ──────────────────────────────────────────────────────────────────────────────────────────────
function pct(p) {
  const n = Math.min(stepMsN, stepMsRing.length);
  if (!n) return 0;
  const a = Array.from(stepMsRing.subarray(0, n)).sort((x, y) => x - y);
  return +a[Math.min(n - 1, Math.floor(p * n))].toFixed(3);
}
window.__zaw = {
  ready: false, error: null,
  get renderer() { return O?.renderer; },
  tune: { STRUCT_TUNE, COLLAPSE_TUNE },
  /** Scena n (1–3) z nadpisaniami { g, strona, kappa, auto, pomost, bron, kamera }. */
  scene(n, o = {}) {
    S.nr = SCENY[n] ? n : S.nr;
    if (Number.isFinite(o.g)) S.g[S.nr] = o.g;
    if (o.strona && S.strona[S.nr]) S.strona[S.nr] = o.strona;
    if (Number.isFinite(o.kappa)) S.kappa[S.nr] = o.kappa;
    if (o.auto !== undefined) S.auto = !!o.auto;
    if (o.pomost !== undefined) S.pomost = !!o.pomost;
    if (o.bron) S.bron = o.bron;
    if (Number.isFinite(o.podpory)) S.podpory = o.podpory;
    if (Number.isFinite(o.mocniej)) S.mocniej = o.mocniej;
    if (o.ht === 'klaster' || o.ht === 'belki') S.ht = o.ht;
    startScene();
    if (o.kamera) applyPreset(o.kamera);
    return this.stats();
  },
  /** n klatek po 1/fps czasu pokazu (zegar ręczny, ?test=1): kroki fizyki z licznika całkowitego, render każdej klatki. */
  async runFrames(n = 1, fps = 60) {
    for (let i = 0; i < n; i++) {
      testTime += 1 / fps;
      const target = Math.round(testTime * HZ);
      while (testSteps < target) { simStep(); testSteps++; }
      frame(1 / fps, 1, 1 / fps);
      if ((i & 7) === 7) await new Promise((ok) => requestAnimationFrame(() => ok()));
    }
    await new Promise((ok) => requestAnimationFrame(() => ok()));
    return this.stats();
  },
  /** Klatka bez upływu czasu (zrzut po zmianie kamery). */
  async render() {
    updateCamera(0);
    O.render(camObject(), 1);
    if (!SHOT) caption();
    await new Promise((ok) => requestAnimationFrame(() => ok()));
    return true;
  },
  step() { stepOnce(); return this.stats(); },
  camera(name) { applyPreset(name); updateCamera(0); return cam.mode; },
  shoot(clientX, clientY) { fireAtCursor({ clientX, clientY }); return manual.length; },
  /** Strzał okrętu (scena 2) w punkt świata (x, y) płaszczyzny gry; domyślnie w środek pierwszej wieży. */
  shootWorld(x = info.towers[0].x, y = info.towers[0].y) { fireAt(x, y); return manual.length; },
  salvo() { salvo(); return manual.length; },
  side(s) { setSide(s); return cfg.bateria?.strona; },
  bridge() { destroyBridge(); return S.pomostZniszczony; },
  timeline() {
    const pre = cfg.przewin || 0;
    // habitat: oś czasu D22 i liczby płyty (te same co scripts/zawalenia-sym.mjs --scena 4,5)
    if (cfg.habitat) return [{ name: 'habitat', przewin: pre, habitat: sym.timeline() }];
    return sym.hosts.map((H) => ({ name: H.name, g: H.A.g, przewin: pre, ...collapseTimeline(H), tilt: undefined, tiltNow: tiltOf(H) }));
  },
  stats() {
    if (!sym || !O) return { ready: false };
    return {
      scena: S.nr, t: +showTime().toFixed(3), simT: +sym.t.toFixed(3), kroki: stepNo, hz: HZ, kamera: cam.mode,
      syncPipes: O.stats.syncPipes, syncNames: O.stats.syncNames.slice(), warmupMs: O.stats.warmupMs,
      rysunki: O.stats.draws, trojkaty: O.stats.tris, bloki: O.stats.blocks, ...O.fxCounts(),
      klatkaCpuMs: +O.stats.frameCpuMs.toFixed(3), krokMs: { p50: pct(0.5), p95: pct(0.95), max: pct(1), n: Math.min(stepMsN, stepMsRing.length) },
      gospodarze: sym.hosts.map((H) => ({ name: H.name, ...collapseStats(H) })),
      bledy: errors.slice(), zamienniki: O.placeholders()
    };
  }
};

// ── start ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    O = await createObraz(canvas, { onError: reportError });
  } catch (e) {
    window.__zaw.error = String(e?.message || e);
    $('loading').textContent = window.__zaw.error;
    reportError(window.__zaw.error);
    return;
  }
  resizeView();
  HullBodies.init();
  HullBodies.warmUpClusters();
  // siatka H-T (sceny 4–5): bryły sceny bazy w układzie F wokselizacji (x, −z bazy, wysokość) — raz, przed rozgrzewką
  try {
    const d = pirateBaseData();
    const c = d.layout.chunkById.get('H-T');
    const cx = (c.box.x0 + c.box.x1) / 2, cz = (c.box.z0 + c.box.z1) / 2;
    const tri = dryDockSolidsToTriangles(dryDockChunkSolids(d.layout, d.scene, ['H-T']), { palette: d.style?.palette || null, sides: 12, map: (v) => [v[0] - cx, -(v[2] - cz), v[1]] });
    // szare bloki: barwy bryły przygaszone ku szarości bloków (tylko odcień); barwa per trójkąt → per wierzchołek
    const nTri = tri.positions.length / 9;
    const src = tri.colors, per = src.length === nTri * 3;
    const col = new Float32Array(tri.positions.length);
    for (let t = 0; t < nTri; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) col[t * 9 + v * 3 + k] = per ? src[t * 3 + k] : src[t * 9 + v * 3 + k];
    for (let i = 0; i < col.length; i += 3) {
      const l = 0.3 * col[i] + 0.59 * col[i + 1] + 0.11 * col[i + 2];
      for (let k = 0; k < 3; k++) col[i + k] = 0.3 + 0.35 * (0.75 * l + 0.25 * col[i + k]);
    }
    O.setHTGeometry(tri.positions, col);
  } catch (e) { reportError(`H-T: ${e.stack || e}`); }
  bindPanel();
  startScene();
  updateCamera(0);
  await O.warmup();
  updateCamera(0);
  O.render(camObject(), 1);
  if (!SHOT) caption();
  $('loading').style.display = 'none';
  canvas.focus();
  window.__zaw.ready = true;
  if (!TEST) { lastNow = performance.now(); requestAnimationFrame(loop); }
}
boot().catch((e) => { window.__zaw.error = String(e?.stack || e); reportError(window.__zaw.error); });
