// ============================================================
// Zasadzka w pasie asteroid (misja 2 „Odwet”, 2026-10-07) — GDZIE piraci wyrywają Atlasa z warpa w drodze
// powrotnej i KIEDY. Czysta logika (bez gry, three, DOM); klej: StoryGame (api.belt), skrypt: mission02.js.
//
// Kurs stocznia → K-7 zawsze przecina pas: stocznia stoi ≥ 8 AU za jego zewnętrzną krawędzią, Ziemia w środku
// (storyGame._shipyardCenter). Miejsce = punkt na cięciwie kursu w pasie:
//   - przy OLBRZYMIE (src/game/asteroidBeltGiants.js), gdy kurs mija jego bryłę bliżej niż `giantReach` —
//     punkt na kursie PRZED bryłą (promień bryły + `giantStandoff`): Atlas wyhamowany po wyrwaniu z warpa nie
//     wjeżdża rozpędem w skałę, a walka toczy się pod jej ścianą;
//   - inaczej w NAJGĘSTSZYM polu na cięciwie (gęstość skał PLAY — AsteroidBeltField.sampleMacro, wygładzona),
//     z dala od brzegów pasa;
//   - bez mapy gęstości (atrapy) — środek cięciwy.
// Wyzwalacz: gracz w pasie minął miejsce wzdłuż kursu (z zapasem na hamowanie po wyrwaniu z warpa) albo — gdy
// zszedł z kursu — przeciął promień miejsca (każda droga stocznia → Ziemia przechodzi przez ten promień).
// ============================================================

export const BELT_AMBUSH_TUNE = Object.freeze({
  step: 4000,           // [j.] krok próbkowania gęstości na cięciwie
  edge: 0.1,            // ułamek szerokości cięciwy przy brzegach pasa pomijany (zasadzka w głębi pasa)
  smooth: 3,            // okno wygładzania gęstości [próbki w każdą stronę]
  giantReach: 60000,    // [j.] kurs mija obrys olbrzyma bliżej niż tyle — zasadzka przy olbrzymie
  giantStandoff: 14000, // [j.] miejsce zasadzki tyle przed obrysem olbrzyma (promień bryły + standoff) — front
                        // zasadzki (6,5 km przed Atlasem + rzędy szyku) nie wpada w skałę
  brakeLead: 0.08,      // [s] zapas wyzwalacza: prędkość × tyle (hamowanie po wyrwaniu z warpa ~16 tys. j.)
  leadPad: 2500         // [j.] stały zapas wyzwalacza (lot napędem)
});

// Pierwiastki |f + t·d|² = R² (t rosnąco) albo null.
function circleRoots(fx, fy, dx, dy, R) {
  const A = dx * dx + dy * dy;
  if (!(A > 1e-9)) return null;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - R * R;
  const D = B * B - 4 * A * C;
  if (D < 0) return null;
  const s = Math.sqrt(D);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}

/**
 * Pierwszy odcinek kursu from → to w pierścieniu pasa (inner ≤ r ≤ outer wokół `sun`), w kolejności lotu:
 * { t0, t1 } (ułamki odcinka) albo null (kurs omija pas).
 */
export function beltCrossing(from, to, sun, inner, outer) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const fx = from.x - sun.x, fy = from.y - sun.y;
  const o = circleRoots(fx, fy, dx, dy, outer);
  if (!o) return null;
  let t0 = Math.max(0, o[0]);
  let t1 = Math.min(1, o[1]);
  if (!(t0 < t1)) return null;
  const i = inner > 0 ? circleRoots(fx, fy, dx, dy, inner) : null;
  if (i) {
    if (i[0] > t0 && i[0] < t1) t1 = i[0];               // kurs wchodzi w dziurę pasa (ku Słońcu)
    else if (i[0] <= t0 && i[1] > t0) t0 = Math.max(t0, i[1]);   // start w dziurze — pas od wyjścia z niej
  }
  return t0 < t1 ? { t0, t1 } : null;
}

/**
 * Miejsce zasadzki na kursie from → to.
 *   belt    — { inner, outer } [j. od Słońca],
 *   density — (x, y) → gęstość skał (opcjonalnie),
 *   giants  — [{ id, x, y, radius }] (opcjonalnie).
 * Wynik: null (kurs omija pas) albo { x, y, along, dirX, dirY, angle, r, kind: 'giant' | 'field' | 'belt',
 * giant, density, from, entry, exit } — `along` [j.] od `from` wzdłuż kursu, `entry` / `exit` — brzegi pasa.
 */
