// HUTA — wytop: WSKAŹNIKI TLENU (runda 5, etap „odciąg w kadrze”). Jedna siatka i jeden mały materiał TSL: światło
// tlenu płynące od studni do zbiorników — bez pola gazu, z samych liczb symulacji (`komora.js`: `STAN.pipeU`,
// `gasFlow`, `ductFlow`, `tank0…2`, `tankFill`, `tankDrain`, `hood`, `wentyl`; `view.gazRura` — gaz w przedziałach rury).
//
// Pasy na bryłach odciągu (bryły: `wyposazenie.js`, geometria: `KOMORA.gaz`):
//   0  grzbiet rury zbiorczej (od wyjścia z pokładu do rozdzielacza) — impulsy jadą z gazem: jasność z gazu
//      w przedziale rury pod punktem, faza z `pipeU` (stoi, gdy w rurze nie ma gazu)
//   1  grzbiet rozdzielacza — świeci odcinek od wejścia rury do odgałęzienia napełnianego zbiornika
//   2  grzbiet odgałęzienia — świeci tylko odgałęzienie napełnianego zbiornika
//   3  LISTWA NAPEŁNIENIA na grzbiecie zbiornika — rośnie od strony rozdzielacza (długość = napełnienie); przy
//      opróżnianiu cofa się, a po niej biegną szybkie impulsy ku wylotowi
//   4  kreska światła w gardle okapu — jasność z przepływu odciągu (tylko gdy okapy ssą: wentylacja 0 g)
//   5  grzbiet wylotu do sieci ringu — impulsy, gdy zbiornik oddaje tlen
// Barwa tlenu: bladoniebieska biel — obca dla żaru i żużla. Wszystko pod kontrolą jasności (pasy są wąskie: dają
// małą poświatę, nie zalewają kadru).
//
// `buildOxygenArrays()` jest czysty (bez three) — test sprawdza bryłę bez NaN i położenie pasów na bryłach.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import { Fn, abs, attribute, cameraProjectionMatrix, clamp, exp, float, floor, fract, int, max, min, mix, modelViewMatrix, sin, smoothstep, step, vec3, vec4 } from 'three/tsl';
import { KOMORA, gasPipeRoute, pathSample } from './geometria.js';
import { GAZ_PROCES } from './gaz.js';

const DEG = Math.PI / 180;
/** Barwa tlenu (liniowa). */
export const OXY = Object.freeze([0.55, 0.78, 1.0]);
/** Pasy wskaźników: rodzaje (atrybut `aI.x`). */
export const PAS = Object.freeze({ rura: 0, rozdzielacz: 1, odgalezienie: 2, listwa: 3, okap: 4, wylot: 5 });
/** Gaz w przedziale rury, przy którym impuls świeci pełną jasnością [t] (≈ przepływ 1,2 t/s). */
const DUCT_REF = 0.06;
/** Długość odniesienia drogi impulsów [j.] — droga do środkowego zbiornika z rundy 5 (rura na pokładzie przy studni). */
const OXY_L_REF = 467;

/**
 * Siatka pasów: pozycja (układ komory), normalna, `aI` = (rodzaj, droga s [j.] albo u 0…1, numer zbiornika / okapu,
 * pomocnicza: z punktu na rozdzielaczu). Pasy leżą 0,6 j. nad powierzchnią bryły.
 */
