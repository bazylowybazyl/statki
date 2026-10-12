// Pas asteroid w PRAWDZIWEJ grze (zadanie 21): sceny pola w miejscach scen dema
// dema/asteroidy-webgpu (te same wzory miejsc: world.js dema liczy je z tego samego pola),
// zrzuty, statystyki pasa, błędy konsoli / walidacji WebGPU, kolizja z olbrzymem.
//
//   node scripts/webgpu/asteroidy-gra.mjs [--out katalog] [--port 5355] [--sceny pole,noc,burza,luka,luka-bez,olbrzym]
//        [--rozmiar 1920x1080] [--klatki 30] [--kolizja] [--wydajnosc]
//
// Strona dostaje harness (scripts/webgpu/harness-strona.js: zegar wirtualny, Math.random
// z ziarnem, klatki na żądanie). Miejsca: `SPOTS` / `FIELD_GIANTS` z dema/asteroidy-webgpu/
// world.js (import w stronie — pole dema = pole gry: ten sam pas, ziarno, skala, słońce).
// --kolizja: statek gracza leci w ścianę olbrzyma — pozycja przed / po, głębokość wbicia.
// --wydajnosc [--przebiegi 3] [--bok 24] [--konfig a,b]: czas rzeczywisty (PerfHUD, Core3D, pas) — próżnia
//            i gęste pole, bez bitwy i z bitwą bok × bok (jak zrzuty.mjs --wydajnosc); każda konfiguracja
//            w świeżej stronie, przebiegi na przemian (kolejność odwrócona co drugi); po 6 s rozbiegu 12 próbek
//            co 1 s → mediana przebiegu; raport: mediana median i rozrzut (min–max) przebiegów. Bez --sceny
//            same pomiary (sceny pomija).
// --ab [--rundy 3] [--konfig bitwa-pole]: JEDNA strona z bitwą w polu, warianty pasa na przemian (pełny,
//            mapy cienia dla domyślnych 2 statków, bez map cienia, bez pasa) — koszt części pasa bez szumu między stronami.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const port = Number(args.port || 5355);
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/21/gra');
const warmFrames = Number(args.klatki || 30);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const SEED = 0x5eed1234;
// Kampania jest domyślna (StoryOptions czyta localStorage raz przy starcie strony): bez tego klik
// „single” startuje intro w doku K-7 i gra nie rusza — gra swobodna bez samouczka, ustawiona przed nawigacją.
const GRA_SWOBODNA = `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch (e) {}\n`;
const IGNORE = [/favicon\.ico/, /AudioSys/, /Unable to decode audio data/, /powerPreference option is currently ignored/, /\[vite\]/, /DevTools/, /GPU stall due to ReadPixels/];

// Burza powtarzalna dla porównania z demem (gra i demo — ten sam kod, ten sam symulator
// src/game/asteroidStorms.js): los symulatora od ziarna, bez piorunów i błysków losowych,
// piorun wymuszony 1400 j. przed dziobem, błysk w chmurach za 18 klatek (w chwili zrzutu
// ~4 klatki po starcie), 2600 j. za lewą burtą, 5200 j. pod płaszczyzną. Wolne zmienne:
// sim, sx, sy, sa (statek), force(x, y) → bool.
export const STORM_STAGE = `
  const { mulberry32 } = await import('/src/game/asteroidStorms.js');
  sim.rng = mulberry32(0x5707);
  sim.strikes.length = 0; sim.sheets.length = 0; sim.cooldown.clear();
  sim.config.strikeRate = 0; sim.config.sheetRate = 0;
  const ok = force(sx + Math.cos(sa) * 1400, sy + Math.sin(sa) * 1400);
  const bx = -Math.sin(sa), by = Math.cos(sa);
  sim.sheets.push({ id: 900001, t0: sim.time + 18 / 60, pulses: [{ at: 0, amp: 1 }, { at: 0.09, amp: 0.7 }], duration: 0.6,
    x: sx - Math.cos(sa) * 1200 - bx * 2600, y: sy - Math.sin(sa) * 1200 - by * 2600, z: -5200, range: 8200 });
  return ok;`;

// Populacje (strumień E): na okręgu window.__popScene.r [AU mapy] (opcjonalnie tylko w regionie beltId) punkt
// o największej gęstości × oświetlenie², Atlas i kamera tam; liczba skał PLAY w kadrze → log [pop].
const POP_PICK = `
  const P0 = window.__popScene; let best = null;
  for (let i = 0; i < 3600; i++) { const a = (i / 3600) * Math.PI * 2;
    const x = F.sunX + Math.cos(a) * P0.r * au, y = F.sunY + Math.sin(a) * P0.r * au;
    const m = F.sampleMacro(x, y); if (P0.beltId && m.region?.beltId !== P0.beltId) continue;
    const s = m.density * B.sunT(x, y) ** 2; if (!best || s > best.s) best = { s, x, y, a, reg: m.region?.beltId, d: m.density }; }
  DevScene.teleport(best.x, best.y, best.a + Math.PI / 2); S.cam(best.x, best.y, P0.zoom);
  let n = 0; const hw = 1920 / P0.zoom * 0.5, hh = 1080 / P0.zoom * 0.5;
  F.forEachRockInRect(0, best.x - hw, best.y - hh, best.x + hw, best.y + hh, 0, () => { n++; });
  console.log('[pop] ' + JSON.stringify({ r: P0.r, region: best.reg, gestosc: best.d, skalyPlayWKadrze: n }));`;

