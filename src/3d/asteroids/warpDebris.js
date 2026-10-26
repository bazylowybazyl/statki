// src/3d/asteroids/warpDebris.js
//
// SKAŁY PASA W SKOKU (2026-10-19, user: „a co z resztą świata? asteroidy” → wybór „smugi skał”; przebudowa DECYZJE-2
// S1–S4, 2026-10-26 — user: „zwykłe rozciągnięcia”, „trzeba dodać odpychanie skał”). Prawdziwe pole pasa przy prędkości
// warpa nie nadąża (komórki doczytywane wokół kamery ~8–9 ms CPU na klatkę), więc w skoku (gwiazdy w smugach i kamera
// naprawdę leci — tryb skoku w AsteroidBelt._lightsStep) pas wyłącza pole, a ta warstwa rysuje skały w PRZESTRZENI
// WIDOCZNEJ warpa, jak ośrodek i gwiazdy:
//
//   • TRZY PASMA GŁĘBI (S1), każde we własnym pudle wokół kamery w osiach kursu (płytkie, szybkie skały naprawdę trafiają
//     w kadr): bliskie / środkowe / dalekie, pasmo = przedział PARALAKSY k = camZ / (camZ + głębokość) (głębokość
//     w jednostkach camZ — hierarchia warstw nie zależy od zoomu), dalekie większe. HIERARCHIA W0 (DECYZJE-2): na ekranie
//     gwiazdy deep < gwiazdy mid < skały < gwiazdy speed — przy przepływie `flowCap` · q tempo skały = flowCap · q · zoom · k,
//     gwiazdy = 14 tys. j/s (kamera gwiazd w warpie) · paralaksa · zoom; test `tests/warpDebrisLayers.test.mjs`.
//   • PRZEPŁYW Z PRAWDZIWEJ PRĘDKOŚCI (S1): q = udział tempa z prędkości kamery (log-liniowo `flowMinSpeed` →
//     `flowRefSpeed`, od `flowMin` do 1) — zwolnienie przy mijanej planecie widać (skały zwalniają i ślad się skraca),
//     a zakres q trzyma hierarchię (dalekie przy q min szybsze niż gwiazdy mid, bliskie przy q = 1 wolniejsze niż speed).
//   • BRYŁA (S1/S2): skała z krótkim rozmyciem ruchu (1–2 klatki — wariant `smear` materiału skał z wyglądem „bryła”),
//     poziom szczegółu z rozmiaru bryły z rozmyciem (RockSet.lodExtra), ŚLAD ŚWIATŁA osobno (warpTrails.js — jedna partia
//     kwadów: barwa oświetlonej strony skały, > 1 tylko tuż za bryłą — głowa ≤ pół promienia i ≤ 5% śladu, długość
//     z prawdziwej prędkości). Dawne wyglądy
//     „ślad” / „klin” (skała rozciągnięta w materiale) zostają do A/B (`WARP_DEBRIS_LOOKS`, demo — klawisz B, gra — `?smugi=`).
//   • DEFLEKTOR (S3, warpDeflector.js): w skoku gracza pole przed dziobem rozpycha skały pasm bliskiego i środkowego na boki
//     (opływ), przy bliskim przejściu — łuk HDR i fala refrakcji (fale pisze pas przez Core3D.fxDistortion).
//   • PAS JAKO ZDARZENIE TRASY (S4, wariant bez planu trasy): skała w przestrzeni widocznej u przed kamerą odpowiada
//     prawdziwemu punktowi kursu kamera + kurs · (v / przepływ) · u — ten punkt się nie rusza, gdy skała płynie. Gęstość
//     w nim z profilu pola pasa wzdłuż kursu (`WarpBeltTrack`, próbki leniwie co `profileStep` j., luki Kirkwooda i wyrwy
//     widać), więc pas, jego luki i pola rodzin NADLATUJĄ z przodu pudła i odpływają za rufę. Funkcja czysta
//     `warpBeltProfile` — do wpięcia z planem trasy (notatka AGENT: niżej).
// Bez alokacji na klatkę: rekordy skał w puli, lista rysowanych przepisywana w miejscu, tablice pasm stałe.

import { RockSet } from './rockLayers.js';
import { fxRandom } from '../fx/fxRandom.js';
import { ROCK_TYPE_INDEX, SHAPE_COUNT, ROCK_TYPE_LOOKS } from './rockMaterial.js';
import { WarpDeflector } from './warpDeflector.js';

