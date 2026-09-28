// Lot pocisku przez kadłuby belkowe — wzorzec przepływu, który zadanie 18-B wpina
// w bulletsAndCollisionsStep (index.html) wokół src/game/projectileMechanics.js:
//   kinematyka → stepInsideHull (pocisk w materiale: wyjście / zakleszczenie)
//   → kandydaci na odcinku [początek, koniec kroku] bez kadłuba, w którym / z którego pocisk
//     jest (skipsHull) → HullBodies.sweep → surfaceNormal (PRZED kraterem) → resolveHullHit
//   → przebicie: stepInsideHull w tym samym kroku (droga liczona w nienaruszonym materiale),
//     potem obrażenia wejścia (krater + HP), krater wyjścia / zakleszczenia (bez HP) i dalsze
//     kandydaty od punktu wyjścia.
// Tryb 'old' = gra sprzed 18-B: pierwszy kadłub zatrzymuje pocisk (krater z budżetu HP + HP).
// Kratery trybu gry — jak applyHexImpact: ciężka broń robi krater na miarę rany (zadanie 25c,
// src/game/hullCraters.js craterOptsFor), reszta — krater z budżetu HP.
// Bez tarcz, efektów i nośników efektów — tylko to, co liczy mechanika. Używają go testy
// projectilePenetration / projectileRicochet i skrypt bilansu scripts/bilans-broni.mjs.

import { HullBodies, hullImpactResult } from '../../src/game/hullBodies.js';
import {
  resolveHullHit, stepInsideHull, skipsHull, entryDamage,
  HIT_RICOCHET, HIT_PENETRATE, PASS_EXIT, PASS_STUCK
} from '../../src/game/projectileMechanics.js';
import { writePointVelocity } from '../../src/game/carrierVelocity.js';
// Krater na miarę rany ciężkiej broni (zadanie 25c) — jak applyHexImpact w index.html.
import { craterOptsFor } from '../../src/game/hullCraters.js';

export function createShot(def, x, y, dirX, dirY, serial = 0, extra = {}) {
  const l = Math.hypot(dirX, dirY) || 1;
  const speed = Number(def.baseSpeed) || 1000;
  return {
    x, y, px: x, py: y,
    vx: dirX / l * speed, vy: dirY / l * speed, ivx: 0, ivy: 0,
    r: 2, damage: Number(def.baseDamage) || 0, type: def.category, vfxKey: def.id,
    serial, life: (Number(def.baseRange) || 10000) / speed, dead: false, pen: null,
    ...extra
  };
}

/** Rejestr obrażeń celu: hp — obrażenia HP (applyDamageToNPC), killed — węzły zabite kraterami. */
export function ledgerFor(ledger, e) {
  let rec = ledger.get(e);
  if (!rec) ledger.set(e, rec = { hp: 0, killed: 0, entries: 0, exits: 0, stuck: 0, ricochets: 0, kerfs: 0 });
  return rec;
}

const _rel = { x: 0, y: 0 };
const _cv = { x: 0, y: 0 };

function relVelAt(b, e, x, y) {
  writePointVelocity(e, x, y, _cv);
  _rel.x = b.vx - _cv.x;
  _rel.y = b.vy - _cv.y;
  return _rel;
}

// Krater trafienia (wariant: 'impact' | 'ricochet' | 'exit' | 'stuck') — źródło = pocisk, jak w grze;
// variant null = krater z budżetu HP (tryb 'old': gra sprzed 18-B, porównania bilansu 18-A).
function crater(e, x, y, dmg, b, ledger, variant = 'impact') {
  if (!(dmg > 0) || !HullBodies.hasHull(e)) return 0;
  HullBodies.impact(e, x, y, dmg, relVelAt(b, e, x, y), variant ? craterOptsFor(b, variant, dmg) : null);
  const k = hullImpactResult.killed;
  ledgerFor(ledger, e).killed += k;
  return k;
}

