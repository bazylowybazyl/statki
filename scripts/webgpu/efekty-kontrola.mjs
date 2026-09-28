// Kontrola infrastruktury efektów GPU na prawdziwym GPU (port WebGPU, zadanie 12-B) — rzeczy, których
// harness zrzutów nie widzi (bez źródeł i świateł obraz jest ten sam co przed 12-B):
//  A. „uber” bez źródeł efektów = „uber” z zadania 02 (commit --ref, domyślnie a72b8fa) co do bitu: oba
//     posty na TYM SAMYM buforze sceny ostatniej klatki bitwy (z gorącym powietrzem dysz tej klatki);
//  B. siatka bezpieczeństwa: kwad z NaN (i osobno z +Inf) w buforze sceny — z nią zmiana tylko wokół
//     kwadu, bez niej (post z 02) NaN rozlany przez bloom;
//  C. źródła zniekształceń (fala, implozja, gorące powietrze z kierunkiem): zmiana tylko w zasięgu fali,
//     drugi render tej klatki = ten sam obraz (podzielony ekran), następna klatka bez zgłoszeń = 0 źródeł;
//  D. warstwa DIST: stałe przesunięcie 8 px (x, potem y w osiach sceny) przesuwa obraz w obszarze o 8 px
//     zgodnie z osiami sceny; wyłączona = obraz bez zmian;
//  E. siatka świateł „optIn”: MeshStandardMaterial z gridLights przy pustej siatce = bez flagi co do bitu,
//     ze światłem efektu jaśniejszy; koszt pętli siatki w passie ortho (GPU: płaszczyzna na cały kadr
//     bez flagi / z flagą i pustą siatką / z N światłami);
//  F. krok compute: rozgrzewka przy rejestracji, kolejność spawn → lights → update, dispatch raz na
//     klatkę, dane kernela = zegar efektów;
//  G. koszt pustej infrastruktury w bitwie w czasie rzeczywistym: fxStats.cpuMs (mediana, p95).
//   node scripts/webgpu/efekty-kontrola.mjs [--out .tmp/webgpu/efekty-kontrola] [--port 5348] [--ref a72b8fa]
// Kod wyjścia 1, gdy któraś kontrola nie przeszła (lista w <out>/wynik.json).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, osobneLosowanieUuid, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/webgpu/efekty-kontrola');
const port = Number(args.port || 5348);
const refCommit = args.ref || 'a72b8fa';
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

// „uber” z zadania 02 jako moduł strony: importy względne → ścieżki serwera (te same instancje modułów).
const refDir = join(repo, '.tmp/webgpu/efekty-kontrola');
mkdirSync(refDir, { recursive: true });
const refSrc = execFileSync('git', ['show', `${refCommit}:src/3d/tsl/postGry.js`], { cwd: repo, encoding: 'utf8' })
  .replace("from './uniformy.js'", "from '/src/3d/tsl/uniformy.js'")
  .replace("from './kolorGry.js'", "from '/src/3d/tsl/kolorGry.js'");
writeFileSync(join(refDir, 'postGry-ref.js'), refSrc);

const result = { ref: refCommit, kontrole: [], pomiary: {} };
const check = (name, ok, detail = '') => { result.kontrole.push({ name, ok: !!ok, detail }); console.log(`  [${ok ? 'OK' : 'NIE'}] ${name}${detail ? ' — ' + detail : ''}`); };
const note = (k, v) => { result.pomiary[k] = v; console.log(`  ${k}: ${JSON.stringify(v)}`); };
const IGNORE = /favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels|Zamiennik/;

