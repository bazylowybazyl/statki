// src/ui/shipModeWheel.js
//
// KOŁO TRYBÓW OKRĘTU pod ŚPM — obraz i animacje (2026-10-12, prośba użytkownika: „ulepsz grafikę pola
// wyboru ŚPM, dodaj fajne animacje”). Wybór (sektor z ruchu myszy od miejsca wciśnięcia, stuknięcie =
// poprzedni tryb) zostaje w src/game/shipModes.js — tu tylko rysunek:
//   • sektory-szyby z wektorowymi IKONAMI trybów; każdy tryb ma swoją barwę (widać ją na wskazanym
//     i aktywnym trybie, reszta w stonowanej stali jak kopuła kokpitu); tryb niedostępny — kreskowanie
//     i kłódka;
//   • PIASTA: ikona i nazwa wskazanego trybu (nazwa „dekoduje się” jak podpisy skanu X); bez wskazania —
//     aktywny tryb, przygaszony. Pod kołem OPIS: zysk i koszt postawy albo klawisze trybu, dla trybu
//     niedostępnego — powód;
//   • ANIMACJE (czas rzeczywisty — koło nie zwalnia gry): otwarcie — wachlarz sektorów rozkłada się od
//     aktywnego trybu, obręcz rysuje się od góry, światło obiega koło jak antena; wskazanie —
//     podświetlenie na obręczy ślizga się sprężyną między sektorami, sektor wysuwa się i rozjaśnia, ikona
//     rośnie i ożywa (pulsuje, płynie, mruga), fala obrysu; wybór — błysk sektora, iskry, fala z piasty,
//     koło zwija się, a w jego środku zostaje na chwilę ECHO wybranego trybu (też po stuknięciu ŚPM);
//     odmowa — sektor czerwienieje, koło drży, w piaście kłódka; anulowanie — sektory chowają się do piasty.
//
// Czysty canvas 2D (jak weaponReticle.js): stan animacji w obiekcie `fx` (createModeWheelFx), krok
// stepModeWheelFx raz na klatkę, zdarzenie zamknięcia noteModeWheelClose (z obsługi puszczenia ŚPM),
// rysunek drawModeWheel. KOSZT: gdy koło stoi, tarcza i sektory bez wskazania idą z obrazów wypiekanych
// raz (fx.spr), poświata ikon i opis pod kołem też (fx.glow, fx.cap) — raster kanwy ~0,45 ms na klatkę
// w procesie GPU (rysowane wprost ~1,3 ms; dawne płaskie koło ~0,25 ms); na żywo tylko to, co się
// rusza. Gradienty z pamięci, napisy „dekodowania” to jedyne alokacje w spokojnej klatce. Lista pozycji
// jest ogólna (ikona po id, barwa, opis) — pod przyszłe „szybkie koło” pada (docs/PLAN-pad.md).

import { SHIP_MODE_IDS, SHIP_MODE_DEFS, SHIP_STANCE_TUNE, CRUISE_GEARS } from '../game/shipModes.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** Wymiary koła w px przy skali 1 (1080p). */
export const MODE_WHEEL_GEOM = Object.freeze({
  hub: 52,        // promień piasty
  inner: 66,      // wewnętrzna krawędź sektorów
  outer: 156,     // zewnętrzna krawędź sektorów
  pop: 9,         // wysunięcie wskazanego sektora
  gap: 3.4,       // szerokość szczeliny między sektorami (stała na całej długości)
  rim: 8,         // obręcz podświetlenia nad sektorami
  ticks: 18,      // podziałka nad obręczą
  icon: 32,       // ikona w sektorze
  hubIcon: 40,    // ikona w piaście
  caption: 22     // odstęp opisu od podziałki
});

/** Czasy animacji [s] i tempa [1/s]. */
export const MODE_WHEEL_TIME = Object.freeze({
  open: 0.26,      // rozkładanie całości (skala, przezroczystość)
  cascade: 0.03,   // opóźnienie sektora na krok od aktywnego trybu
  sector: 0.2,     // rozkładanie jednego sektora
  rimDraw: 0.34,   // obręcz rysuje się od góry
  ticks: 0.42,     // podziałka obraca się na miejsce
  sweep: 0.62,     // światło obiega koło przy otwarciu
  select: 0.36,    // błysk i zwinięcie po wyborze
  deny: 0.46,      // drżenie i czerwień po odmowie
  cancel: 0.16,    // zwinięcie bez wyboru
  tap: 0.13,       // zwinięcie po stuknięciu ŚPM (poprzedni tryb — zostaje echo)
  echo: 0.85,      // echo wybranego trybu w środku koła
  decode: 0.16,    // „dekodowanie” nazwy w piaście
  hub: 0.14,       // przenikanie ikon w piaście
  caption: 0.16,   // wjazd opisu
  hoverIn: 24,     // wysuwanie wskazanego sektora
  hoverOut: 11,    // chowanie
  hilite: 14,      // jasność podświetlenia na obręczy
  pulse: 3.4,      // gaśnięcie fali obrysu
  spring: 32       // sprężyna podświetlenia [rad/s] (krytycznie tłumiona)
});

/** Barwy trybów (wskazanie, aktywny tryb, echo). */
export const SHIP_MODE_COLORS = Object.freeze({
  combat: '#ff5a4f',
  shield: '#4fa3ff',
  cruise: '#ffc94d',
  cloak: '#b88dff',
  torpedo: '#3ad9ff',
  mining: '#a9e65e',
  fleet: '#43f0b2'
});

