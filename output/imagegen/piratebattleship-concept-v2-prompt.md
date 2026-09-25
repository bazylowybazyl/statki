# Pirate battleship — concept v2

Generated: 2026-09-24
Method: built-in image_gen (imagegen skill); existing battleship supplied as visual reference.
Deliverable: `piratebattleship-concept-v2.png`
Status: visual proposal only; current game assets and gameplay references are unchanged. Hardpoint and bridge placement would need checking before any future integration.

## Located pirate sprites

Active imports in `index.html` and `src/data/playerHullCatalog.js`:
- `src/assets/ships/piratefrigate.png`
- `src/assets/ships/piratedestroyer.png`
- `src/assets/ships/piratebattleship.png`

Additional artwork: `src/assets/ships/piratecapital.png`.
Other matching files: `assets/pirate_raider.png`, `assets/pirate_destroyer.png`, `public/assets/pirate_destroyer.png`.

## Exact generation prompt

Use case: stylized-concept
Asset type: A new pirate battleship hull sprite proposal for the existing top-down space combat game "Super Capital: Battle for Solar System".
Input images: Image 1 is the existing piratebattleship.png, a reference for faction identity, orientation, palette, and overall footprint. Create a substantially redesigned successor rather than merely sharpening or repainting the reference.
Primary request: Generate ONE beautifully crafted, highly legible, production-quality pirate battleship sprite concept belonging to the Iron Skull pirate fleet. Make it look like a brutal, massively armored industrial warship rebuilt from captured military hulls. The old sprite's patchwork steel, rust, crude welded modifications, skull insignia, and a few threatening ram spikes remain recognizable, but the new design has coherent engineering, distinct large armor masses and crisp purposeful details.
Scene/backdrop: Isolate the entire ship on a genuinely transparent background with alpha. No space scene, stars, ground, shadow underneath, checkerboard pattern or background color baked into the image.
Composition/framing: Strict orthographic 90-degree overhead dorsal view, no perspective or isometric tilt. Horizontal long axis, bow pointing RIGHT, FOUR substantial engine nacelles exhausting LEFT. Compact broad battleship proportions about 1.9:1 length to beam, centered, all silhouette tips visible with modest transparent margins, landscape image. Approximate bilateral mass symmetry with small asymmetries in repair panels.
Subject details: A blunt heavily armored prow with a small number of strong hooked boarding/ram teeth. Broad armored stern shoulders housing four believable recessed engine assemblies. A recessed central structural spine linking stern machinery and foredeck; layered gunmetal armor with strong plate hierarchy, welded reinforcement ribs, replaceable rusty plates and protected conduits. Five clearly engineered EMPTY circular weapon mounting bases arranged as two on the aft shoulders, two on the mid-forward shoulders and one centered near the bow; flat capped metal mounting bases rather than black holes. Low compact armored bridge housing near the stern centerline. Weapon turrets are rendered separately by the game, so do not bake guns, barrels or firing effects into the hull. Engine nozzles are unlit with no exhaust trails because game engine effects are added separately.
Style/medium: Premium realistic pre-rendered strategy-game sprite, sharp hard-surface 3D material definition, credible manufactured forms, rich but controlled surface detail. Prioritize strong silhouette and readable large forms even when scaled down to 400 pixels wide. Surface detail supports the armor volumes rather than covering everything in visual noise.
Lighting/mood: Soft neutral overhead illumination with gentle upper-left highlights and restrained self-occlusion. Legible midtone metal, no crushed-black hull, no cinematic rim light or bloom.
Color palette/materials: Weathered dark charcoal steel, exposed silver worn edges, localized rusty orange-brown corrosion at welds and replacement plates, restrained chipped dark red pirate markings. A few small bone-white painted skull emblems. Wear is localized and believable, panels remain structurally coherent.
Text: Only one modest hand-painted marking reading "IRON SKULL" integrated on a central armor plate. No giant typography dominating the hull, no additional text or labels.
Constraints: One ship only, transparent sprite cutout, entire object in frame, exact top-down camera, nose right / engines left. No border, no title card, no presentation sheet, no watermark, no disconnected parts, no flames, no turrets, no medieval sailing-ship elements.

