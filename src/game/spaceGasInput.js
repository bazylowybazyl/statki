// src/game/spaceGasInput.js
//
// GAZ W OTWARTEJ PRZESTRZENI — strona GRY (port dema dema/gazy-transport-webgpu.html, docs/PLAN-gazy-kosmos.md GK-2,
// scena pasa GK-5). Gra co klatkę pakuje WEJŚCIE (Float64Array o układzie SPACE_GAS_IN) i oddaje je renderowi
// (src/3d/spaceGas/spaceGas.js — tryb off: wprost, worker: blok migawki `spaceGas`). Czysty moduł: bez three, DOM
// i `window`; pole pasa podaje wołający (świat pasa gry — `beltWorld.field`).
//
// Zawartość:
//   • KOTWICA sceny (pas — Słońce) w double: wszystko inne względem niej — render liczy pole w małych liczbach;
//   • ZEGAR GRY (SimClock.sim / .render i NUMER kroku fizyki — liczba całkowita z index.html `physicsTickId` + PHYS_HZ):
//     krok pola = krok fizyki (z licznika, nie z sumy SimClock.sim — ta dryfuje), obraz w chwili renderu kadłubów
//     (render liczy przyrosty od ostatniej narysowanej strony — pominięte strony workera nie gubią czasu);
//   • OKNO POLA (N komórek — preset grafiki) i kadr. Środek okna (`placeGasWindow`, 2026-10-29 — „przy oddaleniu nie
//     widać wypychania, ogon szybko znika”): przy prowadzonym okręcie, przesunięty pod ślad, przycięty tak, że okno
//     większe od kadru trzyma swój miękki brzeg poza mapą kadru, a mniejsze leży w kadrze; bez okrętu — kamera BEZ
//     wstrząsu (wstrząs i kop przesuwały okno o ±1 komórkę tam i z powrotem). Dawniej środek = kamera, która wyprzedza
//     statek o stałe piksele — przy oddaleniu statek dojeżdżał do tylnej krawędzi okna (zoom 0,15: ślad ~2 km) i z niego
//     wypadał (≤ 0,107);
//   • OBWIEDNIA gazu pasa: siatka G × G obejmująca okno (z zapasem na dopływ przez brzeg) i prostokąt mapy obrazu
//     (pole dalekie poza oknem — przy oddaleniu mapa sięgała poza siatkę i czytała jej rozmazany brzeg) z
//     `field.sampleMacro` — ten sam wzór co płaty mgły pasa (src/3d/asteroids/fog.js), więc gaz leży tam, gdzie mgła,
//     i rzednie w wyrwach (E3: `hole`, a źródła gazu pola — `gas` — dochodzą same, gdy pole je poda); krok = krok okna
//     × 2^k (k z histerezą — pełne próbkowanie ~1 ms tylko na progu), siatka zakotwiczona w świecie, przy ruchu
//     przesuwana — próbkowane tylko nowe wiersze / kolumny (próbka pola ~1–6 µs);
//   • ODGAZOWANIE lodowych skał pola (prośba użytkownika 2026-10-22: „niektóre asteroidy produkują gazy”): skały gry
//     z lodem w oknie, struga od Słońca z wylotu po stronie dziennej, każda z własną fazą wydajności.
// Rozgrywka (D7, później): ta sama obwiednia × szum na CPU (spaceGasNoise.js — lustra) — bez odczytu z GPU.

import {
  SPACE_GAS_SCENE, SPACE_GAS_ENV_RES, SPACE_GAS_MAX_JETS, SPACE_GAS_MAX_BLASTS, SPACE_GAS_MAX_BOLTS, SPACE_GAS_RASTER, SPACE_GAS_IN,
  SPACE_GAS_MAP_MARGIN, SPACE_GAS_WINDOW_EDGE, SPACE_GAS_HZ, spaceGasViewHalf
} from '../3d/spaceGas/spaceGasLayout.js';

export { SPACE_GAS_SCENE, SPACE_GAS_ENV_RES, SPACE_GAS_MAX_JETS, SPACE_GAS_MAX_BLASTS, SPACE_GAS_MAX_BOLTS, SPACE_GAS_RASTER, SPACE_GAS_IN };
const RS = SPACE_GAS_RASTER;

