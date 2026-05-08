# World Command Menu and RTS Ghost Placement Design

## Scope

This design covers steps 2 and 3 only:

- Add a right-click world command menu outside CIC and outside RTS.
- Extend RTS right-click behavior with a command menu and ghost-based move / formation placement.

Mouse targeting reticle lock-on is explicitly out of scope for this spec. It will be designed and integrated in a separate step after the player reticle is supplied.

## Goals

- Make the mouse a tactical command interface now that firing has moved to keyboard controls.
- Let the player force the player ship to attack a selected target automatically.
- Let `Approach` and `Orbit` on moving units follow the selected unit through `targetEntity`, not a frozen world point.
- Let RTS move orders include final facing through visible ship ghosts.
- Keep gameplay authority in 2D. No renderer or WebGL changes.

## Existing Systems To Reuse

- `ship.command` and `computePlayerCommandControl()` already support player autopilot for `move`, `approach`, `orbit`, and `hold`.
- RTS selection and unit commands already exist through `Selection.units`, `issueMoveOrder()`, `issueApproachOrder()`, and `issueOrbitOrder()`.
- Radar target actions already create player `approach` / `orbit` commands with `targetEntity`.
- CIC has a canvas-drawn right-click menu that can inform visual style, but the new world menu should be shared by normal flight and RTS rather than coupled to CIC internals.

## Normal Flight PPM Menu

Right-clicking a target opens a world command menu near the cursor with:

- `Attack`
- `Approach`
- `Orbit`
- `Jump`
- `Cruise`
- `Scan`

`Attack` locks the clicked hostile target and enables player auto-fire so the player ship can keep attacking without holding a mouse button. This spec enables main auto-fire only. Extra weapon groups remain under existing number-key toggles.

`Approach` creates a player command with `targetEntity`. The autopilot must keep resolving the target's live position so it chases a moving target.

`Orbit` creates a player command with `targetEntity`, `orbitRadius`, and `orbitDir`. The orbit center must follow the moving target.

`Jump` and `Cruise` use existing travel target behavior. If opened on a target, the action initializes to the target's current location. Only `Approach` and `Orbit` promise live target following.

`Scan` starts scanner behavior for the clicked target or nearest valid contact around the click point.

Right-clicking empty space opens:

- `Approach`
- `Orbit`
- `Jump`
- `Cruise`
- `Scan`

For empty-space `Approach` / `Orbit`, the command target is the clicked world point because no entity is available to follow.

## RTS PPM Menu

When at least one unit is selected, right-click down opens the RTS command menu instead of issuing an immediate move order.

Menu entries:

- `Move` for one selected unit, or `Move Formation` for multiple selected units.
- `Approach`
- `Orbit`
- `Attack`
- `Hold`
- `Scan`

`Approach` keeps current behavior: selected units move toward a single point or selected target. If the command is issued on a moving entity, commands keep `targetEntity` so units chase that entity instead of the old click location.

`Orbit` keeps current behavior but must use `targetEntity` when available so the orbit center follows moving targets.

`Move` / `Move Formation` enters ghost placement. PPM down opens the menu; dragging over the move entry activates the ghost preview. The initial anchor is the clicked point. While the player keeps PPM held and drags, ghost ships rotate to face from anchor toward the current mouse position. Releasing PPM confirms the command.

For multiple units, ghost positions use the existing formation target logic, and all ghosts share the chosen `faceAngle`. Per-row facing is out of scope.

If no units are selected, RTS right-click drag keeps its current camera pan behavior.

## Command Data

Supported command fields:

- `target`: world point fallback.
- `targetEntity`: moving target reference when available.
- `arrival`: arrival radius.
- `orbitRadius` and `orbitDir` for orbit commands.
- `faceAngle`: optional final orientation for `move` / `move formation`.

`targetEntity` takes precedence over `target` whenever the entity exists and is alive. This is required for moving-target `Approach` and `Orbit`.

## Rendering And Interaction

The command menu is 2D canvas UI, drawn after world content and before/with tactical overlays. It should avoid DOM hit complexity and match the current game HUD style.

Ghosts are also 2D overlays. The first pass uses simple ship silhouettes based on unit dimensions and angle rather than full sprites. The important behavior is spatial clarity: position, formation spacing, and facing.

## Error Handling

- If a target dies before an action is selected, close the menu and show a short status message.
- If a command with `targetEntity` loses the entity during execution, fall back to the last valid point if available or clear the command.
- If no units are selected in RTS, do not show unit order entries.
- If scanner actions have no valid target/contact, show a short "no scan target" message.

## Testing

Focused tests should cover the command data and autopilot behavior:

- Player `approach` with `targetEntity` follows updated target coordinates.
- Player `orbit` with `targetEntity` follows updated target coordinates.
- `faceAngle` survives move command creation.
- RTS move formation produces stable per-unit target points and shared final facing.

Manual verification should cover:

- PPM on hostile target in normal flight enables attack behavior.
- PPM on empty space can issue approach/orbit/cruise-style commands.
- RTS PPM menu appears with selected units.
- `Move Formation` shows ghost positions and commits facing on release.
