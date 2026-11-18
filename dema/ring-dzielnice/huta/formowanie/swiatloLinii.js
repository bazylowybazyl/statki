// HUTA — formowanie: ŚWIATŁO LINII i CIEŃ NACZYNIA (węzły TSL wklejane, bez layoutu — pułapka 1 i 35).
//
// ŚWIATŁO LINII: blok 16 źródeł × 2 vec4 (jeden bufor uniformów, stała nazwa — pułapka 25): źródło `i` to odcinek
// [A_i.xyz → B_i.xyz] o promieniu A_i.w (odcinek o zerowej długości = kula), B_i.w = temperatura T̃ (barwa `heatColor`,
// moc `heatPower` — ta sama mowa co kula wytopu). Układ źródeł (PROJEKT § 3): [0] zasobnik, [1] struga, [2–13] odcinki
// pasma od G0 do bramy, [14] błysk chwytu, [15] zapas. W etapie „Złożenie” wszystkie zgaszone (T̃ = 0) — wypełnia je
// etap „Pasmo” (`fillLineLights`). Światło liczone analitycznie w materiałach linii i otoczenia; żadnych świateł sceny.
//
// CIEŃ NACZYNIA na hali (słońce gry, układ komory): promień ku słońcu z punktu P przecina bryłę obrotową naczynia
// (kołnierz, walec, stożek, dysza — profil bez zaokrągleń) albo płytę pomostu górnego. Liczone na trzech pasach
// wysokości w punkcie największego zbliżenia promienia do osi (przycięte do pasa i do t ≥ 0); brzeg miękki.
import * as THREE from 'three';
import { Loop, abs, clamp, dot, float, int, length, max, min, mix, smoothstep, sqrt, uniformArray, vec2, vec3 } from 'three/tsl';
import { KOMORA } from '../wytop/geometria.js';
import { heatColor, heatPower } from '../wytop/wspolneTSL.js';
import { NACZYNIE } from './geometria.js';

export const LINE_LIGHTS = 16;

/** Blok świateł linii: 32 × vec4 (A_0…A_15, B_0…B_15), od zer (pułapka 46). */
export function createLineLightUniforms() {
  const arr = uniformArray(Array.from({ length: LINE_LIGHTS * 2 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4').setName('FormowanieSwiatloLinii');
  return { lights: arr, data: arr.array };
}

/**
 * Natężenie światła linii w punkcie P (układ komory) na powierzchnię o normalnej N: suma źródeł, najbliższy punkt
 * odcinka, owinięcie jak `ballLight` (duże źródło), (r / d)². `U` — uniformy wytopu (paleta metalu).
 */
export const lineLight = (U, LU, P, N) => {
  const acc = vec3(0.0).toVar();
  Loop(LINE_LIGHTS, ({ i }) => {
    const A = LU.lights.element(i).toVar();
    const Bq = LU.lights.element(int(i).add(LINE_LIGHTS)).toVar();
    const T = Bq.w;
    const ab = Bq.xyz.sub(A.xyz).toVar();
    const l2 = max(dot(ab, ab), 1e-4);
    const h = clamp(dot(P.sub(A.xyz), ab).div(l2), 0.0, 1.0);
    const Q = A.xyz.add(ab.mul(h));
    const D = Q.sub(P).toVar();
    const d2 = max(dot(D, D), 1.0);
    const R = max(A.w, 1.0);
    const geo = R.mul(R).div(max(d2, R.mul(R).mul(1.15)));
    const wrap = clamp(dot(N, D.div(sqrt(d2))).add(0.32).div(1.32), 0.0, 1.0);
    acc.addAssign(heatColor(U, T).mul(heatPower(T)).mul(geo).mul(wrap).mul(smoothstep(0.02, 0.1, T)));
  });
  return acc;
};

const PR = NACZYNIE.profile;
const Y_TOP = PR[0][1];
const Y_FL = PR[1][1];
const Y_CYL = PR[3][1];
const Y_CONE = PR[4][1];
const Y_LIP = PR[7][1];

/**
 * Widoczność słońca w punkcie P hali (0 — cień naczynia albo pomostu). Na powierzchni samego naczynia podaj punkt
 * odsunięty wzdłuż normalnej (inaczej punkt płaszcza leży na brzegu własnego cienia).
 */
export const vesselShadow = (U, P) => {
  const L = U.sunDir;
  const lxz = vec2(L.x, L.z);
  const pxz = vec2(P.x, P.z);
  const k2 = max(dot(lxz, lxz), 1e-4);
  const tStar = dot(pxz, lxz).negate().div(k2);
  const ly = max(L.y, 0.05);
  // pas wysokości [y0, y1] o promieniu r(y) = r0 + (y − y0)·m: odległość promienia od osi w najlepszym punkcie pasa
  const band = (y0, y1, r0, r1) => {
    const ta = max(float(y0).sub(P.y).div(ly), 0.0);
    const tb = max(float(y1).sub(P.y).div(ly), 0.0);
    const t = clamp(tStar, min(ta, tb), max(ta, tb));
    const y = P.y.add(L.y.mul(t));
    const d = length(pxz.add(lxz.mul(t)));
    const f = clamp(y.sub(y0).div(y1 - y0), 0.0, 1.0);
    const r = mix(float(r0), float(r1), f);
    // poza pasem (promień już nad nim albo jeszcze pod) — bez cienia
    const inside = step01(abs(tb.sub(ta)).sub(1e-3));
    return d.sub(r).add(float(1.0).sub(inside).mul(1e4));
  };
  const m1 = band(Y_FL, Y_TOP, PR[0][0], PR[0][0]);
  const m2 = band(Y_CYL, Y_FL, PR[2][0], PR[2][0]);
  const m3 = band(Y_CONE, Y_CYL, PR[4][0], PR[3][0]);
  const m4 = band(Y_LIP, Y_CONE, PR[7][0], PR[4][0]);
  const md = min(min(m1, m2), min(m3, m4));
  const soft = max(float(Y_TOP).sub(P.y), 0.0).mul(0.012).add(4.0);
  const vessel = smoothstep(soft.negate(), soft, md);
  // płyta pomostu górnego (x0…x1, z0…z1 na wysokości spodu…wierzchu) — promień do jej środka grubości
  const D = KOMORA.deck;
  const yp = (NACZYNIE.flange.y0 + NACZYNIE.flange.y1) / 2;
  const tp = max(float(yp).sub(P.y).div(ly), 0.0);
  const q = pxz.add(lxz.mul(tp));
  const sp = tp.mul(0.006).add(3.0);
  const inX = smoothstep(float(D.x0).sub(sp), float(D.x0).add(sp), q.x).mul(float(1.0).sub(smoothstep(float(D.x1).sub(sp), float(D.x1).add(sp), q.x)));
  const inZ = smoothstep(float(D.z0).sub(sp), float(D.z0).add(sp), q.y).mul(float(1.0).sub(smoothstep(float(D.z1).sub(sp), float(D.z1).add(sp), q.y)));
  const below = float(1.0).sub(smoothstep(float(yp - 30), float(yp + 30), P.y));
  const platform = float(1.0).sub(inX.mul(inZ).mul(below));
  return vessel.mul(platform);
};

/** 1 dla x > 0 (krok bez stałych odwróconych). */
const step01 = (x) => clamp(x.mul(1e6), 0.0, 1.0);
