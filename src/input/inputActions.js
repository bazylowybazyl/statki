// ============================================================
// Akcje wejścia (docs/PLAN-pad.md § 4, etap 1) — katalog akcji gracza i układy klawiatury, myszy i pada
// z etykietami. Moduł czysty (bez DOM i okna gry).
//
// Akcja: { id, name (PL), cat, kind, ctx, shares?, legacy? }:
//   kind — 'edge' (zbocze: raz na wciśnięcie), 'hold' (trzymanie), 'axis' (oś analogowa);
//   ctx  — konteksty, w których akcja działa (src/input/inputContext.js; dodatkowe tryby gry: 'rts' — flota,
//          'mining' — wydobycie; kolizja wejść liczy się w obrębie jednego kontekstu — tests/inputActions.test.mjs);
//          kontekst bramkuje pad — klawiatura ma bramki w słuchaczach DOM i GameActions (index.html);
//   shares — to samo wejście co wskazana akcja w tym samym kontekście, rozłączne stanem (bramka, nakładka,
//          stuknięcie / trzymanie); legacy — dawna ścieżka pada bez odpowiednika na klawiaturze (do usunięcia
//          w układzie „Dowódca”).
// Układy:
//   KEYBOARD_LAYOUT — id → kody `KeyboardEvent.code` (fizyczne miejsce klawisza, nie znak);
//   MOUSE_LAYOUT    — id → etykieta przycisku / kółka myszy;
//   PAD_LAYOUT      — id → wiązanie pada gracza 1: { button } | { axis, dir } (połowa osi) | { axis, invert, curve }
//                     (oś) | { stick } (wektor gałki) | lista wiązań; `holdMs` — przytrzymanie, `edge` — próg zbocza osi;
//   PAD_LAYOUT_P2   — gracz 2 na podzielonym ekranie (jak dziś — do etapu 8).
// Etap 1 przenosi na nową warstwę DZISIEJSZY zakres pada (lot, RT, dopalacz, warp, zoom, CIC, menu); układ
// „Dowódca” (§ 3.2) to etapy 2–4 — akcje bez wiązania pada mają tu `null` (świadomie, nie przez zapomnienie).
// KEYDOWN_ORDER — kolejność akcji w głównym `keydown` gry (index.html); ta sama co w dawnym kodzie: tryby
// wydobycia i torped przed resztą, CIC (W/A/S/D) przed szarżą itd. — klej przechodzi ją w tej kolejności.
// ============================================================
import { PB, PAD_FAMILY } from './padDevice.js';

export const ACTION_KIND = Object.freeze({ EDGE: 'edge', HOLD: 'hold', AXIS: 'axis' });

const G = ['game'];
const GC = ['game', 'cic'];

