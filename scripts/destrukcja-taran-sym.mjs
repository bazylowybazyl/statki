// Taran silnika belek w Node na PRAWDZIWYM HullBodies + worldBodies (audyt 2026-10-14, docs/AUDYT-destruktor-3d-2026-10-14.md):
// Atlas kontra bęben habitatu bazy piratów (kawałek H-S, ciała świata w bańce) i kontra niszczyciel. Bez przeglądarki — A/B
// zmian silnika „przed / po” w kilka sekund.
//
//   node scripts/destrukcja-taran-sym.mjs [--tryb kotwice,czolo,pchanie,musniecie,wycof,statek] [--dt 60,120] [--v 900,1500,3000] [--czas 3]
//     [--set crushStrength=1e6,contactV2=false] (konfiguracja silnika w locie)
//
//   kotwice   — węzły z invMass 0 (kotwice) w kawałkach habitatu, masy, zasięg kotwic od środka habitatu
//   czolo     — taran czołowy (koasting) w ścianę bębna: prędkość w czasie, głębokość, kontakty, węzły ściany, rozciągnięcie belek
//   pchanie   — start 900 j/s + CIĄG ku ścianie przez 4 s (W+Shift: 150 j/s² do 1500; szarża: 1100 j/s² do 3000), potem 2 s bez ciągu:
//               sekundy „w miejscu” przy ciągu, węzły ściany WEWNĄTRZ kadłuba Atlasa (wtunelowane), szczyt rozciągnięcia belek
//   musniecie — Atlas wzdłuż stycznej do ściany, burta 25 j. w ścianie w punkcie styczności: strata prędkości wzdłuż ruchu, spin
//   wycof     — taran 900 j/s, po zatrzymaniu ciąg wsteczny 300 j/s²: kiedy nos wychodzi ze ściany
//   statek    — Atlas × niszczyciel piracki (stoi): czołowo w burtę i muśnięcie z zakładem 20 j. — porwanie, spin, rozciągnięcie
//
// Miary: maxR = maks. długość żywej belki / długość bazowa (1,2 = +20%; limit zerwania poszycia 0,20, grodzi 0,47 przy
// globalBreakMul 0,6), peakMaxR — to samo próbkowane co 0,1 s w trakcie (stan, który widzi render), dispOver1 — węzły
// przesunięte > 1 komórki od spoczynku, wŚrodku / insidePeak — węzły ściany bliżej niż 0,6 komórki od żywego węzła Atlasa.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const { readPng } = await import('./webgpu/png.mjs');
const { resizeBox } = await import('../tests/helpers/reactorHulls.mjs');
const { getHullRenderSize } = await import('../src/data/ships.js');
const { HullBodies } = await import('../src/game/hullBodies.js');
const { worldBodies, WORLD_BODY_TUNE: T } = await import('../src/game/worldBodies.js');
const { createPirateBaseLayout } = await import('../src/3d/portBuildings/pirateBaseLayout.js');
const { buildPirateBaseScene } = await import('../src/3d/portBuildings/pirateBaseScene.js');
const { resolvePortBuildingStyle } = await import('../src/3d/portBuildings/portBuildingStyle.js');
const { placePirateBase } = await import('../src/game/story/pirateBaseSite.js');
const { createPirateBaseSites, PIRATE_BASE_SOLID, PIRATE_BASE_MATERIAL_OVERRIDE } = await import('../src/game/story/pirateBaseBodies.js');
// --mat disc.armor=2,tech.density=1.2 — materiały kawałków bazy w locie (A/B; tabela zamrożona — podmiana wpisu)
for (const kv of String(process.argv.includes('--mat') ? process.argv[process.argv.indexOf('--mat') + 1] : '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  const [a, b] = k.split('.');
  (PIRATE_BASE_MATERIAL_OVERRIDE[a] = PIRATE_BASE_MATERIAL_OVERRIDE[a] || {})[b] = Number(v);
}
// --solid tech.cell=45,tech.interior=full,gravity=400 — wokselizacja brył 3D bazy w locie (A/B)
for (const kv of String(process.argv.includes('--solid') ? process.argv[process.argv.indexOf('--solid') + 1] : '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  const [a, b] = k.split('.');
  const val = Number.isFinite(Number(v)) ? Number(v) : v;
  if (b) PIRATE_BASE_SOLID[a][b] = val; else PIRATE_BASE_SOLID[a] = val;
}

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const TRYBY = String(arg('tryb', 'kotwice,czolo,pchanie,musniecie,wycof,statek')).split(',');
const DTS = String(arg('dt', '60,120')).split(',').map((h) => 1 / Number(h));
const SPEEDS = String(arg('v', '900,1500,3000')).split(',').map(Number);
const CZAS = Number(arg('czas', 3));
const CIAG = Number(arg('ciag', 1100));   // szyja: ciąg szarży [j/s²] przez 4 s (0 — sam rozpęd)

// --hb k=v,k2=v2 — strojenie HULL_BODY_CONFIG (np. solidNodeDamping=0.4) przed HullBodies.init (A/B)
{
  const { HULL_BODY_CONFIG } = await import('../src/game/hullBodies.js');
  for (const kv of String(arg('hb', '')).split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    HULL_BODY_CONFIG[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
  }
}
HullBodies.init();
// --set k=v,k2=v2 — strojenie konfiguracji silnika (HullBodies.engine.config) bez zmiany plików (A/B)
for (const kv of String(arg('set', '')).split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  HullBodies.engine.config[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
}

const IMAGES = new Map();
function hullImage(id) {
  if (!IMAGES.has(id)) {
    const path = id === 'atlas' ? 'assets/capital_ship_rect_v1.png' : `src/assets/ships/${id.replace('_', '')}.png`;
    const png = readPng(join(repo, path));
    const size = getHullRenderSize(id, png.width, png.height);
    IMAGES.set(id, resizeBox(png, size.w, size.h));
  }
  return IMAGES.get(id);
}
function ship(id, x, y, angle, mass) {
  const e = { x, y, angle, vx: 0, vy: 0, angVel: 0, shipFrame: id, mass, name: id };
  if (!HullBodies.createHull(e, hullImage(id), { hullProfileId: id })) throw new Error('kadłub ' + id);
  return e;
}
// zasięg kadłuba w jego układzie (nos = +x): nos, rufa, pół-szerokość przy |x| < 200
function hullExtent(e) {
  const b = e.beamHull.body, s = b.nodeStore, h = e.beamHull;
  const ax = b.latticeMin.x + h.anchorDX, ay = b.latticeMin.y + h.anchorDY;
  let maxX = -Infinity, minX = Infinity, halfW = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const x = s.x[i] - ax, y = s.y[i] - ay;
    if (x > maxX) maxX = x; if (x < minX) minX = x;
    if (Math.abs(x) < 200 && Math.abs(y) > halfW) halfW = Math.abs(y);
  }
  return { nose: maxX, tail: minX, halfW };
}

const L = createPirateBaseLayout();
const style = resolvePortBuildingStyle('pirate');
const scene = buildPirateBaseScene(L, style);
const CENTER = { x: 5e6, y: 4e6 };
const place = placePirateBase(CENTER, 0, L);
const HAB = place.habitat;              // toGame(0, 0); oś 0: toGame(x, z) = (O.x + x, O.y + z)
const H = L.habitat;
const owners = { habitat: { id: 'hab', hp: 36000, maxHp: 36000 }, fuel: { id: 'fuel', hp: 1, maxHp: 1 }, warehouse: { id: 'w', hp: 1, maxHp: 1 }, piers: { id: 'p', hp: 1, maxHp: 1 } };
function freshHabitat() {
  worldBodies.reset();
  window.wrecks.length = 0;
  const sites = createPirateBaseSites(owners, { layout: L, scene, style }, place, {});
  worldBodies.addSite(sites.habitat);
  T.bubbleRadius = 1e6; T.buildBudgetMs = 1e6;
  worldBodies.step(1 / 60, [HAB]);
  return sites.habitat;
}
function bodiesOfPiece(p) {
  const out = [];
  const push = (e) => { const b = e?.beamHull?.entity === e ? e.beamHull.body : null; if (b && !b.dead) out.push({ e, b }); };
  push(p.entity);
  for (const e of p.islands) push(e);
  for (const w of window.wrecks) if (w.worldDebris && w.beamHull?.world === p) push(w);
  return out;
}
function liveNodes(list) { let n = 0; for (const { b } of list) n += b.activeNodes; return n; }
function strainStats(list) {
  let maxR = 0, over15 = 0, over30 = 0, beams = 0, maxDisp = 0, dispOver1 = 0, nodes = 0;
  for (const { b } of list) {
    const s = b.nodeStore, e = b.beamStore, cs = b.cellSize;
    for (let k = 0; k < e.count; k++) {
      if (e.broken[k]) continue;
      const a = e.a[k], c = e.b[k];
      if (!s.active[a] || !s.active[c]) continue;
      const r = Math.hypot(s.x[c] - s.x[a], s.y[c] - s.y[a]) / e.restBase[k];
      beams++;
      if (r > maxR) maxR = r;
      if (r > 1.15) over15++;
      if (r > 1.3) over30++;
    }
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      nodes++;
      const d = Math.hypot(s.x[i] - s.ox[i], s.y[i] - s.oy[i]) / cs;
      if (d > maxDisp) maxDisp = d;
      if (d > 1) dispOver1++;
    }
  }
  return { beams, maxR: +maxR.toFixed(2), over15, over30, nodes, maxDispCells: +maxDisp.toFixed(1), dispOver1 };
}
const _w = { x: 0, y: 0 };
// węzły ciał listy X leżące W ŚRODKU kadłuba Y (bliżej niż 0,6 komórki od żywego węzła Y)
function insideCount(listX, eY) {
  const by = eY.beamHull.body, sy = by.nodeStore;
  const th = 2 * Math.atan2(by.quat.z, by.quat.w), c = Math.cos(th), sn = Math.sin(th);
  const r2 = (0.6 * by.cellSize) ** 2;
  const cell = by.cellSize, grid = new Map();
  for (let j = 0; j < sy.count; j++) {
    if (!sy.active[j]) continue;
    const key = Math.floor(sy.x[j] / cell) * 100003 + Math.floor(sy.y[j] / cell);
    let arr = grid.get(key); if (!arr) grid.set(key, arr = []); arr.push(j);
  }
  let n = 0;
  for (const { e, b } of listX) {
    const s = b.nodeStore;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      HullBodies.nodeWorld(e.beamHull, i, _w);
      const X = _w.x - by.pos.x, Y = -_w.y - by.pos.y;
      const lx = c * X + sn * Y, ly = -sn * X + c * Y;
      const kx = Math.floor(lx / cell), ky = Math.floor(ly / cell);
      let hit = false;
      for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) {
        const arr = grid.get((kx + dx) * 100003 + (ky + dy));
        if (!arr) continue;
        for (const j of arr) { if ((sy.x[j] - lx) ** 2 + (sy.y[j] - ly) ** 2 < r2) { hit = true; break; } }
      }
      if (hit) n++;
    }
  }
  return n;
}
const CULLED = {};   // węzły odłamów brył 3D usuniętych pod dnem (rodzaj kawałka → liczba)
function integrate(e, dt) { e.x += e.vx * dt; e.y += e.vy * dt; e.angle += e.angVel * dt; }
function stepAll(ents, dt) {
  const focus = [{ x: ents[0].x, y: ents[0].y }];
  for (const e of ents) if (!e.dead) integrate(e, dt);
  for (const w of window.wrecks) if (!w.dead && !w.solid3D) integrate(w, dt);   // bryły 3D całkuje silnik (HullBodies.step)
  worldBodies.step(dt, focus);
  HullBodies.step(dt, worldBodies.withEntities([...ents, ...window.wrecks]));
  // odłamy brył 3D w otchłani (jak pętla wraków gry — HULL_BODY_CONFIG.solidFloorZ)
  for (let i = window.wrecks.length - 1; i >= 0; i--) {
    const w = window.wrecks[i];
    if (w.solid3D && w.z < HullBodies.config.solidFloorZ) {
      if (w.beamHull?.world?.kind) CULLED[w.beamHull.world.kind] = (CULLED[w.beamHull.world.kind] || 0) + (w.beamHull.body?.activeNodes || 0);
      HullBodies.release(w); window.wrecks.splice(i, 1);
    }
  }
}
function release(ents) { for (const e of [...ents, ...window.wrecks]) HullBodies.release(e); window.wrecks.length = 0; }
const hz = (dt) => Math.round(1 / dt);
const wrecksOf = () => window.wrecks.filter((w) => w.worldDebris).length;

