/**
 * UPADEK HABITATU bazy piratów na planetoidę Hidalgo (misja 1). Prośba użytkownika 2026-10-19: „jak gracz zniszczy
 * resztę i HP spadnie do 0, góra przebije się przez dół i jako pierwsza spadnie na planetę, za nią poleci dół,
 * de facto pociągnięty przez wieżę (dobra fizyka — realny efekt); w końcu wszystkie elementy spadają na planetoidę”.
 * Dawniej wieża leżała na dysku do końca, a po śmierci habitatu wszystko wybuchało i dryfowało.
 *
 *  - TEREN: skała (src/3d/portBuildings/pirateRockLayout.js — kula R z MAPĄ KSZTAŁTU, tą samą, z której render przesuwa
 *    siatkę skały: wierzchołki co 1,4°, między nimi dwuliniowo) jako teren statyczny silnika belek
 *    (DestructorBeams3D.addTerrain): bryły (wieża, sektory dysku, ich odłamy) zderzają się z powierzchnią w prawie v2 —
 *    granica plastyczności frontu, zgniot nadmiaru w bryle (Teardown), tarcie, osiadanie. Teren jest od podpięcia bazy,
 *    więc i odłamy sprzed śmierci habitatu (szyja, dysk) lądują na skale zamiast znikać pod dnem.
 *  - GRAWITACJA SKAŁY: ku środkowi (gravityWell silnika). Do śmierci habitatu bryły przy habitacie mają umowną grawitację
 *    habitatu (−z — przechył wieży, pirateBaseNeck.js); odłam, który zszedł poniżej `wellBelowZ`, i wszystko po śmierci
 *    habitatu spada ku środkowi skały (z habitatu ~13° od pionu — po linii ku środkowi, nie „w dół sceny”).
 *  - SEKWENCJA przy HP 0 habitatu (startHabitatFall): WIEŻA puszcza pierwsza (stojąca — oderwana od szyi, leżąca —
 *    odmrożona) i dostaje prędkość zapadnięcia `towerKick` (podłoga pod nią pęka) — przebija środek dysku albo sektory
 *    pod sobą (zgniot w silniku); SEKTORY DYSKU puszczają po kolei od najbliższego wieży (`discFirst`, `discStep`), każdy
 *    z prędkością ku dziurze po wieży i obrotem, który opuszcza jego wewnętrzną krawędź (dysk składa się za wieżą —
 *    „pociągnięty”); wszystko spada na skałę.
 *  - SPOCZYNEK: bryła w styku ze skałą, wolniej niż `restSpeed` przez `restTime` → ZAMROŻENIE (freezeBody — koszt kroku 0,
 *    kształt po zgniocie zostaje).
 *  - ZDARZENIA (hooks): onImpact / onScrape / onSettle (styk ze skałą — efekt uderzenia: src/game/story/pirateRockImpacts.js),
 *    onBreach (wieża przebija sektor dysku, oderwanie modułu — rozszczelnienie: src/game/story/pirateBaseAtmosphere.js),
 *    onFallStart. Współrzędne zdarzeń w GRZE (x, y — y w dół; z — wysokość świata), normalna w układzie gry.
 * Bez three i DOM (testy i symulacja w Node: scripts/destrukcja-taran-sym.mjs --tryb upadek).
 */

export const PIRATE_FALL_TUNE = {
  // grawitacja skały [j/s²] ku środkowi (stała; r0 > 0 — malejąca z kwadratem odległości od środka, g przy r0)
  gravity: 260,
  gravityR0: 0,
  // odłam spod habitatu (z poniżej) dostaje grawitację skały jeszcze za życia habitatu
  wellBelowZ: -1600,
  // skała w prawie kontaktu: tarcie, mnożnik pancerza bryły w granicy plastyczności (skała twardsza od blachy)
  rockFriction: 0.85,
  rockArmorMul: 1.6,
  rockRestAngDamp: 6,    // [1/s] tłumienie kołysania bryły leżącej na skale (szeroki styk — silnik: restAngDamp terenu)
  // sekwencja przy HP 0
  towerKick: 300,          // [j/s] prędkość zapadnięcia wieży ku skale w chwili śmierci habitatu
  towerTumble: 0.06,       // [rad/s] losowy obrót wieży przy puszczeniu (leżącej)
  towerTumbleStanding: 0.012, // [rad/s] — wieży stojącej na szyi (spada prosto przez szyb i środek dysku)
  towerTumblePass: 0.13,   // [rad/s] stojąca wieża po przejściu przez dysk przechyla się (korek, styk z gruzem) —
                           // uderza w skałę pod kątem i przewraca się, zamiast lądować pionowo na szyi
  plugDebris: 0.12,        // korek (część dysku pod wieżą): udział węzłów w odłamki przy rozpadzie
  plugSpeed: 170,
  plugDown: 0.25,
  columnLead: 0.92,        // odłam w rzucie wieży jedzie ku skale najwyżej z tą częścią jej prędkości (0 — wyłączone)
  columnPush: 420,         // [j/s²] i zsuwa się z rzutu wieży na boki
  columnCell: 90,          // [j.] komórka rzutu wieży
  columnAhead: 2500,       // [j.] przed spodem wieży (ku skale) — tak daleko odłamy jeszcze w kolumnie          // korek: składowa ku skale (reszta — w bok od osi wieży)
  holdGravity: 0.3,        // dolna część habitatu (szyb, bęben) przed przejściem wieży przez dysk — ułamek grawitacji          // [j/s] odłamy korka: od osi wieży i ku skale
  plugCellsMax: 5,         // komórek Voronoi na wyspę korka (mniej — mniej ciał w stosie na skale)
  minFragmentNodes: 50,    // odłam mniejszy (korek, bęben, szyb) — cały w odłamki (pula efektów), nie ciało
  // DZIURA: kotwice dysku pod wieżą (rzut wieży z góry + holePad) puszczają od razu — wieża przebija tę część dysku
  // (węzły trzymane belkami resztą sektora rwą się pod nią); reszta sektorów puszcza, gdy wieża przejdzie pod dysk
  holePad: 90,             // [j.] zapas rzutu wieży
  holeCell: 45,            // [j.] komórka siatki rzutu
  holeWeaken: 0.05,         // belki węzłów w dziurze: próg zerwania × tyle (konstrukcja zniszczonego habitatu ustępuje)
  passMargin: 150,         // [j.] wierzch wieży poniżej spodu dysku o tyle = wieża przeszła
  passAfterTouch: 2.5,     // [s] od pierwszego styku wieży z dyskiem — najpóźniej wtedy sektory puszczają
  passTimeout: 9,          // [s] od śmierci habitatu — najpóźniej wtedy sektory puszczają (wieża nie doszła do dysku)
  discFirst: 0.05,         // [s] po przejściu wieży: pierwszy sektor (najbliższy dziurze)
  discStep: 0.3,           // [s] kolejne sektory (wg odległości od dziury)
  discJitter: 0.08,        // [s] rozrzut chwili puszczenia
  discDrag: 140,           // [j/s] prędkość sektora ku dziurze po wieży (w poziomie)
  discDown: 60,            // [j/s] prędkość sektora ku skale przy puszczeniu
  discFold: 0.16,          // [rad/s] obrót opuszczający wewnętrzną krawędź sektora
  // zdarzenia styku ze skałą
  impactMinSpeed: 90,      // [j/s] zbliżanie, od którego styk jest uderzeniem
  impactCooldown: 0.6,     // [s] kolejne mocne uderzenie tego samego ciała
  scrapeMinSlide: 60,      // [j/s] szorowanie
  scrapeEvery: 0.25,       // [s]
  breachMinSpeed: 60,      // [j/s] wieża w sektor dysku po śmierci habitatu — przebicie
  // spoczynek na skale → zamrożenie
  restSpeed: 30,           // [j/s] prędkość środka masy i obwodu (ω · r)
  restTime: 0.6,           // [s]
  restContactWindow: 0.3,  // [s] ostatni styk ze skałą (albo z inną bryłą — stos) najwyżej tyle temu
  restStackTime: 1.2,      // [s] spoczynek bryły leżącej na innej bryle (nie na skale)
  restStackMul: 3,         // próg prędkości bryły na innej bryle × tyle (stos drga od styków)
  restStackPad: 1200,      // [j.] stos zamarza tylko tak blisko skały (bryła na bryle na skale)
  restEmaRate: 4,          // [1/s] wygładzanie prędkości spoczynku
  restSmallNodes: 30,      // drobnica (mniej węzłów) — bez progu obrotu
  restSmallTime: 2,        // [s] drobnica w styku tyle — zamarza (o ile nie leci szybciej niż 8 × restSpeed)
  restTinyNodes: 12,       // drobina (mniej węzłów) na skale — zamarza od razu
  restAssistTime: 3,       // [s] w styku tyle — zamarza przy prędkości chwilowej poniżej 2 × progu
  settleTimeout: 25,       // [s od śmierci habitatu] reszta wolnych brył przy skale zamarza, koniec sekwencji
  freezePinCells: 3,
  // odłam bryły spadający w otchłań (poza skałą) znika poniżej (pętla wraków gry — HULL_BODY_CONFIG.solidFloorZ)
  floorZ: -45000
};

