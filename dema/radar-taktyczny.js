// Radar taktyczny kokpitu — demo (przebudowa 2026-10-07). Moduły gry 1:1: src/ui/radar/* (tracker, tarcza,
// podkład terenu, zbieracz), prawdziwe pole pasa asteroid (AsteroidBeltField), prawdziwy kolider ringu „Halo”
// (HaloRingCollider — płyta, tranzyty, ściany K-7) i prawdziwy suchy dok piratów (placeDryDock). Sceny:
//   1 — PAS: rdzeń pola pasa głównego, piraci, myśliwce, rakiety lecące na okręt, sygnatura masy, olbrzym;
//   2 — PORT: Ziemia z ringiem i halą K-7, sojusznicy, cel podróży;
//   3 — DOK: suchy dok piratów z parkingiem, eskorta, cel misji.
// Klawisze: X — impuls skanera, + / − — zasięg, O — H-UP / N-UP, 1/2/3 — scena, spacja — pauza.
import { CockpitRadar } from '../src/ui/radar/cockpitRadar.js';
import { createRadarFeed } from '../src/ui/radar/radarFeed.js';
import { AsteroidBeltField } from '../src/game/asteroidBeltField.js';
import { findBeltCores } from '../src/game/asteroidBeltGiants.js';
import { HaloRingCollider } from '../src/game/haloRingCollision.js';
import { placeDryDock } from '../src/game/story/shipyardLayout.js';
import pirateDestroyerUrl from '../src/assets/ships/piratedestroyer.png';
import pirateFrigateUrl from '../src/assets/ships/piratefrigate.png';
import pirateBattleshipUrl from '../src/assets/ships/piratebattleship.png';
import pirateCapitalUrl from '../src/assets/ships/piratecapital.png';
import terranFrigateUrl from '../src/assets/ships/terranfrigate.png';
import terranDestroyerUrl from '../src/assets/ships/terrandestroyer.png';
import terranBattleshipUrl from '../src/assets/ships/terranbattleship.png';
import atlasUrl from '../assets/capital_ship_rect_v1.png';

const AU = 42253.52;
const params = new URLSearchParams(location.search);
const sprites = {};
function sprite(url) {
  if (sprites[url]) return sprites[url];
  const img = new Image();
  img.src = url;
  sprites[url] = img;
  return img;
}

const HULL = {
  frigate: { w: 320, h: 150, url: pirateFrigateUrl, type: 'pirate_frigate', cap: false },
  destroyer: { w: 620, h: 250, url: pirateDestroyerUrl, type: 'pirate_destroyer', cap: false },
  battleship: { w: 1200, h: 470, url: pirateBattleshipUrl, type: 'pirate_battleship', cap: true },
  supercapital: { w: 1900, h: 820, url: pirateCapitalUrl, type: 'pirate_supercapital', cap: true },
  tfrigate: { w: 320, h: 150, url: terranFrigateUrl, type: 'frigate_pd', cap: false },
  tdestroyer: { w: 620, h: 250, url: terranDestroyerUrl, type: 'destroyer', cap: false },
  tbattleship: { w: 1200, h: 470, url: terranBattleshipUrl, type: 'battleship', cap: true }
};

let field = null;
let core = null;
function beltField() {
  if (field) return field;
  field = new AsteroidBeltField({ planets: [], sunX: 0, sunY: 0, auToWorld: AU });
  core = findBeltCores(field, { sunX: 0, sunY: 0, au: AU, count: 1 })[0] || { x: 41 * AU, y: 0 };
  return field;
}

const sim = {
  t: 0,
  paused: false,
  scene: params.get('scena') || 'pas',
  ship: null,
  npcs: [],
  stations: [],
  wrecks: [],
  rockets: [],
  features: [],
  rings: [],
  belt: null,
  masses: [],
  story: new Map(),
  travel: null,
  events: []
};

function makeShip(kind, x, y, angle, speed, opts = {}) {
  const h = HULL[kind];
  const e = {
    x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, angle,
    type: h.type, w: h.w, h: h.h, radius: h.w * 0.4, isCapitalShip: h.cap,
    friendly: !!opts.friendly, isPirate: !opts.friendly, hp: 1000, maxHp: 1000,
    sprite: sprite(h.url), name: opts.name || '', turn: opts.turn || 0, dead: false, fighter: false
  };
  sim.npcs.push(e);
  return e;
}

