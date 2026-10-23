// Osie czasu efektów warpa — docs/BRIEF-warp.md §3.4, §4.2.
//
// Przylot (wyjście z warpa): zwiastun → rozdarcie → wyrzut → zamknięcie →
// stygnięcie. Czysty moduł: bez DOM i three.js (testy w node). Render
// (src/3d/warpFx3D.js) tylko próbkuje oś w czasie; gra i demo zgłaszają
// przyloty i słuchają zdarzeń (wyrzut = moment, w którym okręt jest w świecie).
//
// Wszystkie czasy i wymiary skalują się długością kadłuba w świecie
// (Atlas = 1800 j.): duży okręt zapowiada się dłużej i rozdziera więcej
// przestrzeni, myśliwiec wyskakuje prawie od razu.
//
// Podróż: warpFlybySlowdown — statek w skoku zwalnia przy mijanych ciałach.

export const WARP_REF_HULL_LENGTH = 1800;

/** Czasy fazy przylotu (s) dla kadłuba referencyjnego. */
export const WARP_ARRIVAL_BASE = Object.freeze({
  herald: 2.4,    // zwiastun: przestrzeń drga w punkcie wyjścia
  tear: 0.55,     // rozdarcie: szew otwiera się wzdłuż kierunku przylotu
  emerge: 0.6,    // wyrzut: okręt wysuwa się z szwu i wytraca prędkość
  close: 0.5,     // zamknięcie szwu za rufą (zaczyna się w trakcie wyrzutu)
  cool: 4.5       // stygnięcie: żar kadłuba gaśnie sam, tu tylko koniec osi
});

/** Geometria w długościach kadłuba. */
export const WARP_ARRIVAL_SHAPE = Object.freeze({
  seamLength: 1.4,     // długość szwu
  seamOpen: 0.075,     // maks. połowa szerokości szwu (× długość szwu)
  emergeDist: 0.45,    // o ile okręt wysuwa się z szwu po wyrzucie
  heraldRadius: 0.55,  // promień zaburzenia zwiastuna
  ringRadius: 2.6,     // zasięg fali pierścieniowej
  bowReach: 1.8        // ile przebiega fala dziobowa
});

const clamp01 = (v) => (v <= 0 ? 0 : (v >= 1 ? 1 : v));
const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const easeOutCubic = (v) => { const t = 1 - clamp01(v); return 1 - t * t * t; };
const easeInCubic = (v) => { const t = clamp01(v); return t * t * t; };
// Lekki „przestrzał” przy otwarciu szwu (materiał przestrzeni jest sprężysty).
const easeOutBack = (v) => {
  const t = clamp01(v) - 1;
  const s = 1.6;
  return 1 + t * t * ((s + 1) * t + s);
};

/** Mnożnik czasu i siły od długości kadłuba (0,45–1,25). */
export function warpSizeScale(hullLength) {
  const len = Math.max(40, Number(hullLength) || WARP_REF_HULL_LENGTH);
  const s = Math.pow(len / WARP_REF_HULL_LENGTH, 0.3);
  return s < 0.45 ? 0.45 : (s > 1.25 ? 1.25 : s);
}

/**
 * Przylot okrętu. Pozycja (x, y) i kąt w świecie gry (y w dół) to miejsce,
 * w którym okręt STANIE po wyrzucie; wyłania się `emergeDist` za nim.
 * @param {object} o { x, y, angle, hullLength, hullWidth, startTime,
 *   heraldExtra, palette, entity, id }
 */
export function createWarpArrival(o = {}) {
  const hullLength = Math.max(40, Number(o.hullLength) || WARP_REF_HULL_LENGTH);
  const hullWidth = Math.max(16, Number(o.hullWidth) || hullLength * 0.45);
  const s = warpSizeScale(hullLength);
  const sq = Math.sqrt(s);
  const herald = WARP_ARRIVAL_BASE.herald * s + Math.max(0, Number(o.heraldExtra) || 0);
  const tear = WARP_ARRIVAL_BASE.tear * sq;
  const emerge = WARP_ARRIVAL_BASE.emerge * sq;
  const close = WARP_ARRIVAL_BASE.close * sq;
  const t0 = Number(o.startTime) || 0;
  const tTear = t0 + herald;
  const tBurst = tTear + tear;
  const tClose = tBurst + emerge * 0.35;
  const tSettled = tBurst + emerge;
  const tEnd = tBurst + Math.max(emerge, close + emerge * 0.35) + WARP_ARRIVAL_BASE.cool;
  const angle = Number(o.angle) || 0;
  return {
    id: o.id ?? null,
    x: Number(o.x) || 0,
    y: Number(o.y) || 0,
    angle,
    dirX: Math.cos(angle),
    dirY: Math.sin(angle),
    hullLength,
    hullWidth,
    sizeScale: s,
    palette: o.palette || 'terran',
    entity: o.entity || null,
    t0,
    herald,
    tear,
    emerge,
    close,
    tTear,
    tBurst,
    tClose,
    tSettled,
    tEnd,
    seamLength: hullLength * WARP_ARRIVAL_SHAPE.seamLength,
    seamHalfWidth: hullLength * WARP_ARRIVAL_SHAPE.seamLength * WARP_ARRIVAL_SHAPE.seamOpen,
    emergeDist: hullLength * WARP_ARRIVAL_SHAPE.emergeDist,
    // zdarzenia jednorazowe (render/gra odhaczają, żeby nie odpalić dwa razy)
    fired: { tear: false, burst: false, settled: false }
  };
}

/**
 * Próbka osi przylotu w chwili t. Wszystkie pola 0..1 (poza `phase`
 * i przesunięciem okrętu w świecie). `out` jest wypełniany w miejscu.
 */
