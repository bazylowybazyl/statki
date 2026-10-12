// src/game/comets.js
//
// KOMETY — czysta logika (bez three i DOM; testy: tests/comets.test.mjs): stan na orbicie, aktywność,
// geometria gazu (koma, dżety, warkocz jonowy, warkocz pyłowy) z LUSTRAMI CPU wzorów shadera
// (src/3d/comets/comets.tsl.js — zmiana wzoru = obie strony), rozstawienie w świecie gry. Dane:
// src/data/comets.js, kolizje i zapytania gry: src/game/cometField.js.
//
// KOMETY STOJĄ (jak planety gry — speed 0). Uzasadnienie: (1) realny ruch w skali sesji jest znikomy (Halley
// przy 1 AU robi ~0,02 AU / dobę), a przyspieszony do skali gry przesuwałby jądro-przeszkodę i cel TRAVEL TO
// w trakcie lotu (planista odcinków liczy punkt raz); (2) misje, mgła wojny i radar traktują je jak teren —
// stały punkt orientacyjny; (3) warp „Nurt” i soczewka świata nie muszą znać ruchomego ciała. Orbita i tak
// wchodzi w obraz: anomalia prawdziwa chwili gry daje odległość od Słońca (aktywność), prędkość — zakrzywienie
// warkocza pyłowego i aberrację jonowego. Ruch po orbicie, gdyby kiedyś był potrzebny: zmiana `nuDeg`
// w czasie i przeliczenie `cometOrbitState` + `cometGasGeometry` (obraz czyta je co klatkę z miejsca komety).
//
// WARKOCZ PYŁOWY — model synchron / syndyn (Finson–Probstein w przybliżeniu krótkiego czasu): ziarno wyrzucone
// τ temu z ciśnieniem promieniowania β (ułamek grawitacji Słońca) oddala się od jądra radialnie o ½·β·g·τ²,
// a siła Coriolisa obracającego się układu jądra (prędkość kątowa orbity ω) spycha je W TYŁ za ruchem
// o (2/3)·ω·τ · R. W jednostkach warkocza (X = R / L, Y = T / L, u = τ / τmax, b = β / βmax, C = (2/3)·ω·τmax):
//   X = b·u²,   Y = C·b·u³   →   u = Y / (C·X),   b = C²·X³ / Y²,
// a jasność (rozkład ziaren a^−3,5, przekrój ∝ a²) ∝ 1 / (√X · Y) w obszarze b ∈ [bmin, 1], u ≤ 1. Krawędź
// b = 1 (najdrobniejszy pył, syndyna βmax) leży od strony kierunku antysłonecznego i jest ostra; najstarszy pył
// (synchrona τmax) — od strony orbity. Prędkość wyrzutu rozmywa krawędzie (σ ∝ u). Pasma synchroniczne =
// zmienność wydajności Q(u) w czasie emisji — proste pasma wychodzące z jądra.
//
// UKŁADY: świat gry (x w prawo, y W DÓŁ). „Układ warkocza”: X wzdłuż kierunku od Słońca, Y w stronę POZOSTAWANIA
// za ruchem (lag) — w świecie gry oś Y = lagSign · (−ay, ax).

import { COMET_TUNE, realAuToMapAu, realAuToMapSlope } from '../data/comets.js';

const DEG = Math.PI / 180;
const AU_KM_S = 29.78;      // prędkość orbitalna przy 1 AU [km/s] (√(GM/1 AU))
const AU_KM = 1.495979e8;   // 1 AU [km]
const DAY = 86400;

/** Aktywność (produkcja gazu) przy odległości r [prawdziwe AU] — 0 daleko, ~production przy 1 AU. */
export function cometActivity(def, rAu, tune = COMET_TUNE) {
  const r = Math.max(0.05, Number(rAu) || 0);
  const inv2 = 1 / (r * r);
  const water = inv2 / (1 + Math.pow(r / tune.waterR, tune.waterN));
  const co = (Number(def?.co) || 0) * inv2 / (1 + Math.pow(r / tune.coR, 4));
  return Math.max(0, (Number(def?.production) || 0) * (water + co));
}

/**
 * Stan komety na orbicie w chwili gry (AU mapy względem Słońca, kierunki jednostkowe w świecie gry).
 * `nuDeg` (opcjonalnie) zastępuje anomalię z danych — demo (suwak odległości) i przyszły ruch po orbicie.
 */
