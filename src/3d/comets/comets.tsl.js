// src/3d/comets/comets.tsl.js
//
// KOMETY — grafy TSL (raz na rodzaj; każda kometa = lekki klon materiału na tych samych węzłach, wartości
// per kometa w `material.uniforms` czytane przez `uniform().onObjectUpdate` — wzór planet, PLAN §3):
//
//   • ARKUSZ GAZU (pass ortho, addytywnie, pod kadłubami): KOMA (gaz — zieleń C₂, pył — obwiednia fontanny
//     od strony Słońca, cień jądra w pyle), DŻETY (spirale z obracającego się jądra, tylko ze strony dziennej
//     w chwili emisji, pył dżetów zawraca pod ciśnieniem promieniowania), ZIARNA (z bliska — „śnieżyca” jak
//     na zdjęciach Rosetty), WARKOCZ JONOWY (CO⁺ — niebieski, wąski, włókna, załamania, zerwania biegnące
//     z wiatrem), WARKOCZ PYŁOWY (model synchron / syndyn — src/game/comets.js; pasma synchroniczne, smugi
//     wzdłuż syndyn). Siatka 96 × 48 w prostokącie układu warkocza (`uExt`) — gęsta, żeby rulon warpa gnął
//     arkusz gładko (rulon owija wyjście wierzchołków każdego materiału — rulon.js).
//   • JĄDRO (pass ortho, nieprzezroczyste): ciemny regolit (albedo ~0,04, Lommel–Seeliger + Lambert),
//     relief z szumu 3D, plamy lodu, AO z wierzchołków, MIĘKKI CIEŃ WŁASNY — marsz w polu odległości bryły
//     (atlas 3D R8 wszystkich jąder, warstwa = kometa), maska słońca gry (cień planety), koma przed jądrem.
//
// UKŁAD ARKUSZA (lokalny układ siatki = scena obrócona o kierunek od Słońca): x — od Słońca, y — oś lokalna
// sceny; strona „za ruchem” = y · uNuc.w (znak). Słońce w tym układzie leży na kącie π.
// LUSTRA CPU (testy): `dustTailEnvelope`, `jetEmission`, `ionTailWidth`, `ionTailAxis` w src/game/comets.js —
// zmiana wzoru = obie strony.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, positionGeometry, positionLocal, normalLocal, varying,
  texture, texture3D, sin, cos, atan, exp, log, sqrt, abs, min, max, mix, smoothstep, clamp, fract, floor,
  dot, length, normalize, fwidth, select, Loop, hash
} from 'three/tsl';
import { fxNoise } from '../fx/noise.js';
import { blendAddytywnePremul } from '../tsl/mieszanie.js';
import { sunVisibility } from '../sunShadowMask.js';

const TWO_PI = Math.PI * 2;

/** Wspólne klucze uniformów (arkusz i jądro). */
export const COMET_SHARED_KEYS = Object.freeze([
  'uNuc',       // R jądra, R komy, aktywność, znak strony „za ruchem”
  'uComa',      // wierzchołek fontanny pyłu (od jądra ku Słońcu), jasność gazu, jasność pyłu komy, jasność dżetów
  'uSpin',      // obrót jądra względem osi warkocza [rad], ω [rad/s], prędkość gazu [j./s], ciśnienie na pył [j./s²]
  'uJetLon', 'uJetLat', 'uJetPow', 'uJetW',   // do 4 dżetów: długość, cos szerokości, moc, szerokość [rad]
  'uPhase',     // fazy (zawinięte na CPU): tekstura dżetów, płynięcie włókien jonowych, załamania, pasma pyłu
  'uPhase2',    // zerwanie warkocza jonowego (0–1), ziarna (przesunięcie komórek), migotanie, —
  'uTintComa', 'uTintIon', 'uTintDust'        // barwy (rgb) i — w .w — mnożnik
]);
export const COMET_SHEET_KEYS = Object.freeze([...COMET_SHARED_KEYS,
  'uExt',       // prostokąt arkusza [x0, x1, y0, y1] w układzie warkocza
  'uIon',       // długość, aberracja [rad], σ u nasady, rozwarcie σ / s
  'uDust',      // długość, C, bmin, rozmycie wyrzutem
  'uGain',      // jasność: jonowy, pyłowy, ziarna, zanik całości
  'uGain2'      // pył: zasięg wieku (u max), wykładnik kompresji jasności; jasność kondensacji centralnej, —
]);
export const COMET_NUCLEUS_KEYS = Object.freeze([...COMET_SHARED_KEYS,
  'uSunObj',    // kierunek do Słońca w układzie bryły (xyz), natężenie
  'uViewObj',   // kierunek do kamery w układzie bryły (xyz), udział komy przed jądrem
  'uSdf',       // warstwa atlasu, liczba warstw, zasięg pudła E, zakres pola
  'uAlbedo'     // albedo (rgb), udział plam lodu
]);