// Mapa kształtu skały (scripts/planety/male_ciala.py: hidalgo; ścieżka i zakres jak SMALL_BODY_MAPS.hidalgo
// w src/3d/planetMaps.js — test tests/pirateBaseFall.test.mjs pilnuje zgodności) i siatka renderu skały
// (SMALL_BODY_SEGMENTS w src/3d/smallBodyShape.js).
export const PIRATE_ROCK_SHAPE = Object.freeze({
  url: 'assets/planety/solar/small/hidalgo_hf_shape.png',
  range: Object.freeze([-0.05, 0.05]),
  segW: 256,
  segH: 128
});

/** Bajty RGBA mapy kształtu → { w, h, d: Float32Array, poleN, poleS } (jak decodeSmallBodyShape renderu). */
export function decodeRockShape(rgba, w, h, range = PIRATE_ROCK_SHAPE.range) {
  const d = new Float32Array(w * h);
  const lo = range[0];
  const k = (range[1] - range[0]) / 65535;
  for (let i = 0; i < w * h; i++) d[i] = lo + (rgba[i * 4] * 256 + rgba[i * 4 + 1]) * k;
  let sn = 0;
  let ss = 0;
  for (let i = 0; i < w; i++) { sn += d[i]; ss += d[(h - 1) * w + i]; }
  return { w, h, d, poleN: sn / w, poleS: ss / w };
}

// Promień względny mapy w (u, v) dwuliniowo (jak sampleSmallBodyShape renderu).
function sampleShape(s, u, v) {
  const fx = (((u % 1) + 1) % 1) * s.w - 0.5;
  const fy = Math.min(s.h - 1, Math.max(0, (1 - v) * s.h - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % s.w) + s.w) % s.w;
  const xb = (xa + 1) % s.w;
  const yb = Math.min(s.h - 1, y0 + 1);
  const a = s.d[y0 * s.w + xa] * (1 - tx) + s.d[y0 * s.w + xb] * tx;
  const b = s.d[yb * s.w + xa] * (1 - tx) + s.d[yb * s.w + xb] * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Mapa kształtu z pliku (przeglądarka: fetch + createImageBitmap + OffscreenCanvas). Promise → kształt albo null
 * (brak API / błąd — teren zostaje kulą).
 */
export async function loadPirateRockShape(url = PIRATE_ROCK_SHAPE.url, range = PIRATE_ROCK_SHAPE.range) {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close?.();
    return decodeRockShape(img.data, img.width, img.height, range);
  } catch (err) {
    console.warn('[upadek habitatu] mapa kształtu skały:', err?.message || err);
    return null;
  }
}

// Kwaternion [x, y, z, w] → macierz 3×3 (wiersze), lokalne → nadrzędne.
function quatMat(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)
  ];
}

/**
 * Teren skały dla silnika belek (świat silnika: X = x gry, Y = −y gry, Z = wysokość). rockLayout — createPirateRockLayout(),
 * place — placePirateBase (u, n, toGame), shape — decodeRockShape (null = kula R). Promień w kierunku = R · (1 + d), d —
 * mapa kształtu w WIERZCHOŁKACH siatki renderu skały (SphereGeometry segW × segH; bieguny — średnia wiersza), między
 * nimi dwuliniowo: powierzchnia zderzeń leży tam, gdzie rysuje się skała. Normalna z różnic promienia.
 */
