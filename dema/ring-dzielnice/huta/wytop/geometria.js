// HUTA — wytop: GEOMETRIA KOMORY (czyste liczby wspólne dla symulacji, sceny i obrazu; bez three i DOM).
//
// Układ komory: początek = środek pola (tam wisi kupa rudy, potem kula); x i z w planie (x = +X sceny, z = +y gry —
// w dół ekranu), y w górę. Komora jest STUDNIĄ pod pokładem: pokład na y = +400, ściana schodzi do y = −330, niżej
// CAŁE DNO jest lejem (stożek od ściany do gardzieli). Pod pokładem zestaw portowy nie ściska wysokości
// (`k7HeightToZ`: pod płaszczyzną lotu 1:1), więc kula jest kulą. Wysokość K-7 punktu = y − (deckY − 116)
// (pokład = 116), wysokość w scenie = y − deckY.
//
// RUNDA 4 (uwaga użytkownika nr 5 w SPEC): kula o promieniu do 270 j. (wsad 360 t rudy) — średnica kuli ≈ połowa
// średnicy studni. Wszystko, co zależy od promienia kuli, jest przeskalowane: studnia głębsza (kula z czapą żużla i ssawą
// mieści się pod pokładem), segmenty cewek (krzywizna, promienie pierścienia, wysokość osi), ssawa, odbieralnik, taśma
// cofnięta ku ścianie (koniec taśmy ponad 100 j. od największej kuli).
//
// Rozkład w planie (ekran widoku z góry: x w prawo, z w dół; azymut od +x ku +z):
//   • z lewej, dołem — zatoka taśmy; taśma na y = +40 wchodzi w studnię na wysięgniku. Jej prosta z = +260 jest
//     prawie STYCZNA do wiru pola: struga ziaren wchodzi w spiralę łukiem (wir przeciwnie do wskazówek zegara na ekranie);
//   • z prawej — SSAWA żużla (wysięgnik ze ściany na y = 360, wózek, teleskopowa szyja z dzwonem); biegun żużla to
//     GÓRNY biegun kuli (oś obrotu): wirowanie spycha tam lżejszy żużel w jedną czapę. Ssawa zjeżdża z góry nad czapę
//     i ściąga ją lepką nitką; rurociąg żużla idzie po ścianie do ODBIERALNIKA (koryto granulatora, azymut 13–62°);
//   • całe dno — LEJ odbiorczy (zrzut grawitacyjny): stożek od ściany studni do gardzieli prowadzącej do odlewni.
// MASZYNERIA GRZEWCZA (cykl v2): dwa pierścienie cewek pocięte na SEGMENTY — górny (trzy segmenty, okno robocze
// ssawy zostaje wolne) i dolny (cztery segmenty). Klatka cewek jest WSPÓŁŚRODKOWA Z BRYŁĄ: oś każdego segmentu leży
// na promieniu wychodzącym ze środka kupy / kuli pod stałym kątem `mach.lat` nad albo pod równikiem, w odległości
// promień bryły + `gap` + `reach` — odstęp segmentu od powierzchni jest ten sam przy każdym promieniu. Segment ma dwa
// ruchy: poziomy wysięgnik teleskopowy ze ściany (na wysokości ±`padY`) dosuwa go po promieniu, pionowa prowadnica
// na głowicy wysięgnika opuszcza go ku równikowi, gdy bryła jest mniejsza. Odsunięte segmenty stoją pod ścianami
// (`mach.rOut`, wysokość ±`padY`). Pas |y| < 150 przy ścianie wolny — tam płynie struga ziaren.
// SYGNALIZACJA GRAWITACJI = WYŚWIETLACZ (`display`): pas ekranów dookoła studni na środku wysokości ściany, lico
// pochylone ku górze (czytelne z kamery z góry). 0 g: szewrony biegną po obwodzie; zrzut: stają, obracają się grotem
// w dół i płyną w dół. To jedyny sygnał grawitacji w komorze; dawne linie „okien” (`grav.lines`) są nieruchomymi,
// przygaszonymi listwami.
import { createConveyorTrack } from '../../kit/tasmociag.js';

