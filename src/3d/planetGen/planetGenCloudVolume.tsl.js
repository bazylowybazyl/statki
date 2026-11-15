// src/3d/planetGen/planetGenCloudVolume.tsl.js
//
// CHMURY JAKO BRYŁA: powłoka [r0, r1] nad planetą liczona marszem promienia widzenia (siatka = kula jednostkowa,
// dziecko kuli planety obracane jak warstwa chmur). Chmura ma prawdziwą grubość: widać ją z profilu nad krawędzią
// tarczy, ma jasną stronę od słońca, ciemny spód i rzuca cień na sąsiednie chmury — to, czego płaska maska
// (planetGenCloudsNear.tsl.js) nie pokaże pod kątem.
//   • POKRYCIE z mapy chmur planety (wypiek generatora: pasy klimatu, fronty, cyklony) — gdzie są chmury;
//   • MASA = pokrycie + szum SKUPISK (~3× większa skala niż kłąb): chmury zbijają się w nieregularne zbiorowiska
//     z litym środkiem, osobnymi kłębami tylko na obrzeżu i czystym niebem pomiędzy (`cloudShape`) — pole równych
//     kłębów na całym pokryciu wygląda z daleka jak piana;
//   • RODZAJ z pola niskiej częstości (`cloudRegime`): ława warstwowa (stratus / stratocumulus — niska, płaska,
//     z drobnymi kopułkami komórek), chmury kłębiaste (kopuły; próg rośnie z wysokością), wieże burzowe
//     (cumulonimbus — trzon do stropu powłoki z kowadłem). Dwie warstwy CIENKIE liczone raz na piksel, bez marszu:
//     wysoka (cirrus — smugi rozciągnięte strefowo, przy dużej ilości welon cirrostratus) i średnia (altocumulus —
//     drobne komórki płatami, przy dużej ilości gładka ława altostratus);
//   • SZCZEGÓŁ PONIŻEJ PIKSELA wchodzi średnią (`lodW`, `fineW`): pole kłębów mniejszych od piksela to
//     półprzezroczysty welon o gęstości = udział pokrycia, nie ziarno;
//   • ŚWIATŁO liczone RAZ NA PIKSEL na WIERZCHU chmury (punkt nad pierwszą gęstą próbką, wyznaczony z rampy progu —
//     ciągły między pikselami): gęstość ku słońcu w dwóch bliskich próbkach z kłębami i drobnym szczegółem (strona
//     od słońca jasna, odsłoneczna ciemna) i w kilku dalekich aż do stropu powłoki (wieża rzuca długi cień na ławę
//     pod sobą); głębsze próbki marszu ciemnieją z grubością optyczną przebytą w chmurze. Światło liczone
//     w miejscu każdej próbki zależało od tego, gdzie w kroku wypadła próbka: z przesunięciem startu szumem piksela
//     — ziarno, bez niego — pasy. Do tego: osłabienie z drugim, wolniej gasnącym członem (wielokrotne rozpraszanie
//     w przybliżeniu), faza z rozjaśnieniem pod słońce, światło nieba zależne od wysokości w chmurze, cień planety
//     i barwa słońca przy terminatorze.
// Cień chmur na gruncie liczy materiał powierzchni z tego samego kształtu (funkcje `cloudCover`, `cloudRegime`,
// `cloudShape` stąd; uniformy uGnCloud, uGnCloudVol). Wartości per obiekt w `material.uniforms`
// (CLOUD_VOLUME_UNIFORM_KEYS, tekstura `cloudTexture`). Obraz (zasada żelazna 1).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, int, vec2, vec3, vec4, varying, positionGeometry, texture3D,
  asin, atan, abs, clamp, cos, dot, exp, floor, fwidth, length, log2, max, min, mix, normalize, sin, smoothstep, sqrt, step
} from 'three/tsl';
import { WX_BANDS, WX_PHASE, WX_SEAM } from './planetGenBake.tsl.js';
import { genObjectTexture, tinyTexture } from './planetGenNodes.js';
import { cloudNoiseTexture } from './planetGenNoise3D.js';
import { STORM_MAX, FLASH_MAX } from './planetGenStorms.js';
import { SHELL_UNIFORM_KEYS, shellPerObject, shellRay, shellUniforms, shellMaterial, planetLit, pixelNoise } from './planetGenShell.tsl.js';

const PI = Math.PI;
export const CLOUD_VOLUME_UNIFORM_KEYS = Object.freeze({
  ...SHELL_UNIFORM_KEYS,
  uCvShape: 'vec4',    // r0, r1 (promienie powłoki), ekstynkcja [1 / R], wzmocnienie pokrycia
  uCvNoise: 'vec4',    // częstość kłębów [1 / R], częstość drobnego szczegółu (kłębki z bliska, erozja brzegów), siła erozji, czas [s]
  uCvTint: 'vec3',     // barwa chmur (albedo)
  uCvSky: 'vec4',      // rgb — światło nieba w chmurze, a — kąt teksela mapy chmur [rad]
  uCvWx: 'vec4',       // pogoda: bieżący czas [s] (kłęby jadą z pasami wiatru), wiatr [rad / s], 1 — włączona, czas mapy pogody [s]
  uCvMisc: 'vec4',     // najdłuższy odcinek marszu [R], rozjaśnienie pod słońce, krok [grubości powłoki], jasność słońca w chmurze
  uCvKind: 'vec4',     // rodzaje chmur: wieże burzowe (0…1), warstwy cienkie (0…1), przesunięcie rodzaju (− ławy, + konwekcja), —
  // BURZE (planetGenStorms.js): xyz — kierunek środka układu burzowego (układ kuli chmur), w — promień tarczy [rad] (0 — brak)
  ...Object.fromEntries(Array.from({ length: STORM_MAX }, (_, i) => [`uCvSt${i}`, 'vec4'])),
  // BŁYSKI PIORUNÓW: xyz — miejsce w układzie kuli chmur, w — jasność w tej chwili (0 — brak)
  ...Object.fromEntries(Array.from({ length: FLASH_MAX }, (_, i) => [`uCvFl${i}`, 'vec4']))
});
export const CLOUD_VOLUME_STEPS = 44;
export const CLOUD_VOLUME_STEPS_MIN = 20;
/** Zagęszczenie próbek marszu ku podstawie powłoki (promień trafiający w planetę): położenie = 1 − (1 − u)^p. */
export const CLOUD_STEP_BIAS = 1.6;
/** Udział szumu piksela w przesunięciu startu marszu (0 — stały start w połowie kroku, 1 — cały krok). */
export const CLOUD_JITTER = 0.6;
/**
 * Błysk pioruna w chmurze: poświata o promieniu `glow` [R] (rozproszona w chmurze wokół kanału) i jasne jądro `core`,
 * jasność w jednostkach grafu gry przy jasności błysku 1 (ponad progiem bloomu — błysk ma świecić).
 */
