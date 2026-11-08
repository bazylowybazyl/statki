// src/render/frameWake.js — BUDZIK LIMITU KLATEK BEZ VSYNC (Opcje → Grafika, `frameLimit`; 2026-10-29).
//
// Bez VSync (Electron, `hullfallApp.vsync === false`) rAF nie ma taktu ekranu, a Chromium po klatce bez zmiany obrazu
// odkłada następny o ~30 ms (docs/AUDYT-limit-klatek-2026-10-29.md) — pętla gry z limitem idzie BEZ rAF: FrameLimiter
// (tryb 'time') mówi, ile czekać (`waitMs`), budzik woła `onWake` (loop strony) w chwili należnej. Strategie
// (`setStrategy`, `?budzik=` na sesję — A/B):
//   'worker'  — osobny wątek (frameWake.worker.js): sen setTimeout do chwili należnej − `workerSpinMs`, ostatni odcinek
//               pętlą na wątku budzika (bez zadań i alokacji), jeden komunikat na klatkę do strony;
//   'sen'     — setTimeout strony do chwili należnej (w górę do pełnej ms), bez dopinania (`senSpinMs` > 0 — sen do
//               chwili należnej − senSpinMs, reszta kolejką);
//   'kolejka' — pierwsza wersja: sen do chwili należnej − margines (90. percentyl spóźnień budzika + 0,5 ms, 1–6 ms),
//               reszta czekania kolejką MessageChannel — przy limitach 120–240 całe czekanie (rdzeń CPU zajęty).
// Domyślna 'worker' (pomiar 2026-10-29, atrapa Electrona, docs/AUDYT-limit-klatek-2026-10-29.md § „Budzik bez VSync”):
// wątek strony 12% rdzenia przy limicie 120 i 22% przy 240 zamiast 28% / 90%, zero zadań kolejki zamiast 34–172 tys./s;
// mediana i 90. percentyl odstępów klatek jak przy dopinaniu kolejką, ogon gorszy w jednym przebiegu (przy limicie 60
// 99. percentyl 19,9 ms i maks. 48,2 ms wobec 16,7 / 16,8 ms); w powtórce A/B ogona nie było (p99 17,1 wobec 16,7 ms
// przy kolejce, maks. ≤ 20,6 ms w obu) — przyczyna pierwszego otwarta;
// pętla wątku budzika ~1 ms na klatkę. 'sen' — najtańszy, odstępy ±1–1,5 ms.
// Wątek budzika powstaje z góry (`prepare` — limit bez VSync w opcjach) albo przy pierwszym zamówieniu i budzi klatki
// dopiero po sygnale gotowości (komunikat 0 po starcie modułu; do tej chwili budzik strony — start nie opóźnia klatek
// i nie liczy się strażnikowi); `release` (bez limitu albo z VSync) zamyka go, zamówienie w toku przechodzi na budzik
// strony. Czekanie krótsze niż `hopMs` (klatka dłuższa niż interwał — czekanie 0) — skok kolejką strony bez rundy przez
// wątek (przesył w obie strony ~0,1 ms); dłuższe czekanie dopina wątek budzika, nie wątek strony.
// Klatka idzie z zadania wiadomości (kolejka MessageChannel, odpowiedź workera), nie z budzika: setTimeout wołany
// w klatce nie jest zagnieżdżony (HTML: od 5. zagnieżdżenia budzik krótszy niż 4 ms trwa 4 ms). Zamówienie ma numer
// (`seq`) — nowe i `cancel` unieważniają poprzednie (spóźnione budzenie nie woła klatki drugi raz). 'worker' ma
// strażnika: budzik strony `watchdogMs` po chwili należnej (odpowiedź nie przyszła) woła klatkę; trzy z rzędu, błąd
// workera albo brak gotowości przez `workerStartWakes` zamówień — budzik strony ('sen') do końca sesji. `workerFence`
// (A/B ogona) — strażnik dwustopniowy: pierwszy stopień w chwili należnej (pełne ms w górę) zamyka okres bezczynności
// Blinka (zadania requestIdleCallback i GC w bezczynności dostają termin najdalej do niego), drugi — `watchdogMs` dalej;
// w pomiarze 2026-10-29 bez zysku (ogon się nie powtórzył w żadnej strategii) — wyłączony.
// Zależności wstrzykiwane (testy bez czasu ściany): now, setTimer, clearTimer, channel, createWorker, warn.