/** Katalog akcji. */
export const INPUT_ACTIONS = Object.freeze([
  // --- lot ---
  { id: 'fly.forward', name: 'Ciąg naprzód', cat: 'lot', kind: 'hold', ctx: G },
  { id: 'fly.back', name: 'Hamulec / wsteczny', cat: 'lot', kind: 'hold', ctx: G },
  { id: 'fly.left', name: 'Obrót w lewo', cat: 'lot', kind: 'hold', ctx: G },
  { id: 'fly.right', name: 'Obrót w prawo', cat: 'lot', kind: 'hold', ctx: G },
  { id: 'fly.strafeLeft', name: 'Ruch w lewo', cat: 'lot', kind: 'hold', ctx: G },
  { id: 'fly.strafeRight', name: 'Ruch w prawo', cat: 'lot', kind: 'hold', ctx: G },
  { id: 'fly.thrust', name: 'Ciąg (oś)', cat: 'lot', kind: 'axis', ctx: G },
  { id: 'fly.turn', name: 'Obrót (oś)', cat: 'lot', kind: 'axis', ctx: G },
  { id: 'fly.boost', name: 'Dopalacz', cat: 'lot', kind: 'hold', ctx: GC },
  { id: 'fly.gearDown', name: 'Bieg w dół', cat: 'lot', kind: 'edge', ctx: G },
  { id: 'fly.driveAuto', name: 'Automat napędu', cat: 'lot', kind: 'edge', ctx: G },
  { id: 'fly.driveMode', name: 'Tryb napędu', cat: 'lot', kind: 'edge', ctx: G },
  { id: 'fly.damper', name: 'Damper grawitacyjny', cat: 'lot', kind: 'edge', ctx: G },
  { id: 'fly.stabilizer', name: 'Stabilizator kursu', cat: 'lot', kind: 'edge', ctx: G },
  { id: 'nav.warp', name: 'Warp', cat: 'lot', kind: 'edge', ctx: GC },
  // --- okręt i tryby ---
  { id: 'ship.ram', name: 'System okrętu: szarża / manewr (z Q, E, A, D) / zryw / szybki ogień', cat: 'okret', kind: 'edge', ctx: G },
  { id: 'wpn.rocketKey', name: 'Rakieta (kadłub bez systemu okrętu)', cat: 'bron', kind: 'edge', ctx: G, shares: 'ship.ram' },
  { id: 'ship.cloak', name: 'Maskowanie', cat: 'okret', kind: 'edge', ctx: G },
  { id: 'ship.lights', name: 'Reflektory', cat: 'okret', kind: 'edge', ctx: G },
  { id: 'ship.repair', name: 'Naprawa', cat: 'okret', kind: 'edge', ctx: G },
  { id: 'ship.engines', name: 'Silniki główne: odpal / zgaś', cat: 'okret', kind: 'edge', ctx: G },
  { id: 'mode.mining', name: 'Tryb wydobycia', cat: 'tryby', kind: 'edge', ctx: G },
  { id: 'mode.torpedo', name: 'Tryb torped / wachlarz', cat: 'tryby', kind: 'edge', ctx: G },
  { id: 'mode.fleet', name: 'Tryb floty', cat: 'tryby', kind: 'edge', ctx: ['game', 'rts'] },
  { id: 'mining.tractor', name: 'Wiązka ściągająca', cat: 'tryby', kind: 'edge', ctx: ['mining'] },
  { id: 'mining.charge', name: 'Wielkość ładunku', cat: 'tryby', kind: 'edge', ctx: ['mining'] },
  { id: 'mining.detonate', name: 'Detonacja ładunków', cat: 'tryby', kind: 'edge', ctx: ['mining'] },
  // --- broń i cele ---
  { id: 'wpn.fire', name: 'Ogień grupy w ręku', cat: 'bron', kind: 'hold', ctx: G },
  { id: 'wpn.group1', name: 'Działa w rękę (z Ctrl / Alt: auto)', cat: 'bron', kind: 'edge', ctx: G },
  { id: 'wpn.group2', name: 'Bateria główna w rękę (z Ctrl / Alt: auto)', cat: 'bron', kind: 'edge', ctx: G },
  { id: 'wpn.group3', name: 'Rakiety w rękę (z Ctrl / Alt: auto)', cat: 'bron', kind: 'edge', ctx: G },
  { id: 'wpn.lance', name: 'Hexlance', cat: 'bron', kind: 'edge', ctx: G },
  { id: 'wpn.special', name: 'Pocisk specjalny', cat: 'bron', kind: 'edge', ctx: G },
  { id: 'wpn.energy', name: 'Strzał energii tarczy', cat: 'bron', kind: 'edge', ctx: G },
  { id: 'wpn.posture', name: 'Postawa ognia', cat: 'bron', kind: 'edge', ctx: G },
  { id: 'wpn.fighters', name: 'Myśliwce', cat: 'bron', kind: 'edge', ctx: G },
  { id: 'wpn.rocket', name: 'Rakiety (dawna ścieżka pada)', cat: 'bron', kind: 'hold', ctx: G, legacy: true },
  { id: 'wpn.specialFire', name: 'Broń specjalna albo rakiety (dawna ścieżka pada)', cat: 'bron', kind: 'hold', ctx: G, legacy: true },
  { id: 'tgt.priority', name: 'Cel priorytetowy', cat: 'cele', kind: 'edge', ctx: G },
  { id: 'tgt.paint', name: 'Malowanie celów (trzymane)', cat: 'cele', kind: 'hold', ctx: G, shares: 'tgt.priority' },
  { id: 'tgt.queue', name: 'Dołóż / zdejmij cel', cat: 'cele', kind: 'edge', ctx: G },
  { id: 'tgt.scan', name: 'Aktywny skan', cat: 'cele', kind: 'edge', ctx: ['game', 'rts'] },
  { id: 'tgt.drone', name: 'Obraz drona', cat: 'cele', kind: 'edge', ctx: G },
  { id: 'aim.cursor', name: 'Celownik', cat: 'cele', kind: 'axis', ctx: G },
  // --- kamera ---
  { id: 'cam.zoomIn', name: 'Przybliż', cat: 'kamera', kind: 'hold', ctx: GC },
  { id: 'cam.zoomOut', name: 'Oddal', cat: 'kamera', kind: 'hold', ctx: GC },
  { id: 'cam.next', name: 'Kamera (Shift — poprzednia)', cat: 'kamera', kind: 'edge', ctx: G },
  { id: 'cam.reset', name: 'Kamera domyślna', cat: 'kamera', kind: 'edge', ctx: G },
  { id: 'cam.orbitLeft', name: 'Kamera 3D: w lewo', cat: 'kamera', kind: 'hold', ctx: G },
  { id: 'cam.orbitRight', name: 'Kamera 3D: w prawo', cat: 'kamera', kind: 'hold', ctx: G },
  { id: 'cam.orbitUp', name: 'Kamera 3D: w górę', cat: 'kamera', kind: 'hold', ctx: G },
  { id: 'cam.orbitDown', name: 'Kamera 3D: w dół', cat: 'kamera', kind: 'hold', ctx: G },
  { id: 'cam.panUp', name: 'Flota: kamera w górę', cat: 'kamera', kind: 'hold', ctx: ['rts'] },
  { id: 'cam.panDown', name: 'Flota: kamera w dół', cat: 'kamera', kind: 'hold', ctx: ['rts'] },
  { id: 'cam.panLeft', name: 'Flota: kamera w lewo', cat: 'kamera', kind: 'hold', ctx: ['rts'] },
  { id: 'cam.panRight', name: 'Flota: kamera w prawo', cat: 'kamera', kind: 'hold', ctx: ['rts'] },
  // --- interfejs ---
  { id: 'ui.cic', name: 'Mapa CIC', cat: 'interfejs', kind: 'edge', ctx: GC },
  { id: 'ui.cicMap', name: 'Mapa CIC (dawna mapa sektora)', cat: 'interfejs', kind: 'edge', ctx: GC, shares: 'ui.cic' },
  { id: 'cic.pan', name: 'CIC: przesuw mapy', cat: 'interfejs', kind: 'hold', ctx: ['cic'] },
  { id: 'cic.systemView', name: 'CIC: widok systemu / taktyczny', cat: 'interfejs', kind: 'edge', ctx: ['cic'] },
  { id: 'ui.journal', name: 'Dziennik misji', cat: 'interfejs', kind: 'edge', ctx: G },
  { id: 'ui.pause', name: 'Pauza', cat: 'interfejs', kind: 'edge', ctx: ['game', 'pause'] },
  { id: 'ui.menu', name: 'Menu', cat: 'interfejs', kind: 'edge', ctx: ['game', 'cic', 'pause', 'story', 'menu'] },
  { id: 'ui.perf', name: 'Panel wydajności', cat: 'interfejs', kind: 'edge', ctx: G },
  { id: 'station.close', name: 'Zamknij panel stacji', cat: 'interfejs', kind: 'edge', ctx: ['station'] },
  // --- menu (DOM) ---
  { id: 'ui.up', name: 'Menu: poprzednia pozycja', cat: 'menu', kind: 'edge', ctx: ['menu'] },
  { id: 'ui.down', name: 'Menu: następna pozycja', cat: 'menu', kind: 'edge', ctx: ['menu'] },
  { id: 'ui.confirm', name: 'Menu: wybierz', cat: 'menu', kind: 'edge', ctx: ['menu'] },
  { id: 'ui.back', name: 'Menu: wstecz', cat: 'menu', kind: 'edge', ctx: ['menu'] },
  // --- fabuła ---
  { id: 'story.confirm', name: 'Fabuła: dalej / zamknij podsumowanie', cat: 'fabula', kind: 'edge', ctx: ['story'] },
  { id: 'story.action', name: 'Fabuła: przycisk panelu (ODDOKUJ)', cat: 'fabula', kind: 'edge', ctx: ['story', 'game'], shares: 'story.confirm' },
  { id: 'story.skip', name: 'Fabuła: pomiń scenę (przytrzymaj)', cat: 'fabula', kind: 'edge', ctx: ['story'] },
  // --- podzielony ekran ---
  { id: 'split.assign', name: 'Przypisz urządzenie', cat: 'podzielony', kind: 'edge', ctx: ['split'] },
  // wybór statku — inna nakładka niż przypisanie urządzeń (te same klawisze, rozłączne stany: `shares`)
  { id: 'split.prev', name: 'Poprzedni statek', cat: 'podzielony', kind: 'edge', ctx: ['split'], shares: 'split.assign' },
  { id: 'split.next', name: 'Następny statek', cat: 'podzielony', kind: 'edge', ctx: ['split'], shares: 'split.assign' },
  { id: 'split.ready', name: 'Gotowy', cat: 'podzielony', kind: 'edge', ctx: ['split'], shares: 'split.assign' },
  { id: 'split.unready', name: 'Cofnij gotowość', cat: 'podzielony', kind: 'edge', ctx: ['split'], shares: 'split.ready' }
]);

