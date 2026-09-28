// src/3d/hullDamageMap.tsl.js
//
// MAPA RAN NA KADŁUBACH BELKOWYCH — część GPU (zadanie 18-C, docs/webgpu/PROJEKT-BRONI.md §3).
// Port mapy uszkodzeń dema broni (dema/bronie-webgpu/hull.js: stempel, stygnięcie, osmalenie,
// przestrzelina z brzegiem, poświata jonowa) na pulę slotów w JEDNYM buforze storage:
//
//   • teksel 8 B (uvec2): x = packHalf2x16(żar, jony), y = osmalenie | brzeg << 8 | otwór << 16
//     (unorm 8 bit). Żar w f16 — w 8 bitach nie stygnie przy 144 FPS (PROJEKT §3.1). „Brzeg”
//     (kształt rany z receptury: pierścień żaru wokół środka) i „otwór” (przezroczystość) to osobne
//     kanały: przestrzelina przezroczysta tylko z małego kalibru bez krateru, dziury po kraterze
//     i rzazie robi geometria belek (reguła „dziura albo krater”, §3.4);
//   • slot = prostokąt w×h tekseli w uv sprite'a kadłuba (konwencja skóry: v = 0 u góry obrazu),
//     klasy L/M/S (hullDamageMap.js); materiał dostaje (base, w, h, on) per obiekt;
//   • kernel z listą zadań (jedno zadanie na slot na klatkę — bez wyścigów): wątek znajduje
//     zadanie wyszukiwaniem binarnym po początkach, liczy teksel w prostokącie zadania i robi
//     kolejno: czyszczenie → stygnięcie (wzór zamknięty, dowolny krok — sloty poza kadrem
//     nadrabiają przy powrocie) → zgaszenie żaru → naprawę → stemple zadania.
//
// Stygnięcie jak w demie: dH/dt = −(1,3·H + 0,45)·H (biel → pomarańcz szybko, czerwień długo),
// jony e^(−5t). Demo całkowało to krokiem klatki (H·e^(−k·dt)); tu rozwiązanie dokładne
//   H(t + Δ) = a·H·e^(−aΔ) / (a + b·H·(1 − e^(−aΔ)))   (a = 0,45, b = 1,3)
// — ten sam przebieg niezależnie od FPS i od tego, jak często slot stygnie.
//
// Pułapki r183 (PLAN §3): przesunięcia bitowe tylko na u32; storage w materiale tylko do odczytu
// (osobny węzeł na ten sam atrybut niż kernel); `texture()` z jawnym uv (bez macierzy uv per obiekt).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, Discard,
  float, int, uint, vec2, vec3, vec4, uvec2,
  uniform, storage, instanceIndex, texture,
  packHalf2x16, unpackHalf2x16, uintBitsToFloat,
  abs, atan, clamp, dot, exp, floor, length, max, min, mix, normalize, pow, round, sin, smoothstep
} from 'three/tsl';
import { fxNoise } from './fx/noise.js';
import { FxFrame } from './fx/fxFrame.js';
import { Core3D } from './core3d.js';

// ── Stałe wspólne z CPU (hullDamageMap.js) ───────────────────────────────────

/**
 * Klasy slotów (kolejność: od największej) wg długości kadłuba-korzenia w świecie [j.] —
 * rozdzielczość ~2–3,5 j. na teksel: L 512×256 (≥ 900: Atlas, superkapitały, lotniskowce,
 * frachtowce), M 256×128 (400–900: pancerniki), S 128×64 (160–400: niszczyciele, fregaty).
 */
export const DMG_CLASSES = Object.freeze([
  Object.freeze({ name: 'L', w: 512, h: 256, count: 12, minLen: 900 }),
  Object.freeze({ name: 'M', w: 256, h: 128, count: 32, minLen: 400 }),
  Object.freeze({ name: 'S', w: 128, h: 64, count: 64, minLen: 160 })
]);
/** Teksele puli (suma slotów wszystkich klas) — 3 145 728 × 8 B = 24 MB. */
export const DMG_POOL_TEXELS = DMG_CLASSES.reduce((n, c) => n + c.w * c.h * c.count, 0);

