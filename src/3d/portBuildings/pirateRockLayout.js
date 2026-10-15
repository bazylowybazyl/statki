// Planetoida pod bazą piratów (misja 1) — czysta geometria (bez Three i DOM: gra, testy Node, generator map).
//
// Prośba użytkownika 2026-10-15: „w misji brakuje księżyca / planetoidy — piraci powinni wybudować bazę nad
// planetoidą; winda kosmiczna i budowle na planetoidzie, które rozwalają się wraz z bazą”. Decyzje użytkownika:
//  - skała POD BAZĄ i wystaje z boku (w wolną ćwiartkę bazy +x, +z — bez pomostów),
//  - winda z HABITATU (lina spod dysku mieszkalnego), rozpad habitatu w finale ją zrywa,
//  - budowle na skale giną SCENARIUSZEM (bez fizyki belek): lina opada, kabiny spadają, osada wybucha po kolei,
//  - skała ciemna z lodem (centaur): piraci wydobywają lód na paliwo — winda karmi zbiorniki P bazy.
//
// UKŁAD: współrzędne układu bazy (x wzdłuż osi podejścia, z w poprzek — pirateBaseLayout.js) i WYSOKOŚĆ h = z świata
// (pod płaszczyzną gry ujemna). Trójka (x, h, z) jest prawoskrętna jak scena three z osią Y w górę, a ramka bazy
// (portModuleFrame) przenosi ją do sceny gry OBROTEM bez odbicia — skałę i osadę można nagrywać w (x, h, z).
//
// RZUT: skała, osada i lina są w passie TŁA Core3D (warstwa 1 — kamera perspektywy jak dysk mieszkalny habitatu;
// pass ring-planet małych ciał rysuje się PO tle i przykryłby dysk). Kamera z góry stoi pół kadru / tan 17,5° nad
// płaszczyzną (kadr 9 × 5 km — ~8 km), więc głębia to paralaksa: szczyt skały 8 km pod płaszczyzną wygląda o połowę
// mniejszy i płynie wolniej niż baza. Promień 16 km i stopa windy 5,5 km od habitatu dobrane tak, żeby w kadrach gry
// skała leżała pod bazą i wystawała z boku (szkic: r ≈ 9 km w rzucie), a lina wychodziła spod dysku habitatu.
//
// OSADA (stopa windy) stoi na WYRÓWNANYM TARASIE na szczycie skały (generator map: d = 0 w promieniu `plateau`), więc
// bryły nagrywa się na kuli o promieniu R. Położenie na powierzchni: (e, n) — odległości wzdłuż powierzchni od stopy
// windy, e = „wschód” = od habitatu na zewnątrz (kierunek `bearing`), n = „północ” (prawoskrętnie: up × wschód).
// Mapa tekstur skały: stopa windy = (lon 0, lat 0), wschód = +lon, północ = +lat (pirateRockLonLat — ten sam wzór
// w generatorze scripts/planety/male_ciala.py: hidalgo).

// Osada: budowle na tarasie (e, n w j. po powierzchni; r — promień obrysu), drogi, odkrywki lodu (także poza tarasem —
// tylko w mapie) i placówki; promień skały i taras. JEDNO źródło dla brył (pirateRockScene.js), planu zawalenia
// i generatora map (blok czytany przez male_ciala.py: wczytaj_json_z_js(…, 'PIRATE_ROCK_SITE')).
export const PIRATE_ROCK_SITE = Object.freeze(
  /*PIRATE_ROCK_SITE*/{
    "radius": 16000,
    "plateau": 3600,
    "buildings": [
      { "id": "foot", "kind": "foot", "e": 0, "n": 0, "r": 520, "yaw": 0.0 },
      { "id": "tanks", "kind": "tanks", "e": 1050, "n": 1200, "r": 540, "yaw": 0.35 },
      { "id": "plant", "kind": "plant", "e": 1400, "n": -260, "r": 560, "yaw": -0.1 },
      { "id": "silos", "kind": "silos", "e": 420, "n": -1380, "r": 380, "yaw": 0.6 },
      { "id": "reactor", "kind": "reactor", "e": -1250, "n": -1150, "r": 440, "yaw": 0.2 },
      { "id": "domes", "kind": "domes", "e": -1000, "n": 1150, "r": 480, "yaw": -0.4 },
      { "id": "pads", "kind": "pads", "e": 2550, "n": 950, "r": 600, "yaw": 0.15 },
      { "id": "mast", "kind": "mast", "e": -480, "n": 430, "r": 130, "yaw": 0.0 },
      { "id": "mine", "kind": "mine", "e": 2350, "n": -1350, "r": 760, "yaw": -0.3 }
    ],
    "roads": [["foot", "tanks"], ["foot", "plant"], ["foot", "silos"], ["foot", "reactor"], ["foot", "domes"],
      ["plant", "pads"], ["plant", "mine"], ["foot", "mast"], ["tanks", "pads"]],
    "pits": [
      { "e": 2350, "n": -1350, "r": 640 },
      { "e": 6400, "n": 3900, "r": 950 },
      { "e": -5200, "n": 5400, "r": 720 },
      { "e": 7800, "n": -4600, "r": 1150 },
      { "e": -2800, "n": -7000, "r": 820 },
      { "e": 11500, "n": 1500, "r": 900 }
    ],
    "outposts": [
      { "e": 6900, "n": 2300 },
      { "e": -5800, "n": 4200 },
      { "e": 3200, "n": -7400 },
      { "e": 9400, "n": -1300 },
      { "e": -8200, "n": -2600 }
    ]
  }/*PIRATE_ROCK_SITE-KONIEC*/
);

