// src/3d/spaceGas/spaceGasDust.js
//
// PYŁ GAZU (docs/PLAN-gazy-kosmos.md GK-4; D2 2026-10-22: drobiny zostają, 80 tys. na Wysokiej): drobiny TAM, GDZIE GAZ —
// rodzą się z gęstości pola (losowa komórka w kadrze przyjęta z prawdopodobieństwem (ρ / ρ₀)³, do 6 prób na klatkę),
// lecą z prędkością gazu, gasną po swoim życiu, szybciej w rzednącym gazie; poza oknem pola i w komórce stałej giną.
// 1:1 z dema (dustStep / dust), poza układem: pozycje WZGLĘDEM ROGU OKNA POLA (świat gry, y w dół) — liczby
// rzędu 0…N·64, bez float32 przy 1,6 mln j. od Słońca (dema: pył stał przy 8 mln j.). Przesunięcie okna przesuwa
// drobiny o tyle samo w tym samym kroku (`shift`); siatka stoi w `mesh.position` = róg okna (double).
// `SpaceDust3D` (pył kosmiczny — wrażenie lotu) zostaje bez zmian: ten pył jest tylko w gazie.
//
// Obraz: kwad instancji (Mesh + InstancedBufferGeometry, wierzchołki z buforów storage), mieszanie addytywne,
// w passie ortho po dolnej połowie gazu, przed efektami (górna połowa gazu przygasza go jak efekty — `Ttop` dema).
// Światło: Słońce z mapy światła (samocień gazu) × maska słońca Core3D (fragment), światła siatki Core3D.fx.grid
// w wierzchołkach, odrobina otoczenia. Kłęby (10% drobin) — duże i ciemne, drobiny — małe.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Return, float, int, uint, vec2, vec3, vec4, uniform, instancedArray, instanceIndex, hash, texture,
  positionGeometry, varyingProperty, mix, smoothstep, saturate, exp, min, max, dot, select
} from 'three/tsl';
import { billboardOffset } from '../tsl/billboard3D.js';
import { blendAddytywnePremul } from '../tsl/mieszanie.js';
import { sunVisibility } from '../sunShadowMask.js';

/** Kolejka passa ortho: po dolnej połowie gazu (−45), przed efektami gry (≥ 0). */
export const SPACE_GAS_DUST_ORDER = -40;

export class SpaceGasDust {
  /**
   * @param {import('./spaceGasSim.js').SpaceGasSim} sim
   * @param {import('./spaceGasMaps.js').SpaceGasMaps} maps
   * @param {object} o count — drobin, grid — Core3D.fx.grid albo null, layer
   */
  constructor(sim, maps, { count = 80000, grid = null, layer = 0, name = 'SpaceGasDust' } = {}) {
    this.sim = sim;
    this.maps = maps;
    this.count = count;
    const U = this.U = {
      live: uniform(1),
      dt: uniform(0),
      frame: uniform(0, 'uint'),
      shift: uniform(new THREE.Vector2()),      // przesunięcie drobin po przesunięciu okna [j.] (stary róg − nowy)
      birth: uniform(new THREE.Vector4(0, 0, 1, 1)), // prostokąt narodzin względem rogu okna: x0, y0, szer., wys. [j.]
      dustW: uniform(new THREE.Vector4(1, 0.5, 0.3, 1)), // waga kanałów gazu dla pyłu
      dustRho: uniform(0.45),                   // ρ₀ — gęstość pełnego budżetu drobin
      // obraz
      color: uniform(new THREE.Color(0.1, 0.085, 0.07)),
      sun: uniform(new THREE.Color(1, 0.9, 0.78)),
      gain: uniform(1),
      ambient: uniform(0.22),
      gridGain: uniform(0.12),
      fade: uniform(1),
      mapO: uniform(new THREE.Vector2()),       // róg okna − róg mapy [j.] (pozycja drobiny → mapa światła)
      mapInv: uniform(new THREE.Vector2(1, 1)), // 1 / bok mapy [1/j.]
      gridOff: uniform(new THREE.Vector3())     // róg okna w scenie − początek siatki świateł (double na CPU)
    };
    this.pos = instancedArray(count, 'vec4').setName(`${name}Pos`);   // x y (względem rogu okna), z, ziarno
    this.vel = instancedArray(count, 'vec4').setName(`${name}Vel`);   // vx vy vz, wiek (< 0 — czeka na narodziny)
    this._buildKernels();
    this.mesh = this._buildMesh(grid, layer, name);
    this._reset = true;
  }

