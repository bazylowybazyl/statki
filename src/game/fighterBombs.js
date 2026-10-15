// src/game/fighterBombs.js
//
// BOMBY LOTNICZE (2026-10-14, prośba użytkownika: „bombowiec przelatuje NAD statkiem i zrzuca bomby NA
// statek”; broń `fighter_bomb` w src/data/weapons.js). Bomba spada na punkt kadłuba POD bombowcem w chwili
// zrzutu: od zrzutu jedzie z celem w jego układzie (pozycja i obrót celu), a po `fallTime` wybucha:
//   • cel zniknął (martwy, zniszczony, wrak to inny byt)  → nic (stats.lost),
//   • tarcza celu blokuje w tym punkcie, bez przebicia    → trafienie w tarczę (env.hitShield, stats.shield),
//   • w punkcie jest kadłub                               → trafienie w kadłub (env.hitHull, stats.hull),
//   • brak kadłuba (dziura w poszyciu, chybienie)         → przelatuje bez obrażeń (env.miss, stats.missed).
// Bomba nie leci w płaszczyźnie gry i nie jest pociskiem w `bullets`: nie trafia innych okrętów, nie jest
// celem obrony punktowej (spada 0,5 s — obronę przed bombowcem daje zestrzelenie go nad kadłubem).
//
// Moduł CZYSTY: bez window, DOM i three; losowanie tylko z generatora `env.random` (bez niego — bez rozrzutu);
// wszystkie zapytania i skutki przez `env`. Pula o stałej pojemności, bez alokacji na zrzut i na krok.
//
// env (wszystko opcjonalne poza tym, co ma działać):
//   shieldBlocks(target, x, y) → bool   — tarcza zatrzymuje bombę w punkcie (aktywna i bez przebicia)
//   hullAt(target, x, y) → bool         — w punkcie jest żywe poszycie (HullBodies.probe)
//   hitShield(target, x, y, dmg, def, bomb)
//   hitHull(target, x, y, dmg, def, bomb, relVx, relVy) — krater, HP, efekt; relV = kierunek wgniecenia
//   miss(x, y, def, bomb)               — słaby błysk (bez obrażeń)
//   alive(target) → bool                — dodatkowy test życia celu (domyślnie: !dead && !destroyed)
//   pose(target, out) → bool            — poza celu { x, y, angle } (domyślnie pos ?? x, angle)
//   velocity(entity, out) → bool        — prędkość { x, y } (domyślnie vel ?? vx/vy) — kierunek wgniecenia
//   random() → [0, 1)                   — generator gry (rozrzut punktu upadku `def.bombScatter`)
//   player                              — encja gracza (strona bomby), albo isFriendly(bomber) → bool

/** Pojemność puli bomb (bomby w locie naraz). */
export const FIGHTER_BOMB_CAP = 256;
/** Domyślny czas spadania [s], gdy broń go nie podaje. */
export const FIGHTER_BOMB_FALL_DEFAULT = 0.5;
/** Ułamek prędkości bombowca względem celu w chwili zrzutu, który idzie jako kierunek wgniecenia krateru. */
export const FIGHTER_BOMB_DENT_K = 0.25;

const _pose = { x: 0, y: 0, angle: 0 };
const _vel = { x: 0, y: 0 };

function defaultPose(t, out) {
  const px = t.pos ? Number(t.pos.x) : NaN;
  const py = t.pos ? Number(t.pos.y) : NaN;
  out.x = Number.isFinite(px) ? px : Number(t.x);
  out.y = Number.isFinite(py) ? py : Number(t.y);
  out.angle = Number(t.angle) || 0;
  return Number.isFinite(out.x) && Number.isFinite(out.y);
}

function defaultVelocity(e, out) {
  const vx = e.vel ? Number(e.vel.x) : NaN;
  const vy = e.vel ? Number(e.vel.y) : NaN;
  out.x = Number.isFinite(vx) ? vx : (Number(e.vx) || 0);
  out.y = Number.isFinite(vy) ? vy : (Number(e.vy) || 0);
  return true;
}

