// ============================================================
// Wygląd maskowania okrętu (2026-10-04, efekt jak w Crysis; 2026-10-05 — spójne ukrycie) — CZYSTA logika
// (bez three / DOM).
//
// Stan rozgrywki zostaje w src/game/cloak.js (`ship.cloak`: off → engaging → on → revealing / cooldown).
// Tu z niego i z ruchu encji powstaje „look” (`entity.__cloakLook`) czytany przez render:
//   • materiał kadłuba (src/3d/cloak/cloakTSL.js → hullCloakSurface): mozaika heksów przełączanych w losowej
//     kolejności na całym kadłubie naraz, błysk krawędzi przełączanej komórki, nieruchoma poświata brzegu
//     i „szkło”, zakłócenie przy zerwaniu — 5 vec4 w slocie kadłuba (HullObjectStore: uCloakA..E);
//   • warstwa DIST (Core3D.distortionTarget → „uber”): JEDNA soczewka na cały ukryty okręt i heksy-ekrany;
//   • wieżyczki, dysze, światła pozycyjne, reflektory i cień — przez `cloakVisAtWorld` (lustro CPU wzoru
//     z shadera: komórka heksa, hasz, próg) i `cloakLightGain`;
//   • cząstki i światła efektów (src/3d/cloak/cloakFx.js) — zdarzenia `events` (bity CLOAK_EVENT).
//
// Układ „kanoniczny” wzoru: piksele sprite'a od środka sprite'a, x ku dziobowi (+u), y w dół obrazu (+v).
// Przełączanie komórek (decyzja użytkownika 2026-10-05: bez fali biegnącej po heksach): każda komórka ma próg
// z haszu (rozrzut `spread`), „front” przesuwa się przez progi wraz z postępem ukrycia — komórki gasną i wracają
// w losowej kolejności na CAŁYM kadłubie naraz, bez frontu w przestrzeni.
//
// Slot kadłuba (pakowanie w `look.a..e`, pola x/y/z/w):
//   A = (front, kierunek: +1 znikanie / −1 pojawianie / 0 wyłączone, zakłócenie 0..1, migotanie 0..1)
//   B = (poświata brzegu, ruch 0..1, komórka [px sprite'a], poziom mip brzegu)
//   C = (barwa HDR rgb, impuls siatki 0..1)
//   D = (ziarno, refrakcja brzegu [j. świata], soczewka globalna 0..1+, rozrzut progów komórek)
//   E = (front pasa ekranów, strona pasa: +1 za frontem / −1 przed nim / 0 brak, utrata obrazu 0..1, siła ekranów)
//
// HEKSY-EKRANY (2026-10-05): komórka-„telewizorek” pokazuje INNY wycinek kadru (warstwa DIST, kanał z haszu),
// „uber” dokłada linie, luminofor i śnieg. TYLKO przy awarii maskowania (decyzja użytkownika: w ukryciu bez
// migotania, spójnie): przed powrotem komórki do widoczności (wyłączanie — część komórek tuż przed progiem),
// przy końcówce energii (losowa utrata obrazu) i przy zerwaniu (strzał, trafienie, taran — zakłócenie).
// Wzór w TSL (src/3d/cloak/cloakTSL.js, `tvStateAt`); widoczności komórek (lustro CPU) nie zmienia.
// ============================================================