const ATLAS_MASS = 800000;
const wallY = HAB.y + H.drumR;           // zewnętrzne lico ściany ćwiartki S (gra: y w dół → +y = +z hubu)
const atlasImg = hullImage('atlas');
const probeAtlas = ship('atlas', 0, 0, 0, ATLAS_MASS);
const EXT = hullExtent(probeAtlas);
HullBodies.release(probeAtlas);
console.log(`Atlas ${atlasImg.width}x${atlasImg.height}: nos ${EXT.nose.toFixed(0)}, rufa ${EXT.tail.toFixed(0)}, pół-szerokość ${EXT.halfW.toFixed(0)}; ściana bębna S w y = ${wallY.toFixed(0)}`);
function noseY(e) { return e.y + Math.sin(e.angle) * EXT.nose; }

if (TRYBY.includes('kotwice')) {
  console.log('\n=== KOTWICE: węzły z invMass 0 w kawałkach habitatu ===');
  const site = freshHabitat();
  for (const p of site.pieces) {
    if (p.state !== 'live') { console.log(`${p.id} (${p.kind}) — ${p.state}${p.ghost ? ' duch' : ''}`); continue; }
    const b = p.entity.beamHull.body, s = b.nodeStore;
    let pins = 0, rPinMax = 0, rFreeMin = Infinity;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      HullBodies.nodeWorld(p.entity.beamHull, i, _w);
      const r = Math.hypot(_w.x - HAB.x, _w.y - HAB.y);
      if (s.invMass[i] === 0) { pins++; if (r > rPinMax) rPinMax = r; } else if (r < rFreeMin) rFreeMin = r;
    }
    console.log(`${p.id} (${p.kind}, pancerz ${p.material?.armor}, gęstość ${p.material?.density}): węzły ${b.activeNodes}, kotwice ${pins} (${(100 * pins / b.activeNodes).toFixed(0)}%), masa ${(b.mass / 1000).toFixed(0)}k, kotwice do r=${rPinMax.toFixed(0)}, najbliższy wolny węzeł r=${rFreeMin.toFixed(0)}`);
  }
}

