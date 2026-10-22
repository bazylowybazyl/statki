// src/game/hullDesign/hullDesignBuildable.js
//
// KREATOR KADŁUBÓW — STRAŻNIK „bez czitowania” (czysty: bez three i DOM). Projekt jest do zbudowania przez gracza, gdy
// zawiera tylko to, co gracz ma w edytorze: klocki z palety (src/game/hullDesign/hullDesignBlocks.js) z parametrami na
// siatce projektu i obrotem co 45°, wielokąty-pióro z kilkunastoma punktami na siatce (bez otworów), kasztele, gotowe
// części, moduły, naklejki, rowki i rury ręczne (łamane do kilkunastu punktów), sieć rur generowaną i bloki 60 j.
// Obrysu sprite'a (wielokąty ze standaryzacją `reg`, setki punktów, otwory) nie dopuszcza; dawnych brył 'circle' /
// 'rect' też nie (w palecie są koło i prostokąt). Liczba elementów ograniczona tak, żeby okręt dało się ułożyć ręcznie
// (połowę — lustro robi drugą burtę).

import { normalizeHullDesign } from './hullDesignSchema.js';
import { blockRotStep } from './hullDesignBlocks.js';

/** Limity edytora gracza: punktów pióra i łamanych, elementów projektu. */
export const HD_BUILD_LIMITS = Object.freeze({
  penPoints: 16,
  polylinePoints: 16,
  shapes: 240,
  castles: 40,
  parts: 60,
  modules: 400,
  decals: 120,
  grooves: 120,
  pipes: 60
});

/** Wartość na siatce o kroku `step` (tolerancja względna). */
export function onGrid(v, step) {
  const k = v / step;
  return Math.abs(k - Math.round(k)) < 1e-6 * Math.max(1, Math.abs(k));
}

const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

/** Naruszenia jednego klocka (lista tekstów) względem siatki `g` [j.]; obrót co 45° wymusza już normalizacja. */
export function blockGridViolations(b, g) {
  const out = [];
  const k = blockRotStep(b.rot);
  if (!onGrid(b.w, g) || !onGrid(b.h, g)) out.push(`wymiary ${fmt(b.w)} × ${fmt(b.h)} poza siatką ${fmt(g)}`);
  if (b.shape === 'rect' && b.c && b.c.some((c) => !onGrid(c, g))) out.push('fazy rogów poza siatką');
  if (b.shape === 'trap' && (!onGrid(b.a || 0, g) || !onGrid(b.b || 0, g))) out.push('wcięcia trapezu poza siatką');
  if (b.shape === 'tri' && !onGrid(b.a || 0, g / 2)) out.push('wierzchołek trójkąta poza siatką');
  if (b.shape === 'arc' && b.ri && !onGrid(b.ri, 0.05)) out.push('pierścień: promień wewnętrzny nie co 0,05');
  if (k % 2 === 0) {
    // obrót co 90°: krawędzie pudła na siatce
    const W = k % 4 === 0 ? b.w : b.h, H = k % 4 === 0 ? b.h : b.w;
    if (!onGrid(b.x - W / 2, g) || !onGrid(b.y - H / 2, g)) out.push(`położenie (${fmt(b.x)}, ${fmt(b.y)}) — krawędzie poza siatką`);
  } else if (!onGrid(b.x, g / 2) || !onGrid(b.y, g / 2)) out.push(`położenie (${fmt(b.x)}, ${fmt(b.y)}) poza siatką`);
  return out;
}

/**
 * Czy projekt da się zbudować edytorem gracza. Zwraca { ok, violations: [{ where, index, text }] } — `where`: pole
 * projektu ('shapes', 'castles', …), `index` — numer elementu (−1 — cały projekt).
 */
export function isPlayerBuildable(input) {
  const d = normalizeHullDesign(input);
  const g = d.grid;
  const L = HD_BUILD_LIMITS;
  const violations = [];
  const bad = (where, index, text) => violations.push({ where, index, text });
  d.shapes.forEach((s, i) => {
    if (s.kind === 'block') {
      for (const t of blockGridViolations(s, g)) bad('shapes', i, `klocek ${s.shape}: ${t}`);
      return;
    }
    if (s.kind === 'poly') {
      const n = s.pts.length;
      if (s.reg || s.regDrop) bad('shapes', i, `obrys sprite'a (standaryzowany wielokąt, ${n} pkt) — złóż z klocków`);
      else if (n > L.penPoints) bad('shapes', i, `wielokąt z ${n} pkt (pióro: najwyżej ${L.penPoints})`);
      if (s.holes?.length) bad('shapes', i, 'wielokąt z otworami — otwór wytnij klockiem');
      const off = s.pts.filter(([x, y]) => !onGrid(x, g) || !onGrid(y, g)).length;
      if (off) bad('shapes', i, `wielokąt: ${off} z ${n} pkt poza siatką ${fmt(g)}`);
      return;
    }
    bad('shapes', i, `bryła „${s.kind}” spoza palety — użyj klocka`);
  });
  if (d.shapes.length > L.shapes) bad('shapes', -1, `${d.shapes.length} brył (najwyżej ${L.shapes})`);
  const lim = (where, n, max) => { if (n > max) bad(where, -1, `${n} elementów (najwyżej ${max})`); };
  lim('castles', d.castles.length, L.castles);
  lim('parts', d.parts.length, L.parts);
  lim('modules', d.modules.length, L.modules);
  lim('decals', d.decals.length, L.decals);
  lim('grooves', d.grooves.length, L.grooves);
  lim('pipes', d.pipes.length, L.pipes);
  d.grooves.forEach((q, i) => { if (q.pts.length > L.polylinePoints) bad('grooves', i, `rowek z ${q.pts.length} pkt (najwyżej ${L.polylinePoints})`); });
  d.pipes.forEach((q, i) => { if (q.pts.length > L.polylinePoints) bad('pipes', i, `rura z ${q.pts.length} pkt (najwyżej ${L.polylinePoints})`); });
  return { ok: violations.length === 0, violations };
}
