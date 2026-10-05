// Tarcze w PRAWDZIWEJ grze (tarcza z dema WebGPU, 2026-10-05: pula slotów src/3d/shield/, klej src/3d/shield3D.js).
// Bitwa jak w harnessie (zegar wirtualny, ziarna, UUID z osobnego strumienia), potem wymuszone trafienia w tarczę
// największego pirata (pd, main, special — jak registerShieldImpact + HP w grze), pęknięcie tarczy (ostatnie HP
// torpedą) w kilku chwilach i krótka bitwa z prawdziwym ostrzałem. Zrzuty całej klatki i samej warstwy tarcz,
// stan puli (getShieldPoolStats), koszt (harness perf: CPU renderu, dispatche, GPU), błędy konsoli / WebGPU.
//
//   node scripts/webgpu/tarcze-gra.mjs [--out .tmp/webgpu/tarcze-gra] [--port 5349] [--zoom 0.55]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5349);
const zoom = Number(args.zoom || 0.55);
const out = resolve(repo, args.out || '.tmp/webgpu/tarcze-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { zrzuty: [], etapy: {} };
const shot = async (name) => {
  await ev('window.__harness.frames(2)');
  await screenshotPng(cdp, join(out, `${name}.png`));
  const st = await ev('JSON.stringify(window.getShieldPoolStats())');
  result.zrzuty.push({ name, pula: JSON.parse(st) });
  console.log(name, st);
};
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  // Menu: Nowa gra → Swobodna (bez kampanii) → start.
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');
  result.etapy.start = JSON.parse(await ev('JSON.stringify(window.getShieldPoolStats())'));

  // Pirat-pancernik daleko od gracza (bez ostrzału w pierwszych sekundach) — trafienia wymuszone.
  result.etapy.scena = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0xb17b); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    if (window.fireControl) window.fireControl.posture = 'hold';   // wieże gracza nie strzelają same (pomiar trafień)
    const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
    spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(5200, 0), spawnAngle: Math.PI * 0.85 });
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    H.reseed(0xb17a);
    await H.step(20);
    const e = npcs.filter((n) => !n.dead && !n.friendly).sort((a, b) => (b.radius || 0) - (a.radius || 0))[0];
    if (!e) return { blad: 'brak pirata' };
    window.__cel = e;
    S.cam(e.x, e.y, ${zoom});
    await H.frames(3);
    window.__hit = (a, dmg, cls) => { const sh = e.shield; registerShieldImpact(e, e.x + Math.cos(a) * 900, e.y + Math.sin(a) * 900, dmg, cls); sh.val = Math.max(0, sh.val - dmg); sh.regenTimer = sh.regenDelay || 3.0; };
    window.__dir = Math.atan2(s.pos.y - e.y, s.pos.x - e.x);
    // Kąt względem kadłuba (okręt skręca — punkt obrysu ma stać w miejscu na tarczy).
    window.__hullAng = () => e.angle + (e.visual?.spriteRotation ?? e.capitalProfile?.spriteRotation ?? 0);
    window.__loc0 = window.__dir - window.__hullAng();
    return { pirat: [Math.round(e.x), Math.round(e.y)], tarcza: e.shield?.state, hp: e.shield?.val, max: e.shield?.max };
  })()`, 300000);
  console.log('scena', JSON.stringify(result.etapy.scena));
  await shot('a-spoczynek');
  // Od tej chwili: pipeline'y i budowy NodeBuilder w klatkach (rozgrzewka ma je wykluczyć).
  const kStart = await ev('window.__harness.frameLog.n');

  // Trafienia działami i PD w kilka miejsc obrysu.
  await ev(`(() => { const d = window.__dir; window.__hit(d, 140, 'main'); window.__hit(d + 0.5, 140, 'main'); window.__hit(d - 2.4, 60, 'pd'); window.__hit(d - 2.5, 60, 'pd'); return true; })()`);
  await ev('window.__harness.step(4)');
  await shot('b-trafienia-0.07');
  await ev('window.__harness.step(14)');
  await shot('b-trafienia-0.30');
  // Torpeda (special): wielkie wgniecenie, fala przez całą tarczę.
  await ev(`(() => { window.__hit(window.__dir + 1.6, 520, 'special'); return true; })()`);
  await ev('window.__harness.step(5)');
  await shot('c-torpeda-0.08');
  await ev('window.__harness.step(20)');
  await shot('c-torpeda-0.42');
  // Sama warstwa tarcz (płytki i iskry) w tej chwili.
  await ev('window.__harness.scene.isolate([7])');
  await shot('c-torpeda-warstwa7');
  await ev('window.__harness.scene.isolate(null)');
  result.etapy.perfTrafienia = await ev('window.__harness.scene.perf(30)');

  // Przebicie: seria trafień w jeden punkt (≈ 1,5 s) przegrzewa pole — płytki odpadają, a punkt
  // wejścia w tarczę w tym kierunku przepuszcza pociski (isShieldBreachedAt), po drugiej stronie nie.
  for (let k = 0; k < 15; k++) {
    await ev(`(() => { const a = window.__loc0 + 0.9 + window.__hullAng(); for (let i = 0; i < 3; i++) window.__hit(a + (i - 1) * 0.02, 80, 'main'); return true; })()`);
    await ev('window.__harness.step(6)');
  }
  await ev('window.__harness.step(6)');
  await shot('p-przebicie');
  result.etapy.przebicie = JSON.parse(await ev(`JSON.stringify((() => { const e = window.__cel, a = window.__loc0 + 0.9 + window.__hullAng();
    const at = (b) => window.isShieldBreachedAt(e, e.x + Math.cos(b) * 2500, e.y + Math.sin(b) * 2500);
    return { flaga: !!e.__shieldBreach, wDziurze: at(a), poDrugiejStronie: at(a + Math.PI), hp: Math.round(e.shield.val) }; })())`));
  result.etapy.przebicie.pole = await ev('window.probeShieldSlot(window.getShieldPoolStats().slots[0]?.slot ?? 0)');
  console.log('przebicie', JSON.stringify(result.etapy.przebicie));
  // Prawdziwe pociski gracza (fireWeaponCore): przez dziurę — pancerz traci HP, tarcza nie; z drugiej
  // strony (bez dziury) — tarcza zatrzymuje. Lufa tuż za obrysem, celowanie w środek okrętu.
  const strzal = async (dA) => (await ev(`(async () => { const e = window.__cel, H = window.__harness;
    const wid = Object.keys(window.MASTER_WEAPONS || {}).find((k) => { const w = window.MASTER_WEAPONS[k]; return w && w.category !== 'beam' && w.category !== 'rocket' && w.category !== 'torpedo' && (w.baseSpeed || 0) > 900 && (w.baseDamage || 0) >= 20 && (w.baseDamage || 0) <= 150 && !w.penDepth && !w.ricochet && !w.chargeTime && !w.flakBurstRadius && w.type !== 'flak'; });
    if (!wid) return { blad: 'brak broni' };
    e.shield.val = e.shield.max; e.shield.regenTimer = 3;
    const before = { sh: e.shield.val, hp: e.hp };
    for (let i = 0; i < 4; i++) {
      const a = window.__loc0 + 0.9 + ${dA} + window.__hullAng();
      const R = 520;
      // Strzał gracza leci wzdłuż kierunku lufy (owner.angle w adapterze) — na chwilę na linię do środka celu.
      const sa = ship.angle;
      ship.angle = a + Math.PI;
      window.spawnBulletAdapter(ship, e, window.MASTER_WEAPONS[wid], { origin: { x: e.x + Math.cos(a) * R, y: e.y + Math.sin(a) * R }, originVel: { x: e.vx || 0, y: e.vy || 0 } });
      ship.angle = sa;
      await H.step(2);
    }
    await H.step(20);
    return { q: window.getShieldPoolStats().breachQ, bron: wid, tarczaPrzed: Math.round(before.sh), tarczaPo: Math.round(e.shield.val), kadlubPrzed: Math.round(before.hp), kadlubPo: Math.round(e.hp), dziura: !!e.__shieldBreach };
  })()`, 300000));
  result.etapy.pociskiPrzezDziure = await strzal(0);
  console.log('pociski przez dziurę', JSON.stringify(result.etapy.pociskiPrzezDziure));
  result.etapy.pociskiBezDziury = await strzal(Math.PI);
  console.log('pociski bez dziury', JSON.stringify(result.etapy.pociskiBezDziury));
  await ev('window.__harness.step(150)');
  result.etapy.poStygnieciu = JSON.parse(await ev(`JSON.stringify((() => { const e = window.__cel, a = window.__loc0 + 0.9 + window.__hullAng();
    return { flaga: !!e.__shieldBreach, wDziurze: window.isShieldBreachedAt(e, e.x + Math.cos(a) * 2500, e.y + Math.sin(a) * 2500) }; })())`));
  console.log('po stygnięciu', JSON.stringify(result.etapy.poStygnieciu));

  // Rozruch: tarcza wyłączona i włączona — czoło po siatce (siatka odrasta, fala).
  await ev(`(() => { const e = window.__cel, sh = e.shield; window.__harness.scene.cam(e.x, e.y, ${zoom}); sh.val = sh.max; sh.state = 'off'; sh.activationProgress = 0; return true; })()`);
  await ev('window.__harness.frames(2)');
  await ev('window.__harness.step(9)');
  await shot('r-rozruch-0.15');
  await ev('window.__harness.step(12)');
  await shot('r-rozruch-0.35');

  await ev(`(() => { const e = window.__cel; window.__harness.scene.cam(e.x, e.y, ${zoom}); return true; })()`);
  // Pęknięcie: resztka HP zdjęta torpedą.
  await ev(`(() => { const e = window.__cel; e.shield.val = 30; window.__hit(window.__dir, 300, 'special'); return true; })()`);
  let t = 0;
  for (const T of [0.1, 0.25, 0.45, 0.7, 1.0, 1.5]) {
    const n = Math.max(1, Math.round((T - t) * 60));
    await ev(`window.__harness.step(${n})`);
    t += n / 60;
    await shot(`d-pekniecie-${t.toFixed(2)}`);
  }
  // Pipeline'y synchroniczne i budowy grafu w klatkach od pierwszego trafienia (pomija stałe sceny).
  result.etapy.kompilacjeWKlatce = JSON.parse(await ev(`JSON.stringify(window.__harness.pipes.list.filter((p) => p.k >= ${kStart} && (p.budowa ? !p.poza : (p.sync || p.compute))).map((p) => (p.budowa ? 'budowa ' : p.compute ? '' : 'sync ') + p.nazwa + (p.ms ? ' ' + p.ms + ' ms' : '')))`));
  console.log('kompilacje w klatce od trafień:', JSON.stringify(result.etapy.kompilacjeWKlatce));
  result.etapy.poPeknieciu = JSON.parse(await ev('JSON.stringify({ stan: window.__cel.shield.state, hp: window.__cel.shield.val })'));

  await ev(`(() => { if (window.fireControl) window.fireControl.posture = 'free'; return true; })()`);
  // Bitwa: prawdziwy ostrzał (więcej okrętów, kilka sekund).
  result.etapy.bitwa = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness;
    const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
    spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(2600, -900), spawnAngle: Math.PI });
    spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(2600, 900), spawnAngle: Math.PI });
    spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: at(600, -1200), spawnAngle: 0 });
    spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
    // --duza: wielka bitwa (więcej tarcz niż slotów puli — wypieranie, limit przydziałów).
    for (let i = 0; i < ${args.duza ? 9 : 0}; i++) {
      spawnCallInShip(i % 3 === 0 ? 'pirate_battleship' : 'destroyer', { mode: 'pirate', spawnPos: at(3400 + (i % 3) * 700, -2400 + i * 600), spawnAngle: Math.PI });
      spawnCallInShip(i % 3 === 0 ? 'battleship' : 'destroyer', { mode: 'friendly', spawnPos: at(-600 - (i % 3) * 700, -2400 + i * 600), spawnAngle: 0 });
    }
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    S.cam(s.pos.x + 1800, s.pos.y, 0.3);
    await H.step(360);
    return { pula: window.getShieldPoolStats(), npc: npcs.filter((n) => !n.dead).length,
      tarcze: npcs.filter((n) => !n.dead && n.shield && n.shield.max).map((n) => [n.shield.state, Math.round(n.shield.val)]) };
  })()`, 600000);
  console.log('bitwa', JSON.stringify(result.etapy.bitwa));
  await shot('e-bitwa');
  result.etapy.perfBitwa = await ev('window.__harness.scene.perf(60)');
  console.log('perf', JSON.stringify(result.etapy.perfBitwa));
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels|TimestampQuery/.test(l)).slice(0, 30);
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
console.log('błędy strony:', result.bledy.length, result.bledy.slice(0, 8).join('\n'));
process.exit(result.blad || result.bledy.length ? 1 : 0);
