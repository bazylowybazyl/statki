// src/game/story/pirateRockImpacts.js
//
// UDERZENIA W PLANETOIDĘ pod bazą piratów (misja 1) — KONTRAKT fizyki upadku bazy z obrazem (prośba użytkownika
// 2026-10-19: „dym / efekt upadku, uderzenia w planetę przez większe / mniejsze rzeczy”). Fizyka (upadek wieży habitatu,
// sektorów dysku, kawałków bębna, odłamów i liny windy na skałę — sesja orkiestratora) woła z kroku fizyki:
//   • rockImpact(ev) — pierwszy styk ciała ze skałą (i kolejne mocne, ≥ ~0,6 s później),
//   • rockScrape(ev) — szorowanie / toczenie po powierzchni (najwyżej co ~0,25 s na ciało),
//   • rockSettle(ev) — ciało osiadło (ostatni kłąb).
// ev = { id (stały na ciało), kind: 'tower' | 'disc' | 'drum' | 'core' | 'debris' | 'cable' | 'other', x, y (GRA — punkt
// styku), z (wysokość świata, ujemna), nx, ny, nz (normalna skały na zewnątrz, układ GRY: y w dół, z w górę), speed (j/s
// wzdłuż normalnej), slide (j/s stycznie), mass (masa silnika), size (promień ciała / łaty styku, j.), energy (½·m·v²),
// vx, vy, vz (opcjonalnie: prędkość ciała w układzie gry — kierunek śladu pyłu przy szorowaniu) }.
//
// Moduł jest czysty (bez three, DOM i `window`): waliduje zdarzenie, pilnuje odstępów na ciało (fizyka może wołać co krok
// — nadmiar przepada tutaj), normalną bez wartości liczy z położenia skały (pirateRockLayout + miejsce bazy) i pisze
// rekord ROCK_IMPACT do strumienia rozkazów renderu (src/render/rockImpactRecord.js) — działa w trybie render w workerze
// (domyślny) i `?renderWorker=0` tak samo: obraz (src/3d/pirateRockImpactFx.js) dostaje rekord z dekodera. Wynik zdarzenia
// (czy obraz coś narysował) gry nie steruje.
//
// Dev / narzędzia: PirateRockImpacts.test({ e, n, size, speed, slide, kind, dirE, dirN }) — sztuczne uderzenie w punkt
// powierzchni (e, n — odległości po powierzchni od stopy windy jak surfacePoint w pirateRockLayout.js); scrape i settle
// tak samo (testScrape / testSettle); demo('upadek') — scenariusz upadku bazy z kolejnych zdarzeń (bez fizyki).

import { ROCK_IMPACT_CODE, ROCK_IMPACT_REC, ROCK_EVENT, rockBodyKindCode } from '../../render/rockImpactRecord.js';
import { createPirateRockLayout } from '../../3d/portBuildings/pirateRockLayout.js';

/** Strojenie kontraktu (konsola: window.PirateRockImpacts.tune). */
export const ROCK_IMPACT_TUNE = {
  impactGap: 0.45,      // [s] najkrótszy odstęp uderzeń jednego ciała (mocniejsze — energia ≥ impactBoost × ostatnia — przechodzi)
  impactBoost: 2.0,
  scrapeGap: 0.2,       // [s] najkrótszy odstęp szorowania jednego ciała
  minImpactSpeed: 12,   // [j/s] uderzenie wolniejsze wzdłuż normalnej (i bez poślizgu) — tylko kłąb osiadania
  minScrapeSlide: 10,   // [j/s] szorowanie wolniejsze — pomijane
  burstWindow: 0.1,     // [s] okno sufitu zdarzeń (wszystkie ciała razem)
  burstMax: 96,         // zdarzeń w oknie (reszta przepada — obraz i tak łączy bliskie uderzenia)
  bodyMemory: 30        // [s] pamięć ciała bez zdarzeń (potem wpis wypada)
};

const stats = { impacts: 0, scrapes: 0, settles: 0, written: 0, gapped: 0, burst: 0, invalid: 0, noSink: 0 };

let _writer = null;
let _clock = null;
let _place = null;
let _layout = null;
const _bodies = new Map();   // id → { tI, eI, tS, settled, seen }
const _ids = new Map();      // napis → liczba (id w rekordzie)
let _nextId = 1;
let _burstT = -Infinity;
let _burstN = 0;
let _testSerial = 0;
const _ev = {
  id: 0, kind: 'other', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, speed: 0, slide: 0, mass: 0, size: 0, energy: 0, vx: 0, vy: 0, vz: 0
};
const _p = {};
const _sched = [];           // demo / testy: zaplanowane zdarzenia { t, type, ev }