export const ACTION_BY_ID = Object.freeze(Object.fromEntries(INPUT_ACTIONS.map((a) => [a.id, a])));

/** Klawiatura: id → kody (KeyboardEvent.code). Akcje obsługiwane przez inne słuchacze — w komentarzu obok. */
export const KEYBOARD_LAYOUT = Object.freeze({
  'fly.forward': ['KeyW'],
  'fly.back': ['KeyS'],
  'fly.left': ['KeyA'],
  'fly.right': ['KeyD'],
  'fly.strafeLeft': ['KeyQ'],
  'fly.strafeRight': ['KeyE'],
  'fly.thrust': ['KeyW', 'KeyS'],
  'fly.turn': ['KeyA', 'KeyD'],
  'fly.boost': ['ShiftLeft', 'ShiftRight'],
  'fly.gearDown': ['ControlLeft', 'ControlRight'],
  'fly.driveAuto': ['Digit7', 'Numpad7'],
  'fly.driveMode': ['KeyV'],
  'fly.damper': ['KeyC'],
  'fly.stabilizer': ['KeyB'],
  'nav.warp': ['CapsLock', 'Digit9', 'Numpad9'],
  'ship.ram': ['KeyF'],
  'wpn.rocketKey': ['KeyF'],
  'ship.cloak': ['KeyI'],
  'ship.lights': ['KeyL'],
  'ship.repair': ['KeyR'],
  'ship.engines': ['Digit0', 'Numpad0'],
  'mode.mining': ['KeyN'],
  'mode.torpedo': ['Digit8', 'Numpad8'],
  'mode.fleet': ['KeyG'],
  'mining.tractor': ['KeyT'],
  'mining.charge': ['KeyL'],
  'mining.detonate': ['KeyF'],
  'wpn.fire': null,
  'wpn.group1': ['Digit1'],
  'wpn.group2': ['Digit2'],
  'wpn.group3': ['Digit3'],
  'wpn.lance': ['Digit4'],
  'wpn.special': ['Digit5'],
  'wpn.energy': ['Digit6', 'Numpad6'],
  'wpn.posture': ['KeyY'],
  'wpn.fighters': ['KeyZ'],
  'wpn.rocket': null,
  'wpn.specialFire': null,
  'tgt.priority': ['KeyT'],
  'tgt.paint': ['KeyT'],
  'tgt.queue': ['KeyU'],
  'tgt.scan': ['KeyX'],
  'tgt.drone': ['KeyH'],
  'aim.cursor': null,
  'cam.zoomIn': null,
  'cam.zoomOut': null,
  'cam.next': ['KeyK'],
  'cam.reset': ['Home'],
  'cam.orbitLeft': ['ArrowLeft'],
  'cam.orbitRight': ['ArrowRight'],
  'cam.orbitUp': ['ArrowUp'],
  'cam.orbitDown': ['ArrowDown'],
  'cam.panUp': ['KeyW', 'ArrowUp'],
  'cam.panDown': ['KeyS', 'ArrowDown'],
  'cam.panLeft': ['KeyA', 'ArrowLeft'],
  'cam.panRight': ['KeyD', 'ArrowRight'],
  'ui.cic': ['Tab'],
  'ui.cicMap': ['KeyM'],
  'cic.pan': ['KeyW', 'KeyA', 'KeyS', 'KeyD'],
  'cic.systemView': ['KeyV', 'Backquote'],
  'ui.journal': ['KeyJ'],
  'ui.pause': ['Space'],
  'ui.menu': ['Escape'],                 // słuchacz Esc (index.html), nie główny keydown
  'ui.perf': ['KeyP'],
  'station.close': ['Escape'],           // słuchacz panelu stacji
  'ui.up': ['ArrowUp', 'ArrowLeft'],     // nawigacja menu (słuchacz menu)
  'ui.down': ['ArrowDown', 'ArrowRight'],
  'ui.confirm': ['Enter', 'Space'],
  'ui.back': ['Escape', 'Backspace'],
  'story.confirm': ['Enter', 'Space'],   // nakładka fabuły (src/ui/storyOverlay.js, faza capture)
  'story.action': ['Enter'],
  'story.skip': ['Escape'],
  'split.assign': ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Enter', 'Space'],
  'split.prev': ['ArrowLeft', 'KeyA'],
  'split.next': ['ArrowRight', 'KeyD'],
  'split.ready': ['Enter', 'Space'],
  'split.unready': ['Escape', 'Backspace']
});