const G = SPACE_GAS_ENV_RES;
const JET = SPACE_GAS_IN.jetStride;

/** Strojenie wejścia (konsola: window.SpaceGasInputTune w ?dev). */
export const SPACE_GAS_INPUT_TUNE = {
  enabled: true,
  envMargin: 1.3,     // siatka obwiedni = okno × margines (dopływ przez brzeg)
  minEnv: 0.004,      // obwiednia poniżej — gazu nie ma (krok nie liczy)
  // dalej (oddalenie; pół kadru z spaceGasViewHalf — jak zanik w renderze) gaz się nie liczy; ≥ końca zaniku obrazu
  // (SPACE_GAS_TUNE.fadeView 80 tys.), więc obraz znika, zanim gra wyłączy gaz (strażnik w teście)
  maxViewHalf: 90000,
  wind: 30,           // wiatr wzdłuż orbity [j/s] (pas: w kierunku ruchu orbitalnego, prostopadle do Słońca)
  windOut: -8,        // składowa od Słońca [j/s] (odgazowanie płynie na zewnątrz)
  jets: true,
  jetMinR: 140,       // najmniejsza skała odgazowująca [j.]
  jetSearch: 0.5,     // skały w oknie × ułamek (środek okna) — struga daleko poza kadrem nic nie da
  bolts: true,        // pociski wloką gaz (A/B)
  // okno pola (placeGasWindow): A/B followShip = false — środek przy kamerze bez wstrząsu (dawniej: kamera ze wstrząsem)
  followShip: true,
  wakeFrac: 0.5,      // przesunięcie pod ślad: najwyżej ułamek pół okna …
  wakeSec: 8,         // … i nie dalej niż droga z prędkości okrętu × s
  wakeTauUp: 1.0,     // [s] narastanie przesunięcia (rozpęd, skręt)
  wakeTauDown: 6.0,   // [s] zanik (hamowanie, postój — ślad zostaje w oknie)
  // siatka obwiedni (A/B envCover = false — dawna siatka okna: przy oddaleniu pole dalekie mapy poza nią rozmazane)
  envCover: true,
  envWindow: 1.15,    // okno × zapas (dopływ przez brzeg czyta obwiednię tuż za oknem)
  mapCover: 1.25,     // prostokąt mapy obrazu: kadr × zapas mapy (1,08) × drabina teksla (do 1,12) z nadmiarem
  envShrink: 0.95     // histereza kroku siatki (mniejszy krok dopiero przy rozpiętości < 0,95 jego zasięgu; domyślny kadr
                      // potrzebuje ~0,92 zasięgu kroku okna — mocniejsza histereza zostawiała krok × 2 po powrocie z oddalenia)
};

/**
 * Środek okna pola (świat gry względem kotwicy) — ZAPIS w `out` (x, y, lead). `f` — prowadzony okręt względem kotwicy
 * (on, x, y, vx, vy [j/s]) albo null; cam — kamera BEZ wstrząsu; halfW / halfH — pół kadru [j.]; halfWin — pół okna;
 * dt — czas gry klatki (sprężyna przesunięcia; 0 — pauza trzyma); cell — bok komórki pola (okno stoi na siatce komórek:
 * render kładzie je do komórki w −x / −y — zapas brzegu). Okręt w kadrze: cel = okręt − v̂ · min(ułamek pół okna, |v| · s)
 * (wygładzone: narasta w `wakeTauUp`, gaśnie w `wakeTauDown`); środek = kamera + (cel − kamera) przycięte na oś do luzu
 * max(0, pół okna − brzeg − pół mapy, pół mapy − pół okna), brzeg = SPACE_GAS_WINDOW_EDGE boku okna (pas, w którym obraz
 * przechodzi w pole dalekie, a pył gaśnie) + komórka + droga okrętu w dwóch krokach pola (2 · |v| / 60: render przesuwa
 * okno tylko w kroku pola, a obraz przenika poprzedni krok — w hipercruisie Mk III to ~1 km za kadrem):
 *   • wnętrze okna (bez brzegu) większe od mapy kadru (pół kadru × 1,08) — okno schodzi pod ślad najwyżej o nadmiar,
 *     brzeg zostaje POZA mapą (dawniej luz |pół okna − pół mapy| kładł czoło okna na brzegu mapy: pas brzegu wchodził
 *     w kadr od strony lotu — 55–383 j. przy zoomie 0,34–0,77 na 5120 × 1440, właśnie przy zbliżeniu);
 *   • okno w granicach brzegu wokół mapy — przy kamerze (domyślny kadr 5120 × 1440: jak przed oknem przy okręcie);
 *   • okno mniejsze od mapy — leży w mapie (oddalenie: okręt i ślad za nim w oknie, brzeg z założenia w kadrze).
 * Ciągłe (luz 0 na obu progach). Skok okrętu dalej niż pół okna między klatkami z okrętem — także po przerwie bez niego
 * (kamera fabuły przy zamrożonym świecie, RTS) — (teleport, przesiadka, zmiana kotwicy) zeruje przesunięcie pod ślad
 * (wskazywało kierunek lotu sprzed skoku). AGENT: próg jest bezwzględny — przy mniejszych oknach z presetu (GK-8, 128
 * komórek) porównuj z drogą v · dt, inaczej przestój klatki w hipercruisie wyzeruje przesunięcie.
 */
