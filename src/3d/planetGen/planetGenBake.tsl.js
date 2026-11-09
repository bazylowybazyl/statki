// src/3d/planetGen/planetGenBake.tsl.js
//
// Grafy WYPIEKU map planety (TSL, materiały quada pełnoekranowego rysowane do celów renderu — planetGenBaker.js).
// Każdy graf powstaje RAZ (rodzaj × przejście), wartości planety idą w uniformach ustawianych przed rysunkiem.
//
// Układ mapy = układ map gry (SphereGeometry three: u rośnie na wschód od 180° W, v = 1 — biegun N): piksel celu
// (x, y od GÓRY) ↔ uv = ((x + ½) / W, (y + ½) / H) — WGSL próbkuje v = 0 z górnego wiersza (pułapka 4), więc mapa
// wypieczona tak czyta się w grafie planety bez odwracania. Kierunek na kuli jak w SphereGeometry:
// φ = 2πu, θ = π(1 − v): (−cos φ sin θ, cos θ, sin φ sin θ).
//
// Przejścia: POLE (rodzaj; RGBA32F: x — wysokość [km], yzw — maski rodzaju) → DZIEŃ (rodzaj; albedo z pola i
// szumu), wspólne: NORMALNE (z wysokości, R = wschód, G = północ — konwencja grafu gry), POŁYSK (woda / lawa / lód),
// NOC (miasta, żar lawy), CHMURY (pasy klimatu i cyklony / pokład / pył). Sąsiednie teksele pola — textureLoad
// (RGBA32F nie jest filtrowalny bez cechy urządzenia).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, int, vec2, vec3, vec4, ivec2, uniform, screenCoordinate, textureLoad, select,
  abs, asin, atan, clamp, cos, dot, exp, floor, fract, length, max, min, mix, mod, normalize, sin, smoothstep, sqrt, step, cross, pow
} from 'three/tsl';
import { pgNoise, pgCells, pgFbm, pgWarp, pgHashU, pgU1, pgU3, pgRehash, pgRidged } from './planetGenNoise.tsl.js';

const PI = Math.PI;

// ── Uniformy ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Uniformy z definicji { nazwa: 'float' | 'vec2' | 'vec3' | 'vec4' }. */
export function bakeUniforms(defs) {
  const U = {};
  for (const [k, t] of Object.entries(defs)) {
    const v = t === 'vec4' ? new THREE.Vector4() : t === 'vec3' ? new THREE.Vector3() : t === 'vec2' ? new THREE.Vector2() : 0;
    U[k] = uniform(v, t);
  }
  return U;
}
/** Ustawia wartości: liczba albo tablica (do 4 składowych). Brakujące klucze — zera. */
export function setBakeUniforms(U, values) {
  for (const [k, node] of Object.entries(U)) {
    const v = values[k];
    if (typeof node.value === 'number') node.value = Number(v) || 0;
    else if (Array.isArray(v)) node.value.set(...[0, 1, 2, 3].slice(0, node.value.isVector4 ? 4 : (node.value.isVector3 ? 3 : 2)).map((i) => Number(v[i]) || 0));
    else node.value.set(0, 0, 0, 0);
  }
}

