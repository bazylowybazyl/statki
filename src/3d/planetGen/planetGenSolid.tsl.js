// src/3d/planetGen/planetGenSolid.tsl.js
//
// Rodzaje z powierzchnią (terran, ocean, desert, rocky, ice, volcanic, barren, toxic): graf POLA i graf DNIA na
// rodzaj (budowane raz, planetGenBaker.js) i `uniformsFor(spec, ctx)` — wartości uniformów z opisu planety.
//
// KONTRAKT KANAŁÓW POLA (RGBA32F):
//   x — wysokość [km]; planety z wodą: 0 = poziom morza (pole liczy wysokość względem progu z próby, uQ.x),
//   y — ciecz poza morzem 0…1 (jeziora solanki, lawa) — wspólne przejścia: POŁYSK (× uSpec.z) i NOC (żar × uLava.x),
//   z — maska rodzaju (opis przy rodzaju: pasma gór, wydmy, linie lodu, osady, świeże wyrzuty…),
//   w — wartość PRÓBY: pole bazowe (kontynentalność), z którego baker liczy kwantyle w ułamkach rodzaju (`probeQ`)
//       → uQ (np. próg oceanu dla udziału wody, próg mórz wydm, mórz lawy). Próba rysuje to samo pole w 192 × 96
//       (z uQ = 0 — kanał w od uQ nie zależy), pełne pole dostaje już uQ.
// Barwy w uniformach — liniowe (albedo), cel dnia sRGB koduje sprzęt.
import {
  Fn, If, Loop, float, int, vec2, vec3, vec4, ivec2, ivec3, screenCoordinate,
  abs, acos, asin, atan, clamp, cos, cross, dot, exp, exp2, floor, fract, fwidth, length, log2, max, min, mix, mod, normalize, pow, sign, sin, smoothstep, sqrt, step
} from 'three/tsl';
import {
  pgNoise, pgNoised, pgFbm, pgErodedFbm, pgRidged, pgWarp, pgCells, pgCellsSmooth, pgCraterOctave, pgOctavesFor, pgHashU, pgU3, pgU1, pgRehash
} from './planetGenNoise.tsl.js';
import { bakeUniforms, bakeCoords, fieldAt, bakeMaterial, drainNode, COMMON_DEFS } from './planetGenBake.tsl.js';
import { rngFor } from './planetGenRng.js';
import { DRAIN_JITTER, DRAIN_CODE_STEP, DRAIN_FLOW_K, DRAIN_SEA_K } from './planetGenDrainage.js';
import { terrainLandscape, TERRAIN_WATER, PLANET_VEGETATION } from './planetGenTerrainMap.js';

const PI = Math.PI;
export const CRATER_OCTAVES = 7;
export const SLOT_CAP = 6;
export const LINEAE_CAP = 48;

// ── Wspólne kawałki ───────────────────────────────────────────────────────────────────────────────────────────────
const inv = (lo, hi, x) => float(1.0).sub(smoothstep(lo, hi, x));   // odwrócony smoothstep (stałe krawędzie rosnąco — pułapka 6)

// Kratery: oktawy k = 0…CRATER_OCTAVES−1, `uCr{k}` = (częstość komórek, gęstość, rMax [komórki], złożony),
// `uCrX` = (świeżość, tłumienie w morzach, promienie do oktawy < z, —). Wysokość × promień komórki [km] = R / częstość.
function craterDefs() {
  const d = { uCrX: 'vec4' };
  for (let k = 0; k < CRATER_OCTAVES; k++) d[`uCr${k}`] = 'vec4';
  return d;
}
function craterSum(U, C, ps, mare = null, fromK = 2, onAfterBig = null) {
  const h = float(0.0).toVar();
  const ej = float(0.0).toVar();
  const ray = float(0.0).toVar();
  const fl = float(0.0).toVar();
  for (let k = 0; k < CRATER_OCTAVES; k++) {
    if (k === fromK && onAfterBig) onAfterBig(h);
    const o = U[`uCr${k}`];
    If(o.y.greaterThan(0.0001), () => {
      const dens = mare && k >= fromK ? o.y.mul(mix(float(1.0), U.uCrX.y, mare)) : o.y;
      const c = pgCraterOctave(ps.mul(o.x), C.dir, dens, o.z.mul(0.35), o.z, U.uSeed.w.add(k * 7 + 3), o.w, U.uCrX.x,
        step(float(k + 0.5), U.uCrX.z)).toVar();
      h.addAssign(c.x.mul(U.uGeo.x.div(o.x)));
      ej.assign(max(ej, c.y));
      ray.assign(max(ray, c.z));
      fl.assign(max(fl, c.w.mul(step(float(k), 1.5))));
    });
  }
  return { h, ej, ray, fl };
}
/** Rekordy oktaw kraterów: gęstość (0…1), pierwsza częstość, próg złożonych [km], świeżość, promienie do oktawy. */
function craterRecords(ctx, { density = 1, f0 = 5, rMax = 0.42, complexKm = 18, sizeMin = 8, fresh = 0.08, mareDamp = 0.3, raysTo = 2, falloff = 1 }) {
  const out = {};
  for (let k = 0; k < CRATER_OCTAVES; k++) {
    const f = f0 * Math.pow(2, k);
    const cellKm = ctx.rKm / f;
    const diamKm = 2 * rMax * cellKm;
    // średnica < sizeMin tekseli — oktawa wyłączona (różnice centralne normalnych na kraterze 4–5 tekseli dają romby)
    const on = diamKm >= sizeMin * ctx.texKm;
    const dens = on ? Math.min(0.95, density * (0.3 + 0.13 * k) * Math.pow(falloff, k)) : 0;
    const complex = Math.min(1, Math.max(0, (rMax * cellKm - complexKm) / (complexKm * 2)));
    out[`uCr${k}`] = [f, dens, rMax, complex];
  }
  out.uCrX = [fresh, mareDamp, raysTo, 0];
  return out;
}

function slotDefs(prefix, cap = SLOT_CAP) {
  const d = {};
  for (let i = 0; i < cap; i++) { d[`${prefix}${i}`] = 'vec4'; d[`${prefix}${i}b`] = 'vec4'; }
  return d;
}
function emptySlots(prefix, cap = SLOT_CAP) {
  const d = {};
  for (let i = 0; i < cap; i++) { d[`${prefix}${i}`] = [0, 1, 0, 0]; d[`${prefix}${i}b`] = [0, 0, 0, 0]; }
  return d;
}
const angDist = (a, b) => acos(clamp(dot(a, b), -1.0, 1.0));

// Basen uderzeniowy: a = (kierunek, promień kątowy [rad]), b = (głębokość [km], wypełnienie 0…1, pierścienie, —)
function basinProfile(dir, a, b, wob, edgeN = float(0.0)) {
  const r = angDist(dir, normalize(a.xyz)).div(max(a.w, 1e-4)).add(wob).toVar();
  const bowl = inv(0.5, 1.0, r).mul(-1.0);
  const rr = r.sub(1.0).div(0.13);
  const rim = exp(rr.mul(rr).negate()).mul(0.2);
  const r2 = r.sub(1.5).div(0.1);
  const ring2 = exp(r2.mul(r2).negate()).mul(0.07).mul(b.z);
  const out = max(r.sub(1.0), 0.0);
  const ejecta = exp(out.mul(-2.0)).mul(0.09).mul(smoothstep(0.95, 1.05, r));
  const h = bowl.add(rim).add(ring2).add(ejecta).mul(b.x).mul(inv(2.4, 3.0, r));
  // lawa wylewa się nierówno: brzeg morza z szumu (zatoki, języki poza wał)
  const mare = inv(0.5, 0.95, r.add(edgeN.mul(0.45))).mul(b.y);
  return { h, mare, r };
}
// Wulkan tarczowy: a = (kierunek, promień podstawy [rad]), b = (wysokość [km], kaldera, —, —)
function volcanoProfile(dir, a, b) {
  const r = angDist(dir, normalize(a.xyz)).div(max(a.w, 1e-4)).toVar();
  const cone = max(exp(r.mul(-3.0)).sub(0.0025), 0.0);
  const cal = inv(0.03, 0.07, r).mul(b.y);
  const h = cone.sub(cal.mul(0.1)).mul(b.x).mul(inv(1.5, 2.2, r));
  return { h, r, flank: inv(0.0, 1.3, r) };
}

/**
 * Pochylenie |∇h| [km/km] z sąsiednich tekseli pola — operator Sobela 3 × 3 (izotropowy: krzyż ±1 teksel dawał na
 * małych kraterach odpowiedź w kształcie rombu).
 */
function slopeAt(F, U, C) {
  const h = (dx, dy) => fieldAt(F, U, C.ix.add(dx), C.iy.add(dy)).x;
  const gx = h(1, -1).add(h(1, 0).mul(2.0)).add(h(1, 1)).sub(h(-1, -1)).sub(h(-1, 0).mul(2.0)).sub(h(-1, 1)).mul(0.125);
  const gy = h(-1, 1).add(h(0, 1).mul(2.0)).add(h(1, 1)).sub(h(-1, -1)).sub(h(0, -1).mul(2.0)).sub(h(1, -1)).mul(0.125);
  // odległości tekseli w układzie SIATKI celu (cała mapa: układ planety; wycinek: układ obrócony — bakeCoords)
  const cosLat = max(cos(C.latGrid), U.uRes.w.mul(PI));
  const dE = gx.div(U.uGeo.x.mul(cosLat).mul(C.stE));
  const dN = gy.div(U.uGeo.x.mul(C.stN));
  return { s: sqrt(dE.mul(dE).add(dN.mul(dN))), dE, dN };
}
/** Krzywizna (laplasjan 3 × 3 izotropowy, krok 2 teksele) [km] — doliny < 0, grzbiety > 0. */
function curvatureAt(F, U, C, hC) {
  const h = (dx, dy) => fieldAt(F, U, C.ix.add(dx), C.iy.add(dy)).x;
  const axis = h(2, 0).add(h(-2, 0)).add(h(0, 2)).add(h(0, -2));
  const diag = h(2, 2).add(h(-2, 2)).add(h(2, -2)).add(h(-2, -2));
  return axis.mul(2.0).add(diag).div(12.0).sub(hC);
}

// ── WYDMY (pustynie planet z wodą; wzorce — zdjęcia satelitarne od użytkownika: pola wydm gwiaździstych z płaskimi
//    dnami między nimi, wydmy podłużne, cienie stoków) ──────────────────────────────────────────────────────────────
// Wydmy są RZEŹBĄ (wysokość w polu — światło i cień liczy materiał), nie paskami barwy. Trzy ciągi grzbietów
// o stałych kierunkach (kierunek zmienny z szumu rozjeżdżałby długość fali), wagi ciągów z szumu niskiej częstości
// (reżim wiatru): jeden ciąg — wydmy podłużne, dwa–trzy krzyżujące się — sieć wydm gwiaździstych ze szczytami
// w przecięciach i płaskimi dnami pomiędzy. Fale grzbietów łamane szumem (zakręty, rozwidlenia). Długości fal w km
// (promień planety z uGeo.x); wydmy, których teksel celu nie rozdziela, wchodzą średnią. Dziedzina surowa (C.dir).
export const DUNES = Object.freeze({ megaKm: [2.6, 3.3, 2.1], smallKm: 0.42, heightKm: 0.1, smallHeightKm: 0.008, mean: 0.22 });
const DUNE_DIRS = [[0.83, 0.21, 0.52], [-0.31, 0.9, 0.3], [0.44, -0.41, -0.8]];
/** Zwraca { h — wysokość megawydm 0…1 (0 — dno między wydmami), small — drobne wydmy 0…1, flat — płaskie dno 0…1 }. */
function duneField(U, C, ps) {
  const R = U.uGeo.x;
  const texKm = C.stN.mul(R).toVar();
  const pd = C.dir;
  const nR = vec3(pgNoise(ps.mul(7.0).add(vec3(1.9, 4.2, -3.3))), pgNoise(ps.mul(7.0).add(vec3(-6.1, 0.7, 2.8))),
    pgNoise(ps.mul(7.0).add(vec3(3.4, -5.5, 8.1)))).toVar();
  // (drugi ciąg prawie wszędzie, trzeci w części pól: sieci i wydmy gwiaździste są regułą, same pręgi — wyjątkiem)
  const w = vec3(smoothstep(-0.3, 0.0, nR.x), smoothstep(-0.2, 0.15, nR.y), smoothstep(0.0, 0.3, nR.z)).toVar();
  const wob = pgFbm(ps.mul(260.0).add(vec3(2.2, 9.1, -4.4)), 3).toVar();
  const wob2 = pgNoise(pd.mul(2400.0).add(vec3(0.3, 0.6, 0.9))).toVar();
  const train = (i) => {
    const k = R.mul(2 * Math.PI / DUNES.megaKm[i]);
    // profil wydmy: łagodny stok dowietrzny (72% fali), stromy zawietrzny, ostry grzbiet — trójkąt niesymetryczny
    // lekko zaokrąglony potęgą (sinus dawał obłe wały bez linii grzbietu)
    const t = fract(dot(pd, vec3(...DUNE_DIRS[i])).mul(k).add(wob.mul(9.0 + i * 2.5)).add(wob2.mul(1.2)).add(i * 2.1).div(2 * Math.PI));
    return pow(min(t.div(0.72), float(1.0).sub(t).div(0.28)), 1.35);
  };
  const avg = train(0).mul(w.x).add(train(1).mul(w.y)).add(train(2).mul(w.z)).div(w.x.add(w.y).add(w.z).add(0.05)).toVar();
  // dno między wydmami: wszystko poniżej progu jest płaskie
  const hh = max(avg.sub(0.1), 0.0).div(0.9).toVar();
  const on = float(1.0).sub(smoothstep(DUNES.megaKm[2] / 9, DUNES.megaKm[2] / 4.5, texKm)).toVar();
  // drobne wydmy na ciałach megawydm i na piasku między nimi (w poprzek pierwszego ciągu)
  const kS = R.mul(2 * Math.PI / DUNES.smallKm);
  // (pola drobnych wydm płatami i o zmiennej wysokości — równe prążki na całym polu wyglądały jak sztruks)
  const patchS = smoothstep(-0.25, 0.3, pgNoise(pd.mul(900.0).add(vec3(5.5, 1.5, -2.5)))).toVar();
  const sS = sin(dot(pd, vec3(-0.5, 0.33, 0.8)).mul(kS).add(wob2.mul(9.0)).add(wob.mul(31.0))).mul(0.5).add(0.5).toVar();
  const onS = float(1.0).sub(smoothstep(DUNES.smallKm / 9, DUNES.smallKm / 4.5, texKm)).toVar();
  return {
    h: mix(float(DUNES.mean), hh, on), small: mix(float(0.5), sS.mul(sS), onS).mul(float(0.35).add(hh.mul(0.65))).mul(patchS),
    flat: float(1.0).sub(smoothstep(0.0, 0.1, hh)).mul(on)
  };
}
/** Morza piasku (ergi) w pustyni — ta sama maska w polu (rzeźba wydm) i w barwach. */
const ergMask = (ps) => smoothstep(0.02, 0.2, pgFbm(ps.mul(9.0).add(vec3(8.8, -1.4, 6.6)), 4));
/** Pustynia skalista (hamada, płaskowyże, ostańce) poza morzami piasku — wspólna dla rzeźby i barw. */
const hamadaMask = (ps, erg) => smoothstep(-0.05, 0.18, pgFbm(ps.mul(6.0).add(vec3(-3.3, 5.7, 1.2)), 4)).mul(float(1.0).sub(erg));

