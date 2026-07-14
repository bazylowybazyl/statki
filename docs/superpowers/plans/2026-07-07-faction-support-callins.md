# Faction Support Call-Ins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old mixed support roster with faction-filtered call-ins and distinct Terra Nova / pirate / independent ship identities.

**Architecture:** Keep 2D gameplay as source of truth. Ship data in `src/data/ships.js` defines categories, render profiles, display names, and sprite sources. `index.html` owns the existing DOM support panel and call-in creation; it should read a compact roster definition instead of hard-coded visible cards.

**Tech Stack:** Plain HTML/CSS/JavaScript, Vite, Node test runner, existing Canvas/WebGL pipeline through `Core3D`.

---

### Task 1: Spawn Policy Tests

**Files:**
- Modify: `tests/callInSpawnPolicy.test.mjs`
- Modify: `src/game/callInSpawnPolicy.js`

- [ ] **Step 1: Add expectations for faction-aware hull frames**

```js
test('call-in hull frame separates Terra Nova, pirate, and independent identities', () => {
  assert.equal(getCallInHullFrame('frigate_pd', getCallInSpawnPolicy('friendly')), 'terran_frigate');
  assert.equal(getCallInHullFrame('destroyer', getCallInSpawnPolicy('friendly')), 'terran_destroyer');
  assert.equal(getCallInHullFrame('battleship', getCallInSpawnPolicy('friendly')), 'terran_battleship');
  assert.equal(getCallInHullFrame('carrier', getCallInSpawnPolicy('friendly')), 'terran_carrier');
  assert.equal(getCallInHullFrame('supercapital', getCallInSpawnPolicy('friendly')), 'terran_supercapital');
  assert.equal(getCallInHullFrame('atlas', getCallInSpawnPolicy('dummy', { faction: 'independent' })), 'atlas');
  assert.equal(getCallInHullFrame('megafreighter', getCallInSpawnPolicy('dummy', { faction: 'independent' })), 'megafreighter');
});
```

- [ ] **Step 2: Run the targeted test**

Run: `node --test tests/callInSpawnPolicy.test.mjs`

Expected before implementation: FAIL for `terran_carrier` / `terran_supercapital`.

- [ ] **Step 3: Update call-in policy**

`getCallInHullFrame()` should map:

```js
if (key === 'carrier') return pirateHull ? null : 'terran_carrier';
if (key === 'supercapital') return pirateHull ? null : 'terran_supercapital';
if (key === 'atlas') return 'atlas';
```

The old `carrier_capital` compatibility path should be removed from active spawn policy.

- [ ] **Step 4: Re-run the targeted test**

Run: `node --test tests/callInSpawnPolicy.test.mjs`

Expected after implementation: PASS.

### Task 2: Ship Data And Assets

**Files:**
- Modify: `src/data/ships.js`
- Modify: `index.html`
- Modify: `tests/scaleTuning.test.mjs`

- [ ] **Step 1: Add Terra Nova large hull profiles**

Add render profiles:

```js
terran_carrier: { id: 'terran_carrier', length: 1800, radius: 320 },
terran_supercapital: { id: 'terran_supercapital', length: 2600, radius: 500 },
```

Keep `atlas` as `length: 3000`, independent supercapital.

- [ ] **Step 2: Rename template identities**

Set Terra Nova capital templates to:

```js
carrier: {
  id: 'carrier',
  faction: 'terran',
  shipName: 'Citadella',
  classId: 'carrier',
  displayName: 'Citadella',
  profile: { spriteSrc: terranCarrierImg }
}
supercapital: {
  id: 'supercapital',
  faction: 'terran',
  shipName: 'Colossus',
  classId: 'supercapital',
  displayName: 'Colossus',
  profile: { spriteSrc: terranSupercapitalImg }
}
```

In `index.html`, import:

```js
import terranCarrierImg from "./src/assets/ships/terrancarrier.png";
import terranSupercapitalImg from "./src/assets/ships/terransupercapital.png";
```

- [ ] **Step 3: Update scale test expectations**

Add assertions that `terran_carrier` and `terran_supercapital` resolve to non-Atlas sizes using source size `1672x941`.

- [ ] **Step 4: Run scale tests**

Run: `node --test tests/scaleTuning.test.mjs`

Expected: PASS.

### Task 3: Support Panel Roster

**Files:**
- Modify: `index.html`
- Modify: `assets/css/main.css`

- [ ] **Step 1: Replace hard-coded cards with a render target**

Replace static support cards with:

```html
<div class="orders-row support-faction-row">
  <div class="glass-btn active" id="support-faction-terran">Terra Nova</div>
  <div class="glass-btn" id="support-faction-pirate">Pirates</div>
  <div class="glass-btn" id="support-faction-independent">Independent</div>
</div>
<div class="support-roster" id="support-roster"></div>
```

- [ ] **Step 2: Add support roster data**

Define in `index.html`:

