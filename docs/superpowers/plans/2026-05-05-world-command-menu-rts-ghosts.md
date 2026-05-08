# World Command Menu RTS Ghosts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click tactical command menu for normal flight and RTS, with RTS ghost placement and final facing for move / formation orders.

**Architecture:** Keep gameplay authority in `index.html` and 2D command data. Add a pure command helper module for menu item construction, command object creation, formation target calculation, and menu hit testing. Extend player autopilot and NPC command execution to respect optional `faceAngle` after arrival, then wire the canvas input/rendering in `index.html`.

**Tech Stack:** Browser ES modules, plain JavaScript, 2D Canvas, `node:test`.

---

### Task 1: Pure Command Helpers

**Files:**
- Create: `src/game/worldCommandMenu.js`
- Create: `tests/worldCommandMenu.test.mjs`

- [ ] **Step 1: Write failing tests for menu/action helpers**

Add tests that import these functions from `src/game/worldCommandMenu.js`:

```js
import {
  buildNormalCommandMenuItems,
  buildRtsCommandMenuItems,
  createApproachCommand,
  createOrbitCommand,
  createMoveCommand,
  computeFormationTargets,
  hitTestCommandMenu
} from '../src/game/worldCommandMenu.js';
```

Test cases:

```js
test('normal target menu includes attack and keeps target entity commands live', () => {
  const target = { x: 100, y: 200, radius: 50 };
  assert.deepEqual(buildNormalCommandMenuItems({ targetEntity: target }).map(i => i.action), [
    'attack', 'approach', 'orbit', 'jump', 'cruise', 'scan'
  ]);
  assert.equal(createApproachCommand({ point: { x: 0, y: 0 }, targetEntity: target }).targetEntity, target);
  assert.equal(createOrbitCommand({ point: { x: 0, y: 0 }, targetEntity: target }).targetEntity, target);
});

test('normal empty-space menu omits attack', () => {
  assert.deepEqual(buildNormalCommandMenuItems({ targetEntity: null }).map(i => i.action), [
    'approach', 'orbit', 'jump', 'cruise', 'scan'
  ]);
});

test('rts menu labels move formation only for multi selection', () => {
  assert.equal(buildRtsCommandMenuItems({ selectedCount: 1 })[0].label, 'MOVE');
  assert.equal(buildRtsCommandMenuItems({ selectedCount: 3 })[0].label, 'MOVE FORMATION');
});

test('move command stores faceAngle', () => {
  const cmd = createMoveCommand({ point: { x: 10, y: 20 }, faceAngle: Math.PI / 3 });
  assert.equal(cmd.type, 'move');
  assert.equal(cmd.target.x, 10);
  assert.equal(cmd.faceAngle, Math.PI / 3);
});

test('formation targets are stable and centered', () => {
  const units = [{ id: 'b', radius: 20 }, { id: 'a', radius: 20 }];
  const targets = computeFormationTargets(units, { x: 100, y: 50 }, 0);
  assert.equal(targets.size, 2);
  assert.ok(Math.abs(targets.get(units[0]).y - 50) > 1);
  assert.ok(Math.abs(targets.get(units[1]).y - 50) > 1);
});

test('menu hit testing returns the expected action', () => {
  const menu = { x: 20, y: 40, width: 180, itemHeight: 26, items: [{ action: 'move' }, { action: 'hold' }] };
  assert.equal(hitTestCommandMenu(menu, 30, 45)?.action, 'move');
  assert.equal(hitTestCommandMenu(menu, 30, 72)?.action, 'hold');
  assert.equal(hitTestCommandMenu(menu, 5, 72), null);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/worldCommandMenu.test.mjs`

Expected: fails because `src/game/worldCommandMenu.js` does not exist or named exports are missing.

- [ ] **Step 3: Implement helper module**

Implement `buildNormalCommandMenuItems`, `buildRtsCommandMenuItems`, `createApproachCommand`, `createOrbitCommand`, `createMoveCommand`, `computeFormationTargets`, and `hitTestCommandMenu`. Keep functions pure and allocation-light for use from `index.html`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/worldCommandMenu.test.mjs`

Expected: all tests pass.

### Task 2: Player Autopilot Final Facing

**Files:**
- Modify: `src/game/flight/playerAutopilot.js`
- Modify: `tests/playerAutopilot.test.mjs`

- [ ] **Step 1: Write failing tests for `faceAngle`**

Add tests:

```js
test('move command transitions to hold-facing when it reaches arrival', () => {
  const ship = makeShip({ pos: { x: 95, y: 0 }, vel: { x: 0, y: 0 }, angle: 0 });
  const result = computePlayerCommandControl(ship, {
    type: 'move',
    target: { x: 100, y: 0 },
    arrival: 20,
    faceAngle: Math.PI / 2
  });
  assert.equal(result.clearCommand, false);
  assert.equal(result.nextCommand.type, 'hold');
  assert.equal(result.nextCommand.faceAngle, Math.PI / 2);
});

