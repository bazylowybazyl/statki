// HUTA — element 4 (dzielenie): BRYŁY STAŁE I RUCHOME w siatce otoczenia formowania (czysty JS, rejestrator `Budowniczy`;
// ten sam materiał co hala — `../formowanie/otoczenieTSL.js`). Jawna MAKIETA w jakości pozostałych urządzeń linii (tura
// modelu osobno): pudła ze szwami, żółć maszyn, ciemna stal, lica emiterów pola.
//
//   SZYNY i WÓZKI NOŻA   (runda 8, zasada G — bez zmian) dwie szyny pod poziomem taśmy po obu stronach osi; dwa żółte wózki
//                        (jedna grupa ruchoma — znacznik `DZ_MARK.car` w `aM.z`, przesunięcie w x z krzywki: `OU.dz.x`)
//   RYNNA POD NOŻEM      (runda 9: tylko krótka — krople szczeliny i iskry) koryto x 3480…3610 pod osią
//   LISTWA PRZECHYŁU     (−z) belka z 32 odcinkami emitera po 30 j. (kanał `DZ_KANAL.listwa` + odcinek w części ułamkowej):
//                        odcinek świeci siłą pola na swoim kawałku chwyconej krawędzi (wędrujące pole — shader z `OU.pole`)
//   LISTWA WYRZUTU       (+z) 20 odcinków, świeci w wyrzucie; wisi na dwóch słupach (pod pasem i po +z wolne dla zwijarki)
//   GRZEBIEŃ             6 linii emiterów pola wzdłuż x (z −131…−251) i ramy końcowe (słupki trzymają płyty za końce)
//   POMOST KASET         płyta pod buforem pustej, załadunkiem i odbiorem; tor dowozu pustych do krawędzi −z pokładu
//   KASETY               6 grup ruchomych (`DZ_MARK.ruch0` + k, przesunięcie i jasność pola slotów z `OU.ruch[k]`):
//                        dno z liniami pola slotów, słupki narożne, belki końcowe i dalsza — strona ku grzebieniowi otwarta
//   ŚCIANA CZOŁOWA       brama WYJAZD KASET (−z) z tunelem, otwór PRZETOP w osi z tunelem; strona +z pełna (zwijarki)
//   KURTYNA BRZEGÓW      (§ 7) próg pola wzdłuż krawędzi pokładu strefy (z −1250, z +1150) — jak próg x 3138 (kanał 19)
//   BRAMY KRĘGÓW         (styk etapu 2) ciemne ramy na krawędzi +z pokładu
//   NAPISY               „KASETY”, „WYJAZD KASET ▸”
import { HALA } from '../formowanie/geometria.js';
import { paintText } from '../formowanie/walcowniaBryly.js';
import { ODZ_KANAL } from '../formowanie/odzgorzanie.js';
import { CHWYT, DZIEL, KASETA, PASS_Y, PRZETOP, STOJAK, slotZ } from './geometria.js';

/** Znaczniki grup ruchomych w `aM.z` (shader otoczenia): wózki noża; pierwsza grupa RUCHU (kasety 0…5; 6…15 — etap 2). */
export const DZ_MARK = Object.freeze({ car: 20, ruch0: 23, ruchN: 16 });
/**
 * Kanały pola dzielenia w `OU.pole` (12 × vec4 — kanały 32–47):
 *   32 ostrze (wózki noża, bez zmian), 33 listwa wyrzutu, 34 listwa przechyłu (obie liczone w shaderze z dwóch ciał na
 *   listwie: 36–39 i 40–43 = x tyłu, długość, siła chwytu, siła wyrzutu [/ `F_REF`]), 35 grzebień (siła marszu),
 *   44 lampa bramy WYJAZD KASET, 45 szyny pola pomostu kaset (emitery w grupie ruchu kasety biorą jasność z `OU.ruch[k].w`),
 *   46–47 — STYK etapu 2 (skrętarka, zwijarki; dziś 0).
 */
