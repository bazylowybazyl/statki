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
 * Tylko przegródki i szczeliny w zasięgu ośrodka (ośrodek istnieje wyłącznie w pudle wokół
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
  const seams = frame.seams;
  let m = 0;
  for (let j = 0; j < seams.count; j++) {
    const s = seams.items[j];
    const r = Math.max(s.halfLen * 1.5, s.halfWidth * 8 + 300);
    const hx = kx * (camZ + r) + r;
    const hy = ky * (camZ + r) + r;
    if (Math.abs(s.x) < hx && Math.abs(s.y) < hy) {
      if (m !== j) { seams.items[j] = seams.items[m]; seams.items[m] = s; }
      m++;
    }
  }
  seams.count = m;
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

export const WARP_FRAME_CAPS = Object.freeze({
  bubbles: 16, seams: 8, rifts: 24, seamLens: 8, lens: 8, waves: 24, flashes: 64, glares: 16, smears: 8
});

export class WarpFrame {
  constructor(caps = WARP_FRAME_CAPS) {
    this.caps = caps;
    // Przegródki ośrodka: referencje do obiektów właścicieli (kolejność = kolejność zgłoszeń).
    this.bubbles = [];
    // Szczeliny w ośrodku (rozsuwanie, przepływ wnętrza tunelu).
    this.seams = new Pool(caps.seams, () => ({ x: 0, y: 0, angle: 0, halfLen: 0, halfWidth: 0, push: 0, flow: 0 }));
    // Szczeliny rysowane (rift.js).
    this.rifts = new Pool(caps.rifts, () => ({ x: 0, y: 0, angle: 0, halfLen: 0, halfWidth: 0, k: 0, core: null, body: null, dirty: 0, seed: 0, fill: 0 }));
    // Zgięcie tła: wciąganie w szczeliny i soczewka bańki (tylko mgławica).
    this.seamLens = new Pool(caps.seamLens, () => ({ x: 0, y: 0, angle: 0, halfLen: 0, band: 0, amp: 0 }));
    this.lens = new Pool(caps.lens, () => ({ x: 0, y: 0, angle: 0, a: 0, b: 0, amp: 0, front: 3 }));
    // Fale (przezroczysta refrakcja całej klatki — źródła zniekształceń Core3D).
    this.waves = new Pool(caps.waves, () => ({ x: 0, y: 0, r: 0, width: 0, amp: 0 }));
    // Błyski (okrągłe) i poprzeczne linie blasku.
    this.flashes = new Pool(caps.flashes, () => ({ x: 0, y: 0, size: 0, k: 0, pal: null, raw: false }));
    this.glares = new Pool(caps.glares, () => ({ x: 0, y: 0, angle: 0, len: 0, k: 0, pal: null }));
    // Smugi sylwetki (kopia alfy sprite'a rozciągnięta wzdłuż kursu).
    this.smears = new Pool(caps.smears, () => ({ entity: null, x: 0, y: 0, angle: 0, length: 0, width: 0, total: 1, k: 0, pal: null }));
    // Gwiazdy (rozciąganie płaskie, front wyjścia) — z gracza.
    this.stars = { stretch: 0, angle: 0, frontOn: 0, frontS: 0, warpTint: 0, refX: 0, refY: 0 };
    this.warpVis = 0;       // poświata rzadkich drobin w ruchu (skok gracza)
    this.mediumFade = 0;    // [1/s] gaszenie całego ośrodka (po wyjściu z warpa)
    this.shake = 0;         // największy wstrząs klatki (0..1, skala wołającego)
  }

  reset() {
    this.bubbles.length = 0;
    this.seams.reset();
    this.rifts.reset();
    this.seamLens.reset();
    this.lens.reset();
    this.waves.reset();
    this.flashes.reset();
    this.glares.reset();
    this.smears.reset();
    const st = this.stars;
    st.stretch = 0; st.frontOn = 0; st.frontS = 0; st.warpTint = 0;
    this.warpVis = 0;
    this.mediumFade = 0;
    this.shake = 0;
  }

  /** Czy klatka ma cokolwiek do narysowania albo policzenia w ośrodku. */
  get busy() {
    return this.bubbles.length > 0 || this.seams.count > 0 || this.rifts.count > 0 || this.waves.count > 0
      || this.flashes.count > 0 || this.glares.count > 0 || this.smears.count > 0 || this.lens.count > 0
      || this.seamLens.count > 0 || this.stars.stretch > 0 || this.warpVis > 0;
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

  addRift(x, y, angle, halfLen, halfWidth, k, pal, dirty, seed, fill) {
    const r = this.rifts.add();
    if (!r) return;
    r.x = x; r.y = y; r.angle = angle; r.halfLen = halfLen; r.halfWidth = halfWidth; r.k = k;
    r.core = pal.core; r.body = pal.body; r.dirty = dirty; r.seed = seed; r.fill = fill;
  }

  addSeam(x, y, angle, halfLen, halfWidth, push, flow) {
    const s = this.seams.add();
    if (!s) return;
    s.x = x; s.y = y; s.angle = angle; s.halfLen = halfLen; s.halfWidth = halfWidth; s.push = push; s.flow = flow;
  }

  addSeamLens(x, y, angle, halfLen, band, amp) {
    const s = this.seamLens.add();
    if (!s) return;
    s.x = x; s.y = y; s.angle = angle; s.halfLen = halfLen; s.band = band; s.amp = amp;
  }

  addLens(x, y, angle, a, b, amp, front) {
    const l = this.lens.add();
    if (!l) return;
    l.x = x; l.y = y; l.angle = angle; l.a = a; l.b = b; l.amp = amp; l.front = front;
  }

  addSmear(entity, x, y, angle, length, width, total, k, pal) {
    const s = this.smears.add();
    if (!s) return;
    s.entity = entity; s.x = x; s.y = y; s.angle = angle; s.length = length; s.width = width;
    s.total = total; s.k = k; s.pal = pal;
  }
}