if (TRYBY.includes('czolo')) {
  console.log('\n=== CZOŁOWO w ścianę bębna (koasting, bez ciągu) ===');
  for (const dt of DTS) for (const v of SPEEDS) {
    const site = freshHabitat();
    const piece = site.pieces.find((p) => p.id === 'H-S');
    const n0 = liveNodes(bodiesOfPiece(piece));
    const atlas = ship('atlas', HAB.x, wallY + 300 + EXT.nose, -Math.PI / 2, ATLAS_MASS);
    const a0 = atlas.beamHull.body.activeNodes;
    atlas.vy = -v;
    const ents = [atlas];
    const steps = Math.round(CZAS / dt);
    const tl = [];
    let contactSteps = 0, maxContacts = 0, firstContactT = -1, stopT = -1, maxPen = 0, insidePeak = 0, peakR = 0;
    for (let k = 0; k < steps; k++) {
      stepAll(ents, dt);
      const c = HullBodies.perf.lastContacts;
      if (c > 0) { contactSteps++; if (firstContactT < 0) firstContactT = k * dt; }
      if (c > maxContacts) maxContacts = c;
      const sp = Math.hypot(atlas.vx, atlas.vy);
      if (stopT < 0 && firstContactT >= 0 && sp < 20) stopT = k * dt;
      const pen = wallY - noseY(atlas);
      if (pen > maxPen) maxPen = pen;
      if (globalThis.__diag && k % Math.round(0.1 / dt) === 0) globalThis.__diag.tick(k * dt, atlas, pen);
      if (k % Math.round(0.1 / dt) === 0) {
        const st = strainStats(bodiesOfPiece(piece));
        if (st.maxR > peakR) peakR = st.maxR;
        const ins = insideCount(bodiesOfPiece(piece), atlas);
        if (ins > insidePeak) insidePeak = ins;
        if (k % Math.round(0.25 / dt) === 0) tl.push(`${(k * dt).toFixed(2)}s v=${sp.toFixed(0)} c=${c} pen=${pen.toFixed(0)} wŚrodku=${ins} maxR=${st.maxR}`);
      }
    }
    const after = bodiesOfPiece(piece);
    console.log(JSON.stringify({ hz: hz(dt), v, drum: { n0, live: liveNodes(after), wrecks: wrecksOf(), ...strainStats(after), peakMaxR: peakR, insidePeak },
      atlas: { lost: a0 - atlas.beamHull.body.activeNodes, vEnd: +Math.hypot(atlas.vx, atlas.vy).toFixed(0), stopT: +stopT.toFixed(2), penMax: +maxPen.toFixed(0), penEnd: +(wallY - noseY(atlas)).toFixed(0), angVel: +atlas.angVel.toFixed(3) },
      contacts: { steps: contactSteps, max: maxContacts, firstT: +firstContactT.toFixed(2) } }));
    console.log('   ', tl.join(' | '));
    release(ents);
  }
}

