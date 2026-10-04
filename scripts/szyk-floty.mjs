// Szyk floty bez przeglądarki: prawdziwe mózgi NPC (capitalAI), dowódca floty, model lotu,
// siatka AI i separacja wycięta z index.html (applySeparationForces z pomocnikami). Okręty
// uzbrojone jak w grze (gniazda z edytora, selectSpecSlots), więc kurs bojowy jest prawdziwy.
// Skrzydło gracza (5 pancerników, 5 niszczycieli, 50 fregat, losowo na 16 × 20 km) przechodzi
// fazy: zbiórka → przelot 500 j/s → zakręt 90° → ESKORTA przeciw 17 piratom → ATAK.
// Na fazę: zetknięcia sojuszników (środki bliżej niż 0,8 sumy promieni; gracz — elipsa
// kadłuba Atlasa), lot bokiem (kadłub 45–135° od kierunku lotu przy > 0,3 maxSpeed) i postój
// burtą do celu (wolniej niż 0,3 maxSpeed, kadłub 60–120° od namiaru celu).
//   node scripts/szyk-floty.mjs [--seed 7] [--seeds 1-6] [--root <drzewo gry>] [--json plik] [--why]
// --seeds a-b: każde ziarno w osobnym procesie (moduły trzymają stan), na końcu średnie;
// --root: inne drzewo gry (A/B — np. eksport main obok zmian), --why: rozbicie lotu bokiem
// i postoju burtą na przyczyny (klasa, miejsce w szyku, opóźnienie obrotu, kurs zadany).
// Faza ATAK to zwarcie z ruchomymi celami — porównuj średnie z kilku ziaren, nie jedno.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ROOT_ARG = arg('root', null);
const ROOT = ROOT_ARG ? pathToFileURL(resolve(ROOT_ARG) + '/').href : new URL('../', import.meta.url).href;
const JSON_OUT = arg('json', null);
const WHY = process.argv.includes('--why');
const PHASES = ['zbiórka (gracz stoi)', 'przelot 500 j/s', 'zakręt 90°', 'ESKORTA + piraci', 'ATAK'];