export const CLOUD_FLASH = Object.freeze({ glow: 0.014, core: 0.0035, gain: 3.6 });
/** Dalekie próbki światła ku słońcu (do stropu powłoki) w każdej gęstej próbce marszu. */
export const CLOUD_LIGHT_FAR = 4;
const LUM = vec3(0.299, 0.587, 0.114);
const cloudTex = genObjectTexture('cloudTexture', tinyTexture(new Uint8Array([0, 0, 0, 255]), THREE.UnsignedByteType, THREE.SRGBColorSpace), vec2(0.0));

// Stromość progu kłębów: gęstość = (szum − próg) · K, przycięta do 0…1 (większa = ostrzejszy brzeg kłębu).
const K = 7.0;
// Rozkład kanału R tekstury szumu (kłęby): kwantyle 5 / 50 / 95% = 0,34 / 0,52 / 0,68; kanały G, B (Worley): mediana
// 0,48 — pilnuje test.
const N_MED = 0.52;
const W_MED = 0.478;

/**
 * MODEL KSZTAŁTU (liczby wspólne bryły i cienia na gruncie).
 *   masa = pokrycie + (szum skupisk − mediana) · agg
 *   próg kłębów = t0 − s · masa + wysokość · nachylenie(rodzaj)
 * Przy pokryciu 0,5 próg podstawy = mediana szumu (połowa powierzchni pod kłębami); skupiska przesuwają masę
 * o ±0,35, więc w tym samym pokryciu są miejsca lite (próg poniżej całego szumu) i puste (powyżej) — zbiorowiska.
 * Wierzchołek leży tam, gdzie próg dogania szum. Próg podstawy ma DNO zależne od rodzaju (`topDeck`, `topCum` —
 * wysokość wierzchu przy medianie szumu), więc nawet najgęstsza masa nie wypełnia całej powłoki: ława kończy się na
 * ~0,3–0,4 wysokości, chmury kłębiaste na 0,6–0,9, a wieże (własny szum w kolumnie, próg prawie stały z wysokością)
 * wystają ponad nie do stropu. Nachylenie = stosunek szerokości kłębu do wysokości: przy 0,8 pojedynczy kłąb był
 * plackiem o grubości kilku km (półprzezroczysty, rozmyty z bliska), przy 0,5 jest wysoki jak szeroki.
 */
export const CLOUD_MODEL = Object.freeze({
  agg: 2.0,
  t0: 1.12,
  s: 1.2,
  slopeDeck: 1.6,
  slopeCum: 0.5,
  topDeck: 0.3,
  topCum: 0.6,
  deckLift: 0.25,    // ława: próg niższy o tyle — warstwa lita już przy średniej masie
  towerThr: 0.655,   // próg trzonu wieży przy podstawie: ~7% powierzchni strefy konwekcji (kwantyl szumu kłębów)
  towerTaper: 0.05,  // wzrost progu trzonu z wysokością: słabsze wieże kończą się w połowie powłoki
  anvil: 0.11,       // obniżenie progu pod stropem — kowadło szersze niż trzon
  regFreq: 1.6,      // częstość pola rodzaju [1 / R] (płaty ~1000 km)
  hMid: 0.55,        // wysokość warstwy średniej w powłoce (0 — podstawa, 1 — strop)
  hHigh: 0.93        // wysokość warstwy wysokiej
});
const M = CLOUD_MODEL;

/** Pokrycie 0…1 z luminancji mapy chmur (`gain` — wzmocnienie stylu chmur). */
export const cloudCover = (lum, gain) => smoothstep(0.02, 0.85, lum.mul(gain));

// kąt obrotu pasa wiatru i — jak `bandAngle` grafu chmur (planetGenBake.tsl.js); wxv = (czas pogody, wiatr, 1 — pogoda)
const wxBandAngle = (i, wxv) => cos(i.mul(PI / WX_BANDS).sub(PI / 2).mul(3.0)).negate().mul(wxv.y).mul(wxv.x).add(i.mul(WX_PHASE)).mul(wxv.z);
const rotY = (v, a) => {
  const c = cos(a);
  const s = sin(a);
  return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
};
// mieszanie dwóch niezależnych szumów bez utraty kontrastu (średnia ma mniejszą wariancję — pas bez chmur)
const mixNoise = (a, b, w, mid) => mix(a.sub(mid), b.sub(mid), w).div(sqrt(max(float(1.0).sub(w).pow2().add(w.mul(w)), 0.25))).add(mid);

/**
 * POGODA — układy pasów wiatru w punkcie x (układ kuli chmur): chmury jadą z pasem swojej szerokości (najbliższy
 * środek pasa — obrót sztywny wokół osi planety, ten sam co pokrycia w mapie pogody), w wąskiej strefie między
 * pasami dwa układy przenikają. Bez tego pokrycie przesuwa się nad nieruchomymi kłębami: chmura „rośnie” z jednej
 * strony i „paruje” z drugiej zamiast płynąć. Zwraca { xr — punkt w układzie pasa, x2 — w układzie sąsiedniego,
 * seam — waga sąsiedniego 0…0,5 }. Wklejana.
 */
function bandFrames(x, wxv) {
  const fB = asin(clamp(x.y.div(max(length(x), 1e-5)), -1.0, 1.0)).div(PI).add(0.5).mul(WX_BANDS).toVar();
  const iN = floor(fB.add(0.5)).toVar();
  const fr = fB.sub(iN).toVar();
  const xr = vec3(0.0).toVar();
  xr.assign(rotY(x, wxBandAngle(iN, wxv).negate()));
  const x2 = vec3(0.0).toVar();
  x2.assign(rotY(x, wxBandAngle(iN.add(mix(float(-1.0), float(1.0), step(0.0, fr))), wxv).negate()));
  const seam = float(0.0).toVar();
  seam.assign(smoothstep(WX_SEAM, 0.5, abs(fr)).mul(0.5).mul(wxv.z));
  return { xr, x2, seam };
}

/**
 * RODZAJ CHMUR w kierunku punktu x (stały wzdłuż promienia planety — cała kolumna ma jeden rodzaj): jedna próbka
 * szumu bardzo niskiej częstości. Zwraca vec4:
 *   x — niestabilność 0…1: 0 — ława warstwowa, ~0,5 — chmury kłębiaste, 1 — głęboka konwekcja (wieże burzowe);
 *       w tropikach wyższa (strefa zbieżności), `bias` przesuwa całość (styl chmur planety);
 *   y, z, w — niezależne pola (mediana ~0,5) dla warstw cienkich: wysokiej, średniej i falowania wzoru.
 * Pole nie jedzie z pasami wiatru (masy powietrza) — chmura płynąca przez granicę rodzajów zmienia postać.
 */
