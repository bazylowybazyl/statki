// src/3d/trafficWork3D.js — obraz pracy statków ruchu v2 w bańce (E24): górnicy i złomiarze NPC.
//
// Wejście: ramka pracy z bloku `trafficWork` (`src/render/blocks/trafficWorkBlock.js`; gra liczy ją w
// `src/game/trafficSalvage.js`). Tylko obraz — uszczuplenie pasa i odzysk złomu liczy świat ruchu, a ubytek wraku
// (cięcie węzłów, lina holu) — gra.
//   • GÓRNIK (MINE): drony i lasery platformy wydobywczej gracza na skałach pola — `MiningView` pasa
//     (`asteroidBelt.setNpcWork`, te same partie i materiały, iskry pasa).
//   • CIĘCIE (CUT): dwa palniki od dziobu złomiarza do brzegu wraku (wiązki `BeamLines` z `miningView.js` — ten sam
//     graf, własna siatka w scenie gry), iskry z puli `SparkSystem3D`, odłamki blachy z puli `HullDebris3D`,
//     żar cięcia w siatce świateł (`Core3D.fx.lights.point`).
//   • HOL (TOW): pulsująca wiązka ściągająca od rufy holownika do wraku (jak wiązka platformy); linę rysuje kanwa 2D
//     (`drawTowRopes` — `TowSystem`).
// Jeden rysunek na wszystkie wiązki, pozycje względem początku przy kamerze (`sceneOriginNearCamera`, float32), bez
// alokacji w klatce; losowość obrazu z `fxRandom`. Rozgrzewka: wpis `praca statków ruchu (wiązki)` przy imporcie.

import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { BeamLines } from './asteroids/miningView.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { SparkSystem3D } from './sparkSystem3D.js';
import { HullDebris3D } from './hullDebris3D.js';
import { fxRandom } from './fx/fxRandom.js';
import { WARIANT_INSTANCJI } from './rozgrzewka.js';

const KIND_CUT = 2;
const KIND_TOW = 3;
const BEAM_CAP = 48;

/** Wygląd (strojenie na żywo: `TrafficWork3D.look`). */
export const TRAFFIC_WORK_LOOK = {
  torchWidth: 14, torchCore: 5,
  torchHalo: [3.2, 1.35, 0.5], torchWhite: [6, 5, 4.2],
  sparkRate: 46, sparkSpeed: [160, 820], sparkLife: [0.15, 0.6], sparkSize: 0.35, sparkGain: 1.4,
  sparkColor: [3.2, 1.5, 0.45],
  debrisRate: 1.6, debrisColor: [0.32, 0.33, 0.35],
  light: [1.0, 0.55, 0.2], lightPower: 2.4, lightRange: 1100,
  tractorWidth: 46, tractorColor: [0.25, 0.6, 1.6], tractorK: 0.32
};

const _origin = { x: 0, y: 0 };

