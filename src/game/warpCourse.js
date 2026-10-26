// src/game/warpCourse.js
//
// QOL warpa (2026-10-04): RĘCZNY skok z kursem na cel. Kurs (cel TRAVEL TO, znacznik misji) zostaje
// po przejęciu sterów — ręczny lot i klawisz warpa przerywają automat podróży, ale nie kasują celu.
// Skok ładowany z dziobem w tolerancji ±5° od namiaru punktu skoku (odcinek planisty: cel albo
// objazd / brzeg studni grawitacji) dostaje DOKŁADNY namiar i wychodzi sam, tak że rampa wyjścia
// (warpDrive.js: WARP_EXIT) staje w punkcie. HUD (index.html: drawWarpCourseOverlay) pokazuje namiar,
// odchyłkę i przewidywane minięcie.
//
// WARP ZAWSZE DO CELU (DECYZJE-2 T1, 2026-10-26 — user: „tak robimy [warp do celu]”; model C z analizy „warp
// z miejsca do miejsca”): swobodnego skoku w dziób bez końca nie ma. CapsLock / 9 wybiera skok po kolei
// (`chooseWarpJump`): (1) KURS — odcinek 'warp' kursu TRAVEL TO, gdy dziób jest w ±5° od jego namiaru (zielone pasmo
// HUD-u), a w stożku ±20° kurs wygrywa z innymi celami; (2) CEL W STOŻKU ±20° przed dziobem (`pickWarpConeTarget` —
// ciało, port, stacja, punkt misji, pole pasa, wrak, kontakt: co gra zna jako cele; tarcza / studnia ciała liczy się jak
// trafienie w środek); (3) SKOK AWARYJNY 400 tys. j. w dziób (warpDrive.js: planWarpEmergency — skrócony przed brzegiem
// studni i świata, zawsze z rampą), bez dodatkowej ceny. Każdy wybór dostaje dokładny namiar przy starcie ładowania
// i automatyczne wyjście przy punkcie. NAMIAR ODCHODZI OD DZIOBA NAJWYŻEJ O STOŻEK (+ coneLegSlack na objazd planisty):
// ciało ze studnią dostaje punkt tam, gdzie promień dzioba (obrócony o tyle, ile trzeba, żeby trafić w studnię) wchodzi
// w jej brzeg — nie punkt po stronie statku na linii do środka (przy bliskiej, dużej studni to było 40–55°). Dziób
// dociąga się do namiaru JESZCZE W ŁADOWANIU (`warpChargeTurn`, index.html — gałąź ładowania): w skoku bez skrętu.
//
// Czysta logika (bez DOM, three, gry).

/** Strojenie kursu ręcznego skoku. */
export const WARP_COURSE_TUNE = Object.freeze({
  tolerance: 5 * Math.PI / 180,   // dziób w tej odchyłce od namiaru — skok z wyjściem przy celu (zielone pasmo HUD-u)
  clearRadius: 6000,              // [j.] cel osiągnięty (poza automatem podróży) — kurs znika
  refresh: 0.25,                  // [s] odświeżanie punktu skoku (planista trasy) poza skokiem
  // Stożek celu przed dziobem (T1): ±20° (krytyk § 5: alignRate 72°/s obraca dziób o 20° w 0,28 s — ładowanie 0,8 s).
  cone: 20 * Math.PI / 180,
  // Namiar pierwszego odcinka planisty do celu ze stożka może odejść od dzioba o stożek + tyle (objazd, punkt podróży
  // obok celu); dalej — cel pominięty (np. pierwszy odcinek to objazd studni w bok).
  coneLegSlack: 4 * Math.PI / 180,
  // [j.] punkt skoku do ciała ze studnią: tyle przed jej brzegiem na promieniu skoku (= TRAVEL_TUNE.wellMargin × 2 —
  // travelNav.js: travelApproachPoint, CIC; strażnik w tests/warpDoCelu.test.mjs)
  coneWellMargin: 2200
});