/**
 * Podpięcie (index.html): writer — pisarz strumienia rozkazów (RenderCommands.writer), clock — () → czas gry [s]
 * (SimClock.sim; pauza stoi), place — () → miejsce bazy z planu misji (pirateBasePlace) albo null.
 */
export function installPirateRockImpacts(writer, { clock = null, place = null } = {}) {
  _writer = writer || null;
  _clock = typeof clock === 'function' ? clock : null;
  _place = typeof place === 'function' ? place : null;
}

/** Nowa gra / nowa baza: pamięć ciał i zaplanowane zdarzenia wyczyszczone. */
export function resetPirateRockImpacts() {
  _bodies.clear();
  _ids.clear();
  _nextId = 1;
  _sched.length = 0;
  _burstN = 0;
  _burstT = -Infinity;
}

function now() {
  const t = _clock ? Number(_clock()) : 0;
  return Number.isFinite(t) ? t : 0;
}

function layout() {
  if (!_layout) _layout = createPirateRockLayout();
  return _layout;
}

/** Środek skały w grze { x, y, z } (z — wysokość) albo null bez bazy. */
export function pirateRockCenterGame(out = {}) {
  const pl = _place ? _place() : null;
  if (!pl || typeof pl.toGame !== 'function') return null;
  const c = layout().center;
  pl.toGame(c[0], c[2], out);
  out.z = c[1];
  return out;
}

function numId(id) {
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  const key = String(id ?? 'anon');
  let v = _ids.get(key);
  if (v === undefined) {
    v = 1e6 + _nextId++;
    _ids.set(key, v);
  }
  return v;
}

function bodyOf(id, t) {
  let b = _bodies.get(id);
  if (!b) {
    if (_bodies.size > 512) {
      for (const [k, v] of _bodies) if (t - v.seen > ROCK_IMPACT_TUNE.bodyMemory) _bodies.delete(k);
    }
    b = { tI: -Infinity, eI: 0, tS: -Infinity, settled: false, seen: t };
    _bodies.set(id, b);
  }
  b.seen = t;
  return b;
}

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Zdarzenie → roboczy rekord `_ev` (walidacja, normalna, energia). false — zdarzenie bez punktu styku. */
function normalize(ev) {
  if (!ev || !Number.isFinite(ev.x) || !Number.isFinite(ev.y) || !Number.isFinite(ev.z)) return false;
  const e = _ev;
  e.id = numId(ev.id);
  e.kind = ev.kind || 'other';
  e.x = ev.x; e.y = ev.y; e.z = ev.z;
  let nx = fin(ev.nx), ny = fin(ev.ny), nz = fin(ev.nz);
  let l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(l > 1e-6)) {
    // normalna z położenia skały (kula) — fizyka jej nie podała
    const c = pirateRockCenterGame(_p);
    if (c) { nx = ev.x - c.x; ny = ev.y - c.y; nz = ev.z - c.z; l = Math.sqrt(nx * nx + ny * ny + nz * nz); }
    if (!(l > 1e-6)) { nx = 0; ny = 0; nz = 1; l = 1; }
  }
  e.nx = nx / l; e.ny = ny / l; e.nz = nz / l;
  e.speed = Math.max(0, fin(ev.speed));
  e.slide = Math.max(0, fin(ev.slide));
  e.mass = Math.max(0, fin(ev.mass));
  e.size = Math.max(1, fin(ev.size, 60));
  const v2 = e.speed * e.speed + e.slide * e.slide;
  e.energy = Math.max(0, fin(ev.energy, 0.5 * e.mass * v2));
  e.vx = fin(ev.vx); e.vy = fin(ev.vy); e.vz = fin(ev.vz);
  return true;
}

function burstOk(t) {
  const T = ROCK_IMPACT_TUNE;
  if (t - _burstT > T.burstWindow) { _burstT = t; _burstN = 0; }
  if (_burstN >= T.burstMax) { stats.burst++; return false; }
  _burstN++;
  return true;
}

function write(type, e) {
  if (!_writer) { stats.noSink++; return false; }
  const R = ROCK_IMPACT_REC;
  const o = _writer._begin(ROCK_IMPACT_CODE, R.WORDS);
  const d = _writer.ring.data;
  d[o + R.TYPE] = type;
  d[o + R.ID] = e.id;
  d[o + R.KIND] = rockBodyKindCode(e.kind);
  d[o + R.X] = e.x; d[o + R.Y] = e.y; d[o + R.Z] = e.z;
  d[o + R.NX] = e.nx; d[o + R.NY] = e.ny; d[o + R.NZ] = e.nz;
  d[o + R.SPEED] = e.speed; d[o + R.SLIDE] = e.slide;
  d[o + R.MASS] = e.mass; d[o + R.SIZE] = e.size; d[o + R.ENERGY] = e.energy;
  d[o + R.VX] = e.vx; d[o + R.VY] = e.vy; d[o + R.VZ] = e.vz;
  _writer._commit();
  stats.written++;
  return true;
}

