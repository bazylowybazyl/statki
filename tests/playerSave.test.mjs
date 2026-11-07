import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_SAVE_VERSION, DEFAULT_SYSTEM_ID, buildPlayerSave, parsePlayerSave, campaignCheckpoint,
  serializeAmounts, readAmounts, describePlayerSave
} from '../src/game/playerSave.js';
import { MISSION01_PHASES } from '../src/game/story/missions/mission01.js';
import { MISSION02_PHASES } from '../src/game/story/missions/mission02.js';
import { CAMPAIGN_PHASES } from '../src/game/story/campaign.js';

const MISSIONS = [{ phases: MISSION01_PHASES }, { phases: MISSION02_PHASES }];

function sample(over = {}) {
  return buildPlayerSave({
    worldSeed: 123456789,
    savedAt: 1_800_000_000_000,
    playTimeSec: 754.4,
    player: {
      x: 1_234_567.891, y: 6_543_210.12, angle: 1.234567,
      credits: 5321.6,
      cargo: { steel: 12.5, ice: 0, scrap: -3, ore_fe: 40 },
      miningCharges: { S: 3, M: 0, L: 1, XL: 0 },
      reputation: { terra_nova: 12.345, pirates: -50 },
      progress: { exp: 1650.4, rank: 1, missionsDone: ['m1'] },
      hullId: 'atlas'
    },
    campaign: null,
    ...over
  });
}

test('zapis: wersja, układ domyślny, liczby zaokrąglone, ładownia bez zer i ujemnych', () => {
  const s = sample();
  assert.equal(s.version, PLAYER_SAVE_VERSION);
  assert.equal(s.systemId, DEFAULT_SYSTEM_ID);
  assert.equal(s.worldSeed, 123456789);
  assert.equal(s.playTimeSec, 754);
  assert.equal(s.player.x, 1234567.9);
  assert.equal(s.player.credits, 5322);
  assert.deepEqual(s.player.cargo, { ore_fe: 40, steel: 12.5 });
  assert.deepEqual(s.player.miningCharges, { L: 1, S: 3 });
  assert.deepEqual(s.player.reputation, { pirates: -50, terra_nova: 12.35 });
  assert.deepEqual(s.player.progress, { exp: 1650, missionsDone: ['m1'] });
  assert.equal(s.campaign, null);
});

test('zapis przechodzi przez JSON i wraca bez zmian', () => {
  const s = sample({ campaign: { active: true, phase: 'counter2', m1: { boss: 'escaped', stopped: 4 }, bossEscaped: true } });
  const { save, reason } = parsePlayerSave(JSON.stringify(s), { worldSeed: 123456789, bounds: { w: 12e6, h: 12e6 } });
  assert.equal(reason, null);
  assert.equal(save.player.x, s.player.x);
  assert.equal(save.player.y, s.player.y);
  assert.equal(save.player.credits, s.player.credits);
  assert.deepEqual(save.player.cargo, s.player.cargo);
  assert.deepEqual(save.campaign, s.campaign);
});

test('odczyt odrzuca: brak, śmieci, inną wersję, inne ziarno świata, pozycję poza światem', () => {
  assert.equal(parsePlayerSave(null).save, null);
  assert.equal(parsePlayerSave('{nie json').save, null);
  assert.equal(parsePlayerSave({ ...sample(), version: 99 }).save, null);
  const other = parsePlayerSave(sample(), { worldSeed: 42 });
  assert.equal(other.save, null);
  assert.match(other.reason, /ziarno/);
  assert.equal(parsePlayerSave(sample(), { bounds: { w: 1e6, h: 1e6 } }).save, null);
  assert.equal(parsePlayerSave({ ...sample(), player: { x: 'a', y: 1 } }).save, null);
});

test('odczyt odsiewa nieznane towary ładowni', () => {
  const { save } = parsePlayerSave(sample(), { isKnownCargo: (k) => k === 'steel' });
  assert.deepEqual(save.player.cargo, { steel: 12.5 });
});

test('punkt wznowienia kampanii: misja 1 od początku, misja 2 od pierwszej fazy, ukończona = gra swobodna', () => {
  assert.deepEqual(campaignCheckpoint(null, MISSIONS), { mode: 'free' });
  assert.deepEqual(campaignCheckpoint({ active: false, phase: 'scout' }, MISSIONS), { mode: 'free' });
  for (const phase of MISSION01_PHASES) {
    assert.deepEqual(campaignCheckpoint({ active: true, phase }, MISSIONS), { mode: 'campaign', startPhase: null }, phase);
  }
  for (const phase of MISSION02_PHASES.filter(p => p !== 'done')) {
    assert.deepEqual(campaignCheckpoint({ active: true, phase }, MISSIONS), { mode: 'campaign', startPhase: MISSION02_PHASES[0] }, phase);
  }
  assert.deepEqual(campaignCheckpoint({ active: true, phase: 'done' }, MISSIONS), { mode: 'free' });
  assert.deepEqual(campaignCheckpoint({ active: true, phase: 'scout', done: true }, MISSIONS), { mode: 'free' });
  assert.deepEqual(campaignCheckpoint({ active: true, phase: null }, MISSIONS), { mode: 'campaign', startPhase: null });
});

test('pierwsza faza misji 2 to faza kampanii, do której gra umie skoczyć (skok przez misję 1)', () => {
  assert.ok(CAMPAIGN_PHASES.includes(MISSION02_PHASES[0]));
  assert.ok(CAMPAIGN_PHASES.indexOf(MISSION02_PHASES[0]) > CAMPAIGN_PHASES.indexOf(MISSION01_PHASES.at(-1)));
});

test('pomocniki map liczb', () => {
  assert.deepEqual(serializeAmounts({ b: 1.23456, a: 2, z: 0 }), { a: 2, b: 1.235 });
  assert.deepEqual(readAmounts([1, 2]), {});
  assert.deepEqual(readAmounts({ a: '3', b: 'x', c: -1 }), { a: 3 });
});

test('opis zapisu do menu', () => {
  const free = describePlayerSave(sample(), { missions: MISSIONS });
  assert.match(free, /Gra swobodna$/);
  const m2 = describePlayerSave(sample({ campaign: { active: true, phase: 'counter' } }), { missions: MISSIONS });
  assert.match(m2, /Kampania, misja 2$/);
  assert.equal(describePlayerSave(null), '');
});
