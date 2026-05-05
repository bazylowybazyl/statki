# Player Flight Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract player flight control into focused modules and improve command autopilot behavior.

**Architecture:** Keep `shipEntity.js` as the ship data/configuration module. Move thruster actuation and force calculation into `src/game/flight/thrusterModel.js`, and move command AI into `src/game/flight/playerAutopilot.js`. `index.html` delegates RTS/player commands to the new autopilot while preserving manual input behavior.

**Tech Stack:** Browser ES modules, plain JavaScript, `node:test`.

---

### Task 1: Add Tests For Flight Modules

**Files:**
- Create: `tests/playerAutopilot.test.mjs`
- Create: `tests/thrusterModel.test.mjs`

- [ ] Write tests for close lateral strafe, angular counter-rotation, high-speed approach braking, and hold drift cancellation.
- [ ] Write a smoke test for the new thruster model module import and force calculation.
- [ ] Run `node --test tests/playerAutopilot.test.mjs tests/thrusterModel.test.mjs` and confirm the tests fail because the new modules do not exist.

### Task 2: Extract Thruster Model

**Files:**
- Create: `src/game/flight/thrusterModel.js`
- Modify: `src/game/shipEntity.js`

- [ ] Move `SHIP_PHYSICS`, thruster visual state, actuator stepping, command composition, and force calculation into `thrusterModel.js`.
- [ ] Import and re-export those APIs from `shipEntity.js` to keep existing imports stable.
- [ ] Run `node --test tests/thrusterModel.test.mjs`.

### Task 3: Add Player Autopilot Module

**Files:**
- Create: `src/game/flight/playerAutopilot.js`
- Test: `tests/playerAutopilot.test.mjs`

- [ ] Implement `computePlayerHoldControl(ship)`.
- [ ] Implement `computePlayerCommandControl(ship, command, options)`.
- [ ] Use local-axis acceleration mapping for `main`, `retro`, `leftSide`, and `rightSide`.
- [ ] Use PD torque: heading error minus angular-velocity damping.
- [ ] Run `node --test tests/playerAutopilot.test.mjs`.

### Task 4: Wire Player Commands Through The New Module

**Files:**
- Modify: `index.html`

- [ ] Import `computePlayerHoldControl` and `computePlayerCommandControl`.
- [ ] Replace inline `computePlayerHoldControl` and command steering logic with calls to the module.
- [ ] Preserve command clearing, hold transition, and manual override behavior.
- [ ] Run all available node tests and `npm run build`.

### Task 5: Verify Scope

**Files:**
- Review: `src/game/shipEntity.js`
- Review: `src/game/flight/*.js`
- Review: `index.html`

- [ ] Confirm `shipEntity.js` no longer owns thruster physics internals.
- [ ] Confirm manual keyboard input still writes the same `main/retro/leftSide/rightSide/torque` shape.
- [ ] Confirm no NPC code was converted in this stage.
