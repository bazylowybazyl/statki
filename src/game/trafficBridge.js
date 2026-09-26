/**
 * MOST RUCHU v2 — symulacja ruchu (src/game/traffic/) widziana z gry.
 *
 * Świat ruchu żyje w Web Workerze (`traffic/traffic.worker.js`); gra rozmawia
 * z nim wiadomościami (`traffic/trafficProtocol.js`) i trzyma u siebie tylko
 * kopie: rynku (magazyny i ceny stacji — dla terminalu handlu) i kursów
 * w bańce gracza (bieżące odcinki ruchu — dla proxy statków, Z13).
 *
 * Wzór: `PhysicsBridge`. Bez workera (brak `Worker`, błąd ładowania przed
 * `ready`, `useWorker: false`) ten sam rdzeń chodzi na głównym wątku — wtedy
 * krok świata co 5 s gry trafia w klatkę (śr. 12–18 ms przy ×60) i widać to
 * w wierszu PerfHUD („ruch v2”).
 *
 * Czas: `time` to czas świata ruchu po stronie gry — suma `advance(dt)`.
 * Gra woła `advance` z krokami fizyki, więc pauza (brak kroków) zatrzymuje
 * gospodarkę. Odcinki kursów w buforze mają `T0` w tym samym czasie.
 *
 * Handel: `stockDelta` zmienia kopię od razu (terminal widzi zakup w tej samej
 * klatce) i wysyła zmianę do workera z numerem. Rynek z workera niesie numer
 * ostatniej zastosowanej zmiany, więc kopia nakłada na nowy stan tylko to,
 * czego worker jeszcze nie widział — bez migania zapasu wstecz.
 */

import {
  TRAFFIC_MSG, COURSE_STRIDE, COURSE_FIELD, MARKET_STRIDE, MARKET_FIELD
} from './traffic/trafficProtocol.js';

/** Ile ostatnich wraków trzymać do podglądu w konsoli. */
const RECENT_WRECK_LIMIT = 64;
/** Fokus bańki idzie do workera najwyżej tak często (ms czasu rzeczywistego). */
const FOCUS_INTERVAL_MS = 100;

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}

function createMirror(resources) {
  const zeros = () => Object.fromEntries(resources.map(key => [key, 0]));
  return { resources: zeros(), capacity: zeros(), duress: {}, bid: zeros(), ask: zeros() };
}

/** Te same reguły co `applyStockDelta` w dyspozytorze: 0…pojemność, 0 = bez limitu. */
function applyToMirror(mirror, bag) {
  const applied = {};
  if (!mirror || !bag) return applied;
  for (const [id, raw] of Object.entries(bag)) {
    if (!(id in mirror.resources)) continue;
    const delta = Number(raw);
    if (!Number.isFinite(delta) || delta === 0) continue;
    const stock = Math.max(0, Number(mirror.resources[id]) || 0);
    const cap = Number(mirror.capacity[id]);
    const next = delta > 0
      ? (Number.isFinite(cap) && cap > 0 ? Math.min(cap, stock + delta) : stock + delta)
      : Math.max(0, stock + delta);
    if (next === stock) continue;
    mirror.resources[id] = next;
    applied[id] = next - stock;
  }
  return applied;
}