function makeFighter(x, y, angle, friendly, orbit = null) {
  const e = {
    x, y, vx: 0, vy: 0, angle, type: 'fighter', w: 40, h: 30, radius: 18, isCapitalShip: false,
    friendly, isPirate: !friendly, hp: 50, maxHp: 50, fighter: true, dead: false, orbit, phase: Math.random() * 6.28
  };
  sim.npcs.push(e);
  return e;
}

function launchMissile(from, target, hostile) {
  const a = Math.atan2(target.y - from.y, target.x - from.x) + (Math.random() - 0.5) * 0.5;
  sim.rockets.push({
    active: true, hostile, seed: Math.random() * 1e6, bornFrame: sim.t,
    position: { x: from.x, z: from.y }, velocity: { x: Math.cos(a) * 900, z: Math.sin(a) * 900 }, frameVel: { x: 0, z: 0 },
    target
  });
}

function setupScene(name) {
  sim.scene = name;
  sim.npcs.length = 0;
  sim.stations.length = 0;
  sim.wrecks.length = 0;
  sim.rockets.length = 0;
  sim.features.length = 0;
  sim.rings.length = 0;
  sim.masses.length = 0;
  sim.story.clear();
  sim.events.length = 0;
  sim.travel = null;
  sim.belt = null;
  sim.t = 0;
  const own = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: -0.6, angVel: 0.05, w: 806, h: 330, sprite: sprite(atlasUrl) };
  sim.ship = own;
  if (name === 'port') {
    const planet = { id: 'earth', x: 0, y: 0, r: 2600 };
    const collider = new HaloRingCollider(planet);
    sim.rings.push({ key: 'earth', planet, collider });
    sim.features.push({ id: 'earth', type: 'planet', entity: planet, radius: 37800 });
    const f = collider.frame;
    // przed bramą G-01 hali K-7, dziobem w kosmos
    const hub = { x: 0, z: f.floorZ + 16000 };
    const lx = f.origin.x + hub.x * f.tx + hub.z * f.rx;
    const ly = f.origin.y + hub.x * f.ty + hub.z * f.ry;
    const gx = planet.x + lx * collider.place.cos - ly * collider.place.sin;
    const gy = planet.y - (lx * collider.place.sin + ly * collider.place.cos);
    own.pos.x = gx; own.pos.y = gy;
    const out = Math.atan2(gy - planet.y, gx - planet.x);
    own.angle = out + 0.9;
    own.vel.x = Math.cos(own.angle) * 120; own.vel.y = Math.sin(own.angle) * 120;
    own.angVel = -0.03;
    sim.stations.push({ id: 'K7', name: 'Port Ziemi K-7', x: gx - Math.cos(out) * 9000, y: gy - Math.sin(out) * 9000, r: 300, ringPort: true, friendly: true });
    for (let i = 0; i < 5; i++) {
      const a = out + 0.4 + i * 0.25;
      makeShip(i % 2 ? 'tfrigate' : 'tdestroyer', gx + Math.cos(a) * (6000 + i * 1500), gy + Math.sin(a) * (6000 + i * 1500), a + 1.6, 180, { friendly: true, turn: 0.04 });
    }
    makeShip('tbattleship', gx + Math.cos(out - 0.3) * 4000, gy + Math.sin(out - 0.3) * 4000, own.angle, 110, { friendly: true, name: 'Bellator' });
    sim.travel = { x: gx + Math.cos(own.angle) * 160000, y: gy + Math.sin(own.angle) * 160000, label: 'Pas — pole 4' };
    return;
  }
  if (name === 'dok') {
    const center = { x: 0, y: 0 };
    const axis = 0.25;
    const dock = placeDryDock(center, axis);
    const st = { id: 'PIR_YARD', name: 'Suchy dok piratów', x: 0, y: 0, r: 600, radius: dock.radius, hitShapes: dock.hitShapes,
      hallShapes: [dock.hallArea], isPirate: true, friendly: false, hp: 16000, maxHp: 16000, _dockGone: new Set() };
    sim.stations.push(st);
    sim.story.set('dok', { entity: st, label: 'Suchy dok', radius: dock.radius });
    own.pos.x = -Math.cos(axis) * 11000 + Math.sin(axis) * 1500;
    own.pos.y = -Math.sin(axis) * 11000 - Math.cos(axis) * 1500;
    own.angle = axis + 0.15;
    own.vel.x = Math.cos(axis) * 160; own.vel.y = Math.sin(axis) * 160;
    own.angVel = 0.01;
    for (const s of dock.parked || []) void s;
    // eskorta wylatuje z hali
    for (let i = 0; i < 4; i++) makeShip(i ? 'frigate' : 'destroyer', 1200 + i * 700, -2600 - i * 400, Math.PI + axis - 0.3 + i * 0.2, 240, { turn: 0.06 });
    const flag = makeShip('supercapital', 2400, -1200, Math.PI + axis, 60, { name: 'Iron Skull' });
    sim.story.set('flag', { entity: flag, label: 'Okręt flagowy' });
    sim.masses.push({ shownX: 38000, shownY: -14000, spread: 7000, alpha: 1, label: 'Nieznana masa' });
    return;
  }
  // PAS
  const fld = beltField();
  sim.belt = { field: fld, giants: { entries: [{ id: 'warren', x: core.x + 16000, y: core.y - 21000, halfX: 15500, halfY: 12000, giant: null }] } };
  own.pos.x = core.x - 6000; own.pos.y = core.y + 4000;
  own.angle = -0.75;
  own.vel.x = Math.cos(own.angle) * 220; own.vel.y = Math.sin(own.angle) * 220;
  own.angVel = 0.035;
  const ox = own.pos.x;
  const oy = own.pos.y;
  const fwd = own.angle;
  const at = (d, off, ang = fwd) => ({ x: ox + Math.cos(ang + off) * d, y: oy + Math.sin(ang + off) * d });
  let p = at(12000, 0.25); makeShip('destroyer', p.x, p.y, fwd + Math.PI - 0.2, 260, { turn: -0.03 });
  p = at(15000, -0.15); makeShip('battleship', p.x, p.y, fwd + Math.PI + 0.3, 140, { name: 'Krwawy Wiek' });
  p = at(9000, 0.9); makeShip('frigate', p.x, p.y, fwd + 2.2, 320, { turn: 0.08 });
  p = at(7000, -0.95); makeShip('frigate', p.x, p.y, fwd - 2.4, 300, { turn: -0.06 });
  p = at(17500, 0.55); makeShip('frigate', p.x, p.y, fwd + Math.PI, 280);
  p = at(11000, Math.PI - 0.4); makeShip('destroyer', p.x, p.y, fwd, 300, { turn: 0.02 });   // z tyłu
  p = at(6000, Math.PI + 0.5); makeShip('frigate', p.x, p.y, fwd + 0.3, 330);                  // z tyłu
  p = at(3000, 2.3); makeShip('tdestroyer', p.x, p.y, fwd, 220, { friendly: true, name: 'Hasta' });
  p = at(2600, -2.2); makeShip('tfrigate', p.x, p.y, fwd, 220, { friendly: true, name: 'Custos' });
  const anchor = sim.npcs[1];
  for (let i = 0; i < 7; i++) makeFighter(anchor.x + (Math.random() - 0.5) * 2000, anchor.y + (Math.random() - 0.5) * 2000, 0, false, anchor);
  for (let i = 0; i < 4; i++) makeFighter(ox + 1500, oy + 800, 0, true, own);
  sim.stations.push({ id: 'PIR_OUT', name: 'Placówka Iron Skull', x: core.x + 26000, y: core.y + 9000, r: 420, isPirate: true, friendly: false });
  sim.masses.push({ shownX: ox + Math.cos(fwd + 0.6) * 34000, shownY: oy + Math.sin(fwd + 0.6) * 34000, spread: 6000, alpha: 1, label: 'Nieznana masa' });
  sim.wrecks.push({ x: ox + Math.cos(fwd - 0.5) * 4200, y: oy + Math.sin(fwd - 0.5) * 4200, vx: 4, vy: -3, angle: 1.1, w: 600, h: 240, sprite: sprite(pirateDestroyerUrl), isWreck: true });
  sim.events.push({ t: 4.5, fn: () => { for (let i = 0; i < 4; i++) launchMissile(sim.npcs[1], own.pos, true); } });
  sim.events.push({ t: 9, fn: () => { const e = sim.npcs[2]; if (e) { e.dead = true; e.hp = 0; } } });
  sim.events.push({ t: 2.2, fn: () => { sim.locked = [sim.npcs[0]]; } });
}

