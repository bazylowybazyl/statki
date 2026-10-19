// Render bazy piratów (misja 1, szkic użytkownika z 2026-10-11) — ta sama podstawa co budowle portowe Z7
// (PortBuilding3D: korzeń z ramką układu w macierzy, zestawy BG / FG, grafy TSL raz na tryb światła). Bez własnego
// renderera: gospodarz (gra albo demo) dodaje `root` do Core3D.scene i ustawia warstwy (setLayers: BG 1, FG 2).
//
// Stan na klatkę (update(dt, state)):
//   alarm     0/1 — koguty na masztach, bębnie, szczycie habitatu, magazynie
//   berths    [0/1 × stanowisko] — lampki: zielona = okręt stoi, czerwona = pusto
//   habitat   0..1 — zasilanie bębna i części technicznej (okna); disc — dysku mieszkalnego (gasną od środka)
//   bays      0/1 — hangary dronów (światła startu); fuel, warehouse — zasilanie zbiorników i magazynu
//   daylight, lampPower — lampy budowli
// Zniszczenia jak w suchym doku: breakChunk(id, opts) — kawałek odpada (macierz grupy: dryf, obrót, zniknięcie),
// ramChunk, hideChunk, setChunkSkinned (kawałek rysuje skóra ciała świata), resetChunks. Losowość z haszu kawałka.
import * as THREE from 'three';
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { PortBuilding3D } from './portBuildings3D.js';
import { resolvePortBuildingStyle } from './portBuildingStyle.js';
import { portHubMatrixElements } from './portModuleTraffic.js';
import { createPirateBaseLayout } from './pirateBaseLayout.js';
import { PBASE_BERTH_BITS, PBASE_CH, buildPirateBaseScene } from './pirateBaseScene.js';

// Reflektory w SIATCE ŚWIATEŁ gry (Core3D.fx.lights.point — kadłuby okrętów przy pomostach czytają siatkę).
export const PIRATE_BASE_LIGHT_TUNE = { floodPower: 3.0, scatter: 0.35 };
const LAMP_POWER = 1.25;

const NO_STATE = Object.freeze({});
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const _lp = { x: 0, y: 0 };
const _tick = { daylight: 0.3, lampPower: LAMP_POWER };
const hash = (n) => {
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return s - Math.floor(s);
};
const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _axis = new THREE.Vector3();

