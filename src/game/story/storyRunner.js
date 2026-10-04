// ============================================================
// Reżyser fabuły (2026-09-30) — wykonawca skryptów misji. Bez DOM i three (testy w node).
//
// Skrypt misji to zwykła funkcja async, która czeka na CZAS GRY, warunki i zdarzenia:
//
//   async function misja(ctx) {
//     ctx.phase('dok');
//     await ctx.wait(2);                                  // sekundy gry (pauza je zatrzymuje)
//     await ctx.until(() => statekPozaHala());            // warunek sprawdzany co tick
//     const e = await ctx.event('npcKilled', (d) => d.npc.__storyTag === 'parked');
//     const bg = ctx.spawn(async (sub) => { … });         // równoległy wątek (np. licznik zabić)
//     bg.cancel();
//   }
//
//   const runner = createStoryRunner();
//   runner.start(misja, api);     // api trafia do ctx.api
//   runner.tick(dt);              // co klatkę gry (dt = 0 w pauzie — czekanie stoi)
//   runner.emit('npcKilled', { npc });   // haki gry
//   runner.cancel();              // przerwanie (nowa gra, porażka) — oczekujące await rzucają StoryCancelled
//
// Warunki (`until`) liczone są w tick() — kontynuacje skryptu idą w mikrozadaniach zaraz po nim, więc skrypt
// widzi stan gry z tej samej klatki. Wyjątek w warunku = fałsz (log raz), nie wywraca misji.
// ============================================================

export class StoryCancelled extends Error {
  constructor(reason = 'cancel') {
    super(`story cancelled: ${reason}`);
    this.name = 'StoryCancelled';
    this.reason = reason;
  }
}

export function isStoryCancelled(err) {
  return !!err && (err instanceof StoryCancelled || err.name === 'StoryCancelled');
}

/**
 * Jeden kontekst = jeden wątek skryptu (główny albo `spawn`). Anulowanie wątku rzuca w jego
 * oczekujących await; anulowanie rodzica anuluje dzieci.
 */
class StoryContext {
  constructor(runner, api, parent = null) {
    this.runner = runner;
    this.api = api;
    this.parent = parent;
    this.children = new Set();
    this.cancelled = false;
    this.cancelReason = null;
    this._pending = new Set();
    this.done = null;          // Promise wątku (ustawia runner)
  }

  get time() { return this.runner.time; }

  _check() {
    if (this.cancelled) throw new StoryCancelled(this.cancelReason || 'cancel');
  }

  _add(entry) {
    this._check();
    this._pending.add(entry);
    this.runner._pending.add(entry);
    entry.ctx = this;
    return entry.promise;
  }

  _makeEntry(kind) {
    const entry = { kind, ctx: null, resolve: null, reject: null, promise: null };
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    return entry;
  }

  /** Czeka `sec` sekund czasu gry. */
  wait(sec) {
    const entry = this._makeEntry('wait');
    entry.until = this.runner.time + Math.max(0, Number(sec) || 0);
    return this._add(entry);
  }

  /**
   * Czeka, aż pred() zwróci prawdę (wartość prawdziwa wraca z await). opts.timeout (s gry) —
   * po nim await zwraca `opts.onTimeout` (domyślnie null) zamiast wartości warunku.
   */
  until(pred, opts = {}) {
    this._check();
    const entry = this._makeEntry('until');
    entry.pred = pred;
    entry.deadline = Number.isFinite(opts.timeout) ? this.runner.time + Math.max(0, opts.timeout) : Infinity;
    entry.timeoutValue = opts.onTimeout === undefined ? null : opts.onTimeout;
    // Warunek spełniony od razu — bez czekania na tick (skrypt nie traci klatki).
    const v = this.runner._safePred(entry);
    if (v) return Promise.resolve(v);
    return this._add(entry);
  }

  /** Czeka na zdarzenie gry (runner.emit) spełniające filtr; zwraca jego dane. */
  event(name, filter = null, opts = {}) {
    const entry = this._makeEntry('event');
    entry.name = String(name);
    entry.filter = typeof filter === 'function' ? filter : null;
    entry.deadline = Number.isFinite(opts.timeout) ? this.runner.time + Math.max(0, opts.timeout) : Infinity;
    entry.timeoutValue = opts.onTimeout === undefined ? null : opts.onTimeout;
    return this._add(entry);
  }

  /** Czeka na dowolną z obietnic (np. warunek albo zdarzenie); zwraca { index, value }. */
  async race(promises) {
    this._check();
    return Promise.race(promises.map((p, index) => Promise.resolve(p).then((value) => ({ index, value }))));
  }

