// src/3d/skyScroll.js
//
// OBRÓT SFERY NIEBA Z DROGI STATKU (DECYZJE-2 N1, 2026-10-26). Moduł czysty (bez three, bez DOM, bez stanu gry):
// stan obrotu trzyma wołający (NebulaSystem w planet3d.assets.js — tryb `off` na stronie, worker renderu u siebie;
// te same wejścia z RenderWorld → ten sam obrót, parzystość off ≡ worker).
//
// PRAWO TEMPA (2026-10-27; użytkownik: „za słabo płynie tło, zbyt delikatnie”). Niebo to sfera w nieskończoności,
// najwolniejsza warstwa głębi; jego obraz płynie na ekranie z prędkością DROGI NIEBA vN — prędkości statku ściśniętej
// logarytmicznie powyżej kolana (walka liniowo, hipercruise i warp rozdzielone, bez sufitu):
//     vN(v)  = v                          dla v ≤ knee (5000 j/s — cała walka i dopalacz)
//            = knee · (1 + ln(v / knee))  powyżej (ciągła i gładka w kolanie): hipercruise 20 / 40 tys. → 11,9 / 15,4 tys.,
//                                         warp 100 / 175 / 250 tys. → 20,0 / 22,8 / 24,6 tys.
//            + (cruiseBoost − 1) · v · (1 − v / cruiseTo)²  dla v < cruiseTo — ZWYKŁY LOT (prośba użytkownika 2026-10-31:
//                                         „gwiazdy niech się szybciej poruszają, żeby był lepszy efekt prędkości”):
//                                         przy małej prędkości × 2,5, walka 507 j/s × 2,32, dopalacz 1137 × 2,10, 4 tys.
//                                         × 1,38, od cruiseTo (8 tys.) zero — hipercruise i warp bez zmian; rosnąca (D' ≥
//                                         0,25), ciągła i gładka. Niebo i warstwa mid jadą tą samą drogą (W0 bez zmian).
//     tempo [px bufora/s] = vN_wygł · p_ef · zoom           (zoom = px bufora na j. świata, Core3D.viewZoom)
//     p_ef                = min(p, bgCap · camZ / (camZ + bgDepth)) · mnożnik   (p 0,1; mnożnik — `?nieboTempo=<liczba>`;
//                           camZ = f / zoom — wysokość kamery perspektywy nad płaszczyzną gry, core3d.js syncCamera)
//     ω [rad/s]           = tempo / f                      (f = px bufora na radian w środku kadru, FOV 35°)
// v = droga STATKU w tej klatce / dt (nie kamery: kop warpa i wysunięcie riga nie szarpią nieba); vN_wygł — vN
// wygładzone w czasie klatek (stała `smoothTau` 0,15 s, czas z RenderWorld.frameClock): zryw prędkości (koniec rampy
// wyjścia, zderzenie) zwalnia niebo w ~0,3 s zamiast w klatce. Klatka BEZ DROGI (pauza, `worldFrozen` — gra woła render
// z dt > 0, a poza stoi) nie obraca nieba i nie rusza vN_wygł: niebo staje razem ze światem.
// SUFIT GŁĘBI (W0 wobec ciał tła): niebo leży za planetami bez ringu (z = −50 000, planet3d.assets.js) — jego paralaksa
// nie przekracza bgCap (0,75) × paralaksy tarczy planety camZ / (camZ + 50 000). Przy 16:9 w zoomie bojowym i w kadrze
// skoku sufit nie działa (0,104 / 0,17 > 0,1); działa przy 32:9 w walce (p_ef 0,056 — kątowo tyle co 16:9) i po
// przybliżeniu (16:9 od ×1,04 zoomu domyślnego): tempo nieba w px przestaje wtedy rosnąć z zoomem, jak tarcza planety
// (dopalacz 1137 j/s: ~0,9–1 °/s przy każdym zbliżeniu; A/B bez sufitu — `?nieboSufit=0`).
// Przy 1080p 16:9: walka 507 j/s — 25,1 px/s (0,84 °/s; bez członu zwykłego lotu 10,8), hipercruise Mk I 140 px/s
// (4,7 °/s), warp Mk II 267 px/s (8,9 °/s); skok Ziemia → Jowisz Mk II obraca niebo o ~110° (dawniej 23°). 32:9 1440p:
// walka 37 px/s (0,93 °/s — sufit głębi × człon zwykłego lotu), skok i warp ~1,9× 16:9 kątowo (zoom ∝ szerokość kadru).
// Człon zwykłego lotu omija sufit głębi: w walce niebo płynie ~1,7× szybciej niż tarcza planety tła (bez ringu) —
// świadomie (efekt prędkości ważniejszy; planety tła w walce rzadko są w kadrze).
// Dawne prawo (min(v, 14 000) · 0,03 · zoom, bez wygładzenia) — SKY_SCROLL_STARE, A/B `?nieboTempo=stare`.
//
// Oś obrotu = z × kierunek ruchu w osiach SCENY (X = x gry, Y = −y gry), więc obraz nieba płynie przeciw ruchowi
// statku (jak paralaksa), a obrót kadru (cam.roll — kurs w górę w skoku) obraca niebo razem ze światem. Skok położenia
// większy niż cutMul · v · dt + cutPad (teleport, cięcie, odrodzenie) nie obraca nieba (droga tej klatki = 0, niebo
// biegnie wygładzoną prędkością). Drogę okrętu liczy tropiciel (`skyTrackStep` — cięcie per okręt), obrót —
// `skyScrollMove`; wołający może zmieszać drogi kilku okrętów (sky3D.js: statek gracza i fregata zwiadu przy sterach,
// z wagą przejazdu kamery).
//
// HIERARCHIA WARSTW (DECYZJE-2 W0): na ekranie tempo rośnie z bliskością — niebo < planety tła (sufit głębi); niebo <
// mid < speed / pył (skał pasa w skoku nie ma — usunięte 2026-10-27, reguła `pas-asteroid`).
// W trybie sfery niebo ZASTĘPUJE warstwę deep GameStars (gwiazdy deep chowa materiał gwiazd, niebo niesie własne
// gwiazdy), a warstwa mid jedzie DROGĄ NIEBA (to samo vN_wygł, wejścia `driveX / driveY` stanu) z paralaksą
// STAR_MID_SPHERE 0,13–0,26 (starParallax.js) — niebo < mid z zapasem ≥ 1,26× (1,3 × skala z = −250) w każdym trybie
// i przejściu, o ile kamera nie cofa się względem statku (wtedy mid dostaje ten ruch, niebo nie — wyjątek W0
// w WYPIEK-NIEBA.md § „Niebo-sfera — prawo tempa 2026-10-27”). Warstwa speed
// zostaje na kamerze (sufit 14 tys. j/s w skoku — warpNurt.js): mid < speed, bo vN ≤ cruiseBoost · v (0,26 · 2,5 = 0,65
// < 1,02), a w skoku 0,26 · vN ≤ 7,5 tys. < 1,02 · 14 tys. Tabela tempa: `skyLayerSpeeds`, test kolejności:
// tests/skyScroll.test.mjs.
//
// Rzut w kamerze z góry: RÓWNOODLEGŁY (azymutalny) wokół środka kadru — piksel w odległości r od środka patrzy pod
// kątem r / f od osi widoku. Przy 32:9 brzegi nie płyną 2,3× szybciej niż środek (rzut gnomoniczny), smugi i tempo są
// równe w całym kadrze. Kamery 3D (free3d) rysują sferę zwykłą perspektywą.
import { STAR_PARALLAX_LAYERS, STAR_MID_SPHERE } from './starParallax.js';