export function cometOrbitState(def, perihelionOffset = 0, tune = COMET_TUNE, nuDeg = null) {
  const o = def.orbit;
  const q = o.q, e = o.e;
  const dir = o.dir < 0 ? -1 : 1;
  const nu = (nuDeg != null ? Number(nuDeg) : (Number(o.nuDeg) || 0)) * DEG;
  const p = q * (1 + e);                                  // parametr orbity [AU]
  const rAu = p / (1 + e * Math.cos(nu));
  // Kąt biegunowy w grze: peryhelium + kierunek obiegu × ν.
  const theta = ((Number(o.perihelionDeg) || 0) * DEG) + perihelionOffset + dir * nu;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  // Prędkość: v_r = (GM/h) e sin ν, v_t = (GM/h)(1 + e cos ν); GM/h = 29,78 / √p [km/s].
  const k = AU_KM_S / Math.sqrt(p);
  const vr = k * e * Math.sin(nu);
  const vt = k * (1 + e * Math.cos(nu));
  // W AU mapy: składowa radialna × nachylenie odwzorowania, styczna × (r_mapy / r).
  const rMap = realAuToMapAu(rAu);
  const vrM = vr * realAuToMapSlope(rAu);
  const vtM = vt * rMap / rAu;
  // styczna w kierunku obiegu: dir · (−sin θ, cos θ)
  const tx = -uy * dir;
  const ty = ux * dir;
  let vx = ux * vrM + tx * vtM;
  let vy = uy * vrM + ty * vtM;
  const vl = Math.hypot(vx, vy) || 1;
  vx /= vl; vy /= vl;
  return {
    rAu, rMap, theta, ux, uy, vx, vy, nu,
    vKm: Math.hypot(vr, vt), vPerpKm: vt,
    omega: vt / (rAu * AU_KM),                            // prędkość kątowa orbity [rad/s]
    activity: cometActivity(def, rAu, tune)
  };
}

/**
 * Geometria gazu komety (j. gry). Układ warkocza: X = od Słońca (ax, ay); lagSign — w którą stronę osi
 * (−ay, ax) świata gry leży „za ruchem” (+1 / −1). Kąty i długości wspólne dla obrazu, radaru, mapy i testów.
 */
export function cometGasGeometry(def, st, au, tune = COMET_TUNE) {
  const A = st.activity;
  const ax = st.ux, ay = st.uy;
  const lagY = -(st.vx * (-ay) + st.vy * ax);
  const lagSign = lagY >= 0 ? 1 : -1;
  // Aberracja jonowego: oś odchylona w stronę „za ruchem” o atan(v⊥ / v_wiatru).
  const ionAngle = Math.atan2(Math.max(0, st.vPerpKm), tune.solarWind);
  const active = A >= tune.minActivity;
  const nucleusR = def.nucleus.radius;
  const ionLen = active ? tune.ionLen * Math.pow(A, tune.ionExp) * au : 0;
  const dustLen = active ? tune.dustLen * Math.pow(A, tune.dustExp) * au : 0;
  const comaR = active ? Math.min(tune.comaMax, nucleusR * 2 + tune.comaR * Math.sqrt(A)) : 0;
  // Zakrzywienie pyłu: C = (2/3)·ω·τmax (tangens kąta najstarszej synchrony od osi antysłonecznej).
  const dustC = Math.max(0.04, (2 / 3) * st.omega * tune.dustAgeDays * DAY * tune.dustCurlGain);
  return {
    active, activity: A,
    ax, ay, lagSign,
    ionAngle, ionLen,
    // u nasady jony rodzą się w komie — σ ≈ 12% promienia komy (+ minimum)
    ionWidth0: tune.ionWidth0 * (0.6 + 0.4 * Math.min(2, Math.sqrt(A))) + 0.12 * comaR,
    ionSpread: tune.ionSpread,
    dustLen, dustC, dustBmin: tune.dustBmin, dustEject: tune.dustEject, dustAgeSpan: tune.dustAgeSpan, dustGamma: tune.dustGamma,
    comaR, nucleusR,
    // Kąt najstarszej synchrony (krawędź warkocza od strony orbity) [rad] — mapa CIC i radar.
    dustAngle: Math.atan(dustC * tune.dustAgeSpan)
  };
}

// --- Lustra CPU wzorów shadera ---------------------------------------------------------------------------

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Obwiednia warkocza pyłowego (bez pasm, smug i kompresji jasności) w punkcie (X, Y) układu warkocza
 * w jednostkach długości pyłu (X = x / L, Y = y_lag / L). Lustro `dustTail` w comets.tsl.js. Zwraca jasność
 * względną (shader podnosi ją do potęgi dustGamma — kompresja zakresu: głowa ~100×, koniec ~2×).
 */