function stepSim(dt) {
  if (sim.paused) return;
  sim.t += dt;
  for (let i = sim.events.length - 1; i >= 0; i--) {
    if (sim.t >= sim.events[i].t) { sim.events[i].fn(); sim.events.splice(i, 1); }
  }
  const own = sim.ship;
  own.angle += own.angVel * dt;
  const sp = Math.hypot(own.vel.x, own.vel.y);
  own.vel.x = Math.cos(own.angle - 0.08) * sp;
  own.vel.y = Math.sin(own.angle - 0.08) * sp;
  own.pos.x += own.vel.x * dt;
  own.pos.y += own.vel.y * dt;
  for (let i = sim.npcs.length - 1; i >= 0; i--) {
    const e = sim.npcs[i];
    if (e.dead) { e.deadT = (e.deadT || 0) + dt; if (e.deadT > 0.3) sim.npcs.splice(i, 1); continue; }
    if (e.fighter && e.orbit) {
      e.phase += dt * 0.9;
      const c = e.orbit.pos || e.orbit;
      const tx = c.x + Math.cos(e.phase) * 1400;
      const ty = c.y + Math.sin(e.phase) * 1400;
      e.vx = (tx - e.x) * 0.8; e.vy = (ty - e.y) * 0.8;
      e.angle = Math.atan2(e.vy, e.vx);
    } else if (e.turn) {
      e.angle += e.turn * dt;
      const s = Math.hypot(e.vx, e.vy);
      e.vx = Math.cos(e.angle) * s; e.vy = Math.sin(e.angle) * s;
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  }
  for (const r of sim.rockets) {
    if (!r.active) continue;
    const tx = r.target.x - r.position.x;
    const ty = r.target.y - r.position.z;
    const d = Math.hypot(tx, ty);
    if (d < 300) { r.active = false; continue; }
    const want = Math.atan2(ty, tx);
    const cur = Math.atan2(r.velocity.z, r.velocity.x);
    let da = want - cur;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const na = cur + Math.max(-0.7 * dt, Math.min(0.7 * dt, da));
    r.velocity.x = Math.cos(na) * 1100; r.velocity.z = Math.sin(na) * 1100;
    r.position.x += r.velocity.x * dt;
    r.position.z += r.velocity.z * dt;
  }
  for (const w of sim.wrecks) { w.x += w.vx * dt; w.y += w.vy * dt; w.angle += 0.01 * dt; }
}

const feedBuilder = createRadarFeed();
let pingSerial = 0;
const env = {
  get ship() { return sim.ship; },
  get npcs() { return sim.npcs; },
  get stations() { return sim.stations; },
  get wrecks() { return sim.wrecks; },
  get rockets() { return sim.rockets; },
  get features() { return sim.features; },
  get rings() { return sim.rings; },
  get belt() { return sim.belt; },
  get storyTargets() { return sim.story; },
  get travelTarget() { return sim.travel; },
  get massSignatures() { return sim.masses; },
  get lockedTargets() { return sim.locked || []; },
  selectedTarget: null,
  ghosts: new Map(),
  vision: 18000,
  hides: () => false,
  isHostile: (e) => !e.friendly,
  hullMetrics: (e) => ({ worldW: e.w || 100, worldH: e.h || 60 }),
  spriteOf: (e) => (e.sprite && e.sprite.complete && e.sprite.naturalWidth ? e.sprite : null),
  spriteRotOf: () => 0,
  nameOf: (e) => (e.name ? `${e.name.toUpperCase()} · ${clsName(e.type)}` : clsName(e.type)),
  stationName: (st) => st.name,
  weaponRanges: [{ r: 6200, label: 'BAT 6,2k' }, { r: 14000, label: 'RAK 14k', rgb: '255, 186, 90' }],
  range: 20000,
  get pingSerial() { return pingSerial; },
  pingSpeed: 60000,
  pingRange: 90000,
  get paused() { return sim.paused; }
};

function clsName(type) {
  const t = String(type || '');
  if (t.includes('supercapital')) return 'SUPERCAPITAL';
  if (t.includes('battleship')) return 'PANCERNIK';
  if (t.includes('destroyer')) return 'NISZCZYCIEL';
  if (t.includes('frigate')) return 'FREGATA';
  if (t.includes('fighter')) return 'MYŚLIWIEC';
  return 'JEDNOSTKA';
}

// Tarcze: kopuła (jak w kokpicie: pomniejszona i ścięta cięciwą), pełna (Alt) i duża (×2 — ekrany 4K).
const radar = new CockpitRadar();
const views = [];
function addView(id, mode, scale, dpr) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const size = Math.round(280 * scale * dpr);
  canvas.width = size;
  canvas.height = size;
  views.push({ canvas, ctx: canvas.getContext('2d'), mode, dpr, shrink: mode === 'dome' ? 0.842857 : 1 });
  canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); radars.forEach((r) => r.cycleRange(ev.deltaY > 0 ? 1 : -1)); syncUi(); }, { passive: false });
}