const C = Object.freeze({
  plate: '#03070d',
  glassOff: '#090e15',
  edge: '#8fb0cc',
  icon: '#b9c9d6',
  iconOff: '#536677',
  label: '#9fb4c3',
  labelOff: '#536677',
  key: '#61798a',
  tick: '#9cb8d0',
  bright: '#e4f2ff',
  deny: '#ff4d5e',
  denyText: '#ff8a94',
  gain: '#c9d7e2',
  cost: '#eaa0a7',
  keys: '#8fa3b0'
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeInCubic = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - 4 * (1 - t) * (1 - t) * (1 - t));
function easeOutBack(t, k = 1.6) {
  const u = t - 1;
  return 1 + (k + 1) * u * u * u + k * u * u;
}
function smooth(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const wrapPi = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
function ringDist(i, j, n) {
  const d = Math.abs(i - j) % n;
  return Math.min(d, n - d);
}

// Liczby po polsku: 2,5 / 0,55.
function num(v) {
  return String(Math.round(v * 100) / 100).replace('.', ',');
}

// ---------------------------------------------------------------------------------------------------
// OPISY TRYBÓW (liczby z nastaw postaw — zmiana SHIP_STANCE_TUNE zmienia opis sama).
// gain — co daje tryb (albo jak się nim posługiwać), cost — koszt postawy albo klawisze; costKind:
// 'cost' (czerwonawy) / 'keys' (szary).

export function shipModeHint(id) {
  const sh = SHIP_STANCE_TUNE.shield;
  const cr = SHIP_STANCE_TUNE.cruise;
  const gears = CRUISE_GEARS.muls;
  switch (id) {
    case 'combat':
      return { gain: 'Broń gotowa, napęd i tarcza bez ograniczeń', cost: '', costKind: 'cost' };
    case 'shield':
      return {
        gain: `Tarcza: ładowanie ×${num(sh.shieldRegen)}, obrażenia ×${num(sh.shieldTaken)}, pole ×${num(sh.shieldHardness)} twardsze`,
        cost: `Prędkość ×${num(sh.speed)}, obrót ×${num(sh.turnRate)}`,
        costKind: 'cost'
      };
    case 'cruise':
      return {
        gain: `Biegi do ×${num(gears[gears.length - 1])} prędkości bojowej, Ctrl — bieg w dół`,
        cost: `Broń zimna, ładowanie tarczy ×${num(cr.shieldRegen)}`,
        costKind: 'cost'
      };
    case 'cloak':
      return { gain: 'Okręt niewidoczny dla wroga', cost: 'Zużywa energię; strzał, trafienie albo taran zrywa', costKind: 'cost' };
    case 'torpedo':
      return { gain: 'LPM — wachlarz torped z gotowych wyrzutni', cost: '8 — szeroki / wąski wachlarz · PPM — wyjście', costKind: 'keys' };
    case 'mining':
      return { gain: 'LPM — lasery dronów · PPM — ładunek, przeciągnięcie — piła', cost: 'L — ładunek · F — detonacja · T — wiązka', costKind: 'keys' };
    case 'fleet':
      return { gain: 'Widok taktyczny: zaznaczanie i rozkazy dla floty', cost: 'LPM — zaznacz · PPM — rozkaz', costKind: 'keys' };
    default:
      return { gain: '', cost: '', costKind: 'keys' };
  }
}

/**
 * Pozycje koła trybów okrętu (SHIP_MODE_IDS, sektor 0 u góry, zgodnie z zegarem). Pola stałe; avail
 * i reason odświeża co klatkę klej gry (shipModeBlockReason).
 */
export function buildShipModeWheelItems() {
  return SHIP_MODE_IDS.map((id) => {
    const def = SHIP_MODE_DEFS[id];
    const hint = shipModeHint(id);
    return {
      id,
      icon: id,
      label: def.label,
      key: def.key ? `[${def.key}]` : '',
      color: SHIP_MODE_COLORS[id] || C.bright,
      gain: hint.gain,
      cost: hint.cost,
      costKind: hint.costKind,
      avail: true,
      reason: ''
    };
  });
}

/** Zasięg rysunku od środka koła w górę / w dół [px] — do ustawienia środka na ekranie. */
export function modeWheelExtent(scale = 1) {
  const g = MODE_WHEEL_GEOM;
  // Opis: do trzech wierszy po ~17 px pod podziałką.
  return { up: (g.outer + g.pop + g.ticks + 6) * scale, down: (g.outer + g.rim + g.ticks + g.caption + 52) * scale };
}

/** Skala koła z rozmiaru ekranu (jak kokpit: 1080p = 1). */
export function modeWheelScale(W, H) {
  const s = Math.min((Number(H) || 1080) / 1080, (Number(W) || 1920) / 1380);
  return s < 0.72 ? 0.72 : s > 1.4 ? 1.4 : s;
}

// ---------------------------------------------------------------------------------------------------
// STAN ANIMACJI

export function createModeWheelFx(count = SHIP_MODE_IDS.length) {
  return {
    n: count,
    open: false,
    openAt: -1e9,
    last: -1,
    // Zamknięcie: 'select' | 'tap' | 'deny' | 'cancel' | '' (brak).
    closeKind: '',
    closeAt: -1e9,
    closeIdx: -1,
    closeOpenT: 0,     // czas od otwarcia w chwili zamknięcia (stuknięcie: koło ledwie rozłożone)
    hover: -1,
    hoverAt: -1e9,     // zmiana wskazania (fala, dekodowanie nazwy, wjazd opisu)
    hl: 0,             // kąt podświetlenia na obręczy (sprężyna)
    hlV: 0,
    hlA: 0,            // jasność podświetlenia
    hlIdx: -1,         // tryb, którego barwę ma podświetlenie
    h: new Float32Array(count),      // wysunięcie sektorów 0..1
    pulse: new Float32Array(count),  // fala obrysu po wskazaniu 1 → 0
    hubIdx: -1,        // tryb w piaście
    hubPrev: -1,
    hubAt: -1e9,
    hubHover: false,   // piasta pokazuje wskazany (true) czy aktywny tryb
    echoIdx: -1,
    echoAt: -1e9,
    x: 0,              // środek ostatniego rysunku (zamknięcie i echo zostają w miejscu)
    y: 0,
    scale: 0,
    fonts: null,
    wrap: new Map(),   // tekst → podział na wiersze opisu
    // Gradienty z pamięci (nowy tylko przy zmianie geometrii): winieta, cień koła, szyby sektorów
    // i światło wskazanych sektorów.
    vig: { grad: null, x: 0, y: 0, r0: 0, r1: 0, color: '' },
    shade: { grad: null, x: 0, y: 0, r0: 0, r1: 0, color: '' },
    glass: { grad: null, x: 0, y: 0, r0: 0, r1: 0, color: '' },
    sg: Array.from({ length: count }, () => ({ grad: null, x: 0, y: 0, r0: 0, r1: 0, color: '' })),
    // Obrazy koła w spoczynku (tarcza z podziałką i piastą, każdy sektor osobno) — wypiekane raz na układ
    // (skala, środek, aktywny tryb, dostępność); klatka w spoczynku to kilka drawImage zamiast ~150
    // operacji ścieżek i tekstu. Na żywo tylko to, co się rusza: wskazany sektor, podświetlenie, piasta.
    spr: { ok: false, s: 0, cx: 0, cy: 0, current: -2, mask: -1, items: null, n: 0, frame: null, fx: 0, fy: 0, sec: [] },
    // Poświata ikon: sam rozmyty cień ikony, wypiekany raz (shadowBlur na każdej kresce ikony kosztował
    // ~0,3 ms rastra na klatkę); sm — ikona sektora, lg — piasta i echo.
    glow: Array.from({ length: count }, () => ({
      sm: { c: null, size: 0, blur: 0, color: '', dim: 0 },
      lg: { c: null, size: 0, blur: 0, color: '', dim: 0 }
    })),
    // Opis pod kołem z cieniem — wypiekany raz na tryb (zmienia się tylko ze wskazaniem i powodem odmowy).
    cap: Array.from({ length: count }, () => ({ c: null, font: '', maxW: 0, reason: '', avail: true, w: 0, h: 0, pad: 0 }))
  };
}

function cachedRadial(ctx, rec, x, y, r0, r1, color, inner, outer) {
  if (rec.grad && rec.x === x && rec.y === y && rec.r0 === r0 && rec.r1 === r1 && rec.color === color) return rec.grad;
  const grad = ctx.createRadialGradient(x, y, r0, x, y, r1);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  rec.grad = grad;
  rec.x = x; rec.y = y; rec.r0 = r0; rec.r1 = r1; rec.color = color;
  return grad;
}

function closeDuration(kind) {
  const T = MODE_WHEEL_TIME;
  switch (kind) {
    case 'select': return T.select;
    case 'deny': return T.deny;
    case 'cancel': return T.cancel;
    case 'tap': return T.tap;
    default: return 0;
  }
}

function beginClose(fx, kind, idx, now) {
  fx.closeOpenT = Math.max(0, now - fx.openAt);
  fx.open = false;
  fx.closeKind = kind;
  fx.closeAt = now;
  fx.closeIdx = idx;
  if ((kind === 'select' || kind === 'tap') && idx >= 0) {
    fx.echoIdx = idx;
    fx.echoAt = now;
  }
}

/**
 * Zamknięcie koła z obsługi puszczenia ŚPM: kind — 'select' (tryb z sektora, także wskazany bieżący),
 * 'tap' (stuknięcie — poprzedni tryb), 'deny' (tryb niedostępny), 'cancel' (bez wyboru); idx — sektor
 * trybu (-1 bez sektora).
 */
export function noteModeWheelClose(fx, kind, idx, now) {
  if (fx.open) {
    beginClose(fx, kind, idx, now);
  } else if ((kind === 'select' || kind === 'tap') && idx >= 0) {
    // Stuknięcie krótsze niż klatka: koła nie było widać — zostaje samo echo.
    fx.echoIdx = idx;
    fx.echoAt = now;
  }
}

/**
 * Krok animacji, raz na klatkę (czas rzeczywisty [s]). open / hover — stan koła z shipModes.wheel,
 * current — sektor aktywnego trybu.
 */
export function stepModeWheelFx(fx, open, hover, current, now) {
  const T = MODE_WHEEL_TIME;
  const dt = fx.last >= 0 ? Math.min(0.1, Math.max(0, now - fx.last)) : 0;
  fx.last = now;
  const n = fx.n;
  if (open && !fx.open) {
    fx.open = true;
    fx.openAt = now;
    fx.closeKind = '';
    fx.hover = -1;
    fx.hlA = 0;
    fx.hlIdx = -1;
    fx.h.fill(0);
    fx.pulse.fill(0);
    fx.echoIdx = -1;
    fx.hubIdx = current;
    fx.hubPrev = -1;
    fx.hubAt = -1e9;
    fx.hubHover = false;
  } else if (!open && fx.open) {
    // Zamknięcie bez zgłoszenia (utrata fokusu, kursor poza oknem) — zwinięcie jak anulowanie.
    beginClose(fx, 'cancel', -1, now);
  }
  if (fx.open && hover !== fx.hover) {
    if (hover >= 0 && hover < n) {
      fx.pulse[hover] = 1;
      fx.hoverAt = now;
      // Pierwsze wskazanie: podświetlenie od razu w sektorze (bez jazdy z zapomnianego miejsca).
      if (fx.hlA < 0.05) {
        fx.hl = -HALF_PI + hover * (TAU / n);
        fx.hlV = 0;
      }
      fx.hlIdx = hover;
    }
    fx.hover = hover;
  }
  const hov = fx.open ? fx.hover : -1;
  for (let i = 0; i < n; i++) {
    const goal = hov === i ? 1 : 0;
    const rate = goal > fx.h[i] ? T.hoverIn : T.hoverOut;
    fx.h[i] += (goal - fx.h[i]) * (1 - Math.exp(-rate * dt));
    fx.pulse[i] = Math.max(0, fx.pulse[i] - dt * T.pulse);
  }
  // Podświetlenie: sprężyna krytycznie tłumiona (rozwiązanie dokładne — stabilne przy każdym dt),
  // cel najkrótszą drogą po okręgu.
  if (hov >= 0) {
    const target = fx.hl + wrapPi(-HALF_PI + hov * (TAU / n) - fx.hl);
    const w = T.spring;
    const c1 = fx.hl - target;
    const c2 = fx.hlV + w * c1;
    const e = Math.exp(-w * dt);
    fx.hl = target + (c1 + c2 * dt) * e;
    fx.hlV = (c2 - w * (c1 + c2 * dt)) * e;
  }
  fx.hlA += ((hov >= 0 ? 1 : 0) - fx.hlA) * (1 - Math.exp(-T.hilite * dt));
  // Piasta: wskazany tryb albo aktywny.
  if (fx.open) {
    const want = hov >= 0 ? hov : current;
    const wantHover = hov >= 0;
    if (want !== fx.hubIdx || wantHover !== fx.hubHover) {
      if (want !== fx.hubIdx) {
        fx.hubPrev = fx.hubIdx;
        fx.hubAt = now;
      }
      fx.hubIdx = want;
      fx.hubHover = wantHover;
    }
  }
}

/** Czy koło, jego zamykanie albo echo jest jeszcze widoczne. */
export function modeWheelVisible(fx, now) {
  if (fx.open) return true;
  if (fx.closeKind && now - fx.closeAt < closeDuration(fx.closeKind)) return true;
  return fx.echoIdx >= 0 && now - fx.echoAt < MODE_WHEEL_TIME.echo;
}

// ---------------------------------------------------------------------------------------------------
// IKONY (wektorowe; u — połowa boku ikony, a — ożywienie 0..1 przy wskazaniu, t — czas [s]).
// Kolor i grubość linii ustawia wołający (strokeStyle = fillStyle = barwa).

function iconCombat(ctx, x, y, u, a, t) {
  const r = u * 0.56;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  const breathe = a * (0.5 + 0.5 * Math.sin(t * 7)) * 0.12 * u;
  const g0 = u * 0.3 - breathe;
  const g1 = u * 0.98;
  ctx.beginPath();
  ctx.moveTo(x, y - g0); ctx.lineTo(x, y - g1);
  ctx.moveTo(x, y + g0); ctx.lineTo(x, y + g1);
  ctx.moveTo(x - g0, y); ctx.lineTo(x - g1, y);
  ctx.moveTo(x + g0, y); ctx.lineTo(x + g1, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, u * 0.1, 0, TAU);
  ctx.fill();
}

function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const ang = -HALF_PI + k * (Math.PI / 3);
    const px = x + Math.cos(ang) * r;
    const py = y + Math.sin(ang) * r;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function iconShield(ctx, x, y, u, a, t) {
  ctx.beginPath();
  ctx.moveTo(x - u * 0.74, y - u * 0.8);
  ctx.lineTo(x + u * 0.74, y - u * 0.8);
  ctx.lineTo(x + u * 0.74, y - u * 0.05);
  ctx.quadraticCurveTo(x + u * 0.66, y + u * 0.62, x, y + u * 0.98);
  ctx.quadraticCurveTo(x - u * 0.66, y + u * 0.62, x - u * 0.74, y - u * 0.05);
  ctx.closePath();
  ctx.stroke();
  const k = 1 + a * 0.14 * Math.sin(t * 6);
  hexPath(ctx, x, y - u * 0.04, u * 0.34 * k);
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * (0.3 + 0.25 * a);
  ctx.fill();
  ctx.globalAlpha = ga;
  ctx.stroke();
}

function iconCruise(ctx, x, y, u, a, t) {
  // Trzy szewrony ku górze; przy wskazaniu płyną w górę (prędkość).
  const phase = a > 0.01 ? (t * 1.7) % 1 : 0;
  const ga = ctx.globalAlpha;
  const span = u * 0.44;
  for (let k = -1; k < 3; k++) {
    const p = k + phase;                           // 0..3 od dołu
    const cy = y + u * 0.62 - p * span;
    const vis = smooth(-0.6, 0.35, p) * (1 - smooth(2.25, 3, p));
    if (vis <= 0.01) continue;
    ctx.globalAlpha = ga * vis * (0.55 + 0.15 * p);
    ctx.beginPath();
    ctx.moveTo(x - u * 0.66, cy + u * 0.3);
    ctx.lineTo(x, cy - u * 0.12);
    ctx.lineTo(x + u * 0.66, cy + u * 0.3);
    ctx.stroke();
  }
  ctx.globalAlpha = ga;
}

function iconCloak(ctx, x, y, u, a, t) {
  ctx.beginPath();
  ctx.moveTo(x - u * 0.92, y);
  ctx.quadraticCurveTo(x, y - u * 0.82, x + u * 0.92, y);
  ctx.quadraticCurveTo(x, y + u * 0.82, x - u * 0.92, y);
  ctx.closePath();
  ctx.stroke();
  const look = a * Math.sin(t * 2.6) * u * 0.18;
  ctx.beginPath();
  ctx.arc(x + look, y, u * 0.24, 0, TAU);
  ctx.fill();
  // Ukośnik z czarną przerwą (czytelny na ikonie).
  const lw = ctx.lineWidth;
  const ss = ctx.strokeStyle;
  ctx.strokeStyle = C.plate;
  ctx.lineWidth = lw * 2.6;
  ctx.beginPath();
  ctx.moveTo(x - u * 0.72, y + u * 0.74);
  ctx.lineTo(x + u * 0.72, y - u * 0.74);
  ctx.stroke();
  ctx.strokeStyle = ss;
  ctx.lineWidth = lw;
  ctx.stroke();
}

// Torpeda: kapsuła od ogona (x, y) w kierunku (c, s), długość len, szerokość wid, śruba w poprzek ogona.
function torpedoPath(ctx, x, y, c, s, len, wid) {
  const hw = wid * 0.5;
  const nb = len - hw * 1.6;        // początek nosa
  ctx.moveTo(x + s * hw, y - c * hw);
  ctx.lineTo(x + c * nb + s * hw, y + s * nb - c * hw);
  ctx.quadraticCurveTo(x + c * len + s * hw * 0.9, y + s * len - c * hw * 0.9, x + c * len, y + s * len);
  ctx.quadraticCurveTo(x + c * len - s * hw * 0.9, y + s * len + c * hw * 0.9, x + c * nb - s * hw, y + s * nb + c * hw);
  ctx.lineTo(x - s * hw, y + c * hw);
  ctx.closePath();
  const pw = hw * 1.35;
  ctx.moveTo(x + s * pw, y - c * pw);
  ctx.lineTo(x - s * pw, y + c * pw);
}

function iconTorpedo(ctx, x, y, u, a, t) {
  // Salwa trzech torped (środkowa wysunięta) z kilwaterem; przy wskazaniu torpedy pchają się naprzód,
  // a kilwater płynie za śrubami.
  const len = u * 1.02, wid = u * 0.26;
  const flow = a > 0.01 ? (t * 2.2) % 1 : 0;
  ctx.beginPath();
  for (let k = -1; k <= 1; k++) {
    const surge = a * u * 0.07 * Math.sin(t * 6 + k * 1.3);
    const tx = x + k * u * 0.5;
    const ty = y + u * (k === 0 ? 0.36 : 0.62) - surge;
    torpedoPath(ctx, tx, ty, 0, -1, len, wid);
    for (let j = 0; j < 2; j++) {
      const q = u * (0.14 + (j + flow) * 0.16);
      if (ty + q + u * 0.07 > y + u * 1.02) continue;
      ctx.moveTo(tx, ty + q);
      ctx.lineTo(tx, ty + q + u * 0.07);
    }
  }
  ctx.stroke();
}

const ROCK_R = Object.freeze([1, 0.82, 0.97, 0.76, 1.04, 0.85, 0.96, 0.79, 0.99]);

function iconMining(ctx, x, y, u, a, t) {
  // Asteroida pęka od miejsca trafienia wiązki lasera z drona górniczego (romb w rogu).
  const rx = x + u * 0.2, ry = y + u * 0.22, rr = u * 0.7;
  ctx.beginPath();
  for (let k = 0; k < ROCK_R.length; k++) {
    const ang = 0.2 + k * (TAU / ROCK_R.length);
    const px = rx + Math.cos(ang) * rr * ROCK_R[k];
    const py = ry + Math.sin(ang) * rr * ROCK_R[k];
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * 0.2;
  ctx.fill();
  ctx.globalAlpha = ga;
  ctx.stroke();
  // Kierunek dron → środek skały; punkt trafienia na powierzchni.
  const ex = x - u * 0.78, ey = y - u * 0.78;
  let dx = rx - ex, dy = ry - ey;
  const dl = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= dl; dy /= dl;
  const ix = rx - dx * rr * 0.84, iy = ry - dy * rr * 0.84;
  // Pęknięcie od punktu trafienia w głąb skały (zygzak).
  ctx.beginPath();
  ctx.moveTo(ix, iy);
  ctx.lineTo(ix + dx * rr * 0.42 + dy * rr * 0.2, iy + dy * rr * 0.42 - dx * rr * 0.2);
  ctx.lineTo(ix + dx * rr * 0.78 - dy * rr * 0.08, iy + dy * rr * 0.78 + dx * rr * 0.08);
  ctx.lineTo(ix + dx * rr * 1.08 + dy * rr * 0.16, iy + dy * rr * 1.08 - dx * rr * 0.16);
  ctx.stroke();
  // Dron: romb.
  const ds = u * 0.17;
  ctx.beginPath();
  ctx.moveTo(ex, ey - ds); ctx.lineTo(ex + ds, ey); ctx.lineTo(ex, ey + ds); ctx.lineTo(ex - ds, ey);
  ctx.closePath();
  ctx.fill();
  // Wiązka (miga przy wskazaniu) i iskry na boki.
  ctx.globalAlpha = ga * (a > 0.01 ? 0.7 + 0.3 * Math.sin(t * 31) * a : 1);
  ctx.beginPath();
  ctx.moveTo(ex + dx * ds * 1.2, ey + dy * ds * 1.2);
  ctx.lineTo(ix, iy);
  ctx.stroke();
  ctx.globalAlpha = ga;
  const base = Math.atan2(-dy, -dx);
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const side = k < 2 ? -1 : 1;
    const ang = base + side * (k % 2 ? 1.15 : 0.6) + a * 0.25 * Math.sin(t * 11 + k * 2.1);
    const r0 = u * 0.12, r1 = u * ((k % 2 ? 0.26 : 0.34) + 0.07 * a * Math.sin(t * 17 + k));
    ctx.moveTo(ix + Math.cos(ang) * r0, iy + Math.sin(ang) * r0);
    ctx.lineTo(ix + Math.cos(ang) * r1, iy + Math.sin(ang) * r1);
  }
  ctx.stroke();
}

function shipArrow(ctx, x, y, s) {
  ctx.moveTo(x, y - s * 1.15);
  ctx.lineTo(x + s * 0.78, y + s * 0.85);
  ctx.lineTo(x, y + s * 0.45);
  ctx.lineTo(x - s * 0.78, y + s * 0.85);
  ctx.closePath();
}

function iconFleet(ctx, x, y, u, a, t) {
  const s = u * 0.3;
  const bob = a * u * 0.07;
  ctx.beginPath();
  shipArrow(ctx, x, y - u * 0.34 + Math.sin(t * 4) * bob, s);
  shipArrow(ctx, x - u * 0.56, y + u * 0.3 + Math.sin(t * 4 + 2.1) * bob, s);
  shipArrow(ctx, x + u * 0.56, y + u * 0.3 + Math.sin(t * 4 + 4.2) * bob, s);
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * 0.35;
  ctx.fill();
  ctx.globalAlpha = ga;
  ctx.stroke();
  // Narożniki zaznaczenia (rozkazy RTS).
  const b = u * 0.98, l = u * 0.3;
  ctx.beginPath();
  ctx.moveTo(x - b, y - b + l); ctx.lineTo(x - b, y - b); ctx.lineTo(x - b + l, y - b);
  ctx.moveTo(x + b - l, y - b); ctx.lineTo(x + b, y - b); ctx.lineTo(x + b, y - b + l);
  ctx.moveTo(x - b, y + b - l); ctx.lineTo(x - b, y + b); ctx.lineTo(x - b + l, y + b);
  ctx.moveTo(x + b - l, y + b); ctx.lineTo(x + b, y + b); ctx.lineTo(x + b, y + b - l);
  ctx.stroke();
}

function iconLock(ctx, x, y, u) {
  ctx.beginPath();
  ctx.rect(x - u * 0.5, y - u * 0.06, u, u * 0.78);
  ctx.moveTo(x - u * 0.3, y - u * 0.06);
  ctx.lineTo(x - u * 0.3, y - u * 0.36);
  ctx.arc(x, y - u * 0.36, u * 0.3, Math.PI, 0);
  ctx.lineTo(x + u * 0.3, y - u * 0.06);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y + u * 0.3, u * 0.1, 0, TAU);
  ctx.fill();
}

export const MODE_WHEEL_ICONS = Object.freeze({
  combat: iconCombat,
  shield: iconShield,
  cruise: iconCruise,
  cloak: iconCloak,
  torpedo: iconTorpedo,
  mining: iconMining,
  fleet: iconFleet
});

/** Ikona trybu (size — bok w px). Rysuje barwą color; a, t — ożywienie przy wskazaniu. */
export function drawModeWheelIcon(ctx, icon, x, y, size, color, a = 0, t = 0) {
  const fn = MODE_WHEEL_ICONS[icon];
  if (!fn) return;
  const u = size * 0.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.3, size * 0.072);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  fn(ctx, x, y, u, a, t);
}