  /** Nazwa bieżącej fazy (dziennik, skoki dev, zapis postępu). */
  phase(name) {
    this._check();
    this.runner._setPhase(String(name));
  }

  /** Równoległy wątek skryptu; zwraca uchwyt { done, cancel() }. Błąd wątku (poza anulowaniem) idzie do logu. */
  spawn(fn) {
    this._check();
    const child = new StoryContext(this.runner, this.api, this);
    this.children.add(child);
    child.done = Promise.resolve()
      .then(() => fn(child))
      .catch((err) => {
        if (!isStoryCancelled(err)) this.runner._report(err);
        return undefined;
      })
      .finally(() => { this.children.delete(child); });
    return { done: child.done, cancel: (reason) => child.cancel(reason), ctx: child };
  }

  cancel(reason = 'cancel') {
    if (this.cancelled) return;
    this.cancelled = true;
    this.cancelReason = reason;
    for (const child of this.children) child.cancel(reason);
    for (const entry of this._pending) {
      this.runner._pending.delete(entry);
      entry.reject(new StoryCancelled(reason));
    }
    this._pending.clear();
  }
}

export function createStoryRunner(opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : (msg, err) => { if (typeof console !== 'undefined') console.warn(msg, err); };
  const runner = {
    time: 0,
    phaseName: null,
    phaseAt: 0,
    running: false,
    result: undefined,
    error: null,
    root: null,
    onPhase: typeof opts.onPhase === 'function' ? opts.onPhase : null,
    _pending: new Set(),
    _predErrors: new WeakSet(),

    /** Uruchamia skrypt (poprzedni anuluje). Zwraca Promise wyniku skryptu (null przy anulowaniu). */
    start(script, api = null) {
      this.cancel('restart');
      this.time = 0;
      this.phaseName = null;
      this.phaseAt = 0;
      this.result = undefined;
      this.error = null;
      this.running = true;
      const ctx = new StoryContext(this, api);
      this.root = ctx;
      ctx.done = Promise.resolve()
        .then(() => script(ctx))
        .then((value) => { if (this.root === ctx) { this.result = value; } return value; })
        .catch((err) => {
          if (isStoryCancelled(err)) return null;
          if (this.root === ctx) this.error = err;
          this._report(err);
          return null;
        })
        .finally(() => { if (this.root === ctx) this.running = false; });
      return ctx.done;
    },

    /** Krok czasu gry. dt = 0 (pauza) — czekanie stoi, warunki i tak są sprawdzane (np. okno dialogu). */
    tick(dt) {
      this.time += Math.max(0, Number(dt) || 0);
      if (this._pending.size === 0) return;
      for (const entry of Array.from(this._pending)) {
        if (!this._pending.has(entry)) continue;
        if (entry.kind === 'wait') {
          if (this.time >= entry.until) this._settle(entry, true);
        } else if (entry.kind === 'until') {
          const v = this._safePred(entry);
          if (v) this._settle(entry, v);
          else if (this.time >= entry.deadline) this._settle(entry, entry.timeoutValue);
        } else if (entry.kind === 'event') {
          if (this.time >= entry.deadline) this._settle(entry, entry.timeoutValue);
        }
      }
    },

    /** Zdarzenie gry → oczekujące `ctx.event` o tej nazwie (z filtrem). Zwraca liczbę obudzonych. */
    emit(name, data = {}) {
      if (this._pending.size === 0) return 0;
      let woke = 0;
      const key = String(name);
      for (const entry of Array.from(this._pending)) {
        if (entry.kind !== 'event' || entry.name !== key || !this._pending.has(entry)) continue;
        let ok = true;
        if (entry.filter) {
          try { ok = !!entry.filter(data); } catch (err) { ok = false; this._report(err); }
        }
        if (ok) { this._settle(entry, data); woke++; }
      }
      return woke;
    },

    cancel(reason = 'cancel') {
      const root = this.root;
      if (root) root.cancel(reason);
      this.root = null;
      this.running = false;
    },

    get pendingCount() { return this._pending.size; },

    _settle(entry, value) {
      this._pending.delete(entry);
      if (entry.ctx) entry.ctx._pending.delete(entry);
      entry.resolve(value);
    },

    _safePred(entry) {
      try {
        return entry.pred();
      } catch (err) {
        if (!this._predErrors.has(entry.pred)) {
          this._predErrors.add(entry.pred);
          this._report(err);
        }
        return false;
      }
    },

    _setPhase(name) {
      this.phaseName = name;
      this.phaseAt = this.time;
      if (this.onPhase) {
        try { this.onPhase(name); } catch (err) { this._report(err); }
      }
    },

    _report(err) { log('[Fabuła] błąd skryptu misji', err); }
  };
  return runner;
}