/** Pierwszy (albo kolejny mocny) styk ciała ze skałą. Zwraca true, gdy rekord poszedł do obrazu. */
export function rockImpact(ev) {
  if (!normalize(ev)) { stats.invalid++; return false; }
  const e = _ev;
  const t = now();
  const T = ROCK_IMPACT_TUNE;
  const b = bodyOf(e.id, t);
  if (e.speed < T.minImpactSpeed && e.slide < T.minScrapeSlide) return rockSettleNorm(b, t);
  if (t - b.tI < T.impactGap && !(e.energy >= b.eI * T.impactBoost && e.energy > 0)) { stats.gapped++; return false; }
  if (!burstOk(t)) return false;
  b.tI = t; b.eI = e.energy; b.settled = false;
  b.tS = t;   // szorowanie zaraz po uderzeniu — jego kłąb i tak jest
  stats.impacts++;
  return write(ROCK_EVENT.IMPACT, e);
}

/** Szorowanie / toczenie ciała po powierzchni. */
export function rockScrape(ev) {
  if (!normalize(ev)) { stats.invalid++; return false; }
  const e = _ev;
  const t = now();
  const T = ROCK_IMPACT_TUNE;
  if (e.slide < T.minScrapeSlide) return false;
  const b = bodyOf(e.id, t);
  if (t - b.tS < T.scrapeGap) { stats.gapped++; return false; }
  if (!burstOk(t)) return false;
  b.tS = t; b.settled = false;
  stats.scrapes++;
  return write(ROCK_EVENT.SCRAPE, e);
}

function rockSettleNorm(b, t) {
  if (b.settled) return false;
  if (!burstOk(t)) return false;
  b.settled = true;
  stats.settles++;
  return write(ROCK_EVENT.SETTLE, _ev);
}

/** Ciało osiadło (raz — do następnego uderzenia albo szorowania). */
export function rockSettle(ev) {
  if (!normalize(ev)) { stats.invalid++; return false; }
  return rockSettleNorm(bodyOf(_ev.id, now()), now());
}

// ---------------------------------------------------------------------------------------------------------------
// Dev i narzędzia: zdarzenia w punkt powierzchni (e, n) bez fizyki.

/**
 * Zdarzenie w punkcie powierzchni (e, n) [j. po powierzchni od stopy windy]: o = { e, n, size, speed, slide, kind, mass,
 * dirE, dirN (kierunek poślizgu po powierzchni), lift, id }. Zwraca zdarzenie (w grze) albo null bez bazy.
 */
export function rockEventAt(o = {}) {
  const pl = _place ? _place() : null;
  if (!pl || typeof pl.toGame !== 'function') return null;
  const L = layout();
  const sp = L.surfacePoint(Number(o.e) || 0, Number(o.n) || 0, Number(o.lift) || 0, {});
  const g = pl.toGame(sp.x, sp.z, {});
  // kierunek bazy (x, z) → gra: ten sam obrót co toGame (bez przesunięcia)
  const ux = pl.u?.x ?? 1, uy = pl.u?.y ?? 0, vx = pl.n?.x ?? 0, vy = pl.n?.y ?? 1;
  const dirG = (dx, dz) => ({ x: ux * dx + vx * dz, y: uy * dx + vy * dz });
  const ng = dirG(sp.nx, sp.nz);
  // kierunek poślizgu: styczna (wschód / północ w punkcie) z dirE, dirN
  let sx = 0, sy = 0, sz = 0;
  const de = Number(o.dirE) || 0, dn = Number(o.dirN) || 0;
  if (de || dn) {
    const fr = L.frameAt(Number(o.e) || 0, Number(o.n) || 0, 0);
    const X = fr.X, Z = fr.Z;   // X — wschód', Z = X × N (prawoskrętnie; północ' = −Z)
    const bx = X[0] * de - Z[0] * dn, bh = X[1] * de - Z[1] * dn, bz = X[2] * de - Z[2] * dn;
    const bl = Math.sqrt(bx * bx + bh * bh + bz * bz) || 1;
    const dg = dirG(bx / bl, bz / bl);
    sx = dg.x; sy = dg.y; sz = bh / bl;
  }
  const slide = Math.max(0, Number(o.slide) || 0);
  const speed = Math.max(0, Number(o.speed ?? 1500));
  return {
    id: o.id ?? `test-${++_testSerial}`, kind: o.kind || 'tower', x: g.x, y: g.y, z: sp.h,
    nx: ng.x, ny: ng.y, nz: sp.nh, speed, slide, mass: Number(o.mass) || 0, size: Number(o.size) || 600,
    energy: Number(o.energy) || 0,
    vx: sx * slide - ng.x * speed, vy: sy * slide - ng.y * speed, vz: sz * slide - sp.nh * speed
  };
}