export function planBeltAmbush({ from, to, sun, belt, density = null, giants = null, tune = BELT_AMBUSH_TUNE }) {
  if (!from || !to || !sun || !belt || !(belt.outer > belt.inner)) return null;
  const cr = beltCrossing(from, to, sun, belt.inner, belt.outer);
  if (!cr) return null;
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const a0 = cr.t0 * len, a1 = cr.t1 * len;
  const at = (a) => ({ x: from.x + ux * a, y: from.y + uy * a });
  let along = (a0 + a1) / 2;
  let kind = 'belt';
  let giant = null;
  let dens = 0;

  // olbrzym blisko kursu (najmniejsza odległość od kursu wygrywa)
  let bestLat = Infinity;
  for (const g of giants || []) {
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
    const R = Math.max(0, Number(g.radius) || 0);
    const gx = g.x - from.x, gy = g.y - from.y;
    const ga = gx * ux + gy * uy;
    const lat = Math.abs(gx * uy - gy * ux);
    if (lat > R + tune.giantReach || ga < a0 - R || ga > a1 + R) continue;
    if (lat >= bestLat) continue;
    // przed bryłą, gdy kurs w nią celuje (Atlas hamuje po wyrwaniu — nie w skałę)
    const keep = R + tune.giantStandoff;
    const a = lat < keep ? ga - Math.sqrt(keep * keep - lat * lat) : ga;
    if (a < 0) continue;
    bestLat = lat;
    along = a;
    kind = 'giant';
    giant = g.id ?? null;
  }

  if (kind !== 'giant' && typeof density === 'function') {
    const pad = (a1 - a0) * tune.edge;
    const s0 = a0 + pad, s1 = a1 - pad;
    const n = Math.max(1, Math.floor((s1 - s0) / tune.step) + 1);
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = at(n === 1 ? (s0 + s1) / 2 : s0 + (s1 - s0) * i / (n - 1));
      const v = Number(density(p.x, p.y));
      raw[i] = Number.isFinite(v) ? v : 0;
    }
    let best = -1, bestV = -Infinity;
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      for (let k = Math.max(0, i - tune.smooth); k <= Math.min(n - 1, i + tune.smooth); k++) { sum += raw[k]; cnt++; }
      const v = sum / cnt;
      if (v > bestV) { bestV = v; best = i; }
    }
    if (best >= 0 && bestV > 0) {
      along = n === 1 ? (s0 + s1) / 2 : s0 + (s1 - s0) * best / (n - 1);
      kind = 'field';
      dens = raw[best];
    }
  }

  const p = at(along);
  return {
    x: p.x, y: p.y, along, dirX: ux, dirY: uy, angle: Math.atan2(uy, ux),
    r: Math.hypot(p.x - sun.x, p.y - sun.y),
    kind, giant, density: dens,
    from: { x: from.x, y: from.y }, entry: at(a0), exit: at(a1)
  };
}

/**
 * Czy gracz doleciał do miejsca zasadzki: w pasie (z zapasem) i minął miejsce wzdłuż kursu albo przeciął jego
 * promień. Zapas = prędkość × brakeLead + leadPad — wyrwany z warpa Atlas hamuje kilkanaście tysięcy j.
 */
export function beltAmbushReached(plan, pos, vel, sun, belt, tune = BELT_AMBUSH_TUNE) {
  if (!plan || !pos || !sun || !belt) return false;
  const speed = vel ? Math.hypot(Number(vel.x) || 0, Number(vel.y) || 0) : 0;
  const lead = speed * tune.brakeLead + tune.leadPad;
  const r = Math.hypot(pos.x - sun.x, pos.y - sun.y);
  // pierścień pasa — poszerzony o miejsce (olbrzym tuż przy brzegu: punkt przed bryłą bywa przed pasem)
  if (r > Math.max(belt.outer, plan.r) + lead || r < Math.min(belt.inner, plan.r) - lead) return false;
  const along = (pos.x - plan.from.x) * plan.dirX + (pos.y - plan.from.y) * plan.dirY;
  if (along >= plan.along - lead) return true;
  return Math.abs(r - plan.r) <= lead;
}
