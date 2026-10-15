// src/game/hullDesign/hullDesignParts.js
//
// KREATOR KADŁUBÓW — biblioteka GOTOWYCH CZĘŚCI (czyste dane): złożone elementy w stylu Terra Novy — wieża mostka,
// dziób z rozwidleniem, blok silników, sponson, rząd hangarów, blok wieży, grzbiet, port — stawiane w projekcie jak
// moduł: { id, x, y, s (skala), rot, dl (przesunięcie poziomów), mirror? } w polu `parts` projektu. Rozwinięcie
// (expandHullDesign) zamienia część na zwykłe bryły, moduły i naklejki — reszta kreatora o częściach nie wie.
//
// Część jest opisana w swoim układzie (x ku dziobowi, y w dół, środek w 0, 0) w j. przy skali 1 — wymiary jak na
// okręcie o detail ≈ 0,6 (lotniskowiec); kreator stawia ją ze skalą detail / 0,6, więc pasuje do okrętu.

const oct = (a, cx = 0, cy = 0) => {
  const k = a * Math.tan(Math.PI / 8);
  return [[cx + a, cy - k], [cx + a, cy + k], [cx + k, cy + a], [cx - k, cy + a], [cx - a, cy + k], [cx - a, cy - k], [cx - k, cy - a], [cx + k, cy - a]];
};
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export const HD_PARTS = Object.freeze({
  tn_bridge: Object.freeze({
    label: 'Wieża mostka TN', size: [96, 60],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 2, ch: 3, pts: [[-46, -30], [28, -30], [46, -14], [46, 14], [28, 30], [-46, 30]] },
        { kind: 'poly', op: 'add', level: 3, ch: 2.5, pts: [[-32, -19], [14, -19], [26, -8], [26, 8], [14, 19], [-32, 19]] }
      ],
      modules: [
        { type: 'bridge', x: 12, y: 0, w: 14, h: 13 },
        { type: 'vent', x: -38, y: -22, w: 7, h: 2.6, rot: Math.PI / 2 },
        { type: 'vent', x: -38, y: 22, w: 7, h: 2.6, rot: Math.PI / 2 },
        { type: 'turret_s', x: -16, y: 0, r: 6.5, v: 0 }
      ],
      decals: []
    })
  }),
  tn_bow: Object.freeze({
    label: 'Dziób z rozwidleniem TN', size: [160, 100],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 0, ch: 1, pts: rect(-4, -14, 120, 14) },
        { kind: 'poly', op: 'add', level: 1, ch: 3, pts: [[0, -50], [44, -50], [156, -14], [156, -9], [44, -13], [0, -13]] },
        { kind: 'poly', op: 'add', level: 1, ch: 3, pts: [[0, 13], [44, 13], [156, 9], [156, 14], [44, 50], [0, 50]] }
      ],
      modules: [
        { type: 'vent', x: 24, y: -30, w: 3, h: 12, rot: 0 },
        { type: 'vent', x: 24, y: 30, w: 3, h: 12, rot: 0 }
      ],
      decals: [
        { kind: 'stripe', x0: 36, y0: -50, x1: 36, y1: -14, w: 3.4, color: '#2f2e2b', opacity: 0.85 },
        { kind: 'stripe', x0: 36, y0: 14, x1: 36, y1: 50, w: 3.4, color: '#2f2e2b', opacity: 0.85 }
      ]
    })
  }),
  tn_engines: Object.freeze({
    label: 'Blok silników TN (3 gondole)', size: [100, 100],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 0, ch: 2, pts: rect(-48, -48, 34, 48) },
        { kind: 'poly', op: 'add', level: 1, ch: 4, pts: [[-12, -50], [30, -50], [42, -38], [42, 38], [30, 50], [-12, 50]] }
      ],
      modules: [
        { type: 'engine', x: -40, y: -31, w: 22, h: 13, n: 1 },
        { type: 'engine', x: -44, y: 0, w: 24, h: 15, n: 1 },
        { type: 'engine', x: -40, y: 31, w: 22, h: 13, n: 1 },
        { type: 'vent', x: 18, y: 0, w: 14, h: 4, rot: Math.PI / 2 }
      ],
      decals: []
    })
  }),
  tn_sponson: Object.freeze({
    label: 'Sponson / skrzydło TN', size: [130, 60],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 1, ch: 3, pts: [[-62, 0], [42, 0], [70, -26], [44, -54], [-40, -54], [-62, -32]] }
      ],
      modules: [
        { type: 'turret_m', x: 4, y: -27, r: 12, v: 0 },
        { type: 'vent', x: -40, y: -14, w: 9, h: 3, rot: 0 }
      ],
      decals: [{ kind: 'emblem', id: 'eagle', x: -32, y: -38, w: 16, h: 13, rot: 0, color: '#34332f', opacity: 0.9 }]
    })
  }),
  tn_hangars: Object.freeze({
    label: 'Rząd hangarów TN (3 wrota)', size: [260, 100],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 0, ch: 2, pts: rect(-120, -38, 120, 38) },
        { kind: 'poly', op: 'add', level: 1, ch: 4, pts: rect(-132, -50, 132, 50), holes: [rect(-120, -37, 120, 37)] }
      ],
      modules: [-80, 0, 80].map((x) => ({ type: 'hangar', x, y: 0, w: 37, h: 33, doors: 1 })),
      decals: []
    })
  }),
  tn_turret_block: Object.freeze({
    label: 'Blok wieży TN (ośmiokąt)', size: [60, 60],
    make: () => ({
      shapes: [{ kind: 'poly', op: 'add', level: 2, ch: 0, pts: oct(28) }],
      modules: [{ type: 'turret_l', x: 0, y: 0, r: 17, v: 0 }],
      decals: []
    })
  }),
  tn_spine: Object.freeze({
    label: 'Grzbiet TN z portami', size: [320, 34],
    make: () => ({
      shapes: [{ kind: 'poly', op: 'add', level: 2, ch: 2, pts: [[-150, -16], [138, -16], [160, 0], [138, 16], [-150, 16]] }],
      modules: [
        { type: 'well', x: -100, y: 0, r: 9 }, { type: 'well', x: 10, y: 0, r: 9 }, { type: 'well', x: 110, y: 0, r: 9 },
        { type: 'vent', x: -45, y: 0, w: 14, h: 4, rot: 0 }, { type: 'vent', x: 60, y: 0, w: 14, h: 4, rot: 0 }
      ],
      decals: []
    })
  }),
  tn_port: Object.freeze({
    label: 'Port okrągły TN', size: [44, 44],
    make: () => ({
      shapes: [{ kind: 'poly', op: 'add', level: 2, ch: 0, pts: oct(21) }],
      modules: [{ type: 'well', x: 0, y: 0, r: 15 }],
      decals: []
    })
  }),
  tn_bridge_tall: Object.freeze({
    label: 'Mostek schodkowy TN (3 piętra)', size: [140, 84],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 1, ch: 4, pts: [[-70, -42], [40, -42], [70, -16], [70, 16], [40, 42], [-70, 42]] },
        { kind: 'poly', op: 'add', level: 2, ch: 3, pts: [[-58, -30], [24, -30], [44, -12], [44, 12], [24, 30], [-58, 30]] },
        { kind: 'poly', op: 'add', level: 3, ch: 2.5, pts: [[-44, -18], [8, -18], [22, -6], [22, 6], [8, 18], [-44, 18]] }
      ],
      modules: [
        { type: 'bridge', x: 4, y: 0, w: 14, h: 12 },
        { type: 'vent', x: -60, y: -34, w: 8, h: 2.6, rot: 0 },
        { type: 'vent', x: -60, y: 34, w: 8, h: 2.6, rot: 0 },
        { type: 'well', x: -30, y: 0, r: 7 }
      ],
      decals: []
    })
  }),
  tn_bridge_wedge: Object.freeze({
    label: 'Mostek klinowy TN', size: [110, 56],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 2, ch: 3, pts: [[-52, -26], [10, -26], [56, 0], [10, 26], [-52, 26]] },
        { kind: 'poly', op: 'add', level: 3, ch: 2, pts: [[-36, -15], [2, -15], [30, 0], [2, 15], [-36, 15]] }
      ],
      modules: [
        { type: 'bridge', x: 0, y: 0, w: 12, h: 10 },
        { type: 'turret_s', x: -28, y: 0, r: 6, v: 0 }
      ],
      decals: []
    })
  }),
  tn_bow_blade: Object.freeze({
    label: 'Dziób klinowy TN (pełny)', size: [180, 120],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 0, ch: 1, pts: [[-6, -56], [60, -56], [176, -8], [176, 8], [60, 56], [-6, 56]] },
        { kind: 'poly', op: 'add', level: 1, ch: 3, pts: [[0, -60], [56, -60], [172, -10], [172, -4], [56, -6], [0, -6]] },
        { kind: 'poly', op: 'add', level: 1, ch: 3, pts: [[0, 6], [56, 6], [172, 4], [172, 10], [56, 60], [0, 60]] }
      ],
      modules: [
        { type: 'vent', x: 30, y: -40, w: 10, h: 3.2, rot: 0 },
        { type: 'vent', x: 30, y: 40, w: 10, h: 3.2, rot: 0 }
      ],
      decals: [
        { kind: 'stripe', x0: 46, y0: -60, x1: 46, y1: -6, w: 3.6, color: '#2f2e2b', opacity: 0.85 },
        { kind: 'stripe', x0: 46, y0: 6, x1: 46, y1: 60, w: 3.6, color: '#2f2e2b', opacity: 0.85 }
      ]
    })
  }),
  tn_engines_grid: Object.freeze({
    label: 'Silniki blokowe TN (Colossus)', size: [70, 120],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 0, ch: 2, pts: rect(-30, -58, 30, 58) },
        { kind: 'poly', op: 'add', level: 1, ch: 3, pts: rect(-4, -60, 34, 60) }
      ],
      modules: [
        { type: 'engine', x: -26, y: -30, w: 18, h: 22, v: 1 },
        { type: 'engine', x: -26, y: 30, w: 18, h: 22, v: 1 },
        { type: 'vent', x: 18, y: 0, w: 16, h: 4, rot: Math.PI / 2 }
      ],
      decals: []
    })
  }),
  tn_mid: Object.freeze({
    label: 'Sekcja kadłuba TN (środek)', size: [240, 150],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 0, ch: 2, pts: rect(-120, -60, 120, 60) },
        { kind: 'poly', op: 'add', level: 1, ch: 4, pts: [[-120, -74], [96, -74], [120, -50], [120, -14], [-120, -14]] },
        { kind: 'poly', op: 'add', level: 1, ch: 4, pts: [[-120, 14], [120, 14], [120, 50], [96, 74], [-120, 74]] },
        { kind: 'poly', op: 'add', level: 2, ch: 2.5, pts: rect(-100, -8, 100, 8) }
      ],
      modules: [
        { type: 'well', x: -60, y: 0, r: 7 }, { type: 'well', x: 60, y: 0, r: 7 },
        { type: 'vent', x: -40, y: -50, w: 14, h: 4, rot: 0 }, { type: 'vent', x: 40, y: 50, w: 14, h: 4, rot: 0 },
        { type: 'hatch', x: 70, y: -44, w: 12, h: 8 }, { type: 'hatch', x: -70, y: 44, w: 12, h: 8 }
      ],
      decals: []
    })
  }),
  tn_stern: Object.freeze({
    label: 'Rufa TN (2 bębny)', size: [150, 150],
    make: () => ({
      shapes: [
        { kind: 'poly', op: 'add', level: 0, ch: 2, pts: rect(-62, -70, 70, 70) },
        { kind: 'poly', op: 'add', level: 1, ch: 4, pts: [[-24, -74], [52, -74], [72, -54], [72, 54], [52, 74], [-24, 74], [-24, 22], [-6, 22], [-6, -22], [-24, -22]] },
        { kind: 'poly', op: 'add', level: 2, ch: 3, pts: rect(10, -16, 60, 16) }
      ],
      modules: [
        { type: 'engine', x: -56, y: -44, w: 28, h: 18, n: 1 },
        { type: 'engine', x: -56, y: 44, w: 28, h: 18, n: 1 },
        { type: 'reactor', x: 34, y: 0, r: 12, v: 1 },
        { type: 'vent', x: 30, y: -52, w: 12, h: 3.6, rot: 0 }, { type: 'vent', x: 30, y: 52, w: 12, h: 3.6, rot: 0 }
      ],
      decals: [{ kind: 'emblem', id: 'eagle', x: 34, y: -36, w: 18, h: 14, rot: 0, color: '#34332f', opacity: 0.9 }]
    })
  })
});
export const HD_PART_IDS = Object.freeze(Object.keys(HD_PARTS));

