import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Poprawki z audytu myśliwców (2026-09-23). index.html to jeden wielki moduł,
// więc większość strażników jest strukturalna; funkcję kadru NPC wyciągamy ze
// źródła i sprawdzamy zachowaniem.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('../index.html');
const weapon3D = read('../src/3d/weapon3DSystem.js');
const core3d = read('../src/3d/core3d.js');

function sliceFunction(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `brak: ${header}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`niedomknięta funkcja: ${header}`);
}

test('weapon-fired events carry the shooter and the 3D listener looks only at its turrets', () => {
  const dispatch = html.slice(html.indexOf("window.dispatchEvent(new CustomEvent('game_weapon_fired'"));
  assert.match(dispatch.slice(0, 600), /\n\s*shooter,\n/, 'detail musi nieść strzelca');

  assert.match(weapon3D, /_triggerShotByWorldPoint\(weaponKey, shotX, shotY, detail\.shooter/);
  assert.match(weapon3D, /Turret2D\.triggerShot\(weaponKey, shotX, shotY, shooter\)/);
  assert.match(weapon3D, /Turret2D\.findTurretKey\([^;]*detail\?\.shooter/);
});

// Wstrząs od strzałów dokładał tylko Core3D.syncCamera — sceny Three drgały,
// a kanwa 2D (wieżyczki, myśliwce) stała i warstwy się rozjeżdżały.
test('weapon camera shake moves the shared camera, not just the Three scenes', () => {
  const sync = sliceFunction(core3d, 'syncCamera(gameCamera, viewWidth, viewHeight, viewOffsetX = 0) {');
  assert.doesNotMatch(sync, /shake\?\.[xy]/, 'syncCamera nie może sam dokładać wstrząsu');
  assert.match(html,
    /const weaponShake = window\.__weapon3dCameraShake;[\s\S]{0,160}cam\.x \+= Number\(weaponShake\.x\)/);
});

test('only the hangar-launch spawnFighter remains', () => {
  const defs = html.match(/window\.spawnFighter = function/g) || [];
  assert.equal(defs.length, 1, 'stara wersja (650 u/s) była martwym kodem nadpisywanym niżej');
});

test('support-wing fighter squads use the same bow/beam frame as their wingmen', () => {
  const slot = sliceFunction(html, 'function supportGuardSlot(slotIndex) {');
  assert.doesNotMatch(slot, /leaderAng - Math\.PI \/ 2/, 'szyk obrócony o 90°');
  assert.match(slot, /rotate\(leaderLocal, leaderAng\)/);
});

// Pomocniki wiązki są funkcjami modułowymi (bez domknięć per strzał — pakiet B
// napraw po audycie bitwy 2026-09-24); sens prefiltra bez zmian.
test('beam targets are prefiltered by the shot capsule before the exact test', () => {
  const radiusAt = html.indexOf('function getBeamTargetRadius(pt) {');
  const pushAt = html.indexOf('function pushBeamTarget(obj, shooter, frameId, boundCacheable, minX, maxX, minY, maxY) {');
  assert.ok(radiusAt > 0 && pushAt > radiusAt, 'promień celu musi istnieć przed prefiltrem');
  const push = html.slice(pushAt, html.indexOf('_beamTargets.push(obj);', pushAt));
  assert.match(push, /Math\.max\(getBeamTargetRadius\(obj\), getBeamShieldCheckRadius\(obj\)\)/,
    'promień prefiltru musi obejmować i kadłub, i bańkę tarczy');
  assert.match(push, /ox < minX - bound/);
  // Dokładna pętla idzie po liście z prefiltra.
  const world = sliceFunction(html, 'function resolveBeamWorldHit(shooter, weapon, muzzleX, muzzleY, dirX, dirY, range, out) {');
  assert.match(world, /pushBeamTarget\(npc, shooter, beamFrameId/);
  assert.match(world, /const pt = _beamTargets\[k\];/);
});

// ---------------------------------------------------------------------------
// Kadr pętli rysowania NPC

const onScreenSrc = sliceFunction(html, 'function isNpcOverlayOnScreen(npc, s, zoom, viewW, viewH) {');
const isNpcOverlayOnScreen = new Function(`${onScreenSrc}\nreturn isNpcOverlayOnScreen;`)();

test('NPC overlay culling keeps what is on screen and drops the rest', () => {
  const W = 1920;
  const H = 1080;
  const fighter = { radius: 12 };
  assert.equal(isNpcOverlayOnScreen(fighter, { x: 960, y: 540 }, 1, W, H), true);
  assert.equal(isNpcOverlayOnScreen(fighter, { x: -5000, y: 540 }, 1, W, H), false);
  // Tuż za krawędzią: sprite i pasek HP jeszcze wystają.
  assert.equal(isNpcOverlayOnScreen(fighter, { x: W + 20, y: 540 }, 1, W, H), true);

  // Długi kadłub: środek poza ekranem, dziób w kadrze — nakładka musi zostać.
  const capital = { radius: 150, hexGrid: { srcWidth: 3000, srcHeight: 800 } };
  assert.equal(isNpcOverlayOnScreen(capital, { x: -1200, y: 540 }, 1, W, H), true);
  assert.equal(isNpcOverlayOnScreen(capital, { x: -4000, y: 540 }, 1, W, H), false);
});

test('NPCs without a hex body are never culled (lazy initHexBody lives in the draw)', () => {
  assert.match(html, /\(npc\.hexGrid \|\| isFighterUnit\(npc\)\) && !isNpcOverlayOnScreen\(/);
});
