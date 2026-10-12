// PORÓWNANIE raportów audytu pyłu hali K-7 (scripts/webgpu/hala-pyl-audyt.mjs → raport.json) — miary planu poprawek
// (docs/AUDYT-pyl-hali-2026-10-12.md § 5): tunel bez pyłu za dyszami i flanki (z profili w poprzek osi), bilans pyłu
// (pokład + powietrze / liftGain), ile podnosi każde odpalenie i ile wraca po spoczynku, ostrość wirów przy ścianie,
// residuum dywergencji. Bez przeglądarki.
//
//   node scripts/webgpu/hala-pyl-porownaj.mjs .tmp/audyt-pyl/raport.json .tmp/audyt-pyl-po-1/raport.json [...]
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('podaj raport.json (jeden albo więcej)'); process.exit(1); }

const H = 28;   // bok komórki domeny [j.]
const median = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };

/**
 * Tunel bez pyłu wokół osi: komórki ciągiem od środka z pyłem < 35 % tła; TŁO = mediana profilu z dala od osi (|s| 24…40
 * komórek, bez komórek stałych) — pył hali, którego strumień nie dotyka; flanki: maks. w 10 komórkach za brzegiem tunelu
 * (× tło — „flanki nie gęstsze od tła” = ≤ ~1,2).
 */
export function tunnel(air, solid) {
  const c = (air.length - 1) >> 1;
  const bgS = [];
  for (let s = 24; s <= c; s++) for (const i of [c + s, c - s]) if (!(solid && solid[i])) bgS.push(air[i]);
  const bg = median(bgS);
  const thr = 0.35 * Math.max(bg, 0.02);
  let l = 0, r = 0;
  if (air[c] < thr) {
    while (c - l - 1 >= 0 && air[c - l - 1] < thr) l++;
    while (c + r + 1 < air.length && air[c + r + 1] < thr) r++;
  }
  const width = air[c] < thr ? l + r + 1 : 0;
  let flank = 0;
  for (let k = 1; k <= 10; k++) {
    const a = air[c - l - k], b = air[c + r + k];
    if (Number.isFinite(a) && a > flank) flank = a;
    if (Number.isFinite(b) && b > flank) flank = b;
  }
  return { bg: +bg.toFixed(3), width, widthJ: width * H, flank: +flank.toFixed(3), flankRatio: +(flank / Math.max(bg, 0.02)).toFixed(2) };
}

function analyse(file) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const by = Object.fromEntries((r.kroki || []).map((k) => [k.name, k]));
  const gain = r.domena?.tune?.liftGain || 2.4;
  const tot = (k) => (k ? +(k.floor + k.air / gain).toFixed(0) : NaN);
  const fl = (n) => by[n]?.floor ?? NaN;
  const lift1 = fl('00-postoj') - fl('12-ciag-5s');
  const rest2 = by['15-po-30s'] ? '15-po-30s' : '14-po-6s';
  const lift2 = fl(rest2) - fl('22-ciag-5s');
  const lift3 = fl('24-po-6s') - fl('32-ciag-5s');
  const back1 = fl(rest2) - fl('12-ciag-5s');
  const out = {
    file,
    pokład0: fl('00-postoj'),
    podniesione: [lift1, lift2, lift3].map((x) => +x.toFixed(0)),
    drugie_do_pierwszego: +(lift2 / Math.max(1, lift1)).toFixed(2),
    wróciło_po_spoczynku: `${back1.toFixed(0)} / ${lift1.toFixed(0)} (${rest2})`,
    wróciło_ułamek: +(back1 / Math.max(1, lift1)).toFixed(2),
    bilans: ['00-postoj', '12-ciag-5s', '14-po-6s', '15-po-30s', '22-ciag-5s', '24-po-6s', '32-ciag-5s', '34-po-6s']
      .filter((n) => by[n]).map((n) => `${n}: ${tot(by[n])} (pow. ${by[n].air.toFixed(0)})`),
    tunele: {},
    wiry: {},
    dywergencja: {}
  };
  for (const n of ['12-ciag-5s', '22-ciag-5s', '32-ciag-5s', '40-lot-3s', '41-lot-5.5s']) {
    const k = by[n];
    if (!k || !k.jet) continue;
    out.tunele[n] = k.jet.profiles.map((p) => ({ d: p.d, peak: p.peak, half: p.halfWidthCells, ...tunnel(p.air, p.solid) }));
    out.dywergencja[n] = +(k.divRms / Math.max(1e-6, k.velRms)).toFixed(3);
  }
  for (const n of ['14-po-6s', '15-po-30s', '24-po-6s', '34-po-6s']) if (by[n]?.vortex) out.wiry[n] = by[n].vortex;
  return out;
}

for (const f of files) {
  const a = analyse(f);
  console.log(`\n=== ${a.file}`);
  console.log(`pokład0 ${a.pokład0}  podniesione 1/2/3: ${a.podniesione.join(' / ')}  2./1. = ${a.drugie_do_pierwszego}  wróciło ${a.wróciło_po_spoczynku} = ${a.wróciło_ułamek}`);
  console.log('bilans (pokład + powietrze / liftGain):', a.bilans.join('  |  '));
  for (const [n, t] of Object.entries(a.tunele)) {
    console.log(`  ${n} (div/v ${a.dywergencja[n]})`);
    for (const p of t) console.log(`     d=${String(p.d).padStart(2)} peak ${String(p.peak).padStart(5)} j/s  ½v ${String(p.half).padStart(2)} kom.  tunel ${String(p.width).padStart(2)} kom. = ${String(p.widthJ).padStart(4)} j.  tło ${p.bg}  flanka ${p.flank} (× ${p.flankRatio})`);
  }
  for (const [n, v] of Object.entries(a.wiry)) {
    console.log(`  wiry ${n}: maks. ${v.maxAir}  gęstość/średnia r10 — maks. ${v.ratioMax}, p95 ${v.ratioP95}; rdzenie: ${v.cores.map((c) => `ω ${c.omega} → ${c.ratio}`).join(', ')}`);
  }
}