export const CLOAK_LOOK = Object.freeze({
  cellWorld: 44,          // bok heksa (między ścianami) [j. świata] — ~8 px przy zwykłym zoomie gry (0,18)
  cellMinPx: 6,           // najmniejsza komórka [px sprite'a]
  spread: 1,              // rozrzut progów komórek (jednostki postępu) — losowa kolejność przełączania
  levelLo: 0.10,          // poziom maskowania (cloak.level), od którego komórki zaczynają gasnąć (wcześniej impuls)
  levelHi: 0.94,          // poziom, przy którym gaśnie ostatnia komórka
  pulseSec: 0.42,         // impuls siatki na starcie włączania [s]
  // Barwa HDR: nasycony chłodny cyjan — jaśniejsze wartości ACES gry przepala do bieli (płytki zamiast energii).
  tint: [0.12, 0.62, 1.35],
  rimHidden: 0.24,        // poświata brzegu ukrytego kadłuba (HDR × barwa, pod progiem bloomu)
  rimWorld: 22,           // szerokość pasa poświaty brzegu [j. świata] → poziom mip sprite'a
  refractWorld: 16,       // zgięcie tła na brzegu sylwetki [j. świata]
  refractMotion: 0.8,     // + przy pełnym ruchu
  lensStrength: 1,        // soczewka globalna ukrytego okrętu (0 — bez): powiększenie tła i zgięcie brzegu
  lensPulse: 0.3,         // + na czas impulsu siatki
  lensMotion: 0.5,        // + przy pełnym ruchu
  motionSpeed: 420,       // j/s → ruch 1
  motionTurn: 0.3,        // rad/s → ruch 1
  motionRate: 5,          // wygładzanie ruchu [1/s]
  glitchSec: 0.85,        // zakłócenie po zerwaniu
  flickerEnergy: 9,       // [s energii] poniżej — ostrzeżenie (heksy-ekrany, łuki, wizjer)
  flickerMax: 0.8,
  revealPulse: 0.45,      // impuls siatki na początku powrotu (z pełnego ukrycia)
  // Heksy-ekrany — tylko przy awarii maskowania.
  tvStrength: 1,          // 0 — bez ekranów
  tvRateFlicker: 0.45     // końcówka energii: udział komórek gubiących obraz w okresie (× migotanie)
});

// Stałe wzoru — te same w TSL (src/3d/cloak/cloakTSL.js).
export const CLOAK_HEX_RY = 1.7320508075688772;   // √3 — okres siatki w osi y (jednostki komórki)
export const CLOAK_BAND = 0.085;                   // szerokość przełączenia komórki (jednostki postępu)
export const CLOAK_ID_OFFSET = 16384;              // przesunięcie id komórki do liczb dodatnich (u32)
export const CLOAK_GLITCH_DROP = 0.38;             // zerwanie: ułamek komórek wypadających naraz (przy pełnym zakłóceniu)
// Pas ekranów przy wyłączaniu (jednostki postępu, po stronie ukrytej frontu): od CLOAK_TV_U0 na szerokość z haszu
// komórki w [CLOAK_TV_LOCK0, CLOAK_TV_LOCK1]; ekranem staje się tylko część komórek (CLOAK_TV_SHARE) — pojedyncze
// „telewizorki” tuż przed powrotem komórki, nie lita plama.
export const CLOAK_TV_U0 = CLOAK_BAND * 0.8;
export const CLOAK_TV_LOCK0 = 0.25;
export const CLOAK_TV_LOCK1 = 0.6;
export const CLOAK_TV_SHARE = 0.45;

/** Bity zdarzeń kroku (`look.events`) — efekty cząstek czytają je w tej samej klatce. */
export const CLOAK_EVENT = Object.freeze({ ENGAGE: 1, HIDDEN: 2, REVEAL: 4, BREAK: 8, VISIBLE: 16 });

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
// Przejście: rusza łagodnie, przyspiesza w połowie, domyka się miękko.
const easeSweep = (u) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

/**
 * Postęp ukrycia 0..1 (0 — cały widoczny, 1 — cały ukryty) z poziomu maskowania gry (cloak.level:
 * włączanie 0 → 1, powrót 1 → 0). Jedno odwzorowanie w obie strony — zmiana kierunku w połowie przejścia
 * (włącz → wyłącz) cofa front zamiast przeskoku.
 */
export function cloakHiddenProgress(level) {
  const T = CLOAK_LOOK;
  return easeSweep((clamp(Number(level) || 0, 0, 1) - T.levelLo) / Math.max(0.05, T.levelHi - T.levelLo));
}

/** Zakres frontu: przed najniższym progiem komórki (wszystko widać) … za najwyższym (wszystko ukryte). */
export function cloakFrontRange(spread = CLOAK_LOOK.spread) {
  const half = 0.5 * spread;
  return { start: -half - 0.01, end: half + CLOAK_BAND + 0.01 };
}

function v4() { return { x: 0, y: 0, z: 0, w: 0 }; }

/** Wartości „wyłączone” slotu (kierunek 0 — shader pomija gałąź). */
export const CLOAK_LOOK_OFF = Object.freeze({
  a: Object.freeze(v4()), b: Object.freeze({ x: 0, y: 0, z: 8, w: 3 }), c: Object.freeze(v4()), d: Object.freeze(v4()),
  e: Object.freeze(v4())
});

