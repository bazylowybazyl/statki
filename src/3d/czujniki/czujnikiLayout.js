// src/3d/czujniki/czujnikiLayout.js — układ wejścia klatki obrazu czujników (Float64Array `CZUJNIKI_IN`).
//
// Strona gry liczy widok czujników (`src/ui/czujkaView.js`: czujka na PPM — struna i błona, granice wykrycia — tafla,
// kontakty — obłok X-ów) w ŚWIECIE (j., kąty w osiach gry, y w dół) i pakuje go do tej tablicy; moduł renderu
// (`czujniki3D.js`, strona w trybie off albo worker — blok migawki `czujniki`) rzutuje ją kamerą renderu na piksele
// bufora (z obrotem kadru) i pisze bloki shaderów (`namiarTSL.js`, `granicaTSL.js`, `kontaktyTSL.js`).
// Czysty moduł (bez three, DOM i `window`).

/** Najwięcej: znaczników struny (grupy w namiarze), ciał błony, granic (grupy i obserwatorzy), kontaktów. */
export const CZUJNIKI_MAX = Object.freeze({ struna: 24, blona: 16, granica: 24, kontakty: 48 });

const HDR = 24;
const STR = 8;    // znacznik struny: da, nBig, nSmall, reveal, det, est, seed, flash
const BLN = 6;    // ciało błony: kąt (świat), bliskość c, szerokość sigma, wyłonienie, rodzaj, ziarno
const GRN = 20;   // granica: patrz GRANICA_REC
const KON = 10;   // kontakt: patrz KONTAKT_REC

/** Pola nagłówka i bazy sekcji. Kąty w osiach gry (y w dół) — render odejmuje obrót kadru. */
export const CZUJNIKI_IN = Object.freeze({
  serial: 0,
  active: 1,        // 1 — coś do narysowania (czujka, granice albo kontakty)
  time: 2,          // czas widoku [s] (shadery: time % 600)
  px: 3, py: 4,     // mój okręt — poza renderu [j.]
  shipLen: 5,       // długość mojego okrętu [j.] (promień błony, okno granicy, znaki przejść nad obrysem)
  sig: 6,           // mój ślad (ciąg nadyma błonę, cisza kurczy)
  vis: 7,           // widoczność czujki 0..1 (PPM)
  phi: 8,           // kierunek struny [rad, osie gry]
  amp: 9,           // amplituda struny [px CSS]
  tau: 10,          // czas struny (całkowany na CPU)
  det: 11,          // grupa w namiarze widzi mnie (czerwień)
  harm: 12,         // bogactwo harmonicznych (z szarpnięciem)
  onAge: 13,        // wiek trzymania PPM [s] (−1 — puszczony; impuls błony)
  nStr: 14, nBln: 15, nGrn: 16, nKon: 17,
  strunaOn: 18,     // 1 — rysuj strunę / błonę (PPM albo wygasanie)
  granicaOn: 19,    // 1 — są granice
  header: HDR,
  strBase: HDR,
  strStride: STR,
  blnBase: HDR + STR * CZUJNIKI_MAX.struna,
  blnStride: BLN,
  grnBase: HDR + STR * CZUJNIKI_MAX.struna + BLN * CZUJNIKI_MAX.blona,
  grnStride: GRN,
  konBase: HDR + STR * CZUJNIKI_MAX.struna + BLN * CZUJNIKI_MAX.blona + GRN * CZUJNIKI_MAX.granica,
  konStride: KON,
  size: HDR + STR * CZUJNIKI_MAX.struna + BLN * CZUJNIKI_MAX.blona + GRN * CZUJNIKI_MAX.granica + KON * CZUJNIKI_MAX.kontakty
});

/** Rekord granicy (j. świata, kąty w osiach gry): szara = ich KONTAKT (cx, cy, R), czerwona = ich WZROK (Rv). */
export const GRANICA_REC = Object.freeze({
  cx: 0, cy: 1,       // środek koła (miejsce grupy / obserwatora)
  R: 2,               // promień kontaktu wobec mnie [j.]
  redA: 3,            // widoczność czerwonej
  ageC: 4, dirC: 5, angC: 6, RcX: 7,   // przejście kontaktu: wiek [s] (−1 brak), kierunek, kąt, promień w chwili
  est: 8,             // ich wzrok zgadnięty / nieznany (kreski)
  rate: 9,            // tempo zmiany R [j./s]
  nearAng: 10,        // kąt od środka ku mnie
  Rv: 11,             // promień wzroku [j.]
  ageV: 12, dirV: 13, angV: 14,        // przejście wzroku
  gray: 15,           // widoczność szarej × zlewanie z czerwoną
  knownA: 16, knownV: 17, grayA: 18,   // całe koło szarej / czerwonej, „?”
  winShift: 19        // przesunięcie okna szarej [j.] (droga ucieczki)
});

/** Rekord kontaktu (obłok X-ów): miejsce w świecie, „ciało” R [j.] z klasy, najmniej minPx [px CSS], mnożnik promienia
 *  objawienia Rk, niepewność err [j.], klasa 0–3, masa, ziarno 0–1, alfa. */
export const KONTAKT_REC = Object.freeze({ x: 0, y: 1, R: 2, minPx: 3, Rk: 4, err: 5, cls: 6, mass: 7, seed: 8, alpha: 9 });

/** Czy pierścień (środek cx, cy, promień R, pół szerokości `band` — px bufora) przecina prostokąt kadru 0..w × 0..h. */
export function ringInView(cx, cy, R, band, w, h) {
  if (!(R > 0)) return false;
  const nx = Math.max(0, -cx, cx - w), ny = Math.max(0, -cy, cy - h);
  const dMin = Math.sqrt(nx * nx + ny * ny);                     // najbliższy punkt kadru
  const fx = Math.max(Math.abs(cx), Math.abs(cx - w)), fy = Math.max(Math.abs(cy), Math.abs(cy - h));
  const dMax = Math.sqrt(fx * fx + fy * fy);                     // najdalszy narożnik kadru
  return dMin <= R + band && dMax >= R - band;
}
