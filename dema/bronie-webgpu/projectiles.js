// dema/bronie-webgpu/projectiles.js
//
// Pociski dema: symulacja na CPU (świat gry, podkroki 240 Hz — railgun 25 000 j/s
// nie przeskakuje burty) i render wszystkich stylów w jednym draw callu
// (addytywne kwady wzdłuż lotu, kształt liczony w shaderze).
//
// Style:
//   TRACER — smugowiec działek (Vulcan, CIWS, autokanony): gorąca kreska + poświata
//   BOLT   — bolt plazmy Heliosa: kapsuła z białym rdzeniem, drgające ciało
//   ION    — igła jonowa Tempesta: rdzeń + dwa łuki skręcone helisą wokół lotu
//   ORB    — pocisk Yamato: kula energii z koroną i ogonem
//   NEEDLE — pocisk railguna (Valkyrie, Mjolnir): bardzo cienka igła + stożek Macha
//   SHELL  — pocisk armatni (Armata, Goliath, ciężki autokanon): rozgrzany walec
//   GLOB   — kula plazmy (Ion Plasma Gatling): falujący glob
//   FLAK   — pocisk flak: krótki, rozżarzony łeb (widać, gdzie pęknie)

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, attributeArray, instanceIndex, positionGeometry,
  varyingProperty, texture, If, select, mix, clamp, smoothstep, exp, pow, sin, cos, max, min, abs, length, sqrt, atan
} from 'three/tsl';

const sq = (x) => x.mul(x);

export const PSTYLE = Object.freeze({ TRACER: 0, BOLT: 1, ION: 2, ORB: 3, NEEDLE: 4, SHELL: 5, GLOB: 6, FLAK: 7 });

const MAX = 4096;
const SUB_DT = 1 / 240;

export class ProjectileSystem {
  constructor({ scene, noise, trails, renderOrder = 55 }) {
    this.trails = trails;
    this.noise = noise;
    this.list = [];
    this.pool = [];
    this.node = attributeArray(MAX * 3, 'vec4').setName('projectiles');
    this.data = this.node.value.array;
    this.U = { time: uniform(0), zoom: uniform(1) };
    this.time = 0;
    this._buildMesh(scene, renderOrder);
  }