const DEG = Math.PI / 180;

export const SKY_SCROLL = Object.freeze({
  p: 0.1,               // paralaksa nieba (× droga nieba vN)
  knee: 5000,           // [j/s] kolano drogi nieba: do niego vN = v, wyżej logarytm (0 — dawny sufit vCap)
  vCap: 0,              // [j/s] sufit drogi (tylko przy knee = 0 — dawne prawo)
  // Zwykły lot (2026-10-31, „lepszy efekt prędkości”): vN += (cruiseBoost − 1) · v · (1 − v / cruiseTo)² poniżej
  // cruiseTo — przy małej prędkości vN = cruiseBoost · v, od cruiseTo [j/s] prawo bez zmian (hipercruise, warp).
  // cruiseBoost ≤ ~3: rosnąca (pochodna ≥ 1 − (B − 1) / 3), mid ≤ 0,26 · B · v < speed 1,02 · v; straż W0 niżej
  // obcina wygładzone vN do 3,5 · v przy hamowaniu. 1 — bez członu.
  cruiseBoost: 2.5,
  cruiseTo: 8000,
  smoothTau: 0.15,      // [s] wygładzenie vN (0 — bez: dawne prawo, kąt z drogi tej klatki)
  // Straż W0 przy hamowaniu: vN_wygł ≤ w0Guard · min(v, starCap) / mnożnik mid (v — prędkość okrętu ze STANU, nie z drogi
  // klatki). Warstwa speed jedzie z kamerą bez wygładzenia — przy twardym hamowaniu (koniec rampy wyjścia: 16,2 → 1,5 tys.
  // j/s w 0,17 s) wygładzone niebo i mid (0,26 · vN) wyprzedzałyby najwolniejszą gwiazdę speed (1,02 · v); 3,5 =
  // 1,02 / (0,26 · 1,1) — mid ≤ 0,89 × speed. Granica jest ciągła w v, więc tempo nieba zostaje ciągłe.
  w0Guard: 3.5,
  starCap: 14000,       // [j/s] sufit kamery gwiazd w skoku (warpNurt.js STAR_SPEED_CAP) — warstwa speed w tabeli W0
  midLayer: STAR_MID_SPHERE,   // warstwa mid jedzie drogą nieba z tą paralaksą (null — dawna mid na kamerze gwiazd)
  // Sufit głębi (W0 wobec ciał tła): paralaksa nieba ≤ bgCap · camZ / (camZ + bgDepth) — niebo wolniej niż tarcza
  // planety bez ringu (planet3d.assets.js: visualZ −50 000; słońce −60 000 też wolniej: 0,75 · (camZ + 60 tys.) <
  // camZ + 50 tys.). bgCap 0 — bez sufitu (dawne prawo: p 0,03 trzymało kolejność do zoomu ×5 przy 16:9).
  bgCap: 0.75,
  bgDepth: 50000,       // [j.] głębokość planet bez ringu pod płaszczyzną gry
  starDepth: 250,       // [j.] głębokość warstw GameStars (StarSystem.layerZ) — skala ekranowa camZ / (camZ + 250)
  cutMul: 4,            // cięcie: przesunięcie > cutMul · max(v, v poprzedniej klatki) · dt + cutPad
  cutPad: 50,           // [j.]
  fovDeg: 35,           // FOV kamery z góry (core3d.js FLAT_PERSP_FOV) — f = (H/2) / tg(FOV/2)
  // Drobne gwiazdy liczone na piksel (σ_eff ≈ 0,58 px bufora) gasną, gdy obraz nieba przesuwa się o więcej niż
  // fadeFromPx → fadeToPx PIKSELI BUFORA NA KLATKĘ (`fade: 'px'`). Drobnica NIESIE ruch tła (mgławica jest gładka), więc
  // gaśnie dopiero przy skokach ≥ 6 px/kl. (~10 σ — rzadkie punkty skaczące co klatkę): 144 i 240 Hz — pełna w każdym
  // trybie i kadrze (sufit planu Mk III przy 32:9 1440p i 144 Hz: 6,0 px/kl.); 60 Hz — pełna przy 16:9 1080p, przy 4K
  // w warpie Mk II 0,52, przy 32:9 1440p w warpie Mk I / II 0,27 / 0,03. Próg 1,5 → 3,5 px/kl. (pierwsza wersja prawa)
  // gasił ją w warpie przy 60 i 144 Hz, a przy 32:9 nawet przy 240 Hz — tam, gdzie tło ma płynąć. Dawny próg kątowy
  // (2 → 4 °/s, `fade: 'deg'`) — tylko SKY_SCROLL_STARE.
  fade: 'px',
  fadeFromPx: 6,
  fadeToPx: 12,
  frameAlpha: 1 / 32,   // waga klatki w średniej okresu (po klatkach, nie po czasie — długa klatka nie przeważa)
  frameMin: 1 / 480,    // [s] granice próbki okresu klatki (zacięcie nie gasi gwiazd jedną klatką)
  frameMax: 1 / 15,
  fadeFromDeg: 2,       // [°/s] dawny próg kątowy (fade: 'deg')
  fadeToDeg: 4,
  // Wygładzenie udziału drobnych gwiazd [s] (stała czasu): krótki zryw tempa przygasza je łagodnie, bez skoku.
  fadeTau: 0.35,
  // Smuga jasnych gwiazd nieba w skoku i hipercruisie (× WARP_STARS.stretch): ruch obrazu nieba w czasie „ekspozycji”
  // streakExposure [s] (vN_wygł · p_ef · zoom · T), najwyżej streakMaxCss px CSS, NAJMNIEJ dawna smuga warstwy deep
  // (streakMul · stretchPx ≈ 16 px bufora) — w ładowaniu skoku statek stoi, a smuga rośnie z WARP_STARS.stretch
  // („zapowiedź” skoku, BRIEF-warp). 1080p 16:9: hipercruise i warp 16 px (ruch 7 / 13 px), 1440p warp Mk II 18 px,
  // 32:9 1440p 19 / 36 px. streakExposure 0 — sama dawna smuga.
  streakExposure: 0.05,
  streakMaxCss: 48,
  streakMul: 0.22,
  // Pamięć nieba: przelicz, gdy obraz przesunął się o ≥ tyle px bufora (jak NebulaSystem — SKY_CACHE_PX).
  cacheTolPx: 0.25
});