export function placeGasWindow(st, f, camX, camY, halfW, halfH, halfWin, dt, out = {}, cell = 0) {
  const T = SPACE_GAS_INPUT_TUNE;
  let bx = 0, by = 0;
  const on = !!(f && f.on);
  if (on && Number.isFinite(st.lastX)) {
    const jx = f.x - st.lastX, jy = f.y - st.lastY;
    if (jx * jx + jy * jy > halfWin * halfWin) { st.wakeX = 0; st.wakeY = 0; }
  }
  if (on) { st.lastX = f.x; st.lastY = f.y; }
  const lead = !!(T.followShip && on && Math.abs(f.x - camX) < halfW && Math.abs(f.y - camY) < halfH);
  let v = 0;
  if (lead) {
    v = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
    if (v > 1) {
      const b = Math.min(T.wakeFrac * halfWin, v * T.wakeSec) / v;
      bx = -f.vx * b; by = -f.vy * b;
    }
  }
  if (dt > 0) {
    const grow = bx * bx + by * by >= st.wakeX * st.wakeX + st.wakeY * st.wakeY;
    const k = 1 - Math.exp(-dt / Math.max(1e-3, grow ? T.wakeTauUp : T.wakeTauDown));
    st.wakeX += (bx - st.wakeX) * k;
    st.wakeY += (by - st.wakeY) * k;
  }
  const tx = lead ? f.x + st.wakeX : camX, ty = lead ? f.y + st.wakeY : camY;
  const edge = 2 * halfWin * SPACE_GAS_WINDOW_EDGE + (cell > 0 ? cell : 0) + 2 * v / SPACE_GAS_HZ;
  const mx = halfW * SPACE_GAS_MAP_MARGIN, my = halfH * SPACE_GAS_MAP_MARGIN;
  const sx = Math.max(0, halfWin - edge - mx, mx - halfWin), sy = Math.max(0, halfWin - edge - my, my - halfWin);
  out.x = camX + Math.max(-sx, Math.min(sx, tx - camX));
  out.y = camY + Math.max(-sy, Math.min(sy, ty - camY));
  out.lead = lead;
  return out;
}

/** Przesunięcie okna pod ślad od zera (gaz wyłączony: skok warpa, opcja, oddalenie, poza obszarem gazu). */
export function resetGasWindowWake(st) {
  st.wakeX = 0; st.wakeY = 0;
  st.lastX = NaN; st.lastY = NaN;
}

// Typy skał z lodem (asteroidRockKinds.js — nazwy; indeksy podaje wołający przez `iceTypes`).
export const SPACE_GAS_ICY_TYPES = Object.freeze(['ice', 'carbon_ice', 'primitive']);

