# Yamato sprite prototype

Generated with the built-in ImageGen tool. Reference: `assets/capital_ship_rect_v1.png` (material/style only).

The untouched 1254 × 1254 RGBA output is `yamato-atlas-v1.png`. Source rectangles and assembly are in `src/vfx/yamatoSprite2D.js`. The top part is the housing; the bottom part is reused for three barrels. The game retains procedural fallback and distant LOD.

## Generation prompt

Use case: stylized-concept.
Asset type: production-ready transparent 2D game sprite atlas, square 1024x1024.
Primary request: two SEPARATE modular parts of a massive science-fiction YAMATO triple naval plasma cannon turret, for a top-down space combat game. The game assembles three copies of the barrel beneath the housing. Generate only TWO disconnected objects on a genuinely transparent alpha background.
Reference image: the provided spaceship is a MATERIAL AND ART STYLE reference only. Do not draw any spaceship or deck.
Layout: upper half contains ONE barrel-less turret housing, centered around (512,256), approximately 560px wide by 390px tall, entirely between y=45 and y=465. Lower half contains ONE single long horizontal gun barrel assembly centered around (512,750), approximately 900px long by 140px thick, entirely between y=625 and y=875. There must be a wide completely transparent gap between both parts. No touching or overlapping parts. No text, labels, grid, checkerboard, frame, ground or cast shadow.
Camera: absolutely straight down orthographic plan view, zero perspective, both objects point right (+X). Top and bottom contours symmetric. No visible side faces from a tilted camera.
Housing: squat armored polygonal naval gunhouse, rear on left, front on right, broad chamfered shoulders, dark mounting ring partially visible underneath, layered cool pale steel / blue-gray armor plates, dark graphite seams and vent recesses, a few tiny recessed cyan power indicators. At the right front leave three subtle barrel sliding channels to receive three parallel gun barrels. NO barrels attached to the housing. Strong readable silhouette, substantial beveled armor, restrained wear, clean readable hand-painted game art matching the steel spaceship reference.
Single barrel: one narrow, very long heavy plasma accelerator pointing right, rear breech on left and muzzle at far right, compact piston and armored breech at left, long steel shroud, repeating dark radiator ribs and a thin restrained cyan energy channel, a squared muzzle cap. The barrel is ONE straight tube assembly, not two rails or two guns. Consistent same steel and graphite materials as the housing.
Lighting: soft near-overhead diffuse studio shading baked into panels and bevels, no strong directional lighting, no external glow or muzzle flash. Opaque solid metal within the silhouette, clean antialiased alpha edges. Attractive high-detail sprite, but broad shapes and readable panel breaks matter more than micro noise.
