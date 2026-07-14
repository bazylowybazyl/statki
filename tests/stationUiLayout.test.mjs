import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cssFiles = [
  'assets/css/main.css',
  'public/assets/css/main.css',
];

function readRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(match, `Missing CSS rule: ${selector}`);
  return match[1];
}

function readDeclaration(rule, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rule.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`, 'm'));
  return match?.[1]?.trim() ?? null;
}

for (const cssFile of cssFiles) {
  const css = readFileSync(join(root, cssFile), 'utf8');
  const dockRule = readRule(css, '#hud-top-dock.expanded.mechanic-expanded');
  const drawerRule = readRule(css, '.hud-dock.expanded #top-drawer.mechanic-expanded');

  const dockMaxHeight = readDeclaration(dockRule, 'max-height');
  assert.ok(
    dockMaxHeight?.includes('100vh'),
    `${cssFile}: mechanic station dock must raise max-height with the viewport`
  );

  const drawerHeight = readDeclaration(drawerRule, 'height');
  assert.ok(
    drawerHeight?.includes('100vh'),
    `${cssFile}: mechanic station drawer should remain viewport-sized`
  );

  const weaponRowRule = readRule(css, '.weapon-row');
  const weaponColumns = readDeclaration(weaponRowRule, 'grid-template-columns');
  assert.ok(
    weaponColumns?.includes('28px 22px'),
    `${cssFile}: weapon rows must reserve columns for icon, hardpoint size, name, and stats`
  );

  const hpRowRule = readRule(css, '.hp-row');
  const hpColumns = readDeclaration(hpRowRule, 'grid-template-columns');
  assert.ok(
    hpColumns?.includes('28px 22px 22px') && hpColumns?.includes('24px'),
    `${cssFile}: hardpoint rows must reserve ordered columns for icon, slot size, mounted weapon size, hardpoint, weapon name, stats, and clear action`
  );
  assert.ok(
    css.includes('.weapon-size-badge.mounted'),
    `${cssFile}: hardpoint rows need a mounted-weapon size badge style`
  );
  assert.ok(
    css.includes('.weapon-size-badge.slot.size-Capital'),
    `${cssFile}: hardpoint size badges need slot-specific Capital styling`
  );
  const capitalSlotSizeRule = readRule(css, '.weapon-size-badge.slot.size-Capital');
  assert.equal(
    readDeclaration(capitalSlotSizeRule, 'background'),
    'transparent',
    `${cssFile}: Capital hardpoint slot badge must not render as a filled pink square`
  );
}

const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
assert.ok(
  indexHtml.includes("metaEl.className = 'hp-row-meta'"),
  'mechanic hardpoint rows must render a dedicated stats cell after the weapon name'
);
assert.ok(
  indexHtml.includes("const hpSize = resolvedKey === 'atlas'"),
  'Atlas editor hardpoints must display as Capital slots even when legacy markers carry a smaller size'
);
assert.ok(
  indexHtml.includes('function mechanicHardpointGlyph(hp)'),
  'mechanic hardpoint rows need a non-empty fallback glyph for empty or iconless slots'
);
assert.ok(
  indexHtml.includes("mountedBadge.className = 'weapon-size-badge mounted size-' + mountedSize"),
  'mechanic hardpoint rows must render a second size badge for the mounted weapon'
);

const cockpitCss = readFileSync(join(root, 'assets/css/cockpit-ui.css'), 'utf8');
const cockpitBridgeCss = readFileSync(join(root, 'assets/css/cockpit-ui-bridge.css'), 'utf8');
const cockpitUi = readFileSync(join(root, 'src/ui/cockpitUI.js'), 'utf8');

assert.ok(
  cockpitCss.includes('.mission-layout[hidden] { display: none !important; }'),
  'the hidden mission journal must not cover station services'
);
assert.ok(
  cockpitCss.includes('#stationPane.tablet-pane.active { display: block;'),
  'the station slot must receive the full tablet width instead of one card-grid column'
);
assert.ok(
  cockpitCss.includes('.tablet-tabs .menu-item.active { color: #ddd; background: transparent;'),
  'station tabs must use the same transparent central-panel treatment as the drive selector'
);
assert.ok(
  cockpitBridgeCss.includes('grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));'),
  'station service cards must fill the available tablet width responsively'
);
assert.ok(
  cockpitBridgeCss.includes('#tab-hangar > .mechanic-body')
    && cockpitBridgeCss.includes('grid-column: 1 / -1;'),
  'the two hangar inventories must span the full station grid'
);
assert.ok(
  cockpitBridgeCss.includes('#tab-mechanic-html .mechanic-list-scroll')
    && cockpitBridgeCss.includes('overflow-y: auto;'),
  'mechanic columns must scroll internally instead of growing the entire tablet'
);
assert.ok(
  cockpitUi.includes('requestAnimationFrame(() => this.centerStationTab(activeTab));')
    && cockpitUi.includes('centerStationTab(activeTab)'),
  'the active station tab must be centered over the central orange selector'
);