if (TRYBY.includes('pchanie')) {
  console.log('\n=== PCHANIE: start 900 j/s, ciąg ku ścianie przez 4 s, potem 2 s bez ciągu ===');
  for (const dt of DTS) for (const mode of [{ n: 'W+Shift', acc: 150, cap: 1500 }, { n: 'szarża', acc: 1100, cap: 3000 }]) {
    const site = freshHabitat();
    const piece = site.pieces.find((p) => p.id === 'H-S');
    const core = site.pieces.find((p) => p.id === 'H-C');
    const n0 = liveNodes(bodiesOfPiece(piece)), c0 = liveNodes(bodiesOfPiece(core));
    const atlas = ship('atlas', HAB.x, wallY + 300 + EXT.nose, -Math.PI / 2, ATLAS_MASS);
    const a0 = atlas.beamHull.body.activeNodes;
    atlas.vy = -900;
    const ents = [atlas];
    const total = Math.round(6 / dt);
    let t = 0, stuckT = 0, peakR = 0, peakOver30 = 0, insidePeak = 0, penMax = 0, contactsMax = 0;
    const tl = [];
    for (let k = 0; k < total; k++) {
      if (t < 4 && -atlas.vy < mode.cap) atlas.vy -= mode.acc * dt;
      stepAll(ents, dt);
      t += dt;
      const c = HullBodies.perf.lastContacts;
      if (c > contactsMax) contactsMax = c;
      const sp = Math.hypot(atlas.vx, atlas.vy);
      if (t < 4 && sp < 20) stuckT += dt;
      const pen = wallY - noseY(atlas);
      if (pen > penMax) penMax = pen;
      if (k % Math.round(0.1 / dt) === 0) {
        const st = strainStats(bodiesOfPiece(piece));
        if (st.maxR > peakR) peakR = st.maxR;
        if (st.over30 > peakOver30) peakOver30 = st.over30;
        if (k % Math.round(0.5 / dt) === 0) {
          const ins = insideCount(bodiesOfPiece(piece), atlas) + insideCount(bodiesOfPiece(core), atlas);
          if (ins > insidePeak) insidePeak = ins;
          tl.push(`${t.toFixed(1)}s v=${sp.toFixed(0)} c=${c} pen=${pen.toFixed(0)} wŚrodku=${ins} maxR=${st.maxR}`);
        }
      }
    }
    const after = bodiesOfPiece(piece), afterCore = bodiesOfPiece(core);
    console.log(JSON.stringify({ hz: hz(dt), tryb: mode.n, stuckSec: +stuckT.toFixed(2), penMax: +penMax.toFixed(0), penEnd: +(wallY - noseY(atlas)).toFixed(0),
      drum: { n0, live: liveNodes(after), wrecks: wrecksOf(), ...strainStats(after), peakMaxR: peakR, peakOver30, insidePeak },
      core: { n0: c0, live: liveNodes(afterCore) }, atlas: { lost: a0 - atlas.beamHull.body.activeNodes, vEnd: +Math.hypot(atlas.vx, atlas.vy).toFixed(0), angVel: +atlas.angVel.toFixed(3) }, contactsMax }));
    console.log('   ', tl.join(' | '));
    release(ents);
  }
}

