// HUTA — wytop: MASA W LEJU — pole grubości cieczy na stożku leja (czysta symulacja, bez three i DOM).
//
// Decyzja użytkownika (SPEC, wpis 6, punkt E′): kula po uderzeniu w lej zostaje JEDNĄ, spójną, lepką masą, która się
// odkształca — rozpłaszcza się, jej brzeg wjeżdża fałdą po ścianach leja, cofa się, środek odbija garbem, masa
// przelewa się z boku na bok i uspokaja w jezioro. Żadnych osobnych brył. Odkształcenie wynika z SYMULACJI:
//
//   • SIATKA BIEGUNOWA na dnie komory: `nr` pierścieni × `na` wycinków od gardzieli (r = `throatR`) do ściany studni
//     + jedna komórka środkowa (krąg nad gardzielą). W komórce: grubość warstwy `h` (wysokość słupa cieczy nad
//     wykładziną); na ściankach między komórkami: prędkość promieniowa `ur` i obwodowa `ut` (siatka przestawna).
//   • RÓWNANIA PŁYTKIEJ WODY z lepkością: przyspieszenie ścianki = −g · spadek lustra (lustro = dno stożka + h)
//     − unoszenie pędu (schemat zachowujący pęd: czoło fałdy przejmuje prędkość cieczy, która je pcha — fałda wjeżdża
//     po ścianie z rozpędu, nie tylko z naporu) + siła odśrodkowa i zachowanie krętu (wir nad gardzielą) + lepkość
//     (dyfuzja prędkości) − opór (liniowy + tarcie cienkiej warstwy o wykładzinę ∝ 1 / h²: cienka fałda zostaje na
//     ścianie i ścieka powoli). Grubość zmieniają strumienie przez ścianki (ciecz płynie tylko tam, gdzie lustro
//     wyższej komórki leży nad dnem niższej); ogranicznik odpływu trzyma h ≥ 0 — masa jest zachowana co do zaokrągleń.
//   • KULA → POLE. W chwili zetknięcia bryła kuli (z wydłużeniem i falowaniem z lotu) jest rozpisana na słupy nad
//     komórkami (`chord`) i CAŁA staje się polem: grubość komórki = wysokość słupa, a PĘD opadania zamienia się
//     w rozpływ od osi kuli (ciągłość: słup opadający z prędkością V wypycha ciecz na boki z prędkością V · ρ / 2h;
//     do tego znos kuli). Słup postawiony na wykładzinie jest niższy od kuli tam, gdzie jej spód wisiał jeszcze nad
//     wykładziną — WIERZCH KULI (kopuła, opadająca dalej jak ciało) stoi więc chwilę nad polem: `lift` = kopuła − pole.
//     Obraz rysuje wyższe z dwojga (wykładzina + grubość + `lift`), więc w chwili zetknięcia masa ma dokładnie kształt
//     kuli, potem kopuła tonie w rozlewającym się polu i znika (ułamek sekundy) — przez cały czas jedna bryła.
//     Kopuła NIE jest sztywną czaszą: opadając spłaszcza się z zachowaniem objętości (promień rośnie, wysokość nad
//     środkiem maleje z kwadratem) — na końcu jest niskim, szerokim wałem, a nie małą kopułką na placku.
//   • WYGŁADZANIE LUSTRA: dyfuzja wysokości lustra między mokrymi komórkami (`smooth`) — gęsta ciecz nie trzyma
//     stromego progu; zbiegająca się fala i garb odbicia to szeroki wał. Niesymetria przebiegu bierze się z uderzenia:
//     kula jest zniesiona z osi i niesie pęd boczny (`komora.js`: `dropDrift`).
//     (Próba „reszta kuli opada jak ciało, słupy wlewają się po kolei” dawała na styku ciała i pola schodki i grzbiety:
//     wlany słup nie mógł oddać cieczy pod sąsiedni, jeszcze sztywny — dlatego cała kula jest polem od zetknięcia.)
//   • GARDZIEL = upust komórki środkowej (`drain`); przy spływie łopatki gardzieli nadają cieczy obrót (`swirl`) —
//     kręt niesie się z dopływającą cieczą, siła odśrodkowa odsuwa lustro od osi: wgłębienie wiru wychodzi z pola.
//   • MASA AUTORYTATYWNA zostaje w całkowitych jednostkach symulacji (`komora.js`); pole jest do niej normalizowane
//     po każdym podkroku (`normalize`).
//
// KROK NIE ALOKUJE: stan w tablicach typowanych, parametry i wyniki przez tablicę `P` (indeksy `MP`) — żadna liczba
// zmiennoprzecinkowa nie przechodzi przez argument ani wynik funkcji.
import { KOMORA } from './geometria.js';
import { surfaceOffsetInto } from './kula.js';