const DEG = Math.PI / 180;
const DECK_Y = 400;
/**
 * RUNDA 6 („złóż wszystko”): komora stoi NAD pokładem hali jako naczynie-lejek. Wnętrze komory bez zmian (te same
 * współrzędne), `deckY` znaczy odtąd „płaszczyzna gry = wierzch naczynia”. Pokład HALI leży `HALL_Y` (1 700 j. pod
 * płaszczyzną gry); z dawnego pokładu przy płaszczyźnie został POMOST GÓRNY (`deck`, x ≤ −420: zatoka taśmy, radiatory,
 * kabina, szafy cewek) na słupach do pokładu hali. Bryły hali i naczynia: `dema/ring-dzielnice/huta/formowanie/`.
 */
const HALL_Y = -1300;

export const KOMORA = Object.freeze({
  pitR: 520,
  sides: 32,                      // studnia jest 32-kątem (wierzchołki na promieniu `pitR`)
  deckY: DECK_Y,
  /** pokład hali (formowanie i walcowanie) — wierzch płyt */
  hallY: HALL_Y,
  floorY: -330,                   // dół ściany studni = obrzeże leja (płaskiej posadzki nie ma)
  /** wysokość K-7 punktu komory (zestaw portowy) i wysokość w scenie (pod płaszczyzną gry 1:1) */
  k7: (y) => y - (DECK_Y - 116),
  /**
   * POMOST GÓRNY na poziomie płaszczyzny: prostokąt bez kołnierza naczynia (`flangeR`, wielokąt `flangeSegs` — te same
   * wierzchołki co krawędź kołnierza, bez szpary) i bez zatoki taśmy
   */
  deck: Object.freeze({ x0: -1500, x1: -420, z0: -900, z1: 900, flangeR: 640, flangeSegs: 128 }),
  /**
   * zatoka taśmy: wykop w pokładzie do studni; boki na wierzchołkach 32-kąta studni (135° i 168,75°), dno 450 j.
   * pod pokładem. `sides` — boki 32-kąta otwarte na zatokę (od `floorY` w górę)
   */
  bay: Object.freeze({
    x0: -1500, z0: 520 * Math.sin(168.75 * DEG), z1: 520 * Math.sin(135 * DEG),
    xa: 520 * Math.cos(168.75 * DEG), xb: 520 * Math.cos(135 * DEG), floorY: -50, sides: Object.freeze([12, 13, 14])
  }),
  /**
   * Maszyneria grzewcza: segmenty cewek na wysięgnikach. `lat` — szerokość kątowa osi segmentów względem środka
   * bryły [°] (35,26° = węzeł osiowego modu spłaszczenia kuli: tam powierzchnia chodzi najmniej), `padY` — wysokość
   * wysięgników (górne +, dolne −) = wysokość osi segmentu przy największej kuli i przy odsunięciu; mniejsza bryła —
   * segment zjeżdża prowadnicą ku równikowi, `rOut` — promień pierścienia przy odsunięciu, `rMin` — najmniejszy,
   * `arcR` — promień krzywizny segmentu, `arcHalf` — połowa kąta łuku [°], `gap` — odstęp najbliższego elementu
   * segmentu od powierzchni bryły, `reach` — o ile ten element (króciec chłodzenia) wystaje ku bryle przed oś segmentu
   * (wzdłuż promienia ze środka bryły), `profile` — punkty najbliższych bryle elementów w przekroju segmentu
   * [ku osi komory, ku równikowi] od osi segmentu (króćce, obejmy, zwoje), `upper` / `lower` — azymuty wysięgników
   * [°]; `thick` — skala przekroju zwojów i osprzętu segmentu (większa kula → grubsza cewka), `slide` — zapas
   * prowadnicy pionowej ponad największy zjazd [j.].
   */
  mach: Object.freeze({
    lat: 35.26, padY: 194, rOut: 380, rMin: 105, arcR: 300, arcHalf: 28, gap: 40, reach: 25, thick: 1.3, slide: 16,
    profile: Object.freeze([
      Object.freeze([20.3, 13.8]), Object.freeze([20.3, -13.8]), Object.freeze([6.5, 24.8]), Object.freeze([6.5, -24.8]),
      Object.freeze([6.8, 12.4]), Object.freeze([6.8, -12.4]), Object.freeze([0, 19.2]), Object.freeze([0, -19.2])
    ]),
    upper: Object.freeze([100, 190, 280]), lower: Object.freeze([10, 100, 190, 280])
  }),
  coilTube: 17,
  /**
   * LEJ = CAŁE DNO studni (zrzut grawitacyjny): stożek od ściany (`rimR` na wysokości `rimY`) do gardzieli (`throatR`
   * na `throatY`), niżej rura do odlewni (`pipeY` — dno widocznej części). Nachylenie 37,9° do poziomu; objętość
   * pod obrzeżem ≈ 2 × objętość gotowej kuli.
   */
  funnel: Object.freeze({ rimR: 520, rimY: -330, throatR: 70, throatY: -680, pipeY: -770 }),
  /**
   * WYŚWIETLACZ GRAWITACJI: pas ekranów dookoła studni. Lico od (`rOut`, `y + half`) przy ścianie do (`rIn`,
   * `y − half`) — pochylone ku górze (37,7° od pionu). `cells` — szewronów na pełny obwód (jedna komórka = jeden
   * szewron), `gap0…gap1` — przerwa na zatokę taśmy [°], `speed` — obieg szewronów [obroty/s] przy 0 g, `flow` —
   * spływ szewronów w dół [komórki/s] przy grawitacji. Czasy przejść [s]: `stop` — hamowanie obiegu, `hold` — postój,
   * `turn` — obrót grotem w dół (i z powrotem), `ramp` — rozpędzanie.
   */
  display: Object.freeze({
    y: 35, half: 42, rOut: 517, rIn: 452, cells: 40, gap0: 127.5, gap1: 172.5,
    speed: 0.075, flow: 1.7, stop: 0.4, hold: 0.18, turn: 0.55, ramp: 0.45
  }),
  /**
   * Dawne linie „okien” na ścianach: nieruchome, przygaszone listwy (`lines` — wysokości, po dwa okna na bok
   * 32-kąta). `ringLights` — świateł krążących po pierścieniu bramy 0 g przy taśmie (ten sam język co wyświetlacz:
   * krążą przy 0 g, stają i spływają w dół przy grawitacji).
   */
  grav: Object.freeze({ lines: Object.freeze([362, -272]), ringLights: 2 }),
  belt: Object.freeze({
    pts: Object.freeze([[-1490, 40, 196], [-1080, 40, 196], [-800, 40, 260], [-292, 40, 260]]),
    radius: 320, width: 120, speed: 240,
    boundaryX: -360,            // płaszczyzna granicy 0 g (pierścień w poprzek taśmy)
    ringR: 100,
    ringY: 66                   // środek pierścienia granicy (nad taśmą)
  }),
  /** biegun żużla: GÓRNY biegun kuli (oś obrotu) — tam wirowanie spycha wyspy żużla w jedną czapę */
  slagPole: Object.freeze([0, 1, 0]),
  /**
   * Żużel na kuli: promień kątowy wyspy α = `angle` · (masa [t])^`power` · (`refR` / R) — soczewka gęstej cieczy rośnie
   * wolniej niż jej masa (jest grubsza w środku); `refR` dobrane tak, że przy 4 × większym wsadzie wyspy zajmują ten
   * sam kąt co w kuli sprzed rundy 4 (żużel wygląda tak samo, tylko większy); `lift` — największe uniesienie soczewki
   * [ułamek promienia kuli], `liftDepth` — głębokość [rad cięciwy], na której soczewka dochodzi do 63 % grubości.
   */
  slag: Object.freeze({ angle: 9.2 * DEG, power: 0.4, refR: 155, maxAngle: 1.2, lift: 0.05, liftDepth: 0.085 }),
  /**
   * SSAWA żużla (płaszczyzna z = 0): wysięgnik skrzynkowy ze ściany na wysokości `boomY`, po nim jedzie wózek (`parkX`
   * — postój pod ścianą, `workX` — praca nad kulą). Pod wózkiem KOLANO (`kneeDrop` poniżej osi wysięgnika), z niego
   * wychodzi wahliwa, teleskopowa SZYJA zakończona dzwonem (`mouthR`, długość `bell`); w postoju szyja jest pozioma
   * i wsunięta (`neckPark`). Przy pracy dzwon staje obok wierzchołka czapy: `threadDx` w bok (ku ścianie) i `threadDy`
   * w górę od wierzchołka — nitka żużla wychodzi z czapy pionowo i wygina się ku dzwonowi, a z kamery z góry widać ją
   * całą (dzwon nie zasłania bieguna). `coneH` [j.] / `coneW` [rad] — stożek wyciągany z czapy pod nitką.
   */
  ssawa: Object.freeze({
    wallX: 520, boomY: 360, parkX: 402, workX: 196, neckPark: 44, kneeDrop: 22, threadDx: 72, threadDy: 38,
    mouthR: 30, pipeR: 11.5, bell: 36, coneH: 36, coneW: 0.1
  }),
  /**
   * ODBIERALNIK żużla (granulator): koryto przy ścianie na łuku `az0…az1`, promienie `rIn…rOut`, dno `floorY`, obrzeże
   * `rimY`; wylot rurociągu (`spout*`) nad środkiem koryta. W korycie działa własna płyta grawitacji (bursztynowe
   * lampki na obrzeżu): struga żużla rwie się na krople, które stygną w ciemne granulki i usypują kopczyk; przed
   * następnym ściąganiem żaluzje dna otwierają się i granulki zsypują się lejem do kanału w ścianie.
   * Siatka kopczyka: `cellsA` × `cellsR` pól.
   */
  tray: Object.freeze({
    az0: 13 * DEG, az1: 62 * DEG, rIn: 404, rOut: 510, floorY: 204, rimY: 268,
    spoutAz: 37.5 * DEG, spoutR: 458, spoutY: 300, pipeY: 328, cellsA: 22, cellsR: 7
  }),
  /**
   * Lampy robocze ścian: pionowe listwy na licu studni — NIEREGULARNE (różna długość, wysokość i jasność, część
   * zgaszona), ciepłe i przygaszone: głównym światłem komory jest kula. Te same lampy odbija kula (`kulaTSL.js`).
   * Leżą nad pasem wyświetlacza. a — azymut [rad], y — środek, half — połowa długości, gain — jasność 0…1
   * (0 = zgaszona: sama oprawa)
   */
  strips: Object.freeze((() => {
    const out = [];
    const fr = (v) => v - Math.floor(v);
    for (let k = 0; k < 16; k++) {
      if (k === 6 || k === 7) continue;                  // zatoka taśmy
      const v = fr(k * 0.618034 + 0.13);
      out.push(Object.freeze({
        a: k * Math.PI / 8, y: Math.round(222 + (fr(k * 0.5698 + 0.2) - 0.5) * 130), half: Math.round(28 + 38 * fr(k * 0.754877 + 0.4)),
        gain: v < 0.38 ? 0 : +(0.45 + 0.55 * v).toFixed(3)
      }));
    }
    return Object.freeze(out);
  })()),
  /** miękka ściana pola dla ziaren w locie (promień w planie; twarda granica `fieldHard`) i pułap / dno */
  fieldWall: 430,
  fieldHard: 484,
  fieldCeil: 232,
  /**
   * radiatory na pomoście górnym: prostokąty [x0, z0, x1, z1] — kolumna przy zachodniej krawędzi pomostu (zatoka taśmy
   * dzieli ją na dwie części); kolektory zbiera rura zbiorcza wzdłuż z na `radHeaderX` (most nad zatoką), która wchodzi
   * w kołnierz naczynia na z = `radHeaderZ`
   */
  radiators: Object.freeze([
    Object.freeze([-1460, -880, -1180, -680]), Object.freeze([-1460, -620, -1180, -420]), Object.freeze([-1460, -360, -1180, -160]),
    Object.freeze([-1460, -100, -1180, 70]), Object.freeze([-1460, 430, -1180, 640]), Object.freeze([-1460, 690, -1180, 880])
  ]),
  radHeaderX: -1100,
  radHeaderZ: -30,
  /** kabina wytopu na pomoście (środek, wymiary w planie), szyba od strony naczynia (+x) */
  cabin: Object.freeze({ x: -880, z: -760, w: 250, d: 170 }),
  /**
   * ODCIĄG GAZU I TLEN (runda 5, `gaz.js`). Wszystko poza obrazem pola gazu: bryły i wskaźniki.
   *   hoods    OKAPY DOLNE na ścianie studni: azymuty [°] — tam, gdzie ściana jest wolna w rzucie z góry (koryto
   *            odbieralnika 13–62°, wysięgniki cewek 10 / 100 / 190 / 280°, zatoka taśmy 127,5–172,5°, wysięgnik ssawy
   *            0°), `half` — połowa łuku [°]; przekrój `profile` [promień, y] (zamknięty, od ściany przez dach do
   *            wlotu i dalej po wardze i dnie z powrotem do ściany): `mouth` — krawędzie wlotu (dach, warga), wlot
   *            patrzy w górę i ku osi, `throat` — gardło za żaluzjami (tam kreska światła), `slats` — żaluzji we wlocie.
   *            Okap sięga do ρ ≈ 401: pas wyświetlacza (lico 452–517) przykrywa w rzucie z góry wszystko dalej, więc
   *            warga, żaluzje i gardło z kreską światła leżą bliżej osi niż 452 — czytelne z kamery gry
   *   ring     PIERŚCIEŃ GÓRNY: szczelina w ścianie pod obrzeżem (`y0…y1`, głębokość `depth` za licem), kołnierze
   *            nad i pod szczeliną (`lip` — wysunięcie, `lipH` — grubość), żebra kraty co `ribDeg`; `skip` — boki
   *            32-kąta bez szczeliny (drzwi obsługi)
   *   pipe     RURA ZBIORCZA (runda 6 — zejście do hali): wychodzi łukiem z wierzchu kołnierza naczynia (azymut `az`,
   *            promień `r0`), biegnie poziomo na osi `y` do `r1` (poza kołnierz), schodzi pionem po płaszczu do osi
   *            `hallY + bend` nad pokładem hali (wsporniki do pierścienia nośnego `brackets` — wysokości), łukiem w
   *            poziom i po pokładzie hali w +x (na z pionu, r1·sin az) do rozdzielacza (`header` — rura wzdłuż z na `x`, od `z0`
   *            do `z1`, promień `rh`); promień `r`, promień łuków `bend`; podpory na pokładzie co `shoe`
   *   tanks    ZBIORNIKI TLENU leżące wzdłuż x na pokładzie hali: `x0…x1` (z dennicami), promień `r`, osie na `z`,
   *            oś na wysokości `y` (dolna część w kołysce pokładu), dennice elipsoidalne głębokości `head`, siodła na
   *            `saddles` (x); listwa napełnienia na grzbiecie od strony rozdzielacza (`strip` — szerokość [rad]);
   *            odgałęzienie z zaworem, wylot do sieci ringu w pokład (`outX`). Wymiary bez zmian od rundy 5.
   */
  gaz: Object.freeze({
    hoods: Object.freeze({
      az: Object.freeze([82, 222, 300, 343]), half: 15,
      profile: Object.freeze([
        Object.freeze([516, -36]), Object.freeze([494, -40]), Object.freeze([470, -50]),
        Object.freeze([405, -80]), Object.freeze([401, -92]), Object.freeze([403, -108]), Object.freeze([413, -124]),
        Object.freeze([432, -138]), Object.freeze([460, -147]), Object.freeze([490, -151]), Object.freeze([516, -153])
      ]),
      mouth: Object.freeze([2, 3]), throat: Object.freeze([440, -104]), slats: 7
    }),
    ring: Object.freeze({ y0: 352, y1: 394, depth: 18, lip: 9, lipH: 4, ribDeg: 2.8125, skip: Object.freeze([25]) }),
    pipe: Object.freeze({
      az: 290, r0: 600, r1: 800, y: DECK_Y + 13, r: 13, bend: 16, hallY: HALL_Y,
      brackets: Object.freeze([330, -330, -900]),
      x: 900, rh: 16, z0: -940, z1: -590, shoe: 118
    }),
    tanks: Object.freeze({
      x0: 960, x1: 1200, r: 48, head: 22, y: HALL_Y + 16, z: Object.freeze([-680, -795, -910]),
      saddles: Object.freeze([1012, 1148]), strip: 0.16, outX: 1220
    })
  })
});

