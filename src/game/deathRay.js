// src/game/deathRay.js
//
// PROMIEŃ ŚMIERCI — rozgrywka (2026-10-19, prośba użytkownika: „brakuje ogromnego lasera, który ma Venator — broń
// death ray: na strzała niszczy battleship”; dane `death_ray` w src/data/weapons.js, obraz: receptura `deathRay`
// w src/3d/weapons/recipes.js i WeaponFx.deathRay* — wyłącznie przez rekordy RAY_* strumienia rozkazów).
//
// Promień = odcinek od wylotu w STAŁYM kierunku świata; wylot jedzie z kadłubem strzelca (przesunięcie w jego układzie).
// Czoło biegnie `frontSpeed` j/s i w każdym kroku fizyki przetwarza odcinek [poprzednie czoło, nowe czoło]:
//   • pierwszy kontakt z obwiednią celu (kadłub ∪ tarcza + półszerokość rzazu): `traceThrough` po cięciwie (tylko
//     odczyt, PRZED rzazem) — wejście, wyjście i droga w materiale. Decyzja zapada, gdy czoło dojdzie do materiału
//     (kolejność wejścia): okręt ponad `penetration` ZATRZYMUJE promień na wejściu (krater, ułamek obrażeń), pozostałe
//     są przecinane na wylot. JEDEN CEL (`singleTarget`, broń `death_ray` od 2026-10-20): promień kończy się tuż za
//     wyjściem z ostatniego przebitego okrętu i najdalej za celem strzału (`o.target`) — dalej nikogo nie rani;
//   • tarcza blokująca PADA DO ZERA, gdy czoło dojdzie do jej obrysu — świadomie bez testu przebicia
//     (`isShieldBreachedAt`): to superbroń, a pole i tak dostaje efekt trafienia klasy „special”;
//   • rzaz: HullBodies.cutSegment(…, { push: true }) na części odcinka kroku w [wejście, wyjście] (pas ±
//     `cutHalfWidth`: odłamki i odcięte części lecą wzdłuż toru), źródło mapy ran = broń (stempel `deathRay`/`kerf`);
//   • czoło za wyjściem: obrażenia baseDamage × min(1, droga / fullDepth) (≥ minFrac) z pominięciem tarczy — śmierć,
//     wrak (convertToWreck / shatter) i wybuch zbiornika paliwa robi gra jak przy każdej śmierci (env.damage);
//   • stacja na drodze: obrażenia raz, promień kończy się na niej.
// Wraki są cięte, ale nie liczą się do przebić i nie dostają obrażeń; cel bez kadłuba (myśliwiec) — trafienie = obrażenia.
//
// Haki dla scen (scena „Wojna”): `order(strzelec, cel, opts)` — ładowanie przy wylocie strzelca i strzał w aktualną
// pozycję celu (prawdziwe encje), `visual(x0, y0, x1, y1, opts)` — ten sam obraz bez trafień (warstwy bitwy w głębi:
// z0 / z1, barwa, szerokość). Moduł czysty: bez three i DOM, bez Math.random, bez alokacji w kroku (pule).

import { MASTER_WEAPONS } from '../data/weapons.js';
import { weaponRangeFor } from './shipModifiers.js';
// Kody rekordów promienia — wspólne z dekoderem renderu (src/render/renderCommands.js; render nie importuje src/game).
import { RAY_HIT, RAY_STATE, RAY_FLAG } from '../render/renderCommands.js';
// Lufa wieży (czysta geometria sylwetki — jak WeaponController.computeMountedMuzzle): wylot NPC z czopu gniazda.
import { Turret2D } from '../vfx/turret2D.js';

export { RAY_HIT, RAY_STATE, RAY_FLAG };

/** Domyślne nastawy (pole `deathRay` broni bierze górę). */
export const DEATH_RAY_DEFAULTS = Object.freeze({
  width: 150, cutHalfWidth: 55, frontSpeed: 30000, sustain: 1.1, fade: 0.5,
  fullDepth: 200, minFrac: 0.15, endDamageFrac: 0.35, endCrater: 90, stationDamage: 30000, singleTarget: false
});
/** Jeden cel: zapas promienia za wyjściem z przebitego okrętu [j.] (ponad pas rzazu) i za obwiednią celu strzału. */
const SINGLE_EXIT_PAD = 30;
const SINGLE_TARGET_PAD = 300;

/** Pojemności pul. */
export const DEATH_RAY_CAP = 16;
export const DEATH_RAY_TARGET_CAP = 32;
export const DEATH_RAY_ORDER_CAP = 16;
/** Ile ciągłych odcinków materiału sumuje pomiar drogi (kadłub z przerwami — hangary, wcięcia). */
const TRACE_RUNS = 6;

const _params = new WeakMap();

/** Nastawy promienia broni (raz na opis broni, zamrożone). */
export function deathRayParams(def) {
  if (!def || typeof def !== 'object') return DEATH_RAY_DEFAULTS;
  let p = _params.get(def);
  if (!p) {
    const own = def.deathRay && typeof def.deathRay === 'object' ? def.deathRay : null;
    const pick = (k) => {
      const v = Number(own?.[k]);
      return Number.isFinite(v) && v >= 0 ? v : DEATH_RAY_DEFAULTS[k];
    };
    p = Object.freeze({
      width: pick('width'), cutHalfWidth: pick('cutHalfWidth'), frontSpeed: Math.max(1000, pick('frontSpeed')),
      sustain: pick('sustain'), fade: Math.max(0.05, pick('fade')), fullDepth: Math.max(1, pick('fullDepth')),
      minFrac: Math.min(1, pick('minFrac')), endDamageFrac: pick('endDamageFrac'), endCrater: pick('endCrater'),
      stationDamage: pick('stationDamage'), singleTarget: own?.singleTarget === true
    });
    _params.set(def, p);
  }
  return p;
}