export const WARP_DEBRIS = Object.freeze({
  // Pasma głębi: przedział paralaksy k (1 — płaszczyzna gry), pula i promienie skał [j.] (rozkład log, ku małym).
  bands: Object.freeze([
    Object.freeze({ id: 'blisko', cap: 80, kMin: 0.78, kMax: 0.96, rMin: 40, rMax: 260 }),
    Object.freeze({ id: 'srodek', cap: 90, kMin: 0.56, kMax: 0.78, rMin: 70, rMax: 560 }),
    Object.freeze({ id: 'daleko', cap: 90, kMin: 0.37, kMax: 0.56, rMin: 220, rMax: 1100 })
  ]),
  bandFloor: 0.35,     // udział puli w samym paśmie pasa (obwiednia 1, poza polami) × luka Kirkwooda × wyrwa
  minStretch: 0.05,    // smugi gwiazd, od których pas jest w trybie skoku
  flowCap: 14000,      // [j/s] przepływ przy q = 1 — kamera gwiazd w warpie (warpNurt.js: STAR_SPEED_CAP; gra podaje go
                       // na klatkę przez WARP_STAR_CAMERA.speedCap)
  flowMinSpeed: 30000, // [j/s] prędkość kamery, przy której q = flowMin (próg trybu skoku) …
  flowRefSpeed: 125000, // … i przy której q = 1 (przelot w pasie: 0,8 × przelot planu)
  flowMin: 0.55,       // najmniejszy udział tempa (dalekie skały wciąż szybsze niż gwiazdy mid — W0)
  boxMul: 1.12,        // zapas pudła pasma ponad kadr na jego najgłębszej warstwie
  minDensity: 0.01,    // poniżej — bez skał (poza pasem)
  bins: 6,             // przedziały pudła wzdłuż kursu (uzupełnianie braku)
  fillBelow: 0.5,      // przedział z liczbą < to × oczekiwane − 1 uzupełnia się …
  fillTo: 0.9,         // … do tylu × oczekiwane, w `fillTime` s
  fillTime: 0.35,      // [s]
  excessAbove: 1.3,    // pasmo z nadmiarem (> to × oczekiwane + 3) gasi skały z najbardziej przepełnionych przedziałów
  growTime: 0.25,      // [s] skała wyrasta
  fadeTime: 0.3,       // [s] skała nadmiaru maleje
  profileStep: 4000,   // [j.] krok profilu pasa wzdłuż kursu
  profileSize: 512,    // próbek w pamięci (pierścień)
  courseResetDeg: 1.5, // zmiana kursu, po której profil liczy się od nowa
  courseResetSide: 20000, // [j.] zejście kamery z linii kursu, po którym profil od nowa
  trailDepthDim: 0.35, // ślad dalekiej skały ciemniejszy (zamglenie z głębią jak skały tła)
  trailCap: 320        // śladów i łuków w partii
});

// WYGLĄD (uniformy materiału skał `smear` + partia śladów — przełączanie bez nowych pipeline'ów). `head` — rozmycie bryły
// [s ruchu widocznego], `taper` / `tail` / `fade` / `blur` / `sunMix` / `gain` — wariant smear (rockMaterial.js), `trail` —
// długość śladu światła [s przepływu przy q = 1, × q²: krótszy przy zwolnieniu], `trailW` — pół szerokości śladu / promień,
// `trailGain` — ogon (pod progiem bloomu), `trailHead` — głowa tuż za bryłą (HDR), `trailGlow` — najdłuższa głowa
// za brzegiem skały [× długość śladu; krótsza: pół promienia — HDR nie rośnie z wielkością skały], `trailTaper` — koniec / głowa,
// `lodBlur` — LOD z rozmiaru bryły: promień + to × rozmycie (dawne wyglądy 0 — LOD z głowy jak dawniej, A/B bez zmian).
// Domyślny „ślad światła” (decyzja użytkownika 2026-10-23) = bryła + osobny ślad (S2); „slad” i „klin” — dawne wyglądy
// (skała rozciągnięta w materiale, 2026-10-23) do A/B.
export const WARP_DEBRIS_LOOKS = Object.freeze({
  swiatlo: Object.freeze({ label: 'ślad światła — bryła z krótkim rozmyciem i osobny świetlny ślad od oświetlonej strony',
    head: 0.021, taper: 0.85, tail: 0.75, fade: 1.5, blur: 1.2, sunMix: 0.2, gain: 1.7,
    trail: 0.16, trailW: 0.42, trailGain: 1, trailHead: 5, trailGlow: 0.05, trailTaper: 0.3, lodBlur: 0.5 }),
  bryla: Object.freeze({ label: 'bryła — sama skała z krótkim rozmyciem ruchu (1–2 klatki), bez śladu',
    head: 0.021, taper: 0.85, tail: 0.75, fade: 1.5, blur: 1.2, sunMix: 0.2, gain: 1.7,
    trail: 0, trailW: 0, trailGain: 0, trailHead: 0, trailGlow: 0.05, trailTaper: 0.3, lodBlur: 0.5 }),
  slad: Object.freeze({ label: 'dawny ślad (A/B) — skała rozciągnięta w długi klin w materiale',
    head: 0.187, taper: 0.2, tail: 0.55, fade: 1, blur: 4.5, sunMix: 1, gain: 2,
    trail: 0, trailW: 0, trailGain: 0, trailHead: 0, trailGlow: 0.05, trailTaper: 0.3, lodBlur: 0 }),
  klin: Object.freeze({ label: 'dawny klin (A/B) — krótszy klin, wyraźna skała u czoła',
    head: 0.088, taper: 0.6, tail: 0.5, fade: 1.4, blur: 3, sunMix: 0.4, gain: 2.2,
    trail: 0, trailW: 0, trailGain: 0, trailHead: 0, trailGlow: 0.05, trailTaper: 0.3, lodBlur: 0 })
});
export const WARP_DEBRIS_LOOK_DEFAULT = 'swiatlo';