// Wspólne dla wszystkich grafów: ziarno (przesunięcie dziedziny, liczba całkowita), rozdzielczość, geometria
// (promień [km], teksel równika [km]), oktawy, poziomy z próby wysokości (morze, kwantyle).
export const COMMON_DEFS = Object.freeze({
  uSeed: 'vec4',     // xyz — przesunięcie dziedziny, w — ziarno całkowite
  uRes: 'vec4',      // W, H, 1/W, 1/H
  uGeo: 'vec4',      // R [km], teksel równika [km], —, —
  uOct: 'vec4',      // liczby oktaw: x — kształt, y — detal, z — grzbiety, w — chmury
  uLevels: 'vec4',   // x — poziom morza [km] (0 — planety z wodą; bez wody −1e3), y — typowy szczyt lądu [km], z — 1: z wodą, w — wolne
  uQ: 'vec4',        // kwantyle kanału próby (pole .w) w ułamkach rodzaju (probeQ — np. udział oceanu, wydm, mórz)
  uQ2: 'vec4',       // q01, q99, min, max kanału próby
  // WYCINEK (planetGenPatch.js; zera = cała mapa): cel przejścia to okno siatki długość / szerokość w układzie
  // OBRÓCONYM (osie uFr* w układzie planety, środek okna przy „równiku” układu — teksele prawie kwadratowe także przy
  // biegunach planety). x, y — kąt wschodni / północny lewej górnej krawędzi celu [rad], z — kąt teksela [rad], w — 1.
  uWin: 'vec4',
  uFrX: 'vec3', uFrY: 'vec3', uFrZ: 'vec3'
});

// ── Współrzędne piksela mapy ───────────────────────────────────────────────────────────────────────────────────────
// u, v, lat, dir — PRAWDZIWE (układ planety: klimat, pasy, szum); latGrid — szerokość w układzie SIATKI celu, stE / stN
// — kąt teksela na wschód (na równiku siatki) i na północ [rad]: tylko do odległości między sąsiednimi tekselami
// (nachylenia). Dla całej mapy siatka = układ planety.
export function bakeCoords(U) {
  const px = screenCoordinate.xy;
  const u = float(0.0).toVar();
  const v = float(0.0).toVar();
  const dir = vec3(0.0).toVar();
  const lat = float(0.0).toVar();
  const latGrid = float(0.0).toVar();
  const stE = float(0.0).toVar();
  const stN = float(0.0).toVar();
  If(U.uWin.w.greaterThan(0.5), () => {
    // kierunek w układzie wycinka jak w SphereGeometry z u = ½ + a / 2π, v = ½ + b / π: (cos a cos b, sin b, −sin a cos b)
    const a = U.uWin.x.add(px.x.mul(U.uWin.z));
    const b = U.uWin.y.add(px.y.mul(U.uWin.z));
    const cb = cos(b);
    // AGENT: gałąź ma być skończona także dla zer w uniformach (cała mapa): kompilator GPU potrafi ją policzyć
    // spekulatywnie i NaN z normalize(0) / atan2(0, 0) przeciekał do pola całej planety (czarne mapy, 2026-11-09)
    const d = U.uFrX.mul(cos(a).mul(cb)).add(U.uFrY.mul(sin(b))).add(U.uFrZ.mul(sin(a).mul(cb).negate())).toVar();
    dir.assign(d.div(max(length(d), 1e-6)));
    lat.assign(asin(clamp(dir.y, -1.0, 1.0)));
    const flat = abs(dir.x).add(abs(dir.z));
    u.assign(fract(atan(dir.z.negate(), dir.x.add(step(flat, 1e-7).mul(1e-6))).div(2 * PI).add(0.5)));
    v.assign(lat.div(PI).add(0.5));
    latGrid.assign(b);
    stE.assign(U.uWin.z);
    stN.assign(U.uWin.z);
  }).Else(() => {
    u.assign(px.x.mul(U.uRes.z));
    v.assign(px.y.mul(U.uRes.w));
    const phi = u.mul(2 * PI);
    const theta = float(1.0).sub(v).mul(PI);
    const st = sin(theta);
    dir.assign(vec3(cos(phi).negate().mul(st), cos(theta), sin(phi).mul(st)));
    lat.assign(v.sub(0.5).mul(PI));
    latGrid.assign(lat);
    stE.assign(U.uRes.z.mul(2 * PI));
    stN.assign(U.uRes.w.mul(PI));
  });
  const ix = int(floor(px.x)).toVar();
  const iy = int(floor(px.y)).toVar();
  return { u, v, dir, lat, latGrid, stE, stN, ix, iy };
}

