// src/game/hullDesign/hullDesignGameHull.js
//
// KREATOR KADŁUBÓW → KADŁUB GRY (statki robocze złomowania; czysty: bez three i DOM). Gra bierze kadłub ze SPRITE'A
// z pliku i tabel per kadłub w pikselach PNG ((0,0) = środek płótna, +x dziób, +y prawa burta). Sprite piecze
// kompozytor (scripts/webgpu/kreator-kadluby-gry.mjs → assets/ships/work/<klucz>.png: cały obraz projektu
// `field.image`, dłuższy bok 1774 px), a tu z mocowań projektu liczą się wpisy tabel: dysze MAIN i SIDE, rdzeń,
// zbiornik paliwa, strefa mostka, lampy nawigacyjne i osprzęt złomiarski. Wynik zapisany w src/data/workHulls.js
// (scripts/kreator-kadluby-tabele.mjs --zapisz; test porównuje plik z rachunkiem — tests/workHulls.test.mjs).
//
// Płótno = obraz projektu, więc długość kadłuba w grze (szerokość płótna w j.) = `field.image.w`, a profil renderu
// ma length = image.w / HULL_RENDER_WORLD_SCALE. Ułamki osprzętu złomiarskiego (src/data/scrapRigs.js) są ułamkami
// SZEROKOŚCI PŁÓTNA od jego środka (kotwica statku w grze = środek sprite'a) — hullDesignWorkRig liczy je od środka
// sylwetki i w jej długości, różnica to margines obrazu.

import { hullDesignPreset } from './hullDesignPresets.js';
import { HD_WORKSHIPS } from './workships/index.js';
import { buildHullField } from './hullDesignGeometry.js';
import { hullDesignMounts } from './hullDesignRecipe.js';
import { hullDesignWorkRig, hullSilhouetteBox } from './hullDesignWorkRig.js';
import { HULL_RENDER_WORLD_SCALE } from '../../data/ships.js';
import { bridgeLevel } from '../../data/bridgeLevels.js';

/** Id kadłuba gry statku roboczego `key` (profil renderu, kadłub ruchu). */
export const workHullId = (key) => `work_${key}`;

const r1 = (v) => { const q = Math.round(v * 10) / 10; return q === 0 ? 0 : q; };
const r4 = (v) => { const q = Math.round(v * 1e4) / 1e4; return q === 0 ? 0 : q; };

/**
 * Wpis kadłuba gry z projektu `key` i rozmiaru płótna PNG [w, h]: { key, label, cls, png, length, radius (profil
 * renderu), worldL (długość płótna [j.]), main [[x, y, d]], side [[x, y]], core { x, y, r, hr, tier }, fuel { x, y, r },
 * bridge { x, y, w, h, level }, lights { r, p: 6 × [x, y] }, rig (zestaw src/data/scrapRigs.js albo null),
 * work (hullDesignWorkRig — ułamki długości sylwetki) }. Piksele PNG od środka płótna.
 */