/** Wygląd z adresu strony (`?smugi=swiatlo|bryla|slad|klin`) albo null — gra i demo (adres przez RenderWorld). */
export function warpDebrisLookFromSearch(search) {
  const m = /[?&]smugi=([a-z]+)/.exec(typeof search === 'string' ? search : '');
  return m && WARP_DEBRIS_LOOKS[m[1]] ? m[1] : null;
}

// Paleta typów: wypełniacz kamienny i węglowy, widmowe C / S / M / V, rzadko ruda (wagi).
const TYPE_PALETTE = [
  [ROCK_TYPE_INDEX.rock, 3], [ROCK_TYPE_INDEX.rock_c, 3], [ROCK_TYPE_INDEX.carbon, 2],
  [ROCK_TYPE_INDEX.silicon, 1.5], [ROCK_TYPE_INDEX.metal, 0.8], [ROCK_TYPE_INDEX.basalt, 0.8],
  [ROCK_TYPE_INDEX.iron, 0.4], [ROCK_TYPE_INDEX.ice, 0.2]
].filter(([t]) => Number.isInteger(t));
const TYPE_TOTAL = TYPE_PALETTE.reduce((s, [, w]) => s + w, 0);

function pickType(u) {
  let a = u * TYPE_TOTAL;
  for (let i = 0; i < TYPE_PALETTE.length; i++) {
    a -= TYPE_PALETTE[i][1];
    if (a <= 0) return TYPE_PALETTE[i][0];
  }
  return TYPE_PALETTE[TYPE_PALETTE.length - 1][0];
}

// Barwa ŚLADU per typ (oświetlona strona): odcień albeda (baza z jasnym kolorem `c`, liniowo), jasność ściśnięta —
// ciemna węglowa nadal widoczna, jasny lód nie przepala (ogon pod progiem bloomu: ≤ ~0,6).
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function hexLin(hex, out, o) {
  const n = parseInt(String(hex).slice(1), 16);
  out[o] = srgbToLinear(((n >> 16) & 255) / 255);
  out[o + 1] = srgbToLinear(((n >> 8) & 255) / 255);
  out[o + 2] = srgbToLinear((n & 255) / 255);
}
export const WARP_TRAIL_TYPE_COLOR = (() => {
  const out = new Float32Array(Math.max(1, ROCK_TYPE_LOOKS.length) * 3);
  const a = new Float32Array(3);
  const b = new Float32Array(3);
  for (let i = 0; i < ROCK_TYPE_LOOKS.length; i++) {
    hexLin(ROCK_TYPE_LOOKS[i].base, a, 0);
    hexLin(ROCK_TYPE_LOOKS[i].c, b, 0);
    const r = a[0] * 0.65 + b[0] * 0.35;
    const g = a[1] * 0.65 + b[1] * 0.35;
    const bl = a[2] * 0.65 + b[2] * 0.35;
    const lum = Math.max(0.02, 0.2126 * r + 0.7152 * g + 0.0722 * bl);
    const k = (0.22 + 1.2 * lum) / lum;
    out[i * 3] = Math.min(0.8, r * k);
    out[i * 3 + 1] = Math.min(0.8, g * k);
    out[i * 3 + 2] = Math.min(0.8, bl * k);
  }
  return out;
})();

const smooth01 = (x) => { const t = x < 0 ? 0 : (x > 1 ? 1 : x); return t * t * (3 - 2 * t); };

/**
 * Gęstość skał 0..1 z makro-próbki pola pasa (sampleMacro): obwiednia pasa × `bandFloor` × luka Kirkwooda (`gap`)
 * × wyrwa (`hole`) — rzadki pas widać zawsze, luki i wyrwy rzedną — albo gęstość skał względem rdzenia pola pod
 * pierwiastkiem (pola rodzin i obrzeża — do pełnej puli).
 */
export function warpDebrisDensity(macro, maxDensity, bandFloor = WARP_DEBRIS.bandFloor) {
  const w = Math.max(0, Math.min(1, Number(macro?.weight) || 0));
  const gap = Number.isFinite(macro?.gap) ? Math.max(0, Math.min(1, macro.gap)) : 1;
  const hole = Number.isFinite(macro?.hole) ? Math.max(0, Math.min(1, macro.hole)) : 1;
  const d = (Number(macro?.density) || 0) * hole;
  const m = Math.max(1e-12, Number(maxDensity) || 0);
  const k = Math.max(w * bandFloor * gap * hole, Math.sqrt(Math.max(0, d) / m));
  return k > 1 ? 1 : k;
}

/**
 * Udział tempa przepływu q z prędkości kamery [j/s]: log-liniowo `flowMinSpeed` → `flowRefSpeed` od `flowMin` do 1
 * (poniżej / powyżej — granice). Przepływ widoczny = flowCap · q.
 */
