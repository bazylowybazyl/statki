// Struktura pasa asteroid (src/game/asteroidBeltField.js — sampleMacro): luki Kirkwooda, łuki Hild,
// udział pól, olbrzymy pasa i miejsce zasadzki misji 2 — liczby (JSON) i mapy PNG.
//
//   node scripts/pas-struktura.mjs [--root <drzewo>] [--tag po] [--out .tmp/pas-struktura]
//        [--config "mainOuterAu=41.5;kirkwoodGaps=[]"] [--jowisz 250] [--porownaj .tmp/pas-struktura/przed.json]
//        [--bez-png]
//
// --root     drzewo z modułami gry (A/B ze starą wersją: git archive HEAD src/game src/data | tar -x -C <katalog>)
// --config   nadpisania BELT_FIELD_CONFIG (wartości JSON, rozdzielone „;”)
// --jowisz   kąt Jowisza [°] — kotwica łuków Hild i Trojańczyków (domyślnie jak w demie pasa: 250)
// --porownaj JSON innego przebiegu — jego profil promieniowy na wykresie obok
//
// Pole budowane jak w dema/asteroidy-webgpu/world.js (to samo słońce, mapa układu, ziarno). Mapy:
//   <tag>-z-gory.png     — gęstość skał PLAY z góry (log), łuki Hild i Trojańczyków, luki, olbrzymy, zasadzki
//   <tag>-rozwiniety.png — pas rozwinięty (kąt × odległość od Słońca) + profil promieniowy gęstości
// PNG rysuje headless Chrome (kanwa 2D — napisy); --bez-png — same liczby.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, startChrome, evaluate, screenshotPng, repo } from './webgpu/wspolne.mjs';
import { encodePng } from './webgpu/png.mjs';

const args = parseArgs();
const root = resolve(args.root || repo);
const tag = args.tag || 'po';
const outDir = resolve(repo, args.out || '.tmp/pas-struktura');
const jupiterDeg = Number(args.jowisz ?? 250);
mkdirSync(outDir, { recursive: true });

const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { buildSystemMap } = await imp('src/data/systemMap.js');
const { BELT_DEFINITIONS, getOutermostBeltEdgeAu } = await imp('src/data/asteroidTypes.js');
const { AsteroidBeltField } = await imp('src/game/asteroidBeltField.js');
const { BeltGiants } = await imp('src/game/asteroidBeltGiants.js');
const { planBeltAmbush } = await imp('src/game/story/beltAmbush.js');

const config = {};
for (const kv of String(args.config || '').split(';').map((s) => s.trim()).filter(Boolean)) {
  const i = kv.indexOf('=');
  config[kv.slice(0, i).trim()] = JSON.parse(kv.slice(i + 1));
}

const SUN = { x: 6000000, y: 6000000, r: 823 };
const map = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
  planetScale: 3, sunRadius: SUN.r,
  angleFor: (def) => ({ jupiter: jupiterDeg, saturn: 60, mars: 120, earth: 330 }[def.id] ?? 0) * Math.PI / 180
});
const AU = map.auInWorldUnits;
for (const p of map.planets) { p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius; p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius; }
const field = new AsteroidBeltField({ planets: map.planets, sunX: SUN.x, sunY: SUN.y, auToWorld: AU, config });
const jup = map.planets.find((p) => p.id === 'jupiter');
const jupA = Math.atan2(jup.y - SUN.y, jup.x - SUN.x);
const mainDef = BELT_DEFINITIONS.find((b) => b.id === 'main');
const at = (rAu, a) => ({ x: SUN.x + Math.cos(a) * rAu * AU, y: SUN.y + Math.sin(a) * rAu * AU });
const sample = (rAu, a) => { const p = at(rAu, a); return { ...field.sampleMacro(p.x, p.y) }; };
const r3 = (v) => Math.round(v * 1000) / 1000;
const deg = (a) => r3(((a * 180 / Math.PI) % 360 + 360) % 360);