/** Strojenie wyglądu (stałe grafu — zmiana = przebudowa; wartości per kometa idą przez uniformy). */
export const COMET_LOOK = Object.freeze({
  sheetSegX: 96,
  sheetSegY: 48,
  grainCell: 70,           // komórka ziaren [j.]
  grainArc: 1400,          // komórek ziaren na obwód
  sdfSteps: 26,
  sunIntensity: 1.35,
  hazeFront: 0.12
});

export const COMET_STATS = { graphs: 0, materials: 0 };

function perObject(key) {
  return uniform(new THREE.Vector4(), 'vec4').onObjectUpdate(({ material }) => material.uniforms[key].value);
}

function makeUniformNodes(keys) {
  const U = {};
  for (const k of keys) U[k] = perObject(k);
  return U;
}

/** `material.uniforms` dla nowego klonu: { klucz: { value: Vector4 } }. */
export function makeCometUniformValues(keys) {
  const out = {};
  for (const k of keys) out[k] = { value: new THREE.Vector4() };
  return out;
}

const wrapPi = (a) => a.sub(float(TWO_PI).mul(floor(a.add(Math.PI).div(TWO_PI))));
// obrót wektora o stały kąt (współrzędne szumu — druga próbka pod innym kątem niż siatka tekstury)
const rot2 = (v, a) => vec2(v.x.mul(Math.cos(a)).sub(v.y.mul(Math.sin(a))), v.x.mul(Math.sin(a)).add(v.y.mul(Math.cos(a))));

// ---------------------------------------------------------------------------------------------------------
// Wspólne kawałki gazu (wklejane — bez setLayout; uniformy jako argumenty)

function tileNoise() { return fxNoise.tile2D(); }
function cloudNoise() { return fxNoise.cloud2D(); }

/** Koma: { gas, dust } w punkcie p (układ warkocza, j. gry). */
function comaTerms(p, rho, U) {
  const R = U.uNuc.x;
  const Rc = U.uNuc.y;
  // ~1/ρ z promieniem wygładzenia Rk (koma to rozmyta kula, nie ostry wierzchołek — ostry rdzeń daje kondensacja
  // centralna z daleka): 1 w środku, ~0,4 przy połowie promienia komy
  const Rk = max(R.mul(0.5), Rc.mul(0.18));
  const rs = sqrt(rho.mul(rho).add(Rk.mul(Rk)));
  const inv = Rk.div(rs);
  // gaz (C₂, CN): ~1/ρ z odcięciem na promieniu komy, lekko ściśnięty od Słońca, faktura płynącego gazu
  const sunward = clamp(p.x.negate().div(max(rho, 1.0)), -1.0, 1.0);
  const turb = texture(cloudNoise(), p.div(Rc.mul(0.9)).add(vec2(U.uPhase.x.mul(0.37), 0.21))).r;
  const gas = inv.mul(exp(rho.div(Rc.mul(0.85)).negate())).mul(sunward.mul(0.25).add(1.0)).mul(turb.mul(0.35).add(0.8));
  // pył komy: fontanna — ciśnienie promieniowania zawraca ziarna, od strony Słońca paraboloida o wierzchołku X
  const X = U.uComa.x;
  const xEnv = X.negate().add(p.y.mul(p.y).div(X.mul(4.0)));
  const inside = smoothstep(X.mul(-0.9), X.mul(0.9), p.x.sub(xEnv));
  // cień jądra w pyle: pas za jądrem (od Słońca) szerokości jądra, gaśnie z odległością
  const lane = float(1.0).sub(
    float(1.0).sub(smoothstep(R.mul(0.55), R.mul(1.1), abs(p.y)))
      .mul(smoothstep(R.mul(0.35), R.mul(1.3), p.x)).mul(exp(p.x.div(R.mul(7.0)).negate())).mul(0.62)
  );
  const dust = inv.mul(inside).mul(exp(rho.div(Rc.mul(1.25)).negate())).mul(lane);
  return { gas, dust, lane };
}

