// KOLIZJE UUID w budowie TSL (pułapka 38, src/3d/tsl/uuidWezlow.js): materiały i kernele budowane PO `reseed`
// harnessu (Math.random z ziarnem wraca do stanu sprzed — węzły dostają uuid starszych węzłów, three r183 skleja
// je w builderze po uuid). A/B: łata Core3D (domyślnie) ↔ `--naprawa 0` (strażnik tylko liczy, three jak bez łaty).
//
//   node scripts/webgpu/tsl-uuid-gra.mjs [--tryb demo|gra] [--naprawa 0|1] [--czekaj ms] [--out .tmp/tsl-uuid] [--port 5298]
//
// demo — dema/wybuchy-webgpu.html jak wybuchy-sonda.mjs: przypadki capital / final / chain, każdy po
//        `reseed(0x5eed1234)` (= ziarno startu strony), sondy gazu budowane przy pierwszym użyciu, na końcu WGSL
//        wszystkich kerneli gazu (`f32( instanceIndex )` nie ma prawa w nich wystąpić).
// gra  — index.html przez harness: start gry, potem kilka scen z `reseed` tym samym ziarnem (bitwa, wybuch,
//        warp) — materiały i kernele budowane po starcie (pierwszy wybuch, pociski, rozgrzewka modułów).
// Wynik: Core3D.tslUuid (kolizje węzłów / uniformów / tekstur, pierwsze z opisem budowy), błędy konsoli.
// Z łatą ma być 0 kolizji i 0 błędów budowy TSL; `--naprawa 0` pokazuje, co skaża three bez łaty.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const tryb = args.tryb || 'demo';
const naprawa = args.naprawa !== '0';
const SEED = 0x5eed1234;
const outDir = resolve(repo, args.out || `.tmp/tsl-uuid/${tryb}-${naprawa ? 'lata' : 'bez'}`);
mkdirSync(outDir, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const SIZES = { escort: 160, cruiser: 220, capital: 300, final: 320 };

const { server, base } = await startVite(Number(args.port || 5298));
const chrome = await startChrome({ width: 1280, height: 720 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { tryb, naprawa, kroki: [] };
const stan = () => ev('JSON.parse(JSON.stringify(window.__tslUuid || null))');
const krok = async (nazwa) => {
  const s = await stan();
  report.kroki.push({ nazwa, kolizje: s?.kolizje, wezly: s?.wezly, uniformy: s?.uniformy, tekstury: s?.tekstury });
  console.log(nazwa.padEnd(28), s ? `kolizje ${s.kolizje} (węzły ${s.wezly}, uniformy ${s.uniformy}, tekstury ${s.tekstury})` : 'brak strażnika');
};

// WGSL kerneli gazu (jak wybuchy-sonda.mjs) — kernele zbudowane w tym przebiegu.
const wgslGazu = () => ev(`(() => {
  const r = window.Core3D.renderer, g = window.__demo ? window.__demo.fx.grid : window.__explosions?.grid;
  if (!g) return null;
  const names = ['curlNode', 'advectNode', 'reactNode', 'divNode', 'jacAB', 'jacBA', 'projectNode', 'clearNode', 'lightNode', '_probeLineNode', '_probeMaxNode', '_probeSumNode'];
  const out = {};
  for (const n of names) {
    const node = g[n];
    if (!node) continue;
    let code = '';
    try { code = r._nodes.getForCompute(node).computeShader || ''; } catch (e) { out[n] = 'błąd: ' + e.message; continue; }
    out[n] = (code.match(/f32\\( instanceIndex \\)/g) || []).length;
    (window.__wgslGazu = window.__wgslGazu || {})[n] = code;
  }
  return out;
})()`);

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__HARNESS_SEED__ = ${SEED};\nwindow.__TSL_UUID_NAPRAWA = ${naprawa};\n${INJECT}`
  });
  if (tryb === 'demo') {
    await cdp.send('Page.navigate', { url: `${base}/dema/wybuchy-webgpu.html?shot=1` });
    if (!await waitFor(cdp, '!!(window.__demo && window.__demo.ready && window.__harness)', 240000, 400)) throw new Error('demo nie wstało');
    await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
    await waitFor(cdp, 'window.__demo.proxiesReady()', 120000, 300);
    // Krótkie czekanie (--czekaj 0…1500) = materiały doku w tle demo kompilują się dopiero PO reseed (błędy
    // „cannot assign to parameter vPbUv”, PortHullBuild, ConditionalNode z etapu A wybuchów).
    await sleep(Number(args.czekaj ?? 2000));
    await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
    await krok('start dema');
    // GasGrid.probe przebudowuje kernel sondy, gdy jego WGSL zawiera `f32( instanceIndex )` (obejście sesji
    // wybuchów) — zapis WGSL każdej odrzuconej budowy: dowód skażenia z przeglądarki.
    await ev(`(() => {
      const g = window.__demo.fx.grid, orig = g._probeTainted;
      if (typeof orig !== 'function') return false;
      window.__sondaSkazona = [];
      g._probeTainted = function (r) {
        const t = orig.call(this, r);
        if (t) {
          const kod = {};
          for (const n of ['_probeLineNode', '_probeMaxNode', '_probeSumNode']) kod[n] = r._nodes.getForCompute(this[n]).computeShader;
          window.__sondaSkazona.push(kod);
        }
        return t;
      };
      return true;
    })()`);
    for (const kind of ['capital', 'final', 'chain']) {
      await ev(`(async () => {
        const d = window.__demo, h = window.__harness;
        d.clear(); h.reseed(${SEED}); await h.step(30);
        if ('${kind}' === 'chain') d.scene('chain');
        else { d.cam(d.gallery.x, d.gallery.y, 0.3); d.boomAt('${kind}', 0, 0, ${SIZES[kind] || 300}); }
        await h.step(${kind === 'chain' ? 120 : 60});
        const g = d.fx.grid, r = window.Core3D.renderer;
        for (const s of g.slots) if (s.active) await g.probe(r, s.index);
        await h.frames(2);
        return true;
      })()`);
      await krok(`po reseed: ${kind}`);
    }
    report.wgslGazu = await wgslGazu();
    // WGSL kerneli do porównania łata ↔ bez łaty (diff plików w katalogach wyników)
    const kody = await ev('window.__wgslGazu || {}');
    for (const [n, code] of Object.entries(kody)) writeFileSync(join(outDir, `${n}.wgsl`), code);
    const skazone = await ev('window.__sondaSkazona || []');
    report.sondaPrzebudowy = skazone.length;
    console.log('sonda gazu: odrzucone (skażone) budowy kerneli —', skazone.length);
    skazone.forEach((kod, k) => { for (const [n, code] of Object.entries(kod)) writeFileSync(join(outDir, `skazony-${k}${n}.wgsl`), code); });
    const bad = Object.entries(report.wgslGazu || {}).filter(([, v]) => v !== 0);
    console.log('WGSL kerneli gazu', bad.length ? `SKAŻONE: ${JSON.stringify(bad)}` : 'czyste', JSON.stringify(report.wgslGazu));
  } else {
    // Gra: kampania wyłączona (localStorage PRZED nawigacją — StoryOptions czyta go raz), start „single” jak zrzuty.mjs.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
    await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła (__frameId)');
    if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('nie wczytano sprite’ów kadłubów');
    await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
    await krok('start gry');
    // Sceny jak w zrzuty.mjs (kosmos: bitwa, wybuch, wraki, warp), każda po reseed ZIARNEM STARTU STRONY — ciąg
    // Math.random wraca do stanu z ładowania: nowe obiekty dostają uuid tamtych (bez łaty three skleja węzły).
    const DEEP = { x: 6210000, y: 5330000 };
    const SCENY = [
      ['bitwa', `DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
         const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
         spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, -900), spawnAngle: Math.PI });
         spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, 900), spawnAngle: Math.PI });
         spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(4000, 0), spawnAngle: Math.PI });
         spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: at(600, -1200), spawnAngle: 0 });
         spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
         S.cam(s.pos.x + 1800, s.pos.y, 0.3);
         let it = 0; for (; it < 400 && !S.hullsReady(); it++) await H.frames(2);
         await H.step(180);`],
      ['wybuch', `const e = npcs.filter((n) => !n.dead && !n.friendly).sort((a, b) => (b.radius || 0) - (a.radius || 0))[0];
         if (e) { applyDamageToNPC(e, 1e9, 'harness'); await H.step(15); S.cam(e.x, e.y, 0.5); await H.step(60); }`],
      ['wybuch reaktora', `triggerReactorBlow3D(ship.pos.x + 900, ship.pos.y, 300, { profile: 'capital' }); await H.step(90);`],
      ['warp', `DevFlags.unlimitedWarp = true; warp.state = 'charging'; warp.charge = 0; await H.step(75); S.cam(ship.pos.x, ship.pos.y, 0.6);`]
    ];
    for (const [nazwa, js] of SCENY) {
      try {
        await ev(`(async () => { const H = window.__harness, S = H.scene; H.reseed(${SEED}); ${js} await H.frames(3); return true; })()`);
      } catch (e) { console.log('scena', nazwa, 'błąd:', e.message); }
      await krok(`po reseed: ${nazwa}`);
    }
  }
  report.stan = await stan();
  if (report.stan?.pierwsze?.length) console.log('pierwsze kolizje', JSON.stringify(report.stan.pierwsze, null, 1));
} catch (e) {
  report.wyjatek = String(e.stack || e);
  console.log('BŁĄD', e.stack || e.message);
} finally {
  report.errors = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference/.test(l)).slice(0, 60);
  const tsl = report.errors.filter((l) => /kolizja uuid|cannot assign|Maximum call stack|NodeBuilder|TSL|WGSL|createRenderPipeline|createComputePipeline/i.test(l));
  report.bledyTsl = tsl;
  console.log(`błędy konsoli: ${report.errors.length} (TSL / budowa: ${tsl.length})`);
  for (const l of tsl.slice(0, 12)) console.log('  ', l.slice(0, 400));
  writeJson(join(outDir, 'raport.json'), report);
  console.log('wyniki', outDir);
  await chrome.close();
  await server.close();
  process.exit(0);
}