export function sampleWarpArrival(a, t, out = {}) {
  const u = t - a.t0;
  let phase;
  if (u < 0) phase = 'wait';
  else if (t < a.tTear) phase = 'herald';
  else if (t < a.tBurst) phase = 'tear';
  else if (t < a.tSettled) phase = 'emerge';
  else if (t < a.tEnd) phase = 'cool';
  else phase = 'done';
  out.phase = phase;

  // Zwiastun narasta przez cały czas zapowiedzi, trzyma się przez rozdarcie
  // i gaśnie szybko po wyrzucie (energia poszła w okręt).
  const heraldRise = u < 0 ? 0 : smooth(u / Math.max(0.05, a.herald * 0.9));
  const afterBurst = t - a.tBurst;
  const heraldFall = afterBurst <= 0 ? 1 : Math.exp(-afterBurst / 0.12);
  out.herald = heraldRise * heraldFall;

  // Szew: najpierw punkt wydłuża się w kreskę (ostatnie 35% zwiastuna),
  // przy rozdarciu kreska rośnie do pełnej długości i się otwiera.
  const lateHerald = clamp01((u - a.herald * 0.65) / Math.max(0.05, a.herald * 0.35));
  const tearT = (t - a.tTear) / Math.max(0.01, a.tear);
  let seamLen = 0.22 * smooth(lateHerald);
  if (t >= a.tTear) seamLen = 0.22 + 0.78 * easeOutCubic(tearT);
  let seamOpen = 0.08 * lateHerald;
  if (t >= a.tTear) seamOpen = 0.08 + 0.92 * easeOutBack(tearT);
  // Zamknięcie: szew zasklepia się od dziobu ku rufie, zwężając się.
  const closeT = clamp01((t - a.tClose) / Math.max(0.01, a.close));
  out.closeT = t >= a.tClose ? closeT : 0;
  if (t >= a.tClose) {
    seamOpen *= 1 - easeInCubic(closeT);
    seamLen *= 1 - 0.55 * smooth(closeT);
  }
  if (phase === 'wait' || phase === 'done') { seamLen = 0; seamOpen = 0; }
  out.seamLen = seamLen;
  out.seamOpen = Math.max(0, seamOpen);

  // Okręt: od wyrzutu w świecie, wysuwa się z szwu i wytraca prędkość.
  out.shipVisible = t >= a.tBurst;
  const emergeT = clamp01(afterBurst / Math.max(0.01, a.emerge));
  out.emergeT = emergeT;
  const slide = afterBurst < 0 ? 0 : easeOutCubic(emergeT);
  // przesunięcie okrętu względem pozycji końcowej (ujemne = za nią)
  out.shipOffset = -a.emergeDist * (1 - slide);
  // prędkość wzdłuż kursu (j/s) — pochodna easeOutCubic
  const d = 1 - emergeT;
  out.shipSpeed = afterBurst < 0 || emergeT >= 1 ? 0 : a.emergeDist * 3 * d * d / Math.max(0.01, a.emerge);

  // Smuga sylwetki: pełna przy wyrzucie, gaśnie z prędkością.
  out.smear = afterBurst < 0 ? 0 : Math.exp(-afterBurst / 0.16) * (1 - emergeT * 0.6);
  // Błysk w ujściu szwu.
  out.flash = afterBurst < 0 ? 0 : Math.exp(-afterBurst / 0.085);
  // Fala dziobowa i pierścieniowa: postęp 0..1 (poza zakresem = brak).
  out.bowT = afterBurst < 0 ? -1 : afterBurst / 0.95;
  out.ringT = afterBurst < 0 ? -1 : afterBurst / 1.15;
  // Wstrząs (0..1): skok przy wyrzucie, drobny szmer w czasie rozdarcia.
  out.shake = (afterBurst < 0 ? (t >= a.tTear ? 0.12 * smooth(tearT) : 0) : Math.exp(-afterBurst / 0.35));
  return out;
}

// ── Rozpęd przylotu, odlot, wyjście gracza (demo „Nurt”, iteracja 3 — 2026-10-03) ──────────
// User 2026-10-03: przylot i odlot „jak w Star Wars” — BEZ portalu (szczelina / tunel usunięte:
// po wyjściu z niej okręt jeszcze kawałek leciał) i BEZ smugi („normalnie widoczny statek”).
// Okręt pojawia się daleko za celem, wpada z dużą prędkością i gwałtownie hamuje; odlot — kop
// od rufy, rozpęd ∝ t³ i zniknięcie od dziobu w punkcie skoku. Wyjście Atlasa z warpa = ten sam
// przylot (spójność): zwolnienie do prędkości wlotu, wlot, hamowanie (dema/warp-webgpu/scenes.js:
// EXIT, arrivals.js: RUSH, brakeEffects).

/** Rozpęd przylotu i odlotu (długości kadłuba, sekundy; + perSize × skala rozmiaru). */
export const WARP_RUSH = Object.freeze({
  arriveDist: 4,       // minimalna droga od pojawienia się do zatrzymania [L]
  arriveMin: 9000,     // ... i nie mniej niż tyle j.
  arriveCoast: 0.7,    // ... i nie krócej niż tyle s lotu z pełną prędkością (z daleka)
  arriveSpeed: 9,      // prędkość wlotu [L/s] — szybko, ale kadłub czytelny
  arriveSpeedMin: 12000,
  arriveSpeedMax: 30000,
  brakeDist: 0.9,      // droga hamowania [L] — krótka: „gwałtownie hamuje”
  departDist: 4,       // rozpęd od miejsca startu do punktu zniknięcia [L]
  accel: 0.5,          // czas rozpędu [s] (+ accelPerSize × skala)
  accelPerSize: 0.18
});

/** Prędkość wlotu przed hamowaniem [j/s] dla kadłuba długości L (przylot NPC i wyjście gracza z warpa). */
export function warpArrivalSpeed(hullLength) {
  const L = Math.max(40, Number(hullLength) || WARP_REF_HULL_LENGTH);
  const R = WARP_RUSH;
  return Math.min(R.arriveSpeedMax, Math.max(R.arriveSpeedMin, R.arriveSpeed * L));
}

