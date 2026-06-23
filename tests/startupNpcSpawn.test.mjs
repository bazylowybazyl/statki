import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function extractFunctionBody(source, functionName) {
  const signature = `function ${functionName}(`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${functionName} should exist`);

  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);

  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart + 1, i);
    }
  }

  assert.fail(`${functionName} body should close`);
}

test('startup NPC init does not spawn sandbox pirate or ally squads', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const body = extractFunctionBody(html, 'initNPCs');

  assert.match(body, /npcs\s*=\s*\[\]/, 'initNPCs should still reset NPC state');
  assert.doesNotMatch(body, /new Squad\('pirate',\s*'fighter'\)/);
  assert.doesNotMatch(body, /new Squad\('player',\s*'fighter'\)/);
  assert.doesNotMatch(body, /npc\.id\s*=\s*`pirate_\$\{/);
  assert.doesNotMatch(body, /npc\.id\s*=\s*`ally_\$\{/);
  assert.doesNotMatch(body, /npcs\.push\(/, 'no NPCs should be pushed during default startup init');
});