export function createPirateRockTerrain(rockLayout, place, shape = null, tune = PIRATE_FALL_TUNE) {
  const R = rockLayout.R;
  const c = rockLayout.center;
  const g = place.toGame(c[0], c[2], {});
  const ux = place.u.x, uy = place.u.y, nx = place.n.x, ny = place.n.y;
  // silnik → układ bazy (x, h, z): bx = EX·ux − EY·uy, bh = EZ, bz = EX·nx − EY·ny; baza → lokalne kuli: Rᵀ (meshQuat)
  const Q = quatMat(rockLayout.meshQuat);
  const B = [ux, -uy, 0, 0, 0, 1, nx, -ny, 0];   // wiersze: bx, bh, bz
  // M = Qᵀ · B
  const M = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
    M[r * 3 + k] = Q[0 * 3 + r] * B[0 * 3 + k] + Q[1 * 3 + r] * B[1 * 3 + k] + Q[2 * 3 + r] * B[2 * 3 + k];
  }
  const W = PIRATE_ROCK_SHAPE.segW, H = PIRATE_ROCK_SHAPE.segH;
  let grid = null;
  let dMax = 0;
  if (shape && shape.d) {
    grid = new Float32Array((W + 1) * (H + 1));
    for (let iy = 0; iy <= H; iy++) {
      for (let ix = 0; ix <= W; ix++) {
        const d = iy === 0 ? shape.poleN : iy === H ? shape.poleS : sampleShape(shape, ix / W, 1 - iy / H);
        grid[iy * (W + 1) + ix] = d;
        if (d > dMax) dMax = d;
      }
    }
  }
  const TWO_PI = Math.PI * 2;
  const relAt = (ex, ey, ez) => {
    if (!grid) return 0;
    const lx = M[0] * ex + M[1] * ey + M[2] * ez;
    const ly = M[3] * ex + M[4] * ey + M[5] * ez;
    const lz = M[6] * ex + M[7] * ey + M[8] * ez;
    let phi = Math.atan2(lz, -lx);
    if (phi < 0) phi += TWO_PI;
    const theta = Math.acos(ly > 1 ? 1 : ly < -1 ? -1 : ly);
    const fx = phi / TWO_PI * W, fy = theta / Math.PI * H;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    if (x0 >= W) x0 = W - 1;
    if (y0 >= H) y0 = H - 1;
    const r0 = y0 * (W + 1), r1 = r0 + W + 1;
    const a = grid[r0 + x0] * (1 - tx) + grid[r0 + x0 + 1] * tx;
    const b = grid[r1 + x0] * (1 - tx) + grid[r1 + x0 + 1] * tx;
    return a * (1 - ty) + b * ty;
  };
  const EPS = 0.004;   // [rad] różnice promienia (~64 j. na skale R 16 km)
  const terrain = {
    name: 'planetoida Hidalgo',
    cx: g.x, cy: -g.y, cz: c[1],
    R,
    rMax: R * (1 + Math.max(0, dMax)) + 1,
    friction: tune.rockFriction,
    armorMul: tune.rockArmorMul,
    restAngDamp: tune.rockRestAngDamp,
    onContact: null,
    radius(ex, ey, ez) { return R * (1 + relAt(ex, ey, ez)); },
    // n ∝ ω − (∂r/∂θ₁ / r) t₁ − (∂r/∂θ₂ / r) t₂ (styczne t₁, t₂ ⊥ ω; powierzchnia r(ω) · ω)
    normal(ex, ey, ez, r, out) {
      if (!grid) { out.x = ex; out.y = ey; out.z = ez; return out; }
      // styczna t₁ ⊥ ω (oś najmniej równoległa), t₂ = ω × t₁
      let ax = 0, ay = 0, az = 1;
      if (Math.abs(ez) > 0.9) { ax = 1; az = 0; }
      let t1x = ay * ez - az * ey, t1y = az * ex - ax * ez, t1z = ax * ey - ay * ex;
      const l1 = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1;
      t1x /= l1; t1y /= l1; t1z /= l1;
      const t2x = ey * t1z - ez * t1y, t2y = ez * t1x - ex * t1z, t2z = ex * t1y - ey * t1x;
      const rr = (dx, dy, dz) => {
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        return R * (1 + relAt(dx / l, dy / l, dz / l));
      };
      const g1 = (rr(ex + t1x * EPS, ey + t1y * EPS, ez + t1z * EPS) - rr(ex - t1x * EPS, ey - t1y * EPS, ez - t1z * EPS)) / (2 * EPS);
      const g2 = (rr(ex + t2x * EPS, ey + t2y * EPS, ez + t2z * EPS) - rr(ex - t2x * EPS, ey - t2y * EPS, ez - t2z * EPS)) / (2 * EPS);
      const k = 1 / Math.max(1, r);
      let ox = ex - g1 * k * t1x - g2 * k * t2x;
      let oy = ey - g1 * k * t1y - g2 * k * t2y;
      let oz = ez - g1 * k * t1z - g2 * k * t2z;
      const l = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      out.x = ox / l; out.y = oy / l; out.z = oz / l;
      return out;
    },
    /** Wysokość powierzchni (z świata) pod punktem gry (x, y) — z góry; −Infinity poza obrysem. */
    surfaceZAt(x, y) {
      const dx = x - terrain.cx, dy = -y - terrain.cy;
      const hd2 = dx * dx + dy * dy;
      if (hd2 > terrain.rMax * terrain.rMax) return -Infinity;
      let z = terrain.cz + Math.sqrt(Math.max(0, R * R - hd2));
      for (let it = 0; it < 3; it++) {
        const ez = z - terrain.cz, l = Math.sqrt(hd2 + ez * ez) || 1;
        const r = terrain.radius(dx / l, dy / l, ez / l);
        if (r * r <= hd2) return -Infinity;
        z = terrain.cz + Math.sqrt(r * r - hd2);
      }
      return z;
    }
  };
  return terrain;
}

// ------------------------------------------------------------------ SEKWENCJA UPADKU

/** Stan upadku (jeden na habitat). */
export function createFallState() {
  return {
    phase: 'idle',            // 'idle' | 'falling' | 'settled'
    t: 0,                     // [s] od śmierci habitatu
    startAt: -1,              // czas symulacji silnika
    well: null,               // gravityWell silnika (wspólny obiekt)
    terrain: null,
    tower: null,              // encja wieży (wrak 3D) po puszczeniu
    holeX: 0, holeY: 0, holeZ: 0,   // świat silnika: dziura po wieży w dysku (środek dysku, gdy wieża stała)
    queue: [],                // [{ id, t }] sektory dysku do puszczenia
    released: 0,
    breached: new Set(),      // id modułów, w które wieża już weszła
    touchT: -1,               // [s od startu] pierwszy styk wieży z dyskiem
    passed: false, passT: -1, // wieża przeszła pod dysk (reszta sektorów puszcza od passT)
    discMinZ: 0, holeNodes: 0,
    towerImpactT: -1,         // [s od startu] pierwsze uderzenie wieży w skałę
    discImpactT: -1,
    frozen: 0,
    impacts: 0, scrapes: 0
  };
}

const pieceOf = (site, id) => site?.pieces?.find((p) => p.id === id) || null;
const bodyOf = (e) => (e?.beamHull?.entity === e ? e.beamHull.body : null);

/** Rodzaj spadającej bryły dla zdarzeń: 'tower' | 'disc' | 'drum' | 'core' | 'debris'. */
export function fallKindOf(body) {
  const p = body?.hull?.world || null;
  const k = p?.kind;
  if (k === 'tech') return body.hull.isFragment && body.activeNodes < 0.25 * (p.nodeCount?.() || body.activeNodes) ? 'debris' : 'tower';
  if (k === 'disc') return body.activeNodes < 400 ? 'debris' : 'disc';
  if (k === 'drum' || k === 'core') return body.activeNodes < 300 ? 'debris' : k;
  return 'debris';
}

/**
 * Teren skały i zegar zdarzeń styku — raz przy podpięciu bazy (ctx: { engine, terrain, hooks, simTime() }). Zwraca
 * terrain (ten sam obiekt) z podpiętym onContact.
 */
export function attachPirateRockTerrain(st, ctx) {
  const T = ctx.terrain;
  if (!T || !ctx.engine) return null;
  st.terrain = T;
  const tune = ctx.tune || PIRATE_FALL_TUNE;
  const recs = st.recs || (st.recs = new Map());
  const ev = st._ev || (st._ev = { id: 0, kind: 'debris', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, speed: 0, slide: 0, mass: 0, size: 0, energy: 0, body: null });
  T.onContact = (body, info) => {
    if (!info.doDamage) return;
    const now = ctx.simTime();
    let r = recs.get(body);
    if (!r) { r = { lastContact: -1e9, lastImpact: -1e9, lastScrape: -1e9, restSince: -1, first: true, vEma: -1, touchSince: -1 }; recs.set(body, r); }
    r.lastContact = now;
    const hooks = ctx.hooks || null;
    const fill = () => {
      ev.id = body.id; ev.kind = fallKindOf(body);
      ev.x = info.x; ev.y = -info.y; ev.z = info.z;
      ev.nx = info.nx; ev.ny = -info.ny; ev.nz = info.nz;
      ev.speed = info.approach; ev.slide = info.slide; ev.mass = body.mass;
      ev.size = Math.max(body.cellSize, body.radius); ev.energy = 0.5 * body.mass * info.approach * info.approach;
      ev.body = body;
      return ev;
    };
    if (info.approach >= tune.impactMinSpeed && now - r.lastImpact >= tune.impactCooldown) {
      r.lastImpact = now;
      st.impacts++;
      const k = fallKindOf(body);
      if (st.phase === 'falling') {
        if (k === 'tower' && st.towerImpactT < 0) st.towerImpactT = st.t;
        if (k === 'disc' && st.discImpactT < 0) st.discImpactT = st.t;
      }
      hooks?.onImpact?.(fill());
    } else if (info.slide >= tune.scrapeMinSlide && now - r.lastScrape >= tune.scrapeEvery) {
      r.lastScrape = now;
      st.scrapes++;
      hooks?.onScrape?.(fill());
    }
  };
  ctx.engine.addTerrain(T);
  return T;
}

