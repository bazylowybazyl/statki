// SCENY HABITATU dema D20 (4 — wieża H-T przez dysk mieszkalny, 5 — szyja: wieża bokiem na dysk) bez three i DOM (synteza
// dema § 4 sceny 4–5, § 2f). Importuje je demo (obraz), narzędzie Node (scripts/zawalenia-sym.mjs --scena 4,5) i test
// (tests/structurePlate.test.mjs) — liczby z Node = to, co widzi użytkownik. HullBodies przychodzi z wywołania (Node
// ustawia globalThis.window przed importem).
//
// Dysk mieszkalny = GRAF E1 (buildDiscArchetype, gospodarz zawalenia structureCollapse.js — wyspy dysku stają się
// klastrami-wycinkami) + POLE PŁYTY silnika (src/game/structurePlate.js — stojącą część niesie pole: kikut gospodarza bez
// par, otwór = komórki zgniecione pod węzłami wieży). Wieża H-T = PRAWDZIWA bryła belek z gry (pirateBaseSolidOf 'H-T' —
// ta sama wokselizacja co w misji; ?ht=klaster — od startu klaster z prostopadłościanów z towerPointCloud × 45²).
// Scena 4: HP 0 → zegar D8 (utrzymanie 1 → 0 w 2,5 s: graf i pole przez plateSetHold), wieża puszcza (g 260 + zapadnięcie),
// przebija dysk; po minięciu dysku staje się JEDNYM klastrem z grubych prostopadłościanów (D6 — zastępczo, bez grafu H-T),
// g 400, i leci na skałę (kula-teren `skala.pod` j. pod dyskiem). Scena 5: utrzymanie 1, przegub w nasadzie szyi
// (NECK_TUNE: hingeOffset, tipSpeed × `mocniej`, hingeBreakTilt), g 400 — bok szyi o koronę bębna (drugie pole płyty bez
// grafu), talerz w dysk: rów bez otworu (D7). Bez bębna i szybu H-C (D14).
// Kolejność kroku: drive (zegar D8, HP 0) → pre (collapsePreStep) → physics (HullBodies.step: wieża + klastry dysku,
// haki pola płyty → graf) → post (collapseStep → plateStep → minięcie dysku / spoczynek wieży → oś czasu).
import { buildDiscArchetype, towerPointCloud, STRUCT_MASS_UNIT, STRUCT_TUNE } from '../../src/game/structureGraph.js';
import {
  createCollapseHost, collapsePreStep, collapseStep, collapseGroundTerrain, collapseStats, collapseDispose
} from '../../src/game/structureCollapse.js';
import {
  createPlateBinding, discPlateOptions, annulusPlateOptions, plateStep, plateSetHold, plateStats, plateHoleIoU
} from '../../src/game/structurePlate.js';
import { buildClusterDesc, clusterMassProperties } from '../../src/game/beamRigid3D.js';
import { pirateBaseData } from '../../src/game/story/pirateBaseWorld.js';
import { pirateBaseSolidOf, pirateBaseMaterial } from '../../src/game/story/pirateBaseBodies.js';
import { NECK_TUNE } from '../../src/game/story/pirateBaseNeck.js';
import { PIRATE_BASE_SPEC } from '../../src/3d/portBuildings/pirateBaseLayout.js';
import { k7HeightToZ } from '../../src/3d/haloRing/haloPortK7Layout.js';
import { scenaUstaw, STRONY } from './scenariusze.js';

const HS = PIRATE_BASE_SPEC.habitat;
/** Wysokości habitatu (z świata silnika). */
export const HABITAT_Z = Object.freeze({
  discBot: k7HeightToZ(HS.discY0), discTop: k7HeightToZ(HS.discY1), tier2Top: k7HeightToZ(HS.tier2Y),
  neckBase: k7HeightToZ(HS.neckY0), neckTop: k7HeightToZ(HS.neckY1), ringBot: k7HeightToZ(HS.ringY0), ringTop: k7HeightToZ(HS.ringY1),
  headTop: k7HeightToZ(HS.headTop), mastTop: k7HeightToZ(HS.mastTop),
  crownBot: k7HeightToZ(HS.floorY), crownTop: k7HeightToZ(HS.rimTop)
});

