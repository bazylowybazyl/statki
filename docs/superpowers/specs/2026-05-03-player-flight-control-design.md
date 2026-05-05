# Player Flight Control Refactor Design

## Goal

Extract player ship flight control into focused modules and replace the RTS/player-command autopilot with a velocity-aware controller that can strafe, brake, and counter-rotate before overshoot.

## Scope

This first stage keeps manual keyboard/gamepad feel stable and focuses on `ship.command` behavior for move, approach, orbit, and hold orders. NPCs are not converted in this stage, but the new module boundaries should allow them to reuse the same control API later with either full thruster physics or a cheaper solver.

## Architecture

- `src/game/flight/thrusterModel.js` owns thruster command composition, nozzle actuation, and force/torque calculation.
- `src/game/flight/playerAutopilot.js` owns command-level player AI: hold, move, approach, and orbit.
- `src/game/shipEntity.js` remains the ship factory/configuration module and re-exports existing flight APIs for compatibility.
- `index.html` remains the integration host for now, but delegates player command control to `playerAutopilot.js`.

## Behavior

The new autopilot converts position error and current velocity into desired acceleration. It projects that acceleration into the ship's local forward/right axes and maps it to `main`, `retro`, `leftSide`, and `rightSide`.

For nearby lateral targets, the autopilot should prefer strafe and angular damping instead of rotating the bow toward the target. For heading control, it should use PD-style torque so current angular velocity is considered before the ship passes the desired heading.

## Testing

Unit tests cover the new module behavior using `node:test`:

- close lateral move prefers side thrusters over rotation
- heading torque counters excessive existing angular velocity
- approach order uses retro when closing too fast
- hold cancels lateral drift
- extracted thruster model computes force through the new path
