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
  abs, asin, atan, clamp, cos, cross, dot, exp, floor, fract, length, max, min, mix, normalize, sin, smoothstep, sqrt, step
} from 'three/tsl';
import { pgNoise, pgNoised, pgFbm, pgWarp, pgCells } from './planetGenNoise.tsl.js';
import { bakeUniforms, bakeCoords, bakeMaterial, COMMON_DEFS } from './planetGenBake.tsl.js';
import { createGenGasEngine } from './planetGenGas.js';

const PI = Math.PI;
export const GAS_ROW_CAP = 24;
export const GAS_VORTEX_BAKE_CAP = 12;

const GAS_DEFS = {
  ...COMMON_DEFS,
  uGas: 'vec4',      // x — kontrast, y — turbulencja, z — girlandy, w — burze
  uGas2: 'vec4',     // x — mgła polarna, y — lodowy (0/1), z — włókna, w — —
  uGasP: 'vec4',     // bieguny: x — styl N, y — styl S (0 mgła, 1 cyklony, 2 sześciokąt), z — liczba cyklonów, w — faza [°]
  uGasP2: 'vec4',    // x — kolatitude pierścienia cyklonów [°], y — kolatitude sześciokąta [°], z / w — —
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
    // Profil pasów: barwa i turbulencja w szerokości φ — wagi pasów miękkie na granicach (±0,7°), suma ważona.
    const profile = (lat) => {
      const c = vec3(0.0).toVar();
      const t = float(0.0).toVar();
      const ws = float(0.0).toVar();
      Loop(GAS_ROW_CAP, ({ i }) => {
        const A = rowsA.element(i);
        const w = smoothstep(A.x.sub(1.1), A.x.add(1.1), lat).mul(float(1.0).sub(smoothstep(A.y.sub(1.1), A.y.add(1.1), lat)));
        c.addAssign(rowsC.element(i).xyz.mul(w));
        t.addAssign(A.z.mul(w));
        ws.addAssign(w);
      });
      return { c: c.div(max(ws, 1e-4)), t: t.div(max(ws, 1e-4)) };
    };
    // TURBULENCJA: barwa z profilu w szerokości ZABURZONEJ polem rozciągniętym strefowo (dziedzina odkształcona
    // dwa razy) — smugi i zawirowania jak rozmazana farba; amplituda z turbulencji pasa pod pikselem
    const q = vec3(C.dir.x, C.dir.y.mul(4.0), C.dir.z).add(U.uSeed.xyz).toVar();
    const wv = pgWarp(q.mul(1.8), 4, 0.55).toVar();
    const wv2 = pgWarp(vec3(C.dir.x, C.dir.y.mul(9.0), C.dir.z).mul(4.0).add(U.uSeed.xyz.mul(1.7)).add(wv), 3, 0.35).toVar();
    const turb0 = profile(latD).t.toVar();
    const tf = pgFbm(vec3(C.dir.x, C.dir.y.mul(7.0), C.dir.z).mul(3.0).add(wv.mul(1.2)).add(wv2), 6).toVar();
    const tf2 = pgFbm(vec3(C.dir.x, C.dir.y.mul(14.0), C.dir.z).mul(7.0).add(wv2.mul(2.0)), 5).toVar();
    // ADWEKCJA polem wirowym (rot szumu z pochodnymi, dwie skale na przemian): kierunek piksela cofany kilka kroków
    // wzdłuż pola — wiry i marmurkowe zawinięcia barwy pasów; krok z turbulencji pasa, składowa N–S słabsza (dżety)
    const pos = vec3(C.dir).toVar();
    const stepK = mix(0.018, 0.06, turb0).mul(U.uGas.y).toVar();
    for (let it = 0; it < 8; it++) {
      const F = it % 2 === 0 ? 4.0 : 11.0;
      const o1 = vec3(1.7 + it, -2.3, 0.9 * it);
      const o2 = vec3(-4.1, 3.3 + it, 2.2);
      const n1 = pgNoised(pos.mul(vec3(F, F * 1.6, F)).add(U.uSeed.xyz).add(o1)).yzw;
      const n2 = pgNoised(pos.mul(vec3(F, F * 1.6, F)).add(U.uSeed.xyz).add(o2)).yzw;
      const curl = cross(n1, n2).mul(vec3(1.0, 0.45, 1.0));
      pos.assign(normalize(pos.add(curl.mul(stepK).mul(it % 2 === 0 ? 1.0 : 0.45))));
    }
    const latAdv = asin(clamp(pos.y, -1.0, 1.0)).mul(180 / PI).toVar();
    const amp = mix(1.0, 5.0, turb0).mul(U.uGas.y).toVar();
    // fale Kelvina–Helmholtza na brzegach (łuki, „szewrony”) — przesunięcie z długości, odkształcone
    const wave = sin(C.u.mul(2 * PI * 17.0).add(wv.x.mul(7.0)).add(latD.mul(0.35))).mul(0.6).mul(amp).mul(0.25);
    const latT = latAdv.add(tf.mul(amp)).add(tf2.mul(amp).mul(0.5)).add(wave).toVar();
    const P = profile(latT);
    const col = vec3(P.c).toVar();
    const turb = P.t.toVar();
    // podpasma: drobny profil jasności w zaburzonej szerokości (cienkie pasemka — też rozmazane)
    const s1 = U.uSeed.x;
    const sub = sin(latT.mul(1.9).add(s1)).mul(0.5).add(sin(latT.mul(4.3).add(s1.mul(1.7))).mul(0.3)).add(sin(latT.mul(9.7).add(s1.mul(2.3))).mul(0.2));
    col.mulAssign(float(1.0).add(sub.mul(0.08).mul(U.uGas.x.add(0.3))));
    // włókna: drobny szum mocno rozciągnięty strefowo
    const fil = pgFbm(vec3(C.dir.x, C.dir.y.mul(26.0), C.dir.z).mul(2.5).add(U.uSeed.xyz).add(wv2.mul(1.6)), 5).toVar();
    const k = U.uGas2.z.mul(turb.mul(0.6).add(0.4));
    col.mulAssign(float(1.0).add(fil.mul(0.12).mul(k)));
    // plamy w pasach turbulentnych: ciemniejsze / akcent
    const blot = pgFbm(ps.mul(vec3(7.0, 14.0, 7.0)).add(wv.mul(3.0)), 5).toVar();
    col.assign(mix(col, mix(U.uBelt, U.uAccent, smoothstep(0.1, 0.5, blot)), smoothstep(0.2, 0.65, blot).mul(turb).mul(0.25).mul(U.uGas.x)));
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
      // lodowe olbrzymy: rzadkie, wydłużone smugi metanu; gazowe — kłęby w pasach turbulentnych
      const has = step(float(1.0).sub(U.uGas.w.mul(mix(0.1, 0.025, ice)).mul(turb.add(0.3))), cc.z);
      const puff = exp(cc.x.mul(cc.x).mul(-18.0)).mul(has);
      col.assign(mix(col, U.uStorm, puff.mul(0.8)));
    });
    // mgła polarna: barwa bieguna, gromada małych cyklonów (komórki w kole), gaśnie ku pasom
    const polar = smoothstep(52.0, 84.0, abs(latD).add(tf.mul(5.0))).toVar();
    If(polar.greaterThan(0.001), () => {
      // mgła polarna: plamista (bez pierścieni), gromada drobnych cyklonów jako miękkie jaśniejsze plamki
      const mott = pgFbm(ps.mul(9.0).add(wv.mul(2.0)), 5).toVar();
      // mgła polarna przykrywa pasy częściowo — ich struktura prześwituje (bez linii granicy czapy)
      const pcol = U.uPole.mul(float(1.0).add(mott.mul(0.2))).mul(mix(vec3(1.0), col.div(max(dot(col, vec3(0.333)), 1e-3)), 0.25));
      col.assign(mix(col, pcol, polar.mul(polar).mul(U.uGas2.x).mul(0.85)));
    });
    // BIEGUNY: gromada cyklonów albo sześciokąt dżetu (współrzędne azimutalne wokół bieguna w stopniach)
    const colat = float(90.0).sub(abs(latD)).toVar();
    const style = mix(U.uGasP.y, U.uGasP.x, step(0.0, latD)).toVar();
    If(colat.lessThan(22.0).and(style.greaterThan(0.5)), () => {
      const lam = C.u.mul(2 * PI).add(U.uGasP.w.mul(PI / 180)).toVar();
      const P2 = vec2(colat.mul(cos(lam)), colat.mul(sin(lam))).toVar();
      const tf2 = pgNoise(ps.mul(14.0)).toVar();
      const cyc = (c, rad, sense) => {
        const dv = P2.sub(c);
        const d = length(dv).div(rad).toVar();
        If(d.lessThan(1.5), () => {
          const ang = atan(dv.y, dv.x);
          // spirala miękka (ostre ramiona wyglądały jak stempel „@”), brzeg poszarpany szumem
          const spiral = sin(ang.mul(2.0).add(d.mul(7.0).mul(sense)).add(tf2.mul(3.5))).mul(0.5).add(0.5);
          const de = d.add(tf2.mul(0.18)).toVar();
          const body = float(1.0).sub(smoothstep(0.55, 1.05, de));
          const inner = mix(U.uPole.mul(0.86), mix(U.uPole, U.uStorm, 0.4), spiral.mul(smoothstep(0.08, 0.9, d)).mul(0.8));
          const rim = exp(de.sub(1.0).div(0.22).pow2().negate());
          col.assign(mix(col, inner, body.mul(0.75)));
          col.assign(mix(col, mix(U.uPole, U.uDark, 0.3), rim.mul(0.3)));
        });
      };
      If(style.lessThan(1.5), () => {
        // gromada: cyklon centralny + pierścień N cyklonów
        cyc(vec2(0.0, 0.0), float(4.6), float(1.0));
        for (let k = 0; k < 9; k++) {
          If(U.uGasP.z.greaterThan(k + 0.5), () => {
            const a = float(k * 2 * PI).div(U.uGasP.z).add(float(k * 0.37).sin().mul(0.12));
            const rr = U.uGasP2.x.mul(float(1.0).add(float(k * 1.7).sin().mul(0.08)));
            cyc(vec2(rr.mul(cos(a)), rr.mul(sin(a))), float(3.3 + 0.5 * Math.sin(k * 2.3)), float(1.0));
          });
        }
      }).Else(() => {
        // sześciokąt: ciemny pas dżetu po wielokącie, wnętrze chłodniejsze, wir w środku
        const a6 = Math.PI / 6;
        const rHex = U.uGasP2.y.mul(Math.cos(a6)).div(cos(lam.sub(floor(lam.div(2 * a6)).mul(2 * a6)).sub(a6)));
        // pas dżetu szeroki (~3°) i poszarpany — cienka linia wyglądała na narysowaną
        const band = exp(colat.add(tf2.mul(1.4)).sub(rHex).div(1.9).pow2().negate());
        const inside = float(1.0).sub(smoothstep(rHex.sub(2.5), rHex.add(1.0), colat.add(tf2.mul(1.0))));
        col.assign(mix(col, mix(U.uPole, U.uBelt, 0.25).mul(0.95), inside.mul(0.55)));
        col.assign(mix(col, mix(U.uPole, mix(U.uBelt, U.uDark, 0.3), 0.6), band.mul(0.6)));
        cyc(vec2(0.0, 0.0), float(4.0), float(1.0));
      });
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
    uGasP: L.polar ? [L.polar.north, L.polar.south, L.polar.count, L.polar.phase] : [0, 0, 0, 0],
    uGasP2: L.polar ? [L.polar.ringDeg, L.polar.hexDeg, 0, 0] : [8, 13, 0, 0],
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