if (TRYBY.includes('musniecie')) {
  console.log('\n=== MUŚNIĘCIE: Atlas wzdłuż stycznej do ściany, burta 25 j. w ścianie w punkcie styczności (kurs +x) ===');
  for (const dt of DTS) for (const v of [300, 600, 1200]) {
    const site = freshHabitat();
    const piece = site.pieces.find((p) => p.id === 'H-S');
    const n0 = liveNodes(bodiesOfPiece(piece));
    // angle 0: burta od strony −y gry leży w y = e.y − halfW; ściana zajmuje y ∈ [wallY − 90, wallY] → e.y = wallY − 25 + halfW
    const atlas = ship('atlas', HAB.x - 700, wallY - 25 + EXT.halfW, 0, ATLAS_MASS);
    const a0 = atlas.beamHull.body.activeNodes;
    atlas.vx = v;
    const ents = [atlas];
    const steps = Math.round(2.5 / dt);
    let contactSteps = 0, maxContacts = 0, minSpeed = Infinity, peakR = 0, peakOver15 = 0;
    const tl = [];
    for (let k = 0; k < steps; k++) {
      stepAll(ents, dt);
      const c = HullBodies.perf.lastContacts;
      if (c > 0) contactSteps++;
      if (c > maxContacts) maxContacts = c;
      const sp = Math.hypot(atlas.vx, atlas.vy);
      if (sp < minSpeed) minSpeed = sp;
      if (k % Math.round(0.1 / dt) === 0) {
        const st = strainStats(bodiesOfPiece(piece));
        if (st.maxR > peakR) peakR = st.maxR;
        if (st.over15 > peakOver15) peakOver15 = st.over15;
        if (k % Math.round(0.25 / dt) === 0) tl.push(`${(k * dt).toFixed(2)}s vx=${atlas.vx.toFixed(0)} vy=${atlas.vy.toFixed(0)} w=${atlas.angVel.toFixed(2)} c=${c} maxR=${st.maxR}`);
      }
    }
    const after = bodiesOfPiece(piece);
    console.log(JSON.stringify({ hz: hz(dt), v, drum: { n0, live: liveNodes(after), wrecks: wrecksOf(), ...strainStats(after), peakMaxR: peakR, peakOver15 },
      atlas: { lost: a0 - atlas.beamHull.body.activeNodes, vxEnd: +atlas.vx.toFixed(0), vyEnd: +atlas.vy.toFixed(0), minSpeed: +minSpeed.toFixed(0), angVel: +atlas.angVel.toFixed(3) },
      contacts: { steps: contactSteps, max: maxContacts } }));
    console.log('   ', tl.join(' | '));
    release(ents);
  }
}

if (TRYBY.includes('wycof')) {
  console.log('\n=== WYCOFANIE: taran 900 j/s, po zatrzymaniu (albo 1,5 s) ciąg wsteczny 300 j/s² ===');
  for (const dt of DTS) {
    const site = freshHabitat();
    const piece = site.pieces.find((p) => p.id === 'H-S');
    const n0 = liveNodes(bodiesOfPiece(piece));
    const atlas = ship('atlas', HAB.x, wallY + 300 + EXT.nose, -Math.PI / 2, ATLAS_MASS);
    atlas.vy = -900;
    const ents = [atlas];
    let t = 0, reverseFrom = -1, exitT = -1, contactSteps = 0, penAtReverse = 0, lastInContact = -1;
    const tl = [];
    const total = Math.round(6 / dt);
    for (let k = 0; k < total; k++) {
      const sp = Math.hypot(atlas.vx, atlas.vy);
      if (reverseFrom < 0 && (t >= 1.5 || (t > 0.3 && sp < 30))) { reverseFrom = t; penAtReverse = wallY - noseY(atlas); }
      if (reverseFrom >= 0) atlas.vy += 300 * dt;
      stepAll(ents, dt);
      t += dt;
      const c = HullBodies.perf.lastContacts;
      if (c > 0) { contactSteps++; lastInContact = t; }
      if (reverseFrom >= 0 && exitT < 0 && wallY - noseY(atlas) < -5) exitT = t;
      if (k % Math.round(0.25 / dt) === 0) tl.push(`${t.toFixed(2)}s vy=${atlas.vy.toFixed(0)} c=${c} pen=${(wallY - noseY(atlas)).toFixed(0)}`);
    }
    const after = bodiesOfPiece(piece);
    console.log(JSON.stringify({ hz: hz(dt), reverseFrom: +reverseFrom.toFixed(2), penAtReverse: +penAtReverse.toFixed(0), penEnd: +(wallY - noseY(atlas)).toFixed(0),
      exitT: +exitT.toFixed(2), lastContactT: +lastInContact.toFixed(2), vyEnd: +atlas.vy.toFixed(0), contactSteps, drum: { n0, live: liveNodes(after), ...strainStats(after) } }));
    console.log('   ', tl.join(' | '));
    release(ents);
  }
}