export function cloudRegime(x, noise, time, bias) {
  const dir = x.div(max(length(x), 1e-5));
  const s = texture3D(noise, dir.mul(M.regFreq).add(vec3(0.21, 0.67, 0.43)).add(vec3(time.mul(0.0006), 0.0, time.mul(0.0004))), float(0.0));
  const tropic = float(1.0).sub(smoothstep(0.25, 0.7, abs(dir.y)));
  // kanał A (gładki): kwantyle 5 / 95% = 0,36 / 0,64 → rozciągnięte na 0…1
  return vec4(clamp(s.a.sub(0.5).mul(3.5).add(0.5).add(tropic.mul(0.16)).sub(0.06).add(bias), 0.0, 1.0), s.r, s.g, s.b);
}

/**
 * BURZA w kierunku `dir` (układ kuli chmur): 0 — poza układami, 1 — w środku tarczy. `storms` — węzły vec4 (kierunek
 * środka, promień [rad]); `edge` — szum 0…1 (mediana ~0,48: kanał Worleya próbki rodzaju chmur) — brzeg tarczy
 * nieregularny (promień ± ~30%); `scale` — mnożnik promienia (otoczka burzy: tarcza chmur pierzastych).
 */
export function stormAt(dir, storms, edge, scale = 1) {
  const st = float(0.0).toVar();
  for (const S of storms) {
    // cięciwa ≈ kąt od środka (tarcze mają po kilka stopni)
    const ang = sqrt(max(float(2.0).sub(dot(dir, S.xyz).mul(2.0)), 0.0));
    const r = S.w.mul(edge.sub(W_MED).mul(1.4).add(1.0)).mul(scale);
    st.assign(max(st, float(1.0).sub(smoothstep(r.mul(0.5), max(r, 1e-4), ang)).mul(step(1e-4, S.w))));
  }
  return st;
}
/** Pokrycie w burzy: tarcza burzy jest zachmurzona niezależnie od mapy chmur. */
export const stormCover = (cov, storm) => max(cov, storm.mul(0.92));

// Zanik przy podstawie, stropie i tam, gdzie mapa jest pusta.
const fadeOf = (cov, hN) => smoothstep(0.0, 0.06, hN).mul(float(1.0).sub(smoothstep(0.86, 1.0, hN))).mul(smoothstep(0.02, 0.12, cov));

/**
 * KSZTAŁT CHMUR w punkcie x układu kuli chmur. `P` = { r0, thick — podstawa i grubość powłoki [R], freq — częstość
 * kłębów, time — czas szumu [s], noise — tekstura szumu 3D, wxv — pogoda (czas, wiatr, 1 — włączona), towers — wieże
 * burzowe 0…1, storm — (opcjonalnie) burza 0…1 z `stormAt` }; `cov` — pokrycie z mapy w tym miejscu (w burzy
 * podniesione przez wołającego: `stormCover`), `reg` — `cloudRegime` (w burzy niestabilność = 1).
 * Opcje: `puffs: false` (stała JS) — bez szumu kłębów (średnia gęstość masy + wieże: dalekie próbki światła);
 * `lodW` — węzeł 0…1: 1 — kłęby rozdzielone, 0 — mniejsze od piksela (wchodzą średnią); `sharp` — węzeł ≥ 1:
 * mnożnik stromości progu (z bliska brzeg kłębu ostrzejszy — przy stałej stromości przejście ma ~20 km i kłąb
 * widziany z kilkuset km jest rozmyty); `detail: { w, fine }` — DROBNY SZCZEGÓŁ progu z bliska: trzy oktawy szumu
 * kłębów o częstości `fine` · (1; 4,1; 17) (kłębki ~22, ~5 i ~1,3 km) z wagami `w` (vec3 0…1, z rozmiaru piksela),
 * czytane w KOLUMNIE (pion ściśnięty 5×) — szczegół 3D drobniejszy niż krok marszu dawał ziarno zamiast faktury;
 * `stepH` — węzeł: pionowy zasięg kroku marszu [wysokości powłoki]: gęstość kłębów jest wtedy ŚREDNIĄ z kroku
 * (próg rośnie z wysokością liniowo, więc całka przyciętej rampy ma wzór) zamiast wartością w punkcie — krycie nie
 * zależy od tego, gdzie w kroku wypadła próbka (punkt + przesunięcie startu szumem piksela = ziarno).
 * Zwraca { d — gęstość 0…1 przed erozją brzegów, sheet — cienka ława wokół mas, fade — zanik podstawy / stropu,
 * fineS — próbka pierwszej oktawy drobnego szczegółu (kanały G, B — erozja brzegów; bez `detail` mediany), det —
 * drobny szczegół progu (± ~0,05; światło: wypukłość jaśniejsza, wklęsłość ciemniejsza), topUp — odległość w górę
 * do wierzchu chmury [wysokości powłoki], hN — wysokość w powłoce }.
 * Gęstość bez erozji: max(sheet, d) · fade. Wklejana.
 */
