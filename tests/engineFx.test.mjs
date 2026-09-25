import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENGINE_FX_DEFAULTS,
  ENGINE_FX_LIMITS,
  MAIN_EXHAUST_PALETTES,
  WARP_PLASMA_PALETTES,
  buildEntityEngineFx,
  fallbackNozzleRadius,
  mainExhaustExtentR,
  mainExhaustPaletteIndex,
  normalizeEngineFxShipKey,
  paletteColor,
  paletteRamps,
  resolveEngineFx,
  sanitizeEngineFx,
  warpPlasmaPaletteIndex
} from '../src/data/engineFx.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';

test('każdy kadłub z dyszami MAIN w domyślnych edytora ma dopasowany rozmiar silników', () => {
  for (const [id, cfg] of Object.entries(SHIP_EDITOR_DEFAULTS.ships)) {
    const mains = Array.isArray(cfg?.engines?.main) ? cfg.engines.main : [];
    if (!mains.length) continue;
    const def = ENGINE_FX_DEFAULTS[id];
    assert.ok(def, `${id}: brak wpisu w ENGINE_FX_DEFAULTS`);
    assert.ok(def.mainNozzle >= ENGINE_FX_LIMITS.mainNozzle[0] && def.mainNozzle <= ENGINE_FX_LIMITS.mainNozzle[1], `${id}: dysza poza zakresem`);
    assert.ok(mainExhaustPaletteIndex(def.mainPalette) >= 0, `${id}: nieznana paleta MAIN ${def.mainPalette}`);
    assert.ok(warpPlasmaPaletteIndex(def.warpPalette) >= 0, `${id}: nieznana paleta WARP ${def.warpPalette}`);
  }
});

test('piraci i Terranie mają różne palety MAIN (czytelność frakcji w bitwie)', () => {
  assert.notEqual(ENGINE_FX_DEFAULTS.pirate_frigate.mainPalette, ENGINE_FX_DEFAULTS.frigate.mainPalette);
  assert.equal(ENGINE_FX_DEFAULTS.pirate_battleship.mainPalette, ENGINE_FX_DEFAULTS.pirate_destroyer.mainPalette);
});

test('sanitizeEngineFx: zostają tylko znane, poprawne pola, liczby w zakresie', () => {
  assert.equal(sanitizeEngineFx(null), null);
  assert.equal(sanitizeEngineFx({}), null);
  assert.equal(sanitizeEngineFx({ foo: 1, mainPalette: 'nie-ma-takiej' }), null);
  const clean = sanitizeEngineFx({
    mainNozzle: 99999, mainLength: -3, mainWidth: '1.234', warpLength: 'x',
    mainPalette: 'rakieta', warpPalette: 'crimson', extra: true
  });
  assert.deepEqual(clean, {
    mainNozzle: ENGINE_FX_LIMITS.mainNozzle[1],
    mainLength: ENGINE_FX_LIMITS.mainLength[0],
    mainWidth: 1.23,
    mainPalette: 'rakieta',
    warpPalette: 'crimson'
  });
});

test('resolveEngineFx: zapis nadpisuje domyślne pole po polu', () => {
  const base = resolveEngineFx('frigate');
  assert.equal(base.mainNozzle, ENGINE_FX_DEFAULTS.frigate.mainNozzle);
  const merged = resolveEngineFx('frigate', { mainLength: 1.8 });
  assert.equal(merged.mainLength, 1.8);
  assert.equal(merged.mainNozzle, ENGINE_FX_DEFAULTS.frigate.mainNozzle, 'niezapisane pola zostają z kodu');
  assert.equal(merged.mainPalette, ENGINE_FX_DEFAULTS.frigate.mainPalette);
  // Zmiana jednego statku nie rusza innych (dawny globalny mnożnik Main W/L).
  assert.equal(resolveEngineFx('destroyer').mainLength, ENGINE_FX_DEFAULTS.destroyer.mainLength);
});

test('kadłub bez wpisu: brak dyszy w pikselach, palety z zapasu', () => {
  const fx = resolveEngineFx('container_ship');
  assert.equal(fx.mainNozzle, null);
  assert.ok(mainExhaustPaletteIndex(fx.mainPalette) >= 0);
  assert.ok(warpPlasmaPaletteIndex(fx.warpPalette) >= 0);
});

