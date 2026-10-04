// ============================================================
// Ukryta stocznia piratów (misja 1) — układ miejsca. Czysta geometria (świat gry, y w dół).
//
// Oś stoczni `axis` (kąt): wzdłuż niej leży RZĄD zaparkowanych okrętów „ciurkiem”, burta w burtę, dziobami do
// budynku — Atlas wchodzi w rząd wzdłuż osi i miażdży kadłuby po kolei. Budynek (stacja piracka) stoi obok rzędu,
// wieżyczki na okręgu wokół zakładu, eskorta przy budynku. Punkt zbiórki (wyjście z warpa) leży na przedłużeniu
// osi rzędu, poza zasięgiem czujników piratów, tak że prosty lot z niego prowadzi w początek rzędu.
// ============================================================

export const SHIPYARD_TUNE = Object.freeze({
  // Skład rzędu (od strony gracza): klucze wezwań SUPPORT_SHIP_TEMPLATES / kadłuby pirackie.
  parked: Object.freeze(['frigate_pd', 'frigate_laser', 'destroyer', 'frigate_pd', 'destroyer', 'battleship', 'destroyer', 'frigate_laser', 'destroyer', 'battleship']),
  parkedGap: 150,          // j. między burtami
  // Odległości liczone od obrysu BUDYNKU (buildingRadius — bryła stacji pirackiej w grze ma ~3,7 tys. j. promienia):
  buildingRadius: 1000,
  rowGap: 1600,            // rząd za obrysem budynku (bok)
  turrets: 6,
  turretGap: 2800,
  defenders: Object.freeze(['frigate_pd', 'frigate_laser', 'frigate_pd', 'destroyer', 'frigate_laser']),
  defenderGap: 900,
  // Punkt zbiórki od początku rzędu. Atlas leci bojowo 500 j/s (tabela lotu, 2026-10-01), więc 24 km
  // oznaczało 48 s lotu po prostej; wykrycie niezamaskowanego okrętu jest z 9 km (storyGame._detected),
  // a wieże Atlasa na czas podejścia trzyma misja (api.fire.hold) — 15 km wystarcza.
  rallyDistance: 15000,
  counterDistance: 18000,  // front odwetu piratów od gracza (czas na salwy baterii głównej w nadlatujących)
  supportDistance: 5000    // wsparcie z Ziemi za graczem
});

/** Szerokość kadłuba (j. świata) z klucza — rozmiary HULL_RENDER_PROFILES × 0,6 (bez importu danych gry). */
export function parkedBeamOf(key) {
  const k = String(key || '');
  if (k.includes('battleship')) return 2 * 220 * 0.6;
  if (k.includes('destroyer')) return 2 * 170 * 0.6;
  return 2 * 120 * 0.6;
}
export function parkedLengthOf(key) {
  const k = String(key || '');
  if (k.includes('battleship')) return 1200 * 0.6;
  if (k.includes('destroyer')) return 600 * 0.6;
  return 320 * 0.6;
}

/**
 * Układ stoczni. center — środek zakładu (budynek), axis — kąt osi rzędu (świat gry), approachFrom — punkt, od którego
 * gracz nadlatuje (np. Ziemia): rząd i punkt zbiórki ustawiają się od jego strony.
 * Zwraca { center, axis, building, parked: [{ key, x, y, angle }], turrets: [{ x, y }], defenders: [...],
 *          rowStart, rowEnd, rally: { x, y, angle } }.
 */