/** Dżety: suma jasności (spirale z obracającego się jądra, tylko ze strony dziennej w chwili emisji). */
function jetTerms(p, U) {
  const R = U.uNuc.x;
  const Rc = U.uNuc.y;
  const spinL = U.uSpin.x;
  const omega = U.uSpin.y;
  const vGas = U.uSpin.z;
  const push = U.uSpin.w;
  const total = float(0.0).toVar();
  const comps = ['x', 'y', 'z', 'w'];
  for (let j = 0; j < 4; j++) {
    const c = comps[j];
    const lon = U.uJetLon[c];
    const cl = max(U.uJetLat[c], 0.2);
    const pw = U.uJetPow[c];
    const wj = max(U.uJetW[c], 0.02);
    // ciśnienie promieniowania: pył dżetu przesuwa się od Słońca o ½·a·τ² — cofamy punkt o to przesunięcie
    // (z sufitem 0,5 ρ: dalej pył dżetów i tak wchodzi w warkocz, a pełna poprawka cofałaby odległe punkty
    // z powrotem pod jądro — fałszywe łuki w warkoczu)
    const rho0 = length(p);
    const tau0 = rho0.div(vGas.mul(cl));
    const q = vec2(p.x.sub(min(push.mul(0.5).mul(tau0).mul(tau0), rho0.mul(0.5))), p.y);
    const rq = length(q);
    const tau = max(rq.sub(R.mul(0.85)), 0.0).div(vGas.mul(cl));
    const phiE = lon.add(spinL).sub(omega.mul(tau));
    const d = wrapPi(atan(q.y, q.x).sub(phiE));
    const sig = wj.mul(smoothstep(R, R.mul(7.0), rq).mul(0.9).add(0.45));
    const g = exp(d.div(sig).mul(d.div(sig)).negate());
    const lit = smoothstep(0.0, 0.35, cl.negate().mul(cos(phiE)));
    const rad = R.div(rq.add(R.mul(0.15))).mul(smoothstep(R.mul(0.75), R.mul(1.0), rq)).mul(exp(rho0.div(Rc.mul(0.65)).negate()));
    const tex = texture(tileNoise(), vec2(U.uPhase.x.sub(tau.mul(0.045)), d.div(sig).mul(0.22).add(0.17 * j + 0.05))).r;
    total.addAssign(pw.mul(g).mul(lit).mul(rad).mul(tex.mul(1.2).add(0.35)));
  }
  return total;
}

// ---------------------------------------------------------------------------------------------------------
// Arkusz gazu

function ionTail(p, U, Yl, near) {
  const L = max(U.uIon.x, 1.0);
  const ca = cos(U.uIon.y);
  const sa = sin(U.uIon.y);
  const s = p.x.mul(ca).add(Yl.mul(sa));
  const n = p.x.mul(sa).negate().add(Yl.mul(ca));
  const sp = max(s, 0.0);
  const W = U.uIon.z.add(U.uIon.w.mul(sp));
  // załamanie (kink): jedno zaburzenie biegnące z wiatrem (faza → położenie), fala w jego obwiedni, plus łagodne
  // meandry całego warkocza (rosną z odległością)
  const sK = U.uPhase.z.mul(L.mul(1.4)).sub(L.mul(0.1));
  const dK = s.sub(sK).div(L.mul(0.11));
  const kinkA = W.mul(1.1).mul(exp(dK.mul(dK).negate())).mul(smoothstep(L.mul(0.04), L.mul(0.25), s));
  const k1 = sin(s.sub(sK).div(L.mul(0.09)).mul(TWO_PI));
  const mea = W.mul(0.12).mul(smoothstep(L.mul(0.1), L.mul(0.7), s)).mul(sin(s.div(L.mul(0.37)).sub(U.uPhase.y.mul(3.0)).mul(TWO_PI)));
  const nk = n.sub(kinkA.mul(k1)).sub(mea);
  const qn = nk.div(W);
  const env = exp(qn.mul(qn).mul(-0.9));
  // włókna: tekstura rozciągnięta wzdłuż osi (płynie z wiatrem), dwie skale
  const f1 = texture(tileNoise(), vec2(qn.mul(0.27).add(0.5), s.div(L.mul(1.3)).sub(U.uPhase.y))).r;
  const f2 = texture(tileNoise(), vec2(qn.mul(0.52).add(0.21), s.div(L.mul(0.7)).sub(U.uPhase.y.mul(1.31)))).g;
  // z bliska (near → 1): cieńsze włókna w skali kilometrów, płynące szybciej
  // (szum gradientowy w dwóch obróconych próbkach — rozbija kratę szumu przy rozciągnięciu wzdłuż osi)
  const q3 = vec2(qn.mul(1.4), s.div(L.mul(0.14)).sub(U.uPhase.y.mul(2.3)));
  const f3 = texture(cloudNoise(), q3).r.mul(0.6).add(texture(cloudNoise(), rot2(q3, 0.55).mul(1.6).add(vec2(0.31, 0.77))).b.mul(0.4));
  const fil = smoothstep(0.38, 0.95, f1.mul(0.62).add(f2.mul(0.5))).mul(mix(float(1.0), f3.mul(1.1).add(0.45), near));
  const core = exp(qn.mul(qn).mul(-7.0)).mul(smoothstep(L.mul(0.03), L.mul(0.2), s));
  // promienie przy głowie (składają się ku osi — „parasol” plazmy)
  const fold = U.uPhase2.y;
  const rayAng = mix(0.42, 0.08, fold);
  // (krawędzie smoothstep zawsze rosnące — WGSL: low ≥ high = wynik nieokreślony)
  const rayEnv = float(1.0).sub(smoothstep(L.mul(0.01), L.mul(0.16), s)).mul(smoothstep(0.0, L.mul(0.015), s));
  const rayW = W.mul(0.35).add(10.0);
  const r1 = n.sub(sp.mul(rayAng));
  const r2 = n.add(sp.mul(rayAng.mul(0.8)));
  const rays = exp(r1.div(rayW).mul(r1.div(rayW)).negate()).add(exp(r2.div(rayW).mul(r2.div(rayW)).negate())).mul(rayEnv).mul(0.8);
  const Rc = U.uNuc.y;
  const head = smoothstep(Rc.mul(-0.1), Rc.mul(0.4), s);
  const fall = float(1.0).div(sp.div(L.mul(0.7)).add(1.0)).mul(float(1.0).sub(smoothstep(L.mul(0.72), L.mul(1.04), s)));
  // zerwanie (disconnection event): przerwa biegnąca z wiatrem, warkocz za nią lekko przesunięty
  const sD = U.uPhase2.x.mul(L.mul(1.3));
  const gapW = L.mul(0.035);
  const gap = float(1.0).sub(exp(s.sub(sD).div(gapW).mul(s.sub(sD).div(gapW)).negate()).mul(0.88).mul(smoothstep(L.mul(0.08), L.mul(0.2), sD)));
  return env.mul(fil.mul(1.45).add(0.22).add(core.mul(0.55))).add(rays).mul(head).mul(fall).mul(gap);
}

