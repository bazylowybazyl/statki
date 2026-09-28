// src/3d/weapons/projectiles.js
//
// Pociski broni — TYLKO RENDER (port `dema/bronie-webgpu/projectiles.js`, zadanie 17):
// wszystkie style w jednym draw callu (addytywne kwady wzdłuż lotu, kształt w shaderze).
// Symulacji dema (240 Hz, trafienia w pole odległości) tu nie ma — pociski prowadzi gra
// (tablica `bullets`, `bulletsAndCollisionsStep`), a fasada (weaponFx.js) co klatkę wpisuje
// ich pozy (pozycja w czasie klatki z SimClock, kierunek i długość z ruchu WZGLĘDEM
// strzelca — agents.md § Nośnik prędkości).
//
// Style:
//   TRACER — smugowiec działek (Vulcan, CIWS, autokanony): gorąca kreska + poświata
//   BOLT   — bolt plazmy Heliosa: kapsuła z białym rdzeniem, drgające ciało
//   ION    — igła jonowa Tempesta: rdzeń + dwa łuki skręcone helisą wokół lotu
//   ORB    — pocisk Yamato: kula energii z koroną i ogonem
//   NEEDLE — pocisk railguna (Valkyrie, Mjolnir, Hexlance): cienka igła + stożek Macha
//   SHELL  — pocisk armatni (Armata, Goliath, autokanony): rozgrzany walec
//   GLOB   — kula plazmy (Ion Plasma Gatling): falujący glob
//   FLAK   — pocisk flak: krótki, rozżarzony łeb

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, attributeArray, instanceIndex, positionGeometry,
  varyingProperty, texture, If, mix, clamp, smoothstep, exp, sin, max, abs, length, atan
} from 'three/tsl';
import { additiveMaterial } from './gpuFx.js';
import { liveRangeAttribute, markRange } from './liveRange.js';

const sq = (x) => x.mul(x);

export const PSTYLE = Object.freeze({ TRACER: 0, BOLT: 1, ION: 2, ORB: 3, NEEDLE: 4, SHELL: 5, GLOB: 6, FLAK: 7 });

/** Najwięcej pocisków w jednym draw callu (bitwa: setki — PROJEKT-BRONI §4, ≤ 4096). */
export const PROJECTILE_MAX = 4096;
const FLOATS = 12;   // 3 × vec4 na pocisk

export class ProjectileSystem {
  /**
   * @param {object} o
   * @param {THREE.Texture} o.noise
   * @param {import('../fx/gpuPoolOrigin.js').FxPoolOrigin} o.origin
   */
  constructor({ noise, origin, renderOrder = 55 }) {
    this.noise = noise;
    this.origin = origin;
    this.node = attributeArray(PROJECTILE_MAX * 3, 'vec4').setName('wfxProjectiles');
    this.data = this.node.value.array;
    liveRangeAttribute(this.node.value);
    this.U = { zoom: uniform(1).setName('wfxPrjZoom') };
    this.count = 0;
    this.renderOrder = renderOrder;
    this.mesh = null;
  }

