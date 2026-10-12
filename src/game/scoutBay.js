// ============================================================
// FREGATA ZWIADU W ŁADOWNI ATLASA (2026-10-11, etap zwiadu misji 1). Czysta logika (bez three / DOM).
//
// Decyzje użytkownika (2026-10-11): w ładowni Atlasa (luk 346 × 275 j., wrota kieszeniowe ×3 —
// src/data/cargoBays.js) stoi jedna fregata zwiadowcza (Custos). Gracz PRZEJMUJE STERY I KAMERĘ fregaty
// (Atlas stoi), powrót = fregata sama wraca do luku, kamera wraca na Atlasa. Wzrok fregaty mniejszy niż
// zwiadowcy radarowego (26 km) — trzeba oblecieć bazę; fregata ma SKAN (impuls jak X: fala od fregaty,
// oznacza wrogie kontakty w zasięgu) i ręczne oznaczanie T (stuknięcie — przełącz, trzymanie — malowanie).
// Piraci mogą fregatę wykryć — to zwykły atak (AI widzi ją jak każdego sojusznika).
//
// Rozgrywka 2D: w ładowni fregaty NIE MA w świecie; start i lądowanie to DUCH (isCollidable = false, bez
// zderzeń z Atlasem) z pozą liczoną od Atlasa; w locie zwykły NPC, którego intencję lotu pisze ten moduł
// z wejścia gracza. Grę daje `env` (klej w index.html, blok „ZWIAD: FREGATA W ŁADOWNI”).
//
// env: {
//   carrier() → Atlas (pos, vel, angle, w/h),
//   spawn(pose) → encja NPC fregaty (pose: x, y, angle, vx, vy),
//   remove(npc) — usuń bez wraku, ghost(npc, on) — duch (kolizje),
//   fly(npc, x, y, vx, vy, face, speedLimit) — intencja lotu (arrive z kursem),
//   place(npc, x, y, angle, vx, vy) — poza wprost (start / lądowanie),
//   contacts(out) → wrogie kontakty (okręty, stacje) do skanu i oznaczeń,
//   visible(e) → czy gracz widzi byt (mgła wojny),
//   label(e) → podpis, radius(e) → promień,
//   bayLocal → { x, y } środek luku w układzie Atlasa (x dziób, y w prawo — jak sprite)
//   reveal(id, x, y, r, sec) / unreveal(id) — strefa odsłonięta w mgle wojny (OKO, klawisz 3; opcjonalne),
//   scanTargets(out) → wszystko, co daleki skan może zobaczyć (wrogowie, neutralni, stacje; opcjonalne — domyślnie contacts),
//   massClass(e) → 0 mała … 4 olbrzymia (opcjonalne — domyślnie z promienia)
// }
//
// SYSTEMY ZWIADU (2026-10-11, prośba użytkownika: „fregata zwiadowcza musi być uzbrojona w systemy zwiadowcze”):
//   I — MASKOWANIE fregaty (własny `cloak`, src/game/cloak.js — ta sama reguła co u Atlasa: pęka przy trafieniu
//       i taranie; zamaskowanej fregaty nie widzą obrona bazy, datalink ani wybór celów AI),
//   3 — OKO (sonda optyczna): koło odsłoniętej mgły pod kursorem, w zasięgu `eyeRange` od fregaty, z baterii,
//   4 — DALEKI SKAN KIERUNKOWY: klin `longRange` w stronę kursora; mgły nie odsłania — zostawia ECHA (skupiska
//       z grubą klasą masy, przybliżoną liczbą i kołem niepewności rosnącym z odległością), które gasną po `echoLife`.
// ============================================================

import { breakCloak, cloakBlockReason, createCloak, isCloakEngaged, isCloakHidden, stepCloak, toggleCloak } from './cloak.js';

/** Maskowanie fregaty zwiadu — krótszy rozruch niż u Atlasa, trochę więcej energii. */
export const SCOUT_CLOAK_TUNE = Object.freeze({
  maxEnergy: 75, minEnergy: 8, drainPerSec: 1, rechargePerSec: 0.5,
  engageSec: 1.2, revealSec: 0.5, breakCooldownSec: 8
});

/** Klasy masy echa dalekiego skanu (indeks = massClass). */
export const SCOUT_MASS_LABELS = Object.freeze(['MAŁA MASA', 'ŚREDNIA MASA', 'DUŻA MASA', 'BARDZO DUŻA MASA', 'OLBRZYMIA MASA']);
/** Przybliżona liczba obiektów w echu (skan nie liczy dokładnie). */
export function scoutEchoCountLabel(n) {
  return n <= 1 ? '1 obiekt' : n <= 3 ? '2–3 obiekty' : n <= 8 ? 'kilka obiektów' : 'wiele obiektów';
}

