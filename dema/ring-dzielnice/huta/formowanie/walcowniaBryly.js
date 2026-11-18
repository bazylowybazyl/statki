// HUTA — formowanie, etap „Walcowanie”: BRYŁY WALCOWNI (czysty JS, rejestrator `Budowniczy`; ta sama siatka i materiał
// co otoczenie — `otoczenie.js` / `otoczenieTSL.js`).
//
//   KLATKI F1–F3   walce R 80 gładkie obrotowo (beczka |z| ≤ 135 z fazą, czoło, szyjki do poduszek), poduszki łożysk
//                  w oknach dwóch STOJAKÓW (po bokach pasma, |z| 205…255 — nad pasmem leżą tylko walce), kapsuły
//                  docisku nad górnymi poduszkami, poprzeczki stojaków; od strony napędu (−z) wrzeciona przegubowe do
//                  KLATKI ZĘBATEJ i SILNIKA na pokładzie (nad kanałem kablowym). Walce: rodzaj `walec`, parametr = 2·k +
//                  (1 — górny); wzór obraca shader kątem walca z symulacji (`OU.mill`).
//   PĘTLOWNIKI     polowe na RAMIENIU WAHLIWYM (runda 7): oś wahań na cokołach po bokach taśmy (|z| = `WALC.armZ`),
//                  dwa żółte ramiona poza krawędzią taśmy (widać je z góry), na końcu głowica — poprzeczka pod pętlą z listwą
//                  emitera pola (kanał 16 / 17, siła z regulatora pętli). Głowica idzie za pętlą bez dotyku (`armClr` pod
//                  szczytem): ramię obraca shader otoczenia wokół osi wahań kątem z symulacji (`OU.loop`, znacznik w `aM.z`
//                  = `ARM_MARK` + przęsło).
//   NOŻE C3        poprzeczne rozdzielacze gazu POD taśmą (szczeliny ku taśmie) i kolektory boczne (bez belek nad taśmą).
//   (runda 8: brama „DO ZWIJARKI” z osłoną tunelu usunięta — za F3 stoi nóż polowy dzielenia, `../dzielenie/bryly.js`;
//   strefę tunelu z grafów usunie etap obrazu)
import { HALA, LINIA } from './geometria.js';
import { ARM_REST, WALC, armAngleFor, rollCenters } from './walcownia.js';
// (runda 9, „Czysta stal”) stacja odzgorzania za F3 i kurtyna osłony (argon) — `odzgorzanie.js`
import { buildDescaler } from './odzgorzanie.js';
import { DZIEL, PRZETOP } from '../dzielenie/geometria.js';

/** Rodzaje (zgodne z `OTO` w `otoczenie.js`). */
export const OTO_WALC = Object.freeze({ walec: 33 });
/** Kanały siły pola pętlowników (po 16 kanałach linii — `OU.pole` ma 5 × vec4). */
export const POLE_PETLA = Object.freeze([16, 17]);
/** Wymiary brył walcowni [j.]. */
export const KLATKA = Object.freeze({
  barrel: 135, chamfer: 4, neck: 46, neckEnd: 300, chockZ0: 192, chockZ1: 268, chockHx: 58, chockHy: 52,
  postX0: 62, postX1: 94, postZ0: 205, postZ1: 255, capR: 30, beamH: 16,
  spindleZ: 560, pinionZ1: 640, motorZ1: 850, motorR: 78
});
/** Znacznik wierzchołków ramienia pętlownika w `aM.z` (`ARM_MARK` + numer przęsła) — obrót w shaderze. */
export const ARM_MARK = 10;
/** Oś wahań ramienia pętlownika przęsła j: [x, y] (układ komory). */
export function armPivot(j) { return [WALC.spans[j].xm + WALC.armDx, HALA.passY + WALC.armDy]; }
/** Lampa o jasności z symulacji (parametr lampy < 0): obramówka wlotu bramy i światło robocze tunelu — `OU.loop.z`. */
export const LAMPA_BRAMY = -1;
/** Osłona tunelu bramy „DO ZWIJARKI”: x od…do, półszerokość, wysokość dachu nad osią, szczelina czoła (pół-wys., pół-szer.). */
// (runda 8, „Dzielenie”: brama „DO ZWIJARKI” i osłona tunelu USUNIĘTE — w ich miejscu nóż polowy i gniazda arkuszy; stała
// zostaje tylko dla strefy światła tunelu w grafach pasma i otoczenia, gaszonej uniformem 0 — bez zmiany programów;
// do usunięcia z grafów w etapie obrazu dzielenia)
export const OSLONA = Object.freeze({ x0: 3380 + 14, x1: 3580 + 16, hz: 166, top: 72, bottom: -70, slotY: 13, slotZ: 112, winY0: 14, winY1: 58 });