export const DZ_KANAL = Object.freeze({
  ostrze: 32, wyrzut: 33, listwa: 34, grzebien: 35, slotA: 36, slotB: 40, brama: 44, kaseta: 45, skretarka: 46, zwijarki: 47
});
/** Odcinków listwy przechyłu / wyrzutu (kodowane w części ułamkowej parametru: kanał + (i + 0,5) / 64). */
export const LISTWA_SEG = Math.round((CHWYT.rail.x1 - CHWYT.rail.x0) / CHWYT.rail.seg);
export const WYRZUT_SEG = Math.round((CHWYT.kickRail.x1 - CHWYT.kickRail.x0) / CHWYT.kickRail.seg);
/** Siła odniesienia jasności pola listew [t·j./s²] (wyrzut arkusza 5 t: ok. 2 000). */
export const F_REF = 2000;

const STEEL = [0.14, 0.145, 0.158];
const DARK = [0.045, 0.047, 0.052];
const FRAME = [0.105, 0.108, 0.118];
const HOUSING = [0.085, 0.088, 0.098];
const YELLOW = [0.5, 0.33, 0.04];
const CYAN = [0.2, 0.9, 1.0];
const CYAN_DIM = [0.12, 0.55, 0.62];
const WARM = [1.0, 0.72, 0.42];
const PIT = [0.05, 0.048, 0.047];
const STAL = 8;
const FARBA = 0;
const POLE = 29;
const PASY = 27;
const DECK_Y = HALA.deckY;

/** Słup osiowy od pokładu hali do wysokości y. */
function post(B, x, y, z, hx, hz, y0 = DECK_Y) { B.abox(x, (y + y0) / 2, z, hx, (y - y0) / 2, hz); }