function testEvent(type, o) {
  const ev = rockEventAt(o);
  if (!ev) return null;
  if (type === ROCK_EVENT.IMPACT) rockImpact(ev);
  else if (type === ROCK_EVENT.SCRAPE) rockScrape(ev);
  else rockSettle(ev);
  return ev;
}

/** Zaplanuj zdarzenie za `delay` s czasu gry (krok: stepPirateRockImpacts). */
export function scheduleRockEvent(delay, type, o) {
  _sched.push({ t: now() + Math.max(0, Number(delay) || 0), type, o });
}

/** Krok (fizyka gry): zaplanowane zdarzenia testów / demo. */
export function stepPirateRockImpacts() {
  if (!_sched.length) return;
  const t = now();
  for (let i = _sched.length - 1; i >= 0; i--) {
    const s = _sched[i];
    if (s.t > t) continue;
    _sched.splice(i, 1);
    testEvent(s.type, s.o);
  }
}

/**
 * Scenariusz upadku (dev, zrzuty — bez fizyki orkiestratora): wieża w punkt (e0, n0), 8 sektorów dysku dookoła,
 * kawałki bębna, odłamy, szorowanie wieży i osiadanie. o = { e, n, scale }. Domyślny punkt: ślad promienia skały przez
 * habitat (bryła spadająca ku środkowi skały z płaszczyzny gry — φ = atan(5500 / 24000) ≈ 12,9° od stopy windy, e ≈ −3600).
 */
export function demoRockFall(o = {}) {
  const e0 = Number(o.e ?? -3600), n0 = Number(o.n ?? 0);
  const k = Number(o.scale) || 1;
  let r = 12345;
  const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  scheduleRockEvent(0, ROCK_EVENT.IMPACT, { e: e0, n: n0, kind: 'tower', size: 900 * k, speed: 1900, slide: 260, dirE: 1, dirN: 0.3, id: 'demo-tower' });
  for (let s = 1; s <= 10; s++) {
    scheduleRockEvent(0.25 * s, ROCK_EVENT.SCRAPE, { e: e0 + 70 * s, n: n0 + 20 * s, kind: 'tower', size: 700 * k, speed: 0, slide: 420 - 30 * s, dirE: 1, dirN: 0.3, id: 'demo-tower' });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const d = 1500 + 500 * rnd();
    scheduleRockEvent(0.7 + 0.35 * i + 0.4 * rnd(), ROCK_EVENT.IMPACT, {
      e: e0 + Math.cos(a) * d, n: n0 + Math.sin(a) * d, kind: 'disc', size: (520 + 160 * rnd()) * k, speed: 1100 + 500 * rnd(),
      slide: 200 * rnd(), dirE: Math.cos(a), dirN: Math.sin(a), id: `demo-disc-${i}`
    });
  }
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2, d = 900 + 2200 * rnd();
    scheduleRockEvent(1.8 + 2.4 * rnd(), ROCK_EVENT.IMPACT, {
      e: e0 + Math.cos(a) * d, n: n0 + Math.sin(a) * d, kind: 'drum', size: (220 + 180 * rnd()) * k, speed: 700 + 600 * rnd(),
      slide: 100 * rnd(), dirE: Math.cos(a), dirN: Math.sin(a), id: `demo-drum-${i}`
    });
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = 400 + 3800 * rnd();
    scheduleRockEvent(0.5 + 6 * rnd(), ROCK_EVENT.IMPACT, {
      e: e0 + Math.cos(a) * d, n: n0 + Math.sin(a) * d, kind: 'debris', size: (40 + 200 * rnd() * rnd()) * k,
      speed: 300 + 1200 * rnd(), slide: 150 * rnd(), dirE: Math.cos(a), dirN: Math.sin(a), id: `demo-debris-${i}`
    });
  }
  scheduleRockEvent(3.6, ROCK_EVENT.SETTLE, { e: e0 + 700, n: n0 + 200, kind: 'tower', size: 700 * k, speed: 0, id: 'demo-tower' });
  return true;
}

/** Konsola / narzędzia (index.html: window.PirateRockImpacts). */
export const PirateRockImpacts = {
  tune: ROCK_IMPACT_TUNE,
  stats,
  rockImpact,
  rockScrape,
  rockSettle,
  eventAt: rockEventAt,
  test: (o) => testEvent(ROCK_EVENT.IMPACT, o),
  testScrape: (o) => testEvent(ROCK_EVENT.SCRAPE, o),
  testSettle: (o) => testEvent(ROCK_EVENT.SETTLE, o),
  schedule: scheduleRockEvent,
  demo: (name = 'upadek', o = {}) => (name === 'upadek' ? demoRockFall(o) : false),
  center: () => pirateRockCenterGame({}),
  reset: resetPirateRockImpacts
};