/** Stan pakowania (siatka obwiedni — dwa bufory na zmianę, wersja, strugi). */
export function createSpaceGasInputState() {
  return {
    env: new Float32Array(G * G * 2),
    envB: new Float32Array(G * G * 2),
    ix0: NaN, iy0: NaN, cell: 0, holeVer: -1, ver: 0, anchorX: NaN, anchorY: NaN, scene: 0, max: 0,
    envK: 0,      // krok siatki = krok okna × 2^envK (siatka obejmuje mapę obrazu przy oddaleniu)
    samples: 0,   // próbek pola w ostatniej klatce (koszt CPU)
    jetSeen: 0,
    // okno pola: przesunięcie pod ślad (sprężyna, świat gry [j.]), okręt z poprzedniej klatki (skok → przesunięcie od
    // zera), ostatni środek (względem kotwicy), okręt prowadzony
    wakeX: 0, wakeY: 0, lastX: NaN, lastY: NaN,
    win: { x: 0, y: 0, lead: false },
    focus: { on: false, x: 0, y: 0, vx: 0, vy: 0 },
    // wybuchy w polu: x, y (świat gry), rozmiar, wiek, życie; `blastSeen` — ile wybuchów z pierścienia gry już przyjęto
    blasts: new Float64Array(SPACE_GAS_MAX_BLASTS * 5),
    nBlasts: 0,
    blastSeen: -1,
    // raster przekroju olbrzymów (z = 0): bajt na teksel, róg na siatce tekseli względem kotwicy
    raster: new Uint8Array(RS * RS),
    rasterB: new Uint8Array(RS * RS),
    rx0: NaN, ry0: NaN, rTexel: 0, rReady: -1, rVer: 0, rOn: 0,
    rasterSamples: 0
  };
}

function sampleEnv(field, wx, wy, out, o) {
  const m = field.sampleMacro(wx, wy);
  const w = m.weight > 0 ? m.weight : 0;
  // płaty mgły pasa (fog.js) × wyrwy (E3: `hole`) + źródła gazu pola (`gas`) — pola mogą jeszcze nie istnieć
  const hole = m.hole === undefined ? 1 : m.hole;
  const gas = m.gas > 0 ? m.gas : 0;
  out[o] = w * (0.22 + 0.78 * Math.min(1, m.cluster * 1.15)) * hole + gas;
  out[o + 1] = m.ice || 0;
}

/**
 * Pakuje wejście klatki.
 * @param {Float64Array} out SPACE_GAS_IN.size
 * @param {object} st createSpaceGasInputState()
 * @param {object} o dt, camX, camY (kamera klatki — ze wstrząsem), camNsX / camNsY (bez wstrząsu; brak — camX / camY),
 *   halfW, halfH (pół kadru [j.]), simTime / renderTime (SimClock.sim / .render; brak — NaN: render liczy z dt),
 *   physTick / physHz (numer kroku fizyki — liczba całkowita, index.html `physicsTickId` — i PHYS_HZ: krok pola; brak
 *   numeru — NaN: render liczy kroki akumulatorem),
 *   focusOn, focusX, focusY, focusVX, focusVY (prowadzony okręt — świat gry, j/s; okno pola przy nim), field (pole pasa
 *   gry: sampleMacro, rectTouchesBelt, holeVersion, forEachRockInRect), sunX, sunY (Słońce — kotwica), windowCells,
 *   cell, iceTypes (zbiór indeksów typów skał z lodem), time (zegar wydajności strug), enabled, blasts (wybuchy gry —
 *   src/game/explosionEvents.js: `recent`, `count`), bullets (pociski gry: x, y, vx, vy), giants (olbrzymy pasa —
 *   beltWorld.giants: entries z `giant.ready`, `sampleWorld`, `halfX / halfY`)
 */
