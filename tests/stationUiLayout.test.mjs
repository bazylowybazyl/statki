import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
// Kopia public/assets/css/main.css usunięta 2026-09-26 — dev i build czytają ten
// sam plik (tests/devPublicShadow.test.mjs pilnuje, żeby nie wróciła).
const cssFiles = [
  'assets/css/main.css',
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

  const hangarSummaryRule = readRule(css, '.hangar-hull-summary');
  assert.equal(
    readDeclaration(hangarSummaryRule, 'grid-template-columns'),
    '28px minmax(0, 1fr) auto',
    `${cssFile}: hangar rows must give their name column the available width without reserving a weapon-size column`
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
  indexHtml.includes("const hpSize = resolvedKey === 'atlas'"),
  'Atlas editor hardpoints must display as Capital slots even when legacy markers carry a smaller size'
);
// Zakładka WYPOSAŻENIE (dawny MECHANIK, 2026-10-08): karty konfiguracji i refit ręczny (src/ui/station/fittingPanel.js)
// zamiast list magazynu i gniazd.
assert.ok(
  indexHtml.includes('fittingPanel = createFittingPanel(pane, buildFittingApi());'),
  'the WYPOSAŻENIE tab must mount the fitting panel (configuration cards + manual refit)'
);
const fittingCss = readFileSync(join(root, 'assets/css/station-fitting.css'), 'utf8');
assert.ok(
  fittingCss.includes('#cockpit-ui-host .cockpit-station-slot #tab-mechanic-html.fit-mode.active'),
  'the fitting panel must override the station card grid inside the cockpit tablet'
);
assert.ok(
  fittingCss.includes('container: fit / size'),
  'the fitting panel must lay out by its own size (container queries), not by the viewport'
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
