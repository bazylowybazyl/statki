// HUTA — element 3 (formowanie polem i walcowanie): GEOMETRIA ZŁOŻENIA (czyste liczby, bez three i DOM).
//
// Runda 6 („złóż wszystko”): komora wytopu stoi NAD pokładem hali jako NACZYNIE-LEJEK — jego wnętrze to komora z
// `../wytop/` bez zmian (te same współrzędne: początek w środku pola, y w górę, x i z w planie; z = +y gry, w dół
// ekranu). `KOMORA.deckY` (400) to płaszczyzna gry = wierzch naczynia (kołnierz). Pokład HALI leży na `HALA.deckY`
// (−1300, 1 700 j. pod płaszczyzną), oś pasma na `HALA.passY` (−1060). Nad płaszczyzną wystaje tylko kołnierz z lampami
// (≤ +20 j.; w grze nad płaszczyzną wysokość × 0,42).
//
// WYLOT BOKIEM (etap „Kropla”, decyzja użytkownika 2026-11-17: „Tak, wylot bokiem”): kamera gry patrzy pionowo z góry,
// a naczynie zasłania wszystko pod swoim obrysem — dlatego RURA SPUSTOWA (`SPUST`) z gardzieli skręca kolanem pod
// stożkiem w poziom, wychodzi POZA obrys naczynia i kończy się WYLEWKĄ z zaworem (6 klap) nad pokładem hali. Metal leje
// się z wylewki łukiem (prowadzony polem — pierścienie przy wylewce i rękaw pola) z góry do BŁONY POLA (`BLONA`):
// elastycznego worka obok naczynia, który pole ŚCISKA od strony naczynia (prasa pola), a metal wychodzi WYCISKANY przez
// gardziel formującą G0 po stronie taśmy (+x) → bramy G1–G4 → stygnięcie → klatki F1–F3 → DZIELENIE (runda 8: nóż polowy,
// gniazda arkuszy, odbiór paczek — `../dzielenie/`; plan sytuacyjny `LINIA`; na taśmie droga s = x). Linia przesunięta o `LINIA_DX` w +x względem etapu „Pasmo” (łuk gięcia
// i zasobnik pod naczyniem zniknęły, błona leży poza obrysem).
import { KOMORA, filletPath, funnelRadiusAt, pathSample } from '../wytop/geometria.js';

const DEG = Math.PI / 180;

/** Poziomy i pokład hali. `deck` — prostokąt płyt hali [x, z], `thick` — grubość płyt, `plate` — siatka szwów płyt. */
export const HALA = Object.freeze({
  planeY: KOMORA.deckY,
  deckY: KOMORA.hallY,
  passY: -1060,
  // (etap „Kropla”: pokład wydłużony o `LINIA_DX` w +x — linia przesunięta razem z błoną poza obrys naczynia;
  // runda 8, „Dzielenie”: pokład do x 4760 — nóż, rynna, gniazda A / B, odbiór i ściana czołowa z bramami WYJAZD)
  deck: Object.freeze({ x0: -1500, x1: 4760, z0: -1250, z1: 1150, thick: 40, plate: 200 })
});

/**
 * NACZYNIE-LEJEK: zewnętrzna bryła obrotowa komory. `profile` — [r, y, promień zaokrąglenia naroża] od zewnętrznej
 * krawędzi kołnierza w dół do wargi dyszy i z powrotem w górę do rury gardzieli (`KOMORA.funnel`: r 70 → 65 na
 * −680…−770); `segs` — segmentów na obwód (te same azymuty co krawędź pomostu: `KOMORA.deck.flangeSegs`).
 *   flange   kołnierz (pierścień od studni do `rOut` na `y0…y1`) — niesie krawężnik i lampy obrzeża z zestawu,
 *            obudowy generatorów pola 0 g (`gens` — azymuty [°], promień `genR`; bez zatoki taśmy 135–180°)
 *   ring     pierścień nośny (dźwigar skrzynkowy `r0…r1` na `y` ± `h/2`) z żebrami do płaszcza co `ribDeg`
 *   legs     4 nogi z pierścienia do pokładu hali: azymuty [°], głowica na `rHead` (pod pierścieniem), stopa na `rFoot`,
 *            przekrój `w0` → `w1`, płyta stopy `foot`; zastrzały (X) tylko między nogami `braces` (strefa 310…50° przez
 *            0° wolna dla strugi, zasobnika i linii)
 *   bands    pierścienie usztywniające płaszcz (wysokości)
 *   bayBox   skrzynia zatoki taśmy pod pomostem (dno `floorY` − `thick`, ściany do spodu pomostu)
 * (Zawór z klapami siedzi od etapu „Kropla” na wylewce rury spustowej — `SPUST.klapy`.)
 */
