// src/3d/rozgrzewka.js
//
// Rozgrzewka pipeline'ów WebGPU — rejestr (port WebGPU, zadanie 11; PLAN §6, agents.md § „Rozgrzewka
// pipeline'ów”). Jeden egzemplarz na grę: `Core3D.warmup`.
//
// Pierwszy rysunek nowego materiału w WebGPU to (1) budowa NodeBuilder na CPU (graf TSL → WGSL: od ~1 do
// ~180 ms na materiał, niepodzielna) i (2) pipeline. Zwykły render tworzy pipeline SYNCHRONICZNIE
// (createRenderPipeline): proces GPU kompiluje shader, a strona czeka na niego przy najbliższym zapisie do
// kolejki — pierwsza klatka ringu Ziemi w menu stała 5,8 s. compileAsync robi to samo w tle
// (createRenderPipelineAsync): cały ring Marsa 0,14 s CPU i 0,5 s w tle, klatki menu bez przestoju.
// Klucz materiału i pipeline'u zależy od grafu materiału, układu atrybutów geometrii, celu (format, próbki,
// głębia — RenderContext three), świateł passa, typu kamery i stanu (mieszanie, głębia, strona), dlatego
// rozgrzewa się PRAWDZIWE obiekty w PRAWDZIWYM celu: composerTarget (warstwa DIST — distortionTarget),
// kamera typu passa warstwy (ortho / perspektywa), światła sceny Core3D (compileAsync(siatka, kamera,
// Core3D.scene) — ten sam klucz NodeBuilder co w passie gry, render bierze gotowy stan i pipeline).
//
// Moduł zgłasza, CO rozgrzać — jedną linią (przy imporcie modułu też: wpisy czekają na urządzenie, a funkcja
// `objects` woła się dopiero w chwili rozgrzewki, więc pule tworzone leniwie mogą powstać właśnie wtedy):
//
//   Core3D.warmup.add({ name: 'dysze SIDE', objects: () => EngineExhaustBatch.warmupMeshes() });
//
// Wpis: { name, objects, layer?, camera?, visible?, variant?, target?, scene?, split?, override? }
//   objects  — Object3D | Object3D[] | () => (Object3D | Object3D[] | null). Każda siatka poddrzewa (Mesh, Line,
//              Points, Sprite z materiałem) to osobne zadanie; funkcja zwracająca pustkę = wpis czeka na flush().
//   layer    — warstwa passa: liczba (kamera typu passa tej warstwy; siatki spoza niej pominięte), 'all'
//              (kamera ze wszystkimi warstwami — obiekty jeszcze nie w passie, np. bryły ringu przed
//              podpięciem); brak = najniższa warstwa siatki.
//   camera   — własna kamera (np. kinowa tła menu); ortho — wymuszenie typu kamery passa.
//   visible  — domyślnie true: siatka widoczna na czas kompilacji (projekcja three jest synchroniczna, stan
//              wraca zaraz po wywołaniu); false — tylko to, co już widać (łańcuch rodziców) — przegląd sceny.
//   variant  — drugi stan materiału: { apply(siatka) → funkcja przywracająca } (np. dach K-7 przezroczysty:
//              ten sam graf, inny pipeline).
//   target / scene — cel (RenderTarget albo funkcja) i scena świateł (null = sam obiekt, np. QuadMesh passa
//              pełnoekranowego); split: false — obiekt w całości jednym wywołaniem (bez cullingu poddrzewa);
//              override — materiał zastępczy sceny na czas kompilacji (pre-pass głębi halo).
//   phase    — 'loading': dopiero na ekranie ładowania (flush) — dla obiektów, które gra tworzy przy starcie
//              rozgrywki (pule, które `objects()` musiałoby utworzyć wcześniej niż gra).
//   alive    — () => bool: false = właściciel zwolnił obiekty (tło menu zatrzymane, ring przebudowany) —
//              reszta zadań wpisu przepada.
//   shadow   — true: pass MAPY CIENIA słońca zamiast passa sceny (zadanie 25a) — siatki z castShadow, każda przez
//              Core3D.prewarmShadowPass (kontekst passa cienia gry: cel mapy, kamera cienia, materiał zastępczy
//              cienia, głębokość wywołania). `fallback(siatka)` — gdy ta droga niedostępna (false), np. rozgrzewka
//              rysunkiem. Rozgrzana siatka pamiętana osobno od passa sceny.
// QuadMesh (pełnoekranowy pass) rozgrzewa się własną kamerą, bez świateł sceny, w podanym celu (`target`).
//
// Kolejność: `now()` (pilne — np. ring i Ziemia tła menu przed jego pierwszą klatką, bryły nowego ringu przed
// podpięciem) przed `add()`. W tle, w wolnych chwilach (requestIdleCallback), po jednym zadaniu na raz — budowa
// NodeBuilder jest synchroniczna; pipeline'y kompilują się w tle GPU. `flush()` (ekran ładowania) dokańcza
// kolejkę bez czekania na bezczynność i czeka na pipeline'y (limit czasu). Siatka z tym samym materiałem
// rozgrzana raz (bez wariantu) nie wraca do kolejki.

