// src/game/supportWarp.js
//
// Wezwania i powrót skrzydła wsparcia przez tunel warpa „Nurt” (efekt: src/3d/warp/warpNurt.js,
// demo dema/warp-webgpu.html — scena „Wezwanie floty”: zwiastun → rozdarcie → wyrzut, a odlot
// wspak: punkt skoku przed dziobem → szczelina → okręt znika w niej od dziobu).
//
// Magazynu floty i ekonomii jeszcze nie ma, więc portem macierzystym wezwań jest Ziemia:
//  - WEZWANIE — okręt z zakładki wsparcia przylatuje OD Ziemi: kurs przylotu Ziemia → punkt
//    wyjścia, nić zwiastuna ciągnie się od strony Ziemi. Rozgrywka zna okręt dopiero w chwili
//    wyrzutu, więc efekt planuje się z wyprzedzeniem (WarpNurt.planArrival), a spawn czeka
//    w kolejce do chwili wyrzutu (zegar efektu WarpNurt.time — w pauzie stoi razem z efektem)
//    i dopiero wtedy stawia okręt w grze i podpina go do efektu (WarpNurt.attach);
//  - POWRÓT — jednostka obraca się dziobem do Ziemi i hamuje, ładuje skok, wchodzi w szczelinę
//    (duch — bez zderzeń) i wypada z gry: bez wraku, łupu i wybuchu (magazynu, do którego
//    mogłaby wrócić, jeszcze nie ma).
// Czysta logika bez DOM i three — zależności (spawn, sterowanie lotem, efekt) wstrzykuje gra.

