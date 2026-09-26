// src/3d/beltStorm3D.js
//
// Burze energetyczne pasa asteroid — widok. Logika (kiedy i gdzie uderza):
// src/game/asteroidStorms.js. Tu:
//   • pioruny jako wstęgi HDR w passie gry (warstwa 0): cienki biały rdzeń
//     (pasmo 8–12 pod bloom) i fioletowa poświata, lider rośnie od skały,
//     udary powrotne po tej samej ścieżce — jedna siatka, jeden draw call;
//   • błysk = światło pola (FieldLights, dookólne, niebieskawe) w środku
//     pioruna: w mroku gęstego pola rozświetla skały i pył obok (kadłubów
//     nie — shader kadłubów świateł pola nie czyta);
//   • rozbłysk pęknięć skał energetycznych przy uderzeniu (uFieldStrike);
//   • błyski w chmurach głęboko pod płaszczyzną: światło w mgle rozświetla
//     płaty od środka (beltDust3D, rozpraszanie w wierzchołkach).
//
// Pozycje wierzchołków względem kamery (przepisywane co klatkę, początek co
// klatkę — sceneOrigin.js): float32 nie drga przy 5–10 mln j.

import * as THREE from 'three';
import { StormSimulator, buildBoltChains, strikeEnvelope, sheetEnvelope } from '../game/asteroidStorms.js';
import { ENERGY_TYPE } from '../game/asteroidRockKinds.js';
import { fieldLightUniforms, FIELD_STRIKE_CAP } from './fieldLights3D.js';

const MAX_POINTS = 1600;          // punkty wszystkich łańcuchów w klatce
const Z_LIFT = 30;                // wstęga tuż nad osią pioruna (przed skałą, którą łączy)

export const STORM_LOOK = Object.freeze({
  core: [0.86, 0.93, 1.0],        // rdzeń (× coreGain → biel HDR 8–12)
  glow: [0.46, 0.34, 1.0],        // poświata (fiolet ładunku)
  coreGain: 9.0,
  glowGain: 2.0,
  // Błysk w polu: moc, zasięg = flashRangeBase + flashRangeMul × długość pioruna.
  flashColor: [0.72, 0.8, 1.0],
  flashIntensity: 5.0,
  flashRangeBase: 900,
  flashRangeMul: 1.1,
  // Błysk w chmurze (głęboko pod płaszczyzną): fiolet, w pyle rozprasza w pełni.
  sheetColor: [0.55, 0.42, 1.0],
  sheetIntensity: 3.2,
  // Rozlew błysku na pancerzu (typ 2 w pętli lamp kadłuba): moc w szczycie udaru.
  hullFlash: 4
});

const BOLT_VERTEX = /* glsl */`
attribute vec4 aData;   // x = strona (−1..1), y = jasność, z = rdzeń (ułamek szerokości), w = —
varying vec4 vData;
void main() {
  vData = aData;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BOLT_FRAGMENT = /* glsl */`