// Sceny typów (A1): GŁĄB pola (cluster ≥ 0,6 — tam są rudy; obrzeże to sam wypełniacz) na okręgu
// window.__popScene.r w regionie beltId, możliwie oświetlona (gęstość × (0,2 + słońce)); Atlas i kamera tam.
const TYPES_PICK = `
  const P0 = window.__popScene; let best = null;
  for (let i = 0; i < 3600; i++) { const a = (i / 3600) * Math.PI * 2;
    const x = F.sunX + Math.cos(a) * P0.r * au, y = F.sunY + Math.sin(a) * P0.r * au;
    const m = F.sampleMacro(x, y); if (P0.beltId && m.region?.beltId !== P0.beltId) continue;
    const s = (m.cluster >= 0.6 ? 1 : 0.001) * m.density * (0.2 + B.sunT(x, y)); if (!best || s > best.s) best = { s, x, y, a, reg: m.region?.beltId, d: m.density }; }
  DevScene.teleport(best.x, best.y, best.a + Math.PI / 2); S.cam(best.x, best.y, P0.zoom);
  const hw = 1920 / P0.zoom * 0.5, hh = 1080 / P0.zoom * 0.5;`;

// Rodziny kolizyjne (A2): pole rodziny `id` (szczyty z field.familyPeaks — w grze z kotwicami Westy i Hygiei
// tego świata), w nim najjaśniejszy głęboki punkt tej rodziny; Atlas i kamera tam, zoom 0,35; log [typy]
// z nazwą rodziny (familyAt).
const FAMILY_PICK = (id) => `
  const F = B.field, au = F.auToWorld; const fi = F.families.findIndex((f) => f.id === '${id}');
  let best = null;
  for (const p of F.familyPeaks()) { if (p.fam !== fi) continue;
    for (let gx = -60000; gx <= 60000; gx += 6000) for (let gy = -60000; gy <= 60000; gy += 6000) {
      const x = p.x + gx, y = p.y + gy; const m = F.sampleMacro(x, y);
      if (m.region?.beltId !== 'main' || m.cluster < 0.6) continue;
      if (F.familyAt(x, y)?.id !== '${id}') continue;
      const s = F.sampleMacro(x, y).density * (0.2 + B.sunT(x, y)); if (!best || s > best.s) best = { s, x, y, reg: 'main' }; } }
  if (!best) throw new Error('brak pola rodziny ${id}');
  DevScene.teleport(best.x, best.y, Math.atan2(best.y - F.sunY, best.x - F.sunX)); S.cam(best.x, best.y, 0.35);
  const hw = 1920 / 0.35 * 0.5, hh = 1080 / 0.35 * 0.5;
  window.__popScene = { r: Math.hypot(best.x - F.sunX, best.y - F.sunY) / au };
  const P0 = window.__popScene;
  console.log('[typy] rodzina ' + JSON.stringify({ id: '${id}', nazwa: F.familyAt(best.x, best.y)?.label || null, rAu: +P0.r.toFixed(2) }));`;

// Skład kadru (po TYPES_PICK: best, hw, hh): udziały typów skał PLAY → log [typy].
const TYPES_LOG = `
  const { ROCK_TYPES } = await import('/src/game/asteroidRockKinds.js');
  const cnt = {}; let tot = 0;
  F.forEachRockInRect(0, best.x - hw, best.y - hh, best.x + hw, best.y + hh, 0, (r) => { const t = ROCK_TYPES[r.type]; cnt[t] = (cnt[t] || 0) + 1; tot++; });
  const typy = Object.entries(cnt).sort((p, q) => q[1] - p[1]).map(([t, c]) => t + ' ' + Math.round(100 * c / tot) + '%');
  console.log('[typy] ' + JSON.stringify({ r: P0.r, region: best.reg, skaly: tot, typy }));`;

