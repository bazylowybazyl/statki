import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const electronMain = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

test('Electron serves the bundle from a secure isolated app origin', () => {
  assert.ok(electronMain.includes('registerSchemesAsPrivileged'));
  assert.ok(electronMain.includes("standard: true"));
  assert.ok(electronMain.includes("secure: true"));
  assert.ok(electronMain.includes("Cross-Origin-Opener-Policy"));
  assert.ok(electronMain.includes("Cross-Origin-Embedder-Policy"));
  assert.ok(electronMain.includes('webSecurity: true'));
  assert.ok(electronMain.includes('sandbox: true'));
  assert.ok(electronMain.includes('loadURL'));
  assert.equal(electronMain.includes('loadFile('), false);
});

test('Vite dev and preview keep cross-origin isolation headers', () => {
  const coopCount = viteConfig.split('Cross-Origin-Opener-Policy').length - 1;
  const coepCount = viteConfig.split('Cross-Origin-Embedder-Policy').length - 1;
  assert.equal(coopCount, 2);
  assert.equal(coepCount, 2);
  assert.ok(viteConfig.includes('preview:'));
});