export class TrafficBridge {
  /**
   * `options`:
   *   useWorker      false = od razu główny wątek
   *   workerFactory  () => obiekt w stylu Worker (testy)
   *   coreFactory    createTrafficCore podany wprost (testy; bez dynamicznego importu)
   */
  constructor(options = {}) {
    this.options = options;
    this.useWorker = options.useWorker !== false
      && (typeof options.workerFactory === 'function' || typeof Worker === 'function');
    /** 'idle' | 'worker' | 'main-fallback' */
    this.mode = 'idle';
    this.fallbackReason = null;
    this.worker = null;
    this.core = null;
    this.ready = false;
    /** Błąd, po którym most przestał działać (worker padł po `ready`). */
    this.failed = null;
    /** Ostatni błąd zgłoszony przez rdzeń (świat działa dalej). */
    this.lastError = null;
    this.time = 0;
    this.clock = 0;
    this.step = 5;
    this.seed = null;
    this.buildMs = 0;
    /** `{ stations, resources, factions, kinds }` z `ready`. */
    this.tables = null;
    this.stationIndex = new Map();
    /** `stationId` → kopia magazynu `{ resources, capacity, duress, bid, ask }`. */
    this.market = new Map();
    /** Kursy w bańce: `data` (Float64Array, `COURSE_STRIDE`), `count`, `clock`. */
    this.courses = { data: new Float64Array(0), count: 0, clock: 0, time: 0 };
    this.hulls = [];
    this.stats = null;
    this.recentWrecks = [];
    this.listeners = new Map();

    this._initMessage = null;
    /** Wszystko od `init` do `ready` — do powtórki, gdy worker padnie przed startem. */
    this._replay = [];
    this._stockSeq = 0;
    this._pendingStock = [];
    this._focusSentAt = -Infinity;
    this._requestId = 1;
    this._pending = new Map();
    this._mainMs = 0;
    this._depth = 0;
    this._t0 = 0;
    this._readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    // Nikt nie musi czekać na `init()` — nieobsłużone odrzucenie nie może
    // zasypać konsoli, gdy gra po prostu zajrzy w `getStats()`.
    this._readyPromise.catch(() => {});
  }

  // ============================================================
  // Start
  // ============================================================

  /** Buduje świat. Zwraca obietnicę wiadomości `ready`. */
  init(spec = {}) {
    this._enter();
    try {
      this._initMessage = { ...spec, type: TRAFFIC_MSG.INIT };
      this._replay = [this._initMessage];
      if (this.useWorker) this._startWorker();
      else this._startFallback('useWorker: false');
    } finally {
      this._leave();
    }
    return this._readyPromise;
  }

  _startWorker() {
    try {
      this.worker = this.options.workerFactory
        ? this.options.workerFactory()
        : new Worker(new URL('./traffic/traffic.worker.js', import.meta.url), { type: 'module', name: 'traffic-v2' });
    } catch (error) {
      this._startFallback(error);
      return;
    }
    this.mode = 'worker';
    this.worker.onmessage = event => this._receive(event.data);
    this.worker.onerror = event => this._onWorkerError(event);
    this.worker.onmessageerror = event => this._onWorkerError(event);
    this.worker.postMessage(this._initMessage);
  }

  _onWorkerError(event) {
    const reason = event?.message || event?.error?.message || 'worker ruchu padł';
    if (!this.ready) {
      // Przed `ready` świat w workerze jeszcze nie istnieje, więc nic nie
      // tracimy: ten sam rdzeń startuje na głównym wątku z tą samą historią.
      event?.preventDefault?.();
      try { this.worker?.terminate(); } catch { /* już nie żyje */ }
      this.worker = null;
      this._startFallback(reason);
      return;
    }
    this.failed = String(reason);
    this._emit('error', { type: TRAFFIC_MSG.ERROR, message: this.failed, during: 'worker' });
  }

  _startFallback(reason) {
    this.mode = 'main-fallback';
    this.fallbackReason = String(reason?.message || reason || '');
    if (typeof this.options.coreFactory === 'function') {
      this._attachCore(this.options.coreFactory);
      return;
    }
    import('./traffic/trafficCore.js')
      .then(module => this._attachCore(module.createTrafficCore))
      .catch(error => {
        this.failed = String(error?.message || error);
        this._rejectReady(error);
      });
  }

  _attachCore(createCore) {
    this.core = createCore(message => this._receive(message));
    // Świat buduje się na głównym wątku — to jest koszt trybu awaryjnego.
    const queue = this._replay;
    this._replay = [];
    this._enter();
    try {
      for (const message of queue) this.core.handle(message);
    } finally {
      this._leave();
    }
  }

  _post(message, transfer) {
    if (!this.ready) this._remember(message);
    if (this.mode === 'worker' && this.worker) {
      this.worker.postMessage(message, transfer || []);
    } else if (this.core) {
      this.core.handle(message);
    }
    // Rdzeń awaryjny jeszcze się ładuje — wiadomość czeka w `_replay`.
  }

  _remember(message) {
    const last = this._replay[this._replay.length - 1];
    if (message.type === TRAFFIC_MSG.ADVANCE && last?.type === TRAFFIC_MSG.ADVANCE) {
      last.dt += message.dt;
      return;
    }
    this._replay.push(message.type === TRAFFIC_MSG.ADVANCE ? { ...message } : message);
  }