/**
 * DOCIĄGANIE DZIOBA W ŁADOWANIU (DECYZJE-2 T1, ograniczenie 15 „bez skrętu w skoku”): nowa prędkość kątowa [rad/s]
 * kadłuba ku namiarowi skoku `target` — proporcjonalnie do odchyłki (k / s), najwyżej `rate` (alignRate skoku, 72°/s),
 * z wygładzeniem `follow` / s (follow = 4k: tłumienie krytyczne — bez przeregulowania). Stożek 20° + zapas 4° dochodzi
 * w ~0,55 s ładowania (0,8 s); resztę (< 0,3°) bierze lot. Wołający całkuje kąt: angle += w · dt.
 */
export const WARP_CHARGE_TURN = Object.freeze({ k: 8, follow: 32 });   // follow = 4k — tłumienie krytyczne (bez przeregulowania)
export function warpChargeTurn(angle, angVel, target, rate, dt, tune = WARP_CHARGE_TURN) {
  const diff = wrapPi((Number(target) || 0) - (Number(angle) || 0));
  const lim = Math.max(0, Number(rate) || 0);
  const want = Math.max(-lim, Math.min(lim, diff * tune.k));
  const w = Number(angVel) || 0;
  return w + (want - w) * Math.min(1, tune.follow * Math.max(0, Number(dt) || 0));
}

/** Rodzaje wyboru skoku (HUD, plan trasy `warp.route.kind`). */
export const WARP_JUMP_KINDS = Object.freeze(['course', 'cone', 'emergency']);

/**
 * Odchyłka celu od dzioba z tarczą [rad, ≥ 0]: |namiar − kurs| pomniejszony o promień kątowy celu (atan(r / d)) —
 * dziób na tarczy / studni ciała = 0. `r` ≤ 0 — punkt.
 */
export function warpConeError(pos, heading, x, y, r = 0) {
  const dx = x - pos.x;
  const dy = y - pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!(d > 1e-6)) return 0;
  const err = Math.abs(wrapPi(Math.atan2(dy, dx) - heading));
  const rr = Number(r) > 0 ? Number(r) : 0;
  const angR = rr > 0 ? Math.atan2(Math.min(rr, d), d) : 0;
  return Math.max(0, err - angR);
}

/**
 * PUNKT SKOKU DO CELU ZE STOŻKA (T1): ciało ze studnią (c.r > 0) — wejście promienia skoku w brzeg studni + `margin`
 * (tune.coneWellMargin), przy czym promień to dziób obrócony NAJMNIEJ, ile trzeba, żeby trafić w studnię: o
 * max(0, |namiar środka − dziób| − atan(r / d)) ≤ stożek (warpConeError). atan(r / d) < asin((r + margin) / d), więc
 * promień zawsze wchodzi w okrąg studni z zapasem przed środkiem (bez stycznej). Punkt (c.r ≤ 0) — punkt podróży
 * (c.tx, c.ty), domyślnie (c.x, c.y). Statek w zapasie studni (d ≤ r + margin) — punkt podróży. Wynik w `out` ({ x, y }).
 */
export function warpConeAimPoint(pos, heading, c, tune = WARP_COURSE_TUNE, out = {}) {
  const tx = Number.isFinite(c.tx) ? c.tx : c.x;
  const ty = Number.isFinite(c.ty) ? c.ty : c.y;
  out.x = tx;
  out.y = ty;
  const rr = Number(c.r) > 0 ? Number(c.r) : 0;
  if (!(rr > 0)) return out;
  const fx = pos.x - c.x;
  const fy = pos.y - c.y;
  const d = Math.sqrt(fx * fx + fy * fy);
  const R = rr + Math.max(0, Number(tune.coneWellMargin) || 0);
  if (!(d > R)) return out;
  const delta = wrapPi(Math.atan2(-fy, -fx) - heading);
  const turn = Math.max(0, Math.abs(delta) - Math.atan2(rr, d));
  const th = heading + (delta < 0 ? -turn : turn);
  const ux = Math.cos(th);
  const uy = Math.sin(th);
  const b = fx * ux + fy * uy;
  const disc = b * b - (d * d - R * R);
  if (!(disc > 0)) return out;
  const t = -b - Math.sqrt(disc);
  if (!(t > 0)) return out;
  out.x = pos.x + ux * t;
  out.y = pos.y + uy * t;
  return out;
}