/** Odpina teren (koniec misji, nowa gra). */
export function detachPirateRockTerrain(st, engine) {
  if (st?.terrain && engine) engine.removeTerrain(st.terrain);
  if (st?.terrain) st.terrain.onContact = null;
  if (st) { st.terrain = null; st.recs?.clear(); }
}

function wellFor(st, tune) {
  if (!st.well) st.well = { x: st.terrain.cx, y: st.terrain.cy, z: st.terrain.cz, g: tune.gravity, r0: tune.gravityR0 };
  st.well.g = tune.gravity;
  st.well.r0 = tune.gravityR0;
  // dolna część habitatu (szyb, bęben) przed przejściem wieży przez dysk: ta sama studnia, słabsza — wieża musi
  // przebić dół i spaść pierwsza („dół ciągnięty przez wieżę”); po przejściu odłamy przechodzą na pełną studnię
  if (!st.wellHold) st.wellHold = { x: st.well.x, y: st.well.y, z: st.well.z, g: 0, r0: st.well.r0 };
  st.wellHold.x = st.well.x; st.wellHold.y = st.well.y; st.wellHold.z = st.well.z; st.wellHold.r0 = st.well.r0;
  st.wellHold.g = tune.gravity * (st.passed ? 1 : tune.holdGravity);
  return st.well;
}

/** Studnia dla odłamów dolnej części habitatu (przed przejściem wieży słabsza — wellFor). */
function lowerWell(st) {
  return st.passed || !st.wellHold ? st.well : st.wellHold;
}

// Odmrożenie bryły (wieża zamrożona na dysku): kotwice siatki zamrożenia z powrotem węzłami swobodnymi.
function unfreeze(body, engine) {
  if (!body || body.dead) return;
  const s = body.nodeStore;
  for (let i = 0; i < s.count; i++) if (s.active[i] && s.invMass[i] === 0) s.invMass[i] = 1 / Math.max(1e-6, s.mass[i]);
  body.anchored = false;
  body.invMass = 1 / Math.max(1, body.mass);
  engine.wake(body, engine.config.wakeHoldFrames);
}

/**
 * Śmierć habitatu (HP 0): wieża puszcza i przebija dysk, sektory dysku puszczają po kolei za nią, wszystko spada na
 * skałę. ctx: { engine, worldBodies, site (miejsce ciał habitatu), layout, place, neck (stan szyi albo null), simTime(),
 * hooks, rnd() (0..1 — losowanie efektów), tune }. Zwraca true — upadek ruszył.
 */
export function startHabitatFall(st, ctx) {
  if (!st || st.phase !== 'idle' || !st.terrain) return false;
  const tune = ctx.tune || PIRATE_FALL_TUNE;
  const engine = ctx.engine, wb = ctx.worldBodies, site = ctx.site;
  if (!engine || !wb || !site) return false;
  const rnd = typeof ctx.rnd === 'function' ? ctx.rnd : Math.random;
  const well = wellFor(st, tune);
  st.phase = 'falling';
  st.t = 0;
  st.startAt = ctx.simTime();
  // kierunek ku skale (świat silnika) z habitatu
  const hc = ctx.place?.habitat || { x: 0, y: 0 };
  let dx = well.x - hc.x, dy = well.y + hc.y, dz = well.z;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  st.downX = dx; st.downY = dy; st.downZ = dz;
  // --- WIEŻA
  const neck = ctx.neck || null;
  let tower = neck?.tower || null;
  let tb = bodyOf(tower);
  const head = pieceOf(site, 'H-T');
  let standing = false;
  st.standing = false;
  if ((!tb || tb.dead) && head && !head.lost) {
    standing = true;
    st.standing = true;
    // wieża stoi na szyi: odrywa się (szyb padł) — bez przegubu, prosto w dół przez szyb
    const wrecks = wb.detachPiece(head, {});
    tower = null;
    for (const w of wrecks) if (!tower || (bodyOf(w)?.activeNodes || 0) > (bodyOf(tower)?.activeNodes || 0)) tower = w;
    tb = bodyOf(tower);
    if (tower) tower.__neckTower = true;
    if (neck) { neck.tower = tower; neck.phase = 'landed'; neck.joint = null; }
  }
  if (tb && !tb.dead) {
    if (tb.anchored) unfreeze(tb, engine);
    tb.joints = null;
    tb.gravityWell = well;
    // zapadnięcie: prędkość ku skale + lekki losowy obrót (wieża nie spada idealnie prosto)
    tb.vel.x += dx * tune.towerKick; tb.vel.y += dy * tune.towerKick; tb.vel.z += dz * tune.towerKick;
    const tumble = standing ? tune.towerTumbleStanding : tune.towerTumble;
    tb.angVel.x += (rnd() - 0.5) * 2 * tumble;
    tb.angVel.y += (rnd() - 0.5) * 2 * tumble;
    engine.wake(tb, engine.config.wakeHoldFrames);
    st.tower = tower;
    st.holeX = tb.pos.x; st.holeY = tb.pos.y; st.holeZ = tb.pos.z;
    if (neck) { neck.phase = 'landed'; neck.joint = null; neck.frozen = 0; }
  } else {
    st.holeX = hc.x; st.holeY = -hc.y; st.holeZ = 0;
  }
  // DYSK: ciała sektorów (także poza bańką) i spód dysku
  const discs = site.pieces.filter((p) => p.kind === 'disc' && !p.lost);
  let discMinZ = Infinity;
  for (const p of discs) {
    wb.buildPiece(p);
    for (const e of [p.entity, ...(p.islands || [])]) {
      const b = bodyOf(e);
      if (!b || b.dead) continue;
      const z = bodyExtentZ(b, -1);
      if (z < discMinZ) discMinZ = z;
    }
  }
  st.discMinZ = Number.isFinite(discMinZ) ? discMinZ : -1100;
  // dziura: kotwice dysku w rzucie wieży puszczają od razu — wieża przebija tę część dysku
  st.holeNodes = tb && !tb.dead ? openDiscHole(st, ctx, tb, discs, tune) : 0;
  st.passed = !(tb && !tb.dead);
  st.passT = st.passed ? 0 : -1;
  // reszta sektorów — po przejściu wieży, od najbliższego dziurze
  const order = [];
  for (const p of discs) {
    const b = p.bounds;
    const gx = (b.x0 + b.x1) / 2, gy = (b.y0 + b.y1) / 2;
    const ex = gx - st.holeX, ey = -gy - st.holeY;
    order.push({ id: p.id, d: Math.sqrt(ex * ex + ey * ey) });
  }
  order.sort((a, b) => a.d - b.d);
  st.queue.length = 0;
  order.forEach((o, i) => st.queue.push({ id: o.id, t: tune.discFirst + i * tune.discStep + rnd() * tune.discJitter }));
  st.released = 0;
  ctx.hooks?.onFallStart?.(st);
  return true;
}

// Macierz obrotu kwaternionu ciała (wiersze) do tablicy m.
function rotOf(q, m) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - z * w); m[2] = 2 * (x * z + y * w);
  m[3] = 2 * (x * y + z * w); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - x * w);
  m[6] = 2 * (x * z - y * w); m[7] = 2 * (y * z + x * w); m[8] = 1 - 2 * (x * x + y * y);
  return m;
}
const _m = new Float64Array(9);

// Skrajna wysokość żywych węzłów ciała (świat silnika): sign −1 — najniższa, +1 — najwyższa.
function bodyExtentZ(b, sign) {
  const m = rotOf(b.quat, _m), s = b.nodeStore;
  let best = sign > 0 ? -Infinity : Infinity;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const z = m[6] * s.x[i] + m[7] * s.y[i] + m[8] * s.z[i];
    if (sign > 0 ? z > best : z < best) best = z;
  }
  return b.pos.z + (Number.isFinite(best) ? best : 0);
}