/** Mysz: id → etykieta. */
export const MOUSE_LAYOUT = Object.freeze({
  'wpn.fire': 'LPM',
  'aim.cursor': 'Mysz',
  'cam.zoomIn': 'Kółko ↑',
  'cam.zoomOut': 'Kółko ↓'
});

/** Pad gracza 1 — etap 1: dzisiejszy zakres akcji na nowej warstwie (bez martwego A, bez celowania RS do ship.input). */
export const PAD_LAYOUT = Object.freeze({
  'fly.forward': { axis: 1, dir: -1 },
  'fly.back': { axis: 1, dir: 1 },
  'fly.left': { axis: 0, dir: -1 },
  'fly.right': { axis: 0, dir: 1 },
  // krzywe osi (docs/PLAN-pad.md § 3.3): ciąg łagodnie, obrót mocniej — precyzja przy małym wychyleniu
  'fly.thrust': { axis: 1, invert: true, curve: 1.2 },
  'fly.turn': { axis: 0, curve: 1.6 },
  'fly.strafeLeft': null,
  'fly.strafeRight': null,
  'fly.boost': { button: PB.X },
  'fly.gearDown': null,
  'fly.driveAuto': null,
  'fly.driveMode': null,
  'fly.damper': null,
  'fly.stabilizer': null,
  'nav.warp': { button: PB.Y },
  'ship.ram': null,
  'wpn.rocketKey': null,
  'ship.cloak': null,
  'ship.lights': null,
  'ship.repair': null,
  'ship.engines': null,
  'mode.mining': null,
  'mode.torpedo': null,
  'mode.fleet': null,
  'mining.tractor': null,
  'mining.charge': null,
  'mining.detonate': null,
  'wpn.fire': { button: PB.RT },
  'wpn.group1': null,
  'wpn.group2': null,
  'wpn.group3': null,
  'wpn.lance': null,
  'wpn.special': null,
  'wpn.energy': null,
  'wpn.posture': null,
  'wpn.fighters': null,
  'wpn.rocket': { button: PB.B },
  'wpn.specialFire': { button: PB.LT },
  'tgt.priority': null,
  'tgt.paint': null,
  'tgt.queue': null,
  'tgt.scan': null,
  'tgt.drone': null,
  'aim.cursor': { stick: 'right' },
  'cam.zoomIn': { button: PB.RB },
  'cam.zoomOut': { button: PB.LB },
  'cam.next': null,
  'cam.reset': null,
  'cam.orbitLeft': null,
  'cam.orbitRight': null,
  'cam.orbitUp': null,
  'cam.orbitDown': null,
  'cam.panUp': null,
  'cam.panDown': null,
  'cam.panLeft': null,
  'cam.panRight': null,
  'ui.cic': { button: PB.VIEW },
  'ui.cicMap': null,
  'cic.pan': null,
  'cic.systemView': null,
  'ui.journal': null,
  'ui.pause': null,
  'ui.menu': { button: PB.MENU },
  'ui.perf': null,
  'station.close': { button: PB.B },
  'ui.up': [{ button: PB.UP }, { button: PB.LEFT }, { axis: 1, dir: -1, edge: 0.5 }],
  'ui.down': [{ button: PB.DOWN }, { button: PB.RIGHT }, { axis: 1, dir: 1, edge: 0.5 }],
  'ui.confirm': { button: PB.A },
  'ui.back': { button: PB.B },
  'story.confirm': { button: PB.A },
  'story.action': { button: PB.A },
  'story.skip': { button: PB.B, holdMs: 600 },
  'split.assign': [{ button: PB.LEFT }, { button: PB.RIGHT }, { button: PB.A }, { axis: 0, dir: -1, edge: 0.5 }, { axis: 0, dir: 1, edge: 0.5 }],
  'split.prev': [{ button: PB.LEFT }, { button: PB.LB }, { axis: 0, dir: -1, edge: 0.5 }],
  'split.next': [{ button: PB.RIGHT }, { button: PB.RB }, { axis: 0, dir: 1, edge: 0.5 }],
  'split.ready': { button: PB.A },
  'split.unready': { button: PB.B }
});