// Sceny: js — ciało funkcji async w stronie (W = world.js dema, S = pomocniki harnessu,
// H = harness, B = pas gry). Wzory miejsc i zoom jak `setScene` dema.
export const BELT_SCENES = {
  pole: {
    opis: 'Gęste pole (scena 5 dema): Atlas w rdzeniu pola, kąt −0,4, zoom 1',
    js: `const s = W.SPOTS.field; DevScene.teleport(s.x, s.y, -0.4); S.cam(s.x, s.y, 1.0);`
  },
  noc: {
    opis: 'Głąb pola — noc (scena 7 dema): najciemniejszy punkt linii przelotu, dziób od słońca, zoom 0,6',
    js: `await W.precomputeOcclusion(); const s = W.findDeepSpot(); DevScene.teleport(s.x, s.y, W.FLIGHT.angle); S.cam(s.x, s.y, 0.6);`
  },
  burza: {
    opis: 'Burza (scena 0 dema): skały energetyczne w mroku, piorun wymuszony przed dziobem, zoom 0,4',
    js: `await W.precomputeOcclusion(); const s = W.findStormSpot() || W.SPOTS.field; DevScene.teleport(s.x, s.y, s.angle || 0); S.cam(s.x, s.y, 0.4);`,
    burza: true
  },
  // Luka Kirkwooda w oświetlonym polu (asteroidBeltField.js: kirkwoodGaps): luka i kąt, przy których skał
  // jest dużo po obu stronach luki, a słońce dochodzi do środka (rdzeń pola jest czarny — luki tam nie widać);
  // Atlas i kamera w środku luki. Liczba skał PLAY w pasie ±0,1 AU wokół luki → window.__lukaCam.n.
  luka: {
    opis: 'Luka Kirkwooda przez oświetlone pole: pas rzadkich skał w poprzek kadru, Atlas w środku luki, zoom 0,05',
    js: `const F = B.field, au = F.auToWorld;
         const gaps = F.config.kirkwoodGaps || [{ id: '5:2', au: 39.08, width: 0.4 }];
         let best = null;
         for (const g of gaps) for (let i = 0; i < 1800; i++) { const a = (i / 1800) * Math.PI * 2;
           const P = (rAu) => [F.sunX + Math.cos(a) * rAu * au, F.sunY + Math.sin(a) * rAu * au];
           const d = (rAu) => F.sampleMacro(...P(rAu)).density;
           const s = Math.min(d(g.au - g.width / 2 - 0.25), d(g.au + g.width / 2 + 0.25)) * B.sunT(...P(g.au)) ** 2;
           if (!best || s > best.s) best = { s, a, g }; }
         const c = { x: F.sunX + Math.cos(best.a) * best.g.au * au, y: F.sunY + Math.sin(best.a) * best.g.au * au };
         DevScene.teleport(c.x, c.y, best.a + Math.PI / 2); S.cam(c.x, c.y, 0.05);
         const count = () => { let n = 0; F.forEachRockInRect(0, c.x - 20000, c.y - 20000, c.x + 20000, c.y + 20000, 0, (r) => {
           if (Math.abs(Math.hypot(r.x - F.sunX, r.y - F.sunY) / au - best.g.au) < 0.1) n++; }); return n; };
         window.__lukaCam = { x: c.x, y: c.y, luka: best.g.id, rAu: best.g.au, kat: best.a, T: B.sunT(c.x, c.y), count, n: count() };
         console.log('[luka] ' + JSON.stringify({ luka: best.g.id, rAu: best.g.au, T: +window.__lukaCam.T.toFixed(3), skalyWPasie: window.__lukaCam.n }));`
  },
  // A/B: ta sama klatka bez luk (warstwy skał wczytane od nowa; cień pól policzony na starcie zostaje z lukami).
  'luka-bez': {
    opis: 'Luka 5:2 — A/B: to samo miejsce z wyłączonymi lukami (pole bez luk, warstwy skał od nowa)',
    js: `const F = B.field; const L = window.__lukaCam; if (!L) throw new Error('najpierw scena luka');
         F._hasGaps = false; F.clearCache(); for (const layer of B.layers) layer.clear(); B.fog?._macroCache?.clear();
         S.cam(L.x, L.y, 0.05);
         console.log('[luka-bez] ' + JSON.stringify({ luka: L.luka, skalyWPasie: L.count() }));`,
    po: `const F = window.__asteroidBelt.field; F._hasGaps = Array.isArray(F.config.kirkwoodGaps) && F.config.kirkwoodGaps.length > 0;
         F.clearCache(); for (const layer of window.__asteroidBelt.layers) layer.clear(); window.__asteroidBelt.fog?._macroCache?.clear();`
  },
  // Populacje małych ciał (strumień E, 2026-10-12): przy halach K-7 Ziemi i Marsa pas ma SPAĆ (stats.active false —
  // wycięcia `holes`); w NEA, Hungariach, rojach Trojańczyków i Kuiperze — najgęstszy punkt pasma w oświetleniu.
  k7: {
    opis: 'Hala K-7 Ziemi (kompleks 0), zoom 0,45 — pas śpi (wycięcie NEA wokół Ziemi)',
    js: `const { k7HallCenter } = await import('/src/game/story/k7Dock.js'); const pl = window.planets.find((p) => p.id === 'earth');
         const h = k7HallCenter(pl, 0); DevScene.teleport(h.x, h.y, 0); S.cam(h.x, h.y, 0.45);`
  },
  mars: {
    opis: 'Hala K-7 Marsa (kompleks 1), zoom 0,45 — pas śpi (wycięcia NEA i Hungarii wokół Marsa)',
    js: `const { k7HallCenter } = await import('/src/game/story/k7Dock.js'); const pl = window.planets.find((p) => p.id === 'mars');
         const h = k7HallCenter(pl, 1); DevScene.teleport(h.x, h.y, 0); S.cam(h.x, h.y, 0.45);`
  },
  nea: {
    opis: 'NEA (26,5 AU mapy): rzadkie pojedyncze skały, zoom 0,12',
    js: `const F = B.field, au = F.auToWorld; window.__popScene = { r: 26.5, zoom: 0.12 };` + POP_PICK
  },
  // A/B: ta sama klatka co `nea` bez pasa (B.enabled = false) — co w kadrze należy do pasa.
  'nea-bez': {
    opis: 'NEA — A/B: to samo miejsce, pas wyłączony',
    js: `B.enabled = false; const c = window.camera; S.cam(c.x, c.y, c.zoom);`,
    po: `window.__asteroidBelt.enabled = true;`
  },
  hungarie: {
    opis: 'Hungarie (34,65 AU mapy), zoom 0,12',
    js: `const F = B.field, au = F.auToWorld; window.__popScene = { r: 34.65, zoom: 0.12 };` + POP_PICK
  },
  trojanie: {
    opis: 'Rój L4 (Grecy) — rdzeń przy punkcie L4, zoom 0,12',
    js: `const F = B.field, au = F.auToWorld; window.__popScene = { r: 50.2, zoom: 0.12, beltId: 'greeks' };` + POP_PICK
  },
  kuiper: {
    opis: 'Zimny rdzeń pasa Kuipera (133,5 AU mapy), zoom 0,12',
    js: `const F = B.field, au = F.auToWorld; window.__popScene = { r: 133.5, zoom: 0.12 };` + POP_PICK
  },
  // Skład pasa z odległością (A1, docs/PLAN-pas-realizm.md § Typy): głąb pola na okręgu (TYPES_PICK),
  // zoom 0,3, skład skał PLAY w kadrze → log [typy].
  ...Object.fromEntries([
    ['typy-wewn', 36.0, 'main', 'wewnętrzny pas (36,0 AU): S'],
    ['typy-westa', 36.9, 'main', 'rodzina Westy (36,9 AU): S + V'],
    ['typy-srodek', 38.6, 'main', 'środek pasa (38,6 AU): S + C, szczyt M'],
    ['typy-zewn', 40.6, 'main', 'zewnętrzny pas (40,6 AU): C, lód Themis'],
    ['typy-hildy', 44.4, 'hildas', 'Hildy (44,4 AU): D'],
    ['typy-trojanie', 50.2, 'greeks', 'Trojańczycy L4: D']
  ].map(([id, r, beltId, opis]) => [id, {
    opis: `Typy skał — ${opis}, zoom 0,3`,
    js: `const F = B.field, au = F.auToWorld; window.__popScene = { r: ${r}, zoom: 0.3, beltId: '${beltId}' };` + TYPES_PICK + TYPES_LOG
  }])),
  ...Object.fromEntries([['westa', 'vesta'], ['themis', 'themis'], ['koronis', 'koronis']].map(([name, id]) => [`rodzina-${name}`, {
    opis: `Rodzina ${name} (A2): pole rodziny, zoom 0,35 — skład kadru i nazwa`,
    js: FAMILY_PICK(id) + TYPES_LOG
  }])),
  // A/B: ta sama klatka co poprzednia scena bez minerałów warstwy PLAY (co w kadrze to kryształy na skałach).
  'mineraly-bez': {
    opis: 'A/B: to samo miejsce, minerały warstwy PLAY schowane',
    js: `B.playMinerals.group.visible = false; const c = window.camera; S.cam(c.x, c.y, c.zoom);`,
    po: `window.__asteroidBelt.playMinerals.group.visible = true;`
  },
  // A/B: ta sama klatka z wyzerowanymi iskrami ziaren skał (sparkle palety — rockMaterial.js TYPE_ROW.p.z).
  'iskry-bez': {
    opis: 'A/B: to samo miejsce, iskry ziaren skał wyłączone (sparkle = 0 we wszystkich typach)',
    js: `const T = B.shared.typeData.array; window.__sparkSave = [];
         for (let i = 6; i < T.length; i += 8) { window.__sparkSave.push(T[i].z); T[i].z = 0; }
         const c = window.camera; S.cam(c.x, c.y, c.zoom);`,
    po: `const T = window.__asteroidBelt.shared.typeData.array; let k = 0;
         for (let i = 6; i < T.length; i += 8) T[i].z = window.__sparkSave[k++];`
  },
  // A/B: ta sama klatka, barwa „d” palety (pył w zagłębieniach programu węglowej i inne) = barwa regolitu.
  'zaglebienia-bez': {
    opis: 'A/B: to samo miejsce, barwa d palety skał = barwa base (bez przyciemnienia zagłębień)',
    js: `const T = B.shared.typeData.array; window.__dSave = [];
         for (let o = 0; o < T.length; o += 8) { window.__dSave.push(T[o + 5].clone()); T[o + 5].copy(T[o]); }
         const c = window.camera; S.cam(c.x, c.y, c.zoom);`,
    po: `const T = window.__asteroidBelt.shared.typeData.array; let k = 0;
         for (let o = 0; o < T.length; o += 8) T[o + 5].copy(window.__dSave[k++]);`
  },
  // Kontrola narzędzi A/B palety: barwy base / base2 wszystkich typów na czerwono (skały mają być czerwone).
  'paleta-czerwona': {
    opis: 'Kontrola: base i base2 palety skał = czerwień (sprawdza, że zmiany typeData docierają do GPU)',
    js: `const T = B.shared.typeData.array; window.__redSave = [];
         for (let o = 0; o < T.length; o += 8) { window.__redSave.push(T[o].clone(), T[o + 1].clone()); T[o].set(1, 0, 0, 1); T[o + 1].set(1, 0, 0, 1); }
         const c = window.camera; S.cam(c.x, c.y, c.zoom);`,
    po: `const T = window.__asteroidBelt.shared.typeData.array; let k = 0;
         for (let o = 0; o < T.length; o += 8) { T[o].copy(window.__redSave[k++]); T[o + 1].copy(window.__redSave[k++]); }`
  },
  // Skaner wydobycia w polu Themis: panel platformy z wierszem „pole: Rodzina Themis · węglowe, lód”, komunikat
  // strefy przy wlocie w pole (linia alertów kokpitu gaśnie po ~4 s czasu RZECZYWISTEGO — harness kroczy wolniej,
  // więc wywołania pushAlert zapisuje hak) i wpis dziennika „NAWIGACJA — wejście: …”.
  'rodzina-skaner': {
    opis: 'Tryb wydobycia (N) w polu Themis: panel skanera z nazwą rodziny pola, komunikat strefy i dziennik',
    js: `const Z = window.__beltFamilyZone; if (Z) { Z.current = null; Z.pending = null; Z.lastId = null; }
      const hud = window.hudSystem; const alerty = [];
      if (hud && !hud.__alertHook) { const org = hud.pushAlert.bind(hud); hud.__alertHook = alerty;
        hud.pushAlert = (t, o) => { hud.__alertHook.push({ t: String(t), label: o?.label || null, tone: o?.tone || null }); return org(t, o); }; }
      else if (hud) hud.__alertHook.length = 0;` + FAMILY_PICK('themis') + TYPES_LOG + `
      window.setMiningMode(true, true); await H.step(150);
      console.log('[typy] alert ' + JSON.stringify({
        alerty: (hud?.__alertHook || []).filter((a) => a.label === 'POLE PLANETOID'),
        dziennik: (hud?.cockpit?.logs || []).filter((e) => e.text.includes('Rodzina')).map((e) => e.text),
        stan: Z ? { obecna: Z.current, zegar: +Z.clock.toFixed(2) } : null,
        tu: window.beltFamilyAt?.(window.ship.pos.x, window.ship.pos.y)?.id || null }));`,
    po: `window.setMiningMode(false, true);`
  },
  olbrzym: {
    opis: 'Olbrzym w polu (scena 4 dema): Labirynt na obrzeżu gęstego pola, statek u wlotu trasy, zoom 0,3',
    js: `const g = W.FIELD_GIANTS[0]; const plan = (await import('/src/game/asteroidGiants.js')).buildGiantPlan(g.id, g.seed);
         const r = plan.routes[0].pts; const x = g.x + r[0][0], y = g.y + r[0][1];
         DevScene.teleport(x, y, Math.atan2(r[1][1] - r[0][1], r[1][0] - r[0][0])); S.cam(x, y, 0.3);`,
    olbrzym: true
  }
};

