const perf = typeof performance !== 'undefined'
  ? performance
  : (typeof require === 'function' ? require('perf_hooks').performance : { now: () => Date.now() });

const ECON = {
  START_CR: 5000,
  BASE_INCOME_PER_GLB: 60,
  AUTO_TRADE: { enabled: true, sellAbove: 0.8, CR_PER_METAL: 1.0, CR_PER_GAS: 1.5 },
  SPAWN_ENABLED: false,
};

const GLB_PLANETS = new Set(['earth', 'mars', 'jupiter', 'neptune']);

const BUILDINGS = {
  Power: {
    key: 'Power',
    cost: { metal: 200, gas: 100 },
    costCR: 1000,
    upkeepCR: 20,
  },
  ShipyardS: {
    key: 'ShipyardS',
    cost: { metal: 150, gas: 0 },
    costCR: 800,
    upkeepCR: 6,
  },
  ShipyardM: {
    key: 'ShipyardM',
    cost: { metal: 260, gas: 60 },
    costCR: 1500,
    upkeepCR: 12,
  },
  ShipyardL: {
    key: 'ShipyardL',
    cost: { metal: 420, gas: 120 },
    costCR: 2800,
    upkeepCR: 22,
  },
  ShipyardCapital: {
    key: 'ShipyardCapital',
    cost: { metal: 640, gas: 220 },
    costCR: 5000,
    upkeepCR: 40,
  },
  StoreS: {
    key: 'StoreS',
    cost: { metal: 90, gas: 0 },
    costCR: 300,
    upkeepCR: 2,
  },
  StoreM: {
    key: 'StoreM',
    cost: { metal: 160, gas: 20 },
    costCR: 600,
    upkeepCR: 3,
  },
  StoreL: {
    key: 'StoreL',
    cost: { metal: 280, gas: 40 },
    costCR: 1200,
    upkeepCR: 5,
  },
  StoreCapital: {
    key: 'StoreCapital',
    cost: { metal: 420, gas: 80 },
    costCR: 2400,
    upkeepCR: 8,
  },
};

function defaultAreaResources(res = {}) {
  return {
    energyNet: 0,
    workforce: 0,
    wfSupplied: 0,
    capM: 0,
    capG: 0,
    metal: 0,
    gas: 0,
    ...res,
  };
}

function cloneBuilding(building = {}) {
  return { ...building };
}

function cloneArea(area) {
  return {
    id: area.id,
    buildings: Array.isArray(area.buildings) ? area.buildings.map(cloneBuilding) : [],
    res: defaultAreaResources(area.res),
  };
}

class BuildEconomy {
  constructor(options = {}) {
    this.credits = Number.isFinite(options.credits) ? options.credits : ECON.START_CR;
    this._crAcc = options._crAcc || 0;
    this._lastCRTick = options._lastCRTick || 0;
    this.creditLedger = Array.isArray(options.ledger) ? options.ledger.slice() : [];
    this.areas = new Map();
    this._lastCRDeltaPerMin = Number.isFinite(options.deltaPerMin) ? options.deltaPerMin : 0;

    if (options.areas instanceof Map) {
      for (const [id, area] of options.areas.entries()) {
        this.addArea(cloneArea({ id, ...area }));
      }
    } else if (Array.isArray(options.areas)) {
      for (const area of options.areas) {
        if (area && area.id) this.addArea(cloneArea(area));
      }
    }
  }

  static createArea(id, opts = {}) {
    const area = {
      id,
      buildings: Array.isArray(opts.buildings) ? opts.buildings : [],
      res: defaultAreaResources(opts.res),
    };
    return area;
  }

  addArea(area) {
    if (!area || !area.id) throw new Error('Area requires an id');
    if (!area.res) area.res = defaultAreaResources();
    if (!Array.isArray(area.buildings)) area.buildings = [];
    this.areas.set(area.id, area);
    return area;
  }

  getArea(id) {
    return this.areas.get(id);
  }

  ensureArea(id, opts = {}) {
    let area = this.areas.get(id);
    if (!area) {
      area = BuildEconomy.createArea(id, opts);
      this.addArea(area);
    }
    return area;
  }

  _now() {
    return perf.now();
  }

  _pushLedger(delta, reason) {
    this.creditLedger.push({ t: this._now(), delta, reason });
  }

  canAfford(def) {
    if (!def || typeof def.costCR !== 'number') return true;
    return this.credits >= def.costCR;
  }

  place(areaId, type, buildingData = {}) {
    const def = BUILDINGS[type];
    if (!def) throw new Error(`Unknown building type: ${type}`);
    if (!this.canAfford(def)) return false;
    const area = this.ensureArea(areaId);
    const building = {
      type,
      state: buildingData.state || 'active',
      wfNeed: buildingData.wfNeed || 0,
      wfHave: buildingData.wfHave || 0,
      ...buildingData,
    };
    area.buildings.push(building);
    if (def.costCR) {
      this.credits -= def.costCR;
      this._pushLedger(-def.costCR, `build:${def.key}`);
    }
    return building;
  }

