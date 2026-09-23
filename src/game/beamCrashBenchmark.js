// Pomiar obejmuje również klatki, w których pętla odrzuciła zaległy czas.
// FPS bez tempa symulacji potrafi ukryć, że fizyka działa w zwolnionym tempie.
export class BeamCrashBenchmark {
  constructor(durationMs = 10000) {
    this.durationMs = durationMs;
    this.samples = new Float32Array(16384);
    this.reset();
  }

  reset() {
    this.running = false;
    this.finished = false;
    this.frames = this.wallMs = this.simMs = this.droppedMs = this.maxFrameMs = this.sampleCount = 0;
    this.physicsMs = this.syncMs = this.renderMs = this.p95 = 0;
  }

  start() { this.reset(); this.running = true; }

  record(frameMs, simulatedMs, droppedMs, physicsMs, syncMs, renderMs) {
    if (!this.running) return;
    this.frames++;
    this.wallMs += frameMs;
    this.simMs += simulatedMs;
    this.droppedMs += droppedMs;
    this.physicsMs += physicsMs;
    this.syncMs += syncMs;
    this.renderMs += renderMs;
    this.maxFrameMs = Math.max(this.maxFrameMs, frameMs);
    if (this.sampleCount < this.samples.length) this.samples[this.sampleCount++] = frameMs;
    if (this.wallMs >= this.durationMs) this.finish();
  }

  finish() {
    if (!this.frames) { this.running = false; return; }
    this.running = false;
    this.finished = true;
    const sorted = this.samples.subarray(0, this.sampleCount).sort();
    this.p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  }

  get fps() { return this.wallMs > 0 ? this.frames * 1000 / this.wallMs : 0; }
  get simulationRate() { return this.wallMs > 0 ? this.simMs / this.wallMs : 0; }
}
