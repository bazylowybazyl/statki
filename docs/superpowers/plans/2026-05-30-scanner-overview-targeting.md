# Scanner Overview Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hybrid scanner overview UI with fixed/floating layout, clickable contact rows, selected-object details, asteroid contacts, and direct world picking.

**Architecture:** Add a small pure targeting adapter module for mixed target shapes, a DOM-based scanner overview UI module, and then wire both into `index.html` where scanner contacts, locks, commands, and canvas picking already live. Gameplay, collision, damage, and WebGL rendering remain unchanged.

**Tech Stack:** Plain JavaScript ES modules, DOM/CSS, 2D Canvas overlay integration, Node test runner.

---

### Task 1: Target Adapter And Scanner Data

**Files:**
- Create: `src/game/scannerTargeting.js`
- Test: `tests/scannerTargeting.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/scannerTargeting.test.mjs` with tests for asteroid coordinate adaptation, lockability, row sorting, and detail data:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAsteroidScanDetails,
  buildScannerContact,
  getTargetRadius,
  getTargetX,
  getTargetY,
  isAsteroidTarget,
  isLockableTarget,
  sortScannerContacts
} from '../src/game/scannerTargeting.js';

test('asteroid targets expose world coordinates and scale radius', () => {
  const asteroid = { worldX: 120, worldY: 240, scale: 800, alive: true, type: 'iron', size: 'BIG' };
  assert.equal(isAsteroidTarget(asteroid), true);
  assert.equal(getTargetX(asteroid), 120);
  assert.equal(getTargetY(asteroid), 240);
  assert.equal(getTargetRadius(asteroid), 400);
});

test('neutral asteroids are lockable without being hostile', () => {
  const asteroid = { worldX: 1, worldY: 2, scale: 120, alive: true, type: 'ice', size: 'S' };
  const hostile = { x: 10, y: 20, radius: 30, dead: false, friendly: false };
  const friendly = { x: 10, y: 20, radius: 30, dead: false, friendly: true };
  assert.equal(isLockableTarget(asteroid), true);
  assert.equal(isLockableTarget(hostile), true);
  assert.equal(isLockableTarget(friendly), false);
});

test('scanner contacts sort by group priority then distance', () => {
  const contacts = [
    buildScannerContact({ target: { x: 0, y: 0, dead: false, friendly: false }, type: 'ship', tone: 'hostile', distance: 800 }),
    buildScannerContact({ target: { worldX: 0, worldY: 0, scale: 100, alive: true, type: 'iron', size: 'M' }, type: 'asteroid', tone: 'resource', distance: 200 }),
    buildScannerContact({ target: { x: 0, y: 0, dead: false, friendly: true }, type: 'ship', tone: 'friendly', distance: 50 })
  ];
  const sorted = sortScannerContacts(contacts);
  assert.deepEqual(sorted.map((c) => c.tone), ['hostile', 'resource', 'friendly']);
});

test('asteroid scan details include mass resource and motion data', () => {
  const details = buildAsteroidScanDetails({
    type: 'uran',
    size: 'L',
    mass: 120000,
    hp: 420,
    hpMax: 900,
    hardness: 0.74,
    resource: 'uranium',
    yield: 80,
    beltId: 'main',
    vx: 3,
    vy: 4,
    spin: 0.125
  });
  assert.deepEqual(details.rows.map((row) => row.name), [
    'Type', 'Size', 'Mass', 'Hull', 'Hardness', 'Resource', 'Yield', 'Belt', 'Velocity', 'Spin'
  ]);
  assert.equal(details.rows.find((row) => row.name === 'Velocity').amount, '5 u/s');
});
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests/scannerTargeting.test.mjs`

Expected: FAIL with module not found for `src/game/scannerTargeting.js`.

- [ ] **Step 3: Implement target adapter**

Create `src/game/scannerTargeting.js` exporting the functions used above. Use `worldX/worldY/scale/alive` for asteroids, `pos` or direct `x/y` for ships/stations, and no DOM dependencies.

- [ ] **Step 4: Run passing test**

Run: `node --test tests/scannerTargeting.test.mjs`

Expected: PASS.

### Task 2: Scanner Overview DOM Module

**Files:**
- Create: `src/ui/scannerOverviewUI.js`
- Test: `tests/scannerOverviewUI.test.mjs`

- [ ] **Step 1: Write failing DOM tests**

Create `tests/scannerOverviewUI.test.mjs` using a tiny fake `document` if needed or test exported pure helpers from the UI module:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScannerOverviewModel,
  resolveScannerLayout,
  updateScannerFilters
} from '../src/ui/scannerOverviewUI.js';

test('scanner overview model exposes selected contact details', () => {
  const target = { id: 'ast-1' };
  const model = createScannerOverviewModel({
    contacts: [{ target, type: 'asteroid', tone: 'resource', distance: 1200, label: 'AST-0001 Iron', classLabel: 'BIG' }],
    selectedTarget: target,
    lockedTargets: [target]
  });
  assert.equal(model.rows[0].selected, true);
  assert.equal(model.rows[0].locked, true);
  assert.equal(model.rows[0].distanceLabel, '1.2k');
});

test('scanner filters can hide asteroids without mutating previous state', () => {
  const current = { all: true, hostile: true, asteroid: true, station: true, friendly: true };
  const next = updateScannerFilters(current, 'asteroid');
  assert.equal(current.asteroid, true);
  assert.equal(next.asteroid, false);
  assert.equal(next.all, false);
});

test('scanner layout resolves fixed and floating defaults', () => {
  assert.equal(resolveScannerLayout({ mode: 'floating' }).mode, 'floating');
  assert.equal(resolveScannerLayout({ mode: 'nonsense' }).mode, 'fixed');
});
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests/scannerOverviewUI.test.mjs`