export function cloudShape(x, P, cov, reg, opts = {}) {
  const puffs = opts.puffs !== false;
  const lodW = opts.lodW || null;
  const kN = opts.sharp ? opts.sharp.mul(K) : float(K);
  const len = float(0.0).toVar();
  len.assign(max(length(x), 1e-5));
  const hN = float(0.0).toVar();
  hN.assign(len.sub(P.r0).div(max(P.thick, 1e-6)));
  const fade = float(0.0).toVar();
  fade.assign(fadeOf(cov, hN));
  const d = float(0.0).toVar();
  const sheet = float(0.0).toVar();
  const fineS = vec4(N_MED, W_MED, W_MED, 0.5).toVar();
  const det = float(0.0).toVar();
  const topUp = float(0.0).toVar();
  // 0 — ława warstwowa (płaska), 1 — chmury kłębiaste
  const cum = float(0.0).toVar();
  cum.assign(smoothstep(0.3, 0.5, reg.x));
  const slope = mix(float(M.slopeDeck), float(M.slopeCum), cum).toVar();
  // dno progu podstawy: wierzch masy (przy medianie szumu) nie wyżej niż `topDeck` / `topCum`
  const storm = P.storm || float(0.0);
  const thrFloor = float(N_MED).sub(slope.mul(mix(float(M.topDeck), mix(float(M.topCum), float(0.78), storm), cum))).toVar();
  const conv = float(0.0).toVar();
  conv.assign(smoothstep(0.68, 0.85, reg.x).mul(smoothstep(0.3, 0.6, cov)).mul(P.towers));
  // ponad najwyższym możliwym wierzchem (próg powyżej całego szumu) i poza strefą wież — bez próbek szumu
  If(fade.greaterThan(0.002).and(thrFloor.add(hN.mul(slope)).lessThan(0.88).or(conv.greaterThan(0.01))), () => {
    const B = bandFrames(x, P.wxv);
    const drift = vec3(P.time.mul(0.006), 0.0, P.time.mul(0.004));
    // pion ściśnięty 5×: wzór czytany w KOLUMNIE (prawie stały wzdłuż promienia planety)
    const rc = P.r0.add(hN.mul(P.thick).mul(0.2)).div(len).toVar();
    // (kłąb, skupisko, komórki, drobne komórki): kanał R tekstury w skali kłębu i ~3× większej; kanały Worleya (G, B)
    // tej samej próbki co kłąb — drobne kopułki bez osobnej próbki (szczegół drobniejszy niż krok marszu, z osobnej
    // próbki o wyższej częstości, dawał ziarno: sąsiednie piksele trafiały w różne warstwy wzoru)
    const sample = (xq) => {
      const q = xq.mul(P.freq).add(drift);
      const big = texture3D(P.noise, q.mul(0.31).add(vec3(0.37, 0.11, 0.73)), float(0.0)).r;
      if (!puffs) return vec4(N_MED, big, W_MED, W_MED);
      const s1 = texture3D(P.noise, q, float(0.0));
      return vec4(s1.r, big, s1.g, s1.b);
    };
    const v = vec4(0.0).toVar();
    v.assign(sample(B.xr));
    If(B.seam.greaterThan(0.002), () => {
      const v1 = sample(B.x2);
      v.assign(vec4(mixNoise(v.x, v1.x, B.seam, N_MED), mixNoise(v.y, v1.y, B.seam, N_MED), mix(v.zw, v1.zw, B.seam)));
    });
    const mass = cov.add(v.y.sub(N_MED).mul(M.agg));
    const thr = float(0.0).toVar();
    thr.assign(max(float(M.t0).sub(mass.mul(M.s)).sub(float(1.0).sub(cum).mul(M.deckLift)), thrFloor).add(hN.mul(slope)));
    // średnia gęstość pola kłębów przy tym progu (dystrybuanta szumu między kwantylami 5 i 95%)
    const dAvg = clamp(float(N_MED).sub(thr).mul(2.94).add(0.47), 0.0, 1.0);
    if (puffs) {
      // drobne kopułki: ława — komórki Worleya (środek komórki wyżej, styki niżej: stratocumulus), kłębiaste —
      // drobniejsze kłęby na dużych (kalafior). Wchodzą w PRÓG, więc mają cień własny, nie tylko zarys
      const bump = mix(v.z.sub(W_MED).mul(0.3), v.w.sub(W_MED).mul(0.14), cum);
      if (opts.detail) {
        // drobny szczegół tylko przy POWIERZCHNI chmury (rampa bez szczegółu w zasięgu jego amplitudy): wysoko nad
        // wierzchem i głęboko we wnętrzu nie zmienia gęstości, a próbki w każdym kroku marszu podwajały koszt bryły
        const base = v.x.add(bump).sub(thr);
        If(base.greaterThan(-0.11).and(base.lessThan(0.27)), () => {
          const xc = B.xr.mul(rc).mul(opts.detail.fine).toVar();
          const w = opts.detail.w;
          fineS.assign(texture3D(P.noise, xc.add(vec3(0.0, P.time.mul(0.009), 0.0)), float(0.0)));
          det.assign(fineS.r.sub(N_MED).mul(0.26).mul(w.x));
          If(w.y.greaterThan(0.01), () => {
            det.addAssign(texture3D(P.noise, xc.mul(4.1).add(vec3(0.31, 0.57, 0.13)), float(0.0)).r.sub(N_MED).mul(0.11).mul(w.y));
          });
          If(w.z.greaterThan(0.01), () => {
            det.addAssign(texture3D(P.noise, xc.mul(17.0).add(vec3(0.71, 0.23, 0.49)), float(0.0)).r.sub(N_MED).mul(0.04).mul(w.z));
          });
        });
      }
      const ramp = v.x.add(bump).add(det).sub(thr).mul(kN);
      // wierzch chmury nad punktem: tam, gdzie rampa progu schodzi do zera (próg rośnie z wysokością liniowo)
      topUp.assign(clamp(ramp.div(kN.mul(slope)), 0.0, 0.35));
      let dNear = clamp(ramp, 0.0, 1.0);
      if (opts.stepH) {
        // średnia przyciętej rampy na odcinku ±half: (F(a + half) − F(a − half)) / (2 · half), F — całka clamp(u, 0, 1)
        const half = max(slope.mul(kN).mul(opts.stepH).mul(0.5), 1e-3);
        const F = (u) => clamp(u, 0.0, 1.0).pow2().mul(0.5).add(max(u.sub(1.0), 0.0));
        dNear = F(ramp.add(half)).sub(F(ramp.sub(half))).div(half.mul(2.0));
      }
      d.assign(lodW ? mix(dAvg, dNear, lodW) : dNear);
    } else {
      d.assign(dAvg);
    }
    // cienka, półprzezroczysta ława wokół mas chmur (strzępy stratusa), płatami — miękkie obrzeże zbiorowiska
    const zs = hN.sub(0.2).div(0.12);
    sheet.assign(smoothstep(0.4, 0.8, mass).mul(smoothstep(0.42, 0.6, v.x)).mul(exp(zs.mul(zs).negate())).mul(0.08));
    // WIEŻE BURZOWE: szum kłębów czytany w KOLUMNIE (pion ściśnięty 5×) — trzon spójny od podstawy do stropu,
    // wyrasta z najmocniejszych kłębów; próg rośnie lekko z wysokością (słabsze wieże kończą się niżej), pod stropem
    // spada (kowadło)
    If(conv.greaterThan(0.01), () => {
      const tower = (xq) => texture3D(P.noise, xq.mul(rc).mul(P.freq).add(drift), float(0.0)).r;
      const nT = float(0.0).toVar();
      nT.assign(tower(B.xr));
      If(B.seam.greaterThan(0.002), () => { nT.assign(mixNoise(nT, tower(B.x2), B.seam, N_MED)); });
      // KOWADŁO: gruba płyta w pasie ~0,5–0,82 wysokości (próg niższy — szersza niż trzon; cienka płyta pod samym
      // stropem była półprzezroczysta i ziarnista), PONAD nią próg rośnie — wybijają tylko rdzenie najmocniejszych
      // wież (kopuły nad kowadłem, z własnym cieniem). Burza: więcej wież i szersze kowadło — zlewa się w tarczę
      const anvilBand = smoothstep(0.45, 0.6, hN).mul(float(1.0).sub(smoothstep(0.78, 0.86, hN)));
      const thrT = float(M.towerThr).sub(storm.mul(0.05)).add(hN.mul(M.towerTaper)).sub(anvilBand.mul(storm.mul(0.06).add(M.anvil)))
        .add(smoothstep(0.84, 1.0, hN).mul(0.07)).add(float(1.0).sub(conv).mul(0.25));
      const dT = clamp(nT.add(v.w.sub(W_MED).mul(0.1)).add(det).sub(thrT).mul(kN.mul(1.6)), 0.0, 1.0);
      d.assign(max(d, lodW ? mix(conv.mul(0.07), dT, lodW) : dT));
    });
  });
  return { d, sheet, fade, fineS, det, topUp, hN };
}