  build(scene) {
    if (this.mesh) return this;
    const U = this.U;
    const Q = this.node;
    const noise = this.noise;
    const T = this.origin.timeFx;
    const vL = varyingProperty('vec4', 'vWfxPrjL');   // wzdłuż [j.], w poprzek [j.], długość, halo
    const vC = varyingProperty('vec4', 'vWfxPrjC');   // barwa, styl
    const vS = varyingProperty('float', 'vWfxPrjS');  // ziarno
    const mat = additiveMaterial('wfxProjectiles');
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(3)).toVar();
      const A = Q.element(i).toVar();
      const B = Q.element(i.add(uint(1))).toVar();
      const C = Q.element(i.add(uint(2))).toVar();
      const g = positionGeometry.xy;
      const len = B.z;
      // halo = połowa szerokości, ale nie mniej niż 1,4 px (daleki zoom)
      const halo = max(B.w.mul(0.5), float(1.4).div(U.zoom)).toVar();
      const along = mix(len.add(halo).negate(), halo, g.x.add(0.5));
      const across = g.y.mul(2.0).mul(halo);
      const dir = B.xy;
      const perp = vec2(dir.y.negate(), dir.x);
      vL.assign(vec4(along, across, len, halo));
      vC.assign(vec4(C.xyz, A.w));
      vS.assign(C.w);
      return vec3(A.xy.add(dir.mul(along)).add(perp.mul(across)), A.z);
    })();
    mat.fragmentNode = Fn(() => {
      const along = vL.x;
      const across = vL.y;
      const len = max(vL.z, 1e-3);
      const halo = max(vL.w, 1e-3);
      const style = vC.w;
      const col = vC.xyz;
      const seed = vS;
      const t = T;
      // odległość od odcinka [ogon −len … głowa 0]
      const ax = clamp(along, len.negate(), 0.0);
      const d = length(vec2(along.sub(ax), across)).toVar();
      const ta = clamp(along.add(len).div(len), 0.0, 1.0).toVar();   // 0 ogon → 1 głowa
      const dh = length(vec2(along, across)).toVar();                 // od głowy
      const e = float(1.0).sub(smoothstep(0.75, 1.0, dh.div(halo.add(len)).max(abs(across).div(halo)))).toVar();
      const out = vec3(0.0).toVar();
      If(style.lessThan(0.5), () => {
        // TRACER
        const core = exp(sq(d.div(halo.mul(0.16))).negate()).mul(ta.mul(ta).mul(0.85).add(0.15));
        const glow = exp(sq(d.div(halo.mul(0.5))).negate()).mul(ta).mul(0.22);
        const tip = exp(sq(dh.div(halo.mul(0.22))).negate());
        out.assign(col.mul(core.mul(1.6).add(glow)).add(vec3(1.0, 0.95, 0.85).mul(tip.mul(2.5))));
      }).ElseIf(style.lessThan(1.5), () => {
        // BOLT — kapsuła plazmy
        const n = texture(noise, vec2(along.div(halo).mul(0.12).sub(t.mul(2.3)), across.div(halo).mul(0.2).add(seed))).r;
        const body = exp(sq(d.div(halo.mul(0.42))).negate()).mul(n.mul(0.6).add(0.6)).mul(ta.mul(0.75).add(0.25));
        const core = exp(sq(d.div(halo.mul(0.14))).negate()).mul(ta.mul(ta));
        const glow = exp(sq(d.div(halo.mul(0.9))).negate()).mul(0.16);
        out.assign(col.mul(body.add(glow)).add(vec3(1.0, 0.85, 0.9).mul(core.mul(3.2))));
      }).ElseIf(style.lessThan(2.5), () => {
        // ION — igła + dwa łuki helisy wokół toru
        const core = exp(sq(d.div(halo.mul(0.1))).negate()).mul(ta.mul(0.8).add(0.2));
        const env = sin(ta.mul(3.14159)).mul(ta.mul(0.6).add(0.4));
        const ph = along.div(halo).mul(0.9).sub(t.mul(38.0)).add(seed.mul(6.28));
        const a1 = across.sub(sin(ph).mul(halo).mul(0.42).mul(env));
        const a2 = across.sub(sin(ph.add(3.14159)).mul(halo).mul(0.42).mul(env));
        const jit = texture(noise, vec2(along.div(halo).mul(0.35).sub(t.mul(9.0)), seed)).b.mul(0.8).add(0.5);
        const arcs = exp(sq(a1.div(halo.mul(0.055))).negate()).add(exp(sq(a2.div(halo.mul(0.055))).negate())).mul(env).mul(jit);
        const sheath = exp(sq(d.div(halo.mul(0.45))).negate()).mul(ta).mul(0.28);
        const tip = exp(sq(dh.div(halo.mul(0.3))).negate());
        out.assign(col.mul(sheath.add(arcs.mul(0.9))).add(vec3(1.2, 1.6, 2.0).mul(core.mul(2.4).add(tip.mul(2.2)))));
      }).ElseIf(style.lessThan(3.5), () => {
        // ORB — Yamato: kula energii z koroną i ogonem
        const r = dh.div(halo).toVar();
        const ang = atan(across, along);
        const n = texture(noise, vec2(ang.mul(0.32).add(t.mul(0.9)), r.mul(0.5).sub(t.mul(1.7)).add(seed))).r;
        const core = exp(sq(r.div(0.2)).negate());
        const mid = exp(sq(r.div(0.42)).negate()).mul(n.mul(0.7).add(0.5));
        const corona = exp(sq(r.div(0.75)).negate()).mul(n.mul(n)).mul(0.5);
        const tail = exp(sq(d.div(halo.mul(0.28))).negate()).mul(ta.mul(ta)).mul(0.7);
        out.assign(vec3(1.3, 1.5, 1.6).mul(core.mul(3.0)).add(col.mul(mid.add(corona).add(tail))));
      }).ElseIf(style.lessThan(4.5), () => {
        // NEEDLE — igła railguna + stożek Macha za głową
        const core = exp(sq(d.div(halo.mul(0.06))).negate()).mul(ta.mul(0.7).add(0.3));
        const behind = max(along.negate(), 0.0);
        const cone = exp(sq(abs(across).sub(behind.mul(0.16)).div(halo.mul(0.05))).negate())
          .mul(exp(behind.div(halo.mul(3.5)).negate())).mul(smoothstep(0.0, halo.mul(0.3), behind));
        const glow = exp(sq(d.div(halo.mul(0.35))).negate()).mul(ta).mul(0.25);
        const tip = exp(sq(dh.div(halo.mul(0.18))).negate());
        out.assign(col.mul(glow.add(cone.mul(0.55))).add(vec3(1.5, 1.8, 2.0).mul(core.mul(2.6).add(tip.mul(2.6)))));
      }).ElseIf(style.lessThan(5.5), () => {
        // SHELL — rozgrzany walec + żar łba
        const body = exp(sq(d.div(halo.mul(0.3))).negate()).mul(ta.mul(0.8).add(0.2));
        const tip = exp(sq(dh.div(halo.mul(0.3))).negate());
        const glow = exp(sq(d.div(halo.mul(0.8))).negate()).mul(0.15);
        out.assign(col.mul(body.add(glow)).add(vec3(1.6, 1.3, 0.9).mul(tip.mul(2.2))));
      }).ElseIf(style.lessThan(6.5), () => {
        // GLOB — falujący glob plazmy
        const ang = atan(across, along);
        const n = texture(noise, vec2(ang.mul(0.32).add(seed), t.mul(1.4))).r;
        const r = dh.div(halo.mul(n.mul(0.35).add(0.75))).toVar();
        const body = exp(sq(r.div(0.5)).negate()).mul(1.1);
        const core = exp(sq(r.div(0.2)).negate());
        const tail = exp(sq(d.div(halo.mul(0.3))).negate()).mul(ta.mul(ta)).mul(0.5);
        out.assign(col.mul(body.add(tail)).add(vec3(1.2, 1.6, 1.6).mul(core.mul(2.4))));
      }).Else(() => {
        // FLAK — krótki łeb z iskrzeniem
        const body = exp(sq(d.div(halo.mul(0.25))).negate()).mul(ta);
        const tip = exp(sq(dh.div(halo.mul(0.3))).negate());
        const twinkle = sin(t.mul(60.0).add(seed.mul(20.0))).mul(0.3).add(0.85);
        out.assign(col.mul(body.mul(0.9)).add(vec3(1.6, 1.4, 1.0).mul(tip.mul(2.4).mul(twinkle))));
      });
      const c = max(out.mul(e), vec3(0.0)).toVar();
      return vec4(c, max(c.x, max(c.y, c.z)));
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = this.renderOrder;
    this.mesh.name = 'wfxProjectiles';
    this.mesh.count = 2;
    this.mesh.visible = false;
    if (scene) scene.add(this.mesh);
    return this;
  }

  begin() { this.count = 0; }

  /**
   * Pocisk na tę klatkę: lx, ly — pozycja głowy w układzie LOKALNYM (scena − początek pul),
   * dirX, dirY — kierunek smugi w scenie (jednostkowy), len — długość smugi [j.],
   * width — szerokość [j.], barwa HDR, ziarno. Zwraca false, gdy bufor pełny.
   */
  add(lx, ly, z, style, dirX, dirY, len, width, r, g, b, seed) {
    if (this.count >= PROJECTILE_MAX) return false;
    const o = this.count++ * FLOATS;
    const D = this.data;
    D[o] = lx; D[o + 1] = ly; D[o + 2] = z; D[o + 3] = style;
    D[o + 4] = dirX; D[o + 5] = dirY; D[o + 6] = len; D[o + 7] = width;
    D[o + 8] = r; D[o + 9] = g; D[o + 10] = b; D[o + 11] = seed;
    return true;
  }

  /** Wysyłka na GPU (tylko zajęta część) i liczba instancji (≥ 2 — stały klucz programu). */
  commit(zoom) {
    const n = this.count;
    this.U.zoom.value = Math.max(1e-4, zoom);
    const mesh = this.mesh;
    if (!mesh) return;
    if (n === 1) {
      // Druga instancja bez barwy (niewidoczna) — liczba instancji 1 ↔ > 1 zmienia klucz programu.
      const D = this.data;
      for (let k = FLOATS; k < FLOATS * 2; k++) D[k] = 0;
    }
    if (n > 0) markRange(this.node.value, 0, Math.max(2, n) * FLOATS);
    mesh.count = Math.max(2, n);
    mesh.visible = n > 0;
  }

  /** Siatka na początku pul (rysunek w pozycjach lokalnych). */
  place(originX, originY) {
    if (!this.mesh) return;
    this.mesh.position.set(originX, originY, 0);
    this.mesh.updateMatrixWorld(true);
  }
}
