/**
 * MAŁE CIAŁA — duże planetoidy pasa głównego i Pluton z Charonem (2026-10-12, docs/PLAN-pas-realizm.md,
 * strumień C). JEDNO źródło danych: gra (ciała 3D, stacje Unii Pasa, strefy i studnie, radar, mapa CIC),
 * ruch v2 (węzły 'ceres' i 'vesta'), pas asteroid (wyłączenia skał wokół ciał, rodziny kolizyjne A2),
 * mapy (planetMaps.js: SMALL_BODY_MAPS). Generator map (scripts/planety/male_ciala.py) ma własne dane
 * fizyczne (mozaiki, kształty z pomiarów sond) — tu żyje to, co decyduje o grze.
 *
 * Bez importów — moduł ładują worker ruchu, skrypty Node i testy.
 *
 * POŁOŻENIE: `orbitAU` to AU MAPY (systemMap.js), przeliczone z prawdziwej półosi liniowo między sąsiednimi
 * planetami gry (umowa planu): Mars (1,524 AU) = 33, Jowisz (5,203 AU) = 50,2 →
 * mapa = 33 + (a − 1,524) · 4,675. Kuiper (umowa planu): pas plutonków 125,5–128,5 z Plutonem na ~127.
 *
 * KĄT: gra losuje kąty planet przy każdym starcie, więc kąt ciała to kąt PREFEROWANY (`angle`), a ostateczny
 * rozstrzyga `resolveSmallBodyAngles` z położeń tego świata: ciało pasa nie leży na torze kampanii (wylot z K-7
 * osią bramy i skok do bazy piratów na 57 AU — tor liczy fabuła, StoryGame._shipyardCenter) ani przy planecie
 * z księżycami (Jowisz: Kallisto 250 tys. j.), Pluton stoi 90–180° od Neptuna (pas plutonków — strumień E
 * przerzedza plutonki ±60° od Neptuna). Ten sam wynik dostaje ruch v2 (gra podaje kąty w `planetAngles`).
 * Funkcje położenia biorą mapę kątów `angles` ({ id: kąt }); bez niej — kąt preferowany.
 *
 * WIELKOŚĆ: skala Luny w grze (promień 9 072 j. przy 1 737,4 km, planet3d.assets.js: 0,24 × Ziemi 37 800)
 * ściśnięta pierwiastkiem: r = 9 072 · √(R / 1 737,4). Liniowo Psyche (113 km) miałaby 590 j. — mniej niż
 * okręt kapitałowy i o rząd mniej niż olbrzymie skały pasa (asteroidGiants.js: 18–62 tys. j.); pierwiastek
 * zostawia kolejność wielkości (Ceres > Westa ≈ Pallas > Hygiea > Psyche, Pluton > Charon > Ceres) i czytelność
 * przy zoomie gry (Ceres ~9,4 km średnicy = kadr domyślny 9 × 5 km). Księżyce Jowisza mają własną skalę
 * (ułamek Jowisza z ringiem) — porównanie z nimi nie obowiązuje.
 *
 * KSZTAŁT: `dimsKm` — trzy osie (a ≥ b równikowe, c biegunowa), `axes` — te osie względem promienia średniego
 * (skala siatki, gdy ciało nie ma mapy kształtu). Mapa kształtu (`SMALL_BODY_MAPS[id].shape`, generator) niesie
 * pełny promień bryły (Westa i Ceres z modeli Dawn, Pallas, Hygiea, Psyche z osi i basenów) — siatka kuli
 * przesuwana na CPU przy ładowaniu (planet3d.assets.js: DirectSmallBody), materiał jak księżyce (moonSurface.tsl.js).
 */

/** Kotwica skali: Luna w grze. */
export const SMALL_BODY_SCALE = Object.freeze({ anchorKm: 1737.4, anchorRadius: 9072, exponent: 0.5 });

/** Promień w jednostkach świata z promienia średniego [km] (skala Luny ściśnięta pierwiastkiem). */
export function smallBodyGameRadius(radiusKm) {
  const r = Math.max(1, Number(radiusKm) || 0);
  return Math.round(SMALL_BODY_SCALE.anchorRadius * Math.pow(r / SMALL_BODY_SCALE.anchorKm, SMALL_BODY_SCALE.exponent));
}