// Wysokość punktu w powłoce 0…1 (podstawa → strop).
const heightIn = (x, U) => length(x).sub(U.uCvShape.x).div(max(U.uCvShape.y.sub(U.uCvShape.x), 1e-5));
/**
 * POGODA — ślizg mapy pokrycia między przeliczeniami: mapa pogody jest z chwili `mapTime`, a kłęby jadą płynnie
 * z bieżącą (`wxv.x`). Punkt czyta mapę przesuniętą o drogę pasa wiatru swojej szerokości od `mapTime` (obrót wokół
 * osi planety = przesunięcie u mapy) — pokrycie płynie co klatkę razem z kłębami, bez skoków o ułamek teksela przy
 * każdej nowej mapie. Zwraca przyrost współrzędnej u. `lat` — szerokość punktu [rad].
 */
export const wxGlideU = (lat, wxv, mapTime) => {
  const iN = floor(lat.div(PI).add(0.5).mul(WX_BANDS).add(0.5));
  return cos(iN.mul(PI / WX_BANDS).sub(PI / 2).mul(3.0)).mul(wxv.y).mul(wxv.x.sub(mapTime)).mul(wxv.z).div(2 * PI);
};
// uv mapy chmur dla kierunku `dir` (układ kuli chmur) ze ślizgiem pogody
const coverUv = (dir, U) => {
  const lat = asin(clamp(dir.y, -1.0, 1.0));
  return vec2(
    atan(dir.z.negate(), dir.x.add(step(abs(dir.x).add(abs(dir.z)), 1e-7).mul(1e-6))).div(2 * PI).add(0.5).add(wxGlideU(lat, U.uCvWx, U.uCvWx.w)),
    lat.div(PI).add(0.5)
  );
};
// Pokrycie z mapy chmur w kierunku punktu x (układ kuli chmur) — próbka mapy z poziomem mipmapy.
const coverAt = (x, U, lod) => cloudCover(dot(cloudTex.sample(coverUv(x.div(max(length(x), 1e-5)), U)).level(lod).rgb, LUM), U.uCvShape.w);

// Gęstość z erozją brzegów: Worley średni i drobny (kanały G, B pierwszej oktawy drobnego szczegółu — czytanej
// w kolumnie) strzępi brzegi kłębu, wnętrze zostaje lite.
function eroded(S, erodeK) {
  const m = float(1.0).sub(S.fineS.g.mul(0.62).add(S.fineS.b.mul(0.38))).mul(erodeK);
  return max(S.sheet, clamp(S.d.sub(m).div(max(float(1.0).sub(m), 0.2)), 0.0, 1.0)).mul(S.fade);
}