/**
 * Czas hamowania [s] z prędkości v0 do vEnd na drodze WARP_RUSH.brakeDist × L (stałe opóźnienie). vEnd = 0 —
 * zatrzymanie (rampa wyjścia gracza); vEnd > 0 — wyjście z pędem NPC (warpExitMomentum).
 */
export function warpBrakeTime(hullLength, v0, vEnd = 0) {
  const L = Math.max(40, Number(hullLength) || WARP_REF_HULL_LENGTH);
  const v = Math.max(1, Number(v0) || 1);
  const ve = Math.max(0, Math.min(v, Number(vEnd) || 0));
  return 2 * WARP_RUSH.brakeDist * L / (v + ve);
}

/**
 * WYJŚCIE Z PĘDEM (2026-10-19, user: „potrzeba prędkości wyjścia z warpa i lecenia à la Star Wars, a nie stania
 * pasywnego”): gwałtowne hamowanie przylotu NPC (błysk, fala, iskry) kończy się na k × prędkość bojowa klasy
 * (`maxSpeed`, src/data/shipFlightSpecs.js), nie na zerze. Okręt wraca do gry z tą prędkością wzdłuż kursu, a nadmiar
 * ścina zwykły model lotu (src/game/flight/shipFlightModel.js): pilot (lot naprzód w trybie bojowym) hamuje z `decel`
 * — przy nadmiarze mniejszym niż decel · τ pilota (`FLIGHT_PILOT.velocityTau`) słabiej, (v − cap) / τ — a governor
 * dokłada 0,5 × `decel` (`FLIGHT_PILOT.governorDecelFrac`). Droga ślizgu z k·v do v ≈ (k² − 1)·v² / (2 · 1,5 · decel)
 * + ogon pilota (k = 3: ~2,8–2,9 km Terra Nova, ~3,5–4 km piraci). Punkt przylotu wezwania to KONIEC ślizgu (tam okręt
 * ma prędkość bojową), hamowanie kończy się `slide` przed nim. k = 0 — dawne zatrzymanie.
 */
export const WARP_EXIT_MOMENTUM = Object.freeze({
  k: 3,                 // prędkość wyjścia × maxSpeed
  slideDecelMul: 1.5,   // opóźnienie ślizgu × decel (pilot 1 + governor 0,5)
  pilotTau: 0.3         // [s] = FLIGHT_PILOT.velocityTau (shipFlightModel.js) — ogon hamowania pilota
});

/**
 * Prędkość wyjścia i ślizg okrętu o specyfikacji lotu `spec` ({ maxSpeed, decel } — buildShipFlightSpec):
 * out.vExit [j/s], out.combat (= maxSpeed), out.slide [j.] — droga od końca hamowania do prędkości bojowej,
 * out.slideTime [s]. k < 1 — bez ślizgu (wyjście wolniejsze od prędkości bojowej), k = 0 — zatrzymanie.
 * Ślizg liczony jak w modelu lotu (pilot naprzód w trybie bojowym): nadmiar u = v − maxSpeed maleje z 1,5 · decel,
 * a poniżej decel · τ — du/dt = −u/τ − 0,5 · decel (do zera w skończonym czasie).
 */
export function warpExitMomentum(spec, k = WARP_EXIT_MOMENTUM.k, out = {}) {
  const M = WARP_EXIT_MOMENTUM;
  const v = Math.max(0, Number(spec?.maxSpeed) || 0);
  const D = Math.max(1, Number(spec?.decel) || 1);
  const kk = Number(k);
  const vExit = (Number.isFinite(kk) && kk > 0 ? kk : 0) * v;
  out.vExit = vExit;
  out.combat = v;
  out.slide = 0;
  out.slideTime = 0;
  if (!(vExit > v)) return out;
  const tau = M.pilotTau;
  const gov = (M.slideDecelMul - 1) * D;      // governor [j/s²]
  const knee = D * tau;                       // poniżej tego nadmiaru pilot hamuje słabiej niż decel
  const u0 = vExit - v;
  let d = 0;
  let t = 0;
  let u1 = u0;
  if (u0 > knee) {
    const a = D * M.slideDecelMul;
    d = (vExit * vExit - (v + knee) * (v + knee)) / (2 * a);
    t = (u0 - knee) / a;
    u1 = knee;
  }
  // ogon: u + gov·τ = (u1 + gov·τ)·e^(−t/τ) → 0
  const g = gov * tau;
  const t2 = g > 0 ? tau * Math.log((u1 + g) / g) : tau * 6;
  out.slide = d + v * t2 + tau * u1 - g * t2;
  out.slideTime = t + t2;
  return out;
}

/**
 * Rozpęd przylotu do osi z createWarpArrival (dopisuje pola do `a`): okręt pojawia się
 * `rushDist` za końcem hamowania (a.x, a.y) w chwili tAppear, leci z v0 do tBrake (= dawny
 * wyrzut, tBurst — oś zwiastuna bez zmian), hamuje ze stałym opóźnieniem do vExit i w tStop
 * wraca do gry (vExit = 0 — staje w a.x, a.y; vExit > 0 — leci dalej z vExit wzdłuż kursu).
 * rush — minimalna droga [× długość kadłuba] (sceny / wezwania dobierają do kadru).
 */
export function planWarpRush(a, rush = WARP_RUSH.arriveDist, vExit = 0) {
  const L = a.hullLength;
  const R = WARP_RUSH;
  a.v0 = warpArrivalSpeed(L);
  a.vExit = Math.max(0, Math.min(a.v0, Number(vExit) || 0));
  const brakeDist = L * R.brakeDist;
  a.rushDist = Math.max(L * Math.max(0.6, Number(rush) || R.arriveDist), R.arriveMin, brakeDist + a.v0 * R.arriveCoast);
  a.brake = warpBrakeTime(L, a.v0, a.vExit);
  a.coast = (a.rushDist - brakeDist) / a.v0;
  a.tBrake = a.tBurst;
  a.tAppear = a.tBrake - a.coast;
  a.tStop = a.tBrake + a.brake;
  // Miejsce pojawienia się (świat): koniec hamowania − droga rozpędu wzdłuż kursu.
  a.x0 = a.x - a.dirX * a.rushDist;
  a.y0 = a.y - a.dirY * a.rushDist;
  if (!(a.tEnd > a.tStop + 1.5)) a.tEnd = a.tStop + 1.5;
  return a;
}