/**
 * Droga z łukami (filet) przez punkty `pts` [[x, y, z], …]: w narożu `i` łuk o promieniu `radii[i]` (0 — ostre
 * naroże). Zwraca kawałki — odcinki { a, b, len } i łuki { c, s, d0, n, R, ang, len } (punkt łuku przy kącie φ:
 * c + n·(−R·cos φ) + d0·(R·sin φ) — `n` to kierunek od początku łuku ku środkowi) — i długość.
 */
export function filletPath(pts, radii) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len3 = (v) => Math.hypot(v[0], v[1], v[2]);
  const nrm = (v) => { const l = len3(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const pieces = [];
  let cur = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const P = pts[i];
    const R = i < pts.length - 1 ? radii[i] || 0 : 0;
    if (R > 0) {
      const d0 = nrm(sub(P, pts[i - 1]));
      const d1 = nrm(sub(pts[i + 1], P));
      const cos = Math.max(-1, Math.min(1, d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2]));
      const ang = Math.acos(cos);
      const t = R * Math.tan(ang / 2);
      const s = [P[0] - d0[0] * t, P[1] - d0[1] * t, P[2] - d0[2] * t];
      const e = [P[0] + d1[0] * t, P[1] + d1[1] * t, P[2] + d1[2] * t];
      const n = nrm([d1[0] - d0[0], d1[1] - d0[1], d1[2] - d0[2]]);
      // środek łuku: od początku łuku prostopadle do d0, w płaszczyźnie naroża
      const k = n[0] * d0[0] + n[1] * d0[1] + n[2] * d0[2];
      const nn = nrm([n[0] - d0[0] * k, n[1] - d0[1] * k, n[2] - d0[2] * k]);
      const c = [s[0] + nn[0] * R, s[1] + nn[1] * R, s[2] + nn[2] * R];
      const l0 = len3(sub(s, cur));
      if (l0 > 1e-6) pieces.push({ type: 'seg', a: cur, b: s, len: l0 });
      pieces.push({ type: 'arc', c, s, e, d0, d1, n: nn, R, ang, len: R * ang });
      cur = e;
    } else {
      const l0 = len3(sub(P, cur));
      if (l0 > 1e-6) pieces.push({ type: 'seg', a: cur, b: P, len: l0 });
      cur = P;
    }
  }
  let len = 0;
  for (const p of pieces) { p.s0 = len; len += p.len; }
  return { pieces, len };
}