// ---------------------------------------------------------------------------------------------------
// RYSUNEK

function ensureFonts(fx, s) {
  if (fx.fonts && fx.scale === s) return fx.fonts;
  const px = (base, floor) => Math.max(floor, Math.round(base * s));
  fx.scale = s;
  fx.fonts = {
    label: `${px(11, 10)}px Consolas, monospace`,
    labelB: `600 ${px(11, 10)}px Consolas, monospace`,
    key: `${px(10, 10)}px Consolas, monospace`,
    name: `600 ${px(15, 12)}px Consolas, monospace`,
    cap: `${px(12, 11)}px Consolas, monospace`,
    echo: `600 ${px(17, 14)}px Consolas, monospace`,
    capLine: px(17, 15)
  };
  return fx.fonts;
}

const GLYPHS = '0123456789ABCDEFGHJKLMNPRSTUWXYZ#/<>=+';
function scramble(text, k, seed) {
  if (k >= 1) return text;
  const n = text.length;
  const settled = Math.floor(n * k);
  let out = text.slice(0, settled);
  for (let i = settled; i < n; i++) {
    if (text.charCodeAt(i) === 32) { out += ' '; continue; }
    const h = ((seed * 31 + i * 17 + Math.floor(k * 30) * 7) >>> 0) % GLYPHS.length;
    out += GLYPHS[h];
  }
  return out;
}