const STEEL = [0.14, 0.145, 0.158];
const DARK = [0.045, 0.047, 0.052];
const FRAME = [0.105, 0.108, 0.118];
const HOUSING = [0.085, 0.088, 0.098];
const ROLL = [0.13, 0.135, 0.145];
const YELLOW = [0.5, 0.33, 0.04];
const MOTOR = [0.12, 0.125, 0.14];
const CYAN = [0.2, 0.9, 1.0];
const WARM = [1.0, 0.72, 0.42];
const STAL = 8;
const FARBA = 0;
const LAMPA = 3;
const POLE = 29;
const PASY = 27;

/** Słup od wysokości y w dół do pokładu hali (prostokąt hx × hz). */
function post(B, x, y, z, hx, hz, y0 = HALA.deckY) {
  B.abox(x, (y + y0) / 2, z, hx, (y - y0) / 2, hz);
}

/** Walec klatki k (górny / dolny): beczka, faza, czoła, szyjki, sprzęgło od strony napędu. */
function roll(B, k, upper) {
  const K = KLATKA;
  const [x, yu, yl] = rollCenters(k);
  const y = upper ? yu : yl;
  const R = WALC.R;
  const par = 2 * k + (upper ? 1 : 0);
  B.paint(...ROLL, OTO_WALC.walec, par);
  const zb = K.barrel - K.chamfer;
  B.tube(x, y, -zb, x, y, zb, R, R, 96);
  for (const sd of [-1, 1]) {
    B.tube(x, y, sd * zb, x, y, sd * K.barrel, R, R - K.chamfer, 96);
    B.disc(x, y, sd * K.barrel, 0, 0, sd, R - K.chamfer, 96);
    // szyjka przez poduszkę do końca (od strony napędu sprzęgło)
    B.tube(x, y, sd * K.barrel, x, y, sd * K.neckEnd, K.neck, K.neck, 64);
    B.disc(x, y, sd * K.neckEnd, 0, 0, sd, K.neck, 48);
  }
  // sprzęgło (wobbler) na szyjce od strony napędu — rodzaj `walec` (znaczniki obrotu na płaszczu: wzór obraca shader)
  B.paint(...DARK, OTO_WALC.walec, par);
  B.tube(x, y, -K.chockZ1 - 6, x, y, -K.neckEnd + 2, K.neck + 7, K.neck + 7, 48, true);
}

