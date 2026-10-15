// src/game/shieldBreach.js
//
// PRZEBICIA TARCZ po stronie gry (RW-29, docs/PLAN-render-worker.md § 2.6 p. 1, § 3.4). Mapę dziur liczy GPU
// (shieldPool.js: przegrzane pole odpada) i render oddaje ją przez kanał zwrotny RET (src/render/returnLayout.js:
// rekord na slot puli tarcz — slot i generacja encji, klucz obrysu, epoka odczytu, bity płytek), dziś co
// `BREACH_READ_EVERY` (0,1 s) po `getArrayBufferAsync` w shield3D.js. Gra NIE pyta renderu: raz na klatkę
// (`refresh`, przed krokami fizyki) przepisuje zmienione rekordy do siebie, stawia tanią flagę `encja.__shieldBreach`
// i sama testuje punkt na siatce płytek (`acquireShieldLattice` — ta sama, deterministyczna z obrysu, co w renderze).
//
// Semantyka jak przed RW-29 (decyzja D3): przebicie istnieje tylko dla tarcz, które mają slot puli (na ekranie, nieukryte
// mgłą, ≥ ShieldTuning.minPx), z opóźnieniem odczytu GPU (0,10–0,15 s) — teraz ≤ 1 klatka więcej. Twardość, pokazanie
// i klasa trafienia działają w polu GPU jak dawniej (bity są ich wynikiem). Odstępstwo: punkt trafienia przechodzi do
// klatki lokalnej tarczy z POZY GRY w chwili testu (pozycja i kąt kadłuba tego kroku fizyki), a nie z pozy ostatniej
// klatki renderu (dla gracza — interpolowanej); płytki są w klatce lokalnej, więc wynik dotyczy tej samej płytki,
// tylko bez zwłoki pozy.
//
// Czysty moduł (bez three, DOM i `window`).

import { RET_BREACH, retReadBreach } from '../render/returnLayout.js';
import {
  acquireShieldLattice, circleShieldProfile, nearestShieldTile, shieldProfileHash, SHIELD_SLOT_CAP
} from '../3d/shield/shieldLattice.js';
import {
  getEntityShieldBaseRadius, getEntityShieldProfile, getShieldHullAngle, sampleShieldProfileRadius
} from '../../shieldSystem.js';

/** Obrys tarczy encji — ten sam wybór co w shield3D.js (kadłub → obrys r(θ), reszta → koło promienia tarczy). */
export function shieldProfileOf(entity) {
  return getEntityShieldProfile(entity) || circleShieldProfile(getEntityShieldBaseRadius(entity));
}

/**
 * Czytelnik przebić: `ret` — widoki RET (createReturnViews), `entityAt(slot, gen)` — encja slotu renderu albo null
 * (generacja inna — slot ma już innego właściciela).
 */
export function createShieldBreachReader({ ret, entityAt }) {
  const L = ret.layout;
  const nSlots = L.breachSlots;
  const nWords = L.breachWords;
  const head = new Int32Array(RET_BREACH.HEADER_WORDS);
  const seq = new Int32Array(nSlots).fill(-1);          // seqlock ostatnio przepisanego rekordu
  const bits = new Uint32Array(nSlots * nWords);         // bity płytek slotu (kopia gry)
  const slotEntity = new Array(nSlots).fill(null);
  const slotProfile = new Int32Array(nSlots);
  const slotAny = new Uint8Array(nSlots);
  const slotOf = new Map();                              // encja → slot puli
  const latticeOf = new WeakMap();                       // obiekt profilu → siatka (z pamięci shieldLattice)
  const stats = { refreshes: 0, records: 0, calls: 0, yes: 0, stale: 0 };
  const outBits = new Uint32Array(nWords);

  function clearSlot(s) {
    const e = slotEntity[s];
    if (e) {
      if (slotOf.get(e) === s) {
        slotOf.delete(e);
        e.__shieldBreach = null;
      }
      slotEntity[s] = null;
    }
    slotAny[s] = 0;
  }

  /** Przepisuje rekordy zmienione od ostatniego wywołania (raz na klatkę gry). */
  function refresh() {
    stats.refreshes++;
    for (let s = 0; s < nSlots; s++) {
      if (!retReadBreach(ret, s, head, null)) continue;     // zapis w toku — następna klatka
      if (head[RET_BREACH.SEQ] === seq[s]) continue;
      if (!retReadBreach(ret, s, head, outBits)) continue;
      seq[s] = head[RET_BREACH.SEQ];
      stats.records++;
      const entSlot = head[RET_BREACH.ENT_SLOT];
      const e = entSlot >= 0 ? entityAt(entSlot, head[RET_BREACH.ENT_GEN]) : null;
      if (slotEntity[s] !== e) clearSlot(s);
      if (!e) { stats.stale += entSlot >= 0 ? 1 : 0; continue; }
      const prev = slotOf.get(e);
      if (prev !== undefined && prev !== s) clearSlot(prev);   // encja przeszła do innego slotu puli
      bits.set(outBits, s * nWords);
      slotEntity[s] = e;
      slotProfile[s] = head[RET_BREACH.PROFILE];
      slotAny[s] = head[RET_BREACH.ANY] ? 1 : 0;
      slotOf.set(e, s);
      e.__shieldBreach = slotAny[s] ? true : null;
    }
  }

  /**
   * Czy pocisk trafiający tarczę encji w punkcie świata (x, y) przelatuje przez przebicie? Punkt to wejście w obrys
   * tarczy; płytki stoją kawałek głębiej (energia trafień ląduje cofnięta do wnętrza), więc sprawdzana jest najbliższa
   * płytka 1 i 2 odstępy w głąb od punktu wejścia. Bez slotu puli albo bez przebić — false. Wołający sprawdza najpierw
   * tanią flagę `encja.__shieldBreach`.
   */
  function isShieldBreachedAt(entity, x, y) {
    stats.calls++;
    const e = entity?._realEntity || entity;
    if (!e || !e.__shieldBreach) return false;
    const s = slotOf.get(e);
    if (s === undefined || !slotAny[s]) return false;
    const profile = shieldProfileOf(e);
    if (!profile || shieldProfileHash(profile) !== slotProfile[s]) return false;   // obrys zmienił się po odczycie
    let lat = latticeOf.get(profile);
    if (!lat) { lat = acquireShieldLattice(profile, SHIELD_SLOT_CAP); latticeOf.set(profile, lat); }
    const px = Number.isFinite(e.x) ? e.x : e.pos?.x;
    const py = Number.isFinite(e.y) ? e.y : e.pos?.y;
    const ang = Number(getShieldHullAngle(e)) || 0;
    const c = Math.cos(ang), sn = Math.sin(ang);
    const dx = x - (Number(px) || 0), dy = y - (Number(py) || 0);
    // Świat gry → klatka lokalna tarczy (x wzdłuż kadłuba, y = −y gry; odwrotność localToWorld z shield3D.js).
    const lx = dx * c + dy * sn;
    const ly = dx * sn - dy * c;
    const r = Math.hypot(lx, ly) || 1;
    const R = sampleShieldProfileRadius(profile, Math.atan2(-ly, lx));
    const base = s * nWords;
    for (let k = 1; k <= 2; k++) {
      const f = Math.max(0, R - k * lat.cell) / r;
      const t = nearestShieldTile(lat, lx * f, ly * f);
      if (t < 0) continue;
      if ((bits[base + (t >> 5)] >>> (t & 31)) & 1) { stats.yes++; return true; }
    }
    return false;
  }

  return { refresh, isShieldBreachedAt, stats, slotOf };
}