export const NACZYNIE = Object.freeze({
  profile: Object.freeze([
    Object.freeze([640, 400, 0]), Object.freeze([640, 354, 0]), Object.freeze([575, 354, 0]),
    Object.freeze([575, -360, 90]), Object.freeze([115, -712, 26]), Object.freeze([115, -776, 5]),
    Object.freeze([96, -787, 4]), Object.freeze([62, -790, 0]), Object.freeze([65, -770, 0])
  ]),
  segs: KOMORA.deck.flangeSegs,
  flange: Object.freeze({ rOut: 640, y0: 354, y1: 400, genR: 606, gens: Object.freeze([0, 45, 90, 225, 270, 315]) }),
  ring: Object.freeze({ y: -360, h: 80, r0: 590, r1: 650, ribDeg: 22.5 }),
  legs: Object.freeze({
    az: Object.freeze([50, 130, 230, 310]), rHead: 620, rFoot: 780, w0: 70, w1: 110, foot: 160,
    braces: Object.freeze([Object.freeze([130, 230]), Object.freeze([230, 310])])
  }),
  bands: Object.freeze([150, -120]),
  bayBox: Object.freeze({ floorY: -50, thick: 10 })
});

/** Słupy pomostu górnego do pokładu hali [x, z] i ich przekrój. */
export const POMOST = Object.freeze({
  cols: Object.freeze([Object.freeze([-700, -800]), Object.freeze([-700, 800]), Object.freeze([-1400, -800]), Object.freeze([-1400, 800])]),
  colW: 64,
  girder: 36
});

/**
 * DOK ŻUŻLA: granulat z odbieralnika komory idzie kanałem przez ścianę (azymut `az`, wysokość `exitY`) rurą
 * pneumatyczną po płaszczu (`r1` — pion poza nośną) do skrzyni na pokładzie hali (środek na promieniu `r` — dalej
 * niż w PROJEKCIE (950), bo skrzynia wchodziła na stopę nogi 50°; długość
 * wzdłuż promienia `len`, w poprzek `wid`, wysokość `h`). Własna płyta grawitacji (bursztynowe lampki jak koryto);
 * granulat ubywa wylotem w dnie do sieci ringu (`drain` t/s), pojemność `cap` t, rura niesie `pipeRate` t/s.
 */
export const DOK_ZUZLA = Object.freeze({
  az: 37.5, exitY: 190, r1: 760, r: 1020, len: 240, wid: 180, h: 120, pipeR: 15, cap: 72, drain: 0.7, pipeRate: 8
});

/** Przesunięcie linii (bramy, chłodnice, klatki) w +x względem etapu „Pasmo”. */
export const LINIA_DX = 480;

/**
 * LINIA — plan sytuacyjny formowania i walcowania. Oś pasma na z = 0, y = `HALA.passY`. Wszystko [j.], t — grubość.
 *   nozzleY             warga dyszy naczynia (dalej kolano rury spustowej — `SPUST`)
 *   gates               bramy pola: G0 — GARDZIEL FORMUJĄCA błony (wylot, okrągły pierścień) i G1–G4 (spłaszczanie) —
 *                       x, półszerokość pasma `a`
 *   cushion             poduszka pola pod pasmem [x0, x1]
 *   chill               chłodnice: C1, C2 (panele po bokach ±170…±330 i pod spodem), C3 (noże gazowe)
 *   stands              klatki walcownicze F1–F3: x, promień walca R, grubość na wyjściu t; korpusy na |z| `body`;
 *                       doły zgorzeliny pod walcami (`pit` — połowa wymiaru w x i z, głębokość)
 *   stripEndX           koniec drogi pasma za nożem dzielenia (runda 8: brama „DO ZWIJARKI” i tunel usunięte; pasmo
 *                       rozdziela nóż na x `XB` z `../dzielenie/geometria.js`, najdalsze czoło przed cięciem 4227)
 *   corridor            korytarz linii |z| < … dla x > `corridorX` do `corridorX1` (nogi, rury, dok poza nim) — od
 *                       wylewki w +x do noża (dalej gniazda dzielenia)
 * Wszystkie x za G0 = x z etapu „Pasmo” + `LINIA_DX` (fizyka taśmy za wylotem bez zmian).
 */
