// ZEGAR GPU NA KLATKĘ CORE3D (2026-11-04) — rozliczenie znaczników czasu GPU (three r183, cecha timestamp-query)
// na WŁASNE klatki Core3D zamiast na `renderer.info.frame`.
//
// Dlaczego: three r183 grupuje znaczniki po `info.frame` (uid 'r:<nr renderu>:<kontekst>:f<info.frame>') i oddaje
// sumę ms OSTATNIEGO numeru w paczce (`WebGPUTimestampQueryPool._resolveQueries`). `info.frame` liczy takty pętli rAF
// three — w workerze renderu takty nie mają związku z renderami (render na wiadomość strony), a przy zapchanym GPU
// rAF workera tyka rzadko (22–69 taktów na ~240 renderów w 2 s, upadek habitatu): jeden numer obejmował dziesiątki
// klatek i `Core3D.gpuFrameMs` dawał SUMĘ wielu renderów (PerfHUD 14,82 ms przy 4,04 ms na klatkę). Tu każdy znacznik
// dostaje numer klatki Core3D z chwili przydziału zapytania (`noteQuery` z owiniętego `backend.initTimestampQuery`),
// a klatka jest rozliczana dopiero, gdy wróciły rozwiązania zapytań zgłoszone PO jej końcu (render i compute) —
// wynik to średnie ms GPU na klatkę z klatek pełnych (ze znacznikami od początku do końca).
//
// Klatka Core3D = obraz: jeden `render()` (podzielony ekran — para), `renderBackdrop()`; numer rośnie na jej KOŃCU,
// więc rendery modułów do własnych celów przed `render()` (pieczenie map, wypieki) liczą się do klatki, która je
// pokaże. Moduł czysty (bez three) — test `tests/zegarGpuKlatki.test.mjs` symuluje pulę three ze stojącym
// `info.frame` i opóźnionymi rozwiązaniami. Bez alokacji na klatkę: pierścienie tablic typowanych, przeglądy map
// przez `forEach` z gotowym wywołaniem zwrotnym.

const RING = 1024;                 // klatek w pierścieniu (rozliczenie wraca po kilku–kilkudziesięciu klatkach)
const RM = RING - 1;
const POOL_PAIRS = 1024;           // pula three r183: 2048 zapytań = 1024 pary (początek, koniec passa)
const SAMPLED = 1;                 // znaczniki włączone od początku klatki
const PART_R = 2;                  // część passów renderu bez znacznika (brama wyłączyła w środku, pula pełna)
const PART_C = 4;                  // część wywołań compute bez znacznika

const T_RENDER = 0;
const T_COMPUTE = 1;
const typeIndex = (type) => (type === 'compute' ? T_COMPUTE : T_RENDER);