/** Punkt i kierunek drogi `filletPath` na długości `s` (zapis do `out` = [x, y, z, tx, ty, tz]). */
export function pathSample(path, s, out = new Float64Array(6)) {
  const P = path.pieces;
  let p = P[P.length - 1];
  for (let i = 0; i < P.length; i++) if (s <= P[i].s0 + P[i].len) { p = P[i]; break; }
  const u = Math.max(0, Math.min(p.len, s - p.s0));
  if (p.type === 'seg') {
    const f = u / p.len;
    for (let j = 0; j < 3; j++) { out[j] = p.a[j] + (p.b[j] - p.a[j]) * f; out[3 + j] = (p.b[j] - p.a[j]) / p.len; }
  } else {
    const phi = u / p.R;
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    for (let j = 0; j < 3; j++) {
      out[j] = p.c[j] - p.n[j] * p.R * c + p.d0[j] * p.R * sn;
      out[3 + j] = p.d0[j] * c + p.n[j] * sn;
    }
  }
  return out;
}

/**
 * Droga rury zbiorczej (oś) od wyjścia z kołnierza naczynia do zbiornika `k` (runda 6: w 3D — po kołnierzu, pionem
 * po płaszczu do hali, po pokładzie hali): `main` — droga z łukami do rozdzielacza (wejście na jego oś), `path` — cała
 * droga do dennicy zbiornika (przez oś rozdzielacza, naroża rozdzielacza ostre), `len` — jej długość, `bend` — promień
 * łuków, `vertical` — [x, z] pionu, `deck` — wysokość osi na pokładzie hali.
 */
