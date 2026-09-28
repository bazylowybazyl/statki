// Szyna strzałów — zamiast `new CustomEvent('game_weapon_fired', { detail })`
// na KAŻDY strzał (tysiące na sekundę w bitwie: zdarzenie DOM + obiekt detail).
//
// Kontrakt:
// - `emit(...)` wpisuje pola do JEDNEGO obiektu `detail` wielokrotnego użytku
//   i woła słuchaczy synchronicznie, w kolejności rejestracji.
// - Słuchacz NIE może zatrzymać `detail` (ani `detail.beam`) po powrocie —
//   następny strzał nadpisze pola. Jeśli musi coś zapamiętać, kopiuje wartości.
// - Strzał wystrzelony z wnętrza słuchacza (zagnieżdżenie) dostaje własny obiekt
//   z małej puli per głębokość, więc nie psuje detail strzału zewnętrznego.
// - `on`/`off` są rzadkie i robią kopię listy, więc słuchacz może się wypisać
//   w trakcie emisji bez gubienia pozostałych.
//
// Kto nadaje: fireWeaponCore (index.html) — wszystkie strzały z rdzenia broni.
// `CustomEvent('game_weapon_fired')` zostaje WYŁĄCZNIE dla superbroni
// (src/game/superweapon.js, rzadki strzał — słucha go audio); efekty broni
// (src/3d/weapons/weaponFx.js) słuchają szyny, a Hexlance woła je wprost.
//
// `dirX, dirY` (zadanie 17, na końcu — wywołania bez nich dają 0): kierunek lufy
// w chwili strzału. Efekt bierze wylot i kąt z wieżyczki (Turret2D), a gdy
// strzelec jej nie ma (myśliwiec), z tych pól.

function createDetail() {
  return { weaponId: null, shooter: null, x: 0, y: 0, isBeam: false, beamMode: null, beam: null, dirX: 0, dirY: 0 };
}

const detailsByDepth = [createDetail()];
let listeners = [];
let depth = 0;

export function on(fn) {
  if (typeof fn !== 'function' || listeners.includes(fn)) return fn;
  listeners = listeners.concat(fn);
  return fn;
}

export function off(fn) {
  const idx = listeners.indexOf(fn);
  if (idx < 0) return false;
  const next = listeners.slice();
  next.splice(idx, 1);
  listeners = next;
  return true;
}

export function listenerCount() {
  return listeners.length;
}

export function emit(weaponId, shooter, x, y, isBeam = false, beamMode = null, beam = null, dirX = 0, dirY = 0) {
  const list = listeners;
  if (list.length === 0) return null;
  let detail = detailsByDepth[depth];
  if (!detail) detail = detailsByDepth[depth] = createDetail();
  detail.weaponId = weaponId;
  detail.shooter = shooter;
  detail.x = x;
  detail.y = y;
  detail.isBeam = isBeam === true;
  detail.beamMode = beamMode;
  detail.beam = beam;
  detail.dirX = Number.isFinite(dirX) ? dirX : 0;
  detail.dirY = Number.isFinite(dirY) ? dirY : 0;
  depth++;
  try {
    for (let i = 0; i < list.length; i++) list[i](detail);
  } finally {
    depth--;
    // Nie trzymamy strzelca ani danych wiązki do następnego strzału.
    detail.shooter = null;
    detail.beam = null;
  }
  return detail;
}

export const WeaponShotBus = { on, off, emit, listenerCount };

if (typeof window !== 'undefined') window.WeaponShotBus = WeaponShotBus;