let graph = null;
function build() {
  const U = shellPerObject(CLOUD_VOLUME_UNIFORM_KEYS);
  const noise = cloudNoiseTexture();
  const vDir = varying(positionGeometry, 'vCvDir');
  const positionNode = Fn(() => positionGeometry.mul(U.uCvShape.y))();
  const fragmentNode = Fn(() => {
    // rozmiar piksela na kuli zewnętrznej PRZED gałęziami (poziom mipmapy mapy pokrycia, wygaszanie szczegółu)
    const pixA = float(0.0).toVar();
    pixA.assign(length(fwidth(vDir)));
    const lod = clamp(log2(max(pixA.div(max(U.uCvSky.a, 1e-9)), 1e-6)), 0.0, 6.0).toVar();
    // szczegół mniejszy od piksela wchodzi średnią: kłęby (~0,015 R), drobny szczegół i wzór warstw cienkich (~0,002 R)
    const lodW = float(1.0).sub(smoothstep(0.004, 0.012, pixA)).toVar();
    const fineW = float(1.0).sub(smoothstep(0.0012, 0.004, pixA)).toVar();
    const erodeK = U.uCvNoise.z.mul(fineW).toVar();
    // z bliska (piksel poniżej ~0,0005 R) brzegi kłębów ostrzejsze
    const sharp = mix(float(2.4), float(1.0), smoothstep(0.0001, 0.0006, pixA)).toVar();
    // drobny szczegół kłębów: oktawa wchodzi, gdy jej kłębki (~0,004, ~0,001, ~0,00025 R) mają kilka pikseli
    const detW = vec3(fineW, float(1.0).sub(smoothstep(0.00012, 0.0005, pixA)), float(1.0).sub(smoothstep(0.00003, 0.00012, pixA))).toVar();
    const R = shellRay(U, vDir, U.uCvShape.y, U.uCvShape.x);
    const sun = normalize(U.uShSun.xyz).toVar();
    const seg = min(max(R.t1.sub(R.t0), 0.0), U.uCvMisc.x).toVar();
    const thick = U.uCvShape.y.sub(U.uCvShape.x).toVar();
    // liczba kroków z długości odcinka: patrząc z góry powłoka jest cienka (kilkanaście kroków), przy krawędzi
    // tarczy odcinek jest wielokrotnie dłuższy (pełna liczba)
    const nS = int(clamp(seg.div(max(thick.mul(U.uCvMisc.z), 1e-7)), float(CLOUD_VOLUME_STEPS_MIN), float(CLOUD_VOLUME_STEPS))).toVar();
    const dt = seg.div(float(nS)).toVar();
    // przesunięcie startu marszu szumem piksela — częściowe: pełne daje ziarno na granicach cienia, zerowe zostawia
    // cienkie linie na stykach warstw próbek
    const jit = mix(float(0.5), pixelNoise(), CLOUD_JITTER).toVar();
    const sigma = U.uCvShape.z;
    // faza: rozjaśnienie pod słońce (srebrne brzegi przy terminatorze), przycięte — bez prześwietlenia całej ławy
    const cosT = dot(R.rd, sun);
    const g = float(0.55);
    const hg = float(1.0).sub(g.mul(g)).div(float(1.0).add(g.mul(g)).sub(g.mul(cosT).mul(2.0)).pow(1.5));
    const phase = mix(float(1.0), clamp(hg.mul(0.55).add(0.6), 0.72, 1.9), U.uCvMisc.y).toVar();
    const P = { r0: U.uCvShape.x, thick, freq: U.uCvNoise.x, time: U.uCvNoise.w, noise, wxv: U.uCvWx, towers: U.uCvKind.x, storm: null };
    const Tr = float(1.0).toVar();
    const col = vec3(0.0).toVar();
    // środek odcinka: rodzaj chmur kolumny (jedna próbka na piksel) i test pustego nieba
    const xm = R.o.add(R.rd.mul(R.t0.add(seg.mul(0.5)))).toVar();
    const reg = vec4(0.0).toVar();
    reg.assign(cloudRegime(xm, noise, U.uCvNoise.w, U.uCvKind.z));
    // BURZA kolumny (raz na piksel): tarcza układu burzowego — chmura lita, wysoka i ciemniejsza, niestabilność = 1
    const storms = Array.from({ length: STORM_MAX }, (_, i) => U[`uCvSt${i}`]);
    const flashes = Array.from({ length: FLASH_MAX }, (_, i) => U[`uCvFl${i}`]);
    const st = float(0.0).toVar();
    st.assign(stormAt(xm.div(max(length(xm), 1e-5)), storms, reg.w));
    // otoczka burzy (1,7 promienia): kowadła rozwiewa wiatr — wokół układu tarcza chmur pierzastych
    const stHalo = float(0.0).toVar();
    stHalo.assign(stormAt(xm.div(max(length(xm), 1e-5)), storms, reg.w, 1.7));
    reg.assign(vec4(max(reg.x, st), reg.yzw));
    const flashOn = flashes.reduce((a, F) => a.add(F.w), float(0.0)).toVar();
    // światło słońca i nieba w punkcie x: `lightT` — osłabienie po drodze ku słońcu, `skyK` — udział światła nieba
    const lightAt = (x, mu, lightT, skyK) => {
      const sunCol = mix(vec3(1.0, 0.46, 0.2), vec3(1.0, 0.97, 0.93), smoothstep(-0.03, 0.26, mu)).mul(U.uShSun.w);
      const sky = U.uCvSky.rgb.mul(skyK).mul(smoothstep(-0.1, 0.25, mu));
      return U.uCvTint.mul(sunCol.mul(lightT).mul(phase).mul(planetLit(x, sun)).mul(U.uCvMisc.w).add(sky));
    };

    // ── WARSTWY CIENKIE (raz na piksel): punkt przecięcia promienia z kulą warstwy, wzór z szumu rozciągniętego
    //    strefowo (oś y dziedziny ściśnięta — smugi i wały układają się wzdłuż równoleżników), krycie z grubości
    //    optycznej po skosie widzenia. Wzór miękki (szeroki próg) — ostre plamy czytają się jak naklejki ──
    const bO = dot(R.o, R.rd).toVar();
    const oo = dot(R.o, R.o).toVar();
    const hiA = float(0.0).toVar();
    const hiC = vec3(0.0).toVar();
    const midA = float(0.0).toVar();
    const midC = vec3(0.0).toVar();
    If(U.uCvKind.y.greaterThan(0.01), () => {
      const layer = (hL, body) => {
        const rL = U.uCvShape.x.add(thick.mul(hL));
        const disc = bO.mul(bO).sub(oo.sub(rL.mul(rL))).toVar();
        const tL = bO.negate().sub(sqrt(max(disc, 0.0))).toVar();
        If(disc.greaterThan(0.0).and(tL.greaterThan(0.0)), () => {
          const xl = R.o.add(R.rd.mul(tL)).toVar();
          const nl = xl.div(max(length(xl), 1e-5)).toVar();
          // pokrycie okolicy (rzadka mipmapa): warstwy cienkie towarzyszą układom chmur — tarcza przed frontem
          const covC = coverAt(xl, U, lod.add(3.0)).toVar();
          body(xl, nl, covC, max(abs(dot(nl, R.rd)), 0.22));
        });
      };
      // łagodne falowanie wzoru: wektor z pola niskiej częstości (ta sama próbka co rodzaj chmur)
      const warp = reg.yzw.sub(0.5).mul(0.045).toVar();
      const stretched = (xq, sy, f, off) => {
        const p = xq.add(warp);
        return vec3(p.x, p.y.mul(sy), p.z).mul(f).add(off);
      };
      const smooth3 = (q) => texture3D(noise, q, float(0.0)).a;
      // WYSOKA: cirrus — długie miękkie smugi z jedwabistym włóknem, przy dużej ilości welon (cirrostratus)
      layer(M.hHigh, (xl, nl, covC, cosV) => {
        const amt = clamp(covC.mul(0.7).add(reg.y.sub(0.56).mul(3.0)).add(stHalo.mul(0.7)), 0.0, 1.0).mul(U.uCvKind.y).toVar();
        If(amt.greaterThan(0.03), () => {
          const B = bandFrames(nl, U.uCvWx);
          const pat = (xq) => {
            const q = stretched(xq, 6.0, 3.5, vec3(U.uCvNoise.w.mul(0.0015), 0.0, 0.0)).toVar();
            return smooth3(q).mul(0.62).add(smooth3(q.mul(2.7).add(vec3(0.5, 0.2, 0.8))).mul(0.26))
              .add(mix(float(0.5), smooth3(q.mul(7.3).add(vec3(0.1, 0.6, 0.3))), fineW).mul(0.12));
          };
          const v = float(0.0).toVar();
          v.assign(pat(B.xr));
          If(B.seam.greaterThan(0.002), () => { v.assign(mixNoise(v, pat(B.x2), B.seam, 0.5)); });
          // (wzór: mediana 0,5, kwantyle 5 / 95% ≈ 0,4 / 0,6); próg szeroki — smuga ma miękki brzeg
          // krycie rośnie z ilością, próg prawie stały: przy progu rosnącym z ilością rzadkie cirrusy zostawały
          // cienkimi „żyłkami” na grzbietach wzoru
          const thr = float(0.52).sub(amt.mul(0.08));
          const tau = smoothstep(thr, thr.add(0.2), v).mul(smoothstep(0.03, 0.5, amt)).mul(0.42);
          hiA.assign(float(1.0).sub(exp(tau.div(cosV).negate())));
          hiC.assign(lightAt(xl, dot(nl, sun), float(1.0), float(0.95)));
        });
      });
      // ŚREDNIA: altocumulus — płaty drobnych komórek w wałach (przejrzyste, z błękitem w szczelinach), przy dużej
      // ilości gładsza ława (altostratus). Tylko na OBRZEŻACH układów chmur (średnie pokrycie okolicy): nad litą masą
      // biała warstwa zasłaniała jej rzeźbę rozmytą plamą
      layer(M.hMid, (xl, nl, covC, cosV) => {
        const amt = clamp(reg.z.sub(0.5).mul(6.0), 0.0, 1.0).mul(smoothstep(0.08, 0.35, covC)).mul(float(1.0).sub(smoothstep(0.5, 0.8, covC))).mul(U.uCvKind.y).toVar();
        If(amt.greaterThan(0.03), () => {
          const B = bandFrames(nl, U.uCvWx);
          // (płat — mediana 0,5, kwantyle ≈ 0,4 / 0,6; komórki — kanał Worleya)
          const pat = (xq) => {
            const q = stretched(xq, 1.8, 6.0, vec3(U.uCvNoise.w.mul(0.004), 0.0, 0.0)).toVar();
            return vec2(smooth3(q).mul(0.6).add(smooth3(q.mul(3.1).add(vec3(0.3, 0.9, 0.1))).mul(0.4)),
              mix(float(W_MED), texture3D(noise, q.mul(13.0), float(0.0)).g, fineW));
          };
          const v = vec2(0.0).toVar();
          v.assign(pat(B.xr));
          If(B.seam.greaterThan(0.002), () => {
            const v1 = pat(B.x2);
            v.assign(vec2(mixNoise(v.x, v1.x, B.seam, 0.5), mix(v.y, v1.y, B.seam)));
          });
          const thr = float(0.55).sub(amt.mul(0.08));
          const cells = mix(smoothstep(0.36, 0.6, v.y), float(1.0), smoothstep(0.8, 1.0, amt).mul(0.6));
          const tau = smoothstep(thr, thr.add(0.12), v.x).mul(smoothstep(0.03, 0.5, amt)).mul(mix(float(0.05), float(0.55), cells));
          midA.assign(float(1.0).sub(exp(tau.div(cosV).negate())));
          // środek komórki jaśniejszy niż jej brzeg (płaska warstwa bez światłocienia czyta się jak wycinanka)
          midC.assign(lightAt(xl, dot(nl, sun), mix(float(0.74), float(1.0), cells), float(0.85)));
        });
      });
    });

    // PUSTE NIEBO: jedna próbka mapy pokrycia w środku odcinka, z poziomu mipmapy obejmującego cały odcinek —
    // gdy średnie pokrycie jest zerowe, marsz się nie zaczyna (większość tarczy to czyste niebo)
    const lodSeg = clamp(log2(max(seg.div(max(U.uCvSky.a, 1e-9)), 1e-6)).add(1.0), lod, 9.0);
    const any = dot(cloudTex.sample(coverUv(xm.div(max(length(xm), 1e-5)), U)).level(lodSeg).rgb, LUM).mul(U.uCvShape.w);
    // warstwa średnia wchodzi do marszu w chwili, gdy promień schodzi poniżej jej wysokości (wieże wystają ponad nią)
    const midDone = float(0.0).toVar();
    // światło słońca liczone RAZ na piksel — na wierzchu chmury nad pierwszą wyraźnie gęstą próbką marszu:
    // grubość optyczna ku słońcu [R]
    const topTau = float(0.0).toVar();
    const topDone = float(0.0).toVar();
    P.storm = st;
    If(dt.greaterThan(1e-7).and(max(any, st).greaterThan(0.02)), () => {
      Loop({ start: int(0), end: nS, type: 'int', condition: '<' }, ({ i }) => {
        // promień trafiający w planetę kończy się przy podstawie powłoki, gdzie leży większość chmur (ławy to ~1/5
        // jej grubości) — próbki gęstsze ku końcowi odcinka: równy krok dawał w cienkiej warstwie 2–3 próbki
        // i ziarno od przesunięcia startu
        const u = jit.add(float(i)).div(float(nS)).toVar();
        const w1 = max(float(1.0).sub(u), 0.0).toVar();
        const x = R.o.add(R.rd.mul(R.t0.add(seg.mul(mix(u, float(1.0).sub(w1.pow(CLOUD_STEP_BIAS)), R.hit))))).toVar();
        const dtI = dt.mul(mix(float(1.0), w1.pow(CLOUD_STEP_BIAS - 1).mul(CLOUD_STEP_BIAS), R.hit)).toVar();
        If(midDone.lessThan(0.5).and(heightIn(x, U).lessThan(M.hMid)), () => {
          col.addAssign(midC.mul(midA).mul(Tr));
          Tr.mulAssign(float(1.0).sub(midA));
          midDone.assign(1.0);
        });
        // pokrycie z mapy raz na krok — służy też bliskiej próbce światła (leży ułamek teksela mapy dalej). Poziom
        // mipmapy co najmniej 1,2: grzbiet pokrycia o szerokości teksela mapy (obwódka układu chmur) dawał w bryle
        // cienki jasny obrys wzdłuż brzegu masy
        const cov = stormCover(coverAt(x, U, max(lod, 1.2)), st).toVar();
        const stepH = dtI.mul(abs(dot(R.rd, normalize(x)))).div(thick);
        const S0 = cloudShape(x, P, cov, reg, { lodW, sharp, detail: { w: detW, fine: U.uCvNoise.y }, stepH });
        const d = float(0.0).toVar();
        d.assign(eroded(S0, erodeK));
        If(d.greaterThan(0.004), () => {
          // nocna strona (poza pasem zmierzchu) — bez próbek światła: chmura tylko zasłania
          const mu = dot(normalize(x), sun).toVar();
          const S = vec3(0.0).toVar();
          const a = float(0.0).toVar();
          a.assign(float(1.0).sub(exp(d.mul(sigma).mul(dtI).negate())));
          If(mu.greaterThan(-0.2), () => {
            If(topDone.lessThan(0.5).and(d.greaterThan(0.12)), () => {
              topDone.assign(1.0);
              // wierzch chmury nad próbką (ciągły między pikselami — nie zależy od tego, w którym kroku marsz
              // pierwszy raz trafił w chmurę)
              const xt = x.add(normalize(x).mul(S0.topUp.mul(thick))).toVar();
              // dwie bliskie próbki z kłębami i drobnym szczegółem: strona od słońca jasna, odsłoneczna i szczeliny
              // między kłębami ciemne
              for (const o of [0.07, 0.2]) {
                const Sn = cloudShape(xt.add(sun.mul(thick.mul(o))), P, cov, reg, { lodW, sharp, detail: { w: detW, fine: U.uCvNoise.y } });
                topTau.addAssign(max(Sn.sheet, Sn.d).mul(Sn.fade).mul(thick.mul(0.15)));
              }
              // dalekie próbki aż do stropu powłoki (bez szumu kłębów: masa i wieże) — wysoka chmura rzuca długi cień
              // na niższe. Odstępy stałe: przesunięcie szumem piksela dawało ziarno w litej chmurze
              const span = min(max(float(1.0).sub(S0.hN.add(S0.topUp)), 0.0).mul(thick).div(max(mu, 0.09)), 0.1).toVar();
              for (let k = 0; k < CLOUD_LIGHT_FAR; k++) {
                const xs = xt.add(sun.mul(span.mul((k + 0.6) / CLOUD_LIGHT_FAR))).toVar();
                const cs = stormCover(coverAt(xs, U, lod.add(1.5)), st).toVar();
                const Sf = cloudShape(xs, P, cs, reg, { puffs: false });
                topTau.addAssign(max(Sf.sheet, Sf.d).mul(Sf.fade).mul(span.div(CLOUD_LIGHT_FAR)));
              }
            });
            // głębsze próbki: własna chmura nad próbką — z grubości optycznej przebytej po promieniu widzenia do
            // środka kroku (ciągła w obrazie)
            const selfOd = log2(max(Tr.mul(sqrt(float(1.0).sub(a))), 0.03)).mul(-0.6931472 * 0.5);
            // (burza: chmura gęstsza optycznie — strona odsłoneczna i szczeliny wyraźnie ciemniejsze)
            const od = topTau.mul(sigma).add(selfOd).mul(st.mul(0.8).add(1.0));
            // osłabienie wprost + wolniej gasnący człon (światło rozproszone wielokrotnie we wnętrzu chmury)
            const lightT = exp(od.negate()).mul(0.7).add(exp(od.mul(-0.14)).mul(0.3));
            // światło nieba: wierzchołki jaśniejsze niż podstawy, tylko po dziennej stronie; drobne kłębki: wypukłość
            // jaśniejsza, wklęsłość ciemniejsza (światło nieba nie dochodzi do szczelin)
            // burza: poniżej kowadła barwa stalowa, mniej światła nieba
            const dark = st.mul(float(1.0).sub(smoothstep(0.55, 0.85, S0.hN)));
            S.assign(lightAt(x, mu, lightT.mul(clamp(S0.det.mul(2.2).add(1.0), 0.7, 1.2)), S0.hN.mul(0.7).add(0.3).mul(float(1.0).sub(st.mul(0.45))))
              .mul(mix(vec3(1.0), vec3(0.7, 0.75, 0.84), dark.mul(0.6))));
          });
          // BŁYSKI PIORUNÓW: światło WEWNĄTRZ chmury (bez cienia, także po nocnej stronie) — poświata wokół miejsca
          // błysku i jasne jądro; barwa niebieskawobiała
          If(flashOn.greaterThan(0.001), () => {
            const fl = float(0.0).toVar();
            const rx = length(x);
            for (const F of flashes) {
              const dv = x.sub(F.xyz);
              const d2 = dot(dv, dv);
              // światło idzie z wnętrza chmury ku górze: wysokie kopuły nad błyskiem ciemniejsze niż szczeliny przy nim
              const up = max(rx.sub(length(F.xyz)), 0.0).div(thick);
              fl.addAssign(F.w.mul(exp(d2.div(-CLOUD_FLASH.glow * CLOUD_FLASH.glow)).mul(0.45).add(exp(d2.div(-CLOUD_FLASH.core * CLOUD_FLASH.core)))).mul(exp(up.mul(-1.6))));
            }
            // (drobne kłębki: wklęsłość jaśniejsza niż wypukłość — odwrotnie niż w świetle słońca; bez tego błysk
            // jest gładką plamą jak lampa)
            S.addAssign(U.uCvTint.mul(vec3(0.72, 0.84, 1.0)).mul(fl.mul(CLOUD_FLASH.gain)).mul(clamp(float(1.0).sub(S0.det.mul(5.0)), 0.5, 1.6)));
          });
          col.addAssign(S.mul(a).mul(Tr));
          Tr.mulAssign(float(1.0).sub(a));
        });
        If(Tr.lessThan(0.03), () => { Break(); });
      });
    });
    If(midDone.lessThan(0.5), () => {
      col.addAssign(midC.mul(midA).mul(Tr));
      Tr.mulAssign(float(1.0).sub(midA));
    });
    // warstwa wysoka leży nad wszystkim
    return vec4(hiC.mul(hiA).add(col.mul(float(1.0).sub(hiA))), float(1.0).sub(Tr.mul(float(1.0).sub(hiA))));
  })();
  return { positionNode, fragmentNode };
}

