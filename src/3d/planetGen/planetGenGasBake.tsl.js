// src/3d/planetGen/planetGenGasBake.tsl.js
//
// Wypiek MAPY DNIA gazowego i lodowego olbrzyma (jeden graf dla obu rodzajów — wartości w uniformach). Mapę ożywia
// wspólny silnik gasGiantAtmosphere (planetGenGas.js): pasy jadą z wiatrem strefowym, wiry obracają się w swoich
// owalach — więc mapa niesie to, co silnik przesuwa: pasy z barwą i turbulencją brzegów, wiry W TYCH SAMYCH
// miejscach co rekordy silnika (u, φ, półosie), drobne struktury (włókna wzdłuż równoleżników, girlandy na skraju
// strefy równikowej, jasne chmury konwekcji), mgłę polarną z gromadą małych cyklonów.
//
// Pasy: tablica uniformów (do GAS_ROW_CAP wierszy: [φ dolny, φ górny, turbulencja, rodzaj] + barwa), wiry:
// GAS_VORTEX_BAKE_CAP rekordów ([u, φ, a, b] w stopniach + [barwa: 0 strefa/1 akcent/2 pas/3 ciemna, duży, zwrot, —]).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, int, vec2, vec3, vec4, uniformArray,
  abs, atan, clamp, cos, dot, exp, floor, fract, length, max, min, mix, sin, smoothstep, sqrt, step
} from 'three/tsl';
import { pgNoise, pgFbm, pgWarp, pgCells } from './planetGenNoise.tsl.js';
import { bakeUniforms, bakeCoords, bakeMaterial, COMMON_DEFS } from './planetGenBake.tsl.js';
import { createGenGasEngine } from './planetGenGas.js';

const PI = Math.PI;
export const GAS_ROW_CAP = 24;
export const GAS_VORTEX_BAKE_CAP = 12;

const GAS_DEFS = {
  ...COMMON_DEFS,
  uGas: 'vec4',      // x — kontrast, y — turbulencja, z — girlandy, w — burze
  uGas2: 'vec4',     // x — mgła polarna, y — lodowy (0/1), z — włókna, w — —
  uZone: 'vec3', uBelt: 'vec3', uAccent: 'vec3', uPole: 'vec3', uStorm: 'vec3', uDark: 'vec3'
};