// ── Wydajność ────────────────────────────────────────────────────────────────
const PERF_SIDE = Math.max(2, Number(args.bok || 24));
const PERF_RUNS = Math.max(1, Number(args.przebiegi || 3));
// Próżnia między Ziemią a Wenus (jak DEEP w zrzuty.mjs) — poza pasem.
const DEEP = { x: 6210000, y: 5330000 };
export const PERF_CONFIGS = [
  { id: 'proznia', opis: 'próżnia (poza pasem), sam gracz, zoom 0,12', where: 'deep', zoom: 0.12, battle: false },
  { id: 'pole', opis: 'gęste pole (miejsce sceny pole), sam gracz, zoom 0,12', where: 'pole', zoom: 0.12, battle: false },
  { id: 'pole-z1', opis: 'gęste pole, sam gracz, zoom 1 (scena pole: duże skały, mapy cienia reflektorów)', where: 'pole', zoom: 1.0, battle: false },
  { id: 'bitwa-proznia', opis: `bitwa ${PERF_SIDE}×${PERF_SIDE} w próżni, zoom 0,12 (jak zrzuty.mjs --wydajnosc)`, where: 'deep', zoom: 0.12, battle: true },
  { id: 'bitwa-pole', opis: `bitwa ${PERF_SIDE}×${PERF_SIDE} w gęstym polu, zoom 0,12`, where: 'pole', zoom: 0.12, battle: true }
];
const PERF_KEYS = ['fps', 'klatka', 'p95', 'fizyka', 'rysowanie', 'coreRender', 'gpu', 'gpuCompute', 'fxMs', 'pasMs', 'drawCalls', 'swiatla', 'skaly', 'kolumny', 'npc', 'pociski'];