/** Prawdziwa półoś [AU] → AU mapy (umowa planu: liniowo Mars 33 ↔ Jowisz 50,2). */
export function realAuToMapAu(a) {
  return 33 + (Number(a) - 1.524) * 4.675;
}

/** Pluton względem Neptuna: kąt preferowany i dozwolony zakres (pas plutonków, rad). */
export const PLUTO_FROM_NEPTUNE = Object.freeze({ offset: 2.4, min: Math.PI / 2, max: Math.PI });

const BODY_DEFS = [
  {
    id: 'ceres', label: 'Ceres', realAU: 2.767, orbitAU: 38.81, angle: 2.6,
    radiusKm: 469.7, dimsKm: [964.4, 964.2, 891.8], spectral: 'C/G', albedo: 0.09,
    rotationHours: 9.07, obliquityDeg: 4,
    role: 'capital', factionId: 'belt_union',
    desc: 'stolica Unii Pasa: miasto przy kraterze Occator (plamy soli), stocznia, huta, elektronika, kopalnie lodu',
    station: { id: 'ceres', name: 'Ceres — Stolica Unii', orbitMul: 1.7, sunOffset: 0.55, r: 235, berths: 6 }
  },
  {
    id: 'vesta', label: 'Westa', realAU: 2.362, orbitAU: 36.92, angle: 5.1,
    radiusKm: 262.7, dimsKm: [572.6, 557.2, 446.4], spectral: 'V', albedo: 0.42,
    rotationHours: 5.34, obliquityDeg: 29,
    role: 'foundry', factionId: 'belt_union',
    desc: 'huta Unii Pasa: odkrywki żelaza i tytanu, piece przy rowach Divalia Fossae, basen Rheasilvia na południu',
    station: { id: 'vesta', name: 'Westa — Huta Unii', orbitMul: 1.6, sunOffset: -0.7, r: 220, berths: 4 }
  },
  {
    id: 'pallas', label: 'Pallas', realAU: 2.772, orbitAU: 38.84, angle: 0.55,
    radiusKm: 256, dimsKm: [569, 525, 500], spectral: 'B', albedo: 0.15,
    rotationHours: 7.81, obliquityDeg: 84,
    role: 'outpost', factionId: 'belt_union',
    desc: 'gęsto skraterowana, szaroniebieskawa; rozproszone placówki górnicze Unii'
  },
  {
    id: 'hygiea', label: 'Hygiea', realAU: 3.139, orbitAU: 40.55, angle: 4.05,
    radiusKm: 216.5, dimsKm: [450, 430, 424], spectral: 'C', albedo: 0.07,
    rotationHours: 13.83, obliquityDeg: 20,
    role: 'outpost', factionId: 'belt_union',
    desc: 'prawie kulista, ciemna i gładka; dwa duże kratery; posterunki lodowe Unii'
  },
  {
    id: 'psyche', label: 'Psyche', realAU: 2.924, orbitAU: 39.55, angle: 1.45,
    radiusKm: 111, dimsKm: [278, 238, 171], spectral: 'M', albedo: 0.15,
    rotationHours: 4.2, obliquityDeg: 12,
    role: 'mine', factionId: 'belt_union',
    desc: 'metaliczna (żelazo-nikiel), nieregularna, dwa duże zagłębienia; odkrywki metalu Unii'
  },
  {
    id: 'pluto', label: 'Pluton', realAU: 39.48, orbitAU: 127.0, angle: 3.9, fromNeptune: true,
    radiusKm: 1188.3, dimsKm: [2376.6, 2376.6, 2376.6], spectral: 'TNO', albedo: 0.52,
    rotationHours: 153.3, obliquityDeg: 60,
    role: 'empty', factionId: null,
    desc: 'pas plutonków (3:2 z Neptunem): „serce” Sputnik Planitia, ciemna Cthulhu; niczyj'
  },
  {
    id: 'charon', label: 'Charon', parentId: 'pluto', separation: 26000, parentAngle: 0.6,
    radiusKm: 606, dimsKm: [1212, 1212, 1212], spectral: 'TNO', albedo: 0.38,
    rotationHours: 153.3, obliquityDeg: 60,
    role: 'empty', factionId: null,
    desc: 'księżyc Plutona (układ podwójny): szary lód, czerwona czapa Mordor Macula'
  }
];

