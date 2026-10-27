// src/3d/warp/worldLens.js
//
// SOCZEWKA ŚWIATA — „PODNIESIONY ŚWIAT” w skoku gracza (DECYZJE M / P / T, 2026-10-25; projekt C „perspektywa drogi”
// z przeszczepami z B „kropla 2.0” i D). Prośba usera (2026-10-25): „w warpie ustawiasz planetę daleko, jest mała,
// i jak mijasz, to ogromna, potem znowu mała, i inne elementy gry też takie powinny być”.
//
// MAPA O1 „kamera pochylona” (DECYZJE-2 O1-1, 2026-10-26 — wybór użytkownika zamiast mapy C; osie EKRANU, kurs = (cu, cv);
// ciało względem statku: a — wzdłuż kursu, + przed dziobem; l — w bok, + w prawo). Homografia płaszczyzny gry — tak widzi
// ją kamera pochylona nad statkiem: proste w świecie są prostymi na ekranie (tory bez zakrętu), JEDEN punkt zbiegu
// przed dziobem (horyzont), ciała za płaszczyzną kamery niewidoczne:
//   s   = w_s · ē_s / B1 · k_v              skala w trawersie [px/j.] (ē_s — średnia dróg od kotwicy do krawędzi w bok,
//                                           najwyżej aspectMax 16:9 × połowa wysokości; k_v = min(1, speedRef / v napędu))
//   E   = h_f · e_f                         punkt zbiegu przed dziobem [px od kotwicy] (e_f — droga do krawędzi przed dziobem)
//   A   = E / s                             [j.] płaszczyzna kamery za statkiem (nie zależy od rozdzielczości ani od
//                                           proporcji kadru szerszego niż 16:9; × 1 / k_v przy szybszym napędzie)
//   w   = 1 + β · a / A                     głębia obrazu (1 — statek, 0 — płaszczyzna kamery)
//   q   = flat^(1−β) · s^β / max(w, 1 / kMax);   obraz = P0 + q · (dx, dy),   promień = q · r · ukrycie(w)
// β = 0 daje DOKŁADNIE prawdziwy obraz (w = 1, q = flat). Przy β = 1: przed dziobem obraz dąży do punktu zbiegu
// (q · a → E przy a → ∞ — wielkość z daleka ≈ r · E / a), w trawersie skala s (Mars 75 tys. j. z boku: 659 px od
// statku, promień 263 px przy 1080p — jak mapa C), za trawersem ciało rośnie i wylatuje z kadru (bokiem albo dołem).
// Płaszczyzna kamery: skala stoi na kMax · s (bez osobliwości — obraz daleko za kadrem), a promień gaśnie przed nią:
// ukrycie(w) = smoothstep(hideW0, hideW1, w) (hideW0 ≥ 1 / kMax) — planeta startu wylatuje dołem kadru i znika.
// Namiar prawdziwy (obraz na kierunku ciała od kotwicy), tarcza zachodzi pod statek tylko przy prawdziwym przelocie nad
// ciałem (q · (d − r) > 0 dla d > r; przelot nad ciałem — niżej).
// Odwrotność dla HUD-u w postaci zamkniętej (warpLensInverse). Dawna mapa C (pas W / √(l² + B²), dwa punkty zbiegu —
// zawijanie toru wokół statku): docs/webgpu/WARP-SOCZEWKA.md § „Mapa O1” i „Historia”.
//
// KOTWICA P0 (M3): P0(β) = statek + (P0_nom − statek) · β, P0_nom — nominalne miejsce statku w kadrze (sprężyna riga bez
// impulsu kopu i bez wysunięcia przy wyjściu, ctx.anchorSx / anchorSy; brak — statek). Przy β = 1 świat soczewki stoi
// w kadrze jak gwiazdy, a statek wyrywa się względem niego. Planety tła (z = −50 000): kotwica × (flat / zoom)^(1−β).
//
// PRZEJŚCIA (P2 / P3): tryb ciała ustalany RAZ na przejście (wejście: ładowanie + kop — decyzja zapada, gdy ciało
// naprawdę zaczyna przejście, np. przy otwarciu bramki ringu; wyjście — w chwili wyjścia):
//   RUCH — rodzina q_β: prawdziwy obraz w kadrze albo obraz bliski (farRatio) i wjeżdżający w kadr wolno (moveLog — próg
//          P4; duża bliska tarcza, np. planeta startu z ringiem, go nie spełnia); przy wyjściu: cel i ciało z prawdziwym
//          obrazem w kadrze; `ctx.origin` + originMove — planeta startu zawsze ruchem (A/B);
//   WYNURZENIE / ZANURZENIE — pozostałe: stoją w miejscu obrazu soczewki × (1 + emergeLift · (1 − β)), promień
//          × smoothstep(emerge0, emerge1, β) — nie przelatują przez kadr i nie wjeżdżają pod statek (reguła 10-08);
//          przy β ≤ emerge0 (promień w soczewce 0) — dokładnie prawdziwy obraz (poza kadrem), więc β → 0 = prawdziwy widok.
// Wyjście: ciało spoza celu prostuje się, gdy minie je FRONT smug gwiazd (src/render/warpLensPhase.js — od dziobu ku
// rufie w czasie ramp.slow), w `submerge` s — dłużej, gdy obraz jechałby szybciej niż exitMovePx / exitSizePx na klatkę
// (duża tarcza pod statkiem: zaczyna przed frontem, kończy z oknem wyjścia). Wyjście w trakcie kopu (β wyjścia < 1)
// zostawia tryby z wejścia. Ciało,
// którego nie było w poprzedniej klatce skoku (bryła gotowa później), wynurza się w miejscu w lateTime s. Decyzja wejścia
// widzi prawdziwy obraz także w kadrze skoku po oddaleniu ładowania (ctx.zoomJump).
//
// CEL (T1 / T2): w soczewce od kopu jak każde ciało, skala q_T = miękkie maksimum (q, z_v) w logarytmie, z_v = skala
// OBRAZU celu w kadrze przylotu kamery (src/render/warpArrivalFrame.js: warpArrivalScale — ta sama funkcja co kamera;
// planety tła z perspektywą i paralaksą, miękkie minimum z kadrem skoku ctx.zoomRef). Po zatrzymaniu rampy q_T nie
// mniejsze niż prawdziwy obraz (podłoga w arrivalFloorTime s — kamera przybliżająca ponad podgląd ciągnie cel ze sobą).
// Przy wyjściu β_T = β wyjścia, dopóki skala prawdziwego obrazu celu (flat) nie zbiegnie z q_T (|ln| < arrivalConvLog
// przez arrivalConvTime s po rampie) albo do zatrzymania (koniec ślizgu, ctx.arriving) + arrivalStopGrace; potem
// 1 − smoothstep(0, arrivalRelease). Cięcie — od razu. Księżyce celu jadą jego skalą. Cel bez obrotu przelotu
// (planet3d.assets.js: lensFaceQuat).
//
// STOŻEK ZA CELEM (M4): ciało dalej wzdłuż kursu niż bliski brzeg celu, w stożku ±coneDeg wokół kursu — zanurza się
// (promień → 0 płynnie z kątem; wynurzanie / zanurzanie w miejscu — pełne od emerge0), poza stożkiem widoczne.
// PRZELOT NAD CIAŁEM (BRIEF-studnie pkt 5, 2026-10-27): ciało, przez które przechodzi OŚ KURSU (|l| < rExt — z ringiem),
// ma głębię mapy w punkcie osi kursu w ciele najbliższym statkowi (cięciwa — warpLensChordAlong): przed nim punkt wejścia,
// nad nim statek (skala s: ogromna tarcza POD statkiem, stała, powierzchnia jedzie s · v), za nim punkt wyjścia (wylot
// dołem w tempie homografii, ukrycie dopiero za całą cięciwą). Statek nad ciałem w obrazie ⟺ nad ciałem naprawdę (obraz
// podobny wokół kotwicy). Decyzja wejścia (b.chordOn, raz na skok): statek nad ciałem już przy wejściu — skala środka.
// KIESZEŃ KADŁUBA (poza celem, tylko ciało blisko statku na starcie — b.pocketOn: ruch, bo prawdziwy obraz / dok w kadrze,
// cięciwa kursu nie przed statkiem): q · (d − rExt) ≥ elipsa kadłuba + edgeGap (miękkie maksimum z nośnikiem zwartym;
// najwyżej do skali prawdziwego obrazu). Ciała mijane w locie (także o włos od ringu) — bez kieszeni: tarcza pod statkiem.
// KROPKI (M5): rekord z `minDot` nie mniejszy niż tyle px (planety, słońce), słońce × sunBoost; obraz < minPx gaśnie.
//
// RESZTA ŚWIATA (DECYZJE E1–E3, etap 3A): REJESTR KOTWIC (WARP_LENS_ANCHORS — obraz każdego ciała dla rzeczy przypiętych:
// ring, stacje, doki; writeLensAnchor / lensAnchorPoint), REKORDY DODATKOWE (WARP_LENS_EXTRA — komety, olbrzymy pasa,
// Hidalgo, doki bez ciała: ten sam przebieg update co ciała) i PUNKTY (WARP_LENS_SHARED.mapPoint — floty, NPC, wraki jako
// kropki; udział soczewki punktu = warpLensPointBeta strony gry, w wyjściu powrót 0,3 s od przejścia frontu; za płaszczyzną
// kamery krycie gaśnie jak promień ciał); wszystko w skoku pod statkiem (pass tła — warstwa 1, perspektywa jak FG:
// stacje, doki, Hidalgo, ring / z ≤ WARP_LENS_UNDER_Z w passie gry: komety, kropki / przed passem ortho).
//
// Czysty moduł (bez three, bez DOM, bez alokacji w update). Stan klatki pisze sterownik warpa (warpNurt.js:
// WARP_WORLD_LENS), ciała rozstawia planet3d.assets.js (applyWarpWorldLens), β liczy src/render/warpLensPhase.js.
// Weryfikacja: tests/warpWorldLens.test.mjs, tests/warpLensMapC.test.mjs (matematyka mapy O1 — nazwa pliku z czasów
// mapy C), tests/warpLensPrzejscia.test.mjs, tests/warpLensAnchors.test.mjs, `node scripts/webgpu/warp-soczewka-sym.mjs`
// (S1–S12 — S10 / S11 przelot nad tarczą i ringiem, S12 odlot nad planetą startu; S13 wyjście nad tarczą — otwarte;
// 1080p / 1440p, `--naped mk1|mk2|mk3`, `--aspect 21:9|32:9`, `--param klucz=liczba`).

import { WARP_ARRIVAL_FRAME, warpViewEdgePx, warpArrivalScale } from '../../render/warpArrivalFrame.js';
import { WARP_LENS_PHASE, warpExitFrontS, warpBodySubmerge, warpLensExitSlow, warpExitFrontCross } from '../../render/warpLensPhase.js';