/** Ogon szeregu detalu wybrzeża i granic pokrycia: oktawy ≥ `from` gasną z `gain` (gain · 2,03 < 1). */
export const COAST_TAIL = Object.freeze({ from: 5, gain: 0.45 });
export const COVER_TAIL = Object.freeze({ from: 3, gain: 0.42 });
// Kontynenty: kształt z fbm na PODWÓJNIE odkształconej dziedzinie (wybrzeża fraktalne, zatoki, półwyspy), płyty —
// gładkie tło (średnia wartości komórek ważona odległością — bez skoku na krawędziach) i granice F2 − F1 (ciągłe)
// pod pasma gór; „zbieżność” granicy z ciągłego szumu, nie z pary haszy (para skacze na węzłach potrójnych).
function plates(ps, plateFreq, contFreq, warp, coast, landProb, octX, full = false) {
  const w1 = pgWarp(ps.mul(contFreq.mul(0.5)), 4, warp).toVar();
  const w2 = pgWarp(ps.add(w1).mul(contFreq.mul(1.6)).add(vec3(2.3, -1.7, 4.1)), 4, warp.mul(0.4)).toVar();
  const wq = w1.add(w2.mul(0.8)).toVar();
  const q = ps.add(wq).toVar();
  const pc = pgCellsSmooth(q.mul(plateFreq), 0.85, 7.0).toVar();
  const border = pc.y.sub(pc.x).toVar();
  const plateC = inv(landProb.sub(0.3), landProb.add(0.3), pc.z).mul(2.0).sub(1.0).toVar();
  const big = pgFbm(q.mul(contFreq.mul(0.85)), 4).toVar();
  // detal wybrzeży: fbm od średniej skali w dół z wolniej gasnącymi oktawami (wybrzeże fraktalne, wyspy przybrzeżne)
  // (ogon od 5. oktawy: z gain 0,62 brzeg był z bliska strzępiony w konfetti i zmieniał kształt przy zbliżaniu —
  // każdy głębszy poziom otwierał albo zamykał przesmyki widoczne poziom wyżej)
  const det = pgFbm(q.mul(contFreq.mul(2.2)).add(vec3(7.3, 1.1, -3.9)), octX, 2.03, 0.62, full, COAST_TAIL).toVar();
  // zatoki i półwyspy: grzbiety szumu średniej skali wcinają się w ląd (ryfty, fiordy)
  const rift = pgRidged(q.mul(contFreq.mul(4.2)).add(vec3(-5.1, 2.2, 8.3)), 4, 2.05, 0.5, 1.0, 2.0).toVar();
  const c = plateC.mul(0.22).add(big.mul(0.5)).add(det.mul(coast).mul(0.95)).sub(rift.mul(coast).mul(0.2)).toVar();
  const conv = smoothstep(-0.05, 0.3, pgFbm(q.mul(plateFreq.mul(0.8)).add(vec3(13.1, 5.7, 2.9)), 3)).toVar();
  const cont = smoothstep(-0.2, 0.2, plateC);
  return { q, wq, pc, border, cont1: cont, cont2: cont, c, conv };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// RZEKI ZE SPŁYWU (planetGenDrainage.js): odległość punktu od odcinków drzewa rzek w sąsiednich komórkach siatki
// spływu. Węzeł drzewa = środek komórki + przesunięcie z haszu; bieg wody komórki to łuk Béziera przez węzeł jej
// odbiorcy (gładko przez zbiegi), z meandrem — sinusoidą w poprzek łuku. Szerokość z przepływu komórki.
//   gp — punkt w komórkach siatki spływu (już po odkształceniu meandrami), cosL — skala osi wschód–zachód,
//   stC — teksel celu w komórkach, flatK — siła meandrów 0…1 (nizina 1, góry mniej). Sąsiedztwo 5 × 5 komórek
//   (każda z odczytem swojego odbiorcy): odległości pewne do ~0,75 komórki.
// Wynik (max po odcinkach): line — pokrycie wodą 0…1 (nie węższa niż ~1,3 teksela), carve — głębokość doliny [km],
// wet — wilgotność doliny / pas zalewowy 0…1, stripe — łuki dawnych koryt (pasy równoległe do koryta), bar — łachy
// piasku po wewnętrznej stronie zakoli.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Punkt krzywej Béziera 2. stopnia (A, B — kontrolny, C; współrzędne względem badanego punktu = początku układu)
// najbliższy początkowi układu — dokładnie (I. Quilez, pierwiastki równania 3. stopnia). Wynik: t — parametr 0…1,
// side — odległość w poprzek krzywej ze znakiem, over — odległość wzdłuż stycznej poza końcem krzywej (0 w środku).
// Punkty prawie współliniowe z B pośrodku (mianownik → 0) liczone jak odcinek A → C.
function bezierNear(A, B, C) {
  const a = B.sub(A).toVar();
  const b = A.sub(B.mul(2.0)).add(C).toVar();
  const bb = dot(b, b).toVar();
  const t = float(0.0).toVar();
  If(bb.lessThan(1e-5), () => {
    const ac = C.sub(A).toVar();
    t.assign(clamp(dot(A.negate(), ac).div(max(dot(ac, ac), 1e-8)), 0.0, 1.0));
  }).Else(() => {
    const kk = float(1.0).div(bb).toVar();
    const kx = kk.mul(dot(a, b)).toVar();
    const ky = kk.mul(dot(a, a).mul(2.0).add(dot(A, b))).div(3.0).toVar();
    const kz = kk.mul(dot(A, a)).toVar();
    const p = ky.sub(kx.mul(kx)).toVar();
    const q = kx.mul(kx.mul(kx).mul(2.0).sub(ky.mul(3.0))).add(kz).toVar();
    const h = q.mul(q).add(p.mul(p).mul(p).mul(4.0)).toVar();
    If(h.greaterThanEqual(0.0), () => {
      const x = vec2(sqrt(h), sqrt(h).negate()).sub(q).mul(0.5).toVar();
      const uv = sign(x).mul(pow(abs(x), vec2(1.0 / 3.0))).toVar();
      t.assign(clamp(uv.x.add(uv.y).sub(kx), 0.0, 1.0));
    }).Else(() => {
      const z = sqrt(max(p.negate(), 1e-12)).toVar();
      const v = acos(clamp(q.div(p.mul(z).mul(2.0)), -1.0, 1.0)).div(3.0).toVar();
      const m = cos(v).toVar();
      const n = sin(v).mul(1.732050808).toVar();
      const t1 = clamp(m.add(m).mul(z).sub(kx), 0.0, 1.0).toVar();
      const t2 = clamp(n.negate().sub(m).mul(z).sub(kx), 0.0, 1.0).toVar();
      const v1 = A.add(a.mul(2.0).add(b.mul(t1)).mul(t1)).toVar();
      const v2 = A.add(a.mul(2.0).add(b.mul(t2)).mul(t2)).toVar();
      t.assign(mix(t2, t1, step(dot(v1, v1), dot(v2, v2))));
    });
  });
  const vv = A.add(a.mul(2.0).add(b.mul(t)).mul(t)).toVar();          // punkt krzywej względem badanego punktu
  // AGENT: styczna krzywej znika na końcu, gdy B = C (ujście: odbiorcą jest morze, łuk kończy się w węźle morza).
  // Zerowa styczna dawała side = over = 0, czyli „odległość 0” w całym obszarze za końcem łuku — prostokąt wody
  // i doliny zalewowej przy ujściu (granice = sąsiedztwo 5 × 5 komórek). Wtedy styczną zastępuje cięciwa A → C;
  // side² + over² = |vv|² zawsze.
  const tan0 = a.mul(2.0).add(b.mul(t).mul(2.0)).toVar();
  const chord = C.sub(A).toVar();
  const tan = mix(chord, tan0, step(1e-4, dot(tan0, tan0))).toVar();
  const tl = max(length(tan), 1e-6).toVar();
  const side = vv.x.mul(tan.y).sub(vv.y.mul(tan.x)).div(tl).toVar();
  const over = dot(vv, tan).div(tl).negate().toVar();
  return { t, side, over };
}

export const RIVER_FLOW_MIN = 14;      // przepływ [komórki o opadzie 1], od którego rzekę widać jako wodę
export const RIVER_W0 = 0.016;         // promień rzeki o przepływie RIVER_FLOW_MIN [komórki]
export const RIVER_W_MAX = 0.12;       // (koryto wąskie względem zakoli: amplituda meandra do ~4 szerokości koryta)
export const RIVER_W_EXP = 0.4;        // szerokość ∝ przepływ^0,4
// amplituda meandra = RIVER_MEANDER · długość łuku / liczba półfal (do 0,42 komórki). 0,5: zbocze zakola do ~57° —
// przy 0,7 (i więcej) sinusoida o grubej wstędze wygląda jak zęby piły, nie jak zakola.
export const RIVER_MEANDER = 0.5;
const RIVER_LF0 = Math.log2(1 + RIVER_FLOW_MIN);
// log2(1 + przepływ), od którego woda rzeki jest mętna od niesionego mułu (pełna barwa przy LF1 ≈ przepływ 1500 —
// od tej wielkości mapa terenu rysuje „wielką rzekę”, planetGenPlace.js)
const RIVER_MUD_LF0 = 9.2;
const RIVER_MUD_LF1 = 10.8;
// `hash` — przesunięcie współrzędnych komórki w haszach węzłów ({ ox, oy } — węzły całkowite): siatka REGIONU leży
// na stałej kracie planety, więc przesunięty region daje tym samym komórkom te same węzły i zakola.
function riverNet(D, U, gp, cosL, stC, flatK, hash = null) {
  const W = max(int(U.uDr.x), int(1)).toVar();
  const H = max(int(U.uDr.y), int(1)).toVar();
  const cell = floor(gp).toVar();
  const fr = gp.sub(cell).toVar();
  const cx = int(cell.x).toVar();
  const cy = int(cell.y).toVar();
  const seedI = int(U.uDr.w).toVar();
  const metric = vec2(cosL, 1.0).toVar();
  const line = float(0.0).toVar();
  const carve = float(0.0).toVar();
  const wet = float(0.0).toVar();
  const stripe = float(0.0).toVar();
  const bar = float(0.0).toVar();
  const mud = float(0.0).toVar();
  const dBest = float(1e3).toVar();
  // meandry i starorzecza dopiero, gdy teksel celu je rozdziela (okres meandra ≥ ~½ komórki)
  const fine = float(1.0).sub(smoothstep(0.12, 0.3, stC)).toVar();
  const hx = (ix) => (hash ? ix.add(hash.ox) : ix);
  const hy = (iy) => (hash ? iy.add(hash.oy) : iy);
  const jit = (ix, iy) => pgU3(pgHashU(ivec3(hx(ix), hy(iy), seedI))).xy.sub(0.5).mul(2 * DRAIN_JITTER);
  // (sąsiedztwo 7 × 7: łuk należy do komórki DAWCY, a leży wokół jej odbiorcy — jego dalszy koniec bywa ponad
  // 2 komórki od niej; przy 5 × 5 pas wielkiej rzeki był z bliska obcięty prostą krawędzią sąsiedztwa)
  Loop({ start: int(-3), end: int(4), type: 'int', condition: '<', name: 'dj' }, ({ dj }) => {
    Loop({ start: int(-3), end: int(4), type: 'int', condition: '<', name: 'di' }, ({ di }) => {
      const iy = cy.add(dj).toVar();
      const ix = mod(cx.add(di).add(W.mul(2)), W).toVar();
      const t = D.load(ivec2(ix, clamp(iy, int(0), H.sub(1)))).toVar();
      const code = floor(t.r.mul(255 / DRAIN_CODE_STEP).add(0.5)).toVar();
      If(code.greaterThan(0.5).and(iy.greaterThanEqual(int(0))).and(iy.lessThan(H)), () => {
        // ŁUK ZAMIAST ŁAMANEJ: woda komórki płynie krzywą Béziera od połowy odcinka (komórka → odbiorca) przez
        // odbiorcę (punkt kontrolny) do połowy odcinka (odbiorca → jego odbiorca). Bieg nie ma załamań w węzłach,
        // a dopływy schodzą się stycznie do rzeki (zbieg w kształcie „Y”, nie gwiazdy).
        // (bez zmiany zmiennej po jej użyciu — zmienna TSL powstaje w miejscu pierwszego użycia, pułapka 29)
        const k = code.sub(1.0).toVar();
        const oy0 = floor(k.div(3.0)).toVar();
        const ox = k.sub(oy0.mul(3.0)).sub(1.0).toVar();
        const oy = oy0.sub(1.0).toVar();
        const rx = mod(ix.add(int(ox)).add(W), W).toVar();
        const ry = iy.add(int(oy)).toVar();
        const tR = D.load(ivec2(rx, clamp(ry, int(0), H.sub(1)))).toVar();
        const codeR = floor(tR.r.mul(255 / DRAIN_CODE_STEP).add(0.5)).toVar();
        const hasRR = step(0.5, codeR).toVar();            // odbiorca jest lądem (ma własnego odbiorcę)
        const k2 = max(codeR.sub(1.0), 0.0).toVar();
        const qy0 = floor(k2.div(3.0)).toVar();
        const qx = k2.sub(qy0.mul(3.0)).sub(1.0).mul(hasRR).toVar();
        const qy = qy0.sub(1.0).mul(hasRR).toVar();
        const rrx = mod(rx.add(int(qx)).add(W), W);
        const rry = ry.add(int(qy));
        const pC = vec2(float(di), float(dj)).add(0.5).add(jit(ix, iy)).sub(fr).toVar();
        const pR = vec2(float(di).add(ox), float(dj).add(oy)).add(0.5).add(jit(rx, ry)).sub(fr).toVar();
        const pRR = vec2(float(di).add(ox).add(qx), float(dj).add(oy).add(qy)).add(0.5).add(jit(rrx, rry)).sub(fr).toVar();
        const bA = pC.add(pR).mul(0.5).mul(metric).toVar();
        const bB = pR.mul(metric).toVar();
        const bC = mix(pR, pR.add(pRR).mul(0.5), hasRR).mul(metric).toVar();
        const bz = bezierNear(bA, bB, bC);
        const len = max(length(bB.sub(bA)).add(length(bC.sub(bB))), 1e-3).toVar();
        // punkt w układzie krzywej: parametr 0…1, odległość w poprzek (ze znakiem) i poza końcami
        const tt = bz.t;
        const side = bz.side;
        const over = bz.over;
        // przepływ odcinka = przepływ JEGO komórki (dopływ nie grubieje przed ujściem do większej rzeki)
        const lf = t.g.mul(255 / DRAIN_FLOW_K).toVar();     // log2(1 + przepływ)
        // MEANDER: sinusoida w poprzek łuku, zero w węzłach (ciągłość drzewa). Długość fali ≈ 12 szerokości koryta
        // (jak rzeki nizinne z satelity): liczba półfal na łuku z szerokości — wielka rzeka ma jedno zakole na łuk,
        // strumyk do czterech (stała liczba półfal dawała wielkiej rzece zęby zamka błyskawicznego). Amplituda do
        // ~⅓ długości fali, mniejsza przy strumykach i w górach, z haszu odcinka; odległość od krzywej
        // ≈ |poprzek − m| / √(1 + m′²)
        const hs = pgU3(pgHashU(ivec3(hx(ix), hy(iy), seedI.add(int(977))))).toVar();
        // SZEROKOŚĆ WZDŁUŻ ODCINKA: odcinek GŁÓWNEGO dawcy (niesie co najmniej połowę przepływu odbiorcy) przechodzi
        // płynnie od własnej szerokości do szerokości odbiorcy — bez schodka i szwu barwy na łączeniu odcinków.
        // Dopływ (mniejszy dawca) zostaje przy swojej szerokości aż do ujścia (inaczej grubiałby przed zbiegiem).
        const w0 = min(exp2(lf.sub(RIVER_LF0).mul(RIVER_W_EXP)).mul(RIVER_W0), RIVER_W_MAX).toVar();
        const lfRc = tR.g.mul(255 / DRAIN_FLOW_K).toVar();
        const lfT = mix(lf, lfRc, tt.mul(step(lfRc.sub(1.0), lf)).mul(hasRR)).toVar();
        const w = min(exp2(lfT.sub(RIVER_LF0).mul(RIVER_W_EXP)).mul(RIVER_W0), RIVER_W_MAX).toVar();
        const nH = clamp(floor(len.div(w0.mul(6.3)).add(0.5)), 1.0, 4.0).toVar();
        // (ostry zakręt łuku — odbiorca cofa bieg — nie mieści wychylenia: krzywa odsunięta o więcej niż promień
        // zakrętu przecina samą siebie i rysuje „namioty”; wychylenie gaśnie z kątem zakrętu)
        const dA = bB.sub(bA).toVar();
        const dC = bC.sub(bB).toVar();
        const turn = dot(dA, dC).div(max(length(dA).mul(length(dC)), 1e-6)).toVar();
        // Najmniejszy promień łuku Béziera (a = B − A, b = A − 2B + C): R = 2 |a × b|² / |b|³. Wychylenie zakola większe
        // niż promień łuku daje wstęgę przecinającą samą siebie (ostre „namioty” i proste cięcie wzdłuż osi łuku —
        // punkt najbliższy łukowi przeskakuje tam między jego ramionami): wychylenie ≤ 0,45 promienia.
        const qb = bA.sub(bB.mul(2.0)).add(bC).toVar();
        const crs = dA.x.mul(qb.y).sub(dA.y.mul(qb.x)).toVar();
        const rMin = crs.mul(crs).mul(2.0).div(max(pow(length(qb), 3.0), 1e-6)).toVar();
        const ampS = min(min(len.mul(RIVER_MEANDER).div(nH), 0.42), rMin.mul(0.45)).mul(flatK).mul(fine).mul(mix(0.25, 1.0, smoothstep(3.5, 7.5, lf)))
          .mul(smoothstep(-0.2, 0.6, turn)).toVar();
        const amp = ampS.mul(hs.y.mul(0.5).add(0.5)).mul(mix(float(-1.0), float(1.0), step(0.5, hs.z))).toVar();
        const ph = tt.mul(nH).mul(PI).toVar();
        // OBWIEDNIA sin²(πt): w węzłach łuku znika i wychylenie, i jego pochodna — kolejne łuki łączą się gładko.
        // Sama sinusoida kończyła łuk pod kątem, a następny zaczynał pod innym (załamanie w każdym węźle — z bliska
        // „łokcie”, z daleka zęby).
        const envS = sin(tt.mul(PI)).toVar();
        const env = envS.mul(envS).toVar();
        const dEnv = envS.mul(cos(tt.mul(PI))).mul(2.0 * PI).toVar();
        const mOff = sin(ph).mul(amp).mul(env).toVar();
        const dm = cos(ph).mul(nH.mul(PI)).mul(env).add(sin(ph).mul(dEnv)).mul(amp).div(len).toVar();
        const dc = side.sub(mOff).toVar();
        // odległość w poprzek koryta: przybliżenie pierwszego rzędu |poprzek − m| / √(1 + m′²) jest dobre tylko PRZY
        // korycie. Daleko od niego, na stromym zboczu zakola (duże m′), dawało „odległość ~0” w całym pasie wzdłuż
        // normalnej — fałszywą wodę i łachy aż do granicy sąsiedztwa komórek (prostokątne wycięcia, „namioty”).
        // Poprawka stromości gaśnie poza ~2–6 szerokościami koryta (tam odległość = samo |poprzek − m|).
        const nearK = float(1.0).sub(smoothstep(w.mul(2.0).add(0.02), w.mul(6.0).add(0.06), abs(dc))).toVar();
        const dn = abs(dc).div(sqrt(dm.mul(dm).mul(nearK).add(1.0))).toVar();
        const dist = sqrt(dn.mul(dn).add(over.mul(over))).toVar();
        // dolina i pas zalewowy idą wzdłuż łuku BEZ meandra i mieszczą w sobie pas meandrów (rzeka wije się po
        // płaskim dnie doliny; dolina powtarzająca każdy zakręt wyglądała w świetle jak zamek błyskawiczny)
        const dist0 = sqrt(side.mul(side).add(over.mul(over))).toVar();
        const belt = abs(amp).toVar();
        const wt = max(w, stC.mul(1.3)).toVar();
        // próg widoczności rośnie z tekselem celu: z daleka widać tylko większe rzeki, strumienie dochodzą przy
        // zbliżeniu (stała gęstość linii na ekranie — pełna sieć z daleka wyglądała jak żyłki na całym lądzie)
        const lfVis = log2(stC.mul(16.0).add(1.0)).add(RIVER_LF0).toVar();
        const vis = smoothstep(lfVis.sub(1.0), lfVis, lf);
        // rzeka węższa niż teksel: linia ~1,3 teksela o pokryciu (w / wt)^0,5 — mocniej niż z zachowania energii:
        // rzeka ma być z daleka tą samą linią co z bliska (nie znikać i nie zmieniać się w jasny pas)
        // (muł: wielka rzeka niesie osad — barwa wody z przepływu odcinka, który daje największe pokrycie)
        // BRZEG: z daleka miękki profil (0,4…1 szerokości — linia), z bliska ostra krawędź w 0,7 szerokości
        // (szerokość przejścia ~1,5 teksela celu): ta sama średnia szerokość na każdym poziomie, a rzeka w skali
        // kilkudziesięciu kilometrów ma brzegi, nie rozmytą smugę
        const soft = clamp(stC.mul(1.5), w.mul(0.05), wt.mul(0.6)).toVar();
        const ln = inv(wt.mul(0.7).sub(soft.mul(0.5)), wt.mul(0.7).add(soft.mul(0.5)), dist).mul(pow(w.div(wt), 0.5)).mul(vis).toVar();
        const mudR = smoothstep(RIVER_MUD_LF0, RIVER_MUD_LF1, lfT).toVar();
        line.assign(max(line, ln));
        mud.assign(max(mud, mudR.mul(ln)));
        // dolina: potok — wąskie V, wielka rzeka — szerokie dno; głębiej z przepływem
        const rv = clamp(max(w.mul(5.0).add(0.04).add(belt), wt.mul(3.0)), 0.05, 0.75).toVar();
        const pv = inv(min(belt.mul(0.6), rv.mul(0.6)), rv, dist0).toVar();
        const dep = smoothstep(2.4, 4.4, lf).mul(mix(0.03, 0.17, smoothstep(3.0, 11.0, lf)));
        carve.assign(max(carve, pv.mul(pv).mul(dep)));
        // wilgotność doliny: przy strumyku wąska smuga, przy wielkiej rzece pas zalewowy
        const rw = clamp(max(w.mul(7.0).add(0.05).add(belt.mul(1.3)), wt), 0.05, 0.75).toVar();
        // Pas zalewowy (drugi człon) tylko przy dużych rzekach na płaskim (flatK — w górach dolina jest wąska).
        // Pas węższy niż teksel celu gaśnie ze stosunkiem szerokości: z daleka wielka rzeka to jaśniejsza wstęga
        // doliny (średnia tego, co widać z bliska: ciemna woda, łachy, łęgi), mała — sama smuga wilgotności.
        const rw0 = w.mul(7.0).add(0.05).add(belt.mul(1.3));
        const res = min(rw0.div(rw), 1.0).toVar();
        const sw = smoothstep(2.8, 5.5, lf).mul(0.45).mul(res)
          .add(smoothstep(5.5, 9.0, lf).mul(0.55).mul(res).mul(smoothstep(0.75, 0.95, flatK)));
        wet.assign(max(wet, inv(rw.mul(0.25), rw, dist0).mul(sw)));
        // DNO DOLINY wielkiej rzeki (wzór: zdjęcie satelitarne): ŁACHY — jasny piasek po WEWNĘTRZNEJ stronie zakola
        // tuż przy korycie; ŁUKI DAWNYCH KORYT — pasy w stałej odległości od dzisiejszego koryta (równoległe do
        // zakoli, od najbliższego odcinka).
        const big = smoothstep(5.5, 7.5, lf).mul(fine).toVar();
        const inSpan = float(1.0).sub(smoothstep(0.0, 0.05, abs(over))).toVar();
        const bend = smoothstep(0.3, 0.8, abs(sin(ph)));
        const inner = step(dc.mul(mOff), 0.0);
        // (łachy i pasy tylko gdy teksel celu je rozdziela — węższe od ~2 tekseli dawały „koraliki” wzdłuż rzeki)
        const seen = smoothstep(stC.mul(1.2), stC.mul(2.4), w).toVar();
        // (z bliska sierp o ostrym brzegu: zewnętrzna granica łachy rośnie z zakolem; szerokość przejścia jak brzeg rzeki)
        const barOut = w.mul(float(0.85).add(bend.mul(0.95))).toVar();
        const barSoft = max(soft, w.mul(0.04)).toVar();
        bar.assign(max(bar, smoothstep(w.mul(0.7).sub(barSoft.mul(0.5)), w.mul(0.7).add(barSoft.mul(0.5)), dn)
          .mul(inv(barOut.sub(barSoft), barOut.add(barSoft), dn)).mul(inner).mul(bend).mul(big).mul(inSpan).mul(seen)));
        If(dist.lessThan(dBest).and(big.greaterThan(0.01)), () => {
          dBest.assign(dist);
          const reach = belt.mul(2.0).add(w.mul(4.0)).toVar();
          stripe.assign(cos(dn.div(w.mul(1.5)).mul(6.283)).mul(0.5).add(0.5).mul(inv(reach.mul(0.6), reach, dn))
            .mul(smoothstep(w, w.mul(1.6), dn)).mul(big).mul(inSpan).mul(seen));
        });
      });
    });
  });
  // (muł ważony pokryciem: w pasie mętnej rzeki zostaje jej barwa także tam, gdzie wpada czysty dopływ)
  return { line, carve, wet, stripe, bar, mud: clamp(mud.div(max(line, 1e-3)), 0.0, 1.0) };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TERRAN / OCEAN — pole: y — woda słodka (> 0: rzeki, jeziora, starorzecza) albo −wilgotność doliny (< 0: pas przy
// rzece bez wody; na MORZU: −smuga osadu z rzek), z — pasma gór (> 0, skała) albo dno doliny zalewowej (< 0: łuki
// dawnych koryt, łachy; w pikselu wody słodkiej: −0,49 · muł niesiony przez rzekę), w — kontynentalność c
// (próg oceanu z próby: uQ.x). uDr — siatka spływu: x, y — rozmiar, z — 1: włączona, w — ziarno haszu węzłów.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function earthField(type) {
  const ocean = type === 'ocean';
  // uDr2 / uRg / uRg2 — STRUMIENIE REGIONU (planetGenRegion.js; tylko okno pod kamerą w układzie ściany regionu):
  // uDr2 jak uDr (rozmiar siatki, 1 — włączona, ziarno), uRg = (kąt a i b początku siatki, kąt komórki, skala
  // głębokości dolin), uRg2 = (numer komórki początku siatki na kracie planety: x, y)
  const U = bakeUniforms({
    // uK — klimat jak w barwach (temperatura, wilgotność, nachylenie osi): pustynia w polu = rzeźba wydm, suche koryta
    ...COMMON_DEFS, uE1: 'vec4', uE2: 'vec4', uE3: 'vec4', uE4: 'vec4', uDr: 'vec4', uDr2: 'vec4', uRg: 'vec4', uRg2: 'vec4', uK: 'vec4',
    ...(ocean ? slotDefs('uChain') : {})
  });
  const D = drainNode();
  const D2 = drainNode();
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    // oktawy z rozdzielczości celu, dzielnik stały (`full`): wycinek pod kamerą liczy więcej oktaw tego samego pola
    // i trafia w ten sam brzeg (próg oceanu z próby całej planety)
    const P = plates(ps, U.uE1.x, U.uE1.y, U.uE1.z, U.uE1.w, U.uE3.w, U.uOct.x, true);
    const d = P.c.sub(U.uQ.x).toVar();
    const st = C.stN;                                   // kąt teksela celu [rad]
    const beltB = inv(0.0, 0.24, P.border).mul(P.conv).mul(smoothstep(-0.35, 0.1, d));
    const beltN = smoothstep(0.08, 0.5, pgFbm(P.q.mul(2.3).add(vec3(3.1, 7.7, 1.3)), 4));
    // ŁAŃCUCHY ŚRÓDLĄDOWE: pasma wzdłuż grzbietów szumu niskiej częstości (długie i wąskie, nie plamy), niezależne
    // od granic płyt — same granice zbieżne dawały na wielu planetach ląd bez gór (83% lądu poniżej 1 km).
    const rangeN = smoothstep(0.62, 0.86, pgRidged(P.q.mul(1.7).add(vec3(-2.6, 4.9, 0.8)), 3, 2.1, 0.5, 1.0, 2.0))
      .mul(smoothstep(0.0, 0.12, d));
    const belt = max(mix(beltN, beltB, U.uE2.z), rangeN.mul(0.9)).toVar();
    const ridge = pgRidged(P.q.mul(U.uE2.y), U.uOct.z, 2.07, 0.55, 1.0, 2.2, true).toVar();
    const landW = smoothstep(-0.04, 0.22, d).toVar();
    // ląd: niskie przedgórze pasma (12% wysokości) + grzbiety wyostrzone potęgą (szczyty wąskie, doliny między
    // nimi głębokie — pasmo ma być łańcuchem szczytów, nie płaskowyżem: z członem liniowym i 30% podstawy cały
    // masyw leżał nad linią śniegu i wyglądał jak biała plama); dno morza: same grzbiety (łuki wysp)
    const mtnSea = ridge.mul(belt).mul(U.uE2.x).toVar();
    const mtn = belt.mul(ridge.mul(ridge).mul(1.35).add(0.12)).mul(U.uE2.x).toVar();
    const hills = pgErodedFbm(P.q.mul(6.5), U.uOct.y, 0.8, 2.0, 0.5, true).mul(U.uE2.w).toVar();
    const hBase = d.mul(1.4).add(smoothstep(0.0, 0.45, d).mul(0.7)).toVar();
    const hLand = hBase.add(mtn.mul(landW.mul(0.8).add(0.2))).add(hills.mul(landW)).toVar();
    // RZEKI (kanał y): drzewo rzek z prawdziwego spływu po mapie wysokości planety (planetGenDrainage.js) — rzeki
    // biegną od źródeł do morza, łączą się w coraz szersze i nie krzyżują się. Bieg to gładkie łuki przez węzły
    // drzewa z meandrami (`riverNet`), większymi na nizinie i przy dużych rzekach. Dolina wycięta w rzeźbie wzdłuż
    // rzeki, pas wilgotności przy niej (barwy: dolina zalewowa, lasy łęgowe, zielone wstęgi w pustyni), przy
    // wielkich rzekach starorzecza (łuki dawnych koryt wokół dzisiejszego).
    const fresh = float(0.0).toVar();
    const wetV = float(0.0).toVar();
    const scar = float(0.0).toVar();
    const bar = float(0.0).toVar();
    const mud = float(0.0).toVar();
    const plume = float(0.0).toVar();
    // klimat miejsca (ten sam co w barwach): pustynia = mało wilgoci, nie mróz
    const KF = earthClimate(U, C, hLand, d);
    const desertK = float(1.0).sub(smoothstep(0.17, 0.3, KF.M)).mul(smoothstep(0.1, 0.25, KF.T)).toVar();
    If(U.uDr.z.greaterThan(0.5), () => {
      const cosL = max(cos(C.lat), 0.05).toVar();
      const cellsPerRad = U.uDr.y.div(PI).toVar();
      const stC = st.mul(cellsPerRad).toVar();
      // dziedzina szumu odkształcenia biegu: 1 = komórka siatki spływu (surowy kierunek — bez odkształceń kontynentów)
      const wp = C.dir.mul(cellsPerRad).add(U.uSeed.xyz.mul(3.0)).toVar();
      const nz = (f, o) => vec2(
        pgNoise(wp.mul(f).add(vec3(o, o * 1.7 - 2.0, 3.1 - o))), pgNoise(wp.mul(f).add(vec3(-o * 1.3, 5.2 + o, o * 0.7 + 9.0))));
      // łagodne odkształcenie biegu (szum; gaśnie, gdy teksel celu jest większy niż ~⅓ okresu) — łamie proste
      // odcinki siatki; właściwe meandry dokłada `riverNet` (sinusoida wzdłuż odcinka)
      const flatK = float(1.0).sub(smoothstep(0.8, 2.4, hLand)).mul(0.6).add(0.4).toVar();
      // Siatka spływu ma osiem kierunków: bez odkształcenia rzeka biegnie prostymi odcinkami po osiach i przekątnych
      // z załamaniami co kilka komórek (z daleka „ścieżki obwodu drukowanego”). Dwie długie fale (okres ~6 i ~2,5
      // komórki, na każdym poziomie — układ rzek ma być ten sam z daleka i z bliska) wyginają te odcinki w łuki.
      // Przy morzu odkształcenie gaśnie (odległość od morza z kanału B siatki, dwuliniowo — gładko), żeby ujście
      // trafiało w brzeg.
      const g0 = vec2(C.u.mul(U.uDr.x), C.v.mul(U.uDr.y)).toVar();
      const gq = g0.sub(0.5).toVar();
      const c0 = floor(gq).toVar();
      const fq = gq.sub(c0).toVar();
      const DW = max(int(U.uDr.x), int(1));
      const DH = max(int(U.uDr.y), int(1));
      const seaAt = (dx, dy) => D.load(ivec2(mod(int(c0.x).add(dx).add(DW.mul(2)), DW), clamp(int(c0.y).add(dy), int(0), DH.sub(1)))).b;
      const dSea = mix(mix(seaAt(0, 0), seaAt(1, 0), fq.x), mix(seaAt(0, 1), seaAt(1, 1), fq.x), fq.y).mul(255 / DRAIN_SEA_K).toVar();
      const inland = smoothstep(0.5, 3.0, dSea).toVar();
      const warp = nz(0.17, 21.7).mul(1.0).mul(inland)
        .add(nz(0.4, 15.1).mul(0.4).mul(inland))
        .add(nz(0.75, 1.3).mul(0.22).mul(smoothstep(0.3, 1.5, dSea)).mul(float(1.0).sub(smoothstep(0.35, 0.7, stC))))
        .add(nz(2.3, 4.7).mul(0.04).mul(float(1.0).sub(smoothstep(0.1, 0.2, stC)))).mul(flatK).toVar();
      const gp = g0.add(warp.div(vec2(cosL, 1.0))).toVar();
      const R = riverNet(D, U, gp, cosL, stC, flatK);
      // starorzecza tylko w dolinie zalewowej; bez wody na lodowcach wysokich gór; dolina nie schodzi pod poziom
      // morza (inaczej w rzece pojawiało się morze)
      const plain = smoothstep(0.45, 0.8, R.wet).toVar();
      // (starorzecza jako cienkie łuki wody wychodziły jasnymi kreskami bez kształtu — woda tylko z koryta; dawne
      // koryta pokazują pasy dna doliny)
      fresh.assign(R.line.mul(float(1.0).sub(smoothstep(2.6, 4.6, hLand))));
      hLand.subAssign(min(R.carve.mul(landW), max(hLand.sub(0.16), 0.0)));
      wetV.assign(R.wet);
      scar.assign(R.stripe.mul(plain));
      bar.assign(R.bar.mul(plain));
      mud.assign(R.mud);
      // STRUMIENIE REGIONU: druga, gęsta siatka spływu (komórki ~0,5 km) policzona dla obszaru pod kamerą — rysowana
      // tym samym `riverNet` w skali komórek regionu (cienkie cieki, małe zakola, płytkie doliny, pas wilgotności).
      // Rzeki planety są w tej siatce ujściami, więc strumienie kończą się w nich. Przy brzegu siatki gasną.
      If(U.uDr2.z.greaterThan(0.5).and(U.uWin.w.greaterThan(0.5)), () => {
        const rc = max(U.uRg.z, 1e-9).toVar();
        const pxl = screenCoordinate.xy;
        const g2 = vec2(U.uWin.x.add(pxl.x.mul(U.uWin.z)).sub(U.uRg.x), U.uWin.y.add(pxl.y.mul(U.uWin.z)).sub(U.uRg.y)).div(rc).toVar();
        const edgeD = min(min(g2.x, g2.y), min(U.uDr2.x.sub(g2.x), U.uDr2.y.sub(g2.y)));
        const inR = smoothstep(8.0, 40.0, edgeD).toVar();
        If(inR.greaterThan(0.001), () => {
          // odkształcenie biegu jak przy rzekach planety (siatka ma osiem kierunków — bez niego cieki biegną prostymi
          // odcinkami po osiach): dwie długie fale w jednostkach komórki regionu; przy rzece planety gaśnie, żeby
          // strumień trafiał w jej brzeg
          const wp2 = C.dir.div(rc).toVar();
          const nz2 = (f, o) => vec2(
            pgNoise(wp2.mul(f).add(vec3(o, o * 1.7 - 2.0, 3.1 - o))), pgNoise(wp2.mul(f).add(vec3(-o * 1.3, 5.2 + o, o * 0.7 + 9.0))));
          const stC2 = U.uWin.z.div(rc).toVar();
          const warp2 = nz2(0.17, 41.3).mul(0.9).add(nz2(0.45, 27.9).mul(0.4))
            .add(nz2(1.3, 8.6).mul(0.12).mul(float(1.0).sub(smoothstep(0.1, 0.25, stC2))))
            .mul(float(1.0).sub(smoothstep(0.05, 0.4, R.wet))).toVar();
          const R2 = riverNet(D2, { uDr: U.uDr2 }, g2.add(warp2), float(1.0), stC2, flatK, { ox: int(U.uRg2.x), oy: int(U.uRg2.y) });
          // (w pustyni cieki regionu są SUCHE: dolina zostaje w rzeźbie — wadi — ale bez wody)
          fresh.assign(max(fresh, R2.line.mul(inR).mul(float(1.0).sub(smoothstep(2.6, 4.6, hLand))).mul(float(1.0).sub(desertK))));
          hLand.subAssign(min(R2.carve.mul(U.uRg.w).mul(inR).mul(landW), max(hLand.sub(0.16), 0.0)));
          wetV.assign(max(wetV, R2.wet.mul(inR).mul(0.8).mul(float(1.0).sub(desertK.mul(0.92)))));
        });
      });
      // SMUGI OSADU w morzu przy ujściach rzek (kanał A siatki spływu — planetGenDrainage.js): próbka dwuliniowa
      // w punkcie przesuniętym szumem (wiry i języki zamiast koła wokół ujścia; drobne zawijasy dopiero gdy teksel
      // celu je rozdziela), siła łamana szumem o średniej 1
      // (skala w komórkach siatki 2048: przy gęstszej siatce smuga ma tyle samo kilometrów, więc i zawijasy)
      const kS = U.uDr.x.div(2048.0).toVar();
      const nzS = (f, o) => vec2(
        pgNoise(wp.div(kS).mul(f).add(vec3(o, o * 1.7 - 2.0, 3.1 - o))), pgNoise(wp.div(kS).mul(f).add(vec3(-o * 1.3, 5.2 + o, o * 0.7 + 9.0))));
      const pw = nzS(0.22, 31.3).mul(2.6).add(nzS(0.7, 7.9).mul(1.0)).add(nzS(2.4, 12.2).mul(0.3).mul(float(1.0).sub(smoothstep(0.1, 0.25, stC.div(kS))))).mul(kS).toVar();
      const gs = gq.add(pw.div(vec2(cosL, 1.0))).toVar();
      const s0 = floor(gs).toVar();
      const fs = gs.sub(s0).toVar();
      const plAt = (dx, dy) => D.load(ivec2(mod(int(s0.x).add(dx).add(DW.mul(2)), DW), clamp(int(s0.y).add(dy), int(0), DH.sub(1)))).a;
      const plRaw = mix(mix(plAt(0, 0), plAt(1, 0), fs.x), mix(plAt(0, 1), plAt(1, 1), fs.x), fs.y).toVar();
      const plN = pgFbm(wp.div(kS).mul(0.9).add(vec3(4.4, -7.1, 2.6)), 4).toVar();
      plume.assign(clamp(plRaw.mul(float(1.0).add(plN.mul(0.7))).mul(1.2).sub(0.05), 0.0, 1.0));
    });
    // WYDMY w morzach piasku pustyni (nie w dolinach rzek, nie na górach) — tylko pełne pole (wejście spływu i próba
    // liczą teren bez wydm: zagłębienia między wydmami rozbiłyby spływ)
    If(U.uDr.z.greaterThan(0.5).and(desertK.greaterThan(0.01)), () => {
      const erg0 = ergMask(ps).toVar();
      // (wydm nie ma tylko w samym dnie doliny wielkiej rzeki i na wysokich górach — szersze wykluczenie gasiło je
      // kilka kilometrów od każdego cieku)
      // (`landW` rośnie powoli w głąb lądu — gasił wydmy na całych wąskich lądach; tu wystarczy pas przy samym brzegu)
      const shoreK = smoothstep(0.0, 0.03, d).toVar();
      const erg = erg0.mul(desertK).mul(shoreK).mul(float(1.0).sub(smoothstep(0.5, 0.8, wetV)))
        .mul(float(1.0).sub(smoothstep(0.6, 1.6, mtn))).toVar();
      If(erg.greaterThan(0.01), () => {
        const DN = duneField(U, C, ps);
        hLand.addAssign(DN.h.mul(DUNES.heightKm).add(DN.small.mul(DUNES.smallHeightKm)).mul(erg));
      });
      // PUSTYNIA SKALISTA: płaskowyże z progami i ostańce (grzbiety szumu ~17 km z tarasowaniem — stoki progów
      // dostają w barwach skałę, bo są strome), drobniejsze żebra ~4 km
      const ham = hamadaMask(ps, erg0).mul(desertK).mul(shoreK).toVar();
      If(ham.greaterThan(0.01), () => {
        const rg = pgRidged(ps.mul(320.0).add(vec3(4.1, -2.7, 6.3)), 4, 2.1, 0.5, 1.0, 2.0).toVar();
        const mesa = smoothstep(0.38, 0.5, rg).mul(0.55).add(smoothstep(0.62, 0.72, rg).mul(0.45)).toVar();
        const ribs = pgRidged(ps.mul(1400.0).add(vec3(-1.6, 3.3, 0.4)), 3, 2.1, 0.5, 1.0, 2.0).mul(float(1.0).sub(smoothstep(2.0e-4, 5.0e-4, st)));
        hLand.addAssign(mesa.mul(0.22).add(ribs.mul(0.035).mul(float(0.3).add(mesa))).mul(ham));
      });
    });
    // jeziora na nizinach: płaska tafla w zagłębieniu szumu
    const lakeN = pgFbm(P.q.mul(12.0).add(vec3(-4.2, 9.3, 1.1)), 4).toVar();
    const lakeW = max(float(0.02), st.mul(12.0 * 2.4));
    const lake = smoothstep(float(0.56), lakeW.add(0.56), lakeN).mul(float(1.0).sub(smoothstep(0.5, 1.3, hLand))).mul(smoothstep(0.03, 0.09, d)).toVar();
    hLand.assign(mix(hLand, hBase.add(0.16), lake));
    fresh.assign(max(fresh, lake));
    // dno: szelf przy brzegu, stok, równina abisalna; grzbiety śródoceaniczne na granicach płyt oceanicznych
    const mor = inv(0.0, 0.1, P.border).mul(float(1.0).sub(P.cont1)).mul(pgFbm(P.q.mul(9.0), 3).mul(0.4).add(0.6));
    const abyss = pgFbm(P.q.mul(14.0), 4).mul(0.3);
    const hSea0 = float(-0.1).sub(U.uE3.x.mul(smoothstep(0.0, 0.3, d.negate()))).add(mor.mul(U.uE3.y)).add(abyss)
      // (× 0,2: grzbiety dna mają częstość gór lądu — przy × 0,45 wychodziły tuż pod powierzchnię i z jasną barwą
      // płycizny dawały na płytkich morzach plamisty wzór; wyspy robią stożki szelfu i łańcuchy)
      .add(mtnSea.mul(0.2)).toVar();
    // osad z rzeki spłyca morze przy ujściu (stożek delty): materiał pokazuje dno przez wodę z wagą e^(−28 · głębokość),
    // więc głębokość liczy się z ŻĄDANEJ widoczności mętnego dna (0,8 · smuga → ~8 m w sercu smugi, ~125 m na jej
    // skraju — tam zostaje barwa szelfu). Liniowe spłycenie do kilku metrów dawało płaską półkę o ostrym brzegu,
    // a detal wysokości wynosił ją nad wodę jako blady ląd.
    const plVis = clamp(plume.mul(0.8), 0.03, 0.8).toVar();
    const hPlume = log2(plVis).mul(0.6931472 / 28.0).toVar();
    const hSea = mix(hSea0, max(hSea0, hPlume), smoothstep(0.0, 0.25, plume)).toVar();
    const h = mix(hSea, hLand, step(0.0, d)).toVar();
    // archipelagi na szelfach i łukach (wyspy z drobnych stożków w płytkiej wodzie)
    If(U.uE3.z.greaterThan(0.01), () => {
      const ic = pgCells(P.q.mul(34.0), 0.9).toVar();
      const shelf = smoothstep(-0.25, -0.02, d).mul(inv(-0.01, 0.06, d));
      const has = step(float(1.0).sub(U.uE3.z.mul(0.35).mul(shelf.add(beltB.mul(0.5)))), ic.z);
      // (−34: stożek gaśnie przed krawędzią komórki — przy −14 zostawał uskok ~30 m wzdłuż krawędzi komórek)
      h.addAssign(exp(ic.x.mul(ic.x).mul(-34.0)).mul(has).mul(1.2));
    });
    if (ocean) {
      // łańcuchy wysp nad plamami gorąca: stożki wzdłuż łuku koła wielkiego, młode (duże) na początku, stare
      // zatopione — atole (pierścień rafy) na końcu
      for (let i = 0; i < SLOT_CAP; i++) {
        const a = U[`uChain${i}`];
        const b = U[`uChain${i}b`];
        If(a.w.greaterThan(0.0), () => {
          const s0 = normalize(a.xyz);
          const n = normalize(b.xyz);
          const t2 = cross(n, s0);
          const perp = asin(clamp(dot(C.dir, n), -1.0, 1.0)).toVar();
          const ang = atan(dot(C.dir, t2), dot(C.dir, s0)).toVar();
          If(abs(perp).lessThan(0.08).and(ang.greaterThan(-0.05)).and(ang.lessThan(a.w.add(0.05))), () => {
            const N = float(14.0);
            const step_ = a.w.div(N);
            const k = clamp(floor(ang.div(step_).add(0.5)), 0.0, N);
            const tk = k.div(N);
            const jitter = fract(sin(k.mul(12.9898).add(b.w)).mul(43758.5453)).sub(0.5).mul(step_.mul(0.6));
            const da = ang.sub(k.mul(step_)).sub(jitter);
            const dd = sqrt(da.mul(da).add(perp.mul(perp)));
            // wielkość i obecność wyspy z haszu (bez równego „sznura korali”)
            const hk = fract(sin(k.mul(78.233).add(b.w.mul(1.37))).mul(43758.5453));
            const rad = mix(0.022, 0.006, tk).mul(hk.mul(0.9).add(0.45)).mul(step(0.28, hk)).add(1e-5).toVar();
            const rr = dd.div(rad);
            // profil wyspy tylko w jej obrysie (poza nim −∞ — dno oceanu zostaje głębokie)
            const cone = exp(rr.mul(rr).negate()).mul(mix(1.6, -0.08, tk));
            const ring = exp(rr.sub(1.0).div(0.25).pow2().negate()).mul(0.14).mul(smoothstep(0.5, 0.8, tk));
            const isl = max(cone, ring.sub(0.1)).sub(mix(0.0, 0.05, tk));
            const foot = float(1.0).sub(smoothstep(1.3, 2.0, rr));
            h.assign(max(h, mix(float(-1e3), isl, foot)));
          });
        });
      }
    }
    // y: woda (> 0) albo −wilgotność doliny; z: pasma gór (> 0), −0,49 · łuki dawnych koryt (0…−0,49) albo
    // −(0,5 + 0,5 · łacha) (−0,5…−1) — tylko na lądzie
    const onLand = step(0.0, d);
    // (na MORZU y = −smuga osadu; w pikselu WODY słodkiej z = −0,49 · muł — barwy czytają to zamiast łuków)
    const yOut = mix(plume.negate(), mix(wetV.negate(), clamp(fresh, 0.0, 1.0), step(0.02, fresh)), onLand);
    const zLand = mix(mix(belt.mul(ridge), scar.mul(-0.49), step(0.02, scar).mul(onLand)), bar.mul(0.5).add(0.5).negate(), step(0.05, bar).mul(onLand));
    const zOut = mix(zLand, mud.mul(-0.49), step(0.02, fresh).mul(step(0.02, mud)).mul(onLand));
    return vec4(h, yOut, zOut, P.c);
  })();
  return { U, material: bakeMaterial(`PlanetGenField_${type}`, node), drain: D, drain2: D2 };
}

