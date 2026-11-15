// HUTA — fizyczna ruda: geometria jednego stanowiska (czysta matematyka, bez three i DOM).
//
// UKŁAD STANOWISKA: x — wzdłuż ringu, liczone od OSI TORU (laneX = 0), z — w przestrzeń w układzie dzielnicy huty
// (te same liczby co `huta/uklad.js`: Z0 = 6 300, nabrzeże z = 11 450, statek 12 530), y — wysokość K-7 nieściśnięta
// (rysunek ściska ją dopiero przez `k7HeightToZ`). Wszystko, co liczy symulacja i co dostaje obraz, jest w tym układzie.
//
// Tor: statek (dziób ku −z) → ładownia (krata 42 × 78 kolumn, GŁĘBOKA: dno 50 j. pod pokładem, ładunek 14 warstw) →
// dzwon ssawy na wózku suwnicy → rura (wysięgnik, noga,
// pirs, dmuchawa, kanał zrzutowy) → wylot nad zasiekiem → kopiec w zasieku z dnem-lejem → pięć zasuw w dnie pod osią
// kopca → taśma zbiorcza pod dnem → taśma pochyła do galerii pieca.
//
// Zmiany względem układu huty (SPEC, „dodatki”): dno zasieku obniżone z −60 do −120 i zagłębione lejem do −150 przy
// zasuwach (cały kopiec leży pod y = 116); odbiór przeniesiony pod oś kopca (dawna krata leżała 670 j. obok);
// taśma pochyła biegnie pustą, zachodnią częścią zasieku i nad murem wchodzi w galerię pieca.
import { GRAIN } from './rudy.js';

/**
 * Ładownia ciężkiego frachtowca: 4 × 2 pola 117 × 126 j. (wzdłuż statku × w poprzek), środek 129 j. za środkiem statku
 * ku rufie (jak ładownia w `huta/uklad.js`, tam 8 × 3 pola 85 × 115 j. — obrys 684 × 348 j.). Obrys jest tu MNIEJSZY
 * (468 × 252 j.), a ładunek dwa razy GŁĘBSZY (ok. 72 j., 14 ziaren zamiast 7): w warstwie 7 ziaren dzwon odsłaniał
 * płaskie dno z urwiskiem na kilka ziaren, w 14 kopie lej ze zboczami pod kątem usypu.
 */
export const SHIP_HOLD = Object.freeze({ cols: 4, rows: 2, center: 129, pitchX: 117, pitchY: 126, length: 1800 });

/** Segmenty rury liczone OD WYLOTU (punkt 0) do gardzieli dzwonu (punkt 8). Punkty 0–4 stałe, 5–8 jadą z suwnicą. */
export const PIPE_POINTS = 9;
export const PIPE_SEG = Object.freeze({ tip: 0, chute: 1, blower: 2, cyclone: 3, pier: 4, leg: 5, boom: 6, hose: 7 });