  _buildKernels() {
    const U = this.U, sim = this.sim, N = sim.N, C = sim.cell, count = this.count;
    const { velA, velB, denA } = sim.buf;
    const P0 = this.pos, V0 = this.vel;
    const life = (i) => hash(i.add(uint(7919))).mul(6.0).add(4.0);
    this._life = life;
    this.kInit = Fn(() => {
      If(U.live.lessThan(0.5), () => { Return(); });
      const i = instanceIndex;
      P0.element(i).assign(vec4(0.0, 0.0, 0.0, hash(i.add(uint(33331)))));
      V0.element(i).assign(vec4(0.0, 0.0, 0.0, -1.0));
    })().compute(count).setName('spaceGasDustInit');

    const inWin = (c) => c.x.greaterThan(1.0).and(c.x.lessThan(N - 1)).and(c.y.greaterThan(1.0)).and(c.y.lessThan(N - 1));
    const cellOf = (c) => int(c.x).add(int(c.y).mul(int(N)));
    this.kStep = Fn(() => {
      If(U.live.lessThan(0.5), () => { Return(); });
      const i = instanceIndex;
      const P = P0.element(i).toVar();
      const V = V0.element(i).toVar();
      P.assign(vec4(P.xy.add(U.shift), P.zw));
      const lf = life(i).toVar();
      const cp = P.xy.div(C).toVar();
      const alive = select(V.w.greaterThanEqual(0.0).and(V.w.lessThan(lf)).and(inWin(cp)), float(1.0), float(0.0)).toVar();
      If(alive.greaterThan(0.5), () => {
        const k = cellOf(cp).toVar();
        If(velB.element(k).w.greaterThan(1.5), () => { alive.assign(0.0); });
        const rho = dot(denA.element(k), U.dustW);
        const gv = velA.element(k).mul(C);
        const nxy = V.xy.add(gv.sub(V.xy).mul(min(U.dt.mul(2.5), 1.0)));
        const nV = vec3(nxy, V.z.mul(exp(U.dt.mul(-0.6)))).toVar();
        P.assign(vec4(P.xyz.add(nV.mul(U.dt)), P.w));
        // w rzednącym gazie drobina gaśnie szybciej (budżet ∝ gęstość)
        V.assign(vec4(nV, V.w.add(U.dt.mul(float(1.0).add(float(1.0).sub(smoothstep(0.0, U.dustRho.mul(0.3), rho)).mul(5.0))))));
      });
      If(alive.lessThan(0.5), () => {
        const born = float(0.0).toVar();
        Loop({ start: 0, end: 6, type: 'int', condition: '<', name: 'sgd' }, ({ sgd }) => {
          If(born.lessThan(0.5), () => {
            const s = i.mul(uint(6)).add(uint(sgd)).add(U.frame.mul(uint(count * 6 + 17))).toVar();
            const hx = hash(s.mul(uint(3)));
            const hy = hash(s.mul(uint(3)).add(uint(1)));
            const ha = hash(s.mul(uint(3)).add(uint(2)));
            const cand = U.birth.xy.add(U.birth.zw.mul(vec2(hx, hy))).toVar();
            const cc = cand.div(C).toVar();
            If(inWin(cc), () => {
              const k = cellOf(cc).toVar();
              // przyjęcie ∝ (ρ / ρ₀)³: drobiny tam, gdzie gaz gęsty
              const r = saturate(dot(denA.element(k), U.dustW).div(U.dustRho));
              If(ha.lessThan(r.mul(r).mul(r)).and(velB.element(k).w.lessThan(1.5)), () => {
                P.assign(vec4(cand, hash(s.add(uint(911))).sub(0.5).mul(600.0), P.w));
                V.assign(vec4(velA.element(k).mul(C), 0.0, 0.0));
                born.assign(1.0);
              });
            });
          });
        });
        If(born.lessThan(0.5), () => { V.assign(vec4(V.xyz, -1.0)); });
      });
      P0.element(i).assign(P);
      V0.element(i).assign(V);
    })().compute(count).setName('spaceGasDustStep');
  }