export function gasPipeRoute(k) {
  const P = KOMORA.gaz.pipe;
  const T = KOMORA.gaz.tanks;
  const a = P.az * DEG;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const yd = P.hallY + P.bend;
  const vx = ca * P.r1;
  const vz = sa * P.r1;
  // pion schodzi w punkcie (vx, vz); po pokładzie hali rura biegnie w +x na z = vz do rozdzielacza
  const ptsMain = [
    [ca * P.r0, KOMORA.deckY, sa * P.r0], [ca * P.r0, P.y, sa * P.r0], [vx, P.y, vz], [vx, yd, vz], [P.x, yd, vz]
  ];
  // (pierwszy łuk — wyjście z kołnierza: promień = wysokość osi nad kołnierzem)
  const rMain = ptsMain.map((_, i) => (i === 1 ? P.y - KOMORA.deckY : P.bend));
  const main = filletPath(ptsMain, rMain);
  const zk = T.z[k];
  const pts = ptsMain.concat([[P.x, yd, zk], [T.x0, yd, zk]]);
  const radii = rMain.concat([0, 0]);
  radii[ptsMain.length - 1] = 0;
  const path = filletPath(pts, radii);
  return { main, path, len: path.len, bend: P.bend, vertical: [vx, vz], deck: yd };
}

