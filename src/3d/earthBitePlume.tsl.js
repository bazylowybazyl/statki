// Słup konwekcyjny nad wielkim gryzem Ziemi — graf TSL (marsz promienia przez objętość). Część CPU (nastawy, bryła-
// pośrednik, szum, pioruny): earthBitePlumeShape.js, obiekty three: earthBitePlume3D.js.
//
// Bryła-pośrednik (wycinek kuli nad gryzem, ściany przednie, test głębi) daje punkt wejścia promienia; dalej wszystko
// liczy fragment: koniec drogi analitycznie (kula Ziemi poza gryzem, ściany gryzu — kula β bazowego, klamry nad
// otworem), marsz z krokiem drobnym w powłoce kowadła i grubszym w kolumnie, gęstość = kształt (kolumna z przechyłem
// i kopułą, kowadło z wiatrem) erodowany kaflem szumu 3D, który jedzie z przepływem (wznoszenie, wir, wypływ).
// Światło w punkcie: SŁOŃCE (cień kuli Ziemi, w głębi gryzu — wyjście przez otwór; zachód — przepuszczalność
// atmosfery przy muśnięciu promienia; samocień dwiema próbkami kształtu; maska słońca gry), ŻAR DNA od spodu
// (współczynnik widzenia otworu, tłumienie słupem), NIEBO (zapylone, tylko za dnia), GORĄCY GAZ przy jeziorze
// (świeci sam), BŁYSKI PIORUNÓW (poświata w chmurze wokół punktu wyładowania). Wyjście premultiplied: (barwa,
// 1 − przepuszczalność), mieszanie ONE / ONE_MINUS_SRC_ALPHA.
//
// Graf RAZ (moduł), wartości per obiekt w `material.uniforms` (obiekty { value } — część dzielona z kulą Ziemi:
// sunPosition, uBite, uHazeBeta, uHazeStrength, uSunShadowRecv). Próbki szumu `.level(0)` (pętla z Break — przepływ
// niejednolity), pochodne (fwidth) i maska słońca poza pętlą.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, int, vec2, vec3, vec4, uniform, varying, texture3D,
  positionLocal, positionView, modelWorldMatrix, modelWorldMatrixInverse, cameraWorldMatrix, cameraProjectionMatrix,
  screenCoordinate, abs, atan, clamp, cos, sin, cross, dot, exp, fract, fwidth, length, max, min, mix, normalize, pow,
  select, smoothstep, sqrt
} from 'three/tsl';
import { sunVisibility } from './sunShadowMask.js';
import { EARTH_BITE } from '../data/earthBite.js';
import { EARTH_RADIUS_KM } from './earthBiteShape.js';
import { bakePlumeNoise, PLUME_NOISE_SIZE } from './earthBitePlumeShape.js';
import { earthBiteCoords, earthBiteEast } from './earthBite.tsl.js';

const BIG = 1e9;
const KM = 1 / EARTH_RADIUS_KM;
const DEG = Math.PI / 180;
/** Najwięcej kroków marszu na piksel (walec kolumny ~36 + powłoka kowadła ~16 + skoki). */
export const PLUME_MAX_STEPS = 72;

// Barwy (liniowe): popiół (pył Ziemi przyszłości — brąz z szarością), żar dna (jak światło dna na ścianach gryzu),
// gorący gaz przy jeziorze, błysk wyładowania, niebo za dnia.
export const PLUME_TSL = Object.freeze({
  ash: [0.25, 0.205, 0.165],
  ashDark: [0.13, 0.112, 0.096],
  glow: [1.0, 0.42, 0.12],
  hot: [1.0, 0.36, 0.08],
  flash: [0.72, 0.78, 1.0],
  sky: [0.52, 0.5, 0.47],
  // muśnięcie atmosfery przez promień ku słońcu: masa powietrza przy h = 0 (jak pas zachodu planety) i wysokość skali
  grazeK: 80.0,
  grazeH: 0.012,
  phaseG: 0.3,
  // żar dna rozproszony w kolumnie (×glow, przy brzegu otworu; ku szczytowi słabnie do zera)
  lantern: 0.22
});