/** Obwiednia × pasma warkocza pyłowego (lustro obwiedni: dustTailEnvelope w src/game/comets.js). */
function dustTail(p, U, Yl, near) {
  const Ld = max(U.uDust.x, 1.0);
  const C = U.uDust.y;
  const bmin = U.uDust.z;
  const ej = U.uDust.w;
  const Rc = U.uNuc.y;
  const X = p.x.div(Ld);
  const Y = Yl.div(Ld);
  // nasada: pył startuje w WEWNĘTRZNEJ komie (rampa do ~0,5 promienia komy), rozmycie ~ rozmiar komy
  const x0 = Rc.mul(0.08).div(Ld);
  const s0 = Rc.mul(0.22).div(Ld);
  const Xc = max(X, 1e-4);
  const Ya = max(abs(Y), 1e-5);
  // rozmycie u nasady = rozmiar komy (ziarna startują w całej komie) — dalej od głowy maleje
  const s0e = s0.div(Xc.div(x0.mul(2.0)).add(1.0));
  const u = Ya.div(C.mul(Xc));
  const b = C.mul(C).mul(Xc).mul(Xc).mul(Xc).div(Ya.mul(Ya));
  const sig = ej.mul(u).add(s0e);
  const eb = clamp(sig.mul(2.0).div(Ya), 0.05, 0.8);
  const inB = float(1.0).sub(smoothstep(float(1.0).sub(eb), eb.add(1.0), b))
    .mul(smoothstep(bmin.mul(float(1.0).sub(eb)), bmin.mul(eb.add(1.0)), b));
  const span = U.uGain2.x;
  const inU = float(1.0).sub(smoothstep(span.mul(0.55), span, u));
  const sigN = ej.mul(sqrt(Xc)).mul(0.5).add(s0e);
  const side = select(Y.greaterThanEqual(0.0), float(1.0), exp(Y.div(sigN).mul(Y.div(sigN)).negate()));
  const head = smoothstep(x0.mul(0.5), x0.mul(6.0), X);
  const tail = float(1.0).sub(smoothstep(0.7, 1.15, X));
  const mie = mix(float(1.0), float(0.12), smoothstep(0.3, 1.0, b));
  const env = head.mul(tail).mul(inB).mul(inU).mul(side).mul(mie).div(sqrt(Xc.add(x0)).mul(sqrt(Y.mul(Y).add(sig.mul(sig)))));
  // kompresja zakresu jasności (głowa ~100×, koniec ~2× — oko widzi logarytmicznie): env^γ
  const envC = exp(log(env.add(1e-6)).mul(U.uGain2.y));
  // pasma synchroniczne (zmienność wydajności w chwili emisji) i smugi wzdłuż syndyn (rozmiar ziaren)
  const qb = texture(tileNoise(), vec2(min(u, 3.0).mul(0.75).sub(U.uPhase.w), 0.37)).r;
  const bands = mix(float(1.0), smoothstep(0.2, 0.8, qb).mul(0.6).add(0.7), smoothstep(0.08, 0.4, X));
  const qs = texture(tileNoise(), vec2(log(max(b, 1e-4)).mul(0.14).add(0.13), 0.61)).g;
  const synd = qs.sub(0.5).mul(0.35).add(1.0);
  // z bliska: strugi pyłu w skali kilometrów rozciągnięte wzdłuż warkocza, wolno płynące od Słońca
  const qd = vec2(p.x.div(7000.0).sub(U.uPhase.w.mul(6.0)), Yl.div(2200.0));
  const strand = texture(cloudNoise(), qd).g.mul(0.6).add(texture(cloudNoise(), rot2(qd, 0.6).mul(1.7).add(vec2(0.37, 0.11))).b.mul(0.4));
  const fine = mix(float(1.0), strand.mul(0.9).add(0.55), near.mul(0.8));
  return { I: envC.mul(bands).mul(synd).mul(fine), b };
}