const holeKey = (i, j) => i * 73856093 ^ j * 19349663;

// Rzut wieży z góry na siatkę holeCell (świat silnika XY) — zbiór kluczy komórek; ustawia środek dziury.
function towerFootprint(st, tb, cell) {
  const occ = new Set();
  const m = rotOf(tb.quat, _m), s = tb.nodeStore;
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const x = tb.pos.x + m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i];
    const y = tb.pos.y + m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i];
    occ.add(holeKey(Math.floor(x / cell), Math.floor(y / cell)));
    sx += x; sy += y; n++;
  }
  if (n > 0) { st.holeX = sx / n; st.holeY = sy / n; }
  return occ;
}

// Węzeł świata (x, y) w rzucie (z zapasem `reach` komórek).
function inFootprint(occ, cell, reach, x, y) {
  const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
  for (let di = -reach; di <= reach; di++) for (let dj = -reach; dj <= reach; dj++) if (occ.has(holeKey(ci + di, cj + dj))) return true;
  return false;
}

// Ciała sektorów dysku (encje kawałków i wyspy).
function discBodies(site) {
  const out = [];
  for (const p of site.pieces) {
    if (p.kind !== 'disc' || p.lost) continue;
    for (const e of [p.entity, ...(p.islands || [])]) {
      const b = bodyOf(e);
      if (b && !b.dead) out.push(b);
    }
  }
  return out;
}

/**
 * KOREK: wieża weszła w dysk — część dysku w jej rzucie odpada (belki na granicy rzutu pękają, wyspy bez kotwic stają
 * się wrakami) i rozpada się na odłamy (Voronoi 3D — HullBodies.shatterSolid przez ctx.shatter) lecące od osi wieży i ku
 * skale: wieża przechodzi przez gruz zamiast grzęznąć w zakotwiczonym sektorze (zakotwiczona bryła ma dla styku masę ∞).
 * Zwraca liczbę odłamów korka.
 */
function cutDiscHole(st, ctx, tune) {
  const tb = bodyOf(st.tower);
  if (!tb || tb.dead) return 0;
  const cell = tune.holeCell, reach = Math.ceil(tune.holePad / cell);
  const occ = towerFootprint(st, tb, cell);
  const engine = ctx.engine;
  const wrecks = ctx.wrecks || null;
  const before = wrecks ? wrecks.length : 0;
  const bodies = discBodies(ctx.site);
  let cut = 0;
  for (const b of bodies) {
    const m = rotOf(b.quat, _m), s = b.nodeStore, e = b.beamStore;
    const inside = new Uint8Array(s.count);
    let any = false;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const x = b.pos.x + m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i];
      const y = b.pos.y + m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i];
      if (inFootprint(occ, cell, reach, x, y)) {
        inside[i] = 1; any = true;
        if (s.invMass[i] === 0) s.invMass[i] = 1 / Math.max(1e-6, s.mass[i]);
      }
    }
    if (!any) continue;
    let here = 0;
    for (let bi = 0; bi < e.count; bi++) {
      if (e.broken[bi]) continue;
      const a = e.a[bi], c = e.b[bi];
      if (!s.active[a] || !s.active[c] || inside[a] === inside[c]) continue;
      e.broken[bi] = 1;
      here++;
    }
    if (!here) continue;
    cut += here;
    b.liveBeams = Math.max(0, b.liveBeams - here);
    b.meshDirty = true;
    b.structureDirty = true;
    b._hashTick = -1;
    // rozpad od razu (jak shatterSolid): wyspy korka — wraki 3D na liście wraków gry
    const queued = engine.splitQueue;
    engine.splitQueue = [b];
    engine.processSplits([b]);
    for (const q of queued) if (q !== b && engine.splitQueue.indexOf(q) === -1) engine.splitQueue.push(q);
  }
  st.holeCut = cut;
  if (!wrecks || typeof ctx.shatter !== 'function') return 0;
  // wyspy korka (nowe wraki dysku bez kotwic) → odłamy od osi wieży i ku skale
  let n = 0;
  const hit = { x: st.holeX, y: st.holeY, z: st.discMinZ };
  const tb0 = bodyOf(st.tower);
  // środek rozpadu: oś wieży w połowie grubości dysku (odłamy od osi — w bok, nie przed wieżą)
  const hcx = tb0 && !tb0.dead ? tb0.pos.x : st.holeX, hcy = tb0 && !tb0.dead ? tb0.pos.y : st.holeY;
  const hcz = st.discMinZ + 180;
  for (let i = before; i < wrecks.length; i++) {
    const w = wrecks[i];
    const b = bodyOf(w);
    if (!b || b.dead || b.anchored || b.hull?.world?.kind !== 'disc') continue;
    b.gravityWell = st.well;
    ctx.shatter(w, hcx, -hcy, hcz, {
      cells: Math.max(2, Math.min(tune.plugCellsMax, Math.round(Math.cbrt(b.activeNodes) / 2))),
      debrisFrac: tune.plugDebris, debrisMax: 260, crackDebris: 0.4, minFragmentNodes: tune.minFragmentNodes,
      speed: tune.plugSpeed, radial: 1,
      outX: st.downX * tune.plugDown, outY: -st.downY * tune.plugDown, outZ: st.downZ * tune.plugDown, spread: 0.4, spin: 0.5
    });
    n++;
  }
  // odłamy korka dziedziczą studnię (wraki z rozpadu biorą gravityWell rodzica)
  for (let i = before; i < wrecks.length; i++) { const b = bodyOf(wrecks[i]); if (b && !b.dead && !b.anchored) b.gravityWell = st.well; }
  ctx.hooks?.onBreach?.({ module: null, x: hit.x, y: -hit.y, z: hit.z, nx: 0, ny: 0, nz: 1, size: 900, entity: null, cause: 'plug' });
  return n;
}

// DZIURA w dysku pod wieżą: rzut wieży z góry (siatka holeCell, zapas holePad) — kotwice sektorów w rzucie puszczają
// (węzły zostają przy reszcie sektora belkami: wieża rwie je, przebijając dysk). Zwraca liczbę puszczonych kotwic.
function openDiscHole(st, ctx, tb, discs, tune) {
  const cell = tune.holeCell, reach = Math.ceil(tune.holePad / cell);
  const occ = towerFootprint(st, tb, cell);
  const key = holeKey;
  const engine = ctx.engine;
  let freed = 0;
  for (const p of discs) {
    for (const e of [p.entity, ...(p.islands || [])]) {
      const b = bodyOf(e);
      if (!b || b.dead) continue;
      const mb = rotOf(b.quat, _m), bs = b.nodeStore;
      let left = 0, here = 0;
      for (let i = 0; i < bs.count; i++) {
        if (!bs.active[i] || bs.invMass[i] > 0) continue;
        const x = b.pos.x + mb[0] * bs.x[i] + mb[1] * bs.y[i] + mb[2] * bs.z[i];
        const y = b.pos.y + mb[3] * bs.x[i] + mb[4] * bs.y[i] + mb[5] * bs.z[i];
        const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
        let hit = false;
        for (let di = -reach; di <= reach && !hit; di++) for (let dj = -reach; dj <= reach && !hit; dj++) {
          if (occ.has(key(ci + di, cj + dj))) hit = true;
        }
        if (!hit) { left++; continue; }
        bs.invMass[i] = 1 / Math.max(1e-6, bs.mass[i]);
        engine.activate?.(b, i);
        here++;
      }
      // konstrukcja w dziurze ustępuje: belki węzłów w rzucie wieży (także już swobodnych) rwą się łatwiej
      if (tune.holeWeaken < 1) {
        const be = b.beamStore, adjStart = bs.adjStart, adj = bs.adj, brk = be.brk;
        const done = new Uint8Array(be.count);
        for (let i = 0; i < bs.count; i++) {
          if (!bs.active[i]) continue;
          const x = b.pos.x + mb[0] * bs.x[i] + mb[1] * bs.y[i] + mb[2] * bs.z[i];
          const y = b.pos.y + mb[3] * bs.x[i] + mb[4] * bs.y[i] + mb[5] * bs.z[i];
          if (!occ.has(key(Math.floor(x / cell), Math.floor(y / cell)))) continue;
          for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
            const bi = adj[q];
            if (done[bi]) continue;
            done[bi] = 1;
            brk[bi] *= tune.holeWeaken;
          }
        }
      }
      if (here > 0) {
        freed += here;
        if (left === 0 && b.anchored && typeof engine._releaseAnchor === 'function') engine._releaseAnchor(b, true);
        engine.wake(b, engine.config.wakeHoldFrames);
        b.structureDirty = true;
        if (!b.noSplit && engine.splitQueue && !engine.splitQueue.includes(b)) engine.splitQueue.push(b);
        p.touched = true;
      }
    }
  }
  return freed;
}

