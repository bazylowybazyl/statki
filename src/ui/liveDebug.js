// Dwa liczniki "na żywo" do konsoli: RenderLiveDebug mierzy sekcje rysowania,
// AILiveDebug — czasy funkcji AI. Oba zbierają próbki przez N ms i wypisują tabelę.
// Wyciągnięte 1:1 z index.html; sterowanie zostaje na window (konsola devtools).
//
// PerfHUD odświeża swoje przyciski po start/stop — wstrzykujemy go, żeby uniknąć
// cyklu importów między perfHud.js a liveDebug.js.
let perfHud = null;

/** Podpina PerfHUD, którego przyciski mają się odświeżać przy start/stop. */
export function setLiveDebugPerfHud(hud) {
  perfHud = hud || null;
}

export const RenderLiveDebug = {
  enabled: false,
  intervalMs: 1000,
  startedAt: 0,
  lastFlushAt: 0,
  frames: 0,
  frameMsSum: 0,
  frameMsMax: 0,
  bridge: null,
  buckets: Object.create(null),

  reset(intervalMs = null) {
    if (intervalMs != null) this.intervalMs = Math.max(250, Number(intervalMs) || 1000);
    this.frames = 0;
    this.frameMsSum = 0;
    this.frameMsMax = 0;
    this.buckets = Object.create(null);
  },

  start(intervalMs = 1000) {
    this.enabled = true;
    this.intervalMs = Math.max(250, Number(intervalMs) || 1000);
    const now = performance.now();
    this.startedAt = now;
    this.lastFlushAt = now;
    if (!this.bridge) {
      this.bridge = (name, ms) => this.record(name, ms);
    }
    window.__renderDbgRecord = this.bridge;
    this.reset();
    console.log(`[RenderFuncDBG] ON interval=${this.intervalMs}ms`);
    return { enabled: this.enabled, intervalMs: this.intervalMs };
  },

  stop() {
    if (!this.enabled) return { enabled: false, intervalMs: this.intervalMs };
    this.flush(performance.now(), true);
    this.enabled = false;
    if (window.__renderDbgRecord === this.bridge) {
      window.__renderDbgRecord = null;
    }
    this.reset();
    console.log('[RenderFuncDBG] OFF');
    return { enabled: this.enabled, intervalMs: this.intervalMs };
  },

  record(name, ms) {
    if (!this.enabled) return;
    if (!Number.isFinite(ms) || ms < 0) return;
    const key = String(name || '');
    let bucket = this.buckets[key];
    if (!bucket) {
      bucket = this.buckets[key] = { calls: 0, sum: 0, max: 0 };
    }
    bucket.calls++;
    bucket.sum += ms;
    if (ms > bucket.max) bucket.max = ms;
  },

  recordFrame(ms) {
    if (!this.enabled) return;
    if (!Number.isFinite(ms) || ms < 0) return;
    this.frames++;
    this.frameMsSum += ms;
    if (ms > this.frameMsMax) this.frameMsMax = ms;
  },

  flush(now = performance.now(), force = false) {
    if (!this.enabled) return;
    if (!force && (now - this.lastFlushAt) < this.intervalMs) return;

    const fmt = (name) => {
      const b = this.buckets[name];
      if (!b || b.calls <= 0) return '0.000/0.00ms x0';
      return `${(b.sum / b.calls).toFixed(3)}/${b.max.toFixed(2)}ms x${b.calls}`;
    };

    let topName = '';
    let topMs = 0;
    for (const [name, b] of Object.entries(this.buckets)) {
      if ((b?.max || 0) > topMs) {
        topMs = b.max;
        topName = name;
      }
    }

    const elapsed = (now - this.startedAt) / 1000;
    const frameAvg = this.frames > 0 ? (this.frameMsSum / this.frames) : 0;
    console.log(`[RenderFuncDBG ${elapsed.toFixed(1)}s]`, {
      frame: `${frameAvg.toFixed(2)}/${this.frameMsMax.toFixed(2)}ms x${this.frames}`,
      camera: fmt('cameraPrep'),
      warpLens: fmt('warpLens'),
      planets3d: fmt('updatePlanets3D'),
      rings3d: fmt('updatePlanetaryRings3D'),
      stations3d: fmt('updateStations3D'),
      world3d: fmt('updateWorld3D'),
      hexUpdate: fmt('updateHexShips3D'),
      shields3d: fmt('updateShields3D'),
      hexDraw: fmt('drawHexShips3D'),
      coreCall: fmt('coreRenderCall'),
      coreRender: fmt('core3dRenderTotal'),
      coreComposer: fmt('coreComposerRender'),
      coreBloomCfg: fmt('coreBloomConfig'),
      coreHeatCfg: fmt('coreHeatHazeSetup'),
      coreBlit2D: fmt('coreBlit2D'),
      post3D2D: fmt('renderPost3D2D'),
      topSpike: topName ? `${topName}:${topMs.toFixed(2)}ms` : 'n/a'
    });

    this.lastFlushAt = now;
    this.reset();
  }
};

