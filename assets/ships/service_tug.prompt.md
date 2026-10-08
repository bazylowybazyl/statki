# Holownik serwisowy (service_tug)

Output: `service_tug.png` — 1774 × 887 px (2:1), przezroczyste RGBA. Nadpisuje sprite zastępczy (przebarwiony
`heavy_freighter_empty.png`).

- Tryb: EDYCJA `assets/ships/heavy_freighter_empty.png` (dołącz jako cel edycji) — ten sam styl, kadłub frachtowca
  przerobiony na okręt serwisowy. Sylwetka może się zmienić (dłuższy pokład), więc po podmianie trzeba odświeżyć obrys
  modelu 3D (`node scripts/webgpu/obrysy-floty.mjs`), położenie dysz MAIN / SIDE i świateł (`SHIP_EDITOR_DEFAULTS.ships.service_tug`
  w `src/data/hardpointEditorDefaults.js`, `TRAFFIC_HULLS.service_tug.main` w `src/data/trafficHulls.js`, `ENGINE_FX_DEFAULTS.service_tug`)
  i pokład (`SERVICE_TUG.deckAlong` / `deckSide` w `src/game/serviceTug.js` — środek pokładu względem środka płótna).
- Rola (decyzja użytkownika 2026-10-08): przylatuje do gracza, naprawia go rojem dronów z własnej ładowni, a statek bez
  napędu bierze NA POKŁAD („na pakę”) i wiezie do portu K-7. Profil 8300 × 1520 (`HULL_RENDER_PROFILES.service_tug`) →
  w grze ~4980 j. długości. Pokład musi unieść Atlasa (sylwetka ~1700 × 600 j.): na płótnie pokład ≥ 620 × 260 px
  (lepiej ~45% długości i ~55% szerokości kadłuba), na osi statku, płaski i pusty.
- Cywilny, nieuzbrojony: bez mostka, gniazd broni i wieżyczek. Dysze MAIN: 4 bębny na rufie (jak oryginał).
  Zatoki dronów naprawczych na obu burtach przy pokładzie (rój startuje z grzbietu — w grze punkt doku nosiciela).

Use case: precise-object-edit. Edit target: the supplied transparent sprite of a civilian heavy freighter (1774×887 px)
seen from directly above in strict orthographic plan view, bow pointing exactly RIGHT (+X), engines at the LEFT (−X).
Turn it into a heavy SERVICE TUG / recovery ship that carries a disabled warship on its back. Keep the same hand-painted
style, crisp dark outlines, graphite structure and detail density, the four ribbed engine drums at the stern, the
engine block and the wedge-shaped bow with the octagonal command block. Replace the 3 × 8 grid of cargo bays with ONE
long, flat, unobstructed CRADLE DECK running along the centerline over about 45 percent of the hull length and about
55 percent of its beam: a smooth recessed deck plate with a fine grid of square plates, two continuous low rails along
both edges of the deck, six pairs of heavy hydraulic CLAMP ARMS folded flat along the deck edges (closed, pointing
inward, chunky yellow arms with black hinges), round magnetic grapple pads set into the deck in two rows, and chevron
docking guide marks painted on the deck pointing toward the bow. Along both flanks next to the deck, add four recessed
DRONE BAYS per side (small rectangular hatches with a dark open interior and a thin amber frame). Service livery: bold
safety-yellow armor panels over dark graphite structure, black-and-yellow diagonal HAZARD STRIPES on the bow edges,
on the stern shoulders and along the deck rails, clean white panels on the command block, small amber beacon domes
(unlit) at the four corners of the deck and on the bow. No weapons, no turrets, no weapon mounts, no cargo, no
containers, no crates, nothing parked on the deck. Composition: landscape 2:1 canvas (1774×887 px), ship centered,
spanning about 96 percent of the canvas width and about 66 percent of its height, bilaterally symmetric about the
horizontal centerline; one solid connected silhouette with no thin antennas or spikes. Soft even overhead lighting baked
into bevels, no cast shadow outside the hull. True transparent background with real alpha (not a painted checkerboard),
no stars or scenery, no exhaust flames, no engine glow, no glowing lamps or halos, no text, letters, numbers, logos or
insignia, no perspective or isometric tilt, no visible side walls.