/** Stygnięcie żaru: dH/dt = −(B·H + A)·H. */
export const DMG_COOL_A = 0.45;
export const DMG_COOL_B = 1.3;
/** Zanik jonów [1/s]. */
export const DMG_ION_DECAY = 5.0;
/** Sufit żaru (seria trafień w jedno miejsce sumuje poświatę 0,12·żar na trafienie). */
export const DMG_HEAT_MAX = 6.0;
/** Żar, poniżej którego teksel uznajemy za zimny (koniec „gorącego” slotu). */
export const DMG_HEAT_EPS = 0.02;

/** Słowa u32 zadania: 4 × uvec4 (początek, slot, prostokąt, stemple, liczby float jako bity). */
export const DMG_JOB_VEC4 = 4;
/** vec4 stempla: A (u, v, promień / H świata, otwór), B (żar, osmalenie, brzeg, jony), C (kierunek uv, wydłużenie, ziarno). */
export const DMG_STAMP_VEC4 = 3;

/** Flagi zadania. */
export const DMG_FLAG_CLEAR = 1;
export const DMG_FLAG_ZERO_HEAT = 2;

/** Zasięg stempla: r < 1,6 promienia × (1 + falowanie obrysu ≤ 0,3) × wydłużenie. */
export const DMG_STAMP_REACH = 1.6 * 1.3;

// ── Pula (jeden bufor storage na wszystkie sloty) ────────────────────────────

let _pool = null;

/**
 * Pula tekseli (uvec2 na teksel). Tworzona raz — rozmiar z klas slotów (DMG_POOL_TEXELS), kto by
 * jej nie zawołał pierwszy (graf materiału kadłuba albo kernel).
 * `rw` — węzeł kernela (read_write), `ro` — węzeł materiałów (read).
 */
export function hullDamagePool() {
  if (_pool) return _pool;
  const n = DMG_POOL_TEXELS;
  const attr = new THREE.StorageBufferAttribute(new Uint32Array(n * 2), 2);
  attr.name = 'hullDamagePool';
  _pool = {
    texels: n,
    bytes: n * 8,
    attribute: attr,
    rw: storage(attr, 'uvec2', n).setName('hullDamagePoolRW'),
    ro: storage(attr, 'uvec2', n).toReadOnly().setName('hullDamagePool')
  };
  return _pool;
}

/** Tylko testy: zapomnij pulę (następne wywołanie tworzy nową). */
export function _resetHullDamagePoolForTests() { _pool = null; }

// ── Kodowanie teksela ───────────────────────────────────────────────────────

const q8 = (v) => uint(round(clamp(v, 0.0, 1.0).mul(255.0)));
const u8 = (w, shift) => float(w.shiftRight(uint(shift)).bitAnd(uint(255))).div(255.0);

/** Teksel (uvec2) → { heat, ion, scorch, rim, cut } (węzły float). */
function decodeTexel(t) {
  const hi = unpackHalf2x16(t.x);
  return { heat: hi.x, ion: hi.y, scorch: u8(t.y, 0), rim: u8(t.y, 8), cut: u8(t.y, 16) };
}

/** Stygnięcie żaru o Δ [s] — wzór zamknięty (czysta funkcja, parametry przez argumenty). */
export const damageCoolHeat = /*@__PURE__*/ Fn(([h, dt]) => {
  const e = exp(dt.mul(-DMG_COOL_A));
  return h.mul(DMG_COOL_A).mul(e).div(float(DMG_COOL_A).add(h.mul(DMG_COOL_B).mul(float(1.0).sub(e))));
}).setLayout({ name: 'hullDamageCool', type: 'float', inputs: [{ name: 'h', type: 'float' }, { name: 'dt', type: 'float' }] });