// --- wiele ziaren: osobne procesy, średnie ---
const SEEDS = arg('seeds', null);
if (SEEDS) {
  const [a, b] = SEEDS.split('-').map(Number);
  const dir = mkdtempSync(join(tmpdir(), 'szyk-floty-'));
  const perPhase = new Map(PHASES.map(p => [p, { c: [], b: [], br: [] }]));
  try {
    for (let s = a; s <= (b || a); s++) {
      const out = join(dir, `${s}.json`);
      const args = [fileURLToPath(import.meta.url), '--seed', String(s), '--json', out];
      if (ROOT_ARG) args.push('--root', ROOT_ARG);
      const r = spawnSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
      if (r.status !== 0) throw new Error(`ziarno ${s}: kod ${r.status}`);
      for (const row of JSON.parse(readFileSync(out, 'utf8'))) {
        const acc = perPhase.get(row.faza);
        acc.c.push(row.zetkniecia);
        acc.b.push(row.bokiem_pct);
        acc.br.push(row.burta_pct);
      }
      process.stderr.write(`ziarno ${s} gotowe\n`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const mean = (x) => +(x.reduce((p, q) => p + q, 0) / x.length).toFixed(1);
  console.log(`== ${ROOT_ARG || 'repo'} ziarna ${SEEDS}`);
  console.table(PHASES.map(p => {
    const acc = perPhase.get(p);
    return {
      faza: p,
      zetkniecia: acc.c.join('/'),
      bokiem_pct: acc.b.join('/'),
      bokiem_sr: mean(acc.b),
      burta_sr: mean(acc.br)
    };
  }));
  process.exit(0);
}

// --- jedno ziarno ---
const SEED = Number(arg('seed', 7));
let seed = SEED >>> 0;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
globalThis.window = globalThis.window || {};
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const npcs = [];
const player = {
  pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, x: 0, y: 0, vx: 0, vy: 0, angle: 0,
  radius: 915, isCapitalShip: true, sensors: { passiveRange: 80000 }, friendly: true
};
Object.assign(globalThis.window, {
  wrapAngle,
  ship: player,
  __frameId: 1,
  bullets: [],
  __npcRocketThreats: [],
  __playerRocketThreats: [],
  getUnitKind: (e) => {
    const t = String(e?.type || '');
    if (t.includes('frigate')) return 'frigate';
    if (t === 'destroyer') return 'destroyer';
    return 'battleship';
  },
  isEnemyUnit: (a, b) => {
    if (!a || !b) return false;
    if (b === player) return !a.friendly;
    if (a === player) return !!b.isPirate;
    return !!a.friendly !== !!b.friendly;
  },
  spawnBulletAdapter: () => {},
  isLineOfFireBlocked: () => false,
  getLeadAim: (o, t, s, out) => { out.x = t.x; out.y = t.y; return out; },
  SupportWing: { order: 'guard', units: [] }
});

const Grid = await import(ROOT + 'src/ai/aiSpatialGrid.js');
window.queryAIGrid = Grid.queryAIGrid;
window.getAIFriendlyCandidates = Grid.getAIFriendlyCandidates;
window.getAIPirateCandidates = Grid.getAIPirateCandidates;
const { aiBattleship, aiFrigate, aiDestroyer } = await import(ROOT + 'src/ai/capitalAI.js');
const { stepShipFlight, resolveShipFlightSpec } = await import(ROOT + 'src/game/flight/shipFlightModel.js');
const Coord = await import(ROOT + 'src/ai/fleetCoordinator.js');
const Aw = await import(ROOT + 'src/ai/fleetAwareness.js');
const { SHIP_EDITOR_DEFAULTS } = await import(ROOT + 'src/data/hardpointEditorDefaults.js');
const { SHIPS } = await import(ROOT + 'src/data/ships.js');
const { MASTER_WEAPONS } = await import(ROOT + 'src/data/weapons.js');
const { selectSpecSlots, resolveNpcSpecFrameId } = await import(ROOT + 'src/game/npcWeaponSpec.js');
window.aiPickTarget = (npc) => {
  if (npc.forceTarget && !npc.forceTarget.dead) return npc.forceTarget;
  return Aw.pickContactTarget(npc, { player, priority: null });
};

// --- separacja z index.html (prawdziwa funkcja z pomocnikami, w zasięgu atrap gry) ---
const html = readFileSync(new URL('index.html', ROOT), 'utf8').replace(/\r\n/g, '\n');
function sliceFunction(source, header) {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`index.html: brak „${header}”`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`index.html: niedomknięte „${header}”`);
}
const scope = {
  npcs, window, aiDecisionTickId: 0,
  HullBodies: { hasContact: () => false },
  getEntityShieldBlockingProgress: () => 0,
  getEntityShieldBaseRadius: () => 0,
  performance: globalThis.performance
};
const sepUidStart = html.indexOf('let __sepUidCounter = 0;');
const sepSrc = [
  sliceFunction(html, 'function isNpcCombatActive(npc) {'),
  sliceFunction(html, 'function clampVecLen(x, y, maxLen) {'),
  html.slice(sepUidStart, html.indexOf('function sepPriority(u) {', sepUidStart)),
  sliceFunction(html, 'function sepPriority(u) {'),
  sliceFunction(html, 'function sepYieldFactor(npc, other) {'),
  sliceFunction(html, 'function shieldPairStandoff(a, b) {'),
  sliceFunction(html, 'function applySeparationForces(npc, ax, ay) {')
].join('\n');
// eslint-disable-next-line no-new-func
const Sep = new Function('__scope', `with (__scope) {\n${sepSrc}\nreturn { applySeparationForces };\n}`)(scope);
window.applySeparationForces = Sep.applySeparationForces;

// --- okręty (promienie i masy jak po zbudowaniu kadłuba belek) ---
const RADIUS = { battleship: 327, destroyer: 159, frigate_pd: 111 };
const MASS = { battleship: 50000, destroyer: 25000, frigate_pd: 10000 };
const EDITOR = SHIP_EDITOR_DEFAULTS.ships;
function editorIdFor(kind, pirate) {
  if (kind === 'battleship') return pirate ? 'pirate_battleship' : 'battleship';
  if (kind === 'destroyer') return pirate ? 'pirate_destroyer' : 'destroyer';
  return pirate ? 'pirate_frigate' : 'frigate';
}
function arm(npc, pirate) {
  const cfg = EDITOR[editorIdFor(npc.type, pirate)];
  const hps = (cfg?.hardpoints || []).map(h => ({ ...h, mount: null }));
  npc.editorHardpoints = hps;
  const frameId = resolveNpcSpecFrameId(npc, SHIPS);
  const armed = selectSpecSlots(hps, frameId ? SHIPS[frameId].spec : null, ['main', 'aux']);
  const loadout = pirate ? { main: 'armata_mk1', aux: 'ciws_mk1' } : { main: 'railgun_mk2', aux: 'laser_pd_mk1' };
  npc.weapons = { main: [], aux: [], missile: [], hangar: [], special: [] };
  for (const hp of hps) {
    const wid = loadout[hp.type];
    if (!wid || !armed.has(hp)) continue;
    hp.mount = wid;
    npc.weapons[hp.type].push({ hp, weapon: MASTER_WEAPONS[wid] });
  }
}
function makeShip(side, kind, x, y, angle) {
  const friendlySide = side === 'friendly';
  const npc = {
    x, y, vx: 0, vy: 0, angle, angVel: 0, mission: true, type: kind,
    shipFrame: (friendlySide ? 'terran_' : 'pirate_') + (kind === 'frigate_pd' ? 'frigate' : kind),
    friendly: friendlySide, isPirate: !friendlySide, isCapitalShip: kind !== 'frigate_pd',
    radius: RADIUS[kind], mass: MASS[kind], hp: 5000, maxHp: 5000, shield: { val: 5000, max: 5000 }
  };
  arm(npc, !friendlySide);
  const brain = kind === 'destroyer' ? aiDestroyer : (kind === 'frigate_pd' ? aiFrigate : aiBattleship);
  if (friendlySide) npc.supportData = { leader: player, type: kind };
  npc.ai = (dt) => brain(null, npc, dt);
  npcs.push(npc);
  return npc;
}

const wing = [];
for (let i = 0; i < 5; i++) wing.push(makeShip('friendly', 'battleship', -6000 + Math.random() * 12000, -9000 + Math.random() * 18000, Math.random() * 6));
for (let i = 0; i < 5; i++) wing.push(makeShip('friendly', 'destroyer', -6000 + Math.random() * 12000, -9000 + Math.random() * 18000, Math.random() * 6));
for (let i = 0; i < 50; i++) wing.push(makeShip('friendly', 'frigate_pd', -8000 + Math.random() * 16000, -10000 + Math.random() * 20000, Math.random() * 6));

// --- pomiary ---
const DT = 1 / 120;
let tick = 0;
const contactState = new Map();
const phases = [];
let phase = null;
function newPhase(name) {
  phase = { name, t: 0, contacts: 0, pairs: {}, contactTime: 0, enemyContacts: 0, moving: 0, sideways: 0, holding: 0, broadside: 0, why: {} };
  phases.push(phase);
}
let pairSeq = 0;
function pairKey(a, b) {
  const ia = a.__szykId || (a.__szykId = ++pairSeq);
  const ib = b.__szykId || (b.__szykId = ++pairSeq);
  return ia < ib ? ia * 100000 + ib : ib * 100000 + ia;
}
const classOf = (n) => (n.type === 'frigate_pd' ? 'F' : (n.type === 'destroyer' ? 'D' : 'B'));
const slotOf = (n) => {
  const s = n.__battleSlot;
  return s ? `${s.kind}/${s.role}` : 'bez miejsca';
};
const bucket = (deg, edges) => {
  for (const e of edges) if (deg < e) return `<${e}°`;
  return `≥${edges[edges.length - 1]}°`;
};
function noteWhy(key) {
  phase.why[key] = (phase.why[key] || 0) + 1;
}
function measure() {
  for (let i = 0; i < npcs.length; i++) {
    const a = npcs[i];
    for (let j = i + 1; j < npcs.length; j++) {
      const b = npcs[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const lim = 0.8 * (a.radius + b.radius);
      const k = pairKey(a, b);
      const inContact = dx * dx + dy * dy < lim * lim;
      if (inContact && contactState.get(k) !== true) {
        if (a.friendly && b.friendly) {
          phase.contacts++;
          const p = [classOf(a), classOf(b)].sort().join('');
          phase.pairs[p] = (phase.pairs[p] || 0) + 1;
        } else phase.enemyContacts++;
      }
      if (inContact && a.friendly && b.friendly) phase.contactTime += DT * 3;
      contactState.set(k, inContact);
    }
  }
  // Gracz: elipsa kadłuba Atlasa (1800 × 806) powiększona o 0,8 promienia okrętu.
  const ca = Math.cos(player.angle);
  const sa = Math.sin(player.angle);
  for (const a of wing) {
    const dx = a.x - player.x;
    const dy = a.y - player.y;
    const lx = dx * ca + dy * sa;
    const ly = -dx * sa + dy * ca;
    const ea = 900 + 0.8 * a.radius;
    const eb = 403 + 0.8 * a.radius;
    const k = pairKey(a, player);
    const inContact = (lx * lx) / (ea * ea) + (ly * ly) / (eb * eb) < 1;
    if (inContact && contactState.get(k) !== true) {
      phase.contacts++;
      phase.pairs.P = (phase.pairs.P || 0) + 1;
    }
    contactState.set(k, inContact);
  }
  for (const a of wing) {
    if (a.dead) continue;
    const spec = resolveShipFlightSpec(a);
    const sp = Math.hypot(a.vx, a.vy);
    const it = a.__flightIntent;
    if (sp > 0.3 * spec.maxSpeed) {
      phase.moving++;
      const velA = Math.atan2(a.vy, a.vx);
      const off = Math.abs(wrapAngle(velA - a.angle));
      if (off > Math.PI / 4 && off < Math.PI * 0.75) {
        phase.sideways++;
        if (WHY) {
          const desA = Number.isFinite(a.desiredAngle) ? a.desiredAngle : a.angle;
          const lag = Math.abs(wrapAngle(desA - a.angle)) * 180 / Math.PI;
          const cmd = Math.abs(wrapAngle(desA - velA)) * 180 / Math.PI;
          const fromFace = it && Number.isFinite(it.face) ? Math.abs(wrapAngle(velA - it.face)) * 180 / Math.PI : NaN;
          noteWhy(`bokiem ${classOf(a)} ${slotOf(a)} obrót-do-zadanego ${bucket(lag, [15, 45])}`
            + ` zadany-od-ruchu ${bucket(cmd, [45, 135])} ruch-od-face ${Number.isFinite(fromFace) ? bucket(fromFace, [90, 150]) : 'brak face'}`);
        }
      }
    } else if (a.target && !a.target.dead) {
      phase.holding++;
      const tx = a.target.pos ? a.target.pos.x : a.target.x;
      const ty = a.target.pos ? a.target.pos.y : a.target.y;
      const toT = Math.atan2(ty - a.y, tx - a.x);
      const off = Math.abs(wrapAngle(toT - a.angle));
      if (off > Math.PI / 3 && off < Math.PI * 2 / 3) {
        phase.broadside++;
        if (WHY) {
          const desA = Number.isFinite(a.desiredAngle) ? a.desiredAngle : a.angle;
          const lag = Math.abs(wrapAngle(desA - a.angle)) * 180 / Math.PI;
          const face = it && Number.isFinite(it.face) ? Math.abs(wrapAngle(it.face - toT)) * 180 / Math.PI : NaN;
          const blend = it && Number.isFinite(it.face) ? Math.abs(wrapAngle(desA - it.face)) * 180 / Math.PI : NaN;
          noteWhy(`burtą ${classOf(a)} ${slotOf(a)} face-od-celu ${Number.isFinite(face) ? bucket(face, [15, 60]) : 'brak face'}`
            + ` zadany-od-face ${Number.isFinite(blend) ? bucket(blend, [15, 60]) : '-'} obrót-do-zadanego ${bucket(lag, [15, 45])}`
            + ` v ${bucket(sp, [100, 200, 300])}`.replace(/°(?=$)/, ' j/s'));
        }
      }
    }
  }
}
function stepPlayer(dt, pv) {
  if (!pv) return;
  const k = Math.min(1, dt * 0.8);
  player.vel.x += (pv.x - player.vel.x) * k;
  player.vel.y += (pv.y - player.vel.y) * k;
  player.vx = player.vel.x;
  player.vy = player.vel.y;
  player.pos.x = player.x = player.x + player.vx * dt;
  player.pos.y = player.y = player.y + player.vy * dt;
  if (Math.hypot(player.vx, player.vy) > 20) player.angle = Math.atan2(player.vy, player.vx);
}
function run(seconds, pv = null) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    window.__frameId++;
    stepPlayer(DT, pv);
    if (tick % 6 === 0) {
      scope.aiDecisionTickId++;
      Grid.rebuildAIGrid(npcs, true);
      Coord.updateFleetCoordinator(npcs, player, 1 / 20);
      for (const n of npcs) n.ai(1 / 20);
    }
    for (const n of npcs) stepShipFlight(n, DT);
    if (tick % 3 === 0) measure();
    phase.t += DT;
    tick++;
  }
}

newPhase(PHASES[0]);
run(40);
newPhase(PHASES[1]);
run(40, { x: 500, y: 0 });
newPhase(PHASES[2]);
run(25, { x: 0, y: 500 });
const px0 = player.x + 9000;
const py0 = player.y + 6500;
for (let i = 0; i < 2; i++) makeShip('pirate', 'battleship', px0 + i * 1500, py0, Math.PI);
for (let i = 0; i < 3; i++) makeShip('pirate', 'destroyer', px0 + 1500, py0 + 1500 * (i - 1), Math.PI);
for (let i = 0; i < 12; i++) makeShip('pirate', 'frigate_pd', px0 + 2500 + (i % 4) * 500, py0 + (Math.floor(i / 4) - 1) * 1500, Math.PI);
newPhase(PHASES[3]);
run(30, { x: 0, y: 0 });
window.SupportWing.order = 'engage';
newPhase(PHASES[4]);
run(30, { x: 0, y: 0 });

const rows = phases.map(p => ({
  faza: p.name,
  zetkniecia: p.contacts,
  pary: JSON.stringify(p.pairs),
  czasZetkniec_s: +p.contactTime.toFixed(1),
  bokiem_pct: p.moving ? +(100 * p.sideways / p.moving).toFixed(1) : 0,
  burta_pct: p.holding ? +(100 * p.broadside / p.holding).toFixed(1) : 0,
  zWrogiem: p.enemyContacts
}));
console.log(`== ${ROOT_ARG || 'repo'} ziarno ${SEED}`);
console.table(rows);
if (WHY) {
  for (const p of phases) {
    const top = Object.entries(p.why).sort((x, y) => y[1] - x[1]).slice(0, 10);
    if (!top.length) continue;
    console.log(`\n${p.name} (próbki co 3 ticki):`);
    for (const [k, v] of top) console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows));
