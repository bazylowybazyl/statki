// ============================================================
// Mgła wojny gracza (2026-10-04). Czysta logika (bez three / DOM): co gracz WIDZI.
//
// Widać tylko to, co leży w zasięgu WZROKU strony gracza: Atlas (i gracz 2), sojusznicze okręty i myśliwce,
// drony zwiadowcze, sondy, stacje czujników, przyjazne stacje i strefy odsłonięte przez fabułę. Zasięg wzroku
// (identyfikacji) jest celowo mniejszy niż czujniki pasywne AI (SHIP_SENSOR_PROFILES / fleetAwareness — Atlas
// 80 km): mgła ma się dać zobaczyć po oddaleniu kamery, a rozpoznanie ma być pracą (dron, zwiad, podejście).
//
// Reguły (flaga dodatnia `__fogVisible` — nowy byt jest ukryty, dopóki krok mgły o nim nie zdecyduje):
//  - okręty i myśliwce obcych stron (piraci, ruch neutralny) — tylko w zasięgu wzroku;
//  - stacje pirackie — ukryte do pierwszego zobaczenia, potem znane (jak teren w RTS: `__fogDiscovered`);
//  - wraki — znane od zobaczenia; nowy wrak domyślnie widać (powstaje zwykle w walce, w kadrze);
//  - gracz, sojusznicy, przyjazne i neutralne stacje — zawsze.
// Nieznane w mgle reprezentują SYGNATURY MASY (czujniki grawitacyjne): przybliżone miejsce i masa, bez
// tożsamości. Dziś stawia je fabuła (misja 1); skaner masy (do wdrożenia) będzie je wykrywał sam.
// Obraz: post Core3D (src/3d/fog/) — koła wzroku i soczewki sygnatur; logika rysunku omija byty `fogHides`.
// ============================================================

export const FOG_TUNE = Object.freeze({
  // Zasięg wzroku (j. świata). Atlas 18 km — ~2,5× dalej niż jego bateria (Yamato 7 km od 2026-10-07,
  // src/data/weapons.js § ZASIĘGI): wroga widać przed walką; dalej strzela się z cudzego zwiadu (sojusznik,
  // dron) — Mjolnir 20 km. Brzeg kręgu widać po oddaleniu kamery (domyślny kadr Atlasa ma ~9 km szerokości —
  // kadłub 20% kadru, cameraRig.js; najdalszy zoom 0,035 — ~46 km przy 1600 px). Okręt z profilem czujników
  // `role: 'radar'` (Corvus) to zwiadowca.
  vision: Object.freeze({
    atlas: 18000,
    capital: 15000,
    battleship: 13000,
    destroyer: 10000,
    frigate: 8000,
    radar: 26000,
    fighter: 5000,
    drone: 20000,
    probe: 18000,
    station: 30000,
    sensorStation: 45000
  }),
  // Margines bytu: kadłub, który wystaje w koło wzroku, już widać (ułamek promienia, z sufitem).
  entityMarginFrac: 0.5,
  entityMarginMax: 1500,
  // Sygnatura masy: czas wygaszania po rozpoznaniu (s).
  massResolveSec: 1.8,
  // Najwięcej źródeł wzroku w jednym kroku (pula bez alokacji; nadmiar — najmniejsze koła odpadają).
  maxSources: 96
});

export const FOG_KIND = Object.freeze({ ship: 0, ally: 1, drone: 2, station: 3, reveal: 4 });

const FIGHTER_RE = /fighter|interceptor|bomber|drone/;

