// src/3d/planetGen/planetGenNoise.tsl.js
//
// Szum generatora planet (TSL). Wszystko liczone w 3D na kuli jednostkowej (kierunek z uv mapy) — mapa bez szwu
// na zawinięciu długości i bez ściśnięcia przy biegunach. Ziarno planety = przesunięcie dziedziny (`uSeed.xyz`,
// < 1 000 — float32 trzyma ułamek komórki z zapasem) i liczba całkowita w haszach kraterów.
//
// Zasady (reguła webgpu-tsl): funkcje z setLayout są CZYSTE (tylko parametry, pułapka 1) i PŁASKIE — nie wołają
// innych funkcji z layoutem (pułapka 35); hasz wklejany (zwykła funkcja JS). Pętle oktaw — wklejane, liczba oktaw
// z uniformu (bez rozwijania). Potęgi całkowite mnożeniem (pow z ujemną podstawą = NaN, pułapka 3).
import {
  Fn, If, Loop, float, int, vec3, vec4, ivec3, uvec3, uint, mat3,
  abs, cos, dot, exp, floor, fract, max, min, mix, normalize, cross, sin, smoothstep, sqrt, atan, clamp, length
} from 'three/tsl';

// ── Hasz całkowity 3D (jak sunHashU w planet3d.assets.tsl.js) ───────────────────────────────────────────────────
// i32 → u32 w WGSL to przepisanie bitów — ujemne węzły kraty działają.
export const pgHashU = (c) => {
  const q = uvec3(c).mul(uvec3(1597334673, 3812015801, 2798796415)).toVar();
  const h = q.x.bitXor(q.y).bitXor(q.z).mul(uint(1597334673)).toVar();
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  h.assign(h.mul(uint(2246822519)));
  h.assign(h.bitXor(h.shiftRight(uint(13))));
  return h;
};
/** Drugi hasz z pierwszego (kolejne losowania tej samej komórki). */
export const pgRehash = (h) => {
  const x = h.mul(uint(747796405)).add(uint(2891336453)).toVar();
  x.assign(x.bitXor(x.shiftRight(uint(15))).mul(uint(277803737)));
  return x.bitXor(x.shiftRight(uint(17)));
};
/** Trzy pola po 10 bitów → vec3 w [0, 1]. */
export const pgU3 = (h) => vec3(
  float(h.bitAnd(uint(1023))), float(h.shiftRight(uint(10)).bitAnd(uint(1023))), float(h.shiftRight(uint(20)).bitAnd(uint(1023)))
).mul(1.0 / 1023.0);
/** 24 bity → float w [0, 1). */
export const pgU1 = (h) => float(h.shiftRight(uint(8))).mul(1.0 / 16777216.0);