/** Ziarna pyłu przy jądrze (z bliska): komórki biegunowe płynące na zewnątrz, punkt ~1,5 px. */
function grainTerms(p, rho, U, lane, pix) {
  const R = U.uNuc.x;
  const cell = float(COMET_LOOK.grainCell);
  const show = float(1.0).sub(smoothstep(4.0, 14.0, pix));
  const cr = rho.sub(R).div(cell).sub(U.uPhase2.z);
  const ci = floor(cr);
  const fr = fract(cr);
  const th = atan(p.y, p.x);
  const ca = th.div(TWO_PI).add(0.5).mul(COMET_LOOK.grainArc);
  const cai = floor(ca);
  const fa = fract(ca);
  // hasz z liczb całkowitych (hash() rzutuje na u32 — ułamkowe przesunięcia dawały TEN SAM hasz)
  const ciw = ci.sub(floor(ci.div(1024.0)).mul(1024.0));
  const seed = ciw.mul(COMET_LOOK.grainArc).add(cai).mul(4.0);
  const h = hash(seed);
  const gx = hash(seed.add(1.0)).mul(0.6).add(0.2);
  const gy = hash(seed.add(2.0)).mul(0.6).add(0.2);
  const dens = clamp(R.div(max(rho, 1.0)).mul(R.div(max(rho, 1.0))).mul(0.22), 0.0, 0.16);
  const present = smoothstep(float(1.0).sub(dens), float(1.0).sub(dens).add(0.02), h);
  const dR = fr.sub(gx).mul(cell);
  const dA = fa.sub(gy).mul(rho.mul(TWO_PI / COMET_LOOK.grainArc));
  const d2 = dR.mul(dR).add(dA.mul(dA));
  const tw = sin(U.uPhase2.w.mul(TWO_PI).mul(h.mul(3.0).add(1.0)).add(h.mul(40.0))).mul(0.5).add(0.5);
  const size = hash(seed.add(3.0));
  const glint = exp(d2.div(pix.mul(pix).mul(size.mul(1.6).add(0.6))).negate()).mul(present)
    .mul(tw.mul(tw).mul(0.85).add(0.15)).mul(size.mul(size).mul(1.6).add(0.25));
  const zone = smoothstep(R.mul(0.95), R.mul(1.15), rho).mul(exp(rho.div(R.mul(5.0)).negate()));
  return glint.mul(zone).mul(show).mul(lane);
}

let _sheetGraph = null;