/**
 * Kawałek PŁASKI (bęben, szyb habitatu) → BRYŁA 3D (`piece.fall3d` — szablon z brył sceny, pirateBaseBodies.js): ciało
 * swobodne w pozie spoczynkowej kawałka; komórki bez żywego węzła płaskiego w rzucie odpadają po cichu (uszkodzenia
 * z walki zostają), ciało płaskie znika (kawałek stracony — statyka schowana, obraz trzyma ją do wypieku skóry 3D),
 * bryła rozpada się (Voronoi 3D — ctx.shatter) z pędem od habitatu i spada ku skale. Kawałek pęknięty wcześniej po
 * staremu (bez ciała) — nic. opts: { x, y (punkt rozpadu, gra), z, speed, outX, outY (gra), outZ, power }. ctx jak
 * startHabitatFall + createSolid(entity, structure, opts), releaseHull(entity). Zwraca liczbę brył (0 — nie podniesiono).
 */
export function promotePlanarPiece(st, ctx, piece, opts = {}) {
  const f3 = piece?.fall3d;
  if (!st || !f3 || piece.lost || typeof ctx.createSolid !== 'function') return 0;
  if (piece.state !== 'live' && piece.state !== 'static') return 0;
  const tune = ctx.tune || PIRATE_FALL_TUNE;
  const spec = f3.buildSolid();
  if (!spec) return 0;
  const engine = ctx.engine;
  // rzut żywych węzłów płaskich kawałka (ciało i wyspy — zakotwiczone, w pozie spoczynkowej); kawałek w statyce — cały
  const planar = [];
  let occ = null;
  const pc = Math.max(1, Number(piece.cellSize) || 15);
  if (piece.state === 'live') {
    occ = new Set();
    for (const e of [piece.entity, ...(piece.islands || [])]) {
      const b = bodyOf(e);
      if (!b || b.dead) continue;
      planar.push(e);
      const m = rotOf(b.quat, _m), s = b.nodeStore;
      for (let i = 0; i < s.count; i++) {
        if (!s.active[i]) continue;
        const x = b.pos.x + m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i];
        const y = b.pos.y + m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i];
        occ.add(holeKey(Math.floor(x / pc), Math.floor(y / pc)));
      }
    }
    if (!occ.size) return 0;
  }
  const entity = {
    id: `${piece.site?.id || 'pbase'}:${f3.id}`, name: f3.label || f3.id, type: 'worldPiece',
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, angle: 0, angVel: 0, quat: null, radius: 0, mass: 0,
    isWorldPiece: true, worldPiece: f3, static: false, isCollidable: true,
    owner: piece.site?.owner || null,
    visual: { spriteScale: 1, spriteScaleX: 1, spriteScaleY: 1, spriteRotation: 0 },
    solid3D: true, beamHull: null
  };
  const hull = ctx.createSolid(entity, spec.structure, {
    position: spec.position, quaternion: spec.quaternion, anchored: false,
    massPerArea: f3.material?.density, collisionArmor: f3.material?.armor, hexPerNode: 4, world: f3
  });
  if (!hull) return 0;
  const body = hull.body;
  body.gravityWell = wellFor(st, tune);
  // maska: komórka 3D bez żywego węzła płaskiego w rzucie (± 1 komórka płaska) — odpada bez odłamków i zdarzeń
  if (occ) {
    const m = rotOf(body.quat, _m), s = body.nodeStore;
    const od = engine.onNodeDebris, o2 = engine.onDebris;
    engine.onNodeDebris = null; engine.onDebris = null;
    try {
      for (let i = 0; i < s.count && !body.dead; i++) {
        if (!s.active[i]) continue;
        const x = body.pos.x + m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i];
        const y = body.pos.y + m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i];
        const ci = Math.floor(x / pc), cj = Math.floor(y / pc);
        let hit = false;
        for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) if (occ.has(holeKey(ci + di, cj + dj))) hit = true;
        if (!hit) engine.destroyNode(body, i);
      }
    } finally { engine.onNodeDebris = od; engine.onDebris = o2; }
  }
  // ciało płaskie kawałka znika; kawałek stracony (statyka schowana — obraz trzyma ją do wypieku skóry bryły)
  for (const e of planar) { ctx.releaseHull?.(e); e.dead = true; }
  piece.entity = null;
  if (piece.islands) piece.islands.length = 0;
  piece.lost = true;
  piece.state = 'lost';
  piece.touched = true;
  piece.site?.onLost?.(piece);
  if (body.dead || body.activeNodes <= 0) return 0;
  // rozpad (Voronoi 3D) z pędem od habitatu i ku skale; odłamy dziedziczą studnię
  const wrecks = ctx.wrecks || null;
  const before = wrecks ? wrecks.length : 0;
  const n = body.activeNodes;
  const gx = Number.isFinite(opts.x) ? opts.x : body.pos.x, gy = Number.isFinite(opts.y) ? opts.y : -body.pos.y;
  const gz = Number.isFinite(opts.z) ? opts.z : body.pos.z;
  if (typeof ctx.shatter === 'function') {
    const sev = Math.max(0, Math.min(1.4, (Number(opts.power) || 1.6) - 1));
    ctx.shatter(entity, gx, gy, gz, {
      cells: Math.max(2, Math.min(6, Math.round(Math.cbrt(n) / 2.6))),
      debrisFrac: Math.min(0.3, 0.06 * (1 + sev)), debrisMax: 220, crackDebris: 0.35, minFragmentNodes: tune.minFragmentNodes,
      speed: Math.max(1, Number(opts.speed) || 110), radial: 0.45,
      outX: Number(opts.outX) || 0, outY: Number(opts.outY) || 0, outZ: Number.isFinite(opts.outZ) ? opts.outZ : 0.1,
      spread: 0.5, spin: 0.35
    });
  }
  let made = 1;
  if (wrecks) for (let i = before; i < wrecks.length; i++) {
    const b = bodyOf(wrecks[i]);
    if (b && !b.dead && !b.anchored && !b.planar) { b.gravityWell = lowerWell(st); made++; }
  }
  st.promoted = (st.promoted || 0) + 1;
  return made;
}