export const PIRATE_ROCK_SPEC = Object.freeze({
  id: 'hidalgo',
  label: 'Hidalgo',
  radius: PIRATE_ROCK_SITE.radius,
  bearing: Math.PI / 4,      // kierunek stopy windy (i środka skały) od osi habitatu: kąt od +x ku +z
  footDist: 5500,            // [j.] odległość pozioma stopy windy od osi habitatu
  footH: -8000,              // [j.] h szczytu skały = poziom tarasu osady
  anchorTop: -1060,          // głowica kotwicy windy pod dyskiem mieszkalnym (dno dysku: −1056)
  anchorH: -1540,            // dół głowicy — tu zaczyna się lina
  stationTop: 660,           // wysokość wieży stacji dolnej nad tarasem (tam wchodzi lina)
  segments: 16,              // odcinki liny (grupy renderu)
  climbers: 2,               // kabiny windy
  plateau: PIRATE_ROCK_SITE.plateau,   // [j. po powierzchni] promień wyrównanego tarasu (mapa kształtu: d = 0)
  gravity: 400,              // [j/s²] ku środkowi skały (jak grawitacja habitatu — przechył wieży, pirateBaseNeck.js)
  cableR: 34                 // [j.] promień wiązki liny (kolizja z powierzchnią)
});

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

/** Kwaternion (x, y, z, w) z bazy prawoskrętnej: kolumny X, Y, Z (obrazy osi lokalnych). */
export function quatFromBasis(X, Y, Z) {
  const m00 = X[0], m10 = X[1], m20 = X[2];
  const m01 = Y[0], m11 = Y[1], m21 = Y[2];
  const m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/** Iloczyn kwaternionów a · b (najpierw b). */
export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}

/** (lon, lat) [rad] punktu (e, n) na skale promienia R — ten sam wzór co generator (hidalgo). */
export function pirateRockLonLat(e, n, R) {
  const rho = Math.hypot(e, n);
  if (rho < 1e-9) return { lon: 0, lat: 0 };
  const phi = rho / R;
  const s = Math.sin(phi);
  return { lon: Math.atan2((s * e) / rho, Math.cos(phi)), lat: Math.asin(Math.max(-1, Math.min(1, (s * n) / rho))) };
}

/**
 * Geometria skały w układzie bazy. Zwraca { spec, R, center, up, east, north, foot, anchor, anchorTop, stationTop,
 * meshQuat (kula three: lokalne → układ bazy), surfacePoint, frameAt, lonLat, uvAt, buildings, buildingById, tether }.
 */