function makeBomb() {
  return {
    active: false,
    target: null,
    bomber: null,
    def: null,
    /** Strona zrzucającego: true — gracz i sojusznicy. */
    friendly: false,
    damage: 0,
    age: 0,
    fallTime: FIGHTER_BOMB_FALL_DEFAULT,
    /** Punkt upadku w układzie celu (obrócony o −kąt celu w chwili zrzutu). */
    lx: 0,
    ly: 0,
    /** Kurs bomby względem kursu celu (rysunek: kurs z chwili zrzutu, obraca się z celem). */
    relHeading: 0,
    /** Pozycja i kurs w świecie (aktualne po ostatnim kroku). */
    x: 0,
    y: 0,
    heading: 0,
    /** Postęp spadania 0 → 1 (rysunek: bomba maleje i blednie). */
    t: 0,
    /** Promień bomby przy zrzucie [j. świata] (rysunek). */
    radius: 5,
    /** Prędkość bombowca względem celu w chwili zrzutu × FIGHTER_BOMB_DENT_K (kierunek wgniecenia). */
    relVx: 0,
    relVy: 0,
    /** Cel zniknął w trakcie spadania — bomba stoi w świecie i gaśnie bez wybuchu. */
    orphan: false
  };
}

/**
 * Bomby lotnicze — `createFighterBombs(env)` → obiekt z:
 *   drop(bomber, target, def, damage?) → true / false — zrzut na punkt pod bombowcem,
 *   canDrop(bomber, target) → bool — czy pod bombowcem jest poszycie celu (env.hullAt),
 *   step(dt) — spadanie, jazda z celem, wybuchy,
 *   forEach(fn) / list (pierwsze `count` wpisów) — bomby w locie do rysowania,
 *   count, clear(), stats { dropped, hull, shield, missed, lost, overflow }.
 */