/** Tor taśmy komory i droga, na której taśma przecina granicę 0 g. */
export function createMeltTrack() {
  const B = KOMORA.belt;
  const track = createConveyorTrack({ pts: B.pts.map((p) => p.slice()), radius: B.radius, vertical: 160, width: B.width, step: 2 });
  const sBoundary = track.nearest(B.boundaryX, B.pts[B.pts.length - 1][2]);
  return { track, sBoundary };
}

/** Czy punkt planu (x, z) leży w otworze pokładu (studnia ∪ zatoka taśmy). */
export function inOpening(x, z) {
  const b = KOMORA.bay;
  return x * x + z * z < KOMORA.pitR * KOMORA.pitR || (x > b.x0 && x < b.xb && z > b.z0 && z < b.z1);
}

/** Nachylenie stożka leja: przyrost promienia na jednostkę wysokości. */
export function funnelSlope() {
  const F = KOMORA.funnel;
  return (F.rimR - F.throatR) / (F.rimY - F.throatY);
}

/** Promień stożka leja na wysokości y (między gardzielą a obrzeżem; poza zakresem — przedłużenie liniowe). */
export function funnelRadiusAt(y) {
  const F = KOMORA.funnel;
  return F.throatR + (y - F.throatY) * (F.rimR - F.throatR) / (F.rimY - F.throatY);
}