export const FRAME_WAKE_TUNE = {
  workerSpinMs: 1,        // 'worker': końcówka czekania pętlą na wątku budzika (setTimeout workera spóźnia się ~0,2–1 ms)
  senSpinMs: 0,           // 'sen': > 0 — końcówka czekania kolejką MessageChannel
  hopMs: 0.1,             // krótsze czekanie — skok kolejką strony (dopięty do chwili należnej), bez snu i wątku budzika
  queueMarginMin: 1,      // 'kolejka': margines snu (90. percentyl spóźnień budzika + 0,5 ms) w [min, max]
  queueMarginMax: 6,
  watchdogMs: 100,        // 'worker': strażnik odpowiedzi
  watchdogFail: 3,        // tyle strażników z rzędu — worker uznany za martwy
  workerStartWakes: 240,  // tyle zamówień bez sygnału gotowości wątku — worker uznany za martwy
  workerFence: false,     // 'worker': pierwszy stopień strażnika w chwili należnej (A/B ogona — bezczynność Blinka; bez zysku)
  lateOverMs: 2           // narzędzia: budzenia spóźnione ponad tyle ms (`lateOver`)
};

export const FRAME_WAKE_STRATEGIES = Object.freeze(['worker', 'sen', 'kolejka']);

const LATE = 64;   // spóźnienia budzeń (narzędzia)
const QUEUE = 32;  // spóźnienia budzika strony ('kolejka': margines)

/** Strategia z adresu (?budzik=worker|sen|kolejka) — A/B na sesję; null — domyślna. */
export function frameWakeStrategyFromQuery(search) {
  let q = null;
  try { q = new URLSearchParams(String(search || '')).get('budzik'); } catch { q = null; }
  return FRAME_WAKE_STRATEGIES.includes(q) ? q : null;
}

function defaultWorker() {
  return new Worker(new URL('./frameWake.worker.js', import.meta.url), { type: 'module', name: 'budzik-klatek' });
}

/**
 * @param {{ onWake: () => void, strategy?: string, tune?: typeof FRAME_WAKE_TUNE, now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (id: any) => void,
 *   channel?: { port1: any, port2: any }, createWorker?: () => any, warn?: (msg: string) => void }} o
 */