// Ścieżka sektora: pierścień między r0 i r1, szczeliny o stałej szerokości 2g, przesunięcie off wzdłuż
// osi sektora (wysunięcie).
function sectorPath(ctx, cx, cy, ac, half, r0, r1, g, off) {
  const ox = cx + Math.cos(ac) * off;
  const oy = cy + Math.sin(ac) * off;
  const d1 = Math.asin(Math.min(0.9, g / Math.max(1, r1)));
  const d0 = Math.asin(Math.min(0.9, g / Math.max(1, r0)));
  ctx.beginPath();
  ctx.arc(ox, oy, r1, ac - half + d1, ac + half - d1);
  ctx.arc(ox, oy, Math.max(0.5, r0), ac + half - d0, ac - half + d0, true);
  ctx.closePath();
}

// Linia z poświatą (dodawanie światła): szeroka słaba, średnia, ostra.
function glowStroke(ctx, color, width, alpha) {
  ctx.strokeStyle = color;
  const ga = ctx.globalAlpha;
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = ga * alpha * 0.12;
  ctx.lineWidth = width * 4.5;
  ctx.stroke();
  ctx.globalAlpha = ga * alpha * 0.26;
  ctx.lineWidth = width * 2.2;
  ctx.stroke();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = ga * alpha;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.globalAlpha = ga;
}

// Cień pod napisem — tylko nad polem bitwy (opis pod kołem, echo); na ciemnych szybach koła zbędny.
function textShadow(ctx, on) {
  ctx.shadowColor = on ? 'rgba(0, 0, 0, 0.9)' : 'transparent';
  ctx.shadowBlur = on ? 4 : 0;
}

// Podział opisu na najwyżej 2 wiersze o szerokości maxW (pamięć po tekście).
function wrapCaption(ctx, fx, text, maxW) {
  let rec = fx.wrap.get(text);
  if (rec && rec.maxW === maxW && rec.font === ctx.font) return rec;
  rec = { maxW, font: ctx.font, a: text, b: '' };
  if (ctx.measureText(text).width > maxW) {
    const words = text.split(' ');
    let line = '';
    let i = 0;
    for (; i < words.length; i++) {
      const next = line ? `${line} ${words[i]}` : words[i];
      if (line && ctx.measureText(next).width > maxW) break;
      line = next;
    }
    rec.a = line;
    rec.b = words.slice(i).join(' ');
  }
  if (fx.wrap.size > 64) fx.wrap.clear();
  fx.wrap.set(text, rec);
  return rec;
}

/** „TORPEDY: brak wyrzutni…” → „Brak wyrzutni…” (nazwa trybu jest już w piaście). */
export function stripModePrefix(reason, label) {
  const r = String(reason || '');
  if (!r) return '';
  const colon = r.indexOf(':');
  let out = r;
  if (colon > 0 && colon <= 16 && label && r.slice(0, colon).trim().toUpperCase() === String(label).toUpperCase()) {
    out = r.slice(colon + 1).trim();
  }
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : '';
}

// Zwinięcie bez błysku: anulowanie i stuknięcie (po stuknięciu zostaje echo).
const isFold = (kind) => kind === 'cancel' || kind === 'tap';

// Czas od otwarcia, po którym koło stoi (wachlarz rozłożony, obręcz narysowana, podziałka na miejscu) —
// od niego tarcza i nieruszane sektory idą z pamięci obrazów.
function settleTime(n) {
  const T = MODE_WHEEL_TIME;
  return Math.max(T.open, T.rimDraw, T.ticks, Math.floor(n / 2) * T.cascade + T.sector);
}

// Wartości klatki wspólne dla sektorów (jeden obiekt na moduł — bez alokacji).
const F = {
  A: 1, kOpen: 1, tOpen: 0, kind: '', tc: 0, now: 0,
  cx: 0, cy: 0, k: 1, rIn: 0, rOut: 0, g: 0, step: 0, half: 0, current: -1, glass: null
};

const GLASS_IN = '#09111b';
const GLASS_OUT = '#192b3f';
const SHADE_IN = 'rgba(0, 0, 0, 0.5)';
const SHADE_OUT = 'rgba(0, 0, 0, 0)';

const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

// Poświata ikony z pamięci: kształt rysowany poza płótnem, na płótno trafia tylko jego cień (shadowOffsetX).
function iconGlow(rec, icon, color, size, blur) {
  if (!hasDom()) return null;
  size = Math.round(size);
  blur = Math.max(1, Math.round(blur));
  if (rec.c && rec.size === size && rec.blur === blur && rec.color === color) return rec;
  const dim = Math.ceil(size * 1.4 + blur * 4);
  if (!rec.c) rec.c = document.createElement('canvas');
  rec.c.width = dim;
  rec.c.height = dim;
  const g = rec.c.getContext('2d');
  const shift = dim * 3;
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.shadowOffsetX = shift;
  drawModeWheelIcon(g, icon, dim / 2 - shift, dim / 2, size, color, 0, 0);
  rec.size = size;
  rec.blur = blur;
  rec.color = color;
  rec.dim = dim;
  return rec;
}

function drawGlow(ctx, rec, x, y, size, alpha) {
  if (!rec || !(alpha > 0.01)) return;
  const d = rec.dim * size / rec.size;
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.drawImage(rec.c, x - d / 2, y - d / 2, d, d);
  ctx.globalAlpha = ga;
}