/** Materiał chmur-bryły (kula jednostkowa; barwa pomnożona przez krycie). */
export function createGenCloudVolumeMaterial(uniforms) {
  if (!graph) graph = build();
  return shellMaterial('PlanetGenCloudVolume', graph, uniforms, 'over');
}

/**
 * Uniformy chmur-bryły z opisu planety i map (`maps.clouds` — z mipmapami). Powłoka 0,3–1,7% promienia nad powierzchnią —
 * przesadzona względem prawdziwej (jak cała rzeźba planet gry), żeby chmury było widać z profilu.
 */
export function cloudVolumeUniforms(spec, maps) {
  const c = spec.clouds || {};
  const W = maps.clouds?.image?.width || 2048;
  const deck = c.style === 1;
  const dust = c.style === 2;
  const tint = c.tint || [1, 1, 1];
  return {
    ...shellUniforms(),
    cloudTexture: { value: maps.clouds || null },
    // ekstynkcja: cała powłoka przy gęstości 1 ma grubość optyczną ~10 (brzegi kłębów półprzezroczyste, wnętrze lite)
    uCvShape: { value: new THREE.Vector4(1.003, deck ? 1.012 : 1.017, dust ? 320 : 720, deck ? 1.0 : (dust ? 0.9 : 1.45)) },
    uCvNoise: { value: new THREE.Vector4(23.0, 83.0, dust ? 0.2 : 0.55, 0) },
    uCvTint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]).multiplyScalar(dust ? 0.7 : 0.94) },
    uCvSky: { value: new THREE.Vector4(0.15, 0.2, 0.29, 2 * Math.PI / W) },
    // jasność słońca 0,74: oświetlony wierzchołek ~0,9 (pod progiem bloomu gry), srebrny brzeg pod słońce ponad nim
    uCvMisc: { value: new THREE.Vector4(0.2, 0.65, 0.07, 0.74) },
    uCvWx: { value: new THREE.Vector4(0, 0, 0, 0) },
    // ziemskie: wszystkie rodzaje; pokład (toksyczna): ława z nielicznymi wieżami, bez warstw cienkich; pył: sama masa
    uCvKind: { value: deck ? new THREE.Vector4(0.35, 0, -0.15, 0) : (dust ? new THREE.Vector4(0, 0, 0.1, 0) : new THREE.Vector4(1, 1, 0, 0)) },
    // burze i błyski ustawia ciało co klatkę (planetGenNear.js). Wartości „brak” niezerowe jako wektor (pułapka 46
    // reguły webgpu-tsl: wektor samych zer po kompilacji zostaje na GPU przy wartości z kompilacji)
    ...Object.fromEntries(Array.from({ length: STORM_MAX }, (_, i) => [`uCvSt${i}`, { value: new THREE.Vector4(0, 1, 0, 0) }])),
    ...Object.fromEntries(Array.from({ length: FLASH_MAX }, (_, i) => [`uCvFl${i}`, { value: new THREE.Vector4(2, 0, 0, 0) }]))
  };
}