export const WORLD_LENS_DEFAULTS = Object.freeze({
  // MAPA O1 (DECYZJE-2 O1-1; px — ułamki dróg od kotwicy do krawędzi kadru, skalują się z rozdzielczością)
  hf: 0.8,              // punkt zbiegu (horyzont) przed dziobem × droga do krawędzi przed dziobem
  ws: 0.8,              // skala w trawersie: ciało B1 z boku stoi w trawersie ws × droga do krawędzi w bok od statku
  B1: 87464,            // [j.] (prototyp O1: Mars 75 tys. j. z boku w trawersie 659 px od statku, promień 263 px przy
                        // 1080p — jak w mapie C; s = ws · ē_s / B1 = 0,00878 px/j., płaszczyzna kamery A ≈ 66 tys. j.)
  kMax: 20,             // najwyższe powiększenie homografii 1 / w — płaszczyzna kamery bez osobliwości (O1-2)
  hideW0: 0.05,         // ukrycie za płaszczyzną kamery: promień × smoothstep(hideW0, hideW1, w), w = 1 + β · a / A
  hideW1: 0.1,          // (obraz ciała w tym pasie leży ≥ 9 · E od kotwicy — za kadrem; hideW0 ≥ 1 / kMax)
  aspectMax: 16 / 9,    // ē_s najwyżej aspectMax × połowa wysokości kadru (e16): szerszy ekran (21:9, 32:9) widzi po bokach
                        // więcej świata, a skala s, płaszczyzna kamery A i tempo obrazu w środkowym kadrze 16:9 są jak na 16:9
                        // (bez tego s rosło z szerokością: 32:9 — tempo × 2, A ≈ 33 tys. j.); węższy ekran — ē_s bez zmian;
                        // 0 — dawne s z szerokości (A/B)
  aspectFlow: 0,        // szerszy ekran: ē_s = e16 · (e16 / ē_s)^aspectFlow. 0 — świat jak na 16:9, boki kadru szybsze
                        // (perspektywa: tempo obrazu rośnie z odległością od punktu zbiegu — na 32:9 ciała w bocznych pasach
                        // do ~2 × P4); 1 — tempo w całym kadrze jak na 16:9, świat mniejszy (32:9 — × 0,5). Decyzja przy
                        // teście na 32:9 (docs/webgpu/WARP-SOCZEWKA.md § „Mapa O1 — proporcje kadru”)
  speedRef: 175000,     // [j/s] napęd odniesienia (Mk II, Atlas — driveModes.js: WARP_DRIVES.warp_mk2). Szybszy napęd
                        // (ctx.driveSpeed — Mk III 250 tys.): s × speedRef / v — tempo obrazu s · v jak przy Mk II (P4:
                        // wylot dołem blisko osi kursu 2,6 · s · v), świat w soczewce mniejszy (Mk III × 0,7); wolniejszy
                        // napęd — s bez zmian; 0 — wyłączone (A/B)
  // Przejścia (P2)
  farRatio: 12,         // prawdziwy obraz dalej niż × obraz soczewki — wynurzenie / zanurzenie w miejscu
  moveLog: 3.5,         // ruch tylko, gdy d / (d − r) · ln(flat / Q) ≤ tyle (P4: ≤ 60 px/kl. przy wejściu w kadr przy β'
                        // ładowania ≤ 1,7/s: 60 · 60 / (540 · 1,7) ≈ 3,9)
  originMove: false,    // planeta startu (ctx.origin) zawsze „ruchem” (projekt B; A/B — symulator: ruch 100 px/kl.,
                        // promień 66 px/kl. przy wejściu w kadr, ponad progi P4; domyślnie reguła ogólna — wynurzenie)
  emerge0: 0.1,         // promień wynurzenia × smoothstep(emerge0, emerge1, β)
  emerge1: 0.8,
  emergeLift: 0.06,     // położenie wynurzenia × (1 + emergeLift · (1 − β))
  // PRZELOT NAD CIAŁEM (BRIEF-studnie pkt 5, 2026-10-27; decyzja użytkownika 2026-10-26: „masz wtedy ogromną planetę,
  // nad którą możesz przelecieć i nie wymuszasz przelotu bokiem”): ciało, przez które przechodzi OŚ KURSU (|l| < promień
  // z ringiem — rExt), rysuje się skalą mapy w punkcie osi kursu w tym ciele najbliższym statkowi (CIĘCIWA kursu,
  // warpLensChordAlong): nad tarczą skala s (stała „wysokość” — ogromna tarcza POD statkiem nie rośnie i nie ucieka,
  // powierzchnia jedzie s · v), przed nią i za nią punkt wejścia / wyjścia osi kursu leży dokładnie w homografii O1 (wylot
  // dołem kadru w tempie mapy, ukrycie za płaszczyzną kamery dopiero, gdy cała cięciwa jest za nią). Ciała obok osi kursu
  // (|l| ≥ rExt) i cel — skala środka (mapa O1 bez zmian). Skala środka dużej tarczy pod statkiem rosła × 3,6 (Jowisz,
  // tarcza 245 → 1520 px) i ring wpadał w pas ukrycia jeszcze w kadrze. 0 — skala środka (A/B)
  chord: 1,
  chordSoft: 0.25,      // wygładzenie końców cięciwy (× półcięciwa): skala bez załamania przy wejściu nad tarczę i zejściu
  chordMax: 0.9,        // półcięciwa najwyżej × płaszczyzna kamery A (środek obrazu ciała poniżej punktu zbiegu)
  // KIESZEŃ KADŁUBA — tylko ciało BLISKO STATKU NA STARCIE: tryb ustalony przy wejściu ruchem, bo prawdziwy obraz (albo dok
  // — attachR) był w kadrze, a cięciwa kursu nie leży przed statkiem (dok Luny, Hidalgo, dok bez ciała, olbrzym pasa obok
  // statku): obraz w soczewce nie mniejszy, niż trzeba, żeby tarcza (z ringiem) stała ≥ edgeGap od elipsy kadłuba —
  // mniejszy kontrast prawdziwy ↔ soczewka, więc przejście ruchem w ładowaniu mieści się w P4 (symulator S7). Ciała mijane
  // w locie (także o włos od ringu) i ciała, nad którymi statek przeleci, kieszeni nie mają (BRIEF-studnie pkt 5: tarcza
  // pod statkiem; dawna kieszeń przy przelocie nad tarczą rozdmuchiwała ją do prawdziwej skali — Jowisz 421 → 5600 px).
  // Decyzja raz na skok (b.pocketOn, b.pocketSession). 0 — bez kieszeni (A/B)
  pocket: 1,
  // KSIĘŻYCE RODZICA Z CIĘCIWĄ KURSU PRZED STATKIEM (recenzja obrazu W2: księżyc za ringiem lądował w obrazie kuli
  // rodzica) — skala obrazu rodzica, póki punkt cięciwy rodzica jest przed statkiem albo pod nim; za nim płynnie własna mapa
  // na drodze moonRigidFade · A punktu cięciwy (WarpWorldLens.update). 0 — własna mapa zawsze (A/B)
  moonRigid: 1,
  moonRigidFade: 0.35,
  edgeGap: 24,          // [px] najmniejszy odstęp tarczy (z ringiem — rExt) od elipsy kadłuba
  pocketSoft: 20,       // [px] miękkość kieszeni
  // Kropki (M5)
  minDot: 2,            // [px] planety i słońce (newLensBody(…, 'planet' | 'sun')) nie mniejsze
  minPx: 1.5,           // [px] obraz mniejszy gaśnie
  sunBoost: 5,          // słońce w soczewce × tyle
  // Stożek za celem (M4)
  coneDeg: 30,          // [°] półkąt stożka wokół kursu
  coneSoftDeg: 3,       // [°] przejście (pełne zanurzenie od coneDeg − coneSoftDeg)
  coneRamp: 20000,      // [j.] przejście wzdłuż kursu za bliskim brzegiem celu
  // Cel i przylot (T1–T2)
  targetSoft: 0.15,     // miękkie maksimum log q celu i podglądu kadru przylotu
  arrivalConvLog: 0.05, // |ln(skala prawdziwego obrazu celu / q_T)| — kamera zbiegła z podglądem
  arrivalConvTime: 0.05, // [s] … przez tyle czasu gry (po rampie; 3 klatki przy 60 Hz — ten sam warunek przy 240 Hz workera)
  arrivalFloorTime: 1,  // [s] po zatrzymaniu rampy skala celu wchodzi pod podłogę „prawdziwy obraz” (od q_T · e^−arrivalConvLog)
  arrivalRelease: 0.6,  // [s] puszczenie celu na prawdziwy obraz
  arrivalStopGrace: 0.3, // [s] zapas po zatrzymaniu (koniec ślizgu), gdy kamera nie zbiegła
  arrivalSlideFallback: 5.5, // [s] po rampie: „zatrzymanie”, gdy sterownik nie podaje ctx.arriving
  arrivalHoldMax: 8,    // [s] po rampie najdłużej tyle trzymania
  // Ciało, które pojawia się w trakcie skoku (bryła gotowa później — `ready`), wynurza się w miejscu w tyle s
  lateTime: 0.4,
  // Wyjście (recenzja O1 ust. 3): czas zanurzenia / powrotu ciała z TEMPA jego obrazu — środek i promień w kadrze najwyżej
  // tyle px na klatkę 60 Hz przy 1080p (2/3 i 3/5 progów P4 60 / 50 — zapas: ciało mijane tuż przed wyjściem rośnie
  // jeszcze w trakcie zanurzenia, symulator S8: Jowisz 552 → 737 px); najkrócej WARP_LENS_PHASE.submerge, najdłużej do
  // końca okna wyjścia (exitSlow + submerge — wtedy β osi opada do 0). Duża tarcza pod statkiem (wyjście tuż po bliskim
  // przelocie) zanurza się dłużej i wcześniej — zaczyna przed frontem, jeśli inaczej nie zdąży.
  exitMovePx: 40,
  exitSizePx: 30,
  // Punkty w wyjściu (mapPoint — kropki flot i wraków): prawdziwe miejsce poza kadrem o tyle px (brzeg kadłuba) —
  // kropka gaśnie w pierwszej połowie zanurzenia (dalej jedzie na prawdziwe miejsce niewidoczna); w kadrze — jedzie
  // widoczna i oddaje miejsce skórze
  pointEdgeSoft: 96,
  // Obrót przelotu
  flybyHeight: 100000,  // [j.] wysokość wirtualnej kamery obrotu przelotu
  flybyTilt: 0.5,       // siła obrotu przelotu (DECYZJE-2 O1-3: 0,5 — prośba o obrót z 2026-09-26 zostaje, Jowisz w trawersie
                        // ~36° zamiast 72°; spłaszczony ring był częścią „zawijania”)
  // Dawna skala jednej soczewki (warpLensScale — demo „Nurt”, dema/warp-webgpu); mapa O1 jej nie używa
  framingDist: 90000,
  zoomRefSpeed: 150000,
  lensScaleMax: 0.5,
  lensScaleLag: 0.15,   // [s] wygładzenie S w demie „Nurt” (dema/warp-webgpu/worldLens.js)
  sizeDepth: 30000
});

/** Tryby przejścia ciała. */
export const WORLD_LENS_MODE = Object.freeze({ NONE: 0, MOVE: 1, FAR: 2 });
const MOVE = 1;
const FAR = 2;
const ENTRY_DECIDE_BB = 0.02;   // przy wejściu tryb ustalany, póki udział soczewki ciała mniejszy (zmiana niewidoczna)
const PLUNGE_N = 16;            // próbki przebiegu zanurzenia przy wyjściu (_plungeTime)
const GATE_CLOSED = 1e-6;       // bramka ringu „zamknięta”

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Miękkie maksimum dwóch dodatnich wartości w logarytmie (szerokość w). */
export function softMaxLog(a, b, w) {
  const la = Math.log(a);
  const lb = Math.log(b);
  return Math.exp(0.5 * (la + lb + Math.sqrt((la - lb) * (la - lb) + w * w)));
}

/**
 * Miękkie maksimum z nośnikiem zwartym (log): dokładnie `q`, gdy q ≥ qMin · e^w, dokładnie qMin, gdy qMin ≥ q · e^w,
 * pomiędzy — gładko (C¹). Kieszeń kadłuba nie rusza mapy przy zwykłych przelotach.
 */
export function softMaxCompact(q, qMin, w) {
  if (!(qMin > 0) || !(q > 0)) return q > 0 ? q : qMin;
  const x = Math.log(qMin / q);
  if (x <= -w) return q;
  if (x >= w) return qMin;
  return q * Math.exp((x + w) * (x + w) / (4 * w));
}

/** Odległość od punktu (sx, sy — px od środka kadru) do krawędzi kadru wzdłuż (ux, uy) [px] (y w dół). */
export function viewEdgeDistance(ux, uy, hw, hh, sx = 0, sy = 0) {
  return warpViewEdgePx(num(ux, 0), num(uy, 0), Math.max(0, num(hw, 0)), Math.max(0, num(hh, 0)), num(sx, 0), num(sy, 0));
}

/** Dawna skala jednej soczewki [px/j.] od nominalnej prędkości skoku (demo „Nurt”; mapa O1 jej nie używa). */
export function warpLensScale(speed, edgePx, p = WORLD_LENS_DEFAULTS, maxScale = Infinity) {
  const vr = Math.max(1, Number(p.zoomRefSpeed) || WORLD_LENS_DEFAULTS.zoomRefSpeed);
  const v = Math.max(1, Math.abs(Number(speed) || 0));
  const D = Math.max(1, Number(p.framingDist) || WORLD_LENS_DEFAULTS.framingDist) * Math.min(1, v / vr);
  const s = Math.max(1, Number(edgePx) || 1) / D;
  return Math.min(s, maxScale > 0 ? maxScale : Infinity);
}

/** Dawna perspektywa wzdłuż kursu h / √(a² + h²) (demo „Nurt”; mapa O1 jej nie używa). */
export function warpDepthScale(along, depth) {
  const h = Math.max(1, Number(depth) || 1);
  const a = Number(along) || 0;
  return h / Math.sqrt(a * a + h * h);
}

/** Obrót ciała przy przelocie: oś (ax, ay, 0) i kąt (układ sceny, y w górę). */
export function flybyTurn(ox, oy, h, out = { ax: 1, ay: 0, angle: 0 }) {
  const hor = Math.sqrt(ox * ox + oy * oy);
  if (!(hor > 1e-9)) {
    out.ax = 1;
    out.ay = 0;
    out.angle = 0;
    return out;
  }
  out.ax = -oy / hor;
  out.ay = ox / hor;
  out.angle = Math.atan2(hor, Math.max(1e-9, Number(h) || 0));
  return out;
}

/** Nowy kadr soczewki (rekord do warpLensFrame — raz, bez alokacji w klatce). */
export function newWarpLensFrame() {
  return { cu: 0, cv: -1, ef: 1, eb: 1, esR: 1, esL: 1, ec: 1, Ef: 1, W: 1, s: 1, A: 1, kv: 1, kMax: 20, wMin: 0.05, h0: 0.05, h1: 0.1,
    chord: 1, chordSoft: 0.25, chordMax: 0.9 };
}

/**
 * Kadr soczewki: kurs (cu, cv) w osiach ekranu, kadr hw × hh [px], kotwica P0 (p0x, p0y — px od środka kadru, y w dół).
 * Krawędzie liczone od kotwicy (ec — od środka kadru, przed dziobem: paralaksa tła w kadrze przylotu); E_f — punkt
 * zbiegu [px], W — pas trawersu (w_s · ē_s, ē_s — średnia dróg w bok, najwyżej aspectMax · hh) [px], s = W / B1 · kv —
 * skala w trawersie [px/j.] (kv = speedRef / drive przy szybszym napędzie, inaczej 1), A = E_f / s — płaszczyzna kamery
 * za statkiem [j.], kMax / wMin — powiększenie homografii najwyżej kMax (głębia nie mniejsza niż wMin = 1 / kMax), h0, h1
 * — pas ukrycia za płaszczyzną kamery; p — parametry mapy; drive — prędkość napędu warp [j/s] (NaN — bez). Jedna skala
 * w bok (średnia dróg do obu krawędzi, kotwica poza osią kursu w toku obrotu kadru) — proste zostają prostymi.
 */