/**
 * Wysokość DNA komory na promieniu r: stożek leja od gardzieli do ściany (nad gardzielą — poziom gardzieli). Całe dno
 * jest lejem: płaskiej posadzki nie ma na żadnym promieniu.
 */
export function funnelFloorAt(r) {
  const F = KOMORA.funnel;
  if (r <= F.throatR) return F.throatY;
  return F.throatY + (r - F.throatR) * (F.rimY - F.throatY) / (F.rimR - F.throatR);
}

/** Objętość leja od gardzieli do poziomu y [j.³] (stożek ścięty). */
export function funnelVolumeTo(y) {
  const F = KOMORA.funnel;
  const h = Math.max(0, y - F.throatY);
  const r = funnelRadiusAt(F.throatY + h);
  return Math.PI * h / 3 * (r * r + r * F.throatR + F.throatR * F.throatR);
}

/**
 * Poziom [y], do którego ciecz o objętości `vol` wypełnia lej (nad obrzeżem — przedłużenie stożka). Stożek ścięty:
 * (r0 + k·h)³ = r0³ + 3·k·V / π, k — przyrost promienia na jednostkę wysokości.
 */
export function funnelLevelOf(vol) {
  const F = KOMORA.funnel;
  if (!(vol > 0)) return F.throatY;
  const k = (F.rimR - F.throatR) / (F.rimY - F.throatY);
  return F.throatY + (Math.cbrt(F.throatR * F.throatR * F.throatR + 3 * k * vol / Math.PI) - F.throatR) / k;
}