export function dustTailEnvelope(X, Y, geo) {
  const C = geo.dustC;
  const span = geo.dustAgeSpan;
  const x0 = 0.08 * geo.comaR / Math.max(1, geo.dustLen);
  const s0 = 0.22 * geo.comaR / Math.max(1, geo.dustLen);
  const Xc = Math.max(X, 1e-4);
  const Ya = Math.max(Math.abs(Y), 1e-5);
  // rozmycie u nasady = rozmiar komy (ziarna startują w całej komie) — dalej od głowy maleje
  const s0e = s0 / (1 + Xc / (2 * x0));
  const u = Ya / (C * Xc);
  const b = C * C * Xc * Xc * Xc / (Ya * Ya);
  const sig = geo.dustEject * u + s0e;
  const eb = Math.min(0.8, Math.max(0.05, 2 * sig / Ya));
  const inB = (1 - smooth(1 - eb, 1 + eb, b)) * smooth(geo.dustBmin * (1 - eb), geo.dustBmin * (1 + eb), b);
  const inU = 1 - smooth(span * 0.55, span, u);
  // po stronie przeciwnej tylko rozmycie wyrzutem przy syndynie b = 1 (u = √X)
  const sigN = geo.dustEject * Math.sqrt(Xc) * 0.5 + s0e;
  const side = Y >= 0 ? 1 : Math.exp(-(Y / sigN) * (Y / sigN));
  const head = smooth(0.5 * x0, 6 * x0, X);
  const tail = 1 - smooth(0.7, 1.15, X);
  // najdrobniejsze ziarna (b → 1, a ≲ 0,3 µm) słabo rozpraszają światło widzialne
  const mie = 1 + (0.12 - 1) * smooth(0.3, 1.0, b);
  return head * tail * inB * inU * side * mie / (Math.sqrt(Xc + x0) * Math.sqrt(Y * Y + sig * sig));
}

/**
 * Granice warkocza pyłowego w odległości X (jednostki długości pyłu): Y od syndyny b = 1 (najdrobniejszy pył —
 * ostra krawędź od strony antysłonecznej) do min(synchrona u = ageSpan, syndyna bmin) — od strony orbity.
 */
export function dustTailBounds(X, geo) {
  const C = geo.dustC;
  const x15 = Math.pow(Math.max(0, X), 1.5);
  const yIn = C * x15;
  const yOut = Math.min(geo.dustAgeSpan * C * Math.max(0, X), C * x15 / Math.sqrt(geo.dustBmin));
  return { yIn, yOut };
}

/** Oś warkocza jonowego: kierunek w układzie warkocza (X, Y_lag) — od Słońca, odchylony za ruch. */
export function ionTailAxis(geo) {
  return { x: Math.cos(geo.ionAngle), y: Math.sin(geo.ionAngle) };
}

/** Szerokość (σ) warkocza jonowego w odległości s wzdłuż osi — lustro shadera. */
export function ionTailWidth(s, geo) {
  return geo.ionWidth0 + geo.ionSpread * Math.max(0, s);
}

/**
 * Dżet: azymut emisji (układ warkocza bez odbicia lag: Słońce na kącie π) materii, która jest teraz
 * w odległości rho od jądra, i oświetlenie źródła w chwili emisji (> 0 — strona dzienna). Lustro `jets`.
 * spinLocal — obrót jądra względem osi warkocza [rad], omega [rad/s], gasSpeed [j./s].
 */
export function jetEmission(rho, jet, spinLocal, omega, gasSpeed, R) {
  const cosLat = Math.cos(jet.lat || 0);
  const tau = Math.max(rho - 0.85 * R, 0) / (gasSpeed * Math.max(0.2, cosLat));
  const phi = (jet.lon || 0) + spinLocal - omega * tau;
  const insolation = -cosLat * Math.cos(phi);
  return { tau, phi, insolation, lit: smooth(0, 0.35, insolation) };
}