export function warpLensFrame(cu, cv, hw, hh, p0x, p0y, p = WORLD_LENS_DEFAULTS, out = newWarpLensFrame(), drive = NaN) {
  const w = Math.max(0, num(hw, 0));
  const h = Math.max(0, num(hh, 0));
  const x0 = num(p0x, 0);
  const y0 = num(p0y, 0);
  const P = WORLD_LENS_DEFAULTS;
  out.cu = cu;
  out.cv = cv;
  out.ef = warpViewEdgePx(cu, cv, w, h, x0, y0);
  out.eb = warpViewEdgePx(-cu, -cv, w, h, x0, y0);
  out.esR = warpViewEdgePx(-cv, cu, w, h, x0, y0);
  out.esL = warpViewEdgePx(cv, -cu, w, h, x0, y0);
  out.ec = warpViewEdgePx(cu, cv, w, h, 0, 0);
  out.Ef = Math.max(1, num(p.hf, P.hf) * out.ef);
  // ē_s z kadru najwyżej e16 = aspectMax · hh — na 21:9 / 32:9 s i A jak na 16:9 tej wysokości (× (e16 / ē_s)^aspectFlow)
  const es = 0.5 * (out.esR + out.esL);
  const am = num(p.aspectMax, P.aspectMax);
  const e16 = am * h;
  let esEff = es;
  if (am > 0 && es > e16) {
    const af = clamp(num(p.aspectFlow, P.aspectFlow), 0, 1);
    esEff = af > 0 ? e16 * Math.pow(e16 / es, af) : e16;
  }
  out.W = Math.max(1, num(p.ws, P.ws) * esEff);
  const vRef = num(p.speedRef, P.speedRef);
  const vd = num(drive, NaN);
  out.kv = vRef > 0 && vd > vRef ? vRef / vd : 1;
  out.s = out.W / Math.max(1, num(p.B1, P.B1)) * out.kv;
  out.A = out.Ef / out.s;
  out.kMax = Math.max(1, num(p.kMax, P.kMax));
  out.wMin = 1 / out.kMax;
  out.h0 = Math.max(out.wMin, num(p.hideW0, P.hideW0));
  // h1 ≤ 1: statek i wszystko przed nim (w ≥ 1) nigdy nie gaśnie — β → 0 (w = 1) zostaje dokładnie prawdziwym obrazem
  out.h1 = Math.min(1, Math.max(out.h0 + 1e-6, num(p.hideW1, P.hideW1)));
  // Przelot nad ciałem (cięciwa kursu — warpLensChordAlong)
  out.chord = num(p.chord, P.chord) > 0 ? 1 : 0;
  out.chordSoft = clamp(num(p.chordSoft, P.chordSoft), 0, 1);
  out.chordMax = clamp(num(p.chordMax, P.chordMax), 0, 0.99);
  return out;
}

/**
 * PRZELOT NAD CIAŁEM — CIĘCIWA KURSU (BRIEF-studnie pkt 5): `a` (wzdłuż kursu, + przed dziobem) punktu, którego głębią
 * mapa O1 skaluje ciało o środku (a, l) i promieniu `rc` (z ringiem). Oś kursu przechodzi przez ciało (|l| < rc) na odcinku
 * a ± h, h = √(rc² − l²) (najwyżej chordMax · A): przed nim — punkt wejścia (a − h), nad nim — statek (0: skala s), za nim —
 * punkt wyjścia (a + h); końce wygładzone kwadratowo na ± chordSoft · h (C¹). Oś kursu poza ciałem (|l| ≥ rc), rc ≤ 0 albo
 * F.chord = 0 — środek (a), czyli mapa O1 bez zmian; przy |l| → rc cięciwa → 0 (ciągle w l). Funkcja nieparzysta
 * i niemalejąca w a — obraz punktu wejścia / wyjścia jedzie po osi kursu jak w homografii. Bez alokacji.
 */
export function warpLensChordAlong(a, l, rc, F) {
  if (!(F.chord > 0) || !(rc > 0)) return a;
  const d2 = rc * rc - l * l;
  if (!(d2 > 0)) return a;
  let h = Math.sqrt(d2);
  const cap = F.chordMax * F.A;
  if (h > cap) h = cap;
  const k = F.chordSoft * h;
  const x = (a < 0 ? -a : a) - h;
  let e;
  if (!(k > 0)) e = x > 0 ? x : 0;
  else if (x >= k) e = x;
  else if (x <= -k) e = 0;
  else e = (x + k) * (x + k) / (4 * k);
  return a < 0 ? -e : e;
}

/**
 * Mapa O1 dla punktu / ciała: (dx, dy) — przesunięcie od statku w osiach ekranu [j.], β, flat — skala prawdziwego
 * widoku [px/j.], F — kadr (warpLensFrame); rc (opcjonalnie) — promień ciała z ringiem: głębia w punkcie cięciwy kursu
 * (warpLensChordAlong — przelot nad ciałem), 0 — w środku (punkt, cel). Wynik: out.q — skala [px/j.] (obraz = kotwica +
 * q · (dx, dy)), a, l, d, ae (a punktu głębi — cięciwa), sb (s — skala w trawersie), A, kappa (1 / max(w, 1 / kMax)),
 * w (głębia 1 + β · ae / A, bez ograniczenia), hide (mnożnik promienia: 1, a za płaszczyzną kamery → 0). Bez alokacji.
 */
export function warpLensQ(dx, dy, beta, flat, F, out, rc = 0) {
  const a = dx * F.cu + dy * F.cv;
  const l = -dx * F.cv + dy * F.cu;
  const ae = rc > 0 ? warpLensChordAlong(a, l, rc, F) : a;
  const sb = F.s;
  const b = beta > 1 ? 1 : (beta > 0 ? beta : 0);
  const w = 1 + b * ae / F.A;
  const kb = 1 / (w > F.wMin ? w : F.wMin);
  const fl = flat > 0 ? flat : sb;
  const qs = b >= 1 ? sb : (b <= 0 ? fl : Math.exp((1 - b) * Math.log(fl) + b * Math.log(sb)));
  out.q = qs * kb;
  out.a = a;
  out.l = l;
  out.ae = ae;
  out.d = Math.sqrt(dx * dx + dy * dy);
  out.sb = sb;
  out.A = F.A;
  out.kappa = kb;
  out.w = w;
  out.hide = w >= F.h1 ? 1 : smoothstep(F.h0, F.h1, w);
  return out;
}

/**
 * Odwrotność mapy O1 (β = 1) dla HUD-u: punkt obrazu (X, Y — px od kotwicy, osie ekranu) → przesunięcie od statku
 * (out.dx, out.dy) [j.]. Postać zamknięta: wzdłuż kursu u = X_a / E_f = a / (A + a) → a = A · u / (1 − u), w bok
 * l = X_l / (s · (1 − u)); poniżej u = 1 − kMax (za płaszczyzną kamery — skala kMax · s) dzielenie przez kMax · s.
 * Punkt na horyzoncie i za nim (u ≥ 1) — nie jest obrazem żadnego punktu: out.ok = false (NaN). Obraz w paśmie ukrycia
 * (ciało niewidoczne) też ma przeciwobraz.
 */
export function warpLensInverse(X, Y, F, out) {
  out.ok = false;
  out.dx = NaN;
  out.dy = NaN;
  const Xa = X * F.cu + Y * F.cv;
  const Xl = -X * F.cv + Y * F.cu;
  const u = Xa / F.Ef;
  if (!(u < 1)) return out;
  let a;
  let l;
  if (u >= 1 - F.kMax) {
    a = F.A * u / (1 - u);
    l = Xl / (F.s * (1 - u));
  } else {
    const k = F.kMax * F.s;
    a = Xa / k;
    l = Xl / k;
  }
  out.dx = a * F.cu - l * F.cv;
  out.dy = a * F.cv + l * F.cu;
  out.ok = Number.isFinite(out.dx) && Number.isFinite(out.dy);
  return out;
}

// Parametry i kadr mapWorldLens (bez alokacji).
const _mP = { hf: 0, ws: 0, B1: 0, kMax: 0, hideW0: 0, hideW1: 0, aspectMax: 0, aspectFlow: 0, speedRef: 0, chord: 1, chordSoft: 0, chordMax: 0 };
const _mF = newWarpLensFrame();
const _mQ = { q: 0, a: 0, l: 0, ae: 0, d: 0, sb: 0, A: 0, kappa: 1, w: 1, hide: 1 };

/**
 * Mapa O1 jednego ciała (bez stanu): (dx, dy) — świat względem statku w OSIACH EKRANU [j.], y w dół; r — promień.
 * o: { zoom, flatScale (domyślnie zoom), beta, velAngle (kurs w osiach ekranu), viewHalfW/H, shipSx/Sy (KOTWICA —
 * px od środka kadru), opcjonalnie hf, ws, B1, kMax, hideW0, hideW1, aspectMax, aspectFlow, speedRef, driveSpeed (prędkość napędu
 * warp [j/s]), rExt (promień z ringiem — cięciwa kursu przy przelocie nad ciałem; domyślnie r), chord (domyślnie
 * WORLD_LENS_DEFAULTS.chord — skala cięciwy jak w WarpWorldLens; 0 — skala środka, np. statek nad ciałem już przy wejściu),
 * chordSoft, chordMax }.
 * Wynik (przesunięcie od kotwicy): out.x, out.y,
 * out.size (× ukrycie za płaszczyzną kamery), out.q, out.gap (q · (d − r)), out.d, out.theta, out.edge (droga do krawędzi
 * przed dziobem), out.a, out.l, out.ae (a punktu głębi — cięciwa), out.w, out.hide.
 */
export function mapWorldLens(dx, dy, r, o, out = {}) {
  const P = WORLD_LENS_DEFAULTS;
  const zoom = Math.max(1e-6, num(o.zoom, 1));
  const flat = num(o.flatScale, 0) > 0 ? Number(o.flatScale) : zoom;
  const va = num(o.velAngle, 0);
  _mP.hf = num(o.hf, P.hf);
  _mP.ws = num(o.ws, P.ws);
  _mP.B1 = num(o.B1, P.B1);
  _mP.kMax = num(o.kMax, P.kMax);
  _mP.hideW0 = num(o.hideW0, P.hideW0);
  _mP.hideW1 = num(o.hideW1, P.hideW1);
  _mP.aspectMax = num(o.aspectMax, P.aspectMax);
  _mP.aspectFlow = num(o.aspectFlow, P.aspectFlow);
  _mP.speedRef = num(o.speedRef, P.speedRef);
  _mP.chord = num(o.chord, P.chord);
  _mP.chordSoft = num(o.chordSoft, P.chordSoft);
  _mP.chordMax = num(o.chordMax, P.chordMax);
  const F = warpLensFrame(Math.cos(va), Math.sin(va), num(o.viewHalfW, 0), num(o.viewHalfH, 0), num(o.shipSx, 0), num(o.shipSy, 0), _mP, _mF,
    num(o.driveSpeed, NaN));
  const rr = Math.max(0, num(r, 0));
  const Q = warpLensQ(dx, dy, num(o.beta, 0), flat, F, _mQ, Math.max(rr, num(o.rExt, 0)));
  out.q = Q.q;
  out.x = Q.q * dx;
  out.y = Q.q * dy;
  out.size = Q.q * rr * Q.hide;
  out.d = Q.d;
  out.gap = Q.q * (Q.d - rr);
  out.theta = Q.d > 1e-9 ? Math.atan2(dy, dx) : va;
  out.edge = F.ef;
  out.a = Q.a;
  out.l = Q.l;
  out.ae = Q.ae;
  out.w = Q.w;
  out.hide = Q.hide;
  return out;
}

/**
 * Stan soczewki w klatce — pisze sterownik warpa (warpNurt.js), czyta planet3d.assets.js.
 * Piksele = bufor rysowania celu sceny (NIE px CSS), świat gry (y w dół), kamera bez wstrząsu. Pola „(nowe)” mają wartości
 * domyślne, gdy sterownik ich nie podaje — zachowanie sensowne (kotwica = statek, front z ramp.slow 0,7 s, zatrzymanie
 * z czasu, kadr przylotu bez miękkiego minimum z kadrem skoku, decyzja wejścia na bieżącym kadrze).
 */
