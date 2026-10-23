// src/3d/asteroids/warpDebris.js
//
// SMUGI SKAŁ PASA W SKOKU (2026-10-19, user: „a co z resztą świata? asteroidy” → wybór „smugi skał”). Prawdziwe pole
// pasa przy prędkości warpa (~200 tys. j/s) nie nadąża: komórki doczytywane wokół kamery (~8–9 ms CPU na klatkę,
// setki komórek w kolejce), w kadrze kilka migających skał, a maska zacienienia pola ze starego okna czerniła kadłub.
// W skoku (gwiazdy w smugach: WARP_STARS.stretch > minStretch, a kamera naprawdę leci — próg prędkości z histerezą
// w AsteroidBelt._lightsStep; w ładowaniu statek stoi i pole zostaje) pas wyłącza pole, a ta
// warstwa rysuje skały w PRZESTRZENI WIDOCZNEJ warpa — jak ośrodek i gwiazdy: pula skał w pudle wokół kamery płynie
// wzdłuż kursu z prędkością kamery gwiazd (WARP_STAR_CAMERA.speedCap), pod płaszczyzną gry w passie tła (perspektywa —
// głębsze wolniej: paralaksa), każda rozciągnięta w smugę (wariant materiału skał `smear`: tylna półkula przesunięta
// wzdłuż kursu o drogę z czasu naświetlania). Gęstość z pola pasa w punkcie kamery (sampleMacro: obwiednia pasa daje
// minimum — pas widać zawsze, pola rodzin i ich obrzeża dobijają do pełnej puli), wygładzona w czasie: statek przecina
// pas w ~1 s prawdziwego lotu, a przepływ widoczny przechodzi przez pudło w ~3,5 s — braki uzupełniają się w całym pudle
// (skała wyrasta w ~0,25 s), stan ustalony — z przodu pudła (pas „nadlatuje”), nadmiar gaśnie (skała maleje ~0,3 s).
// Kształty z banku pasa, typy z palety pasa, materiał tła (słońce pasa, zamglenie z głębią, transmitancja pola).
// Bez alokacji na klatkę: rekordy skał w puli, lista rysowanych przepisywana w miejscu.

import { RockSet } from './rockLayers.js';
import { fxRandom } from '../fx/fxRandom.js';
import { ROCK_TYPE_INDEX, SHAPE_COUNT } from './rockMaterial.js';

export const WARP_DEBRIS = Object.freeze({
  cap: 360,            // pula skał (pełne pole rodziny)
  bandFloor: 0.35,     // udział puli w samym paśmie pasa (obwiednia 1, poza polami)
  depthMin: 2500,      // [j.] pod płaszczyzną gry — najpłytsza skała
  depthMax: 24000,     // [j.] najgłębsza (paralaksa: ~⅓ prędkości ekranu płytkiej)
  rMin: 70,            // [j.] promień skały (rozkład logarytmiczny)
  rMax: 800,
  exposure: 0.055,     // [s] czas naświetlania smugi: długość = prędkość × to × mnożnik wyglądu (WARP_DEBRIS_LOOKS)
  minStretch: 0.05,    // smugi gwiazd, od których pas jest w trybie skoku
  speedFallback: 14000, // [j/s] przepływ, gdy kamera gwiazd nie ma limitu
  boxMul: 1.12,        // zapas pudła ponad kadr na najgłębszej warstwie
  minDensity: 0.01,    // poniżej — bez skał (poza pasem)
  riseTau: 0.12,       // [s] gęstość rośnie (wlot w pas)
  fallTau: 0.8,        // [s] gęstość gaśnie (wylot — pas „zostaje” jeszcze chwilę)
  fillTime: 0.35,      // [s] uzupełnienie braku w całym pudle
  growTime: 0.25,      // [s] skała wyrasta
  fadeTime: 0.3        // [s] skała nadmiaru maleje
});

// WYGLĄD SMUGI (2026-10-23, user: „słabo się rozciągają, potrzebny lepszy wygląd”): uniformy wariantu `smear`
// materiału skał (rockMaterial.js) — przełączanie bez nowych pipeline'ów. `length` — mnożnik długości (× prędkość ×
// `exposure`), `taper` — koniec smugi / promień skały, `tail` — krycie ogona za skałą (głowa pełna), `fade` — wykładnik
// zaniku alfy, `blur` — mipy tekstur w ogonie, `sunMix` — normalna ogona ku słońcu, `gain` — jasność skały. Dawny
// wygląd (2026-10-19): kapsuła — długość × 1, bez zwężenia i rozmycia, alfa ogona 1 → 0,3 (pełna szara „pałka”).
export const WARP_DEBRIS_LOOKS = Object.freeze({
  slad: Object.freeze({ label: 'ślad światła — długi, cienki ogon od oświetlonej strony, jaśniejsza głowa', length: 3.4, taper: 0.2, tail: 0.55, fade: 1, blur: 4.5, sunMix: 1, gain: 2 }),
  klin: Object.freeze({ label: 'klin — krótszy ślad, wyraźna oświetlona skała u czoła', length: 1.6, taper: 0.6, tail: 0.5, fade: 1.4, blur: 3, sunMix: 0.4, gain: 2.2 })
});
export const WARP_DEBRIS_LOOK_DEFAULT = 'slad';