/** Klucze `material.uniforms` (typ węzła). */
export const PLUME_KEYS = Object.freeze({
  sunPosition: 'vec3', uBite: 'vec4', uHazeBeta: 'vec3', uHazeStrength: 'float', uSunShadowRecv: 'float',
  uPlTime: 'float', uPlFade: 'float', uPlWind: 'vec3',
  uPlCol: 'vec4',     // zBot, zRim, zTop, lean
  uPlRad: 'vec4',     // rBot, rRim, rTop, zDome
  uPlAnv: 'vec4',     // hLo, hHi, lenDown, lenUp
  uPlAnv2: 'vec4',    // halfWidth, spread, sigmaAnvil, rBound (promień kuli obwiedni)
  uPlDens: 'vec4',    // sigmaCol, sigmaLow, erosion, zLake
  uPlLight: 'vec4',   // sun, glow, ambient, emit
  uPlFlow: 'vec4',    // rise, outflow, swirl, noiseScale
  uPlFlash0: 'vec4', uPlFlash1: 'vec4', uPlFlash2: 'vec4', uPlFlash3: 'vec4',   // punkt (obiekt) + jasność
  uPlFlashR: 'vec4'   // promienie poświaty błysków
});

function perObject(key, type) {
  const init = type === 'vec4' ? new THREE.Vector4() : (type === 'vec3' ? new THREE.Vector3() : 0);
  return uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
}

// 1 poniżej lo, 0 powyżej hi (smoothstep ze stałymi krawędziami lo ≥ hi to błąd WGSL — pułapka 6)
function sdown(lo, hi, x) {
  return float(1.0).sub(smoothstep(lo, hi, x));
}

// Promień ↔ kula (środek c, promień r): vec2(wejście, wyjście); chybienie — (BIG, −BIG).
function raySphere(ro, rd, c, r) {
  const oc = ro.sub(c);
  const b = dot(oc, rd);
  const disc = b.mul(b).sub(dot(oc, oc)).add(r.mul(r));
  const s = sqrt(max(disc, 0.0));
  return select(disc.greaterThan(0.0), vec2(b.negate().sub(s), b.negate().add(s)), vec2(BIG, -BIG));
}

// ── Kształt ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Kolumna: z = x · A, przechył z wiatrem ∝ s², promień: dno → brzeg otworu → szczyt, nad zDome kopuła.
// k — odległość od osi w promieniach kolumny (0 oś … 1 brzeg), q — wektor poziomy od osi (do szumu).
function columnField(p, A, W, U) {
  const c0 = U.uPlCol, c1 = U.uPlRad;
  const z = dot(p, A).toVar();
  const s = clamp(z.sub(c0.x).div(c0.z.sub(c0.x)), 0.0, 1.0);
  const q = p.sub(A.mul(z)).sub(W.mul(s.mul(s).mul(c0.w))).toVar();
  const sR = smoothstep(c0.x, c0.y, z);
  const sT = smoothstep(c0.y, c0.z, z);
  const rc = mix(mix(c1.x, c1.y, sR), c1.z, sT).toVar();
  const k = length(q).div(max(rc, 1e-4)).toVar();
  // próg szumu: rośnie ku brzegowi (k) i ku szczytowi (od zDome do zTop) — brzeg i wierzch to poziomica szumu (kłęby)
  const thr = max(smoothstep(0.75, 1.25, k), smoothstep(c1.w, c0.z, z)).mul(0.95).add(0.1).toVar();
  const inZ = smoothstep(c0.x, c0.x.add(0.02), z).mul(sdown(c0.z.sub(0.004), c0.z, z));
  return { z, q, rc, k, thr, inZ };
}