/**
 * DAWNE PRAWO (2026-10-26, A/B `?nieboTempo=stare`): tempo = min(v, 14 000) · 0,03 · zoom, kąt z drogi tej klatki (bez
 * wygładzenia), drobne gwiazdy gasną przy 2 → 4 °/s, smuga jasnych gwiazd 0,22 · stretchPx, warstwa mid GameStars na
 * kamerze gwiazd (0,055–0,18).
 */
export const SKY_SCROLL_STARE = Object.freeze({
  ...SKY_SCROLL, p: 0.03, knee: 0, vCap: 14000, smoothTau: 0, midLayer: null, fade: 'deg', streakExposure: 0, bgCap: 0,
  cruiseBoost: 1
});

/** Nowe prawo bez sufitu głębi (A/B `?nieboSufit=0`): p 0,1 przy każdym zoomie i kadrze (32:9 — 2× 16:9 kątowo). */
export const SKY_SCROLL_BEZ_SUFITU = Object.freeze({ ...SKY_SCROLL, bgCap: 0 });

/**
 * Prawo tempa z adresu strony (działa też w workerze — RenderWorld.pageSearch, jak `?niebo=plaska`):
 * `?nieboTempo=stare` → { stare: true, mul: 1 } (SKY_SCROLL_STARE); `?nieboTempo=<liczba>` → mnożnik nowego tempa
 * (0,05–10, np. 0.5, 2); brak / zła wartość → mul 1. `?nieboSufit=0` → sufit: false (nowe prawo bez sufitu głębi).
 */