export function packSpaceGasFrame(out, st, o) {
  const I = SPACE_GAS_IN;
  const T = SPACE_GAS_INPUT_TUNE;
  out[I.serial] = (out[I.serial] + 1) % 1e9;
  out[I.dt] = o.dt > 0 ? o.dt : 0;
  // zegar gry (nagłówek — idzie do renderu także bez gazu w kadrze): czasy SimClock i numer kroku fizyki
  out[I.simTime] = Number.isFinite(o.simTime) ? o.simTime : NaN;
  out[I.renderTime] = Number.isFinite(o.renderTime) ? o.renderTime : NaN;
  out[I.physTick] = Number.isFinite(o.physTick) ? o.physTick : NaN;
  out[I.physHz] = o.physHz > 0 ? o.physHz : 60;
  out[I.jets] = 0;
  st.samples = 0;
  const field = o.field;
  const cells = o.windowCells | 0 || 256;
  const cell = o.cell || 64;
  const halfWin = cells * cell * 0.5;
  const viewHalf = Math.max(o.halfW || 0, o.halfH || 0);
  // oddalenie: pół kadru jak do zaniku obrazu w renderze (spaceGasViewHalf — 32:9 jak 16:9 tej samej wysokości), więc
  // obraz gaśnie do zera, zanim gra wyłączy gaz (dawniej max(pół szer., pół wys.) — na 32:9 cięcie z zaniku ~0,875)
  let on = !!(T.enabled && o.enabled !== false && field && spaceGasViewHalf(o.halfW || 0, o.halfH || 0) < T.maxViewHalf);
  if (on) {
    const r = Math.max(halfWin, viewHalf) * T.envMargin;
    on = field.rectTouchesBelt(o.camX - r, o.camY - r, o.camX + r, o.camY + r);
  }
  // scena: pas (domyślnie) albo ring w budowie (o.scene + pole ringu — src/game/ringGasField.js)
  const scene = o.scene || SPACE_GAS_SCENE.belt;
  out[I.scene] = on ? scene : SPACE_GAS_SCENE.none;
  stepBlasts(st, o.blasts, out[I.dt]);
  out[I.blasts] = 0;
  out[I.bolts] = 0;
  out[I.rasterOn] = 0;
  // gaz wyłączony (skok warpa, opcja, oddalenie, poza obszarem) — przesunięcie okna pod ślad od zera: po skoku okno
  // stało do 4 km za okrętem w kierunku lotu sprzed skoku przez ~6 s (zanik sprężyny)
  if (!on) { resetGasWindowWake(st); out[I.active] = 0; return out; }

  // kotwica: pas — Słońce, ring — środek planety (o.anchorX / o.anchorY); zmiana sceny = nowa siatka obwiedni
  const ax = Number.isFinite(o.anchorX) ? o.anchorX : (o.sunX || 0);
  const ay = Number.isFinite(o.anchorY) ? o.anchorY : (o.sunY || 0);
  if (ax !== st.anchorX || ay !== st.anchorY || scene !== st.scene) { st.anchorX = ax; st.anchorY = ay; st.scene = scene; st.ix0 = NaN; }
  const cx = o.camX - ax, cy = o.camY - ay;
  out[I.anchorX] = ax; out[I.anchorY] = ay;
  out[I.camX] = cx; out[I.camY] = cy;
  out[I.halfW] = o.halfW; out[I.halfH] = o.halfH;
  out[I.windowCells] = cells;
  out[I.cell] = cell;
  // kierunek ku Słońcu z punktu kamery (pas: Słońce = kotwica); wiatr: wzdłuż orbity wokół kotwicy + od kotwicy
  // (pole może podać własny: ring — dryf wzdłuż obręczy)
  const rl = Math.sqrt(cx * cx + cy * cy) || 1;
  const kx = -cx / rl, ky = -cy / rl;
  const qx = (o.sunX || 0) - o.camX, qy = (o.sunY || 0) - o.camY;
  const ql = Math.sqrt(qx * qx + qy * qy) || 1;
  const sx = qx / ql, sy = qy / ql;
  out[I.sunX] = sx; out[I.sunY] = sy;
  const wind = Number.isFinite(field.wind) ? field.wind : T.wind;
  const windOut = Number.isFinite(field.windOut) ? field.windOut : T.windOut;
  out[I.windX] = -ky * wind - kx * windOut;
  out[I.windY] = kx * wind - ky * windOut;

  // okno pola: przy prowadzonym okręcie (pod śladem), przycięte do kadru; bez okrętu — kamera bez wstrząsu
  const cnx = (Number.isFinite(o.camNsX) ? o.camNsX : o.camX) - ax;
  const cny = (Number.isFinite(o.camNsY) ? o.camNsY : o.camY) - ay;
  const F = st.focus;
  F.on = !!o.focusOn;
  F.x = o.focusX - ax; F.y = o.focusY - ay;
  F.vx = Number(o.focusVX) || 0; F.vy = Number(o.focusVY) || 0;
  const win = placeGasWindow(st, F.on ? F : null, cnx, cny, o.halfW || 0, o.halfH || 0, halfWin, out[I.dt], st.win, cell);
  const wx = win.x, wy = win.y;
  out[I.winX] = wx; out[I.winY] = wy;

  // siatka obwiedni: zakotwiczona w świecie (względem kotwicy), przesuwana o całe próbki; obejmuje okno (dopływ przez
  // brzeg) i prostokąt mapy obrazu (pole dalekie poza oknem) — krok okna × 2^k
  const baseCell = Math.max(64, Math.ceil(halfWin * 2 * T.envMargin / (G - 1) / 64) * 64);
  let envCell = baseCell, gcx = wx, gcy = wy;
  if (T.envCover) {
    const ew = halfWin * T.envWindow, mw = (o.halfW || 0) * T.mapCover, mh = (o.halfH || 0) * T.mapCover;
    const ux0 = Math.min(wx - ew, cx - mw), ux1 = Math.max(wx + ew, cx + mw);
    const uy0 = Math.min(wy - ew, cy - mh), uy1 = Math.max(wy + ew, cy + mh);
    const span = Math.max(ux1 - ux0, uy1 - uy0);
    // zasięg pewny: G − 3 odstępów (środek siatki w całej próbce — floor zjada do jednej z każdej strony)
    const reach = G - 3;
    let k = st.envK | 0;
    while (k < 12 && baseCell * 2 ** k * reach < span) k++;
    while (k > 0 && baseCell * 2 ** (k - 1) * reach * T.envShrink > span) k--;
    st.envK = k;
    envCell = baseCell * 2 ** k;
    gcx = (ux0 + ux1) * 0.5; gcy = (uy0 + uy1) * 0.5;
  }
  const ix0 = Math.floor(gcx / envCell) - (G >> 1);
  const iy0 = Math.floor(gcy / envCell) - (G >> 1);
  const hv = field.holeVersion | 0;
  if (envCell !== st.cell || hv !== st.holeVer || !(ix0 === st.ix0 && iy0 === st.iy0)) {
    const full = envCell !== st.cell || hv !== st.holeVer || !Number.isFinite(st.ix0);
    const src = st.env, dst = st.envB;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const d = (j * G + i) * 2;
        const si = i + ix0 - st.ix0, sj = j + iy0 - st.iy0;
        if (!full && si >= 0 && si < G && sj >= 0 && sj < G) {
          const s = (sj * G + si) * 2;
          dst[d] = src[s]; dst[d + 1] = src[s + 1];
        } else {
          sampleEnv(field, ax + (ix0 + i + 0.5) * envCell, ay + (iy0 + j + 0.5) * envCell, dst, d);
          st.samples++;
        }
      }
    }
    st.env = dst; st.envB = src;
    st.ix0 = ix0; st.iy0 = iy0; st.cell = envCell; st.holeVer = hv;
    st.ver++;
    let mx = 0;
    for (let k = 0; k < G * G; k++) if (dst[k * 2] > mx) mx = dst[k * 2];
    st.max = mx;
  }
  out[I.envVer] = st.ver;
  out[I.envX0] = (st.ix0 + 0.5) * envCell;
  out[I.envY0] = (st.iy0 + 0.5) * envCell;
  out[I.envCell] = envCell;
  out[I.envMax] = st.max;
  out.set(st.env, I.envBase);
  const active = st.max > T.minEnv;
  out[I.active] = active ? 1 : 0;
  if (!active) return out;
  // wybuchy, odgazowanie, pociski i raster olbrzymów — wokół OKNA pola (świat gry: kotwica + środek okna)
  const owx = ax + wx, owy = ay + wy;
  packBlasts(out, st, ax, ay, owx, owy, halfWin + 2000);

  // odgazowanie lodowych skał gry w środku okna (od Słońca, wylot po stronie dziennej)
  if (T.jets && o.iceTypes && typeof field.forEachRockInRect === 'function') {
    const h = halfWin * T.jetSearch;
    let n = 0;
    const t = o.time || 0;
    const ventGain = Number.isFinite(field.ventGain) ? field.ventGain : 1;
    field.forEachRockInRect(0, owx - h, owy - h, owx + h, owy + h, T.jetMinR * 2, (rock) => {
      if (n >= SPACE_GAS_MAX_JETS || !o.iceTypes.has(rock.type)) return;
      const b = I.jetBase + n * JET;
      out[b] = rock.x - ax; out[b + 1] = rock.y - ay;
      // wylot: od Słońca (skały pasa) albo kierunek strugi pola (ring: od frontu budowy)
      if (Number.isFinite(rock.dx)) { out[b + 2] = rock.dx; out[b + 3] = rock.dy; } else { out[b + 2] = -sx; out[b + 3] = -sy; }
      out[b + 4] = rock.r;
      // wydajność: własna faza i tempo z ziarna skały (deterministyczne, bez losowań gry)
      const s = rock.seed || 0;
      out[b + 5] = (0.55 + 0.45 * Math.sin(t * (0.3 + (s * 0.173) % 0.4) + s * 17.0)) * ventGain;
      n++;
    });
    out[I.jets] = n;
    st.jetSeen = n;
  }
  packBolts(out, o.bullets, owx, owy, halfWin, ax, ay);
  packRaster(out, st, o.giants, ax, ay, wx, wy, cells * cell);
  return out;
}