// Opis pod kołem wypiekany z cieniem: zysk i koszt postawy / klawisze albo powód odmowy (do 3 wierszy).
function captionSprite(fx, i, it, maxW) {
  if (!hasDom()) return null;
  const rec = fx.cap[i];
  const fonts = fx.fonts;
  const avail = it.avail !== false;
  const reason = avail ? '' : String(it.reason || '');
  if (rec.c && rec.font === fonts.cap && rec.maxW === maxW && rec.reason === reason && rec.avail === avail) return rec;
  if (!rec.c) rec.c = document.createElement('canvas');
  const g = rec.c.getContext('2d');
  g.font = fonts.cap;
  const lines = [];
  if (!avail) {
    const w = wrapCaption(g, fx, stripModePrefix(reason, it.label) || 'Tryb niedostępny', maxW);
    lines.push(w.a, C.denyText);
    if (w.b) lines.push(w.b, C.denyText);
  } else {
    if (it.gain) {
      const w = wrapCaption(g, fx, it.gain, maxW);
      lines.push(w.a, C.gain);
      if (w.b) lines.push(w.b, C.gain);
    }
    if (it.cost) lines.push(it.cost, it.costKind === 'cost' ? C.cost : C.keys);
  }
  let width = 1;
  for (let j = 0; j < lines.length; j += 2) width = Math.max(width, g.measureText(lines[j]).width);
  const lh = fonts.capLine;
  const pad = 8;
  rec.w = Math.ceil(width) + pad * 2;
  rec.h = Math.ceil((lines.length / 2) * lh) + pad * 2;
  rec.pad = pad;
  rec.c.width = rec.w;
  rec.c.height = rec.h;
  g.font = fonts.cap;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  textShadow(g, true);
  for (let j = 0; j < lines.length; j += 2) {
    g.fillStyle = lines[j + 1];
    g.fillText(lines[j], rec.w / 2, pad + lh * (j / 2 + 0.5));
  }
  rec.font = fonts.cap;
  rec.maxW = maxW;
  rec.reason = reason;
  rec.avail = avail;
  return rec;
}

/**
 * Koło. view: { x, y — środek, scale, W, H — ekran, items (buildShipModeWheelItems), current — sektor
 * aktywnego trybu, px, py — wektor wskaźnika od punktu wciśnięcia [px], deadzone [px] }.
 * Zwraca true, gdy coś narysowano.
 */
export function drawModeWheel(ctx, fx, view, now) {
  const kind = fx.open ? '' : fx.closeKind;
  const closing = !!kind && now - fx.closeAt < closeDuration(kind);
  const echo = fx.echoIdx >= 0 && now - fx.echoAt < MODE_WHEEL_TIME.echo;
  if (!fx.open && !closing && !echo) return false;
  fx.x = view.x;
  fx.y = view.y;
  const s = Math.max(0.5, Number(view.scale) || 1);
  ensureFonts(fx, s);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (fx.open || closing) drawWheelBody(ctx, fx, view, now, closing ? kind : '', s);
  if (echo) drawEcho(ctx, fx, view, now, s);
  ctx.restore();
  return true;
}

// Tarcza pod sektorami i cień wokół koła (grow 0..1 — przy otwarciu rosną od piasty).
function drawPlate(ctx, cx, cy, k, A, grow, shadeRec) {
  const G = MODE_WHEEL_GEOM;
  const rHub = G.hub * k;
  const rPlate = rHub + ((G.outer + G.rim + 3) * k - rHub) * grow;
  ctx.globalAlpha = A * grow;
  ctx.fillStyle = cachedRadial(ctx, shadeRec, cx, cy, rPlate, rPlate + 34 * k, 'shade', SHADE_IN, SHADE_OUT);
  ctx.beginPath();
  ctx.arc(cx, cy, rPlate + 34 * k, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = A * 0.66;
  ctx.fillStyle = C.plate;
  ctx.beginPath();
  ctx.arc(cx, cy, rPlate, 0, TAU);
  ctx.fill();
}

// Podziałka: 12 kresek na sektor, długie na granicach sektorów (rot — obrót przy otwarciu).
function drawTicks(ctx, cx, cy, k, A, rot, n, half) {
  const G = MODE_WHEEL_GEOM;
  const rTick = (G.outer + G.rim + G.ticks * 0.55) * k;
  const nTicks = n * 12;
  const tStep = TAU / nTicks;
  ctx.lineWidth = Math.max(1, k);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = C.tick;
  ctx.globalAlpha = A * 0.22;
  ctx.beginPath();
  for (let i = 0; i < nTicks; i++) {
    const a = -HALF_PI - half + i * tStep + rot;
    const major = i % 12 === 0;
    const r0 = rTick - (major ? 5 : 2.5) * k;
    const r1 = rTick + (major ? 3 : 0) * k;
    const c = Math.cos(a), sn = Math.sin(a);
    ctx.moveTo(cx + c * r0, cy + sn * r0);
    ctx.lineTo(cx + c * r1, cy + sn * r1);
  }
  ctx.stroke();
}

// Kreski przy wskaźniku rozjaśnione i grot dokładnego kierunku na podziałce.
function drawTickPointer(ctx, cx, cy, k, A, rot, n, half, pa, pAct, accent) {
  const G = MODE_WHEEL_GEOM;
  const rTick = (G.outer + G.rim + G.ticks * 0.55) * k;
  const nTicks = n * 12;
  const tStep = TAU / nTicks;
  ctx.lineWidth = Math.max(1, k);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = accent;
  ctx.beginPath();
  for (let i = 0; i < nTicks; i++) {
    const a = -HALF_PI - half + i * tStep + rot;
    if (Math.abs(wrapPi(a - pa)) > 0.42) continue;
    const r0 = rTick - (i % 12 === 0 ? 5 : 2.5) * k;
    const c = Math.cos(a), sn = Math.sin(a);
    ctx.moveTo(cx + c * r0, cy + sn * r0);
    ctx.lineTo(cx + c * (rTick + 2 * k), cy + sn * (rTick + 2 * k));
  }
  ctx.globalAlpha = A * pAct * 0.8;
  ctx.stroke();
  const c = Math.cos(pa), sn = Math.sin(pa);
  const r0 = rTick + 4 * k, r1 = rTick + 11 * k;
  ctx.beginPath();
  ctx.moveTo(cx + c * r0, cy + sn * r0);
  ctx.lineTo(cx + c * r1 - sn * 3.5 * k, cy + sn * r1 + c * 3.5 * k);
  ctx.lineTo(cx + c * r1 + sn * 3.5 * k, cy + sn * r1 - c * 3.5 * k);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
}

// Obręcz (span — rysuje się od góry przy otwarciu).
function drawRim(ctx, cx, cy, k, A, span) {
  ctx.beginPath();
  ctx.arc(cx, cy, (MODE_WHEEL_GEOM.outer + MODE_WHEEL_GEOM.rim) * k, -HALF_PI, -HALF_PI + span);
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = Math.max(1, k);
  ctx.globalAlpha = A * 0.34;
  ctx.stroke();
}

// Piasta: tarcza i obwód z segmentów sektorów.
function drawHubBase(ctx, cx, cy, k, A, n, step, half, g) {
  const rHub = MODE_WHEEL_GEOM.hub * k;
  ctx.globalAlpha = A * 0.94;
  ctx.fillStyle = C.plate;
  ctx.beginPath();
  ctx.arc(cx, cy, rHub, 0, TAU);
  ctx.fill();
  const gH = Math.asin(Math.min(0.9, (g + 1.2 * k) / Math.max(1, rHub)));
  ctx.strokeStyle = C.edge;
  ctx.lineCap = 'butt';
  ctx.lineWidth = Math.max(1, 1.6 * k);
  ctx.globalAlpha = A * 0.4;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a0 = -HALF_PI + i * step - half + gH;
    ctx.moveTo(cx + Math.cos(a0) * rHub, cy + Math.sin(a0) * rHub);
    ctx.arc(cx, cy, rHub, a0, a0 + step - 2 * gH);
  }
  ctx.stroke();
}