const DX = LINIA_DX;
export const LINIA = Object.freeze({
  w: 200, t0: 30, sched: Object.freeze([30, 20, 13, 9]),
  nozzleY: -790,
  gates: Object.freeze([
    Object.freeze({ id: 'G0', x: 1020 + DX, a: 43.7, r: 95 }),
    Object.freeze({ id: 'G1', x: 1100 + DX, a: 62 }), Object.freeze({ id: 'G2', x: 1180 + DX, a: 80 }),
    Object.freeze({ id: 'G3', x: 1260 + DX, a: 93 }), Object.freeze({ id: 'G4', x: 1340 + DX, a: 100 })
  ]),
  // (etap „Walcowanie”: klatki co 300 j. na walcach R 70 — między klatkami z kamery gry widać taśmę i pętle (przy 230 j.
  // i R 80 walce zakrywały prawie całe przęsła); poduszka za F3 i noże C3 zaczynają się za szyjkami dolnego walca F3,
  // chłodnica C2 kończy się przed stojakami F1)
  cushion: Object.freeze([Object.freeze([1340 + DX, 1900 + DX]), Object.freeze([2620 + DX, 2900 + DX])]),
  chill: Object.freeze({ C1: Object.freeze([1100 + DX, 1760 + DX]), C2: Object.freeze([1760 + DX, 1850 + DX]), C3: Object.freeze([2620 + DX, 2860 + DX]), side0: 170, side1: 330 }),
  stands: Object.freeze([
    Object.freeze({ id: 'F1', x: 1960 + DX, R: 70, t: 20 }), Object.freeze({ id: 'F2', x: 2260 + DX, R: 70, t: 13 }),
    Object.freeze({ id: 'F3', x: 2560 + DX, R: 70, t: 9 })
  ]),
  body: Object.freeze([200, 260]),
  pit: Object.freeze({ hx: 70, hz: 190, depth: 60 }),
  stripEndX: 4300,
  corridor: 300, corridorX: 700, corridorX1: 3400
});

/** Droga taśmy: s = x + `xOff` (od etapu „Kropla” xOff = 0 — taśma liczy drogę w x). */
export const PATH = Object.freeze({ xOff: 0 });

const DEG_TILT = 3 * DEG;
/**
 * RURA SPUSTOWA I WYLEWKA (wylot bokiem). Droga metalu `s` od wargi dyszy: kolano R `elbowR` z pionu w poziom pod
 * stożkiem, rura pozioma na `y` do `xBend`, łagodny łuk wylewki (R `spoutBendR`) w dół o `tilt`, krótka dysza wylewki
 * do WARGI (`lip`) z ZAWOREM 6 klap. Za wargą struga leci ŁUKIEM (prowadzi ją pole: kołnierz pola na wardze, pierścienie
 * `rings` [j. drogi za wargą] i rękaw pola) do wlotu błony od góry: w nieważkości leci najpierw prawie poziomo (pęd z
 * wylewki), a pole błony chwyta ją i ściąga w dół — krzywa y = y_wargi − tg(tilt)·X − k·X³ od kierunku wylewki do
 * punktu `inlet` (środek błony; struga wchodzi w błonę z góry, końcowe nachylenie ok. 65°). `r` — przekrój przepływu rury
 * (pełna rura), `rOut` — płaszcz.
 *   klapy    ZAWÓR WYLEWKI (dawny zawór dyszy, przeniesiony na wylewkę — widać go z kamery gry): `n` klap trójkątnych
 *            przy wardze (otwór `rAp`) tworzy sześciokąt o apotemie `apo` w płaszczyźnie wargi; klapa obraca się wokół
 *            swojego boku (zawias przy wardze) o kąt `open` [rad] z biegiem strugi; zestaw obrócony o `rot` [rad] —
 *            nad strugą jest szczelina między klapami, nie klapa
 *   cols     słupy podpór rury (x) z pokładu hali
 */
