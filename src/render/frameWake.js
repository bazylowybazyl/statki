// src/render/frameWake.js — BUDZIK LIMITU KLATEK BEZ VSYNC (Opcje → Grafika, `frameLimit`; 2026-10-30).
//
// Bez VSync (Electron, `hullfallApp.vsync === false`) rAF nie ma taktu ekranu, a Chromium po klatce bez zmiany obrazu
// odkłada następny o ~30 ms (docs/AUDYT-limit-klatek-2026-10-29.md) — pętla gry z limitem idzie BEZ rAF: FrameLimiter
// (tryb 'time') mówi, ile czekać (`waitMs`), budzik woła `onWake` (loop strony) w chwili należnej. Strategie
// (`setStrategy`, `?budzik=` na sesję — A/B):
//   'worker'  — osobny wątek (frameWake.worker.js): sen setTimeout do chwili należnej − `workerSpinMs`, ostatni odcinek
//               pętlą na wątku budzika (bez zadań i alokacji), jeden komunikat na klatkę do strony;
//   'sen'     — setTimeout strony do chwili należnej (w górę do pełnej ms), bez dopinania (`senSpinMs` > 0 — sen do
//               chwili należnej − senSpinMs, reszta kolejką);
//   'kolejka' — dawne (2026-10-29): sen do chwili należnej − margines (90. percentyl spóźnień budzika + 0,5 ms, 1–6 ms),
//               reszta czekania kolejką MessageChannel — przy limitach 120–240 całe czekanie (rdzeń CPU zajęty).
// Domyślna 'worker' (pomiar 2026-10-30, atrapa Electrona, docs/AUDYT-limit-klatek-2026-10-29.md § „Budzik bez VSync”):
// takt jak przy dopinaniu kolejką, wątek strony 12% rdzenia przy limicie 120 i 22% przy 240 zamiast 28% / 90%, zero
// zadań kolejki zamiast 34–172 tys./s; pętla wątku budzika ~1 ms na klatkę. 'sen' — najtańszy, odstępy ±1–1,5 ms.
// Klatka idzie z zadania wiadomości (kolejka MessageChannel, odpowiedź workera), nie z budzika: setTimeout wołany
// w klatce nie jest zagnieżdżony (HTML: od 5. zagnieżdżenia budzik krótszy niż 4 ms trwa 4 ms). Zamówienie ma numer
// (`seq`) — nowe i `cancel` unieważniają poprzednie (spóźnione budzenie nie woła klatki drugi raz). 'worker' ma
// strażnika: budzik strony `watchdogMs` po chwili należnej (odpowiedź nie przyszła) woła klatkę; trzy z rzędu albo błąd
// workera — budzik strony ('sen') do końca sesji.
// Zależności wstrzykiwane (testy bez czasu ściany): now, setTimer, clearTimer, channel, createWorker, warn.

export const FRAME_WAKE_TUNE = {
  workerSpinMs: 1,      // 'worker': końcówka czekania pętlą na wątku budzika (setTimeout workera spóźnia się ~0,2–1 ms)
  senSpinMs: 0,         // 'sen': > 0 — końcówka czekania kolejką MessageChannel
  queueMarginMin: 1,    // 'kolejka': margines snu (90. percentyl spóźnień budzika + 0,5 ms) w [min, max]
  queueMarginMax: 6,
  watchdogMs: 100,      // 'worker': strażnik odpowiedzi
  watchdogFail: 3       // tyle strażników z rzędu — worker uznany za martwy
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
  let watchdog = false;   // czeka strażnik odpowiedzi workera (nie sen)
  let missed = 0;         // strażniki z rzędu
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
    sleeps: 0,         // sny setTimeout strony
    hops: 0,           // klatki przez kolejkę (po śnie albo od razu)
    spins: 0,          // dopięcia kolejką przed chwilą należną
    wakes: 0,
    workerMsgs: 0, workerBusyMs: 0, watchdogs: 0, worker: null, workerError: null,
    tune,              // strojenie w biegu (konsola, narzędzia: FrameLimiter.wake.tune.workerSpinMs)
    schedule, cancel, setStrategy
  };

  function clear() {
    if (timer) { clearTimer(timer); timer = 0; }
    watchdog = false;
  }

  function wake() {
    const late = now() - w.dueAt;
    w.late[w.lateN++ % LATE] = late > 0 ? late : 0;
    w.pending = false;
    w.wakes++;
    onWake();
  }

  // dopinanie kolejką: 'kolejka' (margines) albo 'sen' z senSpinMs
  const spinMs = () => (w.strategy === 'kolejka' ? w.marginMs : w.strategy === 'sen' ? tune.senSpinMs : 0);

  channel.port1.onmessage = (e) => {
    if (e.data !== w.seq || !w.pending) return;
    if (spinMs() > 0 && w.dueAt > now()) { w.spins++; channel.port2.postMessage(w.seq); return; }
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
    if (watchdog) {
      // worker nie odpisał w czasie: klatka teraz; kilka razy z rzędu — budzik strony do końca sesji
      watchdog = false;
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
      return true;
    } catch (err) {
      workerFailed(String((err && err.message) || err), false);
      return false;
    }
  }

  // `again` — zamówienie w toku przechodzi na budzik strony (błąd przyszedł zdarzeniem; strażnik woła klatkę sam)
  function workerFailed(why, again) {
    if (w.workerError) return;
    w.workerError = why;
    const wk = w.worker;
    w.worker = null;
    if (wk) { try { wk.terminate(); } catch { /* już zamknięty */ } }
    if (w.strategy !== 'worker') return;
    w.strategy = 'sen';
    warn(`[limit klatek] budzik w workerze: ${why} — budzik strony`);
    if (again && w.pending) schedule(w.dueAt - now());
  }

  /** Klatka (`onWake`) za `waitMs` ms; zastępuje zamówienie w toku. */
  function schedule(waitMs) {
    clear();
    const t = now();
    const wait = waitMs > 0 ? waitMs : 0;
    const seq = ++w.seq;
    w.pending = true;
    w.dueAt = t + wait;
    if (w.strategy === 'worker' && ensureWorker()) {
      w.worker.postMessage([seq, wait, tune.workerSpinMs]);
      watchdog = true;
      timer = setTimer(onTimer, Math.ceil(wait) + tune.watchdogMs);
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

  /** Zamówienie w toku przepada (spóźnione budzenia nieważne); true — było. */
  function cancel() {
    if (!w.pending) return false;
    clear();
    w.pending = false;
    w.seq++;
    if (w.worker) w.worker.postMessage(0);
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