/**
 * CEL W STOŻKU przed dziobem (T1, krok 2). candidates: [{ x, y, r?, label?, kind?, tx?, ty? }] — (x, y) miejsce celu
 * (środek ciała), r — promień „tarczy” celu do stożka (studnia ciała; 0 — punkt), (tx, ty) — punkt podróży (domyślnie
 * x, y). legFor(cand, aim) → odcinek planisty z bieżącej pozycji do punktu skoku `aim` (warpConeAimPoint) ({ x, y, kind })
 * albo null. Kolejność: najmniejsza odchyłka z tarczą (warpConeError), przy równej — najbliższy. Pierwszy kandydat,
 * którego odcinek to 'warp' z namiarem w stożku + coneLegSlack, wygrywa. Kandydat bliżej niż `minDist` i ciało, w którego
 * studni statek stoi (wylot z niej — skok awaryjny), pominięte. Wynik: { cand, leg, bearing, err } albo null.
 */
export function pickWarpConeTarget(pos, heading, candidates, legFor, { minDist = 0, tune = WARP_COURSE_TUNE } = {}) {
  if (!Array.isArray(candidates) || !candidates.length || typeof legFor !== 'function') return null;
  const cone = tune.cone;
  const list = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const dx = c.x - pos.x;
    const dy = c.y - pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < minDist) continue;
    if (Number(c.r) > 0 && d <= Number(c.r)) continue;
    const e = warpConeError(pos, heading, c.x, c.y, c.r);
    if (e > cone + 1e-12) continue;
    list.push({ c, e, d });
  }
  list.sort((a, b) => (a.e - b.e) || (a.d - b.d));
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const aim = warpConeAimPoint(pos, heading, it.c, tune, {});
    const leg = legFor(it.c, aim);
    if (!leg || leg.kind !== 'warp') continue;
    const b = warpCourseBearing(pos, heading, leg, {});
    if (Math.abs(b.err) > cone + tune.coneLegSlack + 1e-12) continue;
    return { cand: it.c, leg, bearing: b.bearing, err: b.err };
  }
  return null;
}

/**
 * WYBÓR SKOKU klawiszem warpa (T1): kurs → cel w stożku → skok awaryjny. o:
 *   pos, heading       — statek (kurs = dziób),
 *   courseLeg          — odcinek kursu TRAVEL TO (planTravelLeg) albo null; courseLabel — podpis kursu,
 *   candidates, legFor — cele w stożku (pickWarpConeTarget), minDist — najkrótszy skok [j.],
 *   emergency(dirX, dirY) → plan skoku awaryjnego (warpDrive.js: planWarpEmergency — { ok, x, y, dist, cut }).
 * Kurs: odcinek 'warp' w ±5° (zielone pasmo) albo w stożku ±20° — kurs wybrany przez gracza wygrywa z innymi celami
 * w stożku (recenzja T, ust. 6: kurs na Jowisza 8° od dzioba i Mars w stożku — skok idzie kursem). Wynik: { kind: 'course'
 * | 'cone' | 'emergency', aim: { x, y }, bearing, label, cand, plan } albo { kind: null, reason } (skok awaryjny za krótki —
 * studnia albo brzeg świata tuż przed dziobem).
 */