Expected: FAIL with module not found for `src/ui/scannerOverviewUI.js`.

- [ ] **Step 3: Implement DOM component**

Create `src/ui/scannerOverviewUI.js` with:

- pure exports tested above;
- `initScannerOverviewUI(opts)` that injects styles, renders `Overview / Scanner` and `Selected Object`, supports fixed/floating layout, filter toggles, row click, row double-click lock, action buttons, and drag handles for floating panels;
- callbacks: `onSelectTarget`, `onToggleLock`, `onAction`, `getDetails`, `isLocked`.

- [ ] **Step 4: Run passing UI tests**

Run: `node --test tests/scannerOverviewUI.test.mjs`

Expected: PASS.

### Task 3: Game Loop Integration

**Files:**
- Modify: `index.html`
- Modify: `src/game/weaponController.js`

- [ ] **Step 1: Write failing integration-oriented tests**

Extend `tests/scannerTargeting.test.mjs` with tests for position helpers supporting `leadTarget` style callers and lock validation:

```js
test('target helpers support ship station and asteroid positions', () => {
  assert.equal(getTargetX({ pos: { x: 7, y: 8 } }), 7);
  assert.equal(getTargetY({ pos: { x: 7, y: 8 } }), 8);
  assert.equal(getTargetRadius({ r: 90 }), 90);
});
```

Run: `node --test tests/scannerTargeting.test.mjs`

Expected: FAIL until helper handles all shapes.

- [ ] **Step 2: Wire imports and helpers in `index.html`**

Add imports:

```js
import {
  buildAsteroidScanDetails,
  buildScannerContact,
  getTargetRadius,
  getTargetX,
  getTargetY,
  isAsteroidTarget,
  isLockableTarget,
  sortScannerContacts
} from "./src/game/scannerTargeting.js";
import { initScannerOverviewUI } from "./src/ui/scannerOverviewUI.js";
```

Use helper functions for:

- `isValidLockedTarget`;
- `getScanObjectRadius`;
- scanner contact creation;
- radar/lock marker rendering;
- `distanceTo`;
- commands that need target points/radius.

- [ ] **Step 3: Add asteroid contacts**

In `refreshScannerContacts()`, query `window.asteroidField.queryRadius(ship.pos.x, ship.pos.y, SCANNER_ACTIVE_RANGE)`, build resource contacts, sort, and cap asteroid display count before pushing to the UI.

- [ ] **Step 4: Add direct world picking for asteroids**

Extend `pickCommandTargetAtWorld` and normal click selection with a small helper that queries nearby asteroids and chooses the closest hit under `scale * 0.5 + margin`.

- [ ] **Step 5: Replace bottom target labels during normal scanner play**

Instantiate `scannerOverviewUI`, feed it `scannerContacts`, `selectedScannerTarget`, `lockedTargets`, and callbacks. Keep `radarTargetingUI` available as legacy/offscreen marker support, but make the overview the primary scanner UI.

- [ ] **Step 6: Update weapon controller validation**

In `src/game/weaponController.js`, use `window.isLockableTarget` if available instead of `window.isHostileNpc` so asteroid locks do not get dropped by the per-ship controller.

- [ ] **Step 7: Run tests**

Run:

```powershell
node --test tests/scannerTargeting.test.mjs tests/scannerOverviewUI.test.mjs tests/worldCommandMenu.test.mjs tests/asteroidHexAdapter.test.mjs
```

Expected: PASS.

### Task 4: Build And Manual Smoke

**Files:**
- No new files unless build reveals an import issue.

- [ ] **Step 1: Run full test/build verification**

Run:

```powershell
npm run build
node --test tests/scannerTargeting.test.mjs tests/scannerOverviewUI.test.mjs
```

Expected: build exits 0 and tests pass.

- [ ] **Step 2: Start dev server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite reports a local URL.

- [ ] **Step 3: Browser smoke**

Open the local Vite URL and verify the page loads without module errors. Do not capture heavy gameplay screenshots.