// Kowadło: wysokość h nad kulą, kąt z wiatrem u (+ z wiatrem), w poprzek v; elipsa śladu qa (0 nasada … 1 brzeg),
// pasmo wysokości: szczyt opada, podstawa się podnosi ku brzegowi.
function anvilField(p, r, A, W, Bn, U) {
  const a0 = U.uPlAnv, a1 = U.uPlAnv2;
  const h = r.sub(1.0).toVar();
  const d = p.div(max(r, 1e-4));
  const u = atan(dot(d, W), dot(d, A)).toVar();
  const v = dot(d, Bn).toVar();
  const un = select(u.greaterThan(0.0), u.div(a0.z), u.negate().div(a0.w));
  const vn = v.div(a1.x.add(a1.y.mul(max(u, 0.0))));
  const qa = sqrt(un.mul(un).add(vn.mul(vn))).toVar();
  const top = a0.y.sub(a0.y.sub(a0.x).mul(qa.mul(0.5))).toVar();
  const base = a0.x.add(a0.y.sub(a0.x).mul(qa.mul(0.2))).toVar();
  const band = smoothstep(base, base.add(0.006), h).mul(sdown(top.sub(0.012), top, h));
  const foot = sdown(0.62, 1.0, qa);
  return { h, u, v, qa, top, base, band, foot };
}

// Gęstość kolumny bez szumu (kształt średni) — próbki światła.
function columnSigma(cf, U, dens0 = 0.5) {
  return clamp(float(dens0).sub(cf.thr).mul(12.0), 0.0, 1.0).mul(cf.inZ)
    .mul(mix(U.uPlDens.y, U.uPlDens.x, smoothstep(U.uPlCol.y.sub(0.15), U.uPlCol.y.add(0.02), cf.z)));
}

let _noise = null;
/** Kafel szumu słupa (Data3DTexture RGBA8, powtarzalny; wypiek CPU przy pierwszym użyciu). */
export function plumeNoiseTexture() {
  if (!_noise) {
    const n = PLUME_NOISE_SIZE;
    const t = new THREE.Data3DTexture(bakePlumeNoise(n), n, n, n);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.generateMipmaps = false;
    t.unpackAlignment = 1;
    t.colorSpace = THREE.NoColorSpace;
    t.name = 'EarthBitePlumeNoise';
    t.needsUpdate = true;
    _noise = t;
  }
  return _noise;
}

