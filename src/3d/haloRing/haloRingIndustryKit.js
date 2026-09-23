// Zestaw brył działki przemysłowej (M4 v2, poprawka po uwadze użytkownika:
// „dzielnica fabryczna — same kwadraty”). Siedem rodzajów zakładów zamiast
// jednej bryły na działkę: hala z dachem szedowym, farma zbiorników, silosy,
// kotłownia z kominem, chłodnia kominowa, rafineria, plac kontenerowy.
//
// Jedno źródło: ten sam GLSL rysuje odcisk z daleka w terenie
// (haloRingTerrain.js) i buduje bryły 3D z bliska (haloRingCity.js), więc bryła
// wyrasta dokładnie z plamy widocznej z daleka. Lustro JS (indKitPart) służy
// testom: części mieszczą się w działce, nic nie sięga za wysoko.
//
// Działka przemysłowa: 112 × 126 j. (wzdłuż × w poprzek), środek w (0, 0);
// użyteczne ±40 × ±44 (reszta to ulice). Część p: 0–1 prostopadłościany,
// 2–4 walce. A = (u, w, a, b): środek i wymiary (prostopadłościan a × b,
// walec: promień a). B = (z0, h, materiał, kształt walca: 0 zwykły, 1 chłodnia,
// 2 komin zwężany). h = 0 → części nie ma.
export const IND_MAT = Object.freeze({
  roofMid: 1, dark: 2, white: 3, rust: 4, truss: 5,
  concrete: 16, concreteLight: 17, sawtooth: 18, chimney: 19, tank: 20, silo: 21, containers: 22, pipe: 23
});
export const IND_EMIT = Object.freeze({ none: 0, windowsWarm: 1, windowsCool: 2, sodium: 4 });
export const IND_LOT = Object.freeze({ along: 112, across: 126, halfU: 40, halfW: 44 });
export const IND_PARTS = 5;

const fract = (x) => x - Math.floor(x);

export function indKitType(lotH) {
  return lotH < 0.30 ? 0 : lotH < 0.46 ? 1 : lotH < 0.56 ? 2 : lotH < 0.68 ? 3 : lotH < 0.74 ? 4 : lotH < 0.86 ? 5 : 6;
}
export const IND_KIT_NAMES = Object.freeze(['hala', 'zbiorniki', 'silosy', 'kotłownia', 'chłodnia', 'rafineria', 'kontenery']);

