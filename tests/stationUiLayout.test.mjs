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
}