export function createCloakLook(cloak = null, seed = 0) {
  const range = cloakFrontRange();
  return {
    active: false,
    phase: 'off',               // 'engage' | 'hidden' | 'reveal' | 'glitch' | 'off'
    events: 0,
    a: v4(), b: v4(), c: v4(), d: v4(), e: v4(),
    vis: 1,                     // widoczność całego okrętu 0..1 (światła, cień, dysze bez pozycji)
    front: range.start,
    frontStart: range.start,
    frontEnd: range.end,
    dir: 0,
    // Tryb: +1 — ukrycie rośnie (start z pełnej widoczności), −1 — widoczność rośnie (start z pełnego ukrycia).
    // Zmienia się tylko na krańcach postępu (0 / 1).
    mode: cloak && cloak.state === 'on' ? -1 : 1,
    progress: cloak && cloak.state === 'on' ? 1 : 0,
    rate: 0,                    // tempo postępu [1/s] (cząstki przełączania)
    pulse: 0,
    pulseT: 0,
    pulseAmp: 0,
    glitch: 0,
    glitchT: 0,
    flicker: 0,
    motion: 0,
    time: 0,                    // zegar wzoru [s] (ten sam co HULL_SHARED.uTime)
    seed: (Number(seed) >>> 0) & 0xffff,
    lastState: cloak ? cloak.state : 'off',
    lastBreak: cloak ? cloak.lastBreak : null,
    // poza sprite'a w świecie gry (środek, kąt) i skala [j. świata / px sprite'a]
    px: 0, py: 0, cos: 1, sin: 0, scale: 1, invScale: 1, spriteW: 1, spriteH: 1,
    cellPx: 8, halfPx: 1,
    tint: CLOAK_LOOK.tint
  };
}

// ── Lustro CPU wzoru z shadera ──────────────────────────────────────────────────