/** Odczyt pola (textureLoad): cała mapa — zawinięcie długości, szerokość przycięta; wycinek — obie osie przycięte. */
export function fieldAt(F, U, ix, iy) {
  const W = int(U.uRes.x);
  const H = int(U.uRes.y);
  const wrapped = mod(ix.add(W), W);
  const x = U.uWin ? select(U.uWin.w.greaterThan(0.5), clamp(ix, int(0), W.sub(1)), wrapped) : wrapped;
  const y = clamp(iy, int(0), H.sub(1));
  return textureLoad(F, ivec2(x, y));
}

/** Materiał przejścia wypieku (quad, bez głębi, bez świateł). */
export function bakeMaterial(name, fragmentNode) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.fragmentNode = fragmentNode;
  m.depthTest = false;
  m.depthWrite = false;
  m.lights = false;
  m.fog = false;
  m.toneMapped = false;
  return m;
}

// ── RZEŹBA (wspólna; RGBA16F) ─────────────────────────────────────────────────────────────────────────────────────
// Mapa rzeźby dla materiału powierzchni generatora (planetGenSurface.tsl.js): x — wysokość [km] (planety z wodą:
// 0 = poziom morza), y / z — nachylenie dh/d(wschód), dh/d(północ) [km/km] z operatora Sobela 3 × 3 na prawdziwych
// odległościach (teksel na wschód 2πR cos φ / W, na północ πR / H), w — szorstkość 0…1 (siła detalu dokładanego
// w shaderze ponad rozdzielczość mapy). Bez przesadzenia i bez przycinania: materiał przesadza rzeźbę sam i liczy cień
// terenu, a połówki (nie 8 bitów) nie dają schodków na łagodnych stokach. Mipmapy średniej nachylenia = nachylenie
// średniej wysokości. uRel: x — szorstkość bazowa, y — przyrost z nachyleniem, z — przyrost przy brzegu (planety z wodą).
export const RELIEF_DEFS = Object.freeze({ ...COMMON_DEFS, uRel: 'vec4' });
export function buildReliefGraph(F) {
  const U = bakeUniforms(RELIEF_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const hC = fieldAt(F, U, C.ix, C.iy).x;
    // Sobel 3 × 3 (izotropowy — krzyż ±1 teksel rysował małe kratery jako romby)
    const hh = (dx, dy) => fieldAt(F, U, C.ix.add(dx), C.iy.add(dy)).x;
    const gx = hh(1, -1).add(hh(1, 0).mul(2.0)).add(hh(1, 1)).sub(hh(-1, -1)).sub(hh(-1, 0).mul(2.0)).sub(hh(-1, 1)).mul(0.125);
    const gy = hh(-1, 1).add(hh(0, 1).mul(2.0)).add(hh(1, 1)).sub(hh(-1, -1)).sub(hh(0, -1).mul(2.0)).sub(hh(1, -1)).mul(0.125);
    const cosLat = max(cos(C.latGrid), U.uRes.w.mul(PI)).toVar();
    const R = U.uGeo.x;
    const dE = gx.div(R.mul(cosLat).mul(C.stE));
    // AGENT: wiersz y celu rośnie ku PÓŁNOCY (y = 0 to v = 0 = biegun S — bakeCoords), więc gy to już pochodna na
    // północ. Dawny minus odwracał rzeźbę w osi północ–południe: przy słońcu z północy oświetlona ściana krateru
    // wychodziła ciemna (przy słońcu ze wschodu nie było tego widać).
    const dN = gy.div(R.mul(C.stN));
    const slope = length(vec2(dE, dN));
    const coast = exp(hC.mul(hC).mul(-12.0)).mul(step(0.5, U.uLevels.z));
    const rough = clamp(U.uRel.x.add(slope.mul(U.uRel.y)).add(coast.mul(U.uRel.z)), 0.0, 1.0);
    return vec4(hC, dE, dN, rough);
  })();
  return { U, material: bakeMaterial('PlanetGenRelief', node) };
}
const inv01 = (lo, hi, x) => float(1.0).sub(smoothstep(lo, hi, x));

