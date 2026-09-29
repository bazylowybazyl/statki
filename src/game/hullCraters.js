// src/game/hullCraters.js
//
// KRATER NA MIARĘ RANY (zadanie 25c): fizyczna dziura w kadłubie belkowym tak duża jak lej rany
// z mapy ran. Promień — jedno źródło: wpis stempla broni (src/3d/hullDamageStamps.js,
// `craterRadiusFor`: promień leja receptury × √(obrażenia / wzorzec)); fizyka — HullBodies.impact
// z `craterRadius` (wszystkie węzły w promieniu giną: wgniecenie, odrzut blachy, belki, oparcie,
// rozpad — silnik belek, bez Math.random). Broń bez wzorca krateru — krater z budżetu HP jak dotąd.
//
// Tu: opcje krateru dla trafienia (gra: applyHexImpact w index.html, wzorzec lotu testów i bilansu),
// rów przebicia (Mjolnir, 2026-09-29: łańcuch kraterów wzdłuż drogi w materiale — applyBulletHullPass)
// oraz wybuch rakiety na poszyciu (rocketSystem3D._onHit → krater gry; punkt styku ten sam co
// obraz wybuchu — src/3d/rockets/effects.js prepareContact). Bez alokacji na trafienie.

import { craterRadiusFor, trenchRadiusFor } from '../3d/hullDamageStamps.js';

/** Opcje HullBodies.impact krateru na miarę rany (współdzielone; ważne do następnego wywołania). */
export const hullCraterOpts = { craterRadius: 0 };

/**
 * Opcje krateru dla trafienia: źródło (pocisk, broń, id / rodzina), wariant ('impact' | 'exit' |
 * 'stuck' | 'ricochet'), obrażenia krateru → `out` z `craterRadius` albo null (krater z budżetu HP).
 */
export function craterOptsFor(src, variant = 'impact', damage = 0, out = hullCraterOpts) {
  const r = src ? craterRadiusFor(src, variant, damage) : 0;
  out.craterRadius = r;
  return r > 0 ? out : null;
}

/** Czy broń pocisku kopie rów przebicia (wpis `kerf` stempla z wzorcem krateru — dziś Mjolnir). */
export function hasTrench(src) {
  return trenchRadiusFor(src, 1) > 0;
}

/**
 * Rów przebicia (decyzja 2026-09-29, Mjolnir): łańcuch kraterów na miarę rany na znakach rzazu kroku w
 * materiale (`pass` ze stepInsideHull: pierwszy znak w kerfX/Y, kolejne co kerfDX/DY — 22 j.). Promień —
 * lej wpisu `kerf` × √(energia / wzorzec) (hullDamageStamps.trenchRadiusFor); energia pocisku w materiale
 * = dmg0 · (|v| / v0)² (jak settledDamage; relVel — prędkość pocisku względem kadłuba). Środek krateru
 * cofnięty o jego promień wstecz toru: rów nie wycina materiału przed pociskiem, więc droga w materiale,
 * hamowanie i wyjście liczą się jak bez rowu. Kratery bez obrażeń HP (jak krater wyjścia — HP spada przez
 * sufit strukturalny od zabitych węzłów). `applyImpact` — funkcja gry (applyHexImpact z wariantem 'kerf':
 * stempel mapy ran z haka krateru); bez niej HullBodies.impact z opcjami krateru (testy, bilans).
 * Zwraca liczbę zabitych węzłów. Bez alokacji.
 */
export function trenchCraters(HB, pass, b, relVel, applyImpact = null) {
  const e = pass ? pass.entity : null;
  const n = pass ? pass.kerfs | 0 : 0;
  if (!e || n <= 0 || !e.beamHull || !b) return 0;
  let dmg = Number(b.damage) || 0;
  const pen = b.pen;
  if (pen && pen.v0 > 0 && pen.dmg0 > 0 && relVel) {
    const vx = Number(relVel.x) || 0;
    const vy = Number(relVel.y) || 0;
    const k = Math.min(1, Math.sqrt(vx * vx + vy * vy) / pen.v0);
    dmg = pen.dmg0 * k * k;
  }
  const r = trenchRadiusFor(b, dmg);
  const dx = Number(pass.kerfDX) || 0;
  const dy = Number(pass.kerfDY) || 0;
  const sl = Math.sqrt(dx * dx + dy * dy);
  if (!(r > 0) || !(sl > 1e-9)) return 0;
  const bx = dx / sl * r;
  const by = dy / sl * r;
  let killed = 0;
  for (let k = 0; k < n; k++) {
    if (!HB.hasHull(e)) break;
    const x = pass.kerfX + dx * k - bx;
    const y = pass.kerfY + dy * k - by;
    const hit = typeof applyImpact === 'function'
      ? applyImpact(e, x, y, dmg, relVel, null, b, 'kerf')
      : HB.impact(e, x, y, dmg, relVel, craterOptsFor(b, 'kerf', dmg));
    if (hit) killed += HB.impactResult.killed;
  }
  return killed;
}

