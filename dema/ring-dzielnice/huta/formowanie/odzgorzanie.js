// HUTA — runda 9, etap „Czysta stal” (SPEC § 12.1 H): STACJA ODZGORZANIA POLEM I OSŁONA ARGONU (czyste liczby i bryły,
// bez three; rejestrator `Budowniczy` — ta sama siatka i materiał co otoczenie).
//
// Słowa użytkownika: „i co się robi ze stalą, żeby była ładna, czyściutka? Nie czarna i brudna?”. Czarna skorupa to
// ZGORZELINA — tlenki rosnące na gorącym metalu w zetknięciu z tlenem (model: ξ plastra, `linia.js`; łamana w klatkach
// F1–F3 — zasada G, bez zmian). W walcowni zbija się ją wodą pod ciśnieniem; czysty gorący metal utrzymuje się, prowadząc
// go w atmosferze ochronnej. U nas, w języku pól linii:
//   STACJA ODZGORZANIA (OZ) — tuż za F3, między pierwszym a drugim rozdzielaczem noży C3: dwie belki emiterów w poprzek
//       taśmy (górna nad taśmą, dolna pod nią) rzucają na OBA lica WARSTWĘ PLAZMY ARGONOWEJ pochyloną pod prąd taśmy
//       (jak dysze zbijaczy: zgorzelina idzie wstecz, na brudną stronę). W strefie styku (szerokość `wf`) tlenek odrywa
//       się z szybkością k: ξ_wyj = ξ_wej · exp(−k · U · wf / v) — sprawność skończona, zależna od prędkości taśmy (U —
//       moc stacji). Zdjęty tlenek to masa (masa metalu w warstwie: κ · ξ · m plastra) — przechodzi z taśmy na konto
//       zgorzeliny linii (`LIN_LICZNIK.scale`): z górnego lica płatki i pył lecą polem do dwóch SSAW ODCIĄGU po bokach
//       taśmy (kolumny odciągu → kolektor na pokładzie), z dolnego — w dół, do dołu zgorzeliny F3.
//   OSŁONA — KURTYNA POLA na płaszczyźnie x = `xc` (dolny tor stacji jest jej bramą): za kurtyną hala dzielenia stoi w
//       ATMOSFERZE OCHRONNEJ ARGONU (obieg z noży C3 — dmuchają argonem), więc tlenek nie rośnie (przyrost ξ = 0) od
//       kurtyny po nóż, lot arkusza, gniazda, paczki i bramy WYJAZD (ramy pola w otworach). Kurtyna z kamery gry: próg
//       pola na pokładzie przez całą szerokość hali, słupy emiterów na brzegach, napis „OSLONA AR” w strefie.
// Wybór (zlecający, „zostaw jak uważasz”): kurtyna + argon, nie próżnia — noże C3 regulują temperaturę konwekcją gazu
// (etap „Gorętsza taśma”), w próżni nie miałyby czym chłodzić.
import { HALA, LINIA } from './geometria.js';

/**
 * ODZG — liczby stacji [j.], [s], [1/s].
 *   xf        linia styku plazmy z licem (środek strefy czyszczenia); strefa [xf − wf/2, xf + wf/2]
 *   k         szybkość zdejmowania przy pełnej mocy [1/s] — przy 1,4 Q_nom (468 j./s) zostaje exp(−k·wf/v) ≈ 2,7 % ξ,
 *             przy Q_nom ≈ 0,6 %, przy 0,7 Q_nom ≈ 0,07 %
 *   kappa     masa metalu w warstwie tlenku na jednostkę ξ (udział masy plastra): ξ 0,15 → 0,3 % masy (strata na zgorzelinie
 *             wtórnej walcowni gorącej 0,1–0,5 %)
 *   tau       narastanie i gaśnięcie mocy stacji [s]; standby — moc czuwania bez taśmy
 *   xc        KURTYNA OSŁONY (płaszczyzna x): od niej przyrost tlenku = 0
 *   beamTop   belka górna: x0…x1, y od / do (nad licem), półdługość z; lico emitera od spodu
 *   beamBot   belka dolna (między rozdzielaczami C3 nr 0 i 1): x0…x1, y od / do, półdługość z
 *   tower     kolumny odciągu (nośne belek): x0…x1, |z| z0…z1, wierzch
 *   mouth     ssawy odciągu (górne lico): x0…x1, |z| z0…z1, y od / do (nad osią taśmy) — punkt ssania `suck`
 *   sheet     warstwa plazmy: stopa (xf), górna krawędź (x, y nad osią) — górna i dolna
 *   cyclone   kolektor odciągu na pokładzie (po obu stronach): x0…x1, |z| z0…z1, wysokość
 *   curtain   próg kurtyny: półszerokość w x, wysokość; z0…z1 — zasięg w poprzek hali; słupy brzegowe (|z|, wysokość)
 */