  _buildMesh(grid, layer, name) {
    const U = this.U;
    const maps = this.maps;
    const vSun = varyingProperty('vec3', 'vSgdSun');
    const vRest = varyingProperty('vec3', 'vSgdRest');
    const vQ = varyingProperty('vec2', 'vSgdQ');
    const m = new THREE.NodeMaterial();
    m.name = name;
    m.lights = false;
    m.fog = false;
    m.transparent = true;
    m.depthWrite = false;
    m.depthTest = true;
    m.side = THREE.DoubleSide;
    m.forceSinglePass = true;
    blendAddytywnePremul(m);
    m.positionNode = Fn(() => {
      const P = this.pos.element(instanceIndex).toVar();
      const V = this.vel.element(instanceIndex).toVar();
      const seed = P.w;
      const age = V.w;
      const lf = this._life(instanceIndex);
      const fade = smoothstep(0.0, 0.6, age).mul(float(1.0).sub(smoothstep(lf.sub(0.9), lf, age))).mul(U.fade).toVar();
      const puff = select(seed.lessThan(0.1), float(1.0), float(0.0)).toVar();
      const size = mix(seed.mul(8.0).add(5.0), seed.mul(260.0).add(40.0), puff).mul(select(age.lessThan(0.0), float(0.0), float(1.0)));
      // scena: x gry, −y gry (siatka w rogu okna, bez odbicia)
      const local = vec3(P.x, P.y.negate(), P.z).toVar();
      // Słońce z mapy światła (samocień gazu) — w fragmencie × maska słońca Core3D
      const muv = P.xy.add(U.mapO).mul(U.mapInv);
      const tsun = texture(maps.lightTex, muv).level(0).x;
      const base = U.color.mul(seed.mul(0.8).add(0.5)).mul(mix(float(1.0), float(0.12), puff)).mul(U.gain).toVar();
      const k = fade.mul(mix(float(1.0), float(0.3), puff)).toVar();
      vSun.assign(base.mul(U.sun).mul(tsun.mul(0.75)).mul(k));
      const rest = vec3(U.ambient).toVar();
      if (grid) {
        const g = vec3(0.0).toVar();
        grid.loop(U.gridOff.add(local), ({ att, col, scatter }) => { g.addAssign(col.mul(att).mul(scatter.mul(0.65).add(0.35))); });
        rest.addAssign(g.mul(U.gridGain));
      }
      vRest.assign(base.mul(rest).mul(k));
      const q = positionGeometry.xy.mul(2.0);
      vQ.assign(q);
      return local.add(billboardOffset(q.x.mul(size).mul(0.5), q.y.mul(size).mul(0.5)));
    })();
    m.fragmentNode = Fn(() => {
      const r2 = dot(vQ, vQ);
      const mask = exp(r2.mul(-4.0)).mul(float(1.0).sub(smoothstep(0.75, 1.0, r2)));
      const c = vSun.mul(sunVisibility()).add(vRest).mul(mask).toVar();
      return vec4(c, max(c.x, max(c.y, c.z)));
    })();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    geo.instanceCount = this.count;
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = SPACE_GAS_DUST_ORDER;
    mesh.layers.set(layer);
    mesh.visible = false;
    return mesh;
  }

  kernels() { return [this.kInit, this.kStep]; }

  warm(renderer) {
    if (!renderer) return;
    const live = this.U.live.value;
    this.U.live.value = 0;
    try { renderer.compute(this.kernels()); } finally { this.U.live.value = live; }
  }

  /** Drobiny od nowa (start okna pola). */
  requestReset() { this._reset = true; }

  /** Wygląd sceny (barwa pyłu, wagi kanałów, ρ₀). */
  syncLook(look) {
    const U = this.U;
    U.color.value.setRGB(look.dustColor[0], look.dustColor[1], look.dustColor[2]);
    U.sun.value.setRGB(look.sun[0] * look.sunGain, look.sun[1] * look.sunGain, look.sun[2] * look.sunGain);
    const w = look.dustW;
    U.dustW.value.set(w[0], w[1], w[2], w[3]);
    U.dustRho.value = look.dustRho;
  }

  /**
   * Krok klatki: dt czasu gry (0 — pauza: drobiny stoją, martwe dalej czekają), róg okna i mapy (względem kotwicy),
   * kadr do narodzin, początek siatki świateł. Zwraca liczbę dispatchy.
   */
  frame(renderer, dt, ctx, anchorX, anchorY, mapRect, fade) {
    const U = this.U, sim = this.sim, C = sim.cell;
    const ox = sim.ox * C, oy = sim.oy * C;
    if (this._ox === undefined || this._reset) { this._ox = ox; this._oy = oy; }
    U.shift.value.set(this._ox - ox, this._oy - oy);
    this._ox = ox; this._oy = oy;
    U.dt.value = Math.max(0, Math.min(dt, 0.1));
    U.frame.value = (U.frame.value + 1) >>> 0;
    // narodziny w kadrze × 1,25 (względem rogu okna)
    const bw = mapRect.w * 1.25, bh = mapRect.h * 1.25;
    U.birth.value.set(mapRect.cx - bw * 0.5 - ox, mapRect.cy - bh * 0.5 - oy, bw, bh);
    U.mapO.value.set(ox - (mapRect.cx - mapRect.w * 0.5), oy - (mapRect.cy - mapRect.h * 0.5));
    U.mapInv.value.set(1 / mapRect.w, 1 / mapRect.h);
    U.fade.value = fade;
    const wx = anchorX + ox, wy = anchorY + oy;
    const g = ctx && ctx.origin;
    U.gridOff.value.set(wx - (g ? g.x : 0), -wy - (g ? g.y : 0), 0);
    this.mesh.position.set(wx, -wy, 0);
    let n = 0;
    if (renderer) {
      if (this._reset) { renderer.compute([this.kInit, this.kStep]); n = 2; } else { renderer.compute(this.kStep); n = 1; }
    }
    this._reset = false;
    return n;
  }

  setVisible(on) { this.mesh.visible = on; }
}
