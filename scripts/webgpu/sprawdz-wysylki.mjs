// Kontrola wysyłek atrybutów i stanu buforów (zadanie 23): czy bufory GPU = tablice CPU po bitwie (wysyłka
// zakresów bez DynamicDrawUsage — src/3d/zakresyWysylki.js) i czy dwie wersje kodu mają ten sam stan danych
// (poprawka wydajności nie może zmienić obrazu — różnicę zrzutów rozkłada na bufory i uniformy).
//
// Harness zrzutów (zegar, ziarna), bitwa w próżni kroczona o N klatek, potem odczyt KAŻDEGO atrybutu sceny
// z GPU (renderer.getArrayBufferAsync) i porównanie z tablicą CPU; skróty (FNV na bitach) atrybutów, puli lamp
// kadłubów (HullLightStore) i wartości uniformów materiałów — do porównania wersji (--zapisz / --porownaj).
//
//   node scripts/webgpu/sprawdz-wysylki.mjs [--scena duza|bitwa] [--kroki 180] [--port 5349] [--root <drzewo gry>]
//        [--zapisz stan.json] [--png katalog]
//   node scripts/webgpu/sprawdz-wysylki.mjs --porownaj a.json,b.json      (bez przeglądarki)
//
// --scena duza:  24 × 24 w próżni, --kroki kroków (domyślnie);
// --scena bitwa: scena `bitwa` harnessu zrzutów (5 okrętów, 180 kroków, potem 45 + 10 klatek jak przed zrzutem)
//                — ta sama klatka, którą porównuje zrzuty.mjs; z --png także zrzut `bitwa.png`.
// Wynik: skóry kadłubów i odłamki z GPU ≠ CPU → kod wyjścia 1 (błąd wysyłki); inne siatki z GPU ≠ CPU tylko
// wypisane (np. pule zapisywane po ostatnim rysunku klatki). --porownaj: obiekty, atrybuty i uniformy różne
// między przebiegami (ta sama scena, dwie wersje kodu — np. --root drzewa sprzed zmiany).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();

if (args.porownaj) {
  const files = String(args.porownaj).split(',').filter(Boolean);
  if (files.length < 2) { console.log('--porownaj a.json,b.json'); process.exit(2); }
  const [A, B] = files.slice(0, 2).map((f) => JSON.parse(readFileSync(resolve(f), 'utf8')));
  process.exit(porownaj(A, B) ? 1 : 0);
}

const port = Number(args.port || 5349);
const kroki = Math.max(1, Number(args.kroki || 180));
const scena = args.scena || 'duza';
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
const BITWA_DUZA = `(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x5a7); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = ship; let n = 0; const put = (k, mode, x, y, a) => { const r = spawnCallInShip(k, { mode, spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a }); n += Array.isArray(r) ? r.length : (r ? 1 : 0); };
    const side = 24, nb = 4, nd = side - nb;
    for (let i = 0; i < nd; i++) put('destroyer', 'pirate', 6000 + (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, Math.PI);
    for (let i = 0; i < nb; i++) put('pirate_battleship', 'pirate', 9000, -(nb * 1300) + i * 2600, Math.PI);
    for (let i = 0; i < nd; i++) put('destroyer', 'friendly', 800 - (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, 0);
    for (let i = 0; i < nb; i++) put('battleship', 'friendly', -2600, -(nb * 1300) + i * 2600, 0);
    S.cam(s.pos.x + 3500, s.pos.y, 0.3);
    for (let i = 0; i < 900 && !S.hullsReady(); i++) await H.frames(2);
    H.reseed(0x5a8);
    await H.step(${kroki});
    await H.frames(4);
    return n; })()`;
// Scena `bitwa` z zrzuty.mjs (to samo ziarno sceny: skrót FNV nazwy).
const BITWA_SEED = [...'bitwa'].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
const BITWA_HARNESSU = `(async () => { const S = window.__harness.scene, H = window.__harness; window.__harnessDiag = null; H.reseed(${BITWA_SEED}); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
    spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, -900), spawnAngle: Math.PI });
    spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, 900), spawnAngle: Math.PI });
    spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(4000, 0), spawnAngle: Math.PI });
    spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: at(600, -1200), spawnAngle: 0 });
    spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
    S.cam(s.pos.x + 1800, s.pos.y, 0.3);
    let it = 0; for (; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    H.reseed(0xb17a);
    await H.step(180);
    S.cam(s.pos.x + 1800, s.pos.y, 0.3);
    return npcs.length; })()`;

