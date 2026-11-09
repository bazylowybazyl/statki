// src/3d/planetGen/planetGenPatch.js
//
// WYCINEK MAPY PLANETY POD KAMERĄ. Mapa całej planety (planetGenBaker.js, 1024–4096 px) niesie kształt; przy zbliżeniu
// jej teksel ma dziesiątki pikseli. Wycinek to te same grafy wypieku (to samo pole, te same progi z próby całej
// planety) policzone tylko dla okna, które widać w kadrze, w rozdzielczości dobranej do kadru — detal drobniejszy niż
// teksel mapy powstaje w wypieku, z operatorami na sąsiadach (nachylenia, cień terenu po mipmapach wycinka), a koszt
// klatki zostaje na poziomie próbek tekstur. Materiał: planetGenSurfaceNear.tsl.js.
//
// UKŁAD WYCINKA: siatka długość / szerokość w układzie OBRÓCONYM tak, żeby okno leżało przy „równiku” układu (teksele
// prawie kwadratowe także na biegunach planety). Układów jest sześć (ściany sześcianu: środek ±X, ±Y, ±Z planety) —
// osie to permutacje osi planety, obrót jest dokładny. Kierunek z kątów (a — na wschód, b — na północ układu):
// (cos a cos b, sin b, −sin a cos b) w osiach układu — jak SphereGeometry z u = ½ + a / 2π, v = ½ + b / π.
//
// SIATKA STAŁA: poziom k ma teksel 2π / (szerokość mapy planety · 2^k), a początek okna jest wielokrotnością
// PATCH_SNAP tekseli. Ten sam punkt planety trafia więc po przesunięciu okna w ten sam teksel (i te same mipmapy do
// poziomu log2(PATCH_SNAP)) — przesuwanie okna za kamerą nie zmienia obrazu. Obraz zmienia się przy zmianie poziomu
// (zbliżenie o oktawę) i układu (przejście przez krawędź ściany) — materiał przenika wtedy stary wycinek w nowy
// (dwa miejsca A / B, wagi `mix`). Nowe okno piecze się W PASACH przez kilka klatek (krok na klatkę), zanim kadr
// dojdzie do brzegu starego.
//
// Moduł czysty (bez three i GPU) poza `PlanetGenPatches`, który woła wypiekacz.

/** Osie układów wycinka w układzie planety: x — środek okna, y — północ okna, z = x × y. */
export const PATCH_FRAMES = Object.freeze([
  { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  { x: [-1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] },
  { x: [0, 0, 1], y: [0, 1, 0], z: [-1, 0, 0] },
  { x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] },
  { x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] },
  { x: [0, -1, 0], y: [1, 0, 0], z: [0, 0, 1] }
].map((f) => Object.freeze(f)));

/** Początek okna = wielokrotność tylu tekseli (mipmapy do poziomu log2 stabilne przy przesuwaniu okna). */
export const PATCH_SNAP = 16;

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Układ dla kierunku: ściana o największym rzucie; `current` zostaje, póki inna nie wygrywa o `hyst`. */
export function patchFrameFor(dir, current = -1, hyst = 0.08) {
  let best = 0;
  let bestD = -2;
  for (let i = 0; i < PATCH_FRAMES.length; i++) {
    const d = dot3(dir, PATCH_FRAMES[i].x);
    if (d > bestD) { bestD = d; best = i; }
  }
  if (current >= 0 && current < PATCH_FRAMES.length && dot3(dir, PATCH_FRAMES[current].x) > bestD - hyst) return current;
  return best;
}

/** Kierunek planety → kąty (a, b) układu `frame` [rad]; `front` — rzut na oś środka (≤ 0: tylna półkula układu). */
export function dirToPatch(frame, dir, out = {}) {
  const dx = dot3(dir, frame.x);
  const dy = dot3(dir, frame.y);
  const dz = dot3(dir, frame.z);
  out.a = Math.atan2(-dz, dx);
  out.b = Math.asin(Math.max(-1, Math.min(1, dy)));
  out.front = dx;
  return out;
}

/** Kąty układu → kierunek planety. */
export function patchToDir(frame, a, b) {
  const cb = Math.cos(b);
  const x = Math.cos(a) * cb;
  const y = Math.sin(b);
  const z = -Math.sin(a) * cb;
  return [
    frame.x[0] * x + frame.y[0] * y + frame.z[0] * z,
    frame.x[1] * x + frame.y[1] * y + frame.z[1] * z,
    frame.x[2] * x + frame.y[2] * y + frame.z[2] * z
  ];
}

/**
 * Zakres kątów kadru w układzie: `dirs` — kierunki planety widoczne w kadrze (rogi, krawędzie, środek).
 * Wynik { frame, aMin, aMax, bMin, bMax } albo null (nic nie widać / kadr sięga tylnej półkuli układu).
 */
