// dema/asteroidy-webgpu/miningRig.js
//
// Kopalnia w demie (tryb G): drony z laserami, ładunki, detonacja, wiązka
// ściągająca i skaner składu. Fizykę liczy src/game/asteroidMining.js, skały
// rysuje minedRocks.js; tu jest sterowanie, efekty i HUD — w grze zastąpią je
// drony 3D i UI gry (API fizyki zostaje).
//
//   • LPM (trzymany): trzy drony lecą nad punkt i tną laserami pod kątem
//     (z góry pionowa wiązka byłaby punktem); przeciąganie = bruzda. Skała pola
//     pod kursorem jest przejmowana przez fizykę przy pierwszym trafieniu.
//   • PPM: ładunek w dnie otworu pod kursorem (przyczepiony do skały — leci
//     z odłamem); C zmienia wielkość (S 0,5 · M 2 · L 8 · XL 32).
//   • F: detonacja wszystkich ładunków; T: wiązka ściągająca (okruchy i odłamy
//     lżejsze niż udźwig lecą do Atlasa i trafiają do ładowni); K: skaner
//     (rdzeń, ruda pod kursorem, ładunek potrzebny do przebicia).
//   • RDZEŃ (2026-09-28): R — ładunek w otworze tuż nad rdzeniem skały i detonacja
//     (rdzeń wypada z gniazda: bryła metalu, odłamki kryształu…); J — galeria
//     rdzeni (kawałki rdzeni wszystkich rud obok odłamków skorupy, piorun kulisty).
//   • PIORUN KULISTY (rdzeń skały energetycznej): odsłonięty ucieka i błądzi;
//     M — pułapka magnetyczna (sprzęt): wiązka T z pułapką chwyta go i ściąga do
//     pułapki (TRAP_CAP), bez pułapki wiązka go detonuje — wybuch przy statku.

import * as THREE from 'three/webgpu';
import { Fn, float, vec3, vec4, attribute, exp, max, normalize, cross, length, select, varyingProperty, mix } from 'three/tsl';
import { createYield, isCorePiece } from '../../src/game/asteroidMining.js';
import { chargeForDepth, chargeReach, rockMaterial, CORE_KIND_LABELS_PL, CORE_MATERIAL, MINING_CONFIG } from '../../src/game/asteroidMaterials.js';
import { RESOURCES, ASTEROID_YIELD } from '../../src/data/resources.js';
import { ROCK_TYPE_LABELS_PL, ROCK_TYPE_INDEX, pickShape } from '../../src/game/asteroidRockKinds.js';
import { BallLightningView, ballInstability } from './ballLightning.js';

export const CHARGES = Object.freeze([
  Object.freeze({ id: 'S', label: 'mały', energy: 0.5 }),
  Object.freeze({ id: 'M', label: 'średni', energy: 2 }),
  Object.freeze({ id: 'L', label: 'duży', energy: 8 }),
  Object.freeze({ id: 'XL', label: 'ciężki', energy: 32 })
]);

const DRONES = 3;
// Moc lasera drona (1 = digVolumeRate z asteroidMaterials.js); trzy drony dokopują się do rdzenia skały r ≈ 650 j. w kilkanaście sekund.
const DRONE_POWER = 1.5;
const DRONE_RING = 300;
const DRONE_Z = 170;
const TRACTOR = Object.freeze({ radius: 3600, capacity: 450, capture: 260 });
const BEAM_CAP = 96;
// Pułapka magnetyczna: tyle piorunów kulistych mieści naraz.
const TRAP_CAP = 3;
// Galeria rdzeni: rudy (kolejność w rzędzie) i opisy.
const GALLERY_TYPES = Object.freeze(['copper', 'iron', 'titan', 'silicon', 'crystal', 'ice', 'uran']);

function fmt1(v) { return v.toFixed(1).replace('.', ','); }

/** Opis rdzenia do HUD-u: „bryła metalu”, „zbite kryształy”, „piorun kulisty”… */
function coreLabel(kind, oreTypeId) {
  if (oreTypeId === 'silicon' && kind === 'crystal') return 'kryształ krzemu';
  if (kind === 'mineral' && oreTypeId === 'uran') return 'smółka uranowa';
  return CORE_KIND_LABELS_PL[kind] || kind || 'rdzeń';
}

// ---------------------------------------------------------------------------
// Wiązki (laser, wiązka ściągająca): pasek od A do B, szerokość w świecie,
// rdzeń HDR + poświata; addytywnie, z testem głębi (skała zasłania wiązkę).