/**
 * Próbka rozpędu przylotu: out.along — droga od miejsca pojawienia się, out.speed [j/s] wzdłuż
 * kursu, out.off — położenie względem końca hamowania (≤ 0 do tStop; po nim vExit · czas), out.appeared,
 * out.tb — czas od początku hamowania (< 0: jeszcze leci).
 */
export function sampleWarpRush(a, t, out = {}) {
  const tau = t - a.tAppear;
  let along = 0;
  let speed = 0;
  if (tau >= 0) {
    const tb = tau - a.coast;
    const vE = a.vExit > 0 ? a.vExit : 0;
    if (tb < 0) { along = a.v0 * tau; speed = a.v0; }
    else if (tb < a.brake) {
      along = a.v0 * a.coast + a.v0 * tb - (a.v0 - vE) * tb * tb / (2 * a.brake);
      speed = a.v0 - (a.v0 - vE) * tb / a.brake;
    } else {
      along = a.rushDist + vE * (tb - a.brake);
      speed = vE;
    }
  }
  out.appeared = tau >= 0;
  out.along = along;
  out.speed = speed;
  out.off = along - a.rushDist;
  out.tb = t - a.tBrake;
  return out;
}

/** Bańka okrętu w locie przed i w czasie hamowania: zapada się od dziobu (front 3 → −1,3). */
export function warpBrakeBubbleFront(tb, brake) {
  return tb < 0 ? 3 : (1.3 - 2.6 * clamp01(tb / Math.max(0.05, brake)));
}

/** Czasy odlotu (s) dla kadłuba referencyjnego (+ perSize × skala rozmiaru). */
export const WARP_DEPARTURE_BASE = Object.freeze({
  charge: 1.6,        // ładowanie: punkt skoku przed dziobem
  chargePerSize: 0.8,
  close: 0.45,        // zapas po zniknięciu (błysk, fala)
  tail: 0.2           // koniec osi
});

/**
 * Odlot okrętu (wspak przylotu, bez szczeliny): ładowanie — punkt skoku `rush` długości przed
 * dziobem (ośrodek zbierany, rdzeń jaśnieje), KOP od rufy (błysk, fala, wstrząs), rozpęd ∝ t³ do
 * punktu skoku, dalej pełną prędkością — kadłub znika w nim od dziobu (błysk, fala). Pozycja
 * (x, y) i kąt w świecie gry (y w dół) to miejsce okrętu przed rozpędem.
 * @param {object} o { x, y, angle, hullLength, hullWidth, startTime, rush, palette, entity, id }
 */
export function createWarpDeparture(o = {}) {
  const hullLength = Math.max(40, Number(o.hullLength) || WARP_REF_HULL_LENGTH);
  const hullWidth = Math.max(16, Number(o.hullWidth) || hullLength * 0.45);
  const s = warpSizeScale(hullLength);
  const B = WARP_DEPARTURE_BASE;
  const R = WARP_RUSH;
  const t0 = Number(o.startTime) || 0;
  const charge = B.charge + B.chargePerSize * s;
  const angle = Number(o.angle) || 0;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const x = Number(o.x) || 0;
  const y = Number(o.y) || 0;
  const rush = Number(o.rush) > 0 ? Number(o.rush) : R.departDist;
  // Rozpęd: droga ∝ t³ przez `accel` do punktu skoku (D przed dziobem), dalej pełną prędkością.
  const D = hullLength * Math.max(0.4, rush);
  // Krótszy rozpęd = krótszy czas (∝ √drogi przy stałym „szarpnięciu” startu).
  const accel = (R.accel + R.accelPerSize * s) * Math.sqrt(Math.min(1.5, Math.max(0.1, rush / R.departDist)));
  const vEnd = 3 * D / accel;
  const tDive = t0 + charge;
  const tIn = tDive + accel;
  // Zniknięcie: rufa za punktem skoku (droga D + 1,1 L, ostatni odcinek z vEnd).
  const tGone = tIn + (hullLength * 1.1) / vEnd;
  return {
    id: o.id ?? null,
    x, y, angle, dirX, dirY,
    hullLength,
    hullWidth,
    sizeScale: s,
    palette: o.palette || 'terran',
    entity: o.entity || null,
    t0,
    charge,
    accel,
    rushDist: D,
    vEnd,
    close: B.close,
    tDive,
    tIn,
    tGone,
    dive: tGone - tDive,
    tEnd: tGone + B.close + B.tail,
    // Punkt skoku (świat) — tu okręt znika; mouth = jego odległość od środka kadłuba na starcie.
    cx: x + dirX * (hullLength * 0.5 + D),
    cy: y + dirY * (hullLength * 0.5 + D),
    mouth: hullLength * 0.5 + D,
    fired: { dive: false, gone: false }
  };
}

/**
 * Próbka osi odlotu w chwili t (`out` wypełniany w miejscu): phase ('wait' | 'charge' | 'dive' |
 * 'close' | 'done'), u / build (ładowanie), dist [j.] i speed [j/s] okrętu w rozpędzie,
 * revealLine (lokalne x punktu skoku względem środka kadłuba: widać tylko część za nim),
 * shipVisible, heat, kickT (czas od kopu, < 0 — przed), inT (czas od wejścia w punkt skoku),
 * shake.
 */
