// src/effects3d/reactorblow.tsl.js
//
// Materiały wybuchu reaktora w TSL (port WebGPU, zadanie 20) — dawne dwa ShaderMaterial z
// reactorblow.js (226 linii GLSL) rysowane w overlayu na własnym WebGLRenderer. Wzory ruchu
// i kształtów 1:1: ruch ANALITYCZNY w wierzchołkach (pozycja startowa + prędkość · wiek, iskry
// i kolce z oporem), bilboardy w przestrzeni widoku, pierścień i fala płasko w płaszczyźnie gry.
//
// Układ: overlay miał kamerę nad płaszczyzną XZ (X = x gry, Z = y gry, Y ku kamerze), Core3D
// ma scenę XY (X = x, Y = −y gry, Z ku kamerze) — (Xo, Yo, Zo) → (Xo, −Zo, Yo). Przestrzeń
// widoku obu kamer jest ta sama (x w prawo, y w górę ekranu), więc bilboardy i smugi liczą się
// co do wzoru, a płaskie kwady (pierścień, fala) dostają −position.y (uv jak dawniej na ekranie).
//
// Pas „slab”: kamera overlaya (y = 120, near/far ±1000) obcinała iskry i kolce, które odleciały
// od płaszczyzny wybuchu (Yo = 5) poza Yo ∈ [−880, 1120] — przy dużych wybuchach znikała część
// iskier lecących ku kamerze / od niej. Obcięcie zostaje (ten sam wygląd).
//
// Płaskie kwady (pierścień fraktalny, ciemna fala) w overlayu były zwrócone TYŁEM do kamery i
// FrontSide je odrzucał — nigdy ich nie było widać (odkryte w zadaniu 20, jak kwady WASH banku
// Fx3D w 12-B). Zostaje 1:1: FrontSide; podgląd obu stron: ReactorBlow3D.setFlatVisible(true).
//
// WYGLĄD pod post gry (jeden bloom — dawny overlay miał własny 1,6 / próg 0,15). Overlay składał
// klatkę tak: suma cząstek H (+ jego bloom), ACES × 1,2, sRGB, alfa = min(1; 1,5 · max(H))
// i `mix-blend-mode: screen` nad grą, czyli widać było ≈ alfa · sRGB(ACES(1,2 · H)): ciemne
// partie gasły do zera (alfa ∝ H), jasne przepalały się do bieli, a jego bloom (≈ 14 × prawie
// wszystkiego) rozlewał rdzeń w białą kulę z ostrym brzegiem. W Core3D:
//   • `reactorLook` — wkład cząstki przez odwrotność ACES i sRGB gry z tego, co ta sama wartość
//     dawała na ekranie w overlayu (pojedyncza cząstka na czarnym tle wygląda jak w overlayu);
//   • rdzeń (ładowanie i rozbłysk, typ 5): poświata bloomu overlaya policzona analitycznie
//     (sumy gaussów mipów w px ekranu dla jądra i linii anamorficznej) i dodana PRZED
//     odwzorowaniem; kwad rdzenia powiększony na zasięg widocznej poświaty; wynik obcięty
//     sufitem 0,88 — pod progiem bloomu gry (0,9), bo jego rozlew (7,65 × liniowo) spłaszczał
//     stromy spadek jasności overlaya (sufit = biel ~229/255 zamiast 255 w środku kuli);
//   • iskry i kolce (typy 4 i 3): świecą przez bloom gry (bez sufitu) z mnożnikami wyjścia
//     (iskry 0,7, kolce 2) dobranymi do zrzutów bazy; rozlanym iskrom (od 0,6 s życia) dochodzi
//     poświata pojedynczej kreski z mipów 0–1 bloomu overlaya (świecące kulki zamiast cienkich
//     kresek) — w gęstej, młodej chmurze jej suma przerastała białą kulę overlaya, więc tam nie
//     wchodzi; model chmury iskier (poświata populacji) sprawdzony i odrzucony.
// Liczby porównań: docs/webgpu/POSTEP.md (zadanie 20), sesja harnessu „reaktor”.
//
// Pułapki (PLAN §3): funkcje z setLayout są CZYSTE (uniformy parametrami); potęgi całkowite
// mnożeniem (pow z ujemną podstawą = NaN w WGSL); smoothstep ze stałymi odwróconymi
// krawędziami to błąd WGSL — 1 − smoothstep(e1, e0, x); varyingi obcięte przed potęgami.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard, float, vec2, vec3, vec4, uniform, attribute, uv, varyingProperty, positionGeometry,
  modelViewMatrix, cameraProjectionMatrix, fract, sin, floor, mix, smoothstep, select, exp, sqrt,
  pow, clamp, max, min, abs, length, atan, step, screenSize, log
} from 'three/tsl';
import { acesGry, linearDoSrgb } from '../3d/tsl/kolorGry.js';