  // ============================================================
  // Gra → świat
  // ============================================================

  /** Czas gry; woła się z krokami fizyki (pauza = brak wywołań). */
  advance(dt) {
    const delta = Number(dt);
    if (!(delta > 0)) return;
    this._enter();
    try {
      this.time += delta;
      this._post({ type: TRAFFIC_MSG.ADVANCE, dt: delta });
    } finally {
      this._leave();
    }
  }

  /** Środek i promień bańki. Wolno wołać co klatkę — do workera idzie ~10 Hz. */
  setFocus(x, y, r, force = false) {
    const t = now();
    if (!force && t - this._focusSentAt < FOCUS_INTERVAL_MS) return;
    this._focusSentAt = t;
    this._enter();
    try {
      this._post({ type: TRAFFIC_MSG.FOCUS, x: Number(x) || 0, y: Number(y) || 0, r: Math.max(0, Number(r) || 0) });
    } finally {
      this._leave();
    }
  }

  /**
   * Zmiana zapasu stacji: handel gracza, rozbiórka wraku. Kopia zmienia się
   * od razu; zwraca to, co faktycznie weszło/wyszło w kopii.
   */
  stockDelta(stationId, bag, reason = 'player') {
    const id = String(stationId || '');
    this._enter();
    try {
      const applied = applyToMirror(this.market.get(id), bag);
      const seq = ++this._stockSeq;
      this._pendingStock.push({ seq, stationId: id, bag: { ...bag } });
      this._post({ type: TRAFFIC_MSG.STOCK, seq, stationId: id, bag: { ...bag }, reason: String(reason) });
      return applied;
    } finally {
      this._leave();
    }
  }

  /** Pojemności magazynów z budynków gry (skala 1) — worker sam przelicza na świat. */
  setCapacity(stationId, capacity) {
    this._send({ type: TRAFFIC_MSG.CAPACITY, stationId: String(stationId || ''), capacity: { ...capacity } });
  }

  attach(course) { this._send({ type: TRAFFIC_MSG.ATTACH, course }); }
  detach(course, progress) { this._send({ type: TRAFFIC_MSG.DETACH, course, progress }); }
  reportProgress(course, progress) { this._send({ type: TRAFFIC_MSG.PROGRESS, course, progress }); }
  completeStage(course) { this._send({ type: TRAFFIC_MSG.STAGE_DONE, course }); }

  /** Statek kursu zginął w grze. `options`: `x`, `y`, `reason`, `byPirates`. */
  destroyCourse(course, options = {}) {
    this._send({ type: TRAFFIC_MSG.DESTROYED, course, ...options });
  }

  stationDestroyed(stationId) {
    this._send({ type: TRAFFIC_MSG.STATION, stationId: String(stationId || ''), destroyed: true });
  }

  /** Pokrętła deweloperskie: `piracyPressure`, `piracyEnabled`, `protectObserved`. */
  setConfig(config = {}) {
    this._send({ ...config, type: TRAFFIC_MSG.CONFIG });
  }

  /** Podsumowanie świata (dyspozytor, stocznie, wojna, piractwo…) — do konsoli. */
  requestSnapshot() {
    const requestId = this._requestId++;
    return new Promise((resolve, reject) => {
      this._pending.set(requestId, { resolve, reject });
      this._send({ type: TRAFFIC_MSG.SNAPSHOT, requestId });
    });
  }

  _send(message) {
    this._enter();
    try {
      this._post(message);
    } finally {
      this._leave();
    }
  }

  // ============================================================
  // Świat → gra
  // ============================================================

  _receive(message) {
    this._enter();
    try {
      switch (message?.type) {
        case TRAFFIC_MSG.READY: this._onReady(message); break;
        case TRAFFIC_MSG.TICK: this._onTick(message); break;
        case TRAFFIC_MSG.BUBBLE: this._applyBubble(message); this._emit('bubble', this.courses); break;
        case TRAFFIC_MSG.SNAPSHOT_RESULT: {
          const pending = this._pending.get(message.requestId);
          this._pending.delete(message.requestId);
          pending?.resolve(message.snapshot);
          break;
        }
        case TRAFFIC_MSG.ERROR:
          this.lastError = message;
          this._emit('error', message);
          break;
        default: break;
      }
    } finally {
      this._leave();
    }
  }