export function skyTempoFrom(search) {
  const str = String(search || '');
  const m = /[?&]nieboTempo=([^&#]*)/i.exec(str);
  let raw = m ? m[1] : '';
  try { raw = decodeURIComponent(raw); } catch { /* zły zapis % — wartość jak jest */ }
  raw = raw.trim().toLowerCase();
  const sufit = !/[?&]nieboSufit=(0|nie|off|false)(?:[&#]|$)/i.test(str);
  if (raw === 'stare') return { stare: true, mul: 1, sufit };
  const n = raw ? Number(raw.replace(',', '.')) : NaN;
  if (Number.isFinite(n) && n > 0) return { stare: false, mul: Math.min(10, Math.max(0.05, n)), sufit };
  return { stare: false, mul: 1, sufit };
}

/** Strojenie prawa z wyniku skyTempoFrom. */
export function skyTempoTune(tempo) {
  if (tempo && tempo.stare) return SKY_SCROLL_STARE;
  return tempo && tempo.sufit === false ? SKY_SCROLL_BEZ_SUFITU : SKY_SCROLL;
}

/**
 * Mnożnik drogi warstwy mid (tryb sfery, nowe prawo): przy `?nieboTempo` > 1 mid przyspiesza z niebem (W0: niebo < mid),
 * przy < 1 zostaje (niebo i tak wolniejsze).
 */
export function skyMidDriveMul(mul) {
  return Math.max(1, Number(mul) || 1);
}

/** Px bufora na radian w środku kadru kamery z góry (wysokość bufora H). */
export function skyFocalPx(bufferHeight, fovDeg = SKY_SCROLL.fovDeg) {
  const h = Math.max(1, Number(bufferHeight) || 1);
  return (h * 0.5) / Math.tan(fovDeg * 0.5 * DEG);
}

/**
 * Droga nieba vN [j/s] dla prędkości v [j/s]: kolano z logarytmem (knee > 0) albo dawny sufit vCap, plus człon zwykłego
 * lotu (cruiseBoost, cruiseTo — przy małej prędkości vN = cruiseBoost · v, od cruiseTo bez członu).
 */
export function skyDriveSpeed(v, tune = SKY_SCROLL) {
  const vv = Math.max(0, Number(v) || 0);
  const k = Number(tune.knee) || 0;
  let d;
  if (k > 0) d = vv <= k ? vv : k * (1 + Math.log(vv / k));
  else d = tune.vCap > 0 ? Math.min(vv, tune.vCap) : vv;
  const b = (Number(tune.cruiseBoost) || 1) - 1;
  const to = Number(tune.cruiseTo) || 0;
  if (b > 0 && to > 0 && vv < to) {
    const r = 1 - vv / to;
    d += b * vv * r * r;
  }
  return d;
}

/**
 * Paralaksa nieba p_ef przy zoomie [px bufora/j.] i ogniskowej f [px bufora/rad]: p obcięte sufitem głębi
 * bgCap · camZ / (camZ + bgDepth), camZ = f / zoom (niebo wolniej niż tarcza planety tła), razy mnożnik `?nieboTempo`
 * (A/B mnoży całe prawo — przy mul > 1 niebo może wyprzedzić planety tła). Bez f (NaN) albo przy bgCap 0 — p · mul.
 */
export function skyParallax(zoom, f, tune = SKY_SCROLL, mul = 1) {
  const m = Math.max(0, Number(mul) || 0);
  const z = Number(zoom) || 0;
  const ff = Number(f) || 0;
  if (!(tune.bgCap > 0) || !(z > 0) || !(ff > 0)) return tune.p * m;
  const camZ = ff / z;
  return Math.min(tune.p, tune.bgCap * camZ / (camZ + tune.bgDepth)) * m;
}

/**
 * Tempo obrazu nieba [px/s] w stanie ustalonym dla prędkości v [j/s] przy zoomie [px/j.] (te same px co zoom); f — px
 * bufora na radian (skyFocalPx; bez niego bez sufitu głębi).
 */
export function skyScreenSpeed(v, zoom, tune = SKY_SCROLL, mul = 1, f = NaN) {
  return skyDriveSpeed(v, tune) * skyParallax(zoom, f, tune, mul) * Math.max(0, Number(zoom) || 0);
}

/**
 * Udział drobnych gwiazd przy prędkości kątowej nieba ω [rad/s] (1 → 0 między fadeFromDeg i fadeToDeg °/s) — dawny
 * próg (`fade: 'deg'`, SKY_SCROLL_STARE).
 */
export function skyFineStarsGain(omega, tune = SKY_SCROLL) {
  const s = (Number(omega) || 0) / DEG;
  if (s <= tune.fadeFromDeg) return 1;
  if (s >= tune.fadeToDeg) return 0;
  const t = (s - tune.fadeFromDeg) / (tune.fadeToDeg - tune.fadeFromDeg);
  return 1 - t * t * (3 - 2 * t);
}

/** Udział drobnych gwiazd przy przesuwie obrazu nieba pxFrame [px bufora / klatkę] (1 → 0 między fadeFromPx i fadeToPx). */
export function skyFineStarsGainPx(pxFrame, tune = SKY_SCROLL) {
  const s = Number(pxFrame) || 0;
  if (s <= tune.fadeFromPx) return 1;
  if (s >= tune.fadeToPx) return 0;
  const t = (s - tune.fadeFromPx) / (tune.fadeToPx - tune.fadeFromPx);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Krok wygładzonego udziału drobnych gwiazd (`s.fine`) ku progowi strojenia (`fade: 'px'` — przesuw na klatkę
 * s.speedPx · wygładzony okres klatki, `'deg'` — prędkość kątowa s.omega) ze stałą czasu fadeTau; pauza (dt = 0) — bez
 * zmian. Zwraca s.fine.
 */
export function stepSkyFineGain(s, dt, tune = SKY_SCROLL) {
  const t = Number(dt) || 0;
  if (!(t > 0)) return s.fine;
  const tc = Math.min(tune.frameMax, Math.max(tune.frameMin, t));
  s.framePeriod += (tc - s.framePeriod) * tune.frameAlpha;
  s.pxFrame = s.speedPx * s.framePeriod;
  const target = tune.fade === 'px' ? skyFineStarsGainPx(s.pxFrame, tune) : skyFineStarsGain(s.omega, tune);
  const k = 1 - Math.exp(-t / Math.max(1e-6, tune.fadeTau));
  s.fine += (target - s.fine) * k;
  if (Math.abs(target - s.fine) < 1e-3) s.fine = target;
  return s.fine;
}

/**
 * Długość smugi jasnych gwiazd nieba przy WARP_STARS.stretch = 1 [px bufora]: ruch obrazu nieba w czasie ekspozycji
 * (speedPx · streakExposure, najwyżej streakMaxCss · pxScale), nie mniej niż dawna smuga warstwy deep GameStars
 * streakMul · stretchPx (ładowanie skoku — statek stoi, smuga rośnie z WARP_STARS.stretch); przy streakExposure 0
 * (dawne prawo) — sama dawna smuga.
 */
export function skyStarStreakPx(speedPx, pxScale = 1, stretchPx = 74, tune = SKY_SCROLL) {
  const base = (Number(stretchPx) || 0) * tune.streakMul;
  if (!(tune.streakExposure > 0)) return base;
  const L = Math.max(0, Number(speedPx) || 0) * tune.streakExposure;
  return Math.max(base, Math.min(L, tune.streakMaxCss * Math.max(1e-6, Number(pxScale) || 1)));
}

// ── kwaterniony (x, y, z, w) w tablicy, bez alokacji ───────────────────────────────────────────────────────

function qNormalize(q) {
  const n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
  return q;
}

/** q ← R(oś, kąt) · q (obrót w osiach świata, oś jednostkowa). */
function qPremulAxisAngle(q, ax, ay, az, angle) {
  const h = angle * 0.5;
  const s = Math.sin(h);
  const bx = ax * s, by = ay * s, bz = az * s, bw = Math.cos(h);
  const x = q[0], y = q[1], z = q[2], w = q[3];
  q[0] = bw * x + bx * w + by * z - bz * y;
  q[1] = bw * y - bx * z + by * w + bz * x;
  q[2] = bw * z + bx * y - by * x + bz * w;
  q[3] = bw * w - bx * x - by * y - bz * z;
  return q;
}

/** Macierz obrotu kwaternionu (wierszami, 9 liczb): m[r * 3 + c]. */
export function quatToMat3(q, out) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  out[0] = 1 - 2 * (yy + zz); out[1] = 2 * (xy - wz);     out[2] = 2 * (xz + wy);
  out[3] = 2 * (xy + wz);     out[4] = 1 - 2 * (xx + zz); out[5] = 2 * (yz - wx);
  out[6] = 2 * (xz - wy);     out[7] = 2 * (yz + wx);     out[8] = 1 - 2 * (xx + yy);
  return out;
}

/** Kwaternion z macierzy obrotu (wierszami). */
export function mat3ToQuat(m, out) {
  const tr = m[0] + m[4] + m[8];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out[3] = 0.25 * s; out[0] = (m[7] - m[5]) / s; out[1] = (m[2] - m[6]) / s; out[2] = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    out[3] = (m[7] - m[5]) / s; out[0] = 0.25 * s; out[1] = (m[1] + m[3]) / s; out[2] = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    out[3] = (m[2] - m[6]) / s; out[0] = (m[1] + m[3]) / s; out[1] = 0.25 * s; out[2] = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    out[3] = (m[3] - m[1]) / s; out[0] = (m[2] + m[6]) / s; out[1] = (m[5] + m[7]) / s; out[2] = 0.25 * s;
  }
  return qNormalize(out);
}

// ── układ nieba ────────────────────────────────────────────────────────────────────────────────────────────
// Kierunek w układzie NIEBA: (cos φ cos λ, cos φ sin λ, sin φ) — λ długość, φ szerokość. Pas Drogi Mlecznej leży na
// równiku (φ = 0, wielkie koło — wypiekacz w trybie sfery, src/3d/skybake/). Tekstura equirect: u = λ / 2π + 0,5,
// v = 0,5 − φ / π (wiersz 0 = biegun północny).

/** Kierunek nieba z (λ, φ) [rad]. */
export function skyDirFromLonLat(lon, lat, out) {
  const c = Math.cos(lat);
  out[0] = c * Math.cos(lon); out[1] = c * Math.sin(lon); out[2] = Math.sin(lat);
  return out;
}

/** uv equirect kierunku nieba (lustro CPU materiału — skySphere.tsl.js: skyEquirectUv). */
export function skyEquirectUvCpu(d, out) {
  out[0] = Math.atan2(d[1], d[0]) / (2 * Math.PI) + 0.5;
  out[1] = 0.5 - Math.asin(Math.max(-1, Math.min(1, d[2]))) / Math.PI;
  return out;
}

/**
 * Orientacja startowa (świat ← niebo): oś widoku kamery z góry (−Z sceny) patrzy w punkt nieba (λ0, φ0), a pas
 * (kierunek rosnącego λ) biegnie na ekranie pod kątem `bandDeg` od poziomu (y w górę) — ten sam kadr co dawna
 * płaszczyzna tła (środek tekstury: 0,040 jednostki nieba od rdzenia pasa po stronie „−d”, 0,020 przed środkiem pasa,
 * pas pod 27° w dół w prawo, zgrubienie ~39° dalej wzdłuż pasa — poza kadrem startu). Jednostka nieba = 3,27 rad.
 */
export const SKY_START = Object.freeze({ lonDeg: -3.7, latDeg: -7.5, bandDeg: -27 });

export function skyStartQuat(out, start = SKY_START) {
  const lon = start.lonDeg * DEG, lat = start.latDeg * DEG, b = start.bandDeg * DEG;
  // Baza nieba w punkcie (λ0, φ0): e — wschód (∂λ), n — północ (∂φ), c — kierunek; e × n = c.
  const c = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const e = [-Math.sin(lon), Math.cos(lon), 0];
  const n = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  // Cel w świecie (prawoskrętnie): e → (cos b, sin b, 0), n → (sin b, −cos b, 0), c → (0, 0, −1) (widok z wnętrza sfery).
  const E = [Math.cos(b), Math.sin(b), 0];
  const N = [Math.sin(b), -Math.cos(b), 0];
  const C = [0, 0, -1];
  // R = [E N C] · [e n c]ᵀ (wierszami)
  const m = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) m[r * 3 + k] = E[r] * e[k] + N[r] * n[k] + C[r] * c[k];
  }
  return mat3ToQuat(m, out);
}

// ── stan obrotu ────────────────────────────────────────────────────────────────────────────────────────────

/** Tropiciel drogi jednego okrętu: ostatnie miejsce i prędkość, licznik cięć. */
export function createSkyTrack() {
  return { lx: 0, ly: 0, lv: 0, has: false, cuts: 0 };
}

/**
 * Droga okrętu w tej klatce → out[0], out[1] (dx, dy w osiach gry, y w dół). (x, y) — poza okrętu, v — jego prędkość
 * [j/s], dt — czas klatki renderu [s]. Zwraca długość drogi [j.]; 0 (i out = 0) — pierwsza klatka, postój, pauza albo
 * CIĘCIE: skok położenia > cutMul · max(v, v poprzedniej klatki) · dt + cutPad (teleport, odrodzenie; licznik `cuts`).
 * Poza niepoliczalna — tropiciel zapomina miejsce (następna poza = pierwsza klatka).
 */
export function skyTrackStep(tr, x, y, v, dt, out, tune = SKY_SCROLL) {
  out[0] = 0; out[1] = 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) { tr.has = false; return 0; }
  const vv = Math.max(0, Number(v) || 0);
  if (!tr.has) { tr.lx = x; tr.ly = y; tr.lv = vv; tr.has = true; return 0; }
  const dx = x - tr.lx;
  const dy = y - tr.ly;
  tr.lx = x; tr.ly = y;
  const vRef = Math.max(vv, tr.lv);
  tr.lv = vv;
  const t = Number(dt) || 0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!(t > 0) || !(d > 0)) return 0;
  if (d > tune.cutMul * vRef * t + tune.cutPad) { tr.cuts++; return 0; }
  out[0] = dx; out[1] = dy;
  return d;
}

