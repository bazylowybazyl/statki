/**
 * Deterministyczny rytm rzadszych systemow oparty o ticki stalej fizyki.
 * Nie uzywa czasu renderu, wiec monitor 60/144/240 Hz nie zmienia czestotliwosci.
 */
export class FixedStepCadence {
  constructor(baseHz, targetHz) {
    const base = Number(baseHz);
    const target = Number(targetHz);
    if (!Number.isFinite(base) || base <= 0) {
      throw new RangeError('baseHz must be a positive finite number');
    }
    if (!Number.isFinite(target) || target <= 0) {
      throw new RangeError('targetHz must be a positive finite number');
    }

    this.baseHz = base;
    this.intervalTicks = Math.max(1, Math.round(base / target));
    this.hz = base / this.intervalTicks;
    this.dt = this.intervalTicks / base;
  }

  phase(tickId) {
    const tick = Math.trunc(Number(tickId));
    if (!Number.isFinite(tick) || tick <= 0) return -1;
    return (tick - 1) % this.intervalTicks;
  }

  isDue(tickId) {
    return this.phase(tickId) === 0;
  }
}