export const SPUST = Object.freeze((() => {
  const y = -882;
  const elbowR = 90;
  const xBend = 745;
  const spoutBendR = 200;
  const lipLen = 41;
  const d = [Math.cos(DEG_TILT), -Math.sin(DEG_TILT)];
  const lip = [xBend + d[0] * lipLen, y + d[1] * lipLen];
  const inlet = [1200, -1115];
  return {
    r: 66, rOut: 84, y0: -792, y, elbowR, xBend, spoutBendR, tilt: DEG_TILT, lipLen,
    lip: Object.freeze(lip), dir: Object.freeze(d), inlet: Object.freeze(inlet),
    lipR: 92,
    rings: Object.freeze([22, 66]), ringR: Object.freeze([88, 82]),
    // pierścienie pola NA ŁUKU strugi (poprawki rundy 6): `off` — droga za wargą [j.], `R` — promień, `lean` — pochylenie
    // płaszczyzny ku poziomowi (normalna = styczna strugi + lean · dół): z góry elipsa wokół strugi, nie kreska
    arcRings: Object.freeze([Object.freeze({ off: 160, R: 72, lean: 0.8 }), Object.freeze({ off: 228, R: 64, lean: 0.8 })]),
    cols: Object.freeze([300, 560]),
    klapy: Object.freeze({ n: 6, rAp: 62, apo: 64, thick: 1.4, open: 1.62, rot: 30 * DEG, off: 1.5 })
  };
})());

/**
 * Tablice drogi metalu (krok 1 j.): x, y, styczna — od wargi dyszy (s = 0) przez kolano, rurę i wylewkę (`sLip` —
 * warga wylewki) po łuku strugi do `sEnd` (środek błony pod wlotem). Liczone raz przy ładowaniu modułu.
 */
export const DROGA = Object.freeze((() => {
  const S = SPUST;
  const pipe = filletPath([[0, S.y0, 0], [0, S.y, 0], [S.xBend, S.y, 0], [S.lip[0], S.lip[1], 0]], [0, S.elbowR, S.spoutBendR, 0]);
  // łuk strugi: styczna wylewki na wardze, koniec w punkcie wlotu (pole błony chwyta strugę i ściąga ją w dół)
  const X = S.inlet[0] - S.lip[0];
  const t0 = Math.tan(S.tilt);
  const k = (S.lip[1] - S.inlet[1] - t0 * X) / (X * X * X);
  const fine = [];
  {
    let sAcc = pipe.len;
    let px = S.lip[0];
    let py = S.lip[1];
    for (let x = 0.2; x <= X + 1e-9; x += 0.2) {
      const xx = S.lip[0] + x;
      const yy = S.lip[1] - t0 * x - k * x * x * x;
      sAcc += Math.hypot(xx - px, yy - py);
      fine.push([sAcc, xx, yy, x]);
      px = xx; py = yy;
    }
  }
  const sLip = pipe.len;
  const sEnd = fine[fine.length - 1][0];
  const n = Math.ceil(sEnd) + 2;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const q = new Float64Array(6);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(i, sEnd);
    if (s <= sLip) {
      pathSample(pipe, s, q);
      xs[i] = q[0]; ys[i] = q[1]; tx[i] = q[3]; ty[i] = q[4];
    } else {
      while (j < fine.length - 1 && fine[j][0] < s) j++;
      const a = j > 0 ? fine[j - 1] : [sLip, S.lip[0], S.lip[1], 0];
      const b = fine[j];
      const f = b[0] > a[0] ? (s - a[0]) / (b[0] - a[0]) : 0;
      const xr = a[3] + (b[3] - a[3]) * f;
      xs[i] = S.lip[0] + xr;
      ys[i] = S.lip[1] - t0 * xr - k * xr * xr * xr;
      const slope = -(t0 + 3 * k * xr * xr);
      const l = Math.hypot(1, slope);
      tx[i] = 1 / l; ty[i] = slope / l;
    }
  }
  return { n, sLip, sEnd, pipeLen: pipe.len, x: xs, y: ys, tx, ty, k, X, t0, endAngle: Math.atan(t0 + 3 * k * X * X), pipe };
})());

/** Punkt drogi metalu (rura → wylewka → struga) na długości s: zapis do `out` = [x, y, z, tx, ty, tz]. */
export function spustPoint(s, out = new Float64Array(6)) {
  const D = DROGA;
  const c = s < 0 ? 0 : s > D.n - 1.001 ? D.n - 1.001 : s;
  const i = c | 0;
  const f = c - i;
  out[0] = D.x[i] + (D.x[i + 1] - D.x[i]) * f;
  out[1] = D.y[i] + (D.y[i + 1] - D.y[i]) * f;
  out[2] = 0;
  const tx = D.tx[i] + (D.tx[i + 1] - D.tx[i]) * f;
  const ty = D.ty[i] + (D.ty[i + 1] - D.ty[i]) * f;
  const l = Math.sqrt(tx * tx + ty * ty) || 1;
  out[3] = tx / l; out[4] = ty / l; out[5] = 0;
  return out;
}