// ── Regiony w miejscach Hild (wierzchołki L3 / L4 / L5) i przy Jowiszu ────────────
const HILDA_R = 44.43;
const regiony = [
  ['Jowisz +0°', 0], ['L4 +60°', 60], ['+120°', 120], ['L3 +180°', 180], ['+240°', 240], ['L5 −60°', -60]
].map(([nazwa, d]) => {
  const m = sample(HILDA_R, jupA + d * Math.PI / 180);
  return { nazwa, rAu: HILDA_R, region: m.region?.beltId || null, gestosc: m.density, gap: m.gap ?? 1 };
});

// ── Profil promieniowy: średnia gęstość i udział pól na okręgach co 0,05 AU ─────────
const NA = 720;
const profil = [];
for (let rAu = 34; rAu <= 49.0001; rAu += 0.05) {
  let d = 0; let pola = 0; let gap = 0; let hild = 0;
  for (let i = 0; i < NA; i++) {
    const m = sample(rAu, (i / NA) * Math.PI * 2);
    d += m.density; gap += m.gap ?? 1;
    if (m.cluster > 0.2) pola++;
    if (m.region?.beltId === 'hildas') hild++;
  }
  profil.push({ rAu: r3(rAu), gestosc: d / NA, pola: pola / NA, gap: gap / NA, hildy: hild / NA });
}
const meanIn = (a, b) => { const v = profil.filter((p) => p.rAu >= a - 1e-9 && p.rAu <= b + 1e-9); return v.reduce((s, p) => s + p.gestosc, 0) / Math.max(1, v.length); };
// Luki: gęstość w środku (±0,05) względem ramion (0,6–0,9 AU od środka) — z prawdziwych rezonansów
const LUKI = [['3:1', 37.57], ['5:2', 39.08], ['7:3', 39.70], ['2:1', 41.20]];
const luki = LUKI.map(([id, c]) => {
  const srodek = meanIn(c - 0.05, c + 0.05);
  const ramiona = (meanIn(c - 0.9, c - 0.6) + meanIn(c + 0.6, c + 0.9)) / 2;
  return { id, rAu: c, srodek, ramiona, stosunek: r3(srodek / Math.max(1e-30, ramiona)) };
});

// ── Udział pól (cluster > 0,2) na powierzchni pasa głównego i na okręgu 41,5 AU (jak test) ─────
const shareOver = (r0, r1) => {
  let n = 0; let f = 0;
  for (let j = 0; j < 60; j++) {
    const rAu = Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * (j + 0.5) / 60);
    for (let i = 0; i < 1000; i++) { if (sample(rAu, (i / 1000) * Math.PI * 2).cluster > 0.2) f++; n++; }
  }
  return r3(f / n);
};
let onCircle = 0;
for (let i = 0; i < 6000; i++) if (sample(41.5, (i / 6000) * Math.PI * 2).cluster > 0.2) onCircle++;
const udzialPol = { pasGlowny: shareOver(mainDef.innerAU, mainDef.outerAU), okrag415: r3(onCircle / 6000) };

// ── Olbrzymy pasa (asteroidBeltGiants.js) ───────────────────────────────────────────
const giants = new BeltGiants({ field, sunX: SUN.x, sunY: SUN.y, au: AU });
const olbrzymy = giants.entries.map((e) => {
  const m = { ...field.sampleMacro(e.x, e.y) };
  const core = e.site.core;
  const mc = { ...field.sampleMacro(core.x, core.y) };
  return {
    id: e.id, x: Math.round(e.x), y: Math.round(e.y),
    rAu: r3(Math.hypot(e.x - SUN.x, e.y - SUN.y) / AU), katDeg: deg(Math.atan2(e.y - SUN.y, e.x - SUN.x)),
    promien: Math.round(e.radius), gestosc: m.density, gap: m.gap ?? 1, cluster: r3(m.cluster),
    rdzen: { rAu: r3(Math.hypot(core.x - SUN.x, core.y - SUN.y) / AU), katDeg: deg(Math.atan2(core.y - SUN.y, core.x - SUN.x)), gestosc: mc.density, gap: mc.gap ?? 1 }
  };
});