// Lustro JS części zestawu (te same liczby co GLSL poniżej).
export function indKitPart(lotH, p) {
  const k = indKitType(lotH);
  const h1 = fract(lotH * 13.7);
  const h2 = fract(lotH * 7.31);
  const h3 = fract(lotH * 3.17);
  const h4 = fract(lotH * 5.93);
  const M = IND_MAT;
  const E = IND_EMIT;
  const none = { A: [0, 0, 0, 0], B: [0, 0, 0, 0] };
  const part = (A, B) => ({ A, B });
  if (k === 0) {
    const hw = 64 + 16 * h1;
    const hd = 60 + 24 * h2;
    const hh = 16 + 10 * h3;
    if (p === 0) return part([0, 0, hw, hd], [0, hh, M.sawtooth + 32 * E.sodium, 0]);
    if (p === 1) return part([hw * 0.5 - 10, -(hd * 0.5 - 12), 20, 24], [0, hh + 8 + 8 * h4, M.white + 32 * E.windowsCool, 0]);
    if (p === 2) return part([-hw * 0.25, hd * 0.2, 2.5, 0], [hh, 12, M.pipe, 0]);
    if (p === 3) return part([hw * 0.1, -hd * 0.25, 3, 0], [hh, 8, M.pipe, 0]);
    return none;
  }
  if (k === 1) {
    const r = 13 + 5 * h1;
    const th = 16 + 14 * h2;
    if (p === 0) return part([0, 0, 84, 88], [0, 2.5, M.concrete, 0]);
    if (p === 1) return part([32, 34, 14, 12], [0, 8, M.roofMid, 0]);
    if (p === 2) return part([-18, -20, r, 0], [0, th, M.tank, 0]);
    if (p === 3) return part([20, -20, r, 0], [0, th * (0.8 + 0.4 * h3), M.tank, 0]);
    return part([-4, 20, r * (0.8 + 0.3 * h4), 0], [0, th, M.tank, 0]);
  }
  if (k === 2) {
    const r = 9 + 2 * h1;
    const sh = 42 + 26 * h2;
    if (p === 0) return part([-6, 0, 8, 76], [sh - 2, 5, M.truss, 0]);
    if (p === 1) return part([26, 0, 22, 34], [0, 12 + 6 * h3, M.rust + 32 * E.windowsWarm, 0]);
    if (p === 2) return part([-6, -28, r, 0], [0, sh, M.silo, 0]);
    if (p === 3) return part([-6, 0, r, 0], [0, sh, M.silo, 0]);
    return part([-6, 28, r, 0], [0, sh, M.silo, 0]);
  }
  if (k === 3) {
    if (p === 0) return part([-8, 4, 50 + 10 * h1, 40 + 8 * h2], [0, 18 + 10 * h3, M.rust + 32 * E.windowsWarm, 0]);
    if (p === 1) return part([26, -28, 16, 20], [0, 10, M.roofMid, 0]);
    if (p === 2) return part([28, 26, 4.5 + 1.5 * h4, 0], [0, 80 + 40 * h1, M.chimney, 2]);
    if (p === 3) return part([-30, -30, 7, 0], [0, 12, M.tank, 0]);
    return none;
  }
  if (k === 4) {
    if (p === 0) return part([34, 38, 10, 10], [0, 7, M.roofMid, 0]);
    if (p === 2) return part([0, 0, 30 + 6 * h1, 0], [0, 55 + 15 * h2, M.concreteLight, 1]);
    return none;
  }
  if (k === 5) {
    if (p === 0) return part([0, 0, 80, 6], [10, 3, M.pipe, 0]);
    if (p === 1) return part([-24, 32, 26, 18], [0, 10, M.white + 32 * E.windowsCool, 0]);
    if (p === 2) return part([-22, -18, 3.5 + 1.5 * h1, 0], [0, 50 + 30 * h2, M.tank, 0]);
    if (p === 3) return part([-4, 14, 4 + 1.5 * h3, 0], [0, 45 + 35 * h4, M.tank, 0]);
    return part([18, -10, 3 + 1.5 * h2, 0], [0, 60 + 25 * h1, M.tank, 0]);
  }
  if (p === 0) return part([0, -20, 66, 13], [0, 10 + 14 * h1, M.containers, 0]);
  if (p === 1) return part([0, 14, 66, 13], [0, 8 + 12 * h2, M.containers, 0]);
  return none;
}