function finite(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function posX(e) { return finite(e?.pos?.x ?? e?.x); }
function posY(e) { return finite(e?.pos?.y ?? e?.y); }

/** Czy byt należy do strony gracza (gracz, P2, sojusznicy). */
export function isFogFriendly(e, player = null) {
  if (!e) return false;
  if (player && e === player) return true;
  return e.friendly === true || e.isPlayer === true;
}

/** Zasięg wzroku bytu strony gracza (j. świata). Jawne `sensors.visionRange` wygrywa. */
export function visionRangeOf(e, tune = FOG_TUNE) {
  if (!e) return 0;
  const V = tune.vision;
  const explicit = finite(e.sensors?.visionRange ?? e.visionRange, 0);
  if (explicit > 0) return explicit;
  if (e.sensors?.role === 'radar' || e.sensorProfile?.role === 'radar') return V.radar;
  const type = String(e.type || e.shipFrame || '').toLowerCase();
  if (e.fighter || FIGHTER_RE.test(type)) return V.fighter;
  if (e.isPlayer === true || type === 'atlas') return V.atlas;
  if (e.isCapitalShip || type.includes('carrier') || type.includes('supercapital') || type.includes('capital')) return V.capital;
  if (type.includes('battleship')) return V.battleship;
  if (type.includes('destroyer')) return V.destroyer;
  return V.frigate;
}

export function createFogState(tune = FOG_TUNE) {
  return {
    tune,
    enabled: true,
    time: 0,
    sources: [],          // { x, y, r, kind } — pula
    sourceCount: 0,
    reveals: [],          // { id, x, y, r, until } — strefy odsłonięte przez fabułę (until = Infinity: na stałe)
    masses: [],           // sygnatury masy (niżej)
    generation: 0
  };
}

export function resetFogState(state) {
  state.time = 0;
  state.sourceCount = 0;
  state.reveals.length = 0;
  state.masses.length = 0;
  state.generation++;
  return state;
}

export function beginFogSources(state) {
  state.sourceCount = 0;
}

export function pushFogSource(state, x, y, r, kind = FOG_KIND.ship) {
  if (!(r > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const S = state.sources;
  if (state.sourceCount >= state.tune.maxSources) {
    // pełna pula: podmień najmniejsze koło, jeśli nowe jest większe
    let minI = 0;
    for (let i = 1; i < state.sourceCount; i++) if (S[i].r < S[minI].r) minI = i;
    if (S[minI].r >= r) return;
    const s = S[minI];
    s.x = x; s.y = y; s.r = r; s.kind = kind;
    return;
  }
  let s = S[state.sourceCount];
  if (!s) {
    s = { x: 0, y: 0, r: 0, kind: 0 };
    S[state.sourceCount] = s;
  }
  s.x = x; s.y = y; s.r = r; s.kind = kind;
  state.sourceCount++;
}

/** Czy punkt (z marginesem) leży w zasięgu wzroku któregoś źródła. */
export function fogPointVisible(state, x, y, margin = 0) {
  const S = state.sources;
  for (let i = 0; i < state.sourceCount; i++) {
    const s = S[i];
    const r = s.r + margin;
    const dx = x - s.x, dy = y - s.y;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

function entityMargin(state, e) {
  const r = finite(e?.radius ?? e?.r, 0);
  return Math.min(state.tune.entityMarginMax, Math.max(0, r) * state.tune.entityMarginFrac);
}

/** Strefa odsłonięta przez fabułę albo zwiad (koło wzroku bez nosiciela). sec = Infinity — na stałe. */
export function revealFogArea(state, id, x, y, r, sec = Infinity) {
  const until = Number.isFinite(sec) ? state.time + Math.max(0, sec) : Infinity;
  let z = state.reveals.find((q) => q.id === id);
  if (!z) {
    z = { id, x: 0, y: 0, r: 0, until };
    state.reveals.push(z);
  }
  z.x = finite(x); z.y = finite(y); z.r = Math.max(0, finite(r)); z.until = until;
  return z;
}

export function clearFogArea(state, id) {
  const i = state.reveals.findIndex((q) => q.id === id);
  if (i >= 0) state.reveals.splice(i, 1);
}

/**
 * Źródła wzroku strony gracza. `extra` — dodatkowe koła { x, y, range|r, type } (drony, sondy, stacje
 * czujników z SensorSystem; pula — `extraCount` pierwszych), `stations` — przyjazne stacje widzą wokół siebie.
 */
export function collectFogSources(state, { player = null, player2 = null, npcs = null, stations = null, extra = null, extraCount = -1 } = {}) {
  beginFogSources(state);
  const V = state.tune.vision;
  if (player && !player.dead && !player.destroyed) pushFogSource(state, posX(player), posY(player), visionRangeOf(player), FOG_KIND.ship);
  if (player2 && !player2.dead && !player2.destroyed) pushFogSource(state, posX(player2), posY(player2), visionRangeOf(player2), FOG_KIND.ship);
  if (Array.isArray(npcs)) {
    for (let i = 0; i < npcs.length; i++) {
      const e = npcs[i];
      if (!e || e.dead || e.destroyed || e.removed || e.friendly !== true) continue;
      pushFogSource(state, posX(e), posY(e), visionRangeOf(e), FOG_KIND.ally);
    }
  }
  if (Array.isArray(extra)) {
    const n = extraCount >= 0 ? Math.min(extraCount, extra.length) : extra.length;
    for (let i = 0; i < n; i++) {
      const s = extra[i];
      if (!s || s.type === 'ship') continue;
      const r = finite(s.r ?? s.range, 0);
      const kind = s.type === 'infrastructure' ? FOG_KIND.station : FOG_KIND.drone;
      pushFogSource(state, finite(s.x), finite(s.y), r, kind);
    }
  }
  if (Array.isArray(stations)) {
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      if (!st || st.isPirate || st._destroyed3D || st.destroyed) continue;
      pushFogSource(state, posX(st), posY(st), V.station, FOG_KIND.station);
    }
  }
  for (let i = state.reveals.length - 1; i >= 0; i--) {
    const z = state.reveals[i];
    if (z.until <= state.time) { state.reveals.splice(i, 1); continue; }
    pushFogSource(state, z.x, z.y, z.r, FOG_KIND.reveal);
  }
  return state.sourceCount;
}

/** Krok widoczności bytów (flagi na bytach). Wołany po collectFogSources. */
export function stepFogEntities(state, { player = null, npcs = null, stations = null, wrecks = null } = {}) {
  const on = !!state.enabled;
  if (Array.isArray(npcs)) {
    for (let i = 0; i < npcs.length; i++) {
      const e = npcs[i];
      if (!e) continue;
      if (!on || isFogFriendly(e, player)) { e.__fogVisible = true; continue; }
      const seen = fogPointVisible(state, posX(e), posY(e), entityMargin(state, e))
        || (finite(e.__fogRevealUntil, -1) > state.time);
      e.__fogVisible = seen;
      if (seen) e.__fogDiscovered = true;
    }
  }
  if (Array.isArray(stations)) {
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      if (!st) continue;
      if (!on || !st.isPirate) { st.__fogVisible = true; continue; }
      if (!st.__fogDiscovered && fogPointVisible(state, posX(st), posY(st), entityMargin(state, st))) st.__fogDiscovered = true;
      st.__fogVisible = !!st.__fogDiscovered;
    }
  }
  if (Array.isArray(wrecks)) {
    for (let i = 0; i < wrecks.length; i++) {
      const w = wrecks[i];
      if (!w) continue;
      w.__fogKind = 'wreck';
      if (!on || w.__fogDiscovered) { w.__fogVisible = true; continue; }
      if (fogPointVisible(state, posX(w), posY(w), entityMargin(state, w))) w.__fogDiscovered = true;
      w.__fogVisible = !!w.__fogDiscovered;
    }
  }
}

/** Czy mgła chowa byt (rysunek, celowanie, HUD). Gracz i sojusznicy nigdy. */
export function fogHides(state, e, player = null) {
  if (!state?.enabled || !e) return false;
  if (isFogFriendly(e, player)) return false;
  // wrak bez oceny (nowy, zwykle z walki w kadrze) — widoczny do pierwszego kroku mgły
  if (e.__fogKind === 'wreck') return e.__fogVisible === false;
  return e.__fogVisible !== true;
}

/** Odsłania byt na `sec` sekund (np. błysk strzału, trafienie skanerem). */
export function revealFogEntity(state, e, sec) {
  if (!e) return;
  const until = state.time + Math.max(0, finite(sec));
  if (!(finite(e.__fogRevealUntil, -1) >= until)) e.__fogRevealUntil = until;
}

// ---------------------------------------------------------------- SYGNATURY MASY
// { id, x, y — prawdziwe miejsce; shownX, shownY — miejsce wskazane przez czujniki (niepewne); spread — promień
//   niepewności; mass — t; label; entity — rozpoznanie: byt widoczny (`__fogVisible`); resolved, alpha 0…1 }

/** Stawia albo przestawia sygnaturę masy. Odchyłka pozycji: spec.offset { x, y } (j. świata). */
export function setMassSignature(state, id, spec = {}) {
  let m = state.masses.find((q) => q.id === id);
  if (!m) {
    m = { id, x: 0, y: 0, shownX: 0, shownY: 0, spread: 0, mass: 0, label: '', entity: null, resolved: false, alpha: 0, born: state.time };
    state.masses.push(m);
  }
  m.x = finite(spec.x, m.x);
  m.y = finite(spec.y, m.y);
  const ox = finite(spec.offset?.x, 0), oy = finite(spec.offset?.y, 0);
  m.shownX = m.x + ox;
  m.shownY = m.y + oy;
  m.spread = Math.max(1000, finite(spec.spread, m.spread || 8000));
  m.mass = Math.max(0, finite(spec.mass, m.mass));
  m.label = spec.label != null ? String(spec.label) : m.label;
  m.entity = spec.entity || null;
  m.resolved = false;
  return m;
}

export function clearMassSignature(state, id) {
  const i = state.masses.findIndex((q) => q.id === id);
  if (i >= 0) state.masses.splice(i, 1);
}

export function getMassSignature(state, id) {
  return state.masses.find((q) => q.id === id) || null;
}

/** Czy sygnatura została rozpoznana (jej byt albo jej środek w zasięgu wzroku). */
export function isMassSignatureResolved(state, id) {
  const m = getMassSignature(state, id);
  return !m || m.resolved;
}

/** Krok sygnatur: rozpoznanie i wygaszanie. Bez mgły (wyłączonej) rozpoznane od razu. */
export function stepMassSignatures(state, dt) {
  const step = Math.max(0, finite(dt));
  const fade = step / Math.max(0.05, state.tune.massResolveSec);
  for (let i = state.masses.length - 1; i >= 0; i--) {
    const m = state.masses[i];
    if (!m.resolved) {
      const e = m.entity;
      const seen = !state.enabled
        || (e ? (e.__fogVisible === true || e.__fogDiscovered === true) : fogPointVisible(state, m.x, m.y, 0));
      if (seen) m.resolved = true;
    }
    if (m.resolved) {
      m.alpha = Math.max(0, m.alpha - fade);
      if (m.alpha <= 0) { state.masses.splice(i, 1); continue; }
    } else {
      m.alpha = Math.min(1, m.alpha + fade * 0.6);
    }
  }
}

/** Krok zegara mgły (czas gry). */
export function advanceFogClock(state, dt) {
  state.time += Math.max(0, finite(dt));
}

/** Szacunek masy do napisu: „~1,2 mln t”. */
export function formatMassEstimate(t) {
  const v = Math.max(0, finite(t));
  if (v >= 1e6) return `~${(v / 1e6).toFixed(1).replace('.', ',')} mln t`;
  if (v >= 1e3) return `~${Math.round(v / 1e3)} tys. t`;
  return `~${Math.round(v)} t`;
}

// ---------------------------------------------------------------- OBRAZ (Core3D)
// Świat mgły dla postu Core3D (src/3d/fog/fogOfWarView.js — rzut na kamerę renderu): koła wzroku (x, y, r, rodzaj)
// i sygnatury masy (x, y — miejsce WSKAZANE, R — niepewność, alfa, skręt wiru, ziarno) w j. świata gry, double.
export const FOG_WORLD_MASS_CAP = 4;

export function createFogWorld(circleCap = FOG_TUNE.maxSources) {
  return {
    on: false,
    time: 0,
    count: 0,
    circles: new Float64Array(circleCap * 4),
    massCount: 0,
    masses: new Float64Array(FOG_WORLD_MASS_CAP * 8),
    look: { density: 1, rim: 1, under: 1, mass: 1 }
  };
}

export function exportFogWorld(state, world) {
  world.on = !!state.enabled;
  world.time = state.time;
  const C = world.circles;
  const cap = Math.floor(C.length / 4);
  const n = Math.min(cap, state.sourceCount);
  for (let i = 0; i < n; i++) {
    const s = state.sources[i];
    const o = i * 4;
    C[o] = s.x; C[o + 1] = s.y; C[o + 2] = s.r; C[o + 3] = s.kind;
  }
  world.count = n;
  const M = world.masses;
  let m = 0;
  for (let i = 0; i < state.masses.length && m < FOG_WORLD_MASS_CAP; i++) {
    const q = state.masses[i];
    if (!(q.alpha > 0)) continue;
    const o = m * 8;
    M[o] = q.shownX; M[o + 1] = q.shownY; M[o + 2] = q.spread; M[o + 3] = q.alpha;
    // skręt wiru rośnie z masą (log): 1 mln t ≈ 2,4 rad
    M[o + 4] = Math.min(3.2, 0.8 + 0.27 * Math.log10(1 + q.mass));
    M[o + 5] = (q.born * 7.31) % 6.283;
    M[o + 6] = 0; M[o + 7] = 0;
    m++;
  }
  world.massCount = m;
  return world;
}

// ---------------------------------------------------------------- OPCJA (menu „Nowa gra”)
const FOG_OPTION_KEY = 'sc_fog_of_war';

/** Zapamiętany wybór „Mgła wojny” (domyślnie włączona). */
export function loadFogOption() {
  try {
    if (typeof localStorage === 'undefined') return true;
    const v = localStorage.getItem(FOG_OPTION_KEY);
    return v == null ? true : v === '1';
  } catch {
    return true;
  }
}

export function saveFogOption(on) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FOG_OPTION_KEY, on ? '1' : '0');
  } catch { /* tryb prywatny — wybór do przeładowania */ }
}
