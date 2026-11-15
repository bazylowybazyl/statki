// HUTA — fizyczna ruda: ziarna w ruchu jako ciała (kule). Czysty moduł: bez three i DOM, bez alokacji w biegu.
//
// Ciało leci (grawitacja), odbija się od powierzchni stosu, dna i murów, ślizga i toczy z tarciem Coulomba, zderza się
// z innymi ciałami (lista na komórkę kraty), obraca (prędkość kątowa z prędkości styku, kwaternion) i — gdy stanie
// w miejscu statecznym — OSIADA jako ogniwo kolumny kraty. Stos ciał nie istnieje (stos jest kratą), więc nie ma
// pełzania ani drgań. Mocne uderzenie WYBIJA wierzchnie ziarno trafionej kolumny jako nowe ciało. W domenie ładowni
// działa pole SSANIA dzwonu.
//
// SSANIE: prąd powietrza ciągnie ziarna PO POWIERZCHNI ładunku ku osi dzwonu (z wirem) — bez unoszenia; ziarno wchodzi
// POD dolną krawędź dzwonu i dopiero w jego wnętrzu jest porywane w górę, do gardzieli. Dzwon ma ściany: ziarno
// w środku (bit BELL) nie wychodzi poza stożek klatki, ziarno z zewnątrz nie wchodzi przez ścianę — obraz nie pokaże
// ziarna przenikającego przez dzwon ani kłębu wiszącego wokół węża.
//
// STYK ZE STOSEM: powierzchnia to pole wysokości wierzchów kolumn (dno, gdy kolumna pusta) wygładzone dwuliniowo —
// urwisko jest stromą rampą, nie ma „wnętrza kolumny”, w którym ciało mogłoby utknąć. Odbicie (uderzenie ponad próg)
// dostaje drobne odchylenie normalnej z haszu: ziarna pryskają na boki, jak od nierównych brył.
// OSYPISKO: ciało, które stanęło w miejscu niestatecznym (dosypanie tu ziarna złamałoby regułę kraty), dostaje krótki
// rozpęd w dół stoku i toczy się dalej; tarcie ≈ tg kąta granicznego, więc na stoku granicznym nie zwalnia, a na
// łagodniejszym staje. Kopiec rośnie od stopy, kąt usypu wynika z reguły kraty.
//
// Układ tablic (SoA, indeks = numer ciała 0 … count − 1; kolejność zmienia się przy usuwaniu — zamiana z ostatnim):
//   px, py, pz — pozycja bieżąca; ox, oy, oz — pozycja z początku kroku `beginStep()` (interpolacja obrazu)
//   vx, vy, vz — prędkość; wx, wy, wz — prędkość kątowa; q0…q3 — kwaternion obrotu (x, y, z, w)
//   trait — bajt cech (rudy.js); flags — bity FLAG; slow — licznik podkroków spoczynku; age — wiek w podkrokach
import { NB_COUNT, NB_DI, NB_DJ, NB_DIST } from './krata.js';

/**
 * Pole ssania dzwonu: Float64Array o tych indeksach (tablica, nie obiekt — zapis liczby ułamkowej do pola obiektu
 * alokuje ją na stercie przy każdym podkroku): włączone (0 / 1), gardziel x, y, z, zasięg pola (poziomo od osi),
 * prędkość prądu przy gardzieli, udział wiru, tempo przejmowania prędkości prądu [1/s], promień przechwycenia, promień
 * gardzieli, promień dolnej krawędzi dzwonu, wysokość gardzieli nad krawędzią.
 */
export const SUCK = Object.freeze({ on: 0, x: 1, y: 2, z: 3, dInf: 4, speed: 5, swirl: 6, gain: 7, rCap: 8, rNeck: 9, rBell: 10, hBell: 11, size: 12 });

export const FLAG = Object.freeze({
  FREE: 1,        // jeszcze niczego nie dotknęło (struga z wylotu, ziarno oderwane ssaniem) — dwa takie się nie zderzają
  LIFT: 2,        // oderwane przez ssawę (wliczone w wydatek ssawy)
  DEAD: 4,        // do usunięcia w tym podkroku (przechwycone)
  TOUCH: 8,       // w ostatnim podkroku dotykało stosu, dna albo muru
  BELL: 16        // weszło pod krawędź dzwonu ssawy: prąd niesie je do gardzieli, ściany dzwonu trzymają je w środku
});