/** Czy broń jest promieniem śmierci (ścieżka fireWeaponCore → system promieni). */
export function isDeathRayWeapon(def) {
  return !!(def && typeof def === 'object' && def.deathRay);
}

/**
 * Obrażenia kadłuba z drogi promienia w materiale [j.]: baseDamage × min(1, droga / fullDepth), najmniej minFrac
 * (otarcie). Pancernik (12 000) ginie przy drodze ≥ 120 j. (z 20 000 obr.) — każde przejście przez kadłub.
 */
export function deathRayHullDamage(damage, path, params = DEATH_RAY_DEFAULTS) {
  const d = Number(damage) || 0;
  const p = Math.max(0, Number(path) || 0);
  const f = Math.min(1, Math.max(params.minFrac, p / params.fullDepth));
  return d * f;
}

/** Czas życia obrazu promienia [s] przy długości `len`. */
export function deathRayLife(len, params = DEATH_RAY_DEFAULTS) {
  return Math.max(0, Number(len) || 0) / params.frontSpeed + params.sustain + params.fade;
}

function posX(e) { return Number.isFinite(e?.x) ? e.x : (Number(e?.pos?.x) || 0); }
function posY(e) { return Number.isFinite(e?.y) ? e.y : (Number(e?.pos?.y) || 0); }
function velX(e) { return Number.isFinite(e?.vx) ? e.vx : (Number(e?.vel?.x) || 0); }
function velY(e) { return Number.isFinite(e?.vy) ? e.vy : (Number(e?.vel?.y) || 0); }

function createTarget() {
  return {
    e: null, state: 0, wreck: false, ship: false, hull: false, block: false, decided: false, solid: false,
    tIn: 0, tOut: 0, path: 0, chordIn: 0, chordOut: 0, sIn: -1, shieldDone: false, entered: false, key: 0, killed: 0,
    cutAt: -Infinity
  };
}

function createRay() {
  const targets = [];
  for (let i = 0; i < DEATH_RAY_TARGET_CAP; i++) targets.push(createTarget());
  return {
    active: false, id: 0, def: null, params: DEATH_RAY_DEFAULTS, shooter: null, byPlayer: false, visual: false,
    lx: 0, ly: 0, ox: 0, oy: 0, dx: 1, dy: 0, z0: 0, z1: 0,
    range: 0, len: 0, front: 0, frontSpeed: 30000, halfWidth: 55, width: 150, damage: 0, pen: 0, committed: 0,
    age: 0, life: 0, done: false, stopped: false, steps: 0,
    colR: NaN, colG: NaN, colB: NaN, flags: 0,
    targets, targetCount: 0, stations: [],
    cutNodes: 0, hullsCut: 0, kills: 0
  };
}

function createOrder() {
  return {
    active: false, id: 0, kind: 'shot', shooter: null, target: null, tx: 0, ty: 0, def: null, t: 0, charge: 0,
    // wizualny: punkty i z, barwa, szerokość, czas trwania
    x0: 0, y0: 0, x1: 0, y1: 0, z0: 0, z1: 0, opts: null, ray: null, state: 'charging', mx: 0, my: 0, angle: 0, hasHp: false
  };
}

const PUSH = Object.freeze({ push: true });

/**
 * System promieni śmierci. env — klej gry (index.html, blok „PROMIEŃ ŚMIERCI”; testy — atrapy):
 *   hulls                         HullBodies (cutSegment, traceThrough, impact, sweepResult)
 *   time()                        czas symulacji [s]
 *   collect(out)                  kandydaci z kadłubem / punktami (gracz, NPC, wraki) — dopisuje do out
 *   stations()                    tablica stacji albo null
 *   stationHit(st, x0, y0, x1, y1) → ułamek odcinka wejścia w bryłę stacji albo −1
 *   radius(e)                     promień obwiedni celu (getBeamTargetRadius)
 *   shieldRadius(e)               promień blokującej tarczy (0 — brak / nie blokuje)
 *   shieldEnter(e, x, y, dx, dy, maxT) → wejście w obrys blokującej tarczy albo −1
 *   collapseShield(e, x, y, dmg)  tarcza pada (efekt + val = 0)
 *   damage(e, dmg, ray)           obrażenia kadłuba z pominięciem tarczy (NPC / gracz) — ray.byPlayer, ray.shooter
 *   damageStation(st, dmg, ray)
 *   isWreck(e), alive(e)
 *   setSource(def, variant) / clearSource()   źródło stempla mapy ran (HullDamageEvents)
 *   fx()                          pisarz rekordów (RenderCommands.writer) albo null (render niegotowy)
 *   carrier(e, x, y, out)         nośnik efektu (writeCarrier)
 *   muzzleOf(shooter, def, out)   wylot strzelca dla rozkazu sceny (gniazdo z promieniem, inaczej dziób) → out.x, out.y
 */