function drawWheelBody(ctx, fx, view, now, kind, s) {
  const T = MODE_WHEEL_TIME;
  const G = MODE_WHEEL_GEOM;
  const items = view.items;
  const n = Math.min(fx.n, items.length);
  const step = TAU / n;
  const half = step * 0.5;
  const tOpen = fx.open ? now - fx.openAt : fx.closeOpenT;
  const kOpen = easeOutCubic(clamp01(tOpen / T.open));
  const tc = kind ? clamp01((now - fx.closeAt) / closeDuration(kind)) : 0;

  // Całość: przezroczystość, skala, drżenie.
  let A = kOpen;
  let S = 0.86 + 0.14 * easeOutBack(clamp01(tOpen / T.open), 1.4);
  let shake = 0;
  if (kind === 'select') {
    A *= 1 - smooth(0.25, 1, tc);
    S *= 1 - 0.05 * easeInCubic(tc);
  } else if (isFold(kind)) {
    A *= 1 - tc;
    S *= 1 - 0.12 * easeInCubic(tc);
  } else if (kind === 'deny') {
    A *= 1 - smooth(0.6, 1, tc);
    shake = Math.sin(tc * Math.PI * 9) * 8 * s * (1 - tc) * (1 - tc);
  }
  const lit = kind === 'select' || kind === 'deny' ? fx.closeIdx : -1;
  if (A <= 0.003 && lit < 0) return;
  const cx = fx.x + shake;
  const cy = fx.y;
  const k = s * S;
  const rHub = G.hub * k;
  const rIn = G.inner * k;
  const rOut = G.outer * k;
  const rRim = (G.outer + G.rim) * k;
  const g = G.gap * 0.5 * k;
  const current = view.current;
  const hov = fx.open ? fx.hover : -1;
  const tickRot = -0.55 * (1 - easeOutCubic(clamp01(tOpen / T.ticks)));
  // Koło stoi: tarcza i nieruszane sektory z pamięci obrazów (bez DOM — np. w testach — zawsze na żywo).
  const spr = !kind && tOpen >= settleTime(n) ? ensureSprites(fx, view, s, cx, cy, n, current, step, half) : null;

  // Winieta ekranu — skupia wzrok na kole (pod HUD-em DOM, nad polem bitwy).
  const W = view.W | 0, H = view.H | 0;
  if (W > 0 && H > 0) {
    ctx.globalAlpha = A * 0.34;
    ctx.fillStyle = cachedRadial(ctx, fx.vig, fx.x, fx.y, (G.outer + G.rim) * s * 1.1, Math.max(W, H) * 0.78,
      'vig', 'rgba(1, 4, 9, 0)', 'rgba(1, 4, 9, 1)');
    ctx.fillRect(0, 0, W, H);
  }
  if (spr) {
    ctx.globalAlpha = A;
    ctx.drawImage(spr.frame, spr.fx, spr.fy);
  } else {
    // Tarcza i cień rosną od piasty razem z sektorami, przy zwijaniu kurczą się z nimi.
    let grow = easeOutCubic(clamp01(tOpen / (T.open + T.sector)));
    if (isFold(kind)) grow *= 1 - easeInCubic(tc);
    drawPlate(ctx, cx, cy, k, A, grow, fx.shade);
    drawTicks(ctx, cx, cy, k, A, tickRot, n, half);
    drawRim(ctx, cx, cy, k, A, TAU * easeOutCubic(clamp01(tOpen / T.rimDraw)));
  }

  // Wskaźnik na podziałce.
  const pd = Math.sqrt(view.px * view.px + view.py * view.py);
  const pAct = fx.open ? clamp01(pd / Math.max(1, view.deadzone)) : 0;
  const pa = Math.atan2(view.py, view.px);
  if (pAct > 0.05) {
    const accent = hov < 0 ? C.bright : items[hov].avail !== false ? items[hov].color : C.deny;
    drawTickPointer(ctx, cx, cy, k, A, tickRot, n, half, pa, pAct, accent);
  }
  // Światło obiega koło przy otwarciu (jak antena radaru).
  if (fx.open && tOpen < T.sweep) {
    const ts = tOpen / T.sweep;
    const head = -HALF_PI + TAU * easeInOut(ts);
    const fade = 1 - smooth(0.55, 1, ts);
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = C.bright;
    ctx.lineCap = 'butt';
    for (let j = 0; j < 9; j++) {
      ctx.lineWidth = (2.6 - j * 0.2) * k;
      ctx.globalAlpha = A * fade * (0.9 - j * 0.095);
      ctx.beginPath();
      ctx.arc(cx, cy, rRim, head - (j + 1) * 0.08, head - j * 0.08);
      ctx.stroke();
    }
    ctx.globalAlpha = A * fade * 0.5;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(head) * rRim, cy + Math.sin(head) * rRim, 3 * k, 0, TAU);
    ctx.fillStyle = C.bright;
    ctx.fill();
    ctx.globalCompositeOperation = op;
  }

  // Sektory: zwykłe (z pamięci, gdy koło stoi), potem wskazany / wybrany (poświata na wierzchu).
  setFrame(A, kOpen, tOpen, kind, tc, now, cx, cy, k, rIn, rOut, g, step, half, current,
    cachedRadial(ctx, fx.glass, cx, cy, rIn, rOut + G.pop * k, 'glass', GLASS_IN, GLASS_OUT));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const live = i === lit || fx.h[i] > 0.02 || fx.pulse[i] > 0.02;
      const top = i === lit || (lit < 0 && fx.h[i] > 0.02);
      if ((pass === 1) !== top) continue;
      if (spr && !live) {
        const sec = spr.sec[i];
        ctx.globalAlpha = A;
        ctx.drawImage(sec.c, sec.x, sec.y);
      } else {
        drawSector(ctx, fx, items[i], i, n, false);
      }
    }
  }
  if (!spr) drawHubBase(ctx, cx, cy, k, A, n, step, half, g);

  // Podświetlenie na obręczy: ślizga się sprężyną za wskazaniem.
  if (fx.hlA > 0.01 && fx.hlIdx >= 0 && fx.hlIdx < n && !isFold(kind)) {
    const it = items[fx.hlIdx];
    const gA = Math.asin(Math.min(0.9, (g + 1.5 * k) / rRim));
    const pop = fx.h[fx.hlIdx] * G.pop * k;
    ctx.beginPath();
    ctx.arc(cx, cy, rRim + pop, fx.hl - half + gA, fx.hl + half - gA);
    ctx.lineCap = 'butt';
    ctx.globalAlpha = A * fx.hlA;
    glowStroke(ctx, it.avail !== false ? it.color : C.deny, 3 * k, 1);
  }

  // Znacznik aktywnego trybu na obręczy (oddycha).
  if (current >= 0 && current < n) {
    const ac = -HALF_PI + current * step;
    const breathe = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(now * 4.2));
    const r0 = rRim + (3 + fx.h[current] * G.pop) * k;
    const r1 = r0 + 7 * k;
    const c = Math.cos(ac), sn = Math.sin(ac);
    ctx.beginPath();
    ctx.moveTo(cx + c * r0, cy + sn * r0);
    ctx.lineTo(cx + c * r1 - sn * 4.5 * k, cy + sn * r1 + c * 4.5 * k);
    ctx.lineTo(cx + c * r1 + sn * 4.5 * k, cy + sn * r1 - c * 4.5 * k);
    ctx.closePath();
    ctx.fillStyle = items[current].color;
    ctx.globalAlpha = A * breathe;
    ctx.fill();
  }

  // Wybór: fala z piasty i iskry przy wybranym sektorze.
  if (kind === 'select' && lit >= 0) {
    const it = items[lit];
    ctx.lineCap = 'round';
    for (let w = 0; w < 2; w++) {
      const tw = clamp01((tc - w * 0.16) / (1 - w * 0.16));
      if (tw <= 0 || tw >= 1) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, rHub + (rRim + 46 * k - rHub) * easeOutCubic(tw), 0, TAU);
      ctx.globalAlpha = kOpen * (1 - tw) * (w ? 0.35 : 0.7);
      glowStroke(ctx, it.color, (2.4 * (1 - tw) + 0.6) * k, 1);
    }
    const ac = -HALF_PI + lit * step;
    const e = easeOutCubic(tc);
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 1.6 * k;
    ctx.globalAlpha = kOpen * (1 - tc);
    ctx.beginPath();
    for (let j = 0; j < 11; j++) {
      const a = ac + (j / 10 - 0.5) * step * 0.95;
      const r0 = rOut + (8 + 54 * e + (j % 3) * 6) * k;
      const len = (14 - (j % 3) * 3) * k * (1 - tc);
      const c = Math.cos(a), sn = Math.sin(a);
      ctx.moveTo(cx + c * r0, cy + sn * r0);
      ctx.lineTo(cx + c * (r0 + len), cy + sn * (r0 + len));
    }
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.stroke();
    ctx.globalCompositeOperation = op;
  }

  drawHubLive(ctx, fx, view, now, kind, A, cx, cy, k, rHub, pAct, pa, step, half, g);
  drawCaption(ctx, fx, view, now, kind, A, cx, cy + (G.outer + G.rim + G.ticks + G.caption) * k, s);
}

function setFrame(A, kOpen, tOpen, kind, tc, now, cx, cy, k, rIn, rOut, g, step, half, current, glass) {
  F.A = A; F.kOpen = kOpen; F.tOpen = tOpen; F.kind = kind; F.tc = tc; F.now = now;
  F.cx = cx; F.cy = cy; F.k = k; F.rIn = rIn; F.rOut = rOut; F.g = g; F.step = step; F.half = half;
  F.current = current; F.glass = glass;
}

// Obrazy koła w spoczynku: tarcza (cień, podziałka, obręcz, piasta) i każdy sektor bez wskazania —
// w rozmiarze ekranu, z tym samym ułamkiem piksela co środek koła (drawImage w pikselach całkowitych).
// Bez DOM (testy w Node) — null, koło rysuje się na żywo.
function ensureSprites(fx, view, s, cx, cy, n, current, step, half) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const items = view.items;
  let mask = 0;
  for (let i = 0; i < n; i++) if (items[i].avail === false) mask |= 1 << i;
  const sp = fx.spr;
  if (sp.ok && sp.s === s && sp.cx === cx && sp.cy === cy && sp.current === current && sp.mask === mask
    && sp.items === items && sp.n === n) return sp;
  const G = MODE_WHEEL_GEOM;
  const k = s;
  const g = G.gap * 0.5 * k;
  const rIn = G.inner * k;
  const rOut = G.outer * k;
  // Tarcza.
  const R = Math.ceil((G.outer + G.rim + 40) * k);
  const fx0 = Math.floor(cx) - R;
  const fy0 = Math.floor(cy) - R;
  if (!sp.frame) sp.frame = document.createElement('canvas');
  sp.frame.width = 2 * R;
  sp.frame.height = 2 * R;
  const fc = sp.frame.getContext('2d');
  const lx = cx - fx0, ly = cy - fy0;
  drawPlate(fc, lx, ly, k, 1, 1, { grad: null, x: 0, y: 0, r0: 0, r1: 0, color: '' });
  drawTicks(fc, lx, ly, k, 1, 0, n, half);
  drawRim(fc, lx, ly, k, 1, TAU);
  drawHubBase(fc, lx, ly, k, 1, n, step, half, g);
  sp.fx = fx0;
  sp.fy = fy0;
  // Sektory: pudło z próbek obu łuków + margines na obrys.
  const m = Math.ceil(3 * k + 2);
  for (let i = 0; i < n; i++) {
    const ac = -HALF_PI + i * step;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j <= 16; j++) {
      const a = ac - half + (j / 16) * step;
      const c = Math.cos(a), sn = Math.sin(a);
      for (let q = 0; q < 2; q++) {
        const r = q ? rOut : rIn;
        const x = c * r, y = sn * r;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const sx = Math.floor(cx + x0) - m, sy = Math.floor(cy + y0) - m;
    const w = Math.ceil(cx + x1) + m - sx, h = Math.ceil(cy + y1) + m - sy;
    let sec = sp.sec[i];
    if (!sec) sec = sp.sec[i] = { c: document.createElement('canvas'), x: 0, y: 0 };
    sec.c.width = w;
    sec.c.height = h;
    sec.x = sx;
    sec.y = sy;
    const sc = sec.c.getContext('2d');
    sc.textAlign = 'center';
    sc.textBaseline = 'middle';
    const ox = cx - sx, oy = cy - sy;
    const glass = sc.createRadialGradient(ox, oy, rIn, ox, oy, rOut + G.pop * k);
    glass.addColorStop(0, GLASS_IN);
    glass.addColorStop(1, GLASS_OUT);
    setFrame(1, 1, 1e9, '', 0, 0, ox, oy, k, rIn, rOut, g, step, half, current, glass);
    drawSector(sc, fx, items[i], i, n, true);
  }
  sp.ok = true;
  sp.s = s;
  sp.cx = cx;
  sp.cy = cy;
  sp.current = current;
  sp.mask = mask;
  sp.items = items;
  sp.n = n;
  return sp;
}