// three r183: compileAsync bierze do klucza pipeline'u głębię i szablon RENDERERA (renderer.depth / stencil), a
// zwykły render — CELU (renderTarget.depthBuffer / stencilBuffer). Na celu bez bufora głębi (pieczenie map i detalu
// ringu, maska słońca, DIST) rozgrzewka robiła pipeline z Depth24Plus, a pierwszy prawdziwy rysunek — drugi,
// synchronicznie (przestój). Renderer dostaje stan bieżącego celu na czas wywołania (część synchroniczna
// compileAsync czyta te pola od razu). Każde compileAsync na celu innym niż ekran — przez tę funkcję.
export function compileAsyncNaCelu(renderer, scene, camera, targetScene = null) {
  const target = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
  if (!target || !('depth' in renderer)) return renderer.compileAsync(scene, camera, targetScene);
  const depth = renderer.depth;
  const stencil = renderer.stencil;
  renderer.depth = target.depthBuffer !== false;
  renderer.stencil = target.stencilBuffer === true;
  try {
    return renderer.compileAsync(scene, camera, targetScene);
  } finally {
    renderer.depth = depth;
    renderer.stencil = stencil;
  }
}

const MESHY = (o) => (o.isMesh || o.isLine || o.isPoints || o.isSprite) && !!o.material;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const lowestLayer = (mask) => {
  for (let b = 0; b < 32; b++) if ((mask >>> b) & 1) return b;
  return -1;
};
const LISTA_MAX = 96;

export class Rozgrzewka {
  /** core — Core3D (renderer, scene, composerTarget, warmupCamera(layer), warmupTarget(layer)). */
  constructor(core) {
    this.core = core;
    this.ready = false;
    this._urgent = [];
    this._normal = [];
    this._waiting = [];          // wpisy z pustymi obiektami — ponownie przy flush()
    this._pending = new Set();   // obietnice compileAsync w locie
    this._done = new WeakMap();  // siatka → Set(materiał) — rozgrzane bez wariantu
    this._donePersp = new WeakMap(); // to samo z kamerą perspektywy wymuszoną opcją ortho: false (gra 3D)
    this._doneShadow = new WeakMap(); // to samo dla passa mapy cienia (opcja shadow)
    this._scheduled = false;
    this._flushing = 0;
    this._loadingOpen = false;   // po pierwszym flush() wpisy 'loading' idą od razu
    this._current = null;        // wpis run() w toku — track() dopisuje mu obietnice
    this.stats = { wpisy: 0, gotowe: 0, siatki: 0, pominiete: 0, cpuMs: 0, maksZadanieMs: 0, bledy: 0, pierwszeMs: -1, ostatnieMs: -1, lista: [] };
  }

  /** Zgłoszenie (jedna linia w module). Zwraca wpis; wpis.promise → true po rozgrzaniu, false gdy nic do zrobienia. */
  add(spec) {
    return this._enqueue(spec, false);
  }

  /** Pilne: przed zadaniami z add(). Obietnica rozwiązuje się po pipeline'ach tych obiektów (albo false). */
  now(objects, opts = {}) {
    return this._enqueue({ ...opts, objects }, true).promise;
  }