/** Nowy stan: q (świat ← niebo, x y z w), tropiciel drogi statku, droga nieba, tempo i udział drobnych gwiazd. */
export function createSkyScroll(start = SKY_START) {
  const s = {
    q: new Float64Array(4),
    track: createSkyTrack(),   // droga statku (stepSkyScroll; sky3D.js — statek gracza)
    vDrive: 0,        // wygładzona droga nieba vN [j/s] (skyDriveSpeed + smoothTau)
    dirX: 0,          // kierunek ostatniej drogi (osie gry, y w dół) — niebo dobiega w nim przy postoju / cięciu
    dirY: 0,
    driveX: 0,        // droga nieba tej klatki [j., osie gry] = kierunek · vN_wygł · dt — warstwa mid GameStars (W0)
    driveY: 0,
    dispX: 0,         // surowa droga tej klatki [j.] (po cięciu i mieszaniu dróg) — mid odejmuje ją od ruchu kamery
    dispY: 0,
    speedPx: 0,       // tempo obrazu nieba w tej klatce [px bufora/s]
    speedCss: 0,      // to samo w px CSS (narzędzia, raport W0)
    pEff: SKY_SCROLL.p,   // paralaksa nieba ostatniej klatki z ruchem (skyParallax — p · mnożnik z sufitem głębi)
    omega: 0,         // prędkość kątowa nieba [rad/s]
    framePeriod: 1 / 60,   // wygładzony okres rysowanej klatki [s] (stepSkyFineGain)
    pxFrame: 0,       // przesuw obrazu nieba na klatkę [px bufora] (gaśnięcie drobnych gwiazd)
    fine: 1,          // wygładzony udział drobnych gwiazd (stepSkyFineGain)
    cuts: 0,          // licznik cięć (teleport)
    turned: 0         // suma kątów obrotu [rad] (narzędzia)
  };
  skyStartQuat(s.q, start);
  return s;
}