export function createStationGeometry({ Z0 = 6300, depth = 5150 } = {}) {
  const a = GRAIN.cell;
  const hL = GRAIN.layer;
  const quayZ = Z0 + depth;                   // 11 450 — lico nabrzeża
  const berthZ = quayZ + 1080;                // 12 530 — środek statku (dziób 180 j. od nabrzeża)

  // --- statek i ładownia
  const ship = Object.freeze({ x: 0, z: berthZ, heading: -Math.PI / 2, length: SHIP_HOLD.length, width: 720, deck: 116, reach: 5200 });
  const holdNx = 42;                          // 252 j. (2 pola × 126)
  const holdNz = 78;                          // 468 j. (4 pola × 117)
  const holdX0 = -holdNx * a / 2;             // −126
  const holdZ0 = berthZ + SHIP_HOLD.center - holdNz * a / 2;   // 12 425
  const holdBase = 13;                        // dno ładowni: poziom 13 × 5,1 = 66,3 — 50 j. POD pokładem (116)
  const fields = [];
  const hx = SHIP_HOLD.pitchY / 2;
  const hz = SHIP_HOLD.pitchX / 2;
  for (let c = 0; c < SHIP_HOLD.cols; c++) {
    for (let r = 0; r < SHIP_HOLD.rows; r++) {
      const rr = c % 2 ? SHIP_HOLD.rows - 1 - r : r;          // wężykiem: ssawa nie wraca przez całą szerokość
      const x = (rr - (SHIP_HOLD.rows - 1) / 2) * SHIP_HOLD.pitchY;
      const z = holdZ0 + SHIP_HOLD.pitchX * (c + 0.5);        // pole 0 od dziobu (od strony nabrzeża)
      fields.push(Object.freeze({
        c, r: rr, x, z,
        i0: Math.max(0, Math.floor((x - hx - holdX0) / a)), i1: Math.min(holdNx - 1, Math.floor((x + hx - holdX0) / a)),
        j0: Math.max(0, Math.floor((z - hz - holdZ0) / a)), j1: Math.min(holdNz - 1, Math.floor((z + hz - holdZ0) / a))
      }));
    }
  }
  const hold = Object.freeze({
    nx: holdNx, nz: holdNz, x0: holdX0, z0: holdZ0, x1: holdX0 + holdNx * a, z1: holdZ0 + holdNz * a,
    // zrębnica: 100 j. nad dnem (50 j. nad pokładem); `pitchX` / `pitchZ` — podziałka pól w poprzek i wzdłuż statku
    base: holdBase, floorY: holdBase * hL, coamingY: holdBase * hL + 100,
    pitchX: SHIP_HOLD.pitchY, pitchZ: SHIP_HOLD.pitchX,
    fields: Object.freeze(fields)
  });

  // --- pirs, suwnica odkurzacza, dzwon
  const pier = Object.freeze({ x0: 410, x1: 550, z0: quayZ, z1: quayZ + 2000, top: 150 });
  const gantry = Object.freeze({ x: 480, park: quayZ + 230, boomY: 446, boomX0: -230, boomX1: 550, legBase: 150 });
  const trolley = Object.freeze({ park: 280 });
  const bell = Object.freeze({
    r: 30,                 // promień dolnej krawędzi dzwonu
    throatR: 14,           // promień gardzieli (wejście do rury)
    throatH: 22,           // gardziel nad krawędzią dzwonu
    parkY: 290,            // krawędź dzwonu w spoczynku
    hoseR: 13              // wąż teleskopowy nad dzwonem (cieńszy niż gardziel z kołnierzem — z góry widać klatkę dzwonu)
  });

  // --- rura: punkty stałe od wylotu wstecz (x, y, z)
  const spoutPos = [330, 300, Z0 + 4610];                       // wylot nad zasiekiem
  const pipeFixed = [
    spoutPos,                                                   // 0 wylot
    [350, 320, Z0 + 4650],                                      // 1 kolano kanału zrzutowego
    [440, 250, Z0 + 4890],                                      // 2 króciec dmuchawy
    [480, 300, Z0 + 4950],                                      // 3 cyklon dmuchawy
    [480, 190, quayZ - 60]                                      // 4 koniec rury pirsu (od strony nabrzeża)
  ];
  // okna (odcinki oszklone / klatkowe): `seg` — numer odcinka między punktami seg i seg + 1, `from`…`to` — droga od
  // punktu `seg` [j.]; odcinek kanału zrzutowego cały w klatce, na rurze pirsu okna co 320 j., na wysięgniku jedno długie
  const windows = [{ seg: PIPE_SEG.chute, from: 0, to: 1e9 }, { seg: PIPE_SEG.boom, from: 60, to: 300 }];
  for (let d = 130; d < 1700; d += 320) windows.push({ seg: PIPE_SEG.pier, from: d, to: d + 120 });
  // `light` — ŚWIATŁO rury na odcinku (promień wnętrza narysowanej rury albo połowa boku klatki; odcinki jak PIPE_SEG):
  // ziarno w oknie rury musi się w nim mieścić razem ze swoją bryłką (`stanowisko.js`, `writePipe`). `boomR` — rura stała
  // na wysięgniku, `slideR` — rura wysuwna do wózka (wchodzi w stałą), `legR` — pion przy nodze suwnicy.
  const pipe = Object.freeze({
    r: 30, pierY: 190, legR: 26, boomR: 28, slideR: 25,
    light: Object.freeze([30, 30, 30, 30, 30, 26, 25, 13]),
    fixed: Object.freeze(pipeFixed.map((p) => Object.freeze(p))), windows: Object.freeze(windows.map((w) => Object.freeze(w)))
  });
  const blower = Object.freeze({ x: 480, z: Z0 + 4950 });

  // --- zasiek: krata 284 × 155 kolumn, dno-lej ku linii zasuw
  const bx0 = -852;
  const bz0 = Z0 + 3760;                       // 10 060
  const bNx = 284;                             // 1 704 j.
  const bNz = 155;                             // 930 j.
  const gateZ = bz0 + 81 * a;                  // 10 546 — oś linii zasuw (granica komórek)
  const gateXs = [192, 126, 60, -6, -72];      // środki zasuw (kolejność: od początku taśmy zbiorczej)
  const gateHalf = 3 * a;                      // zasuwa 36 × 36 j. (6 × 6 kolumn)
  const floorEdge = -120;
  const floorGate = -150;
  const floorSlope = 0.14;
  const gx0 = gateXs[gateXs.length - 1];
  const gx1 = gateXs[0];
  /** Wysokość dna zasieku (lej: −150 na linii zasuw, +0,14 j. na jednostkę odległości, od −120 płasko). */
  const floor = (x, z) => {
    const dx = x < gx0 ? gx0 - x : x > gx1 ? x - gx1 : 0;
    const dz = z - gateZ;
    const y = floorGate + floorSlope * Math.sqrt(dx * dx + dz * dz);
    return y < floorEdge ? y : floorEdge;
  };
  const bunker = Object.freeze({
    nx: bNx, nz: bNz, x0: bx0, z0: bz0, x1: bx0 + bNx * a, z1: bz0 + bNz * a,
    wallTop: 150, wallT: 60, floorEdge, floorGate, floorSlope, floor
  });
  const gates = Object.freeze({
    count: gateXs.length, z: gateZ, xs: Object.freeze(gateXs), half: gateHalf, cells: 6,
    i0: Object.freeze(gateXs.map((x) => Math.round((x - gateHalf - bx0) / a))), j0: Math.round((gateZ - gateHalf - bz0) / a)
  });

  // --- wylot: cel strugi = środek linii zasuw; `landY` — wysokość odniesienia lądowania do doboru kąta wyrzutu
  const spout = Object.freeze({
    x: spoutPos[0], y: spoutPos[1], z: spoutPos[2], mouthR: 12,
    target: Object.freeze({ x: 60, z: gateZ }), landY: -40, swingPeriod: 7.3
  });

  // --- taśma: zbiorcza pod zasuwami (ku −x), przesyp, pochyła do galerii pieca (ku −z, w górę)
  const beltY = floorGate - 30;                // −180: powierzchnia taśmy zbiorczej (dno −150, płyta, ziarna na taśmie)
  const beltPts = [
    [gx1 + gateHalf + 18, beltY, gateZ],       // 0 początek (18 j. za ostatnią zasuwą)
    [-560, beltY, gateZ],                      // 1 przesyp na taśmę pochyłą
    [-560, 300, Z0 + 3610]                     // 2 galeria pieca (koniec elementu)
  ];
  const len0 = beltPts[0][0] - beltPts[1][0];
  const runZ = beltPts[1][2] - beltPts[2][2];
  const rise = beltPts[2][1] - beltPts[1][1];
  const len1 = Math.sqrt(runZ * runZ + rise * rise);
  const sFloor = len0 + len1 * ((floorEdge - beltY) / rise);       // tu taśma pochyła wychodzi nad dno zasieku
  const sWall = len0 + len1 * ((beltPts[1][2] - bz0) / runZ);      // tu mija mur od części gorącej
  const belt = Object.freeze({
    pts: Object.freeze(beltPts.map((p) => Object.freeze(p))), len0, len1, length: len0 + len1,
    width: 60, cell: a, slots: 30,
    gateS: Object.freeze(gateXs.map((x) => beltPts[0][0] - x)),
    incline: Math.atan2(rise, runZ),
    // odcinki do rysunku: tunel pod kopcem, koryto pod kratą (widać taśmę z góry), przesyp, pochylnia pod dnem,
    // pochylnia odkryta (w zasieku), pomost nad murem do galerii
    sections: Object.freeze([
      Object.freeze({ name: 'tunel', s0: 0, s1: len0 - 270, visible: false }),
      Object.freeze({ name: 'koryto', s0: len0 - 270, s1: len0, visible: true }),
      Object.freeze({ name: 'pochylnia-pod-dnem', s0: len0, s1: sFloor, visible: false }),
      Object.freeze({ name: 'pochylnia', s0: sFloor, s1: sWall, visible: true }),
      Object.freeze({ name: 'pomost', s0: sWall, s1: len0 + len1, visible: true })
    ])
  });
  const furnace = Object.freeze({ gallery: Object.freeze(beltPts[2].slice()) });

  /**
   * Punkty rury dla bieżącego położenia ssawy: `pts` (9 × xyz) od wylotu do gardzieli, `cum` — droga od wylotu do
   * punktu k (długość całej rury = `cum[8]`). Położenie ssawy w `inp`: [x wózka (oś dzwonu), wysokość krawędzi
   * dzwonu, z suwnicy] — przez tablicę, bo argumenty ułamkowe w wywołaniu alokują.
   */
  function pipePath(inp, pts, cum) {
    const bxp = inp[0];
    const gz = inp[2];
    for (let k = 0; k < 5; k++) { const p = pipeFixed[k]; pts[k * 3] = p[0]; pts[k * 3 + 1] = p[1]; pts[k * 3 + 2] = p[2]; }
    pts[15] = gantry.x; pts[16] = pipe.pierY; pts[17] = gz;                      // 5 pod nogą suwnicy
    pts[18] = gantry.x; pts[19] = gantry.boomY; pts[20] = gz;                    // 6 szczyt nogi
    pts[21] = bxp; pts[22] = gantry.boomY; pts[23] = gz;                         // 7 wózek
    pts[24] = bxp; pts[25] = inp[1] + bell.throatH; pts[26] = gz;                // 8 gardziel
    cum[0] = 0;
    for (let k = 1; k < PIPE_POINTS; k++) {
      const dx = pts[k * 3] - pts[k * 3 - 3];
      const dy = pts[k * 3 + 1] - pts[k * 3 - 2];
      const dz = pts[k * 3 + 2] - pts[k * 3 - 1];
      cum[k] = cum[k - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }

  return Object.freeze({
    frame: 'x od osi toru, z w układzie dzielnicy huty, y = wysokość K-7 (nieściśnięta)',
    Z0, quayZ, berthZ, ship, hold, pier, gantry, trolley, bell, pipe, pipePath, blower, spout, bunker, gates, belt, furnace
  });
}
