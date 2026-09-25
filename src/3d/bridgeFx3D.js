// src/3d/bridgeFx3D.js
//
// Wygląd mostków (src/game/shipBridge.js): okna nadbudówki i wyrzut
// atmosfery z wyrwy. Moduł nie tworzy renderera ani kanwy — podpina się do
// podanej sceny (w grze Core3D.scene), a cząstki wysypuje do wspólnego banku
// Fx3D (fxParticles3D.js), bez nowych pul.
//
// OKNA: jeden InstancedMesh (jedno wywołanie rysowania na wszystkie okręty),
// warstwa 2 (FG, bez maski cieni) jak światła pozycyjne — okna świecą też
// w cieniu planety. Rdzeń okna tuż nad progiem bloomu (0,9), poświata pod nim:
// świecą drobne punkty, nie sylwetka (zakaz obwódki: memory hull-lacquer).
// Z oddali okna gasną (długość okna na ekranie < ~1 px), żeby statek nie
// dostawał mglistej plamy.
//
// WYRZUT ATMOSFERY: w próżni to strumień, nie kłąb — krótki błysk
// rozszczelnienia, wąski strumień wzdłuż tunelu ostrzału (plume), gaz
// rozlatujący się szybko i gasnący bez dymu, iskry i kryształki lodu.
// Siłę i czas daje oś BRIDGE_KILL_TIMELINE (sampleVentStrength).

import * as THREE from 'three';
import { Fx3D, FX_PLANE_Z, coneDir, makeBasis, sp } from './fxParticles3D.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import {
  BRIDGE_KILL_TIMELINE,
  bridgeGridToWorld,
  bridgeHash01,
  bridgePngToWorld,
  bridgeShardIsAlive,
  bridgeWaveDelay,
  sampleVentStrength,
  sampleWindowLight
} from '../game/shipBridge.js';

const WINDOW_Z = 12;               // FG: nad kadłubem, pod lampami pozycyjnymi (13)
const WINDOW_RENDER_ORDER = 51;    // lampy pozycyjne 52, bronie od 55
const WINDOW_CAP = 2048;
const MAX_ROOM_FLASHES_PER_FRAME = 6;

// Strojenie (window.__bridgeFxTune w demie). Pasma HDR zmierzone histogramem
// w demie — patrz docs/PORT-mostki.md.
export const BRIDGE_FX_TUNE = {
  coreGain: 1.8,     // rdzeń okna (liniowo × barwa × jasność)
  haloGain: 0.09,    // poświata na poszyciu — pod progiem bloomu
  haloScale: 1.6,    // zasięg poświaty w szerokościach szczeliny
  minPx: 0.6,        // długość okna na ekranie, przy której gaśnie
  fullPx: 1.8,       // ...i przy której świeci w pełni
  ventScale: 1.0,    // skala strumienia (mnożnik rozmiarów)
  ventGain: 1.0      // jasność strumienia
};

const WINDOW_VERT = `
attribute vec4 aParams;   // x: jasność, y: pół-długość, z: pół-szerokość, w: zasięg poświaty (j. świata)
attribute vec3 aColor;
varying vec2 vLocal;
varying vec4 vParams;
varying vec3 vColor;
void main() {
  vParams = aParams;
  vColor = aColor;
  vLocal = position.xy * vec2(2.0 * (aParams.y + aParams.w), 2.0 * (aParams.z + aParams.w));
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position.xy, 0.0, 1.0);
}
`;

const WINDOW_FRAG = `
uniform float uCoreGain;
uniform float uHaloGain;
varying vec2 vLocal;
varying vec4 vParams;
varying vec3 vColor;
void main() {
  // Odległość ze znakiem od prostokąta szczeliny okna.
  vec2 q = abs(vLocal) - vParams.yz;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float aa = max(fwidth(d), 1e-4);
  float core = 1.0 - smoothstep(-aa, aa, d);
  float halo = exp(-max(d, 0.0) / max(vParams.w * 0.4, 1e-3)) * (1.0 - core);
  float I = vParams.x;
  vec3 col = vColor * I * (core * uCoreGain + halo * uHaloGain);
  float a = clamp(I * (core + halo * 0.5), 0.0, 1.0);
  if (a < 0.002) discard;
  gl_FragColor = vec4(col, a);
}
`;

function setAttrRange(attr, count) {
  if (typeof attr.clearUpdateRanges === 'function') {
    attr.clearUpdateRanges();
    if (count > 0) attr.addUpdateRange(0, count);
  }
}

function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / ((e1 - e0) || 1e-6)));
  return t * t * (3 - 2 * t);
}