precision highp float;
uniform vec3 uCore;
uniform vec3 uGlow;
varying vec4 vData;
void main() {
  float x = clamp(abs(vData.x), 0.0, 1.0);
  float cw = max(vData.z, 0.02);
  // Rdzeń: wąski gauss (jedyne miejsce nad progiem bloomu), poświata: szeroki
  // gauss + liniowy brzeg do zera na krawędzi wstęgi.
  float core = exp(-x * x / (cw * cw));
  float glow = exp(-x * x * 5.0) * 0.55 + (1.0 - x) * 0.12;
  vec3 col = (uCore * core + uGlow * glow) * clamp(vData.y, 0.0, 4.0);
  float a = max(col.r, max(col.g, col.b));
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, min(a, 1.0));
}
`;

const _env = { reveal: 0, intensity: 0, stroke: -1 };
const _flash = { x: 0, y: 0, z: 0, color: STORM_LOOK.flashColor, intensity: 0, range: 0, scatter: 0.9 };

export class BeltStorm3D {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {import('../game/asteroidBeltField.js').AsteroidBeltField} o.field
   * @param {object} [o.config] nadpisania STORM_CONFIG
   */
  constructor(o) {
    this.scene = o.scene;
    this.field = o.field;
    this.sim = new StormSimulator(o.config || {}, (o.seed ?? 0x5707) >>> 0);
    this.enabled = true;
    this.look = { ...STORM_LOOK };
    this.intensity = 0;           // burza w kadrze (0..1)
    this._rocks = [];             // skały energetyczne przy kadrze (rekordy z puli)
    this._pool = [];
    // Błyski tej klatki dla pancerzy (hexShips3D.setHexShipWorldLights): rozlew
    // światła na kadłuby obok pioruna — w mroku pola błysk wydobywa okręt.
    this.flashes = [];
    this._flashPool = [];
    this._build();
    this.stats = { rocks: 0, strikes: 0, sheets: 0, points: 0 };
  }

  _build() {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3);
    this.data = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 4), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.data.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aData', this.data);
    this.index = new THREE.BufferAttribute(new Uint16Array(MAX_POINTS * 6), 1);
    this.index.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(this.index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    geo.setDrawRange(0, 0);
    this.uniforms = {
      uCore: { value: new THREE.Vector3() },
      uGlow: { value: new THREE.Vector3() }
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: BOLT_VERTEX,
      fragmentShader: BOLT_FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.AdditiveBlending
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    // Nad skałami gry i smugami reflektorów, pod kadłubami (z = 0).
    this.mesh.renderOrder = 9;
    this.mesh.layers.set(0);
    this.mesh.name = 'beltStormBolts';
    this.geo = geo;
    this.scene.add(this.mesh);
  }

  /** Skały energetyczne warstwy gry przy kadrze (rekordy z puli: id, x, y, z środka, r). */
  _collectRocks(layer, zOf, cx, cy, reachX, reachY) {
    const list = this._rocks;
    list.length = 0;
    if (!layer || !layer.enabled) return list;
    const pool = this._pool;
    layer.forEachLoaded((rock) => {
      if (!rock || rock.type !== ENERGY_TYPE) return;
      if (Math.abs(rock.x - cx) > reachX || Math.abs(rock.y - cy) > reachY) return;
      const i = list.length;
      const rec = pool[i] || (pool[i] = { id: 0, x: 0, y: 0, z: 0, r: 0 });
      rec.id = rock.id; rec.x = rock.x; rec.y = rock.y; rec.r = rock.r;
      // Środek skały pod płaszczyzną (czubek na z ≤ 0).
      rec.z = zOf ? zOf(rock) : -rock.r;
      list.push(rec);
    });
    return list;
  }

  /**
   * @param {object} frame klatka pasa (cam, viewW, viewH, dt, time)
   * @param {object} o
   * @param {import('./rocks/rockLayer3D.js').RockLayer3D} o.layer warstwa skał gry
   * @param {(rock:object) => number} o.zOf z środka skały gry
   * @param {import('./fieldLights3D.js').FieldLights} o.lights światła pola (błyski)
   */
  update(frame, o) {
    const cam = frame.cam;
    const zoom = Math.max(1e-5, cam.zoom || 1);
    const halfW = frame.viewW * 0.5 / zoom;
    const halfH = frame.viewH * 0.5 / zoom;
    // Kandydaci do wyładowań: kadr z małym zapasem (osobno w x i y — kadr jest
    // szeroki) — pioruny mają być widać, poza kadrem zostałby tylko błysk w pyle.
    const reachX = halfW * 1.05 + 400;
    const reachY = halfH * 1.05 + 400;
    const dt = Math.min(0.1, Math.max(0, Number(frame.dt) || 0));
    // Burza w kadrze: najsilniejsza z kilku próbek (brzeg komórki w kadrze też grzmi).
    let storm = 0;
    if (this.enabled) {
      for (let k = 0; k < 5; k++) {
        const sx = k === 0 ? 0 : (k & 1 ? 1 : -1) * halfW * 0.6;
        const sy = k === 0 ? 0 : (k & 2 ? 1 : -1) * halfH * 0.6;
        storm = Math.max(storm, this.field.stormAt(cam.x + sx, cam.y + sy));
      }
    }
    this.intensity = storm;
    const rocks = this.enabled ? this._collectRocks(o.layer, o.zOf, cam.x, cam.y, reachX, reachY) : this._rocks;
    if (!this.enabled) rocks.length = 0;
    this._view = this._view || { x: 0, y: 0, halfW: 0, halfH: 0 };
    this._view.x = cam.x; this._view.y = cam.y; this._view.halfW = halfW * 1.1; this._view.halfH = halfH * 1.1;
    this.sim.update(dt, rocks, storm, this._view);
    this._render(cam, zoom, o.lights);
    this.stats.rocks = rocks.length;
    this.stats.strikes = this.sim.strikes.length;
    this.stats.sheets = this.sim.sheets.length;
  }

  _render(cam, zoom, lights) {
    const L = this.look;
    this.uniforms.uCore.value.set(L.core[0] * L.coreGain, L.core[1] * L.coreGain, L.core[2] * L.coreGain);
    this.uniforms.uGlow.value.set(L.glow[0] * L.glowGain, L.glow[1] * L.glowGain, L.glow[2] * L.glowGain);
    const P = this.pos.array;
    const D = this.data.array;
    const I = this.index.array;
    let nv = 0;
    let ni = 0;
    const now = this.sim.time;
    const cx = cam.x;
    const cy = cam.y;
    this.flashes.length = 0;
    const strikeU = fieldLightUniforms.uFieldStrike.value;
    for (let i = 0; i < FIELD_STRIKE_CAP; i++) strikeU[i].w = 0;
    let slot = 0;
    // Najsilniejsze uderzenia pierwsze w slotach rozbłysku (dwa końce na piorun).
    for (const s of this.sim.strikes) {
      const e = strikeEnvelope(s, now - s.t0, _env);
      if (!(e.intensity > 0.01)) continue;
      if (!s.chains) {
        s.chains = buildBoltChains(s.ax, s.ay, s.az, s.bx, s.by, s.bz, s.seed, {
          levels: s.length > 1600 ? 6 : 5, branches: s.kind === 'cloud' ? 4 : 2 + (s.seed & 1)
        });
      }
      // Szerokość wstęgi [j.]: z długości pioruna, min ~2,5 px na ekranie.
      const halfW = Math.max(2.5 / zoom, Math.min(70, Math.max(24, s.length * 0.012)));
      for (const ch of s.chains) {
        const k = e.intensity * ch.w;
        nv = this._emitChain(ch, e.reveal, k, halfW * (0.55 + 0.45 * ch.w), cx, cy, P, D, I, nv, ni);
        ni = this._ni;
        if (nv >= MAX_POINTS * 2 - 256) break;
      }
      // Błysk w polu: światło w środku ścieżki (ruchome końce nie mają znaczenia).
      if (e.intensity > 0.03) {
        const m = s.chains[0];
        const mid = Math.floor(m.count / 2) * 3;
        const hf = this._flashPool[this.flashes.length] || (this._flashPool[this.flashes.length] = { x: 0, y: 0, color: { r: 0, g: 0, b: 0 }, power: 0, rangeWorld: 0, mean: 1 });
        hf.x = m.points[mid]; hf.y = m.points[mid + 1];
        hf.color.r = L.flashColor[0]; hf.color.g = L.flashColor[1]; hf.color.b = L.flashColor[2];
        hf.power = L.hullFlash * e.intensity;
        hf.rangeWorld = L.flashRangeBase + L.flashRangeMul * s.length;
        this.flashes.push(hf);
      }
      if (lights && e.intensity > 0.03) {
        const m = s.chains[0];
        const mid = Math.floor(m.count / 2) * 3;
        _flash.x = m.points[mid]; _flash.y = m.points[mid + 1]; _flash.z = m.points[mid + 2] + 200;
        _flash.color = L.flashColor;
        _flash.intensity = L.flashIntensity * e.intensity;
        _flash.range = L.flashRangeBase + L.flashRangeMul * s.length;
        _flash.scatter = 0.9;
        lights.addOmni(_flash);
      }
      // Rozbłysk pęknięć skał na obu końcach (skała → pył: tylko początek).
      if (slot < FIELD_STRIKE_CAP && e.stroke >= 0) {
        strikeU[slot++].set(s.ax - cx, -(s.ay - cy), s.az, e.intensity);
        if (slot < FIELD_STRIKE_CAP && s.kind === 'arc') strikeU[slot++].set(s.bx - cx, -(s.by - cy), s.bz, e.intensity);
      }
    }
    // Błyski w chmurach głęboko pod płaszczyzną: samo światło (rozświetla mgłę od środka).
    if (lights) {
      for (const sh of this.sim.sheets) {
        const e = sheetEnvelope(sh, now - sh.t0);
        if (!(e > 0.02)) continue;
        _flash.x = sh.x; _flash.y = sh.y; _flash.z = sh.z;
        _flash.color = L.sheetColor;
        _flash.intensity = L.sheetIntensity * e;
        _flash.range = sh.range;
        _flash.scatter = 1;
        lights.addOmni(_flash);
      }
    }
    this.geo.setDrawRange(0, ni);
    this.mesh.visible = ni > 0;
    if (ni > 0) {
      this.pos.clearUpdateRanges?.();
      this.pos.addUpdateRange?.(0, nv * 3);
      this.data.clearUpdateRanges?.();
      this.data.addUpdateRange?.(0, nv * 4);
      this.index.clearUpdateRanges?.();
      this.index.addUpdateRange?.(0, ni);
      this.pos.needsUpdate = true;
      this.data.needsUpdate = true;
      this.index.needsUpdate = true;
    }
    this.mesh.position.set(cx, -cy, 0);
    this.mesh.updateMatrixWorld(true);
    this.stats.points = nv / 2;
  }

  /**
   * Wstęga łańcucha do reveal (lider): dwa wierzchołki na punkt, rozsunięte
   * w płaszczyźnie gry ⟂ stycznej (kamera patrzy z góry). Scena: x, −y świata.
   */
  _emitChain(ch, reveal, k, halfW, cx, cy, P, D, I, nv, ni) {
    const pts = ch.points;
    const t = ch.t;
    let last = -1;
    for (let i = 0; i < ch.count; i++) {
      if (t[i] <= reveal + 1e-6) last = i;
    }
    if (last < 1 || nv + (last + 1) * 2 > MAX_POINTS * 2) { this._ni = ni; return nv; }
    const base = nv;
    for (let i = 0; i <= last; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(last, i + 1);
      let tx = pts[i1 * 3] - pts[i0 * 3];
      let ty = pts[i1 * 3 + 1] - pts[i0 * 3 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      // Normalna w scenie (y odwrócone): świat (−ty, tx) → scena (−ty, −tx).
      const nx = -ty * halfW;
      const ny = -tx * halfW;
      const x = pts[i * 3] - cx;
      const y = -(pts[i * 3 + 1] - cy);
      const z = pts[i * 3 + 2] + Z_LIFT;
      // Czubek lidera i końce gasną (bez kwadratowego ucięcia).
      const tip = Math.min(1, (last - i + 1) / 3);
      const kk = k * tip;
      for (let side = -1; side <= 1; side += 2) {
        const v = nv * 3;
        P[v] = x + nx * side; P[v + 1] = y + ny * side; P[v + 2] = z;
        const d = nv * 4;
        D[d] = side; D[d + 1] = kk; D[d + 2] = 0.16; D[d + 3] = 0;
        nv++;
      }
    }
    for (let i = 0; i < last; i++) {
      const a = base + i * 2;
      I[ni++] = a; I[ni++] = a + 1; I[ni++] = a + 2;
      I[ni++] = a + 1; I[ni++] = a + 3; I[ni++] = a + 2;
    }
    this._ni = ni;
    return nv;
  }

  setVisible(v) {
    this.enabled = !!v;
    if (!v) {
      this.mesh.visible = false;
      for (const u of fieldLightUniforms.uFieldStrike.value) u.w = 0;
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.material.dispose();
  }
}