/**
 * Orientacja startowa i zapomnienie drogi (narzędzia, testy). W grze orientacji nie zapisujemy, a nowa gra przeładowuje
 * stronę (`hullfallApp.relaunch` / `location.reload`), więc start zawsze ma `SKY_START`.
 */
export function resetSkyScroll(s, start = SKY_START) {
  skyStartQuat(s.q, start);
  s.track.has = false; s.track.lv = 0;
  s.vDrive = 0; s.dirX = 0; s.dirY = 0; s.driveX = 0; s.driveY = 0; s.dispX = 0; s.dispY = 0;
  s.speedPx = 0; s.speedCss = 0; s.pEff = SKY_SCROLL.p; s.omega = 0; s.framePeriod = 1 / 60; s.pxFrame = 0; s.fine = 1;
  s.turned = 0;
  return s;
}

/**
 * Obrót nieba o drogę (dx, dy) [j., osie gry] w czasie dt [s]: zoom — px bufora na j. świata (Core3D.viewZoom), f — px
 * bufora na radian (skyFocalPx), pxScale — px bufora na px CSS, mul — mnożnik tempa (`?nieboTempo`), hold — w tej klatce
 * było cięcie (teleport): droga nieba trzyma wygładzoną prędkość zamiast spaść do zera; vNow — prędkość okrętu ze stanu
 * [j/s] dla straży W0 (w0Guard; NaN — bez straży).
 * Nowe prawo (smoothTau > 0): vN_wygł ← vN(d / dt) ze stałą smoothTau, kąt = vN_wygł · dt · p_ef · zoom / f w kierunku
 * drogi (p_ef — skyParallax: p · mul z sufitem głębi; cięcie — w ostatnim kierunku). Dawne (smoothTau 0): kąt z drogi tej
 * klatki, sufit vCap · dt.
 * Pauza (dt = 0) i klatka BEZ DROGI bez cięcia (pauza i `worldFrozen` gry — render z dt > 0 przy stojącej pozie,
 * pierwsza klatka tropiciela) — bez obrotu, vN_wygł bez zmian: niebo i mid stoją razem ze światem, a po ruszeniu
 * wygładzenie idzie dalej od tej samej prędkości. Zwraca kąt obrotu [rad].
 */