  /** Urządzenie gotowe (Core3D._initGpu) — start pracy w tle. */
  start() {
    if (this.ready) return;
    this.ready = true;
    this._kick();
  }

  /**
   * Istniejąca rozgrzewka modułu (jego funkcja, logika bez zmian) jako wpis rejestru — jedno miejsce z pomiarem:
   * `fn()` idzie OD RAZU (tam, gdzie dotąd wołał ją właściciel), jej czas CPU i kompilacje zlecone w trakcie
   * (`Core3D.prewarmPass` → track, zwrócona obietnica) liczą się do wpisu, flush() czeka na nie. Kroki Core3D.fx
   * (`warm`) idą tędy same (FxFrame._warmStep); inna rozgrzewka modułu — jedna linia:
   *   Core3D.warmup.run('tarcze', () => prewarmShields3D());
   * Wyjątek z fn leci dalej (właściciel loguje jak dotąd). Wpis w stats.lista: { nazwa, cpuMs, ms, t }.
   */
  run(name, fn) {
    const entry = { name: String(name || 'bez nazwy'), t0: nowMs(), promises: [] };
    this.stats.wpisy++;
    const prev = this._current;
    this._current = entry;
    let ret;
    try {
      ret = fn();
    } finally {
      this._current = prev;
      const cpu = nowMs() - entry.t0;
      this.stats.cpuMs += cpu;
      if (cpu > this.stats.maksZadanieMs) this.stats.maksZadanieMs = +cpu.toFixed(1);
      if (ret && typeof ret.then === 'function') entry.promises.push(this.track(ret).then(() => true, () => false));
      Promise.all(entry.promises).then(() => {
        const end = nowMs();
        this.stats.gotowe++;
        this.stats.ostatnieMs = +end.toFixed(1);
        this._list({ nazwa: entry.name, cpuMs: +cpu.toFixed(1), ms: +(end - entry.t0).toFixed(1), t: +entry.t0.toFixed(1), modul: true });
      });
    }
    return ret;
  }

  /**
   * Kompilacja spoza kolejki (Core3D.prewarmPass — kadłuby, tarcze, kroki efektów): flush() czeka i na nią (pierwsza
   * klatka gry zapisująca do kolejki, gdy proces GPU jeszcze kompiluje, staje na nim); w trakcie run() liczy się do wpisu.
   */
  track(promise) {
    if (!promise || typeof promise.then !== 'function') return promise;
    const tracked = Promise.resolve(promise).then(() => true, () => false);
    this._pending.add(tracked);
    tracked.then(() => this._pending.delete(tracked));
    if (this._current) this._current.promises.push(tracked);
    return promise;
  }

  _list(row) {
    const list = this.stats.lista;
    list.push(row);
    if (list.length > LISTA_MAX) list.shift();
    // Sumy per grupa (nazwa do dwukropka; zadanie 25a — koszt ekranu ładowania po modułach, lista trzyma tylko ostatnie wpisy)
    const name = String(row.nazwa || '');
    const cut = name.indexOf(':');
    const key = cut > 0 ? name.slice(0, cut) : name;
    const g = this.stats.grupy || (this.stats.grupy = {});
    const s = g[key] || (g[key] = { wpisy: 0, siatki: 0, cpuMs: 0 });
    s.wpisy++;
    s.siatki += row.siatki || 0;
    s.cpuMs = +(s.cpuMs + (row.cpuMs || 0)).toFixed(1);
  }

  /** Czy coś czeka albo kompiluje się w tle. */
  get busy() {
    return this._urgent.length > 0 || this._normal.length > 0 || this._pending.size > 0;
  }