test('hold command with faceAngle rotates toward final facing', () => {
  const ship = makeShip({ angle: 0, angVel: 0, vel: { x: 0, y: 0 } });
  const result = computePlayerCommandControl(ship, { type: 'hold', faceAngle: Math.PI / 2 });
  assert.ok(result.control.torque > 0.25);
  assert.equal(result.clearCommand, false);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/playerAutopilot.test.mjs`

Expected: fails because `faceAngle` is not preserved or hold does not rotate toward it.

- [ ] **Step 3: Implement `faceAngle` support**

Update `computePlayerCommandControl()` so arrival with `cmd.faceAngle` transitions to `{ type: 'hold', faceAngle: cmd.faceAngle }`. Update hold handling to use `faceAngle` as the desired heading while still damping velocity and angular velocity.

- [ ] **Step 4: Run test and verify GREEN**

Run: `node --test tests/playerAutopilot.test.mjs`

Expected: all player autopilot tests pass.

### Task 3: Normal Flight World Command Menu

**Files:**
- Modify: `index.html`
- Test indirectly with: `tests/worldCommandMenu.test.mjs`

- [ ] **Step 1: Import helpers**

Import menu helpers from `./src/game/worldCommandMenu.js` near the other game imports.

- [ ] **Step 2: Add `worldCommandMenu` state**

Add state with `open`, `mode`, `x`, `y`, `worldPoint`, `targetEntity`, `items`, `width`, and `itemHeight`.

- [ ] **Step 3: Add target picking for command menus**

Use existing `pickEnemyTargetAtWorld()` / `pickCommandTargetAtWorld()` where available. For normal flight, target PPM should prefer hostile NPC/platform targets and ignore stations for `Attack`.

- [ ] **Step 4: Add action handlers**

Implement normal flight actions:

- `attack`: set `lockedTargets` to include target, set `lockedTarget`, enable `mainAutoFire`, and show a status message.
- `approach`: assign `ship.command = createApproachCommand({ point, targetEntity })`.
- `orbit`: assign `ship.command = createOrbitCommand({ point, targetEntity })`.
- `jump` / `cruise`: call `setCruiseTarget()` using target current position or clicked point.
- `scan`: activate scanner and direct scan target when available.

- [ ] **Step 5: Wire mouse input**

On normal-flight PPM down, open the menu instead of firing weapons. On LPM down, if the menu is open, hit-test and execute an item; otherwise close the menu on outside click.

- [ ] **Step 6: Draw menu**

Add a canvas draw function matching the CIC menu style: dark rectangle, cyan border, disabled item dimming, one row per action.

### Task 4: RTS Menu And Ghost Placement

**Files:**
- Modify: `index.html`
- Test indirectly with: `tests/worldCommandMenu.test.mjs`

- [ ] **Step 1: Extend RTS state**

Add fields for `placement`, `anchorWorld`, `currentWorld`, `faceAngle`, and selected action. Placement is active only after selecting `move` / `move-formation`.

- [ ] **Step 2: Open RTS menu on PPM down**

If `Selection.units.size > 0`, open the RTS menu on PPM down. If no units are selected, keep existing RTS camera pan behavior.

- [ ] **Step 3: Activate ghost placement from menu**

When the held pointer is over the first menu item and moves beyond a small threshold, start ghost placement. While active, compute `faceAngle = atan2(current.y - anchor.y, current.x - anchor.x)`.

- [ ] **Step 4: Commit ghost placement on PPM up**

Use existing formation logic or the pure helper to assign per-unit `move` commands with `faceAngle`. If one unit is selected, label and behavior are `Move`; if multiple, `Move Formation`.

- [ ] **Step 5: Preserve existing advanced RTS orders**

When the user clicks `Approach`, `Orbit`, `Attack`, `Hold`, or `Scan`, route to existing RTS issue functions. `Approach` and `Orbit` must pass `targetEntity` when available so moving targets are followed.

- [ ] **Step 6: Draw ghosts**

Render simple translucent ship silhouettes at formation targets with the chosen `faceAngle`, plus a direction line from the anchor to the current cursor.

### Task 5: Verification

**Files:**
- Review: `index.html`
- Review: `src/game/worldCommandMenu.js`
- Review: `src/game/flight/playerAutopilot.js`
- Run: tests and build

- [ ] Run: `node --test tests/worldCommandMenu.test.mjs tests/playerAutopilot.test.mjs tests/thrusterModel.test.mjs`

Expected: all tests pass.

- [ ] Run: `npm run build`

Expected: Vite build exits 0.

- [ ] Review diff for forbidden changes:

Confirm no new `THREE.WebGLRenderer`, no gameplay migration into 3D, no unrelated refactors, and no `.superpowers/` files staged.
