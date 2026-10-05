// Render suchego doku piratów (misja 1) — ta sama podstawa co budowle portowe Z7 (PortBuilding3D: korzeń
// z ramką układu w macierzy, zestawy BG / FG / dach, grafy TSL raz na tryb światła). Bez własnego renderera:
// gospodarz (gra albo demo) dodaje `root` do Core3D.scene i ustawia warstwy (setLayers: BG 1, FG 2).
//
// Stan na klatkę (update(dt, state)):
//   alarm     0/1 — koguty alarmu na trzonie, pylonach, wieżach, złączach i dachu
//   launch    [G-01, G-02, G-03] 0/1 — światła biegnące wylotu na pasie i fartuchu bramy hali
//   gates     [G-01, G-02, G-03] 0..1 — sygnał bramy hali (czerwony → zielony)
//   berths    [0/1 × stanowisko parkingu] — lampki na nabrzeżu: zielona = okręt stoi, czerwona = pusto
//   roofFade  0..1 — dach hali zanika (statek w hali albo alarm: wylot eskorty widać z góry)
//   daylight  0..1 — lampy budowli (reflektory i światła hali na pokładzie i bryłach)
// Zniszczenia (do czasu ciał silnika belek — docs/PLAN-zniszczenia-swiata-3d.md):
//   breakChunk(id, opts) — kawałek odpada: dryfuje i obraca się (macierz grupy), po `life` s znika;
//   ramChunk(id, dir, speed) — staranowana brama / ogrodzenie: lekki kawałek wylatuje w kierunku taranu;
//   hideChunk(id) — kawałek znika od razu (np. gdy jego rolę przejmie ciało silnika zniszczeń);
//   resetChunks() — wszystko na miejscu. Losowość z haszu kawałka (bez Math.random gry).
import * as THREE from 'three';
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { PortBuilding3D } from './portBuildings3D.js';
import { PortHullBuild3D } from './portHullBuild3D.js';
import { resolvePortBuildingStyle } from './portBuildingStyle.js';
import { portHubMatrixElements } from './portModuleTraffic.js';
import { createPirateDryDockLayout } from './pirateDryDockLayout.js';
import { DD_CH, buildPirateDryDockScene } from './pirateDryDockScene.js';

// Reflektory parkingu i światła pochylni w SIATCE ŚWIATEŁ gry (Core3D.fx.lights.point — kadłuby okrętów czytają
// siatkę): moc × barwa świateł układu (layout.lights), zasięg z układu, rozproszenie w ośrodku.
export const DRYDOCK_LIGHT_TUNE = { floodPower: 3.2, hallPower: 2.2, scatter: 0.35 };

// Moc lamp budowli (uPbTime.w — plamy światła reflektorów na pokładzie parkingu, trzonie i w hali).
const DRYDOCK_LAMP_POWER = 1.25;

const NO_STATE = Object.freeze({});
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const _lp = { x: 0, y: 0 };
const _tick = { daylight: 0.3, lampPower: DRYDOCK_LAMP_POWER };
const hash = (n) => {
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return s - Math.floor(s);
};
const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _axis = new THREE.Vector3();