const _w = { x: 0, y: 0 };
const _w2 = { x: 0, y: 0 };
const _origin = { x: 0, y: 0 };
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();

// Skala efektów względem Bellatora (długość renderu 624 j.).
function hullFxScale(entity) {
  const g = entity.hexGrid;
  const s = Math.max(Number(entity.visual?.spriteScaleX) || Number(entity.visual?.spriteScale) || 1, 0.0001);
  const len = Math.max(g.srcWidth, g.srcHeight) * s;
  return Math.sqrt(Math.max(0.2, len / 624));
}

export { hullFxScale as bridgeHullFxScale };

/**
 * Krótki błysk pomieszczenia (świat gry, Y w dół) — okno gaśnie, bo heks pod
 * nim zginął. Wspólny dla szczelin okien i okien modelu 3D (bridge3D.js).
 */
export function spawnBridgeRoomFlash(x, y, col, S) {
  if (!Fx3D.ensure()) return;
  const o = sp();
  o.x = x; o.y = -y; o.z = FX_PLANE_Z;
  o.life = 0.16; o.drag = 4;
  o.s0 = 3 * S; o.s1 = 12 * S;
  o.r0 = col[0] * 5; o.g0 = col[1] * 5; o.b0 = col[2] * 5;
  o.r1 = col[0] * 0.6; o.g1 = col[1] * 0.4; o.b1 = col[2] * 0.3; o.mix = 10;
  o.alpha = 0.9; o.fadeIn = 0.004; o.fadeOut = 2.0; o.grow = 0.4;
  Fx3D.glow.spawn(o);
}

