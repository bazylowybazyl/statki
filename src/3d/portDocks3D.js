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
//  - SOCZEWKA ŚWIATA (DECYZJE E1, etap 3A): w skoku gracza budowla jedzie za obrazem swojego ciała (kotwica
//    worldLens.js WARP_LENS_ANCHORS po id portu — planeta, małe ciało, księżyc z bryłą; księżyc bez bryły — kotwica
//    planety-rodzica; dok bez ciała — własny rekord soczewki `dock:<n>`, zwalniany z budowlą): root.matrix = macierz
//    soczewki (punkt p → obraz + k · (p − środek doku), z bez przesunięcia) · ramka, oba zestawy w passie TŁA (warstwa 1:
//    perspektywa jak FG, przed passem gry — pod kadłubami, E3; nadbudówki FG nie skaczą przy przełączeniu, jak przy
//    perspektywa → ortho). Start z doku przy Lunie / Ceres / Weście / Wenus: dok maleje i odpływa razem z ciałem.
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { RenderWorld } from '../render/renderWorld.js';
import { PortDock3D } from './portBuildings/portDock3D.js';
import { buildPortDockGeometry } from './portDocks/portDockLayout.js';
import { portHubMatrixElements } from './portBuildings/portModuleTraffic.js';
import { PORT_DOCK_KIND_IDS, BERTH_MIX_IDS, PORT_DOCK_STYLE_IDS } from '../data/portDocks.js';
import { SYSTEM_MAP_MOON_BY_ID } from '../data/systemMap.js';
import {
  WARP_WORLD_LENS, WARP_LENS_ANCHORS, warpLensExtraBody, setWarpLensExtra, dropWarpLensExtra, lensAnchorPoint,
  lensPivotElements, lensWorldInFrame
} from './warp/worldLens.js';

const LAYER_BG = 0;
const LAYER_FG = 2;
// Soczewka skoku gracza: oba zestawy w passie tła (Core3D renderPassBg — warstwa 1, kamera perspektywy jak FG)
const LAYER_LENS = 1;

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
/**
 * Budowle: `{ dock: PortDock3D, kind, mix, style, repeats, dockCount, seenFrame, serial, lensRec, lensMat, frameRef,
 * frameM }` — frameM: ramka budowli jako Matrix4 (przeliczana tylko przy nowej pozie — `d.frame` to nowy obiekt).
 */
const live = [];
let frame = 0;
let serial = 0;
const _sun = { sun: null, at: { x: 0, y: 0 } };

// Soczewka: obraz środka doku, macierz soczewki (bez alokacji).
const LENS_MIN_PX = 1;            // [px bufora] budowla w soczewce mniejsza niż tyle (promień dysku zapasu) — schowana
const _lensPt = { x: 0, y: 0, k: 1 };
const _lensEl = new Array(16).fill(0);
const _lensM = new THREE.Matrix4();

/** Ramka budowli (Matrix4) — przeliczana tylko przy nowej pozie (`place` podmienia `d.frame`). */
function frameMatrix(e) {
  const d = e.dock;
  if (e.frameRef !== d.frame) {
    e.frameRef = d.frame;
    (e.frameM || (e.frameM = new THREE.Matrix4())).fromArray(portHubMatrixElements(d.frame));
  }
  return e.frameM;
}

/**
 * Kotwica soczewki budowli (z obrazem przesuniętym) albo null. Klucz: `anchorId` (blok migawki — worker) albo `stationId`
 * (rekord gry — off). Dok bez ciała — rekord dodatkowy soczewki tej budowli (miejsce i dysk zapasu co klatkę).
 */
function dockLensAnchor(r, e) {
  const key = r.anchorId !== undefined ? r.anchorId : (r.stationId ?? null);
  const keepR = Number(e.dock.geometry?.keepR) || 5000;
  let a = key ? WARP_LENS_ANCHORS[key] : undefined;
  if (key && !(a && a.on)) {
    const moon = SYSTEM_MAP_MOON_BY_ID[key];
    const pa = moon && moon.parentId ? WARP_LENS_ANCHORS[moon.parentId] : undefined;
    if (pa && pa.on) a = pa;
  }
  if (a !== undefined || (key && SYSTEM_MAP_MOON_BY_ID[key])) {
    if (!a || !a.on) return null;
    // zasięg rzeczy przypiętych — decyzja wejścia ciała widzi dok w kadrze (worldLens.js: attachR)
    const dx = r.x - a.rx;
    const dy = r.y - a.ry;
    const reach = Math.sqrt(dx * dx + dy * dy) + keepR;
    if (reach > a.reach) a.reach = reach;
    return a.real < 0.999 ? a : null;
  }
  // dok bez ciała (kryjówka, stacja gracza): własny rekord — rozstawia go planet3d w tym samym przebiegu co ciała
  if (!e.lensRec) e.lensRec = warpLensExtraBody(`dock:${e.serial}`, 'small');
  setWarpLensExtra(e.lensRec, r.x, r.y, keepR, 0);
  const own = e.lensRec.anchor;
  return own && own.on && own.real < 0.999 ? own : null;
}

/** Budowla w soczewce (macierz soczewki · ramka, warstwy pod statkiem) albo z powrotem na prawdziwym miejscu. */
function applyDockLens(e, r, a) {
  const d = e.dock;
  if (!a) {
    if (e.lensMat) {
      e.lensMat = false;
      d.root.matrix.copy(frameMatrix(e));
      d.root.matrixWorldNeedsUpdate = true;
      d.setLayers(LAYER_BG, LAYER_FG);
    }
    return true;
  }
  lensAnchorPoint(a, r.x, r.y, _lensPt);
  const k = Math.max(1e-6, _lensPt.k);
  const keepR = Number(d.geometry?.keepR) || 5000;
  // obraz środka doku w płaszczyźnie gry (z bez przesunięcia — pass tła rysuje się przed passem gry, pod kadłubami)
  lensPivotElements(_lensPt.x, -_lensPt.y, 0, k, r.x, -r.y, 0, _lensEl);
  _lensM.fromArray(_lensEl);
  d.root.matrix.copy(frameMatrix(e)).premultiply(_lensM);
  d.root.matrixWorldNeedsUpdate = true;
  if (!e.lensMat) {
    e.lensMat = true;
    d.setLayers(LAYER_LENS, LAYER_LENS);
  }
  // obraz doku w kadrze (ciało może być już za kadrem — start: dok pod statkiem, ciało pod rufą)
  const zoom = Number(WARP_WORLD_LENS.zoom) || 0;
  return k * keepR * zoom >= LENS_MIN_PX && lensWorldInFrame(WARP_WORLD_LENS, _lensPt.x, _lensPt.y, k * keepR);
}

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
  const e = {
    dock, kind, mix, style, repeats, dockCount, seenFrame: -1, serial: ++serial, lensRec: null, lensMat: false,
    frameRef: null, frameM: null
  };
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
    // rekord soczewki doku bez ciała znika z budowlą (rejestry soczewki nie rosną przy długiej sesji)
    if (live[oldest].lensRec) dropWarpLensExtra(live[oldest].lensRec);
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
    d.root.visible = applyDockLens(e, r, dockLensAnchor(r, e));
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