/** Prostokąt arkusza gazu w układzie warkocza (X od Słońca, Y lag): [x0, x1, y0, y1] w j. gry. */
export function cometSheetExtent(geo, out = [0, 0, 0, 0]) {
  if (!geo.active) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
  const c = geo.comaR * 2.2;
  out[0] = -c;
  out[1] = Math.max(geo.ionLen * 1.05, geo.dustLen * 1.17) + c;
  // lag: najstarsza synchrona y = span·C·x do końca zaniku (X = 1,15) + rozmycie, jonowy: aberracja + 3σ
  const dustSide = geo.dustAgeSpan * geo.dustC * geo.dustLen * 1.15 + geo.dustLen * (geo.dustEject * geo.dustAgeSpan + 0.05);
  const ionW = 3 * ionTailWidth(geo.ionLen, geo);
  const ionLag = Math.sin(geo.ionAngle) * geo.ionLen + ionW;
  out[2] = -Math.max(c, ionW);
  out[3] = Math.max(c, dustSide, ionLag);
  return out;
}

// --- Rozstawienie ---------------------------------------------------------------------------------------

/**
 * Rozstawienie komet w świecie gry. Kąty planet są losowe na grę — kometa, której jądro (z komą) wypada
 * bliżej niż strefa zakazana (planeta + jej księżyce, punkty Lagrange'a Jowisza, inne komety), obraca orbitę
 * (peryhelium) o kolejne kroki ±stepDeg; wynik deterministyczny dla danych kątów planet.
 * keepOut: [{ x, y, r }] w j. gry; avoid(x, y, need) → true = miejsce zajęte (np. gęste pola pasa w ich
 * prawdziwym kształcie — `AsteroidBeltField.penetrationOf`).
 */
export function placeComets(defs, { sunX = 0, sunY = 0, au = 42253.52, keepOut = [], avoid = null, stepDeg = 9, maxSteps = 40, tune = COMET_TUNE } = {}) {
  const out = [];
  const zones = keepOut.slice();
  for (const def of defs) {
    let chosen = null;
    for (let k = 0; k <= maxSteps; k++) {
      const off = (k === 0 ? 0 : ((k & 1) ? 1 : -1) * Math.ceil(k / 2)) * stepDeg * DEG;
      const st = cometOrbitState(def, off, tune);
      const x = sunX + st.ux * st.rMap * au;
      const y = sunY + st.uy * st.rMap * au;
      const geo = cometGasGeometry(def, st, au, tune);
      const need = Math.max(geo.comaR * 2, def.nucleus.radius * 4);
      let ok = true;
      for (const z of zones) {
        if (Math.hypot(x - z.x, y - z.y) < z.r + need) { ok = false; break; }
      }
      if (ok && avoid && avoid(x, y, need)) ok = false;
      // bez wolnego miejsca po maxSteps — ostatni kandydat z flagą (gra ostrzega)
      if (ok || k === maxSteps) { chosen = { def, offset: off, state: st, geo, x, y, blocked: !ok }; break; }
    }
    zones.push({ x: chosen.x, y: chosen.y, r: Math.max(chosen.geo.comaR * 2, chosen.def.nucleus.radius * 4) + 3 * au });
    out.push(chosen);
  }
  return out;
}

/** Strefy zakazane planet: planeta + najdalszy księżyc + zapas (j. gry); `extra` — dodatkowe strefy gry. */
export function planetKeepOut(planets, moons = [], au = 42253.52, padAu = 1.5, extra = []) {
  const zones = [];
  for (const p of planets || []) {
    if (!p || !Number.isFinite(p.x)) continue;
    const id = String(p.id || p.name || '').toLowerCase();
    let reach = Math.max(Number(p.r) || 0, Number(p.ringWorldRadius) || 0) * 4.5;
    for (const m of moons) if (m && m.parentId === id) reach = Math.max(reach, Number(m.orbitRadius) || 0);
    zones.push({ x: p.x, y: p.y, r: reach + padAu * au });
  }
  for (const z of extra) if (z && Number.isFinite(z.x) && Number.isFinite(z.y)) zones.push({ x: z.x, y: z.y, r: Number(z.r) || 0 });
  return zones;
}

/** Punkty L4 / L5 planety (Trojańczycy) jako strefy zakazane: ±60° od planety na jej orbicie. */
export function trojanKeepOut(planet, sunX, sunY, r) {
  if (!planet || !Number.isFinite(planet.x)) return [];
  const a = Math.atan2(planet.y - sunY, planet.x - sunX);
  const d = Math.hypot(planet.x - sunX, planet.y - sunY);
  return [-1, 1].map((s) => ({ x: sunX + Math.cos(a + s * Math.PI / 3) * d, y: sunY + Math.sin(a + s * Math.PI / 3) * d, r }));
}