export const MASA = Object.freeze({
  nr: 32,                         // pierścieni (gardziel → ściana)
  na: 48,                         // wycinków po obwodzie
  steps: 2,                       // kroków pola na podkrok symulacji (1/120 s → 1/240 s)
  dry: 0.02,                      // cieńsza warstwa nie płynie [j.]
  hMin: 1.5,                      // najmniejsza grubość w mianownikach [j.]
  drag: 0.3,                      // opór liniowy [1/s]
  visc: 2400,                     // lepkość — dyfuzja prędkości [j.²/s]
  film: 110,                      // tarcie cienkiej warstwy o wykładzinę: 3 · film / h² [1/s]
  dragLate: 1.2,                  // przyrost oporu, gdy ciecz zgęstnieje (stygnie na wykładzinie) [1/s]
  viscLate: 0,                    // … i przyrost lepkości [j.²/s]
  uMax: 1000,                     // ograniczenie prędkości [j./s]
  impact: 0.7,                    // pęd opadającego słupa zamieniany w rozpływ (× prędkość z ciągłości)
  spread: 1.1,                    // największa prędkość rozpływu nadana przy wlaniu [× prędkość opadania]
  // stygnięcie cienkiej warstwy (do obrazu): cieńsza niż `coolH` ciemnieje w `coolTau`, gruba fala ogrzewa ją w `heatTau`
  coolH: 34, coolTau: 0.55, heatTau: 0.1,
  // wygładzanie lustra [j.²/s]: dyfuzja WYSOKOŚCI lustra między mokrymi komórkami (gęsta, lepka ciecz nie trzyma
  // stromego progu: zbiegająca się fala i garb odbicia to szeroki wał, nie soczewka z rantem); zachowuje masę
  smooth: 4600,
  // kopuła kuli po zetknięciu (górna, jeszcze niewlana część bryły): opadając SPŁASZCZA SIĘ z zachowaniem objętości —
  // promień rośnie o `domeWiden` na każdy promień kuli drogi opadania (najwyżej × `domeMax`), wysokość maleje z kwadratem
  // nad komórką, której kopuła dotąd nie przykrywała, narasta najwyżej `domeRise` j./s (brzeg rozszerzającej się
  // kopuły to strome zbocze, nie pionowa ściana przeskakująca z komórki na komórkę)
  domeWiden: 0.62, domeMax: 2.3, domeRise: 3000,
  // wir nad gardzielą: prędkość obwodowa nadawana przy samej gardzieli [j./s] (dalej ∝ 1 / r), zasięg łopatek [j.], rozbieg [s]
  swirlV: 230, swirlR: 110, swirlTau: 0.45
});

/**
 * BRZEG MASY (jezioro ma kończyć się wyraźną linią, a nie świecić cienką warstwą aż do ściany): ciecz rysowana jest
 * tam, gdzie warstwa pola jest grubsza niż `h` j. (przy gardzieli próg schodzi do `hThroat` — resztka spływu kurczy
 * się ku gardzieli, zamiast gasnąć naraz); cieńszy film to MOKRA WYKŁADZINA — rysuje go materiał leja (ciemny żar
 * ze szwami); próg jest tu, przy polu (moduł bez three), bo sprawdzają go też testy symulacji. Na pasie `bead` j. grubości nad progiem powierzchnia zagina się w MENISK (normalna odchylona na
 * zewnątrz jeziora — odblask na brzegu), pas `w` j. jest chłodniejszy o `cool` (ułamek temperatury), gruba masa
 * (kilkadziesiąt j.) cieplejsza o `thick` — gruba masa jaśniejsza, cienka fałda ciemniejsza; `flat` — tafla jeziora
 * (widziana na wprost, bez pociemnienia brzegu tarczy, które ma kula) chłodniejsza o ten ułamek: nie przepala kadru;
 * `zones` — rozpiętość dużych pól temperatury na tafli względem kuli, `gloss` — moc jasnych odbić (lampy, wyświetlacz).
 */
export const MASS_EDGE = Object.freeze({ h: 4.6, hThroat: 1.4, w: 9.0, bead: 7.0, cool: 0.1, thick: 0.02, flat: 0.095, zones: 0.68, gloss: 0.7 });
/** Rekord komórki w widoku dla obrazu: grubość rysowana [j.], ostygnięcie 0…1, 0, 0. */
export const MASA_STRIDE = 4;
/** Liczba komórek pola (pierścienie × wycinki + środkowa). */
export const MASA_CELLS = MASA.nr * MASA.na + 1;

/** Indeksy tablicy `P` (parametry wejściowe i wyniki). */
export const MP = Object.freeze({
  // wejście
  dt: 0, g: 1,
  bx: 2, by: 3, bz: 4,            // środek opadającej reszty kuli (komora)
  vFall: 5,                       // prędkość opadania [j./s, dodatnia w dół]
  vbx: 6, vbz: 7,                 // znos kuli w planie [j./s]
  R: 8, sy: 9, sxz: 10, tail: 11, // bryła kuli w chwili zetknięcia: promień, wydłużenie w pionie, zwężenie w poziomie, „ogon”
  ballVol: 12,                    // objętość kuli [j.³] (z masy)
  swirl: 13,                      // siła zasysania 0…1 (spływ gardzielą)
  want: 14,                       // upust: objętość do zabrania z komórki środkowej [j.³]
  target: 15,                     // normalizacja: objętość, którą ma mieć pole [j.³]
  thick: 28,                      // gęstnienie cieczy 0…1 (0 — świeżo po uderzeniu): opór + `dragLate`, lepkość + `viscLate`
  // wyniki
  moved: 16,                      // objętość kuli oddana polu [j.³] (od zetknięcia — cała)
  got: 17,                        // upust: objętość zabrana [j.³]
  vol: 18,                        // objętość pola [j.³]
  ke: 19,                         // prędkość średniokwadratowa cieczy [j./s] (kołysanie masy)
  top: 20,                        // najwyższy punkt lustra [y]
  edge: 21,                       // najwyższy punkt lustra przy ścianie studni (fałda na ścianie) [y]; bez cieczy przy ścianie — dno
  mid: 22,                        // lustro nad gardzielą [y]
  front: 23,                      // największy promień zwilżony warstwą grubszą niż 3 j. [j.]
  wet: 24,                        // najwyższy punkt wykładziny pod warstwą grubszą niż 3 j. [y]
  omega: 25,                      // prędkość kątowa cieczy przy wardze gardzieli [rad/s] (z największego krętu pierścieni przy gardzieli)
  ring: 26,                       // średnie lustro w pierścieniu odniesienia wokół gardzieli [y] (bez cieczy w pierścieniu — jak nad gardzielą)
  jump: 27,                       // największa zmiana grubości komórki w ostatnim kroku pola [j.]
  rough: 29                       // nierówność lustra: odchylenie średniokwadratowe od płaskiego jeziora o tej samej objętości [j.]
});