// ── Zasadzka misji 2 (beltAmbush.js): kurs stocznia (57 AU) → Ziemia, Ziemia co 15°, stocznia ±0,5 rad ──
const earthR = map.planets.find((p) => p.id === 'earth').orbitRadius;
const beltHud = { inner: mainDef.innerAU * AU, outer: mainDef.outerAU * AU }; // ASTEROID_BELT w index.html
const gList = giants.entries.map((e) => ({ id: e.id, x: e.x, y: e.y, radius: e.radius }));
const zasadzki = [];
for (let k = 0; k < 24; k++) {
  const ea = (k / 24) * Math.PI * 2;
  const earth = { x: SUN.x + Math.cos(ea) * earthR, y: SUN.y + Math.sin(ea) * earthR };
  for (const off of [-0.5, 0, 0.5]) {
    const from = at(57, ea + off);
    const plan = planBeltAmbush({ from, to: earth, sun: SUN, belt: beltHud, density: (x, y) => field.sampleMacro(x, y).density, giants: gList });
    if (!plan) continue;
    const m = { ...field.sampleMacro(plan.x, plan.y) };
    zasadzki.push({ ziemiaDeg: Math.round(ea * 180 / Math.PI), off, kind: plan.kind, giant: plan.giant, rAu: r3(plan.r / AU),
      x: plan.x, y: plan.y, gestosc: m.density, cluster: r3(m.cluster), gap: r3(m.gap ?? 1) });
  }
}
const zasSum = {
  kursy: zasadzki.length,
  olbrzym: zasadzki.filter((z) => z.kind === 'giant').length,
  pole: zasadzki.filter((z) => z.kind === 'field').length,
  pas: zasadzki.filter((z) => z.kind === 'belt').length,
  wPolu: zasadzki.filter((z) => z.cluster > 0.2).length,
  wLuce: zasadzki.filter((z) => z.gap < 0.5).length,
  sredniaGestosc: zasadzki.reduce((s, z) => s + z.gestosc, 0) / Math.max(1, zasadzki.length)
};

const result = {
  tag, root, config, jowiszDeg: jupiterDeg, auWorld: AU,
  fieldConfig: { kirkwoodGaps: field.config.kirkwoodGaps ?? null, kirkwoodDensity: field.config.kirkwoodDensity ?? null, kirkwoodSoftAu: field.config.kirkwoodSoftAu ?? null, mainOuterAu: field.config.mainOuterAu ?? null },
  regiony, udzialPol, luki, olbrzymy, zasadzki: zasSum, zasadzkiLista: zasadzki, profil
};
const jsonFile = join(outDir, `${tag}.json`);
writeFileSync(jsonFile, JSON.stringify(result, null, 1) + '\n');

console.log(`[${tag}] root ${root}${Object.keys(config).length ? ` config ${JSON.stringify(config)}` : ''}`);
console.log('  regiony r = 44,43 AU:', regiony.map((r) => `${r.nazwa}: ${r.region}`).join(' | '));
console.log(`  udział pól (cluster > 0,2): pas główny ${udzialPol.pasGlowny}, okrąg 41,5 AU ${udzialPol.okrag415}`);
console.log('  luki (gęstość środek / ramiona):', luki.map((l) => `${l.id} ${l.stosunek}`).join(', '));
for (const o of olbrzymy) console.log(`  olbrzym ${o.id.padEnd(9)} r ${o.rAu} AU, ${o.katDeg}°, gap ${r3(o.gap)} | rdzeń r ${o.rdzen.rAu} AU ${o.rdzen.katDeg}° gęstość ${o.rdzen.gestosc.toExponential(3)} gap ${r3(o.rdzen.gap)}`);
console.log(`  zasadzka: ${zasSum.kursy} kursów — olbrzym ${zasSum.olbrzym}, pole ${zasSum.pole}, pas ${zasSum.pas}; miejsce w polu (cluster > 0,2) ${zasSum.wPolu}, w luce ${zasSum.wLuce}, średnia gęstość ${zasSum.sredniaGestosc.toExponential(3)}`);
console.log(`  → ${jsonFile}`);

