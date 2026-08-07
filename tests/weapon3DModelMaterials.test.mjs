import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/3d/weapon3DSystem.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Expected ${startMarker} to exist`);
  assert.notEqual(end, -1, `Expected ${endMarker} to exist after ${startMarker}`);
  return source.slice(start, end);
}

test('weapon models use conventionally lit materials without static bloom emitters', () => {
  const resources = sourceBetween('function ensureWeaponResources()', 'function ensureBulletInstances()');
  const turretBuilders = sourceBetween('function buildVulcanTurret', 'function resolveBulletVisualStyle');

  assert.match(resources, /makeTurretDetailMaterial[\s\S]*THREE\.MeshLambertMaterial/);
  assert.doesNotMatch(resources, /makeGlowMaterial|TURRET_GLOW_HDR|THREE\.AdditiveBlending|toneMapped\s*:\s*false/);
  assert.doesNotMatch(turretBuilders, /THREE\.AdditiveBlending|toneMapped\s*:\s*false|emissive\s*:/);
  assert.doesNotMatch(source, /\b(?:glowBlue|glowCyan|glowRed|glowAmber)\b/);
});

test('projectile materials keep their HDR glow', () => {
  const projectileMaterials = sourceBetween('function ensureBulletInstances()', 'function markMeshTree');

  assert.match(projectileMaterials, /THREE\.AdditiveBlending/);
  assert.match(projectileMaterials, /toneMapped\s*:\s*false/);
  assert.match(source, /const BULLET_HDR\s*=\s*Object\.freeze/);
});