export function createZegarGpuKlatki() {
  const sum = [new Float64Array(RING), new Float64Array(RING)];
  const cnt = [new Int32Array(RING), new Int32Array(RING)];
  const flags = new Uint8Array(RING);
  // numer klatki pary zapytań puli (indeks = przesunięcie / 2); −1 = nieznana
  const fidAt = [new Int32Array(POOL_PAIRS).fill(-1), new Int32Array(POOL_PAIRS).fill(-1)];
  // migawka zlecenia rozwiązania: uid i klatka w kolejności mapy `queryOffsets` (= kolejność `timestamps` wyniku)
  const snapUid = [new Array(POOL_PAIRS).fill(''), new Array(POOL_PAIRS).fill('')];
  const snapFid = [new Int32Array(POOL_PAIRS), new Int32Array(POOL_PAIRS)];
  const snapN = [0, 0];
  const reqFid = [-1, -1];         // klatki < reqFid były zakończone przed zgłoszeniem (−1 = brak zlecenia naszego)
  const settled = [0, 0];          // klatki < settled[t] mają wszystkie znaczniki typu t rozwiązane
  const seen = [false, false];     // pula typu ma już zapytania (bez niej typ nie wstrzymuje rozliczenia)

  const Z = {
    fid: 0,
    nextSettle: 0,
    // wynik ostatniego rozliczenia (settle): średnie ms na klatkę z klatek pełnych i ich liczba
    renderMs: 0, renderN: 0, computeMs: 0, computeN: 0,
    // liczniki diagnostyczne
    stats: { frames: 0, sampled: 0, partialR: 0, partialC: 0, lost: 0, foreign: 0, dropped: 0 }
  };

  const live = (f) => f >= 0 && Z.fid - f < RING && f <= Z.fid;
  const markPartial = (f, t) => { if (live(f)) flags[f & RM] |= t === T_COMPUTE ? PART_C : PART_R; };

  /** Koniec klatki Core3D: następna dostaje nowy numer i czysty rekord. */
  Z.frameEnd = () => {
    Z.fid++;
    Z.stats.frames++;
    const j = Z.fid & RM;
    sum[0][j] = 0; sum[1][j] = 0; cnt[0][j] = 0; cnt[1][j] = 0; flags[j] = 0;
    return Z.fid;
  };

  /** Brama znaczników na początku klatki: `on` — znaczniki od początku klatki (próbka). */
  Z.setSampled = (on) => {
    const j = Z.fid & RM;
    if (on) { flags[j] |= SAMPLED; return; }
    // klatka miała już znaczniki (rendery modułów przed render()), a brama je wyłącza — klatka niepełna
    if (cnt[0][j] + cnt[1][j] > 0) flags[j] |= PART_R | PART_C;
    else flags[j] &= ~SAMPLED;
  };

  /** Brama wyłączyła znaczniki w środku bieżącej klatki (`type` albo oba, gdy pominięty). */
  Z.notePartial = (type) => {
    const j = Z.fid & RM;
    if (type === undefined) flags[j] |= PART_R | PART_C;
    else flags[j] |= typeIndex(type) === T_COMPUTE ? PART_C : PART_R;
  };

  /**
   * Przydział pary zapytań (owinięte `backend.initTimestampQuery`): `offset` — początek pary w puli albo
   * null / nie-liczba (pula pełna albo wyłączona — klatka niepełna).
   */
  Z.noteQuery = (type, offset) => {
    const t = typeIndex(type);
    if (typeof offset !== 'number' || !(offset >= 0) || (offset >> 1) >= POOL_PAIRS) {
      markPartial(Z.fid, t);
      return;
    }
    if (!seen[t]) {
      seen[t] = true;
      // klatki przed pierwszym zapytaniem typu nie mają jego znaczników — rozliczone dla tego typu
      if (settled[t] < Z.fid) settled[t] = Z.fid;
    }
    fidAt[t][offset >> 1] = Z.fid;
    cnt[t][Z.fid & RM]++;
  };

  let snapT = 0, snapI = 0;
  const snapCb = (offset, uid) => {
    if (snapI >= POOL_PAIRS) return;
    const pair = offset >> 1;
    snapUid[snapT][snapI] = uid;
    snapFid[snapT][snapI] = pair >= 0 && pair < POOL_PAIRS ? fidAt[snapT][pair] : -1;
    if (pair >= 0 && pair < POOL_PAIRS) fidAt[snapT][pair] = -1;
    snapI++;
  };

  /**
   * Tuż PRZED `renderer.resolveTimestampsAsync(type)`: migawka zapytań puli (mapa uid → przesunięcie, w kolejności
   * przydziału — three kopiuje ją synchronicznie w tym samym wywołaniu i w tej kolejności zapisuje wyniki).
   */
  Z.beforeResolve = (type, pool) => {
    const t = typeIndex(type);
    snapT = t; snapI = 0;
    const offs = pool && pool.queryOffsets;
    if (offs && typeof offs.forEach === 'function') offs.forEach(snapCb);
    snapN[t] = snapI;
    reqFid[t] = Z.fid;
  };

  /**
   * Tuż PO wywołaniu `resolveTimestampsAsync` (część synchroniczna three już przeszła): pula wyzerowana = zlecenie
   * zabrało zapytania. Gdy nie (pula wyłączona, bufor wyniku zajęty) — zlecenie niczego nie rozlicza.
   */
  Z.afterResolveCall = (type, pool) => {
    const t = typeIndex(type);
    if (!pool || pool.currentQueryIndex !== 0) { reqFid[t] = -1; snapN[t] = 0; }
  };

  let resT = 0, resJ = 0, resN = 0;
  const resCb = (dur, uid) => {
    // kolejność = migawka; uid spoza migawki (cudze zlecenie) pomijamy
    let k = resJ;
    const uids = snapUid[resT];
    while (k < resN && uids[k] !== uid) k++;
    if (k >= resN) { Z.stats.foreign++; return; }
    const fids = snapFid[resT];
    for (; resJ < k; resJ++) { markPartial(fids[resJ], resT); Z.stats.lost++; }
    const f = fids[k];
    resJ = k + 1;
    if (!live(f)) { Z.stats.dropped++; return; }
    if (Number.isFinite(dur) && dur >= 0) sum[resT][f & RM] += dur;
    else markPartial(f, resT);
  };

  /**
   * Wynik zlecenia typu `type`: `timestamps` — mapa puli three uid → ms (wpisy TEGO zlecenia; Core3D czyści ją po
   * każdym wyniku). Zwraca liczbę klatek pełnych rozliczonych teraz (render + compute); średnie w renderMs / computeMs.
   */
  Z.onResult = (type, timestamps) => {
    const t = typeIndex(type);
    if (reqFid[t] >= 0) {
      resT = t; resJ = 0; resN = snapN[t];
      if (timestamps && typeof timestamps.forEach === 'function') timestamps.forEach(resCb);
      const fids = snapFid[t];
      // zapytania bez wyniku (błąd mapowania, wyjątek w three) — ich klatki niepełne
      for (; resJ < resN; resJ++) { markPartial(fids[resJ], t); Z.stats.lost++; }
      const uids = snapUid[t];
      for (let i = 0; i < resN; i++) uids[i] = '';
      snapN[t] = 0;
      if (settled[t] < reqFid[t]) settled[t] = reqFid[t];
      reqFid[t] = -1;
    }
    return Z.settle();
  };

  /** Rozliczenie klatek, których znaczniki wszystkich typów już wróciły; średnie ms na klatkę z klatek pełnych. */
  Z.settle = () => {
    let lim = Z.fid;
    if (seen[T_RENDER] && settled[T_RENDER] < lim) lim = settled[T_RENDER];
    if (seen[T_COMPUTE] && settled[T_COMPUTE] < lim) lim = settled[T_COMPUTE];
    let accR = 0, nR = 0, accC = 0, nC = 0;
    while (Z.nextSettle < lim) {
      const f = Z.nextSettle++;
      if (Z.fid - f >= RING) continue;
      const j = f & RM;
      const fl = flags[j];
      if (!(fl & SAMPLED)) continue;
      Z.stats.sampled++;
      if (fl & PART_R) Z.stats.partialR++;
      else if (cnt[0][j] > 0) { accR += sum[0][j]; nR++; }
      if (fl & PART_C) Z.stats.partialC++;
      else { accC += sum[1][j]; nC++; }
    }
    Z.renderN = nR; Z.renderMs = nR > 0 ? accR / nR : 0;
    Z.computeN = nC; Z.computeMs = nC > 0 ? accC / nC : 0;
    return nR + nC;
  };

  return Z;
}