// Wybuchy z pierścienia gry (src/game/explosionEvents.js — `recent`, `count`): przyjęte raz, potem starzone czasem gry;
// życie jak w demie (wybuch okrętu 1,2 s) × √(rozmiar / 280 — Atlas). Liczone także poza gazem (stary wybuch nie wraca
// przy wejściu w pas).
function stepBlasts(st, ev, dt) {
  const B = st.blasts;
  let n = st.nBlasts;
  for (let i = n - 1; i >= 0; i--) {
    const o = i * 5;
    B[o + 3] += dt;
    if (B[o + 3] > B[o + 4]) {
      const last = (n - 1) * 5;
      for (let k = 0; k < 5; k++) B[o + k] = B[last + k];
      n--;
    }
  }
  if (ev && ev.recent) {
    const cap = ev.recent.length / 3;
    if (st.blastSeen < 0) st.blastSeen = ev.count;   // pierwsza klatka: wcześniejsze wybuchy pomijamy
    const from = Math.max(st.blastSeen, ev.count - cap);
    for (let c = from; c < ev.count; c++) {
      const r = (c % cap) * 3;
      let o = n * 5;
      if (n >= SPACE_GAS_MAX_BLASTS) {
        // pełna lista — miejsce najstarszego
        let oldest = 0;
        for (let i = 1; i < n; i++) if (B[i * 5 + 3] > B[oldest * 5 + 3]) oldest = i;
        o = oldest * 5;
      } else n++;
      const size = ev.recent[r + 2] > 0 ? ev.recent[r + 2] : 300;
      B[o] = ev.recent[r]; B[o + 1] = ev.recent[r + 1]; B[o + 2] = size; B[o + 3] = 0;
      B[o + 4] = 1.2 * Math.sqrt(Math.min(4, Math.max(0.25, size / 280)));
    }
    st.blastSeen = ev.count;
  }
  st.nBlasts = n;
}