export function warpDebrisFlowQ(speed, cfg = WARP_DEBRIS) {
  const v = Number(speed) || 0;
  const lo = cfg.flowMinSpeed;
  const hi = cfg.flowRefSpeed;
  if (!(v > lo)) return cfg.flowMin;
  if (v >= hi) return 1;
  return cfg.flowMin + (1 - cfg.flowMin) * Math.log(v / lo) / Math.log(hi / lo);
}

/**
 * Tempo pasm skał na ekranie [px/s] przy zoomie kadru (px / j.) i udziale q: [{ id, min, max }] — W0. Skała pasma
 * o paralaksie k jedzie flowCap · q · zoom · k (głębokość w jednostkach camZ — bez zależności od ogniskowej).
 */
export function warpDebrisLayerSpeeds(zoom, q, flowCap = WARP_DEBRIS.flowCap, cfg = WARP_DEBRIS) {
  const z = Number(zoom) || 0;
  const qq = Number(q) || 0;
  return cfg.bands.map((b) => ({ id: b.id, min: flowCap * qq * z * b.kMin, max: flowCap * qq * z * b.kMax }));
}

/**
 * PROFIL PASA WZDŁUŻ KURSU (S4, funkcja czysta): out[i] = gęstość skał (warpDebrisDensity) w punkcie
 * (x0, y0) + kurs · (start + i · step), z pola pasa obrazu (`sampleMacro` — to samo pole, którego używa AsteroidBelt).
 * AGENT: do wpięcia z planem trasy skoku (zespół T, DECYZJE-2 T2 — „przelot przez pas” w polach migawki / warp):
 * plan zna chwilę wejścia w pas przy kopie, więc profil całego odcinka (~150–250 próbek, ~0,5–1 ms raz na skok) da
 * akcenty dźwięku i kamery (wejście w pas, luka, pole rodziny) i pasmo pasa w soczewce z daleka; dziś warstwa liczy ten
 * sam profil leniwie z kursu (`WarpBeltTrack`) — wystarczy podać jej odcinek z planu (start, kurs) zamiast linii z kamery.
 */
export function warpBeltProfile(field, x0, y0, dirX, dirY, start, step, out, bandFloor = WARP_DEBRIS.bandFloor) {
  const n = out.length;
  const maxD = field.maxDensity;
  for (let i = 0; i < n; i++) {
    const s = start + i * step;
    out[i] = warpDebrisDensity(field.sampleMacro(x0 + dirX * s, y0 + dirY * s), maxD, bandFloor);
  }
  return out;
}

const NO_KEY = -2147483648;

/**
 * Profil pasa wzdłuż prostej kursu (S4): próbki co `profileStep` j. liczone LENIWIE (pierścień `profileSize`), odczyt
 * z interpolacją liniową. `reset(x0, y0, dirX, dirY)` — nowa prosta (start skoku, zmiana kursu).
 */
export class WarpBeltTrack {
  constructor(field, cfg = WARP_DEBRIS) {
    this.field = field;
    this.step = cfg.profileStep;
    this.size = cfg.profileSize;
    this.bandFloor = cfg.bandFloor;
    this.minDensity = cfg.minDensity;
    this.keys = new Int32Array(this.size).fill(NO_KEY);
    this.vals = new Float32Array(this.size);
    this.valid = false;
    this.x0 = 0; this.y0 = 0; this.dx = 1; this.dy = 0;
    this.samples = 0;
  }

  reset(x0, y0, dirX, dirY) {
    this.x0 = x0; this.y0 = y0; this.dx = dirX; this.dy = dirY;
    this.keys.fill(NO_KEY);
    this.valid = true;
  }

  invalidate() { this.valid = false; }

  _sample(i) {
    const slot = ((i % this.size) + this.size) % this.size;
    if (this.keys[slot] === i) return this.vals[slot];
    const s = i * this.step;
    let d = warpDebrisDensity(this.field.sampleMacro(this.x0 + this.dx * s, this.y0 + this.dy * s), this.field.maxDensity, this.bandFloor);
    if (d < this.minDensity) d = 0;
    this.keys[slot] = i;
    this.vals[slot] = d;
    this.samples++;
    return d;
  }

  /** Gęstość w odległości s [j.] od początku prostej (wzdłuż kursu). */
  at(s) {
    const x = s / this.step;
    const i0 = Math.floor(x);
    const t = x - i0;
    const a = this._sample(i0);
    return t > 1e-6 ? a + (this._sample(i0 + 1) - a) * t : a;
  }
}

const _defl = { w: 0, slope: 0, push: 0, weight: 0, X: 0, Y: 0, Yinf: 0, side: 1 };
const _glint = { x: 0, y: 0, tx: 0, ty: 0, nx: 0, ny: 0, half: 0, sag: 0, halfW: 0, I: 0 };