function buildSheetGraph() {
  if (_sheetGraph) return _sheetGraph;
  const U = makeUniformNodes(COMET_SHEET_KEYS);
  const g = positionGeometry;
  const local = vec2(mix(U.uExt.x, U.uExt.y, g.x), mix(U.uExt.z, U.uExt.w, g.y));
  const positionNode = vec3(local, 0.0);
  const vXY = varying(local, 'vCometXY');
  const fragmentNode = Fn(() => {
    const p = vXY.toVar();
    const rho = length(p).toVar();
    // rozmiar piksela w j. świata (pochodne przed jakimikolwiek gałęziami)
    const pix = max(fwidth(rho), 1e-3).toVar();
    const Yl = p.y.mul(U.uNuc.w).toVar();
    const rPx = U.uNuc.x.div(pix);
    const expo = mix(float(1.35), float(0.5), smoothstep(8.0, 140.0, rPx));
    // warkocze z bliska przygaszone (w środku warkocza kadr nie zachodzi mgłą), z daleka — pełna jasność
    const tailExpo = mix(float(1.0), float(0.25), smoothstep(30.0, 320.0, rPx));
    const coma = comaTerms(p, rho, U);
    const jets = jetTerms(p, U).mul(mix(float(1.25), float(0.75), smoothstep(8.0, 140.0, rPx)));
    // detal z bliska: piksel ≲ 15 j. (zoom ≳ 0,07) — pełny, ≳ 60 j. — brak
    const near = float(1.0).sub(smoothstep(15.0, 60.0, pix));
    const ion = ionTail(p, U, Yl, near);
    const dust = dustTail(p, U, Yl, near);
    const grains = grainTerms(p, rho, U, coma.lane, pix);
    // KONDENSACJA CENTRALNA: gdy jądro jest nierozdzielone (promień < ~12 px), głowa świeci jak gwiazda —
    // wewnętrzna koma i jądro w kilku pikselach (zdjęcia z daleka); przy rozdzielonym jądrze znika.
    const condOn = float(1.0).sub(smoothstep(3.0, 12.0, rPx));
    const q1 = rho.div(pix.mul(2.0));
    const q2 = rho.div(pix.mul(7.0));
    const cond = exp(q1.mul(q1).negate()).add(exp(q2.mul(q2).negate()).mul(0.22)).mul(condOn).mul(U.uGain2.z);
    // brzeg arkusza: miękkie wygaszenie na ostatnich 6% prostokąta (żadnej widocznej krawędzi)
    const ex = min(p.x.sub(U.uExt.x), U.uExt.y.sub(p.x)).div(U.uExt.y.sub(U.uExt.x).mul(0.06));
    const ey = min(p.y.sub(U.uExt.z), U.uExt.w.sub(p.y)).div(U.uExt.w.sub(U.uExt.z).mul(0.06));
    const edge = smoothstep(0.0, 1.0, clamp(ex, 0.0, 1.0)).mul(smoothstep(0.0, 1.0, clamp(ey, 0.0, 1.0)));
    // barwy: gaz komy (zieleń C₂ → biel przy jądrze), pył (młody — biały, stary — żółtawy), jony (CO⁺)
    const tc = U.uTintComa.xyz;
    const td = U.uTintDust.xyz;
    const ti = U.uTintIon.xyz;
    const gasCol = mix(tc, vec3(1.0, 1.0, 0.95), clamp(coma.gas.mul(0.35), 0.0, 0.6)).mul(coma.gas).mul(U.uComa.y).mul(expo);
    const dustYoung = td.mul(vec3(1.0, 0.97, 0.92));
    const dustOld = td.mul(vec3(1.0, 0.84, 0.62));
    const dustCol0 = mix(dustOld, dustYoung, smoothstep(U.uDust.z, 1.0, dust.b)).mul(dust.I.mul(U.uGain.y));
    const comaDust = td.mul(coma.dust).mul(U.uComa.z).mul(expo);
    const jetCol = mix(td, vec3(1.0), 0.35).mul(jets).mul(U.uComa.w);
    const ionCol0 = mix(ti, vec3(0.7, 0.85, 1.0), clamp(ion.mul(0.25), 0.0, 0.5)).mul(ion).mul(U.uGain.x);
    // warkocze: miękkie kolano jasności (słabe partie bez zmian, nasada nie robi białej ściany) × ekspozycja
    const kneeT = (c) => c.div(dot(c, vec3(0.3, 0.5, 0.2)).mul(1.1).add(1.0)).mul(tailExpo);
    const dustCol = kneeT(dustCol0);
    const ionCol = kneeT(ionCol0);
    const grainCol = vec3(1.0, 0.97, 0.9).mul(grains).mul(U.uGain.z);
    const condCol = mix(tc, vec3(1.0, 0.98, 0.92), 0.6).mul(cond);
    const col = gasCol.add(dustCol).add(comaDust).add(jetCol).add(ionCol).add(grainCol).add(condCol).mul(U.uGain.w).mul(edge);
    const c = max(col, vec3(0.0));
    return vec4(c, max(c.x, max(c.y, c.z)));
  })();
  COMET_STATS.graphs++;
  _sheetGraph = { U, positionNode, fragmentNode };
  return _sheetGraph;
}

let _sheetBase = null;

/** Materiał arkusza dla komety (lekki klon wspólnego grafu). */
export function createCometSheetMaterial() {
  if (!_sheetBase) {
    const G = buildSheetGraph();
    const m = new THREE.NodeMaterial();
    m.name = 'CometSheet';
    m.lights = false;
    m.fog = false;
    m.transparent = true;
    m.depthWrite = false;
    m.depthTest = true;
    m.side = THREE.DoubleSide;
    m.forceSinglePass = true;
    blendAddytywnePremul(m);
    m.positionNode = G.positionNode;
    m.fragmentNode = G.fragmentNode;
    m.uniforms = makeCometUniformValues(COMET_SHEET_KEYS);
    _sheetBase = m;
  }
  const mat = _sheetBase.clone();
  mat.uniforms = makeCometUniformValues(COMET_SHEET_KEYS);
  COMET_STATS.materials++;
  return mat;
}

