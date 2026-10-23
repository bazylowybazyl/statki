// Doki portów bez ringu w obrazie (E14: krzyż, okrąg, koło z wlotem) — klej renderu budowli PortDock3D
// (src/3d/portBuildings/portDock3D.js) w Core3D.scene. Warstwy: BG 0 — pass płaszczyzny gry (jak statki; pass tła
// rysuje się PRZED planetami, a planeta pod płaszczyzną w perspektywie wypada w kadrze przy budowli i przykrywała
// pokład — Merkury), FG 2 nad statkami; materiał BG składa ośrodek pasa (`volume` — Ceres, Westa).
//
//  - Dane: rekordy budowli z gry (`PortDockWorld.renderList` — tryb `off`) albo z bloku migawki `portDocks` (worker
//    renderu, src/render/blocks/portDockBlock.js): indeks rodzaju, składu i stylu, mnożnik, liczba doków, środek
//    i kąt osi +u w grze. Geometria z tego samego modułu co kolizje gry i ścieżki bańki
//    (`buildPortDockGeometry`, src/3d/portDocks/portDockLayout.js) — obraz pokrywa się z bryłami rozgrywki.
//  - ROZGRZEWKA: szablon każdego rodzaju (krzyż, okrąg, koło) na ekranie ładowania (`Core3D.warmup`, faza
//    'loading'). Budowle portów dzielą z szablonami grafy TSL, układ atrybutów i ramkę z wyznacznikiem +1, więc
//    pierwsza budowla w kadrze (także po teleporcie do odległego portu) nie kompiluje pipeline'u — tylko wgrywa
//    swoje bufory instancji.
//  - Budowle per port powstają leniwie (najwyżej jedna na klatkę), w puli: niewidoczna budowla wraca do użycia, gdy
//    dok tego samego kształtu i stylu wejdzie w zasięg; nadmiar ponad `PORT_DOCKS3D.keep` zwalnia najdawniej
//    widziana. Statyczne: macierz ramki zmienia się tylko przy innej pozie, co klatkę — zegar efektów i obrót
//    piasty koła. Odcięcie poza kadrem robi three (`frustumCulled` siatek z kulą obrysu budowli).
//  - Słońce z `RenderWorld.sun` (azymut ku Słońcu gry, wysokość 49° — PORT_SPACE_LIGHT) × maska cieni Core3D.
//  - Zero alokacji w klatce przy stałym zestawie budowli (dopasowanie liczbami, bez kluczy-napisów).
import { Core3D } from './core3d.js';
import { RenderWorld } from '../render/renderWorld.js';
import { PortDock3D } from './portBuildings/portDock3D.js';
import { buildPortDockGeometry } from './portDocks/portDockLayout.js';
import { PORT_DOCK_KIND_IDS, BERTH_MIX_IDS, PORT_DOCK_STYLE_IDS } from '../data/portDocks.js';

const LAYER_BG = 0;
const LAYER_FG = 2;

export const PORT_DOCKS3D = Object.freeze({
  /** Najwięcej budowli trzymanych w pamięci (widoczne + pula). */
  keep: 6,
  /** Nowych budowli najwyżej tyle na klatkę (budowa sceny i wgranie buforów ~kilka ms). */
  buildsPerFrame: 1
});

/** Szablony rozgrzewki: rodzaj → reprezentatywny skład (te same grafy i układ atrybutów co każda budowla rodzaju). */
const TEMPLATE_SPECS = Object.freeze([
  Object.freeze({ kind: 'cross', mix: 'default', repeats: 1, dockCount: 2, style: 'earth' }),
  Object.freeze({ kind: 'round', mix: 'default', repeats: 2, dockCount: 2, style: 'mars' }),
  Object.freeze({ kind: 'wheel', mix: 'default', repeats: 4, dockCount: 2, style: 'jupiter' })
]);

let templates = null;
/** Budowle: `{ dock: PortDock3D, kind, mix, style, repeats, dockCount, seenFrame }`. */
const live = [];
let frame = 0;
const _sun = { sun: null, at: { x: 0, y: 0 } };

function setupDock(dock) {
  dock.setLayers(LAYER_BG, LAYER_FG);
  dock.root.userData.fgCategory = 'stations';
  return dock;
}

function buildTemplates() {
  if (templates || !Core3D.scene) return templates;
  templates = TEMPLATE_SPECS.map((s) => setupDock(new PortDock3D({
    geometry: buildPortDockGeometry(s), style: s.style, x: 0, y: 0, angle: 0, name: `Dok (rozgrzewka) ${s.kind}`
  })));
  return templates;
}