// archetyp dysku RAZ na wartość podpór (supportHoldFloor — panel sceny 4); domyślna — bit w bit z E1
const DISC = new Map();
export function archetypDysku(podpory = STRUCT_TUNE.supportHoldFloor) {
  const k = String(podpory);
  let A = DISC.get(k);
  if (!A) {
    A = buildDiscArchetype({ seed: 7, tune: podpory === STRUCT_TUNE.supportHoldFloor ? null : { supportHoldFloor: podpory } });
    DISC.set(k, A);
  }
  return A;
}

/** Bryła belek H-T z gry (wokselizacja raz na układ — cache pirateBaseSolidOf): { structure, cx, cz, bounds, … }. */
export function wiezaHT() {
  const d = pirateBaseData();
  return pirateBaseSolidOf(d.layout, d.scene, 'H-T', d.style?.palette || null);
}

/**
 * Prostopadłościany wieży H-T (układ F wokselizacji = świat habitatu: x, −z bazy, wysokość; oś wieży w (0, 0)): szyja,
 * talerz (12 wycinków ringR0…ringR1), głowa, maszt — pole przekroju walców, masy ∝ objętość × gęstość towerPointCloud,
 * razem `mass`. D6 zastępczo: klaster bez grafu H-T (prefraktura i pękanie — E7).
 */
export function towerBoxes(mass) {
  const Z = HABITAT_Z, sq = Math.sqrt(Math.PI) / 2, G = 1;
  const parts = [];
  const add = (x, y, z, hx, hy, hz, d, yaw = 0) => parts.push({ x, y, z, hx, hy, hz, d, q: yaw ? { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) } : null });
  add(0, 0, (Z.neckBase + Z.neckTop) / 2, HS.neckR * sq, HS.neckR * sq, (Z.neckTop - Z.neckBase) / 2 - G, 0.35);
  const rm = (HS.ringR0 + HS.ringR1) / 2, hr = (HS.ringR1 - HS.ringR0) / 2 - G, ht = rm * Math.sin(Math.PI / 12) - G;
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5) / 12 * 2 * Math.PI;
    add(rm * Math.cos(a), rm * Math.sin(a), (Z.ringBot + Z.ringTop) / 2, hr, ht, (Z.ringTop - Z.ringBot) / 2 - G, 1, a);
  }
  add(0, 0, (Z.ringBot + Z.headTop) / 2, HS.headR * sq * 0.92, HS.headR * sq * 0.92, (Z.headTop - Z.ringBot) / 2 - G, 0.8);
  add(0, 0, (Z.headTop + Z.mastTop) / 2, 60 * sq, 60 * sq, (Z.mastTop - Z.headTop) / 2 - G, 0.5);
  let W = 0;
  for (const p of parts) W += 8 * p.hx * p.hy * p.hz * p.d;
  return parts.map((p, i) => ({ x: p.x, y: p.y, z: p.z, hx: p.hx, hy: p.hy, hz: p.hz, mass: mass * 8 * p.hx * p.hy * p.hz * p.d / W, id: i, q: p.q }));
}

// macierz obrotu kwaternionu (wiersze) do m
function rot(q, m) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - w * z); m[2] = 2 * (x * z + w * y);
  m[3] = 2 * (x * y + w * z); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - w * x);
  m[6] = 2 * (x * z - w * y); m[7] = 2 * (y * z + w * x); m[8] = 1 - 2 * (x * x + y * y);
}