  _buildMesh(scene, renderOrder) {
    const U = this.U;
    const Q = this.node;
    const noise = this.noise;
    const vL = varyingProperty('vec4', 'vPrjL');   // wzdłuż [j.], w poprzek [j.], długość, halo
    const vC = varyingProperty('vec4', 'vPrjC');   // barwa, styl
    const vS = varyingProperty('float', 'vPrjS');  // ziarno
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
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
      const halo = vL.w;
      const style = vC.w;
      const col = vC.xyz;
      const seed = vS;
      const t = U.time;
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
      return vec4(max(out.mul(e), vec3(0.0)), 0.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'projectiles';
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /**
   * Nowy pocisk (świat gry). o: { x, y, vx, vy, style, color, width, len, life,
   *   recipe, weapon, trail, pen, power, fuse, fuseRadius, hull, … }
   */
  spawn(o) {
    const p = this.pool.pop() || {};
    Object.assign(p, {
      x: 0, y: 0, vx: 0, vy: 0, style: 0, color: [1, 1, 1], width: 6, len: 20, life: 2, age: 0,
      recipe: null, weapon: null, trail: null, trailOpts: null, pen: 0, penLeft: 0, inside: null, power: 1,
      fuse: 0, fuseRadius: 0, dead: false, seed: Math.random(), light: null, flyAcc: 0, entered: null, travel: 0,
      kerfAcc: 0, target: null, speedLoss: 0.55, noHit: false, hitsTargets: false, owner: null, flakR: 0, streak: 0.004
    }, o);
    p.penLeft = p.pen;
    p.inside = null;
    p.entered = null;
    if (p.trailOpts) {
      const l = Math.hypot(p.vx, p.vy) || 1;
      p.trail = this.trails.begin(p.trailOpts.style, p.x, p.y, p.vx / l, p.vy / l, p.trailOpts);
    }
    this.list.push(p);
    return p;
  }

  /**
   * Krok: ruch w podkrokach, trafienia w kadłuby (hulls) i cele (targets: kule
   * { x, y, r, alive }). cb: { impact(p, hit), kerf(p, pt), exit(p, pt),
   * fuse(p), fly(p, x0, y0, x1, y1, dt), expire(p) }.
   */
  step(dt, hulls, targets, cb) {
    this.time += dt;
    const t0 = this.time - dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const sx = p.x; const sy = p.y;
      let rem = dt;
      while (rem > 1e-6 && !p.dead) {
        const h = Math.min(SUB_DT, rem);
        rem -= h;
        const x0 = p.x; const y0 = p.y;
        let spd = Math.hypot(p.vx, p.vy);
        if (p.inside && p.speedLoss > 0) {
          const k = Math.exp(-p.speedLoss * h * 6);
          p.vx *= k; p.vy *= k;
          spd *= k;
        }
        const x1 = x0 + p.vx * h;
        const y1 = y0 + p.vy * h;
        p.age += h;
        p.travel += spd * h;
        // cele punktowe (drony) — PD i flak
        if (targets && p.hitsTargets && !p.noHit) {
          for (const tg of targets) {
            if (!tg.alive) continue;
            const r = tg.r + (p.fuseRadius || 0);
            const q = segDist(x0, y0, x1, y1, tg.x, tg.y);
            if (q.d < r) {
              p.x = x0 + (x1 - x0) * q.t; p.y = y0 + (y1 - y0) * q.t;
              cb.targetHit(p, tg);
              p.dead = true;
              break;
            }
          }
          if (p.dead) break;
        }
        // kadłuby
        if (p.noHit) {
          p.x = x1; p.y = y1;
        } else if (!p.inside) {
          for (const hull of hulls) {
            if (hull === p.owner) continue;
            const f = hull.raycast(x0, y0, x1, y1, 4);
            if (f >= 0) {
              p.x = x0 + (x1 - x0) * f;
              p.y = y0 + (y1 - y0) * f;
              const hit = cb.impact(p, hull);
              if (p.penLeft > 0 && hit !== false) {
                p.inside = hull;
                p.entered = { x: p.x, y: p.y };
                p.kerfAcc = 0;
              } else {
                p.dead = true;
              }
              break;
            }
          }
          if (!p.dead && !p.inside) { p.x = x1; p.y = y1; }
        } else {
          const hull = p.inside;
          p.x = x1; p.y = y1;
          const segLen = Math.hypot(x1 - x0, y1 - y0);
          p.penLeft -= segLen;
          p.kerfAcc += segLen;
          if (cb.kerf && p.kerfAcc > (p.kerfStep || 22)) { p.kerfAcc = 0; cb.kerf(p, hull, x0, y0); }
          if (!hull.inside(p.x, p.y)) {
            if (cb.exit) cb.exit(p, hull);
            p.inside = null;
          } else if (p.penLeft <= 0 || spd < 300) {
            if (cb.stuck) cb.stuck(p, hull);
            p.dead = true;
          }
        }
        if (p.fuse > 0 && p.age >= p.fuse) {
          if (cb.fuse) cb.fuse(p);
          p.dead = true;
        }
        if (p.age >= p.life) {
          if (cb.expire) cb.expire(p);
          p.dead = true;
        }
      }
      if (cb.fly && !p.dead) cb.fly(p, sx, sy, p.x, p.y, dt);
      if (p.trail) {
        this.trails.advance(p.trail, p.x, p.y, t0, this.time);
        if (p.dead) this.trails.end(p.trail, p.x, p.y, this.time);
      }
      if (p.dead) {
        const last = this.list.pop();
        if (last !== p) this.list[i] = last;
        p.trail = null;
        this.pool.push(p);
      }
    }
  }

  commit(zoom) {
    this.U.time.value = this.time;
    this.U.zoom.value = zoom;
    const D = this.data;
    let n = 0;
    for (const p of this.list) {
      if (n >= MAX) break;
      const spd = Math.hypot(p.vx, p.vy) || 1;
      const dx = p.vx / spd; const dy = p.vy / spd;
      const o = n * 12;
      // długość smugi: stała stylu + krótka smuga ruchu (1/90 s), wzrost na starcie
      const grow = Math.min(1, p.age * 40 + 0.15);
      const len = (p.len + spd * (p.streak ?? 0.004)) * grow;
      D[o] = p.x; D[o + 1] = -p.y; D[o + 2] = 14; D[o + 3] = p.style;
      D[o + 4] = dx; D[o + 5] = -dy; D[o + 6] = len; D[o + 7] = p.width;
      D[o + 8] = p.color[0]; D[o + 9] = p.color[1]; D[o + 10] = p.color[2]; D[o + 11] = p.seed;
      n++;
    }
    const attr = this.node.value;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, Math.max(1, n) * 12);
    attr.needsUpdate = true;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
  }

  clear() {
    for (const p of this.list) { if (p.trail) this.trails.end(p.trail, p.x, p.y, this.time); this.pool.push(p); }
    this.list.length = 0;
  }
}

const _sd = { d: 0, t: 0 };
function segDist(x0, y0, x1, y1, px, py) {
  const dx = x1 - x0; const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-9 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = x0 + dx * t - px; const qy = y0 + dy * t - py;
  _sd.d = Math.hypot(qx, qy);
  _sd.t = t;
  return _sd;
}