/** Lustro CPU stygnięcia (testy, czas „gorącego” slotu). */
export function damageCoolHeatCpu(h, dt) {
  if (!(h > 0) || !(dt > 0)) return h > 0 ? h : 0;
  const e = Math.exp(-DMG_COOL_A * dt);
  return DMG_COOL_A * h * e / (DMG_COOL_A + DMG_COOL_B * h * (1 - e));
}

/** Czas stygnięcia od żaru h0 do DMG_HEAT_EPS [s] (odwrócony wzór zamknięty). */
export function damageHotSeconds(h0 = DMG_HEAT_MAX, eps = DMG_HEAT_EPS) {
  if (!(h0 > eps)) return 0;
  const k = DMG_COOL_B / DMG_COOL_A;
  return Math.log((1 / eps + k) / (1 / h0 + k)) / DMG_COOL_A;
}

/**
 * Lustro CPU stempla kernela (testy): teksel T = { heat, ion, scorch, rim, cut } w punkcie uv (cx, cy)
 * slotu, stempel A = [u, v, r/H, otwór], B = [żar, osmalenie, brzeg, jony], C = [kierunek uv, wydłużenie,
 * ziarno], aspect = W/H kadłuba. Te same wzory co createHullDamageKernel (bez kwantyzacji teksela;
 * sufit żaru DMG_HEAT_MAX kernel kładzie po wszystkich stemplach zadania — tu robi to wołający).
 */