const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

// Jedna próbka pomiaru (PerfHUD, Core3D, pas) — wspólna dla --wydajnosc i --ab.
const SAMPLE_JS = `(() => { const d = window.__PH?.display || {}; const C = window.Core3D; const r = window.__rendererInfo || {}; const B = window.__asteroidBelt;
  return { fps: d.fps, klatka: d.frameMs, p95: d.frameP95, fizyka: d.physicsTime, rysowanie: d.drawTime,
    coreRender: d.render3dCoreRenderTime, gpu: C.gpuFrameMs, gpuCompute: C.gpuComputeMs, fxMs: C.fxStats?.cpuMs,
    pasMs: B.stats.cpuMs, drawCalls: r.calls, swiatla: C.fxStats?.lights, skaly: B.stats.rocks.reduce((a, b) => a + b, 0),
    kolumny: B.stats.volumeColumns, mapy: B.stats.shadowMaps, aktywny: B.stats.active,
    elementySiatki: C.fxStats?.gridItems, odrzucone: C.fx?.grid?.dropped,
    npc: (window.npcs || []).filter((n) => !n.dead).length, pociski: (window.bullets || []).length }; })()`;

// --ab: bitwa bok × bok w gęstym polu, JEDNA strona, warianty pasa na przemian (A/B zamiast gdybania:
// wyłączanie podsystemów po kolei) — rundy × warianty, 3 s rozbiegu po przełączeniu, 8 próbek co 0,5 s.
const AB_VARIANTS = [
  { id: 'pelny', js: 'B.enabled = true; B.atlas.enabled = true; B.cfg.maxShadowShips = 99;' },
  { id: 'domyslny', js: 'B.enabled = true; B.atlas.enabled = true; B.cfg.maxShadowShips = 2;' },
  { id: 'bez-cieni', js: 'B.enabled = true; B.atlas.enabled = false; B.cfg.maxShadowShips = 99;' },
  { id: 'bez-pasa', js: 'B.enabled = false; B.atlas.enabled = true; B.cfg.maxShadowShips = 99;' }
];

async function abPole(base) {
  const rounds = Math.max(1, Number(args.rundy || 3));
  const cfg = PERF_CONFIGS.find((c) => c.id === (args.konfig || 'bitwa-pole')) || PERF_CONFIGS.find((c) => c.id === 'bitwa-pole');
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 240000) => evaluate(cdp, e, t);
  const per = Object.fromEntries(AB_VARIANTS.map((v) => [v.id, []]));
  try {
    await openPerfPage(cdp, ev, base, cfg);
    await sleep(6000);
    for (let r = 0; r < rounds; r++) {
      const order = r % 2 === 0 ? AB_VARIANTS : [...AB_VARIANTS].reverse();
      for (const v of order) {
        await ev(`(() => { const B = window.__asteroidBelt; ${v.js} return true; })()`);
        await sleep(3000);
        const samples = [];
        for (let i = 0; i < 8; i++) { await sleep(500); samples.push(await ev(SAMPLE_JS)); }
        const med = Object.fromEntries(PERF_KEYS.concat(['mapy', 'elementySiatki', 'odrzucone']).map((k) => [k, median(samples.map((s) => Number(s[k])))]));
        per[v.id].push(med);
        console.log(`  A/B ${v.id.padEnd(14)} runda ${r + 1}: klatka ${med.klatka} ms, rysowanie ${med.rysowanie}, Core3D ${med.coreRender} ms CPU, GPU ${med.gpu} ms, pas ${med.pasMs} ms, mapy ${med.mapy}, siatka ${med.elementySiatki} (odrzucone ${med.odrzucone}), ${med.drawCalls} dc, NPC ${med.npc}`);
      }
    }
    const summary = {};
    for (const v of AB_VARIANTS) {
      const row = {};
      for (const k of PERF_KEYS.concat(['mapy', 'elementySiatki', 'odrzucone'])) {
        const xs = per[v.id].map((m) => m[k]).filter(Number.isFinite);
        row[k] = xs.length ? { mediana: +median(xs).toFixed(3), min: +Math.min(...xs).toFixed(3), max: +Math.max(...xs).toFixed(3) } : null;
      }
      summary[v.id] = row;
    }
    return { konfig: cfg.id, rundy: rounds, podsumowanie: summary, rundySzczegoly: per, bledy: logs.errors().filter((l) => !IGNORE.some((re) => re.test(l))).slice(0, 20) };
  } finally {
    await chrome.close();
  }
}