// ── Szum gradientowy 3D (wygładzenie kwintyczne), wynik ~[−1, 1] ─────────────────────────────────────────────────
export const pgNoise = /*@__PURE__*/ Fn(([p]) => {
  const i = ivec3(floor(p)).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const g = (x, y, z) => dot(pgU3(pgHashU(i.add(ivec3(x, y, z)))).mul(2.0).sub(1.0), f.sub(vec3(x, y, z)));
  return mix(
    mix(mix(g(0, 0, 0), g(1, 0, 0), u.x), mix(g(0, 1, 0), g(1, 1, 0), u.x), u.y),
    mix(mix(g(0, 0, 1), g(1, 0, 1), u.x), mix(g(0, 1, 1), g(1, 1, 1), u.x), u.y),
    u.z
  ).mul(1.6);
}).setLayout({ name: 'pgNoise', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

// Szum gradientowy z pochodnymi (I. Quilez): vec4(wartość, ∂/∂x, ∂/∂y, ∂/∂z) — do fbm „erozyjnego” (oktawy gasną
// tam, gdzie zbocze strome: grzbiety ostre, doliny gładkie).
export const pgNoised = /*@__PURE__*/ Fn(([x]) => {
  const i = ivec3(floor(x)).toVar();
  const w = fract(x).toVar();
  const u = w.mul(w).mul(w).mul(w.mul(w.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const du = w.mul(w).mul(30.0).mul(w.mul(w.sub(2.0)).add(1.0)).toVar();
  const gr = (a, b, c) => pgU3(pgHashU(i.add(ivec3(a, b, c)))).mul(2.0).sub(1.0).toVar();
  const ga = gr(0, 0, 0); const gb = gr(1, 0, 0); const gc = gr(0, 1, 0); const gd = gr(1, 1, 0);
  const ge = gr(0, 0, 1); const gf = gr(1, 0, 1); const gg = gr(0, 1, 1); const gh = gr(1, 1, 1);
  const va = dot(ga, w).toVar();
  const vb = dot(gb, w.sub(vec3(1, 0, 0))).toVar();
  const vc = dot(gc, w.sub(vec3(0, 1, 0))).toVar();
  const vd = dot(gd, w.sub(vec3(1, 1, 0))).toVar();
  const ve = dot(ge, w.sub(vec3(0, 0, 1))).toVar();
  const vf = dot(gf, w.sub(vec3(1, 0, 1))).toVar();
  const vg = dot(gg, w.sub(vec3(0, 1, 1))).toVar();
  const vh = dot(gh, w.sub(vec3(1, 1, 1))).toVar();
  const k1 = vb.sub(va).toVar();
  const k2 = vc.sub(va).toVar();
  const k3 = ve.sub(va).toVar();
  const k4 = va.sub(vb).sub(vc).add(vd).toVar();
  const k5 = va.sub(vc).sub(ve).add(vg).toVar();
  const k6 = va.sub(vb).sub(ve).add(vf).toVar();
  const k7 = va.negate().add(vb).add(vc).sub(vd).add(ve).sub(vf).sub(vg).add(vh).toVar();
  const value = va.add(k1.mul(u.x)).add(k2.mul(u.y)).add(k3.mul(u.z)).add(k4.mul(u.x).mul(u.y))
    .add(k5.mul(u.y).mul(u.z)).add(k6.mul(u.z).mul(u.x)).add(k7.mul(u.x).mul(u.y).mul(u.z));
  const grad = ga.add(gb.sub(ga).mul(u.x)).add(gc.sub(ga).mul(u.y)).add(ge.sub(ga).mul(u.z))
    .add(ga.sub(gb).sub(gc).add(gd).mul(u.x.mul(u.y)))
    .add(ga.sub(gc).sub(ge).add(gg).mul(u.y.mul(u.z)))
    .add(ga.sub(gb).sub(ge).add(gf).mul(u.z.mul(u.x)))
    .add(ga.negate().add(gb).add(gc).sub(gd).add(ge).sub(gf).sub(gg).add(gh).mul(u.x.mul(u.y).mul(u.z)))
    .add(du.mul(vec3(
      k1.add(k4.mul(u.y)).add(k6.mul(u.z)).add(k7.mul(u.y).mul(u.z)),
      k2.add(k4.mul(u.x)).add(k5.mul(u.z)).add(k7.mul(u.z).mul(u.x)),
      k3.add(k6.mul(u.x)).add(k5.mul(u.y)).add(k7.mul(u.x).mul(u.y))
    )));
  return vec4(value, grad).mul(1.6);
}).setLayout({ name: 'pgNoised', type: 'vec4', inputs: [{ name: 'x', type: 'vec3' }] });

// ── Komórki (Worley 3 × 3 × 3): vec4(F1, F2, hasz najbliższej, hasz drugiej) — płyty, plamy, bloki lodu ─────────────
export const pgCells = /*@__PURE__*/ Fn(([p, jitter]) => {
  const ip = ivec3(floor(p)).toVar();
  const fp = fract(p).toVar();
  const f1 = float(9.0).toVar();
  const f2 = float(9.0).toVar();
  const h1 = uint(0).toVar();
  const h2 = uint(0).toVar();
  Loop(
    { start: -1, end: 1, condition: '<=', name: 'pz' },
    { start: -1, end: 1, condition: '<=', name: 'py' },
    { start: -1, end: 1, condition: '<=', name: 'px' },
    ({ px, py, pz }) => {
      const c = ivec3(px, py, pz).toVar();
      const h = pgHashU(ip.add(c)).toVar();
      const o = pgU3(h).sub(0.5).mul(jitter).add(0.5);
      const d = vec3(c).add(o).sub(fp).toVar();
      const dd = dot(d, d).toVar();
      If(dd.lessThan(f1), () => {
        f2.assign(f1); h2.assign(h1);
        f1.assign(dd); h1.assign(h);
      }).ElseIf(dd.lessThan(f2), () => {
        f2.assign(dd); h2.assign(h);
      });
    }
  );
  return vec4(sqrt(f1), sqrt(f2), pgU1(pgRehash(h1)), pgU1(pgRehash(h2)));
}).setLayout({ name: 'pgCells', type: 'vec4', inputs: [{ name: 'p', type: 'vec3' }, { name: 'jitter', type: 'float' }] });

// ── Komórki GŁADKIE: vec4(F1, F2, średnia wartości komórek ważona e^(−k·d²), —) — wartość przypisana komórce bez
// skoku na krawędzi (zwykłe „hasz najbliższej” skacze tam, gdzie zmienia się druga najbliższa — kanciaste lądy).
export const pgCellsSmooth = /*@__PURE__*/ Fn(([p, jitter, sharp]) => {
  const ip = ivec3(floor(p)).toVar();
  const fp = fract(p).toVar();
  const f1 = float(9.0).toVar();
  const f2 = float(9.0).toVar();
  const sw = float(0.0).toVar();
  const sv = float(0.0).toVar();
  Loop(
    { start: -1, end: 1, condition: '<=', name: 'sz' },
    { start: -1, end: 1, condition: '<=', name: 'sy' },
    { start: -1, end: 1, condition: '<=', name: 'sx' },
    ({ sx, sy, sz }) => {
      const c = ivec3(sx, sy, sz).toVar();
      const h = pgHashU(ip.add(c)).toVar();
      const o = pgU3(h).sub(0.5).mul(jitter).add(0.5);
      const d = vec3(c).add(o).sub(fp).toVar();
      const dd = dot(d, d).toVar();
      const w = exp(dd.mul(sharp).negate());
      sw.addAssign(w);
      sv.addAssign(w.mul(pgU1(pgRehash(h))));
      If(dd.lessThan(f1), () => { f2.assign(f1); f1.assign(dd); }).ElseIf(dd.lessThan(f2), () => { f2.assign(dd); });
    }
  );
  return vec4(sqrt(f1), sqrt(f2), sv.div(max(sw, 1e-6)), 0.0);
}).setLayout({ name: 'pgCellsSmooth', type: 'vec4', inputs: [{ name: 'p', type: 'vec3' }, { name: 'jitter', type: 'float' }, { name: 'sharp', type: 'float' }] });

// ── Oktawa kraterów: komórki 3 × 3 × 3 kraty (krater w komórce z prawdopodobieństwem `dens`), profil prosty
// (misa paraboliczna, wał, wyrzut) albo złożony (płaskie dno, górka centralna — `complex`), wiek z haszu
// (stare — płytsze i rozmyte). Wynik vec4: x — wysokość [w promieniach komórki], y — jasność świeżego wyrzutu
// (0…1), z — promienie świeżych kraterów (0…1, tylko gdy `rays` > 0,5), w — maska dna dużych kraterów.
// `pDir` — kierunek punktu na kuli (oś do kąta promieni), `seedI` — ziarno oktawy (liczba całkowita w float).
export const pgCraterOctave = /*@__PURE__*/ Fn(([p, pDir, dens, rMin, rMax, seedI, complex, fresh, rays]) => {
  const ip = ivec3(floor(p)).toVar();
  const fp = fract(p).toVar();
  const hs = float(0.0).toVar();
  const ej = float(0.0).toVar();
  const ray = float(0.0).toVar();
  const fl = float(0.0).toVar();
  const si = int(seedI).toVar();
  const so = ivec3(si.mul(37), si.mul(101).add(7), si.mul(13).add(3)).toVar();
  // osie do kąta wokół środka krateru (płaszczyzna styczna)
  const t1 = normalize(cross(pDir, vec3(0.31, 0.95, 0.12))).toVar();
  const t2 = cross(pDir, t1).toVar();
  Loop(
    { start: -1, end: 1, condition: '<=', name: 'cz' },
    { start: -1, end: 1, condition: '<=', name: 'cy' },
    { start: -1, end: 1, condition: '<=', name: 'cx' },
    ({ cx, cy, cz }) => {
      const c = ivec3(cx, cy, cz).toVar();
      const h = pgHashU(ip.add(c).add(so)).toVar();
      const h2 = pgRehash(h).toVar();
      If(pgU1(h).lessThan(dens), () => {
        const o = pgU3(h2).mul(0.6).add(0.2);
        const s = pgU1(pgRehash(h2)).toVar();
        const rad = mix(rMin, rMax, s.mul(s).mul(s)).toVar();     // rozkład potęgowy: dużo małych, mało dużych
        const age = fract(s.mul(17.31).add(pgU3(h).x.mul(3.7))).toVar();
        const dv = vec3(c).add(o).sub(fp).toVar();
        // obrys lekko nieregularny (kratery nie są idealnymi okręgami): promień falujący z kierunkiem
        const du = dv.div(rad);
        const wob = sin(dot(du, vec3(3.1, 2.3, 2.7)).add(s.mul(29.0))).mul(0.045)
          .add(sin(dot(du, vec3(-1.7, 4.3, 1.9)).add(age.mul(31.0))).mul(0.035));
        const r = length(dv).div(rad).mul(float(1.0).add(wob)).toVar();
        If(r.lessThan(3.2), () => {
          const fade = float(1.0).sub(smoothstep(2.2, 3.1, r)).toVar();
          // misa (głębokość 0,42 promienia — d/D ≈ 0,2), wał gaussowski, wyrzut za wałem
          const bowl = r.mul(r).sub(1.0).mul(0.42).mul(float(1.0).sub(step01(r))).toVar();
          const floorLvl = mix(-0.42, -0.2, complex);
          bowl.assign(max(bowl, mix(bowl, floorLvl, complex)));
          const rr = r.sub(1.0).div(0.22);
          const rim = exp(rr.mul(rr).negate()).mul(0.075);
          const out = max(r.sub(1.0), 0.0);
          const ejecta = exp(out.mul(-2.6)).mul(0.03).mul(step01(r));
          const peak = exp(r.mul(r).mul(-28.0)).mul(0.16).mul(complex);
          const wear = mix(1.0, 0.18, sqrt(age));       // stare kratery zatarte
          hs.addAssign(bowl.add(rim).add(ejecta.mul(fade)).add(peak).mul(rad).mul(wear));
          fl.assign(max(fl, float(1.0).sub(smoothstep(0.55, 0.95, r)).mul(smoothstep(0.5, 0.9, rad.div(max(rMax, 1e-4))))));
          // świeże: jasny wyrzut (miękka aureola), promienie tylko dużych i najmłodszych
          const isFresh = float(1.0).sub(smoothstep(fresh.mul(0.5), fresh, age)).toVar();
          If(isFresh.greaterThan(0.001), () => {
            ej.assign(max(ej, isFresh.mul(exp(out.mul(-1.8))).mul(smoothstep(0.0, 0.9, r).mul(0.6).add(0.4)).mul(fade)));
            If(rays.greaterThan(0.5).and(age.lessThan(fresh.mul(0.35))), () => {
              const ang = atan(dot(dv, t2), dot(dv, t1));
              const ph = s.mul(41.0);
              // nieregularne promienie: suma sinusów o niewspółmiernych częstościach kąta, przerywane wzdłuż promienia
              const n = sin(ang.mul(5.0).add(ph)).mul(0.45).add(sin(ang.mul(11.3).add(ph.mul(1.7))).mul(0.35))
                .add(sin(ang.mul(23.7).add(ph.mul(2.3))).mul(0.2));
              const breakup = sin(r.mul(2.3).add(ang.mul(3.1)).add(ph)).mul(0.35).add(0.65);
              const streak = smoothstep(0.42, 0.85, n).mul(breakup).mul(exp(out.mul(-0.7))).mul(step01(r)).mul(fade);
              ray.assign(max(ray, streak.mul(isFresh).mul(smoothstep(0.45, 0.95, rad.div(max(rMax, 1e-4))))));
            });
          });
        });
      });
    }
  );
  return vec4(hs, ej, ray, fl);
}).setLayout({
  name: 'pgCraterOctave', type: 'vec4', inputs: [
    { name: 'p', type: 'vec3' }, { name: 'pDir', type: 'vec3' }, { name: 'dens', type: 'float' }, { name: 'rMin', type: 'float' },
    { name: 'rMax', type: 'float' }, { name: 'seedI', type: 'float' }, { name: 'complex', type: 'float' }, { name: 'fresh', type: 'float' },
    { name: 'rays', type: 'float' }
  ]
});
// 0 wewnątrz (r < 1), 1 na zewnątrz — miękko (bez pochodnych, w pętli dozwolone)
function step01(r) { return smoothstep(0.98, 1.02, r); }

// ── Oktawy (wklejane) ──────────────────────────────────────────────────────────────────────────────────────────
// Obrót między oktawami (ortonormalny) — kolejne oktawy nie układają się w kratę.
export const PG_ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

/** fbm szumu gradientowego: n oktaw (węzeł int), lakunarność, wzmocnienie. Wynik ~[−1, 1]. */
export function pgFbm(p0, octaves, lac = 2.03, gain = 0.5) {
  const f = float(0.0).toVar();
  const amp = float(1.0).toVar();
  const norm = float(0.0).toVar();
  const p = vec3(p0).toVar();
  Loop({ start: int(0), end: int(octaves), type: 'int', condition: '<' }, () => {
    f.addAssign(amp.mul(pgNoise(p)));
    norm.addAssign(amp);
    p.assign(PG_ROT.mul(p).mul(lac).add(vec3(1.7, -3.1, 2.3)));
    amp.mulAssign(gain);
  });
  return f.div(max(norm, 1e-4));
}

/**
 * fbm „erozyjny” (pochodne): oktawy tłumione przez nagromadzone nachylenie — grzbiety i żleby jak po erozji.
 * `k` — siła tłumienia. Wynik ~[−1, 1].
 */
export function pgErodedFbm(p0, octaves, k = 1.0, lac = 2.0, gain = 0.5) {
  const f = float(0.0).toVar();
  const amp = float(1.0).toVar();
  const norm = float(0.0).toVar();
  const d = vec3(0.0).toVar();
  const p = vec3(p0).toVar();
  const fr = float(1.0).toVar();
  Loop({ start: int(0), end: int(octaves), type: 'int', condition: '<' }, () => {
    const n = pgNoised(p).toVar();
    d.addAssign(n.yzw.mul(amp).mul(fr));
    f.addAssign(amp.mul(n.x).div(float(1.0).add(dot(d, d).mul(k))));
    norm.addAssign(amp);
    p.assign(PG_ROT.mul(p).mul(lac).add(vec3(-2.1, 1.3, 0.7)));
    fr.mulAssign(lac);
    amp.mulAssign(gain);
  });
  return f.div(max(norm, 1e-4));
}

/**
 * Wielofraktal grzbietowy (Musgrave): ostre grzbiety, waga kolejnej oktawy z sygnału poprzedniej. Wynik ~[0, 1].
 */
export function pgRidged(p0, octaves, lac = 2.1, gain = 0.55, offset = 1.0, sharp = 2.0) {
  const f = float(0.0).toVar();
  const amp = float(1.0).toVar();
  const norm = float(0.0).toVar();
  const w = float(1.0).toVar();
  const p = vec3(p0).toVar();
  Loop({ start: int(0), end: int(octaves), type: 'int', condition: '<' }, () => {
    const s = float(offset).sub(abs(pgNoise(p))).toVar();
    s.assign(max(s, 0.0));
    s.assign(s.mul(s));
    s.mulAssign(w);
    w.assign(clamp(s.mul(sharp), 0.0, 1.0));
    f.addAssign(s.mul(amp));
    norm.addAssign(amp);
    p.assign(PG_ROT.mul(p).mul(lac).add(vec3(0.9, 2.7, -1.9)));
    amp.mulAssign(gain);
  });
  return f.div(max(norm, 1e-4));
}

/** Odkształcenie dziedziny: wektor z trzech fbm (oktawy), amplituda w jednostkach p. */
export function pgWarp(p, octaves, amp) {
  return vec3(
    pgFbm(p, octaves),
    pgFbm(p.add(vec3(5.2, 1.3, -2.8)), octaves),
    pgFbm(p.add(vec3(-3.7, 4.1, 8.3)), octaves)
  ).mul(amp);
}

/** Liczba oktaw z rozdzielczości mapy: najdrobniejsza o okresie ≥ `minTexels` tekseli równika. */
export function pgOctavesFor(texW, f0, lac, minTexels = 3.0, cap = 12) {
  // okres oktawy k [rad] = 1 / (f0 · lac^k); teksel równika = 2π / texW
  const kMax = Math.log((texW / (2 * Math.PI)) / (f0 * minTexels)) / Math.log(lac);
  return Math.max(1, Math.min(cap, Math.floor(kMax) + 1));
}