function packBlasts(out, st, ax, ay, camX, camY, reach) {
  const I = SPACE_GAS_IN, B = st.blasts;
  let n = 0;
  for (let i = 0; i < st.nBlasts; i++) {
    const s = i * 5;
    if (Math.abs(B[s] - camX) > reach || Math.abs(B[s + 1] - camY) > reach) continue;
    const o = I.blastBase + n * I.blastStride;
    out[o] = B[s] - ax; out[o + 1] = B[s + 1] - ay; out[o + 2] = B[s + 2]; out[o + 3] = B[s + 3]; out[o + 4] = B[s + 4];
    n++;
  }
  out[I.blasts] = n;
}

// Pociski gry (`bullets`: x, y, vx, vy) w oknie pola — za każdym gaz wleczony jak za strzałem dema.
function packBolts(out, bullets, camX, camY, half, ax, ay) {
  const I = SPACE_GAS_IN;
  let n = 0;
  if (bullets && SPACE_GAS_INPUT_TUNE.bolts) {
    for (let i = 0; i < bullets.length && n < SPACE_GAS_MAX_BOLTS; i++) {
      const b = bullets[i];
      if (!b || b.dead || Math.abs(b.x - camX) > half || Math.abs(b.y - camY) > half) continue;
      const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (!(v > 50)) continue;
      const o = I.boltBase + n * I.boltStride;
      out[o] = b.x - ax; out[o + 1] = b.y - ay; out[o + 2] = b.vx / v; out[o + 3] = b.vy / v; out[o + 4] = v;
      n++;
    }
  }
  out[I.bolts] = n;
}

