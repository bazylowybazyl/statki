/**
 * Spójność modelu surowców: marże receptur, poprawność kluczy, osiągalność.
 *
 * Najważniejsze, czego pilnuje: KAŻDY rafinat i komponent musi dać się
 * wyprodukować z tego, co faktycznie da się wydobyć. Zasób bez ścieżki
 * produkcji jest martwy — a przy 28 surowcach łatwo taki wprowadzić.
 */

import {
  RESOURCES,
  RESOURCE_KEYS,
  RECIPES,
  RECIPE_KEYS,
  PLANET_YIELD,
  ASTEROID_YIELD,
  getBagValue
} from '../../src/data/resources.js';
import { createSuite, runIfMain } from './harness.mjs';

// Marże z projektu ekonomii: rafinacja ~1.7x, montaż ~1.5x, recykling złomu 1.33x.
const MIN_MARGIN = 1.05;
const MAX_MARGIN = 2.2;

export function run() {
  const t = createSuite('resources');

  t.section('1. Marże receptur — przetwarzanie musi bić sprzedaż surowca');
  for (const key of RECIPE_KEYS) {
    const recipe = RECIPES[key];
    const inValue = getBagValue(recipe.in);
    const outValue = getBagValue(recipe.out);
    const margin = inValue > 0 ? outValue / inValue : 0;
    t.check(
      `${key} (${margin.toFixed(2)}x, ${((outValue - inValue) / recipe.seconds).toFixed(2)} CR/s)`,
      margin >= MIN_MARGIN && margin <= MAX_MARGIN,
      `(marża poza ${MIN_MARGIN}–${MAX_MARGIN})`
    );
  }

  t.section('2. Poprawność kluczy');
  const unknown = [];
  for (const key of RECIPE_KEYS) {
    for (const id of [...Object.keys(RECIPES[key].in), ...Object.keys(RECIPES[key].out)]) {
      if (!RESOURCES[id]) unknown.push(`${key} → ${id}`);
    }
  }
  t.check('receptury używają wyłącznie znanych surowców', unknown.length === 0, `(${unknown.join(', ')})`);

  const badAsteroid = Object.entries(ASTEROID_YIELD).filter(([, id]) => !RESOURCES[id]);
  t.check('asteroidy dają znane surowce', badAsteroid.length === 0, `(${badAsteroid.map(e => e.join('→')).join(', ')})`);

  const badPlanet = [];
  for (const [planet, entry] of Object.entries(PLANET_YIELD)) {
    for (const id of Object.keys(entry.yields)) {
      if (!RESOURCES[id]) badPlanet.push(`${planet} → ${id}`);
    }
  }
  t.check('planety dają znane surowce', badPlanet.length === 0, `(${badPlanet.join(', ')})`);

  t.section('3. Rozkłady wydobycia planetarnego sumują się do 1.0');
  for (const [planet, entry] of Object.entries(PLANET_YIELD)) {
    if (entry.rate <= 0) {
      t.check(`${planet}: brak wydobycia, pusta lista`, Object.keys(entry.yields).length === 0);
      continue;
    }
    const total = Object.values(entry.yields).reduce((a, b) => a + b, 0);
    t.close(`${planet}: wagi sumują się do 1.0`, total, 1, 0.001);
  }

  t.section('4. Osiągalność — każdy surowiec ma ścieżkę produkcji');
  const producible = new Set(Object.values(ASTEROID_YIELD));
  for (const entry of Object.values(PLANET_YIELD)) {
    for (const id of Object.keys(entry.yields)) producible.add(id);
  }
  producible.add('scrap'); // z wraków, poza łańcuchem wydobycia
  // Kilka przebiegów, bo receptury tworzą łańcuch (T0 → T1 → T2).
  for (let pass = 0; pass < RECIPE_KEYS.length; pass++) {
    let grew = false;
    for (const key of RECIPE_KEYS) {
      const recipe = RECIPES[key];
      if (!Object.keys(recipe.in).every(id => producible.has(id))) continue;
      for (const id of Object.keys(recipe.out)) {
        if (!producible.has(id)) { producible.add(id); grew = true; }
      }
    }
    if (!grew) break;
  }
  const unreachable = RESOURCE_KEYS.filter(id => !producible.has(id));
  t.check('brak surowców nie do zdobycia', unreachable.length === 0, `(${unreachable.join(', ')})`);

  t.section('5. Kompletność rejestru');
  const missingFields = RESOURCE_KEYS.filter(id => {
    const def = RESOURCES[id];
    return !def.label || !def.color || !Number.isFinite(def.value) || !Number.isFinite(def.mass);
  });
  t.check('każdy surowiec ma etykietę, kolor, wartość i masę', missingFields.length === 0, `(${missingFields.join(', ')})`);
  t.check('wartości są dodatnie', RESOURCE_KEYS.every(id => RESOURCES[id].value > 0));
  t.check('masy są dodatnie', RESOURCE_KEYS.every(id => RESOURCES[id].mass > 0));
  t.note(`${RESOURCE_KEYS.length} surowców, ${RECIPE_KEYS.length} receptur`);

  return t.results;
}

runIfMain(import.meta.url, run);
