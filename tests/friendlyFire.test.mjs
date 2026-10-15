import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { projectilePassesAlly, beamPassesAlly, projectileHasIff, fighterSideOf, fighterSideSparesAlly } from '../src/game/friendlyFire.js';

const player = { friendly: true, pos: { x: 0, y: 0 } };
const playerProxy = { _isPlayerShip: true, friendly: true };
const ownFighter = { fighter: true, type: 'fighter', friendly: true, playerOwned: true };
const pirateFighter = { fighter: true, type: 'interceptor', friendly: false, isPirate: true };
const ally = { type: 'destroyer', friendly: true };
const pirate = { type: 'frigate', friendly: false, isPirate: true };

test('pocisk własnego myśliwca przelatuje przez gracza i sojuszników, trafia piratów', () => {
  const b = { owner: 'player', type: 'ciws', source: ownFighter };
  assert.equal(projectilePassesAlly(b, playerProxy), true);
  assert.equal(projectilePassesAlly(b, ally), true);
  assert.equal(projectilePassesAlly(b, { ...ownFighter }), true);
  assert.equal(projectilePassesAlly(b, pirate), false);
  assert.equal(projectilePassesAlly(b, pirateFighter), false);
});

test('mikrorakieta myśliwca też ma IFF (rakieta po śmierci celu nie trafia Atlasa)', () => {
  const r = { owner: 'player', type: 'rocket', source: ownFighter };
  assert.equal(projectilePassesAlly(r, playerProxy), true);
  assert.equal(projectilePassesAlly(r, pirate), false);
});

test('CIWS gracza nie trafia własnych myśliwców, trafia wrogie', () => {
  const b = { owner: 'player', type: 'ciws', source: player };
  assert.equal(projectilePassesAlly(b, ownFighter), true);
  assert.equal(projectilePassesAlly(b, pirateFighter), false);
});

test('pirackie myśliwce trafiają gracza, nie trafiają piratów', () => {
  const b = { owner: 'npc', type: 'beam', source: pirateFighter };
  assert.equal(projectilePassesAlly(b, playerProxy), false);
  assert.equal(projectilePassesAlly(b, ownFighter), false);
  assert.equal(projectilePassesAlly(b, pirate), true);
});

test('ciężkie działa okrętów zostają z friendly fire, wraki łapią wszystko', () => {
  assert.equal(projectileHasIff({ owner: 'player', type: 'rail', source: player }), false);
  assert.equal(projectilePassesAlly({ owner: 'player', type: 'rail', source: player }, ally), false);
  assert.equal(projectilePassesAlly({ owner: 'player', type: 'ciws', source: ownFighter }, { isWreck: true, friendly: true }), false);
});

test('laser PD myśliwca przechodzi przez swoich, nie przez wroga', () => {
  assert.equal(beamPassesAlly(ownFighter, player, player), true);
  assert.equal(beamPassesAlly(ownFighter, ally, player), true);
  assert.equal(beamPassesAlly(ownFighter, pirateFighter, player), false);
  assert.equal(beamPassesAlly(pirateFighter, player, player), false);
  assert.equal(beamPassesAlly(ally, player, player), false);   // wiązka okrętu — jak dotąd
});

test('index.html: IFF w pętli pocisków i wiązce, myśliwce gracza poza frakcjami', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(html, /if \(b\.source && b\.source === realNpc\) continue;\n[^\n]*\n\s*if \(projectilePassesAlly\(b, npc\)\) continue;/);
  assert.match(html, /if \(beamPassesAlly\(shooter, pt, playerShip\)\) continue;/);
  assert.match(html, /function resolveEntityFaction\(entity\) \{\n\s*if \(!entity\) return null;[\s\S]{0,600}if \(entity\.playerOwned\) return null;/);
  assert.match(html, /function spawnFighterFromTube\([\s\S]{0,400}f\.playerOwned = true;/);
});

test('rakieta 3D myśliwca (strona zapamiętana przy wyrzucie) nie rani swojej strony, rani wroga', () => {
  const side = fighterSideOf(ownFighter, player);
  assert.equal(side, 1);
  assert.equal(fighterSideSparesAlly(side, player, player), true);
  assert.equal(fighterSideSparesAlly(side, ally, player), true);
  assert.equal(fighterSideSparesAlly(side, playerProxy, player), true);
  assert.equal(fighterSideSparesAlly(side, pirate, player), false);
  const pir = fighterSideOf(pirateFighter, player);
  assert.equal(pir, 0);
  assert.equal(fighterSideSparesAlly(pir, player, player), false);
  assert.equal(fighterSideSparesAlly(pir, pirate, player), true);
  // rakieta okrętu: bez filtra (friendly fire zostaje)
  assert.equal(fighterSideOf(player, player), -1);
  assert.equal(fighterSideSparesAlly(-1, ally, player), false);
});

test('rocketSystem3D: strona myśliwca w rakiecie, filtr w trafieniu głowicy i w wybuchu', () => {
  const src = readFileSync(new URL('../src/game/rockets/rocketSim.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /r\.fighterSide = fighterSideOf\(r\.shooter,/);
  assert.match(src, /_onHit\(r[^\n]*\{[\s\S]{0,300}fighterSideSparesAlly\(r\.fighterSide, target, window\.ship\)/);
  assert.match(src, /_applyBlastDamage\(r, ex, ez\) \{[\s\S]{0,1400}fighterSideSparesAlly\(side, player, player\)[\s\S]{0,1600}fighterSideSparesAlly\(side, npc, player\)/);
});