// Paleta typów smug: wypełniacz kamienny i węglowy, widmowe C / S / M / V, rzadko ruda (wagi).
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

const smooth01 = (x) => { const t = x < 0 ? 0 : (x > 1 ? 1 : x); return t * t * (3 - 2 * t); };

/**
 * Gęstość smug 0..1 z makro-próbki pola pasa (sampleMacro): obwiednia pasa × `bandFloor` (rzadki pas główny — pas widać
 * zawsze), gęstość skał względem rdzenia pola pod pierwiastkiem (pola rodzin i obrzeża — do pełnej puli).
 */
export function warpDebrisDensity(macro, maxDensity, bandFloor = WARP_DEBRIS.bandFloor) {
  const w = Math.max(0, Math.min(1, Number(macro?.weight) || 0));
  const d = Number(macro?.density) || 0;
  const m = Math.max(1e-12, Number(maxDensity) || 0);
  const k = Math.max(w * bandFloor, Math.sqrt(Math.max(0, d) / m));
  return k > 1 ? 1 : k;
}

export class WarpDebris {
  /**
   * @param {object} o parent (grupa sceny — początek pul), layer (pass tła), bank, material (RockNodeMaterial z `smear`),
   *   field (pole pasa obrazu: sampleMacro, maxDensity), sunT (transmitancja słońca pola w punkcie), renderOrder;
   *   set — gotowy zestaw rysujący (testy bez GPU), inaczej RockSet pasa
   */
  constructor({ parent, layer, bank, material, field, sunT = null, renderOrder = 2, config = null, set = null }) {
    this.cfg = { ...WARP_DEBRIS, ...(config || {}) };
    this.material = material;
    this.field = field;
    this.set = set || new RockSet({
      parent, layer, bank, material, renderOrder, perspective: true, zOf: (rock) => -rock.z,
      name: 'AsteroidBelt:warpDebris', maxLod: 3, sunT
    });
    this.set.setVisible(false);
    this.rocks = [];
    for (let i = 0; i < this.cfg.cap; i++) {
      this.rocks.push({
        alive: false, u: 0, w: 0, r0: 1, age: 0, dying: false, dieAge: 0,
        x: 0, y: 0, z: 0, r: 1, qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0,
        shape: 0, type: 0, seed: 0, phase: 0, sx: 1, sy: 1, sz: 1
      });
    }
    this.list = [];
    this.active = false;
    this.density = 0;
    this._spawnAcc = 0;
    this._dirX = 1;
    this._dirY = 0;
    this._prevX = NaN;
    this._prevY = NaN;
    this.stats = { rocks: 0, density: 0, target: 0, speed: 0 };
    this.look = '';
    this._lookLength = 1;
    this.setLook(WARP_DEBRIS_LOOK_DEFAULT);
  }

  /** Wygląd smugi (klucz WARP_DEBRIS_LOOKS) — uniformy materiału, bez nowych pipeline'ów. Zwraca klucz albo null. */
  setLook(name) {
    const L = WARP_DEBRIS_LOOKS[name];
    if (!L) return null;
    this.look = name;
    this._lookLength = L.length;
    const sm = this.material && this.material.smear;
    if (sm) {
      for (const k of ['taper', 'tail', 'fade', 'blur', 'sunMix', 'gain']) if (sm[k]) sm[k].value = L[k];
    }
    return name;
  }

  /** Grupa siatek (rozgrzewka pasa — pass tła). */
  get group() { return this.set.group; }

  hide() {
    if (!this.active) return;
    this.active = false;
    for (let i = 0; i < this.rocks.length; i++) this.rocks[i].alive = false;
    this.list.length = 0;
    this.set.set(this.list);
    this.set.setVisible(false);
    this._spawnAcc = 0;
    this.density = 0;
    this._prevX = NaN;
    this.stats.rocks = 0;
  }