const EARTH_COLOR_DEFS = {
  ...COMMON_DEFS, uK: 'vec4', uK2: 'vec4', uK3: 'vec4',
  // barwy krajobrazu wspólne z mapą terenu (planetGenTerrainMap.js): A — klimat chłodny, B — ciepły
  uFenA: 'vec3', uFenB: 'vec3', uFenWetA: 'vec3', uFenWetB: 'vec3', uGrassA: 'vec3', uGrassB: 'vec3', uMeadowA: 'vec3', uMeadowB: 'vec3',
  uWDark: 'vec3', uWMud: 'vec3', uWIce: 'vec3', uSilt: 'vec3', uSandB: 'vec3', uAccentA: 'vec3', uAccentB: 'vec3',
  uRain: 'vec3', uForest: 'vec3', uTaiga: 'vec3', uSteppe: 'vec3', uTundra: 'vec3', uDesert: 'vec3', uDesertRed: 'vec3',
  uRock: 'vec3', uSnow: 'vec3', uIce: 'vec3', uShallow: 'vec3', uOcean: 'vec3', uDeep: 'vec3'
};
// KLIMAT (wspólny dla barw i dla opadu, z którego liczy się spływ): temperatura T i wilgotność M z szerokości,
// wysokości, odległości od brzegu i szumu. h — wysokość [km], d — kontynentalność względem brzegu (> 0 ląd).
function earthClimate(U, C, h, d) {
  const ps = C.dir.add(U.uSeed.xyz).toVar();
  const wq = pgWarp(ps.mul(1.3), 3, 0.35).toVar();
  const nT = pgFbm(ps.mul(2.2).add(11.0).add(wq), 4).toVar();
  const nM = pgFbm(ps.mul(1.9).add(23.0).add(wq), 6).toVar();
  const nP = pgFbm(ps.mul(6.5).add(wq.mul(2.0)), 5).toVar();   // płaty roślinności (nie pasy)
  const aL = abs(C.lat).div(PI / 2).add(nT.mul(0.05)).toVar();
  // temperatura: równik ciepło, bieguny zimno (nachylenie osi rozmywa pasy), spadek z wysokością 0,16 / km
  // (~6 °C / km przy ~37 °C na jednostkę T — granica lasu i linia śniegu wypadają na wysokościach jak na Ziemi)
  const T = float(1.06).sub(pow(clamp(aL, 0.0, 1.0), 1.35).mul(1.28)).add(U.uK.x).add(nT.mul(float(0.07).add(U.uK.z.mul(0.07))))
    .sub(max(h, 0.0).mul(0.16)).toVar();
  // wilgotność: komórki Hadleya (mokro przy równiku i ~55°, sucho ~25° i przy biegunach), wnętrza kontynentów suche,
  // granice pasów przesunięte szumem (nie równoleżniki); pasy klimatu słabe (×0,2 — wyraźne równoleżnikowe pasy
  // wyglądały na malowane), wielkie plamy wilgoci z szumu niskiej częstości
  const latW = C.lat.add(nM.mul(0.3));
  const nMl = pgFbm(ps.mul(0.9).add(37.0).add(wq), 4).toVar();
  const M = U.uK.y.mul(float(0.5).add(cos(latW.mul(6.0)).mul(0.2))).add(nM.mul(0.26)).add(nMl.mul(0.32)).add(nP.mul(0.12))
    .sub(smoothstep(0.1, 0.7, d).mul(0.36)).add(0.12).toVar();
  return { ps, wq, nM, nP, T, M };
}
// WEJŚCIE SPŁYWU (cel RGBA32F w rozdzielczości siatki spływu, odczyt CPU — planetGenBaker.js): x — wysokość [km],
// y — opad 0…~1,6 (waga przepływu: w pustyni rzeki nie rodzą się, w górach i wilgotnych strefach gęsto; pod lodem
// prawie nic), z — temperatura, w — wilgotność (klimat miejsca dla mapy terenu — planetGenPlace.js).
function earthDrainInput(type) {
  return (F) => {
    const U = bakeUniforms(EARTH_COLOR_DEFS);
    const node = Fn(() => {
      const C = bakeCoords(U);
      const f = fieldAt(F, U, C.ix, C.iy).toVar();
      const K = earthClimate(U, C, f.x, f.w.sub(U.uQ.x));
      const rain = clamp(K.M.sub(0.12).mul(2.4), 0.03, 1.3).mul(smoothstep(-0.08, 0.1, K.T).mul(0.85).add(0.15))
        .add(smoothstep(0.6, 2.5, f.x).mul(0.35));
      return vec4(f.x, rain, K.T, K.M);
    })();
    return { U, material: bakeMaterial(`PlanetGenDrain_${type}`, node) };
  };
}
function earthColor(type) {
  return (F) => {
    const U = bakeUniforms(EARTH_COLOR_DEFS);
    const node = Fn(() => {
      const C = bakeCoords(U);
      const f = fieldAt(F, U, C.ix, C.iy).toVar();
      const h = f.x;
      const d = f.w.sub(U.uQ.x).toVar();   // kontynentalność względem brzegu (> 0 ląd)
      const sl = slopeAt(F, U, C);
      const curv = curvatureAt(F, U, C, h);
      const K = earthClimate(U, C, h, d);
      const { ps, wq, nM, nP, T, M } = K;
      const st = C.stN;
      const nV = pgFbm(ps.mul(11.0).add(wq), 5).toVar();
      const nF = pgFbm(ps.mul(34.0), 4).toVar();
      // kanały pola: woda słodka / wilgotność doliny (y), pasma gór / starorzecza (z)
      const mtn = max(f.z, 0.0).toVar();
      const zNeg = max(f.z.negate(), 0.0).toVar();
      const bar = clamp(zNeg.mul(2.0).sub(1.0), 0.0, 1.0).toVar();
      const scar0 = clamp(zNeg.div(0.49), 0.0, 1.0).mul(float(1.0).sub(step(0.5, zNeg))).toVar();
      const water = max(f.y, 0.0).toVar();
      const onLand = step(0.0, d).toVar();
      const wetV = max(f.y.negate(), step(0.02, f.y)).mul(onLand).toVar();
      // morze: smuga osadu przy ujściach rzek; woda słodka: muł niesiony przez wielką rzekę (kanał z w pikselu wody)
      const plume = max(f.y.negate(), 0.0).mul(float(1.0).sub(onLand)).mul(float(1.0).sub(step(0.0, h))).toVar();
      const isW = step(0.02, f.y).toVar();
      const mudW = clamp(zNeg.div(0.49), 0.0, 1.0).mul(isW).toVar();
      const scar = scar0.mul(float(1.0).sub(isW)).toVar();
      // szumy mozaiki — oktawy z rozdzielczości celu (wycinek pod kamerą dostaje drobniejsze w tej samej dziedzinie):
      // nD — ziarno (korony, żwir; okres od 3 tekseli), nMo — kształty płatów (granice klas pokrycia), nBog — płaty
      // polan i torfowisk (oba od ~6 tekseli: granice klas mają być gładkimi liniami, nie ziarnem; szum grzbietowy
      // dawał tu z daleka „robaczki” na całym lądzie). Granica klasy =
      // próg z szerokością z pochodnej ekranu celu (`edge`): ostra, ale bez schodków tekseli przy powiększeniu.
      const edge = (v, pad = 0.0015) => { const fw = fwidth(v).mul(0.8).add(pad); return smoothstep(fw.negate(), fw, v); };
      // (oba z ogonem: granice lasu i pól nie zmieniają kształtu przy zbliżaniu — zbliżenie dokłada tylko strzępienie)
      const nD = pgFbm(ps.mul(110.0).add(wq.mul(3.0)), U.uK.w, 2.03, 0.6, true, COVER_TAIL).toVar();
      const nMo = pgFbm(ps.mul(46.0).add(vec3(3.7, -8.1, 5.3)).add(wq.mul(2.0)), U.uK2.x, 2.03, 0.6, true, COVER_TAIL).toVar();
      // nFen — płaty torfowisk i polan: szereg o wolno gasnących oktawach (wielkie płaty z rojem mniejszych wokół —
      // z daleka widać mozaikę jasnych i ciemnych pól, zbliżenie dokłada coraz mniejsze płaty w tym samym układzie)
      const nFen = pgFbm(ps.mul(30.0).add(vec3(5.1, -3.3, 7.7)).add(wq.mul(2.5)), U.uK2.z, 2.03, 0.62, true).toVar();
      const flat = float(1.0).sub(smoothstep(0.03, 0.14, sl.s)).toVar();
      // wilgotność miejsca: klimat + dolina rzeki (lasy łęgowe w stepie, zielona wstęga w pustyni) − suche stoki
      // (bez członów zależnych od skali teksela, np. krzywizny — płaty lasu mają być te same na każdym poziomie)
      const Mv = M.add(wetV.mul(0.3)).sub(smoothstep(0.12, 0.5, sl.s).mul(0.08)).toVar();
      // ── barwy klas ──
      const desertC = mix(U.uDesert, U.uDesertRed, smoothstep(0.0, 0.6, nV.add(nP.mul(0.5))).mul(0.6));
      const forestC = vec3(mix(mix(U.uTaiga, U.uForest, smoothstep(0.36, 0.55, T)), U.uRain, smoothstep(0.72, 0.9, T))).toVar();
      const meadowC = vec3(mix(U.uSteppe, forestC, 0.42).mul(vec3(1.3, 1.75, 1.1))).toVar();
      // barwy krajobrazu z palet MAPY TERENU (ten sam las, torfowisko i dolina co na mapie miejsca): chłodny
      // klimat — paleta A (tajga), ciepły — B (las równikowy); przejście jak wybór palety w planetGenPlace.js
      const warmK = smoothstep(0.5, 0.74, T).toVar();
      const fenC = vec3(mix(U.uFenA, U.uFenB, warmK)).toVar();
      const fenWetC = vec3(mix(U.uFenWetA, U.uFenWetB, warmK)).toVar();
      const grassC = vec3(mix(U.uGrassA, U.uGrassB, warmK)).toVar();
      const meadowT = vec3(mix(U.uMeadowA, U.uMeadowB, warmK)).toVar();
      const bogC = mix(fenC, U.uSteppe, 0.25);
      const sandC = U.uSandB;
      // ── PUSTYNIA: morza piasku z wydmami (dwie skale grzbietów, widoczne dopiero gdy teksel je rozdziela),
      //    kamienista hamada w ciemniejszych płatach o wyraźnym brzegu ──
      const land = vec3(desertC).toVar();
      const erg = ergMask(ps).toVar();
      // wydmy są w rzeźbie (pole) — tu tylko barwa: grzbiety jaśniejsze i cieplejsze, płaskie dna między wydmami
      // blade, szarawe (twardy grunt, pył), wszystko na piasku nasyconym ku pomarańczowi
      const duneH = float(DUNES.mean).toVar();
      const duneFlat = float(0.0).toVar();
      If(erg.mul(float(1.0).sub(smoothstep(0.17, 0.3, M))).greaterThan(0.01), () => {
        const DN = duneField(U, C, ps);
        duneH.assign(DN.h);
        duneFlat.assign(DN.flat);
      });
      // (piasek mórz piasku wyraźnie pomarańczowy — wzorce; reszta pustyni zostaje płowa)
      const duneSand = mix(desertC, U.uDesertRed, 0.35).mul(vec3(1.3, 0.98, 0.66)).mul(float(0.86).add(duneH.mul(0.34)));
      // (dno między wydmami to też piasek, tylko bledszy; szare, twarde dna — w części pól, płatami)
      const pan = smoothstep(0.05, 0.3, nV.add(nP.mul(0.6))).toVar();
      const flatC = mix(desertC.mul(vec3(1.06, 0.98, 0.86)), vec3(0.5, 0.46, 0.4), pan.mul(0.6));
      land.assign(mix(land, mix(duneSand, flatC, duneFlat), erg));
      land.mulAssign(float(1.0).add(nD.mul(0.1)));
      // (kamienista hamada tam, gdzie pole ma płaskowyże i ostańce — wspólna maska; brzeg płata strzępiony szumem)
      const ham = hamadaMask(ps, erg).mul(smoothstep(-0.12, 0.1, nMo.add(nV.mul(0.5))));
      land.assign(mix(land, mix(U.uRock, U.uDesertRed, 0.45).mul(float(1.15).add(nD.mul(0.2))), ham.mul(0.55)));
      // ── STEP (sucha trawa) i ŁĄKA (zielona): przejścia płatami, nie gradientem ──
      const dry = smoothstep(0.15, 0.27, Mv.add(nMo.mul(0.07))).toVar();
      // płaty o innym odcieniu (wyschnięta / świeża trawa) i ziarno — równa barwa na nizinie wygląda jak plama
      const tone = smoothstep(-0.22, 0.22, nMo.add(nF.mul(0.6))).toVar();
      land.assign(mix(land, U.uSteppe.mul(mix(vec3(1.12, 1.02, 0.84), vec3(0.86, 0.94, 1.0), tone)).mul(float(1.0).add(nP.mul(0.12)).add(nD.mul(0.2))), dry));
      const green = smoothstep(0.3, 0.42, Mv.add(nMo.mul(0.06)).add(nD.mul(0.02))).mul(smoothstep(0.12, 0.22, T)).toVar();
      land.assign(mix(land, meadowC.mul(mix(vec3(1.1, 1.0, 0.8), vec3(0.88, 1.04, 0.98), tone)).mul(float(1.0).add(nD.mul(0.22))), green));
      // ── LAS: ostra granica z szumu płatów (mozaika las / łąka), górna granica lasu z temperatury, bez lasu na
      //    urwiskach; POLANY I TORFOWISKA — jasne sieci w lesie (na płaskim, wilgotnym i chłodnym gęściej);
      //    DOLINA ZALEWOWA — pas przy rzece z łąkami zamiast lasu ──
      const treeT = smoothstep(0.15, 0.21, T.add(nMo.mul(0.035)));
      // skraj lasu: skupiska drzew przed ścianą lasu i luki za nią (komórki w dwóch skalach, widoczne dopiero gdy
      // teksel celu je rozdziela) — granica las / łąka nie jest jedną gładką linią
      const cA = pgCells(ps.mul(700.0).add(vec3(1.3, 4.1, -2.2)), 0.9).toVar();
      const onA = float(1.0).sub(smoothstep(2.4e-4, 4.8e-4, st)).toVar();
      const cB = pgCells(ps.mul(2400.0).add(vec3(-5.3, 0.7, 3.9)), 0.9).toVar();
      const onB = float(1.0).sub(smoothstep(7.0e-5, 1.4e-4, st)).toVar();
      // (0,516 = średnia odległość do najbliższego punktu komórek — człon ma średnią ZERO: skupiska przesuwają
      // granicę lasu w obie strony i udział lasu nie zmienia się ze zbliżeniem; z 0,42 łąki rosły przy zbliżaniu)
      const clump = float(0.516).sub(cA.x).add(nMo.mul(0.5)).mul(onA).mul(0.11)
        .add(float(0.516).sub(cB.x).add(nD.mul(0.3)).mul(onB).mul(0.06)).toVar();
      const forest = edge(Mv.sub(0.44).add(nMo.mul(0.17)).add(clump)).mul(treeT)
        .mul(float(1.0).sub(smoothstep(0.45, 0.8, sl.s))).toVar();
      const bogP = flat.mul(smoothstep(0.4, 0.75, M)).mul(inv(0.45, 0.7, T));
      // polany i torfowiska (wzór ze zdjęcia: jasne, ROZGAŁĘZIONE pasma w ciemnym lesie): pasma wzdłuż drobnych
      // cieków (wilgotność doliny strumyka — rozgałęziają się jak sieć rzeczna, przerywane szumem) i drobne płaty
      // na grzbietach szumu; rzadko, na płaskim, wilgotnym i chłodnym gęściej; całe okolice bez polan
      const region = smoothstep(-0.1, 0.2, nV).toVar();
      const fen = smoothstep(0.1, 0.24, wetV).mul(inv(0.4, 0.5, wetV)).mul(smoothstep(-0.02, 0.1, nMo.add(nF.mul(0.4)))).mul(region);
      // TORFOWISKA I POLANY — mozaika płatów w TRZECH SKALACH (komórka szumu ~120, ~33 i ~9 km), jak na mapie
      // terenu: dużo małych, postrzępionych pól zamiast kilku wielkich plam. Gęstość `fenD` rośnie na płaskim,
      // wilgotnym i chłodnym, całe krainy mają pól więcej albo mniej (`nFen`, `nV`). Warstwa, której teksel celu
      // jeszcze nie rozdziela, wchodzi ŚREDNIĄ (udział pola `cov` jako rozjaśnienie lasu), więc kraina torfowisk
      // ma z daleka tę samą jasność co z bliska, a zbliżenie rozbija ją na coraz drobniejsze pola.
      const fenAmt = mix(float(0.3), float(1.0), bogP).mul(mix(U.uK3.x, U.uK3.y, warmK)).mul(mix(float(0.35), float(1.0), flat)).toVar();
      const fenD = clamp(fenAmt.mul(float(0.6).add(nFen.mul(5.0)).add(nV.mul(2.0))), 0.0, 1.0).toVar();
      // próg warstwy (szum trzech oktaw, odchylenie ~0,18): 0,30 ≈ 2% pola, 0,20 ≈ 13%; warstwy drobne + 0,08 (~4%)
      const fenT = mix(float(0.30), float(0.20), fenD).toVar();
      const fenMean = float(1.0).sub(smoothstep(-0.36, 0.36, fenT)).toVar();
      // `fenLayer` → (pole, pole z pasem zarośli wokół): ten sam szum z progiem niższym o 0,035 daje otoczkę pola
      const fenLayer = (freq, off, tAdd = 0.0) => {
        // (dziedzina odkształcona własnym szumem warstwy: pola wydłużone i rozgałęzione — sam próg szumu przy małym
        // udziale pola daje okrągłe kropki)
        const pp = ps.mul(freq).add(off).toVar();
        const n = pgFbm(pp.add(pgWarp(pp.mul(1.6).add(vec3(3.3, 1.1, -2.2)), 2, 0.7)), 3).toVar();
        const on = float(1.0).sub(smoothstep(1 / (freq * 12), 1 / (freq * 6), st)).toVar();
        // (obrys strzępiony drobnym szumem celu — największe pola nie mają gładkiego brzegu)
        const v = n.add(nD.mul(0.22)).add(nMo.mul(0.12)).sub(fenT).sub(tAdd).toVar();
        const mean = tAdd > 0 ? float(1.0).sub(smoothstep(-0.36, 0.36, fenT.add(tAdd))) : fenMean;
        return vec2(mix(mean, edge(v, 0.003), on), mix(mean, edge(v.add(0.035), 0.003), on));
      };
      const fenA = fenLayer(46.0, vec3(5.1, -3.3, 7.7)).toVar();
      const fenB = fenLayer(170.0, vec3(-9.4, 6.2, 1.8)).toVar();
      const fenS = fenLayer(620.0, vec3(2.7, 8.8, -4.6)).toVar();
      // dwie warstwy DROBNE (komórka ~2,5 km i ~0,7 km) — widoczne dopiero w skali mapy terenu; rzadsze (próg + 0,08)
      const fenF = fenLayer(2200.0, vec3(-1.9, 4.4, 9.2), 0.08).toVar();
      const fenG = fenLayer(8000.0, vec3(7.3, -6.1, 2.4), 0.08).toVar();
      const uni = (k) => float(1.0).sub(float(1.0).sub(fenA[k]).mul(float(1.0).sub(fenB[k])).mul(float(1.0).sub(fenS[k]))
        .mul(float(1.0).sub(fenF[k])).mul(float(1.0).sub(fenG[k])));
      // WYSPY DRZEW w polach (dwie skale komórek: ~0,8 km i ~230 m; dziedzina surowa — kierunek bez przesunięcia
      // ziarna, żeby float32 starczył): 40% komórek ma kępę o promieniu ~0,28 komórki; gdy cel ich nie rozdziela,
      // wchodzą średnią (10% pola na skalę)
      const isle = (freq, off) => {
        const c = pgCells(C.dir.mul(freq).add(off), 0.9).toVar();
        const on = float(1.0).sub(smoothstep(1 / (freq * 10), 1 / (freq * 5), st)).toVar();
        // (promień z haszu komórki, obrys łamany szumem — równe kółka wyglądały jak dziurkacz)
        const rr = fract(c.z.mul(7.31)).mul(0.26).add(0.1).toVar();
        const wob = pgNoise(C.dir.mul(freq * 2.7).add(off.zxy)).mul(0.16).toVar();
        return mix(float(0.06), step(0.72, c.z).mul(float(1.0).sub(smoothstep(rr.mul(0.75), rr, c.x.add(wob)))), on);
      };
      const isles = float(1.0).sub(float(1.0).sub(isle(7000.0, vec3(0.37, 0.11, 0.73))).mul(float(1.0).sub(isle(24000.0, vec3(0.61, 0.29, 0.05))))).toVar();
      const fenAll = uni('x').mul(float(1.0).sub(isles)).toVar();
      // pas zarośli wokół pól (tylko gdy cel go rozdziela — z daleka byłby zmianą jasności krainy)
      const fenRim = max(uni('y').sub(uni('x')), 0.0).mul(float(1.0).sub(smoothstep(6.0e-5, 2.0e-4, st))).toVar();
      const clr = max(fenAll, fen).toVar();
      // w polu: suche (jaśniejsze) i mokre (zieleńsze) części — drobna mozaika, nie gradient
      const fenWetK = smoothstep(0.02, 0.08, nD.add(nMo.mul(0.5))).mul(0.6).toVar();
      // (brzeg pasa nierówny: szum MNOŻY wilgotność — dodany tworzył kropki pasa zalewowego wzdłuż strumyków)
      // (część wilgotności ponad smugę strumyka = pas wielkiej rzeki; jej brzeg mocno poszarpany szumem — równa
      // otoczka wokół rzeki wyglądała jak pigułka)
      const wetBig = max(wetV.sub(0.46), 0.0).div(0.54).toVar();
      const flood = smoothstep(0.25, 0.55, wetBig.add(nMo.mul(2.0).add(nV.mul(0.6)).mul(smoothstep(0.02, 0.2, wetBig)))).toVar();
      land.assign(mix(land, mix(fenC, fenWetC, fenWetK).mul(float(1.0).add(nD.mul(0.25))), clr.mul(smoothstep(0.36, 0.48, Mv)).mul(treeT).mul(0.95)));
      forest.mulAssign(float(1.0).sub(clr.mul(0.92)));
      // otoczka pola: zarośla i młody las (jaśniejsza, zieleńsza niż ściana lasu)
      land.assign(mix(land, mix(meadowT, fenWetC, 0.5).mul(float(1.0).add(nD.mul(0.25))), fenRim.mul(smoothstep(0.36, 0.48, Mv)).mul(treeT).mul(0.75)));
      forest.mulAssign(float(1.0).sub(fenRim.mul(0.75)));
      forest.mulAssign(float(1.0).sub(flood.mul(0.5)));
      // DOLINA ZALEWOWA: soczysta zieleń łęgów (ciemniejsza niż łąka — blady pas wyglądał jak pobocze), łuki dawnych
      // koryt jaśniejszymi i ciemniejszymi pasami
      const floodC = vec3(mix(meadowT, grassC, 0.55)).toVar();
      land.assign(mix(land, floodC.mul(mix(float(0.72), float(1.32), scar)).mul(float(1.0).add(nD.mul(0.2))), flood.mul(smoothstep(0.1, 0.2, T)).mul(0.9)));
      // korony: ziarno do teksela i płaty drzewostanów o innym odcieniu
      const stand = smoothstep(-0.2, 0.25, nF.add(nV.mul(0.4)));
      // FAKTURA LASU z bliska (średnia 1 — jasność lasu ta sama na każdym poziomie): odcień drzewostanu z haszu
      // komórki ~2,3 km, kępy ~210 m i korony ~60 m jaśniejsze w środku, ciemne w szczelinach między nimi (cień
      // między koronami widać niezależnie od kierunku słońca)
      // (zwraca: jasność, mnożnik wysokości koron — kępa wyższa w środku)
      const crown = (freq, off, lo, k) => {
        const c = pgCells(C.dir.mul(freq).add(off), 0.9).toVar();
        const on = float(1.0).sub(smoothstep(1 / (freq * 8), 1 / (freq * 4), st)).toVar();
        const dome = float(1.0).sub(smoothstep(0.05, 0.55, c.x)).toVar();
        return vec2(mix(float(1.0), float(lo).add(dome.mul(k)), on), mix(float(1.0), float(0.72).add(dome.mul(0.5)), on));
      };
      const crA = crown(26000.0, vec3(0.13, 0.57, 0.91), 0.93, 0.28).toVar();
      const crB = crown(52000.0, vec3(0.41, 0.83, 0.17), 0.93, 0.28).toVar();
      const crC = crown(105000.0, vec3(0.77, 0.21, 0.43), 0.9, 0.4).toVar();
      const crowns = crA.x.mul(crB.x).mul(crC.x).toVar();
      // KĘPY DRUGIEGO GATUNKU (palety z `accent`: czerwone korony w lesie równikowym, złote w czerwonym…): płaty
      // w dwóch skalach (~21 km i ~3,7 km), po kilka procent lasu; skala nierozdzielona wchodzi średnią
      const accLayer = (freq, off) => {
        const pp = ps.mul(freq).add(off).toVar();
        const n = pgFbm(pp.add(pgWarp(pp.mul(1.7).add(vec3(-2.1, 3.9, 0.7)), 2, 0.6)), 3).toVar();
        const on = float(1.0).sub(smoothstep(1 / (freq * 12), 1 / (freq * 6), st)).toVar();
        return mix(float(0.045), edge(n.add(nD.mul(0.2)).sub(0.3), 0.003), on);
      };
      const accent = float(1.0).sub(float(1.0).sub(accLayer(260.0, vec3(6.6, -2.4, 3.1))).mul(float(1.0).sub(accLayer(1500.0, vec3(-4.2, 7.7, 1.5)))))
        .mul(mix(U.uK3.z, U.uK3.w, warmK)).toVar();
      const accentC = vec3(mix(U.uAccentA, U.uAccentB, warmK)).toVar();
      const crownsH = crA.y.mul(crB.y).mul(crC.y).toVar();
      const canopy = mix(vec3(0.95, 1.0, 1.02), vec3(1.4, 1.3, 0.95), stand).mul(float(1.0).add(nD.mul(0.6)).add(nMo.mul(0.9)))
        .mul(mix(float(1.0), float(0.8).add(float(0.6).sub(cB.x).mul(0.5)).mul(float(0.9).add(cB.z.mul(0.2))), onB)).mul(crowns);
      land.assign(mix(land, mix(forestC, accentC, accent.mul(0.8)).mul(canopy), forest));
      // tarasy: jasne płaty na zewnętrznym brzegu doliny; łachy: jasny piasek po wewnętrznej stronie zakoli
      // (tylko gdy teksel celu rozdziela płaty — z daleka wychodziły jasnymi kropkami wzdłuż rzek)
      const terrace = smoothstep(0.4, 0.54, wetV).mul(inv(0.58, 0.72, wetV)).mul(smoothstep(0.06, 0.2, nF.add(nMo.mul(0.6)))).mul(flat)
        .mul(float(1.0).sub(smoothstep(1.0e-4, 2.2e-4, st)));
      land.assign(mix(land, bogC.mul(float(1.05).add(nD.mul(0.2))), terrace.mul(smoothstep(0.1, 0.2, T)).mul(0.7)));
      land.assign(mix(land, sandC, bar.mul(0.9)));
      // ── TUNDRA: płaty z szumu, drobne ciemne oczka na płaskim ──
      const tun = inv(0.15, 0.25, T.add(nMo.mul(0.04))).toVar();
      land.assign(mix(land, U.uTundra.mul(float(1.0).add(nP.mul(0.15)).add(nD.mul(0.22))), tun));
      land.assign(mix(land, U.uOcean.mul(1.6), smoothstep(0.36, 0.42, nD).mul(tun).mul(flat).mul(smoothstep(-0.04, 0.03, T)).mul(0.7)));
      // krzywizna w barwie tylko lekko (światło i cień terenu liczy materiał z mapy rzeźby — mocna krzywizna
      // w albedo dawała „słoje drewna” na całym lądzie)
      land.mulAssign(float(1.0).add(clamp(curv.mul(-2.5), -0.05, 0.05)));
      // ── GÓRY: piętra z temperatury (spada z wysokością): las → hale (tundra górska — wyżej, `tun`) → skała
      //    i piarg (jaśniejsze niż skała urwisk) → śnieg. Skała także na urwiskach niezależnie od wysokości. ──
      const alpine = inv(0.05, 0.15, T.add(nMo.mul(0.03))).mul(smoothstep(0.5, 1.3, h)).toVar();
      const rocky = max(smoothstep(0.16, 0.36, sl.s.add(nD.mul(0.04))),
        max(alpine, smoothstep(0.3, 0.7, mtn).mul(smoothstep(0.8, 2.6, h)).mul(0.7))).toVar();
      const rockC = U.uRock.mul(mix(vec3(1.0), vec3(1.45, 1.4, 1.35), alpine)).mul(float(1.0).add(nF.mul(0.22)).add(nD.mul(0.16)));
      land.assign(mix(land, rockC, rocky.mul(0.85)));
      // ŚNIEG: granica z temperatury — w górach ostra linia śniegu (szerokość z pochodnej celu), na nizinach
      // polarnych miękka; mniej na urwiskach, nieco niżej na stokach odwróconych od równika. Biel pełna: szczyty
      // mają być śnieżnobiałe, ale poniżej progu bloomu (albedo × 0,88 — przy pełnym słońcu ~0,85; z × 1,06 śnieg świecił).
      const snowT = T.add(nMo.mul(0.03)).add(nF.mul(0.025)).add(clamp(sl.dN.mul(C.lat.sign()).mul(0.1), -0.025, 0.025)).toVar();
      const snowW = max(mix(float(0.05), float(0.006), smoothstep(0.3, 1.2, h)), fwidth(snowT).mul(0.8)).toVar();
      // (ściany o nachyleniu ponad ~30% zostają skalne — śnieg leży na grzbietach i polach, nie na urwiskach)
      const snow = inv(float(0.075).sub(snowW), float(0.075).add(snowW), snowT)
        .mul(float(1.0).sub(smoothstep(0.28, 0.62, sl.s.add(nD.mul(0.05))).mul(0.85))).toVar();
      land.assign(mix(land, U.uSnow.mul(0.88), clamp(snow, 0.0, 1.0)));
      land.mulAssign(float(1.0).add(nV.mul(0.06)).add(nF.mul(0.05)));
      // ── PLAŻA: jasny piasek na płaskim brzegu i na płyciźnie tuż pod wodą (przez wodę daje turkusowy pas) ──
      // (odległość od brzegu ≈ |wysokość| / nachylenie: pas stałej szerokości, nie mniej niż ~2 teksele celu —
      // sam próg wysokości zamieniał płaskie niziny przy morzu w beżowe równiny)
      // Tylko przy WODZIE: w promieniu 3 tekseli musi być punkt poniżej poziomu morza (na lądzie) — sam próg
      // wysokości rysował jasne kreski-poziomice na niskich pagórkach w głębi lądu.
      // (plaża ma ~1 km; gdy teksel celu jest większy, pas idzie na szerokość teksela, ale z pokryciem
      // (szerokość / teksel)^0,7 — z daleka nie robi jasnej obwódki wokół każdego lądu)
      const beachW0 = float(1.0);
      const beachW = max(beachW0, U.uGeo.y.mul(1.5)).toVar();
      const beachCov = pow(beachW0.div(beachW), 0.7).toVar();
      const hNear = (dx, dy) => fieldAt(F, U, C.ix.add(dx), C.iy.add(dy)).x;
      const hLow = min(min(hNear(3, 0), hNear(-3, 0)), min(hNear(0, 3), hNear(0, -3)));
      const hHigh = max(max(hNear(3, 0), hNear(-3, 0)), max(hNear(0, 3), hNear(0, -3)));
      const shore = mix(step(0.0, hHigh), float(1.0).sub(smoothstep(-0.002, 0.004, hLow)), step(0.0, h));
      const beach = inv(beachW.mul(0.4), beachW, abs(h).div(sl.s.add(2e-4))).mul(inv(0.0, 0.03, abs(h))).mul(shore)
        .mul(smoothstep(0.1, 0.22, T)).mul(smoothstep(-0.1, 0.2, nV.add(nMo.mul(0.5)))).mul(beachCov);
      land.assign(mix(land, U.uSandB, beach.mul(0.7)));
      // woda słodka (barwy jak na mapie terenu): ciemna woda leśnych rzek i jezior, mętna wielkich rzek niosących
      // muł, mleczny błękit rzek z lodowców w górach; połysk i fale dokłada materiał zbliżenia
      const glac = smoothstep(0.9, 2.0, h).mul(float(1.0).sub(mudW)).toVar();
      const waterC = mix(mix(U.uWDark, U.uWIce, glac), U.uWMud, mudW);
      land.assign(mix(land, waterC, water.mul(inv(-0.05, 0.02, T).oneMinus())));
      // dno morza w smudze osadu: jasny muł (materiał pokazuje go przez płytką wodę)
      land.assign(mix(land, U.uSilt.mul(float(1.0).add(nMo.mul(0.3))), smoothstep(0.0, 0.1, plume)));
      // MORZE liczy shader (planetGenSurface.tsl.js: brzeg z wysokości i detalu, barwa wody z głębokości), więc mapa
      // dnia ma WSZĘDZIE barwę gruntu — pod wodą to dno, które płycizny przepuszczają, a brzeg w mapie nie istnieje
      // (bez schodków tekseli przy zbliżeniu). Alfa = lód morski (płaty z temperatury, ciągłe przez brzeg); na morzu
      // RGB lodu, na lądzie RGB gruntu.
      const floe = smoothstep(-0.15, 0.3, nF.add(nV.mul(0.6)));
      const iceT = T.add(nP.mul(0.09)).add(nV.mul(0.06)).add(nF.mul(0.04));
      // lód morski tylko w zimnie (próg niżej niż śnieg lądu — białe jeziora w umiarkowanych szerokościach wyglądały na naklejki)
      const seaIce = clamp(inv(-0.12, -0.02, iceT).mul(mix(0.55, 1.0, floe)).mul(mix(0.85, 1.0, smoothstep(-0.2, 0.2, nM))), 0.0, 1.0).toVar();
      const isLand = smoothstep(-0.02, 0.02, h);
      // ALFA NA LĄDZIE = WYSOKOŚĆ KORON (× EARTH_CANOPY_KM): graf rzeźby dodaje ją do wysokości, więc materiał liczy
      // światło i cień także od lasu — skraj lasu rzuca cień na torfowisko, korony mają fakturę (jak cieniowanie
      // mapy terenu). Z daleka bez znaczenia (20 m na tekselu wielu kilometrów). Na morzu alfa to dalej lód.
      const canopyM = forest.mul(float(1.0).sub(rocky.mul(0.85))).mul(float(1.0).sub(clamp(snow, 0.0, 1.0)))
        .mul(mix(float(17.0), float(27.0), stand)).mul(crownsH).add(fenRim.mul(smoothstep(0.36, 0.48, Mv)).mul(treeT).mul(5.0))
        .mul(float(1.0).sub(clamp(water, 0.0, 1.0)));
      const alpha = mix(seaIce, clamp(canopyM.div(EARTH_CANOPY_KM * 1000), 0.0, 1.0), step(0.0, h));
      return vec4(mix(mix(land, U.uIce, seaIce), land, isLand), alpha);
    })();
    return { U, material: bakeMaterial(`PlanetGenDay_${type}`, node) };
  };
}
/** Wysokość koron: alfa mapy dnia na lądzie × tyle [km] (graf rzeźby — planetGenBake.tsl.js, `uRel.w`). */
export const EARTH_CANOPY_KM = 0.12;
// Grzbiety gór: częstość pierwszej oktawy = `look.mountainFreq` × tyle. Przy samej `mountainFreq` (2–3,4) pierwsza
// oktawa szumu grzbietowego była kopułą szeroką na ~20° — pasmo wychodziło płaskowyżem w całości nad linią śniegu;
// przy × 3,5 grzbiet miał wciąż ~570 km (stoki ~5%) i śnieg zlewał się w pole. × 12: grzbiety co ~150 km, ściany
// o nachyleniu kilkudziesięciu procent — skała na ścianach, śnieg na grzbietach.
const EARTH_RIDGE_FREQ = 12;
// Barwy krajobrazu z palet mapy terenu (sRGB 0–255 → liniowe) dla roślinności planety: [klimat chłodny, ciepły].
const lin255 = (c) => c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
function landscapeUniforms(L) {
  const [a, b] = (PLANET_VEGETATION[L.vegetation] || PLANET_VEGETATION.zielona).map(terrainLandscape);
  const W = TERRAIN_WATER;
  // odcień: barwy palety mapy terenu przesunięte lekko (stosunek^0,25, w granicach 0,8–1,25) ku barwie lasu TEJ planety —
  // torfowiska i łęgi zostają w rodzinie barw planety (tak samo mapa terenu dostaje odcień planety, planetGenPlace.js)
  const tint = (pal, forestPlanet) => {
    const f = lin255(pal.forest);
    const k = f.map((v, i) => Math.min(1.25, Math.max(0.8, Math.pow((forestPlanet[i] + 0.004) / (v + 0.004), 0.25))));
    return (c) => lin255(c).map((v, i) => v * k[i]);
  };
  const ta = tint(a, L.palette.taiga);
  const tb = tint(b, L.palette.rain);
  return {
    // z, w — udział kęp drugiego gatunku (0 — paleta bez kęp); barwa kęp bez odcienia planety (ma odstawać od lasu)
    uK3: [a.fenAmount, b.fenAmount, a.accent ? 1 : 0, b.accent ? 1 : 0],
    uAccentA: lin255(a.accent || a.forest), uAccentB: lin255(b.accent || b.forest),
    uFenA: ta(a.fen), uFenB: tb(b.fen), uFenWetA: ta(a.fenWet), uFenWetB: tb(b.fenWet),
    uGrassA: ta(a.grass), uGrassB: tb(b.grass), uMeadowA: ta(a.meadow), uMeadowB: tb(b.meadow),
    uWDark: lin255(W.dark), uWMud: lin255(W.mud), uWIce: lin255(W.ice), uSilt: lin255(W.silt), uSandB: lin255(W.sand)
  };
}
function earthUniforms(spec, ctx) {
  const L = spec.look;
  const rng = rngFor(spec.seed, `${spec.type}:łańcuchy`);
  const ocean = spec.type === 'ocean';
  const field = {
    uE1: [L.plateFreq, L.contFreq, L.contWarp, L.coast],
    // (częstość grzbietów × EARTH_RIDGE_FREQ: pierwsza oktawa to grzbiety pasma, nie kopuła wielkości kontynentu)
    uE2: [L.mountainKm, L.mountainFreq * EARTH_RIDGE_FREQ, L.border, L.hillKm],
    uE3: [L.oceanKm, L.ridgeKm, L.islands, Math.min(0.9, (1 - L.water) * 1.25 + 0.05)],
    uE4: [0, 0, 0, 0],
    uK: [L.temp, L.wet, L.axisTilt, 0]
  };
  if (ocean) {
    Object.assign(field, emptySlots('uChain'));
    for (let i = 0; i < Math.min(SLOT_CAP, L.chains); i++) {
      const s0 = rng.dirInLat(-50, 50);
      // oś koła wielkiego prostopadła do s0 (losowy kierunek łańcucha)
      const r = rng.dir();
      const dot = r[0] * s0[0] + r[1] * s0[1] + r[2] * s0[2];
      const n = [r[0] - s0[0] * dot, r[1] - s0[1] * dot, r[2] - s0[2] * dot];
      field[`uChain${i}`] = [...s0, rng.range(0.25, 0.7)];
      field[`uChain${i}b`] = [...n, rng.range(0, 1000)];
    }
  }
  const P = L.palette;
  const color = {
    uK: [L.temp, L.wet, L.axisTilt, pgOctavesFor(ctx.size, 110, 2.03, 3, 12)],
    uK2: [pgOctavesFor(ctx.size, 46, 2.03, 6, 12), pgOctavesFor(ctx.size, 140, 2.1, 6, 8), pgOctavesFor(ctx.size, 30, 2.03, 5, 13), 0],
    ...landscapeUniforms(L),
    uRain: P.rain, uForest: P.forest, uTaiga: P.taiga, uSteppe: P.steppe, uTundra: P.tundra, uDesert: P.desert, uDesertRed: P.desertRed,
    uRock: P.rock, uSnow: P.snow, uIce: P.ice, uShallow: P.shallow, uOcean: P.ocean, uDeep: P.deep
  };
  return {
    // drainage: rzeki ze spływu (wypiekacz liczy drzewo rzek z pola i opadu — przejście `drain`, uniformy jak barwy)
    field, color, drainage: true, probeQ: [L.water, 0.1, 0.5, 0.9], water: true, landTop: L.mountainKm * 0.6,
    // sufity ponad mapy planety (≤ 4096 px ich nie sięgają) — dla wycinków pod kamerą
    octaves: { x: pgOctavesFor(ctx.size, 1.4 * 2.7, 2.03, 3, 16), y: pgOctavesFor(ctx.size, 6.5, 2.0, 3, 14), z: pgOctavesFor(ctx.size, L.mountainFreq * EARTH_RIDGE_FREQ, 2.07, 3, 15), w: 6 },
    spec: [0, 0, 0, 0],   // morze — w shaderze (planetGenSurface.tsl.js)
    civ: { landOnly: 1, latDeg: 48, sea: ocean ? 0.6 : 0, habW: 0, freq: 26, gain: 1 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DESERT — pole: y — jeziora solanki, z — wydmy (morza piasku), w — kontynentalność (progi: wydmy uQ.x, sól uQ.y)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function desertField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), uD1: 'vec4', uD2: 'vec4', uD3: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const P = plates(ps, U.uD1.x, U.uD1.y, U.uD1.z, float(0.6), float(0.5), U.uOct.x);
    const d = P.c.sub(U.uQ.z).toVar();
    const belt = mix(smoothstep(0.08, 0.5, pgFbm(P.q.mul(2.1).add(vec3(5.3, 1.7, 9.1)), 4)),
      inv(0.0, 0.2, P.border).mul(smoothstep(0.35, 0.55, P.conv)), U.uD2.z).toVar();
    const ridge = pgRidged(P.q.mul(U.uD2.y), U.uOct.z, 2.07, 0.55, 1.0, 2.2).toVar();
    const h = d.mul(2.2).add(ridge.mul(belt).mul(U.uD2.x)).add(pgErodedFbm(P.q.mul(6.0), U.uOct.y, 1.6).mul(U.uD2.w)).toVar();
    // płaskowyże: tarasy na wyżynach (stopnie co ~0,55 km z miękką krawędzią — klify mes)
    If(U.uD1.w.greaterThan(0.01), () => {
      const stepKm = float(0.55);
      const t = h.div(stepKm);
      const terr = floor(t).add(smoothstep(0.6, 0.9, fract(t))).mul(stepKm);
      h.assign(mix(h, terr, U.uD1.w.mul(smoothstep(0.0, 0.35, d)).mul(inv(0.3, 0.7, belt.mul(ridge)))));
    });
    // morza wydm w nieckach: pasma wydm poprzecznych do wiatru (wydłużone N–S, skręt), dwie skale
    const erg = inv(U.uQ.x.sub(0.05), U.uQ.x.add(0.05), P.c).toVar();
    const dune = float(0.0).toVar();
    If(erg.greaterThan(0.001), () => {
      const tw = U.uD3.y;
      const qd = vec3(P.q.x.add(P.q.y.mul(tw)), P.q.y, P.q.z.sub(P.q.y.mul(tw.mul(0.6)))).toVar();
      const fq = U.uD3.x;
      const big = pgRidged(qd.mul(vec3(fq, fq.mul(0.16), fq)).add(P.wq.mul(3.0)), 3, 2.0, 0.5, 1.0, 2.0);
      const small = pgRidged(qd.mul(vec3(fq.mul(2.6), fq.mul(0.6), fq.mul(2.6))).add(vec3(7.1, 3.3, 1.9)), 2, 2.0, 0.5, 1.0, 2.0);
      dune.assign(big.mul(0.7).add(small.mul(0.3)));
      h.addAssign(dune.mul(erg).mul(0.16));
    });
    // solniska i jeziora solanki w najniższych nieckach (płasko)
    const salt = inv(U.uQ.y.sub(0.025), U.uQ.y.add(0.025), P.c).toVar();
    const flatH = U.uQ.y.sub(U.uQ.z).mul(2.2);
    h.assign(mix(h, flatH.sub(0.02), salt.mul(0.95)));
    // stare kratery (rzadkie)
    const cr = craterSum(U, C, ps);
    h.addAssign(cr.h.mul(float(1.0).sub(erg.mul(0.8))));
    return vec4(h, salt.mul(U.uD3.w), erg.mul(dune.mul(0.6).add(0.4)), P.c);
  })();
  return { U, material: bakeMaterial('PlanetGenField_desert', node) };
}
const DESERT_COLOR_DEFS = { ...COMMON_DEFS, uDk: 'vec4', uSand: 'vec3', uSandDark: 'vec3', uRock: 'vec3', uSalt: 'vec3', uIce: 'vec3', uBrine: 'vec3' };
function desertColor(F) {
  const U = bakeUniforms(DESERT_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const h = f.x;
    const sl = slopeAt(F, U, C);
    const curv = curvatureAt(F, U, C, h);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const n1 = pgFbm(ps.mul(3.0), 5).toVar();
    const n2 = pgFbm(ps.mul(18.0), 4).toVar();
    // skała: warstwy (barwa zmienia się z wysokością — pasma osadów na stokach mes i gór)
    // warstwy osadów widać tylko na stokach (na płaskim — warstwice jak na mapie)
    const strata = sin(h.mul(5.5).add(n1.mul(2.0))).mul(0.5).add(0.5).mul(smoothstep(0.1, 0.3, sl.s));
    const rock = mix(U.uRock, U.uRock.mul(vec3(1.22, 1.12, 1.0)), strata.mul(0.6)).mul(float(1.0).add(n2.mul(0.15))).toVar();
    // równiny: żwir i pył (między skałą a piaskiem), piasek w morzach wydm (grzbiety jaśniejsze)
    const plain = mix(U.uSandDark, U.uRock, smoothstep(-0.2, 0.4, n1)).mul(float(1.0).add(n2.mul(0.1)));
    const col = mix(plain, rock, smoothstep(0.08, 0.3, sl.s).max(smoothstep(0.4, 2.5, h.sub(U.uDk.x)).mul(0.6))).toVar();
    const sand = mix(U.uSandDark, U.uSand, smoothstep(0.35, 0.85, f.z)).mul(float(1.0).add(n2.mul(0.06)));
    const ergW = smoothstep(0.25, 0.5, f.z);
    col.assign(mix(col, sand, ergW));
    // smugi wiatru (jasne za przeszkodami — wzdłuż równoleżników)
    const streak = pgFbm(vec3(C.dir.x, C.dir.y.mul(8.0), C.dir.z).mul(9.0).add(U.uSeed.xyz), 4);
    col.mulAssign(float(1.0).add(streak.mul(0.08)));
    // suche koryta: doliny (krzywizna) ciemniejsze
    col.mulAssign(float(1.0).sub(smoothstep(0.012, 0.08, curv.negate()).mul(0.15).mul(U.uDk.y)));
    // sól i solanka
    const salt = smoothstep(0.02, 0.4, f.y.add(inv(U.uQ.y.sub(0.01), U.uQ.y.add(0.03), f.w).mul(0.8)));
    col.assign(mix(col, U.uSalt.mul(float(1.0).add(n2.mul(0.08))), clamp(salt, 0.0, 1.0)));
    col.assign(mix(col, U.uBrine, smoothstep(0.6, 0.95, f.y)));
    // czapy lodowe (małe; z szerokości)
    const cap = smoothstep(U.uDk.z, U.uDk.z.add(4.0), abs(C.lat).mul(180 / PI).add(n1.mul(3.0)));
    col.assign(mix(col, U.uIce, cap));
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_desert', node) };
}
function desertUniforms(spec, ctx) {
  const L = spec.look;
  const P = L.palette;
  const saltFrac = Math.max(0.004, L.water || L.salt * 0.03);
  return {
    field: {
      uD1: [L.plateFreq, L.contFreq, L.contWarp, L.mesa],
      uD2: [L.mountainKm, L.mountainFreq, L.border, L.hillKm],
      uD3: [L.duneFreq, L.duneTurn, 0, L.water > 0 ? 1 : 0],
      ...craterRecords(ctx, { density: L.craters * 0.5, f0: 5, fresh: 0.02, raysTo: 0, falloff: 0.7 })
    },
    color: {
      uDk: [0.6, L.wadi, 86 - (L.erg * 6), 0],
      uSand: P.sand, uSandDark: P.sandDark, uRock: P.rock, uSalt: P.salt, uIce: P.ice, uBrine: [0.02, 0.05, 0.06]
    },
    probeQ: [L.erg, saltFrac, 0.5, 0.9], water: false, landTop: L.mountainKm * 0.6,
    octaves: { x: pgOctavesFor(ctx.size, 2.7 * L.contFreq, 2.03, 3, 9), y: pgOctavesFor(ctx.size, 6, 2.0, 3, 8), z: pgOctavesFor(ctx.size, L.mountainFreq, 2.07, 3, 9), w: 6 },
    spec: [0, 0, L.water > 0 ? 0.9 : 0, 0],
    civ: { landOnly: 1, latDeg: 40, sea: 0, habW: 0, freq: 24, gain: 0.9 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ROCKY — jak Mars: pole: z — ciemne pola bazaltu / zbocza wulkanów, w — dychotomia + rzeźba
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function rockyField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), ...slotDefs('uVol'), uRd: 'vec4', uR1: 'vec4', uR2: 'vec4', uCan: 'vec4', uCanB: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(0.9), 3, 0.35).toVar();
    const q = ps.add(wq).toVar();
    // dychotomia półkul (wyżyny kraterowe ↔ gładkie niziny), granica pofalowana
    const dich = smoothstep(-0.32, 0.32, dot(C.dir, normalize(U.uRd.xyz)).add(pgFbm(q.mul(1.3), 4).mul(0.4))).toVar();
    const base = pgFbm(q.mul(2.0), U.uOct.x).toVar();
    const h = dich.mul(U.uRd.w).add(base.mul(1.1)).add(pgErodedFbm(q.mul(5.5), U.uOct.y, 1.5).mul(U.uR1.y)).toVar();
    h.addAssign(pgRidged(q.mul(3.1), U.uOct.z, 2.07, 0.55, 1.0, 2.0).mul(U.uR1.x).mul(smoothstep(0.1, 0.5, pgFbm(q.mul(1.7).add(4.0), 3))));
    // wulkany tarczowe z wypiętrzeniem wokół (Tharsis)
    const flank = float(0.0).toVar();
    for (let i = 0; i < SLOT_CAP; i++) {
      const a = U[`uVol${i}`];
      const b = U[`uVol${i}b`];
      If(a.w.greaterThan(0.0), () => {
        const V = volcanoProfile(C.dir, a, b);
        h.addAssign(V.h);
        h.addAssign(exp(V.r.mul(V.r).mul(-0.12)).mul(b.z));
        flank.assign(max(flank, V.flank));
      });
    }
    // kanion: rów wzdłuż łuku koła wielkiego, z odgałęzieniami (grzbiety szumu), dno nieregularne
    If(U.uCan.w.greaterThan(0.0), () => {
      const s0 = normalize(U.uCan.xyz);
      const n = normalize(U.uCanB.xyz);
      const t2 = cross(n, s0);
      const perp = asin(clamp(dot(C.dir, n), -1.0, 1.0)).add(pgFbm(q.mul(9.0), 3).mul(0.012)).toVar();
      const ang = atan(dot(C.dir, t2), dot(C.dir, s0));
      const along = smoothstep(-0.05, 0.12, ang).mul(inv(U.uCan.w.sub(0.15), U.uCan.w, ang));
      const w = U.uCanB.w.mul(float(0.7).add(pgFbm(q.mul(4.0), 3).mul(0.6)));
      const main = inv(w.mul(0.4), w, abs(perp));
      const branch = smoothstep(0.82, 0.95, pgRidged(q.mul(14.0), 2, 2.0, 0.5, 1.0, 2.0)).mul(inv(w, w.mul(3.5), abs(perp)));
      h.subAssign(max(main, branch.mul(0.6)).mul(along).mul(6.5));
    });
    // kratery: rzadziej na nizinach (odnowiona powierzchnia)
    const lowland = float(1.0).sub(dich).toVar();
    const cr = craterSum(U, C, ps, lowland, 0);
    h.addAssign(cr.h);
    return vec4(h, 0.0, flank, dich.add(base.mul(0.3)));
  })();
  return { U, material: bakeMaterial('PlanetGenField_rocky', node) };
}
const ROCKY_COLOR_DEFS = { ...COMMON_DEFS, uRc: 'vec4', uDust: 'vec3', uBasalt: 'vec3', uBright: 'vec3', uDark: 'vec3', uIce: 'vec3' };
function rockyColor(F) {
  const U = bakeUniforms(ROCKY_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const h = f.x;
    const sl = slopeAt(F, U, C);
    const curv = curvatureAt(F, U, C, h);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.6), 3, 0.5).toVar();
    // plamy albedo (jak Syrtis Major): ciemny bazalt ↔ jasny pył, brzegi rozmyte z ostrzejszymi jęzorami
    const A = pgFbm(ps.mul(2.3).add(wq), 6).toVar();
    const dark = smoothstep(U.uRc.x.sub(0.06), U.uRc.x.add(0.1), A).toVar();
    const n2 = pgFbm(ps.mul(16.0), 4).toVar();
    const n3 = pgFbm(ps.mul(42.0), 3).toVar();
    const col = mix(U.uDust, U.uBright, smoothstep(0.1, 0.6, n2.mul(0.5).add(A.negate().mul(0.6)))).toVar();
    col.assign(mix(col, U.uBasalt, dark.mul(0.85)));
    // smugi wiatru za kraterami i grzbietami (ciemne / jasne, wzdłuż równoleżników)
    const streak = pgFbm(vec3(C.dir.x, C.dir.y.mul(6.0), C.dir.z).mul(11.0).add(wq), 4);
    col.mulAssign(float(1.0).add(streak.mul(0.1)).add(n3.mul(0.06)));
    // doliny i dna kraterów — ciemny piasek; stoki — jaśniejsza skała; zbocza wulkanów — bazalt
    // dna dolin i kraterów — ciemny piasek (miękko: ostry próg krzywizny rysował 1-tekselowe schodkowe obwódki)
    col.assign(mix(col, U.uDark, smoothstep(0.015, 0.09, curv.negate()).mul(0.25)));
    col.assign(mix(col, U.uBright.mul(0.85), smoothstep(0.15, 0.4, sl.s).mul(0.35)));
    col.assign(mix(col, U.uBasalt.mul(0.9), f.z.mul(0.5)));
    // czapy polarne: lód z ciemnymi rowami spiralnymi (osady warstwowe)
    const latD = abs(C.lat).mul(180 / PI);
    const capEdge = float(90.0).sub(U.uRc.y).add(n2.mul(2.0)).add(A.mul(2.5));
    const cap = smoothstep(capEdge, capEdge.add(1.5), latD).toVar();
    If(cap.greaterThan(0.001), () => {
      const lon = C.u.mul(2 * PI);
      const rho = float(90.0).sub(latD);
      const spiral = sin(lon.mul(2.0).add(rho.mul(1.9)).add(A.mul(3.0))).mul(0.5).add(0.5);
      const ice = mix(U.uIce, U.uIce.mul(vec3(0.82, 0.78, 0.74)), smoothstep(0.8, 0.95, spiral).mul(0.6));
      col.assign(mix(col, ice, cap));
    });
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_rocky', node) };
}
function rockyUniforms(spec, ctx) {
  const L = spec.look;
  const rng = rngFor(spec.seed, 'rocky:wulkany');
  const field = {
    uRd: [...L.dichotomyDir, L.dichotomyKm], uR1: [L.mountainKm, L.hillKm, 0, 0], uR2: [0, 0, 0, 0],
    ...craterRecords(ctx, { density: L.craters, f0: 4, fresh: 0.04, mareDamp: 0.45, raysTo: 1, falloff: 0.95 }),
    ...emptySlots('uVol')
  };
  // stare kratery zatarte — wiek przesuwa pierwszą oktawę (craterAge: mniejsza świeżość, płycej przez gęstość)
  const center = rng.dirInLat(-25, 25);
  for (let i = 0; i < Math.min(SLOT_CAP, L.volcanoes); i++) {
    const d = i === 0 ? center : rng.dirInLat(-35, 35);
    const big = i === 0 ? 1.4 : 1;
    field[`uVol${i}`] = [...d, rng.range(0.07, 0.13) * big];
    field[`uVol${i}b`] = [rng.range(8, 20) * big * Math.sqrt(3400 / spec.rKm), 1, i === 0 ? rng.range(2, 5) : 0, 0];
  }
  if (L.canyon > 0) {
    const s0 = rng.dirInLat(-15, 15);
    const r = [0, 1, 0];
    const dot = r[1] * s0[1];
    const n = [-s0[0] * dot, 1 - s0[1] * dot, -s0[2] * dot];
    field.uCan = [...s0, 0.6 + L.canyon * 0.9];
    field.uCanB = [...n, rng.range(0.008, 0.016)];
  } else { field.uCan = [0, 1, 0, 0]; field.uCanB = [0, 0, 1, 0.01]; }
  const P = L.palette;
  return {
    field,
    color: { uRc: [0.35 - L.darkFrac * 0.9, L.capDeg, 0, 0], uDust: P.dust, uBasalt: P.basalt, uBright: P.bright, uDark: P.dark, uIce: P.ice },
    probeQ: [0.3, 0.1, 0.5, 0.9], water: false, landTop: 6,
    octaves: { x: pgOctavesFor(ctx.size, 2.0, 2.03, 3, 9), y: pgOctavesFor(ctx.size, 5.5, 2.0, 3, 8), z: pgOctavesFor(ctx.size, 3.1, 2.07, 3, 8), w: 6 },
    spec: [0, 0, 0, 0],
    civ: { landOnly: 0, latDeg: 45, sea: 0, habW: 0, freq: 30, gain: 0.8 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ICE — pole: z — linie (lineae: ciemne pasma z jasnym grzbietem w środku), w — c (progi: morza lodu uQ.x)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function iceField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), uI1: 'vec4', uI2: 'vec4', uI3: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.2), 3, 0.4).toVar();
    const q = ps.add(wq).toVar();
    const c = pgFbm(q.mul(1.6), U.uOct.x).toVar();
    const h = c.mul(0.5).toVar();
    // śnieżka: góry spod lodu (lądy nad progiem), gładkie zamarznięte morza pod progiem
    If(U.uI2.z.greaterThan(0.01), () => {
      const land = smoothstep(U.uQ.x.sub(0.02), U.uQ.x.add(0.08), c);
      const ridge = pgRidged(q.mul(3.2), U.uOct.z, 2.07, 0.55, 1.0, 2.2);
      h.addAssign(land.mul(ridge.mul(U.uI3.x).add(c.sub(U.uQ.x).mul(2.0))));
      h.assign(mix(h, U.uQ.x.mul(0.5).sub(0.2), inv(U.uQ.y.sub(0.02), U.uQ.y.add(0.02), c).mul(0.9)));
    });
    // bruzdy (Ganimedes): wieloboki jasnego terenu z równoległymi grzbietami (kierunek z haszu komórki)
    If(U.uI1.z.greaterThan(0.01), () => {
      const cell = pgCells(q.mul(4.5), 0.9).toVar();
      const light = step(cell.z, U.uI1.z.mul(0.7));
      // kierunek bruzd z haszu komórki
      const ax = normalize(vec3(fract(cell.z.mul(127.1)), fract(cell.z.mul(311.7)), fract(cell.z.mul(74.7))).sub(0.5));
      const gr = sin(dot(q, ax).mul(160.0).add(pgFbm(q.mul(20.0), 2).mul(2.0))).mul(0.5).add(0.5);
      h.addAssign(light.mul(gr.mul(0.25)).mul(smoothstep(0.0, 0.06, cell.y.sub(cell.x))));
    });
    // LINIE: łuki kół MAŁYCH (promień kątowy 25–85° — krzywizna jak cykloidy i pasma Europy) z haszu: środek
    // koła, promień, środek łuku, długość, szerokość, wiek — ciemne rdzawe obrzeże z jaśniejszym grzbietem w środku
    // (grzbiet w rzeźbie); szerokość i jasność zmieniają się wzdłuż łuku
    const lin = float(0.0).toVar();
    const dirW = normalize(C.dir.add(wq.mul(0.02))).toVar();
    const count = int(U.uI3.y);
    Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'li' }, ({ li }) => {
      const hh = pgHashU(ivec3(li, int(U.uSeed.w), int(91))).toVar();
      const ctr = normalize(pgU3(hh).mul(2.0).sub(1.0)).toVar();
      const g = pgRehash(hh).toVar();
      const g2 = pgRehash(g).toVar();
      const g3 = pgRehash(g2).toVar();
      const R = mix(0.45, 1.5, pgU1(g)).toVar();
      const wid = mix(0.0025, 0.009, pgU3(g2).y).toVar();
      const age = pgU3(g2).z;
      const rho = angDist(dirW, ctr).toVar();
      const dist = abs(rho.sub(R));
      If(dist.lessThan(wid.mul(4.0)), () => {
        const ref = normalize(cross(ctr, pgU3(g3).mul(2.0).sub(1.0)));
        const ref2 = cross(ctr, ref);
        const ang = atan(dot(dirW, ref2), dot(dirW, ref));
        const len = mix(0.4, 2.6, pgU3(g2).x);
        const a0 = pgU1(g3).mul(6.2831);
        const da = abs(fract(ang.sub(a0).div(6.2831).add(0.5)).sub(0.5)).mul(6.2831);
        const env = inv(len.mul(0.6), len, da).mul(sin(ang.mul(7.0).add(a0)).mul(0.25).add(0.75));
        const ww = wid.mul(sin(ang.mul(3.0).add(a0.mul(2.0))).mul(0.3).add(1.0));
        const band = exp(dist.div(ww.mul(1.5)).pow2().negate());
        lin.assign(max(lin, band.mul(env).mul(mix(1.0, 0.3, age))));
        h.addAssign(exp(dist.div(ww.mul(0.35)).pow2().negate()).mul(env).mul(0.15));
      });
    });
    lin.mulAssign(U.uI1.x);
    // pręgi (Enceladus): 4–5 równoległych łuków przy biegunie
    If(U.uI2.x.greaterThan(0.01), () => {
      const pole = vec3(0.0, U.uI2.y, 0.0);
      const rho = angDist(C.dir, pole).add(pgFbm(q.mul(6.0), 3).mul(0.012));
      const lon = atan(C.dir.z, C.dir.x);
      const k = floor(rho.div(0.055).add(0.5));
      const dk = abs(rho.sub(k.mul(0.055)));
      const on = step(1.5, k).mul(step(k, 5.5)).mul(inv(0.9, 1.4, abs(lon.sub(0.4))));
      const stripe = exp(dk.div(0.006).pow2().negate()).mul(on).mul(U.uI2.x);
      lin.assign(max(lin, stripe));
      h.subAssign(stripe.mul(0.3));
    });
    const cr = craterSum(U, C, ps);
    h.addAssign(cr.h);
    return vec4(h, 0.0, clamp(lin, 0.0, 1.0), c);
  })();
  return { U, material: bakeMaterial('PlanetGenField_ice', node) };
}
const ICE_COLOR_DEFS = { ...COMMON_DEFS, uIc: 'vec4', uIc2: 'vec4', uIceC: 'vec3', uIceBlue: 'vec3', uLin: 'vec3', uDarkT: 'vec3', uRockC: 'vec3', uFrost: 'vec3' };
function iceColor(F) {
  const U = bakeUniforms(ICE_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const h = f.x;
    const sl = slopeAt(F, U, C);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.2), 3, 0.4).toVar();
    const q = ps.add(wq).toVar();
    const n1 = pgFbm(ps.mul(3.5), 5).toVar();
    const n2 = pgFbm(ps.mul(20.0), 4).toVar();
    const col = U.uIceC.mul(float(1.0).add(n1.mul(0.08)).add(n2.mul(0.05))).toVar();
    // ciemny teren (stary, kraterowy) w wielobokach — Ganimedes
    If(U.uIc.w.greaterThan(0.01), () => {
      const cell = pgCells(q.mul(4.5), 0.9).toVar();
      const darkT = step(U.uIc.z.mul(0.7), cell.z).mul(U.uIc.w.mul(1.6)).min(1.0);
      col.assign(mix(col, U.uDarkT.mul(float(1.0).add(n2.mul(0.15))), darkT));
    });
    // teren chaosu: plamy rdzawe z jasnymi blokami
    If(U.uIc.y.greaterThan(0.01), () => {
      const region = smoothstep(0.55, 0.75, pgFbm(q.mul(2.6).add(9.0), 4).mul(0.5).add(0.5).add(U.uIc.y.mul(0.35)));
      // bloki: komórki różnej jasności (płyty skorupy) w rdzawej macierzy, szwy ciemne
      const blocks = pgCells(q.mul(55.0), 0.9).toVar();
      const blk = smoothstep(0.02, 0.09, blocks.y.sub(blocks.x)).mul(blocks.z.mul(0.6).add(0.4));
      const chaos = mix(U.uLin.mul(0.9), mix(U.uLin.mul(1.3), U.uIceC.mul(0.85), blocks.z), blk);
      col.assign(mix(col, chaos, region));
    });
    // linie: ciemne rdzawe obrzeża, jaśniejszy środek
    col.assign(mix(col, U.uLin, f.z.mul(0.85)));
    // śnieżka: odsłonięta skała na stromiznach i wysoko, zamarznięte morza gładkie i niebieskawe
    If(U.uIc2.x.greaterThan(0.01), () => {
      const exposed = smoothstep(0.18, 0.45, sl.s).mul(smoothstep(0.5, 2.0, h));
      col.assign(mix(col, U.uRockC.mul(float(1.0).add(n2.mul(0.2))), exposed.mul(U.uIc2.x.add(0.3)).min(0.9)));
      const sea = inv(U.uQ.y.sub(0.02), U.uQ.y.add(0.02), f.w);
      col.assign(mix(col, U.uIceBlue.mul(float(1.0).add(n1.mul(0.06))), sea.mul(0.85)));
    });
    // szron polarny i jasne świeże stoki
    col.assign(mix(col, U.uFrost, smoothstep(55.0, 80.0, abs(C.lat).mul(180 / PI).add(n1.mul(8.0))).mul(0.6)));
    col.mulAssign(float(1.0).add(smoothstep(0.1, 0.35, sl.s).mul(0.12)));
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_ice', node) };
}
function iceUniforms(spec, ctx) {
  const L = spec.look;
  const P = L.palette;
  return {
    field: {
      uI1: [L.lineae, L.chaos, L.grooves, L.darkTerrain], uI2: [L.stripes, L.stripeLat, L.rock, L.seas],
      uI3: [L.mountainKm, Math.round(LINEAE_CAP * L.lineae), 0, 0],
      ...craterRecords(ctx, { density: L.craters, f0: 8, fresh: 0.12, raysTo: 1, falloff: 0.95 })
    },
    color: { uIc: [0, L.chaos, L.grooves, L.darkTerrain], uIc2: [L.rock, L.seas, 0, 0],
      uIceC: P.ice, uIceBlue: P.iceBlue, uLin: P.lineae, uDarkT: P.dark, uRockC: P.rock, uFrost: P.frost },
    probeQ: [1 - L.rock, L.seas, 0.5, 0.9], water: false, landTop: 3,
    octaves: { x: pgOctavesFor(ctx.size, 1.6, 2.03, 3, 9), y: 4, z: pgOctavesFor(ctx.size, 3.2, 2.07, 3, 8), w: 6 },
    spec: [0, 0.22, 0, 0],
    civ: { landOnly: 0, latDeg: 60, sea: 0, habW: 0, freq: 30, gain: 0.8 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// VOLCANIC — pole: y — lawa (żar, połysk), z — osady / kaldery, w — c (próg mórz lawy uQ.x)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Miejsca (wulkany, kaldery) w kracie komórek: pętla po 27 sąsiednich komórkach, każde miejsce dokłada SWÓJ profil —
// wynik ciągły na granicach komórek. (Dawny wzór „hasz najbliższej komórki × profil odległości” urywał stożek, potok
// i pierścień opadu na krawędzi komórki — z orbity niewidoczne, z bliska uskoki i wielokąty.) Profil miejsca musi
// gasnąć do zera w promieniu 1 komórki. `fn({ dv — od miejsca do punktu [komórki], u — los obecności 0…1, a — trzy
// losy miejsca 0…1 })`. Wklejana; nazwy zmiennych pętli różne dla każdego wywołania.
let siteLoopId = 0;
function forSites(pp, salt, fn) {
  const id = siteLoopId++;
  const ip = ivec3(floor(pp)).toVar();
  const fp = fract(pp).toVar();
  const nx = `sx${id}`;
  const ny = `sy${id}`;
  const nz = `sz${id}`;
  Loop(
    { start: -1, end: 1, condition: '<=', name: nz },
    { start: -1, end: 1, condition: '<=', name: ny },
    { start: -1, end: 1, condition: '<=', name: nx },
    (it) => {
      const c = ivec3(it[nx], it[ny], it[nz]).toVar();
      const h = pgHashU(ip.add(c).add(ivec3(salt * 37, salt * 101 + 7, salt * 13 + 3))).toVar();
      const h2 = pgRehash(h).toVar();
      const o = pgU3(h2).mul(0.7).add(0.15);
      const dv = fp.sub(vec3(c)).sub(o).toVar();
      fn({ dv, u: pgU1(h), a: pgU3(pgRehash(h2)) });
    }
  );
}
const hash1 = (x) => fract(sin(x).mul(43758.5453));

// Warstwa wulkanów jednej skali. `o`: freq — komórek na radian, dens (węzeł) — udział komórek z wulkanem, rMin / rMax —
// promień podstawy [komórki], hKm — wysokość największego [km], gate (węzeł 0…1) — warstwa widoczna w tej
// rozdzielczości, streams — strugi lawy po stoku, shield — tarcza (łagodna, szeroka) zamiast stożka.
// Styl siarki (`io` = 1): w miejscu stożka KALDERA (patera) — nieregularna niecka o stromych ścianach z ciemnym dnem,
// jeziorem lawy i płatami potoków wokół; duże — z pierścieniem opadu pióropusza.
function volcanoLayer(S, o) {
  const { q, U, io, t1, t2, h, lava, dep } = S;
  const pp = q.mul(o.freq).toVar();
  // nieregularność obrysu i płaty potoków — szum liczony raz na warstwę (wspólny dla miejsc: ciągły)
  const nIrr = pgNoise(pp.mul(2.3).add(vec3(3.7, -1.1, 5.9))).toVar();
  const lobes = pgFbm(pp.mul(4.2).add(vec3(-2.3, 8.1, 0.7)), 3).mul(0.5).add(0.5).toVar();
  forSites(pp, o.salt, ({ dv, u, a }) => {
    const rad = mix(float(o.rMin), float(o.rMax), a.x).toVar();
    const dist = length(dv).toVar();
    If(u.lessThan(o.dens).and(dist.lessThan(0.98)).and(o.gate.greaterThan(0.002)), () => {
      // wszystko gaśnie przed 1 komórką
      const fade = inv(0.86, 0.98, dist).mul(o.gate).toVar();
      const r = dist.div(rad).toVar();
      const th = atan(dot(dv, t2), dot(dv, t1).add(1e-7)).toVar();
      const active = step(fract(a.x.mul(57.3)), U.uV1.z.mul(0.7).add(0.3)).toVar();
      const size = rad.div(o.rMax);
      If(io.greaterThan(0.5), () => {
        // ── patera ──
        const pr = float(o.shield ? 0.2 : 0.42).mul(rad).toVar();        // promień niecki [komórki]
        const rn = dist.div(pr).mul(nIrr.mul(0.24).add(1.0)).toVar();
        const pit = inv(0.82, 1.0, rn);
        h.subAssign(pit.mul(o.hKm * 0.1).mul(size.mul(0.6).add(0.4)).mul(fade));
        dep.assign(max(dep, pit.mul(0.6).mul(fade)));
        // jezioro: większa część dna (od strony losowego kierunku zostaje sierp ciemnego dna)
        const side = cos(th.sub(a.y.mul(6.2832))).mul(0.5).add(0.5);
        const lake = inv(0.5, 0.84, rn).mul(smoothstep(0.05, 0.4, side.add(a.z.mul(0.8)))).mul(active);
        lava.assign(max(lava, lake.mul(fade)));
        // potoki: płaty wokół niecki
        const fl = inv(1.0, 3.4, rn).mul(smoothstep(0.42, 0.68, lobes)).mul(U.uV1.y).mul(fade).toVar();
        dep.assign(max(dep, fl.mul(0.8)));
        lava.assign(max(lava, fl.mul(active).mul(U.uV1.z).mul(inv(1.0, 2.2, rn)).mul(0.7)));
        // pierścień opadu pióropusza (duże, część)
        if (o.shield) {
          const ringR = mix(0.5, 0.74, a.y);
          const rw = dist.sub(ringR).div(0.07);
          const ring = exp(rw.mul(rw).negate()).mul(step(0.55, a.z)).mul(U.uV1.w).mul(nIrr.mul(0.25).add(0.85));
          dep.assign(max(dep, ring.mul(0.9).mul(fade)));
        }
      }).Else(() => {
        // ── stożek / tarcza ──
        const Hc = size.mul(0.65).add(0.35).mul(o.hKm).toVar();
        const rc = mix(o.shield ? 0.05 : 0.13, o.shield ? 0.09 : 0.21, a.z).toVar();        // krater [promienie podstawy]
        const rn = r.mul(nIrr.mul(0.1).add(1.0)).toVar();
        const flank = o.shield
          ? max(exp(rn.mul(-3.2)).sub(0.0408), 0.0).mul(inv(0.9, 1.0, rn).mul(0.15).add(0.85))
          : pow(max(float(1.0).sub(rn), 0.0), 1.55);
        const top = o.shield ? exp(rc.mul(-3.2)).sub(0.0408) : pow(float(1.0).sub(rc), 1.55);
        const bowl = top.sub(inv(0.45, 1.0, rn.div(rc)).mul(o.shield ? 0.16 : 0.2));
        const rimD = rn.sub(rc).div(0.045);
        const prof = mix(flank, bowl, step(rn, rc)).add(exp(rimD.mul(rimD).negate()).mul(0.035)).toVar();
        // żleby na stoku: wąskie wcięcia między szerokimi żebrami (łapią niskie słońce), kręte, coraz głębsze w dół
        const ng = o.shield ? 5.0 : 6.5;
        const gul = abs(sin(th.mul(ng).add(a.y.mul(40.0)).add(sin(rn.mul(5.0).add(a.x.mul(9.0))).mul(0.45)).add(nIrr.mul(1.6))));
        const cut = float(1.0).sub(gul).toVar();
        const gulM = smoothstep(o.shield ? 0.14 : 0.0, o.shield ? 0.3 : 0.0001, rn.sub(rc.mul(1.15))).mul(inv(0.6, 1.0, rn));
        // (tarcze bez żlebów: długie proste bruzdy na łagodnym stoku wyglądały jak czesanie)
        if (!o.shield) prof.subAssign(cut.mul(cut).mul(cut).mul(gulM).mul(0.075).mul(rn.mul(0.8).add(0.4)));
        // jezioro lawy w kraterze
        const lake = inv(0.5, 0.86, rn.div(rc)).mul(active);
        lava.assign(max(lava, lake.mul(fade)));
        if (o.streams) {
          // strugi po stoku: kilka od wyłomu w kraterze, meandry, różna długość
          const N = floor(a.y.mul(2.99)).add(2.0);
          const ph = a.x.mul(6.2832);
          const mth = th.add(sin(rn.mul(4.2).add(ph.mul(3.0))).mul(0.42)).add(sin(rn.mul(9.7).add(ph.mul(5.0))).mul(0.18)).toVar();
          const arg0 = N.mul(mth).add(ph).toVar();
          const k = floor(arg0.div(6.2832).add(0.5));
          // każda struga odchylona o własny kąt (dwie strugi nie leżą na jednej prostej przez krater)
          const arg = arg0.add(hash1(k.mul(7.13).add(a.z.mul(31.7))).sub(0.5).mul(1.7)).toVar();
          const lat = rn.mul(sqrt(max(float(2.0).sub(cos(arg).mul(2.0)), 0.0))).div(N);
          const rEnd = mix(float(o.shield ? 0.45 : 0.75), min(float(o.shield ? 1.05 : 2.1), float(0.9).div(rad)), hash1(k.mul(12.9898).add(a.x.mul(78.233)))).toVar();
          const w = float(o.shield ? 0.012 : 0.034).mul(rn.mul(0.6).add(0.7));
          const along = inv(rEnd.mul(0.72), rEnd, rn);
          const stream = inv(w.mul(0.4), w, lat).mul(smoothstep(rc.mul(0.75), rc.mul(1.05), rn)).mul(along).mul(active).mul(U.uV1.y.mul(0.5).add(0.5)).toVar();
          lava.assign(max(lava, stream.mul(along.mul(0.3).add(0.5)).mul(fade)));
          prof.subAssign(stream.mul(0.012));
          // świeże potoki: ciemny fartuch wokół strug
          dep.assign(max(dep, inv(w, w.mul(4.0), lat).mul(along).mul(active).mul(0.75).mul(fade)));
        }
        dep.assign(max(dep, inv(0.2, 1.25, rn).mul(smoothstep(0.38, 0.7, lobes)).mul(0.55).mul(fade)));
        dep.assign(max(dep, inv(0.6, 1.3, rn.div(rc)).mul(0.8).mul(fade)));
        h.addAssign(prof.mul(Hc).mul(fade));
      });
    });
  });
}

function volcanicField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), uV1: 'vec4', uV2: 'vec4', uV3: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.1), 3, 0.45).toVar();
    const q = ps.add(wq).toVar();
    // oktawy z rozdzielczości celu, dzielnik stały (`full`): wycinek pod kamerą liczy więcej oktaw tego samego pola
    const c = pgFbm(q.mul(1.8), U.uOct.x, 2.03, 0.5, true).toVar();
    const h = c.mul(1.2).add(pgErodedFbm(q.mul(6.0), U.uOct.y, 1.4, 2.0, 0.5, true).mul(0.5)).toVar();
    const lava = float(0.0).toVar();
    const dep = float(0.0).toVar();
    const style = U.uV2.z;
    const io = step(style, 0.5).toVar();
    const st = C.stN;                                   // kąt teksela celu [rad]
    // warstwa widoczna, gdy jej najmniejszy obiekt ma kilka tekseli (promień [rad] / teksel)
    const gate = (rad) => smoothstep(2.5, 5.0, float(rad).div(st));
    // góry: pojedyncze bloki (Io) / pasma
    h.addAssign(pgRidged(q.mul(3.0), U.uOct.z, 2.07, 0.55, 1.0, 2.0, true).mul(U.uV2.x).mul(smoothstep(0.25, 0.6, pgFbm(q.mul(1.5).add(6.0), 3))));
    // prowincje wulkaniczne: średnie i małe wulkany w skupiskach
    const prov = smoothstep(-0.15, 0.3, pgFbm(q.mul(2.3).add(vec3(11.0, 4.0, -7.0)), 3)).toVar();
    // pola zastygłych potoków: płaty jeden na drugim (czoło potoku = próg szumu — skarpa łapiąca niskie słońce),
    // trzy skale; młodsze (wyższy szum) ciemniejsze. Czoło nie węższe niż ~1,5 teksela.
    for (const [f, km, octDrop, off] of [[9.0, 0.3, 0, 1.7], [27.0, 0.2, 2, 5.3], [80.0, 0.13, 4, 9.1]]) {
      const n = pgFbm(q.mul(f).add(vec3(off, -off * 0.7, off * 1.3)), max(int(U.uOct.y).sub(octDrop), int(2)), 2.03, 0.5, true).toVar();
      const wn = max(float(0.035), st.mul(f * 3.0));
      const on = octDrop > 0 ? smoothstep(1.5, 3.0, float(1 / (f * 4)).div(st)) : float(1.0);
      const lobe = smoothstep(float(0.06), wn.add(0.06), n).mul(on).mul(float(1.0).sub(io.mul(0.6))).toVar();
      h.addAssign(lobe.mul(km).mul(n.mul(0.6).add(0.9)));
      dep.assign(max(dep, lobe.mul(smoothstep(0.18, 0.4, n)).mul(0.5).mul(float(1.0).sub(io))));
    }
    // osie kąta wokół miejsca (płaszczyzna styczna)
    const t1 = normalize(cross(C.dir, vec3(0.31, 0.95, 0.12))).toVar();
    const t2 = cross(C.dir, t1).toVar();
    const S = { q, U, io, t1, t2, h, lava, dep };
    // duże: tarcze z kalderą (siarka: wielkie patery z pierścieniem opadu)
    volcanoLayer(S, { freq: 5.0, salt: 11, dens: U.uV3.x, rMin: 0.42, rMax: 0.8, hKm: 4.2, gate: float(1.0), streams: true, shield: true });
    // średnie: stożki z kraterem i strugami lawy (siarka: patery)
    volcanoLayer(S, { freq: 24.0, salt: 23, dens: U.uV3.y.mul(prov.mul(0.8).add(0.2)), rMin: 0.24, rMax: 0.44, hKm: 7.5, gate: gate(0.24 / 24), streams: true, shield: false });
    // małe: stożki żużlowe — tylko w wycinkach pod kamerą
    volcanoLayer(S, { freq: 105.0, salt: 37, dens: U.uV3.z.mul(prov), rMin: 0.2, rMax: 0.4, hKm: 1.5, gate: gate(0.2 / 105), streams: false, shield: false });
    // lawa: skorupa płyt (szwy Voronoia na odkształconej dziedzinie, kilka skal) + morza lawy w nieckach
    If(style.greaterThan(0.5).and(style.lessThan(1.5)), () => {
      const hot = pgFbm(q.mul(3.0).add(2.0), 4).mul(0.5).add(0.5).toVar();
      const seam = float(0.0).toVar();
      // szew o szerokości `w` komórek: nie węższy niż ~1,3 teksela, z zachowaniem energii (z daleka gaśnie do średniej)
      for (const [f, w, amp, wk] of [[14.0, 0.016, 1.0, 2.0], [38.0, 0.014, 0.6, 4.0], [105.0, 0.02, 0.5, 6.0], [290.0, 0.026, 0.42, 8.0]]) {
        const cr = pgCells(q.mul(f).add(wq.mul(wk)), 0.9).toVar();
        const wt = max(float(w), st.mul(f * 1.3));
        const on = f > 50 ? smoothstep(0.35, 0.9, float(w / f).div(st)) : float(1.0);
        seam.assign(max(seam, inv(0.0, wt, cr.y.sub(cr.x)).mul(float(w).div(wt)).mul(amp).mul(on)));
      }
      lava.assign(max(lava, seam.mul(smoothstep(0.35, 0.75, hot)).mul(U.uV1.z).mul(0.8)));
      const sea = inv(U.uQ.x.sub(0.015), U.uQ.x.add(0.015), c);
      lava.assign(max(lava, sea));
      h.assign(mix(h, U.uQ.x.mul(1.2).sub(0.1), sea));
    });
    const cr = craterSum(U, C, ps);
    h.addAssign(cr.h);
    return vec4(h, clamp(lava, 0.0, 1.0), clamp(dep, 0.0, 1.0), c);
  })();
  return { U, material: bakeMaterial('PlanetGenField_volcanic', node) };
}
const VOLCANIC_COLOR_DEFS = { ...COMMON_DEFS, uVc: 'vec4', uBase: 'vec3', uSecond: 'vec3', uBrightV: 'vec3', uDarkV: 'vec3', uRed: 'vec3', uLava: 'vec3' };
function volcanicColor(F) {
  const U = bakeUniforms(VOLCANIC_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const sl = slopeAt(F, U, C);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.4), 3, 0.5).toVar();
    const n1 = pgFbm(ps.mul(2.6).add(wq), 6).toVar();
    const n2 = pgFbm(ps.mul(15.0).add(wq.mul(2.0)), 4).toVar();
    const n3 = pgFbm(ps.mul(40.0), 3).toVar();
    const style = U.uVc.x;
    // równiny: plamy dwóch barw (siarka — żółć / pomarańcz / biel), detal
    const col = mix(U.uBase, U.uSecond, smoothstep(-0.15, 0.35, n1)).toVar();
    col.assign(mix(col, U.uBrightV, smoothstep(0.35, 0.65, n2.mul(0.6).add(n1.negate().mul(0.5))).mul(0.5)));
    col.mulAssign(float(1.0).add(n3.mul(0.1)));
    // drobna plamistość gruntu: oktawy z rozdzielczości celu (wycinek pod kamerą dostaje drobniejsze — ta sama dziedzina)
    const n4 = pgFbm(ps.mul(90.0).add(wq.mul(3.0)), U.uVc.y, 2.03, 0.62, true).toVar();
    col.mulAssign(float(1.0).add(n4.mul(0.5)));
    // osady i potoki: ciemne (bazalt) albo czerwone pierścienie (styl siarki)
    const depC = mix(U.uDarkV.mul(1.6), U.uRed, step(style, 0.5).mul(smoothstep(0.3, 0.9, f.z)));
    col.assign(mix(col, depC, f.z.mul(0.7)));
    // stoki ciemniejsze w stylu lawy i popiołu, jaśniejsze (siarkowy szron) w stylu siarki
    col.mulAssign(float(1.0).add(smoothstep(0.1, 0.4, sl.s).mul(mix(-0.25, 0.15, step(style, 0.5)))));
    // popiół: stoki stożków w utlenionym żużlu (rdzawy brąz), plamami
    col.assign(mix(col, U.uRed.mul(n2.mul(0.3).add(0.9)), smoothstep(0.06, 0.22, sl.s).mul(step(1.5, style)).mul(smoothstep(-0.2, 0.3, n2)).mul(0.55)));
    // lawa: świeża ciemnieje do czerni w skorupie, gorąca — pomarańcz (dzień); żar nocy — mapa nocy
    const lv = f.y;
    // lawa za dnia: świeża skorupa czarna, gorąca tylko w szwach i jeziorach — ciemna czerwień (żar widać nocą)
    col.assign(mix(col, U.uDarkV, smoothstep(0.05, 0.4, lv).mul(0.85)));
    col.assign(mix(col, U.uLava.mul(vec3(0.35, 0.12, 0.05)), smoothstep(0.6, 1.0, lv).mul(0.7)));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_volcanic', node) };
}
function volcanicUniforms(spec, ctx) {
  const L = spec.look;
  const P = L.palette;
  const style = L.style === 'siarka' ? 0 : (L.style === 'lawa' ? 1 : 2);
  return {
    field: { uV1: [L.paterae, L.flows, L.lava, L.plumes], uV2: [L.mountainKm, L.craters, style, 0],
      // udział komórek z wulkanem: duże, średnie, małe (małe — tylko w wycinkach pod kamerą)
      uV3: style === 0 ? [0.22 + 0.3 * L.paterae, 0.2 + 0.4 * L.paterae, 0.15 + 0.25 * L.paterae, 0]
        : (style === 1 ? [0.3, 0.22, 0.2, 0] : [0.5, 0.45, 0.34, 0]),
      ...craterRecords(ctx, { density: L.craters, f0: 5, fresh: 0.03, raysTo: 0, falloff: 0.9 }) },
    color: { uVc: [style, pgOctavesFor(ctx.size, 90, 2.03, 3, 12), 0, 0], uBase: P.base, uSecond: P.second, uBrightV: P.bright, uDarkV: P.dark, uRed: P.red, uLava: P.lava },
    probeQ: [style === 1 ? L.lava * 0.025 : 0.02, 0.1, 0.5, 0.9], water: false, landTop: 4,
    // sufity ponad mapy planety (≤ 4096 px ich nie sięgają) — dla wycinków pod kamerą
    octaves: { x: pgOctavesFor(ctx.size, 1.8, 2.03, 3, 16), y: pgOctavesFor(ctx.size, 6, 2.0, 3, 14), z: pgOctavesFor(ctx.size, 3, 2.07, 3, 14), w: 6 },
    spec: [0, 0, style === 1 ? 0.8 : 0.3, 0],
    lavaColor: P.lava,
    civ: { landOnly: 0, latDeg: 50, sea: 0, habW: 0, freq: 30, gain: 0.7 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// BARREN — martwa (Merkury, Księżyc, Kallisto): y — morza lawy, z — świeże wyrzuty i promienie, w — rzeźba bazowa
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function barrenField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), ...slotDefs('uBasin'), uBar: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const w = pgWarp(ps.mul(1.1), 3, 0.35).toVar();
    const base = pgFbm(ps.mul(1.8).add(w), U.uOct.x).toVar();
    const h = base.mul(U.uBar.x).toVar();
    // niziny zalane lawą (próg z próby: udział mórz poza basenami), brzeg postrzępiony drobniejszym szumem
    const edge = pgFbm(ps.mul(9.0).add(w.mul(2.0)), 4).mul(0.05);
    const lowMare = inv(U.uQ.x.sub(0.05), U.uQ.x.add(0.03), base.add(edge)).mul(U.uBar.y).toVar();
    const mare = float(0.0).toVar();
    const fill = float(-1e9).toVar();
    const wob = pgFbm(ps.mul(6.0), 3).mul(0.06);
    const mEdge = pgFbm(ps.mul(11.0).add(w.mul(2.0)), 4);
    for (let i = 0; i < SLOT_CAP; i++) {
      const a = U[`uBasin${i}`];
      const b = U[`uBasin${i}b`];
      If(a.w.greaterThan(0.0), () => {
        const Pb = basinProfile(C.dir, a, b, wob, mEdge);
        h.addAssign(Pb.h);
        mare.assign(max(mare, Pb.mare));
        fill.assign(max(fill, mix(fill, b.x.mul(-0.55), step(0.01, Pb.mare))));
      });
    }
    const baseLvl = U.uQ.x.mul(U.uBar.x);
    const anyMare = max(mare, lowMare).toVar();
    // kratery: duże (k < 2) przed zalaniem, mniejsze po (w morzach rzadziej — młodsza powierzchnia)
    const cr = craterSum(U, C, ps, anyMare, 2, (hh) => {
      const lvl = max(fill, baseLvl);
      h.assign(mix(h.add(hh), max(h.add(hh), lvl), anyMare));
      hh.assign(0.0);
    });
    h.addAssign(cr.h);
    // skarpy płatowe (Merkury): stopnie wzdłuż grzbietów szumu
    If(U.uBar.w.greaterThan(0.01), () => {
      const sc = pgRidged(ps.mul(3.5).add(w.mul(2.0)), 3, 2.1, 0.5, 1.0, 2.0);
      h.addAssign(smoothstep(0.55, 0.7, sc).mul(U.uBar.w).mul(0.8));
    });
    return vec4(h, anyMare, max(cr.ej.mul(0.75), cr.ray.mul(0.6)), base);
  })();
  return { U, material: bakeMaterial('PlanetGenField_barren', node) };
}
const BARREN_COLOR_DEFS = { ...COMMON_DEFS, uHigh: 'vec3', uMare: 'vec3', uFresh: 'vec3', uBarC: 'vec4' };
function barrenColor(F) {
  const U = bakeUniforms(BARREN_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const w = pgWarp(ps.mul(2.0), 3, 0.4).toVar();
    const v1 = pgFbm(ps.mul(3.0).add(w), 5).toVar();
    const v2 = pgFbm(ps.mul(14.0).add(w), 4).toVar();
    const v3 = pgFbm(ps.mul(45.0), 3).toVar();
    const high = U.uHigh.mul(float(1.0).add(v1.mul(0.18)).add(v2.mul(0.1)).add(v3.mul(0.05))).toVar();
    // morza: kilka potoków lawy różnego składu (odcień i jasność płatami), brzeg miękki
    const flows = pgFbm(ps.mul(5.0).add(w.mul(1.5)), 4).toVar();
    const mareC = U.uMare.mul(float(1.0).add(flows.mul(0.22)).add(v2.mul(0.06)))
      .mul(mix(vec3(1.0), vec3(0.9, 0.96, 1.1), smoothstep(-0.1, 0.4, flows)));
    const col = mix(high, mareC, smoothstep(0.1, 0.8, f.y)).toVar();
    const sl = slopeAt(F, U, C);
    col.assign(mix(col, U.uFresh, clamp(f.z, 0.0, 0.85).mul(U.uBarC.x)));
    col.mulAssign(float(1.0).add(smoothstep(0.08, 0.35, sl.s).mul(U.uBarC.y)));
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_barren', node) };
}
function barrenUniforms(spec, ctx) {
  const L = spec.look;
  const rng = rngFor(spec.seed, 'barren:baseny');
  const field = {
    uBar: [L.reliefKm, L.maria, 0, L.scarps],
    ...craterRecords(ctx, { density: L.craters, f0: 4, fresh: L.fresh, mareDamp: 0.3, raysTo: 2 }),
    ...emptySlots('uBasin')
  };
  for (let i = 0; i < Math.min(SLOT_CAP, L.basins); i++) {
    const d = rng.dir();
    const rad = rng.range(0.12, 0.4) * (i === 0 ? 1.3 : 1);
    const fill = rng.next() < (0.3 + L.maria * 0.7) ? 1 : 0;
    field[`uBasin${i}`] = [...d, rad];
    field[`uBasin${i}b`] = [rng.range(2.5, 6.0) * Math.sqrt(rad / 0.3), fill, rng.range(0.4, 1.0), 0];
  }
  const P = L.palette;
  return {
    field, color: { uHigh: P.high, uMare: P.mare, uFresh: P.fresh, uBarC: [1.0, 0.25, 0, 0] },
    probeQ: [L.maria * 0.22, 0.1, 0.5, 0.9], water: false, landTop: 3,
    octaves: { x: pgOctavesFor(ctx.size, 1.8, 2.03, 3, 9), y: 4, z: 3, w: 6 },
    spec: [0, 0, 0, 0],
    civ: { landOnly: 0, latDeg: 70, sea: 0, habW: 0, freq: 34, gain: 0.7 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TOXIC — pod pokładem chmur: gorące równiny bazaltu, tessery (grzbiety), wulkany; z — tessery, w — c
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function toxicField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), uX1: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.0), 3, 0.45).toVar();
    const q = ps.add(wq).toVar();
    const c = pgFbm(q.mul(1.7), U.uOct.x).toVar();
    const tess = smoothstep(0.15, 0.45, c).toVar();
    const h = c.mul(U.uX1.x).add(pgRidged(q.mul(9.0), U.uOct.z, 2.1, 0.55, 1.0, 2.0).mul(tess).mul(1.4)).toVar();
    const vc = pgCells(q.mul(6.0), 0.8).toVar();
    const vh = step(0.8, vc.z);
    h.addAssign(exp(vc.x.div(0.4).mul(-3.0)).mul(vh).mul(2.5));
    const cr = craterSum(U, C, ps);
    h.addAssign(cr.h);
    return vec4(h, 0.0, tess, c);
  })();
  return { U, material: bakeMaterial('PlanetGenField_toxic', node) };
}
const TOXIC_COLOR_DEFS = { ...COMMON_DEFS, uGround: 'vec3', uGroundDark: 'vec3', uCloudC: 'vec3' };
function toxicColor(F) {
  const U = bakeUniforms(TOXIC_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const n1 = pgFbm(ps.mul(3.0), 5).toVar();
    const n2 = pgFbm(ps.mul(16.0), 4).toVar();
    const col = mix(U.uGroundDark, U.uGround, smoothstep(-0.3, 0.4, n1).mul(0.7).add(f.z.mul(0.4))).mul(float(1.0).add(n2.mul(0.12))).toVar();
    // przez chmury przebija ich barwa (rozproszone światło) — powierzchnia widoczna słabo
    col.assign(mix(col, U.uCloudC.mul(0.55), 0.35));
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_toxic', node) };
}
function toxicUniforms(spec, ctx) {
  const L = spec.look;
  const P = L.palette;
  return {
    field: { uX1: [L.surfaceKm, 0, 0, 0], ...craterRecords(ctx, { density: 0.25, f0: 5, fresh: 0.0, raysTo: 0, falloff: 0.8 }) },
    color: { uGround: P.ground, uGroundDark: P.groundDark, uCloudC: P.cloud },
    probeQ: [0.2, 0.1, 0.5, 0.9], water: false, landTop: 3,
    octaves: { x: pgOctavesFor(ctx.size, 1.7, 2.03, 3, 9), y: 4, z: pgOctavesFor(ctx.size, 9, 2.1, 3, 6), w: 6 },
    spec: [0, 0, 0, 0],
    civ: { landOnly: 0, latDeg: 60, sea: 0, habW: 0, freq: 28, gain: 0.8 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Rejestr rodzajów: field() / color(F) — budowa grafu (raz), uniformsFor(spec, ctx) — wartości z opisu.
// drain(F)? — wejście spływu wody (rodzaje z rzekami: wysokość i opad do odczytu CPU, `drainage: true` w uniformsFor).
// uniformsFor → { field, color, probeQ [4 ułamki dla kwantyli kanału w], water (poziom morza 0), landTop [km],
//                 octaves { x, y, z, w }, spec [uSpec — bez morza: morze liczy shader], civ, lavaColor? }
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const SOLID_TYPES = {
  terran: { field: () => earthField('terran'), color: earthColor('terran'), drain: earthDrainInput('terran'), uniformsFor: earthUniforms, canopyKm: EARTH_CANOPY_KM },
  ocean: { field: () => earthField('ocean'), color: earthColor('ocean'), drain: earthDrainInput('ocean'), uniformsFor: earthUniforms, canopyKm: EARTH_CANOPY_KM },
  desert: { field: desertField, color: desertColor, uniformsFor: desertUniforms },
  rocky: { field: rockyField, color: rockyColor, uniformsFor: rockyUniforms },
  ice: { field: iceField, color: iceColor, uniformsFor: iceUniforms },
  volcanic: { field: volcanicField, color: volcanicColor, uniformsFor: volcanicUniforms },
  barren: { field: barrenField, color: barrenColor, uniformsFor: barrenUniforms },
  toxic: { field: toxicField, color: toxicColor, uniformsFor: toxicUniforms }
};