// Zdarzenie przejścia (wyjście / zakleszczenie): krater bez HP, znaki rzazu do rejestru.
function applyPass(pass, b, ledger, log) {
  const e = pass.entity;
  if (e) ledgerFor(ledger, e).kerfs += pass.kerfs;
  if (pass.event === PASS_STUCK) {
    if (e) ledgerFor(ledger, e).stuck++;
    const killed = crater(e, pass.x, pass.y, pass.craterDamage, b, ledger, 'stuck');
    log.push({ type: 'stuck', entity: e, x: pass.x, y: pass.y, crater: pass.craterDamage, killed, kerfs: pass.kerfs });
    b.dead = true;
    return true;
  }
  if (pass.event === PASS_EXIT) {
    if (e) ledgerFor(ledger, e).exits++;
    const killed = crater(e, pass.x, pass.y, pass.craterDamage, b, ledger, 'exit');
    log.push({ type: 'exit', entity: e, x: pass.x, y: pass.y, crater: pass.craterDamage, killed, kerfs: pass.kerfs, damage: b.damage });
  }
  return false;
}

/**
 * Lot pocisku `b` broni `def` między kadłubami `hulls` (encje z beamHull) w krokach `dt`.
 * opts: { mode: 'new' | 'old', ledger: Map, log: [], dt, maxSteps, afterStep(step) }.
 * Zwraca log zdarzeń: hit / enter / ricochet / exit / stuck.
 */
export function flyShot(b, def, hulls, opts = {}) {
  const dt = opts.dt ?? 1 / 120;
  const maxSteps = opts.maxSteps ?? 1200;
  const ledger = opts.ledger || new Map();
  const log = opts.log || [];
  const legacy = opts.mode === 'old';
  for (let step = 0; step < maxSteps && !b.dead && b.life > 0; step++) {
    b.px = b.x; b.py = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    let sx = b.px, sy = b.py;
    if (!legacy) {
      const pass = stepInsideHull(b, def);
      if (applyPass(pass, b, ledger, log)) break;
      if (pass.event === PASS_EXIT) { sx = pass.x; sy = pass.y; } else if (b.pen?.body) continue;
    }
    for (let guard = 0; guard < 32 && !b.dead; guard++) {
      let best = null, bestT = Infinity;
      for (const e of hulls) {
        if (!HullBodies.hasHull(e) || (!legacy && skipsHull(b, e))) continue;
        const r = HullBodies.sweep(e, sx, sy, b.x, b.y, b.r);
        if (r && r.t < bestT) { bestT = r.t; best = { e, x: r.worldX, y: r.worldY, node: r.node }; }
      }
      if (!best) break;
      const { e, x, y, node } = best;
      const rel = relVelAt(b, e, x, y);
      const rec = ledgerFor(ledger, e);
      if (legacy) {
        crater(e, x, y, b.damage, b, ledger, null);
        rec.hp += b.damage;
        rec.entries++;
        log.push({ type: 'hit', entity: e, x, y, damage: b.damage });
        b.dead = true;
        break;
      }
      const n = HullBodies.surfaceNormal(e, x, y, rel.x, rel.y);
      const decision = resolveHullHit(b, def, n, rel, node, e, x, y);
      const k = entryDamage(b, def, decision);
      const hpIn = b.damage * k.hp, craterIn = b.damage * k.crater;
      if (decision === HIT_RICOCHET) {
        crater(e, x, y, craterIn, b, ledger, 'ricochet');
        rec.hp += hpIn;
        rec.ricochets++;
        log.push({ type: 'ricochet', entity: e, x, y, damage: hpIn, nx: n.nx, ny: n.ny });
        b.dead = true;
        break;
      }
      if (decision !== HIT_PENETRATE) {
        crater(e, x, y, craterIn, b, ledger);
        rec.hp += hpIn;
        rec.entries++;
        log.push({ type: 'hit', entity: e, x, y, damage: hpIn });
        b.dead = true;
        break;
      }
      // Przebicie: droga w materiale przed kraterem wejścia (krater nie skraca grubości).
      const pass = stepInsideHull(b, def);
      crater(e, x, y, craterIn, b, ledger);
      rec.hp += hpIn;
      rec.entries++;
      log.push({ type: 'enter', entity: e, x, y, damage: hpIn, count: b.pen.count, repeat: b.pen.repeat });
      if (applyPass(pass, b, ledger, log)) break;
      if (pass.event !== PASS_EXIT) break;         // dalej w środku — następny krok
      sx = pass.x; sy = pass.y;                    // kandydaci od punktu wyjścia
    }
    if (typeof opts.afterStep === 'function') opts.afterStep(step);
  }
  return log;
}