/** Siatka arkusza: kwadrat [0, 1]² z podziałem (rulon warpa gnie wierzchołki). */
export function createCometSheetGeometry(segX = COMET_LOOK.sheetSegX, segY = COMET_LOOK.sheetSegY) {
  const nv = (segX + 1) * (segY + 1);
  const pos = new Float32Array(nv * 3);
  let k = 0;
  for (let j = 0; j <= segY; j++) {
    for (let i = 0; i <= segX; i++) {
      pos[k++] = i / segX; pos[k++] = j / segY; pos[k++] = 0;
    }
  }
  const idx = new Uint16Array(segX * segY * 6);
  let t = 0;
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * (segX + 1) + i;
      const b = a + 1, c = a + segX + 1, d = c + 1;
      idx[t++] = a; idx[t++] = b; idx[t++] = c;
      idx[t++] = b; idx[t++] = d; idx[t++] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.name = 'CometSheetGrid';
  return geo;
}

// ---------------------------------------------------------------------------------------------------------
// Jądro

/** Atlas pól odległości jąder: tekstura 3D R8 n × n × (n · warstwy), 255 = daleko na zewnątrz. */
export function createCometSdfAtlas(n, layers) {
  const data = new Uint8Array(n * n * n * Math.max(1, layers)).fill(255);
  const tex = new THREE.Data3DTexture(data, n, n, n * Math.max(1, layers));
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'CometSdfAtlas';
  tex.needsUpdate = true;
  return tex;
}

const _nucleusGraphs = new Map();   // atlas → graf (atlas ustala gra raz)