export const BridgeFx3D = {
  scene: null,
  mesh: null,
  geometry: null,
  material: null,
  params: null,
  colors: null,
  count: 0,
  stats: { windows: 0, vents: 0, flashes: 0 },

  /** Podpina moduł do sceny (w grze: Core3D.scene). Bez własnego renderera. */
  attach(scene) {
    if (this.scene === scene && this.mesh) return true;
    this.dispose();
    if (!scene) return false;
    this.scene = scene;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.params = new Float32Array(WINDOW_CAP * 4);
    this.colors = new Float32Array(WINDOW_CAP * 3);
    const pAttr = new THREE.InstancedBufferAttribute(this.params, 4);
    const cAttr = new THREE.InstancedBufferAttribute(this.colors, 3);
    pAttr.setUsage(THREE.DynamicDrawUsage);
    cAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aParams', pAttr);
    this.geometry.setAttribute('aColor', cAttr);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCoreGain: { value: BRIDGE_FX_TUNE.coreGain },
        uHaloGain: { value: BRIDGE_FX_TUNE.haloGain }
      },
      vertexShader: WINDOW_VERT,
      fragmentShader: WINDOW_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, WINDOW_CAP);
    this.mesh.name = 'BRIDGE_WINDOWS';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = WINDOW_RENDER_ORDER;
    this.mesh.layers.set(2);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.visible = false;
    scene.add(this.mesh);
    return true;
  },

  /**
   * Raz na klatkę renderu, po ruchu encji. opts:
   *   nowSec — czas symulacji (ta sama oś co commandLostAt / deadAt),
   *   dt     — krok tej klatki w czasie symulacji (emisja strumienia),
   *   zoom   — piksele ekranu na jednostkę świata (kamera gry),
   *   poseOf — (encja) => {x, y, angle} | null: poza renderu, gdy kadłub jest
   *            rysowany z interpolacją (gracz); null = poza fizyczna.
   *   camera — kamera gry tej klatki (początek układu instancji, jak w
   *            Bridge3D); bez niej Core3D.activeCam1.
   */
  update(entities, opts = {}) {
    if (!this.mesh) return;
    const now = Number(opts.nowSec) || 0;
    const dt = Math.max(0, Math.min(0.1, Number(opts.dt) || 0));
    const zoom = Math.max(1e-6, Number(opts.zoom) || 1);
    const poseOf = typeof opts.poseOf === 'function' ? opts.poseOf : null;
    const T = BRIDGE_FX_TUNE;
    this.material.uniforms.uCoreGain.value = T.coreGain;
    this.material.uniforms.uHaloGain.value = T.haloGain;
    // Szczeliny względem początku przy kamerze (sceneOrigin.js): duży kawałek
    // w mesh.position (modelViewMatrix w double), w instancjach małe liczby —
    // okna nie drgają względem kadłuba przy 5–10 mln j.
    const org = sceneOriginNearCamera(_origin, opts.camera || undefined);
    this.mesh.position.set(org.x, org.y, 0);
    const m = this.mesh.instanceMatrix.array;
    const P = this.params;
    const C = this.colors;
    let n = 0;
    let flashes = 0;
    let vents = 0;

    for (let e = 0; e < entities.length; e++) {
      const entity = entities[e];
      const st = entity?.bridgeState;
      const grid = entity?.hexGrid;
      if (!st || !grid || st.grid !== grid || entity.hideHexVisual === true) continue;
      const pose = poseOf ? poseOf(entity) : null;

      // Wyrzut atmosfery — każdy mostek osobno, od chwili jego śmierci.
      for (let b = 0; b < st.bridges.length; b++) {
        const bridge = st.bridges[b];
        if (!bridge.dead || !bridge.vent) continue;
        const age = now - bridge.deadAt;
        if (age < 0 || age > BRIDGE_KILL_TIMELINE.ventEnd) continue;
        if (this._emitVent(entity, bridge, age, dt, pose)) vents++;
      }

      // Kadłub z modelem 3D mostka (bridge3D.js) ma okna na modelu — szczeliny
      // byłyby podwójnymi oknami. Wyrzut atmosfery (wyżej) zostaje tutaj.
      if (st.model3D === true) continue;
      const win = st.windows;
      if (!win || !win.count) continue;
      if (!win.lit) win.lit = new Uint8Array(win.count).fill(1);
      const sx = Math.max(Number(entity.visual?.spriteScaleX) || Number(entity.visual?.spriteScale) || 1, 0.0001);
      const fade = smooth01(T.minPx, T.fullPx, win.length * sx * zoom);
      const age = st.commandLost ? now - st.commandLostAt : -1;
      const baseAngle = pose ? pose.angle : (Number(entity.angle) || 0);
      const halfLen = win.length * 0.5 * sx;
      const halfWid = win.width * 0.5 * sx;
      const halo = win.width * sx * T.haloScale;

      for (let i = 0; i < win.count; i++) {
        const s = win.shard[i];
        if (!bridgeShardIsAlive(grid, s)) {
          // Pomieszczenie wybite: krótki błysk w chwili śmierci heksa pod oknem.
          if (win.lit[i] && flashes < MAX_ROOM_FLASHES_PER_FRAME && fade > 0.05 && age < 0) {
            bridgeGridToWorld(entity, s.gridX + s.deformation.x + win.offX[i], s.gridY + s.deformation.y + win.offY[i], _w, pose);
            this._roomFlash(_w.x, _w.y, win.colorsLinear[win.bridge[i]], hullFxScale(entity));
            flashes++;
          }
          win.lit[i] = 0;
          continue;
        }
        win.lit[i] = 1;
        if (fade <= 0.001 || n >= WINDOW_CAP) continue;
        const own = st.bridges[win.bridge[i]];
        let I;
        if (own && own.dead && !(age >= 0 && own.deadAt >= st.commandLostAt)) {
          // Ten mostek padł wcześniej, statek dowodzi z innego (Atlas): jego
          // okna gasną własną falą od jego wyrwy i już się nie zapalają —
          // także przy późniejszej utracie dowodzenia.
          const delay = own.vent ? bridgeWaveDelay(own.vent.x, own.vent.y, win.px[i], win.py[i], BRIDGE_KILL_TIMELINE.windowWaveSpeed) : 0;
          I = sampleWindowLight(now - own.deadAt, delay, win.seed[i]);
        } else if (age >= 0) {
          I = sampleWindowLight(age, win.delay[i], win.seed[i]);
        } else {
          // Spokojne, lekko nierówne oświetlenie; uszkodzony heks mruga.
          const seed = win.seed[i];
          I = 0.82 + 0.18 * Math.sin(now * (0.7 + seed * 1.3) + seed * 40);
          const hpFrac = s.maxHp > 0 ? s.hp / s.maxHp : 1;
          if (hpFrac < 0.55) {
            const slot = Math.floor(now * (9 + seed * 7));
            if (bridgeHash01(slot, i + 101) < 0.45 * (1 - hpFrac / 0.55) + 0.1) I *= 0.18;
          }
        }
        I *= fade * (win.level ? win.level[i] : 1);
        if (I <= 0.003) continue;
        bridgeGridToWorld(entity, s.gridX + s.deformation.x + win.offX[i], s.gridY + s.deformation.y + win.offY[i], _w, pose);
        const rot = -(baseAngle + win.angle[i]);
        const c = Math.cos(rot);
        const sn = Math.sin(rot);
        const scaleX = 2 * (halfLen + halo);
        const scaleY = 2 * (halfWid + halo);
        const o = n * 16;
        m[o] = c * scaleX; m[o + 1] = sn * scaleX; m[o + 2] = 0; m[o + 3] = 0;
        m[o + 4] = -sn * scaleY; m[o + 5] = c * scaleY; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0;
        m[o + 12] = _w.x - org.x; m[o + 13] = -_w.y - org.y; m[o + 14] = WINDOW_Z; m[o + 15] = 1;
        const col = win.colorsLinear[win.bridge[i]] || win.colorsLinear[0];
        P[n * 4] = I; P[n * 4 + 1] = halfLen; P[n * 4 + 2] = halfWid; P[n * 4 + 3] = halo;
        C[n * 3] = col[0]; C[n * 3 + 1] = col[1]; C[n * 3 + 2] = col[2];
        n++;
      }
    }

    this.count = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      setAttrRange(this.mesh.instanceMatrix, n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      const pAttr = this.geometry.getAttribute('aParams');
      const cAttr = this.geometry.getAttribute('aColor');
      setAttrRange(pAttr, n * 4);
      setAttrRange(cAttr, n * 3);
      pAttr.needsUpdate = true;
      cAttr.needsUpdate = true;
    }
    this.stats.windows = n;
    this.stats.vents = vents;
    this.stats.flashes += flashes;
  },

  _roomFlash(x, y, col, S) {
    spawnBridgeRoomFlash(x, y, col, S);
  },

  // Jedna klatka strumienia z wyrwy mostka. Gaz idzie tunelem ostrzału od
  // wyrwy do wylotu na obrysie kadłuba — nad jasnym kadłubem addytywny opar
  // ginie, więc widoczna część strumienia i chmura rozprężenia są za wylotem.
  _emitVent(entity, bridge, age, dt, pose = null) {
    if (!Fx3D.ensure()) return false;
    const vent = bridge.vent;
    const strength = sampleVentStrength(age) * BRIDGE_FX_TUNE.ventGain;
    const S = hullFxScale(entity) * BRIDGE_FX_TUNE.ventScale;
    bridgePngToWorld(entity, vent.x, vent.y, _w, pose);
    const exitX = Number.isFinite(vent.exitX) ? vent.exitX : vent.x;
    const exitY = Number.isFinite(vent.exitY) ? vent.exitY : vent.y;
    bridgePngToWorld(entity, exitX, exitY, _w2, pose);
    // Kierunek: wyrwa → wylot (albo z PNG, gdy wylot leży w wyrwie).
    let dx = _w2.x - _w.x;
    let dy = _w2.y - _w.y;
    let tunnel = Math.hypot(dx, dy);
    if (tunnel < 1e-3) {
      bridgePngToWorld(entity, vent.x + vent.dirX * 10, vent.y + vent.dirY * 10, _w2, pose);
      dx = _w2.x - _w.x; dy = _w2.y - _w.y;
      tunnel = 0;
      _w2.x = _w.x; _w2.y = _w.y;
    }
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    _dir.set(dx, -dy, 0);
    const vx = Number(entity.vx) || 0;
    const vy = -(Number(entity.vy) || 0);

    // Pierwsza klatka: błysk rozszczelnienia w wyrwie, iskry z wylotu.
    if (!bridge.fxBurst) {
      bridge.fxBurst = true;
      _pos.set(_w.x, -_w.y, FX_PLANE_Z);
      let o = sp();
      o.x = _pos.x; o.y = _pos.y; o.z = _pos.z;
      o.life = 0.12; o.drag = 6;
      o.s0 = 6 * S; o.s1 = 28 * S;
      o.r0 = 7.0; o.g0 = 7.4; o.b0 = 8.2;
      o.r1 = 0.8; o.g1 = 1.1; o.b1 = 1.6; o.mix = 14;
      o.alpha = 1; o.fadeIn = 0.003; o.fadeOut = 2.2; o.grow = 0.35;
      Fx3D.glow.spawn(o);
      _pos.set(_w2.x, -_w2.y, FX_PLANE_Z);
      o = sp();
      o.x = _pos.x; o.y = _pos.y; o.z = _pos.z;
      o.life = 0.4; o.drag = 4;
      o.s0 = 12 * S; o.s1 = 60 * S;
      o.r0 = 1.0; o.g0 = 1.3; o.b0 = 1.8;
      o.r1 = 0.06; o.g1 = 0.1; o.b1 = 0.18; o.mix = 6;
      o.alpha = 0.75; o.fadeIn = 0.01; o.fadeOut = 1.8; o.grow = 0.5;
      Fx3D.glow.spawn(o);
      makeBasis(_dir);
      for (let i = 0; i < 30; i++) {
        coneDir(_d, _dir, 0.5, 0.18);
        const v = (180 + Math.random() * 480) * S;
        _v.set(_d.x * v + vx, _d.y * v + vy, _d.z * v);
        Fx3D.spark.spawn(_pos, _v, 0.35 + Math.random() * 0.7, 0.9 + Math.random() * 0.8, (4 + Math.random() * 9) * S,
          [4.2, 2.8, 1.4], 0.35, 0.08);
      }
    }
    if (strength <= 0.01) return false;

    // Strumień w tunelu (od wyrwy do wylotu) + jęzor za wylotem.
    const g = 0.4 + 1.0 * strength;
    if (tunnel > 4) {
      _pos.set(_w.x, -_w.y, FX_PLANE_Z);
      Fx3D.plume.spawn(_pos, _dir, 0.08, tunnel * 0.9, tunnel, (3 + 4 * strength) * S, (4 + 6 * strength) * S,
        [0.45 * g, 0.62 * g, 0.9 * g], 0.6);
    }
    _pos.set(_w2.x, -_w2.y, FX_PLANE_Z);
    const jetLen = (60 + 170 * strength) * S;
    const jetW = (6 + 12 * strength) * S;
    Fx3D.plume.spawn(_pos, _dir, 0.09, jetLen * 0.55, jetLen, jetW * 0.6, jetW, [0.62 * g, 0.78 * g, 1.0 * g], 0.9);

    // Rozprężenie za wylotem: szybkie cząstki w wąskim stożku; bez dymu —
    // gasną zamiast się kłębić.
    makeBasis(_dir);
    const rate = 170 * strength;
    bridge.fxAcc = (bridge.fxAcc || 0) + rate * dt;
    let count = Math.floor(bridge.fxAcc);
    bridge.fxAcc -= count;
    if (count > 14) count = 14;
    for (let i = 0; i < count; i++) {
      coneDir(_d, _dir, 0.18 + 0.2 * (1 - strength), 0.2);
      const v = (340 + Math.random() * 420) * S * (0.45 + 0.55 * strength);
      const o = sp();
      o.x = _pos.x + _d.x * Math.random() * 10 * S;
      o.y = _pos.y + _d.y * Math.random() * 10 * S;
      o.z = _pos.z;
      o.vx = _d.x * v + vx; o.vy = _d.y * v + vy; o.vz = 0;
      o.life = 0.5 + Math.random() * 0.5; o.drag = 1.5;
      o.s0 = (5 + Math.random() * 5) * S; o.s1 = (34 + Math.random() * 40) * S;
      o.rot = Math.random() * 6.283; o.vrot = (Math.random() - 0.5) * 1.5;
      o.r0 = 0.7; o.g0 = 0.8; o.b0 = 0.95;
      o.r1 = 0.1; o.g1 = 0.13; o.b1 = 0.2; o.mix = 2.4;
      o.alpha = 0.36 + 0.34 * strength; o.fadeIn = 0.02; o.fadeOut = 1.35; o.grow = 0.55;
      Fx3D.vapor.spawn(o);
    }
    // Kryształki lodu — pojedyncze, szybko gasnące punkty w strumieniu.
    const glints = Math.random() < strength ? 2 : (Math.random() < strength ? 1 : 0);
    for (let i = 0; i < glints; i++) {
      coneDir(_d, _dir, 0.3, 0.2);
      const v = (280 + Math.random() * 360) * S;
      const o = sp();
      o.x = _pos.x; o.y = _pos.y; o.z = _pos.z + 0.5;
      o.vx = _d.x * v + vx; o.vy = _d.y * v + vy; o.vz = 0;
      o.life = 0.25 + Math.random() * 0.35; o.drag = 1.1;
      o.s0 = 1.3 * S; o.s1 = 0.6 * S;
      o.r0 = 2.2; o.g0 = 2.5; o.b0 = 3.0;
      o.r1 = 0.4; o.g1 = 0.5; o.b1 = 0.7; o.mix = 5;
      o.alpha = 0.9; o.fadeIn = 0.01; o.fadeOut = 1.5; o.grow = 1;
      Fx3D.glow.spawn(o);
    }
    return true;
  },

  dispose() {
    if (this.mesh && this.scene) this.scene.remove(this.mesh);
    this.geometry?.dispose?.();
    this.material?.dispose?.();
    this.mesh = null;
    this.geometry = null;
    this.material = null;
    this.params = null;
    this.colors = null;
    this.scene = null;
    this.count = 0;
  }
};

if (typeof window !== 'undefined') window.__bridgeFxTune = BRIDGE_FX_TUNE;
