// Wielka kopalnia ringu na Ziemi — węzły TSL dla grafu powierzchni planety (planet3d.assets.tsl.js).
//
// Kula Ziemi ma wycięty obszar dziury (uPitMode = 1: discard dla s < EARTH_PIT_CUT_S), a w jego
// miejscu leży ŁATA — prawdziwa bryła z profilu (earthPit3D.js, uPitMode = 2). Łata używa tego
// samego materiału i map co kula (szew niewidoczny); na łacie fragment liczy normalną ze wzoru
// profilu (tarasy ostre niezależnie od gęstości siatki), cień samorzucany marszem promienia ku
// słońcu po bryle (z przewyższeniem bryły) i żar szybu do gorącej skały.
//
// `earthPitProfile` = LUSTRO `earthPitProfileCpu` (earthPitShape.js) i `profil` w
// scripts/planety/dziura.py. Funkcja z layoutem jest czysta (liczby z danych wklejone jako stałe)
// i nie woła innych funkcji z layoutem (pułapka 35).
import {
  Fn, If, Loop, float, vec3, vec4, atan, sqrt, cos, sin, floor, fract, clamp, smoothstep, mix, abs,
  normalize, dot, length, max, pow
} from 'three/tsl';
import { EARTH_PIT } from '../data/earthPit.js';
import { earthPitFrame, EARTH_RADIUS_KM, EARTH_PIT_CUT_S } from './earthPitShape.js';

const DEG = Math.PI / 180;
const FRAME = earthPitFrame(EARTH_PIT);
const P = EARTH_PIT;

export const EARTH_PIT_TSL = Object.freeze({
  cutS: EARTH_PIT_CUT_S,
  rimS: 1 + P.rimWidth,
  exag: P.exaggeration,
  // żar szybu (HDR — świeci w bloomie), barwa skały ~900 °C
  glow: [2.4, 0.62, 0.14],
  glowDay: 0.45,
  skyFill: 0.11,
  marchSteps: 20,
  marchMax: 2.4 * FRAME.radiusAng * (1 + P.rimWidth)
});