export const SMALL_BODIES = Object.freeze(BODY_DEFS.map((def) => {
  const radius = smallBodyGameRadius(def.radiusKm);
  const [a, b, c] = def.dimsKm;
  const gm = Math.cbrt(a * b * c);
  return Object.freeze({
    ...def,
    radius,
    // osie względem promienia średniego (x = a, y = c biegunowa, z = b — osie siatki three: Y = biegun)
    axes: Object.freeze([a / gm, c / gm, b / gm]),
    dimsKm: Object.freeze([...def.dimsKm]),
    station: def.station ? Object.freeze({ ...def.station }) : null
  });
}));

export const SMALL_BODY_BY_ID = Object.freeze(Object.fromEntries(SMALL_BODIES.map((b) => [b.id, b])));

/** Ciała z własną stacją (port Unii Pasa: rynek, dok, frakcja). */
export const SMALL_BODY_STATIONS = Object.freeze(SMALL_BODIES.filter((b) => b.station));

/** Kąt ciała wokół Słońca w tym świecie (mapa `angles` z resolveSmallBodyAngles) albo preferowany. */
export function smallBodyAngle(body, angles = null) {
  const a = Number(angles?.[body?.id]);
  return Number.isFinite(a) ? a : Number(body?.angle) || 0;
}

/**
 * Położenie ciała w świecie: `origin` = Słońce (x, y), `au` = jednostki świata na AU mapy. Księżyc ciała
 * (Charon) — od rodzica o `separation` pod kątem `parentAngle`.
 */
export function smallBodyPosition(body, origin, au, out = { x: 0, y: 0 }, angles = null) {
  const ox = Number(origin?.x) || 0;
  const oy = Number(origin?.y) || 0;
  if (body?.parentId) {
    const parent = SMALL_BODY_BY_ID[body.parentId];
    smallBodyPosition(parent, origin, au, out, angles);
    out.x += Math.cos(body.parentAngle) * body.separation;
    out.y += Math.sin(body.parentAngle) * body.separation;
    return out;
  }
  const r = Number(body?.orbitAU) * (Number(au) || 0);
  const a = smallBodyAngle(body, angles);
  out.x = ox + Math.cos(a) * r;
  out.y = oy + Math.sin(a) * r;
  return out;
}

/** Promień orbity stacji wokół ciała [j.]. */
export function smallBodyStationOrbit(body) {
  return body?.station ? body.radius * body.station.orbitMul : 0;
}

/**
 * Kąt stacji wokół ciała (świat gry): od strony Słońca, przesunięty o `sunOffset` — stacja wisi obok tarczy
 * po stronie dziennej, poza smugą cienia ciała.
 */
export function smallBodyStationAngle(body, angles = null) {
  if (!body?.station) return 0;
  // kierunek ciało → Słońce = kąt ciała + π (Słońce w środku orbity)
  return smallBodyAngle(body, angles) + Math.PI + body.station.sunOffset;
}

/** Położenie stacji ciała w świecie. */
export function smallBodyStationPosition(body, origin, au, out = { x: 0, y: 0 }, angles = null) {
  smallBodyPosition(body, origin, au, out, angles);
  if (!body?.station) return out;
  const r = smallBodyStationOrbit(body);
  const a = smallBodyStationAngle(body, angles);
  out.x += Math.cos(a) * r;
  out.y += Math.sin(a) * r;
  return out;
}

/**
 * Strefy ciała jak `planetOrbitRadii` planet (index.html): inner — tuż nad powierzchnią, outer — pas stacji,
 * gravityWell — studnia (warp × 0,3, objazdy TRAVEL TO). Studnia Plutona obejmuje Charona.
 */
export function smallBodyZones(body) {
  const r = Number(body?.radius) || 0;
  const inner = r * 1.3;
  let outer = Math.max(inner + 2500, smallBodyStationOrbit(body) + 2500);
  for (const other of SMALL_BODIES) {
    if (other.parentId === body?.id) outer = Math.max(outer, other.separation + other.radius + 2500);
  }
  return { inner, outer, gravityWell: outer + 6000 };
}

