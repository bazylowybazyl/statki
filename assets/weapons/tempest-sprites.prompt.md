# Tempest Ion — single and twin sprites

Built-in ImageGen. Final atlases: `tempest-single-atlas-v1.png` and `tempest-twin-atlas-v2.png`, both 1254 × 1254 RGBA. Runtime assembly: `src/vfx/tempestSprite2D.js`. Single atlas: Tempest Ion Lekki S, Mk I M, Ciężki L; twin atlas: Mk II M. Legacy tempest_ion_mk1/mk2 aliases use the corresponding atlas. Valkyrie keeps its previous appearance. Lower barrel parts are reused in runtime; image pixels are not procedurally edited.

## Prompt 1

Use case: stylized-concept.
Asset type: transparent modular sprite atlas for TEMPEST ION Mk I, single-barrel ion cannon, top-down space game.
Reference image role: MATERIAL / ART STYLE ONLY (cleaned Yamato atlas). Design a DIFFERENT, smaller weapon family: compact low rectangular angular gunhouse and short, chunky high-tech ion accelerator, not a battleship turret.
Create exactly TWO disconnected sprite parts against genuine transparent alpha. Square canvas. Upper half: one compact barrel-less gunhouse centered, around 500px wide and 430px high, with ONE straight central receiver channel opening to the RIGHT. Lower half: ONE separate horizontal ion barrel assembly, around 1000px long by 280px high, pointing RIGHT, rear breech at LEFT and flat muzzle tip at RIGHT. Wide transparent gap between the two objects, at least 80px. Do not show an assembled weapon, second barrel, ship, deck, or environment.
Both components seen absolutely straight from ABOVE, orthographic plan view, no perspective or tilt, mirror-symmetric across the horizontal centerline. Gray steel and graphite chassis, broad clean armor planes with bright readable edge bevels, tasteful restrained wear, recessed cyan-blue rectangular energy strips. Gunhouse is a low compact six-sided/rounded rectangular shape, one center slide at right, paired slim rectangular cooling vents near rear. One coherent functional weapon, no decorative emblems.
The single barrel is a sturdy ion accelerator, length-to-thickness around 3.5:1: rectangular rear breech, three or four transverse accelerator coil bands wrapping across the tube, dark cooling recesses, a modest cyan strip along its axis, reinforced forward focusing collar and a short flat squared muzzle at extreme right. No muzzle flash or exterior glow.
CRITICAL: NO round hardpoint sockets, NO circular mounting plates, NO white outlined rings on square plates, NO ship attachment points, NO portholes, NO round hatches, NO turrets mounted on the turret. Armor is uninterrupted except for rectangular panel seams, screws and vents. The gun itself should NOT look like a piece of spaceship deck.
Soft near-overhead lighting and contact shading within the metal only. Clean opaque metal with anti-aliased alpha edges. No text, labels, borders, red marks, checkerboard, background or cast shadow. Sprite parts should look polished and useful at small game sizes.

## Prompt 2

Use case: precise-object-edit / weapon-family variant.
Reference and edit target: the supplied TEMPEST ION single-barrel sprite atlas.
Create the matching TEMPEST ION Mk II DOUBLE-BARREL sprite atlas. Change ONLY the upper gunhouse to the wider twin version. Keep the same gun family's cool steel panels, bevels, dark graphite seams, restrained cyan indicators, vents, paint, straight overhead view and quality.
Upper housing: two parallel horizontal barrel receiver slides/openings on its RIGHT edge, at symmetric y positions roughly one quarter and three quarters down the housing, with clear separation. Widen the gunhouse vertically enough to seat both barrels. It is a compact weapon housing with stepped angular shoulders, NOT a ship. The rear is LEFT; both slots open RIGHT. Keep major forms and style matching the single version. NO barrels attached to this upper housing.
Lower component: keep EXACTLY ONE separate horizontal barrel component identical in form and orientation to the provided lower barrel. The game will draw two copies of this one barrel under/over the twin housing, so do not draw two barrels together in this atlas. One reusable long gun barrel only, pointing right, same dimensions and position as the reference.
Keep the square 1254x1254 canvas and transparent alpha. Upper housing occupies the upper area above y=760; lower barrel remains below y=890. At least 80 pixels fully transparent between disconnected parts. Two disconnected parts total.
CRITICAL: NO hardpoints, NO white circular mounting sockets, NO round rings on square plates, NO portholes or round hatches, NO extra turrets. Do not introduce circles on armor. No text, labels, grid, checkerboard, background, drop shadow, muzzle flash or external glow. Absolutely orthographic straight-down 2D game sprites with no perspective.

## Prompt 3

Use case: precise-object-edit.
Edit target: twin-barrel Tempest ion sprite atlas.
Make ONE precise mechanical correction to the UPPER HOUSING: spread its two right-facing horizontal receiver slide channels MUCH farther apart vertically. The top channel center should be around y=335, and the bottom channel center around y=725 on this 1254x1254 atlas. Currently they are too close together near y=450 and y=600. A broad solid central armor bridge must separate them. The upper receiver should be near the upper quarter of the gunhouse, and the lower near the lower quarter. Symmetric channels at the right edge. There are exactly TWO slide channels, no third center slot.
Keep the outer upper-housing silhouette approximately within x=250..1035,y=150..915. Change nearby armor/vents only as necessary to accommodate the widely separated slides. Keep the lower separate barrel pixel-aligned and unchanged, around x=27..1227,y=969..1230. Preserve the material style, blue-gray steel panels, soft bevel shading, cyan accents, true transparent alpha, square 1254x1254 canvas, and straight overhead orthographic view. No round hardpoints, mounting sockets, circles on square plates, labels, grid, background, or extra parts.