/**
 * Typy cząstek (aData.w) — jak w dawnym GLSL; kolce (3) i iskry (4) mają ten sam kształt i ruch
 * (dawny typ 4), osobny jest tylko mnożnik wyjścia.
 */
export const REACTOR_TYPE = Object.freeze({ SPIKE: 3, SPARK: 4, CORE: 5, RING: 6 });

/** Pas widoczny dawnej kamery overlaya (oś ku kamerze, wybuch na 5): poza nim iskry i kolce znikały. */
export const REACTOR_SLAB_MIN_Z = -880;
export const REACTOR_SLAB_MAX_Z = 1120;

/** Pozycja „poza ekranem” dla martwych cząstek (klip) — cały kwad w jednym punkcie. */
const CLIP_OFF = vec4(2.0, 2.0, 2.0, 1.0);

// ── Szum (hash z sin, szum wartości 3D, fbm 3 oktawy) — 1:1 z dawnym GLSL ─────────────────
export const reactorHash = /*@__PURE__*/ Fn(([n]) => fract(sin(n).mul(43758.5453123)))
  .setLayout({ name: 'reactorHash', type: 'float', inputs: [{ name: 'n', type: 'float' }] });

export const reactorNoise = /*@__PURE__*/ Fn(([x]) => {
  const p = floor(x).toVar();
  const f0 = fract(x).toVar();
  const f = f0.mul(f0).mul(vec3(3.0).sub(f0.mul(2.0))).toVar();
  // Wejścia haszu całkowite (floor) — suma dokładna we float32, wynik nie zależy od kompilatora.
  const n = p.x.add(p.y.mul(57.0)).add(p.z.mul(113.0)).toVar();
  const a = mix(mix(reactorHash(n), reactorHash(n.add(1.0)), f.x), mix(reactorHash(n.add(57.0)), reactorHash(n.add(58.0)), f.x), f.y);
  const b = mix(mix(reactorHash(n.add(113.0)), reactorHash(n.add(114.0)), f.x), mix(reactorHash(n.add(170.0)), reactorHash(n.add(171.0)), f.x), f.y);
  return mix(a, b, f.z);
}).setLayout({ name: 'reactorNoise', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] });