// Stan strony: każdy atrybut sceny (CPU/GPU), pula lamp kadłubów, uniformy materiałów.
const STAN = `(async () => {
  const R = window.Core3D.renderer; const res = { obiekty: [], storage: {} };
  const fnv = (h, arr) => { const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength >> 2); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0; return h; };
  const gpuVsCpu = async (a) => {
    const cpu = a.array;
    try {
      const buf = await R.getArrayBufferAsync(a);
      const gpu = new Uint32Array(buf, 0, Math.min(buf.byteLength, cpu.byteLength) >> 2);
      const c = new Uint32Array(cpu.buffer, cpu.byteOffset, cpu.byteLength >> 2);
      let rozne = 0; for (let i = 0; i < gpu.length; i++) if (gpu[i] !== c[i]) rozne++;
      return { cpu: fnv(2166136261, cpu), gpu: fnv(2166136261, gpu), rozne, len: cpu.length };
    } catch (e) { return { cpu: fnv(2166136261, cpu), gpu: null, rozne: null, len: cpu.length }; }
  };
  const seen = new Set(); const objs = [];
  window.Core3D.scene.traverse((o) => { if (o.geometry && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) objs.push(o); });
  for (const o of objs) {
    const g = o.geometry;
    const row = { n: o.name || '', m: (o.material && (o.material.name || o.material.type)) || '', v: o.visible, l: o.layers.mask, cnt: o.count ?? null,
      dr: g.drawRange ? [g.drawRange.start, g.drawRange.count] : null, a: {} };
    const attrs = Object.entries(g.attributes);
    if (g.index) attrs.push(['index', g.index]);
    if (o.instanceMatrix) attrs.push(['instanceMatrix', o.instanceMatrix]);
    for (const [name, a0] of attrs) {
      const a = a0.isInterleavedBufferAttribute ? a0.data : a0;
      if (seen.has(a)) { row.a[name] = 'dzielony'; continue; }
      seen.add(a);
      row.a[name] = await gpuVsCpu(a);
    }
    const u = o.material && o.material.uniforms;
    if (u) {
      const vals = {};
      for (const [k, h] of Object.entries(u)) {
        const v = h && h.value;
        if (v == null) continue;
        if (typeof v === 'number' || typeof v === 'boolean') vals[k] = v;
        else if (v.isVector2 || v.isVector3 || v.isVector4 || v.isColor || v.isQuaternion) vals[k] = v.toArray();
        else if (v.isMatrix4 || v.isMatrix3) vals[k] = Array.from(v.elements);
        else if (Array.isArray(v)) vals[k] = 'tablica:' + v.length;
        else if (v.isTexture) vals[k] = 'tex:' + (v.name || '') + ':' + v.version;
      }
      row.u = vals;
    }
    res.obiekty.push(row);
  }
  try {
    const mod = await import('/src/3d/hexShips3D.tsl.js');
    const a = mod.HullLightStore.attribute;
    if (a) res.storage.hullLights = await gpuVsCpu(a);
  } catch (e) { res.storage.hullLights = String(e); }
  res.klatka = R.info.frame;
  return res; })()`;