  /**
   * Klatka trybu skoku. f: dt [s], camX, camY (kamera gry — świat), originX, originY (początek pul, świat gry),
   * frame (kadr pasa: cam.zoom, viewW, viewH, focalPx — RockSet), speed [j/s] przepływu, stretch (smugi gwiazd),
   * dirX, dirY — kurs (świat gry, opcjonalnie; bez niego z ruchu kamery).
   */
  update(f) {
    const c = this.cfg;
    const dt = Math.min(0.1, Math.max(0, Number(f.dt) || 0));
    // Kurs: podany albo z ruchu kamery (w skoku stabilny), ostatni ważny.
    if (Number.isFinite(f.dirX) && Number.isFinite(f.dirY) && (f.dirX !== 0 || f.dirY !== 0)) {
      const l = Math.hypot(f.dirX, f.dirY);
      this._dirX = f.dirX / l;
      this._dirY = f.dirY / l;
    } else if (Number.isFinite(this._prevX)) {
      const dx = f.camX - this._prevX;
      const dy = f.camY - this._prevY;
      const l = Math.hypot(dx, dy);
      if (l > 1) { this._dirX = dx / l; this._dirY = dy / l; }
    }
    this._prevX = f.camX;
    this._prevY = f.camY;
    const dirX = this._dirX;
    const dirY = this._dirY;
    const perpX = -dirY;
    const perpY = dirX;
    // Pudło w osiach kursu: pół kadru na najgłębszej warstwie (perspektywa), dłuższy bok — obrót kadru bez znaczenia.
    const frame = f.frame;
    const zoom = Math.max(1e-5, Number(frame.cam.zoom) || 1);
    const focal = Math.max(1, Number(frame.focalPx) || 1);
    const camZ = focal / zoom;
    const spread = (camZ + c.depthMax) / camZ;
    const half = Math.max(frame.viewW, frame.viewH) * 0.5 / zoom * spread * c.boxMul;
    const speed = Math.max(0, Number(f.speed) || c.speedFallback);
    // Gęstość w punkcie kamery, wygładzona w czasie (szybki wlot, wolny wylot) → docelowa liczba skał.
    const macro = this.field.sampleMacro(f.camX, f.camY);
    const want = warpDebrisDensity(macro, this.field.maxDensity, c.bandFloor);
    const tau = want > this.density ? c.riseTau : c.fallTau;
    this.density += (want - this.density) * (dt > 0 ? 1 - Math.exp(-dt / tau) : 0);
    const dens = this.density;
    const target = dens > c.minDensity ? Math.round(c.cap * dens) : 0;
    this.active = true;
    const rocks = this.rocks;
    const step = speed * dt;
    let live = 0;
    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i];
      if (!r.alive) continue;
      r.u -= step;
      r.age += dt;
      if (r.dying) r.dieAge += dt;
      if (r.u < -half || (r.dying && r.dieAge >= c.fadeTime)) { r.alive = false; continue; }
      if (!r.dying) live++;
    }
    // Nadmiar (wylot z pola): gasną skały od tyłu pudła (najbliżej wyjścia).
    if (live > target) {
      let extra = live - target;
      for (let i = 0; i < rocks.length && extra > 0; i++) {
        const r = rocks[i];
        if (!r.alive || r.dying || r.u > 0) continue;
        r.dying = true;
        r.dieAge = 0;
        extra--;
        live--;
      }
    }
    // Uzupełnienie: stan ustalony z przodu pudła (wlot), brak — w całym pudle w `fillTime` s.
    const deficit = Math.max(0, target - live);
    this._spawnAcc += target * step / (2 * half) + deficit * (dt / Math.max(0.05, c.fillTime));
    let spawn = Math.min(deficit, Math.floor(this._spawnAcc));
    this._spawnAcc -= Math.floor(this._spawnAcc);
    const fillShare = target > 0 ? Math.min(1, deficit / target) : 0;
    for (let i = 0; i < rocks.length && spawn > 0; i++) {
      const r = rocks[i];
      if (r.alive) continue;
      const u = fxRandom.next() < fillShare ? (fxRandom.next() * 2 - 1) * half : half - fxRandom.next() * step;
      this._spawn(r, u, half);
      spawn--;
    }
    // Rekordy rysowane: świat = kamera + u · kurs + w · bok; promień z wyrastania / gaśnięcia.
    const list = this.list;
    list.length = 0;
    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i];
      if (!r.alive) continue;
      let s = smooth01(r.age / Math.max(1e-3, c.growTime));
      if (r.dying) s *= 1 - smooth01(r.dieAge / Math.max(1e-3, c.fadeTime));
      r.r = r.r0 * Math.max(1e-3, s);
      r.x = f.camX + r.u * dirX + r.w * perpX;
      r.y = f.camY + r.u * dirY + r.w * perpY;
      list.push(r);
    }
    // Smuga: wektor w scenie (y w górę) w stronę, z której skała nadleciała (+kurs), długość = prędkość × naświetlanie.
    const stretch = Math.min(1, Math.max(0, Number(f.stretch) || 0));
    const len = speed * c.exposure * this._lookLength * stretch;
    this.material.smear.vec.value.set(dirX * len, -dirY * len, 0);
    this.set.setOrigin(f.originX, f.originY);
    this.set.set(list);
    if (!this.set.enabled) this.set.setVisible(true);
    this.set.update(frame);
    const st = this.stats;
    st.rocks = list.length;
    st.density = dens;
    st.target = target;
    st.speed = speed;
  }

  // Nowa skała: oś kursu u, bok i głębia losowe, kształt i typ z banku / palety, obrót stały, wolny spin.
  _spawn(r, u, half) {
    const c = this.cfg;
    r.alive = true;
    r.dying = false;
    r.dieAge = 0;
    r.age = 0;
    r.u = u;
    r.w = (fxRandom.next() * 2 - 1) * half;
    r.z = c.depthMin + (c.depthMax - c.depthMin) * fxRandom.next();
    r.r0 = c.rMin * Math.pow(c.rMax / c.rMin, fxRandom.next() * fxRandom.next());
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