export function createFighterBombs(env = {}) {
  const pool = new Array(FIGHTER_BOMB_CAP);
  for (let i = 0; i < FIGHTER_BOMB_CAP; i++) pool[i] = makeBomb();
  const stats = { dropped: 0, hull: 0, shield: 0, missed: 0, lost: 0, overflow: 0 };

  const poseOf = typeof env.pose === 'function' ? env.pose : defaultPose;
  const velOf = typeof env.velocity === 'function' ? env.velocity : defaultVelocity;

  function targetAlive(t) {
    if (!t || t.dead || t.destroyed) return false;
    if (typeof env.alive === 'function' && !env.alive(t)) return false;
    return true;
  }

  function sideOf(bomber) {
    if (typeof env.isFriendly === 'function') return !!env.isFriendly(bomber);
    return !!bomber && (bomber === env.player || bomber.friendly === true);
  }

  function release(i) {
    const b = pool[i];
    b.active = false;
    b.target = null;
    b.bomber = null;
    b.def = null;
    const last = api.count - 1;
    if (i !== last) {
      pool[i] = pool[last];
      pool[last] = b;
    }
    api.count = last;
  }

  /** Pozycja bomby w świecie z pozy celu (pose = _pose już wypełnione). */
  function place(b, pose) {
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    b.x = pose.x + b.lx * c - b.ly * s;
    b.y = pose.y + b.lx * s + b.ly * c;
    b.heading = pose.angle + b.relHeading;
  }

  function detonate(b) {
    const t = b.target;
    if (b.orphan || !targetAlive(t)) {
      stats.lost++;
      return;
    }
    const x = b.x;
    const y = b.y;
    if (typeof env.shieldBlocks === 'function' && env.shieldBlocks(t, x, y)) {
      stats.shield++;
      if (typeof env.hitShield === 'function') env.hitShield(t, x, y, b.damage, b.def, b);
      return;
    }
    if (typeof env.hullAt === 'function' && env.hullAt(t, x, y)) {
      stats.hull++;
      if (typeof env.hitHull === 'function') env.hitHull(t, x, y, b.damage, b.def, b, b.relVx, b.relVy);
      return;
    }
    stats.missed++;
    if (typeof env.miss === 'function') env.miss(x, y, b.def, b);
  }

  const api = {
    /** Bomby w locie: pierwsze `count` wpisów (kolejność dowolna, wpisy z puli — tylko do odczytu). */
    list: pool,
    count: 0,
    stats,

    /** Czy pod bombowcem jest poszycie celu — test dla mózgu bombowca (bez env.hullAt: true). */
    canDrop(bomber, target) {
      if (!bomber || !targetAlive(target)) return false;
      if (!defaultPose(bomber, _pose)) return false;
      if (typeof env.hullAt !== 'function') return true;
      return !!env.hullAt(target, _pose.x, _pose.y);
    },

    /**
     * Zrzut bomby `def` (fighter_bomb) z `bomber` na `target`: punkt upadku = pozycja bombowca (+ rozrzut
     * `def.bombScatter` z env.random), w układzie celu. Obrażenia: `damage` albo def.baseDamage. false —
     * cel martwy, brak pozy albo pełna pula. Nie sprawdza, czy pod bombowcem jest kadłub (canDrop).
     */
    drop(bomber, target, def, damage) {
      if (!bomber || !def || !targetAlive(target)) return false;
      if (!defaultPose(bomber, _pose)) return false;
      let bx = _pose.x;
      let by = _pose.y;
      const bomberAngle = _pose.angle;
      const scatter = Number(def.bombScatter) || 0;
      if (scatter > 0 && typeof env.random === 'function') {
        const a = env.random() * Math.PI * 2;
        const r = scatter * Math.sqrt(env.random());
        bx += Math.cos(a) * r;
        by += Math.sin(a) * r;
      }
      if (!poseOf(target, _pose)) return false;
      if (api.count >= FIGHTER_BOMB_CAP) { stats.overflow++; return false; }
      const b = pool[api.count++];
      b.active = true;
      b.target = target;
      b.bomber = bomber;
      b.def = def;
      b.friendly = sideOf(bomber);
      const dmg = Number(damage);
      b.damage = Number.isFinite(dmg) && dmg >= 0 ? dmg : (Number(def.baseDamage) || 0);
      b.age = 0;
      const ft = Number(def.fallTime);
      b.fallTime = ft > 0 ? ft : FIGHTER_BOMB_FALL_DEFAULT;
      b.t = 0;
      b.radius = Number(def.bombRadius) > 0 ? Number(def.bombRadius) : 5;
      b.orphan = false;
      const c = Math.cos(_pose.angle);
      const s = Math.sin(_pose.angle);
      const dx = bx - _pose.x;
      const dy = by - _pose.y;
      b.lx = dx * c + dy * s;
      b.ly = -dx * s + dy * c;
      b.relHeading = bomberAngle - _pose.angle;
      b.x = bx;
      b.y = by;
      b.heading = bomberAngle;
      // Kierunek wgniecenia: ruch bombowca względem celu w chwili zrzutu (bomba schodzi skosem).
      velOf(bomber, _vel);
      const bvx = _vel.x;
      const bvy = _vel.y;
      velOf(target, _vel);
      b.relVx = (bvx - _vel.x) * FIGHTER_BOMB_DENT_K;
      b.relVy = (bvy - _vel.y) * FIGHTER_BOMB_DENT_K;
      stats.dropped++;
      return true;
    },

    /** Krok spadania (czas gry): bomby jadą z celem, po fallTime wybuchają. */
    step(dt) {
      const d = Number(dt) || 0;
      if (!(d > 0) || api.count === 0) return;
      for (let i = api.count - 1; i >= 0; i--) {
        const b = pool[i];
        b.age += d;
        if (!b.orphan) {
          if (targetAlive(b.target) && poseOf(b.target, _pose)) place(b, _pose);
          else b.orphan = true;   // cel zniknął: bomba stoi w ostatnim miejscu i gaśnie bez wybuchu
        }
        b.t = Math.min(1, b.age / b.fallTime);
        if (b.age >= b.fallTime) {
          detonate(b);
          release(i);
        }
      }
    },

    /** fn(bomba) dla każdej bomby w locie (rysunek). */
    forEach(fn) {
      for (let i = 0; i < api.count; i++) fn(pool[i]);
    },

    /** Usuwa wszystkie bomby bez wybuchu (nowa gra, zmiana sceny). */
    clear() {
      for (let i = 0; i < api.count; i++) {
        const b = pool[i];
        b.active = false;
        b.target = null;
        b.bomber = null;
        b.def = null;
      }
      api.count = 0;
    }
  };
  return api;
}
