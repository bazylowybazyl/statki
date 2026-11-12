// src/3d/warp/frame.js
//
// Stan klatki warpa „Nurt” (odpowiednik `newFrame` z dema, dema/warp-webgpu/scenes.js)
// bez alokacji na klatkę: listy to pule obiektów wielokrotnego użytku, a przegródki
// ośrodka (bańki, nić zwiastuna, pchnięcia) należą do właścicieli (gracz, przylot,
// odlot) — tożsamość obiektu trzyma stały indeks przegródki na GPU przez całe jej życie.
//
// UKŁAD: pozycje w ŚWIECIE GRY (x w prawo, y w dół, kąt jak w grze), ale WZGLĘDEM
// KAMERY („rel”) — sterownik (warpNurt.js) sam wie, czy dany efekt stoi w świecie
// (przylot NPC: rel = pozycja − kamera), czy w przestrzeni widocznej warpa (kop przy
// skoku gracza: rel = punkt ośrodka − kamera ośrodka). Na GPU idą małe liczby.

import { newSparkRecord } from './sparkRecipes.js';

/** Nowa przegródka ośrodka (bańka / nić zwiastuna / punkt zbierania / pchnięcie). */
export function newWarpSlot() {
  return {
    on: false, x: 0, y: 0, angle: 0, vx: 0, vy: 0, R: 1000, asp: 1.35, A: 0, front: 3,
    strain: 0, turb: 0.12, pullR: 1, pullGain: 0, jetSpeed: 0, heraldLen: 0, heraldGain: 0,
    excite: 1, releaseT: Infinity, rearT: Infinity, lensAmp: 0,
    // jednorazowe znaczniki kroku (ustawia sterownik z releaseT / rearT)
    release: false, rear: false, _stamp: 0
  };
}

/**
 * Tylko przegródki w zasięgu ośrodka (ośrodek istnieje wyłącznie w pudle wokół
 * kamery — medium.js: setBoxes): reszta wypada z klatki, więc zdarzenie poza kadrem (przylot
 * pirata daleko) nie budzi ośrodka — ani kroku compute, ani draw calla. Zasięg przegródki
 * 4,6 R·asp (pętla baniek w kernelu), w głąb tyle samo — pudło na tej głębokości jest
 * szersze o paralaksę: pół-wymiar = (px / ogniskowa)·(kamera + zasięg)·1,18.
 * Pozycje względem kamery (rel). Bez alokacji: kompakcja w miejscu.
 * @param {WarpFrame} frame
 * @param {number} halfPxX, halfPxY — połowa celu renderu [px]; focal — ogniskowa [px];
 *   camZ — odległość kamery perspektywy od płaszczyzny gry [j.]
 */
export function cullWarpFrameToView(frame, halfPxX, halfPxY, focal, camZ) {
  const kx = (halfPxX / focal) * 1.18;
  const ky = (halfPxY / focal) * 1.18;
  const list = frame.bubbles;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const reach = 4.6 * b.R * Math.max(1, b.asp);
    let px = b.x;
    let py = b.y;
    let r = reach;
    if (b.heraldLen > 1) {
      // Nić zwiastuna: najbliższy kamerze punkt odcinka (x, y) → + oś · heraldLen.
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      const u = Math.max(0, Math.min(b.heraldLen, -(b.x * c + b.y * s)));
      px = b.x + c * u;
      py = b.y + s * u;
      r = Math.max(reach, 3 * (b.pullR || 0));
    }
    const hx = kx * (camZ + r) + r;
    const hy = ky * (camZ + r) + r;
    if (Math.abs(px) < hx && Math.abs(py) < hy) list[n++] = b;
  }
  list.length = n;
}

class Pool {
  constructor(cap, make) {
    this.items = Array.from({ length: cap }, make);
    this.count = 0;
  }

  reset() { this.count = 0; }

  /** Następny obiekt puli albo null (pula pełna — efekt pominięty w tej klatce). */
  add() { return this.count < this.items.length ? this.items[this.count++] : null; }
}

// Szczeliny, szwy i smugi sylwetki (dawne addRift / addSeam / addSeamLens / addSmear, duszki RiftSprites / SmearPool)
// usunięte w sprzątaniu S1 nowego warpa (2026-10-26) — nikt ich nie karmił od przylotów NPC bez szczelin (2026-10-03).
// Implozja i soczewka bańki jako fale (style 'akcent' / 'soczewka') — też (jeden warp). Materiały ośrodka i mgławicy
// mają dalej bloki szczelin (medium.js: setSeams, skyBend.js) — zmiana ich WGSL to osobna decyzja (C2); liczniki 0.
// Smugi (`streaks`, prototyp przylotu i wylotu „jak w Gwiezdnych Wojnach” — `?warpSW=1`, warpSW.js): kształt GLOW_STREAK
// duszków; ≥ 48 miejsc (scena „Wojna”: 45 okrętów co 0,12 s), smugi spoza kadru odcinane przy zgłoszeniu.
// Drobiny przylotu i odlotu NPC (`sparks` — rekordy emisji, sparkRecipes.js / sparks.js): do 3 rekordów na okręt.
export const WARP_FRAME_CAPS = Object.freeze({
  bubbles: 16, lens: 8, waves: 24, flashes: 64, glares: 16, streaks: 64, sparks: 128
});