Core3D.warmup?.add?.({
  name: 'doki portów: krzyż, okrąg, koło',
  objects: () => buildTemplates()?.map((d) => d.root) || null,
  phase: 'loading'
});

const fieldOf = (r, key) => (r[key] !== undefined ? r[key] : r.spec ? r.spec[key] : undefined);

function matches(e, kind, mix, style, repeats, dockCount) {
  return e.kind === kind && e.mix === mix && e.style === style && e.repeats === repeats && e.dockCount === dockCount;
}

/** Budowla dla rekordu: widoczna z poprzedniej klatki w tej samej pozie, wolna z puli albo nowa (limit na klatkę). */
function acquire(r, budget) {
  const kind = r.kindIndex | 0;
  const mix = r.mixIndex | 0;
  const style = r.styleIndex | 0;
  const repeats = Math.max(1, Number(fieldOf(r, 'repeats')) | 0);
  const dockCount = Math.max(1, Number(fieldOf(r, 'dockCount')) | 0);
  let free = null;
  for (let i = 0; i < live.length; i++) {
    const e = live[i];
    if (!matches(e, kind, mix, style, repeats, dockCount)) continue;
    if (e.seenFrame === frame) continue;
    if (e.dock.placeX === r.x && e.dock.placeY === r.y && e.dock.placeAngle === r.angle) return e;
    if (!free || e.seenFrame < free.seenFrame) free = e;
  }
  if (free) return free;
  if (budget.left <= 0 || !Core3D.scene) return null;
  budget.left--;
  const geometry = buildPortDockGeometry({
    kind: PORT_DOCK_KIND_IDS[kind] || 'cross', mix: BERTH_MIX_IDS[mix] || 'default', repeats, dockCount
  });
  const dock = setupDock(new PortDock3D({ geometry, style: PORT_DOCK_STYLE_IDS[style] || 'earth', name: `Dok ${geometry.kind}` }));
  const e = { dock, kind, mix, style, repeats, dockCount, seenFrame: -1 };
  live.push(e);
  return e;
}

/** Nadmiar ponad `keep`: zwalnia najdawniej widziane budowle (nie te z tej klatki). */
function trim() {
  while (live.length > PORT_DOCKS3D.keep) {
    let oldest = -1;
    for (let i = 0; i < live.length; i++) {
      if (live[i].seenFrame === frame) continue;
      if (oldest < 0 || live[i].seenFrame < live[oldest].seenFrame) oldest = i;
    }
    if (oldest < 0) return;
    live[oldest].dock.dispose();
    live.splice(oldest, 1);
  }
}

const _budget = { left: 0 };

/**
 * Klatka: `list` — rekordy budowli w zasięgu kadru (`kindIndex`, `mixIndex`, `styleIndex`, `repeats` i `dockCount`
 * albo `spec.repeats` / `spec.dockCount`, `x`, `y`, `angle`), `count` — ile z listy, `dt` — czas klatki (0 w pauzie),
 * `sun` — Słońce w układzie gry (domyślnie `RenderWorld.sun`).
 */
export function updatePortDocks3D(list, count, dt = 0, sun = null) {
  if (!Core3D.scene) return;
  frame++;
  _budget.left = PORT_DOCKS3D.buildsPerFrame;
  const n = list ? Math.min(count | 0, list.length) : 0;
  const s = sun || RenderWorld.sun || null;
  for (let i = 0; i < n; i++) {
    const r = list[i];
    if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
    const e = acquire(r, _budget);
    if (!e) continue;
    e.seenFrame = frame;
    const d = e.dock;
    d.place(r.x, r.y, Number(r.angle) || 0);
    if (d.root.parent !== Core3D.scene) Core3D.scene.add(d.root);
    d.root.visible = true;
    if (s) {
      _sun.sun = s;
      _sun.at.x = r.x;
      _sun.at.y = r.y;
      d.setSun(_sun);
    }
    d.update(dt);
  }
  for (let i = 0; i < live.length; i++) {
    const e = live[i];
    if (e.seenFrame !== frame && e.dock.root.visible) e.dock.root.visible = false;
  }
  if (live.length > PORT_DOCKS3D.keep) trim();
}

/** Stan (dev, narzędzia): liczba budowli, widoczne, rysunki. */
export function portDocks3DStats() {
  let visible = 0;
  let draws = 0;
  for (const e of live) {
    if (!e.dock.root.visible) continue;
    visible++;
    draws += e.dock.drawCalls;
  }
  return { built: live.length, visible, draws, templates: templates ? templates.length : 0 };
}