// Strona gry z harnessem (ziarno, osobne UUID three), start, pas gotowy, PerfHUD, miejsce i bitwa
// z konfiguracji, czas rzeczywisty.
async function openPerfPage(cdp, ev, base, cfg) {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `${GRA_SWOBODNA}window.__HARNESS_SEED__ = ${SEED};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, '!!(window.__asteroidBelt && window.__asteroidBelt.ready)', 120000, 400)) throw new Error('pas nie wstał');
  await ev(`(async () => { const m = await import('/src/ui/perfHud.js'); window.__PH = m.PerfHUD; if (!m.PerfHUD.visible) m.PerfHUD.toggle(); return true; })()`);
  const spawned = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(true);
    const W = await import('/dema/asteroidy-webgpu/world.js');
    const at = ${cfg.where === 'pole' ? 'W.SPOTS.field' : JSON.stringify(DEEP)};
    DevScene.teleport(at.x, at.y, 0);
    const s = ship; let n = 0;
    const put = (k, mode, x, y, a) => { const r = spawnCallInShip(k, { mode, spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a }); n += Array.isArray(r) ? r.length : (r ? 1 : 0); };
    if (${cfg.battle}) {
      // ${PERF_SIDE} okrętów na stronę: 17% pancerników, reszta niszczyciele (jak zrzuty.mjs --wydajnosc)
      const side = ${PERF_SIDE}, nb = Math.max(1, Math.round(side * 0.17)), nd = side - nb;
      for (let i = 0; i < nd; i++) put('destroyer', 'pirate', 6000 + (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, Math.PI);
      for (let i = 0; i < nb; i++) put('pirate_battleship', 'pirate', 9000, -(nb * 1300) + i * 2600, Math.PI);
      for (let i = 0; i < nd; i++) put('destroyer', 'friendly', 800 - (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, 0);
      for (let i = 0; i < nb; i++) put('battleship', 'friendly', -2600, -(nb * 1300) + i * 2600, 0);
    }
    S.cam(s.pos.x + ${cfg.battle ? 3500 : 0}, s.pos.y, ${cfg.zoom});
    for (let i = 0; i < 900 && !S.hullsReady(); i++) await H.frames(2);
    H.clock.mode = 'real';
    return n; })()`, 300000);
  return spawned;
}

async function perfOnce(base, cfg) {
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 240000) => evaluate(cdp, e, t);
  try {
    const spawned = await openPerfPage(cdp, ev, base, cfg);
    await sleep(6000);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await sleep(1000);
      samples.push(await ev(SAMPLE_JS));
    }
    const med = Object.fromEntries(PERF_KEYS.map((k) => [k, median(samples.map((s) => Number(s[k])))]));
    const errors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
    return { spawned, mediana: med, aktywny: samples.every((s) => s.aktywny), probki: samples, bledy: errors.slice(0, 20) };
  } finally {
    await chrome.close();
  }
}