if (args['bez-png']) process.exit(0);

// ── Mapy ─────────────────────────────────────────────────────────────────────────────
const cmp = args.porownaj && existsSync(resolve(repo, args.porownaj)) ? JSON.parse(readFileSync(resolve(repo, args.porownaj), 'utf8')) : null;
const LOG0 = Math.log10(2e-9);
const LOG1 = Math.log10(5e-6);
const STOPS = [[0, 0, 0, 0], [0.25, 18, 22, 60], [0.5, 30, 90, 140], [0.72, 110, 190, 170], [0.88, 235, 230, 140], [1, 255, 255, 250]];
const STOPS_H = [[0, 0, 0, 0], [0.25, 50, 18, 10], [0.5, 140, 60, 20], [0.72, 220, 130, 40], [0.88, 255, 200, 110], [1, 255, 245, 220]];
const STOPS_T = [[0, 0, 0, 0], [0.25, 12, 40, 18], [0.5, 30, 110, 50], [0.72, 90, 190, 90], [0.88, 190, 240, 160], [1, 245, 255, 240]];
function colorOf(m, out, o) {
  const t = m.density > 0 ? Math.min(1, Math.max(0, (Math.log10(m.density) - LOG0) / (LOG1 - LOG0))) : 0;
  const id = m.region?.beltId;
  const S = id === 'hildas' ? STOPS_H : (id === 'greeks' || id === 'trojans') ? STOPS_T : STOPS;
  let k = 1;
  while (k < S.length - 1 && S[k][0] < t) k++;
  const a = S[k - 1]; const b = S[k];
  const u = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
  out[o] = a[1] + (b[1] - a[1]) * u; out[o + 1] = a[2] + (b[2] - a[2]) * u; out[o + 2] = a[3] + (b[3] - a[3]) * u; out[o + 3] = 255;
}

// Z góry: kwadrat ±HALF AU wokół Słońca (oś y świata w dół jak na ekranie gry)
const PX = Number(args.px || 1500);
const HALF = 55;
const topRgba = new Uint8Array(PX * PX * 4);
for (let j = 0; j < PX; j++) {
  for (let i = 0; i < PX; i++) {
    const x = SUN.x + ((i + 0.5) / PX * 2 - 1) * HALF * AU;
    const y = SUN.y + ((j + 0.5) / PX * 2 - 1) * HALF * AU;
    colorOf(field.sampleMacro(x, y), topRgba, (j * PX + i) * 4);
  }
}
// Rozwinięty: kąt 0…360° (od Jowisza) × r 34…49 AU (r rośnie w górę)
const UW = 1440; const UH = 720; const UR0 = 34; const UR1 = 49;
const unRgba = new Uint8Array(UW * UH * 4);
for (let j = 0; j < UH; j++) {
  const rAu = UR1 - (j + 0.5) / UH * (UR1 - UR0);
  for (let i = 0; i < UW; i++) {
    const a = jupA + (i + 0.5) / UW * Math.PI * 2;
    const p = at(rAu, a);
    colorOf(field.sampleMacro(p.x, p.y), unRgba, (j * UW + i) * 4);
  }
}
const b64 = (w, h, data) => encodePng({ width: w, height: h, data }).toString('base64');

// Luki z configu pola; stara wersja bez luk — miejsca prawdziwych rezonansów (do porównania)
const gaps = field.config.kirkwoodGaps
  ? field.config.kirkwoodGaps.map((g) => ({ id: g.id, au: g.au, width: g.width }))
  : LUKI.map(([id, au]) => ({ id: `${id} (brak w polu)`, au, width: '—' }));