export function damageStampCpu(T, A, B, C, cx, cy, aspect) {
  const dx = (cx - A[0]) * aspect;
  const dy = cy - A[1];
  const el = Math.max(C[2], 1);
  const reach = A[2] * DMG_STAMP_REACH * el;
  if (!(Math.abs(dx) < reach && Math.abs(dy) < reach)) return T;
  const al = dx * C[0] + dy * C[1];
  const ac = dy * C[0] - dx * C[1];
  const ang = Math.atan2(ac, al);
  const wob = Math.sin(ang * 5 + C[3]) * 0.13 + Math.sin(ang * 9 - C[3] * 1.7) * 0.07 + Math.sin(ang * 2 + C[3] * 3.1) * 0.1;
  const r = Math.hypot(al / el, ac) / Math.max(A[2], 1e-5) * (1 + wob);
  if (!(r < 1.6)) return T;
  const core = Math.exp(-2.6 * r * r);
  const halo = Math.exp(-0.9 * r * r);
  const edge = Math.min(1, Math.max(0, 1.25 - 0.9 * r));
  T.heat = Math.max(T.heat, B[0] * core) + B[0] * 0.12 * halo;
  T.scorch = Math.min(T.scorch + B[1] * halo, 1);
  T.rim = Math.max(T.rim, B[2] * edge);
  T.cut = Math.max(T.cut, A[3] * edge);
  T.ion = Math.max(T.ion, B[3] * halo);
  return T;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Lustro CPU wyglądu rany w materiale (testy pasm HDR): próbka D = { heat, ion, scorch, rim, cut },
 * szum (nz — przesunięcie brzegu, jag — osmalenie, n1 — jony) i migotanie. Zwraca { heat: [r, g, b],
 * ion: [r, g, b], hole, rim, scorch, burnt, cut: czy piksel odrzucony (przestrzelina) }.
 */
export function woundGlowCpu(D, nz = 0, jag = 0, n1 = 0.5, flick = 1) {
  const cut = D.cut > 0.004 && smooth(0.52, 0.6, D.cut + nz) > 0.5;
  const holeF = D.rim + nz;
  const hole = smooth(0.52, 0.6, holeF);
  const rim = smooth(0.18, 0.5, holeF) * (1 - hole);
  const scorch = Math.min(1, Math.max(0, D.scorch + jag * 0.35));
  const burnt = (1 + (0.10 - 1) * scorch) * (1 - hole * 0.92);
  const t = D.heat * (rim * 2.2 + scorch * 0.6 + 0.25) * (1 - hole);
  const a = smooth(0.02, 0.5, t) * 1.3, b = smooth(0.35, 1.4, t) * 2.4, c = smooth(1.2, 3.2, t) * 7.0;
  const heat = [(a + b + c) * flick, (a * 0.18 + b * 0.5 + c * 0.92) * flick, (a * 0.02 + b * 0.1 + c * 0.78) * flick];
  const k = D.ion * (n1 * 1.4 + 0.3) * flick;
  return { heat, ion: [0.35 * k, 1.25 * k, 2.9 * k], hole, rim, scorch, burnt, cut };
}

// ── Kernel ──────────────────────────────────────────────────────────────────

/**
 * Kernel mapy ran. `jobs` — węzeł storage uvec4 (DMG_JOB_VEC4 na zadanie, tylko odczyt),
 * `stamps` — vec4 (DMG_STAMP_VEC4 na stempel, tylko odczyt), `U` — { total (uint), jobCount (uint) },
 * `jobCap` — pojemność listy zadań (potęga dwójki; kroki wyszukiwania binarnego).
 *
 * Zadanie (4 × uvec4):
 *   J0 = (pierwszy wątek, base slotu, w slotu, h slotu)
 *   J1 = (x0, y0, szerokość prostokąta, flagi)
 *   J2 = (pierwszy stempel, liczba stempli, bity f32 proporcji W/H kadłuba, bity f32 Δ stygnięcia)
 *   J3 = (bity f32 naprawy, 0, 0, 0)
 */
export function createHullDamageKernel(pool, jobs, stamps, U, jobCap) {
  return Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(U.total), () => { Return(); });
    // Zadanie wątku: ostatnie z początkiem ≤ i (początki rosną).
    const lo = uint(0).toVar();
    for (let step = jobCap >> 1; step >= 1; step >>= 1) {
      const cand = lo.add(uint(step));
      If(cand.lessThan(U.jobCount), () => {
        If(jobs.element(cand.mul(uint(DMG_JOB_VEC4))).x.lessThanEqual(i), () => { lo.assign(cand); });
      });
    }
    const jb = lo.mul(uint(DMG_JOB_VEC4)).toVar();
    const J0 = jobs.element(jb).toVar();
    const J1 = jobs.element(jb.add(uint(1))).toVar();
    const J2 = jobs.element(jb.add(uint(2))).toVar();
    const J3 = jobs.element(jb.add(uint(3))).toVar();
    const local = i.sub(J0.x).toVar();
    const ly = local.div(J1.z).toVar();
    const x = J1.x.add(local.sub(ly.mul(J1.z))).toVar();
    const y = J1.y.add(ly).toVar();
    If(x.greaterThanEqual(J0.z).or(y.greaterThanEqual(J0.w)), () => { Return(); });
    const idx = J0.y.add(y.mul(J0.z)).add(x).toVar();
    const T = decodeTexel(pool.element(idx).toVar());
    const heat = T.heat.toVar();
    const ion = T.ion.toVar();
    const scorch = T.scorch.toVar();
    const rim = T.rim.toVar();
    const cut = T.cut.toVar();
    const flags = J1.w.toVar();
    If(flags.bitAnd(uint(DMG_FLAG_CLEAR)).notEqual(uint(0)), () => {
      heat.assign(0.0); ion.assign(0.0); scorch.assign(0.0); rim.assign(0.0); cut.assign(0.0);
    });
    const coolDt = uintBitsToFloat(J2.w).toVar();
    If(coolDt.greaterThan(0.0), () => {
      heat.assign(damageCoolHeat(heat, coolDt));
      ion.mulAssign(exp(coolDt.mul(-DMG_ION_DECAY)));
    });
    If(flags.bitAnd(uint(DMG_FLAG_ZERO_HEAT)).notEqual(uint(0)), () => {
      heat.assign(0.0); ion.assign(0.0);
    });
    const heal = uintBitsToFloat(J3.x).toVar();
    If(heal.greaterThan(0.0), () => {
      scorch.assign(max(scorch.sub(heal), 0.0));
      rim.assign(max(rim.sub(heal), 0.0));
      cut.assign(max(cut.sub(heal), 0.0));
    });
    // Stemple (port FxHull kernel dema): odległość w jednostkach wysokości kadłuba, obrys z
    // harmonicznymi kąta i ziarnem stempla, rdzeń e^(−2,6r²), poświata e^(−0,9r²).
    const aspect = uintBitsToFloat(J2.z).toVar();
    const cx = float(x).add(0.5).div(float(J0.z)).toVar();
    const cy = float(y).add(0.5).div(float(J0.w)).toVar();
    Loop({ start: J2.x, end: J2.x.add(J2.y), type: 'uint', condition: '<', name: 'dmgStamp' }, ({ dmgStamp }) => {
      const k = dmgStamp.mul(uint(DMG_STAMP_VEC4)).toVar();
      const A = stamps.element(k).toVar();
      const C = stamps.element(k.add(uint(2))).toVar();
      const dx = cx.sub(A.x).mul(aspect).toVar();
      const dy = cy.sub(A.y).toVar();
      const reach = A.z.mul(DMG_STAMP_REACH).mul(max(C.z, 1.0));
      If(abs(dx).lessThan(reach).and(abs(dy).lessThan(reach)), () => {
        const al = dx.mul(C.x).add(dy.mul(C.y));
        const ac = dy.mul(C.x).sub(dx.mul(C.y));
        const ang = atan(ac, al).toVar();
        const wob = sin(ang.mul(5.0).add(C.w)).mul(0.13)
          .add(sin(ang.mul(9.0).sub(C.w.mul(1.7))).mul(0.07))
          .add(sin(ang.mul(2.0).add(C.w.mul(3.1))).mul(0.1));
        const r = length(vec2(al.div(max(C.z, 1.0)), ac)).div(max(A.z, 1e-5)).mul(float(1.0).add(wob)).toVar();
        If(r.lessThan(1.6), () => {
          const B = stamps.element(k.add(uint(1))).toVar();
          const r2 = r.mul(r);
          const core = exp(r2.mul(-2.6));
          const halo = exp(r2.mul(-0.9)).toVar();
          const edge = clamp(float(1.25).sub(r.mul(0.9)), 0.0, 1.0).toVar();
          heat.assign(max(heat, B.x.mul(core)).add(B.x.mul(0.12).mul(halo)));
          scorch.assign(min(scorch.add(B.y.mul(halo)), 1.0));
          rim.assign(max(rim, B.z.mul(edge)));
          cut.assign(max(cut, A.w.mul(edge)));
          ion.assign(max(ion, B.w.mul(halo)));
        });
      });
    });
    heat.assign(min(heat, DMG_HEAT_MAX));
    const w1 = q8(scorch).bitOr(q8(rim).shiftLeft(uint(8))).bitOr(q8(cut).shiftLeft(uint(16)));
    pool.element(idx).assign(uvec2(packHalf2x16(vec2(heat, ion)), w1));
  })().compute(1).setName('hullDamageMap');
}