if (TRYBY.includes('statek')) {
  const did = 'pirate_destroyer';
  const dimg = hullImage(did);
  const probe = ship(did, 0, 0, 0, 60000);
  const DEXT = hullExtent(probe);
  HullBodies.release(probe);
  console.log(`\n=== ATLAS × NISZCZYCIEL (${did} ${dimg.width}x${dimg.height}, pół-szer. ${DEXT.halfW.toFixed(0)}): stoi burtą; czołowo i muśnięcie z zakładem 20 j. ===`);
  for (const dt of DTS) for (const kind of ['czolo', 'musniecie']) for (const v of [600, 1500]) {
    worldBodies.reset(); window.wrecks.length = 0;
    const dest = ship(did, 0, 0, Math.PI / 2, 60000);
    const d0 = dest.beamHull.body.activeNodes;
    const atlas = kind === 'czolo'
      ? ship('atlas', -(DEXT.halfW + EXT.nose + 200), 0, 0, ATLAS_MASS)
      : ship('atlas', -1500, -(DEXT.nose + EXT.halfW) + 20, 0, ATLAS_MASS);
    const a0 = atlas.beamHull.body.activeNodes;
    atlas.vx = v;
    const ents = [atlas, dest];
    const steps = Math.round(2.5 / dt);
    let contactSteps = 0, maxContacts = 0, peakR = 0, peakOver30 = 0;
    const list = () => { const l = [{ e: dest, b: dest.beamHull.body }]; for (const w of window.wrecks) if (w.beamHull?.entity === w && !w.beamHull.body.dead) l.push({ e: w, b: w.beamHull.body }); return l; };
    for (let k = 0; k < steps; k++) {
      stepAll(ents, dt);
      const c = HullBodies.perf.lastContacts;
      if (c > 0) contactSteps++;
      if (c > maxContacts) maxContacts = c;
      if (k % Math.round(0.05 / dt) === 0) {
        const st = strainStats(list());
        if (st.maxR > peakR) peakR = st.maxR;
        if (st.over30 > peakOver30) peakOver30 = st.over30;
      }
    }
    console.log(JSON.stringify({ hz: hz(dt), kind, v, destroyer: { n0: d0, live: dest.beamHull.body.activeNodes, wrecks: window.wrecks.length, ...strainStats(list()), peakMaxR: peakR, peakOver30,
      vx: +dest.vx.toFixed(0), vy: +dest.vy.toFixed(0), angVel: +dest.angVel.toFixed(2), dx: +dest.x.toFixed(0), dy: +dest.y.toFixed(0) },
      atlas: { lost: a0 - atlas.beamHull.body.activeNodes, vx: +atlas.vx.toFixed(0), vy: +atlas.vy.toFixed(0), angVel: +atlas.angVel.toFixed(3) }, contacts: { steps: contactSteps, max: maxContacts } }));
    release(ents);
  }
}