/**
 * Rama pierścienia pola na łuku strugi `k` (`SPUST.arcRings`): środek na osi strugi, normalna płaszczyzny n (styczna +
 * lean · dół), oś p w płaszczyźnie x-y (p ⟂ n) i oś z. Zapis do `out` = [cx, cy, nx, ny, px, py].
 */
export function arcRingFrame(k, out = new Float64Array(6)) {
  const A = SPUST.arcRings[k];
  const q = spustPoint(DROGA.sLip + A.off);
  let nx = q[3];
  let ny = q[4] - A.lean;
  const l = Math.sqrt(nx * nx + ny * ny);
  nx /= l; ny /= l;
  out[0] = q[0]; out[1] = q[1]; out[2] = nx; out[3] = ny; out[4] = -ny; out[5] = nx;
  return out;
}

/** Rama zaworu wylewki: środek `c`, kierunek strugi `d`, osie płaszczyzny klap `e1`, `e2` (e1 × e2 = d). */
export const ZAWOR = Object.freeze((() => {
  const K = SPUST.klapy;
  const d = [SPUST.dir[0], SPUST.dir[1], 0];
  const c = [SPUST.lip[0] + d[0] * K.off, SPUST.lip[1] + d[1] * K.off, 0];
  const a = [-d[1], d[0], 0];            // „w górę” w płaszczyźnie wargi
  const b = [0, 0, 1];
  const cr = Math.cos(K.rot);
  const sr = Math.sin(K.rot);
  const e1 = [a[0] * cr + b[0] * sr, a[1] * cr + b[1] * sr, a[2] * cr + b[2] * sr];
  const e2 = [-a[0] * sr + b[0] * cr, -a[1] * sr + b[1] * cr, -a[2] * sr + b[2] * cr];
  return { c: Object.freeze(c), d: Object.freeze(d), e1: Object.freeze(e1), e2: Object.freeze(e2) };
})());

/**
 * BŁONA POLA („gumowa rękawiczka”, słowa użytkownika: „jakbyś miał gumową rękawiczkę, do której wlałeś ten płyn.
 * Ściskasz rękawiczkę z lewej, żeby płyn wyszedł z prawej”; po rundzie 6: „ten tył musi przechodzić do przodu, jakbyś
 * wyciskał coś (…) polem wyciskamy lawę”). RĘKAW POLA o stałym miejscu obok naczynia, poza jego obrysem: od tylnego
 * kołnierza `x0` (strona naczynia) do GARDZIELI FORMUJĄCEJ G0 (`xG0`, strona taśmy). Metal w rękawie liczy się w `n`
 * komórkach (moduł `blona.js`, symulacja `linia.js`); ZACISK POLA — wędrująca przewężka (rampa `wp` j.) — powstaje na
 * tyle i jedzie ku gardzieli, wyciskając metal przed sobą; za nim rękaw jest zapadnięty (płaski, pusty). Przekrój
 * brzucha: nadelipsa n 2,5, półwysokość = `aspect` · półszerokość; szyja od `xN` do G0 — lejek pola (konstrykcja do
 * `cEnd`, przekrój do okręgu r G0, oś wznosi się z `yc` do osi pasma `yT`).
 *   Aref, pExp   przekrój brzucha przy ciśnieniu nominalnym; przekrój trzymany zaciskiem ∝ (Q / Q_nom)^pExp
 *   cw, gamma    fala w rękawie przy Aref [j./s], tłumienie prędkości [1/s]; rMax — granica rozciągnięcia w ciśnieniu
 *   wp, xpMax    rampa zacisku [j.], najdalsze położenie zacisku (przed szyją); uFwd / uBack — posuw / cofanie [j./s],
 *                uOpen — otwieranie przed zrzutem, kU — wzmocnienie posuwu, hold — bramka trzyma, dopóki (a / A_ref)²
 *                brzucha nie przekroczy celu o ten udział, tauU — bezwładność bramki [s], landMargin —
 *                zacisk co najmniej tyle za miejscem wpadania strugi; cMin — rampa < cMin: komórka zamknięta
 *   collW, collH zapadnięty rękaw: półszerokość (× półszerokość przy Aref) i półgrubość [j.]; waist — przewężenie powłoki
 *                pola na zacisku (udział)
 *   bed          łoże pola pod błoną: poprzeczki z emiterami (x) — trzymają błonę od dołu
 */
