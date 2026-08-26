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

// Wieżyczki zjechały na kanwę 2D (src/vfx/turret2D.js) — modele 3D niosły po
// kilka oświetlanych draw calli na broń. Ten test pilnuje, żeby nie wróciły
// tylnymi drzwiami razem z materiałami i geometriami, które za nimi stały.
test('weapon3DSystem no longer builds turret meshes', () => {
  assert.doesNotMatch(source, /function\s+build\w*Turret\s*\(/);
  assert.doesNotMatch(source, /createWeapon3DMesh|createFallbackWeaponMesh|mergeTurretParts/);
  assert.doesNotMatch(source, /attachWeaponFxData|triggerMeshShotFx|updateMeshWeaponFx/);
  assert.doesNotMatch(source, /MeshLambertMaterial|MeshStandardMaterial/);
  // Kontenery per encja zniknęły razem z siatkami — zostaje instancjonowanie.
  assert.doesNotMatch(source, /\bcontainers\s*:\s*new Map\(\)/);
  assert.doesNotMatch(source, /syncWeapons\s*\(/);
});

test('turret geometry pool is reduced to the shared quad', () => {
  const resources = sourceBetween('function ensureWeaponResources()', 'function ensureBulletInstances()');
  assert.match(resources, /planeUnit:\s*new THREE\.PlaneGeometry\(1, 1\)/);
  assert.doesNotMatch(resources, /BoxGeometry|CylinderGeometry|TorusGeometry|ExtrudeGeometry|SphereGeometry/);
});

test('projectile materials keep their HDR glow', () => {
  const projectileMaterials = sourceBetween('function ensureBulletInstances()', '// ── Błyski wylotowe');

  assert.match(projectileMaterials, /THREE\.AdditiveBlending/);
  assert.match(projectileMaterials, /toneMapped\s*:\s*false/);
  assert.match(source, /const BULLET_HDR\s*=\s*Object\.freeze/);
});

// Płomień wylotowy zostaje w 3D, ale nie jako dziecko wieżyczki — bo wieżyczki
// nie ma. Ma być jedną parą InstancedMesh na całą scenę.
test('muzzle flashes stay 3D and are instanced scene-wide', () => {
  const flashes = sourceBetween('// ── Błyski wylotowe', 'function resolveBulletVisualStyle');
  assert.match(flashes, /new THREE\.InstancedMesh/);
  assert.match(flashes, /MUZZLE_HDR\.outer/);
  assert.match(flashes, /MUZZLE_HDR\.inner/);
  assert.match(flashes, /vertexColors\s*:\s*true/);
  // Pozycja wylotu przychodzi z warstwy 2D, nie z macierzy świata siatki.
  assert.match(source, /Turret2D\.triggerShot\(/);
});