export const ODZG = Object.freeze({
  xf: 3146, wf: 14, k: 120, kappa: 0.02, tau: 0.2, standby: 0.15,
  xc: 3138,
  beamTop: Object.freeze({ x0: 3153, x1: 3167, y0: 21, y1: 35, hz: 205 }),
  beamBot: Object.freeze({ x0: 3143, x1: 3153, y0: -11, y1: -18, hz: 112 }),
  tower: Object.freeze({ x0: 3142, x1: 3170, z0: 166, z1: 204, top: 46 }),
  mouth: Object.freeze({ x0: 3122, x1: 3143, z0: 104, z1: 166, y0: 5, y1: 33, suck: Object.freeze([3132, 19, 150]) }),
  sheetTop: Object.freeze({ foot: 4.6, xTop: 3157, yTop: 21 }),
  sheetBot: Object.freeze({ foot: -4.6, xTop: 3149, yTop: -11 }),
  sheetZ: 102,
  cyclone: Object.freeze({ x0: 3180, x1: 3234, z0: 330, z1: 384, h: 120 }),
  curtain: Object.freeze({ hx: 3, h: 7, z0: -1195, z1: 1095, postH: 150 })
});

/** Granice strefy czyszczenia [x]. */
export const OZ_X0 = ODZG.xf - ODZG.wf / 2;
export const OZ_X1 = ODZG.xf + ODZG.wf / 2;

/**
 * Udział ξ, który zostaje po przejściu taśmy z prędkością v [j./s] przez strefę przy mocy U (0…1): exp(−k · U · wf / v).
 */
export function descaleKeep(v, U = 1) {
  const vv = v > 1 ? v : 1;
  return Math.exp(-ODZG.k * U * ODZG.wf / vv);
}

/**
 * OBRAZ frontu czyszczenia na drodze x: udział ξ (przed strefą 1, w strefie wykładniczo do `descaleKeep`, za strefą
 * `descaleKeep`) — ten sam rachunek co model (stała szybkość w strefie), w punkcie, nie w środku plastra (plaster ma
 * ok. 21 j. — front w stanie plastrów rozmyłby się na długość plastra).
 */
export function descaleProfile(x, v, U = 1) {
  if (x <= OZ_X0) return 1;
  const vv = v > 1 ? v : 1;
  const d = (x < OZ_X1 ? x : OZ_X1) - OZ_X0;
  return Math.exp(-ODZG.k * U * d / vv);
}

/** Kanał siły pola stacji i kurtyny (`OU.pole`: kanał 19 — wolny po walcowni). */
export const ODZ_KANAL = 19;

const PY = HALA.passY;
const STEEL = [0.14, 0.145, 0.158];
const DARK = [0.045, 0.047, 0.052];
const FRAME = [0.105, 0.108, 0.118];
const HOUSING = [0.085, 0.088, 0.098];
const YELLOW = [0.5, 0.33, 0.04];
const CYAN = [0.2, 0.9, 1.0];
const CYAN_DIM = [0.08, 0.36, 0.4];
const STAL = 8;
const FARBA = 0;
const POLE = 29;
const PASY = 27;