```js
const SUPPORT_FACTION_ROSTERS = Object.freeze({
  terran: [
    { key: 'frigate_pd', name: 'Custos', role: 'Frigate', count: 'x50', icon: 'frigate', drag: true },
    { key: 'destroyer', name: 'Hasta', role: 'Destroyer', count: 'x5', icon: 'destroyer', drag: true },
    { key: 'battleship', name: 'Bellator', role: 'Battleship', count: 'x5', icon: 'battleship', drag: true },
    { key: 'carrier', name: 'Citadella', role: 'Carrier', count: 'x1', icon: 'carrier', drag: true },
    { key: 'supercapital', name: 'Colossus', role: 'Supercapital', count: 'x1', icon: 'supercapital', drag: true },
    { key: 'fighter', name: 'Fighter Wing', role: 'Hangar squadron', count: 'x200', icon: 'fighter', click: true }
  ],
  pirate: [
    { key: 'frigate_pd', name: 'Pirate Frigate', role: 'Raider frigate', count: 'x50', icon: 'frigate', drag: true },
    { key: 'destroyer', name: 'Pirate Destroyer', role: 'Raider destroyer', count: 'x5', icon: 'destroyer', drag: true },
    { key: 'pirate_battleship', name: 'Pirate Battleship', role: 'Raider battleship', count: 'x1', icon: 'battleship', drag: true }
  ],
  independent: [
    { key: 'atlas', name: 'Atlas', role: 'Independent supercapital', count: 'x1', icon: 'supercapital', drag: true },
    { key: 'megafreighter', name: 'Megafreighter', role: 'Utility dummy', count: 'x1', icon: 'supercapital', drag: true }
  ]
});
```

- [ ] **Step 3: Render cards and attach existing drag/click handlers**

Use `renderSupportRoster()` after `setSupportFaction()`. Query cards after rendering, then bind the same click/drag behavior currently bound to `supportSpawnButtons`.

- [ ] **Step 4: Style the roster**

Add `.support-roster` and `.support-faction-row` styles matching the current compact command panel.

### Task 4: Capital Template Spawn Cleanup

**Files:**
- Modify: `index.html`
- Modify: `src/game/callInSpawnPolicy.js`
- Modify: `src/data/ships.js`

- [ ] **Step 1: Remove active `carrier_capital` entry points**

Search: `rg -n "carrier_capital|capital_carrier" index.html src tests`

Keep compatibility only where needed for old saved data or editor migration. Active support cards and `spawnCallInShip()` should use `carrier`.

- [ ] **Step 2: Ensure Citadella and Colossus use hull sprites**

`getNpcHullRenderProfileId()` should resolve `carrier` to `terran_carrier` and `supercapital` to `terran_supercapital` when `shipFrame` is present.

- [ ] **Step 3: Stop skipping carrier hull sprite generation**

Remove the special case that returns `null` for carrier hull sprites:

```js
if (!hullProfileId) return null;
```

### Task 5: Dedicated Hardpoints

**Files:**
- Modify: `src/data/hardpointEditorDefaults.js`
- Modify: `src/game/npcHardpointRuntime.js`
- Modify: `src/ui/hardpointEditor.js`

- [ ] **Step 1: Add editor ship definitions**

Add `terran_carrier` and `terran_supercapital` to the hardpoint editor ship list with the new sprites.

- [ ] **Step 2: Add default hardpoint layouts**

Create default layouts:

```js
terran_carrier: {
  label: 'Citadella',
  frontAxis: '+X',
  hardpoints: [
    { id: 'cit_main_1', type: 'main', x: 460, y: -180 },
    { id: 'cit_main_2', type: 'main', x: 460, y: 180 },
    { id: 'cit_aux_1', type: 'aux', x: -260, y: -230 },
    { id: 'cit_aux_2', type: 'aux', x: -260, y: 230 },
    { id: 'cit_hangar_1', type: 'hangar', x: -80, y: -210 },
    { id: 'cit_hangar_2', type: 'hangar', x: -80, y: 210 }
  ],
  cores: [],
  engines: { main: [], side: [] }
}
```

```js
terran_supercapital: {
  label: 'Colossus',
  frontAxis: '+X',
  hardpoints: [
    { id: 'col_main_1', type: 'main', x: 620, y: -260 },
    { id: 'col_main_2', type: 'main', x: 620, y: 260 },
    { id: 'col_main_3', type: 'main', x: 320, y: -340 },
    { id: 'col_main_4', type: 'main', x: 320, y: 340 },
    { id: 'col_missile_1', type: 'missile', x: 60, y: -360 },
    { id: 'col_missile_2', type: 'missile', x: 60, y: 360 },
    { id: 'col_aux_1', type: 'aux', x: -360, y: -240 },
    { id: 'col_aux_2', type: 'aux', x: -360, y: 240 },
    { id: 'col_special_1', type: 'special', x: 500, y: 0 }
  ],
  cores: [],
  engines: { main: [], side: [] }
}
```

- [ ] **Step 3: Map NPC editor ids**

`getEditorShipIdForNpc()` should return `terran_carrier` for carrier and `terran_supercapital` for Terra Nova supercapital. It should return `atlas` only for independent Atlas.

### Task 6: Verification

**Files:**
- Modify tests as needed.

- [ ] **Step 1: Run targeted unit tests**

Run:

```powershell
node --test tests/callInSpawnPolicy.test.mjs tests/scaleTuning.test.mjs tests/capitalAiTuning.test.mjs tests/scannerTargeting.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: Vite build completes without missing asset imports.

- [ ] **Step 3: Static cleanup scan**

Run:

```powershell
rg -n "carrier_capital|Capital</span>|data-support-spawn=\"carrier_capital\"" index.html src tests
```

Expected: no active support UI or spawn path references `carrier_capital`; remaining `capital` matches generic large-unit terminology or compatibility comments.
