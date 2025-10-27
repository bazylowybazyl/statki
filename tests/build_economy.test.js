const assert = require('assert');
const { BuildEconomy, BUILDINGS, ECON, GLB_PLANETS } = require('../src/build/economy.js');

function createState(startCredits = ECON.START_CR) {
  const state = new BuildEconomy({ credits: startCredits });
  state.addArea(BuildEconomy.createArea('earth_area', {
    res: { energyNet: 0, workforce: 20, capM: 1000, capG: 1000, metal: 0, gas: 0 },
  }));
  return state;
}

function getArea(state, id = 'earth_area') {
  return state.getArea(id);
}

(function testPlaceBlocksWhenCreditsInsufficient(){
  const state = createState(100);
  const ok = state.place('earth_area', 'Power');
  assert.strictEqual(ok, false, 'placement should fail when credits too low');
  assert.strictEqual(state.credits, 100);
  assert.strictEqual(state.creditLedger.length, 0);
})();

(function testSuccessfulPlacementDeductsCredits(){
  const state = createState(2000);
  const building = state.place('earth_area', 'Power', { wfNeed: 10, wfHave: 10 });
  assert.ok(building, 'building should be created');
  assert.strictEqual(state.credits, 1000, 'credits should deduct costCR');
  assert.strictEqual(state.creditLedger.length, 1);
  assert.strictEqual(state.creditLedger[0].reason, 'build:Power');
})();

(function testRefundOnRemoval(){
  const state = createState(5000);
  state.place('earth_area', 'ShipyardM', { wfNeed: 5, wfHave: 5 });
  const before = state.credits;
  const removed = state.remove('earth_area', 0);
  assert.ok(removed, 'should remove building');
  const def = BUILDINGS.ShipyardM;
  const expected = before + Math.floor(def.costCR * 0.5);
  assert.strictEqual(state.credits, expected);
  assert.strictEqual(state.creditLedger.at(-1).reason, 'refund:ShipyardM');
})();

(function testTickIncomeAndUpkeep(){
  const state = createState(0);
  const area = getArea(state);
  area.buildings.push({ type: 'Power', state: 'active', wfNeed: 0, wfHave: 0 });
  const stations = [ { id: 'earth' }, { id: 'mars' }, { id: 'venus' } ];
  const res = state.tick(60, { stations, GLB_PLANETS });
  const income = 2 * ECON.BASE_INCOME_PER_GLB;
  const upkeep = BUILDINGS.Power.upkeepCR;
  assert.strictEqual(res.incomePerMin, income);
  assert.strictEqual(res.upkeepPerMin, upkeep);
  assert.strictEqual(res.deltaPerMin, Math.floor(income - upkeep));
  assert.strictEqual(state.credits, income - upkeep);
})();

(function testAutoTrade(){
  const state = createState(0);
  const area = getArea(state);
  area.res.metal = 1000;
  area.res.gas = 900;
  area.res.capM = 1000;
  area.res.capG = 900;
  const creditsBefore = state.credits;
  state.tick(1, { stations: [] });
  assert.ok(state.credits > creditsBefore, 'auto trade should increase credits');
  const lastReasons = state.creditLedger.slice(-2).map(e => e.reason);
  assert.ok(lastReasons.includes('trade:metal'));
  assert.ok(lastReasons.includes('trade:gas'));
})();

(function testCreditsCanGoNegative(){
  const state = createState(10);
  const area = getArea(state);
  area.buildings.push({ type: 'ShipyardCapital', state: 'active', wfNeed: 0, wfHave: 0 });
  state.tick(60, { stations: [] });
  assert.ok(state.credits < 0, 'credits should drop below zero');
})();

console.log('build_economy.test.js passed');