export const WARP_WORLD_LENS = {
  active: false,      // soczewka w tej klatce (skok gracza, kamera z góry, bez podzielonego ekranu)
  beta: 0,            // 0..1 — oś czasu skoku (src/render/warpLensPhase.js: warpLensBeta; dawniej player.js: lensBeta)
  speed: 0,           // nominalna prędkość skoku [j/s] (diagnostyka; mapa O1 jej nie używa)
  driveSpeed: NaN,    // (nowe, recenzja O1 ust. 2) prędkość napędu warp gracza [j/s] (warp.speed — Mk I–III, stała dla
                      // wyposażenia; sterownik: o.warp.speed, w workerze WARP_SPEED migawki): szybszy niż speedRef — skala
                      // mapy × speedRef / v; NaN — bez
  velAngle: 0,        // kurs skoku (świat)
  zoom: 1,            // zoom kamery [px bufora / j.] — prawdziwy widok płaszczyzny gry
  W: 1, H: 1,         // bufor rysowania [px]
  focal: 1, camZ: 1,  // kamera perspektywy passa planet tła (z = −50 000)
  camX: 0, camY: 0,   // kamera gry (świat)
  roll: 0,            // obrót kadru (src/3d/viewRoll.js): soczewka liczy w osiach EKRANU — wejścia o −roll, rozstawienie o +roll
  shipX: 0, shipY: 0, // statek (świat)
  shipSx: 0, shipSy: 0, // statek od środka kadru [px bufora, y w dół, osie ekranu]
  anchorSx: NaN, anchorSy: NaN, // (nowe, M3) kotwica P0_nom [px BUFORA od środka kadru, osie ekranu]: nominalne miejsce
                      // statku w kadrze — sprężyna riga bez impulsu kopu i wysunięcia (gra: −cameraRig.nominalX / Y w px CSS →
                      // setWarpLensAnchor(L, cssX, cssY, bufW / viewW)); NaN — statek
  hullHalfLen: 0, hullHalfWid: 0, // [px bufora]
  dt: 0,              // [s] czas gry klatki (zegar efektu; w pauzie 0)
  target: null,       // ciało celu (dane planety z gry) albo null
  origin: null,       // (nowe, P2) ciało startu (planet3d: rekord ciała) — A/B `originMove`; null — reguła ogólna
  originBody: null,   // ciało startu (dane planety z gry — warp.originBody; sterownik) — planet3d.assets.js mapuje je na
                      // rekord (`origin`) jak cel
  exitAge: -1,        // [s] wiek wyjścia gracza (rampa albo wirtualna rampa wyjścia bez rampy — warpLensPhase.js:
                      // stepWarpLensTrack) z ZEGARA GRY, ciągły aż do targetHold = 0; < 0: skok albo brak
  exitSlow: 0,        // (nowe, P3) [s] koniec zwolnienia rampy (ramp.tSlowEnd) — czas frontu; 0 — WARP_LENS_PHASE.exitSlow
  exitHalt: 0,        // [s] zatrzymanie na rampie wyjścia (warpDrive.js: tHalt); wyjście bez rampy — 0
  arriving: null,     // (nowe, T2) ślizg z pędem po rampie trwa (warp.exitSlide.active) — ten sam zegar i klatka co
                      // exitAge; null — zatrzymanie z czasu (arrivalSlideFallback)
  arrivalFill: NaN,   // (nowe, T1) ułamek kadru przylotu (cameraRigTune.warpArrivalFill); NaN — WARP_ARRIVAL_FRAME.fill
  zoomRef: NaN,       // (nowe, T1) zoom odniesienia skoku [px bufora / j.] (input.zoomRef riga × pxScale) — miękkie minimum
                      // kadru przylotu z kadrem skoku jak w kamerze; NaN — bez
  zoomJump: NaN,      // (nowe, P2) zoom kadru skoku [px bufora / j.] (zoomRef × warpZoomOut) — decyzja wejścia: prawdziwy
                      // obraz w kadrze także po oddaleniu w ładowaniu; NaN — bieżący kadr
  targetHold: 0       // WYNIK WarpWorldLens.update: cel trzymany przy przylocie (0..1) — sterownik trzyma soczewkę,
                      // póki > 0, choć β wyjścia już opadło
};

/** Wyłącza soczewkę (sterownik bez skoku gracza) — wszystkie pola klatki do wartości domyślnych. */
export function resetWarpWorldLens() {
  const L = WARP_WORLD_LENS;
  L.active = false;
  L.beta = 0;
  L.target = null;
  L.origin = null;
  L.originBody = null;
  L.exitAge = -1;
  L.exitSlow = 0;
  L.exitHalt = 0;
  L.arriving = null;
  L.arrivalFill = NaN;
  L.zoomRef = NaN;
  L.zoomJump = NaN;
  L.anchorSx = NaN;
  L.anchorSy = NaN;
  L.driveSpeed = NaN;
  L.targetHold = 0;
}

/**
 * ROZSTAWIENIE OBRAZU W ŚWIECIE (planet3d.assets.js: _lensPlace planet, księżyców, małych ciał i słońca — jedna funkcja):
 * obraz ciała z soczewki (b.out: px bufora od środka kadru, osie ekranu) → punkt świata w głębokości ciała. j. świata na px:
 * płaszczyzna gry (`plane` — ring, małe ciała, księżyce przy ringu) 1 / zoom, tło (z < 0: planety −50 000, słońce −60 000)
 * perspektywa kamery passa (camZ − z) / focal; świat = kamera + R(roll)·(o · k) (obrót kadru — viewRoll.js). Przy β = 0
 * (obraz = prawdziwy) — prawdziwe miejsce ciała. Wynik w `out` { x, y, k } (bez alokacji).
 */
export function lensImageToWorld(L, ox, oy, z, plane, out) {
  const k = plane ? 1 / Math.max(1e-9, L.zoom) : Math.max(1, L.camZ - z) / Math.max(1e-6, L.focal);
  const u = ox * k;
  const v = oy * k;
  const roll = Number(L.roll) || 0;
  out.k = k;
  if (!roll) { out.x = L.camX + u; out.y = L.camY + v; return out; }
  const c = Math.cos(roll);
  const sn = Math.sin(roll);
  out.x = L.camX + c * u - sn * v;
  out.y = L.camY + sn * u + c * v;
  return out;
}

/**
 * Kotwica P0_nom w stanie klatki (M3): gra publikuje ją w px CSS (−cameraRig.nominalX / Y, klatka „Nurtu”: anchorSX / SY,
 * migawka WORLD.WARP_ANCHOR_SX / SY), soczewka liczy w px bufora — pxScale = bufor / CSS (Core3D.pxScale, bufW / viewW).
 * Brak liczby albo skali — NaN (kotwica = statek).
 */
export function setWarpLensAnchor(L, cssX, cssY, pxScale) {
  const s = Number(pxScale);
  const x = Number(cssX);
  const y = Number(cssY);
  const ok = s > 0 && Number.isFinite(s) && Number.isFinite(x) && Number.isFinite(y);
  L.anchorSx = ok ? x * s : NaN;
  L.anchorSy = ok ? y * s : NaN;
  return L;
}

/**
 * REJESTR KOTWIC SOCZEWKI (DECYZJE E1, etap 3A 2026-10-26 — uogólnienie dawnego slotu ringu WARP_RING_LENS): obraz
 * każdego ciała soczewki dla rzeczy PRZYPIĘTYCH do niego (ring „Halo”, stacje przy planetach i małych ciałach, doki
 * portów bez ringu) i obiektów z własnym rekordem (komety, olbrzymy pasa, Hidalgo, doki bez ciała —
 * `warpLensExtraBody`). Pisze planet3d.assets.js po rozstawieniu ciał (`writeLensAnchor`; poza soczewką
 * `clearWarpLensAnchors` — on = false), czytają moduły rzeczy. Klucz = id ciała ('earth', 'venus', 'luna', 'ceres'…)
 * albo klucz rekordu dodatkowego ('comet:<id>', 'giant:<id>', 'hidalgo', 'dock:<id>').
 *   on — ciało w soczewce w tej klatce; x, y — punkt PŁASZCZYZNY GRY pod obrazem środka ciała [świat gry] (ciało tła
 *   z paralaksą: przy β → 0 dokładnie prawdziwy środek w płaszczyźnie — writeLensAnchor); k — skala obrazu do
 *   prawdziwego widoku dla rzeczy w płaszczyźnie gry (promień obrazu / prawdziwy promień w px; 1 — prawdziwy widok);
 *   rx, ry — prawdziwy środek ciała; px — promień obrazu [px bufora]; real — udział prawdziwego widoku (1 − β ciała);
 *   vis — obraz w kadrze; q — obrót przelotu bryły (THREE.Quaternion, kopia — przypina właściciel ringu) albo null,
 *   turned; reach — [j.] zasięg rzeczy przypiętych od środka ciała (piszą właściciele rzeczy co klatkę, planet3d
 *   zeruje go po odczycie: decyzja wejścia ciała widzi rzecz przypiętą w kadrze — `b.attachR`, worldLens._decide).
 * Rzecz przypięta (punkt płaszczyzny gry p): p' = (x, y) + k · (p − (rx, ry)) — `lensAnchorPoint`; w skoku przechodzi
 * na warstwę pod statkiem (tło / z ≤ WARP_LENS_UNDER_Z w passie gry / przed passem ortho — wzór HALO_GAME.lensLayers).
 * Obrót przelotu dostaje tylko ring (duża płaska bryła wokół planety); małe rzeczy przypięte jadą bez niego.
 */
export const WARP_LENS_ANCHORS = Object.create(null);
const _anchorList = [];

/** Kotwica soczewki dla klucza `id` (tworzona raz; `q` przypina właściciel — three nie jest tu importowane). */
export function warpLensAnchorSlot(id) {
  const key = String(id || '');
  let s = WARP_LENS_ANCHORS[key];
  if (!s) {
    s = { id: key, on: false, x: 0, y: 0, k: 1, rx: 0, ry: 0, px: 0, q: null, turned: false, real: 1, vis: false, reach: 0 };
    WARP_LENS_ANCHORS[key] = s;
    _anchorList.push(s);
  }
  return s;
}

/** Wszystkie kotwice: on = false (soczewka wyłączona — rzeczy przypięte na prawdziwych miejscach). Bez alokacji. */
export function clearWarpLensAnchors() {
  for (let i = 0; i < _anchorList.length; i++) _anchorList[i].on = false;
}

/** Kotwica `id` w soczewce w tej klatce i z obrazem przesuniętym (udział prawdziwego widoku < `realMax`) albo null. */
export function warpLensAnchorOn(id, realMax = 0.999) {
  const s = id ? WARP_LENS_ANCHORS[id] : undefined;
  return s && s.on && s.real < realMax ? s : null;
}

/**
 * RING „HALO” W SOCZEWCE (user 2026-10-19: ring ma iść w soczewce razem z planetą) — kotwica planety z rejestru
 * (ten sam obiekt: klucz = id planety 'earth', 'mars', 'jupiter'); pisze planet3d.assets.js, czyta haloRingGame.js:
 * ring = obraz planety przesunięty i przeskalowany wokół jej środka (on, x, y, k, q, turned, real, vis).
 */
export const WARP_RING_LENS = WARP_LENS_ANCHORS;
/** Dawna nazwa kotwicy ringu (zgodność importów). */
export const warpRingLensSlot = warpLensAnchorSlot;

/** [j. sceny] Rzeczy soczewki w passie płaszczyzny gry (ortho) stoją tak głęboko pod nią — zawsze pod kadłubami. */
export const WARP_LENS_UNDER_Z = -400;

const _anchorWorld = { x: 0, y: 0, k: 1 };

/**
 * Kotwica ciała po rozstawieniu soczewki (b — rekord newLensBody z wynikiem `out` tej klatki; L — WARP_WORLD_LENS;
 * size — promień obrazu [px bufora] (po powiększeniu lejka rulonu, gdy jest); vis — obraz w kadrze). Ciało tła
 * (flat ≠ zoom): obraz środka przesunięty o różnicę prawdziwych obrazów płaszczyzny i tła × udział prawdziwego obrazu
 * (out.realW) — przy β → 0 kotwica = prawdziwy środek ciała w płaszczyźnie gry (rzecz przypięta na swoim miejscu).
 */
export function writeLensAnchor(slot, L, b, size, vis) {
  const o = b.out;
  const zoom = Math.max(1e-9, num(L.zoom, 1));
  const fl = b.flat > 0 ? b.flat : zoom;
  let X = o.x;
  let Y = o.y;
  const w = clamp(num(o.realW, 1 - num(o.beta, 0)), 0, 1);
  if (w > 0 && Math.abs(fl - zoom) > 1e-12 * zoom) {
    const roll = num(L.roll, 0);
    const rc = roll ? Math.cos(roll) : 1;
    const rs = roll ? Math.sin(roll) : 0;
    const wdx = b.x - num(L.shipX, 0);
    const wdy = b.y - num(L.shipY, 0);
    const dx = rc * wdx + rs * wdy;
    const dy = -rs * wdx + rc * wdy;
    const sx = num(L.shipSx, 0);
    const sy = num(L.shipSy, 0);
    const m = 1 - fl / zoom;
    X += w * (sx * m + dx * (zoom - fl));
    Y += w * (sy * m + dy * (zoom - fl));
  }
  const aw = lensImageToWorld(L, X, Y, 0, true, _anchorWorld);
  slot.on = true;
  slot.x = aw.x;
  slot.y = aw.y;
  slot.k = b.r > 0 ? Math.max(0, num(size, 0)) / (fl * b.r) : 1;
  slot.rx = b.x;
  slot.ry = b.y;
  slot.px = Math.max(0, num(size, 0));
  slot.real = 1 - clamp(num(o.beta, 0), 0, 1);
  slot.vis = !!vis;
  return slot;
}

/**
 * Koło w płaszczyźnie gry (środek wx, wy, promień r [j.]) dotyka kadru soczewki tej klatki (L — WARP_WORLD_LENS: kamera
 * bez wstrząsu, obrót kadru, bufor W × H, zoom). Rzecz przypięta sprawdza swój obraz (ciało może być już za kadrem).
 */