/** Słup od wysokości y w dół do pokładu hali (prostokąt hx × hz). */
function post(B, x, y, z, hx, hz, y0 = HALA.deckY) {
  B.abox(x, (y + y0) / 2, z, hx, (y - y0) / 2, hz);
}

/**
 * Bryły stacji odzgorzania i kurtyny osłony (makieta w jakości urządzeń walcowni): kolumny odciągu z ssawami, belki
 * emiterów górna i dolna (lico emitera — kanał `ODZ_KANAL`), kolektor odciągu na pokładzie z rurami, próg kurtyny przez
 * halę ze słupami brzegowymi, ramy pola w otworach WYJAZD i PRZETOP, napisy.
 */
export function buildDescaler(B, opts = {}) {
  const O = ODZG;
  const T = O.tower;
  const M = O.mouth;
  const yTop = PY + T.top;
  B.move(0, 0, 0);
  for (const sd of [-1, 1]) {
    const zc = sd * (T.z0 + T.z1) / 2;
    const hz = (T.z1 - T.z0) / 2;
    // KOLUMNA ODCIĄGU (nośna belek): korpus, czapa, pas ostrzegawczy na czapie
    B.paint(...HOUSING, STAL);
    post(B, (T.x0 + T.x1) / 2, yTop, zc, (T.x1 - T.x0) / 2, hz);
    B.paint(...DARK, STAL);
    B.abox((T.x0 + T.x1) / 2, yTop + 2, zc, (T.x1 - T.x0) / 2 + 2, 2, hz + 2);
    B.paint(...YELLOW, PASY, 0);
    B.abox((T.x0 + T.x1) / 2, yTop + 4.4, zc, (T.x1 - T.x0) / 2 - 3, 0.4, hz - 3);
    // SSAWA odciągu nad licem przy krawędzi taśmy: obudowa, ciemny wlot od strony taśmy, listwa pola ssania (przygaszona)
    const zm0 = sd * M.z0;
    const zm1 = sd * M.z1;
    const ym0 = PY + M.y0;
    const ym1 = PY + M.y1;
    B.paint(...FRAME, STAL);
    B.abox((M.x0 + M.x1) / 2, ym1 + 2, (zm0 + zm1) / 2, (M.x1 - M.x0) / 2 + 2, 2, (M.z1 - M.z0) / 2);            // daszek
    B.abox((M.x0 + M.x1) / 2, (ym0 + ym1) / 2, zm1, (M.x1 - M.x0) / 2 + 2, (ym1 - ym0) / 2 + 2, 2);              // tył
    B.abox(M.x0 - 2, (ym0 + ym1) / 2, (zm0 + zm1) / 2, 2, (ym1 - ym0) / 2 + 2, (M.z1 - M.z0) / 2);                // bok (pod prąd)
    B.paint(...DARK, STAL);
    B.abox((M.x0 + M.x1) / 2, ym0 - 1, (zm0 + zm1) / 2, (M.x1 - M.x0) / 2, 1, (M.z1 - M.z0) / 2);               // dno wlotu
    B.abox((M.x0 + M.x1) / 2, (ym0 + ym1) / 2, zm1 - sd * 3, (M.x1 - M.x0) / 2 - 1, (ym1 - ym0) / 2 - 1, 0.6);   // gardło
    B.paint(...CYAN_DIM, POLE, ODZ_KANAL);
    B.abox((M.x0 + M.x1) / 2, ym1 - 0.6, zm0 + sd * 3, (M.x1 - M.x0) / 2 - 2, 0.5, 1.2);                          // listwa ssania
    // rura odciągu: z kolumny (u dołu) do kolektora na pokładzie
    const C = O.cyclone;
    const xp = (T.x0 + T.x1) / 2;
    const yp = HALA.deckY + 30;
    B.paint(...STEEL, STAL);
    B.tube(xp, yp, sd * T.z1, xp, yp, sd * (C.z0 + 6), 11, 11, 16, true);
    B.tube(xp, yp, sd * (C.z0 + 6), C.x0 + 6, yp, sd * (C.z0 + 6), 11, 11, 16, true);
    // KOLEKTOR ODCIĄGU (cyklon na cokole): walec stojący, stożek, wylot pyłu do kontenera
    const cx = (C.x0 + C.x1) / 2;
    const cz = sd * (C.z0 + C.z1) / 2;
    const r = (C.x1 - C.x0) / 2;
    B.paint(...HOUSING, STAL);
    B.tube(cx, HALA.deckY + 40, cz, cx, HALA.deckY + C.h, cz, r, r, 32, true);
    B.paint(...DARK, STAL);
    B.tube(cx, HALA.deckY + 12, cz, cx, HALA.deckY + 40, cz, r * 0.35, r, 32);
    B.disc(cx, HALA.deckY + C.h + 0.4, cz, 0, 1, 0, r - 4, 32);
    B.paint(...YELLOW, PASY, 0);
    B.tube(cx, HALA.deckY + C.h - 10, cz, cx, HALA.deckY + C.h - 4, cz, r + 0.6, r + 0.6, 32);
    B.paint(...FRAME, STAL);
    B.abox(cx, HALA.deckY + 6, cz, r + 6, 6, r + 6);
  }
  // BELKA GÓRNA: korpus nad taśmą między kolumnami, lico emitera od spodu (kanał stacji)
  const BT = O.beamTop;
  B.paint(...HOUSING, STAL);
  B.abox((BT.x0 + BT.x1) / 2, PY + (BT.y0 + BT.y1) / 2, 0, (BT.x1 - BT.x0) / 2, (BT.y1 - BT.y0) / 2, BT.hz);
  B.paint(...YELLOW, FARBA);
  for (const e of [BT.x0 + 1.6, BT.x1 - 1.6]) B.abox(e, PY + BT.y1 + 0.3, 0, 1, 0.3, BT.hz - 6);
  B.paint(...DARK, STAL);
  B.abox((BT.x0 + BT.x1) / 2, PY + BT.y0 - 0.6, 0, (BT.x1 - BT.x0) / 2 - 1, 0.6, O.sheetZ + 6);
  B.paint(...CYAN, POLE, ODZ_KANAL);
  B.abox(BT.x0 + 4, PY + BT.y0 - 1.4, 0, 2.2, 0.5, O.sheetZ);
  // lico emitera także od strony walcowni (pod prąd — widać je z ukosa)
  B.abox(BT.x0 - 0.5, PY + BT.y0 + 4, 0, 0.5, 2.2, O.sheetZ);
  // BELKA DOLNA: między rozdzielaczami C3, lico emitera od góry; podpora do pokładu (przez cokół rozdzielaczy)
  const BB = O.beamBot;
  B.paint(...HOUSING, STAL);
  B.abox((BB.x0 + BB.x1) / 2, PY + (BB.y0 + BB.y1) / 2, 0, (BB.x1 - BB.x0) / 2, Math.abs(BB.y1 - BB.y0) / 2, BB.hz);
  B.paint(...CYAN, POLE, ODZ_KANAL);
  B.abox(BB.x0 + 3, PY + BB.y0 + 0.4, 0, 2, 0.4, O.sheetZ);
  B.paint(...FRAME, STAL);
  post(B, (BB.x0 + BB.x1) / 2, PY + BB.y1, 0, 4, 10);
  // KURTYNA OSŁONY: próg pola przez całą szerokość hali (listwa emitera u góry — kanał stacji, przygaszona), pasy po
  // obu stronach, słupy brzegowe z listwą; przerwa pod linią (dolny tor stacji jest bramą kurtyny — kolumny odciągu)
  const K = O.curtain;
  const yd = HALA.deckY;
  const sill = (z0, z1) => {
    B.paint(...FRAME, STAL);
    B.abox(O.xc, yd + K.h / 2, (z0 + z1) / 2, K.hx, K.h / 2, (z1 - z0) / 2);
    B.paint(...CYAN_DIM, POLE, ODZ_KANAL);
    B.abox(O.xc, yd + K.h + 0.4, (z0 + z1) / 2, 1.6, 0.4, (z1 - z0) / 2 - 2);
    B.paint(...YELLOW, PASY, 1);
    for (const s of [-1, 1]) B.abox(O.xc + s * (K.hx + 5), yd + 0.6, (z0 + z1) / 2, 4, 0.6, (z1 - z0) / 2);
  };
  sill(K.z0, -T.z1 - 4);
  sill(T.z1 + 4, K.z1);
  for (const z of [K.z0, K.z1]) {
    B.paint(...HOUSING, STAL);
    post(B, O.xc, yd + K.postH, z, 9, 9);
    B.paint(...CYAN_DIM, POLE, ODZ_KANAL);
    B.abox(O.xc, yd + K.postH / 2, z - Math.sign(z) * 9.4, 2, K.postH / 2 - 10, 0.5);
    B.paint(...YELLOW, PASY, 0);
    B.abox(O.xc, yd + K.postH + 0.4, z, 8, 0.4, 8);
  }
  // ramy pola w otworach ściany czołowej (bramy WYJAZD, PRZETOP) — kurtyna nie wypuszcza argonu z hali dzielenia
  for (const fr of opts.frames || []) {
    B.paint(...CYAN_DIM, POLE, ODZ_KANAL);
    const [x, z0, z1, y0, y1] = fr;
    B.abox(x, y1 + 0.5, (z0 + z1) / 2, 1.2, 0.5, (z1 - z0) / 2);
    B.abox(x, y0 + 0.5, (z0 + z1) / 2, 1.2, 0.5, (z1 - z0) / 2);
    B.abox(x, (y0 + y1) / 2, z0 + 0.5, 1.2, (y1 - y0) / 2, 0.5);
    B.abox(x, (y0 + y1) / 2, z1 - 0.5, 1.2, (y1 - y0) / 2, 0.5);
  }
  if (opts.text) {
    // napisy na pokładzie (czytane z kamery gry): strefa osłony za kurtyną i stacja
    B.paint(0.4, 0.38, 0.3, FARBA);
    opts.text(B, 'OSLONA AR', O.xc + 40, yd, 470, 8);
    opts.text(B, 'OSLONA AR', O.xc + 40, yd, -700, 8);
    opts.text(B, 'ODZGORZANIE', O.cyclone.x1 + 40, yd, O.cyclone.z0 + 8, 4.4);
  }
}