export const reactorFbm = /*@__PURE__*/ Fn(([p0]) => {
  const p = vec3(p0).toVar();
  const f = float(0.0).toVar();
  f.addAssign(reactorNoise(p).mul(0.5));
  p.mulAssign(2.02);
  f.addAssign(reactorNoise(p).mul(0.25));
  p.mulAssign(2.03);
  f.addAssign(reactorNoise(p).mul(0.125));
  return f;
}).setLayout({ name: 'reactorFbm', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

// ── Wygląd overlaya pod post gry ─────────────────────────────────────────────────────────
// ACES i LinearTosRGB — te same krzywe co post gry (kolorGry.js); overlay liczył ACES z
// ekspozycją × 1,2. Odwrotność LinearTosRGB: próg 0,0031308 · 12,92 = 0,04045.
const fromSrgb = (s) => mix(pow(max(s.add(0.055).div(1.055), vec3(0.0)), vec3(2.4)), s.div(12.92), step(s, vec3(0.04045)));
// Odwrotność ACES gry na [0, ACES_Y_MAX]: dodatni pierwiastek (2,43y − 2,51)x² + (0,59y − 0,03)x + 0,14y = 0
// (a < 0, c ≥ 0 — dokładnie jeden pierwiastek nieujemny). Sufit: ACES dochodzi do 1 przy x ≈ 7,2.
export const ACES_Y_MAX = 0.9985;
const acesInv = (y0) => {
  const y = clamp(y0, vec3(0.0), vec3(ACES_Y_MAX));
  const a = y.mul(2.43).sub(2.51);
  const b = y.mul(0.59).sub(0.03);
  const c = y.mul(0.14);
  const disc = max(b.mul(b).sub(a.mul(c).mul(4.0)), vec3(0.0));
  return b.negate().sub(sqrt(disc)).div(a.mul(2.0));
};

/**
 * Wkład cząstki (barwa × alfa — to, co dawna cząstka dokładała do celu overlaya) → HDR do
 * bufora sceny gry: odwrotność ACES i sRGB gry z obrazu, jaki ta sama wartość dawała na ekranie
 * po złożeniu overlaya (alfa = min(1; 1,5 · max) × sRGB(ACES(1,2 · x))). Czysta funkcja.
 */
export const reactorLook = /*@__PURE__*/ Fn(([x0]) => {
  const x = max(x0, vec3(0.0)).toVar();
  const alpha = min(max(x.x, max(x.y, x.z)).mul(1.5), 1.0);
  const shown = linearDoSrgb(acesGry(x.mul(1.2))).mul(alpha);
  return acesInv(fromSrgb(shown));
}).setLayout({ name: 'reactorLook', type: 'vec3', inputs: [{ name: 'x', type: 'vec3' }] });

/** Lustro CPU `reactorLook` (jedna składowa; `maxChannel` — największa składowa wkładu). */
export function reactorLookCpu(x, maxChannel = x) {
  const v = Math.max(0, x);
  const alpha = Math.min(1.5 * Math.max(0, maxChannel), 1);
  const t = 1.2 * v;
  const acesV = Math.min(1, Math.max(0, (t * (2.51 * t + 0.03)) / (t * (2.43 * t + 0.59) + 0.14)));
  const s = (acesV <= 0.0031308 ? acesV * 12.92 : Math.pow(acesV, 0.41666) * 1.055 - 0.055) * alpha;
  const lin = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  const y = Math.min(Math.max(lin, 0), ACES_Y_MAX);
  const a = 2.43 * y - 2.51;
  const b = 0.59 * y - 0.03;
  const c = 0.14 * y;
  return (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
}

/**
 * Uniformy wybuchu (jeden obiekt na system, domyślna grupa — jeden bufor): czas cząstek
 * (performance.now()/1000 — jak dawny `uTime` overlaya: hasz oporu iskier i fazy szumu
 * pierścienia liczone z tych samych liczb) i strojenie wyglądu (REACTOR_LOOK w reactorblow.js).
 */
export function createReactorUniforms() {
  return {
    uTime: uniform(0),
    // Odwzorowanie wyglądu overlaya (0 = wkład liniowo — podgląd / porównania).
    uLook: uniform(1),
    // Mnożniki wkładu przed odwzorowaniem, per rodzaj.
    uGainSpark: uniform(1),
    uGainCore: uniform(1),
    uGainRing: uniform(1),
    uGainSmoke: uniform(1),
    // Mnożniki po odwzorowaniu (rdzeń i płaskie, iskry, kolce) i sufity (rdzeń, iskry i kolce).
    uOut: uniform(1),
    uOutSpark: uniform(1),
    uOutSpike: uniform(1),
    uCap: uniform(1e4),
    uCapSpark: uniform(1e4),
    // Poświata overlaya wokół rdzenia: amplituda (0 = bez), najwyższe powiększenie kwadu, skala σ.
    uHaloAmp: uniform(0),
    uHaloQuad: uniform(40),
    uHaloSpread: uniform(1),
    // Poświata pojedynczej iskry i kolca (dwa najmniejsze mipy bloomu overlaya): amplituda względem
    // wzmocnienia overlaya (0 = bez), najwyższy margines kwadu [px ekranu 1920], narastanie z wiekiem
    // iskry [s] (od, do) — patrz sparkGlow niżej.
    uSparkGlow: uniform(0),
    uSparkGlowMax: uniform(40),
    uSparkGlowAge0: uniform(0.6),
    uSparkGlowAge1: uniform(1.2)
  };
}

// ── Poświata rdzenia (bloom overlaya liczony analitycznie) ───────────────────────────────
// Bloom overlaya (UnrealBloomPass: 5 mipów, jądra 6…22, σ = jądro / 3, kaskada) przeliczony na
// px ekranu 1920 (overlay liczył w 0,84 rozdzielczości): efektywne σ mipów po złożeniu kaskady.
// Kompozyt: 3 × siła 1,6 × współczynnik 0,6 (promień 0,5 — wszystkie mipy po równo) = 2,88
// (dopasowana amplituda wyszła ~4 — próg 0,15 przepuszczał też aurę i poświatę sąsiadów).
export const OVERLAY_BLOOM_SIGMA_PX = Object.freeze([4.76, 16.58, 47.36, 123.5, 302.4]);
export const OVERLAY_BLOOM_GAIN = 2.88;
// Energia rdzenia (∫ I² po kwadzie o boku 1, bez aury — pod progiem bloomu overlaya) i jej
// rozrzut: część okrągła (jądro) i linia anamorficzna (jądro + linia minus jądro) — moment
// drugiego rzędu na oś (bok² jednostek). Liczone numerycznie (siatka 4000²).
export const CORE_ROUND_J = 0.012118;
export const CORE_ROUND_V = 0.001719;
export const CORE_LINE_J = 0.033607;
export const CORE_LINE_VX = 0.014315;
export const CORE_LINE_VY = 0.0000395;
// Próg widoczności poświaty (po odwzorowaniu wyglądu overlaya ≈ 1/255).
const HALO_EPS = 0.02;

// Zasięg [px od środka], na którym poświata rdzenia jest jeszcze widoczna: dla każdego mipu
// gauss o szczycie energia / (2π σ²) spada do progu przy σ · √(2 ln(szczyt / próg)).
// `peak` = największa składowa barwy × alfa × mnożniki.
function coreHaloReach(side, peak, spread) {
  const energy = peak.mul(side).mul(side).mul(CORE_ROUND_J + CORE_LINE_J);
  let reach = null;
  for (const sigma of OVERLAY_BLOOM_SIGMA_PX) {
    const sk = spread.mul(sigma);
    const top = energy.div(sk.mul(sk).mul(2 * Math.PI * HALO_EPS));
    const r = sk.mul(sqrt(max(log(max(top, 1.0)), 0.0).mul(2.0)));
    reach = reach ? max(reach, r) : r;
  }
  return reach;
}

// Poświata rdzenia w punkcie (px, py) [px ekranu od środka], bok kwadu `side` [px]: suma gaussów
// mipów dla części okrągłej i linii (energia na bok² — mnoży wołający).
function coreHalo(px, py, side, spread) {
  const s2 = side.mul(side);
  const r2 = px.mul(px).add(py.mul(py));
  const x2 = px.mul(px);
  const y2 = py.mul(py);
  let sum = null;
  for (const sigma of OVERLAY_BLOOM_SIGMA_PX) {
    const sk = spread.mul(sigma);
    const sk2 = sk.mul(sk);
    const vr = sk2.add(s2.mul(CORE_ROUND_V));
    const vx = sk2.add(s2.mul(CORE_LINE_VX));
    const vy = sk2.add(s2.mul(CORE_LINE_VY));
    const round = exp(r2.div(vr.mul(-2.0))).mul(CORE_ROUND_J / (2 * Math.PI)).div(vr);
    const line = exp(x2.div(vx.mul(-2.0)).add(y2.div(vy.mul(-2.0)))).mul(CORE_LINE_J / (2 * Math.PI)).div(sqrt(vx.mul(vy)));
    const term = round.add(line);
    sum = sum ? sum.add(term) : term;
  }
  return sum;
}

// ── Poświata iskry (dwa najmniejsze mipy bloomu overlaya) ──────────────────────────────────
// Iskra to kreska: w poprzek (1 − 2|x|)³ (całka 0,25, wariancja 1/60 szerokości²), wzdłuż prawie
// płaska (całka ≈ 0,8, wariancja ≈ 0,053 długości²). Bloom overlaya rozlewał ją gaussami mipów:
// mipy 0–1 (σ 4,76 i 16,58 px) robiły świecącą kulkę wokół kreski (mipy 2–4 — szeroka łuna całej
// chmury iskier, tę daje bloom gry z sumy iskier). Energia kreski w px² × wzmocnienie mipu.
// Poświata narasta z wiekiem iskry (uSparkGlowAge0 → Age1): w gęstej, młodej chmurze overlay
// nasycał SUMĘ do bieli (alfa i ACES na sumie), a suma poświat odwzorowanych osobno przerastała
// jego białą kulę 2–4× — więc poświata wchodzi dopiero, gdy chmura się rozrzedzi (rozlane iskry).
const SPARK_SHAPE_ENERGY = 0.2;
const SPARK_VAR_ACROSS = 1 / 60;
const SPARK_VAR_ALONG = 0.053;
const SPARK_GLOW_SIGMA_PX = OVERLAY_BLOOM_SIGMA_PX.slice(0, 2);

// Zasięg poświaty od środka kreski [px], w którym gauss mipu spada do progu widoczności.
function sparkGlowReach(energy, varMax, spread) {
  let reach = null;
  for (const sigma of SPARK_GLOW_SIGMA_PX) {
    const sk = spread.mul(sigma);
    const v = sk.mul(sk).add(varMax);
    const top = energy.mul(OVERLAY_BLOOM_GAIN).div(v.mul(2 * Math.PI * HALO_EPS));
    const r = sqrt(v.mul(2.0).mul(max(log(max(top, 1.0)), 0.0)));
    reach = reach ? max(reach, r) : r;
  }
  return reach;
}

// Poświata kreski w punkcie (dx w poprzek, dy wzdłuż) [px od środka]: suma gaussów mipów 0–1
// (splot kształtu kreski z jądrem przybliżony gaussem o sumie wariancji), energia na px².
function sparkGlow(dx, dy, varAcross, varAlong, spread) {
  let sum = null;
  for (const sigma of SPARK_GLOW_SIGMA_PX) {
    const sk = spread.mul(sigma);
    const s2 = sk.mul(sk);
    const vx = s2.add(varAcross);
    const vy = s2.add(varAlong);
    const term = exp(dx.mul(dx).div(vx.mul(-2.0)).add(dy.mul(dy).div(vy.mul(-2.0)))).div(sqrt(vx.mul(vy)).mul(2 * Math.PI));
    sum = sum ? sum.add(term) : term;
  }
  return sum.mul(OVERLAY_BLOOM_GAIN);
}

function additive(mat) {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = false;
  mat.lights = false;
  mat.fog = false;
  // Kolor dodawany (wkład już przemnożony w shaderze), alfa celu bez zmian — blask nie
  // wycina dziur w tle (jak pule efektów z 17 / 19).
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  mat.blendEquation = THREE.AddEquation;
  mat.blendEquationAlpha = THREE.AddEquation;
  // FrontSide jak dawny ShaderMaterial — płaskie kwady (tyłem do kamery) odrzucone jak w bazie.
  mat.side = THREE.FrontSide;
  return mat;
}

// Wkład cząstki → bufor HDR: liniowo (uLook = 0) albo z wyglądem overlaya; × mnożnik wyjścia,
// obcięty sufitem.
function outColor(U, contrib, out, cap) {
  const lin = contrib.toVar();
  const look = reactorLook(lin);
  return min(select(U.uLook.greaterThan(0.5), look, lin).mul(out), vec3(cap));
}

/**
 * Ogień: kolce i iskry (3, 4), rdzeń anamorficzny (5), pierścień fraktalny (6) — dawny
 * GPUInstancedParticleManager. Atrybuty instancji: aStartPos, aStartVel (lokalnie względem
 * początku puli, oś Z ku kamerze), aData = (narodziny, życie, rozmiar, typ).
 */
export function createReactorFireMaterial(U) {
  const vColor = varyingProperty('vec3', 'vRbColor');
  const vParams = varyingProperty('vec4', 'vRbParams'); // alfa, typ, wiek/życie, bok rdzenia [px]
  const vQuad = varyingProperty('float', 'vRbQuad');    // powiększenie kwadu rdzenia (poświata)
  const vSpark = varyingProperty('vec4', 'vRbSpark');   // kreska iskry: szerokość, długość, margines poświaty [px], waga poświaty
  const mat = additive(new THREE.NodeMaterial());
  mat.name = 'ReactorBlow:ogien';
  mat.vertexNode = Fn(() => {
    const startPos = attribute('aStartPos', 'vec3');
    const startVel = attribute('aStartVel', 'vec3');
    const data = attribute('aData', 'vec4');
    const q = positionGeometry;
    const type = data.w;
    const startTime = data.x;
    const maxLife = data.y;
    const age = U.uTime.sub(startTime).toVar();
    const clip = vec4(CLIP_OFF).toVar();
    If(age.greaterThanEqual(0.0).and(age.lessThanEqual(maxLife)), () => {
      const ageNorm = age.div(maxLife).toVar();
      const ratio = float(1.0).sub(ageNorm).toVar();
      const mv = vec4(0.0).toVar();
      const alpha = float(0.0).toVar();
      const col = vec3(0.0).toVar();
      const visible = float(1.0).toVar();
      const sidePx = float(0.0).toVar();
      const grow = float(1.0).toVar();
      const spark = vec4(0.0).toVar();
      If(type.lessThan(4.5), () => {
        // KOLCE I ISKRY: opór z haszu chwili narodzin (wszystkie iskry jednego wybuchu mają ten sam).
        const drag = reactorHash(startTime).mul(2.0).add(3.5).toVar();
        const decay = exp(age.negate().mul(drag)).toVar();
        const pos = startPos.add(startVel.mul(float(1.0).sub(decay).div(drag))).toVar();
        const curVel = startVel.mul(decay).toVar();
        const speed = length(curVel);
        // Oślepiająca biel z lodowym błękitem na końcu.
        col.assign(mix(vec3(5.0), vec3(0.0, 0.8, 2.0), sqrt(ageNorm)));
        alpha.assign(sqrt(ratio).mul(1.5));
        mv.assign(modelViewMatrix.mul(vec4(pos, 1.0)));
        const viewVel = modelViewMatrix.mul(vec4(curVel, 0.0)).xyz.toVar();
        const vlen = length(viewVel.xy);
        const dir = select(vlen.lessThan(0.1), vec2(0.0, 1.0), viewVel.xy.div(max(vlen, 1e-6))).toVar();
        const width = data.z;
        const stretch = data.z.mul(speed).mul(0.003);
        // Kreska w px ekranu i poświata overlaya wokół niej (mipy 0–1): kwad poszerzony o margines
        // na poświatę (najwyżej uSparkGlowMax), środek kwadu w środku kreski (dawniej głowa na
        // pozycji, ogon za nią — ten sam kształt, gdy margines 0).
        const pxPerUnit = cameraProjectionMatrix.element(0).x.mul(screenSize.x).mul(0.5).div(max(cameraProjectionMatrix.mul(mv).w, 1e-6)).toVar();
        const wPx = width.mul(pxPerUnit);
        const lPx = stretch.mul(pxPerUnit);
        const spread = screenSize.x.div(1920.0);
        const glowW = smoothstep(U.uSparkGlowAge0, max(U.uSparkGlowAge1, U.uSparkGlowAge0.add(1e-3)), age).mul(U.uSparkGlow);
        const energy = max(col.x, max(col.y, col.z)).mul(alpha).mul(U.uGainSpark).mul(glowW)
          .mul(SPARK_SHAPE_ENERGY).mul(wPx).mul(lPx);
        const varMax = max(wPx.mul(wPx).mul(SPARK_VAR_ACROSS), lPx.mul(lPx).mul(SPARK_VAR_ALONG));
        const marginPx = select(glowW.greaterThan(0.0), clamp(sparkGlowReach(energy, varMax, spread), 0.0, U.uSparkGlowMax.mul(spread)), float(0.0));
        const margin = marginPx.div(max(pxPerUnit, 1e-6));
        spark.assign(vec4(wPx, lPx, marginPx, glowW));
        const sx = q.x.mul(width.add(margin.mul(2.0))).toVar();
        const sy = stretch.mul(-0.5).add(q.y.mul(stretch.add(margin.mul(2.0)))).toVar();
        mv.xy.addAssign(vec2(sx.mul(dir.y).add(sy.mul(dir.x)), sx.negate().mul(dir.x).add(sy.mul(dir.y))));
        // Pas widoczny dawnej kamery overlaya.
        visible.assign(select(pos.z.lessThan(REACTOR_SLAB_MIN_Z).or(pos.z.greaterThan(REACTOR_SLAB_MAX_Z)), float(0.0), float(1.0)));
      }).ElseIf(type.lessThan(5.5), () => {
        // RDZEŃ ANAMORFICZNY (ładowanie i rozbłysk): bilboard w przestrzeni widoku; kwad powiększony
        // o miejsce na poświatę overlaya (zasięg widocznej poświaty z energii rdzenia i σ mipów,
        // najwyżej uHaloQuad), bok dawnego kwadu w px ekranu → fragment.
        const pos = startPos.add(startVel.mul(age));
        const currentSize = data.z.mul(ageNorm.mul(0.5).add(0.5)).toVar();
        col.assign(vec3(0.2, 0.8, 1.0).mul(10.0));
        alpha.assign(ratio.mul(ratio).mul(ratio));
        mv.assign(modelViewMatrix.mul(vec4(pos, 1.0)));
        const pxPerUnit = cameraProjectionMatrix.element(0).x.mul(screenSize.x).mul(0.5).div(max(cameraProjectionMatrix.mul(mv).w, 1e-6));
        sidePx.assign(currentSize.mul(pxPerUnit));
        const reach = coreHaloReach(sidePx, alpha.mul(10.0).mul(U.uGainCore).mul(U.uHaloAmp), U.uHaloSpread.mul(screenSize.x.div(1920.0)));
        grow.assign(clamp(reach.mul(2.0).div(max(sidePx, 1.0)), 1.0, max(U.uHaloQuad, 1.0)));
        mv.xy.addAssign(q.xy.mul(currentSize.mul(grow)));
      }).Else(() => {
        // PIERŚCIEŃ FRAKTALNY: płasko w płaszczyźnie gry (tyłem do kamery — patrz nagłówek).
        const pos = startPos.add(startVel.mul(age)).toVar();
        const currentSize = data.z.mul(pow(ageNorm, 0.4));
        col.assign(vec3(0.0, 0.8, 1.0).mul(4.0));
        alpha.assign(pow(ratio, 1.5));
        pos.x.addAssign(q.x.mul(currentSize));
        pos.y.subAssign(q.y.mul(currentSize));
        mv.assign(modelViewMatrix.mul(vec4(pos, 1.0)));
      });
      vColor.assign(col);
      vParams.assign(vec4(alpha, type, ageNorm, sidePx));
      vQuad.assign(grow);
      vSpark.assign(spark);
      If(visible.greaterThan(0.5), () => {
        clip.assign(cameraProjectionMatrix.mul(mv));
      });
    });
    return clip;
  })();
  mat.fragmentNode = Fn(() => {
    const vUv = uv().toVar();
    const vAlpha = max(vParams.x, 0.0);
    const vType = vParams.y;
    const vAgeNorm = clamp(vParams.z, 0.0, 1.0);
    const c = vec2(vUv.x.sub(0.5), vUv.y.sub(0.5)).toVar();
    const dist = length(c).mul(2.0).toVar();
    const contrib = vec3(0.0).toVar();
    If(vType.lessThan(4.5), () => {
      // KOLCE I ISKRY: poświata w poprzek, zaokrąglone końce, brokat w drugiej części życia —
      // we współrzędnych dawnego kwadu kreski (kwad poszerzony o margines poświaty), plus
      // poświata, jaką kreska miała od mipów 0–1 bloomu overlaya.
      const wPx = vSpark.x;
      const lPx = vSpark.y;
      const mPx = vSpark.z;
      const fullW = wPx.add(mPx.mul(2.0));
      const fullL = lPx.add(mPx.mul(2.0));
      const cO = vec2(c.x.mul(fullW).div(max(wPx, 1e-4)), c.y.mul(fullL).div(max(lPx, 1e-4))).toVar();
      const g = max(float(0.5).sub(abs(cO.x)), 0.0).mul(2.0);
      const glowX = g.mul(g).mul(g);
      const alongUv = cO.y.add(0.5);
      const fadeY = float(1.0).sub(smoothstep(0.8, 1.0, alongUv)).mul(smoothstep(0.0, 0.2, alongUv));
      const phase = U.uTime.mul(30.0).add(vColor.y.mul(100.0));
      const s = sin(phase.add(cO.x.mul(10.0)));
      const twinkleBlend = smoothstep(0.05, 0.15, vAgeNorm);
      const baseAlpha = glowX.mul(fadeY).mul(mix(1.0, s.mul(s), twinkleBlend));
      const energyCol = vColor.mul(vAlpha).mul(U.uGainSpark).toVar();
      contrib.assign(energyCol.mul(baseAlpha));
      If(mPx.greaterThan(0.0), () => {
        const s0 = sin(phase);
        const tw0 = mix(1.0, s0.mul(s0), twinkleBlend);
        const energy = energyCol.mul(tw0.mul(SPARK_SHAPE_ENERGY).mul(wPx).mul(lPx).mul(vSpark.w));
        const glow = sparkGlow(c.x.mul(fullW), c.y.mul(fullL), wPx.mul(wPx).mul(SPARK_VAR_ACROSS),
          lPx.mul(lPx).mul(SPARK_VAR_ALONG), screenSize.x.div(1920.0));
        contrib.addAssign(energy.mul(glow));
      });
    }).ElseIf(vType.lessThan(5.5), () => {
      // RDZEŃ: jądro, linia anamorficzna, aura — we współrzędnych dawnego kwadu (kwad powiększony
      // o miejsce na poświatę), plus poświata, jaką rdzeń miał od bloomu overlaya.
      const cO = c.mul(max(vQuad, 1.0)).toVar();
      const distO = length(cO).mul(2.0);
      const core = max(float(1.0).sub(smoothstep(0.0, 0.3, distO)), 0.0);
      const flareY = max(float(1.0).sub(smoothstep(0.0, 0.02, abs(cO.y))), 0.0);
      const flareX = max(float(1.0).sub(smoothstep(0.0, 0.5, abs(cO.x))), 0.0);
      const aura = max(float(1.0).sub(distO), 0.0);
      const intensity = max(core.add(flareY.mul(flareX).mul(2.0)).add(aura.mul(0.3)), 0.0);
      const energy = vColor.mul(vAlpha).mul(U.uGainCore).toVar();
      contrib.assign(energy.mul(intensity.mul(intensity)));
      If(U.uHaloAmp.greaterThan(0.0), () => {
        const side = max(vParams.w, 1.0);
        const spread = U.uHaloSpread.mul(screenSize.x.div(1920.0));
        const halo = coreHalo(cO.x.mul(side), cO.y.mul(side), side, spread);
        contrib.addAssign(energy.mul(halo.mul(side).mul(side).mul(U.uHaloAmp)));
      });
    }).Else(() => {
      // PIERŚCIEŃ: fraktalny szum po kącie, płynący od środka.
      If(dist.greaterThan(1.0), () => { Discard(); });
      const ringShape = max(float(1.0).sub(smoothstep(0.0, 0.15, abs(dist.sub(0.7)))), 0.0);
      const angle = atan(c.y, c.x);
      const n = reactorFbm(vec3(angle.mul(10.0), dist.mul(5.0).sub(U.uTime.mul(2.0)), U.uTime));
      const finalRing = ringShape.mul(n.mul(2.5));
      const innerGlow = max(smoothstep(0.0, 0.8, dist), 0.0).mul(0.2);
      contrib.assign(vColor.mul(finalRing.add(innerGlow).mul(vAlpha)).mul(U.uGainRing));
    });
    const spark = vType.lessThan(4.5);
    const out = select(vType.lessThan(3.5), U.uOutSpike, select(spark, U.uOutSpark, U.uOut));
    return vec4(outColor(U, contrib, out, select(spark, U.uCapSpark, U.uCap)), 0.0);
  })();
  return mat;
}

/**
 * Ciemna fala uderzeniowa (dawny GPUParticleManager, NormalBlending): w overlayu rysowana
 * PRZED ogniem na czarny cel — czyli wkład barwa × alfa dodany do sumy (`screen` i tak tylko
 * rozjaśnia). Płaski kwad tyłem do kamery — odrzucany jak w bazie (FrontSide).
 */
export function createReactorSmokeMaterial(U) {
  const vParams = varyingProperty('vec4', 'vRbSmoke'); // alfa, wiek/życie, —, —
  const mat = additive(new THREE.NodeMaterial());
  mat.name = 'ReactorBlow:dym';
  mat.vertexNode = Fn(() => {
    const startPos = attribute('aStartPos', 'vec3');
    const data = attribute('aData', 'vec4');
    const q = positionGeometry;
    const age = U.uTime.sub(data.x).toVar();
    const clip = vec4(CLIP_OFF).toVar();
    If(age.greaterThanEqual(0.0).and(age.lessThanEqual(data.y)), () => {
      const ageNorm = age.div(data.y).toVar();
      const currentSize = data.z.mul(pow(ageNorm, 0.4));
      const inv = float(1.0).sub(ageNorm);
      const pos = vec3(startPos).toVar();
      pos.x.addAssign(q.x.mul(currentSize));
      pos.y.subAssign(q.y.mul(currentSize));
      vParams.assign(vec4(inv.mul(inv).mul(0.9), ageNorm, 0.0, 0.0));
      clip.assign(cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(pos, 1.0))));
    });
    return clip;
  })();
  mat.fragmentNode = Fn(() => {
    const vUv = uv().toVar();
    const c = vec2(vUv.x.sub(0.5), vUv.y.sub(0.5)).toVar();
    const dist = length(c).mul(2.0).toVar();
    If(dist.greaterThan(1.0), () => { Discard(); });
    const ringShape = max(float(1.0).sub(smoothstep(0.0, 0.4, abs(dist.sub(0.7)))), 0.0);
    const angle = atan(c.y, c.x);
    const n = reactorFbm(vec3(angle.mul(12.0), dist.mul(3.0).sub(U.uTime), U.uTime.mul(0.5)));
    const a = ringShape.mul(n).mul(max(vParams.x, 0.0));
    // Mroczny granat reaktora × alfa (NormalBlending na czarnym celu = wkład addytywny).
    const contrib = vec3(0.02, 0.05, 0.1).mul(a).mul(U.uGainSmoke);
    return vec4(outColor(U, contrib, U.uOut, U.uCap), 0.0);
  })();
  return mat;
}