export function lensWorldInFrame(L, wx, wy, r) {
  const zoom = Math.max(1e-9, num(L.zoom, 1));
  const roll = num(L.roll, 0);
  const ux = (wx - num(L.camX, 0)) * zoom;
  const uy = (wy - num(L.camY, 0)) * zoom;
  const c = roll ? Math.cos(roll) : 1;
  const s = roll ? Math.sin(roll) : 0;
  return lensDiscInFrame(c * ux + s * uy, -s * ux + c * uy, Math.max(0, num(r, 0)) * zoom, Math.max(1, num(L.W, 1)), Math.max(1, num(L.H, 1)));
}

/** Rzecz przypięta: punkt płaszczyzny gry (px, py) → obraz w soczewce (out.x, out.y) [świat gry]; out.k — skala. */
export function lensAnchorPoint(slot, px, py, out) {
  const k = slot.k;
  out.x = slot.x + k * (px - slot.rx);
  out.y = slot.y + k * (py - slot.ry);
  out.k = k;
  return out;
}

/**
 * Macierz soczewki dla rzeczy z ramką w `root.matrix` (budowle: doki, baza piratów) — punkt sceny p → A + s · (p − C)
 * (A, C — scena: x, −y gry, z), kolumnami jak Matrix4.elements; właściciel mnoży: root.matrix = M · ramka.
 * Skala dodatnia — wyznacznik ramki bez zmiany znaku (pułapka 37: ten sam pipeline).
 */
export function lensPivotElements(ax, ay, az, s, cx, cy, cz, out) {
  out[0] = s; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = s; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = s; out[11] = 0;
  out[12] = ax - s * cx; out[13] = ay - s * cy; out[14] = az - s * cz; out[15] = 1;
  return out;
}

/**
 * REKORDY DODATKOWE SOCZEWKI — obiekty świata z własnym miejscem spoza planet3d (komety, olbrzymy pasa, Hidalgo, doki
 * portów bez ciała): rekord newLensBody w tym samym przebiegu WarpWorldLens.update co ciała (te same tryby przejścia,
 * front wyjścia, stożek za celem, kropki i próg widoczności). Właściciel (moduł obiektu) co klatkę, także poza soczewką,
 * pisze x, y [świat gry], r [j.], z (0 — płaszczyzna gry, < 0 — tło z perspektywą), `plane` i `alive = true`; planet3d
 * (applyWarpWorldLens) liczy `flat` z kadru tej klatki, dokłada rekord do przebiegu, pisze kotwicę (klucz rekordu)
 * i zeruje `alive` — właściciel odświeża go po planetach, więc położenie ma jedną klatkę zwłoki (obiekty stoją albo
 * jadą wolno). Opcjonalnie `smudge` { r, g, b, ax, ay, rot } — obraz rekordu rysuje partia smug soczewki
 * (hexShips3D: HexBodyLensBatch — elipsa ax · promień × ay · promień w barwie r, g, b), bez własnej bryły.
 */
export const WARP_LENS_EXTRA = [];

/** Rekord dodatkowy soczewki dla klucza (tworzony raz). kind — jak newLensBody ('small' bez kropki, 'planet' z kropką). */
export function warpLensExtraBody(key, kind = 'small') {
  const id = String(key || '');
  for (let i = 0; i < WARP_LENS_EXTRA.length; i++) if (WARP_LENS_EXTRA[i].id === id) return WARP_LENS_EXTRA[i];
  const rec = newLensBody(id, kind);
  rec.extra = true;
  rec.alive = false;
  rec.plane = true;
  rec.smudge = null;
  rec.anchor = warpLensAnchorSlot(id);
  WARP_LENS_EXTRA.push(rec);
  return rec;
}

/** Właściciel: rekord dodatkowy w tej klatce (miejsce, promień, głębokość). Bez alokacji. */
export function setWarpLensExtra(rec, x, y, r, z = 0) {
  rec.x = num(x, 0);
  rec.y = num(y, 0);
  rec.r = Math.max(1, num(r, 1));
  rec.z = num(z, 0);
  rec.plane = !(rec.z < 0);
  rec.alive = true;
  return rec;
}

/**
 * Właściciel zwalnia rekord dodatkowy (obiekt znika na stałe — np. budowla doku zwolniona z puli portDocks3D): rekord
 * wypada z przebiegu soczewki, jego kotwica z rejestru (rejestry nie rosną przy długiej sesji). Poza klatką.
 */
export function dropWarpLensExtra(rec) {
  if (!rec) return;
  const i = WARP_LENS_EXTRA.indexOf(rec);
  if (i >= 0) WARP_LENS_EXTRA.splice(i, 1);
  const a = rec.anchor;
  if (a) {
    a.on = false;
    const j = _anchorList.indexOf(a);
    if (j >= 0) _anchorList.splice(j, 1);
    if (WARP_LENS_ANCHORS[a.id] === a) delete WARP_LENS_ANCHORS[a.id];
  }
  rec.alive = false;
  rec.anchor = null;
}

/**
 * Nowy rekord ciała soczewki (raz na ciało; `out` wypełnia WarpWorldLens.update). kind (opcjonalnie): 'planet' —
 * kropka minDot, 'sun' — kropka i sunBoost, 'moon' / 'small' / '' — bez.
 */
export function newLensBody(id, kind = '') {
  const P = WORLD_LENS_DEFAULTS;
  const k = String(kind || '');
  return {
    id: String(id || ''),
    kind: k,
    x: 0, y: 0,      // prawdziwy środek (świat)
    r: 1,            // promień rysowanej kuli [j.]
    rExt: 0,         // [j.] promień z ringiem / pierścieniem (kieszeń kadłuba); 0 — r
    z: 0,            // głębokość passa (0 — płaszczyzna gry, −50 000 — tło perspektywy)
    flat: 1,         // px/j. prawdziwego widoku (β = 0)
    gate: 1,         // 0..1 — udział soczewki (0: prawdziwy ring tego ciała jest w kadrze)
    gateOpenSession: -1, // skok (WarpWorldLens.session), w którym bramka się otworzyła — potem zostaje otwarta
    gatePrev: 1,     // bramka w poprzedniej klatce soczewki (otwarcie bramki = nowa decyzja trybu)
    parent: null,    // rekord planety (księżyce)
    attachR: 0,      // [j.] zasięg rzeczy przypiętych (kotwica: reach) — decyzja wejścia widzi je w kadrze (_decide)
    ready: false,    // rekord odświeżony w tej klatce
    sizeBoost: k === 'sun' ? P.sunBoost : 1, // promień w soczewce × tyle (β = 1)
    minDot: k === 'sun' || k === 'planet' ? P.minDot : 0, // [px] kropka w soczewce
    entry: 0,        // tryb przejścia (WORLD_LENS_MODE: 1 — ruch, 2 — wynurzenie / zanurzenie; 0 — nieustalony)
    entrySession: -1, // przejście (WarpWorldLens._epoch), w którym tryb ustalono
    cross: -1,       // [s] wiek wyjścia, w którym front dotknął obrazu (< 0 — jeszcze nie)
    plunge: 0.3,     // [s] czas zanurzenia / powrotu w tym wyjściu (z tempa obrazu — exitMovePx / exitSizePx)
    plungeEpoch: -1, // przejście (WarpWorldLens._epoch), w którym policzono plunge
    // obraz tej klatki dla księżyców (rodzic z cięciwą kursu — księżyce jadą jego skalą, jak księżyce celu): środek,
    // skala położeń, mnożnik promienia, udział soczewki, prawdziwy środek, a punktu głębi (cięciwa), klatka soczewki
    lp: { x: 0, y: 0, qp: 0, sf: 1, bb: 0, flat: 1, realX: 0, realY: 0, ae: 0, frame: -1 },
    seenFrame: -1,   // ostatnia klatka soczewki (WarpWorldLens._frame), w której rekord był gotowy
    lateAge: -1,     // [s] wynurzenie ciała, które pojawiło się w trakcie skoku (< 0 — brak)
    pocketOn: false, // kieszeń kadłuba w tym skoku (decyzja wejścia — WORLD_LENS_DEFAULTS.pocket)
    pocketSession: -1, // skok (WarpWorldLens.session), w którym ustalono pocketOn
    chordOn: false,  // skala cięciwy kursu w tym skoku (decyzja wejścia — WORLD_LENS_DEFAULTS.chord; statek nad ciałem już
                     // przy wejściu — false)
    chordSession: -1, // skok, w którym ustalono chordOn
    chordAheadOn: false, // przy decyzji cięciwy cała przed statkiem (przelot nad ciałem dopiero będzie — księżyce jadą jego skalą)
    rigidOn: false,  // księżyc jedzie skalą rodzica z cięciwą kursu przed statkiem (decyzja raz na skok — rigidSession;
                     // za cięciwą płynnie własna mapa — WORLD_LENS_DEFAULTS.moonRigidFade)
    rigidSession: -1,
    // realW — udział prawdziwego obrazu w położeniu (ruch: 1 − β ciała; wynurzenie: 1 przy β ≤ emerge0, potem 0) —
    // kotwica rzeczy przypiętych do ciała tła (writeLensAnchor: paralaksa płaszczyzna ↔ tło)
    out: { x: 0, y: 0, size: 0, beta: 0, ax: 1, ay: 0, angle: 0, isTarget: false, q: 0, realW: 1 }
  };
}

/** Dawna reguła wejścia (2026-10-08) — dziś tryby przejścia (WORLD_LENS_MODE); zostaje dla zgodności importów. */
export const WORLD_LENS_ENTRY = Object.freeze({
  aheadCos: 0.5
});

/**
 * Tarcza (px od środka kadru, y w dół) w kadrze W × H — koło ∩ prostokąt (nie prostokąt otaczający: ogromna tarcza
 * po skosie „wchodziła” do kadru samym rogiem pudła).
 */
export function lensDiscInFrame(x, y, r, W, H) {
  const ex = Math.max(0, Math.abs(x) - W * 0.5);
  const ey = Math.max(0, Math.abs(y) - H * 0.5);
  return ex * ex + ey * ey < r * r;
}

/**
 * Widok ciał w klatce: dla każdego rekordu środek na ekranie [px od środka kadru, y w dół], promień [px], udział
 * soczewki i obrót przelotu. Bez alokacji.
 */
export class WarpWorldLens {
  constructor(params = {}) {
    this.params = { ...WORLD_LENS_DEFAULTS, ...params };
    this.lensScale = 0;   // dawne pole (mapa O1 nie ma jednej skali soczewki)
    this.session = 0;     // numer skoku (bramka ringu planet3d.assets.js: gateOpenSession)
    this._epoch = 0;      // numer przejścia (wejście / wyjście) — tryb ciała ustalany raz na przejście
    this._frame = 0;      // licznik klatek soczewki (rekord: seenFrame)
    this._sessionFrames = 0; // klatki od resetu (ciało, którego nie było w poprzedniej klatce — wynurzenie)
    this._exitOn = false;
    this._betaAtExit = 1;
    this._F = newWarpLensFrame();
    this._q = { q: 0, a: 0, l: 0, ae: 0, d: 0, sb: 0, A: 0, kappa: 1, w: 1, hide: 1 };
    this._turn = { ax: 1, ay: 0, angle: 0 };
    // Przylot: czas zbieżności kamery [s], czas puszczania [s] (< 0 — trzyma, Infinity — cięcie), poprzednia odległość
    // celu, wiek wyjścia przy zatrzymaniu.
    this._arr = { conv: 0, releaseT: -1, prevD: NaN, stopT: -1 };
    // Cel tej klatki (dla księżyców celu): obraz, skala położeń qp, mnożnik promienia sf, udział, prawdziwy obraz.
    this._tg = { on: false, x: 0, y: 0, qp: 0, sf: 1, bb: 0, flat: 1, realX: 0, realY: 0, aMax: Infinity, qT: 0 };
    // Wynik ostatniego _full: pełna skala (β = 1, z kieszenią i podglądem celu) i jej stosunek do mapy.
    this._Qfull = 0;
    this._gfac = 1;
    this._hideFull = 1;   // ukrycie za płaszczyzną kamery przy β = 1 (wynurzenie / zanurzenie w miejscu, decyzja wejścia)
    this._fa = 0;         // a i d ciała z ostatniego _full (stożek za celem)
    this._fd = 0;
    this._chordAheadNow = false; // ostatni _full: cięciwa kursu cała przed statkiem (decyzja wejścia: bez kieszeni)
    this._chordUseNow = false; // ostatni _full: cięciwa przed albo za statkiem (decyzja wejścia: skala cięciwy)
    this._chordR = 0;     // ostatni _full: promień cięciwy kursu w użyciu (0 — skala środka) — ten sam w _place
    this._realIn = false; // ostatni _decide: prawdziwy obraz (z rzeczami przypiętymi) w kadrze
    this._sf = 1;         // mnożnik promienia ostatniego _place (księżyce celu)
    // Wejścia klatki (bez alokacji w update).
    this._L = {
      zoom: 1, W: 1, H: 1, sx: 0, sy: 0, ax: 0, ay: 0, sdx: 0, sdy: 0, pa: 1, pb: 1, fill: 0.75, dt: 0,
      exiting: false, exitAge: -1, exitHalt: 0, zoomRef: NaN, zoomJump: NaN, floorW: 0
    };
    // Punkty (mapPoint — floty, NPC, wraki): stan ostatniego update (statek, obrót kadru, β, koniec zwolnienia).
    this.live = false;
    this._pt = { shipX: 0, shipY: 0, rc: 1, rs: 0, beta: 0, exitSlow: 0 };
    this._qp = { q: 0, a: 0, l: 0, ae: 0, d: 0, sb: 0, A: 0, kappa: 1, w: 1, hide: 1 };
  }