export function skyScrollMove(s, dx, dy, dt, zoom, f, pxScale = 1, tune = SKY_SCROLL, mul = 1, hold = false, vNow = NaN) {
  const t = Number(dt) || 0;
  s.dispX = 0; s.dispY = 0; s.driveX = 0; s.driveY = 0;
  if (!(t > 0)) { s.speedPx = s.speedCss = s.omega = 0; return 0; }
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!(d > 0) && !hold) {
    if (!(tune.smoothTau > 0)) s.vDrive = 0;
    s.speedPx = s.speedCss = s.omega = 0;
    return 0;
  }
  if (d > 0) { s.dispX = dx; s.dispY = dy; s.dirX = dx / d; s.dirY = dy / d; }
  let dc;
  if (tune.smoothTau > 0) {
    const target = d > 0 ? skyDriveSpeed(d / t, tune) : (hold ? s.vDrive : 0);
    s.vDrive += (target - s.vDrive) * (1 - Math.exp(-t / tune.smoothTau));
    const vg = Number(vNow);
    if (tune.w0Guard > 0 && Number.isFinite(vg)) {
      const cap = tune.w0Guard * Math.min(Math.max(0, vg), tune.starCap) / (tune.midLayer ? skyMidDriveMul(mul) : 1);
      if (s.vDrive > cap) s.vDrive = cap;
    }
    if (s.vDrive < 1e-3) s.vDrive = 0;
    dc = s.vDrive * t;
  } else {
    if (!(d > 0)) dc = 0;
    else if (tune.knee > 0) dc = skyDriveSpeed(d / t, tune) * t;
    else dc = tune.vCap > 0 ? Math.min(d, tune.vCap * t) : d;
    s.vDrive = dc / t;
  }
  if (!(dc > 0)) { s.speedPx = s.speedCss = s.omega = 0; return 0; }
  s.driveX = s.dirX * dc;
  s.driveY = s.dirY * dc;
  const z = Math.max(0, Number(zoom) || 0);
  const ff = Math.max(1e-6, Number(f) || 1);
  const pe = skyParallax(z, ff, tune, mul);
  s.pEff = pe;
  const angle = dc * pe * z / ff;
  s.speedPx = s.vDrive * pe * z;
  s.speedCss = s.speedPx / Math.max(1e-6, Number(pxScale) || 1);
  s.omega = angle / t;
  if (angle > 0) {
    // oś = Z × m, m = kierunek ruchu w osiach sceny (dirX, −dirY)
    qPremulAxisAngle(s.q, s.dirY, s.dirX, 0, angle);
    qNormalize(s.q);
    s.turned += angle;
  }
  return angle;
}

const _dStep = new Float64Array(2);

/**
 * Krok obrotu z drogi statku (tropiciel `s.track` + `skyScrollMove`). (x, y) — poza statku w świecie gry (y w dół),
 * v — prędkość statku [j/s], dt — czas klatki renderu [s], zoom, f, pxScale, tune, mul — jak w skyScrollMove. Cięcie
 * tropiciela w tej klatce → hold. Zwraca kąt [rad].
 */
export function stepSkyScroll(s, x, y, v, dt, zoom, f, pxScale = 1, tune = SKY_SCROLL, mul = 1) {
  const c0 = s.track.cuts;
  skyTrackStep(s.track, x, y, v, dt, _dStep, tune);
  s.cuts = s.track.cuts;
  return skyScrollMove(s, _dStep[0], _dStep[1], dt, zoom, f, pxScale, tune, mul, s.track.cuts !== c0, v);
}