const hildaRegs = field.regions.filter((r) => r.beltId === 'hildas').map((r) => ({ rMid: r.rMid / AU, rHalf: r.rHalf / AU, angMid: r.angMid, angHalf: r.angHalf }));
const trojRegs = field.regions.filter((r) => r.beltId === 'greeks' || r.beltId === 'trojans').map((r) => ({ rMid: r.rMid / AU, rHalf: r.rHalf / AU, angMid: r.angMid, angHalf: r.angHalf }));
const mainReg = field.regions.find((r) => r.beltId === 'main');
const scene = {
  tag, PX, HALF, UW, UH, UR0, UR1, jupA, jupR: jup.orbitRadius / AU,
  mainIn: mainReg.rInner / AU, mainOut: mainReg.rOuter / AU,
  gaps, hildaRegs, trojRegs,
  giants: olbrzymy.map((o) => ({ id: o.id, rAu: o.rAu, a: o.katDeg * Math.PI / 180 })),
  ambush: zasadzki.map((z) => ({ rAu: z.rAu, a: Math.atan2(z.y - SUN.y, z.x - SUN.x), kind: z.kind })),
  profile: profil.map((p) => [p.rAu, p.gestosc]),
  profileCmp: cmp ? cmp.profil.map((p) => [p.rAu, p.gestosc]) : null, cmpTag: cmp?.tag || null,
  stats: `pola ${udzialPol.pasGlowny} (41,5 AU: ${udzialPol.okrag415}) · luki ${luki.map((l) => `${l.id} ×${l.stosunek}`).join(' ')} · Hildy: ${regiony.map((r) => `${r.nazwa.split(' ')[0]} ${r.region}`).join(', ')}`,
  configText: Object.keys(config).length ? JSON.stringify(config) : ''
};