/** Hasz komórki (lowbias32) → [0, 1) z 24 bitów — bit w bit jak `cloakHash` w TSL (u32). */
export function cloakHashCpu(ix, iy, seed) {
  let h = (Math.imul(ix >>> 0, 0x8da6b343) ^ Math.imul(iy >>> 0, 0xd8163841) ^ Math.imul(seed >>> 0, 0xcb1ab31f)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / 16777216;
}

const _cell = { gx: 0, gy: 0, idx: 0, idy: 0, ix: 0, iy: 0 };

/** Komórka heksa punktu (jednostki komórki): położenie w komórce (gx, gy), środek (idx, idy), id całkowite. */
export function cloakHexCellCpu(px, py, out = _cell) {
  const RY = CLOAK_HEX_RY;
  const ax = px - Math.floor(px) - 0.5;
  const ay = py - RY * Math.floor(py / RY) - RY * 0.5;
  const qx = px - 0.5;
  const qy = py - RY * 0.5;
  const bx = qx - Math.floor(qx) - 0.5;
  const by = qy - RY * Math.floor(qy / RY) - RY * 0.5;
  const useA = ax * ax + ay * ay < bx * bx + by * by;
  out.gx = useA ? ax : bx;
  out.gy = useA ? ay : by;
  out.idx = px - out.gx;
  out.idy = py - out.gy;
  out.ix = Math.round(out.idx * 2) + CLOAK_ID_OFFSET;
  out.iy = Math.round(out.idy / (RY * 0.5)) + CLOAK_ID_OFFSET;
  return out;
}

/**
 * Widoczność punktu kadłuba w układzie kanonicznym (px sprite'a od środka, x ku dziobowi, y w dół
 * obrazu): 1 widać, 0 ukryty — ten sam próg komórki, hasz i zakłócenie co `cloakCellVis` w TSL.
 */
export function cloakVisLocal(look, lx, ly) {
  if (!look || !look.active) return 1;
  const A = look.a;
  const D = look.d;
  const cellPx = Math.max(4, look.b.z);
  const c = cloakHexCellCpu(lx / cellPx, ly / cellPx);
  const seed = D.x >>> 0;
  const h1 = cloakHashCpu(c.ix, c.iy, seed);
  const k = clamp((A.x - (h1 - 0.5) * D.w) / CLOAK_BAND, 0, 1);
  const s = smooth(0.35, 0.75, k);
  let vis = A.y > 0 ? 1 - s : s;
  if (A.z > 0.001) {
    const g = cloakHashCpu(c.ix, c.iy, (seed + 977 + Math.floor(look.time * 22)) >>> 0);
    if (g >= 1 - A.z * CLOAK_GLITCH_DROP) vis = 0;
  }
  return vis;
}

/** Widoczność punktu świata gry (wieżyczka, dysza, lampa) — 1 bez maskowania. */
export function cloakVisAtWorld(look, wx, wy) {
  if (!look || !look.active) return 1;
  const dx = wx - look.px;
  const dy = wy - look.py;
  const lx = (dx * look.cos + dy * look.sin) * look.invScale;
  const ly = (dy * look.cos - dx * look.sin) * look.invScale;
  return cloakVisLocal(look, lx, ly);
}

/** Mnożnik świateł encji (reflektory, światło dookoła, grupy lamp) — 1 bez maskowania. */
export function cloakLightGain(entity) {
  const l = entity ? entity.__cloakLook : null;
  return l && l.active ? l.vis : 1;
}

/** Widoczność punktu świata dla encji (wygodnik: wieżyczki kanwy, dysze, lampy). */
export function entityCloakVisAt(entity, wx, wy) {
  const l = entity ? entity.__cloakLook : null;
  return l && l.active ? cloakVisAtWorld(l, wx, wy) : 1;
}

// ── Krok ───────────────────────────────────────────────────────────────────────

/**
 * Krok wyglądu (raz na klatkę renderu). cloak — `entity.cloak` (src/game/cloak.js), dt — czas klatki [s],
 * time — zegar wzoru [s] (HULL_SHARED.uTime), pose — { x, y, angle (sprite: kąt + obrót sprite'a), scale,
 * spriteW, spriteH, speed, turn }: środek sprite'a w świecie gry, skala [j. świata / px sprite'a],
 * prędkość [j/s] i obrót [rad/s]. Zwraca `look.active`.
 */
export function stepCloakLook(look, cloak, dt, time, pose) {
  const T = CLOAK_LOOK;
  const d = Math.max(0, Math.min(0.25, Number(dt) || 0));
  look.events = 0;
  look.time = Number(time) || 0;

  // Poza (lustro CPU i rozmiary wzoru).
  const scale = Math.max(1e-6, Number(pose?.scale) || 1);
  const W = Math.max(1, Number(pose?.spriteW) || 1);
  const H = Math.max(1, Number(pose?.spriteH) || 1);
  const ang = Number(pose?.angle) || 0;
  look.px = Number(pose?.x) || 0;
  look.py = Number(pose?.y) || 0;
  look.cos = Math.cos(ang);
  look.sin = Math.sin(ang);
  look.scale = scale;
  look.invScale = 1 / scale;
  look.spriteW = W;
  look.spriteH = H;
  look.halfPx = Math.max(W, H) * 0.5;
  look.cellPx = Math.max(T.cellMinPx, T.cellWorld / scale);
  const range = cloakFrontRange(T.spread);
  look.frontStart = range.start;
  look.frontEnd = range.end;

  // Ruch (prędkość i obrót) — wygładzony.
  const mRaw = Math.max((Number(pose?.speed) || 0) / T.motionSpeed, Math.abs(Number(pose?.turn) || 0) / T.motionTurn);
  const mT = clamp(mRaw, 0, 1);
  look.motion += (mT - look.motion) * (1 - Math.exp(-T.motionRate * d));

  // Przejścia stanu rozgrywki → zdarzenia efektów.
  const st = cloak ? cloak.state : 'off';
  const lb = cloak ? cloak.lastBreak : null;
  const prog0 = look.progress;
  if (lb !== look.lastBreak) {
    look.lastBreak = lb;
    if (lb && lb.forced) {
      look.glitchT = T.glitchSec;
      look.events |= CLOAK_EVENT.BREAK;
    } else if (lb && st === 'revealing') {
      look.events |= CLOAK_EVENT.REVEAL;
      // impuls siatki tylko przy wyjściu z pełnego ukrycia (nie przy cofnięciu w połowie włączania)
      if (prog0 > 0.98) { look.pulseT = T.pulseSec; look.pulseAmp = T.revealPulse; }
    }
  }
  if (st === 'engaging' && look.lastState !== 'engaging') {
    look.events |= CLOAK_EVENT.ENGAGE;
    if (prog0 < 0.02) { look.pulseT = T.pulseSec; look.pulseAmp = 1; }
  }
  if (st === 'on' && look.lastState !== 'on') look.events |= CLOAK_EVENT.HIDDEN;
  if ((st === 'off' || st === 'cooldown') && look.lastState === 'revealing') look.events |= CLOAK_EVENT.VISIBLE;
  look.lastState = st;
  if (look.glitchT > 0) look.glitchT = Math.max(0, look.glitchT - d);
  if (look.pulseT > 0) look.pulseT = Math.max(0, look.pulseT - d);

  // Postęp ukrycia i tryb (kierunek zmienia się tylko na krańcach — odwrócenie w połowie cofa front).
  const level = cloak && (st === 'engaging' || st === 'on' || st === 'revealing') ? clamp(Number(cloak.level) || 0, 0, 1) : 0;
  const p = st === 'on' ? 1 : cloakHiddenProgress(level);
  look.rate = d > 0 ? Math.abs(p - prog0) / d : look.rate;
  look.progress = p;
  if (p <= 0) look.mode = 1;
  else if (p >= 1) look.mode = -1;
  const mode = look.mode;
  const front = range.start + (range.end - range.start) * (mode > 0 ? p : 1 - p);

  let phase = 'off';
  let glitch = 0;
  let flicker = 0;
  if (st === 'engaging') phase = 'engage';
  else if (st === 'on') {
    phase = 'hidden';
    const e = cloak ? Number(cloak.energy) || 0 : 0;
    if (e < T.flickerEnergy) flicker = (1 - e / T.flickerEnergy) * T.flickerMax;
  } else if (st === 'revealing') phase = 'reveal';
  if (look.glitchT > 0) {
    if (phase === 'off') phase = 'glitch';
    const g = look.glitchT / T.glitchSec;
    glitch = g * g * (3 - 2 * g);
  }
  // Impuls siatki: obwiednia sin² w czasie impulsu.
  let pulse = 0;
  if (look.pulseT > 0) {
    const u = 1 - look.pulseT / T.pulseSec;
    pulse = look.pulseAmp * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 2;
  }
  look.phase = phase;
  look.active = phase !== 'off' || p > 0;
  look.front = front;
  look.dir = look.active ? mode : 0;
  look.pulse = pulse;
  look.glitch = glitch;
  look.flicker = flicker;
  look.vis = 1 - p;
  const dir = look.dir;

  // Slot kadłuba.
  const m = look.motion;
  const tint = look.tint;
  look.a.x = front; look.a.y = dir; look.a.z = glitch; look.a.w = flicker;
  look.b.x = T.rimHidden * (1 + 0.15 * flicker);
  look.b.y = m;
  look.b.z = look.cellPx;
  look.b.w = clamp(Math.log2(Math.max(1, T.rimWorld / scale)), 1, 6.5);
  look.c.x = tint[0]; look.c.y = tint[1]; look.c.z = tint[2]; look.c.w = pulse;
  look.d.x = look.seed;
  look.d.y = T.refractWorld * (1 + T.refractMotion * m);
  // Soczewka globalna: rośnie z postępem ukrycia (spójnie na całym okręcie, nie per komórka), w ruchu mocniej.
  look.d.z = Math.max(0, Number(T.lensStrength) || 0) * clamp(p + T.lensPulse * pulse, 0, 1.5) * (1 + T.lensMotion * m);
  look.d.w = T.spread;

  // Heksy-ekrany tylko przy awarii: pas przed powrotem komórek (wyłączanie — stan 'revealing', strona ukryta
  // frontu), losowa utrata obrazu przy końcówce energii; zerwanie liczy shader z zakłócenia (A.z).
  const tvOn = look.active && T.tvStrength > 0;
  look.e.x = front;
  look.e.y = tvOn && st === 'revealing' && p > 0 ? mode : 0;
  look.e.z = tvOn ? clamp(T.tvRateFlicker * flicker, 0, 1) : 0;
  look.e.w = clamp(Number(T.tvStrength) || 0, 0, 1);
  return look.active;
}