const _qm = new Float64Array(9);

/**
 * Macierz widok → niebo (wierszami, 9 liczb): kierunek w osiach widoku kamery z góry (x w prawo, y w górę, patrzy w −z)
 * → kierunek w układzie nieba. M = Qᵀ · Rz(−roll) (kamera z góry: widok → świat = obrót o −roll wokół Z).
 */
export function skyViewMatrix(s, roll, out) {
  const q = quatToMat3(s.q, _qm);   // świat ← niebo
  const r = Number(roll) || 0;
  const c = Math.cos(r), sn = -Math.sin(r);   // Rz(−roll): [[c, −sn], [sn, c]] z sn = sin(−roll)
  // (Qᵀ)[i][k] = q[k][i]; M[i][j] = Σk Qᵀ[i][k] · Rz[k][j]
  for (let i = 0; i < 3; i++) {
    const a0 = q[0 * 3 + i], a1 = q[1 * 3 + i], a2 = q[2 * 3 + i];
    out[i * 3 + 0] = a0 * c + a1 * sn;
    out[i * 3 + 1] = -a0 * sn + a1 * c;
    out[i * 3 + 2] = a2;
  }
  return out;
}

/** Macierz świat (scena three) → niebo (wierszami): Qᵀ — kamery 3D liczą kierunek w osiach sceny. */
export function skyWorldMatrix(s, out) {
  const q = quatToMat3(s.q, _qm);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = q[k * 3 + i];
  return out;
}

/** Kąt obrotu między dwiema macierzami obrotu (wierszami) [rad]. */
export function mat3AngleBetween(a, b) {
  let tr = 0;
  for (let i = 0; i < 9; i++) tr += a[i] * b[i];
  const c = Math.max(-1, Math.min(1, (tr - 1) * 0.5));
  // przy małych kątach acos jest nieprecyzyjny — z normy różnicy (‖A − B‖F² = 8 sin²(θ/2) dla obrotów)
  if (c > 0.999) {
    let s2 = 0;
    for (let i = 0; i < 9; i++) { const d = a[i] - b[i]; s2 += d * d; }
    return 2 * Math.asin(Math.min(1, Math.sqrt(s2 / 8)));
  }
  return Math.acos(c);
}

// ── rzut równoodległy (lustro CPU materiału) ───────────────────────────────────────────────────────────────

/** Piksel (px od środka kadru, y w górę) → kierunek w osiach widoku (x, y, z; widok w −z). */
export function skyEquidistantDir(px, py, f, out) {
  const r = Math.sqrt(px * px + py * py);
  const th = r / f;
  const k = r > 1e-9 ? Math.sin(th) / r : 1 / f;
  out[0] = px * k; out[1] = py * k; out[2] = -Math.cos(th);
  return out;
}

/** Kierunek w osiach widoku → piksel (px od środka, y w górę); zwraca kąt od osi widoku. */
export function skyEquidistantPx(d, f, out) {
  const rxy = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
  const th = Math.atan2(rxy, -d[2]);
  const k = rxy > 1e-12 ? th * f / rxy : f;
  out[0] = d[0] * k; out[1] = d[1] * k;
  return th;
}

// ── hierarchia warstw (W0) ─────────────────────────────────────────────────────────────────────────────────

/**
 * Tempo warstw na ekranie [px/s] w STANIE USTALONYM przy prędkości v [j/s] i zoomie [px/j.]: niebo i zakresy warstw
 * GameStars (deep / mid / speed — min, max). Warstwy na kamerze gwiazd jadą min(v, starCap) (w walce v < starCap, w skoku
 * i hipercruisie sufit kamery gwiazd — warpNurt.js); w trybie sfery z nowym prawem (tune.midLayer) mid jedzie drogą nieba
 * vN z paralaksą midLayer × skyMidDriveMul(mul), deep jest schowana (zostaje w tabeli dla porównania). f — px bufora na
 * radian (skyFocalPx): z nim niebo ma sufit głębi (skyParallax), a warstwy GameStars (z = −250 w kamerze perspektywy)
 * skalę ekranową camZ / (camZ + 250) (0,97 w zoomie bojowym 16:9, 0,94 przy 32:9 i zoomie 0,45); bez f — bez obu.
 * Przejścia (wygładzenie vN) — tests/skyScroll.test.mjs liczy klatka po klatce na stanie skyScrollMove.
 */
export function skyLayerSpeeds(v, zoom, tune = SKY_SCROLL, mul = 1, f = NaN) {
  const z = Math.max(0, Number(zoom) || 0);
  const ff = Number(f) || 0;
  const camZ = ff > 0 && z > 0 ? ff / z : Infinity;
  const ks = Number.isFinite(camZ) ? camZ / (camZ + tune.starDepth) : 1;
  const vv = Math.min(Math.max(0, Number(v) || 0), tune.starCap);
  const drive = skyDriveSpeed(v, tune);
  const out = { sky: drive * skyParallax(z, f, tune, mul) * z };
  for (const L of STAR_PARALLAX_LAYERS) out[L.name] = [vv * L.parallaxMin * z * ks, vv * L.parallaxMax * z * ks];
  if (tune.midLayer) {
    const m = skyMidDriveMul(mul);
    out.mid = [drive * tune.midLayer.parallaxMin * z * m * ks, drive * tune.midLayer.parallaxMax * z * m * ks];
  }
  return out;
}