/** Pad gracza 2 (podzielony ekran) — jak dziś: A / RT ogień, B rakiety, LT broń specjalna. Etap 8 go zastąpi. */
export const PAD_LAYOUT_P2 = Object.freeze({
  ...PAD_LAYOUT,
  'wpn.fire': [{ button: PB.RT }, { button: PB.A }],
  'ui.cic': null,
  'story.confirm': null,
  'story.action': null
});

/**
 * Główny keydown gry (index.html): kolejność akcji jak w dawnym kodzie. Dla klawisza klej wykonuje kolejno akcje
 * z tej listy, których KEYBOARD_LAYOUT zawiera e.code (bramka → run; run może przerwać łańcuch).
 */
export const KEYDOWN_ORDER = Object.freeze([
  'ship.cloak', 'mode.mining', 'mining.tractor', 'mining.charge', 'mining.detonate', 'mode.torpedo',
  'fly.boost', 'fly.gearDown', 'cam.next', 'cam.reset', 'nav.warp', 'fly.driveAuto', 'ui.perf',
  'wpn.group1', 'wpn.group2', 'wpn.group3', 'tgt.priority', 'tgt.queue', 'wpn.posture', 'wpn.special',
  'wpn.lance', 'wpn.energy', 'ui.cicMap', 'ui.journal', 'mode.fleet', 'fly.damper', 'ship.lights',
  'fly.stabilizer', 'ui.pause', 'tgt.scan', 'ui.cic', 'cic.pan', 'ship.ram', 'wpn.rocketKey', 'tgt.drone',
  'cic.systemView', 'wpn.fighters', 'ship.repair', 'fly.driveMode', 'ship.engines'
]);