/** Liczby dla testów kolizji: prostopadłościany brył stacji [x0, x1, y0, y1, z0, z1] (układ komory). */
export function descalerBoxes() {
  const O = ODZG;
  const T = O.tower;
  const M = O.mouth;
  const out = [];
  for (const sd of [-1, 1]) {
    out.push({ id: `kolumna${sd}`, b: [T.x0, T.x1, HALA.deckY, PY + T.top + 4.8, Math.min(sd * T.z0, sd * T.z1), Math.max(sd * T.z0, sd * T.z1)] });
    out.push({ id: `ssawa${sd}`, b: [M.x0 - 4, M.x1 + 2, PY + M.y0 - 2, PY + M.y1 + 4, Math.min(sd * M.z0, sd * M.z1), Math.max(sd * M.z0, sd * M.z1)] });
  }
  out.push({ id: 'belkaG', b: [O.beamTop.x0 - 1.5, O.beamTop.x1, PY + O.beamTop.y0 - 2, PY + O.beamTop.y1 + 1, -O.beamTop.hz, O.beamTop.hz] });
  out.push({ id: 'belkaD', b: [O.beamBot.x0, O.beamBot.x1, PY + O.beamBot.y1, PY + O.beamBot.y0 + 1, -O.beamBot.hz, O.beamBot.hz] });
  return out;
}

void LINIA;