  /**
   * Ekran ładowania: kolejka bez czekania na bezczynność (co ~8 ms oddaje wątek — tło menu rysuje dalej), także
   * wpisy, które wcześniej nie miały obiektów, potem pipeline'y w locie. Limit czasu — gra rusza i tak (obiekt
   * z niegotowym pipeline'em pominie Core3D kilka klatek, bez przestoju).
   */
  async flush({ timeoutMs = 8000 } = {}) {
    const core = this.core;
    if (!this.ready) {
      if (core?.gpuUnsupported) return this.stats;
      const ok = await core?.ready;
      if (!ok) return this.stats;
    }
    this._loadingOpen = true;
    if (this._waiting.length) {
      for (const e of this._waiting.splice(0)) {
        e.state = 'czeka';
        (e.urgent ? this._urgent : this._normal).push(e);
      }
    }
    const t0 = nowMs();
    const cpu0 = this.stats.cpuMs;
    const siatki0 = this.stats.siatki;
    this._flushing++;
    try {
      let slice = nowMs();
      while (this._urgent.length || this._normal.length) {
        if (!this._step()) break;
        if (nowMs() - t0 > timeoutMs) break;
        if (nowMs() - slice > 8) {
          await new Promise((r) => setTimeout(r, 0));
          slice = nowMs();
        }
      }
      const tQueue = nowMs();
      const left = Math.max(0, timeoutMs - (tQueue - t0));
      if (this._pending.size) {
        let timer = 0;
        await Promise.race([
          Promise.allSettled([...this._pending]),
          new Promise((r) => { timer = setTimeout(r, left); })
        ]);
        clearTimeout(timer);
      }
      // Ekran ładowania (zadanie 25a — pomiar): czas flush(), w tym kolejka (CPU budów) i czekanie na pipeline'y
      // w tle; `wLocie` > 0 = limit czasu minął przed ostatnim pipeline'em.
      const end = nowMs();
      this.stats.flush = {
        t: +t0.toFixed(1), ms: +(end - t0).toFixed(1), kolejkaMs: +(tQueue - t0).toFixed(1),
        cpuMs: +(this.stats.cpuMs - cpu0).toFixed(1), siatki: this.stats.siatki - siatki0, wLocie: this._pending.size
      };
    } finally {
      this._flushing--;
      this._kick();
    }
    return this.stats;
  }

  // ---------------------------------------------------------------------------
  _enqueue(spec, urgent) {
    const entry = {
      name: String(spec?.name || 'bez nazwy'),
      spec: spec || {},
      urgent: !!urgent,
      state: 'czeka',
      meshes: null,
      index: 0,
      promises: [],
      siatki: 0,
      cpuMs: 0,
      t0: -1,
      ms: -1,
      promise: null,
      _resolve: null
    };
    entry.promise = new Promise((resolve) => { entry._resolve = resolve; });
    this.stats.wpisy++;
    // bez WebGPU (komunikat w menu) nic się nie skompiluje — obietnica od razu
    if (this.core?.gpuUnsupported) {
      entry.state = 'puste';
      entry._resolve(false);
      return entry;
    }
    if (entry.spec.phase === 'loading' && !this._loadingOpen) {
      entry.state = 'ładowanie';
      entry.retried = true;
      this._waiting.push(entry);
      return entry;
    }
    (urgent ? this._urgent : this._normal).push(entry);
    this._kick();
    return entry;
  }