const serveRoot = args.root ? resolve(args.root) : repo;
async function startServer() {
  if (serveRoot === repo) return startVite(port);
  const { createServer } = await import('vite');
  const srv = await createServer({ root: serveRoot, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await srv.listen();
  return { server: srv, base: `http://localhost:${srv.httpServer.address().port}` };
}

const { server, base } = await startServer();
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 300000) => evaluate(cdp, e, t);
let fail = false;
const wynik = { scena, kroki: scena === 'bitwa' ? 180 : kroki, root: serveRoot, when: new Date().toISOString() };
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y');
  await ev('window.__harness.hold(true)');
  const n = await ev(scena === 'bitwa' ? BITWA_HARNESSU : BITWA_DUZA);
  if (scena === 'bitwa') {
    await ev('window.__harness.frames(45)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(10)');
  }
  if (args.png) {
    const dir = resolve(args.png);
    mkdirSync(dir, { recursive: true });
    await screenshotPng(cdp, join(dir, `${scena === 'bitwa' ? 'bitwa' : 'bitwa-duza'}.png`));
  }
  const stan = await ev(STAN, 600000);
  Object.assign(wynik, { okrety: n, ...stan, bledy: logs.errors().slice(0, 20) });
  // Skóry kadłubów i odłamki: GPU ≠ CPU = błąd wysyłki; reszta informacyjnie.
  const kadlub = (o) => o.m === 'hull:beam' || /^Hull debris/.test(o.n);
  let atrybuty = 0, rozneKadluby = 0;
  const inne = [];
  for (const o of stan.obiekty) {
    for (const [name, a] of Object.entries(o.a)) {
      if (!a || typeof a !== 'object') continue;
      atrybuty++;
      if (!a.rozne) continue;
      if (kadlub(o)) { rozneKadluby++; console.log('  GPU ≠ CPU (kadłub):', o.n || o.m, name, `${a.rozne}/${a.len}`); }
      else inne.push(`${o.n || o.m}.${name} ${a.rozne}/${a.len}`);
    }
  }
  const kadluby = stan.obiekty.filter(kadlub).length;
  console.log(`okręty ${n}, scena ${scena}: obiektów ${stan.obiekty.length} (kadłubów i odłamków ${kadluby}), atrybutów ${atrybuty}; skóry/odłamki GPU ≠ CPU: ${rozneKadluby}`);
  if (inne.length) console.log(`  inne GPU ≠ CPU (informacyjnie): ${inne.slice(0, 10).join('; ')}`);
  const hl = stan.storage.hullLights;
  if (hl && typeof hl === 'object') console.log(`  pula lamp kadłubów: GPU ≠ CPU ${hl.rozne}/${hl.len}`);
  fail = rozneKadluby > 0;
} catch (err) {
  console.log('BŁĄD', err?.stack || err);
  wynik.blad = String(err?.stack || err);
  fail = true;
} finally {
  await chrome.close();
  await server.close();
}
if (args.zapisz) {
  const out = resolve(args.zapisz);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(wynik, null, 1) + '\n');
  console.log('zapisano', out);
}
process.exit(fail ? 1 : 0);

// Różnice stanu dwóch przebiegów (obiekty w kolejności sceny).
function porownaj(A, B) {
  let nd = 0;
  const na = A.obiekty?.length || 0, nb = B.obiekty?.length || 0;
  if (na !== nb) console.log(`liczba obiektów: ${na} ≠ ${nb}`);
  for (let i = 0; i < Math.min(na, nb); i++) {
    const x = A.obiekty[i], y = B.obiekty[i];
    const d = [];
    if (x.n !== y.n || x.m !== y.m) d.push(`nazwa ${x.n}/${x.m} ≠ ${y.n}/${y.m}`);
    if (x.v !== y.v) d.push(`visible ${x.v} ≠ ${y.v}`);
    if (JSON.stringify(x.dr) !== JSON.stringify(y.dr)) d.push(`drawRange ${JSON.stringify(x.dr)} ≠ ${JSON.stringify(y.dr)}`);
    if (x.cnt !== y.cnt) d.push(`count ${x.cnt} ≠ ${y.cnt}`);
    for (const an of new Set([...Object.keys(x.a || {}), ...Object.keys(y.a || {})])) {
      const p = x.a?.[an], q = y.a?.[an];
      if (p?.cpu !== q?.cpu) d.push(`${an}: CPU ${p?.cpu} ≠ ${q?.cpu}`);
      if (p?.gpu !== q?.gpu) d.push(`${an}: GPU ${p?.gpu} ≠ ${q?.gpu} (GPU ≠ CPU: ${p?.rozne} / ${q?.rozne})`);
    }
    for (const k of new Set([...Object.keys(x.u || {}), ...Object.keys(y.u || {})])) {
      if (JSON.stringify(x.u?.[k]) !== JSON.stringify(y.u?.[k])) d.push(`u.${k}: ${JSON.stringify(x.u?.[k]).slice(0, 80)} ≠ ${JSON.stringify(y.u?.[k]).slice(0, 80)}`);
    }
    if (d.length) { nd++; if (nd <= 40) console.log(`${i} ${x.n || '(bez nazwy)'} [${x.m}]\n   ${d.join('\n   ')}`); }
  }
  const ha = JSON.stringify(A.storage?.hullLights), hb = JSON.stringify(B.storage?.hullLights);
  if (ha !== hb) { nd++; console.log(`pula lamp kadłubów: ${ha} ≠ ${hb}`); }
  console.log(`obiektów różnych: ${nd} (klatki three: ${A.klatka} / ${B.klatka})`);
  return nd > 0;
}