export function createDeathRaySystem(env) {
  const rays = [];
  for (let i = 0; i < DEATH_RAY_CAP; i++) rays.push(createRay());
  const orders = [];
  for (let i = 0; i < DEATH_RAY_ORDER_CAP; i++) orders.push(createOrder());
  const _cand = [];
  const _order = [];
  const _carrier = { x: 0, y: 0, z: 0, vx: 0, vy: 0, clock: 0, t0: 0 };
  const _trace = { solidLen: 0, entryT: -1, exitT: -1, node: -1 };
  const _impactVel = { x: 0, y: 0 };
  const _mz = { x: 0, y: 0 };
  const _off = { x: 0, y: 0 };

  // Koniec lufy wieży z promieniem: czop (x, y) + przesunięcie wylotu sylwetki obrócone o kąt lufy. Tylko geometria
  // (bez rekordów klatki — wynik nie zależy od kamery). Zwraca out.
  function barrelTip(shooter, def, x, y, angle, out) {
    out.x = x; out.y = y;
    if (!shooter || typeof Turret2D?.writeMuzzleOffset !== 'function') return out;
    Turret2D.writeMuzzleOffset(shooter, def, 0, _off);
    const c = Math.cos(angle), s = Math.sin(angle);
    out.x = x + _off.x * c - _off.y * s;
    out.y = y + _off.x * s + _off.y * c;
    return out;
  }
  let nextId = 1;
  const stats = { fired: 0, visual: 0, orders: 0, hulls: 0, kills: 0, cutNodes: 0, shields: 0, stations: 0, blocked: 0, small: 0 };
  const hulls = env.hulls;

  function fxWriter() { return typeof env.fx === 'function' ? env.fx() : null; }

  function carrierOf(e, x, y) {
    if (e && typeof env.carrier === 'function') return env.carrier(e, x, y, _carrier);
    _carrier.x = _carrier.y = _carrier.vx = _carrier.vy = _carrier.z = 0; _carrier.t0 = env.time ? env.time() : 0; _carrier.clock = 0;
    return _carrier;
  }

  function acquireRay() {
    let oldest = null;
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      if (!r.active) return r;
      if (!oldest || r.age > oldest.age) oldest = r;
    }
    releaseRay(oldest);
    return oldest;
  }

  function releaseRay(r) {
    r.active = false;
    r.shooter = null;
    r.def = null;
    for (let i = 0; i < r.targetCount; i++) r.targets[i].e = null;
    r.targetCount = 0;
    r.stations.length = 0;
  }

  // Wylot w świecie z przesunięcia w układzie strzelca (jedzie z kadłubem: ruch i obrót).
  function updateOrigin(r) {
    const s = r.shooter;
    if (!s || r.visual) return;
    if (typeof env.alive === 'function' && !env.alive(s)) return;
    const a = Number(s.angle) || 0;
    const c = Math.cos(a), sn = Math.sin(a);
    r.ox = posX(s) + r.lx * c - r.ly * sn;
    r.oy = posY(s) + r.lx * sn + r.ly * c;
  }

  function writeFire(r) {
    const w = fxWriter();
    if (!w || typeof w.deathRayFire !== 'function') return;
    const c = r.visual && !r.shooter ? carrierOf(null, r.ox, r.oy) : carrierOf(r.shooter, r.ox, r.oy);
    w.deathRayFire(r, c);
  }

  function writeHit(r, kind, x, y, nx, ny, e, t, power = 1) {
    const w = fxWriter();
    if (!w || typeof w.deathRayHit !== 'function') return;
    const c = carrierOf(e, x, y);
    const rvx = r.dx * r.frontSpeed - (Number(c.vx) || 0);
    const rvy = r.dy * r.frontSpeed - (Number(c.vy) || 0);
    w.deathRayHit(r.id, kind, x, y, nx, ny, rvx, rvy, e, power, t, c);
  }

  function writeState(r, code) {
    const w = fxWriter();
    if (!w || typeof w.deathRayState !== 'function') return;
    w.deathRayState(r.id, r.len, code);
  }

  /**
   * Strzał promienia: strzelec (encja albo null), opis broni, wylot (świat) i kierunek. o: { range, damage, byPlayer,
   * penetration, width, color: [r, g, b] (liniowo 0..1; brak — z broni), visual, z0, z1, endFlash, frontSpeed,
   * addBarrel — wylot podany na czopie gniazda: dołóż lufę wieży wzdłuż kierunku strzału, target — cel strzału
   * (broń `singleTarget`: promień kończy się za jego obwiednią) }.
   * Zwraca promień (obiekt z puli — ważny do końca jego życia) albo null.
   */
  function fire(shooter, def, x, y, dirX, dirY, o = null) {
    const d = def && typeof def === 'object' ? def : MASTER_WEAPONS[def] || MASTER_WEAPONS.death_ray;
    const p = deathRayParams(d);
    const l = Math.sqrt(dirX * dirX + dirY * dirY);
    if (!(l > 1e-9) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (o?.addBarrel && shooter) {
      barrelTip(shooter, d, x, y, Math.atan2(dirY, dirX), _mz);
      x = _mz.x; y = _mz.y;
    }
    const r = acquireRay();
    r.active = true;
    r.id = nextId++;
    r.def = d;
    r.params = p;
    r.shooter = shooter || null;
    r.visual = !!o?.visual;
    r.byPlayer = !!o?.byPlayer;
    r.dx = dirX / l; r.dy = dirY / l;
    r.ox = x; r.oy = y;
    r.z0 = Number(o?.z0) || 0;
    r.z1 = Number.isFinite(Number(o?.z1)) ? Number(o.z1) : r.z0;
    if (r.shooter && !r.visual) {
      const a = Number(r.shooter.angle) || 0;
      const c = Math.cos(a), s = Math.sin(a);
      const ex = x - posX(r.shooter), ey = y - posY(r.shooter);
      r.lx = ex * c + ey * s;
      r.ly = -ex * s + ey * c;
    } else {
      r.lx = r.ly = 0;
    }
    const range = Number(o?.range);
    r.range = Number.isFinite(range) && range > 0 ? range : weaponRangeFor(shooter, d, Number(d.baseRange) || 6000);
    r.len = r.range;
    // Jeden cel: promień nie leci dalej niż za obwiednię celu strzału — także gdy kadłub celu się wymknie (linia
    // ognia AI sprawdza drogę tylko do celu, sojusznik za nim byłby bez ochrony).
    const tg = o?.target;
    if (p.singleTarget && !r.visual && tg && typeof tg === 'object') {
      const proj = (posX(tg) - x) * r.dx + (posY(tg) - y) * r.dy;
      const rad = typeof env.radius === 'function' ? env.radius(tg) : (Number(tg.radius) || 200);
      if (proj > 0) r.len = Math.min(r.len, proj + rad * 1.2 + SINGLE_TARGET_PAD);
    }
    r.front = 0;
    r.frontSpeed = Number(o?.frontSpeed) > 0 ? Number(o.frontSpeed) : p.frontSpeed;
    r.halfWidth = p.cutHalfWidth;
    r.width = Number(o?.width) > 0 ? Number(o.width) : p.width;
    const dmg = Number(o?.damage);
    r.damage = Number.isFinite(dmg) ? dmg : (Number(d.baseDamage) || 0);
    const pen = Number(o?.penetration);
    r.pen = Number.isFinite(pen) ? Math.max(0, pen) : Math.max(0, Number(d.penetration) || 0);
    r.committed = 0;
    r.age = 0;
    r.steps = 0;
    r.life = deathRayLife(r.len, p);
    r.done = false;
    r.stopped = false;
    r.targetCount = 0;
    r.stations.length = 0;
    r.cutNodes = 0; r.hullsCut = 0; r.kills = 0;
    const col = o?.color;
    r.colR = col ? Number(col[0]) : NaN; r.colG = col ? Number(col[1]) : NaN; r.colB = col ? Number(col[2]) : NaN;
    r.flags = (r.visual ? RAY_FLAG.VISUAL : 0) | (r.byPlayer ? RAY_FLAG.PLAYER : 0) | (o?.endFlash ? RAY_FLAG.END_FLASH : 0);
    if (r.visual) stats.visual++; else stats.fired++;
    writeFire(r);
    return r;
  }

  /**
   * Strzał wyłącznie obrazowy (bez trafień): od (x0, y0) do (x1, y1), o: { width, color, z0, z1, frontSpeed,
   * charge [s] — ładowanie przy wylocie przed strzałem, impact (domyślnie true) — rozbłysk na końcu }. Warstwy bitwy
   * w głębi (scena „Wojna”): ten sam obraz co prawdziwy promień. Zwraca rozkaz (ładowanie) albo promień.
   */
  function visual(x0, y0, x1, y1, o = null) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 1)) return null;
    const charge = Math.max(0, Number(o?.charge) || 0);
    if (charge > 0) {
      const ord = acquireOrder();
      ord.kind = 'visual';
      ord.shooter = null;
      ord.target = null;
      ord.def = MASTER_WEAPONS.death_ray;
      ord.charge = charge;
      ord.t = 0;
      ord.x0 = x0; ord.y0 = y0; ord.x1 = x1; ord.y1 = y1;
      ord.z0 = Number(o?.z0) || 0; ord.z1 = Number.isFinite(Number(o?.z1)) ? Number(o.z1) : ord.z0;
      ord.opts = o;
      ord.state = 'charging';
      stats.orders++;
      return ord;
    }
    return fire(null, MASTER_WEAPONS.death_ray, x0, y0, dx, dy, {
      visual: true, range: len, width: o?.width, color: o?.color, z0: o?.z0, z1: o?.z1,
      frontSpeed: o?.frontSpeed, endFlash: o?.impact !== false
    });
  }

  function acquireOrder() {
    for (let i = 0; i < orders.length; i++) if (!orders[i].active) { orders[i].active = true; orders[i].id = nextId++; return orders[i]; }
    // pełna pula: najstarszy rozkaz ustępuje
    const o = orders[0];
    o.active = true;
    o.id = nextId++;
    return o;
  }

  /**
   * Rozkaz sceny: strzelec ładuje promień `opts.charge` s (domyślnie chargeTime broni) przy swoim wylocie
   * (env.muzzleOf — gniazdo z promieniem albo dziób) i strzela w AKTUALNĄ pozycję celu (encja albo { x, y }).
   * opts: { charge, damage, range, penetration, width, color, weapon (id) }. Zwraca rozkaz ({ state: 'charging' |
   * 'fired' | 'cancelled', ray }).
   */
  function order(shooter, target, opts = null) {
    if (!shooter) return null;
    const def = (opts?.weapon && MASTER_WEAPONS[opts.weapon]) || MASTER_WEAPONS.death_ray;
    const ord = acquireOrder();
    ord.kind = 'shot';
    ord.shooter = shooter;
    ord.target = target && typeof target === 'object' ? target : null;
    ord.tx = Number(target?.x) || 0; ord.ty = Number(target?.y) || 0;
    ord.def = def;
    const ch = Number(opts?.charge);
    ord.charge = Number.isFinite(ch) && ch >= 0 ? ch : (Number(def.chargeTime) || 0);
    ord.t = 0;
    ord.opts = opts;
    ord.ray = null;
    ord.state = 'charging';
    stats.orders++;
    return ord;
  }

  function orderAim(ord) {
    const tg = ord.target;
    if (tg) {
      ord.tx = posX(tg); ord.ty = posY(tg);
    }
    ord.hasHp = false;
    if (ord.kind === 'visual') {
      ord.mx = ord.x0; ord.my = ord.y0;
    } else if (typeof env.muzzleOf === 'function' && env.muzzleOf(ord.shooter, ord.def, _mz)) {
      ord.mx = _mz.x; ord.my = _mz.y;
      ord.hasHp = true;
    } else {
      // dziób: środek + kierunek kadłuba × promień
      const a = Number(ord.shooter.angle) || 0;
      const rr = (typeof env.radius === 'function' ? env.radius(ord.shooter) : 200) * 0.6;
      ord.mx = posX(ord.shooter) + Math.cos(a) * rr; ord.my = posY(ord.shooter) + Math.sin(a) * rr;
    }
    const tx = ord.kind === 'visual' ? ord.x1 : ord.tx;
    const ty = ord.kind === 'visual' ? ord.y1 : ord.ty;
    ord.angle = Math.atan2(ty - ord.my, tx - ord.mx);
    // gniazdo strzelca: wylot na końcu lufy (kierunek do celu)
    if (ord.kind === 'shot' && ord.hasHp) {
      barrelTip(ord.shooter, ord.def, ord.mx, ord.my, ord.angle, _mz);
      ord.mx = _mz.x; ord.my = _mz.y;
    }
  }

  /**
   * Efekt ładowania NPC (capitalAI.stepNpcWeaponCharge → hak gry spawnWeaponChargeFx): wylot na końcu lufy wieży
   * (czop gniazda + lufa sylwetki) i rekord ładowania promienia RAY_CHARGE (receptura `deathRay` — implozja, laser
   * naprowadzający). stateOwner — obiekt gry ze stanem efektu (działo NPC); target — cel AI: laser kończy się na nim
   * (jeden cel — strzał nie sięgnie dalej), bez celu — zasięg broni.
   */
  function chargeFx(shooter, def, x, y, angle, u, dt, stateOwner, target = null) {
    const w = fxWriter();
    if (!w || !shooter) return;
    barrelTip(shooter, def, x, y, angle, _mz);
    const c = carrierOf(shooter, _mz.x, _mz.y);
    const range = weaponRangeFor(shooter, def, Number(def.baseRange) || 6000);
    let guide = range;
    if (target && typeof target === 'object') {
      const gx = posX(target) - _mz.x, gy = posY(target) - _mz.y;
      guide = Math.min(range, Math.sqrt(gx * gx + gy * gy));
    }
    if (typeof w.deathRayCharge === 'function') w.deathRayCharge(stateOwner, _mz.x, _mz.y, 0, angle, u, dt, 1, null, c, guide);
    else if (typeof w.charge === 'function') w.charge(def.id, _mz.x, _mz.y, angle, 1, u, dt, stateOwner, c);
  }

  function stepOrders(dt) {
    for (let i = 0; i < orders.length; i++) {
      const ord = orders[i];
      if (!ord.active || ord.state !== 'charging') continue;
      if (ord.kind === 'shot' && (!ord.shooter || (typeof env.alive === 'function' && !env.alive(ord.shooter)))) {
        ord.state = 'cancelled'; ord.active = false; ord.shooter = null; ord.target = null;
        continue;
      }
      orderAim(ord);
      ord.t += dt;
      const u = ord.charge > 0 ? Math.min(1, ord.t / ord.charge) : 1;
      const w = fxWriter();
      if (w && typeof w.deathRayCharge === 'function' && ord.charge > 0) {
        const o = ord.opts;
        // laser naprowadzający: do celu (najwyżej zasięg) / do końca strzału wizualnego
        const gx = (ord.kind === 'visual' ? ord.x1 : ord.tx) - ord.mx, gy = (ord.kind === 'visual' ? ord.y1 : ord.ty) - ord.my;
        const range = Number(o?.range) > 0 ? Number(o.range) : weaponRangeFor(ord.shooter, ord.def, Number(ord.def?.baseRange) || 6000);
        const guide = Math.min(ord.kind === 'visual' ? Infinity : range, Math.sqrt(gx * gx + gy * gy));
        w.deathRayCharge(ord, ord.mx, ord.my, ord.kind === 'visual' ? ord.z0 : 0, ord.angle, u, dt,
          Number(o?.chargeScale) || 1, o?.color || null, carrierOf(ord.kind === 'visual' ? null : ord.shooter, ord.mx, ord.my), guide);
      }
      if (u < 1) continue;
      // strzał
      const o = ord.opts;
      if (ord.kind === 'visual') {
        ord.ray = fire(null, ord.def, ord.x0, ord.y0, ord.x1 - ord.x0, ord.y1 - ord.y0, {
          visual: true, range: Math.sqrt((ord.x1 - ord.x0) ** 2 + (ord.y1 - ord.y0) ** 2), width: o?.width, color: o?.color,
          z0: ord.z0, z1: ord.z1, frontSpeed: o?.frontSpeed, endFlash: o?.impact !== false
        });
      } else {
        const dx = ord.tx - ord.mx, dy = ord.ty - ord.my;
        ord.ray = fire(ord.shooter, ord.def, ord.mx, ord.my, dx, dy, {
          range: o?.range, damage: o?.damage, penetration: o?.penetration, width: o?.width, color: o?.color,
          byPlayer: o?.byPlayer === true, target: ord.target
        });
        if (typeof env.onOrderFired === 'function') env.onOrderFired(ord);
      }
      ord.state = 'fired';
      ord.active = false;
      ord.shooter = null;
      ord.target = null;
    }
  }

  // Rekord celu promienia (lista bez alokacji; pełna — cel pominięty).
  function targetFor(r, e) {
    for (let i = 0; i < r.targetCount; i++) if (r.targets[i].e === e) return r.targets[i];
    if (r.targetCount >= r.targets.length) return null;
    const t = r.targets[r.targetCount++];
    t.e = e; t.state = 0; t.wreck = false; t.ship = false; t.hull = false; t.block = false; t.decided = false; t.solid = false;
    t.tIn = 0; t.tOut = 0; t.path = 0; t.chordIn = 0; t.chordOut = 0; t.sIn = -1; t.shieldDone = false;
    t.entered = false; t.key = 0; t.killed = 0; t.cutAt = -Infinity;
    return t;
  }

  // Pierwszy kontakt czoła z obwiednią celu: droga w materiale po cięciwie (traceThrough PRZED rzazem), tarcza.
  // Decyzja przebicia / zatrzymania — dopiero przy dojściu czoła do materiału (decide), w kolejności wejścia.
  function schedule(r, t, f0) {
    const e = t.e;
    t.state = 1;
    t.wreck = typeof env.isWreck === 'function' ? !!env.isWreck(e) : !!e.isWreck;
    t.hull = !!e.beamHull;
    t.ship = !t.wreck && t.hull;
    const a = Math.max(0, f0, t.chordIn);
    const b = Math.min(r.len, t.chordOut);
    t.solid = false;
    t.path = 0;
    if (t.hull && b > a && hulls && typeof hulls.traceThrough === 'function') {
      let s = a;
      for (let k = 0; k < TRACE_RUNS && s < b; k++) {
        const res = hulls.traceThrough(e, r.ox + r.dx * s, r.oy + r.dy * s, r.ox + r.dx * b, r.oy + r.dy * b, 0, _trace);
        if (!res || !(res.entryT >= 0)) break;
        const segLen = b - s;
        const tin = s + segLen * res.entryT;
        const tout = res.exitT >= 0 ? s + segLen * res.exitT : b;
        if (!t.solid) { t.tIn = tin; t.solid = true; }
        t.tOut = tout;
        t.path += Math.max(0, tout - tin);
        if (!(res.exitT >= 0)) break;
        s = tout + 8;
      }
    } else if (!t.hull) {
      // cel bez kadłuba (myśliwiec): punkt najbliższy osi
      const proj = (posX(e) - r.ox) * r.dx + (posY(e) - r.oy) * r.dy;
      t.tIn = t.tOut = Math.max(a, proj);
    }
    // tarcza (blokująca w chwili kontaktu): wejście w obrys od wylotu
    t.sIn = -1;
    if (typeof env.shieldRadius === 'function' && env.shieldRadius(e) > 0 && typeof env.shieldEnter === 'function') {
      const sIn = env.shieldEnter(e, r.ox, r.oy, r.dx, r.dy, Math.min(r.len, t.chordOut));
      if (sIn >= 0) t.sIn = Math.max(sIn, f0);
    }
    t.block = false;
    t.decided = false;
    t.key = t.sIn >= 0 ? t.sIn : (t.solid || !t.hull ? t.tIn : t.chordIn);
  }

  // Czoło doszło do materiału okrętu: przebicie (do `penetration` okrętów) albo zatrzymanie. Kolejność wejścia, nie
  // zbierania kandydatów — dwa okręty w oknie jednego kroku czoła dostają decyzje od bliższego. Jeden cel: za
  // ostatnim przebitym okrętem promień się kończy (rzaz domyka pas ± hw przy wyjściu).
  function decide(r, t) {
    t.decided = true;
    if (r.committed >= r.pen) { t.block = true; return; }
    r.committed++;
    if (r.params.singleTarget && r.committed >= r.pen) stopAt(r, t.tOut + r.halfWidth + SINGLE_EXIT_PAD);
  }

  // Okręt zatrzymuje promień (ponad przebicia): krater i ułamek obrażeń na wejściu, koniec promienia.
  function blockAt(r, t) {
    const e = t.e;
    const x = r.ox + r.dx * t.tIn, y = r.oy + r.dy * t.tIn;
    const p = r.params;
    const dmg = r.damage * p.endDamageFrac;
    if (hulls && typeof hulls.impact === 'function' && e.beamHull) {
      _impactVel.x = r.dx * r.frontSpeed; _impactVel.y = r.dy * r.frontSpeed;
      if (typeof env.setSource === 'function') env.setSource(r.def, 'impact');
      try { hulls.impact(e, x, y, dmg, _impactVel, { craterRadius: p.endCrater }); } finally { if (typeof env.clearSource === 'function') env.clearSource(); }
    }
    writeHit(r, RAY_HIT.END, x, y, -r.dx, -r.dy, e, t.tIn, 1);
    if (!t.wreck && typeof env.damage === 'function') env.damage(e, dmg, r);
    stats.blocked++;
    stopAt(r, t.tIn);
    t.state = 2;
  }

  function stopAt(r, len) {
    if (!(len < r.len)) return;
    r.len = Math.max(0, len);
    r.stopped = true;
    r.life = Math.min(r.life, r.age + Math.max(0, r.len - r.front) / r.frontSpeed + r.params.sustain + r.params.fade);
    writeState(r, RAY_STATE.STOP);
  }

  // Czoło za wyjściem z kadłuba: obrażenia z drogi w materiale (do końca promienia, jeśli skończył się w środku).
  function finish(r, t) {
    const e = t.e;
    t.state = 2;
    if (!t.solid && t.hull) return;
    let path = t.path;
    if (t.solid && r.len < t.tOut && t.tOut > t.tIn) path *= Math.max(0, r.len - t.tIn) / (t.tOut - t.tIn);
    if (t.hull) {
      const exitD = Math.min(t.tOut, r.len);
      const x = r.ox + r.dx * exitD, y = r.oy + r.dy * exitD;
      if (exitD >= t.tOut - 1e-6) writeHit(r, RAY_HIT.EXIT, x, y, r.dx, r.dy, e, exitD, 1);
      if (t.entered) { r.hullsCut++; stats.hulls++; }
    }
    if (t.wreck || typeof env.damage !== 'function') return;
    const dmg = t.hull ? deathRayHullDamage(r.damage, path, r.params) : r.damage;
    const wasDead = !!e.dead || !!e.destroyed;
    env.damage(e, dmg, r);
    if (!wasDead && (e.dead || e.destroyed)) { r.kills++; stats.kills++; }
  }

  // Jeden krok czoła: odcinek [f0, f1] (kandydaci w kolejności wejścia), stacje, tarcze, rzaz, zakończenia.
  function stepFront(r, dt) {
    const f0 = r.front;
    let f1 = Math.min(r.len, f0 + r.frontSpeed * dt);
    r.steps++;
    // stacje: wejście w bryłę kończy promień
    if (!r.visual) {
      const list = typeof env.stations === 'function' ? env.stations() : null;
      if (list && typeof env.stationHit === 'function') {
        const ax = r.ox + r.dx * f0, ay = r.oy + r.dy * f0, bx = r.ox + r.dx * f1, by = r.oy + r.dy * f1;
        let best = -1, bestSt = null;
        for (let i = 0; i < list.length; i++) {
          const st = list[i];
          if (!st || r.stations.indexOf(st) >= 0) continue;
          const u = env.stationHit(st, ax, ay, bx, by);
          if (u >= 0 && (best < 0 || u < best)) { best = u; bestSt = st; }
        }
        if (bestSt) {
          const d = f0 + (f1 - f0) * best;
          r.stations.push(bestSt);
          const x = r.ox + r.dx * d, y = r.oy + r.dy * d;
          if (typeof env.damageStation === 'function') env.damageStation(bestSt, r.params.stationDamage, r);
          writeHit(r, RAY_HIT.END, x, y, -r.dx, -r.dy, bestSt, d, 1);
          stats.stations++;
          stopAt(r, d);
          f1 = Math.min(f1, r.len);
        }
      }
    }
    if (!r.visual) {
      // kandydaci: nowe kontakty (cięciwa obwiedni w zasięgu czoła)
      _cand.length = 0;
      if (typeof env.collect === 'function') env.collect(_cand);
      const hw = r.halfWidth;
      for (let i = 0; i < _cand.length; i++) {
        const e = _cand[i];
        if (!e || e === r.shooter) continue;
        let t = null;
        for (let k = 0; k < r.targetCount; k++) if (r.targets[k].e === e) { t = r.targets[k]; break; }
        if (t && t.state !== 0) continue;
        const rx = posX(e) - r.ox, ry = posY(e) - r.oy;
        const proj = rx * r.dx + ry * r.dy;
        const perp = rx * -r.dy + ry * r.dx;
        const rad = Math.max(typeof env.radius === 'function' ? env.radius(e) : (Number(e.radius) || 50),
          typeof env.shieldRadius === 'function' ? env.shieldRadius(e) : 0) + hw;
        if (Math.abs(perp) > rad) continue;
        const half = Math.sqrt(rad * rad - perp * perp);
        const cIn = proj - half, cOut = proj + half;
        if (cOut < f0 || cIn > f1 || cIn > r.len) continue;
        if (!t) t = targetFor(r, e);
        if (!t) continue;
        t.chordIn = cIn; t.chordOut = cOut;
        schedule(r, t, f0);
      }
      _cand.length = 0;
      // kolejność wejścia (rzadka lista — sortowanie przez wstawianie indeksów)
      _order.length = 0;
      for (let i = 0; i < r.targetCount; i++) {
        const t = r.targets[i];
        if (t.state !== 1) continue;
        let j = _order.length;
        _order.push(t);
        while (j > 0 && _order[j - 1].key > t.key) { _order[j] = _order[j - 1]; j--; }
        _order[j] = t;
      }
      for (let k = 0; k < _order.length; k++) {
        const t = _order[k];
        const e = t.e;
        if (f1 > r.len) f1 = r.len;
        // tarcza: czoło doszło do obrysu — pole pada do zera
        if (t.sIn >= 0 && !t.shieldDone && f1 >= t.sIn) {
          t.shieldDone = true;
          const x = r.ox + r.dx * t.sIn, y = r.oy + r.dy * t.sIn;
          if (typeof env.collapseShield === 'function') env.collapseShield(e, x, y, r.damage);
          writeHit(r, RAY_HIT.SHIELD, x, y, -r.dx, -r.dy, e, t.sIn, 1);
          stats.shields++;
        }
        if (!t.hull) {
          // myśliwiec / cel bez kadłuba
          if (f1 >= t.tIn) {
            const x = r.ox + r.dx * t.tIn, y = r.oy + r.dy * t.tIn;
            writeHit(r, RAY_HIT.SMALL, x, y, -r.dx, -r.dy, e, t.tIn, 1);
            stats.small++;
            finish(r, t);
          }
          continue;
        }
        if (!t.solid) {
          if (f1 >= t.chordOut) t.state = 2;
          continue;
        }
        if (!t.ship) {
          // wrak: cięty, bez liczenia do przebić
        } else if (!t.decided) {
          if (f1 < t.tIn) continue;   // czoło jeszcze przed materiałem
          decide(r, t);
          if (f1 > r.len) f1 = r.len;
        }
        if (t.block) {
          if (f1 >= t.tIn) { blockAt(r, t); f1 = Math.min(f1, r.len); }
          continue;
        }
        // rzaz części kroku w materiale: od miejsca, do którego ten cel już przecięto (pierwszy raz — od wejścia minus
        // pas: przy skośnej burcie węzły ± hw od osi zaczynają się przed `tIn`, a decyzja zapada dopiero przy nim)
        const c0 = Math.max(t.cutAt, t.tIn - hw), c1 = Math.min(f1, t.tOut + hw);
        if (c1 > t.cutAt) t.cutAt = c1;
        if (c1 > c0 && hulls && typeof hulls.cutSegment === 'function') {
          if (typeof env.setSource === 'function') env.setSource(r.def, 'kerf');
          let killed = 0;
          try {
            killed = hulls.cutSegment(e, r.ox + r.dx * c0, r.oy + r.dy * c0, r.ox + r.dx * c1, r.oy + r.dy * c1, hw, PUSH) || 0;
          } finally { if (typeof env.clearSource === 'function') env.clearSource(); }
          t.killed += killed;
          r.cutNodes += killed;
          stats.cutNodes += killed;
        }
        if (!t.entered && f1 >= t.tIn) {
          t.entered = true;
          writeHit(r, RAY_HIT.ENTRY, r.ox + r.dx * t.tIn, r.oy + r.dy * t.tIn, -r.dx, -r.dy, e, t.tIn, 1);
        }
        if (f1 >= t.tOut) finish(r, t);
      }
      _order.length = 0;
    }
    r.front = Math.min(f1, r.len);
    if (r.front >= r.len - 1e-6) {
      r.done = true;
      // promień skończył się w środku celu (zasięg) — obrażenia z drogi do końca
      for (let i = 0; i < r.targetCount; i++) {
        const t = r.targets[i];
        if (t.state === 1 && t.solid && !t.block && t.entered) finish(r, t);
      }
    }
  }

  /** Krok fizyki: rozkazy scen (ładowanie), czoła promieni, czas życia. */
  function step(dt) {
    const h = Math.max(0, Number(dt) || 0);
    if (!(h > 0)) return;
    stepOrders(h);
    for (let i = 0; i < rays.length; i++) {
      const r = rays[i];
      if (!r.active) continue;
      if (!r.done) {
        if (!r.visual && r.shooter && typeof env.alive === 'function' && !env.alive(r.shooter)) {
          // strzelec zginął w trakcie — promień gaśnie tam, gdzie doszło czoło
          r.done = true;
          stopAt(r, r.front);
          writeState(r, RAY_STATE.CANCEL);
        } else {
          updateOrigin(r);
          stepFront(r, h);
        }
      }
      r.age += h;
      if (r.age >= r.life) releaseRay(r);
    }
  }

  function reset() {
    for (let i = 0; i < rays.length; i++) if (rays[i].active) releaseRay(rays[i]);
    for (let i = 0; i < orders.length; i++) { const o = orders[i]; o.active = false; o.shooter = null; o.target = null; o.ray = null; o.opts = null; }
    nextId = 1;
  }

  /** Aktywne promienie i rozkazy (diagnostyka, harness). */
  function describe() {
    const out = [];
    for (const r of rays) {
      if (!r.active) continue;
      out.push({
        id: r.id, visual: r.visual, front: Math.round(r.front), len: Math.round(r.len), age: +r.age.toFixed(3), done: r.done,
        stopped: r.stopped, cutNodes: r.cutNodes, hullsCut: r.hullsCut, kills: r.kills,
        targets: r.targets.slice(0, r.targetCount).map((t) => ({
          name: t.e?.name || t.e?.type || null, wreck: t.wreck, block: t.block, decided: t.decided, solid: t.solid, tIn: Math.round(t.tIn),
          tOut: Math.round(t.tOut), path: Math.round(t.path), killed: t.killed, state: t.state, shield: t.shieldDone
        }))
      });
    }
    return { rays: out, orders: orders.filter((o) => o.active).map((o) => ({ id: o.id, kind: o.kind, t: +o.t.toFixed(2), charge: o.charge })), stats: { ...stats } };
  }

  /** Czy encja ma aktywny promień jako strzelec (HUD, AI). */
  function firingFrom(e) {
    for (let i = 0; i < rays.length; i++) if (rays[i].active && rays[i].shooter === e && !rays[i].done) return rays[i];
    return null;
  }

  return { fire, visual, order, step, reset, describe, firingFrom, chargeFx, rays, orders, stats };
}