export const SCOUT_TUNE = {
  visionRange: 10000,     // wzrok fregaty (mgła wojny) — zwiadowca radarowy ma 26 km
  markRange: 10000,       // ręczne T: kontakt najdalej tyle od fregaty
  scanRange: 10000,       // zasięg impulsu skanu
  scanTime: 1.6,          // fala dochodzi do zasięgu [s]
  scanCooldown: 6,        // [s]
  doorTime: 3.2,          // wrota (otwarcie / zamknięcie) [s]
  riseTime: 2.2,          // wynurzenie z ładowni (duch, poza od Atlasa)
  departSpeed: 260,       // wylot znad kadłuba względem Atlasa [j/s]
  clearMargin: 200,       // fregata „czysta”, gdy tyle za obrysem Atlasa
  returnHover: 60,        // punkt nad lukiem przed lądowaniem
  landTime: 2.4,          // zejście do ładowni
  landRadius: 140,        // odległość od punktu nad lukiem, od której lądowanie
  landRelSpeed: 120,      // względna prędkość, od której lądowanie
  returnTimeout: 90,      // zabezpieczenie: po tylu sekundach powrotu — lądowanie od razu
  accel: 220,             // zadawanie prędkości W / S [j/s²]
  turnRate: 0.9,          // A / D [rad/s]
  strafeFrac: 0.35,       // Q / E — ułamek prędkości maks.
  reverseFrac: 0.3,
  paintPickPx: 26,        // promień trafienia kursorem [px ekranu]
  avoidMargin: 600,       // zapas od koła strefy unikania przy powrocie [j.]
  avoidCarrot: 1500,      // punkt prowadzenia za punktem stycznym [j.]
  // OKO (3): sonda optyczna pod kursorem
  eyeRadius: 3500,        // promień odsłoniętego koła [j.]
  eyeRange: 22000,        // środek koła najdalej tyle od fregaty [j.]
  eyeEnergy: 30,          // bateria [s pracy]
  eyeMinEnergy: 4,        // próg włączenia [s]
  eyeRecharge: 0.6,       // ładowanie przy wyłączonym oku [s na s]
  eyeFollow: 7,           // nadążanie koła za kursorem [1/s]
  // DALEKI SKAN KIERUNKOWY (4)
  longRange: 70000,       // zasięg klina [j.]
  longHalfAngle: 0.21,    // pół szerokości klina [rad] (~12°)
  longSweep: 1.8,         // czoło dochodzi do zasięgu [s]
  longCooldown: 12,       // [s]
  echoLife: 30,           // echo gaśnie po [s]
  echoCluster: 3000,      // obiekty bliżej niż tyle od skupiska — jedno echo [j.]
  echoErrFrac: 0.05,      // niepewność położenia: ułamek odległości od fregaty
  echoErrMin: 700         // … nie mniej niż [j.]
};

export const SCOUT_PHASE = Object.freeze({
  NONE: 'none',           // brak fregaty w ładowni
  STOWED: 'stowed',
  OPENING: 'opening',
  RISING: 'rising',
  DEPARTING: 'departing',
  FLIGHT: 'flight',       // stery gracza
  RETURNING: 'returning',
  LANDING: 'landing',
  CLOSING: 'closing',
  LOST: 'lost'            // fregata zniszczona
});

const P = SCOUT_PHASE;

function hyp(x, y) { return Math.sqrt(x * x + y * y); }
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function ex(e) { return e?.pos ? e.pos.x : (e?.x ?? 0); }
function ey(e) { return e?.pos ? e.pos.y : (e?.y ?? 0); }