// Puszczenie sektora dysku: kotwice zerwane, wrak 3D z grawitacją skały, prędkość ku dziurze po wieży i obrót, który
// opuszcza jego wewnętrzną krawędź (dysk składa się za wieżą).
function releaseDisc(st, ctx, id, tune) {
  const piece = pieceOf(ctx.site, id);
  if (!piece || piece.lost) return 0;
  const wrecks = ctx.worldBodies.detachPiece(piece, {});
  let n = 0;
  for (const w of wrecks) {
    const b = bodyOf(w);
    if (!b || b.dead) continue;
    b.gravityWell = st.well;
    // ku dziurze w poziomie (płaszczyzna ⊥ kierunku ku skale)
    let ix = st.holeX - b.pos.x, iy = st.holeY - b.pos.y, iz = st.holeZ - b.pos.z;
    const along = ix * st.downX + iy * st.downY + iz * st.downZ;
    ix -= along * st.downX; iy -= along * st.downY; iz -= along * st.downZ;
    const il = Math.sqrt(ix * ix + iy * iy + iz * iz);
    if (il > 1e-6) { ix /= il; iy /= il; iz /= il; }
    b.vel.x += ix * tune.discDrag + st.downX * tune.discDown;
    b.vel.y += iy * tune.discDrag + st.downY * tune.discDown;
    b.vel.z += iz * tune.discDrag + st.downZ * tune.discDown;
    // oś obrotu a = i × dół: wewnętrzna krawędź (p = c + i·L) jedzie ku skale
    if (il > 1e-6) {
      const ax = iy * st.downZ - iz * st.downY, ay = iz * st.downX - ix * st.downZ, az = ix * st.downY - iy * st.downX;
      b.angVel.x += ax * tune.discFold; b.angVel.y += ay * tune.discFold; b.angVel.z += az * tune.discFold;
    }
    ctx.engine.wake(b, ctx.engine.config.wakeHoldFrames);
    n++;
  }
  if (n > 0) {
    st.released++;
    const c = piece.bounds;
    ctx.hooks?.onBreach?.({ module: id, x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, z: -800, nx: 0, ny: 0, nz: -1, size: 600, entity: wrecks[0] || null, cause: 'release' });
  }
  return n;
}

/**
 * Krok (fizyka, po HullBodies.step): grawitacja skały dla odłamów spod habitatu, sekwencja upadku, przebicie dysku
 * przez wieżę, spoczynek na skale → zamrożenie. ctx jak startHabitatFall + solids (bryły z ostatniego kroku —
 * HullBodies._solids). dt — czas gry.
 */
export function stepHabitatFall(st, ctx, dt) {
  if (!st || !st.terrain || !(dt > 0)) return;
  const tune = ctx.tune || PIRATE_FALL_TUNE;
  const engine = ctx.engine;
  const well = wellFor(st, tune);
  const now = ctx.simTime();
  const solids = ctx.solids || [];
  const falling = st.phase === 'falling';
  if (falling) {
    st.t += dt;
    // wieża w sektorze dysku (styk po śmierci habitatu): pierwszy styk — zegar przejścia; przebicie — rozszczelnienie
    const tw = st.tower;
    if (tw && !tw.dead && Number(tw.__contactT) > st.startAt) {
      const hit = tw.__contactWith;
      const p = hit?.worldPiece || hit?.beamHull?.world || null;
      if (p && p.kind === 'disc') {
        if (st.touchT < 0) {
          st.touchT = st.t;
          st.plugN = cutDiscHole(st, ctx, tune);
        }
        if (!st.breached.has(p.id)) {
          const tb = bodyOf(tw);
          const v = tb ? Math.sqrt(tb.vel.x * tb.vel.x + tb.vel.y * tb.vel.y + tb.vel.z * tb.vel.z) : 0;
          if (v >= tune.breachMinSpeed) {
            st.breached.add(p.id);
            ctx.hooks?.onBreach?.({ module: p.id, x: tw.__contactX, y: tw.__contactY, z: tw.__contactZ, nx: -st.downX, ny: st.downY, nz: -st.downZ,
              size: 420, entity: hit || null, cause: 'tower' });
          }
        }
      }
    }
    // wieża przeszła pod dysk (wierzch poniżej spodu dysku) — reszta sektorów puszcza za nią
    if (!st.passed) {
      const tb = bodyOf(st.tower);
      const top = tb && !tb.dead ? bodyExtentZ(tb, 1) : -Infinity;
      if (top < st.discMinZ - tune.passMargin || (st.touchT >= 0 && st.t - st.touchT >= tune.passAfterTouch) || st.t >= tune.passTimeout) {
        st.passed = true;
        st.passT = st.t;
        // stojąca wieża dostaje przechył wokół poziomej osi ⊥ do kierunku ku skale (losowej)
        if (st.standing && tb && !tb.dead && tune.towerTumblePass > 0) {
          const rnd = typeof ctx.rnd === 'function' ? ctx.rnd : Math.random;
          const a = rnd() * Math.PI * 2;
          let ax = -st.downY, ay = st.downX, az = 0;
          const al = Math.sqrt(ax * ax + ay * ay) || 1;
          ax /= al; ay /= al;
          // druga oś ⊥: dół × a
          const bx = st.downY * az - st.downZ * ay, by = st.downZ * ax - st.downX * az, bz = st.downX * ay - st.downY * ax;
          const w = tune.towerTumblePass;
          tb.angVel.x += (Math.cos(a) * ax + Math.sin(a) * bx) * w;
          tb.angVel.y += (Math.cos(a) * ay + Math.sin(a) * by) * w;
          tb.angVel.z += (Math.cos(a) * az + Math.sin(a) * bz) * w;
        }
      }
    }
    if (st.passed) while (st.queue.length && st.passT + st.queue[0].t <= st.t) releaseDisc(st, ctx, st.queue.shift().id, tune);
    sweepTowerColumn(st, ctx, dt, tune, solids);
  }
  // bryły bazy: grawitacja skały (po śmierci habitatu wszystkie swobodne; wcześniej odłamy spod habitatu), spoczynek
  const recs = st.recs;
  const timeout = falling && st.t >= tune.settleTimeout;
  let moving = 0;
  for (let k = 0; k < solids.length; k++) {
    const b = solids[k];
    if (!b || b.dead || b.planar || b.static || b.anchored) continue;
    const world = b.hull?.world;
    if (!world || !world.site || (ctx.isBaseSite && !ctx.isBaseSite(world.site))) continue;
    const held = b.gravityWell === st.wellHold && !!st.wellHold;
    if (held && st.passed) b.gravityWell = well;
    else if (!held && b.gravityWell !== well && (falling || b.pos.z < tune.wellBelowZ || st.phase === 'settled')) b.gravityWell = well;
    if (b.gravityWell !== well && !(held && !st.passed)) continue;
    moving++;
    let r = recs.get(b);
    const e = b.entity;
    const onRock = !!r && now - r.lastContact <= tune.restContactWindow;
    const onBody = !!e && Number(e.__contactT) >= now - tune.restContactWindow;
    if (timeout) {
      // koniec sekwencji: wolne bryły przy skale zamarzają tam, gdzie są
      if (nearTerrain(st.terrain, b, 300)) settleBody(st, ctx, b, well);
      continue;
    }
    if (!onRock && !onBody) { if (r) { r.restSince = -1; r.touchSince = -1; } continue; }
    if (!r) { r = { lastContact: -1e9, lastImpact: -1e9, lastScrape: -1e9, restSince: -1, first: true, vEma: -1, touchSince: -1 }; recs.set(b, r); }
    // stos (styk z bryłą, nie ze skałą) zamarza tylko przy skale: odłam leżący na dysku, który jeszcze trzyma, nie może
    // zamarznąć w powietrzu, kiedy dysk poleci
    if (!onRock && !nearTerrain(st.terrain, b, tune.restStackPad)) { r.restSince = -1; r.touchSince = -1; continue; }
    if (!(r.touchSince >= 0)) r.touchSince = now;
    // drobina (kilka węzłów) na skale — zamarza od razu: odbija się po rzeźbie skały bez końca, a nic nie znaczy w obrazie
    if (onRock && b.activeNodes < tune.restTinyNodes) { settleBody(st, ctx, b, well); continue; }
    // drobnica w styku dłużej niż restSmallTime (podskakuje na skale, utknęła w zgniecionej wieży) — zamarza, gdy nie leci
    if (b.activeNodes < tune.restSmallNodes && now - r.touchSince >= tune.restSmallTime && (r.vEma < 0 || r.vEma < tune.restSpeed * 8)) {
      settleBody(st, ctx, b, well);
      continue;
    }
    // prędkość środka masy i obwodu (drobnica: sam ruch — obrót punktu nic nie znaczy), wygładzona: stos brył na
    // skale drga od styków co krok, a leży
    const v = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vel.z * b.vel.z);
    const w = b.activeNodes < tune.restSmallNodes ? 0
      : Math.sqrt(b.angVel.x * b.angVel.x + b.angVel.y * b.angVel.y + b.angVel.z * b.angVel.z) * (b.radius || 0);
    const vNow = Math.max(v, w);
    r.vEma = r.vEma < 0 ? vNow : r.vEma + (vNow - r.vEma) * Math.min(1, dt * tune.restEmaRate);
    const lim = onRock ? tune.restSpeed : tune.restSpeed * tune.restStackMul;
    // długi styk (stos, rzeźba skały) — wystarczy prędkość chwilowa poniżej podwójnego progu
    if (now - r.touchSince >= tune.restAssistTime && vNow <= lim * 2) { settleBody(st, ctx, b, well); continue; }
    if (r.vEma > lim) { r.restSince = -1; continue; }
    if (r.restSince < 0) { r.restSince = now; continue; }
    if (now - r.restSince < (onRock ? tune.restTime : tune.restStackTime)) continue;
    // spoczynek → zamrożenie (kształt po zgniocie zostaje, koszt kroku 0)
    settleBody(st, ctx, b, well);
  }
  if (falling && st.passed && st.queue.length === 0 && st.t > 4 && (moving === 0 || timeout)) st.phase = 'settled';
}

