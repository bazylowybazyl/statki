// src/ui/cursorChargeRing.js
//
// KOŁO ŁADOWANIA PRZY KURSORZE (2026-11-11, decyzja użytkownika: „ładowanie hipercruise'u też pokaż na myszce —
// ładujące się koło; jak się załaduje — animacja powiększenia, »skoku kompletności«”). Jedno koło dla ładowania warpa
// i rozruchu hipercruise'u, na pierścieniu celownika (broń jest wtedy zimna, więc pierścień wież pokazuje tylko cienki
// tor): wypełnia się zgodnie z zegarem od góry, z jasną główką. Pełne (start skoku / lotu) → SKOK KOMPLETNOŚCI: biały
// błysk całego koła podskakuje o `punch` i gaśnie, a koło w barwie napędu rośnie o `popGrow` i rozpływa się. Przerwane
// ładowanie gaśnie w czerwieni (`abortS`).
//
// Czysty canvas 2D: stan dostaje z zewnątrz (klej gry podaje rodzaj, fazę i postęp), czas rzeczywisty jak znacznik
// trafienia (koło nie zwalnia z grą), zero alokacji w kroku i rysunku.

export const CHARGE_RING_TUNE = Object.freeze({
  width: 4,        // grubość pierścienia [px przy skali 1]
  glow: 10,        // grubość poświaty pod wypełnieniem [px]
  head: 3.2,       // promień główki [px]
  popS: 0.55,      // czas skoku kompletności [s]
  popGrow: 0.8,    // o ile rośnie promień koła w barwie napędu (× promień)
  punchS: 0.16,    // czas białego błysku [s]
  punch: 0.24,     // podskok białego błysku (× promień)
  abortS: 0.3,     // gaśnięcie przerwanego ładowania [s]
  staleS: 0.25     // przerwa w krokach (celownik niewidoczny: RTS, koło trybów, panel stacji) — stan od nowa
});

export const CHARGE_RING_COLORS = Object.freeze({
  warp: '#c4abff',
  hyper: '#7fd8ff',
  abort: '#ff8a94',
  track: 'rgba(255, 255, 255, 0.16)',
  flash: '#ffffff'
});

export const CHARGE_RING_PHASE = Object.freeze({ IDLE: 0, CHARGE: 1, POP: 2, ABORT: 3 });
const { IDLE, CHARGE, POP, ABORT } = CHARGE_RING_PHASE;
const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);

export function createChargeRing() {
  return { phase: IDLE, kind: '', progress: 0, t0: 0, at: -Infinity };
}

/**
 * Krok stanu koła raz na klatkę HUD-u.
 * kind — 'warp' | 'hyper' (barwa; czytany tylko w ładowaniu),
 * state — 'charge' (ładowanie, `progress` 0…1) | 'done' (napęd ruszył: skok / lot) | '' (nic),
 * now — czas rzeczywisty [s].
 * Skok kompletności rusza tylko z przejścia ładowanie → 'done'; ładowanie → '' = przerwane. Po przerwie w krokach
 * dłuższej niż `staleS` (celownik był schowany) przejście się nie liczy — bez skoku po minucie w RTS.
 */
export function stepChargeRing(r, kind, state, progress, now) {
  const stale = now - r.at > CHARGE_RING_TUNE.staleS;
  r.at = now;
  if (stale && state !== 'charge') { r.phase = IDLE; return r; }
  if (state === 'charge') {
    r.phase = CHARGE;
    r.kind = kind;
    r.progress = clamp01(Number(progress) || 0);
    return r;
  }
  if (r.phase === CHARGE) {
    r.t0 = now;
    if (state === 'done') { r.phase = POP; r.progress = 1; }
    else r.phase = ABORT;
  } else if (r.phase === POP && now - r.t0 >= CHARGE_RING_TUNE.popS) r.phase = IDLE;
  else if (r.phase === ABORT && now - r.t0 >= CHARGE_RING_TUNE.abortS) r.phase = IDLE;
  return r;
}

export function chargeRingVisible(r) {
  return !!r && r.phase !== IDLE;
}

function stroke(ctx, x, y, rad, a0, a1, color, width) {
  ctx.beginPath();
  ctx.arc(x, y, rad, a0, a1);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Koło wokół (x, y) na promieniu `radius` [px]. `scale` — skala celownika. */
export function drawChargeRing(ctx, x, y, radius, r, now, scale = 1) {
  if (!r || r.phase === IDLE) return;
  const T = CHARGE_RING_TUNE;
  const s = Math.max(0.6, Number(scale) || 1);
  const w = T.width * s;
  const color = r.kind === 'hyper' ? CHARGE_RING_COLORS.hyper : CHARGE_RING_COLORS.warp;
  ctx.save();
  ctx.lineCap = 'butt';
  if (r.phase === CHARGE) {
    const p = r.progress;
    stroke(ctx, x, y, radius, 0, TAU, CHARGE_RING_COLORS.track, w);
    if (p > 0.002) {
      const a1 = TOP + TAU * p;
      // poświata (bez shadowBlur — rozmycie na żywo jest drogie): szeroka, słaba kreska pod wypełnieniem
      ctx.globalAlpha = 0.16 + 0.14 * p;
      stroke(ctx, x, y, radius, TOP, a1, color, T.glow * s);
      ctx.globalAlpha = 1;
      stroke(ctx, x, y, radius, TOP, a1, color, w);
      // główka na końcu wypełnienia
      ctx.fillStyle = CHARGE_RING_COLORS.flash;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a1) * radius, y + Math.sin(a1) * radius, T.head * s, 0, TAU);
      ctx.fill();
    }
  } else if (r.phase === POP) {
    const t = now - r.t0;
    const k = clamp01(t / T.popS);
    const e = 1 - (1 - k) * (1 - k) * (1 - k);
    // koło w barwie napędu rośnie i rozpływa się
    ctx.globalAlpha = (1 - k) * Math.sqrt(1 - k);
    stroke(ctx, x, y, radius * (1 + T.popGrow * e), 0, TAU, color, w * (1.4 - 0.9 * k));
    // biały błysk: podskok całego koła i powrót (sin), gaśnie w punchS
    const kp = clamp01(t / T.punchS);
    if (kp < 1) {
      ctx.globalAlpha = 1 - kp;
      stroke(ctx, x, y, radius * (1 + T.punch * Math.sin(kp * Math.PI)), 0, TAU, CHARGE_RING_COLORS.flash, w * 1.6);
    }
  } else if (r.phase === ABORT) {
    const k = clamp01((now - r.t0) / T.abortS);
    if (r.progress > 0.002) {
      ctx.globalAlpha = 1 - k;
      stroke(ctx, x, y, radius, TOP, TOP + TAU * r.progress, CHARGE_RING_COLORS.abort, w);
    }
  }
  ctx.restore();
}