/** Szyny i wózki noża (wózki zbudowane w spoczynku krzywki `X_HOME`; jadą w shaderze). Runda 8 — bez zmian. */
function knife(B) {
  const R = DZIEL.rails;
  const C = DZIEL.car;
  const X = DZIEL.X_HOME;
  for (const sd of [-1, 1]) {
    const zc = sd * (R.z0 + R.z1) / 2;
    B.paint(...FRAME, STAL);
    B.abox((R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2, zc, (R.x1 - R.x0) / 2, (R.y1 - R.y0) / 2, (R.z1 - R.z0) / 2);
    B.paint(...DARK, STAL);
    B.abox((R.x0 + R.x1) / 2, R.y1 + 0.6, zc, (R.x1 - R.x0) / 2 - 4, 0.6, 3);
    B.paint(...STEEL, STAL);
    for (let x = R.x0 + 30; x < R.x1; x += 100) post(B, x, R.y0, zc, 7, 9);
    B.paint(...YELLOW, FARBA);
    B.abox(R.x0 + 5, R.y1 + 6, zc, 5, 6, 12);
    B.abox(R.x1 - 5, R.y1 + 6, zc, 5, 6, 12);
  }
  B.move(0, 0, DZ_MARK.car);
  for (const sd of [-1, 1]) {
    const z0 = C.z0;
    const z1 = C.z1;
    const zc = sd * (z0 + z1) / 2;
    B.paint(...DARK, STAL);
    B.abox(X, (R.y1 + C.y0) / 2, sd * (R.z0 + R.z1) / 2, C.hx - 4, (C.y0 - R.y1) / 2, 16);
    B.paint(...YELLOW, FARBA);
    B.abox(X, (C.y0 + C.y1) / 2 - 4, sd * (z0 + 2 + z1) / 2, C.hx, (C.y1 - C.y0) / 2 - 4, (z1 - z0 - 2) / 2);
    B.paint(...HOUSING, STAL);
    B.abox(X, C.y1 - 2, zc + sd * 6, C.hx - 6, 2, (z1 - z0) / 2 - 10);
    B.paint(...YELLOW, PASY, 0);
    B.abox(X - C.hx - 0.4, (C.y0 + C.y1) / 2 - 4, zc, 0.4, (C.y1 - C.y0) / 2 - 10, (z1 - z0) / 2 - 6);
    B.abox(X + C.hx + 0.4, (C.y0 + C.y1) / 2 - 4, zc, 0.4, (C.y1 - C.y0) / 2 - 10, (z1 - z0) / 2 - 6);
    B.paint(...HOUSING, STAL);
    B.abox(X, (C.fy0 + C.fy1) / 2, sd * (C.z0 + 8), C.hx - 8, (C.fy1 - C.fy0) / 2 + 4, 6);
    B.paint(...CYAN, POLE, DZ_KANAL.ostrze);
    B.abox(X, (C.fy0 + C.fy1) / 2, sd * (C.z0 + 1), C.hx - 12, (C.fy1 - C.fy0) / 2, 1);
    B.abox(X + C.hx - 12, C.y1 + 0.5, zc, 5, 0.5, 5);
  }
  B.move(0, 0, 0);
}

/** Krótka rynna pod nożem (krople szczeliny, iskry): dno, ściany, krawędzie, czoło i koniec. */
function kerfChute(B) {
  const H = DZIEL.kerf;
  const t = 4;
  const yMid = (H.yFloor + H.yTop) / 2;
  const yHalf = (H.yTop - H.yFloor) / 2;
  const xm = (H.x0 + H.x1) / 2;
  const hx = (H.x1 - H.x0) / 2;
  B.paint(...PIT, STAL);
  B.abox(xm, H.yFloor - 3, 0, hx, 3, H.hz + t);
  for (const sd of [-1, 1]) B.abox(xm, yMid, sd * (H.hz + t / 2), hx, yHalf, t / 2);
  B.abox(H.x0 - t / 2, yMid, 0, t / 2, yHalf, H.hz + t);
  B.abox(H.x1 - t / 2, yMid, 0, t / 2, yHalf, H.hz + t);
  B.paint(...HOUSING, STAL);
  for (const sd of [-1, 1]) B.abox(xm, H.yTop - 4, sd * (H.hz + t + 2.5), hx, 3, 2.5);
  B.paint(...STEEL, STAL);
  for (const sd of [-1, 1]) post(B, xm, H.yFloor - 6, sd * (H.hz - 12), 6, 6);
}

/** Listwa (belka emiterów pola z odcinkami): obudowa, lico wierzchu z odcinkami, lico od strony pasa. */
function rail(B, R, ch, nSeg, sd) {
  const zc = (R.z0 + R.z1) / 2;
  const hz = (R.z1 - R.z0) / 2;
  // (obudowa i lica nie wychodzą ku pasmu poza krawędź listwy |z| = 110 — nad pasmem nic)
  B.paint(...HOUSING, STAL);
  B.abox((R.x0 + R.x1) / 2, R.y0 - 4, zc + sd * 0.5, (R.x1 - R.x0) / 2, 4, hz + 0.5);
  B.paint(...DARK, STAL);
  B.abox((R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2 - 0.5, zc, (R.x1 - R.x0) / 2, (R.y1 - R.y0) / 2 - 0.5, hz);
  for (let i = 0; i < nSeg; i++) {
    const x0 = R.x0 + R.seg * i;
    B.paint(...CYAN, POLE, ch + (i + 0.5) / 64);
    // wierzch odcinka (krawędź arkusza leży nad nim) i lico ku pasmu
    B.abox(x0 + R.seg / 2, R.y1 - 0.4, zc, R.seg / 2 - 0.6, 0.4, hz - 0.5);
    B.abox(x0 + R.seg / 2, (R.y0 + R.y1) / 2, sd > 0 ? R.z0 + 0.3 : R.z1 - 0.3, R.seg / 2 - 0.6, (R.y1 - R.y0) / 2 - 0.8, 0.3);
  }
  // szwy między odcinkami (ciemne) widać z kamery gry jako podział listwy
  B.paint(...YELLOW, FARBA);
  B.abox(R.x0 - 2, (R.y0 + R.y1) / 2 - 2, zc, 2, (R.y1 - R.y0) / 2 + 2, hz);
  B.abox(R.x1 + 2, (R.y0 + R.y1) / 2 - 2, zc, 2, (R.y1 - R.y0) / 2 + 2, hz);
}

/** Listwy: przechyłu (−z, wspornik od −z co 158 j.) i wyrzutu (+z, wisi na dwóch słupach na końcach). */
function rails(B) {
  const R = CHWYT.rail;
  rail(B, R, DZ_KANAL.listwa, LISTWA_SEG, -1);
  B.paint(...STEEL, STAL);
  for (let x = R.x0 + 40; x < R.x1; x += 158) post(B, x, R.y0 - 8, CHWYT.postZ, 5, 5);
  const K = CHWYT.kickRail;
  rail(B, K, DZ_KANAL.wyrzut, WYRZUT_SEG, 1);
  B.paint(...STEEL, STAL);
  for (const x of CHWYT.hangX) {
    post(B, x, K.y1 + 6, CHWYT.hangZ, 4, 6);
    B.abox(x, K.y1 + 3, (CHWYT.hangZ + K.z1) / 2, 4, 3, (CHWYT.hangZ - K.z1) / 2 + 2);
  }
  B.paint(...YELLOW, PASY, 0);
  for (const x of CHWYT.hangX) B.abox(x, K.y1 + 6.4, CHWYT.hangZ, 5, 0.4, 7);
}

/** Grzebień: linie emiterów pola (z −131 … −251) i ramy końcowe z licem pola od strony płyt. */
function comb(B) {
  const S = STOJAK;
  const Lx = S.line;
  const F = S.frame;
  B.paint(...CYAN, POLE, DZ_KANAL.grzebien);
  for (let k = 1; k <= S.buf; k++) {
    const z = S.zIn - S.pitch * k - 4.5;
    B.abox((Lx.x0 + Lx.x1) / 2, Lx.y - 0.8, z, (Lx.x1 - Lx.x0) / 2, 0.8, Lx.hw);
  }
  B.paint(...DARK, STAL);
  for (let k = 1; k <= S.buf; k++) {
    const z = S.zIn - S.pitch * k - 4.5;
    B.abox((Lx.x0 + Lx.x1) / 2, Lx.y - 3.2, z, (Lx.x1 - Lx.x0) / 2, 1.6, Lx.hw + 1.4);
  }
  for (const [x0, x1, inner] of [[F.xa0, F.xa1, F.xa1], [F.xb0, F.xb1, F.xb0]]) {
    const xm = (x0 + x1) / 2;
    const hx = (x1 - x0) / 2;
    B.paint(...YELLOW, FARBA);
    for (const z of [F.z0 + 5, F.z1 - 5]) post(B, xm, F.yTop, z, hx, 5);
    B.abox(xm, F.yTop - 4, (F.z0 + F.z1) / 2, hx, 4, (F.z1 - F.z0) / 2);
    B.paint(...HOUSING, STAL);
    B.abox(xm, Lx.y - 4, (F.z0 + F.z1) / 2, hx, 4, (F.z1 - F.z0) / 2);
    // lico pola końca (trzyma płyty za końce): wąskie listwy emitera na wewnętrznej stronie ramy na wysokości płyt
    B.paint(...CYAN, POLE, DZ_KANAL.grzebien);
    const sx = inner === x1 ? 0.3 : -0.3;
    for (const yy of [Lx.y + 30, Lx.y + 170]) B.abox(inner + sx, yy, (F.z0 + F.z1) / 2, 0.3, 1.2, (F.z1 - F.z0) / 2 - 8);
  }
  B.paint(...YELLOW, PASY, 1);
  B.abox(F.xa0 - 6, DECK_Y + 0.6, (F.z0 + F.z1) / 2, 4, 0.6, (F.z1 - F.z0) / 2);
}

/** Pomost kaset (bufor pustej, załadunek, odbiór), szyny pola pod kasetami, tor dowozu pustych. */
function deckOfCassettes(B) {
  const K = KASETA;
  const D = K.deck;
  const top = D.y;
  const plate = (x0, x1, z0, z1) => {
    B.paint(...FRAME, STAL);
    B.abox((x0 + x1) / 2, top - 5, (z0 + z1) / 2, (x1 - x0) / 2, 5, (z1 - z0) / 2);
    B.paint(...STEEL, STAL);
    for (let x = x0 + 40; x < x1; x += 230) for (const z of [z0 + 20, z1 - 20]) post(B, x, top - 10, z, 8, 8);
  };
  plate(D.x0, K.x0, K.z0 + 2, K.z1 - 2);                     // bufor pustej
  plate(K.x0, D.x1, D.zb0, K.z1 - 2);                        // załadunek i odbiór
  // szyny pola pod kasetą (wzdłuż ruchu): bufor → załadunek (x), załadunek → odbiór (z)
  B.paint(...CYAN_DIM, POLE, DZ_KANAL.kaseta);
  for (const z of [K.z0 + 12, K.z1 - 12]) B.abox((D.x0 + D.x1) / 2, top + 0.4, z, (D.x1 - D.x0) / 2 - 6, 0.4, 2);
  for (const x of [K.x0 + 30, K.x1 - 30]) B.abox(x, top + 0.4, (D.zb0 + K.z0) / 2, 2, 0.4, (K.z0 - D.zb0) / 2 - 4);
  // tor dowozu pustych: od krawędzi −z pokładu do bufora (dwie belki na słupach)
  const zE = HALA.deck.z0;
  B.paint(...FRAME, STAL);
  for (const x of [D.x0 + 20, K.x0 - 25]) {
    B.abox(x, top - 5, (zE + K.z0) / 2, 12, 5, (K.z0 - zE) / 2);
    for (let z = zE + 60; z < K.z0; z += 200) post(B, x, top - 10, z, 6, 6);
  }
  B.paint(...CYAN_DIM, POLE, DZ_KANAL.kaseta);
  for (const x of [D.x0 + 20, K.x0 - 25]) B.abox(x, top + 0.4, (zE + K.z0) / 2, 2, 0.4, (K.z0 - zE) / 2 - 4);
  B.paint(...YELLOW, PASY, 0);
  B.abox((K.x0 + D.x1) / 2, top + 0.5, D.zb0 - 6, (D.x1 - K.x0) / 2, 0.5, 5);
}

/** Kaseta k (grupa ruchoma, zbudowana w miejscu załadunku). */
function cassette(B, k) {
  const K = KASETA;
  B.move(0, 0, DZ_MARK.ruch0 + k);
  // dno z liniami pola slotów (8)
  B.paint(...HOUSING, STAL);
  B.abox((K.x0 + K.x1) / 2, (K.y0 + K.yD) / 2, (K.z0 + K.z1) / 2, (K.x1 - K.x0) / 2, (K.yD - K.y0) / 2, (K.z1 - K.z0) / 2);
  B.paint(...DARK, STAL);
  B.abox((K.x0 + K.x1) / 2, K.yD + 0.2, (K.z0 + K.z1) / 2, (K.x1 - K.x0) / 2 - 22, 0.2, (K.z1 - K.z0) / 2 - 4);
  B.paint(...CYAN, POLE, DZ_KANAL.kaseta);
  for (let s = 0; s < K.n; s++) B.abox((CHWYT.xStop + CHWYT.xStop + 640) / 2, K.yD + 0.6, slotZ(s) - 4.5, 318, 0.4, 1.4);
  // słupki narożne, belki końcowe (wierzch i dół), belka dalsza (strona ku grzebieniowi otwarta)
  B.paint(...YELLOW, FARBA);
  for (const x of [K.x0 + 10, K.x1 - 10]) for (const z of [K.z0 + 5, K.z1 - 5]) B.abox(x, (K.yD + K.y1) / 2, z, 10, (K.y1 - K.yD) / 2, 5);
  for (const x of [K.x0 + 10, K.x1 - 10]) B.abox(x, K.y1 - 5, (K.z0 + K.z1) / 2, 10, 5, (K.z1 - K.z0) / 2);
  B.paint(...FRAME, STAL);
  B.abox((K.x0 + K.x1) / 2, K.y1 - 4, K.z0 + 3, (K.x1 - K.x0) / 2 - 20, 4, 3);
  B.abox((K.x0 + K.x1) / 2, K.yD + 8, K.z0 + 3, (K.x1 - K.x0) / 2 - 20, 4, 3);
  // lico pola końców (od strony płyt): wąskie listwy emitera na wysokości dolnej i górnej części płyt
  B.paint(...CYAN, POLE, DZ_KANAL.kaseta);
  for (const x of [K.x0 + 20.3, K.x1 - 20.3]) for (const yy of [K.yD + 30, K.yD + 170]) B.abox(x, yy, (K.z0 + K.z1) / 2, 0.3, 1.2, (K.z1 - K.z0) / 2 - 12);
  // pasy na belkach końcowych (wierzch — kaseta z kamery gry ma żółto-czarne końce)
  B.paint(...YELLOW, PASY, 0);
  for (const x of [K.x0 + 10, K.x1 - 10]) B.abox(x, K.y1 + 0.4, (K.z0 + K.z1) / 2, 9, 0.4, (K.z1 - K.z0) / 2 - 2);
  B.move(0, 0, 0);
}

/** Ściana czołowa: brama WYJAZD KASET (−z) z tunelem, otwór PRZETOP w osi z tunelem, reszta pełna. */
function wall(B) {
  const Wl = DZIEL.wall;
  const E = DZIEL.exit;
  const D = HALA.deck;
  const xm = (Wl.x0 + Wl.x1) / 2;
  const hx = (Wl.x1 - Wl.x0) / 2;
  const yt = Wl.yTop;
  const PZ = PRZETOP;
  B.paint(...HOUSING, STAL);
  // pełne pasy ściany: [z0, −exit.z1], [exit.z0, −hz], [hz, z1] — otwór bramy z E.z0…E.z1 (ujemne), otwór przetopu |z| ≤ hz
  const zs = [D.z0, E.z0, E.z1, -PZ.hz, PZ.hz, D.z1];
  for (let k = 0; k < zs.length; k += 2) post(B, xm, yt, (zs[k] + zs[k + 1]) / 2, hx, (zs[k + 1] - zs[k]) / 2);
  // pod i nad bramą kaset (nadproże do yL)
  post(B, xm, E.y0, (E.z0 + E.z1) / 2, hx, (E.z1 - E.z0) / 2);
  B.abox(xm, (E.y1 + E.yL) / 2, (E.z0 + E.z1) / 2 , hx, (E.yL - E.y1) / 2, (E.z1 - E.z0) / 2 + 20);
  // pod i nad otworem przetopu
  post(B, xm, PZ.y0, 0, hx, PZ.hz);
  B.abox(xm, (PZ.y1 + yt) / 2, 0, hx, (yt - PZ.y1) / 2, PZ.hz);
  // obramowania (żółte) i lampa bramy (kanał bramy)
  B.paint(...YELLOW, PASY, 0);
  B.abox(Wl.x0 - 0.5, E.y1 + 4, (E.z0 + E.z1) / 2, 0.5, 4, (E.z1 - E.z0) / 2 + 6);
  for (const z of [E.z0 - 4, E.z1 + 4]) B.abox(Wl.x0 - 0.5, (E.y0 + E.y1) / 2, z, 0.5, (E.y1 - E.y0) / 2, 4);
  B.abox(Wl.x0 - 0.5, PZ.y1 + 4, 0, 0.5, 4, PZ.hz + 6);
  for (const z of [-PZ.hz - 4, PZ.hz + 4]) B.abox(Wl.x0 - 0.5, (PZ.y0 + PZ.y1) / 2, z, 0.5, (PZ.y1 - PZ.y0) / 2, 4);
  B.paint(...WARM, POLE, DZ_KANAL.brama);
  B.abox(Wl.x0 - 3, E.y1 + 14, (E.z0 + E.z1) / 2, 3, 3, (E.z1 - E.z0) / 2 - 20);
  B.abox(xm, E.yL + 1, (E.z0 + E.z1) / 2, 6, 1, (E.z1 - E.z0) / 2 - 30);
  // TUNEL WYJAZDU KASET za ścianą (dach, ściany, dno, czoło) — kaseta znika w nim
  B.paint(...DARK, STAL);
  {
    const x0 = Wl.x1;
    const x1 = Wl.x1 + KASETA.exit.dx;
    const zc = (E.z0 + E.z1) / 2;
    const hz = (E.z1 - E.z0) / 2;
    B.abox((x0 + x1) / 2, E.y1 + 6, zc, (x1 - x0) / 2, 6, hz + 10);
    B.abox((x0 + x1) / 2, E.y0 - 6, zc, (x1 - x0) / 2, 6, hz + 10);
    for (const e of [-1, 1]) B.abox((x0 + x1) / 2, (E.y0 + E.y1) / 2, zc + e * (hz + 5), (x1 - x0) / 2, (E.y1 - E.y0) / 2 + 6, 5);
    B.abox(x1 + 5, (E.y0 + E.y1) / 2, zc, 5, (E.y1 - E.y0) / 2 + 12, hz + 10);
    B.paint(...YELLOW, PASY, 0);
    B.abox((x0 + x1) / 2, E.y1 + 12.5, zc, (x1 - x0) / 2, 0.5, 8);
  }
  // TUNEL PRZETOPU za ścianą (dach — odpad znika pod nim; dno, ściany, czoło)
  B.paint(...DARK, STAL);
  {
    const x0 = Wl.x1;
    const x1 = PZ.x1;
    const hz = PZ.hz + 10;
    B.abox((x0 + x1) / 2, PZ.y1 + 6, 0, (x1 - x0) / 2, 6, hz + 6);
    B.abox((x0 + x1) / 2, PZ.y0 - 6, 0, (x1 - x0) / 2, 6, hz + 6);
    for (const e of [-1, 1]) B.abox((x0 + x1) / 2, (PZ.y0 + PZ.y1) / 2, e * (hz + 3), (x1 - x0) / 2, (PZ.y1 - PZ.y0) / 2 + 6, 3);
    B.abox(x1 + 5, (PZ.y0 + PZ.y1) / 2, 0, 5, (PZ.y1 - PZ.y0) / 2 + 12, hz + 6);
    B.paint(...YELLOW, PASY, 1);
    B.abox((x0 + x1) / 2, PZ.y1 + 12.5, 0, (x1 - x0) / 2, 0.5, 8);
  }
  // pasy na koronie ściany
  B.paint(...YELLOW, PASY, 1);
  B.abox(xm, yt + 0.5, (D.z0 + D.z1) / 2, hx - 4, 0.5, (D.z1 - D.z0) / 2 - 20);
}

/** Kurtyna osłony wzdłuż brzegów pokładu strefy (z0 / z1 pokładu) — próg pola jak na x 3138 (kanał stacji). */
function edgeCurtain(B) {
  const D = HALA.deck;
  const x0 = 3138;
  const x1 = DZIEL.wall.x0;
  for (const [z, s] of [[D.z0 + 8, 1], [D.z1 - 8, -1]]) {
    B.paint(...FRAME, STAL);
    B.abox((x0 + x1) / 2, DECK_Y + 3.5, z, (x1 - x0) / 2, 3.5, 3);
    B.paint(...CYAN_DIM, POLE, ODZ_KANAL);
    B.abox((x0 + x1) / 2, DECK_Y + 7.4, z, (x1 - x0) / 2 - 2, 0.4, 1.6);
    B.paint(...YELLOW, PASY, 1);
    B.abox((x0 + x1) / 2, DECK_Y + 0.6, z + s * 8, (x1 - x0) / 2, 0.6, 4);
    B.paint(...HOUSING, STAL);
    // słupy kurtyny (po stronie +z tylko przed strefą zwijarek — x < 4400)
    for (let x = x0 + 200; x < (s < 0 ? 4400 : x1); x += 400) post(B, x, DECK_Y + 60, z, 6, 6);
  }
}

/** Bramy KRĘGÓW (styk etapu 2): ciemne ramy na krawędzi +z pokładu. */
function coilGates(B) {
  const z = HALA.deck.z1 - 20;
  B.paint(...DARK, STAL);
  for (const [x0, x1] of [[3700, 3990], [4050, 4340]]) {
    for (const x of [x0 - 8, x1 + 8]) post(B, x, -1040, z, 8, 8);
    B.abox((x0 + x1) / 2, -1036, z, (x1 - x0) / 2 + 16, 4, 8);
  }
}

/** Napisy: „KASETY” przy torze dowozu, „WYJAZD KASET ▸” przy odbiorze. */
function labels(B) {
  B.paint(0.55, 0.42, 0.08, FARBA);
  const px = 7;
  paintText(B, 'KASETY', 3440, DECK_Y, -1000, px);
  const pw = 5;
  const w = paintText(B, 'WYJAZD KASET', 4040, DECK_Y, -800, pw);
  paintText(B, '>', 4040 + w + 3 * pw, DECK_Y, -800, pw);
}

/** Wszystkie bryły dzielenia (wołane z `buildFormingStatic`). */
export function buildDivider(B) {
  B.move(0, 0, 0);
  knife(B);
  kerfChute(B);
  rails(B);
  comb(B);
  deckOfCassettes(B);
  for (let k = 0; k < 6; k++) cassette(B, k);
  wall(B);
  edgeCurtain(B);
  coilGates(B);
  labels(B);
  B.move(0, 0, 0);
  void PASS_Y;
}

/** Prostopadłościany brył stałych dzielenia [x0, x1, y0, y1, z0, z1] (testy kolizji: listwy, grzebień, pomost, ściana). */
export function dividerBoxes() {
  const R = CHWYT.rail;
  const K = CHWYT.kickRail;
  const F = STOJAK.frame;
  const E = DZIEL.exit;
  const PZ = PRZETOP;
  const Wl = DZIEL.wall;
  return [
    { id: 'listwaPrzechylu', b: [R.x0 - 4, R.x1 + 4, R.y0 - 8, R.y1, R.z0 - 2, R.z1 + 1] },
    { id: 'listwaWyrzutu', b: [K.x0 - 4, K.x1 + 4, K.y0 - 8, K.y1, K.z0 - 1, K.z1 + 2] },
    { id: 'ramaGrzebieniaA', b: [F.xa0, F.xa1, HALA.deckY, F.yTop, F.z0, F.z1] },
    { id: 'ramaGrzebieniaB', b: [F.xb0, F.xb1, HALA.deckY, F.yTop, F.z0, F.z1] },
    { id: 'scianaDol', b: [Wl.x0, Wl.x1, HALA.deckY, PZ.y0, -PZ.hz, PZ.hz] },
    { id: 'scianaGora', b: [Wl.x0, Wl.x1, PZ.y1, Wl.yTop, -PZ.hz, PZ.hz] },
    { id: 'scianaPlus', b: [Wl.x0, Wl.x1, HALA.deckY, Wl.yTop, PZ.hz, HALA.deck.z1] },
    { id: 'scianaMinus', b: [Wl.x0, Wl.x1, HALA.deckY, Wl.yTop, E.z1, -PZ.hz] },
    { id: 'scianaKraniec', b: [Wl.x0, Wl.x1, HALA.deckY, Wl.yTop, HALA.deck.z0, E.z0] },
    { id: 'pomost', b: [KASETA.deck.x0, KASETA.deck.x1, KASETA.deck.y - 10, KASETA.deck.y, KASETA.deck.zb0, KASETA.z1 - 2] }
  ];
}