// Każda tarcza ma własny tracker (osobny stan anteny) — w kokpicie jest jedna.
const radars = [];

function syncUi() {
  const el = document.getElementById('stan');
  if (el) el.textContent = `${radars[0]?.range / 1000 || 20}K · ${radars[0]?.orient === 'north' ? 'N-UP' : 'H-UP'} · ${sim.scene.toUpperCase()}`;
}

let last = 0;
let feedAt = -1;
function frame(now) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  stepSim(dt);
  if (now - feedAt > 100 || feedAt < 0) {
    feedAt = now;
    env.range = radars[0]?.range || 20000;
    feedBuilder.collect(env);
  }
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    radars[i].render(v.ctx, v.canvas.width, v.canvas.height, feedBuilder.feed, { mode: v.mode, dpr: v.dpr, shrink: v.shrink, now });
  }
  const st = radars[1]?.display.stats;
  const tst = radars[1]?.display.terrain.stats;
  const info = document.getElementById('info');
  if (info && st) info.textContent = `tarcza ${st.drawMs.toFixed(2)} ms · ślady ${st.tracks} · echa ${st.echoes} · podkład ${tst.lastMs.toFixed(1)} ms (skały ${tst.rocks}, clutter ${tst.clutterPx})`;
  requestAnimationFrame(frame);
}

