// Zrzuty dema mapy gwiezdnej (dema/mapa-gwiezdna.html) w headless Chrome z GPU (CDP), klatki z zegarem ręcznym
// (?test=1 → __mapa.runFrames): start przy Słońcu, cały sektor, rdzeń, mgławica z burzą, punkt skoku, pogranicze
// ze skanem, piraci przy kryjówce, najbliższy zoom; czasy wypieków, koszt kroku flot, błędy konsoli.
//
//   node scripts/webgpu/mapa-gwiezdna-demo.mjs [--out .tmp/mapa-gwiezdna/demo] [--rozmiar 1600x900] [--seed 1] [--tylko start,sektor]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/mapa-gwiezdna/demo');
const seed = Number(args.seed || 1);
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5431));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const report = { rozmiar: `${W}x${H}`, seed, zrzuty: {} };

async function shot(name, opis, frames = 3) {
  const st = await ev(`window.__mapa.runFrames(${frames}, 60)`);
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = { opis, ...st };
  delete report.zrzuty[name].bakes;
  console.log('zrzut', name.padEnd(22), JSON.stringify({ zoom: st.zoom, ship: st.ship, zone: st.zone, jump: st.jump, flot: st.fleetsVisible }));
}
const want = (id) => !only || only.has(id);

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/mapa-gwiezdna.html?test=1&seed=${seed}` });
  if (!await waitFor(cdp, '!!(window.__mapa && (window.__mapa.ready || window.__mapa.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__mapa.error || null');
  if (err) throw new Error(`demo: ${err}`);
  report.sektor = await ev('window.__mapa.summary');
  report.wypieki = await ev('window.__mapa.waitBakes()');
  console.log('wypieki [ms]', JSON.stringify(report.wypieki));
  if (want('start')) {
    await ev('window.__mapa.keys(["KeyW"])');
    await shot('00-start-sol', 'Start: wyjście z Układu Słonecznego rogiem NE, lot z ciągiem (zoom lotu)', 120);
    await ev('window.__mapa.keys([])');
  }
  if (want('sektor')) {
    await ev('window.__mapa.setZoom("fit")');
    await shot('01-caly-sektor', 'Cały sektor: rdzeń ze szlakami, ramiona, gromady, pustki, mgławice, floty w rdzeniu', 4);
  }
  if (want('rdzen')) {
    await ev('window.__mapa.setZoom(34)');
    await ev('window.__mapa.teleport(0, 0)');
    await shot('02-rdzen', 'Rdzeń zamieszkany: Słońce i sąsiedzi, szlaki handlowe, konwoje i patrole', 4);
  }
  if (want('mglawica')) {
    const st = await ev(`(() => { const s = window.__mapa.sector; const st = s.storms[0]; const p = { x: 0, y: 0 };
      const n = s.nebulaById.get(st.nebula); return { storm: st.id, nebula: n.id, kind: n.kind, x: n.x, y: n.y, rx: n.rx }; })()`);
    report.burza = st;
    await ev(`window.__mapa.teleport(${st.x}, ${st.y})`);
    await ev('window.__mapa.setZoom(16)');
    await shot('03-mglawica-calosc', `Mgławica ${st.nebula} (${st.kind}) z burzą — cała`, 40);
    await ev('window.__mapa.setZoom(70)');
    await shot('04-mglawica-burza', 'W mgławicy: spowolnienie, czujniki, błyski burzy', 60);
    const sp = await ev(`(() => { const M = window.__mapa; const s = M.sector; const st = s.storms[0]; const p = { x: 0, y: 0 };
      return import('/src/game/sector/sectorZone.js').then((m) => { m.stormPosition(s, st, M.S.t + 1, p); return { x: p.x + st.r * 0.5, y: p.y, r: st.r }; }); })()`);
    await ev(`window.__mapa.teleport(${sp.x}, ${sp.y})`);
    await ev('window.__mapa.setZoom(55)');
    await shot('04b-w-burzy', 'W komórce burzy: wir, pioruny, wiatr i paliwo × w HUD', 60);
  }
  if (want('skok')) {
    await ev('window.__mapa.teleportTo("alfa-centauri", 0.43, -0.43)');
    await ev('window.__mapa.setZoom(260)');
    await shot('05-punkt-skoku', 'Punkt skoku NE Alfa Centauri: komunikat „wejście do układu”', 4);
    await ev('window.__mapa.jump()');
    await shot('06-skok-komunikat', 'Po E: komunikat skoku (w grze — przeładowanie strony z id układu)', 2);
  }
  if (want('pogranicze')) {
    const id = await ev(`(() => { const s = window.__mapa.sector; const x = s.systems.find((q) => q.zone === 'frontier' && q.distSol > 30 && q.planets.length >= 4 && q.nebulaDensity < 0.1 && !q.pirateBase); return x.id; })()`);
    report.pogranicze = id;
    await ev(`window.__mapa.teleportTo(${JSON.stringify(id)}, 2.2, 0.6)`);
    await ev(`window.__mapa.select(${JSON.stringify(id)})`);
    await ev('window.__mapa.setZoom(90)');
    await shot('07-pogranicze-skan', `Pogranicze (${id}): gwiazda bez szczegółów, skan w toku`, 60);
    await shot('08-pogranicze-po-skanie', `Pogranicze (${id}): po skanie — nazwa, planety`, 150);
    await ev('window.__mapa.select(null)');
  }
  if (want('piraci')) {
    // Banda w drodze albo w zasadzce poza mgławicą — Atlas 2,2 ly od niej (w zasięgu wzroku bandy).
    const p = await ev(`(() => { const M = window.__mapa; const f = M.fleets.fleets.find((q) => q.kind === 'pirate' && (q.mode === 1 || q.mode === 2) && q.nebula < 0.1)
      || M.fleets.fleets.find((q) => q.kind === 'pirate' && q.mode !== 6); return { id: f.id, name: f.name, x: f.x, y: f.y, mode: f.mode }; })()`);
    report.piraci = p;
    await ev(`window.__mapa.teleport(${p.x + 2.2}, ${p.y + 0.5})`);
    await ev('window.__mapa.setZoom(70)');
    await shot('09-piraci-poscig', `${p.name}: banda wypatruje Atlasa i rusza w pościg`, 150);
  }
  if (want('zoom')) {
    await ev('window.__mapa.teleportTo("sol", 0.5, 0.3)');
    await ev('window.__mapa.setZoom(420)');
    await shot('10-zoom-max', 'Najbliższy zoom przy Słońcu: studnia, punkty skoku, Atlas', 4);
  }
  report.koncowe = await ev('window.__mapa.stats()');
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
console.log('błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