export function buildOxygenArrays() {
  const G = KOMORA.gaz;
  const P = G.pipe;
  const T = G.tanks;
  const pos = [];
  const nor = [];
  const aux = [];
  const quad = (a, b, c, d, n, ia, ib, ic, id) => {
    for (const [p, q] of [[a, ia], [b, ib], [c, ic], [a, ia], [c, ic], [d, id]]) { pos.push(...p); nor.push(...n); aux.push(...q); }
  };
  const route = gasPipeRoute(0);
  const main = route.main;
  const yd = route.deck;
  const vz = route.vertical[1];
  const xh = P.x - P.rh;
  const W = 1.9;
  // 0: grzbiet rury głównej — wzdłuż drogi 3D (runda 6: po kołnierzu naczynia, pionem po płaszczu do hali, po pokładzie
  // hali). Na odcinkach poziomych pas leży na wierzchu rury, na pionie — od strony zewnętrznej (widać go z boku), na
  // łukach przechodzi płynnie między nimi
  {
    const sEnd = main.len - P.rh;
    const ss = [];
    for (const p of main.pieces) {
      const n = p.type === 'arc' ? 8 : Math.max(2, Math.ceil(p.len / 12));
      for (let i = 0; i < n; i++) ss.push(p.s0 + (p.len * i) / n);
    }
    ss.push(sEnd);
    const q = new Float64Array(6);
    const frame = (s) => {
      pathSample(main, s, q);
      const t = [q[3], q[4], q[5]];
      const rl = Math.hypot(q[0], q[2]) || 1;
      const w = Math.min(1, Math.abs(t[1]));
      let n = [q[0] / rl * w, 1 - w, q[2] / rl * w];
      const d = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
      n = [n[0] - t[0] * d, n[1] - t[1] * d, n[2] - t[2] * d];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / nl, n[1] / nl, n[2] / nl];
      const b = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
      const c = [q[0] + n[0] * (P.r + 0.6), q[1] + n[1] * (P.r + 0.6), q[2] + n[2] * (P.r + 0.6)];
      return { c, n, b };
    };
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = Math.min(ss[i], sEnd);
      const s1 = Math.min(ss[i + 1], sEnd);
      if (s1 - s0 < 1e-6) continue;
      const A = frame(s0);
      const B = frame(s1);
      const pa = (F, k) => [F.c[0] + F.b[0] * W * k, F.c[1] + F.b[1] * W * k, F.c[2] + F.b[2] * W * k];
      const nn = [(A.n[0] + B.n[0]) / 2, (A.n[1] + B.n[1]) / 2, (A.n[2] + B.n[2]) / 2];
      quad(pa(A, -1), pa(B, -1), pa(B, 1), pa(A, 1), nn,
        [PAS.rura, s0, -1, vz], [PAS.rura, s1, -1, vz], [PAS.rura, s1, -1, vz], [PAS.rura, s0, -1, vz]);
    }
  }
  const sMain = main.len;
  // 1: grzbiet rozdzielacza (wzdłuż z); droga od wejścia rury
  {
    const y = yd + P.rh + 0.6;
    const n = 40;
    for (let i = 0; i < n; i++) {
      const z0 = P.z0 + 14 + (P.z1 - P.z0 - 28) * i / n;
      const z1 = P.z0 + 14 + (P.z1 - P.z0 - 28) * (i + 1) / n;
      quad([P.x - W, y, z0], [P.x - W, y, z1], [P.x + W, y, z1], [P.x + W, y, z0], [0, 1, 0],
        [PAS.rozdzielacz, sMain + Math.abs(z0 - vz), -1, z0], [PAS.rozdzielacz, sMain + Math.abs(z1 - vz), -1, z1],
        [PAS.rozdzielacz, sMain + Math.abs(z1 - vz), -1, z1], [PAS.rozdzielacz, sMain + Math.abs(z0 - vz), -1, z0]);
    }
  }
  // 2: odgałęzienia (z rozdzielacza do dennicy zbiornika), 3: listwy, 5: wyloty
  const rb = branchR();
  T.z.forEach((zk, k) => {
    {
      const y = yd + rb + 0.6;
      const xb0 = P.x + P.rh * 0.7;
      const xb1 = T.x0 + 2;
      const sb = sMain + Math.abs(zk - vz);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const x0 = xb0 + (xb1 - xb0) * i / n;
        const x1 = xb0 + (xb1 - xb0) * (i + 1) / n;
        // (zawór w połowie odgałęzienia zasłania pas — pas idzie po nim, bez przerwy)
        quad([x0, y, zk - W * 0.8], [x1, y, zk - W * 0.8], [x1, y, zk + W * 0.8], [x0, y, zk + W * 0.8], [0, 1, 0],
          [PAS.odgalezienie, sb + x0 - P.x, k, zk], [PAS.odgalezienie, sb + x1 - P.x, k, zk], [PAS.odgalezienie, sb + x1 - P.x, k, zk], [PAS.odgalezienie, sb + x0 - P.x, k, zk]);
      }
    }
    {
      // listwa na grzbiecie walca zbiornika: od strony rozdzielacza (u = 0) ku wylotowi (u = 1)
      const xs = T.x0 + T.head + 8;
      const xe = T.x1 - T.head - 8;
      const n = 60;
      const half = T.strip / 2;
      const R = T.r + 0.6;
      for (let i = 0; i < n; i++) {
        const x0 = xs + (xe - xs) * i / n;
        const x1 = xs + (xe - xs) * (i + 1) / n;
        const u0 = i / n;
        const u1 = (i + 1) / n;
        for (let j = 0; j < 2; j++) {
          const t0 = -half + j * half;
          const t1 = t0 + half;
          const p = (x, t) => [x, T.y + Math.cos(t) * R, zk + Math.sin(t) * R];
          const nm = (t) => [0, Math.cos(t), Math.sin(t)];
          const nn = nm((t0 + t1) / 2);
          quad(p(x0, t0), p(x1, t0), p(x1, t1), p(x0, t1), nn, [PAS.listwa, u0, k, t0 / half], [PAS.listwa, u1, k, t0 / half], [PAS.listwa, u1, k, t1 / half], [PAS.listwa, u0, k, t1 / half]);
        }
      }
    }
    {
      // wylot: od dennicy do łuku w pokład przy krawędzi
      const y = T.y + 9 + 0.6;
      const xw0 = T.x1 + 2;
      const xw1 = T.outX - (T.y - KOMORA.hallY);
      const n = 4;
      for (let i = 0; i < n; i++) {
        const x0 = xw0 + (xw1 - xw0) * i / n;
        const x1 = xw0 + (xw1 - xw0) * (i + 1) / n;
        const u0 = i / n;
        const u1 = (i + 1) / n;
        quad([x0, y, zk - 1.4], [x1, y, zk - 1.4], [x1, y, zk + 1.4], [x0, y, zk + 1.4], [0, 1, 0],
          [PAS.wylot, u0, k, 0], [PAS.wylot, u1, k, 0], [PAS.wylot, u1, k, 0], [PAS.wylot, u0, k, 0]);
      }
    }
  });
  // 4: kreski w gardłach okapów (poziome pasy wzdłuż łuku, za żaluzjami)
  {
    const H = G.hoods;
    const [rt, yt] = H.throat;
    const segs = 30;
    H.az.forEach((azd, hi) => {
      const a0 = (azd - H.half + 1.2) * DEG;
      const a1 = (azd + H.half - 1.2) * DEG;
      for (let i = 0; i < segs; i++) {
        const b0 = a0 + (a1 - a0) * i / segs;
        const b1 = a0 + (a1 - a0) * (i + 1) / segs;
        const u0 = i / segs;
        const u1 = (i + 1) / segs;
        // (runda 5, poprawki — okapy czytelne z kamery gry): pas światła na całą szerokość gardła pod żaluzjami
        // (ρ 414…462, nad dnem okapu, pod licem wlotu) — z góry widać go między płytkami żaluzji; `aI.w` — położenie
        // w poprzek (−1 przy wardze … +1 przy ścianie)
        const p = (b, r) => [Math.cos(b) * r, yt + 6, Math.sin(b) * r];
        quad(p(b0, rt - 26), p(b1, rt - 26), p(b1, rt + 22), p(b0, rt + 22), [0, 1, 0],
          [PAS.okap, u0, hi, -1], [PAS.okap, u1, hi, -1], [PAS.okap, u1, hi, 1], [PAS.okap, u0, hi, 1]);
      }
    });
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), aI: new Float32Array(aux), count: pos.length / 3 };
}