export function chooseWarpJump(o, tune = WARP_COURSE_TUNE) {
  const pos = o.pos;
  const heading = Number(o.heading) || 0;
  const leg = o.courseLeg || null;
  if (leg && leg.kind === 'warp') {
    const b = warpCourseBearing(pos, heading, leg, {});
    if (warpCourseAligned(b.err, tune) || warpCourseInCone(b.err, tune)) {
      return { kind: 'course', aim: { x: leg.x, y: leg.y }, bearing: b.bearing, label: String(o.courseLabel || ''), cand: null, plan: null };
    }
  }
  const pick = pickWarpConeTarget(pos, heading, o.candidates, o.legFor, { minDist: Number(o.minDist) || 0, tune });
  if (pick) {
    return { kind: 'cone', aim: { x: pick.leg.x, y: pick.leg.y }, bearing: pick.bearing, label: String(pick.cand.label || ''), cand: pick.cand, plan: null };
  }
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  const plan = typeof o.emergency === 'function' ? o.emergency(dx, dy) : null;
  if (plan && plan.ok) {
    return { kind: 'emergency', aim: { x: plan.x, y: plan.y }, bearing: heading, label: '', cand: null, plan };
  }
  return { kind: null, reason: plan ? plan.cut : 'none', plan };
}

/** Kurs TRAVEL TO w stożku ±20° (HUD: CapsLock da skok kursem, dziób dociągnie komputer w ładowaniu). */
export function warpCourseInCone(err, tune = WARP_COURSE_TUNE) {
  return Math.abs(err) <= tune.cone + 1e-12;
}

function wrapPi(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/**
 * Namiar z `pos` na punkt `aim` względem kursu `heading` [rad].
 * out.bearing — namiar, out.err — odchyłka ze znakiem (namiar − kurs, w (−π, π]), out.dist.
 */
export function warpCourseBearing(pos, heading, aim, out = {}) {
  const dx = aim.x - pos.x;
  const dy = aim.y - pos.y;
  out.dist = Math.sqrt(dx * dx + dy * dy);
  out.bearing = Math.atan2(dy, dx);
  out.err = wrapPi(out.bearing - heading);
  return out;
}

/** Dziób w tolerancji — skok dostanie namiar punktu i wyjście przy nim. */
export function warpCourseAligned(err, tune = WARP_COURSE_TUNE) {
  return Math.abs(err) <= tune.tolerance + 1e-12;
}

/**
 * WARP kończy wskazania przy przejściu na DOLOT napędem (ostatni odcinek). Zamrożony punkt żyje do końca
 * skoku/rampy. Odcinek napędem, który nie jest ostatni (objazd studni grawitacji tuż przy okręcie),
 * zostaje na HUD-zie — inaczej znacznik kursu znikał na czas objazdu planety (2026-10-05).
 */
export function warpCourseHudVisible(leg, lockedAim, busy) {
  return !!(busy && lockedAim) || leg?.kind === 'warp' || (leg?.kind === 'drive' && leg.final === false);
}

/**
 * Tor skoku po prostej z `pos` w kierunku (dirX, dirY) względem punktu `aim`:
 * out.along — odległość do najbliższego podejścia (≤ 0: punkt już za statkiem),
 * out.miss — odległość od punktu w najbliższym podejściu (minięcie).
 */
export function warpCoursePass(pos, dirX, dirY, aim, out = {}) {
  const dx = aim.x - pos.x;
  const dy = aim.y - pos.y;
  out.along = dx * dirX + dy * dirY;
  const cross = dx * dirY - dy * dirX;
  out.miss = out.along > 0 ? Math.abs(cross) : Math.sqrt(dx * dx + dy * dy);
  return out;
}

/** Czas wyjść z warpa: rampa (droga `rampDist`) kończy się w najbliższym podejściu do punktu. */
export function warpCourseExitDue(pos, dirX, dirY, aim, rampDist) {
  const along = (aim.x - pos.x) * dirX + (aim.y - pos.y) * dirY;
  return along <= rampDist;
}
