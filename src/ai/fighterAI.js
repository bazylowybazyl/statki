// src/ai/fighterAI.js
//
// Mózg myśliwca (przebudowa 2026-10-14 — audyt docs/AUDYT-mysliwce-2026-10-14.md; zgłoszenie użytkownika:
// „jak biją statek, wpadają w szał”, „za szybko manewrują”, role bombowiec / torpedowiec / kanonierka).
//
// Mózg (20 Hz) ustawia tylko ZAMIAR lotu (setFighterIntent, src/game/flight/fighterFlight.js). Pilot w każdym
// kroku fizyki skręca z ograniczonym przeciążeniem bocznym (łuki, promień v² / a), nos idzie za kursem.
// Dawniej mózg obracał wektor prędkości o 280–450°/s, a w nalocie na okręt zawracał za każdym razem, gdy
// zbliżył się do punktu po drugiej stronie celu — pomiar w grze: zawrotka co ~1,3 s, połowa czasu lotu bokiem.
//
// Stany (npc.state) — zależnie od DOKTRYNY eskadry (src/data/fighterSquadrons.js):
//   guard            — formacja przy liderze / powrót do nosiciela, gdy brak celu,
//   engage_formation — dolot do celu,
//   dogfight3D       — walka z myśliwcem: pościg z wyprzedzeniem, mijanka czołowa, przestrzelenie (pościg
//                      z opóźnieniem i dobieg), obrona (skręt w napastnika, uniki); bez losowych ucieczek,
//   strafe           — przelot nad okrętem: podejście z ogniem, DOBIEG za cel, szeroki nawrót, kolejny przelot
//                      z innej strony (myśliwiec, przechwytujący, szturmowy z salwą rakiet),
//   bomb_run         — bombowiec: punkt wejścia na osi kadłuba, prosty przelot NAD kadłubem, bomby spadają
//                      na pancerz pod maszyną (window.FighterBombs), dobieg, kolejny nalot z innej strony,
//   torp_run         — torpedowiec: podejście z burty celu, torpeda z ~3 km na punkt wyprzedzenia, odwrót,
//   orbit            — kanonierka: orbita wokół celu, wieżyczka bije bez przerwy,
//   rearm            — bez amunicji (bomby, torpedy): powrót do nosiciela i przezbrojenie,
//   rtb              — rozkaz POWRÓT (eskadry gracza): lądowanie w hangarze (window.landFighter).

import { getLeadAim, scoreAiTarget } from './aiUtils.js';
import { isCloakHidden } from '../game/cloak.js';
import { setFighterIntent, setFighterFace, fighterFlightSpec, fighterTurnRadius } from '../game/flight/fighterFlight.js';
import { getFighterSquadronDef, STRIKE_CRAFT_DOCTRINES } from '../data/fighterSquadrons.js';

const _leadScratch = { x: 0, y: 0 };
const _lead2Scratch = { x: 0, y: 0 };
const _velScratch = { x: 0, y: 0 };
const _normScratch = { x: 0, y: 0 };
const _geomScratch = { r: 50, halfLen: 50, halfWid: 50, axis: 0 };

const FIGHTER_LONG_SEARCH_RANGE = 16000;
const FIGHTER_GUARD_SEARCH_RANGE = 6000;
const FIGHTER_RETARGET_MIN = 1.6;
const FIGHTER_RETARGET_SPREAD = 0.8;
/** ESKORTA eskadr gracza: cel dalej niż tyle od Atlasa nie jest celem — eskadra wraca do szyku. */
const ESCORT_LEASH_FROM_SHIP = 8000;

// --- TRZYMANIE CELU ---------------------------------------------------------
// aiPickBestTarget jest zdominowany przez człon -dystans² (0.00016 * d²), więc
// w kotle "najbliższy wróg" zmieniał się przy każdym mijaniu i myśliwiec co
// ~2 s wykręcał na nowy cel. Cel zmieniamy dopiero gdy: zginął, urwał się ze
// smyczy, albo minął commitment I nowy kandydat jest wyraźnie lepszy.
const TARGET_COMMIT_TIME = 5.0;
// Histereza liczona na SKALI SCORINGU, nie na dystansie (myśliwce eskorty lecą
// tuż obok gracza — wersja dystansowa fiksowała chmarę na graczu).
const TARGET_SWITCH_MARGIN = 900;
const TARGET_LEASH_MUL = 1.4;      // ile SEARCH_RANGE zanim porzucimy pościg

/** Stożek działek w nosie [rad] — myśliwiec strzela, gdy cel jest przed nosem (pocisk i tak leci na wyprzedzenie). */
const GUN_CONE = 0.28;
/** Strojenie mózgu na żywo (window.FighterAITune). */
export const FIGHTER_AI_TUNE = {
  /** Prędkość podejścia nad okręt (ułamek maks.) — wolniej = dłuższe okno ognia w przelocie. */
  strafeSpeed: 0.78,
  /** Bombowiec nad kadłubem — prędkość i sufit skrętu (prosty, spokojny przelot). */
  bombSpeed: 0.78,
  bombRunTurnDeg: 45,
  /** Bomb na jeden przelot (reszta w kolejnym nalocie). */
  bombsPerPass: 3,
  /** Torpeda: zrzut z tej części zasięgu broni. */
  torpLaunchFrac: 0.62,
  /** Kanonierka: odległość od powierzchni kadłuba = ułamek zasięgu działka; prędkość orbity (ułamek maks.). */
  orbitGunFrac: 0.62,
  orbitSpeed: 0.72,
  /** Przezbrojenie przy nosicielu [s] i bez nosiciela (krążenie z dala) [s]. */
  rearmTime: 8,
  rearmTimeAlone: 22
};

const norm = (vX, vY, out = _normScratch) => {
  const L = Math.hypot(vX, vY);
  out.x = L ? vX / L : 0;
  out.y = L ? vY / L : 0;
  return out;
};