export function createPirateRockLayout(spec = PIRATE_ROCK_SPEC, site = PIRATE_ROCK_SITE) {
  const S = { ...PIRATE_ROCK_SPEC, ...spec };
  const R = S.radius;
  const cb = Math.cos(S.bearing);
  const sb = Math.sin(S.bearing);
  const up = [0, 1, 0];
  const east = [cb, 0, sb];
  // prawoskrętnie: północ = up × wschód
  const north = [sb, 0, -cb];
  const foot = [cb * S.footDist, S.footH, sb * S.footDist];
  const center = [foot[0], foot[1] - R, foot[2]];
  const anchor = [0, S.anchorH, 0];
  const anchorTop = [0, S.anchorTop, 0];
  const stationTop = [foot[0], foot[1] + S.stationTop, foot[2]];
  // Kula three (SphereGeometry): punkt (u 0,5, v 0,5) = lokalne +X → stopa windy (up); wschód (+u) = lokalne −Z,
  // północ (+v) = lokalne +Y. Kolumny obrotu lokalne → układ bazy: X → up, Y → północ, Z → −wschód.
  const meshQuat = quatFromBasis(up, north, [-east[0], -east[1], -east[2]]);

  /** Punkt powierzchni (e, n) na tarasie / kuli i normalna; lift — nad powierzchnią wzdłuż normalnej. */
  function surfacePoint(e, n, lift = 0, out = {}) {
    const rho = Math.hypot(e, n);
    const phi = rho / R;
    const c = Math.cos(phi);
    const s = rho > 1e-9 ? Math.sin(phi) / rho : 0;
    const dx = c * up[0] + s * (e * east[0] + n * north[0]);
    const dy = c * up[1] + s * (e * east[1] + n * north[1]);
    const dz = c * up[2] + s * (e * east[2] + n * north[2]);
    const r = R + lift;
    out.x = center[0] + dx * r;
    out.h = center[1] + dy * r;
    out.z = center[2] + dz * r;
    out.nx = dx; out.nh = dy; out.nz = dz;
    return out;
  }

  /**
   * Ramka budowli na powierzchni: początek na powierzchni (e, n), osie lokalne X (wschód obrócony o yaw), Y (normalna),
   * Z = X × Y; quat — obrót lokalne → układ bazy. Punkt lokalny (a, y, b) → o + X·a + Y·y + Z·b.
   */
  function frameAt(e, n, yaw = 0) {
    const p = surfacePoint(e, n);
    const N = [p.nx, p.nh, p.nz];
    // wschód przeniesiony na styczną w punkcie
    const d = east[0] * N[0] + east[1] * N[1] + east[2] * N[2];
    let ex = east[0] - d * N[0];
    let ey = east[1] - d * N[1];
    let ez = east[2] - d * N[2];
    const el = len3(ex, ey, ez) || 1;
    ex /= el; ey /= el; ez /= el;
    // północ' = N × wschód'
    const nx = N[1] * ez - N[2] * ey;
    const ny = N[2] * ex - N[0] * ez;
    const nz = N[0] * ey - N[1] * ex;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const X = [c * ex + s * nx, c * ey + s * ny, c * ez + s * nz];
    // Z = X × Y
    const Z = [X[1] * N[2] - X[2] * N[1], X[2] * N[0] - X[0] * N[2], X[0] * N[1] - X[1] * N[0]];
    return { o: [p.x, p.h, p.z], X, Y: N, Z, quat: quatFromBasis(X, N, Z), e, n };
  }

  const lonLat = (e, n) => pirateRockLonLat(e, n, R);
  /** uv mapy skały (SphereGeometry three: u od 180° W na wschód, v = 1 biegun płn.). */
  const uvAt = (e, n) => {
    const ll = lonLat(e, n);
    return { u: 0.5 + ll.lon / (2 * Math.PI), v: 0.5 + ll.lat / Math.PI };
  };

  const buildings = site.buildings.map((b, i) => {
    const fr = frameAt(b.e, b.n, b.yaw || 0);
    return { ...b, index: i, frame: fr, group: 0 };
  });
  const buildingById = new Map(buildings.map((b) => [b.id, b]));

  // Lina: od dołu głowicy kotwicy do szczytu wieży stacji dolnej, `segments` równych odcinków.
  const N = Math.max(2, S.segments | 0);
  const nodes = new Float64Array((N + 1) * 3);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    nodes[i * 3] = anchor[0] + (stationTop[0] - anchor[0]) * t;
    nodes[i * 3 + 1] = anchor[1] + (stationTop[1] - anchor[1]) * t;
    nodes[i * 3 + 2] = anchor[2] + (stationTop[2] - anchor[2]) * t;
  }
  const tetherLen = len3(stationTop[0] - anchor[0], stationTop[1] - anchor[1], stationTop[2] - anchor[2]);
  const tether = { segments: N, nodes, length: tetherLen, segLen: tetherLen / N };

  return {
    spec: S, R, center, up, east, north, foot, anchor, anchorTop, stationTop, meshQuat,
    surfacePoint, frameAt, lonLat, uvAt, buildings, buildingById, tether, site
  };
}