function buildNucleusGraph(atlas, gridN) {
  if (_nucleusGraphs.has(atlas)) return _nucleusGraphs.get(atlas);
  const U = makeUniformNodes(COMET_NUCLEUS_KEYS);
  const noise3 = fxNoise.noise3D();
  const half = 0.5 / gridN;
  const sdfAt = (q) => {
    const E = U.uSdf.z;
    const uvw = q.div(E).mul(0.5).add(0.5);
    const out = uvw.x.lessThan(0.0).or(uvw.y.lessThan(0.0)).or(uvw.z.lessThan(0.0))
      .or(uvw.x.greaterThan(1.0)).or(uvw.y.greaterThan(1.0)).or(uvw.z.greaterThan(1.0));
    const w = U.uSdf.x.add(clamp(uvw.z, half, 1.0 - half)).div(U.uSdf.y);
    const d = texture3D(atlas, vec3(uvw.x, uvw.y, w)).level(0).r.sub(0.5).mul(2.0).mul(U.uSdf.w);
    return select(out, U.uSdf.w, d);
  };
  const fragmentNode = Fn(() => {
    const P = positionLocal.toVar();
    const N0 = normalize(normalLocal).toVar();
    const pixN = max(fwidth(P.x).add(fwidth(P.y)).mul(0.5).mul(U.uNuc.x), 1e-3).toVar();
    // RELIEF (mapa wypukłości z szumu 3D, trzy skale): szum grzbietowy 1 − |2n − 1| daje ostre krawędzie —
    // urwiska, rumosz, głazy; na gładkich równinach pyłowych (powierzchnia prostopadła do promienia + maska)
    // relief słabnie (pył zasypuje drobne nierówności — jak równiny Hapi na 67P).
    const e = 1.0 / 64.0;
    const ridged = (v) => float(1.0).sub(abs(v.mul(2.0).sub(1.0)));
    const bump = (scale, amp, ch, off) => {
      const s = P.mul(scale).add(off);
      const f0 = ridged(texture3D(noise3, s).level(0)[ch]);
      const gx = ridged(texture3D(noise3, s.add(vec3(e, 0, 0))).level(0)[ch]).sub(f0);
      const gy = ridged(texture3D(noise3, s.add(vec3(0, e, 0))).level(0)[ch]).sub(f0);
      const gz = ridged(texture3D(noise3, s.add(vec3(0, 0, e))).level(0)[ch]).sub(f0);
      return { g: vec3(gx, gy, gz).mul(amp), f: f0 };
    };
    const b1 = bump(0.9, 9.0, 'r', vec3(0.13, 0.57, 0.31));
    const b2 = bump(2.7, 6.0, 'g', vec3(0.71, 0.23, 0.49));
    const b3 = bump(7.5, 3.2, 'r', vec3(0.37, 0.91, 0.05));
    const plainN = texture3D(noise3, P.mul(0.45).add(vec3(0.5, 0.2, 0.8))).level(0).g;
    const plain = smoothstep(0.82, 0.96, dot(N0, normalize(P))).mul(smoothstep(0.45, 0.6, plainN));
    const gsum = b1.g.add(b2.g).add(b3.g).mul(float(1.0).sub(plain.mul(0.7)));
    const N = normalize(N0.sub(gsum.sub(N0.mul(dot(gsum, N0))))).toVar();
    const L = U.uSunObj.xyz;
    const V = U.uViewObj.xyz;
    // terminator z makro-normalnej: relief nie zapala faset po nocnej stronie bryły (zasłania je horyzont)
    const macro = smoothstep(-0.12, 0.22, dot(N0, L));
    const mu0 = max(dot(N, L), 0.0).mul(macro);
    const mu = max(dot(N, V), 0.05);
    const ls = mu0.mul(2.0).div(mu0.add(mu).add(1e-4));
    const brdf = mix(mu0, ls, 0.55);
    // miękki cień własny: marsz w polu odległości w stronę Słońca
    const vis = float(1.0).toVar();
    const t = float(0.035).toVar();
    const o = P.add(N0.mul(0.03)).toVar();
    Loop({ start: 0, end: COMET_LOOK.sdfSteps, type: 'int', condition: '<', name: 'ci' }, () => {
      const h = sdfAt(o.add(L.mul(t))).toVar();
      vis.assign(min(vis, h.mul(9.0).div(t)));
      t.addAssign(clamp(h, 0.025, 0.2));
    });
    const sh = smoothstep(0.0, 1.0, clamp(vis, 0.0, 1.0));
    // albedo: ciemny regolit (plamy, ciemniejsze szczeliny i zagłębienia, jaśniejsze równiny pyłowe), rzadkie
    // małe plamy odsłoniętego lodu (na 67P — metrowe, albedo ~0,4)
    const tone = texture3D(noise3, P.mul(0.33).add(vec3(0.17, 0.41, 0.29))).level(0).g;
    const crev = b1.f.mul(0.5).add(b2.f.mul(0.5));
    const iceN = texture3D(noise3, P.mul(2.3).add(vec3(0.61, 0.13, 0.77))).level(0).r;
    const ice = smoothstep(0.84, 0.9, iceN).mul(U.uAlbedo.w).mul(float(1.0).sub(plain));
    const base = U.uAlbedo.xyz.mul(tone.mul(0.55).add(0.7)).mul(crev.mul(0.35).add(0.75)).mul(plain.mul(0.18).add(1.0));
    const alb = mix(base, vec3(0.22, 0.25, 0.29), ice);
    const ao = attribute('aAo', 'float');
    const sunI = U.uSunObj.w;
    const direct = alb.mul(sunI).mul(brdf).mul(sh).mul(sunVisibility());
    const ambient = alb.mul(0.05).mul(ao).mul(b1.f.mul(0.4).add(0.8));
    // koma przed jądrem (połowa gazu leży między kamerą a bryłą): ten sam wzór co arkusz, w układzie warkocza
    const R = U.uNuc.x;
    const cs = cos(U.uSpin.x);
    const sn = sin(U.uSpin.x);
    const pt = vec2(P.x.mul(cs).sub(P.y.mul(sn)), P.x.mul(sn).add(P.y.mul(cs))).mul(R);
    const rhoT = length(pt);
    const coma = comaTerms(pt, rhoT, U);
    const farN = smoothstep(8.0, 140.0, R.div(pixN));
    const expoN = mix(float(1.35), float(0.5), farN);
    // z daleka głowa świeci przed jądrem mocniej (gruba kolumna komy), z bliska — tylko lekka mgiełka
    const hazeK = mix(float(0.55), U.uViewObj.w, farN);
    const haze = U.uTintComa.xyz.mul(coma.gas).mul(U.uComa.y).mul(expoN)
      .add(U.uTintDust.xyz.mul(coma.dust.mul(U.uComa.z).mul(expoN)))
      .mul(hazeK);
    return vec4(direct.mul(ao.mul(0.35).add(0.65)).add(ambient).add(haze), 1.0);
  })();
  COMET_STATS.graphs++;
  const graph = { U, fragmentNode };
  _nucleusGraphs.set(atlas, graph);
  return graph;
}

const _nucleusBase = new Map();

/** Materiał jądra (lekki klon wspólnego grafu dla danego atlasu). */
export function createCometNucleusMaterial(atlas, gridN) {
  let base = _nucleusBase.get(atlas);
  if (!base) {
    const G = buildNucleusGraph(atlas, gridN);
    base = new THREE.NodeMaterial();
    base.name = 'CometNucleus';
    base.lights = false;
    base.fog = false;
    base.fragmentNode = G.fragmentNode;
    base.uniforms = makeCometUniformValues(COMET_NUCLEUS_KEYS);
    _nucleusBase.set(atlas, base);
  }
  const mat = base.clone();
  mat.uniforms = makeCometUniformValues(COMET_NUCLEUS_KEYS);
  COMET_STATS.materials++;
  return mat;
}