/**
 * @param {Float64Array} modeA  amplitudy modów drgań kuli (kształt bryły w chwili zetknięcia)
 * @param {object} [cfg]        nadpisane liczby `MASA` (próby strojenia; gra i testy biorą `MASA`)
 */
export function createFunnelField(modeA, cfg = null) {
  const M = cfg ? { ...MASA, ...cfg } : MASA;
  const F = KOMORA.funnel;
  const NR = M.nr;
  const NA = M.na;
  const NC = NR * NA;
  const HALF = NA >> 1;
  const r0 = F.throatR;
  const r1 = KOMORA.pitR;
  const dr = (r1 - r0) / NR;
  const dth = Math.PI * 2 / NA;
  const FSL = (F.rimR - F.throatR) / (F.rimY - F.throatY);
  const DRY = M.dry;
  const HMIN = M.hMin;
  const FILM3 = 3 * M.film;
  const UMAX = M.uMax;
  const IDR2 = 1 / (dr * dr);
  /** Waga sąsiada „przez środek” dla ścianek przy gardzieli: odstęp pierścieni / średnica gardzieli. */
  const W0 = dr / (2 * r0);
  /** Pierścień odniesienia wgłębienia wiru (ok. 2,6 promienia gardzieli). */
  const JREF = Math.min(NR - 1, Math.round((2.6 * r0 - r0) / dr));

  const P = new Float64Array(32);
  const h = new Float64Array(NC + 1);
  const eta = new Float64Array(NC + 1);
  const zb = new Float64Array(NC + 1);
  const area = new Float64Array(NC + 1);
  const out = new Float64Array(NC + 1);
  const cool = new Float64Array(NC + 1);
  const hOld = new Float64Array(NC + 1);
  // ścianki promieniowe: f = j · NA + i — wewnętrzna ścianka komórki (j, i); wiersz j = NR to ściana studni (zera)
  // (tablice stałe — nowe prędkości liczone do `…N` i przepisywane: zmienna domknięcia podmieniana co krok kosztuje
  // w V8 alokacje, gdy pól jest więcej niż jedno)
  const ur = new Float64Array((NR + 1) * NA);
  const urN = new Float64Array((NR + 1) * NA);
  const hfr = new Float64Array((NR + 1) * NA);
  const hfrN = new Float64Array((NR + 1) * NA);
  // ścianki obwodowe: t = j · NA + i — między komórką (j, i − 1) a (j, i)
  const ut = new Float64Array(NC);
  const utN = new Float64Array(NC);
  const hft = new Float64Array(NC);
  const hftN = new Float64Array(NC);
  const rc = new Float64Array(NR);
  const rf = new Float64Array(NR + 1);
  const cosC = new Float64Array(NA);
  const sinC = new Float64Array(NA);
  const cosF = new Float64Array(NA);
  const sinF = new Float64Array(NA);
  const swP = new Float64Array(NR);
  const swV = new Float64Array(NR);
  // słupy kuli nad komórkami (z chwili zetknięcia), wierzch kopuły kuli względem jej środka i wystawanie kopuły nad pole
  const chord = new Float64Array(NC + 1);
  const dome = new Float64Array(NC + 1);
  const lift = new Float64Array(NC + 1);
  const ballCells = new Int32Array(NC + 1);
  let nBall = 0;
  let nDome = 0;                  // komórki pod kulą, póki jej kopuła gdziekolwiek wystaje nad pole
  let nLift = 0;                  // komórki, nad którymi kopuła wystaje teraz
  const Dv = new Float64Array(8);

  for (let j = 0; j < NR; j++) {
    rc[j] = r0 + (j + 0.5) * dr;
    rf[j] = r0 + j * dr;
    swP[j] = Math.exp(-(rc[j] - r0) / M.swirlR);
    swV[j] = M.swirlV * r0 / rc[j];
    for (let i = 0; i < NA; i++) {
      zb[j * NA + i] = F.throatY + (rc[j] - F.throatR) / FSL;
      area[j * NA + i] = rc[j] * dr * dth;
    }
  }
  rf[NR] = r1;
  zb[NC] = F.throatY;
  area[NC] = Math.PI * r0 * r0;
  for (let i = 0; i < NA; i++) {
    cosC[i] = Math.cos((i + 0.5) * dth); sinC[i] = Math.sin((i + 0.5) * dth);
    cosF[i] = Math.cos(i * dth); sinF[i] = Math.sin(i * dth);
  }

  function reset() {
    h.fill(0); cool.fill(0); out.fill(0); hOld.fill(0); lift.fill(0);
    ur.fill(0); urN.fill(0); hfr.fill(0); hfrN.fill(0);
    ut.fill(0); utN.fill(0); hft.fill(0); hftN.fill(0);
    chord.fill(0);
    nBall = 0;
    nDome = 0;
    nLift = 0;
    P[MP.moved] = 0; P[MP.got] = 0; P[MP.vol] = 0; P[MP.ke] = 0;
    P[MP.top] = F.throatY; P[MP.edge] = F.rimY; P[MP.mid] = F.throatY; P[MP.front] = 0; P[MP.wet] = F.throatY;
    P[MP.omega] = 0; P[MP.ring] = F.throatY; P[MP.jump] = 0;
  }

  /** Prędkość rozpływu w punkcie (Dv[0], Dv[1]) wzdłuż normalnej (Dv[2], Dv[3]) przy grubości słupa Dv[4] → Dv[5]. */
  function kinD() {
    const V = P[MP.vFall];
    const hMin = +HMIN;
    let u = M.impact * V * 0.5 / (Dv[4] > hMin ? Dv[4] : hMin) * ((Dv[0] - P[MP.bx]) * Dv[2] + (Dv[1] - P[MP.bz]) * Dv[3]);
    const lim = M.spread * V;
    if (u > lim) u = lim; else if (u < -lim) u = -lim;
    Dv[5] = u + P[MP.vbx] * Dv[2] + P[MP.vbz] * Dv[3];
  }

  /**
   * Wierzch bryły kuli nad punktem odległym o (Dv[0], Dv[1]) od jej osi (w planie) → Dv[7]: wysokość nad środkiem
   * kuli [j.]; poza obrysem −1. Bryła jak w obrazie kuli: górna półkula zwężona „ogonem”, z modami drgań.
   */
  function domeD() {
    const R = P[MP.R];
    const sy = P[MP.sy];
    const sxz = P[MP.sxz];
    const tail = P[MP.tail];
    const dx = Dv[0];
    const dz = Dv[1];
    const rho = Math.sqrt(dx * dx + dz * dz);
    if (rho >= R * sxz * 0.995) { Dv[7] = -1; return; }
    let ny = Math.sqrt(1 - (rho / (R * sxz)) * (rho / (R * sxz)));
    let kx = sxz;
    for (let it = 0; it < 3; it++) {
      kx = sxz * (1 - 0.11 * tail * ny * ny);
      const q = rho / (R * kx);
      ny = q < 1 ? Math.sqrt(1 - q * q) : 0;
    }
    const ky = sy * (1 + 0.05 * tail * ny * ny);
    Dv[0] = dx / (R * kx); Dv[1] = ny; Dv[2] = dz / (R * kx);
    surfaceOffsetInto(modeA, Dv);
    Dv[7] = R * (1 + Dv[3]) * ny * ky;
  }

  /**
   * Kula dotyka leja → cała staje się polem. Bryła jak w obrazie kuli (`kulaTSL.js`): promień z modami drgań,
   * wydłużenie `sy` w pionie i `sxz` w poziomie, zwężenie góry („ogon”). Wysokości słupów są skalowane tak, by ich
   * objętość na siatce była równa objętości kuli z masy (`ballVol`). Komórka dostaje grubość = wysokość słupa;
   * kopuła kuli stoi nad słupem o odstęp jego spodu od wykładziny (`lift` — wierzch masy w obrazie = wierzch kuli);
   * ścianki między komórkami pod kulą dostają prędkość rozpływu (pęd opadania → rozpływ od osi kuli + znos).
   */
  function loadBall() {
    const bx = P[MP.bx];
    const by = P[MP.by];
    const bz = P[MP.bz];
    const R = P[MP.R];
    const sy = P[MP.sy];
    const sxz = P[MP.sxz];
    const rb = R * sxz;
    Dv[6] = by;                    // wysokość środka kuli w chwili zetknięcia (miara drogi opadania kopuły)
    nBall = 0;
    let vol = 0;
    for (let c = 0; c <= NC; c++) {
      chord[c] = 0;
      lift[c] = 0;
      let x = 0;
      let z = 0;
      if (c < NC) {
        const j = (c / NA) | 0;
        const i = c - j * NA;
        x = rc[j] * cosC[i]; z = rc[j] * sinC[i];
      }
      const dx = x - bx;
      const dz = z - bz;
      const rho = Math.sqrt(dx * dx + dz * dz);
      if (rho >= rb * 0.995) continue;
      // spód: dolna półkula (bez „ogona”)
      const qb = rho / rb;
      const nyb = -Math.sqrt(1 - qb * qb);
      Dv[0] = dx / rb; Dv[1] = nyb; Dv[2] = dz / rb;
      surfaceOffsetInto(modeA, Dv);
      const yb = R * (1 + Dv[3]) * nyb * sy;
      // wierzch: górna półkula zwężona „ogonem”
      Dv[0] = dx; Dv[1] = dz;
      domeD();
      const yt = Dv[7];
      const ch = yt - yb;
      if (!(ch > 0.5)) continue;
      chord[c] = ch;
      dome[c] = yt;
      ballCells[nBall++] = c;
      vol += ch * area[c];
    }
    const k = vol > 0 ? P[MP.ballVol] / vol : 0;
    let n = 0;
    for (let q = 0; q < nBall; q++) {
      const c = ballCells[q];
      chord[c] *= k;
      // kopuła kuli nad wierzchem słupa postawionego na wykładzinie
      h[c] += chord[c];
      const gap = by + dome[c] - (zb[c] + h[c]);
      lift[c] = gap > 0 ? gap : 0;
      if (gap > 0) n++;
    }
    nDome = nBall;
    nLift = n;
    // prędkość rozpływu na ściankach pod kulą (grubość ścianki: średnia sąsiednich słupów; na obrysie — słup wewnętrzny)
    for (let j = 0; j < NR; j++) {
      const row = j * NA;
      for (let i = 0; i < NA; i++) {
        const f = row + i;
        const a = j > 0 ? f - NA : NC;
        if (chord[a] > 0 || chord[f] > 0) {
          Dv[0] = rf[j] * cosC[i]; Dv[1] = rf[j] * sinC[i]; Dv[2] = cosC[i]; Dv[3] = sinC[i];
          Dv[4] = chord[a] > 0 && chord[f] > 0 ? 0.5 * (h[a] + h[f]) : chord[a] > 0 ? h[a] : h[f];
          kinD();
          ur[f] = Dv[5];
        }
        const b = row + (i > 0 ? i - 1 : NA - 1);
        if (chord[b] > 0 || chord[f] > 0) {
          Dv[0] = rc[j] * cosF[i]; Dv[1] = rc[j] * sinF[i]; Dv[2] = -sinF[i]; Dv[3] = cosF[i];
          Dv[4] = chord[b] > 0 && chord[f] > 0 ? 0.5 * (h[b] + h[f]) : chord[b] > 0 ? h[b] : h[f];
          kinD();
          ut[f] = Dv[5];
        }
      }
    }
    P[MP.moved] = P[MP.ballVol];
  }

  /** Jeden krok pola o P[dt] sekund. */
  function step() {
    const dt = P[MP.dt];
    const g = P[MP.g];
    const CMAX = 0.4 / dt;
    // (stałe domknięcia jako liczby lokalne: gdy pól jest więcej niż jedno, V8 nie zna typu wartości z kontekstu
    // domknięcia i wybór `x > STAŁA ? x : STAŁA` pakowałby liczbę na stercie w każdym obiegu pętli)
    const hMin = +HMIN;
    const uMax = +UMAX;
    const dry = +DRY;
    const film3 = +FILM3;
    const idr2 = +IDR2;
    const kSmooth = +M.smooth;
    const smoothH = 4;
    const thick = P[MP.thick] > 0 ? P[MP.thick] : 0;
    const DRAG = M.drag + thick * M.dragLate;
    const VISC = M.visc + thick * M.viscLate;
    // kopuła kuli opada dalej jak ciało (środek `by` z symulacji): nad każdą komórką pod kulą obraz bierze wyższe
    // z dwojga — pole albo kopułę; gdy kopuła cała zanurzy się w polu, znika na dobre
    // (kopuła nie jest sztywną czaszą: opadając spłaszcza się z zachowaniem objętości — jej promień rośnie × `w`,
    // wysokość nad środkiem maleje × 1 / w²; na końcu jest niskim, szerokim wałem, który rozpływa się w polu,
    // a nie małą kopułką na placku)
    if (nDome > 0) {
      const by = P[MP.by];
      const bx = P[MP.bx];
      const bz = P[MP.bz];
      let w = 1 + M.domeWiden * (Dv[6] - by) / P[MP.R];
      if (w < 1) w = 1; else if (w > M.domeMax) w = M.domeMax;
      const iw = 1 / w;
      const kh = iw * iw;
      const rise = M.domeRise * dt;
      let n = 0;
      for (let c = 0; c <= NC; c++) {
        let x = 0;
        let z = 0;
        if (c < NC) {
          const j = (c / NA) | 0;
          const i = c - j * NA;
          x = rc[j] * cosC[i]; z = rc[j] * sinC[i];
        }
        Dv[0] = (x - bx) * iw; Dv[1] = (z - bz) * iw;
        domeD();
        let l = Dv[7] > 0 ? by + Dv[7] * kh - (zb[c] + h[c]) : 0;
        if (l > lift[c] + rise) l = lift[c] + rise;
        if (l > 0) { lift[c] = l; n++; } else lift[c] = 0;
      }
      nLift = n;
      if (n === 0) nDome = 0;
    }
    for (let c = 0; c <= NC; c++) { eta[c] = zb[c] + h[c]; hOld[c] = h[c]; }
    const eC = eta[NC];
    // --- prędkości na ściankach promieniowych -------------------------------------------------------------------
    for (let j = 0; j < NR; j++) {
      const row = j * NA;
      const rfj = rf[j];
      const kth = 1 / (rfj * dth * rfj * dth);
      for (let i = 0; i < NA; i++) {
        const f = row + i;
        const a = j > 0 ? f - NA : NC;
        const ea = j > 0 ? eta[a] : eC;
        const eb = eta[f];
        const hf = (ea > eb ? ea : eb) - zb[f];
        if (hf <= dry || (h[a] <= dry && h[f] <= dry)) { urN[f] = 0; hfrN[f] = 0; continue; }
        const u = ur[f];
        const ip = i + 1 < NA ? i + 1 : 0;
        const im = i > 0 ? i - 1 : NA - 1;
        // sąsiedzi wzdłuż promienia (przez komórkę środkową: ścianka naprzeciwko, ze zmienionym znakiem)
        // (sąsiad „przez środek” leży o średnicę gardzieli dalej, nie o `dr`: jego udział w unoszeniu i lepkości jest
        // ważony stosunkiem odległości `W0` — inaczej rozpływ od osi liczyłby się jak ścinanie i hamował wypływ ze środka)
        let uIn;
        let hIn;
        let wIn = 1;
        if (j > 0) { uIn = ur[f - NA]; hIn = hfr[f - NA]; } else { const o = i + HALF < NA ? i + HALF : i + HALF - NA; uIn = -ur[o]; hIn = hfr[o]; wIn = W0; }
        const uOut = ur[f + NA];
        const hOut = hfr[f + NA];
        // unoszenie pędu (zachowawczo): strumień przez komórkę wewnętrzną i zewnętrzną
        const q = u * hfr[f];
        const qa = 0.5 * (uIn * hIn + q);
        const qb = 0.5 * (q + uOut * hOut);
        let hbar = 0.5 * (h[a] + h[f]);
        if (hbar < hMin) hbar = hMin;
        let ca = qa > 0 ? qa / (hbar * dr) : 0;
        let cb = qb < 0 ? qb / (hbar * dr) : 0;
        if (ca > CMAX) ca = CMAX;
        if (cb < -CMAX) cb = -CMAX;
        const adv = ca * wIn * (u - uIn) + cb * (uOut - u);
        // siła odśrodkowa z prędkości obwodowej na tej ściance
        let utf = ut[f] + ut[row + ip];
        if (j > 0) utf = 0.25 * (utf + ut[f - NA] + ut[row - NA + ip]); else utf *= 0.5;
        const cen = utf * utf / rfj;
        // lepkość: sąsiednie ścianki mokre (sucha — bez naprężenia); ściana studni trzyma ciecz
        let lap = 0;
        if (hIn > 0) lap += (uIn - u) * wIn;
        if (hOut > 0 || j + 1 === NR) lap += uOut - u;
        lap *= idr2;
        let lt = 0;
        if (hfr[row + ip] > 0) lt += ur[row + ip] - u;
        if (hfr[row + im] > 0) lt += ur[row + im] - u;
        lap += lt * kth;
        const hfc = hf > hMin ? hf : hMin;
        let un = (u + dt * (-g * (eb - ea) / dr - adv + cen + VISC * lap)) / (1 + dt * (DRAG + film3 / (hfc * hfc)));
        if (un > uMax) un = uMax; else if (un < -uMax) un = -uMax;
        urN[f] = un;
        hfrN[f] = hf;
      }
    }
    // --- prędkości na ściankach obwodowych -----------------------------------------------------------------------
    const swirl = P[MP.swirl];
    for (let j = 0; j < NR; j++) {
      const row = j * NA;
      const dist = rc[j] * dth;
      const kth = 1 / (dist * dist);
      const sw = swirl * swP[j] / M.swirlTau;
      const vT = swV[j];
      for (let i = 0; i < NA; i++) {
        const t = row + i;
        const im = i > 0 ? i - 1 : NA - 1;
        const ip = i + 1 < NA ? i + 1 : 0;
        const a = row + im;
        const ea = eta[a];
        const eb = eta[t];
        const hf = (ea > eb ? ea : eb) - zb[t];
        if (hf <= dry) { utN[t] = 0; hftN[t] = 0; continue; }
        const v = ut[t];
        const vm = ut[a];
        const vp = ut[row + ip];
        const hm = hft[a];
        const hp = hft[row + ip];
        const q = v * hft[t];
        const qa = 0.5 * (vm * hm + q);
        const qb = 0.5 * (q + vp * hp);
        let hbar = 0.5 * (h[a] + h[t]);
        if (hbar < hMin) hbar = hMin;
        let ca = qa > 0 ? qa / (hbar * dist) : 0;
        let cb = qb < 0 ? qb / (hbar * dist) : 0;
        if (ca > CMAX) ca = CMAX;
        if (cb < -CMAX) cb = -CMAX;
        let adv = ca * (v - vm) + cb * (vp - v);
        // prędkość promieniowa na tej ściance; unoszenie krętu po promieniu i przyrost prędkości obwodowej przy dopływie ku osi
        const urf = 0.25 * (ur[a] + ur[t] + ur[a + NA] + ur[t + NA]);
        if (urf > 0) { if (j > 0 && hft[t - NA] > 0) adv += urf * (v - ut[t - NA]) / dr; } else if (j + 1 < NR && hft[t + NA] > 0) adv += urf * (ut[t + NA] - v) / dr;
        const cor = -urf * v / rc[j];
        let lap = 0;
        if (hm > 0) lap += vm - v;
        if (hp > 0) lap += vp - v;
        lap *= kth;
        let lr = 0;
        if (j > 0 && hft[t - NA] > 0) lr += ut[t - NA] - v;
        if (j + 1 < NR) { if (hft[t + NA] > 0) lr += ut[t + NA] - v; } else lr -= v;
        lap += lr * idr2;
        const hfc = hf > hMin ? hf : hMin;
        let vn = (v + dt * (-g * (eb - ea) / dist - adv + cor + VISC * lap + sw * (vT - v))) / (1 + dt * (DRAG + film3 / (hfc * hfc)));
        if (vn > uMax) vn = uMax; else if (vn < -uMax) vn = -uMax;
        utN[t] = vn;
        hftN[t] = hf;
      }
    }
    ur.set(urN);
    hfr.set(hfrN);
    ut.set(utN);
    hft.set(hftN);
    // --- strumienie przez ścianki; ogranicznik odpływu (komórka nie odda więcej, niż ma) ---------------------------
    for (let c = 0; c <= NC; c++) out[c] = 0;
    for (let j = 0; j < NR; j++) {
      const row = j * NA;
      const wdt = rf[j] * dth * dt;
      for (let i = 0; i < NA; i++) {
        const f = row + i;
        const a = j > 0 ? f - NA : NC;
        let fl = ur[f] * hfr[f] * wdt;
        // wygładzanie lustra: strumień ∝ −spadek lustra, tylko między mokrymi komórkami (warstwa > `smoothH`)
        if (h[a] > smoothH && h[f] > smoothH) fl -= kSmooth * (eta[f] - eta[a]) / dr * wdt;
        urN[f] = fl;                                   // (brudnopis: objętość przez ściankę w tym kroku)
        if (fl > 0) out[a] += fl; else out[f] -= fl;
      }
    }
    const ddt = dr * dt;
    for (let j = 0; j < NR; j++) {
      const row = j * NA;
      // (po obwodzie komórki przy gardzieli są węższe niż `dr`: współczynnik ograniczony warunkiem stabilności)
      const dist = rc[j] * dth;
      const kSmT = (dist < dr ? kSmooth * dist * dist / (dr * dr) : kSmooth) / dist;
      for (let i = 0; i < NA; i++) {
        const t = row + i;
        const a = row + (i > 0 ? i - 1 : NA - 1);
        let fl = ut[t] * hft[t] * ddt;
        // (po obwodzie także cienki film: sąsiednie komórki pierścienia leżą na tej samej wysokości wykładziny)
        if (h[a] > 0.5 && h[t] > 0.5) fl -= kSmT * (eta[t] - eta[a]) * ddt;
        utN[t] = fl;
        if (fl > 0) out[a] += fl; else out[t] -= fl;
      }
    }
    for (let c = 0; c <= NC; c++) {
      const vol = h[c] * area[c];
      out[c] = out[c] > vol ? (out[c] > 0 ? vol / out[c] : 0) : 1;
    }
    for (let j = 0; j < NR; j++) {
      const row = j * NA;
      for (let i = 0; i < NA; i++) {
        const f = row + i;
        const a = j > 0 ? f - NA : NC;
        let fl = urN[f];
        if (fl === 0) continue;
        fl *= fl > 0 ? out[a] : out[f];
        h[a] -= fl / area[a];
        h[f] += fl / area[f];
      }
    }
    for (let j = 0; j < NR; j++) {
      const row = j * NA;
      const ia = 1 / area[row];
      for (let i = 0; i < NA; i++) {
        const t = row + i;
        const a = row + (i > 0 ? i - 1 : NA - 1);
        let fl = utN[t];
        if (fl === 0) continue;
        fl *= fl > 0 ? out[a] : out[t];
        h[a] -= fl * ia;
        h[t] += fl * ia;
      }
    }
    // --- zaokrąglenia, stygnięcie cienkiej warstwy, największa zmiana grubości -----------------------------------
    const kc = 1 - Math.exp(-dt / M.coolTau);
    const kh = 1 - Math.exp(-dt / M.heatTau);
    let jump = 0;
    for (let c = 0; c <= NC; c++) {
      let hc = h[c];
      if (hc < 0) { hc = 0; h[c] = 0; }
      const d = hc - hOld[c];
      if (d > jump) jump = d; else if (-d > jump) jump = -d;
      let want = 1 - hc / M.coolH;
      if (want < 0) want = 0;
      cool[c] += (want - cool[c]) * (want > cool[c] ? kc : kh);
    }
    P[MP.jump] = jump;
  }

  /**
   * Upust gardzieli: zabiera do P[want] j.³ → P[got]. Najpierw z komórki środkowej (krąg nad gardzielą), resztę
   * z pierścienia przy jej wardze — ciecz, która wiruje wokół gardzieli, spływa do niej po ścianie rury (bez tego wir
   * trzymałby ją siłą odśrodkową z dala od osi i gardziel by głodowała).
   */
  function drain() {
    let want = P[MP.want];
    if (!(want > 0)) { P[MP.got] = 0; return; }
    let got = 0;
    const have = h[NC] * area[NC];
    let take = want < have ? want : have;
    h[NC] = take < have ? h[NC] - take / area[NC] : 0;
    got += take;
    want -= take;
    if (want > 0) {
      let ring = 0;
      for (let i = 0; i < NA; i++) ring += h[i];
      ring *= area[0];
      if (ring > 0) {
        take = want < ring ? want : ring;
        const k = 1 - take / ring;
        for (let i = 0; i < NA; i++) h[i] *= k;
        got += take;
      }
    }
    P[MP.got] = got;
  }

  /** Odejmuje P[want] j.³ z komórki `c` (kropla odrywa się od masy) → P[got]. */
  function takeAt(c) {
    let take = P[MP.want];
    const have = h[c] * area[c];
    if (take >= have) { take = have; h[c] = 0; } else h[c] -= take / area[c];
    P[MP.got] = take;
  }

  /**
   * Normalizacja do masy autorytatywnej: objętość pola = P[target] (różnica to zaokrąglenia do całkowitych jednostek
   * symulacji); przy okazji pomiary dla symulacji i testów (`MP.vol` … `MP.ring`).
   */
  function normalize() {
    const target = P[MP.target];
    let vol = 0;
    for (let c = 0; c <= NC; c++) vol += h[c] * area[c];
    if (!(target > 0)) {
      if (vol > 0) { h.fill(0); ur.fill(0); ut.fill(0); hfr.fill(0); hft.fill(0); }
      vol = 0;
    } else if (vol > 0) {
      const k = target / vol;
      if (k !== 1) for (let c = 0; c <= NC; c++) h[c] *= k;
      vol = target;
    } else {
      h[NC] = target / area[NC];
      vol = target;
    }
    P[MP.vol] = vol;
    // pomiary
    let top = F.throatY;
    let edge = F.rimY;
    let front = 0;
    let wet = F.throatY;
    let ke = 0;
    let mass = 0;
    if (h[NC] > 0.5) top = zb[NC] + h[NC];
    for (let j = 0; j < NR; j++) {
      const row = j * NA;
      const wr = rf[j] * dth * dr;
      for (let i = 0; i < NA; i++) {
        const c = row + i;
        const hc = h[c];
        if (hc > 3) {
          const e = zb[c] + hc;
          if (e > top) top = e;
          if (rc[j] > front) front = rc[j];
          if (zb[c] > wet) wet = zb[c];
          if (j === NR - 1 && e > edge) edge = e;
        }
        const m1 = hfr[c] * wr;
        const m2 = hft[c] * rc[j] * dth * dr;
        ke += m1 * ur[c] * ur[c] + m2 * ut[c] * ut[c];
        mass += m1 + m2;
      }
    }
    P[MP.top] = top;
    P[MP.edge] = edge;
    P[MP.front] = front;
    P[MP.wet] = wet;
    P[MP.ke] = mass > 0 ? Math.sqrt(2 * ke / mass) : 0;
    P[MP.mid] = zb[NC] + h[NC];
    // obrót cieczy przy gardzieli: największy kręt (średnia prędkość obwodowa × promień) wśród pierścieni przy gardzieli,
    // przeliczony na prędkość kątową przy jej wardze (gdy pierścień przy samej wardze jest już suchy — wir z dalszych)
    let circ = 0;
    for (let j = 0; j < 8; j++) {
      let sum = 0;
      for (let i = 0; i < NA; i++) sum += ut[j * NA + i];
      const gj = sum / NA * rc[j];
      if (gj > circ) circ = gj;
    }
    P[MP.omega] = circ / (rc[0] * rc[0]);
    let ring = 0;
    let wetN = 0;
    for (let i = 0; i < NA; i++) {
      const c = JREF * NA + i;
      if (h[c] > 1) { ring += zb[c] + h[c]; wetN++; }
    }
    P[MP.ring] = wetN > 0 ? ring / wetN : P[MP.mid];
    // nierówność lustra względem płaskiego jeziora o tej samej objętości (poziom z objętości stożka ściętego)
    const flat = F.throatY + (Math.cbrt(r0 * r0 * r0 + 3 * FSL * vol / Math.PI) - r0) / FSL;
    let dev = (zb[NC] + h[NC] - flat) * (zb[NC] + h[NC] - flat) * area[NC];
    let ar = area[NC];
    for (let c = 0; c < NC; c++) {
      const e = zb[c] + h[c];
      if (zb[c] >= flat && h[c] < 0.5) continue;       // sucha wykładzina ponad poziomem
      const d = (e > zb[c] ? e : zb[c]) - (flat > zb[c] ? flat : zb[c]);
      dev += d * d * area[c];
      ar += area[c];
    }
    P[MP.rough] = vol > 0 ? Math.sqrt(dev / ar) : 0;
  }

  /**
   * Widok dla obrazu → `outA` (rekord `MASA_STRIDE` na komórkę): grubość RYSOWANA — warstwa pola + wystawanie
   * kopuły kuli nad pole (w chwili zetknięcia wierzch masy = wierzch kuli) — i ostygnięcie cienkiej warstwy.
   */
  function writeView(outA) {
    for (let c = 0; c <= NC; c++) {
      const o = c * MASA_STRIDE;
      // (kopuła wynurza się z pola gładko: przy samym styku przyrost kwadratowy — bez załamania na linii styku)
      const l = lift[c];
      outA[o] = h[c] + (l > 0 ? l * l / (l + 14) : 0);
      outA[o + 1] = l > 0 ? 0 : cool[c];
    }
  }

  /**
   * Czoło masy na wycinku `i`: najdalsza od osi komórka z warstwą grubszą niż 5 j. → jej numer (−1: brak). Prędkość
   * promieniowa cieczy w tej komórce → P[got].
   */
  function frontCell(i) {
    for (let j = NR - 1; j >= 0; j--) {
      const c = j * NA + i;
      if (h[c] > 5) { P[MP.got] = 0.5 * (ur[c] + ur[c + NA]); return c; }
    }
    return -1;
  }

  reset();
  return {
    P, h, zb, area, cool, chord, lift, rc, cosC, sinC, ur, ut,
    /** Liczba komórek, nad którymi kopuła kuli stoi jeszcze ponad polem (tonie w nim w ułamku sekundy po zetknięciu). */
    get ballLeft() { return nLift; },
    nr: NR, na: NA, center: NC, dr, dth, r0,
    reset, loadBall, step, drain, takeAt, normalize, writeView, frontCell
  };
}