/** Wysokość powierzchni kuli skały pod punktem (x, z) układu bazy (−Infinity poza obrysem). */
export function pirateRockSurfaceH(layout, x, z) {
  const dx = x - layout.center[0];
  const dz = z - layout.center[2];
  const q = layout.R * layout.R - dx * dx - dz * dz;
  return q >= 0 ? layout.center[1] + Math.sqrt(q) : -Infinity;
}

// ---------------------------------------------------------------------------
// Plan zawalenia osady (scenariusz, decyzja użytkownika 2026-10-15) — czasy od zerwania liny [s].

export const PIRATE_ROCK_COLLAPSE = Object.freeze({
  // zasilanie osady gaśnie (okna od środka), koguty alarmu do zgaśnięcia
  powerFrom: 0.4, powerTo: 3.2,
  // budowle: kolejność i czas od zerwania; blast — rozmiar wybuchu [j.], dur — trwanie zapadania [s]
  order: Object.freeze([
    Object.freeze({ id: 'foot', t: 1.7, blast: 900, dur: 2.6 }),       // lina wyrywa kotwicę stacji dolnej
    Object.freeze({ id: 'mast', t: 2.3, blast: 260, dur: 3.4 }),
    Object.freeze({ id: 'tanks', t: 2.9, blast: 1300, dur: 2.2 }),     // wodór i tlen z lodu — jak zbiorniki P bazy
    Object.freeze({ id: 'plant', t: 3.5, blast: 900, dur: 2.8 }),
    Object.freeze({ id: 'silos', t: 4.1, blast: 600, dur: 2.4 }),
    Object.freeze({ id: 'pads', t: 4.6, blast: 700, dur: 2.0 }),
    Object.freeze({ id: 'reactor', t: 5.3, blast: 1500, dur: 3.0 }),
    Object.freeze({ id: 'domes', t: 6.0, blast: 800, dur: 2.6 }),
    Object.freeze({ id: 'mine', t: 6.8, blast: 700, dur: 3.0 })
  ])
});

/** Kolejka zdarzeń zawalenia: [{ t, kind: 'power' | 'building', id, blast, dur }], posortowana po czasie. */
export function planPirateRockCollapse(layout, tune = PIRATE_ROCK_COLLAPSE) {
  const ev = [{ t: 0, kind: 'snap' }];
  for (const o of tune.order) if (layout.buildingById.has(o.id)) ev.push({ t: o.t, kind: 'building', id: o.id, blast: o.blast, dur: o.dur });
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

/** Ułamek zasilania osady w chwili t od zerwania (1 → 0). */
export function pirateRockPowerAt(t, tune = PIRATE_ROCK_COLLAPSE) {
  if (!(t > tune.powerFrom)) return 1;
  if (t >= tune.powerTo) return 0;
  const k = (t - tune.powerFrom) / (tune.powerTo - tune.powerFrom);
  // migotanie przy gaśnięciu (deterministyczne)
  const flick = 0.82 + 0.18 * Math.sin(t * 37.0) * Math.sin(t * 11.3);
  return Math.max(0, (1 - k * k) * flick);
}

/**
 * Zapadanie budowli: ułamek a ∈ [0, 1] → { sink (ułamek wysokości w dół wzdłuż normalnej), squash (skala wzdłuż
 * normalnej), tilt [rad] }. Maszt się przewraca (tilt do ~80°), reszta „siada” i przechyla się kilkanaście stopni.
 */
export function pirateRockCollapsePose(kind, a, out = {}) {
  const t = Math.max(0, Math.min(1, a));
  const e = 1 - (1 - t) * (1 - t) * (1 - t);
  if (kind === 'mast') {
    out.sink = 0.05 * e;
    out.squash = 1;
    out.tilt = 1.38 * t * t;
  } else {
    const deep = kind === 'tanks' || kind === 'reactor' ? 0.62 : 0.5;
    out.sink = 0.12 * e;
    out.squash = 1 - deep * e;
    out.tilt = (kind === 'foot' ? 0.32 : 0.24) * e;
  }
  return out;
}
