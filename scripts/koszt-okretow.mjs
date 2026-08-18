/**
 * KOSZT PRODUKCJI OKRĘTÓW — od podzespołu aż do rudy.
 *
 * Stocznia widzi tylko cenę podzespołów, ale prawdziwy koszt okrętu to cały
 * łańcuch pod nimi: płyta kadłuba to stal i stop tytanu, stal to ruda żelaza,
 * stop to ruda tytanu i znowu stal. Bez rozwinięcia tego drzewa nie da się
 * powiedzieć, czy klasa jest opłacalna — a od tego zależy, co warto budować.
 *
 * Liczy trzy różne koszty, bo to trzy różne wąskie gardła:
 *   • KREDYTY   — wartość rynkowa zużytych podzespołów
 *   • RUDA      — ile ton surowca T0 trzeba wykopać i przewieźć
 *   • CZAS      — sekundy pochylni plus sekundy linii produkcyjnych pod spodem
 *
 * Uruchom: node scripts/koszt-okretow.mjs
 */

import { RESOURCES, RECIPES, TIER, getResourceMass } from '../src/data/resources.js';
import { WARSHIP_CLASSES, WARSHIP_ORDER } from '../src/game/traffic/shipyards.js';

const fmt = n => n.toLocaleString('pl', { maximumFractionDigits: 1 });
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

/** Która receptura wytwarza dany surowiec (pierwsza znaleziona). */
const producerOf = {};
for (const [id, recipe] of Object.entries(RECIPES)) {
  for (const [res, qty] of Object.entries(recipe.out)) {
    if (qty > 0 && !producerOf[res]) producerOf[res] = { id, recipe, qty };
  }
}

/**
 * Rozwija surowiec do składników T0 i sumuje czas linii pod spodem.
 * Receptury wielowyjściowe (elektroliza lodu) dzielą koszt po ilości wyjść —
 * inaczej tlen i wodór liczyłyby ten sam lód dwa razy.
 */
function expand(resourceId, amount, acc, depth = 0) {
  if (depth > 12) return; // zabezpieczenie, graf receptur jest acykliczny
  const source = producerOf[resourceId];
  const resource = RESOURCES[resourceId];

  if (!source || resource?.tier === TIER.RAW) {
    acc.raw[resourceId] = (acc.raw[resourceId] || 0) + amount;
    return;
  }

  const batches = amount / source.qty;
  const outputs = Object.values(source.recipe.out).reduce((a, b) => a + b, 0);
  const share = source.qty / outputs;
  acc.seconds += source.recipe.seconds * batches * share;
  acc.steps[source.id] = (acc.steps[source.id] || 0) + batches;

  for (const [res, need] of Object.entries(source.recipe.in)) {
    expand(res, need * batches, acc, depth + 1);
  }
}

const rows = WARSHIP_ORDER.slice().reverse().map(cls => {
  const acc = { raw: {}, seconds: 0, steps: {} };
  let credits = 0;
  let componentUnits = 0;
  for (const [id, qty] of Object.entries(cls.build)) {
    credits += (RESOURCES[id]?.value || 0) * qty;
    componentUnits += qty;
    expand(id, qty, acc);
  }
  const oreTons = Object.entries(acc.raw)
    .reduce((sum, [id, qty]) => sum + getResourceMass(id, qty), 0);
  return { cls, credits, componentUnits, oreTons, chainSeconds: acc.seconds, raw: acc.raw };
});

console.log('\n=== KOSZT OKRĘTU ===\n');
console.log(`  ${pad('klasa', 13)}${rpad('siła', 6)}${rpad('CR', 9)}${rpad('szt.', 6)}`
  + `${rpad('ruda t', 9)}${rpad('pochylnia', 11)}${rpad('linie', 9)}${rpad('razem s', 10)}`);
for (const r of rows) {
  console.log(`  ${pad(r.cls.label, 13)}${rpad(r.cls.power, 6)}${rpad(fmt(r.credits), 9)}`
    + `${rpad(r.componentUnits, 6)}${rpad(fmt(r.oreTons), 9)}${rpad(fmt(r.cls.seconds), 11)}`
    + `${rpad(fmt(r.chainSeconds), 9)}${rpad(fmt(r.cls.seconds + r.chainSeconds), 10)}`);
}

console.log('\n=== KOSZT JEDNEGO PUNKTU SIŁY ===');
console.log('  (niżej = wydajniej; to jest liczba, która decyduje, co opłaca się budować)\n');
console.log(`  ${pad('klasa', 13)}${rpad('CR/siłę', 10)}${rpad('ruda t/siłę', 13)}`
  + `${rpad('s/siłę', 10)}${rpad('kadłubów', 10)}`);
const base = rows[0];
for (const r of rows) {
  const perPower = r.credits / r.cls.power;
  const orePer = r.oreTons / r.cls.power;
  const secPer = (r.cls.seconds + r.chainSeconds) / r.cls.power;
  console.log(`  ${pad(r.cls.label, 13)}${rpad(fmt(perPower), 10)}${rpad(fmt(orePer), 13)}`
    + `${rpad(fmt(secPer), 10)}${rpad(fmt(r.cls.power / base.cls.power), 10)}`);
}

console.log('\n=== ZA CENĘ JEDNEGO DUŻEGO ===\n');
const big = rows[rows.length - 1];
for (const r of rows.slice(0, -1)) {
  const zaCR = big.credits / r.credits;
  const zaRude = big.oreTons / r.oreTons;
  const zaCzas = big.cls.seconds / r.cls.seconds;
  console.log(`  ${pad(`1 ${big.cls.label}`, 14)}= ${fmt(zaCR)} × ${r.cls.label}`
    + ` wg CR  |  ${fmt(zaRude)} × wg rudy  |  ${fmt(zaCzas)} × wg pochylni`);
  console.log(`  ${pad('', 14)}  siła ${big.cls.power} vs ${fmt(zaCR * r.cls.power)}`
    + ` (CR)  /  ${fmt(zaRude * r.cls.power)} (ruda)  /  ${fmt(zaCzas * r.cls.power)} (pochylnia)\n`);
}

console.log('=== SUROWIEC T0 NA OKRĘT (tony) ===\n');
const allRaw = [...new Set(rows.flatMap(r => Object.keys(r.raw)))];
console.log(`  ${pad('surowiec', 16)}${rows.map(r => rpad(r.cls.label, 12)).join('')}`);
for (const id of allRaw) {
  const cells = rows.map(r => rpad(fmt(getResourceMass(id, r.raw[id] || 0)), 12)).join('');
  console.log(`  ${pad(RESOURCES[id]?.label || id, 16)}${cells}`);
}

console.log('\n=== SKŁAD PODZESPOŁÓW ===\n');
for (const r of rows) {
  const parts = Object.entries(r.cls.build)
    .map(([id, qty]) => `${RESOURCES[id]?.label || id} ×${qty}`).join(', ');
  console.log(`  ${pad(r.cls.label, 13)} ${parts}`);
}
console.log('');