/** Promień odgałęzienia rury zbiorczej. */
export function branchR() { return Math.round(KOMORA.gaz.pipe.r * 0.75); }

/** Długość drogi gazu od wyjścia z pokładu do dennicy zbiornika `k` (wzdłuż pasów 0–2) [j.]. */
export function oxyRouteLength(k) {
  const P = KOMORA.gaz.pipe;
  const T = KOMORA.gaz.tanks;
  const route = gasPipeRoute(0);
  return route.main.len + Math.abs(T.z[k] - route.vertical[1]) + (T.x0 + 2 - P.x);
}

/**
 * Materiał wskaźników. Uniformy (`createWytopUniforms`): `oxy` = (faza impulsów [przedziały rury], napełniany
 * zbiornik, przepływ odciągu 0…1, otwarcie żaluzji), `oxy2` = (napełnienie zbiorników 0…2, opróżniany: numer +
 * postęp, −1 — żaden), `oxy3` = (długość drogi do napełnianego zbiornika [j.], z jego odgałęzienia, wentylacja,
 * dopływ do zbiorników 0…1), `duct` — gaz w przedziałach rury [t] (wlot → separator), `U.ball.w` — czas.
 */
export function createOxygenMaterial(U) {
  const N = GAZ_PROCES.ductBuckets;
  const P = KOMORA.gaz.pipe;
  const fragment = Fn(() => {
    const aI = attribute('aI', 'vec4');
    const kind = float(0.0).toVar();
    kind.assign(floor(aI.x.add(0.5)));
    const s = aI.y;
    const k = aI.z;
    const is = (q) => float(1.0).sub(min(abs(kind.sub(q)), 1.0));
    const time = U.ball.w;
    const act = U.oxy.y;
    // --- rura, rozdzielacz, odgałęzienie: gaz w przedziale rury pod punktem × impulsy jadące z gazem ---------------
    const L = max(U.oxy3.x, 1.0);
    const sb = float(0.0).toVar();
    sb.assign(s.div(L).mul(N));
    const j = clamp(floor(sb), 0.0, N - 1);
    const q = U.duct.element(int(j.div(4.0))).toVar();
    const jm = j.sub(floor(j.div(4.0)).mul(4.0));
    const inBucket = float(0.0).toVar();
    inBucket.assign(q.x.mul(step(jm, 0.5)).add(q.y.mul(step(0.5, jm).mul(step(jm, 1.5)))).add(q.z.mul(step(1.5, jm).mul(step(jm, 2.5)))).add(q.w.mul(step(2.5, jm))));
    const gasHere = clamp(inBucket.div(DUCT_REF), 0.0, 1.6);
    // impulsy: co 2,5 przedziału, jadą z fazą `pipeU` (przedziały rury); kształt — krótka głowa i dłuższy ogon
    // (runda 6: droga rury jest ~5 × dłuższa — impulsy liczone w jednostkach świata z długością odniesienia drogi
    // rundy 5, więc mają tę samą długość, odstęp i prędkość co wcześniej; gaz w przedziałach — po całej drodze)
    const ph = fract(s.mul(N / OXY_L_REF).sub(U.oxy.x).div(2.5));
    const pulse = exp(ph.sub(0.82).div(0.07).mul(ph.sub(0.82).div(0.07)).negate()).add(exp(ph.sub(0.82).div(0.22).mul(ph.sub(0.82).div(0.22)).negate()).mul(0.35).mul(step(ph, 0.82)));
    // rozdzielacz: świeci odcinek między wejściem rury a odgałęzieniem napełnianego zbiornika
    const zp = aI.w;
    const zA = U.oxy3.y;
    const PZ = gasPipeRoute(0).vertical[1];
    const onHeader = step(float(0.0), zp.sub(PZ).mul(zA.sub(PZ)).add(0.01)).mul(step(abs(zp.sub(PZ)), abs(zA.sub(PZ)).add(1.0)));
    const onBranch = float(1.0).sub(min(abs(k.sub(act)), 1.0));
    const lineOn = is(0.0).add(is(1.0).mul(onHeader)).add(is(2.0).mul(onBranch));
    const pipeE = gasHere.mul(pulse.mul(1.25).add(0.16)).mul(lineOn);
    // --- listwa napełnienia zbiornika ------------------------------------------------------------------------------
    const fill = float(0.0).toVar();
    fill.assign(U.oxy2.x.mul(float(1.0).sub(min(abs(k), 1.0))).add(U.oxy2.y.mul(float(1.0).sub(min(abs(k.sub(1.0)), 1.0)))).add(U.oxy2.z.mul(float(1.0).sub(min(abs(k.sub(2.0)), 1.0)))));
    const drainK = floor(U.oxy2.w);
    const draining = step(0.0, U.oxy2.w).mul(float(1.0).sub(min(abs(k.sub(drainK)), 1.0)));
    const filling = onBranch.mul(clamp(U.oxy3.w, 0.0, 1.0)).mul(float(1.0).sub(draining));
    const lit = smoothstep(fill.add(0.004), fill.sub(0.004), s).mul(step(0.002, fill));
    // poziom w środku listwy jaśniejszy niż przy brzegach (rurka światła), czoło napełniania żywsze
    const across = float(1.0).sub(min(aI.w.mul(aI.w), 1.0).mul(0.55));
    // (wykładnik ograniczony: na pasach rury `s` to droga w setkach jednostek — exp(+s) dawał +∞ · 0 = NaN)
    const front = exp(max(fill.sub(s), 0.0).div(0.025).negate()).mul(lit);
    const shimmer = sin(s.mul(60.0).sub(time.mul(5.0))).mul(0.5).add(0.5);
    const drainRun = exp(fract(s.mul(5.0).sub(time.mul(3.4))).sub(0.85).div(0.06).mul(fract(s.mul(5.0).sub(time.mul(3.4))).sub(0.85).div(0.06)).negate());
    const stripE = lit.mul(across).mul(float(0.62).add(front.mul(filling).mul(0.9)).add(shimmer.mul(filling).mul(0.12)).add(drainRun.mul(draining).mul(0.9)));
    // --- kreska w gardle okapu: przepływ odciągu, gdy okapy ssą (0 g) ---------------------------------------------
    // pas światła w gardle (pod żaluzjami): jasność z przepływu odciągu i otwarcia żaluzji, chłodna; po pasie w poprzek
    // biegną ku ścianie (w głąb okapu) przygaszone fale — gaz jest zasysany; środek pasa jaśniejszy niż brzegi
    const suck = clamp(U.oxy3.z, 0.0, 1.0);
    const flowK = clamp(U.oxy.z.mul(1.6), 0.0, 1.0);
    const acrossH = float(1.0).sub(aI.w.mul(aI.w).mul(0.7));
    const hoodRun = fract(aI.w.mul(0.5).sub(time.mul(0.9)).add(s.mul(0.15)).add(k.mul(0.37)));
    const hoodE = flowK.mul(suck).mul(U.oxy.w.mul(0.7).add(0.3)).mul(acrossH).mul(float(0.24).add(exp(hoodRun.sub(0.5).div(0.16).mul(hoodRun.sub(0.5).div(0.16)).negate()).mul(0.26)));
    // --- wylot do sieci ringu: impulsy, gdy zbiornik oddaje tlen --------------------------------------------------
    const outRun = exp(fract(s.mul(1.6).sub(time.mul(3.0))).sub(0.8).div(0.1).mul(fract(s.mul(1.6).sub(time.mul(3.0))).sub(0.8).div(0.1)).negate());
    const outE = draining.mul(outRun.mul(1.6).add(0.25));
    const e = float(0.0).toVar();
    e.assign(pipeE.mul(max(max(is(0.0), is(1.0)), is(2.0))).add(stripE.mul(is(3.0))).add(hoodE.mul(is(4.0))).add(outE.mul(is(5.0))));
    // obudowa pasa (zgaszony): ciemne szkło z ledwie widocznym połyskiem tlenu
    const base = vec3(0.012, 0.016, 0.021).add(vec3(...OXY).mul(0.012));
    const col = vec3(0.0).toVar();
    col.assign(base.add(vec3(...OXY).mul(e.mul(1.2))));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  const vertex = Fn(() => cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(attribute('position', 'vec3'), 1.0))))();
  const mat = new NodeMaterial();
  mat.name = 'WytopTlen';
  mat.vertexNode = vertex;
  mat.fragmentNode = fragment;
  mat.side = THREE.DoubleSide;
  mat.fog = false;
  mat.lights = false;
  mat.toneMapped = false;
  return mat;
}

/** Siatka wskaźników tlenu (jedna, stała). */
export function createOxygenMesh(U) {
  const A = buildOxygenArrays();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(A.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(A.normal, 3));
  g.setAttribute('aI', new THREE.BufferAttribute(A.aI, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2200);
  const mesh = new THREE.Mesh(g, createOxygenMaterial(U));
  mesh.name = 'Wytop_tlen';
  mesh.frustumCulled = false;
  return mesh;
}