const { server, base } = await startVite(port);
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const K = (fn, argsJson = '') => ev(`(async () => { const m = await import('/scripts/webgpu/efekty-kontrola-strona.js'); return m.${fn}(${argsJson}); })()`, 300000);
const quantile = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('nie wczytano sprite’ów');
  await ev('window.__harness.hold(true)');

  // ── bitwa jak w zrzuty.mjs (A: uber z gorącym powietrzem dysz) ──
  await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
    spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, -900), spawnAngle: Math.PI });
    spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(4000, 0), spawnAngle: Math.PI });
    spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
    S.cam(s.pos.x + 1500, s.pos.y, 0.3);
    for (let i = 0; i < 400 && !S.hullsReady(); i++) await H.frames(2);
    H.reseed(0xb17a); await H.step(120); S.cam(s.pos.x + 1500, s.pos.y, 0.3); await H.frames(3); return true; })()`, 300000);
  const a = await K('uberIdentycznosc');
  note('A', a);
  check('A. „uber” bez źródeł efektów = „uber” z 02 co do bitu (ten sam bufor sceny, gorące powietrze dysz tej klatki)',
    a.nowyVsStary.n0 === 0 && a.powtorzenie.n0 === 0, `różnych pikseli ${a.nowyVsStary.n0} (maks ${a.nowyVsStary.max}), źródeł ciepła ${a.zrodlaCiepla}, powtórzenie ${a.powtorzenie.n0}`);

  // ── spokojna scena: sam statek w próżni (powtarzalny render bez kroku gry) ──
  await ev(`(async () => { const S = window.__harness.scene, H = window.__harness;
    for (const n of window.npcs) if (!n.dead) applyDamageToNPC(n, 1e9, 'kontrola');
    DevScene.teleport(${DEEP.x + 400000}, ${DEEP.y}, 0); S.cam(ship.pos.x, ship.pos.y, 0.3);
    await H.step(240); S.cam(ship.pos.x, ship.pos.y, 0.3); await H.frames(3); return true; })()`, 300000);

  for (const inf of [false, true]) {
    const b = await K('nanSiatka', JSON.stringify({ inf }));
    note(`B-${inf ? 'inf' : 'nan'}`, b);
    check(`B. siatka bezpieczeństwa (${inf ? '+Inf' : 'NaN'}): wartości w buforze sceny, zmiana tylko wokół kwadu`,
      b.wBuforzeNieskonczonych > 0 && b.gra.far === 0 && b.gra.n0 > 0,
      `w buforze ${b.wBuforzeNieskonczonych}, z siatką poza ${b.promienPx} px: ${b.gra.far} (ramka ${JSON.stringify(b.gra.ramka)}), post z 02: poza ${b.referencyjny.far} / ${b.referencyjny.n8}`);
    check(`B. (kontrola metody) post z 02 bez siatki: ${inf ? '+Inf' : 'NaN'} rozlany przez bloom daleko od kwadu`, b.referencyjny.far > 0, `poza ${b.promienPx} px: ${b.referencyjny.far}`);
  }

  const c = await K('zrodlaZnieksztalcen');
  note('C', c);
  check('C. fala: zmiana tylko w zasięgu (R + 3,2 w), jedno źródło', c.fala.n8 > 0 && c.fala.far === 0 && c.fala.zrodla === 1, `zmienione ${c.fala.n8}, poza zasięgiem ${c.fala.far}`);
  check('C. drugi render tej klatki = ten sam obraz (kolejka żyje do końca klatki)', c.drugiRender.n0 === 0, `różnych ${c.drugiRender.n0}`);
  // Zgłoszenie po renderze zaczyna kolejkę następnego renderu (fala z poprzedniego już pokazana).
  check('C. implozja + gorące powietrze z kierunkiem po renderze: nowa kolejka (2 źródła), obraz zmieniony', c.trzyZrodla.zrodla === 2 && c.trzyZrodla.n8 > 0, `źródeł ${c.trzyZrodla.zrodla}, zmienione ${c.trzyZrodla.n8}`);
  check('C. następna klatka bez zgłoszeń: 0 źródeł', c.nastepnaKlatka.zrodla === 0 && c.nastepnaKlatka.naglowek === 0, JSON.stringify(c.nastepnaKlatka));

  const d = await K('warstwaDist');
  note('D', d);
  check('D. warstwa DIST: (8, 0) px → obraz z p − o (osie sceny): dx = −8', d.przesuniecieX.najlepszeDx === -8, `dx ${d.przesuniecieX.najlepszeDx}`);
  check('D. warstwa DIST: (0, 8) px (y sceny w górę) → dy = +8 w pikselach ekranu', d.przesuniecieY.najlepszeDy === 8, `dy ${d.przesuniecieY.najlepszeDy}`);
  check('D. warstwa wyłączona = obraz bez zmian', d.wylaczona.n0 === 0, `różnych ${d.wylaczona.n0}`);

  const e = await K('siatkaSwiatel');
  note('E', e);
  check('E. MeshStandardMaterial z gridLights, pusta siatka = bez flagi co do bitu', e.pustaSiatka.n0 === 0, `różnych ${e.pustaSiatka.n0}`);
  check('E. światło efektu (FxLights.point) rozjaśnia kulę z flagą, tylko w zasięgu', e.zeSwiatlem.jasnoscKuli > 1.01 && e.zeSwiatlem.far === 0, `jasność ×${e.zeSwiatlem.jasnoscKuli}, świateł ${e.zeSwiatlem.swiatla}, poza ${e.zeSwiatlem.far}`);

  const f = await K('krokCompute');
  note('F', f);
  check('F. krok compute: rozgrzewka przy rejestracji, kolejność, dispatch w klatce, dane kernela = zegar efektów',
    f.warmNaRejestracji === 1 && f.update === 3 && f.kolejnosc === 'spawn → lights → update' && f.dispatcheWKlatce >= 1 && Math.abs(f.dane[0] - f.oczekiwane[0]) < 1e-3 && Math.abs(f.dane[1] - f.oczekiwane[1]) < 1e-3,
    JSON.stringify(f));

  // ── E2 / G: czas rzeczywisty (GPU ze znaczników czasu, CPU klatki efektów) ──
  await ev('(() => { window.__harness.clock.mode = "real"; window.__harness.hold(false); return true; })()');
  const sample = async (label, ms = 4000) => {
    await sleep(1500);
    const gpu = []; const fx = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await ev('(() => ({ g: window.Core3D.gpuFrameMs, f: window.Core3D.fxStats.cpuMs }))()');
      gpu.push(s.g); fx.push(s.f);
      await sleep(50);
    }
    const r = { gpuMediana: +quantile(gpu, 0.5).toFixed(4), gpuP90: +quantile(gpu, 0.9).toFixed(4), fxCpuMediana: +quantile(fx, 0.5).toFixed(4), fxCpuP95: +quantile(fx, 0.95).toFixed(4), probki: gpu.length };
    note(label, r);
    return r;
  };
  // G: koszt pustej infrastruktury (spokojna scena, żadnych kroków ani świateł)
  await sample('G-spokojna-pusta');
  // E2: płaszczyzna na cały kadr: bez flagi / z flagą (pusta siatka) / z 256 światłami — na przemian, 2 serie
  const seria = [];
  for (let k = 0; k < 2; k++) {
    for (const tryb of ['bez', 'pusta', 'n']) {
      await K('kosztSiatki', JSON.stringify(tryb));
      const r = await sample(`E2-${tryb}-${k + 1}`, 3000);
      seria.push({ tryb, ...r });
    }
  }
  await K('kosztSiatki', JSON.stringify('off'));
  const med = (t) => +quantile(seria.filter((s) => s.tryb === t).map((s) => s.gpuMediana), 0.5).toFixed(4);
  note('E2-koszt-siatki-gpu', { bez: med('bez'), pusta: med('pusta'), swiatel256: med('n'), pustaMinusBez: +(med('pusta') - med('bez')).toFixed(4), n256MinusPusta: +(med('n') - med('pusta')).toFixed(4) });
  note('E2-cpu-klatki-efektow-256', { mediana: +quantile(seria.filter((s) => s.tryb === 'n').map((s) => s.fxCpuMediana), 0.5).toFixed(4) });
  note('stan', await K('fxStan'));
} catch (err) {
  check('sesja bez wyjątku', false, String(err?.stack || err).slice(0, 600));
} finally {
  const bad = logs.all().filter((l) => /^\[(error|exception|log:error|warning|log:warning)\]/.test(l) && !IGNORE.test(l));
  check('konsola bez błędów i ostrzeżeń (poza zamiennikami)', bad.length === 0, bad.slice(0, 6).join(' | '));
  await chrome.close();
  await server.close();
}
writeJson(join(out, 'wynik.json'), result);
const failed = result.kontrole.filter((k) => !k.ok);
console.log(failed.length ? `NIE PRZESZŁO: ${failed.length}` : 'wszystkie kontrole OK', '→', join(out, 'wynik.json'));
process.exit(failed.length ? 1 : 0);