function buildPlumeGraph() {
  const U = {};
  for (const [key, type] of Object.entries(PLUME_KEYS)) U[key] = perObject(key, type);
  const noise = plumeNoiseTexture();
  const T = PLUME_TSL;
  const vLocal = varying(positionLocal, 'vPlumeLocal');
  const vWorld = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vPlumeWorld');
  const flashes = [U.uPlFlash0, U.uPlFlash1, U.uPlFlash2, U.uPlFlash3];
  const flashR = [U.uPlFlashR.x, U.uPlFlashR.y, U.uPlFlashR.z, U.uPlFlashR.w];

  const fragmentNode = Fn(() => {
    // poza gałęziami: rozmiar piksela w układzie obiektu, maska słońca gry (próbka po screenUV)
    const pix = length(fwidth(vLocal)).toVar();
    const sunVisP = mix(1.0, sunVisibility(), U.uSunShadowRecv).toVar();
    const ro = vec3(vLocal).toVar();
    // promień: z góry (ortho) wzdłuż osi kamery, inaczej od kamery przez piksel → układ obiektu
    const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
    const rdV = select(ortho, vec3(0.0, 0.0, -1.0), normalize(positionView));
    const rd = normalize(modelWorldMatrixInverse.mul(vec4(cameraWorldMatrix.mul(vec4(rdV, 0.0)).xyz, 0.0)).xyz).toVar();
    const L = normalize(modelWorldMatrixInverse.mul(vec4(normalize(U.sunPosition.sub(vWorld)), 0.0)).xyz).toVar();
    const A = normalize(U.uBite.xyz).toVar();
    const b = U.uBite.w.toVar();
    const W = normalize(U.uPlWind).toVar();
    const Bn = cross(A, W).toVar();

    // ── koniec drogi: kula Ziemi poza gryzem, ściany gryzu, klamry ──
    // Ściana gryzu to kula β(φ, ψ) (płaty, zęby — do ±12% β bazowego): wejście do kuli Ziemi w otworze i wyjście przez
    // ścianę liczone z β w punkcie (jedna poprawka po kuli β bazowego), inaczej słup prześwitywałby przez ścianę.
    const east = earthBiteEast(A).toVar();
    const e = raySphere(ro, rd, vec3(0.0), float(1.0)).toVar();
    const tIn = max(e.x, 0.0).toVar();
    const hitEarth = e.y.greaterThan(tIn);
    const cIn = earthBiteCoords(ro.add(rd.mul(tIn)), U.uBite, east);
    const inBite = cIn.x.lessThan(cIn.w);
    const w0 = raySphere(ro, rd, A, b);
    const cW = earthBiteCoords(ro.add(rd.mul(w0.y)), U.uBite, east);
    const w = raySphere(ro, rd, A, cW.w);
    const tWall = select(w.y.lessThan(e.y), w.y, float(BIG));
    const tHit = select(hitEarth, select(inBite, tWall, tIn), float(BIG)).toVar();
    {
      // klamry: płyty |x · n − s| < w/2 w powłoce [bottomKm, topKm] nad kulą, nad otworem (zasięg od C)
      const RB = EARTH_BITE.ribs;
      const north = cross(A, east);
      const a = RB.axisDeg * DEG;
      const nRib = east.mul(Math.cos(a)).add(north.mul(Math.sin(a))).toVar();
      const s1 = raySphere(ro, rd, vec3(0.0), float(1 + RB.topKm * KM));
      const s0 = raySphere(ro, rd, vec3(0.0), float(1 + RB.bottomKm * KM));
      const shIn = s1.x;
      const shOut = select(s0.x.lessThan(BIG * 0.5), s0.x, s1.y);
      const ln0 = dot(rd, nRib);
      const ln = select(abs(ln0).lessThan(1e-6), float(1e-6), ln0).toVar();
      const pn = dot(ro, nRib).toVar();
      const w2 = RB.widthKm * 0.5 * KM;
      const reach = b.mul(1.25).add(RB.anchorKm * KM).toVar();
      for (const off of RB.offsets) {
        const s = b.mul(off);
        const ta = s.sub(w2).sub(pn).div(ln), tb = s.add(w2).sub(pn).div(ln);
        const t0 = max(min(ta, tb), shIn);
        const t1 = min(max(ta, tb), shOut);
        const near = length(ro.add(rd.mul(t0)).sub(A)).lessThan(reach);
        tHit.assign(select(t1.greaterThan(t0).and(t0.greaterThan(0.0)).and(near), min(tHit, t0), tHit));
      }
    }
    const bound = raySphere(ro, rd, vec3(0.0), U.uPlAnv2.w);
    const tStart = max(bound.x, 0.0).toVar();
    const tEnd = min(tHit, bound.y).toVar();

    // kroki: drobne w walcu kolumny (droga przez walec / 36) i w powłoce kowadła (droga przez powłokę / 16), poza nimi
    // skok do najbliższego wejścia
    const rA0 = U.uPlAnv.x.mul(0.85).add(1.0).toVar();
    const rA1 = U.uPlAnv.y.add(1.0).toVar();
    const a1 = raySphere(ro, rd, vec3(0.0), rA1);
    const a0 = raySphere(ro, rd, vec3(0.0), rA0);
    const aIn = max(a1.x, tStart).toVar();
    const aOut = min(select(a0.x.greaterThan(aIn).and(a0.x.lessThan(BIG * 0.5)), a0.x, a1.y), tEnd);
    const dtA = max(max(aOut.sub(aIn), 0.0).div(16.0), 0.0026).toVar();
    // walec kolumny: oś A przesunięta o pół przechyłu, promień z zapasem na kłęby; z ∈ [zBot, zTop]
    const oc = ro.sub(W.mul(U.uPlCol.w.mul(0.5)));
    const ocp = oc.sub(A.mul(dot(oc, A)));
    const rdp = rd.sub(A.mul(dot(rd, A)));
    const rcb = max(U.uPlRad.y, U.uPlRad.z).mul(1.6).add(U.uPlCol.w.mul(0.5));
    const qa2 = max(dot(rdp, rdp), 1e-8);
    const qb = dot(ocp, rdp);
    const qd = qb.mul(qb).sub(qa2.mul(dot(ocp, ocp).sub(rcb.mul(rcb))));
    const qs = sqrt(max(qd, 0.0));
    const cyl = select(qd.greaterThan(0.0), vec2(qb.negate().sub(qs), qb.negate().add(qs)).div(qa2), vec2(BIG, -BIG));
    const az0 = dot(rd, A);
    const az = select(abs(az0).lessThan(1e-6), float(1e-6), az0);
    const oz = dot(ro, A);
    const z0 = U.uPlCol.x.sub(oz).div(az), z1 = U.uPlCol.z.add(0.01).sub(oz).div(az);
    const tcIn = max(max(cyl.x, min(z0, z1)), tStart).toVar();
    const tcOut = min(min(cyl.y, max(z0, z1)), tEnd).toVar();
    const dtC = max(max(tcOut.sub(tcIn), 0.0).div(36.0), 0.0022).toVar();
    const dtSkip = max(tEnd.sub(tStart).div(16.0), 0.004).toVar();

    // stałe piksela: wir (obrót szumu kolumny wokół osi), faza rozpraszania słońca, ziarno startu (IGN)
    const ang = U.uPlTime.mul(U.uPlFlow.z);
    const ca = cos(ang).toVar(), sa = sin(ang).toVar();
    const g = T.phaseG;
    const cosT = dot(rd, L);
    const phase = pow(float(1 + g * g).div(float(1 + g * g).sub(cosT.mul(2 * g))), 1.5).toVar();
    const ign = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189));
    const ns = U.uPlFlow.w.toVar();
    // detal (drugi kafel ×4,37) gaśnie, gdy jego okres jest mniejszy niż kilka pikseli
    const lodD = sdown(0.25, 0.7, pix.mul(ns.mul(4.37 * 16.0))).toVar();
    const zR = U.uPlCol.y, zLake = U.uPlDens.w;
    const aRim = b.mul(sqrt(max(float(1.0).sub(b.mul(b).mul(0.25)), 0.0))).toVar();
    const glowC = A.mul(zLake.add(0.12)).toVar();
    const sigA = U.uPlAnv2.z;
    const rise = U.uPlTime.mul(U.uPlFlow.x).toVar();

    // Kolumna z szumem: kłęby = turbulencja |szum gradientowy| (okrągłe wybrzuszenia, ostre zagięcia między nimi — jak
    // chmury kłębiaste), dwie skale; współrzędne zawija tani szum niskiej częstotliwości. Wierzch i brzeg kolumny to
    // poziomica (kłęby + fbm) − próg kształtu. `full` — detal i zawinięcie, bez — jedna próbka (samocień kłębów).
    const turb = (n) => clamp(abs(n.r.mul(2.0).sub(1.0)).mul(0.5).add(abs(n.g.mul(2.0).sub(1.0)).mul(0.3))
      .add(abs(n.b.mul(2.0).sub(1.0)).mul(0.2)).mul(2.1), 0.0, 1.0);
    const colNoise = (cf, full) => {
      const qx = dot(cf.q, W), qy = dot(cf.q, Bn);
      const nc = vec3(qx.mul(ca).sub(qy.mul(sa)), qx.mul(sa).add(qy.mul(ca)), cf.z.sub(rise)).mul(ns).toVar();
      const n1 = texture3D(noise, nc).level(0).toVar();
      const fbm = n1.r.mul(0.5).add(n1.g.mul(0.3)).add(n1.b.mul(0.2)).toVar();
      const lobes = turb(n1).toVar();
      const ero = U.uPlDens.z.mul(0.5);
      if (full) {
        // detal (drugi kafel) tylko przy powierzchni kłębów — w głębi i poza kolumną nic by nie zmienił
        const d0 = lobes.mul(float(1.0).sub(ero)).add(fbm.mul(ero));
        If(abs(d0.sub(cf.thr)).lessThan(0.16).and(lodD.greaterThan(0.02)), () => {
          const n2 = texture3D(noise, nc.mul(4.37).add(vec3(0.31, 0.57, 0.11))).level(0);
          fbm.addAssign(n2.g.sub(0.5).mul(lodD.mul(0.25)));
          lobes.assign(mix(lobes, turb(n2), lodD.mul(0.3)));
        });
      }
      // gęstość: kłęby + fbm (erozja) ponad próg kształtu
      const dens0 = lobes.mul(float(1.0).sub(ero)).add(fbm.mul(ero));
      // wnętrze też kłębiaste: w głębi gryzu (rzadki gorący gaz) smugi i kłęby, nad otworem gęsto z zagięciami
      const sig = columnSigma(cf, U, dens0).mul(lobes.mul(lobes).mul(1.3).add(0.22));
      return { sig, fbm, lobes };
    };

    const col = vec3(0.0).toVar();
    const trans = float(1.0).toVar();
    const t = tStart.add(min(dtA, dtC).mul(ign)).toVar();
    If(tEnd.greaterThan(tStart), () => {
      Loop({ start: int(0), end: int(PLUME_MAX_STEPS), type: 'int', condition: '<', name: 'plm' }, () => {
        If(t.greaterThanEqual(tEnd).or(trans.lessThan(0.02)), () => { Break(); });
        const p = ro.add(rd.mul(t)).toVar();
        const r = length(p).toVar();
        const inCol = t.greaterThanEqual(tcIn).and(t.lessThanEqual(tcOut));
        const inSh = r.greaterThan(rA0).and(r.lessThan(rA1));
        const next = min(select(t.lessThan(tcIn), tcIn, float(BIG)), select(t.lessThan(aIn), aIn, float(BIG)));
        // w głębi gryzu (rzadki gorący gaz pod płaszczyzną brzegu) krok ×1,6
        const dtCz = dtC.mul(select(dot(p, A).lessThan(U.uPlCol.y.sub(0.05)), 1.6, 1.0));
        const dt = select(inCol, select(inSh, min(dtCz, dtA), dtCz), select(inSh, dtA, min(dtSkip, next.sub(t).add(1e-4)))).toVar();
        const dtI = min(dt, tEnd.sub(t));

        // ── gęstość: kształt × szum (kolumna — kłęby jadą w górę i obracają się wokół osi, kowadło — z wiatrem);
        // szum tylko tam, gdzie kształt może dać gęstość ──
        const cf = columnField(p, A, W, U);
        const colSig = float(0.0).toVar();
        const tone = float(0.5).toVar();
        If(cf.thr.lessThan(1.0).and(cf.inZ.greaterThan(0.0)), () => {
          const cn = colNoise(cf, true);
          colSig.assign(cn.sig);
          tone.assign(cn.lobes.mul(0.6).add(cn.fbm.mul(0.4)));
        });
        const af = anvilField(p, r, A, W, Bn, U);
        const anvSig = float(0.0).toVar();
        If(af.band.greaterThan(1e-3).and(af.qa.lessThan(1.4)), () => {
          const na = vec3(af.u.sub(U.uPlTime.mul(U.uPlFlow.y)).mul(0.62), af.v, af.h.mul(2.5)).mul(ns.mul(1.25)).add(vec3(0.43, 0.17, 0.71)).toVar();
          const m1 = texture3D(noise, na).level(0).toVar();
          const afbm = m1.r.mul(0.45).add(m1.g.mul(0.35)).add(m1.b.mul(0.2)).toVar();
          // detal tylko przy brzegu śladu (szarpany brzeg kowadła); w środku płachty nic by nie zmienił
          If(abs(af.qa.add(afbm.sub(0.5).mul(U.uPlDens.z.mul(0.9))).sub(0.8)).lessThan(0.3).and(lodD.greaterThan(0.02)), () => {
            const m2 = texture3D(noise, na.mul(3.9).add(vec3(0.21, 0.66, 0.05))).level(0);
            afbm.addAssign(m2.b.sub(0.5).mul(lodD.mul(0.3)));
          });
          const aq = af.qa.add(afbm.sub(0.5).mul(U.uPlDens.z.mul(0.9)));
          anvSig.assign(af.band.mul(sdown(0.6, 1.0, aq)).mul(sigA).mul(mix(0.25, 1.35, m1.a.mul(0.5).add(afbm.mul(0.5)))));
          tone.assign(mix(tone, afbm, anvSig.div(max(anvSig.add(colSig), 1e-4))));
        });
        const sigma = colSig.add(anvSig).toVar();

        const ext = exp(sigma.mul(dtI).negate()).toVar();
        const wgt = trans.mul(float(1.0).sub(ext)).toVar();
        // światło tylko dla próbek, które coś wnoszą do piksela
        If(wgt.greaterThan(4e-4), () => {
          const up = p.div(r);
          // ── słońce: cień Ziemi (nad gruntem) / ścian (w gryzie — wyjście przez otwór), muśnięcie atmosfery ──
          const pl = dot(p, L);
          const dmin = sqrt(max(dot(p, p).sub(pl.mul(pl)), 0.0));
          const litOut = select(pl.greaterThan(0.0), float(1.0), smoothstep(0.997, 1.006, dmin));
          const wb = raySphere(p, L, A, b);
          const litIn = smoothstep(-0.003, 0.003, length(p.add(L.mul(wb.y))).sub(1.0));
          const lit = select(r.lessThan(1.0), litIn, litOut);
          const hca = select(pl.lessThan(0.0), dmin, r).sub(1.0);
          const tauAtm = U.uHazeBeta.mul(U.uHazeStrength.mul(T.grazeK)).mul(exp(max(hca, 0.0).negate().div(T.grazeH)));
          // samocień: kolumna — próbka z szumem tuż obok (kłęby) i dwie kształtu dalej; kowadło — warstwa nad punktem
          const muS = dot(up, L);
          // kolumna dalej — cięciwa promienia ku słońcu przez walec kolumny (promień na wysokości punktu), ucięta wierzchem
          // (średnia wysokość kłębów); punkt poza kolumną (kowadło, grunt) dostaje cień kolumny
          const Lh = L.sub(A.mul(dot(L, A)));
          const ca2 = max(dot(Lh, Lh), 1e-6);
          const cb = dot(cf.q, Lh);
          const cdisc = cb.mul(cb).sub(ca2.mul(dot(cf.q, cf.q).sub(cf.rc.mul(cf.rc))));
          const cs = sqrt(max(cdisc, 0.0));
          const tTop = select(dot(L, A).greaterThan(1e-4), mix(U.uPlRad.w, U.uPlCol.z, 0.5).sub(cf.z).div(max(dot(L, A), 1e-4)), float(BIG));
          const chord = select(cdisc.greaterThan(0.0),
            max(min(cb.negate().add(cs).div(ca2), tTop).sub(max(cb.negate().sub(cs).div(ca2), 0.0)), 0.0), float(0.0));
          const sigMean = mix(U.uPlDens.y, U.uPlDens.x, smoothstep(zR.sub(0.15), zR.add(0.02), cf.z));
          const tauS = colNoise(columnField(p.add(L.mul(0.018)), A, W, U), false).sig.mul(0.03)
            .add(chord.mul(sigMean).mul(0.7))
            .add(sigA.mul(af.foot).mul(max(af.top.sub(af.h), 0.0)).div(max(muS, 0.12)).mul(0.8));
          // wielokrotne rozpraszanie (przybliżenie oktawami): część światła przechodzi głębiej niż exp(−τ)
          const msT = exp(tauS.negate()).add(exp(tauS.mul(-0.25)).mul(0.3));
          const sunL = exp(tauAtm.negate()).mul(msT).mul(lit.mul(U.uPlLight.x).mul(sunVisP).mul(phase));
          // ── żar dna: w gryzie (pod płaszczyzną brzegu) cały, nad otworem — współczynnik widzenia tarczy otworu;
          // tłumienie: kolumna (próbka w 40% drogi ku dnu) i warstwa kowadła pod punktem ──
          const zp = dot(p, A);
          const dzo = zp.sub(zR);
          const rh = length(p.sub(A.mul(zp)));
          const ro2 = max(rh.sub(aRim.mul(0.55)), 0.0);
          const ff = aRim.mul(aRim).div(aRim.mul(aRim).add(dzo.mul(dzo)).add(ro2.mul(ro2).mul(2.0)));
          const cosF = clamp(dzo.add(aRim.mul(0.25)).div(sqrt(dzo.mul(dzo).add(ro2.mul(ro2))).add(aRim.mul(0.25))), 0.0, 1.0);
          // w gryzie (w kuli gryzu pod kulą Ziemi) — cały żar; nad otworem — tarcza otworu; pod płaszczyzną otworu poza
          // gryzem (za krzywizną Ziemi) żaru nie widać
          const inBowl = length(p.sub(A)).lessThan(b).and(r.lessThan(1.0));
          const glowIrr = select(inBowl, mix(0.8, 1.6, sdown(zLake.add(0.05), zLake.add(0.25), zp)),
            ff.mul(cosF).mul(smoothstep(-0.01, 0.015, dzo)));
          // tłumienie w drodze do dna: profil gęstości kolumny pod punktem (nad otworem gęsto, w głębi rzadko) i warstwa
          // kowadła pod punktem
          const inC = sdown(0.8, 1.2, cf.k);
          const tauG = inC.mul(U.uPlDens.x.mul(max(cf.z.sub(zR), 0.0)).add(U.uPlDens.y.mul(max(min(cf.z, zR).sub(zLake.add(0.1)), 0.0)))).mul(0.6)
            .add(sigA.mul(af.foot).mul(max(af.h.sub(af.base), 0.0)).mul(1.2));
          // żar przesącza się w głąb słupa (wielokrotne rozpraszanie): słabsza oktawa z ~5× mniejszym tłumieniem
          // + latarnia: światło żaru rozproszone w gęstej kolumnie aż po szczyt (nocą słup żarzy się od środka, słabnie ku górze)
          const lantern = sdown(zR.sub(0.1), U.uPlCol.z.add(0.03), zp).mul(colSig.div(max(sigma, 1e-4))).mul(T.lantern);
          const glowL = vec3(...T.glow).mul(U.uPlLight.y.mul(glowIrr.mul(exp(tauG.negate()).add(exp(tauG.mul(-0.2)).mul(0.22))).add(lantern)));
          // ── niebo (zapylone, za dnia), gorący gaz przy jeziorze, błyski ──
          const dayF = smoothstep(-0.12, 0.3, muS).mul(sunVisP);
          const amb = vec3(...T.sky).mul(U.uPlLight.z.mul(dayF.mul(0.85).add(0.15).mul(dayF)));
          // gorący gaz tuż nad jeziorem (odległość od środka dna, nie sama wysokość — za krzywizną z też jest małe)
          const hot = sdown(0.04, 0.22, length(p.sub(A.mul(zLake))));
          const fl = float(0.0).toVar();
          for (let i = 0; i < flashes.length; i++) {
            const F = flashes[i];
            fl.addAssign(F.w.mul(exp(length(p.sub(F.xyz)).negate().div(max(flashR[i], 1e-4)))));
          }
          // błysk oświetla chmurę od środka: plamy wg faktury kłębów (nie gładka kula)
          fl.mulAssign(tone.mul(tone).mul(0.8).add(0.2));
          const albedo = mix(vec3(...T.ashDark), vec3(...T.ash), smoothstep(0.25, 0.75, tone));
          const Ls = albedo.mul(sunL.add(glowL).add(amb))
            .add(vec3(...T.hot).mul(hot.mul(U.uPlLight.w)))
            .add(vec3(...T.flash).mul(fl));
          col.addAssign(Ls.mul(wgt));
        });
        trans.mulAssign(ext);
        t.addAssign(dt);
      });
    });
    const fade = U.uPlFade;
    return vec4(col.mul(fade), float(1.0).sub(trans).mul(fade));
  })();
  return { fragmentNode, uniforms: U };
}

let GRAPH = null;
/** Graf słupa (budowany raz). */
export function getPlumeGraph() {
  if (!GRAPH) GRAPH = buildPlumeGraph();
  return GRAPH;
}

/** Lekki materiał słupa na wspólnym grafie; `uniforms` — obiekty { value } wg PLUME_KEYS. */
export function createPlumeMaterial(uniforms) {
  const m = new THREE.NodeMaterial();
  m.name = 'EarthBitePlume';
  m.uniforms = uniforms;
  m.fragmentNode = getPlumeGraph().fragmentNode;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  m.forceSinglePass = true;
  m.lights = false;
  m.fog = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendEquationAlpha = THREE.AddEquation;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.premultipliedAlpha = false;
  return m;
}