/**
 * Część → bryły, moduły i naklejki w układzie projektu. `inst` = { id, x, y, s, rot, dl }, `flip` — kopia lustra
 * (y → −y: część odbita, obrót przeciwny). Zwraca { shapes, modules, decals } (bez pola mirror — rozwinięte).
 */
export function expandHullPart(inst, flip = false, levels = 4) {
  const def = HD_PARTS[inst.id];
  if (!def) return { shapes: [], modules: [], decals: [] };
  const src = def.make();
  const s = inst.s, fy = flip ? -1 : 1;
  const rot = (inst.rot || 0) * fy;
  const c = Math.cos(rot), sn = Math.sin(rot);
  const ox = inst.x, oy = inst.y * fy;
  const P = (x, y) => { const lx = x * s, ly = y * s * fy; return [ox + lx * c - ly * sn, oy + lx * sn + ly * c]; };
  const lvl = (L) => Math.max(0, Math.min(levels - 1, (L || 0) + (inst.dl || 0)));
  const shapes = src.shapes.map((sh) => {
    if (sh.kind === 'poly') {
      return {
        ...sh, level: lvl(sh.level), mirror: false, ch: (sh.ch || 0) * s, r: (sh.r || 0) * s,
        pts: sh.pts.map(([x, y]) => P(x, y)), holes: sh.holes ? sh.holes.map((h) => h.map(([x, y]) => P(x, y))) : undefined
      };
    }
    const [x, y] = P(sh.x, sh.y);
    if (sh.kind === 'circle') return { ...sh, x, y, r: sh.r * s, level: lvl(sh.level), mirror: false };
    return { ...sh, x, y, w: sh.w * s, h: sh.h * s, r: (sh.r || 0) * s, ch: (sh.ch || 0) * s, rot: (sh.rot || 0) * fy + rot, level: lvl(sh.level), mirror: false };
  });
  const modules = src.modules.map((m) => {
    const [x, y] = P(m.x, m.y);
    const out = { ...m, x, y, rot: (m.rot || 0) * fy + rot, mirror: false };
    if (m.r) out.r = m.r * s;
    if (m.w) { out.w = m.w * s; out.h = m.h * s; }
    return out;
  });
  const decals = src.decals.map((d) => {
    if (d.kind === 'stripe') {
      const [x0, y0] = P(d.x0, d.y0), [x1, y1] = P(d.x1, d.y1);
      return { ...d, x0, y0, x1, y1, w: d.w * s, mirror: false };
    }
    const [x, y] = P(d.x, d.y);
    return { ...d, x, y, w: d.w * s, h: d.h * s, rot: (d.rot || 0) * fy + rot, flip: d.kind === 'emblem' ? (!!d.flip !== flip) : !!d.flip, mirror: false };
  });
  return { shapes, modules, decals };
}