window.addEventListener('keydown', (ev) => {
  const k = ev.key.toLowerCase();
  if (k === 'x') pingSerial++;
  if (k === '+' || k === '=') radars.forEach((r) => r.cycleRange(-1));
  if (k === '-') radars.forEach((r) => r.cycleRange(1));
  if (k === 'o') radars.forEach((r) => r.toggleOrient());
  if (k === '1') setupScene('pas');
  if (k === '2') setupScene('port');
  if (k === '3') setupScene('dok');
  if (k === ' ') { sim.paused = !sim.paused; ev.preventDefault(); }
  syncUi();
});

setupScene(sim.scene);
addView('kopula', 'dome', 1, 1);
addView('pelny', 'full', 1, 1);
addView('duzy', 'full', 2, 1);
for (let i = 0; i < views.length; i++) radars.push(i === 0 ? radar : new CockpitRadar());
const r0 = Number(params.get('zasieg'));
if (r0) radars.forEach((r) => r.setRange(r0));
if (params.get('orient') === 'north') radars.forEach((r) => r.setOrient('north'));
for (let i = 1; i < views.length; i++) {
  const r = radars[i];
  views[i].canvas.addEventListener('mousemove', (ev) => {
    const rect = views[i].canvas.getBoundingClientRect();
    r.setHover((ev.clientX - rect.left) * views[i].canvas.width / rect.width, (ev.clientY - rect.top) * views[i].canvas.height / rect.height);
  });
  views[i].canvas.addEventListener('mouseleave', () => r.setHover(null, null));
}
syncUi();
requestAnimationFrame(frame);

window.__radarDemo = {
  sim, radars, env,
  ping() { pingSerial++; },
  scene(name) { setupScene(name); syncUi(); },
  setRange(r) { radars.forEach((x) => x.setRange(r)); syncUi(); },
  setOrient(o) { radars.forEach((x) => x.setOrient(o)); syncUi(); },
  hover(i, x, y) { radars[i]?.setHover(x, y); },
  get ready() { return views.length > 0 && radars.every((r) => r.display.terrain.layer.valid); }
};