export function createFrameWake({
  onWake,
  strategy = 'worker',
  tune = FRAME_WAKE_TUNE,
  now = () => performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  channel = new MessageChannel(),
  createWorker = defaultWorker,
  warn = (msg) => console.warn(msg)
} = {}) {
  let timer = 0;
  let guard = 0;          // zamówienie u wątku budzika: 1 — pierwszy stopień strażnika (workerFence), 2 — strażnik
  let missed = 0;         // strażniki z rzędu
  let waits = 0;          // zamówienia od startu wątku bez sygnału gotowości
  let wokeAt = -1;        // ostatnie budzenie (`frameMax` — do następnego zamówienia)
  const qLate = new Float64Array(QUEUE), qSorted = new Float64Array(QUEUE);
  let qLateN = 0;

  const w = {
    strategy: FRAME_WAKE_STRATEGIES.includes(strategy) ? strategy : 'worker',
    pending: false,
    seq: 0,
    dueAt: 0,          // chwila należna zamówienia (zegar strony)
    timerAt: 0,        // chwila snu budzika strony
    marginMs: 2,       // 'kolejka'
    late: new Float64Array(LATE), lateN: 0,   // spóźnienia budzeń względem chwili należnej [ms]
    lateMax: 0, lateOver: 0,                  // narzędzia: największe spóźnienie, budzenia spóźnione > tune.lateOverMs
    frameMax: 0,       // narzędzia: najdłuższa klatka — od budzenia do następnego zamówienia [ms]
    sleeps: 0,         // sny setTimeout strony
    hops: 0,           // klatki przez kolejkę (po śnie albo od razu)
    spins: 0,          // dopięcia kolejką przed chwilą należną
    wakes: 0,
    workerMsgs: 0, workerBusyMs: 0, watchdogs: 0, worker: null, workerReady: false, workerError: null,
    tune,              // strojenie w biegu (konsola, narzędzia: FrameLimiter.wake.tune.workerSpinMs)
    schedule, cancel, setStrategy, prepare, release
  };

  function clear() {
    if (timer) { clearTimer(timer); timer = 0; }
    guard = 0;
  }

  function wake() {
    const t = now();
    const late = t - w.dueAt > 0 ? t - w.dueAt : 0;
    w.late[w.lateN++ % LATE] = late;
    if (late > w.lateMax) w.lateMax = late;
    if (late > tune.lateOverMs) w.lateOver++;
    w.pending = false;
    w.wakes++;
    wokeAt = t;
    // `frameMax` liczy klatkę do zamówienia z TEJ klatki; klatka, po której pętla poszła w rAF (karta w tle, bez limitu,
    // zegar harnessu), nie zostawia znacznika — następne zamówienie po przerwie liczyłoby całą przerwę
    try { onWake(); } finally { wokeAt = -1; }
  }

  // dopinanie kolejką: 'kolejka' (margines) albo 'sen' z senSpinMs
  const spinMs = () => (w.strategy === 'kolejka' ? w.marginMs : w.strategy === 'sen' ? tune.senSpinMs : 0);

  // skok kolejką: przed chwilą należną następny skok (dopięcie), potem klatka
  channel.port1.onmessage = (e) => {
    if (e.data !== w.seq || !w.pending) return;
    if (w.dueAt > now()) { w.spins++; channel.port2.postMessage(w.seq); return; }
    wake();
  };

  function queueMargin() {
    const n = qLateN < QUEUE ? qLateN : QUEUE, s = qSorted;
    for (let i = 0; i < n; i++) {
      const v = qLate[i];
      let j = i - 1;
      while (j >= 0 && s[j] > v) { s[j + 1] = s[j]; j--; }
      s[j + 1] = v;
    }
    const m = s[Math.floor(0.9 * (n - 1))] + 0.5;
    return Math.min(tune.queueMarginMax, Math.max(tune.queueMarginMin, m));
  }

  function onTimer() {
    timer = 0;
    if (!w.pending) return;
    if (guard === 1) {
      // bariera w chwili należnej (workerFence): odpowiedź wątku jeszcze nie przyszła — strażnik `watchdogMs` dalej
      guard = 2;
      timer = setTimer(onTimer, tune.watchdogMs);
      return;
    }
    if (guard === 2) {
      // worker nie odpisał w czasie: klatka teraz; kilka razy z rzędu — budzik strony do końca sesji
      guard = 0;
      w.watchdogs++;
      if (++missed >= tune.watchdogFail) workerFailed('brak odpowiedzi wątku budzika', false);
      wake();
      return;
    }
    const late = now() - w.timerAt;
    qLate[qLateN++ % QUEUE] = late > 0 ? late : 0;
    if (w.strategy === 'kolejka') w.marginMs = queueMargin();
    w.hops++;
    channel.port2.postMessage(w.seq);
  }

  function onWorkerMessage(e) {
    const d = e.data;
    w.workerMsgs++;
    if (d === 0) { w.workerReady = true; return; }   // sygnał gotowości (moduł wątku wystartował)
    if (!d || d[0] !== w.seq || !w.pending) return;
    w.workerBusyMs += d[1];
    missed = 0;
    clear();
    wake();
  }

  function ensureWorker() {
    if (w.worker) return true;
    if (w.workerError) return false;
    try {
      const wk = createWorker();
      wk.onmessage = onWorkerMessage;
      wk.onerror = (e) => workerFailed((e && e.message) || 'błąd wątku budzika', true);
      w.worker = wk;
      w.workerReady = false;
      waits = 0;
      missed = 0;
      return true;
    } catch (err) {
      workerFailed(String((err && err.message) || err), false);
      return false;
    }
  }

  // wątek zamknięty — komunikaty i błędy starego wątku już nie dochodzą (handlery zdjęte)
  function dropWorker() {
    const wk = w.worker;
    w.worker = null;
    w.workerReady = false;
    if (!wk) return;
    wk.onmessage = null;
    wk.onerror = null;
    try { wk.terminate(); } catch { /* już zamknięty */ }
  }

  // `again` — zamówienie u wątku przechodzi na budzik strony (błąd przyszedł zdarzeniem; strażnik woła klatkę sam)
  function workerFailed(why, again) {
    if (w.workerError) return;
    w.workerError = why;
    const moved = again && w.pending && guard > 0;
    dropWorker();
    if (w.strategy !== 'worker') return;
    w.strategy = 'sen';
    warn(`[limit klatek] budzik w workerze: ${why} — budzik strony`);
    if (moved) schedule(w.dueAt - now());
  }

  // wątek budzika do zamówienia; do sygnału gotowości klatki budzi strona (start modułu nie opóźnia klatek)
  function workerReady() {
    if (!ensureWorker()) return false;
    if (w.workerReady) return true;
    if (++waits >= tune.workerStartWakes) workerFailed('wątek budzika nie zgłosił gotowości', false);
    return false;
  }

  // `viaWorker` false — budzik strony także przy strategii 'worker' (release: wątek zamknięty)
  function request(waitMs, viaWorker) {
    clear();
    const t = now();
    if (wokeAt >= 0) {
      if (t - wokeAt > w.frameMax) w.frameMax = t - wokeAt;
      wokeAt = -1;
    }
    const wait = waitMs > 0 ? waitMs : 0;
    const seq = ++w.seq;
    w.pending = true;
    w.dueAt = t + wait;
    if (wait < tune.hopMs) {
      w.hops++;
      channel.port2.postMessage(seq);
      return;
    }
    if (viaWorker && w.strategy === 'worker' && workerReady()) {
      w.worker.postMessage([seq, wait, tune.workerSpinMs]);
      guard = tune.workerFence ? 1 : 2;
      timer = setTimer(onTimer, Math.ceil(wait) + (tune.workerFence ? 0 : tune.watchdogMs));
      return;
    }
    const m = spinMs();
    const sleep = m > 0 ? Math.floor(wait - m) : Math.ceil(wait);
    if (sleep >= 1) {
      w.timerAt = t + sleep;
      w.sleeps++;
      timer = setTimer(onTimer, sleep);
    } else {
      w.hops++;
      channel.port2.postMessage(seq);
    }
  }

  /** Klatka (`onWake`) za `waitMs` ms; zastępuje zamówienie w toku. */
  function schedule(waitMs) { request(waitMs, true); }

  /** Zamówienie w toku przepada (spóźnione budzenia nieważne); true — było. */
  function cancel() {
    if (!w.pending) return false;
    clear();
    w.pending = false;
    w.seq++;
    if (w.worker) w.worker.postMessage(0);
    return true;
  }

  /** Wątek budzika z góry (limit bez VSync w opcjach) — gotowy, zanim pętla go potrzebuje; true — jest. */
  function prepare() {
    if (w.strategy === 'worker') ensureWorker();
    return w.worker !== null;
  }

  /**
   * Wątek budzika zamknięty (bez limitu albo z VSync — niepotrzebny); zamówienie u wątku przechodzi na budzik strony
   * (pętla na nie czeka). Następne zamówienie albo `prepare` tworzy wątek od nowa. True — był.
   */
  function release() {
    if (!w.worker) return false;
    const moved = w.pending && guard > 0;
    const rest = w.dueAt - now();
    dropWorker();
    if (moved) request(rest, false);
    return true;
  }

  /** Strategia w biegu (narzędzia, konsola: FrameLimiter.wake.setStrategy('sen')); zamówienie w toku przechodzi. */
  function setStrategy(name) {
    let s = FRAME_WAKE_STRATEGIES.includes(name) ? name : w.strategy;
    if (s === 'worker' && w.workerError) s = 'sen';
    if (s === w.strategy) return w.strategy;
    const rest = w.pending ? w.dueAt - now() : NaN;
    cancel();
    w.strategy = s;
    if (rest === rest) schedule(rest);
    return w.strategy;
  }

  return w;
}