const PAGE = `(async (S, top, un) => {
  const load = (b) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = 'data:image/png;base64,' + b; });
  document.body.style.margin = '0'; document.body.style.background = '#000';
  const c = document.createElement('canvas'); document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const font = (px, w = '') => { ctx.font = w + ' ' + px + 'px Segoe UI, Arial'; };
  const label = (t, x, y, col = '#fff', px = 15, align = 'left') => { font(px, '600'); ctx.textAlign = align; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y); };
  if (S.mode === 'top') {
    const im = await load(top);
    c.width = S.PX + 340; c.height = S.PX;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0);
    const k = S.PX / (2 * S.HALF), cx = S.PX / 2, cy = S.PX / 2;
    const P = (r, a) => [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k];
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    for (const r of [S.mainIn, S.mainOut]) { ctx.beginPath(); ctx.arc(cx, cy, r * k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,70,70,0.9)'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 5]);
    for (const g of S.gaps) { ctx.beginPath(); ctx.arc(cx, cy, g.au * k, -0.62, -0.42); ctx.stroke(); }  // tylko wycinek — reszta mapy pokazuje samą lukę
    ctx.setLineDash([]);
    const sector = (R, col) => { for (const h of R) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      ctx.arc(cx, cy, (h.rMid + h.rHalf) * k, h.angMid - h.angHalf, h.angMid + h.angHalf);
      ctx.arc(cx, cy, (h.rMid - h.rHalf) * k, h.angMid + h.angHalf, h.angMid - h.angHalf, true); ctx.closePath(); ctx.stroke(); } };
    sector(S.hildaRegs, 'rgba(255,170,60,0.95)'); sector(S.trojRegs, 'rgba(120,230,120,0.85)');
    const [jx, jy] = P(S.jupR, S.jupA);
    ctx.fillStyle = '#ffcf8a'; ctx.beginPath(); ctx.arc(jx, jy, 7, 0, Math.PI * 2); ctx.fill(); label('Jowisz', jx + 10, jy - 8, '#ffcf8a');
    for (const [n, d] of [['L4', 60], ['L3', 180], ['L5', -60]]) { const [x, y] = P(S.jupR, S.jupA + d * Math.PI / 180); label(n, x, y + 5, '#9fe39f', 15, 'center'); }
    ctx.strokeStyle = '#ffd04a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.stroke();
    for (const z of S.ambush) { const [x, y] = P(z.rAu, z.a); ctx.fillStyle = z.kind === 'giant' ? '#ff5fd2' : z.kind === 'field' ? '#ff4040' : '#aaa'; ctx.fillRect(x - 2.5, y - 2.5, 5, 5); }
    for (const g of S.giants) { const [x, y] = P(g.rAu, g.a); ctx.strokeStyle = '#5ff3ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 8, y - 8); ctx.lineTo(x + 8, y + 8); ctx.moveTo(x + 8, y - 8); ctx.lineTo(x - 8, y + 8); ctx.stroke(); label(g.id, x + 10, y + 4, '#5ff3ff', 13); }
    const lx = S.PX + 16; let ly = 32;
    label('Pas asteroid z góry — ' + S.tag, lx, ly, '#fff', 18); ly += 26;
    font(13); ctx.fillStyle = '#ccc'; ctx.textAlign = 'left';
    const lines = ['gęstość skał PLAY (sampleMacro, log)', 'kolor: pas główny / Hildy / Grecy+Troj.', '', 'czerwone przerywane (wycinek) — luki Kirkwooda', ...S.gaps.map((g) => '   ' + g.id + ': ' + g.au.toFixed(2) + ' AU mapy, szer. ' + g.width),
      'pomarańczowe — łuki Hild (rezonans 3:2)', 'zielone — Grecy (L4) i Trojańczycy (L5)', 'białe kropkowane — pas główny ' + S.mainIn.toFixed(1) + '–' + S.mainOut.toFixed(1) + ' AU', 'błękitne × — olbrzymy pasa',
      'kwadraty — zasadzki misji 2 (72 kursy):', '   czerwony = pole, różowy = olbrzym', '', ...(S.configText ? ['config: ' + S.configText] : [])];
    for (const t of lines) { ctx.fillText(t, lx, ly); ly += 19; }
    // skala kolorów
    ly += 10; const grad = ctx.createLinearGradient(lx, 0, lx + 300, 0);
    [[0, '#000'], [0.25, 'rgb(18,22,60)'], [0.5, 'rgb(30,90,140)'], [0.72, 'rgb(110,190,170)'], [0.88, 'rgb(235,230,140)'], [1, '#fffffa']].forEach(([t, col]) => grad.addColorStop(t, col));
    ctx.fillStyle = grad; ctx.fillRect(lx, ly, 300, 14); ctx.fillStyle = '#ccc'; ctx.fillText('2e-9', lx, ly + 30); ctx.textAlign = 'right'; ctx.fillText('5e-6 skał/j.²', lx + 300, ly + 30); ctx.textAlign = 'left';
  } else {
    const im = await load(un);
    const PW = 420, top0 = 44, bot = 62;
    c.width = S.UW + PW + 90; c.height = S.UH + top0 + bot;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 50, top0);
    const yOf = (r) => top0 + (S.UR1 - r) / (S.UR1 - S.UR0) * S.UH;
    const xOf = (a) => 50 + ((((a - S.jupA) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * S.UW;
    label('Pas rozwinięty (kąt od Jowisza × odległość od Słońca) — ' + S.tag, 50, 28, '#fff', 18);
    font(12); ctx.fillStyle = '#bbb'; ctx.textAlign = 'right';
    for (let r = S.UR0; r <= S.UR1; r += 1) { ctx.fillText(r + '', 44, yOf(r) + 4); }
    ctx.textAlign = 'center';
    for (let d = 0; d <= 360; d += 30) ctx.fillText(d + '°', 50 + d / 360 * S.UW, top0 + S.UH + 18);
    ctx.fillText('kąt od Jowisza (L4 = 60°, L3 = 180°, L5 = 300°)', 50 + S.UW / 2, top0 + S.UH + 34);
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,70,70,0.85)'; ctx.lineWidth = 1;
    for (const g of S.gaps) { const y = yOf(g.au); ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,70,70,0.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(48, y); ctx.moveTo(52 + S.UW, y); ctx.lineTo(70 + S.UW, y); ctx.stroke(); label(g.id, 72 + S.UW, y + 4, '#ff7070', 12); }
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    for (const r of [S.mainIn, S.mainOut]) { const y = yOf(r); ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(50 + S.UW, y); ctx.stroke(); }
    ctx.setLineDash([]);
    const box = (R, col) => { for (const h of R) { ctx.strokeStyle = col; ctx.lineWidth = 2;
      for (const sh of [-2 * Math.PI, 0, 2 * Math.PI]) { const xc = 50 + ((((h.angMid - S.jupA) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) + sh) / (2 * Math.PI) * S.UW; const w = h.angHalf / Math.PI * S.UW;
        ctx.strokeRect(xc - w / 2, yOf(h.rMid + h.rHalf), w, yOf(h.rMid - h.rHalf) - yOf(h.rMid + h.rHalf)); } } };
    ctx.save(); ctx.beginPath(); ctx.rect(50, top0, S.UW, S.UH); ctx.clip();
    box(S.hildaRegs, 'rgba(255,170,60,0.95)'); box(S.trojRegs, 'rgba(120,230,120,0.85)');
    for (const g of S.giants) { const x = xOf(g.a), y = yOf(g.rAu); ctx.strokeStyle = '#5ff3ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke(); label(g.id, x + 9, y + 4, '#5ff3ff', 12); }
    for (const z of S.ambush) { ctx.fillStyle = z.kind === 'giant' ? '#ff5fd2' : z.kind === 'field' ? '#ff4040' : '#aaa'; ctx.fillRect(xOf(z.a) - 2.5, yOf(z.rAu) - 2.5, 5, 5); }
    ctx.restore();
    // profil promieniowy (średnia po kątach, log)
    const px0 = 50 + S.UW + 130, pw = PW - 110;
    ctx.strokeStyle = '#444'; ctx.strokeRect(px0, top0, pw, S.UH);
    const L0 = Math.log10(2e-9), L1 = Math.log10(2e-6);
    const xP = (d) => px0 + Math.min(1, Math.max(0, (Math.log10(Math.max(d, 1e-12)) - L0) / (L1 - L0))) * pw;
    const plot = (pr, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); let f = true; for (const [r, d] of pr) { if (r < S.UR0 || r > S.UR1) continue; const x = xP(d), y = yOf(r); if (f) { ctx.moveTo(x, y); f = false; } else ctx.lineTo(x, y); } ctx.stroke(); };
    if (S.profileCmp) plot(S.profileCmp, 'rgba(160,160,160,0.9)');
    plot(S.profile, '#ffd860');
    font(12); ctx.fillStyle = '#bbb'; ctx.textAlign = 'center';
    for (const e of [-8, -7, -6]) ctx.fillText('1e' + e, xP(Math.pow(10, e)), top0 + S.UH + 18);
    ctx.fillText('średnia gęstość po kątach', px0 + pw / 2, top0 + S.UH + 34);
    label('profil: ' + S.tag + (S.cmpTag ? '  (szary: ' + S.cmpTag + ')' : ''), px0, top0 - 8, '#ffd860', 13);
    font(12); ctx.fillStyle = '#ddd'; ctx.textAlign = 'left'; ctx.fillText(S.stats, 50, c.height - 8);
  }
  return [c.width, c.height];
})`;

const chrome = await startChrome({ width: 2000, height: 1600, webgpu: false });
try {
  for (const mode of ['top', 'un']) {
    const size = await evaluate(chrome.cdp, `${PAGE}(${JSON.stringify({ ...scene, mode })}, ${JSON.stringify(mode === 'top' ? b64(PX, PX, topRgba) : '')}, ${JSON.stringify(mode === 'un' ? b64(UW, UH, unRgba) : '')})`, 120000);
    await chrome.cdp.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
    const file = join(outDir, `${tag}-${mode === 'top' ? 'z-gory' : 'rozwiniety'}.png`);
    await screenshotPng(chrome.cdp, file);
    console.log(`  → ${file}`);
    await evaluate(chrome.cdp, `document.body.innerHTML = ''; true`);
  }
} finally {
  await chrome.close();
}
