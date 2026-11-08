// Zrzuty dema generatora planet (dema/generator-planet.html) przez CDP (headless Chrome z GPU): siatki rodzajów
// (widok gry — z góry, słońce z boku) i zbliżenia wybranych planet; czasy wypieku i pamięć z demo (`__gen`).
//
//   node scripts/webgpu/generator-planet-demo.mjs [--out .tmp/generator-planet/<tag>] [--rodzaje terran,gas|wszystkie]
//        [--mieszane 1] [--ziarno 7] [--zblizenia terran:123,gas:5] [--roz 2048] [--pora 90] [--port 5431]
//        [--szer 1600 --wys 900] [--zblizenie-kadr 3.2,0.6,0.15]   (odległość, azymut, wysokość kamery)
// Wynik: PNG + wyniki.json (czasy kompilacji i wypieku, pamięć, błędy konsoli).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/generator-planet/demo');
mkdirSync(out, { recursive: true });
const ALL = ['terran', 'ocean', 'desert', 'rocky', 'ice', 'volcanic', 'barren', 'toxic', 'gas', 'ice_giant'];
const types = args.rodzaje === 'wszystkie' ? ALL : (args.rodzaje ? String(args.rodzaje).split(',') : []);
const seed = Number(args.ziarno ?? 7) >>> 0;
const closes = args.zblizenia ? String(args.zblizenia).split(',').map((s) => s.split(':')) : [];
const roz = Number(args.roz || 2048);
const pora = Number(args.pora ?? 90);
const kadr = args['zblizenie-kadr'] ? String(args['zblizenie-kadr']).split(',').map(Number) : [3.2, 0.6, 0.15];

const { server, base } = await startVite(Number(args.port || 5431));
const chrome = await startChrome({ width: Number(args.szer || 1600), height: Number(args.wys || 900) });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const report = { zrzuty: [], czasy: [] };
try {
  const first = types[0] || (args.mieszane ? 'mieszane' : 'mieszane');
  await cdp.send('Page.navigate', { url: `${base}/dema/generator-planet.html?test=1&rodzaj=${first}&ziarno=${seed}&pora=${pora}&roz=${roz}&doba=0` });
  if (!await waitFor(cdp, '!!(window.__gen && window.__gen.ready())', 600000, 500)) throw new Error('demo nie wstało');
  const shot = async (name) => {
    await settle();
    const f = await screenshotPng(cdp, join(out, `${name}.png`));
    const st = await ev(`(() => { const S = window.__gen.S; return { compileMs: S.stats.compileMs, gridMs: S.stats.gridMs, gridWall: S.stats.gridWall, gridGpu: S.stats.gridGpu,
      tiles: S.tiles.map((t) => ({ type: t.spec.type, seed: t.spec.seed, ms: t.baked.ms, bytes: t.baked.bytes, style: t.spec.look.style || t.spec.look.palette || '' })),
      close: S.close ? { type: S.close.spec.type, seed: S.close.spec.seed, size: S.close.baked.size, ms: S.close.baked.ms, bytes: S.close.baked.bytes, levels: S.close.baked.levels } : null }; })()`);
    report.zrzuty.push({ name, plik: f, ...st });
    console.log(name, st.close ? `${st.close.type}:${st.close.seed} ${st.close.ms.total.toFixed(0)} ms, GPU ${st.close.ms.gpu?.toFixed(1)} ms` : `${st.tiles.length} planet, ${st.gridWall?.toFixed(0)} ms, GPU ${st.gridGpu?.toFixed(1)} ms, kompilacja ${st.compileMs?.toFixed(0)} ms`);
  };
  const gridList = args.mieszane ? ['mieszane', ...types] : (types.length ? types : ['mieszane']);
  for (let i = 0; i < gridList.length; i++) {
    const t = gridList[i];
    if (i > 0 || t !== first) {
      await ev(`(async () => { const G = window.__gen; G.S.gridType = '${t}'; G.S.baseSeed = ${seed}; G.setView('grid'); await G.buildGrid(); return 1; })()`);
    }
    await waitFor(cdp, 'window.__gen.ready()', 600000, 300);
    await shot(`siatka-${t}`);
  }
  for (const [t, s] of closes) {
    await ev(`(async () => { const G = window.__gen; G.S.dist = ${kadr[0]}; G.S.az = ${kadr[1]}; G.S.el = ${kadr[2]}; await G.openClose('${t}', ${Number(s) >>> 0}); return 1; })()`);
    await waitFor(cdp, 'window.__gen.ready()', 600000, 300);
    await shot(`zblizenie-${t}-${s}`);
    if (args.mapy) {
      for (const m of ['day', 'relief', 'spec', 'night', 'clouds']) {
        const b64 = await ev(`window.__gen.mapPng('${m}', -1, 2048)`);
        if (b64) writeFileSync(join(out, `mapa-${t}-${s}-${m}.png`), Buffer.from(b64, 'base64'));
      }
    }
  }
  report.bledy = logs.errors().slice(0, 60);
  report.dziennik = logs.all().filter((l) => /planetGen|warn/i.test(l)).slice(0, 40);
} finally {
  writeJson(join(out, 'wyniki.json'), report);
  await chrome.close();
  await server.close();
}
if (report.bledy?.length) console.log('Dziennik:', report.bledy.join('\n'));
process.exit(0);