export class WarpDebris {
  /**
   * @param {object} o parent (grupa sceny — początek pul), layer (pass tła), bank, material (RockNodeMaterial z `smear`),
   *   field (pole pasa obrazu: sampleMacro, maxDensity), sunT (transmitancja słońca pola w punkcie), renderOrder;
   *   set — gotowy zestaw rysujący (testy bez GPU), inaczej RockSet pasa; trails — partia śladów (warpTrails.js) albo
   *   null (bez śladów); deflector — WarpDeflector (domyślnie nowy)
   */
  constructor({ parent, layer, bank, material, field, sunT = null, renderOrder = 2, config = null, set = null, trails = null, deflector = null }) {
    this.cfg = { ...WARP_DEBRIS, ...(config || {}) };
    const c = this.cfg;
    this.material = material;
    this.field = field;
    this.sunT = sunT || (() => 1);
    this.set = set || new RockSet({
      parent, layer, bank, material, renderOrder, perspective: true, zOf: (rock) => -rock.z,
      name: 'AsteroidBelt:warpDebris', maxLod: 3, sunT
    });
    this.set.setVisible(false);
    this.trails = trails;
    this.deflector = deflector || new WarpDeflector();
    this.track = new WarpBeltTrack(field, c);
    const nb = Math.max(1, c.bins | 0);
    this.rocks = [];
    this.bands = c.bands.map((b, index) => {
      const start = this.rocks.length;
      for (let i = 0; i < b.cap; i++) {
        this.rocks.push({
          alive: false, band: index, u: 0, w: 0, zk: 0, side: 0, hit: false, r0: 1, age: 0, dying: false, dieAge: 0,
          x: 0, y: 0, z: 0, r: 1, qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0,
          shape: 0, type: 0, seed: 0, phase: 0, sx: 1, sy: 1, sz: 1
        });
      }
      return {
        id: b.id, index, cap: b.cap, start, end: this.rocks.length,
        zk0: 1 / b.kMax - 1, zk1: 1 / b.kMin - 1, rMin: b.rMin, rMax: b.rMax,
        half: 1, acc: 0, live: 0, expected: 0,
        counts: new Int32Array(nb), exp: new Float32Array(nb), dmax: new Float32Array(nb),
        fill: new Float32Array(nb), filling: new Uint8Array(nb)
      };
    });
    this.list = [];
    this.active = false;
    this.density = 0;
    this._dirX = 1;
    this._dirY = 0;
    this._prevX = NaN;
    this._prevY = NaN;
    this.stats = { rocks: 0, density: 0, target: 0, speed: 0, q: 0, ratio: 0, trails: 0, glints: 0, pushed: 0, ripples: 0, profile: 0, bands: [0, 0, 0] };
    this.look = '';
    this._look = null;
    this.setLook(WARP_DEBRIS_LOOK_DEFAULT);
  }

  /** Wygląd (klucz WARP_DEBRIS_LOOKS) — uniformy materiału i partii śladów, bez nowych pipeline'ów. Zwraca klucz albo null. */
  setLook(name) {
    const L = WARP_DEBRIS_LOOKS[name];
    if (!L) return null;
    this.look = name;
    this._look = L;
    const sm = this.material && this.material.smear;
    if (sm) {
      for (const k of ['taper', 'tail', 'fade', 'blur', 'sunMix', 'gain']) if (sm[k]) sm[k].value = L[k];
    }
    if (this.trails && typeof this.trails.setLook === 'function') this.trails.setLook(L.trailGain, L.trailHead, L.trailTaper, L.trailGlow);
    return name;
  }

  /** Grupa siatek skał (rozgrzewka pasa — pass tła). */
  get group() { return this.set.group; }

  hide() {
    if (!this.active) return;
    this.active = false;
    for (let i = 0; i < this.rocks.length; i++) this.rocks[i].alive = false;
    for (let b = 0; b < this.bands.length; b++) {
      const B = this.bands[b];
      B.acc = 0;
      B.fill.fill(0);
      B.filling.fill(0);
    }
    this.list.length = 0;
    this.set.set(this.list);
    this.set.setVisible(false);
    if (this.trails) this.trails.hide();
    this.deflector.reset();
    this.track.invalidate();
    this.density = 0;
    this._prevX = NaN;
    this.stats.rocks = 0;
    this.stats.trails = 0;
    this.stats.glints = 0;
  }