export function patchViewBounds(dirs, current = -1) {
  if (!dirs.length) return null;
  const c = [0, 0, 0];
  for (const d of dirs) { c[0] += d[0]; c[1] += d[1]; c[2] += d[2]; }
  const l = Math.hypot(c[0], c[1], c[2]);
  if (l < 1e-6) return null;
  c[0] /= l; c[1] /= l; c[2] /= l;
  const frame = patchFrameFor(c, current);
  const F = PATCH_FRAMES[frame];
  const t = {};
  let aMin = Infinity; let aMax = -Infinity; let bMin = Infinity; let bMax = -Infinity;
  for (const d of dirs) {
    dirToPatch(F, d, t);
    if (t.front < 0.15) return null;
    if (t.a < aMin) aMin = t.a;
    if (t.a > aMax) aMax = t.a;
    if (t.b < bMin) bMin = t.b;
    if (t.b > bMax) bMax = t.b;
  }
  return { frame, aMin, aMax, bMin, bMax };
}

/**
 * Plan okna dla zakresu kadru. `globalWidth` — szerokość mapy planety [px] (teksel poziomu 0), `width` × `height` —
 * rozmiar celu wycinka, `margin` — zapas wokół kadru (okno = kadr × margin), `maxLevel` — najdrobniejszy poziom.
 * Wynik { frame, level, st, a0, b0, key } albo null (kadr za szeroki — wystarcza mapa planety).
 */
export function planPatch(bounds, { globalWidth, width, height, margin = 1.5, minLevel = 1, maxLevel = 8 }) {
  if (!bounds) return null;
  const stG = 2 * Math.PI / globalWidth;
  const need = Math.max((bounds.aMax - bounds.aMin) * margin / width, (bounds.bMax - bounds.bMin) * margin / height, 1e-9);
  const level = Math.min(maxLevel, Math.floor(Math.log2(stG / need)));
  if (level < minLevel) return null;
  const st = stG / Math.pow(2, level);
  const snap = PATCH_SNAP * st;
  const ia = Math.round(((bounds.aMin + bounds.aMax) / 2 - width * st / 2) / snap);
  const ib = Math.round(((bounds.bMin + bounds.bMax) / 2 - height * st / 2) / snap);
  return { frame: bounds.frame, level, st, a0: ia * snap, b0: ib * snap, key: `${bounds.frame}:${level}:${ia}:${ib}` };
}

/** Czy okno `win` (plan + rozmiar celu) pokrywa zakres kadru z zapasem `pad` (ułamek rozmiaru okna z każdej strony). */
export function patchCovers(win, bounds, width, height, pad = 0.05) {
  if (!win || !bounds || win.frame !== bounds.frame) return false;
  const w = width * win.st;
  const h = height * win.st;
  return bounds.aMin >= win.a0 + w * pad && bounds.aMax <= win.a0 + w * (1 - pad)
    && bounds.bMin >= win.b0 + h * pad && bounds.bMax <= win.b0 + h * (1 - pad);
}

/**
 * Wycinki jednej planety: dwa miejsca (A, B) i przenikanie starego w nowe. `update(dirs, dt)` co klatkę: gdy kadr
 * zbliża się do brzegu okna albo zbliżył się o oktawę — wypiek nowego okna do wolnego miejsca W PASACH, po kroku
 * na klatkę (okno 4096 × 2048 to ~16 ms GPU naraz — w pasach ~2 ms na klatkę przez kilka klatek), potem przenikanie
 * przez `fade` sekund. Wartości dla materiału zbliżenia: `slots[i]` = { win, mix (waga 0…1), set }.
 * `kind`: 'surface' — dzień, rzeźba i maski; 'clouds' — mapa chmur (okno w układzie kuli chmur).
 */
export class PlanetGenPatches {
  constructor(baker, base, { width = 2048, height = 1024, margin = 1.5, maxLevel = 8, fade = 0.3, kind = 'surface', pad = 0.06, stepsPerFrame = 1 } = {}) {
    this.baker = baker;
    this.base = base;
    this.kind = kind;
    this.width = width;
    this.height = height;
    this.margin = margin;
    this.maxLevel = maxLevel;
    this.fade = fade;
    this.pad = pad;                       // wypiek rusza, gdy kadr podejdzie do brzegu okna bliżej niż ten ułamek okna
    this.stepsPerFrame = stepsPerFrame;
    this.globalWidth = base.size;
    const tag = (i) => `${kind}:${base.spec.type}:${base.spec.seed}:${i}`;
    this.slots = [0, 1].map((i) => ({
      set: kind === 'clouds' ? baker.createCloudPatchTarget(width, height, tag(i)) : baker.createPatchTargets(width, height, tag(i)), win: null, mix: 0
    }));
    this.active = -1;         // miejsce z aktualnym oknem (−1: sama mapa planety)
    this.job = null;          // wypiek w toku: { plan, slot, steps, i, tu, ms }
    this._tu = new Map();     // poziom → uniformsFor rodzaju (liczby oktaw, kratery)
    this.stats = { bakes: 0, lastMs: 0, level: 0, steps: 0 };
    this.enabled = true;
  }