// ============================================================================================================
// SZYJA (scenariusz misji 1; silnik 3D 2026-10-15): Atlas z prawej na lewo (kurs −x gry) w bęben E i szyb H-C. Zerwanie
// kotwic szybu → wieża (H-T — bryła 3D) na przegubie w nasadzie przechyla się w +x (ku stronie, z której przyszedł
// taran), przegub pęka, wieża uderza BOKIEM w koronę bębna i dysk mieszkalny (D-1…8 — bryły 3D), bok się zgniata.
//   --tryb szyja [--v 3000] [--dt 60,120] [--czas 18] [--ciag 1100] [--neck k=v] [--solid k=v] [--mat k=v]
if (TRYBY.includes('szyja')) {
  const { CollisionFX } = await import('../src/vfx/collisionFx.js');
  const { createNeckState, stepNeck, noteNeckRam, piecePinCount, NECK_TUNE } = await import('../src/game/story/pirateBaseNeck.js');
  // --neck k=v,k2=v2 — strojenie scenariusza szyi bez zmiany plików (A/B)
  for (const kv of String(arg('neck', '')).split(',').filter(Boolean)) { const [k, val] = kv.split('='); NECK_TUNE[k] = Number(val); }
  const D = HullBodies.engine;
  console.log('\n=== SZYJA: Atlas od prawej (kurs −x) w szyb H-C — zerwanie, przewracanie wieży 3D, uderzenie bokiem ===');
  // --pary 1 — czas kolizji wg rodzaju pary (płaska, mieszana, 3D × 3D) i liczba par na krok po zerwaniu
  const PARY = { płaska: [0, 0], mieszana: [0, 0], bryły: [0, 0] };
  let paryOn = false;   // tylko po zerwaniu, przed osiadaniem (toppling / falling)
  if (arg('pary', '')) {
    const col = D.collideBodies.bind(D);
    D.collideBodies = function (A, B, dt, doDamage) {
      const t = performance.now();
      const r = col(A, B, dt, doDamage);
      if (paryOn) {
        const k = !A.planar && !B.planar ? 'bryły' : !A.planar !== !B.planar ? 'mieszana' : 'płaska';
        PARY[k][0] += performance.now() - t; PARY[k][1]++;
      }
      return r;
    };
  }
  const towerBodies = () => {
    const out = [];
    for (const w of window.wrecks) {
      const b = w?.beamHull?.entity === w ? w.beamHull.body : null;
      if (b && !b.dead && w.solid3D && w.beamHull.world?.kind === 'tech') out.push(b);
    }
    return out;
  };
  const tiltOf = (b) => Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (b.quat.x * b.quat.x + b.quat.y * b.quat.y))));
  for (const dt of DTS) for (const v of SPEEDS.filter((sp) => sp >= 1500)) {
    const site = freshHabitat();
    for (const k of Object.keys(CULLED)) delete CULLED[k];
    const st = createNeckState();
    const onFx = (ev) => {
      const pa = ev.A?.worldPiece || null, pb = ev.B?.worldPiece || null;
      if (!pa === !pb) return;
      const other = pa ? ev.B : ev.A;
      if (!other || other.isWreck || other.worldDebris) return;
      noteNeckRam(st, pa || pb, other, HullBodies.simTime, ev.x, ev.y);
    };
    CollisionFX.on('impact', onFx); CollisionFX.on('grind', onFx);
    const piece = (id) => site.pieces.find((p) => p.id === id);
    const discs = site.pieces.filter((p) => p.kind === 'disc');
    const drums = site.pieces.filter((p) => p.kind === 'drum');
    const atlas = ship('atlas', HAB.x + H.drumR + 300 + EXT.nose, HAB.y + 60, Math.PI, ATLAS_MASS);
    atlas.vx = -v;
    const ents = [atlas];
    let tiltAtImpact = -1, towerNodes0 = 0, impactWith = '';
    const ctx = { worldBodies, engine: D, layout: L, habitat: HAB, simTime: 0,
      onSnap: () => { towerNodes0 = towerBodies().reduce((n, b) => n + b.activeNodes, 0); },
      onImpact: (s0) => { const b = towerBodies()[0]; tiltAtImpact = b ? tiltOf(b) : -1; impactWith = s0.tower?.__contactWith?.worldPiece?.id || s0.tower?.__contactWith?.name || '?'; } };
    // ≥ 18 s: wieża przewraca się ~5–6 s, potem osiada i zamarza (NECK_TUNE.landRest*) — przy 60 Hz ~14 s od zerwania
    const steps = Math.round(Math.max(CZAS, 18) / dt);
    const nodesOf = (list) => list.reduce((n, p) => n + liveNodes(bodiesOfPiece(p)), 0);
    const discNodes0 = nodesOf(discs), drumNodes0 = nodesOf(drums);
    let stepPeak = 0, stepSum = 0, stepN = 0, partSolve = 0, partCol = 0, partSplit = 0, partPairs = 0, restSum = 0, restN = 0;
    let winMs = 0, winSolve = 0, winCol = 0, winN = 0, winBeams = 0;
    const tl = [];
    for (let k = 0; k < steps; k++) {
      const t0 = performance.now();
      paryOn = st.phase === 'toppling' || st.phase === 'falling';
      // --odlot 1 — po zerwaniu Atlas znika 20 km dalej (gracz przebił habitat i odleciał): dysk ma zostać ciałem
      if (arg('odlot', '') && st.phase !== 'attached' && !atlas.__odlot) {
        atlas.__odlot = true; atlas.x = HAB.x - 20000; atlas.y = HAB.y; atlas.vx = 0; atlas.vy = 0;
      }
      if (CIAG > 0 && k * dt < 4 && -atlas.vx < v) atlas.vx -= CIAG * dt;   // ciąg szarży (F) ku szybowi
      stepAll(ents, dt);
      ctx.simTime = HullBodies.simTime;
      stepNeck(st, site, ctx, dt);
      const ms = performance.now() - t0;
      if (st.phase === 'landed') { restSum += ms; restN++; }
      else if (st.phase !== 'attached') {
        stepSum += ms; stepN++; if (ms > stepPeak) stepPeak = ms;
        partSolve += D.perf.lastSolverMs; partCol += D.perf.lastCollisionMs; partSplit += D.perf.lastSplitMs; partPairs += D.perf.narrowphasePairs;
      }
      winMs += ms; winSolve += D.perf.lastSolverMs; winCol += D.perf.lastCollisionMs; winBeams += D.perf.solvedBeams || 0; winN++;
      if (k % Math.round(0.5 / dt) === 0) {
        const core = piece('H-C');
        const tb = towerBodies()[0];
        const wn = Math.max(1, winN);
        // prędkości węzłów aktywnych wieży (układ ciała, |vx|+|vy|+|vz| jak próg aktywności solvera)
        let vInfo = '';
        if (tb && tb._region && tb._region.list.length) {
          const s = tb.nodeStore, sp = tb._region.list.map((i) => Math.abs(s.vx[i]) + Math.abs(s.vy[i]) + Math.abs(s.vz[i])).sort((a, b) => a - b);
          const q = (f) => sp[Math.min(sp.length - 1, Math.floor(f * (sp.length - 1)))].toFixed(1);
          vInfo = ` v[med ${q(0.5)} p90 ${q(0.9)} max ${q(1)}]`;
        }
        tl.push(`${(k * dt).toFixed(1)}s ${st.phase} v=${Math.hypot(atlas.vx, atlas.vy).toFixed(0)} pinsH-C=${piecePinCount(core)}/${st.pinsInit}` +
          (tb ? ` wieża (${(tb.pos.x - HAB.x).toFixed(0)},${(-tb.pos.y - HAB.y).toFixed(0)},${tb.pos.z.toFixed(0)}) przechył=${(tiltOf(tb) * 57.3).toFixed(0)}° w=${Math.hypot(tb.angVel.x, tb.angVel.y, tb.angVel.z).toFixed(2)} węzły=${tb.activeNodes} akt=${tb._region ? tb._region.list.length : 0}` : '') +
          vInfo + ` krok=${(winMs / wn).toFixed(1)}ms (solver ${(winSolve / wn).toFixed(1)}, kolizje ${(winCol / wn).toFixed(1)}, belki ${(winBeams / wn).toFixed(0)})`);
        winMs = 0; winSolve = 0; winCol = 0; winN = 0; winBeams = 0;
      }
    }
    CollisionFX.off?.('impact', onFx); CollisionFX.off?.('grind', onFx);
    const tbs = towerBodies();
    let disp1 = 0, live = 0;
    for (const b of tbs) {
      const s = b.nodeStore, cs = b.cellSize;
      for (let i = 0; i < s.count; i++) {
        if (!s.active[i]) continue;
        live++;
        if (Math.hypot(s.x[i] - s.ox[i], s.y[i] - s.oy[i], s.z[i] - s.oz[i]) > cs) disp1++;
      }
    }
    const main = tbs.sort((a, b) => b.activeNodes - a.activeNodes)[0];
    const discWrecks = window.wrecks.filter((w) => w.worldDebris && w.beamHull?.world?.kind === 'disc').length;
    console.log(JSON.stringify({ hz: hz(dt), v, phase: st.phase, snapAt: +st.snapAt.toFixed(2), pinsInit: st.pinsInit,
      ram: { vx: +st.ramVx.toFixed(0), vy: +st.ramVy.toFixed(0) }, fall: { x: +st.fallX.toFixed(2), y: +st.fallY.toFixed(2) },
      hingeBrokeT: +st.hingeBrokeT.toFixed(2), impactT: +st.impactT.toFixed(2), impactWith, tiltAtImpactDeg: +(tiltAtImpact * 57.3).toFixed(0),
      tiltMaxDeg: +(st.tiltMax * 57.3).toFixed(0), landT: +st.landT.toFixed(2), frozen: st.frozen,
      impact: st.impactT >= 0 ? { x: +(st.impactX - HAB.x).toFixed(0), y: +(st.impactY - HAB.y).toFixed(0), z: +st.impactZ.toFixed(0) } : null,
      tower: { nodes0: towerNodes0, live, culled: CULLED.tech || 0, destroyed: towerNodes0 - live - (CULLED.tech || 0), fragments: tbs.length, disp1,
        end: main ? { x: +(main.pos.x - HAB.x).toFixed(0), y: +(-main.pos.y - HAB.y).toFixed(0), z: +main.pos.z.toFixed(0), v: +Math.hypot(main.vel.x, main.vel.y, main.vel.z).toFixed(0) } : null },
      drum: { nodes0: drumNodes0, lost: drumNodes0 - nodesOf(drums) },
      disc: { nodes0: discNodes0, lost: discNodes0 - nodesOf(discs), wrecks: discWrecks, live: discs.filter((p) => p.state === 'live').length },
      stepMs: { mean: +(stepSum / Math.max(1, stepN)).toFixed(2), peak: +stepPeak.toFixed(1), solver: +(partSolve / Math.max(1, stepN)).toFixed(2),
        collisions: +(partCol / Math.max(1, stepN)).toFixed(2), splits: +(partSplit / Math.max(1, stepN)).toFixed(2), pairs: +(partPairs / Math.max(1, stepN)).toFixed(1),
        landed: +(restSum / Math.max(1, restN)).toFixed(2) } }));
    console.log('   ', tl.join(' | '));
    if (arg('pary', '')) {
      const n = Math.max(1, stepN);
      console.log('    pary po zerwaniu do osiadania (ms / krok, wywołania / krok):', Object.entries(PARY).map(([k, [ms, c]]) => `${k} ${(ms / n).toFixed(2)} ms ${(c / n).toFixed(1)}`).join(', '));
      for (const k of Object.keys(PARY)) PARY[k] = [0, 0];
    }
    release(ents);
  }
}
