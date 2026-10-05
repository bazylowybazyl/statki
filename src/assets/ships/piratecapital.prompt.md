# Piracki supercapital — odświeżenie sprite’a

Output: `src/assets/ships/piratecapital.png`

Narzędzie: wbudowany imagegen. Edycja istniejącego sprite’a, referencje stylu: `piratebattleship.png` i `piratedestroyer.png` z tego katalogu. Zakres: grafika; integracja kadłuba i mostka z główną grą pozostaje osobnym krokiem.

Wynik: PNG RGBA 1671 × 941 px (oryginał: 1672 × 941 px), prawdziwa przezroczystość tła. Zachowano szeroką sylwetkę, orientację i cztery silniki; odświeżono pancerz, oznaczenia i zaślepione podstawy wież. Kopia poprzedniej grafiki: `.tmp/imagegen/piratecapital-before.png` (lokalna, ignorowana przez Git).

## Prompt

Use case: style-transfer.
Asset type: production PNG sprite for a top-down space combat game.
Input images: Image 1 (piratecapital.png) is the EDIT TARGET. Image 2 (piratebattleship.png) and image 3 (piratedestroyer.png) are STYLE REFERENCES ONLY, showing the updated pirate fleet.
Primary request: Update the pirate supercapital in image 1 to the same current visual quality and design language as images 2 and 3. This must remain the huge, broad, heavily armored flagship from image 1, not become either reference ship.
Preserve the recognizable hull silhouette, horizontal orientation, strictly orthographic directly-overhead camera, bow pointing RIGHT, stern LEFT, four large engine nozzles down the left edge, broad rear shoulders, thick connected central hull, hooked armored prow with a central ram, approximate placement and count of the eight circular mount bases, and centered framing. Keep the original canvas dimensions 1672 x 941 pixels and ship bounds as close to original as possible; entire hull and spikes inside frame with small transparent margins.
Style: detailed realistic painted hard-surface game sprite, exactly matching the reference pirate fleet: substantial readable layered charcoal steel armor plates, rusty orange-brown wear at seams and chipped edges, machined beveled rims, deep dark recesses, exposed bundled pipes, purposeful ventilation grilles, fewer tiny cluttered panels, controlled highlights and baked self shading. Large faded red diagonal paint stripes on the two rear shoulders, aged ivory skull markings, a clear aged ivory hand-painted IRON SKULL marking over a worn red field at the center. Remove the old huge black IRON SKULL PIRATES lettering and little KILL DIE / NO MERCY slogans. Use the reference fleet's restrained worn paint and metal rendering.
The eight circular weapon mounting locations must be EMPTY CLOSED METAL MOUNTING PLATES / blank circular caps with bolts, like the references, not black open wells. NO gun barrels, turrets or installed weapons: the game draws those separately. Four engines are unlit metallic nozzles, no exhaust flames. Include a compact raised armored command block in the rear half of the centerline, visually distinct and free of weapon mounts.
Background: genuinely transparent RGBA alpha, no black or white background, no painted checkerboard, no cast shadow outside the hull, no ambient glow, no stars, no scene, no UI, no border. Keep silhouette clean and connected. Produce ONE finished ship sprite.