/** Kąt do (−π, π]. */
export function wrapSupportWarpAngle(a) {
  let x = Number(a) || 0;
  if (x > Math.PI || x < -Math.PI) x = ((x + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return x;
}

/** Kurs z `from` do `to` (świat gry, y w dół); punkty prawie wspólne — `fallback`. */
export function supportWarpCourse(from, to, fallback = 0) {
  const dx = (Number(to?.x) || 0) - (Number(from?.x) || 0);
  const dy = (Number(to?.y) || 0) - (Number(from?.y) || 0);
  if (!(dx * dx + dy * dy > 1)) return Number(fallback) || 0;
  return Math.atan2(dy, dx);
}

/**
 * Kolejka wezwań. request(req) planuje przylot — efekt zaczyna się od razu (zwiastun, rozdarcie);
 * flush(lead) stawia okręty, których wyrzut wypada najpóźniej w najbliższej klatce efektu
 * (warp.time + lead ≥ tBurst: zegar efektu przesuwa render tej samej klatki).
 *
 * req: { x, y, angle, hullLength, hullWidth, palette, pirate, heraldReach, ...pola gry }.
 * deps:
 *   warp  — { time, planArrival(o) → rec | null, attach(rec, encja), arrive(encja) },
 *   spawn(req) → encja | encja[] | null — wołane w chwili wyrzutu,
 *   isHull(encja) → bool — encja z kadłubem do podpięcia (domyślnie: każda),
 *   onSpawned(lista, req) — po spawnie (kurs, prędkość, dziennik).
 */
export function createSupportWarpCallIns({ warp, spawn, isHull = () => true, onSpawned = null }) {
  const pending = [];
  return {
    pending,

    /** Planuje przylot; null — efekt niedostępny albo pula przylotów pełna (wołający spawnuje od razu). */
    request(req) {
      if (!req || !warp || typeof warp.planArrival !== 'function') return null;
      const rec = warp.planArrival({
        x: req.x, y: req.y, angle: req.angle, hullLength: req.hullLength, hullWidth: req.hullWidth,
        palette: req.palette, pirate: !!req.pirate, heraldReach: req.heraldReach
      });
      if (!rec || !rec.fx) return null;
      pending.push({ rec, req });
      return rec;
    },

    /** Stawia okręty z wyrzutem do `warp.time + lead`; zwraca liczbę obsłużonych wezwań. */
    flush(lead = 0) {
      if (!pending.length) return 0;
      const now = (Number(warp.time) || 0) + Math.max(0, Number(lead) || 0);
      let done = 0;
      let write = 0;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (!(p.rec.fx.tBurst <= now)) { pending[write++] = p; continue; }
        done++;
        const spawned = spawn(p.req);
        const list = Array.isArray(spawned) ? spawned.filter(Boolean) : (spawned ? [spawned] : []);
        let main = null;
        for (let k = 0; k < list.length; k++) {
          const e = list[k];
          if (!main && isHull(e)) { main = e; warp.attach(p.rec, e); }
          else if (isHull(e)) warp.arrive(e);   // reszta składu (wagony) wypada w tej samej chwili
        }
        onSpawned?.(list, p.req);
      }
      pending.length = write;
      return done;
    },

    clear() { pending.length = 0; }
  };
}

/** Strojenie powrotu (czas gry). */
export const SUPPORT_RETURN = Object.freeze({
  // Ładowanie zaczyna się, gdy kadłub prawie patrzy na Ziemię (resztę obrotu kończy w czasie
  // ładowania — ≥ 1,96 s) …
  alignTolerance: 12 * Math.PI / 180,
  // … i prawie stoi: punkt skoku i szczelina leżą przed dziobem, w świecie.
  settleSpeed: 120,
  // [s] superkapitał obraca się 15°/s (zawrócenie ~14 s) — dłużej nie czekamy.
  alignTimeout: 20,
  // [s] odstęp startów kolejnych odlotów (demo: 0,12 s na okręt).
  stagger: 0.12,
  // [s] pula efektów pełna tak długo — jednostka znika bez tunelu.
  queueTimeout: 12
});

/**
 * Powrót jednostek na Ziemię tunelem: 'align' (hamowanie, dziób do Ziemi) → 'charge' (ładowanie:
 * punkt skoku przed dziobem, okręt trzyma pozycję) → 'dive' (wejście w szczelinę — duch, drogę
 * prowadzi efekt) → usunięcie z gry.
 *
 * deps:
 *   warp    — { time, depart(encja, { angle, drive, onGone }) → rec | null } (rec.fx: x, y, tDive, tGone),
 *   origin  — () → { x, y } | null (Ziemia),
 *   hold(e, face, dt)       — hamuj do zera, kadłub na `face` (co klatkę w 'align'),
 *   keep(e, x, y, face, dt) — trzymaj punkt skoku (x, y) i kurs (co klatkę w 'charge'),
 *   dive(e, angle)          — okręt wchodzi w szczelinę (raz),
 *   remove(e)               — okręt zniknął w tunelu: usuń z gry (raz).
 */
export function createSupportReturn({ warp, origin, hold, keep, dive, remove, tune = SUPPORT_RETURN }) {
  const units = [];
  let clock = 0;
  let nextStart = 0;

  function add(e) {
    if (!e || e.dead || e.__warpReturn) return false;
    const u = { e, phase: 'align', t: 0, course: Number(e.angle) || 0, rec: null, gone: false };
    e.__warpReturn = u;
    units.push(u);
    return true;
  }

  function finish(u, removeEntity) {
    if (u.e.__warpReturn === u) u.e.__warpReturn = null;
    if (removeEntity) remove(u.e);
  }

  return {
    units,

    /** Dodaje jednostki do powrotu (żywe, jeszcze nie wracające); zwraca liczbę dodanych. */
    begin(list) {
      let n = 0;
      if (Array.isArray(list)) for (let i = 0; i < list.length; i++) if (add(list[i])) n++;
      return n;
    },

    has(e) { return !!e && !!e.__warpReturn && units.includes(e.__warpReturn); },

    /**
     * Klatka przed renderem (czas gry: dt; lead — o ile render tej klatki przesunie zegar efektu).
     * Duch od klatki, w której efekt zaczyna prowadzić okręt w szczelinę; usunięcie dopiero, gdy
     * efekt schował kadłub (onGone albo zegar efektu za tGone).
     */
    step(dt, lead = dt) {
      if (!units.length) return;
      const h = Math.max(0, Number(dt) || 0);
      clock += h;
      const t = Number(warp.time) || 0;
      const now = t + Math.max(0, Number(lead) || 0);
      const home = origin();
      let write = 0;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        const e = u.e;
        // Zniszczony w drodze (wrak powstał po staremu) albo usunięty inną ścieżką.
        if (e.dead || e.removed) { finish(u, false); continue; }
        if (u.phase === 'align') {
          u.t += h;
          if (home) u.course = supportWarpCourse(e, home, Number(e.angle) || 0);
          hold(e, u.course, h);
          const err = Math.abs(wrapSupportWarpAngle(u.course - (Number(e.angle) || 0)));
          const speed = Math.hypot(Number(e.vx) || 0, Number(e.vy) || 0);
          const ready = (err <= tune.alignTolerance && speed <= tune.settleSpeed) || u.t >= tune.alignTimeout;
          if (ready && clock >= nextStart) {
            const rec = warp.depart(e, { angle: u.course, drive: true, onGone: () => { u.gone = true; } });
            if (rec && rec.fx) {
              u.rec = rec;
              u.phase = 'charge';
              nextStart = clock + tune.stagger;
            } else if (u.t >= tune.alignTimeout + tune.queueTimeout) {
              finish(u, true);   // efektu brak (pula pełna) — okręt i tak odlatuje
              continue;
            }
          }
        } else if (u.phase === 'charge') {
          keep(e, u.rec.fx.x, u.rec.fx.y, u.course, h);
          if (now >= u.rec.fx.tDive) {
            u.phase = 'dive';
            dive(e, u.course);
          }
        } else if (u.phase === 'dive') {
          if (u.gone || t >= u.rec.fx.tGone) { finish(u, true); continue; }
        }
        units[write++] = u;
      }
      units.length = write;
    },

    clear() {
      for (const u of units) if (u.e.__warpReturn === u) u.e.__warpReturn = null;
      units.length = 0;
    }
  };
}