// Raster przekroju olbrzymów pasa (z = 0) na okno pola: teksel = okno / 128, róg na siatce tekseli (przy ruchu kamery
// przesuwany — próbkowane tylko nowe teksle i tylko w pudłach gotowych olbrzymów); zmiana zestawu gotowych olbrzymów —
// od nowa. Komórki stałe pola gazu i zasłona strug (gaz nie przechodzi przez skałę).
function packRaster(out, st, giants, ax, ay, cx, cy, side) {
  const I = SPACE_GAS_IN;
  st.rasterSamples = 0;
  const list = giants && giants.entries;
  let ready = 0, touch = false;
  const texel = side / RS;
  const half = side * 0.5 + texel;
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.giant || !e.giant.ready) continue;
      ready++;
      if (Math.abs(e.x - ax - cx) < half + e.halfX && Math.abs(e.y - ay - cy) < half + e.halfY) touch = true;
    }
  }
  if (!touch) {
    if (st.rOn) { st.rOn = 0; st.rVer++; }
    st.rx0 = NaN;
    out[I.rasterOn] = 0;
    out[I.rasterVer] = st.rVer;
    return;
  }
  const rx = Math.floor(cx / texel) - (RS >> 1), ry = Math.floor(cy / texel) - (RS >> 1);
  if (rx !== st.rx0 || ry !== st.ry0 || texel !== st.rTexel || ready !== st.rReady) {
    const full = texel !== st.rTexel || ready !== st.rReady || !Number.isFinite(st.rx0);
    const src = st.raster, dst = st.rasterB;
    dst.fill(0);
    let any = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const g = e.giant;
      if (!g || !g.ready) continue;
      const band = (g.band || 0) + texel;
      const i0 = Math.max(0, Math.floor((e.x - ax - e.halfX - band) / texel) - rx);
      const i1 = Math.min(RS - 1, Math.floor((e.x - ax + e.halfX + band) / texel) - rx);
      const j0 = Math.max(0, Math.floor((e.y - ay - e.halfY - band) / texel) - ry);
      const j1 = Math.min(RS - 1, Math.floor((e.y - ay + e.halfY + band) / texel) - ry);
      for (let j = j0; j <= j1; j++) {
        for (let k = i0; k <= i1; k++) {
          const si = k + rx - st.rx0, sj = j + ry - st.ry0;
          let v;
          if (!full && si >= 0 && si < RS && sj >= 0 && sj < RS) v = src[sj * RS + si];
          else {
            v = g.sampleWorld(ax + (rx + k + 0.5) * texel, ay + (ry + j + 0.5) * texel, 0) < 0 ? 1 : 0;
            st.rasterSamples++;
          }
          if (v) { dst[j * RS + k] = 1; any = 1; }
        }
      }
    }
    st.raster = dst; st.rasterB = src;
    st.rx0 = rx; st.ry0 = ry; st.rTexel = texel; st.rReady = ready; st.rOn = any;
    st.rVer++;
  }
  out[I.rasterOn] = st.rOn;
  out[I.rasterX0] = st.rx0 * texel;
  out[I.rasterY0] = st.ry0 * texel;
  out[I.rasterTexel] = texel;
  out[I.rasterVer] = st.rVer;
  if (st.rOn) {
    const R = st.raster, base = I.rasterBase;
    for (let w = 0; w < I.rasterWords; w++) {
      let word = 0;
      const b0 = w * 32;
      for (let b = 0; b < 32; b++) if (R[b0 + b]) word |= (1 << b);
      out[base + w] = word >>> 0;
    }
  }
}