async function wydajnosc(base) {
  const only = args.konfig ? new Set(args.konfig.split(',')) : null;
  const configs = PERF_CONFIGS.filter((c) => !only || only.has(c.id));
  const runs = Object.fromEntries(configs.map((c) => [c.id, []]));
  for (let r = 0; r < PERF_RUNS; r++) {
    const order = r % 2 === 0 ? configs : [...configs].reverse();
    for (const cfg of order) {
      const t0 = Date.now();
      let res;
      try { res = await perfOnce(base, cfg); } catch (err) { res = { blad: String(err?.message || err) }; }
      runs[cfg.id].push(res);
      const m = res.mediana || {};
      console.log(`  wydajność ${cfg.id.padEnd(14)} przebieg ${r + 1}: ${res.blad ? 'BŁĄD ' + res.blad : `klatka ${m.klatka} ms (p95 ${m.p95}), fizyka ${m.fizyka}, rysowanie ${m.rysowanie}, Core3D ${m.coreRender} ms CPU, GPU ${m.gpu} ms (compute ${m.gpuCompute}), fx ${m.fxMs} ms, pas ${m.pasMs} ms, ${m.drawCalls} dc, światła ${m.swiatla}, skały ${m.skaly}, NPC ${m.npc}`} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }
  const summary = {};
  for (const cfg of configs) {
    const ok = runs[cfg.id].filter((x) => x.mediana);
    const row = { opis: cfg.opis, przebiegi: ok.length };
    for (const k of PERF_KEYS) {
      const v = ok.map((x) => x.mediana[k]).filter(Number.isFinite);
      row[k] = v.length ? { mediana: +median(v).toFixed(3), min: +Math.min(...v).toFixed(3), max: +Math.max(...v).toFixed(3) } : null;
    }
    summary[cfg.id] = row;
  }
  return { bok: PERF_SIDE, przebiegi: PERF_RUNS, rozmiar: `${W}x${H}`, podsumowanie: summary, przebiegiSzczegoly: runs };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { server, base } = await startVite(port);
  if (args.ab) {
    try {
      const res = await abPole(base);
      writeFileSync(join(outDir, 'ab.json'), JSON.stringify({ when: new Date().toISOString(), ...res }, null, 2) + '\n');
      for (const [id, row] of Object.entries(res.podsumowanie)) {
        const f = (k) => (row[k] ? `${row[k].mediana} (${row[k].min}–${row[k].max})` : '—');
        console.log(`  ${id.padEnd(14)} klatka ${f('klatka')} | rysowanie ${f('rysowanie')} | Core3D ${f('coreRender')} | GPU ${f('gpu')} | pas ${f('pasMs')} | mapy ${f('mapy')} | dc ${f('drawCalls')}`);
      }
    } finally {
      await server.close();
    }
    console.log('gotowe:', outDir);
    return;
  }
  if (args.wydajnosc && !args.sceny && !args.kolizja) {
    try {
      const res = await wydajnosc(base);
      writeFileSync(join(outDir, 'wydajnosc.json'), JSON.stringify({ when: new Date().toISOString(), ...res }, null, 2) + '\n');
      for (const [id, row] of Object.entries(res.podsumowanie)) {
        const f = (k) => (row[k] ? `${row[k].mediana} (${row[k].min}–${row[k].max})` : '—');
        console.log(`  ${id.padEnd(14)} klatka ${f('klatka')} | p95 ${f('p95')} | fizyka ${f('fizyka')} | rysowanie ${f('rysowanie')} | Core3D ${f('coreRender')} | GPU ${f('gpu')} | fx ${f('fxMs')} | pas ${f('pasMs')} | dc ${f('drawCalls')}`);
      }
    } finally {
      await server.close();
    }
    console.log('gotowe:', outDir);
    return;
  }
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 240000) => evaluate(cdp, e, t);
  const report = { when: new Date().toISOString(), sceny: [] };
  try {
    const uuid = await osobneLosowanieUuid(cdp);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `${GRA_SWOBODNA}window.__HARNESS_SEED__ = ${SEED};\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
    await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
    if (!await waitFor(cdp, '!!(window.__asteroidBelt && window.__asteroidBelt.ready)', 120000, 400)) throw new Error('pas nie wstał');
    report.uuid = uuid;
    report.start = await ev(`(() => { const B = window.__asteroidBelt; return { initMs: B.initMs, gpuMs: B.gpuMs, olbrzymy: B.giants.entries.map((e) => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y) })) }; })()`);
    await ev('window.__harness.hold(true)');
    await ev(`(async () => { window.__W = await import('/dema/asteroidy-webgpu/world.js'); return true; })()`);
    const only = args.sceny ? new Set(args.sceny.split(',')) : null;
    for (const [id, sc] of Object.entries(BELT_SCENES)) {
      if (only && !only.has(id)) continue;
      logs.clear();
      const t0 = Date.now();
      let error = null;
      // Pipeline'y utworzone w klatkach sceny (sync = nikt nie rozgrzał — ma być 0).
      const begLog = await ev('window.__harness.frameLog.n');
      try {
        await ev(`(async () => { const W = window.__W, S = window.__harness.scene, H = window.__harness, B = window.__asteroidBelt; S.hideHud(true); H.reseed(0x21a5); ${sc.js} await H.step(2); S.cam(window.ship.pos.x, window.ship.pos.y, window.camera.zoom); return true; })()`);
        if (sc.olbrzym) {
          // Siatka olbrzyma liczy się w workerach (prawdziwy czas) — czekamy na gotowy widok.
          await ev('window.__harness.frames(4)');
          if (!await waitFor(cdp, `(() => { const B = window.__asteroidBelt; return B.giants.entries.some((e) => e.id === 'warren' && e.view); })()`, 180000, 500)) {
            // klatki, żeby pas utworzył widok
            for (let i = 0; i < 40; i++) { await ev('window.__harness.frames(2)'); if (await ev(`window.__asteroidBelt.giants.entries.some((e) => e.id === 'warren' && e.view)`)) break; await sleep(500); }
          }
        }
        await ev(`window.__harness.frames(${warmFrames})`);
        if (sc.burza) {
          // Jak demo: 40 klatek burzy (naturalne pioruny), potem burza powtarzalna
          // (STORM_STAGE — ten sam kod w asteroidy-demo.mjs), 20 klatek.
          await ev('window.__harness.step(40)');
          const ok = await ev(`(async () => { const s = window.ship; const B = window.__asteroidBelt;
            const sim = B.storm.sim; const sx = s.pos.x, sy = s.pos.y, sa = s.angle;
            const force = (x, y) => B.forceStrike(x, y);
            ${STORM_STAGE} })()`);
          await ev('window.__harness.step(20)');
          if (args.diag) {
            const st = await ev(`(() => { const B = window.__asteroidBelt; const out = { forced: ${ok}, strikes: B.storm.sim.strikes.length, seg: B.storm.batch.count, vis: B.storm.batch.mesh.visible, layers: B.storm.batch.mesh.layers.mask, parent: B.storm.batch.mesh.parent?.name, root: [B.root.position.x, B.root.position.y], pts: [] };
              for (const [id, s] of B.storm._state) { const P = s.chains[0].points; out.pts.push([Math.round(P[0]), Math.round(P[1]), Math.round(P[2]), Math.round(P[P.length - 3]), Math.round(P[P.length - 2]), Math.round(P[P.length - 1])]); }
              const A = B.storm.batch.a.array; out.a0 = [A[0], A[1], A[2], A[3]];
              out.sheets = B.storm.sim.sheets.length; out.flashes = B.storm.flashes.length; out.veil = [B.veil.mesh.visible, +B.veil.u.veil.value.toFixed(3), +B.veil.u.sunLevel.value.toFixed(3)];
              out.fog = B.fog.slices.map((s) => [s.mesh.visible, +s.maxFog.toFixed(2), s.mesh.layers.mask]);
              return out; })()`);
            console.log('     burza diag', JSON.stringify(st));
          }
        }
        await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
        await ev('window.__harness.frames(10)');
      } catch (err) {
        error = String(err?.message || err).slice(0, 500);
      }
      const png = join(outDir, `${id}.png`);
      await screenshotPng(cdp, png);
      if (sc.po) await ev(`(() => { ${sc.po} return true; })()`);
      const stats = await ev(`(() => { const B = window.__asteroidBelt; const s = B.stats; return { ...s, rocks: [...s.rocks], czas: +B.time.toFixed(3), kamera: [Math.round(window.camera.x), Math.round(window.camera.y), window.camera.zoom], olbrzymyGotowe: B.giants.readyCount, fx: window.Core3D.fxStats ? { ...window.Core3D.fxStats } : null }; })()`);
      const perf = await ev('window.__harness.scene.perf(20)');
      const pipe = (await ev(`window.__harness.frameStats(${begLog})`)).pipeline;
      perf.pipelineSync = pipe?.sync ?? null;
      perf.pipelineSyncLista = pipe?.syncRenderLista ?? pipe?.syncLista ?? null;
      const errors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
      if (args.diag) {
        const diag = await ev(`(() => { const s = window.ship; const C = window.Core3D; const out = { hull: !!s.beamHull, pos: [Math.round(s.pos.x), Math.round(s.pos.y)], meshes: [] };
          C.scene.traverse((o) => { if (o.isMesh && /hull/i.test(o.material?.name || '') && o.visible) out.meshes.push({ name: o.name, mat: o.material.name, pos: [Math.round(o.position.x), Math.round(o.position.y), Math.round(o.position.z)], layers: o.layers.mask, ro: o.renderOrder }); });
          return out; })()`);
        console.log('     diag', JSON.stringify(diag).slice(0, 1500));
        console.log('     logi:\n     ' + logs.all().filter((l) => !IGNORE.some((re) => re.test(l))).slice(0, 40).join('\n     '));
      }
      report.sceny.push({ scena: id, opis: sc.opis, blad: error, sekundy: (Date.now() - t0) / 1000, stats, perf, bledy: errors.slice(0, 30) });
      console.log(`  ${id.padEnd(8)} ${error ? 'BŁĄD ' + error : 'ok'} | skały ${stats.rocks.join('/')} min. ${stats.minerals} | światła ${stats.lights} (statki ${stats.shipLights}, skały ${stats.rockLights}) | mapy cienia ${stats.shadowMaps} | kolumny ${stats.volumeColumns} | pas ${stats.active ? 'aktywny' : 'śpi'} | CPU pasa ${stats.cpuMs?.toFixed?.(2)} ms | ${perf.drawCalls} dc, GPU ${perf.gpuMs} ms | pipeline sync ${perf.pipelineSync} | błędy ${errors.length}`);
      if (errors.length) console.log('     ' + errors.slice(0, 6).join('\n     '));
      const sceneLog = logs.all().filter((l) => /\[(luka|pop|typy)/.test(l));
      if (sceneLog.length) console.log('     ' + sceneLog.join('\n     '));
    }
    if (args.kolizja) report.kolizja = await kolizja(ev, cdp);
  } finally {
    writeFileSync(join(outDir, 'wynik.json'), JSON.stringify(report, null, 2) + '\n');
    await chrome.close();
    await server.close();
  }
  console.log('gotowe:', outDir);
}

// Statek gracza leci z prędkością 900 j/s wprost na skałę Labiryntu. Cel = pierwsza lita
// skała (SDF < −200 j. na z = 0) na jednym z wierszy skanu od lewej krawędzi bryły; start
// z dziobem 1500 j. przed nią. Bez kolizji statek przeleciałby 5400 j. (w głąb skały);
// z kolizją koła kadłuba (jak collideShip: 5 kół wzdłuż osi) zostają przy ścianie —
// wbicie = max(R − SDF) po kołach po każdej porcji kroków (oczekiwane ≲ krok ruchu).
async function kolizja(ev, cdp) {
  const setup = await ev(`(async () => { const S = window.__harness.scene;
    const B = window.__asteroidBelt; const e = B.giants.entries.find((q) => q.id === 'warren'); const G = e.giant;
    const s = window.ship; const L = Math.max(s.w || 0, 1); const R = Math.max(10, (s.h || 0) * B.giants.cfg.hullCircleRadius);
    let hit = null;
    for (const dy of [0, 1500, -1500, 3000, -3000, 4500, -4500, 6000, -6000]) {
      const y = G.y + dy;
      for (let x = G.x - e.halfX - 1000; x < G.x + e.halfX; x += 40) {
        if (G.sampleWorld(x, y, 0) < -200) { hit = { x, y }; break; }
      }
      if (hit) break;
    }
    if (!hit) return { blad: 'brak litej skały na skanie' };
    const x = hit.x - L * 0.5 - 1500; const y = hit.y;
    DevScene.teleport(x, y, 0); S.cam(hit.x - 400, y, 0.14);
    return { cel: { x: Math.round(hit.x), y: Math.round(hit.y) }, start: { x: Math.round(x), y: Math.round(y) }, L: Math.round(L), R: Math.round(R) }; })()`);
  if (setup.blad) { console.log('  kolizja: ' + setup.blad); return setup; }
  await ev('window.__harness.step(2)');
  const probe = `(() => { const s = window.ship; const B = window.__asteroidBelt; const G = B.giants.entries.find((q) => q.id === 'warren').giant;
    const L = ${setup.L}, R = ${setup.R}; const fx = Math.cos(s.angle), fy = Math.sin(s.angle); let pen = -Infinity;
    for (let k = -2; k <= 2; k++) { const off = k * Math.max(0, L * 0.5 - R) / 2; pen = Math.max(pen, R - G.sampleWorld(s.pos.x + fx * off, s.pos.y + fy * off, 0)); }
    return { x: +s.pos.x.toFixed(1), y: +s.pos.y.toFixed(1), vx: +s.vel.x.toFixed(1), vy: +s.vel.y.toFixed(1), wbicie: +pen.toFixed(1), kolizje: B.giants.stats.collisions }; })()`;
  const before = await ev(probe);
  const trace = [];
  for (let k = 0; k < 24; k++) {
    await ev(`(() => { const s = window.ship; s.vel.x = 900; s.vel.y = 0; s.angle = 0; s.angVel = 0; return true; })()`);
    await ev('window.__harness.step(15)');
    trace.push(await ev(probe));
  }
  const last = trace[trace.length - 1];
  await ev(`(() => { window.__harness.scene.cam(window.ship.pos.x + ${setup.L} * 0.5, window.ship.pos.y, 0.14); return true; })()`);
  await ev('window.__harness.frames(6)');
  await screenshotPng(cdp, join(outDir, 'kolizja.png'));
  const maxPen = Math.max(...trace.map((t) => t.wbicie));
  const droga = last.x - before.x;
  console.log(`  kolizja: cel ${setup.cel.x}, ${setup.cel.y} | L ${setup.L} R ${setup.R} | droga ${droga.toFixed(0)} j. (bez kolizji 5400) | max wbicie ${maxPen.toFixed(1)} j. | kolizje ${last.kolizje}`);
  return { ...setup, before, trace, maxPen, droga };
}

// Uruchomienie tylko wprost (asteroidy-demo.mjs importuje stąd STORM_STAGE).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