function buildGasGraph() {
  const U = bakeUniforms(GAS_DEFS);
  const rowsA = uniformArray(Array.from({ length: GAS_ROW_CAP }, () => new THREE.Vector4(200, 200, 0, 0)), 'vec4').setName('planetGenGasRowsA');
  const rowsC = uniformArray(Array.from({ length: GAS_ROW_CAP }, () => new THREE.Vector4()), 'vec4').setName('planetGenGasRowsC');
  const vortA = uniformArray(Array.from({ length: GAS_VORTEX_BAKE_CAP }, () => new THREE.Vector4()), 'vec4').setName('planetGenGasVortA');
  const vortB = uniformArray(Array.from({ length: GAS_VORTEX_BAKE_CAP }, () => new THREE.Vector4()), 'vec4').setName('planetGenGasVortB');
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const latD = C.lat.mul(180 / PI).toVar();
    const ice = U.uGas2.y;
    // brzegi pasów falują (turbulencja) — przesunięcie szerokości szumem niesionym wzdłuż równoleżnika
    const q = vec3(C.dir.x, C.dir.y.mul(3.0), C.dir.z).add(U.uSeed.xyz).toVar();
    const wv = pgWarp(q.mul(2.2), 3, 0.5).toVar();
    const edgeN = pgFbm(q.mul(vec3(5.0, 9.0, 5.0)).add(wv), 5).toVar();
    const latW = latD.add(edgeN.mul(U.uGas.y).mul(1.6)).toVar();
    // pas pod pikselem + sąsiad (przenikanie na brzegu)
    const col = vec3(0.0).toVar();
    const turb = float(0.0).toVar();
    const kind = float(0.0).toVar();
    const edgeDist = float(90.0).toVar();
    Loop(GAS_ROW_CAP, ({ i }) => {
      const A = rowsA.element(i);
      If(latW.greaterThanEqual(A.x).and(latW.lessThan(A.y)), () => {
        col.assign(rowsC.element(i).xyz);
        turb.assign(A.z);
        kind.assign(A.w);
        edgeDist.assign(min(latW.sub(A.x), A.y.sub(latW)));
      });
    });
    // przenikanie na granicy (± ~0,6°) z sąsiadem: barwa sąsiednia z pasa przesuniętego o próbkę
    const blendW = smoothstep(0.0, 0.9, edgeDist);
    const latN = latW.add(mix(float(-1.2), float(1.2), step(0.0, latW.sub(latD))));
    const colN = col.toVar();
    Loop(GAS_ROW_CAP, ({ i }) => {
      const A = rowsA.element(i);
      If(latN.greaterThanEqual(A.x).and(latN.lessThan(A.y)), () => { colN.assign(rowsC.element(i).xyz); });
    });
    col.assign(mix(mix(col, colN, 0.5), col, blendW));
    // włókna wzdłuż równoleżników: szum mocno rozciągnięty strefowo, odkształcony
    const fil = pgFbm(vec3(C.dir.x, C.dir.y.mul(26.0), C.dir.z).mul(2.0).add(U.uSeed.xyz).add(wv.mul(1.6)), 6).toVar();
    const fil2 = pgFbm(vec3(C.dir.x, C.dir.y.mul(10.0), C.dir.z).mul(6.0).add(U.uSeed.xyz.mul(1.3)).add(wv.mul(2.4)), 5).toVar();
    const k = U.uGas2.z.mul(turb.mul(0.6).add(0.4));
    col.mulAssign(float(1.0).add(fil.mul(0.18).mul(k)).add(fil2.mul(0.12).mul(k).mul(U.uGas.x.add(0.3))));
    // ciemne / jasne smugi w pasach (pasy turbulentne bardziej plamiste)
    const blot = pgFbm(ps.mul(vec3(7.0, 14.0, 7.0)).add(wv.mul(3.0)), 5).toVar();
    col.assign(mix(col, mix(U.uBelt, U.uAccent, smoothstep(0.1, 0.5, blot)), smoothstep(0.15, 0.6, blot).mul(turb).mul(0.35).mul(U.uGas.x)));
    // girlandy (festony) na skraju strefy równikowej: ciemne łuki ciągnięte z pasa w strefę
    If(U.uGas.z.greaterThan(0.01), () => {
      const nearEq = exp(abs(latD).sub(8.0).div(3.0).pow2().negate());
      const lon = C.u.mul(2 * PI);
      const fest = sin(lon.mul(11.0).add(blot.mul(3.0)).add(latD.mul(0.6))).mul(0.5).add(0.5);
      const plume = smoothstep(0.72, 0.95, fest).mul(nearEq).mul(U.uGas.z);
      col.assign(mix(col, U.uDark.mul(0.6).add(U.uBelt.mul(0.4)), plume.mul(0.55)));
    });
    // jasne chmury konwekcji (drobne białe kłęby) w pasach
    If(U.uGas.w.greaterThan(0.01), () => {
      const cc = pgCells(vec3(C.dir.x, C.dir.y.mul(1.6), C.dir.z).mul(38.0).add(U.uSeed.xyz.mul(2.0)), 0.9).toVar();
      const has = step(float(1.0).sub(U.uGas.w.mul(0.12).mul(turb.add(0.3))), cc.z);
      const puff = exp(cc.x.mul(cc.x).mul(-18.0)).mul(has);
      col.assign(mix(col, U.uStorm, puff.mul(0.8)));
    });
    // mgła polarna: barwa bieguna, gromada małych cyklonów (komórki w kole), gaśnie ku pasom
    const polar = smoothstep(58.0, 78.0, abs(latD)).toVar();
    If(polar.greaterThan(0.001), () => {
      const pc = pgCells(ps.mul(26.0), 0.8).toVar();
      const ring = smoothstep(0.08, 0.0, abs(pc.x.sub(0.28))).mul(0.5).add(exp(pc.x.mul(pc.x).mul(-30.0)).mul(0.4));
      const pcol = mix(U.uPole, U.uStorm, ring.mul(0.45).mul(float(1.0).sub(ice.mul(0.7)))).mul(float(1.0).add(blot.mul(0.12)));
      col.assign(mix(col, pcol, polar.mul(U.uGas2.x)));
    });
    // WIRY w miejscach rekordów silnika (u, φ w stopniach; a — półoś w u [°], b — w φ [°])
    Loop(GAS_VORTEX_BAKE_CAP, ({ i }) => {
      const A = vortA.element(i);
      const B = vortB.element(i);
      If(A.z.greaterThan(0.0), () => {
        const du = fract(C.u.mul(360.0).sub(A.x).div(360.0).add(0.5)).sub(0.5).mul(360.0);
        const X = du.div(A.z);
        const Y = latD.sub(A.y).div(A.w);
        const r = sqrt(X.mul(X).add(Y.mul(Y))).toVar();
        If(r.lessThan(1.6), () => {
          const ang = atan(Y, X);
          // spirala wewnątrz (obraca ją silnik), kołnierz jaśniejszy / ciemniejszy, jądro
          const spiral = sin(ang.mul(2.0).add(r.mul(9.0).mul(B.z)).add(pgNoise(vec3(X, Y, A.x.mul(0.1)).mul(2.5)).mul(2.0))).mul(0.5).add(0.5);
          const tint = vec3(0.0).toVar();
          If(B.x.lessThan(0.5), () => { tint.assign(U.uStorm); })
            .ElseIf(B.x.lessThan(1.5), () => { tint.assign(U.uAccent); })
            .ElseIf(B.x.lessThan(2.5), () => { tint.assign(mix(U.uBelt, U.uDark, 0.5)); })
            .Else(() => { tint.assign(U.uDark); });
          const body = float(1.0).sub(smoothstep(0.75, 1.02, r));
          const inner = mix(tint.mul(0.92), tint.mul(1.08), spiral.mul(smoothstep(0.1, 0.7, r)));
          const collar = exp(r.sub(1.0).div(0.16).pow2().negate());
          const v = mix(col, inner, body.mul(0.95)).toVar();
          // kołnierz: jasny przy dużej plamie i owalach, białe chmury obok ciemnych plam (lodowe)
          v.assign(mix(v, mix(U.uZone, U.uStorm, 0.6), collar.mul(mix(float(0.35), float(0.55), B.y))));
          If(B.x.greaterThan(2.5), () => {
            const comp = exp(X.sub(1.3).pow2().add(Y.add(0.6).pow2()).mul(-3.5));
            v.assign(mix(v, U.uStorm, comp.mul(0.85)));
          });
          col.assign(v);
        });
      });
    });
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenGasDay', node), arrays: { rowsA, rowsC, vortA, vortB } };
}

