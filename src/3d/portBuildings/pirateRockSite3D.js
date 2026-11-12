// Osada na planetoidzie i winda kosmiczna bazy piratów (misja 1) — render i scenariusz zawalenia. Ta sama podstawa
// co baza (PortBuilding3D: grafy TSL raz na tryb światła, zestaw BG), bez własnego renderera: gospodarz dodaje `root`
// (układ bazy, macierz ramki) i `fx.root` (scena) do Core3D.scene, warstwa tła 1 (kamera perspektywy — głębia skały).
//
// Stan:
//   nienaruszona  — kabiny jeżdżą po linie (climberParam), światła biegną po linie, okna i lampy osady świecą;
//   collapse()    — rozpad habitatu (storyGame._chainExplosion): lina puszcza u góry razem z głowicą kotwicy
//                   (pirateRockTether.js — spadek ku środkowi skały, kabiny z węzłami), koguty alarmu, zasilanie gaśnie,
//                   budowle zapadają się po kolei z wybuchami (PIRATE_ROCK_COLLAPSE: stacja dolna → … → kopalnia),
//                   uderzenia głowicy i kabin w powierzchnię = wybuchy, odcinki liny = kurz;
//   reset()       — nowa gra.
// Czas = czas gry (update(dt) z dt = 0 w pauzie i scenach). Macierze grup w układzie bazy (x, h, z).
import * as THREE from 'three/webgpu';
import { PortBuilding3D } from './portBuildings3D.js';
import { resolvePortBuildingStyle } from './portBuildingStyle.js';
import { portHubMatrixElements, portModuleFrame } from './portModuleTraffic.js';
import { PIRATE_ROCK_COLLAPSE, createPirateRockLayout, pirateRockCollapsePose, pirateRockPowerAt, planPirateRockCollapse, pirateRockSurfaceH } from './pirateRockLayout.js';
import { ROCK_CH, buildPirateRockScene, pirateTetherThickness } from './pirateRockScene.js';
import { climberParam, createTetherSim, releaseTetherBottom, resetTetherSim, snapTether, stepTetherSim } from './pirateRockTether.js';
import { PirateRockFx3D } from '../pirateRockFx3D.js';
import { pbHash1 } from './portBuildingScene.js';

const LAMP_POWER = 1.25;
const NO_STATE = Object.freeze({});
const _tick = { daylight: 0.3, lampPower: LAMP_POWER };
const _q0 = new THREE.Quaternion();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _mS = new THREE.Matrix4();
const _mFoot = new THREE.Matrix4();

/** Macierz ruchu sztywnego: punkt p0 z kierunkiem d0 przechodzi w (px, py, pz) z kierunkiem (dx, dy, dz) (układ bazy). */
function rigidFromTo(out, p0, d0, px, py, pz, dx, dy, dz) {
  _v1.set(d0[0], d0[1], d0[2]).normalize();
  _v2.set(dx, dy, dz).normalize();
  _q0.setFromUnitVectors(_v1, _v2);
  out.makeTranslation(px, py, pz);
  out.multiply(_m.makeRotationFromQuaternion(_q0));
  out.multiply(_m2.makeTranslation(-p0[0], -p0[1], -p0[2]));
  return out;
}

function hideMatrix(M) {
  M.identity();
  M.elements[15] = 0;
}

/** M ← M · T(p) · S(s) · T(−p): bryła nagrana przy p rośnie s razy wokół p, potem ruch M. */
function scaleAbout(M, p, s) {
  if (Math.abs(s - 1) < 1e-9) return M;
  _m2.makeTranslation(p[0], p[1], p[2]);
  _m2.multiply(_m.makeScale(s, s, s));
  _m2.multiply(_mS.makeTranslation(-p[0], -p[1], -p[2]));
  return M.multiply(_m2);
}

