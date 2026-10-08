// src/game/repairSwarm.js
//
// REJESTR ROJÓW DRONÓW NAPRAWCZYCH (rigi src/game/repairRig.js — po jednym na nosiciela: gracz, holownik serwisowy).
// Krok wszystkich rigów w czasie gry (physicsStep), trafienia dronów (rozgrywka, CPU) dla pętli pocisków, wiązek,
// flaku, rakiet i wybuchów oraz lista rigów dla obrazu (src/3d/repair/repairDrones3D.js). Bez three i DOM.
//
// STRONA: drony nie łapią ognia własnej strony (wieże nosiciela i celu strzelają ponad dronami; posiłki też) —
// `friendly` strzelca porównywane z `rig.friendly` (gra: env.friendly nosiciela). Wybuch bez strony (null) — wszystkich.
// TARCZA: dron w obrysie działającej tarczy celu albo nosiciela (poza przebiciem) nie dostaje trafień — hak
// `RepairSwarm.shielded(encja, x, y)` (gra, index.html) albo env.shielded rigu.

import { RepairRig, DRONE_STATE } from './repairRig.js';

const _hit = { rig: null, index: -1, t: 0, x: 0, y: 0 };

export const RepairSwarm = {
  rigs: [],
  /** Drony poza dokiem we wszystkich rigach (po ostatnim kroku) — 0: trafienia od razu odpadają. */
  out: 0,

  /** Hak gry: czy punkt (świat gry) leży pod działającą tarczą encji — (encja, x, y) → bool. */
  shielded: null,

  /** Nowy rig (opcje jak RepairRig); bez env.shielded — hak rejestru (RepairSwarm.shielded). */
  create(opts = {}) {
    const env = Object.assign({}, opts.env);
    if (typeof env.shielded !== 'function') env.shielded = (e, x, y) => typeof RepairSwarm.shielded === 'function' && !!RepairSwarm.shielded(e, x, y);
    const rig = new RepairRig(Object.assign({}, opts, { env }));
    this.rigs.push(rig);
    return rig;
  },

  remove(rig) {
    const i = this.rigs.indexOf(rig);
    if (i >= 0) this.rigs.splice(i, 1);
  },

  /** Rig nosiciela (pierwszy) albo null. */
  rigOf(carrier) {
    for (const r of this.rigs) if (r.carrier === carrier) return r;
    return null;
  },

  /** Rig, którego drony naprawiają `target` (pierwszy aktywny) albo null. */
  rigRepairing(target) {
    for (const r of this.rigs) if (r.target === target && r.launched) return r;
    return null;
  },

  /** Krok wszystkich rigów (czas gry). */
  step(dt) {
    let out = 0;
    for (let i = 0; i < this.rigs.length; i++) {
      const r = this.rigs[i];
      r.step(dt);
      out += r.out;
    }
    this.out = out;
    return out;
  },

  /**
   * Pierwszy dron na odcinku pocisku / wiązki (świat gry), strzelca strony `friendly` (true / false; null — każdy).
   * Wynik we współdzielonym obiekcie { rig, index, t, x, y } albo null.
   */
  hitSegment(x0, y0, x1, y1, r = 0, friendly = null) {
    if (this.out === 0) return null;
    let best = null, bestT = Infinity;
    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i];
      if (rig.out === 0) continue;
      if (friendly !== null && friendly === rig.friendly) continue;
      const h = rig.hitSegment(x0, y0, x1, y1, r);
      if (h && h.t < bestT) {
        bestT = h.t;
        best = rig;
        _hit.index = h.index; _hit.t = h.t; _hit.x = h.x; _hit.y = h.y;
      }
    }
    if (!best) return null;
    _hit.rig = best;
    return _hit;
  },

  /** Obrażenia drona z wyniku hitSegment; zwraca, czy zginął. */
  damage(hit, dmg) {
    if (!hit?.rig) return false;
    return hit.rig.damageDrone(hit.index, dmg);
  },

  /** Wybuch (świat gry) strony `friendly` (null — każdy): drony w promieniu. Zwraca liczbę trafionych. */
  blast(x, y, radius, dmg, friendly = null) {
    if (this.out === 0) return 0;
    let n = 0;
    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i];
      if (rig.out === 0) continue;
      if (friendly !== null && friendly === rig.friendly) continue;
      n += rig.blast(x, y, radius, dmg);
    }
    return n;
  },

  /** Drony w powietrzu (obraz, HUD): wywołuje fn(rig, dron) dla każdego drona poza dokiem. */
  forEachOut(fn) {
    for (const rig of this.rigs) {
      if (rig.out === 0) continue;
      for (const d of rig.drones) {
        if (d.state === DRONE_STATE.DOCKED || d.state === DRONE_STATE.DEAD) continue;
        fn(rig, d);
      }
    }
  },

  /** Tylko testy: pusty rejestr. */
  _reset() {
    this.rigs.length = 0;
    this.out = 0;
    this.shielded = null;
  }
};
