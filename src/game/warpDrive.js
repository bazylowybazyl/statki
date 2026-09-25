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