  remove(areaId, predicate) {
    const area = this.areas.get(areaId);
    if (!area) return false;
    const idx = typeof predicate === 'number'
      ? predicate
      : area.buildings.findIndex(predicate || (() => true));
    if (idx < 0 || idx >= area.buildings.length) return false;
    const [building] = area.buildings.splice(idx, 1);
    const def = BUILDINGS[building.type];
    if (def && def.costCR) {
      const refund = Math.floor(def.costCR * 0.5);
      if (refund > 0) {
        this.credits += refund;
        this._pushLedger(refund, `refund:${def.key}`);
      }
    }
    return true;
  }

  tick(dtReal, ctx = {}) {
    const stations = Array.isArray(ctx.stations) ? ctx.stations : [];
    const glbSet = ctx.GLB_PLANETS || GLB_PLANETS;
    const glbCount = stations.reduce(
      (acc, st) => acc + (glbSet.has(st.id) ? 1 : 0),
      0,
    );
    const incomePerMin = glbCount * ECON.BASE_INCOME_PER_GLB;

    let upkeepPerMin = 0;
    for (const area of this.areas.values()) {
      for (const b of area.buildings) {
        const def = BUILDINGS[b.type];
        if (!def) continue;
        const wfHave = Number.isFinite(b.wfHave) ? b.wfHave : 0;
        const wfNeed = Number.isFinite(b.wfNeed) ? b.wfNeed : 0;
        const areaEnergy = Number.isFinite(area.res?.energyNet) ? area.res.energyNet : 0;
        const active = (b.state === 'active') && areaEnergy >= 0 && wfHave >= wfNeed;
        if (active) upkeepPerMin += def.upkeepCR || 0;
      }
    }

    if (ECON.AUTO_TRADE.enabled) {
      for (const area of this.areas.values()) {
        const res = area.res || (area.res = defaultAreaResources());
        const capM = Number.isFinite(res.capM) ? res.capM : 0;
        const capG = Number.isFinite(res.capG) ? res.capG : 0;
        const mThresh = Math.floor(capM * ECON.AUTO_TRADE.sellAbove);
        const gThresh = Math.floor(capG * ECON.AUTO_TRADE.sellAbove);
        if (res.metal > mThresh) {
          const sell = res.metal - mThresh;
          res.metal -= sell;
          const gain = sell * ECON.AUTO_TRADE.CR_PER_METAL;
          if (gain) {
            this.credits += gain;
            this._pushLedger(gain, 'trade:metal');
          }
        }
        if (res.gas > gThresh) {
          const sell = res.gas - gThresh;
          res.gas -= sell;
          const gain = sell * ECON.AUTO_TRADE.CR_PER_GAS;
          if (gain) {
            this.credits += gain;
            this._pushLedger(gain, 'trade:gas');
          }
        }
      }
    }

    this._crAcc += (incomePerMin - upkeepPerMin) * (dtReal / 60);
    if (Math.abs(this._crAcc) >= 1) {
      const whole = Math.trunc(this._crAcc);
      this._crAcc -= whole;
      this.credits += whole;
    }

    this._lastCRTick += dtReal;
    if (this._lastCRTick >= 60) {
      this._lastCRTick = 0;
      const delta = incomePerMin - upkeepPerMin;
      if (delta !== 0) this._pushLedger(delta, 'balance:Δ/min');
    }

    this._lastCRDeltaPerMin = Math.floor(incomePerMin - upkeepPerMin);
    return {
      incomePerMin,
      upkeepPerMin,
      deltaPerMin: this._lastCRDeltaPerMin,
      credits: this.credits,
    };
  }

  serialize() {
    const areas = [];
    for (const area of this.areas.values()) {
      areas.push(cloneArea(area));
    }
    return {
      economy: {
        credits: this.credits,
        ledger: this.creditLedger.slice(),
        deltaPerMin: this._lastCRDeltaPerMin,
        _crAcc: this._crAcc,
        _lastCRTick: this._lastCRTick,
        areas,
      },
    };
  }

  static fromSerialized(data = {}) {
    const econ = data.economy || {};
    return new BuildEconomy({
      credits: econ.credits,
      ledger: econ.ledger,
      deltaPerMin: econ.deltaPerMin,
      _crAcc: econ._crAcc,
      _lastCRTick: econ._lastCRTick,
      areas: econ.areas,
    });
  }
}

if (typeof module !== 'undefined') {
  module.exports = { ECON, GLB_PLANETS, BUILDINGS, BuildEconomy };
}

if (typeof window !== 'undefined') {
  window.BuildEconomy = BuildEconomy;
  window.BUILDINGS = BUILDINGS;
  window.GLB_PLANETS = GLB_PLANETS;
  window.ECON = ECON;
}