// encja-lustro wieży: wszystkie pola od razu (syncSolidOut pisze pozę co krok)
class TowerEntity {
  constructor(name) {
    this.name = name; this.isWreck = true; this.collapseHost = null;
    this.x = 0.5; this.y = 0.5; this.z = 0.5; this.vx = 0.5; this.vy = 0.5; this.vz = 0.5;
    this.angle = 0.5; this.angVel = 0.5; this.mass = NaN; this.radius = 0.5; this._bpRadius = 0.5;
    this.quat = { x: 0.5, y: 0.5, z: 0.5, w: 0.5 };
    this.pos = null; this.vel = null; this.beamHull = null; this.solid3D = false; this.rigidCluster = false;
    this.noWreckSleep = false; this._coldUnsupported = false; this.noHullCollisions = false; this.isCollidable = true; this.dead = false;
  }
}

const R2 = (v) => (v === null || v === undefined || !(v >= 0) || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/**
 * Scena habitatu `nr` (4 / 5 albo gotowa konfiguracja jak scenaUstaw) na HullBodies `HB`. opts: hz (60), podpory, ht
 * ('belki' | 'klaster'), mocniej. Teren (skała), pola płyt i gospodarz dysku dokłada do silnika (stare tereny i pola zdejmuje
 * — jedna scena na silnik). Zwraca { cfg, hosts: [gospodarz dysku], dt, hz, tick, t, step(), drive/pre/physics/post,
 * entities, terrain, plate: { F, Pb, crown }, tower, towerPose(out), timeline(), stats(), dispose() }.
 */
export function createHabitatSym(HB, nr, opts = {}) {
  const cfg = typeof nr === 'object' ? nr : scenaUstaw(nr, opts);
  HB.init();
  const D = HB.engine;
  D.terrains.length = 0;
  for (const f of D.plateFields.slice()) D.removePlateField(f);
  const hz = Number(opts.hz) > 0 ? Number(opts.hz) : 60;
  const dt = 1 / hz;
  const Z = HABITAT_Z;
  const upadek = cfg.habitat === 'upadek';
  // skała: kula-teren pod dyskiem
  const rockTop = Z.discBot - cfg.skala.pod;
  const ground = Object.freeze({ kind: 'kula', cx: 0, cy: 0, cz: rockTop - cfg.skala.R, R: cfg.skala.R, friction: 0.7, armorMul: 3 });
  const terrain = D.addTerrain(collapseGroundTerrain(ground));
  // dysk: gospodarz (wyspy → klastry-wycinki) + pole płyty
  const A = archetypDysku(cfg.podpory);
  const host = createCollapseHost(A, {
    bodies: HB, id: 1, name: 'dysk', origin: { x: 0, y: 0, z: 0 }, yaw: 0, ground,
    stumpCollide: false, hinge: false, front: false
  });
  const F = D.addPlateField(discPlateOptions(A, {}));
  const Pb = createPlateBinding(F, host.S, {});
  let crown = null;
  if (cfg.korona) {
    // korona bębna (D14 — bez grafu bębna): pole z nośnością płyty × crownMul, gęstość ściany bębna
    crown = D.addPlateField(annulusPlateOptions({ name: 'korona', rIn: HS.drumR - HS.wall, rOut: HS.drumR, zBot: Z.crownBot, zTop: Z.crownTop, density: 2.4 }));
  }
  // kotwica windy (D17): blok górnej warstwy pierścienia zewnętrznego najbliższy kątowi cfg.winda.kat
  let windaBlok = -1;
  if (cfg.winda) {
    const ca = Math.cos(cfg.winda.kat), sa = Math.sin(cfg.winda.kat), r = A.disc.rOut - A.disc.dr / 2;
    let bd = Infinity;
    for (let b = 0; b < A.n; b++) {
      if (A.anchor[b] || A.z[b] < (A.disc.zBot + A.disc.zTop) / 2) continue;
      const dx = A.x[b] - r * ca, dy = A.y[b] - r * sa, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; windaBlok = b; }
    }
  }

  // ── wieża H-T ──
  const m = new Float64Array(9);
  const tw = {
    mode: cfg.ht === 'klaster' ? 'klaster' : 'belki', kind: '', entity: null, sol: null, com: [0, 0, 0], mass: 0,
    released: !upadek, passed: false, converted: false, joint: null, frozen: false, restT: 0, rest: { x: 0, y: 0, z: 0, t: -1 }
  };
  const sideV = STRONY[cfg.strona || '+x'] || [1, 0];
  if (tw.mode === 'belki') {
    tw.sol = wiezaHT();
    const mat = pirateBaseMaterial('tech');
    const e = new TowerEntity('H-T');
    const hull = HB.createSolid(e, tw.sol.structure, {
      position: { x: tw.sol.cx, y: -tw.sol.cz, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
      gravity: upadek ? null : { x: 0, y: 0, z: -cfg.g }, massPerArea: mat.density, collisionArmor: mat.armor, hexPerNode: 4
    });
    if (!hull) throw new Error('H-T: createSolid null');
    tw.entity = e; tw.kind = 'beam'; tw.mass = hull.body.mass;
  } else {
    const C = towerPointCloud();
    tw.mass = C.M * STRUCT_MASS_UNIT;
    makeTowerCluster(upadek ? null : { x: 0, y: 0, z: -cfg.g }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, null, null, true);
  }

  // klaster wieży z prostopadłościanów (D6): F-początek świata `o`, kwaternion q, prędkość w środku masy, ω
  function makeTowerCluster(gravity, o, q, vel, angVel, dense) {
    const boxes = towerBoxes(tw.mass);
    const desc = buildClusterDesc(boxes, dense ? { spacing: 40, maxPoints: 4096 } : {});
    const mp = clusterMassProperties(desc);
    const e = new TowerEntity('H-T (klaster)');
    const hull = HB.createCluster(e, desc, { origin: o, quaternion: q, velocity: vel || { x: 0, y: 0, z: 0 },
      angularVelocity: angVel || { x: 0, y: 0, z: 0 }, gravity, friction: 0.6 });
    if (!hull) throw new Error('H-T: createCluster null');
    tw.entity = e; tw.kind = 'rigid'; tw.com[0] = mp.com[0]; tw.com[1] = mp.com[1]; tw.com[2] = mp.com[2];
    return hull;
  }

  const towerBody = () => (tw.entity && tw.entity.beamHull && tw.entity.beamHull.entity === tw.entity ? tw.entity.beamHull.body : null);
  /** Poza układu F wieży (początek w świecie silnika + kwaternion) do out {x, y, z, qx, qy, qz, qw}; false — brak wieży. */
  function towerPose(out) {
    const b = towerBody();
    if (!b || b.dead) return false;
    rot(b.quat, m);
    let lx, ly, lz;
    if (tw.kind === 'beam') {
      const h = tw.entity.beamHull;
      lx = b.latticeMin.x + h.anchorDX; ly = b.latticeMin.y + h.anchorDY; lz = b.latticeMin.z + h.anchorDZ;
    } else { lx = -tw.com[0]; ly = -tw.com[1]; lz = -tw.com[2]; }
    out.x = b.pos.x + m[0] * lx + m[1] * ly + m[2] * lz;
    out.y = b.pos.y + m[3] * lx + m[4] * ly + m[5] * lz;
    out.z = b.pos.z + m[6] * lx + m[7] * ly + m[8] * lz;
    out.qx = b.quat.x; out.qy = b.quat.y; out.qz = b.quat.z; out.qw = b.quat.w;
    return true;
  }

  // scena 5: przegub w nasadzie szyi (resztka szyi), przechył startowy ku stronie upadku
  if (!upadek) {
    const b = towerBody();
    const fx = sideV[0], fy = sideV[1];
    const hx = fx * HS.neckR * NECK_TUNE.hingeOffset, hy = fy * HS.neckR * NECK_TUNE.hingeOffset, hz = Z.neckBase;
    if (tw.kind === 'beam') tw.joint = D.addJoint(b, hx, hy, hz, { breakTilt: NECK_TUNE.hingeBreakTilt, breakForce: NECK_TUNE.hingeBreakForce, name: 'szyja' });
    else tw.joint = HB.clusterJoint(tw.entity, hx, hy, hz, { breakTilt: NECK_TUNE.hingeBreakTilt, name: 'szyja' });
    // przechył startowy jak szyb pęknięty bez taranu (NECK_TUNE.fallbackSpeed — prędkość umowna), × „mocniej” (R3)
    const w0 = Math.min(NECK_TUNE.tipMax, NECK_TUNE.tipSpeed + NECK_TUNE.fallbackSpeed * NECK_TUNE.tipPerSpeed) * (cfg.mocniej || 1);
    const wx = -fy * w0, wy = fx * w0;
    const rx = b.pos.x - hx, ry = b.pos.y - hy, rz = b.pos.z - hz;
    const V = { x: wy * rz, y: -wx * rz, z: wx * ry - wy * rx }, W = { x: wx, y: wy, z: 0 };
    if (tw.kind === 'beam') { b.angVel.x = W.x; b.angVel.y = W.y; b.angVel.z = 0; b.vel.x = V.x; b.vel.y = V.y; b.vel.z = V.z; D.wake(b, 60); }
    else HB.driveCluster(tw.entity, null, V, W, { gravity: true });
  }

  // ── oś czasu ──
  const TL = {
    hp0: upadek ? cfg.hp0 : -1, dotyk: -1, przebicie: -1, przejscie: -1, wiezaNaSkale: -1, pierwszyWycinek: -1, wycinekNaSkale: -1,
    korona: -1, spoczynek: -1, iouPrzejscie: null, vPrzejscie: null, vDotyk: null, wycinkiNaSkale: 0
  };
  const stumpBirths = collapseStats(host).births;
  const contact0 = { plate: 0, crown: 0 };
  terrain.onContact = (R, info) => {
    void info;
    const e = R.entity;
    if (!e) return;
    if (e === tw.entity) { if (TL.wiezaNaSkale < 0) TL.wiezaNaSkale = sym.t; return; }
    if (e.collapseHost === host && !e.__naSkale) {
      e.__naSkale = true;
      TL.wycinkiNaSkale++;
      if (TL.wycinekNaSkale < 0) TL.wycinekNaSkale = sym.t;
    }
  };

  const entities = [];
  const Vk = { x: 0, y: 0, z: 0 }, Wk = { x: 0, y: 0, z: 0 }, GF = { gravity: 0 };
  const P = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  const towerSpeed = () => { const b = towerBody(); return b ? Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vel.z * b.vel.z) : 0; };

  const sym = {
    cfg, hosts: [host], host, dt, hz, tick: 0, t: 0, entities, terrain, ground, A, windaBlok,
    plate: { F, Pb, crown }, tower: tw, towerPose, towerBody,
    drive() {
      const t = sym.tick * dt;
      // zegar D8: utrzymanie 1 → 0 w d8 s od HP 0 (graf i pole); scena 5 — habitat żyje (1)
      plateSetHold(Pb, upadek && t >= cfg.hp0 ? Math.max(0, 1 - (t - cfg.hp0) / cfg.d8) : 1);
      if (upadek && !tw.released && t + 1e-9 >= cfg.hp0) {
        tw.released = true;
        const b = towerBody();
        if (tw.kind === 'beam') {
          b.gravity = { x: 0, y: 0, z: -cfg.gFall };
          b.vel.z -= cfg.kick; b.angVel.x += cfg.tumble;
          D.wake(b, D.config.wakeHoldFrames);
        } else {
          Vk.x = 0; Vk.y = 0; Vk.z = -cfg.kick; Wk.x = cfg.tumble; Wk.y = 0; Wk.z = 0; GF.gravity = cfg.gFall;
          HB.driveCluster(tw.entity, null, Vk, Wk, GF);
        }
      }
    },
    pre() { collapsePreStep(host, dt); },
    physics() {
      entities.length = 0;
      if (tw.entity && towerBody()) entities.push(tw.entity);
      for (let i = 0; i < host.entities.length; i++) entities.push(host.entities[i]);
      HB.step(dt, entities);
    },
    post() {
      collapseStep(host, dt, sym.tick);
      plateStep(Pb, dt, sym.tick, host);
      sym.tick++;
      sym.t = sym.tick * dt;
      const t = sym.t;
      if (TL.dotyk < 0 && F.stats.contacts > 0 && contact0.plate === 0) {
        TL.dotyk = t; TL.vDotyk = Math.round(towerSpeed());
        // przebicie (scena 4): od styku z polem do minięcia dysku wieża bez par — wyspa dysku rodzi się wokół talerza
        // (pierścień 792…1023 zachodzi na talerz do r ~1000), klaster × belki zgniatałby wieżę w przenikaniu
        if (upadek && !tw.passed && tw.entity) tw.entity.noHullCollisions = true;
      }
      contact0.plate += F.stats.contacts;
      if (crown) { if (TL.korona < 0 && crown.stats.contacts > 0) TL.korona = t; contact0.crown += crown.stats.contacts; }
      if (TL.przebicie < 0 && Pb.iv[2] > 0) TL.przebicie = t;
      if (TL.pierwszyWycinek < 0 && collapseStats(host).births > stumpBirths) TL.pierwszyWycinek = t;
      // minięcie dysku (scena 4): wierzch wieży pod spodem dysku → klaster (D6), g po minięciu, pary włączone
      if (upadek && tw.released && !tw.passed && towerPose(P)) {
        rot({ x: P.qx, y: P.qy, z: P.qz, w: P.qw }, m);
        const topZ = P.z + m[8] * Z.mastTop;
        if (topZ < Z.discBot - cfg.passMargin) {
          tw.passed = true;
          TL.przejscie = t; TL.vPrzejscie = Math.round(towerSpeed());
          TL.iouPrzejscie = Math.round(plateHoleIoU(Pb, 0, 0, HS.ringR1) * 1000) / 1000;
          // D6 zastępczo: bryła belek (albo gęsty klaster przebicia) → jeden klaster z prostopadłościanów o zwykłych punktach
          // styku, g po minięciu, pary włączone; pęd i moment z ciała (prędkość w środku masy klastra: v + ω × R·Δcom)
          const b = towerBody(), old = tw.entity;
          let cbx = tw.com[0], cby = tw.com[1], cbz = tw.com[2];
          if (tw.kind === 'beam') {
            const h = old.beamHull;
            cbx = -(b.latticeMin.x + h.anchorDX); cby = -(b.latticeMin.y + h.anchorDY); cbz = -(b.latticeMin.z + h.anchorDZ);
            tw.mass = b.mass;
          }
          const vel = { x: b.vel.x, y: b.vel.y, z: b.vel.z }, w = { x: b.angVel.x, y: b.angVel.y, z: b.angVel.z };
          const q = { x: b.quat.x, y: b.quat.y, z: b.quat.z, w: b.quat.w }, o = { x: P.x, y: P.y, z: P.z };
          makeTowerCluster({ x: 0, y: 0, z: -cfg.gPassed }, o, q, vel, w, false);
          const nb = towerBody();
          const dx = tw.com[0] - cbx, dy = tw.com[1] - cby, dz = tw.com[2] - cbz;
          const rx = m[0] * dx + m[1] * dy + m[2] * dz, ry = m[3] * dx + m[4] * dy + m[5] * dz, rz = m[6] * dx + m[7] * dy + m[8] * dz;
          nb.vel.x = vel.x + w.y * rz - w.z * ry; nb.vel.y = vel.y + w.z * rx - w.x * rz; nb.vel.z = vel.z + w.x * ry - w.y * rx;
          HB.release(old);
          tw.converted = true;
        }
      }
      // scena 5: wieża leży (po uderzeniu w dysk / koronę) — zamrożenie w spoczynku (jak scenariusz szyi gry)
      if (!upadek && !tw.frozen && TL.dotyk >= 0 && t - TL.dotyk > 1.5) {
        const b = towerBody();
        if (b) {
          const r = tw.rest;
          const dx = b.pos.x - r.x, dy = b.pos.y - r.y, dz = b.pos.z - r.z;
          if (r.t < 0 || dx * dx + dy * dy + dz * dz > 30 * 30) { r.x = b.pos.x; r.y = b.pos.y; r.z = b.pos.z; r.t = t; }
          else if (t - r.t >= 0.6) {
            tw.frozen = true; TL.spoczynek = t;
            if (tw.kind === 'beam') D.freezeBody(b, NECK_TUNE.freezePinCells); else HB.freezeCluster(tw.entity);
          }
        }
      }
    },
    step() { sym.drive(); sym.pre(); sym.physics(); sym.post(); },
    strzaly() { return 0; },
    /** Oś czasu sceny (czasy [s] od startu symulacji; null — nie było) i liczby płyty (nowy obiekt). */
    timeline() {
      const ps = plateStats(Pb);
      return {
        scena: cfg.nr, rodzaj: cfg.habitat, ht: tw.mode, podpory: cfg.podpory, mocniej: cfg.mocniej,
        hp0: R2(TL.hp0), dotyk: R2(TL.dotyk), vDotyk: TL.vDotyk, przebicie: R2(TL.przebicie), przejscie: R2(TL.przejscie), vPrzejscie: TL.vPrzejscie,
        wiezaNaSkale: R2(TL.wiezaNaSkale), pierwszyWycinek: R2(TL.pierwszyWycinek), wycinekNaSkale: R2(TL.wycinekNaSkale), wycinkiNaSkale: TL.wycinkiNaSkale,
        korona: R2(TL.korona), spoczynek: R2(TL.spoczynek),
        opoznienieWycinka: TL.wycinekNaSkale >= 0 && TL.wiezaNaSkale >= 0 ? R2(TL.wycinekNaSkale - TL.wiezaNaSkale) : null,
        iouPrzejscie: TL.iouPrzejscie, iou: Math.round(plateHoleIoU(Pb, 0, 0, HS.ringR1) * 1000) / 1000,
        otwory: ps.holes, resztyBlokow: ps.killedCells, zdjete: ps.detached, row: ps.trench, komorki: ps.cells, zywe: ps.alive,
        blokiZabite: ps.killedBlocks, blokiUtracone: ps.lostBlocks, blokow: ps.blocks, ulamekUtraconych: Math.round(ps.lostFrac * 1000) / 1000,
        utrzymanie: Math.round(ps.hold * 1000) / 1000, impulsDoGrafu: Math.round(ps.impulse),
        koronaOtwory: crown ? crown.thick0.reduce((a, v, i) => a + (v > 0 && crown.thick[i] === 0 ? 1 : 0), 0) : null,
        koronaRow: crown ? crown.thick0.reduce((a, v, i) => a + (v > 0 && crown.thick[i] > 0 && crown.thick[i] < v ? 1 : 0), 0) : null
      };
    },
    dispose() {
      collapseDispose(host);
      if (tw.entity && tw.entity.beamHull) HB.release(tw.entity);
      tw.entity = null;
      const i = D.terrains.indexOf(terrain);
      if (i >= 0) D.terrains.splice(i, 1);
      D.removePlateField(F);
      if (crown) D.removePlateField(crown);
    }
  };
  return sym;
}