/** Klatka k: stojaki, poduszki, kapsuły, walce, napęd. */
function stand(B, k) {
  const K = KLATKA;
  const [x, yu, yl] = rollCenters(k);
  const yTop = yu + K.chockHy + 70;              // wierzch poprzeczki stojaka
  const y0 = HALA.deckY + 10;                     // wierzch cokołu
  for (const sd of [-1, 1]) {
    const zc = sd * (K.postZ0 + K.postZ1) / 2;
    const hz = (K.postZ1 - K.postZ0) / 2;
    // stojak: dwa słupy okna, poprzeczka górna, próg dolny
    B.paint(...HOUSING, STAL);
    for (const sx of [-1, 1]) post(B, x + sx * (K.postX0 + K.postX1) / 2, yTop, zc, (K.postX1 - K.postX0) / 2, hz, y0);
    B.abox(x, yTop - K.beamH, zc, K.postX1, K.beamH, hz);
    B.abox(x, yl - K.chockHy - 26, zc, K.postX1, 20, hz);
    // poduszki łożysk (górna i dolna) w oknie
    B.paint(...STEEL, STAL);
    for (const y of [yu, yl]) B.abox(x, y, sd * (K.chockZ0 + K.chockZ1) / 2, K.chockHx, K.chockHy, (K.chockZ1 - K.chockZ0) / 2);
    // kapsuła docisku nad górną poduszką (cylinder pionowy) i pokrywa
    B.paint(...DARK, STAL);
    B.tube(x, yu + K.chockHy, zc, x, yTop - 2 * K.beamH, zc, K.capR, K.capR, 32);
    B.paint(...YELLOW, FARBA);
    B.abox(x, yTop + 1.2, zc, K.postX1 - 6, 1.2, hz - 6);
    // przewody hydrauliki (cienkie) po słupie od strony obsługi
    B.paint(...DARK, STAL);
    B.tube(x + K.postX1 + 4, y0, zc + sd * 14, x + K.postX1 + 4, yTop - 10, zc + sd * 14, 3.2, 3.2, 10);
  }
  roll(B, k, true);
  roll(B, k, false);
  // --- napęd od strony −z: wrzeciona przegubowe do klatki zębatej, silnik na cokole -----------------------------------
  const yP = HALA.passY;
  const yPinU = yP + 62;
  const yPinL = yP - 62;
  B.paint(...FRAME, STAL);
  for (const [yr, yp] of [[yu, yPinU], [yl, yPinL]]) {
    const zA = -K.neckEnd - 4;
    const zB = -K.spindleZ + 6;
    B.tube(x, yr, zA, x, yp, zB, 26, 26, 24);
    B.paint(...DARK, STAL);
    B.tube(x, yr, zA + 2, x, yr, zA - 22, 36, 36, 24, true);          // przegub przy walcu
    B.tube(x, yp, zB - 2, x, yp, zB + 22, 36, 36, 24, true);          // przegub przy klatce zębatej
    B.paint(...FRAME, STAL);
  }
  // klatka zębata (skrzynia) i silnik (walec wzdłuż z) na cokołach
  const zPc = -(K.spindleZ + K.pinionZ1) / 2;
  B.paint(...MOTOR, STAL);
  B.abox(x, yP, zPc, 72, 128, (K.pinionZ1 - K.spindleZ) / 2);
  post(B, x, yP - 128, zPc, 60, (K.pinionZ1 - K.spindleZ) / 2 - 8);
  B.paint(...YELLOW, FARBA);
  B.abox(x, yP + 129.5, zPc, 64, 1.5, (K.pinionZ1 - K.spindleZ) / 2 - 8);
  B.paint(...MOTOR, STAL);
  B.tube(x, yP - 30, -K.pinionZ1, x, yP - 30, -K.motorZ1, K.motorR, K.motorR, 48, true);
  // żebra chłodzące silnika (pierścienie)
  B.paint(...DARK, STAL);
  for (let z = K.pinionZ1 + 30; z < K.motorZ1 - 10; z += 32) B.tube(x, yP - 30, -z, x, yP - 30, -z - 6, K.motorR + 6, K.motorR + 6, 40);
  B.paint(...FRAME, STAL);
  post(B, x, yP - 30 - K.motorR + 8, -(K.pinionZ1 + K.motorZ1) / 2, 50, (K.motorZ1 - K.pinionZ1) / 2 - 10);
  // lampka pracy na skrzyni (ciepła)
  B.paint(...WARM, LAMPA, 0.6);
  B.abox(x + 40, yP + 131.4, zPc + 30, 6, 0.6, 6);
}