class BeamLines {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const ig = new THREE.InstancedBufferGeometry();
    ig.setIndex(geo.index);
    ig.setAttribute('position', geo.getAttribute('position'));
    ig.setAttribute('uv', geo.getAttribute('uv'));
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAP * 4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAP * 4), 4);
    this.c = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAP * 4), 4);
    for (const [n, at] of [['bA', this.a], ['bB', this.b], ['bC', this.c]]) {
      at.setUsage(THREE.DynamicDrawUsage);
      ig.setAttribute(n, at);
    }
    ig.instanceCount = 0;
    ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = ig;
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.forceSinglePass = true;
    mat.side = THREE.DoubleSide;
    const vAcross = varyingProperty('float', 'vBeamAcross');
    const vAlong = varyingProperty('float', 'vBeamAlong');
    mat.positionNode = Fn(() => {
      const A = attribute('bA', 'vec4');
      const B = attribute('bB', 'vec4');
      const p = attribute('position', 'vec3');
      const d = B.xyz.sub(A.xyz);
      const dxy = vec3(d.x, d.y, 0.0);
      const perp = select(length(dxy).greaterThan(1e-3), normalize(cross(dxy, vec3(0.0, 0.0, 1.0))), vec3(1.0, 0.0, 0.0));
      vAcross.assign(p.y.mul(2.0));
      vAlong.assign(p.x.add(0.5));
      return mix(A.xyz, B.xyz, p.x.add(0.5)).add(perp.mul(p.y).mul(A.w));
    })();
    mat.fragmentNode = Fn(() => {
      const C = attribute('bC', 'vec4');
      const y = vAcross;
      const core = exp(y.mul(y).mul(-18.0));
      const halo = exp(y.mul(y).mul(-2.5)).mul(0.22);
      // Końce łagodnie (bez prostokątnych krawędzi).
      const ends = max(float(0.0), float(1.0).sub(max(float(0.0), vAlong.sub(0.97).mul(33.0))));
      return vec4(C.rgb.mul(core.add(halo)).mul(C.w).mul(ends), 0.0);
    })();
    this.mesh = new THREE.Mesh(ig, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    this.mesh.name = 'miningBeams';
    scene.add(this.mesh);
    this.count = 0;
  }

  begin() { this.count = 0; }

  /** Wiązka w scenie: A → B, szerokość [j.], barwa HDR, siła. */
  add(ax, ay, az, bx, by, bz, width, r, g, b, k = 1) {
    if (this.count >= BEAM_CAP) return;
    const o = this.count++ * 4;
    const A = this.a.array, B = this.b.array, C = this.c.array;
    A[o] = ax; A[o + 1] = ay; A[o + 2] = az; A[o + 3] = width;
    B[o] = bx; B[o + 1] = by; B[o + 2] = bz; B[o + 3] = 0;
    C[o] = r; C[o + 1] = g; C[o + 2] = b; C[o + 3] = k;
  }

  commit() {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    for (const at of [this.a, this.b, this.c]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Drony: sześciokątny dysk z dyszami (instancje), oświetlany jak kadłuby.

class DroneMeshes {
  constructor(scene, count) {
    const geo = new THREE.CylinderGeometry(34, 40, 16, 6);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0x3a4148, metalness: 0.55, roughness: 0.42 });
    mat.emissive = new THREE.Color(0x0a1a24);
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'miningDrones';
    this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  set(i, x, y, z, yaw) {
    this._q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
    this._p.set(x, y, z);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
  }

  commit(n) {
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------

export class MiningRig {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene pass gry
   * @param {import('../../src/game/asteroidMining.js').AsteroidMining} o.mining
   * @param {import('./rockLayers.js').RockLayer} o.playLayer
   * @param {(rock) => number} o.playZ z sceny środka skały gry
   * @param {import('./dynamics.js').Dynamics} o.dynamics
   * @param {import('./sparks.js').Sparks} o.sparks
   * @param {(x:number, y:number) => number} o.sunT transmitancja słońca do renderu
   * @param {import('./storm.js').StormSystem} [o.storm] łuki wyładowań pioruna kulistego
   * @param {object} [o.shared] uniformy skał (obraz pioruna kulistego)
   */
  constructor({ scene, mining, playLayer, playZ, dynamics, sparks, sunT, storm = null, shared = null }) {
    this.mining = mining;
    this.playLayer = playLayer;
    this.playZ = playZ;
    this.dynamics = dynamics;
    this.sparks = sparks;
    this.sunT = sunT;
    this.storm = storm;
    // Pioruny kuliste: obraz kul plazmy, pułapka magnetyczna (sprzęt), złapane,
    // błyski wyładowań (światło) i łuki pełzające po kulach.
    this.ballView = shared ? new BallLightningView({ scene, shared }) : null;
    this.trap = false;
    this.trapped = [];
    this._flashes = [];
    this._arcT = 0;
    // Galeria rdzeni: podpisy (przestrzeń skał) okruchów na pokaz.
    this.gallery = [];
    this.enabled = false;
    this.firing = false;
    this.cursor = null;          // punkt kursora (przestrzeń skał: x, −y)
    this.target = null;          // cel dronów
    this.charges = [];
    this.chargeIndex = 2;
    this.tractor = false;
    this.scan = true;
    this.cargo = createYield();
    this.lost = createYield();
    this.messages = [];
    this.lastBlast = null;
    this.hover = null;
    this.time = 0;
    this._testIds = 1;
    this.drones = Array.from({ length: DRONES }, (_, i) => ({
      p: [0, 0, 0], v: [0, 0, 0], phase: (i / DRONES) * Math.PI * 2, laser: null, parked: true
    }));
    this.beams = new BeamLines(scene);
    this.droneMeshes = new DroneMeshes(scene, DRONES);
    this._tractorTargets = [];
    this._hits = [];
    // Piła (Shift + przeciągnięcie LPM): pionowa płaszczyzna przez linię, dron-piła
    // przechodzi wzdłuż niej i wycina szczelinę (asteroidMining.slice pasami).
    this.saw = null;
    this.sawPreview = null;
    this._sawPoint = null;
    this._sparkQueue = [];
    this._hoverT = 0;
  }

  // --- Sterowanie ------------------------------------------------------------

  setEnabled(v) {
    this.enabled = !!v;
    if (!this.enabled) { this.firing = false; this.target = null; }
  }

  /** Kursor (świat gry) i stan LPM. */
  pointer(wx, wy, down) {
    this.cursor = [wx, -wy];
    this.firing = this.enabled && !!down;
    if (this.firing) this.target = [wx, -wy];
  }

  /** Podgląd linii piły (świat gry) albo null. */
  previewSaw(a, b) {
    this.sawPreview = a && b ? [a[0], -a[1], b[0], -b[1]] : null;
  }

  /** Start piły wzdłuż linii (świat gry): od a do b. */
  startSaw(ax, ay, bx, by) {
    this.sawPreview = null;
    const x0 = ax, y0 = -ay, x1 = bx, y1 = -by;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 60) return;
    // Linia wydłużona o zapas z obu stron (piła wchodzi i wychodzi poza skałę).
    const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
    const pad = 150;
    this.saw = {
      x0: x0 - dx * pad, y0: y0 - dy * pad, len: len + pad * 2, dx, dy, nx: -dy, ny: dx,
      t: 0, done: false, cut: 0
    };
    this._say(`Piła: cięcie ${Math.round(len)} j. — dron przejdzie wzdłuż linii`);
  }

  _stepSaw(dt) {
    const sw = this.saw;
    if (!sw || sw.done) return null;
    const mining = this.mining;
    // Punkt piły i skała pod nim (pionowy promień): prędkość zależy od twardości skały.
    const px = sw.x0 + sw.dx * sw.t, py = sw.y0 + sw.dy * sw.t;
    const under = mining.raycast(px, py, 6000, 0, 0, -1);
    const hard = under ? under.body.material.hardness : 0;
    const speed = under ? 380 / (0.2 + hard) : 1400;
    const t1 = Math.min(sw.len, sw.t + speed * dt);
    // Każde ciało, przez które przechodzi pas [t, t1] (odłam po rozcięciu też).
    for (const body of mining.bodies.slice()) {
      const r = body.boundR;
      const ex = body.p[0] - sw.x0, ey = body.p[1] - sw.y0;
      const along = ex * sw.dx + ey * sw.dy;
      const off = Math.abs(ex * sw.nx + ey * sw.ny);
      if (off > r || along + r < sw.t || along - r > t1) continue;
      const res = mining.slice(body, sw.x0, sw.y0, body.p[2], sw.nx, sw.ny, 0, 44,
        { x: sw.dx, y: sw.dy, z: 0, from: sw.t - 20, to: t1 + 20 }, this.lost);
      sw.cut += res.lost || 0;
      if (res.bodies && res.bodies.length) this._say(`Piła przecięła skałę: ${res.bodies.length + 1} części`);
    }
    sw.t = t1;
    if (sw.t >= sw.len) { sw.done = true; this._say('Piła: koniec cięcia'); }
    return { x: px, y: py, z: under ? under.z : -200, hit: !!under };
  }

  cycleCharge(dir = 1) {
    this.chargeIndex = (this.chargeIndex + dir + CHARGES.length) % CHARGES.length;
  }

  toggleTractor() { this.tractor = !this.tractor; }
  toggleScan() { this.scan = !this.scan; }

  /** Pułapka magnetyczna (sprzęt): bez niej wiązka detonuje pioruny kuliste. */
  toggleTrap() {
    this.trap = !this.trap;
    this._say(this.trap
      ? `Pułapka magnetyczna włączona — wiązka (T) chwyta pioruny kuliste (${this.trapped.length}/${TRAP_CAP})`
      : 'Pułapka magnetyczna wyłączona — wiązka zdetonuje piorun kulisty');
  }

  _say(text) {
    this.messages.push({ text, t: this.time });
    if (this.messages.length > 6) this.messages.shift();
  }

  /**
   * Skała pola pod punktem (świat gry) → ciało fizyki (zakotwiczone). Zwraca
   * ciało albo null.
   */
  activateAt(wx, wy, time) {
    let best = null, bestTop = -Infinity, bestD = null, bestB = 0;
    this.playLayer.forEachLoaded((rock, d, b) => {
      const s = Math.max(rock.sx, rock.sy, rock.sz);
      const R = rock.r * s * 1.05;
      const dx = rock.x - wx, dy = rock.y - wy;
      if (dx * dx + dy * dy > R * R) return;
      const top = d[b + 2] + rock.r * s;
      if (top > bestTop) { bestTop = top; best = rock; bestD = d; bestB = b; }
    });
    if (!best) return null;
    const body = this.mining.activate(best, { z: bestD[bestB + 2], time, sunT: bestD[bestB + 19], anchored: true });
    body.userData = { fieldId: best.id };
    this.playLayer.hide(best.id);
    const label = ROCK_TYPE_LABELS_PL[body.typeId] || body.typeId;
    this._say(`Przejęta skała: ${label}, r ${Math.round(best.r)} j., ${fmt1(body.mass)} t${body.oreTypeId && body.typeId === 'rock' ? ' (ukryty rdzeń!)' : ''}${this._coreNote(body)}`);
    return body;
  }

  // „ · rdzeń: bryła metalu r 190 j., 57 t” (piorun kulisty — ostrzeżenie).
  _coreNote(body) {
    const c = body.core;
    if (!c) return '';
    if (c.kind === 'plasma') return ` · w geodzie PIORUN KULISTY — złapiesz go tylko z pułapką magnetyczną (M)`;
    return ` · rdzeń: ${coreLabel(c.kind, c.oreTypeId)} r ${Math.round(c.r)} j., ${fmt1(body.coreMass)} t czystej rudy`;
  }

  /** Skała testowa danego typu obok statku (scena Kopalnia). */
  spawnTestRock(typeId, ship, time, r = 650) {
    const type = ROCK_TYPE_INDEX[typeId] ?? ROCK_TYPE_INDEX.copper;
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    const x = ship.x + c * 1700, y = ship.y + s * 1700;
    const id = 9e15 + this._testIds++;
    const rock = {
      id, x, y, r, d: 2 * r, shape: pickShape(type, 2 * r, 0.37, 0.5), type,
      qx: 0.12, qy: 0.34, qz: 0.05, qw: 0.93, ax: 0, ay: 0, az: 1, spin: 0, phase: 0,
      sx: 1.05, sy: 0.95, sz: 0.9, seed: 0.41
    };
    const l = Math.hypot(rock.qx, rock.qy, rock.qz, rock.qw);
    rock.qx /= l; rock.qy /= l; rock.qz /= l; rock.qw /= l;
    // Skały pola w obrysie testowej znikają (nie przenikają się).
    this.playLayer.forEachLoaded((f) => {
      if (Math.hypot(f.x - x, f.y - y) < r * 1.35 + f.r) this.playLayer.hide(f.id);
    });
    const body = this.mining.activate(rock, { z: this.playZ(rock), time, sunT: this.sunT(x, y), anchored: true });
    body.userData = { test: true };
    this._say(`Skała testowa: ${ROCK_TYPE_LABELS_PL[typeId] || typeId}, r ${r} j., ${fmt1(body.mass)} t, rudy ${fmt1(body.oreMass)} t${this._coreNote(body)}`);
    return body;
  }

  /** Największe ciało z nienaruszonym rdzeniem (skała testowa / przejęta) albo null. */
  _coreBody() {
    let best = null;
    for (const b of this.mining.bodies) {
      if (!b.alive || !b.core || !b.coreMaterial) continue;
      if (b.massDirty) b.recomputeMass();
      const present = b.coreMass > 1e-6;
      if (!present) continue;
      if (!best || b.mass > best.mass) best = b;
    }
    return best;
  }

  /**
   * R: ładunek (bieżąca wielkość) w otworze tuż nad rdzeniem (jak po wierceniu
   * do rdzenia) i detonacja — rdzeń wypada z gniazda.
   */
  blastCore(time) {
    const b = this._coreBody();
    if (!b) { this._say('Wysadź rdzeń: brak skały z rdzeniem (postaw skałę testową)'); return false; }
    const c = b.core;
    // „Góra” skały w jej układzie = kierunek do kamery (+Z sceny).
    const up = [0, 0, 0];
    const q = b.q;
    // v' = q* (0, 0, 1) q — oś Z sceny w układzie skały.
    const x = q[0], y = q[1], z = q[2], w = q[3];
    up[0] = 2 * (x * z - w * y); up[1] = 2 * (y * z + w * x); up[2] = 1 - 2 * (x * x + y * y);
    const d = (c.rMax ?? c.r) + b.cs * 0.8;
    const local = [c.x + up[0] * d, c.y + up[1] * d, c.z + up[2] * d];
    const ch = CHARGES[this.chargeIndex];
    this.charges.push({ body: b, local, energy: ch.energy, id: ch.id, t0: this.time });
    this._say(`Ładunek ${ch.id} w otworze nad rdzeniem (${coreLabel(c.kind, c.oreTypeId)}) — detonacja`);
    this.detonate();
    void time;
    return true;
  }

  /**
   * J: galeria rdzeni przed statkiem — kawałek rdzenia każdej rudy (górny rząd),
   * odłamek jej skorupy (dolny) i piorun kulisty na pokaz (wisi, nie wybucha).
   */
  spawnCoreGallery(ship) {
    const m = this.mining;
    const cfg = m.cfg;
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    // Środek galerii przed dziobem; rzędy poziomo na ekranie (świat gry → przestrzeń skał: Y = −y).
    const cx = ship.x + c * 1500, cy = ship.y + s * 1500;
    const step = 330;
    this.gallery.length = 0;
    const n = GALLERY_TYPES.length + 1;
    const put = (i, row, r, fields) => {
      const off = (i - (n - 1) / 2) * step;
      const gx = cx + off, gy = cy + row * 330 - 165;
      const rho = rockMaterial(fields.type).density;
      const mass = (4 / 3) * Math.PI * r * r * r * rho * cfg.tonnesPerVolume;
      const a = (i * 0.61803 + row * 0.37) % 1;
      const q = [0.3 * Math.sin(a * 9), 0.4 * Math.cos(a * 7), 0.2, 0.85];
      const l = Math.hypot(...q);
      const peb = {
        id: m._nextId++, sourceId: 0, parentId: 0, typeId: fields.typeId, oreRes: fields.oreRes, oreTypeId: fields.coreType,
        type: fields.type, core: fields.core, coreType: fields.coreType,
        p: [gx, -gy, -r * 1.05], v: [0, 0, 0], q: q.map((v) => v / l), w: [0, 0, 0], r, mass,
        oreMass: fields.core ? mass : mass * 0.1, shape: 0, seed: a, grace: 0, age: 0, alive: true, gravel: false,
        sleep: 0, asleep: true, display: true
      };
      m.pebbles.push(peb);
      return peb;
    };
    GALLERY_TYPES.forEach((t, i) => {
      const type = ROCK_TYPE_INDEX[t];
      const kind = CORE_MATERIAL[t]?.kind;
      const base = { type, typeId: t, oreRes: ASTEROID_YIELD[t] || null, coreType: t };
      const core = put(i, 0, 115, { ...base, core: true });
      const crust = put(i, 1, 95, { ...base, core: false });
      this.gallery.push({ p: core.p, r: core.r, text: `${ROCK_TYPE_LABELS_PL[t] || t} — rdzeń`, sub: coreLabel(kind, t) });
      this.gallery.push({ p: crust.p, r: crust.r, text: 'skorupa', sub: '~10% rudy' });
    });
    // Piorun kulisty na pokaz (bez bezpiecznika).
    const off = ((n - 1) - (n - 1) / 2) * step;
    const ball = m.addDisplayBall(cx + off, -cy, -60, 6);
    this.gallery.push({ p: ball.p, r: ball.r * 1.6, text: 'energetyczna — rdzeń', sub: 'piorun kulisty' });
    // Skały pola w obrysie galerii znikają (resetMining je przywraca).
    const hx = (n / 2) * step + 250, hy = 600;
    this.playLayer.forEachLoaded((f) => {
      if (Math.abs(f.x - cx) < hx + f.r && Math.abs(f.y - cy) < hy + f.r) this.playLayer.hide(f.id);
    });
    this._say('Galeria rdzeni: górny rząd — kawałki rdzeni (czysta ruda), dolny — odłamki skorupy; na końcu piorun kulisty');
    return { x: cx, y: cy };
  }

  /** Pionowy promień w dół w punkcie (przestrzeń skał) — trafienie w ciało albo null. */
  _probeDown(x, y) {
    return this.mining.raycast(x, y, 6000, 0, 0, -1, 1e6);
  }

  /** Ładunek w dnie otworu pod punktem (świat gry). */
  plantCharge(wx, wy, time) {
    let hit = this._probeDown(wx, -wy);
    if (!hit) {
      if (!this.activateAt(wx, wy, time)) { this._say('Ładunek: pod kursorem nie ma skały'); return null; }
      hit = this._probeDown(wx, -wy);
      if (!hit) return null;
    }
    const cfg = this.mining.cfg;
    const px = hit.x, py = hit.y, pz = hit.z - cfg.laserRadius * 0.6;
    const local = hit.body.worldToLocal(px, py, pz, [0, 0, 0]);
    const ch = CHARGES[this.chargeIndex];
    const charge = { body: hit.body, local, energy: ch.energy, id: ch.id, t0: this.time };
    this.charges.push(charge);
    const depth = this.mining.probe(hit.body, px, py, pz).depth;
    const need = chargeForDepth(hit.body.material, depth);
    this._say(`Ładunek ${ch.id} (${ch.energy}) w ${Math.round(depth)} j. pod powierzchnią — do przebicia trzeba ≥ ${fmt1(need)}`);
    return charge;
  }

  /** Detonacja wszystkich ładunków (kolejno; ładunek w odłamie idzie za nim). */
  detonate() {
    if (!this.charges.length) { this._say('Brak ładunków (PPM)'); return; }
    const list = this.charges;
    this.charges = [];
    let pieces = 0, breach = 0, contained = 0, corePieces = 0, coreKind = null, coreType = null;
    for (const ch of list) {
      const w = ch.body.localToWorld(ch.local[0], ch.local[1], ch.local[2], [0, 0, 0]);
      // Ciało mogło się już rozpaść: ładunek siedzi w tym, które ma go w środku.
      let body = ch.body.alive ? ch.body : null;
      if (!body || body.sample(ch.local[0], ch.local[1], ch.local[2]) < 0.3) {
        body = null;
        for (const b of this.mining.bodies) {
          const l = b.worldToLocal(w[0], w[1], w[2], [0, 0, 0]);
          if (b.sample(l[0], l[1], l[2]) >= 0.3) { body = b; break; }
        }
      }
      this._blastFx(w, ch.energy);
      if (!body) continue;
      const res = this.mining.detonate(body, w[0], w[1], w[2], ch.energy, this.lost);
      if (res.outcome === 'breach') {
        breach++;
        const all = [res.bodies, res.pebbles, res.gravel];
        pieces += res.bodies.length + res.pebbles.length + res.gravel.length;
        for (const list2 of all) for (const p of list2) if (isCorePiece(p)) corePieces++;
        if (res.coreChunks && body.core) { coreKind = body.core.kind; coreType = body.core.oreTypeId; }
      } else contained++;
      this.lastBlast = res;
    }
    const coreTxt = corePieces ? ` · rdzeń (${coreLabel(coreKind, coreType)}): ${corePieces} ${corePieces === 1 ? 'kawałek' : 'kawałków'} czystej rudy` : '';
    if (breach) this._say(`Wybuch: ${pieces} odłamów${coreTxt}${contained ? `, ${contained} ładunków za słabych` : ''}`);
    else this._say('Za słaby ładunek — skała pękła w środku, skorupa trzyma (następny sięgnie dalej)');
  }

  _blastFx(w, energy) {
    // Błysk wybuchu dema (światło z rozpraszaniem w pyle): przy mocy > 2 pomarańczowa
    // łuna zalewała cały kadr — moc rośnie wolno z energią ładunku.
    const k = Math.min(1.2, 0.3 + Math.sqrt(energy) * 0.16);
    // Efekty dema w świecie gry (x, y = −Y).
    this.dynamics.explode(w[0], -w[1], k, this.time);
    this._sparkQueue = this._sparkQueue || [];
    this._sparkQueue.push({ x: w[0], y: w[1], z: w[2], n: 250 + 120 * Math.sqrt(energy), k });
  }

  // --- Klatka ------------------------------------------------------------------

  /**
   * @param {number} dt
   * @param {object} f { time, ship {x, y, angle, len}, originX, originY }
   */
  update(dt, f) {
    this.time = f.time;
    const mining = this.mining;
    const ox = f.originX, oy = f.originY;
    const sp = this.sparks;
    // Iskry wybuchów (scena); wyładowania pioruna kulistego — fioletowe.
    if (this._sparkQueue && sp) {
      for (const q of this._sparkQueue) {
        sp.emit(q.x - ox, q.y + oy, q.z + 40, 0, 0, 1, q.n, { cone: -1, speed: [250, (q.speed || 2200) * Math.min(1.6, q.k)], life: [0.3, 1.3], color: q.color || [3.4, 1.8, 0.7], size: 7 });
      }
      this._sparkQueue.length = 0;
    }
    // Drony.
    const ship = f.ship;
    const sc = Math.cos(ship.angle), ss = Math.sin(ship.angle);
    const aimTop = this.firing && this.target ? this._probeDown(this.target[0], this.target[1]) : null;
    if (this.firing && this.target && !aimTop) {
      // Skała pola pod celem: przejmij (kolejna klatka już trafia w ciało).
      this.activateAt(this.target[0], -this.target[1], f.time);
    }
    this._hits.length = 0;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      let gx, gy, gz;
      if (this.firing && this.target) {
        const a = d.phase + f.time * 0.35;
        gx = this.target[0] + Math.cos(a) * DRONE_RING;
        gy = this.target[1] + Math.sin(a) * DRONE_RING;
        gz = DRONE_Z;
        d.parked = false;
      } else {
        // Dok: nad grzbietem Atlasa, rząd w poprzek.
        const along = -ship.len * 0.18;
        const side = (i - (this.drones.length - 1) / 2) * 110;
        gx = ship.x + sc * along - ss * side;
        gy = -(ship.y + ss * along + sc * side);
        gz = 60;
      }
      if (d.parked && !this.firing) {
        d.p[0] = gx; d.p[1] = gy; d.p[2] = gz; d.v[0] = d.v[1] = d.v[2] = 0;
      } else {
        // Sprężyna krytyczna z limitem prędkości.
        const k = 1 - Math.exp(-5 * dt);
        const wx = (gx - d.p[0]) * 3.2, wy = (gy - d.p[1]) * 3.2, wz = (gz - d.p[2]) * 3.2;
        const lim = 2600 / Math.max(2600, Math.hypot(wx, wy, wz));
        d.v[0] += (wx * lim - d.v[0]) * k; d.v[1] += (wy * lim - d.v[1]) * k; d.v[2] += (wz * lim - d.v[2]) * k;
        d.p[0] += d.v[0] * dt; d.p[1] += d.v[1] * dt; d.p[2] += d.v[2] * dt;
        if (!this.firing && Math.hypot(gx - d.p[0], gy - d.p[1], gz - d.p[2]) < 30) d.parked = true;
      }
      d.laser = null;
      if (this.firing && aimTop && Math.hypot(gx - d.p[0], gy - d.p[1]) < 220) {
        const tz = aimTop.z - mining.cfg.laserRadius * 0.3;
        let dx = this.target[0] - d.p[0], dy = this.target[1] - d.p[1], dz = tz - d.p[2];
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
        const hit = mining.raycast(d.p[0], d.p[1], d.p[2], dx, dy, dz, 8000);
        if (hit) {
          mining.laser(hit.body, hit.x, hit.y, hit.z, dx, dy, dz, DRONE_POWER, dt, this.cargo);
          d.laser = { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, ore: hit.ore };
          this._hits.push(d.laser);
          // Iskry z miejsca cięcia (odbite od powierzchni).
          if (sp && Math.random() < dt * 40) {
            sp.emit(hit.x - ox, hit.y + oy, hit.z, hit.nx, hit.ny, hit.nz, 6, { cone: 0.7, speed: [150, 900], life: [0.15, 0.6], color: [3.2, 1.5, 0.45], size: 4 });
          }
        }
      }
    }
    // Piła.
    this._sawPoint = this._stepSaw(dt);
    if (this._sawPoint && this._sawPoint.hit && sp && Math.random() < dt * 30) {
      const q = this._sawPoint;
      sp.emit(q.x - ox, q.y + oy, q.z + 10, 0, 0, 1, 10, { cone: 0.9, speed: [200, 1100], life: [0.15, 0.5], color: [3.4, 2.2, 1.0], size: 4 });
    }
    // Wiązka ściągająca.
    this._tractorTargets.length = 0;
    this._ballTargets = this._ballTargets || [];
    this._ballTargets.length = 0;
    if (this.tractor) {
      const tx = ship.x, ty = -ship.y, tz = 0;
      const got = mining.tractor(tx, ty, tz, TRACTOR.radius, TRACTOR.capacity, TRACTOR.capture, dt, this.cargo);
      for (const g of got) {
        const res = g.oreRes ? RESOURCES[g.oreRes] : null;
        if (g.ore > 0.05 && res) this._say(`+${fmt1(g.ore)} t: ${res.label.toLowerCase()} (${g.core ? 'kawałek rdzenia' : g.kind === 'body' ? 'odłam' : 'okruch'})`);
      }
      // Pioruny kuliste: z pułapką — chwyt i ściąganie do pułapki, bez — wiązka je detonuje.
      mining.pullBalls(tx, ty, tz, TRACTOR.radius, TRACTOR.capture, dt, this.trap, TRAP_CAP - this.trapped.length);
      const near = [];
      for (const p of mining.pebbles) {
        if (p.display) continue;
        const dd = Math.hypot(p.p[0] - tx, p.p[1] - ty, p.p[2] - tz);
        if (dd < TRACTOR.radius && p.mass <= TRACTOR.capacity) near.push([dd, p.p]);
      }
      for (const b of mining.bodies) {
        const dd = Math.hypot(b.p[0] - tx, b.p[1] - ty, b.p[2] - tz);
        if (dd < TRACTOR.radius && b.mass <= TRACTOR.capacity) near.push([dd, b.p]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < Math.min(12, near.length); i++) this._tractorTargets.push(near[i][1]);
      for (const b of mining.balls) {
        if (b.display) continue;
        if (Math.hypot(b.p[0] - tx, b.p[1] - ty, b.p[2] - tz) < TRACTOR.radius + b.r) this._ballTargets.push(b);
      }
    }
    mining.step(dt);
    this._ballEvents(f);
    // Wiązki (scena).
    const B = this.beams;
    B.begin();
    for (const d of this.drones) {
      if (!d.laser) continue;
      const L = d.laser;
      B.add(d.p[0] - ox, d.p[1] + oy, d.p[2] - 10, L.x - ox, L.y + oy, L.z, 16, 3.2, 1.35, 0.5, 1.4);
      B.add(d.p[0] - ox, d.p[1] + oy, d.p[2] - 10, L.x - ox, L.y + oy, L.z, 5, 6, 5, 4.2, 1.2);
    }
    const sw = this.saw;
    if (sw && (!sw.done || this.time - (sw.doneAt ?? (sw.doneAt = this.time)) < 1.5)) {
      // Rozżarzona szczelina za piłą (stygnie) i sam drut na przedzie.
      const t = sw.t;
      const x0 = sw.x0 + sw.dx * Math.max(0, t - 900), y0 = sw.y0 + sw.dy * Math.max(0, t - 900);
      const x1 = sw.x0 + sw.dx * t, y1 = sw.y0 + sw.dy * t;
      const k = sw.done ? Math.max(0, 1 - (this.time - sw.doneAt) / 1.5) : 1;
      B.add(x0 - ox, y0 + oy, -60, x1 - ox, y1 + oy, -60, 30, 3.0, 1.1, 0.3, 0.55 * k);
      if (!sw.done) {
        const q = this._sawPoint;
        B.add(x1 - ox - sw.nx * 260, y1 + oy - sw.ny * 260, 120, x1 - ox + sw.nx * 260, y1 + oy + sw.ny * 260, 120, 9, 4.5, 4.0, 3.2, 1.0);
        if (q) B.add(x1 - ox, y1 + oy, 120, q.x - ox, q.y + oy, q.z, 7, 5, 3.2, 1.4, 0.9);
      }
    }
    if (this.sawPreview) {
      const [ax, ay, bx, by] = this.sawPreview;
      B.add(ax - ox, ay + oy, 150, bx - ox, by + oy, 150, 8, 0.5, 1.4, 2.4, 0.5);
    }
    if (this.tractor) {
      const sx = ship.x - ox, sy = -ship.y + oy;
      for (const t of this._tractorTargets) {
        const pulse = 0.55 + 0.45 * Math.sin(this.time * 9 + t[0] * 0.01);
        B.add(sx, sy, 20, t[0] - ox, t[1] + oy, t[2], 38, 0.25, 0.6, 1.6, 0.35 * pulse);
      }
      // Pioruny w wiązce: z pułapką — zimna wiązka i klatka pola wokół kuli (zaciska się
      // z chwytem), bez pułapki — rwąca się, fioletowa (plazma się wyrywa).
      for (const b of this._ballTargets) {
        if (!b.alive) continue;
        const bx = b.p[0] - ox, by = b.p[1] + oy, bz = b.p[2];
        if (this.trap) {
          const pulse = 0.7 + 0.3 * Math.sin(this.time * 14 + b.id);
          B.add(sx, sy, 20, bx, by, bz, 56, 0.3, 1.3, 2.6, 0.5 * pulse);
          const R = b.r * (1.9 - 0.6 * b.lock);
          for (let ring = 0; ring < 2; ring++) {
            const tilt = ring ? 0.9 : 0.25;
            const spin = this.time * (ring ? -2.1 : 1.7);
            for (let s2 = 0; s2 < 14; s2++) {
              const a0 = spin + (s2 / 14) * Math.PI * 2, a1 = spin + ((s2 + 1) / 14) * Math.PI * 2;
              const p0 = [Math.cos(a0) * R, Math.sin(a0) * R * Math.cos(tilt), Math.sin(a0) * R * Math.sin(tilt)];
              const p1 = [Math.cos(a1) * R, Math.sin(a1) * R * Math.cos(tilt), Math.sin(a1) * R * Math.sin(tilt)];
              B.add(bx + p0[0], by + p0[1], bz + p0[2], bx + p1[0], by + p1[1], bz + p1[2], 9, 0.5, 1.6, 2.8, 0.55 + 0.45 * b.lock);
            }
          }
        } else {
          const flick = Math.random() < 0.3 ? 0.15 : 1;
          B.add(sx, sy, 20, bx, by, bz, 44, 1.6, 0.5, 2.4, 0.4 * flick);
        }
      }
    }
    B.commit();
    // Pioruny kuliste: kule plazmy i łuki pełzające po nich.
    this.ballView?.update(mining.balls, ox, oy, this.time);
    this._ballArcs(dt);
    // Drony (scena).
    const DM = this.droneMeshes;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      DM.set(i, d.p[0] - ox, d.p[1] + oy, d.p[2], this.time * 0.6 + d.phase);
    }
    DM.commit(this.enabled || this.drones.some((d) => !d.parked) ? this.drones.length : 0);
    // Kursor: skład pod kursorem (skaner) — co 0,1 s (probe liczy głębokość w 48 kierunkach).
    if (!this.enabled || !this.cursor) this.hover = null;
    else if (!this._hoverT || this.time - this._hoverT > 0.1 || this.time < this._hoverT) {
      this._hoverT = this.time;
      this.hover = null;
      const h = this._probeDown(this.cursor[0], this.cursor[1]);
      if (h) {
        const pr = this.mining.probe(h.body, h.x, h.y, h.z - 1);
        this.hover = { hit: h, probe: pr };
      }
    }
  }

  // Zdarzenia fizyki: pioruny kuliste (uwolnienie, wyładowanie, złapanie).
  _ballEvents(f) {
    const ev = this.mining.drainEvents();
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.kind !== 'ball') continue;
      if (e.outcome === 'release') {
        const how = e.how === 'dig' ? 'laser otworzył geodę' : e.how === 'saw' ? 'piła przecięła geodę' : 'wybuch rozbił geodę';
        this._say(`PIORUN KULISTY uwolniony (${how}, E ${fmt1(e.energy)}, wybuch za ${fmt1(e.ball.fuse)} s) — ${this.trap ? 'pułapka gotowa, łap wiązką (T)' : 'bez pułapki magnetycznej (M) wiązka go zdetonuje!'}`);
        this._sparkQueue.push({ x: e.x, y: e.y, z: e.z, n: 160, k: 0.8, color: [2.0, 1.1, 3.4] });
      } else if (e.outcome === 'discharge') {
        this._dischargeFx(e);
      } else if (e.outcome === 'capture') {
        this.trapped.push({ energy: e.energy, t: this.time });
        this._say(`Piorun kulisty w pułapce magnetycznej (E ${fmt1(e.energy)}) · ${this.trapped.length}/${TRAP_CAP}`);
      }
    }
    void f;
  }

  // Wyładowanie: błysk i łuna, fioletowe iskry, pioruny do powierzchni najbliższych skał.
  _dischargeFx(e) {
    const E = e.energy;
    // Bez pomarańczowej łuny wybuchu ładunku (dynamics.explode): wyładowanie plazmy świeci
    // fioletem — błysk i światło z _flashes, iskry jonów, pioruny do skał.
    this._sparkQueue.push({ x: e.x, y: e.y, z: e.z, n: Math.min(1400, 300 + 90 * E), k: 1.3, color: [2.2, 1.3, 3.8], speed: 2600 });
    this._flashes.push({ x: e.x, y: e.y, z: e.z, t0: this.time, E });
    if (this.storm) {
      const near = [];
      for (const b of this.mining.bodies) {
        const d = Math.hypot(b.p[0] - e.x, b.p[1] - e.y, b.p[2] - e.z) - b.boundR;
        if (d < 2400) near.push([d, b]);
      }
      near.sort((a, b) => a[0] - b[0]);
      let made = 0;
      for (let i = 0; i < near.length && made < 4; i++) {
        const b = near[i][1];
        const h = this.mining.raycast(e.x, e.y, e.z, b.p[0] - e.x, b.p[1] - e.y, b.p[2] - e.z, 1e6, b);
        if (!h) continue;
        this.storm._addArc(e.x, -e.y, e.z, h.x, -h.y, h.z, 0.32 + made * 0.06, 1.3);
        made++;
      }
      for (let i = made; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const L = 450 + Math.random() * 800;
        this.storm._addArc(e.x, -e.y, e.z, e.x + Math.cos(a) * L, -(e.y + Math.sin(a) * L), e.z - Math.random() * 250, 0.22 + Math.random() * 0.12, 0.9);
      }
    }
    const where = e.where === 'beam' ? ' — w wiązce, przy statku! Bez pułapki magnetycznej (M) się go nie złapie' : '';
    this._say(`Piorun kulisty wybuchł (E ${fmt1(E)})${where}${e.body ? ' — rozsadził skałę obok' : ''}`);
  }

  // Łuki pełzające po kulach plazmy (ognie świętego Elma; niestabilna — gęściej).
  _ballArcs(dt) {
    const storm = this.storm;
    const balls = this.mining.balls;
    if (!storm || !balls.length) { this._arcT = 0; return; }
    this._arcT += dt;
    while (this._arcT > 0.06) {
      this._arcT -= 0.06;
      for (const b of balls) {
        const ins = ballInstability(b);
        if (Math.random() > 0.35 + 0.5 * ins) continue;
        const a0 = Math.random() * Math.PI * 2;
        const a1 = a0 + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 1.2);
        const r0 = b.r * 0.75;
        const r1 = b.r * (1.05 + Math.random() * (0.5 + ins));
        storm._addArc(b.p[0] + Math.cos(a0) * r0, -(b.p[1] + Math.sin(a0) * r0), b.p[2] + b.r * 0.55,
          b.p[0] + Math.cos(a1) * r1, -(b.p[1] + Math.sin(a1) * r1), b.p[2] + b.r * 0.15, 0.05 + Math.random() * 0.09, 0.28 + 0.2 * ins);
      }
    }
  }

  /** Światła dronów, miejsc cięcia i ładunków (scena). */
  addLights(grid, ox, oy) {
    // Pioruny kuliste: fioletowe (w pułapce — sine) światło, migocze; błyski wyładowań.
    for (const b of this.mining.balls) {
      const ins = ballInstability(b);
      const fl = 0.82 + 0.18 * Math.sin(this.time * (13 + 34 * ins) + b.id);
      const k = (0.55 + 0.3 * Math.cbrt(b.energy)) * fl * (1 + 0.8 * ins);
      const cr = 1.0 - 0.5 * b.lock, cg = 0.55 + 0.35 * b.lock, cb = 1.6 - 0.2 * b.lock;
      // Mało rozpraszania w pyle: pełne robiło fioletową mgłę na cały kadr.
      grid.add(b.p[0] - ox, b.p[1] + oy, b.p[2] + b.r * 0.4, 800 + b.r * 6, cr * k, cg * k, cb * k, 0.06);
    }
    let w = 0;
    for (const fl of this._flashes) {
      const u = (this.time - fl.t0) / 0.8;
      if (u >= 1 || u < 0) continue;
      this._flashes[w++] = fl;
      const k = (1 - u) * (1 - u) * (1.2 + fl.E * 0.15);
      grid.add(fl.x - ox, fl.y + oy, fl.z + 80, 1500 + 110 * fl.E, 1.3 * k, 0.9 * k, 2.2 * k, 0.3);
    }
    this._flashes.length = w;
    for (const d of this.drones) {
      if (d.parked && !this.enabled) continue;
      grid.add(d.p[0] - ox, d.p[1] + oy, d.p[2], 420, 0.35, 0.55, 0.8, 0.05);
      // Reflektor roboczy drona (w dół): oświetla miejsce cięcia i wnętrze otworu.
      if (!d.parked) grid.add(d.p[0] - ox, d.p[1] + oy, d.p[2] - 20, 1400, 1.1, 1.2, 1.3, 0.06, 0, 0, -1, Math.cos(40 * Math.PI / 180), Math.cos(18 * Math.PI / 180), 0.3);
      if (d.laser) {
        const L = d.laser;
        const f = 0.85 + 0.15 * Math.sin(this.time * 47 + d.phase * 5);
        grid.add(L.x - ox + L.nx * 40, L.y + oy + L.ny * 40, L.z + L.nz * 40, 620, 1.7 * f, 0.8 * f, 0.3 * f, 0.18);
      }
    }
    for (const ch of this.charges) {
      if (!ch.body.alive) continue;
      const w = ch.body.localToWorld(ch.local[0], ch.local[1], ch.local[2], [0, 0, 0]);
      const blink = (Math.sin((this.time - ch.t0) * 7) > 0.2 ? 1 : 0.25);
      grid.add(w[0] - ox, w[1] + oy, w[2] + 60, 380, 1.4 * blink, 0.12 * blink, 0.08 * blink, 0.08);
    }
  }

  /** Duszki: żar punktów cięcia, dysze dronów, migające ładunki, poświata piorunów kulistych. */
  addGlows(glow, ox, oy) {
    for (const b of this.mining.balls) {
      const ins = ballInstability(b);
      const fl = 0.8 + 0.2 * Math.sin(this.time * (17 + 40 * ins) + b.id * 3);
      const x = b.p[0] - ox, y = b.p[1] + oy, z = b.p[2] + b.r * 1.05;
      glow.add(x, y, z, b.r * 4.2, (0.22 - 0.1 * b.lock) * fl, (0.1 + 0.12 * b.lock) * fl, 0.42 * fl * (1 + 0.5 * ins), 0);
    }
    for (const fl of this._flashes) {
      const u = (this.time - fl.t0) / 0.8;
      if (u >= 1 || u < 0) continue;
      const k = (1 - u) * (1 - u);
      glow.add(fl.x - ox, fl.y + oy, fl.z + 120, (500 + 70 * fl.E) * (0.6 + u), 3.0 * k, 2.2 * k, 4.5 * k, 0);
    }
    for (const d of this.drones) {
      if (d.parked && !this.enabled) continue;
      glow.add(d.p[0] - ox, d.p[1] + oy, d.p[2] + 12, 26, 0.7, 1.6, 2.6, 0);
      if (d.laser) {
        const L = d.laser;
        glow.add(L.x - ox, L.y + oy, L.z + 20, 55, 3.2, 1.7, 0.7, 0);
      }
    }
    for (const ch of this.charges) {
      if (!ch.body.alive) continue;
      const w = ch.body.localToWorld(ch.local[0], ch.local[1], ch.local[2], [0, 0, 0]);
      const blink = (Math.sin((this.time - ch.t0) * 7) > 0.2 ? 1 : 0.2);
      glow.add(w[0] - ox, w[1] + oy, w[2] + 80, 70, 5 * blink, 0.4 * blink, 0.25 * blink, 0);
    }
  }

  /** Skaner na nakładce 2D: rdzenie ciał, skład pod kursorem, ładunki. */
  drawOverlay(ctx, cam, W, H) {
    if (!this.enabled) return;
    const toScr = (x, y) => [(x - cam.x) * cam.zoom + W * 0.5, (-y - cam.y) * cam.zoom + H * 0.5];
    ctx.save();
    ctx.font = '600 12px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    if (this.scan) {
      for (const b of this.mining.bodies) {
        if (!b.core || !b.oreTypeId) continue;
        // Rdzeń w tym ciele? (odłam bez rdzenia, wysadzony rdzeń, pusta geoda — bez znacznika)
        if (b.massDirty) b.recomputeMass();
        if (!(b.coreMass > 1e-6)) continue;
        if (b.sampleCore(b.core.x, b.core.y, b.core.z) < 0.5 && b.generation > 0) continue;
        const c = b.localToWorld(b.core.x, b.core.y, b.core.z, [0, 0, 0]);
        const [sx, sy] = toScr(c[0], c[1]);
        const rr = Math.max(8, b.core.r * cam.zoom);
        if (sx < -rr || sy < -rr || sx > W + rr || sy > H + rr) continue;
        const plasma = b.core.kind === 'plasma';
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = plasma ? 'rgba(200,150,255,0.9)' : 'rgba(255,200,120,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        const res = RESOURCES[b.oreRes];
        const top = this._probeDown(c[0], c[1]);
        const depth = top ? Math.max(0, top.z - c[2]) : 0;
        const need = chargeForDepth(b.material, depth + b.core.r * 0.3);
        ctx.fillStyle = plasma ? 'rgba(220,180,255,0.98)' : 'rgba(255,215,150,0.95)';
        const what = plasma
          ? 'PIORUN KULISTY — potrzebna pułapka magnetyczna (M)'
          : `${res ? res.label.toLowerCase() : b.oreTypeId} — ${coreLabel(b.core.kind, b.core.oreTypeId)}, ${fmt1(b.coreMass)} t (100%)`;
        ctx.fillText(`RDZEŃ · ${what}`, sx, sy - rr - 18);
        ctx.fillStyle = 'rgba(210,225,235,0.85)';
        ctx.fillText(`głęb. ${Math.round(depth)} j. · ładunek z rdzenia ≥ ${fmt1(need)} · R: wysadź rdzeń`, sx, sy - rr - 4);
      }
    }
    // Pioruny kuliste na wolności: bezpiecznik i stan chwytu.
    for (const b of this.mining.balls) {
      if (b.display) continue;
      const [sx, sy] = toScr(b.p[0], b.p[1]);
      const rr = Math.max(12, b.r * cam.zoom * 1.5);
      if (sx < -rr || sy < -rr || sx > W + rr || sy > H + rr) continue;
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = this.trap ? 'rgba(140,220,255,0.9)' : 'rgba(215,150,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(230,200,255,0.98)';
      ctx.fillText(`PIORUN KULISTY · E ${fmt1(b.energy)} · wybuch za ${fmt1(Math.max(0, b.fuse))} s`, sx, sy - rr - 18);
      ctx.fillStyle = this.trap ? 'rgba(170,230,255,0.95)' : 'rgba(255,170,170,0.95)';
      const state = this.trap
        ? (b.lock > 0.01 ? `pułapka: chwyt ${Math.round(b.lock * 100)}%` : 'pułapka gotowa — wiązka T')
        : 'bez pułapki (M) wiązka go zdetonuje';
      ctx.fillText(state, sx, sy - rr - 4);
    }
    // Kawałki rdzenia w locie (skaner): romb i ruda — do wyłapania wiązką.
    if (this.scan) {
      let marks = 0;
      const mark = (x, y, rr, mass, oreRes) => {
        if (marks >= 40) return;
        const [sx, sy] = toScr(x, y);
        const s = Math.max(7, rr * cam.zoom * 0.9);
        if (sx < -s || sy < -s || sx > W + s || sy > H + s) return;
        marks++;
        ctx.strokeStyle = 'rgba(255,205,120,0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(sx, sy - s); ctx.lineTo(sx + s, sy); ctx.lineTo(sx, sy + s); ctx.lineTo(sx - s, sy); ctx.closePath(); ctx.stroke();
        const res = oreRes ? RESOURCES[oreRes] : null;
        ctx.fillStyle = 'rgba(255,220,160,0.92)';
        ctx.fillText(`${res ? res.short : '?'} ${fmt1(mass)} t`, sx, sy - s - 4);
      };
      for (const p of this.mining.pebbles) {
        if (p.core && !p.display && p.mass >= 0.2) mark(p.p[0], p.p[1], p.r, p.mass, p.oreRes);
      }
      for (const b of this.mining.bodies) {
        if (b.generation > 0 && isCorePiece(b)) mark(b.p[0], b.p[1], b.boundR * 0.7, b.mass, b.oreRes);
      }
    }
    // Galeria rdzeni: podpisy.
    for (const g of this.gallery) {
      const [sx, sy] = toScr(g.p[0], g.p[1]);
      const off = Math.max(10, g.r * cam.zoom) + 14;
      if (sx < -200 || sy < -60 || sx > W + 200 || sy > H + 60) continue;
      ctx.fillStyle = 'rgba(235,225,205,0.95)';
      ctx.fillText(g.text, sx, sy + off);
      ctx.fillStyle = 'rgba(180,200,215,0.85)';
      ctx.fillText(g.sub, sx, sy + off + 14);
    }
    for (const ch of this.charges) {
      if (!ch.body.alive) continue;
      const w = ch.body.localToWorld(ch.local[0], ch.local[1], ch.local[2], [0, 0, 0]);
      const [sx, sy] = toScr(w[0], w[1]);
      ctx.fillStyle = 'rgba(255,120,100,0.95)';
      ctx.fillText(ch.id, sx, sy - 16);
    }
    if (this.hover && this.scan) {
      const { probe, hit } = this.hover;
      const [sx, sy] = toScr(hit.x, hit.y);
      const need = chargeForDepth(hit.body.material, Math.max(probe.depth, this.mining.cfg.laserRadius));
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(200,235,255,0.95)';
      const res = RESOURCES[hit.body.oreRes];
      ctx.fillText(`${probe.zone} · ruda ${Math.round(probe.ore * 100)}%${res ? ` (${res.short})` : ''}`, sx + 16, sy + 4);
      ctx.fillStyle = 'rgba(170,190,205,0.85)';
      ctx.fillText(`ładunek tu: ≥ ${fmt1(need)} · ${ROCK_TYPE_LABELS_PL[hit.body.typeId] || hit.body.typeId}`, sx + 16, sy + 19);
    }
    ctx.restore();
  }

  /** Wiersze HUD-u (tekst). */
  hudLines() {
    if (!this.enabled) return [];
    const ch = CHARGES[this.chargeIndex];
    const lines = [];
    lines.push(`<b>KOPALNIA</b> (G) · LPM laser dronów · Shift+LPM piła · PPM ładunek <b>${ch.id}</b> (${ch.energy}, C) · F detonacja · R wysadź rdzeń · T wiązka ${this.tractor ? '<b>wł.</b>' : 'wył.'} · M pułapka ${this.trap ? '<b>wł.</b>' : 'wył.'} · K skaner · J galeria rdzeni`);
    const ores = Object.entries(this.cargo.ore).filter(([, t]) => t > 0.005);
    const oreTxt = ores.length ? ores.map(([id, t]) => `${RESOURCES[id]?.short || id} ${fmt1(t)} t`).join(' · ') : '—';
    const trapE = this.trapped.reduce((a, b) => a + b.energy, 0);
    lines.push(`ładownia: ${oreTxt} · skała płonna ${fmt1(this.cargo.waste)} t · stracone ${fmt1(this.lost.lost)} t · pułapka: ${this.trapped.length}/${TRAP_CAP} piorunów${this.trapped.length ? ` (E ${fmt1(trapE)})` : ''}`);
    const m = this.mining;
    const free = m.balls.filter((b) => !b.display);
    const coreP = m.pebbles.reduce((a, p) => a + (p.core && !p.display ? 1 : 0), 0);
    lines.push(`ciała ${m.bodies.length} · okruchy ${m.pebbles.length} (rdzenia ${coreP}) · ładunki ${this.charges.length} · wybuch ${fmt1(m.stats.lastBlastMs)} ms${free.length ? ` · <b>pioruny kuliste: ${free.map((b) => `${fmt1(Math.max(0, b.fuse))} s`).join(', ')}</b>` : ''}`);
    for (const msg of this.messages.slice(-3)) {
      if (this.time - msg.t < 9) lines.push(`› ${msg.text}`);
    }
    return lines;
  }

  /** Czy żaden wybuch ani laser nie działa (do testów). */
  idle() {
    return !this.firing && !this.charges.length;
  }
}

// Zasięgi ładunków w materiale (panel, testy): { id, energy, crush, fracture }.
export function chargeTable(typeId) {
  const m = rockMaterial(typeId);
  return CHARGES.map((c) => ({ id: c.id, energy: c.energy, ...chargeReach(m, c.energy) }));
}
