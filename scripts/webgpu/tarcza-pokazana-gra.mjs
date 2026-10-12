// Tarcza POKAZANA (tryb TARCZE gracza, bez trafień — 2026-10-12: czasza pola, siatka jako faktura, prądy,
// zmarszczki; src/3d/shield/shieldPool.js, src/3d/shield3D.js) w PRAWDZIWEJ grze: Atlas w pustce, zrzuty przy
// kilku przybliżeniach (pełna klatka i sama warstwa tarcz), seria w czasie, klatki do animacji, A/B warstw pola
// na tej samej klatce, wejście w TARCZE, trafienie w pokazaną tarczę, słabe pole, kamery 3D, sonda fali z GPU,
// koszt GPU (TARCZE ↔ postawa bojowa naprzemiennie), pipeline'y synchroniczne od włączenia TARCZ (ma być 0).
//
//   node scripts/webgpu/tarcza-pokazana-gra.mjs [--out .tmp/webgpu/tarcza-pokazana] [--zoomy def,0.5,1,2]
//        [--seria 6] [--klatki 40] [--ab 1] [--przejscie 1] [--trafienie 1] [--slabe 1] [--kamera3d 1]
//        [--sonda 1] [--koszt 1] [--przed <ref gita>]
// Pierwsze przybliżenie z --zoomy (def = domyślne kamery statku) to kadr serii, klatek, A/B i pozostałych etapów.
// --przed <ref>: shieldPool.js i shield3D.js z tego refa gita (wtyczka Vite — pliki repo bez zmian), np.
// --przed HEAD~1 — wygląd sprzed zmiany na tych samych kadrach.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5351);
const out = resolve(repo, args.out || '.tmp/webgpu/tarcza-pokazana');
mkdirSync(out, { recursive: true });
const zooms = String(args.zoomy || 'def,0.5,1,2').split(',');
const seria = Number(args.seria || 0);
const SWAP_FILES = ['src/3d/shield/shieldPool.js', 'src/3d/shield3D.js'];
const swaps = {};
if (args.przed) {
  const ref = args.przed === true || args.przed === '1' ? 'HEAD' : String(args.przed);
  for (const f of SWAP_FILES) swaps[f.toLowerCase()] = execFileSync('git', ['show', `${ref}:${f}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  console.log(`wersja „przed”: ${ref} (${SWAP_FILES.join(', ')})`);
}
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const { createServer } = await import('vite');
const ab = {
  name: 'tarcza-przed', enforce: 'pre',
  load(id) {
    const p = id.split('?')[0].toLowerCase().replace(/\\/g, '/');
    for (const [k, v] of Object.entries(swaps)) if (p.endsWith(k)) return v;
    return null;
  }
};
const server = await createServer({ root: repo, logLevel: 'error', plugins: [ab], server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
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
  console.log(name, st.slice(0, 200));
};
const zoomOf = (zs) => (zs === 'def' ? result.etapy.scena.defZoom : Number(zs));
// Kamera RTS na okręcie (przybliżenie stałe, bez riga kamery statku).
const camOnShip = (z) => ev(`(() => { window.__harness.scene.cam(ship.pos.x, ship.pos.y, ${z}); return true; })()`);
try {
  await osobneLosowanieUuid(cdp);
  // Gra swobodna (kampania jest domyślna i startuje intro w doku).
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('sc_story_campaign','0'); localStorage.setItem('sc_story_tutorial','0');\nwindow.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');

  // Atlas w pustce (mgławica, gwiazdy), wieże nie strzelają, okręt zatrzymany; TARCZE z koła trybów.
  result.etapy.scena = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0xb17c); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0.4);
    if (window.fireControl) window.fireControl.posture = 'hold';
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    H.reseed(0xb17d);
    await H.step(20);
    const s = ship; if (s.vel) { s.vel.x = 0; s.vel.y = 0; }
    window.__kStart = H.frameLog.n;
    const ok = window.setShipMode('shield', true);
    await H.step(40);
    const sh = s.shield;
    return { ok, tryb: window.shipModes?.current, postawa: window.shipModes?.stance, show: sh.show, stan: sh.state, hp: sh.val, max: sh.max,
      defZoom: camera.defaultZoom, w: s.w, h: s.h };
  })()`, 300000);
  console.log('scena', JSON.stringify(result.etapy.scena));
  if (!result.etapy.scena.ok || !result.etapy.scena.show) throw new Error('tryb TARCZE nie włączył pokazania tarczy');
  const z0 = zoomOf(zooms[0]);

  for (const zs of zooms) {
    const tag = zs === 'def' ? 'def' : 'z' + zs;
    await camOnShip(zoomOf(zs));
    await ev('window.__harness.step(2)');
    await shot(`${tag}-pelna`);
    await ev('window.__harness.scene.isolate([7])');
    await shot(`${tag}-warstwa7`);
    await ev('window.__harness.scene.isolate(null)');
  }
  if (seria > 0) {
    await camOnShip(z0);
    for (let i = 0; i < seria; i++) {
      await ev('window.__harness.step(12)');
      await shot(`seria-${String(i).padStart(2, '0')}`);
    }
  }
  if (args.klatki) {
    // Klatki do animacji co 0,1 s czasu gry (bez zapisu stanu puli — szybciej).
    for (let i = 0; i < Number(args.klatki); i++) {
      await ev('window.__harness.step(6)');
      await camOnShip(z0);
      await ev('window.__harness.frames(2)');
      await screenshotPng(cdp, join(out, `klatka-${String(i).padStart(3, '0')}.png`));
    }
  }
  if (args.ab) {
    // A/B warstw pola na tej samej klatce (czas stoi): każdy element wyłączany osobno (ShieldTuning.field).
    await camOnShip(z0);
    await ev('(() => { window.__fieldBak = JSON.parse(JSON.stringify(window.ShieldTuning.field)); return true; })()');
    await ev('window.__harness.step(2)');
    await ev('window.__harness.freeze()');
    const variants = [['wszystko', {}], ['bez-soczewki', { lens: 0 }], ['bez-drzenia', { shimmer: 0 }], ['bez-pradow', { flow: 0 }],
      ['bez-pancerza', { hullTint: 0 }], ['bez-brzegu', { limb: 0, rim: 0 }], ['bez-siatki', { lattice: 0, twinkle: 0 }]];
    for (const [name, ovr] of variants) {
      await ev(`(() => { Object.assign(window.ShieldTuning.field, window.__fieldBak, ${JSON.stringify(ovr)}); return true; })()`);
      await ev('window.__harness.frames(3)');
      await shot(`ab-${name}`);
    }
    await ev('(() => { Object.assign(window.ShieldTuning.field, window.__fieldBak); return true; })()');
  }
  if (args.przejscie) {
    // Wejście w TARCZE (pokazanie 0 → 1): komórki zapalają się w losowej kolejności, brzeg z rozbłyskiem.
    await ev(`(async () => { window.setShipMode('combat', true); await window.__harness.step(60); return true; })()`);
    await camOnShip(z0);
    await ev(`(() => { window.setShipMode('shield', true); return true; })()`);
    let t = 0;
    for (const n of [5, 5, 5, 5, 10]) {
      await ev(`window.__harness.step(${n})`);
      t += n / 60;
      await shot(`wejscie-${t.toFixed(2)}`);
    }
  }
  if (args.trafienie) {
    // Trafienia (działa, PD) w pokazaną tarczę — efekt trafienia na tle pola.
    await camOnShip(z0);
    await ev(`(() => { const s = ship;
      const hit = (a, dmg, cls) => { registerShieldImpact(s, s.pos.x + Math.cos(a) * 1500, s.pos.y + Math.sin(a) * 1500, dmg, cls); s.shield.val = Math.max(0, s.shield.val - dmg); };
      hit(s.angle + 1.2, 140, 'main'); hit(s.angle + 1.25, 140, 'main'); hit(s.angle - 2.2, 60, 'pd'); return true; })()`);
    for (const [n, name] of [[4, '0.07'], [14, '0.30'], [60, '1.30']]) {
      await ev(`window.__harness.step(${n})`);
      await shot(`trafienie-${name}`);
    }
  }
  if (args.slabe) {
    // Słabe pole (< 35% HP): barwa ku czerwieni, brzeg drga, komórki gasną.
    await camOnShip(z0);
    await ev('(() => { ship.shield.val = ship.shield.max * 0.15; ship.shield.regenTimer = 99; return true; })()');
    for (let i = 0; i < 3; i++) {
      await ev('window.__harness.step(7)');
      await shot(`slabe-${i}`);
    }
    await ev('(() => { ship.shield.val = ship.shield.max; return true; })()');
  }
  if (args.kamera3d) {
    // Kamery 3D (orbita, pościg): czasza w perspektywie.
    for (const mode of ['orbit', 'chase']) {
      await ev(`(() => { window.__harness.scene.shipCam(${result.etapy.scena.defZoom}); window.Game3D.setCamera('${mode}'); window.Game3D.rig.first = true; return true; })()`);
      await ev('window.__harness.step(40)');
      await shot(`k3d-${mode}`);
    }
    await ev(`(() => { window.Game3D.setCamera('classic'); return true; })()`);
  }
  if (args.sonda) {
    // Pole slotu z GPU po kilku sekundach pokazania: |h| fali (zmarszczki), energia i przebicie (mają zostać 0).
    const probes = [];
    for (let i = 0; i < 4; i++) {
      await ev('window.__harness.step(30)');
      probes.push(JSON.parse(await ev('(async () => JSON.stringify(await window.probeShieldSlot(window.getShieldPoolStats().slots[0]?.slot ?? 0)))()')));
    }
    result.etapy.sonda = probes;
    console.log('sonda', JSON.stringify(probes));
  }
  if (args.koszt) {
    // GPU z tarczą pokazaną (TARCZE) i bez slotu (postawa bojowa), naprzemiennie (szum maszyny — mediana).
    await camOnShip(z0);
    const meas = [];
    for (let k = 0; k < 4; k++) {
      for (const mode of ['shield', 'combat']) {
        await ev(`(async () => { window.setShipMode('${mode}', true); await window.__harness.step(120); return true; })()`);
        const p = JSON.parse(await ev('(async () => JSON.stringify(await window.__harness.scene.perf(90)))()'));
        meas.push({ mode, gpu: p.gpuMs, cpu: p.coreRenderMs, calls: p.drawCalls });
      }
    }
    const med = (m) => { const a = meas.filter((x) => x.mode === m).map((x) => x.gpu).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
    result.etapy.koszt = { pomiary: meas, gpuTarcze: med('shield'), gpuBez: med('combat') };
    console.log('koszt', JSON.stringify(result.etapy.koszt));
  }
  // Pipeline'y synchroniczne i budowy grafu w klatkach od włączenia TARCZ (rozgrzewka ma je wykluczyć).
  result.etapy.kompilacjeWKlatce = JSON.parse(await ev(`JSON.stringify(window.__harness.pipes.list.filter((p) => p.k >= window.__kStart && (p.budowa ? !p.poza : (p.sync || p.compute))).map((p) => (p.budowa ? 'budowa ' : p.compute ? '' : 'sync ') + p.nazwa + (p.ms ? ' ' + p.ms + ' ms' : '')))`));
  console.log('kompilacje w klatce od TARCZ:', JSON.stringify(result.etapy.kompilacjeWKlatce));
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
process.exit(result.blad || result.bledy.length || (result.etapy.kompilacjeWKlatce || []).length ? 1 : 0);