function segDist(px, py, s) {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-9 ? ((px - s.ax) * dx + (py - s.ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(s.ax + dx * t - px, s.ay + dy * t - py);
}

/** Domyślny odstęp ciała pasa od toru kampanii poza jego studnią [j.] (~2,8 AU mapy). */
export const SMALL_BODY_PATH_CLEAR = 120000;

/**
 * Kąty ciał w tym świecie: { id: kąt }. Czysta funkcja położeń (gra i ruch v2 dostają to samo).
 *
 *   origin, au          Słońce i skala
 *   planetAngles        kąty planet tego świata (Pluton: od `neptune`)
 *   avoidSegments       [{ ax, ay, bx, by, clear? }] tory, których studnia ciała nie może dotknąć (+ clear)
 *   keepOut             [{ x, y, r }] koła (planety ze studniami i księżycami), których studnia nie dotyka
 *   step, maxSteps      szukanie: kąt preferowany ± k · step na przemian
 *
 * Ciało, które nie znajdzie miejsca, zostaje na kącie preferowanym (i `report.failed`).
 */
export function resolveSmallBodyAngles(opts = {}) {
  const origin = opts.origin || { x: 0, y: 0 };
  const au = Number(opts.au) || 0;
  const segs = Array.isArray(opts.avoidSegments) ? opts.avoidSegments : [];
  const keep = Array.isArray(opts.keepOut) ? opts.keepOut : [];
  const step = Number(opts.step) || 0.04;
  const maxSteps = Number(opts.maxSteps) || 80;
  const nep = Number(opts.planetAngles?.neptune);
  const out = {};
  const placed = [];
  const failed = [];
  const p = { x: 0, y: 0 };
  for (const body of SMALL_BODIES) {
    if (body.parentId) continue;
    const well = smallBodyZones(body).gravityWell;
    let preferred = body.angle;
    let span = maxSteps;
    if (body.fromNeptune && Number.isFinite(nep)) {
      preferred = nep + PLUTO_FROM_NEPTUNE.offset;
      // nie wychodzimy z pasma 90–180° od Neptuna
      span = Math.min(maxSteps, Math.floor(Math.min(PLUTO_FROM_NEPTUNE.offset - PLUTO_FROM_NEPTUNE.min,
        PLUTO_FROM_NEPTUNE.max - PLUTO_FROM_NEPTUNE.offset) / step) * 2);
    }
    let chosen = null;
    for (let k = 0; k <= span; k++) {
      const sgn = k % 2 ? 1 : -1;
      const a = preferred + sgn * Math.ceil(k / 2) * step;
      p.x = origin.x + Math.cos(a) * body.orbitAU * au;
      p.y = origin.y + Math.sin(a) * body.orbitAU * au;
      let ok = true;
      for (const s of segs) {
        if (segDist(p.x, p.y, s) < well + (Number(s.clear) || SMALL_BODY_PATH_CLEAR)) { ok = false; break; }
      }
      if (ok) {
        for (const c of keep) {
          if (Math.hypot(p.x - c.x, p.y - c.y) < well + (Number(c.r) || 0)) { ok = false; break; }
        }
      }
      if (ok) {
        for (const q of placed) {
          if (Math.hypot(p.x - q.x, p.y - q.y) < well + q.well + 20000) { ok = false; break; }
        }
      }
      if (ok) { chosen = a; break; }
    }
    if (chosen == null) { chosen = preferred; failed.push(body.id); }
    // kąt w (−π, π]
    chosen = Math.atan2(Math.sin(chosen), Math.cos(chosen));
    out[body.id] = chosen;
    placed.push({ x: origin.x + Math.cos(chosen) * body.orbitAU * au, y: origin.y + Math.sin(chosen) * body.orbitAU * au, well });
  }
  if (opts.report) opts.report.failed = failed;
  return out;
}

/**
 * Obszary bez skał gry (AsteroidBeltField.setExclusions: elipsy { x, y, rx, ry }): ciało (+ zapas) i stacja.
 * Skała pod płaszczyzną w miejscu ciała przebijałaby tarczę (pass ortho rysuje się nad ciałem).
 */
export function smallBodyExclusions(origin, au, pad = 900, angles = null) {
  const out = [];
  const p = { x: 0, y: 0 };
  for (const body of SMALL_BODIES) {
    smallBodyPosition(body, origin, au, p, angles);
    const ax = body.axes || [1, 1, 1];
    const rr = body.radius * Math.max(ax[0], ax[2]) + pad;
    out.push({ x: p.x, y: p.y, rx: rr, ry: rr, id: body.id });
    if (body.station) {
      smallBodyStationPosition(body, origin, au, p, angles);
      const rs = body.station.r * 3 + pad;
      out.push({ x: p.x, y: p.y, rx: rs, ry: rs, id: `${body.id}:station` });
    }
  }
  return out;
}