export function createScoutBay(env, tune = SCOUT_TUNE) {
  const listeners = new Map();
  const bay = {
    tune,
    env,
    phase: P.NONE,
    t: 0,                 // czas fazy [s]
    door: 0,              // 0 zamknięte … 1 otwarte (render)
    lift: 0,              // 0 dno ładowni … 1 nad poszyciem (render)
    npc: null,
    controlling: false,   // stery i kamera na fregacie
    ctl: { thrust: 0, turn: 0, strafe: 0 },
    cmdSpeed: 0,
    cmdFace: 0,
    marks: [],            // { id, entity, x, y, label, source, at, visible, destroyed }
    markSerial: 0,
    scan: { active: false, t: 0, x: 0, y: 0, r: 0, cooldown: 0 },
    paint: { held: false, x: 0, y: 0, pickR: 0 },
    stats: { launches: 0, scans: 0, longScans: 0 },
    // Maskowanie fregaty (I) — jeden stan na fregatę z ładowni: energia przeżywa lądowanie, encja dostaje go przy spawnie.
    cloak: createCloak(SCOUT_CLOAK_TUNE),
    // OKO (3): x / y — środek koła (nadąża za aim), revealing — strefa w mgle istnieje.
    eye: { on: false, energy: tune.eyeEnergy, x: 0, y: 0, aimX: 0, aimY: 0, r: tune.eyeRadius, placed: false, revealing: false },
    // DALEKI SKAN (4): klin od (x, y) w kierunku dir, czoło r.
    long: { active: false, t: 0, x: 0, y: 0, dir: 0, r: 0, cooldown: 0, serial: 0, seen: null },
    echoes: [],           // { id, serial, x, y, cx, cy, sx, sy, n, cls, struct, err, born, dist }
    echoSerial: 0,

    on(name, fn) { let l = listeners.get(name); if (!l) listeners.set(name, (l = [])); l.push(fn); return () => this.off(name, fn); },
    off(name, fn) { const l = listeners.get(name); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(name, data) { const l = listeners.get(name); if (l) for (const fn of [...l]) { try { fn(data, this); } catch (e) { console.error('[ScoutBay]', name, e); } } },

    /** Fregata w ładowni (misja / dev). */
    grant() {
      if (this.phase === P.NONE || this.phase === P.LOST) { this._setPhase(P.STOWED); this.door = 0; this.lift = 0; }
      return this;
    },
    /** Bez fregaty (koniec misji, reset). Fregata w świecie znika bez wraku. */
    revoke() {
      if (this.npc) env.remove(this.npc);
      this.npc = null;
      this.controlling = false;
      this._systemsOff();
      this._setPhase(P.NONE);
      this.door = 0; this.lift = 0;
    },
    available() { return this.phase !== P.NONE && this.phase !== P.LOST; },
    deployed() { return !!this.npc && !this.npc.dead; },
    busy() { return this.phase !== P.NONE && this.phase !== P.STOWED && this.phase !== P.LOST; },

    /** Wypuść fregatę (z ładowni) albo — gdy już leci — przejmij jej stery. */
    launch() {
      if (this.phase === P.STOWED) { this._setPhase(P.OPENING); this.controlling = true; this.stats.launches++; this.emit('launch'); return true; }
      if (this.phase === P.FLIGHT) { this.controlling = true; return true; }
      return false;
    },
    /** Odwołaj: fregata sama wraca do luku, stery i kamera wracają na Atlasa. */
    recall() {
      this.controlling = false;
      if (this.phase === P.FLIGHT || this.phase === P.DEPARTING) { this._setPhase(P.RETURNING); this.emit('recall'); return true; }
      if (this.phase === P.OPENING) {
        if (this.npc) { env.remove(this.npc); this.npc = null; }
        this._setPhase(P.CLOSING);
        return true;
      }
      return false;
    },
    /** Przełącznik klawisza: w ładowni — start, w locie — powrót. */
    toggle() {
      if (this.phase === P.STOWED) return this.launch();
      if (this.phase === P.FLIGHT || this.phase === P.DEPARTING || this.phase === P.OPENING) return this.recall();
      return false;
    },

    /** Strefy unikania powrotu: [{ x, y, r }] w świecie gry (null / [] — brak). Kopia — misja może zmieniać swoją tablicę. */
    avoid: [],
    _avoiding: false,
    setAvoid(zones) {
      const out = [];
      if (Array.isArray(zones)) for (const z of zones) {
        const x = Number(z?.x), y = Number(z?.y), r = Number(z?.r);
        if (Number.isFinite(x) && Number.isFinite(y) && r > 0) out.push({ x, y, r });
      }
      this.avoid = out;
      return out.length;
    },
    /**
     * Punkt prowadzenia omijający strefy na odcinku (fx, fy) → (tx, ty): fregata w strefie — radialnie na zewnątrz;
     * odcinek przecina koło (r + avoidMargin) — „marchewka” za punktem stycznym po stronie bliższej celowi.
     * Wynik w out { x, y }; false — droga wolna.
     */
    _avoidWaypoint(fx, fy, tx, ty, out) {
      const Z = this.avoid;
      if (!Z.length) return false;
      const m = tune.avoidMargin;
      let best = -1; let bestT = Infinity;
      const sx = tx - fx, sy = ty - fy;
      const L2 = sx * sx + sy * sy;
      for (let i = 0; i < Z.length; i++) {
        const z = Z[i];
        const R = z.r + m;
        const cx = z.x - fx, cy = z.y - fy;
        const dc = hyp(cx, cy);
        if (dc < R) {
          // W środku strefy: na zewnątrz (z zapasem), zanim cokolwiek innego.
          const k = dc > 1e-6 ? 1 / dc : 0;
          const ux = k ? -cx * k : 1, uy = k ? -cy * k : 0;
          out.x = z.x + ux * (R + tune.avoidCarrot); out.y = z.y + uy * (R + tune.avoidCarrot);
          return true;
        }
        // Cel w strefie — nie objeżdżamy (dolot i tak tam wiedzie).
        if (hyp(tx - z.x, ty - z.y) < R) continue;
        const t = L2 > 1e-9 ? Math.max(0, Math.min(1, (cx * sx + cy * sy) / L2)) : 0;
        const px = sx * t - cx, py = sy * t - cy;
        if (px * px + py * py < R * R && t < bestT) { bestT = t; best = i; }
      }
      if (best < 0) return false;
      const z = Z[best];
      const R = z.r + m;
      const cx = fx - z.x, cy = fy - z.y;
      const dc = hyp(cx, cy);
      const base = Math.atan2(cy, cx);
      const half = Math.acos(Math.min(1, R / dc));
      const ta = Math.atan2(ty - z.y, tx - z.x);
      // dwa punkty styczne: base ± half; bliższy kątowo celowi (krótsza strona koła)
      const a1 = base + half, a2 = base - half;
      const a = Math.abs(wrap(ta - a1)) <= Math.abs(wrap(ta - a2)) ? a1 : a2;
      const qx = z.x + Math.cos(a) * R, qy = z.y + Math.sin(a) * R;
      let dx = qx - fx, dy = qy - fy;
      const dl = hyp(dx, dy) || 1;
      dx /= dl; dy /= dl;
      out.x = qx + dx * tune.avoidCarrot; out.y = qy + dy * tune.avoidCarrot;
      return true;
    },

    setControl(thrust, turn, strafe) { this.ctl.thrust = thrust; this.ctl.turn = turn; this.ctl.strafe = strafe; },

    /** Impuls skanu z fregaty. */
    startScan() {
      const n = this.npc;
      if (!n || n.dead || this.phase !== P.FLIGHT && this.phase !== P.RETURNING) return false;
      if (this.scan.active || this.scan.cooldown > 0) return false;
      const s = this.scan;
      s.active = true; s.t = 0; s.r = 0; s.x = ex(n); s.y = ey(n); s.cooldown = tune.scanCooldown;
      this.stats.scans++;
      this.emit('scan', { x: s.x, y: s.y, range: tune.scanRange });
      return true;
    },

    /** Fregata w świecie i w locie (systemy zwiadu działają tylko wtedy — nie w luku ani przy lądowaniu). */
    _systemsReady() {
      const n = this.npc;
      return !!n && !n.dead && (this.phase === P.FLIGHT || this.phase === P.RETURNING);
    },

    // ---------------- MASKOWANIE (I)
    /** Przełącz maskowanie fregaty. Zwraca '' (przełączone) albo powód odmowy (tekst). */
    toggleCloak() {
      const c = this.cloak;
      if (isCloakEngaged(c)) { toggleCloak(c); this.emit('cloak', { on: false }); return ''; }
      if (!this._systemsReady()) return 'fregata nie jest w locie';
      const why = cloakBlockReason(c);
      if (why) return why;
      toggleCloak(c);
      this.emit('cloak', { on: true });
      return '';
    },
    /** Zerwanie maskowania fregaty (trafienie, taran). true — było czynne. */
    breakCloak(reason = 'hit') {
      if (!breakCloak(this.cloak, reason)) return false;
      this.emit('cloakBroken', { reason });
      return true;
    },
    cloakHidden() { return !!this.npc && isCloakHidden(this.npc); },

    // ---------------- OKO (3)
    setEyeAim(wx, wy) { if (Number.isFinite(wx) && Number.isFinite(wy)) { this.eye.aimX = wx; this.eye.aimY = wy; } },
    /** Przełącz oko. Zwraca '' albo powód odmowy. */
    toggleEye() {
      const e = this.eye;
      if (e.on) { e.on = false; this.emit('eye', { on: false }); return ''; }
      if (!this._systemsReady()) return 'fregata nie jest w locie';
      if (e.energy < tune.eyeMinEnergy) return `bateria ${Math.floor(e.energy)} / ${tune.eyeEnergy} s`;
      e.on = true;
      e.placed = false;
      this.emit('eye', { on: true });
      return '';
    },

    // ---------------- DALEKI SKAN KIERUNKOWY (4)
    /** Klin w stronę punktu (wx, wy). Zwraca '' albo powód odmowy. */
    startLongScan(wx, wy) {
      const n = this.npc;
      if (!this._systemsReady()) return 'fregata nie jest w locie';
      const L = this.long;
      if (L.active) return 'skan w toku';
      if (L.cooldown > 0) return `przeładowanie ${Math.ceil(L.cooldown)} s`;
      const fx = ex(n), fy = ey(n);
      const dx = wx - fx, dy = wy - fy;
      L.dir = hyp(dx, dy) > 1 ? Math.atan2(dy, dx) : (n.angle || 0);
      L.active = true; L.t = 0; L.r = 0; L.x = fx; L.y = fy;
      L.cooldown = tune.longCooldown;
      L.serial++;
      L.seen = new Set();
      this.stats.longScans++;
      this.emit('longScan', { x: fx, y: fy, dir: L.dir, range: tune.longRange });
      return '';
    },
    /** Echa dalekiego skanu (do HUD / misji). */
    echoLabel(echo) {
      return `${echo.struct ? 'STRUKTURA · ' : ''}${SCOUT_MASS_LABELS[echo.cls] || SCOUT_MASS_LABELS[0]} · ${scoutEchoCountLabel(echo.n)}`;
    },

    _massClass(e) {
      if (env.massClass) { const c = env.massClass(e); if (Number.isFinite(c)) return Math.max(0, Math.min(4, c | 0)); }
      const r = env.radius(e);
      return r < 120 ? 0 : r < 400 ? 1 : r < 900 ? 2 : r < 2000 ? 3 : 4;
    },

    _stepSystems(dt) {
      const n = this.npc;
      const ready = this._systemsReady();
      // Maskowanie: krok zawsze (energia ładuje się też w ładowni); fregata bez encji — wyłączone.
      const c = this.cloak;
      if (!n && (c.state === 'on' || c.state === 'engaging' || c.state === 'revealing')) { c.state = 'off'; c.level = 0; }
      const wasHidden = !!n && isCloakHidden(n);
      if (stepCloak(c, dt) === 'energy') this.emit('cloakBroken', { reason: 'energy' });
      if (n && !wasHidden && isCloakHidden(n)) this.emit('cloakHidden', n);

      // Oko.
      const e = this.eye;
      // Oko celuje kursorem — bez sterów fregaty (powrót, stery na Atlasie) gaśnie.
      if (e.on && (!ready || !this.controlling)) { e.on = false; this.emit('eye', { on: false }); }
      if (e.on) {
        e.energy = Math.max(0, e.energy - dt);
        const fx = ex(n), fy = ey(n);
        let ax = e.aimX - fx, ay = e.aimY - fy;
        const d = hyp(ax, ay);
        if (d > tune.eyeRange) { ax *= tune.eyeRange / d; ay *= tune.eyeRange / d; }
        const tx = fx + ax, ty = fy + ay;
        if (!e.placed) { e.x = tx; e.y = ty; e.placed = true; }
        else { const k = 1 - Math.exp(-tune.eyeFollow * dt); e.x += (tx - e.x) * k; e.y += (ty - e.y) * k; }
        e.r = tune.eyeRadius;
        if (env.reveal) { env.reveal(EYE_REVEAL_ID, e.x, e.y, e.r, 0.5); e.revealing = true; }
        if (e.energy <= 0) { e.on = false; this.emit('eyeEmpty'); this.emit('eye', { on: false }); }
      } else {
        e.energy = Math.min(tune.eyeEnergy, e.energy + tune.eyeRecharge * dt);
      }
      if (!e.on && e.revealing) { env.unreveal?.(EYE_REVEAL_ID); e.revealing = false; }

      // Daleki skan.
      const L = this.long;
      if (L.cooldown > 0) L.cooldown = Math.max(0, L.cooldown - dt);
      if (L.active) {
        L.t += dt;
        L.r = tune.longRange * Math.min(1, L.t / tune.longSweep);
        const list = env.scanTargets ? env.scanTargets(_scanList) : env.contacts(_scanList);
        const cs = Math.cos(L.dir), sn = Math.sin(L.dir);
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          if (!t || t.dead || t.destroyed || L.seen.has(t) || isCloakHidden(t)) continue;
          const dx = ex(t) - L.x, dy = ey(t) - L.y;
          const d = hyp(dx, dy);
          if (d > L.r || d < 1) continue;
          const along = dx * cs + dy * sn;
          if (along <= 0) continue;
          const across = Math.abs(-dx * sn + dy * cs);
          if (across > Math.tan(tune.longHalfAngle) * along + env.radius(t)) continue;
          L.seen.add(t);
          this._addEcho(t, ex(t), ey(t), d, L.serial);
        }
        if (L.t >= tune.longSweep + 0.4) {
          L.active = false;
          L.seen = null;
          let k = 0; for (const q of this.echoes) if (q.serial === L.serial) k++;
          this.emit('longScanDone', { echoes: k });
        }
      }
      // Echa gasną.
      let w = 0;
      for (let i = 0; i < this.echoes.length; i++) {
        const q = this.echoes[i];
        if (this.clock - q.born <= tune.echoLife) this.echoes[w++] = q;
      }
      this.echoes.length = w;
    },

    _addEcho(t, x, y, dist, serial) {
      const cls = this._massClass(t);
      const struct = !!(env.isStructure ? env.isStructure(t) : t.static);
      let echo = null;
      for (const q of this.echoes) {
        if (q.serial !== serial) continue;
        if (hyp(x - q.cx, y - q.cy) < tune.echoCluster) { echo = q; break; }
      }
      if (!echo) {
        echo = { id: `E${++this.echoSerial}`, serial, x, y, cx: x, cy: y, sx: 0, sy: 0, n: 0, cls: 0, struct: false, err: 0, born: this.clock, dist };
        this.echoes.push(echo);
      }
      echo.sx += x; echo.sy += y; echo.n++;
      echo.cx = echo.sx / echo.n; echo.cy = echo.sy / echo.n;
      if (cls > echo.cls) echo.cls = cls;
      echo.struct = echo.struct || struct;
      echo.dist = Math.min(echo.dist, dist);
      echo.err = Math.max(tune.echoErrMin, echo.dist * tune.echoErrFrac);
      echo.born = this.clock;
      // Położenie z błędem: stałe przesunięcie echa (hasz numeru), w 60% koła niepewności — skan kłamie o tyle samo
      // przy każdym odświeżeniu tego echa.
      const k = Number(echo.id.slice(1));
      const h = hash01(k * 7919 + serial * 104729);
      const h2 = hash01(k * 15485863 + serial * 32452843 + 17);
      const a = h * Math.PI * 2, rr = Math.sqrt(h2) * echo.err * 0.6;
      echo.x = echo.cx + Math.cos(a) * rr;
      echo.y = echo.cy + Math.sin(a) * rr;
      return echo;
    },

    _systemsOff() {
      const e = this.eye;
      if (e.on) { e.on = false; this.emit('eye', { on: false }); }
      if (e.revealing) { env.unreveal?.(EYE_REVEAL_ID); e.revealing = false; }
      const c = this.cloak;
      if (c.state === 'on' || c.state === 'engaging' || c.state === 'revealing') { c.state = 'off'; c.level = 0; }
      this.long.active = false; this.long.seen = null;
    },

    /** Kontakt pod punktem świata (oznaczanie T): widoczny, w zasięgu oznaczania od fregaty. */
    pickAt(wx, wy, pickR) {
      const n = this.npc;
      if (!n || n.dead) return null;
      const list = env.contacts(_contacts);
      let best = null; let bestD = Infinity;
      const fx = ex(n), fy = ey(n);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!env.visible(e)) continue;
        const x = ex(e), y = ey(e);
        if (hyp(x - fx, y - fy) > tune.markRange + env.radius(e)) continue;
        const d = hyp(x - wx, y - wy) - env.radius(e);
        if (d < pickR && d < bestD) { best = e; bestD = d; }
      }
      return best;
    },
    /** T stuknięte: przełącz oznaczenie kontaktu pod kursorem. */
    toggleMarkAt(wx, wy, pickR) {
      const e = this.pickAt(wx, wy, pickR);
      if (!e) return null;
      const m = this.markOf(e);
      if (m) { this.unmark(e); return null; }
      return this.mark(e, 'manual');
    },
    /** T trzymane: malowanie (tylko dokłada). */
    setPaint(held, wx, wy, pickR) { const p = this.paint; p.held = !!held; p.x = wx; p.y = wy; p.pickR = pickR; },

    markOf(e) { for (const m of this.marks) if (m.entity === e) return m; return null; },
    mark(e, source = 'manual') {
      if (!e) return null;
      let m = this.markOf(e);
      if (m) return m;
      m = { id: `Z${++this.markSerial}`, entity: e, x: ex(e), y: ey(e), label: env.label(e), source, at: this.clock, visible: true, destroyed: false };
      this.marks.push(m);
      this.emit('mark', m);
      return m;
    },
    unmark(e) {
      const i = this.marks.findIndex((m) => m.entity === e || m === e || m.id === e);
      if (i < 0) return false;
      const [m] = this.marks.splice(i, 1);
      this.emit('unmark', m);
      return true;
    },
    clearMarks() { this.marks.length = 0; },
    /** Lista oznaczonych celów dla misji (kopie bez encji do zapisu + encja). */
    markedTargets() {
      return this.marks.map((m) => ({ id: m.id, entity: m.entity, x: m.x, y: m.y, label: m.label, source: m.source, destroyed: m.destroyed, visible: m.visible }));
    },

    clock: 0,
    _placed: false,

    /** Po kroku NPC: poza ducha (start, lądowanie) wygrywa z modelem lotu. */
    afterNpc() {
      if (!this._placed || !this.npc) return;
      const q = _placedPose;
      env.place(this.npc, q.x, q.y, q.angle, q.vx, q.vy);
    },

    step(dt) {
      if (!(dt > 0)) return;
      this.clock += dt;
      this.t += dt;
      this._placed = false;
      const c = env.carrier();
      if (this.scan.cooldown > 0) this.scan.cooldown = Math.max(0, this.scan.cooldown - dt);
      // Fregata zestrzelona w locie.
      if (this.npc && (this.npc.dead || this.npc.destroyed) && this.phase !== P.LOST) {
        this.npc = null;
        this.controlling = false;
        this._systemsOff();
        this._setPhase(P.LOST);
        this.door = 0; this.lift = 0;
        this.emit('lost');
      }
      if (!c || c.dead || c.destroyed) { this._stepSystems(dt); this._stepMarks(); return; }
      switch (this.phase) {
        case P.OPENING: {
          // Fregata powstaje w świecie na dnie luku już przy otwieraniu (duch, poza od Atlasa) — obraz kadłuba
          // buduje się, zanim wrota się rozsuną.
          if (!this.npc) {
            this.npc = env.spawn(this._bayPose(c, _pose, 0));
            if (!this.npc) { this._setPhase(P.CLOSING); break; }
            this.npc.cloak = this.cloak;
            env.ghost(this.npc, true);
            this.lift = 0;
          }
          const pz0 = this._bayPose(c, _pose, 0);
          this._place(pz0.x, pz0.y, pz0.angle, pz0.vx, pz0.vy);
          this.door = Math.min(1, this.t / tune.doorTime);
          if (this.t >= tune.doorTime) this._setPhase(P.RISING);
          break;
        }
        case P.RISING: {
          this.lift = Math.min(1, this.t / tune.riseTime);
          const pz = this._bayPose(c, _pose, 0);
          this._place(pz.x, pz.y, pz.angle, pz.vx, pz.vy);
          if (this.t >= tune.riseTime) { this._departAlong = 0; this._setPhase(P.DEPARTING); }
          break;
        }
        case P.DEPARTING: {
          this._departAlong += tune.departSpeed * dt;
          const pz = this._bayPose(c, _pose, this._departAlong, tune.departSpeed);
          this._place(pz.x, pz.y, pz.angle, pz.vx, pz.vy);
          this.door = Math.max(0, 1 - this.t / tune.doorTime);
          const cr = Math.max(Number(c.w) || 0, Number(c.h) || 0) * 0.5;
          const off = hyp(pz.x - ex(c), pz.y - ey(c));
          if (off > cr + tune.clearMargin) {
            env.ghost(this.npc, false);
            this.cmdFace = pz.angle;
            this.cmdSpeed = pz.vx * Math.cos(pz.angle) + pz.vy * Math.sin(pz.angle);
            this.door = 0;
            this._setPhase(P.FLIGHT);
            this.emit('deployed', this.npc);
          }
          break;
        }
        case P.FLIGHT: {
          this._stepControl(dt);
          break;
        }
        case P.RETURNING: {
          const pz = this._bayPose(c, _pose, 0);
          const n = this.npc;
          const dx = pz.x - ex(n), dy = pz.y - ey(n);
          const d = hyp(dx, dy);
          const rvx = (n.vel?.x ?? n.vx ?? 0) - pz.vx, rvy = (n.vel?.y ?? n.vy ?? 0) - pz.vy;
          // Blisko Atlasa — duch (wchodzi nad kadłub); kurs Atlasa przy podejściu.
          const cr = Math.max(Number(c.w) || 0, Number(c.h) || 0) * 0.5;
          if (d < cr + tune.clearMargin) env.ghost(n, true);
          // Strefy unikania (setAvoid — np. zasięg wykrycia bazy): objazd po stycznej, prowadzenie co krok.
          if (this._avoidWaypoint(ex(n), ey(n), pz.x, pz.y, _wp)) {
            this._avoiding = true;
            env.fly(n, _wp.x, _wp.y, 0, 0, Math.atan2(_wp.y - ey(n), _wp.x - ex(n)), 0);
          } else {
            this._avoiding = false;
            const face = d < cr * 1.5 ? pz.angle : Math.atan2(dy, dx);
            env.fly(n, pz.x, pz.y, pz.vx, pz.vy, face, 0);
          }
          this.door = Math.min(1, this.door + dt / tune.doorTime * (d < cr * 3 ? 1 : 0));
          if ((d < tune.landRadius && hyp(rvx, rvy) < tune.landRelSpeed) || (this.t > tune.returnTimeout && !this._avoiding)) {
            env.ghost(n, true);
            this._landFrom = { x: ex(n) - pz.x, y: ey(n) - pz.y, a: wrap((n.angle || 0) - pz.angle) };
            this.door = 1;
            this._setPhase(P.LANDING);
          }
          break;
        }
        case P.LANDING: {
          const k = Math.min(1, this.t / tune.landTime);
          const s = k * k * (3 - 2 * k);
          const pz = this._bayPose(c, _pose, 0);
          const f = this._landFrom || { x: 0, y: 0, a: 0 };
          this._place(pz.x + f.x * (1 - s), pz.y + f.y * (1 - s), pz.angle + f.a * (1 - s), pz.vx, pz.vy);
          this.lift = 1 - s;
          if (k >= 1) {
            env.remove(this.npc);
            this.npc = null;
            this._setPhase(P.CLOSING);
            this.emit('landed');
          }
          break;
        }
        case P.CLOSING: {
          this.door = Math.max(0, this.door - dt / tune.doorTime);
          if (this.door <= 0) { this._setPhase(P.STOWED); this.emit('stowed'); }
          break;
        }
        default: break;
      }
      this._stepScan(dt);
      this._stepSystems(dt);
      this._stepMarks();
    },

    _stepControl(dt) {
      const n = this.npc;
      if (!n) return;
      const vmax = Math.max(100, Number(n.maxSpeed) || 400);
      const ctl = this.controlling ? this.ctl : _zero;
      this.cmdSpeed = Math.max(-vmax * tune.reverseFrac, Math.min(vmax, this.cmdSpeed + ctl.thrust * tune.accel * dt));
      this.cmdFace = wrap(this.cmdFace + ctl.turn * tune.turnRate * dt);
      const cs = Math.cos(this.cmdFace), sn = Math.sin(this.cmdFace);
      const lat = ctl.strafe * vmax * tune.strafeFrac;
      const vx = cs * this.cmdSpeed - sn * lat;
      const vy = sn * this.cmdSpeed + cs * lat;
      env.fly(n, ex(n) + vx * 0.6, ey(n) + vy * 0.6, vx, vy, this.cmdFace, vmax * 1.05);
      // Malowanie T (trzymane).
      const p = this.paint;
      if (p.held && this.controlling) {
        const e = this.pickAt(p.x, p.y, p.pickR);
        if (e) this.mark(e, 'manual');
      }
    },

    _stepScan(dt) {
      const s = this.scan;
      if (!s.active) return;
      s.t += dt;
      s.r = tune.scanRange * Math.min(1, s.t / tune.scanTime);
      const list = env.contacts(_contacts);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (hyp(ex(e) - s.x, ey(e) - s.y) - env.radius(e) <= s.r) this.mark(e, 'scan');
      }
      if (s.t >= tune.scanTime + 0.6) s.active = false;
    },

    _stepMarks() {
      for (const m of this.marks) {
        const e = m.entity;
        if (!m.destroyed && (!e || e.dead || e.destroyed)) {
          m.destroyed = true; m.visible = false;
          this.emit('markDestroyed', m);
          continue;
        }
        if (m.destroyed) continue;
        m.visible = env.visible(e);
        if (m.visible) { m.x = ex(e); m.y = ey(e); }
      }
    },

    /** Poza fregaty w luku (+ wylot `along` naprzód względem Atlasa). */
    _bayPose(c, out, along = 0, alongSpeed = 0) {
      const a = c.angle || 0;
      const cs = Math.cos(a), sn = Math.sin(a);
      const L = env.bayLocal || { x: 0, y: 0 };
      const lx = L.x + along, ly = L.y;
      const cx = ex(c), cy = ey(c);
      const vx = c.vel?.x ?? c.vx ?? 0, vy = c.vel?.y ?? c.vy ?? 0;
      const w = Number(c.angVel ?? c.angularVelocity ?? 0) || 0;
      const rx = cs * lx - sn * ly, ry = sn * lx + cs * ly;
      out.x = cx + rx; out.y = cy + ry; out.angle = a;
      out.vx = vx - w * ry + cs * alongSpeed;
      out.vy = vy + w * rx + sn * alongSpeed;
      return out;
    },

    _place(x, y, a, vx, vy) {
      const q = _placedPose;
      q.x = x; q.y = y; q.angle = a; q.vx = vx; q.vy = vy;
      this._placed = true;
      env.place(this.npc, x, y, a, vx, vy);
    },

    _setPhase(p) {
      if (this.phase === p) return;
      const prev = this.phase;
      this.phase = p;
      this.t = 0;
      this.emit('phase', { phase: p, prev });
    },

    /** Stan dla HUD / misji / testów. */
    state() {
      return {
        phase: this.phase, controlling: this.controlling, door: this.door, lift: this.lift,
        frigate: this.npc, marks: this.marks.length,
        scan: { active: this.scan.active, r: this.scan.r, cooldown: this.scan.cooldown },
        cloak: { state: this.cloak.state, energy: this.cloak.energy, hidden: this.cloakHidden() },
        eye: { on: this.eye.on, energy: this.eye.energy, x: this.eye.x, y: this.eye.y },
        long: { active: this.long.active, r: this.long.r, cooldown: this.long.cooldown },
        echoes: this.echoes.length
      };
    }
  };
  return bay;
}

const _pose = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
const _placedPose = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
const _wp = { x: 0, y: 0 };
const _contacts = [];
const _scanList = [];
const EYE_REVEAL_ID = 'scout-eye';
function hash01(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const _zero = Object.freeze({ thrust: 0, turn: 0, strafe: 0 });