// Szum wartości 3D (czysty, bez innych funkcji z layoutem): detal skały z bliska i pęknięcia żaru szybu.
export const earthPitNoise = /*@__PURE__*/ Fn(([x]) => {
  const i = floor(x).toVar();
  const f0 = fract(x).toVar();
  const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0))).toVar();
  const h = (o) => {
    const q = fract(i.add(o).mul(0.3183099).add(0.1)).mul(17.0);
    return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)));
  };
  return mix(
    mix(mix(h(vec3(0, 0, 0)), h(vec3(1, 0, 0)), f.x), mix(h(vec3(0, 1, 0)), h(vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h(vec3(0, 0, 1)), h(vec3(1, 0, 1)), f.x), mix(h(vec3(0, 1, 1)), h(vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}).setLayout({ name: 'earthPitNoise', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] });

/** Profil: vec4(wysokość względem krawędzi [km], s, azymut, ułamek tarasu) dla kierunku p. */
export const earthPitProfile = /*@__PURE__*/ Fn(([p]) => {
  const a = dot(p, vec3(...FRAME.E));
  const b = dot(p, vec3(...FRAME.N));
  const cz = dot(p, vec3(...FRAME.C));
  const rho = atan(sqrt(a.mul(a).add(b.mul(b))), cz);
  const phi = atan(b, a).toVar();
  let ob = float(1.0);
  for (const [k, amp, ph] of P.lobes) ob = ob.add(cos(phi.sub(ph * DEG).mul(k)).mul(amp));
  const s = rho.div(ob.mul(FRAME.radiusAng)).toVar();
  const f0 = float(1.0).sub(clamp(s.sub(P.floor).div(1.0 - P.floor), 0.0, 1.0)).toVar();
  const f = f0.add(sin(phi.mul(2.0).add(1.0)).mul(0.5).add(0.5).mul(P.benchWarp).mul(sin(f0.mul(Math.PI * P.benchWarpWaves))));
  const q = f.mul(P.benches).toVar();
  const k = floor(q);
  const fr = q.sub(k).toVar();
  const depth = k.add(smoothstep(1.0 - P.riser, 1.0, fr)).mul(P.depthKm / P.benches);
  const r = s.div(P.shaftR);
  const shaft = sqrt(max(float(1.0).sub(r.mul(r)), 0.0)).mul(P.shaftDepthKm);
  const berm = sin(clamp(s.sub(1.0).div(P.rimWidth), 0.0, 1.0).mul(Math.PI)).mul(P.rimBermKm);
  return vec4(berm.sub(depth).sub(shaft), s, phi, fr);
}).setLayout({ name: 'earthPitProfile', type: 'vec4', inputs: [{ name: 'p', type: 'vec3' }] });

/**
 * Cieniowanie łaty (wklejane — woła funkcję z layoutem). p = kierunek fragmentu (obiekt),
 * sunObj = kierunek ku słońcu (obiekt), prof = earthPitProfile(p). Zwraca { normal (obiekt),
 * shadow (0 cień … 1 słońce), glow (0…1) } jako węzły zmiennych.
 */
export function earthPitShade(p, sunObj, prof) {
  const T = EARTH_PIT_TSL;
  const kmToR = T.exag / EARTH_RADIUS_KM;
  const normal = vec3(p).toVar();
  const shadow = float(1.0).toVar();
  // normalna z różnic profilu wzdłuż stycznych (krok ~2 km)
  const d = 0.00032;
  const tE = normalize(vec3(...FRAME.E).sub(p.mul(dot(p, vec3(...FRAME.E))))).toVar();
  const tN = normalize(vec3(...FRAME.N).sub(p.mul(dot(p, vec3(...FRAME.N))))).toVar();
  const h0 = prof.x;
  const hE = earthPitProfile(normalize(p.add(tE.mul(d)))).x;
  const hN = earthPitProfile(normalize(p.add(tN.mul(d)))).x;
  const gE = clamp(hE.sub(h0).mul(T.exag / (d * EARTH_RADIUS_KM)), -6.0, 6.0);
  const gN = clamp(hN.sub(h0).mul(T.exag / (d * EARTH_RADIUS_KM)), -6.0, 6.0);
  normal.assign(normalize(p.sub(tE.mul(gE)).sub(tN.mul(gN))));
  // cień: promień od punktu bryły ku słońcu, porównanie z bryłą pod nim
  If(h0.lessThan(-0.05).and(dot(sunObj, p).greaterThan(-0.05)), () => {
    const start = p.mul(float(1.0).add(h0.mul(kmToR))).toVar();
    const occ = float(0.0).toVar();
    Loop(T.marchSteps, ({ i }) => {
      const t = float(i).add(1.0).div(T.marchSteps);
      const L = pow(max(0.0, t), 1.7).mul(T.marchMax);
      const q = start.add(sunObj.mul(L));
      const rq = length(q);
      const hq = earthPitProfile(q.div(rq)).x;
      const above = float(1.0).add(hq.mul(kmToR)).sub(rq);
      occ.assign(max(occ, smoothstep(0.0, 0.6 * kmToR, above)));
    });
    shadow.assign(float(1.0).sub(occ));
  });
  // żar szybu: rdzeń + sieć pęknięć (grzbiety szumu), ostre z każdej odległości
  const base = pow(max(0.0, float(1.0).sub(smoothstep(0.0, P.shaftR * 1.05, prof.y))), 1.2);
  const n1 = earthPitNoise(p.mul(2600.0));
  const n2 = earthPitNoise(p.mul(9000.0).add(7.3));
  const ridge = float(1.0).sub(abs(n1.mul(2.0).sub(1.0)));
  const cracks = pow(max(0.0, ridge), 5.0).mul(0.75).add(pow(max(0.0, float(1.0).sub(abs(n2.mul(2.0).sub(1.0)))), 8.0).mul(0.5));
  const core = float(1.0).sub(smoothstep(0.0, P.shaftR * 0.55, prof.y));
  const glow = base.mul(cracks.mul(1.7).add(core.mul(core).mul(0.9)).add(0.08));
  // detal skały (albedo) — dwie oktawy, z bliska tekstura 8K ma ~5 km na teksel
  const detail = earthPitNoise(p.mul(14000.0)).mul(0.22).add(earthPitNoise(p.mul(52000.0)).mul(0.16)).add(0.81);
  return { normal, shadow, glow, detail };
}

export { EARTH_PIT_CUT_S };