export function planShipyard(center, approachFrom, tune = SHIPYARD_TUNE) {
  const T = { ...SHIPYARD_TUNE, ...tune };
  const rowOffset = T.buildingRadius + T.rowGap;
  const turretRadius = T.buildingRadius + T.turretGap;
  const defenderRadius = T.buildingRadius + T.defenderGap;
  // Oś rzędu: od gracza ku stoczni.
  const axis = Math.atan2(center.y - approachFrom.y, center.x - approachFrom.x);
  const ux = Math.cos(axis), uy = Math.sin(axis);
  const nx = -uy, ny = ux;                                   // bok (rząd po tej stronie budynku)
  // Długość rzędu.
  const beams = T.parked.map(parkedBeamOf);
  const rowLen = beams.reduce((s, b) => s + b, 0) + T.parkedGap * (beams.length - 1);
  const rowCx = center.x + nx * rowOffset;
  const rowCy = center.y + ny * rowOffset;
  const start = { x: rowCx - ux * rowLen * 0.5, y: rowCy - uy * rowLen * 0.5 };
  const end = { x: rowCx + ux * rowLen * 0.5, y: rowCy + uy * rowLen * 0.5 };
  const parked = [];
  let s = 0;
  for (let i = 0; i < T.parked.length; i++) {
    const b = beams[i];
    const c = s + b * 0.5;
    const len = parkedLengthOf(T.parked[i]);
    // środek kadłuba odsunięty tak, by dzioby leżały na linii rzędu, kadłuby od strony budynku
    parked.push({
      key: T.parked[i],
      x: start.x + ux * c - nx * len * 0.5,
      y: start.y + uy * c - ny * len * 0.5,
      angle: Math.atan2(-ny, -nx)                            // dziobem do budynku
    });
    s += b + T.parkedGap;
  }
  const turrets = [];
  for (let i = 0; i < T.turrets; i++) {
    const a = axis + Math.PI / T.turrets + (i * Math.PI * 2) / T.turrets;
    turrets.push({ x: center.x + Math.cos(a) * turretRadius, y: center.y + Math.sin(a) * turretRadius, angle: a });
  }
  const defenders = T.defenders.map((key, i) => {
    const a = axis + Math.PI + ((i - (T.defenders.length - 1) / 2) * 0.55);
    return { key, x: center.x + Math.cos(a) * defenderRadius, y: center.y + Math.sin(a) * defenderRadius, angle: a + Math.PI / 2 };
  });
  // Punkt zbiórki: na przedłużeniu rzędu, przed jego początkiem, dziobem wzdłuż osi.
  const rally = { x: start.x - ux * T.rallyDistance, y: start.y - uy * T.rallyDistance, angle: axis };
  return { center: { x: center.x, y: center.y }, axis, building: { x: center.x, y: center.y }, parked, turrets, defenders, rowStart: start, rowEnd: end, rowLength: rowLen, rally };
}

/**
 * Szyk floty przylatującej tunelem: `counts` { battleship, destroyer, frigate }, front prostopadły do `facing`
 * (kurs floty), środek frontu w `center`. Okręty flagowe w pierwszym rzędzie, niszczyciele za nimi, fregaty
 * po skrzydłach i z tyłu. Zwraca [{ key, x, y, angle }] (kolejność: od najmniejszych — ostatni przylatuje flagowiec).
 */
export function planFleetWave(center, facing, counts, opts = {}) {
  const ux = Math.cos(facing), uy = Math.sin(facing);
  const nx = -uy, ny = ux;
  const out = [];
  const row = (keys, depth, spacing) => {
    const n = keys.length;
    for (let i = 0; i < n; i++) {
      const lat = (i - (n - 1) / 2) * spacing;
      out.push({ key: keys[i], x: center.x - ux * depth + nx * lat, y: center.y - uy * depth + ny * lat, angle: facing });
    }
  };
  const bs = Array(Math.max(0, counts.battleship | 0)).fill(opts.battleshipKey || 'battleship');
  const dd = Array(Math.max(0, counts.destroyer | 0)).fill(opts.destroyerKey || 'destroyer');
  const ffKeys = opts.frigateKeys || ['frigate_pd', 'frigate_laser'];
  const ff = Array.from({ length: Math.max(0, counts.frigate | 0) }, (_, i) => ffKeys[i % ffKeys.length]);
  // Kolejność przylotu: fregaty, niszczyciele, pancerniki (flagowce na końcu — jak planFleetArrival).
  row(ff, 2600, 700);
  row(dd, 1400, 1100);
  row(bs, 0, 1700);
  return out;
}