export function sampleWarpDeparture(d, t, out = {}) {
  let phase;
  if (t < d.t0) phase = 'wait';
  else if (t < d.tDive) phase = 'charge';
  else if (t < d.tGone) phase = 'dive';
  else if (t < d.tEnd) phase = 'close';
  else phase = 'done';
  out.phase = phase;
  const u = clamp01((t - d.t0) / Math.max(0.01, d.charge));
  const build = t < d.t0 ? 0 : u * u * (3 - 2 * u);
  out.u = u;
  out.build = build;
  let dist = 0;
  let speed = 0;
  let heat = 0.25 * build * build;
  let shake = 0;
  const tau = t - d.tDive;
  if (tau >= 0) {
    if (tau < d.accel) {
      const w = tau / d.accel;
      dist = d.rushDist * w * w * w;
      speed = d.vEnd * w * w;
    } else {
      dist = d.rushDist + d.vEnd * (tau - d.accel);
      speed = d.vEnd;
    }
    heat = Math.max(heat, 0.5 * Math.exp(-tau / 0.6));
    shake = Math.exp(-tau / 0.3) * (0.4 + 0.6 * d.sizeScale);
    const ti = t - d.tIn;
    if (ti >= 0) shake = Math.max(shake, Math.exp(-ti / 0.3) * 0.5);
  }
  out.dist = dist;
  out.speed = t < d.tGone ? speed : 0;
  out.kickT = tau;
  out.inT = t - d.tIn;
  out.revealLine = d.mouth - dist;
  out.shipVisible = t < d.tDive || out.revealLine > -d.hullLength * 0.55;
  out.heat = heat;
  out.shake = shake;
  return out;
}

/**
 * WYJŚCIE GRACZA Z WARPA = przylot jak u NPC (user 2026-10-03: spójność — Atlas też „hamuje”):
 *   ZWOLNIENIE `slow` s — prędkość spada z warpowej do prędkości wlotu (warpArrivalSpeed),
 *                rulon się rozwija, smugi gwiazd i ośrodka gasną;
 *   WLOT `coast` s — statek leci z prędkością wlotu i wysuwa się przed kamerę (`ahead` × pół
 *                kadru w stronę celu; kamera nigdy go nie wyprzedza, dogania w `settle` s);
 *   HAMOWANIE — droga WARP_RUSH.brakeDist × L ze stałym opóźnieniem.
 */
export const WARP_EXIT = Object.freeze({ slow: 0.7, coast: 0.45, ahead: 0.4, settle: 1.3, zoomTail: 0.9 });

/**
 * Rampa wyjścia (rozgrywka: prędkość statku gracza po wyjściu z warpa; efekt: oś wyjścia).
 * v0 — prędkość w chwili wyjścia [j/s]. Wlot nie szybszy niż v0 (wolny warp nie przyspiesza).
 * vEnd — prędkość na końcu hamowania [j/s] (WYJŚCIE Z PĘDEM, user 2026-10-19: „lecenie à la Star Wars, a nie
 * stanie pasywne”; demo „Pęd”: 3 × prędkość bojowa). Hamowanie z tym samym opóźnieniem co do zera, tylko
 * krócej; po rampie statek leci z vEnd wzdłuż kursu (nadmiar zbiera zwykły model lotu). 0 — zatrzymanie.
 */
export function createWarpExitRamp({ v0, hullLength, dirX = 1, dirY = 0, startTime = 0, vEnd = 0 } = {}) {
  const L = Math.max(40, Number(hullLength) || WARP_REF_HULL_LENGTH);
  const vStart = Math.max(0, Number(v0) || 0);
  const vArr = Math.max(1, Math.min(warpArrivalSpeed(L), vStart || 1));
  const vOut = Math.max(0, Math.min(vArr, Number(vEnd) || 0));
  const E = WARP_EXIT;
  const brake = warpBrakeTime(L, vArr) * (1 - vOut / vArr);
  const dl = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
  const r = {
    active: true,
    t0: Number(startTime) || 0,
    age: 0,
    v0: vStart,
    vArr,
    vEnd: vOut,
    hullLength: L,
    dirX: dirX / dl,
    dirY: dirY / dl,
    slow: E.slow,
    coast: E.coast,
    brake,
    tSlowEnd: E.slow,
    tBrake: E.slow + E.coast,
    tHalt: E.slow + E.coast + brake
  };
  r.dist = warpExitRampDistance(vStart, L, vOut);
  return r;
}

/**
 * Droga rampy wyjścia [j.] od prędkości v0: zwolnienie (średnia v0 i wlotu — smoothstep całkuje
 * się do ½), wlot, hamowanie (średnia wlotu i vEnd · czas). Travel to: wyjście zaczyna się, gdy do celu zostało tyle.
 */
export function warpExitRampDistance(v0, hullLength, vEnd = 0) {
  const L = Math.max(40, Number(hullLength) || WARP_REF_HULL_LENGTH);
  const vStart = Math.max(0, Number(v0) || 0);
  const vArr = Math.max(1, Math.min(warpArrivalSpeed(L), vStart || 1));
  const vOut = Math.max(0, Math.min(vArr, Number(vEnd) || 0));
  const E = WARP_EXIT;
  const brake = warpBrakeTime(L, vArr) * (1 - vOut / vArr);
  return E.slow * (vStart + vArr) * 0.5 + E.coast * vArr + brake * (vArr + vOut) * 0.5;
}

/**
 * Prędkość na rampie wyjścia w chwili `age` [s od wyjścia]: out.speed [j/s], out.phase
 * ('slow' | 'coast' | 'brake' | 'done'), out.tb (czas od początku hamowania). Po rampie — vEnd.
 */
export function sampleWarpExitRamp(r, age, out = {}) {
  const a = Math.max(0, Number(age) || 0);
  const vEnd = Number(r.vEnd) || 0;
  let speed;
  let phase;
  if (a < r.tSlowEnd) {
    const u = clamp01(a / r.slow);
    speed = r.v0 + (r.vArr - r.v0) * (u * u * (3 - 2 * u));
    phase = 'slow';
  } else if (a < r.tBrake) {
    speed = r.vArr;
    phase = 'coast';
  } else if (a < r.tHalt) {
    speed = r.vArr + (vEnd - r.vArr) * ((a - r.tBrake) / Math.max(1e-6, r.brake));
    phase = 'brake';
  } else {
    speed = vEnd;
    phase = 'done';
  }
  out.speed = speed;
  out.phase = phase;
  out.tb = a - r.tBrake;
  return out;
}

