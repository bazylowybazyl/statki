// src/game/k7GateLintels.js
//
// NADPROŻA BRAM hal K-7 nad okrętem w bramie (zgłoszenie użytkownika 2026-10-13: belka rysowała się pod kadłubem).
// Bryły nadproża są w zestawie FG hali (haloPortK7Build.js — nad płaszczyzną lotu), ale kanwa 2D (wieże Turret2D)
// i światła FG (lampy pozycyjne, okna mostków) nie znają głębi — pod nadprożem się nie rysują (wzór: fregata zwiadu
// nad Atlasem, scoutCoversPoint w index.html). Obrysy nadproży z góry (k7GateLintelList) w świecie gry dla hal
// w zasięgu kamery — raz na klatkę renderu; test punktu — kilka iloczynów skalarnych.
// Czyste funkcje (bez three, DOM): testy node.
import { createK7Layout, k7GateLintelList } from '../3d/haloRing/haloPortK7Layout.js';
import { hallToGameAffine } from './hallDustInput.js';

const LINTELS = k7GateLintelList(createK7Layout());
const MAX = 48;
const STRIDE = 6;   // środek (x, y), oś wzdłuż bramy (ux, uy), pół długości, pół głębokości [świat gry]

export function createLintelCover() {
  return { n: 0, r: new Float64Array(MAX * STRIDE) };
}

const _aff = { p0x: 0, p0y: 0, ax: 1, ay: 0, bx: 0, by: 1 };

/**
 * Obrysy nadproży hal ringów (`rings` — HaloRingGame.entries: collider.place, collider.registry.halls[].frame)
 * w kwadracie ± reach wokół (camX, camY) [świat gry].
 */
export function refreshLintelCover(cover, rings, camX, camY, reach) {
  cover.n = 0;
  if (!rings) return cover;
  const r = cover.r;
  for (let e = 0; e < rings.length; e++) {
    const col = rings[e] && rings[e].collider;
    const halls = col && col.registry && col.registry.halls;
    if (!halls || !col.place) continue;
    for (let k = 0; k < halls.length; k++) {
      hallToGameAffine(col.place, halls[k].frame, _aff);
      for (let i = 0; i < LINTELS.length; i++) {
        const L = LINTELS[i];
        const cx = _aff.p0x + L.x * _aff.ax + L.z * _aff.bx;
        const cy = _aff.p0y + L.x * _aff.ay + L.z * _aff.by;
        if (Math.abs(cx - camX) > reach + L.hl || Math.abs(cy - camY) > reach + L.hl) continue;
        if (cover.n >= MAX) return cover;
        let ux = L.ux * _aff.ax + L.uz * _aff.bx;
        let uy = L.ux * _aff.ay + L.uz * _aff.by;
        const l = Math.sqrt(ux * ux + uy * uy) || 1;
        ux /= l; uy /= l;
        const o = cover.n * STRIDE;
        r[o] = cx; r[o + 1] = cy; r[o + 2] = ux; r[o + 3] = uy; r[o + 4] = L.hl; r[o + 5] = L.hd;
        cover.n++;
      }
    }
  }
  return cover;
}

/** Punkt świata gry (x, y) pod nadprożem bramy (z zapasem `pad` j.). */
export function lintelCovers(cover, x, y, pad = 0) {
  const r = cover.r;
  for (let i = 0; i < cover.n; i++) {
    const o = i * STRIDE;
    const dx = x - r[o], dy = y - r[o + 1];
    const a = dx * r[o + 2] + dy * r[o + 3];
    const b = dy * r[o + 2] - dx * r[o + 3];
    if (Math.abs(a) <= r[o + 4] + pad && Math.abs(b) <= r[o + 5] + pad) return true;
  }
  return false;
}