export class PirateRockSite3D extends PortBuilding3D {
  /** @param {object} o { layout? (createPirateRockLayout), frame, name, layer (1) } */
  constructor(o = {}) {
    const layout = o.layout || createPirateRockLayout();
    const style = resolvePortBuildingStyle('pirate');
    const scene = buildPirateRockScene(layout);
    super({ layout, style, scene, frame: o.frame || portModuleFrame(0, 0, 0), name: o.name || 'Osada na planetoidzie' });
    this.rock = layout;
    this.groupOf = scene.groupOf;
    this.layer = o.layer ?? 1;
    this.setLayers(this.layer, this.layer);
    // obwiednia: lina (także leżąca na skale pod habitatem) i cała osada — siatki w układzie bazy
    this._fixBounds();
    this.sim = createTetherSim(layout);
    this.fx = new PirateRockFx3D(this.layer);
    this.events = planPirateRockCollapse(layout);
    this.buildings = layout.buildings.map((b) => ({
      id: b.id, kind: b.kind, group: this.groupOf.buildings[b.id], frame: b.frame, r: b.r,
      start: -1, dur: 2.5, pose: { sink: 0, squash: 1, tilt: 0 },
      tiltAxis: (() => {
        const a = pbHash1(b.index * 7.7 + 3.1) * Math.PI * 2;
        const F = b.frame;
        return [F.X[0] * Math.cos(a) + F.Z[0] * Math.sin(a), F.X[1] * Math.cos(a) + F.Z[1] * Math.sin(a), F.X[2] * Math.cos(a) + F.Z[2] * Math.sin(a)];
      })()
    }));
    this._byId = new Map(this.buildings.map((b) => [b.id, b]));
    const P = layout.tether.nodes;
    this._n0 = [];
    for (let i = 0; i <= layout.tether.segments; i++) this._n0.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    this._d0 = [];
    for (let i = 0; i < layout.tether.segments; i++) {
      const a = this._n0[i];
      const b = this._n0[i + 1];
      this._d0.push([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    }
    this.clock = 0;
    this.collapseT = -1;
    this._next = 0;
    this.climberGone = new Uint8Array(layout.spec.climbers);
    this.stats = { blasts: 0, impacts: 0 };
    this._onImpact = (kind, node, x, h, z, speed, k) => this._impact(kind, node, x, h, z, speed, k);
    this.update(0, NO_STATE);
  }

  _fixBounds() {
    const L = this.rock;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const take = (x, y, z, pad = 0) => {
      x0 = Math.min(x0, x - pad); x1 = Math.max(x1, x + pad);
      y0 = Math.min(y0, y - pad); y1 = Math.max(y1, y + pad);
      z0 = Math.min(z0, z - pad); z1 = Math.max(z1, z + pad);
    };
    const k = L.k || 1;
    take(L.anchorTop[0], L.anchorTop[1], L.anchorTop[2], 600);
    take(0, pirateRockSurfaceH(L, 0, 0), 0, 1200 * k);
    for (const b of L.buildings) take(b.frame.o[0], b.frame.o[1], b.frame.o[2], b.r + 1000 * k);
    const sphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 800);
    for (const set of Object.values(this.meshes)) for (const m of set) m.geometry.boundingSphere = sphere.clone();
    this.sphere = sphere;
  }

  /** Ramka bazy (portModuleFrame) — ta sama co bryła bazy; początek wybuchów przy stopie windy. */
  setFrame(frame) {
    this.frame = frame;
    this.root.matrix.fromArray(portHubMatrixElements(frame));
    this.root.matrixWorldNeedsUpdate = true;
    // ramka bez soczewki skoku gracza (pirateBaseGame.js mnoży root.matrix przez macierz soczewki) — wybuchy i dym
    // rozpadu (`fx.root` na prawdziwym miejscu) liczą się z niej, nie z przeskalowanego obrazu
    (this._frameM || (this._frameM = new THREE.Matrix4())).copy(this.root.matrix);
    const f = this.rock.foot;
    _v0.set(f[0], f[1], f[2]).applyMatrix4(this._frameM);
    this.fx?.setOrigin(_v0.x, _v0.y, _v0.z);
  }

  /** Punkt układu bazy → scena; normalna (kierunek) → scena (ramka gry — bez soczewki skoku). */
  _toScene(x, h, z, out) { return out.set(x, h, z).applyMatrix4(this._frameM || this.root.matrix); }
  _dirToScene(x, h, z, out) {
    const e = (this._frameM || this.root.matrix).elements;
    return out.set(e[0] * x + e[4] * h + e[8] * z, e[1] * x + e[5] * h + e[9] * z, e[2] * x + e[6] * h + e[10] * z);
  }
  _blastAt(x, h, z, size, nx, nh, nz, dust = false) {
    this._toScene(x, h, z, _v0);
    this._dirToScene(nx, nh, nz, _v1);
    if (dust) this.fx.dust(_v0.x, _v0.y, _v0.z, size, _v1.x, _v1.y, _v1.z);
    else this.fx.blast(_v0.x, _v0.y, _v0.z, size, _v1.x, _v1.y, _v1.z);
    this.stats.blasts++;
  }

  get collapsed() { return this.collapseT >= 0; }

  /** Rozpad: lina puszcza u góry, scenariusz zawalenia osady. Zwraca false, gdy już trwa. */
  collapse() {
    if (this.collapseT >= 0) return false;
    this.collapseT = 0;
    this._next = 0;
    const cs = [];
    for (let k = 0; k < this.climberGone.length; k++) cs.push(climberParam(k, this.clock, this.climberGone.length));
    snapTether(this.sim, cs);
    // zerwanie u góry: błysk pod dyskiem mieszkalnym
    const a = this.rock.anchor;
    this._blastAt(a[0], a[1] + 120, a[2], 520, 0, -1, 0);
    return true;
  }

  reset() {
    this.collapseT = -1;
    this._next = 0;
    resetTetherSim(this.sim, this.rock);
    this.climberGone.fill(0);
    for (const b of this.buildings) { b.start = -1; b.pose.sink = 0; b.pose.squash = 1; b.pose.tilt = 0; }
    this.fx.reset();
    this.stats.blasts = 0;
    this.stats.impacts = 0;
  }

  _impact(kind, node, x, h, z, speed, k) {
    this.stats.impacts++;
    const C = this.rock.center;
    const dx = x - C[0], dh = h - C[1], dz = z - C[2];
    const l = Math.hypot(dx, dh, dz) || 1;
    // głowica i kabiny — rozmiar prawdziwy (należą do habitatu / jeżdżą po linie), kurz odcinka — w grubości liny
    // w tym miejscu; próg prędkości w skali długości liny (pirateRockTether.js — prędkości liny × tether.scale)
    if (kind === 'head') this._blastAt(x, h, z, 1250, dx / l, dh / l, dz / l);
    else if (kind === 'climber') {
      if (k >= 0) this.climberGone[k] = 1;
      this._blastAt(x, h, z, 620, dx / l, dh / l, dz / l);
    } else if (speed > 260 * (this.rock.tether.scale || 1)) {
      this._blastAt(x, h, z, 340 * pirateTetherThickness(this.rock, node / this.rock.tether.segments), dx / l, dh / l, dz / l, true);
    }
  }

  _runEvents() {
    const ev = this.events;
    while (this._next < ev.length && ev[this._next].t <= this.collapseT) {
      const e = ev[this._next++];
      if (e.kind !== 'building') continue;
      const b = this._byId.get(e.id);
      if (!b || b.start >= 0) continue;
      b.start = this.collapseT;
      b.dur = e.dur;
      const F = b.frame;
      const lift = b.r * 0.35;
      this._blastAt(F.o[0] + F.Y[0] * lift, F.o[1] + F.Y[1] * lift, F.o[2] + F.Y[2] * lift, e.blast, F.Y[0], F.Y[1], F.Y[2]);
      if (b.kind === 'foot') releaseTetherBottom(this.sim);
    }
  }

  _buildingMatrix(b, M) {
    if (b.start < 0) { M.identity(); return; }
    const a = (this.collapseT - b.start) / Math.max(0.1, b.dur);
    const p = pirateRockCollapsePose(b.kind, a, b.pose);
    const F = b.frame;
    const o = F.o;
    const n = F.Y;
    const k = this.rock.k || 1;
    const H = b.kind === 'mast' ? 900 * k : b.r * 0.8;
    // wstrząs w pierwszej chwili (styczne)
    const sh = this.collapseT - b.start < 0.35 ? Math.sin((this.collapseT - b.start) * 70) * 14 * k : 0;
    // M = T(o − n·sink·H + X·sh) · R(oś, tilt) · S_n(squash) · T(−o)
    const s = p.squash;
    const nx = n[0], ny = n[1], nz = n[2];
    _m.set(
      1 + (s - 1) * nx * nx, (s - 1) * nx * ny, (s - 1) * nx * nz, 0,
      (s - 1) * ny * nx, 1 + (s - 1) * ny * ny, (s - 1) * ny * nz, 0,
      (s - 1) * nz * nx, (s - 1) * nz * ny, 1 + (s - 1) * nz * nz, 0,
      0, 0, 0, 1
    );
    _v1.set(b.tiltAxis[0], b.tiltAxis[1], b.tiltAxis[2]);
    _m2.makeRotationAxis(_v1, p.tilt);
    M.makeTranslation(o[0] - nx * p.sink * H + F.X[0] * sh, o[1] - ny * p.sink * H + F.X[1] * sh, o[2] - nz * p.sink * H + F.X[2] * sh);
    M.multiply(_m2);
    M.multiply(_m);
    M.multiply(_m2.makeTranslation(-o[0], -o[1], -o[2]));
  }

  _groups() {
    const G = this.uniforms.uGroup.value;
    G[0].identity();
    for (const b of this.buildings) this._buildingMatrix(b, G[b.group]);
    const sim = this.sim;
    const P = sim.pos;
    const segs = this.groupOf.segments;
    if (!sim.snapped) {
      G[this.groupOf.head].identity();
      for (const g of segs) G[g].identity();
    } else {
      // lina pękła pod głowicą: głowica z kikutem (odcinek 0) spada osobno i powoli koziołkuje, odcinki 1 … N − 1 — z węzłów
      const H = G[this.groupOf.head];
      const p0 = this._n0[0];
      _v1.set(this._d0[0][2], 0, -this._d0[0][0]).normalize();
      H.makeTranslation(P[0], P[1], P[2]);
      H.multiply(_m.makeRotationAxis(_v1, 0.22 * this.collapseT));
      H.multiply(_m2.makeTranslation(-p0[0], -p0[1], -p0[2]));
      G[segs[0]].copy(H);
      for (let i = 1; i < segs.length; i++) {
        const a = i * 3;
        rigidFromTo(G[segs[i]], this._n0[i], this._d0[i], P[a], P[a + 1], P[a + 2], P[a + 3] - P[a], P[a + 4] - P[a + 1], P[a + 5] - P[a + 2]);
      }
    }
    // kabiny: nagrane na górnym końcu liny; rosną z grubością liny w swoim miejscu (pirateTetherThickness — z kamery
    // kabina przy stacji dolnej wygląda jak w projekcie)
    const top = this._n0[0];
    const N = this.rock.tether.segments;
    const bottom = this._n0[N];
    const foot = this._byId.get('foot');
    for (let k = 0; k < this.groupOf.climbers.length; k++) {
      const M = G[this.groupOf.climbers[k]];
      if (this.climberGone[k]) { hideMatrix(M); continue; }
      if (!sim.snapped) {
        const s = climberParam(k, this.clock, this.groupOf.climbers.length);
        M.makeTranslation((bottom[0] - top[0]) * s, (bottom[1] - top[1]) * s, (bottom[2] - top[2]) * s);
        scaleAbout(M, top, pirateTetherThickness(this.rock, s));
        continue;
      }
      const node = sim.climberNode[k];
      if (node < 0) {
        // kabina w stacji dolnej: jedzie z zapadającą się stacją
        M.makeTranslation(bottom[0] - top[0], bottom[1] - top[1], bottom[2] - top[2]);
        scaleAbout(M, top, pirateTetherThickness(this.rock, 1));
        if (foot) { this._buildingMatrix(foot, _mFoot); M.premultiply(_mFoot); }
        continue;
      }
      const a = Math.min(N - 1, node) * 3;
      const o = node * 3;
      rigidFromTo(M, top, this._d0[0], P[o], P[o + 1], P[o + 2], P[a + 3] - P[a], P[a + 4] - P[a + 1], P[a + 5] - P[a + 2]);
      scaleAbout(M, top, pirateTetherThickness(this.rock, node / N));
    }
  }

  /** Klatka: state { daylight, sun: punkt Słońca w GRZE, at: punkt osady w grze }. */
  update(dt, state = NO_STATE) {
    const step = Math.max(0, Number(dt) || 0);
    this.clock += step;
    if (this.collapseT >= 0) {
      this.collapseT += step;
      this._runEvents();
      stepTetherSim(this.sim, step, this._onImpact);
    }
    const power = this.collapseT >= 0 ? pirateRockPowerAt(this.collapseT) : 1;
    _tick.daylight = state.daylight ?? 0.3;
    _tick.lampPower = LAMP_POWER * power;
    this.tick(step, _tick);
    this._setChan(ROCK_CH.power, power);
    this._setChan(ROCK_CH.alarm, this.collapseT >= 0 && this.collapseT < PIRATE_ROCK_COLLAPSE.powerTo ? 1 : 0);
    this._setChan(ROCK_CH.lift, this.collapseT >= 0 ? 0 : 1);
    if (state.sun && state.at) this.setSun({ sun: state.sun, at: state.at });
    this._groups();
    this.fx?.update(step);
  }

  /** Siatki do rozgrzewki (budowla + wybuchy). */
  warmupObjects() { return [this.root, ...this.fx.warmupMeshes()]; }
}