export const BLONA = Object.freeze({
  xG0: LINIA.gates[0].x, yc: -1115, yT: HALA.passY,
  x0: 820, xN: 1300, n: 56,
  Vpk: 230, Aref: 80000, pExp: 0.45, cEnd: 0.075,
  aspect: 0.32, rNeck: LINIA.gates[0].a,
  cw: 260, gamma: 1.5, rMax: 8,
  wp: 110, xpMax: 1250, uFwd: 60, uBack: 220, uOpen: 170, kU: 300, hold: 0.12, tauU: 0.3, landMargin: 85, cMin: 0.04,
  collW: 0.62, collH: 4, waist: 0.3,
  inletX: SPUST.inlet[0],
  bed: Object.freeze([1000, 1180, 1360])
});

/**
 * ZACISK POLA — osprzęt (makieta brył; wygląd w turze „materiały strefy huty”): grzebień BRAMEK wzdłuż rękawa, jak stojan
 * silnika liniowego. Każda bramka to cienka rama U: dwie płetwy-emitery po bokach (|z| `zR`, od progu `sillY` do `finTop`,
 * lico emitera ku błonie, listwa na wierzchu — z góry kreska) i żebro pod błoną (`ribY`, listwa u góry). Bramki co
 * `pitch` j. od `x0` do `x1`, na dwóch podłużnych progach z podporami do pokładu hali. Świeci bramka tam, gdzie akurat
 * jest zacisk (siła i położenie z symulacji — shader otoczenia), przed zaciskiem słabo (trzymają brzuch), za nim ledwie.
 */
export const ZACISK = Object.freeze({
  // (płetwy kończą się tuż pod równikiem brzucha `yc` — z boku zasłaniają tylko dolną część błony)
  zR: 400, x0: 806, x1: 1300, pitch: 38, sillY: -1266, finTop: -1128, ribY: -1266, finW: 4, finL: 9, glowW: 28
});

/** Promień zewnętrzny naczynia na wysokości y (profil bez zaokrągleń; 0 — poza naczyniem). */
export function vesselRadiusAt(y) {
  const P = NACZYNIE.profile;
  if (y > P[0][1] || y < P[7][1]) return 0;
  if (y >= P[1][1]) return P[0][0];
  if (y >= P[3][1]) return P[2][0];
  for (let i = 3; i < 7; i++) {
    const a = P[i];
    const b = P[i + 1];
    if (y <= a[1] && y >= b[1]) return a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1]));
  }
  return 0;
}

/** Punkt osi nogi `k` na wysokości y (głowica pod pierścieniem nośnym → stopa na pokładzie hali): [x, z, r]. */
export function legAt(k, y) {
  const L = NACZYNIE.legs;
  const yH = NACZYNIE.ring.y - NACZYNIE.ring.h / 2;
  const f = (yH - y) / (yH - HALA.deckY);
  const r = L.rHead + (L.rFoot - L.rHead) * f;
  const a = L.az[k] * DEG;
  return [Math.cos(a) * r, Math.sin(a) * r, r];
}

/** Środek doku żużla [x, z] i kierunek promienia [cx, sz]. */
export function slagDockFrame() {
  const a = DOK_ZUZLA.az * DEG;
  return { x: Math.cos(a) * DOK_ZUZLA.r, z: Math.sin(a) * DOK_ZUZLA.r, c: Math.cos(a), s: Math.sin(a) };
}

/**
 * Wnętrze komory: promień największy na wysokości y (do testu odstępu płaszcza) — lej, ściana studni, a pod obrzeżem
 * szczelina pierścienia odciągu (wnęka za licem).
 */
export function chamberInnerRadiusAt(y) {
  if (y <= KOMORA.funnel.rimY) return Math.max(KOMORA.funnel.throatR, funnelRadiusAt(y));
  const G = KOMORA.gaz.ring;
  if (y >= G.y0 - G.lipH - 1 && y <= G.y1 + G.lipH + 1) return KOMORA.pitR + G.depth;
  return KOMORA.pitR;
}