export class WarpFrame {
  constructor(caps = WARP_FRAME_CAPS) {
    this.caps = caps;
    // Przegródki ośrodka: referencje do obiektów właścicieli (kolejność = kolejność zgłoszeń).
    this.bubbles = [];
    // Zgięcie tła: soczewka bańki (tylko mgławica — hipercruise, warp gracza z `?warpOsrodek=1`).
    this.lens = new Pool(caps.lens, () => ({ x: 0, y: 0, angle: 0, a: 0, b: 0, amp: 0, front: 3 }));
    // Fale (przezroczysta refrakcja całej klatki — źródła zniekształceń Core3D: shock).
    this.waves = new Pool(caps.waves, () => ({ x: 0, y: 0, r: 0, width: 0, amp: 0 }));
    // Błyski (okrągłe) i poprzeczne linie blasku.
    this.flashes = new Pool(caps.flashes, () => ({ x: 0, y: 0, size: 0, k: 0, pal: null, raw: false }));
    this.glares = new Pool(caps.glares, () => ({ x: 0, y: 0, angle: 0, len: 0, k: 0, pal: null }));
    // Smugi (`?warpSW=1`): głowa (x, y), kierunek (jednostkowy), długość wstecz od głowy, szerokość, barwa HDR.
    this.streaks = new Pool(caps.streaks || 64, () => ({ x: 0, y: 0, dirX: 1, dirY: 0, len: 0, width: 0, r: 0, g: 0, b: 0 }));
    // Drobiny przylotu i odlotu NPC: rekordy emisji (tor każdej drobiny ze wzoru — sparks.js); pełna pula — rekord pominięty.
    this.sparks = new Pool(caps.sparks || 128, newSparkRecord);
    // Kadr do odcinania smug (pół-wymiary pudła osi świata wokół kamery [j.] — ustawia sterownik co klatkę po reset).
    this.streakView = { on: false, hw: 0, hh: 0 };
    // Gwiazdy (rozciąganie płaskie, front wyjścia) — z gracza.
    this.stars = { stretch: 0, angle: 0, frontOn: 0, frontS: 0, warpTint: 0, refX: 0, refY: 0 };
    this.warpVis = 0;       // poświata rzadkich drobin w ruchu (skok gracza)
    this.mediumFade = 0;    // [1/s] gaszenie całego ośrodka (po wyjściu z warpa)
  }

  reset() {
    this.bubbles.length = 0;
    this.lens.reset();
    this.waves.reset();
    this.flashes.reset();
    this.glares.reset();
    this.streaks.reset();
    this.sparks.reset();
    this.streakView.on = false;
    const st = this.stars;
    st.stretch = 0; st.frontOn = 0; st.frontS = 0; st.warpTint = 0;
    this.warpVis = 0;
    this.mediumFade = 0;
  }

  pushBubble(slot) {
    if (slot && this.bubbles.length < this.caps.bubbles) this.bubbles.push(slot);
  }

  addWave(x, y, r, width, amp) {
    const w = this.waves.add();
    if (!w) return;
    w.x = x; w.y = y; w.r = r; w.width = width; w.amp = amp;
  }

  addFlash(x, y, size, k, pal, raw = false) {
    const f = this.flashes.add();
    if (!f) return;
    f.x = x; f.y = y; f.size = size; f.k = k; f.pal = pal; f.raw = raw;
  }

  addGlare(x, y, angle, len, k, pal) {
    const g = this.glares.add();
    if (!g) return;
    g.x = x; g.y = y; g.angle = angle; g.len = len; g.k = k; g.pal = pal;
  }

  /** Kadr odcinania smug: pół-wymiary pudła osi świata wokół kamery [j.] (≤ 0 — bez odcinania). */
  setStreakView(hw, hh) {
    const v = this.streakView;
    v.on = hw > 0 && hh > 0;
    v.hw = v.on ? hw : 0;
    v.hh = v.on ? hh : 0;
  }

  /**
   * Smuga (`?warpSW=1`): głowa (hx, hy) względem kamery, kierunek (dirX, dirY) — smuga ciągnie się `len` [j.] WSTECZ od
   * głowy, szerokość [j.], barwa HDR (r, g, b). Smuga poza kadrem (pudło z setStreakView + szerokość) nie zajmuje miejsca
   * w puli. Zwraca true, gdy dodana.
   */
  addStreak(hx, hy, dirX, dirY, len, width, r, g, b) {
    if (!(len > 0) || !(width > 0)) return false;
    if (!(r > 0.0005 || g > 0.0005 || b > 0.0005)) return false;
    const l = Math.sqrt(dirX * dirX + dirY * dirY);
    if (!(l > 1e-9)) return false;
    const dx = dirX / l;
    const dy = dirY / l;
    const v = this.streakView;
    if (v.on) {
      const tx = hx - dx * len;
      const ty = hy - dy * len;
      const m = width;
      if (Math.max(hx, tx) + m < -v.hw || Math.min(hx, tx) - m > v.hw
        || Math.max(hy, ty) + m < -v.hh || Math.min(hy, ty) - m > v.hh) return false;
    }
    const s = this.streaks.add();
    if (!s) return false;
    s.x = hx; s.y = hy; s.dirX = dx; s.dirY = dy; s.len = len; s.width = width; s.r = r; s.g = g; s.b = b;
    return true;
  }

  /** Rekord emisji drobin (sparkRecipes.js wypełnia pola) albo null — pula pełna. */
  addSparks() {
    return this.sparks.add();
  }

  addLens(x, y, angle, a, b, amp, front) {
    const l = this.lens.add();
    if (!l) return;
    l.x = x; l.y = y; l.angle = angle; l.a = a; l.b = b; l.amp = amp; l.front = front;
  }
}