/** Kod klawisza → akcje głównego keydown (w kolejności KEYDOWN_ORDER). */
export function buildKeydownMap(order = KEYDOWN_ORDER, layout = KEYBOARD_LAYOUT) {
  const map = new Map();
  for (const id of order) {
    for (const code of layout[id] || []) {
      let list = map.get(code);
      if (!list) map.set(code, (list = []));
      list.push(id);
    }
  }
  return map;
}

/** Osie klawiatury: oś → [akcja ujemna, akcja dodatnia] (obie wciśnięte = 0, jak dawne W/S, A/D). */
export const KEY_AXES = Object.freeze({
  'fly.thrust': ['fly.back', 'fly.forward'],
  'fly.turn': ['fly.left', 'fly.right'],
  'fly.strafe': ['fly.strafeLeft', 'fly.strafeRight']
});

// ------------------------------------------------------------------ etykiety

const KEY_NAMES = Object.freeze({
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'AltGr',
  CapsLock: 'Caps Lock', Space: 'Spacja', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace',
  Home: 'Home', End: 'End', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→'
});

/** Etykieta klawisza z KeyboardEvent.code (podpowiedzi — etap 5). */
export function keyLabel(code) {
  if (!code) return '';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

const PAD_NAMES = Object.freeze({
  [PAD_FAMILY.XBOX]: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Xbox'],
  [PAD_FAMILY.PLAYSTATION]: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'PS'],
  // Nintendo: inne położenie A/B i X/Y (mapowanie standard podaje pozycję — dolny przycisk to „B”)
  [PAD_FAMILY.NINTENDO]: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'],
  [PAD_FAMILY.GENERIC]: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home']
});

