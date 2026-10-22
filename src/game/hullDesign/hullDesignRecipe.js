// src/game/hullDesign/hullDesignRecipe.js
//
// KREATOR KADŁUBÓW — receptura (komponenty z src/data/resources.js), ostrzeżenia i mocowania projektu (czyste).
//
//   płyty kadłuba  — komórki siatki belek (bok 15 j.) całej sylwetki (rama) + nadbudówka i mostek (po pół płyty
//                    na komórkę — wyższe poszycie) / 200 komórek na płytę: ten sam przelicznik co odrost dronów naprawczych
//                    (REPAIR_TUNE.cellsPerUnit.hull_plate), więc budowa w stoczni i naprawa w polu zgadzają się,
//   moduły         — części z HD_MODULES (wieże: podstawy uzbrojenia, gondole: silniki, reaktor, mostek: awionika
//                    i podtrzymywanie życia),
//   manewrowe      — 2 silniki na każde rozpoczęte 600 j. długości (dysze SIDE),
//   załoga         — podtrzymywanie życia z powierzchni nadbudówki (1 na 70 komórek).
//
// Mocowania (pozycje względem środka obrazu — jak markery edytora gniazd; x ku dziobowi, y w dół obrazu):
// gniazda wież, dysze MAIN gondol, lampy pozycyjne (dziób biały, burty czerwona / zielona, rufa biała).

import { RESOURCES } from '../../data/resources.js';
import { REPAIR_TUNE } from '../../data/repairDrones.js';
import { HD_MODULES, hullDesignMountOf } from './hullDesignSchema.js';
import { cellComponents, hullCells, sampleHullField } from './hullDesignGeometry.js';
import { systemIssues } from './hullDesignSystems.js';

export const HD_RECIPE_TUNE = Object.freeze({
  upperPlateShare: 0.5,     // płyty na komórkę nadbudówki / mostka (ponad ramę i pancerz)
  sideThrusterPer: 600,     // [j.] długości na parę silników manewrowych
  crewCells: 70,            // komórek nadbudówki na moduł podtrzymywania życia
  massPerCell: 3.4          // [t] na komórkę poziomu 0 (szacunek do porównań)
});

const add = (bag, k, n) => { if (n > 0) bag[k] = (bag[k] || 0) + n; };

/**
 * Receptura i ostrzeżenia. `field` — buildHullField(projekt). Zwraca { parts: { id: n }, cells: { hull, upper,
 * bridge }, plates, length, width, massT, value, warnings: [{ level: 'bad' | 'warn', text }] }.
 */