/** Wysokość środka kuli o promieniu R w chwili zetknięcia ze stożkiem leja (kula w osi). */
export function funnelContactY(R) {
  const F = KOMORA.funnel;
  const m = (F.rimR - F.throatR) / (F.rimY - F.throatY);
  return F.throatY + (R * Math.sqrt(1 + m * m) - F.throatR) / m;
}

/**
 * ZASYSANIE (gardziel ciągnie metal przez cały spływ). Obrót cieczy przy gardzieli i wgłębienie lustra nad nią liczy
 * pole masy (`masa.js`: łopatki gardzieli nadają dopływającej cieczy kręt, siła odśrodkowa odsuwa lustro od osi);
 * tu liczby wspólne symulacji i obrazu: `radius` — promień rdzenia wiru rysowanego nad gardzielą [× promień
 * gardzieli], `floor` — najmniejsza siła wiru przy otwartej gardzieli (0…1), `dimpleMax` — ograniczenie wgłębienia
 * w stanie [j.].
 */
export const VORTEX = Object.freeze({ radius: 1.25, floor: 0.35, dimpleMax: 160 });

/**
 * Promień kątowy wyspy żużla [rad] z masy [t] na kuli o promieniu R: soczewka gęstej cieczy — promień rośnie jak
 * masa^0,4 (grubsza w środku), ten sam rozmiar liniowy na mniejszej kuli zajmuje większy kąt.
 */
export function slagAngle(tons, R) {
  const G = KOMORA.slag;
  if (!(tons > 0)) return 0;
  const a = G.angle * Math.pow(tons, G.power) * (G.refR / Math.max(R, 60));
  return a > G.maxAngle ? G.maxAngle : a;
}

/** Punkt koryta odbieralnika: azymut `az` [rad], promień `r` → [x, z]. */
export function trayPoint(az, r) {
  const c = Math.cos(az);
  const s = Math.sin(az);
  return [c * r, s * r];
}

/**
 * WYŚWIETLACZ GRAWITACJI — wzór podwójnego szewronu (ten sam liczy shader pasa, `wyswietlacz.js`). Współrzędne
 * w szerokościach komórki od jej środka: cu — po obwodzie zgodnie z obiegiem, cv — w dół lica. `turn` 0…1: 0 — groty
 * po obwodzie, 1 — groty w dół. Zwraca 0…1 (1 — piksel szewronu świeci).
 */
export const CHEVRON = Object.freeze({ arm: 0.3, slope: 0.95, thick: 0.085, soft: 0.02, tip: 0.16, off: Object.freeze([-0.13, 0.17]) });
export function chevronAt(cu, cv, turn) {
  const a = turn * Math.PI / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // obrót wokół środka komórki: oś grota (px) i oś poprzeczna (py); dwa szewrony jeden za drugim
  const px = cu * c + cv * s;
  const py = -cu * s + cv * c;
  const ay = Math.abs(py);
  if (ay > CHEVRON.arm) return 0;
  const base = px + ay * CHEVRON.slope - CHEVRON.tip;
  const d = Math.min(Math.abs(base + CHEVRON.off[0]), Math.abs(base + CHEVRON.off[1]));
  const k = (CHEVRON.thick - d) / CHEVRON.soft;
  return k <= 0 ? 0 : k >= 1 ? 1 : k;
}
