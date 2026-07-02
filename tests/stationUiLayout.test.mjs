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
    hpColumns?.includes('28px 22px') && hpColumns?.includes('24px'),
    `${cssFile}: hardpoint rows must reserve ordered columns for icon, hardpoint, weapon name, stats, and clear action`
  );
  assert.ok(
    css.includes('.weapon-size-badge.slot.size-Capital'),
    `${cssFile}: hardpoint size badges need slot-specific Capital styling`
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
