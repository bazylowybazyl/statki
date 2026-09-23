import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const capitalAi = readFileSync(new URL('../src/ai/capitalAI.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('capital AI checks line of fire only when a weapon is ready to fire', () => {
  const fireGate = capitalAi.indexOf('if (weapon.cd <= 0 && weapon._losRetryCd <= 0)');
  const lineCheck = capitalAi.indexOf('window.isLineOfFireBlocked?.(npc, bestTarget, range)');
  const spawn = capitalAi.indexOf('window.spawnBulletAdapter(npc, bestTarget');

  assert.ok(fireGate >= 0, 'weapon fire gate is missing');
  assert.ok(lineCheck > fireGate, 'LOS should run after the cooldown gate');
  assert.ok(spawn > lineCheck, 'LOS should run before projectile spawn');
  assert.equal(capitalAi.match(/isLineOfFireBlocked/g)?.length, 1, 'target scans must not perform additional LOS checks');
});

test('capital weapon scans reuse geometry and faction rocket buffers', () => {
  assert.ok(capitalAi.includes('prepareShipScanGeometry(cache, npc, geometryId)'));
  assert.ok(capitalAi.includes('cache.enemyDistSq[i]'));
  assert.ok(capitalAi.includes('window.__npcRocketThreats'));
  assert.ok(capitalAi.includes('window.__playerRocketThreats'));
  assert.ok(indexHtml.includes('window.__npcRocketThreats = _pdEnemyRocketBuffer'));
  assert.ok(indexHtml.includes('window.__playerRocketThreats = _pdPlayerRocketBuffer'));
});

test('capital scan cache rejects out-of-range entities before per-weapon scans', () => {
  assert.ok(capitalAi.includes('if (dx * dx + dy * dy > maxRangeSq) continue;'));
});

test('capital weapon AI reuses faction pools and one LOS result per target', () => {
  assert.ok(capitalAi.includes('window.getAIPirateCandidates?.()'));
  assert.ok(capitalAi.includes('window.getAIFriendlyCandidates?.()'));
  assert.ok(capitalAi.includes('losTargets[i] === bestTarget'));
  assert.equal(capitalAi.match(/isLineOfFireBlocked/g)?.length, 1);
  // Wybór celu w index.html nie skanuje npcs[]: ścieżka ogólna czyta listę
  // kontaktów strony z fleetAwareness (tylko widoczni wrogowie — taniej niż
  // pula frakcji), misja piracka nadal bierze pulę sojuszników.
  assert.ok(indexHtml.includes('return pickContactTarget(npc, {'));
  assert.ok(indexHtml.includes('window.getAIFriendlyCandidates?.()'));
});
