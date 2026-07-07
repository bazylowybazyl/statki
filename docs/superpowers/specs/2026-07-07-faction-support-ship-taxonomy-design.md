# Faction Support Ship Taxonomy Design

## Goal

Refactor support call-ins so ship identity is no longer mixed with class/category. `capital` remains a broad technical term for large units in AI, sensors, VFX, and comments, but the current spawnable `carrier_capital` / `capital_carrier` ship is removed from the support roster.

## Ship Taxonomy

- Faction: `terran`, `pirate`, or `independent`.
- Category/class: `frigate`, `destroyer`, `battleship`, `carrier`, `supercapital`, or utility categories such as `megafreighter`.
- Ship identity/name: the lore-visible ship type.

Terra Nova support roster:

- `Custos`: frigate.
- `Hasta`: destroyer.
- `Bellator`: battleship.
- `Citadella`: carrier.
- `Colossus`: supercapital.

Pirate support roster:

- Pirate frigate.
- Pirate destroyer.
- Pirate battleship.

Independent roster:

- `Atlas`: supercapital, independent, player iconic hull and optional independent call-in identity.
- `Megafreighter`: independent utility dummy.

## UI

The support panel gets a faction selector: Terra Nova, Pirates, Independent. The ship list is rebuilt for the selected faction so unavailable classes are not shown. Pirates do not show carrier or supercapital. The old visible "Capital" card is removed.

Existing support orders remain: Guard and Engage. Spawn mode behavior is derived from faction: Terra Nova spawns friendly support, Pirates spawn hostile pirate units, Independent spawns independent/dummy utility units unless a specific independent ship declares otherwise.

## Runtime

Use the existing 2D gameplay source of truth and 3D renderer pipeline. No new WebGL renderer or alternate render pass is introduced.

Carrier and supercapital Terra Nova assets come from `src/assets/ships/terrancarrier.png` and `src/assets/ships/terransupercapital.png`. The legacy `assets/carrier.png` path is removed from active support call-ins. `capital_carrier` should not be used as the spawnable identity for Citadella; Citadella gets its own hull render profile and ship frame.

## Hardpoints

Citadella and Colossus receive dedicated editor/default hardpoint layouts. Colossus must not reuse Atlas hardpoints. The old `supercapital -> atlas` hardpoint mapping is removed for Terra Nova Colossus while Atlas remains available as its own independent supercapital identity.

## Verification

- Unit tests around call-in spawn policy and hull frame mapping.
- Existing scale tuning tests updated for new carrier/supercapital render profiles if needed.
- Static search confirms no support card or spawn click path still uses `carrier_capital`.
- No destructive edits to unrelated dirty files.