export class PirateDryDock3D extends PortBuilding3D {
  /**
   * @param {object} o  { layout?, layoutOptions?, style ('pirate'), frame, light ('space'), name }
   */
  constructor(o = {}) {
    const style = o.style && o.style.palette ? o.style : resolvePortBuildingStyle(o.style || 'pirate');
    const layout = o.layout || createPirateDryDockLayout(o.layoutOptions);
    super({ ...o, layout, style, scene: buildPirateDryDockScene(layout, style), name: o.name || `Suchy dok ${layout.id}` });
    this.rig = this.scene.rig;
    this.lights = layout.lights;
    this.chunkState = layout.chunks.map((c, i) => ({
      id: c.id, group: c.group, kind: c.kind, box: c.box, index: i,
      broken: false, hidden: false, skinned: false, t: 0, life: 0,
      pivot: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 0, 1), omega: 0,
      base: new THREE.Matrix4()
    }));
    this._chunkById = new Map(this.chunkState.map((s) => [s.id, s]));
    this.alarm = 0;
    this.launch = [0, 0, 0];
    this.gates = [0, 0, 0];
    this.berths = layout.berths.map(() => 1);
    this.roofTarget = 0;
    // pochylnie hali: pancerniki w budowie (stocznia) — ten sam kadłub w budowie co stocznia Z7
    this.hulls = layout.hall.slips.map((s) => new PortHullBuild3D({ slip: s, building: this }));
    for (const h of this.hulls) {
      this.root.add(h.mesh);
      this.meshes.bg.push(h.mesh);
    }
    this.slipState = layout.hall.slips.map((s, i) => ({ hullId: 'pirate_battleship', progress: i === 0 ? 0.46 : 0.8 }));
    // dach zaczyna nieprzezroczysty (materiał dachu powstaje przezroczysty — drugi stan to zanik)
    this._applyRoofFade(0);
    this.update(0, NO_STATE);
  }

  dispose() {
    for (const h of this.hulls) h.dispose();
    super.dispose();
  }

  /**
   * Nowa ramka układu (portModuleFrame w scenie gospodarza) — bryła powstaje na ekranie ładowania, miejsce doku
   * zna dopiero misja. Macierz korzenia jest też uniformem uHub (ten sam obiekt).
   */
  setFrame(frame) {
    this.frame = frame;
    this.root.matrix.fromArray(portHubMatrixElements(frame));
    this.root.matrixWorldNeedsUpdate = true;
  }

  // Rozgrzewka (Core3D.warmup, jak dach K-7): dach w stanie zaniku — przezroczysty, bez zapisu głębi
  // (_applyRoofFade przełącza go przy roofFade) — ten sam graf, drugi pipeline. { meshes, apply → przywróć }.
  roofWarmVariant() {
    const meshes = this.meshes.roof.filter((m) => m.material && m.material.blending !== THREE.CustomBlending);
    return {
      meshes,
      apply(mesh) {
        const m = mesh.material;
        const transparent = m.transparent;
        const depthWrite = m.depthWrite;
        const visible = mesh.visible;
        m.transparent = true;
        m.depthWrite = false;
        mesh.visible = true;
        return () => { m.transparent = transparent; m.depthWrite = depthWrite; mesh.visible = visible; };
      }
    };
  }

  /** Środek kawałka w układzie budowli (x, wysokość świata, z) — z dryfem kawałka odpadającego. */
  chunkCenter(id, out = new THREE.Vector3()) {
    const s = this._chunkById.get(id);
    if (!s) return null;
    if (s.broken) return out.copy(s.pivot).addScaledVector(s.vel, Math.max(0, s.t));
    const b = s.box;
    return out.set((b.x0 + b.x1) / 2, k7HeightToZ((b.y0 + b.y1) / 2), (b.z0 + b.z1) / 2);
  }

  /**
   * Światła siatki gry z reflektorów i świateł hali — na tę klatkę (przed renderem). lights = Core3D.fx.lights,
   * toGame(x, z, out) — punkt układu → świat gry. Maszt odpadłego kawałka gaśnie. Zwraca liczbę świateł.
   */
  pushGridLights(lights, toGame) {
    if (!lights || typeof toGame !== 'function') return 0;
    const T = DRYDOCK_LIGHT_TUNE;
    let n = 0;
    for (const L of this.lights) {
      if (L.chunk && this.isChunkGone(L.chunk)) continue;
      toGame(L.x, L.z, _lp);
      const power = L.kind === 'flood' ? T.floodPower : T.hallPower;
      if (lights.point(_lp.x, _lp.y, L.color[0], L.color[1], L.color[2], power, L.range, k7HeightToZ(L.y), T.scatter)) n++;
    }
    return n;
  }

  isChunkBroken(id) { return !!this._chunkById.get(id)?.broken; }
  /** Kawałka nie ma na miejscu (odpadł albo schowany). */
  isChunkGone(id) {
    const s = this._chunkById.get(id);
    return !!(s && (s.broken || s.hidden));
  }

  /**
   * Kawałek odpada: dryf od doku (prędkość ~speed j/s), obrót (spin rad/s), zniknięcie po `life` s.
   * opts: { delay, speed (90), spin (0.12), life (45), dir: { x, z } — kierunek dryfu w układzie, lift (0..1) }.
   */
  breakChunk(id, opts = {}) {
    const s = this._chunkById.get(id);
    if (!s || s.broken || s.hidden) return false;
    const h1 = hash(s.index * 1.7 + 0.3);
    const h2 = hash(s.index * 2.9 + 1.1);
    const h3 = hash(s.index * 4.3 + 2.7);
    this.chunkCenter(id, s.pivot);
    s.base.copy(this.uniforms.uGroup.value[s.group]);
    const c = this.layout.center;
    let dx = Number(opts.dir?.x);
    let dz = Number(opts.dir?.z);
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) { dx = s.pivot.x - c.x; dz = s.pivot.z - c.z; }
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

  /**
   * Staranowany lekki kawałek (brama, ogrodzenie, pylon): wylatuje w kierunku taranu (dir w układzie budowli)
   * z prędkością rzędu prędkości taranującego, szybko wiruje i znika po 25 s.
   */
  ramChunk(id, dir, speed = 300) {
    return this.breakChunk(id, { dir, speed: Math.max(120, speed * 0.85), spin: 0.9, life: 25, lift: 0.12 });
  }

  hideChunk(id) {
    const s = this._chunkById.get(id);
    if (!s) return false;
    s.hidden = true;
    return true;
  }

  /**
   * Kawałek rysuje SKÓRA CIAŁA ŚWIATA (src/3d/worldBodies3D.js — ciało silnika belek w bańce gracza): statyczna grupa
   * schowana, ale kawałek nie jest „zniknięty” (światła masztu, trafienia statyczne liczy gospodarz po swojemu).
   */
  setChunkSkinned(id, on) {
    const s = this._chunkById.get(id);
    if (!s) return false;
    s.skinned = !!on;
    return true;
  }

  isChunkSkinned(id) { return !!this._chunkById.get(id)?.skinned; }

  resetChunks() {
    for (const s of this.chunkState) {
      s.broken = false;
      s.hidden = false;
      s.skinned = false;
      s.t = 0;
    }
  }

  _groups(dt) {
    const G = this.uniforms.uGroup.value;
    G[0].identity();
    for (const s of this.chunkState) {
      const M = G[s.group];
      if (s.hidden || (s.skinned && !s.broken)) {
        M.identity();
        M.elements[15] = 0;
        continue;
      }
      if (!s.broken) {
        M.identity();
        continue;
      }
      s.t += dt;
      if (s.t >= s.life) {
        s.hidden = true;
        M.identity();
        M.elements[15] = 0;
        continue;
      }
      const tt = Math.max(0, s.t);
      // T(pivot + v·t) · R(oś, ω·t) · T(−pivot) · poza z chwili oderwania
      M.makeTranslation(s.pivot.x + s.vel.x * tt, s.pivot.y + s.vel.y * tt, s.pivot.z + s.vel.z * tt);
      _axis.copy(s.axis);
      M.multiply(_m.makeRotationAxis(_axis, s.omega * tt));
      M.multiply(_t.makeTranslation(-s.pivot.x, -s.pivot.y, -s.pivot.z));
      M.multiply(s.base);
    }
  }

  /** Stan klatki (patrz nagłówek pliku). */
  update(dt, state = NO_STATE) {
    // lampy budowli = reflektory parkingu i światła hali: mocne niezależnie od pory (stocznia pracuje w nocy)
    _tick.daylight = state.daylight ?? 0.3;
    _tick.lampPower = state.lampPower ?? DRYDOCK_LAMP_POWER;
    this.tick(dt, _tick);
    const step = Math.max(0, Number(dt) || 0);
    if (state.alarm !== undefined) this.alarm = state.alarm ? 1 : 0;
    if (Array.isArray(state.launch)) for (let g = 0; g < 3; g++) this.launch[g] = state.launch[g] ? 1 : 0;
    if (Array.isArray(state.gates)) for (let g = 0; g < 3; g++) this.gates[g] = clamp01(Number(state.gates[g]) || 0);
    if (Array.isArray(state.berths)) for (let k = 0; k < this.berths.length; k++) this.berths[k] = state.berths[k] ? 1 : 0;
    if (state.roofFade !== undefined) this.roofTarget = clamp01(Number(state.roofFade) || 0);
    this._setChan(DD_CH.alarm, this.alarm);
    for (let g = 0; g < 3; g++) {
      this._setChan(DD_CH.launch(g), this.launch[g]);
      this._setChan(DD_CH.gate(g), this.gates[g]);
    }
    // lampki stanowisk: maski bitowe (tryb „show”) — zajęte / wolne
    let busy = 0;
    let free = 0;
    for (let k = 0; k < this.berths.length && k < 20; k++) {
      if (this.berths[k]) busy += 2 ** k;
      else free += 2 ** k;
    }
    this._setChan(DD_CH.bays, busy);
    this._setChan(DD_CH.baysFree, free);
    // dach: zanik płynny (jak K-7), bez przełączania materiału przy każdej klatce
    const target = this.roofTarget;
    const fade = step > 0 ? this.roofFade + (target - this.roofFade) * (1 - Math.exp(-2.2 * step)) : target;
    if (Math.abs(fade - this.roofFade) > 1e-4 || (fade !== this.roofFade && (fade === 0 || fade === 1))) this._applyRoofFade(fade);
    if (Array.isArray(state.slips)) for (let i = 0; i < this.slipState.length; i++) this.slipState[i] = state.slips[i] || null;
    for (let i = 0; i < this.hulls.length; i++) this.hulls[i].setState(this.slipState[i], this.time);
    this._groups(step);
  }
}