// ── Materiał kadłuba (haki w hexShips3D.tsl.js) ──────────────────────────────

/**
 * Dwuliniowa próbka slotu w uv skóry. slot = vec4(base, w, h, on) per obiekt. Zwraca węzły
 * { heat, ion, scorch, rim, cut }. Wklejane (czyta bufor storage — bez setLayout).
 */
export function sampleHullDamage(poolRO, slot, uvNode) {
  const w = slot.y;
  const h = slot.z;
  const p = uvNode.mul(vec2(w, h)).sub(0.5).toVar();
  const c = floor(p).toVar();
  const f = p.sub(c).toVar();
  const wi = int(w).toVar();
  const hi = int(h).toVar();
  const base = int(slot.x).toVar();
  const x0 = clamp(int(c.x), int(0), wi.sub(1)).toVar();
  const y0 = clamp(int(c.y), int(0), hi.sub(1)).toVar();
  const x1 = clamp(int(c.x).add(1), int(0), wi.sub(1)).toVar();
  const y1 = clamp(int(c.y).add(1), int(0), hi.sub(1)).toVar();
  const at = (xx, yy) => decodeTexel(poolRO.element(uint(base.add(yy.mul(wi)).add(xx))).toVar());
  const a = at(x0, y0);
  const b = at(x1, y0);
  const d = at(x0, y1);
  const e = at(x1, y1);
  const bl = (k) => mix(mix(a[k], b[k], f.x), mix(d[k], e[k], f.x), f.y).toVar();
  return { heat: bl('heat'), ion: bl('ion'), scorch: bl('scorch'), rim: bl('rim'), cut: bl('cut') };
}