test('aliasy kluczy kadłuba z gry trafiają w id edytora', () => {
  assert.equal(normalizeEngineFxShipKey('player'), 'atlas');
  assert.equal(normalizeEngineFxShipKey('carrier'), 'terran_carrier');
  assert.equal(normalizeEngineFxShipKey('TERRAN_FRIGATE'), 'frigate');
  assert.equal(normalizeEngineFxShipKey('pirate_frigate'), 'pirate_frigate');
  assert.equal(normalizeEngineFxShipKey(''), '');
});

test('buildEntityEngineFx: dysza w pikselach PNG przez skalę markerów, indeksy palet', () => {
  const fx = buildEntityEngineFx('carrier', { mainNozzle: 80, mainPalette: 'bor' }, 0.5);
  assert.equal(fx.shipKey, 'terran_carrier');
  assert.equal(fx.nozzleRadius, 80 * 0.5 * 0.5);
  assert.equal(MAIN_EXHAUST_PALETTES[fx.mainPaletteIndex].id, 'bor');
  assert.equal(WARP_PLASMA_PALETTES[fx.warpPaletteIndex].id, ENGINE_FX_DEFAULTS.terran_carrier.warpPalette);
  const noScale = buildEntityEngineFx('atlas', null, 0);
  assert.equal(noScale.nozzleRadius, ENGINE_FX_DEFAULTS.atlas.mainNozzle * 0.5, 'skala ≤ 0 = 1');
  assert.equal(buildEntityEngineFx('container_ship').nozzleRadius, null);
});

test('zapasowy promień dyszy rośnie z długością kadłuba', () => {
  const small = fallbackNozzleRadius(192);
  const big = fallbackNozzleRadius(1800);
  assert.ok(small > 0 && big > small);
  assert.ok(big > 20 && big < 60, `Atlas: ${big}`);
});

test('struga MAIN: dłuższa przy większym ciągu, ogon dłuższy od rdzenia', () => {
  const idle = mainExhaustExtentR(0.06);
  const full = mainExhaustExtentR(1);
  const boost = mainExhaustExtentR(1.5);
  assert.ok(full.core > idle.core && boost.core > full.core);
  assert.ok(full.tail > full.core);
  const longer = mainExhaustExtentR(1, 2);
  assert.ok(Math.abs(longer.core - full.core * 2) < 1e-9, 'mnożnik długości statku skaluje strugę liniowo');
});

test('palety MAIN: unikalne id, rampy 4×RGB, barwa skończona w całym zakresie', () => {
  const ids = new Set();
  const out = [0, 0, 0];
  for (const pal of MAIN_EXHAUST_PALETTES) {
    assert.ok(!ids.has(pal.id), `powtórzone id ${pal.id}`);
    ids.add(pal.id);
    for (const ramp of paletteRamps(pal)) {
      assert.equal(ramp.length, 4, `${pal.id}: rampa ma mieć 4 progi`);
      for (const stop of ramp) assert.equal(stop.length, 3);
    }
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      for (const g of [0, 0.5, 1]) {
        paletteColor(pal, t, g, out);
        assert.ok(out.every((v) => Number.isFinite(v) && v >= 0), `${pal.id}: barwa (${t}, ${g})`);
      }
    }
    // rdzeń strugi świeci w bloomie (HDR > 1)
    paletteColor(pal, 1, 0, out);
    assert.ok(Math.max(...out) > 1, `${pal.id}: rdzeń bez HDR`);
  }
  assert.ok(MAIN_EXHAUST_PALETTES.length <= 32, 'atlas palet ma 32 wiersze palet');
});

test('palety WARP: komplet barw dla plume, poświaty i cząstek', () => {
  const ids = new Set();
  for (const pal of WARP_PLASMA_PALETTES) {
    assert.ok(!ids.has(pal.id));
    ids.add(pal.id);
    assert.equal(pal.core.length, 2);
    assert.equal(pal.body.length, 4);
    assert.equal(pal.outer.length, 2);
    assert.equal(pal.glow.length, 3);
    assert.equal(pal.part.length, 3);
  }
});