export function hullDesignRecipe(field, tune = HD_RECIPE_TUNE) {
  const { modules } = field.expanded;
  const c0 = hullCells(field, 0), c1 = hullCells(field, 1), c2 = hullCells(field, 2), c3 = hullCells(field, 3);
  const parts = {};
  const perPlate = Number(REPAIR_TUNE.cellsPerUnit?.hull_plate) || 200;
  const plateCells = c0.count + (c2.count + c3.count) * tune.upperPlateShare;
  const plates = Math.max(1, Math.ceil(plateCells / perPlate));
  add(parts, 'hull_plate', plates);
  const counts = {};
  for (const m of modules) {
    counts[m.type] = (counts[m.type] || 0) + 1;
    for (const [k, n] of Object.entries(HD_MODULES[m.type].parts)) add(parts, k, n);
  }
  const length = field.bounds.maxX - field.bounds.minX;
  const width = field.bounds.maxY - field.bounds.minY;
  add(parts, 'thruster', 2 * Math.ceil(length / tune.sideThrusterPer));
  add(parts, 'life_support', Math.ceil(c2.count / tune.crewCells));
  for (const k of Object.keys(parts)) parts[k] = Math.ceil(parts[k]);
  let value = 0;
  for (const [k, n] of Object.entries(parts)) value += (RESOURCES[k]?.value || 0) * n;

  const warnings = [];
  // komplet systemów (rdzeń, zbiornik, mostek, MAIN) — src/game/hullDesign/hullDesignSystems.js
  for (const w of systemIssues(modules)) warnings.push({ level: w.level, text: w.text });
  const parts0 = cellComponents(c0);
  if (parts0.length > 1) warnings.push({ level: 'bad', text: `Kadłub w ${parts0.length} kawałkach — części bez połączenia odpadną jako wraki.` });
  // Moduły poza kadłubem / na złym poziomie.
  for (const m of modules) {
    const label = HD_MODULES[m.type].label;
    // dysza SIDE stoi przy burcie (wydech wzdłuż +x modułu poza kadłub) — w kadłubie musi być jej koniec od strony kadłuba
    const inner = m.type === 'thruster_side' ? (m.w || 0) * 0.6 : 0;
    const d0 = sampleHullField(field, 0, m.x - Math.cos(m.rot || 0) * inner, m.y - Math.sin(m.rot || 0) * inner);
    if (d0 > (m.type === 'thruster_side' ? -0.2 * (m.h || 1) : -2)) warnings.push({ level: 'warn', text: `${label} (${Math.round(m.x)}, ${Math.round(m.y)}) poza kadłubem.` });
    if (m.type === 'engine') {
      // dysza na rufie gondoli musi wychodzić poza kadłub: punkt za gondolą (−x lokalnie) pusty
      const c = Math.cos(m.rot || 0), s = Math.sin(m.rot || 0);
      const back = m.w + Math.max(4, m.h * 0.6);
      const bx = m.x - c * back, by = m.y - s * back;
      if (sampleHullField(field, 0, bx, by) < 0) warnings.push({ level: 'warn', text: `${label} (${Math.round(m.x)}, ${Math.round(m.y)}): dysze zasłonięte kadłubem.` });
    }
  }
  if (!modules.some((m) => { const g = hullDesignMountOf(m); return g && g.slot !== 'hangar'; })) warnings.push({ level: 'warn', text: 'Brak gniazd uzbrojenia.' });
  return {
    parts, counts, plates,
    cells: { hull: c0.count, armor: c1.count, upper: c2.count, bridge: c3.count },
    length, width,
    massT: Math.round(c0.count * tune.massPerCell + (c2.count + c3.count) * tune.massPerCell * 0.5),
    value, warnings
  };
}

/**
 * Mocowania względem środka obrazu (field.image.cx/cy): { hardpoints, mainThrusters, sideThrusters, cores, fuelTanks,
 * cargoBays, lights: { position } }. Dysze SIDE jak `engines.side` edytora gniazd (deg 0 — wydech na prawą burtę +y,
 * 180 — na lewą, 90 — ku rufie), rdzenie, zbiorniki i ładownie jak markery gry (src/data/reactorCores.js,
 * src/data/fuelTanks.js, src/data/cargoBays.js — środek, r / pół-wymiary). Lampy na krawędzi kadłuba z pola (6 j. w głąb):
 * dziób, rufa, burty w połowie długości.
 */