  _onReady(message) {
    this.ready = true;
    this._replay = [];
    this.tables = {
      stations: message.stations || [],
      resources: message.resources || [],
      factions: message.factions || [],
      kinds: message.kinds || [],
      /** `stationId` → id stanowisk portu; `BERTH` kursu to indeks w tej liście. */
      berths: message.berths || {}
    };
    this.step = Number(message.step) || this.step;
    this.clock = Number(message.clock) || 0;
    this.seed = message.seed ?? null;
    this.buildMs = Number(message.buildMs) || 0;
    this.stationIndex = new Map(this.tables.stations.map((entry, index) => [entry.id, index]));
    this.market.clear();
    for (const entry of this.tables.stations) {
      this.market.set(entry.id, createMirror(this.tables.resources));
    }
    this._emit('ready', message);
    this._resolveReady(message);
  }

  _onTick(message) {
    this.clock = Number(message.clock) || 0;
    this.stats = message.stats || null;
    if (message.market) this._applyMarket(message.market, Number(message.stockSeq) || 0);
    if (message.bubble) this._applyBubble(message.bubble);
    if (Array.isArray(message.stationFactions) && this.tables) {
      message.stationFactions.forEach((factionId, index) => {
        const entry = this.tables.stations[index];
        if (entry) { entry.factionId = factionId; entry.derelict = !factionId; }
      });
    }
    if (message.wrecks?.length) {
      for (const wreck of message.wrecks) this.recentWrecks.push(wreck);
      if (this.recentWrecks.length > RECENT_WRECK_LIMIT) {
        this.recentWrecks.splice(0, this.recentWrecks.length - RECENT_WRECK_LIMIT);
      }
      this._emit('wrecks', message.wrecks);
    }
    if (message.warWrecks?.length) this._emit('war-wrecks', message.warWrecks);
    this._emit('tick', message);
    if (message.market) this._emit('market', this);
  }

  _applyMarket(data, stockSeq) {
    const tables = this.tables;
    if (!tables) return;
    const resourceCount = tables.resources.length;
    tables.stations.forEach((entry, stationIndex) => {
      const mirror = this.market.get(entry.id);
      if (!mirror) return;
      for (let r = 0; r < resourceCount; r++) {
        const key = tables.resources[r];
        const offset = (stationIndex * resourceCount + r) * MARKET_STRIDE;
        mirror.resources[key] = data[offset + MARKET_FIELD.STOCK];
        mirror.capacity[key] = data[offset + MARKET_FIELD.CAPACITY];
        const duress = data[offset + MARKET_FIELD.DURESS];
        if (duress > 0) mirror.duress[key] = duress;
        else delete mirror.duress[key];
        mirror.bid[key] = data[offset + MARKET_FIELD.BID];
        mirror.ask[key] = data[offset + MARKET_FIELD.ASK];
      }
    });
    // Zmiany gry, których ten stan jeszcze nie zawiera, nakładamy ponownie.
    this._pendingStock = this._pendingStock.filter(entry => entry.seq > stockSeq);
    for (const entry of this._pendingStock) applyToMirror(this.market.get(entry.stationId), entry.bag);
  }

  _applyBubble(bubble) {
    if (Array.isArray(bubble.hulls)) this.hulls = bubble.hulls;
    this.courses = {
      data: bubble.data instanceof Float64Array ? bubble.data : new Float64Array(0),
      count: Number(bubble.count) || 0,
      clock: Number(bubble.clock) || 0,
      time: Number(bubble.time) || 0
    };
  }

  // ============================================================
  // Odczyt
  // ============================================================

  /** Czy świat ruchu zna tę stację (planety gry tak, misyjna kryjówka nie). */
  hasStation(stationId) {
    return this.market.has(String(stationId || ''));
  }

  /**
   * Kopia magazynu stacji w kształcie `econ` gry (`resources`, `capacity`,
   * `duress`) — terminal handlu i `resourcePrice` czytają ją bez zmian.
   * `null`, zanim przyjdzie `ready`, albo dla stacji spoza świata.
   */
  getEconomy(stationId) {
    return this.market.get(String(stationId || '')) || null;
  }

