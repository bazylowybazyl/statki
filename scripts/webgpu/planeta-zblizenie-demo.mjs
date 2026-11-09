// Zrzuty dema planety z bliska (dema/planeta-zblizenie.html) przez CDP (headless Chrome z GPU): wulkan z erupcją
// w kilku zbliżeniach, ten sam kadr bez wycinka pod kamerą (sama mapa planety), noc z żarem lawy, cała planeta.
//
//   node scripts/webgpu/planeta-zblizenie-demo.mjs [--out .tmp/planeta-zblizenie/<tag>] [--styl popiol|lawa|siarka]
//        [--ziarno N] [--wycinek 2048|4096] [--szer 1600 --wys 900] [--kadry wulkan,blisko,…] [--erupcja 16]
//        [--kod "<JS wykonywany po starcie, np. window.__zbl.S.pora = 60>"] [--port 5443]
// Kadry widoku z góry: daleko, wulkan, blisko, bardzo-blisko, bez-wycinka (jak „blisko”, wycinki wyłączone), noc,
// planeta albo własny „nazwa:x,y,zoom” (środek w promieniach planety, px na jednostkę gry). Kadry widoku orbitalnego:
// orbita, orbita-plaska (chmury jako maska — porównanie z bryłą), orbita-blisko, orbita-daleko, orbita-noc,
// orbita-zorza albo własny „orbita-nazwa:dAz,dEl,odległość,px,py[,1]” (punkt pod kamerą względem miejsca-bohatera
// [rad]; szósta liczba 1 — kąty wprost w układzie sceny).
// Wynik: PNG + wyniki.json (poziom wycinka, czasy wypieku, błędy konsoli).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/planeta-zblizenie/demo');
mkdirSync(out, { recursive: true });
const W = Number(args.szer || 1600);
const H = Number(args.wys || 900);
// (przecinek rozdziela kadry tylko przed nazwą — liczby własnego kadru też są po przecinku)
const shots = String(args.kadry || 'daleko,wulkan,blisko,bez-wycinka,noc,planeta').split(/,(?=[a-z])/i);
const erupt = Number(args.erupcja ?? 16);

const { server, base } = await startVite(Number(args.port || 5443));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const report = { zrzuty: [] };
try {
  const q = new URLSearchParams({ test: '1', erupcja: '0', styl: args.styl || 'popiol' });
  if (args.ziarno) q.set('ziarno', String(args.ziarno));
  if (args.wycinek) q.set('wycinek', String(args.wycinek));
  if (args.gpu) q.set('gpu', '1');
  await cdp.send('Page.navigate', { url: `${base}/dema/planeta-zblizenie.html?${q}` });
  if (!await waitFor(cdp, '!!(window.__zbl && window.__zbl.ready())', 600000, 500)) throw new Error('demo nie wstało');
  if (args.kod) await ev(`(() => { ${args.kod}; return 1; })()`);
  if (erupt > 0) await ev(`(() => { const Z = window.__zbl; Z.goVent(Z.S.ventIdx); Z.toggleEruption(); Z.advance(${erupt}); return 1; })()`);
  const ZOOM = { daleko: 0.22, wulkan: 0.45, blisko: 1.0, 'bardzo-blisko': 2.0, 'bez-wycinka': 1.0, noc: 0.45 };
  // kadry orbitalne: [dAz, dEl, odległość, px, py, abs] — punkt pod kamerą względem miejsca-bohatera [rad]
  // (abs = 1: kąty wprost w układzie sceny, słońce w +X)
  const ORBIT = {
    orbita: [-0.25, -0.2, 1.5, 0.42, 0.27], 'orbita-plaska': [-0.25, -0.2, 1.5, 0.42, 0.27],
    'orbita-blisko': [-0.07, -0.06, 1.15, 0.1, 0.07], 'orbita-daleko': [0.3, 0.15, 3.4, 0, 0],
    'orbita-noc': [-0.75, 0.62, 1.7, 0.45, 0.25, 1], 'orbita-zorza': [-1.8, 1.0, 2.0, 0, 0.3, 1]
  };
  for (const s of shots) {
    const [name, rest] = s.split(':');
    let code;
    if (name.startsWith('orbita')) {
      // widok orbitalny: az, el [rad], odległość [R], przesunięcie kadru px, py [R]; „-plaska” — chmury jako maska
      const o = rest ? rest.split(',').map(Number) : (ORBIT[name] || ORBIT.orbita);
      code = `Z.setViewMode('orbit'); Z.S.patchOn = true; Z.S.volOrbit = ${!name.includes('plaska')}; Z.goVent(Z.S.ventIdx, 0.45);
        Z.orbitAt(${o[0]}, ${o[1]}, ${o[2]}, ${o[3] ?? 0}, ${o[4] ?? 0}, ${o[5] ? 'true' : 'false'});`;
    } else if (rest) {
      const [x, y, z] = rest.split(',').map(Number);
      code = `Z.setViewMode('top'); Z.S.patchOn = true; Z.setView(${x}, ${y}, ${z});`;
    } else if (name === 'planeta') {
      code = "Z.setViewMode('top'); Z.S.patchOn = true; Z.viewAll();";
    } else if (name === 'noc') {
      code = `Z.setViewMode('top'); Z.S.patchOn = true; Z.goVent(Z.S.ventIdx, ${ZOOM.noc}); Z.S.pora += 40;`;
    } else {
      code = `Z.setViewMode('top'); Z.S.patchOn = ${name !== 'bez-wycinka'}; Z.goVent(Z.S.ventIdx, ${ZOOM[name] ?? 0.45});`;
    }
    await ev(`(() => { const Z = window.__zbl; const p0 = Z.S.pora; ${code} Z.advance(1.0); window.__p0 = p0; return 1; })()`);
    await settle();
    const f = await screenshotPng(cdp, join(out, `${name}.png`));
    const st = await ev(`(() => { const Z = window.__zbl; const P = Z.S.body.patches; const a = P.active >= 0 ? P.slots[P.active].win : null;
      const r = { zoom: Z.S.zoom, cx: Z.S.cx, cy: Z.S.cy, poziom: a ? a.level : 0, okno: a ? a.key : null, wypieki: P.stats.bakes, wypiekMs: Z.S.stats.bakeMs,
        fps: Z.S.stats.fps, gpuMs: Z.S.stats.gpuMs, styl: Z.S.body.spec.look.style, ziarno: Z.S.body.spec.seed, wulkany: Z.S.vents.length };
      Z.S.pora = window.__p0; return r; })()`);
    report.zrzuty.push({ name, plik: f, ...st });
    console.log(name, `zoom ${st.zoom.toFixed(2)} poziom ${st.poziom} wypieków ${st.wypieki} (${st.wypiekMs.toFixed(1)} ms) ${st.fps.toFixed(0)} kl/s${st.gpuMs != null ? ` GPU ${st.gpuMs.toFixed(2)} ms` : ''}`);
  }
  report.bledy = logs.errors().slice(0, 60);
} finally {
  writeJson(join(out, 'wyniki.json'), report);
  await chrome.close();
  await server.close();
}
if (report.bledy?.length) console.log('Dziennik:\n' + report.bledy.join('\n'));
process.exit(0);