export function workHullTable(ship, png) {
  const design = hullDesignPreset(ship.key);
  const field = buildHullField(design, { pipes: false });
  const im = field.image;
  const t = png[0] / im.w;                       // px na j.
  const m = hullDesignMounts(field);
  const px = (v) => r1(v * t);
  const mods = field.expanded.modules;
  const core = m.cores[0], fuel = m.fuelTanks[0];
  const br = mods.find((q) => q.type === 'bridge');
  const lv = bridgeLevel(br?.lv || design.bridgeLevel || 1);
  const box = hullSilhouetteBox(field);
  const work = hullDesignWorkRig(field);
  // ułamki szerokości płótna od środka płótna (osprzęt złomiarski gry)
  const fx = (x) => r4((x - im.cx) / im.w), fy = (y) => r4((y - im.cy) / im.w);
  const of = (type, pred = null) => mods.filter((q) => q.type === type && (!pred || pred(q)));
  const booms = of('rig', (q) => (q.v || 0) === 0).sort((a, b) => (b.x - a.x) || (a.y - b.y));
  const maw = of('maw')[0], bin = of('cargo').sort((a, b) => b.w * b.h - a.w * a.h)[0];
  let rig = null;
  const front = fx(box.maxX);
  // wysięgniki: para najbliżej dziobu (lewy y < 0, prawy y > 0); statek bez obrotnic — przy barkach dziobu
  const pair = booms.length >= 2 ? [booms.find((q) => q.y < 0), booms.find((q) => q.y > 0)] : null;
  if (maw || (pair && pair[0] && pair[1] && bin)) {
    // punkt mielenia: paszcza, a u statku z koszem — środek kosza (sekcja wciągana do ładowni otwartej od góry)
    const sink = maw || bin;
    const reach = maw ? Math.min(maw.w, maw.h) : Math.min(sink.w, sink.h) * 0.8;
    const half = (box.maxY - box.minY) / 2;
    const mounts = pair && pair[0] && pair[1]
      ? [[fx(pair[0].x), fy(pair[0].y)], [fx(pair[1].x), fy(pair[1].y)]]
      : [[r4(front - 0.17), fy(-half * 0.8)], [r4(front - 0.17), fy(half * 0.8)]];
    rig = {
      maw: [fx(sink.x), fy(sink.y)], mawR: r4(reach / im.w), front, gap: 0.085,
      mounts,
      stow: mounts.map(([x, y]) => [r4(x + 0.015), r4(y + Math.sign(y) * 0.06)]),
      grapples: mounts.map(([, y]) => [r4(front - 0.06), r4(y * 0.667)]),
      section: 0.3, segMin: 0.22, segMax: 0.62
    };
  }
  // lampy: dziób, najszersze miejsce, rufa — para na burtę w jednej kolumnie; „najszersza” para ma być najszersza
  // (strażnik lamp gry), więc para dziobowa i rufowa nie stoją szerzej niż ona (lej młyna: dziób szerszy niż środek)
  const lp = m.lights.position.map((q) => [Math.round(q.x * t), Math.round(q.y * t)]);
  const wideHalf = Math.floor((lp[3][1] - lp[2][1]) / 2);
  for (const i of [0, 4]) {
    const mid = (lp[i][1] + lp[i + 1][1]) / 2, half = Math.min((lp[i + 1][1] - lp[i][1]) / 2, wideHalf);
    lp[i][1] = Math.round(mid - half); lp[i + 1][1] = Math.round(mid + half);
  }
  return {
    key: ship.key, label: design.name, cls: ship.cls[0], png: [png[0], png[1]],
    length: Math.round(im.w / HULL_RENDER_WORLD_SCALE), radius: Math.round((box.maxY - box.minY) * 0.6 / HULL_RENDER_WORLD_SCALE),
    worldL: im.w,
    main: m.mainThrusters.map((q) => [px(q.x), px(q.y), px(q.r * 2)]).sort((a, b) => a[1] - b[1]),
    side: m.sideThrusters.map((q) => [px(q.x), px(q.y)]).sort((a, b) => (b[0] - a[0]) || (a[1] - b[1])),
    core: core ? { x: px(core.x), y: px(core.y), r: px(core.r * 1.6), hr: px(core.r), tier: `R${design.coreLevel || 1}` } : null,
    fuel: fuel ? { x: px(fuel.x), y: px(fuel.y), r: px(fuel.r) } : null,
    bridge: br ? { x: px(br.x - im.cx), y: px(br.y - im.cy), w: px(lv.w), h: px(lv.h), level: lv.level } : null,
    lights: { r: r1(Math.max(3, m.lights.position[0].radius * t)), p: lp },
    rig, work
  };
}

/** Tabele wszystkich statków roboczych: { [workHullId]: wpis }; `pngSize(key)` → [w, h] płótna sprite'a. */
export function buildWorkHullTables(pngSize) {
  const out = {};
  for (const ship of HD_WORKSHIPS) out[workHullId(ship.key)] = workHullTable(ship, pngSize(ship.key));
  return out;
}

/** Tekst modułu src/data/workHulls.js (LF) z tabel. */
export function workHullsModuleText(tables) {
  const rows = Object.entries(tables).map(([id, v]) => `  ${id}: ${JSON.stringify(v)}`).join(',\n');
  return `// src/data/workHulls.js — PLIK GENEROWANY (node scripts/kreator-kadluby-tabele.mjs --zapisz; sprite'y:
// node scripts/webgpu/kreator-kadluby-gry.mjs). Kadłuby gry statków roboczych złomowania z kreatora kadłubów
// (src/game/hullDesign/workships/, rachunek: src/game/hullDesign/hullDesignGameHull.js): płótno sprite'a, profil
// renderu, dysze MAIN [x, y, średnica] i SIDE, rdzeń, zbiornik paliwa, strefa mostka, lampy, osprzęt złomiarski (\`rig\`
// — ułamki szerokości płótna, src/data/scrapRigs.js) i osprzęt roboczy (\`work\` — hullDesignWorkRig). Piksele PNG od
// środka płótna (+x dziób, +y prawa burta). Nie edytuj ręcznie — zmień preset i przelicz (tests/workHulls.test.mjs).

const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

export const WORK_HULLS = deepFreeze({
${rows}
});

/** Id kadłubów gry statków roboczych (kolejność rejestru kreatora). */
export const WORK_HULL_IDS = Object.freeze(Object.keys(WORK_HULLS));
/** Ścieżka sprite'a w repo. */
export const workHullSpritePath = (id) => \`assets/ships/work/\${WORK_HULLS[id].key}.png\`;
/** Wpisy tabeli per kadłub: \`fn(wpis, id)\` → wartość; kadłuby bez wartości (null) pominięte. */
export function workHullRows(fn) {
  const out = {};
  for (const id of WORK_HULL_IDS) { const v = fn(WORK_HULLS[id], id); if (v != null) out[id] = v; }
  return out;
}
`;
}