/** Parametry fizyki ciał (wspólne dla rud; pola `rest`, `fric`, `fricHit`, `settleSpeed`, `nudge`, `knockSpeed` nadpisuje ruda). */
export function bodyParams(over) {
  return Object.assign({
    g: 400,               // grawitacja [j./s²]
    vMax: 700,            // sufit prędkości (5,8 j. na podkrok 1/120 s — mniej niż komórka)
    radius: 3,            // promień styku ze stosem
    bodyD: 5.7,           // odległość styku ciało – ciało
    rest: 0.2,            // sprężystość odbicia od stosu i dna
    restMin: 60,          // poniżej tej prędkości normalnej odbicia nie ma (ślizg / toczenie)
    fric: 0.74,           // tarcie w ślizgu i toczeniu (≈ tg kąta granicznego reguły: na stoku granicznym ciało nie zwalnia)
    fricHit: 0.45,        // tarcie w odbiciu (mniejsze: odbite ziarno zachowuje część prędkości stycznej)
    rough: 0.32,          // odchylenie normalnej w odbiciu (nierówność brył)
    wallRest: 0.25,       // sprężystość murów
    bodyRest: 0.3,        // sprężystość zderzenia ciał
    settleSpeed: 16,      // poniżej tej prędkości ciało w styku liczy podkroki spoczynku
    settleN: 3,           // podkroki spoczynku do osiadania
    catchSpeed: 70,       // TOCZĄCE SIĘ wolniej ziarno (w styku już w poprzednim podkroku) klinuje się w pierwszym
                          // statecznym miejscu, na które wjedzie; ziarno z lotu najpierw odbija się albo ślizga
    nudge: 80,            // rozpęd w dół stoku, gdy miejsce jest niestateczne [j./s]
    boostN: 6,            // na ile podkroków rozłożony rozpęd
    toppleSpeed: 40,      // prędkość startowa ziarna osypanego z kolumny
    knockSpeed: 170,      // uderzenie normalne powyżej tej prędkości wybija wierzchnie ziarno kolumny
    knockShare: 0.35,     // część pędu oddana wybitemu ziarnu
    knockEvery: 3,        // co które mocne uderzenie wybija ziarno
    dustSpeed: 140,       // uderzenie powyżej tej prędkości zgłasza zdarzenie pyłu
    maxAge: 1800,         // wiek [podkroki], po którym ciało w styku osiada bez pytania o stateczność (bezpiecznik)
    heldAge: 360,         // tyle podkroków prąd ssawy trzyma oderwane ziarno poza dzwonem (potem może osiąść — dzwon odjechał)
    reserve: 64           // wolne miejsca puli zostawione strudze (osypania i wybicia ich nie zajmują)
  }, over || {});
}

/**
 * @param {object} o
 *   cap — pojemność puli; grid — krata domeny (krata.js); par — bodyParams()
 *   events — bufor zdarzeń pyłu { buf: Float32Array (5 liczb na zdarzenie), n, cap, dropped } albo null;
 *            eventKind — rodzaj zdarzenia uderzenia (siła = prędkość normalna / 500, obcięta do 1)
 *   suck — pole ssania: Float64Array wg indeksów SUCK albo null
 *   onCapture — (cechy, flagi) → bool: ziarno weszło w gardziel; false = rura pełna, ciało zostaje
 */
