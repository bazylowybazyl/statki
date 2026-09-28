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

/** Czasy odlotu (s) dla kadłuba referencyjnego — oś z dema „Nurt” (dema/warp-webgpu/arrivals.js). */
export const WARP_DEPARTURE_BASE = Object.freeze({
  charge: 1.6,        // ładowanie: punkt skoku przed dziobem (+ chargePerSize × skala)
  chargePerSize: 0.8,
  split: 0.45,        // szczelina otwiera się tyle przed wejściem
  dive: 0.34,         // wejście w szczelinę (+ divePerSize × skala)
  divePerSize: 0.12,
  close: 0.45,        // zamknięcie szczeliny za rufą
  tail: 0.2,          // koniec osi po zamknięciu
  diveReach: 2.6      // droga okrętu w szczelinie (× długość kadłuba)
});

/**
 * Odlot okrętu przez tunel (wspak przylotu): ładowanie — punkt skoku przed
 * dziobem, szczelina otwiera się przed nim, okręt przyspiesza i znika w niej
 * od dziobu, szczelina się zamyka. Czysty opis osi i geometrii (jak
 * createWarpArrival); pozycja (x, y) i kąt w świecie gry (y w dół) to miejsce
 * okrętu przed wejściem w szczelinę.
 * @param {object} o { x, y, angle, hullLength, hullWidth, startTime, palette, entity, id }
 */
export function createWarpDeparture(o = {}) {
  const hullLength = Math.max(40, Number(o.hullLength) || WARP_REF_HULL_LENGTH);
  const hullWidth = Math.max(16, Number(o.hullWidth) || hullLength * 0.45);
  const s = warpSizeScale(hullLength);
  const B = WARP_DEPARTURE_BASE;
  const t0 = Number(o.startTime) || 0;
  const charge = B.charge + B.chargePerSize * s;
  const dive = B.dive + B.divePerSize * s;
  const angle = Number(o.angle) || 0;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const x = Number(o.x) || 0;
  const y = Number(o.y) || 0;
  const seamLength = hullLength * WARP_ARRIVAL_SHAPE.seamLength;
  const tDive = t0 + charge;
  const tGone = tDive + dive;
  // Szczelina przed dziobem; jej tylny koniec = ujście (dziób w chwili wejścia).
  const ahead = hullLength * 0.5 + seamLength * 0.5;
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
    dive,
    close: B.close,
    tSplit: tDive - B.split,
    tDive,
    tGone,
    tEnd: tGone + B.close + B.tail,
    seamLength,
    seamHalfWidth: seamLength * WARP_ARRIVAL_SHAPE.seamOpen,
    cx: x + dirX * ahead,
    cy: y + dirY * ahead,
    mouth: hullLength * 0.5,
    diveReach: hullLength * B.diveReach,
    fired: { split: false, dive: false, gone: false }
  };
}

/**
 * Próbka osi odlotu w chwili t (pola 0..1 poza drogą i prędkością). `out`
 * wypełniany w miejscu: phase ('wait' | 'charge' | 'dive' | 'close' | 'done'),
 * build (narastanie ładowania), riftOpen / riftLen (szczelina), dist [j.]
 * i speed [j/s] okrętu w szczelinie, revealLine (lokalne x ujścia względem
 * środka kadłuba: widać tylko część kadłuba za nią), shipVisible, smear, heat,
 * flash (błysk w ujściu), waveT (fala z ujścia, poza 0..1 = brak), shake.
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
  out.build = build;
  out.u = u;
  // Szczelina: otwiera się pod koniec ładowania, zamyka po wejściu okrętu.
  let open = 0;
  let len = 0;
  if (t >= d.tSplit) {
    const o = clamp01((t - d.tSplit) / Math.max(0.01, d.tDive - d.tSplit));
    open = 0.08 + 0.92 * easeOutCubic(o);
    len = 0.25 + 0.75 * easeOutCubic(o);
  }
  if (t >= d.tGone) {
    const c = clamp01((t - d.tGone) / Math.max(0.01, d.close));
    open *= 1 - c * c * c;
    len *= 1 - 0.55 * c;
  }
  if (phase === 'wait' || phase === 'done') { open = 0; len = 0; }
  out.riftOpen = open;
  out.riftLen = len;
  // Wejście w szczelinę: przyspieszenie (droga ∝ w²).
  let dist = 0;
  let speed = 0;
  if (t >= d.tDive) {
    const w = clamp01((t - d.tDive) / Math.max(0.01, d.dive));
    dist = d.diveReach * w * w;
    speed = t < d.tGone ? 2 * d.diveReach * w / Math.max(0.01, d.dive) : 0;
    out.diveW = w;
  } else {
    out.diveW = 0;
  }
  out.dist = dist;
  out.speed = speed;
  out.revealLine = d.mouth - dist;
  out.shipVisible = t < d.tDive || out.revealLine > -d.hullLength * 0.55;
  out.smear = t >= d.tDive && t < d.tGone + 0.12 ? Math.max(0, 1 - out.diveW * 0.4) : 0;
  out.heat = Math.max(0.25 * build * build, t >= d.tDive ? 0.6 * (1 - out.diveW) : 0);
  const afterDive = t - d.tDive;
  out.flash = afterDive >= 0 && afterDive < 0.2 ? (1 - afterDive / 0.2) ** 2 : 0;
  out.waveT = afterDive >= 0 ? afterDive / 1.1 : -1;
  out.shake = afterDive >= 0 && afterDive < 0.4 ? (1 - afterDive / 0.4) : 0;
  return out;
}

/**
 * Plan przylotu floty (wezwanie, zasadzka): zwiastuny startują razem,
 * a wyrzuty idą po kolei od najmniejszego okrętu; największy (okręt
 * flagowy) wychodzi ostatni, z dodatkową pauzą — kulminacja.
 * @param {Array<{hullLength:number}>} ships
 * @param {object} [o] { startTime, gap, flagshipPause, jitter, rng }
 * @returns {Array<{index:number, startTime:number, heraldExtra:number, burstTime:number}>}
 *   w kolejności wejścia `ships`.
 */
export function planWarpFleetArrival(ships, o = {}) {
  const list = Array.isArray(ships) ? ships : [];
  const startTime = Number(o.startTime) || 0;
  const gap = Number.isFinite(o.gap) ? o.gap : 0.18;
  const flagshipPause = Number.isFinite(o.flagshipPause) ? o.flagshipPause : 0.45;
  const jitter = Number.isFinite(o.jitter) ? o.jitter : 0.25;
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
    let burst = Math.max(p.natural, prev + gap);
    if (isFlagship) burst = Math.max(p.natural, prev + gap + flagshipPause);
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
 * zwalnia z wyprzedzeniem i płynnie. Widok skoku przybliża się, gdy statek
 * zwalnia (warpLensScale w warpWorldLens.js) — stąd planeta płynnie rośnie.
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