/**
 * RULON (pomysł usera 2026-10-03, src/3d/warp/rulon.js): ładowanie ZWIJA rzeczywistość wokół
 * osi skoku i zawija ją do statku (lejek) — jedna faza; skok dociąga miękkim nabrzmieniem (> 1), wyjście
 * rozwija w `exitDur` s. state: 'charging' | 'active' | 'exit' | inne (0); kickAge — od skoku,
 * exitAge — od wyjścia. Lejek (field) = min(1, zwinięcie).
 * PŁYNNOŚĆ (user 2026-10-08: „upłynnij wejście i wyjście z warpa — zawijanie i rozwijanie”): zwijanie =
 * smoothstep po CAŁYM ładowaniu (dawniej smoothstep^1,4 między 5 a 95% — szczyt ~2,4/s przy końcu), nabrzmienie
 * przy skoku narasta gaussowsko (bez skoku nachylenia; dawniej +16% w 0,03 s — szarpnięcie 5/s), rozwijanie =
 * smoothstep (rusza od zera; dawniej easeOut³ — od razu 4,3/s) przez zwolnienie i wlot rampy (player.js).
 */
export const WARP_RULON = Object.freeze({
  kickSwell: 0.1,   // nabrzmienie przy skoku (× zwinięcia)
  kickRise: 0.1,    // [s] narastanie (1 − e^(−(t/τ)²))
  kickFall: 0.5     // [s] gaśnięcie
});

export function warpRulonBend(state, charge, kickAge, exitAge, exitDur = WARP_EXIT.slow + WARP_EXIT.coast) {
  if (state === 'charging') {
    const c = clamp01(charge);
    return c * c * (3 - 2 * c);
  }
  if (state !== 'active' && state !== 'exit') return 0;
  const k = Number(kickAge);
  const R = WARP_RULON;
  const q = k / R.kickRise;
  const swell = k > 0 ? (1 - Math.exp(-q * q)) * Math.exp(-k / R.kickFall) : 0;
  let b = 1 + R.kickSwell * swell;
  if (state === 'exit') {
    const u = clamp01((Number(exitAge) || 0) / Math.max(0.05, exitDur));
    b *= 1 - u * u * (3 - 2 * u);
  }
  return b;
}

/**
 * STYL WARPA (user 2026-10-19: „przekombinowałem z zawijanym efektem warp — dodaj przełącznik rulon 0”; porównanie
 * w demie „Pęd”, dema/warp-ped.html):
 *   'rulon'    — zwinięcie świata w walec i lejek (rulon.js) — dawny domyślny, dziś tylko z adresu (A/B);
 *   'ped'      — sama prędkość: bez gięcia świata (smugi gwiazd, ośrodek, soczewka świata, kop kamery) — domyślny;
 *   'akcent'   — prędkość + krótkie akcenty soczewki na przejściach (naciąg przed dziobem w ładowaniu, fala
 *                w punkcie skoku, sprężenie przestrzeni przed dziobem przy wyjściu);
 *   'soczewka' — prędkość + soczewka bańki wokół statku przez cały skok (kadłub nietknięty).
 * Adres strony: `?warp=ped|akcent|soczewka|rulon`; `?rulon=1` (on / true / tak) = 'rulon', `?rulon=0` = 'ped'. search — `location.search`
 * strony (render: RenderWorld.pageSearch — także w workerze); wynik pamiętany dla ostatniego napisu. Demo ustawia
 * styl wprost (`setWarpStyle`, null — wraca do adresu). Bez rulonu kamera trzyma zwykłe wyprzedzenie (cameraRig.js).
 */
export const WARP_STYLES = Object.freeze(['rulon', 'ped', 'akcent', 'soczewka']);
const RULON_OFF_RE = /[?&]rulon=(?:0|off|false|nie)(?:&|$)/i;
const RULON_ON_RE = /[?&]rulon=(?:1|on|true|tak)(?:&|$)/i;
const WARP_STYLE_RE = /[?&]warp=([a-z]+)(?:&|$)/i;
let _styleSet = null;
let _styleSearch = null;
// Styl domyślny = 'ped' (decyzja użytkownika 2026-10-23: „wrzuć nowy warp do gry” — „ped”, nie bańka); dawny rulon
// i reszta stylów z adresu (`?warp=rulon|akcent|soczewka`) do A/B.
export const WARP_STYLE_DEFAULT = 'ped';
let _styleFromSearch = WARP_STYLE_DEFAULT;
export function setWarpStyle(style) {
  _styleSet = WARP_STYLES.includes(style) ? style : null;
  return _styleSet;
}
export function warpStyle(search) {
  if (_styleSet) return _styleSet;
  const s = typeof search === 'string' ? search : '';
  if (s !== _styleSearch) {
    _styleSearch = s;
    const m = WARP_STYLE_RE.exec(s);
    const v = m ? m[1].toLowerCase() : '';
    _styleFromSearch = WARP_STYLES.includes(v) ? v
      : (RULON_ON_RE.test(s) ? 'rulon' : (RULON_OFF_RE.test(s) ? 'ped' : WARP_STYLE_DEFAULT));
  }
  return _styleFromSearch;
}
/** Czy skok zwija świat w rulon (styl 'rulon'). */
export function warpRulonEnabled(search) {
  return warpStyle(search) === 'rulon';
}