/**
 * Pętlownik przęsła j (runda 7): oś wahań na dwóch cokołach po bokach taśmy, dwa ramiona (żółte — widać je z góry poza
 * krawędzią taśmy), głowica — poprzeczka pod pętlą z listwą emitera pola (kanał `POLE_PETLA[j]`). Ramiona i głowica
 * zbudowane w kącie spoczynku `ARM_REST`; shader obraca je wokół osi kątem z symulacji (znacznik `ARM_MARK + j`).
 */
function looper(B, j) {
  const W = WALC;
  const [xp, yp] = armPivot(j);
  const L = W.armL;
  const c = Math.cos(ARM_REST);
  const sn = Math.sin(ARM_REST);
  const xh = xp + L * c;
  const yh = yp + L * sn;
  // cokoły osi i oś (stoją)
  for (const sd of [-1, 1]) {
    const z = sd * W.armZ;
    B.paint(...FRAME, STAL);
    post(B, xp, yp - 12, z + sd * 4, 10, 9);
    B.paint(...DARK, STAL);
    B.tube(xp, yp, z - 13, xp, yp, z + 13, 13, 13, 24, true);
  }
  B.move(0, 0, ARM_MARK + j);
  for (const sd of [-1, 1]) {
    const z = sd * W.armZ;
    // ramię: belka od osi do głowicy (żółta), przy osi piasta
    B.paint(...YELLOW, FARBA);
    B.beam(xp, yp, z, xh, yh, z, 8, 11);
    B.paint(...DARK, STAL);
    B.tube(xh, yh, z - 7, xh, yh, z + 7, 9, 9, 16, true);
  }
  // głowica: poprzeczka pod taśmą (pełna szerokość ramion), obudowa emitera, listwa emitera (lico ku pętli), końce z pasem
  // (lico emitera zwrócone ku pętli w kącie pracy — pętla ustalona: luz 8 j., szczyt ok. 30 j.)
  const dw = armAngleFor(29) - ARM_REST;
  const nx = Math.sin(dw);
  const ny = Math.cos(dw);
  B.paint(...HOUSING, STAL);
  B.tube(xh, yh, -W.armZ + 6, xh, yh, W.armZ - 6, 6.5, 6.5, 20);
  B.beam(xh + 6 * nx, yh + 6 * ny, -W.looperZ - 2, xh + 6 * nx, yh + 6 * ny, W.looperZ + 2, W.looperLx * 0.45, 6);
  B.paint(...CYAN, POLE, POLE_PETLA[j]);
  B.beam(xh + 9.6 * nx, yh + 9.6 * ny, -W.looperZ, xh + 9.6 * nx, yh + 9.6 * ny, W.looperZ, W.looperLx * 0.36, 1.2);
  B.move(0, 0, 0);
}

/** Noże gazowe C3: poprzeczne rozdzielacze pod taśmą i kolektory boczne. */
function knives(B) {
  const [x0, x1] = LINIA.chill.C3;
  const y = HALA.passY - 24;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = x0 + 24 + (x1 - x0 - 48) * i / (n - 1);
    B.paint(...STEEL, STAL);
    B.tube(x, y, -122, x, y, 122, 7, 7, 16, true);
    B.paint(...DARK, STAL);
    B.abox(x, y + 7.2, 0, 1.4, 0.6, 108);                        // szczelina ku taśmie
  }
  for (const sd of [-1, 1]) {
    B.paint(...FRAME, STAL);
    B.tube(x0 + 10, y, sd * 128, x1 - 10, y, sd * 128, 9, 9, 16, true);
    for (let x = x0 + 40; x < x1; x += 110) post(B, x, y - 9, sd * 128, 5, 5);
  }
}