  /** Koniec skoku (soczewka wyłączona): tryby ciał i trzymanie celu od nowa. */
  reset() {
    this.session++;
    this._epoch++;
    this._sessionFrames = 0;
    this._exitOn = false;
    this.live = false;
    this._arrivalReset();
  }

  /**
   * PUNKT w soczewce tej klatki (E2: floty, NPC, wraki — bez stanu i bez trybów przejścia): świat gry (wx, wy), promień
   * `r` [j.] (brzeg kadłuba — tylko w wyjściu) → obraz out.x, out.y [px bufora od środka kadru, osie ekranu], out.q
   * [px/j.], out.beta — udział soczewki punktu (src/render/warpLensPhase.js: warpLensPointBeta — ta sama funkcja decyduje
   * o kropce na stronie gry), out.alpha — krycie kropki. Ta sama mapa O1 co ciała (rodzina q_β ruchu, kotwica P0(β))
   * w płaszczyźnie gry (flat = zoom). WYJŚCIE (P3 jak ciała): front smug gwiazd mija prawdziwe miejsce punktu
   * (warpExitFrontCross, j. świata), punkt wraca na nie w `submerge` s (rodzina q_β, β = b0 · zanurzenie); prawdziwe
   * miejsce poza kadrem (o pointEdgeSoft px) — kropka gaśnie w pierwszej połowie zanurzenia, więc nie przelatuje przez
   * kadr; w kadrze dojeżdża widoczna (kropka na prawdziwym miejscu oddaje je skórze przy WARP_LENS_DOT_SWAP). Za
   * płaszczyzną kamery (O1-2) krycie × ukrycie mapy — kropka gaśnie jak promień ciał. Przed update tej klatki albo poza
   * soczewką (`live` = false) — prawdziwy obraz. Bez alokacji.
   */
  mapPoint(wx, wy, out, r = 0) {
    const L = this._L;
    const P = this._pt;
    const wdx = num(wx, 0) - P.shipX;
    const wdy = num(wy, 0) - P.shipY;
    const dx = P.rc * wdx + P.rs * wdy;
    const dy = -P.rs * wdx + P.rc * wdy;
    const zoom = L.zoom;
    out.alpha = 1;
    if (!this.live) {
      out.x = L.sx + zoom * dx;
      out.y = L.sy + zoom * dy;
      out.q = zoom;
      out.beta = 0;
      return out;
    }
    const F = this._F;
    let bb = P.beta;
    let bDot = bb;
    if (L.exiting) {
      const sub = warpBodySubmerge(warpExitFrontCross(dx * F.cu + dy * F.cv, P.exitSlow), L.exitAge, WARP_LENS_PHASE);
      bDot = P.beta * sub;
      bb = bDot;
      if (sub < 1) {
        // prawdziwe miejsce względem kadru (brzeg kadłuba poza kadrem o e px → w = 0): w kadrze kropka jedzie na nie
        // widoczna; poza kadrem stoi w obrazie soczewki, póki gaśnie (zanurzenie 1 → 0,5), potem jedzie niewidoczna
        // (koniec zawsze na prawdziwym miejscu — przy częściowym w kropka i tak kończy poza kadrem)
        const ex = Math.max(0, Math.abs(L.sx + zoom * dx) - L.W * 0.5);
        const ey = Math.max(0, Math.abs(L.sy + zoom * dy) - L.H * 0.5);
        const e = Math.sqrt(ex * ex + ey * ey) - Math.max(0, num(r, 0)) * zoom;
        const w = 1 - smoothstep(0, Math.max(1, this.params.pointEdgeSoft), e);
        const hold = sub >= 0.5 ? 1 : sub * 2;
        bb = P.beta * (w * sub + (1 - w) * hold);
        out.alpha = w + (1 - w) * smoothstep(0.5, 1, sub);
      }
    }
    const m = warpLensQ(dx, dy, bb, zoom, F, this._qp);
    const ax = L.sx + (L.ax - L.sx) * bb;
    const ay = L.sy + (L.ay - L.sy) * bb;
    out.x = ax + m.q * dx;
    out.y = ay + m.q * dy;
    out.q = m.q;
    if (m.hide < 1) out.alpha *= m.hide;
    // udział soczewki DECYZJI kropki (strona gry: warpLensDotFor — ta sama wartość); położenie może zostać w obrazie
    out.beta = bDot;
    return out;
  }

  _arrivalReset() {
    const A = this._arr;
    A.conv = 0;
    A.releaseT = -1;
    A.prevD = NaN;
    A.stopT = -1;
  }

  /**
   * Pełna skala ciała (β = 1) [px/j.]: mapa O1 w punkcie cięciwy kursu (przelot nad ciałem — warpLensChordAlong; ciało obok
   * osi kursu — środek); cel — skala środka i miękkie maksimum z podglądem kadru przylotu (skala OBRAZU celu przy zoomie
   * kadru przylotu kamery: planety tła z perspektywą i paralaksą, miękkie minimum z kadrem skoku — warpArrivalScale), po
   * zatrzymaniu rampy — nie mniej niż prawdziwy obraz (podłoga L.floorW). Kieszeń kadłuba — tylko ciało blisko statku
   * na starcie (b.pocketOn — decyzja wejścia w _mode).
   * Ustawia this._Qfull, this._gfac (Q / q mapy) i this._hideFull (ukrycie za płaszczyzną kamery przy β = 1; cel —
   * zawsze 1); this._q — wielkości mapy (a, l, ae, A, κ, w).
   */
  _full(b, dx, dy, isTarget, F, L) {
    const p = this.params;
    const rExt = Math.max(b.r, num(b.rExt, 0));
    // Cięciwa kursu (oś kursu przechodzi przez ciało z ringiem): decyzja wejścia (_mode, raz na skok — b.chordOn). Cięciwa
    // przed statkiem (przelot nad ciałem dopiero będzie) albo za nim (przeleciał / planeta startu na osi kursu za rufą —
    // wylot dołem jak po przelocie) — skala cięciwy; statek NAD ciałem już przy wejściu (start w doku bez ciała — rekord
    // dodatkowy z promieniem doku) — skala środka i kieszeń jak dotąd (prawdziwy obraz pod statkiem, bez kurczenia
    // w ładowaniu). Kieszeń wyłącza tylko cięciwa przed statkiem.
    const ca = dx * F.cu + dy * F.cv;
    const cl = -dx * F.cv + dy * F.cu;
    const h2 = rExt * rExt - cl * cl;
    const hh = h2 > 0 ? Math.sqrt(h2) : 0;
    this._chordAheadNow = !isTarget && h2 > 0 && ca - hh > 0;
    this._chordUseNow = !isTarget && h2 > 0 && (ca - hh > 0 || ca + hh < 0);
    const chordOn = !isTarget && (b.chordSession === this.session ? b.chordOn : this._chordUseNow);
    this._chordR = chordOn ? rExt : 0;
    const m = warpLensQ(dx, dy, 1, b.flat, F, this._q, this._chordR);
    let Q = m.q;
    const d = m.d;
    // Kieszeń kadłuba (tylko ciało blisko statku na starcie — WORLD_LENS_DEFAULTS.pocket, b.pocketOn): odstęp tarczy
    // (z ringiem) od statku ≥ elipsa kadłuba + edgeGap (statek względem kotwicy wliczony). Najwyżej do skali prawdziwego
    // obrazu: bliżej brzegu ringu (d → rExt) żadna skala nie odsunie tarczy, a statek wewnątrz promienia z ringiem — wtedy
    // obraz w soczewce nie mniejszy niż prawdziwy (ciągle przy d = rExt). Cel — nigdy: jego bliski brzeg trzyma kadr
    // przylotu (z_v), kieszeń zawyżałaby skalę i kamera nie zbiegałaby z celem.
    if (p.pocket > 0 && !isTarget && b.pocketOn && b.pocketSession === this.session && d > 1e-9) {
      const ux = dx / d;
      const uy = dy / d;
      const ua = (ux * F.cu + uy * F.cv) / L.pa;
      const ul = (-ux * F.cv + uy * F.cu) / L.pb;
      const pk = 1 / Math.sqrt(ua * ua + ul * ul);
      const delta = Math.max(0, L.sdx * ux + L.sdy * uy);
      const room = d - rExt;
      const cap = Math.max(m.q, b.flat > 0 ? b.flat : m.q);
      const qMin = room > 1e-6 ? Math.min((pk + delta) / room, cap) : cap;
      Q = softMaxCompact(Q, qMin, Math.max(1e-3, p.pocketSoft / Math.max(1, pk)));
    }
    if (isTarget) {
      const ts = Math.max(1e-6, p.targetSoft);
      // Głębokość celu / ogniskowa [j./px] z prawdziwej skali (flat = zoom / (1 + k · zoom)); płaszczyzna gry — 0.
      const fl = b.flat;
      const k = b.z !== 0 && fl > 0 ? Math.max(0, 1 / fl - 1 / L.zoom) : 0;
      const zv = warpArrivalScale(F.ef, d - b.r, L.fill, k, F.ec, L.zoomRef);
      Q = softMaxLog(Q, zv, ts);
      // Podłoga po zatrzymaniu rampy (kamera przybliża ponad podgląd — np. powrót do zoomu gracza): cel jedzie z prawdziwym
      // obrazem, puszczenie bez skoku. Wchodzi od Q · e^−w (tam dokładnie Q) do prawdziwej skali w arrivalFloorTime s;
      // szerokość w = arrivalConvLog — przy zbieżnej kamerze cel rośnie najwyżej o e^(w/4) ≈ 1,3%.
      if (L.floorW > 0 && fl > 0) {
        const w = Math.max(1e-6, p.arrivalConvLog);
        const q0 = Q * Math.exp(-w);
        if (fl > q0) Q = softMaxCompact(Q, Math.exp(Math.log(q0) + L.floorW * Math.log(fl / q0)), w);
      }
    }
    this._Qfull = Q;
    this._gfac = Q / m.q;
    this._hideFull = isTarget ? 1 : m.hide;
    this._fa = m.a;
    this._fd = d;
    return Q;
  }

  /**
   * Tryb przejścia ciała (raz na przejście; przy wejściu — ustalany jeszcze, póki udział soczewki < ENTRY_DECIDE_BB:
   * wtedy oba tryby wyglądają tak samo — ruch to prawdziwy obraz, wynurzenie to promień 0 — więc zmiana jest niewidoczna,
   * a decyzja zapada w chwili, gdy ciało naprawdę zaczyna przejście, np. przy otwarciu bramki ringu).
   */
  _decide(b, isTarget, isOrigin, Q, dx, dy, L) {
    const p = this.params;
    const fl = b.flat;
    const mb = fl / L.zoom;
    const X = L.sx * mb + dx * fl;
    const Y = L.sy * mb + dy * fl;
    // Rzeczy przypięte do ciała (stacja, dok — kotwica: reach) w kadrze liczą się jak ciało w kadrze: tryb ruchu, obraz
    // ciała zbiega z prawdziwym przy β → 0 (wynurzenie przestawiłoby dok pod statkiem w klatce emerge0).
    const R = Math.max(b.r, num(b.attachR, 0)) * fl;
    let realIn = lensDiscInFrame(X, Y, R, L.W, L.H);
    this._realIn = realIn;
    if (L.exiting) return isTarget || realIn ? MOVE : FAR;
    // Ładowanie oddala kamerę do kadru skoku (zoomJump): prawdziwy obraz, który wejdzie w kadr po oddaleniu, też „w kadrze”
    // (inaczej wynurzenie pokazałoby go prawdziwego przy β ≤ emerge0 i zgasiło przy emerge0). Kamera stoi — obraz
    // skaluje się wokół środka kadru (płaszczyzna: zoomJump / zoom, tło: skala perspektywy przy zoomJump / flat).
    if (!realIn && L.zoomJump > 0 && L.zoomJump < L.zoom && fl > 0) {
      const k = b.z !== 0 ? Math.max(0, 1 / fl - 1 / L.zoom) : 0;
      const s = L.zoomJump / (1 + k * L.zoomJump) / fl;
      realIn = lensDiscInFrame(X * s, Y * s, R * s, L.W, L.H);
      this._realIn = realIn;
    }
    // Bramka ringu zamknięta (prawdziwy ring z portem w kadrze) — ruch: przy β · bramka → 0 dokładnie prawdziwy obraz
    // (ring jedzie w slocie za obrazem planety). Pierwsza klatka otwarcia ustala tryb od nowa (ring jest już za kadrem).
    if (!(b.gate > GATE_CLOSED) || realIn || (isOrigin && p.originMove)) return MOVE;
    // Za płaszczyzną kamery (O1-2: obraz soczewki w paśmie ukrycia, prawdziwy poza kadrem) — wynurzenie w miejscu, czyli
    // niewidoczne przez całe przejście (ruch rodziną q_β przy w → 1 / kMax mógłby przeciągnąć tarczę przez kadr).
    if (!isTarget && this._hideFull < 1) return FAR;
    // Ruch tylko dla obrazów bliskich prawdziwemu (farRatio) i takich, których obraz wjeżdża w kadr wolno: przy wejściu
    // brzegu w kadr (podobieństwo wokół kotwicy) środek jedzie ≈ krawędź · d / (d − r) · ln(flat / Q) · β' — duża bliska
    // tarcza (planeta startu z ringiem: × 2,9 · 2,4) przekracza próg P4 — wynurza się w miejscu.
    const ratio = fl / Math.max(1e-12, Q);
    const d = Math.sqrt(dx * dx + dy * dy);
    const near = d > b.r * 1.0001 ? d / (d - b.r) : Infinity;
    return ratio <= p.farRatio && near * Math.log(Math.max(1, ratio)) <= p.moveLog ? MOVE : FAR;
  }