  /** Bajty GPU obu miejsc (bez celu pola wypiekacza: szerokość × wysokość × 16). */
  get bytes() { return this.slots[0].set.bytes + this.slots[1].set.bytes; }

  /**
   * `dirs` — kierunki planety (układ obiektu) widoczne w kadrze; `dt` [s]. Zwraca true, gdy w tej klatce skończył
   * się wypiek okna. `force` — nowe okno także przy tym samym kadrze i cały wypiek od razu (pomiary, zmiana planety).
   */
  update(dirs, dt, force = false) {
    const cur = this.active >= 0 ? this.slots[this.active] : null;
    const bounds = this.enabled ? patchViewBounds(dirs, cur?.win ? cur.win.frame : -1) : null;
    const plan = planPatch(bounds, this);
    // wypiek w toku, którego okno nie pokryje już kadru (szybki przelot, oddalenie) — porzucony
    if (this.job && !(bounds && patchCovers(this.job.plan, bounds, this.width, this.height, 0.0))) this.job = null;
    if (plan && !this.job) {
      const covers = cur && patchCovers(cur.win, bounds, this.width, this.height, this.pad);
      // drugie miejsce jeszcze gaśnie na ekranie — nie wolno w nie piec
      const fading = this.slots.some((s, i) => i !== this.active && s.mix > 0);
      // za grubo: kadr zbliżył się o ponad oktawę względem okna (z zapasem — bez przełączania tam i z powrotem)
      const coarse = cur?.win && plan.level > cur.win.level
        && (plan.level - cur.win.level > 1 || this._needRatio(bounds, cur.win) < 0.42);
      if ((!cur || !covers || coarse || force) && (!fading || force) && (!cur || force || plan.key !== cur.win.key)) this._start(plan);
    } else if (!plan && !this.job && cur && !(bounds && patchCovers(cur.win, bounds, this.width, this.height, 0.0))) {
      // kadr za szeroki na wycinek (albo wycinki wyłączone): wraca sama mapa planety
      this.active = -1;
    }
    const done = this.job ? this._run(force ? Infinity : this.stepsPerFrame) : false;
    // przenikanie: aktywne miejsce rośnie do 1, drugie maleje do 0
    const step = this.fade > 0 ? dt / this.fade : 1;
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      s.mix = i === this.active ? Math.min(1, s.mix + step) : Math.max(0, s.mix - step);
    }
    this.stats.level = this.active >= 0 ? this.slots[this.active].win.level : 0;
    return done;
  }

  // jaka część okna (w osi ciaśniejszej) jest potrzebna kadrowi z zapasem — poniżej ~½ opłaca się poziom drobniejszy
  _needRatio(bounds, win) {
    return Math.max((bounds.aMax - bounds.aMin) * this.margin / (this.width * win.st), (bounds.bMax - bounds.bMin) * this.margin / (this.height * win.st));
  }

  _start(plan) {
    const slot = this.active === 0 ? 1 : 0;
    const s = this.slots[slot];
    s.mix = 0;
    s.win = null;
    this.job = {
      plan: { ...plan, axes: PATCH_FRAMES[plan.frame] }, slot, i: 0, ms: 0,
      steps: this.baker.patchSteps(s.set, this.kind), tu: this._tu.get(plan.level) || null
    };
  }

  // kolejne kroki wypieku (pas jednego przejścia na krok); po ostatnim okno wchodzi do miejsca i zaczyna przenikać
  _run(n) {
    const job = this.job;
    const s = this.slots[job.slot];
    const w = { frame: job.plan.axes, a0: job.plan.a0, b0: job.plan.b0, st: job.plan.st };
    const t0 = performance.now();
    for (let k = 0; k < n && job.i < job.steps.length; k++, job.i++) {
      job.tu = this.baker.bakePatchStep(this.base, w, s.set, job.tu, job.steps[job.i]);
      this.stats.steps++;
    }
    job.ms += performance.now() - t0;
    if (job.i < job.steps.length) return false;
    if (job.tu) this._tu.set(job.plan.level, job.tu);
    s.win = job.plan;
    s.mix = 0;
    this.active = job.slot;
    this.stats.bakes++;
    this.stats.lastMs = job.ms;
    this.job = null;
    return true;
  }

  dispose() {
    this.job = null;
    for (const s of this.slots) s.set.dispose();
  }
}