// ---------------------------------------------------------------------------
// Napisy malowane (czcionka 5 × 7 z pudełek — w siatce otoczenia, bez tekstur): czytane z kamery gry (x w prawo, z w dół)

const GLYPH = {
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '>': ['11000', '01100', '00110', '00011', '00110', '01100', '11000'],
  // (runda 9) napisy stacji odzgorzania i strefy osłony
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  // (runda 9) napisy kaset i przetopu
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
};

/** Napis w płaszczyźnie x-z na wysokości y: lewy górny róg (x0, z0), piksel `px` [j.], grubość warstwy 0,5 j. */
export function paintText(B, str, x0, y, z0, px) {
  let cx = x0;
  for (const ch of str) {
    const g = GLYPH[ch] || GLYPH[' '];
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      let c = 0;
      while (c < 5) {
        if (row[c] !== '1') { c++; continue; }
        let e = c;
        while (e + 1 < 5 && row[e + 1] === '1') e++;
        B.abox(cx + (c + e + 1) * px / 2, y + 0.25, z0 + (r + 0.5) * px, (e - c + 1) * px / 2 - 0.15, 0.25, px / 2 - 0.15);
        c = e + 1;
      }
    }
    cx += 6 * px;
  }
  return cx - x0 - px;
}

/** Napisy walcowni: numery klatek na pokrywach stojaków (od strony obsługi) i „DO ZWIJARKI” na pokładzie przy bramie. */
function labels(B) {
  const K = KLATKA;
  WALC.stands.forEach((s, k) => {
    const [x, yu] = rollCenters(k);
    const yTop = yu + K.chockHy + 70 + 2.4;
    const px = 5.3;
    B.paint(...DARK, FARBA);
    paintText(B, s.id, x - 5.5 * px, yTop, (K.postZ0 + K.postZ1) / 2 - 3.5 * px, px);
  });
}

/**
 * Napis na licu pionowym x = `xf` (płaszczyzna y-z) czytany od strony `sd` (−1 — od walcowni, +1 — od zwijarki): kolumny od
 * `z0` w prawo patrzącego, wiersze w dół od `yTop`; piksel `px`, grubość warstwy 0,5 j. (poprawki rundy 7 — belka bramy).
 */
export function paintTextFace(B, str, xf, yTop, z0, sd, px) {
  // kierunek kolumn: od strony walcowni (sd = −1, patrzący w +x) prawo = +z; od strony zwijarki (sd = +1) prawo = −z
  const dz = sd < 0 ? 1 : -1;
  let cz = z0;
  for (const ch of str) {
    const g = GLYPH[ch] || GLYPH[' '];
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      let c = 0;
      while (c < 5) {
        if (row[c] !== '1') { c++; continue; }
        let e = c;
        while (e + 1 < 5 && row[e + 1] === '1') e++;
        const zc = cz + dz * (c + e + 1) * px / 2;
        B.abox(xf, yTop - (r + 0.5) * px, zc, 0.25, px / 2 - 0.15, (e - c + 1) * px / 2 - 0.15);
        c = e + 1;
      }
    }
    cz += dz * 6 * px;
  }
}

export function buildRollingMill(B) {
  B.move(0, 0, 0);
  for (let k = 0; k < WALC.stands.length; k++) stand(B, k);
  for (let j = 0; j < 2; j++) looper(B, j);
  knives(B);
  labels(B);
  // (runda 9) STACJA ODZGORZANIA i KURTYNA OSŁONY; ramy pola w otworach ściany czołowej (WYJAZD KASET, PRZETOP)
  const E = DZIEL.exit;
  const PZ = PRZETOP;
  const xw = DZIEL.wall.x0 - 3;
  buildDescaler(B, {
    text: paintText,
    frames: [[xw, E.z0 + 2, E.z1 - 2, E.y0 + 2, E.y1 - 2], [xw, -PZ.hz + 2, PZ.hz - 2, PZ.y0 + 2, PZ.y1 - 2]]
  });
}