export const GAS_BAKE = { build: buildGasGraph };

/** Wartości uniformów i tablic wypieku z opisu + silnik atmosfery (model per planeta). */
export function gasBakeUniforms(spec, ctx, graph = null) {
  const L = spec.look;
  const P = L.colors;
  const values = {
    uGas: [L.contrast, L.turb, L.festoons, L.storms],
    uGas2: [L.polarHaze, spec.type === 'ice_giant' ? 1 : 0, spec.type === 'ice_giant' ? 0.45 : 1.0, 0],
    uZone: P.zone, uBelt: P.belt, uAccent: P.accent, uPole: P.pole, uStorm: P.storm, uDark: P.dark || P.belt.map((v) => v * 0.5)
  };
  const rows = L.rows.slice(0, GAS_ROW_CAP);
  const colorIdx = { storm: 0, accent: 1, belt: 2, dark: 3 };
  const vort = L.vortices.slice(0, GAS_VORTEX_BAKE_CAP);
  const arrays = (g) => {
    for (let i = 0; i < GAS_ROW_CAP; i++) {
      const r = rows[i];
      g.arrays.rowsA.array[i].set(r ? r.lo - (i === 0 ? 5 : 0) : 200, r ? r.hi + (i === rows.length - 1 ? 5 : 0) : 200, r ? r.turb : 0, r ? r.kind : 0);
      g.arrays.rowsC.array[i].set(r ? r.color[0] : 0, r ? r.color[1] : 0, r ? r.color[2] : 0, 0);
    }
    for (let i = 0; i < GAS_VORTEX_BAKE_CAP; i++) {
      const v = vort[i];
      g.arrays.vortA.array[i].set(v ? v.u : 0, v ? v.lat : 0, v ? v.a : 0, v ? v.b : 0);
      g.arrays.vortB.array[i].set(v ? colorIdx[v.color] ?? 0 : 0, v ? v.big : 0, v ? v.sense : 0, 0);
    }
  };
  const engine = createGenGasEngine(spec);
  return { values, arrays, engine };
}