const wrapPi = (a) => {
  if (typeof window !== 'undefined' && window.wrapAngle) return window.wrapAngle(a);
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

// Deterministyczny ułamek z id i numeru (zamiast Math.random w decyzjach geometrii — powtarzalne przeloty).
function hashUnit(npc, salt) {
  let h = (_npcIdNum(npc.id) * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 10000) / 10000;
}

// Safe numeric hash for npc.id (string IDs like 'pirate_0' would cause NaN in arithmetic)
const _npcIdNum = (id) => {
  if (typeof id === 'number') return id;
  if (!id) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
};

function targetX(t) {
  return (t && t.pos && t.pos.x !== undefined) ? t.pos.x : (t ? t.x : 0);
}
function targetY(t) {
  return (t && t.pos && t.pos.y !== undefined) ? t.pos.y : (t ? t.y : 0);
}
function targetVx(t) {
  const v = t ? (t.vx ?? t.vel?.x) : 0;
  return Number.isFinite(v) ? v : 0;
}
function targetVy(t) {
  const v = t ? (t.vy ?? t.vel?.y) : 0;
  return Number.isFinite(v) ? v : 0;
}
function distTo(npc, t) {
  if (!t) return Infinity;
  return Math.hypot(targetX(t) - npc.x, targetY(t) - npc.y);
}

/** Doktryna maszyny (z karty eskadry; bez karty — przechwytujący po typie, reszta myśliwiec). */
export function fighterDoctrineOf(npc) {
  if (npc.fighterDoctrine && npc.__docSq === npc.squadronId) return npc.fighterDoctrine;
  const d = npc.squadronId ? (getFighterSquadronDef(npc.squadronId).doctrine || 'fighter')
    : (npc.type === 'interceptor' ? 'interceptor' : 'fighter');
  npc.fighterDoctrine = d;
  npc.__docSq = npc.squadronId;
  return d;
}

/**
 * Geometria celu: promień obwiedni kadłuba, pół długości i szerokości, oś kadłuba (kurs dziobu).
 * Gra podaje prawdziwy obrys (window.getFighterTargetGeom — wymiary sprite'a kadłuba); bez niej — promień encji.
 */
function targetGeom(t) {
  const out = _geomScratch;
  const fn = (typeof window !== 'undefined') ? window.getFighterTargetGeom : null;
  if (fn && fn(t, out)) return out;
  const r = Math.max(20, Number(t?.radius) || 50);
  out.r = r; out.halfLen = r; out.halfWid = r * 0.6; out.axis = Number(t?.angle) || 0;
  return out;
}

/** Czy punkt leży nad kadłubem celu (bomba spadnie na pancerz). */
function overHull(t, x, y) {
  const fn = (typeof window !== 'undefined') ? window.fighterOverHull : null;
  if (fn) return !!fn(t, x, y);
  const r = Math.max(20, Number(t?.radius) || 50);
  const dx = x - targetX(t);
  const dy = y - targetY(t);
  return dx * dx + dy * dy <= r * r;
}

// --- OBWIEDNIA WALKI --------------------------------------------------------
// Dystanse i czasy z zasięgu działka, prędkości i promienia skrętu (karta lotu).
export function fighterEnvelope(npc) {
  const weapons = (typeof window !== 'undefined' && window.MASTER_WEAPONS) || {};
  const gunDef = weapons[npc.gun || 'ciws_mk1'];
  const gunRange = Math.max(400, gunDef?.baseRange || 1200);
  const speed = Math.max(150, npc.maxSpeed || 1200);
  const spec = fighterFlightSpec(npc);

  let env = npc.__fighterEnv;
  if (env && env.gunRange === gunRange && env.speed === speed && env.latAccel === spec.latAccel) return env;
  if (!env) env = npc.__fighterEnv = {};

  env.gunRange = gunRange;
  env.speed = speed;
  env.latAccel = spec.latAccel;
  env.gunSpeed = Number.isFinite(gunDef?.baseSpeed) ? gunDef.baseSpeed : 2000;

  // Kocioł zaczyna się tam, skąd realnie prowadzimy ogień; wyjście ~2x dalej,
  // żeby przelot przez cel nie wyrzucał od razu z powrotem do dolotu.
  env.dogfightEnter = gunRange * 1.7;
  env.dogfightExit = gunRange * 3.2;

  // Promień skrętu przy prędkości ataku i przy prędkości narożnej.
  env.turnR = fighterTurnRadius(spec, speed * 0.9);
  env.cornerR = fighterTurnRadius(spec, spec.cornerSpeed);
  // Przelot nad okrętem: dobieg za cel tak długi, żeby nawrót nie zaczynał się nad kadłubem (i nie dłuższy —
  // pomiar 2026-10-14: dobieg 1,3 promienia skrętu + 0,9 zasięgu trzymał rój średnio 2,7–2,9 km od celu).
  env.extend = gunRange * 0.55 + env.turnR * 0.9;
  env.strafeEnter = gunRange * 2.2 + env.turnR;
  env.strafeExit = env.extend + gunRange * 2.5 + env.turnR;
  env.ipDist = gunRange * 1.2 + env.turnR * 1.2;

  // Czas przelotu obwiedni — baza dla długości podfaz kotła.
  const cross = gunRange / speed;
  env.mergeT = Math.min(1.2, Math.max(0.35, cross * 1.1));
  env.overshootT = Math.min(1.4, Math.max(0.5, cross * 1.4));
  env.defendT = 2.2;
  env.minCore = Math.min(2.6, Math.max(1.0, cross * 2.2));
  return env;
}

// --- STEROWANIE -------------------------------------------------------------
// Zamiar lotu: wektor żądanej prędkości + sufit tempa skrętu [°/s]. Ruch liczy pilot (stepFighterFlight)
// w każdym kroku fizyki — mózg niczego nie całkuje. `dt` zostaje w podpisie dla zgodności wywołań.
export function steerFighter(npc, wantVx, wantVy, dt, turnDeg) {
  setFighterIntent(npc, wantVx, wantVy, turnDeg, NaN);
}

// --- KADENCJA DZIAŁKA -------------------------------------------------------
// Mózg myśliwca odpala się co ~50 ms, więc broń, która skończyła przeładowanie
// W TRAKCIE ticku, strzela dopiero w następnym. Przenosimy resztę — ale tylko
// z ostatniego ticku: broń gotowa dłużej (nie było do czego strzelać) liczy od zera.
// Najwyżej jeden strzał na tick mózgu.
export function nextGunCooldown(gunCD, cooldown, dt) {
  return gunCD > -dt ? gunCD + cooldown : cooldown;
}

// --- ZEGAR SYMULACJI --------------------------------------------------------
// Gra publikuje licznik ticków decyzji AI (20 Hz, stoi w pauzie); bez niego
// (testy) bierzemy czas życia mózgu samego myśliwca.
function aiSimTime(npc) {
  const w = (typeof window !== 'undefined') ? window : null;
  const tick = Number(w?.__aiDecisionTickId);
  const hz = Number(w?.__aiDecisionHz);
  if (Number.isFinite(tick) && hz > 0) return tick / hz;
  return npc.__aiClock || 0;
}

// Nos wzdłuż prędkości (pilot) — kasuje zamiar `face`.
function faceVelocity(npc) {
  setFighterFace(npc, NaN);
}

// Separacja wchodzi do WEKTORA ŻĄDANEGO (pilot skręca z nią jak z każdym zamiarem). Horyzont 0.5 s zamienia
// przyspieszenie na odchylenie kursu.
function addSeparation(npc, want) {
  const fn = (typeof window !== 'undefined') ? window.applySeparationForces : null;
  if (!fn) return want;
  const sep = fn(npc, 0, 0);
  if (!sep) return want;
  want.x += (sep.ax || 0) * 0.5;
  want.y += (sep.ay || 0) * 0.5;
  return want;
}

const _wantScratch = { x: 0, y: 0 };
function want(vx, vy) {
  _wantScratch.x = vx;
  _wantScratch.y = vy;
  return _wantScratch;
}

// Lot do punktu z prędkością `speed`, nos na `face` (NaN — wzdłuż prędkości).
function flyTo(npc, px, py, speed, turnDeg = Infinity, face = NaN, separate = true) {
  const dx = px - npc.x;
  const dy = py - npc.y;
  const len = Math.hypot(dx, dy) || 1;
  const w = want((dx / len) * speed, (dy / len) * speed);
  if (separate) addSeparation(npc, w);
  setFighterIntent(npc, w.x, w.y, turnDeg, face);
  return len;
}

// Lot kursem `ang` z prędkością `speed`.
function flyHeading(npc, ang, speed, turnDeg = Infinity, face = NaN, separate = true) {
  const w = want(Math.cos(ang) * speed, Math.sin(ang) * speed);
  if (separate) addSeparation(npc, w);
  setFighterIntent(npc, w.x, w.y, turnDeg, face);
}

// --- OGIEŃ ------------------------------------------------------------------
function noseOff(npc, x, y) {
  const myAngle = Number.isFinite(npc.angle) ? npc.angle : Math.atan2(npc.vy || 0, npc.vx || 0);
  return Math.abs(wrapPi(Math.atan2(y - npc.y, x - npc.x) - myAngle));
}

/**
 * Działko: strzał, gdy cel w zasięgu i w stożku `cone` od nosa (wieżyczka — cone ≥ π). Kierunek pocisku i tak
 * liczy fireWeaponCore (wyprzedzenie). Bez testu linii ognia: broń myśliwców ma IFF (src/game/friendlyFire.js —
 * pocisk przelatuje przez własne jednostki), a test po sojusznikach w gęstym przelocie eskadry blokował
 * większość strzałów (pomiar 2026-10-14).
 */
function tryFireGun(npc, target, dt, cone = GUN_CONE, extraRange = 0) {
  if (!target || target.dead) return false;
  if ((npc.gunCD || 0) > 0) return false;
  const MASTER_WEAPONS = (typeof window !== 'undefined' && window.MASTER_WEAPONS) || {};
  const gunDef = MASTER_WEAPONS[npc.gun || 'ciws_mk1'];
  if (!gunDef) return false;
  const tx = targetX(target);
  const ty = targetY(target);
  const dist = Math.hypot(tx - npc.x, ty - npc.y);
  const gunRange = (gunDef.baseRange || 400) * 0.95 + extraRange;
  if (dist >= gunRange) return false;
  if (cone < Math.PI && noseOff(npc, tx, ty) >= cone) return false;
  window.spawnBulletAdapter?.(npc, target, gunDef, { type: gunDef.category });
  npc.gunCD = nextGunCooldown(npc.gunCD || 0, gunDef.cooldown || 0.2, dt);
  return true;
}

/**
 * Rakiety (Osa — na myśliwce, szybkie rakiety szturmowych — na okręty). Szansa na SEKUNDĘ, nie na klatkę.
 * Okno zasięgu z karty broni: od minRange (uzbrojenie) do ułamka zasięgu.
 */
function tryFireMissile(npc, target, dt) {
  if (!target || target.dead) return false;
  if (!(npc.mslAmmo > 0) || (npc.mslCD || 0) > 0) return false;
  const MASTER_WEAPONS = (typeof window !== 'undefined' && window.MASTER_WEAPONS) || {};
  const mslDef = MASTER_WEAPONS[npc.msl || 'missile_rack'];
  if (!mslDef || mslDef.category !== 'rocket') return false;
  const isLightMsl = mslDef.id === 'osa_micro_missile';
  const range = Number(mslDef.baseRange) || 3000;
  const tx = targetX(target);
  const ty = targetY(target);
  const dist = Math.hypot(tx - npc.x, ty - npc.y);
  const maxR = isLightMsl ? Math.min(2800, range * 0.7) : Math.min(3800, range * 0.62);
  const minR = isLightMsl ? 350 : 900;
  if (dist > maxR || dist < minR) return false;
  if (noseOff(npc, tx, ty) > (isLightMsl ? 0.85 : 0.45)) return false;
  const fireRate = isLightMsl ? 6.0 : 4.0;
  if (Math.random() >= fireRate * dt) return false;
  window.spawnBulletAdapter?.(npc, target, mslDef, { type: 'rocket' });
  npc.mslAmmo--;
  npc.mslCD = isLightMsl ? (mslDef.cooldown || 1.0) : 2.2;
  return true;
}

// Wieżyczka samoobrony bombowca / torpedowca / kanonierki: najbliższy wrogi myśliwiec w zasięgu działka.
function tryDefensiveTurret(npc, dt) {
  if ((npc.gunCD || 0) > 0) return;
  const MASTER_WEAPONS = (typeof window !== 'undefined' && window.MASTER_WEAPONS) || {};
  const gunDef = MASTER_WEAPONS[npc.gun || 'ciws_mk1'];
  if (!gunDef) return;
  const threat = nearestEnemyFighter(npc, (gunDef.baseRange || 1200) * 0.9);
  if (threat) tryFireGun(npc, threat, dt, Math.PI + 1);
}

function nearestEnemyFighter(npc, range) {
  if (typeof window === 'undefined' || !window.queryAIGrid) return null;
  const q = window.queryAIGrid(npc.x, npc.y, range);
  const buf = q.buffer;
  const n = q.count;
  let best = null;
  let bestD = range * range;
  for (let i = 0; i < n; i++) {
    const o = buf[i];
    if (!o || o === npc || o.dead || !(o.fighter || o.type === 'fighter' || o.type === 'interceptor')) continue;
    if (window.isEnemyUnit && !window.isEnemyUnit(npc, o)) continue;
    if (isCloakHidden(o)) continue;
    const dx = o.x - npc.x;
    const dy = o.y - npc.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

// Najgroźniejszy myśliwiec na naszym ogonie: w zasięgu swojego działka (+30%), za nami, nosem w nas.
function tailThreat(npc, range) {
  if (typeof window === 'undefined' || !window.queryAIGrid) return null;
  const q = window.queryAIGrid(npc.x, npc.y, range);
  const buf = q.buffer;
  const n = q.count;
  const myHead = Math.atan2(npc.vy || 0, npc.vx || 0);
  let best = null;
  let bestD = range * range;
  for (let i = 0; i < n; i++) {
    const o = buf[i];
    if (!o || o === npc || o.dead || !(o.fighter || o.type === 'fighter' || o.type === 'interceptor')) continue;
    if (window.isEnemyUnit && !window.isEnemyUnit(npc, o)) continue;
    const dx = npc.x - o.x;
    const dy = npc.y - o.y;
    const d = dx * dx + dy * dy;
    if (d >= bestD) continue;
    // Za nami: kąt od naszego kursu do napastnika > 110°.
    const behind = Math.abs(wrapPi(Math.atan2(-dy, -dx) - myHead)) > 1.9;
    if (!behind) continue;
    // Nosem w nas (kurs napastnika ≤ 30° od linii do nas).
    const oHead = Number.isFinite(o.angle) ? o.angle : Math.atan2(o.vy || 0, o.vx || 0);
    if (Math.abs(wrapPi(Math.atan2(dy, dx) - oHead)) > 0.52) continue;
    bestD = d;
    best = o;
  }
  return best;
}

// --- WYBÓR CELU -------------------------------------------------------------
function getEntityAssignedTarget(entity) {
  if (!entity || entity.dead) return null;
  if (entity.forceTarget && !entity.forceTarget.dead) return entity.forceTarget;
  if (entity.target && !entity.target.dead) return entity.target;
  // Gracz nie ma .target — jego "rozkaz" dla eskadry to cel zablokowany na HUD.
  if (typeof window !== 'undefined' && entity === window.ship) {
    const locked = window.getPlayerLockedTarget?.();
    if (locked && !locked.dead) return locked;
  }
  return null;
}

function getInheritedWingmanTarget(npc, rangeSq = Infinity) {
  let leader = null;
  if (npc.squad?.leader && npc.squad.leader !== npc && !npc.squad.leader.dead) {
    leader = npc.squad.leader;
  } else if (npc.supportData?.leader && npc.supportData.leader !== npc && !npc.supportData.leader.dead) {
    leader = npc.supportData.leader;
  }
  if (!leader) return null;

  const inherited = getEntityAssignedTarget(leader);
  if (!inherited) return null;
  if (window.isEnemyUnit && !window.isEnemyUnit(npc, inherited)) return null;
  // Bombowiec / torpedowiec / kanonierka nie biorą myśliwca z rozkazu lidera — ich robotą są okręty.
  if (STRIKE_CRAFT_DOCTRINES.has(fighterDoctrineOf(npc)) && window.getUnitKind?.(inherited) === 'fighter') return null;

  const dx = targetX(inherited) - npc.x;
  const dy = targetY(inherited) - npc.y;
  if (dx * dx + dy * dy > rangeSq) return null;

  return inherited;
}

function pickScoredTarget(npc, searchRange) {
  if (window.aiPickBestTarget) return window.aiPickBestTarget(npc, searchRange);
  if (window.aiPickTarget) {
    const t = window.aiPickTarget(npc);
    if (t && distTo(npc, t) <= searchRange) return t;
  }
  return null;
}

// Zwraca cel po uwzględnieniu commitmentu i histerezy. Eksportowane, żeby dało
// się to przetestować bez pełnej pętli gry. Doktryny uderzeniowe (bombowiec,
// torpedowiec, kanonierka) widzą tylko okręty — scoreAiTarget daje myśliwcom -∞.
export function resolveFighterTarget(npc, current, searchRange, env) {
  const searchRangeSq = searchRange * searchRange;
  const inherited = getInheritedWingmanTarget(npc, searchRangeSq);
  const scored = pickScoredTarget(npc, searchRange);
  const strikeCraft = STRIKE_CRAFT_DOCTRINES.has(fighterDoctrineOf(npc));

  const isFighterTarget = (t) => !!t && window.getUnitKind?.(t) === 'fighter';

  // SAMOOBRONA — twardy priorytet (nie dla bombowców i kanonierek: one się bronią wieżyczką, lecąc dalej).
  const defend = (!strikeCraft && scored && scored !== current && isFighterTarget(scored)
    && distTo(npc, scored) < env.dogfightEnter) ? scored : null;

  let best = defend;
  if (!best) {
    best = inherited || scored;
    // Rozkaz lidera to PREFERENCJA, nie dogmat.
    if (inherited && scored && scored !== inherited
      && scoreAiTarget(npc, scored) > scoreAiTarget(npc, inherited) + TARGET_SWITCH_MARGIN) {
      best = scored;
    }
  }

  // Przyjazny myśliwiec bez niczego w zasięgu szukania sięga dalej — ale
  // najwyżej na długość smyczy, żeby cel nie wypadł z niej w następnym ticku.
  if (!best && npc.friendly) {
    best = pickScoredTarget(npc, searchRange * TARGET_LEASH_MUL);
  }
  if (best && strikeCraft && isFighterTarget(best)) best = null;

  if (!best) return (current && strikeCraft && isFighterTarget(current)) ? null : current;
  if (best === current) {
    npc.targetCommitT = TARGET_COMMIT_TIME; // wciąż najlepszy — odnów zaangażowanie
    return current;
  }
  if (!current || current.dead) {
    npc.targetCommitT = TARGET_COMMIT_TIME;
    return best;
  }
  // Samoobrona przerywa commitment natychmiast.
  if (best === defend) {
    npc.targetCommitT = TARGET_COMMIT_TIME;
    return best;
  }
  if (scoreAiTarget(npc, best) > scoreAiTarget(npc, current) + TARGET_SWITCH_MARGIN) {
    npc.targetCommitT = TARGET_COMMIT_TIME;
    return best;
  }
  return current;
}

// --- ROZKAZ ESKADRY ----------------------------------------------------------
// Eskadry gracza: window.SQUAD.order ('escort' | 'attack' | 'return'), skrzydło wsparcia: SupportWing.order
// ('guard' | 'engage'), reszta (piraci, nosiciele NPC) — atak.
function squadOrderOf(npc) {
  if (typeof window === 'undefined') return 'attack';
  if (npc.playerOwned && window.SQUAD) {
    const o = window.SQUAD.order;
    if (o === 'return') return 'return';
    if (o === 'attack') return 'attack';
    return 'escort';
  }
  if ((npc.isSupportWing || npc.supportData) && window.SupportWing) {
    return (window.SupportWing.order === 'engage') ? 'attack' : 'escort';
  }
  return 'attack';
}

// Nosiciel maszyny (przezbrojenie, lądowanie): lider eskadry, który nie jest myśliwcem, nosiciel startu albo —
// dla skrzydła wsparcia — okręt, przy którym trzyma szyk (Atlas).
const isCraft = (u) => !!u && (u.fighter || u.type === 'fighter' || u.type === 'interceptor');
function carrierOf(npc) {
  const l = npc.squad?.leader;
  if (l && !l.dead && !l.destroyed && !isCraft(l)) return l;
  const c = npc.__carrierParent;
  if (c && !c.dead && !c.destroyed) return c;
  const s = npc.supportData?.leader;
  if (s && !s.dead && !s.destroyed && !isCraft(s)) return s;
  if (npc.playerOwned && typeof window !== 'undefined' && window.ship && !window.ship.destroyed) return window.ship;
  return null;
}

// --- GŁÓWNY MÓZG ------------------------------------------------------------
export function runAdvancedFighterAI(npc, dt) {
  const order = squadOrderOf(npc);
  const doctrine = fighterDoctrineOf(npc);
  const strikeCraft = STRIKE_CRAFT_DOCTRINES.has(doctrine);
  const SEARCH_RANGE = (order === 'attack' || npc.isPirate) ? FIGHTER_LONG_SEARCH_RANGE : FIGHTER_GUARD_SEARCH_RANGE;
  const env = fighterEnvelope(npc);
  const spec = fighterFlightSpec(npc);

  npc.__aiClock = (npc.__aiClock || 0) + dt;
  // Działko schodzi poniżej zera najwyżej o jeden tick — patrz nextGunCooldown.
  npc.gunCD = Math.max(-dt, (npc.gunCD || 0) - dt);
  npc.mslCD = Math.max(0, (npc.mslCD || 0) - dt);
  npc.__bombCd = Math.max(0, (npc.__bombCd || 0) - dt);
  npc.__defCd = Math.max(0, (npc.__defCd || 0) - dt);
  npc.targetCommitT = Math.max(0, (npc.targetCommitT || 0) - dt);
  npc.subT = (npc.subT || 0) + dt;

  // ROZKAZ POWRÓT (eskadry gracza): lądowanie w hangarze, cel nieistotny.
  if (order === 'return') {
    runReturnToBay(npc, dt, spec);
    return;
  }

  // PRZEZBROJENIE: bombowiec / torpedowiec bez amunicji wraca do nosiciela.
  if ((doctrine === 'bomber' || doctrine === 'torpedo') && !(npc.mslAmmo > 0)) {
    runRearm(npc, dt, spec);
    return;
  }
  if (npc.state === 'rearm') npc.state = 'guard';

  npc.retargetTimer = (npc.retargetTimer || 0) - dt;
  let target = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (target && target.dead) target = null;
  if (target && strikeCraft && target !== npc.forceTarget && window.getUnitKind?.(target) === 'fighter') {
    target = null;
    npc.target = null;
  }

  // Smycz: cel, który wyrwał się daleko poza zasięg szukania, przestaje nas
  // obowiązywać (forceTarget = rozkaz RTS, ten trzymamy bez względu na dystans).
  if (target && target !== npc.forceTarget && distTo(npc, target) > SEARCH_RANGE * TARGET_LEASH_MUL) {
    target = null;
    npc.target = null;
    npc.targetCommitT = 0;
  }
  // ESKORTA eskadr gracza: nie odlatuj daleko od Atlasa.
  if (target && target !== npc.forceTarget && order === 'escort' && npc.playerOwned && window.ship?.pos) {
    const dx = targetX(target) - window.ship.pos.x;
    const dy = targetY(target) - window.ship.pos.y;
    if (dx * dx + dy * dy > ESCORT_LEASH_FROM_SHIP * ESCORT_LEASH_FROM_SHIP) {
      target = null;
      npc.target = null;
      npc.targetCommitT = 0;
    }
  }

  const pinnedByOrder = !!(npc.forceTarget && !npc.forceTarget.dead);
  if (npc.retargetTimer <= 0) {
    npc.retargetTimer = FIGHTER_RETARGET_MIN + Math.random() * FIGHTER_RETARGET_SPREAD;
    // Skan robimy tylko wtedy, gdy w ogóle wolno nam zmienić cel — commitment
    // oszczędza też O(n) przebieg po npcs[] w aiPickBestTarget.
    if (!pinnedByOrder && (!target || npc.targetCommitT <= 0)) {
      const next = resolveFighterTarget(npc, target, SEARCH_RANGE, env);
      if (next) {
        target = next;
        npc.target = next;
      } else if (!next && target && strikeCraft && window.getUnitKind?.(target) === 'fighter') {
        target = null;
        npc.target = null;
      }
    }
  }

  const isSquadWingman = (npc.squad && npc.squad.leader && !npc.squad.leader.dead && npc.squad.leader !== npc);
  if (!target && !npc.friendly && !npc.guardStation && !isSquadWingman && !isCloakHidden(window.ship)) {
    target = window.ship;
    npc.target = target;
  }

  let tx = 0;
  let ty = 0;
  let distToTarget = Infinity;
  let targetKind = 'unknown';

  if (target) {
    tx = targetX(target);
    ty = targetY(target);
    distToTarget = Math.hypot(tx - npc.x, ty - npc.y);
    targetKind = window.getUnitKind?.(target) || 'unknown';
  }

  // --- WYBÓR STANU ---
  if (target) {
    const prev = npc.state;
    if (targetKind === 'fighter' && !strikeCraft) {
      if (prev === 'dogfight3D') {
        if (distToTarget > env.dogfightExit) npc.state = 'engage_formation';
      } else if (distToTarget < env.dogfightEnter) {
        enterState(npc, 'dogfight3D', 'pursuit');
        npc.dogfightTime = 0;
      } else {
        npc.state = 'engage_formation';
      }
    } else {
      const g = targetGeom(target);
      if (doctrine === 'bomber') {
        if (prev === 'bomb_run') { if (distToTarget > g.r + env.strafeExit + 2500) npc.state = 'engage_formation'; }
        else if (distToTarget < g.r + env.ipDist + 3500) enterState(npc, 'bomb_run', 'setup');
        else npc.state = 'engage_formation';
      } else if (doctrine === 'torpedo') {
        const launch = torpedoLaunchRange(npc);
        if (prev === 'torp_run') { if (distToTarget > g.r + launch + 6000) npc.state = 'engage_formation'; }
        else if (distToTarget < g.r + launch + 3500) enterState(npc, 'torp_run', 'setup');
        else npc.state = 'engage_formation';
      } else if (doctrine === 'gunship') {
        if (prev === 'orbit') { if (distToTarget > g.r + env.gunRange + 5000) npc.state = 'engage_formation'; }
        else if (distToTarget < g.r + env.gunRange + 2500) enterState(npc, 'orbit', 'in');
        else npc.state = 'engage_formation';
      } else {
        if (prev === 'strafe') { if (distToTarget > g.r + env.strafeExit) npc.state = 'engage_formation'; }
        else if (distToTarget < g.r + env.strafeEnter) enterState(npc, 'strafe', 'in');
        else npc.state = 'engage_formation';
      }
    }
    if (npc.state !== 'dogfight3D') npc.dogfightTime = 0;
    else npc.dogfightTime = (npc.dogfightTime || 0) + dt;
  } else {
    npc.state = 'guard';
    npc.dogfightTime = 0;
  }

  // Wieżyczka samoobrony: maszyny uderzeniowe bronią się w każdym stanie.
  if (strikeCraft && doctrine !== 'gunship') tryDefensiveTurret(npc, dt);

  // === DOLOT ===
  if (npc.state === 'engage_formation' && target) {
    // Pościg z wyprzedzeniem (myśliwce) albo prosty dolot (maszyny uderzeniowe — oszczędzają energię na nalot).
    const aim = getLeadAim(npc, target, env.gunSpeed, _leadScratch);
    flyTo(npc, aim.x, aim.y, spec.maxSpeed, Infinity, NaN, true);
    if (!strikeCraft && distToTarget < env.gunRange * 1.1) tryFireGun(npc, target, dt);
    if (!strikeCraft) tryFireMissile(npc, target, dt);
    return;
  }

  if (npc.state === 'dogfight3D' && target) {
    runDogfight(npc, target, tx, ty, distToTarget, env, spec, dt);
    return;
  }
  if (npc.state === 'strafe' && target) {
    runStrafe(npc, target, tx, ty, distToTarget, env, spec, dt, doctrine);
    return;
  }
  if (npc.state === 'bomb_run' && target) {
    runBombRun(npc, target, tx, ty, distToTarget, env, spec, dt);
    return;
  }
  if (npc.state === 'torp_run' && target) {
    runTorpedoRun(npc, target, tx, ty, distToTarget, env, spec, dt);
    return;
  }
  if (npc.state === 'orbit' && target) {
    runOrbit(npc, target, tx, ty, distToTarget, env, spec, dt);
    return;
  }

  runGuard(npc, dt, spec);
}

function enterState(npc, state, sub) {
  if (npc.state === state) return;
  npc.state = state;
  npc.sub = sub;
  npc.subT = 0;
  npc.__runInit = false;
}

// === KOCIOŁ: myśliwiec na myśliwca ========================================
// Pościg z wyprzedzeniem i kontrolą zbliżania (nie przestrzelić celu), mijanka czołowa z przesunięciem w bok,
// przestrzelenie → pościg z opóźnieniem i dobieg, obrona przed myśliwcem na ogonie (ostry skręt w napastnika
// z unikami). Pilot ogranicza skręt przeciążeniem, więc walka wychodzi w łukach, a nie w zygzakach.
function runDogfight(npc, target, tx, ty, dist, env, spec, dt) {
  if (npc.sub !== 'defend' && npc.sub !== 'merge' && npc.sub !== 'overshoot') npc.sub = 'pursuit';
  const vx = npc.vx || 0;
  const vy = npc.vy || 0;
  const sp = Math.hypot(vx, vy);
  const myHead = sp > 50 ? Math.atan2(vy, vx) : (npc.angle || 0);
  const losAng = Math.atan2(ty - npc.y, tx - npc.x);
  const ata = Math.abs(wrapPi(losAng - myHead));               // cel od naszego nosa
  const tvx = targetVx(target);
  const tvy = targetVy(target);
  const tsp = Math.hypot(tvx, tvy);
  const tHead = tsp > 50 ? Math.atan2(tvy, tvx) : (Number(target.angle) || 0);
  const aspect = Math.abs(wrapPi(tHead - losAng));             // 0 — cel ucieka od nas (siedzimy mu na ogonie)
  const relVx = tvx - vx;
  const relVy = tvy - vy;
  const closing = -((tx - npc.x) * relVx + (ty - npc.y) * relVy) / Math.max(1, dist);

  // Obrona: ktoś siedzi nam na ogonie.
  if (npc.sub !== 'defend' && npc.__defCd <= 0) {
    const threat = tailThreat(npc, env.gunRange * 1.3);
    if (threat) {
      npc.sub = 'defend';
      npc.subT = 0;
      npc.__threat = threat;
      // Skręt w stronę napastnika (zabiera mu kąt wyprzedzenia).
      const cross = vx * (threat.y - npc.y) - vy * (threat.x - npc.x);
      npc.__defSide = cross >= 0 ? 1 : -1;
      npc.__jinkAt = 0.5 + hashUnit(npc, 11) * 0.5;
    }
  }

  if (npc.sub === 'defend') {
    const threat = npc.__threat;
    const stillThreat = threat && !threat.dead && Math.hypot(threat.x - npc.x, threat.y - npc.y) < env.gunRange * 1.5;
    if (npc.subT >= npc.__jinkAt) {
      // Unik: zmiana strony skrętu co 0,5–1 s (napastnik musi przestawiać wyprzedzenie).
      npc.__defSide = -npc.__defSide;
      npc.__jinkAt = npc.subT + 0.55 + hashUnit(npc, Math.floor(npc.subT * 10)) * 0.5;
    }
    const breakAng = myHead + npc.__defSide * (Math.PI * 0.55);
    flyHeading(npc, breakAng, Math.max(spec.cornerSpeed, sp * 0.85), Infinity, NaN, true);
    tryFireGun(npc, target, dt);
    if (!stillThreat || npc.subT > env.defendT) {
      npc.sub = 'pursuit';
      npc.subT = 0;
      npc.__defCd = 2.5;
      npc.__threat = null;
    }
    return;
  }

  // Mijanka czołowa: oba nosy na siebie — strzelaj i miń bokiem (bez taranu), potem pościg zawróci.
  if (npc.sub !== 'merge' && npc.sub !== 'overshoot' && aspect > 2.4 && ata < 0.55 && dist < env.gunRange * 2.2) {
    npc.sub = 'merge';
    npc.subT = 0;
    npc.__mergeSide = hashUnit(npc, 3) < 0.5 ? 1 : -1;
  }
  if (npc.sub === 'merge') {
    const px = -Math.sin(losAng) * npc.__mergeSide;
    const py = Math.cos(losAng) * npc.__mergeSide;
    const off = Math.max(120, (npc.radius || 12) * 8);
    flyTo(npc, tx + px * off, ty + py * off, spec.maxSpeed, Infinity, losAng, false);
    tryFireGun(npc, target, dt);
    tryFireMissile(npc, target, dt);
    if (closing < 0 || dist < off * 1.2 || npc.subT > env.mergeT * 2) { npc.sub = 'pursuit'; npc.subT = 0; }
    return;
  }

  // Przestrzelenie: za blisko i za szybko, cel ucieka z nosa — pościg z opóźnieniem (celujemy za cel) i dobieg.
  if (npc.sub === 'pursuit' && dist < env.gunRange * 0.35 && closing > 400 && ata > 0.8) {
    npc.sub = 'overshoot';
    npc.subT = 0;
  }
  if (npc.sub === 'overshoot') {
    const lag = 0.7;
    flyTo(npc, tx - tvx * lag, ty - tvy * lag, Math.max(spec.cornerSpeed * 1.1, sp), Infinity, NaN, true);
    tryFireGun(npc, target, dt);
    if (npc.subT > env.overshootT) { npc.sub = 'pursuit'; npc.subT = 0; }
    return;
  }

  // Pościg: z daleka czysty / z wyprzedzeniem na pełnej prędkości, z bliska kontrola zbliżania (celujemy
  // w punkt wyprzedzenia działka, prędkość = prędkość celu + mały zapas) — lufy zostają na celu.
  npc.sub = 'pursuit';
  const aim = getLeadAim(npc, target, env.gunSpeed, _leadScratch);
  let speed = spec.maxSpeed;
  if (dist < env.gunRange * 1.4) {
    const along = (tvx * (tx - npc.x) + tvy * (ty - npc.y)) / Math.max(1, dist);   // ucieczka celu wzdłuż linii
    const wantClose = clamp((dist - env.gunRange * 0.45) * 1.2, -300, 700);
    speed = clamp(along + wantClose, spec.cornerSpeed * 0.75, spec.maxSpeed);
    // Cel z boku (duży kąt) — zwolnij do prędkości narożnej, żeby ciaśniej zakręcić.
    if (ata > 0.9) speed = Math.min(speed, spec.cornerSpeed * 1.05);
  }
  flyTo(npc, aim.x, aim.y, speed, Infinity, Math.atan2(aim.y - npc.y, aim.x - npc.x), true);
  tryFireGun(npc, target, dt);
  tryFireMissile(npc, target, dt);
}

// === PRZELOT NAD OKRĘTEM (myśliwiec, przechwytujący, szturmowy) ===========
// Cykl: podejście z ogniem na punkt kadłuba (każda maszyna w inną część kadłuba) → minięcie → DOBIEG prosto
// za cel (bez zawracania nad kadłubem) → szeroki nawrót obok celu → kolejne podejście, z innej strony.
// Dawny „nalot” zawracał, gdy maszyna zbliżyła się do punktu po drugiej stronie celu — w praktyce co 1,3 s.
function runStrafe(npc, target, tx, ty, dist, env, spec, dt, doctrine) {
  const g = targetGeom(target);
  if (!npc.__runInit || npc.__strTarget !== target) {
    npc.__runInit = true;
    npc.__strTarget = target;
    npc.sub = 'in';
    npc.subT = 0;
    npc.__strPass = (npc.__strPass || 0) + 1;
    // Każda maszyna celuje w inny punkt kadłuba (wzdłuż osi) — rój rozkłada się po długości okrętu.
    npc.__strOff = hashUnit(npc, 17 + npc.__strPass) * 2 - 1;
  }
  const vx = npc.vx || 0;
  const vy = npc.vy || 0;
  const sp = Math.hypot(vx, vy);
  const myHead = sp > 50 ? Math.atan2(vy, vx) : (npc.angle || 0);

  if (npc.sub === 'in') {
    const lead = getLeadAim(npc, target, env.gunSpeed + sp * 0.5, _leadScratch);
    const ax = Math.cos(g.axis);
    const ay = Math.sin(g.axis);
    const off = g.halfLen * 0.6 * npc.__strOff;
    const aimX = lead.x + ax * off;
    const aimY = lead.y + ay * off;
    const aimAng = Math.atan2(aimY - npc.y, aimX - npc.x);
    flyTo(npc, aimX, aimY, spec.maxSpeed * FIGHTER_AI_TUNE.strafeSpeed, Infinity, aimAng, true);
    // Stożek ognia na okręt: nos na KADŁUBIE wystarcza (pocisk i tak leci na wyprzedzenie środka celu).
    tryFireGun(npc, target, dt, GUN_CONE + Math.atan2(g.halfWid + g.halfLen * 0.35, Math.max(dist, 1)), g.r * 0.5);
    if (doctrine === 'strike' || doctrine === 'fighter') tryFireMissile(npc, target, dt);
    // Minięcie: blisko kadłuba albo cel już za nami.
    const relVx = targetVx(target) - vx;
    const relVy = targetVy(target) - vy;
    const closing = -((tx - npc.x) * relVx + (ty - npc.y) * relVy) / Math.max(1, dist);
    // Przelot nad kadłubem do ~1/3 jego promienia (ogień do końca), potem dobieg.
    if (dist < g.r * 0.35 + 150 || (dist < g.r + env.gunRange && closing < 0) || npc.subT > 12) {
      npc.sub = 'out';
      npc.subT = 0;
      // Dobieg z lekkim odbiciem w bok (strona z id — rój rozchodzi się na boki, nie w jeden punkt).
      npc.__outAng = myHead + (hashUnit(npc, 29 + npc.__strPass) < 0.5 ? 1 : -1) * 0.18;
    }
    return;
  }

  if (npc.sub === 'out') {
    flyHeading(npc, npc.__outAng, spec.maxSpeed, Infinity, NaN, true);
    if ((dist > g.r + env.extend && npc.subT > 0.8) || npc.subT > 6) {
      npc.sub = 'turn';
      npc.subT = 0;
      // Nawrót w stronę, w którą bliżej do celu.
      const cross = vx * (ty - npc.y) - vy * (tx - npc.x);
      npc.__turnSide = cross >= 0 ? 1 : -1;
    }
    return;
  }

  // 'turn': lot na punkt OBOK celu po stronie nawrotu — szeroki łuk i kolejne podejście pod innym kątem.
  const losX = (tx - npc.x) / Math.max(1, dist);
  const losY = (ty - npc.y) / Math.max(1, dist);
  const px = -losY * npc.__turnSide;
  const py = losX * npc.__turnSide;
  const off = g.r + env.cornerR * 0.9;
  const speed = Math.min(spec.maxSpeed, spec.cornerSpeed * 1.15);
  flyTo(npc, tx + px * off, ty + py * off, speed, Infinity, NaN, true);
  const headErr = Math.abs(wrapPi(Math.atan2(ty - npc.y, tx - npc.x) - myHead));
  if ((headErr < 0.6 && dist > g.r + env.gunRange * 0.8) || npc.subT > 7) {
    npc.__runInit = false;   // nowe podejście (nowy punkt kadłuba)
  }
}

// === BOMBOWIEC: nalot NAD kadłubem ========================================
// Punkt wejścia na osi kadłuba (wzdłuż — długa seria bomb, albo w poprzek), prosty spokojny przelot nad
// pancerzem; bomba spada, gdy maszyna jest NAD kadłubem (window.FighterBombs: zrzucona bomba jedzie z celem
// i wybucha na pancerzu po czasie spadania). Potem dobieg i kolejny nalot w poprzek poprzedniego.
function runBombRun(npc, target, tx, ty, dist, env, spec, dt) {
  const g = targetGeom(target);
  const T = FIGHTER_AI_TUNE;
  if (!npc.__runInit || npc.__bombTarget !== target) {
    npc.__runInit = true;
    npc.__bombTarget = target;
    npc.__bombRuns = (npc.__bombRuns || 0) + 1;
    // Nalot wzdłuż osi kadłuba (najdłuższa seria nad pancerzem; kierunek z tej strony, po której maszyna
    // jest po dobiegu — kolejne naloty na zmianę od dziobu i od rufy). W poprzek tylko co drugi nalot na
    // kadłub prawie kwadratowy. Pomiar 2026-10-14: piracki pancernik ma ~680 × 240 j., nalot w poprzek to
    // 0,17 s nad pancerzem.
    const square = g.halfWid > g.halfLen * 0.6;
    const along = !square || ((npc.__bombRuns + (hashUnit(npc, 5) < 0.3 ? 1 : 0)) % 2) === 1;
    const axis = g.axis + (along ? 0 : Math.PI / 2);
    let ax = Math.cos(axis);
    let ay = Math.sin(axis);
    // Nalot od strony, po której jesteśmy (bez okrążania celu do punktu wejścia).
    if ((npc.x - tx) * ax + (npc.y - ty) * ay > 0) { ax = -ax; ay = -ay; }
    npc.__runDx = ax;
    npc.__runDy = ay;
    npc.__runHalf = along ? g.halfLen : g.halfWid;
    npc.__bombsPass = 0;
    npc.__setupAway = undefined;
    npc.sub = 'setup';
    npc.subT = 0;
  }
  const ax = npc.__runDx;
  const ay = npc.__runDy;
  const half = npc.__runHalf;
  const sp = Math.hypot(npc.vx || 0, npc.vy || 0);
  const myHead = sp > 50 ? Math.atan2(npc.vy, npc.vx) : (npc.angle || 0);
  const runAng = Math.atan2(ay, ax);
  // Pozycja wzdłuż osi nalotu względem środka celu (ujemna — przed kadłubem).
  const along = (npc.x - tx) * ax + (npc.y - ty) * ay;

  if (npc.sub === 'setup') {
    // Punkt wejścia przed kadłubem na osi nalotu. Nalot zaczyna się dopiero z kursem WYRÓWNANYM na oś i przed
    // kadłubem — maszyna, która dolatuje do punktu tyłem (po dobiegu), robi za nim pętlę i wraca na oś.
    // (Dawny skrót „blisko punktu wejścia” wpuszczał ją w nalot przodem od celu: zawracała z sufitem skrętu
    // nalotu i mijała kadłub.)
    // Prowadzenie po LINII (pole kursu), nie do punktu — maszyna o promieniu skrętu ~1,2 km krążyła wokół
    // punktu wejścia bez końca. Za blisko kadłuba i bez wyrównania — odlot wzdłuż osi, aż jest miejsce
    // (punkt wejścia), potem zawrót i zbieganie na oś: kurs = oś nalotu − poprawka z odchyłki w bok.
    const lat = -(npc.x - tx) * ay + (npc.y - ty) * ax;   // > 0 — na lewo od osi nalotu
    const corr = Math.min(Math.PI / 2, Math.abs(lat) / Math.max(300, env.turnR * 1.1)) * Math.sign(lat);
    const aligned = Math.abs(wrapPi(myHead - runAng)) < 0.45;
    // Miejsce na zawrót (≈ promień) i zbieganie na oś (≈ 3 promienie) przed punktem wejścia.
    const room = half + env.ipDist + env.turnR;
    if (npc.__setupAway === undefined) npc.__setupAway = !aligned && along > -room;
    if (npc.__setupAway && along < -(room + env.turnR)) npc.__setupAway = false;
    if (!npc.__setupAway && along > -half - 200 && npc.subT > 0.5) {
      // Wejście minięte bez wyrównania — nowy nalot z tej strony, po której maszyna jest teraz.
      npc.__runInit = false;
      return;
    }
    const heading = npc.__setupAway ? runAng + Math.PI + corr : runAng - corr;
    // Zawrót z prędkością narożną (ciaśniejsza pętla — promień ~0,75 tego przy pełnej prędkości).
    const turning = Math.abs(wrapPi(heading - myHead)) > 0.7;
    flyHeading(npc, heading, turning ? spec.cornerSpeed : spec.maxSpeed, Infinity, NaN, true);
    if ((Math.abs(wrapPi(myHead - runAng)) < 0.3 && along < -half - 200 && Math.abs(lat) < Math.max(g.halfWid, 200)) || npc.subT > 25) {
      npc.sub = 'in';
      npc.subT = 0;
      npc.__setupAway = undefined;
    }
    return;
  }

  if (npc.sub === 'in') {
    // Prosty przelot NAD osią kadłuba: kurs osi z poprawką na odchyłkę w bok, prędkość względem celu
    // (cel się rusza — maszyna przelatuje nad nim, nie nad miejscem, gdzie był).
    const lat = -(npc.x - tx) * ay + (npc.y - ty) * ax;
    const corr = clamp(lat / Math.max(250, half * 0.9), -0.5, 0.5);
    const h = runAng - corr;
    const runSpeed = spec.maxSpeed * T.bombSpeed;
    setFighterIntent(npc, Math.cos(h) * runSpeed + targetVx(target), Math.sin(h) * runSpeed + targetVy(target), T.bombRunTurnDeg, NaN);
    if (npc.__bombCd <= 0 && npc.mslAmmo > 0 && npc.__bombsPass < T.bombsPerPass && overHull(target, npc.x, npc.y)) {
      const MASTER_WEAPONS = (typeof window !== 'undefined' && window.MASTER_WEAPONS) || {};
      const def = MASTER_WEAPONS[npc.msl || 'fighter_bomb'];
      if (def && window.FighterBombs?.drop?.(npc, target, def)) {
        npc.mslAmmo--;
        npc.__bombsPass++;
        npc.__bombCd = Math.max(0.12, Number(def.cooldown) || 0.25);
      }
    }
    if (along > half + 250 || npc.subT > 10) {
      npc.sub = 'out';
      npc.subT = 0;
    }
    return;
  }

  // 'out': dobieg prosto, potem nowy nalot (w poprzek poprzedniego).
  flyHeading(npc, runAng, spec.maxSpeed, Infinity, NaN, true);
  if ((dist > g.r + env.extend + 600 && npc.subT > 1.0) || npc.subT > 7) {
    npc.__runInit = false;
  }
}

// === TORPEDOWIEC ===========================================================
function torpedoLaunchRange(npc) {
  const MASTER_WEAPONS = (typeof window !== 'undefined' && window.MASTER_WEAPONS) || {};
  const def = MASTER_WEAPONS[npc.msl || 'aerial_torpedo'];
  return Math.max(1200, (Number(def?.baseRange) || 4500) * FIGHTER_AI_TUNE.torpLaunchFrac);
}

// Podejście z burty celu (największy obrys, torpeda nie przelatuje wzdłuż), torpeda na punkt wyprzedzenia,
// odwrót od celu, kolejne podejście albo przezbrojenie.
function runTorpedoRun(npc, target, tx, ty, dist, env, spec, dt) {
  const g = targetGeom(target);
  const launch = torpedoLaunchRange(npc);
  const MASTER_WEAPONS = (typeof window !== 'undefined' && window.MASTER_WEAPONS) || {};
  const def = MASTER_WEAPONS[npc.msl || 'aerial_torpedo'];
  const torpSpeed = Number(def?.baseSpeed) || 1250;
  if (!npc.__runInit || npc.__torpTarget !== target) {
    npc.__runInit = true;
    npc.__torpTarget = target;
    npc.sub = 'setup';
    npc.subT = 0;
    // Burta po naszej stronie celu.
    const nx = -Math.sin(g.axis);
    const ny = Math.cos(g.axis);
    const s = ((npc.x - tx) * nx + (npc.y - ty) * ny) >= 0 ? 1 : -1;
    npc.__beamX = nx * s;
    npc.__beamY = ny * s;
  }
  const sp = Math.hypot(npc.vx || 0, npc.vy || 0);
  const myHead = sp > 50 ? Math.atan2(npc.vy, npc.vx) : (npc.angle || 0);

  if (npc.sub === 'setup') {
    const ipR = g.halfWid + launch + env.turnR * 0.6;
    const ipX = tx + npc.__beamX * ipR;
    const ipY = ty + npc.__beamY * ipR;
    const dIp = flyTo(npc, ipX, ipY, spec.maxSpeed, Infinity, NaN, true);
    const facing = Math.abs(wrapPi(Math.atan2(ty - npc.y, tx - npc.x) - myHead)) < 0.6;
    if (dIp < env.cornerR || (facing && dist > g.r + launch * 0.9 && dist < g.r + launch + env.turnR * 2.5) || npc.subT > 14) {
      npc.sub = 'in';
      npc.subT = 0;
    }
    return;
  }

  if (npc.sub === 'in') {
    const lead = getLeadAim(npc, target, torpSpeed, _leadScratch);
    const leadAng = Math.atan2(lead.y - npc.y, lead.x - npc.x);
    flyTo(npc, lead.x, lead.y, spec.maxSpeed * 0.85, Infinity, leadAng, true);
    const off = noseOff(npc, lead.x, lead.y);
    if (npc.mslAmmo > 0 && dist < g.r * 0.6 + launch && off < 0.14 && (npc.mslCD || 0) <= 0 && def) {
      window.spawnBulletAdapter?.(npc, target, def, { type: def.category || 'torpedo' });
      npc.mslAmmo--;
      npc.mslCD = Math.max(0.6, Number(def.cooldown) || 1);
      npc.sub = 'break';
      npc.subT = 0;
      npc.__breakSide = hashUnit(npc, 41 + npc.mslAmmo) < 0.5 ? 1 : -1;
    } else if (dist < g.r + env.gunRange * 0.7 || npc.subT > 10) {
      // Za blisko bez rozwiązania — odwrót i nowe podejście.
      npc.sub = 'break';
      npc.subT = 0;
      npc.__breakSide = 1;
    }
    return;
  }

  // 'break': odwrót od celu po łuku w bok, dobieg poza zasięg, nowe podejście z tej samej burty.
  const awayX = (npc.x - tx) / Math.max(1, dist);
  const awayY = (npc.y - ty) / Math.max(1, dist);
  const bx = awayX * 0.6 - awayY * 0.8 * npc.__breakSide;
  const by = awayY * 0.6 + awayX * 0.8 * npc.__breakSide;
  flyHeading(npc, Math.atan2(by, bx), spec.maxSpeed, Infinity, NaN, true);
  if ((dist > g.r + launch + env.turnR && npc.subT > 1.2) || npc.subT > 8) {
    npc.__runInit = false;
  }
}

// === KANONIERKA: orbita wokół celu ========================================
// Krąg w stałej odległości od POWIERZCHNI kadłuba (ułamek zasięgu działka), stała strona obiegu, prędkość
// z marginesem przeciążenia; wieżyczka (npc.turretAngle — obraca ją pilot) bije w cel z wyprzedzeniem,
// rakiety Osa na myśliwce, które ją atakują.
function runOrbit(npc, target, tx, ty, dist, env, spec, dt) {
  const g = targetGeom(target);
  const T = FIGHTER_AI_TUNE;
  if (!npc.__runInit || npc.__orbTarget !== target) {
    npc.__runInit = true;
    npc.__orbTarget = target;
    if (!npc.__orbDir) npc.__orbDir = hashUnit(npc, 7) < 0.5 ? 1 : -1;
  }
  const extent = Math.max(g.halfWid, (g.halfLen + g.halfWid) * 0.5);
  // Kanonierka mocno uszkodzona trzyma się dalej.
  const hurt = (Number(npc.hp) || 0) < (Number(npc.maxHp) || 1) * 0.35 ? 1.35 : 1;
  const wantDist = extent + env.gunRange * T.orbitGunFrac * hurt;
  const rx = (npc.x - tx) / Math.max(1, dist);
  const ry = (npc.y - ty) / Math.max(1, dist);
  const tanX = -ry * npc.__orbDir;
  const tanY = rx * npc.__orbDir;
  // Prędkość orbity: przeciążenie dośrodkowe v²/R najwyżej połowa możliwości maszyny.
  const vOrb = Math.min(spec.maxSpeed * T.orbitSpeed, Math.sqrt(spec.latAccel * 0.5 * Math.max(300, wantDist)));
  const radialErr = wantDist - dist;   // > 0 — za blisko
  const radial = clamp(radialErr * 1.4, -vOrb * 0.9, vOrb * 0.9);
  const w = want(tanX * vOrb + rx * radial + targetVx(target), tanY * vOrb + ry * radial + targetVy(target));
  addSeparation(npc, w);
  setFighterIntent(npc, w.x, w.y, Infinity, NaN);

  // Wieżyczka: wyprzedzenie z ruchu celu względem nas.
  _velScratch.x = npc.vx || 0;
  _velScratch.y = npc.vy || 0;
  const lead = getLeadAim(npc, target, env.gunSpeed, _lead2Scratch, _velScratch);
  const aimAng = Math.atan2(lead.y - npc.y, lead.x - npc.x);
  npc.__turAim = aimAng;
  const turret = Number.isFinite(npc.turretAngle) ? npc.turretAngle : aimAng;
  if (Math.abs(wrapPi(aimAng - turret)) < 0.25 && dist - extent < env.gunRange * 0.95) {
    tryFireGun(npc, target, dt, Math.PI + 1, extent);
  }
  // Samoobrona rakietami.
  if (npc.mslAmmo > 0 && (npc.mslCD || 0) <= 0) {
    const threat = nearestEnemyFighter(npc, 2400);
    if (threat) tryFireMissile(npc, threat, dt);
  }
}

// === PRZEZBROJENIE =========================================================
// Bez nosiciela (wezwane skrzydło, rój piracki) — krążenie z dala od walki i przezbrojenie po czasie.
function runRearm(npc, dt, spec) {
  // Cel ZOSTAJE: warstwa skrzydła wsparcia (runSupportAI w index.html) woła mózg myśliwca tylko przy celu —
  // wyzerowany cel zostawiał wezwane torpedowce w szyku bez amunicji (pomiar 2026-10-14: 80% czasu „guard”).
  if (npc.state !== 'rearm') {
    npc.state = 'rearm';
    npc.subT = 0;
    npc.__rearmT = 0;
  }
  const def = npc.squadronId ? getFighterSquadronDef(npc.squadronId) : null;
  const carrier = carrierOf(npc);
  const T = FIGHTER_AI_TUNE;
  if (carrier) {
    const cx = targetX(carrier);
    const cy = targetY(carrier);
    const cr = Math.max(150, Number(carrier.radius) || 150);
    const d = Math.hypot(cx - npc.x, cy - npc.y);
    const near = cr + 900;
    if (d > near) {
      flyTo(npc, cx, cy, Math.min(spec.maxSpeed, d * 1.2 + 300), Infinity, NaN, true);
    } else {
      // Przy nosicielu: lot razem z nim po łuku wokół (bez wchodzenia w kadłub).
      const rx = (npc.x - cx) / Math.max(1, d);
      const ry = (npc.y - cy) / Math.max(1, d);
      const v = Math.max(spec.cornerSpeed * 0.6, 500);
      const w = want(-ry * v + targetVx(carrier) + rx * (cr + 500 - d) * 0.8,
        rx * v + targetVy(carrier) + ry * (cr + 500 - d) * 0.8);
      addSeparation(npc, w);
      setFighterIntent(npc, w.x, w.y, Infinity, NaN);
      npc.__rearmT = (npc.__rearmT || 0) + dt;
    }
    if (npc.__rearmT >= T.rearmTime) finishRearm(npc, def);
    return;
  }
  // Bez nosiciela (rój piracki, wezwani bez lidera): krąg ~2,5 km od miejsca, w którym skończyła się
  // amunicja, i przezbrojenie po czasie. Dawniej lot prosto przed siebie — po 22 s maszyna była 30 km dalej.
  npc.__rearmT = (npc.__rearmT || 0) + dt;
  if (!Number.isFinite(npc.__rearmCx)) {
    const h = Math.atan2(npc.vy || 0, npc.vx || 1);
    npc.__rearmCx = npc.x + Math.cos(h) * 2500;
    npc.__rearmCy = npc.y + Math.sin(h) * 2500;
  }
  const dx = npc.x - npc.__rearmCx;
  const dy = npc.y - npc.__rearmCy;
  const d = Math.hypot(dx, dy) || 1;
  const v = spec.maxSpeed * 0.6;
  const radial = clamp((1200 - d) * 1.2, -v, v);
  setFighterIntent(npc, (-dy / d) * v + (dx / d) * radial, (dx / d) * v + (dy / d) * radial, Infinity, NaN);
  if (npc.__rearmT >= T.rearmTimeAlone) finishRearm(npc, def);
}

function finishRearm(npc, def) {
  npc.mslAmmo = Number(def?.missileAmmo) || npc.__mslAmmoMax || 0;
  npc.state = 'guard';
  npc.__rearmT = 0;
  npc.__rearmCx = NaN;
  npc.__rearmCy = NaN;
  npc.__runInit = false;
  // Od razu szukaj celu (zamiast czekać na zegar przeglądu).
  npc.retargetTimer = 0;
  npc.targetCommitT = 0;
}

// === POWRÓT DO HANGARU (rozkaz POWRÓT eskadr gracza) ======================
// Lot do wyrzutni, z której maszyna wystartowała (punkt tuż za burtą), dopasowanie prędkości do nosiciela,
// lądowanie (window.landFighter: maszyna znika w hangarze).
function runReturnToBay(npc, dt, spec) {
  npc.state = 'rtb';
  npc.target = null;
  const carrier = carrierOf(npc);
  if (!carrier) { runGuard(npc, dt, spec); return; }
  const cx = targetX(carrier);
  const cy = targetY(carrier);
  let bx = cx;
  let by = cy;
  const tube = npc.__tubeLocal;
  if (tube && Number.isFinite(tube.x) && Number.isFinite(tube.y)) {
    const a = Number(carrier.angle) || 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    bx = cx + tube.x * c - tube.y * s;
    by = cy + tube.x * s + tube.y * c;
  }
  const cvx = targetVx(carrier);
  const cvy = targetVy(carrier);
  const dx = bx - npc.x;
  const dy = by - npc.y;
  const d = Math.hypot(dx, dy);
  const approach = Math.min(spec.maxSpeed, d * 1.3 + 120);
  const w = want((dx / Math.max(1, d)) * approach + cvx, (dy / Math.max(1, d)) * approach + cvy);
  setFighterIntent(npc, w.x, w.y, Infinity, NaN);
  const rel = Math.hypot((npc.vx || 0) - cvx, (npc.vy || 0) - cvy);
  if (d < Math.max(70, (npc.radius || 12) * 4) + rel * 0.05) {
    window.landFighter?.(npc);
  }
}

// === BRAK CELU: FORMACJA / POWRÓT =========================================
function runGuard(npc, dt, spec) {
  let leader = null;
  if (npc.squad && npc.squad.leader && !npc.squad.leader.dead) {
    leader = npc.squad.leader;
  } else if (npc.supportData) {
    leader = npc.supportData.leader;
  }

  if (!leader && !npc.guardStation) {
    const home = npc.friendly ? window.ship : null;

    // Friendly fighters return to player ship; enemies chase player ship
    const chaseTarget = home?.pos ? home : (!npc.friendly && window.ship?.pos ? window.ship : null);
    if (chaseTarget?.pos) {
      const dx = chaseTarget.pos.x - npc.x;
      const dy = chaseTarget.pos.y - npc.y;
      const len = Math.hypot(dx, dy) || 1;
      const wantSpeed = Math.min(spec.maxSpeed * (npc.friendly ? 0.75 : 1.0), len * 1.4);
      setFighterIntent(npc, (dx / len) * wantSpeed, (dy / len) * wantSpeed, Infinity, NaN);
    } else {
      const sp = Math.hypot(npc.vx || 0, npc.vy || 0);
      setFighterIntent(npc, (npc.vx || 0) * 0.995, (npc.vy || 0) * 0.995, Infinity, NaN);
      if (sp < 1) npc.__flOn = false;
    }
    return;
  }

  const isLeader = (leader === npc);
  let targetPosX = NaN;
  let targetPosY = NaN;

  if (isLeader && npc.isPirate && npc.guardStation) {
    const time = aiSimTime(npc);
    const radius = npc.guardOrbitRadius || 350;
    const speed = npc.guardOrbitSpeed || 0.3;
    const phase = npc.guardPhase || 0;
    const angle = phase + (time * speed);
    targetPosX = npc.guardStation.x + Math.cos(angle) * radius;
    targetPosY = npc.guardStation.y + Math.sin(angle) * radius;
    const tangentAngle = angle + (speed > 0 ? Math.PI / 2 : -Math.PI / 2);
    npc.desiredAngle = tangentAngle;
    setFighterFace(npc, tangentAngle);
  }
  else if (leader && !isLeader) {
    const offset = npc.formationOffset || { x: 0, y: 0 };
    const la = leader.angle || 0;
    const c = Math.cos(la);
    const s = Math.sin(la);
    const lx = (leader.pos && leader.pos.x !== undefined) ? leader.pos.x : leader.x;
    const ly = (leader.pos && leader.pos.y !== undefined) ? leader.pos.y : leader.y;
    targetPosX = lx + (offset.x * c - offset.y * s);
    targetPosY = ly + (offset.x * s + offset.y * c);
  }
  else if (isLeader) {
    if (!window.ship?.pos) return;
    const pdx = window.ship.pos.x - npc.x;
    const pdy = window.ship.pos.y - npc.y;
    const plen = Math.hypot(pdx, pdy) || 1;
    // Dawniej sztywne 150 u/s — przy skali świata (1 AU = 3000 u) lider
    // dolatywał do gracza szybciej pieszo.
    const wantSpeed = Math.min(spec.maxSpeed * 0.6, plen * 1.2);
    setFighterIntent(npc, (pdx / plen) * wantSpeed, (pdy / plen) * wantSpeed, Infinity, NaN);
    return;
  }

  if (Number.isFinite(targetPosX)) {
    const dx = targetPosX - npc.x;
    const dy = targetPosY - npc.y;
    const distToSpot = Math.hypot(dx, dy);
    const len = distToSpot || 1;
    const kp = isLeader ? 2.0 : 3.0;
    const currentMax = isLeader ? (spec.maxSpeed * 0.6) : spec.maxSpeed;
    // Lider porusza się — slot jedzie z nim (dopasowanie prędkości), z daleka dolot.
    const lvx = (!isLeader && leader) ? targetVx(leader) : 0;
    const lvy = (!isLeader && leader) ? targetVy(leader) : 0;
    const wantSpeed = Math.min(currentMax, distToSpot * kp);

    const w = addSeparation(npc, want((dx / len) * wantSpeed + lvx, (dy / len) * wantSpeed + lvy));
    let face = NaN;
    if (!(distToSpot > 60) && leader && !isLeader && Number.isFinite(leader.angle)) face = leader.angle;
    else if (isLeader && npc.guardStation) face = npc.desiredAngle;
    setFighterIntent(npc, w.x, w.y, Infinity, face);
  }
}

if (typeof window !== 'undefined') {
  window.runAdvancedFighterAI = runAdvancedFighterAI;
  // Używane też przez supportGuardBehavior w index.html, żeby powrót do
  // formacji korzystał z tego samego pilota co walka.
  window.steerFighter = steerFighter;
  window.fighterEnvelope = fighterEnvelope;
  window.FighterAITune = FIGHTER_AI_TUNE;
}