// Sektor. base — wygląd w spoczynku (do obrazu z pamięci): bez wskazania, fali i animacji zamykania.
function drawSector(ctx, fx, it, i, n, base) {
  const T = MODE_WHEEL_TIME;
  const G = MODE_WHEEL_GEOM;
  const { A, kind, tc, tOpen, cx, cy, k, rIn, rOut, g, step, half, current, now } = F;
  const ac = -HALF_PI + i * step;
  // Rozkładanie wachlarzem od aktywnego trybu.
  const ks = base ? 1 : clamp01((tOpen - ringDist(i, current >= 0 ? current : 0, n) * T.cascade) / T.sector);
  if (ks <= 0) return;
  const grow = base ? 1 : easeOutBack(ks, 1.25);
  let alpha = base ? 1 : A * clamp01(ks * 1.7);
  const h = base ? 0 : fx.h[i];
  let r0 = rIn;
  let r1 = rIn + (rOut - rIn) * grow + h * G.pop * 0.35 * k;
  let off = h * G.pop * 0.65 * k;
  const chosen = !base && (kind === 'select' || kind === 'deny') && i === fx.closeIdx;
  if (!base && kind === 'select') {
    if (chosen) {
      // Wybrany sektor gaśnie później niż reszta (przy krótkim przytrzymaniu koło było ledwie rozłożone).
      off += 12 * k * easeOutCubic(tc);
      alpha = F.kOpen * (1 - smooth(0.45, 1, tc)) * clamp01(ks * 1.7);
    } else {
      const q = 1 - 0.28 * easeInCubic(tc);
      r0 *= q; r1 *= q;
    }
  } else if (!base && isFold(kind)) {
    r1 += (r0 - r1) * easeInCubic(tc);
  }
  if (r1 - r0 < 2 || alpha <= 0.003) return;
  const avail = it.avail !== false;
  const isCur = i === current;
  const color = avail ? it.color : C.deny;
  const ox = cx + Math.cos(ac) * off;
  const oy = cy + Math.sin(ac) * off;

  // Szyba (cieniowanie wspólne dla koła: ciemniej przy piaście, jaśniej przy obręczy).
  sectorPath(ctx, cx, cy, ac, half, r0, r1, g, off);
  ctx.globalAlpha = alpha * (avail ? 0.84 : 0.8);
  ctx.fillStyle = avail ? F.glass : C.glassOff;
  ctx.fill();
  if (isCur) {
    ctx.globalAlpha = alpha * 0.12;
    ctx.fillStyle = it.color;
    ctx.fill();
  }
  if (h > 0.02) {
    // Wskazany: światło od obręczy w barwie trybu.
    ctx.globalAlpha = alpha * h * (avail ? 0.34 : 0.24);
    ctx.fillStyle = cachedRadial(ctx, fx.sg[i], ox, oy, r0, r1, color, 'rgba(0, 0, 0, 0)', color);
    ctx.fill();
  }
  if (chosen) {
    // Błysk wyboru / czerwień odmowy.
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    if (kind === 'select') {
      ctx.globalAlpha = F.kOpen * (1 - tc) * (1 - tc) * 0.9;
      ctx.fillStyle = C.bright;
    } else {
      ctx.globalAlpha = A * (0.35 + 0.35 * Math.abs(Math.sin(tc * Math.PI * 4))) * (1 - tc * 0.5);
      ctx.fillStyle = C.deny;
    }
    ctx.fill();
    ctx.globalCompositeOperation = op;
  }
  // Kreskowanie trybu niedostępnego.
  if (!avail) {
    ctx.save();
    ctx.clip();
    const mx = cx + Math.cos(ac) * (r0 + r1) * 0.5;
    const my = cy + Math.sin(ac) * (r0 + r1) * 0.5;
    const L = (r1 - r0) * 1.2 + 20 * k;
    const sp = 6 * k;
    ctx.beginPath();
    for (let o = -L; o <= L; o += sp) {
      ctx.moveTo(mx + o - L, my - L);
      ctx.lineTo(mx + o + L, my + L);
    }
    ctx.strokeStyle = C.deny;
    ctx.lineWidth = Math.max(1, k);
    ctx.globalAlpha = alpha * 0.13;
    ctx.stroke();
    ctx.restore();
  }
  // Obrys.
  sectorPath(ctx, cx, cy, ac, half, r0, r1, g, off);
  ctx.lineJoin = 'round';
  if (h > 0.02 || chosen) {
    ctx.globalAlpha = alpha * Math.max(h, chosen ? 1 : 0);
    glowStroke(ctx, chosen && kind === 'deny' ? C.deny : color, 1.5 * k, 1);
  } else {
    ctx.globalAlpha = alpha * (isCur ? 0.55 : 0.26);
    ctx.strokeStyle = isCur ? it.color : C.edge;
    ctx.lineWidth = Math.max(1, k);
    ctx.stroke();
  }
  // Światło padające na zewnętrzną krawędź szyby.
  const dA1 = Math.asin(Math.min(0.9, (g + 2 * k) / Math.max(1, r1 - 2 * k)));
  ctx.beginPath();
  ctx.arc(ox, oy, r1 - 2 * k, ac - half + dA1, ac + half - dA1);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, k);
  ctx.globalAlpha = alpha * (0.07 + 0.12 * h);
  ctx.stroke();
  // Wskazany: fala światła płynie od piasty ku obręczy.
  if (h > 0.05 && avail && !kind) {
    const ph = ((now - fx.hoverAt) * 1.3) % 1;
    const ra = r0 + (r1 - r0) * ph;
    const rb = Math.min(r1 - 1, ra + (r1 - r0) * 0.2);
    if (rb > ra + 1) {
      sectorPath(ctx, cx, cy, ac, half, ra, rb, g, off);
      const op = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * h * 0.16 * Math.sin(Math.PI * ph);
      ctx.fillStyle = it.color;
      ctx.fill();
      ctx.globalCompositeOperation = op;
    }
  }
  // Fala obrysu po wskazaniu.
  const pu = base ? 0 : fx.pulse[i];
  if (pu > 0.01 && !isFold(kind)) {
    const e = (1 - pu) * 11 * k;
    sectorPath(ctx, cx, cy, ac, half, r0 - e * 0.25, r1 + e, g, off);
    ctx.globalAlpha = alpha * pu * pu * 0.7;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.stroke();
  }
  // Pasek aktywnego trybu przy zewnętrznej krawędzi.
  if (isCur && r1 - r0 > 12 * k) {
    const rr = r1 - 3.6 * k;
    const dA = Math.asin(Math.min(0.9, (g + 5 * k) / rr));
    ctx.beginPath();
    ctx.arc(ox, oy, rr, ac - half + dA, ac + half - dA);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 2.4 * k;
    ctx.globalAlpha = alpha * 0.9;
    ctx.stroke();
  }

  // Treść: ikona, nazwa, klawisz albo kłódka (na ciemnej szybie — bez cieni pod napisami).
  const contentK = smooth(0.35, 1, ks);
  if (contentK <= 0.01) return;
  const rc = r0 + (r1 - r0) * 0.5 + 1 * k;
  const bx = cx + Math.cos(ac) * (rc + off * 0.5);
  const by = cy + Math.sin(ac) * (rc + off * 0.5);
  const isz = G.icon * k * (1 + 0.22 * h) * (chosen && kind === 'select' ? 1 + 0.25 * Math.sin(Math.PI * tc) : 1);
  const iy = by - 8 * k - h * 2 * k;
  const iconColor = !avail ? C.iconOff : (h > 0.5 || isCur || chosen) ? it.color : C.icon;
  if (h > 0.05 && avail) {
    const glow = iconGlow(fx.glow[i].sm, it.icon, it.color, G.icon * k * 1.22, 10 * k);
    drawGlow(ctx, glow, bx, iy, isz, alpha * contentK * h);
  }
  ctx.globalAlpha = alpha * contentK;
  drawModeWheelIcon(ctx, it.icon, bx, iy, isz, iconColor, h, now - fx.hoverAt);
  const fonts = fx.fonts;
  const ly = by + 15 * k + h * 1.5 * k;
  ctx.font = h > 0.5 ? fonts.labelB : fonts.label;
  ctx.fillStyle = !avail ? C.labelOff : h > 0.5 ? '#ffffff' : (isCur ? it.color : C.label);
  ctx.fillText(it.label, bx, ly);
  if (!avail) {
    ctx.strokeStyle = C.denyText;
    ctx.fillStyle = C.denyText;
    ctx.lineWidth = Math.max(1, 1.1 * k);
    iconLock(ctx, bx, ly + 13 * k, 5.5 * k);
  } else if (it.key) {
    ctx.font = fonts.key;
    ctx.fillStyle = C.key;
    ctx.fillText(it.key, bx, ly + 13 * k);
  }
}