/**
 * Plan przylotu floty (wezwanie, zasadzka): zwiastuny startują razem,
 * a wyrzuty idą po kolei od najmniejszego okrętu; największy (okręt
 * flagowy) wychodzi ostatni, z dodatkową pauzą — kulminacja.
 * FALE (waveGap > 0, scena „Wojna”): okręt o kadłubie dłuższym niż poprzedni o więcej niż `waveStep` (nowa klasa)
 * wychodzi dodatkowo `waveGap` s później — flota wypada z warpa falami klas.
 * @param {Array<{hullLength:number}>} ships
 * @param {object} [o] { startTime, gap, flagshipPause, jitter, rng, waveGap, waveStep }
 * @returns {Array<{index:number, startTime:number, heraldExtra:number, burstTime:number}>}
 *   w kolejności wejścia `ships`.
 */
export function planWarpFleetArrival(ships, o = {}) {
  const list = Array.isArray(ships) ? ships : [];
  const startTime = Number(o.startTime) || 0;
  const gap = Number.isFinite(o.gap) ? o.gap : 0.18;
  const flagshipPause = Number.isFinite(o.flagshipPause) ? o.flagshipPause : 0.45;
  const jitter = Number.isFinite(o.jitter) ? o.jitter : 0.25;
  const waveGap = Number.isFinite(o.waveGap) ? Math.max(0, o.waveGap) : 0;
  const waveStep = Number.isFinite(o.waveStep) ? o.waveStep : 1.15;
  const rng = typeof o.rng === 'function' ? o.rng : Math.random;
  const plan = list.map((s, index) => {
    const probe = createWarpArrival({ hullLength: s?.hullLength, startTime });
    const heraldStart = startTime + rng() * jitter;
    const natural = heraldStart + (probe.tBurst - probe.t0);
    return { index, hullLength: probe.hullLength, startTime: heraldStart, natural, burstTime: natural, heraldExtra: 0 };
  });
  const order = plan.slice().sort((a, b) => (a.hullLength - b.hullLength) || (a.index - b.index));
  let prev = -Infinity;
  for (let k = 0; k < order.length; k++) {
    const p = order[k];
    const isFlagship = k === order.length - 1 && order.length > 1;
    const wave = waveGap > 0 && k > 0 && p.hullLength > order[k - 1].hullLength * waveStep ? waveGap : 0;
    let burst = Math.max(p.natural, prev + gap + wave);
    if (isFlagship) burst = Math.max(p.natural, prev + gap + wave + flagshipPause);
    p.burstTime = burst;
    p.heraldExtra = burst - p.natural;
    prev = burst;
  }
  return plan.map(({ index, startTime: st, heraldExtra, burstTime }) => ({ index, startTime: st, heraldExtra, burstTime }));
}

/** Zwolnienie skoku przy mijanym ciele — patrz warpFlybySlowdown. */
export const WARP_FLYBY_DEFAULTS = Object.freeze({
  depth: 0.85,      // najgłębsze zwolnienie (0,85 = statek zwalnia do 15% prędkości)
  minSize: 0.05,    // ciało widziane z kursu mniejsze niż to — bez zwolnienia
  fullSize: 0.42,   // … większe niż to — pełne zwolnienie
  width: 2.2,       // półszerokość pasa zwolnienia × (odległość środka ciała od kursu + promień)
  minWidth: 60000   // … nie węższa niż ta [j.]
});

/**
 * Zwolnienie skoku przy mijanym ciele („grawitacja”; user 2026-09-26: „statek
 * przelatuje obok planety? zwolnij statek, planetę powiększ (płynnie), pokaż
 * ją, … pomniejsz, zostaw z tyłu”). Mnożnik prędkości 0..1. Głębokość rośnie
 * z wielkością ciała widzianego z kursu (promień / (promień + odległość kursu od
 * powierzchni)) — mijana z bliska planeta zwalnia mocno, daleki mały księżyc
 * wcale; pas wzdłuż kursu (gauss) szerszy dla ciał dalej od kursu, więc statek
 * zwalnia z wyprzedzeniem i płynnie. Gra: warpFlybyFactor w kroku fizyki skoku
 * gracza (index.html) i w planie prędkości (planWarpCruise); widok — soczewka świata
 * (src/3d/warp/worldLens.js, skala z NOMINALNEJ prędkości — nie przybliża się przy zwolnieniu).
 * along — ciało przed statkiem wzdłuż kursu (ujemne: za rufą), lateral —
 * odległość środka ciała od kursu, radius — promień ciała (jednostki świata).
 */
export function warpFlybySlowdown(along, lateral, radius, p = WARP_FLYBY_DEFAULTS) {
  const r = Math.max(1, Number(radius) || 0);
  const lat = Math.abs(Number(lateral) || 0);
  const clear = Math.max(0, lat - r);
  const size = r / (r + clear);
  const depth = clamp01(p.depth) * smooth((size - p.minSize) / Math.max(1e-6, p.fullSize - p.minSize));
  if (!(depth > 0)) return 1;
  const w = Math.max(Number(p.minWidth) || 1, (Number(p.width) || 0) * (lat + r));
  const g = (Number(along) || 0) / w;
  return 1 - depth * Math.exp(-g * g);
}

/**
 * Zwolnienie skoku od wszystkich ciał w punkcie (x, y) przy kursie (dirX, dirY) — iloczyn
 * warpFlybySlowdown. bodies: [{ x, y, r }] (świat gry), n — ile pierwszych brać.
 */
export function warpFlybyFactor(x, y, dirX, dirY, bodies, n = bodies ? bodies.length : 0, p = WARP_FLYBY_DEFAULTS) {
  let f = 1;
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    if (!b) continue;
    const ox = b.x - x;
    const oy = b.y - y;
    f *= warpFlybySlowdown(ox * dirX + oy * dirY, oy * dirX - ox * dirY, b.r, p);
  }
  return f;
}