  /**
   * Klatka trybu skoku. f: dt [s], camX, camY (kamera gry — świat), originX, originY (początek pul, świat gry),
   * frame (kadr pasa: cam.zoom, viewW, viewH, focalPx — RockSet), camSpeed [j/s] (prawdziwa prędkość kamery),
   * flowCap [j/s] (kamera gwiazd; 0 — `cfg.flowCap`), stretch (smugi gwiazd), lens (WARP_WORLD_LENS — skok gracza:
   * kurs, statek, kadłub, β; null — hipercruise), deflect (false — deflektor wyłączony), dirX, dirY — kurs (świat gry,
   * opcjonalnie; bez niego i bez soczewki z ruchu kamery).
   */
  update(f) {
    const c = this.cfg;
    const dt = Math.min(0.1, Math.max(0, Number(f.dt) || 0));
    const lens = f.lens && f.lens.active ? f.lens : null;
    // Kurs: soczewka skoku, podany albo z ruchu kamery (w skoku stabilny), ostatni ważny.
    if (lens && Number.isFinite(lens.velAngle)) {
      this._dirX = Math.cos(lens.velAngle);
      this._dirY = Math.sin(lens.velAngle);
    } else if (Number.isFinite(f.dirX) && Number.isFinite(f.dirY) && (f.dirX !== 0 || f.dirY !== 0)) {
      const l = Math.sqrt(f.dirX * f.dirX + f.dirY * f.dirY);
      this._dirX = f.dirX / l;
      this._dirY = f.dirY / l;
    } else if (Number.isFinite(this._prevX)) {
      const dx = f.camX - this._prevX;
      const dy = f.camY - this._prevY;
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l > 1) { this._dirX = dx / l; this._dirY = dy / l; }
    }
    this._prevX = f.camX;
    this._prevY = f.camY;
    const dirX = this._dirX;
    const dirY = this._dirY;
    const perpX = -dirY;
    const perpY = dirX;
    // Kadr: pół dłuższego boku w świecie (płaszczyzna gry), camZ kamery passa tła.
    const frame = f.frame;
    const zoom = Math.max(1e-5, Number(frame.cam.zoom) || 1);
    const focal = Math.max(1, Number(frame.focalPx) || 1);
    const camZ = focal / zoom;
    const halfView = Math.max(frame.viewW, frame.viewH) * 0.5 / zoom;
    // Przepływ z prawdziwej prędkości: q z prędkości kamery, przepływ = kamera gwiazd · q (nie szybszy niż kamera).
    const v = Math.max(0, Number(f.camSpeed) || 0);
    const q = warpDebrisFlowQ(v, c);
    const cap = Number(f.flowCap) > 0 ? Number(f.flowCap) : c.flowCap;
    let S = cap * q;
    if (v > 0 && v < S) S = v;
    const step = S * dt;
    // Skala drogi: j. prawdziwego kursu na j. przestrzeni widocznej (skała u przed kamerą = punkt kursu m · u przed nią).
    const m = S > 1 && v > S ? v / S : 1;
    this._trackCourse(f.camX, f.camY, dirX, dirY);
    const tr = this.track;
    const sc = (f.camX - tr.x0) * tr.dx + (f.camY - tr.y0) * tr.dy;
    const s0 = this.track.samples;
    this.deflector.frame(dt, lens, f.camX, f.camY, f.deflect !== false && !!lens, dirX, dirY);
    this.active = true;
    let target = 0;
    for (let b = 0; b < this.bands.length; b++) {
      const B = this.bands[b];
      B.half = halfView * (1 + B.zk1) * c.boxMul;
      this._stepBand(B, step, dt, sc, m);
      target += B.expected;
      this.stats.bands[b] = B.live;
    }
    this.density = tr.at(sc);
    // Rozmycie bryły i ślad: długości w świecie (perspektywa skraca je z głębią jak tempo).
    const L = this._look;
    const stretch = Math.min(1, Math.max(0, Number(f.stretch) || 0));
    const headLen = S * L.head * stretch;
    const trailLen = L.trail > 0 ? L.trail * S * q * stretch : 0;
    const trails = this.trails;
    if (trails) trails.begin();
    // Rekordy rysowane: świat = kamera + u · kurs + w′ · bok (w′ — po deflektorze); promień z wyrastania / gaśnięcia.
    const defl = this.deflector;
    const D = _defl;
    const list = this.list;
    list.length = 0;
    const ox = f.originX;
    const oy = f.originY;
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      if (!r.alive) continue;
      let s = smooth01(r.age / Math.max(1e-3, c.growTime));
      if (r.dying) s *= 1 - smooth01(r.dieAge / Math.max(1e-3, c.fadeTime));
      r.r = r.r0 * Math.max(1e-3, s);
      const k = 1 / (1 + r.zk);
      r.z = r.zk * camZ;
      defl.deflect(r.u, r.w, k, r.zk, r.side, D);
      r.side = D.side;
      if (defl.on && !r.dying) defl.touch(r, D, k, r.z, Math.max(0.6, Math.min(1.4, r.r0 / 260)));
      r.x = f.camX + r.u * dirX + D.w * perpX;
      r.y = f.camY + r.u * dirY + D.w * perpY;
      list.push(r);
      if (trails && trailLen > 0) {
        // Ślad do tyłu drogi skały: (1, dw/du) w osiach kursu → świat → scena (y w górę).
        let tu = 1;
        let tw = D.slope;
        const tl = Math.sqrt(tu * tu + tw * tw);
        tu /= tl; tw /= tl;
        const wx = tu * dirX + tw * perpX;
        const wy = tu * dirY + tw * perpY;
        const ti = r.type * 3;
        const sun = this.sunT(r.x, r.y);
        const dim = s * sun * (1 - c.trailDepthDim * Math.min(1, r.zk / 1.7));
        const col = WARP_TRAIL_TYPE_COLOR;
        trails.addTrail(r.x - ox, -(r.y - oy), -r.z, wx, -wy, trailLen, r.r * L.trailW, r.r / trailLen,
          col[ti] * dim, col[ti + 1] * dim, col[ti + 2] * dim);
      }
    }
    // Łuki deflektora (w głębokości skały, pod statkiem).
    if (trails && defl.on) {
      const G = _glint;
      const gc = defl.cfg.glintColor;
      for (let i = 0; i < defl.glints.length; i++) {
        const g = defl.glints[i];
        if (!g.alive) continue;
        defl.glintGeometry(g, G);
        if (!(G.I > 1e-3)) continue;
        // Strzałka na zewnątrz pola: po lewej stycznej w scenie (perp sceny = (ty, tx)) albo odwrotnie.
        const sign = (G.ty * G.nx - G.tx * G.ny) >= 0 ? 1 : -1;
        trails.addGlint(G.x - ox, -(G.y - oy), -g.z, G.tx, -G.ty, 2 * G.half, G.halfW, sign * G.sag,
          gc[0] * G.I, gc[1] * G.I, gc[2] * G.I);
      }
    }
    if (trails) trails.commit(focal, camZ);
    // Rozmycie bryły: wektor w scenie (y w górę) w stronę, z której skała nadleciała (+kurs).
    const sm = this.material && this.material.smear;
    if (sm) sm.vec.value.set(dirX * headLen, -dirY * headLen, 0);
    this.set.lodExtra = (L.lodBlur || 0) * headLen;
    this.set.setOrigin(ox, oy);
    this.set.set(list);
    if (!this.set.enabled) this.set.setVisible(true);
    this.set.update(frame);
    const st = this.stats;
    st.rocks = list.length;
    st.density = this.density;
    st.target = Math.round(target);
    st.speed = S;
    st.q = q;
    st.ratio = m;
    st.trails = trails ? trails.stats.trails : 0;
    st.glints = trails ? trails.stats.glints : 0;
    st.pushed = defl.stats.pushed;
    st.ripples = defl.stats.ripples;
    st.profile = this.track.samples - s0;
  }

  // Prosta kursu profilu: od nowa przy starcie, zmianie kursu albo zejściu kamery z linii (hipercruise skręca).
  _trackCourse(x, y, dx, dy) {
    const c = this.cfg;
    const tr = this.track;
    if (tr.valid) {
      const cross = dx * tr.dy - dy * tr.dx;
      const side = (x - tr.x0) * -tr.dy + (y - tr.y0) * tr.dx;
      const dot = dx * tr.dx + dy * tr.dy;
      if (dot > 0 && Math.abs(cross) < Math.sin(c.courseResetDeg * Math.PI / 180) && Math.abs(side) < c.courseResetSide) return;
    }
    tr.reset(x, y, dx, dy);
  }

  // Pasmo w klatce: przepływ, przedziały pudła (oczekiwana liczba z profilu), nadmiar, uzupełnienie, wlot z przodu.
  _stepBand(B, step, dt, sc, m) {
    const c = this.cfg;
    const rocks = this.rocks;
    const H = B.half;
    const nb = B.counts.length;
    const binW = 2 * H / nb;
    const counts = B.counts;
    counts.fill(0);
    let live = 0;
    for (let i = B.start; i < B.end; i++) {
      const r = rocks[i];
      if (!r.alive) continue;
      r.u -= step;
      r.age += dt;
      if (r.dying) r.dieAge += dt;
      if (r.u < -H || r.u > H * 1.5 || Math.abs(r.w) > H * 1.5 || (r.dying && r.dieAge >= c.fadeTime)) { r.alive = false; continue; }
      if (r.dying) continue;
      counts[this._bin(r.u, H, binW, nb)]++;
      live++;
    }
    // Oczekiwana liczba w przedziale: pula × średnia gęstość profilu w punktach kursu, które przedział przedstawia.
    const track = this.track;
    const exp = B.exp;
    const dmax = B.dmax;
    let expected = 0;
    for (let i = 0; i < nb; i++) {
      let sum = 0;
      let mx = 0;
      for (let j = 0; j < 3; j++) {
        const u = -H + (i + (j + 0.5) / 3) * binW;
        const d = track.at(sc + m * u);
        sum += d;
        if (d > mx) mx = d;
      }
      exp[i] = B.cap * sum / 3 / nb;
      dmax[i] = mx;
      expected += exp[i];
    }
    B.expected = expected;
    // Nadmiar (pasmo wyraźnie ponad oczekiwane — zwolnienie, wylot z pola): gasną skały z najbardziej przepełnionych
    // przedziałów (maleją `fadeTime`, bez znikania). Pojedyncze przedziały z losową nadwyżką nie gaszą niczego.
    if (live > expected * c.excessAbove + 3) {
      let extra = Math.round(live - expected);
      for (let pass = 0; pass < nb && extra > 0; pass++) {
        let worst = -1;
        let worstOver = 0.5;
        for (let i = 0; i < nb; i++) {
          const over = counts[i] - exp[i];
          if (over > worstOver) { worstOver = over; worst = i; }
        }
        if (worst < 0) break;
        let kill = Math.min(extra, Math.ceil(worstOver));
        for (let i = B.start; i < B.end && kill > 0; i++) {
          const r = rocks[i];
          if (!r.alive || r.dying || this._bin(r.u, H, binW, nb) !== worst) continue;
          r.dying = true;
          r.dieAge = 0;
          kill--;
          extra--;
          counts[worst]--;
          live--;
        }
        counts[worst] = Math.min(counts[worst], Math.floor(exp[worst]));
      }
    }
    // Uzupełnienie braku (start trybu, wlot w pole z boku, przyspieszenie): przedział poniżej `fillBelow` dobija do
    // `fillTo` oczekiwanego w `fillTime` s; miejsce w przedziale losowane z gęstością profilu (luka zostaje pusta).
    for (let i = 0; i < nb; i++) {
      if (!B.filling[i] && counts[i] < exp[i] * c.fillBelow - 1) B.filling[i] = 1;
      if (B.filling[i] && counts[i] >= exp[i] * c.fillTo) B.filling[i] = 0;
      if (!B.filling[i]) { B.fill[i] = 0; continue; }
      B.fill[i] += Math.max(0, exp[i] * c.fillTo - counts[i]) * (dt / Math.max(0.05, c.fillTime));
      let n = Math.floor(B.fill[i]);
      B.fill[i] -= n;
      const u0 = -H + i * binW;
      while (n-- > 0) {
        let u = u0 + fxRandom.next() * binW;
        let ok = false;
        for (let tries = 0; tries < 4 && !ok; tries++) {
          ok = fxRandom.next() * dmax[i] <= track.at(sc + m * u);
          if (!ok) u = u0 + fxRandom.next() * binW;
        }
        if (!ok) continue;
        if (!this._spawnIn(B, u, H)) break;
        counts[i]++;
        live++;
      }
    }
    // Wlot z przodu pudła: stan ustalony z gęstości w punkcie kursu, który przód pudła przedstawia (pas nadlatuje).
    const dF = track.at(sc + m * H);
    B.acc += B.cap * dF * step / (2 * H);
    let n = Math.floor(B.acc);
    B.acc -= n;
    while (n-- > 0) {
      if (!this._spawnIn(B, H - fxRandom.next() * step, H)) { B.acc = 0; break; }
      live++;
    }
    B.live = live;
  }

  _bin(u, H, binW, nb) {
    const i = Math.floor((u + H) / binW);
    return i < 0 ? 0 : (i >= nb ? nb - 1 : i);
  }

  // Wolny rekord pasma → nowa skała w u (bok, głębokość, kształt i typ losowe). false — pula pasma pełna.
  _spawnIn(B, u, H) {
    const rocks = this.rocks;
    for (let i = B.start; i < B.end; i++) {
      const r = rocks[i];
      if (r.alive) continue;
      this._spawn(r, B, u, H);
      return true;
    }
    return false;
  }

  // Nowa skała: oś kursu u, bok i głębia (w paśmie) losowe, kształt i typ z banku / palety, obrót stały, wolny spin.
  _spawn(r, B, u, H) {
    r.alive = true;
    r.dying = false;
    r.dieAge = 0;
    r.age = 0;
    r.hit = false;
    r.u = u;
    r.w = (fxRandom.next() * 2 - 1) * H;
    r.side = 0;   // strona w deflektorze — ustala ją wejście w działające pole (znak Y∞), nie losowanie
    r.zk = B.zk0 + (B.zk1 - B.zk0) * fxRandom.next();
    r.r0 = B.rMin * Math.pow(B.rMax / B.rMin, fxRandom.next() * fxRandom.next());
    r.r = r.r0 * 1e-3;
    // losowy obrót (jednostkowy kwaternion z trzech losowań — Shoemake)
    const u1 = fxRandom.next();
    const u2 = fxRandom.next() * Math.PI * 2;
    const u3 = fxRandom.next() * Math.PI * 2;
    const a = Math.sqrt(1 - u1);
    const b = Math.sqrt(u1);
    r.qx = a * Math.sin(u2); r.qy = a * Math.cos(u2); r.qz = b * Math.sin(u3); r.qw = b * Math.cos(u3);
    const th = fxRandom.next() * Math.PI * 2;
    const ph = Math.acos(fxRandom.next() * 2 - 1);
    r.ax = Math.sin(ph) * Math.cos(th); r.ay = Math.sin(ph) * Math.sin(th); r.az = Math.cos(ph);
    r.spin = (fxRandom.next() - 0.5) * 0.4;
    r.shape = Math.min(SHAPE_COUNT - 1, Math.floor(fxRandom.next() * SHAPE_COUNT));
    r.type = pickType(fxRandom.next());
    r.seed = fxRandom.next() * 1000;
    r.phase = fxRandom.next() * Math.PI * 2;
    r.sx = 0.85 + fxRandom.next() * 0.35;
    r.sy = 0.85 + fxRandom.next() * 0.35;
    r.sz = 0.8 + fxRandom.next() * 0.3;
  }
}