let _noise = null;
function noiseTexture() {
  if (!_noise) _noise = fxNoise.tile2D();
  return _noise;
}

/**
 * Hak `hullDamageSurface` skóry belek: rana z mapy w uv skóry (jedzie z odkształceniem).
 * P — węzły per obiekt kadłuba (uDmgSlot, uDmgWorld), uTime — czas wspólny (migotanie).
 * Ustawia ctx.albedo (osmalenie), ctx.woundHeat / ctx.woundIon (vec3, do hullDamageHeat),
 * ctx.woundScorch (połysk); przestrzelina małego kalibru → Discard().
 */
export function hullWoundSurface(ctx, P, uTime, poolRO = hullDamagePool().ro) {
  const woundHeat = vec3(0.0).toVar();
  const woundIon = vec3(0.0).toVar();
  const woundScorch = float(0.0).toVar();
  ctx.woundHeat = woundHeat;
  ctx.woundIon = woundIon;
  ctx.woundScorch = woundScorch;
  const slot = P.uDmgSlot;
  // Warunek jednolity (uniform obiektu): próbkowania szumu z pochodnymi w środku są dozwolone.
  If(slot.w.greaterThan(0.5), () => {
    const D = sampleHullDamage(poolRO, slot, ctx.uv);
    // Poszarpany brzeg: szum dema (skale w j. świata kadłuba), próbki wspólnej tekstury z jawnym uv.
    const world = P.uDmgWorld;
    const tex = noiseTexture();
    const n1 = texture(tex, ctx.uv.mul(world.div(170.0))).r.toVar();
    const n2 = texture(tex, ctx.uv.mul(world.div(55.0))).b.toVar();
    const n3 = texture(tex, ctx.uv.mul(world.div(22.0))).g;
    const jag = n1.mul(0.65).add(n2.mul(0.35)).sub(0.5).toVar();
    const nz = jag.mul(0.62).add(n3.sub(0.5).mul(0.18)).toVar();
    // Przestrzelina (przezroczysta) — tylko kanał otworu; bez alfy: zapis głębi i cień mostka.
    If(D.cut.greaterThan(0.004).and(smoothstep(0.52, 0.6, D.cut.add(nz)).greaterThan(0.5)), () => {
      Discard();
    });
    // Kształt rany z receptury: środek (lej) i żarzący się brzeg.
    const holeF = D.rim.add(nz).toVar();
    const hole = smoothstep(0.52, 0.6, holeF).toVar();
    const rim = smoothstep(0.18, 0.5, holeF).mul(float(1.0).sub(hole)).toVar();
    const scorch = clamp(D.scorch.add(jag.mul(0.35)), 0.0, 1.0).toVar();
    woundScorch.assign(scorch);
    // Osmalenie → albedo. Lej (otwór bez przezroczystości) to ciemne, NIEŚWIECĄCE wnętrze — w demie
    // w tym miejscu była dziura (widać kosmos), więc żarzy się tylko pierścień brzegu; świecący
    // środek dawał tarczę bieli 8–10 HDR na całą średnicę i bloom zalewał pół kadłuba.
    const burnt = mix(vec3(1.0), vec3(0.10, 0.085, 0.075), scorch).mul(float(1.0).sub(hole.mul(0.92)));
    ctx.albedo.mulAssign(burnt);
    // Żar: skala ciała czarnego (czerwień → pomarańcz → biel), mocniej na brzegu (demo hull.js).
    const t = D.heat.mul(rim.mul(2.2).add(scorch.mul(0.6)).add(0.25)).mul(float(1.0).sub(hole)).toVar();
    const heatCol = vec3(1.0, 0.18, 0.02).mul(smoothstep(0.02, 0.5, t).mul(1.3))
      .add(vec3(1.0, 0.5, 0.1).mul(smoothstep(0.35, 1.4, t).mul(2.4)))
      .add(vec3(1.0, 0.92, 0.78).mul(smoothstep(1.2, 3.2, t).mul(7.0)));
    const flick = sin(uTime.mul(9.0).add(n2.mul(31.0))).mul(0.12).add(0.88).toVar();
    woundHeat.assign(heatCol.mul(flick));
    woundIon.assign(vec3(0.35, 1.25, 2.9).mul(D.ion.mul(n1.mul(1.4).add(0.3)).mul(flick)));
  });
}