/**
 * CZAS PODRÓŻY skokiem (demo „Nurt”, dema/warp-webgpu/solar.js: buildTrip — user 2026-10-07: „warp
 * jest znacznie szybszy w grze”): od skoku do zatrzymania clamp(base + d · perUnit, min, max) s
 * (Ziemia → Jowisz ~10 s, Ziemia → Saturn 17 s), wyjście zaczyna się `decel` s przed końcem. Gra ma
 * też krótkie skoki (odcinek warpem od 40 tys. j.) — 8 s na 40 tys. j. byłoby wolniej niż dopalacz,
 * więc poniżej `shortDist` dolna granica maleje jak √d (do `shortMin`). Prędkość skoku z celem
 * (planWarpCruise) dobiera się do tego czasu — bliski cel to wolniejszy skok (soczewka: ciaśniejszy
 * kadr, ciała mijają go w tym samym tempie).
 */
export const WARP_TRIP = Object.freeze({
  base: 4,               // [s]
  perUnit: 1 / 260000,   // [s/j.]
  min: 8,                // [s] najkrótsza podróż dema
  max: 17,               // [s]
  decel: 0.35,           // [s] wyjście tyle przed końcem (demo: TRAVEL.decel)
  shortDist: 520000,     // [j.] krótszy odcinek — krótsza podróż (gra)
  shortMin: 2.5,         // [s]
  vMin: 4000,            // [j/s] granice prędkości przelotowej
  vMax: 600000
});

/**
 * Strojenie czasu skoku dla napędu o prędkości `speed` [j/s] (napędy warp Mk I / II / III — src/data/driveModes.js,
 * decyzja użytkownika 2026-10-22): demo „Nurt” = 260 tys. j/s; wolniejszy napęd — dłuższa podróż (człon drogi
 * i sufit × 260 tys. / speed), sufit prędkości przelotowej w tej samej proporcji.
 */
export function warpTripTuneFor(speed, tune = WARP_TRIP) {
  const k = 260000 / Math.max(1000, Number(speed) || 260000);
  if (Math.abs(k - 1) < 1e-9) return tune;
  return Object.freeze({ ...tune, perUnit: tune.perUnit * k, max: tune.max * k, vMax: tune.vMax / k });
}

/** Czas skoku z celem [s, od skoku do zatrzymania] dla odcinka `dist` [j.]. */
export function warpTripTime(dist, tune = WARP_TRIP) {
  const d = Math.max(0, Number(dist) || 0);
  const floor = Math.max(tune.shortMin, tune.min * Math.sqrt(Math.min(1, d / Math.max(1, tune.shortDist))));
  return Math.min(tune.max, Math.max(floor, tune.base + d * tune.perUnit));
}

/**
 * Symulacja skoku po prostej z prędkością przelotową `vc` (ten sam przebieg co fizyka gry: wejście
 * smoothstep przez `entry` s od prędkości startu, gonienie prędkości `lag`/s, mnożnik strefy
 * i zwolnienie przy ciałach) do chwili, w której zaczyna się wyjście (do końca zostaje droga rampy
 * wyjścia). Zwraca czas [s] (albo `limit`, gdy skok trwałby dłużej).
 */
export function simulateWarpLeg(vc, o, limit = 60) {
  const dist = Math.max(0, Number(o.dist) || 0);
  const L = Math.max(40, Number(o.hullLength) || WARP_REF_HULL_LENGTH);
  const dt = Number(o.dt) > 0 ? o.dt : 1 / 60;
  const entry = Math.max(1e-3, Number(o.entry) || 0.9);
  const lag = Math.max(0.1, Number(o.lag) || 6);
  const bodies = Array.isArray(o.bodies) ? o.bodies : [];
  const zone = o.zone || null;
  const flyP = o.flyby || WARP_FLYBY_DEFAULTS;
  const v0 = Math.max(0, Number(o.v0) || 0);
  let s = 0;
  let v = v0;
  let t = 0;
  let prog = 0;
  const k = Math.min(1, lag * dt);
  while (t < limit) {
    if (dist - s <= warpExitRampDistance(v, L)) return t;
    prog = Math.min(1, prog + dt / entry);
    const ease = prog * prog * (3 - 2 * prog);
    let f = zone ? zone(s) : 1;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      f *= warpFlybySlowdown(b.along - s, b.lateral, b.r, flyP);
    }
    const vmax = vc * f;
    const vs = Math.min(v0, vmax);
    const target = vs + (vmax - vs) * ease;
    v += (target - v) * k;
    s += v * dt;
    t += dt;
  }
  return limit;
}

/**
 * Prędkość przelotowa skoku z celem: od skoku do początku wyjścia mija warpTripTime(dist) − decel.
 * o = { dist (wzdłuż kursu do końca odcinka), v0 (prędkość przy skoku), hullLength,
 *   bodies: [{ along, lateral, r }] (ciała względem punktu skoku — zwolnienie), zone: (s) → mnożnik
 *   strefy w odległości s od punktu skoku (opcjonalnie), entry, lag, dt }.
 * Zwraca { speed, time (plan od skoku do wyjścia), target (czas docelowy) }.
 */
export function planWarpCruise(o, tune = WARP_TRIP) {
  const dist = Math.max(0, Number(o.dist) || 0);
  const target = Math.max(0.2, warpTripTime(dist, tune) - tune.decel);
  let lo = Math.log(tune.vMin);
  let hi = Math.log(tune.vMax);
  const limit = target + 30;
  // Czas maleje z prędkością — bisekcja w logarytmie prędkości.
  if (simulateWarpLeg(tune.vMax, o, limit) >= target) return { speed: tune.vMax, time: simulateWarpLeg(tune.vMax, o, limit), target };
  if (simulateWarpLeg(tune.vMin, o, limit) <= target) return { speed: tune.vMin, time: simulateWarpLeg(tune.vMin, o, limit), target };
  for (let i = 0; i < 16; i++) {
    const mid = 0.5 * (lo + hi);
    if (simulateWarpLeg(Math.exp(mid), o, limit) > target) lo = mid; else hi = mid;
  }
  const speed = Math.exp(0.5 * (lo + hi));
  return { speed, time: simulateWarpLeg(speed, o, limit), target };
}
