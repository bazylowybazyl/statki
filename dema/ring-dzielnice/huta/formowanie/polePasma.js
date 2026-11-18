// HUTA — formowanie, etapy „Pasmo w polu” i „Kropla”: OSPRZĘT POLA LINII (czysty JS, rejestrator `Budowniczy`; siatka
// otoczenia).
//
// Bryły na fundamentach hali, wszystkie otwarte od góry — z kamery gry nic nie zasłania metalu (test: nad pasmem
// |z| < 110 nic; nad strugą tylko cienkie pierścienie). Emitery pola (rodzaj `pole`, parametr = kanał siły `POLE_K`)
// świecą cyjanem z siłą z symulacji:
//   KOŁNIERZ      pierścień pola na wardze wylewki (wokół zaworu) — struga od wylotu w uchwycie pola
//   PIERŚCIENIE   dwa cienkie pierścienie pola za wargą (prostopadłe do strugi), wsporniki z boków do kołnierza
//   ZACISK        grzebień bramek pola wzdłuż rękawa błony (płetwy po bokach, żebra pod spodem) — bramka świeci tam,
//                 gdzie jest wędrujący zacisk (etap „Wyciskanie”; zastąpił prasę i słupy boczne)
//   ŁOŻE          trzy niskie poprzeczki z emiterem pod błoną (trzymają ją od dołu)
//   G0            pierścień C gardzieli formującej (przerwa u góry; emiter na dolnej połowie)
//   G1–G4         jarzma: para słupów z nakładkami po bokach pasma, poprzeczka pod spodem z listwą
//   PODUSZKA      szyny pod pasmem (z ±150) z listwą pola u góry
//   CHŁODNICE     C1, C2: panele po bokach (pochylone 35°, żebra od zewnątrz; przy miedzi dosuwają się — rodzaj
//                 `chlodnica`, kierunek ruchu w `aM`) i panel pod pasmem za G4
import { BLONA, DROGA, HALA, LINIA, PATH, SPUST, ZACISK, ZAWOR, arcRingFrame, spustPoint } from "./geometria.js";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** Rodzaje powierzchni (zgodne z `OTO` w `otoczenie.js`). */
export const OTO_POLE = Object.freeze({ pole: 29, chlodnica: 30 });
/** Dosunięcie paneli C1 przy miedzi [j.] (kierunek w `aM`, wielkość w shaderze × udział miedzi). */
export const CHILL_SHIFT = 55;

const STEEL = [0.14, 0.145, 0.158];
const DARK = [0.045, 0.047, 0.052];
const FRAME = [0.105, 0.108, 0.118];
const HOUSING = [0.075, 0.08, 0.09];
const RADIATOR = [0.06, 0.062, 0.066];
const CYAN = [0.2, 0.9, 1.0];
const YELLOW = [0.5, 0.33, 0.04];
const STAL = 8;                  // RODZAJ.stal
const FARBA = 0;
/** Kanały siły pola (`OU.pole`, 16 kanałów) — wspólne z materiałami (`POLE_KANAL` w `pasmoTSL.js`). */
export const POLE_K = Object.freeze({
  kolnierz: 0, struga1: 1, struga2: 2, rekaw: 3, zacisk: 4, loze0: 5, loze1: 6, loze2: 7,
  G0: 8, G1: 9, G2: 10, G3: 11, G4: 12, poduszka0: 13, poduszka1: 14, boki: 15,
  // (poprawki rundy 6) pierścienie pola na łuku strugi; kanał 3 (dawny „rękaw”) i 18 (wolny po walcowni)
  struga3: 3, struga4: 18
});
const PASMO_SLIP = DROGA.sLip;

