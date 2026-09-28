// Mapa ran na kadłubach (zadanie 18-C) w PRAWDZIWEJ grze: seria trafień różnych rodzin broni w kadłub
// Atlasa gracza (klasa L) i pirackiego pancernika (klasa M) przez tę samą ścieżkę co gra
// (HullDamageMap.setSource → HullBodies.impact → hak onImpact), rzaz Hexlance'a (cutSegment),
// potem zrzuty w czasie: rany narastają (białe brzegi) i stygną (pomarańcz → czerwień → osmalenie).
// Do tego A/B świateł efektów na poszyciu (błysk z siatki świateł, zadanie 12) i statystyki mapy ran.
//
//   node scripts/webgpu/rany-gra.mjs [--out <katalog>] [--port 5359] [--zoom 0.9]
// Wynik: <out>/*.png + wynik.json (statystyki HullDamageMap, pamięć puli, klatki kernela).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5359);
const zoom = Number(args.zoom || 0.9);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
const out = resolve(repo, args.out || '.tmp/webgpu/zadania/18c/rany-gra');
mkdirSync(out, { recursive: true });

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { zrzuty: [] };
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');

  const snap = async (name, opis, extra = '') => {
    await ev(`(async () => { ${extra} await window.__harness.frames(2); return true; })()`);
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    const f = join(out, `${name}.png`);
    await screenshotPng(cdp, f);
    const st = await ev('JSON.stringify(window.HullDamageMap.stats)');
    result.zrzuty.push({ plik: `${name}.png`, opis, mapa: JSON.parse(st) });
    console.log('zrzut', name, '—', opis);
  };

  // Scena: gracz w próżni, pancernik piracki obok (przyjazny — nie strzela), bez HUD.
  result.stan = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x18c0); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = ship;
    spawnCallInShip('pirate_battleship', { mode: 'friendly', spawnPos: { x: s.pos.x + 200, y: s.pos.y + 1100 }, spawnAngle: 0 });
    S.cam(s.pos.x, s.pos.y + 500, 0.45);
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    // Kadłub gracza buduje się od nowa po (ponownym) wczytaniu sprite'a (shipSprite.onload → nowy
    // dmgKey, czysta mapa) — seria dopiero, gdy klucz stoi przez 60 klatek.
    let key = s.beamHull?.dmgKey, stable = 0;
    for (let it = 0; it < 1200 && stable < 60; it++) {
      await H.step(2);
      const k = s.beamHull?.dmgKey;
      stable = (k && k === key && s.spriteReady) ? stable + 2 : 0;
      key = k;
    }
    await H.step(20);
    const bs = npcs.filter((n) => !n.dead && n.beamHull).sort((a, b) => (b.radius || 0) - (a.radius || 0))[0];
    window.__ranyCele = { atlas: s, bs };
    return { atlas: !!s.beamHull, klucz: s.beamHull?.dmgKey, pancernik: !!bs?.beamHull, kluczBs: bs?.beamHull?.dmgKey,
      klatkaMapy: window.HullDamageMap.frame, krok: !!window.HullDamageMap._step };
  })()`, 300000);
  console.log('stan:', JSON.stringify(result.stan));

  // Seria trafień: punkt na burcie z sondy (sweep od zewnątrz do środka), źródło = broń gry.
  const fire = `(() => {
    const HB = window.HullBodies, M = window.HullDamageMap;
    const R = window.fxRandom;
    const hitAt = (e, ang, off, dmg, weapon) => {
      const cx = e.pos?.x ?? e.x, cy = e.pos?.y ?? e.y;
      const L = (e.radius || 500) * 1.4;
      const nx = Math.cos(ang), ny = Math.sin(ang);
      // prostopadle przesunięta cięciwa: trafienia rozłożone wzdłuż kadłuba
      const px = -ny * off, py = nx * off;
      const sw = HB.sweep(e, cx + px + nx * L, cy + py + ny * L, cx + px - nx * L, cy + py - ny * L, 0);
      if (!sw) return 0;
      const hx = sw.worldX, hy = sw.worldY;
      M.setSource(weapon);
      try { HB.impact(e, hx, hy, dmg, { x: -nx * 2000, y: -ny * 2000 }); } finally { M.clearSource(); }
      return HB.impactResult.killed + 1;
    };
    window.__ranyHit = hitAt;
    const { atlas, bs } = window.__ranyCele;
    const a0 = (atlas.angle || 0);
    const up = a0 - Math.PI / 2, down = a0 + Math.PI / 2;
    const n = [];
    // Atlas (L): działa główne wzdłuż górnej burty, lekkie serie wzdłuż dolnej.
    n.push(hitAt(atlas, up, -620, 150, 'armata_mk1'));
    n.push(hitAt(atlas, up, -380, 60, 'railgun_mk1'));
    n.push(hitAt(atlas, up, -150, 55, 'helios_laser'));
    n.push(hitAt(atlas, up, 80, 90, 'heavy_autocannon_l'));
    n.push(hitAt(atlas, up, 320, 120, 'special_plasma_gatling'));
    n.push(hitAt(atlas, up, 560, 900, 'special_goliath_autocannon'));
    for (let k = 0; k < 6; k++) n.push(hitAt(atlas, down, -600 + k * 22, 4, 'vulcan_minigun'));
    for (let k = 0; k < 6; k++) n.push(hitAt(atlas, down, -250 + k * 14, 3, 'ciws_mk1'));
    for (let k = 0; k < 8; k++) n.push(hitAt(atlas, down, 60, 18, 'beam_continuous'));
    n.push(hitAt(atlas, down, 380, 30, 'beam_pulse'));
    n.push(hitAt(atlas, down, 650, 2500, 'siege_railgun'));
    // Pancernik (M): Yamato (z wtórnymi), Tempest L, flak.
    n.push(hitAt(bs, up, -150, 1400, 'special_yamato_cannon'));
    n.push(hitAt(bs, up, 180, 70, 'tempest_ion_l'));
    n.push(hitAt(bs, down, 100, 40, 'flak_m'));
    // Rzaz Hexlance'a przez rufę pancernika (cutSegment, bez źródła = rodzina hexlance).
    const bx = bs.pos?.x ?? bs.x, by = bs.pos?.y ?? bs.y, ba = bs.angle || 0;
    const tail = -(bs.radius || 300) * 0.55;
    const tx = bx + Math.cos(ba) * tail, ty = by + Math.sin(ba) * tail;
    const cut = HB.cutSegment(bs, tx - Math.sin(ba) * 600, ty + Math.cos(ba) * 600, tx + Math.sin(ba) * 600, ty - Math.cos(ba) * 600, 35);
    return { trafienia: n.filter((v) => v > 0).length, zabite: n.reduce((a, v) => a + Math.max(0, v - 1), 0), rzaz: cut, stats: JSON.parse(JSON.stringify(M.stats)) };
  })()`;
  // Kamera: Atlas i pancernik w kadrze.
  const camAll = 'const s = ship; window.__harness.scene.cam(s.pos.x + 60, s.pos.y + 480, ' + (zoom * 0.5) + ');';
  const camAtlas = 'const s = ship; window.__harness.scene.cam(s.pos.x, s.pos.y, ' + zoom + ');';
  await ev(`(() => { ${camAll} return true; })()`);
  await ev('window.__harness.step(2)');
  result.przedTrafieniami = await ev('JSON.stringify(window.HullDamageMap.stats)');
  await snap('00-przed', 'Przed trafieniami (kadłuby bez mapy — obraz jak bez zadania 18-C)', camAll);
  await snap('00b-atlas-przed', 'Atlas przed trafieniami (odniesienie dla różnic)', camAtlas);
  result.seria = await ev(fire);
  console.log('seria:', JSON.stringify(result.seria));
  // Klatki po trafieniu: 60 FPS zegara wirtualnego.
  await ev('window.__harness.step(3)');
  await snap('01-cale-0_05s', 'Seria trafień, 0,05 s: białe brzegi ran (8–12 HDR), jony Tempesta, wtórne Yamato jeszcze nie', camAll);
  await snap('02-atlas-0_05s', 'Atlas z bliska, 0,05 s', camAtlas);
  await ev('window.__harness.step(33)');
  await snap('03-atlas-0_6s', 'Atlas, 0,6 s: brzegi jeszcze białe, poświata stygnie', camAtlas);
  await ev('window.__harness.step(54)');
  await snap('04-atlas-1_5s', 'Atlas, 1,5 s: biel → pomarańcz', camAtlas);
  await ev('window.__harness.step(90)');
  await snap('05-atlas-3s', 'Atlas, 3 s: pomarańcz → czerwień', camAtlas);
  await snap('05b-cale-3s', 'Oba kadłuby, 3 s (Yamato z wtórnymi, rzaz Hexlance, flak)', camAll);
  await ev('window.__harness.step(300)');
  await snap('06-atlas-8s', 'Atlas, 8 s: zimne — osmalenie i dna lejów, bez żaru', camAtlas);
  await snap('06b-cale-8s', 'Oba kadłuby, 8 s', camAll);

  // Narastanie: druga seria w to samo miejsce (rany sumują osmalenie, żar od nowa biały).
  result.seria2 = await ev(fire);
  await ev('window.__harness.step(6)');
  await snap('07-atlas-druga-seria', 'Druga seria w te same miejsca, 0,1 s: żar od nowa, osmalenie narasta', camAtlas);

  // Światła efektów na poszyciu: błysk z siatki (FxLights → Core3D.fx.grid) nad kadłubem A/B.
  await ev('window.__harness.step(600)');
  await snap('08-swiatla-bez', 'Światła efektów: bez błysku (odniesienie)', camAtlas);
  await snap('09-swiatla-blysk', 'Światła efektów: dwa błyski nad burtą (pomarańczowy wystrzał, niebieskie trafienie) — poszycie łapie światło', `${camAtlas}
    const L = window.Core3D.fx.lights; const a = s.angle || 0;
    L.flash(s.pos.x + Math.cos(a) * 300, s.pos.y + Math.sin(a) * 300, 1.0, 0.6, 0.28, 14, 700, 0.5, 2, 0, 50);
    L.flash(s.pos.x - Math.cos(a) * 500, s.pos.y - Math.sin(a) * 500, 0.55, 0.85, 1.0, 10, 600, 0.5, 2, 0, 40);`);
  result.fx = await ev('JSON.stringify({ fxStats: window.Core3D.fxStats, gpuCompute: window.Core3D.gpuComputeMs, kluczAtlasa: ship.beamHull?.dmgKey })');

  // Naprawa R: wygasza osmalenie i przestrzeliny (hak onRepair).
  result.naprawa = await ev(`(async () => {
    const H = window.__harness; const M = window.HullDamageMap; const key = ship.beamHull.dmgKey;
    const before = !!M.slotOf(key);
    for (let i = 0; i < 400 && M.slotOf(key); i++) { window.HullBodies.repair([ship], 1 / 60); await H.step(1); }
    return { przed: before, po: !!M.slotOf(key), stats: JSON.parse(JSON.stringify(M.stats)) };
  })()`, 300000);
  await snap('10-atlas-po-naprawie', 'Atlas po naprawie R: mapa wyczyszczona, slot zwolniony', camAtlas);
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