  /** Opis stacji z tabeli `ready` (`id`, `name`, `factionId`, `x`, `y`, `moon`…). */
  getStation(stationId) {
    const index = this.stationIndex.get(String(stationId || ''));
    return index === undefined ? null : this.tables.stations[index];
  }

  /**
   * Położenie kursu nr `index` z bufora bańki w chwili `time` (domyślnie teraz).
   * `out` dostaje `x`, `y`, `moving`.
   */
  coursePosition(index, out = {}, time = this.time) {
    const data = this.courses.data;
    const offset = index * COURSE_STRIDE;
    const dur = data[offset + COURSE_FIELD.DUR];
    const t = dur > 0 ? Math.min(1, Math.max(0, (time - data[offset + COURSE_FIELD.T0]) / dur)) : 1;
    const x0 = data[offset + COURSE_FIELD.X0];
    const y0 = data[offset + COURSE_FIELD.Y0];
    out.x = x0 + (data[offset + COURSE_FIELD.X1] - x0) * t;
    out.y = y0 + (data[offset + COURSE_FIELD.Y1] - y0) * t;
    out.moving = dur > 0 && t < 1;
    return out;
  }

  /** Klasa jednostki kursu nr `index` z bufora bańki (`container_ship` itd.). */
  courseHull(index) {
    return this.hulls[this.courses.data[index * COURSE_STRIDE + COURSE_FIELD.HULL]] || '';
  }

  /**
   * Id stanowiska kursu nr `index` — to samo, co w układach doków gry
   * (`earth:K7-1:…`, `earth:Z-01:…`) — albo `null`, gdy kurs czeka w kolejce
   * lub jest w drodze.
   */
  courseBerth(index) {
    const offset = index * COURSE_STRIDE;
    const port = this.courses.data[offset + COURSE_FIELD.PORT];
    const berth = this.courses.data[offset + COURSE_FIELD.BERTH];
    if (!(port >= 0) || !(berth >= 0) || !this.tables) return null;
    const stationId = this.tables.stations[port]?.id;
    return this.tables.berths[stationId]?.[berth] || null;
  }

  /** Ms spędzone na głównym wątku od ostatniego odczytu — wiersz PerfHUD. */
  takeMainThreadMs() {
    const value = this._mainMs;
    this._mainMs = 0;
    return value;
  }

  getStats() {
    return {
      mode: this.mode,
      ready: this.ready,
      failed: this.failed,
      fallbackReason: this.fallbackReason,
      seed: this.seed,
      buildMs: this.buildMs,
      time: this.time,
      clock: this.clock,
      courses: this.courses.count,
      pendingStock: this._pendingStock.length,
      stats: this.stats,
      lastError: this.lastError
    };
  }

  // ============================================================
  // Zdarzenia
  // ============================================================

  /** `ready`, `tick`, `market`, `bubble`, `wrecks`, `war-wrecks`, `error`. Zwraca wypisanie. */
  on(type, listener) {
    if (typeof listener !== 'function') return () => {};
    let list = this.listeners.get(type);
    if (!list) this.listeners.set(type, list = new Set());
    list.add(listener);
    return () => list.delete(listener);
  }

  _emit(type, payload) {
    const list = this.listeners.get(type);
    if (!list) return;
    for (const listener of list) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[TrafficBridge] słuchacz „${type}” rzucił:`, error);
      }
    }
  }

  // ============================================================
  // Pomiar kosztu na głównym wątku
  // ============================================================

  // W trybie awaryjnym odbiór wiadomości dzieje się WEWNĄTRZ `advance` —
  // liczymy tylko najbardziej zewnętrzny poziom, żeby nie dublować czasu.
  _enter() {
    if (this._depth++ === 0) this._t0 = now();
  }

  _leave() {
    if (--this._depth === 0) this._mainMs += now() - this._t0;
  }

  dispose() {
    try { this.worker?.terminate(); } catch { /* bez znaczenia */ }
    this.worker = null;
    this.core = null;
    for (const pending of this._pending.values()) pending.reject(new Error('TrafficBridge zamknięty'));
    this._pending.clear();
    this.ready = false;
    this.listeners.clear();
  }
}

export function createTrafficBridge(options) {
  return new TrafficBridge(options);
}