export const AILiveDebug = {
  enabled: false,
  intervalMs: 1000,
  startedAt: 0,
  lastFlushAt: 0,
  frames: 0,
  frameMsSum: 0,
  frameMsMax: 0,
  buckets: Object.create(null),

  reset(intervalMs = null) {
    if (intervalMs != null) this.intervalMs = Math.max(250, Number(intervalMs) || 1000);
    this.frames = 0;
    this.frameMsSum = 0;
    this.frameMsMax = 0;
    this.buckets = Object.create(null);
  },

  start(intervalMs = 1000) {
    this.enabled = true;
    this.intervalMs = Math.max(250, Number(intervalMs) || 1000);
    const now = performance.now();
    this.startedAt = now;
    this.lastFlushAt = now;
    this.reset();
    perfHud?.refreshDebugButtons?.();
    console.log(`[AIFuncDBG] ON interval=${this.intervalMs}ms`);
    return { enabled: true, intervalMs: this.intervalMs };
  },

  stop() {
    if (!this.enabled) return { enabled: false, intervalMs: this.intervalMs };
    this.flush(performance.now(), true);
    this.enabled = false;
    this.reset();
    perfHud?.refreshDebugButtons?.();
    console.log('[AIFuncDBG] OFF');
    return { enabled: false, intervalMs: this.intervalMs };
  },

  record(name, ms) {
    if (!this.enabled) return;
    if (!Number.isFinite(ms) || ms < 0) return;
    const key = String(name || '');
    let bucket = this.buckets[key];
    if (!bucket) bucket = this.buckets[key] = { calls: 0, sum: 0, max: 0 };
    bucket.calls++;
    bucket.sum += ms;
    if (ms > bucket.max) bucket.max = ms;
  },

  recordFrame(ms) {
    if (!this.enabled) return;
    if (!Number.isFinite(ms) || ms < 0) return;
    this.frames++;
    this.frameMsSum += ms;
    if (ms > this.frameMsMax) this.frameMsMax = ms;
  },

  flush(now = performance.now(), force = false) {
    if (!this.enabled) return;
    if (!force && (now - this.lastFlushAt) < this.intervalMs) return;
    const fmt = (name) => {
      const b = this.buckets[name];
      if (!b || b.calls <= 0) return '0.000/0.00ms x0';
      return `${(b.sum / b.calls).toFixed(3)}/${b.max.toFixed(2)}ms x${b.calls}`;
    };
    let topName = '';
    let topMs = 0;
    for (const [name, bucket] of Object.entries(this.buckets)) {
      if ((bucket?.max || 0) > topMs) {
        topMs = bucket.max;
        topName = name;
      }
    }
    const elapsed = (now - this.startedAt) / 1000;
    const frameAvg = this.frames > 0 ? (this.frameMsSum / this.frames) : 0;
    console.log(`[AIFuncDBG ${elapsed.toFixed(1)}s]`, {
      frame: `${frameAvg.toFixed(2)}/${this.frameMsMax.toFixed(2)}ms x${this.frames}`,
      squads: fmt('squads'),
      supportWing: fmt('supportWing'),
      npcStep: fmt('npcStep'),
      npcBrain: fmt('npcBrain'),
      separationForces: fmt('separationForces'),
      weaponTargetScan: fmt('weaponTargetScan'),
      targetPick: fmt('targetPick'),
      pirateMission: fmt('pirateMission'),
      topSpike: topName ? `${topName}:${topMs.toFixed(2)}ms` : 'n/a'
    });
    this.lastFlushAt = now;
    this.reset();
  }
};

/** Wystawia sterowanie oboma licznikami w konsoli przeglądarki. */
export function installLiveDebugConsoleApi() {
  window.RenderDbgStart = (intervalMs = 1000) => RenderLiveDebug.start(intervalMs);
  window.RenderDbgStop = () => RenderLiveDebug.stop();
  window.RenderDbgDump = () => RenderLiveDebug.flush(performance.now(), true);
  window.RenderLiveDebug = RenderLiveDebug;

  window.AILiveDebug = AILiveDebug;
  window.AIFuncDbgStart = (intervalMs = 1000) => AILiveDebug.start(intervalMs);
  window.AIFuncDbgStop = () => AILiveDebug.stop();
  window.AIFuncDbgDump = () => AILiveDebug.flush(performance.now(), true);
}