class TrafficWorkView {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'TrafficWork';
    this.beams = new BeamLines({ parent: this.group, layer: 0, cap: BEAM_CAP, name: 'TrafficWork:beams' });
    Core3D.scene?.add(this.group);
    this.look = TRAFFIC_WORK_LOOK;
    this.stats = { cut: 0, tow: 0, mine: 0, beams: 0 };
  }

  warmupMeshes() {
    return [this.beams.mesh];
  }

  /**
   * Klatka: `frame` — ramka `trafficWork`, `belt` — pas obrazu (górnicy) albo null, `nowSec` — zegar efektów
   * (`Core3D.frameNowMs() / 1000`), `dt` — czas klatki (0 w pauzie: bez emisji iskier i odłamków).
   */
  update(frame, belt, nowSec, dt) {
    if (belt && typeof belt.setNpcWork === 'function') belt.setNpcWork(frame);
    const beams = this.beams;
    beams.begin();
    const st = this.stats;
    st.cut = 0; st.tow = 0; st.mine = 0;
    const n = frame ? frame.count | 0 : 0;
    if (n) {
      sceneOriginNearCamera(_origin);
      const ox = _origin.x, oy = _origin.y;
      this.group.position.set(ox, oy, 0);
      this.group.updateMatrixWorld();
      for (let i = 0; i < n; i++) {
        const r = frame.list[i];
        if (r.kind === KIND_CUT) { this._cut(r, ox, oy, nowSec, dt); st.cut++; }
        else if (r.kind === KIND_TOW) { this._tow(r, ox, oy, nowSec); st.tow++; }
        else st.mine++;
      }
    }
    beams.commit();
    st.beams = beams.count;
  }

  _cut(r, ox, oy, t, dt) {
    const L = this.look;
    const c = Math.cos(r.angle), s = Math.sin(r.angle);
    const half = r.length * 0.45;
    const bx = r.x + c * half, by = r.y + s * half;
    // Punkt cięcia: brzeg wraku od strony złomiarza, wolno wędruje wzdłuż brzegu (szew cięcia).
    let ux = bx - r.tx, uy = by - r.ty;
    const ul = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= ul; uy /= ul;
    const wob = 0.45 * Math.sin(t * 0.31 + r.id * 0.7);
    const cw = Math.cos(wob), sw = Math.sin(wob);
    const dx = ux * cw - uy * sw, dy = ux * sw + uy * cw;
    const px = r.tx + dx * r.tr * 0.55, py = r.ty + dy * r.tr * 0.55;
    const flick = 0.82 + 0.18 * Math.sin(t * 41 + r.id);
    const side = r.length * 0.07;
    for (let k = -1; k <= 1; k += 2) {
      const ax = bx - s * side * k, ay = by + c * side * k;
      const qx = px + (-dy) * 14 * k, qy = py + dx * 14 * k;
      const lax = ax - ox, lay = -ay - oy, lqx = qx - ox, lqy = -qy - oy;
      this.beams.add(lax, lay, 22, lqx, lqy, 14, L.torchWidth, L.torchHalo[0], L.torchHalo[1], L.torchHalo[2], 1.3 * flick);
      this.beams.add(lax, lay, 22, lqx, lqy, 14, L.torchCore, L.torchWhite[0], L.torchWhite[1], L.torchWhite[2], 1.1 * flick);
    }
    Core3D.fx?.lights?.point(px, py, L.light[0], L.light[1], L.light[2], L.lightPower * flick, L.lightRange, 30);
    if (!(dt > 0)) return;
    let want = L.sparkRate * dt;
    let ns = Math.floor(want);
    if (fxRandom.next() < want - ns) ns++;
    for (let j = 0; j < ns; j++) {
      // Snop od miejsca cięcia na zewnątrz wraku (stożek wokół kierunku do złomiarza).
      const a = Math.atan2(dy, dx) + (fxRandom.next() - 0.5) * 2.2;
      const sp = L.sparkSpeed[0] + fxRandom.next() * (L.sparkSpeed[1] - L.sparkSpeed[0]);
      const life = L.sparkLife[0] + fxRandom.next() * (L.sparkLife[1] - L.sparkLife[0]);
      SparkSystem3D.emit(px, py, Math.cos(a) * sp, Math.sin(a) * sp, life, L.sparkSize * (0.6 + 0.8 * fxRandom.next()), L.sparkGain, L.sparkColor);
    }
    want = L.debrisRate * dt;
    if (fxRandom.next() < want) {
      const a = Math.atan2(dy, dx) + (fxRandom.next() - 0.5) * 1.6;
      const sp = 40 + fxRandom.next() * 120;
      const g = 0.8 + 0.4 * fxRandom.next();
      HullDebris3D.spawn(px, py, Math.cos(a) * sp, Math.sin(a) * sp, L.debrisColor[0] * g, L.debrisColor[1] * g, L.debrisColor[2] * g,
        8 + fxRandom.next() * 14, fxRandom.next() < 0.4, t);
    }
  }

  _tow(r, ox, oy, t) {
    const L = this.look;
    // Zaczep liny od strony wraku (jak `hitchOf` w grze): punkt obrysu holownika w kierunku wraku.
    let ux = r.tx - r.x, uy = r.ty - r.y;
    const ul = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= ul; uy /= ul;
    const half = r.length * 0.5;
    const ax = r.x + ux * half, ay = r.y + uy * half;
    const pulse = 0.55 + 0.45 * Math.sin(t * 6 + r.id * 0.37);
    this.beams.add(ax - ox, -ay - oy, 20, r.tx - ox, -r.ty - oy, 16, L.tractorWidth,
      L.tractorColor[0], L.tractorColor[1], L.tractorColor[2], L.tractorK * pulse * (r.haul ? 1.25 : 1));
  }
}

let _view = null;

/** Wspólny obraz pracy (strona w trybie `off`, worker renderu). */
export function sharedTrafficWork3D() {
  return _view || (_view = new TrafficWorkView());
}

export const TrafficWork3D = {
  get look() { return TRAFFIC_WORK_LOOK; },
  get stats() { return _view ? _view.stats : null; },
  update(frame, belt, nowSec, dt) { sharedTrafficWork3D().update(frame, belt, nowSec, dt); }
};

if (Core3D.warmup && typeof Core3D.warmup.add === 'function') {
  Core3D.warmup.add({ name: 'praca statków ruchu (wiązki)', objects: () => sharedTrafficWork3D().warmupMeshes(), phase: 'loading', variant: WARIANT_INSTANCJI });
  Core3D.warmup.add({ name: 'praca statków ruchu (wiązki, kamery 3D)', objects: () => sharedTrafficWork3D().warmupMeshes(), phase: 'loading', ortho: false, variant: WARIANT_INSTANCJI });
}