  /**
   * Tryb ciała w tej klatce (pisze b.entry, b.entrySession, b.cross, b.seenFrame, b.lateAge). Nowe przejście (wejście /
   * wyjście) — decyzja od nowa; ciała nie było w poprzedniej klatce skoku (bryła gotowa później) — wynurza się w miejscu
   * w lateTime s; wyjście w trakcie kopu (β wyjścia < 1) — tryby z wejścia zostają (przestawienie ruch ↔ wynurzenie przy
   * β < 1 to skok położenia).
   */
  _mode(b, isTarget, isOrigin, Q, dx, dy, bb, open, L) {
    const exiting = L.exiting;
    const fresh = b.entrySession !== this._epoch;
    const appear = !exiting && this._sessionFrames > 0 && b.seenFrame !== this._frame - 1 && bb >= ENTRY_DECIDE_BB;
    if (appear) {
      b.entrySession = this._epoch;
      b.cross = -1;
      b.entry = FAR;
      b.lateAge = 0;
      b.pocketOn = false;
      b.chordOn = this._chordUseNow;
      b.chordAheadOn = this._chordAheadNow;
      b.pocketSession = b.chordSession = this.session;
    } else if (fresh || (!exiting && (bb < ENTRY_DECIDE_BB || open))) {
      b.entrySession = this._epoch;
      b.cross = -1;
      const keep = exiting && fresh && this._betaAtExit < 1 - 1e-6 && b.entry !== 0;
      this._realIn = false;
      if (!keep) b.entry = this._decide(b, isTarget, isOrigin, Q, dx, dy, L);
      if (!exiting || b.chordSession !== this.session) {
        // Decyzje wejścia (zostają na wyjście): cięciwa kursu przed albo za statkiem — skala cięciwy (przelot nad ciałem);
        // kieszeń kadłuba — ciało ruchem z prawdziwym obrazem w kadrze na starcie, bez cięciwy przed statkiem
        // (WORLD_LENS_DEFAULTS.pocket). Zmiana przy udziale soczewki < ENTRY_DECIDE_BB (obraz ≈ prawdziwy) — niewidoczna;
        // tę samą cięciwę _full tej klatki już wziął (b.chordSession ≠ skok → _chordUseNow).
        b.chordOn = this._chordUseNow;
        b.chordAheadOn = this._chordAheadNow;
        b.pocketOn = !exiting && !isTarget && b.entry === MOVE && this._realIn && !this._chordAheadNow;
        b.pocketSession = b.chordSession = this.session;
      }
      if (!exiting && this._sessionFrames === 0) b.lateAge = -1;
    }
    b.seenFrame = this._frame;
    if (b.lateAge >= 0) {
      b.lateAge += L.dt;
      if (b.lateAge >= this.params.lateTime) b.lateAge = -1;
    }
  }

  /**
   * Obraz ciała przy udziale soczewki bb (pełna skala już w this._Qfull). Pisze b.out.x / y / size, zwraca skalę
   * położeń (px/j.) — dla księżyców celu (this._tg).
   */
  _place(b, dx, dy, bb, isTarget, F, L) {
    const p = this.params;
    const out = b.out;
    const fl = b.flat;
    const Q = this._Qfull;
    const boost = num(b.sizeBoost, 1) > 0 ? Number(b.sizeBoost) : 1;
    const dot = Math.max(0, num(b.minDot, 0));
    let size;
    let qp;
    let sf = 1;
    out.realW = b.entry === FAR ? (bb <= p.emerge0 ? 1 : 0) : 1 - (bb > 1 ? 1 : (bb > 0 ? bb : 0));
    if (b.entry === FAR && bb <= p.emerge0) {
      // Wynurzenie przed startem / po zanurzeniu (promień w soczewce byłby 0): DOKŁADNIE prawdziwy obraz (poza kadrem —
      // tryb FAR wybiera się tylko wtedy), więc β → 0 = prawdziwy widok, a smugi słońca i ring liczą się z prawdziwego.
      const mb = fl / L.zoom;
      out.x = L.sx * mb + fl * dx;
      out.y = L.sy * mb + fl * dy;
      size = fl * b.r;
      qp = fl;
    } else if (b.entry === FAR) {
      // Wynurzenie / zanurzenie w miejscu obrazu soczewki (od kotwicy kadru — świat stoi jak gwiazdy); ciało nowe w skoku
      // (lateAge) — dodatkowo wynurza się w lateTime s.
      const k = 1 + p.emergeLift * (1 - bb);
      out.x = L.ax + k * Q * dx;
      out.y = L.ay + k * Q * dy;
      const full = Math.max(Q * b.r * boost, dot) * this._hideFull;
      let e = smoothstep(p.emerge0, p.emerge1, bb);
      if (b.lateAge >= 0) e *= smoothstep(0, Math.max(1e-3, p.lateTime), b.lateAge);
      size = full * e;
      qp = k * Q;
      sf = b.r > 0 ? size / (b.r * qp) : 1;
    } else {
      // Ruch: rodzina q_β (cel — log-lerp skali celu), kotwica P0(β), planety tła × (flat / zoom)^(1−β); głębia w punkcie
      // cięciwy kursu jak w _full (przelot nad ciałem).
      let q;
      if (isTarget) q = bb >= 1 ? Q : (bb <= 0 ? fl : Math.exp((1 - bb) * Math.log(fl) + bb * Math.log(Q)));
      else {
        warpLensQ(dx, dy, bb, fl, F, this._q, this._chordR);
        q = this._q.q * (this._gfac === 1 || bb <= 0 ? 1 : Math.pow(this._gfac, bb));
      }
      const ax = L.sx + (L.ax - L.sx) * bb;
      const ay = L.sy + (L.ay - L.sy) * bb;
      const mb = fl === L.zoom || bb >= 1 ? 1 : Math.pow(fl / L.zoom, 1 - bb);
      out.x = ax * mb + q * dx;
      out.y = ay * mb + q * dy;
      size = q * b.r * (boost === 1 || bb <= 0 ? 1 : Math.pow(boost, bb));
      if (dot > 0 && size < dot * bb) size = dot * bb;
      // za płaszczyzną kamery (O1-2) promień gaśnie — także kropka (ciało niewidoczne, obraz i tak daleko za kadrem)
      if (!isTarget && this._q.hide < 1) size *= this._q.hide;
      qp = q;
      sf = b.r > 0 && q > 0 ? size / (b.r * q) : 1;
    }
    out.size = size;
    out.q = qp;
    this._sf = sf;
    return qp;
  }

  /** Obraz < minPx gaśnie (z udziałem soczewki — β → 0 zostaje prawdziwy). */
  _fadeTiny(out, bb) {
    const mp = this.params.minPx;
    if (!(mp > 0) || !(bb > 0) || out.size >= mp) return;
    out.size *= 1 - bb * (1 - smoothstep(mp * (2 / 3), mp, out.size));
  }

  /**
   * WYJŚCIE (recenzja O1 ust. 3): czas zanurzenia / powrotu ciała [s] — raz na wyjście, w pierwszej klatce wyjścia
   * (tryb już ustalony, pełna skala w this._Qfull). Przebieg obrazu przy β = b0 · (1 − smoothstep(x)), x 0 → 1, próbkowany
   * w PLUNGE_N krokach (ten sam _place co klatka): najszybszy krok środka i promienia w kadrze (tarcza ≥ minPx) → czas,
   * przy którym tempo na klatkę 60 Hz nie przekracza exitMovePx / exitSizePx (× wysokość kadru / 1080). Wynik w
   * [WARP_LENS_PHASE.submerge, span] (span — okno wyjścia: exitSlow + submerge). Pisze b.out (nadpisuje go _place klatki).
   */
  _plungeTime(b, dx, dy, b0, F, L, span) {
    const p = this.params;
    const sub0 = WARP_LENS_PHASE.submerge;
    if (!(b0 > 0) || !(span > sub0)) return sub0;
    const k = Math.max(1e-6, L.H / 1080) * 60;
    const limM = Math.max(1, p.exitMovePx) * k;
    const limR = Math.max(1, p.exitSizePx) * k;
    const mp = Math.max(0, p.minPx);
    const out = b.out;
    let need = 0;
    let px = 0;
    let py = 0;
    let pr = 0;
    let pin = false;
    for (let i = 0; i <= PLUNGE_N; i++) {
      const x = i / PLUNGE_N;
      this._place(b, dx, dy, b0 * (1 - x * x * (3 - 2 * x)), false, F, L);
      const inF = out.size >= mp && lensDiscInFrame(out.x, out.y, out.size, L.W, L.H);
      // (jak P4: tarcza w kadrze w obu próbkach — przy β ≤ emerge0 wynurzenie przeskakuje na prawdziwy obraz poza kadrem
      // z promieniem ~0, tego nie widać)
      if (i > 0 && inF && pin) {
        // dX/dx ≈ Δ · N; tempo [px/s] przy czasie T: Δ · N / T ≤ lim → T ≥ Δ · N / lim
        const mv = Math.sqrt((out.x - px) * (out.x - px) + (out.y - py) * (out.y - py)) * PLUNGE_N / limM;
        const sz = Math.abs(out.size - pr) * PLUNGE_N / limR;
        if (mv > need) need = mv;
        if (sz > need) need = sz;
      }
      px = out.x;
      py = out.y;
      pr = out.size;
      pin = inF;
    }
    return clamp(need, sub0, span);
  }

  /**
   * PRZYLOT (T2): β celu przy wyjściu. 1, dopóki skala prawdziwego obrazu celu (flat — zoom kamery w głębokości celu) nie
   * zbiegnie z q_T (po rampie, przez arrivalConvTime s czasu gry) albo do zatrzymania + zapas (ctx.arriving === false; bez
   * pola — po arrivalSlideFallback s ślizgu); potem puszczenie w arrivalRelease s. Cięcie (prawdziwa odległość celu
   * skoczyła o więcej niż 2 kadry) — 0 od razu.
   */
  _arrivalHold(target, d, qT, ctx, L) {
    const p = this.params;
    const A = this._arr;
    if (A.releaseT === Infinity) return 0;
    const fl = Math.max(1e-12, num(target.flat, L.zoom));
    if (Number.isFinite(A.prevD) && Math.abs(d - A.prevD) * fl > 2 * Math.max(L.W, L.H)) {
      A.releaseT = Infinity;
      A.prevD = d;
      return 0;
    }
    A.prevD = d;
    const age = L.exitAge;
    const halt = L.exitHalt;
    if (age >= halt && Math.abs(Math.log(fl / Math.max(1e-12, qT))) < p.arrivalConvLog) A.conv += L.dt;
    else A.conv = 0;
    const arr = ctx.arriving;
    if (arr === true) A.stopT = -1;
    else if (age >= halt && A.stopT < 0 && (arr === false || age >= halt + p.arrivalSlideFallback)) A.stopT = age;
    if (A.releaseT < 0) {
      if ((A.conv > 0 && A.conv >= p.arrivalConvTime - 1e-9) || (A.stopT >= 0 && age - A.stopT >= p.arrivalStopGrace)
        || age > halt + p.arrivalHoldMax) A.releaseT = 0;
    } else A.releaseT += L.dt;
    return A.releaseT < 0 ? 1 : 1 - smoothstep(0, Math.max(0.05, p.arrivalRelease), A.releaseT);
  }