// GLSL: ta sama logika (wymaga niczego poza wbudowanymi funkcjami).
export const HALO_GLSL_INDKIT = /* glsl */`
float indKitType(float lotH) {
  return lotH < 0.30 ? 0.0 : lotH < 0.46 ? 1.0 : lotH < 0.56 ? 2.0 : lotH < 0.68 ? 3.0 : lotH < 0.74 ? 4.0 : lotH < 0.86 ? 5.0 : 6.0;
}
void indKitPart(float lotH, int p, out vec4 A, out vec4 B) {
  float k = indKitType(lotH);
  float h1 = fract(lotH * 13.7);
  float h2 = fract(lotH * 7.31);
  float h3 = fract(lotH * 3.17);
  float h4 = fract(lotH * 5.93);
  A = vec4(0.0);
  B = vec4(0.0);
  if (k < 0.5) {
    float hw = 64.0 + 16.0 * h1;
    float hd = 60.0 + 24.0 * h2;
    float hh = 16.0 + 10.0 * h3;
    if (p == 0) { A = vec4(0.0, 0.0, hw, hd); B = vec4(0.0, hh, ${IND_MAT.sawtooth + 32 * IND_EMIT.sodium}.0, 0.0); }
    else if (p == 1) { A = vec4(hw * 0.5 - 10.0, -(hd * 0.5 - 12.0), 20.0, 24.0); B = vec4(0.0, hh + 8.0 + 8.0 * h4, ${IND_MAT.white + 32 * IND_EMIT.windowsCool}.0, 0.0); }
    else if (p == 2) { A = vec4(-hw * 0.25, hd * 0.2, 2.5, 0.0); B = vec4(hh, 12.0, ${IND_MAT.pipe}.0, 0.0); }
    else if (p == 3) { A = vec4(hw * 0.1, -hd * 0.25, 3.0, 0.0); B = vec4(hh, 8.0, ${IND_MAT.pipe}.0, 0.0); }
  } else if (k < 1.5) {
    float r = 13.0 + 5.0 * h1;
    float th = 16.0 + 14.0 * h2;
    if (p == 0) { A = vec4(0.0, 0.0, 84.0, 88.0); B = vec4(0.0, 2.5, ${IND_MAT.concrete}.0, 0.0); }
    else if (p == 1) { A = vec4(32.0, 34.0, 14.0, 12.0); B = vec4(0.0, 8.0, ${IND_MAT.roofMid}.0, 0.0); }
    else if (p == 2) { A = vec4(-18.0, -20.0, r, 0.0); B = vec4(0.0, th, ${IND_MAT.tank}.0, 0.0); }
    else if (p == 3) { A = vec4(20.0, -20.0, r, 0.0); B = vec4(0.0, th * (0.8 + 0.4 * h3), ${IND_MAT.tank}.0, 0.0); }
    else { A = vec4(-4.0, 20.0, r * (0.8 + 0.3 * h4), 0.0); B = vec4(0.0, th, ${IND_MAT.tank}.0, 0.0); }
  } else if (k < 2.5) {
    float r = 9.0 + 2.0 * h1;
    float sh = 42.0 + 26.0 * h2;
    if (p == 0) { A = vec4(-6.0, 0.0, 8.0, 76.0); B = vec4(sh - 2.0, 5.0, ${IND_MAT.truss}.0, 0.0); }
    else if (p == 1) { A = vec4(26.0, 0.0, 22.0, 34.0); B = vec4(0.0, 12.0 + 6.0 * h3, ${IND_MAT.rust + 32 * IND_EMIT.windowsWarm}.0, 0.0); }
    else if (p == 2) { A = vec4(-6.0, -28.0, r, 0.0); B = vec4(0.0, sh, ${IND_MAT.silo}.0, 0.0); }
    else if (p == 3) { A = vec4(-6.0, 0.0, r, 0.0); B = vec4(0.0, sh, ${IND_MAT.silo}.0, 0.0); }
    else { A = vec4(-6.0, 28.0, r, 0.0); B = vec4(0.0, sh, ${IND_MAT.silo}.0, 0.0); }
  } else if (k < 3.5) {
    if (p == 0) { A = vec4(-8.0, 4.0, 50.0 + 10.0 * h1, 40.0 + 8.0 * h2); B = vec4(0.0, 18.0 + 10.0 * h3, ${IND_MAT.rust + 32 * IND_EMIT.windowsWarm}.0, 0.0); }
    else if (p == 1) { A = vec4(26.0, -28.0, 16.0, 20.0); B = vec4(0.0, 10.0, ${IND_MAT.roofMid}.0, 0.0); }
    else if (p == 2) { A = vec4(28.0, 26.0, 4.5 + 1.5 * h4, 0.0); B = vec4(0.0, 80.0 + 40.0 * h1, ${IND_MAT.chimney}.0, 2.0); }
    else if (p == 3) { A = vec4(-30.0, -30.0, 7.0, 0.0); B = vec4(0.0, 12.0, ${IND_MAT.tank}.0, 0.0); }
  } else if (k < 4.5) {
    if (p == 0) { A = vec4(34.0, 38.0, 10.0, 10.0); B = vec4(0.0, 7.0, ${IND_MAT.roofMid}.0, 0.0); }
    else if (p == 2) { A = vec4(0.0, 0.0, 30.0 + 6.0 * h1, 0.0); B = vec4(0.0, 55.0 + 15.0 * h2, ${IND_MAT.concreteLight}.0, 1.0); }
  } else if (k < 5.5) {
    if (p == 0) { A = vec4(0.0, 0.0, 80.0, 6.0); B = vec4(10.0, 3.0, ${IND_MAT.pipe}.0, 0.0); }
    else if (p == 1) { A = vec4(-24.0, 32.0, 26.0, 18.0); B = vec4(0.0, 10.0, ${IND_MAT.white + 32 * IND_EMIT.windowsCool}.0, 0.0); }
    else if (p == 2) { A = vec4(-22.0, -18.0, 3.5 + 1.5 * h1, 0.0); B = vec4(0.0, 50.0 + 30.0 * h2, ${IND_MAT.tank}.0, 0.0); }
    else if (p == 3) { A = vec4(-4.0, 14.0, 4.0 + 1.5 * h3, 0.0); B = vec4(0.0, 45.0 + 35.0 * h4, ${IND_MAT.tank}.0, 0.0); }
    else { A = vec4(18.0, -10.0, 3.0 + 1.5 * h2, 0.0); B = vec4(0.0, 60.0 + 25.0 * h1, ${IND_MAT.tank}.0, 0.0); }
  } else {
    if (p == 0) { A = vec4(0.0, -20.0, 66.0, 13.0); B = vec4(0.0, 10.0 + 14.0 * h1, ${IND_MAT.containers}.0, 0.0); }
    else if (p == 1) { A = vec4(0.0, 14.0, 66.0, 13.0); B = vec4(0.0, 8.0 + 12.0 * h2, ${IND_MAT.containers}.0, 0.0); }
  }
}
// Profil walca: skala promienia na wysokości t ∈ [0,1] (chłodnia = hiperboloida,
// komin zwężany ku górze).
float indCylRadius(float shape, float t) {
  if (shape > 1.5) return 1.0 - 0.28 * t;
  if (shape > 0.5) { float d = (t - 0.72) / 0.72; return 0.6 + 0.4 * d * d; }
  return 1.0;
}
float indCylSlope(float shape, float t) {
  if (shape > 1.5) return -0.28;
  if (shape > 0.5) return 0.8 * (t - 0.72) / (0.72 * 0.72);
  return 0.0;
}
// Cień pozorny: odcinek od punktu ku słońcu (a → a + V) przecina obrys części.
float indSegBox(vec2 a, vec2 V, vec2 h) {
  vec2 sV = sign(V) * max(abs(V), vec2(1e-4));
  vec2 inv = 1.0 / sV;
  vec2 t1 = (-h - a) * inv;
  vec2 t2 = (h - a) * inv;
  vec2 tmin = min(t1, t2);
  vec2 tmax = max(t1, t2);
  float lo = max(max(tmin.x, tmin.y), 0.0);
  float hi = min(min(tmax.x, tmax.y), 1.0);
  return step(lo, hi);
}
float indSegCircle(vec2 a, vec2 V, float r) {
  float t = clamp(-dot(a, V) / max(dot(V, V), 1e-6), 0.0, 1.0);
  return 1.0 - smoothstep(r - 0.8, r + 0.8, length(a + V * t));
}
// Barwa dachu części z góry (odcisk w terenie z daleka).
vec3 indTopColor(float mat, float seed, vec2 q, vec4 A) {
  float m = mod(mat, 32.0);
  if (m > 17.5 && m < 18.5) {
    float saw = fract(q.x / 9.0);
    return mix(vec3(0.05, 0.055, 0.06), vec3(0.20, 0.21, 0.22), step(0.38, saw));
  }
  if (m > 19.5 && m < 20.5) {
    float rr = length(q) / max(A.z, 1.0);
    return mix(vec3(0.30, 0.30, 0.29), vec3(0.14), smoothstep(0.82, 0.92, rr)) * (0.9 + 0.2 * seed);
  }
  if (m > 16.5 && m < 17.5) return length(q) < A.z * 0.66 ? vec3(0.015) : vec3(0.28, 0.28, 0.26);
  if (m > 20.5 && m < 21.5) return vec3(0.24, 0.24, 0.23);
  if (m > 18.5 && m < 19.5) return vec3(0.02);
  if (m > 21.5 && m < 22.5) {
    float c = floor(q.x / 12.2 + 20.0) + floor(q.y / 6.5) * 7.0 + seed * 13.0;
    float k = fract(sin(c * 12.9898) * 43758.5453);
    vec3 col = k < 0.25 ? vec3(0.19, 0.06, 0.035) : (k < 0.5 ? vec3(0.03, 0.08, 0.15) : (k < 0.75 ? vec3(0.16, 0.12, 0.05) : vec3(0.26)));
    return col * (0.85 + 0.3 * step(0.1, fract(q.x / 12.2)));
  }
  if (m > 22.5 && m < 23.5) return vec3(0.12, 0.13, 0.14);
  if (m > 15.5 && m < 16.5) return vec3(0.16, 0.16, 0.15);
  if (m > 3.5 && m < 4.5) return vec3(0.12, 0.082, 0.06);
  if (m > 2.5 && m < 3.5) return vec3(0.26, 0.262, 0.26);
  if (m > 4.5 && m < 5.5) return vec3(0.055, 0.058, 0.064);
  return vec3(0.09, 0.092, 0.097);
}
`;