/**
 * WIDOKI (`top` w układzie płaszczyzny gry: [x0, z0, x1, z1]; kino: punkt `at` [x, y, z], `az` — skąd patrzy kamera
 * (od +x ku +z), `el` — nad poziomem, `dist`). Widok 1 = kamera gry nad naczyniem i linią.
 */
export const WIDOKI = Object.freeze({
  // (etap „Kropla”: kadr gry od kołnierza naczynia; runda 8: do ściany czołowej hali z bramami WYJAZD — x1 3000 → 4040;
  // przy 32:9 kadr ogranicza wysokość, więc piec się nie zmienia, przy 16:9 maleje o 22 % — PROJEKT-dzielenie § 2.4)
  top1: Object.freeze([-680, -1135, 4040, 935]),
  /** kadr widoku 1 sprzed rundy 8 (pary kontrolne) */
  top1R7: Object.freeze([-680, -1135, 3000, 935]),
  /** dawny kadr widoku 1 (pary kontrolne wnętrza komory) */
  top1Old: Object.freeze([-1071, -650, 1240, 650]),
  /** z góry blisko: wylewka, struga, błona, prasa, gardziel G0 (kamera gry przybliżona) */
  topKropla: Object.freeze([560, -600, 1880, 143]),
  w7: Object.freeze({ at: Object.freeze([1080, -1240, -800]), az: -0.7, el: 0.55, dist: 900 }),
  // „Wylewka i błona”: z ukosa od −z i +x (między nogą 310° a zbiornikami) — rura spod naczynia, wylewka, struga w polu,
  // błona, prasa, gardziel G0
  w8: Object.freeze({ at: Object.freeze([1110, -1010, 0]), az: -1.18, el: 0.26, dist: 1700 }),
  // „Walcowanie”: od strony obsługi (+z; napęd z wrzecionami stoi po stronie −z), klatki F1–F3 i brama
  // (poprawki rundy 6: wyżej, z góry w przęsła między stojakami — widać łuk styku, różnicę grubości przed i za klatką,
  // zgorzelinę przy chwycie; dawny kadr niski zasłaniały stojaki)
  w9: Object.freeze({ at: Object.freeze([2200 + DX, -1060, 0]), az: 1.3, el: 0.95, dist: 1180 }),
  // (runda 8: hala do x 4760 — środek i odległość, żeby z boku zmieściła się cała linia z dzieleniem)
  w0: Object.freeze({ at: Object.freeze([1630, -520, 0]), az: -Math.PI / 2, el: 0.12, dist: 6300 }),
  /** z ukosa z dołu (z pokładu hali w górę na naczynie) i z góry */
  dol: Object.freeze({ at: Object.freeze([500, -560, 0]), az: -0.55, el: -0.3, dist: 2400 }),
  gora: Object.freeze({ at: Object.freeze([1000, -600, 0]), az: -0.9, el: 0.75, dist: 4000 }),
  /** doprowadzenie rudy: zatoka taśmy w pomoście, taśma do naczynia */
  ruda: Object.freeze({ at: Object.freeze([-700, 40, 230]), az: 2.75, el: 0.9, dist: 1150 }),
  /** wylewka z zaworem i pierścieniami pola z bliska (z boku, lekko z dołu) */
  dysza: Object.freeze({ at: Object.freeze([830, -910, 0]), az: -1.25, el: -0.05, dist: 560 }),
  /** błona z boku (prasa, wybrzuszenie, gardziel) i z ukosa z góry */
  blonaBok: Object.freeze({ at: Object.freeze([1170, -1080, 0]), az: -Math.PI / 2, el: 0.04, dist: 1350 }),
  blonaUkos: Object.freeze({ at: Object.freeze([1150, -1060, 0]), az: -0.75, el: 0.62, dist: 1300 }),
  // chwyt F1 z bliska: od strony obsługi i od wejścia (taśma wchodzi między walce)
  chwyt: Object.freeze({ at: Object.freeze([1935 + DX, -1060, 0]), az: 2.45, el: 0.2, dist: 330 }),
  /** walcownia z boku (od strony obsługi): pętle między klatkami, walce, pętlowniki */
  walcBok: Object.freeze({ at: Object.freeze([2260 + DX, -1080, 0]), az: Math.PI / 2, el: 0.2, dist: 1300 }),
  /** (dawniej brama „DO ZWIJARKI”) koniec walcowni i nóż z ukosa */
  brama: Object.freeze({ at: Object.freeze([2840 + DX, -1060, 0]), az: 0.75, el: 0.42, dist: 900 })
});