  /**
   * bodies — rekordy newLensBody (gotowe: `ready`), n — ile; ctx — WARP_WORLD_LENS; target — rekord ciała celu albo null;
   * visible — dawny test kadru po rulonie (mapa O1 go nie potrzebuje; zostaje w sygnaturze).
   */
  update(bodies, n, ctx, target = null, visible = lensDiscInFrame) { // visible — nieużywany (zgodność wywołań)
    const p = this.params;
    const L = this._L;
    this._frame++;
    L.zoom = Math.max(1e-6, num(ctx.zoom, 1));
    const beta = clamp(num(ctx.beta, 0), 0, 1);
    L.dt = clamp(num(ctx.dt, 0), 0, 0.1);
    L.W = Math.max(1, num(ctx.W, 1));
    L.H = Math.max(1, num(ctx.H, 1));
    // Obrót kadru (src/3d/viewRoll.js): soczewka liczy w osiach ekranu — przesunięcia ze świata R(−roll), kurs − roll;
    // obrót przelotu (flybyTurn) zostaje w osiach świata (kręci kulą w scenie).
    const roll = num(ctx.roll, 0);
    const rc = roll ? Math.cos(roll) : 1;
    const rs = roll ? Math.sin(roll) : 0;
    const course = num(ctx.velAngle, 0) - roll;
    const cu = Math.cos(course);
    const cv = Math.sin(course);
    L.sx = num(ctx.shipSx, 0);
    L.sy = num(ctx.shipSy, 0);
    L.ax = Number.isFinite(ctx.anchorSx) ? ctx.anchorSx : L.sx;
    L.ay = Number.isFinite(ctx.anchorSy) ? ctx.anchorSy : L.sy;
    L.sdx = L.sx - L.ax;
    L.sdy = L.sy - L.ay;
    L.pa = Math.max(1, num(ctx.hullHalfLen, 0)) + Math.max(0, p.edgeGap);
    L.pb = Math.max(1, num(ctx.hullHalfWid, 0)) + Math.max(0, p.edgeGap);
    L.fill = num(ctx.arrivalFill, WARP_ARRIVAL_FRAME.fill);
    L.zoomRef = num(ctx.zoomRef, NaN);
    L.zoomJump = num(ctx.zoomJump, NaN);
    const F = warpLensFrame(cu, cv, L.W * 0.5, L.H * 0.5, L.ax, L.ay, p, this._F, num(ctx.driveSpeed, NaN));
    // Wyjście: nowe przejście (tryby od nowa — poza wyjściem w trakcie kopu), front smug gwiazd, trzymanie celu.
    const exitAge = Number(ctx.exitAge);
    const exiting = exitAge >= 0;
    if (exiting !== this._exitOn) {
      this._exitOn = exiting;
      this._epoch++;
      this._betaAtExit = beta;
      this._arrivalReset();
    }
    L.exiting = exiting;
    L.exitAge = exiting ? exitAge : -1;
    L.exitHalt = Math.max(0, num(ctx.exitHalt, 0));
    L.floorW = exiting ? smoothstep(L.exitHalt, L.exitHalt + Math.max(1e-3, p.arrivalFloorTime), exitAge) : 0;
    const exitSlow = warpLensExitSlow(ctx.exitSlow);
    const exitSpan = exitSlow + WARP_LENS_PHASE.submerge;   // okno wyjścia: β osi (warpLensExitLive) do tej chwili
    const frontPx = exiting ? warpExitFrontS(exitAge, exitSlow) * L.zoom : Infinity;
    const origin = ctx.origin || null;
    const sx0 = num(ctx.shipX, 0);
    const sy0 = num(ctx.shipY, 0);
    const PT = this._pt;
    PT.shipX = sx0;
    PT.shipY = sy0;
    PT.rc = rc;
    PT.rs = rs;
    PT.beta = beta;
    PT.exitSlow = exitSlow;
    this.live = true;
    const tilt = Math.max(0, p.flybyTilt);
    const hCam = Math.max(1, p.flybyHeight);
    const coneCos0 = Math.cos(Math.max(0, p.coneDeg) * Math.PI / 180);
    const coneCos1 = Math.cos(Math.max(0, p.coneDeg - p.coneSoftDeg) * Math.PI / 180);

    // --- Cel (przed resztą: księżyce celu jadą jego skalą) ---
    const T = this._tg;
    T.on = false;
    T.aMax = Infinity;
    let targetHold = 0;
    if (target && target.ready) {
      const twx = target.x - sx0;
      const twy = target.y - sy0;
      const tdx = rc * twx + rs * twy;
      const tdy = -rs * twx + rc * twy;
      const td = Math.sqrt(tdx * tdx + tdy * tdy);
      T.aMax = tdx * cu + tdy * cv - target.r;
      const Q = this._full(target, tdx, tdy, true, F, L);
      let bT;
      if (exiting) {
        targetHold = this._arrivalHold(target, td, Q, ctx, L);
        bT = targetHold * this._betaAtExit;
      } else {
        this._arrivalReset();
        bT = beta;
      }
      bT *= clamp(num(target.gate, 1), 0, 1);
      const tOpen = target.gatePrev <= GATE_CLOSED && target.gate > GATE_CLOSED;
      target.gatePrev = num(target.gate, 1);
      this._mode(target, true, target === origin, Q, tdx, tdy, bT, tOpen, L);
      const qp = this._place(target, tdx, tdy, bT, true, F, L);
      const out = target.out;
      this._fadeTiny(out, bT);
      out.beta = bT;
      out.isTarget = true;
      out.ax = 1;
      out.ay = 0;
      out.angle = 0;
      const fl = target.flat;
      const mT = fl / L.zoom;
      T.on = true;
      T.x = out.x;
      T.y = out.y;
      T.qp = qp;
      T.sf = this._sf;
      T.bb = bT;
      T.flat = fl;
      T.realX = L.sx * mT + tdx * fl;
      T.realY = L.sy * mT + tdy * fl;
      T.qT = Q;
    } else this._arrivalReset();
    ctx.targetHold = targetHold;

    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!b || !b.ready || b === target) continue;
      const wdx = b.x - sx0;
      const wdy = b.y - sy0;
      const dx = rc * wdx + rs * wdy;
      const dy = -rs * wdx + rc * wdy;
      const out = b.out;
      out.isTarget = false;
      out.ax = 1;
      out.ay = 0;
      out.angle = 0;
      if (T.on && b.parent === target) {
        // Księżyc celu: wokół obrazu celu w jego skali; przy β → 0 dokładnie prawdziwy obraz (poprawka różnicy skal).
        const mwx = b.x - target.x;
        const mwy = b.y - target.y;
        const rx = rc * mwx + rs * mwy;
        const ry = -rs * mwx + rc * mwy;
        const fl = b.flat;
        const mM = fl / L.zoom;
        const cx = (L.sx * mM + dx * fl) - (T.realX + rx * T.flat);
        const cy = (L.sy * mM + dy * fl) - (T.realY + ry * T.flat);
        const w = 1 - T.bb;
        out.x = T.x + rx * T.qp + cx * w;
        out.y = T.y + ry * T.qp + cy * w;
        out.size = b.r * T.qp * T.sf * (fl === T.flat || w <= 0 ? 1 : Math.pow(fl / T.flat, w));
        out.q = T.qp;
        out.beta = T.bb;
        out.realW = w;
        b.entry = target.entry;
        b.seenFrame = this._frame;
        this._fadeTiny(out, T.bb);
        continue;
      }
      const P = b.parent;
      // KSIĘŻYC CIAŁA Z CIĘCIWĄ KURSU PRZED STATKIEM (przelot nad rodzicem — recenzja obrazu W2): rodzic rysuje się skalą
      // punktu cięciwy, nie środka, a księżyc swoją (mapa O1 w jego głębi) — księżyc za ringiem lądował w obrazie kuli
      // rodzica (Europa, Io, Luna; w 3D znika w tarczy i wynurza się z limbu). Póki punkt cięciwy rodzica jest przed statkiem
      // albo pod nim (podejście i przelot nad tarczą — tam skala rodzica to skala s wokół kotwicy), księżyc jedzie skalą
      // obrazu rodzica (układ planeta–księżyc podobny, jak księżyce celu); za cięciwą przechodzi płynnie (moonRigidFade · A
      // drogi punktu cięciwy) na własną mapę — tuż za cięciwą obie są blisko skali s, a dalej skala rodzica rośnie (wylot
      // dołem kadru) i księżyc w niej przeleciałby kadr ponad P4 (symulator S12). Decyzja raz na skok, w pierwszej klatce
      // księżyca w skoku (udział soczewki ~0); planeta startu za rufą — nie (S2, S4).
      if (b.rigidSession !== this.session) {
        b.rigidSession = this.session;
        b.rigidOn = !!(p.moonRigid > 0 && P && P !== origin && P.lp && P.lp.frame === this._frame
          && P.chordSession === this.session && P.chordOn && P.chordAheadOn);
      }
      let wr = 0;
      let rX = 0;
      let rY = 0;
      let rS = 0;
      let rQ = 0;
      let rB = 0;
      if (b.rigidOn && P && P.lp && P.lp.frame === this._frame) {
        const R = P.lp;
        const fade = Math.max(1, p.moonRigidFade * F.A);
        wr = R.ae >= 0 ? 1 : smoothstep(-fade, 0, R.ae);
        if (wr > 0) {
          // obraz w skali rodzica; przy β → 0 dokładnie prawdziwy obraz (poprawka różnicy skal — jak księżyce celu)
          const mwx = b.x - P.x;
          const mwy = b.y - P.y;
          const rx = rc * mwx + rs * mwy;
          const ry = -rs * mwx + rc * mwy;
          const fl = b.flat;
          const mM = fl / L.zoom;
          const w = 1 - R.bb;
          rX = R.x + rx * R.qp + ((L.sx * mM + dx * fl) - (R.realX + rx * R.flat)) * w;
          rY = R.y + ry * R.qp + ((L.sy * mM + dy * fl) - (R.realY + ry * R.flat)) * w;
          rS = b.r * R.qp * R.sf * (fl === R.flat || w <= 0 ? 1 : Math.pow(fl / R.flat, w));
          rQ = R.qp;
          rB = R.bb;
        }
      }
      const Q = this._full(b, dx, dy, false, F, L);
      let bb = beta * clamp(num(b.gate, 1), 0, 1);
      const open = b.gatePrev <= GATE_CLOSED && b.gate > GATE_CLOSED;
      b.gatePrev = num(b.gate, 1);
      this._mode(b, false, b === origin, Q, dx, dy, bb, open, L);
      if (exiting) {
        // Czas zanurzenia z tempa obrazu (raz na wyjście): ≥ submerge, duża tarcza w kadrze — dłużej (_plungeTime).
        if (b.plungeEpoch !== this._epoch) {
          b.plungeEpoch = this._epoch;
          b.plunge = this._plungeTime(b, dx, dy, bb, F, L, exitSpan);
        }
        // Front smug gwiazd (od dziobu ku rufie): dotknął obrazu soczewki — ciało zanurza się / wraca w b.plunge s; ciało
        // z dłuższym zanurzeniem zaczyna najpóźniej tak, żeby skończyć z oknem wyjścia (β osi opada wtedy do 0).
        if (b.cross < 0) {
          const lead = (L.ax + Q * dx - L.sx) * cu + (L.ay + Q * dy - L.sy) * cv + Q * b.r * num(b.sizeBoost, 1);
          if (frontPx <= lead || exitAge >= exitSlow || exitAge >= exitSpan - b.plunge) b.cross = exitAge;
        }
        if (b.cross >= 0) bb *= 1 - smoothstep(b.cross, Math.max(b.cross + 1e-3, Math.min(b.cross + b.plunge, exitSpan)), exitAge);
      }
      const fa = this._fa;
      const fd = this._fd;
      this._place(b, dx, dy, bb, false, F, L);
      // Stożek za celem (M4): zanurzenie z kątem od kursu (za bliskim brzegiem celu). Wynurzenie / zanurzenie w miejscu —
      // pełne już od emerge0 (promień i tak gaśnie z bb; iloczyn z 1 − h · bb wyskakiwał przy zanurzaniu w wyjściu).
      if (T.on && bb > 0 && fd > 1e-9 && fa > T.aMax) {
        const h = smoothstep(coneCos0, coneCos1, fa / fd) * smoothstep(0, Math.max(1, p.coneRamp), fa - T.aMax);
        if (h > 0) out.size *= 1 - h * (b.entry === FAR ? smoothstep(0, p.emerge0, bb) : bb);
      }
      this._fadeTiny(out, bb);
      out.beta = bb;
      // obraz tej klatki dla księżyców ciała z cięciwą kursu (wyżej: P.lp)
      const lp = b.lp;
      if (lp) {
        const mB = b.flat / L.zoom;
        lp.x = out.x;
        lp.y = out.y;
        lp.qp = out.q;
        lp.sf = b.r > 0 && out.q > 0 ? out.size / (b.r * out.q) : 1;
        lp.bb = bb;
        lp.flat = b.flat;
        lp.realX = L.sx * mB + dx * b.flat;
        lp.realY = L.sy * mB + dy * b.flat;
        lp.ae = this._q.ae;
        lp.frame = this._frame;
      }
      if (wr > 0) {
        // księżyc rodzica z cięciwą (wyżej): skala obrazu rodzica, za cięciwą płynnie własna mapa
        out.x += (rX - out.x) * wr;
        out.y += (rY - out.y) * wr;
        out.size += (rS - out.size) * wr;
        out.q += (rQ - out.q) * wr;
        out.beta += (rB - out.beta) * wr;
        out.realW = 1 - out.beta;
        this._fadeTiny(out, out.beta);
      }
      // Obrót przelotu (w soczewce): wirtualna kamera nad statkiem patrzy na ciało pod kątem.
      if (tilt > 0 && bb > 0.002) {
        flybyTurn(wdx, -wdy, hCam, this._turn);
        out.ax = this._turn.ax;
        out.ay = this._turn.ay;
        out.angle = this._turn.angle * tilt * bb;
      }
    }
    this._sessionFrames++;
    return n;
  }
}

/**
 * WSPÓLNA soczewka gry (jedna na wątek renderu): ciała i rekordy dodatkowe rozstawia planet3d.assets.js
 * (applyWarpWorldLens — update raz na klatkę, przed modułami rzeczy), punkty (floty, NPC, wraki) mapują moduły po nim
 * (hexShips3D: mapPoint) — te same β, kadr i kotwica tej klatki. Testy i dema tworzą własne `new WarpWorldLens()`.
 */
export const WARP_LENS_SHARED = new WarpWorldLens();