export function createBodies(o) {
  const cap = o.cap | 0;
  const grid = o.grid;
  const par = o.par;
  const events = o.events || null;
  const eventKind = o.eventKind | 0;
  const suck = o.suck || null;
  const onCapture = o.onCapture || null;
  const { nx, nz, x0, z0, cell, n, lvl, surf } = grid;
  const hL = grid.layer;
  const LMAX = grid.LMAX;
  const inv = 1 / cell;
  const offXZ = 254 / cell;
  const offY = 254 / hL;

  const px = new Float32Array(cap), py = new Float32Array(cap), pz = new Float32Array(cap);
  const ox = new Float32Array(cap), oy = new Float32Array(cap), oz = new Float32Array(cap);
  const vx = new Float32Array(cap), vy = new Float32Array(cap), vz = new Float32Array(cap);
  const wx = new Float32Array(cap), wy = new Float32Array(cap), wz = new Float32Array(cap);
  const q0 = new Float32Array(cap), q1 = new Float32Array(cap), q2 = new Float32Array(cap), q3 = new Float32Array(cap);
  const trait = new Uint8Array(cap);
  const flags = new Uint8Array(cap);
  const slow = new Uint8Array(cap);
  const boost = new Uint8Array(cap);         // podkroki rozpędu w dół stoku, które zostały
  const bdir = new Uint8Array(cap);          // kierunek rozpędu: numer sąsiada reguły (0…23)
  const age = new Uint16Array(cap);
  const lastCell = new Int32Array(cap);      // ostatnia komórka sprawdzona pod kątem zaklinowania
  const olvl = new Int16Array(cap);          // poziom, z którego ziarno się osypało (osiada tylko wyraźnie niżej); 32767 = bez ograniczenia
  const cellOf = new Int32Array(cap);
  const next = new Int32Array(cap);
  const head = new Int32Array(grid.N).fill(-1);
  let count = 0;
  let peak = 0;
  let knockSeq = 0;
  let impactSeq = 0;
  const stats = { settled: 0, toppled: 0, knocked: 0, captured: 0, forced: 0, refused: 0, boosted: 0 };

  // argumenty `spawn`: pozycja (0–2), prędkość (3–5), kwaternion x, y, z, w (6–9) — przez tablicę, bo argumenty
  // ułamkowe w wywołaniu funkcji alokują liczby na stercie
  const arg = new Float64Array(10);
  /**
   * Nowe ciało z `arg` (pozycja, prędkość, kwaternion) o cechach `tr` i flagach `fl`; zwraca indeks albo −1
   * (pula pełna — wołający NIE zdejmuje wtedy ziarna ze źródła).
   */
  function spawn(tr, fl) {
    if (count >= cap) { stats.refused++; return -1; }
    const p = count++;
    px[p] = arg[0]; py[p] = arg[1]; pz[p] = arg[2];
    ox[p] = arg[0]; oy[p] = arg[1]; oz[p] = arg[2];
    vx[p] = arg[3]; vy[p] = arg[4]; vz[p] = arg[5];
    wx[p] = 0; wy[p] = 0; wz[p] = 0;
    q0[p] = arg[6]; q1[p] = arg[7]; q2[p] = arg[8]; q3[p] = arg[9];
    trait[p] = tr; flags[p] = fl; slow[p] = 0; boost[p] = 0; bdir[p] = 0; age[p] = 0; lastCell[p] = -1; olvl[p] = 32767;
    if (count > peak) peak = count;
    return p;
  }

  function removeAt(p) {
    const l = --count;
    if (p === l) return;
    px[p] = px[l]; py[p] = py[l]; pz[p] = pz[l];
    ox[p] = ox[l]; oy[p] = oy[l]; oz[p] = oz[l];
    vx[p] = vx[l]; vy[p] = vy[l]; vz[p] = vz[l];
    wx[p] = wx[l]; wy[p] = wy[l]; wz[p] = wz[l];
    q0[p] = q0[l]; q1[p] = q1[l]; q2[p] = q2[l]; q3[p] = q3[l];
    trait[p] = trait[l]; flags[p] = flags[l]; slow[p] = slow[l]; boost[p] = boost[l]; bdir[p] = bdir[l]; age[p] = age[l]; lastCell[p] = lastCell[l]; olvl[p] = olvl[l];
  }

  /** Początek kroku symulacji: zapamiętuje pozycje do interpolacji obrazu (poprzednia → bieżąca). */
  function beginStep() {
    for (let p = 0; p < count; p++) { ox[p] = px[p]; oy[p] = py[p]; oz[p] = pz[p]; }
  }

  /** Ziarno ciała p staje na kolumnie c (z własnym przesunięciem i obrotem). */
  function settleInto(p, c) {
    const i = c % nx;
    const cx = x0 + (i + 0.5) * cell;
    const cz = z0 + ((c - i) / nx + 0.5) * cell;
    let ix = Math.round((px[p] - cx) * offXZ);
    let iz = Math.round((pz[p] - cz) * offXZ);
    let iy = Math.round((py[p] - (lvl[c] + 0.5) * hL) * offY);
    if (ix > 110) ix = 110; else if (ix < -110) ix = -110;
    if (iz > 110) iz = 110; else if (iz < -110) iz = -110;
    if (iy > 127) iy = 127; else if (iy < -127) iy = -127;
    const aq = grid.argQuat;
    aq[0] = q0[p]; aq[1] = q1[p]; aq[2] = q2[p]; aq[3] = q3[p];
    grid.push(c, trait[p], ix, iy, iz);
  }

  /**
   * Podkrok fizyki wszystkich ciał domeny.
   * @param {number} dt  długość podkroku [s] (1/120)
   */
  function substep(dt) {
    const cnt0 = count;
    if (cnt0 === 0) return;
    const R = par.radius;
    const xmin = x0 + R;
    const xmax = x0 + nx * cell - R;
    const zmin = z0 + R;
    const zmax = z0 + nz * cell - R;
    const gdt = par.g * dt;
    const e0 = par.rest;
    const vRest = par.restMin;
    const mu = par.fric;
    const muHit = par.fricHit;
    const rough = par.rough;
    const vMax = par.vMax;
    const vMax2 = vMax * vMax;
    const DB = par.bodyD;
    const DB2 = DB * DB;
    const eb = (1 + par.bodyRest) * 0.5;
    const wallE = par.wallRest;
    const vS2 = par.settleSpeed * par.settleSpeed;
    const vC2 = par.catchSpeed * par.catchSpeed;
    const settleN = par.settleN;
    const knockV = par.knockSpeed;
    const knockShare = par.knockShare;
    const knockEvery = par.knockEvery;
    const dustV = par.dustSpeed;
    const capKnock = cap - par.reserve;
    const boostN = par.boostN;
    const kick = par.nudge / boostN;
    const near = DB + 6;                     // powyżej tej wysokości nad stosem ciało „wolne” nie szuka sąsiadów
    const reach = R * 5;                     // pionowy prześwit, poniżej którego liczy się normalną stoku (stok do ~78°)
    const sOn = suck !== null && suck[SUCK.on] !== 0;
    const sx = sOn ? suck[SUCK.x] : 0;
    const sy = sOn ? suck[SUCK.y] : 0;
    const sz = sOn ? suck[SUCK.z] : 0;
    const sInf = sOn ? suck[SUCK.dInf] : 1;
    const sInf2 = sInf * sInf;
    const sSpeed = sOn ? suck[SUCK.speed] : 0;
    const sSwirl = sOn ? suck[SUCK.swirl] : 0;
    const sGain = sOn ? Math.min(1, suck[SUCK.gain] * dt) : 0;
    const sCap2 = sOn ? suck[SUCK.rCap] * suck[SUCK.rCap] : 0;
    const sNeck2 = sOn ? suck[SUCK.rNeck] * suck[SUCK.rNeck] : 0;
    const sRb = sOn ? suck[SUCK.rBell] : 0;            // promień dolnej krawędzi dzwonu
    const sRn = sOn ? suck[SUCK.rNeck] : 0;            // promień gardzieli
    const sHb = sOn ? suck[SUCK.hBell] : 1;            // gardziel nad krawędzią
    const sRim = sy - sHb;                             // wysokość dolnej krawędzi dzwonu
    const sIn0 = sRb - 4;                              // ściana od środka: promień środka ziarna przy krawędzi…
    const sIn1 = sRn - 3;                              // …i przy gardzieli
    const sOut0 = sRb + 1 + R;                         // ściana z zewnątrz: przy krawędzi…
    const sOut1 = sRn + 5 + R;                         // …i przy kołnierzu gardzieli (wyżej wąż)
    const heldAge = par.heldAge;
    const FREE = FLAG.FREE;
    const TOUCH = FLAG.TOUCH;
    const DEAD = FLAG.DEAD;
    const LIFT = FLAG.LIFT;
    const BELL = FLAG.BELL;
    const nxm2 = nx - 2;
    const nzm2 = nz - 2;

    // listy ciał na komórkę (z pozycji sprzed podkroku)
    for (let p = 0; p < cnt0; p++) {
      let i = ((px[p] - x0) * inv) | 0;
      let j = ((pz[p] - z0) * inv) | 0;
      if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
      if (j < 0) j = 0; else if (j >= nz) j = nz - 1;
      const c = j * nx + i;
      cellOf[p] = c;
      next[p] = head[c];
      head[c] = p;
    }

    for (let p = 0; p < cnt0; p++) {
      let fl = flags[p];
      if ((fl & DEAD) !== 0) continue;
      let x = px[p];
      let y = py[p];
      let z = pz[p];
      let ux = vx[p];
      let uy = vy[p] - gdt;
      let uz = vz[p];

      // --- pole ssania dzwonu: prąd ciągnie ziarno PO POWIERZCHNI ku osi (z wirem), pod krawędź dzwonu; dopiero pod
      // dzwonem (bit BELL) prąd porywa je w górę, do gardzieli
      const wasTouch = (fl & TOUCH) !== 0;   // styk w poprzednim podkroku (ziarno toczy się, a nie właśnie spada z lotu)
      let held = false;                      // ziarno w prądzie ssawy: nie osiada i nie klinuje się
      let inBell = false;                    // w słupie prądu pod dzwonem albo w dzwonie
      let inFlow = false;                    // w prądzie przy powierzchni, poza dzwonem
      if (sOn) {
        const rx = sx - x;
        const rz = sz - z;
        const h2 = rx * rx + rz * rz;
        if (h2 < sInf2 && y < sy + 40) {
          const hh = Math.sqrt(h2) + 1e-6;
          inBell = (fl & BELL) !== 0;
          if (!inBell && hh < sRb - 1 && y < sRim + 2) { inBell = true; fl |= BELL; }
          if (inBell) {
            const ry = sy - y;
            const d2 = h2 + ry * ry;
            if (d2 < sCap2 || (ry < 3 && h2 < sNeck2)) {
              if (onCapture === null || onCapture(trait[p], fl)) { flags[p] = fl | DEAD; stats.captured++; continue; }
            }
            held = true;
            const u = sSpeed / (Math.sqrt(d2) + 1e-6);      // prędkość prądu / odległość od gardzieli
            const w = sSwirl * sSpeed / (hh + 12);
            ux += (rx * u - rz * w - ux) * sGain;
            uy += (ry * u - uy) * sGain + gdt;              // w dzwonie prąd niesie ziarno: grawitacja zniesiona
            uz += (rz * u + rx * w - uz) * sGain;
          } else {
            const k = 1 - hh / sInf;                        // 1 przy osi, 0 na skraju pola
            inFlow = true;
            held = (fl & LIFT) !== 0 && age[p] < heldAge;
            // prąd wpada pod krawędź dzwonu warstwą przy powierzchni: pełny od 4 j. pod krawędzią do 6 j. nad nią,
            // niżej (ziarno w starym leju pod dzwonem jadącym po świeżym ładunku) i wyżej słabnie do zera — nie
            // wciąga ziarna w ścianę ładunku ani nie trzyma go w powietrzu
            const dyr = y - sRim;
            let hk = dyr > 6 ? 1 - (dyr - 6) / 20 : dyr < -4 ? 1 + (dyr + 4) / 30 : 1;
            if (hk < 0) hk = 0;
            const u = sSpeed * (0.25 + 0.75 * k) / hh;
            const w = 0.35 * sSwirl * sSpeed * k / (hh + 12);  // przy powierzchni wir jest łagodny (ziarno wchodzi pod krawędź, nie krąży wokół niej)
            const g = sGain * (0.3 + 0.7 * k) * hk;
            ux += (rx * u - rz * w - ux) * g;
            uz += (rz * u + rx * w - uz) * g;
            uy += gdt * 0.4 * k * hk;                       // przy dzwonie ziarno jest „lżejsze” (sunie, podskakuje), ale nie unosi się
          }
        } else if ((fl & BELL) !== 0) { fl &= ~BELL; ux *= 0.3; uz *= 0.3; if (uy > 20) uy = 20; }
      } else if ((fl & BELL) !== 0) { fl &= ~BELL; ux *= 0.3; uz *= 0.3; if (uy > 20) uy = 20; }   // ssanie stanęło: prąd już nie niesie

      let sp2 = ux * ux + uy * uy + uz * uz;
      if (sp2 > vMax2) { const k = vMax / Math.sqrt(sp2); ux *= k; uy *= k; uz *= k; }
      x += ux * dt; y += uy * dt; z += uz * dt;
      let touched = false;

      // --- mury domeny (ciało nigdy nie wychodzi poza kratę)
      if (x < xmin) { x = xmin; if (ux < 0) ux = -ux * wallE; touched = true; } else if (x > xmax) { x = xmax; if (ux > 0) ux = -ux * wallE; touched = true; }
      if (z < zmin) { z = zmin; if (uz < 0) uz = -uz * wallE; touched = true; } else if (z > zmax) { z = zmax; if (uz > 0) uz = -uz * wallE; touched = true; }

      // --- powierzchnia stosu: pole wysokości wygładzone dwuliniowo między środkami kolumn
      const fx = (x - x0) * inv - 0.5;
      const fz = (z - z0) * inv - 0.5;
      let i0 = fx | 0;
      let j0 = fz | 0;
      if (i0 < 0) i0 = 0; else if (i0 > nxm2) i0 = nxm2;
      if (j0 < 0) j0 = 0; else if (j0 > nzm2) j0 = nzm2;
      const tx = fx - i0;
      const tz = fz - j0;
      const cb = j0 * nx + i0;
      const s00 = surf[cb];
      const s10 = surf[cb + 1];
      const s01 = surf[cb + nx];
      const s11 = surf[cb + nx + 1];
      const sa = s00 + (s10 - s00) * tx;
      const sb = s01 + (s11 - s01) * tx;
      const H = sa + (sb - sa) * tz;
      const gap = y - H;
      if (gap < reach) {
        const gx = ((s10 - s00) * (1 - tz) + (s11 - s01) * tz) * inv;
        const gz = (sb - sa) * inv;
        let nyn = 1 / Math.sqrt(1 + gx * gx + gz * gz);
        let nxn = -gx * nyn;
        let nzn = -gz * nyn;
        // odległość środka kuli od płaszczyzny stycznej stoku (na stromiźnie pionowy prześwit jest większy niż R)
        const pen = R - gap * nyn;
        if (pen > 0) {
          x += nxn * pen; y += nyn * pen; z += nzn * pen;
          let vn = ux * nxn + uy * nyn + uz * nzn;
          if (vn < 0) {
            let sp = -vn;
            let e = 0;
            let m = mu;
            if (sp > vRest) {
              // odbicie: normalna odchylona nierównością brył (hasz z miejsca i kolejnego numeru uderzenia)
              e = e0;
              m = muHit;
              let hsh = Math.imul(cb + (impactSeq++), 0x9E3779B1);
              hsh ^= hsh >>> 15; hsh = Math.imul(hsh, 0x85EBCA6B); hsh ^= hsh >>> 13;
              nxn += ((hsh & 1023) / 511.5 - 1) * rough;
              nzn += (((hsh >>> 10) & 1023) / 511.5 - 1) * rough;
              const k = 1 / Math.sqrt(nxn * nxn + nyn * nyn + nzn * nzn);
              nxn *= k; nyn *= k; nzn *= k;
              vn = ux * nxn + uy * nyn + uz * nzn;
              sp = -vn;
            }
            if (sp > 0) {
              let ax = ux - vn * nxn;
              let ay = uy - vn * nyn;
              let az = uz - vn * nzn;
              const tl = Math.sqrt(ax * ax + ay * ay + az * az);
              const f = tl > 1e-6 ? 1 - m * (1 + e) * sp / tl : 0;
              if (f > 0) { ax *= f; ay *= f; az *= f; } else { ax = 0; ay = 0; az = 0; }
              if (sp > dustV && events !== null) {
                if (events.n < events.cap) {
                  const eb5 = events.buf;
                  const eo = events.n * 5;
                  eb5[eo] = x; eb5[eo + 1] = y - R; eb5[eo + 2] = z; eb5[eo + 3] = sp > 500 ? 1 : sp / 500; eb5[eo + 4] = eventKind;
                  events.n++;
                } else events.dropped++;
              }
              if (sp > knockV && count < capKnock && (knockSeq++ % knockEvery) === 0) {
                // WYBICIE: wierzchnie ziarno trafionej kolumny wylatuje jako ciało z częścią pędu uderzającego
                let ci = ((x - x0) * inv) | 0;
                let cj = ((z - z0) * inv) | 0;
                if (ci < 0) ci = 0; else if (ci >= nx) ci = nx - 1;
                if (cj < 0) cj = 0; else if (cj >= nz) cj = nz - 1;
                const cc = cj * nx + ci;
                if (n[cc] > 0) {
                  const yt = (lvl[cc] - 0.5) * hL;
                  const tr = grid.popTop(cc);
                  const qv = grid.popQuat;
                  arg[0] = x0 + (ci + 0.5) * cell; arg[1] = yt + 1.5; arg[2] = z0 + (cj + 0.5) * cell;
                  arg[3] = ux * knockShare; arg[4] = sp * knockShare * 0.8 + 18; arg[5] = uz * knockShare;
                  arg[6] = qv[0]; arg[7] = qv[1]; arg[8] = qv[2]; arg[9] = qv[3];
                  spawn(tr, TOUCH);
                  grid.markDirty(cc);
                  stats.knocked++;
                  const keep = 1 - knockShare * 0.6;
                  ax *= keep; ay *= keep; az *= keep;
                }
              }
              ux = ax - e * vn * nxn;
              uy = ay - e * vn * nyn;
              uz = az - e * vn * nzn;
              // urwisko (rampa stromsza niż 60°): ziarno wbite w ścianę stosu traci pęd, nie wjeżdża po niej w powietrze
              if (nyn < 0.5 && uy > 0) uy *= nyn * 2;
            }
          }
          touched = true;
        }
      }

      // --- rozpęd osypiska: krótkie przyspieszenie w dół stoku (kierunek z reguły kraty)
      if (boost[p] !== 0) {
        if (touched) {
          const k = bdir[p];
          const l = kick / NB_DIST[k];
          ux += NB_DI[k] * l;
          uz += NB_DJ[k] * l;
        }
        boost[p]--;
      }

      // --- inne ciała w 3 × 3 komórkach (para raz: tylko q > p; dwa ciała „wolne” mijają się)
      if ((fl & FREE) === 0 || gap < near) {
        let ci = ((x - x0) * inv) | 0;
        let cj = ((z - z0) * inv) | 0;
        if (ci < 0) ci = 0; else if (ci >= nx) ci = nx - 1;
        if (cj < 0) cj = 0; else if (cj >= nz) cj = nz - 1;
        const a0 = ci > 0 ? ci - 1 : 0;
        const a1 = ci < nx - 1 ? ci + 1 : nx - 1;
        const b0 = cj > 0 ? cj - 1 : 0;
        const b1 = cj < nz - 1 ? cj + 1 : nz - 1;
        for (let b = b0; b <= b1; b++) {
          const row = b * nx;
          for (let a = a0; a <= a1; a++) {
            for (let q = head[row + a]; q >= 0; q = next[q]) {
              if (q <= p) continue;
              const fq = flags[q];
              if ((fl & fq & FREE) !== 0 || (fq & DEAD) !== 0 || ((fl ^ fq) & BELL) !== 0) continue;
              const dx = x - px[q];
              const dy = y - py[q];
              const dz = z - pz[q];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= DB2 || d2 < 1e-8) continue;
              const d = Math.sqrt(d2);
              const pen = (DB - d) * 0.5;
              const nxn = dx / d;
              const nyn = dy / d;
              const nzn = dz / d;
              x += nxn * pen; y += nyn * pen; z += nzn * pen;
              px[q] -= nxn * pen; py[q] -= nyn * pen; pz[q] -= nzn * pen;
              const rv = (ux - vx[q]) * nxn + (uy - vy[q]) * nyn + (uz - vz[q]) * nzn;
              if (rv < 0) {
                const jn = -eb * rv;
                ux += jn * nxn; uy += jn * nyn; uz += jn * nzn;
                vx[q] -= jn * nxn; vy[q] -= jn * nyn; vz[q] -= jn * nzn;
                if (rv < -24) slow[q] = 0;         // lekkie szturchnięcie nie budzi ziarna, które właśnie staje
              }
            }
          }
        }
        // po korektach: jeszcze raz w granicach domeny
        if (x < xmin) x = xmin; else if (x > xmax) x = xmax;
        if (z < zmin) z = zmin; else if (z > zmax) z = zmax;
      }

      // --- ściany dzwonu: słup prądu pod dzwonem i stożek klatki od krawędzi do gardzieli — ziarno w środku zostaje
      // w środku (jedzie z dzwonem), ziarno z zewnątrz nie wejdzie przez ścianę ani nie wyleci w górę obok dzwonu
      if (inBell) {
        const ddx = x - sx;
        const ddz = z - sz;
        const h2 = ddx * ddx + ddz * ddz;
        let t = (y - sRim) / sHb;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        // pod krawędzią: słup prądu o promieniu dzwonu; od krawędzi w górę: stożek klatki
        const rmax = y < sRim - 1 ? sRb : sIn0 - (sIn0 - sIn1) * t;
        if (h2 > rmax * rmax) {
          const hh = Math.sqrt(h2);
          const k = rmax / hh;
          x = sx + ddx * k; z = sz + ddz * k;
          const vr = (ux * ddx + uz * ddz) / hh;
          if (vr > 0) { ux -= vr * ddx / hh; uz -= vr * ddz / hh; }
        }
      } else if (inFlow) {
        if (uy > 90) uy = 90;                               // podskok na nierówności, nie wyrzut w powietrze
        if (y > sRim - 1) {
          const ddx = x - sx;
          const ddz = z - sz;
          const h2 = ddx * ddx + ddz * ddz;
          let t = (y - sRim) / sHb;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const rmin = sOut0 - (sOut0 - sOut1) * t;
          if (h2 < rmin * rmin && h2 > 1e-6) {
            const hh = Math.sqrt(h2);
            const k = rmin / hh;
            x = sx + ddx * k; z = sz + ddz * k;
            const vr = (ux * ddx + uz * ddz) / hh;
            if (vr < 0) { ux -= vr * ddx / hh; uz -= vr * ddz / hh; }
          }
        }
      }

      if (touched) {
        // obrót z toczenia (oś pozioma, prostopadła do ruchu)
        wx[p] += (uz / R - wx[p]) * 0.4;
        wy[p] *= 0.6;
        wz[p] += (-ux / R - wz[p]) * 0.4;
        fl = (fl & ~FREE) | TOUCH;
        const s2 = ux * ux + uy * uy + uz * uz;
        if (held) slow[p] = 0;
        else if (s2 < vS2) { if (slow[p] < 250) slow[p]++; } else {
          slow[p] = 0;
          if (wasTouch && s2 < vC2) {
            // ZAKLINOWANIE: wolno TOCZĄCE SIĘ ziarno (w styku już w poprzednim podkroku — nie w chwili pierwszego
            // uderzenia z lotu) staje w pierwszej komórce, w której może leżeć statecznie
            let ci = ((x - x0) * inv) | 0;
            let cj = ((z - z0) * inv) | 0;
            if (ci < 0) ci = 0; else if (ci >= nx) ci = nx - 1;
            if (cj < 0) cj = 0; else if (cj >= nz) cj = nz - 1;
            const cc = cj * nx + ci;
            if (cc !== lastCell[p]) {
              lastCell[p] = cc;
              if (n[cc] < LMAX - 2 && lvl[cc] + 2 <= olvl[p] && grid.unstableDir(cc, 1) < 0) { ux *= 0.25; uy *= 0.25; uz *= 0.25; slow[p] = settleN; boost[p] = 0; }
            }
          }
        }
      } else {
        fl &= ~TOUCH;
        // tuż nad stosem (podparte przez inne ciało, które zaraz osiądzie) też liczy spoczynek
        if (!held && gap < R + 1.2 && ux * ux + uy * uy + uz * uz < vS2) { if (slow[p] < 250) slow[p]++; } else slow[p] = 0;
      }
      // --- całkowanie obrotu
      const ax = wx[p];
      const ay = wy[p];
      const az = wz[p];
      if (ax * ax + ay * ay + az * az > 1e-4) {
        const h = 0.5 * dt;
        const qx = q0[p];
        const qy = q1[p];
        const qz = q2[p];
        const qw = q3[p];
        const rx = qx + h * (ax * qw + ay * qz - az * qy);
        const ry = qy + h * (ay * qw + az * qx - ax * qz);
        const rz = qz + h * (az * qw + ax * qy - ay * qx);
        const rw = qw - h * (ax * qx + ay * qy + az * qz);
        const k = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw);
        q0[p] = rx * k; q1[p] = ry * k; q2[p] = rz * k; q3[p] = rw * k;
      }
      px[p] = x; py[p] = y; pz[p] = z;
      vx[p] = ux; vy[p] = uy; vz[p] = uz;
      flags[p] = fl;
      if (age[p] < 65535) age[p]++;
    }

    // sprzątanie list
    for (let p = 0; p < cnt0; p++) head[cellOf[p]] = -1;

    // --- osiadanie, rozpęd w dół stoku, usuwanie przechwyconych
    const maxAge = par.maxAge;
    for (let p = 0; p < count;) {
      const fl = flags[p];
      if ((fl & DEAD) !== 0) { removeAt(p); continue; }
      if (slow[p] >= settleN) {
        let i = ((px[p] - x0) * inv) | 0;
        let j = ((pz[p] - z0) * inv) | 0;
        if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
        if (j < 0) j = 0; else if (j >= nz) j = nz - 1;
        const c = j * nx + i;
        const room = n[c] < LMAX - 2;
        const k = room ? grid.unstableDir(c, 1) : grid.unstableDir(c, 0);
        const old = age[p] > maxAge;
        // ziarno z osypiska osiada tylko wyraźnie niżej, niż leżało (inaczej dwie kolumny przerzucałyby je bez końca)
        const lowEnough = lvl[c] + 2 <= olvl[p] || age[p] > 300;      // po 2,5 s: ziarno uwięzione w dołku zostaje
        if (room && ((k < 0 && lowEnough) || old)) {
          if (k >= 0) stats.forced++;
          settleInto(p, c);
          if (k >= 0) grid.markDirty(c); else grid.markNear(c);
          removeAt(p);
          stats.settled++;
          continue;
        }
        if (k >= 0) { bdir[p] = k; boost[p] = boostN; stats.boosted++; }
        else if (room && !lowEnough) { boost[p] = boostN; stats.boosted++; }      // dalej w kierunku osypania
        else {
          // kolumna pełna po sufit stosu i nie ma dokąd: lekko w bok (kierunek z numeru ciała)
          vx[p] += (p & 1 ? 30 : -30);
          vz[p] += (p & 2 ? 30 : -30);
        }
        slow[p] = 0;
      }
      p++;
    }
  }

  /**
   * Osypania: niestateczne kolumny z kolejki kraty oddają wierzchnie ziarno jako ciało toczące się ku najniższemu
   * sąsiadowi. Najwyżej `budget` osypań i `maxChecks` sprawdzeń; przy pełnej puli (bez rezerwy strugi) NIC nie jest
   * zdejmowane — kolumna czeka w kolejce jako chwilowo stroma ściana. Zwraca liczbę osypań.
   */
  function topple(budget, maxChecks) {
    let done = 0;
    let checks = 0;
    const lim = cap - par.reserve;
    const v0 = par.toppleSpeed;
    const R = par.radius;
    while (done < budget && checks < maxChecks && grid.queued > 0) {
      if (count >= lim) break;
      const c = grid.dequeue();
      checks++;
      if (n[c] === 0) continue;
      const k = grid.unstableDir(c, 0);
      if (k < 0) continue;
      const ex = grid.excess[0];
      const i = c % nx;
      const j = (c - i) / nx;
      const from = lvl[c];
      const tr = grid.popTop(c);
      const qv = grid.popQuat;
      const il = 1 / NB_DIST[k];
      const dx = NB_DI[k] * il;
      const dz = NB_DJ[k] * il;
      const sp = v0 * (ex > 1 ? 1.5 : 1) * (0.8 + 0.4 * ((Math.imul(c + done, 0x9E3779B1) >>> 24) / 256));
      // start na dawnym miejscu ziarna (tuż nad powierzchnią po zdjęciu), z prędkością ku sąsiadowi
      arg[0] = x0 + (i + 0.5) * cell + dx * cell * 0.3; arg[1] = surf[c] + hL * 0.5 + R * 0.4; arg[2] = z0 + (j + 0.5) * cell + dz * cell * 0.3;
      arg[3] = dx * sp; arg[4] = 0; arg[5] = dz * sp;
      arg[6] = qv[0]; arg[7] = qv[1]; arg[8] = qv[2]; arg[9] = qv[3];
      const p = spawn(tr, FLAG.TOUCH);
      if (p >= 0) { bdir[p] = k; boost[p] = par.boostN >> 1; olvl[p] = from; }
      grid.markDirty(c);
      done++;
    }
    stats.toppled += done;
    return done;
  }

  /** Wszystkie ciała osiadają natychmiast w kolumnach pod sobą (przejście w tryb szybki). Kratę trzeba potem rozluźnić. */
  function settleAll() {
    for (let p = 0; p < count; p++) {
      const c = grid.findRoom(grid.colAt(px[p], pz[p]));      // kolumna pełna po sufit: najbliższa z miejscem
      grid.pushHashed(c, trait[p]);
      grid.markNear(c);
    }
    count = 0;
  }

  /**
   * Zapis ciał dla obrazu: 12 liczb f32 na ziarno — pozycja bieżąca (x, y, z), pozycja z początku kroku (x, y, z),
   * kwaternion (x, y, z, w), bajt cech, RODZAJ + 16 × PRZEŚWIT. Rodzaj: 0 lot, 1 toczenie / styk, 2 ssanie; prześwit —
   * wysokość spodu ziarna nad powierzchnią stosu pod nim [j., 0…255, całkowita] (cień ziarna na stosie: `obraz.js`).
   * Zwraca liczbę zapisanych ziaren.
   */
  function write(out, at) {
    let w = at * 12;
    const lim = out.length - 12;
    let k = 0;
    const R = par.radius;
    const nxm2 = nx - 2;
    const nzm2 = nz - 2;
    for (let p = 0; p < count && w <= lim; p++, k++, w += 12) {
      out[w] = px[p]; out[w + 1] = py[p]; out[w + 2] = pz[p];
      out[w + 3] = ox[p]; out[w + 4] = oy[p]; out[w + 5] = oz[p];
      out[w + 6] = q0[p]; out[w + 7] = q1[p]; out[w + 8] = q2[p]; out[w + 9] = q3[p];
      out[w + 10] = trait[p];
      const fl = flags[p];
      // powierzchnia pod ciałem: to samo pole wysokości co w styku (dwuliniowo między środkami kolumn)
      const fx = (px[p] - x0) * inv - 0.5;
      const fz = (pz[p] - z0) * inv - 0.5;
      let i0 = fx | 0;
      let j0 = fz | 0;
      if (i0 < 0) i0 = 0; else if (i0 > nxm2) i0 = nxm2;
      if (j0 < 0) j0 = 0; else if (j0 > nzm2) j0 = nzm2;
      const tx = fx - i0;
      const tz = fz - j0;
      const cb = j0 * nx + i0;
      const sa = surf[cb] + (surf[cb + 1] - surf[cb]) * tx;
      const sb = surf[cb + nx] + (surf[cb + nx + 1] - surf[cb + nx]) * tx;
      let gap = (py[p] - R - (sa + (sb - sa) * tz) + 0.5) | 0;
      if (gap < 0) gap = 0; else if (gap > 255) gap = 255;
      out[w + 11] = ((fl & FLAG.LIFT) !== 0 ? 2 : (fl & FLAG.TOUCH) !== 0 ? 1 : 0) + 16 * gap;
    }
    return k;
  }

  /** Liczba ciał wolniejszych niż `v` [j./s] (diagnostyka). */
  function slowerThan(v) {
    let k = 0;
    const v2 = v * v;
    for (let p = 0; p < count; p++) if (vx[p] * vx[p] + vy[p] * vy[p] + vz[p] * vz[p] < v2) k++;
    return k;
  }

  return {
    cap, grid, par, stats, arg,
    px, py, pz, ox, oy, oz, vx, vy, vz, wx, wy, wz, q0, q1, q2, q3, trait, flags, slow, age,
    get count() { return count; },
    get peak() { return peak; },
    resetPeak() { peak = count; },
    spawn, beginStep, substep, topple, settleAll, write, slowerThan
  };
}