export function hullDesignMounts(field) {
  const { cx, cy } = field.image;
  const { modules } = field.expanded;
  const hardpoints = [];
  const mainThrusters = [];
  const sideThrusters = [], cores = [], fuelTanks = [], cargoBays = [];
  for (const m of modules) {
    if (m.type === 'thruster_side') {
      // dysza na końcu +x gniazda (burta), kierunek wydechu (cos rot, sin rot) → deg edytora: dir = (−sin deg, cos deg)
      const c = Math.cos(m.rot || 0), s = Math.sin(m.rot || 0);
      const deg = Math.round(Math.atan2(-c, s) * 180 / Math.PI * 100) / 100;
      sideThrusters.push({ id: `hd_side_${sideThrusters.length}`, x: m.x + c * m.w - cx, y: m.y + s * m.w - cy, deg: deg < 0 ? deg + 360 : deg });
    } else if (m.type === 'reactor') cores.push({ id: `hd_core_${cores.length}`, x: m.x - cx, y: m.y - cy, r: m.r });
    else if (m.type === 'fuel_tank') fuelTanks.push({ id: `hd_fuel_${fuelTanks.length}`, x: m.x - cx, y: m.y - cy, r: Math.max(m.w, m.h) });
    else if (m.type === 'cargo') cargoBays.push({ id: `hd_cargo_${cargoBays.length}`, x: m.x - cx, y: m.y - cy, w: 2 * m.w, h: 2 * m.h, rot: m.rot || 0 });
    const g = hullDesignMountOf(m);
    if (g) {
      // gniazda jak markery edytora gniazd gry: typ, rozmiar; wbudowane — obrót (90 = dziób), broń przypisana w projekcie
      const hp = { id: `hd_${hardpoints.length}`, x: m.x - cx, y: m.y - cy, size: g.size, type: g.slot };
      if (g.slot === 'builtin') hp.rot = 90;
      if (typeof g.weapon === 'string') hp.weapon = g.weapon;
      hardpoints.push(hp);
    }
    if (m.type === 'engine') {
      const n = m.n || Math.max(1, Math.round(m.h / 11));
      const c = Math.cos(m.rot || 0), s = Math.sin(m.rot || 0);
      const r = Math.min(m.h / n * 0.82, 14);
      for (let i = 0; i < n; i++) {
        const ly = -m.h + (i + 0.5) * (2 * m.h / n);
        const lx = -m.w;
        mainThrusters.push({ x: m.x + lx * c - ly * s - cx, y: m.y + lx * s + ly * c - cy, r, angle: (m.rot || 0) + Math.PI });
      }
    }
  }
  const b = field.bounds;
  const inset = Math.max(1, 6 * Math.min(1, (field.expanded.design.detail || 0.6) / 0.6));
  const edgeX = (dir) => {
    // najdalszy punkt osi (y = 0) wewnątrz kadłuba w kierunku dir
    const x0 = dir > 0 ? b.maxX : b.minX;
    for (let k = 0; k < 4000; k++) {
      const x = x0 - dir * k * 0.5;
      if (sampleHullField(field, 0, x, 0) < -inset) return x;
    }
    return 0;
  };
  const edgeY = (dir, x) => {
    const y0 = dir > 0 ? b.maxY : b.minY;
    for (let k = 0; k < 4000; k++) {
      const y = y0 - dir * k * 0.5;
      if (sampleHullField(field, 0, x, y) < -inset) return y;
    }
    return 0;
  };
  const mid = (b.minX + b.maxX) * 0.5;
  // Promień lampy w jd (jak w sprite'ach: ~4 px sprite'a ≈ 4 jd) — fregata nie dostaje lampy wielkości lotniskowca.
  const D = field.expanded.design.detail || 0.6;
  const lr = (k) => Math.max(0.3, 4 * D * k);
  const position = [
    { id: 'hd_bow', x: edgeX(1) - cx, y: -cy, color: '#ffffff', power: 0.8, radius: lr(1), sequenceGroup: 'edge' },
    { id: 'hd_port', x: mid - cx, y: edgeY(-1, mid) - cy, color: '#ff2b2b', power: 0.8, radius: lr(1), sequenceGroup: 'edge' },
    { id: 'hd_stbd', x: mid - cx, y: edgeY(1, mid) - cy, color: '#2bff6a', power: 0.8, radius: lr(1), sequenceGroup: 'edge' },
    { id: 'hd_stern', x: edgeX(-1) - cx, y: -cy, color: '#ffffff', power: 0.6, radius: lr(0.9), sequenceGroup: 'edge' }
  ];
  return { hardpoints, mainThrusters, sideThrusters, cores, fuelTanks, cargoBays, lights: { position, road: [], flood: [] } };
}