export class PirateBase3D extends PortBuilding3D {
  /** @param {object} o  { layout?, style ('pirate'), frame, name } */
  constructor(o = {}) {
    const style = o.style && o.style.palette ? o.style : resolvePortBuildingStyle(o.style || 'pirate');
    const layout = o.layout || createPirateBaseLayout(o.layoutOptions);
    super({ ...o, layout, style, scene: buildPirateBaseScene(layout, style), name: o.name || `Baza piratów ${layout.id}` });
    this.lights = layout.lights;
    this.chunkState = layout.chunks.map((c, i) => ({
      id: c.id, group: c.group, kind: c.kind, box: c.box, index: i,
      broken: false, hidden: false, skinned: false, hold: false, t: 0, life: 0,
      pivot: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 0, 1), omega: 0,
      base: new THREE.Matrix4()
    }));
    this._chunkById = new Map(this.chunkState.map((s) => [s.id, s]));
    this.state = { alarm: 0, habitat: 1, disc: 1, bays: 0, fuel: 1, warehouse: 1, tech: 1, drumQ: [1, 1, 1, 1] };
    this.berths = layout.berths.map(() => 1);
    this.update(0, NO_STATE);
  }

  /** Nowa ramka układu (portModuleFrame w scenie gospodarza) — bryła powstaje na ekranie ładowania. */
  setFrame(frame) {
    this.frame = frame;
    this.root.matrix.fromArray(portHubMatrixElements(frame));
    this.root.matrixWorldNeedsUpdate = true;
  }

  /** Środek kawałka w układzie budowli (x, wysokość świata, z) — z dryfem kawałka odpadającego. */
  chunkCenter(id, out = new THREE.Vector3()) {
    const s = this._chunkById.get(id);
    if (!s) return null;
    if (s.broken) return out.copy(s.pivot).addScaledVector(s.vel, Math.max(0, s.t));
    const b = s.box;
    return out.set((b.x0 + b.x1) / 2, k7HeightToZ((b.y0 + b.y1) / 2), (b.z0 + b.z1) / 2);
  }

  /** Światła siatki gry z masztów (przed renderem); maszt odpadłego kawałka gaśnie. Zwraca liczbę świateł. */
  pushGridLights(lights, toGame) {
    if (!lights || typeof toGame !== 'function') return 0;
    const T = PIRATE_BASE_LIGHT_TUNE;
    let n = 0;
    for (const L of this.lights) {
      if (L.chunk && this.isChunkGone(L.chunk)) continue;
      toGame(L.x, L.z, _lp);
      if (lights.point(_lp.x, _lp.y, L.color[0], L.color[1], L.color[2], T.floodPower, L.range, k7HeightToZ(L.y), T.scatter)) n++;
    }
    return n;
  }

  isChunkBroken(id) { return !!this._chunkById.get(id)?.broken; }
  isChunkGone(id) {
    const s = this._chunkById.get(id);
    return !!(s && (s.broken || s.hidden));
  }

  /** Kawałek odpada: opts { delay, speed (90), spin (0.12), life (45), dir: { x, z } (układ), lift }. */
  breakChunk(id, opts = {}) {
    const s = this._chunkById.get(id);
    if (!s || s.broken || s.hidden) return false;
    const h1 = hash(s.index * 1.7 + 0.3);
    const h2 = hash(s.index * 2.9 + 1.1);
    const h3 = hash(s.index * 4.3 + 2.7);
    this.chunkCenter(id, s.pivot);
    s.base.copy(this.uniforms.uGroup.value[s.group]);
    let dx = Number(opts.dir?.x);
    let dz = Number(opts.dir?.z);
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) { dx = s.pivot.x; dz = s.pivot.z; }
    const dl = Math.hypot(dx, dz) || 1;
    const speed = (Number(opts.speed) || 90) * (0.6 + 0.8 * h1);
    const lift = Number.isFinite(Number(opts.lift)) ? Number(opts.lift) : (h2 - 0.65) * 0.5;
    s.vel.set((dx / dl) * speed, lift * speed, (dz / dl) * speed);
    s.axis.set(h1 - 0.5, h2 - 0.5, h3 - 0.5).normalize();
    s.omega = (Number(opts.spin) || 0.12) * (0.5 + h3) * (h1 < 0.5 ? -1 : 1);
    s.t = -Math.max(0, Number(opts.delay) || 0);
    s.life = Math.max(1, Number(opts.life) || 45);
    s.broken = true;
    return true;
  }

  ramChunk(id, dir, speed = 300) {
    return this.breakChunk(id, { dir, speed: Math.max(120, speed * 0.85), spin: 0.9, life: 25, lift: 0.12 });
  }

  hideChunk(id) {
    const s = this._chunkById.get(id);
    if (!s) return false;
    s.hidden = true;
    return true;
  }

  setChunkSkinned(id, on) {
    const s = this._chunkById.get(id);
    if (!s) return false;
    s.skinned = !!on;
    return true;
  }

  isChunkSkinned(id) { return !!this._chunkById.get(id)?.skinned; }

  /**
   * Statyka kawałka widoczna mimo straty (hidden / skinned), dopóki on = true — skóra odłamów ciała świata jeszcze się
   * piecze (worldBodies3D, wypiek w workerze). Tylko obraz: isChunkGone, światła masztów i przeszkody bez zmian.
   */
  setChunkHold(id, on) {
    const s = this._chunkById.get(id);
    if (!s) return false;
    s.hold = !!on;
    return true;
  }

  resetChunks() {
    for (const s of this.chunkState) {
      s.broken = false;
      s.hidden = false;
      s.skinned = false;
      s.hold = false;
      s.t = 0;
    }
  }

  _groups(dt) {
    const G = this.uniforms.uGroup.value;
    G[0].identity();
    for (const s of this.chunkState) {
      const Mx = G[s.group];
      // hold — kawałek stracony trzymany na miejscu, dopóki skóra jego odłamów się piecze (worldBodies3D; tylko obraz)
      if (!s.hold && (s.hidden || (s.skinned && !s.broken))) {
        Mx.identity();
        Mx.elements[15] = 0;
        continue;
      }
      if (!s.broken || s.hold) {
        Mx.identity();
        continue;
      }
      s.t += dt;
      if (s.t >= s.life) {
        s.hidden = true;
        Mx.identity();
        Mx.elements[15] = 0;
        continue;
      }
      const tt = Math.max(0, s.t);
      Mx.makeTranslation(s.pivot.x + s.vel.x * tt, s.pivot.y + s.vel.y * tt, s.pivot.z + s.vel.z * tt);
      _axis.copy(s.axis);
      Mx.multiply(_m.makeRotationAxis(_axis, s.omega * tt));
      Mx.multiply(_t.makeTranslation(-s.pivot.x, -s.pivot.y, -s.pivot.z));
      Mx.multiply(s.base);
    }
  }

  /** Stan klatki (patrz nagłówek pliku). */
  update(dt, state = NO_STATE) {
    _tick.daylight = state.daylight ?? 0.3;
    _tick.lampPower = state.lampPower ?? LAMP_POWER;
    this.tick(dt, _tick);
    const step = Math.max(0, Number(dt) || 0);
    const st = this.state;
    if (state.alarm !== undefined) st.alarm = state.alarm ? 1 : 0;
    for (const k of ['habitat', 'disc', 'fuel', 'warehouse']) if (state[k] !== undefined) st[k] = clamp01(Number(state[k]));
    // światła wnętrza: głowa wieży i przedziały ćwiartek bębna (bez pól — zasilanie habitatu)
    st.tech = clamp01(Number(state.tech ?? st.habitat));
    for (let q = 0; q < 4; q++) st.drumQ[q] = clamp01(Number(state.drumQ ? state.drumQ[q] : st.habitat));
    if (state.bays !== undefined) st.bays = state.bays ? 1 : 0;
    if (Array.isArray(state.berths)) for (let k = 0; k < this.berths.length; k++) this.berths[k] = state.berths[k] ? 1 : 0;
    this._setChan(PBASE_CH.alarm, st.alarm);
    this._setChan(PBASE_CH.habitat, st.habitat);
    this._setChan(PBASE_CH.disc, st.disc);
    this._setChan(PBASE_CH.bays, st.bays);
    this._setChan(PBASE_CH.fuel, st.fuel);
    this._setChan(PBASE_CH.warehouse, st.warehouse);
    this._setChan(PBASE_CH.tech, st.tech);
    for (let q = 0; q < 4; q++) this._setChan(PBASE_CH.drumQ(q), st.drumQ[q]);
    // lampki stanowisk: maski bitowe (tryb „show”) — zajęte / wolne, 24 bity na kanał
    for (let c = 0; c < 2; c++) {
      let busy = 0;
      let free = 0;
      for (let k = 0; k < PBASE_BERTH_BITS; k++) {
        const i = c * PBASE_BERTH_BITS + k;
        if (i >= this.berths.length) break;
        if (this.berths[i]) busy += 2 ** k;
        else free += 2 ** k;
      }
      this._setChan(PBASE_CH.busy(c), busy);
      this._setChan(PBASE_CH.free(c), free);
    }
    this._groups(step);
  }
}