  _kick() {
    if (this._scheduled || !this.ready || this._flushing > 0) return;
    if (!this._urgent.length && !this._normal.length) return;
    this._scheduled = true;
    const run = (deadline) => {
      this._scheduled = false;
      const t0 = nowMs();
      // Co najmniej jedno zadanie na wywołanie; dalej, póki starcza wolnego czasu (≈ 6 ms zapasu).
      do {
        if (!this._step()) break;
      } while (deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() > 6 : nowMs() - t0 < 6);
      this._kick();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 200 });
    else setTimeout(() => run(null), 16);
  }

  // Jedno zadanie (jedna siatka albo cały obiekt przy split: false). false = kolejka pusta.
  _step() {
    const queue = this._urgent.length ? this._urgent : this._normal;
    const entry = queue[0];
    if (!entry) return false;
    if (!this.core?.renderer) return false;
    if (entry.meshes === null) {
      entry.meshes = this._expand(entry);
      entry.t0 = nowMs();
      if (this.stats.pierwszeMs < 0) this.stats.pierwszeMs = +entry.t0.toFixed(1);
      if (!entry.meshes.length) {
        queue.shift();
        const lazy = typeof entry.spec.objects === 'function';
        entry.state = lazy ? 'puste' : 'gotowe';
        if (lazy && !entry.retried) {
          entry.retried = true;
          entry.meshes = null;
          this._waiting.push(entry);
          if (entry.urgent) entry._resolve(false);
        } else {
          entry._resolve(false);
        }
        return true;
      }
      entry.state = 'trwa';
    }
    const target = entry.meshes[entry.index++];
    if (target) this._compileOne(entry, target);
    if (entry.index >= entry.meshes.length) {
      queue.shift();
      this._finish(entry);
    }
    return true;
  }

  _expand(entry) {
    const spec = entry.spec;
    let objs = spec.objects;
    if (typeof objs === 'function') {
      try {
        objs = objs();
      } catch (err) {
        console.warn(`[Core3D.warmup] „${entry.name}”: obiekty nie powstały —`, err?.message || err);
        objs = null;
      }
    }
    const roots = (Array.isArray(objs) ? objs : [objs]).filter((o) => o && o.isObject3D);
    if (spec.split === false) return roots;
    const layer = spec.layer;
    const onLayer = Number.isInteger(layer) ? (o) => ((o.layers.mask >>> layer) & 1) === 1 : () => true;
    const out = [];
    const seen = new Set();
    const take = (o) => {
      if (!MESHY(o) || seen.has(o) || !onLayer(o)) return;
      if (spec.visible !== false && o.material?.visible === false) return;
      // pass mapy cienia rysuje tylko obiekty z castShadow (funkcja renderu obiektu cienia three)
      if (spec.shadow && o.castShadow !== true) return;
      seen.add(o);
      out.push(o);
    };
    for (const root of roots) {
      if (spec.visible === false) root.traverseVisible(take);
      else root.traverse(take);
    }
    return out;
  }

  _alreadyDone(mesh, done = this._done) {
    const set = done.get(mesh);
    if (!set) return false;
    const m = mesh.material;
    if (Array.isArray(m)) return m.every((x) => set.has(x));
    return set.has(m);
  }

  _markDone(mesh, done = this._done) {
    let set = done.get(mesh);
    if (!set) { set = new Set(); done.set(mesh, set); }
    const m = mesh.material;
    if (Array.isArray(m)) for (const x of m) set.add(x);
    else set.add(m);
  }

  // Pass mapy cienia (opcja shadow): Core3D.prewarmShadowPass — kontekst i materiał zastępczy passa cienia gry.
  // Siatka bez drogi (false) → `fallback` wpisu, jeśli jest (np. rozgrzewka rysunkiem).
  _compileShadow(entry, obj) {
    const spec = entry.spec;
    const core = this.core;
    if (!spec.variant && this._alreadyDone(obj, this._doneShadow)) {
      this.stats.pominiete++;
      return;
    }
    if (typeof spec.alive === 'function' && !spec.alive()) return;
    const t0 = nowMs();
    let promise;
    try {
      promise = Promise.resolve(typeof core.prewarmShadowPass === 'function' ? core.prewarmShadowPass(obj) : false);
    } catch (err) {
      promise = Promise.reject(err);
    }
    const ms = nowMs() - t0;
    entry.cpuMs += ms;
    entry.siatki++;
    this.stats.siatki++;
    this.stats.cpuMs += ms;
    if (ms > this.stats.maksZadanieMs) this.stats.maksZadanieMs = +ms.toFixed(1);
    this._markDone(obj, this._doneShadow);
    const tracked = promise.then((ok) => {
      if (ok === true) return true;
      if (typeof spec.fallback === 'function') {
        try { spec.fallback(obj); } catch (err) { console.warn(`[Core3D.warmup] „${entry.name}”: zapas rozgrzewki cienia nie wyszedł —`, err?.message || err); }
      }
      return false;
    }, (err) => {
      this.stats.bledy++;
      if (!entry.failed) {
        entry.failed = true;
        console.warn(`[Core3D.warmup] „${entry.name}”: kompilacja passa cienia nie wyszła —`, err?.message || err);
      }
      return false;
    });
    this._pending.add(tracked);
    tracked.then(() => this._pending.delete(tracked));
    entry.promises.push(tracked);
  }

  // compileAsync jednej siatki (albo obiektu) z celem, kamerą i widocznością na czas wywołania — projekcja three
  // idzie synchronicznie (NodeBuilder, programy, zlecenie pipeline'u), dalej czeka się tylko na GPU.
  _compileOne(entry, obj) {
    const spec = entry.spec;
    if (spec.shadow) return this._compileShadow(entry, obj);
    const core = this.core;
    const renderer = core.renderer;
    const split = spec.split !== false;
    const doneMap = spec.ortho === false ? this._donePersp : this._done;
    if (split && !spec.variant && this._alreadyDone(obj, doneMap)) {
      this.stats.pominiete++;
      return;
    }
    if (typeof spec.alive === 'function' && !spec.alive()) return;
    const layer = spec.layer === 'all' ? 'all'
      : (Number.isInteger(spec.layer) ? spec.layer : lowestLayer(obj.layers.mask));
    if (layer === -1) return;
    // QuadMesh (pełnoekranowy pass): własna kamera, bez świateł sceny — jak QuadMesh.render().
    const quad = obj.isQuadMesh === true;
    const camera = spec.camera || (quad ? obj.camera : core.warmupCamera(layer, spec.ortho));
    const target = typeof spec.target === 'function' ? spec.target() : (spec.target || core.warmupTarget(layer));
    const scene = spec.scene === null || quad ? null : (spec.scene || core.scene);
    const prevMask = camera.layers.mask;
    const prevTarget = renderer.getRenderTarget();
    const prevVisible = obj.visible;
    const prevCulled = obj.frustumCulled;
    const prevOverride = spec.override && obj.isScene ? obj.overrideMaterial : undefined;
    // Cały obiekt jednym wywołaniem: culling wyłączony w poddrzewie (compileAsync pomija obiekty spoza kadru).
    const culled = [];
    let restoreVariant = null;
    const t0 = nowMs();
    let promise;
    try {
      if (spec.variant && typeof spec.variant.apply === 'function') restoreVariant = spec.variant.apply(obj) || null;
      if (layer === 'all') camera.layers.enableAll();
      else camera.layers.set(layer);
      if (spec.visible !== false) obj.visible = true;
      if (split) obj.frustumCulled = false;
      else obj.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
      if (spec.override && obj.isScene) obj.overrideMaterial = spec.override;
      renderer.setRenderTarget(target || null);
      promise = compileAsyncNaCelu(renderer, obj, camera, scene);
    } catch (err) {
      promise = Promise.reject(err);
    } finally {
      renderer.setRenderTarget(prevTarget);
      if (spec.override && obj.isScene) obj.overrideMaterial = prevOverride;
      for (let i = 0; i < culled.length; i++) culled[i].frustumCulled = true;
      obj.frustumCulled = prevCulled;
      obj.visible = prevVisible;
      camera.layers.mask = prevMask;
      if (restoreVariant) {
        try { restoreVariant(); } catch { /* stan wraca przy najbliższym update() właściciela */ }
      }
    }
    const ms = nowMs() - t0;
    entry.cpuMs += ms;
    entry.siatki++;
    this.stats.siatki++;
    this.stats.cpuMs += ms;
    if (ms > this.stats.maksZadanieMs) this.stats.maksZadanieMs = +ms.toFixed(1);
    if (split && !spec.variant) this._markDone(obj, doneMap);
    const tracked = promise.then(() => true, (err) => {
      this.stats.bledy++;
      if (!entry.failed) {
        entry.failed = true;
        console.warn(`[Core3D.warmup] „${entry.name}”: kompilacja nie wyszła —`, err?.message || err);
      }
      return false;
    });
    this._pending.add(tracked);
    tracked.then(() => this._pending.delete(tracked));
    entry.promises.push(tracked);
  }

  _finish(entry) {
    Promise.all(entry.promises).then((res) => {
      entry.state = 'gotowe';
      const end = nowMs();
      entry.ms = entry.t0 >= 0 ? end - entry.t0 : 0;
      this.stats.gotowe++;
      this.stats.ostatnieMs = +end.toFixed(1);
      this._list({ nazwa: entry.name, siatki: entry.siatki, cpuMs: +entry.cpuMs.toFixed(1), ms: +entry.ms.toFixed(1), t: +entry.t0.toFixed(1), pilne: entry.urgent });
      // pusta lista obietnic = wszystko już rozgrzane wcześniej
      entry._resolve(res.every(Boolean));
    });
  }
}