/** Torus emitera pola z kanałem siły `ch` (rejestrator wpisuje kąt obwodu w parametr — tu wraca kanał). */
function poleTorus(B, cx, cy, cz, ax, ay, az, R, r, ch) {
  B.paint(...CYAN, OTO_POLE.pole, ch);
  const n0 = B.n;
  B.torus(cx, cy, cz, ax, ay, az, R, r, 64, 6);
  for (let i = n0; i < B.n; i++) B.aux[i * 2 + 1] = ch;
}

/** Słup od punktu do pokładu hali (kwadrat w × w). */
function post(B, x, y, z, w) {
  B.abox(x, (y + HALA.deckY) / 2, z, w / 2, (y - HALA.deckY) / 2, w / 2);
}

export function buildLineField(B) {
  const PY = HALA.passY;
  const DY = HALA.deckY;
  const L = LINIA;
  B.move(0, 0, 0);

  // --- WYLEWKA: kołnierz pola na wardze (kanał 0) i dwa pierścienie pola za wargą (kanały 1, 2) — struga od wylotu w
  // uchwycie pola; cienkie pierścienie, wsporniki z boków (z góry nic nie leży nad strugą poza kreską pierścienia)
  {
    const q = new Float64Array(6);
    const D = ZAWOR.d;
    spustPoint(PASMO_SLIP, q);
    const lip = [q[0], q[1]];
    const R0 = SPUST.lipR;
    B.paint(...HOUSING, STAL);
    B.torus(lip[0] + D[0] * 6, lip[1] + D[1] * 6, 0, D[0], D[1], 0, R0, 9, 72, 10);
    poleTorus(B, lip[0] + D[0] * 13, lip[1] + D[1] * 13, 0, D[0], D[1], 0, R0 - 3, 3.2, POLE_K.kolnierz);
    SPUST.rings.forEach((off, k) => {
      spustPoint(PASMO_SLIP + off, q);
      const R = SPUST.ringR[k];
      B.paint(...HOUSING, STAL);
      B.torus(q[0], q[1], 0, q[3], q[4], 0, R + 3, 4.5, 64, 8);
      poleTorus(B, q[0] - q[3] * 2, q[1] - q[4] * 2, 0, q[3], q[4], 0, R - 2, 2.2, k === 0 ? POLE_K.struga1 : POLE_K.struga2);
      // wsporniki z boków: od kołnierza wylewki do boku pierścienia (z ±R)
      B.paint(...FRAME, STAL);
      for (const sd of [-1, 1]) B.beam(lip[0] - D[0] * 4, lip[1] - D[1] * 4, sd * (R0 + 4), q[0], q[1], sd * (R + 4), 7, 7);
    });
    // PIERŚCIENIE NA ŁUKU STRUGI (poprawki rundy 6; kanały `struga3`, `struga4`): pochylone ku poziomowi — z góry elipsy
    // wokół strugi; wsporniki z boków (z = ±(R + 4)) łańcuchem od ostatniego pierścienia przy wylewce
    let prev = null;
    {
      const k = SPUST.rings.length - 1;
      spustPoint(PASMO_SLIP + SPUST.rings[k], q);
      prev = [q[0], q[1], SPUST.ringR[k]];
    }
    const f = new Float64Array(6);
    SPUST.arcRings.forEach((A, k) => {
      arcRingFrame(k, f);
      const R = A.R;
      B.paint(...HOUSING, STAL);
      B.torus(f[0], f[1], 0, f[2], f[3], 0, R + 3, 4, 64, 8);
      poleTorus(B, f[0] - f[2] * 2, f[1] - f[3] * 2, 0, f[2], f[3], 0, R - 2, 2.2, k === 0 ? POLE_K.struga3 : POLE_K.struga4);
      B.paint(...FRAME, STAL);
      for (const sd of [-1, 1]) B.beam(prev[0], prev[1], sd * (prev[2] + 4), f[0], f[1], sd * (R + 4), 6, 6);
      prev = [f[0], f[1], R];
    });
  }
  // --- ZACISK POLA (kanał 4; etap „Wyciskanie”): grzebień bramek wzdłuż rękawa — cienkie ramy U (dwie płetwy-emitery po
  // bokach, żebro pod błoną) co `pitch` j. na dwóch podłużnych progach. Bramka świeci tam, gdzie jest zacisk (położenie i
  // siła z symulacji — shader otoczenia liczy jasność z x fragmentu), więc z góry widać wędrującą parę jasnych kresek po
  // bokach błony, a pod zapadniętym rękawem — jasne żebro. Z góry nic nie leży nad metalem (płetwy na |z| = zR, żebra pod
  // błoną). Zastępuje prasę (jarzmo, płytę, szyny) i słupy boczne rundy 6.
  {
    const Z = ZACISK;
    const zR = Z.zR;
    const hw = Z.finW / 2;
    const yS = Z.sillY;
    // progi (podłużne belki pod płetwami) i podpory do pokładu
    for (const sd of [-1, 1]) {
      B.paint(...STEEL, STAL);
      B.abox((Z.x0 + Z.x1) / 2, yS, sd * zR, (Z.x1 - Z.x0) / 2 + 14, 6, 9);
      B.paint(...DARK, STAL);
      B.abox((Z.x0 + Z.x1) / 2, yS - 7, sd * zR, (Z.x1 - Z.x0) / 2 + 16, 1.5, 11);
      B.paint(...FRAME, STAL);
      for (let x = Z.x0 + 20; x <= Z.x1 - 10; x += 120) {
        B.abox(x, (yS - 8 + DY) / 2, sd * zR, 7, (yS - 8 - DY) / 2, 7);
        B.abox(x, DY + 4, sd * zR, 18, 4, 18);
      }
    }
    for (let x = Z.x0; x <= Z.x1 + 0.5; x += Z.pitch) {
      for (const sd of [-1, 1]) {
        // płetwa: cienka listwa pionowa od progu do `finTop`, czapka u góry
        B.paint(...HOUSING, STAL);
        B.abox(x, (yS + 6 + Z.finTop) / 2, sd * zR, Z.finL / 2, (Z.finTop - yS - 6) / 2, hw);
        B.paint(...DARK, STAL);
        B.abox(x, Z.finTop + 2, sd * zR, Z.finL / 2 + 1, 2, hw + 1.5);
        // emiter: lico ku błonie i listwa na wierzchu czapki (z góry krótka kreska)
        B.paint(...CYAN, OTO_POLE.pole, POLE_K.zacisk);
        B.abox(x, (yS + 14 + Z.finTop - 10) / 2, sd * (zR - hw - 0.6), Z.finL / 2 - 2, (Z.finTop - 10 - yS - 14) / 2, 0.6);
        B.abox(x, Z.finTop + 4.6, sd * zR, Z.finL / 2 - 1.5, 0.6, hw - 0.5);
      }
      // żebro pod błoną (od progu do progu) z listwą pola u góry
      B.paint(...HOUSING, STAL);
      B.abox(x, Z.ribY, 0, 3, 3, zR - 6);
      B.paint(...CYAN, OTO_POLE.pole, POLE_K.zacisk);
      B.abox(x, Z.ribY + 3.6, 0, 1.6, 0.6, zR - 30);
    }
  }
  // --- ŁOŻE POLA (kanały 5–7): niskie poprzeczki pod błoną z emiterem u góry (trzymają błonę od dołu) -------------
  BLONA.bed.forEach((x, k) => {
    B.paint(...HOUSING, STAL);
    B.abox(x, DY + 12, 0, 16, 12, 220);
    B.paint(...CYAN, OTO_POLE.pole, POLE_K.loze0 + k);
    B.abox(x, DY + 24.6, 0, 10, 0.6, 200);
    B.paint(...FRAME, STAL);
    for (const sd of [-1, 1]) B.abox(x, DY + 6, sd * 230, 26, 6, 18);
  });
  // --- G0 (kanał 8): GARDZIEL FORMUJĄCA błony — pierścień C (przerwa u góry; emiter na dolnej połowie — nad osią pasma
  // nic w |z| < 110)
  {
    const x = L.gates[0].x;
    const u0 = -16 * DEG; const u1 = 196 * DEG;
    B.paint(...HOUSING, STAL);
    B.torus(x, PY, 0, 1, 0, 0, 124, 8, 64, 8, u0, u1);
    B.paint(...CYAN, OTO_POLE.pole, POLE_K.G0);
    const n0 = B.n;
    B.torus(x, PY, 0, 1, 0, 0, 115, 2.8, 48, 6, 0.02, Math.PI - 0.02);
    for (let i = n0; i < B.n; i++) B.aux[i * 2 + 1] = POLE_K.G0;
    B.paint(...FRAME, STAL);
    for (const a of [55, 125]) {
      const y = PY - Math.sin(a * DEG) * 124;
      const z = Math.cos(a * DEG) * 124;
      post(B, x, y, z, 14);
    }
  }
  // --- G1–G4 (kanały 9–12): jarzma z parą nakładek i poprzeczką pod pasmem ---------------------------------------------
  L.gates.slice(1).forEach((g, k) => {
    const zg = Math.max(g.a + 48, 118);
    const top = PY + 50;
    for (const sd of [-1, 1]) {
      B.paint(...STEEL, STAL);
      B.abox(g.x, (top + DY) / 2, sd * (zg + 10), 16, (top - DY) / 2, 10);
      B.paint(...DARK, STAL);
      B.abox(g.x, top + 3, sd * (zg + 10), 19, 3, 13);
      B.paint(...CYAN, OTO_POLE.pole, 9 + k);
      B.abox(g.x, PY, sd * (zg - 0.6), 12, 34, 0.6);
    }
    B.paint(...STEEL, STAL);
    B.abox(g.x, PY - 92, 0, 14, 10, zg + 20);
    B.paint(...CYAN, OTO_POLE.pole, 9 + k);
    B.abox(g.x, PY - 81.4, 0, 9, 0.6, g.a + 10);
  });
  // --- PODUSZKA (kanały 13, 14): szyny pod pasmem z listwą pola u góry ------------------------------------------------
  L.cushion.forEach(([x0, x1], k) => {
    const y = PY - 52;
    for (const sd of [-1, 1]) {
      const z = sd * 150;
      B.paint(...HOUSING, STAL);
      B.abox((x0 + x1) / 2, y, z, (x1 - x0) / 2, 9, 8);
      B.paint(...CYAN, OTO_POLE.pole, 13 + k);
      B.abox((x0 + x1) / 2, y + 9.4, z, (x1 - x0) / 2 - 4, 0.5, 3);
      B.paint(...FRAME, STAL);
      // podpory (omijają doły zgorzeliny pod klatkami)
      for (let x = x0 + 30; x < x1; x += 140) {
        const inPit = L.stands.some((s) => Math.abs(x - s.x) < L.pit.hx + 12);
        if (!inPit) post(B, x, y - 9, z, 10);
      }
    }
  });
  // --- CHŁODNICE C1, C2: panele po bokach (pochylone), żebra od zewnątrz; panel pod pasmem za G4 ------------------
  {
    const avoid = L.gates.slice(1).map((g) => g.x);
    const sections = [];
    // C1 w odcinkach między słupami bram G1–G4 (przy miedzi panel dosuwa się pod słupy)
    let xs = L.chill.C1[0] + 14;
    for (const ax of avoid) {
      if (ax - 26 > xs) sections.push([xs, ax - 26, 0]);
      xs = ax + 26;
    }
    sections.push([xs, L.chill.C1[1] - 6, 0]);
    sections.push([L.chill.C2[0] + 6, L.chill.C2[1] - 6, 1]);
    for (const [x0, x1, c2] of sections) {
      for (const sd of [-1, 1]) {
        const zi = sd * (L.chill.side0 + 5);
        const zo = sd * L.chill.side1;
        const yi = PY - 25;
        const yo = PY - 25 + (L.chill.side1 - L.chill.side0 - 5) * Math.tan((c2 ? 48 : 35) * DEG);
        // panel: płyta pochylona (lico ku pasmu), dosuwana tylko w C1
        B.move(0, c2 ? 0 : -sd, 0);
        B.paint(...RADIATOR, OTO_POLE.chlodnica, 0);
        const nz = -(yo - yi);
        const ny = zo - zi;
        const nl = Math.hypot(nz, ny);
        const t = 2.5;
        const oz = nz / nl * t * sd;
        const oy = ny / nl * t * sd;
        // lico (ku pasmu) i tył
        B.quad(x0, yi + oy, zi + oz, x1, yi + oy, zi + oz, x1, yo + oy, zo + oz, x0, yo + oy, zo + oz);
        B.quad(x0, yo - oy, zo - oz, x1, yo - oy, zo - oz, x1, yi - oy, zi - oz, x0, yi - oy, zi - oz);
        // krawędzie
        B.quad(x0, yi - oy, zi - oz, x0, yi + oy, zi + oz, x0, yo + oy, zo + oz, x0, yo - oy, zo - oz);
        B.quad(x1, yo - oy, zo - oz, x1, yo + oy, zo + oz, x1, yi + oy, zi + oz, x1, yi - oy, zi - oz);
        B.quad(x0, yo - oy, zo - oz, x0, yo + oy, zo + oz, x1, yo + oy, zo + oz, x1, yo - oy, zo - oz);
        B.quad(x1, yi - oy, zi - oz, x1, yi + oy, zi + oz, x0, yi + oy, zi + oz, x0, yi - oy, zi - oz);
        // żebra od zewnątrz (prostopadle do panelu)
        B.paint(...RADIATOR.map((c) => c * 0.8), OTO_POLE.chlodnica, 0);
        const bz = -oz / t;
        const by = -oy / t;
        const f = 16;
        for (let x = x0 + 12; x < x1 - 6; x += 26) {
          B.box(x, (yi + yo) / 2 + by * (t + f / 2), (zi + zo) / 2 + bz * (t + f / 2), 1, 0, 0, 0, (yo - yi) / 2, (zo - zi) / 2, 0, by * f / 2, bz * f / 2);
        }
        // wspornik: od cokołu chłodnic do górnej krawędzi panelu
        B.paint(...FRAME, STAL);
        for (const x of [x0 + 10, x1 - 10]) B.beam(x, DY + 6, sd * (L.chill.side0 + L.chill.side1) / 2, x, yo - 4, zo - sd * 8, 9, 9);
        B.move(0, 0, 0);
      }
    }
    // panel pod pasmem: od G4 do końca C2 (między szynami poduszki), żebra w dół
    const x0 = L.gates[4].x + 26;
    const x1 = L.chill.C2[1] - 6;
    const yU = PY - 96;
    B.paint(...RADIATOR, OTO_POLE.chlodnica, 0);
    B.abox((x0 + x1) / 2, yU, 0, (x1 - x0) / 2, 2.5, 128);
    B.paint(...RADIATOR.map((c) => c * 0.8), OTO_POLE.chlodnica, 0);
    for (let x = x0 + 10; x < x1; x += 24) B.abox(x, yU - 11, 0, 1, 8.5, 124);
    B.paint(...FRAME, STAL);
    for (let x = x0 + 30; x < x1; x += 160) for (const z of [-100, 100]) post(B, x, yU - 20, z, 10);
  }
  B.paint(0.5, 0.5, 0.5, FARBA);
  return B.n;
}

/** Odcinki (x0, x1) paneli C1 i C2 do testów kolizji z jarzmami bram. */
export const FIELD_INFO = Object.freeze({ g0R: 115, zaciskZ: ZACISK.zR });
export { TAU, PATH };