// Piasta na żywo: obracające się łuki, wskazany segment, grot ruchu myszy, ikona i nazwa trybu.
function drawHubLive(ctx, fx, view, now, kind, A, cx, cy, k, rHub, pAct, pa, step, half, g) {
  const T = MODE_WHEEL_TIME;
  const G = MODE_WHEEL_GEOM;
  const items = view.items;
  const n = Math.min(fx.n, items.length);
  const hov = fx.open ? fx.hover : -1;
  // Wewnętrzne łuki obracają się powoli (przyrząd „żyje”).
  const rot = now * 0.8;
  const ri = rHub - 6 * k;
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = Math.max(1, k);
  ctx.lineCap = 'butt';
  ctx.globalAlpha = A * 0.2;
  ctx.beginPath();
  ctx.arc(cx, cy, ri, rot, rot + 0.75);
  ctx.moveTo(cx + Math.cos(rot + Math.PI) * ri, cy + Math.sin(rot + Math.PI) * ri);
  ctx.arc(cx, cy, ri, rot + Math.PI, rot + Math.PI + 0.75);
  ctx.stroke();
  // Wskazany segment obwodu świeci barwą trybu.
  if (hov >= 0 && hov < n) {
    const gH = Math.asin(Math.min(0.9, (g + 1.2 * k) / Math.max(1, rHub)));
    const a0 = -HALF_PI + hov * step - half + gH;
    ctx.beginPath();
    ctx.arc(cx, cy, rHub, a0, a0 + step - 2 * gH);
    ctx.globalAlpha = A;
    glowStroke(ctx, items[hov].avail !== false ? items[hov].color : C.deny, 2.2 * k, 1);
  }
  // Wskaźnik ruchu myszy: grot przy piaście.
  if (pAct > 0.02) {
    const c = Math.cos(pa), sn = Math.sin(pa);
    const r0 = rHub + 5 * k;
    const r1 = r0 + (4 + 7 * pAct) * k;
    ctx.beginPath();
    ctx.moveTo(cx + c * r1, cy + sn * r1);
    ctx.lineTo(cx + c * r0 - sn * 5 * k, cy + sn * r0 + c * 5 * k);
    ctx.lineTo(cx + c * r0 + sn * 5 * k, cy + sn * r0 - c * 5 * k);
    ctx.closePath();
    ctx.fillStyle = hov < 0 ? C.bright : items[hov].avail !== false ? items[hov].color : C.deny;
    ctx.globalAlpha = A * pAct;
    ctx.fill();
  }

  // Treść piasty. Po wyborze i stuknięciu piastę przejmuje echo (drawEcho).
  if (kind === 'select' || kind === 'tap') return;
  const fonts = fx.fonts;
  const iconSize = G.hubIcon * k;
  if (kind === 'deny' && fx.closeIdx >= 0 && fx.closeIdx < n) {
    const it = items[fx.closeIdx];
    ctx.globalAlpha = A;
    ctx.strokeStyle = C.deny;
    ctx.fillStyle = C.deny;
    ctx.lineWidth = Math.max(1.4, 2 * k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    iconLock(ctx, cx, cy - 8 * k, 13 * k);
    ctx.font = fonts.name;
    ctx.fillStyle = C.denyText;
    ctx.fillText(it.label, cx, cy + 23 * k);
    return;
  }
  const kh = easeOutCubic(clamp01((now - fx.hubAt) / T.hub));
  if (fx.hubPrev >= 0 && fx.hubPrev < n && kh < 1) {
    const it = items[fx.hubPrev];
    ctx.globalAlpha = A * (1 - kh) * 0.8;
    drawModeWheelIcon(ctx, it.icon, cx, cy - 7 * k, iconSize * (1 - 0.25 * kh), it.avail !== false ? it.color : C.iconOff, 0, 0);
  }
  const idx = fx.hubIdx;
  if (idx < 0 || idx >= n) return;
  const it = items[idx];
  const avail = it.avail !== false;
  const lead = fx.hubHover;
  const hubSize = iconSize * (1.25 - 0.25 * kh);
  if (lead && avail) drawGlow(ctx, iconGlow(fx.glow[idx].lg, it.icon, it.color, iconSize * 1.3, 14 * k), cx, cy - 7 * k, hubSize, A * kh);
  ctx.globalAlpha = A * kh * (lead ? 1 : 0.5);
  drawModeWheelIcon(ctx, it.icon, cx, cy - 7 * k, hubSize, avail ? it.color : C.iconOff, lead ? fx.h[idx] : 0, now - fx.hoverAt);
  if (!avail && lead) {
    ctx.globalAlpha = A * kh;
    ctx.strokeStyle = C.denyText;
    ctx.fillStyle = C.denyText;
    ctx.lineWidth = Math.max(1, 1.4 * k);
    iconLock(ctx, cx + 15 * k, cy + 4 * k, 6.5 * k);
  }
  ctx.font = fonts.name;
  ctx.globalAlpha = A * (lead ? 1 : 0.6);
  ctx.fillStyle = !avail ? C.denyText : lead ? '#ffffff' : C.label;
  ctx.fillText(lead ? scramble(it.label, clamp01((now - fx.hoverAt) / T.decode), idx + 1) : it.label, cx, cy + 23 * k);
}

function drawCaption(ctx, fx, view, now, kind, A, cx, y0, s) {
  const T = MODE_WHEEL_TIME;
  const items = view.items;
  let idx = fx.open ? fx.hover : -1;
  let alpha = A * fx.hlA;
  if (kind === 'deny') { idx = fx.closeIdx; alpha = A; }
  if (idx < 0 || idx >= items.length || alpha < 0.02) return;
  const it = items[idx];
  const fonts = fx.fonts;
  const kIn = kind === 'deny' ? 1 : easeOutCubic(clamp01((now - fx.hoverAt) / T.caption));
  const y = y0 + (1 - kIn) * 7 * s;
  const maxW = Math.round(Math.max(260, Math.min(view.W ? view.W * 0.6 : 640, 640 * s)));
  const spr = captionSprite(fx, idx, it, maxW);
  if (spr) {
    ctx.globalAlpha = alpha * kIn;
    ctx.drawImage(spr.c, Math.round(cx - spr.w / 2), Math.round(y - fonts.capLine / 2 - spr.pad));
    return;
  }
  // Bez DOM (testy): napisy wprost.
  ctx.font = fonts.cap;
  textShadow(ctx, true);
  ctx.globalAlpha = alpha * kIn;
  const lh = fonts.capLine;
  if (it.avail === false) {
    const w = wrapCaption(ctx, fx, stripModePrefix(it.reason, it.label) || 'Tryb niedostępny', maxW);
    ctx.fillStyle = C.denyText;
    ctx.fillText(w.a, cx, y);
    if (w.b) ctx.fillText(w.b, cx, y + lh);
  } else {
    let yy = y;
    if (it.gain) {
      const w = wrapCaption(ctx, fx, it.gain, maxW);
      ctx.fillStyle = C.gain;
      ctx.fillText(w.a, cx, yy);
      yy += lh;
      if (w.b) { ctx.fillText(w.b, cx, yy); yy += lh; }
    }
    if (it.cost) {
      ctx.fillStyle = it.costKind === 'cost' ? C.cost : C.keys;
      ctx.fillText(it.cost, cx, yy);
    }
  }
  textShadow(ctx, false);
}

// Echo wybranego trybu: ikona i nazwa zostają chwilę w środku koła (wybór z koła i stuknięcie ŚPM).
function drawEcho(ctx, fx, view, now, s) {
  const T = MODE_WHEEL_TIME;
  const G = MODE_WHEEL_GEOM;
  const items = view.items;
  const idx = fx.echoIdx;
  if (idx < 0 || idx >= items.length) return;
  const it = items[idx];
  const te = clamp01((now - fx.echoAt) / T.echo);
  const alpha = (1 - smooth(0.5, 1, te)) * smooth(0, 0.06, te + 0.02);
  if (alpha <= 0.01) return;
  const k = s;
  const cx = fx.x;
  const cy = fx.y - 6 * k * easeOutCubic(te);
  const pop = 1 + 0.3 * (1 - easeOutCubic(clamp01(te / 0.28)));
  // Podkład — echo czytelne nad jasną bitwą.
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = C.plate;
  ctx.beginPath();
  ctx.arc(cx, cy, G.hub * k * 1.05, 0, TAU);
  ctx.fill();
  // Pierścień rozchodzi się od ikony.
  const tr = clamp01(te / 0.55);
  ctx.beginPath();
  ctx.arc(cx, cy - 7 * k, (26 + 34 * easeOutCubic(tr)) * k, 0, TAU);
  ctx.globalAlpha = alpha * (1 - tr) * 0.8;
  glowStroke(ctx, it.color, 1.6 * k, 1);
  const esz = G.hubIcon * k * pop;
  drawGlow(ctx, iconGlow(fx.glow[idx].lg, it.icon, it.color, G.hubIcon * k * 1.3, 14 * k), cx, cy - 7 * k, esz, alpha);
  ctx.globalAlpha = alpha;
  drawModeWheelIcon(ctx, it.icon, cx, cy - 7 * k, esz, it.color, 1, now - fx.echoAt);
  ctx.font = fx.fonts.echo;
  ctx.fillStyle = it.color;
  // Litery zbiegają się przy pojawieniu (rozstrzelenie 7 → 2 px); pod nazwą ciemny podkład — bez cienia.
  ctx.letterSpacing = `${Math.round((2 + 5 * (1 - easeOutCubic(clamp01(te / 0.3)))) * k)}px`;
  ctx.fillText(it.label, cx, cy + 27 * k);
  ctx.letterSpacing = '0px';
}