// KOLUMNA WIEŻY (do jej uderzenia w skałę): odłamy w rzucie wieży (szyb, korek dysku, sektory przy dziurze) nie
// wyprzedzają jej — wieża przebija dół i spada pierwsza. Zgniatany metal nie odbija się sprężyście: odłam pchnięty
// przez wieżę jedzie najwyżej z jej prędkością ku skale (× columnLead), a z kolumny zsuwa się na boki (columnPush).
// Rzut wieży (komórki columnCell) co 0,1 s; pod wierzchołkiem wieży i do columnAhead przed jej spodem.
function sweepTowerColumn(st, ctx, dt, tune, solids) {
  const tb = bodyOf(st.tower);
  if (!tb || tb.dead || st.towerImpactT >= 0 || !(tune.columnLead > 0)) return;
  const C = tune.columnCell;
  if (!st._col || st.t - st._colT >= 0.1) {
    const occ = st._col || new Set();
    occ.clear();
    const m = rotOf(tb.quat, _m), s = tb.nodeStore;
    let sx = 0, sy = 0, n = 0, zt = -Infinity, zb = Infinity;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const x = tb.pos.x + m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i];
      const y = tb.pos.y + m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i];
      const z = tb.pos.z + m[6] * s.x[i] + m[7] * s.y[i] + m[8] * s.z[i];
      occ.add(holeKey(Math.floor(x / C), Math.floor(y / C)));
      sx += x; sy += y; n++;
      if (z > zt) zt = z;
      if (z < zb) zb = z;
    }
    st._col = occ; st._colT = st.t;
    st._colCx = n ? sx / n : tb.pos.x; st._colCy = n ? sy / n : tb.pos.y;
    st._colTop = zt; st._colBot = zb;
  }
  const occ = st._col;
  const dX = st.downX, dY = st.downY, dZ = st.downZ;
  const vt = tb.vel.x * dX + tb.vel.y * dY + tb.vel.z * dZ;
  const cap = Math.max(0, vt) * tune.columnLead;
  const zLo = st._colBot - tune.columnAhead;
  let swept = 0;
  for (let k = 0; k < solids.length; k++) {
    const b = solids[k];
    if (!b || b === tb || b.dead || b.planar || b.static || b.anchored || !b.gravityWell) continue;
    const r = b.radius || 0;
    if (b.pos.z - r > st._colTop || b.pos.z + r < zLo) continue;
    const reach = Math.min(3, Math.ceil(r * 0.5 / C));
    const ci = Math.floor(b.pos.x / C), cj = Math.floor(b.pos.y / C);
    let inCol = false;
    for (let di = -reach; di <= reach && !inCol; di++) for (let dj = -reach; dj <= reach && !inCol; dj++) if (occ.has(holeKey(ci + di, cj + dj))) inCol = true;
    if (!inCol) continue;
    const vb = b.vel.x * dX + b.vel.y * dY + b.vel.z * dZ;
    if (vb > cap) { const ex = vb - cap; b.vel.x -= dX * ex; b.vel.y -= dY * ex; b.vel.z -= dZ * ex; }
    // na boki: od osi wieży, w płaszczyźnie ⊥ kierunku ku skale
    let ox = b.pos.x - st._colCx, oy = b.pos.y - st._colCy, oz = 0;
    const od = ox * dX + oy * dY;
    ox -= dX * od; oy -= dY * od; oz -= dZ * od;
    let ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (ol < 1) { ox = -dY; oy = dX; oz = 0; ol = Math.sqrt(ox * ox + oy * oy) || 1; }
    const a = tune.columnPush * dt / ol;
    b.vel.x += ox * a; b.vel.y += oy * a; b.vel.z += oz * a;
    swept++;
  }
  st.columnSwept = swept;
}

// Bryła przy skale (odległość od powierzchni ≤ promień ciała + pad).
function nearTerrain(T, b, pad) {
  const dx = b.pos.x - T.cx, dy = b.pos.y - T.cy, dz = b.pos.z - T.cz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return d - T.radius(dx / d, dy / d, dz / d) <= (b.radius || 0) + pad;
}

// Zamrożenie bryły w spoczynku (silnik: freezeBody) i zdarzenie onSettle.
function settleBody(st, ctx, b, well) {
  const tune = ctx.tune || PIRATE_FALL_TUNE;
  const pins = ctx.engine.freezeBody(b, tune.freezePinCells);
  st.recs?.delete(b);
  if (!(pins > 0)) return;
  st.frozen++;
  const ev = st._ev;
  if (ev && ctx.hooks?.onSettle) {
    ev.id = b.id; ev.kind = fallKindOf(b); ev.x = b.pos.x; ev.y = -b.pos.y; ev.z = b.pos.z;
    const ox = b.pos.x - well.x, oy = b.pos.y - well.y, oz = b.pos.z - well.z, ol = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
    ev.nx = ox / ol; ev.ny = -oy / ol; ev.nz = oz / ol;
    ev.speed = 0; ev.slide = 0; ev.mass = b.mass; ev.size = b.radius; ev.energy = 0; ev.body = b;
    ctx.hooks.onSettle(ev);
  }
}