/** Etykieta przycisku pada wg rodziny (padDevice: PAD_FAMILY). */
export function padButtonLabel(b, family = PAD_FAMILY.XBOX) {
  const names = PAD_NAMES[family] || PAD_NAMES[PAD_FAMILY.GENERIC];
  return names[b] || `#${b}`;
}

/** Etykieta jednego wiązania pada (przycisk, połowa osi, oś, gałka). */
export function padBindingLabel(bnd, family = PAD_FAMILY.XBOX) {
  if (!bnd) return '';
  if (Array.isArray(bnd)) return bnd.map((x) => padBindingLabel(x, family)).filter(Boolean).join(' / ');
  if (typeof bnd.button === 'number') {
    const base = padButtonLabel(bnd.button, family);
    return bnd.holdMs ? `${base} (przytrzymaj)` : base;
  }
  if (bnd.stick) return bnd.stick === 'right' ? (family === PAD_FAMILY.PLAYSTATION ? 'R' : 'RS') : (family === PAD_FAMILY.PLAYSTATION ? 'L' : 'LS');
  if (typeof bnd.axis === 'number') {
    const stick = bnd.axis < 2 ? 'LS' : 'RS';
    const vertical = (bnd.axis & 1) === 1;
    if (bnd.dir) return `${stick} ${vertical ? (bnd.dir < 0 ? '↑' : '↓') : (bnd.dir < 0 ? '←' : '→')}`;
    return `${stick} ${vertical ? '↕' : '↔'}`;
  }
  return '';
}

/** Etykiety akcji: { keys, mouse, pad } (puste — brak wiązania). */
export function actionLabels(id, family = PAD_FAMILY.XBOX, padLayout = PAD_LAYOUT) {
  const codes = KEYBOARD_LAYOUT[id] || [];
  const keys = [];
  for (const c of codes) {
    const l = keyLabel(c);
    if (l && !keys.includes(l)) keys.push(l);
  }
  return {
    keys: keys.join(' / '),
    mouse: MOUSE_LAYOUT[id] || '',
    pad: padBindingLabel(padLayout[id], family)
  };
}

/** Lista wiązań pada akcji (zawsze tablica, bez null). */
export function padBindings(layout, id) {
  const b = layout[id];
  if (!b) return [];
  return Array.isArray(b) ? b : [b];
}