// ── MASKI (wspólne; RGBA8, pełna rozdzielczość) ───────────────────────────────────────────────────────────────────
// Kanały pola dla materiału zbliżenia (planetGenSurfaceNear.tsl.js): R — ciecz poza morzem (pole.y: lawa, solanka),
// G — maska rodzaju (pole.z: osady, potoki, kaldery). Piecze się tylko na życzenie (`mask: true` wypieku planety)
// i w wycinkach pod kamerą.
export function buildMaskGraph(F) {
  const U = bakeUniforms(COMMON_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy);
    return vec4(clamp(f.y, 0.0, 1.0), clamp(f.z, 0.0, 1.0), 0.0, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenMask', node) };
}

// ── POŁYSK (wspólny, pół rozdzielczości) ──────────────────────────────────────────────────────────────────────────
// R = maska połysku grafu gry (woda: smoothstep(0,08; 0,82; R) → połysk i ostrość odblasku). uSpec: x — woda,
// y — stały połysk (lód), z — kanał y pola (lawa), w — 0.
export const SPEC_DEFS = Object.freeze({ ...COMMON_DEFS, uSpec: 'vec4' });
export function buildSpecGraph(F) {
  const U = bakeUniforms(SPEC_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    // cel ma pół rozdzielczości pola: średnia 2 × 2 tekseli pola
    const fx = C.ix.mul(2);
    const fy = C.iy.mul(2);
    const UF = { uRes: vec4(U.uRes.x.mul(2), U.uRes.y.mul(2), 0, 0) };
    const a = fieldAt(F, UF, fx, fy);
    const b = fieldAt(F, UF, fx.add(1), fy);
    const c = fieldAt(F, UF, fx, fy.add(1));
    const d = fieldAt(F, UF, fx.add(1), fy.add(1));
    const sea = U.uLevels.x;
    const wet = (h) => smoothstep(sea.add(0.03), sea.sub(0.08), h);
    const water = wet(a.x).add(wet(b.x)).add(wet(c.x)).add(wet(d.x)).mul(0.25);
    const lava = a.y.add(b.y).add(c.y).add(d.y).mul(0.25);
    const s = clamp(water.mul(U.uSpec.x).add(U.uSpec.y).add(lava.mul(U.uSpec.z)), 0.0, 1.0);
    return vec4(s, s, s, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenSpec', node) };
}

// ── NOC (wspólna, pół rozdzielczości) ─────────────────────────────────────────────────────────────────────────────
// Miasta: zamieszkiwalność z pola (ląd nad morzem, nisko, umiarkowane szerokości, blisko wybrzeża — `uCiv`) ×
// skupiska z komórek dwóch skal (metropolie z przedmieściami, miasteczka); punkty o różnej jasności i barwie (sód,
// LED) — bez ciągłych linii (doklejone sieci świateł). Żar lawy: kanał y pola × `uLava.x` (pomarańcz). Mapa nocy
// w grafie gry = światła miast (jasność z luminancji, nocą i w cieniu ringu).
export const NIGHT_DEFS = Object.freeze({ ...COMMON_DEFS, uCiv: 'vec4', uCiv2: 'vec4', uLava: 'vec4', uLavaCol: 'vec3' });
export function buildNightGraph(F) {
  const U = bakeUniforms(NIGHT_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const fx = C.ix.mul(2);
    const fy = C.iy.mul(2);
    const UF = { uRes: vec4(U.uRes.x.mul(2), U.uRes.y.mul(2), 0, 0) };
    const f0 = fieldAt(F, UF, fx, fy).toVar();
    const h = f0.x;
    const sea = U.uLevels.x;
    const ps = C.dir.add(U.uSeed.xyz);
    // ── miasta ──
    const civ = U.uCiv.x;   // gęstość cywilizacji 0…1
    const col = vec3(0.0).toVar();
    If(civ.greaterThan(0.001), () => {
      // ląd nad morzem (uCiv.y = 1 — tylko ląd; 0 — także platformy na morzu)
      const land = smoothstep(sea.sub(0.02), sea.add(0.06), h);
      const onSea = float(1.0).sub(land).mul(U.uCiv.w);
      // wysokość względna nad morzem: niziny chętniej (q90 — wysokie góry puste)
      const relH = h.sub(sea).div(max(U.uLevels.y, 0.1));
      const low = float(1.0).sub(smoothstep(0.25, 0.75, relH));
      // klimat: umiarkowane szerokości (uCiv.z — pas, w stopniach od równika: najlepiej do niego)
      const absLat = abs(C.lat).mul(180 / PI);
      const climate = float(1.0).sub(smoothstep(U.uCiv.z, U.uCiv.z.add(22.0), absLat)).mul(smoothstep(0.0, 6.0, absLat).mul(0.4).add(0.6));
      // blisko wybrzeża: woda w promieniu ~6 tekseli (8 próbek)
      const coast = float(0.0).toVar();
      for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, 4], [4, -4], [-4, -4]]) {
        const hh = fieldAt(F, UF, fx.add(dx * 2), fy.add(dy * 2)).x;
        coast.addAssign(smoothstep(sea.add(0.02), sea.sub(0.05), hh));
      }
      const coastF = min(coast.mul(0.35), 1.0);
      const hab = land.mul(U.uCiv.y).add(float(1.0).sub(U.uCiv.y)).mul(low).mul(climate).mul(coastF.mul(1.2).add(0.45))
        .mul(f0.w.mul(U.uCiv2.x).add(float(1.0).sub(U.uCiv2.x)))
        .add(onSea.mul(0.25));
      // regiony zaludnienia (duże plamy — nie wszędzie, gdzie można)
      const region = smoothstep(-0.15, 0.45, pgFbm(ps.mul(2.6), 4)).toVar();
      const pop = hab.mul(region).mul(civ).toVar();
      // METROPOLIE: obszar zabudowy (zasięg gaussowski, promień z haszu, brzeg postrzępiony) wypełniony drobnym
      // ziarnem świateł — nie pojedyncza plamka; jaśniej w środku
      const jit = pgFbm(ps.mul(U.uCiv2.y.mul(1.5)), 3).mul(0.12);
      const cBig = pgCells(ps.mul(U.uCiv2.y).add(jit), 0.9).toVar();
      const bigHas = step(float(1.0).sub(pop.mul(1.5)), cBig.z);
      const rad = mix(0.12, 0.42, cBig.w).mul(pop.mul(0.6).add(0.6));
      const urban = exp(cBig.x.div(rad).pow2().negate()).mul(bigHas).toVar();
      const grain = pgCells(ps.mul(U.uCiv2.y.mul(9.0)), 1.0).toVar();
      const dots = exp(grain.x.mul(grain.x).mul(-26.0)).mul(grain.z.mul(0.7).add(0.3));
      const metro = urban.mul(dots.mul(0.75).add(urban.mul(0.45)));
      // MIASTECZKA: rzadkie punkty w zaludnionych regionach, gęściej przy brzegu
      const cSmall = pgCells(ps.mul(U.uCiv2.y.mul(4.3)), 0.95).toVar();
      const smallHas = step(float(1.0).sub(pop.mul(0.55).mul(coastF.mul(0.8).add(0.4))), cSmall.z);
      const town = exp(cSmall.x.mul(cSmall.x).mul(-40.0)).mul(smallHas).mul(cSmall.w.mul(0.5).add(0.2));
      // łuna gęstych regionów (wsie, drogi — rozmyte, bez linii)
      const rural = smoothstep(0.35, 1.0, pop).mul(0.05).mul(pgFbm(ps.mul(40.0), 3).mul(0.5).add(0.5));
      const L = metro.add(town.mul(0.5)).add(rural).mul(U.uCiv2.z).toVar();
      // barwa: sód (ciepła) ↔ LED (chłodniejsza) z haszu metropolii
      const warm = vec3(1.0, 0.62, 0.26);
      const cold = vec3(0.86, 0.86, 0.95);
      col.assign(mix(warm, cold, smoothstep(0.55, 0.95, cBig.w).mul(0.7)).mul(L));
    });
    // ── żar lawy ──
    If(U.uLava.x.greaterThan(0.001), () => {
      const lv = f0.y;
      const flick = pgNoise(ps.mul(60.0)).mul(0.25).add(0.85);
      col.addAssign(U.uLavaCol.mul(lv.mul(U.uLava.x).mul(flick)));
    });
    return vec4(min(col, vec3(1.0)), 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenNight', node) };
}

// ── CHMURY (wspólne) ──────────────────────────────────────────────────────────────────────────────────────────────
// Graf chmur gry czyta maskę z luminancji i barwę z chromy. Style (`uCloud.w`): 0 — ziemskie: pasy klimatu (strefa
// zbieżności przy równiku, suche podzwrotnikowe, tory sztormów średnich szerokości), rozciągnięcie strefowe, cyklony
// (spirale z okiem — obrót dziedziny wokół osi cyklonu, kąt rośnie ku środkowi), erozja brzegów drobnym szumem;
// 1 — pokład (toksyczna): pełne zachmurzenie z pasmami i ścinaniem w kształt „Y”, kołnierze polarne; 2 — cienki pył
// / mgła: smugi strefowe.
export const CLOUD_DEFS = Object.freeze({
  ...COMMON_DEFS,
  uCloud: 'vec4',    // x — pokrycie (0…1), y — rozciągnięcie strefowe, z — liczba cyklonów, w — styl
  uCloud2: 'vec4',   // x — skala (×), y — ostrość brzegu, z — kontrast pokładu, w — skręt „Y”
  uTint: 'vec3',
  uTint2: 'vec3',    // barwa ciemnych smug pokładu (styl 1)
  uCyc0: 'vec4', uCyc1: 'vec4', uCyc2: 'vec4', uCyc3: 'vec4', uCyc4: 'vec4', uCyc5: 'vec4', uCyc6: 'vec4', uCyc7: 'vec4'
});
export const CLOUD_CYCLONES = 8;
export function buildCloudGraph() {
  const U = bakeUniforms(CLOUD_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const style = U.uCloud.w;
    const sc = U.uCloud2.x;
    const absLatD = abs(C.lat).mul(180 / PI).toVar();
    const q = vec3(C.dir).toVar();
    const spiral = float(0.0).toVar();
    const eye = float(1.0).toVar();
    // cyklony: obrót kierunku wokół osi cyklonu o kąt rosnący ku środkowi (półkula — zwrot). Pozatropikalne (duże,
    // luźne, bez oka — chmury frontu w kształt przecinka) i tropikalne (małe, ciasne, z okiem): promień w uCyc.w
    for (let i = 0; i < CLOUD_CYCLONES; i++) {
      const cy = U[`uCyc${i}`];
      If(float(i).lessThan(U.uCloud.z), () => {
        const axis = normalize(cy.xyz);
        const cd = dot(C.dir, axis);
        const d = sqrt(max(float(1.0).sub(cd.mul(cd)), 0.0)).toVar();
        const rad = cy.w;
        If(cd.greaterThan(0.0).and(d.lessThan(rad.mul(2.0))), () => {
          const t = inv01(0.0, rad.mul(2.0), d);
          const tropical = inv01(0.1, 0.13, rad);
          const turn = t.mul(t).mul(mix(3.2, 6.0, tropical)).mul(mix(float(-1.0), float(1.0), step(0.0, axis.y)));
          const ca = cos(turn);
          const sa = sin(turn);
          q.assign(q.mul(ca).add(cross(axis, q).mul(sa)).add(axis.mul(dot(axis, q)).mul(float(1.0).sub(ca))));
          spiral.assign(max(spiral, t.mul(mix(0.6, 1.0, tropical))));
          eye.mulAssign(mix(float(1.0), smoothstep(rad.mul(0.04), rad.mul(0.12), d), tropical));
        });
      });
    }
    const qs = vec3(q.x, q.y.mul(U.uCloud.y), q.z).add(U.uSeed.xyz.mul(1.37)).toVar();
    // odkształcenie dwupoziomowe — wiry i smugi frontów zamiast plam
    const warp = pgWarp(qs.mul(1.5).mul(sc), 4, 0.6).toVar();
    const warp2 = pgWarp(qs.add(warp).mul(3.0).mul(sc).add(vec3(1.3, 4.1, -2.2)), 3, 0.12).toVar();
    const qw = qs.add(warp).add(warp2.mul(0.6)).toVar();
    // dzielnik stały (`full`): wycinek pod kamerą liczy więcej oktaw i trafia w te same pola chmur co mapa planety
    // Dzielnik stały (`full`): wycinek pod kamerą liczy więcej oktaw i trafia w te same pola chmur co mapa planety.
    // Oktawy mapy planety (pierwsze 6 / 4) — w dziedzinie skręconej przez cyklony i rozciągniętej strefowo (ramiona
    // spiral, smugi frontów); DALSZE — w dziedzinie nieskręconej i izotropowej: drobny detal chmur to kłęby, a w
    // dziedzinie skręconej wychodził w wycinku jako rozmazane smugi wzdłuż ramion.
    const nO = int(U.uOct.w).toVar();
    const qd = C.dir.add(U.uSeed.xyz.mul(1.37)).add(warp).add(warp2.mul(0.6)).toVar();
    const qr = C.dir.add(U.uSeed.xyz.mul(1.37)).toVar();     // dziedzina surowa: bez skrętu, rozciągnięcia i odkształceń
    const base = pgFbm(qw.mul(2.5).mul(sc), min(nO, int(5)), 2.03, 0.5, true)
      .add(pgFbm(qd.mul(2.5 * Math.pow(2.03, 5)).mul(sc).add(vec3(3.3, -7.1, 1.9)), max(nO.sub(5), int(0)), 2.03, 0.5, true).mul(Math.pow(0.5, 5))).toVar();
    const fine = pgFbm(qw.mul(12.0).mul(sc), min(nO.sub(2), int(4)), 2.03, 0.5, true)
      .add(pgFbm(qd.mul(12.0 * Math.pow(2.03, 4)).mul(sc).add(vec3(-5.7, 2.2, 8.4)), max(nO.sub(6), int(0)), 2.03, 0.5, true).mul(Math.pow(0.5, 4))).toVar();
    const st = C.stN;                                   // kąt teksela celu [rad]
    const out = float(0.0).toVar();
    const tintMix = float(0.0).toVar();
    If(style.lessThan(0.5), () => {
      // profil pokrycia z szerokości (zbieżność 0–8°, sucho 15–32°, sztormy 40–65°, polarna umiarkowana), granice
      // pasów przesunięte szumem
      const aL = absLatD.add(base.mul(9.0));
      const itcz = exp(aL.div(7.0).pow2().negate()).mul(0.12);
      const sub = exp(aL.sub(24.0).div(9.0).pow2().negate()).mul(-0.26);
      const storm = exp(aL.sub(54.0).div(13.0).pow2().negate()).mul(0.2);
      const cover = U.uCloud.x.add(itcz).add(sub).add(storm).add(spiral.mul(0.32));
      const dens = base.mul(0.5).add(0.5).add(cover.sub(0.5)).add(fine.mul(0.07)).toVar();
      const edge = U.uCloud2.y;
      out.assign(smoothstep(float(0.5).sub(edge), float(0.5).add(edge), dens));
      // pola cumulusów (komórki) tam, gdzie gęstość tuż pod progiem — podzwrotniki nad oceanem
      // (bez haszu komórki w jasności: hasz skacze na krawędzi komórki — z bliska widać wielokąty)
      // (w dziedzinie nieskręconej `qd`: w skręconej komórki przy cyklonach rozciągały się w wachlarze)
      const cc = pgCells(qr.mul(34.0).mul(sc).add(warp.mul(0.25)), 0.95).toVar();
      const puff = inv01(0.2, 0.75, cc.x).mul(smoothstep(-0.1, 0.4, fine));
      out.assign(max(out, puff.mul(smoothstep(0.3, 0.48, dens)).mul(0.45)));
      // drobne kłęby (tylko w wycinkach pod kamerą): cienkie pola chmur (cumulusy, brzegi frontów) rozpadają się na
      // nieregularne kłęby — inaczej powiększona komórka pola to płaska plama o ostrym brzegu; grube chmury dostają
      // grudkowate wierzchołki (grubość niesie maska — światło z bliska liczy z niej cień). Szum izotropowy
      // w dziedzinie SUROWEJ (bez odkształceń): komórki Worleya dawały równe owalne „cekiny”, a odkształcona
      // dziedzina rozciągała je w smugi.
      const hi = pgFbm(qr.mul(60.0).mul(sc).add(vec3(1.9, -4.3, 6.1)), max(nO.sub(5), int(1)), 2.03, 0.55, true).toVar();
      const hiOn = smoothstep(2.5, 5.0, float(1 / 120).div(sc).div(st));
      const thin = float(1.0).sub(smoothstep(0.5, 0.85, out));
      out.mulAssign(mix(float(1.0), mix(hi.mul(0.3).add(1.0), smoothstep(-0.28, 0.3, hi).mul(1.25), thin), hiOn));
      out.mulAssign(eye);
      // cienkie pierzaste smugi (cirrus) — rozciągnięte mocniej strefowo
      const ci = pgFbm(vec3(qw.x, qw.y.mul(2.5), qw.z).mul(7.0).mul(sc), 4);
      // (w wycinku pod kamerą słabiej: rozciągnięte smugi bez drobnego detalu wyglądają z bliska jak pręgowane łaty)
      out.assign(max(out, smoothstep(0.25, 0.75, ci).mul(smoothstep(0.3, 0.5, dens)).mul(0.3).mul(float(1.0).sub(hiOn.mul(0.75)))));
    }).ElseIf(style.lessThan(1.5), () => {
      // pokład: ścinanie strefowe (kształt „Y”: długość przesunięta z |φ|), pasma, kołnierz polarny
      const lon = fract(C.u.add(abs(C.lat).mul(U.uCloud2.w)));
      const sh = vec3(cos(lon.mul(2 * PI)), sin(C.lat).mul(U.uCloud.y), sin(lon.mul(2 * PI))).add(U.uSeed.xyz);
      const streak = pgFbm(sh.mul(vec3(1.5, 3.0, 1.5)).mul(sc).add(warp.mul(0.6)), U.uOct.w);
      const bandsN = sin(C.lat.mul(9.0).add(base.mul(1.4))).mul(0.5).add(0.5);
      const collar = exp(absLatD.sub(68.0).div(6.0).pow2().negate());
      // jasność pokładu wysoka i równa, smugi i pasma — barwą (uTint2 w smugach), nie dziurami
      const dark = clamp(streak.mul(1.4).mul(U.uCloud2.z).add(bandsN.sub(0.5).mul(0.5).mul(U.uCloud2.z)).add(fine.mul(0.3)), -1.0, 1.0).toVar();
      const v = float(0.9).add(dark.mul(0.08)).add(collar.mul(0.06));
      out.assign(clamp(v.mul(U.uCloud.x.add(0.06)), 0.0, 1.0));
      tintMix.assign(smoothstep(-0.05, 0.6, dark.negate()));
    }).Else(() => {
      // pył / mgła cienka: smugi strefowe
      const d = base.mul(0.5).add(0.5).add(U.uCloud.x.sub(0.5)).add(fine.mul(0.1));
      out.assign(smoothstep(0.42, 0.78, d).mul(0.75));
    });
    return vec4(mix(U.uTint, U.uTint2, tintMix).mul(out), 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenClouds', node) };
}