/** Hak `hullDamageHeat`: jedno źródło żaru na piksel — max(żar skóry, żar rany) + poświata jonowa. */
export function hullWoundHeat(ctx, skinGlow) {
  return max(skinGlow, ctx.woundHeat).add(ctx.woundIon);
}

/**
 * Siatka świateł efektów gry (Core3D.fx.grid, zadanie 12). Graf kadłuba może powstać przed
 * Core3D.init() (testy) — wtedy tworzymy klatkę efektów tu; init bierze tę samą
 * (`this.fx = this.fx || new FxFrame()`), więc materiał i klatka czytają jedne bufory.
 */
export function effectLightGrid() {
  if (!Core3D.fx) Core3D.fx = new FxFrame();
  return Core3D.fx.grid;
}

/** Albedo rozproszenia świateł efektów (demo: tekstura × 0,85 × (1 − 0,3·0,85) = 0,633). */
export const EFFECT_LIGHT_ALBEDO = 0.85 * (1 - 0.3 * 0.85);

/**
 * Hak `hullEffectLights`: światła efektów z siatki świateł (zadanie 12 — błyski, trafienia,
 * pociski, wiązki) jako DODATKOWE światła poszycia. Model jak powierzchnia dema broni
 * (SurfaceLightingModel: Lambert z zawinięciem 0,25, Blinn–Phong 40, barwa × moc bez 1/π),
 * normalna kadłuba z ctx.worldNormal (układ sceny = układ siatki), widz z góry (0, 0, 1).
 * owner — węzeł właściciela (światła tego właściciela pomijane; 0 = nic).
 */
export function hullEffectLighting(ctx, grid, owner) {
  const sum = vec3(0.0).toVar();
  const N = ctx.worldNormal;
  const albedo = ctx.albedo.mul(EFFECT_LIGHT_ALBEDO).toVar();
  const specK = float(0.25).sub(ctx.woundScorch ? ctx.woundScorch.mul(0.176) : float(0.0)).toVar();
  const P = grid.localPosition().toVar();
  grid.loop(P, ({ toL, att, col }) => {
    const NdotL = dot(N, toL).toVar();
    const c = col.mul(att).toVar();
    const lambert = clamp(NdotL.add(0.25).div(1.25), 0.0, 1.0);
    sum.addAssign(albedo.mul(c).mul(lambert));
    const ndh = max(dot(N, normalize(toL.add(vec3(0.0, 0.0, 1.0)))), 0.0);
    sum.addAssign(c.mul(vec3(0.88, 0.88, 0.886)).mul(pow(ndh, 40.0).mul(specK)).mul(max(NdotL, 0.0)));
  }, owner);
  return sum;
}