/** Wynik rocketHullContact — punkt styku głowicy z poszyciem i normalna (świat gry). */
export const rocketContactResult = { valid: false, x: 0, y: 0, nx: 0, ny: -1 };

/**
 * Styk głowicy rakiety z poszyciem: pierwszy materiał kadłuba celu na ostatnim odcinku lotu
 * (x0, y0) → (x1, y1) (świat gry; (x1, y1) = punkt zapalnika), wstecz do początku odcinka + 30 j.,
 * w przód o ~2 odcinki (≤ 220 j.). Tylko odczyt (HullBodies.traceThrough / surfaceNormal).
 * Odcinek zerowy — kierunek zapasowy (dirX, dirY). Wynik w `out` (valid = false — brak styku).
 */
export function rocketHullContact(HB, target, x0, y0, x1, y1, dirX = 0, dirY = 0, out = rocketContactResult) {
  out.valid = false;
  if (!HB || !target || !target.beamHull || typeof HB.traceThrough !== 'function') return out;
  let dx = x1 - x0;
  let dy = y1 - y0;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (!(d > 1e-6)) {
    const l = Math.sqrt(dirX * dirX + dirY * dirY);
    if (!(l > 1e-9)) return out;
    dx = dirX / l; dy = dirY / l; d = 1;
  }
  const ux = dx / d;
  const uy = dy / d;
  const back = d + 30;
  const fwd = Math.min(220, d * 2 + 40);
  const sx = x1 - ux * back;
  const sy = y1 - uy * back;
  const ex = x1 + ux * fwd;
  const ey = y1 + uy * fwd;
  const tr = HB.traceThrough(target, sx, sy, ex, ey, 0);
  if (!tr || tr.entryT < 0) return out;
  const t = tr.entryT;
  const cx = sx + (ex - sx) * t;
  const cy = sy + (ey - sy) * t;
  const n = HB.surfaceNormal(target, cx, cy, ux, uy);
  out.x = cx;
  out.y = cy;
  out.nx = Number(n?.nx) || -ux;
  out.ny = Number(n?.ny) || -uy;
  out.valid = true;
  return out;
}

const _rocketVel = { x: 0, y: 0 };

/**
 * Krater wybuchu rakiety na poszyciu (zadanie 25c — rakieta też robi krater: mały, rodzina
 * stempla `rocket`, wzorzec 1000 obrażeń = missile_rack → promień leja 18 j.). Punkt styku jak
 * obraz wybuchu (rocketHullContact); kierunek wgniecenia — odcinek lotu. `applyImpact` — funkcja
 * gry (entity, x, y, damage, vel, shard, źródło, wariant) z mapą ran (index.html applyHexImpact);
 * bez niej HullBodies.impact z opcjami krateru (testy, bilans). Zwraca liczbę zabitych węzłów.
 */
export function rocketCraterHit(HB, target, x0, y0, x1, y1, damage, source = 'rocket', relVel = null, applyImpact = null) {
  const c = rocketHullContact(HB, target, x0, y0, x1, y1, relVel ? relVel.x : 0, relVel ? relVel.y : 0);
  if (!c.valid || !(damage > 0)) return 0;
  let vx = relVel ? Number(relVel.x) || 0 : 0;
  let vy = relVel ? Number(relVel.y) || 0 : 0;
  if (vx === 0 && vy === 0) { vx = x1 - x0; vy = y1 - y0; }
  _rocketVel.x = vx;
  _rocketVel.y = vy;
  const src = source || 'rocket';
  const hit = typeof applyImpact === 'function'
    ? applyImpact(target, c.x, c.y, damage, _rocketVel, null, src, 'impact')
    : HB.impact(target, c.x, c.y, damage, _rocketVel, craterOptsFor(src, 'impact', damage));
  return hit ? HB.impactResult.killed : 0;
}
